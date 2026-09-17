# EPUB 听当前共用底部播放条 — 实现说明

## 延伸阅读

- [EPUB引用听书.md](./EPUB引用听书.md) — 听当前三入口（改前无播放条）
- [EPUB听书播放器栏.md](./EPUB听书播放器栏.md) — 听书播放条 UI（分句/倍速）
- [../impact/EPUB引用听书播放器栏影响.md](../impact/EPUB引用听书播放器栏影响.md) — 影响点与回归清单

---

## 1. 背景与目标

### 1.1 问题

**听书** 已有底部 `EpubListenPlayerBar`（暂停、切句、倍速）；**听当前**（PopBar / 想法引用）播放时 **无播放条**，用户无法在长选区朗读中暂停或跳句。

### 1.2 目标

- 听当前播放时 **弹出与听书相同的底部播放条**。
- 支持 **暂停/继续、停止、上一句/下一句、分句菜单、倍速**。
- 与听书 **互斥**；三入口 `toggleListen` / `listenLabel` **API 不变**。

---

## 2. 改动范围

| 路径 | 变更 |
|------|------|
| `apps/frontend/src/views/ebook/hooks/useEbookQuoteListen.ts` | 状态机重构：按句循环 TTS，导出与 `useEpubChapterListen` 对齐的播放条 API |
| `apps/frontend/src/views/ebook/read.tsx` | `epubListenBar` 在听书/听当前间切换；传入 `getSpineIndex` |
| `apps/frontend/src/views/ebook/utils/epubListenSegmentOverlay.ts` | 新增 `getEpubListenSessionMeta`、`getEpubListenSentenceSpokenRaw` |

---

## 3. 实现思路

| # | 要点 | 理由 |
|---|------|------|
| 1 | **整段 TTS → 按句循环** | 改前一次 `playPreferred(整段)` + `onCadenceChunk`；改后与听书一致，每句单独 `playPreferred`，便于 pause/seek |
| 2 | **复用 `EpubListenPlayerBar`** | 不新建 UI；`read.tsx` 用 `epubListenBar` 选择活跃 hook |
| 3 | **session meta 只读导出** | overlay 仍管 DOM 句表；hook 读 meta 填播放条 |
| 4 | **句高亮** | 每句前 `showEpubListenPlainSpan(i)` → 内部 `paintSentence` |
| 5 | **互斥不变** | 启动前 `invokeStopChapterListen()` |

**权衡**：句内 **cadence 子节奏高亮**（改前 `onCadenceChunk` 细粒度）改为 **整句一块亮**（与听书一致）。

---

## 4. 关键代码对比与注释

### 4.1 `toggleListen` 与 `playFromCursor`（`useEbookQuoteListen.ts`）

**对比范围**：改前 `toggleListen` 完整 `useCallback`；改后 `playFromCursor` + 对外 `toggleListen` 摘录（同一播放职责，对称切口）。

**改动前** · `apps/frontend/src/views/ebook/hooks/useEbookQuoteListen.ts`（**改动前**，约 L43–L117）

```typescript
// 用 useCallback 缓存切换听当前的主入口，避免子组件因引用变化重渲染
const toggleListen = useCallback(
	// 异步函数：接收朗读文本、唯一 key、可选 CFI 与冻结选区
	async (
		// 待朗读的原始文本（PopBar 选区或想法引用）
		text: string,
		// 区分不同入口/同一入口再次点击的唯一标识
		key: string,
		// 可选 EPUB CFI 范围，用于 overlay 定位
		cfiRange?: string,
		// 可选冻结 DOM Range，避免选区在播放前被清掉
		frozenRange?: Range | null,
	) => {
		// 去掉首尾空白，避免空串进入 TTS
		const trimmed = text.trim();
		// 无有效文本则直接结束，不启动播放
		if (!trimmed) return;
		// 若当前正在播且 key 相同，视为用户点击「停止」
		if (playingKey === key) {
			// 停止所有英语 TTS 实例（云端 + 本机）
			stopAllPlayback();
			// 清除听读 overlay 与高亮 DOM
			clearEpubListenSegmentOverlay();
			// 通知阅读页同步划线/想法层
			onListenSessionEnd?.();
			// 清空 playingKey，按钮恢复「听当前」
			setPlayingKey(null);
			// 提前返回，不再走启动逻辑
			return;
		}
		// 听当前与听书互斥：先停章节听书
		invokeStopChapterListen();
		// 本机/云端 TTS 均不可用时提示并退出
		if (!isPlaybackAvailable()) {
			Toast({
				// 警告类型 Toast
				type: 'warning',
				// 国际化「不支持朗读」文案
				title: t('englishLearning.tts.unsupported'),
			});
			// 不可用时不改 playingKey
			return;
		}
		// 清掉其它英语播放（含上一段听当前）
		stopAllPlayback();
		// 新 session 前清 overlay
		clearEpubListenSegmentOverlay();
		// 记录当前播放 key，供 listenLabel 显示「停止」
		setPlayingKey(key);

		// 取 epub.js rendition，无则 null
		const rend = getRendition?.() ?? null;
		// 规范化 CFI 字符串
		const cfi = cfiRange?.trim() ?? '';
		// 从选区或 fallback 文本解析 plain 与 selectionRange
		const { plain, selectionRange } = resolveEpubListenPlain(
			rend,
			trimmed,
			frozenRange,
		);

		// 有 rendition 且解析出 plain 时建立 overlay session
		if (rend && plain) {
			beginEpubListenOverlaySession(rend, plain, {
				cfi,
				selectionRange,
			});
		}

		// session 内 plain 优先（含 DOM 句表），否则用 resolve 结果
		const speakPlain = getEpubListenSessionPlain() ?? plain;

		try {
			// 旧版：整段一次 TTS，靠 cadence 事件驱动句级高亮
			await playPreferred(speakPlain, {
				// cadence 分块回调：云 TTS 流式返回时按节奏更新 UI
				onCadenceChunk: (event) => {
					// 无 rendition 无法画高亮
					if (!rend) return;
					// 句结束阶段
					if (event.phase === 'end') {
						// 该句最后一个 cadence 块结束时清高亮
						if (event.isLastInSentence) {
							clearActiveListenHighlight(rend);
						}
						return;
					}
					// 播放中：按 plain 偏移或句索引显示淡黄底
					showEpubListenPlainSpan(
						event.sentencePlainStart,
						event.sentencePlainEnd,
						event.sentenceIndex,
					);
				},
			});
		} catch {
			// TTS 失败 Toast
			Toast({
				type: 'warning',
				title: t('englishLearning.tts.unsupported'),
			});
		} finally {
			// 播完或异常后清 overlay
			clearEpubListenSegmentOverlay();
			// 触发阅读页 sync
			onListenSessionEnd?.();
			// 仅当仍是本 key 时清 playingKey（防竞态）
			setPlayingKey((k) => (k === key ? null : k));
		}
	},
	// deps：rendition 获取、session 结束回调、当前 key、翻译函数
	[getRendition, onListenSessionEnd, playingKey, t],
);
```

**改动后** · `apps/frontend/src/views/ebook/hooks/useEbookQuoteListen.ts`（**改动后**，约 L130–L211）

```typescript
// 从 sentenceCursorRef 当前句起循环 TTS，gen 用于取消过期 async
const playFromCursor = useCallback(
	// 返回 true 表示正常播完所有句；false 表示被 pause/stop/失败打断
	async (gen: number): Promise<boolean> => {
		// 通过 ref 取最新 rendition，避免闭包陈旧
		const rend = getRenditionRef.current?.() ?? null;
		// 读 overlay session 的句表与 plain
		const meta = getEpubListenSessionMeta();
		// meta 不存在时回退到 startPlayback 存的 plain
		const plain = meta?.plain ?? fallbackPlainRef.current;
		// 句数优先来自 session，否则按 plain 分句计数
		const sentenceCount =
			meta?.sentenceCount ??
			buildSentenceOffsetSpans(plain.trim()).length;

		// 无文本或无句则无法播放
		if (!plain.trim() || sentenceCount <= 0) return false;

		// 从当前游标句遍历到末句
		for (let si = sentenceCursorRef.current; si < sentenceCount; si += 1) {
			// 代际不匹配或已暂停则中断循环
			if (!isGenActive(gen) || pausedRef.current) return false;

			// 取第 si 句的 spoken 文本（session 或 fallback 分句）
			const spokenRaw = resolveSpokenAt(si, plain);
			// 空句跳过
			if (!spokenRaw) continue;

			// 更新游标到正在播的句
			sentenceCursorRef.current = si;
			// 同步 React 状态供播放条显示 playing + 句进度
			syncState({
				status: 'playing',
				sentenceIndex: si,
				sentenceCount,
			});

			// 有 rendition 时按句索引画整句淡黄底（0,0 表示走 index 分支）
			if (rend) showEpubListenPlainSpan(0, 0, si);

			try {
				// 单句 TTS，倍速来自 rateRef
				await playPreferred(spokenRaw, {
					speak: { rate: rateRef.current },
				});
			} catch {
				// 仅当代际仍有效时 Toast，避免 stop 后的误报
				if (isGenActive(gen)) {
					Toast({
						type: 'warning',
						title: tRef.current('englishLearning.tts.unsupported'),
					});
				}
				return false;
			}

			// 句间检查 pause/stop
			if (!isGenActive(gen) || pausedRef.current) return false;
			// 句末清高亮，下一句再亮
			if (rend) clearActiveListenHighlight(rend);
		}

		// 全部句播完且未被 cancel 则 true
		return isGenActive(gen);
	},
	// 仅依赖 syncState（其它经 ref 读取）
	[syncState],
);

// 对外 API 不变：PopBar / 想法仍调用 toggleListen
const toggleListen = useCallback(
	async (
		text: string,
		key: string,
		cfiRange?: string,
		frozenRange?: Range | null,
	) => {
		// 同 key 且已在播/暂停 → 视为停止
		if (
			playingKeyRef.current === key &&
			stateRef.current.status !== 'idle'
		) {
			stopInternal();
			return;
		}
		// 否则走 startPlayback（建 session + playFromCursor）
		await startPlayback(text, key, cfiRange, frozenRange);
	},
	[startPlayback, stopInternal],
);
```

**变更摘要**：播放由 **单次整段 + cadence** 改为 **for 循环按句 TTS**；新增 `status`/`sentenceIndex` 等供播放条；暂停时 **不** clear overlay。

---

### 4.2 `read.tsx` — 播放条数据源

**对比范围**：`useEbookQuoteListen` 调用与 `EpubListenPlayerBar` props（摘录）。

**改动前** · `apps/frontend/src/views/ebook/read.tsx`（**改动前**，摘录）

```typescript
// 解构听当前 hook：旧版仅暴露切换与按钮文案
const { toggleListen, listenLabel } = useEbookQuoteListen(
	// i18n 翻译函数
	t,
	// 延迟取 rendition，避免 ref 未挂载
	() => epubNavRef.current?.getRendition() ?? null,
	// 播放结束同步阅读标注
	() => epubNavRef.current?.syncReadingAnnotations(),
);

// ...（未改动：chapterListen 定义与其它阅读页逻辑）...

// 底部播放条仅绑定章节听书 hook 的状态与回调
<EpubListenPlayerBar
	// 听书播放状态 idle/playing/paused
	status={chapterListen.status}
	// 当前 spine 索引，供「第 N 章」展示
	spineIndex={chapterListen.spineIndex}
	// ...（未改动：其余 props 均来自 chapterListen）...
/>
```

**改动后** · `apps/frontend/src/views/ebook/read.tsx`（**改动后**，约 L179–L193、L2235–L2248）

```typescript
// 剩余字段 spread 为 quoteListen，含播放条所需的 status/sentenceIndex 等
const { toggleListen, listenLabel, ...quoteListen } = useEbookQuoteListen(
	// i18n
	t,
	// rendition 获取（同改前）
	() => epubNavRef.current?.getRendition() ?? null,
	// session 结束 sync（同改前）
	() => epubNavRef.current?.syncReadingAnnotations(),
	// 新增第 4 参：当前章 spine 索引，供播放条章节进度
	() => epubSpineIndexRef.current ?? epubSpineIndex,
);

// 三目选择活跃播放条数据源：听书优先，其次听当前，否则 fallback 听书（idle 时 Bar 不显示）
const epubListenBar = chapterListen.isActive
	? chapterListen
	: quoteListen.isActive
		? quoteListen
		: chapterListen;

// 单一 EpubListenPlayerBar，props 来自 epubListenBar（听书或听当前二选一）
<EpubListenPlayerBar
	// 播放状态
	status={epubListenBar.status}
	// 章索引
	spineIndex={epubListenBar.spineIndex}
	// 当前句索引（0-based）
	sentenceIndex={epubListenBar.sentenceIndex}
	// 总句数
	sentenceCount={epubListenBar.sentenceCount}
	// 分句列表预览文案数组
	sentenceLabels={epubListenBar.sentenceLabels}
	// 当前倍速
	rate={epubListenBar.rate}
	// 暂停/继续切换
	onTogglePlay={epubListenBar.togglePlay}
	// 停止并清 session
	onStop={epubListenBar.stop}
	// 上一句
	onPrevSentence={epubListenBar.prevSentence}
	// 下一句
	onNextSentence={epubListenBar.nextSentence}
	// 分句菜单点选跳转
	onGoToSentence={epubListenBar.goToSentence}
	// 倍速变更
	onRateChange={epubListenBar.setRate}
/>
```

**变更摘要**：同一 `EpubListenPlayerBar` 组件 **双源切换**；PopBar 等仍只 import `toggleListen`/`listenLabel`。

---

### 4.3 `getEpubListenSessionMeta`（`epubListenSegmentOverlay.ts`，纯新增）

**改动后** · `apps/frontend/src/views/ebook/utils/epubListenSegmentOverlay.ts`（**改动后**，约 L620–L656，纯新增）

```typescript
// 导出当前 overlay session 的 plain、句数与分句预览，供听当前播放条
export function getEpubListenSessionMeta(): {
	// session 内归一化 plain 文本
	plain: string;
	// 句表长度
	sentenceCount: number;
	// 每句 strip 后的短预览，供分句菜单
	sentenceLabels: string[];
} | null {
	// 无活跃 session
	if (!session) return null;
	// 遍历 session.sentences 生成菜单标签
	const sentenceLabels = session.sentences.map((s) => {
		// 去掉 Markdown 后 trim，作为列表一行
		const label = stripMarkdownForTts(s.spokenRaw).trim();
		// 空句显示省略号占位
		return label || '…';
	});
	// 返回播放条所需的三元组
	return {
		plain: session.plain,
		sentenceCount: session.sentences.length,
		sentenceLabels,
	};
}

// 按句索引取 TTS 用 spoken 文本（playFromCursor / goToSentence 调用）
export function getEpubListenSentenceSpokenRaw(index: number): string | null {
	// 取第 index 句 DOM 句对象
	const sent = session?.sentences[index];
	// 越界或无 session
	if (!sent) return null;
	// strip 并 trim
	const raw = stripMarkdownForTts(sent.spokenRaw).trim();
	// 空则 null，否则返回朗读串
	return raw || null;
}
```

**变更摘要**：只读导出 session 句表，**未改** `beginEpubListenOverlaySession` / `paintSentence` 逻辑。

---

## 5. 兼容性与影响

| 项 | 结论 |
|----|------|
| 三入口 API | **兼容** — `toggleListen(text,key,cfi?,range?)`、`listenLabel` 不变 |
| 听书 | **无影响** — 互斥 + `chapterListen.isActive` 优先 |
| 用户划线 / 想法 | **无影响** — 见 Influence-point 专题 |
| 句内 cadence 高亮 | **体验变化** — 改为整句高亮（与听书一致） |
| `onListenSessionEnd` | **语义一致** — 停止或播完触发 sync |

---

## 6. 相关源码路径

| 说明 | 路径 |
|------|------|
| 听当前 Hook | `apps/frontend/src/views/ebook/hooks/useEbookQuoteListen.ts` |
| 阅读页接线 | `apps/frontend/src/views/ebook/read.tsx` |
| Session / 句表 | `apps/frontend/src/views/ebook/utils/epubListenSegmentOverlay.ts` |
| 播放条 UI | `apps/frontend/src/views/ebook/components/EpubListenPlayerBar.tsx` |
| 影响点 | `docs/impact/EPUB引用听书播放器栏影响.md` |

---

（若与仓库最新源码不一致，以源码为准）
