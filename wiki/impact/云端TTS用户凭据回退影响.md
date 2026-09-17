# 云端 TTS 用户凭证与失败降级 — 影响点分析

## 延伸阅读

- [云端TTS MiniMax模型设置影响.md](./云端TTS MiniMax模型设置影响.md) — MiniMax 默认 model / 白名单 / 设置 Combobox（本轮）
- [云端TTS边缘韵律会员影响.md](./云端TTS边缘韵律会员影响.md) — Edge TTS / 分模式 prosody / 非会员 Edge（本轮）
- [云端TTS设置.md](../english/云端TTS设置.md) — 设置页结构与偏好字段（姊妹稿部分滞后，见 §7）
- [云端TTS用户凭据.md](../english/云端TTS用户凭据.md) — **实现说明**（改动前后对比）
- [讯飞云TTS.md](../english/讯飞云TTS.md) — 讯飞选路与参数映射（`voiceId` 存 vcn 描述已过时）
- [云端TTS偏好数据库.md](../english/云端TTS偏好数据库.md) — 偏好表与 API
- [EPUB听书云端预取影响.md](./EPUB听书云端预取影响.md) — 句间预取（与 Toast 冷却正交）
- [TTS本地取消结算影响.md](./TTS本地取消结算影响.md) — 本机 Web Speech 降级路径

**阅读约定**：结论以仓库 **当前源码** 为准；「历史风险」指旧实现曾出现的问题，不代表现行代码仍会触发。

## 1. 分析目的

评估 **云端 TTS 用户凭证（MiniMax API Key / 讯飞 APPID·Key·Secret）、讯飞音色独立字段、云端失败 Toast 与降级链调整、设置页 UI 重排** 是否改变或破坏已有功能。

**对照的既有能力**：

- **朗读来源三选一**（`playbackSource: local | cloud | xfyun`）互斥
- **设置 → 语音设置** 保存偏好并同步服务端（`GET/PUT /settings/cloud-tts`）
- **EPUB 听书 / 听当前**（`useEpubChapterListen` / `useEbookQuoteListen` → `playPreferred`）
- **英语学习各页单词朗读**（十余处 `playPreferred` 调用）
- **设置页 / 本机试听**（`cloudTts/index.tsx`、`LocalTtsVoiceSetting`）
- **云端 MP3 缓存**（`buildMinimaxTtsCacheKeySuffix` / `buildXfyunTtsCacheKeySuffix`）
- **讯飞 / MiniMax 后端合成**（`xfyun-tts.service` / `minimax-tts.service`）
- **历史回退链**：讯飞 HTTP 503/401/502 时曾二次请求硅基 `SPEECH_TTS`

**改动范围（当前 diff）**：

| 文件 | 变更 |
|------|------|
| `apps/backend/.../minimax-tts-user-config.entity.ts` | 新增 `xfyun_voice_id`、`xfyun_*` 凭证列、`minimax_api_key` |
| `apps/backend/.../minimax-tts-prefs.service.ts` | 读写新字段；`getMinimaxApiKey` / `getXfyunCredentials` |
| `apps/backend/.../minimax-tts.service.ts` | 合成时优先用户 MiniMax Key |
| `apps/backend/.../xfyun-tts.service.ts` | 合成时优先用户讯飞凭证；缓存 key 含 `credTag` |
| `apps/backend/.../dto/*.ts` | 模型改为任意字符串；upsert 支持新字段 |
| `apps/backend/src/migrations/1782717199169-xunfei_voice_id.ts` | 建表含讯飞列 |
| `apps/backend/src/migrations/1782718851939-minimax.ts` | 补 `minimax_api_key` 列 |
| `apps/frontend/src/constants/minimaxTts.ts` | `getDefaultMinimaxCloudCredentials`（仅 model 可 env 默认） |
| `apps/frontend/src/constants/xfyunTts.ts` | 讯飞凭证默认空，不从 `VITE_XFYUN_*` 预填 |
| `apps/frontend/src/utils/minimaxTtsPrefs.ts` | `xfyunVoiceId` 独立；凭证进 cache key；保存前乐观 `setCache` |
| `apps/frontend/src/utils/speech.ts` | 统一云端失败 Toast；移除讯飞失败中转硅基；`cloudTtsNotified` |
| `apps/frontend/src/views/setting/cloudTts/index.tsx` | 凭证输入、UI 重排、模型文本框 |
| `apps/frontend/src/views/setting/cloudTts/ParamsHelpPopover.tsx` | 帮助项精简；入口移至标题旁 |
| `apps/frontend/src/views/ebook/hooks/useEpubChapterListen.ts` | 避免与 `speech` 重复 Toast |
| `apps/frontend/src/views/ebook/hooks/useEbookQuoteListen.ts` | 同上 |
| `apps/frontend/src/i18n/locales/zh-CN.ts`、`en-US.ts` | 凭证文案、云端失败 Toast 文案 |
| `apps/frontend/src/vite-env.d.ts` | 声明 `VITE_MINIMAX_MODEL_NAME` 等 |

**结论摘要**：

| 维度 | 是否影响原有功能 | 说明 |
|------|------------------|------|
| 朗读来源三选一 / 本机路径 | **否** | `playbackSource === 'local'` 与 `preferLocal` 路径未改 |
| 未填凭证时的云端合成 | **否** | 凭证空时后端仍走 `MINIMAX_API_KEY` / `XFYUN_*` 环境变量 |
| 讯飞失败后的降级链 | **有条件变化** | 不再 HTTP 失败后二次请求硅基；直接 Toast + 本机 Web Speech |
| 云端失败用户感知 | **低（增强）** | 新增区分讯飞/MiniMax 的 Toast；12s 冷却；重开听书立即再弹 |
| MiniMax / 讯飞音色互存 | **有条件变化** | `xfyunVoiceId` 独立列；旧数据经 `splitLegacyVoiceStorage` 迁移 |
| 设置页 UI / 字段说明 | **低（增强）** | 布局重排、凭证区、模型改文本框；帮助 Popover 位置与条目变化 |
| EPUB 听书 / 听当前主路径 | **否** | 仍 `playPreferred`；仅失败 Toast 去重 |
| 英语学习单词朗读 | **低（增强）** | 共用 `playPreferred`，云端失败时多 Toast |
| 前端 MP3 缓存 | **有条件变化** | cache key 含凭证摘要；改凭证后旧缓存不命中（预期） |
| MiniMax 模型校验 | **低（增强）** | 后端由枚举改为 `@MaxLength(64)` 字符串 |
| 数据库 schema | **是（部署依赖）** | 须跑迁移；未迁移则 upsert/读偏好可能失败 |

---

## 2. 改动要点（相对改前行为）

### 2.1 用户级云端凭证

**改前**：

- MiniMax / 讯飞合成仅使用服务端 `.env`（`MINIMAX_API_KEY`、`XFYUN_*`）
- 前端设置页无 API Key / APPID 输入；曾可从 `VITE_XFYUN_*` 预填（已移除）

**改后**：

- 用户在设置页填写 **MiniMax API Key** 或 **讯飞三项凭证** 并保存至 `minimax_tts_user_config`
- 后端 `getMinimaxApiKey` / `getXfyunCredentials`：**仅当用户填写完整**时使用用户凭证，否则回退环境变量
- 前端 **不预填** 讯飞 APPID/Key/Secret 与 MiniMax API Key；模型名可从 `VITE_MINIMAX_MODEL_NAME` 作设置页默认

**动机**：支持会员自带云端应用；避免开发 env 泄露到 UI 默认值。

### 2.2 讯飞音色 `xfyunVoiceId` 独立

**改前**：讯飞 vcn 与 MiniMax `voiceId` 共用同一列；切换来源时 `voiceIdForPlaybackSource` 互转。

**改后**：

- 实体列 `xfyun_voice_id`；`buildXfyunTtsRequestExtras` 读 `prefs.xfyunVoiceId`
- `splitLegacyVoiceStorage`：若旧 `voiceId` 为讯飞 vcn 且无 `xfyunVoiceId`，自动拆分
- 删除 `voiceIdForPlaybackSource`；切换来源不再改写对方音色

**动机**：切讯飞不再清空 MiniMax 音色选择。

### 2.3 云端失败 Toast 与降级链

**改前**：

- 讯飞 HTTP 503/401/502 → `startCloudTts` 二次请求硅基 `SPEECH_TTS`
- 最终失败抛 `NO_TTS`；听书 hook 单独 Toast `englishLearning.tts.unsupported`

**改后**：

- 移除硅基中转；`playPreferred` catch 内 `notifyCloudTtsFallback` 统一 Toast（区分讯飞/MiniMax）
- 可本机降级时 Toast 为 warning +「已改用本机朗读」；否则 error
- `stopAllPlayback` 重置 12s 冷却；错误带 `cloudTtsNotified` 时听书 hook 不再二次 Toast

**动机**：凭证错误时用户需明确感知；避免讯飞失败静默换硅基。

### 2.4 设置页 UI 重排

**改前**：「朗读参数」子标题 + 字段说明在参数区；MiniMax 模型为下拉枚举。

**改后**：

- 「云端语音设置」标题旁放 `ParamsHelpPopover`；说明段落移入表单区顶部
- 去除标题下 border；新增 API Key / 讯飞凭证输入（secret 眼睛按钮）
- 模型改为文本框；帮助 Popover 移除语速/音量/音高说明项

**动机**：凭证配置前置；与讯飞区块视觉一致。

### 2.5 缓存与保存时序

**改前**：cache key 仅 userId + 合成参数 JSON；保存偏好后下次 `load` 才更新内存。

**改后**：

- cache key 追加凭证摘要（讯飞三项 `\u0002` 拼接 / MiniMax Key）
- `saveMinimaxTtsUserPrefs` 在 PUT 前乐观 `setCache`，试听立即用新凭证

**动机**：改凭证后避免命中旧 MP3 缓存。

---

## 3. 影响点矩阵

| 模块 / 场景 | 影响等级 | 分析 |
|-------------|----------|------|
| **设置页 MiniMax 区块** | 低 | 新增 API Key、模型文本框；布局与文案变化；保存字段增多，API 契约扩展 |
| **设置页讯飞区块** | 低 | 新增 APPID/Key/Secret；`xfyunVoiceId` 独立下拉；与 MiniMax 区块结构对齐 |
| **偏好 PUT/GET API** | 中 | DTO/实体增列；**未跑迁移的环境 upsert 会失败** |
| **MiniMax 云端合成** | 低 | 用户 Key 优先；模型可为任意合法字符串；空 Key 行为与改前 env 一致 |
| **讯飞云端合成** | 低 | 用户三项凭证优先；服务端 LRU 缓存 key 含 `credTag` |
| **讯飞 HTTP 失败** | 中 | **不再**自动改走硅基；用户见 Toast 后听本机（若浏览器支持） |
| **MiniMax HTTP 失败** | 低 | 同上 Toast 路径；无硅基中转变化（MiniMax 路径原本也无此中转） |
| **EPUB 听书** | 低 | `playPreferred` 不变；云端连续失败 12s 内只弹一次 Toast |
| **EPUB 听当前** | 低 | 同听书；`cloudTtsNotified` 防重复 |
| **句间云端预取** | 无 | `prefetchCloudTts` 仍走同一 `startCloudTts`；失败由上层 catch |
| **英语学习单词朗读** | 低 | 云端选路时失败多 Toast；仍回退本机 |
| **本机 Web Speech 设置/试听** | 无 | `LocalTtsVoiceSetting` 未改 |
| **PopBar / 词汇卡片** | 低 | 经 `playPreferred` 间接获得 Toast 行为 |
| **前端 MP3 LRU** | 低 | 改凭证后缓存 miss，可能多一次网络合成（正确性优先） |
| **旧 localStorage 迁移** | 无 | 仍经 `normalizeMinimaxTtsUserPrefs` + 服务端同步 |
| **i18n** | 无 | 纯文案 |

---

## 4. 潜在风险与缓解

| 风险 | 等级 | 说明 | 建议验证 |
|------|------|------|----------|
| 未执行 DB 迁移 | 高 | 新列不存在时 PUT/读偏好报错 | 部署后 `npm run m:run`；设置页保存不 500 |
| 讯飞失败不再走硅基 | 中 | 仅配讯飞、无本机 TTS 的浏览器：失败即 error Toast | 讯飞凭证故意填错 → 应 Toast 且无声（或本机降级） |
| 凭证部分填写 | 低 | 讯飞须三项齐才生效；缺一项仍用 env | 只填 APPID → 合成仍走服务端 env |
| 旧用户 voiceId 含 vcn | 低 | 首次加载 `splitLegacyVoiceStorage` 拆分 | 旧账号选讯飞后发音人仍为原 vcn |
| Toast 12s 冷却 | 低 | 同会话连续句失败只弹一次 | 听书多句错误：仅首句 Toast；stop 后再开立即再弹 |
| 空 stub 迁移文件 | 低 | `1782717196036`、`1782718843137` 为空迁移，或造成重复/混乱 | 合并或删除空迁移后再发布 |
| 模型非法字符串 | 低 | 后端不再枚举校验 | 设置页填不存在模型 → MiniMax API 报错 → Toast + 本机 |
| 凭证明文存 DB | 中 | 与 LLM Key 同类；需 DB 访问控制 | 安全审查；非本次功能回退项 |

---

## 5. 未改动项

| 项 | 说明 |
|----|------|
| `playbackSource` 三选一互斥 | `PlaybackSourcePicker` 逻辑未改 |
| 本机音色选择与 `preferLocal: true` | `LocalTtsVoiceSetting`、`speakTextWithGeneration` 未改 |
| 听书 / 听当前互斥与播放条 | `EpubListenPlayerBar`、世代 `generation` 机制未改 |
| 句界算法与 cadence 高亮 | `buildSentenceOffsetSpans`、overlay 未改 |
| 云端句间预取 API | `prefetchCloudTts` / `prefetchedCloud` 签名未改 |
| MiniMax 音色列表与语言增强联动 | `VoiceSelectField` 筛选逻辑保留 |
| 讯飞 0–100 与 vol/pitch 映射 | `xfyunVolumeFromVol` 等函数未改 |
| `enabled: false` 时不发 extras | `buildMinimaxTtsRequestExtras` 仍受 `enabled` 控制 |
| 后端硅基 `SPEECH_TTS` 端点 | 仍存在，但讯飞失败路径不再自动调用 |

---

## 6. 回归清单

- [ ] 部署环境执行迁移后，设置页保存 MiniMax / 讯飞偏好成功（Network `PUT /settings/cloud-tts` 200）
- [ ] 凭证全空 + 服务端 env 已配：MiniMax / 讯飞试听、听书正常
- [ ] 填写用户 MiniMax Key：合成走用户 Key（改 Key 后音色/缓存变化）
- [ ] 填写讯飞三项：合成走用户应用；只填一项仍走 env
- [ ] 切讯飞再切回 MiniMax：两侧音色各自保留（`xfyunVoiceId` / `voiceId` 不互清）
- [ ] 讯飞凭证错误：Toast「讯飞云端朗读失败」+ 本机降级（Chrome）；无硅基二次请求
- [ ] MiniMax Key 错误：Toast「MiniMax 云端朗读失败」+ 本机降级
- [ ] 听书连续多句云端失败：12s 内 Toast 不刷屏；停止后再开听书，下一句失败立即 Toast
- [ ] 听当前 / 听书：不出现双重「播放不可用」Toast
- [ ] 改凭证后立刻试听：不播放旧凭证缓存的 MP3
- [ ] 模型文本框：合法模型名合成正常；空模型回退 env 默认
- [ ] 设置页 UI：标题旁字段说明可开；无多余 border；API Key 眼睛切换正常
- [ ] 英语学习单词卡片云端朗读：失败 Toast 行为与听书一致
- [ ] `npx tsc --noEmit -p apps/frontend`（frontend TS）

---

## 7. 相关文档滞后

| 文档 | 说明 |
|------|------|
| `docs/english/讯飞云TTS.md` | §1.2 仍写「讯飞 vcn 存 `voiceId`」；§1.2/§4 仍写「失败走硅基/MiniMax 回退链」 |
| `docs/english/云端TTS设置.md` | 未描述用户凭证字段、模型文本框、`xfyunVoiceId` 独立列 |
| `docs/english/云端TTS偏好数据库.md` | 表结构需补 `xfyun_voice_id`、`xfyun_*`、`minimax_api_key` |
| `docs/ideas/讯飞云TTS.md` | 规划态，凭证与降级策略与现实现不一致 |

---

（若与仓库最新源码不一致，以源码为准）
