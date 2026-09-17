# 云端 TTS：Edge 免费语音 + 分模式参数 + 非会员选路 — 影响点分析

## 延伸阅读

- [云端TTS用户凭据回退影响.md](./云端TTS用户凭据回退影响.md) — MiniMax/讯飞凭证、失败 Toast、三选一路由（姊妹稿，部分结论已扩展）
- [TTS桌面端云端播放影响.md](./TTS桌面端云端播放影响.md) — Tauri 云端 MP3 播放修复（Edge 线上桌面无声挂起补丁）
- [云端TTS MiniMax模型设置影响.md](./云端TTS MiniMax模型设置影响.md) — MiniMax 模型白名单与 Combobox
- [TTS本地取消结算影响.md](./TTS本地取消结算影响.md) — 本机 Web Speech 降级与 cancel settle
- [EPUB听书云端预取影响.md](./EPUB听书云端预取影响.md) — 句间云端预取（仍走 `shouldUseCloudTts`）
- [云端TTS设置.md](../english/云端TTS设置.md) — 设置页结构（**滞后**：仍写「三选一 / 会员才云端」）
- [TTS播放源.md](../english/TTS播放源.md) — 朗读介质 Switch（**滞后**：未含 `edge`）
- [讯飞云TTS.md](../ideas/tts/讯飞云TTS.md) — 讯飞选路设计稿（**滞后**：`playbackSource` 仍为三值）

**阅读约定**：结论以仓库 **当前源码** 为准；「历史风险」指旧实现曾出现的问题，不代表现行代码仍会触发。

## 1. 分析目的

评估 **新增 Microsoft Edge TTS（edge-tts-universal）、朗读参数按模式独立存储、非会员可选 Edge 云端、设置页 Edge 区块前置** 是否改变或破坏已有朗读与偏好能力。

**对照的既有能力**：

- **朗读来源互斥选路**（`playbackSource: local | cloud | xfyun`；会员四路径、非会员仅本机）
- **设置 → 语音设置**（`GET/PUT /settings/cloud-tts`、内存缓存、`minimaxTtsPrefs.ts`）
- **共用语速/音量/音高字段**（改一处影响 MiniMax / 讯飞 / 后续新增源）
- **EPUB 听书 / 听当前**（`useEpubChapterListen` / `useEbookQuoteListen` → `playPreferred`）
- **英语学习各页单词/句子朗读**（多处 `playPreferred`）
- **云端 MP3 LRU**（`buildCloudTtsCacheKey` / 各 `build*CacheKeySuffix`）
- **MiniMax / 讯飞后端合成**（`/minimax/speech/stream`、`/xfyun/speech/stream`）
- **会员 gating**（`isCloudTtsAllowed` / `useMembershipActive`）

**改动范围（当前 diff）**：

| 文件 | 变更 |
|------|------|
| `apps/backend/package.json`、`pnpm-lock.yaml` | 依赖 `edge-tts-universal@^1.4.0` |
| `apps/backend/.../edge-tts.service.ts` 等 | Edge 合成服务、prosody 映射、LRU |
| `apps/backend/.../dto/edge-tts.dto.ts` | Edge 流式请求 DTO |
| `apps/backend/.../speech-transcription.controller.ts` | `POST edge/speech`、`edge/speech/stream` |
| `apps/backend/.../minimax-tts-user-config.entity.ts` | `edge_voice_id`；`xfyun_*` / `edge_*` 独立 prosody 列；`speed/vol/pitch` 映射为 MiniMax 专用 |
| `apps/backend/.../dto/upsert-minimax-tts-prefs.dto.ts` | `playbackSource` 含 `edge`；`minimaxSpeed` 等 9 个 prosody 字段 |
| `apps/backend/.../minimax-tts-prefs.service.ts` | 读写分模式字段；默认值 |
| `apps/backend/src/migrations/1782930823469-edge-tts.ts` | 新增 Edge/讯飞/Edge prosody 列 + **附带** `knowledge_trash` 列删除 |
| `apps/backend/src/migrations/1782930809846-edge-tts.ts` | 空迁移（up/down 无 SQL） |
| `apps/frontend/src/constants/edgeTts.ts` | Edge 发音人列表（含方言/港台/英语） |
| `apps/frontend/src/service/cloudTtsSettings.ts` | 类型扩展分模式 prosody |
| `apps/frontend/src/service/api.ts` | `SPEECH_EDGE_TTS_STREAM` |
| `apps/frontend/src/utils/minimaxTtsPrefs.ts` | 归一化、legacy 拆分、`clampPlaybackSourceForMembership`、`buildEdgeTtsRequestExtras` |
| `apps/frontend/src/utils/speech.ts` | `canUseCloudPlaybackSource`；非会员可走 Edge；Edge cache key / 路由 |
| `apps/frontend/src/views/setting/cloudTts/*` | 选路 UI、Edge 区块前置、分模式表单项、非会员可见 Edge |
| `apps/frontend/src/i18n/locales/zh-CN.ts`、`en-US.ts` | Edge 文案、分会员帮助语 |

**结论摘要**：

| 维度 | 是否影响原有功能 | 说明 |
|------|------------------|------|
| MiniMax / 讯飞合成主路径 | **否** | 仍走原 endpoint；`playbackSource` 为 `cloud` / `xfyun` 时逻辑不变 |
| 本机 Web Speech（`local`） | **否** | `preferLocal: true` 与 `playbackSource === 'local'` 路径不变 |
| 非会员云端朗读 | **有条件变化** | 改前仅本机；改后可选 **Edge 云端**（需登录 JWT 调后端） |
| 会员朗读来源 | **有条件变化** | 三选一 → **四选一**（增 `edge`）；选路顺序与设置区块 Edge 置前 |
| 语速/音量/音高偏好 | **有条件变化** | 由共用 `speed/vol/pitch` 拆为 **MiniMax / 讯飞 / Edge 三套**；改讯飞不再覆盖 MiniMax |
| 偏好 API 契约 | **有条件变化** | PUT body 必填 `minimaxSpeed` 等 9 字段；旧客户端仅传 `speed` 需靠前端 normalize 或会 400 |
| 云端 MP3 缓存 | **低（增强）** | Edge 独立 key 后缀 `\u0000edge`；参数变更后旧缓存不命中（预期） |
| EPUB 听书 / 听当前 | **有条件变化** | 仍 `playPreferred`；非会员选 Edge 时走云端而非本机 |
| 英语学习单词朗读 | **同上** | 共用 `playPreferred` / `shouldUseCloudTts` |
| 设置页本机区块置灰 | **低（增强）** | 非会员选 Edge 时亦置灰本机（与会员选云端一致） |
| 会员过期 / 降级 | **低（增强）** | `clampPlaybackSourceForMembership` 将 `cloud/xfyun` 回退 `local` |
| 数据库部署 | **是（部署依赖）** | 须跑迁移；未跑则读写新列失败 |
| `knowledge_trash` 表 | **是（若迁移未审）** | 迁移 `1782930823469` **顺带 DROP** `local_bindings_json`，与 TTS 无关 |

---

## 2. 改动要点（相对改前行为）

### 2.1 Edge TTS 后端与路由

**改前**：无 Edge 合成；云端仅 MiniMax / 讯飞（会员）。

**改后**：

```text
POST /speech-transcription/edge/speech/stream
  → EdgeTtsService（edge-tts-universal）
  → MP3 流；无需 API Key；LRU 按 voice + prosody + text
```

**动机**：提供免费、免密钥的中文/多方言 Neural 音色。

### 2.2 朗读参数分模式存储

**改前**：表与 API 共用 `speed`、`vol`、`pitch`；设置页三处表单绑定同一字段；讯飞 UI 用 MiniMax 量纲再映射 0–100。

**改后**：

| 模式 | API / 状态字段 | 量纲 |
|------|----------------|------|
| MiniMax | `minimaxSpeed` / `minimaxVol` / `minimaxPitch`（列 `speed/vol/pitch`） | 0.5–2 / 0.01–10 / -12–12 |
| 讯飞 | `xfyunSpeed` / `xfyunVolume` / `xfyunPitch` | 0–100 |
| Edge | `edgeSpeed` / `edgeVol` / `edgePitch` | 同 MiniMax |

迁移 SQL 将旧共用值 **一次性拆分** 到各列（讯飞按原映射公式、Edge 复制 MiniMax 数值）。

**动机**：避免「改讯飞音量覆盖 MiniMax」的交叉污染。

### 2.3 非会员选路与 `speech`

**改前**：

```text
shouldUseCloudTts → 非会员恒 false（除 preferLocal:false 强制且 isCloudTtsAllowed）
```

**改后**：

```text
canUseCloudPlaybackSource(source):
  source === 'local' → false
  会员 → cloud / xfyun / edge 均可
  非会员 → 仅 source === 'edge'

PlaybackSourcePicker：非会员仅 ['local','edge']；会员 ['local','edge','cloud','xfyun']
```

**动机**：Edge 免费可对非会员开放；付费 MiniMax/讯飞仍会员专属。

### 2.4 设置页结构

**改前**：会员见选路 + MiniMax + 讯飞；非会员仅本机区块。

**改后**：所有人见选路（非会员二选一）；**Edge 参数区在 MiniMax 之上**；MiniMax/讯飞仍仅会员；Edge 按钮区 `pb-2` 与下方 `border-t` 间距与同页其它区块对齐。

---

## 3. 影响点矩阵

| 模块 / 场景 | 影响等级 | 分析 |
|-------------|----------|------|
| **`playPreferred` 全站调用** | 中 | `shouldUseCloudTts` 语义扩展：非会员 + `edge` 走 `SPEECH_EDGE_TTS_STREAM`；`cloud/xfyun` 仍要会员。调用方：`useEpubChapterListen`、`useEbookQuoteListen`、英语学习 panels、`cloudTts` 试听 |
| **句间预取 `prefetchCloudTts`** | 低 | 非会员选 Edge 时可预取；选 local 仍 null |
| **云端失败 Toast** | 低 | 新增 `englishLearning.tts.cloudEdgeFailed`；`notifyCloudTtsFallback` 按 `playbackSource` 分支 |
| **设置 PUT 偏好** | 中 | 新字段全集必填；仅旧版前端发 `speed` 会 DTO 校验失败——当前仓库前后端同批发布则无问题 |
| **GET 偏好 → 旧前端** | 中 | 新后端返回 `minimaxSpeed` 等；未升级前端读 `speed` 会 undefined（若并存版本需关注） |
| **Legacy localStorage 迁移** | 低 | `splitLegacyProsodyFields` 在缺新字段时从旧 `speed/vol/pitch` 拆三套 |
| **会员 → 非会员切换** | 低 | `clampPlaybackSourceForMembership` 强制 `cloud/xfyun` → `local`；Edge 保留 |
| **MiniMax enabled 开关语义** | 无 | 仍仅 MiniMax 自定义参数；Edge 不依赖 `enabled` |
| **讯飞凭证 / MiniMax Key** | 无 | Edge 无用户凭证列 |
| **硅基 `SPEECH_TTS` 回退** | 无 | 仍未恢复讯飞失败中转硅基 |
| **本机 cancel settle** | 无 | 未改 `playEnglishLocal` settle 逻辑 |
| **后端 JWT** | 低 | Edge endpoint 同控制器 `@UseGuards(JwtGuard)`；未登录无法云端 Edge |

---

## 4. 潜在风险与缓解

| 风险 | 等级 | 说明 | 建议验证 |
|------|------|------|----------|
| 迁移未执行 | 高 | 新列不存在 → ORM 读写失败 | 部署前 `pnpm m:run`；staging 查 `minimax_tts_user_config` 列 |
| 迁移夹带 `knowledge_trash` DROP | 高 | `1782930823469` 删除 `local_bindings_json`，与 TTS 无关 | 确认是否为 typeorm 误生成；生产前拆分或手工审 SQL |
| 空迁移文件 | 低 | `1782930809846` 无 SQL | 可删除或合并，避免 migration 历史噪音 |
| Edge 上游不可用 | 中 | 依赖 Microsoft 在线服务 | 试听失败应 Toast + 回退本机 |
| 非会员误选 Edge 未登录 | 低 | `startCloudTts` 无 token 抛 `NO_TOKEN` | 未登录非会员选 Edge 试听，应降级或提示登录 |
| 旧 API 客户端 | 中 | PUT 缺新 prosody 字段 | 仅 Web 同版本发布则忽略；开放 API 需版本说明 |
| 发音人 ID 不在白名单 | 低 | `isEdgeTtsVoiceId` 校验回退默认晓晓 | 手动改 DB 非法 id 会被 normalize |

---

## 5. 未改动项

| 项 | 说明 |
|----|------|
| MiniMax / 讯飞 HTTP 路径与 DTO | `MinimaxTtsDto`、`XfyunTtsDto` 请求体仍为 `speed/vol/pitch` 或讯飞 0–100；由 `build*RequestExtras` 从分模式 prefs 组装 |
| `preferLocal: true` | 设置页本机试听、强制本机逻辑不变 |
| 听书 vs 听当前互斥 | 未改 hook 层互斥 |
| 云端 cadence 分句 / 预取算法 | 仍 `splitTextForTtsCadence` + `prefetchCloudTts` |
| 会员 MiniMax / 讯飞业务鉴权 | 仍 `isCloudTtsAllowed()` 门控 `cloud`/`xfyun` |
| EPUB 高亮 / 播放条 | 未触达 listen overlay 与 player bar 组件 |

---

## 6. 回归清单

- [ ] **迁移**：执行 `1782930823469` 后表含 `edge_voice_id`、`xfyun_speed`、`edge_speed` 等列；确认 `knowledge_trash.local_bindings_json` 删除是否符合预期
- [ ] **会员选路**：四选项均可选；试听分别命中 MiniMax / 讯飞 / Edge endpoint
- [ ] **非会员选路**：仅本机 + Edge；无 MiniMax/讯飞选项与配置区
- [ ] **非会员 Edge 听书/单词**：选 Edge 后 EPUB 听当前或单词朗读走云端 MP3
- [ ] **分模式参数**：仅改讯飞音量 → 保存 → MiniMax 音量不变；反之亦然
- [ ] **会员过期**：原 `cloud` 用户刷新后回退 `local`；Edge 用户仍可用 Edge
- [ ] **本机置灰**：选 Edge / cloud / xfyun 时本机音色下拉不可点
- [ ] **设置页布局**：Edge 区块在云端语音设置之上；Edge 按钮与下方 border 间距与 MiniMax→讯飞 一致
- [ ] **云端失败**：Edge 失败 Toast 文案正确并回退本机
- [ ] **缓存**：同句改 Edge 发音人后重新合成（新 cache key）
- [ ] `apps/frontend`：`pnpm exec tsc --noEmit`
- [ ] `apps/backend`：`pnpm exec nest build`

---

## 7. 相关文档滞后

| 文档 | 说明 |
|------|------|
| `docs/english/云端TTS设置.md` | 仍描述「三选一」「会员才云端」；缺 Edge 区块顺序与分模式字段 |
| `docs/english/TTS播放源.md` | 未含 `playbackSource: edge` 与非会员 Edge |
| `docs/ideas/讯飞云TTS.md` | 状态机仍为 local/cloud/xfyun 三值 |
| `docs/impact/云端TTS用户凭据回退影响.md` | §1 仍写「三选一」；延伸阅读可链本篇 |
| `docs/english/讯飞云TTS.md` | 若存在共用 `speed` 映射描述，需改为独立 `xfyunSpeed` 等 |

---

（若与仓库最新源码不一致，以源码为准）
