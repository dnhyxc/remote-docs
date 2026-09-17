# EPUB 选区浮动 PopBar：毛玻璃、箭头与主题阴影

## 文档角色

**增量专题**：在 [EPUB想法侧面板.md](./EPUB想法侧面板.md) 已引入的选区浮动条（`EpubSelectionPopBar`）之上，专门说明 **视觉层** 的迭代：毛玻璃面板、SVG 箭头、四角圆角、主题化定向阴影，以及 `index.css` 中 `--shadow-*` 令牌拆分。

**2026-06 结构变更**：工具条主体与箭头测量已抽至 `EpubSelectionPopBarPanel.tsx`；性能与防闪烁见 **[EPUB PopBar性能体验.md](./EPUB PopBar性能体验.md)**。

**延伸阅读**：[EPUB想法侧面板.md](./EPUB想法侧面板.md)（分栏与工具条挂载）、[EPUB阅读想法.md](./EPUB阅读想法.md)（写想法数据流）、[EPUB助手右键菜单.md](./EPUB助手右键菜单.md)（右键与选区坐标）。

若与仓库最新源码不一致，**以源码为准**。

---

## 1. 背景与目标

### 1.1 用户可见问题

阅读 EPUB 时，用户在正文拖选文字后，选区上方会出现 **浮动 PopBar**（复制 / 划线 / 写想法 / 分享书摘 / MK 问书 / 听当前）。在多轮视觉打磨中暴露出：

| 现象 | 根因（技术） |
|------|----------------|
| 底下正文「透」进工具条，图标发脏 | 曾把 Tailwind 类名 `bg-theme/10` 写进 inline `backgroundColor`，浏览器无法解析 |
| 箭头与主体 **分层、色差** | 箭头用 CSS `border` 三角形 + 错误 `borderTopColor`；或独立 `backdrop-filter` 与主体各模糊一层 |
| 黑色阅读背景下 **边界看不清** | 面板色与 `--theme-background` 过近；曾尝试 `border` 被产品否决 |
| 浅色/彩色主题下 **阴影过黑、四周均匀** | 使用 `0 0 Npx` 光晕式 `--shadow-6`，或 `drop-shadow` 误把完整 shadow 值当 `color-mix` 颜色 |
| 底部左右 **圆角丢失** | 为衔接箭头曾用 `rounded-t-sm` 仅上圆角 |

### 1.2 目标

1. **可读性**：毛玻璃 + 略抬升的 `--theme-card` 面板，正文不干扰图标与文案。
2. **一体感**：箭头与面板 **同色**（SVG `fill`），无描边、无双层 backdrop。
3. **主题一致**：阴影随主题切换；**向下定向**，避免四周均匀光晕。
4. **职责清晰**：PopBar **外壳** 在 `EpubSelectionPopBar`；`EpubQuoteActionBar` 的 `floating` 变体 **只负责按钮布局**，不再 export 样式常量。

---

## 2. 改动范围

| 说明 | 路径 |
|------|------|
| 选区 PopBar 容器、箭头、阴影 | `apps/frontend/src/views/ebook/components/EpubSelectionPopBar.tsx` |
| 浮动变体仅布局（无外壳样式） | `apps/frontend/src/views/ebook/components/EpubQuoteActionBar.tsx` |
| 阴影令牌：`--shadow-color-*` + `--shadow-drop-*` | `apps/frontend/src/index.css`（`:root`、`.dark`、各 `.theme-*` 及 `@theme inline`） |

**未改**：`epubSelectionToolbarAttach.ts`（仍负责 iframe 内选区坐标上报）、Popover 碰撞逻辑本身。

---

## 3. 实现思路

### 3.1 组件分层

```
EpubSelectionPopBar
├── Popover / PopoverAnchor（选区锚点 x,y）
├── PopoverContent（透明壳，group/pop 供 side 翻转）
└── 相对定位 wrapper
    ├── drop-shadow-(--shadow-drop-*)   ← 外层投影（含箭头轮廓）
    ├── 毛玻璃面板 div（ref=toolbarRef，测宽算箭头）
    │   └── EpubQuoteActionBar variant=floating（纯 flex 按钮行）
    └── PopBarCaret（双 SVG：默认朝下 / side=bottom 朝上）
```

**为何不把样式 export 给 ActionBar**：用户要求样式 **写在对应 DOM 上**；PopBar 外壳与 drawer/inline 引用条无关，集中在 `EpubSelectionPopBar` 更易维护。

### 3.2 面板色：为何用 `--theme-card`

- `--theme-background` 与 EPUB 阅读页背景（尤其 **theme-black**）常几乎同色，面板边界难辨认。
- `--theme-card` 在暗色主题中比 background **略亮**（设计令牌本意即为「抬升表面」），92%～95% 不透明 + `backdrop-blur-md` 即可在 **不加 border** 的前提下区分层次。

### 3.3 箭头：SVG 而非 border / 旋转方块

| 方案 | 问题 |
|------|------|
| `border` 三角形 + `borderTopColor: 'bg-theme/10'` | Tailwind 类名不是 CSS 颜色，**不生效** |
| 独立 div + 同 class 旋转 45° | 两层 `backdrop-filter` 在接缝处 **分层** |
| 父级 `::after` 伪元素 | 箭头尖在 padding 外时 backdrop 覆盖不完整，仍易分层 |

**最终**：两个 SVG path（Popover 在选区**上方**时用朝下三角；碰撞翻转 `side=bottom` 时用朝上三角），`fill` 与面板相同的 `color-mix(..., var(--theme-card) ...)`，`top/bottom: calc(100%-1px)` 与主体 **重叠 1px** 减轻接缝。

### 3.4 阴影令牌拆分（`index.css`）

原 `--shadow-10: 0 0 10px rgba(...)` 是 **完整 box-shadow**，不能放进 `color-mix(..., var(--shadow-10), ...)`。

拆为：

- `--shadow-color-{n}`：纯 **颜色**（浅色主题黑 0.2 alpha；深色 / theme-black 白 0.28 alpha，比旧 0.5 柔和）。
- `--shadow-{n}`：保留 **四周光晕**（`0 0 Npx var(--shadow-color-n)`），供 `shadow-(--shadow-2)` 等既有用法（如 `win/index.tsx`）。
- `--shadow-drop-{n}`：**定向**投影（如 `--shadow-drop-10: 0 4px 10px var(--shadow-color-10)`），供 PopBar `drop-shadow-(--shadow-drop-*)`。

`@theme inline` 注册 `--shadow-drop-*`，Tailwind v4 才能识别 `drop-shadow-(--shadow-drop-8)`。

### 3.5 箭头水平位置

1. 锚点 `state.x` 为选区中心视口 X。
2. `toolbarRef.getBoundingClientRect()` 得面板宽与 left。
3. `clampArrowLeft` 限制箭头距面板左右至少 `ARROW_EDGE_PADDING=10px`，避免贴边。
4. Popover 布局未稳定前 **8 帧 rAF** 再测量；之后 `resize` + `ResizeObserver` 跟随面板宽度变化。

### 3.6 曾尝试且放弃的方案（便于后续勿回退）

- PopBar **边框** / 箭头 **stroke**：产品明确不要边框。
- `--shadow-10` 直接作 drop-shadow 颜色：无效 CSS。
- 双层 `drop-shadow` + 面板 `box-shadow` 叠加：浅色主题过黑。
- `POP_BAR_*` 常量从 ActionBar export：已改为元素 className 直写。

---

## 4. 关键代码与注释

### 4.1 箭头组件 `PopBarCaret`

**来源**：`apps/frontend/src/views/ebook/components/EpubSelectionPopBar.tsx`（约 L26–L81）

```tsx
// 箭头距 PopBar 左右边缘的最小留白（px），防止三角贴圆角
const ARROW_EDGE_PADDING = 10;
// SVG 三角底边宽度（px）
const ARROW_WIDTH = 14;
// SVG 三角高度（px）
const ARROW_HEIGHT = 7;

// 将选区锚点 x 映射到面板内的局部 x，并 clamp 到 [padding, width-padding]
function clampArrowLeft(
	toolbarLeft: number,
	toolbarWidth: number,
	anchorX: number,
) {
	const min = ARROW_EDGE_PADDING;
	const max = toolbarWidth - ARROW_EDGE_PADDING;
	return Math.max(min, Math.min(max, anchorX - toolbarLeft));
}

// 仅负责绘制指向选区的三角 caret（不含按钮）
function PopBarCaret({ left }: { left: number }) {
	return (
		<>
			{/* Popover 默认 side=top：条在选区上方，箭头向下 */}
			<svg
				aria-hidden
				className={cn(
					// 不参与点击，避免抢选区
					'pointer-events-none absolute -translate-x-1/2',
					// 向下 overlap 1px，减轻与面板底边的视觉缝
					'top-[calc(100%-1px)]',
					// Popover 翻到选区下方时隐藏此 SVG
					'group-data-[side=bottom]/pop:hidden',
				)}
				style={{ left }}
				width={ARROW_WIDTH}
				height={ARROW_HEIGHT}
				viewBox={`0 0 ${ARROW_WIDTH} ${ARROW_HEIGHT}`}
			>
				<title>Caret</title>
				<path
					d={`M0 0 H${ARROW_WIDTH} L${ARROW_WIDTH / 2} ${ARROW_HEIGHT} Z`}
					// 与面板 bg 同色：theme-card 92% 不透明（与下方 shell 保持一致）
					fill="color-mix(in oklch, var(--theme-card) 95%, transparent)"
				/>
			</svg>
			{/* side=bottom：条在选区下方，箭头向上 */}
			<svg
				aria-hidden
				className={cn(
					'pointer-events-none absolute hidden -translate-x-1/2',
					'bottom-[calc(100%-1px)]',
					'group-data-[side=bottom]/pop:block',
				)}
				style={{ left }}
				width={ARROW_WIDTH}
				height={ARROW_HEIGHT}
				viewBox={`0 0 ${ARROW_WIDTH} ${ARROW_HEIGHT}`}
			>
				<title>Caret</title>
				<path
					d={`M0 ${ARROW_HEIGHT} H${ARROW_WIDTH} L${ARROW_WIDTH / 2} 0 Z`}
					fill="color-mix(in oklch, var(--theme-card) 95%, transparent)"
				/>
			</svg>
		</>
	);
}
```

### 4.2 锚点样式与箭头测距

**来源**：`apps/frontend/src/views/ebook/components/EpubSelectionPopBar.tsx`（约 L99–L173）

```tsx
// 固定锚点 inline style：选区中心坐标来自 epubSelectionToolbarAttach
const anchorStyle = useMemo(
	() =>
		// state 为空时不渲染 Popover，此处恒有 state
		state
			? ({
					// fixed 相对视口，与 iframe 内选区换算后的 client 坐标一致
					position: 'fixed',
					// 选区中心 X（视口 px）
					left: state.x,
					// 选区锚点 Y（视口 px）
					top: state.y,
					// 宽高 1px：Radix 把 content 对齐到此点
					width: 1,
					height: 1,
					// 不拦截鼠标，避免挡 EPUB 选区
					pointerEvents: 'none',
				} as const)
			: undefined,
	// 仅当选区坐标变时重算
	[state],
);

// 指向面板容器，用于 getBoundingClientRect 量宽
const toolbarRef = useRef<HTMLDivElement>(null);
// 是否已完成首次稳定定位（避免 settle 前 relayout 写脏数据）
const isPlacedRef = useRef(false);
// null = 尚未量到箭头；有值后才显示 caret 并去掉 opacity-0
const [layout, setLayout] = useState<{ arrowLeft: number } | null>(null);

// 根据当前 DOM 计算箭头在面板内的 left（px）
const measureArrowLeft = useCallback((): number | null => {
	// 取毛玻璃面板 div（非外层 drop-shadow wrapper）
	const toolbar = toolbarRef.current;
	// 未挂载或 PopBar 已关：不测量
	if (!toolbar || !state?.open) return null;
	// 视口坐标下的面板矩形
	const rect = toolbar.getBoundingClientRect();
	// Popover 尚未布局完：宽为 0，跳过
	if (rect.width === 0) return null;
	// 把全局 state.x 转为相对面板 left 的局部坐标并 clamp
	return clampArrowLeft(rect.left, rect.width, state.x);
}, [state?.open, state?.x]);

useLayoutEffect(() => {
	// PopBar 关闭：重置箭头与 placed 标记
	if (!state?.open) {
		isPlacedRef.current = false;
		setLayout(null);
		return;
	}

	// 重新打开：先清 placed，隐藏 caret 直到 settle 完成
	isPlacedRef.current = false;
	setLayout(null);

	let cancelled = false;
	let rafId = 0;
	let frame = 0;

	// Radix Popover 碰撞/定位需数帧才稳定，先跑 8 帧 rAF 再量
	const settlePlacement = () => {
		if (cancelled) return;
		frame += 1;
		if (frame < 8) {
			rafId = requestAnimationFrame(settlePlacement);
			return;
		}
		const arrowLeft = measureArrowLeft();
		if (arrowLeft == null) return;
		isPlacedRef.current = true;
		setLayout({ arrowLeft });
	};

	rafId = requestAnimationFrame(settlePlacement);

	// 窗口缩放：已 placed 后微调箭头
	const onRelayout = () => {
		if (!isPlacedRef.current) return;
		const arrowLeft = measureArrowLeft();
		if (arrowLeft == null) return;
		setLayout({ arrowLeft });
	};

	window.addEventListener('resize', onRelayout);

	const toolbarEl = toolbarRef.current;
	let observer: ResizeObserver | null = null;
	if (toolbarEl) {
		// 面板宽度变化（分栏拖拽/字体）时更新箭头
		observer = new ResizeObserver(onRelayout);
		observer.observe(toolbarEl);
	}

	return () => {
		cancelled = true;
		cancelAnimationFrame(rafId);
		window.removeEventListener('resize', onRelayout);
		observer?.disconnect();
	};
}, [state?.open, state?.x, measureArrowLeft]);
```

### 4.3 PopBar 外壳 JSX（毛玻璃 + 阴影 + 圆角）

**来源**：`apps/frontend/src/views/ebook/components/EpubSelectionPopBar.tsx`（约 L177–L212）

```tsx
// 组件 render：state.open 为 false 时已在上方 return null
return (
	// Radix Popover 根：open 受控于选区 state，无 Trigger 仅 Anchor
	<Popover open={state.open}>
		// 锚点：asChild 把 props 合并到子 span
		<PopoverAnchor asChild>
			// 1×1 透明 fixed 点，left/top = 选区中心；不参与指针事件
			<span aria-hidden style={anchorStyle} />
		</PopoverAnchor>
		// 浮动内容层：Portal 到 body，带碰撞检测
		<PopoverContent
			// 优先出现在选区上方
			side="top"
			// 水平居中对齐锚点
			align="center"
			// 与选区间隙 10px
			sideOffset={10}
			// 距视口边缘至少 12px，不够则 flip side
			collisionPadding={12}
			className={cn(
				// group/pop：子元素用 group-data-[side=bottom]/pop 响应翻转
				'group/pop z-50 w-auto border-0 bg-transparent p-0 shadow-none outline-none',
				// layout 未算完：隐藏且禁止点击，避免闪动
				!layout && 'pointer-events-none opacity-0',
			)}
			// 不抢焦点到 Popover，保持 EPUB iframe 选区
			onOpenAutoFocus={(e) => e.preventDefault()}
			onCloseAutoFocus={(e) => e.preventDefault()}
			// 同上：mousedown 也不抢焦点
			onMouseDown={(e) => e.preventDefault()}
		>
			// 投影容器：filter drop-shadow 作用于整块 alpha（条+箭头）
			<div className="relative drop-shadow-(--shadow-drop-8)">
				// 毛玻璃面板：ref 供 measureArrowLeft；四角 rounded-md
				<div
					ref={toolbarRef}
					className="rounded-md bg-[color-mix(in_oklch,var(--theme-card)_92%,transparent)] backdrop-blur-md backdrop-saturate-150"
				>
					// 纯按钮行，variant=floating 不带背景
					<EpubQuoteActionBar
						variant="floating"
						labels={labels}
						onCopy={onCopy}
						onWriteThought={onWriteThought}
						onAskBook={onAskBook}
						onAnyAction={onClearSelection}
					/>
				</div>
				// layout 就绪后才挂载 caret，避免 left 未定义
				{layout ? <PopBarCaret left={layout.arrowLeft} /> : null}
			</div>
		</PopoverContent>
	</Popover>
);
```

### 4.4 `EpubQuoteActionBar` 浮动变体（仅布局）

**来源**：`apps/frontend/src/views/ebook/components/EpubQuoteActionBar.tsx`（约 L66–L71、L120–L161、L209–L221）

```tsx
// CONTAINER_CLASS：按 variant 决定外层 flex 布局
const CONTAINER_CLASS: Record<BarVariant, string> = {
	// drawer：右侧面板引用区，占满父级高度
	drawer: 'flex h-full w-full min-w-0 items-stretch',
	// inline：想法卡片内引用条，带边框与浅底
	inline:
		'flex w-full min-w-0 items-stretch overflow-hidden rounded-md border border-theme/10 bg-theme/5',
	// floating：PopBar 内仅横向排按钮，背景由 EpubSelectionPopBar 提供
	floating: 'flex items-center px-0.5',
};

// QuoteActionItem：单个图标+文案按钮
function QuoteActionItem({ variant, label, onClick, copied, children }: ...) {
	return (
		<button
			type="button"
			onClick={onClick}
			// floating 六项等宽 70px，与 PopBar 总宽匹配
			style={variant === 'floating' ? { width: 70 } : undefined}
			className={cn(
				ITEM_BUTTON_CLASS[variant],
				onClick ? ITEM_ACTIVE_CLASS[variant] : ITEM_DISABLED_CLASS[variant],
				// 复制成功时整项 teal 高亮
				copied && 'text-teal-500',
			)}
		>
			<span className={ICON_WRAP_CLASS[variant]}>{children}</span>
			<span className={cn(LABEL_CLASS[variant], copied && 'text-teal-500')}>
				{label}
			</span>
		</button>
	);
}

// buildOnClick：floating 时在业务回调后再清选区
const buildOnClick = (id: ActionId, handler?: () => void) => {
	const action = id === 'copy' ? handleCopy : handler;
	if (variant === 'floating' && onAnyAction) {
		return () => {
			action?.();
			if (id === 'copy') {
				// COPY_SUCCESS_MS=1000：先展示 CheckCircle +「已复制」
				window.setTimeout(() => onAnyAction(), COPY_SUCCESS_MS);
			} else {
				onAnyAction();
			}
		};
	}
	return action;
};
```

### 4.5 阴影令牌（`:root` 示例；各 theme 块同结构）

**来源**：`apps/frontend/src/index.css`（约 L446–L460；`.theme-black` 约 L646–L661）

```css
/* 阴影「颜色」层：供 glow 与 drop 共用 */
--shadow-color-2: rgba(0, 0, 0, 0.2);
--shadow-color-4: rgba(0, 0, 0, 0.2);
--shadow-color-6: rgba(0, 0, 0, 0.2);
--shadow-color-8: rgba(0, 0, 0, 0.2);
--shadow-color-10: rgba(0, 0, 0, 0.2);
/* 原有四周光晕：0 0 blur，供 shadow-(--shadow-N) */
--shadow-2: 0 0 2px var(--shadow-color-2);
--shadow-4: 0 0 4px var(--shadow-color-4);
--shadow-6: 0 0 6px var(--shadow-color-6);
--shadow-8: 0 0 8px var(--shadow-color-8);
--shadow-10: 0 0 10px var(--shadow-color-10);
/* 定向投影：Y 偏移 + blur，供 drop-shadow-(--shadow-drop-N) */
--shadow-drop-2: 0 2px 4px var(--shadow-color-2);
--shadow-drop-4: 0 3px 6px var(--shadow-color-4);
--shadow-drop-6: 0 4px 8px var(--shadow-color-6);
--shadow-drop-8: 0 4px 9px var(--shadow-color-8);
--shadow-drop-10: 0 4px 10px var(--shadow-color-10);
```

```css
/* .theme-black / .dark：浅色 shadow-color，PopBar 在纯黑阅读页仍可见 */
--shadow-color-10: rgba(255, 255, 255, 0.28);
--shadow-drop-10: 0 4px 10px var(--shadow-color-10);
/* ... shadow-2～shadow-10 同理引用 --shadow-color-* ... */
```

**来源**：`apps/frontend/src/index.css`（`@theme inline`，约 L1180–L1190）

```css
@theme inline {
	/* 向 Tailwind 暴露 drop-shadow 令牌 */
	--shadow-drop-2: var(--shadow-drop-2);
	--shadow-drop-4: var(--shadow-drop-4);
	--shadow-drop-6: var(--shadow-drop-6);
	--shadow-drop-8: var(--shadow-drop-8);
	--shadow-drop-10: var(--shadow-drop-10);
	--shadow-2: var(--shadow-2);
	/* ... */
}
```

---

## 5. 兼容性与影响

| 项 | 说明 |
|----|------|
| drawer / inline ActionBar | 不受影响；仍用 `border-theme/10` 等原有样式 |
| `shadow-(--shadow-N)` 既有用法 | `--shadow-N` 仍定义为完整 shadow 字符串，**行为保持** |
| 主题切换 | `--shadow-color-*` 随 `.dark` / `.theme-*` 切换；PopBar 无需改 class |
| 性能 | `backdrop-filter` 仅一块面板；箭头为静态 SVG，无额外 blur |
| a11y | SVG 带 `<title>Caret</title>`；装饰性 `aria-hidden` |

---

## 6. 回归建议

1. **theme-black + 黑色 EPUB 背景**：选字 → PopBar 边界可辨、箭头与面板同色、阴影向下不过亮。
2. **theme-purple / theme-green 等浅色主题**：阴影非四周黑圈，图标区不被脏影遮挡。
3. **选区贴左/贴右**：箭头仍距边缘 ≥10px，不裁切圆角。
4. **Popover 碰撞翻转**（空间不足时条到选区下方）：仅显示 **向上** SVG。
5. **复制**：浮动条显示「已复制」约 1s 后再清除 EPUB 选区。
6. **窗口 resize / 分栏拖拽**：箭头仍指向选区中心 X。

---

## 7. 相关源码路径

| 说明 | 路径 |
|------|------|
| PopBar 视觉外壳 | `apps/frontend/src/views/ebook/components/EpubSelectionPopBar.tsx` |
| 操作按钮（floating 布局） | `apps/frontend/src/views/ebook/components/EpubQuoteActionBar.tsx` |
| 选区坐标 attach | `apps/frontend/src/views/ebook/utils/epubSelectionToolbarAttach.ts` |
| 阴影设计令牌 | `apps/frontend/src/index.css` |
| 阅读页挂载 | `apps/frontend/src/views/ebook/read.tsx`、`EpubPane.tsx` |

---

## 8. 后续可调参数（运维/设计）

| 位置 | 键 | 作用 |
|------|-----|------|
| `EpubSelectionPopBar` 面板 class | `var(--theme-card)_92%` | 不透明度 ↑ 更清晰、↓ 更透 |
| 同上 | `backdrop-blur-md` | 模糊强度 |
| wrapper | `drop-shadow-(--shadow-drop-8)` | 可改为 `-10` 略加重 |
| `index.css` | `--shadow-color-10` alpha | 深色主题阴影强弱 |
| `PopBarCaret` | `ARROW_EDGE_PADDING` | 箭头水平安全边距 |
