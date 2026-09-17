# MiniMax 模型默认 / 白名单 / 设置 UI — 影响点分析

## 延伸阅读

- [云端TTS用户凭据回退影响.md](./云端TTS用户凭据回退影响.md) — 云端凭证、降级链与 MP3 缓存 key
- [../english/云端TTS MiniMax模型设置影响.md](../english/云端TTS MiniMax模型设置影响.md) — **实现说明**（改动前后代码与逐行注释）
- [MiniMax云端TTS.md](../english/MiniMax云端TTS.md) — MiniMax T2A 全链路（文档中 8 项 model 白名单描述可能滞后，见 §7）
- [云端TTS设置.md](../english/云端TTS设置.md) — 设置页结构与偏好字段

**阅读约定**：结论以仓库 **当前源码** 为准；「历史风险」指旧实现曾出现的问题，不代表现行代码仍会触发。

## 1. 分析目的

评估 **MiniMax 默认模型改为 `speech-2.8-turbo`、前后端 model 白名单收窄为 2.8 系列两项、后端 DTO `@IsIn` 校验、设置页模型字段改为 `CreatableCombobox`、前端 normalize 不再把非法 model 静默改回默认** 是否改变或破坏已有功能。

**对照的既有能力**：

- **朗读来源三选一**（`local | cloud | xfyun`）与 `playPreferred` 选路
- **设置 → 语音设置 → MiniMax 云端**：即时保存偏好（`saveMinimaxTtsUserPrefs` → `PUT /settings/cloud-tts`）
- **云端试听**（设置页 `onPreview` → `playPreferred`）
- **EPUB 听书 / 听当前**、**英语学习单词朗读**（均经 `startCloudTts` → `buildMinimaxTtsRequestExtras`）
- **前端 MP3 LRU 缓存**（`buildMinimaxTtsCacheKeySuffix`，key 含 model 等 extras）
- **恢复默认参数**（`onResetMinimax` → `patch` 写 `getDefaultMinimaxCloudCredentials().model`）
- **新用户 / 无偏好记录**（`DEFAULT_MINIMAX_TTS_PREFS`、`withDefaultCloudTtsPrefs`、env `MINIMAX_TTS_MODEL` / `VITE_MINIMAX_MODEL_NAME`）

**改动范围（当前 diff）**：

| 文件 | 变更 |
|------|------|
| `apps/frontend/src/constants/minimaxTts.ts` | `MINIMAX_TTS_MODELS` 仅保留 2.8-hd / 2.8-turbo；`DEFAULT_MINIMAX_TTS_MODEL` → turbo |
| `apps/frontend/src/utils/minimaxTtsPrefs.ts` | normalize 对 `model` 原样保留，不再按白名单回落默认 |
| `apps/frontend/src/views/setting/cloudTts/index.tsx` | 模型 `PrefTextField` → `CreatableCombobox` + 预设两项 |
| `apps/frontend/src/i18n/locales/zh-CN.ts`、`en-US.ts` | 模型 placeholder 与预设文案 |
| `apps/backend/.../minimax-tts-models.ts` | **新增** 共享白名单与 `DEFAULT_MINIMAX_TTS_MODEL` |
| `apps/backend/.../dto/minimax-tts.dto.ts` | `model` 增加 `@IsIn(MINIMAX_TTS_MODELS)` |
| `apps/backend/.../dto/upsert-minimax-tts-prefs.dto.ts` | 保存偏好时 `model` 同上校验 |
| `apps/backend/.../minimax-tts-prefs.service.ts` | 默认 prefs.model 引用共享常量 |
| `apps/backend/.../minimax-tts.service.ts` | env 未配置时 fallback model → turbo |
| `apps/backend/.../minimax-tts-user-config.entity.ts` | 列默认值 → turbo |
| `apps/backend/src/enum/config.enum.ts`、`speech-transcription.controller.ts` | 注释同步 |
| `apps/frontend/src/utils/speech.ts` | 仅缩进/format，**无行为变化** |

**结论摘要**：

| 维度 | 是否影响原有功能 | 说明 |
|------|------------------|------|
| 本机朗读 / 讯飞云端路径 | **否** | 未改 `playbackSource === 'local'|'xfyun'` 与讯飞 extras |
| 新用户 / 恢复默认 / env 缺省 | **有条件变化** | 默认 model 由 hd → turbo；音色与其它参数不变 |
| 已保存 `speech-2.8-hd` 的用户 | **否** | 仍在白名单内，读写与合成行为不变 |
| 已保存 `speech-2.6*` / `speech-02*` / `speech-01*` 的用户 | **是** | 下次保存或 TTS 请求带旧 model 时后端 400，云端失败并走既有本机降级 |
| 设置页手动输入非法 model | **有条件变化** | 前端不再静默改默认；保存/试听请求由后端拒绝 |
| 设置页模型 UI | **低（增强）** | 与大模型「模型名称」同型 Combobox，预设两项可点选 |
| EPUB / 英语朗读主路径（合法 model） | **否** | `speech.startCloudTts` 请求体构造未改 |
| 前端 MP3 缓存逻辑 | **否** | 未改 LRU 读写的 skip/bypass；model 变更后 key 自然 miss（预期） |
| MiniMax API Key / 音色 / 语速等 | **否** | 本轮未触及 |

---

## 2. 改动要点（相对改前行为）

### 2.1 默认 model：hd → turbo

**改前**：前后端默认、`resolveOptions` env fallback、entity 列默认均为 `speech-2.8-hd`。

**改后**：统一为 `speech-2.8-turbo`（常量 `DEFAULT_MINIMAX_TTS_MODEL` / `getDefaultMinimaxCloudCredentials`）。

**动机**：产品默认选用更快 turbo；显式选 hd 的用户不受影响。

**边界**：数据库已有行的 `model` 字段**不会**因部署自动迁移；仅「无记录 / 点恢复默认 / 新安装 env」走新默认。

### 2.2 白名单：8 项 → 2 项 + 后端校验

**改前**：前端 `MINIMAX_TTS_MODELS` 含 2.6 / 02 / 01 系列；后端 DTO `model` 为任意 `@MaxLength(64)` 字符串；前端 normalize 曾把不在白名单的 model **静默改回** `DEFAULT_MINIMAX_TTS_MODEL`。

**改后**：

- 前后端白名单仅 `speech-2.8-hd`、`speech-2.8-turbo`
- `MinimaxTtsDto` / `UpsertMinimaxTtsPrefsDto` 上 `@IsIn([...MINIMAX_TTS_MODELS])`
- 前端 normalize **保留用户输入的 model 字符串**，非法值由 API 拒绝

**动机**：与当前产品支持的 MiniMax 版本对齐；避免前端 normalize 把用户正在编辑的 model 悄悄改成 hd 导致「界面与请求不一致」。

### 2.3 设置页模型字段 UI

**改前**：普通 `PrefTextField` 单行输入。

**改后**：`CreatableCombobox`（与 `setting/llm` 模型名称同组件）：可输入 + 右侧预设菜单（hd / turbo 两项 i18n 标签）。

**动机**：降低填错成本，与大模型设置交互一致；仍允许键盘输入（Creatable 语义）。

---

## 3. 影响点矩阵

| 模块 / 场景 | 影响等级 | 分析 |
|-------------|----------|------|
| **设置页选 MiniMax 云端 + 预设选 turbo/hd** | 无 | `patch({ model })` → `saveMinimaxTtsUserPrefs` → 后端校验通过；试听/听书读内存 prefs |
| **设置页输入非白名单 model 并保存** | 中 | `UpsertMinimaxTtsPrefsDto` 校验失败 → 偏好不落库；需用户改回两项之一 |
| **设置页输入非白名单 model 点试听** | 中 | `POST minimax/speech/stream` body 含非法 model → 400 → `playPreferred` catch → Toast + 本机降级（与既有云端失败链一致） |
| **DB 中仍为 speech-2.6 等旧 model 的老用户** | 高 | 读偏好仍返回旧值；任意云端朗读带旧 model → **400**；直至用户在设置页改为 hd/turbo 并成功保存 |
| **仅使用 env 默认、从未自定义的用户** | 低 | 若 `.env` 仍为 `speech-2.8-hd` 则行为不变；若已改为 turbo 或留空走代码默认则合成用 turbo |
| **点「恢复默认参数」（MiniMax 区）** | 低 | `getDefaultMinimaxCloudCredentials().model` 现为 turbo（与改前 hd 不同） |
| **`playPreferred` 全站调用方** | 无～低 | 合法 model 时路径不变；非法 model 时云端失败频率上升（仅脏数据用户） |
| **讯飞云端 / 本机 Web Speech** | 无 | 未改选路与合成 URL |
| **MP3 LRU** | 无 | 逻辑未改；model 变更后 cache key 变化导致 miss，属预期 |

---

## 4. 潜在风险与缓解

| 风险 | 等级 | 说明 | 建议验证 |
|------|------|------|----------|
| 老用户 DB 存 2.6/02/01 model，升级后云端朗读全失败 | 高 | 后端 `@IsIn` 拒绝合成与保存 | 用旧 model 账号打开听书 → 改设置页 model 为 turbo 后恢复 |
| Combobox 仍允许键入非法 model | 中 | Creatable 语义保留；依赖后端 400 | 输入 `speech-2.8-hd111` 保存/试听，确认错误提示或降级可理解 |
| 文档仍写 8 项 model 或默认 hd | 低 | `MiniMax云端TTS.md` 等可能滞后 | 见 §7；发布前扫一遍 english 域文档 |
| entity 列默认 turbo 与已有行不一致 | 低 | 仅影响**新插入**行默认值 | 不影响已有 `user_id` 记录 |

---

## 5. 未改动项

| 项 | 说明 |
|----|------|
| `playbackSource` 三选一 | 未改 local / cloud / xfyun 互斥与 UI |
| `buildMinimaxTtsCacheKeySuffix` / LRU 读写 | 未引入 skipCache、stagePrefs 等试听特例 |
| 讯飞凭证、`xfyunVoiceId` | 本轮 diff 未触及 |
| `resolveCredentials` / 用户 MiniMax API Key | 未改 |
| 云端失败 → 本机降级链 | `speech` 除 format 外无逻辑变更 |
| `MINIMAX_TTS_AUDIO_FORMATS`、emotion、voiceId 等 | 其它 MiniMax 参数校验与 UI 不变 |

---

## 6. 回归清单

- [ ] 新账号 / 清除云端偏好后：设置页模型默认显示 `speech-2.8-turbo`，预设菜单含 hd / turbo 两项
- [ ] 选 `speech-2.8-hd` 保存 → 云端试听、英语单词朗读、EPUB 听书（MiniMax 来源）正常
- [ ] 选 `speech-2.8-turbo` 同上
- [ ] 手动输入 `speech-2.6-hd`：保存应失败或试听降级本机；改回白名单项后恢复
- [ ] 点「恢复默认参数」：model 变为 turbo（非 hd）
- [ ] 讯飞云端、本机朗读：与改前一致
- [ ] 已存合法 hd 的旧用户：升级后无需改设置即可继续云端朗读
- [ ] `pnpm exec tsc --noEmit`（frontend）

---

## 7. 相关文档滞后

| 文档 | 说明 |
|------|------|
| `docs/english/MiniMax云端TTS.md` | 仍可能列举 8 项 model、默认 hd；需与 `minimax-tts-models.ts` 对齐 |
| `docs/english/云端TTS设置.md` | 模型字段若仍描述为纯文本框，需改为 Combobox + 两项预设 |
| `docs/impact/云端TTS用户凭据回退影响.md` | §1 表「MiniMax 模型校验为任意字符串」已过时，应改为 `@IsIn` 两项 |

---

（若与仓库最新源码不一致，以源码为准）
