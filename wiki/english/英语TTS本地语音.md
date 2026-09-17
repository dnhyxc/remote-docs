# 英语学习：本机 TTS 音色设置与默认 Karen

> **文档角色**：本机 Web Speech 音色、按账号分键、**语音设置页**上方区块 UI。  
> **延伸阅读**：[`英语TTS播放.md`](./英语TTS播放.md)（播放世代与会员云端策略）、[`云端TTS偏好数据库.md`](./云端TTS偏好数据库.md)（云端朗读偏好入库，与本机音色分离）、[`../auth/用户切换状态重置.md`](../auth/用户切换状态重置.md)（换号清内存态；本机音色键**不**清）。

若与仓库最新源码不一致，**以源码为准**。

---

## 1. 背景与目标

### 1.1 产品需求

- 在**设置 → 语音设置**中配置本机 Web Speech 英语音色并试听；**非会员**英语学习喇叭默认使用该本机偏好。
- 默认女声为 **Karen**；首次为某账号写入默认 key，避免「只有点选后才生效」。
- **按登录账号隔离**：同一浏览器内 A/B 换号后，各自的本机音色偏好互不覆盖；设置页下拉框与播放一致。

### 1.2 与云端朗读的边界

| 维度 | 本机 Web Speech | 云端 MiniMax 等 |
|------|-----------------|-----------------|
| 存储 | `localStorage` 键 `local_tts_voice:{userId}` | 表 `minimax_tts_user_config` |
| 设置入口 | **设置 → 语音设置** →「本机语音设置」（页面上方） | 同页 **「云端语音设置」**（**会员**，页面下方） |
| 换号 | 读对应 `:userId` 键，UI 随 `loggedInUserId` 刷新 | 服务端 JWT + 内存缓存 |

> 页面整合说明见 [`语音设置页.md`](./语音设置页.md)。

---

## 2. 改动范围

| 说明 | 路径 |
|------|------|
| TTS 核心（分键、legacy 迁移、换号清 voice 缓存） | `apps/frontend/src/utils/speech.ts` |
| 本机 UI（`observer` + 单一 `useEffect`） | `apps/frontend/src/views/setting/cloudTts/LocalTtsVoiceSetting.tsx` |
| 用户 id 与分键工具 | `apps/frontend/src/store/loggedInUserId.ts` |

---

## 3. 实现思路

### 3.1 默认与按账号持久化

- **`DEFAULT_LOCAL_TTS_VOICE_KEY = 'karen'`**
- 存储键：`userScopedStorageKey('local_tts_voice', userId)` → `local_tts_voice:123`（已弃用旧键 `english_learning_local_tts_voice*`，需用户在语音设置中重新选择）
- **`ensureDefaultLocalVoicePreference()`**：当前 userId 无配置时写入 `karen`（须已登录，`userId > 0`）
- **无后缀 → 分键**：若仍存在无后缀 `local_tts_voice`，首次读取时复制到 `:userId` 并删除旧键
- 选「默认（Karen）」：`setPreferredLocalVoiceKey(null)` 写回默认 key

### 3.2 换号与内存缓存

- `readPreferredVoiceKeyFromStorage()` 检测 `getLoggedInUserId()` 变化时调用 `resetCachedLocalVoice()`，避免仍用上一账号解析出的 `SpeechSynthesisVoice`
- **`resetUserState()` 不删除**本机音色 localStorage（设备级、按账号分键保留，与 UI 偏好类键策略一致）

### 3.3 语音设置页 UI（LocalTtsVoiceSetting）

- **DropdownMenu + RadioGroup**，分组女声/男声；试听 `playPreferred(..., { preferLocal: true })`
- **`observer`**：订阅 `userStore.userInfo`，换号后 `loggedInUserId` 可靠更新
- **单一 `useEffect`**，依赖 `[refreshVoices, loggedInUserId]`：
  - 挂载 / 换号：`warmupSpeechVoices()` + `refreshVoices()`（从分键读偏好并更新 `selected`）
  - 监听 `speechSynthesis` 的 `voiceschanged`
  - **避免**原先两个 effect 在挂载时重复调用 `refreshVoices()`

### 3.4 与朗读调用的关系

`resolveVoiceKeyForPlayback()` 在每次本机播放前解析关键字并匹配 `getVoices()`；有效会员的云端路径见 `英语TTS播放.md`，与本节无关。

---

## 4. 关键代码与注释

### 4.1 按 userId 分键与 legacy 迁移

**来源**：`apps/frontend/src/utils/speech.ts`（约 L178–L214）

```typescript
function localVoiceStorageKey(userId?: number): string {
	// 说明：与 LLM / cloud-tts 分键同一套 userScopedStorageKey
	return userScopedStorageKey(LOCAL_TTS_VOICE_KEY, userId);
}

function readPreferredVoiceKeyFromStorage(): string | null {
	const userId = getLoggedInUserId();
	if (userId !== cachedVoicePrefUserId) {
		cachedVoicePrefUserId = userId;
		resetCachedLocalVoice(); // 说明：换号后丢弃上一账号缓存的 Voice 对象
	}
	if (userId <= 0) return null;
	const scopedKey = localVoiceStorageKey(userId);
	let raw = localStorage.getItem(scopedKey);
	if (!raw) {
		const legacy = localStorage.getItem(LOCAL_TTS_VOICE_KEY);
		if (legacy) {
			localStorage.setItem(scopedKey, legacy);
			localStorage.removeItem(LOCAL_TTS_VOICE_KEY);
			raw = legacy;
		}
	}
	// ...
}
```

### 4.2 设置页：合并 effect + observer

**来源**：`apps/frontend/src/views/setting/cloudTts/LocalTtsVoiceSetting.tsx`（约 L70–L131）

```typescript
export const LocalTtsVoiceSetting = observer(function LocalTtsVoiceSetting({
	showDivider = false,
}: { showDivider?: boolean }) {
	const { userStore } = useStore();
	const loggedInUserId = userStore.userInfo?.id ?? getLoggedInUserId();

	const refreshVoices = useCallback(() => {
		// 说明：内部 getPreferredLocalVoiceKey() 已按当前 userId 读分键
		setVoices(listLocalVoices());
		// ... 同步 selected 下拉状态
	}, []);

	useEffect(() => {
		warmupSpeechVoices();
		refreshVoices();
		const onVoicesChanged = () => refreshVoices();
		window.speechSynthesis.addEventListener('voiceschanged', onVoicesChanged);
		return () => {
			window.speechSynthesis.removeEventListener('voiceschanged', onVoicesChanged);
		};
	}, [refreshVoices, loggedInUserId]); // 说明：换号时再 refresh 一次，挂载只执行一轮
});
```

### 4.3 用户切换音色

**来源**：`apps/frontend/src/views/setting/cloudTts/LocalTtsVoiceSetting.tsx`（`onVoiceChange` 附近）

```typescript
if (value === LOCAL_TTS_VOICE_AUTO) {
	setPreferredLocalVoiceKey(null); // 恢复 Karen 默认
} else {
	setPreferredLocalVoiceByUri(value); // 写入当前 userId 分键
}
```

---

## 5. 兼容性与影响

| 场景 | 行为 |
|------|------|
| 老用户仅有无后缀 localStorage 键 | 首次登录后自动迁到 `:userId` |
| 同浏览器换号 | 下拉框与朗读各读各账号键，不串号 |
| 登出 / `resetUserState` | 清 Agent、草稿等内存态；**保留**各账号本机音色键 |
| 未登录 | 不写默认 Karen；`readPreferredVoiceKeyFromStorage` 返回 null |

---

## 6. 回归建议

| 场景 | 预期 |
|------|------|
| 账号 A 选男声 → 换号 B → 再回 A | A 仍为男声，B 为 B 的配置或默认 Karen |
| 停留在系统设置页换号 | 下拉框随 `loggedInUserId` 更新（需 `observer`） |
| 首次打开设置（已登录） | 显示默认或已保存音色，试听可用 |
| 切换音色后单词朗读 | 资源库/收藏喇叭使用新音色 |

---

## 7. 相关源码路径

| 说明 | 路径 |
|------|------|
| 分键工具 | `apps/frontend/src/store/loggedInUserId.ts` |
| 播放与会员云端 | `apps/frontend/src/utils/speech.ts` |
| 设置 UI | `apps/frontend/src/views/setting/cloudTts/LocalTtsVoiceSetting.tsx` |
| 页面整合 | [`语音设置页.md`](./语音设置页.md) |
