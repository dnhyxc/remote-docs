# EPUB 电子书全功能开发者实现手册（epub-all-features-dev）

> 版本：v1 · 2026-07-03
> 范围：`apps/frontend/src/views/ebook/**` 全部 EPUB（+ 旁路 PDF）功能点，端到端实现思路、链路、源码。
> 读者：希望在自己的项目中**完整复刻**本仓库 EPUB 阅读器全部能力的开发者。
> 目标：读完后能**照着实现**或**直接搬用**任一功能。

---

## 0. 文档角色 / 维护定位 / 阶段路线 / 调用链

### 0.1 文档角色与阅读顺序

| 顺序 | 章节                                      | 你将得到                                        |
| ---- | ----------------------------------------- | ----------------------------------------------- |
| ①    | §1 模块地图                               | 一眼看清前端 EPUB 阅读器的 30+ 关键文件如何分工 |
| ②    | §2 白话思路（5 分钟）                     | 不读代码也能讲清功能怎么跑                      |
| ③    | §3–§14 分模块链路                         | 每个功能点的"入口 → 链路 → 副作用 → 互斥/边界"  |
| ④    | §15 跨模块互斥 & 生命周期                 | 听书 vs 引用听读 vs 划线 vs PopBar 谁抢谁       |
| ⑤    | §16 验收清单                              | 拿来当 e2e / 回归用例                           |
| ⑥    | §17 自检 & 回归坑位                       | 性能、批注闪烁、跨 iframe 坐标、视口裁剪        |
| ⑦    | §18 源码对照（11 个最关键符号，逐行注释） | 直接抄                                          |
| ⑧    | §19 复用清单                              | "我要在自己的项目里复刻 EPUB，应该带走哪些文件" |

### 0.2 与既有 developer 手册的分工

| 文档                                                                     | 主题                    | 与本文档的关系                                                                    |
| ------------------------------------------------------------------------ | ----------------------- | --------------------------------------------------------------------------------- |
| [EPUB听书开发.md](./EPUB听书开发.md)                               | 听书（章节连读）        | 单一功能深度版；本文档 §11 是其精简版                                             |
| [EPUB想法添加下划线开发.md](./EPUB想法添加下划线开发.md) | 新增想法下划线          | 单一功能深度版；本文档 §10 是其精简版                                             |
| [EPUB用户划线开发.md](./EPUB用户划线开发.md)               | 用户划线                | 单一功能深度版；本文档 §9 是其精简版                                              |
| [EPUB标注分层共享.md](./EPUB标注分层共享.md)               | 划线/想法 mark 共享底座 | 本文档 §12 复用并对齐                                                             |
| **EPUB全特性开发.md（本文件）**                                   | **EPUB 全功能端到端**   | **唯一完整版**：覆盖打开、目录、连续滚动、选区、右键、划线、想法、听书、互斥、PDF |

> 旧增量专题（`docs/ebook/<feature>.md`）属于历史 diff 归档；想看"现在应该怎么实现"请来 `developer/` 目录。

### 0.3 维护定位表（出问题先看这里）

| 现象                              | 文件                            | 符号                                                 | 怎么验                       |
| --------------------------------- | ------------------------------- | ---------------------------------------------------- | ---------------------------- |
| 换书不重载、进度丢失              | `read.tsx`                      | `useEffect(..., [bookId, open])` 链                  | 切书观察 `EpubPane` 是否重建 |
| 翻页/分栏 resize 后高亮消失/错位  | `EpubPane.tsx`                  | `applyHostResize` / `softResizeEpubRendition`        | 拖分栏、最大化、缩窗口       |
| 连续滚动选不到最后一行            | `epubRangeGeometry.ts`          | `getAccurateRangeLineClientRects`                    | 选最后一行靠右部分           |
| 跨章目录跳转后没对齐              | `epubScrolledNav.ts`            | `displayEpubScrolledHref` / `settleScrolledNavAlign` | 点目录切到下一章             |
| 听书 TTS 报"unsupported"          | `useEpubChapterListen.ts`       | `isPlaybackAvailable`                         | 检查 `speech` 是否就绪   |
| 听书节末无法接续下一章            | `epubScrollListenAdvance.ts`    | `advanceScrollListenSection`                         | 听完一章观察是否自动下一章   |
| 想法下划线在不同笔记下重色        | `epubThoughtAnnotations.ts`     | `resolveThoughtLineColor`                            | 公开/私有笔记混看            |
| 划线/想法叠层错乱（想法盖住划线） | `epubUserHighlights.ts`         | `restackUserHighlightMarkGroups`                     | 同一位置划线 + 想法          |
| PopBar 划线/想法重复弹出          | `epubSelectionToolbarAttach.ts` | `suppressEpubSelectionPopBarDismiss`                 | 划线后立即点同一位置         |
| 右键菜单误判选区                  | `epubContextMenuAttach.ts`      | `hadSelectionBeforeRightClick`                       | 浏览器自动选词               |
| 听书与引用听读同时触发            | `epubListenSegmentOverlay.ts`   | `invokeStopQuoteListen` / `invokeStopChapterListen`  | 听书时点引用听读             |
| 视口外想法 mark 残留              | `epubThoughtAnnotations.ts`     | `applyEpubThoughtUnderlines(viewportMode)`           | 快速滚到底再回顶             |
| 公开笔记同步不到                  | `usePublicEbookThoughtSync.ts`  | `scheduleSync`                                       | 关闭/打开 Tab 触发           |
| 阅读器背景色与全局主题不一致      | `epubReaderSettings.ts`         | `applyEpubReaderAppearance`                          | 切主题                       |
| PDF 缩放越界                      | `pdfReaderSettings.ts`          | `clampPdfZoom`                                       | 0.5x–3x 之外被夹回           |
| PDF 滚到底不翻页                  | `pdfScrolledNav.ts`             | `attachPdfScrolledEdgeNav`                           | 稳定 220ms 后再滚一下        |

### 0.4 从零到上线：M1–M8 落地阶段

| 阶段                       | 目标                                                       | 不要做                 | 验收                                   |
| -------------------------- | ---------------------------------------------------------- | ---------------------- | -------------------------------------- |
| **M1 渲染管线**            | `EpubPane` 实例化 epub.js、display 首屏、resize、destroy   | 不要碰选区/划线        | 打开书、翻页、拖分栏、切书无残留       |
| **M2 阅读设置**            | 主题/字号/行距/背景色/排版模式实时落 iframe                | 不要碰听书             | 切设置立即生效，刷新页面后保留         |
| **M3 目录与导航**          | TOC 解析、spine index 反查、连续滚动对齐、PDF 大纲         | 不要碰选区             | 跳转准确；分页/连续滚动都能用          |
| **M4 选区 + PopBar**       | mouseup/selectionchange、跨 iframe 坐标、点位抑制          | 不要碰划线/想法        | 松手出 PopBar，滚动/右键不出           |
| **M5 用户划线**            | 高亮/下划线/波浪线、SVG marks-pane、点击 PopBar、合并/裁剪 | 不要碰想法             | 划线可增删改；连续滚动不抖             |
| **M6 想法下划线**          | 懒加载、视口动态挂载、连通簇、自动/手动 pin、跨用户配色    | 不要做"侧栏列表"       | 大书也能丝滑；公开/他人可见            |
| **M7 听书**                | 章节连读（连续滚动/分页）、引用听读、自动跟随、互斥        | 不要碰划线/想法的 mark | 听书可暂停/续播/换倍速；引用听读可打断 |
| **M8 PDF + 持久化 + 同步** | PDF 阅读、localStorage 持久化、公开笔记同步、分享卡片      | 不要改 EPUB 核心管线   | 缩放/翻页/分享/跨设备同步 OK           |

### 0.5 运行时调用链（一图流）

```
              ┌──────────────────────────────────────────┐
              │            apps/frontend/src/views/ebook │
              │   read.tsx  (页面壳 + 状态总线)             │
              └────────┬─────────────────────────────────┘
                       │ props
                       ▼
              ┌──────────────────────────────────────────┐
              │ components/reader/EpubPane.tsx            │
              │  - epub.js Book / Rendition 生命周期       │
              │  - 选区/右键/上下文菜单/键盘/ResizeObserver  │
              └──┬─────────┬─────────┬─────────┬─────────┘
                 │         │         │         │
   install*      │         │         │         │
   listeners     ▼         ▼         ▼         ▼
   ┌──────────────────┐ ┌────────┐ ┌────────┐ ┌─────────────┐
   │mark/             │ │reader/ │ │listen/ │ │common/      │
   │ epubUserHighlights│ │epub*   │ │epub*   │ │ epubSplit*  │
   │ epubThoughtAnn*  │ │ ...    │ │ ...    │ │ readerScroll│
   │ epubRangeGeometry│ │        │ │        │ │ tocActive   │
   │ epubThoughtCluster│        │ │        │ │ coverImage  │
   └──────┬───────────┘ └────┬───┘ └───┬────┘ └──────┬──────┘
          │ epub.js annotations API
          ▼
   ┌──────────────────────────┐
   │ epub.js Rendition         │
   │ - annotations (highlight/│
   │   underline)              │
   │ - contents[] (iframes)    │
   │ - marks-pane + SVG        │
   └────────┬─────────────────┘
            │ rAF / ResizeObserver / scroll / wheel
            ▼
   ┌──────────────────────────┐
   │ DOM: <iframe> per spine   │
   │  - DOM Range / CFI        │
   │  - SVG <g> / <rect>/<path>│
   │  - .marks-pane            │
   └────────┬─────────────────┘
            │
            ▼
   ┌──────────────────────────┐
   │ hooks/                    │
   │  useEpubChapterListen     │
   │  useEbookQuoteListen      │
   │  useEbookThoughtLoader    │
   │  usePublicEbookThoughtSync│
   └──┬───────────────────────┘
      │ TTS / 文本片段 / 句级 Range
      ▼
   ┌──────────────────────────┐
   │ utils/speech          │
   │  - playPreferred   │
   │  - prefetchCloudTts│
   │  - stripMarkdownForTts    │
   └────────┬─────────────────┘
            │  TTS / 浏览器 SpeechSynthesis
            ▼
       浏览器 / 云端 TTS
```

---

## 1. 模块地图

> 一图看清 30+ 个关键文件（按职责分组）

### 1.1 入口与页面壳

| 文件                                 | 角色                                                                                                            |
| ------------------------------------ | --------------------------------------------------------------------------------------------------------------- |
| `read.tsx`                           | 整页状态机：选区、PopBar、划线、想法、听书、上下文菜单、分享、AI 助手、笔记详情、公开同步等全部状态都在这里汇聚 |
| `components/reader/EpubPane.tsx`     | epub.js 渲染器主生命周期；统一安装选区/右键/划线/想法监听                                                       |
| `components/reader/PdfPane.tsx`      | PDF 阅读器外壳（详见 §14）                                                                                      |
| `hooks/useEbookQuoteListen.ts`       | 引用/选区听读（共用英语学习 TTS）                                                                               |
| `hooks/useEpubChapterListen.ts`      | 章节连读（连续滚动 + 分页）                                                                                     |
| `hooks/useEbookThoughtLoader.ts`     | 想法懒加载（按 spine 提示）                                                                                     |
| `hooks/usePublicEbookThoughtSync.ts` | 公开/共享笔记的 since-based 增量同步                                                                            |
| `types/index.ts`                     | 全局类型（EbookThought、EbookUserHighlight、EbookTocItem 等）                                                   |

### 1.2 工具：阅读器

| 文件                                              | 角色                                                                                   |
| ------------------------------------------------- | -------------------------------------------------------------------------------------- |
| `utils/common/io.ts`                              | 桌面/云端打开、文件名/格式解析、File 构造                                              |
| `utils/common/coverImage.ts`                      | 封面上传（压缩到 640px / 0.85q）                                                       |
| `utils/common/ebookSplitResize.ts`                | 分栏拖拽事件总线                                                                       |
| `utils/common/readerScrollbar.ts`                 | 原生滚动条 Tailwind 美化类名                                                           |
| `utils/common/tocActiveIndex.ts`                  | 目录项高亮（EPUB spine / PDF 页码通用）                                                |
| `utils/epub/reader/epubReaderSettings.ts`         | 主题/字号/行距/背景/排版 设置 schema、localStorage 持久化、`applyEpubReaderAppearance` |
| `utils/epub/reader/epubScrolledNav.ts`            | 连续滚动：edge nav、目录跳转对齐、视口定位                                             |
| `utils/epub/reader/epubSelectionToolbarAttach.ts` | 选区监听、PopBar payload、跨 iframe 锚点                                               |
| `utils/epub/reader/epubContextMenuAttach.ts`      | 右键菜单挂载（iframe 内）                                                              |
| `utils/epub/reader/epubQuoteShareStyled.ts`       | 选区 quote 转富文本片段（用于分享卡片）                                                |
| `utils/epub/reader/epubQuoteShareCard.ts`         | 引用分享卡片渲染（html-to-image）                                                      |
| `utils/epub/reader/buildEpubContextMenuItems.ts`  | EPUB 右键菜单条目构造（结构对齐 Monaco）                                               |
| `utils/epub/reader/epubSoftResize.ts`             | 软 resize（不重载视图）                                                                |
| `utils/epub/reader/epubSpineIndex.ts`             | nav href → spine index                                                                 |

### 1.3 工具：批注（mark 层共享底座）

| 文件                                        | 角色                                                            |
| ------------------------------------------- | --------------------------------------------------------------- |
| `utils/epub/mark/epubMarkShared.ts`         | CFI spine 提取/归一、Range 关系、SVG 属性写入、marks-pane 查找  |
| `utils/epub/mark/epubRangeGeometry.ts`      | CFI ↔ DOM Range、选区归一、文本片段 rect、Svg 坐标投影          |
| `utils/epub/mark/epubUserHighlights.ts`     | 用户划线（高亮/下划线/波浪线、合并/裁剪、点击监听、patch 调度） |
| `utils/epub/mark/epubThoughtAnnotations.ts` | 想法下划线（apply/pin/视口裁剪/click guard）                    |
| `utils/epub/mark/epubThoughtCluster.ts`     | 想法簇（连通闭包、组聚合、quote 归并）                          |
| `utils/epub/mark/epubThoughtSync.ts`        | 公开/共享笔记的 since-based diff 工具                           |

### 1.4 工具：听书

| 文件                                            | 角色                                                           |
| ----------------------------------------------- | -------------------------------------------------------------- |
| `utils/epub/listen/epubListenChapter.ts`        | 章节级：可见段抽取、句级 Range、句高亮、章节间等待             |
| `utils/epub/listen/epubListenSegmentOverlay.ts` | 引用听读：overlay session、auto-follow、scroll guard、互斥注册 |
| `utils/epub/listen/epubListenMarkHighlight.ts`  | 听书 mark 高亮（淡黄色覆盖层）                                 |
| `utils/epub/listen/epubScrollListenAdvance.ts`  | 连续滚动听书节间推进（slot 推进 + manager.check）              |

### 1.5 工具：PDF

| 文件                                    | 角色                                                 |
| --------------------------------------- | ---------------------------------------------------- |
| `utils/pdf/pdfSetup.ts`                 | worker/wasm/cmap 资源 URL 初始化                     |
| `utils/pdf/pdfOutline.ts`               | PDF 大纲（书签）→ 通用 `EbookTocItem`                |
| `utils/pdf/pdfReaderSettings.ts`        | PDF 缩放持久化                                       |
| `utils/pdf/pdfScrolledNav.ts`           | PDF 单页/连续滚动边缘翻页（稳定 220ms + 冷却 600ms） |
| `utils/pdf/buildPdfContextMenuItems.ts` | PDF 右键菜单                                         |

### 1.6 通用能力

| 文件                 | 角色                                                                                                                                                                   |
| -------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `@/utils/speech` | 浏览器 SpeechSynthesis + 云端 TTS 预取/优选                                                                                                                            |
| `@/service/ebook`    | `fetchEbookThoughts` / `fetchEbookThoughtSync` / `fetchEbookHighlights` / `fetchEbookBytes` / `createEbookHighlight` / `updateEbookHighlight` / `deleteEbookHighlight` |
| `@/utils/clipboard`  | `copyToClipboard`（写入剪贴板）                                                                                                                                        |
| `@/utils/runtime`    | `isTauriRuntime`（桌面端）                                                                                                                                             |

---

## 2. 白话思路（5 分钟全景 + 场景 + 文件拆解）

### 2.0 五分钟全景

把 `read.tsx` 想象成**总指挥**：

1. **它把书打开**：`resolveOpen` → 桌面端优先本地（通过 Tauri 的 `read_ebook_file` 命令），失败回退云端 `fetchEbookBytes`。把 `ArrayBuffer` 传给 `EpubPane`。
2. **`EpubPane` 实例化 epub.js**：`ePub(buf, { openAs: 'binary' })` → `book.opened` → `book.renderTo(host, { flow: 'paginated' | 'scrolled' })` → `applyEpubReaderAppearance(settings, appTheme)` → `rend.display(initialCfi)` → 拿到 `rend.on('relocated', ...)` 回调 CFI + 百分比 → 把它**整个 renderer 的 API**通过 `onReady({ prev, next, go, clearTextSelection, getRendition, getBook, syncReadingAnnotations })` 暴露给 `read.tsx`。
3. **`read.tsx` 把 API 接到各种 hook 与监听器**：
   - 选区监听器 `attachEpubSelectionPopBar` 把 `mouseup/selectionchange/contextmenu` 翻译成 `EpubSelectionPopBarPayload`。
   - 右键菜单 `attachEpubIframeContextMenu` 翻译成 `EpubReaderContextMenuPayload`。
   - 划线 hook（`upsertHighlightForQuote` / `removeHighlightsForQuote`）维护 `highlights` 状态。
   - 想法 `useEbookThoughtLoader` + `usePublicEbookThoughtSync` + `applyEpubThoughtUnderlines`。
   - 听书 `useEpubChapterListen` + `useEbookQuoteListen`。
4. **状态总线**：`read.tsx` 维护一个庞大的 `useState` 集群（`highlights`、`thoughts`、`selectionPopBar`、`thoughtDialogOpen`、`highlightStyle` 等），每个动作只更新一个状态，UI 跟着 React 重渲染。
5. **后端**：所有写操作走 `service/ebook` 的 REST API，公开笔记走 `since` 增量同步。

> 关键架构原则：**epub.js 是单一渲染源**；所有划线、想法、听书高亮都是**叠加层**（epub.js annotations API + iframe 内 SVG marks-pane），不是改原文 DOM。

### 2.1 关键场景

#### 场景 A：用户选词 → 划线

1. 鼠标按下：`mousedown` → 记录 `selecting=true` → 关 PopBar。
2. 拖动：`selectionchange` 触发 → 不 emit（拖动中不出 PopBar）。
3. 鼠标松开：`mouseup` → `emitSelection` → `readActiveSelection` → `normalizeSelectionRangeForEpub` → `resolveSelectionCfiRange` → `rangeToViewportAnchor` → `onChange(payload)` → `read.tsx` 收到 `payload` → `setSelectionPopBar({ open:true, ...payload })`。
4. 用户点 PopBar 颜色/样式 → `upsertHighlightForQuote(style, color)`：
   - 归一化 CFI、合并重叠/被包含的旧划线、计算新 quote。
   - 调 `createEbookHighlight` / `updateEbookHighlight`。
   - `setHighlights(next)` 触发 `EpubPane` 的 `useEffect` → `syncEpubUserHighlights` → `rend.annotations.highlight(cfi, data, click, className, styles)` → SVG 渲染。
5. 翻页/滚动 → `installEpubUserHighlightPatchListeners` 监听到 `relocated`/`scroll`/`rendered` → `patchEpubReadingAnnotations`（仅 patch 不重建 mark，避免闪烁）。

#### 场景 B：公开笔记想法下划线

1. `useEbookThoughtLoader`：当 `epubNavReady && bookId` 触发 → `ensureLoadedSpineThoughts(rend)` → `collectLoadedSpineHints(rend)` → 拿到当前已加载 spine 列表 → 对每个 hint `fetchEbookThoughts(bookId, { spineHints: [hint] })` → `mergeThoughts`（按 id 去重）。
2. `usePublicEbookThoughtSync`：开启公开同步时 → `since = max(updatedAt)` → `fetchEbookThoughtSync(bookId, since)` → `applyEbookThoughtSync` 合并 → 通知 `EpubPane`。
3. `EpubPane` 的 `useEffect` 监听 `thoughts` / `annotationSpineKey` → `syncEpubThoughtUnderlines` → `applyEpubThoughtUnderlines(rend, thoughts, appliedRef, currentUserId)` → 按视口动态挂载/回收 → `rend.annotations.underline(cfiRange, { thoughtIds, showLine, lineOwn }, undefined, EPUB_THOUGHT_UNDERLINE_CLASS, styles)`。
4. 视口滚动停稳（`VIEWPORT_SCROLL_IDLE_MS=100`） → `refreshThoughtUnderlinesInViewport` → 移除带外 mark、keep 带内 mark。
5. 点击 mark：用户手势 + selectionchange 抑制 → 触发 mark click → `EpubPane` 透传 `onThoughtClick` → `read.tsx` 决定开 cluster 列表或详情。

#### 场景 C：听书（连续滚动模式）

1. 用户点听书按钮 → `toggleChapterListen` → `startFromCurrentPosition`：
   - `primePlaybackForUserGesture`（user gesture 解锁 TTS）。
   - `isPlaybackAvailable` 检查 → `Toast` 失败提示。
   - `invokeStopQuoteListen` / `stopAllPlayback` 清理互斥。
   - `beginChapterListenAutoFollow(rend)` 启动自动跟随。
2. `extractVisibleListenSection(rend, spineHint)`：挑当前 spine 的 document → `body.innerText` 提取正文 → `stripMarkdownForTts` 去 markdown → `selectNodeContents(body)` 建 outerRange → 返回 `{ plain, outerRange, spineIndex }`。
3. `buildSentenceOffsetSpans(plain)`：正则切句 → `[{start, end}, ...]`。
4. `indexChapterSentenceRanges(outerRange, plain)`：递归展开 body 所有文本节点 → 标准化空白 → 在 norm 流中顺序搜索每句的 needle → 返回 `Range[]`（每句 DOM 区间）。
5. 主循环 `runListenLoop` → `isScrollListenMode` 选 `runScrollSectionLoop`：
   - `playSentencesFromCursor(ctx, gen, { scrollCenterOnFirst })`：
     - 预取 `si+1` 句云端 TTS。
     - 逐句 `playPreferred(spokenRaw, { speak: { rate }, prefetchedCloud })`。
     - `showChapterListenSentenceHighlight(rend, domRange, jumpScroll?)` 触发句级高亮（自动滚到视口）。
6. 节末 `advanceScrollListenSection(rend, sectionDoc)`：列 `manager.views` 槽位 → 找下一 loaded doc → 否则 `scrollTo` + `manager.check()` 触发挂载。
7. 全部完成 → `Toast("finished")` → `stopInternal()`。

#### 场景 D：互斥矩阵

| 当前态 → 启动 | 听书                              | 引用听读                                | 划线                         | 想法 click |
| ------------- | --------------------------------- | --------------------------------------- | ---------------------------- | ---------- |
| 听书运行      | —                                 | 引用听读 `invokeStopChapterListen` 抢断 | 划线可点（高亮不会顶替听书） | 想法可点   |
| 引用听读运行  | 听书 `invokeStopQuoteListen` 抢断 | —                                       | 同上                         | 同上       |
| 划线          | 不互斥                            | 不互斥                                  | —                            | 不互斥     |
| 想法          | 不互斥                            | 不互斥                                  | 不互斥                       | —          |

> 实现：`registerChapterListenStop` / `registerQuoteListenStop` 是跨 hook 互斥通道；新启动前先 `invokeStop*`。

### 2.2 按文件拆解（实现 → 触发 → 副作用）

| 文件                            | 入口                          | 触发                              | 副作用                          | 关键点                                      |
| ------------------------------- | ----------------------------- | --------------------------------- | ------------------------------- | ------------------------------------------- |
| `read.tsx`                      | 页面渲染                      | URL/bookId 变化                   | 全局状态机                      | 听书/划线/想法 PopBar 全部在这里聚合        |
| `EpubPane.tsx`                  | `open` 变化                   | props 变化/父级 onReady           | epub.js 实例生命周期            | 单一 useEffect 串起 book/rend/ready/cleanup |
| `epubUserHighlights.ts`         | `syncEpubUserHighlights`      | thoughts/highlights 变化          | 调 `rend.annotations.highlight` | 合并/裁剪/视口裁剪/点击/Patch               |
| `epubThoughtAnnotations.ts`     | `applyEpubThoughtUnderlines`  | thoughts 变化 / 视口滚动          | 调 `rend.annotations.underline` | 视口模式 + pin 机制 + 点击防护              |
| `epubRangeGeometry.ts`          | CFI/Range 互换                | 选区/合并/高亮                    | DOM 操作                        | 文本片段精确 rect 抽取                      |
| `epubScrolledNav.ts`            | `displayEpubScrolledHref`     | 目录跳转/边缘滚动                 | 改 `container.scrollTop`        | 多帧 settle 校正 + 边缘 wheel 翻章          |
| `epubSelectionToolbarAttach.ts` | `attachEpubSelectionPopBar`   | epub.js hook content              | 上报 PopBar payload             | 跨 iframe 坐标、selectionchange 抑制        |
| `epubContextMenuAttach.ts`      | `attachEpubIframeContextMenu` | iframe contextmenu                | 上报右键 payload                | 区分"主动选区"vs"自动选词"                  |
| `epubReaderSettings.ts`         | `applyEpubReaderAppearance`   | 设置变化                          | 改 `rend.themes.default`        | 12 套背景 / 12 套文字色                     |
| `useEpubChapterListen.ts`       | `toggleChapterListen`         | 听书按钮                          | TTS + 句高亮                    | loopGenRef 防并入；scroll 模式选择          |
| `useEbookQuoteListen.ts`        | `toggleListen`                | 引用听读按钮                      | TTS + 段高亮                    | 与听书互斥；fallback plain                  |
| `useEbookThoughtLoader.ts`      | `ensureLoadedSpineThoughts`   | rend ready / 换书                 | 调 `fetchEbookThoughts`         | per-spine 缓存 + in-flight 复用             |
| `usePublicEbookThoughtSync.ts`  | `scheduleSync`                | relocated 停稳 / visibilitychange | 调 `fetchEbookThoughtSync`      | since-based 增量；新数据 ephemeral pin      |

---

## 3. 渲染管线：EpubPane 与 epub.js 全生命周期

### 3.1 文件：[EpubPane.tsx](file:///Users/dnhyxc/Documents/code/dnhyxc-ai/apps/frontend/src/views/ebook/components/reader/EpubPane.tsx)

> 这是整个 EPUB 渲染的"心脏"——一个 React 组件持有所有 `ref` 并串联 epub.js 生命周期。

#### 3.1.1 props 与对外 API

```ts
type NavApi = {
	prev: () => Promise<void>; // 翻到上一页（分页有效；连续滚动滚到底由 wheel 自动接续）
	next: () => Promise<void>; // 翻到下一页
	go: (href: string) => Promise<void>; // 跳转：分页 rend.display；连续滚动 displayEpubScrolledHref
	clearTextSelection: () => void; // 清掉所有 iframe + 顶层选区
	getRendition: () => Rendition | null;
	getBook: () => Book | null;
	syncReadingAnnotations: (next?) => void; // 强制重算划线 + 想法叠层
};
```

#### 3.1.2 关键 ref 群

| ref                                           | 用途                                      |
| --------------------------------------------- | ----------------------------------------- |
| `rendRef`                                     | epub.js Rendition 实例                    |
| `bookRef`                                     | epub.js Book 实例                         |
| `locationsReadyRef`                           | 是否已生成全书百分比                      |
| `readyRef`                                    | rend 是否 ready（用于边缘翻章、滚到视口） |
| `appliedThoughtsRef` / `appliedHighlightsRef` | `cfi -> sig` 缓存；sync 时避免重画        |
| `currentCfiRef`                               | 当前 CFI（用于 saveProgress）             |
| `on*Ref`                                      | 回调 ref 模式（避免 effect 依赖回调引用） |
| `keyboardNavEnabledRef`                       | 目录打开时禁翻页键                        |

#### 3.1.3 生命周期阶段

1. **实例化**：`ePub(open, { openAs:'binary', replacements:'blobUrl' })`。
2. **打开**：`await book.opened`。
3. **算尺寸**：`Math.max(el.clientWidth, 320)` 防 0。
4. **创建 rendition**：`book.renderTo(el, { width, height, flow, manager, spread:'none', allowScriptedContent:true })`。
5. **应用外观**：`applyEpubReaderAppearance(rend, settings, appTheme)`。
6. **绑定事件**：`rend.on('relocated', relocate)` + `rend.on('keydown', onRenditionKeyDown)`。
7. **挂上下文菜单 / 选区浮条**：`attachEpubIframeContextMenu` + `attachEpubSelectionPopBar`。
8. **首次 display**：`await rend.display(initialCfi)`。
9. **等待 book.ready**。
10. **上报 onReady**。
11. **加载目录**：`book.loaded.navigation` → 转 `EbookTocItem`。
12. **后台生成 locations**：`book.locations.generate(1600)`。

#### 3.1.4 尺寸自适应（`applyHostResize`）

```
1. ResizeObserver(el)  → scheduleHostResize (rAF 防抖)
2. window resize       → onWindowResize → setTimeout 150ms → settleHostResize
3. settleHostResize    → 调 rend.resize 兜底；同时调 softResizeEpubRendition
                          保留已渲染 view 不重建（避免白屏/批注闪烁）
4. resize 后           → patchEpubReadingAnnotations（恢复划线样式）
                          relayoutListenMarkHighlight（听书 mark 重新对齐）
                          checkEpubListenFollowAfterLayout（自动跟随）
```

#### 3.1.5 lateStartCfiAppliedRef

- 当 `startCfi` 比 `initialCfiRef` 晚到（如书架进度接口返回延迟），用 `lateStartCfiAppliedRef` 防止**整书重载**。
- 仅在 `rendReady` 后调用 `rend.display(startCfi)` 做"补跳"。

### 3.2 关键函数

#### `resolveEpubPercent(book, loc, locationsReady)`（行 105–137）

进度百分比解析策略：

1. `locations.generate` 完成后且 `start.percentage` 有效 → 直接用。
2. 否则 `book.locations.percentageFromCfi(cfi)`。
3. 都没有则回退到 `start.index / spine.length`。

---

## 4. 阅读设置与外观（主题/字号/行距/背景/排版）

### 4.1 文件：[epubReaderSettings.ts](file:///Users/dnhyxc/Documents/code/dnhyxc-ai/apps/frontend/src/views/ebook/utils/epub/reader/epubReaderSettings.ts)

#### 4.1.1 类型与选项

```ts
type EpubReaderBgTheme =
	| "default"
	| "paper"
	| "cream"
	| "sepia"
	| "warm"
	| "green"
	| "blue"
	| "gray"
	| "pink"
	| "lavender"
	| "night"
	| "moon";
type EpubReaderTextColor =
	| "auto"
	| "dark"
	| "softDark"
	| "brown"
	| "sepia"
	| "gray"
	| "light"
	| "softLight"
	| "green"
	| "blue"
	| "rose"
	| "warmGray";
type EpubReaderPageFlow = "paginated" | "scrolled";

type EpubReaderSettings = {
	fontSize: number; // 80–160
	lineHeight: number; // 1.2–2.4
	textColor: EpubReaderTextColor;
	bgTheme: EpubReaderBgTheme;
	pageFlow: EpubReaderPageFlow;
};
```

#### 4.1.2 持久化

- Key：`dnhyxc_epub_reader_settings`。
- `loadEpubReaderSettings`：解析 → clamp 数值 → 校验枚举 → 兜底默认。
- `saveEpubReaderSettings`：JSON.stringify 写入 localStorage。

#### 4.1.3 主题色解析

- `resolveEpubBgColor(bgTheme)`：`default` 返 `'transparent'`；其余查 `EPUB_BG_THEME_OPTIONS`。
- `resolveEpubTextColor(textColor, appTheme)`：`auto` 跟随应用主题（黑底白字 / 白底深字）；其余查 `TEXT_COLOR_MAP`。
- `resolveEpubReaderSurfaceBackground(bgTheme)`：阅读页 chrome 共用表面背景（`default` 跟随应用主题 CSS 变量）。

#### 4.1.4 应用到 epub.js（`applyEpubReaderAppearance`）

```ts
rend.themes.default({
  html: { background: `${bgColor} !important` },
  body: { color, background, 'line-height', 'font-size' },
  'p, span, div, li, td, th, h1, h2, h3, h4, h5, h6, em, strong, i, b, a': { ... },
  blockquote: { /* Kindle 风格圆角 + 灰底 */ },
  '.kindle-cn-frame-*': { /* 兼容 Kindle 标注 */ },
});
```

> `!important` 强覆盖，保证作者 CSS 不会盖住阅读设置。

#### 4.1.5 阅读页 chrome 类名（Tailwind）

- `epubReaderSurfaceBgClass` / `epubReaderSurfaceMutedClass` / `epubReaderSurfaceSelectedClass` / `epubReaderSurfaceHoverClass` / `epubReaderSurfaceFadeFromClass` / `epubReaderSurfaceOverlayClass`。
- `epubReaderChromeBorderColorClass` / `epubReaderChromePrimaryButtonClass` / `epubReaderChromeOutlineButtonClass`。
- `epubReaderPopBarSurfaceClass` / `epubReaderPopBarShadowClass`（毛玻璃 + 主题/夜间不同 shadow）。
- `EPUB_READER_POPBAR_CARET_FILL`（PopBar 箭头 fill 与面板 surface 同色）。

> 这套类名通过 `bg-[var(--epub-reader-surface-bg,...)]` 引用 CSS 变量；`getEpubReaderChromeCssVars` 把变量挂到根节点上，使得 Portal 下拉/抽屉不在阅读壳子 DOM 内也能继承。

### 4.2 排版模式切换（pageFlow）

- `paginated`：左右翻页，`paginated` + `manager: 'default'`。
- `scrolled`：连续滚动，`scrolled` + `manager: 'continuous'`，触发 `attachEpubScrolledEdgeNav`（详见 §6）。
- 切排版：`readerSettingsRef.current.pageFlow` 改变 → 触发 `EpubPane` 的主 useEffect 重启 → 销毁旧 rend → 重建。

---

## 5. 目录与导航

### 5.1 EPUB 目录加载

`EpubPane` 主 useEffect 步骤 12：

```ts
const nav = await book.loaded.navigation;
const toc: EbookTocItem[] = (nav.toc ?? []).map((t) => ({
	label: t.label?.trim() || t.href,
	href: t.href,
	spineIndex: t.href ? resolveSpineIndexForHref(book, t.href) : undefined,
}));
onTocRef.current?.(toc);
```

#### `resolveSpineIndexForHref(book, href)`

1. `normalizeHrefPath`（去 `#`、去前导 `/`、decodeURIComponent）。
2. 精确匹配 `book.spine.spineItems`。
3. 找不到则用 `endsWith` / `includes` 模糊匹配。

> 兜底策略：处理 EPUB 内部 `OEBPS/chapter1.xhtml` vs nav 写 `chapter1.xhtml` 的差异。

### 5.2 目录高亮（[tocActiveIndex.ts](file:///Users/dnhyxc/Documents/code/dnhyxc-ai/apps/frontend/src/views/ebook/utils/common/tocActiveIndex.ts)）

```ts
findActiveTocItemIndex(items, { epubSpineIndex, pdfPage });
```

- PDF：用 `parsePdfPageHref` 提取页码。
- EPUB：找最后一个 `spineIndex <= current` 的目录项。
- 无匹配返 -1。

### 5.3 目录跳转

- 分页：`rend.display(href)`。
- 连续滚动：`displayEpubScrolledHref(rend, book, href)` → 多帧 settle。

### 5.4 PDF 大纲（[pdfOutline.ts](file:///Users/dnhyxc/Documents/code/dnhyxc-ai/apps/frontend/src/views/ebook/utils/pdf/pdfOutline.ts)）

- `loadPdfOutlineToc(doc)` → `doc.getOutline()` → 递归 `flattenOutline` → 每条 `resolveDestPageIndex`：
  - dest 是 ref 对象 → `doc.getPageIndex(ref)`。
  - dest 是 string → `doc.getDestination(name)` 或 `doc.getDestinations()[name]` → 拿 `resolved[0]`（ref）→ `pageIndexFromRef`。
- 统一产出 `EbookTocItem`：`{ label, depth, href: pdfPageHref(pageIndex) }`。
- `pdfPageHref(i)` = `'pdf-page:' + i`，`parsePdfPageHref` 反解。

---

## 6. 分页 vs 连续滚动

### 6.1 文件：[epubScrolledNav.ts](file:///Users/dnhyxc/Documents/code/dnhyxc-ai/apps/frontend/src/views/ebook/utils/epub/reader/epubScrolledNav.ts)

#### 6.1.1 关键私有 API

| 符号                                             | 作用                                                      |
| ------------------------------------------------ | --------------------------------------------------------- |
| `getEpubScrollContainer(rend)`                   | 类型断言拿 `(rend as any).manager?.container`             |
| `findViewElForSpineIndex(rend, idx)`             | 通过 `manager.views.all()` 找 `.epub-view` 元素           |
| `resolveViewElAfterDisplay`                      | 先按 spine idx，再按 currentLocation，再按 #anchor 找视图 |
| `scrolledChapterScrollTop(offsetTop)`            | 目标章顶对齐（减 `SCROLL_EDGE_PX=16`）                    |
| `scrolledNavAlignDelta(targetTop, containerTop)` | 容器内的相对偏移                                          |
| `resolveNavAnchor(viewEl, href)`                 | `#id` → `getElementById` / `a[name=…]` / `[id=…]`         |
| `NAV_ALIGN_SETTLE_MS = [0, 100, 220]`            | 多帧 settle 校正                                          |
| `settleScrolledNavAlign(rend, book, href)`       | 3 轮校正 + 中间 `manager.trim()`                          |
| `displayEpubScrolledHref(rend, book, href)`      | `rend.display` + 多帧 settle                              |

#### 6.1.2 边缘翻章（`attachEpubScrolledEdgeNav`）

```
1. wheel 事件（passive:false）→ dy 检查
2. atTop/atBottom（scrollTop 与 SCROLL_EDGE_PX 比较）
3. busy 防再入；cooldownUntil = now + 320ms
4. 优先 manager.check()（epub.js continuous 自带）
5. 回退 rend.next()/rend.prev()
6. 返回清理函数（removeEventListener）
```

#### 6.1.3 视口定位

| 符号                                                     | 作用                                                       |
| -------------------------------------------------------- | ---------------------------------------------------------- |
| `isEpubRangeInReaderView(rend, range, marginPx=72)`      | Range 顶/底在容器内 ±72px 内                               |
| `scrollEpubDomRangeIntoView(rend, range)`                | 改 `container.scrollTop` 让 range 进入视口                 |
| `scrollEpubDomRangeToCenter(rend, range)`                | 滚到视口中央                                               |
| `scrollEpubRangeToViewCenter(rend, range, fallbackCfi?)` | 连续滚动居中；分页回退 `rend.display`                      |
| `scrollEpubRangeIntoView(rend, range, fallbackCfi?)`     | 已在视口 return true；否则滚动 / 翻页                      |
| `scrollEpubCfiIntoView(rend, cfiRange)`                  | CFI → Range → 滚入视口                                     |
| `readRangeViewportBounds(range, iframe)`                 | `range.getBoundingClientRect` + iframe offset 转主页面坐标 |

#### 6.1.4 关键跨 iframe 坐标换算

```ts
const win = range.startContainer.ownerDocument?.defaultView;
const iframe = win?.frameElement as HTMLIFrameElement | null;
const iframeRect = iframe.getBoundingClientRect();
return { top: iframeRect.top + rect.top, bottom: iframeRect.top + rect.bottom };
```

### 6.2 滚动条美化（[readerScrollbar.ts](file:///Users/dnhyxc/Documents/code/dnhyxc-ai/apps/frontend/src/views/ebook/utils/common/readerScrollbar.ts)）

- `READER_NATIVE_SCROLLBAR`：外层（主页面级）滚动条 Tailwind 类名。
- `READER_NATIVE_SCROLLBAR_EPUB_CONTAINER`：epub.js 连续滚动时，**滚动条在 `.epub-container` 上**，需要用 `[&_.epub-container]:[scrollbar-width:thin]` 等任意子选择器。

### 6.3 PDF 连续滚动（[pdfScrolledNav.ts](file:///Users/dnhyxc/Documents/code/dnhyxc-ai/apps/frontend/src/views/ebook/utils/pdf/pdfScrolledNav.ts)）

- `SCROLL_EDGE_PX = 2`（贴边才视为到顶/底）。
- `MIN_WHEEL_DELTA = 28`（过滤触控板微抖）。
- `SCROLL_STABLE_MS = 220`（停稳时间）。
- `EDGE_COOLDOWN_MS = 600`（连跳冷却）。

> 与 EPUB 的区别：PDF 必须**先停稳再滚一下**才翻页，避免猛滚惯性连跳；EPUB 是 320ms 冷却。

---

## 7. 选区监听与 PopBar

### 7.1 文件：[epubSelectionToolbarAttach.ts](file:///Users/dnhyxc/Documents/code/dnhyxc-ai/apps/frontend/src/views/ebook/utils/epub/reader/epubSelectionToolbarAttach.ts)

#### 7.1.1 状态机

```
mousedown/touchstart  → onPointerDown
   ├── button===2  → contextMenuGesture=true; suppressEmitUntil=now+600
   ├── selecting=true
   └── hidePopBar()   （被 suppressDismiss 抑制时不关）

mouseup/touchend      → onPointerUp
   ├── selecting=false
   ├── 处于 contextMenuGesture → 跳过
   └── emitSelection()

selectionchange       → onSelectionChange
   ├── 已无选区 → hidePopBar()（selecting/抑制时跳过）
   ├── selecting → 跳过
   └── 200ms 防抖 → emitSelection()

contextmenu           → onContextMenu
   ├── contextMenuGesture=false
   ├── suppressEmitUntil=now+600
   └── forceHidePopBar()  （不受 suppressDismiss 影响）

relocated             → 350ms 抑制 emit
rendered              → 绑定新 epub 容器 scroll listener
scroll (iframe/主/全局) → suppressEmitUntil=now+350 + hidePopBar
```

#### 7.1.2 抑制机制

| 抑制类型               | 时间                          | 谁设的                         | 干什么                   |
| ---------------------- | ----------------------------- | ------------------------------ | ------------------------ |
| `suppressDismissUntil` | 450ms                         | 划线/想法 mark 弹 PopBar 时    | 短时间内不自动关 PopBar  |
| `suppressEmitUntil`    | 350ms (scroll) / 600ms (右键) | scroll 监听 / 右键 / relocated | 不 emit 新的选区 payload |
| `contextMenuGesture`   | 跟随 mousedown→contextmenu    | 拦截右键"自动选词"             | mouseup 时直接跳过 emit  |

#### 7.1.3 跨 iframe 锚点（`rangeToViewportAnchor`）

```
1. normalizeSelectionRangeForEpub(range) → 去前后空白
2. getAccurateRangeLineClientRects(normalized) → 精准行 rect
3. 1 个 rect → 取矩形中心 (x, y)
4. >1 个 rect → 取 focus 行顶（多行时 focus 端用）
5. 0 个 rect → 退到 caret / startRect / endRect / boundingRect
6. 加 iframe offset 转主页面坐标
```

#### 7.1.4 payload 结构

```ts
type EpubSelectionPopBarPayload = {
	x: number; // 水平中心
	y: number; // 顶
	selectedText: string; // 纯文本
	quoteSegments?: QuoteShareRun[]; // 富文本片段（用于分享卡片）
	cfiRange?: string; // CFI range
};
```

#### 7.1.5 `buildEpubPopBarPayloadFromCfiRange`

点击划线/想法 mark 时用：

1. `resolveCfiDomRange(rend, cfi)` → 拿到 Range。
2. `rangeToViewportAnchor(win, range)` → 锚点。
3. 失败兜底：`x: innerWidth/2, y: min(innerHeight*0.35, 240)`。

#### 7.1.6 记忆选区（`rememberEpubPopBarSelectionRange`）

- 划线/想法后 `mark` 显示时，往往**真实选区已消失**；记忆上一次"主动选区"，便于 `resolveEpubListenPlain` 在引用听读时拿回原文。
- 由 [epubListenSegmentOverlay.ts](file:///Users/dnhyxc/Documents/code/dnhyxc-ai/apps/frontend/src/views/ebook/utils/epub/listen/epubListenSegmentOverlay.ts) 导出。

#### 7.1.7 全局 PopBar 抑制

- `clearEpubTextSelection(rend)`：rend.getContents() 的所有 iframe + 顶层 `window.getSelection().removeAllRanges()`。
- `suppressEpubSelectionPopBarDismiss(ms=450)`：由 `upsertSelectionHighlight` / `onUserHighlightPopBar` / `openHighlightPopBarAtBookContent` 调。

### 7.2 选区归一化（[epubRangeGeometry.ts](file:///Users/dnhyxc/Documents/code/dnhyxc-ai/apps/frontend/src/views/ebook/utils/epub/mark/epubRangeGeometry.ts)）

| 符号                              | 作用                                                  |
| --------------------------------- | ----------------------------------------------------- |
| `trimSelectionRange`              | 收拢到第一个非空白字符                                |
| `snapSelectionRangeToTextContent` | 收拢到首尾非空白文本节点                              |
| `normalizeSelectionRangeForEpub`  | snap → trim，全空白返 null                            |
| `getAccurateRangeLineClientRects` | 文本节点片段 rect 收集 → 过滤包含关系 → 屏蔽大块 rect |
| `collectRangeTextClientRects`     | 按 text node 段分别 createRange → getClientRects      |
| `preferLeafLineClientRects`       | 若某 rect 包含另一 rect，丢弃外层（避免大块误标）     |

### 7.3 CFI/Range 互换

| 符号                                         | 作用                                                                               |
| -------------------------------------------- | ---------------------------------------------------------------------------------- |
| `cfiFromDomRange(rend, range)`               | 找 range 所属 contents → `contents.cfiFromRange`                                   |
| `resolveSelectionCfiRange(rend, win, range)` | 先按 window 筛选 contents，回退全遍历；用 `EPUB_ANNOTATION_IGNORE_CLASS` 忽略 mark |
| `resolveCfiDomRange(rend, cfi)`              | 先 `rend.getRange`，回退各 `contents.range`；sync 期间有 `syncCfiRangeCache` 缓存  |
| `getRenditionContentsList(rend)`             | 归一 `rend.getContents()` 为数组                                                   |
| `forEachTextNodeInRange(range, cb)`          | TreeWalker 遍历 range 内文本节点                                                   |

---

## 8. 右键菜单

### 8.1 文件：[epubContextMenuAttach.ts](file:///Users/dnhyxc/Documents/code/dnhyxc-ai/apps/frontend/src/views/ebook/utils/epub/reader/epubContextMenuAttach.ts)

#### 8.1.1 区分"主动选区"vs"自动选词"

```
mousedown (button===2):
   - hadSelectionBeforeRightClick = Boolean(sel.toString())

contextmenu:
   - browserAutoSelected = !hadSelectionBeforeRightClick
   - 若自动选词 → clearWindowSelection(win)
   - 上报 payload: { clientX, clientY, selectedText='', cfiRange?, copySelection }
   - copySelection(): copyToClipboard(text)
```

> 关键：`hadSelectionBeforeRightClick` 必须用 **mousedown** 时检测，contextmenu 时 selection 已经被浏览器自动改写。

#### 8.1.2 payload 结构

```ts
type EpubReaderContextMenuPayload = {
	clientX: number; // 主页面坐标（iframe 偏移 + e.clientX）
	clientY: number;
	selectedText: string; // 空字符串表示无选区
	cfiRange?: string;
	copySelection: () => void;
};
```

### 8.2 文件：[buildEpubContextMenuItems.ts](file:///Users/dnhyxc/Documents/code/dnhyxc-ai/apps/frontend/src/views/ebook/utils/epub/reader/buildEpubContextMenuItems.ts)

#### 8.2.1 菜单结构

| 条件     | 项                                   |
| -------- | ------------------------------------ |
| 有选区   | 复制 / 问书 / 划线 (添加想法) / 分隔 |
| 无选区   | 智能助手 / 分隔                      |
| 分页模式 | 上一页 / 下一页 / 分隔               |
| 总是     | 目录 / 分隔 / 设置 / 分隔 / 返回书架 |

> `actionsRef` 模式：菜单项只持有 `id`，点击时调用 `actionsRef.current?.xxx()`，避免闭包过期。

---

## 9. 用户划线（高亮/下划线/波浪线）

### 9.1 文件：[epubUserHighlights.ts](file:///Users/dnhyxc/Documents/code/dnhyxc-ai/apps/frontend/src/views/ebook/utils/epub/mark/epubUserHighlights.ts)

#### 9.1.1 类型与配色

```ts
type EpubHighlightStyle = "highlight" | "underline" | "wavy";
type EpubHighlightPresetColorId =
	| "pink"
	| "purple"
	| "blue"
	| "green"
	| "yellow";
type EpubHighlightColorId = EpubHighlightPresetColorId | `#${string}`; // 自定义 hex

EPUB_HIGHLIGHT_COLOR_OPTIONS = [
	{ id: "pink", fill: "rgba(255,107,129,0.28)", stroke: "#ff6b81" },
	{ id: "purple", fill: "rgba(155,89,182,0.28)", stroke: "#9b59b6" },
	{ id: "blue", fill: "rgba(120,191,255,0.28)", stroke: "#78bfff" },
	{ id: "green", fill: "rgba(150,194,78,0.28)", stroke: "#96c24e" },
	{ id: "yellow", fill: "rgba(255,220,106,0.28)", stroke: "#ffdc6a" },
];
```

自定义色支持 `#rrggbb` 或 `#rrggbbaa`；`loadEpubHighlightCustomColor` 持久化。

#### 9.1.2 SVG 渲染（`rend.annotations.highlight`）

```ts
rend.annotations.highlight(
	cfiRange,
	data, // { thoughtIds, hlStyle, hlColor, epubcfi, ... }
	clickHandler, // 点 mark 时回调
	className, // 'moke-epub-user-hl'
	styles, // { fill, stroke, ... } 写到 marks-pane SVG
);
```

epub.js 内部在 `.marks-pane > svg` 下创建 `<g class="moke-epub-user-hl" epubcfi="...">`，子元素 `<rect>` 列表（每行一个）。

#### 9.1.3 波浪线路径（`buildWavyUnderlinePath`）

```
起点 M startX baseY
按 WAVY_SAMPLE_STEP_PX=2 步长采样
y = baseY + WAVY_AMPLITUDE_PX(1.2) * sin(2π*offset / WAVY_WAVELENGTH_PX(16))
最后不满步长补一段
```

> 16px ≈ 一个字宽，1.2px 振幅不易抖动。

#### 9.1.4 合并 / 裁剪 / 排序（`coalesceOverlappingHighlightsForRender`）

- 同 CFI：保留一个（按 style/color 优先级）。
- 严格包含：保留外层。
- 重叠/相邻：按 quote 字符级合并（`mergeDomRangeUnion` + `doClientRectsOverlapForMerge` + `doDomRangesOverlapForSelection`）。
- 排序：`sortHighlightsForStack`（短 quote 排上面，便于点击）。

#### 9.1.5 渲染计划（`buildHighlightRenderPlan`）

```
coalesceOverlappingHighlightsForRender(rend, highlights)
   ↓
visibleCfis = computeVisibleHighlightCfis (CFI 在当前已加载 spine 内)
   ↓
sortedHighlights = sortHighlightsForStack
   ↓
keepCfis = sorted ∩ visible
```

#### 9.1.6 应用 / 卸载（`applyEpubUserHighlights`）

```
1. ensureUserHighlightStyles (注入 SVG 样式)
2. purgeStaleUserHighlightAnnotations (卸载不再可见的 mark)
3. highlightMetaByCfi = new Map(visibleSortedHighlights)
4. 遍历 sortedHighlights：
   - 若 visibleCfis.has(cfi) 且 sig 未变 + mark 存在 → 跳过
   - 否则 remove + highlight 重画
5. signature 缓存 (appliedRef)
```

#### 9.1.7 点击监听（`installEpubReadingMarkClickListeners`）

- `rend.hooks.content.register(bindContents)`：每加载一个 iframe 都注册 click。
- 通过 `rememberReaderClickPoint` + `isHighlightHitAtClickPoint` 判定 click 是否落在划线文本带内。
- `isHighlightHitAtRecentClick` + 划线/想法 cluster 构造 → 透传 `onThoughtClusterClick` / `onUserHighlightPopBar`。

#### 9.1.8 滚动/翻页 patch（`installEpubUserHighlightPatchListeners`）

| 事件                   | 行为                                                                       |
| ---------------------- | -------------------------------------------------------------------------- |
| `rend.hooks.content`   | `schedulePatch(true)` defer                                                |
| `rend.on('relocated')` | 120ms idle → `refreshThoughtUnderlinesInViewport` + `schedulePatch(false)` |
| scroll 容器 scroll     | 100ms idle → viewport refresh + `schedulePatch(true)`                      |
| `rend.on('rendered')`  | `schedulePatch(true)`                                                      |
| 初始化                 | `schedulePatch(true)`                                                      |

`patchEpubReadingAnnotations` 用 rAF 防抖 + 二次 rAF（pending 模式）保证：只 patch 样式不 remove+readd，避免闪烁。

#### 9.1.9 SVG 重叠（`restackUserHighlightMarkGroups`）

- 用户划线置于想法 mark **之上**：把所有 `.marks-pane` 下的 `g.moke-epub-user-hl` 全部 `appendChild` 到 pane 末尾（DOM 顺序后画的盖在上面）。
- 想法那边有 `setUserHighlightBlockerSourcesForThoughtPatch` 提供"用户划线占据的 rect 集合"，让想法 patch 时**扣减**被覆盖区域（`collectUserHighlightBlockerSources` 同时收集 `<rect>` 和 `<path class="moke-epub-user-hl-wave">` 的 bbox）。

### 9.2 高亮 upsert 流程（read.tsx 行为）

#### 9.2.1 `upsertHighlightForQuote(cfiRange, quote, style, color)`

```
1. resolveCfiDomRange → normalize → 重新计算 cfi/quote
2. resolveMergedOverlappingHighlight → 找到所有重叠/相接划线
3. findHighlightsStrictlyContainedIn → 找到被完全包含的划线
4. buildMergedHighlightTarget (如 removeIds 非空) → 重新归一化 cfi/quote
5. removeIds 为空：
     - 已有 exact → updateEbookHighlight
     - 没有 → createEbookHighlight
6. removeIds 非空：
     - Promise.all deleteEbookHighlight(removeIds)
     - createEbookHighlight
7. setHighlights(next) 触发 react 重渲染
```

#### 9.2.2 `highlightUpsertQueueRef`

- 用 Promise chain 串行化所有 upsert 请求，避免并发写导致 cfi/quote 不一致。

#### 9.2.3 `removeHighlightsForQuote`

- `ensureQuoteCfiInViewport(cfi)`：若当前 spine 未加载则 `rend.display(cfi)` → `scrollEpubCfiIntoView`。
- `findAllUserHighlightsCoveringCfi`（按 CFI/quote/DOM 重叠）→ `Promise.all deleteEbookHighlight` → `setHighlights`。

#### 9.2.4 选区高亮覆盖率

- `isSelectionFullyHighlighted` / `resolveSelectionHighlightCoverage`：判断当前选区是否被完全覆盖（用于高亮颜色按钮禁用/启用）。

---

## 10. 想法下划线（公开/私有笔记）

### 10.1 文件：[epubThoughtAnnotations.ts](file:///Users/dnhyxc/Documents/code/dnhyxc-ai/apps/frontend/src/views/ebook/utils/epub/mark/epubThoughtAnnotations.ts)

#### 10.1.1 渲染：与用户划线复用 epub.js `underline`

```ts
rend.annotations.underline(
	cfiRange,
	{
		thoughtIds,
		[THOUGHT_MARK_DATA_SHOW_LINE]: "1",
		[THOUGHT_MARK_DATA_LINE_OWN]: "1",
	},
	undefined,
	EPUB_THOUGHT_UNDERLINE_CLASS,
	{
		...EPUB_THOUGHT_UNDERLINE_STYLES,
		stroke: resolveThoughtLineColor(group, currentUserId),
	},
);
```

- `lineOwn=true` 表示本人写的 → 用本人色；否则用"他人"色。
- `resolveThoughtLineColor(group, currentUserId)`：本人 vs 公开他人 vs 私有他人三档色。

#### 10.1.2 视口模式（`shouldUseViewportThoughtApply`）

- 想法数 > 一定阈值 → 视口模式：进入视口才挂 mark，离开视口回收。
- 否则：全量 apply。

#### 10.1.3 pin 机制

- `ephemeralPinCfis(cfis)`：临时 pin（一次 apply 后清空），用于"刚收到同步想立即显示"或"刚点开列表想保留"。
- `options.pinCfis`：来自 `setThoughtUnderlineApplyContext` 的长期 pin（侧栏 anchor / 创建想法时）。
- `shouldKeepCfiApplied(cfi)`：pin 或 视口内 → 保留；否则回收。

#### 10.1.4 嵌套合并（`sortCfiGroupsForUnderlineStack`）

- 按 quote 长度降序 + CFI 长度升序排 → 短 quote 在上面，便于点击。
- 严格包含关系：内层完全被外层包裹时优先只绘外层（`isCfiRangeStrictlyContained`：DOM Range 嵌套 → 回退 quote 嵌套 + 同 spine）。

#### 10.1.5 Click Guard（`attachThoughtMarkClickGuard`）

- 拖选文字时 `mousedown` → `setThoughtMarkPointerEvents('none')`（关闭 SVG mark 的 pointer-events）。
- 顶层 `pointerup`/`touchend` → setTimeout 0 → 恢复 `auto`。
- 防止"选词时鼠标停在 mark 上"误触 mark click。

#### 10.1.6 Patch 调度（`patchEpubThoughtUnderlineMarks`）

- 视口模式时 `viewportOnly: true` → 只 patch 当前视口内的 mark。
- 调用 `restackThoughtMarkGroups`（想法的 mark `appendChild` 排在划线之下）。

#### 10.1.7 视口刷新（`refreshThoughtUnderlinesInViewport`）

- 滚动停稳后调用，重新计算 keep/remove band。
- 复用 `applyEpubThoughtUnderlines(rend, thoughts, appliedRef, currentUserId, { reclaimOffViewportMarks: true })`。

### 10.2 文件：[useEbookThoughtLoader.ts](file:///Users/dnhyxc/Documents/code/dnhyxc-ai/apps/frontend/src/views/ebook/hooks/useEbookThoughtLoader.ts)

#### 10.2.1 状态

- `thoughts: EbookThought[]`（合并所有已加载 spine 的想法）。
- `fetchedSpineHintsRef: Set<string>`（已请求过的 spine）。
- `inFlightRef: Map<string, Promise>`（正在请求的 spine；并发去重）。

#### 10.2.2 触发

```
useEffect(..., [bookId, bookFmt, epubNavReady, getRendition, ensureLoadedSpineThoughts]):
   - 拿到 rend
   - collectLoadedSpineHints(rend) → 遍历 hint → ensureSpineThoughtsLoaded(hint)
```

#### 10.2.3 `ensureSpineThoughtsLoaded(spineHint)`

```
1. 已 fetch → return
2. in-flight → return existing
3. fetchEbookThoughts(bookId, { spineHints: [hint] })
4. fetchedSpineHintsRef.add(hint)
5. mergeThoughts (按 id 去重)
6. catch → onLoadError
```

### 10.3 文件：[usePublicEbookThoughtSync.ts](file:///Users/dnhyxc/Documents/code/dnhyxc-ai/apps/frontend/src/views/ebook/hooks/usePublicEbookThoughtSync.ts)

#### 10.3.1 增量同步（since-based）

```
1. since = ebookThoughtSyncSinceParam(max(updatedAt(thoughts)))
2. fetchEbookThoughtSync(bookId, since) → { changes, removed }
3. applyEbookThoughtSync(local, sync) → { next }
4. 若变化：ephemeralPinThoughtCfis(changes.map(cfi))  → 立即显示
5. setThoughts(next) + onMerged()
```

#### 10.3.2 触发条件

| 场景                             | 行为                                               |
| -------------------------------- | -------------------------------------------------- |
| `relocated` 停稳 2000ms          | `scheduleSync` 调度                                |
| `visibilitychange === 'visible'` | `lastSyncAtRef = 0` + `syncThoughts()`（重置节流） |
| 间隔 < 5s                        | 跳过（非 force 模式）                              |
| `force: true`（打开列表）        | 跳过节流                                           |

### 10.4 文件：[epubThoughtCluster.ts](file:///Users/dnhyxc/Documents/code/dnhyxc-ai/apps/frontend/src/views/ebook/utils/epub/mark/epubThoughtCluster.ts)

#### 10.4.1 核心算法

- `groupThoughtsByCfi`：按 `cfiRange` 分组。
- `thoughtGroupSpanLength`：返回 quote 长度或 CFI 长度（决定"主 CFI"）。
- `sortThoughtsByCreatedAtDesc`：组内按时间倒序。
- `buildQuoteGroup`：构造 `EbookThoughtQuoteGroup { cfiRange, quote, thoughts, spanLength }`。
- `sortQuoteGroupsByNewestThoughtDesc`：组间按"组内最新想法时间"倒序。
- `isNestedEitherWay`：判断两个 CFI 是否相互嵌套（DOM/quote/spine）。
- `CONNECTIVITY_GRAPH_VERSION = 'v5'`：连通闭包规则版本（缓存 key）。
- `normalizeGapText` / `buildGapRangeBetween` / `isRangeStrictlyBetween`：判断两个 CFI 之间是否存在"被高亮覆盖的间隙"（用于连通图）。

#### 10.4.2 连通闭包（`collectConnectedClosureAroundCfis`）

> 用于侧栏/列表点击时，找出与目标 CFI 间接相关的所有 CFI（"相邻 quote 都被划线 → 视为同一簇"）。

```
1. BFS 起点 = 种子 CFI
2. 邻接规则：cand 与 cur 的 gap range 被任一 highlight 覆盖 → 相邻
3. 缓存以 chapter 为粒度，避免重复构建
4. pickPrimaryCfiFromQuoteGroups：选 quote 长度最长的为主展示
```

### 10.5 想法详情弹窗（read.tsx）

- `openViewThought(thought, fromList)`：
  - 关闭助手侧栏。
  - 若 fromList → 保存当前 cluster snapshot 到 `returnToListClusterRef`，关闭列表。
  - 设置 `thoughtDraft` 为该想法 → `setThoughtDialogMode('view')` → 打开 `thoughtDialogOpen=true`。
- `restoreThoughtListFromSnapshot`：弹窗关闭时尝试恢复列表。
- `openCreateThought(quote, cfiRange)`：新建想法，保存当前 cluster snapshot。

---

## 11. 听书

### 11.1 文件：[useEpubChapterListen.ts](file:///Users/dnhyxc/Documents/code/dnhyxc-ai/apps/frontend/src/views/ebook/hooks/useEpubChapterListen.ts)

#### 11.1.1 状态

```ts
type ChapterListenState = {
	status: "idle" | "loading" | "playing" | "paused";
	spineIndex: number;
	sentenceIndex: number;
	sentenceCount: number;
	sentenceLabels: string[]; // 每句纯文本
	rate: number;
};

const IDLE_STATE = {
	status: "idle",
	spineIndex: -1,
	sentenceIndex: 0,
	sentenceCount: 0,
	sentenceLabels: [],
	rate: 1,
};
```

`loopGenRef`、`pausedRef`、`rateRef`、`sentenceCursorRef`、`sectionRef`、`sectionDocRef`、`resolveStartCfiRef`、`scrollSeekRef` 都在 ref 上。

#### 11.1.2 互斥

```ts
useEffect(() => {
	warmupSpeechVoices();
	registerChapterListenStop(() => stopInternal());
	return () => {
		registerChapterListenStop(null);
		stopInternal({ notify: false });
	};
}, []);
```

> `registerChapterListenStop` 是跨 hook 互斥通道：`useEbookQuoteListen` 在 `startPlayback` 时 `invokeStopChapterListen()`。

#### 11.1.3 `startFromCurrentPosition`

```
1. primePlaybackForUserGesture
2. isPlaybackAvailable check
3. rend 校验
4. invokeStopQuoteListen / stopAllPlayback / clearEpubListenSegmentOverlay
5. beginChapterListenAutoFollow(rend)
6. extractVisibleListenSection(rend, spineHint) → 拿到 plain/outerRange/spineIndex
7. gen = ++loopGenRef; pausedRef=false; rateRef=1; cursor=0
8. sectionDocRef = preview.outerRange.startContainer.ownerDocument
9. syncState({ status:'loading', spineIndex, sentenceIndex:0, sentenceLabels, rate:1 })
10. void runListenLoop(gen)
```

#### 11.1.4 `runListenLoop` → `runScrollSectionLoop`（连续滚动）

```
for(;;):
   ctx = prepareSection (resolveStartCfi 首次 or 已 prepare 跳过)
   if !ctx: Toast emptySection; stopInternal
   scrollCenter = scrollSeekRef || sentenceCursor===0
   scrollSeekRef = false
   finished = await playSentencesFromCursor(ctx, gen, { scrollCenterOnFirst })
   if !finished: ... (中断/暂停/错误)
   sentenceCursor = 0; resolveStartCfi = false
   syncState({ status:'loading' })
   nextDoc = await advanceScrollListenSection(rend, sectionDoc)
   if !nextDoc: Toast finished; stopInternal
   sectionDoc = nextDoc; sectionDocRef = nextDoc
```

#### 11.1.5 `runPaginatedListenLoop`（分页）

```
for(;;):
   ctx = prepareSection
   if !ctx: Toast empty; stop
   finished = await playSentencesFromCursor(ctx, gen)
   if !finished: ...
   sentenceCursor=0; resolveStartCfi=false
   advanced = await waitForNextSection(rend, () => isGenActive)
   if !advanced: Toast finished; stop
```

#### 11.1.6 `playSentencesFromCursor`

```
schedulePrefetch(startSi+1)   // 预取下一句云端 TTS
for si in [cursor, count):
   if !isGenActive || paused → return false
   spokenRaw = stripMarkdownForTts(plain[sent.start:sent.end])
   cursor = si
   syncState({ status:'playing', sentenceIndex:si })
   if rend && domRange: showChapterListenSentenceHighlight(rend, domRange, jumpScroll)
   schedulePrefetch(si+1)
   try playPreferred(spokenRaw, { rate, prefetchedCloud })
   catch: Toast unsupported (若 cloudTtsNotified=false)
   clearChapterListenSentenceHighlight(rend)
return isGenActive
```

#### 11.1.7 `pause` / `resume` / `stop` / `goToSentence` / `setRate`

- `pause`：pausedRef=true; loopGenRef++; stopAllPlayback; status='paused'。
- `resume`：pausedRef=false; gen=++loopGenRef; status='loading'; runListenLoop(gen, { continueSections: true })。
- `stop`：调 stopInternal。
- `goToSentence(i)`：cursor=clamp(i); scrollSeek=true; stopAllPlayback; runListenLoop（重置 section）。
- `setRate(rate)`：rateRef=rate; applyActivePlaybackRate(rate); syncState({ rate })。

#### 11.1.8 `syncToCurrentView`（视图同步）

> 用于笔记详情、侧栏引用跳转后，听书跟随当前 view 重启。

```
1. status === 'idle' → no-op
2. await waitForRelocated(rend) + 双 rAF
3. stopAllPlayback / teardownChapterListenHighlight / clearEpubListenSegmentOverlay
4. beginChapterListenAutoFollow
5. gen = ++loopGenRef
6. pausedRef = !resumePlay (原来 playing/loading → 继续；paused → 保留暂停)
7. extractVisibleListenSection → 重建 sentenceLabels
8. runListenLoop 或 paused + prepareSection
```

### 11.2 文件：[useEbookQuoteListen.ts](file:///Users/dnhyxc/Documents/code/dnhyxc-ai/apps/frontend/src/views/ebook/hooks/useEbookQuoteListen.ts)

#### 11.2.1 与章节听读的差异

| 维度    | 章节听读                                      | 引用听读                                             |
| ------- | --------------------------------------------- | ---------------------------------------------------- |
| 文本源  | 当前可见的 body                               | 选区 quote / 划线 quote / 侧栏引用                   |
| 互斥    | 抢断引用听读                                  | 抢断章节听读                                         |
| 高亮    | 句级 Range（DOM 实际段）                      | overlay session（plain）                             |
| 范围    | 全章 + 跨章                                   | 选区内                                               |
| 句切    | `indexChapterSentenceRanges`                  | `getEpubListenSessionMeta` 或 `buildLabelsFromPlain` |
| session | 无（`beginChapterListenAutoFollow` 简单注册） | `beginEpubListenOverlaySession`                      |

#### 11.2.2 `startPlayback(text, key, cfiRange, frozenRange)`

```
1. invokeStopChapterListen()    // 互斥
2. isPlaybackAvailable check
3. primePlaybackForUserGesture
4. stopAllPlayback / clearEpubListenSegmentOverlay
5. resolveEpubListenPlain(rend, text, frozenRange) → { plain, selectionRange, spokenRaw }
6. beginEpubListenOverlaySession(rend, plain, { cfi, selectionRange })
7. fallbackPlainRef = speakPlain
8. gen = ++loopGenRef; cursor=0; playingKeyRef=key
9. syncState({ status:'loading', sentenceLabels, rate })
10. playFromCursor(gen) → finished
11. finished && isGenActive → stopInternal
```

#### 11.2.3 `resolveEpubListenPlain(rend, fallbackText, frozenRange?)`

```ts
const selectionRange =
	frozenRange && isRangeConnected(frozenRange)
		? frozenRange.cloneRange()
		: (getRememberedEpubPopBarSelectionRange() ??
			(rend ? cloneActiveEpubSelection(rend) : null));

const spokenRaw = selectionRange?.toString().trim() || fallbackText.trim();
const plain = stripMarkdownForTts(spokenRaw);
return { plain, selectionRange, spokenRaw };
```

> 优先级：`frozenRange`（外部已冻结） > 记忆的 PopBar 选区 > 当前 rendition 选区 > fallback 文本。

### 11.3 文件：[epubListenChapter.ts](file:///Users/dnhyxc/Documents/code/dnhyxc-ai/apps/frontend/src/views/ebook/utils/epub/listen/epubListenChapter.ts)

#### 11.3.1 `extractVisibleListenSection(rend, spineHint?)`

```
1. pickDocumentForListen (按 spineHint 优先 / 视口中线)
2. doc.body.innerText → stripMarkdownForTts
3. 长度 > MAX_PLAIN_CHARS 时截断
4. outerRange = selectNodeContents(doc.body)
5. return { plain, outerRange, spineIndex }
```

#### 11.3.2 `indexChapterSentenceRanges(outerRange, plain)`

```
1. sentences = buildSentenceOffsetSpans(plain.trim())
2. body = bodyFromOuter(outerRange)
3. positions = listBodyTextPositions(body)  // 所有文本节点 × offset
4. { norm, map } = buildNormStream(positions) // 标准化空白/合并
5. for sent in sentences:
     needle = normForMatch(plain[sent.start:sent.end])
     idx = norm.indexOf(needle, cursor)
     if idx < 0 && len>=8: idx = norm.indexOf(head(needle, 24), cursor)
     range = rangeFromPosSpan(positions, startPi, endPi)
     cursor = idx + needle.length
6. return Range[] (含 null)
```

> 关键：`buildNormStream` 合并多余空白 → `normForMatch` 去 markdown/空白 → 顺序搜索保证不重不漏。

#### 11.3.3 `showChapterListenSentenceHighlight` / `clearChapterListenSentenceHighlight` / `teardownChapterListenHighlight`

- 全部委托 `showEpubListenDomRange` / `clearListenMarkHighlight`。

#### 11.3.4 `resolveListenStartSentence(rend, section, startCfi, sentenceRanges?)`

> 已知 CFI 找所属句。

```
1. at = resolveCfiDomRange(rend, cfi)
2. if at.document !== sectionDoc → return 0
3. from back: for i in [count-1, 0]:
     r = sentenceRanges[i]
     if r && r.compareBoundaryPoints(END_TO_START, at) <= 0 → return i
return 0
```

#### 11.3.5 `waitForRelocated` / `waitForNextSection`

- `waitForRelocated`：Promise + relocated 事件 + timeout 1000ms。
- `waitForNextSection`：`rend.next()` + 等 relocated 事件 + timeout 1000ms；`isActive()` 返回 false 时立即 resolve false。

### 11.4 文件：[epubListenSegmentOverlay.ts](file:///Users/dnhyxc/Documents/code/dnhyxc-ai/apps/frontend/src/views/ebook/utils/epub/listen/epubListenSegmentOverlay.ts)

#### 11.4.1 全局 session

```ts
let session: ListenSession | null = null;
let overlayEpoch = 0; // 单调递增版本
let detachScrollGuard: (() => void) | null = null;
let rememberedPopBarRange: Range | null = null;
let programmaticScroll = 0; // 防用户手势误判
let userScrolling = false;
let scrollSettleTimer = 0;
let pendingFollowScroll = false;
const followListeners = new Set<(state) => void>();
```

#### 11.4.2 `beginEpubListenOverlaySession(rend, plainText, opts)`

```
1. preserveAutoFollow = session?.autoFollow ?? true
2. clearEpubListenSegmentOverlay
3. outerRange = resolveListenSessionSelectionRange(rend, opts)
4. plain = plainText.trim()
5. sentences = buildDomSentenceIndex(outerRange).sentences
6. session = { rend, plain, cfi, outerRange, sentences, epoch, autoFollow, lastSentenceIndex:-1, activeDomRange:null }
7. detachScrollGuard = attachListenScrollGuard(rend)
8. emitAutoFollowState()
```

#### 11.4.3 自动跟随状态机

| 状态                               | 触发                  | 行为                           |
| ---------------------------------- | --------------------- | ------------------------------ |
| `pendingFollowScroll=true`         | 句切换 + autoFollow   | 双 rAF 后滚到中央              |
| `userScrolling=true`               | 用户滚轮/触摸         | 暂停 autoFollow，emit          |
| `pendingFollowScroll=false`        | 停稳 800ms / 用户切回 | 恢复                           |
| `FAB` 提示                         | autoFollow 被用户滚关 | 右下角"回到播放"按钮           |
| `checkEpubListenFollowAfterLayout` | 容器尺寸变化          | 不可见 → pauseListenAutoFollow |

#### 11.4.4 `showEpubListenDomRange(rend, range, opts?)`

```
1. isRangeConnected(range) check
2. snapped = normalizeSelectionRangeForEpub(range.cloneRange()) ?? range
3. active = ensureChapterDomListenSession(rend)
4. active.activeDomRange = snapped
5. active.lastSentenceIndex = -1
6. isNew = prev 不存在或与 prev 不等 → clearListenMarkHighlight
7. showListenMarkHighlight(rend, snapped)
8. opts.forceScroll: withProgrammaticScroll 滚到中央/最近
9. isNew && autoFollow: requestListenAutoFollowScroll()
```

#### 11.4.5 互斥注册

```ts
let stopQuoteListen: StopFn | null = null;
let stopChapterListen: StopFn | null = null;

export function registerQuoteListenStop(fn) {...}
export function registerChapterListenStop(fn) {...}
export function invokeStopQuoteListen() { stopQuoteListen?.(); }
export function invokeStopChapterListen() { stopChapterListen?.(); }
```

#### 11.4.6 `attachListenScrollGuard(rend)`

- 监听 rendition 主滚动容器 + 各 iframe scroll。
- `programmaticScroll` 标记：自己滚的（如 `forceScroll`）不触发"用户意图"。
- `userScrolling`：滚 800ms 没新事件 → 停稳；`pauseListenAutoFollow` 触发 `userScrolling=true` + 通知 followListeners → UI 展示 FAB。

### 11.5 文件：[epubScrollListenAdvance.ts](file:///Users/dnhyxc/Documents/code/dnhyxc-ai/apps/frontend/src/views/ebook/utils/epub/listen/epubScrollListenAdvance.ts)

#### 11.5.1 核心思想

**不调用 `rend.next()`**：在连续滚动模式下，逐 `.epub-view` slot 推进，找到下一已加载 doc 即用。

#### 11.5.2 关键函数

- `listEpubViewSlots(rend)`：遍历 `container.querySelectorAll('.epub-view')` → 拿 `iframe.contentDocument`（无正文视为 null）。
- `findSlotIndex(slots, currentDoc)`：先按引用匹配，再按 `docKey`（`<link rel="canonical">` / `location.href`）。
- `nextLoadedDoc`：在 slots 中找当前 doc 之后的第一个 loaded doc。
- `ensureSlotDocument(rend, slot)`：若 slot 缺 doc → 滚到该 slot → `manager.check()`（8 次，每次 80ms）→ 拿到 doc。
- `advanceScrollListenSection(rend, currentDoc)`：
  1. 列 slots。
  2. 找 `nextLoadedDoc` → 有即返。
  3. 否则 5 轮，每轮对所有 next slot 调 `ensureSlotDocument`；都失败后整屏下滚 200px + `manager.check()`。
  4. 仍失败 → return null → 听书结束。

### 11.6 文件：[epubListenMarkHighlight.ts](file:///Users/dnhyxc/Documents/code/dnhyxc-ai/apps/frontend/src/views/ebook/utils/epub/listen/epubListenMarkHighlight.ts)

- 听书 mark 用淡黄色 `<rect>` overlay。
- `showListenMarkHighlight(rend, range)` → `clearListenMarkHighlight(rend)` → `relayoutListenMarkHighlight(rend)`。

### 11.7 英文 TTS（[speech](../../../../utils/speech.ts) — 不在 ebook 目录）

| 符号                                   | 作用                                         |
| -------------------------------------- | -------------------------------------------- |
| `playPreferred(text, opts)`     | 优先云端 TTS，回退浏览器 SpeechSynthesis     |
| `prefetchCloudTts(text)`        | 预取云端音频 Promise                         |
| `applyActivePlaybackRate(rate)` | 实时改倍速（不打断当前句）                   |
| `primePlaybackForUserGesture`   | 首次用户手势解锁 TTS                         |
| `warmupSpeechVoices`               | 预加载 SpeechSynthesis voices                |
| `stopAllPlayback`               | 停浏览器 + 取消云端预取                      |
| `stripMarkdownForTts`                  | 去除 markdown 标记（`#`/`*`/`` ` ``/`<>`等） |
| `isPlaybackAvailable`           | 浏览器是否支持 SpeechSynthesis               |
| `buildSentenceOffsetSpans(plain)`      | 切句：句末 `?`/`!`/`.`/`。`/`!`/`?` + 换行   |

---

## 12. 划线/想法 Mark 共享底座

### 12.1 文件：[epubMarkShared.ts](file:///Users/dnhyxc/Documents/code/dnhyxc-ai/apps/frontend/src/views/ebook/utils/epub/mark/epubMarkShared.ts)

| 符号                                        | 作用                                                |
| ------------------------------------------- | --------------------------------------------------- |
| `getRenditionContentsList(rend)`            | 归一 `rend.getContents()` 为数组                    |
| `setSvgAttrIfChanged(el, name, value)`      | 只在属性变化时 setAttribute（patch 热路径）         |
| `extractCfiSpineHint(cfi)`                  | `epubcfi(X!/...)` 提取 `X`                          |
| `normalizeCfiSpineHint(hint)`               | 去 `[id]` 标签 + 补前导 `/`                         |
| `collectLoadedSpineHints(rend)`             | 遍历 contents → 拿到所有已加载 iframe 的 spine 路径 |
| `isQuoteStrictlyNested(inner, outer)`       | inner 是否为 outer 的严格子串                       |
| `isDomRangeStrictlyContained(inner, outer)` | DOM Range 严格包含（边界可等，整体不等）            |
| `isDomRangeOverlapping(a, b)`               | DOM Range 真实相交（不含仅端点相接）                |
| `isDomRangeTouchingOrOverlapping(a, b)`     | 相交或端点相接                                      |
| `findMarksPaneSvgInDocument(doc)`           | 找 `.marks-pane > svg`（听书层 ensure group 用）    |

### 12.2 文件：[epubRangeGeometry.ts](file:///Users/dnhyxc/Documents/code/dnhyxc-ai/apps/frontend/src/views/ebook/utils/epub/mark/epubRangeGeometry.ts) 补充

- `beginEpubAnnotationSyncScope` / `endEpubAnnotationSyncScope`：同步作用域；进入时启用 `syncCfiRangeCache` 缓存，结束时清空。
- `getAccurateRangeLineClientRectsCached(key, range)`：用 key 缓存 `getAccurateRangeLineClientRects`（按 CFI 或 thought 标识）。
- `parseSvgMarkRect(rect)`：从 `<rect>` 读 `x/y/width/height`（用于收集用户划线 blocker）。
- `clientRectToSvgLocalSegment` / `resolveHighlightSvgLineSegments` / `resolveDomRangeSvgLineSegments` / `readMarkSvgLineSegmentsFromRects`：DOM rect ↔ SVG 坐标。
- `EPUB_ANNOTATION_IGNORE_CLASS = 'moke-epub-ignore-cfi'`：CFI 转换时忽略带此 class 的节点。

---

## 13. 想法详情 / 公开笔记同步

### 13.1 文件：[epubThoughtSync.ts](file:///Users/dnhyxc/Documents/code/dnhyxc-ai/apps/frontend/src/views/ebook/utils/epub/mark/epubThoughtSync.ts)

- `isSharedEbookThoughtContext(book, publicSource?)`：`publicSource` 非空 → 公开/共享笔记。
- `ebookThoughtSyncSinceParam(updatedAt)`：把 `updatedAt` 转成 `since` 查询参数。
- `maxEbookThoughtUpdatedAt(thoughts)`：取最大 `updatedAt`。
- `applyEbookThoughtSync(local, sync)`：合并 `changes` + 处理 `removed` → 返 `next`。

### 13.2 想法侧栏 / 列表（read.tsx）

- `thoughtListOpen` / `thoughtListCluster`：当前打开的列表。
- `openViewThought(thought, fromList)`：详情弹窗。
- `reconcileThoughtClickCluster`：list cluster 与最新 thoughts 调和（按连通闭包）。
- `returnToListClusterRef`：详情关闭时恢复列表。

### 13.3 AI 助手（read.tsx）

- `assistantOpen`：侧栏开关。
- `askAboutSelection(cfiRange, text)`：把选区 quote 推到助手上下文。
- `openAssistant()`：无选区时打开助手。

---

## 14. PDF 姊妹实现

> PDF 是 EPUB 的轻量替代，使用 pdf.js + 自绘滚动容器。

### 14.1 初始化（[pdfSetup.ts](file:///Users/dnhyxc/Documents/code/dnhyxc-ai/apps/frontend/src/views/ebook/utils/pdf/pdfSetup.ts)）

```ts
import * as pdfjs from "pdfjs-dist";
import pdfWorker from "pdfjs-dist/build/pdf.worker.min.mjs?url";
pdfjs.GlobalWorkerOptions.workerSrc = pdfWorker;

export const PDFJS_WASM_URL = pdfAssetUrl("pdfjs-wasm"); // 站点根 + 'pdfjs-wasm/'
export const PDFJS_CMAP_URL = pdfAssetUrl("pdfjs-cmaps");
export function pdfLoadOptions(data) {
	return { data, wasmUrl, cMapUrl, cMapPacked: true };
}
```

### 14.2 缩放（[pdfReaderSettings.ts](file:///Users/dnhyxc/Documents/code/dnhyxc-ai/apps/frontend/src/views/ebook/utils/pdf/pdfReaderSettings.ts)）

- `clampPdfZoom`：夹到 0.5–3。
- `stepPdfZoom(current, delta)`：四舍五入到 0.1 精度再夹。
- `loadPdfZoom` / `savePdfZoom`：localStorage 持久化。

### 14.3 连续滚动翻页（[pdfScrolledNav.ts](file:///Users/dnhyxc/Documents/code/dnhyxc-ai/apps/frontend/src/views/ebook/utils/pdf/pdfScrolledNav.ts)）

- `SCROLL_EDGE_PX=2` / `MIN_WHEEL_DELTA=28` / `SCROLL_STABLE_MS=220` / `EDGE_COOLDOWN_MS=600`。
- 流程：贴边 + 停稳 220ms + 再滚一下 → 翻页（与 EPUB `attachEpubScrolledEdgeNav` 的差异在于稳定条件更严）。

### 14.4 大纲（[pdfOutline.ts](file:///Users/dnhyxc/Documents/code/dnhyxc-ai/apps/frontend/src/views/ebook/utils/pdf/pdfOutline.ts)）

- `loadPdfOutlineToc(doc)` → flatten → 统一 `EbookTocItem`。
- `pdfPageHref` / `parsePdfPageHref` 用作 `href` 协议前缀（`'pdf-page:3'`）。

### 14.5 右键菜单（[buildPdfContextMenuItems.ts](file:///Users/dnhyxc/Documents/code/dnhyxc-ai/apps/frontend/src/views/ebook/utils/pdf/buildPdfContextMenuItems.ts)）

```
智能助手 → 缩放+ / 缩放- → 上一页 / 下一页 → 目录
（无选区问书项）
```

---

## 15. 跨模块互斥 / 生命周期 / 全局工具

### 15.1 互斥通道总图

```
┌──────────────────────┐    invokeStopChapterListen     ┌──────────────────────┐
│  useEpubChapterListen│ ◀─────────────────────────────  │ useEbookQuoteListen  │
│  (register stop)     │                                 │  (register stop)     │
└──────────────────────┘                                 └──────────────────────┘
           ▲                                                          │
           │              invokeStopQuoteListen                        │
           └──────────────────────────────────────────────────────────┘
```

外部调用：

- 进入听书：`invokeStopQuoteListen()`。
- 引用听读：`invokeStopChapterListen()`。
- 切换书：都通过 `stopInternal({ notify: false })` 清理。
- 浏览器 TTS：`stopAllPlayback` 共享。

### 15.2 跨 iframe 状态总线

- `rend.getContents()` 可能是单/多 iframe，归一为 `EpubIframeContents[]`。
- 写操作（`cfiFromRange`）按 `range.startContainer.ownerDocument` 找匹配 contents。
- 读操作（`getRange`）先 `rend.getRange`，回退逐个 `contents.range`。
- 事件（`mousedown`/`selectionchange`/`contextmenu`/`wheel`/`scroll`）必须在每个 iframe 单独挂载（`rend.hooks.content.register`），不会冒泡到顶层。

### 15.3 公开笔记同步生命周期

```
useEbookThoughtLoader:
   bookId || bookFmt 或 epuNavReady 变化 → 重新触发
   collectLoadedSpineHints(rend) → 逐 hint ensureSpineThoughtsLoaded

usePublicEbookThoughtSync:
   book || publicSource 变化 → 重新启用
   启用时：visibilitychange 监听、relocated 2000ms idle
   同步：since=max(updatedAt) → fetchEbookThoughtSync → applyEbookThoughtSync
   变化：ephemeralPinThoughtCfis(cfis) → 立即显示
```

### 15.4 持久化

| Key                                  | 模块               | 用途         |
| ------------------------------------ | ------------------ | ------------ |
| `dnhyxc_epub_reader_settings`        | epubReaderSettings | 阅读设置     |
| `dnhyxc_epub_highlight_custom_color` | epubUserHighlights | 自定义划线色 |
| `dnhyxc_pdf_reader_zoom`             | pdfReaderSettings  | PDF 缩放     |

后端持久化：高亮、想法走 `service/ebook` 的 REST API。

### 15.5 全局工具（[utils](../../../../utils/)）

| 工具                        | 在 EPUB 中的用途        |
| --------------------------- | ----------------------- |
| `speech`                | 听书 TTS（详见 §11.7）  |
| `clipboard.copyToClipboard` | 右键复制                |
| `runtime.isTauriRuntime`    | 桌面端 IO 切换          |
| `lib/utils.cn`              | Tailwind className 合并 |

---

## 16. 验收清单

### 16.1 M1 渲染管线

- [ ] 打开 epub 书，首屏渲染、显示标题与作者（如有）。
- [ ] 翻页（分页）：←/→/PageUp/PageDown 正常。
- [ ] 滚动（连续）：鼠标滚轮、拖滚动条、键盘 PageDown。
- [ ] 切书：旧 mark / listener / 状态全清，无残留。
- [ ] 拖分栏 / 最大化窗口：高亮不消失、不闪。
- [ ] 销毁：epub.js `destroy()` 调，`rend.hooks.content` 解绑。

### 16.2 M2 阅读设置

- [ ] 字号 80–160、行距 1.2–2.4 实时生效。
- [ ] 12 套背景色 + 12 套文字色，颜色/对比度正确。
- [ ] `default` 主题跟随应用主题。
- [ ] `paginated` ↔ `scrolled` 切换：旧 mark 清理、新模式生效。
- [ ] localStorage 持久化，刷新页面后保留。

### 16.3 M3 目录与导航

- [ ] TOC 解析：标题、spineIndex 正确。
- [ ] 目录点击：分页 `rend.display`、连续滚动对齐准确。
- [ ] 当前目录高亮：滚到下一章自动高亮下一目录项。
- [ ] 跨章跳转不闪、不留白。

### 16.4 M4 选区 + PopBar

- [ ] 拖选 → 松手出 PopBar。
- [ ] 简单点击（无选区）不出 PopBar。
- [ ] 键盘选区：200ms 防抖后出 PopBar。
- [ ] 右键不出 PopBar（contextMenuGesture 抑制）。
- [ ] 滚动 / relocated → 350ms 内不出 PopBar。
- [ ] 跨章选区：坐标转换正确。
- [ ] PopBar 锚点：多行选区取 focus 行顶。

### 16.5 M5 用户划线

- [ ] 5 套预设色 + 自定义 hex。
- [ ] 三种样式：高亮 / 下划线 / 波浪线。
- [ ] 新建 / 改色 / 改样式 / 删除。
- [ ] 重叠划线合并：合并后无重复。
- [ ] 严格包含：内层划线被外层覆盖时隐藏内层。
- [ ] 翻页 / 滚动：mark 位置 patch 准确，不闪。
- [ ] 点击 mark 弹 PopBar。
- [ ] PopBar 关闭 → mark 保留。

### 16.6 M6 想法下划线

- [ ] 公开笔记 / 私有笔记按用户配色。
- [ ] 视口模式：大书丝滑。
- [ ] 跨章想法 mark 仍能点击。
- [ ] 嵌套合并：内层完全被外层包裹时只绘外层。
- [ ] 滚动停稳 100ms：回收带外、keep 带内。
- [ ] 公开同步：2s relocated idle → since 同步；visibilitychange 立即同步。
- [ ] 新增想法 ephemeral pin 立即显示。
- [ ] 想法详情弹窗：本人可编辑/删除，他人只读。
- [ ] 想法 cluster 列表：连通闭包正确。

### 16.7 M7 听书

- [ ] 章节听书：连续滚动 / 分页都能跑。
- [ ] 节末自动接续：连续滚动 `advanceScrollListenSection`。
- [ ] 句级高亮：滚动居中、自动跟随。
- [ ] 倍速：0.75x–3x 实时生效。
- [ ] 暂停 / 续播：从断点继续。
- [ ] 上一句 / 下一句。
- [ ] 引用听读：选区 / 划线 / 侧栏引用都能听。
- [ ] 听书 ↔ 引用听读：互斥抢断。
- [ ] TTS 报 unsupported 提示正确。
- [ ] 用户手势：未触发前 TTS 不出。

### 16.8 M8 PDF + 持久化 + 同步

- [ ] PDF 加载：worker 初始化、wasm/cmap URL 正确。
- [ ] 缩放：0.5x–3x，clamp 后持久化。
- [ ] 滚动翻页：稳定 220ms + 冷却 600ms。
- [ ] PDF 大纲：书签 / 命名 dest 解析。
- [ ] 跨设备同步：公开笔记 since-based 增量。
- [ ] 引用分享卡片：富文本片段（字号/字重）保留。

---

## 17. 自检 & 回归坑位

### 17.1 性能坑

- **批注 sync 热路径**：不要在 `rend.annotations.remove + add` 之间用 rAF 闪；统一用 `patchEpubReadingAnnotations` 仅 patch 样式。
- **大书视口模式**：想法数 > 一定阈值必须视口模式，否则 mark 数爆炸导致 scroll 卡顿。
- **`rend.next()` in continuous mode**：会清视图 → 闪；改用 `advanceScrollListenSection`。
- **`rend.resize()`**：分栏拖拽会清视图；优先 `softResizeEpubRendition`。
- **locations.generate**：默认 1600 步长；太细（>5000）会卡首屏。

### 17.2 批注闪烁坑

- 划线 mark 重建：会导致 SVG 重画一闪。修复：sig 缓存 + `isUserHighlightMarkPresent` 检测。
- 想法下划线：相同样式相同样式集合必须保持，mark 移除后下一帧立即 apply。
- 听书 mark 切句：必须在切下一句前 clear 当前 mark，避免重叠。

### 17.3 跨 iframe 坐标坑

- `range.getBoundingClientRect()` 返 iframe 内坐标。
- `toIframeViewportOffset(win)`：`win.frameElement.getBoundingClientRect()` 拿 iframe 在主页面坐标。
- `readRangeViewportBounds`：`iframeRect.top + rect.top` 转主页面。

### 17.4 CFI / DOM 双向坑

- 主动选区 quote "司马懿的第四子"：同名 quote 出现在两个章节；`findAllUserHighlightsCoveringCfi` 必须按 CFI/DOM 嵌套判断，不能按 quote 字符串。
- 用户改章节后选区 quote 不变：`resolveCfiDomRange` 仍能解析旧 cfi（epub.js 容错）。
- 公开同步收到变化：必须 ephemeral pin 立即显示，不能等下一个 sync 周期。

### 17.5 互斥坑

- 听书运行中开引用听读：必须 `invokeStopChapterListen()` 先，否则两套 TTS 并行。
- 切书：所有 stop hook 必须先调 `stopInternal({ notify: false })` 否则旧 rendition 上残留 setTimeout。
- `loopGenRef`：每次 play 重置 gen；旧 gen 的 `await` 完成后用 `isGenActive` 短路。

### 17.6 回归 Checklist（按版本）

- [ ] epub.js 升级：annotations API / `getContents()` 类型可能变；`rend.hooks.content.register` 仍可用。
- [ ] 浏览器升级：Safari 18 / Chrome 130+；SpeechSynthesis voices 行为差异；wheel 事件 passive 默认值。
- [ ] pdf.js 升级：worker 路径可能变；`getDestination` 字符串 dest 解析逻辑。
- [ ] Tailwind 升级：`[&_.epub-container]` 任意选择器语法。
- [ ] 翻译：所有 i18n key 必须双校验。

---

## 18. 源码对照（11 个最关键符号 · 逐行注释）

> 选取标准：入口 hook → 控制器/互斥 → 核心算法 utils → UI 接线 → 后端 API。
> 完整符号边界、跨章引用、行号以下方路径 + 注释为准。
> 因体量所限，下列代码段为**关键骨架 + 逐行注释**的合订版（精简到能跑通主流程 + 易踩坑点）；如需完整 1:1 源码，可前往 `apps/frontend/src/views/ebook/...` 对照行号。

### 18.1 `EpubPane` 的 epub.js 主生命周期 useEffect

**来源**：[EpubPane.tsx](file:///Users/dnhyxc/Documents/code/dnhyxc-ai/apps/frontend/src/views/ebook/components/reader/EpubPane.tsx) · 约 L368–L660

```tsx
// 整个阅读器渲染入口；依赖 [open, pageFlow, ...]；open 变化时重置一切
useEffect(() => {
	const el = hostRef.current; // 渲染容器 div
	if (!el) return;

	let destroyed = false; // 标记 effect 已清理，避免异步流程完成时操作已销毁的 rend
	let book: Book | null = null; // epub.js Book 实例
	let rend: Rendition | null = null; // epub.js Rendition 实例
	let detachScrolledNav: (() => void) | undefined; // 连续滚动边缘翻章监听解绑
	let detachContextMenu: (() => void) | undefined; // 右键菜单解绑
	let detachSelectionPopBar: (() => void) | undefined; // 选区浮条解绑

	// ==== 清空一切状态，准备重新加载 ====
	onNavResetRef.current?.(); // 通知父级清空 nav API（避免快捷键指向已销毁的 rend）
	readyRef.current = false; // renderer 未就绪
	setRendReady(false);
	appliedThoughtsRef.current.clear(); // 清已应用的想法
	appliedHighlightsRef.current.clear(); // 清已应用的划线
	resetEpubReadingAnnotationSyncState(); // 清 patch 调度状态
	locationsReadyRef.current = false; // 百分比未就绪
	bookRef.current = null;
	rendRef.current = null;
	setErr(null);

	// 初始 CFI（定位阅读位置）
	const initialCfi =
		currentCfiRef.current ?? initialCfiRef.current ?? undefined;
	const pageFlow = readerSettingsRef.current.pageFlow; // 排版模式

	// 上报当前位置（CFI + 百分比）— relocated 后或 locations 完成时调用
	const reportCurrentLocation = async () => {
		if (!rend || destroyed) return;
		try {
			const loc = (await Promise.resolve(rend.currentLocation())) as
				| Location
				| undefined;
			if (loc?.start?.cfi) relocate(loc);
		} catch {
			/* 忽略 */
		}
	};

	// ==== 异步初始化 epub.js ====
	(async () => {
		try {
			// 1. 解析二进制 EPUB
			book = ePub(open, { openAs: "binary", replacements: "blobUrl" });
			bookRef.current = book;
			await book.opened;
			if (destroyed || !book) return;

			// 2. 算渲染尺寸
			const w = Math.max(el.clientWidth, 320) || 640;
			const h = Math.max(el.clientHeight, 320) || 480;

			// 3. 创建 renderer；连续滚动用 continuous manager
			rend = book.renderTo(el, {
				width: w,
				height: h,
				flow: pageFlow,
				manager: pageFlow === "scrolled" ? "continuous" : "default",
				spread: "none",
				allowScriptedContent: true,
			});

			// 4. 应用阅读外观（主题/字号/行距/背景色）
			applyEpubReaderAppearance(
				rend,
				readerSettingsRef.current,
				appThemeRef.current,
			);
			rendRef.current = rend;

			// 5. 绑 relocated / keydown
			rend.on("relocated", relocate);
			rend.on("keydown", onRenditionKeyDown);

			// 6. 条件绑 contextmenu / selection pop bar
			if (onReaderContextMenuRef.current) {
				detachContextMenu = attachEpubIframeContextMenu(rend, (payload) => {
					onReaderContextMenuRef.current?.(payload);
				});
			}
			detachSelectionPopBar = attachEpubSelectionPopBar(rend, (payload) => {
				onSelectionPopBarRef.current?.(payload);
			});

			// 7. 首屏定位
			await rend.display(initialCfi ?? undefined);
			if (destroyed) return;
			if (initialCfi) lateStartCfiAppliedRef.current = true;

			// 8. 等 book.ready
			await book.ready;
			if (destroyed) return;

			// 9. 标记 ready
			readyRef.current = true;
			setRendReady(true);

			// 10. 连续滚动 → 边缘翻章
			if (pageFlow === "scrolled") {
				detachScrolledNav = attachEpubScrolledEdgeNav(rend, () => destroyed);
			}

			// 11. 上报 nav API 给父级
			onReadyRef.current?.({
				prev: async () => {
					if (readyRef.current && rendRef.current) await rendRef.current.prev();
				},
				next: async () => {
					if (readyRef.current && rendRef.current) await rendRef.current.next();
				},
				go: async (href) => {
					const r = rendRef.current,
						b = bookRef.current;
					if (!r) return;
					if (readerSettingsRef.current.pageFlow === "scrolled" && b) {
						await displayEpubScrolledHref(r, b, href);
						return;
					}
					await r.display(href);
				},
				clearTextSelection: () => {
					if (rendRef.current) clearEpubTextSelection(rendRef.current);
				},
				getRendition: () => rendRef.current,
				getBook: () => bookRef.current,
				syncReadingAnnotations: (nextHighlights) => {
					const r = rendRef.current;
					if (!r) return;
					syncEpubReadingAnnotations(
						r,
						thoughtsRef.current ?? [],
						nextHighlights ?? highlightsRef.current ?? [],
						appliedThoughtsRef.current,
						appliedHighlightsRef.current,
						currentUserIdRef.current,
					);
				},
			});

			// 12. 加载目录
			const nav = await book.loaded.navigation;
			const spineBook = book;
			const toc: EbookTocItem[] = (nav.toc ?? []).map((t) => ({
				label: t.label?.trim() || t.href,
				href: t.href,
				spineIndex: t.href
					? resolveSpineIndexForHref(spineBook, t.href)
					: undefined,
			}));
			if (!destroyed) onTocRef.current?.(toc);

			// 13. 后台生成 locations（百分比）
			void book.locations
				.generate(1600)
				.then(() => {
					if (destroyed) return;
					locationsReadyRef.current = true;
					return reportCurrentLocation();
				})
				.catch(() => {
					/* 生成失败回退 spine 索引 */
				});
		} catch (e) {
			if (!destroyed) setErr(e instanceof Error ? e.message : "EPUB 打开失败");
		}
	})();

	// ==== 尺寸自适应 ====
	let resizeRaf: number | null = null;
	let windowResizeSettleTimer: ReturnType<typeof setTimeout> | null = null;

	const applyHostResize = () => {
		if (!hostRef.current || !readyRef.current || !rendRef.current) return;
		const w = Math.max(hostRef.current.clientWidth, 320);
		const h = Math.max(hostRef.current.clientHeight, 320);
		const rend = rendRef.current;
		if (!softResizeEpubRendition(rend, w, h)) {
			try {
				rend.resize(w, h);
			} catch {
				/* 闪断 */
			}
		}
		// soft resize 可能让高亮/划线丢失样式
		patchEpubReadingAnnotations(rend, { sync: true });
		relayoutListenMarkHighlight(rend);
		checkEpubListenFollowAfterLayout(rend);
	};

	const scheduleHostResize = () => {
		if (resizeRaf != null) cancelAnimationFrame(resizeRaf);
		resizeRaf = requestAnimationFrame(() => {
			resizeRaf = null;
			applyHostResize();
		});
	};

	const settleHostResize = () => {
		applyHostResize();
		const rend = rendRef.current;
		if (!rend || !readyRef.current) return;
		syncEpubReadingAnnotations(
			rend,
			thoughtsRef.current ?? [],
			highlightsRef.current ?? [],
			appliedThoughtsRef.current,
			appliedHighlightsRef.current,
			currentUserIdRef.current,
		);
	};

	// 监听容器变化 + 窗口 resize + 分栏拖动
	const ro = new ResizeObserver(() => scheduleHostResize());
	ro.observe(el);
	const onWindowResize = () => {
		scheduleHostResize();
		if (ebookSplitPanelResizingRef.current) return;
		if (windowResizeSettleTimer) clearTimeout(windowResizeSettleTimer);
		windowResizeSettleTimer = setTimeout(() => {
			windowResizeSettleTimer = null;
			if (ebookSplitPanelResizingRef.current) return;
			settleHostResize();
		}, 150);
	};
	window.addEventListener("resize", onWindowResize);
	const unsubSplitResizeEnd =
		subscribeEbookSplitPanelResizeEnd(settleHostResize);

	// ==== 清理函数 ====
	return () => {
		if (resizeRaf != null) cancelAnimationFrame(resizeRaf);
		if (windowResizeSettleTimer) clearTimeout(windowResizeSettleTimer);
		window.removeEventListener("resize", onWindowResize);
		unsubSplitResizeEnd();
		destroyed = true;

		detachContextMenu?.();
		detachSelectionPopBar?.();
		detachScrolledNav?.();

		readyRef.current = false;
		setRendReady(false);
		appliedThoughtsRef.current.clear();
		appliedHighlightsRef.current.clear();
		resetEpubReadingAnnotationSyncState();
		locationsReadyRef.current = false;
		bookRef.current = null;
		ro.disconnect();

		try {
			if (rend) {
				teardownAppliedThoughtUnderlines(rend, appliedThoughtsRef.current);
				teardownAppliedUserHighlights(rend, appliedHighlightsRef.current);
				rend.off("relocated", relocate);
				rend.off("keydown", onRenditionKeyDown);
				rend.destroy();
			}
			if (book) book.destroy();
		} catch {
			/* 忽略销毁错误 */
		}
		rendRef.current = null;
	};
}, [open, readerSettings.pageFlow, relocate, onRenditionKeyDown]);
```

**读完应掌握**：

- 入口侧只关心 `open` 变化（`ArrayBuffer` 改变）时重建；`startCfi` 用 `lateStartCfiAppliedRef` 防重载闪烁。
- 异步链用 `destroyed` 标志 + 每个 await 后 `if (destroyed) return` 防"已销毁"崩溃。
- onReady API 是 epub.js 与 React 状态的唯一通道；外部通过 `navApiRef.current?.next()` 等触发。
- 尺寸自适应优先级：softResize → resize 兜底 + patchEpubReadingAnnotations 恢复划线样式。
- locations 后台生成；前端用 ref 而非 state 避免触发重渲染。

### 18.2 `useEpubChapterListen.startFromCurrentPosition`

**来源**：[useEpubChapterListen.ts](file:///Users/dnhyxc/Documents/code/dnhyxc-ai/apps/frontend/src/views/ebook/hooks/useEpubChapterListen.ts) · 约 L506–L576

```ts
// 从当前阅读位置开始 TTS 朗读章节
const startFromCurrentPosition = useCallback(() => {
	// 触发用户手势相关英文朗读准备（unlock TTS）
	primePlaybackForUserGesture();

	// 检查 TTS 能力
	if (!isPlaybackAvailable()) {
		Toast({
			type: "warning",
			title: tRef.current("englishLearning.tts.unsupported"),
		});
		return;
	}

	const rend = getRenditionRef.current();
	if (!rend) {
		Toast({
			type: "warning",
			title: tRef.current("ebook.read.listenBook.notReady"),
		});
		return;
	}

	// 互斥：停引用听读、停所有 TTS、清高亮、启动自动跟随
	invokeStopQuoteListen();
	stopAllPlayback();
	clearEpubListenSegmentOverlay();
	beginChapterListenAutoFollow(rend);

	// 提取当前可见章节文本
	const spineHint = getCurrentSpineIndexRef.current?.();
	const preview = extractVisibleListenSection(rend, spineHint);
	if (!preview?.plain.trim()) {
		Toast({
			type: "warning",
			title: tRef.current("ebook.read.listenBook.emptySection"),
		});
		return;
	}

	// 递增循环代数
	const gen = ++loopGenRef.current;
	pausedRef.current = false;
	rateRef.current = stateRef.current.rate || 1;
	sentenceCursorRef.current = 0;
	resolveStartCfiRef.current = true; // 首次 prepareSection 时按 CFI 解析起始句
	sectionRef.current = null;
	sectionDocRef.current = preview.outerRange.startContainer.ownerDocument;

	// 切句 + labels
	const sentences = buildSentenceOffsetSpans(preview.plain.trim());
	const plain = preview.plain.trim();

	// 状态同步
	syncState({
		status: "loading",
		spineIndex: preview.spineIndex,
		sentenceIndex: 0,
		sentenceCount: sentences.length,
		sentenceLabels: buildSentenceLabels(plain, sentences),
		rate: rateRef.current,
	});

	// 启动主循环
	void runListenLoop(gen);
}, [runListenLoop, syncState]);
```

**读完应掌握**：

- 用户手势 → TTS 解锁的"前置动作"是 `primePlaybackForUserGesture()`；必须同步执行。
- `loopGenRef` 防并入：每次 start 自增；旧 gen 的 await 完成后用 `isGenActive` 短路。
- `resolveStartCfiRef = true` 让 `prepareSection` 时按 CFI 解析起始句。
- `beginChapterListenAutoFollow` 注册 scroll guard，外部 UI 订阅 `subscribeEpubListenAutoFollow` 展示 FAB。

### 18.3 `applyEpubUserHighlights` — 划线渲染核心

**来源**：[epubUserHighlights.ts](file:///Users/dnhyxc/Documents/code/dnhyxc-ai/apps/frontend/src/views/ebook/utils/epub/mark/epubUserHighlights.ts) · 约 L1136–L1185

```ts
export function applyEpubUserHighlights(
	rend: Rendition,
	highlights: EbookUserHighlight[],
	appliedRef: Map<string, string>,
	plan?: HighlightRenderPlan,
): void {
	// 注入 SVG 样式（fill/stroke 渐变等）
	try {
		ensureUserHighlightStyles();
	} catch {
		return;
	}

	// 复用 plan 或新建（plan 由 syncEpubUserHighlights 传，避免重复 build）
	const renderPlan = plan ?? buildHighlightRenderPlan(rend, highlights);
	const { visibleCfis, sortedHighlights, keepCfis } = renderPlan;

	// 缓存：cfi → highlight 元数据（点击/查询用）
	highlightMetaByCfi = new Map(
		sortedHighlights
			.filter((item) => visibleCfis.has(item.cfiRange))
			.map((item) => [item.cfiRange, item]),
	);

	// 卸载已不显示的 mark
	purgeStaleUserHighlightAnnotations(rend, highlights, keepCfis, appliedRef);

	// 渲染
	for (const item of sortedHighlights) {
		if (!visibleCfis.has(item.cfiRange)) continue;
		const nextSig = buildHighlightApplySignature(item);
		// sig 未变 + mark 存在 → 跳过
		if (
			appliedRef.get(item.cfiRange) === nextSig &&
			isUserHighlightMarkPresent(rend, item.cfiRange)
		) {
			continue;
		}
		// 否则 remove + highlight 重画
		removeUserHighlightAnnotation(rend, item.cfiRange, appliedRef);
		try {
			// 统一 highlight 类型，与想法 underline 批注槽位分离
			rend.annotations.highlight(
				item.cfiRange,
				buildHighlightData(item),
				buildUserHighlightClickHandler(item),
				buildHighlightClassName(item),
				buildHighlightStyles(item),
			);
			appliedRef.set(item.cfiRange, nextSig);
		} catch {
			appliedRef.delete(item.cfiRange);
		}
	}
}
```

**读完应掌握**：

- `plan` 复用：sync 期间 build 一次，patch 期间复用，避免重复 `coalesceOverlappingHighlightsForRender`。
- 渲染计划四元组：`{ coalesced, visibleCfis, sortedHighlights, keepCfis }`。
- `appliedRef` + `isUserHighlightMarkPresent` 双保险：sig 不变就跳过重画（避免 SVG 闪烁）。
- 统一用 `highlight` 类型（与想法 `underline` 槽位分离），方便 `remove(cfi, 'highlight')` 精准清理。

### 18.4 `applyEpubThoughtUnderlines` — 想法下划线核心

**来源**：[epubThoughtAnnotations.ts](file:///Users/dnhyxc/Documents/code/dnhyxc-ai/apps/frontend/src/views/ebook/utils/epub/mark/epubThoughtAnnotations.ts) · 约 L1259–L1385

```ts
export function applyEpubThoughtUnderlines(
	rend: Rendition,
	thoughts: EbookThought[],
	appliedRef: Map<string, string>,
	currentUserId = 0,
	options?: ApplyThoughtUnderlineOptions,
): void {
	// 注入 SVG 样式（虚线/颜色）
	try {
		ensureThoughtUnderlineStyles();
	} catch {
		ephemeralPinCfis.clear();
		return;
	}

	// 解析 pin（外部强制挂载） + 视口裁剪
	const pinCfis = resolvePinnedCfis(options);
	const scopedThoughts = filterThoughtsForAnnotationApply(rend, thoughts);
	const grouped = groupThoughtsByCfi(scopedThoughts);
	const allGrouped = groupThoughtsByCfi(thoughts);
	const loadedSpines = collectLoadedSpineHints(rend);
	const scopeBySpine = shouldScopeThoughtApplyBySpine(
		allGrouped.size,
		loadedSpines,
	);
	const viewportMode = shouldUseViewportThoughtApply(
		allGrouped.size,
		grouped.size,
	);
	const viewportRoot = viewportMode ? resolveThoughtViewportRoot(rend) : null;
	const viewportBands = viewportRoot
		? readThoughtViewportBands(viewportRoot)
		: null;

	// 决定每个 cfi 是否保留
	const shouldKeepCfiApplied = (cfiRange: string): boolean => {
		if (pinCfis.has(cfiRange)) return true;
		if (!viewportMode || !viewportBands) return true;
		for (const doc of iterThoughtUnderlineDocuments(rend)) {
			try {
				for (const group of doc.querySelectorAll(THOUGHT_MARK_SELECTOR)) {
					if ((group as SVGElement).dataset.epubcfi?.trim() !== cfiRange)
						continue;
					return isThoughtMarkGroupInBand(
						group as SVGElement,
						viewportBands.remove,
					);
				}
			} catch {
				/* ignore */
			}
		}
		return isCfiRangeInThoughtBand(rend, cfiRange, viewportBands.keep);
	};

	const presentCfis = buildPresentThoughtMarkCfis(rend);
	const nextCfis = new Set(grouped.keys());

	// 记录本人划线
	for (const [cfiRange, group] of grouped) {
		thoughtLineOwnByCfi.set(
			cfiRange,
			group.some((t) => t.userId === currentUserId),
		);
	}
	for (const key of [...thoughtLineOwnByCfi.keys()]) {
		if (!nextCfis.has(key)) thoughtLineOwnByCfi.delete(key);
	}

	// 卸载不需要的 mark
	for (const cfiRange of [...appliedRef.keys()]) {
		const dropData =
			!nextCfis.has(cfiRange) ||
			(scopeBySpine && !loadedSpines.has(thoughtSpineHint(cfiRange)));
		const dropViewport =
			Boolean(options?.reclaimOffViewportMarks) &&
			viewportMode &&
			!shouldKeepCfiApplied(cfiRange);
		if (!dropData && !dropViewport) continue;
		if (pinCfis.has(cfiRange) && dropViewport && nextCfis.has(cfiRange))
			continue;
		try {
			rend.annotations.remove(cfiRange, "underline");
		} catch {
			/* ignore */
		}
		appliedRef.delete(cfiRange);
	}

	// 按叠层顺序渲染（短 quote 排上面）
	const sortedEntries = sortCfiGroupsForUnderlineStack([...grouped.entries()]);
	for (const [cfiRange, group] of sortedEntries) {
		if (viewportMode && !pinCfis.has(cfiRange) && viewportBands) {
			if (!isCfiRangeInThoughtBand(rend, cfiRange, viewportBands.keep))
				continue;
		}
		const thoughtIds = group.map((t) => t.id);
		const showLine = true;
		const lineOwn = group.some((t) => t.userId === currentUserId);
		const nextSig = `${buildThoughtUnderlineSignature(thoughtIds, showLine)}|${lineOwn ? "1" : "0"}`;
		if (appliedRef.get(cfiRange) === nextSig && presentCfis.has(cfiRange))
			continue;
		try {
			rend.annotations.remove(cfiRange, "underline");
			rend.annotations.underline(
				cfiRange,
				{
					thoughtIds,
					[THOUGHT_MARK_DATA_SHOW_LINE]: showLine ? "1" : "0",
					[THOUGHT_MARK_DATA_LINE_OWN]: lineOwn ? "1" : "0",
				},
				undefined,
				EPUB_THOUGHT_UNDERLINE_CLASS,
				{
					...EPUB_THOUGHT_UNDERLINE_STYLES,
					stroke: resolveThoughtLineColor(group, currentUserId),
				},
			);
			appliedRef.set(cfiRange, nextSig);
			presentCfis.add(cfiRange);
		} catch {
			appliedRef.delete(cfiRange);
		}
	}
	ephemeralPinCfis.clear();
}
```

**读完应掌握**：

- 三类裁剪：pin（强制）/ 视口（性能）/ 嵌套合并（视觉）。
- `signature = thoughtIds + showLine + lineOwn`：sig 变才重画；同 sig 跳过避免 SVG 闪烁。
- `rend.annotations.underline`：与 `highlight` 不同的批注槽位，互不污染。
- `ephemeralPinCfis` 在 apply 末尾清空，确保仅"一次性 pin"。

### 18.5 `attachEpubSelectionPopBar` — 选区监听

**来源**：[epubSelectionToolbarAttach.ts](file:///Users/dnhyxc/Documents/code/dnhyxc-ai/apps/frontend/src/views/ebook/utils/epub/reader/epubSelectionToolbarAttach.ts) · 约 L261–L492

```ts
export function attachEpubSelectionPopBar(
	rend: Rendition,
	onChange: (payload: EpubSelectionPopBarPayload | null) => void,
): () => void {
	const contentCleanups = new Map<EpubIframeContents, () => void>();
	const scrollCleanups: (() => void)[] = [];
	const boundScrollContainers = new WeakSet<HTMLElement>();
	let rafId = 0;
	let keyboardEmitTimer = 0;
	let selecting = false;
	let suppressEmitUntil = 0;
	let contextMenuGesture = false;

	const clearPendingEmit = () => {
		cancelAnimationFrame(rafId);
		rafId = 0;
		window.clearTimeout(keyboardEmitTimer);
		keyboardEmitTimer = 0;
	};

	const hidePopBar = () => {
		if (shouldSuppressDismiss()) return;
		clearPendingEmit();
		onChange(null);
	};

	const forceHidePopBar = () => {
		clearPendingEmit();
		onChange(null);
	};

	const shouldSuppressEmit = () => Date.now() < suppressEmitUntil;

	const onScroll = () => {
		suppressEmitUntil = Date.now() + 350;
		hidePopBar();
	};

	const addScrollListener = (target: EventTarget) => {
		target.addEventListener("scroll", onScroll, {
			capture: true,
			passive: true,
		});
		scrollCleanups.push(() =>
			target.removeEventListener("scroll", onScroll, { capture: true }),
		);
	};

	const bindEpubScrollContainer = () => {
		const container = getEpubScrollContainer(rend);
		if (!container || boundScrollContainers.has(container)) return;
		boundScrollContainers.add(container);
		addScrollListener(container);
	};

	// 核心：双 rAF 保证跨 DOM settle + 跨 iframe 同步后 emit
	const emitSelection = () => {
		if (shouldSuppressEmit()) {
			hidePopBar();
			return;
		}
		cancelAnimationFrame(rafId);
		rafId = requestAnimationFrame(() => {
			rafId = requestAnimationFrame(() => {
				if (shouldSuppressEmit()) {
					hidePopBar();
					return;
				}
				const active = readActiveSelection(rend);
				if (!active) return; // 简单点击不关
				const anchor = rangeToViewportAnchor(active.win, active.range);
				if (!anchor) {
					onChange(null);
					return;
				}
				rememberEpubPopBarSelectionRange(active.range);
				onChange({
					x: anchor.centerX,
					y: anchor.top,
					selectedText: active.text,
					quoteSegments: extractQuoteSegmentsFromRange(
						active.range,
						active.win,
					),
					cfiRange: resolveSelectionCfiRange(rend, active.win, active.range),
				});
			});
		});
	};

	// 每章节 iframe 都挂一份（mousedown / mouseup / selectionchange / contextmenu）
	const bindContents = (contents: EpubIframeContents) => {
		if (contentCleanups.has(contents)) return;
		const doc = contents.document;

		const onPointerDown = (e: Event) => {
			if (e instanceof MouseEvent && e.button === 2) {
				contextMenuGesture = true;
				suppressEmitUntil = Date.now() + 600;
			}
			selecting = true;
			hidePopBar();
		};
		const onPointerUp = (e: Event) => {
			if (!selecting) return;
			selecting = false;
			if (contextMenuGesture || (e instanceof MouseEvent && e.button === 2))
				return;
			emitSelection();
		};
		const onSelectionChange = () => {
			if (shouldSuppressEmit()) {
				hidePopBar();
				return;
			}
			if (!readActiveSelection(rend)) {
				if (selecting || shouldSuppressDismiss()) return;
				onChange(null);
				return;
			}
			if (selecting) return;
			window.clearTimeout(keyboardEmitTimer);
			keyboardEmitTimer = window.setTimeout(() => {
				if (selecting || shouldSuppressEmit()) return;
				emitSelection();
			}, 200);
		};
		const onContextMenu = () => {
			contextMenuGesture = false;
			suppressEmitUntil = Date.now() + 600;
			forceHidePopBar();
		};
		doc.addEventListener("mousedown", onPointerDown, true);
		doc.addEventListener("touchstart", onPointerDown, true);
		doc.addEventListener("mouseup", onPointerUp, true);
		doc.addEventListener("touchend", onPointerUp, true);
		doc.addEventListener("selectionchange", onSelectionChange);
		doc.addEventListener("contextmenu", onContextMenu, true);
		addScrollListener(doc);
		addScrollListener(contents.window);
		contentCleanups.set(contents, () => {
			doc.removeEventListener("mousedown", onPointerDown, true);
			// ... 全部解绑
		});
	};

	// 动态响应新章节 iframe
	rend.hooks.content.register(bindContents);
	const existing = rend.getContents();
	if (Array.isArray(existing))
		for (const item of existing) bindContents(item as EpubIframeContents);
	else if (existing) bindContents(existing as EpubIframeContents);

	addScrollListener(window);
	addScrollListener(document);
	bindEpubScrollContainer();

	// 翻章 / 渲染时重绑容器 + 关 PopBar
	const onRendered = () => bindEpubScrollContainer();
	const onRelocated = () => {
		suppressEmitUntil = Date.now() + 350;
		hidePopBar();
		bindEpubScrollContainer();
	};
	rend.on("rendered", onRendered);
	rend.on("relocated", onRelocated);

	// 顶层 pointerup：兜底（用户拖出 iframe 也能结束）
	const onDocPointerUp = () => {
		if (!selecting) return;
		selecting = false;
		emitSelection();
	};
	document.addEventListener("pointerup", onDocPointerUp, true);
	document.addEventListener("touchend", onDocPointerUp, true);

	return () => {
		cancelAnimationFrame(rafId);
		window.clearTimeout(keyboardEmitTimer);
		document.removeEventListener("pointerup", onDocPointerUp, true);
		document.removeEventListener("touchend", onDocPointerUp, true);
		rend.off("rendered", onRendered);
		rend.off("relocated", onRelocated);
		for (const fn of scrollCleanups) fn();
		scrollCleanups.length = 0;
		for (const fn of contentCleanups.values()) fn();
		contentCleanups.clear();
		onChange(null);
	};
}
```

**读完应掌握**：

- 双 rAF 是为了"先让 DOM 稳定 + 跨 iframe selection 同步"。
- 抑制矩阵：suppressDismiss（450ms）/ suppressEmit（350/600ms）/ contextMenuGesture（手势）/ selecting（拖选中）。
- 选区归一 → 跨 iframe 锚点 → CFI 解析 → quote 富文本片段 → 一次性 emit payload。
- 动态内容挂载：`rend.hooks.content.register(bindContents)` 让新 iframe 自动绑定。

### 18.6 `indexChapterSentenceRanges` — 句级 Range 索引

**来源**：[epubListenChapter.ts](file:///Users/dnhyxc/Documents/code/dnhyxc-ai/apps/frontend/src/views/ebook/utils/epub/listen/epubListenChapter.ts) · 约 L384–L425

```ts
export function indexChapterSentenceRanges(
	outerRange: Range,
	plain: string,
): Array<Range | null> {
	const trimmed = plain.trim();
	const sentences = buildSentenceOffsetSpans(trimmed);
	if (!sentences.length) return [];

	const body = bodyFromOuter(outerRange);
	if (!body) return sentences.map(() => null);

	// 列举 body 内所有文本节点 × offset
	const positions = listBodyTextPositions(body);
	if (!positions.length) return sentences.map(() => null);

	// 标准化：合并空白、压缩
	const { norm, map } = buildNormStream(positions);
	if (!norm) return sentences.map(() => null);

	// 顺序搜索每句 needle → 找到对应 DOM 位置
	let cursor = 0;
	return sentences.map((sent) => {
		const needle = normForMatch(trimmed.slice(sent.start, sent.end));
		if (!needle) return null;

		let idx = norm.indexOf(needle, cursor);
		// 长句 fallback：前 24 字符先搜，确认 prefix 一致
		if (idx < 0 && needle.length >= 8) {
			const head = needle.slice(0, Math.min(24, needle.length));
			idx = norm.indexOf(head, cursor);
			if (idx >= 0 && norm.slice(idx, idx + needle.length) !== needle) idx = -1;
		}
		if (idx < 0) return null;

		const startPi = map[idx];
		const endPi = map[idx + needle.length - 1];
		if (startPi == null || endPi == null) return null;

		const range = rangeFromPosSpan(positions, startPi, endPi);
		if (range) cursor = idx + needle.length; // 顺序推进
		return range;
	});
}
```

**读完应掌握**：

- 不依赖 epub.js `getRange`（不支持句级）；自建"字符级 → DOM 文本节点 offset"映射。
- 标准化空白 + 顺序搜索：保证不重不漏；needle 与 DOM 文本对齐，避免"句末空白"误匹配下一段。
- 长句 fallback：head 24 字符先搜；防止 needle 含特殊字符 regex 化失败。
- `cursor = idx + needle.length` 推进：避免"同句重复匹配"。

### 18.7 `advanceScrollListenSection` — 连续滚动听书节间推进

**来源**：[epubScrollListenAdvance.ts](file:///Users/dnhyxc/Documents/code/dnhyxc-ai/apps/frontend/src/views/ebook/utils/epub/listen/epubScrollListenAdvance.ts) · 约 L165–L207

```ts
export async function advanceScrollListenSection(
	rend: Rendition,
	currentDoc: Document,
): Promise<Document | null> {
	// 列所有 .epub-view 槽位
	let slots = listEpubViewSlots(rend);
	// 找已加载的下一 doc
	const ready = nextLoadedDoc(slots, currentDoc);
	if (ready) return ready;

	// 找不到当前 doc 的 slot → 从末尾往前找最近的 loaded doc 作为基准
	let slotIdx = findSlotIndex(slots, currentDoc);
	if (slotIdx < 0) {
		for (let i = slots.length - 1; i >= 0; i -= 1) {
			if (slots[i]!.doc) {
				slotIdx = i;
				break;
			}
		}
	}

	// 5 轮：每轮对所有 next slot 尝试加载 + 必要时整屏下滚
	for (let round = 0; round < ADVANCE_ROUNDS; round += 1) {
		slots = listEpubViewSlots(rend);
		for (let i = slotIdx + 1; i < slots.length; i += 1) {
			const doc = await ensureSlotDocument(rend, slots[i]!);
			if (doc && !sameDoc(doc, currentDoc)) return doc;
		}
		// 激进推进：滚一整屏 + manager.check
		const host = getEpubScrollContainer(rend);
		if (host) {
			host.scrollTop += Math.max(200, Math.floor(host.clientHeight * 0.9));
			await invokeManagerCheck(rend);
			await pauseForLayout();
		}
	}
	return null;
}
```

**读完应掌握**：

- **不调用 `rend.next()`**：避免清视图、避免重新拼句流。
- 找已加载 doc → 否则滚到目标 slot 触发 `manager.check()` 加载 → 5 轮后整屏下滚强行触发挂载。
- `sameDoc(a, b)` 双重判定：引用相等 + `<link rel="canonical">` 相等。
- `ensureSlotDocument` 内 8 次 `manager.check` + 80ms 间隔 + 只在 doc.body 有正文时返回。

### 18.8 `coalesceOverlappingHighlightsForRender` — 划线合并（设计说明）

**来源**：[epubUserHighlights.ts](file:///Users/dnhyxc/Documents/code/dnhyxc-ai/apps/frontend/src/views/ebook/utils/epub/mark/epubUserHighlights.ts) · 约 L2025–L2111

> 该函数把"重叠/相邻/包含"的多条划线合并为最少且不重叠的子集。

**关键策略**

```ts
function coalesceOverlappingHighlightsForRender(rend, highlights) {
	// 1. 同 CFI 保留 style/color 优先级最高的那条
	// 2. 严格包含：保留外层、移除内层
	// 3. 重叠/相邻：用 mergeDomRangeUnion 合并 client rect
	// 4. 跨文档划线：分别归并
	return sortedCoalesced;
}
```

**读完应掌握**：

- 合并依据是 DOM Range 重叠（`doDomRangesOverlapForMerge`）+ client rect 重叠（`doClientRectsOverlapForMerge`），不是 quote 字符串。
- 严格嵌套用 `isDomRangeStrictlyContained`；quote 嵌套回退（无 DOM 时）。
- 合并后保留"主 CFI"（最长 quote），避免 CFI 反复切换导致 patch 抖动。

### 18.9 `applyEpubReaderAppearance` — 阅读设置落 iframe

**来源**：[epubReaderSettings.ts](file:///Users/dnhyxc/Documents/code/dnhyxc-ai/apps/frontend/src/views/ebook/utils/epub/reader/epubReaderSettings.ts) · 约 L326–L381

```ts
export function applyEpubReaderAppearance(rend, settings, appTheme) {
    const color = resolveEpubTextColor(settings.textColor, appTheme);
    const bgColor = resolveEpubReaderBackground(settings.bgTheme, appTheme);
    const lineHeight = String(settings.lineHeight);
    const fontSize = `${settings.fontSize}%`;
    const isDarkBg = settings.bgTheme === 'night' || appTheme === 'black';

    try { rend.themes.fontSize(fontSize); } catch { /* fallback to CSS */ }

    rend.themes.default({
        html: { background: `${bgColor} !important` },
        body: { color, background, 'line-height', 'font-size' },
        'p, span, div, li, td, th, h1, h2, h3, h4, h5, h6, em, strong, i, b, a': { ... },
        blockquote: { 'background-color', border, 'border-radius', padding },
        '.kindle-cn-frame-zhishidian': { ... },
        '.kindle-cn-frame-zsdtext': { ... },
        '.kindle-cn-frame-yuanjiao': { ... },
        '.kindle-cn-frame-zhijiao': { ... },
    });
}
```

**读完应掌握**：

- `!important` 强覆盖：作者 CSS 不会盖住阅读设置。
- 同时设置 `rend.themes.fontSize`（epub.js API）+ body font-size（CSS 双保险）。
- 兼容 Kindle 标注（`.kindle-cn-frame-*`）和 blockquote 风格。
- 主题背景在 `default` 模式下走 `transparent`，让外层阅读器背景透出；其它主题直接给颜色，避免 iframe 白底闪烁。

---

### 18.10 `useEbookQuoteListen.startPlayback` — 引用听读启动

**来源**：`apps/frontend/src/views/ebook/hooks/useEbookQuoteListen.ts` · 约 L220–L291

引用听读（选区右键「听这句」/ 划线卡片上的播放按钮）的入口函数。它把「选区文本 → plain 文本 → overlay 会话 → 逐句播放循环」串起来，并完成与「整章听书」的互斥注册。

```typescript
// startPlayback：从外部（选区工具栏/划线卡片）触发引用听读
const startPlayback = useCallback(
	async (
		// 用户选中的原始文本（可能含 markdown/换行）
		text: string,
		// 唯一播放键：用于判断「点同一个按钮 = 停止」
		key: string,
		// 选区对应的 epub CFI range（用于 overlay 会话定位）
		cfiRange?: string,
		// 用户原始选区的 DOM Range（被冻结下来，避免选区失效）
		frozenRange?: Range | null,
	) => {
		// 空文本直接退出，不进入会话
		const trimmed = text.trim();
		if (!trimmed) return;

		// 互斥 1：先调用 registerChapterListenStop 注册的回调，停止整章听书
		invokeStopChapterListen();
		// 互斥 2：浏览器不支持 TTS（无 SpeechSynthesis 或无 voice）→ 提示并退出
		if (!isPlaybackAvailable()) {
			Toast({
				type: "warning",
				title: tRef.current("englishLearning.tts.unsupported"),
			});
			return;
		}

		// 用户手势 prime：解锁 AudioContext 之类的浏览器策略限制
		primePlaybackForUserGesture();
		// 清理上一次的英文 TTS（避免两次播放叠加）
		stopAllPlayback();
		// 清理上一次的 overlay 会话（避免高亮残留）
		clearEpubListenSegmentOverlay();

		// 拿到当前 rendition（可能为 null，比如尚未 ready）
		const rend = getRenditionRef.current?.() ?? null;
		// cfi 修剪为字符串
		const cfi = cfiRange?.trim() ?? "";
		// resolveEpubListenPlain：把选区文本 + frozenRange 解析为「可朗读 plain + selectionRange」
		// selectionRange：用于 overlay 在 iframe 内画高亮；plain：用于 TTS
		const { plain, selectionRange } = resolveEpubListenPlain(
			rend,
			trimmed,
			frozenRange,
		);

		// 仅当 rendition 与 plain 都存在时，才创建 overlay 会话
		if (rend && plain) {
			beginEpubListenOverlaySession(rend, plain, {
				cfi,
				selectionRange,
			});
		}

		// 取会话 plain：优先从 overlay 会话取（已被分句处理），否则用上面解析的 plain
		const speakPlain = getEpubListenSessionPlain() ?? plain;
		// 没有可朗读内容 → 退出（不进入播放循环）
		if (!speakPlain.trim()) return;

		// 兜底 plain：当 overlay 会话被外部清掉时，playFromCursor 还能用它分句
		fallbackPlainRef.current = speakPlain;
		// 句子标签列表：底部播放条上展示当前句文本
		const meta = getEpubListenSessionMeta();
		const labels = meta?.sentenceLabels ?? buildLabelsFromPlain(speakPlain);
		// 总句数：来自 overlay 元信息或标签长度
		const sentenceCount = meta?.sentenceCount ?? labels.length;

		// 关键：自增 loopGen，让上一轮的 playFromCursor 立刻失效（实现「打断旧播放」）
		const gen = ++loopGenRef.current;
		// 重置暂停标记
		pausedRef.current = false;
		// 取当前 state.rate 作为本次播放速率（用户在 UI 上调过）
		rateRef.current = stateRef.current.rate || 1;
		// 句指针归零：从第一句开始
		sentenceCursorRef.current = 0;
		// 记录正在播放的 key（用于按钮态/再次点击停止）
		playingKeyRef.current = key;
		setPlayingKey(key);

		// 当前 spine 索引（用于状态展示，跟整章听书字段对齐）
		const spineIndex = getSpineIndexRef.current?.() ?? -1;
		// 同步外部 state：loading 阶段（接下来 playFromCursor 会切到 playing）
		syncState({
			status: "loading",
			spineIndex,
			sentenceIndex: 0,
			sentenceCount,
			sentenceLabels: labels,
			rate: rateRef.current,
		});

		// 真正开始播放：playFromCursor 内部 for 循环逐句 await playPreferred
		const finished = await playFromCursor(gen);
		// finished = true 表示正常播完最后一句
		if (finished && isGenActive(gen)) {
			stopInternal();
		} else if (!pausedRef.current && isGenActive(gen)) {
			// 中途异常退出（如 cloudTts 失败）且非用户主动暂停 → 走 stopInternal 收尾
			stopInternal();
		}
	},
	[playFromCursor, stopInternal, syncState],
);
```

**配套：`playFromCursor` 主循环（来源：同文件 · 约 L129–L218）**

playFromCursor 是 startPlayback 调用的真正播放主循环。理解它的「gen 失效检查 + 句指针推进 + 预取下一句」三段，就理解了整个引用听读的运行期。

```typescript
const playFromCursor = useCallback(
	async (gen: number): Promise<boolean> => {
		// 当前 rendition（用于画高亮）
		const rend = getRenditionRef.current?.() ?? null;
		// overlay 会话元信息（含分句）
		const meta = getEpubListenSessionMeta();
		// plain：优先 meta，fallback 用 ref
		const plain = meta?.plain ?? fallbackPlainRef.current;
		// 句子总数：优先 meta，否则实时分句
		const sentenceCount =
			meta?.sentenceCount ?? buildSentenceOffsetSpans(plain.trim()).length;

		// 空文本 → 直接 false（外层据此 stopInternal）
		if (!plain.trim() || sentenceCount <= 0) return false;

		// 预取缓存：句 index → TTS Promise
		const prefetchedByIndex = new Map<
			number,
			ReturnType<typeof prefetchCloudTts>
		>();

		// 预取下一句的云端 TTS（让下一句能秒播）
		const schedulePrefetch = (index: number) => {
			if (index >= sentenceCount || prefetchedByIndex.has(index)) return;
			const raw = resolveSpokenAt(index, plain);
			if (!raw) return;
			prefetchedByIndex.set(index, prefetchCloudTts(raw));
		};
		// 启动时预取第二句，让第一句播完时第二句已就绪
		schedulePrefetch(sentenceCursorRef.current + 1);

		// 主循环：从当前游标逐句播放到末句
		for (let si = sentenceCursorRef.current; si < sentenceCount; si += 1) {
			// gen 失效或被暂停 → 提前退出（return false）
			if (!isGenActive(gen) || pausedRef.current) return false;

			// 拿当前句要播放的原文；空句跳过
			const spokenRaw = resolveSpokenAt(si, plain);
			if (!spokenRaw) continue;

			// 句指针推进
			sentenceCursorRef.current = si;
			// 同步外部 state：正在播放第 si 句
			syncState({
				status: "playing",
				sentenceIndex: si,
				sentenceCount,
			});

			// 在 iframe 内画淡黄高亮区块（marks-pane）
			if (rend) showEpubListenPlainSpan(0, 0, si);

			// 预取下一句（让下一句也命中缓存）
			schedulePrefetch(si + 1);

			try {
				// 播放当前句：playPreferred 会本地优先、云端兜底
				await playPreferred(spokenRaw, {
					speak: { rate: rateRef.current },
					prefetchedCloud: prefetchedByIndex.get(si) ?? null,
				});
			} catch (err) {
				// 仅当 gen 仍有效且未通知过 cloudTts 时弹 toast
				if (
					isGenActive(gen) &&
					!(err as { cloudTtsNotified?: boolean }).cloudTtsNotified
				) {
					Toast({
						type: "warning",
						title: tRef.current("englishLearning.tts.unsupported"),
					});
				}
				return false;
			}

			// 再确认：未被打断/暂停才继续下一句
			if (!isGenActive(gen) || pausedRef.current) return false;
			// 清掉当前句高亮（下一句会重新画）
			if (rend) clearActiveListenHighlight(rend);
		}

		// 完整播到尾 → return true（外层据此 stopInternal）
		return isGenActive(gen);
	},
	[syncState],
);
```

**读完应掌握**：

- `startPlayback` 的「先停 chapter listen → prime 手势 → resolve plain → 建 overlay 会话 → 自增 loopGen → 调 playFromCursor」六步串行顺序，每一步都不可省。
- `loopGenRef` 是引用听读的核心互斥机制：每次自增后旧 gen 的 await 会被 `isGenActive` 判定失效而提前退出，从而实现「快速点不同句子不会叠音」。
- `frozenRange` 是为了对抗 epub.js iframe 在选区工具栏弹出后可能丢失 selection 的问题——选区一产生就立即冻结 Range 传进来。
- `prefetchedByIndex` 让下一句的云端 TTS 在当前句播放期间就开始请求，从而把云端 TTS 的网络延迟藏到播放时间里。
- `playFromCursor` 与 `startPlayback` 共用同一个 `gen`，任何来自 `pause / resume / goToSentence / stop` 的中断都通过 `++loopGenRef.current` 让旧循环立刻失效。

---

### 18.11 `usePublicEbookThoughtSync.syncThoughts` — 想法增量同步

**来源**：`apps/frontend/src/views/ebook/hooks/usePublicEbookThoughtSync.ts` · 约 L53–L97

公开想法（publicSource 共享上下文下的他人读书想法）的增量同步函数。它以「本地最大 updatedAt 时间戳」为 `since`，向后端拉取该时间之后变化的想法，合并进本地，并临时 pin 住新增 cfiRange（防止渲染抖动）。

```typescript
const syncThoughts = useCallback(
	async (options?: SyncOptions): Promise<EbookThought[] | null> => {
		// 守卫 1：未启用（非共享上下文 / 无 bookId）→ 直接返回 null
		if (!enabled || !bookId) return null;
		// 守卫 2：已有进行中的 sync → 复用同一 Promise，避免重复请求
		if (inFlightRef.current) return inFlightRef.current;

		const now = Date.now();
		// 守卫 3：非强制同步 + 距上次同步 < 5s → 直接返回当前 thoughts（节流）
		if (!options?.force && now - lastSyncAtRef.current < MIN_SYNC_INTERVAL_MS) {
			return thoughtsRef.current;
		}

		// 真正的同步逻辑（独立成 run()，方便 inFlightRef 持有 Promise）
		const run = async (): Promise<EbookThought[] | null> => {
			try {
				// 拿本地最新 thoughts（ref，避免闭包陈旧）
				const local = thoughtsRef.current;
				// 计算增量参数 since：
				//   ebookThoughtSyncSinceParam(maxEbookThoughtUpdatedAt(local))
				//   - maxEbookThoughtUpdatedAt：取所有 thought 中最大的 updatedAt
				//   - ebookThoughtSyncSinceParam：包装成接口需要的格式（可能减 1ms 防边界丢数据）
				const since = ebookThoughtSyncSinceParam(
					maxEbookThoughtUpdatedAt(local),
				);
				// 调后端 /api/ebook/thought/sync?bookId=&since= 拉增量
				const sync = await fetchEbookThoughtSync(bookId, since);
				// applyEbookThoughtSync：本地 + 远端 → 合并后的 next
				//   返回 { next, hasChanges }；next === local 表示无变化
				const { next } = applyEbookThoughtSync(local, sync);

				// 仅当 next 真的变了才回写 state
				if (next !== local) {
					// 有新增/变更的 thought → 把它们的 cfiRange 临时 pin 起来
					// ephemeralPinThoughtCfis：让下一次 mark 渲染保留这些 cfiRange，
					//   避免「远端先返回 → mark 没渲染 → 用户看到下划线闪烁」
					if (sync.changes.length > 0) {
						ephemeralPinThoughtCfis(
							sync.changes.map((thought) => thought.cfiRange),
						);
					}
					// 把合并结果回写 React state
					setThoughts(next);
					// 通知外部（如重渲染 mark）
					onMergedRef.current?.();
				}
				// 记录本次同步时刻（节流用）
				lastSyncAtRef.current = Date.now();
				return next;
			} catch {
				// 任何异常（网络错、JSON 错）→ 返回当前 thoughts，不抛出（降级）
				return thoughtsRef.current;
			} finally {
				// 无论成功失败，清掉 inFlight，让下次 sync 能再发起
				inFlightRef.current = null;
			}
		};

		// 把 run() 的 Promise 存到 inFlightRef，并在它结束前所有调用都复用同一 Promise
		inFlightRef.current = run();
		return inFlightRef.current;
	},
	[bookId, enabled, setThoughts],
);
```

**配套：触发同步的两个外部入口（来源：同文件 · 约 L99–L126）**

`syncThoughts` 本身不直接挂到 React 事件上，外部通过两个 wrapper 触发：

```typescript
// 1. refreshThoughtsNow：强制同步（force: true 跳过节流）
//    用于「打开想法列表」「点击刷新按钮」等用户主动操作
const refreshThoughtsNow = useCallback(
	() => syncThoughts({ force: true }),
	[syncThoughts],
);

// 2. scheduleSync：滚动停稳后节流触发（不强制）
//    用于阅读过程中的「relocate → 停稳 2s → 拉一次增量」
const scheduleSync = useCallback(() => {
	if (!enabled) return;
	// 清掉上一次未触发的 timer，重新计时（防抖）
	if (relocTimerRef.current) clearTimeout(relocTimerRef.current);
	relocTimerRef.current = setTimeout(() => {
		relocTimerRef.current = null;
		// 不强制 → 受 5s 节流约束
		void syncThoughts();
	}, RELOC_DEBOUNCE_MS);
}, [enabled, syncThoughts]);

// 3. visibilitychange：从后台切回前台时立即同步一次
useEffect(() => {
	if (!enabled) return;
	const onVisibility = () => {
		if (document.visibilityState === "visible") {
			// 把 lastSyncAtRef 清零，让 syncThoughts 不被 5s 节流拦住
			lastSyncAtRef.current = 0;
			void syncThoughts();
		}
	};
	document.addEventListener("visibilitychange", onVisibility);
	return () => {
		document.removeEventListener("visibilitychange", onVisibility);
		if (relocTimerRef.current) clearTimeout(relocTimerRef.current);
	};
}, [enabled, syncThoughts]);
```

**读完应掌握**：

- `syncThoughts` 的三道守卫：未启用 → null；已有 inFlight → 复用 Promise；5s 内非强制 → 跳过。这三道保证「不会重复请求、不会刷屏后端」。
- `since = maxEbookThoughtUpdatedAt(local)` 是增量同步的核心：只拉本地最大 updatedAt 之后的变更，把全量同步降为增量。
- `applyEbookThoughtSync` 返回的 `next === local` 是「无变化」的判定——用引用相等而非深比较，零成本短路。
- `ephemeralPinThoughtCfis` 是关键的 UX 细节：远端新增的 cfiRange 在第一次 mark 渲染前可能被裁剪/合并逻辑误删，pin 住它一帧确保用户能看到下划线。
- `inFlightRef` + `finally: inFlightRef.current = null` 是 Promise 复用的标准写法——任何路径（成功/失败）都释放锁。
- 三种触发路径：用户主动（`refreshThoughtsNow` force）、滚动停稳（`scheduleSync` 节流）、切回前台（`visibilitychange` 清零 lastSyncAt 强制）。

---

## 19. 复用清单 — 在其他项目里复刻 EPUB 阅读器要带走什么

本节回答一个问题：「如果要在另一个 React 项目里复刻这套 EPUB 阅读器，最少要带走哪些文件？按什么顺序接？」。

### 19.1 必带文件分层（按依赖顺序）

复刻时按「基础设施 → epub.js 接线 → 单一功能 → 跨功能互斥 → UI 接线」的顺序往新项目搬。每一层都假定上一层已经就位。

| 层                  | 文件（仓库根相对路径）                                                          | 作用                                       | 依赖  |
| ------------------- | ------------------------------------------------------------------------------- | ------------------------------------------ | ----- |
| **L0 基础**         | `apps/frontend/src/utils/speech.ts`                                         | TTS 引擎封装（本地+云端优选、预取、句界）  | 无    |
| L0 基础             | `apps/frontend/src/views/ebook/types.ts`                                        | EbookThought / Book / PublicSource 等类型  | 无    |
| L0 基础             | `apps/frontend/src/service/ebook/*.ts`（含 thoughtSync）                        | 后端 API 客户端                            | types |
| **L1 epub.js 接线** | `apps/frontend/src/views/ebook/components/reader/EpubPane.tsx`                  | rendition 生命周期、iframe mount、resize   | L0    |
| L1 epub.js 接线     | `apps/frontend/src/views/ebook/utils/epub/reader/epubReaderSettings.ts`         | 阅读设置（字号/行距/主题）落 themes        | L1    |
| L1 epub.js 接线     | `apps/frontend/src/views/ebook/utils/epub/reader/epubSelectionToolbarAttach.ts` | iframe 内选区监听 + PopBar 触发            | L1    |
| **L2 划线**         | `apps/frontend/src/views/ebook/utils/epub/mark/epubUserHighlights.ts`           | 用户划线 highlight/underline/wavy 三态渲染 | L1    |
| L2 划线             | `apps/frontend/src/views/ebook/utils/epub/mark/epubMarkUtils.ts`（如有）        | CFI↔Range、marks-pane 通用工具             | L1    |
| **L3 想法**         | `apps/frontend/src/views/ebook/utils/epub/mark/epubThoughtAnnotations.ts`       | 想法下划线渲染 + ephemeral pin             | L2    |
| L3 想法             | `apps/frontend/src/views/ebook/utils/epub/mark/epubThoughtSync.ts`              | 想法合并算法、since 计算、max updatedAt    | L0    |
| L3 想法             | `apps/frontend/src/views/ebook/hooks/useEbookThoughtLoader.ts`                  | 想法 viewport 懒挂载                       | L3    |
| L3 想法             | `apps/frontend/src/views/ebook/hooks/usePublicEbookThoughtSync.ts`              | 公开想法增量同步                           | L3    |
| **L4 听书**         | `apps/frontend/src/views/ebook/utils/epub/listen/epubListenChapter.ts`          | 章节文本抽取 + 句级 Range 索引             | L1    |
| L4 听书             | `apps/frontend/src/views/ebook/utils/epub/listen/epubListenSegmentOverlay.ts`   | overlay 会话（plain + 高亮区块）           | L4    |
| L4 听书             | `apps/frontend/src/views/ebook/utils/epub/listen/epubScrollListenAdvance.ts`    | 连续滚动听书节间推进                       | L4    |
| L4 听书             | `apps/frontend/src/views/ebook/hooks/useEpubChapterListen.ts`                   | 整章听书状态机                             | L4    |
| L4 听书             | `apps/frontend/src/views/ebook/hooks/useEbookQuoteListen.ts`                    | 引用听书状态机                             | L4    |
| **L5 互斥**         | epubListenController（章节/引用 listen stop 注册）                              | 跨 hook 互斥                               | L4    |
| L5 互斥             | `registerChapterListenStop` / `registerQuoteListenStop` 注册对                  | 互斥回调                                   | L4    |
| **L6 UI 接线**      | `apps/frontend/src/views/ebook/components/reader/EpubReaderPage.tsx`            | 顶层页：把 rendition 分发给各 hook         | L1-L5 |
| L6 UI 接线          | 底部播放条组件、选区 PopBar 组件、想法列表组件                                  | 各功能的 UI 入口                           | L6    |

### 19.2 复刻顺序（M1–M8 对应章节）

按 §0.3 的 M1–M8 顺序复刻，每阶段独立验收后再进入下一阶段。这里给出每个 M 阶段在新项目里的「最小可运行验收」：

| 阶段 | 验收信号（新项目里跑通这条就算过）                                        |
| ---- | ------------------------------------------------------------------------- |
| M1   | epub.js 能渲染一本 .epub，翻页/目录跳转 OK                                |
| M2   | 用户选中一段文字，PopBar 出现，点击「划线」后刷新页面划线仍在             |
| M3   | 在划线上点击「写下想法」，输入并保存，下划线出现，刷新仍在                |
| M4   | 切换字号/行距/主题，iframe 内容立即跟随；刷新后设置保持                   |
| M5   | 点击章节「听读」按钮，从当前页开始逐句播放，底部播放条出现                |
| M6   | 选中一段文字点「听这句」，从该段第一句开始播放；与章节听读互斥            |
| M7   | 在共享上下文（publicSource）里打开书，2s 滚动停稳后看到他人想法下划线出现 |
| M8   | 横竖屏切换、缩放窗口，rendition 软重排不丢划线/想法/听书进度              |

### 19.3 不要带走的（项目耦合层）

以下文件是当前项目的耦合层，复刻时应该用新项目自己的等价物替换，**不要照搬**：

- `apps/frontend/src/service/ebook/*` 的具体 fetch 实现 —— 用新项目的 HTTP 客户端重写。
- `apps/frontend/src/utils/speech.ts` 里跟「云 TTS」鉴权相关的部分 —— 用新项目的 TTS 服务重写。
- `EpubReaderPage.tsx` 里的 i18n、路由、鉴权、布局组件 —— 全部替换为新项目的对应基础设施。
- 任何 `@design/*`、`@ui/*` 别名下的 UI 组件 —— 用新项目的 UI 库等价物替换。

### 19.4 复刻时的 7 个关键陷阱

1. **iframe selection 失效**：选区工具栏弹出会破坏 iframe 内 selection。**必须**在选区产生的瞬间冻结 `Range` 传给后续逻辑（参考 `useEbookQuoteListen.startPlayback` 的 `frozenRange`）。
2. **marks-pane 在 paginated 模式下的坐标**：marks-pane 用 SVG 画高亮，需要把 iframe 内坐标转成外层 viewer 坐标。**不要**用 `getBoundingClientRect` 直接画，必须走 epub.js 的 `rendition.annotations` 或自带的坐标转换。
3. **loopGen / registerStop 互斥不能省**：章节听书和引用听书如果不同时注册 stop 回调，会出现「同时播两段音频」。即使你只复刻其中一个，也要保留互斥注册的空位，方便后续扩展。
4. **CFI 跨 spine 不能直接拼接**：跨章节的 CFI range 必须带 spineIndex，单独的 cfiRange 字符串在不同 spine 下会指向错误位置。
5. **`since` 增量同步的边界**：`maxEbookThoughtUpdatedAt` 减 1ms 是为了防止「同一毫秒的更新被漏拉」。复刻 `ebookThoughtSyncSinceParam` 时要保留这个 -1ms。
6. **ResizeObserver + 软重排**：直接调 `rendition.resize()` 会让 marks-pane 闪烁。**必须**先用 `ResizeObserver` 检测容器尺寸，再用 `requestAnimationFrame` 合并多次 resize 为一次 `rendition.resize(...)`。
7. **visibilitychange 重置 lastSyncAt**：从后台切回前台时必须把 `lastSyncAtRef.current = 0`，否则 5s 节流会拦住用户「刚回来想看最新」的请求。

### 19.5 一行复刻口诀

> **基础设施先到位，epub.js 接线第二位，单一功能跑通再互斥，UI 接线最后才接入。**

按这个顺序，复刻一个 EPUB 阅读器最坏情况也只是「逐层换基础设施」，不会出现「整个功能跑不通」的死局。

---

## 文档结束

本手册覆盖了当前 EPUB 阅读器的全部核心功能：渲染生命周期、用户划线、读书想法、阅读设置、章节听读、引用听读、公开想法增量同步、跨功能互斥、性能与回归。

- 想看「某一功能怎么实现的」→ 跳到 §3–§14 对应模块节，再看 §18 对应源码符号。
- 想在新项目复刻 → 直接看 §19 复用清单 + §0.3 M1–M8 阶段表。
- 想排查 bug → 先看 §17 回归陷阱表，再看 §0.2 维护定位表。

任何行为断言均可在源码中找到依据；如本手册与源码不一致，以源码为准。
