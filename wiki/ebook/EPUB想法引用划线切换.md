# EPUB 想法侧栏：引用区「划线 / 删除划线」覆盖度判定

## 文档角色

**增量专题**：读书想法 **右侧分栏引用区** 底部操作条中，划线按钮与 **PopBar 选区工具条** 对齐——仅当 **当前展示的引用摘录全文** 均被用户划线覆盖时才显示 **删除划线**，否则显示 **划线** 并为整段引用补划。

**姊妹文档**：[EPUB划线DOM匹配.md](./EPUB划线DOM匹配.md)、[EPUB想法侧面板.md](./EPUB想法侧面板.md)、[EPUB想法聚类桥接.md](./EPUB想法聚类桥接.md)。

**延伸阅读**：[EPUB想法列表UI.md](./EPUB想法列表UI.md)、[EPUB分屏软调整.md](./EPUB分屏软调整.md)。

---

## 1. 背景与目标

### 1.1 问题

旧实现用 `findUserHighlightCoveringCfi`：**引用 CFI 与任意用户划线 DOM 相交** 即 `hasHighlight: true`，侧栏固定显示 **删除划线**。

示例：引用区展示 `abcdef`，用户只给 `def` 划线 → 侧栏仍显示 **删除划线**，无法为 **整段引用** 一键补划。

### 1.2 目标

| 引用摘录状态                   | 侧栏按钮     | 点击行为                 |
| ------------------------------ | ------------ | ------------------------ |
| 每个非空白字均在划线覆盖范围内 | **删除划线** | 删除覆盖该引用的划线     |
| 任一部分未划（如只划 `def`）   | **划线**     | 为 **当前引用全文** 补划 |
| 多段分别已划且并集覆盖全文     | **删除划线** | 删除相关划线             |

---

## 2. 改动范围

| 路径                                                        | 变更要点                                                                                   |
| ----------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| `apps/frontend/src/views/ebook/utils/epubThoughtCluster.ts` | 新增 `getThoughtClusterHighlightSubject`                                                   |
| `apps/frontend/src/views/ebook/read.tsx`                    | `thoughtListQuoteActions` / `thoughtDialogQuoteActions` 改用 `isSelectionFullyHighlighted` |

**未改动**：`EpubQuoteActionBar.tsx`、`openHighlightPopBarAtBookContent` / `removeHighlightForQuote` 行为。

---

## 3. 实现思路

1. **判定 API 复用**：`isSelectionFullyHighlighted` → `resolveSelectionHighlightCoverage === 'full'`（与 PopBar 一致）。
2. **Subject 对齐**：聚合 cluster 时 `primaryCfiRange` 可能偏短 → `getThoughtClusterHighlightSubject` 在 multi-group 且无 `selectedThoughtId` 时取 **各分组 DOM 并集** 再 `cfiFromDomRange`。
3. **章节过滤保留**：列表侧仍按 `extractCfiSpineHint` 过滤 `chapterHighlights`。
4. **详情弹窗对齐**：`thoughtDialogQuoteActions` 同样改为 full 覆盖判定。

---

## 4. 关键代码对比与注释

### 4.1 `getThoughtClusterHighlightSubject`（`epubThoughtCluster.ts`）

**对比范围**：完整导出函数（**新增**）。

**改动后** · `apps/frontend/src/views/ebook/utils/epubThoughtCluster.ts`（当前，约 L669–L693）

```typescript
// 侧栏划线判定/操作所用的 CFI + quote 解析入口
export function getThoughtClusterHighlightSubject(
	// 当前点击聚合后的 cluster
	cluster: EbookThoughtClickCluster,
	// EPUB rendition，用于 DOM 并集与 CFI 回写
	rend?: Rendition,
): { cfiRange: string; quote: string } {
	// 引用区展示的 quote（选中单条时取该条，否则 primaryQuote）
	const quote = getThoughtClusterDisplayQuote(cluster).trim();
	// 默认与展示 quote 对应的 CFI
	const cfiRange = getThoughtClusterDisplayCfi(cluster);
	// 无 rendition 或无 quote 时无法做 DOM 并集
	if (!rend || !quote) return { cfiRange, quote };

	// 多分组聚合且未选中单条想法时，尝试 DOM 并集 subject
	if (cluster.quoteGroups.length > 1 && !cluster.selectedThoughtId) {
		// 各 quoteGroup 的 CFI 解析为 DOM Range
		const ranges = cluster.quoteGroups
			.map((group) => resolveCfiDomRange(rend, group.cfiRange))
			.filter((range): range is Range => range !== null);
		// 合并为覆盖所有分组的并集 Range
		const union = mergeDomRangeUnion(ranges);
		// 并集纯文本须与引用区展示 quote 一致
		const unionQuote = union?.toString().trim();
		// 对齐成功则用并集 CFI 作为划线 subject
		if (union && unionQuote && unionQuote === quote) {
			// DOM 并集反写 EPUB CFI
			const unionCfi = cfiFromDomRange(rend, union);
			if (unionCfi) {
				return { cfiRange: unionCfi, quote: unionQuote };
			}
		}
	}

	// 并集不可用或未对齐时回退 display 侧数据
	return { cfiRange, quote };
}
```

**变更摘要**：新增；解决聚合引用时 subject CFI 偏短导致覆盖度误判。

---

### 4.2 `thoughtListQuoteActions`（`read.tsx`）

**对比范围**：完整 `const thoughtListQuoteActions = useMemo(...)` 符号。

**改动前** · `apps/frontend/src/views/ebook/read.tsx`（基线，约 L1041–L1083）

```typescript
// 列表侧栏引用区底部操作条 props，随 cluster / highlights 变化重算
const thoughtListQuoteActions = useMemo(() => {
	// 无 cluster 时不渲染操作条
	if (!thoughtListCluster) return null;
	// 旧版直接从 cluster 取展示 quote
	const quote = getThoughtClusterDisplayQuote(thoughtListCluster);
	// 旧版 CFI 可能仅为最长子选区
	const cfiRange = getThoughtClusterDisplayCfi(thoughtListCluster);
	// 空 quote 不展示
	if (!quote.trim()) return null;
	// rendition 供 DOM 命中
	const rend = epubNavRef.current?.getRendition() ?? undefined;
	// 同章划线过滤
	const spineHint = extractCfiSpineHint(cfiRange);
	const chapterHighlights = spineHint
		? highlights.filter(
				(item) => extractCfiSpineHint(item.cfiRange) === spineHint,
			)
		: highlights;
	// 旧版：任意 DOM 相交即视为已有划线（问题根源）
	const highlight = findUserHighlightCoveringCfi(
		chapterHighlights,
		cfiRange,
		quote,
		rend,
	);
	return {
		// 传入 EpubQuoteActionBar 的 i18n 文案包
		labels: thoughtDrawerLabels,
		// Boolean(highlight) 导致部分相交也显示「删除划线」
		hasHighlight: Boolean(highlight),
		// 复制当前引用摘录
		onCopy: () => void copyToClipboard(quote),
		// 打开 PopBar 并为整段引用 ensureHighlight 补划
		onUnderline: () =>
			openHighlightPopBarAtBookContent(cfiRange, quote, {
				ensureHighlight: true,
			}),
		// 删除覆盖该引用 CFI 的用户划线
		onRemoveUnderline: () => void removeHighlightForQuote(cfiRange, quote),
		// 从列表侧栏发起写想法
		onWriteThought: () => {
			// 记住当前 cluster，详情关闭后可回到同一聚合列表
			if (thoughtListClusterRef.current) {
				returnToListClusterRef.current = thoughtListClusterRef.current;
			}
			// 关闭列表分栏
			setThoughtListOpen(false);
			// 以当前 quote/cfi 打开创建想法
			openCreateThought(quote, cfiRange);
		},
		// 用引用摘录预填 MOKE 问书
		onAskBook: () => {
			// 先关列表，避免与助手分栏互斥
			setThoughtListOpen(false);
			// 下一帧打开助手并注入选区文本
			window.setTimeout(() => openAssistantWithSelection(quote), 0);
		},
	};
}, [
	// cluster 变化时重算 quoteActions
	thoughtListCluster,
	// 划线列表变化时重算 hasHighlight
	highlights,
	// rendition 就绪后再做 DOM 覆盖度检测
	epubNavReady,
	// 文案包变更
	thoughtDrawerLabels,
	// 写想法入口回调
	openCreateThought,
	// MOKE 问书入口回调
	openAssistantWithSelection,
	// 删线回调
	removeHighlightForQuote,
	// PopBar 补划回调
	openHighlightPopBarAtBookContent,
]);
```

**改动后** · `apps/frontend/src/views/ebook/read.tsx`（当前，约 L1034–L1083）

```typescript
// 列表侧栏引用区底部操作条 props，随 cluster / highlights 变化重算
const thoughtListQuoteActions = useMemo(() => {
	// 无 cluster 时不渲染操作条
	if (!thoughtListCluster) return null;
	// 先取 rendition，供 subject 与覆盖度共用
	const rend = epubNavRef.current?.getRendition() ?? undefined;
	// 聚合引用时用 DOM 并集 CFI，与引用区展示对齐
	const { cfiRange, quote } = getThoughtClusterHighlightSubject(
		thoughtListCluster,
		rend,
	);
	// 空 quote 不展示
	if (!quote.trim()) return null;
	// 同章划线过滤
	const spineHint = extractCfiSpineHint(cfiRange);
	const chapterHighlights = spineHint
		? highlights.filter(
				(item) => extractCfiSpineHint(item.cfiRange) === spineHint,
			)
		: highlights;
	return {
		// 传入 EpubQuoteActionBar 的 i18n 文案包
		labels: thoughtDrawerLabels,
		// 与 PopBar 一致：仅 full 覆盖才显示「删除划线」
		hasHighlight: isSelectionFullyHighlighted(
			chapterHighlights,
			cfiRange,
			quote,
			rend,
		),
		// 复制当前引用摘录
		onCopy: () => void copyToClipboard(quote),
		// 打开 PopBar 并为整段引用 ensureHighlight 补划
		onUnderline: () =>
			openHighlightPopBarAtBookContent(cfiRange, quote, {
				ensureHighlight: true,
			}),
		// 删除覆盖该引用 CFI 的用户划线
		onRemoveUnderline: () => void removeHighlightForQuote(cfiRange, quote),
		// 从列表侧栏发起写想法
		onWriteThought: () => {
			// 记住当前 cluster，详情关闭后可回到同一聚合列表
			if (thoughtListClusterRef.current) {
				returnToListClusterRef.current = thoughtListClusterRef.current;
			}
			// 关闭列表分栏
			setThoughtListOpen(false);
			// 以当前 quote/cfi 打开创建想法
			openCreateThought(quote, cfiRange);
		},
		// 用引用摘录预填 MOKE 问书
		onAskBook: () => {
			// 先关列表，避免与助手分栏互斥
			setThoughtListOpen(false);
			// 下一帧打开助手并注入选区文本
			window.setTimeout(() => openAssistantWithSelection(quote), 0);
		},
	};
}, [
	// cluster 变化时重算 quoteActions
	thoughtListCluster,
	// 划线列表变化时重算 hasHighlight
	highlights,
	// rendition 就绪后再做 DOM 覆盖度检测
	epubNavReady,
	// 文案包变更
	thoughtDrawerLabels,
	// 写想法入口回调
	openCreateThought,
	// MOKE 问书入口回调
	openAssistantWithSelection,
	// 删线回调
	removeHighlightForQuote,
	// PopBar 补划回调
	openHighlightPopBarAtBookContent,
]);
```

**变更摘要**：subject 改为 `getThoughtClusterHighlightSubject`；`hasHighlight` 从相交改为全文覆盖。

---

### 4.3 `thoughtDialogQuoteActions`（`read.tsx`）

**对比范围**：完整 `const thoughtDialogQuoteActions = useMemo(...)` 符号。

**改动前** · `apps/frontend/src/views/ebook/read.tsx`（基线，约 L1085–L1133）

```typescript
// 详情/写想法弹窗引用区底部操作条 props
const thoughtDialogQuoteActions = useMemo(() => {
	// draft quote 为空时不展示
	const quote = thoughtDraft.quote.trim();
	if (!quote) return null;
	// draft 对应 CFI
	const cfiRange = thoughtDraft.cfiRange;
	// rendition 供 DOM 命中
	const rend = epubNavRef.current?.getRendition() ?? undefined;
	// 旧版：任意相交即 hasHighlight
	const highlight = findUserHighlightCoveringCfi(
		highlights,
		cfiRange,
		thoughtDraft.quote,
		rend,
	);
	return {
		// 传入 EpubQuoteActionBar 的 i18n 文案包
		labels: thoughtDrawerLabels,
		// 旧版：任意相交即 hasHighlight
		hasHighlight: Boolean(highlight),
		// 复制 draft 引用摘录
		onCopy: () => void copyToClipboard(thoughtDraft.quote),
		// 打开 PopBar 并为 draft 引用 ensureHighlight 补划
		onUnderline: () =>
			openHighlightPopBarAtBookContent(cfiRange, thoughtDraft.quote, {
				ensureHighlight: true,
			}),
		// 删除覆盖 draft CFI 的用户划线
		onRemoveUnderline: () =>
			void removeHighlightForQuote(cfiRange, thoughtDraft.quote),
		// 从详情/写想法弹窗发起写想法
		onWriteThought: () => {
			// 已在 create 模式时仅滚动输入区，不重复开弹窗
			if (thoughtDialogOpen && thoughtDialogMode === "create") {
				setThoughtComposeScrollKey((key) => key + 1);
				return;
			}
			// 关闭详情弹窗
			setThoughtDialogOpen(false);
			// 以 draft quote/cfi 打开创建想法
			openCreateThought(thoughtDraft.quote, thoughtDraft.cfiRange);
		},
		// 用 draft 摘录预填 MOKE 问书
		onAskBook: () => {
			// 先关详情弹窗
			setThoughtDialogOpen(false);
			// 下一帧打开助手并注入选区文本
			window.setTimeout(
				() => openAssistantWithSelection(thoughtDraft.quote),
				0,
			);
		},
	};
}, [
	// draft 摘录变化
	thoughtDraft.quote,
	// draft CFI 变化
	thoughtDraft.cfiRange,
	// 划线列表变化时重算 hasHighlight
	highlights,
	// rendition 就绪后再做 DOM 覆盖度检测
	epubNavReady,
	// 弹窗模式（create/view）
	thoughtDialogMode,
	// 弹窗开关
	thoughtDialogOpen,
	// 文案包变更
	thoughtDrawerLabels,
	// 写想法入口回调
	openCreateThought,
	// MOKE 问书入口回调
	openAssistantWithSelection,
	// 删线回调
	removeHighlightForQuote,
	// PopBar 补划回调
	openHighlightPopBarAtBookContent,
]);
```

**改动后** · `apps/frontend/src/views/ebook/read.tsx`（当前，约 L1085–L1133）

```typescript
// 详情/写想法弹窗引用区底部操作条 props
const thoughtDialogQuoteActions = useMemo(() => {
	// draft quote 为空时不展示
	const quote = thoughtDraft.quote.trim();
	if (!quote) return null;
	// draft 对应 CFI
	const cfiRange = thoughtDraft.cfiRange;
	// rendition 供覆盖度检测
	const rend = epubNavRef.current?.getRendition() ?? undefined;
	return {
		// 传入 EpubQuoteActionBar 的 i18n 文案包
		labels: thoughtDrawerLabels,
		// 与列表侧、PopBar 统一的 full 覆盖判定
		hasHighlight: isSelectionFullyHighlighted(
			highlights,
			cfiRange,
			thoughtDraft.quote,
			rend,
		),
		// 复制 draft 引用摘录
		onCopy: () => void copyToClipboard(thoughtDraft.quote),
		// 打开 PopBar 并为 draft 引用 ensureHighlight 补划
		onUnderline: () =>
			openHighlightPopBarAtBookContent(cfiRange, thoughtDraft.quote, {
				ensureHighlight: true,
			}),
		// 删除覆盖 draft CFI 的用户划线
		onRemoveUnderline: () =>
			void removeHighlightForQuote(cfiRange, thoughtDraft.quote),
		// 从详情/写想法弹窗发起写想法
		onWriteThought: () => {
			// 已在 create 模式时仅滚动输入区，不重复开弹窗
			if (thoughtDialogOpen && thoughtDialogMode === "create") {
				setThoughtComposeScrollKey((key) => key + 1);
				return;
			}
			// 关闭详情弹窗
			setThoughtDialogOpen(false);
			// 以 draft quote/cfi 打开创建想法
			openCreateThought(thoughtDraft.quote, thoughtDraft.cfiRange);
		},
		// 用 draft 摘录预填 MOKE 问书
		onAskBook: () => {
			// 先关详情弹窗
			setThoughtDialogOpen(false);
			// 下一帧打开助手并注入选区文本
			window.setTimeout(
				() => openAssistantWithSelection(thoughtDraft.quote),
				0,
			);
		},
	};
}, [
	// draft 摘录变化
	thoughtDraft.quote,
	// draft CFI 变化
	thoughtDraft.cfiRange,
	// 划线列表变化时重算 hasHighlight
	highlights,
	// rendition 就绪后再做 DOM 覆盖度检测
	epubNavReady,
	// 弹窗模式（create/view）
	thoughtDialogMode,
	// 弹窗开关
	thoughtDialogOpen,
	// 文案包变更
	thoughtDrawerLabels,
	// 写想法入口回调
	openCreateThought,
	// MOKE 问书入口回调
	openAssistantWithSelection,
	// 删线回调
	removeHighlightForQuote,
	// PopBar 补划回调
	openHighlightPopBarAtBookContent,
]);
```

**变更摘要**：移除 `findUserHighlightCoveringCfi`；`hasHighlight` 改为 `isSelectionFullyHighlighted`。

---

## 5. 兼容性与影响

- **用户可感知**：部分已划的引用摘录侧栏由「删除划线」改为「划线」。
- **非破坏性**：PopBar、想法虚线、点击聚合逻辑不变。

---

## 6. 回归建议

1. 引用 `abcdef` 只划 `def` → 侧栏 **划线**，点击整段补划。
2. `abc` + `def` 分别已划且覆盖全文 → **删除划线**。
3. 聚合 cluster 引用区与按钮态一致。
4. PopBar 选区划线无回归。

---

## 7. 相关源码路径

| 说明              | 路径                                                        |
| ----------------- | ----------------------------------------------------------- |
| 覆盖度判定        | `apps/frontend/src/views/ebook/utils/epubUserHighlights.ts` |
| Highlight subject | `apps/frontend/src/views/ebook/utils/epubThoughtCluster.ts` |
| 侧栏 quoteActions | `apps/frontend/src/views/ebook/read.tsx`                    |

---

（若与仓库最新源码不一致，以源码为准）
