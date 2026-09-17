# Edge TTS 统一 stream endpoint — 实现说明

## 延伸阅读

- [云端TTS边缘语音.md](./云端TTS边缘语音.md) — Edge 选路、prosody、设置页
- [TTS桌面端云端播放影响.md](./TTS桌面端云端播放影响.md) — **历史**：曾将 Tauri+Edge 分流至非流式 `/edge/speech`；**当前源码已统一 stream**（见本篇 §4）
- [../impact/TTS边缘统一流式端点影响.md](../impact/TTS边缘统一流式端点影响.md) — 影响点与 Tauri 回归清单

## 1. 背景与目标

**背景**：`startCloudTts` 曾按 `isTauriRuntime()` 分流——Tauri 走 `SPEECH_EDGE_TTS`（Nest `StreamableFile`），Web 走 `SPEECH_EDGE_TTS_STREAM`。后端 Edge 两路由均为**整段合成后一次下发**，无真流式差异。

**目标**：Edge 与 xfyun/minimax 命名一致，**三端统一** `SPEECH_EDGE_TTS_STREAM`，简化 endpoint 维护。

**权衡**：Tauri 上 chunked 响应 + `arrayBuffer()` 读 body 曾有挂起风险（见 `TTS桌面端云端播放影响.md`）；统一 stream 后须依赖现有 Tauri `arrayBuffer` 分支，听书场景需回归。

## 2. 改动范围

- `apps/frontend/src/utils/speech.ts` — `startCloudTts` 内 Edge endpoint 选择；移除 `SPEECH_EDGE_TTS` import

未改动：`readResponseBodyAsArrayBuffer`、听书预取、`playCloudMp3Blob`、后端 `EdgeTtsService`。

## 3. 实现思路

```text
playbackSource === 'edge'
  → POST /speech-transcription/edge/speech/stream   // 全平台
  → Response { kind: 'live' }
  → playCloudTtsReady → readResponseBodyAsArrayBuffer
       Tauri: res.arrayBuffer()
       Web:   ReadableStream reader 或 arrayBuffer 回退
```

所有 `playPreferred` / `prefetchCloudTts` 调用方自动继承，无需改 hook。

## 4. 关键代码对比与注释

### 4.1 `startCloudTts` — Edge endpoint 选择

**对比范围**：`startCloudTts` 内 `endpoint` 三元表达式（含 Edge 分支）；import 列表中 Edge 常量。

**改动前** · `apps/frontend/src/utils/speech.ts`（基线，约 L9–L14、L1084–L1092）

```typescript
import {
	SPEECH_EDGE_TTS,
	SPEECH_EDGE_TTS_STREAM,
	SPEECH_MINIMAX_TTS_STREAM,
	SPEECH_XFYUN_TTS_STREAM,
} from '@/service/api';
// ...（startCloudTts 前半：缓存、token、headers、prefs 未改动）...
	const endpoint =
		source === 'xfyun'
			? SPEECH_XFYUN_TTS_STREAM
			: source === 'edge'
				? isTauriRuntime()
					? SPEECH_EDGE_TTS
					: SPEECH_EDGE_TTS_STREAM
				: SPEECH_MINIMAX_TTS_STREAM;
```

**改动后** · `apps/frontend/src/utils/speech.ts`（当前，约 L9–L13、L1084–L1089）

```typescript
import {
	SPEECH_EDGE_TTS_STREAM,
	SPEECH_MINIMAX_TTS_STREAM,
	SPEECH_XFYUN_TTS_STREAM,
} from '@/service/api';
// ...（startCloudTts 前半：缓存、token、headers、prefs 未改动）...
	const endpoint =
		source === 'xfyun'
			? SPEECH_XFYUN_TTS_STREAM
			: source === 'edge'
				? SPEECH_EDGE_TTS_STREAM
				: SPEECH_MINIMAX_TTS_STREAM;
```

**变更摘要**：删除 `SPEECH_EDGE_TTS` import 与 Tauri 分流；Edge 恒为 stream URL。xfyun/minimax 分支不变。

---

### 4.2 后端对照（未改，供理解）

**来源** · `apps/backend/src/services/speech-transcription/edge-tts.service.ts`（当前）

```typescript
// synthesizeSpeech：整段 await synthesize() 后 return Buffer
async synthesizeSpeech(dto: EdgeTtsDto, userId?: number): Promise<Buffer> { /* ... */ }

// streamSpeech：同样整段 synthesize 后 yield 一次 — 非增量流式
async *streamSpeech(dto: EdgeTtsDto, userId?: number): AsyncGenerator<Buffer> {
	// ... cache hit 则 yield cached ...
	const buffer = await this.synthesize(resolved);
	if (buffer.length) {
		this.setCache(cacheKey, buffer);
		yield buffer;
	}
}
```

客户端统一 stream 不改变合成语义，仅 HTTP 传输形态（chunked vs Content-Length）不同。

## 5. 兼容性与影响

| 场景 | 影响 |
|------|------|
| Web + Edge | **无**（改前已用 stream） |
| Tauri + Edge | **有条件变化** — 回退非流式 URL，需回归听书/试听 |
| MiniMax / 讯飞 / 本机 | **无** |
| `SPEECH_EDGE_TTS` 常量（`api.ts`） | 仍保留，后端路由未删 |

## 6. 相关源码路径

| 说明 | 路径 |
| ---- | ---- |
| 客户端选路 | `apps/frontend/src/utils/speech.ts` → `startCloudTts` |
| API 常量 | `apps/frontend/src/service/api.ts` |
| 后端合成 | `apps/backend/src/services/speech-transcription/edge-tts.service.ts` |
| 影响点 | `docs/impact/TTS边缘统一流式端点影响.md` |

---

（若与仓库最新源码不一致，以源码为准）
