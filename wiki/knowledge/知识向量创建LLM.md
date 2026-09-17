# 知识库向量凭证收敛至 `create-llm`

> **文档角色**：embedding / rerank **凭证解析**（API Key、模型名）与 `KnowledgeEmbeddingService` 的基础消费方式。  
> **完整请求 URL、分片档位与 400/404 修复**见主文档 [硅基向量完整URL.md](./硅基向量完整URL.md)（`baseURL` = 完整 URL，已无 `endpoint` 拼接）。  
> **会员双库 / Qwen3 档位**见 [知识会员向量分层.md](./知识会员向量分层.md)。  
> **延伸阅读**：[知识RAG后端实现.md](./知识RAG后端实现.md)（RAG 全链路）、[../llm/创建LLM.md](../llm/创建LLM.md)（Chat `createLlm` 工厂）、[../llm/硅基对话统一.md](../llm/硅基对话统一.md)（硅基接入总览）。  
> 若与仓库最新源码不一致，**以源码为准**。

---

## 1. 背景与目标

### 1.1 问题

`KnowledgeEmbeddingService` 曾在 `createEmbeddingsClient` 与 `rerank` 内**各自重复**读取：

- `SILICONFLOW_API_KEY` / `SILICONFLOW_BASE_URL`
- `KNOWLEDGE_EMBEDDING_MODEL` / `KNOWLEDGE_RERANK_MODEL`
- 曾手动拼接 `endpoint = baseURL + '/embeddings' | '/rerank'`（**已废弃**，见 [硅基向量完整URL.md](./硅基向量完整URL.md)）

导致默认模型、Key 回退链、错误文案分散在两处，后续改 env 或换厂商时容易漏改。

### 1.2 目标

- **凭证解析**集中到 `apps/backend/src/utils/create-llm.ts`，与 Chat 侧 `resolveSiliconFlowCredentials` 共用 `trimConfigValue` / `resolveFirstTrimmed` / `resolveBaseUrl` 等工具。
- **HTTP 调用**（`fetch`、重试、超时、响应解析）仍留在 `knowledge-embedding.service.ts`，职责边界清晰。
- 对外字段：`apiKey`、`model`、`baseURL`（**完整请求 URL**）；不再返回 `endpoint`。

---

## 2. 改动范围

| 路径 | 说明 |
|------|------|
| `apps/backend/src/utils/create-llm.ts` | 新增 `KnowledgeVectorApiConfig`、`KNOWLEDGE_VECTOR_PRESETS`、`resolveKnowledgeEmbeddingApiConfig`、`resolveKnowledgeRerankApiConfig`、`KNOWLEDGE_EMBEDDING_BATCH_SIZE` |
| `apps/backend/src/services/knowledge-embedding/knowledge-embedding.service.ts` | 删除本地 `config.get`；改为调用上述解析函数；批次大小改用常量 |

**未改动**：Qdrant 写入、chunk 策略、`knowledge-qa` 的 rerank 调用方式、Chat `createLlm` 的 preset 表。

---

## 3. 实现思路

### 3.1 预设表 + 单一解析函数

embedding 与 rerank **共用** API Key 与 Base URL，仅模型 env 键、默认模型名、HTTP 路径不同。用 `KNOWLEDGE_VECTOR_PRESETS` 表描述差异，由内部函数 `resolveKnowledgeVectorApiConfig(config, preset)` 统一产出 `KnowledgeVectorApiConfig`。

对外暴露两个薄包装，避免 service 传入字符串 preset：

- `resolveKnowledgeEmbeddingApiConfig` → preset `'embedding'`
- `resolveKnowledgeRerankApiConfig` → preset `'rerank'`

### 3.2 环境变量与默认值

| 配置项 | 环境变量键 | 默认值 |
|--------|------------|--------|
| API Key | `SILICONFLOW_API_KEY`，回退 `QWEN_API_KEY` | 无（缺失则抛错） |
| Embedding **完整 URL** | `SILICONFLOW_EMBEDDING_URL` | `https://api.siliconflow.cn/v1/embeddings` |
| Rerank **完整 URL** | `SILICONFLOW_RERANK_URL` | `https://api.siliconflow.cn/v1/rerank` |
| Embedding 模型 | `KNOWLEDGE_EMBEDDING_MODEL`（及 `*_MEMBER`） | 见 tier 预设表 |
| Rerank 模型 | `KNOWLEDGE_RERANK_MODEL`（及 `*_MEMBER`） | 见 tier 预设表 |
| 单请求最大条数 | （常量） | `KNOWLEDGE_EMBEDDING_BATCH_SIZE = 32` |

**说明**：`SILICONFLOW_BASE_URL` 仅用于对话 Chat，**不再**与 `/embeddings` 拼接；详见 [硅基向量完整URL.md](./硅基向量完整URL.md)。

缺 Key 时统一错误：`缺少 SILICONFLOW_API_KEY（或兼容项 DASHSCOPE_API_KEY / QWEN_API_KEY），无法进行知识库向量检索`。

### 3.3 与 Chat `createLlm` 的关系

| 能力 | 入口 | 凭证来源 |
|------|------|----------|
| 知识库问答 Chat | `createLlm({ preset: 'knowledgeQa' })` | GLM_* 或会员 SILICONFLOW_*（对话模型） |
| 向量 embedding / rerank | `resolveKnowledgeEmbeddingApiConfig` / `resolveKnowledgeRerankApiConfig` | **固定** SILICONFLOW_* + 知识库专用模型键 |

向量链路**不走** `LlmCredentialResolver` 与会员 preset，避免把对话模型名误用于 embedding。

### 3.4 关键权衡

- **不把 `fetch` 迁入 `create-llm`**：该文件专注「读配置」；重试与响应形态解析留在 service，与历史实现一致。
- **预设表而非两套函数体**：新增第三种向量接口时只需扩表 + 导出包装，避免再复制 Key/BaseURL 逻辑。
- **移除 service 内调试 `console.log`**：减少生产日志噪音；`createLlm` 侧日志未在本轮调整。

---

## 4. 关键代码与注释

### 4.1 类型、批次常量与预设表

**来源**：`apps/backend/src/utils/create-llm.ts`（约 L152–L375）

```typescript
/** 单次 embeddings 请求 input 数组最大条数（硅基流动文档限制） */
export const KNOWLEDGE_EMBEDDING_BATCH_SIZE = 32;

/** 知识库向量 API 单次 HTTP 调用的完整配置 */
export type KnowledgeVectorApiConfig = {
	apiKey: string;   // Bearer 凭证
	baseURL: string; // 已去尾斜杠的根路径，如 https://api.siliconflow.cn/v1
	model: string;   // 上游模型名
	endpoint: string; // 完整 URL：baseURL + path
};

/** embedding / rerank 在 env 键、默认模型、路径上的差异 */
const KNOWLEDGE_VECTOR_PRESETS = {
	embedding: {
		modelKey: KnowledgeQaEnum.KNOWLEDGE_EMBEDDING_MODEL,
		defaultModel: 'BAAI/bge-large-zh-v1.5',
		path: '/embeddings',
	},
	rerank: {
		modelKey: KnowledgeQaEnum.KNOWLEDGE_RERANK_MODEL,
		defaultModel: 'BAAI/bge-reranker-v2-m3',
		path: '/rerank',
	},
};
```

### 4.2 统一解析与对外导出

> **历史摘录（已过时）**：以下代码展示旧版 `endpoint = baseURL + path` 逻辑；当前实现见 [硅基向量完整URL.md](./硅基向量完整URL.md) §4.2。

**来源**：`apps/backend/src/utils/create-llm.ts`（`resolveKnowledgeVectorApiConfig` 与导出函数，约 L382–L420）

```typescript
function resolveKnowledgeVectorApiConfig(
	config: ConfigService,
	preset: 'embedding' | 'rerank',
): KnowledgeVectorApiConfig {
	// Key：硅基优先，QWEN 作兼容回退（与历史错误文案一致）
	const apiKey = resolveFirstTrimmed(config, [
		ModelEnum.SILICONFLOW_API_KEY,
		ModelEnum.QWEN_API_KEY,
	]);
	// Base URL：复用 SILICONFLOW 环境键 + 默认硅基域名
	const baseURL = resolveBaseUrl(
		config,
		SILICONFLOW_ENV_BASE_URL_KEYS,
		DEFAULT_SILICONFLOW_BASE_URL,
	);
	if (!apiKey) {
		throw new Error(
			'缺少 SILICONFLOW_API_KEY（或兼容项 DASHSCOPE_API_KEY / QWEN_API_KEY），无法进行知识库向量检索',
		);
	}
	// 按 preset 取模型 env 与路径，未配置则用表内 defaultModel
	const { modelKey, defaultModel, path } = KNOWLEDGE_VECTOR_PRESETS[preset];
	const model = trimConfigValue(config, modelKey) || defaultModel;
	return { apiKey, baseURL, model, endpoint: `${baseURL}${path}` };
}

// 对外：service 只 import 这两个，不必关心 preset 字符串
export const resolveKnowledgeEmbeddingApiConfig = (config: ConfigService) =>
	resolveKnowledgeVectorApiConfig(config, 'embedding');

export const resolveKnowledgeRerankApiConfig = (config: ConfigService) =>
	resolveKnowledgeVectorApiConfig(config, 'rerank');
```

### 4.3 Service：embedding 客户端

**来源**：`apps/backend/src/services/knowledge-embedding/knowledge-embedding.service.ts`（`createEmbeddingsClient`，约 L83–L210）

```typescript
private createEmbeddingsClient() {
	// 凭证只在这一行解析；后续 callOnce 只用 apiKey / model / endpoint
	const { apiKey, model, endpoint } =
		resolveKnowledgeEmbeddingApiConfig(this.config);

	const callOnce = async (texts: string[]): Promise<number[][]> => {
		// ... fetch(endpoint, { Authorization: Bearer apiKey, body: { model, input: texts } })
		// ... 最多 3 次重试、60s 超时、解析 data[].embedding
	};

	const callBatched = async (texts: string[]) => {
		const out: number[][] = [];
		// 批次大小与 create-llm 常量对齐，避免 service 再写魔法数 32
		for (let i = 0; i < texts.length; i += KNOWLEDGE_EMBEDDING_BATCH_SIZE) {
			const batch = texts.slice(i, i + KNOWLEDGE_EMBEDDING_BATCH_SIZE);
			out.push(...await callOnce(batch));
		}
		return out;
	};

	return { embedQuery, embedDocuments };
}
```

### 4.4 Service：rerank

**来源**：`apps/backend/src/services/knowledge-embedding/knowledge-embedding.service.ts`（`rerank` 方法前部，约 L279–L315）

```typescript
async rerank(input: { query: string; documents: string[]; topN?: number }) {
	const { apiKey, model, endpoint } =
		resolveKnowledgeRerankApiConfig(this.config);

	// 空 query / 空 documents 早返回，与改前行为一致
	const query = (input.query ?? '').trim();
	const documents = (input.documents ?? []).map((d) => String(d ?? ''));
	if (!query || documents.length === 0) return [];

	// POST endpoint，body: { model, query, documents, top_n }
	// ... 重试与 results 解析逻辑未动
}
```

---

## 5. 兼容性与影响

- **行为兼容**：默认模型、硅基 endpoint、Key 回退链与改前 service 内联逻辑一致；**无** API 契约变化。
- **配置兼容**：仍使用 `SILICONFLOW_*` 与 `KNOWLEDGE_EMBEDDING_MODEL` / `KNOWLEDGE_RERANK_MODEL`；更换 embedding 模型后若维度变化，仍需按既有流程 re-embed（见 [RAG检索NestJS React Qdrant.md](./RAG检索NestJS React Qdrant.md)）。
- **用户可见性**：纯后端重构，**无**前端或产品文案变化。

---

## 6. 回归建议

1. 配置 `SILICONFLOW_API_KEY` + 默认模型，保存一篇知识库文档，确认向量入库成功、Qdrant 有 points。
2. 知识库问答触发 RAG，确认检索 + rerank 不报错，证据顺序合理。
3. 故意清空 `SILICONFLOW_API_KEY`，确认 embedding / rerank 均抛出统一缺 Key 错误。
4. 设置 `KNOWLEDGE_EMBEDDING_MODEL` 为其它硅基支持的 embedding 模型，确认请求 body 中 `model` 与 env 一致。

---

## 7. 相关源码路径

| 说明 | 路径 |
|------|------|
| 向量凭证解析（主） | `apps/backend/src/utils/create-llm.ts` |
| Embedding / rerank HTTP | `apps/backend/src/services/knowledge-embedding/knowledge-embedding.service.ts` |
| 配置枚举 | `apps/backend/src/enum/config.enum.ts` |
| RAG 消费 rerank | `apps/backend/src/services/knowledge-qa/knowledge-qa.service.ts` |

---

## 8. 后续可做

- 若 `知识RAG后端实现.md` §4.3 仍描述 DashScope 原生 embedding，应以本文 + 源码为准逐步收窄该节，避免与硅基实现双份维护。
- 若需会员/设置页覆盖向量 Key，可仿 `LlmCredentialResolver` 增加可选 resolver，当前 intentionally 仅 env。
