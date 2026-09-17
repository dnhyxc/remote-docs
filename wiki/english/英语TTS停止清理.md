# 英语学习朗读：停止时彻底释放与路由切换自动停播

> **文档角色**：`stopAllPlayback` 增强为彻底释放音频元素与媒体会话、英语学习路由壳在子页切换/离开时自动停播、经典句朗读统一 `cloudSingleUtterance`。
> **播放世代与异步丢弃**见 [`英语TTS播放.md`](./英语TTS播放.md)。
> **cancel 后 settle（首句无声修复）**见 [`TTS本地取消结算影响.md`](./TTS本地取消结算影响.md)。
> **云端整段一次合成（cloudSingleUtterance 语义）**见 [`云端TTS节奏预取.md`](./云端TTS节奏预取.md)。

## 1. 背景与目标

### 1.1 用户视角

英语学习模块多处提供「喇叭」朗读（资源库经典句、单词包、收藏、错题集、练习结算页等）。此前面有两个体验问题：

- **离开英语学习或切换子页后声音仍在继续**：用户从「收藏」切到「资源库」，或切到对话/知识库等其它主功能后，上一句朗读不会停，造成跨页串音。
- **停止后系统媒体控件残留进度条**：点击另一个词条触发 `stopAllPlayback` 时，旧代码只 `pause` 并清 `src`，但 Chromium/macOS 仍可能按旧 `<audio>` 元素向 Touch Bar / 控制中心外推一个无声的进度条，看起来像「还在播放但没声音」。

### 1.2 本轮目标

| 层级 | 目标 |
|------|------|
| `speech.ts` | `stopAllPlayback` 在原有 `stopPlaybackMediaOnly` 基础上，**彻底释放**云端音频元素、静默解锁音频、清空 MediaSession，并用 `requestAnimationFrame` 二次清以确保系统侧收回进度条 |
| `englishLearning/Layout.tsx` | 英语学习路由壳监听 `pathname`/`search` 变化，**卸载时自动 `stopAllPlayback`**，避免跨子页/跨主功能串音 |
| 经典句各朗读入口 | 统一传 `{ cloudSingleUtterance: true }`，让云端按整段一次合成而非逐句拆 HTTP，缩短经典句首包等待 |

若与仓库最新源码不一致，**以源码为准**。

---

## 2. 改动范围

| 说明 | 路径 |
|------|------|
| 朗读核心 · `stopAllPlayback` 增强 | `apps/frontend/src/utils/speech.ts` |
| 路由壳 · 自动停播 | `apps/frontend/src/views/englishLearning/Layout.tsx` |
| 经典句收藏 · 朗读 | `apps/frontend/src/views/englishLearning/favorites/classic/index.tsx` |
| 经典句资源库 · 朗读 | `apps/frontend/src/views/englishLearning/library/classic/index.tsx` |
| 经典句错题集 · 朗读 | `apps/frontend/src/views/englishLearning/mistakes/classic/ClassicQuoteMistakesPanel.tsx` |
| 经典句词包 · 朗读 | `apps/frontend/src/views/englishLearning/pack/classic/index.tsx` |
| 练习结算页 · 朗读 | `apps/frontend/src/views/englishLearning/practice/Summary.tsx` |
| 练习播放 hook · 听写连播 | `apps/frontend/src/views/englishLearning/practice/hooks/usePracticePlayback.ts` |

---

## 3. 实现思路

### 3.1 为何 `stopAllPlayback` 需要「彻底释放」

旧版 `stopAllPlayback` 只调用 `stopPlaybackMediaOnly()`，后者会 `pause` 云端 `<audio>` 并清 `src`、撤销 Object URL、清空 `mediaSession.metadata`。但这还不够：

- **元素引用仍存活**：`cloudAudio` 全局变量仍指向那个已 pause 的 `<audio>`，Chromium/macOS 的系统媒体控件仍可能持有该元素引用，继续外推进度条。
- **解锁音频未静默**：用于绕过浏览器自动播放策略的 `cloudAudioUnlock` 元素若仍处于「已 play」状态，系统侧也可能误判为活跃音频源。

因此新版在 `stopPlaybackMediaOnly()` 之后追加三步：

1. `releaseCloudAudioEl()`：丢弃 `cloudAudio` 引用、撤销 Object URL、静音/暂停并移除所有事件监听、`load()` 重置——让浏览器彻底释放底层资源。
2. `silenceCloudAudioUnlock()`：暂停解锁音频并归零 `currentTime`。
3. `clearPlaybackMediaSession()`：清空 `metadata`、`playbackState`、`setPositionState`，并按需卸载 play/pause 等 action handler。
4. `requestAnimationFrame` 二次清：某些浏览器在同一帧内不会立即响应 MediaSession 变更，下一帧再清一次确保系统侧收回。

### 3.2 为何路由壳要自动停播

旧版 `Layout` 只是一个透传 `<Outlet />` 的空壳，子页切换时不会停播。虽然各子页组件卸载时大多有自己的 `stopAllPlayback`，但存在边角：

- 子路由之间切换时，React 卸载旧子页与挂载新子页在同一渲染批次，旧子页的 cleanup 与新子页的 `stopAllPlayback` 可能互相抵消。
- 离开整个英语学习模块（切到对话/知识库）时，如果当前子页没有卸载期停播，声音会带到别的页面。

在路由壳层统一兜底：监听 `pathname`/`search`，变化时（含子页切换与离开模块）执行 `stopAllPlayback`。这是**兜底**而非替代——子页自身的停播逻辑保留，路由壳只确保「无论如何，离开就停」。

### 3.3 为何经典句朗读统一 `cloudSingleUtterance: true`

`cloudSingleUtterance` 为 `true` 时，云端 TTS 不按句读拆 HTTP，而是整段一次合成。经典句通常是一句话（几十字符），拆句读反而增加首包往返；整段合成一次请求即可拿到完整音频，首包更快、高亮靠播放进度估算触发。单词/单字同理，因此练习听写连播也一并改为 `true`。

---

## 4. 关键代码对比与注释

### 4.1 `stopAllPlayback`（`apps/frontend/src/utils/speech.ts`）

**对比范围**：`function stopAllPlayback` 全函数。

**改动前** · `apps/frontend/src/utils/speech.ts`（基线，约 L1252–L1258）

```typescript
// 停止所有播放的导出函数（旧版仅清介质，不释放元素）
export function stopAllPlayback(): void {
	// 递增播放世代，使上一轮异步朗读结果作废
	playbackGeneration += 1;
	// 重置云端报错冷却时间戳，使新会话报错能立即 Toast
	lastCloudTtsErrorToastAt = 0;
	// 清除会话内云端来源覆盖（如失败后改走 Edge 的粘滞状态）
	sessionCloudSourceOverride = null;
	// 仅暂停/取消介质，不释放 audio 元素引用
	stopPlaybackMediaOnly();
}
```

**改动后** · `apps/frontend/src/utils/speech.ts`（当前，约 L1252–L1267）

```typescript
// 停止所有播放的导出函数（新版在清介质后彻底释放元素与媒体会话）
export function stopAllPlayback(): void {
	// 递增播放世代，使上一轮异步朗读结果作废
	playbackGeneration += 1;
	// 重置云端报错冷却时间戳，使新会话报错能立即 Toast
	lastCloudTtsErrorToastAt = 0;
	// 清除会话内云端来源覆盖（如失败后改走 Edge 的粘滞状态）
	sessionCloudSourceOverride = null;
	// 第一步：暂停/取消所有介质（本机 speechSynthesis.cancel + 云端 audio.pause）
	stopPlaybackMediaOnly();
	// 仅 pause/清 src 时 Chromium/macOS 仍可能按旧 <audio> 外推 Touch Bar / 控制中心进度条
	// 第二步：彻底丢弃云端 audio 元素引用并释放底层资源
	releaseCloudAudioEl();
	// 第三步：静默用于解锁自动播放策略的解锁音频元素
	silenceCloudAudioUnlock();
	// 第四步：清空 MediaSession 元数据与播放状态；仅在无英语播放 handler 时才卸载 action handler
	clearPlaybackMediaSession({ clearHandlers: !englishPlaybackMediaHandlers });
	// 第五步：下一帧再清一次，确保系统侧在帧结束后收回进度条
	requestAnimationFrame(() => {
		// 再次清空 MediaSession，与上面同样的 handler 保留策略
		clearPlaybackMediaSession({
			// 若英语模块已注册了 play/pause handler 则保留，否则卸载
			clearHandlers: !englishPlaybackMediaHandlers,
		});
	});
}
```

**变更摘要**：新增 `releaseCloudAudioEl()`、`silenceCloudAudioUnlock()`、两次 `clearPlaybackMediaSession()`（含 `requestAnimationFrame` 延迟二次清），确保停止后系统媒体控件不再残留无声进度条。

---

### 4.2 `Layout`（`apps/frontend/src/views/englishLearning/Layout.tsx`）

**对比范围**：`default function Layout` 全组件。

**改动前** · `apps/frontend/src/views/englishLearning/Layout.tsx`（基线，全文）

```typescript
// 英语学习路由壳的文件级注释（旧版仅透传 Outlet，无停播逻辑）
/**
 * 英语学习路由壳：首页、导入、资源库、收藏、拉取结果（stream）等子路由。
 */
// 仅引入路由 Outlet，未引入 React effect 或 location
import { Outlet } from 'react-router';

// 路由壳组件（旧版直接渲染 Outlet，不做任何副作用）
export default function Layout() {
	// 返回一个全高全宽的容器，内部渲染子路由
	return (
		// 容器 div：占满可用高度与宽度
		<div className="h-full min-h-0 w-full min-w-0">
			{/* react-router 的子路由出口 */}
			<Outlet />
		</div>
	);
}
```

**改动后** · `apps/frontend/src/views/englishLearning/Layout.tsx`（当前，全文）

```typescript
// 英语学习路由壳的文件级注释（新版在子页切换/离开时自动停播）
/**
 * 英语学习路由壳：首页、导入、资源库、收藏、拉取结果（stream）等子路由。
 */
// 引入 useEffect 用于卸载副作用
import { useEffect } from 'react';
// 引入 Outlet 渲染子路由、useLocation 获取当前路径
import { Outlet, useLocation } from 'react-router';
// 引入停播函数，卸载时调用
import { stopAllPlayback } from '@/utils/speech';

// 路由壳组件（新版监听路径变化并在卸载时停播）
export default function Layout() {
	// 获取当前路径名与查询串，作为 effect 依赖
	const { pathname, search } = useLocation();

	// 子页切换或离开英语学习时停播，避免跨页继续朗读
	// 依赖 pathname/search：每次子路由变化都会先执行上一轮 cleanup（停播）再重新绑定
	useEffect(() => {
		// cleanup 函数：组件卸载或依赖变化时调用 stopAllPlayback
		return () => stopAllPlayback();
	}, [pathname, search]);

	// 返回一个全高全宽的容器，内部渲染子路由
	return (
		// 容器 div：占满可用高度与宽度
		<div className="h-full min-h-0 w-full min-w-0">
			{/* react-router 的子路由出口 */}
			<Outlet />
		</div>
	);
}
```

**变更摘要**：新增 `useEffect` + `useLocation`，在 `pathname`/`search` 变化或组件卸载时调用 `stopAllPlayback`，实现子页切换与离开模块时自动停播。

---

### 4.3 `playDictationSequence`（`apps/frontend/src/views/englishLearning/practice/hooks/usePracticePlayback.ts`）

**对比范围**：`useCallback` 包裹的 `playDictationSequence` 全函数。

**改动前** · `apps/frontend/src/views/englishLearning/practice/hooks/usePracticePlayback.ts`（基线，约 L55–L69）

```typescript
// 听写三连播回调（旧版不传 cloudSingleUtterance，云端按句读拆 HTTP）
const playDictationSequence = useCallback(
	// 接收当前播放 runId，仅最新 runId 有效
	async (runId: number) => {
		// 循环 DICTATION_PLAY_COUNT 次（默认 3 次）
		for (let i = 0; i < DICTATION_PLAY_COUNT; i += 1) {
			// 若 runId 早于当前，立即中断（用户已发起新一轮播放）
			if (dictationPlayRunRef.current !== runId) return;
			// 朗读答案文本（旧版无 cloudSingleUtterance，云端逐句拆请求）
			await playPreferred(answerText);
			// 播放后再次检查 runId，防止异步期间用户已切题
			if (dictationPlayRunRef.current !== runId) return;
			// 非最后一次播放则等待间隔
			if (i < DICTATION_PLAY_COUNT - 1) {
				// 等待 DICTATION_PLAY_GAP_MS 毫秒后再播下一遍
				await sleepMs(DICTATION_PLAY_GAP_MS);
			}
		}
	},
	// 依赖：答案文本变化时重建回调
	[answerText],
);
```

**改动后** · `apps/frontend/src/views/englishLearning/practice/hooks/usePracticePlayback.ts`（当前，约 L55–L69）

```typescript
// 听写三连播回调（新版传 cloudSingleUtterance:true，云端整段一次合成）
const playDictationSequence = useCallback(
	// 接收当前播放 runId，仅最新 runId 有效
	async (runId: number) => {
		// 循环 DICTATION_PLAY_COUNT 次（默认 3 次）
		for (let i = 0; i < DICTATION_PLAY_COUNT; i += 1) {
			// 若 runId 早于当前，立即中断（用户已发起新一轮播放）
			if (dictationPlayRunRef.current !== runId) return;
			// 朗读答案文本（cloudSingleUtterance:true 使云端整段一次合成，不拆句读）
			await playPreferred(answerText, { cloudSingleUtterance: true });
			// 播放后再次检查 runId，防止异步期间用户已切题
			if (dictationPlayRunRef.current !== runId) return;
			// 非最后一次播放则等待间隔
			if (i < DICTATION_PLAY_COUNT - 1) {
				// 等待 DICTATION_PLAY_GAP_MS 毫秒后再播下一遍
				await sleepMs(DICTATION_PLAY_GAP_MS);
			}
		}
	},
	// 依赖：答案文本变化时重建回调
	[answerText],
);
```

**变更摘要**：`playPreferred(answerText)` → `playPreferred(answerText, { cloudSingleUtterance: true })`，听写连播改为整段一次合成。

---

### 4.4 `playWord` 中的单次播放分支（`apps/frontend/src/views/englishLearning/practice/hooks/usePracticePlayback.ts`）

**对比范围**：`useCallback<PlayWordFn>` 包裹的 `playWord` 函数体中非听写分支（摘录 `try` 块内分支）。

**改动前** · `apps/frontend/src/views/englishLearning/practice/hooks/usePracticePlayback.ts`（基线，约 L101–L106）

```typescript
	// 进入播放 try 块
	try {
		// 听写三连播模式：按序列播三遍
		if (useDictationSequence) {
			// 委托给 playDictationSequence
			await playDictationSequence(runId);
		} else {
			// 非听写模式：单次朗读（旧版无 cloudSingleUtterance）
			await playPreferred(answerText);
		}
	} catch {
```

**改动后** · `apps/frontend/src/views/englishLearning/practice/hooks/usePracticePlayback.ts`（当前，约 L101–L106）

```typescript
	// 进入播放 try 块
	try {
		// 听写三连播模式：按序列播三遍
		if (useDictationSequence) {
			// 委托给 playDictationSequence
			await playDictationSequence(runId);
		} else {
			// 非听写模式：单次朗读（cloudSingleUtterance:true 整段一次合成）
			await playPreferred(answerText, { cloudSingleUtterance: true });
		}
	} catch {
```

**变更摘要**：非听写单次播放同样改为 `cloudSingleUtterance: true`。

---

### 4.5 经典句收藏 · `onTogglePlayQuote`（`apps/frontend/src/views/englishLearning/favorites/classic/index.tsx`）

**对比范围**：`useCallback` 包裹的 `onTogglePlayQuote` 全函数。

**改动前** · `apps/frontend/src/views/englishLearning/favorites/classic/index.tsx`（基线，约 L127–L148）

```typescript
// 经典句收藏列表的播放切换回调（旧版不传 cloudSingleUtterance）
const onTogglePlayQuote = useCallback(
	// 参数：英文原文与列表 key
	async (english: string, key: string) => {
		// 点击当前正在播放的条目：停止并清除高亮
		if (playingKey === key) {
			// 停止所有播放
			stopAllPlayback();
			// 清除播放高亮 key
			setPlayingKey(null);
			return;
		}
		// 点击新条目：先停止旧播放
		stopAllPlayback();
		// 设置新播放高亮 key
		setPlayingKey(key);
		try {
			// 朗读英文原文（旧版无 cloudSingleUtterance，云端逐句拆请求）
			await playPreferred(english);
		} catch {
			// 朗读失败提示不支持
			Toast({
				type: 'warning',
				title: t('englishLearning.tts.unsupported'),
			});
		} finally {
			// 朗读结束（无论成功失败）清除高亮
			setPlayingKey((k) => (k === key ? null : k));
		}
	},
	// 依赖：播放 key 与 i18n 函数
	[playingKey, t],
);
```

**改动后** · `apps/frontend/src/views/englishLearning/favorites/classic/index.tsx`（当前，约 L127–L148）

```typescript
// 经典句收藏列表的播放切换回调（新版传 cloudSingleUtterance:true）
const onTogglePlayQuote = useCallback(
	// 参数：英文原文与列表 key
	async (english: string, key: string) => {
		// 点击当前正在播放的条目：停止并清除高亮
		if (playingKey === key) {
			// 停止所有播放
			stopAllPlayback();
			// 清除播放高亮 key
			setPlayingKey(null);
			return;
		}
		// 点击新条目：先停止旧播放
		stopAllPlayback();
		// 设置新播放高亮 key
		setPlayingKey(key);
		try {
			// 朗读英文原文（cloudSingleUtterance:true 整段一次合成，不拆句读）
			await playPreferred(english, { cloudSingleUtterance: true });
		} catch {
			// 朗读失败提示不支持
			Toast({
				type: 'warning',
				title: t('englishLearning.tts.unsupported'),
			});
		} finally {
			// 朗读结束（无论成功失败）清除高亮
			setPlayingKey((k) => (k === key ? null : k));
		}
	},
	// 依赖：播放 key 与 i18n 函数
	[playingKey, t],
);
```

**变更摘要**：`playPreferred(english)` → `playPreferred(english, { cloudSingleUtterance: true })`。

> 其余经典句朗读入口（`library/classic/index.tsx`、`mistakes/classic/ClassicQuoteMistakesPanel.tsx`、`pack/classic/index.tsx`、`practice/Summary.tsx`）改动模式与上面完全一致——均将 `playPreferred(text)` 改为 `playPreferred(text, { cloudSingleUtterance: true })`，此处不再逐个重复贴码。

---

## 5. 兼容性与影响

- **行为变化（用户可感知）**：
  - 切换英语学习子页或离开英语学习模块时，朗读会立即停止（旧版可能继续）。
  - 点击另一个词条触发停播后，系统媒体控件（Touch Bar / 控制中心 / 蓝牙耳机弹窗）不再残留无声进度条。
  - 经典句/单词云端朗读首包略快（整段一次合成，少一次句读拆分往返）。
- **兼容性**：无破坏性变更。`cloudSingleUtterance` 选项在 `PlayPreferredOptions` 中早已定义（`speech.ts` 约 L497），超厂商字节上限仍会自动回退到 cadence 分段。`releaseCloudAudioEl` / `silenceCloudAudioUnlock` / `clearPlaybackMediaSession` 均为内部函数，下次播放时 `ensureCloudAudioEl()` 会重新创建元素。
- **`clearHandlers` 策略**：`clearPlaybackMediaSession` 传 `clearHandlers: !englishPlaybackMediaHandlers`——若英语模块已注册了 play/pause handler（如听书底栏），停止时**保留** handler 不卸载，避免句间停介质时媒体键短暂失效；仅在没有 handler 时才卸载。

## 6. 风险与回归建议

- **回归测试路径**：
  1. 在收藏/资源库/错题集/词包经典句列表中点击喇叭播放，再点另一条，确认旧声立即停、无串音。
  2. 播放中切换英语学习子页（如收藏 → 资源库），确认声音停止。
  3. 播放中离开英语学习（切到对话/知识库），确认声音停止。
  4. 桌面端播放后停止，检查 Touch Bar / 控制中心进度条是否消失。
  5. 听写练习三连播，确认每遍都能正常播放、间隔正常。
  6. 听书模式（若启用）句间暂停/续播，确认 media handler 未被误卸载导致媒体键失效。
- **边角**：`requestAnimationFrame` 在页面不可见时（如切到后台 Tab）可能被节流延迟执行，但 `stopAllPlayback` 中的同步 `clearPlaybackMediaSession` 已先执行一次，rAF 二次清只是兜底。

## 7. 相关源码路径

| 说明 | 路径 |
| ---- | ---- |
| 朗读核心 · `stopAllPlayback` | `apps/frontend/src/utils/speech.ts` |
| 路由壳 · 自动停播 | `apps/frontend/src/views/englishLearning/Layout.tsx` |
| 经典句收藏 · 朗读 | `apps/frontend/src/views/englishLearning/favorites/classic/index.tsx` |
| 经典句资源库 · 朗读 | `apps/frontend/src/views/englishLearning/library/classic/index.tsx` |
| 经典句错题集 · 朗读 | `apps/frontend/src/views/englishLearning/mistakes/classic/ClassicQuoteMistakesPanel.tsx` |
| 经典句词包 · 朗读 | `apps/frontend/src/views/englishLearning/pack/classic/index.tsx` |
| 练习结算页 · 朗读 | `apps/frontend/src/views/englishLearning/practice/Summary.tsx` |
| 练习播放 hook | `apps/frontend/src/views/englishLearning/practice/hooks/usePracticePlayback.ts` |

---

（若与仓库最新源码不一致，以源码为准）
