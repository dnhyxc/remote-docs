# EPUB mark 层公共 utils 抽取 — 影响点分析

## 延伸阅读

- [EPUB听书背景与注释影响.md](./EPUB听书背景与注释影响.md) — 三层 mark（用户 / 想法 / 听书）职责隔离
- [EPUB标注分层共享.md](../ebook/developer/EPUB标注分层共享.md) — 共用符号与 patch 热路径（若已存在）
- [../ideas/EPUB标注分层.md](../ideas/epub/EPUB标注分层.md) — 三层架构总览

## 1. 分析目的

评估 **`apps/frontend/src/views/ebook/utils` 公共方法抽取** 是否改变或破坏已有功能：

- **用户划线**（`moke-epub-user-hl`）
- **想法虚线**（`moke-epub-thought-ul`）
- **听书 / 听当前播放背景**（`moke-epub-listen-bg`）
- **CFI 嵌套判定**、**marks-pane SVG 几何**、**epub.js getContents 遍历**

**改动性质**：**纯重构** — 删除多文件内重复实现，逻辑 **原样搬迁** 至单一来源；**未改** apply / patch / sync / show / clear 业务流水线。

**结论摘要**：

| 维度 | 是否影响原有功能 | 说明 |
|------|------------------|------|
| 运行时行为 | **否** | 各 helper 算法与改前逐字等价；`tsc --noEmit` 通过 |
| 对外 export 符号名 | **否** | 仍可从原模块 import；新增 `epubMarkShared` 为内部聚合点 |
| `extractCfiSpineHint` | **否** | `epubThoughtCluster` 仍 export；`read.tsx` import 路径不变 |
| `parseSvgMarkRect` / `SvgLocalRect` | **否** | 实现迁至 `epubRangeGeometry`；想法层 re-export；阈值仍为 `0.5` |
| 听书 `listListenDocuments` | **否** | 改调 `getRenditionContentsList`，与改前 `getContents` 归一化一致 |
| 嵌套划线 / 想法 cluster | **否** | `isDomRangeStrictlyContained` 等改从 shared 引入，判定式不变 |
| 维护风险（正向） | **降低** | 三处拷贝合并后，后续修 bug 只需改一处 |

---

## 2. 改动范围

### 2.1 新增文件

| 文件 | 职责 |
|------|------|
| **`epubMarkShared.ts`** | CFI spine hint、Range 嵌套/相交、SVG 属性写入、marks-pane 按文档查找、`getRenditionContentsList` |

### 2.2 修改文件（逻辑未变，仅 import / 删重复）

| 文件 | 变更要点 |
|------|----------|
| `epubRangeGeometry.ts` | `getRenditionContentsList` 改从 shared 引入并 re-export；新增 export `parseSvgMarkRect`、`findMarksPaneSvgFromGroup`、`findMarksPaneContainer`；`readMarkSvgLineSegmentsFromRects` 内部改调 `parseSvgMarkRect` |
| `epubUserHighlights.ts` | 删除本地 `extractCfiSpineHint`、`isQuoteStrictlyNested`、`isDomRange*`、`setSvgAttrIfChanged`、`getRenditionContentsList`；改 import shared |
| `epubThoughtAnnotations.ts` | 同上；`SvgLocalRect` 改为 `SvgLineSegment` 类型别名 |
| `epubThoughtCluster.ts` | `extractCfiSpineHint` 改从 shared import + re-export |
| `epubListenMarkHighlight.ts` | `listListenDocuments` 改调 shared；`findMarksPaneSvg` 改调 `findMarksPaneSvgInDocument`；SVG 写入改调 `setSvgAttrIfChanged` |

### 2.3 依赖方向（无环）

```text
epubMarkShared.ts          ← 仅依赖 epubjs 类型
epubRangeGeometry.ts       ← shared（getRenditionContentsList）+ epubjs
epubUserHighlights.ts      ← rangeGeometry + markShared + thoughtAnnotations + …
epubThoughtAnnotations.ts  ← rangeGeometry + markShared
epubThoughtCluster.ts      ← rangeGeometry + markShared + thoughtAnnotations
epubListenMarkHighlight.ts ← rangeGeometry + markShared
```

---

## 3. 符号搬迁对照表

| 符号 | 改前位置（重复份数） | 改后唯一定义 |
|------|----------------------|--------------|
| `getRenditionContentsList` | rangeGeometry、userHighlights、thoughtAnnotations（3） | **`epubMarkShared.ts`**；geometry re-export |
| `setSvgAttrIfChanged` | userHighlights、thoughtAnnotations、listenMarkHighlight（3） | **`epubMarkShared.ts`** |
| `extractCfiSpineHint` | userHighlights、thoughtAnnotations、thoughtCluster（3） | **`epubMarkShared.ts`**；cluster re-export |
| `isQuoteStrictlyNested` | userHighlights、thoughtAnnotations（2） | **`epubMarkShared.ts`** |
| `isDomRangeStrictlyContained` | userHighlights、thoughtAnnotations（2） | **`epubMarkShared.ts`** |
| `isDomRangeOverlapping` | userHighlights（1，仅本地） | **`epubMarkShared.ts`** |
| `isDomRangeTouchingOrOverlapping` | userHighlights（1） | **`epubMarkShared.ts`** |
| `findMarksPaneSvgInDocument` | listenMarkHighlight 内 `findMarksPaneSvg` | **`epubMarkShared.ts`** |
| `parseSvgMarkRect` | thoughtAnnotations（export） | **`epubRangeGeometry.ts`**；thoughtAnnotations re-export |
| `findMarksPaneSvgFromGroup` | rangeGeometry 内 private `findMarksPaneSvg` | **`epubRangeGeometry.ts`**（export） |
| `findMarksPaneContainer` | rangeGeometry 内 private | **`epubRangeGeometry.ts`**（export） |

---

## 4. 按功能域的影响点

### 4.1 用户划线（`epubUserHighlights.ts`）

| 能力 | 影响 | 说明 |
|------|------|------|
| `applyEpubUserHighlights` / patch | **无** | 仍走 `resolveMarkSvgLineSegments` + 本地 patch 循环 |
| 嵌套划线可见性 `computeVisibleHighlightCfis` | **无** | 仍调 `isHighlightCfiStrictlyContained` → shared 的 Range/quote 判定 |
| 重叠合并 `resolveMergedOverlappingHighlight` | **无** | `doDomRangesOverlapForMerge/Selection` 仍本地；底层 `isDomRangeTouchingOrOverlapping` 等价 |
| SVG patch `setSvgAttrIfChanged` | **无** | 行为与改前相同（仅属性变化时 `setAttribute`） |
| `syncEpubReadingAnnotations` 编排 | **无** | 未改调用顺序 |

### 4.2 想法虚线（`epubThoughtAnnotations.ts`）

| 能力 | 影响 | 说明 |
|------|------|------|
| `applyEpubThoughtUnderlines` | **无** | CFI apply 路径未动 |
| `isThoughtCfiRangeStrictlyContained` | **无** | 仍：DOM Range 优先 → quote 子串 → spine hint 同章 |
| `patchEpubThoughtUnderlineMarks` / blocker 扣减 | **无** | `parseSvgMarkRect` 阈值与字段解析与改前一致 |
| `restackThoughtMarkGroups` | **无** | 仅 `getRenditionContentsList` 来源变化 |
| `SvgLocalRect` 类型 | **无（结构等价）** | `{ x, y, width, height }` 与 `SvgLineSegment` 同形 |

### 4.3 想法 cluster（`epubThoughtCluster.ts`）

| 能力 | 影响 | 说明 |
|------|------|------|
| `buildThoughtClickCluster` / 连通图 | **无** | `extractCfiSpineHint` 正则与改前相同 |
| `read.tsx` 侧栏过滤 | **无** | 仍 `import { extractCfiSpineHint } from './utils/epubThoughtCluster'` |

### 4.4 听书播放背景（`epubListenMarkHighlight.ts`）

| 能力 | 影响 | 说明 |
|------|------|------|
| `showListenMarkHighlight` / `clearListenMarkHighlight` | **无** | 绘制/清除 selector 未改 |
| `listenRangeToSvgSegments` | **无** | 仍 `normalizeSelectionRangeForEpub` + `listenLineRects`；仅 marks-pane 查找改调 export |
| `listListenDocuments` | **无** | 与改前一样遍历 `rend.getContents()` 的 `document` |
| iframe 兜底 `paintIframeOverlay` | **无** | 未触及 |

### 4.5 几何内核（`epubRangeGeometry.ts`）

| 能力 | 影响 | 说明 |
|------|------|------|
| `resolveDomRangeSvgLineSegments` | **无** | 仍 normalize → find svg/container → line rects |
| `readMarkSvgLineSegmentsFromRects` | **无** | 改调 `parseSvgMarkRect`，过滤规则不变 |
| `resolveCfiDomRange` / CFI 缓存 | **无** | 未改 |
| `cfiFromDomRange` | **无** | 仍遍历 contents；`EpubIframeContents` 形状不变 |

---

## 5. 潜在风险点（理论 vs 实测）

| 风险 | 等级 | 分析 |
|------|------|------|
| 三处 `extractCfiSpineHint` 曾微差（注释/空行） | **低** | 正则均为 `/epubcfi\(([^!]+)!/`，fallback 均为原字符串 |
| `parseSvgMarkRect` 与 `readMarkSvgLineSegmentsFromRects` 阈值不一致 | **无** | 均已统一为 `width/height <= 0.5` 丢弃 |
| `SvgLocalRect` 改 alias 导致 TS 结构类型不兼容 | **无** | 字段集相同；`tsc` 已通过 |
| 新增 `epubMarkShared` 循环依赖 | **无** | shared 不 import rangeGeometry / 业务模块 |
| 外部直接 import 已删 private 函数 | **无** | 原 `findMarksPaneSvg` 等为 module private，无对外引用 |

---

## 6. 未改动项（刻意保留在原文件）

| 项 | 位置 | 原因 |
|----|------|------|
| `listenLineRects` 听书 caret 对齐 | `epubListenMarkHighlight.ts` | 与用户划线行盒策略不同 |
| `buildHighlightRenderPlan` / `syncEpubReadingAnnotations` | `epubUserHighlights.ts` | 业务编排 |
| `isThoughtCfiRangeStrictlyContained` 对外 API | `epubThoughtAnnotations.ts` | 想法 apply 专用入口 |
| `coalesceOverlappingHighlightsForRender` 等 | 各业务文件 | 非三处重复 |

---

## 7. 调用方 import 指南（维护用）

| 需求 | 推荐 import 来源 |
|------|------------------|
| CFI spine / Range 嵌套 / SVG attr | `epubMarkShared.ts` |
| 行盒、CFI↔Range、marks-pane 线段 | `epubRangeGeometry.ts` |
| 用户划线业务 API | `epubUserHighlights.ts` |
| 想法虚线业务 API | `epubThoughtAnnotations.ts` |
| 仅 spine hint（历史路径） | `epubThoughtCluster.ts`（re-export）或 `epubMarkShared.ts` |

**不建议** 在新代码中再拷贝上述 helper 到第四处；应扩展 shared / geometry。

---

## 8. 回归清单

- [ ] 用户划线：五色 / 高亮·直线·波浪；嵌套选区仅外层可见
- [ ] 想法虚线：同 CFI 多条；被用户线 blocker 扣减后仍可点
- [ ] 听当前 / 听书：句背景换句清除；停止后用户/想法 mark 完整
- [ ] `read.tsx`：想法侧栏按 spine hint 过滤章节
- [ ] 想法 cluster 点击：短 CFI 嵌套长 CFI 聚合正确
- [ ] 分栏 resize 后三层 mark 仍对齐（依赖 geometry，非本次改动）
- [ ] `npx tsc --noEmit`（apps/frontend）通过

---

## 9. 相关文档滞后

| 文档 | 说明 |
|------|------|
| `docs/ebook/developer/EPUB标注分层共享.md` | 若仍写「各文件内 private helper」，可补充 `epubMarkShared.ts` 为权威来源 |
| `docs/ideas/EPUB标注分层.md` | 架构图可标注 shared 层（可选） |

---

（若与仓库最新源码不一致，以源码为准）
