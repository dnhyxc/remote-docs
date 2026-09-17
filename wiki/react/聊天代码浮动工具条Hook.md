# useChatCodeFloatingToolbar（聊天代码吸顶条 Hook）实现归档

> 文档角色：implementation-doc-from-diff 归档稿
> 改动一轮：知识库预览 + 助手同开时滚动卡顿修复 — 聊天代码吸顶条 Hook 改造
> 状态：已落地（2026-07）

## 1. 背景与目标

Markdown 围栏代码块的浮动工具栏在 ScrollArea 等 `overflow` 祖先内无法用 `position: fixed` 正确参照视口，故由 `@/utils/chatCodeToolbar` 计算几何后通过 `ChatCodeToolbarFloating` Portal 到 `document.body` 渲染。`useChatCodeFloatingToolbar` 负责在 `resize` / `ResizeObserver` / `layoutDeps` / passive `scroll` 等时机调用 `layoutChatCodeToolbars(viewport)`，避免各页面重复写样板代码。

**本次改动要解决的问题**：知识库预览面板与助手聊天同屏开启时，两者各自挂载了 `useChatCodeFloatingToolbar` 实例并争用同一全局浮动条 store；滚动时双通道（React `onScroll` + passive `scroll`）每帧各测一次布局，引发明显卡顿。

**目标**：

1. 新增 `enabled` 开关，允许预览 + 助手同屏时关闭其中一个实例的监听与 layout。
2. 将 scroll 热路径合并到单帧 rAF 节流（`relayoutOnScroll`），避免双通道同帧双测。
3. 在卸载时清理 rAF id，防止泄漏。
4. 对外返回的 `relayout` 改为 `relayoutOnScroll`，让调用方 `onScroll` 也享受节流。

## 2. 改动范围

- `apps/frontend/src/hooks/useChatCodeFloatingToolbar.tsx`

## 3. 实现思路

1. **`enabled` 总开关**：从 `options.enabled`（默认 `true`）读取，所有 `useEffect` / `useLayoutEffect` 入口处 `if (!enabled) return` 短路，`relayout` / `relayoutOnScroll` 内同样 gate。预览 + 助手同屏时，调用方将预览侧 `enabled` 置 `false` 即可完全关闭其监听与 layout。
2. **`relayoutOnScroll` rAF 节流**：用 `useRef<number>(0)` 持有当前 rAF id；调用时若已有 pending rAF 则跳过，否则预约一帧执行 `layoutChatCodeToolbars`。这样 React `onScroll` 与 passive `scroll` 同帧多次调用只会产生一次实际布局。
3. **卸载清理 rAF**：新增无依赖 `useEffect` 在卸载时 `cancelAnimationFrame(scrollLayoutRafRef.current)`，避免组件卸载后 rAF 回调仍执行。
4. **多实例计数器加 `enabled` gate**：旧版 `chatCodeFloatingToolbarHookMountCount` 的 `useEffect` 在 `enabled` 为 `false` 时不递增计数、不注册卸载清理，避免预览侧实例影响全局计数。
5. **对外 API 改返回 `relayoutOnScroll`**：调用方 `onScroll` 里拿到的 `relayout` 实际为节流版，自动享受单帧合并。
6. **各 effect 依赖列加入 `enabled`**：`enabled` 翻转时重新挂载 / 卸载监听，保证开关响应及时。

## 4. 关键代码与逐行注释

### 4.1 imports（新增 `useRef`）

**对比范围**：文件顶部 `import` 语句块（react + 自定义模块）。

**改动前** · `apps/frontend/src/hooks/useChatCodeFloatingToolbar.tsx`（HEAD 基线，约 L1–L10）

```typescript
// 从 react 引入类型与 Hook（旧版无 useRef）
import {
// 引入类型 DependencyList，用于展开 layoutDeps / passiveScrollDeps 依赖数组
	type DependencyList,
// 引入类型 RefObject，约束 viewport ref 指向 HTMLElement | null
	type RefObject,
// 引入 useCallback，稳定 relayout 函数引用
	useCallback,
// 引入 useEffect，处理 resize / ResizeObserver / 多实例计数等副作用
	useEffect,
// 引入 useLayoutEffect，在浏览器绘制前同步执行 DOM 几何相关布局
	useLayoutEffect,
// 闭合 react import 语句
} from 'react';
// 引入浮动工具栏 Portal 组件（内部 useSyncExternalStore + createPortal）
import ChatCodeToolbarFloating from '@/components/design/ChatCodeToolBar';
// 引入 ChatI18nT 类型，供 ChatCodeFloatingToolbar 的 t prop 类型签名使用（HEAD 已存在）
import { ChatI18nT } from '@/types/chat';
// 引入核心布局函数：根据 viewport 内代码块节点计算吸顶条位置并更新全局 store
import { layoutChatCodeToolbars } from '@/utils/chatCodeToolbar';
```

**改动后** · `apps/frontend/src/hooks/useChatCodeFloatingToolbar.tsx`（当前源码，约 L1–L11）

```typescript
// 从 react 引入类型与 Hook（新增 useRef）
import {
// 引入类型 DependencyList，用于展开 layoutDeps / passiveScrollDeps 依赖数组
	type DependencyList,
// 引入类型 RefObject，约束 viewportRef 指向 HTMLElement | null
	type RefObject,
// 引入 useCallback，稳定 relayout / relayoutOnScroll 引用
	useCallback,
// 引入 useEffect，处理 resize / ResizeObserver / 多实例计数 / rAF 清理等副作用
	useEffect,
// 引入 useLayoutEffect，在绘制前同步执行 DOM 几何布局
	useLayoutEffect,
// 新增：引入 useRef，跨渲染持有 scrollLayoutRafRef（rAF id），不触发重渲染
	useRef,
// 闭合 react import 语句
} from 'react';
// 引入浮动工具栏 Portal 组件（内部 useSyncExternalStore + createPortal）
import ChatCodeToolbarFloating from '@/components/design/ChatCodeToolBar';
// 引入 ChatI18nT 类型，供 ChatCodeFloatingToolbar 的 t prop 类型签名使用
import { ChatI18nT } from '@/types/chat';
// 引入核心布局函数：根据 viewport 内代码块节点计算吸顶条位置并更新全局 store
import { layoutChatCodeToolbars } from '@/utils/chatCodeToolbar';
```

**变更摘要**：新增 `useRef` 导入，为 `scrollLayoutRafRef` 提供跨渲染持久容器。`ChatI18nT` 类型在 HEAD 中已导入（供 `ChatCodeFloatingToolbar` 的 `t` prop 使用），旧文档遗漏未记，此处一并补录。

---

### 4.2 `chatCodeFloatingToolbarHookMountCount` 全局多实例计数器

**对比范围**：模块级 `let chatCodeFloatingToolbarHookMountCount = 0;` 声明及其上方注释。

> 本声明在 HEAD 基线中已存在（非本次 diff 新增），但旧文档未单独记录此符号，特此补录。本次 diff 未改动此行，前后一致。

**改动前** · `apps/frontend/src/hooks/useChatCodeFloatingToolbar.tsx`（HEAD 基线，约 L14–L15）

```typescript
// 块注释：说明多实例共用同一 viewport 时避免任一子树卸载就把全局吸顶条清掉的设计意图
/** 多实例共用同一 viewport 时避免任一子树卸载就把全局吸顶条清掉（见分享页外层 ScrollArea + Markdown 嵌入父滚动） */
// 模块级可变变量，记录当前活跃的 useChatCodeFloatingToolbar 实例数量
let chatCodeFloatingToolbarHookMountCount = 0;
```

**改动后** · `apps/frontend/src/hooks/useChatCodeFloatingToolbar.tsx`（当前源码，约 L15–L16）

```typescript
// 块注释：说明多实例共用同一 viewport 时避免任一子树卸载就把全局吸顶条清掉的设计意图
/** 多实例共用同一 viewport 时避免任一子树卸载就把全局吸顶条清掉（见分享页外层 ScrollArea + Markdown 嵌入父滚动） */
// 模块级可变变量，记录当前活跃的 useChatCodeFloatingToolbar 实例数量
let chatCodeFloatingToolbarHookMountCount = 0;
```

**变更摘要**：本次 diff 未改动此声明；旧文档遗漏补录。计数器配合 §4.7 的 `useEffect` 实现「只有所有实例卸载后才清空全局浮层」。

---

### 4.3 `UseChatCodeFloatingToolbarOptions` 类型新增 `enabled` 字段

**对比范围**：`export type UseChatCodeFloatingToolbarOptions = { ... };` 完整类型定义。

**改动前** · `apps/frontend/src/hooks/useChatCodeFloatingToolbar.tsx`（HEAD 基线，约 L17–L32）

```typescript
// 导出配置类型，供调用方获得类型提示与文档
export type UseChatCodeFloatingToolbarOptions = {
// JSDoc 起始标记
	/**
// 说明 layoutDeps 用途：Markdown / 消息变化后补算吸顶条
	 * Markdown / 消息等变化后补算吸顶条（`requestAnimationFrame` + `useLayoutEffect`）。
// 提醒调用方传稳定依赖数组
	 * 请传入稳定依赖（如 `[chatData]`、`[markdown]`），勿每次 render 新建数组。
// JSDoc 结束标记
	 */
// 可选依赖数组，变化时触发双帧重新 layout 与 ResizeObserver 重绑
	layoutDeps?: DependencyList;
// JSDoc 起始标记
	/**
// 说明 passiveScrollLayout 用途：为 true 时在 viewport 上额外挂 passive scroll 监听
	 * 为 true 时在滚动视口上额外挂 **passive** 的 `scroll` 监听，仅调用 `layoutChatCodeToolbars`。
// 说明与 React onScroll 互补的关系
	 * 与 React `onScroll` 互补（部分环境下需双通道才能保证跟手）；ChatBotView 等场景开启。
// JSDoc 结束标记
	 */
// 可选布尔，默认 false，控制是否挂 passive scroll
	passiveScrollLayout?: boolean;
// 单行 JSDoc：说明 passiveScrollDeps 用途
	/** `passiveScrollLayout` 为 true 时，用于在会话切换等场景重绑 scroll 监听 */
// 可选依赖数组，变化时拆掉再挂上 scroll 监听
	passiveScrollDeps?: DependencyList;
// 类型定义闭合
};
```

**改动后** · `apps/frontend/src/hooks/useChatCodeFloatingToolbar.tsx`（当前源码，约 L18–L36）

```typescript
// 导出配置类型，供调用方获得类型提示与文档
export type UseChatCodeFloatingToolbarOptions = {
// JSDoc 起始标记
	/**
// 新增字段说明：enabled 为 false 时不挂监听、不测 layout
	 * 为 false 时不挂监听、不测 layout（预览+助手等同屏争用场景关闭吸顶条）。
// 说明默认值为 true
	 * 默认 true。
// JSDoc 结束标记
	 */
// 新增：可选布尔，默认 true，控制是否启用 Hook 的全部监听与布局
	enabled?: boolean;
// JSDoc 起始标记
	/**
// 说明 layoutDeps 用途：Markdown / 消息变化后补算吸顶条
	 * Markdown / 消息等变化后补算吸顶条（`requestAnimationFrame` + `useLayoutEffect`）。
// 提醒调用方传稳定依赖数组
	 * 请传入稳定依赖（如 `[chatData]`、`[markdown]`），勿每次 render 新建数组。
// JSDoc 结束标记
	 */
// 可选依赖数组，变化时触发双帧重新 layout 与 ResizeObserver 重绑
	layoutDeps?: DependencyList;
// JSDoc 起始标记
	/**
// 说明 passiveScrollLayout 用途：为 true 时在 viewport 上额外挂 passive scroll 监听
	 * 为 true 时在滚动视口上额外挂 **passive** 的 `scroll` 监听，仅调用 `layoutChatCodeToolbars`。
// 说明与 React onScroll 互补的关系
	 * 与 React `onScroll` 互补（部分环境下需双通道才能保证跟手）；ChatBotView 等场景开启。
// JSDoc 结束标记
	 */
// 可选布尔，默认 false，控制是否挂 passive scroll
	passiveScrollLayout?: boolean;
// 单行 JSDoc：说明 passiveScrollDeps 用途
	/** `passiveScrollLayout` 为 true 时，用于在会话切换等场景重绑 scroll 监听 */
// 可选依赖数组，变化时拆掉再挂上 scroll 监听
	passiveScrollDeps?: DependencyList;
// 类型定义闭合
};
```

**变更摘要**：在类型顶部新增 `enabled?: boolean` 字段（默认 `true`），为 `false` 时 Hook 不挂任何监听、不执行 layout，用于预览 + 助手同屏争用场景。

---

### 4.4 `scrollLayoutRafRef` 新增 + `relayout` 增加 `enabled` gate

**对比范围**：函数体内选项归一化片段 + `relayout` 的 `useCallback` 完整定义。

**改动前** · `apps/frontend/src/hooks/useChatCodeFloatingToolbar.tsx`（HEAD 基线，约 L44–L50）

```typescript
// 从 options 取 layoutDeps，未传则用模块级 emptyDeps 保持引用稳定
	const layoutDeps = options?.layoutDeps ?? emptyDeps;
// 从 options 取 passiveScrollDeps，未传则用 emptyDeps
	const passiveScrollDeps = options?.passiveScrollDeps ?? emptyDeps;
// 从 options 取 passiveScrollLayout，未传默认 false（不挂 passive scroll）
	const passiveScrollLayout = options?.passiveScrollLayout ?? false;
// 空行分隔
// useCallback 稳定 relayout 引用，依赖只列 viewportRef
	const relayout = useCallback(() => {
// 读取当前 viewportRef.current 交给布局函数（null 时内部清空浮动状态）
		layoutChatCodeToolbars(viewportRef.current);
// 闭合 useCallback，依赖数组仅 viewportRef
	}, [viewportRef]);
```

**改动后** · `apps/frontend/src/hooks/useChatCodeFloatingToolbar.tsx`（当前源码，约 L51–L60）

```typescript
// 新增：从 options 取 enabled，未传默认 true（保持向后兼容）
	const enabled = options?.enabled ?? true;
// 从 options 取 layoutDeps，未传则用模块级 emptyDeps 保持引用稳定
	const layoutDeps = options?.layoutDeps ?? emptyDeps;
// 从 options 取 passiveScrollDeps，未传则用 emptyDeps
	const passiveScrollDeps = options?.passiveScrollDeps ?? emptyDeps;
// 从 options 取 passiveScrollLayout，未传默认 false（不挂 passive scroll）
	const passiveScrollLayout = options?.passiveScrollLayout ?? false;
// 新增：useRef 持有 scroll 路径的 rAF id，初值 0 表示无 pending 帧
	const scrollLayoutRafRef = useRef(0);
// 空行分隔
// useCallback 稳定 relayout 引用，新增 enabled gate
	const relayout = useCallback(() => {
// enabled 为 false 时直接返回，不执行布局
		if (!enabled) return;
// 读取当前 viewportRef.current 交给布局函数（null 时内部清空浮动状态）
		layoutChatCodeToolbars(viewportRef.current);
// 闭合 useCallback，依赖数组加入 enabled 以响应开关翻转
	}, [viewportRef, enabled]);
```

**变更摘要**：新增 `enabled` 读取与 `scrollLayoutRafRef` ref；`relayout` 入口处增加 `if (!enabled) return` 短路，依赖列加入 `enabled`。

---

### 4.5 `relayoutOnScroll` 新函数（纯新增）

**对比范围**：`relayoutOnScroll` 的 `useCallback` 完整定义。

> 改动前：无（纯新增符号）。

**改动后** · `apps/frontend/src/hooks/useChatCodeFloatingToolbar.tsx`（当前源码，约 L62–L70）

```typescript
// 块注释：说明此函数用途——scroll 热路径合并到单帧，避免双通道同帧双测
/** scroll 热路径合并到单帧，避免 React onScroll + passive 双通道同帧双测 */
// useCallback 稳定 relayoutOnScroll 引用
	const relayoutOnScroll = useCallback(() => {
// enabled 为 false 时直接返回，不预约 rAF
		if (!enabled) return;
// 若已有 pending rAF 则跳过，实现单帧节流
		if (scrollLayoutRafRef.current) return;
// 预约一帧执行布局，保存 rAF id 到 ref
		scrollLayoutRafRef.current = requestAnimationFrame(() => {
// 执行前清零 ref，允许后续调用重新预约
			scrollLayoutRafRef.current = 0;
// 在 rAF 回调中实际调用布局函数
			layoutChatCodeToolbars(viewportRef.current);
// 闭合 rAF 回调
		});
// 闭合 useCallback，依赖列含 viewportRef 与 enabled
	}, [viewportRef, enabled]);
```

**变更摘要**：纯新增 `relayoutOnScroll`，用 rAF 节流将 scroll 高频调用合并为每帧至多一次 `layoutChatCodeToolbars`。

---

### 4.6 清理 `scrollLayoutRafRef` 的 useEffect（纯新增）

**对比范围**：卸载时清理 rAF 的 `useEffect` 完整定义。

> 改动前：无（纯新增符号）。

**改动后** · `apps/frontend/src/hooks/useChatCodeFloatingToolbar.tsx`（当前源码，约 L72–L79）

```typescript
// useEffect 仅在挂载 / 卸载时运行（空依赖数组）
	useEffect(() => {
// 返回清理函数，在组件卸载时执行
		return () => {
// 若有 pending rAF 则取消
			if (scrollLayoutRafRef.current) {
// 取消尚未执行的 rAF 回调
				cancelAnimationFrame(scrollLayoutRafRef.current);
// 清零 ref，标记无 pending
				scrollLayoutRafRef.current = 0;
// 闭合 if
			}
// 闭合清理函数
		};
// 空依赖数组，仅在挂载 / 卸载时运行
	}, []);
```

**变更摘要**：纯新增无依赖 `useEffect`，在卸载时取消尚未执行的 rAF 回调，防止组件卸载后回调仍触发 `layoutChatCodeToolbars`。

---

### 4.7 多实例计数 useEffect（加 `enabled` gate）

**对比范围**：操作 `chatCodeFloatingToolbarHookMountCount` 的 `useEffect` 完整定义。

**改动前** · `apps/frontend/src/hooks/useChatCodeFloatingToolbar.tsx`（HEAD 基线，约 L49–L66）

```typescript
// 块注释：说明多实例计数的设计缘由——多实例共用同一 viewport 时避免中间子树卸载导致吸顶条闪烁
	// 在全局范围追踪当前活跃的 useChatCodeFloatingToolbar 实例数量。
// 块注释续行：设计缘由——只有所有相关组件卸载后才需清空全局浮层
	// 设计缘由：多实例共用同一 ScrollArea viewport 时，只有当**所有**相关组件都卸载后，才需要将悬浮工具栏全局同步置空（否则出现 Markdown 或 ScrollArea 父子嵌套时，中间某一子树卸载会导致吸顶条闪烁/消失）。
// 块注释续行：举例场景——分享页外层 ScrollArea + Markdown 嵌入父滚动
	// 详见「多实例共用」场景，如分享页外层 ScrollArea + Markdown 嵌入父滚动。
// useEffect 注册挂载 / 卸载逻辑
	useEffect(() => {
// 行内注释：组件挂载时活跃实例数 +1
		// 组件挂载时，活跃实例数 +1
// 计数器递增
		chatCodeFloatingToolbarHookMountCount += 1;
// 返回卸载清理函数
		return () => {
// 行内注释：组件卸载时活跃实例数 -1
			// 组件卸载时，活跃实例数 -1
			chatCodeFloatingToolbarHookMountCount -= 1;
// 行内注释：只有所有相关组件卸载后才清除浮层
			// 只有当所有相关组件都卸载后，才清除 chat code 工具栏浮层
// 计数器归零判断
			if (chatCodeFloatingToolbarHookMountCount <= 0) {
// 行内注释：兜底保证不小于 0
				// 兜底保证不小于 0，防守式写法
				chatCodeFloatingToolbarHookMountCount = 0;
// 行内注释：调用 layoutChatCodeToolbars(null) 显式清空全局浮层
				// 调用 layoutChatCodeToolbars(null) 显式清空全局浮层 DOM/状态
				layoutChatCodeToolbars(null);
// 闭合 if
			}
// 闭合清理函数
		};
// 行内注释：只在初次挂载 / 卸载时运行一次，无依赖
		// 只在初次挂载、卸载时运行一次，无依赖
// 空依赖数组——仅挂载 / 卸载时运行
	}, []);
```

**改动后** · `apps/frontend/src/hooks/useChatCodeFloatingToolbar.tsx`（当前源码，约 L81–L91）

```typescript
// useEffect 注册挂载 / 卸载逻辑，新增 enabled gate
	useEffect(() => {
// enabled 为 false 时直接返回，不递增计数、不注册清理
		if (!enabled) return;
// 计数器递增（移除旧版行内注释，逻辑不变）
		chatCodeFloatingToolbarHookMountCount += 1;
// 返回卸载清理函数
		return () => {
// 计数器递减
			chatCodeFloatingToolbarHookMountCount -= 1;
// 计数器归零判断
			if (chatCodeFloatingToolbarHookMountCount <= 0) {
// 兜底保证不小于 0
				chatCodeFloatingToolbarHookMountCount = 0;
// 调用 layoutChatCodeToolbars(null) 显式清空全局浮层 DOM / 状态
				layoutChatCodeToolbars(null);
// 闭合 if
			}
// 闭合清理函数
		};
// 依赖列改为 [enabled]：enabled 翻转时重新执行 effect（先清理旧值再重新挂载）
	}, [enabled]);
```

**变更摘要**：入口处新增 `if (!enabled) return` 短路；移除旧版行内注释；依赖数组从 `[]` 改为 `[enabled]`，使 `enabled` 翻转时重新计数。

---

### 4.8 resize useEffect 增加 `enabled` gate

**对比范围**：监听 `window resize` 的 `useEffect` 完整定义。

**改动前** · `apps/frontend/src/hooks/useChatCodeFloatingToolbar.tsx`（HEAD 基线，约 L68–L72）

```typescript
// useEffect 注册 window resize 监听
	useEffect(() => {
// 定义 resize 回调：调用 layoutChatCodeToolbars 重算位置
		const onResize = () => layoutChatCodeToolbars(viewportRef.current);
// 在 window 上挂 resize 监听
		window.addEventListener('resize', onResize);
// 返回清理函数：移除 resize 监听
		return () => window.removeEventListener('resize', onResize);
// 空依赖数组——仅挂载 / 卸载时运行
	}, []);
```

**改动后** · `apps/frontend/src/hooks/useChatCodeFloatingToolbar.tsx`（当前源码，约 L93–L98）

```typescript
// useEffect 注册 window resize 监听，新增 enabled gate
	useEffect(() => {
// enabled 为 false 时直接返回，不挂监听
		if (!enabled) return;
// 定义 resize 回调：调用 layoutChatCodeToolbars 重算位置
		const onResize = () => layoutChatCodeToolbars(viewportRef.current);
// 在 window 上挂 resize 监听
		window.addEventListener('resize', onResize);
// 返回清理函数：移除 resize 监听
		return () => window.removeEventListener('resize', onResize);
// 依赖列改为 [enabled, viewportRef]：enabled 翻转或 ref 变化时重绑
	}, [enabled, viewportRef]);
```

**变更摘要**：入口处新增 `if (!enabled) return`；依赖数组从 `[]` 改为 `[enabled, viewportRef]`。

---

### 4.9 ResizeObserver useEffect 增加 `enabled` gate

**对比范围**：挂 `ResizeObserver` 并含 rAF 重试的 `useEffect` 完整定义。

**改动前** · `apps/frontend/src/hooks/useChatCodeFloatingToolbar.tsx`（HEAD 基线，约 L74–L101）

```typescript
// useEffect 注册 ResizeObserver，含首帧 ref 未就绪时的 rAF 重试
	useEffect(() => {
// 声明 ResizeObserver 实例引用
		let ro: ResizeObserver | null = null;
// 声明取消标记，防止卸载后继续 attach
		let cancelled = false;
// 声明 rAF id，用于重试与清理
		let raf = 0;
// 空行分隔
// 定义 attach 函数：尝试挂载 ResizeObserver
		const attach = () => {
// 读取当前 viewportRef.current
			const el = viewportRef.current;
// 若 el 为空或已 cancelled 则返回 false（挂载失败）
			if (!el || cancelled) return false;
// 先断开旧 observer（如有）
			ro?.disconnect();
// 新建 ResizeObserver，回调里调用 relayout()
			ro = new ResizeObserver(() => relayout());
// 观察 el
			ro.observe(el);
// 返回 true 表示挂载成功
			return true;
		};
// 空行分隔
// 首次尝试 attach，失败则进入 rAF 重试
		if (!attach()) {
// 声明重试次数计数
			let attempts = 0;
// 定义 retry 函数：rAF 轮询重试 attach
			const retry = () => {
// 超过 90 次（约 1.5s@60Hz）或已 cancelled 则停止
				if (cancelled || attempts++ > 90) return;
// attach 失败则预约下一帧重试
				if (!attach()) raf = requestAnimationFrame(retry);
			};
// 首次预约 rAF
			raf = requestAnimationFrame(retry);
		}
// 空行分隔
// 返回清理函数
		return () => {
// 标记已取消，阻止 retry 继续
			cancelled = true;
// 取消尚未执行的 rAF
			cancelAnimationFrame(raf);
// 断开 ResizeObserver
			ro?.disconnect();
		};
// 行内注释：与 layoutDeps 同步——首帧 ref 常为空，内容挂载后需重新 observe
		// 与 layoutDeps 同步：首帧 ref 常为空，内容挂载后需重新 observe
// eslint 禁用行：展开数组无法被 exhaustive-deps 自动推断
		// eslint-disable-next-line react-hooks/exhaustive-deps
// 依赖列：relayout + 展开 layoutDeps
	}, [relayout, ...layoutDeps]);
```

**改动后** · `apps/frontend/src/hooks/useChatCodeFloatingToolbar.tsx`（当前源码，约 L100–L130）

```typescript
// useEffect 注册 ResizeObserver，新增 enabled gate
	useEffect(() => {
// enabled 为 false 时直接返回，不挂 observer
		if (!enabled) return;
// 声明 ResizeObserver 实例引用
		let ro: ResizeObserver | null = null;
// 声明取消标记，防止卸载后继续 attach
		let cancelled = false;
// 声明 rAF id，用于重试与清理
		let raf = 0;
// 空行分隔
// 定义 attach 函数：尝试挂载 ResizeObserver
		const attach = () => {
// 读取当前 viewportRef.current
			const el = viewportRef.current;
// 若 el 为空或已 cancelled 则返回 false（挂载失败）
			if (!el || cancelled) return false;
// 先断开旧 observer（如有）
			ro?.disconnect();
// 新建 ResizeObserver，回调里调用 relayout()
			ro = new ResizeObserver(() => relayout());
// 观察 el
			ro.observe(el);
// 返回 true 表示挂载成功
			return true;
		};
// 空行分隔
// 首次尝试 attach，失败则进入 rAF 重试
		if (!attach()) {
// 声明重试次数计数
			let attempts = 0;
// 定义 retry 函数：rAF 轮询重试 attach
			const retry = () => {
// 超过 90 次（约 1.5s@60Hz）或已 cancelled 则停止
				if (cancelled || attempts++ > 90) return;
// attach 失败则预约下一帧重试
				if (!attach()) raf = requestAnimationFrame(retry);
			};
// 首次预约 rAF
			raf = requestAnimationFrame(retry);
		}
// 空行分隔
// 返回清理函数
		return () => {
// 标记已取消，阻止 retry 继续
			cancelled = true;
// 取消尚未执行的 rAF
			cancelAnimationFrame(raf);
// 断开 ResizeObserver
			ro?.disconnect();
		};
// eslint 禁用行：展开数组无法被 exhaustive-deps 自动推断
		// eslint-disable-next-line react-hooks/exhaustive-deps
// 依赖列新增 enabled：enabled 翻转时重绑 observer
	}, [enabled, relayout, ...layoutDeps]);
```

**变更摘要**：入口处新增 `if (!enabled) return`；移除旧版行内注释；依赖数组首位加入 `enabled`。

---

### 4.10 layoutDeps useEffect 增加 `enabled` gate

**对比范围**：`layoutDeps` 变化时双帧 layout 的 `useEffect` 完整定义。

**改动前** · `apps/frontend/src/hooks/useChatCodeFloatingToolbar.tsx`（HEAD 基线，约 L103–L108）

```typescript
// useEffect：layoutDeps 变化时立即算一帧 + rAF 再算一帧
	useEffect(() => {
// 立即调用 relayout()
		relayout();
// 预约下一动画帧再调一次 relayout()
		const id = requestAnimationFrame(() => relayout());
// 返回清理函数：取消未执行的第二帧
		return () => cancelAnimationFrame(id);
// eslint 禁用行并注释：layoutDeps 由调用方传入
		// eslint-disable-next-line react-hooks/exhaustive-deps -- layoutDeps 由调用方传入
// 依赖列：relayout + 展开 layoutDeps
	}, [relayout, ...layoutDeps]);
```

**改动后** · `apps/frontend/src/hooks/useChatCodeFloatingToolbar.tsx`（当前源码，约 L132–L138）

```typescript
// useEffect：layoutDeps 变化时双帧 layout，新增 enabled gate
	useEffect(() => {
// enabled 为 false 时直接返回，不执行 layout
		if (!enabled) return;
// 立即调用 relayout()
		relayout();
// 预约下一动画帧再调一次 relayout()
		const id = requestAnimationFrame(() => relayout());
// 返回清理函数：取消未执行的第二帧
		return () => cancelAnimationFrame(id);
// eslint 禁用行并注释：layoutDeps 由调用方传入
		// eslint-disable-next-line react-hooks/exhaustive-deps -- layoutDeps 由调用方传入
// 依赖列新增 enabled
	}, [enabled, relayout, ...layoutDeps]);
```

**变更摘要**：入口处新增 `if (!enabled) return`；依赖数组首位加入 `enabled`。

---

### 4.11 useLayoutEffect 增加 `enabled` gate

**对比范围**：绘制前同步双帧 layout 的 `useLayoutEffect` 完整定义。

**改动前** · `apps/frontend/src/hooks/useChatCodeFloatingToolbar.tsx`（HEAD 基线，约 L110–L117）

```typescript
// useLayoutEffect：React 提交 DOM 后、绘制前同步执行双帧布局
	useLayoutEffect(() => {
// 读取当前 viewportRef.current
		const el = viewportRef.current;
// el 为空则直接返回
		if (!el) return;
// 立即调用 layoutChatCodeToolbars(el)
		layoutChatCodeToolbars(el);
// 预约下一动画帧再调一次 layoutChatCodeToolbars(el)
		const id = requestAnimationFrame(() => layoutChatCodeToolbars(el));
// 返回清理函数：取消未执行的 rAF
		return () => cancelAnimationFrame(id);
// eslint 禁用行
		// eslint-disable-next-line react-hooks/exhaustive-deps
// 依赖列：relayout + 展开 layoutDeps
	}, [relayout, ...layoutDeps]);
```

**改动后** · `apps/frontend/src/hooks/useChatCodeFloatingToolbar.tsx`（当前源码，约 L140–L148）

```typescript
// useLayoutEffect：绘制前同步双帧 layout，新增 enabled gate
	useLayoutEffect(() => {
// enabled 为 false 时直接返回
		if (!enabled) return;
// 读取当前 viewportRef.current
		const el = viewportRef.current;
// el 为空则直接返回
		if (!el) return;
// 立即调用 layoutChatCodeToolbars(el)
		layoutChatCodeToolbars(el);
// 预约下一动画帧再调一次 layoutChatCodeToolbars(el)
		const id = requestAnimationFrame(() => layoutChatCodeToolbars(el));
// 返回清理函数：取消未执行的 rAF
		return () => cancelAnimationFrame(id);
// eslint 禁用行
		// eslint-disable-next-line react-hooks/exhaustive-deps
// 依赖列新增 enabled
	}, [enabled, relayout, ...layoutDeps]);
```

**变更摘要**：入口处新增 `if (!enabled) return`；依赖数组首位加入 `enabled`。

---

### 4.12 passive scroll useLayoutEffect 改用 `relayoutOnScroll`

**对比范围**：挂 passive `scroll` 监听的 `useLayoutEffect` 完整定义。

**改动前** · `apps/frontend/src/hooks/useChatCodeFloatingToolbar.tsx`（HEAD 基线，约 L109–L118）

```typescript
// useLayoutEffect：挂 passive scroll 监听
	useLayoutEffect(() => {
// 未开启 passiveScrollLayout 则直接返回
		if (!passiveScrollLayout) return;
// 读取当前 viewportRef.current
		const vp = viewportRef.current;
// vp 为空则直接返回
		if (!vp) return;
// 定义 onScroll 回调：直接调用 layoutChatCodeToolbars(vp)（无节流）
		const onScroll = () => layoutChatCodeToolbars(vp);
// 在 vp 上挂 passive scroll 监听
		vp.addEventListener('scroll', onScroll, { passive: true });
// 返回清理函数：移除 scroll 监听
		return () => vp.removeEventListener('scroll', onScroll);
// eslint 禁用行
		// eslint-disable-next-line react-hooks/exhaustive-deps
// 依赖列：passiveScrollLayout + viewportRef + 展开 passiveScrollDeps
	}, [passiveScrollLayout, viewportRef, ...passiveScrollDeps]);
```

**改动后** · `apps/frontend/src/hooks/useChatCodeFloatingToolbar.tsx`（当前源码，约 L150–L164）

```typescript
// useLayoutEffect：挂 passive scroll 监听，新增 enabled gate 并改用 relayoutOnScroll
	useLayoutEffect(() => {
// enabled 或 passiveScrollLayout 为 false 则直接返回
		if (!enabled || !passiveScrollLayout) return;
// 读取当前 viewportRef.current
		const vp = viewportRef.current;
// vp 为空则直接返回
		if (!vp) return;
// 定义 onScroll 回调：改用 relayoutOnScroll()（rAF 节流，避免每帧双测）
		const onScroll = () => relayoutOnScroll();
// 在 vp 上挂 passive scroll 监听
		vp.addEventListener('scroll', onScroll, { passive: true });
// 返回清理函数：移除 scroll 监听
		return () => vp.removeEventListener('scroll', onScroll);
// eslint 禁用行
		// eslint-disable-next-line react-hooks/exhaustive-deps
// 依赖列：enabled + passiveScrollLayout + viewportRef + relayoutOnScroll + 展开 passiveScrollDeps
	}, [
// enabled 翻转时重绑
		enabled,
// passiveScrollLayout 翻转时重绑
		passiveScrollLayout,
// viewportRef 变化时重绑
		viewportRef,
// relayoutOnScroll 引用变化时重绑
		relayoutOnScroll,
// 展开 passiveScrollDeps（会话切换等场景重绑）
		...passiveScrollDeps,
// 闭合依赖数组
	]);
```

**变更摘要**：入口条件增加 `!enabled` 短路；`onScroll` 回调从直接调 `layoutChatCodeToolbars(vp)` 改为调 `relayoutOnScroll()`（rAF 节流）；依赖列新增 `enabled` 与 `relayoutOnScroll`。

---

### 4.13 `return { relayout: relayoutOnScroll }`

**对比范围**：函数末尾 `return` 语句及上方 `useLayoutEffect` 闭合。

**改动前** · `apps/frontend/src/hooks/useChatCodeFloatingToolbar.tsx`（HEAD 基线，约 L117–L119）

```typescript
// 闭合 passive scroll useLayoutEffect 的依赖数组
	}, [passiveScrollLayout, viewportRef, ...passiveScrollDeps]);
// 空行分隔
// 返回 relayout（非节流版），供调用方在 onScroll 中手动调用
	return { relayout };
// 闭合 useChatCodeFloatingToolbar 函数
}
```

**改动后** · `apps/frontend/src/hooks/useChatCodeFloatingToolbar.tsx`（当前源码，约 L164–L167）

```typescript
// 闭合 passive scroll useLayoutEffect 的依赖数组
	]);
// 空行分隔
// 返回 relayoutOnScroll（rAF 节流版），对外接口名仍为 relayout，调用方无需改动
	return { relayout: relayoutOnScroll };
// 闭合 useChatCodeFloatingToolbar 函数
}
```

**变更摘要**：对外返回的 `relayout` 从非节流版改为 `relayoutOnScroll`（rAF 节流版），接口签名不变，调用方自动享受单帧合并。

---

### 4.14 `ChatCodeFloatingToolbar` 接收 `t` prop

**对比范围**：`export function ChatCodeFloatingToolbar` 组件完整定义。

> 本符号在 HEAD 基线中已含 `t` prop（非本次 diff 新增），但旧文档记录为无 prop 版本 `ChatCodeFloatingToolbar()`，特此更正补录。

**改动前**（旧文档记录的过时版本，无 `t` prop）

```typescript
// JSDoc：说明组件应放在滚动容器同级，Portal 到 body 渲染吸顶代码栏
/**
 * 与 `useChatCodeFloatingToolbar` 配套：挂在滚动容器**同级**（祖先含 `position: relative` 即可），
 * Portal 到 `document.body` 渲染吸顶代码栏。
 */
// 旧版无 props 的薄封装组件
export function ChatCodeFloatingToolbar() {
// 直接渲染 ChatCodeToolbarFloating（无 t 透传）
	return <ChatCodeToolbarFloating />;
// 闭合组件
}
```

**改动后** · `apps/frontend/src/hooks/useChatCodeFloatingToolbar.tsx`（当前源码，约 L169–L175）

```typescript
// JSDoc：说明组件应放在滚动容器同级，Portal 到 body 渲染吸顶代码栏
/**
 * 与 `useChatCodeFloatingToolbar` 配套：挂在滚动容器**同级**（祖先含 `position: relative` 即可），
 * Portal 到 `document.body` 渲染吸顶代码栏。
 */
// 接收可选 t prop（ChatI18nT 类型）的薄封装组件
export function ChatCodeFloatingToolbar(props: { t?: ChatI18nT }) {
// 渲染 ChatCodeToolbarFloating 并透传 t prop（i18n 翻译函数）
	return <ChatCodeToolbarFloating t={props.t} />;
// 闭合组件
}
```

**变更摘要**：旧文档记录为 `ChatCodeFloatingToolbar()`（无 props），实际 HEAD 及当前源码均已接收 `t?: ChatI18nT` prop 并透传给 `ChatCodeToolbarFloating`。此处更正旧文档的过时记录。

---

## 5. 兼容性与影响

- **向后兼容**：`enabled` 默认 `true`，不传时行为与旧版一致；`UseChatCodeFloatingToolbarOptions` 新增可选字段，不破坏既有调用方。
- **对外 API**：`return { relayout }` 的 `relayout` 实际指向 `relayoutOnScroll`（rAF 节流版），函数签名不变，调用方无需改动；高频 `onScroll` 场景性能提升。
- **多实例计数**：`chatCodeFloatingToolbarHookMountCount` 的 effect 依赖从 `[]` 改为 `[enabled]`，`enabled` 翻转时会先执行清理（计数 -1）再重新挂载（计数 +1）。`enabled` 从 `true` 切 `false` 时，该实例的监听全部卸载但不会触发 `layoutChatCodeToolbars(null)`（除非它是最后一个活跃实例）。
- **预览 + 助手同屏**：调用方将预览侧 `enabled` 置 `false` 即可完全关闭其监听与 layout，避免双实例争用全局浮动条 store。
- **回归测试建议**：
  - 单实例场景（聊天页、分享页、Monaco 预览）：`enabled` 不传，验证吸顶条行为与旧版一致。
  - 预览 + 助手同屏：预览侧 `enabled=false`，验证滚动不卡顿、助手侧吸顶条正常。
  - `enabled` 动态翻转：验证监听正确挂 / 卸、计数器不出现负数。
  - 组件卸载：验证 rAF 回调被取消、全局浮层在最后一个实例卸载后清空。

## 6. 相关源码路径

| 说明 | 路径 |
| ---- | ---- |
| Hook 实现（本文档对应源码） | `apps/frontend/src/hooks/useChatCodeFloatingToolbar.tsx` |
| 布局核心函数与全局 store | `apps/frontend/src/utils/chatCodeToolbar.ts` |
| 浮动条 Portal 组件 | `apps/frontend/src/components/design/ChatCodeToolBar/index.tsx` |
| `ChatI18nT` 类型定义 | `apps/frontend/src/types/chat.ts` |

---

（若与仓库最新源码不一致，以源码为准）
