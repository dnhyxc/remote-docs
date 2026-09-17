# EPUB mark 层公共 utils 抽取 — 实现说明

## 延伸阅读

- [developer/EPUB标注分层共享.md](./developer/EPUB标注分层共享.md) — 三层 mark 共用符号表（维护时以 shared + geometry 为权威）
- [../impact/EPUB标注共享提取影响.md](../impact/EPUB标注共享提取影响.md) — 影响点与回归清单
- [../ideas/EPUB标注分层.md](../ideas/epub/EPUB标注分层.md) — 三层架构规划

---

## 1. 背景与目标

### 1.1 问题

用户划线（`epubUserHighlights.ts`）、想法虚线（`epubThoughtAnnotations.ts`）、听书背景（`epubListenMarkHighlight.ts`）与几何内核（`epubRangeGeometry.ts`）中，以下 helper **在 2～3 个文件内重复实现**：

- `getRenditionContentsList` / `extractCfiSpineHint` / `isDomRangeStrictlyContained`
- `setSvgAttrIfChanged` / `parseSvgMarkRect`（解析逻辑）

重复拷贝导致：修一处 bug 易漏改它处；类型 `SvgLocalRect` 与 `SvgLineSegment` 语义相同却各写一份。

### 1.2 目标

- 新建 **`epubMarkShared.ts`** 作为 CFI / Range / SVG 横切 helper 的**单一来源**。
- **`epubRangeGeometry.ts`** 继续负责行盒与 CFI↔DOM；`parseSvgMarkRect` 与 marks-pane 查找 export 供各层复用。
- **行为零变更**：apply / patch / sync / show / clear 流水线不动；`tsc --noEmit` 通过。

---

## 2. 改动范围

| 路径 | 变更类型 |
|------|----------|
| `apps/frontend/src/views/ebook/utils/epubMarkShared.ts` | **新增** |
| `apps/frontend/src/views/ebook/utils/epubRangeGeometry.ts` | import shared；export `parseSvgMarkRect`、`findMarksPaneSvgFromGroup` |
| `apps/frontend/src/views/ebook/utils/epubUserHighlights.ts` | 删本地 duplicate helper，改 import |
| `apps/frontend/src/views/ebook/utils/epubThoughtAnnotations.ts` | 同上；`SvgLocalRect` → `SvgLineSegment` 别名 |
| `apps/frontend/src/views/ebook/utils/epubThoughtCluster.ts` | `extractCfiSpineHint` re-export |
| `apps/frontend/src/views/ebook/utils/epubListenMarkHighlight.ts` | `listListenDocuments` / marks-pane 查找走 shared |

**统计**：5 文件修改 + 1 新增，约 **−184 行重复**、**+83 行** 集中实现（`git diff --stat`）。

---

## 3. 实现思路

| # | 要点 | 理由 |
|---|------|------|
| 1 | **shared 不 import 业务模块** | 避免 userHighlights ↔ thoughtAnnotations 循环依赖 |
| 2 | **geometry 只 re-export `getRenditionContentsList`** | CFI 解析仍走 geometry；contents 遍历与 mark 层共用 |
| 3 | **`parseSvgMarkRect` 放在 geometry** | 与 `readMarkSvgLineSegmentsFromRects` 同域；想法层 re-export 保兼容 |
| 4 | **cluster 继续 export `extractCfiSpineHint`** | `read.tsx` 历史 import 路径不变 |
| 5 | **听书 `findMarksPaneSvgInDocument`** | 与 geometry 的 `findMarksPaneSvgFromGroup(group)` 分工：按 doc vs 按 group |

**依赖方向**：

```text
epubMarkShared  ← 仅 epubjs 类型
epubRangeGeometry ← epubMarkShared（contents 列表）
epubUserHighlights / epubThoughtAnnotations / epubListenMarkHighlight ← 两者
epubThoughtCluster ← epubMarkShared（spine hint）
```

---

## 4. 关键代码对比与注释

### 4.1 `getRenditionContentsList`（`epubUserHighlights.ts` → `epubMarkShared.ts`）

**对比范围**：`rend.getContents()` 归一化为数组；改前在用户划线文件内 **private**，改后在 shared **export**。

**改动前** · `apps/frontend/src/views/ebook/utils/epubUserHighlights.ts`（基线，约 L138–L146）

```typescript
// 将 epub.js Rendition 的 getContents 统一转为数组，供遍历 iframe 文档
function getRenditionContentsList(rend?: Rendition): EpubIframeContents[] {
	// 无 rendition 时无内容帧
	if (!rend) return [];
	// 读取 epub.js 原始返回值（单对象或数组）
	const raw = rend.getContents();
	// 已是数组则直接断言为内容列表
	return Array.isArray(raw)
		? (raw as EpubIframeContents[])
		: raw
			// 单帧包装为长度 1 的数组
			? [raw as EpubIframeContents]
			// 空则返回空数组
			: [];
}
```

**改动后** · `apps/frontend/src/views/ebook/utils/epubMarkShared.ts`（当前，约 L13–L24）

```typescript
// 将 epub.js Rendition 的 getContents 统一转为数组，供三层 mark 共用
export function getRenditionContentsList(
	rend?: Rendition,
): EpubIframeContents[] {
	// 无 rendition 时无内容帧
	if (!rend) return [];
	// 读取 epub.js 原始返回值（单对象或数组）
	const raw = rend.getContents();
	// 已是数组则直接断言为内容列表
	return Array.isArray(raw)
		? (raw as EpubIframeContents[])
		: raw
			// 单帧包装为长度 1 的数组
			? [raw as EpubIframeContents]
			// 空则返回空数组
			: [];
}
```

**变更摘要**：算法不变；由 **module private** 升为 **shared export**；`epubUserHighlights` / `epubThoughtAnnotations` / `epubRangeGeometry` 均改 import 此符号。

---

### 4.2 `extractCfiSpineHint`（三处拷贝 → shared）

**对比范围**：从 `epubcfi(...!...)` 提取 `!` 前 spine 路径。

**改动前** · `apps/frontend/src/views/ebook/utils/epubUserHighlights.ts`（基线，约 L912–L915）

```typescript
// 从 CFI 字符串截取 spine 段，用于同章嵌套判定
function extractCfiSpineHint(cfiRange: string): string {
	// 匹配 epubcfi( 与第一个 ! 之间的路径
	const match = cfiRange.match(/epubcfi\(([^!]+)!/);
	// 未匹配则回退原串，避免抛错
	return match?.[1] ?? cfiRange;
}
```

**改动后** · `apps/frontend/src/views/ebook/utils/epubMarkShared.ts`（当前，约 L37–L41）

```typescript
// 从 CFI 提取 spine 路径（`!` 之前），用于同章节嵌套判定
export function extractCfiSpineHint(cfiRange: string): string {
	// 匹配 epubcfi( 与第一个 ! 之间的路径
	const match = cfiRange.match(/epubcfi\(([^!]+)!/);
	// 未匹配则回退原串
	return match?.[1] ?? cfiRange;
}
```

**变更摘要**：正则与 fallback 与改前 **逐字相同**；`epubThoughtCluster.ts` 改为 `import { extractCfiSpineHint } from './epubMarkShared'` 并 `export { extractCfiSpineHint }` 供 `read.tsx` 沿用。

---

### 4.3 `isDomRangeStrictlyContained`（用户划线 + 想法虚线 → shared）

**对比范围**：DOM Range 严格包含判定（非完全重合）。

**改动前** · `apps/frontend/src/views/ebook/utils/epubThoughtAnnotations.ts`（基线，约 L820–L839）

```typescript
// 判断 inner Range 是否被 outer 严格包含
function isDomRangeStrictlyContained(inner: Range, outer: Range): boolean {
	try {
		// inner 起点不早于 outer 起点
		const startsAfterOrEqual =
			inner.compareBoundaryPoints(Range.START_TO_START, outer) >= 0;
		// inner 终点不晚于 outer 终点
		const endsBeforeOrEqual =
			inner.compareBoundaryPoints(Range.END_TO_END, outer) <= 0;
		// 越界则不被包含
		if (!startsAfterOrEqual || !endsBeforeOrEqual) return false;
		// 排除完全重合
		const sameStart =
			inner.compareBoundaryPoints(Range.START_TO_START, outer) === 0;
		const sameEnd = inner.compareBoundaryPoints(Range.END_TO_END, outer) === 0;
		return !(sameStart && sameEnd);
	} catch {
		// 跨文档或 detached Range
		return false;
	}
}
```

**改动后** · `apps/frontend/src/views/ebook/utils/epubMarkShared.ts`（当前，约 L52–L70）

```typescript
// inner Range 是否被 outer Range 严格包含（非完全重合）
export function isDomRangeStrictlyContained(
	inner: Range,
	outer: Range,
): boolean {
	try {
		// inner 起点不早于 outer 起点
		const startsAfterOrEqual =
			inner.compareBoundaryPoints(Range.START_TO_START, outer) >= 0;
		// inner 终点不晚于 outer 终点
		const endsBeforeOrEqual =
			inner.compareBoundaryPoints(Range.END_TO_END, outer) <= 0;
		// 越界则不被包含
		if (!startsAfterOrEqual || !endsBeforeOrEqual) return false;
		// 排除完全重合
		const sameStart =
			inner.compareBoundaryPoints(Range.START_TO_START, outer) === 0;
		const sameEnd = inner.compareBoundaryPoints(Range.END_TO_END, outer) === 0;
		return !(sameStart && sameEnd);
	} catch {
		// 跨文档或 detached Range
		return false;
	}
}
```

**变更摘要**：用户划线内 **同名 private 副本已删除**；`isHighlightCfiStrictlyContained` / `isThoughtCfiRangeStrictlyContained` 仍调用此逻辑，仅 import 源变化。

---

### 4.4 `parseSvgMarkRect`（想法层 → geometry + re-export）

**对比范围**：读 SVG `<rect>` 的 x/y/width/height；过小或 NaN 返回 null。

**改动前** · `apps/frontend/src/views/ebook/utils/epubThoughtAnnotations.ts`（基线，约 L144–L159）

```typescript
// 解析 marks-pane 内单个 rect 的局部坐标
export function parseSvgMarkRect(rect: SVGRectElement): SvgLocalRect | null {
	// 读取 x 属性为浮点数
	const x = Number.parseFloat(rect.getAttribute('x') ?? 'NaN');
	// 读取 y 属性
	const y = Number.parseFloat(rect.getAttribute('y') ?? 'NaN');
	// 读取 width
	const width = Number.parseFloat(rect.getAttribute('width') ?? 'NaN');
	// 读取 height
	const height = Number.parseFloat(rect.getAttribute('height') ?? 'NaN');
	// 任一非有限数则无效
	if (
		!Number.isFinite(x) ||
		!Number.isFinite(y) ||
		!Number.isFinite(width) ||
		!Number.isFinite(height)
	) {
		return null;
	}
	// 过小 rect 视为噪声
	if (width <= 0.5 || height <= 0.5) return null;
	return { x, y, width, height };
}
```

**改动后** · `apps/frontend/src/views/ebook/utils/epubRangeGeometry.ts`（当前，约 L395–L414）

```typescript
// 读单个 SVG rect 的局部坐标；非法或过小则 null
export function parseSvgMarkRect(
	rect: SVGRectElement,
): SvgLineSegment | null {
	// 读取 x 属性为浮点数
	const x = Number.parseFloat(rect.getAttribute('x') ?? 'NaN');
	// 读取 y 属性
	const y = Number.parseFloat(rect.getAttribute('y') ?? 'NaN');
	// 读取 width
	const width = Number.parseFloat(rect.getAttribute('width') ?? 'NaN');
	// 读取 height
	const height = Number.parseFloat(rect.getAttribute('height') ?? 'NaN');
	// 任一非有限数则无效
	if (
		!Number.isFinite(x) ||
		!Number.isFinite(y) ||
		!Number.isFinite(width) ||
		!Number.isFinite(height) ||
		width <= 0.5 ||
		height <= 0.5
	) {
		return null;
	}
	// 返回与 SvgLineSegment 同形的线段描述
	return { x, y, width, height };
}
```

**变更摘要**：阈值 **仍为 0.5**；返回类型由 `SvgLocalRect` 改为 `SvgLineSegment`（字段集相同）。想法层：

```typescript
export type SvgLocalRect = SvgLineSegment;
export { parseSvgMarkRect };
```

---

### 4.5 `readMarkSvgLineSegmentsFromRects`（geometry 内部去重）

**对比范围**：从 `g` 下所有 `rect` 收集线段；改后委托 `parseSvgMarkRect`。

**改动前** · `apps/frontend/src/views/ebook/utils/epubRangeGeometry.ts`（基线，约 L448–L471）

```typescript
export function readMarkSvgLineSegmentsFromRects(
	group: Element,
): SvgLineSegment[] {
	const segments: SvgLineSegment[] = [];
	for (const node of group.querySelectorAll('rect')) {
		if (!(node instanceof SVGRectElement)) continue;
		const x = Number.parseFloat(node.getAttribute('x') ?? 'NaN');
		const y = Number.parseFloat(node.getAttribute('y') ?? 'NaN');
		const width = Number.parseFloat(node.getAttribute('width') ?? 'NaN');
		const height = Number.parseFloat(node.getAttribute('height') ?? 'NaN');
		if (
			!Number.isFinite(x) ||
			!Number.isFinite(y) ||
			!Number.isFinite(width) ||
			!Number.isFinite(height) ||
			width <= 0.5 ||
			height <= 0.5
		) {
			continue;
		}
		segments.push({ x, y, width, height });
	}
	return segments;
}
```

**改动后** · `apps/frontend/src/views/ebook/utils/epubRangeGeometry.ts`（当前，约 L461–L471）

```typescript
export function readMarkSvgLineSegmentsFromRects(
	group: Element,
): SvgLineSegment[] {
	const segments: SvgLineSegment[] = [];
	for (const node of group.querySelectorAll('rect')) {
		if (!(node instanceof SVGRectElement)) continue;
		// 与想法 patch、用户划线 blocker 共用解析规则
		const parsed = parseSvgMarkRect(node);
		if (parsed) segments.push(parsed);
	}
	return segments;
}
```

**变更摘要**：循环体 **DRY**；过滤规则与改前 inline 逻辑等价。

---

### 4.6 `findMarksPaneSvgInDocument`（听书层）

**对比范围**：按 Document 查找 `.marks-pane svg`。

**改动前** · `apps/frontend/src/views/ebook/utils/epubListenMarkHighlight.ts`（基线，约 L219–L225）

```typescript
// 在指定 document 内查找 marks-pane 下的 SVG 根
function findMarksPaneSvg(doc: Document): SVGSVGElement | null {
	for (const pane of doc.querySelectorAll('.marks-pane')) {
		const svg = pane.querySelector('svg');
		if (svg instanceof SVGSVGElement) return svg;
	}
	return null;
}
```

**改动后** · `apps/frontend/src/views/ebook/utils/epubMarkShared.ts`（当前，约 L102–L111）

```typescript
// 文档内 marks-pane 下的 SVG（听书层 ensure group 用）
export function findMarksPaneSvgInDocument(
	doc: Document,
): SVGSVGElement | null {
	for (const pane of doc.querySelectorAll('.marks-pane')) {
		const svg = pane.querySelector('svg');
		if (svg instanceof SVGSVGElement) return svg;
	}
	return null;
}
```

**变更摘要**：仅 **重命名 export**（`findMarksPaneSvg` → `findMarksPaneSvgInDocument`），与 geometry 的 `findMarksPaneSvgFromGroup` 区分语义。

---

### 4.7 `setSvgAttrIfChanged`（三处 → shared）

**对比范围**：patch 热路径仅在属性变化时 `setAttribute`。

**改动前** · `apps/frontend/src/views/ebook/utils/epubUserHighlights.ts`（基线，约 L332–L336）

```typescript
// 避免重复 setAttribute 触发多余 layout
function setSvgAttrIfChanged(el: Element, name: string, value: string): void {
	if (el.getAttribute(name) !== value) {
		el.setAttribute(name, value);
	}
}
```

**改动后** · `apps/frontend/src/views/ebook/utils/epubMarkShared.ts`（当前，约 L26–L35）

```typescript
// 仅在属性变化时写入，减少 patch 热路径 DOM 抖动
export function setSvgAttrIfChanged(
	el: Element,
	name: string,
	value: string,
): void {
	if (el.getAttribute(name) !== value) {
		el.setAttribute(name, value);
	}
}
```

**变更摘要**：用户划线、想法虚线、听书背景 **统一 import**；听书层原 `setSvgAttr` 本地函数已删。

---

## 5. 兼容性与影响

| 项 | 结论 |
|----|------|
| 对外 API 签名 | **不变**（除新增 export 名） |
| `read.tsx` import | **不变**（仍从 `epubThoughtCluster` 取 `extractCfiSpineHint`） |
| 用户可感知行为 | **无**（纯重构） |
| TypeScript | `apps/frontend` `tsc --noEmit` **通过** |

详细影响矩阵见 [Influence-point 专题](../impact/EPUB标注共享提取影响.md)。

---

## 6. 维护约定

| 新增 helper 类型 | 落盘位置 |
|------------------|----------|
| CFI spine / Range 嵌套·相交 / SVG attr / 按 doc 找 marks-pane | `epubMarkShared.ts` |
| 行盒、CFI↔Range、按 group 找 marks-pane、parse rect | `epubRangeGeometry.ts` |
| 用户划线业务 | `epubUserHighlights.ts` |
| 想法虚线业务 | `epubThoughtAnnotations.ts` |

**禁止** 在第四处再拷贝上述 helper。

---

## 7. 相关源码路径

| 说明 | 路径 |
|------|------|
| 公共 mark helper（本轮新增） | `apps/frontend/src/views/ebook/utils/epubMarkShared.ts` |
| 几何与 CFI 内核 | `apps/frontend/src/views/ebook/utils/epubRangeGeometry.ts` |
| 用户划线 | `apps/frontend/src/views/ebook/utils/epubUserHighlights.ts` |
| 想法虚线 | `apps/frontend/src/views/ebook/utils/epubThoughtAnnotations.ts` |
| 想法 cluster / spine re-export | `apps/frontend/src/views/ebook/utils/epubThoughtCluster.ts` |
| 听书播放背景 | `apps/frontend/src/views/ebook/utils/epubListenMarkHighlight.ts` |
| 影响点分析 | `docs/impact/EPUB标注共享提取影响.md` |

---

（若与仓库最新源码不一致，以源码为准）
