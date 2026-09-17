# 学习笔记弹窗 Host 瘦身重构

## 0. 延伸阅读

- [学习笔记独立弹窗.md](./学习笔记独立弹窗.md) — 弹窗与多窗口同步的**初版架构**（Host 重量级：StoreSync + DomSync + HttpSync + CloseSave + PatchPlugin）。本文记录对初版的**瘦身重构**：将同步业务从 Host 层移入插件，Host 只保留通道。
- [学习笔记图片上传与回收.md](./学习笔记图片上传与回收.md) — 笔记图片云端化（与本重构无耦合，独立功能域）。

---

## 1. 背景与目标

### 1.1 初版架构的问题

初版「学习笔记独立弹窗与多窗口同步」将**全部同步逻辑放在 Host 仓**，通过六层文件实现：

| 层 | 文件 | 职责 |
| --- | --- | --- |
| 总线 | `learningNotesSyncBus.ts` | BroadcastChannel 跨窗消息 |
| Store 同步 | `learningNotesStoreSync.ts`（299 行） | 绑定插件 MobX store、`applyRemoteDraft/Saved/Deleted`、`refreshLearningNotesListIfOpen`、`tryGetLearningNotesStoreFromGlobal` |
| DOM 兜底 | `learningNotesDomSync.ts`（265 行） | ProseMirror DOM 级 `execCommand` 读写、`shouldRemountLearningNotesOnListChange`、keepalive 保存 |
| HTTP 包装 | `learningNotesHttpSync.ts`（232 行） | `wrapLearningNotesHttp` 拦截笔记增删改请求自动广播、`saveLearningNoteAwait`、`saveLearningNoteKeepalive` |
| 关窗保存 | `learningNotesCloseSave.ts`（124 行） | `saveLearningNotesOnWindowClose` 编排 autoSaveIfDirty → await fetch → keepalive |
| 插件 Patch | `patchLearningNotesPlugin.ts`（49 行） | monkey-patch `PluginManager.ensurePlugin`，包装插件 `default` 组件注入同步 |
| Host API | `learningNotesHostApi.ts`（101 行） | `connectStore` + 内部 `subscribeLearningNotesSync` + `publishLocalStateSnapshot` |

问题：

1. **Host 与插件内部强耦合**：Host 直接读插件 MobX store（`window.__DNHYXC_LN_STORE__`）、操作 ProseMirror DOM（`querySelector('.ProseMirror')`）、拦截 HTTP 请求——插件内部重构（换状态库、换编辑器、改 API 路径）都会打断 Host 同步。
2. **monkey-patch 脆弱**：`patchLearningNotesPluginManager` 包装 `manager.ensurePlugin`，依赖插件 `default` 是函数组件；插件改导出形态即失效。
3. **六层文件职责重叠**：StoreSync / DomSync / HttpSync 三条路径做同一件事（广播变更），CloseSave 又在它们之上编排保存，维护成本高。
4. **Host 不该知道业务**：Host 的职责是提供通道（窗口管理、BroadcastChannel、关窗钩子），而非实现笔记的保存 / 刷新 / DOM 操作。

### 1.2 重构目标

**Host 只提供通道，业务在插件内。**

- Host 保留：窗口身份（`isPopoutWindow` / `getWindowId`）、同步总线（`sync.publish*` / `subscribe`）、关窗前钩子（`registerBeforeClose`）、初始 noteId 传递（`consumeInitialNoteId`）。
- Host 移除：MobX store 绑定、ProseMirror DOM 操作、HTTP 包装与自动广播、插件 monkey-patch、关窗保存编排。
- 插件自行：注册 `beforeClose` 回调做保存；订阅 `sync.subscribe` 做协议分发（`applyRemote` / `refreshList`）；调 `sync.publish*` 广播变更。

---

## 2. 改动范围

### 2.1 删除（6 个文件，纯删除）

| 文件 | 原行数 | 原职责 |
| --- | --- | --- |
| `apps/frontend/src/federation/capabilities/learningNotesPopout.ts` | 4 | `isLearningNotesPopoutPath()` 路径判断 → 移入 HostApi 内联 |
| `apps/frontend/src/federation/capabilities/learningNotesStoreSync.ts` | 299 | MobX store 绑定 + `applyRemote*` + `refreshLearningNotesListIfOpen` → 移入插件 |
| `apps/frontend/src/federation/capabilities/learningNotesDomSync.ts` | 265 | ProseMirror DOM 级兜底 + keepalive 保存 → 移入插件 |
| `apps/frontend/src/federation/capabilities/learningNotesHttpSync.ts` | 232 | `wrapLearningNotesHttp` + `saveLearningNoteAwait/Keepalive` → 移入插件 |
| `apps/frontend/src/federation/capabilities/learningNotesCloseSave.ts` | 124 | `saveLearningNotesOnWindowClose` 编排 → 替换为通用 `registerBeforeClose` |
| `apps/frontend/src/federation/capabilities/patchLearningNotesPlugin.ts` | 49 | monkey-patch `PluginManager` → 删除，不再注入 |

### 2.2 修改（4 个文件）

| 文件 | 改动 |
| --- | --- |
| `apps/frontend/src/federation/capabilities/learningNotesHostApi.ts` | 移除 store 同步与内部订阅；新增 `registerBeforeClose` / `runLearningNotesBeforeCloseHandlers`；`isLearningNotesPopoutPath` 内联 |
| `apps/frontend/src/federation/runtime/index.ts` | 移除 `wrapLearningNotesHttp` 包装与 `patchLearningNotesPluginManager` 调用 |
| `apps/frontend/src/views/englishLearning/notes/LearningNotesPluginHost.tsx` | 从同步中继（subscribe + applyRemote + remount）简化为纯 `<PluginHostPage>` |
| `apps/frontend/src/views/englishLearning/notes/useLearningNotesPopoutCloseSave.ts` | 从 `saveLearningNotesOnWindowClose()` 改为 `runLearningNotesBeforeCloseHandlers()` |

---

## 3. 实现思路与架构方案

### 3.1 架构对比

**改动前（Host 重量级）**：

```
┌──────────────────────────────────────────────────────────────┐
│ 视图层                                                        │
│  LearningNotesPluginHost.tsx                                 │
│  ─ subscribe → applyRemoteDeleted/Saved + refreshList/remount│
├──────────────────────────────────────────────────────────────┤
│ 联邦运行时层                                                   │
│  runtime/index.ts                                             │
│  ─ wrapLearningNotesHttp(baseHostHttp) → 自动广播             │
│  ─ patchLearningNotesPluginManager(mf.manager) → 注入同步     │
├──────────────────────────────────────────────────────────────┤
│ 联邦能力层（7 个文件）                                         │
│  SyncBus ─ StoreSync ─ DomSync ─ HttpSync ─ CloseSave        │
│  ─ PatchPlugin（monkey-patch 插件 default 组件）               │
│  ─ HostApi（connectStore + 内部 subscribe + stateSnapshot）   │
├──────────────────────────────────────────────────────────────┤
│ 插件（被动）                                                   │
│  ─ 不感知同步，由 Host 通过 store/DOM/HTTP 外部驱动            │
└──────────────────────────────────────────────────────────────┘
```

**改动后（Host 轻量级）**：

```
┌──────────────────────────────────────────────────────────────┐
│ 视图层                                                        │
│  LearningNotesPluginHost.tsx                                 │
│  ─ 纯挂载 <PluginHostPage>，无同步逻辑                        │
├──────────────────────────────────────────────────────────────┤
│ 联邦运行时层                                                   │
│  runtime/index.ts                                             │
│  ─ 直接用 hostHttp（不包装）                                   │
│  ─ 不 patch 插件管理器                                         │
├──────────────────────────────────────────────────────────────┤
│ 联邦能力层（2 个文件）                                         │
│  SyncBus（BroadcastChannel，不变）                            │
│  HostApi（registerBeforeClose + sync.publish*/subscribe）    │
├──────────────────────────────────────────────────────────────┤
│ 插件（主动）                                                   │
│  ─ 注册 beforeClose 回调做保存                                 │
│  ─ 订阅 sync.subscribe 做协议分发（applyRemote / refresh）   │
│  ─ 调 sync.publish* 广播变更                                   │
└──────────────────────────────────────────────────────────────┘
```

### 3.2 关键决策

1. **Host 不再读插件内部状态**：删除 `tryGetLearningNotesStoreFromGlobal`（`window.__DNHYXC_LN_STORE__`）与 `readEditorSnapshot`。Host 无法也不需要知道插件用 MobX / Zustand / Redux；插件自行读快照、自行保存。

2. **关窗保存从「编排」变「回调」**：原 `saveLearningNotesOnWindowClose` 在 Host 侧编排三层保存（autoSaveIfDirty → saveLearningNoteAwait → keepalive）；重构后 Host 只暴露 `registerBeforeClose(fn)`，插件注册自己的保存函数，Host 在关窗时 `await runLearningNotesBeforeCloseHandlers()` 后再 destroy。保存策略由插件决定。

3. **HTTP 不再包装**：原 `wrapLearningNotesHttp` 拦截 `post/put/delete` 到 `/english-learning/notes/*` 的请求，成功后自动 `publishLearningNotesSync`。重构后插件自行在保存 / 删除成功后调 `sync.publishSaved / publishDeleted / publishListChanged`。Host 的 `hostHttp` 回归纯透传。

4. **不再 monkey-patch 插件**：原 `patchLearningNotesPluginManager` 包装 `manager.ensurePlugin`，把插件 `default` 组件包一层 `LearningNotesWithHostSync`（`useEffect` 里 `installLearningNotesApiSync` + `attachLearningNotesDomSync`）。重构后插件自行在内部 `useEffect` 里调 `api.modules.learningNotes.sync.subscribe(...)`，无需 Host 注入。

5. **`isLearningNotesPopoutPath` 内联**：原 `learningNotesPopout.ts`（4 行）只导出一个路径判断函数；重构后直接在 `HostApi` 内用 `LEARNING_NOTES_POPOUT_PATH` 常量判断，减少一个文件与一层间接。

6. **`LearningNotesPluginHost` 回归纯挂载**：原组件在 `useEffect` 里订阅 `subscribeLearningNotesSync`，收到 `deleted/saved/list-changed` 时调 `applyRemoteDeleted/Saved` + `refreshLearningNotesListIfOpen`，无 store 时 `shouldRemountLearningNotesOnListChange()` 触发 remount。重构后这些全在插件内，组件只渲染 `<PluginHostPage pluginId="learningNotes" />`。

---

## 4. 关键代码对比与注释

### 4.1 `learningNotesHostApi.ts` — Host API 瘦身（核心改动）

#### 4.1.1 顶层辅助函数与导入

**对比范围**：文件顶部导入 + `readEditorSnapshot` / `publishLocalStateSnapshot`（改动前）→ `BeforeCloseFn` / `beforeCloseHandlers` / `runLearningNotesBeforeCloseHandlers` / `isLearningNotesPopoutPath`（改动后）。

**改动前** · `apps/frontend/src/federation/capabilities/learningNotesHostApi.ts`（基线，约 L1–L49）

```typescript
// 从已删的 learningNotesPopout.ts 导入路径判断函数（初版单独文件）
import { isLearningNotesPopoutPath } from './learningNotesPopout';
// 从已删的 learningNotesStoreSync.ts 导入四项 store 绑定能力（初版 Host 直读插件 MobX store）
import {
	// 将 binding 接到 store，返回 dispose（Host 侧订阅远端消息并分发到 store）
	attachLearningNotesStoreSync,
	// 从 store 实例创建 binding 适配器（getEditingId / getPreviewId / applyRemote*）
	createLearningNotesSyncBinding,
	// binding 类型（Host 与插件之间的 store 契约接口）
	type LearningNotesSyncStoreBinding,
	// 从 window.__DNHYXC_LN_STORE__ 取插件 store 单例（Host 耦合插件内部状态）
	tryGetLearningNotesStoreFromGlobal,
} from './learningNotesStoreSync';
// 从同步总线导入跨窗消息收发原语（重构后仍保留，唯一不变的能力层文件）
import {
	// 获取本窗口唯一 ID（sessionStorage）
	getLearningNotesWindowId,
	// 同步消息联合类型（7 种消息类型）
	type LearningNotesSyncMessage,
	// 向其它窗口广播消息
	publishLearningNotesSync,
	// 订阅来自其它窗口的消息
	subscribeLearningNotesSync,
} from './learningNotesSyncBus';

// 转发导出路径判断函数（供 useLearningNotesPopoutCloseSave 等消费方使用）
export { isLearningNotesPopoutPath };

// 从插件 store 读取编辑器快照（title/html/text/dirty），兼容两种方法名
function readEditorSnapshot(
	// store 参数类型为 tryGetLearningNotesStoreFromGlobal 的非空返回值
	store: NonNullable<ReturnType<typeof tryGetLearningNotesStoreFromGlobal>>,
) {
	// 优先调 takeEditorSnapshot（插件主动提供快照）
	return store.takeEditorSnapshot?.() ?? store.getEditorSnapshot?.() ?? null;
}

// 本窗正在看 noteId 时，把未保存草稿/预览推给对端（响应 request-state 消息）
function publishLocalStateSnapshot(noteId: string, windowId: string) {
	// 从全局取插件 store 单例（Host 耦合插件内部）
	const store = tryGetLearningNotesStoreFromGlobal();
	// store 不存在则放弃（插件未挂载）
	if (!store) return;
	// 创建 store binding 适配器
	const binding = createLearningNotesSyncBinding(store);
	// 本窗既不在编辑也不在预览该笔记，不推
	if (binding.getEditingId() !== noteId && binding.getPreviewId() !== noteId) {
		return;
	}

	// 编辑态才读快照；预览态 snap 为 null
	const snap =
		binding.getEditingId() === noteId ? readEditorSnapshot(store) : null;
	// 快照有内容或标记 dirty 时构造 draft 负载
	const draft =
		snap && (snap.html.trim() || snap.dirty)
			? {
					// 草稿 HTML
					html: snap.html,
					// 纯文本
					text: snap.text,
					// 标题
					title: snap.title,
					// 修订号（时间戳）
					revision: Date.now(),
					// dirty 标记
					dirty: snap.dirty,
					// 上传会话 ID（图片云端化用）
					uploadSessionId: store.uploadSessionId ?? null,
				}
			: undefined;

	// 广播 state-snapshot 消息给对端
	publishLearningNotesSync({
		// 消息类型：状态快照
		type: 'state-snapshot',
		// 笔记 ID
		noteId,
		// 本窗口 ID
		windowId,
		// 草稿负载（可能 undefined）
		draft,
		// 预览负载（本窗预览该笔记时附带）
		preview:
			binding.getPreviewId() === noteId
				? {
						// 预览 HTML
						html: store.preview?.html ?? '',
						// 预览标题
						title: store.preview?.title ?? '',
					}
				: undefined,
	});
}
```

**改动后** · `apps/frontend/src/federation/capabilities/learningNotesHostApi.ts`（当前，约 L1–L31）

```typescript
// 文件头注释：Host 只提供通道，业务在插件内
/**
 * 学习笔记 Host 模块：窗口身份、跨窗同步总线、关窗前钩子。
 * 协议分发与业务（applyRemote / 刷新）在插件内；Host 只提供通道。
 */
// 从 labels.ts 导入弹窗路径常量（原 learningNotesPopout.ts 已删，路径常量集中到 labels）
import { LEARNING_NOTES_POPOUT_PATH } from '@/views/englishLearning/notes/labels';
// 从同步总线导入跨窗消息收发原语（与改动前相同，总线层不变）
import {
	// 获取本窗口唯一 ID（sessionStorage）
	getLearningNotesWindowId,
	// 同步消息联合类型（7 种消息类型）
	type LearningNotesSyncMessage,
	// 向其它窗口广播消息
	publishLearningNotesSync,
	// 订阅来自其它窗口的消息
	subscribeLearningNotesSync,
} from './learningNotesSyncBus';

// 关窗前回调函数类型（插件注册，返回 void 或 Promise）
type BeforeCloseFn = () => void | Promise<void>;

// 进程内单例 Set：存放所有插件注册的关窗前回调
// buildModules 可能多次建 API，关窗 handler 需能找到插件注册的回调
const beforeCloseHandlers = new Set<BeforeCloseFn>();

// Host 关窗前统一 await 所有已注册回调（插件在此做保存）
export async function runLearningNotesBeforeCloseHandlers(): Promise<void> {
	// 遍历所有注册的回调（拷贝一份避免遍历中 Set 变动）
	for (const fn of [...beforeCloseHandlers]) {
		try {
			// 逐个 await，确保插件保存完成
			await fn();
		} catch (e) {
			// 某回调失败不阻断后续，只 warn
			console.warn('[learningNotes] beforeClose failed', e);
		}
	}
}

// 判断当前窗口是否为学习笔记弹窗（原 learningNotesPopout.ts 内联至此）
function isLearningNotesPopoutPath(): boolean {
	// 非浏览器环境（SSR）返回 false
	if (typeof window === 'undefined') return false;
	// 路径等于弹窗路径则为弹窗窗口
	return window.location.pathname === LEARNING_NOTES_POPOUT_PATH;
}
```

**变更摘要**：删除 `readEditorSnapshot` + `publishLocalStateSnapshot`（Host 不再直读插件 store）；删除 storeSync / popout 导入；新增 `BeforeCloseFn` 类型 + `beforeCloseHandlers` 单例 Set + `runLearningNotesBeforeCloseHandlers`（通用关窗回调编排）；`isLearningNotesPopoutPath` 从 `learningNotesPopout.ts` 内联。

---

#### 4.1.2 `createLearningNotesModulesApi()` — 主 API 函数

**对比范围**：`createLearningNotesModulesApi` 全函数（声明 → `}` 闭合）；`sync` 子对象因前后一致，对称省略。

**改动前** · `apps/frontend/src/federation/capabilities/learningNotesHostApi.ts`（基线，约 L51–L101）

```typescript
// Host 模块 API 工厂函数（buildModules 调用，挂到 modules.learningNotes）
export function createLearningNotesModulesApi() {
	// 获取本窗口唯一 ID（sessionStorage 随机串）
	const windowId = getLearningNotesWindowId();
	// store 同步 dispose 函数（connectStore 时设置，断开时清空）
	let storeDispose: (() => void) | null = null;

	// 将 binding 接到 store：Host 内部订阅 sync 总线，收到远端消息时分发到 store
	const connectStore = (binding: LearningNotesSyncStoreBinding) => {
		// 先释放上一轮 binding
		storeDispose?.();
		// 调 storeSync 的 attach，返回 dispose
		storeDispose = attachLearningNotesStoreSync(binding);
		// 返回清理函数
		return () => {
			// 释放当前 binding
			storeDispose?.();
			// 清空引用
			storeDispose = null;
		};
	};

	// Host 内部订阅同步总线——处理 request-state 与 selection 两种消息
	subscribeLearningNotesSync((msg) => {
		// 忽略自发消息（同 windowId）
		if (msg.windowId === windowId) return;
		// 对端请求本窗状态快照
		if (msg.type === 'request-state') {
			// 推送本窗草稿/预览给对端
			publishLocalStateSnapshot(msg.noteId, windowId);
			return;
		}
		// 对端点开同一篇：仅当本窗有未保存编辑时主动推，避免用干净副本盖掉对端草稿
		if (msg.type === 'selection' && msg.noteId) {
			// 从全局取插件 store
			const store = tryGetLearningNotesStoreFromGlobal();
			// store 不存在则放弃
			if (!store) return;
			// 创建 binding 适配器
			const binding = createLearningNotesSyncBinding(store);
			// 本窗未在编辑该笔记则不推
			if (binding.getEditingId() !== msg.noteId) return;
			// 读快照
			const snap = readEditorSnapshot(store);
			// dirty 时推送状态快照
			if (snap?.dirty) publishLocalStateSnapshot(msg.noteId, windowId);
		}
	});

	// 返回冻结的 API 对象
	return Object.freeze({
		// 是否为弹窗窗口
		isPopoutWindow: () => isLearningNotesPopoutPath(),
		// 获取本窗口 ID
		getWindowId: () => windowId,
		// 连接插件 store（Host 订阅总线 + 分发到 store）
		connectStore,
		// 消费初始 noteId（sessionStorage 一次性读取）
		consumeInitialNoteId: (): string | null => {
			try {
				// 从 sessionStorage 读取弹窗初始笔记 ID
				const id = sessionStorage.getItem('dnhyxc_ln_popout_note_id');
				// 读到后删除（一次性）
				if (id) sessionStorage.removeItem('dnhyxc_ln_popout_note_id');
				// 返回 ID 或 null
				return id;
			} catch {
				// sessionStorage 不可用时返回 null
				return null;
			}
		},
		// sync 子对象（publish* / subscribe / requestState）——前后一致，省略
		sync: Object.freeze({
			// ...（未改动，与改动后完全一致）
		}),
	});
}
```

**改动后** · `apps/frontend/src/federation/capabilities/learningNotesHostApi.ts`（当前，约 L33–L130）

```typescript
// Host 模块 API 工厂函数（buildModules 调用，挂到 modules.learningNotes）
export function createLearningNotesModulesApi() {
	// 获取本窗口唯一 ID（sessionStorage 随机串）
	const windowId = getLearningNotesWindowId();

	// 返回冻结的 API 对象
	return Object.freeze({
		// 是否为弹窗窗口
		isPopoutWindow: () => isLearningNotesPopoutPath(),
		// 获取本窗口 ID
		getWindowId: () => windowId,
		// 关窗前由插件注册保存回调；Host 只 await 后 destroy
		// Host 不再编排保存策略（autoSaveIfDirty / await fetch / keepalive），交给插件
		registerBeforeClose: (fn: BeforeCloseFn) => {
			// 将回调加入进程内单例 Set
			beforeCloseHandlers.add(fn);
			// 返回注销函数
			return () => {
				// 从 Set 中移除该回调
				beforeCloseHandlers.delete(fn);
			};
		},
		// 消费初始 noteId（sessionStorage 一次性读取）
		consumeInitialNoteId: (): string | null => {
			try {
				// 从 sessionStorage 读取弹窗初始笔记 ID
				const id = sessionStorage.getItem('dnhyxc_ln_popout_note_id');
				// 读到后删除（一次性）
				if (id) sessionStorage.removeItem('dnhyxc_ln_popout_note_id');
				// 返回 ID 或 null
				return id;
			} catch {
				// sessionStorage 不可用时返回 null
				return null;
			}
		},
		// sync 子对象（publish* / subscribe / requestState）——前后一致，省略
		sync: Object.freeze({
			// ...（未改动，与改动前完全一致）
		}),
	});
}
```

**变更摘要**：删除 `storeDispose` + `connectStore`（Host 不再绑定插件 store）；删除内部 `subscribeLearningNotesSync` 订阅（不再处理 `request-state` / `selection`）；新增 `registerBeforeClose(fn)` 替代 `connectStore`——插件注册保存回调，Host 在关窗时统一 await。`sync.publish*` / `subscribe` / `consumeInitialNoteId` 保持不变。

---

### 4.2 `federation/runtime/index.ts` — 移除 HTTP 包装与插件 Patch

**对比范围**：导入区 + `hostHttp` 定义（改动前含 `wrapLearningNotesHttp` 包装，改动后直接透传）。

**改动前** · `apps/frontend/src/federation/runtime/index.ts`（基线，约 L17–L46）

```typescript
// 从 HostApi 导入笔记模块 API 工厂（构建 modules.learningNotes）
import { createLearningNotesModulesApi } from '../capabilities/learningNotesHostApi';
// 从已删的 HttpSync 导入 HTTP 包装器（拦截笔记增删改请求自动广播）
import { wrapLearningNotesHttp } from '../capabilities/learningNotesHttpSync';
// 从已删的 PatchPlugin 导入插件管理器 monkey-patch（包装插件 default 组件注入同步）
import { patchLearningNotesPluginManager } from '../capabilities/patchLearningNotesPlugin';
// 从 pickLocalFiles 导入本地文件选择能力
import { pickLocalFilesForPlugins } from '../capabilities/pickLocalFiles';
// ...（其它导入未改动）

// 基础 HTTP 客户端（直接透传 http.get/post/put/delete）
const baseHostHttp: HostHttpClient = {
	// GET 请求
	get: ((url: string) => http.get(url)) as HostHttpClient['get'],
	// POST 请求
	post: ((url: string, body?: unknown) =>
		http.post(url, body)) as HostHttpClient['post'],
	// PUT 请求
	put: ((url: string, body?: unknown) =>
		http.put(url, body)) as HostHttpClient['put'],
	// DELETE 请求
	delete: ((url: string) => http.delete(url)) as HostHttpClient['delete'],
};
// 用笔记 HTTP 包装器包裹基础客户端：拦截笔记 API 请求成功后自动 publishLearningNotesSync
// 若包装器不可用（非弹窗环境）则回退到基础客户端
const hostHttp = wrapLearningNotesHttp(baseHostHttp) ?? baseHostHttp;
```

**改动后** · `apps/frontend/src/federation/runtime/index.ts`（当前，约 L17–L43）

```typescript
// 从 HostApi 导入笔记模块 API 工厂（构建 modules.learningNotes）
import { createLearningNotesModulesApi } from '../capabilities/learningNotesHostApi';
// 从 pickLocalFiles 导入本地文件选择能力
import { pickLocalFilesForPlugins } from '../capabilities/pickLocalFiles';
// ...（其它导入未改动）
// wrapLearningNotesHttp 与 patchLearningNotesPluginManager 导入已删除

// HTTP 客户端（直接透传 http.get/post/put/delete，不再包装）
const hostHttp: HostHttpClient = {
	// GET 请求
	get: ((url: string) => http.get(url)) as HostHttpClient['get'],
	// POST 请求
	post: ((url: string, body?: unknown) =>
		http.post(url, body)) as HostHttpClient['post'],
	// PUT 请求
	put: ((url: string, body?: unknown) =>
		http.put(url, body)) as HostHttpClient['put'],
	// DELETE 请求
	delete: ((url: string) => http.delete(url)) as HostHttpClient['delete'],
};
```

**变更摘要**：删除 `wrapLearningNotesHttp` 与 `patchLearningNotesPluginManager` 导入；`hostHttp` 从 `wrapLearningNotesHttp(baseHostHttp) ?? baseHostHttp` 简化为直接定义（不再拦截笔记 API 请求自动广播）。

---

**对比范围**：文件底部导出区（改动前调用 `patchLearningNotesPluginManager`，改动后删除）。

**改动前** · `apps/frontend/src/federation/runtime/index.ts`（基线，约 L210–L213）

```typescript
// ...（mf = createFederation 闭合）

// monkey-patch 插件管理器：包装 learningNotes 插件 default 组件注入同步
patchLearningNotesPluginManager(mf.manager);

// 导出插件管理器（已被 patch 过）
export const pluginManager = mf.manager;
```

**改动后** · `apps/frontend/src/federation/runtime/index.ts`（当前，约 L208–L210）

```typescript
// ...（mf = createFederation 闭合）

// 导出插件管理器（不再 patch，插件自行处理同步）
export const pluginManager = mf.manager;
```

**变更摘要**：删除 `patchLearningNotesPluginManager(mf.manager)` 调用——不再 monkey-patch 插件入口。

---

### 4.3 `LearningNotesPluginHost.tsx` — 从同步中继到纯挂载

**对比范围**：组件全函数（声明 → `}` 闭合）。

**改动前** · `apps/frontend/src/views/englishLearning/notes/LearningNotesPluginHost.tsx`（基线，约 L1–L69）

```typescript
// 导入 React hooks
import { useEffect, useState } from 'react';
// 导入 MF 插件宿主页组件
import { PluginHostPage } from '@/federation';
// 从已删的 DomSync 导入 remount 判定（无 store 时安全 remount 拉新列表）
import { shouldRemountLearningNotesOnListChange } from '@/federation/capabilities/learningNotesDomSync';
// 从已删的 StoreSync 导入 store 操作三件套
import {
	// 从 store 创建 binding 适配器
	createLearningNotesSyncBinding,
	// 列表打开时刷新
	refreshLearningNotesListIfOpen,
	// 从全局取插件 store 单例
	tryGetLearningNotesStoreFromGlobal,
} from '@/federation/capabilities/learningNotesStoreSync';
// 从同步总线导入收发原语
import {
	// 获取本窗口 ID
	getLearningNotesWindowId,
	// 订阅跨窗消息
	subscribeLearningNotesSync,
} from '@/federation/capabilities/learningNotesSyncBus';

// 组件 Props 类型
type Props = {
	// 容器 className
	className?: string;
};

// 学习笔记插件宿主页：列表变更时尝试 refreshList；无 store 时安全 remount 拉新列表
export function LearningNotesPluginHost({ className }: Props) {
	// remount 计数器（无 store 时通过 key 变化强制重新挂载插件）
	const [remountKey, setRemountKey] = useState(0);

	// 挂载时订阅同步总线
	useEffect(() => {
		// 返回 dispose 函数
		return subscribeLearningNotesSync((msg) => {
			// 忽略自发消息
			if ('windowId' in msg && msg.windowId === getLearningNotesWindowId()) {
				return;
			}
			// 只处理列表变更类消息
			if (
				msg.type !== 'list-changed' &&
				msg.type !== 'deleted' &&
				msg.type !== 'saved'
			) {
				return;
			}

			// 尝试取插件 store
			const store = tryGetLearningNotesStoreFromGlobal();
			if (store) {
				// 有 store：通过 binding 做精确更新
				const binding = createLearningNotesSyncBinding(store);
				if (msg.type === 'deleted') {
					// 对端删除了笔记：从本窗列表移除
					binding.applyRemoteDeleted(msg.noteId);
				} else if (
					msg.type === 'saved' &&
					// 预览态收到保存，或编辑态收到有内容的保存
					(store.preview?.id === msg.noteId ||
						(msg.html.trim() && store.editingId === msg.noteId))
				) {
					// 对端保存了笔记：更新本窗预览/编辑内容
					binding.applyRemoteSaved(msg.noteId, {
						html: msg.html,
						title: msg.title,
					});
				}
				// 列表打开时刷新
				refreshLearningNotesListIfOpen();
				return;
			}

			// 无 store：DOM 兜底判定是否需要 remount
			if (shouldRemountLearningNotesOnListChange()) {
				// remount 插件（key 变化触发重挂载）
				setRemountKey((k) => k + 1);
			}
		});
	}, []);

	// 渲染 MF 插件宿主页（key 变化时 remount）
	return (
		<PluginHostPage
			key={remountKey}
			pluginId="learningNotes"
			className={className}
		/>
	);
}
```

**改动后** · `apps/frontend/src/views/englishLearning/notes/LearningNotesPluginHost.tsx`（当前，约 L1–L10）

```typescript
// 导入 MF 插件宿主页组件（不再导入任何同步能力）
import { PluginHostPage } from '@/federation';

// 组件 Props 类型
type Props = {
	// 容器 className
	className?: string;
};

// 学习笔记插件宿主页：只挂 MF 插件，业务在插件内
export function LearningNotesPluginHost({ className }: Props) {
	// 直接渲染插件宿主页（同步逻辑全在插件内自行处理）
	return <PluginHostPage pluginId="learningNotes" className={className} />;
}
```

**变更摘要**：从 69 行同步中继（subscribe + applyRemote + remount）简化为 10 行纯挂载。删除 `useEffect` / `useState` / DomSync / StoreSync / SyncBus 导入；删除 `remountKey` 机制。插件自行订阅 `sync.subscribe` 做 `applyRemote` / `refreshList`。

---

### 4.4 `useLearningNotesPopoutCloseSave.ts` — 从具体保存到通用回调

**对比范围**：`ensurePopoutCloseSaveHandler` 全函数。

**改动前** · `apps/frontend/src/views/englishLearning/notes/useLearningNotesPopoutCloseSave.ts`（基线，约 L1–L26）

```typescript
// 从已删的 CloseSave 导入关窗保存编排函数（autoSaveIfDirty → await fetch → keepalive）
import { saveLearningNotesOnWindowClose } from '@/federation/capabilities/learningNotesCloseSave';
// 从 hostWindowClose 导入关窗桥注册函数
import { registerHostWindowCloseHandler } from '@/utils/hostWindowClose';
// 从 runtime 导入 Tauri 环境判断
import { isTauriRuntime } from '@/utils/runtime';
// 从 labels 导入弹窗常量
import {
	// 弹窗窗口 label（Tauri 窗口标识）
	LEARNING_NOTES_POPOUT_LABEL,
	// 弹窗路由路径
	LEARNING_NOTES_POPOUT_PATH,
} from './labels';

// 注册标记（防重复注册）
let registered = false;

// Popout chunk 加载时即注册，避免 useEffect 前用户点 ❌
function ensurePopoutCloseSaveHandler(): void {
	// 已注册或非 Tauri 环境则跳过
	if (registered || !isTauriRuntime()) return;
	// 规范化路径（去尾部斜杠）
	const path = window.location.pathname.replace(/\/+$/, '') || '/';
	// 非弹窗路径则跳过
	if (path !== LEARNING_NOTES_POPOUT_PATH) return;
	// 标记已注册
	registered = true;
	// 注册关窗 handler：await 具体保存编排后 destroy
	registerHostWindowCloseHandler(LEARNING_NOTES_POPOUT_LABEL, async () => {
		// 调用 CloseSave 编排（autoSaveIfDirty → saveLearningNoteAwait → keepalive 兜底）
		await saveLearningNotesOnWindowClose();
	});
}

// 模块加载时即注册（chunk 加载即执行）
ensurePopoutCloseSaveHandler();

// Popout 页再调一次，防止路由懒加载边界
export function useLearningNotesPopoutCloseSave(): void {
	// 确保 handler 已注册
	ensurePopoutCloseSaveHandler();
}
```

**改动后** · `apps/frontend/src/views/englishLearning/notes/useLearningNotesPopoutCloseSave.ts`（当前，约 L1–L30）

```typescript
// 从 HostApi 导入通用关窗回调编排函数（await 所有插件注册的 beforeClose 回调）
import { runLearningNotesBeforeCloseHandlers } from '@/federation/capabilities/learningNotesHostApi';
// 从 hostWindowClose 导入关窗桥注册函数
import { registerHostWindowCloseHandler } from '@/utils/hostWindowClose';
// 从 runtime 导入 Tauri 环境判断
import { isTauriRuntime } from '@/utils/runtime';
// 从 labels 导入弹窗常量
import {
	// 弹窗窗口 label（Tauri 窗口标识）
	LEARNING_NOTES_POPOUT_LABEL,
	// 弹窗路由路径
	LEARNING_NOTES_POPOUT_PATH,
} from './labels';

// 注册标记（防重复注册）
let registered = false;

// Popout chunk 加载时即注册关窗桥
// 实际保存由插件通过 modules.learningNotes.registerBeforeClose 注册
function ensurePopoutCloseSaveHandler(): void {
	// 已注册或非 Tauri 环境则跳过
	if (registered || !isTauriRuntime()) return;
	// 规范化路径（去尾部斜杠）
	const path = window.location.pathname.replace(/\/+$/, '') || '/';
	// 非弹窗路径则跳过
	if (path !== LEARNING_NOTES_POPOUT_PATH) return;
	// 标记已注册
	registered = true;
	// 注册关窗 handler：await 所有插件注册的 beforeClose 回调后 destroy
	registerHostWindowCloseHandler(LEARNING_NOTES_POPOUT_LABEL, async () => {
		// 通用回调编排（插件自行决定保存策略）
		await runLearningNotesBeforeCloseHandlers();
	});
}

// 模块加载时即注册（chunk 加载即执行）
ensurePopoutCloseSaveHandler();

// Popout 页再调一次，防止路由懒加载边界
export function useLearningNotesPopoutCloseSave(): void {
	// 确保 handler 已注册
	ensurePopoutCloseSaveHandler();
}
```

**变更摘要**：导入从 `saveLearningNotesOnWindowClose`（CloseSave 具体编排）改为 `runLearningNotesBeforeCloseHandlers`（HostApi 通用回调）。关窗 handler 内从调具体保存函数改为 await 所有插件注册的 `beforeClose` 回调。保存策略（autoSaveIfDirty / await fetch / keepalive）由插件自行决定。

---

### 4.5 被删文件概览（纯删除）

以下 6 个文件在本轮全部删除，其职责已移入插件或被通用机制替代。按 `code-before-after.md` §4 纯删除例外，不贴完整代码，仅列原职责与移除原因。

| 文件 | 原职责 | 移除原因 |
| --- | --- | --- |
| `learningNotesPopout.ts` | 导出 `isLearningNotesPopoutPath()`（4 行路径判断） | 内联到 `HostApi.ts`，用 `LEARNING_NOTES_POPOUT_PATH` 常量直接判断 |
| `learningNotesStoreSync.ts` | MobX store 绑定：`tryGetLearningNotesStoreFromGlobal`（读 `window.__DNHYXC_LN_STORE__`）、`createLearningNotesSyncBinding`（适配 `getEditingId` / `getPreviewId` / `applyRemoteDraft/Saved/Deleted`）、`attachLearningNotesStoreSync`（订阅总线 + 分发到 store）、`refreshLearningNotesListIfOpen`、`installLearningNotesApiSync`（轮询取 store） | Host 不再读插件 store；插件自行订阅 `sync.subscribe` 做 `applyRemote` / `refreshList` |
| `learningNotesDomSync.ts` | ProseMirror DOM 级兜底：`findPluginRoot` / `findProseMirror` / `readTitle`（DOM 查询）、`attachLearningNotesDomSync`（`input` 事件监听 + debounce 广播 draft）、`shouldRemountLearningNotesOnListChange`（无 store 时 remount）、`flushLearningNotesDomSaveOnClose` / `flushLearningNotesDomKeepaliveOnClose`（DOM `execCommand` 读内容 + keepalive 保存） | Host 不再操作插件 DOM；插件自行读编辑器内容、自行广播 draft、自行保存 |
| `learningNotesHttpSync.ts` | HTTP 包装：`wrapLearningNotesHttp`（拦截 `post/put/delete` 到 `/english-learning/notes/*` 的请求，成功后自动 `publishLearningNotesSync`）、`saveLearningNoteAwait`（async 保存）、`saveLearningNoteKeepalive`（`keepalive: true` 兜底）、`getTrackedLearningNotesNoteId` / `setTrackedLearningNotesNoteId`（当前编辑笔记 ID 追踪） | Host 不再拦截 HTTP；插件自行在保存 / 删除成功后调 `sync.publishSaved` / `publishDeleted` / `publishListChanged` |
| `learningNotesCloseSave.ts` | 关窗保存编排：`saveLearningNotesOnWindowClose`（`blur` → 读快照 → `autoSaveIfDirty` → `saveLearningNoteAwait` → `flushNoteOnPageHide` → keepalive 兜底 → `publishPopoutCloseListChanged`）、`saveLearningNotesOnWindowCloseSync`（同步版兜底） | 保存编排移入插件；Host 通过 `registerBeforeClose(fn)` 让插件注册自己的保存函数 |
| `patchLearningNotesPlugin.ts` | 插件 monkey-patch：`patchModDefault`（包装插件 `default` 组件为 `LearningNotesWithHostSync`，`useEffect` 里 `installLearningNotesApiSync` + `attachLearningNotesDomSync`）、`patchLearningNotesPluginManager`（劫持 `manager.ensurePlugin`，激活后 patch `mod.default`） | 不再 monkey-patch；插件自行在内部 `useEffect` 里调 `api.modules.learningNotes.sync.subscribe(...)` |

---

## 5. 兼容性与影响

### 5.1 对插件的要求

重构后 Host 不再注入同步逻辑，**插件须自行实现以下能力**才能保持同步功能不退化：

1. **订阅同步总线**：插件内部 `useEffect` 里调 `api.modules.learningNotes.sync.subscribe(handler)`，在 handler 中分发 `draft` / `saved` / `deleted` / `list-changed` / `state-snapshot` 消息到自身状态（`applyRemoteDraft` / `applyRemoteSaved` / `applyRemoteDeleted` / `refreshList`）。
2. **广播变更**：保存成功后调 `sync.publishSaved(payload)`；删除后调 `sync.publishDeleted(noteId)`；列表变动调 `sync.publishListChanged(reason)`；草稿变动调 `sync.publishDraft(payload)`。
3. **注册关窗保存**：弹窗窗口内调 `api.modules.learningNotes.registerBeforeClose(asyncFn)`，在 `asyncFn` 中执行保存（`autoSaveIfDirty` / `await fetch` / `keepalive` 兜底）。
4. **响应状态请求**：收到 `request-state` 消息时推送本窗草稿/预览快照（`sync.publishStateSnapshot`）。

### 5.2 行为变化

| 场景 | 改动前 | 改动后 |
| --- | --- | --- |
| 跨窗草稿同步 | Host 读插件 MobX store 快照 → 广播 `draft` / `state-snapshot` | 插件自行读快照 → 调 `sync.publishDraft` |
| 跨窗保存/删除同步 | Host 包装 HTTP，拦截响应后自动广播 `saved` / `deleted` | 插件保存/删除成功后自行调 `sync.publishSaved` / `publishDeleted` |
| 关窗保存 | Host 编排 `autoSaveIfDirty → saveLearningNoteAwait → keepalive` | 插件注册 `beforeClose` 回调，自行决定保存策略 |
| 列表刷新 | Host `subscribe` → `refreshLearningNotesListIfOpen` 或 remount | 插件 `sync.subscribe` → 自行 `refreshList` |
| 插件内部重构 | Host 依赖 `window.__DNHYXC_LN_STORE__` / ProseMirror DOM / API 路径，插件重构即断 | Host 无依赖，插件重构不影响 Host |

### 5.3 风险与回归

- **插件未实现同步**：若插件未调 `sync.subscribe` / `registerBeforeClose`，跨窗同步与关窗保存将不工作。回归：在弹窗编辑草稿 → 主窗是否即时看到；弹窗保存 → 主窗列表是否刷新；弹窗关闭 → 未保存草稿是否保存。
- **`beforeClose` 回调超时**：若插件回调长时间不 resolve，关窗会卡住。`runLearningNotesBeforeCloseHandlers` 逐个 `await`，不设超时——插件需自行保证回调及时 resolve。
- **Host API 兼容性**：`connectStore` 已删除；若插件仍调 `api.modules.learningNotes.connectStore`，将报 `connectStore is not a function`。插件须迁移到 `registerBeforeClose`。

---

## 6. 相关源码路径

| 说明 | 路径 |
| --- | --- |
| Host API（改动后） | `apps/frontend/src/federation/capabilities/learningNotesHostApi.ts` |
| 同步总线（不变） | `apps/frontend/src/federation/capabilities/learningNotesSyncBus.ts` |
| 联邦运行时（改动后） | `apps/frontend/src/federation/runtime/index.ts` |
| 插件宿主页（改动后） | `apps/frontend/src/views/englishLearning/notes/LearningNotesPluginHost.tsx` |
| 关窗桥 hook（改动后） | `apps/frontend/src/views/englishLearning/notes/useLearningNotesPopoutCloseSave.ts` |
| 弹窗路径常量 | `apps/frontend/src/views/englishLearning/notes/labels.ts` |

---

（若与仓库最新源码不一致，以源码为准）
