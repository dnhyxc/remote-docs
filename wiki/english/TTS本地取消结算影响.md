# 本机 Web Speech — cancel 后 settle

## 延伸阅读

- [TTS本地取消结算影响.md](../impact/TTS本地取消结算影响.md) — **影响面矩阵**与回归清单
- [英语TTS播放.md](./英语TTS播放.md) — 播放世代与 `beginPlaybackSession`
- [EPUB引用听书播放器栏影响.md](../ebook/EPUB引用听书播放器栏影响.md) — 听当前按句 `playPreferred` 循环
- [TTS播放源.md](./TTS播放源.md) — 本机 / MiniMax / 讯飞选路

**文档角色**：修复 Chrome 等在 `speechSynthesis.cancel()` 后立刻 `speak()` 导致**首条 utterance 无声**；云端 `HTMLAudioElement` 路径不受影响。

---

## 1. 背景与目标

### 1.1 问题

听当前、听书在本机来源（`playbackSource: 'local'`）下逐句调用 `playPreferred` → `beginPlaybackSession` → `speechSynthesis.cancel()` → `speakOneUtterance`。Chrome / Safari 上 **cancel 与下一条 utterance 同一事件循环内提交** 时，首条常被丢弃（`onerror` 后仍 resolve），表现为 **第一句无声、第二句正常**。

云端路径因网络延迟天然避开该竞态；本机路径需显式让出事件循环。

### 1.2 目标

- 在 `speakTextWithGeneration` 入口、`waitForVoicesReady` 之后 **固定等待 50ms** 再 `speak()`。
- **不改** 对外 API、云端 MP3 播放、句内 cadence 循环。
- settle 后再次校验 `playbackGeneration`，避免停止后误播。

---

## 2. 改动范围

| 路径 | 变更 |
|------|------|
| `apps/frontend/src/utils/speech.ts` | 新增 `settleSpeechSynthesisAfterCancel`；`speakTextWithGeneration` 内调用 |

**分析基准**：工作区相对 `HEAD`（`2c5bf058` 侧）未提交 diff。

---

## 3. 实现思路

1. **复用 `pauseMs(50)`**  
   与句内 cadence 停顿同一计时器，不引入新依赖。

2. **仅本机 speak 入口 settle 一次**  
   挂在 `speakTextWithGeneration` 整段入口，chunk 循环内不重复等待。

3. **世代二次校验**  
   `settle` 的 50ms 内用户可能 `stopAllPlayback`；settle 后 `isPlaybackGenerationActive` 为 false 则静默 return。

4. **云端零影响**  
   `playCloudTtsCadenceSegments` / `playCloudMp3Blob` 不经过本函数。

5. **ponytail 注释**  
   函数块注释说明 Chrome cancel 竞态与云端 Audio 不受影响。

---

## 4. 关键代码对比与注释

### 4.1 `settleSpeechSynthesisAfterCancel`（纯新增）

**对比范围**：私有 async 函数全定义（改前不存在）。

**改动后** · `apps/frontend/src/utils/speech.ts`（当前，约 L355–L360）

```typescript
// beginPlaybackSession/stopAll 里 cancel() 后立刻 speak()，Chrome 会无声并 onerror；云端走 Audio 不受影响
async function settleSpeechSynthesisAfterCancel(): Promise<void> {
	// 环境不支持 Web Speech 则无需等待
	if (!isSpeechSupported()) return;
	// 固定 50ms，让 cancel 在引擎内完成后再提交 utterance
	await pauseMs(50);
}
```

**变更摘要**：新增 cancel 后固定 settle；仅本机 speak 路径使用。

---

### 4.2 `speakTextWithGeneration`

**对比范围**：`async function speakTextWithGeneration` 全函数。

**改动前** · `apps/frontend/src/utils/speech.ts`（基线 HEAD，约 L1276–L1310）

```typescript
// 带 playbackGeneration 的本机 cadence 朗读（改前无 cancel settle）
async function speakTextWithGeneration(
	text: string,
	generation: number,
	options?: SpeakOptions & CadencePlaybackHooks,
): Promise<void> {
	// 不支持 Web Speech 则退出
	if (!isSpeechSupported()) return;

	// 去 markdown 得 plain
	const plain = stripMarkdownForTts(text);
	// 空文本不播
	if (!plain) return;
	// 世代已作废则退出
	if (!isPlaybackGenerationActive(generation)) return;

	// 等待音色列表就绪（可能 0ms）
	await waitForVoicesReady();
	// 等待后再次校验世代
	if (!isPlaybackGenerationActive(generation)) return;
	// 改前：立刻 reset 音色缓存并 speak，易与 cancel 竞态
	resetCachedLocalVoice();

	// 按句读 / 逗号切 chunk
	const chunks = splitTextForTtsCadence(plain);
	// 多 chunk 略降语速
	const chunkRate = chunks.length > 1 ? 0.86 : 0.9;
	// 逐 chunk 播放
	for (let i = 0; i < chunks.length; i += 1) {
		// 每 chunk 前校验世代
		if (!isPlaybackGenerationActive(generation)) return;
		// 当前 chunk
		const chunk = chunks[i];
		// 非首 chunk：句内停顿
		if (i > 0) {
			// 上一 chunk 配置的 pauseAfterMs
			const prevPause = chunks[i - 1]?.pauseAfterMs ?? PAUSE_AFTER_CLAUSE_MS;
			// 等待顿挫
			await pauseMs(prevPause);
			// 停顿后校验世代
			if (!isPlaybackGenerationActive(generation)) return;
		}
		// cadence 开始事件（电子书句高亮等）
		emitCadenceChunk(options, plain, chunks, i, 'start');
		// 提交 Web Speech utterance
		await speakOneUtterance(chunk.text, generation, {
			rate: options?.rate ?? chunkRate,
			pitch: options?.pitch,
			volume: options?.volume,
		});
		// 播完校验世代
		if (!isPlaybackGenerationActive(generation)) return;
		// cadence 结束事件
		emitCadenceChunk(options, plain, chunks, i, 'end');
	}
}
```

**改动后** · `apps/frontend/src/utils/speech.ts`（当前，约 L1276–L1314）

```typescript
// 带 playbackGeneration 的本机 cadence 朗读（含 cancel settle）
async function speakTextWithGeneration(
	text: string,
	generation: number,
	options?: SpeakOptions & CadencePlaybackHooks,
): Promise<void> {
	// 不支持 Web Speech 则退出
	if (!isSpeechSupported()) return;

	// 去 markdown 得 plain
	const plain = stripMarkdownForTts(text);
	// 空文本不播
	if (!plain) return;
	// 世代已作废则退出
	if (!isPlaybackGenerationActive(generation)) return;

	// 等待音色列表就绪
	await waitForVoicesReady();
	// 等待后再次校验世代
	if (!isPlaybackGenerationActive(generation)) return;
	// 改后：cancel 后 settle 50ms 再 speak
	await settleSpeechSynthesisAfterCancel();
	// settle 期间可能被 stop，再校验
	if (!isPlaybackGenerationActive(generation)) return;
	// 重置音色缓存
	resetCachedLocalVoice();

	// 按句读 / 逗号切 chunk
	const chunks = splitTextForTtsCadence(plain);
	// 多 chunk 略降语速
	const chunkRate = chunks.length > 1 ? 0.86 : 0.9;
	// 逐 chunk 播放（句内逻辑未改）
	for (let i = 0; i < chunks.length; i += 1) {
		// 每 chunk 前校验世代
		if (!isPlaybackGenerationActive(generation)) return;
		// 当前 chunk
		const chunk = chunks[i];
		// 非首 chunk：句内停顿
		if (i > 0) {
			// 上一 chunk 的 pauseAfterMs
			const prevPause = chunks[i - 1]?.pauseAfterMs ?? PAUSE_AFTER_CLAUSE_MS;
			// 等待顿挫
			await pauseMs(prevPause);
			// 停顿后校验世代
			if (!isPlaybackGenerationActive(generation)) return;
		}
		// cadence 开始事件
		emitCadenceChunk(options, plain, chunks, i, 'start');
		// 提交 Web Speech utterance
		await speakOneUtterance(chunk.text, generation, {
			rate: options?.rate ?? chunkRate,
			pitch: options?.pitch,
			volume: options?.volume,
		});
		// 播完校验世代
		if (!isPlaybackGenerationActive(generation)) return;
		// cadence 结束事件
		emitCadenceChunk(options, plain, chunks, i, 'end');
	}
}
```

**变更摘要**：在 `waitForVoicesReady` 与 `resetCachedLocalVoice` 之间插入 `settleSpeechSynthesisAfterCancel` 及世代再校验；chunk 循环不变。

---

## 5. 调用链（谁受影响）

| 入口 | 触发本机 `speakTextWithGeneration` 的条件 |
|------|--------------------------------------------------|
| `playPreferred` | `shouldUseCloudTts()` 为 false |
| `playPreferred` catch | 云端失败且本机可用 |
| `speakText` | 直接本机朗读 |

**不经过** 本函数：MiniMax / 讯飞 `playCloudTtsCadenceSegments`、`prefetchCloudTts` 预取 HTTP。

---

## 6. 兼容性与影响

| 维度 | 说明 |
|------|------|
| 纯云端播放 | 无变化 |
| 本机 / 回退本机 | 首句无声修复；每次本机播放入口多 **50ms** |
| EPUB 听书 / 听当前 | 本机来源逐句受益；云端来源不变 |
| 对外 API | 无签名变更 |

详见 [Influence-point 姊妹稿](../impact/TTS本地取消结算影响.md)。

### 建议回归

1. 听当前：本机来源，选 3 句，**每句均有声**。
2. 听书：本机来源章首句正常。
3. 讯飞 / MiniMax 连播：无额外 50ms 本机延迟。
4. 设置页本机试听、英语学习喇叭（本机路径）正常。
5. 播放中立即停止：settle 结束后不误播半句。

---

## 7. 相关源码路径

| 说明 | 路径 |
|------|------|
| settle 与本机 speak | `apps/frontend/src/utils/speech.ts` |
| 听当前逐句循环 | `apps/frontend/src/views/ebook/hooks/useEbookQuoteListen.ts` |
| 听书逐句循环 | `apps/frontend/src/views/ebook/hooks/useEpubChapterListen.ts` |

---

（若与仓库最新源码不一致，以源码为准）
