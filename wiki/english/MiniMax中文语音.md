# 云端 MiniMax 中文系统音色

## 延伸阅读

- [云端TTS设置.md](./云端TTS设置.md) — 设置页云端朗读参数与数据流
- [语音设置页.md](./语音设置页.md) — 语音设置页分区与会员可见性
- [MiniMax云端TTS.md](./MiniMax云端TTS.md) — 后端流式合成与 DTO
- [电子书引用朗读](../ebook/EPUB引用听书.md) — 中文书摘可走云端 TTS（会员 + `languageBoost`）

## 1. 背景与目标

**用户视角**：会员在 **设置 → 语音设置 → 云端语音设置** 中，将 **语言增强** 设为 **中文** 时，**音色类别** 下拉此前仍只有英文系统音色，无法为中文朗读选对 voice_id。

**目标**：

1. 在 `minimaxTts.ts` 登记 MiniMax 官方 **64 个中文系统音色**（58 普通话 + 6 粤语），ID 与[官方表](https://platform.minimaxi.com/docs/faq/system-voice-id)一致。
2. **语言增强** 与音色列表联动：英语 / 中文 / 自动 三档筛选可选音色。
3. 切换语言增强时，若当前 `voiceId` 不在新列表内，自动落到该语言默认音色（中文默认 `female-tianmei`）。

## 2. 改动范围

| 路径 | 说明 |
| ---- | ---- |
| `apps/frontend/src/constants/minimaxTts.ts` | `MINIMAX_TTS_CHINESE_VOICES`、筛选/默认 helper、类型 `MinimaxTtsVoice` |
| `apps/frontend/src/views/setting/cloudTts/index.tsx` | `VoiceSelectField` 按 `languageBoost` 筛音色；切换语言时校正 `voiceId` |

后端 `voiceId` 仍为最长 128 字符字符串，**无白名单变更**；新 ID 直接透传 MiniMax API。

## 3. 实现思路

1. **常量与英文并列**：`MINIMAX_TTS_CHINESE_VOICES` 结构与 `MINIMAX_TTS_ENGLISH_VOICES` 相同（`id` / `name` / `nameZh` / `gender`）；`nameZh` 取自官网中文名，`name` 供英文界面展示。
2. **类型统一**：`MinimaxTtsVoice` 替代原 `MinimaxTtsEnglishVoice` 主类型；保留后者为 `@deprecated` 别名，避免外部引用瞬间断裂。
3. **`getMinimaxTtsVoicesForLanguageBoost`**：`English` → 仅英文；`Chinese` → 仅中文；`auto` → 中英合并（列表较长，便于混排文本手动选音色）。
4. **`defaultMinimaxTtsVoiceIdForLanguageBoost`**：中文默认 `female-tianmei`，英文仍 `English_captivating_female1`。
5. **`getMinimaxTtsVoicesByGender(voices)`**：由写死英文列表改为接收任意 `MinimaxTtsVoice[]`；`getMinimaxTtsEnglishVoicesByGender` 保留为薄包装。
6. **设置页**：`VoiceSelectField` 增加 `languageBoost` prop；语言增强 `onValueChange` 内校验 `voiceId` 合法性并必要时重置。
7. **权衡**：未按粤语/普通话再分子组（避免 UI 膨胀）；`auto` 下男女分组内中英音色混排，靠展示名区分。

## 4. 关键代码对比与注释

### 4.1 `getMinimaxTtsVoicesForLanguageBoost`（`apps/frontend/src/constants/minimaxTts.ts`）

**对比范围**：纯新增函数；无改动前块。

**改动后** · `apps/frontend/src/constants/minimaxTts.ts`（当前，约 L741–L759）

```typescript
// 按语言增强返回可选音色列表，供设置页 Select 与 voiceId 校验
export function getMinimaxTtsVoicesForLanguageBoost(
	languageBoost: MinimaxTtsLanguageBoost,
): readonly MinimaxTtsVoice[] {
	// 仅英文系统音色（45 项）
	if (languageBoost === 'English') return MINIMAX_TTS_ENGLISH_VOICES;
	// 仅中文系统音色（64 项：普通话 + 粤语）
	if (languageBoost === 'Chinese') return MINIMAX_TTS_CHINESE_VOICES;
	// 自动：中英全部，便于用户自行挑选
	return [...MINIMAX_TTS_ENGLISH_VOICES, ...MINIMAX_TTS_CHINESE_VOICES];
}

// 切换语言增强时若当前 voiceId 无效，回退到该语言默认 ID
export function defaultMinimaxTtsVoiceIdForLanguageBoost(
	languageBoost: MinimaxTtsLanguageBoost,
): string {
	if (languageBoost === 'Chinese') return DEFAULT_MINIMAX_TTS_CHINESE_VOICE_ID;
	return DEFAULT_MINIMAX_TTS_VOICE_ID;
}
```

**变更摘要**：语言增强与音色白名单在前端集中映射；默认 ID 分中英文。

---

### 4.2 `getMinimaxTtsVoicesByGender`（同文件）

**对比范围**：完整函数（由仅英文改为泛化入参）。

**改动前** · 同文件（基线，约 L350–L362）

```typescript
// 固定遍历 MINIMAX_TTS_ENGLISH_VOICES，设置页英文音色分组
export function getMinimaxTtsEnglishVoicesByGender(): {
	female: readonly MinimaxTtsEnglishVoice[];
	male: readonly MinimaxTtsEnglishVoice[];
} {
	const female: MinimaxTtsEnglishVoice[] = [];
	const male: MinimaxTtsEnglishVoice[] = [];
	for (const voice of MINIMAX_TTS_ENGLISH_VOICES) {
		if (voice.gender === 'female') female.push(voice);
		else male.push(voice);
	}
	return { female, male };
}
```

**改动后** · 同文件（当前，约 L758–L780）

```typescript
// 任意音色列表按 gender 拆成女/男两组，供 Select 分组渲染
export function getMinimaxTtsVoicesByGender(
	voices: readonly MinimaxTtsVoice[],
): {
	female: readonly MinimaxTtsVoice[];
	male: readonly MinimaxTtsVoice[];
} {
	const female: MinimaxTtsVoice[] = [];
	const male: MinimaxTtsVoice[] = [];
	for (const voice of voices) {
		if (voice.gender === 'female') female.push(voice);
		else male.push(voice);
	}
	return { female, male };
}

// 兼容旧调用方：仍只分英文列表
export function getMinimaxTtsEnglishVoicesByGender(): {
	female: readonly MinimaxTtsVoice[];
	male: readonly MinimaxTtsVoice[];
} {
	return getMinimaxTtsVoicesByGender(MINIMAX_TTS_ENGLISH_VOICES);
}
```

**变更摘要**：分组逻辑复用到中文列表；英文专用函数降为包装。

---

### 4.3 `MINIMAX_TTS_CHINESE_VOICES`（同文件，摘录）

**对比范围**：纯新增常量；基线无对应符号。下列为数组**前 4 项 + 末项**摘录（完整 64 项见源码）。

**改动后** · 同文件（当前，约 L345–L731，摘录）

```typescript
/**
 * MiniMax 官方中文系统音色（普通话 + 粤语）
 * @see https://platform.minimaxi.com/docs/faq/system-voice-id
 */
export const MINIMAX_TTS_CHINESE_VOICES: readonly MinimaxTtsVoice[] = [
	{
		id: 'male-qn-qingse',
		name: 'Youthful Male',
		nameZh: '青涩青年',
		gender: 'male',
	},
	// ...（共 58 项普通话：含 legacy id 与 Chinese (Mandarin)_* 系列）
	{
		id: 'Chinese (Mandarin)_Soft_Girl',
		name: 'Soft Girl',
		nameZh: '柔和少女',
		gender: 'female',
	},
	// ...（6 项粤语 Cantonese_*）
	{
		id: 'Cantonese_KindWoman',
		name: 'Kind Woman',
		nameZh: '善良女声',
		gender: 'female',
	},
];
```

**变更摘要**：与官方 voice_id 对齐；`MINIMAX_TTS_VOICE_PRESETS` 合并中英 ID。

---

### 4.4 `VoiceSelectField`（`apps/frontend/src/views/setting/cloudTts/index.tsx`）

**对比范围**：组件 props、`useMemo` 取音色与分组（摘录）。

**改动前** · 同文件（基线）

```typescript
function VoiceSelectField({
	// ...（无 languageBoost）
}: {
	// ...
}) {
	const { female, male } = useMemo(
		() => getMinimaxTtsEnglishVoicesByGender(),
		[],
	);
	// ...
}
```

**改动后** · 同文件（当前，约 L202–L232）

```typescript
function VoiceSelectField({
	// ...
	languageBoost,
}: {
	// ...
	languageBoost: MinimaxTtsLanguageBoost;
}) {
	const { t, locale } = useI18n();
	// 随语言增强重算可选音色全集
	const voices = useMemo(
		() => getMinimaxTtsVoicesForLanguageBoost(languageBoost),
		[languageBoost],
	);
	// 再按 gender 拆组供 Select 渲染
	const { female, male } = useMemo(
		() => getMinimaxTtsVoicesByGender(voices),
		[voices],
	);

	const voiceLabel = (voice: MinimaxTtsVoice) =>
		formatVoiceOptionLabel(
			getMinimaxTtsVoiceDisplayName(voice, locale),
			voice.id,
		);
	// ...（Select 渲染未改）
}
```

**变更摘要**：音色下拉数据源由静态英文改为随 `languageBoost` 动态筛选。

---

### 4.5 语言增强 `onValueChange`（同文件）

**对比范围**：`PrefSelectField` 回调（基线仅 `patch({ languageBoost })`）。

**改动前** · 同文件（基线）

```typescript
onValueChange={(languageBoost) => patch({ languageBoost })}
```

**改动后** · 同文件（当前，约 L556–L567）

```typescript
onValueChange={(languageBoost) => {
	const boost = languageBoost as MinimaxTtsLanguageBoost;
	const voices = getMinimaxTtsVoicesForLanguageBoost(boost);
	const voiceIds = new Set(voices.map((v) => v.id));
	// 当前 voiceId 仍合法则保留，否则换默认
	const voiceId = voiceIds.has(prefs.voiceId)
		? prefs.voiceId
		: defaultMinimaxTtsVoiceIdForLanguageBoost(boost);
	patch({ languageBoost: boost, voiceId });
}}
```

**变更摘要**：避免语言增强切到中文后仍提交英文 `voiceId` 导致合成异常。

## 5. 兼容性与影响

| 项 | 说明 |
| ---- | ---- |
| 已有账号偏好 | 已保存的英文 `voiceId` 不受影响；用户改语言增强为中文时会自动切默认中文音色 |
| 非会员 | 无云端设置区，无行为变化 |
| 电子书「听当前」 | 会员云端朗读若 `languageBoost: Chinese` 且 `voiceId` 为中文音色，听感改善；见 `EPUB引用听书.md` |
| 破坏性 | 无 API 破坏；`MinimaxTtsEnglishVoice` 仍为类型别名 |

## 6. 风险与回归

1. 语言增强 **中文** → 音色列表仅中文项，试听应为中文发音。
2. 语言增强 **英语** → 列表与改前一致（45 英文音色）。
3. **自动** → 列表含中英全部；选中文 ID 后改 **英语** 应重置为英文默认音色。
4. 粤语 ID（含全角括号）与 MiniMax API 兼容性抽测一条试听。

## 7. 相关源码路径

| 说明 | 路径 |
| ---- | ---- |
| 中英音色常量 | `apps/frontend/src/constants/minimaxTts.ts` |
| 设置页 UI | `apps/frontend/src/views/setting/cloudTts/index.tsx` |
| 偏好持久化 | `apps/frontend/src/utils/minimaxTtsPrefs.ts` |

---

（若与仓库最新源码不一致，以源码为准）
