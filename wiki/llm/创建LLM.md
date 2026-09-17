# 后端 `createLlm` 统一工厂

> **文档角色**：硅基流动 + LangChain `ChatOpenAI` 的**唯一创建入口**说明。  
> **延伸阅读**：[硅基对话统一.md](./硅基对话统一.md)（业务为何统一硅基、Assistant SSE 等）、[英语学习生成鲁棒性.md](../english/英语学习生成鲁棒性.md)（单词包凑条与 JSON 重试）、[LLM运行时设置.md](./LLM运行时设置.md)（设置页实例级覆盖 env）、[OCR创建LLM GLM.md](./OCR创建LLM GLM.md)（图片 OCR preset `ocr`）。

## 1. 背景与目标

### 1.1 问题

主站 Chat、知识库助手、RAG 问答、英语学习等模块曾各自维护 `resolveXxxSiliconFlowConfig` + `new ChatOpenAI(...)`，凭证回退链与 `maxTokens` 策略分散，易出现：

- 同一硅基 Key 下误用 **DeepSeek 模型名**（如 `deepseek-chat`）→ 上游 **`400 status code (no body)`**；
- 环境变量键名迁移后（`CHAT_SILICONFLOW_MODEL_NAME` → `SILICONFLOW_MODEL_NAME`）未配置新键，回退到 deprecated 模型名。

### 1.2 目标

- 提供**单一函数** `createLlm(config, options)`，各业务只传 `preset` 与构造参数。
- **不改变**各模块既有 `temperature` / `maxTokens` / `streaming` / `modelKwargs`（含 JSON `response_format`）行为。
- 凭证与模型名解析按 **preset** 隔离，便于对照 `.env` 排查。

若与仓库最新源码不一致，**以源码为准**。

---

## 2. 改动范围

| 路径 | 说明 |
|------|------|
| `apps/backend/src/utils/create-llm.ts` | **新增**：`createLlm`、`CreateLlmOptions`、`SiliconFlowLlmPreset`、预设表 |
| `apps/backend/src/utils/index.ts` | 导出 `create-llm` |
| `apps/backend/src/services/chat/chat.service.ts` | 删除 `initModel` / 私有 resolve；直接 `createLlm(..., { preset: 'chat' })` |
| `apps/backend/src/services/assistant/assistant.service.ts` | 删除私有 `buildAssistantStreamLlm`；`preset: 'assistant'` |
| `apps/backend/src/services/knowledge-qa/knowledge-qa.service.ts` | 删除私有 resolve/build；`preset: 'knowledgeQa'` |
| `apps/backend/src/services/english-learning/english-learning.service.ts` | 主 Agent 与子模型 JSON 均 `preset: 'englishLearning'` |
| `apps/backend/src/services/agent/agent.service.ts` | 英语学习页 ReAct Agent SSE：`buildModels` → `createLlm({ preset: 'chat' })`（见 [Agent创建LLM统一.md](./Agent创建LLM统一.md)） |
| `apps/backend/src/services/ocr/ocr.service.ts` | `createLlm({ preset: 'ocr' })` → GLM-4.6V-Flash（见 [OCR创建LLM GLM.md](./OCR创建LLM GLM.md)） |
| `apps/backend/src/enum/config.enum.ts` | 统一 `SILICONFLOW_MODEL_NAME` / `SILICONFLOW_API_KEY` 等（`DEEPSEEK_*` 标 deprecated）；`GLM_OCR_MODEL_NAME` |

---

## 3. 实现思路

### 3.1 调用方式

各 Service **不再**封装本地 `initModel` / `buildXxxLlm`，在需要处直接：

```typescript
const llm = createLlm(this.configService, {
  preset: 'chat', // | 'assistant' | 'knowledgeQa' | 'englishLearning'
  temperature: 0.3,
  maxTokens: 8192,
  maxTokensPolicy: 'optional', // 主站 Chat：未传 maxTokens 则不写入 ChatOpenAI
  abortSignal: controller.signal,
  modelKwargs: { response_format: { type: 'json_object' } }, // 英语学习 JSON 子模型
});
```

### 3.2 `preset` 与凭证 / 模型名

| preset | 典型调用方 | API Key 回退（顺序） | Base URL 回退 | 模型名回退（顺序） | 缺 Key 时 |
|--------|------------|----------------------|---------------|-------------------|-----------|
| `chat` | `ChatService` | `SILICONFLOW_API_KEY` → `DEEPSEEK_API_KEY` | `SILICONFLOW_BASE_URL` → `DEEPSEEK_BASE_URL` | `SILICONFLOW_MODEL_NAME` → `DEEPSEEK_MODEL_NAME` → 默认 GLM-5.1 | `HttpException` 503 |
| `assistant` | `AssistantService` | 硅基 → DeepSeek → DashScope → Qwen | 硅基 → DeepSeek | `getAssistantSiliconFlowModelName`（硅基模型名 → DeepSeek 模型名） | 503 |
| `knowledgeQa` | `KnowledgeQaService` | 硅基 → DashScope → Qwen | 仅硅基 | `SILICONFLOW_MODEL_NAME` → `DEEPSEEK_MODEL_NAME` → `KNOWLEDGE_QA_MODEL` | 普通 `Error` |
| `englishLearning` | 单词包 Agent / JSON 子模型 | 硅基 → DeepSeek → DashScope | 硅基 → DeepSeek | `SILICONFLOW_MODEL_NAME` → `DEEPSEEK_MODEL_NAME` → 默认 GLM-5.1 | 503 |

**说明**：`AgentService`（`/agent` 流式对话）与主站 Chat **共用** `preset: 'chat'` 的凭证与模型名解析，不单独占 preset；详见 [Agent创建LLM统一.md](./Agent创建LLM统一.md)。

**重要**：当实际请求发往 **硅基流动** `baseURL` 时，`modelName` 必须是硅基支持的 ID（如 `Pro/zai-org/GLM-5.1`）。若仅配置了 `DEEPSEEK_MODEL_NAME=deepseek-chat` 而未配置 `SILICONFLOW_MODEL_NAME`，会触发 **400**（见 §5 排查）。

### 3.3 `maxTokensPolicy`

| 值 | 行为 | 使用方 |
|----|------|--------|
| `optional` | 仅当调用方显式传入 `maxTokens` 时才写入 `ChatOpenAI` | 主站 Chat |
| `default`（默认） | 未传 `maxTokens` 时使用 `defaultMaxTokens`（默认 4096） | 助手、RAG、英语学习 |

### 3.4 与旧文档的关系

[硅基对话统一.md](./硅基对话统一.md) 描述「为何统一硅基 + Assistant 流式协议」；**具体如何 new 模型**以本文与 `create-llm.ts` 为准。

---

## 4. 关键代码与注释

### 4.0 `GLM_THINKING_DISABLED_KWARGS`

**来源**：`apps/backend/src/utils/create-llm.ts`（约 L19–L22）

```typescript
/** 关闭 GLM thinking 链（Agent / Assistant 工具调用与流式正文） */
export const GLM_THINKING_DISABLED_KWARGS = {
  thinking: { type: 'disabled' as const },
};
```

`AgentService.buildModels` 通过 `modelKwargs: GLM_THINKING_DISABLED_KWARGS` 传入；Assistant 流式亦可复用同一常量。

### 4.1 `createLlm` 入口

**来源**：`apps/backend/src/utils/create-llm.ts`（约 L198–L258）

```typescript
export function createLlm(
  config: ConfigService,
  options: CreateLlmOptions,
): ChatOpenAI {
  const {
    preset,
    modelName: modelNameOverride,
    streaming = true,
    temperature,
    defaultTemperature = 0.3,
    maxTokens,
    maxTokensPolicy = 'default',
    defaultMaxTokens = 4096,
    abortSignal,
    modelKwargs,
  } = options;

  // 说明：按 preset 解析 apiKey / baseURL / modelName（各业务回退链不同）
  const credentials = resolveSiliconFlowCredentials(
    config,
    siliconFlowResolvePresets[preset](config),
  );
  if (modelNameOverride) {
    credentials.modelName = modelNameOverride; // 例如英语学习 summary 专用模型
  }

  const maxTokensField =
    maxTokensPolicy === 'optional'
      ? maxTokens !== undefined
        ? { maxTokens }
        : {}
      : { maxTokens: maxTokens ?? defaultMaxTokens };

  return new ChatOpenAI({
    apiKey: credentials.apiKey,
    modelName: credentials.modelName,
    streaming,
    temperature: temperature ?? defaultTemperature,
    ...maxTokensField,
    configuration: { baseURL: credentials.baseURL },
    ...(modelKwargs && { modelKwargs }),
    ...(abortSignal && { callOptions: { signal: abortSignal } }),
  });
}
```

### 4.2 英语学习 JSON 子模型

**来源**：`apps/backend/src/services/english-learning/english-learning.service.ts`（`invokeEnglishPackSubModelJson` 约 L2478–L2488）

```typescript
const llm = createLlm(this.configService, {
  preset: 'englishLearning',
  streaming: false,
  temperature: 0.35,
  maxTokens: capped, // 说明：按 batch 动态估算，上限 32768
  maxTokensPolicy: 'default',
  abortSignal: params.signal,
  modelKwargs: {
    response_format: { type: 'json_object' },
  },
});
```

### 4.3 主站 Chat 流式

**来源**：`apps/backend/src/services/chat/chat.service.ts`（约 L225–L232）

```typescript
const llm = createLlm(this.configService, {
  preset: 'chat',
  temperature: dto.temperature,
  maxTokens: dto.maxTokens || 8192,
  maxTokensPolicy: 'optional',
  defaultTemperature: 0.3,
  abortSignal: abortController.signal,
});
```

---

## 5. 兼容性与排查

### 5.1 环境变量迁移

| 旧键（建议迁移） | 新键 |
|------------------|------|
| `CHAT_SILICONFLOW_MODEL_NAME` | `SILICONFLOW_MODEL_NAME` |
| `KnowledgeQaEnum.SILICONFLOW_*`（部分模块） | `ModelEnum.SILICONFLOW_API_KEY` / `SILICONFLOW_BASE_URL` |

部署时请在 `.env` 中显式设置：

```bash
SILICONFLOW_API_KEY=sk-...
SILICONFLOW_BASE_URL=https://api.siliconflow.cn/v1
SILICONFLOW_MODEL_NAME=Pro/zai-org/GLM-5.1
```

可选：`KNOWLEDGE_QA_MODEL` 覆盖 RAG 问答模型名。

### 5.2 现象：单词包拉取 `400 status code (no body)`

| 可能原因 | 处理 |
|----------|------|
| 硅基 URL + `deepseek-chat` 模型名 | 配置 `SILICONFLOW_MODEL_NAME`，勿仅依赖 `DEEPSEEK_MODEL_NAME` |
| 仍使用旧 env 键 `CHAT_SILICONFLOW_MODEL_NAME` 而代码读 `SILICONFLOW_MODEL_NAME` | 改名或双写直至迁移完成 |
| JSON 模式 + 极大 `maxTokens` 与超长 system | 见 [英语学习生成鲁棒性.md](../english/英语学习生成鲁棒性.md) |

日志特征：主 Agent 检索与子模型 JSON **几乎同时** 400，且重试无效。

### 5.3 回归建议

1. 主站 Chat 流式 / 停止 / 续写。
2. 知识库助手多轮 + 停止；RAG `qa.delta`。
3. 英语学习：主题单词包流式、JSON 子模型、主 Agent 联网（可选）；页内 ReAct Agent SSE（`AgentService`，见 [Agent创建LLM统一.md](./Agent创建LLM统一.md)）。
4. 修改 `.env` 后重启 `pnpm server:dev`。

---

## 6. 相关源码索引

| 说明 | 路径 |
|------|------|
| 工厂实现 | `apps/backend/src/utils/create-llm.ts` |
| 知识库向量 embedding/rerank 凭证 | [../knowledge/知识向量创建LLM.md](../knowledge/知识向量创建LLM.md) |
| 会员知识库向量档位与双库 | [../knowledge/知识会员向量分层.md](../knowledge/知识会员向量分层.md) |
| Agent ReAct 接入 | [Agent创建LLM统一.md](./Agent创建LLM统一.md) |
| 配置枚举 | `apps/backend/src/enum/config.enum.ts` |
| 硅基接入总览 | [硅基对话统一.md](./硅基对话统一.md) |
