# 英语朗读按会员选路（单词/语句/练习统一）

> **文档角色（主文档）**：`playPreferred` 默认路由——有效会员走云端 TTS，非会员走本机 Web Speech；单词不再单独强制本机。  
> **端到端全景（含本机/云端全链路）**：[`TTS端到端指南.md`](./TTS端到端指南.md)  
> **延伸阅读**：[`TTS播放源.md`](./TTS播放源.md)（会员本机/云端 Switch）、[`英语TTS播放.md`](./英语TTS播放.md)（播放世代）、[`MiniMax云端TTS.md`](./MiniMax云端TTS.md)（云端合成）、[`英语TTS本地语音.md`](./英语TTS本地语音.md)（本机音色）、[`语音设置页.md`](./语音设置页.md)（设置入口）。

若与仓库最新源码不一致，**以源码为准**。

---

## 1. 背景与目标

### 1.1 问题

改前策略按**内容类型**分流：

| 内容 | 改前默认 |
|------|----------|
| 单词（词库、练习、每日等） | 调用方传 `preferLocal: true` → **始终本机** |
| 经典句 / 长句 | 不传参 → 会员云端、非会员本机 |

会员在单词场景听不到云端音色，与「会员权益含云端朗读」不一致；调用方分散维护 `preferLocal`，易漏改。

### 1.2 改后目标

| 用户 | 单词 / 语句 / 练习 / 每日等 **所有** 喇叭朗读 |
|------|-----------------------------------------------|
| **有效会员** | 默认 **云端 TTS**；可在 **语音设置** 切 **本机**（`playbackSource`）；云端失败仍回退本机 |
| **非会员** | 默认 **本机 Web Speech**（不请求 TTS 接口） |

**例外**：**语音设置 → 本机语音设置** 试听仍 `preferLocal: true`，强制本机音色。

---

## 2. 改动范围

| 路径 | 职责 |
|------|------|
| `apps/frontend/src/utils/speech.ts` | 路由核心、`isPlaybackAvailable` |
| `apps/frontend/src/views/englishLearning/practice/hooks/usePracticePlayback.ts` | 练习单次 / 听写三连播 |
| `apps/frontend/src/views/englishLearning/practice/Summary.tsx` | 结算页单词播放 |
| `apps/frontend/src/views/englishLearning/daily/hooks/useDailyPlayback.ts` | 今日复习卡片 |
| `apps/frontend/src/views/englishLearning/daily/records/index.tsx` | 复习记录列表 |
| `apps/frontend/src/views/englishLearning/library/vocabulary/index.tsx` | 资源库单词 |
| `apps/frontend/src/views/englishLearning/favorites/vocabulary/index.tsx` | 单词收藏 |
| `apps/frontend/src/views/englishLearning/pack/vocabulary/index.tsx` | 单词包 |
| `apps/frontend/src/views/englishLearning/mistakes/vocabulary/VocabularyMistakesPanel.tsx` | 单词错题 |
| `apps/frontend/src/views/englishLearning/mistakes/classic/ClassicQuoteMistakesPanel.tsx` | 语句错题（仅可用性检查） |
| `apps/frontend/src/views/englishLearning/reference/morphology/index.tsx` | 词形参考 |

**未改调用方式（已符合改后语义）**：经典句收藏/资源库/词包等本就 `playPreferred(text)` 无 `preferLocal`。

**仍强制本机**：`apps/frontend/src/views/setting/cloudTts/LocalTtsVoiceSetting.tsx` 试听。

---

## 3. 实现思路

### 3.1 集中选路，不扩散到各页面

`playPreferred` 内：

```text
useCloud = shouldUseCloudTts(options)
```

- **非会员**：`shouldUseCloudTts` 恒 `false` → 本机。
- **有效会员**：读 `loadMinimaxTtsUserPrefs().playbackSource`；`cloud`（默认）→ 云端，`local` → 本机。详见 [`TTS播放源.md`](./TTS播放源.md)。
- `isCloudTtsAllowed()`：仍用于会员判定（读 `localStorage` 的 `userInfo`）。
- 此前单词页显式 `preferLocal: true` 绕过了会员云端；**已删除这些传参**，单词与语句同一套选路。

### 3.2 `preferLocal` 语义收窄

| `preferLocal` | 行为 |
|---------------|------|
| `true` | **强制本机**（设置页本机试听） |
| `false` | **强制云端**（须为有效会员） |
| 省略 | **会员 → 按 `playbackSource`**；**非会员 → 本机** |

不再表示「单词 vs 句子」。

### 3.3 `isPlaybackAvailable`

播放前若只检查 `isSpeechSupported()`，选云端且本机不可用的会员会被误判。逻辑为：

```text
非会员 → 须 isSpeechSupported()
会员且 playbackSource === local → 须 isSpeechSupported()
会员且 playbackSource === cloud → 可用（云端；失败再回退本机）
```

练习、每日、错题、结算等入口改用 `isPlaybackAvailable()` 再 Toast「不支持朗读」。

### 3.4 云端失败回退

会员云端路径不变：`fetchCloudTtsBlob` 失败 → 本机 `speakTextWithGeneration`（需本机可用，否则 `NO_TTS`）。

---

## 4. 关键代码与注释

### 4.1 会员判定与可用性

**来源**：`apps/frontend/src/utils/speech.ts`（约 L399–L418）

```typescript
/** 会员可走云端；非会员或选本机时需 Web Speech 可用 */
export function isPlaybackAvailable(): boolean {
	if (!isCloudTtsAllowed()) {
		return isSpeechSupported();
	}
	if (!shouldUseCloudTts()) {
		return isSpeechSupported(); // 会员选 local
	}
	return true; // 会员选 cloud：云端可用；失败时播放层回退本机
}

/** 会员朗读选路：读 playbackSource；非会员恒 false */
function shouldUseCloudTts(options?: PlayPreferredOptions): boolean {
	if (options?.preferLocal === true) return false;
	if (options?.preferLocal === false) return isCloudTtsAllowed();
	if (!isCloudTtsAllowed()) return false;
	const prefs = loadMinimaxTtsUserPrefs();
	return prefs.playbackSource !== 'local';
}
```

### 4.2 `playPreferred` 选路

**来源**：`apps/frontend/src/utils/speech.ts`（约 L682–L713）

```typescript
export async function playPreferred(
	rawText: string,
	options?: PlayPreferredOptions,
): Promise<void> {
	const plain = stripMarkdownForTts(rawText);
	if (!plain) return;

	const generation = beginPlaybackSession();
	const speakOpts = options?.speak;
	const useCloud = shouldUseCloudTts(options);

	if (!useCloud) {
		// 非会员、会员选 local、或 preferLocal：Web Speech
		if (!isPlaybackGenerationActive(generation)) return;
		if (!isSpeechSupported()) {
			throw new Error('NO_TTS');
		}
		await speakTextWithGeneration(rawText, generation, speakOpts);
		return;
	}

	try {
		const blob = await fetchCloudTtsBlob(plain);
		if (!isPlaybackGenerationActive(generation)) return;
		await playCloudMp3Blob(blob, generation);
		return;
	} catch {
		// 说明：会员云端失败时回退本机，世代仍有效才继续
		if (!isPlaybackGenerationActive(generation)) return;
		if (!isSpeechSupported()) {
			throw new Error('NO_TTS');
		}
		await speakTextWithGeneration(rawText, generation, speakOpts);
	}
}
```

### 4.3 练习播放：去掉 `preferLocal`

**来源**：`apps/frontend/src/views/englishLearning/practice/hooks/usePracticePlayback.ts`（约 L75–L106）

```typescript
const playWord = useCallback<PlayWordFn>(
	async (options) => {
		// 说明：会员无本机 TTS 时仍可云端朗读
		if (!isPlaybackAvailable()) {
			Toast({ type: 'warning', title: t('englishLearning.tts.unsupported') });
			return;
		}
		// ...
		try {
			if (useDictationSequence) {
				await playDictationSequence(runId);
			} else {
				// 说明：不再 preferLocal:true；会员听写/拼写走云端默认同句逻辑
				await playPreferred(answerText);
			}
		} catch {
			Toast({ type: 'warning', title: t('englishLearning.tts.unsupported') });
		}
	},
	// ...
);
```

听写三连播 `playDictationSequence` 内同样改为 `playPreferred(answerText)`。

### 4.4 词库等列表：统一默认调用

**来源**：`apps/frontend/src/views/englishLearning/library/vocabulary/index.tsx`（`toggleWordAudio` 附近）

```typescript
try {
	// 说明：会员云端 / 非会员本机，由 speech 内部判定
	await playPreferred(word);
} catch {
	Toast({ type: 'warning', title: t('englishLearning.tts.unsupported') });
}
```

---

## 5. 兼容性与影响

| 维度 | 说明 |
|------|------|
| **会员** | 单词、练习、每日等由本机改为云端（音质与 MiniMax/自定义参数一致）；云端不可用时有本机回退 |
| **非会员** | 行为与改前单词场景一致，仍仅本机 |
| **设置试听** | 本机区 `preferLocal: true`、云端区 `preferLocal: false` 不变 |
| **播放世代** | 不变；快速连点仍丢弃过期异步结果 |

### 5.1 建议回归

1. **会员**：词库单词、经典句、听写三连播、结算页播放 → 云端音色；断网或 TTS 503 → 回退本机或提示。
2. **非会员**：同上入口 → 本机 Karen 等已选音色。
3. **语音设置**：本机试听仅本机；云端试听仅会员云端。
4. **换号**：会员 ↔ 非会员切换账号后，同页喇叭路由应随之变化（依赖 `userInfo` 与 `isMembershipActiveFromUserInfo`）。

---

## 6. 相关源码路径

| 说明 | 路径 |
|------|------|
| 朗读核心 | `apps/frontend/src/utils/speech.ts` |
| 练习 | `apps/frontend/src/views/englishLearning/practice/hooks/usePracticePlayback.ts` |
| 本机试听（仍 force local） | `apps/frontend/src/views/setting/cloudTts/LocalTtsVoiceSetting.tsx` |
