# EPUB「听当前」逐句播放背景

## 延伸阅读

- [EPUB 边听边读「听书」](EPUB章节听书.md) — 全书连续听书；**开发者总手册**见 [developer/EPUB听书开发.md](./developer/EPUB听书开发.md)
- [EPUB 听当前：滚动容器浮层与跨段句间清除](EPUB听书宿主覆盖层.md) — **当前绘制层**：host 浮层、句 index 清除（替代下文 §1 三层绘制描述）
- [EPUB 听当前播放自动跟随 FAB](EPUB听书自动跟随浮动按钮.md) — 手动滚动打断与回位按钮
- [EPUB 引用「听当前」](EPUB引用听书.md) — 三入口朗读、TTS 复用
- [EPUB 听当前与用户划线 DOM 协调](EPUB听书用户划线对账.md) — 播放层与用户划线隔离
- [EPUB 用户划线实现](EPUB用户划线实现.md) — marks-pane 批注（与播放层解耦）

## 1. 背景与目标

**用户视角**：EPUB「听当前」朗读时，当前句应有淡黄底 `rgba(251, 231, 128, 0.28)`；句末清除、下一句再亮；停止后全清；不破坏用户划线。

**旧版问题**：

1. 仅 body 浮层 + 预解析句 Range：relayout/无 marks-pane 时整段或无背景。
2. 按句索引 `showEpubListenSentence(i)` 与 TTS plain 偏移不对齐。
3. PopBar 点「听当前」时浏览器选区可能已 collapse，定位失败。

**目标**：

1. **三层绘制**：CSS Highlight API → 独立 class 的 epub highlight（`moke-epub-listen-bg`）→ body 绝对定位 div 回退。
2. **plain 偏移驱动**：TTS `onCadenceChunk` 携带 `sentencePlainStart/End`，DOM 用 compact 映射定位。
3. **选区缓存**：PopBar 弹出时 `rememberEpubPopBarSelectionRange`，朗读用 frozen Range。
4. **清除隔离**：`detachActiveListenAnnotation` 只 detach 播放对象，**禁止** `annotations.remove(cfi,'highlight')`。

## 2. 改动范围

| 路径 | 说明 |
| ---- | ---- |
| `apps/frontend/src/utils/speech.ts` | `TtsCadenceChunkEvent` plain 偏移、`buildSentenceOffsetSpans` 导出 |
| `apps/frontend/src/views/ebook/utils/epubListenSegmentOverlay.ts` | 三层绘制、plain 映射、选区缓存 |
| `apps/frontend/src/views/ebook/hooks/useEbookQuoteListen.ts` | plain span 回调、frozen Range、播完 sync |
| `apps/frontend/src/views/ebook/utils/epubSelectionToolbarAttach.ts` | PopBar 时缓存选区 |
| `apps/frontend/src/views/ebook/read.tsx` | PopBar 传 frozen Range |

## 3. 实现思路

1. **数据流**：`toggleListen(text, key, cfi, frozenRange)` → `resolveEpubListenPlain` 得 plain + selectionRange → `beginEpubListenOverlaySession` → `playPreferred({ onCadenceChunk })` → `start` 时 `showEpubListenPlainSpan(sentencePlainStart, sentencePlainEnd)` → 句末 `clearEpubListenSentenceOverlay` → `finally` 全清 + `onListenSessionEnd`。
2. **DOM 映射**：`buildPlainCompactMap` 在 outer Range 内建去空白 compact 串与 Text 点表；`plainSliceToRange` 按 plain 偏移切 Range。
3. **绘制优先级**：`paintListenRange` 先 CSS Highlight（Chrome 等），再独立 highlight 批注，最后 div overlay（Safari 等）。
4. **relayout**：监听 `relocated`/`rendered`，按 session 内 `plainStart/plainEnd` 重绘当前句。
5. **spokenRaw**：优先用选区 `toString()`，与正文所见一致，避免 PopBar 文本与 DOM 偏差。

## 4. 关键代码对比与注释

### 4.1 `useEbookQuoteListen`（`apps/frontend/src/views/ebook/hooks/useEbookQuoteListen.ts`）

**对比范围**：完整 hook（L1–闭合）。

**改动前** · 基线，约 L1–L94

```typescript
// Toast 用于朗读不可用提示
import { Toast } from '@ui/sonner';
// epub.js Rendition 类型
import type { Rendition } from 'epubjs';
// React 状态与副作用、回调
import { useCallback, useEffect, useState } from 'react';
// 英语学习 TTS 能力：可用性、播放、停止、strip plain、预热音色
import {
	isPlaybackAvailable,
	playPreferred,
	stopAllPlayback,
	stripMarkdownForTts,
	warmupSpeechVoices,
} from '@/utils/speech';
// 播放浮层：会话开始、全清、句清、按句索引显示（旧 API）
import {
	beginEpubListenOverlaySession,
	clearEpubListenSegmentOverlay,
	clearEpubListenSentenceOverlay,
	showEpubListenSentence,
} from '../utils/epubListenSegmentOverlay';

/** 电子书引用/选区朗读：复用英语学习 TTS（本机 / 云端偏好） */
export function useEbookQuoteListen(
	t: (key: string) => string,
	getRendition?: () => Rendition | null,
) {
	// 当前正在播放的入口 key（popbar / 想法列表等）
	const [playingKey, setPlayingKey] = useState<string | null>(null);

	useEffect(() => {
		// 挂载时预热 Web Speech 音色列表
		warmupSpeechVoices();
		return () => {
			// 卸载时停止播放并清除播放浮层
			stopAllPlayback();
			clearEpubListenSegmentOverlay();
		};
	}, []);

	const toggleListen = useCallback(
		async (text: string, key: string, cfiRange?: string) => {
			const trimmed = text.trim();
			if (!trimmed) return;
			if (playingKey === key) {
				stopAllPlayback();
				clearEpubListenSegmentOverlay();
				setPlayingKey(null);
				return;
			}
			if (!isPlaybackAvailable()) {
				Toast({
					type: 'warning',
					title: t('englishLearning.tts.unsupported'),
				});
				return;
			}
			stopAllPlayback();
			clearEpubListenSegmentOverlay();
			setPlayingKey(key);

			const rend = getRendition?.() ?? null;
			const cfi = cfiRange?.trim();
			const plain = stripMarkdownForTts(trimmed);
			if (rend && cfi && plain) {
				beginEpubListenOverlaySession(rend, cfi, plain);
			}

			try {
				await playPreferred(trimmed, {
					onCadenceChunk: (event) => {
						if (!rend || !cfi) return;
						if (event.phase === 'start') {
							showEpubListenSentence(event.sentenceIndex);
							return;
						}
						if (event.isLastInSentence) {
							clearEpubListenSentenceOverlay();
						}
					},
				});
			} catch {
				Toast({
					type: 'warning',
					title: t('englishLearning.tts.unsupported'),
				});
			} finally {
				clearEpubListenSegmentOverlay();
				setPlayingKey((k) => (k === key ? null : k));
			}
		},
		[getRendition, playingKey, t],
	);

	const listenLabel = useCallback(
		(key: string, defaultLabel: string) =>
			playingKey === key ? t('englishLearning.tts.stop') : defaultLabel,
		[playingKey, t],
	);

	return { toggleListen, playingKey, listenLabel };
}
```

**改动后** · 当前，约 L1–L113

```typescript
// Toast 用于朗读不可用提示
import { Toast } from '@ui/sonner';
// epub.js Rendition 类型
import type { Rendition } from 'epubjs';
// React 状态与副作用、回调
import { useCallback, useEffect, useState } from 'react';
// 英语学习 TTS：不再在此 hook 内 stripMarkdown（改由 resolveEpubListenPlain）
import {
	isPlaybackAvailable,
	playPreferred,
	stopAllPlayback,
	warmupSpeechVoices,
} from '@/utils/speech';
// 播放浮层：plain 解析、plain span 显示、会话 API
import {
	beginEpubListenOverlaySession,
	clearEpubListenSegmentOverlay,
	clearEpubListenSentenceOverlay,
	resolveEpubListenPlain,
	showEpubListenPlainSpan,
} from '../utils/epubListenSegmentOverlay';

/** 电子书引用/选区朗读：复用英语学习 TTS（本机 / 云端偏好） */
export function useEbookQuoteListen(
	t: (key: string) => string,
	getRendition?: () => Rendition | null,
	onListenSessionEnd?: () => void,
) {
	const [playingKey, setPlayingKey] = useState<string | null>(null);

	useEffect(() => {
		warmupSpeechVoices();
		return () => {
			stopAllPlayback();
			clearEpubListenSegmentOverlay();
		};
	}, []);

	const toggleListen = useCallback(
		async (
			text: string,
			key: string,
			cfiRange?: string,
			frozenRange?: Range | null,
		) => {
			const trimmed = text.trim();
			if (!trimmed) return;
			if (playingKey === key) {
				stopAllPlayback();
				clearEpubListenSegmentOverlay();
				onListenSessionEnd?.();
				setPlayingKey(null);
				return;
			}
			if (!isPlaybackAvailable()) {
				Toast({
					type: 'warning',
					title: t('englishLearning.tts.unsupported'),
				});
				return;
			}
			stopAllPlayback();
			clearEpubListenSegmentOverlay();
			setPlayingKey(key);

			const rend = getRendition?.() ?? null;
			const cfi = cfiRange?.trim() ?? '';
			const { plain, selectionRange, spokenRaw } = resolveEpubListenPlain(
				rend,
				trimmed,
				frozenRange,
			);

			if (rend && plain) {
				beginEpubListenOverlaySession(rend, plain, {
					cfi,
					selectionRange,
				});
			}

			try {
				await playPreferred(spokenRaw, {
					onCadenceChunk: (event) => {
						if (!rend) return;
						if (event.phase === 'start') {
							showEpubListenPlainSpan(
								event.sentencePlainStart,
								event.sentencePlainEnd,
							);
							return;
						}
						if (event.isLastInSentence) {
							clearEpubListenSentenceOverlay();
						}
					},
				});
			} catch {
				Toast({
					type: 'warning',
					title: t('englishLearning.tts.unsupported'),
				});
			} finally {
				clearEpubListenSegmentOverlay();
				onListenSessionEnd?.();
				setPlayingKey((k) => (k === key ? null : k));
			}
		},
		[getRendition, onListenSessionEnd, playingKey, t],
	);

	const listenLabel = useCallback(
		(key: string, defaultLabel: string) =>
			playingKey === key ? t('englishLearning.tts.stop') : defaultLabel,
		[playingKey, t],
	);

	return { toggleListen, playingKey, listenLabel };
}
```

**变更摘要**：新增 `frozenRange` 与 `onListenSessionEnd`；会话改 plain+选区；回调改用 `sentencePlainStart/End`；TTS 文本用 `spokenRaw`。

---

### 4.2 `emitCadenceChunk`（`apps/frontend/src/utils/speech.ts`）

**对比范围**：完整函数（约 L504–L542）。

**改动前** · 基线，约 L496–L527

```typescript
function emitCadenceChunk(
	hooks: CadencePlaybackHooks | undefined,
	plain: string,
	chunks: TtsCadenceChunk[],
	index: number,
	phase: TtsCadenceChunkEvent['phase'],
): void {
	const onCadenceChunk = hooks?.onCadenceChunk;
	if (!onCadenceChunk) return;

	const chunk = chunks[index];
	if (!chunk) return;

	const sentences = buildSentenceOffsetSpans(plain);
	const offsets = buildChunkOffsetMeta(plain, chunks);
	const { start } = offsets[index] ?? { start: 0 };
	const sentenceIndex = sentenceIndexAtOffset(sentences, start);
	const nextStart = offsets[index + 1]?.start;
	const isLastInSentence =
		index === chunks.length - 1 ||
		(nextStart !== undefined &&
			sentenceIndexAtOffset(sentences, nextStart) !== sentenceIndex);

	onCadenceChunk({
		phase,
		index,
		text: chunk.text,
		sentenceIndex,
		isLastInSentence,
	});
}
```

**改动后** · 当前，约 L504–L542

```typescript
function emitCadenceChunk(
	hooks: CadencePlaybackHooks | undefined,
	plain: string,
	chunks: TtsCadenceChunk[],
	index: number,
	phase: TtsCadenceChunkEvent['phase'],
): void {
	const onCadenceChunk = hooks?.onCadenceChunk;
	if (!onCadenceChunk) return;

	const chunk = chunks[index];
	if (!chunk) return;

	const sentences = buildSentenceOffsetSpans(plain);
	const offsets = buildChunkOffsetMeta(plain, chunks);
	const { start, end } = offsets[index] ?? { start: 0, end: chunk.text.length };
	const sentenceIndex = sentenceIndexAtOffset(sentences, start);
	const sentSpan = sentences[sentenceIndex] ?? {
		start: 0,
		end: plain.trim().length,
	};
	const nextStart = offsets[index + 1]?.start;
	const isLastInSentence =
		index === chunks.length - 1 ||
		(nextStart !== undefined &&
			sentenceIndexAtOffset(sentences, nextStart) !== sentenceIndex);

	onCadenceChunk({
		phase,
		index,
		text: chunk.text,
		sentenceIndex,
		isLastInSentence,
		plainStart: start,
		plainEnd: end,
		sentencePlainStart: sentSpan.start,
		sentencePlainEnd: sentSpan.end,
	});
}
```

**变更摘要**：事件增加 plain 与整句偏移；`sentenceIndexAtOffset` 改为从后向前匹配，避免句界歧义。

---

### 4.3 `paintListenRange`（`apps/frontend/src/views/ebook/utils/epubListenSegmentOverlay.ts`）

**对比范围**：新函数 vs 旧版 `paintRangeOverlay`（摘录绘制入口）。

**改动前** · 基线 `paintRangeOverlay` + `clearListenOverlayVisual`，约 L155–L195（摘录）

```typescript
// 旧版：仅 body 下 fixed 浮层，每句预解析 Range 传入
function paintRangeOverlay(range: Range, epoch: number): void {
	if (epoch !== overlayEpoch || !session) return;
	// ... 取 doc、getAccurateRangeLineClientRects ...
	clearListenOverlayInDoc(doc);
	// 创建 fixed inset:0 根节点，append 多个 fixed 色块
	// doc.body.appendChild(root);
	// paintedDocs.add(doc);
}

function clearListenOverlayVisual(): void {
	for (const doc of paintedDocs) {
		try {
			clearListenOverlayInDoc(doc);
		} catch {
			// iframe 已卸载
		}
	}
	paintedDocs.clear();
}
```

**改动后** · 当前 `paintListenRange`，约 L226–L290

```typescript
// 清除所有播放绘制层（CSS / 独立 annotation / DOM group / div overlay）
function clearListenPaint(rend: Rendition): void {
	clearCssListenHighlight(rend);
	detachActiveListenAnnotation(rend);
	removeListenDomGroups(rend);
	clearDivListenOverlay(rend);
}

// 三层回退：CSS Highlight → 独立 highlight 批注 → body div
function paintListenRange(rend: Rendition, range: Range): void {
	clearListenPaint(rend);
	if (paintCssListenHighlight(range)) return;
	if (applyListenAnnotation(rend, range)) return;
	paintDivListenOverlay(range);
}
```

**变更摘要**：由单一 fixed 浮层改为三层回退；清除走 `detachActiveListenAnnotation`，不按 CFI 全局 remove。

---

### 4.4 `beginEpubListenOverlaySession`（同文件）

**对比范围**：完整导出函数。

**改动前** · 基线，约 L248–L276

```typescript
/** 朗读开始前：按 TTS plain 文本预解析各句 DOM 范围 */
export function beginEpubListenOverlaySession(
	rend: Rendition,
	cfiRange: string,
	plainText: string,
): void {
	const key = cfiRange.trim();
	const plain = plainText.trim();
	if (!key || !plain) return;

	clearEpubListenSegmentOverlay();
	overlayEpoch += 1;
	const epoch = overlayEpoch;

	const outer = resolveCfiDomRange(rend, key);
	if (!outer) return;
	const normalized = normalizeSelectionRangeForEpub(outer) ?? outer;
	const sentenceRanges = splitListenSentences(plain).map((sentence) =>
		locateSentenceInRange(normalized, sentence),
	);

	session = {
		rend,
		epoch,
		sentenceRanges,
		activeSentence: -1,
	};

	detachRelayout = attachRelayoutListeners(rend, epoch);
}
```

**改动后** · 当前，约 L412–L444

```typescript
export function beginEpubListenOverlaySession(
	rend: Rendition,
	plainText: string,
	opts?: { cfi?: string; selectionRange?: Range | null },
): void {
	const plain = plainText.trim();
	if (!plain) return;

	clearEpubListenSegmentOverlay();
	overlayEpoch += 1;

	const selectionRange =
		opts?.selectionRange && isRangeConnected(opts.selectionRange)
			? opts.selectionRange.cloneRange()
			: (() => {
					const cfi = opts?.cfi?.trim() ?? '';
					if (!cfi) return null;
					const fromCfi = resolveCfiDomRange(rend, cfi);
					return fromCfi ? fromCfi.cloneRange() : null;
				})();

	session = {
		rend,
		plain,
		cfi: opts?.cfi?.trim() ?? '',
		selectionRange,
		epoch: overlayEpoch,
		plainStart: -1,
		plainEnd: -1,
	};

	detachRelayout = attachRelayoutListeners(rend);
}
```

**变更摘要**：不再预解析句 Range 数组；会话存 plain + 选区/CFI，播放时按偏移即时 `plainSliceToRange`。

## 5. 兼容性与影响

- `showEpubListenSentence` 保留为空实现，避免旧调用方编译失败。
- Safari 等无 CSS Highlight 时自动走 highlight 批注或 div 层。
- 与用户划线冲突修复见 [EPUB听书用户划线对账.md](EPUB听书用户划线对账.md)。

## 6. 回归建议

1. PopBar 选段听当前：逐句淡黄底，句间切换正常。
2. 想法引用底栏听当前：无选区时用 CFI 定位。
3. 播放中翻页/relayout：当前句底色跟随。
4. 停止/播完：底色全清，用户划线仍在。
5. Chrome / Safari 各测一层回退是否可见。

## 7. 相关源码路径

| 说明 | 路径 |
| ---- | ---- |
| 播放浮层 | `apps/frontend/src/views/ebook/utils/epubListenSegmentOverlay.ts` |
| TTS 节奏事件 | `apps/frontend/src/utils/speech.ts` |
| 朗读 hook | `apps/frontend/src/views/ebook/hooks/useEbookQuoteListen.ts` |
| PopBar 选区缓存 | `apps/frontend/src/views/ebook/utils/epubSelectionToolbarAttach.ts` |

---

（若与仓库最新源码不一致，以源码为准）
