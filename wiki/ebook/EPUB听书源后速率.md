# EPUB 听读 — 云端倍速在换 src 后被重置为 1×

## 延伸阅读

- [EPUB听书音频结束UI.md](./EPUB听书音频结束UI.md) — 同轮修复：音频已停但 UI 仍「播放中」（`abortCloudAudioWait`、先挂 `waitCloudAudioEnd` 再 `play`）
- [EPUB听书播放器栏.md](./EPUB听书播放器栏.md) — 播放条倍速 0.75×～3× 与 `applyActivePlaybackRate`
- [developer/EPUB听书开发.md](./developer/EPUB听书开发.md) — 听当前 + 听书总手册

**文档角色**：听书 / 听当前 **UI 倍速 2.0× 但听感仍为 1×** 的根因与修复；分析基准为工作区相对 `HEAD` 的 `apps/frontend/src/utils/speech.ts` 未提交 diff。

---

## 1. 背景与目标

### 1.1 问题（用户视角）

EPUB 听书或听当前在播放条选 **2.0×**（或其它 >1 倍速）后，云端 Edge / MiniMax MP3 **听感仍为正常语速**。本机 Web Speech 路径倍速正常；仅 **云端 Blob + `HTMLAudioElement`** 路径异常。第二句及之后更明显——首句偶发正常，连播时句间切换必现。

### 1.2 根因

浏览器在 **`HTMLAudioElement` 上改 `src` 或调用 `load()`** 后，会把 **`playbackRate` 重置为 1.0**。改前实现：

1. `playCloudMp3Blob` 每段 **`new Audio(url)`** 或复用前先 `stopPlaybackMediaOnly` **销毁** 旧元素；
2. 在 **`audio.src = url` 之前或紧后** 设置 `audio.playbackRate = clampPlaybackRate(rate)`；
3. `startCloudAudioPlayback` **不含 rate 参数**，也不在 `canplay` 之后二次写入倍速。

当改为 **复用同一 `Audio` 节点**（`ensureCloudAudioEl`）以支持 Tauri / 连续滚动目录跳转时，「先设倍速 → 再换 src/load」的顺序触发上述浏览器行为，倍速被 silently 打回 1×。

### 1.3 目标

- **`playbackRate` 必须在资源 `canplay` 之后设置**，且 Tauri 重试 `load()` 分支同样补设。
- **`playCloudMp3Blob` 复用元素**：`ensureCloudAudioEl()` + 赋值 `src`，不在换 src 前写倍速。
- **`waitCloudAudioCanPlay`** 在复用节点上确认 **`currentSrc` 已指向新 Blob**，避免旧 `readyState` 误判。

---

## 2. 改动范围

| 路径 | 变更 |
|------|------|
| `apps/frontend/src/utils/speech.ts` | `ensureCloudAudioEl`（新增）；`waitCloudAudioCanPlay`、`startCloudAudioPlayback`、`playCloudMp3Blob`、`stopPlaybackMediaOnly`（复用 Audio、canplay 后设 rate） |

听书 hook（`useEpubChapterListen` 等）**未改**；仍通过 `playPreferred` → `playCloudTtsCadenceSegments` → `playCloudMp3Blob(..., rate)` 传入倍速。

---

## 3. 实现思路

1. **时序约束（核心）**  
   `audio.src = objectUrl` → `load()`（隐式）→ 等 `canplay` → **`audio.playbackRate = clampPlaybackRate(rate)`** → `play()`。与 [MDN `HTMLMediaElement.playbackRate`](https://developer.mozilla.org/en-US/docs/Web/API/HTMLMediaElement/playbackRate) 及 Chromium 换源行为一致。

2. **复用单例 Audio**  
   `ensureCloudAudioEl()`：模块级 `cloudAudio` 为空则 `new Audio()`，否则返回同一引用。`stopPlaybackMediaOnly` **pause + 清事件 + `removeAttribute('src')` + load**，但 **`cloudAudio` 不再置 `null`**（与 prime 解锁元素分离）。

3. **`startCloudAudioPlayback` 接管 rate**  
   签名增加 `rate?`、`onPlaybackStart?`；在 `waitCloudAudioCanPlay` 之后统一写倍速，Tauri `catch` 里 `load()` 后再写一次。

4. **`playCloudMp3Blob` 不再提前写 rate**  
   删除 `audio.playbackRate = ...`；改 `const audio = ensureCloudAudioEl()`，设 `src` 后交给 `startCloudAudioPlayback(audio, rate, notifyStart)`。

5. **`waitCloudAudioCanPlay` 防 stale readyState**  
   复用节点时旧资源可能短暂 `HAVE_CURRENT_DATA`；须同时检查 `currentSrc` 非空且 `networkState !== NETWORK_EMPTY`。

6. **与 `applyActivePlaybackRate` 的关系**  
   播放中用户拖倍速仍走 `cloudAudio.playbackRate = clamped`（即时生效）；本篇修复 **每段 Blob 开播瞬间** 的初始倍速。

---

## 4. 关键代码对比与注释

### 4.1 `stopPlaybackMediaOnly`（保留 Audio 节点）

**对比范围**：全函数（改前销毁 `cloudAudio`；改后清 src/事件但保留引用）。

**改动前** · `apps/frontend/src/utils/speech.ts`（基线 `HEAD`，约 L940–L955）

```typescript
// 仅停介质、不递增 playbackGeneration（句间切换 / 预取下一段时用）
function stopPlaybackMediaOnly(): void {
	// 取消本机 Web Speech 当前 utterance
	if (isSpeechSupported()) {
		window.speechSynthesis.cancel();
	}
	// 若存在云端 Audio 实例
	if (cloudAudio) {
		// 暂停播放
		cloudAudio.pause();
		// 清空 src 字符串
		cloudAudio.src = '';
		// 触发卸载当前媒体资源
		cloudAudio.load();
		// 丢弃元素引用，下一段会 new Audio
		cloudAudio = null;
	}
	// 若存在 Blob 对象 URL
	if (cloudObjectUrl) {
		// 释放 URL 占用的内存
		URL.revokeObjectURL(cloudObjectUrl);
		// 清空模块级 URL 指针
		cloudObjectUrl = null;
	}
}
```

**改动后** · `apps/frontend/src/utils/speech.ts`（当前，约 L993–L1013）

```typescript
// 仅停介质、不递增 playbackGeneration（句间切换 / 预取下一段时用）
function stopPlaybackMediaOnly(): void {
	// 取消本机 Web Speech 当前 utterance
	if (isSpeechSupported()) {
		window.speechSynthesis.cancel();
	}
	// 打断可能挂起的 waitCloudAudioEnd（详见 audio-end-ui 专题）
	abortCloudAudioWait?.();
	// 清除 abort 回调引用
	abortCloudAudioWait = null;
	// 若存在云端 Audio 实例
	if (cloudAudio) {
		// 暂停播放
		cloudAudio.pause();
		// 清 onended，避免 stop 后 Promise 永不 settle
		cloudAudio.onended = null;
		// 清 onerror
		cloudAudio.onerror = null;
		// 清 onloadedmetadata（超时 arm 用）
		cloudAudio.onloadedmetadata = null;
		// 清 ontimeupdate（整段合成进度用）
		cloudAudio.ontimeupdate = null;
		// 移除 src 属性（比 src='' 更利于复用同一节点）
		cloudAudio.removeAttribute('src');
		// 触发卸载当前媒体资源
		cloudAudio.load();
		// ponytail: 保留元素——目录异步跳转后同一节点仍可 play；勿在 prime 里改此元素 src
	}
	// 若存在 Blob 对象 URL
	if (cloudObjectUrl) {
		// 释放 URL 占用的内存
		URL.revokeObjectURL(cloudObjectUrl);
		// 清空模块级 URL 指针
		cloudObjectUrl = null;
	}
}
```

**变更摘要**：改后 **不再 `cloudAudio = null`**，为 `ensureCloudAudioEl` 复用铺路；并清事件监听（与 UI 结束态专题交叉）。

---

### 4.2 `ensureCloudAudioEl`（纯新增）

**对比范围**：全函数（改前不存在，每段 `new Audio(url)`）。

**改动后** · `apps/frontend/src/utils/speech.ts`（当前，约 L1015–L1018）

```typescript
// 取得可复用的云端 Audio 元素（懒创建单例）
function ensureCloudAudioEl(): HTMLAudioElement {
	// 模块级尚无实例则创建空 Audio（无初始 src）
	if (!cloudAudio) cloudAudio = new Audio();
	// 返回同一 DOM 节点供后续段连续播放
	return cloudAudio;
}
```

**变更摘要**：纯新增；替代 `playCloudMp3Blob` 内 `new Audio(url)`。

---

### 4.3 `waitCloudAudioCanPlay`

**对比范围**：全函数。

**改动前** · `apps/frontend/src/utils/speech.ts`（基线 `HEAD`，约 L1273–L1293）

```typescript
// 等待 Audio 有足够数据可 play（改前仅看 readyState）
function waitCloudAudioCanPlay(audio: HTMLAudioElement): Promise<void> {
	// readyState 已达 HAVE_CURRENT_DATA 则立即 resolve
	if (audio.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
		return Promise.resolve();
	}
	// 否则监听 canplay / error
	return new Promise((resolve, reject) => {
		// canplay 时 resolve
		const onReady = () => {
			cleanup();
			resolve();
		};
		// error 时 reject
		const onError = () => {
			cleanup();
			reject(new Error('AUDIO_LOAD'));
		};
		// 移除两个监听器
		const cleanup = () => {
			audio.removeEventListener('canplay', onReady);
			audio.removeEventListener('error', onError);
		};
		// 单次 canplay
		audio.addEventListener('canplay', onReady, { once: true });
		// 单次 error
		audio.addEventListener('error', onError, { once: true });
	});
}
```

**改动后** · `apps/frontend/src/utils/speech.ts`（当前，约 L1539–L1566）

```typescript
// 等待 Audio 有足够数据可 play；复用节点须确认 currentSrc 已指向新资源
function waitCloudAudioCanPlay(audio: HTMLAudioElement): Promise<void> {
	// ponytail: 复用 Audio 换 src 后旧 readyState 可能短暂残留，须确认 currentSrc 已指向新资源
	return new Promise((resolve, reject) => {
		// 防止 finish 重复调用
		let settled = false;
		// 统一结束入口
		const finish = (ok: boolean) => {
			if (settled) return;
			settled = true;
			cleanup();
			if (ok) resolve();
			else reject(new Error('AUDIO_LOAD'));
		};
		// canplay 回调
		const onReady = () => finish(true);
		// error 回调
		const onError = () => finish(false);
		// 移除监听器
		const cleanup = () => {
			audio.removeEventListener('canplay', onReady);
			audio.removeEventListener('error', onError);
		};
		// 注册 canplay（once 语义由 finish/settled 保证）
		audio.addEventListener('canplay', onReady, { once: true });
		// 注册 error
		audio.addEventListener('error', onError, { once: true });
		// 同步快路径：已有 currentSrc、网络非空、且 readyState 足够
		if (
			audio.currentSrc &&
			audio.networkState !== HTMLMediaElement.NETWORK_EMPTY &&
			audio.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA
		) {
			finish(true);
		}
	});
}
```

**变更摘要**：快路径增加 **`currentSrc` + `networkState`** 校验，避免复用节点误判旧资源已可播。

---

### 4.4 `startCloudAudioPlayback`

**对比范围**：全函数。

**改动前** · `apps/frontend/src/utils/speech.ts`（基线 `HEAD`，约 L1295–L1305）

```typescript
// 在 canplay 后调用 play()；改前不设 playbackRate
async function startCloudAudioPlayback(audio: HTMLAudioElement): Promise<void> {
	// 等到可播
	await waitCloudAudioCanPlay(audio);
	try {
		// 正常 play
		await audio.play();
	} catch (err) {
		// 非 Tauri 直接抛出
		if (!isTauriRuntime()) throw err;
		// Tauri：重 load 后再 play
		audio.load();
		await waitCloudAudioCanPlay(audio);
		await audio.play();
	}
}
```

**改动后** · `apps/frontend/src/utils/speech.ts`（当前，约 L1568–L1587）

```typescript
// 在 canplay 后设倍速并 play；rate 必须在 src 就绪后写入
async function startCloudAudioPlayback(
	audio: HTMLAudioElement,
	rate?: number,
	onPlaybackStart?: () => void,
): Promise<void> {
	// 等到新 src 可播
	await waitCloudAudioCanPlay(audio);
	// 必须在 src 就绪后设 playbackRate：改 src / load 会把倍速打回 1
	audio.playbackRate = clampPlaybackRate(rate);
	try {
		// 开始出声
		await audio.play();
		// 通知外层「已开始播放」（驱动 UI playing）
		onPlaybackStart?.();
	} catch (err) {
		// 非 Tauri 直接抛出
		if (!isTauriRuntime()) throw err;
		// Tauri WebView：重 load
		audio.load();
		// 再次等 canplay
		await waitCloudAudioCanPlay(audio);
		// load 后倍速会再次被打回 1，须重写
		audio.playbackRate = clampPlaybackRate(rate);
		// 重试 play
		await audio.play();
		// 重试成功同样通知 start
		onPlaybackStart?.();
	}
}
```

**变更摘要**：**`playbackRate` 移到 `waitCloudAudioCanPlay` 之后**；新增 `rate`、`onPlaybackStart` 参数；Tauri 分支 **二次设 rate**。

---

### 4.5 `playCloudMp3Blob`（倍速相关差异）

**对比范围**：全函数（本篇仅强调 rate / 元素复用；`waitCloudAudioEnd` 顺序见姊妹篇）。

**改动前** · `apps/frontend/src/utils/speech.ts`（基线 `HEAD`，约 L1307–L1339）

```typescript
// 播放一段云端 MP3 Blob
function playCloudMp3Blob(
	blob: Blob,
	generation: number,
	rate?: number,
): Promise<void> {
	// 停上一轮介质
	stopPlaybackMediaOnly();
	// 世代已失效则空 resolve
	if (!isPlaybackGenerationActive(generation)) {
		return Promise.resolve();
	}

	// 为 Blob 创建 object URL
	const url = URL.createObjectURL(blob);
	// 记录待 revoke 的 URL
	cloudObjectUrl = url;
	// 每段新建 Audio 并自带 src
	const audio = new Audio(url);
	// 在构造函数等价时机设倍速——换 src 时会被浏览器重置（复用后必 bug）
	audio.playbackRate = clampPlaybackRate(rate);
	// 登记模块级引用
	cloudAudio = audio;
	// play 成功后再挂 waitCloudAudioEnd
	return startCloudAudioPlayback(audio).then(
		() => waitCloudAudioEnd(audio, url, generation),
		(err) => {
			// 世代失效：清理 URL 并吞错
			if (!isPlaybackGenerationActive(generation)) {
				if (cloudObjectUrl === url) {
					URL.revokeObjectURL(url);
					cloudObjectUrl = null;
					cloudAudio = null;
				}
				return Promise.resolve();
			}
			// 世代仍有效：清理并向上抛
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

**改动后** · `apps/frontend/src/utils/speech.ts`（当前，约 L1589–L1636）

```typescript
// 播放一段云端 MP3 Blob
function playCloudMp3Blob(
	blob: Blob,
	generation: number,
	rate?: number,
	onTimeUpdate?: (currentTime: number, duration: number) => void,
	onPlaybackStart?: () => void,
): Promise<void> {
	// 停上一轮介质（保留 Audio 节点）
	stopPlaybackMediaOnly();
	// 世代已失效则空 resolve
	if (!isPlaybackGenerationActive(generation)) {
		return Promise.resolve();
	}

	// 为 Blob 创建 object URL
	const url = URL.createObjectURL(blob);
	// 记录待 revoke 的 URL
	cloudObjectUrl = url;
	// 复用模块级 Audio，不在此 new
	const audio = ensureCloudAudioEl();
	// 恢复音量（stop 未改 volume，显式兜底）
	audio.volume = 1;
	// 绑定新 Blob URL——此后须 canplay 后再设 playbackRate
	audio.src = url;
	// 可选：整段合成时用 currentTime 驱动句级 cadence
	if (onTimeUpdate) {
		audio.ontimeupdate = () => {
			if (!isPlaybackGenerationActive(generation)) return;
			onTimeUpdate(audio.currentTime, audio.duration);
		};
	}

	// 先挂 onended（UI 专题）；倍速由 startCloudAudioPlayback 在 canplay 后设置
	const ended = waitCloudAudioEnd(audio, url, generation);
	// 防止 onPlaybackStart 重复触发
	let startNotified = false;
	// 包装回调，只通知一次
	const notifyStart = () => {
		if (startNotified) return;
		startNotified = true;
		onPlaybackStart?.();
	};
	// canplay → 设 rate → play → 再等 ended
	return startCloudAudioPlayback(audio, rate, notifyStart).then(
		() => ended,
		(err) => {
			abortCloudAudioWait?.();
			abortCloudAudioWait = null;
			if (cloudObjectUrl === url) {
				URL.revokeObjectURL(url);
				cloudObjectUrl = null;
			}
			if (!isPlaybackGenerationActive(generation)) {
				return Promise.resolve();
			}
			throw err;
		},
	);
}
```

**变更摘要**：**删除** `audio.playbackRate = clampPlaybackRate(rate)`；**`ensureCloudAudioEl` + 后赋 `src`**；倍速改由 **`startCloudAudioPlayback(audio, rate, …)`** 在 canplay 后写入。

---

## 5. 行为变化与回归

| 场景 | 改前 | 改后 |
|------|------|------|
| 听书 2× 连播多句 | 听感 1× | 听感 2× |
| 播放中拖倍速 | `applyActivePlaybackRate` 即时 | 不变 |
| 本机 Web Speech | 不受影响 | 不变 |
| Tauri 云端首 play 失败重试 | 无 rate 重设 | load 后 **重写 rate** |

**建议回归**：播放条 0.5× / 1× / 2× / 3×；听书连播 ≥5 句；听当前单句；Tauri 桌面 Edge 云端；播放中切换倍速。

---

## 6. 相关源码路径

| 说明 | 路径 |
|------|------|
| 云端播放与倍速 | `apps/frontend/src/utils/speech.ts` |
| 播放条倍速 UI | `apps/frontend/src/views/ebook/components/...`（经 hook 传 `rate`） |
| 英文 TTS 端到端 | `docs/english/TTS端到端指南.md` |

---

若与仓库最新源码不一致，以源码为准。
