# 英语学习 Agent：联网 organic 推送、胶囊 UI 与交互对齐（实现细则）

若与仓库最新源码不一致，以源码为准。

**代码块逐行注释约定**：自 **§4.1** 起，TypeScript/TSX fenced 块内**每一行**均在**行尾**追加 `// …` 中文说明（`/** */` 多行注释可整段保留语义，或改为多行 `//`）；**CSS** 块在**行尾**用 `/* … */` 标注。§5 与 §4 **源码重复**的小节仅保留标题与**互指**（逐行注释以 §4 为准）；§5 **独有**片段仍在本节逐行标注。阅读时可折叠行尾注释或复制到 IDE 后自行删除注释再运行。

## 1. 背景与目标

- **问题**：英语学习路由使用 LangChain Agent（`POST /agent/sse`），若仅有正文流式 `content`，前端助手消息缺少与主 Chat 一致的 **`searchOrganic`**，则无法在正文内把模型输出的 **【n】** 等角标渲染为**胶囊引用**，刷新会话后也丢失结构化来源列表。
- **目标**：
  - 后端：`internet_search` 工具执行完毕后，把 **`organic`**（结构化检索条目）经 SSE 推送，并与本轮助手消息一并写入数据库；
  - 前端：流式阶段合并 `searchOrganic` 到当前助手消息，`hydrateSession` 恢复；复用 **`ChatAssistantMessage`** 的 Markdown 流水线、悬浮预览与 **`SearchOrganics`** 抽屉；
  - UI：英语学习多条气泡使用 **`.message-md-wrap`** 与 Chat 共用胶囊样式；避免 **`<label>` 隐式关联**导致点击正文误开抽屉；引用预览仅在真实引用 **`<a>`** 上触发。

---

## 2. 改动范围（概览）

| 层级 | 路径 | 作用 |
|------|------|------|
| DTO | `apps/backend/src/services/agent/dto/agent-chat.dto.ts` | `assistMode?: 'english_learning'` |
| 实体 | `apps/backend/src/services/agent/agent-message.entity.ts` | `search_organic` JSON |
| 记忆 | `apps/backend/src/services/agent/agent-memory.service.ts` | 读写 `searchOrganic`、`select` |
| 联网 | `apps/backend/src/services/web-search/web-search.service.ts` | `onSearchComplete` |
| 工具 | `apps/backend/src/services/agent/agent-tools.ts` | `onInternetSearchComplete` |
| 服务 | `apps/backend/src/services/agent/agent.service.ts` | 合并、SSE、落库、详情 |
| 控制器 | `apps/backend/src/services/agent/agent.controller.ts` | SSE `map` |
| SSE 客户端 | `apps/frontend/src/utils/agentSse.ts` | `searchOrganic` 解析 |
| Store | `apps/frontend/src/store/englishAgent.ts` | 流式 / hydrate |
| API 类型 | `apps/frontend/src/service/index.ts` | `AgentSessionDetailPayload` |
| 气泡 | `apps/frontend/src/components/design/ChatAssistantMessage/index.tsx` | `bodyText`、预览、抽屉 |
| 视图 | `apps/frontend/src/views/englishLearning/index.tsx` | `message-md-wrap`、非 Label |
| 样式 | `apps/frontend/src/index.css` | `#message-md-wrap`、`.message-md-wrap` |
| 工具 | `apps/frontend/src/utils/splitMarkdownFences.ts` | `patchIncompleteNonMermaidFence`（可选） |
| 引用算法（前端） | `apps/frontend/src/utils/organicCitation.ts` | 占位符、`inject`、`findClosest...` |
| 引用算法（后端落库辅助） | `apps/backend/src/services/web-search/organic-citation.ts` | 直接 `<a>` 版 **`applyOrganicCitationAnchors`**（与前端语义对齐、输出形态不同） |

英语学习路由、单词包 SSE、TTS、后端 `english-learning` 模块等**不在本文逐条展开**，仅在与 Agent organic **交界**处提及。

---

## 3. 端到端数据流（按时间顺序）

下列步骤对应一次用户发送消息、模型中途调用 `internet_search`、再继续生成正文的典型路径。

1. **前端** `englishAgent.sendMessage` 构造请求体：`sessionId`（已有会话）、`content`（含档位行 `[档位：…]` 与可选快捷意图前缀）、**`assistMode: 'english_learning'`**。
2. **后端** `AgentService.runChatStream`：校验或创建会话 → `insertUserAndAssistantPlaceholder` 得到本轮 **`assistantMessageId`** → 构建带 **`onInternetSearchComplete`** 的工具列表 → `createAgent` → `streamEvents` 循环。
3. **模型**决定调用 `internet_search`：
   - LangChain 发出 `on_tool_start` / `on_tool_end`（仍以原有 `type: 'tool'` SSE 下发，供前端展示「调用工具：…」）。
   - 工具 **`func` 内部**：`formatSearchContextForPrompt` → 得到 **`promptText`** 与 **`organic`** → **先**调用 **`onSearchComplete(r)`** → **再** `return promptText` 给模型。
4. **`onInternetSearchComplete`**：`mergeAgentSearchOrganic` 更新 **`turnSearchOrganic`** → `subscriber.next({ type: 'searchOrganic', data: { organic: withAgentOrganicPositions(...) } })`。
5. **前端** `streamAgentSse` 读到该行 JSON：`onSearchOrganic` → **`patchAssistantOrganic`**，当前助手消息的 **`searchOrganic`** 更新为**完整累积列表**（已含 `position`）。
6. **模型流式正文**：`on_chat_model_stream` → `subscriber.next({ type: 'content', data: text })` → 前端 **`patchAssistant`** 追加 `content`。
7. **流结束**：`finalizeTurn` → `updateAssistantContent(sessionId, assistantMessageId, accumulated, organicToSave)`；若正文为空则 **`deleteTurnPair`**，不写 organic。
8. **用户刷新或带 `?session=` 进入**：`getAgentSessionDetail` 返回消息的 **`searchOrganic`** → `hydrateSession` 写入 **`Message`**。

**要点**：organic 的 SSE **早于或穿插于** `content`，前端必须用 **两次独立的 patch**（正文 / organic），避免一条更新覆盖另一条字段。

---

## 4. 分模块实现细节

### 4.1 `AgentChatDto` 与 `assistMode`

**来源**：`apps/backend/src/services/agent/dto/agent-chat.dto.ts`

| 字段 | 细节 |
|------|------|
| `sessionId?` | 可选 UUID；为空时本轮会新建会话并把新 id 隐含在后续逻辑中（由服务内部生成）。 |
| `content` | 必填，最大长度校验；英语学习 Store 会在首行拼 **`[档位：基础|进阶|提高]`**，并可前置 **`pendingIntentPrefix`**。 |
| `assistMode?` | 仅允许 **`english_learning`**（class-validator `@IsIn`）；传入后 **`resolveAgentSystemPrompt`** 在默认 Agent 提示后追加 **英语学习专项约束**（词汇 IPA、短文边界、工具使用建议等）。 |

**与 organic 的关系**：`assistMode` 不直接打开联网；是否检索由模型是否调用 **`internet_search`** 决定。系统提示中会引导模型在引用检索结果时使用 **【1】【2】** 等与摘录序号一致的角标，便于前端把角标替换成胶囊。

实现摘录：

**来源**：`apps/backend/src/services/agent/dto/agent-chat.dto.ts`（约 L14–L48）

```typescript
/** LangChain Agent 流式对话请求体（DTO，数据传输对象）；由 ValidationPipe + class-validator 校验 */
export class AgentChatDto { // 导出类，对应 POST /agent/sse 的 JSON 反序列化目标
  @IsOptional() // 本字段可整体省略
  @IsUUID() // 若出现则必须符合 UUID 字符串格式
  sessionId?: string; // 可选会话主键；有则续写该会话，无则服务端可新建

  @IsString() // content 必须是字符串类型
  @IsNotEmpty() // 去空白后不能为空字符串
  @MaxLength(100_000) // 限制单次正文最大字符，防滥用
  content!: string; // 必填用户输入；英语学习 Store 可能拼档位行、意图前缀后再写入此字段

  @IsOptional() // 标题可省略
  @IsString() // 若带标题须为 string
  @MaxLength(255) // 标题最大长度，便于入库与 UI
  title?: string; // 可选会话标题，新建会话时可用

  @IsOptional() // 模型 maxTokens 可省略走服务端默认
  @IsInt() // 必须是整数
  @Min(256) // 整数下限
  @Max(8192) // 整数上限
  maxTokens?: number; // 传给主模型 maxTokens 参数

  @IsOptional() // temperature 可省略
  @IsNumber() // 允许浮点
  @Min(0) // 温度下界
  @Max(1) // 温度上界
  temperature?: number; // 传给主模型 temperature 参数

  @IsOptional() // assistMode 可省略表示默认 Agent
  @IsIn(['english_learning']) // 白名单校验，防非法枚举注入
  assistMode?: 'english_learning'; // 仅 english_learning 会追加英语系统提示；不直接触发联网或 organic
} // AgentChatDto 类体结束
```

---

### 4.2 `WebSearchService.createLangChainWebSearchTools` 与回调顺序

**来源**：`apps/backend/src/services/web-search/web-search.service.ts`

| 细节点 | 说明 |
|--------|------|
| **`formatSearchContextForPrompt`** | 与 Chat 链路共用：内部根据配置的 provider（Tavily / Serper 等）拉取网页，组装 **`WebSearchContextResult`**：`promptText`（拼进模型上下文的文本）、`organic`（结构化数组，可为 `null` 或空）。 |
| **`onSearchComplete` 调用时机** | 在 **`return r.promptText`** 之前调用 `opts?.onSearchComplete?.(r)`。这样即使返回值后续被 LangChain 包装，**organic 已与本次查询绑定**，无需从 `on_tool_end` 的字符串里反解析。 |
| **`promptText` 为空** | 工具仍返回 `r.promptText ?? '（无检索结果）'`；此时 **`r.organic`** 可能为空；合并逻辑里 **`if (!batch?.length) return`**，不会推送无效 SSE。 |

实现摘录（与仓库一致；缩进与源文件一致为 Tab，阅读时可忽略）：

**来源**：`apps/backend/src/services/web-search/web-search.service.ts`（约 L20–L87）

```typescript
// 以下缩进统一为空格，便于与行尾 // 对齐；逻辑与仓库 Tab 版一致
resolveProvider(override?: WebSearchProvider): WebSearchProvider { // 方法：决定 Tavily 或 Serper
	if (override === 'tavily' || override === 'serper') { // 若调用方显式指定 provider
		return override; // 直接采用，优先级最高
	} // if 结束
	const env = this.configService // 读取 Nest ConfigService 中的环境变量键
		.get<string>(ModelEnum.WEB_SEARCH_DEFAULT_PROVIDER) // 取 WEB_SEARCH_DEFAULT_PROVIDER 配置值
		?.trim() // 去掉首尾空白，避免空格误判
		.toLowerCase(); // 转小写，统一与 'serper' 比较
	if (env === 'serper') { // 环境显式配置为 serper
		return 'serper'; // 返回 serper 枚举字面量
	} // if 结束
	return 'tavily'; // 默认分支：未配置或其它值一律 Tavily
} // resolveProvider 方法结束

async formatSearchContextForPrompt( // 异步：拉取检索并组装上下文结果
	query: string, // 检索查询字符串，来自工具 input
	options?: { provider?: WebSearchProvider; num?: number }, // 可选覆盖 provider 与条数
): Promise<WebSearchContextResult> { // 返回含 promptText 与 organic 的结构体 Promise
	const provider = this.resolveProvider(options?.provider); // 先解析最终 provider
	if (provider === 'tavily') { // Tavily 分支
		return this.tavilySearchService.formatSearchContextForPrompt(query, { // 委托 Tavily 服务
			maxResults: options?.num ?? 10, // Tavily 用 maxResults；缺省 10
		}); // 对象实参结束
	} // if 结束
	return this.serperSearchService.formatSearchContextForPrompt(query, { // Serper 分支委托
		num: options?.num, // Serper 用 num；可为 undefined 走服务默认
	}); // 对象实参结束
} // formatSearchContextForPrompt 方法结束

createLangChainWebSearchTools(opts?: { // 工厂方法：生成 LangChain 工具数组
	provider?: WebSearchProvider; // 可选覆盖本次工具链使用的检索后端
	onSearchComplete?: (result: WebSearchContextResult) => void; // 可选：检索完成回调，含 organic
}): DynamicTool[] { // 返回 DynamicTool 数组供 createAgent 绑定
	const provider = this.resolveProvider(opts?.provider); // 解析本工具实例使用的 provider
	return [ // 数组字面量：当前仅一项工具
		new DynamicTool({ // 构造 LangChain DynamicTool 实例
			name: 'internet_search', // 工具名，模型 function calling 用此 id
			description: // 工具描述，引导模型何时调用
				'联网搜索公开网页。输入简洁的检索关键词或问题，返回可引用的网页标题、链接与摘要。' + // 描述字符串前半
				` 当前检索后端为：${provider}。`, // 模板串拼接当前后端名，便于模型理解环境
			func: async (input: string) => { // 工具执行体：异步返回给模型的字符串
				const r = await this.formatSearchContextForPrompt( // 调用统一检索入口
					typeof input === 'string' ? input : String(input ?? ''), // 归一化 input 为 string
					{ provider }, // 传入本工具解析出的 provider
				); // await 表达式结束
				opts?.onSearchComplete?.(r); // 可选链调用回调，把完整结果 r 交给 Agent
				return r.promptText ?? '（无检索结果）'; // 返回模型可见文本；无摘要时用占位句
			}, // func 箭头函数结束
		}), // DynamicTool 构造结束
	]; // return 数组结束
} // createLangChainWebSearchTools 方法结束
```

---

### 4.3 `buildAgentLangChainTools` 与依赖注入

**来源**：`apps/backend/src/services/agent/agent-tools.ts`

| 细节点 | 说明 |
|--------|------|
| **`BuildAgentLangChainToolsOpts`** | 可选；仅 **`onInternetSearchComplete`** 一项，避免改动原有 `deps` 结构。 |
| **工具顺序** | `internet_search` → 知识库 RAG → `get_current_datetime`；顺序影响模型「先看工具列表」时的倾向，但与 organic 推送无硬耦合。 |
| **闭包** | `onInternetSearchComplete` 在 **`runChatStream`** 内创建，捕获 **`subscriber`** 与 **`turnSearchOrganic`** 引用，因此多次检索共用同一轮状态。 |

实现摘录：

**来源**：`apps/backend/src/services/agent/agent-tools.ts`（约 L18–L44）

```typescript
export type BuildAgentLangChainToolsDeps = { // 类型：组装工具所需的依赖注入形状
  webSearchService: WebSearchService; // 字段：联网服务实例，用于 createLangChainWebSearchTools
  knowledgeQaService: KnowledgeQaService; // 字段：知识库服务，用于创建 RAG 工具
  userId: number; // 字段：当前登录用户 id，传入 RAG 工具做数据隔离
}; // 类型 BuildAgentLangChainToolsDeps 结束

export type BuildAgentLangChainToolsOpts = { // 类型：可选扩展参数
  onInternetSearchComplete?: (result: WebSearchContextResult) => void; // 可选回调：internet_search 完成后携带检索结果
}; // 类型 BuildAgentLangChainToolsOpts 结束

export function buildAgentLangChainTools( // 导出函数：返回绑定好的 DynamicTool 列表
  deps: BuildAgentLangChainToolsDeps, // 形参：依赖对象，含 webSearch、knowledgeQa、userId
  opts?: BuildAgentLangChainToolsOpts, // 形参：可选，含联网完成回调
): DynamicTool[] { // 返回类型：LangChain 动态工具数组
  return [ // 返回数组字面量
    ...deps.webSearchService.createLangChainWebSearchTools({ // 展开：联网工具可能返回多项，此处仅一项
      onSearchComplete: opts?.onInternetSearchComplete, // 属性：把 Agent 命名映射为 WebSearch 回调名
    }), // createLangChainWebSearchTools 调用结束
    deps.knowledgeQaService.createAgentKnowledgeRagTool(deps.userId), // 元素：知识库检索工具，注入 userId
    createAgentDatetimeTool(), // 元素：返回当前 UTC 时间的工具
  ]; // 数组结束
} // 函数 buildAgentLangChainTools 结束
```

---

### 4.4 `mergeAgentSearchOrganic`（按 link 去重）

**来源**：`apps/backend/src/services/agent/agent.service.ts`（模块级函数）

| 细节点 | 说明 |
|--------|------|
| **键** | `(item.link ?? '').trim()`；空字符串视为无效，**跳过入队**且不加入 `seen`。 |
| **稳定性** | 先保留 **`prev` 顺序**，再把 batch 中**未见过的 link** 依次 `push`；同一 URL 第二次出现不会打乱已有条目的序号对应关系（【n】与 `organic[n-1]`）。 |
| **空 batch** | `!batch?.length` 时直接返回 `prev`，避免无意义 SSE。 |

实现摘录（含 §4.5 的 **`withAgentOrganicPositions`**，同一文件连续片段）：

**来源**：`apps/backend/src/services/agent/agent.service.ts`（约 L56–L80）

```typescript
function mergeAgentSearchOrganic( // 模块级函数：合并 organic 列表并按 URL 去重
  prev: WebSearchOrganicItem[], // 形参：已累积的上一轮 organic 数组
  batch: WebSearchOrganicItem[] | null | undefined, // 形参：本轮工具返回的新批次，可为空
): WebSearchOrganicItem[] { // 返回：合并后的新数组引用或原 prev
  if (!batch?.length) return prev; // 短路：无新数据则直接返回旧数组引用
  const seen = new Set( // 新建 Set：存放已出现过的规范化 URL 字符串
    prev.map((x) => (x.link ?? '').trim()).filter((k) => k.length > 0), // 从 prev 提取非空 link 作为初始 seen
  ); // Set 构造结束
  const out = [...prev]; // 浅拷贝 prev 到新数组，后续只改 out
  for (const item of batch) { // 遍历本批每条 organic
    const k = (item.link ?? '').trim(); // 当前条目的规范化 URL 键
    if (!k || seen.has(k)) continue; // 跳过空 URL 或已存在 URL
    seen.add(k); // 将新 URL 记入集合，防后续重复
    out.push({ ...item }); // 追加当前项的浅拷贝，保持对象独立
  } // for 结束
  return out; // 返回合并结果
} // mergeAgentSearchOrganic 结束

function withAgentOrganicPositions( // 模块级函数：为每条 organic 写入 position 字段
  items: WebSearchOrganicItem[], // 形参：已去重合并后的列表
): SerperOrganicItem[] { // 返回：带 position 的 Serper 形状数组
  return items.map((item, i) => ({ ...item, position: i + 1 })); // 映射：下标 i 转为 1-based position
} // withAgentOrganicPositions 结束
```

---

### 4.5 `withAgentOrganicPositions`

**来源**：同上

| 细节点 | 说明 |
|--------|------|
| **语义** | `position: i + 1`（**1-based**），与 Chat 侧 Serper organic、`SearchOrganicItem.position` 一致。 |
| **推送与落库** | **每次**合并后推送的都带完整列表的重算 position；落库同样保存带 position 的数组，前端抽屉与角标 **【n】** 均按 **1-based** 理解。 |

**实现摘录**：见 **§4.4** 文末代码块中的 **`withAgentOrganicPositions`**。

---

### 4.6 `runChatStream` 内状态与收尾

**来源**：`apps/backend/src/services/agent/agent.service.ts`

| 变量 / 函数 | 细节 |
|-------------|------|
| **`turnSearchOrganic`** | 本轮从第一次 `internet_search` 完成开始累积，直到该轮 `runChatStream` 结束；**不会**跨用户下一轮请求泄漏（函数局部变量）。 |
| **`finalizeTurn`** | 条件：`accumulated.trim()` 为空 → **`deleteTurnPair`**（用户消息 + 空助手占位一并删）；非空 → **`updateAssistantContent(..., organicToSave)`**，其中 `organicToSave` 为 **`null`**（无检索）或 **`withAgentOrganicPositions(turnSearchOrganic)`**。 |
| **`cleanupTurnOnFailure`** | 异常或中断时：若有正文则同样写入 **content + organicToSave**；若无正文则删 turn；避免「占位助手」残留在库里。 |
| **epoch / abort** | `incrementStreamEpoch` + `abortController` 终止旧流时，已在飞行中的 **`subscriber.next`** 仍可能发生；前端应以 **会话 / 消息 id** 与 **本地 isStreaming** 做好 UX，后端以 DB 最终一致为准。 |

实现摘录（organic 相关局部；完整 **`for await`** 循环见仓库同方法）：

**来源**：`apps/backend/src/services/agent/agent.service.ts`（`runChatStream` 内，约 L362–L427、L479–L501）

```typescript
let accumulated = ''; // 局部变量：拼接本轮助手流式输出的可见文本
let turnSearchOrganic: WebSearchOrganicItem[] = []; // 局部变量：累积本轮所有 internet_search 的 organic
// 注：streamSessionId、assistantMessageId、activeTurnId、session 等在同函数上文声明，此处省略

const finalizeTurn = async () => { // 常量：异步函数，供流正常结束时调用
  if (!streamSessionId || !activeTurnId || !assistantMessageId || !session) { // 若关键 id 或 session 缺失
    return; // 则无法落库，直接返回避免抛错
  } // if 结束
  if (!accumulated.trim()) { // 若助手正文去掉空白后为空
    await this.memory.deleteTurnPair(streamSessionId, activeTurnId); // 删除本轮 user+assistant 两行占位
    return; // 结束 finalize，不再写空助手内容
  } // if 结束
  const organicToSave = // 声明：准备写入 DB 的 organic 列值
    turnSearchOrganic.length > 0 // 若本轮曾合并出至少一条 organic
      ? withAgentOrganicPositions(turnSearchOrganic) // 则补全 position 后作为数组保存
      : null; // 否则显式 null，表示无联网快照
  await this.memory.updateAssistantContent( // 等待：更新助手消息行
    streamSessionId, // 实参：会话 id
    assistantMessageId, // 实参：助手消息主键
    accumulated, // 实参：完整助手正文
    organicToSave, // 实参：organic 列三态之一
  ); // updateAssistantContent 调用结束
}; // finalizeTurn 函数体结束

const cleanupTurnOnFailure = async () => { // 常量：异常路径收尾函数
  if (!streamSessionId || !activeTurnId || !assistantMessageId) { // 缺任一关键 id
    return; // 无法安全清理，直接返回
  } // if 结束
  try { // try：捕获收尾写库自身抛错
    if (accumulated.trim()) { // 若已有部分助手正文
      const organicToSave = // 声明：与 finalizeTurn 相同逻辑
        turnSearchOrganic.length > 0 // 有 organic
          ? withAgentOrganicPositions(turnSearchOrganic) // 则带 position 保存
          : null; // 否则 null
      await this.memory.updateAssistantContent( // 尽力保存中断前已生成内容与 organic
        streamSessionId, // 会话 id
        assistantMessageId, // 助手消息 id
        accumulated, // 已生成正文
        organicToSave, // organic 快照
      ); // await 结束
    } else { // 若正文仍为空
      await this.memory.deleteTurnPair(streamSessionId, activeTurnId); // 删除空占位 turn
    } // if-else 结束
  } catch (cleanupErr: unknown) { // 捕获收尾失败
    this.logger.error?.('[AgentService] 本轮消息收尾失败', cleanupErr); // 打日志，不向外再抛避免掩盖原错误
  } // catch 结束
}; // cleanupTurnOnFailure 结束

const tools = buildAgentLangChainTools( // 常量：工具数组，闭包引用下方 subscriber
  { // 第一个实参：deps 对象字面量
    webSearchService: this.webSearchService, // 属性：注入的 WebSearchService 单例
    knowledgeQaService: this.knowledgeQaService, // 属性：知识库服务
    userId, // 属性简写：等价 userId: userId，来自方法参数
  }, // deps 对象结束
  { // 第二个实参：opts 对象字面量
    onInternetSearchComplete: (r) => { // 属性：联网完成回调，参数 r 为检索上下文结果
      const batch = r.organic; // 从结果中取出 organic 数组字段
      if (!batch?.length) return; // 无条目则返回，不推 SSE
      turnSearchOrganic = mergeAgentSearchOrganic(turnSearchOrganic, batch); // 合并进本轮累积
      subscriber.next({ // 向 Observable 订阅者推送一条 searchOrganic 事件
        type: 'searchOrganic', // 字面量：事件类型标识
        data: { // 载荷对象
          organic: withAgentOrganicPositions(turnSearchOrganic), // 当前全集带 position
        }, // data 结束
      }); // next 调用结束
    }, // 回调函数结束
  }, // opts 对象结束
); // buildAgentLangChainTools 调用结束
```

---

### 4.7 `AgentSseChunk` 与控制器序列化形状

**来源**：`apps/backend/src/services/agent/agent.service.ts`、`agent.controller.ts`

| `chunk.type` | 序列化后 `data` 形状（逻辑上） | 说明 |
|----------------|-------------------------------|------|
| `content` | `{ type: 'content', content: string, done: false }` | 与早期 Agent SSE 一致。 |
| `tool` | `{ type: 'tool', raw: { phase, name?, ... }, done: false }` | `content` 为 `undefined`。 |
| **`searchOrganic`** | **`{ type: 'searchOrganic', organic: SerperOrganicItem[], done: false }`** | **不与** `content` / `raw` 混在同一形状里单独分支，避免前端误判。 |

NestJS `@Sse()` 封装下，客户端收到的仍是 **`data: JSON`** 行；前端 **`unwrapAgentPayload`** 负责兼容 **`{ data: { ... } }`** 与扁平对象。

实现摘录：

**来源**：`apps/backend/src/services/agent/agent.service.ts`（`AgentSseChunk`，约 L113–L125）、`apps/backend/src/services/agent/agent.controller.ts`（`chatSse` 内 `map`，约 L85–L104）

```typescript
export type AgentSseChunk = // 导出联合类型：描述 AgentService.chatStream 发出的每一种 chunk
  | { type: 'content'; data: string } // 成员：正文增量，data 为纯字符串片段
  | { // 成员：工具生命周期事件
      type: 'tool'; // 字面量类型字段：固定为 tool
      data: { // 嵌套对象：工具元数据
        phase: 'start' | 'end'; // 枚举：工具开始或结束阶段
        name?: string; // 可选工具名，如 internet_search
        input?: unknown; // 可选入参，序列化给前端调试
        output?: unknown; // 可选出参，可能较大
      } // data 对象类型结束
    } // tool 成员对象类型结束
  | { type: 'searchOrganic'; data: { organic: SerperOrganicItem[] } }; // 成员：结构化检索列表事件

const source$ = this.agentService.chatStream(userId, dto).pipe( // 声明：把服务 Observable 接上 rxjs 管道
  map((chunk) => { // 运算符：对每个 AgentSseChunk 做一层 JSON 形状转换
    if (chunk.type === 'searchOrganic') { // 若当前为 organic 事件
      return { // 返回包装对象，供 @Sse 序列化为 MessageEvent.data
        data: { // Nest 期望的外层 data 字段
          type: 'searchOrganic', // 冗余 type 便于前端与 content 区分
          organic: chunk.data.organic, // 从服务 chunk 取出 organic 数组透传
          done: false, // 显式标记非结束帧
        }, // 内层 data 结束
      }; // return 对象结束
    } // if 结束
    return { // 其它类型 chunk 走统一外壳
      data: { // 内层 data
        type: chunk.type, // 透传 chunk 类型字符串
        content: chunk.type === 'content' ? chunk.data : undefined, // 仅 content 时填正文，否则 undefined
        raw: chunk.type === 'tool' ? chunk.data : undefined, // 仅 tool 时填 raw，否则 undefined
        done: false, // 同样标记进行中
      }, // 内层 data 结束
    }; // return 对象结束
  }), // map 回调结束
); // pipe 调用结束
```

---

### 4.8 实体 `AgentMessage.searchOrganic`

**来源**：`apps/backend/src/services/agent/agent-message.entity.ts`

| 细节点 | 说明 |
|--------|------|
| **列名** | `search_organic`，TypeORM `type: 'json'`，**nullable**。 |
| **类型** | `SerperOrganicItem[] | null`，与 `web-search.types` 一致（含 `title`、`link`、`snippet?`、`icon?`、`date?`、`position?`）。 |
| **用户消息** | 同一表角色含 user/assistant；用户行该列一般为 **`null`**（未强制业务校验）。 |

**运维**：数据库必须有对应列；缺失时 TypeORM 查询会报 **`Unknown column 'search_organic'`**。

实现摘录（列定义；完整装饰器与 `session` 关联见源文件）：

**来源**：`apps/backend/src/services/agent/agent-message.entity.ts`（约 L18–L52）

```typescript
@Entity('agent_messages') // 装饰器：绑定数据库表名 agent_messages
@Index('idx_agent_msg_session_created', ['session', 'createdAt']) // 复合索引：按会话+时间查列表
@Index('idx_agent_msg_session_turn', ['session', 'turnId']) // 复合索引：按会话+turn 删成对消息
export class AgentMessage { // 导出实体类，映射一行 agent_messages
  @PrimaryGeneratedColumn('uuid') // 主键：UUID 自动生成
  id: string; // 属性：消息主键字符串

  @Column({ // 列：枚举角色
    type: 'enum', // 数据库枚举类型
    enum: AgentMessageRole, // TypeScript 枚举与 DB 枚举对齐
  }) // @Column 参数对象结束
  role: AgentMessageRole; // 属性：user 或 assistant

  @Column({ name: 'turn_id', type: 'varchar', length: 36, nullable: true }) // 列：一轮对话 id，可空
  turnId: string | null; // 属性：UUID 字符串或 null

  @Column({ type: 'longtext' }) // 列：大文本存 Markdown 或用户原文
  content: string; // 属性：消息正文

  @Column({ name: 'search_organic', type: 'json', nullable: true }) // 列：JSON 存 organic 数组，可空
  searchOrganic: SerperOrganicItem[] | null; // 属性：结构化检索快照；用户行多为 null

  @CreateDateColumn({ name: 'created_at', type: 'timestamp' }) // 列：插入时间由 DB/ORM 维护
  createdAt: Date; // 属性：创建时间
} // 类 AgentMessage 结束
```

---

### 4.9 `AgentMemoryService.updateAssistantContent` 三态

**来源**：`apps/backend/src/services/agent/agent-memory.service.ts`

| `searchOrganic` 实参 | 行为 |
|---------------------|------|
| **`undefined`** | **不修改**列：patch 仅 `{ content }`。用于未来「只更新正文」的调用（当前 Agent 收尾总会传入明确值）。 |
| **`null`** | 将列更新为 **`NULL`**：表示本轮明确「无 organic」。 |
| **数组** | 写入 JSON；通常为非空带 `position` 的列表。 |

同步 **`session.updatedAt`**，保证会话列表排序感知最近活动。

实现摘录：

**来源**：`apps/backend/src/services/agent/agent-memory.service.ts`（`updateAssistantContent`，约 L223–L242）

```typescript
async updateAssistantContent( // 异步方法：更新助手消息正文及可选 organic 列
  sessionId: string, // 形参：所属会话 id
  assistantMessageId: string, // 形参：助手消息行主键
  content: string, // 形参：本轮最终助手正文
  searchOrganic?: SerperOrganicItem[] | null, // 可选形参：undefined 不改列；null 清空；数组写入
): Promise<void> { // 返回：Promise 无业务返回值
  const now = new Date(); // 局部：当前时间戳，用于会话 updatedAt
  const patch: { // 局部：声明 patch 对象类型，便于条件加入 searchOrganic
    content: string; // 类型成员：content 必含
    searchOrganic?: SerperOrganicItem[] | null; // 类型成员：可选 organic 字段
  } = { content }; // 初始化：至少写入 content
  if (searchOrganic !== undefined) { // 若调用方显式传入 organic 参数（含 null）
    patch.searchOrganic = searchOrganic; // 则把该值并入 patch，触发列更新或置 NULL
  } // if 结束
  await Promise.all([ // 并行等待两个 update，减少往返延迟
    this.messageRepo.update({ id: assistantMessageId }, patch), // 更新消息行
    this.sessionRepo.update({ id: sessionId }, { updatedAt: now }), // 更新会话最近活动时间
  ]); // Promise.all 结束
} // updateAssistantContent 结束
```

---

### 4.10 `listMessagesAsc` 与 `getSessionDetail`

**来源**：`agent-memory.service.ts`、`agent.service.ts`（`getSessionDetail`）

| 细节点 | 说明 |
|--------|------|
| **`select`** | 必须包含 **`searchOrganic`**；若漏选，TypeORM 不会填充该字段，详情接口永远 **`undefined`**。 |
| **映射** | `messages.map` 时 **`searchOrganic: m.searchOrganic ?? null`**，JSON 列在 JS 侧可能是 `null`。 |

实现摘录：

**来源**：`apps/backend/src/services/agent/agent-memory.service.ts`（`listMessagesAsc`，约 L254–L266）、`apps/backend/src/services/agent/agent.service.ts`（`getSessionDetail` 内 `messages.map`，约 L241–L257）

```typescript
async listMessagesAsc( // 异步：按会话拉取消息升序列表
  sessionId: string, // 形参：会话主键
): Promise< // 返回：Promise 包裹的精简消息数组
  Pick< // 工具类型：从 AgentMessage 抽取字段子集
    AgentMessage, // 源实体类型
    'id' | 'turnId' | 'role' | 'content' | 'searchOrganic' | 'createdAt' // 字面量联合：需要的列名
  >[] // 数组：多条消息
> { // 返回类型注解结束
  return this.messageRepo.find({ // 调用 TypeORM Repository.find
    where: { session: { id: sessionId } }, // 条件：属于该 session 外键
    order: { createdAt: 'ASC' }, // 排序：时间从早到晚
    select: ['id', 'turnId', 'role', 'content', 'searchOrganic', 'createdAt'], // 投影：必须含 searchOrganic
  }); // find 参数结束
} // listMessagesAsc 结束

messages: messages.map((m) => ({ // 对象属性：对 ORM 结果逐条映射为 API DTO
  id: m.id, // 字段：消息 id
  turnId: m.turnId, // 字段：turn id，可 null
  role: m.role, // 字段：角色枚举字符串
  content: m.content, // 字段：正文
  searchOrganic: m.searchOrganic ?? null, // 字段：undefined 统一成 null 便于 JSON 序列化
  createdAt: m.createdAt, // 字段：创建时间
})), // map 回调与 messages 属性结束
```

---

### 4.11 前端 `streamAgentSse`

**来源**：`apps/frontend/src/utils/agentSse.ts`

| 细节点 | 说明 |
|--------|------|
| **按行解析** | SSE `data:` 行拼接 **`buffer`**，`\n` 分割；不完整行留在 buffer。 |
| **`unwrapAgentPayload`** | 若 `raw.data` 为对象且含有 `type` / `done` / `content` / `error` / `raw` / **`organic`** 任一键，则视为内层载荷返回；否则返回外层。兼容 Nest 与直连写法。 |
| **处理顺序** | 先 **`error`** → **`done`** → **`content`** → **`searchOrganic`** → **`tool`**；保证终止帧优先。 |
| **`onSearchOrganic`** | 仅在 **`parsed.type === 'searchOrganic'` 且 `organic` 为数组** 时调用；不做深度校验（信任后端）。 |

实现摘录：

**来源**：`apps/frontend/src/utils/agentSse.ts`（约 L19–L38、L40–L48、解析循环内 `searchOrganic` 分支）

```typescript
// 解包 Nest @Sse 常见外层 { data: 内层 }；内层若已含 type/done/content 等键则视为真实载荷
function unwrapAgentPayload( // 函数：输入原始 JSON 对象，返回剥壳后的载荷对象
  raw: Record<string, unknown>, // 参数：SSE 单行反序列化后的最外层对象
): Record<string, unknown> { // 返回：与后续 parsed 分支一致的字典形状
  const inner = raw.data; // 取常见嵌套字段 data（可能为 undefined）
  if (inner && typeof inner === 'object' && !Array.isArray(inner)) { // data 存在且为「非数组对象」才可能继续判断
    const o = inner as Record<string, unknown>; // 断言为 Record 便于 `in` 运算符
    if ( // 以下任一成立则认为内层已是 Agent 事件体，应丢弃外层包装
      'type' in o || // 含事件类型字段
      'done' in o || // 含结束标记
      'content' in o || // 含正文增量字段
      'error' in o || // 含错误字段
      'raw' in o || // 含工具 raw 字段
      'organic' in o // 含 searchOrganic 扁平后的 organic 数组字段
    ) {
      return o; // 返回内层对象供主循环按 type 分发
    }
  }
  return raw; // 否则保持原对象（直连或其它网关形态）
}

export interface AgentSseCallbacks { // 导出：streamAgentSse 的回调集合类型
  onDelta: (text: string) => void; // 必填：正文 token 或片段增量
  onTool?: (ev: { phase: 'start' | 'end'; name?: string }) => void; // 可选：工具调用起止 UI
  onStart?: () => void; // 可选：首包或连接就绪
  onComplete?: (error?: string) => void; // 可选：流结束；参数为可选错误文案
  onError?: (err: Error) => void; // 可选：解析或网络异常
  onSearchOrganic?: (organic: SearchOrganicItem[]) => void; // 可选：整表替换当前助手 searchOrganic
}

if ( // 主解析循环内片段：须在 error/done/content 等分支之后判断，顺序见源文件
  parsed.type === 'searchOrganic' && // 事件类型为联网来源快照
  Array.isArray(parsed.organic) // 且 organic 必须为数组（信任后端契约）
) {
  onSearchOrganic?.(parsed.organic as SearchOrganicItem[]); // 可选回调：把列表交给 Store patch
  continue; // 本行已消费，跳过后续 content/tool 等分支
}
```

**`readLoop` 主循环**（`buffer` 行缓冲、`data:` 切分、`JSON.parse`、`error` → `done` → `content` → `searchOrganic` → `tool` 顺序）：见 **§5.21** 实现摘录，已行尾逐行注释。

---

### 4.12 `englishAgentStore`

**来源**：`apps/frontend/src/store/englishAgent.ts`

| 细节点 | 说明 |
|--------|------|
| **`sendMessage`** | 先发两条本地消息：user（展示用 **`userText`**）+ assistant（`content: ''`，**`isStreaming: true`**，`chatId` 为客户端 **`uuid`**）。 |
| **`patchAssistant`** | 只改 **`content`**，展开 `{ ...prev }` 保留 **`searchOrganic`**。 |
| **`patchAssistantOrganic`** | 只改 **`searchOrganic`**，保留已累积的 **`content`**。二者缺一不可，否则会出现「来了 organic 清空正文」或反之。 |
| **`assistMode`** | 写死在 `streamAgentSse` body：**`'english_learning'`**。 |
| **`hydrateSession`** | `chatId: m.id` 使用**服务端消息 id**；与本地新建的 uuid **不混用**（新会话首次发送仍走客户端 id，刷新后以服务端为准）。 |
| **`searchOrganic: m.searchOrganic ?? undefined`** | 兼容 `null` / 缺失；MobX 消息对象上可选字段。 |

实现摘录：

**来源**：`apps/frontend/src/store/englishAgent.ts`（`hydrateSession` 映射、`sendMessage` 内 `patchAssistant` / `patchAssistantOrganic`，约 L87–L114、L227–L265）

```typescript
async hydrateSession(sessionId: string): Promise<void> { // 用服务端会话详情覆盖本地 MobX 列表
  const res = await getAgentSessionDetail(sessionId); // HTTP GET：拉取会话元数据与消息数组
  const payload = res.data; // 解包 axios/封装返回的 data 载荷
  const sess = payload?.session; // 会话摘要；可能为 null（无权或不存在）
  if (!sess) { // 与源码一致：无会话则写 loadError 并清空列表后 return（此处从略）
    return; // 仅占位：完整分支见 englishAgent.ts
  }
  runInAction(() => { // MobX：批量修改 observable 须在 action 内
    this.sessionId = sess.sessionId; // 写入当前会话 id 供后续 sendMessage 复用
    this.sessionTitle = sess.title; // 同步标题到 UI
    this.messages = (payload.messages ?? []).map((m) => ({ // 每条 HTTP 消息映射为前端 Message
      chatId: m.id, // 关键：与服务端主键一致，避免与流式阶段客户端 uuid 混用
      role: m.role === 'user' ? 'user' : 'assistant', // 归一化角色字面量
      content: m.content, // 助手正文可能含【n】与 Markdown
      searchOrganic: m.searchOrganic ?? undefined, // JSON null 转 undefined，符合 MobX 可选字段习惯
      timestamp: new Date(m.createdAt), // ISO 字符串转 Date
      isStreaming: false, // 历史消息均非流中状态
    })); // map 结束
  }); // runInAction 结束
}

const patchAssistant = (delta: string) => { // 闭包：仅合并正文增量到当前助手气泡
  if (delta) accumulated += delta; // 有增量才累加本地 accumulated 缓冲
  runInAction(() => { // 写 messages 数组须 action
    const idx = this.messages.findIndex((m) => m.chatId === assistantChatId); // 按本轮助手 chatId 定位下标
    if (idx < 0) return; // 未找到则放弃（可能消息已被移除）
    const prev = this.messages[idx] as Message; // 取出旧对象以保留 searchOrganic 等字段
    this.messages[idx] = { ...prev, content: accumulated }; // 展开 prev 再覆盖 content，禁止丢 organic
  }); // runInAction 结束
}; // patchAssistant 结束

const patchAssistantOrganic = (organic: SearchOrganicItem[]) => { // 闭包：只更新结构化来源列表
  runInAction(() => { // 同上
    const idx = this.messages.findIndex((m) => m.chatId === assistantChatId); // 同一助手行
    if (idx < 0) return; // 未找到则返回
    const prev = this.messages[idx] as Message; // 保留已有 content、isStreaming 等
    this.messages[idx] = { ...prev, searchOrganic: organic }; // 整表替换为 SSE 推送的全量列表
  }); // runInAction 结束
}; // patchAssistantOrganic 结束
```

---

### 4.13 `ChatAssistantMessage`：`bodyText` 流水线

**来源**：`apps/frontend/src/components/design/ChatAssistantMessage/index.tsx`

对 **`message.content`** 的处理顺序（有 `searchOrganic` 时）：

1. **`normalizePersistedOrganicAnchorsInMarkdown`**：若历史正文里已有后端写入的 **`<a data-organic-cite="n">`**，先转成内部占位符 **`〔cite:n〕`**，以便重新走 Markdown（避免 md-it `html: false` 把标签当文本）。
2. **`applyOrganicCitationAnchors`**：把 **`【n】`**、`[n](url)`（url 与 organic 匹配时）、裸 **`[n]`** 等转为 **`〔cite:n〕`**。
3. **`StreamingMarkdownBody`**：`parser.render` 得到 HTML，再 **`injectOrganicCitationAnchorsIntoMarkdownHtml`**：把占位符替换为真实 **`<a href target rel class="__md-search-organic__" data-organic-cite="n">`**（可能合并连续占位符为 **`data-organic-cite-group`**）。

| 细节点 | 说明 |
|--------|------|
| **`enableMermaid: false`** | 主 MarkdownParser 不渲染 mermaid；mermaid 由 **`StreamingMarkdownBody`** 拆岛处理，避免与围栏逻辑冲突。 |
| **`patchIncompleteNonMermaidFence`** | 注释状态下一行若启用：在步骤 1 前修补未闭合 **非 mermaid** 围栏，减轻「正文被吃进 code」问题。 |
| **`isSearchOrganicEnabled`** | `message.searchOrganic?.length > 0` → 给 **`StreamingMarkdownBody`** 加 **`__md-search-enabled__`**，激活胶囊样式与注入函数。 |

实现摘录：

**来源**：`apps/frontend/src/components/design/ChatAssistantMessage/index.tsx`（约 L204–L230、L519–L536）

```typescript
const bodyText = useMemo(() => { // 派生 Markdown 输入串：占位符阶段，不含最终 <a>
  const thinkingText = t?.('chat.assistant.thinking') ?? '思考中...'; // i18n 思考中文案或默认
  let raw = message.content || (message?.thinkContent ? '' : thinkingText); // 无正文时用思考占位或空串
  const org = message.searchOrganic; // 当前消息的联网来源列表引用
  if (raw === thinkingText) { // 若仍显示思考占位串
    return raw; // 跳过角标与占位符替换，避免误伤占位文案
  }
  // raw = patchIncompleteNonMermaidFence(raw); // 可选：见 §4.18，防未闭合围栏吞正文
  raw = normalizePersistedOrganicAnchorsInMarkdown(raw, org); // 历史 HTML 角标 →〔cite〕或【n】
  if (!org?.length) { // 无结构化来源则不做【n】→〔cite〕
    return raw; // 直接返回（可能仍含未替换的【n】）
  }
  return applyOrganicCitationAnchors(raw, org); // 有 organic：Markdown 串上生成〔cite:n〕
}, [message.content, message.thinkContent, message.searchOrganic, t]); // 依赖：任一变化重算 bodyText

const isSearchOrganicEnabled = (message.searchOrganic?.length ?? 0) > 0; // 布尔：是否启用胶囊样式与注入

const injectSearchOrganicAnchorsHtml = useCallback( // 稳定回调引用，避免子组件无谓重渲染
  (html: string) => // 入参：markdown-it 对某一 Markdown 岛渲染出的 HTML 片段
    injectOrganicCitationAnchorsIntoMarkdownHtml( // 把〔cite〕换成 <a data-organic-cite>
      html, // 当前片段 HTML
      message.searchOrganic ?? [], // 缺省用空数组，inject 内会短路
    ), // inject 调用结束
  [message.searchOrganic], // 仅 organic 列表变时重建函数
); // useCallback 结束

<StreamingMarkdownBody // 子组件：mermaid 与普通 Markdown 分岛渲染
  containerRef={bodyMarkdownRef} // 与 pointer 监听根一致
  markdown={bodyText} // 上一步产出的 Markdown 源串
  parser={chatMdParser} // 共享 markdown-it 实例（enableMermaid:false 等由工厂决定）
  preferDark={appTheme === 'black'} // 主题：影响 mermaid 等
  isStreaming={!!message.isStreaming} // 流式尾岛开放逻辑
  t={t} // i18n
  renderedMarkdownHtmlPostProcess={ // 仅对 markdown 岛 HTML 后处理
    isSearchOrganicEnabled && message.searchOrganic?.length // 双条件：有 class 且有数据才注入
      ? injectSearchOrganicAnchorsHtml // 传入注入函数
      : undefined // 否则不后处理，普通链接保持 md-it 默认行为
  }
  className={cn( // 合并 Tailwind 与功能 class
    `[&_.markdown-body]:text-textcolor/90!`, // 正文颜色微调
    isSearchOrganicEnabled && '__md-search-enabled__', // 挂上后 CSS 才应用胶囊选择器
    className, // 父级传入的额外 className
  )}
/>
```

---

### 4.14 悬浮预览（popover）与合并胶囊

**来源**：`ChatAssistantMessage/index.tsx`、`organicCitation.ts`

| 细节点 | 说明 |
|--------|------|
| **挂载根** | `bodyMarkdownRef` 指向 **`StreamingMarkdownBody` 外层**（含 `streaming-md-body`），监听加在该 DOM 上。 |
| **`applyIfCitation`** | 仅用 **`findClosestOrganicCitationAnchor(event.target, root, organics)`**：从 target 向上 **`closest('a')`**，再用 **`resolveSearchOrganicFromCitationAnchor`**（`data-organic-cite` 或 href 匹配 organic）判断是否引用链接。**不再**使用 **`findOrganicCitationAnchorAtPoint`**，避免 padding 命中邻近文本。 |
| **`scheduleHideOrganicPreview`** | 约 **180ms** 延迟关闭，配合 **`pointerout`**：从胶囊移到预览浮层时需 **`previewBubbleRef.contains(relatedTarget)`** 排除误关。 |
| **Portal** | 预览渲染到 **`document.body`**，`position: fixed`，根据 **`layoutOrganicPopoverForAnchor`** 在视口上下择优。 |
| **合并胶囊 `data-organic-cite-group`** | 多个连续 **〔cite〕** 合成一颗胶囊；预览内分页 **`ChevronLeft/Right`** 更新 **`organicPreview.index`**，并用 **`syncOrganicMergedAnchorDom`** 回写正文 `<a>` 内展示的域名 / **+N**。 |

实现摘录（预览挂载与 **`findClosestOrganicCitationAnchor`**）：

**来源**：`apps/frontend/src/components/design/ChatAssistantMessage/index.tsx`（约 L294–L358）

```tsx
useEffect(() => { // 副作用：挂载 pointer 监听，卸载时清理
  const root = bodyMarkdownRef.current; // 当前 StreamingMarkdownBody 外层 DOM
  const organics = message.searchOrganic; // 本消息 organic 列表供 resolve 使用
  if (!root || !organics?.length) { // 无根节点或无来源则无需监听
    return; // 提前退出，不注册监听
  }

  const applyIfCitation = (e: PointerEvent) => { // 指针移动/悬停：尝试打开预览
    const a = findClosestOrganicCitationAnchor(e.target, root, organics); // 自 target 向上找引用 <a>
    if (!a) return; // 非引用链则忽略
    const items = resolveOrganicCitationPreviewItems(a, organics); // 单条或 group 展开为多来源
    if (!items.length) return; // 无有效预览数据则忽略
    clearOrganicPreviewLeaveTimer(); // 取消待关闭定时器，避免刚移入又闪关
    // … setOrganicPreview、合并胶囊 lastMergedAnchorVisualRef 等见 ChatAssistantMessage 源码
  }; // applyIfCitation 结束

  const onPointerOut = (e: PointerEvent) => { // 指针离开：决定是否延迟关预览
    const fromAnchor = findClosestOrganicCitationAnchor( // 判断离开是否从引用锚点开始
      e.target, // 事件起点
      root, // 限定在正文树内
      organics, // 同上
    ); // findClosest 结束
    if (!fromAnchor) return; // 不是从胶囊链路上离开则不管
    const related = e.relatedTarget as Node | null; // 指针移入的下一个节点
    if (related && fromAnchor.contains(related)) return; // 仍在同一 <a> 子树内不算离开
    if (related && previewBubbleRef.current?.contains(related)) return; // 移入预览浮层不关
    scheduleHideOrganicPreview(); // 否则启动延迟隐藏
  }; // onPointerOut 结束

  root.addEventListener('pointerover', applyIfCitation); // 悬停进入可能打开预览
  root.addEventListener('pointermove', applyIfCitation); // 在锚点上移动时更新浮层位置等
  root.addEventListener('pointerout', onPointerOut); // 离开锚点/浮层时调度关闭
  return () => { // 清理函数：组件卸载或依赖变时执行
    root.removeEventListener('pointerover', applyIfCitation); // 对称移除
    root.removeEventListener('pointermove', applyIfCitation); // 对称移除
    root.removeEventListener('pointerout', onPointerOut); // 对称移除
    clearOrganicPreviewLeaveTimer(); // 清定时器防泄漏
    // … 其余 ref 复位见源码
  }; // cleanup 结束
}, [message.searchOrganic, bodyText /* …完整依赖列见源码 */]); // 依赖：organic 或正文 DOM 可能变
```

---

### 4.15 `SearchOrganics` 抽屉的三处入口

**来源**：`ChatAssistantMessage/index.tsx`

| 入口 | 触发 |
|------|------|
| 顶部条 | 「已阅读 n 个网页」整行 **`onClick={() => setOpen(true)}`** |
| 底部按钮 | 流结束后「**n 个网页**」**`Button`** **`onClick`** |
| （非入口） | 胶囊 **`target="_blank"`**、预览 **`onClickOrganicPreview`** → **`openExternalUrl`**，打开外链而非抽屉 |

抽屉组件：**`SearchOrganics`**（`Drawer` + 列表按钮跳转）。

实现摘录（两处 **`setOpen(true)`** 与 **`SearchOrganics`**；胶囊 **`target="_blank"`** 不在此列）：

**来源**：`apps/frontend/src/components/design/ChatAssistantMessage/index.tsx`（约 L480–L601）

```tsx
{message?.searchOrganic && message.searchOrganic?.length > 0 && ( // 条件：有 organic 才渲染顶部条
  <div // 容器：整行可点，打开来源抽屉
    className="flex items-center ... cursor-pointer ..." // 布局与手型（真实类名见源码）
    onClick={() => setOpen(true)} // 点击： lifting state 打开 Drawer
  >
    {/* i18n key：chat.assistant.readWebPages，展示「已阅读 n 个网页」 */}
  </div> // 顶部条结束
)} // 条件渲染结束
{/* … 中间：思考区、StreamingMarkdownBody、Spinner 等略 */}
{message?.searchOrganic && // 再次判断有列表
  message.searchOrganic?.length > 0 && // 且非空
  !message.isStreaming && ( // 且流已结束：避免流中误点底部按钮
    <div className="flex items-center justify-end mt-3"> // 右对齐底部操作区
      <Button variant="dynamic" className="..." onClick={() => setOpen(true)}> // 与顶部条同源：开抽屉
        {/* i18n：chat.assistant.webPagesCount */}
      </Button> // Button 结束
    </div> // 底部区结束
  )} // 三重条件结束
<SearchOrganics // 抽屉组件：列表展示每条 title/link
  open={open} // 受控开关
  onOpenChange={() => setOpen(false)} // Radix：任意关闭路径统一置 false
  organics={message.searchOrganic || []} // 传入当前消息快照（缺省空数组）
  t={t} // i18n
/> // SearchOrganics 结束
```

---

### 4.16 英语学习页：为何不用 `Label` 包整条消息

**来源**：`apps/frontend/src/views/englishLearning/index.tsx`

| 细节点 | 说明 |
|--------|------|
| **HTML 规范** | **`<label>`** 若无 **`for`**，则关联其内部 **第一个可标签元素（labelable）**（`button`、`input`、`select` 等）。 |
| **本组件 DOM 顺序** | `ChatAssistantMessage` 内部先有 Markdown（可能含代码块工具栏 **`<button>`**），流结束后又有「**n 个网页**」**`Button`**。第一个可标签控件常被排在正文树较前位置；用户点击段落文字时，浏览器可能执行 **「激活该 label 关联控件」** → **`setOpen(true)`**。 |
| **主 Chat 差异** | `ChatBotView` 中 **`Label`** 使用 **`htmlFor={message.chatId}`**，显式关联隐藏勾选控件，**不会**落到正文里的按钮上。 |
| **修复** | 外层改为 **`<div className="message-md-wrap ...">`**，仅承担样式包裹，无 label 语义。 |

实现摘录：

**来源**：`apps/frontend/src/views/englishLearning/index.tsx`（`EnglishLearningMessageRow`，约 L54–L76）

```tsx
<div // 勿用无 htmlFor 的 Label 包整段：会误激活首个 button 导致误开抽屉；见 §4.16 表格
  className={cn( // 合并 utility：与 Chat 共用 message-md-wrap 选择器链
    'message-md-wrap relative flex min-w-0 max-w-full select-auto rounded-2xl p-3.5 text-textcolor shadow-sm', // 基础气泡壳
    message.role === 'user' // 分支：用户消息
      ? 'w-fit max-w-[min(100%,36rem)] border border-teal-500/20 bg-teal-500/8 px-4 py-3' // 用户：窄气泡
      : 'w-full border border-theme/12 bg-theme-secondary/60', // 助手：通栏
  )} // cn 结束
> // div 开标签
  <ChatAssistantMessage // 复用主 Chat 气泡：含 bodyText、预览、抽屉
    message={message} // 当前行消息对象
    scrollViewportRef={scrollViewportRef} // 滚动容器 ref（预览定位等）
    t={t} // i18n
    className={ // 用户气泡内收窄 markdown-body 最大宽，助手分支不传额外 class
      message.role === 'user' // 仅用户消息需要限制内部 markdown 宽度
        ? 'min-w-0 max-w-full text-left [&_.markdown-body]:min-w-0 [&_.markdown-body]:max-w-full' // Tailwind 任意选择器
        : undefined // 助手：沿用组件默认全宽
    } // className 表达式结束
  /> // ChatAssistantMessage 结束
</div> // 外层 div：仅布局与样式，无 label 语义
```

---

### 4.17 `index.css`：`#message-md-wrap` 与 `.message-md-wrap`

**来源**：`apps/frontend/src/index.css`

| 细节点 | 说明 |
|--------|------|
| **为何并列两个选择器** | Chat 每条消息 **`id="message-md-wrap"`**（传统写法）；英语学习**多条消息**若重复使用同一 **id** 违反 HTML 唯一性，故改用 **class `.message-md-wrap`**。 |
| **样式作用域** | 胶囊规则写在 **`.streaming-md-body.__md-search-enabled__ .markdown-body a[data-organic-cite], a.__md-search-organic__`** 下，避免污染普通 Markdown 链接（仅联网启用时出现对应 class）。 |
| **favicon** | **`.__md-search-organic-favicon__`** 使用 **`pointer-events: none`**，鼠标事件落在 **`<a>`** 上，预览命中稳定。 |

实现摘录（胶囊与 favicon 核心规则；外层 `#message-md-wrap` / `.message-md-wrap` 与 **`.streaming-md-body` 宽度** 见源文件完整块）：

**来源**：`apps/frontend/src/index.css`（约 L96–L163）

```css
#message-md-wrap, /* Chat 单条消息根：历史上用 id 选择器 */
.message-md-wrap { /* 英语学习多条气泡：用 class 避免文档内 id 重复 */
  .streaming-md-body { /* Markdown 渲染外层：与 StreamingMarkdownBody 根 class 对应 */
    min-width: 0; /* 打破 flex 子项默认 min-width:auto 防止横向撑破 */
    max-width: 100%; /* 宽度不超过气泡 */
  }
  .markdown-body { /* markdown-it 默认输出容器 class */
    background-color: transparent; /* 气泡已有背景，正文区透明 */
    min-width: 0; /* 同上：允许收缩 */
    max-width: 100%; /* 同上 */
  }
  .streaming-md-body.__md-search-enabled__ { /* 父组件传入联网启用 class 时才进入胶囊分支 */
    .markdown-body { /* 仅在 markdown 正文内改链接外观 */
      a[data-organic-cite], /* 属性选择器：单条引用序号 */
      a.__md-search-organic__ { /* class 选择器：inject 写入的胶囊链 */
        display: inline-flex; /* 胶囊横排 icon+文字 */
        align-items: center; /* 垂直居中 favicon 与域名 */
        gap: 4px; /* icon 与文字间距 */
        border-radius: 9999px; /* 全圆角胶囊 */
        /* padding、ellipsis、hover 等完整规则见仓库 index.css */
        .__md-search-organic-favicon__ { /* 行内 favicon 图片 */
          pointer-events: none; /* 事件落到外层 <a>：hover/点击稳定 */
        } /* favicon 规则结束 */
      } /* a 规则结束 */
    } /* .markdown-body 嵌套结束 */
  } /* __md-search-enabled__ 结束 */
} /* 根选择器组结束 */
```

---

### 4.18 `patchIncompleteNonMermaidFence`（可选）

**来源**：`apps/frontend/src/utils/splitMarkdownFences.ts`

| 细节点 | 说明 |
|--------|------|
| **适用** | 全文**最后一个**围栏块 **未闭合**，且语言**不是** `mermaid`。 |
| **做法** | 在文末追加与开头围栏 **相同数量** 的反引号闭合行。 |
| **不适用** | `mermaid` 未闭合交给流式 mermaid 岛逻辑，避免破坏拆分。 |
| **接入点** | `ChatAssistantMessage` 的 **`bodyText` useMemo** 内取消注释 **`patchIncompleteNonMermaidFence(raw)`** 即可启用。 |

实现摘录：

**来源**：`apps/frontend/src/utils/splitMarkdownFences.ts`（约 L236–L249）

```typescript
export function patchIncompleteNonMermaidFence(markdown: string): string { // 导出：修补未闭合非 mermaid 围栏
  if (!markdown?.trim()) return markdown; // 空串短路：原样返回
  const normalized = markdown.replace(/\r\n/g, '\n'); // 统一换行符便于 split 逻辑
  const segs = splitMarkdownFencedBlocks(normalized); // 拆成围栏段与正文段序列
  const last = segs[segs.length - 1]; // 只关心文档末尾段是否「开口围栏」
  if (!last?.fenced || last.complete) return markdown; // 非围栏或已闭合：不修改
  const firstLine = last.text.split('\n')[0] ?? ''; // 围栏内首行：```lang 或 ````` 等
  const openMatch = /^(\s*)(`{3,})([^`]*)$/.exec(firstLine.trimEnd()); // 捕获缩进、反引号长度、info 串
  if (!openMatch) return markdown; // 首行不像围栏起始：放弃
  const lang = (openMatch[3] ?? '').trim().split(/\s+/)[0]?.toLowerCase(); // info 串第一个 token 为小写语言名
  if (lang === 'mermaid') return markdown; // mermaid 留给拆岛流式逻辑，不在这里闭合
  const tickLen = openMatch[2].length; // 起始围栏反引号个数（3 或更多）
  return `${normalized}\n${'`'.repeat(tickLen)}`; // 文末追加同长度 ``` 行，强制闭合围栏
}
```

---

### 4.19 HTTP API 契约（英语学习 Agent）

**来源**：`apps/frontend/src/service/api.ts`、`apps/frontend/src/service/index.ts`、`apps/backend/src/services/agent/agent.controller.ts`

| 能力 | 方法 | 路径 | 鉴权 | 说明 |
|------|------|------|------|------|
| 创建会话 | `POST` | `/agent/session` | `JwtGuard`（Bearer） | `createAgentSession`，body 可选 `{ title }`；返回 `sessionId`、`title`。 |
| 会话详情 | `GET` | `/agent/session/:sessionId` | 同上 | `getAgentSessionDetail`；响应内 **`messages[]`** 含 **`id`、`role`、`content`、`searchOrganic`、`createdAt`** 等。 |
| 流式对话 | `POST` | `/agent/sse` | 同上 | **`Content-Type: application/json`**，body 为 **`AgentChatDto`**（含 **`assistMode`**）；响应为 SSE，`data:` 后为 JSON。 |
| 停止生成 | `POST` | `/agent/stop` | 同上 | body 含 **`sessionId`**；服务端递增 epoch 使当前 `runChatStream` abort。 |

**SSE 单行载荷形状（归纳）**：

- 进行中：`{ "type":"content"|"tool"|"searchOrganic", ... }` 或外层再包一层 `data`（由 `unwrapAgentPayload` 剥开）。
- 结束：`{ "done": true }`。
- 错误：`{ "error": "...", "done": true }`。

**前端请求**：`streamAgentSse` 使用项目统一的 **`getPlatformFetch`** + **`BASE_URL`**，Header **`Authorization: Bearer <token>`**（读 `localStorage.token`）。

实现摘录（路径常量 + 会话详情请求；SSE 见 **`streamAgentSse`** 内 **`AGENT_SSE`**）：

**来源**：`apps/frontend/src/service/api.ts`（约 L111–L112）、`apps/frontend/src/service/index.ts`（`getAgentSessionDetail`，约 L403–L406）

```typescript
export const AGENT_SESSION = '/agent/session'; // 常量：REST 前缀，与 Nest @Controller('agent') 下子路由拼接
export const AGENT_SSE = '/agent/sse'; // 常量：SSE 端点路径；请求体为 AgentChatDto，响应 text/event-stream

export const getAgentSessionDetail = async (sessionId: string) => { // 命名导出：拉会话详情供 hydrate
  return await http.get<AgentSessionDetailPayload>(AGENT_SESSION, { // 泛型：响应体类型约束含 messages[].searchOrganic
    params: [sessionId], // 路径参数：嵌在 AGENT_SESSION 后的 :sessionId（具体拼接方式见 http 封装）
  }); // http.get 结束
}; // getAgentSessionDetail 结束
```

**来源**：`apps/backend/src/services/agent/agent.controller.ts`（路由骨架；`chatSse` 完整 **`map`/`concat`** 见 **§4.7**）

```typescript
@Controller('agent') // 类级路由前缀 /agent
@UseGuards(JwtGuard) // 类级守卫：以下方法默认需 Bearer JWT
export class AgentController { // Nest 控制器：对外暴露 Agent HTTP/SSE
  @Post('session') // POST /agent/session：创建会话
  async createSession(/* ... */) {} // 方法体省略

  @Get('session/:sessionId') // GET /agent/session/:id：详情含消息与 searchOrganic
  async getSessionDetail(/* ... */) {} // 方法体省略

  @Post('sse') // POST /agent/sse：流式对话
  @Sse() // 装饰器：返回值按 SSE 序列写出
  chatSse(/* ... */): Observable<{ data: Record<string, unknown> }> { // 返回 Observable；见 §4.7 map/concat
    /* 见 §4.7 */ // 占位：实现内组装 LangChain 流并 map 为前端 JSON 行
  } // chatSse 结束

  @Post('stop') // POST /agent/stop：中止当前生成
  async stop(/* ... */) {} // 方法体省略
} // AgentController 结束
```

---

### 4.20 `organicCitation.ts`：占位符与「Markdown 安全」原因

**来源**：`apps/frontend/src/utils/organicCitation.ts`（文件头注释、`organicCitationMarker`、`applyOrganicCitationAnchors`、`injectOrganicCitationAnchorsIntoMarkdownHtml`）

| 概念 | 实现细节 |
|------|-----------|
| **为何不用后端那种直接 `<a>`** | 后端 `web-search/organic-citation.ts` 的 **`applyOrganicCitationAnchors`** 可把 **【n】** 变成 **HTML `<a>`**；聊天前端 Markdown 管线使用 **markdown-it** 且 **`html: false`** 时，若把 **`<a>`** 留在 Markdown 字符串里，可能被 **转义成纯文本**而非链接。前端策略：**Markdown 阶段只用私有占位符 `〔cite:n〕`**（全角括号 + `cite:`，与用户正文冲突概率极低）。 |
| **占位符生成** | **`organicCitationMarker(index)`** → **`〔cite:index〕`**，其中 **`index` 与 【n】一致，为 **1-based**。 |
| **落库 HTML 回放** | **`PERSISTED_ORGANIC_ANCHOR_RE`** 匹配 **`<a ... data-organic-cite="(\d+)" ...>...</a>`**；若当前消息仍有 **`organic`**，替换为 **`〔cite:n〕`**；若无 organic，降级回 **`【n】`** 纯文本，避免残留 HTML 与列表不一致。 |

**`applyOrganicCitationAnchors`（Markdown 串上）三条替换（顺序敏感）**：

1. **`[n](url)`**（Markdown 链接）：正则 **`/\[(\d+)\]\(\s*(?:<([^>\n]+)>|([^)\n]+))\s*\)/g`**；解析出 **`destRaw`** 后与 **`organic[n-1].link`** 做 **`urlsMatchForOrganic`**（trim + **decodeURIComponent** 容错）；不匹配则**原样保留**（防止模型填错链接触发错误引用）。匹配成功 → **`〔cite:n〕`**。
2. **`【n】`**（全角角标）：**`/【(\d+)】/g`** → **`toMarker(n)`**；若序号超出 **`organic.length`** 或对应 **`link` 为空**，返回 **`null`** → **不替换**（保留原文 **【n】**）。
3. **裸 `[n]`**（且**不是** **`[n](`**）：**`/\[(\d+)\](?!\()/g`**；排除标准 Markdown 链接形式，避免误伤 **`[1](https://...)`**（已由第一条处理）。

**`injectOrganicCitationAnchorsIntoMarkdownHtml`（已渲染 HTML）**：

- **前置条件**：**`organic.length > 0`** 且 HTML 字符串包含 **`〔cite:`**；否则直接返回，避免无意义扫描。
- **连续占位合并**：正则 **`/(?:〔cite:\d+〕)+/g`** 匹配连续多个占位符；抽出所有序号 → **`Set` 去重** → 过滤 **`id ∈ [1, organic.length]`** 且 **`organic[id-1].link` 非空**；若 **`valid.length === 0`** → **保持原文占位符不动**（用户可见「未挂上来源」）。
- **`<pre>` 隔离**：先用 **`PRE_BLOCK_SPLIT_RE`** 拆成 **`<pre>...</pre>`** 段与普通段；**仅在非 pre 段**执行替换，避免代码块内出现 `〔cite:1〕` 字样时被误换成链接。
- **合并胶囊**：多个有效 id → **`data-organic-cite-group="id1,id2,..."`**；展示文案 **单条**为 **`shortHostnameFromUrl`**；**多条**为 **`首域名 +「 + (count-1)」`**（与 **`syncOrganicMergedAnchorDom`** 一致）。
- **输出 `<a>`**：**`href`**、**`data-organic-cite`**（取 **citeIds 第一个**）、**`target="_blank"`** **`rel="noopener noreferrer"`**、**`class="__md-search-organic__"`**；图标走 **`escapeHrefForDoubleQuotedAttr`** / **`escapeHtmlText`** 防 XSS。

实现摘录（占位符与落库 `<a>` 规范化入口；**`injectOrganicCitationAnchorsIntoMarkdownHtml` / `applyOrganicCitationAnchors` 全文见 §4.20b**）。

**来源**：`apps/frontend/src/utils/organicCitation.ts`（约 L13–L32、L55–L64）

```typescript
const PERSISTED_ORGANIC_ANCHOR_RE = // 模块级常量：匹配已落库的 data-organic-cite 锚点整段 HTML
  /<a\b[^>]*\bdata-organic-cite="(\d+)"[^>]*>[\s\S]*?<\/a>/gi; // 正则：捕获组 1 为序号 n；gi 全局忽略大小写

export function organicCitationMarker(index: number): string { // 导出：生成私有占位符串
  return `〔cite:${index}〕`; // 模板字符串：全角括号降低与用户 () 冲突
} // organicCitationMarker 结束

export function normalizePersistedOrganicAnchorsInMarkdown( // 导出：回放前把历史 <a> normalize
  text: string, // 入参：助手 content 可能混有旧 HTML 锚点
  organic: Pick<OrganicLinkItem, 'link'>[] | null | undefined, // 当前消息的 link 列表用于校验/占位
): string { // 返回：仍是一段 Markdown 源串
  return text.replace(PERSISTED_ORGANIC_ANCHOR_RE, (_, raw: string) => { // 对每个匹配锚点执行回调；_ 为整段匹配
    if (organic?.length) { // 有 organic：可把序号映射回占位符再走 md-it
      return organicCitationMarker(Number.parseInt(raw, 10)); // raw 为捕获组字符串，parse 成整数索引
    }
    return `【${raw}】`; // 无 organic：降级为可见全角角标，剥掉不可信 HTML
  }); // replace 回调结束
} // normalizePersistedOrganicAnchorsInMarkdown 结束
```

### 4.20b `inject` 与 `apply`（Markdown 占位符 ↔ 渲染后 HTML）

**来源**：`apps/frontend/src/utils/organicCitation.ts`（`injectOrganicCitationAnchorsIntoMarkdownHtml` 约 L115–L163；`applyOrganicCitationAnchors` 约 L179–L233；`PRE_BLOCK_SPLIT_RE` 约 L67）

```typescript
export function injectOrganicCitationAnchorsIntoMarkdownHtml( // 在 markdown-it 产出 HTML 上替换〔cite〕为 <a>
  html: string, // 入参：可能含多段的拼接 HTML
  organic: SearchOrganicItem[], // 与角标序号对齐的结构化来源
): string { // 返回：注入后的 HTML 字符串
  if (!organic?.length || !html.includes('〔cite:')) { // 短路：无数据或不含占位符则不做全串扫描
    return html; // 原样返回
  } // if 结束

  const injectChunk = (chunk: string): string => // 局部函数：处理单个非 <pre> 文本块
    chunk.replace(/(?:〔cite:\d+〕)+/g, (full) => { // 连续一个或多个〔cite:k〕合并匹配
      const ids = [...full.matchAll(/〔cite:(\d+)〕/g)].map((m) => // 抽出每个占位符内的数字
        Number.parseInt(m[1], 10), // 解析为整数序号
      ); // map 结束
      const valid = [...new Set(ids)].filter( // 去重后过滤非法或缺 link 的序号
        (id) => // 谓词：每个候选 id
          id >= 1 && id <= organic.length && organic[id - 1]?.link?.trim(), // 1-based 且在范围内且 link 非空
      ); // filter 结束
      if (valid.length === 0) { // 无可映射序号：不替换，避免坏链
        return full; // 保留原文占位符供用户感知「未挂上」
      } // if 结束
      const citeIds = valid; // 别名：语义上为最终要展示的引用 id 列表
      const id = citeIds[0]; // 主序号：href 与 data-organic-cite 用第一条（合并胶囊规则）
      const item = organic[id - 1]; // 取主条目对象
      const link = item.link.trim(); // 规范化 URL 空白
      const hosts = citeIds.map((cid) => // 为每条引用算短域名展示
        shortHostnameFromUrl(organic[cid - 1].link.trim()), // 逐条 trim 后取 host 缩写
      ); // map 结束
      const count = citeIds.length; // 合并条数
      const label = count === 1 ? hosts[0] : `${hosts[0]} +${count - 1}`; // 单条显示域名；多条「首 +N」
      const groupAttr = // 合并胶囊：写 group 属性供预览分页
        count > 1 ? ` data-organic-cite-group="${citeIds.join(',')}"` : ''; // 多于一条才加属性串
      const iconUrl = item.icon?.trim(); // favicon 可选
      const iconHtml = iconUrl // 三元：有 icon 则拼 img 标签
        ? `<img src="${escapeHrefForDoubleQuotedAttr(iconUrl)}" alt="" class="__md-search-organic-favicon__" width="12" height="12" referrerpolicy="no-referrer" />` // XSS：src 转义
        : ''; // 无 icon 则空串
      return `<a href="${escapeHrefForDoubleQuotedAttr(link)}" data-organic-cite="${id}"${groupAttr} target="_blank" rel="noopener noreferrer" style="cursor: pointer;" class="__md-search-organic__">${iconHtml}${escapeHtmlText(label)}</a>`; // 拼接最终胶囊 a 标签
    }); // replace 回调结束

  return html // 返回管道：先按 <pre> 切开
    .split(PRE_BLOCK_SPLIT_RE) // 常量正则：捕获 <pre>...</pre> 岛
    .map((part) => { // 逐段处理
      if (/^<pre\b/i.test(part)) { // 若是 pre 岛
        return part; // 原样返回，防止代码示例里的〔cite:〕被误换
      } // if 结束
      return injectChunk(part); // 普通 HTML 段执行占位符替换
    }) // map 结束
    .join(''); // 拼回完整 HTML
} // injectOrganicCitationAnchorsIntoMarkdownHtml 结束

export function applyOrganicCitationAnchors( // 导出：Markdown 源串阶段【n】等 →〔cite:n〕
  text: string, // 入参：模型输出的 Markdown 文本
  organic: Pick<OrganicLinkItem, 'link'>[], // 仅需 link 字段做 url 校验
): string { // 返回：仍是一段 Markdown（含占位符）
  if (!text || !organic?.length) { // 无文本或无 organic：短路
    return text; // 原样返回
  } // if 结束
  const max = organic.length; // 最大合法序号上界
  const toMarker = (idx: number): string | null => { // 闭包：序号 → 占位符或 null 表示不替换
    if (idx < 1 || idx > max) { // 越界
      return null; // 不生成占位符
    } // if 结束
    const link = organic[idx - 1]?.link?.trim(); // 取对应条目 link
    if (!link) { // 空 link 不生成引用
      return null; // 保持原文
    } // if 结束
    return organicCitationMarker(idx); // 合法则返回〔cite:idx〕
  }; // toMarker 结束

  let out = text.replace( // 步骤 1：Markdown 链接 [n](url) 且 url 与 organic 一致才替换
    /\[(\d+)\]\(\s*(?:<([^>\n]+)>|([^)\n]+))\s*\)/g, // 正则：支持尖括号包裹 url 或裸 url
    (full, raw: string, angled?: string, plain?: string) => { // 回调：full 为整段匹配
      const i = Number.parseInt(raw, 10); // 括号内序号
      if (Number.isNaN(i)) { // 非数字
        return full; // 保留原串
      } // if 结束
      const destRaw = (angled ?? plain ?? '').trim(); // 取出目标 url 字符串
      if (!destRaw) { // 空目标
        return full; // 不替换
      } // if 结束
      const expected = organic[i - 1]?.link?.trim(); // 期望 url：以服务端 organic 为准
      if (!expected || !urlsMatchForOrganic(destRaw, expected)) { // 不一致：防模型篡改外链
        return full; // 原样保留
      } // if 结束
      return toMarker(i) ?? full; // 一致：写占位符；toMarker 失败则保留原文
    }, // replace 回调结束
  ); // 第一步 replace 结束

  out = out.replace(/【(\d+)】/g, (full, raw: string) => { // 步骤 2：全角角标【n】
    const i = Number.parseInt(raw, 10); // 解析序号
    if (Number.isNaN(i)) { // 非数字
      return full; // 保留
    } // if 结束
    return toMarker(i) ?? full; // 合法则占位符否则原文
  }); // 第二步 replace 结束

  out = out.replace(/\[(\d+)\](?!\()/g, (full, raw: string) => { // 步骤 3：裸 [n] 且非 [n]( 开头
    const i = Number.parseInt(raw, 10); // 解析序号
    if (Number.isNaN(i)) { // 非数字
      return full; // 保留
    } // if 结束
    return toMarker(i) ?? full; // 同上
  }); // 第三步 replace 结束
  return out; // 返回处理后的 Markdown 串
} // applyOrganicCitationAnchors 结束
```

---

### 4.21 预览解析：`resolveOrganicCitationPreviewItems` 与摘要净化

**来源**：`apps/frontend/src/utils/organicCitation.ts`

| 函数 | 行为细节 |
|------|-----------|
| **`resolveSearchOrganicFromCitationAnchor`** | 优先读 **`data-organic-cite`**：解析为整数 **`n`**，若在 **`[1, organics.length]`** 则返回 **`organics[n-1]`**；否则用 **`href`** 与每条 **`organic[i].link`** **`urlsMatchForOrganic`** 查找。都无则 **`undefined`**。 |
| **`resolveOrganicCitationPreviewItems`** | 若存在 **`data-organic-cite-group`**：按逗号拆分 → `parseInt` → 去重 → 过滤合法序号 → **`ids.map(id => organics[id-1])`**；否则退化为单条 **`resolveSearchOrganicFromCitationAnchor`** 的数组。 |
| **`findClosestOrganicCitationAnchor`** | 从 **`event.target`**（含 **Text 节点** 时取其 **`parentElement`**）向上 **`closest('a')`**；锚点须在 **`root.contains(a)`** 内；再 **`resolveSearchOrganicFromCitationAnchor`** 非空才视为引用胶囊。**注意**：本函数**不**排除 `<pre>` 内的 `<a>`；若代码块复制进带链接内容且 href 恰好命中 organic，理论上也可命中（极少见）。 |
| **`findOrganicCitationAnchorAtPoint`**（坐标兜底） | 遍历 **`root.querySelectorAll('a')`**，**`a.closest('pre')` 则跳过**；用于「`pointer-events: none` 时 target 不是 `<a>`」场景；**当前 Chat 预览路径已不再调用**，仅靠 **`findClosestOrganicCitationAnchor`**。 |
| **`sanitizeOrganicSnippetForPreview`** | 去掉 **script/style**、剥标签、解码常见实体、弱化 Markdown（标题、粗体、行内代码、链接转可见文本）、空白折叠；**最长约 480 字符**截断 + **`…`**，防止悬浮层被长 snippet 撑爆。 |
| **`areOrganicPreviewItemsSame`** | 用 **`link`** 序列 **`join('\u0001')`** 比较，用于 **`pointermove` 时同一锚点、同一组来源则只更新 **`anchorRect`** 不重置索引，减少抖动。 |

实现摘录（预览列表解析 + **`findClosestOrganicCitationAnchor`**；与 **§4.14** `applyIfCitation` 配合阅读）。

**来源**：`apps/frontend/src/utils/organicCitation.ts`（约 L235–L275、L428–L453）

```typescript
export function resolveSearchOrganicFromCitationAnchor( // 导出：由 <a> 反查单条 organic
  anchor: HTMLAnchorElement, // 事件路径上找到的锚点元素
  organics: SearchOrganicItem[], // 当前消息来源列表
): SearchOrganicItem | undefined { // 未命中返回 undefined
  const cite = anchor.getAttribute('data-organic-cite'); // 优先读 data 属性序号
  if (cite) { // 有属性则尝试按序号直取
    const n = Number.parseInt(cite, 10); // 字符串转整数
    if (!Number.isNaN(n) && n >= 1 && n <= organics.length) { // 合法 1-based 范围
      return organics[n - 1]; // 数组下标比序号小 1
    } // if 结束
  } // if cite 结束
  const href = anchor.getAttribute('href'); // 无合法序号则尝试用 href 反查
  if (!href?.trim()) { // 空 href 无法匹配
    return undefined; // 明确无结果
  } // if 结束
  return organics.find((o) => urlsMatchForOrganic(href.trim(), o.link.trim())); // 线性查找归一化相等
} // resolveSearchOrganicFromCitationAnchor 结束

export function resolveOrganicCitationPreviewItems( // 导出：预览列表（单条或合并组）
  anchor: HTMLAnchorElement, // 当前悬停锚点
  organics: SearchOrganicItem[], // 来源列表
): SearchOrganicItem[] { // 返回：非空数组供预览渲染
  const group = anchor.getAttribute('data-organic-cite-group')?.trim(); // 合并胶囊：逗号分隔多个 id
  if (group) { // 存在 group：展开为多 organic
    const ids = [ // 计算去重后的合法序号数组
      ...new Set( // Set 去重
        group // 原始 attribute 串
          .split(',') // 按逗号拆
          .map((s) => Number.parseInt(s.trim(), 10)) // 每段 parse
          .filter((n) => !Number.isNaN(n) && n >= 1 && n <= organics.length), // 过滤非法
      ), // Set spread 结束
    ]; // ids 数组结束
    return ids.map((id) => organics[id - 1]).filter(Boolean); // 映射为条目并去掉空洞
  } // if group 结束
  const one = resolveSearchOrganicFromCitationAnchor(anchor, organics); // 无 group：单条解析
  return one ? [one] : []; // 包装成数组统一接口
} // resolveOrganicCitationPreviewItems 结束

export function findClosestOrganicCitationAnchor( // 导出：指针事件路径上找最近引用胶囊 <a>
  start: EventTarget | null, // 原生事件 target，可能为 Text
  root: HTMLElement, // 正文根：必须在 contains 范围内
  organics: SearchOrganicItem[], // 用于 resolve 校验是否真为 organic 链
): HTMLAnchorElement | null { // 非引用链则 null
  if (!organics.length) { // 无列表无法判定
    return null; // 早退
  } // if 结束
  const el = // 归一化出 DOM Element 起点
    start instanceof Element // 若已是元素节点
      ? start // 直接用
      : start instanceof Text // 若是文本节点
        ? start.parentElement // 取父元素再 closest
        : null; // 其它类型无父链
  if (!el) { // 无法得到元素
    return null; // 无法 closest
  } // if 结束
  const a = el.closest('a'); // 沿 composed 路径向上找最近 a（含自身）
  if (!a || !root.contains(a)) { // 无 a 或 a 不在正文根子树内
    return null; // 排除外链区误触
  } // if 结束
  const anchor = a as HTMLAnchorElement; // 断言为锚点类型
  return resolveSearchOrganicFromCitationAnchor(anchor, organics) // 若能映射到 organic
    ? anchor // 则视为本功能的引用胶囊
    : null; // 否则是普通 <a>，不打开有机预览
} // findClosestOrganicCitationAnchor 结束
```

---

### 4.22 `StreamingMarkdownBody` 与 `renderedMarkdownHtmlPostProcess`

**来源**：`apps/frontend/src/components/design/ChatAssistantMessage/StreamingMarkdownBody.tsx`、`ChatAssistantMessage/index.tsx`

| 细节点 | 说明 |
|--------|------|
| **拆分** | **`splitForMermaidIslandsWithOpenTail`**：普通 Markdown 段与 **` ```mermaid `** 岛分段；流式时 **`enableOpenTail: isStreaming`** 可把尾部未闭合 mermaid 拆出，避免整段 parser 状态错乱。 |
| **普通段** | **`parser.render(part.text)`** 得到 HTML → 若父组件传入 **`renderedMarkdownHtmlPostProcess`**，**仅对该段 HTML** 调用（**不**对 mermaid 岛调用），因此 **inject organic** 不会影响 mermaid 围栏内部结构。 |
| **`containerRef`** | 英语学习传入 **`bodyMarkdownRef`**，与 **`ChatAssistantMessage`** 中有机监听 **`pointer*`** 的根节点一致。 |
| **`className` 拼接** | 父组件传入 **`__md-search-enabled__`** 时挂在 **`streaming-md-body`** 同一元素上，与 **`index.css`** 选择器路径对齐。 |

实现摘录（`renderedMarkdownHtmlPostProcess` 仅在 markdown 段调用；完整 **`renderMermaidPart`** 见源文件）：

**来源**：`apps/frontend/src/components/design/ChatAssistantMessage/StreamingMarkdownBody.tsx`（约 L25–L41、L107–L120）

```typescript
export type StreamingMarkdownBodyProps = { // 导出类型：组件 props 形状
  markdown: string; // 输入 Markdown 全文（可能含未闭合 mermaid）
  parser: MarkdownParser; // markdown-it 封装实例
  className?: string; // 可选附加 class（如 __md-search-enabled__）
  preferDark: boolean; // 主题位：影响 mermaid 等
  isStreaming: boolean; // 流式：控制拆岛尾部开放策略
  defaultMermaidViewMode?: 'diagram' | 'code'; // mermaid 默认视图
  containerRef?: RefObject<HTMLDivElement | null>; // 可选：向外暴露根 div 供 pointer 监听
  t?: ChatI18nT; // i18n
  renderedMarkdownHtmlPostProcess?: (html: string) => string; // 可选：仅对 markdown 岛 HTML 后处理（如 inject）
}; // type 结束

return ( // 组件 render：parts 来自 splitForMermaidIslandsWithOpenTail（源文件内计算）
  <div ref={containerRef} className={cn('streaming-md-body', className)}> // 根：挂 ref 与基础 class
    {parts.map((part: MarkdownMermaidSplitPart, i: number) => { // 逐岛渲染
      if (part.type === 'markdown') { // 普通 Markdown 段
        let html = parser.render(part.text); // md-it → HTML 字符串
        if (renderedMarkdownHtmlPostProcess) { // 若父级提供后处理（有机引用注入）
          html = renderedMarkdownHtmlPostProcess(html); // 只处理本段 HTML，不碰 mermaid 岛
        } // if 结束
        return ( // React 元素：内联 HTML
          <div key={`md-${i}`} dangerouslySetInnerHTML={{ __html: html }} /> // key 用岛下标
        ); // return 结束
      } // if markdown 结束
      return renderMermaidPart(part, i); // mermaid 岛：走专用渲染分支
    })} // map 结束
    {mermaidImagePreviewModal} // 可选：mermaid 大图预览挂载点
  </div> // 根 div 结束
); // return 结束
```

---

### 4.23 系统提示：引用角标约定（后端）

**来源**：`apps/backend/src/services/agent/agent.service.ts`（`DEFAULT_AGENT_SYSTEM_PROMPT` 常量）

默认 Agent 提示中明确要求：

> 引用互联网检索摘录时，在句末使用 **【1】【2】** 等与摘录序号一致的角标（**全角方括号**），便于展示来源胶囊。

**英语学习追加段**（`ENGLISH_LEARNING_SYSTEM_APPEND`）侧重词汇、版权与工具边界；**角标句式写在默认段**，故 **非 english_learning** 的 Agent 会话若触发联网，也同样被引导输出 **【n】**。

实现摘录：

**来源**：`apps/backend/src/services/agent/agent.service.ts`（约 L33–L54）

```typescript
const DEFAULT_AGENT_SYSTEM_PROMPT = `你是一个具备工具调用能力的智能助手（ReAct Agent）。请准确、有条理地回答；不确定时请说明；不要编造事实。
涉及用户自有文档、笔记、已入库知识时优先使用「知识库检索」工具；需要时效信息或公开网页时使用互联网搜索工具。
引用互联网检索摘录时，在句末使用【1】【2】等与摘录序号一致的角标（全角方括号），便于展示来源胶囊。`; // 常量：默认系统提示；末句约定【n】与 organic 序号对齐，供前端占位符/胶囊渲染

// ENGLISH_LEARNING_SYSTEM_APPEND：同文件约 L39–L47，多行追加模板本文档不展开

function resolveAgentSystemPrompt(dto: AgentChatDto): string { // 根据 assistMode 拼接系统提示文本
  if (dto.assistMode === 'english_learning') { // 分支：英语学习在默认提示后追加专项约束
    return `${DEFAULT_AGENT_SYSTEM_PROMPT}\n\n${ENGLISH_LEARNING_SYSTEM_APPEND}`; // 模板插值：两段之间空行
  } // if 结束
  return DEFAULT_AGENT_SYSTEM_PROMPT; // 其它 assistMode：仅用默认段（工具与角标约定仍生效）
} // resolveAgentSystemPrompt 结束
```

---

### 4.24 后端落库 HTML 与前端占位符流水线对齐说明

**来源**：`apps/backend/src/services/web-search/organic-citation.ts` vs `apps/frontend/src/utils/organicCitation.ts`

| 维度 | 后端 `applyOrganicCitationAnchors` | 前端 `applyOrganicCitationAnchors` |
|------|-----------------------------------|-----------------------------------|
| **输出** | 直接生成 **`<a data-organic-cite="n">...</a>`**（片段中为数字节点） | 生成 **`〔cite:n〕`**，再由 md-it + inject 生成 `<a>` |
| **语义** | **【n】、[n](匹配 url)、裸 [n]** 三路与前端一致 | 同上 + **`urlsMatchForOrganic`** 一致 |
| **用途** | 适合「纯文本存储 / 非 markdown-it 渲染」链路 | 适合「必须先 md 渲染再注入」的 Chat UI |

#### 4.24b 后端 `organic-citation.ts`：`applyOrganicCitationAnchors`（直接输出 `<a>`，逐行）

**来源**：`apps/backend/src/services/web-search/organic-citation.ts`（约 L1–L81）

```typescript
import type { WebSearchOrganicItem } from './web-search.types'; // 类型-only 导入：organic 条目形状

function escapeHrefForDoubleQuotedAttr(url: string): string { // 模块内工具：给属性 href 做最小 HTML 转义
  return url.replace(/&/g, '&amp;').replace(/"/g, '&quot;'); // & 与双引号转义，防属性截断
} // escapeHrefForDoubleQuotedAttr 结束

function urlsMatchForOrganic(dest: string, organicLink: string): boolean { // 与前端同名：URL 归一化相等判断
  const norm = (u: string) => { // 内部：单 url 规范化
    let s = u.trim(); // 去首尾空白
    try { // try：decode 可能抛错
      s = decodeURIComponent(s); // 尽力解码百分号序列，减少比对假阴性
    } catch { // decode 失败
      // 非法百分号序列时保持 trim 后原串
    } // catch 结束
    return s; // 返回规范化结果
  }; // norm 结束
  return norm(dest) === norm(organicLink); // 双向同规则再比严格相等
} // urlsMatchForOrganic 结束

export function applyOrganicCitationAnchors( // 导出：非 Markdown-it 管线可直接把角标换成 <a>
  text: string, // 入参：纯文本或 Markdown 源串
  organic: Pick<WebSearchOrganicItem, 'link'>[], // 仅需 link 做 href 与校验
): string { // 返回：内嵌 HTML 片段的字符串（与前端占位符版输出形态不同）
  if (!text || !organic?.length) { // 无文本或无 organic
    return text; // 短路
  } // if 结束
  const max = organic.length; // 合法序号上界
  const toAnchor = (idx: number): string | null => { // 生成单个 <a> 或 null
    if (idx < 1 || idx > max) { // 越界
      return null; // 不输出锚点
    } // if 结束
    const link = organic[idx - 1]?.link?.trim(); // 取目标 URL
    if (!link) { // 空链接
      return null; // 不生成
    } // if 结束
    return `<a href="${escapeHrefForDoubleQuotedAttr(link)}" data-organic-cite="${idx}" target="_blank" rel="noopener noreferrer" style="cursor: pointer;" class="__md-search-organic__">${idx}</a>`; // 文案用数字 idx；与前端胶囊用域名不同
  }; // toAnchor 结束

  let out = text.replace( // 步骤 1：Markdown 链接 [n](url)
    /\[(\d+)\]\(\s*(?:<([^>\n]+)>|([^)\n]+))\s*\)/g, // 同前端正则
    (full, raw: string, angled?: string, plain?: string) => { // 回调
      const i = Number.parseInt(raw, 10); // 序号
      if (Number.isNaN(i)) { // 非数字
        return full; // 保留
      } // if 结束
      const destRaw = (angled ?? plain ?? '').trim(); // url 文本
      if (!destRaw) { // 空
        return full; // 保留
      } // if 结束
      const expected = organic[i - 1]?.link?.trim(); // 期望 URL
      if (!expected || !urlsMatchForOrganic(destRaw, expected)) { // 不一致
        return full; // 防篡改外链
      } // if 结束
      return toAnchor(i) ?? full; // 通过则输出 <a>
    }, // 回调结束
  ); // replace 结束

  out = out.replace(/【(\d+)】/g, (full, raw: string) => { // 步骤 2：全角【n】
    const i = Number.parseInt(raw, 10); // 解析
    if (Number.isNaN(i)) { // 非数字
      return full; // 保留
    } // if 结束
    return toAnchor(i) ?? full; // 替换或保留
  }); // replace 结束

  out = out.replace(/\[(\d+)\](?!\()/g, (full, raw: string) => { // 步骤 3：裸 [n]
    const i = Number.parseInt(raw, 10); // 解析
    if (Number.isNaN(i)) { // 非数字
      return full; // 保留
    } // if 结束
    return toAnchor(i) ?? full; // 替换或保留
  }); // replace 结束
  return out; // 返回带 <a> 的字符串
} // applyOrganicCitationAnchors 结束
```

Agent **assistant `content` 存的是模型原始 Markdown 文本**，一般 **不含** 后端预生成的 `<a>`；前端仍以 **【n】** → **占位符** → **inject** 为主。**`normalizePersistedOrganicAnchorsInMarkdown`** 用于将来或其它链路若把 HTML 锚点写进了 content 的兼容。

---

### 4.25 本轮数据库占位：`insertUserAndAssistantPlaceholder` 与 `turnId`

**来源**：`apps/backend/src/services/agent/agent-memory.service.ts`

| 细节点 | 说明 |
|--------|------|
| **原子性** | 同一 **`turnId`**（UUID）下先插入 **user** 消息，再插入 **assistant** 空占位（`content: ''`），便于流式结束后 **`updateAssistantContent`** 只更新助手行 id。 |
| **删 turn** | **`deleteTurnPair(sessionId, turnId)`** 按 **`turn_id`** 删两行，避免只删助手留下孤立用户消息。 |
| **organic 附着对象** | 仅 **assistant** 行需要 **`search_organic`**；用户行通常为 **`null`**。 |

实现摘录（**`updateAssistantContent` / `listMessagesAsc` 的逐行注释见 §4.9、§4.10**；本节仅占位插入）。

**来源**：`apps/backend/src/services/agent/agent-memory.service.ts`（`insertUserAndAssistantPlaceholder`，约 L193–L221）

```typescript
async insertUserAndAssistantPlaceholder( // 一轮对话开始：插入 user + assistant 占位两行
  session: AgentSession, // 已加载的会话实体（含 id 等）
  turnId: string, // 本轮共享 UUID，删 turn 时成对删除
  userContent: string, // 用户可见输入原文
): Promise<{ assistantMessageId: string }> { // 返回：后续流式写正文要用助手行主键
  const user = this.messageRepo.create({ // 构造 user 行（未落库）
    session, // 外键对象
    role: AgentMessageRole.USER, // 枚举：用户角色
    content: userContent, // 用户正文
    turnId, // 绑定本轮
  }); // create 参数结束
  await this.messageRepo.save(user); // 立即写入 user 行

  const assistant = this.messageRepo.create({ // 构造 assistant 占位行
    session, // 同会话
    role: AgentMessageRole.ASSISTANT, // 枚举：助手
    content: '', // 空正文：流式过程中内存累积，结束再 update
    turnId, // 与用户行相同 turnId
  }); // create 结束
  await this.messageRepo.save(assistant); // 写入助手占位，拿到 assistant.id

  if (!session.title?.trim()) { // 若会话尚无标题
    const t = userContent.slice(0, 60) || '新对话'; // 用用户首句截断作为默认标题
    await this.sessionRepo.update({ id: session.id }, { title: t }); // 持久化标题
    session.title = t; // 同步内存实体，避免后续逻辑读到旧值
  } // if 结束

  return { assistantMessageId: assistant.id }; // 供 runChatStream 闭包 updateAssistantContent
} // insertUserAndAssistantPlaceholder 结束
```

---

### 4.26 前端类型层：`Message` 与 API Payload

**来源**：`apps/frontend/src/types/chat.ts`、`apps/frontend/src/service/index.ts`

| 字段 | 说明 |
|------|------|
| **`SearchOrganicItem`** | **`title`、`link`、可选 `position`（1-based）、`snippet`、`date`、`icon`**；与后端 **`SerperOrganicItem` / `WebSearchOrganicItem`** 对齐。 |
| **`Message.searchOrganic`** | **`SearchOrganicItem[] | null | undefined`**；MobX 列表里常用 **`undefined`** 表示「未设置」，hydrate 时 **`?? undefined`** 吃掉 JSON **`null`**。 |
| **`AgentSessionDetailPayload.messages[].searchOrganic`** | 与 GET 详情响应一致；TypeScript 便于 **`getAgentSessionDetail`** 推断。 |

实现摘录：

**来源**：`apps/frontend/src/types/chat.ts`（约 L26–L72）、`apps/frontend/src/service/index.ts`（`AgentSessionDetailPayload`，约 L377–L392）

```typescript
export interface SearchOrganicItem { // 导出接口：单条联网 organic 与后端 DTO 对齐
  title: string; // 结果标题
  link: string; // 结果 URL
  position?: number; // 可选：1-based 展示序号；缺省可由 UI 用下标+1
  snippet?: string; // 可选摘要
  date?: string; // 可选抓取/发布日期
  icon?: string; // 可选站点 favicon URL
} // SearchOrganicItem 结束

export interface Message { // 导出：聊天列表中单条消息（MobX observable 常用形状）
  chatId: string; // 消息主键：hydrate 后为服务端 id；首包流式可为客户端 uuid
  content: string; // Markdown 正文
  role: 'user' | 'assistant' | 'system'; // 三元角色
  timestamp: Date; // 展示时间
  // thinkContent、isStreaming、attachments 等字段略
  searchOrganic?: SearchOrganicItem[] | null; // 可选：助手联网来源；undefined 未设置；null JSON 常转 undefined
} // Message 结束

export type AgentSessionDetailPayload = { // 导出类型：GET 会话详情 HTTP 响应体
  session: { // 会话摘要；无权或不存在时为 null（见 hydrate 分支）
    sessionId: string; // 会话 id
    title: string | null; // 标题可空
    createdAt: string; // ISO 时间串
    updatedAt: string; // ISO 时间串
  } | null; // session 整体可 null
  messages: Array<{ // 消息数组
    id: string; // 服务端消息主键 → hydrate 后作 chatId
    turnId: string | null; // 成对删除键
    role: string; // 原始角色字符串
    content: string; // 正文
    searchOrganic?: SearchOrganicItem[] | null; // 与 DB JSON 列对应
    createdAt: string; // ISO 创建时间
  }>; // messages 结束
}; // AgentSessionDetailPayload 结束
```

---

## 5. 关键代码摘录（带讲解注释）

**与 §4 的关系**：§5 中若与 §4「实现摘录」**源码重复**的小节，为避免同一逻辑维护两套逐行注释，仅保留**本节标题 + 来源 + 互指**；**逐行 `//` 注释以 §4 对应小节为准**。§5 独有或裁剪不同的片段仍在本节下列出并逐行注释。

### 5.1 后端：`WebSearchService` 中与 organic 回调相关的完整实现

**来源**：`apps/backend/src/services/web-search/web-search.service.ts`（约 L20–L87）

**逐行注释**：见 **§4.2** 实现摘录代码块（`resolveProvider`、`formatSearchContextForPrompt`、`createLangChainWebSearchTools` 已按行行尾 `//` 标注）。

### 5.2 后端：工具组装传入回调

**来源**：`apps/backend/src/services/agent/agent-tools.ts`（约 L33–L41）

**逐行注释**：见 **§4.3** 实现摘录代码块。

### 5.3 后端：合并、推送、落库（摘录）

**来源**：`apps/backend/src/services/agent/agent.service.ts`（`runChatStream` 内，约 L364–L398、L479–L501）

**逐行注释**：见 **§4.6** 实现摘录代码块（`finalizeTurn`、`cleanupTurnOnFailure`、`buildAgentLangChainTools` 闭包等）。

### 5.4 后端：SSE `map` 分支

**来源**：`apps/backend/src/services/agent/agent.controller.ts`（约 L85–L104）

**逐行注释**：见 **§4.7** 实现摘录中 `map((chunk) => { ... })` 代码块。

### 5.5 前端：`unwrapAgentPayload` 与 `searchOrganic` 分支

**来源**：`apps/frontend/src/utils/agentSse.ts`（约 L26–33、L146–151）

**逐行注释**：见 **§4.11** 实现摘录代码块（含完整 `unwrapAgentPayload`、`AgentSseCallbacks` 与主循环 `searchOrganic` 分支）。

### 5.6 前端：`englishAgent` 分离更新正文与 organic

**来源**：`apps/frontend/src/store/englishAgent.ts`（约 L227–265）

**逐行注释**：见 **§4.12**（`patchAssistant` / `patchAssistantOrganic`）；`sendMessage` 内 `streamAgentSse` 的 `callbacks` 拼装见源文件。

### 5.7 前端：`applyIfCitation` 仅命中胶囊 `<a>`

**来源**：`apps/frontend/src/components/design/ChatAssistantMessage/index.tsx`（约 L302–L305）

**逐行注释**：见 **§4.14** 实现摘录中 `applyIfCitation` 与 `useEffect` 监听整段。

### 5.8 前端：英语学习外层容器

**来源**：`apps/frontend/src/views/englishLearning/index.tsx`（约 L54–76）

**逐行注释**：见 **§4.16** 实现摘录代码块。

### 5.9 前端：胶囊样式选择器（摘录）

**来源**：`apps/frontend/src/index.css`（约 L96–L119）

**逐行注释**：见 **§4.17** 实现摘录代码块。

### 5.10 前端：`injectOrganicCitationAnchorsIntoMarkdownHtml`（完整实现）

**来源**：`apps/frontend/src/utils/organicCitation.ts`（约 L115–L163，`PRE_BLOCK_SPLIT_RE` 见同文件约 L67）

**逐行注释**：见 **§4.20b** 中 `injectOrganicCitationAnchorsIntoMarkdownHtml` 代码块。

### 5.11 前端：Markdown 阶段的 `applyOrganicCitationAnchors`（占位符版）

**来源**：`apps/frontend/src/utils/organicCitation.ts`（约 L178–L232）

**逐行注释**：见 **§4.20b** 中 `applyOrganicCitationAnchors` 代码块。

### 5.12 前端：`normalizePersistedOrganicAnchorsInMarkdown` 与 `organicCitationMarker`

**来源**：`apps/frontend/src/utils/organicCitation.ts`（约 L30–L32、L55–L64）

**逐行注释**：见 **§4.20** 实现摘录（`PERSISTED_ORGANIC_ANCHOR_RE`、`organicCitationMarker`、`normalizePersistedOrganicAnchorsInMarkdown`）。

### 5.13 前端：预览条目解析与「最近 `<a>`」命中

**来源**：`apps/frontend/src/utils/organicCitation.ts`（约 L257–L275、`findClosestOrganicCitationAnchor` 约 L428–L453）

**逐行注释**：见 **§4.21** 实现摘录（`resolveSearchOrganicFromCitationAnchor`、`resolveOrganicCitationPreviewItems`、`findClosestOrganicCitationAnchor`）。

### 5.14 后端：`mergeAgentSearchOrganic`、`withAgentOrganicPositions`、`AgentSseChunk`

**来源**：`apps/backend/src/services/agent/agent.service.ts`（约 L57–L125）

**逐行注释**：`mergeAgentSearchOrganic` 与 `withAgentOrganicPositions` 见 **§4.4**；`AgentSseChunk` 联合类型见 **§4.7**。

### 5.15 后端：`getSessionDetail` 消息映射（含 `searchOrganic`）

**来源**：`apps/backend/src/services/agent/agent.service.ts`（约 L233–L258）

**逐行注释**：见 **§4.10** 实现摘录中 `messages.map` 片段（与 `listMessagesAsc` 同表）。

### 5.16 后端：`insertUserAndAssistantPlaceholder`、`updateAssistantContent`、`listMessagesAsc`

**来源**：`apps/backend/src/services/agent/agent-memory.service.ts`（约 L193–L267）

**逐行注释**：`insertUserAndAssistantPlaceholder` 见 **§4.25**；`updateAssistantContent` 见 **§4.9**；`listMessagesAsc` 见 **§4.10**。

### 5.17 后端：`AgentMessage` 实体（`search_organic` 列）

**来源**：`apps/backend/src/services/agent/agent-message.entity.ts`（约 L18–L53；`@ManyToOne`/`session` 等见源文件）

**逐行注释**：核心列与索引见 **§4.8**；若需与仓库 1:1 对齐含 `session` 关系字段，以实体源文件为准。

### 5.18 后端：非 Markdown 管线用的 `applyOrganicCitationAnchors`（直接输出 `<a>`）

**来源**：`apps/backend/src/services/web-search/organic-citation.ts`（约 L1–L81，与前端占位符版语义对齐、输出为 HTML）

**逐行注释**：见 **§4.24b** 实现摘录代码块。

### 5.19 前端：`ChatAssistantMessage` 正文流水线 + `StreamingMarkdownBody` 注入钩子

**来源**：`apps/frontend/src/components/design/ChatAssistantMessage/index.tsx`（约 L204–L230、L519–L536）

**逐行注释**：见 **§4.13** 实现摘录（`bodyText`、`injectSearchOrganicAnchorsHtml`、`<StreamingMarkdownBody />`）。

### 5.20 前端：`StreamingMarkdownBody` 对 markdown 段调用 `render` 与后处理

**来源**：`apps/frontend/src/components/design/ChatAssistantMessage/StreamingMarkdownBody.tsx`（约 L107–L123）

**逐行注释**：见 **§4.22** 实现摘录代码块。

### 5.21 前端：`streamAgentSse` 解析循环（含 `searchOrganic` 分支）

**来源**：`apps/frontend/src/utils/agentSse.ts`（约 L100–L167）

```typescript
readLoop: while (true) { // 带标签 while：便于内层 `break readLoop` 一次跳出多层
  const { done, value } = await reader.read(); // 读取下一块 Uint8Array；done 表示流结束
  if (done) { // 无更多字节
    finish(); // 收尾：关 loading、清 isStreaming 等（见源文件）
    break; // 退出最外层循环
  } // if done 结束
  const chunk = decoder.decode(value, { stream: true }); // UTF-8 解码；stream:true 允许多字节字符跨块
  buffer += chunk; // 拼到行缓冲
  const lines = buffer.split('\n'); // 按换行切完整行；末元素可能为半行
  buffer = lines.pop() || ''; // 最后一行若无换行符则放回 buffer 等待下次

  for (const line of lines) { // 处理本批完整行
    const trimmed = line.trim(); // 去首尾空白（兼容 CRLF 等）
    if (!trimmed.startsWith('data:')) continue; // 非 SSE data 行跳过
    const dataStr = trimmed.slice(5).trimStart(); // 去掉前缀 `data:` 取 JSON 文本
    if (!dataStr) continue; // 空载荷跳过

    let raw: Record<string, unknown>; // 声明：解析后的最外层对象
    try { // JSON.parse 可能抛错
      raw = JSON.parse(dataStr) as Record<string, unknown>; // 反序列化单行
    } catch { // 坏 JSON
      Toast({ type: 'error', title: 'Agent 流解析失败' }); // 用户可见错误提示
      continue; // 丢弃本行继续读
    } // try-catch 结束

    const parsed = unwrapAgentPayload(raw); // 剥 Nest 包装，得到与 §4.11 一致的载荷形状

    if (typeof parsed.error === 'string' && parsed.error) { // 服务端显式错误帧
      finish(parsed.error); // 带错误文案结束
      break readLoop; // 跳出 readLoop
    } // if error 结束
    if (parsed.done === true) { // 正常结束帧
      finish(); // 无错误收尾
      break readLoop; // 跳出 readLoop
    } // if done 结束
    if ( // 正文增量分支
      parsed.type === 'content' && // 类型为 content
      typeof parsed.content === 'string' && // content 字段为字符串
      parsed.content // 且非空串（空串不回调，减少无意义 render）
    ) {
      onDelta(parsed.content); // 交给 Store patchAssistant
      continue; // 本行已消费
    } // if content 结束
    if ( // searchOrganic 分支：与 content 独立，避免互相覆盖
      parsed.type === 'searchOrganic' && // 类型为联网来源快照
      Array.isArray(parsed.organic) // organic 必须为数组
    ) {
      onSearchOrganic?.(parsed.organic as SearchOrganicItem[]); // 可选：整表替换助手 searchOrganic
      continue; // 已消费
    } // if searchOrganic 结束
    if (parsed.type === 'tool') { // 工具起止事件（与 organic 无关但同管解析顺序）
      const rawTool = parsed.raw as // 控制器 map 将 tool 详情放在 raw
        | { phase?: string; name?: string } // 最小形状：供 UI 展示
        | undefined; // 可能缺省
      const phase = rawTool?.phase; // 取 phase
      if (phase === 'start' || phase === 'end') { // 仅关心起止两相
        onTool?.({ // 可选回调
          phase, // start | end
          name: // 工具名可选
            typeof rawTool?.name === 'string' // 运行时收窄
              ? rawTool.name // 字符串则下传
              : undefined, // 否则 undefined
        }); // onTool 参数结束
      } // if phase 结束
    } // if tool 结束
  } // for lines 结束
} // while readLoop 结束
```

### 5.22 前端：`englishAgent.sendMessage` 请求体与 SSE 回调

**来源**：`apps/frontend/src/store/englishAgent.ts`（约 L227–L275，含 `patchAssistant` / `patchAssistantOrganic` 定义）

```typescript
let accumulated = ''; // sendMessage 闭包内：本轮助手正文缓冲，与 patchAssistant 共享

const patchAssistant = (delta: string) => { // 定义：仅合并正文（逐行语义同 §4.12）
  if (delta) accumulated += delta; // 有增量才累加
  runInAction(() => { // MobX action
    const idx = this.messages.findIndex((m) => m.chatId === assistantChatId); // 找当前助手行
    if (idx < 0) return; // 未找到则返回
    const prev = this.messages[idx] as Message; // 保留其它字段
    this.messages[idx] = { // 写回新对象
      ...prev, // 展开旧消息
      content: accumulated, // 只覆盖 content
    }; // 对象字面量结束
  }); // runInAction 结束
}; // patchAssistant 结束

const patchAssistantOrganic = (organic: SearchOrganicItem[]) => { // 定义：只改 searchOrganic
  runInAction(() => { // MobX action
    const idx = this.messages.findIndex((m) => m.chatId === assistantChatId); // 同上
    if (idx < 0) return; // 未找到
    const prev = this.messages[idx] as Message; // 保留 content 等
    this.messages[idx] = { // 写回
      ...prev, // 展开
      searchOrganic: organic, // 覆盖 organic 列表
    }; // 字面量结束
  }); // runInAction 结束
}; // patchAssistantOrganic 结束

const outgoing = this.buildOutgoingContent(userText); // 拼 outgoing：档位行、意图前缀等

const abort = await streamAgentSse({ // 发起 SSE：返回 abort 句柄（见源文件停止逻辑）
  body: { // JSON body：AgentChatDto 形状
    sessionId: sid, // 当前会话 id（可能新建后写入）
    content: outgoing, // 用户可见内容 + 约定前缀
    assistMode: 'english_learning', // 固定：触发英语追加系统提示
  }, // body 结束
  callbacks: { // 流式回调：与 §5.21 解析分支一一对应
    onDelta: (d) => patchAssistant(d), // 正文走 accumulated + patchAssistant
    onSearchOrganic: (organic) => patchAssistantOrganic(organic), // organic 独立 patch
    onTool: (ev) => { // 工具 UI 状态
      runInAction(() => { // 更新 observable toolStatus
        this.toolStatus = // 展示字符串或清空
          ev.phase === 'start' // 工具开始
            ? ev.name // 若有工具名
              ? `调用工具：${ev.name}…` // 具名提示
              : '检索中…' // 无名时泛化「检索」
            : null; // end 相清空状态
      }); // runInAction 结束
    }, // onTool 结束
    // onComplete / onError …见源文件
  }, // callbacks 结束
}); // streamAgentSse 结束
```

### 5.23 前端：`AgentSessionDetailPayload` 类型

**来源**：`apps/frontend/src/service/index.ts`（约 L377–L392）

**逐行注释**：见 **§4.26** 实现摘录中 `AgentSessionDetailPayload` 类型块。

---

## 6. 兼容性与运维

| 项目 | 说明 |
|------|------|
| **数据库** | 增加 `search_organic`（JSON，可空）；未迁移则查询报错。 |
| **模型** | 须按提示输出 **【n】** 才有内联胶囊；仅有 `searchOrganic` 时仍有列表入口与抽屉。 |
| **Chat 与英语学习** | 共用 `ChatAssistantMessage` / `organicCitation`；英语学习额外 **`message-md-wrap`** 与 **非 Label 包裹**。 |

---

## 7. 建议回归用例

1. 英语学习发送需联网问题 → 流式过程中出现 **「已阅读 n 个网页」** 且正文出现 **【1】** → 渲染胶囊；打开抽屉链接正确。  
2. 同一轮多次 `internet_search` → organic **去重**、序号连续；SSE **多次** `searchOrganic` 后前端列表为最后一次的**全集**。  
3. 刷新 / `?session=` → **hydrate** 后胶囊与抽屉数据仍在。  
4. 点击正文空白、列表段落 → **不**打开抽屉；仅显式入口与外链行为符合预期。  
5. 鼠标仅在胶囊 pill 上 → 预览出现；在胶囊旁同一行文字 → **不**出现预览（若仍出现需查是否有其它带 `href` 且匹配 organic 的内联链接）。

---

## 8. 相关路径索引

| 说明 | 路径 |
|------|------|
| Chat 联网与 organic | `docs/chat/联网搜索.md` |
| 占位符与 HTML 注入（前端） | `apps/frontend/src/utils/organicCitation.ts` |
| 角标转 `<a>`（后端，非 md-it 管线） | `apps/backend/src/services/web-search/organic-citation.ts` |
| WebSearch 类型定义 | `apps/backend/src/services/web-search/web-search.types.ts` |
| Agent 英语学习 SPEC | `apps/backend/specs/agent-english-learning-spec.md`、`apps/frontend/specs/agent-english-learning-frontend-spec.md` |
