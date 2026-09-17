# 英语学习 Agent 流式对话：`createLlm` 统一接入

> **文档角色**：`AgentService`（`/agent` SSE、ReAct 工具调用）主/摘要模型创建方式变更说明。  
> **延伸阅读**：[创建LLM.md](./创建LLM.md)（工厂与 preset 总表）、[硅基对话统一.md](./硅基对话统一.md)（硅基接入背景）。

## 1. 背景与目标

### 1.1 问题

`AgentService` 曾在本文件内手写 `new ChatOpenAI(...)`：自行读 `SILICONFLOW_API_KEY`、`SILICONFLOW_BASE_URL`（缺省为智谱 `open.bigmodel.cn`）、`getGlmModelName()`（含 `ZHIPU_MODEL_NAME` 与默认 `glm-4.7`）。与主站 `ChatService` 已统一的 `createLlm({ preset: 'chat' })` **凭证回退链、默认 Base URL、默认模型名**不一致，运维对照 `.env` 时容易混淆，也不利于与 [创建LLM.md](./创建LLM.md) 单点维护。

### 1.2 目标

- 主模型（流式 ReAct）与摘要模型（`summarizationMiddleware`）均通过 **`createLlm`** 创建。
- 使用与主站对话相同的 **`preset: 'chat'`**，不单独增加 `agent` preset。
- **保留**原有推理参数：`temperature` / `maxTokens` / `abortSignal`、主模型 `streaming: true`、摘要 `streaming: false`、`thinking: disabled`。

若与仓库最新源码不一致，**以源码为准**。

---

## 2. 改动范围

| 路径 | 说明 |
|------|------|
| `apps/backend/src/utils/create-llm.ts` | 新增导出 `GLM_THINKING_DISABLED_KWARGS`（关闭 GLM thinking 链，供 Agent / Assistant 复用） |
| `apps/backend/src/services/agent/agent.service.ts` | 删除 `getGlmModelName` 与内联 `ChatOpenAI` 构造；`buildModels` 改为两次 `createLlm({ preset: 'chat', ... })` |

**未改动**：`agent-tools.ts`、`agent-memory.service.ts`（记忆子服务仍用智谱直连配置）、`english-learning.service.ts` 内单词包主 Agent（仍 `preset: 'englishLearning'`）。

---

## 3. 实现思路

1. **单一工厂**：凭证解析、缺 Key 报错、`baseURL` 去尾斜杠等逻辑集中在 `create-llm.ts`，`AgentService` 只声明业务参数（温度、token 上限、是否流式、是否关 thinking）。
2. **复用 `chat` preset**：不新增 `SiliconFlowLlmPreset` 枚举项，避免与 `chat` 完全相同的重复配置块；Agent 与主站对话在环境变量层面对齐。
3. **`GLM_THINKING_DISABLED_KWARGS`**：提取为模块级常量，`modelKwargs` 与 Assistant / 原 Agent 行为一致，避免工具调用与流式正文被 thinking 链干扰。
4. **主/摘要双实例**：仍返回 `{ main, summary }`；摘要模型固定 `temperature: 0.2`、`maxTokens: 2048`、非流式——与 refactor 前一致。

### 3.1 与 refactor 前的配置差异（运维注意）

| 项 | 旧 `buildModels`（内联） | 现 `preset: 'chat'` |
|----|-------------------------|-------------------|
| API Key | 仅 `SILICONFLOW_API_KEY` | `SILICONFLOW_API_KEY` → `DEEPSEEK_API_KEY` |
| Base URL 默认 | `https://open.bigmodel.cn/api/paas/v4` | `https://api.siliconflow.cn/v1` |
| 模型名回退 | 硅基 → DeepSeek → **ZHIPU** → `glm-4.7` | 硅基 → DeepSeek → 默认 `Pro/zai-org/GLM-5.1` |
| 缺 Key 文案 | `硅基流动 未正确配置（SILICONFLOW_API_KEY）` | `硅基流动未配置（SILICONFLOW_API_KEY，或兼容 DEEPSEEK_API_KEY），无法发起对话` |

若生产环境**仅**配置了智谱直连而未配硅基/DeepSeek 兼容键，行为可能变化；应对照 [创建LLM.md](./创建LLM.md) §5 配置硅基模型名。

---

## 4. 关键代码与注释

### 4.1 共享 `thinking` 关闭常量

**来源**：`apps/backend/src/utils/create-llm.ts`（约 L19–L22）

```typescript
/** 关闭 GLM thinking 链（Agent / Assistant 工具调用与流式正文） */
export const GLM_THINKING_DISABLED_KWARGS = {
  // 说明：智谱 GLM 系列在 OpenAI 兼容接口下可传 thinking；Agent 需纯正文 + 稳定 tool call
  thinking: { type: 'disabled' as const },
};
```

### 4.2 `AgentService.buildModels`

**来源**：`apps/backend/src/services/agent/agent.service.ts`（`buildModels` 约 L322–348）

```typescript
/**
 * 构建主模型与摘要模型（preset `chat`：与主站对话共用凭证与模型名）
 */
private buildModels(options: {
  maxTokens?: number;
  temperature?: number;
  signal?: AbortSignal;
}): { main: ChatOpenAI; summary: ChatOpenAI } {
  // 主模型：流式 ReAct，支持请求体 maxTokens/temperature 与中止信号
  const main = createLlm(this.configService, {
    preset: 'chat',
    streaming: true,
    temperature: options.temperature,
    defaultTemperature: 0.3, // 未传 dto.temperature 时与旧逻辑一致
    maxTokens: options.maxTokens,
    defaultMaxTokens: 4096,
    abortSignal: options.signal,
    modelKwargs: GLM_THINKING_DISABLED_KWARGS,
  });

  // 摘要模型：折叠长上下文，非流式、低温、较小 maxTokens
  const summary = createLlm(this.configService, {
    preset: 'chat',
    streaming: false,
    temperature: 0.2,
    maxTokens: 2048,
    modelKwargs: GLM_THINKING_DISABLED_KWARGS,
  });

  return { main, summary };
}
```

### 4.3 调用点（未改语义）

**来源**：`apps/backend/src/services/agent/agent.service.ts`（`runChatStream` 内约 L509–514）

```typescript
// 流式 epoch 与 abort 逻辑不变；仍把 dto.maxTokens / dto.temperature 传入 buildModels
const { main: mainLlm, summary: summaryLlm } = this.buildModels({
  maxTokens: dto.maxTokens,
  temperature: dto.temperature,
  signal: abortController.signal,
});
// 后续 createAgent({ model: mainLlm, ... }) 与工具 SSE 回调不变
```

---

## 5. 行为变化与兼容性

- **对用户可见**：英语学习页 Agent 对话、联网/知识库工具、SSE `content` / `tool` 事件形态**不变**；模型质量取决于 `.env` 是否与硅基端点匹配。
- **对运维**：Agent 与主站 Chat 共用一套 Key/Base/模型名解析；不再默认智谱 OpenAPI 根地址。
- **`AgentMemoryService`**：仍独立配置，本文范围外。

---

## 6. 测试与回归建议

1. 配置 `SILICONFLOW_API_KEY` + `SILICONFLOW_MODEL_NAME=Pro/zai-org/GLM-5.1`，英语学习 Agent 发起对话，确认流式正文与 `internet_search` / 知识库工具回调正常。
2. 故意去掉 `SILICONFLOW_API_KEY`、仅保留 `DEEPSEEK_API_KEY`（且模型名为硅基可用 ID），确认能启动或按预期 503。
3. 长对话触发摘要中间件时，确认会话不异常中断（摘要模型非流式仍可用）。

---

## 7. 相关文档与代码索引

| 说明 | 路径 |
|------|------|
| `createLlm` 工厂与 preset 表 | [创建LLM.md](./创建LLM.md) |
| Agent 工具与联网进上下文 | [英语学习主Agent联网搜索转LLM.md](../english/英语学习主Agent联网搜索转LLM.md) |
| 实现 | `apps/backend/src/services/agent/agent.service.ts` |
| 工厂 | `apps/backend/src/utils/create-llm.ts` |
