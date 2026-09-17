# Edge 云端朗读、分模式韵律参数与会员选路

**文档角色**：本轮 Edge TTS 接入的实现说明（前后端一体）。影响面矩阵见 [../impact/云端TTS边缘韵律会员影响.md](../impact/云端TTS边缘韵律会员影响.md)；Tauri 桌面播放补丁见 [../impact/TTS桌面端云端播放影响.md](../impact/TTS桌面端云端播放影响.md)（实现细节见 [TTS桌面端云端播放影响.md](./TTS桌面端云端播放影响.md)）。选路历史见 [TTS播放源.md](./TTS播放源.md)、[TTS会员路由.md](./TTS会员路由.md)。

## 1. 背景与目标

- **用户诉求**：在语音设置中增加 **Microsoft Edge 在线语音**（免费、无需 API Key），并让所有登录用户（含非会员）可选 **本机 + Edge**；会员另保留 **MiniMax / 讯飞**。
- **技术债**：原先 MiniMax 与讯飞共用 `speed/vol/pitch` 三列，切换来源会互相覆盖；需拆成 **三套独立韵律字段** 并兼容旧数据。
- **产品约束**：Edge 设置区块与朗读来源选项均排在 MiniMax「云端语音设置」**之前**；非会员会员过期时 `cloud/xfyun` 来源须 clamp 回 `local`。

## 2. 改动范围

| 区域 | 路径 |
|------|------|
| 后端 Edge 服务 | `apps/backend/src/services/speech-transcription/edge-tts.service.ts`、`edge-tts-prosody.ts`、`edge-tts-voices.ts`、`dto/edge-tts.dto.ts` |
| 后端 HTTP | `speech-transcription.controller.ts`（`POST edge/speech`、`edge/speech/stream`） |
| 偏好入库 | `minimax-tts-user-config.entity.ts`、`minimax-tts-prefs.service.ts`、`upsert-minimax-tts-prefs.dto.ts` |
| 迁移 | `1782930823469-edge-tts.ts`（新列 + `edge_voice_id`；**含** `knowledge_trash.local_bindings_json` DROP，部署前须审阅） |
| 前端常量 | `apps/frontend/src/constants/edgeTts.ts` |
| 偏好类型/API | `service/cloudTtsSettings.ts`、`service/api.ts` |
| 朗读选路 | `utils/speech.ts`、`utils/minimaxTtsPrefs.ts` |
| 设置页 | `views/setting/cloudTts/index.tsx`、`PlaybackSourcePicker.tsx`、`LocalTtsVoiceSetting.tsx` |
| i18n | `i18n/locales/zh-CN.ts`、`en-US.ts` |

## 3. 实现思路

1. **后端**：用 `edge-tts-universal` 封装 `EdgeTtsService`，将用户 `speed/vol/pitch`（MiniMax 量纲）映射为 Edge SSML 的 `rate/volume/pitch` 字符串；LRU 缓存合成结果；流式接口先整段合成再 yield（与 MiniMax 首包策略一致，实现简单）。
2. **偏好模型**：实体新增 `xfyun_*`、`edge_*` 九列 + `edge_voice_id`；API 暴露 `minimaxSpeed` 等 camelCase；旧行仅有 `speed/vol/pitch` 时由 `splitLegacyProsodyFields` 一次性复制到三套字段。
3. **会员选路**：`canUseCloudPlaybackSource` — 非会员仅 `edge` 可走云端；`clampPlaybackSourceForMembership` — 非会员保存/加载时把 `cloud/xfyun` 改回 `local`。
4. **播放链路**：`startCloudTts` 按 `playbackSource` 选 endpoint 与 `build*RequestExtras()`；缓存 key 后缀按来源分函数，参数变更不与旧 MP3 混用。
5. **设置 UI**：`PlaybackSourcePicker` 会员四源、非会员两源；Edge 区块前置；各模式读写各自 prosody 字段；任意非 `local` 来源时本机音色区置灰（`LocalTtsVoiceSetting`）。
6. **权衡**：未再抽象「通用 TtsProvider」接口——三源差异小，YAGNI；Edge 无用户凭证，缓存 key 不含 Key 段。

## 4. 关键代码对比与注释

### 4.1 `shouldUseCloudTts` 与选路辅助（`apps/frontend/src/utils/speech.ts`）

**对比范围**：`isPlaybackAvailable`、`canUseCloudPlaybackSource`、`isMemberOnlyPlaybackSource`、`shouldUseCloudTts` 四个函数（完整符号）。

**改动前** · `apps/frontend/src/utils/speech.ts`（基线，约 L886–L907）

```typescript
// 对外：当前环境是否还能发起英语朗读（旧版：非会员只看本机 Web Speech）
export function isPlaybackAvailable(): boolean {
	// 非会员：不允许云端，直接看本机 TTS 是否可用
	if (!isCloudTtsAllowed()) {
		return isSpeechSupported();
	}
	// 会员：若偏好不是云端则仍可能走本机
	if (!shouldUseCloudTts()) {
		return isSpeechSupported();
	}
	// 会员且应走云端
	return true;
}

// 内部：是否应走云端合成（旧版：非会员恒 false）
function shouldUseCloudTts(
	options?: PlayPreferredOptions,
): boolean {
	// 调用方强制本机
	if (options?.preferLocal === true) return false;
	// 调用方强制云端：仅会员为 true
	if (options?.preferLocal === false) {
		return isCloudTtsAllowed();
	}
	// 非会员：永不云端
	if (!isCloudTtsAllowed()) return false;
	// 会员：playbackSource 非 local 即云端
	const prefs = loadMinimaxTtsUserPrefs();
	return prefs.playbackSource !== 'local';
}
```

**改动后** · `apps/frontend/src/utils/speech.ts`（当前，约 L894–L928）

```typescript
// 判断来源是否仅会员可用（MiniMax / 讯飞）
function isMemberOnlyPlaybackSource(source: string): boolean {
	// cloud 表示 MiniMax；xfyun 表示讯飞
	return source === 'cloud' || source === 'xfyun';
}

// 当前 playbackSource 在该用户会员状态下是否允许走云端
function canUseCloudPlaybackSource(source: string): boolean {
	// local 永远不走云端 HTTP
	if (source === 'local') return false;
	// 有效会员：local 以外均可（含 edge / cloud / xfyun）
	if (isCloudTtsAllowed()) return true;
	// 非会员：仅 Edge 免费云端
	return source === 'edge';
}

// 对外：本机或（允许的）云端任一可用即 true
export function isPlaybackAvailable(): boolean {
	// 读缓存中的 playbackSource
	const prefs = loadMinimaxTtsUserPrefs();
	// 当前来源在会员规则下可走云端
	if (canUseCloudPlaybackSource(prefs.playbackSource)) return true;
	// 兼容旧逻辑：shouldUseCloud 仍可能 true（如 preferLocal false）
	if (shouldUseCloudTts()) return true;
	// 最后回退本机 Web Speech
	return isSpeechSupported();
}

// 是否发起云端 TTS 请求（非会员 edge 为 true）
function shouldUseCloudTts(
	options?: PlayPreferredOptions,
): boolean {
	// 强制本机短路
	if (options?.preferLocal === true) return false;
	// 读用户朗读来源偏好
	const prefs = loadMinimaxTtsUserPrefs();
	const source = prefs.playbackSource;
	// local 永不云端
	if (source === 'local') return false;
	// 强制云端：按 canUse 判定（非会员仅 edge）
	if (options?.preferLocal === false) {
		return canUseCloudPlaybackSource(source);
	}
	// 会员专属源但已非会员：拒绝（防过期会员脏数据）
	if (isMemberOnlyPlaybackSource(source) && !isCloudTtsAllowed()) {
		return false;
	}
	// 默认：edge 对非会员开放，cloud/xfyun 需会员
	return canUseCloudPlaybackSource(source);
}
```

**变更摘要**：非会员可通过 `playbackSource === 'edge'` 走云端；会员过期时 `cloud/xfyun` 不再误走付费云端。

---

### 4.2 `startCloudTts`（`apps/frontend/src/utils/speech.ts`）

**对比范围**：`startCloudTts` 全函数（摘录：自 token 校验至 return）。

**改动前** · `apps/frontend/src/utils/speech.ts`（基线，约 L1034–L1076）

```typescript
// 发起云端 TTS；旧版仅 MiniMax / 讯飞两路
async function startCloudTts(plain: string): Promise<CloudTtsReady> {
	// 确保偏好已从服务端加载
	await ensureMinimaxTtsUserPrefsLoaded();
	// 计算 LRU 缓存键
	const cacheKey = buildCloudTtsCacheKey(plain);
	// 命中前端 MP3 缓存则直接返回 Blob
	const cached = getCloudTtsFromCache(plain);
	if (cached) {
		return { kind: 'cached', blob: cached, cacheKey };
	}
	// JWT 缺失则抛错，上层降级本机
	const token = readToken();
	if (!token) {
		throw new Error('NO_TOKEN');
	}
	// Tauri / 浏览器统一 fetch
	const platformFetch = await getPlatformFetch();
	// 鉴权与 JSON 头
	const headers = {
		Authorization: `Bearer ${token}`,
		'Content-Type': 'application/json',
	};
	// 当前朗读来源
	const prefs = loadMinimaxTtsUserPrefs();
	const source = prefs.playbackSource;
	// POST：xfyun 或 minimax 二选一
	const res = await platformFetch(
		BASE_URL +
			(source === 'xfyun'
				? SPEECH_XFYUN_TTS_STREAM
				: SPEECH_MINIMAX_TTS_STREAM),
		{
			method: 'POST',
			headers,
			body: JSON.stringify(
				source === 'xfyun'
					? { text: plain, ...buildXfyunTtsRequestExtras() }
					: { text: plain, ...buildMinimaxTtsRequestExtras() },
			),
		},
	);
	// HTTP 非 2xx：抛错触发本机回退
	if (!res.ok) {
		throw new Error(`TTS_HTTP_${res.status}`);
	}
	// 流式 body 由 playCloudTts 消费
	return { kind: 'live', response: res, cacheKey };
}
```

**改动后** · `apps/frontend/src/utils/speech.ts`（当前，约 L1054–L1098）

```typescript
// 发起云端 TTS；新版按 playbackSource 三路分流
async function startCloudTts(plain: string): Promise<CloudTtsReady> {
	// 拉取/迁移账号偏好
	await ensureMinimaxTtsUserPrefsLoaded();
	// 缓存键含来源后缀（edge/minimax/xfyun 各自 extras）
	const cacheKey = buildCloudTtsCacheKey(plain);
	const cached = getCloudTtsFromCache(plain);
	if (cached) {
		return { kind: 'cached', blob: cached, cacheKey };
	}
	const token = readToken();
	if (!token) {
		throw new Error('NO_TOKEN');
	}
	const platformFetch = await getPlatformFetch();
	const headers = {
		Authorization: `Bearer ${token}`,
		'Content-Type': 'application/json',
	};
	const prefs = loadMinimaxTtsUserPrefs();
	const source = prefs.playbackSource;
	// 三元选择 stream endpoint
	const endpoint =
		source === 'xfyun'
			? SPEECH_XFYUN_TTS_STREAM
			: source === 'edge'
				? SPEECH_EDGE_TTS_STREAM
				: SPEECH_MINIMAX_TTS_STREAM;
	// 与 endpoint 配套的 body 扩展字段
	const bodyExtras =
		source === 'xfyun'
			? buildXfyunTtsRequestExtras()
			: source === 'edge'
				? buildEdgeTtsRequestExtras()
				: buildMinimaxTtsRequestExtras();
	const res = await platformFetch(BASE_URL + endpoint, {
		method: 'POST',
		headers,
		body: JSON.stringify({ text: plain, ...bodyExtras }),
	});
	if (!res.ok) {
		throw new Error(`TTS_HTTP_${res.status}`);
	}
	return { kind: 'live', response: res, cacheKey };
}
```

**变更摘要**：新增 `SPEECH_EDGE_TTS_STREAM` 与 `buildEdgeTtsRequestExtras()`；endpoint/body 由嵌套三元统一维护。

---

### 4.3 `buildMinimaxTtsRequestExtras` / `buildXfyunTtsRequestExtras`（`apps/frontend/src/utils/minimaxTtsPrefs.ts`）

**对比范围**：两个 export 函数完整定义。

**改动前** · `apps/frontend/src/utils/minimaxTtsPrefs.ts`（基线，约 L307–L339）

```typescript
// MiniMax POST 扩展：旧版读共用 speed/vol/pitch
export function buildMinimaxTtsRequestExtras(): Record<string, unknown> {
	const prefs = loadMinimaxTtsUserPrefs();
	// 未开启自定义参数则空 body（服务端默认）
	if (!prefs.enabled) return {};
	const body: Record<string, unknown> = {
		model: prefs.model,
		voiceId: prefs.voiceId,
		speed: prefs.speed,
		vol: prefs.vol,
		pitch: prefs.pitch,
		format: prefs.format,
		sampleRate: prefs.sampleRate,
		bitrate: prefs.bitrate,
		channel: prefs.channel,
	};
	if (prefs.emotion) body.emotion = prefs.emotion;
	if (prefs.languageBoost) body.languageBoost = prefs.languageBoost;
	return body;
}

// 讯飞 POST 扩展：从共用字段映射到 0–100
export function buildXfyunTtsRequestExtras(): Record<string, unknown> {
	const prefs = loadMinimaxTtsUserPrefs();
	const vcn = isXfyunTtsVcn(prefs.xfyunVoiceId)
		? prefs.xfyunVoiceId
		: DEFAULT_XFYUN_TTS_VCN;
	return {
		vcn,
		speed: xfyunSpeedFromMinimaxSpeed(prefs.speed),
		volume: xfyunVolumeFromVol(prefs.vol),
		pitch: xfyunPitchFromPitch(prefs.pitch),
	};
}
```

**改动后** · `apps/frontend/src/utils/minimaxTtsPrefs.ts`（当前，约 L376–L408）

```typescript
// MiniMax POST 扩展：读 minimaxSpeed/Vol/Pitch 独立字段
export function buildMinimaxTtsRequestExtras(): Record<string, unknown> {
	const prefs = loadMinimaxTtsUserPrefs();
	if (!prefs.enabled) return {};
	const body: Record<string, unknown> = {
		model: prefs.model,
		voiceId: prefs.voiceId,
		speed: prefs.minimaxSpeed,
		vol: prefs.minimaxVol,
		pitch: prefs.minimaxPitch,
		format: prefs.format,
		sampleRate: prefs.sampleRate,
		bitrate: prefs.bitrate,
		channel: prefs.channel,
	};
	if (prefs.emotion) body.emotion = prefs.emotion;
	if (prefs.languageBoost) body.languageBoost = prefs.languageBoost;
	return body;
}

// 讯飞 POST 扩展：读 xfyunSpeed/Volume/Pitch，不再从 MiniMax 映射
export function buildXfyunTtsRequestExtras(): Record<string, unknown> {
	const prefs = loadMinimaxTtsUserPrefs();
	const vcn = isXfyunTtsVcn(prefs.xfyunVoiceId)
		? prefs.xfyunVoiceId
		: DEFAULT_XFYUN_TTS_VCN;
	return {
		vcn,
		speed: Math.round(prefs.xfyunSpeed),
		volume: Math.round(prefs.xfyunVolume),
		pitch: prefs.xfyunPitch,
	};
}
```

**变更摘要**：韵律字段按模式隔离；讯飞不再实时从 MiniMax 量纲换算。

---

### 4.4 纯新增：`buildEdgeTtsRequestExtras`、`clampPlaybackSourceForMembership`、`splitLegacyProsodyFields`

**说明**：基线不存在，仅贴**改动后**完整符号（`code-before-after.md` §4 纯新增例外）。

**改动后** · `apps/frontend/src/utils/minimaxTtsPrefs.ts` · `splitLegacyProsodyFields`（约 L125–L148）

```typescript
// 旧账号仅有 speed/vol/pitch 时复制到三套独立字段
function splitLegacyProsodyFields(
	prefs: MinimaxTtsUserPrefs,
	raw: Record<string, unknown>,
): MinimaxTtsUserPrefs {
	// 请求体已含任一新模式字段则跳过迁移
	const hasNewProsody =
		'minimaxSpeed' in raw || 'xfyunSpeed' in raw || 'edgeSpeed' in raw;
	if (hasNewProsody) return prefs;
	// 从 legacy 列读取并 clamp
	const legacySpeed = clampNumber(raw.speed, 0.5, 2, 1);
	const legacyVol = clampNumber(raw.vol, 0.01, 10, 5);
	const legacyPitch = Math.round(clampNumber(raw.pitch, -12, 12, 0));
	return {
		...prefs,
		minimaxSpeed: legacySpeed,
		minimaxVol: legacyVol,
		minimaxPitch: legacyPitch,
		xfyunSpeed: xfyunSpeedFromMinimaxSpeed(legacySpeed),
		xfyunVolume: xfyunVolumeFromVol(legacyVol),
		xfyunPitch: xfyunPitchFromPitch(legacyPitch),
		edgeSpeed: legacySpeed,
		edgeVol: legacyVol,
		edgePitch: legacyPitch,
	};
}
```

**改动后** · `apps/frontend/src/utils/minimaxTtsPrefs.ts` · `clampPlaybackSourceForMembership`（约 L219–L229）

```typescript
// 非会员禁止 cloud/xfyun；会员原样返回
export function clampPlaybackSourceForMembership(
	prefs: MinimaxTtsUserPrefs,
	isMemberActive: boolean,
): MinimaxTtsUserPrefs {
	if (isMemberActive) return prefs;
	if (prefs.playbackSource === 'cloud' || prefs.playbackSource === 'xfyun') {
		return { ...prefs, playbackSource: 'local' };
	}
	return prefs;
}
```

**改动后** · `apps/frontend/src/utils/minimaxTtsPrefs.ts` · `buildEdgeTtsRequestExtras`（约 L429–L441）

```typescript
// Edge POST 扩展：voice + edge 专用 prosody
export function buildEdgeTtsRequestExtras(): Record<string, unknown> {
	const prefs = loadMinimaxTtsUserPrefs();
	const voice = isEdgeTtsVoiceId(prefs.edgeVoiceId)
		? prefs.edgeVoiceId
		: DEFAULT_EDGE_TTS_VOICE;
	return {
		voice,
		speed: prefs.edgeSpeed,
		vol: prefs.edgeVol,
		pitch: prefs.edgePitch,
	};
}
```

---

### 4.5 `PlaybackSourcePicker` 选项列表（`apps/frontend/src/views/setting/cloudTts/PlaybackSourcePicker.tsx`）

**对比范围**：模块级 `SOURCES` / `MEMBER_SOURCES` 常量、组件 props 与 `sources` 派生（JSX 渲染结构未改，故不重复贴出）。

**改动前** · `apps/frontend/src/views/setting/cloudTts/PlaybackSourcePicker.tsx`（基线，约 L7–L22）

```typescript
// 旧版固定三源：无 Edge，且无会员区分
const SOURCES: TtsPlaybackSource[] = ['local', 'cloud', 'xfyun'];

// 朗读来源单选组件
export function PlaybackSourcePicker({
	// 当前选中来源
	value,
	// 切换回调
	onChange,
	// 整组禁用（未登录等）
	disabled,
}: {
	value: TtsPlaybackSource;
	onChange: (source: TtsPlaybackSource) => void;
	disabled?: boolean;
}) {
	// i18n 文案
	const { t } = useI18n();
	// ...（未改动）RadioGroup 始终 map SOURCES
}
```

**改动后** · `apps/frontend/src/views/setting/cloudTts/PlaybackSourcePicker.tsx`（当前，约 L7–L23）

```typescript
// 会员可见四源：本机 + Edge + MiniMax + 讯飞
const MEMBER_SOURCES: TtsPlaybackSource[] = ['local', 'edge', 'cloud', 'xfyun'];
// 非会员仅两源：本机 + Edge
const FREE_SOURCES: TtsPlaybackSource[] = ['local', 'edge'];

// 朗读来源单选组件（新增 isMemberActive）
export function PlaybackSourcePicker({
	value,
	onChange,
	disabled,
	// 是否有效会员，决定选项列表与帮助文案 key
	isMemberActive = false,
}: {
	value: TtsPlaybackSource;
	onChange: (source: TtsPlaybackSource) => void;
	disabled?: boolean;
	isMemberActive?: boolean;
}) {
	const { t } = useI18n();
	// 按会员状态选择 MEMBER_SOURCES 或 FREE_SOURCES
	const sources = isMemberActive ? MEMBER_SOURCES : FREE_SOURCES;
	// ...（未改动）RadioGroup map sources；帮助文案 key 按 isMemberActive 分支
}
```

**变更摘要**：新增 `edge`；非会员也显示 picker（两选项）；帮助文案分 `playbackSourceHelp` / `playbackSourceHelpFree`。

---

### 4.6 `EdgeTtsService.resolveOptions`（`apps/backend/src/services/speech-transcription/edge-tts.service.ts`）

**说明**：新文件，纯新增。

**改动后** · `apps/backend/src/services/speech-transcription/edge-tts.service.ts`（约 L29–L52）

```typescript
// 校验 DTO 并解析为 EdgeTTS 构造函数参数
resolveOptions(dto: EdgeTtsDto): EdgeTtsResolved {
	// 去首尾空白
	const text = dto.text.trim();
	if (!text) {
		throw new HttpException('朗读文本为空', HttpStatus.BAD_REQUEST);
	}
	// UTF-8 字节上限（与 MiniMax 对齐量级）
	const bytes = new TextEncoder().encode(text);
	if (bytes.length > TTS_INPUT_MAX_BYTES) {
		throw new HttpException(
			`朗读文本超过 Edge TTS 单次上限（${TTS_INPUT_MAX_BYTES} 字节）`,
			HttpStatus.BAD_REQUEST,
		);
	}
	// 发音人默认云希等
	const voice = dto.voice?.trim() || DEFAULT_EDGE_TTS_VOICE;
	const speed = dto.speed ?? 1;
	const vol = dto.vol ?? 5;
	const pitch = dto.pitch ?? 0;
	return {
		text,
		voice,
		rate: edgeRateFromSpeed(speed),
		volume: edgeVolumeFromVol(vol),
		pitch: edgePitchFromPitch(pitch),
	};
}
```

## 5. 兼容性与影响

| 项 | 说明 |
|----|------|
| 旧偏好 | 仅有 `speed/vol/pitch` 的行经 `splitLegacyProsodyFields` 复制到三套字段；PUT 需带齐新字段（前后端同批发布） |
| 非会员 | 可选 `edge`；若 DB 仍存 `cloud/xfyun`，加载时 clamp 为 `local` |
| 迁移风险 | `1782930823469` 顺带 DROP `knowledge_trash.local_bindings_json`，与 TTS 无关，部署前确认 |
| 缓存 | 各源独立 cache suffix；切换来源或 prosody 不会播放旧 MP3 |

**建议回归**：非会员选 Edge 试听与英语学习喇叭；会员四源切换；改 MiniMax 语速不影响讯飞；会员过期后来源与播放；长文分段 + Edge；迁移后旧账号 prosody。

## 6. 相关源码路径

| 说明 | 路径 |
|------|------|
| Edge 合成服务 | `apps/backend/src/services/speech-transcription/edge-tts.service.ts` |
| 偏好实体 | `apps/backend/src/services/speech-transcription/minimax-tts-user-config.entity.ts` |
| 播放选路 | `apps/frontend/src/utils/speech.ts` |
| 偏好工具 | `apps/frontend/src/utils/minimaxTtsPrefs.ts` |
| 设置页 | `apps/frontend/src/views/setting/cloudTts/index.tsx` |
| Edge 发音人表 | `apps/frontend/src/constants/edgeTts.ts` |
| 影响点 | `docs/impact/云端TTS边缘韵律会员影响.md` |

---

（若与仓库最新源码不一致，以源码为准）
