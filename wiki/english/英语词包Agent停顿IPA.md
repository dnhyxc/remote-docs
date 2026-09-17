# 英语学习批量拉取：Agent 检索、凑条策略、SSE 工具展示与 IPA 展示（本轮改动说明）

本文档依据当前仓库 **`git diff`** 归纳实现要点；**每个代码块下方附「逐行释义」表**。

---

## 1. 背景与目标（用户视角）

1. **凑满条数**：单词包 / 经典语句在多轮 DeepSeek JSON 生成下，常因重复、熔断过早而远低于目标；通过 **按缺口放宽 stall**、**全重复时同轮多 pass 加急**、**提高 maxRounds** 提升凑满概率（仍无法数学保证）。
2. **检索增强**：在 DeepSeek 主循环前增加 **Agent（智谱 GLM + 联网 + 知识库）** 一轮要点整理，拼入 user 提示；**不落 Agent 会话库**。
3. **可观测性**：Agent **工具调用**通过英语学习 **SSE** 推给前端，进度区展示单行状态。
4. **体验**：IPA（国际音标）展示时 **避免双重斜杠**（模型已带 `/…/` 则不再外包）。
5. **常量集中**：单词 / 经典 **数量上下限、预设、分页、滚动阈值** 抽到 `@/constant`，便于与后端对齐。
6. **非流式 POST**：`vocabulary-pack`、`classic-quotes` 需 **JWT userId** 以启用 Agent 检索（与 SSE 一致）。

---

## 2. 改动范围（路径清单）

| 层级                   | 路径                                                                                                                  |
| ---------------------- | --------------------------------------------------------------------------------------------------------------------- |
| Agent                  | `apps/backend/src/services/agent/agent.service.ts`                                                                    |
| 英语学习控制器         | `apps/backend/src/services/english-learning/english-learning.controller.ts`                                           |
| 英语学习模块           | `apps/backend/src/services/english-learning/english-learning.module.ts`                                               |
| 英语学习服务           | `apps/backend/src/services/english-learning/english-learning.service.ts`                                              |
| 后端文档（既有文更新） | `docs/english/英语学习生成鲁棒性.md`                                                                     |
| 前端常量               | `apps/frontend/src/constant/index.ts`                                                                                 |
| 前端工具聚合           | `apps/frontend/src/utils/index.ts`                                                                                    |
| SSE                    | `apps/frontend/src/utils/englishLearningPackSse.ts`                                       |
| 视图                   | `apps/frontend/src/views/englishLearning/VocabularySection.tsx`、`ClassicQuotesSection.tsx`、`agentToolStatusText.ts` |
| i18n                   | `apps/frontend/src/i18n/locales/zh-CN.ts`、`en-US.ts`                                                                 |

---

## 3. 实现思路（要点）

1. **`gatherContextForEnglishPackResearch`**：独立 system prompt + 单条 `HumanMessage`，`streamEvents` 消费正文与 **`on_tool_start` / `on_tool_end`**；可选 **`onToolEvent`** 回调给英语学习层。
2. **熔断 `resolveStallBreakWithGap`**：`base(count)` + 按 **缺口** `count - accumulated` 加 `bonus`，上限 200；避免「还差很多条」却很快 `break`。
3. **`resolveMaxRounds`**：缓冲轮与总帽加大（2200），给大任务更多外层轮次。
4. **`maxDupPasses`**：已有累积时最多 5 次内层尝试，附 **【紧急】** 段落换一批，再判 stall。
5. **SSE `vocab.agent_tool` / `classic.agent_tool`**：`englishPackToolInputPreview` 截断工具入参，减小 payload。
6. **前端**：`onAgentTool` → `formatEnglishLearningAgentToolLine` → `agentToolLine`；首块 `chunk` 到达后清空工具行。
7. **`displayIpaWrapped`**：统一 IPA 斜杠规则，抽出到 `@/utils` 供单词卡片使用。
8. **`sanitizeCountDigits`**：同步导出到 `@/utils`，与常量一并便于复用。

---

## 4. 关键代码与逐行注释

### 4.1 Agent：`ENGLISH_PACK_RESEARCH_SYSTEM_PROMPT` 与 `gatherContextForEnglishPackResearch`

**来源**：`apps/backend/src/services/agent/agent.service.ts`（约 `HumanMessage` import、`ENGLISH_PACK_RESEARCH_SYSTEM_PROMPT`、`gatherContextForEnglishPackResearch` 方法体）

```typescript
import { HumanMessage } from '@langchain/core/messages';

const ENGLISH_PACK_RESEARCH_SYSTEM_PROMPT = `你是一个只做资料搜集与整理的助手（不向终端用户闲聊）。可使用工具：互联网搜索、知识库检索、当前时间。
任务：根据用户给出的「英语学习主题」与难度说明，检索并汇总与主题强相关的可扩展素材（中文要点），供后续程序生成结构化 JSON 英文词条或经典英文句使用。
要求：
1）优先使用「知识库检索」工具读取用户已入库笔记；必要时使用互联网搜索补充公开事实、领域专有名词、代表性作品与人物（若任务侧重经典语句，尤重可引用的出处线索）。
2）输出用分条列表：与主题相关的领域词与搭配方向、可扩展子话题、重要专名/书名/时代（如能确定）；不要输出 JSON；不要编造检索未验证的细节（无法验证处请写「待查证」）。
3）总字数控制在 1800 汉字以内；不要寒暄与道歉。
4）若工具均无有效结果：给出 5～8 条基于常识的扩展方向，并标注「常识推测」。`;

/**
 * 根据指定主题和难度，调用 Agent 用于检索和整理英语学习相关的素材列表（中文要点）
 * @param params 包含 userId, topic, levelHint, kind 以及可选的工具事件回调 onToolEvent
 * @returns 整理后的正文字符串；失败或无内容时返回空字符串
 */
async gatherContextForEnglishPackResearch(params: {
	userId: number;
	topic: string;
	levelHint: string;
	kind: 'vocabulary' | 'classic_quotes';
	onToolEvent?: (e: {
		phase: 'start' | 'end';
		name?: string;
		input?: unknown;
		output?: unknown;
	}) => void | Promise<void>;
}): Promise<string> {
	const { userId, topic, levelHint, kind, onToolEvent } = params;

	// 对输入主题去除首尾空白、截断 500 字符，防止异常输入导致 prompt 过大
	const trimmedTopic = topic.trim().slice(0, 500);

	// 主题为空时跳过 Agent，直接返回空内容
	if (!trimmedTopic) return '';

	// 设置 90 秒超时，避免长时间无响应导致流程挂死
	const abortController = new AbortController();
	const timeoutMs = 90_000;
	const timer = setTimeout(() => abortController.abort(), timeoutMs);

	// 用于累积模型流式输出的正文内容
	let accumulated = '';

	try {
		// 构建主模型和摘要模型实例，模型参数带 signal 以支持超时中断
		const { main: mainLlm, summary: summaryLlm } = this.buildModels({
			maxTokens: 6144,
			temperature: 0.25,
			signal: abortController.signal,
		});

		// 构建 Agent 工具集，含联网搜索、知识库查询等
		const tools = buildAgentLangChainTools({
			webSearchService: this.webSearchService,
			knowledgeQaService: this.knowledgeQaService,
			userId,
		});

		// 创建 Agent 实例并注入 systemPrompt 和中间件（支持摘要与消耗 tokens 估算）
		const agent = createAgent({
			model: mainLlm,
			tools,
			systemPrompt: ENGLISH_PACK_RESEARCH_SYSTEM_PROMPT,
			middleware: buildAgentLangchainMiddleware({
				summaryLlm: summaryLlm,
				estimatePromptTokens: (msgs) =>
					this.memory.estimatePromptTokens(msgs),
			}),
		});

		// 根据类型确定任务描述（'单词包' 或 '经典语句'），写入用户 prompt
		const taskLabel =
			kind === 'vocabulary'
				? '批量英文单词/短语学习包'
				: '批量英文经典语句、名言金句与地道表达';

		// 拼装输入消息：包含主题、难度描述、任务类型及输出要求（禁 JSON）
		const human = new HumanMessage(
			`主题/需求：${trimmedTopic}\n难度说明：${levelHint}\n任务类型：${taskLabel}\n请按要求调用工具并输出整理后的中文要点列表（不要 JSON）。`,
		);

		// 以流事件的方式启动 agent 任务，便于逐步消费输出，支持 signal 中止
		const eventStream = agent.streamEvents(
			{ messages: [human] },
			{ version: 'v2', signal: abortController.signal },
		);

		// 逐步处理返回的事件，拼接正文、转发工具事件
		for await (const ev of eventStream) {
			if (ev.event === 'on_chat_model_stream') {
				// 流式 chunk 到达，提取文本内容并累加
				const chunk = ev.data?.chunk as AIMessageChunk | undefined;
				const text = extractChunkText(chunk);
				if (text) {
					accumulated += text;
					// 超过 8000 字符强制中断，避免内存与数据膨胀
					if (accumulated.length > 8000) {
						abortController.abort();
						break;
					}
				}
			} else if (ev.event === 'on_tool_start' && onToolEvent) {
				// 工具调用开始事件，转发给可选回调（兼容同步/异步）
				await Promise.resolve(
					onToolEvent({
						phase: 'start',
						name: typeof ev.name === 'string' ? ev.name : undefined,
						input: ev.data?.input,
					}),
				);
			} else if (ev.event === 'on_tool_end' && onToolEvent) {
				// 工具调用结束事件，转发给可选回调，带入输出
				await Promise.resolve(
					onToolEvent({
						phase: 'end',
						name: typeof ev.name === 'string' ? ev.name : undefined,
						input: ev.data?.input,
						output: ev.data?.output,
					}),
				);
			}
		}

		// 清理并获取最终累积的正文内容
		const t = accumulated.trim();
		if (!t) return '';

		// 输出长度过长时最大截断至 3600 字符，并追加 '已截断' 提示，保证后续流程安全
		return t.length > 3600 ? `${t.slice(0, 3600)}\n…（已截断）` : t;
	} catch (e: unknown) {
		// 若不是用户主动作废造成的异常，则输出 warning 日志
		if (!this.isUserAbortError(e)) {
			this.logger.warn?.(
				'[AgentService] gatherContextForEnglishPackResearch failed',
				e,
			);
		}
		// 任意异常都返回空字符串，避免打断后续主流程
		return '';
	} finally {
		// 无论成功与否都释放超时定时器，避免资源泄漏
		clearTimeout(timer);
	}
}
```

| 行 / 逻辑块                                   | 逐行释义                                                                                          |
| --------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| `import { HumanMessage }`                     | 引入 LangChain 人类消息类型，用于无历史的多轮 Agent 首轮输入。                                    |
| `ENGLISH_PACK_RESEARCH_SYSTEM_PROMPT`         | 常量字符串：约束只做检索整理、工具优先级、输出形态（中文列表、禁 JSON）、字数与兜底「常识推测」。 |
| `gatherContextForEnglishPackResearch(params)` | 异步方法：返回整理后的正文字符串；失败返回 `''`。                                                 |
| `onToolEvent` 可选                            | 供英语学习 SSE 转发工具开始/结束事件。                                                            |
| `trimmedTopic`                                | `topic` 去空白并截断 500，降低 prompt 体积与异常输入。                                            |
| `if (!trimmedTopic) return ''`                | 空主题直接跳过 Agent。                                                                            |
| `AbortController` + `90_000`                  | 90 秒超时，防止检索阶段挂死。                                                                     |
| `accumulated`                                 | 拼接模型流式输出正文。                                                                            |
| `buildModels`                                 | 复用聊天 Agent 的智谱 GLM 配置；`signal` 绑定中止。                                               |
| `buildAgentLangChainTools`                    | 注入联网、知识库 RAG、`get_current_datetime`。                                                    |
| `createAgent` + `middleware`                  | 与聊天一致的摘要中间件与 token 估算，限制上下文膨胀。                                             |
| `taskLabel`                                   | 按 `kind` 区分单词包 / 经典句任务描述，写入 user。                                                |
| `HumanMessage(...)`                           | 单轮对话消息：主题 + 难度 + 任务类型 + 输出要求。                                                 |
| `agent.streamEvents`                          | LangChain v2 事件流；带 `signal` 可中断。                                                         |
| `on_chat_model_stream`                        | 抽取 chunk 文本累加；超过 8000 字符中止，防止内存与后续拼接过大。                                 |
| `on_tool_start` / `on_tool_end`               | 若提供 `onToolEvent` 则异步触发（`Promise.resolve` 兼容 sync/async 回调）。                       |
| `phase` / `name` / `input` / `output`         | 与前端 SSE 展示的 phase、工具名、摘要 query 来源一致（SSE 侧主要用 input 摘要）。                 |
| `t.trim()` 与 `3600` 截断                     | 返回给 DeepSeek 的附录长度上限，避免挤爆后续 user prompt。                                        |
| `catch` 返回 `''`                             | 智谱未配置或任意错误时不阻断主流程；非用户中止打 warn。                                           |
| `finally clearTimeout`                        | 清除超时定时器，避免泄漏。                                                                        |

---

### 4.2 英语学习控制器：工具入参摘要、SSE、非流式鉴权

**来源**：`apps/backend/src/services/english-learning/english-learning.controller.ts`（`englishPackToolInputPreview`、`vocabularyPack`、`classicQuotesPack`、`vocabularyPackStream` / `classicQuotesStream` 内 `onAgentTool`）

```typescript
function englishPackToolInputPreview(input: unknown): string | undefined {
	if (input == null) return undefined;
	if (typeof input === "string") return input.trim().slice(0, 240);
	try {
		return JSON.stringify(input).slice(0, 240);
	} catch {
		return undefined;
	}
}
```

| 行                                    | 逐行释义                                |
| ------------------------------------- | --------------------------------------- |
| `input == null`                       | `null`/`undefined` 不传 query。         |
| `typeof input === 'string'`           | 工具入参常为检索字符串，trim 后截 240。 |
| `JSON.stringify(input).slice(0, 240)` | 对象入参序列化后截断，避免 SSE 超大。   |
| `catch return undefined`              | 循环引用等无法序列化时放弃摘要。        |

```typescript
subscriber.next({
	data: {
		type: "vocab.agent_tool",
		streamId,
		phase: ev.phase,
		name: typeof ev.name === "string" ? ev.name : "",
		query: englishPackToolInputPreview(ev.input),
	},
});
```

| 字段                       | 逐行释义                                                                    |
| -------------------------- | --------------------------------------------------------------------------- |
| `type: 'vocab.agent_tool'` | 与前端 `englishLearningPackSse`（`vocab.*` 分支）约定一致；经典句为 `classic.agent_tool`。 |
| `streamId`                 | 与本次流式会话一致，便于前端关联（若需）。                                  |
| `phase`                    | `start` / `end`，驱动「进行中 / 已完成」文案。                              |
| `name`                     | LangChain 工具名，如 `internet_search`、`knowledge_base_retrieval`。        |
| `query`                    | 仅摘要，非完整工具 output，保护带宽与隐私。                                 |

**非流式 POST**：`vocabularyPack` / `classicQuotesPack` 增加 `@Req() req`、`userId` 校验与 `{ userId }` 传入 `generate*`，使离线批量也能走 Agent 检索附录。

---

### 4.3 英语学习模块与服务：类型、`AgentService`、stall、dup pass、检索附录

**来源**：`apps/backend/src/services/english-learning/english-learning.module.ts`（`imports` 增加 `AgentModule`）

| 行            | 逐行释义                                          |
| ------------- | ------------------------------------------------- |
| `AgentModule` | 向 `EnglishLearningService` 注入 `AgentService`。 |

**来源**：`apps/backend/src/services/english-learning/english-learning.service.ts`（类型 `EnglishLearningPackAgentToolEvent`、构造注入、`resolveStallBreakBase` / `resolveStallBreakWithGap` / `resolveMaxRounds`、`runVocabularyGeneration` / `runClassicQuotesGeneration` 中 Agent 附录与 dup pass、`stallLimit`）

```typescript
export type EnglishLearningPackAgentToolEvent = {
	phase: "start" | "end";
	name?: string;
	input?: unknown;
	output?: unknown;
};
```

| 字段               | 逐行释义                                              |
| ------------------ | ----------------------------------------------------- |
| `phase`            | 工具生命周期阶段。                                    |
| `name`             | 工具标识。                                            |
| `input` / `output` | 原始事件载荷；控制器侧主要序列化 `input` 为 `query`。 |

```typescript
private resolveStallBreakBase(count: number): number {
	return Math.max(14, Math.min(100, 8 + Math.ceil(count / 12)));
}

private resolveStallBreakWithGap(count: number, accumulated: number): number {
	const gap = Math.max(0, count - accumulated);
	const bonus = Math.min(120, Math.ceil(gap / 12));
	return Math.min(200, this.resolveStallBreakBase(count) + bonus);
}

private resolveMaxRounds(count: number, itemsPerRound: number): number {
	const base = Math.ceil(count / Math.max(1, itemsPerRound)) + 420;
	return Math.min(2200, base);
}
```

| 行                      | 逐行释义                                                         |
| ----------------------- | ---------------------------------------------------------------- |
| `resolveStallBreakBase` | 目标总量越大，允许的连续「零净增」轮数底线越高；夹在 [14, 100]。 |
| `gap`                   | 尚未收集条数 = `count - accumulated`。                           |
| `bonus`                 | 每约 12 条缺口多容忍 1 轮零净增，`bonus` 上限 120。              |
| `min(200, base+bonus)`  | 全局上限 200，防止极端长时间空转。                               |
| `resolveMaxRounds`      | 估算轮次 +420 缓冲，`min(2200)` 总帽。                           |

**Agent 附录（单词示例逻辑）**：`context?.userId != null` 时调用 `gatherContextForEnglishPackResearch`，`onToolEvent: context.onAgentTool`；非空 `raw` 拼入 `agentResearchAppendix`，附加在 `userBase` 末尾。

**Dup pass（摘录意图）**：

```typescript
const maxDupPasses = accumulated.length === 0 ? 1 : 5;
for (let dupPass = 0; dupPass < maxDupPasses; dupPass++) {
	const urgency =
		dupPass === 0 ? "" : `\n【紧急】上一轮返回的词条全部与已收集列表重复。...`;
	const user = `${userBase}${urgency}`;
	// ... invoke LLM、解析、去重 ...
	if (added > 0) break;
	if (batchItems.length === 0) break;
}
const stallLimit = this.resolveStallBreakWithGap(count, accumulated.length);
if (added === 0) {
	stall++;
	// ...
	if (stall >= stallLimit) {
		/* break */
	}
}
```

| 行             | 逐行释义                                                                        |
| -------------- | ------------------------------------------------------------------------------- |
| `maxDupPasses` | 首轮无累积只尝试 1 次；已有数据时最多 5 次「加急」再打模型。                    |
| `urgency`      | `dupPass>0` 时追加强硬换一批指令。                                              |
| `user`         | `userBase`（含 exclude、diversity、附录）+ `urgency`。                          |
| `stallLimit`   | **每轮重新计算**，随 `accumulated` 增大而阈值动态变化（缺口变小则容忍度降低）。 |

经典句分支：`excludeSnippet` 使用 `seen` 尾部 **160** 条（原 120）；`urgency` 文案针对「句子雷同」。

---

### 4.4 前端常量

**来源**：`apps/frontend/src/constant/index.ts`（约 L45–L75）

```typescript
export const VOCAB_COUNT_MIN = 1;
export const VOCAB_COUNT_MAX = 12000;
export const VOCAB_COUNT_PRESETS = [10, 100, 500, 1000, 3000, 12000] as const;
export const VOCAB_HISTORY_PAGE_SIZE = 20;

export const QUOTE_COUNT_MIN = 1;
export const QUOTE_COUNT_MAX = 6000;
export const COUNT_PRESETS = [10, 100, 500, 1000, 3000, 6000] as const;
export const HISTORY_PAGE_SIZE = 20;
export const SCROLL_LOAD_THRESHOLD_PX = 72;
```

| 符号                                             | 逐行释义                                                                                                                 |
| ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------ |
| `VOCAB_COUNT_*`                                  | 与后端单词 DTO 上限一致；预设末档 12000。                                                                                |
| `VOCAB_COUNT_PRESETS`                            | 单词专用快捷档位（末档 12000）；若页面仍 import `COUNT_PRESETS`（末档 6000），则与单词上限不一致，应以产品为准核对引用。 |
| `QUOTE_COUNT_*` / `COUNT_PRESETS`                | 经典句 6000 上限与快捷档。                                                                                               |
| `HISTORY_PAGE_SIZE` / `SCROLL_LOAD_THRESHOLD_PX` | 历史抽屉分页与触底加载，与知识列表体验对齐。                                                                             |

---

### 4.5 前端 `@/utils`：`sanitizeCountDigits` 与 `displayIpaWrapped`

**来源**：`apps/frontend/src/utils/index.ts`（约 L449–L468）

```typescript
export function sanitizeCountDigits(raw: string): string {
	return raw.replace(/\D/g, "").slice(0, 5);
}

export function displayIpaWrapped(ipa: string): string {
	const s = ipa.trim();
	if (!s) return "";
	if (s.length >= 2 && s.startsWith("/") && s.endsWith("/")) {
		return s;
	}
	return `/${s}/`;
}
```

| 行                   | 逐行释义                                       |
| -------------------- | ---------------------------------------------- |
| `replace(/\D/g, '')` | 去掉非数字，防止输入非法字符。                 |
| `slice(0, 5)`        | 最多 5 位数字，支持输入至 12000。              |
| `displayIpaWrapped`  | trim 后若已 `/…/` 包裹则原样返回；否则包 `/`。 |
| `length >= 2`        | 避免单字符 `/` 被误判为「已包裹」。            |

---

### 4.6 前端 SSE：`vocab.agent_tool` / `classic.agent_tool`

**来源**：`apps/frontend/src/utils/englishLearningPackSse.ts`（`EnglishPackAgentToolEvent`、`EnglishPackStreamCallbacks` 与 `processLine` 内 `` `${tp}agent_tool` `` 分支，约 L102–L259）

| 片段                          | 逐行释义                                        |
| ----------------------------- | ----------------------------------------------- |
| `EnglishPackAgentToolEvent`   | `phase`、`name`、`query` 与后端 payload 对齐（单词与经典句共用类型）。 |
| `onAgentTool?:`               | 可选回调，不设则忽略工具事件。                  |
| `` type === `${tp}agent_tool` `` | `tp` 为 `vocab.` 或 `classic.`；解析 `phase`（默认 `start`）、`name`、`query`。 |
| `return false`                | 不结束 SSE 读取循环（与 progress/chunk 相同）。 |

> 说明：合并前分别在 `englishVocabularySse.ts` / `englishClassicQuotesSse.ts` 中维护；现由 `PackSseDefinition.typePrefix` 驱动，行为等价。

---

### 4.7 `formatEnglishLearningAgentToolLine`

**来源**：`apps/frontend/src/views/englishLearning/agentToolStatusText.ts`（全文约 L1–L25）

| 行                             | 逐行释义                                         |
| ------------------------------ | ------------------------------------------------ |
| `e.name === 'internet_search'` | 映射 i18n「联网搜索」。                          |
| `knowledge_base_retrieval`     | 映射「知识库检索」。                             |
| `get_current_datetime`         | 映射「获取时间」。                               |
| `other`                        | 未知工具名回退显示原始 `name`。                  |
| `querySuffix`                  | 仅在 `phase==='start'` 且有 `query` 时追加摘要。 |
| `statusDone` / `statusDoing`   | 结束与进行中文案模板。                           |

---

### 4.8 视图：`VocabularySection` / `ClassicQuotesSection`

**来源**：`apps/frontend/src/views/englishLearning/VocabularySection.tsx`（import、`agentToolLine` 状态、`onAgentTool` / `onChunk`、IPA 行）

| 片段                                                    | 逐行释义                                                      |
| ------------------------------------------------------- | ------------------------------------------------------------- |
| `sanitizeCountDigits, displayIpaWrapped` from `@/utils` | 数量输入清洗与 IPA 展示统一实现。                             |
| `VOCAB_*` / `COUNT_PRESETS` from `@/constant`           | 校验与快捷按钮数据源。                                        |
| `agentToolLine`                                         | 展示 Agent 工具状态；loading 且 progress 时在进度条上方显示。 |
| `onAgentTool`                                           | `formatEnglishLearningAgentToolLine(t, ev)` 写入状态。        |
| `onChunk` 首包                                          | `setAgentToolLine(null)`，表示已进入 DeepSeek 出词阶段。      |
| `displayIpaWrapped(item.ipa)`                           | 避免 `/ipa/` 重复包裹。                                       |

经典句区块：**紫色主题色**行展示 `agentToolLine`，逻辑对称；常量使用 `QUOTE_*`、`COUNT_PRESETS`、`HISTORY_PAGE_SIZE` 等。

---

### 4.9 i18n

**来源**：`apps/frontend/src/i18n/locales/zh-CN.ts`、`en-US.ts`（`englishLearning.agentTool.*`）

| Key                                   | 逐行释义                |
| ------------------------------------- | ----------------------- |
| `internet` / `knowledge` / `datetime` | 三类内置工具展示名。    |
| `other`                               | `{name}` 占位未知工具。 |
| `querySuffix`                         | 检索摘要后缀模板。      |
| `statusDoing` / `statusDone`          | 进行中 / 已完成句式。   |

---

## 5. 兼容性与影响

- **成本**：Agent 检索 + 多 pass + 更高 stall / round 上限会增加 **LLM 调用次数与延迟**；超时 90s。
- **依赖**：Agent 依赖 **智谱**；失败时附录为空，DeepSeek 主流程仍执行。
- **SSE 契约**：新增事件类型，旧前端忽略未知类型仍可跑；新前端依赖新回调。
- **非流式 POST**：无 token 时 **401**，与控制器其余 Jwt 路由一致。

---

## 6. 建议回归

1. SSE：单词 / 经典各拉一批，观察 **agent_tool** 行是否出现并随 chunk 消失。
2. 大数量（如 300～500）：观察最终条数是否更接近目标、耗时是否可接受。
3. IPA：模型返回 `/x/` 与 `x` 两种，UI 均不出现 `//`。
4. 经典句 exclude 160：重复率高的主题下是否更少提前 stall。

---

## 7. 相关源码路径速查

| 说明           | 路径                                                                            |
| -------------- | ------------------------------------------------------------------------------- |
| Agent 检索     | `apps/backend/src/services/agent/agent.service.ts`                              |
| SSE 与 REST    | `apps/backend/src/services/english-learning/english-learning.controller.ts`     |
| 生成主逻辑     | `apps/backend/src/services/english-learning/english-learning.service.ts`        |
| 前端 SSE       | `apps/frontend/src/utils/englishLearningPackSse.ts` |
| IPA / 数字清洗 | `apps/frontend/src/utils/index.ts`                                              |
| 常量           | `apps/frontend/src/constant/index.ts`                                           |

若与仓库最新源码不一致，以源码为准。
