# EPUB 窗口放大后正文居中 — 影响点分析

## 延伸阅读

- [EPUB窗口尺寸重布局影响.md](../ebook/EPUB窗口尺寸重布局影响.md) — 实现思路与改动前后代码对比
- [EPUB分屏软调整.md](../ebook/EPUB分屏软调整.md) — 分栏拖拽 soft resize 主链路
- [EPUB听书尺寸重布局影响.md](./EPUB听书尺寸重布局影响.md) — 听书播放背景在 resize 下的重绘（`relayoutListenMarkHighlight`）
- [EPUB听书背景与注释影响.md](./EPUB听书背景与注释影响.md) — 播放背景与用户划线 / 想法虚线隔离
- [EPUB听书跟随浮动按钮布局影响.md](./EPUB听书跟随浮动按钮布局影响.md) — 布局变化后播放句离屏触发 Follow FAB（同批 `applyHostResize`）

## 1. 分析目的

评估 **EPUB 窗口放大/全屏后 iframe view 重排 + window.resize 接线** 相关改动，是否改变或破坏已有功能：

- EPUB **分栏拖拽** soft resize（避免 `rendition.resize()` 白屏）
- **窗口最大化 / 全屏 / 缩小** 后正文排版与居中
- **用户划线 / 想法** 批注 sync 与 marks-pane 显示
- **听书 / 听当前** 播放背景与句内高亮
- **选区 PopBar**、翻页、目录跳转、连续滚动 vs 分页
- 同批 diff 内 **听书 FAB / 播放条** 纯样式微调

**改动范围（当前 diff，业务源码）**：

| 文件 | 变更 |
|------|------|
| `apps/frontend/src/views/ebook/utils/epub/reader/epubSoftResize.ts` | 新增 `relayoutEpubViews`；`softResizeEpubRendition` 在 `updateLayout` 后及「尺寸未变」分支调用 view `size` + `expand(true)` |
| `apps/frontend/src/views/ebook/components/reader/EpubPane.tsx` | 引入 `ebookSplitPanelResizingRef`；`window.resize` → rAF `scheduleHostResize` + 150ms 防抖 `settleHostResize`；`applyHostResize` 末尾 `checkEpubListenFollowAfterLayout`；cleanup 清理 timer/listener |
| `apps/frontend/src/views/ebook/components/listen/EpubListenFollowFab.tsx` | FAB 定位 `bottom/right` 微调（纯 className） |
| `apps/frontend/src/views/ebook/components/listen/EpubListenPlayerBar.tsx` | 倍速按钮边框色 `border-textcolor/22` → `border-theme/5`（纯 className） |

**调用链核对**：

- `softResizeEpubRendition` **唯一调用方**：`EpubPane.applyHostResize`（签名与返回值未变）。
- `relayoutEpubViews` 为模块内私有函数，无对外 API 变更。
- `applyHostResize` 仍顺序执行：`softResizeEpubRendition`（失败则 `rend.resize`）→ `patchEpubReadingAnnotations({ sync: true })` → `relayoutListenMarkHighlight` → `checkEpubListenFollowAfterLayout`（Follow FAB 详见 [EPUB听书跟随浮动按钮布局影响.md](./EPUB听书跟随浮动按钮布局影响.md)）。
- 分栏松手仍走 `subscribeEbookSplitPanelResizeEnd(settleHostResize)`，与改前一致。

**结论摘要**：

| 维度 | 是否影响原有功能 | 说明 |
|------|------------------|------|
| 窗口放大后正文居中（修复目标） | **是（正向）** | 旧版贴左需刷新；新版 soft resize 后 relayout view，无需重载章节 |
| 分栏拖拽 soft resize | **低（增强）** | 同一 `applyHostResize` 路径，额外 relayout 已渲染 iframe，拖拽期仍不 `clear` view |
| 用户划线 / 想法数据 | **否** | 不触及 store / 持久化 / CFI 写入逻辑 |
| 划线 / 想法 **显示** | **低** | resize 后仍 `patch`；窗口稳定后多一次 `settleHostResize` → `syncEpubReadingAnnotations`，与分栏松手语义相同 |
| 听书 / 听当前播放背景 | **否** | `relayoutListenMarkHighlight` 调用点未删；无活跃 session 时内部空操作 |
| 听书 / 听当前互斥与播放逻辑 | **否** | 未改 `useEbookQuoteListen`、播放条状态机 |
| 选区 PopBar / 分享书摘 | **否** | 未改选区与 PopBar 组件；仅布局 reflow 后 epub.js 自行维护 Range |
| 翻页 / 目录 / 进度 | **否** | 未改 `display` / `location` / TOC 链路 |
| 连续滚动 vs 分页 | **有条件变化** | 两种模式下均遍历 `manager.views.all()` 中 `displayed` view；连续滚动多章 view 会一并 relayout |
| resize 性能 | **低** | 每次 soft resize 多 O(n) view 次 `size`/`expand`；window resize 150ms 后可能多一次 full sync |
| 听书 FAB 位置 / 倍速按钮边框 | **低（样式）** | 仅 className，无逻辑与数据变化 |

---

## 2. 改动要点（相对改前行为）

### 2.1 `softResizeEpubRendition` — view 层 relayout

**改前**：

```text
stage.size(w,h) → manager.updateLayout() → 结束
已渲染 iframe 仍锁旧 column 宽 → 容器变宽时正文贴左
尺寸与 _stageSize 相同时直接 return true，不重排 view
```

**改后**：

```text
stage.size(w,h) → updateLayout() → relayoutEpubViews()
  对每个 displayed view：view.size(w,h) + view.expand(true)
尺寸未变分支也调用 relayoutEpubViews（修复 view 与 stage 不同步）
```

**动机**：epub.js 初始化后不会监听 `window.resize`；仅改 stage 不足以让 iframe 按新栏宽居中。

### 2.2 `EpubPane` — 补 `window.resize`

**改前**：

```text
仅 ResizeObserver(host) → scheduleHostResize → applyHostResize
分栏松手 → settleHostResize（full sync）
```

**改后**：

```text
ResizeObserver(host) — 不变
window.resize → scheduleHostResize
  若 ebookSplitPanelResizingRef 为 false → 150ms 防抖 settleHostResize
  分栏拖拽中跳过 debounce settle（松手仍走 splitResizeEnd）
cleanup 清除 windowResizeSettleTimer 与 listener
```

**动机**：最大化/全屏时容器尺寸变化与 ResizeObserver 时序偶发不一致；稳定后 full sync 与分栏结束对齐。

### 2.3 同批听书 UI 微调（附带）

- **Follow FAB**：`bottom-4 right-4` → `bottom-5.5 right-6`，避免与播放条重叠。
- **倍速按钮**：边框改为 `border-theme/5`，与阅读 chrome 一致。

---

## 3. 影响点矩阵

| 模块 / 场景 | 影响等级 | 分析 |
|-------------|----------|------|
| **窗口最大化 / 全屏（EPUB）** | 中（修复） | 用户可见：正文由贴左变为按新宽度居中；不触发 `rendition.resize()` 清 view |
| **窗口缩小** | 低 | 同上 relayout 路径；极端窄宽仍受 `Math.max(..., 320)` 约束 |
| **MOKE/想法分栏拖拽** | 低 | 仍每帧 `scheduleHostResize`；`ebookSplitPanelResizingRef` 阻止 window settle 与 split end 重复 full sync；松手 `notifyEbookSplitPanelResizeEnd` 不变 |
| **打开/关闭想法侧栏（宽度跳变）** | 低 | 仍走 ResizeObserver → `applyHostResize`；新增 view relayout 使侧栏开关后 iframe 更快对齐 |
| **用户划线 marks-pane** | 低 | `patchEpubReadingAnnotations` 仍在每次 `applyHostResize`；window 稳定后 `syncEpubReadingAnnotations` 与改前 split end 同级 |
| **想法虚线** | 低 | 同上 sync 路径；数据层无改动 |
| **听书句背景 / 听当前 cadence** | 无 | `relayoutListenMarkHighlight(rend)` 保留；无 active session 时不绘制 |
| **听书 Follow FAB** | 低（样式 + 间接） | 定位微调；离屏显 FAB 见 [EPUB听书跟随浮动按钮布局影响.md](./EPUB听书跟随浮动按钮布局影响.md) |
| **听书播放条倍速** | 低 | 仅边框色；菜单与 TTS 逻辑未动 |
| **连续滚动多章 view** | 低 | `relayoutEpubViews` 只处理 `displayed === true` 的 view；未展示章不 expand |
| **分页翻页模式** | 低 | 单屏 view relayout；翻页 API 未改 |
| **PDF 阅读** | 无 | `EpubPane` 仅 EPUB；PDF 走独立 pane |
| **选区 / PopBar / 分享** | 无 | 组件与 hook 未在 diff 内；布局 reflow 由 epub.js 处理 |
| **阅读进度 / CFI 持久化** | 无 | 未调用 `display` 重载；location 不因 resize 重置 |
| **双通道 resize（RO + window）** | 低 | 同一事件可能触发两次 `scheduleHostResize`；rAF 合并为单帧 `applyHostResize` |

---

## 4. 潜在风险与缓解

| 风险 | 等级 | 说明 | 建议验证 |
|------|------|------|----------|
| 连续 window resize 频繁 full sync | 低 | 150ms 防抖内多次 resize 只 settle 一次 | 快速拖拽窗口边缘，观察 CPU 与划线是否闪烁 |
| `expand(true)` 引发布局抖动 | 低 | 仅对已 display 的 view；分栏拖拽期每帧可能 relayout | 慢拖分栏手柄，确认无白屏、无章节重载 |
| view API 缺失时 silent skip | 低 | `view.size?.` / `views?.all` 可选链；旧 epub.js 结构异常时行为与改前接近 | 打开多章连续滚动书，放大窗口 spot check |
| 与 split end 双次 settle | 低 | 拖拽中 window settle 被 ref 守卫；松手仅 split end 一次 | 拖分栏同时改变窗口大小（边缘 case） |
| FAB 新位置遮挡正文 | 低 | 仅听书跟读 FAB；位置略上移/左移 | 听书播放中点击 FAB 与底部播放条是否重叠 |

---

## 5. 未改动项

| 项 | 说明 |
|----|------|
| `rendition.resize()` 兜底 | soft 失败时仍完整 resize，语义未变 |
| `subscribeEbookSplitPanelResizeEnd` | 分栏结束回调注册方式与 `settleHostResize` 实现未改 |
| `patchEpubReadingAnnotations` / `syncEpubReadingAnnotations` | 函数本身未改；仅 window resize 多一条触发 settle 的路径 |
| 听书 / 听当前状态机、`useEbookQuoteListen` | 不在 diff 内 |
| PopBar chrome、分享弹窗、阅读设置 | 不在 diff 内（姊妹实现文档另篇） |
| PDF、书架、上传 | 无触达 |
| `softResizeEpubRendition` 对外签名 | 仍为 `(rend, width, height) => boolean` |

---

## 6. 回归清单

- [ ] 打开 EPUB → **放大窗口 / 全屏** → 正文居中，**无需刷新**
- [ ] 放大后 **用户划线 / 想法虚线** 仍可见、位置合理
- [ ] **连续滚动** 与 **分页翻页** 各测一次窗口放大
- [ ] **慢拖 MOKE/想法分栏** → 无白屏、松手后划线与正文对齐
- [ ] **听书播放中** 放大窗口 → 句背景仍对齐（或 Follow FAB 可恢复）
- [ ] **听当前** 播放中 resize → 句内高亮无永久错位
- [ ] 窗口 resize 期间 **选区 PopBar** 仍可弹出、操作正常
- [ ] 关闭阅读页 → 无 `resize` listener 泄漏（DevTools 无重复回调）
- [ ] 听书 **Follow FAB** 与 **底部播放条** 不重叠、可点
- [ ] `npx tsc --noEmit`（frontend）

---

## 7. 相关文档滞后

| 文档 | 说明 |
|------|------|
| `docs/ebook/EPUB分屏软调整.md` | 已补链 `EPUB窗口尺寸重布局影响.md`；正文仍侧重分栏，view relayout 细节以新专题为准 |
| `docs/impact/EPUB听书尺寸重布局影响.md` | 仍描述 `relayoutListenMarkHighlight` 接线；本篇补充 **view relayout** 与 **window.resize** 对同一 `applyHostResize` 的叠加影响 |
| `docs/impact/EPUB听书跟随浮动按钮布局影响.md` | 布局离屏触发 FAB 的专项影响面；与本篇共享 `applyHostResize` 调用点 |

---

（若与仓库最新源码不一致，以源码为准）
