# TTS 音频进度同步与中英权重算法

## 1. 背景与目标

在电子书听书和选区朗读场景中，播放进度的实时同步是核心体验之一。旧版实现基于**纯文本字数比例**估算当前朗读到哪一句，这在纯中文环境下表现尚可，但在中英混排文本中会出现严重的高亮漂移——拉丁字母的朗读耗时远高于 CJK 音节，按字数比例映射会导致高亮严重超前或滞后。

本次变更的目标：
1. **引入真实音频时间**：通过 `onAudioTime` 回调将 `currentTime` 和 `duration` 暴露给上层，用媒体真实播放进度替代估算。
2. **中英权重算法**：引入基于字符类型的朗读耗时权重映射，让中英混排文本的进度估算更准确。
3. **倍速状态持久化**：解决 TTS 等待期间调速丢失的问题，通过 `desiredPlaybackRate` 全局变量暂存倍速期望值。

## 2. 改动范围

- **核心 TTS 引擎**：`apps/frontend/src/utils/speech.ts`
  - `TtsPlaybackProgress` 类型：新增 `currentTime`、`duration` 字段
  - `playCloudTtsSingleUtterance`：集成权重算法与真实时间上报
  - `startCloudAudioPlayback`：引入 `desiredPlaybackRate` 机制
  - `playCloudTtsCadenceSegments`：移除起播快照，改用期望倍速
- **播放控制层**：
  - `apps/frontend/src/views/ebook/utils/epub/listen/epubListenPlayUnits.ts`：新增 `onAudioTime` 参数
  - `apps/frontend/src/views/ebook/utils/epub/listen/playListenPlainText.ts`：透传 `onAudioTime`
- **消费端**：
  - `apps/frontend/src/components/design/SelectionSpeak/useSelectionSpeak.ts`：新增 `onAudioTime` 消费逻辑

## 3. 实现思路

### 3.1 真实音频时间回调

旧版 `onPlaybackProgress` 回调仅上报 `progress`（0-1 比例）和 `sentenceIndex`，缺少绝对时间信息。新版增加 `currentTime` 和 `duration`，上层可以直接用 `currentTime / duration` 计算当前进度，并结合 `sentenceIndex` 精确定位到句子。

关键设计：`TtsPlaybackProgress` 类型扩展为：
```typescript
export type TtsPlaybackProgress = {
    sentenceIndex: number;
    progress: number;
    currentTime: number;   // 当前播放位置（秒）
    duration: number;      // 音频总时长（秒）
};
```

### 3.2 中英混排权重算法

核心思想：不同类型的字符朗读耗时不同，不能简单按字数等分。

**字符权重映射**：
- CJK 字符（中文/日文）：权重 1.0（一个音节对应一个字）
- 拉丁字母：权重 1/3（约 3 个字母对应一个音节）
- 数字：权重 0.5
- 空白字符：权重 0.15
- 其它：权重 0.4

**算法流程**：
1. 为纯文本构建权重前缀和数组（`Float64Array`），便于二分查找。
2. 将播放进度比例（0~1）乘以总权重，得到目标权重偏移。
3. 用二分查找在前缀和数组中定位到对应的字符下标。
4. 将字符下标传给 `sentenceIndexAtOffset` 获取句子序号。

**优势**：在中英混排场景下，英文段落不会因"字数少"而被跳过，中文段落也不会因"字数多"而被提前高亮。

### 3.3 倍速期望值机制

旧版在 TTS 等待（HTTP 请求/音频加载）期间，用户调整倍速会被丢失——因为 `playCloudTtsReady` 时 `audio.playbackRate` 是从函数参数 `rate` 读取的快照值，加载期间的 `applyActivePlaybackRate` 调用虽然设置了 `audio.playbackRate`，但如果 `audio` 还未就绪就无效。

解决方案：引入全局变量 `desiredPlaybackRate`：
- `applyActivePlaybackRate(rate)`：将 `rate` 写入 `desiredPlaybackRate`，若 `cloudAudio` 已就绪则即时生效。
- `seedDesiredPlaybackRate(rate)`：在 TTS 请求发出前调用，将初始倍速写入 `desiredPlaybackRate`。
- `startCloudAudioPlayback` 中设置 `audio.playbackRate` 时，改为读取 `desiredPlaybackRate` 而非函数参数 `rate`。

这样，无论在何时何地调整倍速，新创建的 `audio` 元素都会使用最新的期望值。

### 3.4 onAudioTime 回调链路

新增的 `onAudioTime` 回调形成一条从上到下的数据链路：

```
speech.ts (playCloudTtsSingleUtterance)
    → epubListenPlayUnits.ts (playListenUnitsFromCursor)
        → playListenPlainText.ts (playListenPlainText)
            → useSelectionSpeak.ts (选区朗读消费端)
```

每一层都透传 `onAudioTime`，最终消费端可以获得：
- `text`：当前段的原始文本
- `baseSi`：本段起始句序号
- `currentTime`：当前播放时间
- `duration`：音频总时长
- `sentenceIndex`：基于权重计算的当前句下标（相对本段）

## 4. 关键代码对比与注释

### 4.1 `TtsPlaybackProgress` 类型扩展

**对比范围**：`TtsPlaybackProgress` 类型定义

**改动前** · `apps/frontend/src/utils/speech.ts`（基线，约 L478）

```typescript
// 旧版：仅包含比例进度和句序号
export type TtsPlaybackProgress = {
    sentenceIndex: number;
    progress: number;
};
```

**改动后** · `apps/frontend/src/utils/speech.ts`（当前，约 L478-L482）

```typescript
// 新版：新增 currentTime 和 duration 字段，提供真实音频时钟
export type TtsPlaybackProgress = {
    // 权重算法计算的当前句下标（相对本段起点）
    sentenceIndex: number;
    // 0-1 比例进度（基于权重计算）
    progress: number;
    // 当前播放时间（秒），由 media timeupdate 事件直接提供
    currentTime: number;
    // 音频总时长（秒），由 audio.duration 提供
    duration: number;
};
```

**变更摘要**：类型扩展为包含真实音频时间信息，使上层可以精确计算进度。

### 4.2 中英权重核心算法

**对比范围**：`playCloudTtsSingleUtterance` 函数内的进度计算逻辑

**改动前** · `apps/frontend/src/utils/speech.ts`（基线，约 L1790-L1820）

```typescript
// 旧版：纯字数比例计算，中英混排时不准
async function playCloudTtsSingleUtterance(plain, generation, opts) {
    // ...
    const onPlaybackProgress = (currentTime, duration) => {
        // 计算比例进度（0~1）
        const ratio = Math.min(1, Math.max(0, leadTime / duration));
        // 纯字数映射：直接按比例乘文本长度
        const offset = Math.min(
            Math.max(0, plain.length - 1),
            Math.floor(ratio * plain.length),
        );
        // ...
        const len = Math.max(1, span.end - span.start);
        opts.onPlaybackProgress({
            sentenceIndex: si,
            progress: Math.min(1, Math.max(0, (offset - span.start) / len)),
        });
    };
}
```

**改动后** · `apps/frontend/src/utils/speech.ts`（当前，约 L1750-L1880）

```typescript
// 字符权重映射：CJK≈1音节, 拉丁≈1/3音节, 数字≈0.5, 空白≈0.15
function ttsCharSpeechWeight(ch: string): number {
    // 中日韩统一表意文字及扩展集
    if (/[\u4e00-\u9fff\u3400-\u4dbf...]/.test(ch)) return 1;
    // 拉丁字母（英文）
    if (/[A-Za-z]/.test(ch)) return 1 / 3;
    // 数字
    if (/\d/.test(ch)) return 0.5;
    // 空白字符
    if (/\s/.test(ch)) return 0.15;
    // 其它字符
    return 0.4;
}

// 构建权重前缀和数组（Float64Array 性能优于普通数组）
function buildTtsWeightPrefix(plain: string): Float64Array {
    const prefix = new Float64Array(plain.length + 1);
    for (let i = 0; i < plain.length; i += 1) {
        prefix[i + 1] = prefix[i]! + ttsCharSpeechWeight(plain[i]!);
    }
    return prefix;
}

// 根据权重比例定位字符下标（二分查找）
function charOffsetAtSpeechRatio(prefix: Float64Array, ratio: number): number {
    const n = prefix.length - 1;
    // 边界保护：空前缀直接返回 0
    if (n <= 0) return 0;
    const total = prefix[n]!;
    const r = Math.min(1, Math.max(0, ratio));
    // 总权重为 0 时退化为等比例字符下标
    if (!(total > 0)) return Math.min(n - 1, Math.floor(r * n));
    const aim = r * total;
    let lo = 0;
    let hi = n;
    // 二分查找：找到权重和 <= aim 的最大下标
    while (lo < hi) {
        const mid = (lo + hi + 1) >> 1;
        if (prefix[mid]! <= aim) lo = mid;
        else hi = mid - 1;
    }
    return Math.min(n - 1, lo);
}

// 在 playCloudTtsSingleUtterance 中使用
async function playCloudTtsSingleUtterance(plain, generation, opts) {
    const sentences = buildSentenceOffsetSpans(plain);
    // 构建权重前缀和
    const weightPrefix = buildTtsWeightPrefix(plain);
    const onCadence = opts?.onCadenceChunk;

    // 封装 emitSentence：同时触发 onCadence 回调
    const emitSentence = (si, phase) => {
        if (!onCadence) return;
        const span = sentences[si];
        if (!span) return;
        onCadence({
            phase,
            index: si,
            text: plain.slice(span.start, span.end),
            sentenceIndex: si,
            // ... 其它字段
        });
    };

    let lastSi = -1;
    if (sentences.length > 0) {
        lastSi = 0;
        emitSentence(0, 'start');
    }

    // ... resolveCloudTtsReady 和 playCloudTtsReady 调用 ...

    const onPlaybackProgress = (currentTime, duration) => {
        if (sentences.length === 0) return;
        if (!(duration > 0) || !Number.isFinite(duration)) return;
        // 计算带提前量的比例（媒体时间略提前）
        const leadTime = Math.min(duration, currentTime + CLOUD_CADENCE_LEAD_SEC);
        const ratio = Math.min(1, Math.max(0, leadTime / duration));
        // 用权重映射替代纯字数映射
        const offset = charOffsetAtSpeechRatio(weightPrefix, ratio);
        const si = sentenceIndexAtOffset(sentences, offset);

        // 句切换时触发 emitSentence 的 end/start
        if (onCadence && si !== lastSi) {
            if (lastSi >= 0) emitSentence(lastSi, 'end');
            emitSentence(si, 'start');
            lastSi = si;
        }

        const span = sentences[si];
        if (!span || !opts?.onPlaybackProgress) return;

        // 计算句内进度也使用权重
        const spanW = Math.max(1e-6, weightPrefix[span.end]! - weightPrefix[span.start]!);
        const atW = Math.max(0, ratio * weightPrefix[plain.length]! - weightPrefix[span.start]!);
        opts.onPlaybackProgress({
            sentenceIndex: si,
            progress: Math.min(1, Math.max(0, atW / spanW)),
            // 透传真实音频时间
            currentTime,
            duration,
        });
    };
}
```

**变更摘要**：引入 `ttsCharSpeechWeight`、`buildTtsWeightPrefix`、`charOffsetAtSpeechRatio` 三个核心函数，通过字符类型权重映射实现中英混排场景下的精准进度估算。使用 `Float64Array` 存储前缀和以提升性能。

### 4.3 倍速期望值机制

**对比范围**：`applyActivePlaybackRate`、`startCloudAudioPlayback` 及相关逻辑

**改动前** · `apps/frontend/src/utils/speech.ts`（基线，约 L1363-L2000）

```typescript
// 旧版：直接操作 cloudAudio.playbackRate，加载期间调速无效
let cloudAudio: HTMLAudioElement | null = null;

export function applyActivePlaybackRate(rate: number): void {
    const clamped = clampPlaybackRate(rate);
    if (cloudAudio) cloudAudio.playbackRate = clamped;
}

async function startCloudAudioPlayback(audio, generation, rate, onPlaybackStart) {
    // 从参数 rate 读取倍速，是启动时的快照
    audio.playbackRate = clampPlaybackRate(rate);
    // ...
}
```

**改动后** · `apps/frontend/src/utils/speech.ts`（当前，约 L907-L2040）

```typescript
// 新版：引入全局期望值变量
let desiredPlaybackRate = 1;  // 当前期望倍速，加载期间调速写入此处
let cloudAudio: HTMLAudioElement | null = null;

// 写入期望值；云端 MP3 已挂载则即时生效
export function applyActivePlaybackRate(rate: number): void {
    const clamped = clampPlaybackRate(rate);
    desiredPlaybackRate = clamped;  // 始终更新期望值
    if (cloudAudio) cloudAudio.playbackRate = clamped;  // 已就绪则即时生效
}

// 在 TTS HTTP 等待前写入期望倍速
function seedDesiredPlaybackRate(rate?: number): void {
    desiredPlaybackRate = clampPlaybackRate(rate);
}

// 在 playCloudTtsCadenceSegments 中调用
async function playCloudTtsCadenceSegments(chunks, generation, opts) {
    // 在 TTS HTTP 等待前写入期望倍速
    seedDesiredPlaybackRate(opts?.rate);
    // ...
    // 单段整播时不再传 rate 参数，改为 undefined
    await playCloudTtsReady(ready, generation, undefined, undefined, notifyPlaybackStart);
    // 分段播放时同理
    await playCloudTtsReady(ready, generation, undefined, undefined, ...);
}

async function startCloudAudioPlayback(audio, generation, _rate, onPlaybackStart) {
    await waitCloudAudioCanPlay(audio);
    if (!isPlaybackGenerationActive(generation)) return;
    // 关键改动：读 desiredPlaybackRate 而非参数 _rate
    // 这样 loading 期间用户调速已写入 desiredPlaybackRate
    audio.playbackRate = desiredPlaybackRate;
    // ...
}
```

**变更摘要**：引入 `desiredPlaybackRate` 全局变量作为倍速的"真实来源"。`applyActivePlaybackRate` 始终更新期望值，`startCloudAudioPlayback` 读取期望值而非函数参数，确保加载期间调整的倍速在音频就绪后立即生效。

### 4.4 `onAudioTime` 回调链路

**对比范围**：`PlayListenUnitsArgs` 类型定义及 `playListenPlainText` 函数

**改动前** · `apps/frontend/src/views/ebook/utils/epub/listen/epubListenPlayUnits.ts`（基线，约 L24-L36）

```typescript
// 旧版：无 onAudioTime 参数
export type PlayListenUnitsArgs = {
    // ...
    onSentence: (si: number, info: { forceCenter?: boolean }) => void;
    // ...
};
```

**改动后** · `apps/frontend/src/views/ebook/utils/epub/listen/epubListenPlayUnits.ts`（当前，约 L24-L50）

```typescript
// 新版：新增 onAudioTime 回调，暴露真实音频进度
export type PlayListenUnitsArgs = {
    // ...
    onSentence: (si: number, info: { forceCenter?: boolean; early?: boolean }) => void;
    // 新增：当前这段音频的真实进度（选区朗读预览用；听书勿接）
    // text: 当前段文本
    // baseSi: 本段起始句序号
    // currentTime: 当前播放位置（秒）
    // duration: 音频总时长（秒）
    // sentenceIndex: 基于权重计算的相对句下标
    onAudioTime?: (info: {
        text: string;
        baseSi: number;
        currentTime: number;
        duration: number;
        sentenceIndex?: number;
    }) => void;
};
```

**在 `playListenUnitsFromCursor` 中的使用**（当前，约 L165-L285）：

```typescript
// kick（首段）播放进度回调
onPlaybackStart: () => {
    prefetchAfterKickStart();
    // 开播时上报：baseSi = startSi，进度 0
    onAudioTime?.({
        text: kickRaw,
        baseSi: startSi,
        currentTime: 0,
        duration: 0,
    });
},
onPlaybackProgress: (event) => {
    // 每帧上报真实音频进度
    onAudioTime?.({
        text: kickRaw,
        baseSi: startSi,
        currentTime: event.currentTime,
        duration: event.duration,
        sentenceIndex: event.sentenceIndex,
    });
    // ... 原有高亮逻辑
},

// 正文段落播放进度回调（结构相同）
onPlaybackStart: () => {
    prefetchAfterRestStart();
    onAudioTime?.({
        text: restRaw,
        baseSi: restStartSi,
        currentTime: 0,
        duration: 0,
    });
},
onPlaybackProgress: (event) => {
    onAudioTime?.({
        text: restRaw,
        baseSi: restStartSi,
        currentTime: event.currentTime,
        duration: event.duration,
        sentenceIndex: event.sentenceIndex,
    });
},
```

**在 `playListenPlainText` 中的透传**（当前，约 L11-L43）：

```typescript
// 透传 onAudioTime 到 playListenUnitsFromCursor
export async function playListenPlainText(rawText: string, options?: {
    // ...
    onAudioTime?: (info: { ... }) => void;
}) {
    // ...
    await playListenUnitsFromCursor({
        // ...
        onAudioTime: options?.onAudioTime,  // 直接透传
    });
}
```

**变更摘要**：从 `speech.ts` 的底层回调，经过 `epubListenPlayUnits.ts` 的封装，再到 `playListenPlainText.ts` 的透传，形成完整的 `onAudioTime` 数据链路。每一层都保持接口兼容，消费端只需在顶层传入回调即可。

## 5. 兼容性与影响

- **进度计算精度提升**：中英混排场景下的句子高亮将更准确，不再出现整段中文被跳过或英文段落高亮超前的问题。
- **倍速调速体验修复**：TTS 等待期间调整倍速现在会在音频就绪后立即生效，不再需要重新发起播放。
- **性能开销**：权重前缀和构建使用 `Float64Array` + O(n) 遍历，二分查找定位字符下标为 O(log n)，对长文本（数千字）的单段播放影响可忽略。
- **`onAudioTime` 为可选**：旧版调用方不传此回调时行为不变，不影响现有听书功能。
- **`CLOUD_CADENCE_LEAD_SEC` 保持 0.35s**：提前量机制不变，仅底层映射算法升级。

## 6. 相关源码路径

| 说明 | 路径 |
|------|------|
| TTS 核心引擎 | `apps/frontend/src/utils/speech.ts` |
| 播放控制层（段落调度） | `apps/frontend/src/views/ebook/utils/epub/listen/epubListenPlayUnits.ts` |
| 纯文本播放封装 | `apps/frontend/src/views/ebook/utils/epub/listen/playListenPlainText.ts` |
| 选区朗读消费端 | `apps/frontend/src/components/design/SelectionSpeak/useSelectionSpeak.ts` |

---

若与仓库最新源码不一致，以源码为准。
