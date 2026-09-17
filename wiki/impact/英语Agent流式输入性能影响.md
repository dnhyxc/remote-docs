# 英语学习 Agent 流式输入性能 — 影响点分析

## 延伸阅读

- [助手流式贴底抖动](./知识库助手流式吸附影响.md) — `useAssistantScroll` / `useStickToBottomScroll` 同源贴底（本主题未改 hook）
- [预览+助手同开性能](./知识库预览助手面板性能影响.md) — 知识库 `MessageList` + `useAssistantStreamTick` 隔离范式（本主题对齐）
- [流式气泡选区保持](./对话流式选区保持影响.md) — Markdown 气泡内选区（与本主题解耦）
- [MK 问书流式误清 EPUB 选区](./EPUB提问流式选区清除影响.md) — 同用 `createStreamingMobxPatchScheduler` 的问书侧

> **阅读约定**：「历史风险」指旧实现曾出现的问题，不代表现行代码仍会触发。

## 1. 分析目的

评估 **英语学习 Agent 流式输出时输入框卡顿 / 页面滚动卡顿** 相关改动，是否改变或破坏既有能力：

- 右侧 `AgentPanel`：发送、停止生成、贴底、滚动 FAB、空态、工具状态条
- `ChatEntry` 受控输入（含左侧快捷意图写入同一 `input`）
- 消息列：`AssistantMessageRow` / 流式 Markdown / 选区朗读与分享
- `englishAgentStore` SSE：`onDelta` / `onComplete` / `onError` / 工具状态 / `onMessageIds`
- 多会话切换、历史抽屉、`getAllMessages` 分享

**改动范围（当前 diff）**：

| 文件 | 变更 |
|------|------|
| `apps/frontend/src/views/englishLearning/agent/index.tsx` | `AgentPanel` 拆出 `EnglishAgentScrollShell`；`footerBody`（`ChatEntry`）稳定引用；`useAssistantShare({ getAllMessages })`；render 不再订阅 `messages` 内容 |
| `apps/frontend/src/views/englishLearning/agent/EnglishAgentMessageList.tsx` | **新增**：`memo(observer)` 单独订阅 `messages` |
| `apps/frontend/src/views/englishLearning/agent/useEnglishAgentSignals.ts` | **新增**：`reaction` 隔离 `streamTick` / 条数 / 发送·流式·hydrate·session·toolStatus |
| `apps/frontend/src/store/englishAgent.ts` | `createStreamingMobxPatchScheduler`；流式就地写 `content`；complete/error/catch `flush` |

**调用链（须回归）**：

- `englishLearning/index.tsx` → `AgentPanel`（`input` / `sendMessage` / `onNewChat`）
- `AgentPanel` → `EnglishAgentScrollShell` → `useAssistantScroll` → `useStickToBottomScroll`
- `EnglishAgentMessageList` → `AssistantMessageRow` → `ChatAssistantMessage`
- `englishAgentStore.sendMessage` → `streamAgentSse` → `patchAssistant` / scheduler

**结论摘要**：

| 维度 | 是否影响原有功能 | 说明 |
|------|------------------|------|
| 发送 / 停止 / loading | **否** | 仍调 `sendMessage` / `stopGenerating`；`loading`←`isSending`，`stopGenerating`←`isStreaming` |
| 流式贴底 / 上滑打断 / FAB | **否** | 仍 `useAssistantScroll({ contentRevision: streamTick, … })`；打断策略未改 |
| 消息展示 / SSE 全文 | **否** | 累积 `accumulated` 语义不变；仅改为每帧最多一次写入 + 就地改 `content` |
| ChatEntry / 快捷意图填入 | **低（增强）** | 流式时不再随 token 重渲整棵含输入的树，输入应更跟手 |
| 分享勾选 / ShareBar | **否** | `getAllMessages` 惰性读；分享态仍挂 `EnglishAgentShareBar` observer |
| 选区朗读 / 复制 / 存知识库 | **否** | props 与 hook 接线不变 |
| 工具状态条 / 空态 / hydrate | **否** | `toolStatus` / `isHydrating` / `messageCount` 经 reaction，语义同前 |
| 会话切换锁定 | **有条件变化** | `isSessionSwitcherLocked` 改为字面 `false`（原 getter 恒 `false`，行为等价） |

---

## 2. 改动要点（相对改前行为）

### 2.1 UI：消息列与输入区解耦

**改前**：

```text
AgentPanel = observer
  直接读 englishAgentStore.messages / isStreaming / …
  每个 content 替换 → 整面板重渲（含沉重 ChatEntry）
  useAssistantShare({ messages }) → 父级更易被消息数组牵动
```

**改后**：

```text
AgentPanel = observer（仅 userStore 等非流式字段；勿读 messages 内容）
  footerBody = useMemo(ChatEntry …)  ← 流式期间引用可保持稳定
  EnglishAgentScrollShell
    streamTick / messageCount / flags ← reaction hooks
    useAssistantScroll(contentRevision: streamTick)
    EnglishAgentMessageList = memo(observer) ← 只重渲消息列
  useAssistantShare({ getAllMessages })
  贴底 API 经 scrollControlsRef，避免 ChatEntry 依赖滚动闭包身份变化
```

**动机**：与知识库 `KnowledgeAssistantMessageList` + `useAssistantStreamTick` 同构，避免流式 token 拖垮输入主线程。

### 2.2 Store：rAF 合并 + 就地写 content

**改前**：

```text
onDelta → 立刻 runInAction
  messages[idx] = { ...prev, content: accumulated }  // 替换数组元素
→ MessageList / 贴底 / Markdown 每 token 一次
```

**改后**：

```text
onDelta → accumulated += delta → scheduler.schedule()
  每帧最多一次 flush：prev.content = accumulated（就地）
onComplete / onError / catch → scheduler.flush() 再收尾
```

**动机**：复用已有 `createStreamingMobxPatchScheduler`（知识库 `assistantStore` / RAG 同源）；就地改避免整表 `messages` 数组元素替换带动列表 observer。

---

## 3. 影响点矩阵

| 模块 / 场景 | 影响等级 | 分析 |
|-------------|----------|------|
| **英语页左侧侧栏 + 快捷意图** | 低 | 父页 `input` 仍受控；流式时右侧少占主线程，侧栏交互应更顺。侧栏不订阅 `messages` |
| **右侧 ChatEntry 键入** | 低（增强） | 稳定 `footerBody` + 不订阅 content → 流式中按键不再连带整表 Markdown reconcile |
| **流式气泡 Markdown** | 低 | 仍每帧（合并后）更新；成本从「每 token」降为「约每帧」 |
| **贴底 / ResizeObserver** | 无～低 | hook 未改；更新频率下降可减少 stickFlush 次数，跟底语义不变 |
| **停止生成** | 无 | `abort` → `onComplete`/`onError` 前 `flush`，末段文字不丢 |
| **工具调用 status 文案** | 无 | `onTool` 仍同步写 `toolStatus`；ScrollShell reaction 刷新条带 |
| **分享** | 无 | 非分享不读全量 messages；分享态 ShareBar observer 读当前列表 |
| **知识库 / MK 问书 UI** | 无 | 未改 `KnowledgeAssistant` / `EbookAssistant` 组件树；仅 scheduler 工具本已共用 |
| **`AssistantMessageRow` 选区朗读** | 无 | 接线未改；气泡内选区另见 `chat-stream-selection-preserve` |

---

## 4. 潜在风险与缓解

| 风险 | 等级 | 说明 | 建议验证 |
|------|------|------|----------|
| 末包未 flush 丢字 | 低 | complete/error/catch 均 `flush`；若未来 abort 不经回调需另存 scheduler | 流式中点停止 → 气泡保留已生成全文 |
| MobX 就地改不触发 UI | 低 | `makeAutoObservable` 下 push 的消息为可观察对象；`content` 赋值应通知 `AssistantMessageRow` | 流式时气泡可见逐字/逐帧增长 |
| `footerBody` deps 含 `shareSelection` | 低 | 分享态切换会重建 ChatEntry；非分享流式路径不应每帧变 | 非分享下流式时输入框不丢焦点 |
| AgentPanel 误再读 `messages` | 中 | 注释已警告；一旦 render 再订阅 content，卡顿回归 | Code review / 流式时 React Profiler 看 AgentPanel |

---

## 5. 未改动项

| 项 | 说明 |
|----|------|
| `useStickToBottomScroll` / `useAssistantScroll` | 贴底与打断 API 未改 |
| `streamAgentSse` / 后端 english_learning | 协议与回调集合未改 |
| `EnglishLearning` 左栏布局 / Pack store | 未改 |
| `ChatEntry` 组件本体 | 未 memo 化组件文件；靠父级稳定 element |
| `isEnglishSessionSwitcherLocked` getter | 仍存在于 store；UI 改为字面 `false`（与 getter 恒值一致） |

---

## 6. 回归清单

- [ ] 英语学习：发问 → 流式输出时右侧输入框可持续键入，无明显卡顿
- [ ] 流式中上滑打断贴底；滚回底部或点 FAB 恢复跟底
- [ ] 点停止：气泡保留已生成内容，`isStreaming` 结束，可再发
- [ ] 工具调用时状态条出现/消失正常
- [ ] 快捷意图写入输入框 → 发送 → URL `session` 更新
- [ ] 历史抽屉切换会话、新对话清空展示
- [ ] 分享：勾选问答对、生成链接（登录且有 session）
- [ ] 复制 / 存知识库 / 选区朗读菜单
- [ ] 空态 intro → 首条消息后进入会话列布局
- [ ] `npx tsc --noEmit`（frontend）

---

## 7. 相关文档滞后

| 文档 | 说明 |
|------|------|
| `docs/english/英语Agent多会话历史SSE.md` | 仍写 `AgentPanel.tsx` 旧路径/结构；现行为 `views/englishLearning/agent/index.tsx` + MessageList/Signals 拆分，宜日后改路径说明（本篇不重写实现文） |

---

（若与仓库最新源码不一致，以源码为准）
