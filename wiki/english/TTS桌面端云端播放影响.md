# Tauri 云端 MP3 播放修复 — 实现说明

**文档角色**：修复线上 Tauri 桌面「云端朗读 UI 显示播放中但无声、暂停再播才恢复」及 Edge 读 body 挂起。影响面见 [../impact/TTS桌面端云端播放影响.md](../impact/TTS桌面端云端播放影响.md)。Edge 接入与 prosody 见 [云端TTS边缘语音.md](./云端TTS边缘语音.md)；HttpClient 网络重试（TTS POST 少误报）见 [../tauri/Tauri HTTP全方法重试.md](../tauri/Tauri HTTP全方法重试.md)。

## 1. 背景与目标

### 1.1 用户视角

**Tauri + WKWebView** 下，用户点击喇叭/听书/Edge 试听后：

- 云端合成需数秒；若在 **fetch 返回之后** 才首次调用 `Audio.play()`，易触发 autoplay 策略，表现为 **播放条在动但无声**，用户 **暂停再播** 或 **再次点击** 才恢复。
- Tauri HTTP 对 **chunked stream** 读 body 易挂起；Edge 线上返回整段 MP3，应用 stream reader 不稳定。
- Edge 在 Tauri 走 **非流式** `/edge/speech` 更稳；Web 仍用 `/edge/speech/stream`。

### 1.2 本轮目标

| 层级 | 目标 |
|------|------|
| 手势解锁 | `playPreferred` 入口同步 `primePlaybackForUserGesture()`；prime 增加静音 `Audio.play()` |
| 读 body | Tauri 下 `readResponseBodyAsArrayBuffer` 直接用 `res.arrayBuffer()` |
| Edge endpoint | Tauri + Edge → `SPEECH_EDGE_TTS`；Web → `SPEECH_EDGE_TTS_STREAM` |
| 播放 | `waitCloudAudioCanPlay` + `startCloudAudioPlayback`（`canplay` 后再 `play()`；Tauri 失败 `load()` 重试） |

## 2. 改动范围

| 说明 | 路径 |
|------|------|
| 播放与选路 | `apps/frontend/src/utils/speech.ts` |
| Edge 非流式 API 常量 | `apps/frontend/src/service/api.ts` → `SPEECH_EDGE_TTS` |

## 3. 实现思路

1. **在用户点击栈内 prime**：`playPreferred` 在 `beginPlaybackSession` 之前调用 `primePlaybackForUserGesture()`，覆盖 Edge 合成耗时场景（听书 hook 内 prime 仍保留，重复调用无害）。
2. **双通道解锁**：保留 `speechSynthesis` 静音 utterance；新增模块级 `cloudAudioUnlock` 播放极短静音 WAV data URI，解锁 **HTMLAudioElement**  autoplay。
3. **Tauri 读 body**：跳过 `getReader()` 循环，避免 chunked 挂起；Web 仍用 stream reader 合并 chunks（大响应内存友好）。
4. **Edge 分流**：`isTauriRuntime()` 选非流式 endpoint；MiniMax/讯飞仍用 stream URL。
5. **`canplay` 门闩**：`playCloudMp3Blob` 不再直接 `audio.play()`，经 `startCloudAudioPlayback` 等待 `HAVE_CURRENT_DATA`；Tauri 首次 `play()` reject 时 `load()` 后再试。

## 4. 关键代码对比与注释

### 4.1 `readResponseBodyAsArrayBuffer`（`apps/frontend/src/utils/speech.ts`）

**对比范围**：函数全定义。

**改动前** · `apps/frontend/src/utils/speech.ts`（基线，约 L995–L1013）

```typescript
// 从 fetch Response 读取 MP3 二进制（Web 优先 stream reader）
async function readResponseBodyAsArrayBuffer(
	res: Response,
): Promise<ArrayBuffer> {
	// 尝试流式 reader
	const reader = res.body?.getReader();
	// 无 reader 时回退一次性 arrayBuffer
	if (!reader) {
		return res.arrayBuffer();
	}
	// 累积 chunk
	const parts: Uint8Array[] = [];
	while (true) {
		const { done, value } = await reader.read();
		if (done) break;
		if (value?.length) parts.push(value);
	}
	return mergeUint8Arrays(parts);
}
```

**改动后** · `apps/frontend/src/utils/speech.ts`（当前，约 L995–L1013）

```typescript
// 从 fetch Response 读取 MP3 二进制（Tauri 直读 arrayBuffer）
async function readResponseBodyAsArrayBuffer(
	res: Response,
): Promise<ArrayBuffer> {
	// Tauri HTTP 对 chunked stream 读 body 易挂起；Edge 线上一整段 MP3，直接 arrayBuffer 更稳
	if (isTauriRuntime()) {
		return res.arrayBuffer();
	}
	// Web：尝试流式 reader
	const reader = res.body?.getReader();
	// 无 reader 时回退一次性 arrayBuffer
	if (!reader) {
		return res.arrayBuffer();
	}
	// 累积 chunk
	const parts: Uint8Array[] = [];
	while (true) {
		const { done, value } = await reader.read();
		if (done) break;
		if (value?.length) parts.push(value);
	}
	return mergeUint8Arrays(parts);
}
```

**变更摘要**：Tauri 短路为 `arrayBuffer()`；Web 路径不变。

### 4.2 `startCloudTts` Edge endpoint 选路（`apps/frontend/src/utils/speech.ts`）

**对比范围**：`startCloudTts` 内 `endpoint` 三元表达式（前后 `cacheKey`、headers、`platformFetch` 等未改，对称省略）。

**改动前** · `apps/frontend/src/utils/speech.ts`（基线，约 L1083–L1092）

```typescript
	// ...（未改动：prefs、source、headers）

	const endpoint =
		source === 'xfyun'
			? SPEECH_XFYUN_TTS_STREAM
			: source === 'edge'
				? SPEECH_EDGE_TTS_STREAM
				: SPEECH_MINIMAX_TTS_STREAM;

	// ...（未改动：bodyExtras、platformFetch POST）
```

**改动后** · `apps/frontend/src/utils/speech.ts`（当前，约 L1083–L1092）

```typescript
	// ...（未改动：prefs、source、headers）

	const endpoint =
		source === 'xfyun'
			? SPEECH_XFYUN_TTS_STREAM
			: source === 'edge'
				? isTauriRuntime()
					? SPEECH_EDGE_TTS
					: SPEECH_EDGE_TTS_STREAM
				: SPEECH_MINIMAX_TTS_STREAM;

	// ...（未改动：bodyExtras、platformFetch POST）
```

**变更摘要**：Tauri + Edge 走 `POST /speech-transcription/edge/speech`；Web Edge 仍走 stream。

**改动后新增常量** · `apps/frontend/src/service/api.ts`（纯新增）

```typescript
// Microsoft Edge 在线语音合成非流式 endpoint
export const SPEECH_EDGE_TTS = '/speech-transcription/edge/speech';
```

### 4.3 `waitCloudAudioCanPlay` 与 `startCloudAudioPlayback`（纯新增）

**对比范围**：两个新函数（改动前不存在，见 `code-before-after.md` §4 纯新增）。

**改动后** · `apps/frontend/src/utils/speech.ts`（当前，约 L1276–L1308）

```typescript
// 等待 Audio 至少有当前帧数据可播
function waitCloudAudioCanPlay(audio: HTMLAudioElement): Promise<void> {
	// 已就绪则立即 resolve
	if (audio.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
		return Promise.resolve();
	}
	// 否则监听 canplay / error
	return new Promise((resolve, reject) => {
		// canplay 回调：清理监听并 resolve
		const onReady = () => {
			cleanup();
			resolve();
		};
		// error 回调：清理监听并 reject
		const onError = () => {
			cleanup();
			reject(new Error('AUDIO_LOAD'));
		};
		// 移除两个监听器
		const cleanup = () => {
			audio.removeEventListener('canplay', onReady);
			audio.removeEventListener('error', onError);
		};
		// 注册 canplay（once）
		audio.addEventListener('canplay', onReady, { once: true });
		// 注册 error（once）
		audio.addEventListener('error', onError, { once: true });
	});
}

// canplay 后再 play；Tauri 首次 play 失败则 load 重试
async function startCloudAudioPlayback(audio: HTMLAudioElement): Promise<void> {
	// 等待媒体可播
	await waitCloudAudioCanPlay(audio);
	try {
		// 首次 play
		await audio.play();
	} catch (err) {
		// 非 Tauri 直接抛出
		if (!isTauriRuntime()) throw err;
		// Tauri：load 后再次 canplay + play
		audio.load();
		await waitCloudAudioCanPlay(audio);
		await audio.play();
	}
}
```

### 4.4 `playCloudMp3Blob`（`apps/frontend/src/utils/speech.ts`）

**对比范围**：函数全定义（播放入口改为 `startCloudAudioPlayback`）。

**改动前** · `apps/frontend/src/utils/speech.ts`（基线，约 L1264–L1294）

```typescript
// 播放云端 MP3 Blob，绑定世代与倍速
function playCloudMp3Blob(
	blob: Blob,
	generation: number,
	rate?: number,
): Promise<void> {
	// 停掉上一段媒体
	stopPlaybackMediaOnly();
	// 世代已失效则 no-op
	if (!isPlaybackGenerationActive(generation)) {
		return Promise.resolve();
	}

	// 创建 object URL
	const url = URL.createObjectURL(blob);
	cloudObjectUrl = url;
	// 新建 Audio 元素
	const audio = new Audio(url);
	// 应用倍速
	audio.playbackRate = clampPlaybackRate(rate);
	cloudAudio = audio;
	// 旧版：直接 play，Tauri 易无声挂起
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

**改动后** · `apps/frontend/src/utils/speech.ts`（当前，约 L1310–L1344）

```typescript
// 播放云端 MP3 Blob，绑定世代与倍速
function playCloudMp3Blob(
	blob: Blob,
	generation: number,
	rate?: number,
): Promise<void> {
	// 停掉上一段媒体
	stopPlaybackMediaOnly();
	// 世代已失效则 no-op
	if (!isPlaybackGenerationActive(generation)) {
		return Promise.resolve();
	}

	// 创建 object URL
	const url = URL.createObjectURL(blob);
	cloudObjectUrl = url;
	// 新建 Audio 元素
	const audio = new Audio(url);
	// 应用倍速
	audio.playbackRate = clampPlaybackRate(rate);
	cloudAudio = audio;
	// 新版：canplay 门闩后再 play
	return startCloudAudioPlayback(audio).then(
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

**变更摘要**：`audio.play()` → `startCloudAudioPlayback(audio)`；错误清理逻辑不变。

### 4.5 `playPreferred` 入口 prime（`apps/frontend/src/utils/speech.ts`）

**对比范围**：函数开头至 `beginPlaybackSession`（后续选路未改，对称省略）。

**改动前** · `apps/frontend/src/utils/speech.ts`（基线，约 L1435–L1442）

```typescript
	// 去除 markdown 语法，获得纯文本
	const plain = stripMarkdownForTts(rawText);
	// 空文本直接返回，不进行朗读
	if (!plain) return;

	// 启动新的播放世代/session
	const generation = beginPlaybackSession();
```

**改动后** · `apps/frontend/src/utils/speech.ts`（当前，约 L1479–L1488）

```typescript
	// 去除 markdown 语法，获得纯文本
	const plain = stripMarkdownForTts(rawText);
	// 空文本直接返回，不进行朗读
	if (!plain) return;

	// 仍在用户点击栈内：解锁 speech + Audio（线上 Edge 合成数秒，Tauri 须在此 prime）
	primePlaybackForUserGesture();

	// 启动新的播放世代/session
	const generation = beginPlaybackSession();
```

**变更摘要**：在 async 分支之前同步 prime，保证 Tauri autoplay 解锁仍在用户手势内。

### 4.6 `primePlaybackForUserGesture`（`apps/frontend/src/utils/speech.ts`）

**对比范围**：函数全定义 + 模块级静音 Audio 常量（新增）。

**改动前** · `apps/frontend/src/utils/speech.ts`（基线，约 L1505–L1517）

```typescript
// 须在用户点击同步调用，降低后续 async TTS / Audio 被 autoplay 策略拦截的概率
export function primePlaybackForUserGesture(): void {
	// SSR 安全
	if (typeof window === 'undefined') return;
	// 预热本机音色列表
	warmupSpeechVoices();
	try {
		// 恢复可能被 pause 的 speechSynthesis
		window.speechSynthesis?.resume();
		// 零宽字符静音 utterance 解锁 speech
		const unlock = new SpeechSynthesisUtterance('\u200b');
		unlock.volume = 0;
		unlock.rate = 10;
		window.speechSynthesis?.speak(unlock);
	} catch {
		// 部分环境无 speechSynthesis
	}
}
```

**改动后** · `apps/frontend/src/utils/speech.ts`（当前，模块常量约 L836–L838；函数约 L1555–L1575）

```typescript
// 模块级：复用同一静音 Audio 元素做 autoplay 解锁
let cloudAudioUnlock: HTMLAudioElement | null = null;
// 极短静音 WAV 的 data URI
const SILENT_WAV_DATA_URI =
	'data:audio/wav;base64,UklGRigAAABXQVZFZm10IBIAAAABAAEARKwAAIhYAQACABAAAABkYXRhAgAAAAEA';

// 须在用户点击同步调用，降低后续 async TTS / Audio 被 autoplay 策略拦截的概率
export function primePlaybackForUserGesture(): void {
	// SSR 安全
	if (typeof window === 'undefined') return;
	// 预热本机音色列表
	warmupSpeechVoices();
	try {
		// 恢复可能被 pause 的 speechSynthesis
		window.speechSynthesis?.resume();
		// 零宽字符静音 utterance 解锁 speech
		const unlock = new SpeechSynthesisUtterance('\u200b');
		unlock.volume = 0;
		unlock.rate = 10;
		window.speechSynthesis?.speak(unlock);
	} catch {
		// 部分环境无 speechSynthesis
	}
	// 原先只解锁 speechSynthesis；云端 MP3 走 Audio，Tauri 异步 fetch 后 play() 会挂起直至再次点击
	try {
		// 懒创建静音 Audio
		if (!cloudAudioUnlock) {
			cloudAudioUnlock = new Audio(SILENT_WAV_DATA_URI);
		}
		// 几乎静音
		cloudAudioUnlock.volume = 0.001;
		// 从头播放
		cloudAudioUnlock.currentTime = 0;
		// 同步 play 解锁（失败忽略）
		void cloudAudioUnlock.play().catch(() => {});
	} catch {
		// 部分 WebView 无 Audio
	}
}
```

**变更摘要**：新增 HTMLAudioElement 解锁路径；speechSynthesis 逻辑保留。

## 5. 兼容性与影响

| 场景 | 变化 |
|------|------|
| Web 浏览器云端 | 低：多同步 prime + `canplay` 等待；Edge 仍 stream |
| Tauri MiniMax/讯飞 | 低：共享 body 读取与 `startCloudAudioPlayback` |
| Tauri Edge | 有条件：非流式 endpoint + 上述播放修复 |
| 本机 Web Speech | 无（prime 对本机无害） |
| 缓存 key / 世代 | 无 |

## 6. 相关源码路径

| 说明 | 路径 |
|------|------|
| 朗读主模块 | `apps/frontend/src/utils/speech.ts` |
| API 常量 | `apps/frontend/src/service/api.ts` |
| 影响面 | `docs/impact/TTS桌面端云端播放影响.md` |
| Edge 全功能 | `docs/english/云端TTS边缘语音.md` |

---

（若与仓库最新源码不一致，以源码为准）
