# MK 问书流式误清 EPUB 选区 — 影响点分析

## 延伸阅读

- [EPUB 选区：滚动时收起 PopBar](../ebook/EPUB选区滚动清除.md) — `onScroll` 清选区的原始实现思路（现行已加阅读区判定）
- [助手流式贴底抖动](./知识库助手流式吸附影响.md) — 问书侧栏 `ScrollArea` 流式贴底来源
- [流式气泡选区保持](./对话流式选区保持影响.md) — 问书**气泡内**选区（iframe 正文选区是另一层）
- [英语 Agent 流式输入性能](./英语Agent流式输入性能影响.md) — 同构的 `createStreamingMobxPatchScheduler` 用法

> **阅读约定**：「历史风险」指旧实现曾出现的问题，不代表现行代码仍会触发。

## 1. 分析目的

评估 **MOKE 问书流式输出期间，左侧 EPUB 正文拖选/复制被清空** 相关改动，是否改变或破坏既有能力：

- EPUB 选区 PopBar（划线、写想法、MK 问书、复制、听当前、分享书摘）
- `attachEpubSelectionPopBar`：滚动 / relocated 时关 PopBar、清 iframe 选区
- 阅读区自身滚动（连续滚容器、iframe 内滚动、分页 relocated）
- 右侧 `EbookAssistant` 流式贴底、SSE 增量、停止生成
- 与听书 / 想法侧栏 / 分栏拖拽的互斥与并存

**改动范围（当前 diff）**：

| 文件 | 变更 |
|------|------|
| `apps/frontend/src/views/ebook/utils/epub/reader/epubSelectionToolbarAttach.ts` | 新增 `isEpubReaderScrollTarget`；`onScroll` 仅在阅读区滚动时关 PopBar / `clearEpubTextSelection` |
| `apps/frontend/src/store/ebookAssistant.ts` | `createStreamingMobxPatchScheduler`；就地写 `content`；complete/error/catch `flush` |

**调用链（须回归）**：

- `EpubPane` → `attachEpubSelectionPopBar(rend, onChange)` → `read.tsx` `setSelectionPopBar`
- `onScroll` 监听：`window` / `document`（capture）、iframe `doc`/`window`、`getEpubScrollContainer`
- `EbookAssistant` → `ebookAssistantStore.sendMessage` → `streamAgentSse` → scheduler
- `clearEpubTextSelection` 仍被 PopBar 主动清除、`EpubPane.clearTextSelection`、`onRelocated` 等调用

**结论摘要**：

| 维度 | 是否影响原有功能 | 说明 |
|------|------------------|------|
| 阅读区滚动关 PopBar + 清选区 | **否** | 目标属阅读区时逻辑与改前一致（含 `selecting` / `shouldSuppressDismiss`） |
| 问书流式贴底滚动 | **有条件变化（修复）** | 改前：侧栏 ScrollArea scroll 经 document capture → 误清 EPUB 选区；改后忽略非阅读区 scroll |
| 顶层 / 问书面板内拖选 | **否** | `clearEpubTextSelection` 仍故意不动 `window.getSelection`（历史 ponytail 注释） |
| `onRelocated` 清选区 | **否** | 未改 relocated 分支 |
| 问书 SSE 全文 / 停止 | **否** | 累积语义不变；rAF 合并 + flush 收尾 |
| PopBar 业务按钮 | **否** | 未改 `EpubSelectionPopBar` / `read.tsx` 动作接线 |
| 想法侧栏 / 听书 | **否** | 未改 thought / listen 模块 |

---

## 2. 改动要点（相对改前行为）

### 2.1 Scroll 过滤：只认阅读区

**改前**：

```text
document/window capture 监听到任意 scroll（含问书 ScrollArea 贴底）
  → suppressEmit + onChange(null) + clearEpubTextSelection(rend)
→ 流式时左侧正文无法稳定拖选/复制
```

**改后**：

```text
onScroll(e):
  if (!isEpubReaderScrollTarget(rend, e.target)) return
  // 其余同前：关 PopBar、非拖选则 clearEpubTextSelection
```

`isEpubReaderScrollTarget` 判定：

- `getEpubScrollContainer(rend)` 及其子孙
- 各 content iframe 的 `window` / `document` / `documentElement` / `body` / `scrollingElement` / `doc.contains(node)`

**动机**：历史已发现侧栏 scroll 会进同一 handler（曾因此避免清 `window.getSelection`）；本轮补上「清 iframe 选区」的同源误伤。

### 2.2 问书 Store：rAF 合并写入

**改前**：每 delta 替换 `messages[idx]` 对象 → 高频贴底 scroll → 放大 2.1 误伤与主线程压力。

**改后**：与知识库 / 英语 Agent 相同 scheduler；就地 `prev.content = accumulated`；结束路径 `flush`。

**动机**：降低贴底滚动频率；不改变用户可见的流式正文语义。

---

## 3. 影响点矩阵

| 模块 / 场景 | 影响等级 | 分析 |
|-------------|----------|------|
| **连续滚动：用户滚正文** | 无 | target 为 epub 容器/iframe → 仍关 PopBar 并清选区 |
| **分页翻页 / relocated** | 无 | `onRelocated` 独立路径未改 |
| **拖选过程中微滚** | 无 | `selecting === true` 仍跳过 `clearEpubTextSelection` |
| **问书流式 + 左侧拖选复制** | 低（增强/修复） | 侧栏贴底 scroll 不再清 iframe 选区；PopBar 也不会被误关 |
| **问书气泡内拖选** | 无～低 | 本文件不负责气泡 DOM；气泡见 `chat-stream-selection-preserve`；scheduler 降低重绘频率有利于气泡选区 |
| **划线 / 写想法 / MK 问书入口** | 无 | PopBar 打开后的业务回调未改 |
| **分栏拖拽 softResize** | 无 | 未改 `ebookSplitResize` / soft resize；若 resize 触发 epub 内 scroll，仍按阅读区处理 |
| **读书想法侧栏滚动** | 低 | 想法面板 scroll 亦非 epub target → 不再误清 EPUB 选区（与问书同类修复，属预期） |
| **知识库助手** | 无 | 不经过 `attachEpubSelectionPopBar` |

---

## 4. 潜在风险与缓解

| 风险 | 等级 | 说明 | 建议验证 |
|------|------|------|----------|
| 漏判「阅读区 scroll」 | 中 | 若 epub.js 某模式滚动节点不在 container/iframe 判定内，滚正文时 PopBar 可能残留 | 连续滚 + 分页两种翻页：滚正文应关 PopBar 且选区高亮消失 |
| 误判「侧栏为阅读区」 | 低 | 侧栏 DOM 不在 rendition contents 内，`contains` 为 false | 问书流式时左侧选区保持 |
| window/document 自身滚动 | 低 | target 常为 window/document 时 `isEpubReaderScrollTarget` 为 false → 不关 PopBar；电子书页主窗极少自滚 | 全页几乎不滚时 spot check |
| flush 与 stop 竞态 | 低 | 与英语 Agent 相同模式；abort 走 complete/error 前 flush | 流式中关问书/停止 → 正文不丢尾字 |

---

## 5. 未改动项

| 项 | 说明 |
|----|------|
| `clearEpubTextSelection` 导出与主动调用方 | 签名与「只清 iframe」语义未改 |
| `onRelocated` / `suppressEpubSelectionPopBarDismiss` | 未改 |
| `EbookAssistant.tsx` 组件树 | 未做英语式 MessageList 拆分（本主题仅 store + scroll 过滤） |
| `useStickToBottomScroll` | 未改 |
| PDF 阅读 | PDF 无正文选区 / 无本 attach；问书 PDF 能力边界不变 |

---

## 6. 回归清单

- [ ] EPUB + 打开 MK 问书：流式输出时在**左侧正文**拖选，选区与复制保持稳定
- [ ] 流式时 PopBar 不被侧栏贴底误关；流结束后仍可对选区用划线/想法/问书
- [ ] **不**开问书：滚正文仍关 PopBar 并清除选区高亮（改前契约）
- [ ] 拖选过程中轻微滚动：选区不被清（`selecting`）
- [ ] 分页翻页 / 切章：relocated 后选区与 PopBar 行为正常
- [ ] 问书发送 → 流式增长 → 停止：气泡内容完整
- [ ] 想法侧栏打开时滚想法列表：不误清 EPUB 选区
- [ ] 听书播放中开问书流式：听书与选区无新增冲突
- [ ] `npx tsc --noEmit`（frontend）

---

## 7. 相关文档滞后

| 文档 | 说明 |
|------|------|
| `docs/ebook/EPUB选区滚动清除.md` | §4.1 仍展示无 `isEpubReaderScrollTarget` 的 `onScroll`；宜补「仅阅读区 scroll 才清选区」一句（本篇为影响面，不重写实现全文） |

---

（若与仓库最新源码不一致，以源码为准）
