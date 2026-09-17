# 英语 Agent 选区朗读 + 通用选区菜单抽取 — 影响点分析

## 延伸阅读

- [选中文本朗读菜单.md](../english/选中文本朗读菜单.md) — 实现与改动前后对比
- [EPUB听书节奏引导影响.md](./EPUB听书节奏引导影响.md) — 切句提前对选区朗读预览的影响（动机方）
- [EPUB右键菜单PopBar.md](../ebook/EPUB右键菜单PopBar.md) — EPUB 选区菜单底座

## 1. 分析目的

评估 **英语 Agent 选区右键朗读/复制 + 抽取通用 `PositionedQuickMenu` / `useSelectionContextMenu`** 相关改动，是否改变或破坏已有功能：

- EPUB 阅读器右键菜单（`EpubReaderContextMenu` 被重构为使用 `PositionedQuickMenu`）
- 英语学习 Agent 对话消息渲染与滚动行为
- 知识库助手底部输入区（`KnowledgeAssistantChatFooter` 驱动同款 `Assistant` 容器）
- Markdown 预览组件的选区行为
- 听书/听当前 TTS 播放链路（选区朗读复用 `playListenPlainText`）

**改动范围（当前 diff）**：

| 文件 | 变更 |
|------|------|
| `apps/frontend/src/components/design/ContextMenu/PositionedQuickMenu.tsx` | **新增**：锚定鼠标坐标的声明式菜单（从 `EpubReaderContextMenu` 抽取 `MenuEntries` + `anchorStyle`） |
| `apps/frontend/src/components/design/ContextMenu/useSelectionContextMenu.tsx` | **新增**：选区右键 hook（pointerdown 快照 + contextmenu 捕获阶段拦截） |
| `apps/frontend/src/components/design/ContextMenu/index.tsx` | barrel 导出新增 `PositionedQuickMenu` / `useSelectionContextMenu` |
| `apps/frontend/src/views/ebook/components/reader/EpubReaderContextMenu.tsx` | 删除内部 `MenuEntries` / `anchorStyle`，改用 `PositionedQuickMenu`；`EpubReaderContextMenuState` 改为 `PositionedQuickMenuState & { hasSelection }` |
| `apps/frontend/src/components/design/Assistant/types.ts` | 新增 `floatAbove` / `getSelectionContextMenuItems` 字段 |
| `apps/frontend/src/components/design/Assistant/Footer.tsx` | 渲染 `floatAbove` 悬浮层 |
| `apps/frontend/src/components/design/Assistant/MessageRow.tsx` | 透传 `getSelectionContextMenuItems` 到消息气泡 |
| `apps/frontend/src/components/design/Assistant/utils.ts` | `select-auto` → `select-text` |
| `apps/frontend/src/components/design/ChatAssistantMessage/index.tsx` | 集成 `useSelectionContextMenu` + 新增 `getSelectionContextMenuItems` prop |
| `apps/frontend/src/components/design/Markdown/index.tsx` | 预览组件集成 `useSelectionContextMenu` + 新增 prop |
| `apps/frontend/src/views/englishLearning/agent/selectionContextMenu.ts` | **新增**：英语 Agent 选区菜单项工厂（朗读 + 复制） |
| `apps/frontend/src/views/englishLearning/agent/useSelectionSpeak.ts` | **新增**：选区朗读 hook（复用 `playListenPlainText`） |
| `apps/frontend/src/views/englishLearning/agent/SelectionSpeakBar.tsx` | **新增**：悬浮控制条 UI（播放/暂停、停止、倍速、拖动） |
| `apps/frontend/src/views/englishLearning/agent/index.tsx` | 接入选区菜单 + `floatAbove` 传 `SelectionSpeakBar` |
| `apps/frontend/src/views/ebook/utils/epub/listen/playListenPlainText.ts` | **新增**：纯文本朗读入口（复用听书按段云端 TTS 链路） |
| `apps/frontend/src/views/ebook/read.tsx` | 仅注释补充（问书首次开栏交焦说明），无行为变化 |
| `apps/frontend/src/views/knowledge/KnowledgeAssistantChatFooter.tsx` | 未传 `getSelectionContextMenuItems`（知识库助手不启用选区菜单） |
| `apps/frontend/src/views/knowledge/index.tsx` | 无行为变化（仅可能 import 格式化） |

**结论摘要**：

| 维度 | 是否影响原有功能 | 说明 |
|------|------------------|------|
| EPUB 右键菜单行为 | **否** | `EpubReaderContextMenu` 改为薄壳调 `PositionedQuickMenu`，渲染逻辑等价（`MenuEntries` 平移） |
| EPUB 右键菜单 state 类型 | **有条件变化** | `EpubReaderContextMenuState` 从自定义结构改为 `PositionedQuickMenuState & { hasSelection }`；字段名兼容（`open`/`x`/`y` 仍在），`read.tsx` 调用方已适配 |
| 英语 Agent 消息正文可选 | **低（增强）** | `select-auto` → `select-text`，消息正文更易选中；不影响布局 |
| 英语 Agent 滚动/流式/历史 | **否** | 未改 `Assistant` 滚动逻辑、`stickFlush`、历史抽屉 |
| 知识库助手选区菜单 | **否** | `KnowledgeAssistantChatFooter` 未传 `getSelectionContextMenuItems`，hook 返回 `undefined`，菜单不启用 |
| Markdown 预览选区菜单 | **有条件变化** | `Markdown` 组件新增可选 prop；未传则 `getItems` 为 `undefined`，菜单不启用，行为同改前 |
| 听书/听当前 TTS 链路 | **否** | `playListenPlainText` 复用既有 `playListenUnitsFromCursor`，未改其内部逻辑；切句时序变化见 [EPUB听书节奏引导影响.md](./EPUB听书节奏引导影响.md) |
| Assistant `floatAbove` 布局 | **低** | 新增 `floatAbove` 渲染槽位在 `children` 之前；未传时为 `undefined`，布局不变 |
| `Footer` 内 `ScrollFab` 位置 | **低** | `floatAbove` 渲染在 `ScrollFab` 之前；英语 Agent 同时使用两者时，朗读条在 FAB 上方 |

---

## 2. 改动要点（相对改前行为）

### 2.1 通用选区菜单组件抽取

**改前**：`EpubReaderContextMenu` 内部自管 `MenuEntries`（递归渲染 `DropdownMenuItem` / `Sub` / `Separator`）与 `anchorStyle`（固定 1×1 透明锚点 span）。

**改后**：`PositionedQuickMenu` 封装同一逻辑（`MenuEntries` + 锚点 + `DropdownMenu`）；`EpubReaderContextMenu` 变为 `<PositionedQuickMenu state items onOpenChange />` 的薄壳。

**动机**：英语 Agent / Markdown 预览也需要「锚定鼠标坐标的声明式菜单」，避免各自重写 `anchorStyle` 与 `MenuEntries`。

### 2.2 选区右键 hook

**改前**：EPUB 通过 iframe `onContextMenu` 回调 + `read.tsx` 手动 `setState` 弹菜单；英语 Agent / Markdown 无选区右键。

**改后**：`useSelectionContextMenu(getItems?)` 在 `pointerdown(button=2)` 快照选区、`contextmenu` 捕获阶段 `preventDefault` + 弹菜单；`getItems` 为 `undefined` 时返回 `undefined` handlers，不拦截。

**动机**：macOS 右键时浏览器会先清选区，需 pointerdown 快照；统一 hook 供多入口复用。

### 2.3 英语 Agent 选区朗读

**改前**：英语 Agent 消息正文无右键菜单、无朗读入口。

**改后**：选中消息正文右键 → 朗读/复制；朗读调用 `playListenPlainText`（复用听书 `playListenUnitsFromCursor` 按段云端 TTS）；悬浮条 `SelectionSpeakBar` 通过 `floatAbove` 渲染在输入框上方，支持拖动、倍速、软暂停。

**动机**：用户想在 Agent 回复中「听一段」。

---

## 3. 影响点矩阵

| 模块 / 场景 | 影响等级 | 分析 |
|-------------|----------|------|
| **EPUB 右键菜单渲染** | **无** | `PositionedQuickMenu` 内部 `MenuEntries` 与原 `EpubReaderContextMenu` 内部实现逐行平移；`DropdownMenu` / `DropdownMenuContent` / `align="start"` / `side="right"` / `min-w-44` 均保留 |
| **EPUB 右键菜单 state 结构** | **低** | `EpubReaderContextMenuState` 改为 `PositionedQuickMenuState & { hasSelection }`；`read.tsx` `useState<EpubReaderContextMenuState \| null>` 仍兼容（`open`/`x`/`y` 字段名不变） |
| **EPUB `hasSelection` 判定** | **无** | `hasSelection` 仍在 `read.tsx` 构造 payload 时设置，`PositionedQuickMenu` 不读此字段（由 items 工厂决定是否 disabled） |
| **英语 Agent 消息正文选择** | **低** | `select-auto` → `select-text`；用户可选中消息正文（改前 `select-auto` 在某些浏览器下也会允许选择，差异极小） |
| **英语 Agent 右键菜单弹出** | **低（新增）** | `getSelectionContextMenuItems` 仅在 `englishLearning/agent/index.tsx` 传入；未选中文本时 `useSelectionContextMenu` 不拦截系统菜单 |
| **英语 Agent 朗读悬浮条** | **低（新增）** | `floatAbove` 在 `Footer` 内 `children` 之前渲染；仅英语 Agent 传入 `SelectionSpeakBar`，其它 `Assistant` 消费方未传 |
| **知识库助手** | **无** | `KnowledgeAssistantChatFooter` 未传 `getSelectionContextMenuItems` / `floatAbove`；`useSelectionContextMenu(undefined)` 返回 `undefined` handlers，`Footer` 不渲染 `floatAbove` |
| **EPUB EbookAssistant** | **无** | `EbookAssistant.tsx` 未传 `getSelectionContextMenuItems` / `floatAbove` |
| **Markdown 预览组件** | **低** | 新增可选 prop `getSelectionContextMenuItems`；未传时 hook 返回 `undefined`，菜单不启用，行为同改前 |
| **听书 TTS 链路** | **无** | `playListenPlainText` 调用 `playListenUnitsFromCursor`，未改其内部预取/世代/软暂停逻辑 |
| **Assistant `Footer` 布局** | **低** | `floatAbove` 渲染在 `{showScrollFab && scrollFab ? <ScrollFab/> : null}` 之前、`{children}` 之前；不传时无 DOM 节点 |
| **`MessageRow` memo 比较** | **低** | `getSelectionContextMenuItems` 加入 `memo` 比较；英语 Agent 侧 `useMemo` 稳定引用，不会导致不必要的重渲染 |

---

## 4. 潜在风险与缓解

| 风险 | 等级 | 说明 | 建议验证 |
|------|------|------|----------|
| EPUB 右键菜单样式偏移 | 低 | `PositionedQuickMenu` 的 `anchorStyle` 与原 `EpubReaderContextMenu` 一致（1×1 fixed 透明 span），但 `DropdownMenuContent` 的 `className` 需确认 `min-w-44` 已透传 | EPUB 阅读页右键：菜单宽度与位置与改前一致 |
| macOS 右键选区丢失 | 低 | `useSelectionContextMenu` 用 pointerdown 快照；若某些 WebView 不触发 `pointerdown`（button=2），会回退到 contextmenu 时的 live selection | macOS 桌面端英语 Agent：选中文本后右键，菜单项「朗读」可用 |
| 朗读悬浮条遮挡输入框 | 低 | `floatAbove` 在 `children`（输入框）之前渲染，`SelectionSpeakBar` 高度可能压缩输入区可视高度 | 英语 Agent 朗读时：输入框仍可见可点击；停止朗读后悬浮条消失 |
| 朗读与听书/听当前互斥 | **中** | `playListenPlainText` 复用 `playListenUnitsFromCursor`，与听书共享 TTS 世代/`isActive`；若同时触发可能互相 `stop` | 英语 Agent 朗读中进入电子书听书：确认前者被 stop，不串音 |
| Markdown 预览意外启用菜单 | 低 | `Markdown` 组件新增 prop 但默认不传；需确认所有调用方未误传 | grep `Markdown` 调用方：确认 `getSelectionContextMenuItems` 仅在预期入口传入 |

---

## 5. 未改动项

| 项 | 说明 |
|----|------|
| `playListenUnitsFromCursor` 内部逻辑 | 预取、世代、`isActive`、`softPause`、`onSentence` 回调签名均未改 |
| EPUB iframe `onContextMenu` 回调 | `read.tsx` 仍通过 `epubContextMenuAttach` 在 iframe 内监听 contextmenu，构造 payload |
| `EpubReaderContextMenu` 的 `hasSelection` 字段 | 仍在 `read.tsx` 设置，items 工厂据此决定「划线/复制」是否 disabled |
| 知识库助手 / EPUB EbookAssistant 的 `floatAbove` / `getSelectionContextMenuItems` | 未传入 → 不启用 |
| `Assistant` 滚动逻辑 / `stickFlush` / 历史抽屉 | 未触碰 |
| 听书播放条 UI / 倍速 / 分句列表 | 未改 |

---

## 6. 回归清单

- [ ] EPUB 阅读页右键：菜单弹出位置、宽度、子菜单展开与改前一致
- [ ] EPUB 右键：无选区时「复制」disabled，「划线」可用；有选区时两者均可用
- [ ] 英语 Agent：选中消息正文右键 → 弹自定义菜单（朗读/复制）
- [ ] 英语 Agent：未选中文本右键 → 弹系统默认菜单
- [ ] 英语 Agent：朗读播放/暂停/停止/倍速切换正常
- [ ] 英语 Agent：朗读悬浮条可拖动，不遮挡输入框
- [ ] 英语 Agent：朗读中离开页面 → 自动停止
- [ ] 英语 Agent：朗读中进入电子书听书 → 前者停止，不串音
- [ ] 知识库助手：右键仍为系统默认菜单（未启用选区菜单）
- [ ] 知识库助手：输入区无悬浮条（未传 `floatAbove`）
- [ ] Markdown 预览：未传 `getSelectionContextMenuItems` 时右键为系统默认
- [ ] `npx tsc --noEmit` 通过

---

## 7. 相关文档滞后

无。实现专题 [选中文本朗读菜单.md](../english/选中文本朗读菜单.md) 与本篇同轮产出。

（若与仓库最新源码不一致，以源码为准）
