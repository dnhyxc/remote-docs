# `useSyncExternalStore` 与聊天代码块浮动工具栏

本文说明 React 18 提供的 `useSyncExternalStore` 的运行逻辑，并结合 `ChatCodeToolbarFloating`（`apps/frontend/src/components/design/ChatCodeToolBar/index.tsx`）与 `chatCodeToolbar.ts` 中的实现做对照。

---

## 1. 这个 Hook 要解决什么问题？

在 React 里，**组件状态**通常来自 `useState` / `useReducer` / Context。但有些数据**不生活在 React 树里**，例如：

- 浏览器 API（`window.matchMedia`、`document.visibilityState`）
- 第三方非 React 库维护的全局状态
- **本例**：模块级变量 + DOM 布局结果，由 `layoutChatCodeToolbars` 在滚动/resize 时更新

若用 `useState` + 在模块里 `setState` 的变通写法，容易和 **并发渲染（Concurrent Features）** 下的 **撕裂（tearing）** 问题纠缠：同一帧内不同子树可能读到不一致的「外部值」。

`useSyncExternalStore` 是 React 官方推荐的、**把外部数据源接到 React 并保证与并发特性兼容** 的方式：订阅变更、读取快照，并在 **服务端渲染（SSR）** 时提供与客户端可区分的快照，避免水合（hydration）不匹配。

---

## 2. 基本使用示例（最小可运行形态）

下面是一个与业务无关的极简外部 store：**模块内保存一个数字**，在组件外用函数修改并通知所有订阅者；组件内用 `useSyncExternalStore` 读取。

**外部 store（例如 `counterStore.ts`）**

```ts
// 模块级「真相源」
let count = 0;
const listeners = new Set<() => void>();

/** 当前快照：给 React 的 getSnapshot 用 */
export function getCountSnapshot(): number {
	return count;
}

/** 注册 / 注销监听：给 React 的 subscribe 用 */
export function subscribeCount(onStoreChange: () => void): () => void {
	listeners.add(onStoreChange);
	return () => listeners.delete(onStoreChange);
}

/** 业务或命令式代码里修改 store，并同步通知订阅方 */
export function incrementCount(): void {
	count += 1;
	listeners.forEach((fn) => fn());
}
```

**消费组件**

```tsx
import { useSyncExternalStore } from "react";
import { subscribeCount, getCountSnapshot } from "./counterStore";

export function CounterLabel() {
	const count = useSyncExternalStore(
		subscribeCount,
		getCountSnapshot,
		() => 0, // getServerSnapshot：SSR 无真实 count，给固定初值
	);
	return (
		<div>
			<span>{count}</span>
		</div>
	);
}

// 在按钮 onClick、原生 addEventListener、requestAnimationFrame、WebSocket 等
// 「非 React 路径」里调用 incrementCount()，即可更新 store 并驱动上面组件重渲染
```

### 术语：什么是「非 React 路径」？

文档里常说的 **非 React 路径**（non-React code path），指的是 **执行栈不经过 React 自己的调度与更新机制**、却仍会改动你希望界面反映的数据或 DOM 的那类代码。可以和 **React 路径**对照理解：

| 类型 | 含义 | 典型例子 |
|------|------|----------|
| **React 路径** | 由 React 触发或最终会回到 `setState` / `dispatch` 等官方更新入口 | 组件渲染函数体内的逻辑；JSX 上写的 `onClick={() => setN(n+1)}`（合成事件）；`useEffect` 里根据依赖调用 `setState` |
| **非 React 路径** | 浏览器、定时器、网络、第三方库或**模块顶层命令式代码**直接执行，React **事先不知道**这次执行会发生 | `element.addEventListener('scroll', ...)` 的回调；`requestAnimationFrame` / `setInterval`；`WebSocket.onmessage`；`fetch().then(...)`；地图/图表 SDK 的回调；**在组件树之外的模块函数**里改全局变量并 `emit()`（如本仓库的 `layoutChatCodeToolbars`） |

为什么要单独说这个概念：

1. **外部 store 往往在非 React 路径里被写入**  
   例如滚动时算布局、在 `layoutChatCodeToolbars` 里改 `state` 再 `emit()`——这里没有某个组件里的 `setState` 可用，或强行把 `setState` 从模块外「塞」进组件会很别扭。

2. **`useSyncExternalStore` 正是桥接这两边**  
   组件在 **React 路径**里订阅；store 在 **非 React 路径**里更新并通知 `listeners`，React 再按约定同步读 `getSnapshot` 并重渲染。

3. **与「子组件」无关**  
   有时口误会写成「非子组件路径」，更准确的含义仍是：**不是通过 React 状态更新那条链路触发的代码**，与是否子组件无关。

要点对照：

| 角色               | 职责                                                               |
| ------------------ | ------------------------------------------------------------------ |
| `subscribeCount`   | React 在挂载时注册 `onStoreChange`，卸载时执行返回的清理函数       |
| `getCountSnapshot` | 每次 React 需要「当前值」时同步读取；与上次比较用 `Object.is`      |
| `() => 0`          | 服务端只调用此函数，避免在 Node 里访问浏览器专有 API 或错误假设    |
| `incrementCount`   | 典型由按钮、`requestAnimationFrame`、WebSocket 等非 React 路径调用 |

若快照是 **对象**，更新时建议 **换新引用**（`state = { ...prev, n: prev.n + 1 }`），否则 `Object.is` 认为未变可能不会触发重渲染。原始值（如 `number`）则天然按值比较。

---

## 3. 何时适合使用 `useSyncExternalStore`

### 3.1 适合使用的典型情况

1. **数据源在 React 树之外**  
   模块变量、单例、非 React 的 UI 库 / 游戏循环 / 编辑器内核等，它们暴露「读当前值 + 订阅变化」或你能包一层 `subscribe` / `getSnapshot`。

2. **浏览器或环境 API 带订阅语义**  
   例如 `matchMedia`、`document.visibilityState`、部分存储事件等：值会变，且需要订阅，用该 Hook 比「`useEffect` 里手动 `setState`」更符合 React 对外部源的推荐接入方式。

3. **命令式代码写状态、声明式组件只负责展示**  
   与本仓库代码块工具栏类似：`layoutChatCodeToolbars` 在滚动回调里算完再 `emit()`，组件不负责注册滚动，只订阅「布局结果快照」。

4. **使用或封装 Redux / Zustand 等时**  
   这些库在 React 集成层往往会用到 `useSyncExternalStore`（或等价机制），以保证在 **并发渲染** 下读到的 store 与订阅一致，避免撕裂。

5. **存在 SSR / 水合**  
   客户端首屏与服务器输出需对齐时，第三个参数 `getServerSnapshot` 提供 **服务端安全、且稳定可重复** 的快照，减少 hydration mismatch。

### 3.2 不必强行使用的常见情况

1. **状态完全由当前组件或父组件用 `useState` / `useReducer` 即可表达**  
   没有外部源，就不需要该 Hook。

2. **仅向下传数据、无跨层订阅**  
   用 props 或 Context（在合适粒度下）通常更简单。

3. **只是「挂载后读一次 DOM」且不需要订阅后续变化**  
   可能用 `useLayoutEffect`、ref 回调等更合适；若误用外部 store 反而增加复杂度。

4. **已有成熟状态库**  
   应用代码里优先用库提供的 `useStore` 等 API，而不是自己再套一层裸 `useSyncExternalStore`，除非你在写库本身的 React 绑定层。

**一句话**：当存在 **「React 之外的、会随时间变化的数据源」**，且需要在组件里 **同步读到最新快照并订阅更新**（尤其在意并发与 SSR）时，优先考虑 `useSyncExternalStore`。

---

## 4. API 形态与三个参数

```ts
const snapshot = useSyncExternalStore(
  subscribe,      // (onStoreChange) => unsubscribe
  getSnapshot,    // () => Snapshot（必须在 subscribe 收到通知后变化）
  getServerSnapshot?, // SSR 专用：() => Snapshot
);
```

### 4.1 `subscribe(onStoreChange)`

- **作用**：把 `onStoreChange` 注册到外部 store；当 store 认为「React 应重新读快照」时，调用这些回调。
- **返回值**：**取消订阅**函数；组件卸载时 React 会调用它，防止泄漏。
- **约定**：`onStoreChange` 应触发一次 **同步的重新渲染路径**（React 会在适当时机调用 `getSnapshot`）；不要在 `subscribe` 里直接 `setState` 到别的随机组件，而是由 Hook 内部统一调度。

本项目中对应 **`subscribeChatCodeFloatingToolbar`**：

```ts
export function subscribeChatCodeFloatingToolbar(fn: () => void): () => void {
	listeners.add(fn);
	return () => listeners.delete(fn);
}
```

`layoutChatCodeToolbars` 在更新模块内 `state` 后调用 **`emit()`**，遍历 `listeners` 执行每个 `fn`，即通知 React：「快照可能变了，请再读一次」。

### 4.2 `getSnapshot`

- **作用**：返回 **当前** 外部 store 的快照（任意可比较的值：对象、原始值等）。
- **关键约束**：
  - 对**同一外部状态**，连续多次调用应返回 **引用相等或内容一致** 的稳定结果（React 用 `Object.is` 比较前后两次快照，相同则跳过更新）。
  - 快照必须在 **`subscribe` 的回调被调用之后** 才发生变化，否则 React 无法可靠地把「订阅」与「读值」对齐。

本项目中对应 **`getChatCodeFloatingToolbarSnapshot`**：

```ts
export function getChatCodeFloatingToolbarSnapshot(): ChatCodeFloatingToolbarState {
	return state;
}
```

注意：这里返回的是**同一个模块级 `state` 对象的引用**（`state = HIDDEN` 或 `state = { ... }` 会替换引用）。每次 `layoutChatCodeToolbars` 赋值新对象并 `emit()` 后，`getSnapshot` 读到新引用，React 发现与上次 `Object.is` 不同，就会安排重渲染。

### 4.3 `getServerSnapshot`（可选）

- **作用**：仅在 **服务端**（没有真实 DOM、`layoutChatCodeToolbars` 不会跑）时调用，提供一个 **静态、可预测** 的快照，使 SSR 输出的 HTML 与客户端首次 `getSnapshot` 在语义上一致（或客户端首帧再很快切到真实值，取决于实现；常见模式是 SSR 用「空/默认」状态）。

本项目中第三个参数是 **内联函数**，返回「不可见、零尺寸」的默认状态：

```ts
() => ({
  visible: false,
  top: 0,
  left: 0,
  width: 0,
  lang: '',
  pinId: -1,
}),
```

与 `chatCodeToolbar.ts` 里的 **`HIDDEN`** 常量一致。这样在 SSR 阶段不会假设存在 `document` 或视口矩形，避免水合警告。

---

## 5. React 内部的运行逻辑（概念流程）

下面用**时序**描述一次完整更新（浏览器端）：

1. **首次渲染**
   - React 调用 `getServerSnapshot`（若在服务端）或 `getSnapshot`（客户端）。
   - 注册 `subscribe`，把内部的 `onStoreChange` 放进你的 `listeners`。

2. **外部世界更新 store**
   - 例如滚动触发 `layoutChatCodeToolbars(viewport)`：计算哪个代码块「贴顶」、写 DOM、`state = { visible: true, ... }`，最后 **`emit()`**。

3. **`emit()` 调用每个 listener**
   - React 收到通知后，在 **同步阶段** 再次调用 `getSnapshot()`，与上一次的快照做 **`Object.is` 比较**。
   - 若不同，标记需要更新并 **同步刷新** 使用该 store 的组件（因此名称里有 **Sync**——与并发模式下某些异步批处理相对，外部 store 的读法被强制拉到一条一致的时间线上，减轻撕裂风险）。

4. **组件重渲染**
   - `ChatCodeToolbarFloating` 读到新的 `top/left/width/lang/pinId`，`createPortal` 把工具栏画到 `document.body`。

5. **卸载**
   - React 调用 `subscribe` 返回的函数，从 `listeners` 里删除，不再响应后续 `emit()`。

---

## 6. 与本功能模块的对应关系

| 概念                | 本仓库中的实现                                        |
| ------------------- | ----------------------------------------------------- |
| 外部 store          | `chatCodeToolbar.ts` 模块级 `state` + `listeners`     |
| 写入 store          | `layoutChatCodeToolbars` 内对 `state` 赋值 + `emit()` |
| `subscribe`         | `subscribeChatCodeFloatingToolbar`                    |
| `getSnapshot`       | `getChatCodeFloatingToolbarSnapshot`                  |
| `getServerSnapshot` | 内联默认隐藏状态（与 `HIDDEN` 一致）                  |
| 消费者组件          | `ChatCodeToolbarFloating`                             |

**为何不用 `useState` 在 `layoutChatCodeToolbars` 里更新？**  
`layoutChatCodeToolbars` 由 `ChatBotView` 等在 **非 React 路径**（见上文术语表：滚动等原生/命令式回调）里调用，没有自然的 `setState` 入口。把布局结果放进模块级 store，再用 `useSyncExternalStore` 订阅，是「命令式布局 → 声明式 UI」的常见桥接方式，且满足 React 对外部源的同步读规范。

---

## 7. 与 `useEffect` + `addEventListener` 的对比（理解用）

初学者有时会写：`useEffect` 里订阅滚动，再 `setState`。这在简单场景可行，但：

- 首次渲染与订阅生效之间存在 **一帧延迟**，可能出现短暂不一致。
- 并发特性下，多处 `setState` 与外部源更新的交错更难推理。

`useSyncExternalStore` 把 **订阅生命周期** 和 **读快照规则** 固定成 React 认识的契约，文档与行为都以该 Hook 为准。

---

## 8. 相关源码路径

- 组件：`apps/frontend/src/components/design/ChatCodeToolBar/index.tsx`
- Store 与布局：`apps/frontend/src/utils/chatCodeToolbar.ts`
- 布局调用方：主要在 `ChatBotView` 等对滚动/尺寸/消息列表的响应逻辑中（搜索 `layoutChatCodeToolbars`）

---

## 9. 延伸阅读（官方）

- React 文档：[useSyncExternalStore](https://react.dev/reference/react/useSyncExternalStore)
- 设计背景：外部 store、 tearing、与 Concurrent React 的兼容性说明见官方博客与 RFC 讨论。
