# 云端长文：句读分段与播段预取（详细实现）

> **文档角色（深度专题）**：单独展开「句读切分 → 分段请求 → **播当前段时预取下一段**」的时序、状态与完整源码；总览与 MSE 取舍见 [云端TTS分段管线.md](./云端TTS分段管线.md)。
>
> **延伸阅读**：[英语TTS播放.md](./英语TTS播放.md)（`playbackGeneration`）、[英语TTS缓存一致性.md](./英语TTS缓存一致性.md)（段级 LRU）、[MiniMax云端TTS.md](./MiniMax云端TTS.md)（后端流式）、[../ebook/EPUB引用听书.md](../ebook/EPUB引用听书.md)（电子书入口）。

---

## 1. 要解决什么问题

**用户视角**：会员开启云端朗读后，朗读 **500～2000 字书摘** 或 **长经典句** 时，原先须等 **整篇合成 + 整段 MP3 下载完** 才出声；本机朗读早已按句读分段，云端未对齐。

**技术视角**：`playPreferred` 云端分支曾等价于：

```
stripMarkdown → fetchCloudTtsBlob(全文) → readResponseBodyAsArrayBuffer(全文) → playCloudMp3Blob
```

首声延迟 ≈ **上游合成全文耗时 + 网络收齐全文耗时**。

**本专题目标**：在 **不改调用方、不改后端** 的前提下，让云端路径与本机路径共享 **`splitTextForTtsCadence`**，并以 **`pendingReady` 流水线** 在播放段 *i* 时并行发起段 *i+1* 的 HTTP。

---

## 2. 改动范围（本专题涉及符号）

| 符号 | 文件 | 角色 |
|------|------|------|
| `splitTextForTtsCadence` | `speech.ts` | 句读切分（**未改**，云端与本机共用） |
| `MAX_SINGLE_CLOUD_TTS_CHARS` | 同文件 | 短句单次请求阈值 |
| `CloudTtsReady` / `startCloudTts` | 同文件 | 发起请求，延迟读 body |
| `playCloudTtsReady` | 同文件 | 收齐单段 MP3 并播放 |
| `playCloudTtsCadenceSegments` | 同文件 | **分段 + 预取核心循环** |
| `playPreferred` | 同文件 | 云端入口改为调用 `playCloudTtsCadenceSegments` |

---

## 3. 实现思路（分步）

### 3.1 句读分段：`splitTextForTtsCadence`

**三层切分**（与本机 `speakTextWithGeneration` 相同）：

1. **句末**：`(?<=[.!?。！？])\s*` 拆句；
2. **子句**：`(?<=[,;，；：:])\s+` 拆逗号/分号层；
3. **硬切**：单块超过 `MAX_UTTERANCE_CHARS`（120）时 `splitLongText` 再切（中文按字、英文尽量在空格处）。

每块附带 `pauseAfterMs`：子句间 `PAUSE_AFTER_CLAUSE_MS`（280ms）、句间 `PAUSE_AFTER_SENTENCE_MS`（320ms）、末块 0。

**无标点短段**：总长 &lt; 120 且无句读标点 → 单块 `pauseAfterMs: 0`（整段一次请求）。

**示例**（200 字纯中文、无标点）→ `splitLongText` 每 120 字一块 → **2 段**，走多段流水线。

### 3.2 短句快路径

当 `chunks.length === 1` 且 `chunks[0].text.length <= MAX_SINGLE_CLOUD_TTS_CHARS`（120）：

- 只调用一次 `startCloudTts` → `playCloudTtsReady`；
- **不进入** `for` 预取循环，与改前单次 `fetchCloudTtsBlob` 行为一致。

### 3.3 长文流水线：`pendingReady`

对 `chunks.length > 1` 或单段 &gt; 120 字：

```
pendingReady = startCloudTts(chunks[0])   // 立即发起第 0 段 HTTP

for i = 0 .. n-1:
  (i>0) pauseMs(chunks[i-1].pauseAfterMs)
  ready = await pendingReady              // 等第 i 段请求就绪（可能已在飞）
  pendingReady = startCloudTts(chunks[i+1]) // 与下面播放并行：发起下一段 HTTP
  await playCloudTtsReady(ready)          // 收 body + 播放第 i 段（阻塞至 onended）
```

**关键**：`startCloudTts` **只发起 HTTP、返回 Response**，不在此处 `readResponseBodyAsArrayBuffer`；读 body 在 `playCloudTtsReady` 内、且发生在 **已 assign 下一段 `pendingReady` 之后** 的 `await playCloudTtsReady` 期间，从而与下一段 **网络 + 上游合成** 重叠。

### 3.4 `CloudTtsReady` 为何区分 cached / live

| `kind` | 含义 | 预取时 |
|--------|------|--------|
| `cached` | LRU 命中，已有 Blob | `startCloudTts` 同步返回，无 HTTP |
| `live` | 已 `fetch` 成功，body 未读 | 预取仅占用连接；读 body 在播放该段时 |

缓存 key 仍为 `段文本 + buildMinimaxTtsCacheKeySuffix()`，重复听同一段跳过 HTTP。

### 3.5 与本机分段循环的对照

| 步骤 | 本机 `speakTextWithGeneration` | 云端 `playCloudTtsCadenceSegments` |
|------|--------------------------------------|-------------------------------------|
| 切分 | `splitTextForTtsCadence` | 同左 |
| 段间停顿 | `pauseMs(prevPause)` | 同左 |
| 播段 | `speakOneUtterance`（同步发起，浏览器异步播） | `playCloudTtsReady`（await 至音频结束） |
| 预取 | 无（本机合成快） | `startCloudTts` 下一段与当前段播放并行 |

### 3.6 时序图（三段长文）

```mermaid
sequenceDiagram
  participant Loop as playCloudTtsCadenceSegments
  participant S as startCloudTts
  participant R as playCloudTtsReady
  participant Net as MiniMax/硅基

  Loop->>S: start(chunks[0])
  S->>Net: POST text=chunk0
  loop i=0
    Loop->>Loop: await pendingReady (chunk0)
    Loop->>S: start(chunks[1]) 并行
    S->>Net: POST text=chunk1
    Loop->>R: playCloudTtsReady(chunk0)
    R->>R: read body + play MP3
    R-->>Loop: onended
    Loop->>Loop: pauseMs
  end
  loop i=1
    Loop->>Loop: await pendingReady (chunk1)
    Loop->>S: start(chunks[2]) 并行
    Loop->>R: playCloudTtsReady(chunk1)
    ...
  end
```

### 3.7 播放世代与停止

每一步 `await` 前后检查 `isPlaybackGenerationActive(generation)`。用户点「停止」→ `stopAllPlayback` 递增 `playbackGeneration` → 循环 `return`，已发起的 HTTP 结果在 `playCloudTtsReady` 入口丢弃。

---

## 4. 关键代码与逐行注释

### 4.1 类型与阈值常量

**改动后** · `apps/frontend/src/utils/speech.ts`（当前，约 L24–L26、L51–L61）

```typescript
// 云端 TTS 就绪态：缓存命中或 live Response 尚未读 body
type CloudTtsReady =
	| { kind: 'cached'; blob: Blob; cacheKey: string }
	| { kind: 'live'; response: Response; cacheKey: string };

// 分段结果：朗读文本 + 该段播完后的停顿毫秒
type TtsCadenceChunk = { text: string; pauseAfterMs: number };

// 句末停顿（毫秒）
const PAUSE_AFTER_SENTENCE_MS = 320;
// 子句停顿（毫秒）
const PAUSE_AFTER_CLAUSE_MS = 280;
// 本机单段最大字符，过长 Web Speech 易失败
const MAX_UTTERANCE_CHARS = 120;
// 云端短句阈值：单段且 ≤120 字时不走多段预取循环
const MAX_SINGLE_CLOUD_TTS_CHARS = MAX_UTTERANCE_CHARS;
```

**说明**：`CloudTtsReady` 为新增；`MAX_SINGLE_CLOUD_TTS_CHARS` 为新增；停顿常量本专题未改逻辑，数值可能与早期文档不同，以源码为准。

---

### 4.2 `splitTextForTtsCadence`（云端与本机共用，函数体未改）

**对比范围**：完整函数；云端流水线 **直接调用** 此函数，不再单独实现切分。

**改动后** · `apps/frontend/src/utils/speech.ts`（当前，约 L97–L148）

```typescript
// 按中英句读标点分层切分，并计算段后停顿
function splitTextForTtsCadence(text: string): TtsCadenceChunk[] {
	// 去掉首尾空白
	const trimmed = text.trim();
	// 空文本无段
	if (!trimmed) return [];

	// 是否含英文句末标点
	const hasEnSentence = /[.!?]/.test(trimmed);
	// 是否含中文句末标点
	const hasCnSentence = /[。！？]/.test(trimmed);
	// 是否含子句标点（逗号、分号、冒号等）
	const hasClause = /[,;，；：:]/.test(trimmed);

	// 无句读且较短：整段一块、无停顿
	if (
		!hasEnSentence &&
		!hasCnSentence &&
		!hasClause &&
		trimmed.length < MAX_UTTERANCE_CHARS
	) {
		return [{ text: trimmed, pauseAfterMs: 0 }];
	}

	// 按句末标点拆句（保留标点在段末）
	const sentences = trimmed
		.split(/(?<=[.!?。！？])\s*/)
		.map((s) => s.trim())
		.filter(Boolean);
	// 若拆不出句则整段当作一句
	const sentenceParts = sentences.length > 0 ? sentences : [trimmed];

	// 累积输出段
	const chunks: TtsCadenceChunk[] = [];
	// 遍历每个句子
	for (let si = 0; si < sentenceParts.length; si += 1) {
		// 当前句文本
		const sent = sentenceParts[si];
		// 句内按子句标点再拆
		const clauses = sent
			.split(/(?<=[,;，；：:])\s+/)
			.map((s) => s.trim())
			.filter(Boolean);
		// 无子句则整句为一 part
		const parts = clauses.length > 0 ? clauses : [sent];
		// 遍历子句
		for (let ci = 0; ci < parts.length; ci += 1) {
			// 子句过长再硬切为 ≤120 字
			const subChunks = splitLongText(parts[ci], MAX_UTTERANCE_CHARS);
			// 遍历硬切后的子块
			for (let sub = 0; sub < subChunks.length; sub += 1) {
				// 是否当前子句的最后一块
				const lastClause = ci === parts.length - 1;
				// 是否当前句的最后子句
				const lastSentence = si === sentenceParts.length - 1;
				// 是否硬切的最后一块
				const lastSub = sub === subChunks.length - 1;
				// 压入一段：文本 + 段后停顿
				chunks.push({
					text: subChunks[sub],
					pauseAfterMs: !lastSub
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
	// 兜底：至少返回一段
	return chunks.length > 0 ? chunks : [{ text: trimmed, pauseAfterMs: 0 }];
}
```

---

### 4.3 `startCloudTts`（替代整段 `fetchCloudTtsBlob` 的请求半部）

**对比范围**：基线 `fetchCloudTtsBlob` 全函数 vs 当前 `startCloudTts`；**读 body 与返回 Blob 已移除**，延后到 `playCloudTtsReady`。

**改动前** · `apps/frontend/src/utils/speech.ts`（基线，约 L579–L621）

```typescript
// 旧版：请求 + 收齐 body + 缓存 + 返回 Blob（一站式）
async function fetchCloudTtsBlob(plain: string): Promise<Blob> {
	await ensureMinimaxTtsUserPrefsLoaded();
	const cacheKey = plain + buildMinimaxTtsCacheKeySuffix();
	const cached = getCloudTtsFromCache(plain);
	if (cached) {
		return cached;
	}

	const token = readToken();
	if (!token) {
		throw new Error('NO_TOKEN');
	}
	const platformFetch = await getPlatformFetch();
	const headers = {
		Authorization: `Bearer ${token}`,
		'Content-Type': 'application/json',
	};

	let res = await platformFetch(BASE_URL + SPEECH_MINIMAX_TTS_STREAM, {
		method: 'POST',
		headers,
		body: JSON.stringify({ text: plain, ...buildMinimaxTtsRequestExtras() }),
	});

	if (res.status === 503 || res.status === 401 || res.status === 502) {
		res = await platformFetch(BASE_URL + SPEECH_TTS, {
			method: 'POST',
			headers,
			body: JSON.stringify({ text: plain }),
		});
	}

	if (!res.ok) {
		throw new Error(`TTS_HTTP_${res.status}`);
	}

	const buf = await readResponseBodyAsArrayBuffer(res);
	touchCloudTtsCache(cacheKey, buf);
	return new Blob([buf], { type: 'audio/mpeg' });
}
```

**改动后** · `apps/frontend/src/utils/speech.ts`（当前，约 L592–L629）

```typescript
// 发起云端 TTS；命中 LRU 则直接 Blob，否则返回未读 body 的 Response
async function startCloudTts(plain: string): Promise<CloudTtsReady> {
	await ensureMinimaxTtsUserPrefsLoaded();
	const cacheKey = plain + buildMinimaxTtsCacheKeySuffix();
	const cached = getCloudTtsFromCache(plain);
	if (cached) {
		return { kind: 'cached', blob: cached, cacheKey };
	}

	const token = readToken();
	if (!token) {
		throw new Error('NO_TOKEN');
	}
	const platformFetch = await getPlatformFetch();
	const headers = {
		Authorization: `Bearer ${token}`,
		'Content-Type': 'application/json',
	};

	let res = await platformFetch(BASE_URL + SPEECH_MINIMAX_TTS_STREAM, {
		method: 'POST',
		headers,
		body: JSON.stringify({ text: plain, ...buildMinimaxTtsRequestExtras() }),
	});

	if (res.status === 503 || res.status === 401 || res.status === 502) {
		res = await platformFetch(BASE_URL + SPEECH_TTS, {
			method: 'POST',
			headers,
			body: JSON.stringify({ text: plain }),
		});
	}

	if (!res.ok) {
		throw new Error(`TTS_HTTP_${res.status}`);
	}

	return { kind: 'live', response: res, cacheKey };
}
```

**变更摘要**：去掉 `readResponseBodyAsArrayBuffer` 与 `touchCloudTtsCache`，使 `startCloudTts` 可在预取阶段 **仅占用 HTTP**，与当前段播放重叠。

---

### 4.4 `playCloudTtsReady`（单段：读 body → 缓存 → 播放）

**对比范围**：纯新增；改动前无对应符号（旧版在 `fetchCloudTtsBlob` 内读完 body）。

**改动后** · `apps/frontend/src/utils/speech.ts`（当前，约 L695–L709）

```typescript
// 将 CloudTtsReady 转为音频播放（单段）
async function playCloudTtsReady(
	ready: CloudTtsReady,
	generation: number,
): Promise<void> {
	if (ready.kind === 'cached') {
		await playCloudMp3Blob(ready.blob, generation);
		return;
	}

	// 收齐该段 MP3 二进制（不用 MSE 边下边播）
	const buf = await readResponseBodyAsArrayBuffer(ready.response);
	if (!isPlaybackGenerationActive(generation)) return;
	touchCloudTtsCache(ready.cacheKey, buf);
	await playCloudMp3Blob(new Blob([buf], { type: 'audio/mpeg' }), generation);
}
```

---

### 4.5 `playCloudTtsCadenceSegments`（句读分段 + 预取核心）

**对比范围**：完整 async 函数。改动前云端长文等价于 `fetchCloudTtsBlob(plain)` 整段，无此函数。

**改动前** · `apps/frontend/src/utils/speech.ts`（基线，`playPreferred` 云端 try 分支，约 L790–L794）

```typescript
	try {
		const blob = await fetchCloudTtsBlob(plain);
		if (!isPlaybackGenerationActive(generation)) return;
		await playCloudMp3Blob(blob, generation);
		return;
```

**改动后** · `apps/frontend/src/utils/speech.ts`（当前，约 L714–L752）

```typescript
// 云端长文：句读分段 + 播当前段时预取下一段
async function playCloudTtsCadenceSegments(
	plain: string,
	generation: number,
): Promise<void> {
	const chunks = splitTextForTtsCadence(plain);
	if (chunks.length === 0) return;

	// 短句快路径：单段且 ≤120 字
	if (
		chunks.length === 1 &&
		chunks[0].text.length <= MAX_SINGLE_CLOUD_TTS_CHARS
	) {
		const ready = await startCloudTts(chunks[0].text);
		if (!isPlaybackGenerationActive(generation)) return;
		await playCloudTtsReady(ready, generation);
		return;
	}

	// 长文：立即发起第一段请求，Promise 存入 pendingReady
	let pendingReady: Promise<CloudTtsReady> | null = startCloudTts(
		chunks[0].text,
	);

	for (let i = 0; i < chunks.length; i += 1) {
		if (!isPlaybackGenerationActive(generation)) return;

		if (i > 0) {
			const prevPause = chunks[i - 1]?.pauseAfterMs ?? PAUSE_AFTER_CLAUSE_MS;
			await pauseMs(prevPause);
			if (!isPlaybackGenerationActive(generation)) return;
		}

		const ready = await pendingReady!;
		if (!isPlaybackGenerationActive(generation)) return;

		pendingReady =
			i + 1 < chunks.length ? startCloudTts(chunks[i + 1].text) : null;

		await playCloudTtsReady(ready, generation);
	}
}
```

**变更摘要**：

- `pendingReady` 在 `await playCloudTtsReady` **之前** 赋值为下一段 `startCloudTts(...)`，使下一段 HTTP 与当前段 **读 body + 播放** 并行。
- 段间 `pauseMs` 与本机 `speakTextWithGeneration` 使用同一 `chunks[i-1].pauseAfterMs` 语义。

---

### 4.6 `playPreferred` 云端入口

**对比范围**：`export async function playPreferred` 全函数。

**改动前** · `apps/frontend/src/utils/speech.ts`（基线，约 L770–L802）

```typescript
export async function playPreferred(
	rawText: string,
	options?: PlayPreferredOptions,
): Promise<void> {
	const plain = stripMarkdownForTts(rawText);
	if (!plain) return;

	const generation = beginPlaybackSession();
	const speakOpts = options?.speak;
	const useCloud = shouldUseCloudTts(options);

	if (!useCloud) {
		if (!isPlaybackGenerationActive(generation)) return;
		if (!isSpeechSupported()) {
			throw new Error('NO_TTS');
		}
		await speakTextWithGeneration(rawText, generation, speakOpts);
		return;
	}

	try {
		const blob = await fetchCloudTtsBlob(plain);
		if (!isPlaybackGenerationActive(generation)) return;
		await playCloudMp3Blob(blob, generation);
		return;
	} catch {
		if (!isPlaybackGenerationActive(generation)) return;
		if (!isSpeechSupported()) {
			throw new Error('NO_TTS');
		}
		await speakTextWithGeneration(rawText, generation, speakOpts);
	}
}
```

**改动后** · `apps/frontend/src/utils/speech.ts`（当前，约 L883–L911）

```typescript
export async function playPreferred(
	rawText: string,
	options?: PlayPreferredOptions,
): Promise<void> {
	const plain = stripMarkdownForTts(rawText);
	if (!plain) return;

	const generation = beginPlaybackSession();
	const speakOpts = options?.speak;
	const useCloud = shouldUseCloudTts(options);

	if (!useCloud) {
		if (!isPlaybackGenerationActive(generation)) return;
		if (!isSpeechSupported()) {
			throw new Error('NO_TTS');
		}
		await speakTextWithGeneration(rawText, generation, speakOpts);
		return;
	}

	try {
		await playCloudTtsCadenceSegments(plain, generation);
		return;
	} catch {
		if (!isPlaybackGenerationActive(generation)) return;
		if (!isSpeechSupported()) {
			throw new Error('NO_TTS');
		}
		await speakTextWithGeneration(rawText, generation, speakOpts);
	}
}
```

**变更摘要**：云端 try 内由整段 `fetchCloudTtsBlob` 改为 `playCloudTtsCadenceSegments`；本机分支与 catch 全文回退不变。

---

### 4.7 对照：本机分段循环 `speakTextWithGeneration`

**对比范围**：完整 async 函数（未改逻辑，用于说明云端 **复用同一 `chunks` 与 `pauseMs`**）。

**改动后** · `apps/frontend/src/utils/speech.ts`（当前，约 L843–L872）

```typescript
async function speakTextWithGeneration(
	text: string,
	generation: number,
	options?: SpeakOptions,
): Promise<void> {
	if (!isSpeechSupported()) return;

	const plain = stripMarkdownForTts(text);
	if (!plain) return;
	if (!isPlaybackGenerationActive(generation)) return;

	await waitForVoicesReady();
	if (!isPlaybackGenerationActive(generation)) return;
	resetCachedLocalVoice();

	const chunks = splitTextForTtsCadence(plain);
	const chunkRate = chunks.length > 1 ? 0.86 : 0.9;
	for (let i = 0; i < chunks.length; i += 1) {
		if (!isPlaybackGenerationActive(generation)) return;
		const chunk = chunks[i];
		if (i > 0) {
			const prevPause = chunks[i - 1]?.pauseAfterMs ?? PAUSE_AFTER_CLAUSE_MS;
			await pauseMs(prevPause);
			if (!isPlaybackGenerationActive(generation)) return;
		}
		await speakOneUtterance(chunk.text, generation, {
			...options,
			rate: options?.rate ?? chunkRate,
		});
	}
}
```

**对照要点**：云端 `playCloudTtsCadenceSegments` 的 `for` 结构与停顿计算与本函数 **同构**；差异在于云端每段 `await playCloudTtsReady`（网络 I/O + 音频结束），并增加 `pendingReady` 预取。

---

### 4.8 模块自检（长文必须能切成多段）

**改动后** · `apps/frontend/src/utils/speech.ts`（当前，约 L1025–L1033）

```typescript
/**
 * - ponytail: 模块自检——长文须能切成多段，否则云端首播仍等整段合成，
 * - 任意地方第一次 import '@/utils/speech' 时，模块求值到文件末尾就会跑这段 if。
 * - 例如电子书划句朗读、英语学习页、云 TTS 设置页等，
 * 只要 import 了这个模块，自检就会执行一次（模块通常只加载一次，不会重复跑）。
 */
if (splitTextForTtsCadence('测'.repeat(200)).length < 2) {
	throw new Error('[speech] 长文分段异常，云端流水线无法缩短首声');
}
```

---

## 5. `pendingReady` 状态表（手工推演）

设 `chunks = [A, B, C]`（三段长文）：

| 时刻 | `i` | `pendingReady` 赋值 | `await` 顺序 | 并行进行 |
|------|-----|---------------------|--------------|----------|
| 进入 | — | `start(A)` 已发起 | — | HTTP(A) |
| i=0 | 0 | `ready=A`；`pending=start(B)` | `play(A)` | HTTP(B) 与 play(A) |
| i=1 | 1 | pause；`ready=B`；`pending=start(C)` | `play(B)` | HTTP(C) 与 play(B) |
| i=2 | 2 | pause；`ready=C`；`pending=null` | `play(C)` | 仅 play(C) |

若段 B 已在 LRU：`start(B)` 立即 resolve `cached`，预取仍无 HTTP，仅节省合成时间。

---

## 6. 兼容性与回归

| 场景 | 预期 |
|------|------|
| 单词 `hello` | 1 段 ≤120 → 1 次 HTTP |
| 200 字无标点中文 | ≥2 段 → 首段合成完即播 |
| 连点停止 | 世代递增，循环退出，按钮复位 |
| 第二遍听同书摘 | 各段 cache 命中，几乎无 HTTP |
| 云端失败 | catch → 本机 `speakTextWithGeneration` 全文 |

---

## 7. 相关源码路径

| 说明 | 路径 |
|------|------|
| 分段 + 预取 | `apps/frontend/src/utils/speech.ts` → `playCloudTtsCadenceSegments` |
| 句读切分 | 同文件 → `splitTextForTtsCadence` |
| 统一入口 | 同文件 → `playPreferred` |
| 电子书听当前 | `apps/frontend/src/views/ebook/hooks/useEbookQuoteListen.ts` |

---

（若与仓库最新源码不一致，以源码为准。）
