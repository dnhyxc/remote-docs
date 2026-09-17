# EPUB 选区 PopBar 阅读 chrome 与划线顶栏

## 文档角色

**增量专题**：在 [EPUB阅读器Chrome对比度.md](./EPUB阅读器Chrome对比度.md) 已贯通顶栏/侧栏/听书菜单等 chrome 的基础上，本轮将 **阅读背景与字色** 延伸到 **选区浮动 PopBar**（Portal 毛玻璃面板、箭头、投影），并调整 **划线样式/颜色顶栏** 的展示条件：**全新选区** 不展示顶栏，**已有用户划线**（含 partial）才展示。

**姊妹文档**：[EPUB选区PopBar视觉.md](./EPUB选区PopBar视觉.md)、[EPUB阅读器Chrome对比度.md](./EPUB阅读器Chrome对比度.md)、[EPUB划线DOM匹配.md](./EPUB划线DOM匹配.md)、[EPUB引用分享对话框Chrome.md](./EPUB引用分享对话框Chrome.md)。

---

## 1. 背景与目标

### 1.1 问题

| 现象 | 根因 |
| ---- | ---- |
| PopBar 在粉/米阅读背景下仍像深色主题卡片 | 面板用 `--theme-card` 而非 `--epub-reader-surface-bg`；Popover Portal 未挂 `getEpubReaderChromeCssVars` |
| 顶栏样式条 hover 发灰不可见 | `bg-theme/8` 取自应用 theme 色，与阅读背景对比不足 |
| 全新选区也展示划线颜色顶栏 | `showHighlightStyleBar` 默认 `true`，与「先划线再改样式」心智不符 |
| 彩色阅读背景下投影过「主题化」 | 全局 `drop-shadow-(--shadow-6)` 在粉/绿背景上不协调 |

### 1.2 目标

- PopBar `PopoverContent` 挂载 `chromeStyle`，面板/箭头/操作条字色跟随阅读 chrome。
- 投影：`default` / `night` → `shadow-6`；其余阅读背景 → `rgba(0,0,0,0.2)`。
- `resolveSelectionHighlightCoverage` 驱动 `selectionHasHighlight`，顶栏默认随其显隐。
- 「听当前」操作改用 `AudioWaveform` 图标（与划线 `Baseline` 图标统一风格）。

---

## 2. 改动范围

| 路径 | 变更要点 |
| ---- | -------- |
| `apps/frontend/src/views/ebook/utils/epub/reader/epubReaderSettings.ts` | `epubReaderPopBarSurfaceClass`、`EPUB_READER_POPBAR_CARET_FILL`、`epubReaderPopBarShadowClass` |
| `apps/frontend/src/views/ebook/components/selection/EpubSelectionPopBar.tsx` | `chromeStyle`、`readerBgTheme`、`selectionHasHighlight` |
| `apps/frontend/src/views/ebook/components/selection/EpubSelectionPopBarPanel.tsx` | 面板 surface/阴影/箭头；顶栏显隐逻辑 |
| `apps/frontend/src/views/ebook/components/selection/EpubHighlightStyleBar.tsx` | hover/active 改 `textcolor` |
| `apps/frontend/src/views/ebook/components/selection/EpubQuoteActionBar.tsx` | 听/划线图标 |
| `apps/frontend/src/views/ebook/read.tsx` | `selectionHighlightCoverage` 派生 |

---

## 3. 实现思路

1. **Portal 字色**：与听书菜单相同，`PopoverContent` 设 `style={chromeStyle}`，子树 `text-textcolor/*` 生效。
2. **面板 surface**：`epubReaderPopBarSurfaceClass` 基于 `--epub-reader-surface-bg` 92% 混透明 + 毛玻璃，替代 `--theme-card`。
3. **箭头同色**：`EPUB_READER_POPBAR_CARET_FILL` 与面板 surface 使用同一 `color-mix` 表达式。
4. **条件顶栏**：`shouldShowHighlightStyleBar = showHighlightStyleBar ?? selectionHasHighlight`；`read.tsx` 用 `resolveSelectionHighlightCoverage !== 'none'` 传入。
5. **投影分流**：`epubReaderPopBarShadowClass(bgTheme)` 封装 Tailwind 类名，避免 Panel 内硬编码。

---

## 4. 关键代码对比与注释

### 4.1 `epubReaderPopBarShadowClass` 等（`apps/frontend/src/views/ebook/utils/epub/reader/epubReaderSettings.ts`）

**对比范围**：纯新增 PopBar 专用 chrome 常量与投影函数（基线无此符号）。

**改动后** · `apps/frontend/src/views/ebook/utils/epub/reader/epubReaderSettings.ts`（当前，约 L266–L280）

```typescript
// 选区 PopBar 毛玻璃面板 class：基于阅读 surface 变量，须配合 Popover 上的 chromeStyle
export const epubReaderPopBarSurfaceClass =
	// 圆角 + 92% surface 混透明 + 毛玻璃 + 正文字色 utility
	'rounded-md bg-[color-mix(in_oklch,var(--epub-reader-surface-bg,var(--color-theme-card))_92%,transparent)] backdrop-blur-md backdrop-saturate-150 text-textcolor';

// PopBar 箭头 SVG fill，与面板 surface 同色（避免箭头仍用 theme-card）
export const EPUB_READER_POPBAR_CARET_FILL =
	// color-mix 与 epubReaderPopBarSurfaceClass 背景一致
	'color-mix(in oklch, var(--epub-reader-surface-bg, var(--color-theme-card)) 92%, transparent)';

// 按阅读背景决定 PopBar 外层投影 Tailwind 类
export function epubReaderPopBarShadowClass(
	// 当前阅读背景主题 id
	bgTheme: EpubReaderBgTheme,
): string {
	// 跟随应用或夜间阅读背景：沿用全局 shadow-6 令牌
	if (bgTheme === 'default' || bgTheme === 'night') {
		return 'drop-shadow-(--shadow-6)';
	}
	// 粉/米/护眼等彩色阅读背景：固定 rgba 软阴影，避免主题色光晕
	return 'drop-shadow-[0_4px_12px_rgba(0,0,0,0.2)]';
}
```

**变更摘要**：新增 PopBar 三件套，供 Panel 与箭头引用；投影与 [EPUB选区PopBar视觉.md](./EPUB选区PopBar视觉.md) 规则对齐并随阅读背景分流。

---

### 4.2 `EpubSelectionPopBarPanel`（`apps/frontend/src/views/ebook/components/selection/EpubSelectionPopBarPanel.tsx`）

**对比范围**：组件函数全文（含顶栏显隐与外层 className）。

**改动前** · `apps/frontend/src/views/ebook/components/selection/EpubSelectionPopBarPanel.tsx`（基线 HEAD，约 L97–L181）

```typescript
// PopBar 工具条主体（选区浮动条 / 侧栏引用内嵌条共用）
export function EpubSelectionPopBarPanel({
	// 操作条 i18n 文案集合
	labels,
	// 选区是否已全部划线（控制删除划线 vs 划线槽位）
	selectionFullyHighlighted = false,
	// 当前划线样式（高亮/直线下划线/波浪）
	highlightStyle,
	// 当前划线颜色 id
	highlightColor,
	// 用户切换划线样式回调
	onHighlightStyleChange,
	// 用户切换划线颜色回调
	onHighlightColorChange,
	// 复制选区
	onCopy,
	// 应用划线
	onApplyHighlight,
	// 删除划线
	onRemoveHighlight,
	// 写想法
	onWriteThought,
	// MK 问书
	onAskBook,
	// 分享书摘（可选）
	onShare,
	// 听当前（可选）
	onListen,
	// 任意操作后清除选区（可选）
	onClearSelection,
	// 箭头对准的视口 X；不传则居中
	caretAnchorX,
	// floating 选区条 / inline 侧栏引用条
	variant = 'floating',
	// 是否展示样式/颜色顶栏；基线默认 true
	showHighlightStyleBar = true,
}: EpubSelectionPopBarPanelProps) {
	// 面板 DOM ref，用于测量箭头水平位置
	const toolbarRef = useRef<HTMLDivElement>(null);
	// 箭头 left 像素值；null 表示尚未测量
	const [arrowLeft, setArrowLeft] = useState<number | null>(null);
	// 与 selectionFullyHighlighted 同义，供操作条 hasHighlight
	const hasHighlight = selectionFullyHighlighted;

	// 根据 caretAnchorX 与面板矩形计算箭头 clamp 后的 left
	const measureArrowLeft = useCallback((): number | null => {
		// 取面板元素
		const toolbar = toolbarRef.current;
		// 未挂载则无法测量
		if (!toolbar) return null;
		// 面板在视口中的矩形
		const rect = toolbar.getBoundingClientRect();
		// 宽度为 0 时跳过（尚未 layout）
		if (rect.width === 0) return null;
		// 锚点 X：传入 caretAnchorX 或面板中心
		const anchorX = caretAnchorX ?? rect.left + rect.width / 2;
		// clamp 到面板左右内边距范围内
		return clampArrowLeft(rect.left, rect.width, anchorX);
	}, [caretAnchorX]);

	// 挂载后测量箭头；resize / 面板尺寸变化时重测
	useLayoutEffect(() => {
		// 封装一次测量并写入 state
		const updateArrowLeft = () => {
			// 调用 measureArrowLeft
			const next = measureArrowLeft();
			// 有效值才 setState，避免 null 覆盖
			if (next != null) setArrowLeft(next);
		};

		// 首次测量
		updateArrowLeft();

		// 窗口 resize 时重测
		window.addEventListener('resize', updateArrowLeft);
		// 取当前 ref 上的元素
		const toolbarEl = toolbarRef.current;
		// ResizeObserver 监听面板宽度变化（顶栏显隐会导致高度/宽度变）
		const observer = toolbarEl ? new ResizeObserver(updateArrowLeft) : null;
		// 有元素则 observe
		if (toolbarEl && observer) observer.observe(toolbarEl);

		// 清理监听
		return () => {
			// 移除 resize
			window.removeEventListener('resize', updateArrowLeft);
			// 断开 observer
			observer?.disconnect();
		};
	// 顶栏显隐变化会改变面板高度，需重测箭头
	}, [measureArrowLeft, showHighlightStyleBar]);

	// 渲染 PopBar 外层阴影 + 面板 + 箭头
	return (
		// 基线固定 shadow-6，不随阅读背景变化
		<div className="relative drop-shadow-(--shadow-6)">
			<div
				// 面板 ref 供箭头测量
				ref={toolbarRef}
				// 基线用 theme-card 混透明，未挂 text-textcolor
				className="rounded-md bg-[color-mix(in_oklch,var(--theme-card)_92%,transparent)] backdrop-blur-md backdrop-saturate-150"
			>
				{/* 基线：showHighlightStyleBar 默认 true，全新选区也展示顶栏 */}
				{showHighlightStyleBar ? (
					<EpubHighlightStyleBar
						style={highlightStyle}
						color={highlightColor}
						onStyleChange={onHighlightStyleChange}
						onColorChange={onHighlightColorChange}
						labels={labels}
					/>
				) : null}
				<EpubQuoteActionBar
					variant={variant === 'inline' ? 'floating' : 'floating'}
					labels={labels}
					hasHighlight={hasHighlight}
					onCopy={onCopy}
					onUnderline={onApplyHighlight}
					onRemoveUnderline={onRemoveHighlight}
					onWriteThought={onWriteThought}
					onAskBook={onAskBook}
					onShare={onShare}
					onListen={onListen}
					onAnyAction={onClearSelection}
				/>
			</div>
			{/* 箭头 left 已算出则渲染 PopBarCaret */}
			{arrowLeft != null ? <PopBarCaret left={arrowLeft} /> : null}
		</div>
	);
}
```

**改动后** · `apps/frontend/src/views/ebook/components/selection/EpubSelectionPopBarPanel.tsx`（当前，约 L106–L191）

```typescript
// PopBar 工具条主体（选区浮动条 / 侧栏引用内嵌条共用）
export function EpubSelectionPopBarPanel({
	// 操作条 i18n 文案集合
	labels,
	// 选区是否已全部划线（控制删除划线 vs 划线槽位）
	selectionFullyHighlighted = false,
	// 选区是否命中任意用户划线（含 partial）；驱动顶栏默认显隐
	selectionHasHighlight = false,
	// 当前划线样式（高亮/直线下划线/波浪）
	highlightStyle,
	// 当前划线颜色 id
	highlightColor,
	// 用户切换划线样式回调
	onHighlightStyleChange,
	// 用户切换划线颜色回调
	onHighlightColorChange,
	// 复制选区
	onCopy,
	// 应用划线
	onApplyHighlight,
	// 删除划线
	onRemoveHighlight,
	// 写想法
	onWriteThought,
	// MK 问书
	onAskBook,
	// 分享书摘（可选）
	onShare,
	// 听当前（可选）
	onListen,
	// 任意操作后清除选区（可选）
	onClearSelection,
	// 箭头对准的视口 X；不传则居中
	caretAnchorX,
	// floating 选区条 / inline 侧栏引用条
	variant = 'floating',
	// 显式覆盖顶栏显隐；默认 undefined 表示随 selectionHasHighlight
	showHighlightStyleBar,
	// 阅读背景主题，决定投影 class
	readerBgTheme = 'default',
}: EpubSelectionPopBarPanelProps) {
	// 面板 DOM ref，用于测量箭头水平位置
	const toolbarRef = useRef<HTMLDivElement>(null);
	// 箭头 left 像素值；null 表示尚未测量
	const [arrowLeft, setArrowLeft] = useState<number | null>(null);
	// 与 selectionFullyHighlighted 同义，供操作条 hasHighlight
	const hasHighlight = selectionFullyHighlighted;
	// 最终是否展示划线样式顶栏：显式 prop 优先，否则看选区是否已有划线
	const shouldShowHighlightStyleBar =
		showHighlightStyleBar ?? selectionHasHighlight;

	// 根据 caretAnchorX 与面板矩形计算箭头 clamp 后的 left
	const measureArrowLeft = useCallback((): number | null => {
		// 取面板元素
		const toolbar = toolbarRef.current;
		// 未挂载则无法测量
		if (!toolbar) return null;
		// 面板在视口中的矩形
		const rect = toolbar.getBoundingClientRect();
		// 宽度为 0 时跳过（尚未 layout）
		if (rect.width === 0) return null;
		// 锚点 X：传入 caretAnchorX 或面板中心
		const anchorX = caretAnchorX ?? rect.left + rect.width / 2;
		// clamp 到面板左右内边距范围内
		return clampArrowLeft(rect.left, rect.width, anchorX);
	}, [caretAnchorX]);

	// 挂载后测量箭头；resize / 面板尺寸变化时重测
	useLayoutEffect(() => {
		// 封装一次测量并写入 state
		const updateArrowLeft = () => {
			// 调用 measureArrowLeft
			const next = measureArrowLeft();
			// 有效值才 setState，避免 null 覆盖
			if (next != null) setArrowLeft(next);
		};

		// 首次测量
		updateArrowLeft();

		// 窗口 resize 时重测
		window.addEventListener('resize', updateArrowLeft);
		// 取当前 ref 上的元素
		const toolbarEl = toolbarRef.current;
		// ResizeObserver 监听面板宽度变化（顶栏显隐会导致高度/宽度变）
		const observer = toolbarEl ? new ResizeObserver(updateArrowLeft) : null;
		// 有元素则 observe
		if (toolbarEl && observer) observer.observe(toolbarEl);

		// 清理监听
		return () => {
			// 移除 resize
			window.removeEventListener('resize', updateArrowLeft);
			// 断开 observer
			observer?.disconnect();
		};
	// 顶栏显隐变化会改变面板高度，依赖 shouldShowHighlightStyleBar
	}, [measureArrowLeft, shouldShowHighlightStyleBar]);

	// 渲染 PopBar 外层阴影 + 面板 + 箭头
	return (
		// 投影随阅读背景分流
		<div className={cn('relative', epubReaderPopBarShadowClass(readerBgTheme))}>
			{/* 面板使用阅读 surface 毛玻璃 class */}
			<div ref={toolbarRef} className={epubReaderPopBarSurfaceClass}>
				{/* 仅当 shouldShowHighlightStyleBar 为 true 时渲染顶栏 */}
				{shouldShowHighlightStyleBar ? (
					<EpubHighlightStyleBar
						style={highlightStyle}
						color={highlightColor}
						onStyleChange={onHighlightStyleChange}
						onColorChange={onHighlightColorChange}
						labels={labels}
					/>
				) : null}
				<EpubQuoteActionBar
					variant={variant === 'inline' ? 'floating' : 'floating'}
					labels={labels}
					hasHighlight={hasHighlight}
					onCopy={onCopy}
					onUnderline={onApplyHighlight}
					onRemoveUnderline={onRemoveHighlight}
					onWriteThought={onWriteThought}
					onAskBook={onAskBook}
					onShare={onShare}
					onListen={onListen}
					onAnyAction={onClearSelection}
				/>
			</div>
			{/* 箭头 left 已算出则渲染 PopBarCaret（fill 已改为 EPUB_READER_POPBAR_CARET_FILL） */}
			{arrowLeft != null ? <PopBarCaret left={arrowLeft} /> : null}
		</div>
	);
}
```

**变更摘要**：面板/箭头改跟阅读 surface；投影按 `readerBgTheme` 分流；顶栏默认仅在 `selectionHasHighlight` 时展示。

---

### 4.3 `selectionHighlightCoverage`（`apps/frontend/src/views/ebook/read.tsx`）

**对比范围**：选区划线覆盖度 `useMemo` 及派生布尔值。

**改动前** · `apps/frontend/src/views/ebook/read.tsx`（基线 HEAD，约 L335–L343）

```typescript
	// 选区是否已全部用户划线（仅 full 语义）
	const selectionFullyHighlighted = useMemo(() => {
		// 无选区 PopBar 状态则无 CFI
		if (!selectionPopBar?.cfiRange) return false;
		// 取 epubjs Rendition 供 DOM 覆盖度计算
		const rend = epubNavRef.current?.getRendition() ?? undefined;
		// 仅判断 full 覆盖
		return isSelectionFullyHighlighted(
			highlights,
			selectionPopBar.cfiRange,
			selectionPopBar.selectedText,
			rend,
		);
	// 划线列表、选区、rendition 就绪时重算
	}, [highlights, selectionPopBar, epubNavReady]);
```

**改动后** · `apps/frontend/src/views/ebook/read.tsx`（当前，约 L335–L348）

```typescript
	// 选区与用户划线的覆盖关系：none / partial / full
	const selectionHighlightCoverage = useMemo(() => {
		// 无选区 PopBar 状态则视为 none
		if (!selectionPopBar?.cfiRange) return 'none' as const;
		// 取 epubjs Rendition 供 DOM 覆盖度计算
		const rend = epubNavRef.current?.getRendition() ?? undefined;
		// 返回三态覆盖度
		return resolveSelectionHighlightCoverage(
			highlights,
			selectionPopBar.cfiRange,
			selectionPopBar.selectedText,
			rend,
		);
	// 划线列表、选区、rendition 就绪时重算
	}, [highlights, selectionPopBar, epubNavReady]);

	// full 覆盖：操作条显示「删除划线」
	const selectionFullyHighlighted = selectionHighlightCoverage === 'full';
	// 非 none：PopBar 顶栏样式条可展示（partial 或 full）
	const selectionHasHighlight = selectionHighlightCoverage !== 'none';
```

**变更摘要**：由二元 `isSelectionFullyHighlighted` 改为三态 `resolveSelectionHighlightCoverage`，并派生顶栏与删除划线两个布尔。

---

## 5. 兼容性与影响

- **PDF 阅读页**：不挂载 EPUB PopBar，无影响。
- **侧栏引用 inline PopBar**：仍可通过 `showHighlightStyleBar` 显式覆盖（想法侧栏引用区划线场景）。
- **回归建议**：粉/米/夜间背景下拖选 **未划线** 文字 → 仅操作条、无顶栏；点已有彩色标记 → 顶栏出现；投影在粉色背景下为软黑阴影。

---

## 6. 相关源码路径

| 说明 | 路径 |
| ---- | ---- |
| PopBar chrome 常量 | `apps/frontend/src/views/ebook/utils/epub/reader/epubReaderSettings.ts` |
| PopBar Portal | `apps/frontend/src/views/ebook/components/selection/EpubSelectionPopBar.tsx` |
| PopBar 面板 | `apps/frontend/src/views/ebook/components/selection/EpubSelectionPopBarPanel.tsx` |
| 覆盖度派生 | `apps/frontend/src/views/ebook/read.tsx` |

---

（若与仓库最新源码不一致，以源码为准）
