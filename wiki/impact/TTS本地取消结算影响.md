# 本机 Web Speech cancel 后 settle — 影响点分析

## 延伸阅读

- [TTS本地取消结算影响.md](../english/TTS本地取消结算影响.md) — **实现说明**（改动前后对比、逐行注释）
- [EPUB引用听书播放器栏影响.md](./EPUB引用听书播放器栏影响.md) — 听当前按句 `playPreferred` 循环
- [EPUB听书云端预取影响.md](./EPUB听书云端预取影响.md) — 云端路径与句间预取（不受本改动影响）
- [EPUB听书句首标点影响.md](./EPUB听书句首标点影响.md) — 句界与高亮对齐（本改动不碰句界算法）

## 1. 分析目的

评估 **`speakTextWithGeneration` 在 `waitForVoicesReady` 后增加 `settleSpeechSynthesisAfterCancel()`（50ms）** 是否改变或破坏已有功能：

- EPUB **听当前 / 听书** 在本机朗读来源（`playbackSource: 'local'`）下的逐句播放与高亮
- 会员 **云端 TTS 失败回退本机**（`playPreferred` catch → `speakTextWithGeneration`）
- 设置页 **本机音色试听**（`preferLocal: true`）
- 英语学习各入口 **喇叭播放**（单词/经典句/练习等）
- MiniMax / 讯飞 **纯云端** 播放路径
- 播放 **世代**（`playbackGeneration`）与用户 **停止 / 互斥** 语义

**改动范围（当前 diff）**：

| 文件 | 变更 |
|------|------|
| `apps/frontend/src/utils/speech.ts` | 新增私有 `settleSpeechSynthesisAfterCancel()`；在 `speakTextWithGeneration` 内、`resetCachedLocalVoice` 前 `await` 50ms，并在 settle 后再次校验 `isPlaybackGenerationActive` |

（`apps/frontend/tsconfig.tsbuildinfo` 为构建缓存，与行为无关，不纳入分析。）

**结论摘要**：

| 维度 | 是否影响原有功能 | 说明 |
|------|------------------|------|
| MiniMax / 讯飞 **纯云端** 播放 | **否** | 仍走 `playCloudTtsCadenceSegments` + `HTMLAudioElement`，不进入 `speakTextWithGeneration` |
| EPUB 听当前 / 听书 **本机来源** | **有条件变化** | 修复 Chrome 在 `cancel()` 后立刻 `speak()` 导致**首句无声**；每句本机播放开头多 **固定 50ms** |
| 云端失败 **回退本机** | **有条件变化** | 回退路径同样 settle；首包前多 50ms，回退句可正常出声 |
| 设置页本机试听 | **低（增强）** | 试听前多 50ms，避免偶发无声 |
| 英语学习喇叭（本机路径） | **低** | 每次 `playPreferred` 走本机时多 50ms 起播延迟 |
| 句内 cadence 多 chunk | **否** | settle 仅在整段 `speakTextWithGeneration` **入口一次**，chunk 间停顿逻辑未改 |
| 对外 API（`playPreferred` 等） | **否** | 无签名/导出变更 |
| 听书 ↔ 听当前互斥 / 播放条 | **否** | hook 与 overlay 未改 |
| 用户划线 / 想法 / marks-pane | **否** | 不触达 mark 层 |

---

## 2. 改动要点（相对改前行为）

### 2.1 本机 speak 前增加 cancel settle

**改前**：

```text
beginPlaybackSession / stopAllPlayback
  → speechSynthesis.cancel()
  → waitForVoicesReady（可能 0ms）
  → 立刻 speakOneUtterance
```

在 Chrome / Safari 上，**cancel 与下一条 utterance 同一事件循环**内提交时，首条常被丢弃（`onerror` 后立即 resolve），听当前按句循环时 **si=0 无声、si=1 正常**，表现为「跳过第一句」。

**改后**：

```text
cancel（仍在 beginPlaybackSession / stopAll 中）
  → waitForVoicesReady
  → settleSpeechSynthesisAfterCancel（pauseMs(50)）
  → 再校验 playbackGeneration
  → speakOneUtterance
```

**动机**：云端请求有网络延迟，天然避开 cancel 竞态；本机路径需显式让出事件循环后再 `speak()`。

### 2.2 调用链（谁受影响）

`settleSpeechSynthesisAfterCancel` 仅由 **`speakTextWithGeneration`** 调用；该函数入口包括：

| 入口 | 本机路径触发条件 |
|------|------------------|
| `playPreferred` | `shouldUseCloudTts()` 为 false（非会员 / `playbackSource: 'local'` / `preferLocal: true`） |
| `playPreferred` catch | 云端 `playCloudTtsCadenceSegments` 抛错且本机可用 |
| `speakText` | 直接本机朗读（内部 `beginPlaybackSession` + 本函数） |

**不经过** `speakTextWithGeneration` 的路径：云端 MP3（`playCloudTtsReady` / `playCloudMp3Blob`）、`prefetchCloudTts` 仅预取等。

---

## 3. 影响点矩阵

| 模块 / 场景 | 影响等级 | 分析 |
|-------------|----------|------|
| **听当前** `useEbookQuoteListen` + 本机 | 中 | 每句 `playPreferred` → 本机；改前首句易丢，改后首句应正常；句间多 50ms 固定延迟（N 句约 +50N ms，通常可忽略） |
| **听书** `useEpubChapterListen` + 本机 | 中 | 与听当前同循环模型；章首句同样受益 |
| **听当前 / 听书** + 云端 | 无 | 云端不进入 settle |
| **设置 → 本机音色试听** | 低 | `preferLocal: true`；50ms 起播延迟 |
| **设置 → MiniMax / 讯飞试听** | 无 | 走云端分支 |
| **英语学习** 词包/经典句/练习/错题/收藏等喇叭 | 低 | 会员若选云端仍无变化；本机或回退本机每次播放 +50ms |
| **停止 / 暂停** | 低 | settle 期间若 `stopAllPlayback` 递增世代，settle 后 `isPlaybackGenerationActive` 为 false 则静默 return，不误播 |
| **高亮 / 分句索引** | 无 | `buildSentenceOffsetSpans`、overlay 句表未改 |
| **句间云端预取** | 无 | `prefetchCloudTts` 与本机 settle 无关 |

---

## 4. 潜在风险与缓解

| 风险 | 等级 | 说明 | 建议验证 |
|------|------|------|----------|
| 50ms 仍不足，偶发首句无声 | 低 | 慢设备或重度 cancel 链（`prime` + `stopAll` + `beginPlaybackSession`） | 听当前选 3+ 句中文，本机连播，确认每句有声 |
| 句间体感变「钝」 | 低 | 每句本机播放固定 +50ms | 与改前对比听书 20 句总时长，确认可接受 |
| settle 期间用户点停止 | 低 | 50ms 内停止应不播出半句 | 点听当前后立即点停止，无残留朗读 |
| 云端回退本机首句延迟 | 低 | 失败句回退前多 50ms | 人为让讯飞/MiniMax 502，确认回退本机有声 |

---

## 5. 未改动项

| 项 | 说明 |
|----|------|
| `buildSentenceOffsetSpans` / 中文括号句界 | 本次 diff 未涉及 |
| `playCloudTtsCadenceSegments` / `startCloudTts` HTTP 回退 | 硅基 502/503/401 逻辑未改 |
| `useEbookQuoteListen` / `useEpubChapterListen` 状态机 | 未改 hook 源码 |
| `epubListenMarkHighlight` / 播放背景绘制 | 未改 |
| `speakOneUtterance` 的 `onerror → resolve()` | 仍吞错；依赖 settle 降低触发率 |
| 导出 API 与 `PlayPreferredOptions` | 无变更 |

---

## 6. 回归清单

- [ ] EPUB 听当前：朗读来源 **本机**，选 2 句以上，**第一句可听**且顺序正确
- [ ] EPUB 听书：本机来源，章首句正常，句间高亮与朗读 index 一致
- [ ] 听当前 / 听书：**MiniMax 或讯飞** 来源行为与改前一致（无额外 50ms 本机延迟）
- [ ] 云端 TTS 故意失败（如断网）时，**回退本机**仍能读出当前句
- [ ] 设置页本机音色 **试听** 正常
- [ ] 英语学习页单词喇叭（本机路径）正常
- [ ] 播放中 **停止**，无 settle 结束后仍响一声
- [ ] `npx tsc --noEmit -p apps/frontend/tsconfig.json`

---

## 7. 相关文档滞后

| 文档 | 说明 |
|------|------|
| [TTS本地取消结算影响.md](../english/TTS本地取消结算影响.md) | 实现说明（改动前后对比、逐行注释） |
| `docs/ebook/EPUB引用听书.md` | 若仍写「本机与云端无起播差异」，可补充本机 cancel settle 与 50ms 量级（非必须） |
| `apps/frontend/specs/epub-listen-while-read.md` | 未描述 Web Speech cancel 竞态，不影响实现正确性 |

---

（若与仓库最新源码不一致，以源码为准）
