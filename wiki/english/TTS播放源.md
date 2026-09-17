# 会员朗读选路：本机 / 云端互斥开关（playbackSource）

> **文档角色（主文档）**：有效会员在语音设置页用 **本机 / MiniMax 云端 / 讯飞云端** 三选一（`PlaybackSourcePicker`）选择朗读默认介质；偏好字段 `playbackSource` 入库并与 `playPreferred` 选路衔接。  
> **Edge 与分模式参数（2026-07）**：已扩展为 **本机 + Edge（全员）+ MiniMax/讯飞（会员）** 与三套独立 prosody——见 [`云端TTS边缘语音.md`](./云端TTS边缘语音.md)（本页 §2–§4 描述改前行为，新选路以该文为准）。  
> **端到端全景**：[`TTS端到端指南.md`](./TTS端到端指南.md)  
> **延伸阅读**：[`讯飞云TTS.md`](../ideas/tts/讯飞云TTS.md)（讯飞在线合成与 Node 18 `ws`）、[`TTS会员路由.md`](./TTS会员路由.md)（各场景调用与 `preferLocal`）、[`语音设置页.md`](./语音设置页.md)（页壳分区）、[`云端TTS偏好数据库.md`](./云端TTS偏好数据库.md)（账号同步表结构）。

若与仓库最新源码不一致，**以源码为准**。

---

## 1. 背景与目标

### 1.1 问题

按会员统一选路后，**有效会员**在英语学习里默认走云端，但部分用户希望长期用浏览器本机音色（省流量、离线、或偏好系统发音）。原先无法在设置里显式切回本机，只能依赖云端失败回退。

### 1.2 改后行为

| 用户 | 语音设置 UI | 喇叭默认介质 |
|------|-------------|--------------|
| **非会员** | 仅本机区块，无 Switch | **本机** Web Speech |
| **有效会员** | 顶栏 **PlaybackSourcePicker** 三选一：本机 / MiniMax 云端 / 讯飞云端 | 由 `playbackSource`：`local` / `cloud` / `xfyun`（失败仍回退本机或硅基） |

**例外**：本机区块 **试听** 仍 `preferLocal: true`，不受 `playbackSource` 影响。

---

## 2. 改动范围

| 路径 | 职责 |
|------|------|
| `apps/backend/src/services/speech-transcription/minimax-tts-user-config.entity.ts` | 列 `playback_source` |
| `apps/backend/src/migrations/1781147319793-tts-type.ts` | 新增列，默认 `'cloud'` |
| `apps/backend/src/services/speech-transcription/dto/upsert-minimax-tts-prefs.dto.ts` | DTO 校验 `local` \| `cloud` |
| `apps/backend/src/services/speech-transcription/minimax-tts-prefs.service.ts` | 读写 `playbackSource` |
| `apps/frontend/src/utils/minimaxTtsPrefs.ts` | 内存缓存、归一化、保存 |
| `apps/frontend/src/utils/speech.ts` | `shouldUseCloudTts` 读 `playbackSource` |
| `apps/frontend/src/views/setting/cloudTts/LocalTtsVoiceSetting.tsx` | 会员本机 Switch |
| `apps/frontend/src/views/setting/cloudTts/index.tsx` | 会员云端 Switch + 参数区随选路禁用 |

---

## 3. 实现思路

### 3.1 单一字段互斥，不拆两套布尔

`playbackSource: 'local' | 'cloud'` 表示**会员**朗读选路。本机 Switch `checked = (source === 'local')`，云端 Switch `checked = (source === 'cloud')`；任一侧切换时 `patch({ playbackSource })`，两侧 UI 自然互斥。

### 3.2 与 `enabled` 的关系

- 打开 **云端 Switch** 时：`patch({ playbackSource: 'cloud', enabled: true })`，表示使用云端并允许自定义参数生效。
- 修改模型/音色/语速等参数字段时，`patch` 内也会 `enabled = true`（与改前「改参即启用自定义」一致）。
- 切到 **本机** 时仅改 `playbackSource`，不强制清参数字段；再次开云端时参数仍在。

### 3.3 播放选路

`shouldUseCloudTts`：非会员恒 `false`；会员读 `loadMinimaxTtsUserPrefs().playbackSource !== 'local'`。`preferLocal: true` 仍最高优先级（试听）。

### 3.4 迁移与默认

新列默认 `'cloud'`，与改前「会员默认云端」兼容；老用户无感知。

---

## 4. 关键代码与注释

### 4.1 实体与默认值

**来源**：`apps/backend/src/services/speech-transcription/minimax-tts-user-config.entity.ts`（约 L50–L52）

```typescript
/** 会员朗读选路：local 本机 Web Speech，cloud 云端 TTS */
@Column({ name: 'playback_source', type: 'varchar', length: 16, default: 'cloud' })
playbackSource!: 'local' | 'cloud';
```

### 4.2 前端选路

**来源**：`apps/frontend/src/utils/speech.ts`（约 L410–L418）

```typescript
/** 会员朗读选路：读内存缓存中的 playbackSource；非会员恒 false */
function shouldUseCloudTts(options?: PlayPreferredOptions): boolean {
	if (options?.preferLocal === true) return false; // 试听等强制本机
	if (options?.preferLocal === false) {
		return isCloudTtsAllowed(); // 显式要云端时仍须是会员
	}
	if (!isCloudTtsAllowed()) return false; // 非会员不走云端
	const prefs = loadMinimaxTtsUserPrefs();
	return prefs.playbackSource !== 'local'; // 会员：仅 local 时走本机
}
```

### 4.3 本机 Switch（会员）

**来源**：`apps/frontend/src/views/setting/cloudTts/LocalTtsVoiceSetting.tsx`（约 L190–L209）

```tsx
{isMemberActive && !playbackPrefsLoading ? (
	<div className="mt-3.5 flex items-center justify-between gap-4 px-8.5 text-sm">
		{/* 说明：文案「使用本机语音朗读」；开 = playbackSource === 'local' */}
		<Switch
			id="local-tts-playback"
			checked={playbackSource === 'local'}
			onCheckedChange={(checked) =>
				onPlaybackSourceChange?.(checked ? 'local' : 'cloud')
			}
		/>
	</div>
) : null}
```

### 4.4 云端 Switch 与参数区

**来源**：`apps/frontend/src/views/setting/cloudTts/index.tsx`（约 L309–L316、L437–L454）

```tsx
const patch = useCallback((partial: Partial<MinimaxTtsUserPrefs>) => {
	setPrefs((prev) => {
		const next = { ...prev, ...partial };
		// 说明：选云端时同步 enabled，自定义参数才会参与合成
		if (partial.playbackSource === 'cloud') {
			next.enabled = true;
		}
		if (loggedInUserId > 0) {
			void saveMinimaxTtsUserPrefs(next, loggedInUserId);
		}
		return next;
	});
}, [loggedInUserId]);

// 云端 Switch：开 = cloud；关 = local（与本机 Switch 同一字段）
<Switch
	checked={prefs.playbackSource === 'cloud'}
	onCheckedChange={(checked) =>
		patch({
			playbackSource: checked ? 'cloud' : 'local',
			enabled: checked,
		})
	}
/>

// 说明：未选云端时整段参数表单 pointer-events-none + 半透明
<div className={cn(
	'my-3.5 flex flex-col gap-4 px-8.5 text-sm',
	prefs.playbackSource !== 'cloud' && 'pointer-events-none opacity-50',
)}>
```

---

## 5. 兼容性与影响

| 项 | 说明 |
|----|------|
| 非会员 | 无 Switch；行为与改前一致（本机） |
| 老会员 | 迁移后 `playback_source = cloud`，与改前默认云端一致 |
| 云端不可用 | 会员选云端时仍 **catch → 本机**（见 `TTS会员路由.md`） |
| 本机音色 | 仍按账号分键存 `localStorage`，与 `playbackSource` 独立 |

### 建议回归

1. 会员：开本机 Switch → 词库/练习喇叭应为本机音色；开云端 → 云端（或回退本机）。
2. 两侧 Switch 联动：开一侧应自动关另一侧。
3. 云端关时参数区不可点；开云端后试听与保存正常。
4. 换设备登录同一账号，`playbackSource` 应同步。

---

## 6. 相关源码路径

| 说明 | 路径 |
|------|------|
| 播放入口 | `apps/frontend/src/utils/speech.ts` |
| 偏好缓存 | `apps/frontend/src/utils/minimaxTtsPrefs.ts` |
| 设置页 | `apps/frontend/src/views/setting/cloudTts/index.tsx`、`LocalTtsVoiceSetting.tsx` |
| 后端表 | `apps/backend/src/services/speech-transcription/minimax-tts-user-config.entity.ts` |
