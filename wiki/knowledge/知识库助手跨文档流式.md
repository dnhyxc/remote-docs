# 知识库助手：切换文档时保持流式输出（影响点说明）

本文记录一次围绕「知识库右侧助手」的状态机改造：当助手正在 **streaming（流式输出）** 时切换到其它文档，再切回原文档，原先会出现「只展示 *思考中...*、流式状态变停止、无法继续看到打字机效果」的问题。本次改动目标是在 **不改变现有产品语义** 的前提下修复该问题，并说明改动的影响范围与潜在风险。

---

## 1. 改动背景与根因

### 1.1 现象

- 文档 A 的助手正在流式输出时切换到文档 B。
- 再切回文档 A：UI 只显示「思考中...」，并且流式状态被置为停止，打字机增量不再继续。

### 1.2 根因（前端状态机层面）

根因主要来自两点（均发生在 `assistantStore` 的“文档切换”与“流式回调写入”路径）：

- **切换文档时中断流式（旧实现）**：`activateForDocument` 曾在切换时 `abortStream` 并重置消息数组，导致 SSE 被打断；**当前实现**已改为仅切 **`activeDocumentKey`** 与按需 hydrate，**不**全局中止其它文档/会话的流式（见 §2.4）。
- **流式回调写错目标**：流式回调（`onDelta/onThinking/onComplete/onError`）若依赖“当前 active 文档”的 getter（例如 `this.messages`），在用户切换文档后会把增量写入到 *切换后的文档* 状态，导致原文档的 UI 看起来“停止/丢失”。

此外，知识页的 `documentKey` 设计包含 `__trash-{trashOpenNonce}` 等后缀，用于 UI 分栏/视图身份；该 key 在切换过程中可能变化。若助手状态按 `documentKey` 原样分桶，会产生**同一条目被拆成多个 state** 的情况，切回时命中“新 key”的空 state，从而退化为「思考中...」。

---

## 2. 本次改动做了什么

改动文件：`apps/frontend/src/store/assistant.ts`。

### 2.0 关键实现代码（带详细注释，便于对照源码）

以下代码块为“摘录 + 注释增强版”，逻辑与当前仓库实现保持一致（以源码为准）。注释尽量解释**为什么要这么做**，而不是复述代码字面含义。

#### 2.0.1 `canonicalKey` 与 `ensureState`：用稳定 key 分桶并确保每个文档有独立 state

```ts
/**
 * 目标：
 * - 解决 `documentKey` 可能携带 `__trash-*` nonce 导致的 state 分裂问题。
 * - 让“同一知识条目”的助手状态（messages/session/streaming 等）绑定到稳定标识，而不是 UI 视图身份。
 *
 * 关键点：
 * - `documentKey` 是 UI 维度身份（可能随 UI nonce 变化）
 * - `bindingId`（去掉 `__trash-*` 后缀）才是“同一条目”的稳定语义
 */
private canonicalKey(documentKey: string): string {
  const raw = (documentKey ?? '').trim();
  if (!raw) return '';

  // 优先用 bindingId（去掉 __trash-* 后缀），让同一条目的 key 稳定
  // 如果解析失败则回退 raw，避免 key 为空造成整个状态机失效
  return knowledgeArticleBindingFromDocumentKey(raw) || raw;
}

/**
 * 目标：
 * - 将 assistant 的运行态从“全局单例字段”改为“按文档分桶”的结构。
 *
 * 为什么必须“按文档分桶”：
 * - 只要允许切换文档不打断流式，就必须允许不同文档同时存在进行中的 SSE；
 *   因此 `abortStream/messages/isSending` 必须与文档绑定，否则会互相覆盖/误停。
 */
private ensureState(documentKey: string) {
  const key = this.canonicalKey(documentKey);

  // 注意：这里返回一个“临时对象”只是为了避免 getter 报错；
  // 业务上发送消息前仍会提示「文档未就绪」，不会真的用空 key 发请求。
  if (!key) {
    return {
      sessionId: null,
      messages: [],
      isHistoryLoading: false,
      isSending: false,
      loadError: null,
      abortStream: null,
      historyHydrated: false,
    };
  }

  // 每个 key 对应一份 state：切换文档只切“指针”，不会清空其它文档的 state
  if (!this.stateByDocument[key]) {
    this.stateByDocument[key] = {
      sessionId: null,
      messages: [],
      isHistoryLoading: false,
      isSending: false,
      loadError: null,
      abortStream: null,
      historyHydrated: false,
    };
  }
  return this.stateByDocument[key];
}
```

#### 2.0.2 `sendMessage`：流式回调绑定“发送时的文档 state”，避免切换后写错目标

```ts
async sendMessage(raw?: string, options?: { extraUserContentForModel?: string }) {
  // 取“当前 UI 指针”对应的 documentKey（可能带 __trash-*）
  const documentKey = (this.activeDocumentKey ?? '').trim();
  if (!documentKey) {
    Toast({ type: 'warning', title: '文档未就绪' });
    return;
  }

  // 使用稳定 key 分桶：避免切换过程中 key 变体导致 state 分裂
  const canonical = this.canonicalKey(documentKey);
  const state = this.ensureState(canonical);

  const text = (raw ?? '').trim();
  // 重要：判断发送/加载必须使用“该文档自己的 state”，而不是全局字段
  if (!text || state.isSending || state.isHistoryLoading) return;

  const ephemeral = !this.knowledgeAssistantPersistenceAllowed;

  // 省略：持久化下 ensureSession / ephemeral 下 token 校验等逻辑...

  // 关键：ephemeral 的多轮上下文，从“该文档自己的消息列表”构建
  // 这样即使切换文档，contextTurns 仍与当时发送的文档一致
  const contextTurns = ephemeral
    ? buildEphemeralContextTurnsFromMessages(state.messages)
    : undefined;

  // 关键：abort 也只 abort 当前文档的流
  state.abortStream?.();
  runInAction(() => {
    state.abortStream = null;
  });

  // push 本轮 user + assistant 占位，写入的是该文档的 state.messages
  // 注意：这确保 UI 在切换回来时能看到“同一份 messages”持续增长
  runInAction(() => {
    state.isSending = true;
    state.messages.push({ role: 'user', content: text, chatId: uuidv4(), timestamp: new Date() });
    state.messages.push({ role: 'assistant', content: '', chatId: uuidv4(), timestamp: new Date(), isStreaming: true, thinkContent: '' });
  });

  // 关键：apply patch 只更新该文档 state.messages
  // 这是修复“切走后 delta 写进别的文档”的核心点
  const applyAssistantPatch = (delta: string, thinkDelta?: string) => {
    // 省略：accumulated/thinkBuf 拼接...
    runInAction(() => {
      // 在 state.messages 里找到占位 assistantChatId 并替换为新对象（触发 MobX 更新）
      // 这里的“替换”比原地 mutate 更稳定（避免子 observer 订阅丢失）
    });
  };

  const abort = await streamAssistantSse({
    body: ephemeral
      ? { ephemeral: true, content: text, contextTurns }
      : { sessionId: '...', content: text },
    callbacks: {
      // 所有回调都只 touch 该 state，而不是 this.messages（避免 activeDocumentKey 改变后串写）
      onDelta: (d) => applyAssistantPatch(d),
      onThinking: (t) => applyAssistantPatch('', t),
      onComplete: async () => {
        runInAction(() => {
          state.isSending = false;
          // 省略：把该文档的 assistant 占位 isStreaming 置为 false...
        });
        state.abortStream = null;

        // 持久化路径下：回填也必须按 canonical key 定位该文档（避免切换后回填到错误文档）
        // await this.fetchSessionMessagesForDocumentKey(canonical);
      },
      onError: () => {
        runInAction(() => {
          state.isSending = false;
          // 省略：收尾该文档 assistant 占位...
        });
        state.abortStream = null;
      },
    },
  });

  state.abortStream = abort;
}
```

#### 2.0.3 `activateForDocument`：切换文档只切“指针”，不再全局 abort / 清空

```ts
async activateForDocument(documentKey: string) {
  const nextKey = (documentKey ?? '').trim();
  if (!nextKey) return;

  // docKey = 稳定 key：同一条目共享同一份 state
  const docKey = this.canonicalKey(nextKey);

  // 关键：只更新 activeDocumentKey（UI 指针），并确保该文档 state 存在
  // 不再在这里 abortStream / messages = []，否则会把“别的文档”的流式打断
  runInAction(() => {
    this.activeDocumentKey = nextKey;
    this.ensureState(docKey);
  });

  // 后续：持久化允许时按需 hydrate 历史（略）
}
```

#### 2.0.4 `clearAssistantStateOnKnowledgeDraftReset`：清理也必须用 canonicalKey，否则会删错桶

```ts
/**
 * 注意：
 * - 这个函数常用于“清空草稿 / 新建草稿”场景。
 * - 在引入 canonicalKey 分桶之后，如果 delete 还用 raw documentKey，会出现：
 *   state 实际存在于 canonicalKey 下，但 delete 用了 rawKey → 视觉上“没清掉对话”。
 */
clearAssistantStateOnKnowledgeDraftReset(syncActiveDocumentKey?: string | null) {
  const rawKey = this.activeDocumentKey;
  const key = rawKey ? this.canonicalKey(rawKey) : '';
  const state = key ? this.ensureState(key) : null;

  // 先停止该文档的 SSE（避免清理后仍有 delta 写入）
  state?.abortStream?.();
  if (state) state.abortStream = null;

  runInAction(() => {
    // 关键：按 canonicalKey 删除，确保删到正确的 state 桶
    if (key) {
      delete this.stateByDocument[key];
      delete this.sessionByDocument[key];
    }

    // 同步 UI 指针（外部把 nextKey 传进来时）
    const next = syncActiveDocumentKey?.trim();
    if (next) {
      this.activeDocumentKey = next;
      // 确保 nextKey 对应 state 存在，避免后续 getter 指向空引用
      this.ensureState(next);
    }
  });
}
```

#### 2.0.5 首次保存时避免“流式状态闪烁”：收尾阶段用“替换对象”而不是原地 mutate

现象：在首次保存知识文档时，助手流式消息明明已经结束（`isStreaming === false`），但在“保存那一瞬间”UI 会短暂回闪为“正在输出”的状态。

实现层面的常见触发原因：

- 保存会触发 `fromKey → toKey` 的映射迁移、`activateForDocument` hydrate、以及一系列可观测状态更新。
- 如果流式收尾（`onComplete/onError/stopGenerating`）是**原地 mutate**（例如 `msg.isStreaming = false`），在这些状态切换叠加时，UI 有机会在某一帧读到旧引用上的旧值，出现闪烁。

解决策略：

- 在所有“流式收尾”路径中，都用 **新对象替换** `messages[idx]`（或替换整个数组元素），确保 MobX/React 观察到的是一次明确的“引用级更新”，避免短暂的不一致读值。

下面是与当前实现一致的关键代码（**逐行注释版**）：

```ts
// 位置：apps/frontend/src/store/assistant.ts（sendMessage 的 SSE callbacks） // 代码所在文件与入口位置
onComplete: async (err) => { // SSE 正常结束/带 error 结束时的收尾回调
  runInAction(() => { // MobX：在 action 中批量修改 observable，避免多次渲染与中间态暴露
    state.isSending = false; // 该文档 state：发送生命周期结束（避免 UI 继续禁用输入/按钮）
    const idx = state.messages.findIndex((m) => m.chatId === assistantChatId); // 在该文档消息列表中定位本轮 assistant 占位
    if (idx < 0) return; // 防御：找不到占位则直接退出（避免越界）

    const prev = state.messages[idx] as Message; // 读取旧消息对象（用于复制其它字段）

    // 关键：不要做 prev.isStreaming = false 这种“原地 mutate” // 避免在 remap/hydrate 的竞态里 UI 读到旧引用的旧值
    // 正确做法：构造 next 并替换数组元素引用，让观察者看到一次明确的“引用级更新” // 让停止态更稳定、避免回闪
    const next: Message = { ...prev, isStreaming: false }; // 用新对象表示“本条消息已停止流式”

    if (err) { // 若 SSE 是带错误结束（服务端 error 字段） // 需要把错误体现在气泡上
      next.content = next.content || `生成失败：${err}`; // 若正文仍为空，用错误信息兜底填充（避免只剩空白）
      next.isStopped = true; // 标记为停止（用于 UI 展示“继续生成”等交互）
    } // if(err) 结束

    state.messages[idx] = next; // 用新对象替换旧对象：触发稳定更新，避免保存瞬间 streaming 状态回闪
  }); // runInAction 结束

  state.abortStream = null; // 清理 abort 引用：该文档不再有进行中的 SSE
}; // onComplete 结束

onError: (e) => { // SSE 读取/解析/网络异常的收尾回调
  runInAction(() => { // 同样在 action 中收尾，避免中间态
    state.isSending = false; // 结束发送态：允许 UI 恢复交互
    const idx = state.messages.findIndex((m) => m.chatId === assistantChatId); // 找到本轮 assistant 占位
    if (idx < 0) return; // 防御：占位丢失则退出

    const prev = state.messages[idx] as Message; // 取旧对象

    // 关键：同样用“替换对象”完成停止态收尾 // 避免在首次保存 remap/hydrate 时回闪到 streaming=true
    state.messages[idx] = { // 用新对象替换旧对象
      ...prev, // 保留 chatId/role/timestamp 等字段
      isStreaming: false, // 明确停止流式
      content: prev.content || e.message, // 若正文为空，用错误信息兜底（避免“思考中...”卡死）
    }; // 替换结束
  }); // runInAction 结束
  state.abortStream = null; // 清理 abort：该文档 SSE 已结束/失败
}; // onError 结束

// 位置：apps/frontend/src/store/assistant.ts（sendMessage 外层 catch） // 捕获 streamAssistantSse 初始化阶段的异常
catch { // 进入 catch 表示：连 SSE 连接都没建立成功或构造期抛错
  runInAction(() => { // 用 action 包住收尾修改
    state.isSending = false; // 恢复发送态：UI 可再次操作
    const idx = state.messages.findIndex((m) => m.chatId === assistantChatId); // 找占位
    if (idx < 0) return; // 防御：无占位则退出
    const prev = state.messages[idx] as Message; // 读取旧对象
    state.messages[idx] = { ...prev, isStreaming: false }; // 替换为“已停止”对象：避免 UI 悬挂在 streaming=true
  }); // runInAction 结束
  state.abortStream = null; // 清理 abort：保证状态一致
} // catch 结束

// 位置：apps/frontend/src/store/assistant.ts（stopGenerating） // 用户点击“停止生成”的路径
runInAction(() => { // action：一次性更新所有相关字段
  this.isSending = false; // 全局 getter（当前文档）：停止后不应处于 sending 状态

  // 关键：不要 for..of 原地改 m.isStreaming（原地 mutate 容易在保存/切换时造成回闪） // 解释原因
  // 改为 map：对每条 streaming 消息返回一个新对象，保证 UI 稳定收到“停止态”更新 // 解释策略
  this.messages = this.messages.map((m) => { // 遍历当前文档的消息列表并生成新数组
    if (!m.isStreaming) return m; // 非流式消息保持原引用（减少不必要的更新）
    return { ...m, isStreaming: false, isStopped: true }; // 流式消息：替换为停止态对象
  }); // map 结束
}); // runInAction 结束
```

#### 2.0.6 首次保存时“正在流式”不应被终止：延迟迁入（flush）直到流式自然结束

##### 2.0.6.1 问题现象（产品视角）

在 **首次保存知识库文档**（草稿 `draft-new` → 正式 `knowledgeArticleId`）的瞬间，如果 assistant 仍在 **streaming（流式输出）**：

- 保存动作会让流式输出被终止（用户看到打字机突然停住）。
- 同时会把当下“尚未完成”的 assistant 对话内容通过 `import-transcript` 迁入并绑定到新知识条目，导致新条目下的助手历史是不完整的。

##### 2.0.6.2 设计目标（不影响现有功能）

- **不终止流式**：保存知识本体不应影响正在进行的 SSE。
- **不绑定不完整会话**：只有在流式自然结束后，才允许把完整对话迁入并绑定到新条目。
- **不改变既有迁入语义**：当没有流式进行中时，仍按原逻辑立刻 `flushEphemeralTranscriptIfNeeded`，不影响现有功能与时序约束。

##### 2.0.6.3 实现思路（具体到状态与时序）

核心做法是在前端引入一个“延迟迁入任务”：

- 当首次保存发生且该文档仍在流式时：
  - **不调用** `flushEphemeralTranscriptIfNeeded`（避免迁入不完整内容）。
  - 在“该文档的 state”上登记 `pendingEphemeralFlush = { cloudArticleId, fromKey, toKey }`。
  - 同时将该 state 标记为 `historyHydrated = true`：
    - 原因：保存后会进入“允许持久化”模式，若此时触发 `activateForDocument` 去服务端拉历史，服务端尚未迁入会返回空列表，可能覆盖 UI。
    - 先标记 hydrate，可避免“保存瞬间 UI 被服务端空历史覆盖”的副作用。
- 当流式自然结束（`onComplete` 收尾）时：
  - 若 state 上存在 `pendingEphemeralFlush`，则在**停止态**触发一次 `flushEphemeralTranscriptIfNeeded(cloudArticleId, fromKey, toKey)`，把完整对话迁入并绑定到新条目。
  - 迁入成功后清掉 `pendingEphemeralFlush`。
- 错误策略（保持安全）：`onError` 时 **不自动迁入**，避免把“错误/中断导致的不完整内容”强绑定到新条目（如需迁入可改成用户确认型交互）。

##### 2.0.6.4 关键实现代码（带详细注释）

下面代码块为**对照当前源码的讲解式摘录**，字段名/调用关系与仓库一致，注释解释关键约束。

**A）Store：登记延迟迁入任务（不终止流式，逐行注释版）**

```ts
// 文件：apps/frontend/src/store/assistant.ts（节选） // 标注来源文件，便于回到源码核对

pendingEphemeralFlush: // 字段名：挂在“文档 state”上的延迟迁入任务（per-document）
  | { // 任务对象：描述“迁入到哪篇文章、从哪个 key 迁到哪个 key”
      cloudArticleId: string; // 新建保存返回的知识 UUID（正式 articleId）
      fromDocumentKey: string; // 保存前的 documentKey（通常是 draft-new__trash-*）
      toDocumentKey: string; // 保存后的 documentKey（通常是 {articleId}__trash-*）
    } // 任务对象结束
  | null; // 无任务时为 null（默认态）

scheduleEphemeralFlushAfterStreaming( // 方法名：在“仍在流式时保存”场景登记延迟迁入任务
  cloudArticleId: string, // 参数：新文章 id（用于 import-transcript 绑定 knowledgeArticleId）
  fromDocumentKey: string, // 参数：保存前 documentKey（用于定位当前对话所在 state）
  toDocumentKey: string, // 参数：保存后 documentKey（用于迁入后映射/绑定）
): void { // 返回：同步方法（只登记任务，不发请求、不 await）
  const state = this.ensureState(fromDocumentKey); // 找到“保存前文档”的 state（按 canonicalKey 分桶）
  runInAction(() => { // action：保证下面两处状态写入是一个事务
    state.pendingEphemeralFlush = { // 写入 pending：标记“稍后需要迁入”
      cloudArticleId, // 记录新文章 id
      fromDocumentKey, // 记录 fromKey（供之后 flush 用）
      toDocumentKey, // 记录 toKey（供之后 flush 用）
    }; // pending 对象写入结束
    state.historyHydrated = true; // 关键：阻止保存后 activate 立刻去拉“服务端空历史”覆盖 UI
  }); // runInAction 结束
} // scheduleEphemeralFlushAfterStreaming 结束

isStreamingForDocumentKey(documentKey: string): boolean { // 方法名：判断某文档当前是否仍在流式
  const key = this.canonicalKey(documentKey); // 先把可能带 __trash-* 的 key 归一（避免分裂）
  const state = key ? this.stateByDocument[key] : null; // 读取该 canonicalKey 对应的 state（可能不存在）
  return Boolean(state?.messages?.some((m) => m.isStreaming)); // 只要该 state 内还有 streaming 消息，就认为仍在流式
} // isStreamingForDocumentKey 结束
```

**B）Store：流式结束时自动执行迁入（flush）并绑定新条目（逐行注释版）**

```ts
// 文件：apps/frontend/src/store/assistant.ts（sendMessage 的 onComplete/onError 节选） // 标注来源

onComplete: async (err) => { // SSE 收到 done 或 error 后触发的完成回调
  // ... 省略：此处先把本轮 assistant 占位消息收尾为 isStreaming=false（见上一节“替换对象”） ... // 说明省略段落的语义

  const pending = state.pendingEphemeralFlush; // 读取该文档 state 上的 pending 迁入任务（如果有）
  if (pending && !state.messages.some((m) => m.isStreaming)) { // 只有在“当前 state 已完全停止流式”时才执行迁入（保证完整）
    try { // try：保证无论 flush 成功或失败，都能清理 pending（避免重复执行）
      await this.flushEphemeralTranscriptIfNeeded( // 调用迁入：把完整 messages 序列化为 lines 并 import-transcript
        pending.cloudArticleId, // 新文章 id：作为 import-transcript 的 knowledgeArticleId（绑定到该知识条目）
        pending.fromDocumentKey, // fromKey：用于定位迁入源 state（内部会做 canonicalKey 兼容）
        pending.toDocumentKey, // toKey：用于写入 session 映射并让后续按文章打开能拉到历史
      ); // flush 调用结束
    } finally { // finally：确保 pending 一定清掉（避免下一次 onComplete 重复迁入）
      runInAction(() => { // action：在 MobX 事务中清理
        state.pendingEphemeralFlush = null; // 清空 pending：任务已消费
      }); // runInAction 结束
    } // finally 结束
  } // if 结束
}; // onComplete 结束

onError: () => { // SSE/网络/解析等错误回调
  // 错误策略：不自动迁入 // 避免把“错误/中断导致的不完整对话”静默绑定到新文章
  // 若产品希望“错误也迁入”，建议做成用户确认型操作（避免 silent data quality） // 解释可选策略
  runInAction(() => { // action：清理 pending 放在事务里
    state.pendingEphemeralFlush = null; // 清掉 pending：避免后续误触发迁入
  }); // runInAction 结束
}; // onError 结束
```

**C）知识页保存流程：保存时分支决定“立即迁入”还是“延迟迁入”（逐行注释版）**

```ts
// 文件：apps/frontend/src/views/knowledge/index.tsx（首次保存分支节选，注释增强）

if (!assistantStore.knowledgeAssistantPersistenceAllowed) { // 仅在“草稿阶段不落库(ephemeral)”时需要迁入；已允许持久化则不走 import-transcript
  // 首次保存时若助手仍在流式：不要中断流式，也不要把不完整对话迁入/绑定到新知识条目 // 说明该分支的产品目标
  // 改为登记“流式结束后再迁入”，避免保存瞬间产生不完整的 assistant 会话关联 // 说明策略：延迟迁入
  if (assistantStore.isStreamingForDocumentKey(fromKey)) { // 判断“保存前文档(fromKey)”是否仍有 streaming 消息（必须按文档维度判断）
    assistantStore.scheduleEphemeralFlushAfterStreaming( // 登记 pending 任务：不发请求、不 stopGenerating（不终止 SSE）
      res.data.id, // cloudArticleId：新建保存返回的正式知识 UUID（用于最终 import-transcript 绑定）
      fromKey, // fromKey：保存前 documentKey（通常 draft-new__trash-*，用于定位当前对话 state）
      toKey, // toKey：保存后 documentKey（通常 {articleId}__trash-*，用于迁入后映射与后续按文章恢复历史）
    ); // schedule 调用结束
  } else { // 不在流式：可以立即迁入（保持旧语义，不影响现有功能）
    await assistantStore.flushEphemeralTranscriptIfNeeded( // 立刻迁入：把当前 messages 序列化为 lines 并 import-transcript
      res.data.id, // cloudArticleId：绑定到新知识条目
      fromKey, // fromKey：源对话 key
      toKey, // toKey：目标 key
    ); // flush 结束
  } // if/else 结束
} // persistenceAllowed 分支结束
```

##### 2.0.6.5 回归建议（覆盖该问题）

- 首次保存时 assistant 正在流式：
  - 保存知识不应让流式停住（打字机继续）。
  - 流式结束后，新知识条目下应能加载到完整对话历史（迁入发生在流式结束后）。
- 首次保存时 assistant 不在流式：
  - 行为与旧版本一致：保存后立刻迁入，历史不丢。

### 2.1 按文档隔离运行态（stateByDocument）

将以下运行态从“单例字段”改为“按文档 key 分桶”的结构（每个文档独立一份）：

- `sessionId`
- `messages`
- `isHistoryLoading`
- `isSending`
- `loadError`
- `abortStream`
- `historyHydrated`（新增：避免重复 hydrate）

这样切换文档时不会影响其它文档的流式输出，也不会清空其它文档的消息。

### 2.2 引入 canonicalKey（稳定 key）避免 state 分裂

知识页的 `documentKey` 可能携带 `__trash-*` 后缀（nonce）。本次在 store 内新增了稳定 key 规则：

- `canonicalKey(documentKey)`：优先使用 `knowledgeArticleBindingFromDocumentKey(documentKey)`（去掉 `__trash-*`）作为 state/session 的分桶 key。

效果：同一篇知识条目在 UI 层 `documentKey` 变化时，依然命中同一份助手 state，流式输出不会因为 key 变体被“切断到另一份空状态”。

### 2.3 流式回调绑定“发送时的文档”而不是“当前 active 文档”

在 `sendMessage` 中发送瞬间捕获：

- `documentKey`（以及其 `canonicalKey`）
- 对应的 `state`

并且在 SSE 回调里只更新该 `state.messages`（多会话下 `state` 为 **`ensureSessionState(sid)`** 的会话桶）。持久化路径自然结束时，用 **闭包捕获的 `sid`** 调用 **`getAssistantSessionDetail(sid)`**，且校验 **`payload.session.sessionId === sid`** 后再覆盖 messages，避免切换文档或并发会话时把 DB 回写到错误的会话上。

### 2.4 activateForDocument 不再全局中止流式

`activateForDocument` 只更新 `activeDocumentKey`（UI 指针）并确保对应 state 存在；不再对其它文档的 `abortStream/messages` 做全局操作。

---

## 3. 影响点清单（对现有功能的影响评估）

### 3.1 不应改变的功能（保持不变）

- **未保存云端草稿（ephemeral）**：
  - 仍然不落库，仍使用 `contextTurns` 拼上下文。
  - 保存后迁入（`import-transcript`）逻辑不变：仍以当前内存 `messages` 生成 `lines`。
- **已保存条目 / 本地文件 / 回收站预览（持久化允许）**：
  - 会话创建、按条目拉历史、停止生成、完成后回填的产品语义不变。
- **UI 层（`KnowledgeAssistant.tsx`）**：
  - 仍以 `assistantStore.messages` 渲染列表，仍用 `assistantStore.isStreaming/isSending/isHistoryLoading` 控制按钮状态。

### 3.2 行为变化（应当接受的变化）

- **切换文档不再中断正在生成的回复**：如果用户在文档 A 流式生成时切到文档 B，文档 A 的流式会在后台继续，切回后能看到最终结果与增量过程。
- **同一条目不同 `__trash-*` 变体会共享同一份 state**：这是为了保证“切回继续流式”，也与 `bindingId` 的语义一致（同一条目/同一草稿逻辑身份）。

### 3.3 潜在风险与注意事项

- **内存占用增加**：现在每个访问过的条目会保留一份 `messages/state`（直到被显式清理或刷新页面）。若用户在一个会话内快速浏览大量条目，内存占用会增加。
  - 缓解建议：后续如有需要，可加 LRU（最近最少使用）清理策略，或限制缓存条目数。
- **“清空草稿”清理范围**：`clearAssistantStateOnKnowledgeDraftReset` 仍是关键清理入口。
  - 本次改动后 store 内部的清理也统一使用 `canonicalKey`，避免出现「state 存在于 canonicalKey 下，但 delete 用了原始 `documentKey`」导致清空不生效的问题。
  - 注意：用户手动把左侧正文删空与“重置到新草稿”（`resetEditorToNewDraft`）是两条不同路径；前者未必会触发 `clearAssistantStateOnKnowledgeDraftReset`，因此若产品期望“正文删空也要清对话”，需要在知识页额外做联动（不要在本次改动里隐式改变该语义）。
- **跨条目并发流式**：本次改动允许不同文档并发流式（每份 state 有独立 `abortStream`）。如果后端对同一用户的并发有额外限制，需观察是否会触发后端限流/占用提示。

---

## 4. 回归建议（知识库相关）

- **流式切换**：文档 A 流式时切到文档 B，再切回 A，应继续看到打字机增量，且最终完成态正确。
- **保存迁入**：未保存草稿（ephemeral）产生对话 → 保存为云端条目 → 再打开该条目，应能拉到迁入后的历史。
- **回收站预览隔离**：回收站预览条目与正式条目之间会话不串；同一预览条目多次打开仍能命中同一会话（按 bindingId）。
- **停止生成**：在当前文档点击停止仍能立即停止该文档的流式；切换文档不应误停其它文档的流式。

