# Tauri 云端 MP3 播放修复 — 影响点分析

## 延伸阅读

- [云端TTS边缘韵律会员影响.md](./云端TTS边缘韵律会员影响.md) — Edge 接入、分模式 prosody、非会员选路（姊妹大改动）
- [云端TTS边缘语音.md](../english/云端TTS边缘语音.md) — Edge 实现说明与代码对比
- [TTS桌面端云端播放影响.md](../english/TTS桌面端云端播放影响.md) — 本篇对应的实现说明与代码对比
- [TTS本地取消结算影响.md](./TTS本地取消结算影响.md) — 本机 Web Speech cancel settle（**不触达**本改动）
- [EPUB听书云端预取影响.md](./EPUB听书云端预取影响.md) — 句间云端预取（仍走 `startCloudTts` / `playCloudMp3Blob`）
- [TTS边缘统一流式端点影响.md](./TTS边缘统一流式端点影响.md) — **Edge 统一 stream endpoint**（与 §2.2 Tauri 非流式分流**相反**，以最新源码为准）

**阅读约定**：结论以仓库 **当前源码** 为准；「历史风险」指旧实现曾出现问题（如线上桌面 Edge「播放中无声、暂停再播恢复」），不代表现行代码仍会触发。

## 1. 分析目的

评估 **Tauri 桌面端云端 MP3 播放链路修复**（Audio 手势解锁、`canplay` 后再 `play()`、Tauri 读 body / Edge endpoint 分流）是否改变或破坏已有朗读能力：

- **全站 `playPreferred` 入口**（英语学习喇叭、练习、收藏、错题等）
- **EPUB 听书 / 听当前**（`useEpubChapterListen` / `useEbookQuoteListen`）
- **语音设置页试听**（MiniMax / 讯飞 / Edge / 本机）
- **MiniMax / 讯飞 / Edge 三路云端**（`startCloudTts` → `playCloudMp3Blob`）
- **Web 浏览器**（非 Tauri，`isTauriRuntime()` 为 false 的路径）
- **本机 Web Speech**（`preferLocal` / 非云端选路）
- **播放世代 / stopAll / 缓存 key**（`playbackGeneration`、`cloudTtsAudioCache`）
- **已有 `primePlaybackForUserGesture` 调用方**（听书 hook 内重复 prime）

**改动范围（当前 diff）**：

| 文件 | 变更 |
|------|------|
| `apps/frontend/src/utils/speech.ts` | `playPreferred` 入口同步 `primePlaybackForUserGesture()`；`prime` 增加静音 `Audio` 解锁；`readResponseBodyAsArrayBuffer` 在 Tauri 用 `arrayBuffer()`；Tauri+Edge 走 `SPEECH_EDGE_TTS` 非流式；新增 `waitCloudAudioCanPlay` / `startCloudAudioPlayback`；`playCloudMp3Blob` 经后者播放 |
| `apps/frontend/src/service/api.ts` | 新增常量 `SPEECH_EDGE_TTS`（`/edge/speech`） |

（`apps/frontend/latest.json`、`tauri.conf.json` 版本号、`tsconfig.tsbuildinfo` 与朗读行为无关，不纳入分析。）

**结论摘要**：

| 维度 | 是否影响原有功能 | 说明 |
|------|------------------|------|
| **Web 浏览器** 云端 MiniMax / 讯飞 / Edge | **低（增强）** | 仍走 stream endpoint + stream reader；`playPreferred` 多一次同步 prime（speech + 静音 Audio），`playCloudMp3Blob` 多等 `canplay`，起播略延迟、无声挂起概率降低 |
| **Tauri 桌面** Edge 云端 | **有条件变化** | 修复线上高频「UI 播放中但无声、暂停再播恢复」；Edge 改非流式 `/edge/speech`；读 body 不再用 stream reader |
| **Tauri 桌面** MiniMax / 讯飞云端 | **低（增强）** | 共享 `readResponseBodyAsArrayBuffer`（Tauri→`arrayBuffer()`）与 `startCloudAudioPlayback`；endpoint 仍为 stream URL，语义不变 |
| **本机 Web Speech 路径** | **低** | 每次 `playPreferred` 多同步 prime（原仅听书 hook 显式调用）；与 `settleSpeechSynthesisAfterCancel` 叠加时入口仍只 prime 一次/次播放 |
| **对外 API**（`playPreferred` 等 export） | **否** | 无签名变更 |
| **缓存 key / LRU** | **否** | `buildCloudTtsCacheKey` 未改；Tauri Edge 换 URL 不影响 key 后缀 |
| **播放世代 / stopAll** | **否** | `beginPlaybackSession` 仍在 prime 之后；世代语义不变 |
| **云端失败回退本机** | **否** | catch 仍进 `speakTextWithGeneration`；prime 已在入口执行 |
| **句间预取** `prefetchCloudTts` | **否** | 仍 `startCloudTts`；Tauri 侧同样受益于 body 读取与 Edge 非流式 |
| **听书 ↔ 听当前互斥 / 播放条** | **否** | hook 未改 |
| **后端 Edge/MiniMax/讯飞 API** | **否** | 仅前端选路；`/edge/speech` 本就存在 |

---

## 2. 改动要点（相对改前行为）

### 2.1 用户手势与 Audio 解锁

**改前**：

```text
用户点击 →（部分入口 prime speechSynthesis）→ await 网络合成（线上 Edge 常数秒）
  → playCloudMp3Blob → audio.play()  // Tauri WKWebView 手势已过期，play 挂起或无声
```

**改后**：

```text
用户点击 → playPreferred 同步 prime（speechSynthesis + 静音 Audio.play）
  → beginPlaybackSession → … → startCloudAudioPlayback（canplay → play，Tauri 失败则 load 重试）
```

**动机**：线上桌面 Edge 合成慢，异步后才 `play()`；原 `primePlaybackForUserGesture` 未解锁 `HTMLAudioElement`。

**调用链**：`playPreferred` 被 **19+ 视图/hook** 直接调用（`grep` 全仓 `playPreferred(`）；入口统一 prime，听书 hook 内原有 `primePlaybackForUserGesture()` 变为**冗余但无害**（二次静音 play）。

### 2.2 Tauri 读响应体与 Edge endpoint

**改前**：

- 所有环境：`readResponseBodyAsArrayBuffer` 优先 `res.body.getReader()` 逐块读。
- Edge：`SPEECH_EDGE_TTS_STREAM`（controller 整段合成后一次 `write`，仍为 chunked 响应）。

**改后**：

- **Tauri**：一律 `res.arrayBuffer()`，避免 HTTP 插件对 chunked body 挂起。
- **Tauri + Edge**：`SPEECH_EDGE_TTS`（Nest `StreamableFile` 一次性 body）。
- **Web + Edge**：仍为 `SPEECH_EDGE_TTS_STREAM`。

**动机**：线上 Tauri 读 stream body 与 Edge 延迟叠加，表现为长时间「播放中无声」。

### 2.3 `playCloudMp3Blob` 播放时序

**改前**：`new Audio(blobUrl)` 后立即 `audio.play().then(waitCloudAudioEnd)`。

**改后**：`waitCloudAudioCanPlay` → `audio.play()`；Tauri 下 catch 后 `audio.load()` 再试。

**动机**：WKWebView 在 metadata 未就绪时 `play()` 可能既不 reject 也不立刻出声。

---

## 3. 影响点矩阵

| 模块 / 场景 | 影响等级 | 分析 |
|-------------|----------|------|
| **语音设置 → Edge 试听**（`cloudTts/index.tsx` → `playPreferred`） | **中（Tauri）/ 低（Web）** | Tauri 线上：修复无声挂起；Web：多 ~数十 ms `canplay` 等待 |
| **语音设置 → MiniMax / 讯飞试听** | **低** | 共享 `startCloudAudioPlayback` + Tauri `arrayBuffer`；endpoint 未改 |
| **英语学习喇叭**（词库/句库/包/收藏/错题/练习等） | **低** | 均 `playPreferred`；云端路径起播更稳；本机多一次 prime |
| **EPUB 听当前**（`useEbookQuoteListen`） | **低** | 仍 `playPreferred` + `onCadenceChunk`；hook 内 prime 与入口 prime 重复 |
| **EPUB 听书**（`useEpubChapterListen`） | **低** | 同上；云端长文分段 + 预取逻辑未改 |
| **本机朗读**（非会员 / `playbackSource: local` / `preferLocal: true`） | **低** | 不进入 `playCloudMp3Blob`；入口 prime 仅多解锁 speech + 静音 Audio |
| **云端失败 → 回退本机** | **无** | catch 路径不变；prime 已在同次 `playPreferred` 开头执行 |
| **MP3 LRU 缓存** | **无** | 命中缓存仍 `playCloudMp3Blob`；key 算法未变 |
| **playbackGeneration / 快速连点 stop** | **无** | `beginPlaybackSession` 在 prime 之后；作废逻辑未改 |
| **Web 端 Edge stream** | **无** | `isTauriRuntime()` false 时 endpoint 与 body 读取与改前一致（除 `canplay` 与入口 prime） |
| **后端 `/edge/speech` vs `/stream`** | **无（服务端）** | 同一 `EdgeTtsService.synthesizeSpeech` 语义；仅客户端 Tauri 选非流式 URL |

---

## 4. 潜在风险与缓解

| 风险 | 等级 | 说明 | 建议验证 |
|------|------|------|----------|
| **入口 double prime**（听书 hook + `playPreferred`） | 低 | 两次静音 `Audio.play()`，一般无听感 | 听书连播 10 句，无叠音/报错 |
| **Web 起播略慢**（`canplay` 等待） | 低 | 短词 MP3 多等 metadata | Web Edge 试听与单词喇叭，感知延迟可接受 |
| **Tauri 非 Edge 仍用 stream URL** | 低 | MiniMax/讯飞 chunked 在 Tauri 仅改读法为 `arrayBuffer()` | 线上桌面 MiniMax、讯飞各试听一句 |
| **prime 在非用户手势上下文** | 低 | 练习自动连播等极少路径可能无点击栈；静音 play 失败被 catch | 听写三连播（`usePracticePlayback` sequence）桌面/Web |
| **`startCloudAudioPlayback` Tauri 重试仍失败** | 中 | 极端 WebView 仍可能拒绝 play | 线上桌面 Edge 冷启动首句；失败应仍走 catch 回退本机 + Toast |

---

## 5. 未改动项

| 项 | 说明 |
|----|------|
| `shouldUseCloudTts` / 会员选路 | 未在本 diff 修改 |
| `buildCloudTtsCacheKey` / 各 `build*RequestExtras` | 未改 |
| `playCloudTtsCadenceSegments` / 句读分段 | 未改 |
| `waitCloudAudioEnd` / 超时逻辑 | 未改 |
| `settleSpeechSynthesisAfterCancel` | 本机专用，未改 |
| 后端 controller / Edge 合成服务 | 未改 |
| 设置页 UI / i18n | 未改 |

---

## 6. 回归清单

- [ ] **线上 Tauri + Edge**：语音设置 Edge 试听 — 点击后应在合成完成后 **正常出声**（允许 1–3s 等待，不应长期无声挂起）
- [ ] **线上 Tauri + Edge**：暂停再播 — 第二次仍正常（含缓存命中）
- [ ] **线上 Tauri + MiniMax / 讯飞**：各试听一句 — 与改前一致或更稳
- [ ] **Web 浏览器 + Edge / MiniMax / 讯飞**：试听与英语学习喇叭 — 无回归
- [ ] **本机来源**（`playbackSource: local`）：设置页本机试听、非会员喇叭 — 仍走 Web Speech
- [ ] **EPUB 听当前 / 听书**（云端来源）：连播 5+ 句，无叠音、世代 stop 正常
- [ ] **云端失败回退**：断网或无效 token — Toast + 本机回退仍可用
- [ ] **快速连点** 不同词条喇叭 — 无旧 MP3 串音（世代仍有效）
- [ ] `cd apps/frontend && npx tsc --noEmit`

---

## 7. 相关文档滞后

| 文档 | 说明 |
|------|------|
| [云端TTS边缘语音.md](../english/云端TTS边缘语音.md) | §4 未写 Tauri 非流式 endpoint 与 `startCloudAudioPlayback`；可后续补一节 |
| [英语TTS播放.md](../english/英语TTS播放.md) | `playCloudMp3Blob` 描述仍为「直接 `audio.play()`」 |
| [TTS端到端指南.md](../english/TTS端到端指南.md) | 未区分 Tauri body 读取与 prime 行为 |

---

（若与仓库最新源码不一致，以源码为准）
