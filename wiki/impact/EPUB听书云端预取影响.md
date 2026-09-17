# EPUB 听读句间云端预取 — 影响点分析

## 延伸阅读

- [EPUB听书云端预取影响.md](../ebook/EPUB听书云端预取影响.md) — **实现说明**（改动前后对比、逐行注释）
- [EPUB听书开发.md](../ebook/developer/EPUB听书开发.md) — 听书 / 听当前总手册（逐句 `playPreferred` 循环）
- [EPUB引用听书播放器栏影响.md](./EPUB引用听书播放器栏影响.md) — 听当前按句播放与播放条
- [EPUB章节听书.md](../ebook/EPUB章节听书.md) — 听书 MVP 与播放条
- [EPUB听书句首标点影响.md](./EPUB听书句首标点影响.md) — 句界算法（与本篇正交，可同轮合并发布）

**阅读约定**：结论以仓库 **当前源码** 为准；「历史风险」指旧实现曾出现的问题，不代表现行代码仍会触发。

## 1. 分析目的

评估 **听书 / 听当前逐句播放时的云端 TTS 句间预取**（`prefetchCloudTts` + `prefetchedCloud`）是否破坏或意外改变已有功能。改前每播完一句才发起下一句云端合成，句间等待网络 + 收 MP3；改后在播第 N 句时并行预取第 N+1 句（首句开播前即预取第二句）。

**对照的既有能力**：

- **听书**（`useEpubChapterListen`）：章内逐句循环、`playPreferred`、播放条切句 / 暂停 / 倍速
- **听当前**（`useEbookQuoteListen`）：选区逐句循环、共用 `EpubListenPlayerBar`
- **English TTS 公共 API**（`playPreferred`）：PopBar 单词、英语学习各页、设置页试听
- **云端 TTS 流水线**（`playCloudTtsCadenceSegments`）：句内 chunk 预取、LRU 缓存、`beginPlaybackSession` 世代
- **本机 Web Speech**：非会员或 `preferLocal` 路径
- **播放背景 / 分句菜单 / 互斥**：听书 vs 听当前、与用户划线隔离

**改动范围（当前 diff）**：

| 文件 | 变更 |
|------|------|
| `apps/frontend/src/utils/speech.ts` | 新增 `prefetchCloudTts`、`TtsSentencePrefetch`；`PlayPreferredOptions.prefetchedCloud`；`resolveCloudTtsReady` 替代首段 `startCloudTts` |
| `apps/frontend/src/views/ebook/hooks/useEpubChapterListen.ts` | `playSentencesFromCursor` 内 `prefetchedByIndex` + `schedulePrefetch` |
| `apps/frontend/src/views/ebook/hooks/useEbookQuoteListen.ts` | `playFromCursor` 内同上 |

**结论摘要**：

| 维度 | 是否影响原有功能 | 说明 |
|------|------------------|------|
| `playPreferred` 对外签名 | **否** | 仅增可选 `prefetchedCloud`；未传时行为与改前一致 |
| 听书 / 听当前逐句播放语义 | **否** | 仍一句一调；分句索引、高亮、暂停 / 切句逻辑未改 |
| 句间等待（云端会员） | **低（增强）** | 预取命中时句间空白缩短；听感更连贯 |
| 本机 Web Speech 路径 | **否** | `prefetchCloudTts` 返回 `null`；不增选项时零差异 |
| 英语学习 / 设置试听等其它调用方 | **否** | 未传 `prefetchedCloud`；grep 无其它引用 |
| 句内长文 chunk 预取 | **否** | `playCloudTtsCadenceSegments` 内循环仍 `startCloudTts` 后续 chunk；仅首 chunk 可走 `prefetchedCloud` |
| 播放条倍速 / 暂停 / 停止 | **否** | 倍速仍作用于 `HTMLAudioElement.playbackRate`；停止仍 `beginPlaybackSession` 作废世代 |
| 播放背景 DOM 时序 | **否** | 高亮仍在 `playPreferred` 前后，未因预取提前 |
| 听书 vs 听当前互斥 | **否** | 未改 `invokeStop*` |
| 云端 API / 缓存 | **有条件变化** | 正常连播略增并行请求；停止后未播预取仍可能完成并写入 LRU（无害） |

---

## 2. 改动要点（相对改前行为）

### 2.1 听书 / 听当前逐句循环

**改前**：

```text
for 每句 si:
  showHighlight(si)
  await playPreferred(spokenRaw)   // 句末才开始下一句 startCloudTts
  clearHighlight(si)
```

**改后**：

```text
prefetchedByIndex = Map<句索引, Promise>
schedulePrefetch(cursor + 1)              // 开播前即预取第二句

for 每句 si:
  showHighlight(si)
  schedulePrefetch(si + 1)                // 并行预取下一句
  await playPreferred(spokenRaw, {
    prefetchedCloud: prefetchedByIndex.get(si),
  })
  clearHighlight(si)
```

**动机**：句与句之间原先无预取，云端路径句间停顿过长；句内 chunk 已有预取，句间补齐对称优化。

### 2.2 `speech` 云端首段解析

**改前**：`playCloudTtsCadenceSegments` 首段 `await startCloudTts(chunks[0].text)`。

**改后**：`await resolveCloudTtsReady(chunks[0].text, opts?.prefetchedCloud)` — 预取 Promise 的 `plain` 与 chunk 文本一致则直接用，否则回退 `startCloudTts`（预取失败 / 跳句 / plain 不一致均安全）。

**动机**：听书 hook 预取的 chunk 文本与 `firstCloudTtsChunkPlain` 对齐，保证命中。

---

## 3. 影响点矩阵

| 模块 / 场景 | 影响等级 | 分析 |
|-------------|----------|------|
| **听书连续播放** | 低（增强） | `useEpubChapterListen.playSentencesFromCursor` 唯一接入；连播时 N+1 句 MP3 在 N 句播放期间合成 |
| **听当前选区播放** | 低（增强） | `useEbookQuoteListen.playFromCursor` 同构；PopBar / 想法入口不变 |
| **分句列表跳句** | 无 | 跳转后 `schedulePrefetch(si+1)` 重排；未预取的句 `get(si)` 为 `undefined` → 现场 `startCloudTts`，与改前一致 |
| **暂停 / 停止** | 无 | `loopGenRef` / `playbackGeneration` 仍作废在途播放；未消费的预取 Promise 可能完成并缓存，不触发播放 |
| **本机音色 / 非会员** | 无 | `shouldUseCloudTts` 为 false 时 `prefetchCloudTts` 返回 null，Map 存 null 等价于未预取 |
| **设置页 `preferLocal` 试听** | 无 | 未传 `prefetchedCloud` |
| **英语学习各页喇叭** | 无 | 单次 `playPreferred`，无逐句 Map |
| **句内 cadence / `onCadenceChunk`** | 无 | 听书 / 听当前未传；长句第二 chunk 起仍句内预取 |
| **MiniMax / 备用 TTS HTTP** | 低 | 连播时每句至多 1 次预取 + 1 次播放；停止后偶发多余请求写缓存 |
| **LRU 云端缓存** | 低（正向） | 预取失败回退、停止后完成预取均可能提前 warming cache |
| **播放背景 / 自动跟随 FAB** | 无 | 高亮与 scroll 仍在句循环内同步 await 之后，未提前 |
| **用户划线 / 想法 sync** | 无 | 无调用链 |

---

## 4. 潜在风险与缓解

| 风险 | 等级 | 说明 | 建议验证 |
|------|------|------|----------|
| 预取 plain 与播放 chunk 不一致 | 低 | `resolveCloudTtsReady` 比对 `hit.plain === chunkPlain`，不一致则重请求 | 超长句（>120 字）首 chunk 与整句 plain 不同；hook 用 `firstCloudTtsChunkPlain` 对齐 |
| 停止后多余云端请求 | 低 | 已发起的 `prefetchCloudTts` 无法取消，仅写缓存 | 快速连点停止；观察网络面板无播放仍请求属预期 |
| 跳句 / 上一句 / 下一句 | 低 | 目标句若无 Map 条目则冷启动，略慢于连播 | 播放条切句后下一句仍应正常播 |
| 倍速切换 | 无 | MP3 合成与速率无关；`playbackRate` 播放时应用 | 1× 播句 A，切 2× 播句 B |
| 预取与 `beginPlaybackSession` 竞态 | 低 | 每句仍新开 generation；预取不绑定旧 generation | 句间快速切倍速 / 暂停 |

---

## 5. 未改动项

| 项 | 说明 |
|----|------|
| `buildSentenceOffsetSpans` / 分句数量 | 本篇不涉及句界算法 |
| `playPreferred` 调用方（除两 hook） | 可选字段默认 undefined |
| `beginPlaybackSession` 每句一次 | 仍作废上一轮音频，互斥语义不变 |
| `PAUSE_AFTER_*` 句内顿挫 | 本机 cadence 停顿毫秒未改 |
| `EpubListenPlayerBar` UI | 未改组件 |
| `epubListenSegmentOverlay` / 播放背景绘制 | 未改 |
| 听书 ↔ 听当前互斥 | `invokeStopChapterListen` / `invokeStopQuoteListen` 不变 |

---

## 6. 回归清单

- [ ] **听书云端**：连续两句中文，第二句应紧接第一句起播，无明显「卡半拍」
- [ ] **听当前云端**：PopBar 选两句以上，句间衔接同上
- [ ] **听书本机**：非会员或设置为本机音色，行为与改前相当（无预取）
- [ ] **播放条跳句**：分句列表跳到第 5 句，应从该句正常播且可继续下一句
- [ ] **暂停 / 停止**：暂停后恢复、停止后无残留播放
- [ ] **倍速 0.75×～3×**：连播多句，速率正确
- [ ] **听书 vs 听当前互斥**：一方播放时启动另一方，前者停止
- [ ] **英语学习喇叭**：单词朗读仍正常（未传预取）
- [ ] **设置页云端 / 本机试听**：预览句仍正常
- [ ] `npx tsc --noEmit`（frontend）

---

## 7. 相关文档滞后

| 文档 | 说明 |
|------|------|
| [EPUB听书云端预取影响.md](../ebook/EPUB听书云端预取影响.md) | 实现说明（改动前后对比、逐行注释） |
| `docs/ebook/developer/EPUB听书开发.md` | 可补「句间云端预取」小节链到上表 |

---

（若与仓库最新源码不一致，以源码为准）
