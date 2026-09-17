# EPUB 听书布局变化后 Follow FAB — 影响点分析

## 延伸阅读

- [EPUB听书自动跟随浮动按钮.md](../ebook/EPUB听书自动跟随浮动按钮.md) — `autoFollow`、用户滚动打断与 FAB 原实现
- [EPUB窗口尺寸重布局影响.md](./EPUB窗口尺寸重布局影响.md) — 同批 `EpubPane.applyHostResize` 中的窗口/分栏 resize 与 view relayout
- [EPUB听书尺寸重布局影响.md](./EPUB听书尺寸重布局影响.md) — 播放背景 `relayoutListenMarkHighlight` 接线
- [EPUB引用听书播放器栏影响.md](./EPUB引用听书播放器栏影响.md) — 听书播放条与听当前互斥

**阅读约定**：结论以仓库 **当前源码** 为准；「历史风险」指旧实现曾出现的问题，不代表现行代码仍会触发。

## 1. 分析目的

评估 **阅读区布局变化后，当前播放句离屏则展示右下角 Follow FAB** 相关改动，是否改变或破坏已有功能：

- **听书 / 听当前** `autoFollow` 与换句滚入视口
- **用户手动滚动** 打断 autoFollow 与 FAB 显示（原行为）
- **EpubListenFollowFab** 可见性与点击 `resumeEpubListenAutoFollow`
- **分栏拖拽 / 窗口 resize** 触发的 `applyHostResize` 链路
- 与用户划线、想法、PopBar、TTS 播放状态机的隔离

**改动范围（当前 diff，业务源码）**：

| 文件 | 变更 |
|------|------|
| `apps/frontend/src/views/ebook/utils/epub/listen/epubListenSegmentOverlay.ts` | 新增 `checkEpubListenFollowAfterLayout`：双 rAF 后用 `isEpubRangeInReaderView` 检测，离屏则 `pauseListenAutoFollow()` |
| `apps/frontend/src/views/ebook/utils/epub/reader/epubScrolledNav.ts` | 私有 `isDomRangeInReaderView` 改名为导出 `isEpubRangeInReaderView`（逻辑不变） |
| `apps/frontend/src/views/ebook/components/reader/EpubPane.tsx` | `applyHostResize` 末尾调用 `checkEpubListenFollowAfterLayout(rend)` |
| `apps/frontend/src/views/ebook/components/listen/EpubListenFollowFab.tsx` | 注释更新；FAB 定位 `bottom-5.5 right-6`（样式，与播放条避让） |

**调用链核对**：

- `checkEpubListenFollowAfterLayout` **唯一调用方**：`EpubPane.applyHostResize`（经 `scheduleHostResize` / `settleHostResize` 间接调用）。
- `isEpubRangeInReaderView` 新增对外导出；模块内 `scrollEpubRangeIntoView` 仍调用同一实现。
- FAB 仍 `subscribeEpubListenAutoFollow` → `visible = active && !autoFollow`；**未改** FAB 组件显示条件。
- 离屏时通过 `pauseListenAutoFollow()` 将 `autoFollow` 置 `false`，与 **用户滚动打断** 共用状态机；点击仍 `resumeEpubListenAutoFollow()` → 滚回 + `autoFollow=true`。

**结论摘要**：

| 维度 | 是否影响原有功能 | 说明 |
|------|------------------|------|
| 布局变化后播放句离屏出现 FAB（修复目标） | **是（正向）** | 分栏/窗口 resize 后若当前句不在视口，暂停 autoFollow，FAB 出现 |
| 用户手动滚动打断 autoFollow | **否** | `attachListenScrollGuard` 路径未改 |
| 换句自动滚入视口（autoFollow=true） | **否** | `paintSentence` / `showEpubListenDomRange` 未改 |
| FAB 点击回位 | **否** | 仍 `resumeEpubListenAutoFollow` → `scrollActiveListenIntoView` |
| 听书 / 听当前互斥 | **否** | 未改 `clearEpubListenSegmentOverlay` / stop 路径 |
| TTS 播放 / 暂停 | **否** | 不触及播放条或 `playFromCursor` |
| 用户划线 / 想法 | **否** | 仅读 session 内 Range 做可见性判断，不写 marks-pane |
| 分页模式 | **有条件变化** | `isEpubRangeInReaderView` 无 scroll 容器时用 iframe 矩形兜底；离屏判定与滚入视口行为一致 |
| 无听书 session 时 resize | **否** | `check*` 内 `!session` 立即 return |
| FAB 定位样式 | **低（样式）** | 避免与底部播放条重叠 |

---

## 2. 改动要点（相对改前行为）

### 2.1 布局变化后的可见性检测

**改前**：

```text
applyHostResize → softResize → patch 划线 → relayoutListenMarkHighlight
播放句因分栏变窄/窗口放大滚出视口时，autoFollow 仍为 true，FAB 不显示
用户需手动滚动才能触发 pauseListenAutoFollow → FAB
```

**改后**：

```text
applyHostResize 末尾 → checkEpubListenFollowAfterLayout(rend)
  双 rAF 等待布局落稳
  resolveActiveListenDomRange()（听书 activeDomRange 或听当前 lastSentenceIndex）
  isEpubRangeInReaderView(rend, range) 为 false → pauseListenAutoFollow()
  → emitAutoFollowState → FAB visible（active && !autoFollow）
```

**动机**：容器尺寸变化不等于用户 scroll 事件，旧 guard 不会打断 autoFollow；需主动检测离屏。

### 2.2 与既有 autoFollow 状态机的关系

- **不新增** FAB 显示字段；复用 `autoFollow=false` 与现有订阅。
- **不自动滚回**：离屏时只暂停跟随并展示 FAB，与「用户滚走」体验一致；点击 FAB 才滚回。
- 若布局变化后播放句 **仍在视口内**：`check*` 早退，autoFollow 保持 true，FAB 不闪现。

### 2.3 `isEpubRangeInReaderView` 导出

- 原 `epubScrolledNav.ts` 内私有函数重命名导出，供 overlay 与 `scrollEpubRangeIntoView` 共用同一可见性标准（含 72px 留白）。

---

## 3. 影响点矩阵

| 模块 / 场景 | 影响等级 | 分析 |
|-------------|----------|------|
| **听书播放中拖分栏** | 中（体验） | 当前句被挤出视口 → FAB 出现；点击滚回并恢复 autoFollow |
| **听书播放中窗口放大/全屏** | 中（体验） | 同上，与 [epub-window-resize-relayout](./EPUB窗口尺寸重布局影响.md) 同帧触发 |
| **听当前（选区）播放中 resize** | 中（体验） | `resolveActiveListenDomRange` 走 `lastSentenceIndex` 句 Range |
| **用户手动滚动离屏** | 无 | 仍由 scroll/wheel guard → `pauseListenAutoFollow`，行为不变 |
| **autoFollow=true 且句仍在视口** | 无 | `check*` return，不打扰 |
| **autoFollow 已为 false** | 无 | `pauseListenAutoFollow` 早退；FAB 已显示 |
| **换句时 autoFollow 滚入** | 无 | `requestListenAutoFollowScroll` 未改 |
| **听书 forceScroll 跳转分句** | 无 | `showEpubListenDomRange({ forceScroll })` 走 `withProgrammaticScroll`，不经过 `check*` |
| **暂停 / 停止听书** | 无 | `session` 清空后 `check*` 不执行 |
| **非听书阅读 resize** | 无 | `!session` 或 `session.rend !== rend` 短路 |
| **连续滚动 vs 分页** | 低 | 可见性判断复用 `scrollEpubRangeIntoView` 同源逻辑 |
| **用户划线 / 想法 marks** | 无 | 不调用 sync/patch 以外的新路径 |
| **FAB 与播放条叠层** | 低 | `bottom-5.5 right-6` 微调，避免遮挡倍速/播放控件 |

---

## 4. 潜在风险与缓解

| 风险 | 等级 | 说明 | 建议验证 |
|------|------|------|----------|
| 双 rAF 仍早于 marks-pane 就绪 | 低 | 极端时误判离屏 → 误显 FAB；点击可恢复 | 快速连续拖分栏，观察 FAB 是否误闪 |
| resize 每帧触发 `check*` | 低 | 随 `applyHostResize` 每帧最多调度一组双 rAF；`pause` 幂等 | 慢拖分栏观察 CPU |
| 分页模式 iframe 矩形兜底不准 | 低 | 与 `scrollEpubRangeIntoView` 同限；边缘章可能 FAB 与肉眼略不一致 | 分页模式听书 + resize spot check |
| 布局后句在视口边缘（72px 内） | 低 | 与引用定位同一 margin；略出边即显 FAB | 拖分栏使句贴边 |
| 与 window settle 双次 applyHostResize | 低 | `check*` 幂等；多次 pause 无额外副作用 | 放大窗口后等 150ms settle |

---

## 5. 未改动项

| 项 | 说明 |
|----|------|
| `EpubListenFollowFab` 显示条件 | 仍为 `active && !autoFollow` |
| `attachListenScrollGuard` | scroll/wheel 打断逻辑未改 |
| `resumeEpubListenAutoFollow` | 滚回 + 恢复跟随语义未改 |
| `subscribeEpubListenAutoFollow` 类型 | `{ active, autoFollow }` 未扩展 |
| 听书播放条 / `useEbookQuoteListen` | 不在本 diff 逻辑路径内 |
| TTS、预取、句界算法 | 无触达 |

---

## 6. 回归清单

- [ ] **听书**播放中 **拖窄分栏** 使当前句离屏 → 右下角 **FAB 出现**
- [ ] 点击 FAB → 当前句 **滚回视口** 且后续换句 **仍自动跟随**
- [ ] **听书**播放中 **放大窗口** 使当前句离屏 → FAB 出现 → 点击回位
- [ ] **听当前**（选区）播放中 resize → 同上
- [ ] resize 后当前句 **仍在视口内** → **不**出现 FAB（或误闪后立即消失）
- [ ] **用户手动滚动**离屏 → FAB 仍出现（原行为）
- [ ] **暂停听书**后 resize → 无 FAB
- [ ] FAB 与 **底部播放条** 不重叠、可点
- [ ] resize 后 **用户划线 / 句背景** 仍正常
- [ ] `npx tsc --noEmit`（frontend）

---

## 7. 相关文档滞后

| 文档 | 说明 |
|------|------|
| `docs/ebook/EPUB听书自动跟随浮动按钮.md` | 仍写「仅用户滚动打断」；需补 **布局变化离屏** 与 `checkEpubListenFollowAfterLayout` |
| `docs/ebook/developer/EPUB听书开发.md` | FAB 验收表可增「分栏/窗口 resize 离屏」 |
| `docs/ebook/developer/EPUB标注分层共享.md` | `isDomRangeInReaderView` 已改名为 `isEpubRangeInReaderView` 并导出 |
| `docs/impact/EPUB窗口尺寸重布局影响.md` | 本篇描述 Follow FAB 逻辑；该文侧重 view relayout，二者同调 `applyHostResize` |

---

（若与仓库最新源码不一致，以源码为准）
