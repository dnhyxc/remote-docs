# 知识库向量：完整 URL 与分片档位

> **文档角色**：本轮主文档——embedding / rerank **完整请求 URL** 环境变量、`KnowledgeVectorApiConfig` 字段语义、入库分片与请求健壮性。  
> **凭证解析总览**（与 Chat 工厂关系、Key 回退链）见 [知识向量创建LLM.md](./知识向量创建LLM.md)。  
> **会员 Qwen3 双库 / tier** 见 [知识会员向量分层.md](./知识会员向量分层.md)。  
> **用户设置页独立向量配置与多库 RAG** 见 [用户向量RAG配置.md](./用户向量RAG配置.md)。  
> 若与仓库最新源码不一致，**以源码为准**。

---

## 1. 背景与目标

### 1.1 问题

知识库保存触发向量化时，日志曾出现：

- **HTTP 404**：请求打到 `https://api.siliconflow.cn/v1`（根路径），而非 `/v1/embeddings`。
- **HTTP 400**：`The parameter is invalid`，多见于 **default 档位 + BAAI/bge-large-zh-v1.5** 时单条分片过长（该模型单条约 **512 tokens** 上限）。

根因包括：

1. 旧实现用 `SILICONFLOW_BASE_URL` + 内置 `path` 拼出 `endpoint`；编译产物与运行时配置不一致时，`fetch` 可能仍指向根 URL。
2. Markdown 分片 `target=450` 对 bge 偏长，长文或重复字符测试易触发 400。
3. 批量 embedding 未过滤空串，错误日志缺少 `model` / `batch` / `maxLen` 等诊断字段。

### 1.2 目标

- **不再拼接路径**：embedding / rerank 各自使用环境变量中的**完整 URL**；`KnowledgeVectorApiConfig.baseURL` 即 `fetch` 地址，**移除 `endpoint` 字段**。
- **配置可校验**：Joi 登记 `SILICONFLOW_EMBEDDING_URL`、`SILICONFLOW_RERANK_URL`（optional URI）。
- **分片按 tier**：`default`（bge）更短分片；`member`（Qwen3）允许更长上下文。
- **请求前清洗**：去掉空字符串；失败信息带 URL、模型、批次与最大片段长度。

---

## 2. 改动范围

| 路径 | 说明 |
|------|------|
| `apps/backend/src/utils/create-llm.ts` | 默认完整 URL 常量、`KNOWLEDGE_VECTOR_URL_PRESETS`、`KnowledgeVectorApiConfig` 仅 `{ apiKey, baseURL, model }` |
| `apps/backend/src/enum/config.enum.ts` | `ModelEnum.SILICONFLOW_EMBEDDING_URL`、`SILICONFLOW_RERANK_URL` |
| `apps/backend/src/factorys/app-config.factory.ts` | Joi 校验上述 URL |
| `apps/backend/src/services/knowledge-embedding/knowledge-embedding.service.ts` | `fetch(baseURL)`、输入清洗、分片 tier、`indexKnowledge` 先解析 tier 再分片 |

**未改动**：Qdrant collection 命名、会员双库检索、`knowledge-qa` 调用形态、Chat `createLlm` preset 表。

---

## 3. 实现思路

### 3.1 完整 URL，禁止 base + path

| 能力 | 环境变量 | 默认值 |
|------|----------|--------|
| Embedding | `SILICONFLOW_EMBEDDING_URL` | `https://api.siliconflow.cn/v1/embeddings` |
| Rerank | `SILICONFLOW_RERANK_URL` | `https://api.siliconflow.cn/v1/rerank` |

`SILICONFLOW_BASE_URL` **仅用于对话 Chat**，不再参与向量 URL 拼接。部署时在 `.env` 显式配置完整地址即可；未配置时使用上表默认常量。

**权衡**：换厂商或自建网关时需在 env 写全路径，不能指望代码自动补 `/embeddings`；换来的是「日志里的 url = 实际请求 url」，排错更直接。

### 3.2 模型仍按 tier 预设表

`KNOWLEDGE_VECTOR_MODEL_PRESETS` 继续按 `default` / `member` 选择 `KNOWLEDGE_EMBEDDING_MODEL*` 与默认模型名；与 [知识会员向量分层.md](./知识会员向量分层.md) 一致。

### 3.3 分片长度与 tier 对齐

| tier | embedding 模型（典型） | `target` 字 | `overlap` 字 |
|------|------------------------|-------------|--------------|
| `default` | BAAI/bge-large-zh-v1.5 | 400 | 64 |
| `member` | Qwen/Qwen3-Embedding-4B | 2000 | 128 |

`indexKnowledge` **先** `resolveTierForAuthor`，**再** `chunkMarkdown({ tier })`，避免用会员模型却按 default 长度切分。

### 3.4 请求健壮性

- `callOnce` 前：`trim` + 过滤空串；空批次直接返回 `[]`。
- 错误文案：`url=` 替代旧 `endpoint=`；HTTP 非 2xx 时附加 `model`、`batch`、`maxLen`。

### 3.5 部署注意

修改 `create-llm.ts` 后须 **重新编译并重启** 后端（`pnpm server:dev` 或 `nest build`），否则 `dist` 仍可能保留旧的 `endpoint` 拼接逻辑。

---

## 4. 关键代码与注释

### 4.1 默认完整 URL 与配置类型

**来源**：`apps/backend/src/utils/create-llm.ts`（约 L15–L19、`KnowledgeVectorApiConfig` 类型附近）

```typescript
/** 硅基流动 embedding / rerank 默认完整请求 URL（非根路径，可直接用于 fetch） */
export const DEFAULT_SILICONFLOW_EMBEDDING_URL =
	'https://api.siliconflow.cn/v1/embeddings';
export const DEFAULT_SILICONFLOW_RERANK_URL =
	'https://api.siliconflow.cn/v1/rerank';

/**
 * 知识库向量 API 配置
 * - baseURL：完整请求 URL（来自 SILICONFLOW_EMBEDDING_URL / SILICONFLOW_RERANK_URL）
 * - 不再包含 endpoint；禁止与 SILICONFLOW_BASE_URL 拼接 path
 */
export type KnowledgeVectorApiConfig = {
	apiKey: string;
	baseURL: string;
	model: string;
};
```

### 4.2 URL 预设与统一解析

**来源**：`apps/backend/src/utils/create-llm.ts`（`KNOWLEDGE_VECTOR_URL_PRESETS`、`resolveKnowledgeVectorApiConfig`，约 L404–L446）

```typescript
/** 每种向量能力单独一张 URL 表：env 键 + 代码内默认完整 URL */
const KNOWLEDGE_VECTOR_URL_PRESETS: Record<
	KnowledgeVectorPreset,
	{ urlEnvKeys: readonly string[]; defaultUrl: string }
> = {
	embedding: {
		urlEnvKeys: [ModelEnum.SILICONFLOW_EMBEDDING_URL],
		defaultUrl: DEFAULT_SILICONFLOW_EMBEDDING_URL,
	},
	rerank: {
		urlEnvKeys: [ModelEnum.SILICONFLOW_RERANK_URL],
		defaultUrl: DEFAULT_SILICONFLOW_RERANK_URL,
	},
};

function resolveKnowledgeVectorApiConfig(
	config: ConfigService,
	preset: KnowledgeVectorPreset,
	tier: KnowledgeVectorTier = 'default',
): KnowledgeVectorApiConfig {
	// API Key：硅基优先，QWEN 作兼容回退
	const apiKey = resolveFirstTrimmed(config, [
		ModelEnum.SILICONFLOW_API_KEY,
		ModelEnum.QWEN_API_KEY,
	]);
	if (!apiKey) {
		throw new Error(
			'缺少 SILICONFLOW_API_KEY（或兼容项），无法进行知识库向量检索',
		);
	}
	// 模型名仍按 tier + preset 从 KNOWLEDGE_VECTOR_MODEL_PRESETS 读取
	const { modelKey, defaultModel } =
		KNOWLEDGE_VECTOR_MODEL_PRESETS[tier][preset];
	const { urlEnvKeys, defaultUrl } = KNOWLEDGE_VECTOR_URL_PRESETS[preset];
	const model = resolveFirstTrimmed(config, [modelKey]) || defaultModel;
	// baseURL = 完整 URL，直接传给 fetch，不做 normalize 或拼接
	const baseURL = resolveFirstTrimmed(config, urlEnvKeys) || defaultUrl;
	if (!baseURL) {
		throw new Error(
			`缺少 ${urlEnvKeys[0]}（知识库 ${preset} 完整请求 URL）`,
		);
	}
	return { apiKey, baseURL, model };
}
```

### 4.3 环境变量枚举与 Joi

**来源**：`apps/backend/src/enum/config.enum.ts`（`ModelEnum` 内硅基相关项，约 L79–L86）

```typescript
/** 知识库 embedding 完整请求 URL */
SILICONFLOW_EMBEDDING_URL = 'SILICONFLOW_EMBEDDING_URL',
/** 知识库 rerank 完整请求 URL */
SILICONFLOW_RERANK_URL = 'SILICONFLOW_RERANK_URL',
```

**来源**：`apps/backend/src/factorys/app-config.factory.ts`（Joi schema，约 L44–L45）

```typescript
// optional：未配置时 create-llm 使用 DEFAULT_SILICONFLOW_*_URL 常量
SILICONFLOW_EMBEDDING_URL: Joi.string().uri().optional().allow(''),
SILICONFLOW_RERANK_URL: Joi.string().uri().optional().allow(''),
```

### 4.4 Embedding 请求与错误诊断

**来源**：`apps/backend/src/services/knowledge-embedding/knowledge-embedding.service.ts`（`createEmbeddingsClient` / `callOnce`，约 L128–L210）

```typescript
// apiConfig.baseURL 已是完整 embeddings URL
const { apiKey, model, baseURL } = apiConfig;

const callOnce = async (texts: string[]): Promise<number[][]> => {
	// 说明：过滤空串，避免 SiliconFlow 对非法 input 返回 400
	const sanitized = texts
		.map((t) => String(t ?? '').trim())
		.filter((t) => t.length > 0);
	if (sanitized.length === 0) return [];

	// fetch 目标 = baseURL，不再使用 endpoint 或 base+path
	resp = await fetch(baseURL, {
		method: 'POST',
		headers: {
			Authorization: `Bearer ${apiKey}`,
			'Content-Type': 'application/json',
		},
		body: JSON.stringify({
			model,
			input: sanitized.length === 1 ? sanitized[0] : sanitized,
			encoding_format: 'float',
		}),
		signal: controller.signal,
	});

	if (!resp.ok) {
		throw new Error(
			`SiliconFlow 向量请求失败：${msg}；status=${resp.status}；url=${baseURL}；model=${model}；batch=${sanitized.length}；maxLen=${Math.max(...sanitized.map((t) => t.length))}`,
		);
	}
	// ... 解析 data[] 与重试逻辑
};
```

Rerank 分支同样改为 `fetch(baseURL)`，错误文案使用 `url=${baseURL}`。

### 4.5 按 tier 分片与入库顺序

**来源**：`apps/backend/src/services/knowledge-embedding/knowledge-embedding.service.ts`（`chunkMarkdown`、`indexKnowledge`，约 L498–L565）

```typescript
chunkMarkdown(input: {
	title: string;
	content: string;
	tier?: KnowledgeVectorTier;
}): KnowledgeChunk[] {
	const tier = input.tier ?? 'default';
	// bge 约 512 tokens；Qwen3-Embedding 支持更长上下文
	const target = tier === 'member' ? 2000 : 400;
	const overlap = tier === 'member' ? 128 : 64;
	// ... 按标题切块 + 长度兜底 + overlap
}

async indexKnowledge(input: { ... }): Promise<{ contentHash: string; chunkCount: number }> {
	const tier = await this.resolveTierForAuthor(input.authorId);
	// 说明：必须先有 tier，再分片，再 embedDocuments({ tier })
	const chunks = this.chunkMarkdown({
		title,
		content: input.content ?? '',
		tier,
	});
	const vectors = await this.embedDocuments(
		chunks.map((c) => c.text),
		{ tier },
	);
	// ... 写入 Qdrant
}
```

---

## 5. 兼容性与影响

| 项 | 说明 |
|----|------|
| **破坏性** | 若曾依赖「只配 `SILICONFLOW_BASE_URL`、由代码拼 `/embeddings`」，现须配置完整 URL 或依赖代码默认值 |
| **数据** | 不改 Qdrant 点结构；仅分片边界可能变化，下次保存会按新策略重算向量 |
| **会员** | `member` tier 分片更长，与 Qwen3 向量维度 / collection 逻辑不变 |
| **前端** | 无变更；向量 URL 为服务端 env |

---

## 6. 回归建议

1. `.env` 配置 `SILICONFLOW_EMBEDDING_URL`、`SILICONFLOW_RERANK_URL` 后重启后端，保存一篇知识库；日志中 `url` 应为完整 embeddings 地址。
2. **非会员**或 `authorId` 为空：模型为 bge、分片 target 400，长文不应 400。
3. **有效会员**：模型为 Qwen3-Embedding-4B、分片 target 2000，入库与 RAG 检索正常。
4. 故意去掉 `SILICONFLOW_EMBEDDING_URL`：应回退到 `DEFAULT_SILICONFLOW_EMBEDDING_URL` 仍能成功。

---

## 7. 相关源码路径

| 说明 | 路径 |
|------|------|
| 向量凭证与 URL 解析 | `apps/backend/src/utils/create-llm.ts` |
| 入库 / 分片 / fetch | `apps/backend/src/services/knowledge-embedding/knowledge-embedding.service.ts` |
| 保存触发索引 | `apps/backend/src/services/knowledge/knowledge.service.ts` |
| 环境变量键 | `apps/backend/src/enum/config.enum.ts` |
| Joi | `apps/backend/src/factorys/app-config.factory.ts` |

---

## 8. 后续可做

- 设置页暴露向量模型 / URL（与用户级 `llm_runtime_config` 对齐）——当前仍以 env + 会员 tier 为主。
- 按模型动态 `target`（读厂商文档 token 上限）而非硬编码 tier 表。
- 分片长度与 `KNOWLEDGE_EMBEDDING_BATCH_SIZE` 联调压测，平衡吞吐与 400 风险。
