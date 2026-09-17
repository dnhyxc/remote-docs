# EPUB 引用「听当前」与跨语言本机 TTS 修复

## 延伸阅读

- **现行主路径（2026-07-16）**：[听当前切入听书续读与起播定位](EPUB听书引用继续.md)、[PopBar 听后收起](EPUB听书PopBar关闭.md)
- [EPUB 选区浮动工具条](EPUB选区PopBar视觉.md) — PopBar 入口与 `suppressEpubSelectionPopBarDismiss`
- [EPUB 想法侧栏](EPUB想法抽屉.md) — 列表/详情引用底栏 `variant="panel"`
- 英语学习 TTS 能力见 `docs/english/` 相关专题；本实现复用 `playPreferred` / `stopAllPlayback`
- [云端长文分段流水线](../english/云端TTS分段管线.md) — 长书摘云端首声加速（分段 + 预取）
- [听当前逐句播放背景](EPUB听书句背景.md) — 朗读时当前句淡黄底、与划线解耦的浮层实现

> **说明**：本文描述早期「独立听当前会话」实现。当前产品语义已改为切入听书续读，以 [EPUB听书引用继续.md](./EPUB听书引用继续.md) 为准。

## 1. 背景与目标

**用户视角**：在 EPUB 阅读中，选区浮动工具条、读书想法列表与详情引用卡片底部已有「听当前」按钮，此前无实际朗读行为；本机 Web Speech 对中文长句、音色未就绪时也容易无声或卡顿。

**目标**：

1. 三处入口统一朗读当前引用/选区文本，播放中按钮文案为「停止」，再次点击停止。
2. 复用英语学习模块的 TTS 栈（本机优先、可接云端），避免电子书单独造轮子。
3. 在共享 `speech.ts` 中修复中英混排分句、CJK 音色选择与 `speechSynthesis` 未 resume 等本机兼容问题（英语学习与本节听书共用）。

## 2. 改动范围

| 路径 | 说明 |
| ---- | ---- |
| `apps/frontend/src/views/ebook/hooks/useEbookQuoteListen.ts` | 新增：朗读状态、toggle、挂载预热 |
| `apps/frontend/src/views/ebook/hooks/index.ts` | 新增：barrel 导出 |
| `apps/frontend/src/views/ebook/read.tsx` | 接入 hook；PopBar/想法列表/详情 `onListen` 与 `listenLabel` |
| `apps/frontend/src/views/ebook/components/EpubQuoteActionBar.tsx` | 新增 `onListen`；`listen` 纳入保留选区动作 |
| `apps/frontend/src/views/ebook/components/EpubSelectionPopBar.tsx` | 透传 `onListen` |
| `apps/frontend/src/views/ebook/components/EpubSelectionPopBarPanel.tsx` | 透传 `onListen` |
| `apps/frontend/src/utils/speech.ts` | 中英分句、CJK 音色、utterance 长度切分、resume |

**未纳入本篇**（另文或已提交）：`drawer` → `panel` 重命名、`read.tsx` 讲解注释、PopBar `inline` 死路径。

## 3. 实现思路

1. **单一 hook**：`useEbookQuoteListen(t)` 用 `playingKey` 标记当前朗读会话；`toggleListen(text, key)` 对同一 key 再点则 `stopAllPlayback`；不可用时 Toast 提示（复用 `englishLearning.tts.unsupported`）。
2. **三处接线**（`read.tsx`）：
   - PopBar：固定 key `'popbar'`，文本来自 `selectionPopBarRef.current.selectedText`；点听前 `suppressEpubSelectionPopBarDismiss()`。
   - 想法列表 / 详情：`listenKey` 为 `thought-list:${cfiRange}` / `thought-dialog:${cfiRange}`，文本为聚合引用 `quote`。
3. **文案**：`listenLabel(key, defaultLabel)` 播放中返回 `t('englishLearning.tts.stop')`，否则为「听当前」i18n。
4. **UI 层**：`EpubQuoteActionBar` 已有 `listen` 按钮位与 `PRESERVE_SELECTION_ACTIONS`；本轮仅补 `onListen` prop 与 handler 映射。
5. **TTS 层**：`playPreferred` 不变；`splitTextForTtsCadence` 支持中英标点、子句分层与 `MAX_UTTERANCE_CHARS` 硬切；`pickVoiceForChunk` 按 CJK 占比选中文/英文音色；`speak` 后 `resume()`；`pickEnglishVoice` 在 voices 未就绪时不缓存 `null`。
6. **权衡**：共享 `speech` 影响英语学习与本节听书，需双边回归；会员仍走云端 TTS 偏好，非会员本机。

## 4. 关键代码对比与注释

### 4.1 `useEbookQuoteListen`（`apps/frontend/src/views/ebook/hooks/useEbookQuoteListen.ts`）

**对比范围**：纯新增模块；无改动前块。下列为**改动后**完整 hook（约 L1–L58）。

**改动后** · `apps/frontend/src/views/ebook/hooks/useEbookQuoteListen.ts`（当前，约 L1–L58）

```typescript
// 朗读不可用或播放失败时弹出警告 Toast
import { Toast } from '@ui/sonner';
import { useCallback, useEffect, useState } from 'react';
// 英语学习 TTS 栈：本机/云端、全局停止、音色预热
import {
	isPlaybackAvailable,
	playPreferred,
	stopAllPlayback,
	warmupSpeechVoices,
} from '@/utils/speech';

/** 电子书引用/选区朗读：复用英语学习 TTS（本机 / 云端偏好） */
export function useEbookQuoteListen(t: (key: string) => string) {
	// 当前播放会话 key（popbar / thought-list:cfi / thought-dialog:cfi）
	const [playingKey, setPlayingKey] = useState<string | null>(null);

	// 挂载预热 voices；卸载时停止朗读，避免离开阅读页仍播报
	useEffect(() => {
		warmupSpeechVoices();
		return () => stopAllPlayback();
	}, []);

	// 切换播放/停止：text 为待读正文，key 区分三处入口
	const toggleListen = useCallback(
		async (text: string, key: string) => {
			const trimmed = text.trim();
			if (!trimmed) return;
			// 同 key 再点 → 停止
			if (playingKey === key) {
				stopAllPlayback();
				setPlayingKey(null);
				return;
			}
			// 本机与云端均不可用时提示并返回
			if (!isPlaybackAvailable()) {
				Toast({
					type: 'warning',
					title: t('englishLearning.tts.unsupported'),
				});
				return;
			}
			stopAllPlayback();
			setPlayingKey(key);
			try {
				await playPreferred(trimmed);
			} catch {
				Toast({
					type: 'warning',
					title: t('englishLearning.tts.unsupported'),
				});
			} finally {
				// 仅当仍是本会话 key 时清状态（快速切换引用时不误清新会话）
				setPlayingKey((k) => (k === key ? null : k));
			}
		},
		[playingKey, t],
	);

	// 播放中返回 i18n「停止」，否则用调用方默认文案（听当前）
	const listenLabel = useCallback(
		(key: string, defaultLabel: string) =>
			playingKey === key ? t('englishLearning.tts.stop') : defaultLabel,
		[playingKey, t],
	);

	return { toggleListen, playingKey, listenLabel };
}
```

**变更摘要**：新 hook 封装播放 key、toggle 与 i18n 文案；卸载时 `stopAllPlayback`。

---

### 4.2 `onSelectionPopBarListen`（`apps/frontend/src/views/ebook/read.tsx`）

**对比范围**：完整 `useCallback`（基线无此符号）。

**改动前** · `apps/frontend/src/views/ebook/read.tsx`（基线）

```typescript
// （无 onSelectionPopBarListen；EpubSelectionPopBar 未传 onListen）
```

**改动后** · 同文件（当前，约 L1273–L1278）

```typescript
// PopBar「听当前」：读 ref 内选区文本，suppress 后 toggle，key 固定 popbar
const onSelectionPopBarListen = useCallback(() => {
	const payload = selectionPopBarRef.current;
	if (!payload?.selectedText.trim()) return;
	suppressEpubSelectionPopBarDismiss();
	void toggleListen(payload.selectedText, 'popbar');
}, [toggleListen]);
```

**变更摘要**：PopBar 朗读与复制同样先 suppress，避免点听关闭工具条。

---

### 4.3 `thoughtListQuoteActions` 中的 `onListen`（摘录）

**对比范围**：`useMemo` 返回对象内 `labels.listen`、`onListen` 及 deps 中 listen 相关项（前后对称摘录；划线/分享等未改行用 `// ...`）。

**改动前** · `apps/frontend/src/views/ebook/read.tsx`（基线）

```typescript
const thoughtListQuoteActions = useMemo(() => {
	// ...（cluster、cfiRange、quote、hasHighlight 等未改动）
	return {
		labels: {
			...selectionPopBarLabels,
			// 无 listen 动态文案
		},
		// ...（onCopy、onUnderline 等）
		onShare: () => openQuoteShare(quote, { cfiRange }),
		// 无 onListen
	};
}, [
	// ...（无 toggleListen / listenLabel）
]);
```

**改动后** · 同文件（当前，约 L1306–L1364）

```typescript
const thoughtListQuoteActions = useMemo(() => {
	// ...（cluster、cfiRange、quote、hasHighlight 等未改动）
	const listenKey = `thought-list:${cfiRange}`;
	return {
		labels: {
			...selectionPopBarLabels,
			listen: listenLabel(listenKey, t('ebook.read.selectionPop.listen')),
		},
		// ...（onCopy、onUnderline 等未改动）
		onShare: () => openQuoteShare(quote, { cfiRange }),
		onListen: () => void toggleListen(quote, listenKey),
	};
}, [
	// ...（既有 deps）
	toggleListen,
	listenLabel,
	t,
]);
```

**变更摘要**：列表引用底栏接入朗读；`thoughtDialogQuoteActions` 结构相同，key 为 `thought-dialog:${cfiRange}`。

---

### 4.4 `EpubQuoteActionBar` 的 `onListen`（`apps/frontend/src/views/ebook/components/EpubQuoteActionBar.tsx`）

**对比范围**：props 类型、HANDLER_PROP、组件解构（`listen` 按钮位与 PRESERVE 在基线已存在，本轮只接 handler）。

**改动前** · 同文件（基线，摘录）

```typescript
export type EpubQuoteActionBarProps = {
	// ...（onCopy 等）
	onShare?: () => void;
	// 无 onListen
};

const HANDLER_PROP = {
	// ...
	share: 'onShare',
	// 无 listen 映射
};

export function EpubQuoteActionBar({
	// ...
	onShare,
	// 无 onListen
}: EpubQuoteActionBarProps) {
	const handlers = {
		// ...
		onShare,
	} as const;
}
```

**改动后** · 同文件（当前，摘录）

```typescript
export type EpubQuoteActionBarProps = {
	// ...（onCopy 等）
	/** 朗读当前引用/选区（英语学习 TTS） */
	onListen?: () => void;
	onShare?: () => void;
};

const HANDLER_PROP = {
	// ...
	share: 'onShare',
	listen: 'onListen',
};

export function EpubQuoteActionBar({
	// ...
	onShare,
	onListen,
}: EpubQuoteActionBarProps) {
	const handlers = {
		// ...
		onShare,
		onListen,
	} as const;
}
```

**变更摘要**：将既有 `listen` 按钮接到父级传入的 `onListen`。

---

### 4.5 `splitTextForTtsCadence`（`apps/frontend/src/utils/speech.ts`）

**对比范围**：完整函数及本轮新增的 `splitLongText` / `isPredominantlyCjk` / `MAX_UTTERANCE_CHARS`（改动前无后者三符号）。

**改动前** · 同文件（基线，约 L52–L91）

```typescript
// 句读停顿毫秒常量（子句 / 整句）
const PAUSE_AFTER_SENTENCE_MS = 480;
const PAUSE_AFTER_CLAUSE_MS = 300;

/**
 * 按句末 / 逗号分层切分，段间插入不同时长停顿（无法调用系统「翻译」弹窗 API，靠停顿模拟顿挫）
 */
function splitTextForTtsCadence(text: string): TtsCadenceChunk[] {
	const trimmed = text.trim();
	if (!trimmed) return [];
	// 无英有句读且较短则整段一次读完
	if (!/[.!?;,]/.test(trimmed) && trimmed.length < 72) {
		return [{ text: trimmed, pauseAfterMs: 0 }];
	}

	const sentences = trimmed
		.split(/(?<=[.!?])\s+/)
		.map((s) => s.trim())
		.filter(Boolean);
	if (sentences.length === 0) {
		return [{ text: trimmed, pauseAfterMs: 0 }];
	}

	const chunks: TtsCadenceChunk[] = [];
	for (let si = 0; si < sentences.length; si += 1) {
		const sent = sentences[si];
		const clauses = sent
			.split(/(?<=[,;:])\s+/)
			.map((s) => s.trim())
			.filter(Boolean);
		const parts = clauses.length > 0 ? clauses : [sent];
		for (let ci = 0; ci < parts.length; ci += 1) {
			const lastClause = ci === parts.length - 1;
			const lastSentence = si === sentences.length - 1;
			chunks.push({
				text: parts[ci],
				pauseAfterMs: !lastClause
					? PAUSE_AFTER_CLAUSE_MS
					: !lastSentence
						? PAUSE_AFTER_SENTENCE_MS
						: 0,
			});
		}
	}
	return chunks.length > 0 ? chunks : [{ text: trimmed, pauseAfterMs: 0 }];
}
```

**改动后** · 同文件（当前，约 L50–L142）

```typescript
const PAUSE_AFTER_SENTENCE_MS = 480;
const PAUSE_AFTER_CLAUSE_MS = 300;
/** 单段 utterance 过长时浏览器本机 TTS 易截断或静默失败 */
const MAX_UTTERANCE_CHARS = 120;

/** 文本是否以 CJK 为主（用于本机朗读选中文音色） */
function isPredominantlyCjk(text: string): boolean {
	let cjk = 0;
	let letters = 0;
	for (const ch of text) {
		if (/[\u4e00-\u9fff\u3400-\u4dbf\uf900-\ufaff]/.test(ch)) cjk += 1;
		else if (/[A-Za-z]/.test(ch)) letters += 1;
	}
	return cjk > 0 && cjk >= letters;
}

function splitLongText(text: string, maxLen: number): string[] {
	if (text.length <= maxLen) return [text];
	const parts: string[] = [];
	let rest = text;
	while (rest.length > maxLen) {
		let cut = maxLen;
		if (/[\u4e00-\u9fff]/.test(rest)) {
			cut = maxLen;
		} else {
			const space = rest.lastIndexOf(' ', maxLen);
			if (space > maxLen / 2) cut = space;
		}
		const piece = rest.slice(0, cut).trim();
		if (piece) parts.push(piece);
		rest = rest.slice(cut).trim();
	}
	if (rest) parts.push(rest);
	return parts.length > 0 ? parts : [text];
}

/**
 * 按句末 / 逗号分层切分（中英标点），段间插入停顿；过长段再硬切避免本机 TTS 失败
 */
function splitTextForTtsCadence(text: string): TtsCadenceChunk[] {
	const trimmed = text.trim();
	if (!trimmed) return [];

	const hasEnSentence = /[.!?]/.test(trimmed);
	const hasCnSentence = /[。！？]/.test(trimmed);
	const hasClause = /[,;，；：:]/.test(trimmed);

	if (
		!hasEnSentence &&
		!hasCnSentence &&
		!hasClause &&
		trimmed.length < MAX_UTTERANCE_CHARS
	) {
		return [{ text: trimmed, pauseAfterMs: 0 }];
	}

	const sentences = trimmed
		.split(/(?<=[.!?。！？])\s*/)
		.map((s) => s.trim())
		.filter(Boolean);
	const sentenceParts =
		sentences.length > 0 ? sentences : [trimmed];

	const chunks: TtsCadenceChunk[] = [];
	for (let si = 0; si < sentenceParts.length; si += 1) {
		const sent = sentenceParts[si];
		const clauses = sent
			.split(/(?<=[,;，；：:])\s+/)
			.map((s) => s.trim())
			.filter(Boolean);
		const parts = clauses.length > 0 ? clauses : [sent];
		for (let ci = 0; ci < parts.length; ci += 1) {
			const subChunks = splitLongText(parts[ci], MAX_UTTERANCE_CHARS);
			for (let sub = 0; sub < subChunks.length; sub += 1) {
				const lastClause = ci === parts.length - 1;
				const lastSentence = si === sentenceParts.length - 1;
				const lastSub = sub === subChunks.length - 1;
				chunks.push({
					text: subChunks[sub],
					pauseAfterMs:
						!lastSub
							? PAUSE_AFTER_CLAUSE_MS
							: !lastClause
								? PAUSE_AFTER_CLAUSE_MS
								: !lastSentence
									? PAUSE_AFTER_SENTENCE_MS
									: 0,
				});
			}
		}
	}
	return chunks.length > 0 ? chunks : [{ text: trimmed, pauseAfterMs: 0 }];
}
```

**变更摘要**：中英标点分句、子句内 `splitLongText` 硬切，避免中文长段本机无声。

---

### 4.6 `pickVoiceForChunk` 与 `speakOneUtterance`（同文件）

**对比范围**：`pickVoiceForChunk` 全函数；`speakOneUtterance` 内选音与 `resume` 片段（对称摘录）。

**改动前** · 同文件（基线，`speakOneUtterance` 片段）

```typescript
		const utter = new SpeechSynthesisUtterance(plain);
		utter.lang = 'en-US';

		const voice = pickEnglishVoice();
		if (voice) {
			utter.voice = voice;
			utter.lang = voice.lang || 'en-US';
		}
		// ...（rate/pitch/volume）
		window.speechSynthesis.speak(utter);
		// 无 resume
```

**改动后** · 同文件（当前）

```typescript
function pickVoiceForChunk(chunkText: string): SpeechSynthesisVoice | null {
	if (isPredominantlyCjk(chunkText)) {
		return pickChineseVoice() ?? pickEnglishVoice();
	}
	return pickEnglishVoice();
}

		const utter = new SpeechSynthesisUtterance(plain);
		const voice = pickVoiceForChunk(plain);
		if (voice) {
			utter.voice = voice;
			utter.lang = voice.lang || (isPredominantlyCjk(plain) ? 'zh-CN' : 'en-US');
		} else {
			utter.lang = isPredominantlyCjk(plain) ? 'zh-CN' : 'en-US';
		}
		// ...（rate/pitch/volume 未改动）
		window.speechSynthesis.speak(utter);
		// Chrome 等浏览器在长文本分段时可能挂起，轻触 resume 保证后续段能播
		window.speechSynthesis.resume();
```

**变更摘要**：CJK 块用中文音色；`speak` 后 `resume`；`pickEnglishVoice` 在 voices 未就绪时不缓存 `null`（见 diff L342–350）。

## 5. 兼容性与影响

| 项 | 说明 |
| ---- | ---- |
| 登录 | 与划线/想法一致，朗读本身不强制登录；云端 TTS 若启用仍走英语学习配置 |
| PDF | 无「听当前」入口（引用条仅 EPUB 想法流） |
| 共享 TTS | `speech.ts` 变更影响英语学习页，需抽测中英文朗读 |
| 破坏性 | 无 API 破坏；`EpubQuoteActionBar` 仅增可选 prop |

## 6. 风险与回归

1. EPUB 选中文字 → PopBar「听当前」→ 应朗读且工具条保持；再点「停止」。
2. 想法列表/详情引用底栏同样可听/停。
3. 中文为主的书摘在本机 Chrome/Safari 应有声。
4. 快速连续点不同引用：应先停旧段再播新段。
5. 英语学习页 TTS 回归（长句、中英文混排）。

## 7. 相关源码路径

| 说明 | 路径 |
| ---- | ---- |
| 朗读 hook | `apps/frontend/src/views/ebook/hooks/useEbookQuoteListen.ts` |
| 阅读页接线 | `apps/frontend/src/views/ebook/read.tsx` |
| 引用操作条 | `apps/frontend/src/views/ebook/components/EpubQuoteActionBar.tsx` |
| TTS 核心 | `apps/frontend/src/utils/speech.ts` |

---

（若与仓库最新源码不一致，以源码为准）
