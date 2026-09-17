# 听书切句提前 + rAF 进度轮询 + 句内进度回调

> **文档角色**：云端整段 TTS 切句估点提前 `0.35s`、`HTMLAudioElement` 用 `requestAnimationFrame` 轮询进度替代稀疏 `timeupdate`、新增 `onPlaybackProgress` 句内进度回调；听书首包（kick）尾声 `progress ≥ 0.8` 时提前切下一句高亮，缩短「上一句念完到下一段出声」间的预览滞后。
> **延伸阅读**：[EPUB听书云端预取影响.md](./EPUB听书云端预取影响.md)（云端预取与 `playListenUnitsFromCursor`）；[EPUB听书句首标点影响.md](./EPUB听书句首标点影响.md)（分句算法）；[../impact/EPUB听书节奏引导影响.md](../impact/EPUB听书节奏引导影响.md)（本改动对听书/听当前的影响点分析）；[../english/选中文本朗读菜单.md](../english/选中文本朗读菜单.md)（选区朗读为动机方）

## 1. 背景与目标

**问题**：
- 云端整段 TTS（`cloudSingleUtterance`）按 `currentTime/duration × plain.length` 估算当前句；TTS 非匀速 + `timeupdate` 稀疏（约 250ms 一次），切句常落后听感。
- 听书首句（kick）整段 `ended` 后才切到 rest 起始句，导致首句尾音到下一段出声之间预览/高亮明显滞后。

**目标**：
1. 切句估点提前 `CLOUD_CADENCE_LEAD_SEC = 0.35s`（按媒体时间，不随倍速再乘）。
2. 播放期间用 `requestAnimationFrame` 轮询进度，`pause`/`ended` 停泵，`stop` 时取消 rAF。
3. 新增可选 `onPlaybackProgress` 回调，向使用方报告 `{ sentenceIndex, progress }`（句内 0~1）。
4. 听书首包 kick 进度 `≥ 0.8` 且存在下一句时，提前 `onSentence(startSi+1)`；进入 rest 时若已提前则跳过重复调用。

## 2. 改动范围

| 路径 | 变更类型 | 说明 |
|------|----------|------|
| `apps/frontend/src/utils/speech.ts` | 修改 | 新增 `TtsPlaybackProgress` 类型与 `onPlaybackProgress` 选项；`CLOUD_CADENCE_LEAD_SEC` 常量；`playCloudTtsSingleUtterance` 切句提前 + 进度回调；`playCloudTtsPackedSingleUtterances` 转发进度（叠加 `baseSi`）；`playCloudMp3Blob` rAF 轮询；`abortCloudCadenceRaf` 清理；`playPreferred` / `cloudPlayOpts` 转发 `onPlaybackProgress` |
| `apps/frontend/src/views/ebook/utils/epub/listen/epubListenPlayUnits.ts` | 修改 | kick `onPlaybackProgress` ≥0.8 提前切句；rest 入口若已提前则跳过 `onSentence` |

## 3. 实现思路

| # | 要点 | 说明 |
|---|------|------|
| 1 | 媒体时间提前 | 用 `min(duration, currentTime + 0.35)` 算字偏移；TTS 非匀速，纯比例切句常落后听感，媒体时间略提前更贴听感 |
| 2 | rAF 轮询 | `ontimeupdate` 稀疏；`playing` 事件触发后用 `requestAnimationFrame` 泵 `onTimeUpdate(audio.currentTime, audio.duration)`，`pause`/`ended` 停泵并补一次 `emit` |
| 3 | 句内进度回调 | `onPlaybackProgress({ sentenceIndex, progress })`：当前句 span 内 `(offset - span.start) / len`，限 0~1；本机 Web Speech 无可靠字级进度时不回调 |
| 4 | 倍速无关 | lead 按媒体时间秒，不随 `playbackRate` 再乘；2× 时墙钟提前量减半，一般可接受 |
| 5 | kick 80% 提前 | `playListenUnitsFromCursor` 的首包 kick 监听 `onPlaybackProgress`，`progress ≥ 0.8` 且 `startSi+1 < unit.siEnd` 时提前 `onSentence(startSi+1)`；`kickAdvanced` 标志防止重复 |
| 6 | stop 清理 | `stopPlaybackMediaOnly` 调 `abortCloudCadenceRaf` 移除事件监听并取消 rAF，避免卸 src 后仍回调 |

## 4. 关键代码对比与注释

### 4.1 `TtsPlaybackProgress` 类型与 `onPlaybackProgress` 选项（新增）

**对比范围**：`speech.ts` 类型定义区。

**改动前** · `apps/frontend/src/utils/speech.ts`（基线 `HEAD`，约 L474–L510）

```typescript
export type TtsCadenceChunkEvent = {
	sentencePlainStart: number;
	sentencePlainEnd: number;
};

export type TtsSentencePrefetch = {
	plain: string;
	// ...
};

export type PlayPreferredOptions = {
	speak?: SpeakOptions;
	onCadenceChunk?: (event: TtsCadenceChunkEvent) => void;
	// 旧版：无 onPlaybackProgress
	prefetchedCloud?: Promise<TtsSentencePrefetch> | null;
	// ...
};

type CadencePlaybackHooks = Pick<
	PlayPreferredOptions,
	| 'onCadenceChunk'
	// 旧版：无 onPlaybackProgress
	| 'prefetchedCloud'
	| 'onPlaybackStart'
	| 'onAwaitingPlayback'
>;
```

**改动后** · `apps/frontend/src/utils/speech.ts`（当前，约 L474–L522）

```typescript
export type TtsCadenceChunkEvent = {
	sentencePlainStart: number;
	sentencePlainEnd: number;
};

// 新增：云端整段播放：按 audio 进度映射到当前句内 0~1（与句高亮同一套估算）
export type TtsPlaybackProgress = {
	// 当前句索引
	sentenceIndex: number;
	// 句内进度 0~1
	progress: number;
};

export type TtsSentencePrefetch = {
	plain: string;
	// ...
};

export type PlayPreferredOptions = {
	speak?: SpeakOptions;
	onCadenceChunk?: (event: TtsCadenceChunkEvent) => void;
	// 新增：云端单段 Audio 播放进度（currentTime/duration → 句内 progress）
	onPlaybackProgress?: (event: TtsPlaybackProgress) => void;
	prefetchedCloud?: Promise<TtsSentencePrefetch> | null;
	// ...
};

type CadencePlaybackHooks = Pick<
	PlayPreferredOptions,
	| 'onCadenceChunk'
	// 新增：onPlaybackProgress
	| 'onPlaybackProgress'
	| 'prefetchedCloud'
	| 'onPlaybackStart'
	| 'onAwaitingPlayback'
>;
```

**变更摘要**：新增 `TtsPlaybackProgress` 类型与 `onPlaybackProgress` 可选回调；`CadencePlaybackHooks` 新增 `onPlaybackProgress` 键。

---

### 4.2 `playCloudTtsSingleUtterance` — 切句提前 + 进度回调

**对比范围**：`playCloudTtsSingleUtterance` 内传给 `playCloudMp3Blob` 的 `onTimeUpdate` 回调。

**改动前** · `apps/frontend/src/utils/speech.ts`（基线 `HEAD`，约 L1777–L1790）

```typescript
		(currentTime, duration) => {
			// 旧版：无 onCadence 时直接 return
			if (!onCadence || sentences.length === 0) return;
			if (!(duration > 0) || !Number.isFinite(duration)) return;
			// 旧版：纯比例 currentTime/duration
			const ratio = Math.min(1, Math.max(0, currentTime / duration));
			const offset = Math.min(
				Math.max(0, plain.length - 1),
				Math.floor(ratio * plain.length),
			);
			const si = sentenceIndexAtOffset(sentences, offset);
			// 旧版：仅切句高亮
			if (si === lastSi) return;
			if (lastSi >= 0) emitSentence(lastSi, 'end');
			emitSentence(si, 'start');
			lastSi = si;
		},
```

**改动后** · `apps/frontend/src/utils/speech.ts`（当前，约 L1749–L1752、L1799–L1818）

```typescript
// 新增常量：TTS 非匀速 + timeupdate 稀疏，纯比例切句常落后听感；媒体时间略提前
const CLOUD_CADENCE_LEAD_SEC = 0.35;

// ...（playCloudTtsSingleUtterance 内）
		(currentTime, duration) => {
			// 新版：sentences 为空才 return（onCadence 可空，进度回调独立）
			if (sentences.length === 0) return;
			if (!(duration > 0) || !Number.isFinite(duration)) return;
			// 新版：媒体时间提前 0.35s（封顶 duration）
			const leadTime = Math.min(duration, currentTime + CLOUD_CADENCE_LEAD_SEC);
			// 新版：用 leadTime 算比例
			const ratio = Math.min(1, Math.max(0, leadTime / duration));
			const offset = Math.min(
				Math.max(0, plain.length - 1),
				Math.floor(ratio * plain.length),
			);
			const si = sentenceIndexAtOffset(sentences, offset);
			// 新版：onCadence 存在时才切句高亮
			if (onCadence && si !== lastSi) {
				if (lastSi >= 0) emitSentence(lastSi, 'end');
				emitSentence(si, 'start');
				lastSi = si;
			}
			// 新版：onPlaybackProgress 回调（当前句内 0~1）
			const span = sentences[si];
			// 无 span 或无进度回调 → return
			if (!span || !opts?.onPlaybackProgress) return;
			// 句长（至少 1）
			const len = Math.max(1, span.end - span.start);
			// 回调句内进度
			opts.onPlaybackProgress({
				// 句索引
				sentenceIndex: si,
				// 句内 progress（限 0~1）
				progress: Math.min(1, Math.max(0, (offset - span.start) / len)),
			});
		},
```

**变更摘要**：切句估点改用 `currentTime + 0.35s`；`onCadence` 与 `onPlaybackProgress` 解耦——`onCadence` 可空时仍算进度；新增 `onPlaybackProgress` 回调报告当前句内 0~1 进度。

---

### 4.3 `playCloudTtsPackedSingleUtterances` — 转发进度（叠加 `baseSi`）

**对比范围**：`playCloudTtsPackedSingleUtterances` 内传给子播放的 `onPlaybackProgress`。

**改动前** · `apps/frontend/src/utils/speech.ts`（基线 `HEAD`，约 L1862 附近）

```typescript
// 旧版：无 onPlaybackProgress 转发（该字段尚未存在）
```

**改动后** · `apps/frontend/src/utils/speech.ts`（当前，约 L1890–L1898）

```typescript
// 新增：打包单 utterance 转发进度，叠加 baseSi 偏移
					onPlaybackProgress: opts?.onPlaybackProgress
						? (event) => {
								// 转发时把子段句索引加上 baseSi
								opts.onPlaybackProgress!({
									// 展开事件
									...event,
									// sentenceIndex 叠加 baseSi
									sentenceIndex: baseSi + event.sentenceIndex,
								});
							}
						: undefined,
```

**变更摘要**：打包多段播放时，子段进度回调的 `sentenceIndex` 叠加 `baseSi` 偏移，保证使用方拿到全局句索引。

---

### 4.4 `playCloudMp3Blob` — rAF 轮询进度

**对比范围**：`playCloudMp3Blob` 内 `audio.ontimeupdate` 赋值块。

**改动前** · `apps/frontend/src/utils/speech.ts`（基线 `HEAD`，约 L1954–L1965）

```typescript
	audio.src = url;
	// 旧版：无 rAF 清理
	if (onTimeUpdate) {
		// 旧版：仅 ontimeupdate 回调
		audio.ontimeupdate = () => {
			if (!isPlaybackGenerationActive(generation)) return;
			onTimeUpdate(audio.currentTime, audio.duration);
		};
	}
```

**改动后** · `apps/frontend/src/utils/speech.ts`（当前，约 L1993–L2039）

```typescript
	audio.src = url;
	// 新增：清理上一轮 rAF
	abortCloudCadenceRaf?.();
	abortCloudCadenceRaf = null;
	if (onTimeUpdate) {
		// rAF id
		let rafId = 0;
		// 停止 rAF
		const stopRaf = () => {
			// 取消帧
			if (rafId) cancelAnimationFrame(rafId);
			// 清零
			rafId = 0;
		};
		// 发送一次进度
		const emit = () => {
			// 世代失效 → 不发
			if (!isPlaybackGenerationActive(generation)) return;
			// 回调当前时间与时长
			onTimeUpdate(audio.currentTime, audio.duration);
		};
		// rAF 泵循环
		const pump = () => {
			// 清零 rafId（进入下一帧）
			rafId = 0;
			// 发送进度
			emit();
			// 仍在播放 → 安排下一帧
			if (
				// 世代活跃
				isPlaybackGenerationActive(generation) &&
				// 未暂停
				!audio.paused &&
				// 未结束
				!audio.ended
			) {
				// 请求下一帧
				rafId = requestAnimationFrame(pump);
			}
		};
		// playing 事件：启动 rAF
		const onPlaying = () => {
			// 先停旧 rAF
			stopRaf();
			// 启动泵
			rafId = requestAnimationFrame(pump);
		};
		// pause/ended：停 rAF 并补一次 emit
		const onPauseOrEnd = () => {
			// 停 rAF
			stopRaf();
			// 补发最终进度
			emit();
		};
		// 清理函数：移除事件 + 取消 rAF
		abortCloudCadenceRaf = () => {
			// 停 rAF
			stopRaf();
			// 移除 playing 监听
			audio.removeEventListener('playing', onPlaying);
			// 移除 pause 监听
			audio.removeEventListener('pause', onPauseOrEnd);
			// 移除 ended 监听
			audio.removeEventListener('ended', onPauseOrEnd);
			// 清空清理函数引用
			abortCloudCadenceRaf = null;
		};
		// 绑定事件
		audio.addEventListener('playing', onPlaying);
		audio.addEventListener('pause', onPauseOrEnd);
		audio.addEventListener('ended', onPauseOrEnd);
		// 兜底：部分环境 playing 事件稀疏
		audio.ontimeupdate = () => {
			// 世代失效 → 不发
			if (!isPlaybackGenerationActive(generation)) return;
			// 发送进度
			emit();
		};
	}
```

**变更摘要**：`ontimeupdate` 之外新增 `playing` 启动 rAF 泵、`pause`/`ended` 停泵并补 `emit`；`abortCloudCadenceRaf` 集中移除事件与取消 rAF，供 `stopPlaybackMediaOnly` 调用。

---

### 4.5 `stopPlaybackMediaOnly` — 清理 rAF

**对比范围**：`stopPlaybackMediaOnly` 函数内清理段。

**改动前** · `apps/frontend/src/utils/speech.ts`（基线 `HEAD`，约 L1202–L1208）

```typescript
function stopPlaybackMediaOnly(): void {
	// ...（其它清理未改动）
	abortCloudAudioWait?.();
	abortCloudAudioWait = null;
	// 旧版：无 abortCloudCadenceRaf 清理
	detachCloudAudioPauseBridge?.();
	detachCloudAudioPauseBridge = null;
	// ...（后续清理未改动）
```

**改动后** · `apps/frontend/src/utils/speech.ts`（当前，约 L1216–L1220）

```typescript
function stopPlaybackMediaOnly(): void {
	// ...（其它清理未改动）
	abortCloudAudioWait?.();
	abortCloudAudioWait = null;
	// 新增：取消 rAF 并移除事件监听
	abortCloudCadenceRaf?.();
	abortCloudCadenceRaf = null;
	detachCloudAudioPauseBridge?.();
	detachCloudAudioPauseBridge = null;
	// ...（后续清理未改动）
```

**变更摘要**：`stopPlaybackMediaOnly` 增加 `abortCloudCadenceRaf` 清理，避免卸 src 后 rAF 仍回调。

---

### 4.6 `epubListenPlayUnits.ts` — kick 80% 提前切句

**对比范围**：`playListenUnitsFromCursor` 内首包 kick 播放段。

**改动前** · `apps/frontend/src/views/ebook/utils/epub/listen/epubListenPlayUnits.ts`（基线 `HEAD`，约 L145–L175）

```typescript
			// 旧版：无 kickAdvanced 标志
			await playCurrent(kickRaw, {
				speak: { rate: getRate() },
				cloudSingleUtterance: true,
				onPlaybackStart: prefetchAfterKickStart,
				// 旧版：无 onPlaybackProgress
			});
			// 本机无 onPlaybackStart 时仍兜底预取
			prefetchAfterKickStart();
		// ...（后续）
		const restStartSi = si;
		// 旧版：无条件 onSentence(restStartSi)
		onSentence(restStartSi, {});
```

**改动后** · `apps/frontend/src/views/ebook/utils/epub/listen/epubListenPlayUnits.ts`（当前，约 L148–L183）

```typescript
			// 新增：首包尾声提前切到下一句，避免等 kick 整段 ended 才改预览
			let kickAdvanced = false;
			await playCurrent(kickRaw, {
				speak: { rate: getRate() },
				cloudSingleUtterance: true,
				onPlaybackStart: prefetchAfterKickStart,
				// 新增：监听句内进度
				onPlaybackProgress: (event) => {
					// 非活跃或已提前 → 忽略
					if (!isActive() || kickAdvanced) return;
					// 进度未达 0.8 → 忽略
					if (event.progress < 0.8) return;
					// 已是最后一句 → 忽略
					if (startSi + 1 >= unit.siEnd) return;
					// 标记已提前
					kickAdvanced = true;
					// 提前切到下一句
					onSentence(startSi + 1, {});
				},
			});
			// 本机无 onPlaybackStart 时仍兜底预取，保证后续等待不被拉长
			prefetchAfterKickStart();
		// ...（后续）
		const restStartSi = si;
		// 新增：若 kick 已提前切句，则不再重复 onSentence
		if (!kickAdvanced) onSentence(restStartSi, {});
```

**变更摘要**：kick 段新增 `onPlaybackProgress` 监听，`progress ≥ 0.8` 且存在下一句时提前 `onSentence(startSi+1)`；`kickAdvanced` 标志防止 rest 入口重复切句。

## 5. 兼容性与影响

| 项目 | 说明 |
|------|------|
| 本机 Web Speech | lead/rAF 挂在云端 `HTMLAudioElement`；本机仍走 cadence 分段，行为不变 |
| 软暂停 / 续播 | rAF 在 `pause` 停、`playing` 再启；软暂停语义不变 |
| 倍速 | lead 按媒体时间秒，不随 `playbackRate` 再乘；2× 时墙钟提前量减半 |
| 预取 / 世代 / `isActive` | 未改控制流；`stop` 时 `abortCloudCadenceRaf` 清理 rAF |
| `onPlaybackProgress` 可选 | 未传时 `playCloudTtsSingleUtterance` 内 `!opts?.onPlaybackProgress` 短路，零开销 |
| 影响点详见 | [../impact/EPUB听书节奏引导影响.md](../impact/EPUB听书节奏引导影响.md) |

## 6. 风险与回归清单

| 风险 | 排查 |
|------|------|
| 高亮「抢跑」过多 | `0.35s` 对很短句偏大；听书英文短句连播看高亮是否明显早于开念 |
| kick 80% 误切 | 单句 kick 尾静音长时可能更早亮下一句；首句较长章节验收 |
| rAF 耗电 | 仅存在 `onTimeUpdate`（整段单 utterance 切句）时泵帧；长段连播看帧率/发热 |
| 重复 `onSentence` | `kickAdvanced` 标志防重复；确认高亮不闪烁 |
| stop 后仍回调 | `abortCloudCadenceRaf` 移除事件 + 取消 rAF |

建议回归：
1. 听书云端整段多句：高亮与听感齐（略提前可接受）
2. 听书首句 kick → rest：高亮不闪、不跳错句
3. 听书暂停 / 续播 / 改倍速：句高亮仍正确
4. 听书切章、停止后再播：无残留高亮错位
5. 听当前：同上句高亮时序
6. 本机音色回退：仍可播，行为与改前一致
7. 英语 Agent 选区朗读：预览切句不再明显落后于声音

## 7. 相关源码路径

| 说明 | 路径 |
|------|------|
| TTS 播放核心 | `apps/frontend/src/utils/speech.ts` |
| 听书播放游标 | `apps/frontend/src/views/ebook/utils/epub/listen/epubListenPlayUnits.ts` |
| 影响点分析 | `docs/impact/EPUB听书节奏引导影响.md` |

---

（若与仓库最新源码不一致，以源码为准）
