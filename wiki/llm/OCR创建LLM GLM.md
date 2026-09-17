# OCR 接入 `createLlm` 与智谱 GLM-4.6V-Flash

> **文档角色**：图片 OCR / 视觉理解链路的**本轮实现说明**（从手写 `ChatOpenAI` 迁至统一工厂，并固定智谱视觉模型）。  
> **延伸阅读**：[创建LLM.md](./创建LLM.md)（工厂总览）、[chat/聊天机器人.md](../chat/聊天机器人.md) §3.3（对话附件分流）、[LLM运行时设置.md](./LLM运行时设置.md)（设置页大模型与 OCR 的隔离边界）。

## 1. 背景与目标

### 1.1 问题

- `OcrService` 曾自行 `new ChatOpenAI(...)`，凭证与模型名与 `createLlm` 预设表脱节，排查时需对照多套 env。
- 曾尝试 DashScope（通义千问）视觉模型，免费额度耗尽时上游返回 **403**，影响聊天图片附件理解。
- 对话 `chat` preset 已支持「设置页自定义大模型 > 会员硅基 / 非会员 GLM」，但 OCR 不应跟随用户对话模型——视觉能力与文本对话模型选型不同。

### 1.2 目标

- OCR 统一走 `createLlm({ preset: 'ocr' })`，与全站 LLM 工厂对齐。
- **固定**使用 `GLM_API_KEY` / `GLM_BASE_URL`，默认模型 **`GLM-4.6V-Flash`**（智谱视觉 Flash）。
- **不受**设置页「自定义大模型」覆盖；`llmConfigService` 在 `preset === 'ocr'` 时短路回 env。
- 聊天发图时 `buildAttachmentMessage` 仍调用 `imageOcrStream`，仅后端实现变更，前端无改动。

若与仓库最新源码不一致，**以源码为准**。

---

## 2. 改动范围

| 路径 | 说明 |
|------|------|
| `apps/backend/src/utils/create-llm.ts` | 新增 preset `ocr`、`DEFAULT_OCR_GLM_MODEL_NAME`、`buildGlmOcrEnvPresetOptions` |
| `apps/backend/src/enum/config.enum.ts` | 新增 `GLM_OCR_MODEL_NAME` |
| `apps/backend/src/services/ocr/ocr.service.ts` | 删除私有 `initLLM`；`createOcrLlm()` → `createLlm({ preset: 'ocr', ... })` |
| `apps/backend/src/services/llm-config/llm-config.service.ts` | `preset === 'ocr'` 跳过用户快照，仅 env GLM |
| `apps/backend/src/services/ocr/ocr.controller.ts` | JWT 取 `userId` 传入 `imageOcrStream`（当前 OCR 凭证仍不按用户切换） |
| `apps/backend/src/services/chat/chat.service.ts` | `buildAttachmentMessage` 增加 `userId` 并传给 `imageOcrStream` |

---

## 3. 实现思路

1. **preset 隔离**：在 `SiliconFlowLlmPreset` 增加 `'ocr'`，非会员 / 会员两套 `siliconFlowResolvePresetsForPreset` 表均指向 `buildGlmOcrEnvPresetOptions`，避免 OCR 误走硅基或用户自定义对话模型。
2. **模型名解析**：`resolveOcrGlmModelNameFromEnv` 读 `GLM_OCR_MODEL_NAME`，缺省为 `GLM-4.6V-Flash`；与对话用的 `GLM_MODEL_NAME` 分离，便于单独升级视觉模型而不动主对话。
3. **不传 `llmConfigService`**：`OcrService.createOcrLlm` 只调 `createLlm(configService, options)`，工厂内部若注入 `llmConfigService` 才会查用户设置；OCR 路径刻意不传，且 `resolveSiliconFlowCredentials` 对 `ocr` 已硬短路。
4. **聊天附件链路不变**：图片 mime 仍走 `imageOcrStream(stream: false)` 取整段描述，拼入附件系统/用户消息；非图片仍 `parseFile`。
5. **为何不用 Qwen OCR**：DashScope 免费额度与计费策略导致 403 风险；智谱 GLM Key 与非会员对话回退共用 `GLM_*`，运维只需保证一套智谱凭证。
6. **userId 预留**：`imageOcrStream(dto, _userId?)` 与 controller / chat 已透传，便于后续按会员或配额扩展，**当前未用于选模型**。

---

## 4. 关键代码与注释

### 4.1 OCR 服务：`createLlm` 替代手写 LLM

**来源**：`apps/backend/src/services/ocr/ocr.service.ts`（约 L23–L31）

```typescript
/** 固定使用 GLM_API_KEY / GLM_BASE_URL + GLM-4.6V-Flash（createLlm preset: ocr） */
private async createOcrLlm(): Promise<ChatOpenAI> {
  // 说明：preset 'ocr' 在工厂内映射到智谱 env，不传 llmConfigService 故不走设置页
  return createLlm(this.configService, {
    preset: 'ocr',
    temperature: 0,           // OCR 要求确定性输出，避免幻觉补字
    defaultTemperature: 0,
    maxTokens: 4096,          // 长图 / 多栏文字需要足够 token
    streaming: true,          // 支持 imageOcrStream 的 Observable 分支
  });
}
```

**来源**：`apps/backend/src/services/ocr/ocr.service.ts`（`imageOcrStream` 约 L79–L104）

```typescript
async imageOcrStream(dto: CreateOcrDto, _userId?: number): Promise<string | Observable<string>> {
  const llm = await this.createOcrLlm();
  const base64Image = await this.pathOrUrlToDataUrl(dto.url);
  const messages = [
    new SystemMessage('You are a professional OCR and image understanding assistant...'),
    new HumanMessage({
      content: [
        { type: 'image_url', image_url: { url: base64Image } }, // data URL 或 https
        { type: 'text', text: dto.prompt || 'Please extract all text from this image.' },
      ],
    }),
  ];
  // stream: true → RxJS Observable；false → invoke 整段（聊天附件用 false）
}
```

### 4.2 工厂：OCR preset 与 GLM 视觉模型名

**来源**：`apps/backend/src/utils/create-llm.ts`（约 L12–L13、L209–L215）

```typescript
/** 图片 OCR 默认视觉模型（智谱 GLM-4.6V-Flash） */
export const DEFAULT_OCR_GLM_MODEL_NAME = 'GLM-4.6V-Flash';

/** OCR 视觉模型：优先 GLM_OCR_MODEL_NAME，否则 GLM-4.6V-Flash */
function resolveOcrGlmModelNameFromEnv(config: ConfigService): string {
  return resolveModelNameFromEnvKeys(
    config,
    GLM_OCR_MODEL_NAME_KEYS, // 仅 GLM_OCR_MODEL_NAME
    DEFAULT_OCR_GLM_MODEL_NAME,
  );
}
```

**来源**：`apps/backend/src/utils/create-llm.ts`（`buildGlmOcrEnvPresetOptions` 约 L267–L281）

```typescript
/**
 * 构建 OCR 凭证解析 preset：GLM_API_KEY / GLM_BASE_URL + GLM-4.6V-Flash
 * 与 buildGlmEnvPresetOptions（对话非会员）共用 Key/BaseUrl 键，但模型名走 OCR 专用解析
 */
function buildGlmOcrEnvPresetOptions(
  missingApiKeyMessage: string,
  onMissingApiKey?: MissingApiKeyHandler,
): ResolveSiliconFlowOptions {
  return {
    apiKeyEnvKeys: GLM_ENV_API_KEY_KEYS,      // GLM_API_KEY
    baseUrlEnvKeys: GLM_ENV_BASE_URL_KEYS,    // GLM_BASE_URL
    defaultBaseUrl: DEFAULT_GLM_BASE_URL,
    resolveModelName: resolveOcrGlmModelNameFromEnv, // 非 GLM_MODEL_NAME
    missingApiKeyMessage,
    onMissingApiKey,
  };
}
```

**来源**：`apps/backend/src/utils/create-llm.ts`（preset 表 `ocr` 条目约 L369–L402）

```typescript
// 非会员与会员表均注册 ocr → buildGlmOcrEnvPresetOptions
ocr: () =>
  buildGlmOcrEnvPresetOptions(
    '未配置 GLM_API_KEY，无法进行图片 OCR',
  ),
```

### 4.3 设置页服务：OCR 不走用户自定义大模型

**来源**：`apps/backend/src/services/llm-config/llm-config.service.ts`（`resolveSiliconFlowCredentials` 约 L300–L306）

```typescript
/** OCR 固定走 GLM_* + GLM-4.6V-Flash，不受设置页自定义大模型覆盖 */
if (preset === 'ocr') {
  return resolveEnvSiliconFlowCredentials(
    config,
    siliconFlowResolvePresetsForPreset('ocr')(config),
  );
}
// 其余 preset：getActiveChatSnapshotForUser → 会员/非会员 env
```

### 4.4 聊天附件：图片仍走 OCR 流

**来源**：`apps/backend/src/services/chat/chat.service.ts`（`buildAttachmentMessage` 约 L137–L167）

```typescript
private async buildAttachmentMessage(
  attachments: { path: string; mimetype: string }[],
  promptSuffix: string,
  role?: MessageRole,
  userId?: number, // 新增：透传给 OCR，当前不改变凭证
): Promise<ChatMessageDto | null> {
  const IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/jpg', 'image/webp'];
  for (const attachment of attachments) {
    if (IMAGE_TYPES.includes(attachment.mimetype)) {
      imagePromises.push(
        this.ocrService.imageOcrStream(
          { url: attachment.path, prompt: '...', stream: false },
          userId,
        ).then((content) => `文件 ${attachment.path} 内容:\n${content}\n`),
      );
    }
    // 非图片 → parseFile
  }
}
```

---

## 5. 环境变量与部署

| 变量 | 必填 | 说明 |
|------|------|------|
| `GLM_API_KEY` | 是 | 智谱 API Key；OCR 与对话非会员回退共用 |
| `GLM_BASE_URL` | 建议 | 默认 `https://open.bigmodel.cn/api/paas/v4` |
| `GLM_OCR_MODEL_NAME` | 否 | 覆盖 OCR 视觉模型，默认 `GLM-4.6V-Flash` |

**注意**：设置页保存的自定义大模型 **不影响** OCR；仅服务端 env 生效。

---

## 6. 兼容性与影响

| 维度 | 说明 |
|------|------|
| 破坏性 | 自托管若仅配置硅基 Key、未配置 `GLM_API_KEY`，图片 OCR 与聊天附件识图将 503 |
| 用户可见 | 图片附件「内容描述」质量取决于智谱视觉模型；与对话主模型独立 |
| API | `POST /ocr/imageOcr` 行为不变，仍支持 `stream` 参数 |
| 日志 | `createLlm` 日志中 `modelName` 应为 `GLM-4.6V-Flash`（或 `GLM_OCR_MODEL_NAME`） |

### 建议回归

1. 配置 `GLM_API_KEY` 后重启后端，对话上传 png/jpeg 附件并发消息，确认助手能引用图中文字。
2. 直接调 `POST /ocr/imageOcr`（`stream: false` / `true`）各一次。
3. 设置页切换自定义大模型后重复步骤 1，确认 OCR 仍用 GLM 视觉模型（日志不变）。
4. 清空 `GLM_API_KEY`，确认 OCR 返回明确「未配置」类错误而非静默失败。

---

## 7. 相关源码路径

| 说明 | 路径 |
|------|------|
| OCR 业务 | `apps/backend/src/services/ocr/ocr.service.ts` |
| OCR 控制器 | `apps/backend/src/services/ocr/ocr.controller.ts` |
| `createLlm` / preset `ocr` | `apps/backend/src/utils/create-llm.ts` |
| 用户设置短路 | `apps/backend/src/services/llm-config/llm-config.service.ts` |
| 聊天附件拼消息 | `apps/backend/src/services/chat/chat.service.ts` |
| env 枚举 | `apps/backend/src/enum/config.enum.ts` |

---

## 8. 后续可做

- 按 `userId` / 会员档位选择不同视觉模型或配额。
- 大图为 OCR 单独配置 `GLM_OCR_API_KEY`，与对话 GLM 完全解耦。
- 设置页只读展示「当前 OCR 模型」运维信息（仍不写 Key 回显）。
