# 英语学习 SSE 客户端合并：`englishLearningPackSse.ts`

## 1. 背景与目标

原先单词包与经典句各有一份独立工具文件（`englishVocabularySse.ts`、`englishClassicQuotesSse.ts`），二者在 **SSE（Server-Sent Events）** 行协议解析、`getPlatformFetch`、`AbortController`、`postEnglishLearningStreamCancel` 等逻辑上高度重复，仅 **事件名前缀**（`vocab.*` / `classic.*`）、**默认 API 路径**、**条目解析**与 **部分 Toast 文案** 不同。

**目标**：合并为单一模块 `englishLearningPackSse.ts`，用**小配置对象 + 泛型核心函数**消除重复，对外仍导出 **`streamEnglishVocabularyPack` / `streamEnglishClassicQuotes`** 及原有类型别名，调用方（如 `VocabularySection.tsx`、`ClassicQuotesSection.tsx`）仅改 import 路径即可。

---

## 2. 改动范围

| 角色 | 路径 |
|------|------|
| 合并后实现（唯一入口） | `apps/frontend/src/utils/englishLearningPackSse.ts` |
| 调用方 | `apps/frontend/src/views/englishLearning/VocabularySection.tsx`、`ClassicQuotesSection.tsx` |
| 已移除（勿再引用） | ~~`englishVocabularySse.ts`~~、~~`englishClassicQuotesSse.ts`~~ |

与 **`http.post` + `silent` 取消流** 的关系：取消请求封装在 `@/service`；本文件在返回的 `abort()` 中调用 `postEnglishLearningStreamCancel`，详见 [英语学习流式取消HTTP静默.md](./英语学习流式取消HTTP静默.md)。

---

## 3. 实现思路

1. **`PackSseDefinition<TItem>`**  
   描述一种 pack 流：`defaultApi`、`typePrefix`（如 `vocab.`）、JSON 解析失败时的 Toast 标题、`stream.error` 缺省文案、以及 `parseItems`。

2. **`unwrapPackPayload(raw, typePrefix)`**  
   兼容 Nest `@Sse()` 常见形态：外层 `{ data: { type, ... } }` 与扁平 JSON；仅当 `inner.type` 以 `typePrefix` 开头时才解包，避免误把其它事件当正文。

3. **`runEnglishLearningPackSseStream<TItem>(def, options)`**  
   唯一读循环：`data:` 行 → `JSON.parse` → `processLine`。事件分支用模板字符串 `` `${tp}progress` `` 等与后端约定对齐；`complete` / `error` 返回 `true` 以跳出外层 `readLoop`。

4. **`const reader = streamReader`**  
   将可选链读流收窄为局部常量，满足 TypeScript 在异步 IIFE 内对 `read()` 的类型收窄。

5. **对外薄封装**  
   `ENGLISH_LEARNING_VOCAB_SSE_DEF` / `ENGLISH_LEARNING_CLASSIC_SSE_DEF` 两个常量传入核心函数；导出 `streamEnglishVocabularyPack` 与 `streamEnglishClassicQuotes`，保持原 API 形状。

6. **类型**  
   `EnglishPackStreamProgress` 等作为公共形状；`EnglishVocabStreamProgress` 等为别名，避免现有业务大量改名。

---

## 4. 关键代码与注释（讲解版摘录）

### 4.1 模块职责与差异点

**来源**：`apps/frontend/src/utils/englishLearningPackSse.ts`（约 L1–L17，文件头与 import）

```typescript
/**
 * 说明：本文件统一处理「单词包流」与「经典句流」两种 POST .../stream 的 SSE。
 * 说明：差异仅在于事件前缀 vocab.* / classic.* 与 parseItems；网络层共用 getPlatformFetch + BASE_URL。
 */
import { Toast } from '@ui/index';
import { BASE_URL } from '@/constant';
import { notifyUnauthorized } from '@/router/authSession';
import {
	type EnglishClassicQuoteItem,
	type EnglishVocabularyItem,
	postEnglishLearningStreamCancel,
} from '@/service';
import {
	ENGLISH_LEARNING_CLASSIC_QUOTES_STREAM,
	ENGLISH_LEARNING_VOCABULARY_PACK_STREAM,
} from '@/service/api';
import { getPlatformFetch } from '@/utils/fetch';
```

### 4.2 解包与两套 `parseItems`

**来源**：`apps/frontend/src/utils/englishLearningPackSse.ts`（约 L24–L75）

```typescript
/** 说明：与 Nest SSE 包装层一致：可能为 `{ data: { type, ... } }` 或扁平 JSON */
function unwrapPackPayload(
	raw: Record<string, unknown>,
	typePrefix: string,
): Record<string, unknown> {
	const inner = raw.data;
	if (inner && typeof inner === 'object' && !Array.isArray(inner)) {
		const o = inner as Record<string, unknown>;
		// 说明：用前缀区分 vocab 与 classic，避免混用其它通道的 data
		if (typeof o.type === 'string' && o.type.startsWith(typePrefix)) {
			return o;
		}
	}
	return raw;
}

// 说明：词条字段校验：word + ipa 必填，其余给默认占位
function parseVocabItems(raw: unknown): EnglishVocabularyItem[] {
	// ... 与仓库一致，此处从略
	return [];
}

// 说明：名句 english + translationZh 必填，避免空壳进列表
function parseClassicItems(raw: unknown): EnglishClassicQuoteItem[] {
	// ... 与仓库一致，此处从略
	return [];
}
```

### 4.3 定义对象 + 泛型核心签名

**来源**：`apps/frontend/src/utils/englishLearningPackSse.ts`（约 L136–L169）

```typescript
interface PackSseDefinition<TItem> {
	readonly defaultApi: string;
	/** 说明：须带句点，便于 unwrap 与分支里 `${tp}progress` 拼接 */
	readonly typePrefix: string;
	readonly parseFailTitle: string;
	readonly streamErrorFallback: string;
	readonly parseItems: (raw: unknown) => TItem[];
}

async function runEnglishLearningPackSseStream<TItem>(
	def: PackSseDefinition<TItem>,
	options: {
		api?: string;
		body: { topic: string; count?: number };
		callbacks: EnglishPackStreamCallbacks<TItem>;
	},
): Promise<(fromUser?: boolean) => void> {
	const {
		api = def.defaultApi,
		body,
		callbacks: {
			onProgress,
			onAgentTool,
			onChunk,
			onDone,
			onError,
			onUserAbort,
			onIncomplete,
		},
	} = options;
	// ... 说明：下文创建 AbortController、发起 fetch、processLine、返回 abort 闭包
}
```

### 4.4 `processLine`：前缀驱动的事件分发

**来源**：`apps/frontend/src/utils/englishLearningPackSse.ts`（约 L213–L309，`processLine` 内摘录）

```typescript
const processLine = (line: string): boolean => {
	// ... 说明：解析 `data:` 行、JSON.parse，失败时用 def.parseFailTitle Toast

	const parsed = unwrapPackPayload(raw, tp);
	const type = parsed.type;

	// 说明：以下分支与后端 english-learning.controller 下发事件名一一对应
	if (type === `${tp}progress`) {
		// 说明：记录 streamId 供 abort 时 postEnglishLearningStreamCancel
		// ... onProgress
		return false;
	}
	if (type === `${tp}agent_tool`) {
		// ... onAgentTool
		return false;
	}
	if (type === `${tp}chunk`) {
		const items = def.parseItems(parsed.items);
		// ... onChunk
		return false;
	}
	if (type === `${tp}complete`) {
		// ... onDone，返回 true 表示可结束读循环
		return true;
	}
	if (type === `${tp}error`) {
		// ... onError，message 缺省时用 def.streamErrorFallback
		return true;
	}
	return false;
};
```

### 4.5 返回的 `abort` 与后端取消联动

**来源**：`apps/frontend/src/utils/englishLearningPackSse.ts`（约 L360–L369）

```typescript
return (fromUser?: boolean) => {
	if (fromUser === true) {
		userAbortRequested = true;
	}
	if (serverStreamId) {
		// 说明：fire-and-forget；具体 HTTP 封装见 service 层 http.post + silent
		void postEnglishLearningStreamCancel(serverStreamId);
	}
	void streamReader?.cancel().catch(() => {});
	controller.abort();
};
```

### 4.6 两套 DEF 与对外导出

**来源**：`apps/frontend/src/utils/englishLearningPackSse.ts`（约 L372–L416）

```typescript
const ENGLISH_LEARNING_VOCAB_SSE_DEF: PackSseDefinition<EnglishVocabularyItem> =
	{
		defaultApi: ENGLISH_LEARNING_VOCABULARY_PACK_STREAM,
		typePrefix: 'vocab.',
		parseFailTitle: '单词包流解析失败',
		streamErrorFallback: '生成单词资料失败',
		parseItems: parseVocabItems,
	};

const ENGLISH_LEARNING_CLASSIC_SSE_DEF: PackSseDefinition<EnglishClassicQuoteItem> =
	{
		defaultApi: ENGLISH_LEARNING_CLASSIC_QUOTES_STREAM,
		typePrefix: 'classic.',
		parseFailTitle: '经典语句流解析失败',
		streamErrorFallback: '生成经典语句失败',
		parseItems: parseClassicItems,
	};

export async function streamEnglishVocabularyPack(options: {
	api?: string;
	body: { topic: string; count?: number };
	callbacks: EnglishVocabStreamCallbacks;
}): Promise<(fromUser?: boolean) => void> {
	return runEnglishLearningPackSseStream(ENGLISH_LEARNING_VOCAB_SSE_DEF, options);
}

export async function streamEnglishClassicQuotes(options: {
	api?: string;
	body: { topic: string; count?: number };
	callbacks: EnglishClassicStreamCallbacks;
}): Promise<(fromUser?: boolean) => void> {
	return runEnglishLearningPackSseStream(ENGLISH_LEARNING_CLASSIC_SSE_DEF, options);
}
```

---

## 5. 兼容性与扩展

- **破坏性**：删除旧文件名后，仍 import 旧路径会编译失败；应统一为 `@/utils/englishLearningPackSse`。
- **扩展第三种 pack**：新增 `parseXxxItems`、`PackSseDefinition` 常量及 `streamEnglishXxxPack` 薄封装即可，无需复制读循环。
- **后端事件名变更**：需同步改 `typePrefix` 或各分支字符串，并跑端到端 SSE。

---

## 6. 建议回归

1. 单词页拉取 / 停止 / 历史载入，SSE 进度与 chunk 正常。  
2. 经典句页同上。  
3. 停止后后端 Registry 能收到 `streamId`（与取消文档联调）。

---

## 7. 相关文档与源码

| 说明 | 路径 |
|------|------|
| 合并实现 | `apps/frontend/src/utils/englishLearningPackSse.ts` |
| 取消流 + `silent` | [英语学习流式取消HTTP静默.md](./英语学习流式取消HTTP静默.md) |
| 后端 SSE 路由 | `apps/backend/src/services/english-learning/english-learning.controller.ts` |

若与仓库最新源码不一致，以源码为准。
