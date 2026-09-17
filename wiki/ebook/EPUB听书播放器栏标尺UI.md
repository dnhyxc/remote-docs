# EPUB 听书播放条：刻度倍速与分句虚拟列表

> **文档角色**：本轮 `EpubListenPlayerBar` UI 升级的实现说明（刻度尺倍速 + 分句虚拟列表 +「滚到当前句」）。  
> **延伸阅读**：[EPUB听书播放器栏.md](./EPUB听书播放器栏.md)（首版分句菜单与倍速）、[电子书列表滚动循环.md](./电子书列表滚动循环.md)（**后续**：分句/目录三态滚动按钮，替代仅「手动滚后才显示滚到当前句」）、[../impact/EPUB听书播放器栏UI影响.md](../impact/EPUB听书播放器栏UI影响.md)（影响面）、[电子书书架空标签重置影响.md](./电子书书架空标签重置影响.md)（同轮书架改动，独立专题）。

## 1. 背景与目标

听书 / 听当前共用底部播放条。旧版存在两类体验问题：

1. **分句列表**：长章数百句时一次性渲染全部 `DropdownMenuItem`，滚动卡顿；列表左右 padding 不对称；用户手动滚动后无法快速回到正在播放的句子。
2. **倍速选择**：离散网格档位（`CHAPTER_LISTEN_RATES`），最小 0.75×，无法细调；与参考 UI 的刻度尺 + 圆形预设不一致。

本轮目标：分句菜单改 **虚拟列表** + **ScrollArea** 对称 bleed；倍速改 **0.5×～3.0×、0.1 步进** 的 **刻度尺拖拽** + **预设圆钮**；指示器与刻度 **中心对齐**（含 0.5 / 3.0 边界）。

## 2. 改动范围

| 路径 | 说明 |
| ---- | ---- |
| `apps/frontend/src/views/ebook/components/listen/EpubListenPlayerBar.tsx` | 刻度尺常量/工具函数、`EpubListenRatePanel`、`VirtualSentenceMenuList`、播放条接线 |
| `apps/frontend/src/i18n/locales/zh-CN.ts` | `scrollToCurrentSentence` |
| `apps/frontend/src/i18n/locales/en-US.ts` | 同上英文 |
| `apps/frontend/src/views/ebook/utils/epub/reader/epubReaderSettings.ts` | 分句选中样式 `bg-theme/15 text-theme`（与目录抽屉一致） |

**未改但相关**：`useEpubChapterListen.ts` 仍导出 `CHAPTER_LISTEN_RATES`，UI 已不再引用；TTS 层仍接受任意 `rate` 数值。

## 3. 实现思路

1. **刻度几何**：`RATE_RULER_MIN=0.5`、`MAX=3`、`STEP=0.1`；长刻度每 `0.5`（5 格 = 4 短 + 1 长）。`RULER_INSET_PX=6` 使 0 / max 刻度与指示器按 **中心** 贴边可选。
2. **指针 → 倍速**：`indexFromTrackClientX` 在 inset 内线性映射，边界 clamp 到 0 / `STEP_COUNT`；`rateFromTrackClientX` 反算倍速并 `toFixed(1)`。
3. **指示器样式**：`rulerPositionStyle` 用 `calc(inset + (100% - 2*inset) * t)` + `translateX(-50%)`；三角 `border-t-teal-500` 与 `w-0.5` 竖线 `-mt-px` 消除间隙。
4. **虚拟分句**：固定行高 `40px`，只渲染 `[first, last)` 窗口 + `overscan=5`；绝对定位 `top: index * stride` 保持总高度虚拟滚动。
5. **滚到当前句**：`userScrolledRef` 区分手动 / 程序滚动；手动滚动后标题栏显示 `LocateFixed` 按钮；切句时若未手动滚则 `scrollToIndex` 跟随。
6. **对称 bleed**：外层 `-mx-1 w-[calc(100%+0.5rem)]`，ScrollArea `px-1`，抵消 Dropdown 默认 padding 造成的左右不对称。

## 4. 关键代码对比与注释

### 4.1 `formatListenRate`（`EpubListenPlayerBar.tsx`）

**对比范围**：倍速展示字符串格式化函数全函数。

**改动前** · `apps/frontend/src/views/ebook/components/listen/EpubListenPlayerBar.tsx`（基线，约 L33–L35）

```typescript
// 将倍速数字格式化为触发器按钮上的展示文案
function formatListenRate(value: number): string {
	// 旧版固定一位小数省略，直接拼接「 X」后缀（如 1 X、1.5 X）
	return `${value} X`;
}
```

**改动后** · `apps/frontend/src/views/ebook/components/listen/EpubListenPlayerBar.tsx`（当前，约 L31–L33）

```typescript
// 将倍速数字格式化为触发器与刻度标签上的展示文案
function formatListenRate(value: number): string {
	// 统一保留一位小数并拼接「 X」，与刻度尺标签和预设圆钮视觉一致
	return `${value.toFixed(1)} X`;
}
```

**变更摘要**：展示始终一位小数（`1.0 X`），与刻度尺标签对齐。

---

### 4.2 倍速弹出层（`EpubListenPlayerBar` 内 `DropdownMenuContent`）

**对比范围**：播放条右侧倍速 `DropdownMenu` 的内容区（触发器未改，仅内容替换）。

**改动前** · `apps/frontend/src/views/ebook/components/listen/EpubListenPlayerBar.tsx`（基线，约 L414–L441）

```typescript
// ...（未改动）EpubListenPlayerBar 中 rateOpen / handleRateOpenChange / DropdownMenuTrigger 与 formatListenRate(rate) 触发器
				<DropdownMenuContent
					// 菜单向上弹出，右对齐播放条
					side="top"
					align="end"
					// 最窄约 9rem，内边距 p-1，并套用阅读 chrome 菜单皮肤
					className={cn('z-50 min-w-36 p-1', epubReaderChromeMenuContentClass)}
					// 背景/边框/字色随阅读设置 CSS 变量
					style={menuChromeStyle}
				>
					<DropdownMenuLabel className="text-textcolor/45 px-4.5 pb-3 pt-2 text-center text-xs font-normal">
						{/* 倍速标题文案 */}
						{t('ebook.read.listenBook.speed')}
					</DropdownMenuLabel>
					<div className="grid grid-cols-2 gap-1 px-0.5 pb-0.5">
						{/* 遍历 CHAPTER_LISTEN_RATES 离散档位（含 0.75、1、1.25…） */}
						{CHAPTER_LISTEN_RATES.map((r) => {
							// 当前 rate 与档位相等则高亮
							const selected = r === rate;
							return (
								<DropdownMenuItem
									key={r}
									className={cn(
										'min-w-0 justify-center rounded-md px-2 py-1.5 text-xs tabular-nums transition-colors',
										selected
											? epubReaderChromeListItemActiveClass
											: epubReaderChromeListItemIdleClass,
									)}
									// 选中该档位时通知上层 onRateChange
									onSelect={() => onRateChange(r)}
								>
									{formatListenRate(r)}
								</DropdownMenuItem>
							);
						})}
					</div>
				</DropdownMenuContent>
// ...（未改动）DropdownMenu 闭合与后续上一句/下一句按钮
```

**改动后** · `apps/frontend/src/views/ebook/components/listen/EpubListenPlayerBar.tsx`（当前，约 L704–L714）

```typescript
// ...（未改动）rateOpen / handleRateOpenChange / DropdownMenuTrigger 与 formatListenRate(rate)
				<DropdownMenuContent
					// 菜单向上弹出，右对齐播放条
					side="top"
					align="end"
					// 加宽至 w-80，去掉默认 p-1，由 EpubListenRatePanel 自控内边距
					className={cn(
						'z-50 w-80 overflow-hidden p-0',
						epubReaderChromeMenuContentClass,
					)}
					// 背景/边框/字色随阅读设置 CSS 变量
					style={menuChromeStyle}
				>
					{/* 刻度尺 + 预设圆钮面板，rate/onRateChange 透传 */}
					<EpubListenRatePanel rate={rate} onRateChange={onRateChange} />
				</DropdownMenuContent>
// ...（未改动）DropdownMenu 闭合
```

**变更摘要**：离散 2 列网格 → 独立 `EpubListenRatePanel`（刻度尺 0.5–3.0、0.1 步进 + 预设 `[1,1.5,2,2.5,3]`）。

---

### 4.3 `buildRateRulerTicks`（纯新增）

**对比范围**：生成刻度尺 tick 索引与长短刻度标记的全函数（纯新增，无改动前块）。

**改动后** · `apps/frontend/src/views/ebook/components/listen/EpubListenPlayerBar.tsx`（当前，约 L53–L63）

```typescript
// 根据总步数 stepCount 生成刻度数组（含长/短刻度标记）
function buildRateRulerTicks(stepCount: number): RateRulerTick[] {
	// 空数组，按 major 块逐段填充
	const ticks: RateRulerTick[] = [];
	// base 从 0 到 stepCount，每次跳 RATE_RULER_SPACES（5 格 = 0.5x）
	for (let base = 0; base <= stepCount; base += RATE_RULER_SPACES) {
		// 每个 major 块起点为长刻度
		ticks.push({ index: base, major: true });
		// 块内 1..SPACES-1 为短刻度
		for (let j = 1; j < RATE_RULER_SPACES; j += 1) {
			// 当前短刻度绝对索引
			const idx = base + j;
			// 不超出总步数则追加短刻度
			if (idx <= stepCount) ticks.push({ index: idx, major: false });
		}
	}
	// 返回完整 tick 列表供 map 渲染
	return ticks;
}
```

---

### 4.4 `indexFromTrackClientX`（纯新增）

**对比范围**：指针 clientX → 刻度索引的全函数。

**改动后** · `apps/frontend/src/views/ebook/components/listen/EpubListenPlayerBar.tsx`（当前，约 L84–L92）

```typescript
// 根据轨道 DOM 与指针 clientX 计算刻度索引（0..STEP_COUNT）
function indexFromTrackClientX(track: HTMLDivElement, clientX: number): number {
	// 轨道布局矩形
	const rect = track.getBoundingClientRect();
	// 可拖拽区间宽度 = 总宽 − 左右 inset
	const travel = rect.width - RULER_INSET_PX * 2;
	// 无有效宽度时回退索引 0
	if (travel <= 0) return 0;
	// 指针在左 inset 以左 → 最小倍速索引 0
	if (clientX <= rect.left + RULER_INSET_PX) return 0;
	// 指针在右 inset 以右 → 最大倍速索引 STEP_COUNT
	if (clientX >= rect.right - RULER_INSET_PX) return RATE_RULER_STEP_COUNT;
	// inset 内线性比例 0..1
	const ratio = (clientX - rect.left - RULER_INSET_PX) / travel;
	// 四舍五入到最近步并 clamp
	return Math.round(Math.min(1, Math.max(0, ratio)) * RATE_RULER_STEP_COUNT);
}
```

---

### 4.5 `EpubListenRatePanel`（纯新增）

**对比范围**：倍速刻度尺面板组件全函数（声明 → 闭合）。

**改动后** · `apps/frontend/src/views/ebook/components/listen/EpubListenPlayerBar.tsx`（当前，约 L104–L262）

```typescript
// 听书倍速刻度尺面板：大号读数 + 拖拽轨道 + 圆形预设
function EpubListenRatePanel({
	// 当前播放倍速
	rate,
	// 倍速变更回调（拖拽/键盘/预设点击）
	onRateChange,
}: {
	rate: number;
	onRateChange: (rate: number) => void;
}) {
	// i18n 文案
	const { t } = useI18n();
	// 刻度轨道 DOM，供 clientX 换算
	const trackRef = useRef<HTMLDivElement>(null);
	// 是否正在 pointer 拖拽
	const draggingRef = useRef(false);
	// 当前 rate 对应的刻度索引，驱动指示器位置
	const indicatorIndex = listenRateToTickIndex(rate);
	// 指示器 left/transform 样式
	const indicatorStyle = rulerPositionStyle(indicatorIndex);

	// 从指针 X 坐标更新倍速
	const setRateFromPointer = useCallback(
		(clientX: number) => {
			// 轨道未挂载则忽略
			const track = trackRef.current;
			if (!track) return;
			// clientX → 倍速并上报
			onRateChange(rateFromTrackClientX(track, clientX));
		},
		// 依赖 onRateChange
		[onRateChange],
	);

	// pointerdown：开始拖拽并立即跳转到点击位置
	const handleTrackPointerDown = useCallback(
		(e: React.PointerEvent<HTMLDivElement>) => {
			// 阻止默认与冒泡，避免关闭 Dropdown
			e.preventDefault();
			e.stopPropagation();
			// 标记拖拽中
			draggingRef.current = true;
			// 捕获指针以便 track 外 move 仍收到事件
			e.currentTarget.setPointerCapture(e.pointerId);
			// 按下即设倍速
			setRateFromPointer(e.clientX);
		},
		[setRateFromPointer],
	);

	// pointermove：拖拽中连续更新倍速
	const handleTrackPointerMove = useCallback(
		(e: React.PointerEvent<HTMLDivElement>) => {
			// 非拖拽态忽略
			if (!draggingRef.current) return;
			setRateFromPointer(e.clientX);
		},
		[setRateFromPointer],
	);

	// pointerup / cancel：结束拖拽并释放 capture
	const handleTrackPointerUp = useCallback(
		(e: React.PointerEvent<HTMLDivElement>) => {
			draggingRef.current = false;
			if (e.currentTarget.hasPointerCapture(e.pointerId)) {
				e.currentTarget.releasePointerCapture(e.pointerId);
			}
		},
		[],
	);

	// 键盘左右/上下微调 0.1 步进
	const handleTrackKeyDown = useCallback(
		(e: React.KeyboardEvent<HTMLDivElement>) => {
			let delta = 0;
			if (e.key === 'ArrowRight' || e.key === 'ArrowUp')
				delta = RATE_RULER_STEP;
			else if (e.key === 'ArrowLeft' || e.key === 'ArrowDown')
				delta = -RATE_RULER_STEP;
			if (!delta) return;
			e.preventDefault();
			onRateChange(
				clampListenRate(Number(snapRateToRuler(rate + delta).toFixed(1))),
			);
		},
		[onRateChange, rate],
	);

	return (
		<div className="px-3 pt-2 pb-3" onPointerDown={(e) => e.stopPropagation()}>
			<div className="text-textcolor/45 text-sm font-normal mb-2.5">
				{t('ebook.read.listenBook.speed')}
			</div>
			<div className="bg-theme/5 px-4.5 pt-2 pb-3.5 rounded-md">
				<p className="text-textcolor text-center text-3xl font-semibold tabular-nums">
					{formatListenRate(snapRateToRuler(rate))}
				</p>

				<div className="relative mt-5">
					<div
						ref={trackRef}
						role="slider"
						tabIndex={0}
						aria-label={t('ebook.read.listenBook.speed')}
						aria-valuemin={RATE_RULER_MIN}
						aria-valuemax={RATE_RULER_MAX}
						aria-valuenow={clampListenRate(rate)}
						aria-valuetext={formatListenRate(rate)}
						className="relative cursor-pointer touch-none outline-none focus-visible:ring-teal-500/40 rounded-sm focus-visible:ring-2"
						onPointerDown={handleTrackPointerDown}
						onPointerMove={handleTrackPointerMove}
						onPointerUp={handleTrackPointerUp}
						onPointerCancel={handleTrackPointerUp}
						onKeyDown={handleTrackKeyDown}
					>
						<div className="pointer-events-none relative h-7">
							<div className="absolute inset-x-0 bottom-0 h-5">
								{buildRateRulerTicks(RATE_RULER_STEP_COUNT).map(
									({ index, major }) => (
										<span
											key={index}
											className={cn(
												'absolute bottom-0 w-px bg-textcolor/25',
												major ? 'h-5' : 'h-2.5',
											)}
											style={rulerPositionStyle(index)}
										/>
									),
								)}
							</div>
							<div
								className="absolute bottom-0 z-10 flex flex-col items-center gap-0 leading-none"
								style={indicatorStyle}
								aria-hidden
							>
								<span className="block size-0 shrink-0 border-x-[5px] border-x-transparent border-t-[6px] border-t-teal-500" />
								<span className="block h-5 w-0.5 shrink-0 bg-teal-500 -mt-px" />
							</div>
						</div>

						<div className="relative mt-1 h-4">
							{RATE_RULER_LABELS.map((label) => (
								<span
									key={label}
									className="text-textcolor/45 absolute whitespace-nowrap text-[10px] tabular-nums"
									style={rulerPositionStyle(listenRateToTickIndex(label))}
								>
									{formatListenRate(label)}
								</span>
							))}
						</div>
					</div>
				</div>

				<div className="mt-5 flex items-center justify-between gap-1">
					{RATE_PRESETS.map((preset) => {
						const selected = Math.abs(rate - preset) < 0.001;
						return (
							<button
								key={preset}
								type="button"
								className={cn(
									'cursor-pointer text-textcolor/70 size-9 shrink-0 rounded-full border text-xs tabular-nums transition-colors',
									selected
										? 'border-teal-500 text-textcolor font-medium'
										: 'border-textcolor/15 hover:border-textcolor/30 hover:text-textcolor',
								)}
								aria-label={formatListenRate(preset)}
								aria-pressed={selected}
								onClick={() => onRateChange(preset)}
							>
								{preset.toFixed(1)}
							</button>
						);
					})}
				</div>
			</div>
		</div>
	);
}
```

---

### 4.6 分句菜单内容（`EpubListenPlayerBar` 内 `DropdownMenuContent`）

**对比范围**：分句 `DropdownMenu` 打开后的内容区（旧版内联 `ScrollArea` + 全量 map；新版委托 `VirtualSentenceMenuList`）。

**改动前** · `apps/frontend/src/views/ebook/components/listen/EpubListenPlayerBar.tsx`（基线，约 L318–L365）

```typescript
// ...（未改动）DropdownMenuTrigger 与 sentenceOpen / handleSentenceOpenChange
				<DropdownMenuContent
					side="top"
					align="end"
					className={cn(
						'z-50 w-72 overflow-hidden p-1 pb-4',
						epubReaderChromeMenuContentClass,
					)}
					style={menuChromeStyle}
				>
					<DropdownMenuLabel className="text-textcolor/45 px-3 pt-2 pb-3 text-center text-xs font-normal">
						{t('ebook.read.listenBook.sentenceMenu')} （{sentenceIndex + 1}/
						{sentenceCount}）
					</DropdownMenuLabel>
					{sentenceLabels.length === 0 ? (
						<p className="text-textcolor/45 px-2 py-2 text-xs">
							{t('ebook.read.listenBook.sentenceMenuEmpty')}
						</p>
					) : (
						<ScrollArea
							ref={bindSentenceViewport}
							className="max-h-65 w-full min-h-0 border-0"
							viewportClassName="max-h-65 box-border pe-2 ps-1"
						>
							<div className="flex flex-col gap-1 pb-1">
								{sentenceLabels.map((label, index) => {
									const selected = index === sentenceIndex;
									const preview = truncateSentenceLabel(label);
									return (
										<DropdownMenuItem
											key={index}
											data-active-sentence={selected ? 'true' : undefined}
											aria-current={selected ? 'true' : undefined}
											className={cn(
												'min-w-0 scroll-my-1 items-start gap-2 rounded-md px-2 py-2 text-xs leading-snug transition-colors',
												selected
													? epubReaderChromeListItemActiveClass
													: epubReaderChromeListItemIdleClass,
											)}
											onSelect={() => onGoToSentence(index)}
										>
											<span
												className={cn(
													'shrink-0 tabular-nums',
													selected ? 'text-textcolor' : 'text-textcolor/45',
												)}
											>
												{index + 1}.
											</span>
											<span className="min-w-0 truncate">{preview}</span>
										</DropdownMenuItem>
									);
								})}
							</div>
						</ScrollArea>
					)}
				</DropdownMenuContent>
// ...（未改动）
```

**改动后** · `apps/frontend/src/views/ebook/components/listen/EpubListenPlayerBar.tsx`（当前，约 L625–L651）

```typescript
// ...（未改动）DropdownMenuTrigger；移除 bindSentenceViewport / queueScrollToActiveSentence
				<DropdownMenuContent
					side="top"
					align="end"
					className={cn(
						'z-50 w-72 overflow-hidden p-1 pb-4',
						epubReaderChromeMenuContentClass,
					)}
					style={menuChromeStyle}
				>
					{sentenceLabels.length === 0 ? (
						<>
							<DropdownMenuLabel className="text-textcolor/45 px-3 pt-2 pb-3 text-center text-xs font-normal">
								{t('ebook.read.listenBook.sentenceMenu')}
							</DropdownMenuLabel>
							<p className="text-textcolor/45 px-2 py-2 text-xs">
								{t('ebook.read.listenBook.sentenceMenuEmpty')}
							</p>
						</>
					) : (
						<VirtualSentenceMenuList
							labels={sentenceLabels}
							activeIndex={sentenceIndex}
							menuOpen={sentenceOpen}
							onSelect={onGoToSentence}
						/>
					)}
				</DropdownMenuContent>
// ...（未改动）
```

**变更摘要**：全量 DOM → `VirtualSentenceMenuList`；滚动跟随与「滚到当前句」逻辑迁入子组件。

---

### 4.7 `VirtualSentenceMenuList`（纯新增）

**对比范围**：虚拟分句列表组件全函数（声明 → 闭合）。

**改动后** · `apps/frontend/src/views/ebook/components/listen/EpubListenPlayerBar.tsx`（当前，约 L291–L471）

```typescript
// 长章分句虚拟列表：只渲染视口附近行，支持手动滚动后「滚到当前句」
function VirtualSentenceMenuList({
	// 当前章每句原文（用于截断预览）
	labels,
	// 正在播放的句子索引
	activeIndex,
	// 分句菜单是否打开（控制初始滚动）
	menuOpen,
	// 用户点选某句的回调
	onSelect,
}: {
	labels: string[];
	activeIndex: number;
	menuOpen: boolean;
	onSelect: (index: number) => void;
}) {
	// ScrollArea 视口 ref，读写 scrollTop
	const viewportRef = useRef<HTMLDivElement>(null);
	// 用户是否手动滚过列表（ref 供 effect 同步读）
	const userScrolledRef = useRef(false);
	// 程序滚动中，避免误判为用户滚动
	const programmaticScrollRef = useRef(false);
	// activeIndex 最新值 ref，供 timeout 回调读取
	const activeIndexRef = useRef(activeIndex);
	activeIndexRef.current = activeIndex;
	// 视口 scrollTop 状态，驱动虚拟窗口 first/last
	const [scrollTop, setScrollTop] = useState(0);
	// 是否显示「滚到当前句」按钮
	const [userScrolled, setUserScrolled] = useState(false);
	const { t } = useI18n();
	// 句子总数
	const total = labels.length;
	// 虚拟列表总高度 = 行数 × 行 stride
	const listHeight = total * SENTENCE_ROW_STRIDE_PX;

	// 将指定 index 滚入视口（可选 force 忽略 userScrolled）
	const scrollToIndex = useCallback(
		(index: number, opts?: { force?: boolean }) => {
			if (!opts?.force && userScrolledRef.current) return;
			const viewport = viewportRef.current;
			if (!viewport) return;
			programmaticScrollRef.current = true;
			scrollSentenceIndexIntoView(viewport, index, total);
			setScrollTop(viewport.scrollTop);
			requestAnimationFrame(() => {
				requestAnimationFrame(() => {
					programmaticScrollRef.current = false;
				});
			});
		},
		[total],
	);

	// 用户点击「滚到当前句」：清除手动标记并强制滚到 activeIndex
	const scrollToCurrent = useCallback(() => {
		userScrolledRef.current = false;
		setUserScrolled(false);
		scrollToIndex(activeIndexRef.current, { force: true });
	}, [scrollToIndex]);

	// 菜单打开时滚到当前句；关闭时重置 userScrolled
	useEffect(() => {
		if (!menuOpen) {
			userScrolledRef.current = false;
			setUserScrolled(false);
			return;
		}
		if (total <= 0) return;
		userScrolledRef.current = false;
		setUserScrolled(false);
		const index = activeIndexRef.current;
		let cancelled = false;
		let attempts = 0;
		const tryScroll = () => {
			if (cancelled) return;
			scrollToIndex(index, { force: true });
			const viewport = viewportRef.current;
			if (viewport && viewport.clientHeight > 0) return;
			attempts += 1;
			if (attempts < 24) requestAnimationFrame(tryScroll);
		};
		requestAnimationFrame(tryScroll);
		const t1 = window.setTimeout(() => {
			if (!cancelled) scrollToIndex(index, { force: true });
		}, 80);
		const t2 = window.setTimeout(() => {
			if (!cancelled) scrollToIndex(index, { force: true });
		}, 160);
		return () => {
			cancelled = true;
			window.clearTimeout(t1);
			window.clearTimeout(t2);
		};
	}, [menuOpen, total, scrollToIndex]);

	// 听书切句：用户未手动滚列表时才跟随
	useEffect(() => {
		if (!menuOpen || total <= 0 || userScrolledRef.current) return;
		scrollToIndex(activeIndex);
	}, [menuOpen, activeIndex, total, scrollToIndex]);

	// 视口 scroll 事件：更新 scrollTop；非程序滚动则标记 userScrolled
	const handleScroll = useCallback((e: React.UIEvent<HTMLDivElement>) => {
		setScrollTop(e.currentTarget.scrollTop);
		if (programmaticScrollRef.current) return;
		userScrolledRef.current = true;
		setUserScrolled(true);
	}, []);

	// 虚拟窗口起始行（含 overscan）
	const first = Math.max(
		0,
		Math.floor(scrollTop / SENTENCE_ROW_STRIDE_PX) - SENTENCE_LIST_OVERSCAN,
	);
	// 虚拟窗口结束行（不含，含 overscan）
	const last = Math.min(
		total,
		Math.ceil(
			(scrollTop + SENTENCE_LIST_VIEWPORT_MAX_PX) / SENTENCE_ROW_STRIDE_PX,
		) + SENTENCE_LIST_OVERSCAN,
	);

	return (
		<div className="-mx-1 w-[calc(100%+0.5rem)]">
			<DropdownMenuLabel className="pt-0 text-textcolor/45 px-3.5 pb-1.5 text-xs font-normal">
				<div className="h-9 flex items-center justify-between gap-2">
					<div className="min-w-0 truncate text-left">
						{t('ebook.read.listenBook.sentenceMenu')} （{activeIndex + 1}/
						{total}）
					</div>
					{userScrolled ? (
						<Tooltip
							content={t('ebook.read.listenBook.scrollToCurrentSentence')}
						>
							<Button
								type="button"
								variant="ghost"
								size="icon-sm"
								className="text-textcolor/55 size-7 shrink-0 bg-theme/5 hover:bg-theme/15 hover:text-textcolor/70 border border-theme/5 rounded-full"
								aria-label={t('ebook.read.listenBook.scrollToCurrentSentence')}
								onPointerDown={(e) => e.stopPropagation()}
								onClick={(e) => {
									e.preventDefault();
									e.stopPropagation();
									scrollToCurrent();
								}}
							>
								<LocateFixed className="size-3.5" aria-hidden />
							</Button>
						</Tooltip>
					) : null}
				</div>
			</DropdownMenuLabel>
			<ScrollArea
				ref={viewportRef}
				className="max-h-65 w-full"
				viewportClassName="max-h-65 overscroll-y-contain px-1 [&>div]:!block [&>div]:!min-h-0"
				scrollbarClassName="right-0"
				onScroll={handleScroll}
			>
				<div className="relative w-full pb-1" style={{ height: listHeight }}>
					{labels.slice(first, last).map((label, offset) => {
						const index = first + offset;
						const selected = index === activeIndex;
						const preview = truncateSentenceLabel(label);
						return (
							<DropdownMenuItem
								key={index}
								data-active-sentence={selected ? 'true' : undefined}
								aria-current={selected ? 'true' : undefined}
								className={cn(
									'absolute right-0 left-0 flex min-w-0 items-center gap-2 rounded-md px-2 py-2 text-xs leading-snug',
									selected
										? epubReaderChromeListItemActiveClass
										: epubReaderChromeListItemIdleClass,
								)}
								style={{
									top: index * SENTENCE_ROW_STRIDE_PX,
									height: SENTENCE_ROW_STRIDE_PX - 4,
								}}
								onSelect={() => onSelect(index)}
							>
								<span
									className={cn(
										'shrink-0 tabular-nums',
										!selected && 'text-textcolor/45',
									)}
								>
									{index + 1}.
								</span>
								<span className="min-w-0 truncate">{preview}</span>
							</DropdownMenuItem>
						);
					})}
				</div>
			</ScrollArea>
		</div>
	);
}
```

## 5. 兼容性与影响

| 项 | 说明 |
| ---- | ---- |
| 倍速范围 | UI 最小 **0.5×**（旧网格最小 0.75×）；最大仍为 3×；0.1 步进 |
| TTS | `onRateChange` 仍走原有 hook；云端即时倍速行为不变 |
| 听当前 | 共用同一 `EpubListenPlayerBar`，行为同步升级 |
| 性能 | 长章分句 DOM 从 O(n) 降至 O(视口)，滚动流畅 |
| 后续 | 可删除未使用的 `CHAPTER_LISTEN_RATES` 导出；`formatListenRate` 后缀 `X` 可考虑 i18n |

## 6. 回归建议

1. 听书 + 听当前：打开分句菜单，长章滚动流畅；切句时列表跟随；手动滚后点「滚到当前句」。
2. 倍速：拖拽 0.5 / 3.0 边界；预设圆钮；键盘方向键；云端当前句即时变速。
3. 阅读 chrome：粉/米背景下分句选中 `bg-theme/15` 可读。

## 7. 相关源码路径

| 说明 | 路径 |
| ---- | ---- |
| 播放条主组件 | `apps/frontend/src/views/ebook/components/listen/EpubListenPlayerBar.tsx` |
| 分句选中样式 | `apps/frontend/src/views/ebook/utils/epub/reader/epubReaderSettings.ts` |
| i18n | `apps/frontend/src/i18n/locales/zh-CN.ts`、`en-US.ts` |

---

（若与仓库最新源码不一致，以源码为准）
