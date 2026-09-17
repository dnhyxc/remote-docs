# EPUB 想法虚线与用户划线叠加修复

## 文档角色

**增量专题**：修复段落内句子级「写想法」后琥珀虚线不显示、用户下划线误扣非重叠虚线、以及用户划线无法盖住重叠虚线等问题。

**延伸阅读**：[EPUB想法下划线实现.md](./EPUB想法下划线实现.md)（想法虚线主文档）、[EPUB用户划线实现.md](./EPUB用户划线实现.md)（用户划线与 blocker）、[EPUB想法部分重叠.md](./EPUB想法部分重叠.md)（想法间 patch 去重）。

---

## 1. 背景与目标

### 1.1 用户可见问题

1. **段落内句子写想法无虚线**：在长段落（如「二、哥伦布发现美洲」下正文）仅选中句内一句写想法，想法可保存但**琥珀虚线不出现**；若选区连同上一段标题则正常。
2. **用户下划线误扣虚线**：同段已有用户**直线下划线**时，会把**未重叠**的想法虚线也扣掉；背景高亮、波浪线无此问题。
3. **重叠处用户线盖不住虚线**：去掉 apply 层整段 suppress 后，需保证重叠水平区间仍由用户 stroke 视觉上盖住想法虚线。

### 1.2 目标

- 每条想法 CFI 在 apply 层**始终**绘制可见虚线（`showLine=true`）；嵌套/部分重叠、与用户划线重叠均在 **patch 层**处理。
- 用户划线 **DOM 叠放**在想法 mark 之上；patch 用 **rect（+ 波浪 path）** 水平扣减重叠段，**不读** epub.js 遗留 `<line>`（下划线类型过宽会误扣）。
- 保存想法前 **CFI/quote 归一化**，与用户划线 upsert 路径一致，避免长段落边界 CFI 漂移。

---

## 2. 改动范围

| 路径 | 说明 |
|------|------|
| `apps/frontend/src/views/ebook/utils/epubThoughtAnnotations.ts` | 删除 `computeLineVisibleCfis`；`applyEpubThoughtUnderlines` 去掉 `suppressedLineCfis`；绘制顺序改为短选区先画 |
| `apps/frontend/src/views/ebook/utils/epubUserHighlights.ts` | 删除 suppress 链路；新增 `restackUserHighlightMarkGroups`；`collectUserHighlightBlockerSources` 按样式收集 blocker |
| `apps/frontend/src/views/ebook/read.tsx` | `saveThought` 保存前 CFI/quote 归一化 |

---

## 3. 实现思路

### 3.1 根因

| 层级 | 旧行为 | 问题 |
|------|--------|------|
| **apply** | `computeLineVisibleCfis` 内层 `showLine=0` + `getThoughtCfisSuppressedByHighlights` 整段 suppress | 严格嵌套或「被用户划线完全覆盖」时整段不画线 → 段落内句子级想法在「外层 mark 存在」时常无可见虚线 |
| **patch 绘制顺序** | 较长选区先画 | 短句虚线被长段 blocker 扣光 |
| **blocker 来源** | 用户下划线若读 epub.js `<line>` | line bbox 常比 patch 后 rect 更宽 → 误扣相邻未重叠想法虚线 |

### 3.2 新策略（三层分工）

1. **apply**：每条想法 `showLine=true`，统一 `EPUB_THOUGHT_UNDERLINE_STYLES`。
2. **patch 想法间**：`compareThoughtMarksForLineDrawOrder` **短 span 先画**；较长选区后画并向 `thoughtBlockers` 贡献已画线段（延续 [EPUB想法部分重叠.md](./EPUB想法部分重叠.md)）。
3. **patch 与用户划线**：`collectUserHighlightBlockerSources` 注入 `userHighlightBlockerSources` 扣水平重叠；`restackUserHighlightMarkGroups` 把用户 mark  append 到 marks-pane 末尾，重叠处由用户 stroke 盖住。
4. **blocker 几何**：下划线/背景高亮**仅 rect**；波浪线额外用 `path` 的 `getBBox()`。

### 3.3 权衡

- **不再**在 apply 层因用户划线「完全覆盖」而 `showLine=false`：避免 suppress 判定与 DOM 不同步导致整段虚线消失；视觉隐藏交给 patch 扣段 + restack。
- **保留** `isThoughtCfiCoveredByUserHighlight` 等工具供 PopBar/侧栏覆盖度判定，仅删除 `getThoughtCfisSuppressedByHighlights` 渲染链路。

---

## 4. 关键代码对比与注释

### 4.1 `applyEpubThoughtUnderlines`（`apps/frontend/src/views/ebook/utils/epubThoughtAnnotations.ts`）

**对比范围**：`export function applyEpubThoughtUnderlines` 全函数（摘录：删除 `computeLineVisibleCfis` 调用与 suppress 参数）。

**改动前** · `apps/frontend/src/views/ebook/utils/epubThoughtAnnotations.ts`（基线 HEAD，约 L1029–L1084）

```typescript
// 导出：同步 EPUB 想法下划线批注（thoughts 变化时由 sync 调用）
export function applyEpubThoughtUnderlines(
	// epub.js Rendition，负责 annotations API
	rend: Rendition,
	// 当前书籍全部读书想法记录
	thoughts: EbookThought[],
	// 外部 Map：cfiRange → 签名，用于增量跳过与清理
	appliedRef: Map<string, string>,
	// 被用户划线完全盖住、apply 层应隐藏虚线的 CFI 集合（默认空）
	suppressedLineCfis: Set<string> = new Set(),
): void {
	// 注入想法虚线 CSS；失败则整段 sync 放弃
	try {
		ensureThoughtUnderlineStyles();
	} catch {
		return;
	}

	// 按 cfiRange 分组想法
	const grouped = groupThoughtsByCfi(thoughts);
	// 本次应存在的全部 CFI 键
	const nextCfis = new Set(grouped.keys());

	// 清理已删除 CFI 对应的旧 mark
	for (const cfiRange of [...appliedRef.keys()]) {
		if (!nextCfis.has(cfiRange)) {
			try {
				rend.annotations.remove(cfiRange, 'underline');
			} catch {
				// ignore
			}
			appliedRef.delete(cfiRange);
		}
	}

	// CFI 排序后依次 apply
	const sortedEntries = sortCfiGroupsForUnderlineStack([...grouped.entries()]);
	// 计算严格嵌套下「仅外层画可见线」的 CFI 集合
	const lineVisibleCfis = computeLineVisibleCfis(sortedEntries, rend);

	for (const [cfiRange, group] of sortedEntries) {
		const thoughtIds = group.map((t) => t.id);
		// 既要在嵌套可见集内，又未被用户划线 suppress
		const showLine =
			lineVisibleCfis.has(cfiRange) && !suppressedLineCfis.has(cfiRange);
		const nextSig = buildThoughtUnderlineSignature(thoughtIds, showLine);
		if (appliedRef.get(cfiRange) === nextSig) continue;

		try {
			rend.annotations.remove(cfiRange, 'underline');
			rend.annotations.underline(
				cfiRange,
				{
					thoughtIds,
					[THOUGHT_MARK_DATA_SHOW_LINE]: showLine ? '1' : '0',
				},
				undefined,
				EPUB_THOUGHT_UNDERLINE_CLASS,
				showLine
					? EPUB_THOUGHT_UNDERLINE_STYLES
					: EPUB_THOUGHT_UNDERLINE_HIT_STYLES,
			);
			appliedRef.set(cfiRange, nextSig);
		} catch {
			appliedRef.delete(cfiRange);
		}
	}
}
```

**改动后** · `apps/frontend/src/views/ebook/utils/epubThoughtAnnotations.ts`（当前，约 L959–L1009）

```typescript
// 导出：同步 EPUB 想法下划线批注（thoughts 变化时由 sync 调用）
export function applyEpubThoughtUnderlines(
	// epub.js Rendition，负责 annotations API
	rend: Rendition,
	// 当前书籍全部读书想法记录
	thoughts: EbookThought[],
	// 外部 Map：cfiRange → 签名，用于增量跳过与清理
	appliedRef: Map<string, string>,
): void {
	// 注入想法虚线 CSS；失败则整段 sync 放弃
	try {
		ensureThoughtUnderlineStyles();
	} catch {
		return;
	}

	// 按 cfiRange 分组想法
	const grouped = groupThoughtsByCfi(thoughts);
	// 本次应存在的全部 CFI 键
	const nextCfis = new Set(grouped.keys());

	// 清理已删除 CFI 对应的旧 mark
	for (const cfiRange of [...appliedRef.keys()]) {
		if (!nextCfis.has(cfiRange)) {
			try {
				rend.annotations.remove(cfiRange, 'underline');
			} catch {
				// ignore
			}
			appliedRef.delete(cfiRange);
		}
	}

	// CFI 排序后依次 apply（不再计算 lineVisibleCfis）
	const sortedEntries = sortCfiGroupsForUnderlineStack([...grouped.entries()]);

	for (const [cfiRange, group] of sortedEntries) {
		const thoughtIds = group.map((t) => t.id);
		// apply 层始终画可见虚线；嵌套/重叠/用户划线由 patch 处理
		const showLine = true;
		const nextSig = buildThoughtUnderlineSignature(thoughtIds, showLine);
		if (appliedRef.get(cfiRange) === nextSig) continue;

		try {
			rend.annotations.remove(cfiRange, 'underline');
			rend.annotations.underline(
				cfiRange,
				{
					thoughtIds,
					[THOUGHT_MARK_DATA_SHOW_LINE]: showLine ? '1' : '0',
				},
				undefined,
				EPUB_THOUGHT_UNDERLINE_CLASS,
				EPUB_THOUGHT_UNDERLINE_STYLES,
			);
			appliedRef.set(cfiRange, nextSig);
		} catch {
			appliedRef.delete(cfiRange);
		}
	}
}
```

**变更摘要**：删除 `suppressedLineCfis` 参数与 `computeLineVisibleCfis`；每条 mark 恒用可见样式 apply，去重与用户遮挡移至 patch。

---

### 4.2 `compareThoughtMarksForLineDrawOrder`（`apps/frontend/src/views/ebook/utils/epubThoughtAnnotations.ts`）

**对比范围**：排序比较函数全函数。

**改动前** · `apps/frontend/src/views/ebook/utils/epubThoughtAnnotations.ts`（基线 HEAD，约 L480–L491）

```typescript
// patch 阶段决定想法虚线段绘制先后顺序的比较器
function compareThoughtMarksForLineDrawOrder(
	// 左侧待比较 mark 的 prepared 元数据
	left: PreparedThoughtMark,
	// 右侧待比较 mark 的 prepared 元数据
	right: PreparedThoughtMark,
): number {
	// 双方都不画线时视为相等
	if (!left.showLine && !right.showLine) return 0;
	// 左不画线则排后
	if (!left.showLine) return 1;
	// 右不画线则左排前
	if (!right.showLine) return -1;
	// 旧策略：较长选区（span 大）先画，占据重叠区间
	const spanDiff = right.span - left.span;
	if (spanDiff !== 0) return spanDiff;
	// span 相同时 CFI 字符串较短者先画
	return left.cfi.length - right.cfi.length;
}
```

**改动后** · `apps/frontend/src/views/ebook/utils/epubThoughtAnnotations.ts`（当前，约 L461–L472）

```typescript
// patch 阶段决定想法虚线段绘制先后顺序的比较器
function compareThoughtMarksForLineDrawOrder(
	// 左侧待比较 mark 的 prepared 元数据
	left: PreparedThoughtMark,
	// 右侧待比较 mark 的 prepared 元数据
	right: PreparedThoughtMark,
): number {
	// 双方都不画线时视为相等
	if (!left.showLine && !right.showLine) return 0;
	// 左不画线则排后
	if (!left.showLine) return 1;
	// 右不画线则左排前
	if (!right.showLine) return -1;
	// ponytail: 较短选区先画线，较长选区后画并向 thoughtBlockers 扣减重叠
	const spanDiff = left.span - right.span;
	if (spanDiff !== 0) return spanDiff;
	// span 相同时 CFI 字符串较长者后画（稳定 tie-break）
	return right.cfi.length - left.cfi.length;
}
```

**变更摘要**：绘制顺序反转——短选区先占线，长选区 patch 时扣减已画区间，避免句子级虚线被整段盖住。

---

### 4.3 `syncEpubReadingAnnotations`（`apps/frontend/src/views/ebook/utils/epubUserHighlights.ts`）

**对比范围**：统一批注 sync 入口全函数。

**改动前** · `apps/frontend/src/views/ebook/utils/epubUserHighlights.ts`（基线 HEAD，约 L2201–L2237）

```typescript
// 导出：thoughts + highlights 变化时的统一 sync 入口
export function syncEpubReadingAnnotations(
	rend: Rendition,
	thoughts: EbookThought[],
	highlights: EbookUserHighlight[],
	appliedThoughtsRef: Map<string, string>,
	appliedHighlightsRef: Map<string, string>,
): void {
	// 进入 sync 互斥域，避免嵌套 sync 重入
	beginEpubAnnotationSyncScope();
	try {
		// patch 前清空用户 blocker，避免用到上一轮 DOM
		setUserHighlightBlockerSourcesForThoughtPatch([]);
		// 构建用户划线合并/可见性计划
		const highlightPlan = buildHighlightRenderPlan(rend, highlights);
		// 先 apply 用户划线 mark
		applyEpubUserHighlights(
			rend,
			highlights,
			appliedHighlightsRef,
			highlightPlan,
		);
		// 仅对 coalesce 后仍可见的用户划线做 suppress 判定
		const visibleHighlights = highlightPlan.coalesced.filter((item) =>
			highlightPlan.visibleCfis.has(item.cfiRange),
		);
		// 计算被用户划线完全盖住、应 hide 虚线的想法 CFI
		const suppressed = getThoughtCfisSuppressedByHighlights(
			thoughts,
			visibleHighlights,
			rend,
		);
		// suppress 状态变化时失效 appliedThoughtsRef 对应项以强制 re-apply
		invalidateThoughtMarksWithChangedSuppression(
			suppressed,
			appliedThoughtsRef,
		);
		// apply 想法虚线并传入 suppress 集合
		applyEpubThoughtUnderlines(rend, thoughts, appliedThoughtsRef, suppressed);
		// 收集用户划线 SVG rect 供想法 patch 扣减
		setUserHighlightBlockerSourcesForThoughtPatch(
			collectUserHighlightBlockerSources(rend),
		);
		// 用户主动保存/划线后同步 patch，避免 rAF 双帧等待且立刻可见
		runEpubReadingAnnotationPatch(rend);
	} finally {
		endEpubAnnotationSyncScope();
	}
}
```

**改动后** · `apps/frontend/src/views/ebook/utils/epubUserHighlights.ts`（当前，约 L2201–L2226）

```typescript
// 导出：thoughts + highlights 变化时的统一 sync 入口
export function syncEpubReadingAnnotations(
	rend: Rendition,
	thoughts: EbookThought[],
	highlights: EbookUserHighlight[],
	appliedThoughtsRef: Map<string, string>,
	appliedHighlightsRef: Map<string, string>,
): void {
	// 进入 sync 互斥域，避免嵌套 sync 重入
	beginEpubAnnotationSyncScope();
	try {
		// patch 前清空用户 blocker，避免用到上一轮 DOM
		setUserHighlightBlockerSourcesForThoughtPatch([]);
		// 构建用户划线合并/可见性计划
		const highlightPlan = buildHighlightRenderPlan(rend, highlights);
		// 先 apply 用户划线 mark
		applyEpubUserHighlights(
			rend,
			highlights,
			appliedHighlightsRef,
			highlightPlan,
		);
		// apply 想法虚线（无 suppress 参数）
		applyEpubThoughtUnderlines(rend, thoughts, appliedThoughtsRef);
		// 收集用户划线 SVG 热区供想法 patch 扣减
		setUserHighlightBlockerSourcesForThoughtPatch(
			collectUserHighlightBlockerSources(rend),
		);
		// 立即 patch + restack，保证保存/划线后立刻可见
		runEpubReadingAnnotationPatch(rend);
	} finally {
		endEpubAnnotationSyncScope();
	}
}
```

**变更摘要**：移除 `getThoughtCfisSuppressedByHighlights` / `invalidateThoughtMarksWithChangedSuppression` 整条 suppress 链路；重叠改由 patch blocker + restack 处理。

---

### 4.4 `collectUserHighlightBlockerSources`（`apps/frontend/src/views/ebook/utils/epubUserHighlights.ts`）

**对比范围**：从 DOM 收集用户划线 blocker 矩形全函数。

**改动前** · `apps/frontend/src/views/ebook/utils/epubUserHighlights.ts`（基线 HEAD，约 L2308–L2334）

```typescript
// 遍历 marks-pane 中用户划线 SVG，收集用于扣减想法虚线的水平矩形
function collectUserHighlightBlockerSources(
	rend: Rendition,
): UserHighlightBlockerSource[] {
	// 累积每个用户 highlight group 的 cfi + rects
	const sources: UserHighlightBlockerSource[] = [];
	// 主文档 + 各 iframe 内容文档
	const docs = new Set<Document>([document]);
	for (const contents of getRenditionContentsList(rend)) {
		if (contents.document) docs.add(contents.document);
	}

	for (const doc of docs) {
		try {
			// 每个用户划线 SVG g 元素
			doc.querySelectorAll(USER_HIGHLIGHT_SELECTOR).forEach((group) => {
				const cfi = (group as SVGElement).dataset.epubcfi?.trim() ?? '';
				// 旧版：仅收集 patch 后的 rect 子节点
				const rects = [...group.querySelectorAll('rect')]
					.map((rect) => parseSvgMarkRect(rect as SVGRectElement))
					.filter((rect): rect is NonNullable<typeof rect> => rect !== null);
				if (rects.length > 0) {
					sources.push({ cfi, rects });
				}
			});
		} catch {
			// iframe 卸载时忽略
		}
	}

	return sources;
}
```

**改动后** · `apps/frontend/src/views/ebook/utils/epubUserHighlights.ts`（当前，约 L2281–L2324）

```typescript
// 遍历 marks-pane 中用户划线 SVG，收集用于扣减想法虚线的水平矩形
function collectUserHighlightBlockerSources(
	rend: Rendition,
): UserHighlightBlockerSource[] {
	// 累积每个用户 highlight group 的 cfi + rects
	const sources: UserHighlightBlockerSource[] = [];
	// 主文档 + 各 iframe 内容文档
	const docs = new Set<Document>([document]);
	for (const contents of getRenditionContentsList(rend)) {
		if (contents.document) docs.add(contents.document);
	}

	for (const doc of docs) {
		try {
			doc.querySelectorAll(USER_HIGHLIGHT_SELECTOR).forEach((group) => {
				const cfi = (group as SVGElement).dataset.epubcfi?.trim() ?? '';
				const el = group as SVGElement;
				// 读取划线样式：highlight / underline / wavy
				const style = (el.dataset[DATA_STYLE] ?? 'highlight') as EpubHighlightStyle;
				const rects = [...group.querySelectorAll('rect')]
					.map((rect) => parseSvgMarkRect(rect as SVGRectElement))
					.filter((rect): rect is NonNullable<typeof rect> => rect !== null);
				// 波浪线 stroke 在 path 上，需额外 bbox；下划线不读 line 避免过宽误扣
				if (style === 'wavy') {
					for (const node of group.querySelectorAll(`path.${WAVY_PATH_CLASS}`)) {
						if (!(node instanceof SVGPathElement)) continue;
						const box = node.getBBox();
						if (box.width >= MIN_USER_HIGHLIGHT_BLOCKER_PX && box.height > 0) {
							rects.push({
								x: box.x,
								y: box.y,
								width: box.width,
								height: box.height,
							});
						}
					}
				}
				if (rects.length > 0) {
					sources.push({ cfi, rects });
				}
			});
		} catch {
			// iframe 卸载时忽略
		}
	}

	return sources;
}
```

**变更摘要**：按 `data-style` 分支；波浪线追加 path bbox；下划线/背景高亮仍只用 rect，避免 epub.js 遗留 `<line>` 误扣。

---

### 4.5 `restackUserHighlightMarkGroups`（`apps/frontend/src/views/ebook/utils/epubUserHighlights.ts`）

**对比范围**：纯新增导出函数（改动后完整定义）。

**改动后** · `apps/frontend/src/views/ebook/utils/epubUserHighlights.ts`（当前，约 L2326–L2344）

```typescript
// 导出：将用户划线 mark 移到 marks-pane 末尾，叠在想法虚线之上
export function restackUserHighlightMarkGroups(rend?: Rendition): void {
	// 主文档 + 各 iframe 内容文档
	const docs = new Set<Document>([document]);
	for (const contents of getRenditionContentsList(rend)) {
		if (contents.document) docs.add(contents.document);
	}

	for (const doc of docs) {
		try {
			// 每个 marks-pane 内把所有用户划线 group append 到末尾
			for (const pane of doc.querySelectorAll('.marks-pane')) {
				for (const group of pane.querySelectorAll(USER_HIGHLIGHT_SELECTOR)) {
					pane.appendChild(group);
				}
			}
		} catch {
			// iframe 卸载时忽略
		}
	}
}
```

**变更摘要**：新增；在 `runEpubReadingAnnotationPatch` 中与 `restackThoughtMarkGroups` 一并调用，保证重叠处用户 stroke 盖住想法虚线。

---

### 4.6 `saveThought` CFI 归一化（`apps/frontend/src/views/ebook/read.tsx`）

**对比范围**：`saveThought` 内 `try` 块开头至 `createEbookThought` 调用前（对称摘录）。

**改动前** · `apps/frontend/src/views/ebook/read.tsx`（基线 HEAD，`saveThought` 内约 L975–L985）

```typescript
		setThoughtSaving(true);
		try {
			if (thoughtDialogMode === 'create') {
				const item = await createEbookThought({
					bookId,
					cfiRange: thoughtDraft.cfiRange,
					quote: thoughtDraft.quote,
					content,
				});
```

**改动后** · `apps/frontend/src/views/ebook/read.tsx`（当前，`saveThought` 内约 L974–L993）

```typescript
		setThoughtSaving(true);
		try {
			// 保存前用 DOM 重新解析并 trim，与用户划线 upsert 对齐
			let cfiRange = thoughtDraft.cfiRange;
			let quote = thoughtDraft.quote;
			const rend = epubNavRef.current?.getRendition();
			if (rend) {
				const resolved = resolveCfiDomRange(rend, cfiRange);
				if (resolved) {
					const normalized = trimSelectionRange(resolved);
					cfiRange = cfiFromDomRange(rend, normalized) ?? cfiRange.trim();
					quote = normalized.toString().trim() || quote.trim();
				}
			}
			if (thoughtDialogMode === 'create') {
				const item = await createEbookThought({
					bookId,
					cfiRange,
					quote,
					content,
				});
```

**变更摘要**：保存前 `resolveCfiDomRange` → `trimSelectionRange` → `cfiFromDomRange` 归一化，减少长段落边界 CFI 与 DOM 不一致导致的 mark 落空。

---

## 5. 兼容性与影响

| 项 | 说明 |
|----|------|
| **数据** | 无 schema/API 变更；已有想法/划线记录无需迁移 |
| **行为** | 嵌套想法仍只应见一条虚线（patch thoughtBlockers）；与用户划线重叠处虚线被扣段而非整段 hide |
| **破坏性** | 删除 `applyEpubThoughtUnderlines` 第四参数、`getThoughtCfisSuppressedByHighlights` 导出；外部若无引用则无影响 |
| **回归** | 哥伦布段句内写想法；同段用户下划线/背景/波浪与想法重叠；标题+段落选区；翻页 scroll patch |

---

## 6. 相关源码路径

| 说明 | 路径 |
|------|------|
| 想法 apply + patch 顺序 | `apps/frontend/src/views/ebook/utils/epubThoughtAnnotations.ts` |
| 用户划线 sync + blocker + restack | `apps/frontend/src/views/ebook/utils/epubUserHighlights.ts` |
| 保存想法 CFI 归一化 | `apps/frontend/src/views/ebook/read.tsx` |
| EpubPane 双 effect 调用 sync | `apps/frontend/src/views/ebook/components/EpubPane.tsx` |

---

（若与仓库最新源码不一致，以源码为准）
