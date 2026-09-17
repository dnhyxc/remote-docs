# 英语学习 Agent：多会话、历史抽屉、新对话草稿与 SSE 消息 ID

## 1. 背景与目标

本轮改动围绕 **英语学习（`english_learning`）与通用 Agent 管线** 的一体化体验：

- **多会话**：前端按会话隔离消息与流式（SSE），切换历史中的其它会话时，不强制中断后台仍在输出的会话。
- **历史抽屉**：可分页拉取会话列表、滚动加载更多；选中会话后与 URL `session` 对齐；优化关闭顺序以避免 Radix Sheet 抖动。
- **新对话**：点击「新对话」时清空当前展示会话与历史高亮，**不预创建**空服务端会话，首条用户消息发送时再 `ensureSession` 创建。
- **快捷意图（intentPrefix）**：仅影响本轮模型输入，**不入库**；由后端在构建 LangChain 消息时注入。
- **分享与库表对齐**：占位发送后由服务端返回真实 `userMessageId` / `assistantMessageId`，经 SSE 推送到前端，替换本地 UUID，便于分享等能力使用数据库主键。

本文按**功能点**拆解实现思路，并在代码块内附**讲解用中文注释**（便于单独阅读归档）。**若与仓库最新源码不一致，以源码为准。**

---

## 2. 改动范围（路径清单）

| 层级 | 路径 |
|------|------|
| 后端 | `apps/backend/src/services/agent/agent.controller.ts`、`agent.service.ts`、`agent-memory.service.ts`、`dto/agent-chat.dto.ts`（若 diff 含字段扩展） |
| 前端 Store / 页面 | `apps/frontend/src/store/englishAgent.ts`、`views/englishLearning/index.tsx`、`EntryToolbar.tsx`、`History.tsx`、`AgentPanel.tsx`（抽屉打开时刷新列表等） |
| 前端 HTTP / SSE | `apps/frontend/src/service/api.ts`、`service/index.ts`、`utils/agentSse.ts` |
| 其它 | `apps/frontend/src/components/design/Share` / `createShare` 的 `sessionType` 含 `'agent'` 等（与 Agent 会话分享类型对齐） |

---

## 3. 功能点与实现过程

### 3.1 后端：分页列出当前用户的 Agent 会话

**问题**：历史抽屉需要「按更新时间倒序」的会话列表，且须避免动态路由把 `sessions` 误匹配为 `session/:id`。

**做法**：

- 在 `AgentController` 增加 `GET /agent/sessions`，**声明顺序**放在 `@Get('session/:sessionId')` 之前（Nest 按注册顺序匹配）。
- `AgentService.listSessions` 使用 QueryBuilder：`user_id` 过滤、`updated_at DESC`、`skip/take` 分页，并限制 `pageSize` 上限。

**来源**：`apps/backend/src/services/agent/agent.controller.ts`（约 L47–L72，`listSessions` 方法）

```typescript
// 说明：分页查询参数从 querystring 读取，做下限/上限 clamp，避免异常字符串拖垮 DB
/** 分页列出当前用户的 Agent 会话（须放在 `session/:id` 之前避免被误匹配） */
@Get('sessions')
async listSessions(
	@Req() req: AuthedRequest,
	@Query('pageNo') pageNo?: string,
	@Query('pageSize') pageSize?: string,
) {
	const userId = req.user?.userId;
	if (userId == null) {
		return { success: false, message: '未登录' };
	}
	const pn = Math.max(1, parseInt(pageNo ?? '1', 10) || 1);
	const ps = Math.min(50, Math.max(1, parseInt(pageSize ?? '20', 10) || 20));
	const data = await this.agentService.listSessions(userId, pn, ps);
	return {
		success: true,
		data: {
			...data,
			// 说明：序列化为 ISO 字符串，便于前端 JSON 反序列化后直接展示/排序
			list: data.list.map((row) => ({
				...row,
				createdAt: row.createdAt.toISOString(),
				updatedAt: row.updatedAt.toISOString(),
			})),
		},
	};
}
```

**来源**：`apps/backend/src/services/agent/agent.service.ts`（约 L232–L270，`listSessions` 方法）

```typescript
/**
 * 分页列出当前用户的 Agent 会话（按更新时间倒序，供英语学习历史抽屉）
 */
async listSessions(
	userId: number,
	pageNo = 1,
	pageSize = 20,
): Promise<{
	list: Array<{
		sessionId: string;
		title: string | null;
		createdAt: Date;
		updatedAt: Date;
	}>;
	pageNo: number;
	pageSize: number;
	total: number;
}> {
	const pn = Math.max(1, Math.floor(pageNo));
	const ps = Math.min(50, Math.max(1, Math.floor(pageSize)));
	const qb = this.sessionRepo
		.createQueryBuilder('s')
		.where('s.user_id = :uid', { uid: userId })
		.orderBy('s.updated_at', 'DESC')
		.skip((pn - 1) * ps)
		.take(ps);
	const [rows, total] = await qb.getManyAndCount();
	return {
		list: rows.map((r) => ({
			sessionId: r.id,
			title: r.title,
			createdAt: r.createdAt,
			updatedAt: r.updatedAt,
		})),
		pageNo: pn,
		pageSize: ps,
		total,
	};
}
```

---

### 3.2 后端：占位落库后下发 `messageIds`（SSE chunk）

**问题**：前端先用 UUID 占位 UI 行，落库后需要换成数据库消息 ID，否则分享勾选与后端不一致。

**做法**：

- `AgentMemoryService.insertUserAndAssistantPlaceholder` 返回 `{ userMessageId, assistantMessageId }`。
- 流式 `subscriber.next` 增加 `type: 'messageIds'` 的 chunk；`AgentController.chatSse` 的 `map` 分支将其原样包进 `data`。

**来源**：`apps/backend/src/services/agent/agent.service.ts`（约 L492–L505，流内占位与推送）

```typescript
// （3）新一轮对话 turn：先插入 user/assistant 占位行，拿到真实 UUID（数据库主键）
const { userMessageId: uid, assistantMessageId: aid } =
	await this.memory.insertUserAndAssistantPlaceholder(
		session,
		turnId,
		dto.content.trim(),
	);
assistantMessageId = aid;
// 说明：尽快推给客户端，使 UI 行 chatId 与 DB 对齐，后续分享按 messageIds 勾选才可靠
subscriber.next({
	type: 'messageIds',
	data: { userMessageId: uid, assistantMessageId: aid },
});
```

**来源**：`apps/backend/src/services/agent/agent.controller.ts`（约 L113–L133，`chatSse` 内对 chunk 的映射）

```typescript
if (chunk.type === 'messageIds') {
	return {
		data: {
			type: 'messageIds',
			userMessageId: chunk.data.userMessageId,
			assistantMessageId: chunk.data.assistantMessageId,
			done: false,
		},
	};
}
```

---

### 3.3 后端：`english_learning` 下 `intentPrefix` 仅注入模型输入

**问题**：快捷意图若写进 DB 的 user content，会污染历史与分享语义。

**做法**：DB 仍存用户纯文本 `dto.content`；构建 `lcMessages` 后，若为 `english_learning` 且带 `intentPrefix`，从**最后一条 HumanMessage** 起向前找到第一条 Human，将内容改写为 `` `${intent}\n\n${plain}` `` 再交给模型（仅内存中的 LC 消息数组）。

**来源**：`apps/backend/src/services/agent/agent.service.ts`（约 L507–L531）

```typescript
// （4）构建 langchain message 历史（user 行入库为纯 content；intentPrefix 仅注入本轮模型输入）
const lcMessages = await this.memory.buildLangChainMessagesFromDb(sessionId);
const intent =
	dto.assistMode === 'english_learning' ? dto.intentPrefix?.trim() : undefined;
if (intent) {
	// 说明：从尾部向前找「当前轮」对应的 HumanMessage（占位插入后通常在末尾附近）
	for (let i = lcMessages.length - 1; i >= 0; i -= 1) {
		const msg = lcMessages[i];
		if (!(msg instanceof HumanMessage)) continue;
		const c = msg.content;
		const plain =
			typeof c === 'string'
				? c
				: Array.isArray(c)
					? (c as { text?: string }[])
							.map((p) => (typeof p?.text === 'string' ? p.text : ''))
							.join('')
					: String(c ?? '');
		lcMessages[i] = new HumanMessage(`${intent}\n\n${plain}`);
		break;
	}
}
```

---

### 3.4 前端 HTTP：`GET /agent/sessions` 封装

**来源**：`apps/frontend/src/service/api.ts`（常量 `AGENT_SESSIONS`，约 L112 附近，以仓库为准）

```typescript
// 说明：与 AGENT_SESSION（单条会话 REST）区分，列表走复数路径
export const AGENT_SESSIONS = '/agent/sessions';
```

**来源**：`apps/frontend/src/service/index.ts`（约 L417–L440，`listAgentSessions`）

```typescript
export type AgentSessionListRow = {
	sessionId: string;
	title: string | null;
	createdAt: string;
	updatedAt: string;
};

/** 分页列出当前用户的 Agent 会话（按更新时间倒序） */
export const listAgentSessions = async (params: {
	pageNo?: number;
	pageSize?: number;
}) => {
	return await http.get<{
		list: AgentSessionListRow[];
		pageNo: number;
		pageSize: number;
		total: number;
	}>(AGENT_SESSIONS, {
		querys: {
			pageNo: params.pageNo ?? 1,
			pageSize: params.pageSize ?? 20,
		},
	});
};
```

---

### 3.5 前端 Store：`stateBySession` 多会话与 `activeSessionId`

**思路**：`activeSessionId` 表示「当前主界面展示的会话」；`stateBySession[sid]` 持有该会话的 `messages`、`isSending`、`abortStream` 等。`sessionId` getter 指向 `activeSessionId` 以兼容分享等旧读法。

**来源**：`apps/frontend/src/store/englishAgent.ts`（约 L53–L120，核心字段与派生 getter 摘录）

```typescript
export class EnglishAgentStore {
	/** 当前界面展示的会话 id（与 URL session 对齐） */
	activeSessionId: string | null = null;
	sessionTitle: string | null = null;
	/** 各会话独立状态，支持后台会话继续流式（Server-Sent Events 消费） */
	stateBySession: Record<string, EnglishSessionRuntime> = {};
	/** 正在消费 SSE 的会话（停止生成、工具条归属） */
	streamingSessionId: string | null = null;

	sessionList: Array<{
		sessionId: string;
		title: string | null;
		createdAt: string;
		updatedAt: string;
	}> = [];
	sessionsPage = { pageNo: 1, pageSize: 20, total: 0 };
	historySessionLoading = false;
	historySessionLoadingMore = false;

	/** 兼容旧命名：分享、URL 等仍读 sessionId */
	get sessionId(): string | null {
		return this.activeSessionId;
	}

	get messages(): Message[] {
		const sid = this.activeSessionId;
		if (!sid) return [];
		return this.stateBySession[sid]?.messages ?? [];
	}

	get toolStatus(): string | null {
		const streamSid = this.streamingSessionId;
		const active = this.activeSessionId;
		// 说明：仅当「正在流式」的会话就是当前展示会话时，才在工具条展示 tool 文案
		if (!streamSid || streamSid !== active) return null;
		return this.stateBySession[streamSid]?.toolStatus ?? null;
	}
}
```

---

### 3.6 前端 Store：切换会话、刷新列表、滚动加载

- **`switchSession`**：先切 `activeSessionId`；若该会话本地已有消息或正在拉历史/发送，则不再请求详情（减少重复 IO）。
- **`refreshSessionList` / `loadMoreSessionList`**：对接 `listAgentSessions`；加载更多时用 `Set` 去重追加。
- **`onHistorySessionViewportScroll`**：距底部小于阈值时触发下一页（与知识库助手历史类似）。

**来源**：`apps/frontend/src/store/englishAgent.ts`（约 L231–L347）

```typescript
/**
 * 切换当前展示的会话；若本地已有消息 / 正在拉历史 / 正在发送，不重复拉取。
 * 不中止其它会话的 SSE。
 */
async switchSession(sessionId: string): Promise<void> {
	if (!readToken()) return;
	const sid = (sessionId ?? '').trim();
	if (!sid) return;
	runInAction(() => {
		this.activeSessionId = sid;
	});
	const st = this.ensureSessionState(sid);
	if (st.messages.length > 0 || st.isHistoryLoading || st.isSending) {
		const row = this.sessionList.find((s) => s.sessionId === sid);
		if (row?.title != null) {
			runInAction(() => {
				this.sessionTitle = row.title;
			});
		}
		return;
	}
	runInAction(() => {
		st.isHistoryLoading = true;
	});
	try {
		const res = await getAgentSessionDetail(sid);
		const payload = res.data;
		const sess = payload?.session;
		runInAction(() => {
			if (!sess) {
				st.messages = [];
			} else {
				this.sessionTitle = sess.title;
				st.messages = mapApiMessagesToUi(payload.messages ?? []);
			}
		});
	} finally {
		runInAction(() => {
			st.isHistoryLoading = false;
		});
	}
}

onHistorySessionViewportScroll = (e: UIEvent<HTMLElement>) => {
	if (this.historySessionLoading) return;
	if (this.historySessionLoadingMore) return;
	if (!this.hasMoreHistorySessions) return;
	const el = e.currentTarget;
	const remaining = el.scrollHeight - el.scrollTop - el.clientHeight;
	if (remaining > 80) return;
	void this.loadMoreSessionList();
};
```

---

### 3.7 功能点：新对话草稿 + 页面 URL 清空

**目标**：历史列表高亮依赖 `activeSessionId === row.sessionId`；新对话应**无选中行**，且不在点击时预创建空会话；首条发送走 `ensureSession`。

**来源**：`apps/frontend/src/store/englishAgent.ts`（约 L349–L358，`beginNewConversationDraft`）

```typescript
/**
 * 新对话草稿：清空当前展示会话的选中态（历史列表无高亮），主区显示空态；
 * 不立即创建服务端会话，首条发送时由 ensureSession 创建；不中断其它会话的 SSE。
 */
beginNewConversationDraft(): void {
	runInAction(() => {
		this.activeSessionId = null;
		this.sessionTitle = null;
		this.loadError = null;
	});
}
```

**来源**：`apps/frontend/src/views/englishLearning/EntryToolbar.tsx`（约 L103–L114，「新对话」按钮）

```typescript
onClick={() => {
	if (isSessionSwitcherLocked) {
		Toast({
			type: 'info',
			title: t('knowledge.assistant.sessionSaving'),
		});
		return;
	}
	setIsHistoryDrawerOpen(false); // 说明：避免历史抽屉与新对话态叠在一起
	englishAgentStore.beginNewConversationDraft(); // 说明：清空 activeSessionId，去掉历史高亮
	void onNewConversation(); // 说明：父级负责清 URL、停 TTS 等
}}
```

**来源**：`apps/frontend/src/views/englishLearning/index.tsx`（约 L55–L59，`onNewChat`）

```typescript
const onNewChat = useCallback(() => {
	stopAllPlayback();
	intentInputAutoFillRef.current = null;
	// 说明：去掉 ?session=，避免 hydrate 再次绑回旧会话
	setSearchParams({}, { replace: true });
}, [setSearchParams]);
```

#### 3.7.1 发送消息时的 `titleFallback`（按会话区分）

**问题**：若将 `titleFallback` 固定为路由文案 `t('route.englishLearning.title')`，则通过 `ensureSession` 调用 `createAgentSession` 时，**新会话**在列表中的标题千篇一律，无法与首条用户内容或当前已有会话标题区分。

**做法**（`index.tsx` 的 `sendMessage`）：在调用 `englishAgentStore.sendMessage` 前按优先级计算标题兜底串：

1. **`englishAgentStore.sessionTitle`**：当前展示会话已有服务端标题时优先使用（与 `activeSessionId` 对应，切换历史后会随 `hydrateSession` / `switchSession` 更新）。
2. **首条消息摘要**：新草稿（无 `sessionTitle`）时，将本次发送的正文压空白、超过 **36** 个字符截断并加 `…`，作为新建会话的 `title` 传入 API。
3. **`t('route.englishLearning.title')`**：极端兜底（理论上在 `text` 非空时几乎不会落到此分支）。

Store 内仍满足 `options?.titleFallback ?? this.sessionTitle ?? '英语学习'`；本页显式传入的 `titleFallback` 在**新建会话**路径下会参与 `createAgentSession` 的 `title`；已有 `activeSessionId` 时 `ensureSession` 直接返回，该参数不参与落库，但传入「当前会话标题」与 Store 一致，避免闭包陈旧（每次发送从 Store 现读 `sessionTitle`）。

**来源**：`apps/frontend/src/views/englishLearning/index.tsx`（约 L80–L100，`sendMessage`）

```typescript
const sendMessage = useCallback(async () => {
	const text = input.trim();
	if (!text) return;
	intentInputAutoFillRef.current = null;
	setInput('');
	// 创建会话时的 title：已有会话用服务端标题；新会话用首条消息摘要；最后才用路由默认名
	const sessionTitle = englishAgentStore.sessionTitle?.trim();
	const collapsed = text.replace(/\s+/g, ' ');
	const synopsis =
		collapsed.length > 36 ? `${collapsed.slice(0, 36)}…` : collapsed;
	await englishAgentStore.sendMessage(text, {
		titleFallback:
			sessionTitle || synopsis || t('route.englishLearning.title'),
	});
	if (englishAgentStore.sessionId) {
		setSearchParams(
			{ session: englishAgentStore.sessionId },
			{ replace: true },
		);
	}
}, [input, setSearchParams, t]);
```

---

### 3.8 功能点：历史项点击 —— 先关抽屉再切会话（防抖）

**原因**：若在 Sheet 仍打开时同时 `setSearchParams` 与 MobX 大更新，易与 Radix 关闭动画抢帧，出现抽屉「抖」。

**做法**：在 `onClick` 第一行同步 `setIsHistoryDrawerOpen(false)`，再 `switchSession`，最后在 `then` 里更新 URL 与贴底滚动。

**来源**：`apps/frontend/src/views/englishLearning/History.tsx`（约 L101–L114）

```typescript
onClick={() => {
	// 说明：先关抽屉再切会话与同步 URL，避免 Sheet 仍打开时路由/MobX 大重绘与 Radix 关闭动画抢帧导致抖动
	setIsHistoryDrawerOpen(false);
	void englishAgentStore
		.switchSession(s.sessionId)
		.then(() => {
			setSearchParams({ session: s.sessionId }, { replace: true });
			enableStreamStickToBottom();
			flushScrollToBottom();
			requestAnimationFrame(() => flushScrollToBottom());
		});
}}
```

---

### 3.9 前端 SSE：解析 `messageIds` 事件

**来源**：`apps/frontend/src/utils/agentSse.ts`（约 L159–L168，解析循环内分支）

```typescript
if (
	parsed.type === 'messageIds' &&
	typeof parsed.userMessageId === 'string' &&
	typeof parsed.assistantMessageId === 'string'
) {
	// 说明：回调给 Store，由 Store 把占位 UUID 替换为数据库 id
	onMessageIds?.({
		userMessageId: parsed.userMessageId,
		assistantMessageId: parsed.assistantMessageId,
	});
	continue;
}
```

**来源**：`apps/frontend/src/store/englishAgent.ts`（约 L561–L597，`sendMessage` 内 `streamAgentSse` 回调摘录）

```typescript
callbacks: {
	onMessageIds: ({ userMessageId, assistantMessageId }) => {
		runInAction(() => {
			const ui = st.messages.findIndex((m) => m.chatId === userRowId);
			const ai = st.messages.findIndex((m) => m.chatId === assistantRowId);
			if (ui >= 0) {
				const prev = st.messages[ui] as Message;
				st.messages[ui] = { ...prev, chatId: userMessageId };
			}
			if (ai >= 0) {
				const prev = st.messages[ai] as Message;
				st.messages[ai] = { ...prev, chatId: assistantMessageId };
			}
			// 说明：后续流式 patch 仍用 assistantRowId 变量查找行，需同步改为服务端 id
			userRowId = userMessageId;
			assistantRowId = assistantMessageId;
		});
	},
	// ...
}
```

---

### 3.10 分享类型扩展（简述）

`createShare` 的 `sessionType` 联合类型增加 `'agent'`，使英语学习 Agent 会话可走与后端一致的分享通道（具体校验与落库见 `share` 服务改动，此处不展开）。

**来源**：`apps/frontend/src/service/index.ts`（约 L758 附近，`createShare` 参数类型）

```typescript
sessionType?: 'chat' | 'assistant' | 'agent';
```

---

### 3.11 补充：新建会话 `updatedAt`、工具状态文案与工具条布局

本轮小改动聚焦 **历史列表排序可靠性** 与 **工具调用轻提示（tool status）** 的展示一致性。

#### 3.11.1 后端：`createSession` 显式写入 `updatedAt`

**问题**：会话列表按 `updated_at DESC` 排序。若 ORM/默认值未在插入瞬间写入 `updatedAt`，新建会话可能排在列表尾部或顺序异常。

**做法**：在 `sessionRepo.create` 时传入 `updatedAt: new Date()`，与 `createdAt` 行为一致，保证新会话立刻参与「最近更新」排序。

**来源**：`apps/backend/src/services/agent/agent.service.ts`（约 L221–L230，`createSession`）

```typescript
async createSession(userId: number, dto?: CreateAgentSessionDto) {
	const id = randomUUID();
	const session = this.sessionRepo.create({
		id,
		userId,
		title: dto?.title?.trim() || null,
		// 说明：与列表接口 orderBy('s.updated_at','DESC') 对齐，避免新行 updated_at 为空导致排序异常
		updatedAt: new Date(),
	});
	await this.sessionRepo.save(session);
	return { sessionId: id, title: session.title };
}
```

#### 3.11.2 前端 Store：`onTool` 状态文案去掉省略号

**做法**：`toolStatus` 在工具 `start` 阶段展示为 `调用工具：${name}` 或 `检索中`（不再后缀 `…`），避免与 UI 加载动画重复表达「进行中」。

**来源**：`apps/frontend/src/store/englishAgent.ts`（约 L598–L606，`sendMessage` → `streamAgentSse` → `onTool`）

```typescript
onTool: (ev) => {
	runInAction(() => {
		st.toolStatus =
			ev.phase === 'start'
				? ev.name
					? `调用工具：${ev.name}`
					: '检索中'
				: null;
	});
},
```

#### 3.11.3 前端：`AgentPanel` 工具状态条与主聊天气泡宽度对齐

**做法**：在会话列激活时，工具状态条外包一层 `max-w-3xl` + 水平内边距，内层 `rounded-md` + `border`，与上方消息区常见最大宽度视觉对齐（非全宽顶栏）。

**来源**：`apps/frontend/src/views/englishLearning/AgentPanel.tsx`（约 L495–L501，主会话列内 `toolStatus` 渲染）

```tsx
{englishAgentStore.toolStatus ? (
	<div className="max-w-3xl px-4.5 py-3">
		<div className="w-full border border-theme/10 rounded-md bg-theme/5 text-textcolor/60 shrink-0 px-4 py-2 text-center text-sm">
			{englishAgentStore.toolStatus}
		</div>
	</div>
) : null}
```

---

## 4. 兼容性与行为变化

- **破坏性**：若外部代码仍写 `englishAgentStore.messages = ...` 等直接改数组（旧单会话模型），需改为通过 `stateBySession` 或 Store 已有方法修改；当前设计以 getter 暴露 `messages`。
- **URL**：无 `session` 参数时可为「草稿」态；发送成功后由调用方写回 `?session=`。
- **新对话**：不再在点击时调用 `createNewSession`（方法仍保留于 Store 供其它场景复用）。
- **新建会话标题**：首条发送时 `titleFallback` 由「当前 `sessionTitle` → 首条正文摘要（36 字）→ 路由默认名」决定，不再写死单一字符串。
- **新建会话排序**：后端创建行时显式设置 `updatedAt`，与历史列表「按更新时间倒序」一致。
- **工具状态条**：主列内改为卡片式容器并与 `max-w-3xl` 对齐；文案不再自带省略号（与 Spinner 等动效分工）。

---

## 5. 建议回归测试

| 场景 | 预期 |
|------|------|
| 打开历史抽屉、点击某条 | 抽屉顺滑关闭，主区切换到对应会话，URL 带 `session` |
| 会话 A 流式中，打开历史切到会话 B | A 的 SSE 不被前端无谓 abort（除非用户停止） |
| 新对话 → 历史列表 | 无行高亮；首条发送后创建会话并写 URL |
| 新对话首条发送 | 历史列表中新会话标题接近首条消息摘要（≤36 字 +「…」），而非固定路由标题 |
| 新会话刚创建后刷新历史 | 新会话应出现在列表靠前位置（`updated_at` 有效） |
| 工具调用进行中 | 主区底部状态为圆角卡片且宽度与聊天气泡区域协调；文案无多余「…」 |
| 带快捷意图发送 | DB 中 user 正文无 intent 前缀；模型侧能收到拼接后的 Human |
| 发送一轮完成后 | 列表标题/时间可通过 `refreshSessionList` 更新（以当前实现为准） |

---

## 6. 相关源码路径速查

| 说明 | 路径 |
|------|------|
| 英语学习页入口与 URL hydrate | `apps/frontend/src/views/englishLearning/index.tsx` |
| 工具条 + 历史子树 | `apps/frontend/src/views/englishLearning/EntryToolbar.tsx`、`History.tsx` |
| MobX 多会话 Store | `apps/frontend/src/store/englishAgent.ts` |
| Agent 列表/详情 HTTP | `apps/frontend/src/service/index.ts`、`service/api.ts` |
| SSE 解析 | `apps/frontend/src/utils/agentSse.ts` |
| 英语学习 Agent 主面板（含工具状态条） | `apps/frontend/src/views/englishLearning/AgentPanel.tsx` |
| 会话列表与 SSE 映射 | `apps/backend/src/services/agent/agent.controller.ts`、`agent.service.ts` |

若与仓库最新源码不一致，以源码为准。
