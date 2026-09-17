# MiniMax 模型默认、白名单与设置页 Combobox

## 延伸阅读

- [../impact/云端TTS MiniMax模型设置影响.md](../impact/云端TTS MiniMax模型设置影响.md) — 回归矩阵与破坏性变更说明
- [云端TTS设置.md](./云端TTS设置.md) — 设置页整体结构（本文仅增量 model 相关）
- [MiniMax云端TTS.md](./MiniMax云端TTS.md) — T2A 全链路（§ 中 8 项 model 描述可能滞后）

**文档角色**：本轮 diff 的实现说明；影响面见 Influence-point 姊妹文。

## 1. 背景与目标

**用户视角**：设置页 MiniMax「模型」应与大模型设置一致——可输入也可选预设；默认更快、更经济的 `speech-2.8-turbo`；仅保留 2.8 系列两项合法 model。

**技术问题**：

1. 前端 `normalizeMinimaxTtsUserPrefs` 用 8 项白名单 **静默** 把用户输入（如 `speech-2.8-hd111`）改回默认，导致保存后请求仍带旧 model。
2. 前后端默认均为 `speech-2.8-hd`，与产品期望的 turbo 默认不一致。
3. 模型字段为纯文本框，无预设下拉，体验与大模型页不一致。

**本轮不改**：MP3 LRU 缓存 key 逻辑、试听 skip 缓存、speech 括号/本机 settle 等无关 diff。

## 2. 改动范围

| 层级 | 路径 |
|------|------|
| 前端常量 | `apps/frontend/src/constants/minimaxTts.ts` |
| 前端 normalize | `apps/frontend/src/utils/minimaxTtsPrefs.ts` |
| 设置页 UI | `apps/frontend/src/views/setting/cloudTts/index.tsx` |
| i18n | `apps/frontend/src/i18n/locales/zh-CN.ts`、`en-US.ts` |
| 后端白名单模块 | `apps/backend/src/services/speech-transcription/minimax-tts-models.ts`（新增） |
| DTO | `dto/minimax-tts.dto.ts`、`dto/upsert-minimax-tts-prefs.dto.ts` |
| 合成 / 偏好 | `minimax-tts.service.ts`、`minimax-tts-prefs.service.ts` |
| 实体默认 | `minimax-tts-user-config.entity.ts` |
| 配置注释 | `apps/backend/src/enum/config.enum.ts` |

## 3. 实现思路

1. **单一白名单源**：后端新增 `minimax-tts-models.ts`；前端 `MINIMAX_TTS_MODELS` 与之对齐，仅 `speech-2.8-hd`、`speech-2.8-turbo`。
2. **校验边界在后端**：`MinimaxTtsDto` / `UpsertMinimaxTtsPrefsDto` 对 `model` 加 `@IsIn([...MINIMAX_TTS_MODELS])`；非法值返回 400，不再前端静默改写。
3. **normalize 原样保留 model**：`pickString` 截断长度后写入 prefs，不做 includes 回落；注释说明后端 DTO 负责校验。
4. **默认 turbo**：`DEFAULT_MINIMAX_TTS_MODEL`、DB 列默认、`DEFAULT_MINIMAX_TTS_PREFS`、`resolveOptions` 环境变量回落均指向 `speech-2.8-turbo`。
5. **设置页 UX**：`PrefTextField` → `CreatableCombobox` + `minimaxModelOptions`（两项 i18n 标签）；与大模型页同一组件模式。
6. **破坏性**：DB 中仍存 2.6 / 02 / 01 等旧 model 的用户，保存或合成时将收到 400，需改为 hd 或 turbo。

## 4. 关键代码对比与注释

### 4.1 `MINIMAX_TTS_MODELS` 与 `DEFAULT_MINIMAX_TTS_MODEL`（`apps/frontend/src/constants/minimaxTts.ts`）

**对比范围**：文件顶部 model 常量块（摘录）。

**改动前** · `apps/frontend/src/constants/minimaxTts.ts`（基线，约 L1–L48）

```typescript
// 注释：与后端 DTO 白名单保持一致（旧版含 8 项）
/** 与后端 MinimaxTtsDto 白名单保持一致 */
// 导出 MiniMax TTS 可用模型名数组（旧版 8 项）
export const MINIMAX_TTS_MODELS = [
	// 2.8 高清
	'speech-2.8-hd',
	// 2.8 turbo
	'speech-2.8-turbo',
	// 2.6 高清（本轮删除）
	'speech-2.6-hd',
	// 2.6 turbo（本轮删除）
	'speech-2.6-turbo',
	// 02 高清（本轮删除）
	'speech-02-hd',
	// 02 turbo（本轮删除）
	'speech-02-turbo',
	// 01 高清（本轮删除）
	'speech-01-hd',
	// 01 turbo（本轮删除）
	'speech-01-turbo',
] as const;
// ...（未改动：MINIMAX_TTS_AUDIO_FORMATS 至 DEFAULT_MINIMAX_TTS_LANGUAGE_BOOST）
// 旧版默认 model 为 hd
export const DEFAULT_MINIMAX_TTS_MODEL = 'speech-2.8-hd';
// 默认英文音色 id
export const DEFAULT_MINIMAX_TTS_VOICE_ID = 'English_captivating_female1';
```

**改动后** · `apps/frontend/src/constants/minimaxTts.ts`（当前，约 L1–L43）

```typescript
// 注释：与后端 DTO 白名单保持一致（现仅 2.8 两项）
/** 与后端 MinimaxTtsDto 白名单保持一致 */
// 导出 MiniMax TTS 可用模型名数组（收窄为 2 项）
export const MINIMAX_TTS_MODELS = [
	// 2.8 高清
	'speech-2.8-hd',
	// 2.8 turbo（默认）
	'speech-2.8-turbo',
] as const;
// ...（未改动：MINIMAX_TTS_AUDIO_FORMATS 至 DEFAULT_MINIMAX_TTS_LANGUAGE_BOOST）
// 默认 model 改为 turbo
export const DEFAULT_MINIMAX_TTS_MODEL = 'speech-2.8-turbo';
// 默认英文音色 id
export const DEFAULT_MINIMAX_TTS_VOICE_ID = 'English_captivating_female1';
```

**变更摘要**：白名单从 8 项删至 2 项；默认从 hd 改为 turbo。

---

### 4.2 `normalizeMinimaxTtsUserPrefs`（`apps/frontend/src/utils/minimaxTtsPrefs.ts`）

**对比范围**：导出函数全符号（L109–L160）。

**改动前** · `apps/frontend/src/utils/minimaxTtsPrefs.ts`（基线，约 L109–L160）

```typescript
// 将 API/本地 unknown 归一化为 MinimaxTtsUserPrefs
export function normalizeMinimaxTtsUserPrefs(
	// 原始 prefs 对象或 JSON
	raw: unknown,
): MinimaxTtsUserPrefs {
	// 非对象则返回内置默认副本
	if (!raw || typeof raw !== 'object') {
		// 展开默认常量，避免引用共享
		return { ...DEFAULT_MINIMAX_TTS_USER_PREFS };
	}
	// 窄化为字符串键记录
	const o = raw as Record<string, unknown>;
	// 读取 model 字符串，缺省用 DEFAULT，最长 64
	const model = pickString(o.model, DEFAULT_MINIMAX_TTS_MODEL, 64);
	// 读取 format，缺省 mp3
	const format = pickString(o.format, 'mp3', 16);
	// 构造归一化 base 对象
	const base: MinimaxTtsUserPrefs = {
		// enabled 布尔化
		enabled: Boolean(o.enabled),
		// 朗读来源 local|cloud|xfyun
		playbackSource: normalizePlaybackSource(o.playbackSource),
		// 旧版：不在白名单则静默改回 DEFAULT（会吞掉用户输入的非法后缀）
		model: (MINIMAX_TTS_MODELS as readonly string[]).includes(model)
			? model
			: DEFAULT_MINIMAX_TTS_MODEL,
		// 音色 id
		voiceId: pickString(o.voiceId, DEFAULT_MINIMAX_TTS_VOICE_ID, 128),
		// 讯飞 vcn
		xfyunVoiceId: pickString(o.xfyunVoiceId, DEFAULT_XFYUN_TTS_VCN, 128),
		// 语速 0.5–2
		speed: clampNumber(o.speed, 0.5, 2, 1),
		// 音量
		vol: clampNumber(o.vol, 0.01, 10, 5),
		// 音高整数 -12–12
		pitch: Math.round(clampNumber(o.pitch, -12, 12, 0)),
		// 情感：白名单或空
		emotion: (() => {
			// 取字符串
			const e = pickString(o.emotion, '', 32);
			// 空、none、whisper 视为无情感
			if (!e || e === '__none__' || e === 'whisper') return '';
			// 在 MINIMAX_TTS_EMOTIONS 内则保留
			return (MINIMAX_TTS_EMOTIONS as readonly string[]).includes(e) ? e : '';
		})(),
		// 音频格式
		format: (MINIMAX_TTS_AUDIO_FORMATS as readonly string[]).includes(format)
			? format
			: 'mp3',
		// language_boost 归一
		languageBoost: (() => {
			// 原始 boost 字符串
			const rawBoost = pickString(o.languageBoost, '', 32);
			// 空则默认 auto
			if (!rawBoost) return DEFAULT_MINIMAX_TTS_LANGUAGE_BOOST;
			// 大小写别名映射
			const normalized =
				rawBoost.toLowerCase() === 'english'
					? 'English'
					: rawBoost.toLowerCase() === 'chinese'
						? 'Chinese'
						: rawBoost;
			// 白名单校验
			return (MINIMAX_TTS_LANGUAGE_BOOST_VALUES as readonly string[]).includes(
				normalized,
			)
				? normalized
				: DEFAULT_MINIMAX_TTS_LANGUAGE_BOOST;
		})(),
		// 采样率
		sampleRate: Math.round(clampNumber(o.sampleRate, 8000, 44_100, 32_000)),
		// 码率
		bitrate: Math.round(clampNumber(o.bitrate, 32_000, 256_000, 128_000)),
		// 声道 1 或 2
		channel: clampNumber(o.channel, 1, 2, 1) === 2 ? 2 : 1,
		// 讯飞凭证（可选）
		xfyunAppId: pickOptionalCredential(o.xfyunAppId, 64),
		// 讯飞 API Key
		xfyunApiKey: pickOptionalCredential(o.xfyunApiKey, 128),
		// 讯飞 API Secret
		xfyunApiSecret: pickOptionalCredential(o.xfyunApiSecret, 128),
		// MiniMax API Key
		minimaxApiKey: pickOptionalCredential(o.minimaxApiKey, 256),
	};
	// 拆分 legacy voice 存储字段
	return splitLegacyVoiceStorage(base, o.xfyunVoiceId);
}
```

**改动后** · `apps/frontend/src/utils/minimaxTtsPrefs.ts`（当前，约 L109–L160）

```typescript
// 将 API/本地 unknown 归一化为 MinimaxTtsUserPrefs
export function normalizeMinimaxTtsUserPrefs(
	// 原始 prefs 对象或 JSON
	raw: unknown,
): MinimaxTtsUserPrefs {
	// 非对象则返回内置默认副本
	if (!raw || typeof raw !== 'object') {
		// 展开默认常量，避免引用共享
		return { ...DEFAULT_MINIMAX_TTS_USER_PREFS };
	}
	// 窄化为字符串键记录
	const o = raw as Record<string, unknown>;
	// 读取 model 字符串，缺省用 DEFAULT（现为 turbo），最长 64
	const model = pickString(o.model, DEFAULT_MINIMAX_TTS_MODEL, 64);
	// 读取 format，缺省 mp3
	const format = pickString(o.format, 'mp3', 16);
	// 构造归一化 base 对象
	const base: MinimaxTtsUserPrefs = {
		// enabled 布尔化
		enabled: Boolean(o.enabled),
		// 朗读来源 local|cloud|xfyun
		playbackSource: normalizePlaybackSource(o.playbackSource),
		// 设置页模型为自由输入；白名单见 MINIMAX_TTS_MODELS，后端 DTO 校验
		// 新版：model 原样写入，非法值由保存/合成 API 拒绝
		model,
		// 音色 id
		voiceId: pickString(o.voiceId, DEFAULT_MINIMAX_TTS_VOICE_ID, 128),
		// 讯飞 vcn
		xfyunVoiceId: pickString(o.xfyunVoiceId, DEFAULT_XFYUN_TTS_VCN, 128),
		// 语速 0.5–2
		speed: clampNumber(o.speed, 0.5, 2, 1),
		// 音量
		vol: clampNumber(o.vol, 0.01, 10, 5),
		// 音高整数 -12–12
		pitch: Math.round(clampNumber(o.pitch, -12, 12, 0)),
		// 情感：白名单或空
		emotion: (() => {
			// 取字符串
			const e = pickString(o.emotion, '', 32);
			// 空、none、whisper 视为无情感
			if (!e || e === '__none__' || e === 'whisper') return '';
			// 在 MINIMAX_TTS_EMOTIONS 内则保留
			return (MINIMAX_TTS_EMOTIONS as readonly string[]).includes(e) ? e : '';
		})(),
		// 音频格式
		format: (MINIMAX_TTS_AUDIO_FORMATS as readonly string[]).includes(format)
			? format
			: 'mp3',
		// language_boost 归一
		languageBoost: (() => {
			// 原始 boost 字符串
			const rawBoost = pickString(o.languageBoost, '', 32);
			// 空则默认 auto
			if (!rawBoost) return DEFAULT_MINIMAX_TTS_LANGUAGE_BOOST;
			// 大小写别名映射
			const normalized =
				rawBoost.toLowerCase() === 'english'
					? 'English'
					: rawBoost.toLowerCase() === 'chinese'
						? 'Chinese'
						: rawBoost;
			// 白名单校验
			return (MINIMAX_TTS_LANGUAGE_BOOST_VALUES as readonly string[]).includes(
				normalized,
			)
				? normalized
				: DEFAULT_MINIMAX_TTS_LANGUAGE_BOOST;
		})(),
		// 采样率
		sampleRate: Math.round(clampNumber(o.sampleRate, 8000, 44_100, 32_000)),
		// 码率
		bitrate: Math.round(clampNumber(o.bitrate, 32_000, 256_000, 128_000)),
		// 声道 1 或 2
		channel: clampNumber(o.channel, 1, 2, 1) === 2 ? 2 : 1,
		// 讯飞凭证（可选）
		xfyunAppId: pickOptionalCredential(o.xfyunAppId, 64),
		// 讯飞 API Key
		xfyunApiKey: pickOptionalCredential(o.xfyunApiKey, 128),
		// 讯飞 API Secret
		xfyunApiSecret: pickOptionalCredential(o.xfyunApiSecret, 128),
		// MiniMax API Key
		minimaxApiKey: pickOptionalCredential(o.minimaxApiKey, 256),
	};
	// 拆分 legacy voice 存储字段
	return splitLegacyVoiceStorage(base, o.xfyunVoiceId);
}
```

**变更摘要**：删除 `MINIMAX_TTS_MODELS` import 与 includes 回落；`model` 字段原样保留，校验后移至后端。

---

### 4.3 `minimax-tts-models.ts`（纯新增）

**改动后** · `apps/backend/src/services/speech-transcription/minimax-tts-models.ts`（当前，约 L1–L9）

```typescript
// 注释：与前端 MINIMAX_TTS_MODELS 保持一致
/** 与前端 MINIMAX_TTS_MODELS 保持一致 */
// 后端 TTS model 白名单（仅 2.8 两项）
export const MINIMAX_TTS_MODELS = [
	// 2.8 高清
	'speech-2.8-hd',
	// 2.8 turbo
	'speech-2.8-turbo',
] as const;
// 服务端与 DB 默认 model
export const DEFAULT_MINIMAX_TTS_MODEL = 'speech-2.8-turbo';
// model 字面量联合类型
export type MinimaxTtsModel = (typeof MINIMAX_TTS_MODELS)[number];
```

---

### 4.4 `MinimaxTtsDto.model`（`apps/backend/src/services/speech-transcription/dto/minimax-tts.dto.ts`）

**对比范围**：`model` 字段及装饰器（类其余字段未改动）。

**改动前** · `apps/backend/src/services/speech-transcription/dto/minimax-tts.dto.ts`（基线，约 L45–L48）

```typescript
	// 可选 model，任意字符串，最长 64
	@IsOptional()
	// 须为字符串
	@IsString()
	// 最大长度 64
	@MaxLength(64)
	// 无白名单校验
	model?: string;
```

**改动后** · `apps/backend/src/services/speech-transcription/dto/minimax-tts.dto.ts`（当前，约 L45–L49）

```typescript
	// 可选 model，须在 MINIMAX_TTS_MODELS 内
	@IsOptional()
	// 须为字符串
	@IsString()
	// 最大长度 64
	@MaxLength(64)
	// 白名单：仅 speech-2.8-hd / speech-2.8-turbo
	@IsIn([...MINIMAX_TTS_MODELS])
	// 类型收窄为 MinimaxTtsModel
	model?: MinimaxTtsModel;
```

**变更摘要**：合成请求 `model` 非法时 ValidationPipe 返回 400。

---

### 4.5 `UpsertMinimaxTtsPrefsDto.model`（`dto/upsert-minimax-tts-prefs.dto.ts`）

**对比范围**：`model` 字段（约 L39–L42）。

**改动前** · `apps/backend/src/services/speech-transcription/dto/upsert-minimax-tts-prefs.dto.ts`（基线）

```typescript
	// 必填 model 字符串
	@IsString()
	// 最长 64
	@MaxLength(64)
	// 无 @IsIn
	model!: string;
```

**改动后** · `apps/backend/src/services/speech-transcription/dto/upsert-minimax-tts-prefs.dto.ts`（当前）

```typescript
	// 必填 model
	@IsString()
	// 最长 64
	@MaxLength(64)
	// 白名单校验
	@IsIn([...MINIMAX_TTS_MODELS])
	// 类型为 MinimaxTtsModel
	model!: MinimaxTtsModel;
```

---

### 4.6 `DEFAULT_MINIMAX_TTS_PREFS`（`minimax-tts-prefs.service.ts`）

**对比范围**：默认 prefs 对象中 `model` 行（摘录）。

**改动前** · `apps/backend/src/services/speech-transcription/minimax-tts-prefs.service.ts`（基线，约 L30–L33）

```typescript
// 服务端默认 prefs 视图
export const DEFAULT_MINIMAX_TTS_PREFS: MinimaxTtsPrefsView = {
	// 默认未启用云端
	enabled: false,
	// 默认本机朗读
	playbackSource: 'local',
	// 硬编码 hd
	model: 'speech-2.8-hd',
	// ...（未改动字段省略）
```

**改动后** · `apps/backend/src/services/speech-transcription/minimax-tts-prefs.service.ts`（当前，约 L30–L33）

```typescript
// 服务端默认 prefs 视图
export const DEFAULT_MINIMAX_TTS_PREFS: MinimaxTtsPrefsView = {
	// 默认未启用云端
	enabled: false,
	// 默认本机朗读
	playbackSource: 'local',
	// 引用共享常量 turbo
	model: DEFAULT_MINIMAX_TTS_MODEL,
	// ...（未改动字段省略）
```

---

### 4.7 `resolveOptions`（`minimax-tts.service.ts`）

**对比范围**：方法全符号（约 L130–L157）。

**改动前** · `apps/backend/src/services/speech-transcription/minimax-tts.service.ts`（基线，约 L130–L157）

```typescript
	// 对外 DTO 归一化并填默认
	resolveOptions(dto: MinimaxTtsDto): MinimaxTtsResolved {
		// 裁剪朗读文本
		const plain = dto.text.trim().slice(0, TTS_INPUT_MAX_CHARS);
		// 空文本 400
		if (!plain) {
			throw new HttpException('朗读文本为空', HttpStatus.BAD_REQUEST);
		}
		// 构造 resolved 参数
		return {
			// 裁剪后文本
			text: plain,
			// model：DTO → 环境变量 → 字面量 hd
			model:
				dto.model?.trim() ||
				(this.trimEnv(MinimaxEnum.MINIMAX_TTS_MODEL) ?? 'speech-2.8-hd'),
			// voiceId 链式默认
			voiceId:
				dto.voiceId?.trim() ||
				(this.trimEnv(MinimaxEnum.MINIMAX_TTS_VOICE_ID) ??
					'English_captivating_female1'),
			// 语速默认 1
			speed: dto.speed ?? 1,
			// 音量默认 1
			vol: dto.vol ?? 1,
			// 音高默认 0
			pitch: dto.pitch ?? 0,
			// 情感可选
			emotion: dto.emotion,
			// 采样率
			sampleRate: dto.sampleRate ?? 32_000,
			// 码率
			bitrate: dto.bitrate ?? 128_000,
			// 格式默认 mp3
			format: dto.format?.trim() || 'mp3',
			// 声道
			channel: dto.channel ?? 1,
			// 语言增强
			languageBoost: dto.languageBoost?.trim(),
			// 字幕开关
			subtitleEnable: dto.subtitleEnable ?? false,
			// 发音标注
			pronunciationTone: dto.pronunciationTone,
			// 文本规范化
			textNormalization: dto.textNormalization,
		};
	}
```

**改动后** · `apps/backend/src/services/speech-transcription/minimax-tts.service.ts`（当前，约 L130–L157）

```typescript
	// 对外 DTO 归一化并填默认
	resolveOptions(dto: MinimaxTtsDto): MinimaxTtsResolved {
		// 裁剪朗读文本
		const plain = dto.text.trim().slice(0, TTS_INPUT_MAX_CHARS);
		// 空文本 400
		if (!plain) {
			throw new HttpException('朗读文本为空', HttpStatus.BAD_REQUEST);
		}
		// 构造 resolved 参数
		return {
			// 裁剪后文本
			text: plain,
			// model：DTO → 环境变量 → DEFAULT_MINIMAX_TTS_MODEL（turbo）
			model:
				dto.model?.trim() ||
				(this.trimEnv(MinimaxEnum.MINIMAX_TTS_MODEL) ?? DEFAULT_MINIMAX_TTS_MODEL),
			// voiceId 链式默认
			voiceId:
				dto.voiceId?.trim() ||
				(this.trimEnv(MinimaxEnum.MINIMAX_TTS_VOICE_ID) ??
					'English_captivating_female1'),
			// 语速默认 1
			speed: dto.speed ?? 1,
			// 音量默认 1
			vol: dto.vol ?? 1,
			// 音高默认 0
			pitch: dto.pitch ?? 0,
			// 情感可选
			emotion: dto.emotion,
			// 采样率
			sampleRate: dto.sampleRate ?? 32_000,
			// 码率
			bitrate: dto.bitrate ?? 128_000,
			// 格式默认 mp3
			format: dto.format?.trim() || 'mp3',
			// 声道
			channel: dto.channel ?? 1,
			// 语言增强
			languageBoost: dto.languageBoost?.trim(),
			// 字幕开关
			subtitleEnable: dto.subtitleEnable ?? false,
			// 发音标注
			pronunciationTone: dto.pronunciationTone,
			// 文本规范化
			textNormalization: dto.textNormalization,
		};
	}
```

**变更摘要**：环境变量缺省时的字面量默认从 hd 改为 `DEFAULT_MINIMAX_TTS_MODEL`（turbo）。

---

### 4.8 `minimaxModelOptions` 与模型字段 JSX（`cloudTts/index.tsx`）

**对比范围 A**：`minimaxModelOptions` useMemo（纯新增，仅改动后）。

**改动后** · `apps/frontend/src/views/setting/cloudTts/index.tsx`（当前，约 L458–L465）

```typescript
	// 根据 MINIMAX_TTS_MODELS 生成 Combobox 选项
	const minimaxModelOptions = useMemo(
		// 映射为 value + i18n label
		() =>
			MINIMAX_TTS_MODELS.map((value) => ({
				// 选项值即 model 名
				value,
				// 显示文案走 MINIMAX_MODEL_OPTION_I18N
				label: t(MINIMAX_MODEL_OPTION_I18N[value]),
			})),
		// 语言切换时重算
		[t],
	);
```

**对比范围 B**：MiniMax 模型表单项 JSX。

**改动前** · `apps/frontend/src/views/setting/cloudTts/index.tsx`（基线，约 L600–L607）

```typescript
								// 旧版：单行文本 PrefTextField
								<PrefTextField
									// 输入 id
									id="minimax-model-name"
									// 标签「模型」
									label={t('setting.cloudTts.model')}
									// 绑定 prefs.model
									value={prefs.model}
									// 变更时 patch model
									onChange={(model) => patch({ model })}
									// 未选 MiniMax 时禁用
									disabled={fieldsDisabled}
									// 标签样式类
									labelClassName={fieldLabelClass}
								/>
```

**改动后** · `apps/frontend/src/views/setting/cloudTts/index.tsx`（当前，约 L619–L638）

```typescript
								// 外层 flex：小屏纵向、大屏 Label 与输入横排
								<div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-4">
									// 模型字段 Label，htmlFor 关联下方 combobox
									<Label
										htmlFor="minimax-model-name"
										className={fieldLabelClass}
									>
										{t('setting.cloudTts.model')}
									</Label>
									// 输入区 flex-1，避免窄屏溢出
									<div className="min-w-0 flex-1">
										// CreatableCombobox：可键入 + 预设 hd/turbo
										<CreatableCombobox
											id="minimax-model-name"
											value={prefs.model}
											onChange={(model) => patch({ model })}
											options={minimaxModelOptions}
											placeholder={t('setting.cloudTts.modelPlaceholder')}
											presetsAriaLabel={t('setting.cloudTts.openPresets')}
											disabled={fieldsDisabled}
											inputClassName={fieldInputClass}
										/>
									</div>
								</div>
```

**变更摘要**：UI 与大模型设置对齐；预设两项 + 自由输入，保存仍受后端白名单约束。

## 5. 兼容性与影响

| 场景 | 行为 |
|------|------|
| 新用户 / 恢复默认 | `model = speech-2.8-turbo` |
| DB 仍存 2.6 / 02 / 01 | 保存或合成 **400**，需改为 hd 或 turbo |
| 合法 hd / turbo | 与旧版相同，可正常保存与朗读 |
| MP3 缓存 | **未改**；model 变更仍通过不同 cache key 区分 |
| 旧文档 `MiniMax云端TTS.md` | 仍写 8 项 model 时需后续单独修订 |

## 6. 建议回归

1. 设置页选 turbo / hd 预设 → 保存 → 刷新仍为所选值。
2. Combobox 手动输入非法 model → 保存应失败并有错误提示。
3. 云端试听与单词朗读请求体 `model` 与 prefs 一致。
4. 老账号 DB 存 `speech-2.6-hd` → 打开设置页可见原值 → 改 turbo 后保存成功。

## 7. 相关源码路径

| 说明 | 路径 |
|------|------|
| 前端白名单与默认 | `apps/frontend/src/constants/minimaxTts.ts` |
| normalize | `apps/frontend/src/utils/minimaxTtsPrefs.ts` |
| 设置页 Combobox | `apps/frontend/src/views/setting/cloudTts/index.tsx` |
| 后端白名单模块 | `apps/backend/src/services/speech-transcription/minimax-tts-models.ts` |
| 合成 DTO | `apps/backend/src/services/speech-transcription/dto/minimax-tts.dto.ts` |
| 偏好 DTO | `apps/backend/src/services/speech-transcription/dto/upsert-minimax-tts-prefs.dto.ts` |

---

（若与仓库最新源码不一致，以源码为准）
