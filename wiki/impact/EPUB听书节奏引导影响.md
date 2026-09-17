# 选区朗读切句提前 — 对听书的影响点分析

## 延伸阅读

- [EPUB引用听书播放器栏影响.md](./EPUB引用听书播放器栏影响.md) — 听当前/听书共用播放链路
- [EPUB听书云端预取影响.md](./EPUB听书云端预取影响.md) — 云端预取与 `playListenUnitsFromCursor`
- [EPUB听书句首标点影响.md](./EPUB听书句首标点影响.md) — 分句算法与高亮对齐

## 1. 分析目的

评估 **云端整段 TTS 切句提前 + 首包尾声提前切下一句**，是否改变或破坏听书既有能力：

- 听书/听当前：按段云端合成、逐句高亮与滚动跟读
- 播放条句游标 / `sentenceIndex` 同步
- 软暂停、倍速、预取、本机 Web Speech 回退
- 英语 Agent 选区朗读预览（改动动机方）

**改动范围（当前会话相关）**：

| 文件 | 变更 |
|------|------|
| `apps/frontend/src/utils/speech.ts` | `CLOUD_CADENCE_LEAD_SEC` 切句提前 ~0.35s；`playCloudMp3Blob` 在有 `onTimeUpdate` 时用 rAF 轮询进度；新增可选 `onPlaybackProgress` |
| `apps/frontend/src/views/ebook/utils/epub/listen/epubListenPlayUnits.ts` | 首包（kick）进度 ≥0.8 时提前 `onSentence(startSi+1)`；rest 若已提前则不再重复 `onSentence` |

**结论摘要**：

| 维度 | 是否影响原有功能 | 说明 |
|------|------------------|------|
| 听书/听当前句高亮时机 | **有条件变化** | 仅云端 `cloudSingleUtterance` 整段估算切句路径；高亮会略早于纯字比例估点（更贴听感），非播放中断类 bug |
| 听书起停/倍速/软暂停/预取 | **否** | 未改 `isActive`、世代、预取调度、`pausePlaybackSoft` |
| 本机 Web Speech 听书 | **否** | lead/rAF 挂在云端 `HTMLAudioElement`；本机仍走 cadence 分段 |
| 选区朗读预览 | **是（增强）** | 动机方：预览切句更跟声 |
| 数据/持久化/划线层 | **否** | 不碰 annotation / CFI 存储 |

---

## 2. 改动要点（相对改前行为）

### 2.1 云端整段切句估点

**改前**：`currentTime/duration × plain.length` → `sentenceIndexAtOffset`；依赖稀疏 `timeupdate`。

**改后**：同一公式，但用 `currentTime + 0.35s`（封顶 `duration`）算字偏移；播放中用 rAF 更密地泵进度。

**动机**：TTS 非匀速 + `timeupdate` 稀疏，切句常落后听感。

### 2.2 首包 kick 尾声提前切句

**改前**：kick 整段 `ended` 后，才 `onSentence(restStartSi)`。

**改后**：kick 的 `onPlaybackProgress.progress ≥ 0.8` 且存在下一句时，提前 `onSentence(startSi+1)`；进入 rest 时若已提前则跳过重复调用。

**动机**：首句结束到下一段出声之间，预览/高亮曾明显滞后。

**调用方**：`playListenUnitsFromCursor` 同时服务：

- `useEpubChapterListen`（听书）
- `playListenPlainText` → 英语 Agent 选区朗读

---

## 3. 影响点矩阵

| 模块/场景 | 等级 | 分析 |
|-----------|------|------|
| 听书多句同包：正文高亮切换 | **中** | 高亮会略提前；与听感更齐，极端短句可能「刚念完上句尾音已亮下一句」 |
| 听书首句 kick → 段内 rest | **中** | 80% 进度即切高亮；加载 rest 的 loading 阶段可能已显示下一句（改前也是 ended 后、出声前就切） |
| 听书播放条句列表选中 | **低** | `onSentence` → `sentenceCursorRef` / `syncState({ sentenceIndex })` 同步提前，与高亮一致 |
| 听书跟读滚动 `forceCenter` | **低** | 仅首句 `scrollCenterOnFirst` 仍用 kick 起始的 `onSentence`；提前切的是 `startSi+1`，不带 `forceCenter` |
| 软暂停 / 续播 | **低** | rAF 在 `pause` 停、`playing` 再启；软暂停语义不变 |
| 倍速 | **低** | lead 按**媒体时间**秒，不随 `playbackRate` 再乘；2× 时墙钟提前量减半，一般可接受 |
| 本机 TTS / 云端失败回退 | **无** | 不走 `playCloudMp3Blob` 的 lead/rAF 句索引路径（或走分段 cadence） |
| 划线 / 想法 mark | **无** | 仍只读写听书 overlay Range，不改用户标注 |

---

## 4. 潜在风险与缓解

| 风险 | 等级 | 说明 | 建议验证 |
|------|------|------|----------|
| 高亮「抢跑」过多 | 中 | `CLOUD_CADENCE_LEAD_SEC=0.35` 对很短句偏大 | 听书英文短句连播：高亮是否明显早于开念 |
| kick 80% 误切 | 低 | 单句 kick 尾静音长时，可能更早亮下一句 | 首句较长章节：尾 20% 是否已亮下一句且可接受 |
| rAF 耗电/主线程 | 低 | 仅存在 `onTimeUpdate`（整段单 utterance 切句）时泵帧 | 听书长段连播看帧率/发热（通常可忽略） |
| 重复 `onSentence` | 低 | kick 已提前时 rest 入口跳过；cadence 仍会再发同句 `start` | 确认高亮不会闪烁/乱跳（幂等设同一 `globalSi`） |
| 功能不可用/停播 | **高（预期无）** | 未改世代、`isActive`、stop、预取键 | 起停、切章、暂停续播各一轮 |

**会不会导致听书出现 bug？**

- **不会**引入停播、错章、丢预取、软暂停失效这类结构性 bug（控制流未改）。
- **会**改变「句高亮/句游标何时前进」的体验时序：属于**有意的时序校准**，极端情况下像「略抢跑」，需听感验收，而不是逻辑崩溃。

---

## 5. 未改动项

- `buildSentenceOffsetSpans` / 段落打包 `buildParagraphUnits`
- 预取 `prefetchCloudTts` 触发时机（仍出声后）
- Media Session、播放条 UI 组件自身
- 选区朗读悬浮条 UI（ScrollArea 手动滚）与本次切句时序正交

---

## 6. 回归清单

- [ ] 听书：云端整段多句，高亮与听感是否齐（略提前可接受）
- [ ] 听书：首句 kick 后进入 rest，高亮不闪、不跳错句
- [ ] 听书：暂停 / 续播 / 改倍速后句高亮仍正确
- [ ] 听书：切章、停止后再播，无残留高亮错位
- [ ] 听当前：同上句高亮时序
- [ ] 本机音色回退：仍可播，行为与改前一致
- [ ] 英语 Agent 选区朗读：预览切句不再明显落后于声音

---

## 7. 相关文档滞后

无必须同步的规格正文；若日后把 `0.35s` / `0.8` 写成产品常量，可补听书开发者手册「句高亮估点」小节。

（若与仓库最新源码不一致，以源码为准）
