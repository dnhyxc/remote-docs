# TTS 等待回调语义修正与本机分段 loading 修复

> **文档角色**：修正 `onAwaitingPlayback` 回调语义——仅「尚未出声且在等当前段就绪」时点亮，下一段预取、本机分句停顿不应点亮；修复本机 Web Speech（ponytail）多段朗读时 loading 卡死问题。
> **姊妹文档**：[英语TTS播放.md](./英语TTS播放.md)（播放世代与异步丢弃）、[TTS本地取消结算影响.md](./TTS本地取消结算影响.md)（本机 cancel 后 settle）。
> **延伸阅读**：[../ebook/EPUB听书等待加载.md](../ebook/EPUB听书等待加载.md)（听书等待播放 loading 实现）、[云端TTS节奏预取.md](./云端TTS节奏预取.md)（句读分段 + 播段预取）。

## 1. 背景与目标

### 1.1 问题

`onAwaitingPlayback` 回调自引入以来，在**本机 TTS（ponytail / Web Speech）多段朗读**场景下存在 loading 指示器行为不当的问题：

1. **本机分段间不应点亮 loading**：本机 TTS（`window.speechSynthesis`）多段朗读时，段间只有分句停顿（`pauseMs`），没有 HTTP 下载/canplay 等待。旧代码在每段停顿后都调用 `onAwaitingPlayback(true)`，导致 loading 指示器在整段朗读期间**持续点亮**，直到当前段出声后才熄灭。
2. **`notifyPlaybackStart` 中 `awaiting(false)` 时序靠后**：旧实现中 `onAwaitingPlayback(false)` 在 `playbackStartNotified` 检查和 `onPlaybackStart` 调用之后才执行，若首个 chunk 快速出声，可能出现 `onPlaybackStart` 已触发但 `awaiting(false)` 还未执行的时序错位。
3. **`onAwaitingPlayback` 语义模糊**：旧注释为「多包/多段时会在每一段等待前再次 true；prefetch 未完成也会 true」，实际导致开发者误以为预取也应点亮 loading。

### 1.2 目标

- 明确 `onAwaitingPlayback` 语义：**仅「尚未出声且在等当前段就绪」** 时为 `true`
  - 本机分段停顿 → **不点亮**（无 HTTP/canplay 等待）
  - 下一段预取 → **不点亮**（预取是后台行为，不阻塞当前播放路径）
  - 多包云端 TTS → 上一包结束后、下一包 HTTP/canplay 完成前 → **点亮**（确实在等当前包就绪）
- 修正 `notifyPlaybackStart` 为 `clearAwaitingAndNotifyStart`：先 `awaiting(false)` 再 `onPlaybackStart`，消除时序错位
- 仅首段 `i === 0` 才走一次完整通知；后续段在出声前清掉 waiting

## 2. 改动范围

| 文件 | 变更要点 |
| ---- | -------- |
| `apps/frontend/src/utils/speech.ts` | `PlayPreferredOptions.onAwaitingPlayback` 注释修正；`speakTextWithGeneration` 中本机分段间移除 `onAwaitingPlayback(true)`；`notifyPlaybackStart` → `clearAwaitingAndNotifyStart` 重构 |

## 3. 实现思路

### 3.1 语义分层

```
onAwaitingPlayback(true)  ←  仅以下场景：
  ├── 云端多包：上一包结束 → 下一包 HTTP/canplay 等待中
  └── 云端单包首包：首包 HTTP/canplay 等待中
  
onAwaitingPlayback(false) ←  以下所有场景：
  ├── 出声瞬间（onPlaybackStart 触发前）
  ├── 本机分段停顿（pauseMs，无 HTTP 等待）
  ├── 下一段预取（后台行为，不阻塞当前播放）
  └── 用户主动停止 / 播放世代过期
```

### 3.2 回调时序修正

```
旧 notifyPlaybackStart:
  ┌─ if (playbackStartNotified) return
  ├─ playbackStartNotified = true
  ├─ onAwaitingPlayback(false)   ← 顺序靠后
  └─ onPlaybackStart()

新 clearAwaitingAndNotifyStart:
  ┌─ onAwaitingPlayback(false)   ← 先清 waiting
  ├─ if (playbackStartNotified) return
  ├─ playbackStartNotified = true
  └─ onPlaybackStart()            ← 只通知一次
```

### 3.3 本机分段移除 waiting

```
旧：i > 0 停顿后 → onAwaitingPlayback(true) → loading 卡死整段
新：i > 0 停顿后 → 无 onAwaiting(true) → loading 保持熄灭
```

## 4. 关键代码对比与注释

### 4.1 `PlayPreferredOptions.onAwaitingPlayback` 注释修正

**来源**：`apps/frontend/src/utils/speech.ts`（**改动前**，约 L516–L519）

```typescript
// 描述回调语义：当前正要播放的音频仍在等待（合成/下载/canplay）时为 true，出声后为 false
// 旧注释声称多包/多段时会在每一段等待前再次 true，prefetch 未完成也会 true（语义模糊）
onAwaitingPlayback?: (waiting: boolean) => void;
```

**来源**：`apps/frontend/src/utils/speech.ts`（**改动后**，约 L516–L521）

```typescript
// 描述回调语义：当前正要播放的音频仍在等待（合成/下载/canplay）时为 true，出声后为 false
// 明确语义边界：仅「尚未出声且在等当前段就绪」；下一段预取、本机分句停顿不应点亮
// 补充多包云端场景说明：上一包结束后、下一包 HTTP/canplay 完成前会再次 true
onAwaitingPlayback?: (waiting: boolean) => void;
```

**变更摘要**：注释从两行扩展为三行，明确三点——(1) 本机分句停顿不点亮；(2) 下一段预取不点亮；(3) 仅多包云端在包间 HTTP 等待时才会再次 true。

### 4.2 `speakTextWithGeneration` 本机分段 loading 修复

**来源**：`apps/frontend/src/utils/speech.ts`（**改动前**，`speakTextWithGeneration` 函数内，约 L2226–L2265）

```typescript
// 根据段落数量决定朗读速率：多段 0.86，单段 0.9
const chunkRate = chunks.length > 1 ? 0.86 : 0.9;
// 标记 onPlaybackStart 是否已触发过（确保只触发一次）
let playbackStartNotified = false;
// 旧版通知函数：先检查是否已通知，再标记，再清 awaiting，最后触发 start
// 问题：onAwaitingPlayback(false) 在第 3 顺位，时序靠后
const notifyPlaybackStart = () => {
    // 幂等守卫：已通知过则跳过
    if (playbackStartNotified) return;
    // 标记已通知
    playbackStartNotified = true;
    // 清掉 waiting 状态（第 3 顺位，可能与 onPlaybackStart 时序错位）
    options?.onAwaitingPlayback?.(false);
    // 触发播放开始回调
    options?.onPlaybackStart?.();
};
// 分段顺次朗读主循环
for (let i = 0; i < chunks.length; i += 1) {
    // 朗读期间世代变动则退出
    if (!isPlaybackGenerationActive(generation)) return;
    // 取当前段
    const chunk = chunks[i];
    // 首段无需停顿，后续段按设定停顿
    if (i > 0) {
        // 取前一段的分句停顿时间（如无用默认 PAUSE_AFTER_CLAUSE_MS）
        const prevPause = chunks[i - 1]?.pauseAfterMs ?? PAUSE_AFTER_CLAUSE_MS;
        // 等待停顿结束
        await pauseMs(prevPause);
        // 停顿期间世代变化则退出
        if (!isPlaybackGenerationActive(generation)) return;
        // ⚠️ 问题所在：本机 TTS 无 HTTP 下载/canplay 等待
        // 此行导致本机分段间 loading 持续点亮直到整段出声
        options?.onAwaitingPlayback?.(true);
    }
    // 分段播放前事件钩子（供外部监听段开始）
    emitCadenceChunk(options, plain, chunks, i, 'start');
    // 仅首段触发通知（后续段不再触发 onPlaybackStart）
    // ⚠️ 问题：只有首段清 waiting，后续段若之前被 onAwaiting(true) 点亮则 loading 持续
    if (i === 0) notifyPlaybackStart();
    // 朗读当前 chunk，单段时用标准语速，多段时降为 chunkRate
    await speakOneUtterance(chunk.text, generation, {
        rate: options?.rate ?? chunkRate,
        pitch: options?.pitch,
        volume: options?.volume,
    });
    // chunk 后校验世代
    if (!isPlaybackGenerationActive(generation)) return;
    // 结束事件钩子（供外部监听段结束）
    emitCadenceChunk(options, plain, chunks, i, 'end');
}
```

**来源**：`apps/frontend/src/utils/speech.ts`（**改动后**，`speakTextWithGeneration` 函数内，约 L2227–L2264）

```typescript
// 根据段落数量决定朗读速率：多段 0.86，单段 0.9
const chunkRate = chunks.length > 1 ? 0.86 : 0.9;
// 标记 onPlaybackStart 是否已触发过（确保只触发一次）
let playbackStartNotified = false;
// 重构后的通知函数：先清 waiting，再检查/触发 start
// 消除 onAwaiting(false) 与 onPlaybackStart 的时序错位
// 函数名由 notifyPlaybackStart 改为 clearAwaitingAndNotifyStart，语义更清晰
const clearAwaitingAndNotifyStart = () => {
    // 第 1 顺位：先清掉 waiting 状态（确保 UI 立即从 loading 切到 playing）
    options?.onAwaitingPlayback?.(false);
    // 第 2 顺位：幂等守卫（已通知过则跳过，不再重复触发 onPlaybackStart）
    if (playbackStartNotified) return;
    // 标记已通知
    playbackStartNotified = true;
    // 第 3 顺位：触发播放开始回调（只触发一次）
    options?.onPlaybackStart?.();
};
// 分段顺次朗读主循环
for (let i = 0; i < chunks.length; i += 1) {
    // 朗读期间世代变动则退出
    if (!isPlaybackGenerationActive(generation)) return;
    // 取当前段
    const chunk = chunks[i];
    // 首段无需停顿，后续段按设定停顿
    if (i > 0) {
        // 取前一段的分句停顿时间（如无用默认 PAUSE_AFTER_CLAUSE_MS）
        const prevPause = chunks[i - 1]?.pauseAfterMs ?? PAUSE_AFTER_CLAUSE_MS;
        // 等待停顿结束
        await pauseMs(prevPause);
        // 停顿期间世代变化则退出
        if (!isPlaybackGenerationActive(generation)) return;
        // ✅ 修复：本机分段只有 pause（分句停顿），无 HTTP/canplay 等待
        // 不再调用 onAwaiting(true)，避免 loading 卡死整段
        // 注：云端多包场景的 awaiting 由 playCloudTtsSingleUtterance 外层控制
    }
    // 分段播放前事件钩子（供外部监听段开始）
    emitCadenceChunk(options, plain, chunks, i, 'start');
    // ✅ 修复：每段出声前都清 waiting（不再仅首段）
    // clearAwaitingAndNotifyStart 内部保证 onPlaybackStart 只触发一次
    clearAwaitingAndNotifyStart();
    // 朗读当前 chunk，单段时用标准语速，多段时降为 chunkRate
    await speakOneUtterance(chunk.text, generation, {
        rate: options?.rate ?? chunkRate,
        pitch: options?.pitch,
        volume: options?.volume,
    });
    // chunk 后校验世代
    if (!isPlaybackGenerationActive(generation)) return;
    // 结束事件钩子（供外部监听段结束）
    emitCadenceChunk(options, plain, chunks, i, 'end');
}
```

**变更摘要**：
1. `notifyPlaybackStart` → `clearAwaitingAndNotifyStart`：`onAwaitingPlayback(false)` 从**第三顺位**提升至**第一顺位**，确保出声瞬间 UI 立即切到 playing
2. 移除本机分段间的 `onAwaitingPlayback(true)`：`pauseMs` 仅是分句停顿，无 HTTP 等待，不应点亮 loading
3. `if (i === 0) notifyPlaybackStart()` → `clearAwaitingAndNotifyStart()`：每段出声前都清 waiting，`onPlaybackStart` 内部通过 `playbackStartNotified` 保证只触发一次
4. 新增函数 JSDoc 注释：`/** 出声前清掉 waiting；onPlaybackStart 只通知一次 */`

## 5. 兼容性与影响

| 场景 | 改动前 | 改动后 |
| ---- | ------ | ------ |
| 本机 TTS 多段朗读 loading | 段间停顿后点亮 loading，持续到整段出声 | 段间停顿后不点亮 loading，仅在真正等 HTTP/canplay 时点亮 |
| 本机 TTS 单段朗读 loading | 首段 `notifyPlaybackStart` 先检查再清 awaiting | `clearAwaitingAndNotifyStart` 先清 awaiting 再检查，时序更安全 |
| 云端 TTS 多包 loading | 由 `playCurrent` 外层控制 `onAwaitingPlayback`，不受本次改动影响 | 不变 |
| 云端 TTS 单包 loading | 由 `playCurrent` 外层控制，不受影响 | 不变 |
| `onPlaybackStart` 触发时机 | 首个 chunk 出声前触发一次（`if (i === 0)`） | 每个 chunk 出声前都调用 `clearAwaitingAndNotifyStart()`，但 `onPlaybackStart` 内部通过 `playbackStartNotified` 保证只触发一次 |

## 6. 风险与回归

| 测试场景 | 预期行为 |
| -------- | -------- |
| 本机 TTS 多段朗读（ponytail，含分句停顿） | loading 不在段间闪烁，每段出声后立即显示 playing |
| 本机 TTS 单段朗读 | loading 正确清除，playing 正常显示 |
| 云端 TTS 多包朗读（MiniMax/讯飞） | loading 在包间 HTTP 等待时正确点亮，出声后熄灭 |
| 云端 TTS 单包朗读 | loading 行为不变 |
| 用户在段间停顿期间点击停止 | 世代校验正确退出，无残留 loading |
| 快速连续点击不同词条朗读 | 播放世代正确丢弃，无串音 |
| `onPlaybackStart` 只触发一次 | 多次调用 `clearAwaitingAndNotifyStart()` 只触发一次 `onPlaybackStart` |

## 7. 相关源码路径

| 说明 | 路径 |
| ---- | ---- |
| TTS 核心工具 | `apps/frontend/src/utils/speech.ts` |
| 英语朗读入口 | `apps/frontend/src/views/english-learning/` |
| 听书朗读入口 | `apps/frontend/src/views/ebook/` |
| 播放世代管理 | `apps/frontend/src/utils/speech.ts`（`beginPlaybackSession` / `isPlaybackGenerationActive`） |

---

（若与仓库最新源码不一致，以源码为准）