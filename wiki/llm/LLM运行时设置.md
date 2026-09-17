# 设置页大模型运行时配置（按用户覆盖 `createLlm`）

> **文档角色**：设置页 `/setting/llm` 的**持久化、运行时解析与表单交互**主文档——含对话大模型与向量模型两区块；API Key 回显策略、预设联动、向量 tier 三字段联动等近期 UX 以 **§3.4–§3.6** 为准。  
> **延伸阅读**：[会员单用户LLM.md](./会员单用户LLM.md)（按用户 DB + 会员默认硅基/非会员 GLM）、[LLM设置UI预设.md](./LLM设置UI预设.md)（Combobox 与预设表）、[LLM设置保存流程.md](./LLM设置保存流程.md)（保存即启用与底部四态）、[../knowledge/向量BGE全局轮次.md](../knowledge/向量BGE全局轮次.md)（全站 BGE、向量入库与 RAG）、[创建LLM.md](./创建LLM.md)（工厂与 env 回退链）。

> **注意**：下文早期「单行 singleton / 全站共用」已由 [会员单用户LLM.md](./会员单用户LLM.md) 取代；请以按用户 `llm_runtime_config` 为准。

若与仓库最新源码不一致，**以源码为准**。

---

## 1. 背景与目标

### 1.1 持久化与运行时（基线）

运维与自托管用户希望在 UI 中配置 OpenAI 兼容凭证，且主站对话、知识库助手、RAG、英语学习、Agent 等**共用**用户保存的三元组（或走会员/env 默认），避免各模块 env 回退链不一致。

### 1.2 本轮 UX（2026-06）

| 诉求 | 实现要点 |
|------|----------|
| API Key 不要「默认自动填」 | 设置页**不回显** `VITE_*` / 服务端 `.env`；仅当用户曾在设置页保存且 `GET` 返回 `apiKey` 时回显 |
| 切换模型/预设不清 Key | 改 Base URL、模型名、向量模型/重排/库名时**保留**当前输入框中的 Key |
| 向量三字段联动 | embedding / rerank / collection 两套 tier 预设任改其一，另两项同步 |
| 日志安全 | `createLlm` 调试日志只打 `apiKeyConfigured`，不打印完整 Key |

**边界**：未在设置页保存时，服务端运行时仍可从 **`.env`** 解析 Key 调用模型（与 UI 是否展示无关）。

---

## 2. 改动范围（累计 + 本轮）

| 路径 | 说明 |
|------|------|
| `apps/backend/src/services/llm-config/*` | 按用户持久化、加解密、`vectorBgeOnlyGlobal` 等 |
| `apps/backend/src/utils/create-llm.ts` | `LlmCredentialResolver`、日志不写完整 Key |
| `apps/frontend/src/views/setting/llm/index.tsx` | 双区块 UI、联动、Key 回显、向量 tier |
| `apps/frontend/src/service/llmSettings.ts` | `LlmSettingsView`、`UpsertLlmVectorSettingsBody` |
| `chat` / `assistant` / `knowledge-qa` / `english-learning` / `agent` | 注入 `LlmConfigService` 传入 `createLlm` |

向量入库、全站 BGE、多库 RAG 见 [../knowledge/向量BGE全局轮次.md](../knowledge/向量BGE全局轮次.md)。

---

## 3. 实现思路

### 3.1 持久化与加密（摘要）

- 表 **`llm_runtime_config`** 按 **`user_id`** 一行：对话字段 + 向量字段 + `vector_bge_only`、`vector_search_profiles` 等。
- API Key 字段 AES-256-GCM 加密；`GET /api/settings/llm` 在已配置时返回完整 `apiKey` / `vectorApiKey`（须 JWT）。
- `PUT` 时省略 `apiKey` 或传空且已有密文 → **保留**已存 Key（见 DTO 注释）。

### 3.2 运行时凭证优先级（摘要）

```text
createLlm(..., llmConfigService)
  → resolveSiliconFlowCredentials：用户 DB 快照（active）> 有效会员 SILICONFLOW_* > 非会员 GLM_*
知识库向量：resolveKnowledgeVectorApiConfigForUser（含全站 BGE 超管凭证）> env 档位
```

详见 [会员单用户LLM.md](./会员单用户LLM.md)、[创建LLM.md](./创建LLM.md)。

### 3.3 API Key 回显策略（设置页）

| 场景 | 大模型 Key | 向量 Key |
|------|------------|----------|
| 首次打开、从未保存 | 空 | 空 |
| 已保存 | `GET` 返回的 `apiKey` | `GET` 返回的 `vectorApiKey` |
| 「恢复默认」后 | 清空 | 清空 |
| 本地 `VITE_GLM_API_KEY` / `VITE_SILICONFLOW_API_KEY` | **不用于**输入框默认或回退对比 |

`getProviderDefaults(isMember)` 只提供 **Base URL + 模型名**（与后端默认模型一致），**不含** apiKey。

**来源**：`apps/frontend/src/views/setting/llm/index.tsx`（`getProviderDefaults`、`resolveApiKeyFields`，约 L61–78、L205–211）

```typescript
type LlmProviderDefaults = { baseUrl: string; modelName: string };

function getProviderDefaults(isMember: boolean): LlmProviderDefaults {
  // 说明：仅 URL/模型，不从 VITE_* 注入 Key
  if (isMember) {
    return { baseUrl: readEnvSiliconflowBaseUrl(), modelName: readEnvSiliconflowModelName() };
  }
  return { baseUrl: readEnvGlmBaseUrl(), modelName: readEnvGlmModelName() };
}

function resolveApiKeyFields(savedFromServer: string | undefined | null) {
  const saved = (savedFromServer ?? '').trim();
  // 说明：无 saved 则 displayKey 也为空，不回退 env
  return { displayKey: saved, savedKey: saved };
}
```

初始 state：`useState('')`；未保存变更对比用 `savedApiKey` / `savedVectorApiKey` 本身，不与 env 比较。

### 3.4 大模型预设联动且保留 Key

- `LLM_PROVIDER_PRESETS`：智谱 GLM、硅基、DeepSeek 的 URL ↔ 模型双向 Map。
- `onBaseUrlChange` / `onModelNameChange`：命中预设时同步另一字段；**已移除** `resetApiKey()`。
- 保存：`trimmedKey === savedApiKey` 时不提交 `apiKey` 字段。

**来源**：`apps/frontend/src/views/setting/llm/index.tsx`（约 L325–343）

```typescript
const onBaseUrlChange = useCallback((next: string) => {
  if (next.trim() === baseUrl.trim()) return;
  setBaseUrl(next);
  const pairedModel = LLM_BASE_URL_TO_MODEL.get(next.trim());
  if (pairedModel) setModelName(pairedModel);
  // 说明：不再清空 apiKey
}, [baseUrl]);
```

### 3.5 向量 tier 三字段联动

统一表 `VECTOR_TIER_PRESETS`：

| embedding | rerank | collection |
|-----------|--------|------------|
| `BAAI/bge-large-zh-v1.5` | `BAAI/bge-reranker-v2-m3` | `knowledge_chunks_v2` |
| `Qwen/Qwen3-Embedding-4B` | `Qwen/Qwen3-Reranker-4B` | `knowledge_chunks_qwen3_2560` |

从预设下拉（或输入与预设完全一致）修改 **向量模型名称 / 重排模型名称 / 向量库名称** 任一时，通过 `VECTOR_TIER_BY_*` 同步另两项；**不清空**向量 API Key。手输非预设值只改当前字段。

**来源**：`apps/frontend/src/views/setting/llm/index.tsx`（`VECTOR_TIER_PRESETS`、`onVectorEmbeddingModelChange` 等，约 L138–200、L345–378）

```typescript
const onVectorEmbeddingModelChange = useCallback((next: string) => {
  const tier = resolveVectorTierByEmbedding(next);
  if (tier) {
    setVectorEmbeddingModel(tier.embeddingModel);
    setVectorRerankModel(tier.rerankModel);
    setVectorCollectionName(tier.collectionName);
    return;
  }
  setVectorEmbeddingModel(next);
}, [vectorEmbeddingModel]);
```

`onVectorRerankModelChange`、`onVectorCollectionNameChange` 对称实现。

### 3.6 `createLlm` 日志

调试 `console.log` 使用 `apiKeyConfigured: Boolean(credentials.apiKey?.trim())`，避免日志泄露完整 Key。运行时仍向 `ChatOpenAI` 传入真实 `apiKey`。

**来源**：`apps/backend/src/utils/create-llm.ts`（`createLlm` 内，约 L555–570）

```typescript
console.log(
  {
    apiKeyConfigured: Boolean(credentials.apiKey?.trim()),
    modelName: credentials.modelName,
    // ...
  },
  'createLlm',
);
```

### 3.7 保存与底部提示（摘要）

- 大模型：**保存即启用**（无单独开关）；`canSave` 要求三项非空；向量区块独立 `canSubmitVectorSave`。
- 向量：超管 `bgeOnly` 仅超管提交；非超管不传 `bgeOnly` 字段。详见 [LLM设置保存流程.md](./LLM设置保存流程.md)、[../knowledge/向量BGE全局轮次.md](../knowledge/向量BGE全局轮次.md)。

---

## 4. 关键代码与注释

### 4.1 前端保存大模型（Key 可选提交）

**来源**：`apps/frontend/src/views/setting/llm/index.tsx`（`onSave`，约 L765–775）

```typescript
const trimmedKey = apiKey.trim();
const keyUnchanged = trimmedKey === savedApiKey.trim();
await updateLlmSettings({
  enabled: true,
  baseUrl: baseUrl.trim(),
  modelName: modelName.trim(),
  // 说明：Key 未改则不 PUT，后端保留密文
  ...(!keyUnchanged && trimmedKey ? { apiKey: trimmedKey } : {}),
});
```

### 4.2 HTTP API（对话 + 向量）

**来源**：`apps/backend/src/services/llm-config/llm-config.controller.ts`

```typescript
// GET    /settings/llm          → LlmSettingsView（含 vector*、vectorBgeOnlyGlobal）
// GET    /settings/llm/defaults → baseUrl / 向量默认 URL/模型/库名（不含 Key）
// PUT    /settings/llm
// DELETE /settings/llm
// PUT    /settings/llm/vector
// DELETE /settings/llm/vector
```

### 4.3 `createLlm` 接入 resolver

**来源**：`apps/backend/src/utils/create-llm.ts`（约 L534–540）

```typescript
const credentials = resolver
  ? await resolver.resolveSiliconFlowCredentials(config, preset, userId)
  : resolveSiliconFlowCredentials(config, siliconFlowResolvePresets[preset](config));
```

---

## 5. 行为变化与兼容性

| 场景 | 行为 |
|------|------|
| 未在设置页保存 Key | UI 为空；服务端仍可用 `.env` Key 调模型 |
| 已保存 Key | UI 与 `GET` 回显一致；切换预设不清空 |
| 向量 tier 预设 | 三字段同步；自定义 tier 字符串不强制联动 |
| 恢复默认 | 对话/向量 Key 均清空为 `''` |
| 旧文档「VITE 自动填入 / 切换清空 Key」 | **已废弃**，以本文 §3.3–§3.5 为准 |

---

## 6. 测试与回归建议

1. 新用户打开设置页：Key 为空；保存后刷新仍回显。
2. 切换智谱/硅基/DeepSeek 预设：URL 与模型联动，Key **保持不变**。
3. 向量：选 BGE tier 再选 Qwen3 tier，三字段齐变，向量 Key 不变。
4. 保存时 Key 未改：请求体无 `apiKey`，后端密文不变。
5. 恢复默认后 Key 为空；对话回退 env（若 `.env` 有 Key）。
6. 全站 BGE、向量保存权限：见 [../knowledge/向量BGE全局轮次.md](../knowledge/向量BGE全局轮次.md)。

---

## 7. 相关文档与代码索引

| 说明 | 路径 |
|------|------|
| Combobox 与预设 UI | [LLM设置UI预设.md](./LLM设置UI预设.md) |
| 按用户 + 会员默认 | [会员单用户LLM.md](./会员单用户LLM.md) |
| 向量全站 BGE / RAG | [../knowledge/向量BGE全局轮次.md](../knowledge/向量BGE全局轮次.md) |
| createLlm 工厂 | [创建LLM.md](./创建LLM.md) |
| 设置页组件 | `apps/frontend/src/views/setting/llm/index.tsx` |
| 产品更新 | [../项目更新信息.md](../项目更新信息.md) §9 |
| 产品指南 | [../项目指南.md](../项目指南.md) §8.3 |
