# EPUB 听书播放条：分句菜单与倍速增强

## 延伸阅读

- [EPUB 边听边读（全书听书 MVP）](EPUB章节听书.md) — 听书 MVP 架构与数据流
- [EPUB 听当前 host 浮层](EPUB听书宿主覆盖层.md) — `showEpubListenDomRange` 绘制层
- [EPUB 听当前播放自动跟随与回位 FAB](EPUB听书自动跟随浮动按钮.md) — 自动跟随与 `forceScroll` 互斥关系
- [developer/EPUB听书开发.md](developer/EPUB听书开发.md) — 听读开发者主文档
- [EPUB听书播放器栏标尺UI.md](EPUB听书播放器栏标尺UI.md) — **增量（本轮）**：刻度尺倍速 0.5×～3×、分句虚拟列表与「滚到当前句」

**文档角色**：本轮 **听书底部播放条** 增量（分句跳转菜单、倍速 0.75×～3×、TTS 倍速贯通、跳转居中滚动）。  
> **影响面（分句虚拟列表 / 刻度倍速 UI）**：[EPUB听书播放器栏UI影响.md](../impact/EPUB听书播放器栏UI影响.md)

## 1. 背景与目标

**用户视角**：听书时除上一句/下一句外，需要 **从列表跳到任意句**；倍速需覆盖 **更快档位（最高 3×）** 且 **云端朗读即时生效**；跳转后正文应 **滚到句子的视口中央** 便于对照阅读。

**定稿原则**：

| 维度 | 定稿 | 废弃/不用 |
|------|------|-----------|
| 分句列表数据 | `buildSentenceLabels(plain, sentences)` 与 TTS 同源 `stripMarkdownForTts` | 单独 DOM 抽句作菜单文案 |
| 跳转 API | `goToSentence(index)` + `seekSentence(±1)` 包装 | 仅 delta 的 `seekSentence` 对外 |
| 倍速 UI | `DropdownMenu` 网格 + 当前倍速按钮 | 原生 `<select>` |
| 云端倍速 | `Audio.playbackRate` + 句间 pause ÷ rate | 仅下一句生效、当前句不变 |
| 跳转滚动 | `forceScroll` + `align: 'center'` 一次性居中 | 仅 autoFollow 最近邻滚入 |

## 2. 改动范围

| 路径 | 说明 |
| ---- | ---- |
| `apps/frontend/src/views/ebook/components/EpubListenPlayerBar.tsx` | 分句下拉、倍速下拉、当前句列表自动滚中、播放/停止按钮样式 |
| `apps/frontend/src/views/ebook/hooks/useEpubChapterListen.ts` | `sentenceLabels`、`goToSentence`、扩展 `CHAPTER_LISTEN_RATES`、`setRate` 即时生效 |
| `apps/frontend/src/utils/speech.ts` | `clampPlaybackRate`、`applyActivePlaybackRate`、云端 MP3/cadence 倍速 |
| `apps/frontend/src/views/ebook/utils/epubListenChapter.ts` | 高亮入口改调 `showEpubListenDomRange(..., opts)` |
| `apps/frontend/src/views/ebook/utils/epubListenSegmentOverlay.ts` | `showEpubListenDomRange` 支持 `forceScroll` / `align` |
| `apps/frontend/src/views/ebook/utils/epubScrolledNav.ts` | `scrollEpubDomRangeToCenter`、`scrollEpubRangeToViewCenter` |
| `apps/frontend/src/views/ebook/read.tsx` | 透传 `sentenceLabels`、`onGoToSentence` |
| `apps/frontend/src/i18n/locales/zh-CN.ts`、`en-US.ts` | `sentenceMenu`、`sentenceMenuEmpty`、倍速文案 |

## 3. 实现思路

1. **句标签**：节级 `plain` + `buildSentenceOffsetSpans` 已有；新增 `buildSentenceLabels` 对每句 `slice` 后走 `stripMarkdownForTts`，与播放文本一致，供菜单展示。
2. **跳转**：`goToSentence`  clamp 索引 → 递增 `loopGenRef` 取消在播 TTS → `playSentencesFromCursor(ctx, gen, { scrollCenterOnFirst: true })`；首句高亮带 `forceScroll` + `center`，不依赖 autoFollow 的 debounce。
3. **倍速档位**：`CHAPTER_LISTEN_RATES` 扩至 10 档（0.75～3）；`setRate` 写 `rateRef` 并 `applyActivePlaybackRate` 改正在播的 `cloudAudio.playbackRate`。
4. **TTS 链路**：`playPreferred(..., { speak: { rate } })` → `playCloudTtsCadenceSegments` 设 `audio.playbackRate`；cadence 句间 `pauseAfterMs` 按 rate 缩短；`waitCloudAudioEnd` 超时按 `duration / playbackRate` 估算。
5. **居中滚动**：连续滚动模式用 `scrollEpubDomRangeToCenter`（iframe Range 中点对齐容器中点）；分页模式回退 `scrollEpubRangeIntoView`。
6. **分句菜单 UX**：`ScrollArea` + `data-active-sentence`；打开时 `scheduleScrollToActiveSentence` rAF 重试 + 80/160ms 二次对齐，应对 Portal 动画首帧 rect 不准。

## 4. 行为变化

- **兼容**：原有暂停/继续、上一句/下一句、目录跳转续播、与听当前互斥 **不变**。
- **用户可感知**：新增分句按钮与倍速下拉；倍速上限 1.5× → **3×**；跳转后正文居中；播放/停止图标改 teal 强调色。
- **本机 Web Speech**：倍速仍主要作用于 **下一句**（与云端即时 `playbackRate` 行为差异保留）。

## 5. 风险与回归

- 分句菜单在长章（数百句）下 ScrollArea 性能与打开时滚中是否准确。
- 3× 云端 MP3 是否可听、超时是否仍误触发（已按 rate 缩放 timeout）。
- 跳转居中与 **手动打断 autoFollow**、**FAB 回位** 是否冲突（`forceScroll` 走 `withProgrammaticScroll`，不置 `autoFollowPaused`）。
- 分页 EPUB 跳转是否仍能 `display(cfi)` 回退。

## 6. 关键代码对比与注释

### 6.1 `buildSentenceLabels`（`apps/frontend/src/views/ebook/hooks/useEpubChapterListen.ts`）

**对比范围**：纯新增辅助函数（改动前无对应符号）。

**改动后** · `apps/frontend/src/views/ebook/hooks/useEpubChapterListen.ts`（当前，约 L62–L69）

```typescript
// 从 plain 与句偏移表生成菜单展示用标签（与 TTS spokenRaw 同源处理）
function buildSentenceLabels(
	// 当前节完整 innerText 正文
	plain: string,
	// buildSentenceOffsetSpans 产出的 { start, end } 数组
	sentences: Array<{ start: number; end: number }>,
): string[] {
	// 对每句切片后 stripMarkdownForTts 并 trim，得到菜单一行预览
	return sentences.map((sent) =>
		stripMarkdownForTts(plain.slice(sent.start, sent.end)).trim(),
	);
}
```

### 6.2 `goToSentence` 与 `setRate`（`useEpubChapterListen.ts`）

**对比范围**：`goToSentence` 由旧版内联 `seekSentence` 拆出；`setRate` 增加即时倍速。

**改动前** · `apps/frontend/src/views/ebook/hooks/useEpubChapterListen.ts`（基线，约 L412–L446）

```typescript
	// 上一句/下一句：在 sectionRef 内按 delta 调整游标并续播
	const seekSentence = useCallback(
		// delta 仅允许 -1 或 1
		(delta: -1 | 1) => {
			// 当前节上下文，无句表则直接返回
			const ctx = sectionRef.current;
			if (!ctx?.sentences.length) return;

			// 在 [0, len-1] 内 clamp 新句下标
			const next = Math.min(
				ctx.sentences.length - 1,
				Math.max(0, sentenceCursorRef.current + delta),
			);
			// 更新游标 ref（先于 async 播放）
			sentenceCursorRef.current = next;
			// 递增代际，取消进行中的 loop / TTS
			loopGenRef.current += 1;
			// 停止当前英文播放实例
			stopAllPlayback();
			// 清除暂停标记，跳转后按 playing 续播
			pausedRef.current = false;

			// 捕获当前代际号供 playSentencesFromCursor 校验
			const gen = loopGenRef.current;
			// 同步 React 状态：句序与 playing
			syncState({
				sentenceIndex: next,
				sentenceCount: ctx.sentences.length,
				status: 'playing',
			});

			// 取 rendition 实例，缺失则无法高亮
			const rend = getRenditionRef.current();
			if (!rend) return;

			// 从新句起异步播放至节末（无强制居中滚动）
			void playSentencesFromCursor(ctx, gen);
		},
		[playSentencesFromCursor, syncState],
	);

	// 仅更新 rateRef 与 UI，不改正在播音频
	const setRate = useCallback(
		(rate: number) => {
			rateRef.current = rate;
			syncState({ rate });
		},
		[syncState],
	);
```

**改动后** · `apps/frontend/src/views/ebook/hooks/useEpubChapterListen.ts`（当前，约 L440–L484）

```typescript
	// 跳转到任意句下标（分句菜单与 seekSentence 共用）
	const goToSentence = useCallback(
		(index: number) => {
			const ctx = sectionRef.current;
			if (!ctx?.sentences.length) return;

			const next = Math.min(
				ctx.sentences.length - 1,
				Math.max(0, index),
			);
			sentenceCursorRef.current = next;
			loopGenRef.current += 1;
			stopAllPlayback();
			pausedRef.current = false;

			const gen = loopGenRef.current;
			syncState({
				sentenceIndex: next,
				sentenceCount: ctx.sentences.length,
				// 跳转时刷新 labels（plain 未变时可省略，保持与 prepareSection 一致）
				sentenceLabels: buildSentenceLabels(ctx.plain, ctx.sentences),
				status: 'playing',
			});

			const rend = getRenditionRef.current();
			if (!rend) return;

			// 首句高亮带 forceScroll + center，正文滚到视口中央
			void playSentencesFromCursor(ctx, gen, { scrollCenterOnFirst: true });
		},
		[playSentencesFromCursor, syncState],
	);

	// ±1 包装 goToSentence，供上一句/下一句按钮
	const seekSentence = useCallback(
		(delta: -1 | 1) => {
			goToSentence(sentenceCursorRef.current + delta);
		},
		[goToSentence],
	);

	// 写 ref、即时改 cloudAudio.playbackRate，并更新 UI
	const setRate = useCallback(
		(rate: number) => {
			rateRef.current = rate;
			applyActivePlaybackRate(rate);
			syncState({ rate });
		},
		[syncState],
	);
```

**变更摘要**：`seekSentence` 逻辑上提为按绝对下标跳转的 `goToSentence`；跳转播放增加 `scrollCenterOnFirst`；`setRate` 调用 TTS 层即时倍速。

### 6.3 `playSentencesFromCursor` 首句居中（`useEpubChapterListen.ts`）

**对比范围**：函数签名与首句高亮分支（摘录）。

**改动前** · 基线，约 L183–L217

```typescript
	const playSentencesFromCursor = useCallback(
		async (ctx: SectionCtx, gen: number): Promise<boolean> => {
			const { plain, sentences, sentenceRanges } = ctx;
			const rend = getRenditionRef.current();

			for (let si = sentenceCursorRef.current; si < sentences.length; si += 1) {
				// ...（循环内未改动：代际校验、spokenRaw、syncState、TTS）
				const domRange = sentenceRanges[si];
				const hasHighlight = !!(rend && domRange);
				if (hasHighlight) {
					showChapterListenSentenceHighlight(rend, domRange);
				}
				// ...（未改动）
			}
			return isGenActive(gen);
		},
		[syncState],
	);
```

**改动后** · 当前，约 L183–L217

```typescript
	const playSentencesFromCursor = useCallback(
		async (
			ctx: SectionCtx,
			gen: number,
			opts?: { scrollCenterOnFirst?: boolean },
		): Promise<boolean> => {
			const { plain, sentences, sentenceRanges } = ctx;
			const rend = getRenditionRef.current();
			const startSi = sentenceCursorRef.current;

			for (let si = sentenceCursorRef.current; si < sentences.length; si += 1) {
				// ...（循环内未改动）
				const domRange = sentenceRanges[si];
				const hasHighlight = !!(rend && domRange);
				if (hasHighlight) {
					const jumpScroll =
						opts?.scrollCenterOnFirst && si === startSi
							? ({ forceScroll: true, align: 'center' as const } as const)
							: undefined;
					showChapterListenSentenceHighlight(rend, domRange, jumpScroll);
				}
				// ...（未改动）
			}
			return isGenActive(gen);
		},
		[syncState],
	);
```

**变更摘要**：可选 `scrollCenterOnFirst` 仅作用于 **跳转起始句** 的高亮与滚动。

### 6.4 `applyActivePlaybackRate`（`apps/frontend/src/utils/speech.ts`）

**对比范围**：纯新增 `clampPlaybackRate` + 导出函数（摘录）。

**改动后** · 当前，约 L458–L465、L717–L721

```typescript
// 云端 cadence 播放选项：继承 onCadenceChunk 并可选 rate
type CloudTtsPlaybackOptions = CadencePlaybackHooks & {
	rate?: number;
};

// 将倍速限制在 0.5～3，听书 UI 最高 3x
function clampPlaybackRate(rate?: number): number {
	const r = rate ?? 1;
	return Math.min(3, Math.max(0.5, r));
}

// ...（中间未改动）

/** 听书等场景切换倍速：云端 MP3 即时生效；本机 Web Speech 仅影响下一句 */
export function applyActivePlaybackRate(rate: number): void {
	const clamped = clampPlaybackRate(rate);
	if (cloudAudio) cloudAudio.playbackRate = clamped;
}
```

### 6.5 `playCloudMp3Blob`（`speech.ts`）

**对比范围**：完整函数。

**改动前** · 基线，约 L903–L931

```typescript
function playCloudMp3Blob(blob: Blob, generation: number): Promise<void> {
	stopPlaybackMediaOnly();
	if (!isPlaybackGenerationActive(generation)) {
		return Promise.resolve();
	}

	const url = URL.createObjectURL(blob);
	cloudObjectUrl = url;
	const audio = new Audio(url);
	cloudAudio = audio;
	return audio.play().then(
		() => waitCloudAudioEnd(audio, url, generation),
		(err) => {
			if (!isPlaybackGenerationActive(generation)) {
				if (cloudObjectUrl === url) {
					URL.revokeObjectURL(url);
					cloudObjectUrl = null;
					cloudAudio = null;
				}
				return Promise.resolve();
			}
			if (cloudObjectUrl === url) {
				URL.revokeObjectURL(url);
				cloudObjectUrl = null;
				cloudAudio = null;
			}
			throw err;
		},
	);
}
```

**改动后** · 当前，约 L918–L948

```typescript
function playCloudMp3Blob(
	blob: Blob,
	generation: number,
	rate?: number,
): Promise<void> {
	stopPlaybackMediaOnly();
	if (!isPlaybackGenerationActive(generation)) {
		return Promise.resolve();
	}

	const url = URL.createObjectURL(blob);
	cloudObjectUrl = url;
	const audio = new Audio(url);
	audio.playbackRate = clampPlaybackRate(rate);
	cloudAudio = audio;
	return audio.play().then(
		() => waitCloudAudioEnd(audio, url, generation),
		(err) => {
			if (!isPlaybackGenerationActive(generation)) {
				if (cloudObjectUrl === url) {
					URL.revokeObjectURL(url);
					cloudObjectUrl = null;
					cloudAudio = null;
				}
				return Promise.resolve();
			}
			if (cloudObjectUrl === url) {
				URL.revokeObjectURL(url);
				cloudObjectUrl = null;
				cloudAudio = null;
			}
			throw err;
		},
	);
}
```

**变更摘要**：新增 `rate` 参数，创建 `Audio` 后立即 `playbackRate = clampPlaybackRate(rate)`。

### 6.6 `showEpubListenDomRange`（`epubListenSegmentOverlay.ts`）

**对比范围**：完整函数。

**改动前** · 基线，约 L485–L497

```typescript
export function showEpubListenDomRange(rend: Rendition, range: Range): void {
	if (!isRangeConnected(range)) return;
	const snapped =
		normalizeSelectionRangeForEpub(range.cloneRange()) ?? range.cloneRange();

	const active = ensureChapterDomListenSession(rend);
	const prev = active.activeDomRange;
	const isNew = !prev || !rangesEqual(prev, snapped);
	active.lastSentenceIndex = -1;
	active.activeDomRange = snapped.cloneRange();
	if (isNew) clearListenMarkHighlight(rend);
	showListenMarkHighlight(rend, snapped);
	if (isNew && active.autoFollow) requestListenAutoFollowScroll();
}
```

**改动后** · 当前，约 L486–L516

```typescript
export function showEpubListenDomRange(
	rend: Rendition,
	range: Range,
	opts?: { forceScroll?: boolean; align?: 'center' | 'nearest' },
): void {
	if (!isRangeConnected(range)) return;
	const snapped =
		normalizeSelectionRangeForEpub(range.cloneRange()) ?? range.cloneRange();

	const active = ensureChapterDomListenSession(rend);
	const prev = active.activeDomRange;
	const isNew = !prev || !rangesEqual(prev, snapped);
	active.lastSentenceIndex = -1;
	active.activeDomRange = snapped.cloneRange();
	if (isNew) clearListenMarkHighlight(rend);
	showListenMarkHighlight(rend, snapped);

	if (opts?.forceScroll) {
		void withProgrammaticScroll(async () => {
			if (opts.align === 'center') {
				await scrollEpubRangeToViewCenter(rend, snapped, active.cfi);
				return;
			}
			await scrollEpubRangeIntoView(rend, snapped, active.cfi);
		});
		return;
	}

	if (isNew && active.autoFollow) requestListenAutoFollowScroll();
}
```

**变更摘要**：`forceScroll` 时走程序化滚动（可居中），并 **跳过** 常规定时 autoFollow，避免与跳转滚动打架。

### 6.7 `scrollEpubRangeToViewCenter`（`epubScrolledNav.ts`）

**对比范围**：纯新增（`scrollEpubDomRangeToCenter` + 异步入口）。

**改动后** · 当前，约 L153–L188

```typescript
/** 连续滚动：将 Range 垂直居中到阅读容器视口 */
export function scrollEpubDomRangeToCenter(
	rend: Rendition,
	range: Range,
): boolean {
	const container = getEpubScrollContainer(rend);
	if (!container) return false;

	const win = range.startContainer.ownerDocument?.defaultView;
	const iframe = win?.frameElement as HTMLIFrameElement | null;
	if (!iframe) return false;

	const { top, bottom } = readRangeViewportBounds(range, iframe);
	const rangeMid = (top + bottom) / 2;
	const containerRect = container.getBoundingClientRect();
	const containerMid = (containerRect.top + containerRect.bottom) / 2;
	container.scrollTop += rangeMid - containerMid;
	return true;
}

/**
 * 听书分句跳转等：将 Range 滚到视口中央；分页模式回退 scrollEpubRangeIntoView。
 */
export async function scrollEpubRangeToViewCenter(
	rend: Rendition,
	range: Range,
	fallbackCfi?: string,
): Promise<boolean> {
	if (getEpubScrollContainer(rend)) {
		try {
			return scrollEpubDomRangeToCenter(rend, range);
		} catch {
			return false;
		}
	}
	return scrollEpubRangeIntoView(rend, range, fallbackCfi);
}
```

### 6.8 `scheduleScrollToActiveSentence`（`EpubListenPlayerBar.tsx`）

**对比范围**：纯新增；分句菜单打开时滚到当前句。

**改动后** · 当前，约 L106–L125

```typescript
/** 菜单 Portal 挂载/动画期间视口可能尚未就绪，短周期重试直到滚到位 */
function scheduleScrollToActiveSentence(
	getViewport: () => HTMLDivElement | null,
	isCancelled: () => boolean,
): void {
	let attempts = 0;
	const tryScroll = () => {
		if (isCancelled()) return;
		if (scrollActiveSentenceIntoView(getViewport())) return;
		attempts += 1;
		if (attempts < 24) requestAnimationFrame(tryScroll);
	};
	requestAnimationFrame(tryScroll);

	// 下拉展开动画结束后再对齐一次，避免首帧 rect 不准
	for (const delay of [80, 160]) {
		window.setTimeout(() => {
			if (!isCancelled()) scrollActiveSentenceIntoView(getViewport());
		}, delay);
	}
}
```

### 6.9 `EpubListenPlayerBar` 倍速区（`EpubListenPlayerBar.tsx`）

**对比范围**：播放条右侧倍速控件完整替换（`<select>` → `DropdownMenu`）。

**改动前** · 基线，约 L134–L149

```typescript
			<label className="text-textcolor/55 flex shrink-0 items-center gap-1 text-xs">
				<span className="sr-only">{t('ebook.read.listenBook.speed')}</span>
				<select
					className="border-theme/15 bg-theme/10 text-textcolor/80 rounded border px-1.5 py-0.5 text-xs"
					value={rate}
					disabled={loading}
					aria-label={t('ebook.read.listenBook.speed')}
					onChange={(e) => onRateChange(Number(e.target.value))}
				>
					{CHAPTER_LISTEN_RATES.map((r) => (
						<option key={r} value={r}>
							{r}x
						</option>
					))}
				</select>
			</label>
```

**改动后** · 当前，约 L360–L406

```typescript
			<DropdownMenu modal={false}>
				<DropdownMenuTrigger asChild>
					<Button
						type="button"
						variant="ghost"
						size="sm"
						disabled={loading}
						className={cn(
							'text-textcolor/75 border-theme/12 bg-theme/8 hover:bg-theme/12',
							'h-6 w-15 shrink-0 gap-0.5 rounded-md border px-2.5 text-xs font-medium tabular-nums',
						)}
						aria-label={t('ebook.read.listenBook.speed')}
						title={t('ebook.read.listenBook.speed')}
						onPointerDown={(e) => e.stopPropagation()}
					>
						{formatListenRate(rate)}
					</Button>
				</DropdownMenuTrigger>
				<DropdownMenuContent
					side="top"
					align="end"
					className="z-50 min-w-36 p-1"
				>
					<DropdownMenuLabel className="text-textcolor/45 px-4.5 pb-3 pt-2 text-center text-xs font-normal">
						{t('ebook.read.listenBook.speed')}
					</DropdownMenuLabel>
					<div className="grid grid-cols-2 gap-1 px-0.5 pb-0.5">
						{CHAPTER_LISTEN_RATES.map((r) => {
							const selected = r === rate;
							return (
								<DropdownMenuItem
									key={r}
									className={cn(
										'min-w-0 justify-center px-2 py-1.5 text-xs tabular-nums',
										selected
											? 'bg-teal-500/12 text-teal-700 focus:bg-teal-500/12 focus:text-teal-700 dark:text-teal-300'
											: 'text-textcolor/80',
									)}
									onSelect={() => onRateChange(r)}
								>
									{formatListenRate(r)}
								</DropdownMenuItem>
							);
						})}
					</div>
				</DropdownMenuContent>
			</DropdownMenu>
```

**变更摘要**：倍速改为向上弹出的两列网格；展示格式统一为 `{value} X`；档位由 hook 常量扩展至 3×。

## 7. 相关源码路径

| 说明 | 路径 |
| ---- | ---- |
| 播放条 UI | `apps/frontend/src/views/ebook/components/EpubListenPlayerBar.tsx` |
| 听书状态机 | `apps/frontend/src/views/ebook/hooks/useEpubChapterListen.ts` |
| TTS 倍速 | `apps/frontend/src/utils/speech.ts` |
| 高亮 + 强制滚动 | `apps/frontend/src/views/ebook/utils/epubListenSegmentOverlay.ts` |
| 居中滚动 | `apps/frontend/src/views/ebook/utils/epubScrolledNav.ts` |

---

（若与仓库最新源码不一致，以源码为准）
