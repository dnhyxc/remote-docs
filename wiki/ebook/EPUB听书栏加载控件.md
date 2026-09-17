# EPUB 听书底栏：loading 时右侧操作保持可用

> **文档角色**：听书播放条在句间 / TTS 等待（`status === 'loading'`）时，右侧分句、上下章、倍速不再禁用，且倍速 pop 不因 loading 被强制关闭。  
> **延伸阅读**：[EPUB听书等待加载.md](./EPUB听书等待加载.md)（播放钮 loading）· [EPUB听书速率持久化.md](./EPUB听书速率持久化.md)（倍速落库）· [EPUB听书播放器栏.md](./EPUB听书播放器栏.md)

## 1. 背景与目标

- **问题**：句间进入 `loading` 时，底栏对右侧整组加 `pointer-events-none`、按钮 `disabled`，并用 `useEffect` 强制关掉分句/倍速菜单 → 用户打开倍速面板后点听书，第一句播完面板会自动关；loading 期间也无法切章/调速。
- **目标**：loading 仅影响左侧播放钮图标（Spinner）；右侧操作始终可点；已打开的倍速/分句 pop 不被 loading 关掉。

## 2. 改动范围

- `apps/frontend/src/views/ebook/components/listen/EpubListenPlayerBar.tsx`

## 3. 实现思路

1. 删除「`status === 'loading'` 时 `handle*OpenChange(false)`」的 `useEffect`。
2. 去掉右侧容器的 `pointer-events-none` / `aria-disabled={loading}`。
3. 分句 / 倍速 Trigger、上下章按钮不再因 `loading` 设 `disabled`（分句仍受 `sentenceCount <= 0`；切章仍受 `canPrev/NextChapter`）。
4. `handleRateOpenChange` / `handleSentenceOpenChange` 不再拦截 loading 下打开。

## 4. 关键实现（改动前 / 改动后对比 + 注释）

### 4.1 `EpubListenPlayerBar` 菜单开关与 loading 副作用

**对比范围**：受控菜单 open 处理 + loading 强制关闭；右侧禁用策略。

**改动前** · `apps/frontend/src/views/ebook/components/listen/EpubListenPlayerBar.tsx`（基线，约 L548–L620 摘录）

```tsx
// 听书底部播放条（基线：loading 禁右侧并关菜单）
export function EpubListenPlayerBar({
	// ...（未改动：status、句进度、切章、倍速等 props）
	status,
	// ...（未改动）
	onRateMenuOpenChange,
	// ...（未改动）
}: Props) {
	// 非受控分句菜单 open
	const [sentenceOpenUncontrolled, setSentenceOpenUncontrolled] =
		useState(false);
	// 非受控倍速菜单 open
	const [rateOpenUncontrolled, setRateOpenUncontrolled] = useState(false);
	// 受控优先，否则非受控
	const sentenceOpen = sentenceMenuOpenProp ?? sentenceOpenUncontrolled;
	// 倍速 open 同理
	const rateOpen = rateMenuOpenProp ?? rateOpenUncontrolled;
	// 供 open 回调读最新 status，避免闭包过期
	const statusRef = useRef(status);
	// 每渲染同步 status
	statusRef.current = status;

	// 倍速菜单 open 变更
	const handleRateOpenChange = useCallback(
		(open: boolean) => {
			// loading 时禁止打开（Radix 仍可能回调）
			if (open && statusRef.current === 'loading') return;
			// 受控：上报父组件
			if (onRateMenuOpenChange) onRateMenuOpenChange(open);
			// 非受控：本地 state
			else setRateOpenUncontrolled(open);
		},
		// 依赖父回调
		[onRateMenuOpenChange],
	);

	// 分句菜单 open 变更（同样拦截 loading 打开）
	const handleSentenceOpenChange = useCallback(
		(open: boolean) => {
			// loading 禁止打开
			if (open && statusRef.current === 'loading') return;
			// 受控
			if (onSentenceMenuOpenChange) onSentenceMenuOpenChange(open);
			// 非受控
			else setSentenceOpenUncontrolled(open);
		},
		// 依赖
		[onSentenceMenuOpenChange],
	);

	// 一旦进入 loading，强制关掉两个菜单（句间会反复触发 → 倍速 pop 被关）
	useEffect(() => {
		// 非 loading 不处理
		if (status !== 'loading') return;
		// 关分句
		handleSentenceOpenChange(false);
		// 关倍速
		handleRateOpenChange(false);
	}, [status, handleSentenceOpenChange, handleRateOpenChange]);

	// ...（未改动：idle 早退、左侧播放/停止）
}
```

**改动后** · `apps/frontend/src/views/ebook/components/listen/EpubListenPlayerBar.tsx`（当前，约 L563–L608）

```tsx
// 听书底部播放条（loading 不再关菜单、不禁右侧）
export function EpubListenPlayerBar({
	// ...（未改动：status、句进度、切章、倍速、本书开关等 props）
	status,
	// ...（未改动）
	onRateMenuOpenChange,
	// ...（未改动）
}: Props) {
	// 非受控分句 open
	const [sentenceOpenUncontrolled, setSentenceOpenUncontrolled] =
		useState(false);
	// 非受控倍速 open
	const [rateOpenUncontrolled, setRateOpenUncontrolled] = useState(false);
	// 受控优先
	const sentenceOpen = sentenceMenuOpenProp ?? sentenceOpenUncontrolled;
	// 倍速 open
	const rateOpen = rateMenuOpenProp ?? rateOpenUncontrolled;

	// 倍速菜单：直接转发，不再看 loading
	const handleRateOpenChange = useCallback(
		(open: boolean) => {
			// 受控上报
			if (onRateMenuOpenChange) onRateMenuOpenChange(open);
			// 非受控本地
			else setRateOpenUncontrolled(open);
		},
		// 依赖
		[onRateMenuOpenChange],
	);

	// 分句菜单：同样不拦截 loading
	const handleSentenceOpenChange = useCallback(
		(open: boolean) => {
			// 受控
			if (onSentenceMenuOpenChange) onSentenceMenuOpenChange(open);
			// 非受控
			else setSentenceOpenUncontrolled(open);
		},
		// 依赖
		[onSentenceMenuOpenChange],
	);

	// （已删除：status===loading 时强制关菜单的 useEffect）

	// ...（未改动：idle 早退、左侧播放 Spinner / 停止）
}
```

**变更摘要**：去掉 loading 开菜单拦截与强制关闭；删除 `statusRef`。

### 4.2 右侧操作区禁用条件

**对比范围**：右侧容器与四个控件的 `disabled` / `pointer-events`。

**改动前** · 同文件（基线，约 L695–L799 摘录）

```tsx
			{/* loading：整组禁点击，避免句间误开菜单 */}
			<div
				className={cn(
					// 横向排列
					'flex shrink-0 items-center gap-2',
					// loading 时整组不可点（含已打开的 Trigger）
					loading && 'pointer-events-none',
				)}
				// 读屏标记禁用
				aria-disabled={loading || undefined}
			>
				{/* ...（分句 Dropdown） */}
				{/* Trigger / Button：loading 或无句时禁用 */}
				{/* 上一章：loading 或 !canPrev 禁用 */}
				{/* 下一章：loading 或 !canNext 禁用 */}
				{/* 倍速 Trigger：loading 禁用 → Radix 易连带关 pop */}
			</div>
```

**改动后** · 同文件（当前，约 L683–L797）

```tsx
			{/* 右侧操作：loading 不再整组禁用 */}
			<div className="flex shrink-0 items-center gap-2">
				{/* 分句：仅无句时禁用 Trigger */}
				<DropdownMenu
					// 非 modal，避免抢焦点
					modal={false}
					// 受控 open
					open={sentenceOpen}
					// open 变更
					onOpenChange={handleSentenceOpenChange}
				>
					{/* 无句才禁，与 loading 无关 */}
					<DropdownMenuTrigger asChild disabled={sentenceCount <= 0}>
						<Button
							// 按钮类型
							type="button"
							// 幽灵样式
							variant="ghost"
							// 小图标尺寸
							size="icon-sm"
							// 与 Trigger 一致
							disabled={sentenceCount <= 0}
							// 字色
							className="text-textcolor/80 shrink-0"
							// 读屏
							aria-label={t('ebook.read.listenBook.sentenceMenu')}
							// 避免 pointer 冒泡关浮层
							onPointerDown={(e) => e.stopPropagation()}
						>
							{/* 分句图标 */}
							<ListOrdered className="size-4" aria-hidden />
						</Button>
					</DropdownMenuTrigger>
					{/* ...（未改动：分句列表内容） */}
				</DropdownMenu>

				{/* 上一章：只看 canPrevChapter */}
				<Tooltip content={t('ebook.read.listenBook.prevChapter')}>
					<Button
						type="button"
						variant="ghost"
						size="icon-sm"
						className="text-textcolor/80 shrink-0"
						disabled={!canPrevChapter}
						aria-label={t('ebook.read.listenBook.prevChapter')}
						onClick={onPrevChapter}
					>
						<ChevronLeft className="size-4" aria-hidden />
					</Button>
				</Tooltip>

				{/* 下一章：只看 canNextChapter */}
				<Tooltip content={t('ebook.read.listenBook.nextChapter')}>
					<Button
						type="button"
						variant="ghost"
						size="icon-sm"
						className="text-textcolor/80 shrink-0"
						disabled={!canNextChapter}
						aria-label={t('ebook.read.listenBook.nextChapter')}
						onClick={onNextChapter}
					>
						<ChevronRight className="size-4" aria-hidden />
					</Button>
				</Tooltip>

				{/* 倍速：Trigger 永不因 loading 禁用 */}
				<DropdownMenu
					modal={false}
					open={rateOpen}
					onOpenChange={handleRateOpenChange}
				>
					{/* 无 disabled，loading 中也可开/保持面板 */}
					<DropdownMenuTrigger asChild>
						<Button
							type="button"
							variant="ghost"
							size="sm"
							className={cn(
								'text-textcolor/80 border-theme/5 bg-textcolor/8 hover:bg-textcolor/12',
								'h-6 w-15 shrink-0 gap-0.5 rounded-md border px-2.5 text-xs font-medium tabular-nums',
							)}
							aria-label={t('ebook.read.listenBook.speed')}
							title={t('ebook.read.listenBook.speed')}
							onPointerDown={(e) => e.stopPropagation()}
						>
							{formatListenRate(rate)}
						</Button>
					</DropdownMenuTrigger>
					{/* ...（未改动：EpubListenRatePanel） */}
				</DropdownMenu>
			</div>
```

**变更摘要**：右侧仅保留业务禁用条件；loading 只驱动左侧 Spinner。

## 5. 行为变化与兼容性

- 句间等待语音时仍可开倍速、改速、切章、打开分句列表。
- 点击阅读区正文关闭浮层的逻辑不变（`read.tsx` `closeReaderFloatingUi`）。
- 播放钮 loading 展示仍见 [EPUB听书等待加载.md](./EPUB听书等待加载.md)。

## 6. 测试与回归建议

- [ ] 打开倍速 pop → 点听书 → 第一句结束后 pop **仍打开**
- [ ] loading Spinner 显示时，仍可点倍速 / 分句 / 上下章（有邻章时）
- [ ] 无分句时分句钮仍禁用；首末章切章仍禁用

## 7. 相关源码路径

| 说明 | 路径 |
| ---- | ---- |
| 播放条 | `apps/frontend/src/views/ebook/components/listen/EpubListenPlayerBar.tsx` |
| 浮层关闭 | `apps/frontend/src/views/ebook/read.tsx` → `onEpubReaderPointerDown` |

---

（若与仓库最新源码不一致，以源码为准）
