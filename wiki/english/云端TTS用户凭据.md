# 云端 TTS 用户凭证与失败降级 — 实现说明

## 延伸阅读

- [云端TTS设置.md](./云端TTS设置.md) — 设置页结构与偏好同步（部分字段描述待补）
- [讯飞云TTS.md](../ideas/tts/讯飞云TTS.md) — 讯飞 WS 合成与参数映射
- [云端TTS偏好数据库.md](./云端TTS偏好数据库.md) — 偏好表 API
- [云端TTS用户凭据回退影响.md](../impact/云端TTS用户凭据回退影响.md) — **影响面与回归清单**

---

## 1. 背景与目标

### 1.1 问题

| 维度 | 改前 | 改后 |
|------|------|------|
| 云端凭证 | 仅服务端 `.env`（`MINIMAX_API_KEY`、`XFYUN_*`） | 会员可在 **语音设置** 填写 **MiniMax API Key**、**讯飞 APPID/Key/Secret**，入库 `minimax_tts_user_config` |
| 讯飞 / MiniMax 音色 | 共用 `voiceId` 列，切换来源互转 | **`xfyunVoiceId` 独立列**；旧 vcn 混存时 `splitLegacyVoiceStorage` 拆分 |
| 讯飞 HTTP 失败 | `503/401/502` 时二次请求硅基 `SPEECH_TTS` | **不再中转硅基**；`playPreferred` catch 统一 **Toast + 本机 Web Speech** |
| 失败感知 | 听书 hook 单独 Toast `unsupported` | `notifyCloudTtsFallback` 区分讯飞/MiniMax；12s 冷却；`cloudTtsNotified` 防重复 |
| 设置页 UI | 模型下拉枚举；无凭证输入 | **API Key / 模型文本框**；讯飞凭证区；字段说明移至标题旁 |
| 前端 MP3 缓存 | key = userId + 参数 JSON | 追加 **凭证摘要**；保存前乐观 `setCache` |
| env 预填 | 曾从 `VITE_XFYUN_*` 预填 | **凭证不预填**；仅 `VITE_MINIMAX_MODEL_NAME` 作模型默认 |

### 1.2 核心决策

1. **凭证完整性门槛**：讯飞须 APPID+Key+Secret **三项齐**才用用户凭证；MiniMax 仅 Key 非空即用。
2. **降级链收敛**：云端失败 → Toast → 本机（若支持）；不再讯飞失败后 硅基→ 本机多级隐式切换。
3. **音色字段拆分**：避免切讯飞清空 MiniMax 音色；请求体 `buildXfyunTtsRequestExtras` 读 `xfyunVoiceId`。
4. **模型白名单放宽**：后端 DTO `@MaxLength(64)` 字符串，与设置页文本框一致。

---

## 2. 改动范围

| 路径 | 职责 |
|------|------|
| `apps/backend/.../minimax-tts-user-config.entity.ts` | 新列 `xfyun_voice_id`、`xfyun_*`、`minimax_api_key` |
| `apps/backend/.../minimax-tts-prefs.service.ts` | `getMinimaxApiKey` / `getXfyunCredentials` |
| `apps/backend/.../minimax-tts.service.ts` | 合成时 `resolveCredentials(userId)` |
| `apps/backend/.../xfyun-tts.service.ts` | 用户凭证 + 缓存 `credTag` |
| `apps/backend/src/migrations/1782717199169-xunfei_voice_id.ts` | 建表含讯飞列 |
| `apps/backend/src/migrations/1782718851939-minimax.ts` | 补 `minimax_api_key` |
| `apps/frontend/src/constants/minimaxTts.ts` | `getDefaultMinimaxCloudCredentials` |
| `apps/frontend/src/constants/xfyunTts.ts` | 凭证默认空、`fillXfyunCredentialsFromEnv` 原样返回 |
| `apps/frontend/src/utils/minimaxTtsPrefs.ts` | 归一化、cache key、乐观保存 |
| `apps/frontend/src/utils/speech.ts` | Toast、移除硅基中转 |
| `apps/frontend/src/views/setting/cloudTts/index.tsx` | 凭证 UI、布局 |
| `apps/frontend/src/views/ebook/hooks/useEpubChapterListen.ts` | `cloudTtsNotified` 去重 |
| `apps/frontend/src/views/ebook/hooks/useEbookQuoteListen.ts` | 同上 |

---

## 3. 实现思路

### 3.1 数据流

```mermaid
flowchart LR
  UI[设置页 cloudTts/index]
  PUT[PUT /settings/cloud-tts]
  DB[(minimax_tts_user_config)]
  MEM[前端 cachedPrefs]
  TTS[playPreferred]
  API[POST minimax|xfyun/speech/stream]
  PREFS[MinimaxTtsPrefsService]
  UI --> PUT --> DB
  PUT --> MEM
  TTS --> MEM
  TTS --> API
  API --> PREFS
  PREFS -->|用户 Key 齐| DB
  PREFS -->|空| ENV[服务端 .env]
```

### 3.2 凭证解析规则

| 来源 | 条件 | 实际使用 |
|------|------|----------|
| MiniMax | `minimaxApiKey` 非空 | 用户 Key |
| MiniMax | Key 空 | `MINIMAX_API_KEY` |
| 讯飞 | APPID+Key+Secret 均非空 | 用户三项 |
| 讯飞 | 任一项空 | `XFYUN_*` env |

### 3.3 失败降级时序

1. `playCloudTtsCadenceSegments` / `startCloudTts` 抛错（HTTP 非 2xx 等）。
2. `playPreferred` catch → `notifyCloudTtsFallback(canFallbackLocal)`。
3. 若本机 TTS 可用 → warning Toast + `speakTextWithGeneration`。
4. 否则 → error Toast + `throwNoTts({ cloudTtsNotified: true })`。
5. 听书 hook catch 见 `cloudTtsNotified` 则 **不再** 弹 `unsupported`。

---

## 4. 关键代码对比与注释

### 4.1 `notifyCloudTtsFallback`（`apps/frontend/src/utils/speech.ts`）

**对比范围**：纯新增符号（改动前无此函数）。

**改动后** · `apps/frontend/src/utils/speech.ts`（当前，约 L486–L523）

```typescript
// 模块级变量：记录上次弹出云端失败 Toast 的时间戳（毫秒）
let lastCloudTtsErrorToastAt = 0;
// 常量：同一会话内两次 Toast 的最小间隔 12 秒，避免听书逐句失败刷屏
const CLOUD_TTS_ERROR_TOAST_COOLDOWN_MS = 12_000;

// 扩展 Error 类型，标记是否已由 speech 弹过 Toast
type NoTtsError = Error & { cloudTtsNotified?: boolean };

// 构造 NO_TTS 错误并可附带 cloudTtsNotified 标记
function throwNoTts(opts?: { cloudTtsNotified?: boolean }): never {
	// 标准 NO_TTS 错误对象，供上层 catch 识别
	const err = new Error('NO_TTS') as NoTtsError;
	// 若已通知用户则写入标记，听书 hook 可跳过重复 Toast
	if (opts?.cloudTtsNotified) err.cloudTtsNotified = true;
	// 以 never 返回类型抛出，中断当前播放流程
	throw err;
}

// 云端 TTS 失败时统一 Toast（试听/听书/单词朗读等共用）
function notifyCloudTtsFallback(canFallbackLocal: boolean): void {
	// 当前时间，用于冷却判断
	const now = Date.now();
	// 冷却期内直接返回，不再弹 Toast
	if (now - lastCloudTtsErrorToastAt < CLOUD_TTS_ERROR_TOAST_COOLDOWN_MS) return;
	// 更新上次 Toast 时间
	lastCloudTtsErrorToastAt = now;

	// 读取当前朗读来源，决定 Toast 标题用讯飞还是 MiniMax 文案
	const source = loadMinimaxTtsUserPrefs().playbackSource;
	// 按来源选择 i18n key
	const titleKey =
		source === 'xfyun'
			? 'englishLearning.tts.cloudXfyunFailed'
			: 'englishLearning.tts.cloudMinimaxFailed';

	// 本机 Web Speech 可用时：warning + 已改用本机朗读说明
	if (canFallbackLocal) {
		Toast({
			type: 'warning',
			title: translateSync(titleKey),
			message: translateSync('englishLearning.tts.cloudFallbackLocal'),
		});
		// 已展示 Toast，结束函数
		return;
	}
	// 本机也不可用：error + 播放不可用通用文案
	Toast({
		type: 'error',
		title: translateSync(titleKey),
		message: translateSync('englishLearning.tts.unsupported'),
	});
}
```

**变更摘要**：新增统一 Toast；标题区分讯飞/MiniMax；12s 冷却由 `stopAllPlayback` 重置。

---

### 4.2 `playPreferred` 云端 catch（`apps/frontend/src/utils/speech.ts`）

**对比范围**：云端 try/catch 分支全文。

**改动前** · `apps/frontend/src/utils/speech.ts`（基线，约 L1412–L1425）

```typescript
	// 云端优先路径，根据用户偏好及能力优先尝试云端；失败兜底本地
	try {
		// 调用云端 TTS 分段朗读，透传 cadence 钩子与用户参数
		await playCloudTtsCadenceSegments(plain, generation, {
			...cadenceHooks,
			rate: speakOpts?.rate,
		});
		return;
	} catch {
		// 云端朗读出错时，二次校验世代有效性
		if (!isPlaybackGenerationActive(generation)) return;
		// 若本地没有 TTS 可用，也抛 NO_TTS 错
		if (!isSpeechSupported()) {
			throw new Error('NO_TTS');
		}
		// 回退本地朗读，参数同前
		await speakTextWithGeneration(rawText, generation, {
			...speakOpts,
			...cadenceHooks,
		});
	}
```

**改动后** · `apps/frontend/src/utils/speech.ts`（当前，约 L1443–L1463）

```typescript
	// 云端优先路径，根据用户偏好及能力优先尝试云端；失败兜底本地
	try {
		// 调用云端 TTS 分段朗读，透传 cadence 钩子与用户参数
		await playCloudTtsCadenceSegments(plain, generation, {
			...cadenceHooks,
			rate: speakOpts?.rate,
		});
		return;
	} catch {
		// 判断是否可回退本机 Web Speech
		const canFallbackLocal = isSpeechSupported();
		// 统一弹出云端失败 Toast（含冷却）
		notifyCloudTtsFallback(canFallbackLocal);
		// 播放世代已失效则不再继续
		if (!isPlaybackGenerationActive(generation)) return;
		// 本机不可用时抛 NO_TTS 并标记已 Toast
		if (!canFallbackLocal) {
			throwNoTts({ cloudTtsNotified: true });
		}
		// 回退本地朗读，参数同前
		await speakTextWithGeneration(rawText, generation, {
			...speakOpts,
			...cadenceHooks,
		});
	}
```

**变更摘要**：catch 内先 Toast 再降级；本机不可用时用 `throwNoTts` 携带 `cloudTtsNotified`。

---

### 4.3 `startCloudTts` 移除硅基中转（`apps/frontend/src/utils/speech.ts`）

**对比范围**：`platformFetch` 后至 `return { kind: 'live' ...` 段。

**改动前** · `apps/frontend/src/utils/speech.ts`（基线，约 L1020–L1040）

```typescript
	const prefs = loadMinimaxTtsUserPrefs();
	const source = prefs.playbackSource;
	let res = await platformFetch(
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

	if (res.status === 503 || res.status === 401 || res.status === 502) {
		res = await platformFetch(BASE_URL + SPEECH_TTS, {
			method: 'POST',
			headers,
			body: JSON.stringify({ text: plain }),
		});
	}

	if (!res.ok) {
		throw new Error(`TTS_HTTP_${res.status}`);
	}

	return { kind: 'live', response: res, cacheKey };
```

**改动后** · `apps/frontend/src/utils/speech.ts`（当前，约 L1052–L1075）

```typescript
	const prefs = loadMinimaxTtsUserPrefs();
	const source = prefs.playbackSource;
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

	// ponytail: 云端失败不中转硅基/MiniMax；由 playPreferred catch 统一降级本机 Web Speech
	if (!res.ok) {
		throw new Error(`TTS_HTTP_${res.status}`);
	}

	return { kind: 'live', response: res, cacheKey };
```

**变更摘要**：删除 `SPEECH_TTS` 二次请求；`let res` 改 `const res`；失败直接抛错交上层 Toast。

---

### 4.4 `getXfyunCredentials`（`apps/backend/.../minimax-tts-prefs.service.ts`）

**对比范围**：纯新增方法。

**改动后** · `apps/backend/src/services/speech-transcription/minimax-tts-prefs.service.ts`（当前，约 L123–L137）

```typescript
	/** 用户三项均填写时返回自定义讯飞凭证，否则 null（TTS 走环境变量） */
	async getXfyunCredentials(
		userId?: number,
	): Promise<{ appId: string; apiKey: string; apiSecret: string } | null> {
		// 未登录或非法 userId 不使用用户凭证
		if (userId == null || !Number.isFinite(userId) || userId <= 0) {
			return null;
		}
		// 按 userId 查偏好行
		const row = await this.repo.findOne({ where: { userId } });
		// 无记录则回退 env
		if (!row) return null;
		// 裁剪空白后的 APPID
		const appId = this.trimCredential(row.xfyunAppId);
		// 裁剪空白后的 API Key
		const apiKey = this.trimCredential(row.xfyunApiKey);
		// 裁剪空白后的 API Secret
		const apiSecret = this.trimCredential(row.xfyunApiSecret);
		// 任一项为空则视为未配置用户凭证
		if (!appId || !apiKey || !apiSecret) return null;
		// 三项齐全，返回用户讯飞应用凭证
		return { appId, apiKey, apiSecret };
	}
```

**变更摘要**：后端合成前异步读取；与 `getMinimaxApiKey` 对称。

---

### 4.5 `buildXfyunTtsRequestExtras` / cache key（`apps/frontend/src/utils/minimaxTtsPrefs.ts`）

**对比范围**：讯飞请求 extras 与 `buildXfyunTtsCacheKeySuffix` 全函数。

**改动前** · `apps/frontend/src/utils/minimaxTtsPrefs.ts`（基线，约 L291–L318）

```typescript
/** 讯飞在线合成 POST body（不含 text）；与 MiniMax 共用 vol/pitch/speed 字段，此处映射到 0–100 */
export function buildXfyunTtsRequestExtras(): Record<string, unknown> {
	const prefs = loadMinimaxTtsUserPrefs();
	const vcn = isXfyunTtsVcn(prefs.voiceId)
		? prefs.voiceId
		: DEFAULT_XFYUN_TTS_VCN;
	return {
		vcn,
		speed: xfyunSpeedFromMinimaxSpeed(prefs.speed),
		volume: xfyunVolumeFromVol(prefs.vol),
		pitch: xfyunPitchFromPitch(prefs.pitch),
	};
}

/** 前端 MP3 缓存 key 后缀：讯飞 vcn / 语速变更后不与旧缓存混用 */
export function buildXfyunTtsCacheKeySuffix(): string {
	const userId = getLoggedInUserId();
	const userPart = userId > 0 ? String(userId) : '0';
	return `${userPart}\u0001${JSON.stringify(buildXfyunTtsRequestExtras())}`;
}
```

**改动后** · `apps/frontend/src/utils/minimaxTtsPrefs.ts`（当前，约 L333–L364）

```typescript
/** 讯飞在线合成 POST body（不含 text）；与 MiniMax 共用 vol/pitch/speed 字段，此处映射到 0–100 */
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

/** 前端 MP3 缓存 key 后缀：讯飞凭证 / vcn / 语速等变更后不与旧缓存混用 */
export function buildXfyunTtsCacheKeySuffix(): string {
	const prefs = loadMinimaxTtsUserPrefs();
	const userId = getLoggedInUserId();
	const userPart = userId > 0 ? String(userId) : '0';
	const creds = `${prefs.xfyunAppId.trim()}\u0002${prefs.xfyunApiKey.trim()}\u0002${prefs.xfyunApiSecret.trim()}`;
	return `${userPart}\u0001${creds}\u0001${JSON.stringify(buildXfyunTtsRequestExtras())}`;
}

/** 前端 MP3 缓存 key 后缀：自定义参数 / 凭证变更后不与旧缓存混用 */
export function buildMinimaxTtsCacheKeySuffix(): string {
	const prefs = loadMinimaxTtsUserPrefs();
	if (!prefs.enabled) return '';
	const userId = getLoggedInUserId();
	const userPart = userId > 0 ? String(userId) : '0';
	const creds = prefs.minimaxApiKey.trim();
	return `${userPart}\u0001${creds}\u0001${JSON.stringify(buildMinimaxTtsRequestExtras())}`;
}
```

**变更摘要**：vcn 改读 `xfyunVoiceId`；cache key 插入凭证摘要段；MiniMax cache 同样含 `minimaxApiKey`。

---

### 4.6 听书 hook Toast 去重（`useEpubChapterListen.ts`）

**对比范围**：逐句 `playPreferred` 的 catch 块。

**改动前** · `apps/frontend/src/views/ebook/hooks/useEpubChapterListen.ts`（基线）

```typescript
				} catch {
					// 若 TTS 播放失败，弹出提示（如不支持的语言或接口出错）
					if (isGenActive(gen)) {
						Toast({
							type: 'warning',
							title: tRef.current('englishLearning.tts.unsupported'),
```

**改动后** · `apps/frontend/src/views/ebook/hooks/useEpubChapterListen.ts`（当前）

```typescript
				} catch (err) {
					if (
						isGenActive(gen) &&
						!(err as { cloudTtsNotified?: boolean }).cloudTtsNotified
					) {
						Toast({
							type: 'warning',
							title: tRef.current('englishLearning.tts.unsupported'),
```

**变更摘要**：`speech` 已 Toast 时跳过 hook 层 `unsupported`，避免双重提示。`useEbookQuoteListen.ts` 同改。

---

## 5. 兼容性与影响

| 项 | 说明 |
|----|------|
| **部署** | 须执行迁移 `1782717199169`、`1782718851939`（及清理空 stub 迁移） |
| **旧数据** | `splitLegacyVoiceStorage` 兼容 `voiceId` 存 vcn 的历史 |
| **凭证留空** | 与改前一致，走服务端 env |
| **破坏性** | 讯飞失败不再自动硅基；用户可能仅听到本机音色 |
| **API** | `UpsertMinimaxTtsPrefsDto` 增字段；`model` 不再枚举限制 |

---

## 6. 相关源码路径

| 说明 | 路径 |
|------|------|
| 统一 Toast 与降级 | `apps/frontend/src/utils/speech.ts` |
| 偏好与 cache key | `apps/frontend/src/utils/minimaxTtsPrefs.ts` |
| 设置页 UI | `apps/frontend/src/views/setting/cloudTts/index.tsx` |
| 后端凭证读取 | `apps/backend/src/services/speech-transcription/minimax-tts-prefs.service.ts` |
| 讯飞合成 | `apps/backend/src/services/speech-transcription/xfyun-tts.service.ts` |
| 影响面文档 | `docs/impact/云端TTS用户凭据回退影响.md` |

---

（若与仓库最新源码不一致，以源码为准）
