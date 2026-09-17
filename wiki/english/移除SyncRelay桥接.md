# 移除 SyncRelay 桥接组件（简化跨窗同步架构）

## 1. 背景与目标

**学习笔记跨窗同步**（主窗 ↔ Popout 独立窗）原本设计了三层中继：`syncBus`（BC + Tauri 双通道）→ **`LearningNotesSyncRelay`**（把 sync 消息桥接到 federation-kit 的 `eventBus`）→ 插件侧监听器。

随着 Host 瘦身重构（见 [学习笔记弹窗Host瘦身.md](./学习笔记弹窗Host瘦身.md)），插件已通过 `api.modules.<id>.sync.subscribe` **直接**连接 Host 的 sync 总线，不再需要经由 `eventBus` 中转。本轮改动移除 SyncRelay 这一**冗余中间层**，并同步修正《新插件接入指南》与模块 README 的文档指引，避免后续开发者重复引入不必要的桥接组件。

**核心收益**：
1. 宿主页减少一个挂载组件（`index.tsx` / `popout.tsx` 各少一个 `<LearningNotesSyncRelay />`）
2. 插件文档不再误导开发者写 Sync Relay，改为明确说明「sync.subscribe 直连 Host sync 总线」
3. 消除「syncBus → eventBus → SDK connect」的双路径潜在竞态，跨窗同步只剩一条真相源通道

---

## 2. 改动范围

| 说明 | 路径 |
|------|------|
| 纯删除：SyncRelay 桥接组件源码 | `apps/frontend/src/views/englishLearning/notes/LearningNotesSyncRelay.tsx` |
| 移除 import 与 JSX 挂载（主窗宿主页） | `apps/frontend/src/views/englishLearning/notes/index.tsx` |
| 移除 import 与 JSX 挂载（Popout 宿主页） | `apps/frontend/src/views/englishLearning/notes/popout.tsx` |
| 合并 §9.3/§9.4，去掉 Sync Relay 步骤，更新接入清单表 | `apps/frontend/src/federation/guide.md` |
| 删除 Host 侧 SyncRelay 挂载指引 | `apps/frontend/src/federation/modules/learningNotes/README.md` |

---

## 3. 实现思路

### 3.1 架构简化动机

同步消息（列表刷新、草稿切换等）在主窗与 Popout 窗之间走 `publishLearningNotesSync` → `subscribeLearningNotesSync`（BroadcastChannel + Tauri emit 双通道，详见 [学习笔记同步总线双路径.md](./学习笔记同步总线双路径.md)）。

旧版额外叠加一层 **SyncRelay → eventBus**：
- 组件挂在宿主页，`useEffect` 中 `subscribeLearningNotesSync`，收到消息后通过 `eventBus.emit('learningNotes', \`sync:${msg.type}\`, msg)` 转发到 kit 的 EventBus。
- 设计初衷是「供其它 Host 模块也能监听 sync」，但**实际无任何 Host 代码订阅**该 `sync:*` 事件；插件侧则早已走 `api.modules.learningNotes.sync.subscribe` 直连，**完全不经过 EventBus**。

因此 SyncRelay 在运行时只是**无消费者的纯转发死线**，直接删除无副作用。

### 3.2 删除策略（三步走）

1. **删组件文件**：`LearningNotesSyncRelay.tsx` 整文件删除，避免 import 残留导致编译错误
2. **去两处挂载**：`index.tsx`（主窗）和 `popout.tsx`（独立窗）各删一行 import + 一行 JSX `<LearningNotesSyncRelay />`
3. **同步文档**：
   - `federation/guide.md` §9：删除旧 9.3 「Sync Relay」整节 + 代码示例；旧 9.4 「关窗钩子」升为 9.3，正文补一句「sync.subscribe 直连，无需桥接 eventBus」；接入清单表第 6 行去掉 `+ <LearningNotesSyncRelay />` 字样
   - `modules/learningNotes/README.md` Host 侧列表：删除「挂载 `<LearningNotesSyncRelay />`（可选）」条目

### 3.3 兼容性与开关

- **无用户可感知行为变更**：所有跨窗同步仍通过同一 `syncBus` 发布/订阅；仅消掉一段无消费端的 EventBus 转发
- **无破坏性变更**：`publishLearningNotesSync` / `subscribeLearningNotesSync` / `LearningNotesSyncMessage` 三个对外符号**未被删除**（SyncRelay 文件已删，导出位置不受影响——这三个符号本来就定义在 `federation/modules/learningNotes/syncBus.ts` 并经 `federation/index.ts` re-export）

---

## 4. 关键代码对比与注释

### 4.1 `LearningNotesSyncRelay.tsx`（整文件纯删除）

**对比范围**：完整文件（23 行）—— 基线有、当前已删。按 `code-before-after.md` §4「纯删除」例外，只展示改动前。

**改动前** · `apps/frontend/src/views/englishLearning/notes/LearningNotesSyncRelay.tsx`（基线，约 L1–L23）

```tsx
// 从 federation-kit 导入全局 EventBus，旧架构用它把 sync 消息二次转发给 Host 其它模块
import { eventBus } from '@dnhyxc-ai/federation-kit';
// 引入 React useEffect：组件挂载时订阅、卸载时取消订阅（返回值 cleanup）
import { useEffect } from 'react';
// 从 Host federation barrel 引入 sync 相关类型与函数
import {
	// 声明入参 msg 的类型：跨窗同步消息的联合类型
	type LearningNotesSyncMessage,
	// SyncRelay 原样转发 publishLearningNotesSync（实际并未用到，属于冗余 re-export）
	publishLearningNotesSync,
	// 核心：订阅 sync 总线（BroadcastChannel + Tauri listen 双通道）的回调
	subscribeLearningNotesSync,
// barrel 导入闭合
} from '@/federation';

// 固定插件 ID，EventBus 命名空间 emit 时作为 domain 前缀
const PLUGIN_ID = 'learningNotes';

/** 组件注释原文：跨窗 sync → MF EventBus 桥接；原文档动机见 specs/learning-notes-popout-window.md §2.2 */
// 导出无 UI 小组件：只在 useEffect 中订阅/转发，render 返回 null 不占 DOM
export function LearningNotesSyncRelay() {
	// 组件挂载即启动订阅：返回 unsubscribe 供 React 卸载时自动调用，避免内存泄漏
	useEffect(() => {
		// 订阅 sync 总线，收到任意跨窗消息时回调被触发
		return subscribeLearningNotesSync((msg) => {
			// 仅转发带 windowId 的消息（过滤掉本窗自自发的无 windowId 消息，防止回环）
			if (msg.windowId && 'windowId' in msg) {
				// 二次转发：把 sync 事件转换为 EventBus 事件（命名空间 learningNotes，事件名 sync:<type>）
				eventBus.emit(PLUGIN_ID, `sync:${msg.type}`, msg);
			// 结束 if：有 windowId 的分支
			}
		// 结束 subscribeLearningNotesSync 回调与调用括号
		});
	// 依赖数组为空：仅挂载时执行一次订阅、卸载时 cleanup；与外部数据无联动
	}, []);
	// 无 UI 渲染：返回 null，纯做副作用桥接
	return null;
// 结束 LearningNotesSyncRelay 组件函数体
}

// 额外 re-export：把 sync 类型与 publish 函数再导出一次（实际使用方都从 @/federation 直接拿，冗余）
export { type LearningNotesSyncMessage, publishLearningNotesSync };
```

**变更摘要**：整文件删除。SyncRelay 的 `subscribeLearningNotesSync → eventBus.emit` 中继链路无任何实际消费者，删除后跨窗同步仍走 `syncBus` 原始发布/订阅通道直达插件 SDK，行为不变。

---

### 4.2 `EnglishLearningNotesPage`（主窗宿主页）

**对比范围**：`apps/frontend/src/views/englishLearning/notes/index.tsx` 完整组件（import 区 + 默认导出函数 + JSX return）。

**改动前** · `apps/frontend/src/views/englishLearning/notes/index.tsx`（基线，约 L1–L49）

```tsx
/**
 * 文件头注释第 1 行：模块说明——英语学习下的学习笔记 MF 插件宿主页
 */
/**
 * 文件头注释第 2 行：偏好未就绪时不要渲染「已下架」，避免 PluginHostPage 重复动画
 */
/**
 * 文件头注释第 3 行：Loading 只交给 PluginHostPage，避免两段动画断裂
 */

// 从 React 导入 useEffect（偏好加载门闩）与 useState（布尔状态记录偏好是否已加载）
import { useEffect, useState } from 'react';
// 从 federation barrel 导入三项：偏好预加载函数、插件宿主页通用组件、查询插件是否启用的 Hook
import {
	// 异步加载插件启用偏好，resolve 后视为「准备就绪」
	ensurePluginEnabledPrefsLoaded,
	// 通用宿主页壳：负责加载 remote、挂载插件、处理 delisted 等情况
	PluginHostPage,
	// 查询指定 pluginId 是否被用户启用（受偏好存储控制）
	usePluginEnabled,
// federation 导入组闭合
} from '@/federation';
// 导入国际化 Hook，读取 plugins.host.delisted（已下架）等翻译文案
import { useI18n } from '@/hooks';
// 旧版导入 SyncRelay：把 sync 消息桥接到 EventBus（本轮移除）
import { LearningNotesSyncRelay } from './LearningNotesSyncRelay';

// 默认导出函数组件：路由 /english-learning/notes 的宿主页
export default function EnglishLearningNotesPage() {
	// 解构 i18n 翻译函数 t
	const { t } = useI18n();
	// 查询 learningNotes 插件的启用状态（布尔）
	const enabled = usePluginEnabled('learningNotes');
	// 偏好加载完成状态：false 时页面不展示下架提示
	const [prefsReady, setPrefsReady] = useState(false);

	// 组件挂载时一次性触发偏好加载，防止 race condition 误判 enabled
	useEffect(() => {
		// 取消标记：组件卸载后不再调用 setState（React 避免内存泄漏的惯用写法）
		let cancelled = false;
		// 触发偏好预加载 Promise，完成后无条件 finally（忽略成败，就绪就行）
		void ensurePluginEnabledPrefsLoaded().finally(() => {
			// 若未被卸载则标记偏好就绪
			if (!cancelled) setPrefsReady(true);
		// finally 回调闭合
		});
		// 卸载时把 cancelled 置 true，防止 stale setState
		return () => {
			// cancel flag 置位
			cancelled = true;
		// cleanup 函数闭合
		};
	// 空依赖：仅挂载时跑一次
	}, []);

	// JSX 返回值：整页 flex 列布局，min-h-0 让内部 overflow 正确继承高度
	return (
		// 最外层容器：全宽全高、弹性列布局、min-h-0 防止溢出祖先
		<div className="flex h-full min-h-0 w-full flex-col">
			// 旧版挂载 SyncRelay 桥接组件（无 UI、纯副作用、本轮移除）
			<LearningNotesSyncRelay />
			// 内容容器：p-5.5 水平内边距、pt-0 顶部不留距，box-border 确保 padding 不撑宽撑高
			<div className="box-border flex h-full min-h-0 w-full min-w-0 flex-col p-5.5 pt-0">
				// 插件渲染区：圆角 + 主题背景色，内容超出则滚动
				<div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-md bg-theme-background">
					// 偏好就绪且插件未启用时：展示下架提示
					{prefsReady && !enabled ? (
						// 下架提示段落：降低不透明度、加 4.5 内边距（视觉呼吸感）
						<p className="text-textcolor/55 p-4.5">
							// 读取插件下架翻译文案
							{t('plugins.host.delisted')}
						// 段落闭合
						</p>
					// 否则：挂载 PluginHostPage 加载 learningNotes 插件
					) : (
						// 通用插件宿主页组件：指定 pluginId、className 让插件占满内容区
						<PluginHostPage
							// 插件 ID，必须与 registry 中的 id 完全一致
							pluginId="learningNotes"
							// 全高 + 去默认 padding，让插件内部决定留白
							className="h-full min-h-0 p-0"
						// PluginHostPage 自闭合
						/>
					// 三元表达式闭合
					)}
				// 插件渲染区 div 闭合
				</div>
			// 内容容器 div 闭合
			</div>
		// 最外层容器闭合
		</div>
	// return JSX 闭合
	);
// EnglishLearningNotesPage 函数体闭合
}
```

**改动后** · `apps/frontend/src/views/englishLearning/notes/index.tsx`（当前，约 L1–L48）

```tsx
/**
 * 文件头注释第 1 行：模块说明——英语学习下的学习笔记 MF 插件宿主页
 */
/**
 * 文件头注释第 2 行：偏好未就绪时不要渲染「已下架」，避免 PluginHostPage 重复动画
 */
/**
 * 文件头注释第 3 行：Loading 只交给 PluginHostPage，避免两段动画断裂
 */

// 从 React 导入 useEffect（偏好加载门闩）与 useState（布尔状态记录偏好是否已加载）
import { useEffect, useState } from 'react';
// 从 federation barrel 导入三项：偏好预加载函数、插件宿主页通用组件、查询插件是否启用的 Hook
import {
	// 异步加载插件启用偏好，resolve 后视为「准备就绪」
	ensurePluginEnabledPrefsLoaded,
	// 通用宿主页壳：负责加载 remote、挂载插件、处理 delisted 等情况
	PluginHostPage,
	// 查询指定 pluginId 是否被用户启用（受偏好存储控制）
	usePluginEnabled,
// federation 导入组闭合
} from '@/federation';
// 导入国际化 Hook，读取 plugins.host.delisted（已下架）等翻译文案
import { useI18n } from '@/hooks';

// 默认导出函数组件：路由 /english-learning/notes 的宿主页
export default function EnglishLearningNotesPage() {
	// 解构 i18n 翻译函数 t
	const { t } = useI18n();
	// 查询 learningNotes 插件的启用状态（布尔）
	const enabled = usePluginEnabled('learningNotes');
	// 偏好加载完成状态：false 时页面不展示下架提示
	const [prefsReady, setPrefsReady] = useState(false);

	// 组件挂载时一次性触发偏好加载，防止 race condition 误判 enabled
	useEffect(() => {
		// 取消标记：组件卸载后不再调用 setState（React 避免内存泄漏的惯用写法）
		let cancelled = false;
		// 触发偏好预加载 Promise，完成后无条件 finally（忽略成败，就绪就行）
		void ensurePluginEnabledPrefsLoaded().finally(() => {
			// 若未被卸载则标记偏好就绪
			if (!cancelled) setPrefsReady(true);
		// finally 回调闭合
		});
		// 卸载时把 cancelled 置 true，防止 stale setState
		return () => {
			// cancel flag 置位
			cancelled = true;
		// cleanup 函数闭合
		};
	// 空依赖：仅挂载时跑一次
	}, []);

	// JSX 返回值：整页 flex 列布局，min-h-0 让内部 overflow 正确继承高度
	return (
		// 最外层容器：全宽全高、弹性列布局、min-h-0 防止溢出祖先
		<div className="flex h-full min-h-0 w-full flex-col">
			// 内容容器：p-5.5 水平内边距、pt-0 顶部不留距，box-border 确保 padding 不撑宽撑高
			<div className="box-border flex h-full min-h-0 w-full min-w-0 flex-col p-5.5 pt-0">
				// 插件渲染区：圆角 + 主题背景色，内容超出则滚动
				<div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-md bg-theme-background">
					// 偏好就绪且插件未启用时：展示下架提示
					{prefsReady && !enabled ? (
						// 下架提示段落：降低不透明度、加 4.5 内边距（视觉呼吸感）
						<p className="text-textcolor/55 p-4.5">
							// 读取插件下架翻译文案
							{t('plugins.host.delisted')}
						// 段落闭合
						</p>
					// 否则：挂载 PluginHostPage 加载 learningNotes 插件
					) : (
						// 通用插件宿主页组件：指定 pluginId、className 让插件占满内容区
						<PluginHostPage
							// 插件 ID，必须与 registry 中的 id 完全一致
							pluginId="learningNotes"
							// 全高 + 去默认 padding，让插件内部决定留白
							className="h-full min-h-0 p-0"
						// PluginHostPage 自闭合
						/>
					// 三元表达式闭合
					)}
				// 插件渲染区 div 闭合
				</div>
			// 内容容器 div 闭合
			</div>
		// 最外层容器闭合
		</div>
	// return JSX 闭合
	);
// EnglishLearningNotesPage 函数体闭合
}
```

**变更摘要**：移除一行 `import { LearningNotesSyncRelay } from './LearningNotesSyncRelay'`；移除 JSX 中 `<LearningNotesSyncRelay />`（紧邻最外层容器下一行）。其余 import、门闩逻辑、插件挂载结构完全不变。

---

### 4.3 `EnglishLearningNotesPopoutPage`（Popout 独立窗宿主页）

**对比范围**：`apps/frontend/src/views/englishLearning/notes/popout.tsx` 完整组件（import 区 + 默认导出函数 + 登录守卫 + JSX return 嵌入 PopoutShell）。

**改动前** · `apps/frontend/src/views/englishLearning/notes/popout.tsx`（基线，约 L1–L56）

```tsx
/**
 * 文件头注释：学习笔记独立窗口——无宿主侧栏，主题与主窗通过 useHostAppearanceSync 同步
 */
// 导入 React 基础 Hook：useEffect 用于偏好加载门闩、useState 存偏好就绪状态
import { useEffect, useState } from 'react';
// 导入 Navigate：未登录时重定向到 /login
import { Navigate } from 'react-router';
// 从 federation barrel 导入插件宿主页三件套（与主窗同款）
import {
	// 加载插件启用偏好
	ensurePluginEnabledPrefsLoaded,
	// 通用宿主页壳
	PluginHostPage,
	// 查询启用状态
	usePluginEnabled,
// federation 导入组闭合
} from '@/federation';
// 导入主题/外观同步（跨窗主题强调色/语言一致）与 i18n Hook
import { useHostAppearanceSync, useI18n, useTheme } from '@/hooks';
// 导入登录守卫工具：判断本地是否有可用 auth token
import { hasValidAuthToken } from '@/router/authPaths';
// 导入 Popout 外壳（提供 Tauri 拖拽区、padding、关窗保存等）
import { LearningNotesPopoutShell } from './LearningNotesPopoutShell';
// 旧版导入 SyncRelay（与主窗相同，本轮移除）
import { LearningNotesSyncRelay } from './LearningNotesSyncRelay';
// 导入关窗保存 Hook：注册 beforeClose、Tauri 关窗前 await 保存
import { useLearningNotesPopoutCloseSave } from './usePopoutCloseSave';

// 默认导出函数组件：路由 /english-learning/notes/popout 的独立窗宿主页
export default function EnglishLearningNotesPopoutPage() {
	// 解构 i18n 翻译函数
	const { t } = useI18n();
	// 应用主题 token（子窗独立渲染需要读主题上下文）
	useTheme();
	// 外观同步：监听主窗广播的主题/强调色/语言变更，本窗即时同步
	useHostAppearanceSync();
	// 关窗保存：注册 beforeClose 回调，实际在 usePopoutCloseSave 内实现
	useLearningNotesPopoutCloseSave();
	// 查询 learningNotes 插件启用状态（与主窗同款）
	const enabled = usePluginEnabled('learningNotes');
	// 偏好就绪布尔状态
	const [prefsReady, setPrefsReady] = useState(false);

	// 偏好加载门闩 effect：与主窗 index.tsx 实现完全相同
	useEffect(() => {
		// 取消标记
		let cancelled = false;
		// 触发偏好预加载
		void ensurePluginEnabledPrefsLoaded().finally(() => {
			// 未卸载则置就绪
			if (!cancelled) setPrefsReady(true);
		// finally 闭合
		});
		// 卸载 cleanup：置 cancelled
		return () => {
			// cancel flag 置位
			cancelled = true;
		// cleanup 闭合
		};
	// 空依赖
	}, []);

	// 登录守卫：无有效 token 时重定向到登录页（replace 避免进 history 栈）
	if (!hasValidAuthToken()) {
		// React Router Navigate 组件：立即执行跳转
		return <Navigate to="/login" replace />;
	// 登录守卫 if 闭合
	}

	// JSX 返回：嵌入 LearningNotesPopoutShell 壳（提供拖拽区与 padding）
	return (
		// PopoutShell：外壳含 data-tauri-drag-region 拖拽条、padding 等
		<LearningNotesPopoutShell>
			// 旧版在此也挂一份 SyncRelay（独立窗同样要把 sync → EventBus；本轮移除）
			<LearningNotesSyncRelay />
			// 内容容器：弹性列、占满剩余空间、溢出滚动、圆角主题背景（与主窗同款）
			<div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-md bg-theme-background">
				// 偏好就绪且插件未启用 → 下架提示（与主窗同款）
				{prefsReady && !enabled ? (
					// 下架段落：半透明文字 + padding
					<p className="text-textcolor/55 p-4.5">
						// 读取翻译文案
						{t('plugins.host.delisted')}
					// p 闭合
					</p>
				// 否则挂载 PluginHostPage
				) : (
					// 通用宿主页：learningNotes 插件、去默认 padding、全高
					<PluginHostPage
						// 插件 ID
						pluginId="learningNotes"
						// className 让插件占满内容区
						className="h-full min-h-0 p-0"
					// 自闭合
					/>
				// 三元闭合
				)}
			// 内容容器闭合
			</div>
		// PopoutShell 闭合
		</LearningNotesPopoutShell>
	// return JSX 闭合
	);
// 函数体闭合
}
```

**改动后** · `apps/frontend/src/views/englishLearning/notes/popout.tsx`（当前，约 L1–L54）

```tsx
/**
 * 文件头注释：学习笔记独立窗口——无宿主侧栏，主题与主窗通过 useHostAppearanceSync 同步
 */
// 导入 React 基础 Hook：useEffect 用于偏好加载门闩、useState 存偏好就绪状态
import { useEffect, useState } from 'react';
// 导入 Navigate：未登录时重定向到 /login
import { Navigate } from 'react-router';
// 从 federation barrel 导入插件宿主页三件套（与主窗同款）
import {
	// 加载插件启用偏好
	ensurePluginEnabledPrefsLoaded,
	// 通用宿主页壳
	PluginHostPage,
	// 查询启用状态
	usePluginEnabled,
// federation 导入组闭合
} from '@/federation';
// 导入主题/外观同步（跨窗主题强调色/语言一致）与 i18n Hook
import { useHostAppearanceSync, useI18n, useTheme } from '@/hooks';
// 导入登录守卫工具：判断本地是否有可用 auth token
import { hasValidAuthToken } from '@/router/authPaths';
// 导入 Popout 外壳（提供 Tauri 拖拽区、padding、关窗保存等）
import { LearningNotesPopoutShell } from './LearningNotesPopoutShell';
// 导入关窗保存 Hook：注册 beforeClose、Tauri 关窗前 await 保存
import { useLearningNotesPopoutCloseSave } from './usePopoutCloseSave';

// 默认导出函数组件：路由 /english-learning/notes/popout 的独立窗宿主页
export default function EnglishLearningNotesPopoutPage() {
	// 解构 i18n 翻译函数
	const { t } = useI18n();
	// 应用主题 token（子窗独立渲染需要读主题上下文）
	useTheme();
	// 外观同步：监听主窗广播的主题/强调色/语言变更，本窗即时同步
	useHostAppearanceSync();
	// 关窗保存：注册 beforeClose 回调，实际在 usePopoutCloseSave 内实现
	useLearningNotesPopoutCloseSave();
	// 查询 learningNotes 插件启用状态（与主窗同款）
	const enabled = usePluginEnabled('learningNotes');
	// 偏好就绪布尔状态
	const [prefsReady, setPrefsReady] = useState(false);

	// 偏好加载门闩 effect：与主窗 index.tsx 实现完全相同
	useEffect(() => {
		// 取消标记
		let cancelled = false;
		// 触发偏好预加载
		void ensurePluginEnabledPrefsLoaded().finally(() => {
			// 未卸载则置就绪
			if (!cancelled) setPrefsReady(true);
		// finally 闭合
		});
		// 卸载 cleanup：置 cancelled
		return () => {
			// cancel flag 置位
			cancelled = true;
		// cleanup 闭合
		};
	// 空依赖
	}, []);

	// 登录守卫：无有效 token 时重定向到登录页（replace 避免进 history 栈）
	if (!hasValidAuthToken()) {
		// React Router Navigate 组件：立即执行跳转
		return <Navigate to="/login" replace />;
	// 登录守卫 if 闭合
	}

	// JSX 返回：嵌入 LearningNotesPopoutShell 壳（提供拖拽区与 padding）
	return (
		// PopoutShell：外壳含 data-tauri-drag-region 拖拽条、padding 等
		<LearningNotesPopoutShell>
			// 内容容器：弹性列、占满剩余空间、溢出滚动、圆角主题背景（与主窗同款）
			<div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-md bg-theme-background">
				// 偏好就绪且插件未启用 → 下架提示（与主窗同款）
				{prefsReady && !enabled ? (
					// 下架段落：半透明文字 + padding
					<p className="text-textcolor/55 p-4.5">
						// 读取翻译文案
						{t('plugins.host.delisted')}
					// p 闭合
					</p>
				// 否则挂载 PluginHostPage
				) : (
					// 通用宿主页：learningNotes 插件、去默认 padding、全高
					<PluginHostPage
						// 插件 ID
						pluginId="learningNotes"
						// className 让插件占满内容区
						className="h-full min-h-0 p-0"
					// 自闭合
					/>
				// 三元闭合
				)}
			// 内容容器闭合
			</div>
		// PopoutShell 闭合
		</LearningNotesPopoutShell>
	// return JSX 闭合
	);
// 函数体闭合
}
```

**变更摘要**：移除 import `LearningNotesSyncRelay` 一行；移除 JSX 中 `<LearningNotesSyncRelay />`（PopoutShell 内部、内容容器前一行）。其余 PopoutShell、关窗保存、登录守卫、PluginHostPage 挂载等逻辑均保持不变。

---

### 4.4 `federation/guide.md` 跨窗 sync 章节（§9.3 → §9.3 合并）与清单表

#### 4.4.1 §9.3/§9.4 步骤合并

**对比范围**：`apps/frontend/src/federation/guide.md` 第 9 章「跨窗 sync」中 9.3 与 9.4 两节（含 Sync Relay 代码示例）。

**改动前** · `apps/frontend/src/federation/guide.md`（基线，约 L499–L520）

```markdown
<!-- 旧版三级标题：声明这一步是可选的，供想把 sync 消息桥到 EventBus 的开发者使用 -->
### 9.3 步骤三（可选）：Host 侧 Sync Relay

<!-- 正文第 1 段：说明动机——转发到 EventBus；并给出参考文件链接 -->
若要把 sync 消息转发到 kit `eventBus`（供其它 Host 模块监听），在宿主页挂小组件（参考 [`LearningNotesSyncRelay.tsx`](../../views/englishLearning/notes/LearningNotesSyncRelay.tsx)）：

<!-- 代码块：给出 MyPluginSyncRelay 组件示例，可作为第三方插件开发者复制粘贴的模板 -->
```tsx
<!-- 从 federation-kit 导入全局 EventBus：用于把 sync 消息二次 emit -->
import { eventBus } from '@dnhyxc-ai/federation-kit';
<!-- 从 Host federation barrel 导入插件专属的 sync 订阅函数 -->
import { subscribeMyPluginSync } from '@/federation';

<!-- 导出小组件：命名带 MyPlugin，提示开发者替换为自己的插件 ID -->
export function MyPluginSyncRelay() {
<!-- 挂载时订阅：返回 unsubscribe 做 cleanup -->
  useEffect(() => {
<!-- 订阅插件 sync 总线：收到每条消息就触发回调 -->
    return subscribeMyPluginSync((msg) => {
<!-- 二次转发到 EventBus：domain=myPlugin、事件名=sync:<type>、载荷=原 msg -->
      eventBus.emit('myPlugin', `sync:${msg.type}`, msg);
<!-- subscribe 回调与调用闭合 -->
    });
<!-- 空依赖数组：仅挂载时订阅一次 -->
  }, []);
<!-- 无 UI：返回 null 不占 DOM -->
  return null;
<!-- 组件函数体闭合 -->
}
<!-- 示例代码块结束 -->
```

<!-- 旧版 9.4：独立小节，说明关窗保存机制 -->
### 9.4 步骤四：Popout 关窗钩子（按需）

<!-- 正文：给出 learningNotes 的做法，让新插件照葫芦画瓢 -->
参考 learningNotes：`registerBeforeClose` + Host 侧 `runXxxBeforeCloseHandlers`，在 Tauri 关窗前 await 保存。

<!-- 指引读者阅读 learningNotes 模块的具体 README -->
 详见 [`modules/learningNotes/README.md`](./modules/learningNotes/README.md)。
```

**改动后** · `apps/frontend/src/federation/guide.md`（当前，约 L499–L506）

```markdown
<!-- 新版合并后的 9.3：删除旧 9.3 Sync Relay 节，原 9.4 升为新 9.3，步骤编号整体前移一位 -->
### 9.3 步骤三：Popout 关窗钩子（按需）

<!-- 新增声明一句：明确告知开发者 sync 订阅的推荐姿势——直接从 hostApi 暴露的 sync.subscribe，不再需要 Sync Relay -->
插件跨窗同步走 `api.modules.<id>.sync.subscribe`（直连 Host sync 总线），无需再桥接到 kit `eventBus`。

<!-- 原 9.4 的正文整体保留：仍是 learningNotes 的关窗保存参考实现 -->
关窗保存参考 learningNotes：`registerBeforeClose` + Host 侧 `runXxxBeforeCloseHandlers`，在 Tauri 关窗前 await 保存。

<!-- 保留 learningNotes 模块 README 链接指引 -->
详见 [`modules/learningNotes/README.md`](./modules/learningNotes/README.md)。
```

**变更摘要**：删除「步骤三（可选）Host 侧 Sync Relay」整节（含 MyPluginSyncRelay 代码示例与 LearningNotesSyncRelay.tsx 参考链接）；原「步骤四 关窗钩子」升为步骤三；在关窗钩子正文前补一句「sync.subscribe 直连 Host sync 总线、无需桥接 eventBus」，消除开发者的错误心智。

#### 4.4.2 learningNotes 接入清单表（第 6 行）

**对比范围**：`apps/frontend/src/federation/guide.md` §12「learningNotes 完整接入清单」表格中第 6 行。

**改动前** · `apps/frontend/src/federation/guide.md`（基线，约 L606）

```markdown
<!-- 清单表第 6 行（左列步骤编号 6）：中列文件路径、右列动作描述含加号拼接两个职责 -->
| 6 | `views/englishLearning/notes/index.tsx` | `PluginHostPage` + `<LearningNotesSyncRelay />` |
```

**改动后** · `apps/frontend/src/federation/guide.md`（当前，约 L592）

```markdown
<!-- 清单表第 6 行：右列动作描述简化为只有 PluginHostPage——移除加号和 SyncRelay 字样，与实际代码一致 -->
| 6 | `views/englishLearning/notes/index.tsx` | `PluginHostPage` |
```

**变更摘要**：清单表第 6 行右列去掉 `+ <LearningNotesSyncRelay />`，反映宿主页不再需要挂载 Sync Relay 组件。

---

### 4.5 `modules/learningNotes/README.md` Host 侧章节

**对比范围**：`apps/frontend/src/federation/modules/learningNotes/README.md` 中「## Host 侧」小节的 bullet 列表。

**改动前** · `apps/frontend/src/federation/modules/learningNotes/README.md`（基线，约 L18–L21）

```markdown
<!-- Host 侧小节标题：声明以下是 Host 端开发需要关注的两件事（旧版两件：SyncRelay 挂载 + 关窗保存） -->
## Host 侧

<!-- 旧版第一条 bullet：明确提示宿主页要挂 SyncRelay，并解释作用是桥接、标注可选（本轮移除） -->
- 宿主页挂载 `<LearningNotesSyncRelay />`（sync → EventBus 桥接，可选）
<!-- 第二条 bullet（保留）：Popout 关窗时执行 beforeClose 队列保存，并给出 Hook 路径参考 -->
- Popout 关窗 → `runLearningNotesBeforeCloseHandlers`（[`usePopoutCloseSave`](../../../views/englishLearning/notes/usePopoutCloseSave.ts)）
```

**改动后** · `apps/frontend/src/federation/modules/learningNotes/README.md`（当前，约 L18–L20）

```markdown
<!-- Host 侧小节标题：声明以下是 Host 端开发需要关注的事项（新版只剩一件：关窗保存） -->
## Host 侧

<!-- 唯一一条 bullet：Popout 关窗时执行 beforeClose 队列保存；内容与旧版完全一致，只是上移一位 -->
- Popout 关窗 → `runLearningNotesBeforeCloseHandlers`（[`usePopoutCloseSave`](../../../views/englishLearning/notes/usePopoutCloseSave.ts)）
```

**变更摘要**：删除 Host 侧第一条「挂载 `<LearningNotesSyncRelay />`」bullet。剩余关窗保存条目保持原文不变。

---

## 5. 兼容性与影响

| 维度 | 评估 |
|------|------|
| 用户可见行为 | **无**。跨窗同步（列表刷新、草稿切换等）走同一 `syncBus`，仅移除无消费者的 EventBus 中转。 |
| 对外导出符号 | `LearningNotesSyncMessage` / `publishLearningNotesSync` / `subscribeLearningNotesSync` 定义在 `syncBus.ts` 并经 `federation/index.ts` re-export，**不受删除影响**。旧 SyncRelay 文件的同名 re-export 实为冗余镜像。 |
| EventBus 消费方检查 | 仓库内**无**任何 `eventBus.on('learningNotes', 'sync:')` 订阅；grep 亦无其它模块通过 EventBus 监听 learningNotes sync。删除为安全操作。 |
| 回归建议 | 手动验证三条：① 主窗打开笔记 → 点「独立窗口」→ Popout 成功弹出；② Popout 编辑 → 主窗笔记列表自动刷新；③ Popout 关窗 → Tauri 关闭前触发保存（橙点消失）。 |
| 插件开发指引 | 第三方插件开发者参考 `federation/guide.md` §9 时不再被误导写 Sync Relay。若有外部插件已自行实现 SyncRelay，移除与否不影响功能（保留也无害，只是多一次无消费的 emit）。 |

---

## 6. 相关源码路径

| 说明 | 路径 |
|------|------|
| 学习笔记 sync 总线（BC + Tauri 双通道，真正的发布订阅实现） | `apps/frontend/src/federation/modules/learningNotes/syncBus.ts` |
| learningNotes Host 模块 API（暴露 `sync.subscribe`） | `apps/frontend/src/federation/modules/learningNotes/hostApi.ts` |
| 插件 SDK connectLearningNotes（直连 `api.modules.*.sync.subscribe`） | `apps/frontend/node_modules/@dnhyxc-ai/plugin-host-sdk/src/connectLearningNotes.ts`（或 SDK 同目录 learningNotes 相关文件） |
| Host 瘦身重构（本轮架构的前置） | [docs/english/学习笔记弹窗Host瘦身.md](./学习笔记弹窗Host瘦身.md) |
| Sync 总线双路径（BroadcastChannel + Tauri emit 实现细节） | [docs/english/学习笔记同步总线双路径.md](./学习笔记同步总线双路径.md) |
| 学习笔记独立弹窗（关窗保存机制 `registerBeforeClose`） | [docs/english/学习笔记独立弹窗.md](./学习笔记独立弹窗.md) |

---

（若与仓库最新源码不一致，以源码为准）
