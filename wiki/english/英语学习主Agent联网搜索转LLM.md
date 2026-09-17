# 英语学习主 Agent：联网检索结果如何进入大模型上下文

本文说明在「单词包 / 经典句」**主 Agent（大脑）检索阶段**中，`internet_search`（Web Search）返回的内容如何进入后续 **Chat 模型调用**的上下文。**若与仓库最新源码不一致，以源码为准。**

---

## 1. 一句话结论

**不是你**在 `runEnglishPackMasterResearchPhase` 里把搜索结果字符串手动拼进下一次 HTTP 请求；而是 **LangChain `createAgent` 的工具调用闭环**：模型发出 **tool call** → 运行时执行 `DynamicTool.func` → 将返回值写入对话里的 **Tool 消息（tool observation）** → **下一轮**模型调用时，整条消息列表（含该 Tool 消息）作为上下文再次送入大模型。

因此：**Web Search 给到大模型的载体，是「工具返回的字符串」→ 框架生成的 Tool 角色消息**，而不是流式事件里单独的一条旁路通道。

---

## 2. 在本仓库中的调用位置

| 环节          | 文件                                                                     | 作用                                                                                             |
| ------------- | ------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------ |
| 主 Agent 编排 | `apps/backend/src/services/english-learning/english-learning.service.ts` | `createAgent` + `streamEvents`，监听模型流式 token 与工具起止（SSE 回调）                        |
| 工具列表组装  | `apps/backend/src/services/agent/agent-tools.ts`                         | `buildAgentLangChainTools`：注入日期、联网、知识库等 `DynamicTool`                               |
| 联网工具实现  | `apps/backend/src/services/web-search/web-search.service.ts`             | `createLangChainWebSearchTools`：定义 `internet_search`，内部调用 `formatSearchContextForPrompt` |
| 结构化结果    | `apps/backend/src/services/web-search/web-search.types.ts`               | `WebSearchContextResult.promptText`：拼好的、可进提示词的文本                                    |

---

## 3. 端到端流程（推荐按顺序理解）

### 3.1 初始化：工具绑定到 Agent

`EnglishLearningService.runEnglishPackMasterResearchPhase` 使用 `buildSiliconFlowPackAgentModels` 得到流式主模型，再调用 `buildAgentLangChainTools` 拿到工具数组，并交给 `createAgent`。

- 385:400:apps/backend/src/services/english-learning/english-learning.service.ts

```ts
const tools = buildAgentLangChainTools({
	webSearchService: this.webSearchService,
	knowledgeQaService: this.knowledgeQaService,
	userId,
});
const agent = createAgent({
	model: mainLlm,
	tools,
	systemPrompt: ENGLISH_PACK_RESEARCH_SYSTEM_PROMPT,
	// 单次检索会话不设 summarizationMiddleware；仅 toolCallLimitMiddleware 限制工具轮次
	middleware: [
		toolCallLimitMiddleware({
			runLimit: 12,
			threadLimit: 12,
			exitBehavior: 'continue',
		}),
	],
});
```

入口用户消息只有一条 `HumanMessage`，主题与难度等在 `userHumanText` 中描述。

- 405:417:apps/backend/src/services/english-learning/english-learning.service.ts

```ts
const userHumanText = `任务类型：${kindLabel}
主题/需求：${topic.trim()}
难度/语境说明：${levelHint.trim()}

请按系统提示调用工具完成检索与核对，然后输出一段简明要点（中文为主，可夹关键英文术语），供下游子模型扩展词条或句子方向使用；不要输出 JSON，不要输出 markdown 代码块。`;
const eventStream = agent.streamEvents(
	{ messages: [new HumanMessage(userHumanText)] },
	{
		version: "v2",
		signal: abortController.signal,
		recursionLimit: 80,
	},
);
```

### 3.2 工具定义：`internet_search` 返回什么？

`WebSearchService.createLangChainWebSearchTools` 注册名为 `internet_search` 的 `DynamicTool`。**关键点：`func` 的返回值（字符串）就是 LangChain 交给 Agent 运行时的「工具输出」，随后会进入对话状态，供模型下一轮阅读。**

- 71:85:apps/backend/src/services/web-search/web-search.service.ts

```ts
return [
	new DynamicTool({
		name: "internet_search",
		description:
			"联网搜索公开网页。输入简洁的检索关键词或问题，返回可引用的网页标题、链接与摘要。" +
			` 当前检索后端为：${provider}。`,
		func: async (input: string) => {
			const r = await this.formatSearchContextForPrompt(
				typeof input === "string" ? input : String(input ?? ""),
				{ provider },
			);
			opts?.onSearchComplete?.(r);
			// 这里会返回一个 markdown 格式的内容，通过 ToolMessage 提供给 agent 的上下文
			return r.promptText ?? "（无检索结果）";
		},
	}),
];
```

`formatSearchContextForPrompt` 统一走 Tavily 或 Serper，得到 `WebSearchContextResult`；其中 **`promptText`** 即面向模型的可读检索摘要（标题、链接、snippet 等由各自 adapter 格式化）。类型定义见：

- 17:23:apps/backend/src/services/web-search/web-search.types.ts

```ts
/** 联网检索结果：供写入提示词、落库与 SSE 推送 */
export interface WebSearchContextResult {
	/** 拼入系统提示的文本；null 表示本轮不追加检索块（未配置或未检索） */
	promptText: string | null;
	/** 热点列表；仅在有有效网页结果时非空 */
	organic: WebSearchOrganicItem[] | null;
}
```

### 3.3 工具列表顺序（以源码为准）

`buildAgentLangChainTools` **当前实现**中，数组顺序为：**日期工具 → `internet_search` → 知识库 RAG 工具**（与文件顶部注释「联网检索 → 知识库」的概括一致，但数组字面量以 `createAgentDateTool()` 开头）。

- 33:43:apps/backend/src/services/agent/agent-tools.ts

```ts
export function buildAgentLangChainTools(
	deps: BuildAgentLangChainToolsDeps,
	opts?: BuildAgentLangChainToolsOpts,
): DynamicTool[] {
	return [
		createAgentDateTool(),
		...deps.webSearchService.createLangChainWebSearchTools({
			onSearchComplete: opts?.onInternetSearchComplete,
		}),
		deps.knowledgeQaService.createAgentKnowledgeRagTool(deps.userId),
	];
}
```

### 3.4 LangChain Agent 内部（概念层，无改仓库依赖）

以下步骤由 **`langchain` 的 `createAgent` / 底层图**完成，本仓库未单独实现：

1. 模型在某一推理步输出 **assistant message**，其中带有 **tool_calls**（例如调用 `internet_search` 及参数）。
2. 运行时根据 tool_calls 执行对应 `DynamicTool.func`，得到 **字符串结果**。
3. 将该结果封装为对话中的一条 **Tool 消息**（与 OpenAI / LangChain 的 tool 协议对齐，含 tool_call_id 等），追加到状态中的 **messages**。
4. **再次调用**主模型时，请求体中的消息序列近似为：  
   `System（systemPrompt）` → `Human（userHumanText）` → … → `Assistant（含 tool_calls）` → `Tool（internet_search 的输出字符串）` → …
5. 模型可基于 Tool 消息继续思考、再次调用工具，或输出最终自然语言答案。

因此：**Web Search 内容进入大模型的路径 = Tool 消息的 content（即 `return r.promptText ?? …` 那一段文本）。**

### 3.5 本文件里的 `streamEvents` 在监听什么？

`runEnglishPackMasterResearchPhase` 中的 `for await` **并没有**把工具输出单独「转发」进模型；它主要做三件事：

1. **`on_chat_model_stream`**：拼接 **模型生成的可见正文 token** 到 `accumulated`，用于最终 `finalizeMasterResearchAppendix`，形成下游用的「检索附录」字符串。
2. **`on_tool_start` / `on_tool_end`**：可选回调 `onToolEvent`，用于 **SSE / 观测**，与「模型上下文注入」无关。
3. 工具返回值进入上下文的过程发生在 Agent **内部状态更新**，不一定表现为你在应用层手写的一次 `invoke`。

对应代码：

- 418:447:apps/backend/src/services/english-learning/english-learning.service.ts

```ts
for await (const ev of eventStream) {
	if (ev.event === "on_chat_model_stream") {
		const chunk = ev.data?.chunk as AIMessageChunk | undefined;
		const text = extractEnglishPackAgentChunkText(chunk);
		if (text) {
			accumulated += text;
			if (accumulated.length > ENGLISH_PACK_MASTER_STREAM_CHAR_FUSE) {
				abortController.abort();
				break;
			}
		}
	} else if (ev.event === "on_tool_start" && onToolEvent) {
		await Promise.resolve(
			onToolEvent({
				phase: "start",
				name: typeof ev.name === "string" ? ev.name : undefined,
				input: ev.data?.input,
			}),
		);
	} else if (ev.event === "on_tool_end" && onToolEvent) {
		await Promise.resolve(
			onToolEvent({
				phase: "end",
				name: typeof ev.name === "string" ? ev.name : undefined,
				input: ev.data?.input,
				output: ev.data?.output,
			}),
		);
	}
}
return this.finalizeMasterResearchAppendix(accumulated);
```

**区分两个「给模型的文本」：**

| 文本来源                 | 进入模型的方式                             | 在本函数中的用途                                                                                                                         |
| ------------------------ | ------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `internet_search` 返回值 | Tool 消息，由 Agent 运行时注入下一轮上下文 | 供模型在对话内部推理使用；可通过 `on_tool_end` 的 `output` 对外观测                                                                      |
| 模型最终回答的正文流     | `on_chat_model_stream` 的 chunk            | 拼成 `accumulated` → `finalizeMasterResearchAppendix` → 得到 `agentResearchAppendix`；在 **JSON 子模型**侧通过 `buildSubModelUserWithOptionalResearchAppendix` **按需**前置到 **user**（线程中已有含 `【检索与知识库要点` 的 Human 则不再重复；`system` 保持固定 JSON 指令以利 **prompt caching**）。与 Chat Agent 不是同一条链路。 |

### 3.6 系统提示如何约束「不要堆砌原始检索」？

主 Agent 使用的 `ENGLISH_PACK_RESEARCH_SYSTEM_PROMPT` 要求模型对工具长结果做归纳，控制最终输出体量（与 Tool 消息是否很长无关——Tool 消息仍可能很长，由检索格式化逻辑与模型行为共同决定）。

- 135:144:apps/backend/src/services/english-learning/english-learning.service.ts

```ts
const ENGLISH_PACK_RESEARCH_SYSTEM_PROMPT = `你是一个只做资料搜集与整理的助手（不向终端用户闲聊）。可使用工具：互联网搜索、知识库检索、当前日期。
任务：根据用户给出的「英语学习主题」与难度说明，检索并汇总与主题强相关的可扩展素材（中文要点），供后续程序生成结构化 JSON 英文词条或经典英文句使用。
要求：
1）必要时使用互联网搜索补充公开事实、领域专有名词、代表性作品与人物（若任务侧重经典语句，尤重可引用的出处线索）。
2）输出用分条列表：与主题相关的领域词与搭配方向、可扩展子话题、重要专名/书名/时代（如能确定）；不要输出 JSON；不要编造检索未验证的细节（无法验证处请写「待查证」）。
3）总字数控制在 1800 汉字以内；不要寒暄与道歉。
4）若工具均无有效结果：给出 5～8 条基于常识的扩展方向，并标注「常识推测」。
5）工具返回（搜索摘要、知识库片段等）可能很长：必须在心中消化后只写入归纳后的要点，禁止把原始搜索结果全文、未裁剪的 RAG 长文或大段复制粘贴进最终答复；若单次检索信息量过大，先分层摘录关键词、搭配方向与可核对出处，再组织成简短条目。
6）最终答复本身必须符合第 3 条字数上限；归纳优先于罗列原材料。`;
```

### 3.7 子模型侧：附录与 token / prompt caching（实现要点）

- **问题**：若将附录放在**每一轮请求**的 `system` 中，则附录随「请求次数」线性计费，且 `system` 前缀不稳定时难以命中缓存。
- **实现**：子模型 **`system`** 始终为**固定**的 JSON 任务说明（单词或经典句各一长串）；**附录**仅在 `packAgentThread` 中**尚未**出现带 `【检索与知识库要点` 的 Human 时，拼到**当前** `user` 开头；首轮之后模型从 `priorThread` 里仍能读到含附录的那条 Human。`trimPackAgentThread` 若裁掉该 Human，`packAgentThreadHasResearchAppendix` 返回 false，下一轮会**再次**前置附录，避免长会话「失忆」。
- **prompt caching**：是否命中、如何计费取决于 **硅基流动**（或所用 OpenAI 兼容网关）是否开启 **cached input** 及是否按前缀哈希；应用侧仅保证 **`system` 各次请求完全一致**、附录不重复塞进 `system`，以**提高**可缓存概率。具体需在厂商文档 / 控制台确认，代码层无需额外 header 即可先享受「更短且稳定的 system」带来的收益。

---

## 4. 与 Chat 场景的差异（便于对照）

- **Chat 主链路**里联网结果还可能承担 **SSE `searchOrganic`、落库角标** 等产品能力，详见 `docs/chat/联网搜索.md`。
- **英语学习主 Agent** 当前关注点更多是：**Tool 返回值 → 模型多步推理 → 最终一段中文要点 → 再交给 JSON 子模型**。两端都复用 `WebSearchService.formatSearchContextForPrompt` / `promptText` 形态，但 **UI 与落库链路不一定相同**。

---

## 5. 小结

1. **给到大模型的 Web Search 正文** = `internet_search` 工具 `func` 返回的字符串（通常来自 `WebSearchContextResult.promptText`）。
2. **注入机制** = LangChain Agent 在 tool call 执行后把该字符串写入 **Tool 消息**，下一轮模型调用自动带上完整对话状态。
3. **`streamEvents` 中的 `on_chat_model_stream`** = 采集模型**最终对用户可见的回答流**，用于生成英语学习下游的「检索附录」，**不是** Tool 结果写入模型的替代路径。

如需扩展行为（例如在工具返回进入模型前统一截断、二次摘要），需要在 **工具 `func` 内**或 **LangChain 中间件 / 自定义节点**中改动；本文档仅描述当前架构下的数据路径。
