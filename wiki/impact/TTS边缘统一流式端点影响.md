# Edge TTS 统一 stream endpoint — 影响点分析

## 延伸阅读

- [TTS桌面端云端播放影响.md](./TTS桌面端云端播放影响.md) — **姊妹稿**：曾将 Tauri+Edge 分流至 `SPEECH_EDGE_TTS`；**本篇与之相反**，见 §7
- [云端TTS边缘韵律会员影响.md](./云端TTS边缘韵律会员影响.md) — Edge 选路与 prosody（endpoint 无关）
- [EPUB听书云端预取影响.md](./EPUB听书云端预取影响.md) — 听书预取仍走 `startCloudTts`（共享 endpoint 选择）

**阅读约定**：结论以仓库 **当前源码** 为准；「历史风险」指旧实现曾出现的问题，不代表现行代码仍会触发。

## 1. 分析目的

评估 **`startCloudTts` 中 Edge 源取消 Tauri/Web 分流，统一 `SPEECH_EDGE_TTS_STREAM`** 是否改变或破坏已有功能：

- **语音设置页 Edge 试听**（`setting/cloudTts`）
- **全站 `playPreferred`**（英语学习喇叭、练习、收藏、错题等）
- **EPUB 听书 / 听当前**（`useEpubChapterListen` / `useEbookQuoteListen` + 预取）
- **Tauri 桌面 vs Web 浏览器** 云端 Edge 路径
- **MiniMax / 讯飞 / 本机 Web Speech** 选路（应不受影响）
- **MP3 缓存、playbackGeneration、stopAll**（应不受影响）

**改动范围（当前 diff）**：

| 文件 | 变更 |
|------|------|
| `apps/frontend/src/utils/speech.ts` | `startCloudTts`：Edge 分支移除 `isTauriRuntime() ? SPEECH_EDGE_TTS : SPEECH_EDGE_TTS_STREAM`，恒为 `SPEECH_EDGE_TTS_STREAM`；移除 `SPEECH_EDGE_TTS` import |

**结论摘要**：

| 维度 | 是否影响原有功能 | 说明 |
|------|------------------|------|
| **Web + Edge 云端** | **否** | 改前 Web 已走 `SPEECH_EDGE_TTS_STREAM`，行为不变 |
| **Tauri + Edge 云端** | **有条件变化** | 改前 Tauri 走非流式 `/edge/speech`；改后走 chunked `/edge/speech/stream` |
| **MiniMax / 讯飞云端** | **否** | endpoint 选择未改 |
| **本机 Web Speech** | **否** | 不进入 `startCloudTts` |
| **听书 / 听当前预取** | **有条件变化（Tauri Edge）** | 仍 `{ kind: 'live', response }` 延迟读 body；stream URL 在 Tauri 上历史上有 body 读挂起风险 |
| **后端 Edge 合成结果** | **否** | 两 URL 均 `EdgeTtsService` 整段合成后下发，音频内容一致 |
| **API 导出 / 调用方签名** | **否** | 仅内部 `startCloudTts` 常量变化 |

---

## 2. 改动要点（相对改前行为）

### 2.1 Edge HTTP endpoint 选择

**改前**（`speech.ts` → `startCloudTts`）：

```text
playbackSource === 'edge'
  → isTauriRuntime() ? POST /edge/speech       (SPEECH_EDGE_TTS, StreamableFile)
                     : POST /edge/speech/stream (SPEECH_EDGE_TTS_STREAM, chunked write)
```

**改后**：

```text
playbackSource === 'edge' → 一律 POST /edge/speech/stream (SPEECH_EDGE_TTS_STREAM)
```

**动机**：路由统一、与 xfyun/minimax 的 `*_STREAM` 命名一致；后端 Edge `streamSpeech` 亦为整段合成后一次 yield，无真流式差异。

### 2.2 未改动的消费路径

- 仍返回 `{ kind: 'live', response }`，在 `playCloudTtsReady` 时 `readResponseBodyAsArrayBuffer`。
- **Tauri** 仍走 `if (isTauriRuntime()) return res.arrayBuffer()`（不经过 stream reader）。
- **Web** 仍走 `ReadableStream` reader 合并。

---

## 3. 影响点矩阵

| 模块 / 场景 | 影响等级 | 分析 |
|-------------|----------|------|
| **Web — 设置页 Edge 试听** | **无** | 改前即 stream endpoint |
| **Web — 听书/听当前 Edge** | **无** | 同上 + 预取逻辑未改 |
| **Web — 英语学习喇叭 Edge** | **无** | `playPreferred` → `startCloudTts` |
| **Tauri — 设置页 Edge 试听** | **中** | HTTP 从 Content-Length 变为 chunked；依赖 Tauri `arrayBuffer()` 读整包 |
| **Tauri — 听书 Edge** | **中** | 预取持有未读 body 的 Response + stream URL；历史风险：pending/句间卡住（见 [TTS桌面端云端播放影响.md](./TTS桌面端云端播放影响.md)） |
| **Tauri — MiniMax/讯飞** | **无** | endpoint 未改 |
| **非会员 Edge 选路** | **无** | `shouldUseCloudTts` 未改 |
| **云端 LRU 缓存 key** | **无** | `buildCloudTtsCacheKey` 与 URL 无关 |
| **playbackGeneration / stopAll** | **无** | 未触达 |
| **后端 `/edge/speech`** | **无（客户端）** | 路由仍存在，前端不再调用 |

**调用链（Edge 云端）**：

```text
playPreferred / prefetchCloudTts
  → startCloudTts(plain)
  → POST SPEECH_EDGE_TTS_STREAM
  → playCloudTtsReady → readResponseBodyAsArrayBuffer → playCloudMp3Blob
```

调用方（grep）：`useEpubChapterListen`、`useEbookQuoteListen`、`setting/cloudTts/*`、英语学习各 `*Panel` / `use*Playback` 等，均经 `playPreferred`，无单独 Edge URL 硬编码。

---

## 4. 潜在风险与缓解

| 风险 | 等级 | 说明 | 建议验证 |
|------|------|------|----------|
| Tauri Edge body 读挂起 | **中** | 姊妹分析曾记录 chunked + Tauri HTTP 插件问题；改回 stream 可能复现「播放中无声/句间卡住」 | 线上 Tauri + Edge：试听 + 听书 20 句 |
| DevTools stream pending | **中** | `live Response` 延迟读 body；与 endpoint 无关但 stream 更易表现为 pending | 听书时 Network：stream 不应长期 pending |
| Web 无回归 | **低** | Web 路径等价 | Web Edge 试听 + 听书 spot check |
| 误伤本机/其它源 | **无** | 三分支仅 Edge 常量变化 | MiniMax/讯飞/本机各测 1 次 |

---

## 5. 未改动项

| 项 | 说明 |
|----|------|
| `SPEECH_EDGE_TTS` 常量（`api.ts`） | 仍定义，后端路由保留 |
| `readResponseBodyAsArrayBuffer` Tauri 分支 | 仍为 `arrayBuffer()` |
| `waitCloudAudioEnd` / `playCloudMp3Blob` | 未改 |
| 听书 `prefetchCloudTts` | 未改 API，仍调用 `startCloudTts` |
| 电子书进度防抖（同批 diff） | 独立主题，见 [电子书进度远程防抖影响.md](./电子书进度远程防抖影响.md) |

---

## 6. 回归清单

- [ ] **Web + Edge**：设置页试听正常出声
- [ ] **Web + Edge**：听书/听当前连播 ≥10 句，句间 &lt;2s，无双声
- [ ] **Tauri + Edge**：设置页试听（重点：是否无声需暂停再播）
- [ ] **Tauri + Edge**：听书 20+ 句，句间不长期卡住；stream 请求不应永久 pending
- [ ] **Tauri/Web + MiniMax/讯飞**：确认未回归
- [ ] **非会员 Edge**：仍走云端（membership 选路未改）
- [ ] `npx tsc --noEmit -p apps/frontend`

---

## 7. 相关文档滞后

| 文档 | 说明 |
|------|------|
| [TTS桌面端云端播放影响.md](./TTS桌面端云端播放影响.md) | §2.2 仍写「Tauri+Edge → `SPEECH_EDGE_TTS`」；与当前源码冲突，应标注已被本篇取代或回退 |
| [docs/english/TTS桌面端云端播放影响.md](../english/TTS桌面端云端播放影响.md) | 同上 |
| [云端TTS边缘语音.md](../english/云端TTS边缘语音.md) | 若含 Tauri 分流表，需同步 |

---

（若与仓库最新源码不一致，以源码为准）
