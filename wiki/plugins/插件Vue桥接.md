# Vue 子应用桥接（跨框架插件支持）

> **文档角色**：Host 开发者 / 插件开发者的 Vue 子应用接入说明
> **阅读时间**：约 10 分钟
> **目标**：让 React Host 加载 Vue Remote（SFC / `<script setup>`），Host **零 Vue 依赖**，Remote 自管生命周期

## 1. 背景与目标

主站使用 React 构建，但部分业务团队希望用 Vue（特别是 `<script setup>` SFC）开发插件。早期方案让 Host 引入 Vue 并代为 `createApp`，导致 Host 依赖 Vue、版本绑定、shared singleton 复杂度高。

**当前架构**：Host **完全不安装 Vue**，Remote 自带 Vue runtime，expose 导出 `mount(el, bridge)` API，Host 仅负责将 DOM 容器和 reactive bridge 对象传递给 Remote，由 Remote 自行 `createApp` + `mount` + `unmount`。

## 2. 架构演进对比

| 维度 | 旧架构 | 新架构（当前） |
|------|--------|----------------|
| Host 依赖 | `vue` in `dependencies` | **无**（已移除） |
| Host 共享 | `vue` 加入 `MF_SHARED_EXCLUDE` + `federation.shared` | **无**（不共享） |
| 桥接方式 | Host `createApp(VueRoot, { bridge }).mount(el)` | Host 调 `Remote.mount(el, bridge)` |
| 生命周期 | Host `useEffect` 内 `createApp` + `app.unmount` | Host 调 disposer 函数（Remote 返回） |
| 版本控制 | Host 锁定 Vue 版本（`^3.5.0`） | Remote 自管 Vue 版本 |
| 启发式 | 检测 `__vccOpts` / `setup` / `render` | 检测 `{ mount }` 对象 |

## 3. 改动范围

| 文件 | 变更类型 | 说明 |
|------|----------|------|
| `apps/frontend/src/plugins/core/createVueHostBridge.tsx` | **重写** | Host 不再 import Vue；改为调用 Remote `mount` API |
| `apps/frontend/src/plugins/core/normalizePluginModule.ts` | **重写** | `looksLikeVueComponent` → `looksLikeVueMount`；类型更新 |
| `apps/frontend/src/plugins/core/types.ts` | 修改 | `PluginDescriptor.framework` 字段（新增） |
| `apps/frontend/src/plugins/core/mf.ts` | 修改 | `loadRemoteApp` 接入 `normalizePluginModule` |
| `apps/frontend/src/plugins/index.ts` | 修改 | barrel 新增 `VueRemoteExpose` / `VueRemoteMount` 类型 |
| `apps/frontend/vite.config.ts` | 修改 | 移除 `vue` 的 shared / MF_SHARED_EXCLUDE |
| `apps/frontend/package.json` | 修改 | 移除 `vue` 依赖 |
| `apps/frontend/src/plugins/host/PluginPageShell.tsx` | 修改 | 内容区追加 `overflow-auto` |
| `apps/frontend/src/i18n/locales/zh-CN.ts` | 修改 | `framework` 字段帮助文本 |
| `apps/frontend/src/i18n/locales/en-US.ts` | 修改 | 同上英文版 |
| `apps/frontend/src/views/pluginDevGuide/pluginDevGuideSections.ts` | 修改 | 插件开发指南 Vue 章节全面更新 |

## 4. 实现思路

### 4.1 整体架构

```
registry 声明 "framework": "vue"
         │
         ▼
loadRemoteApp(d)
         │  loadRemote 拿到 RawRemoteModule
         ▼
normalizePluginModule(raw, meta)
         │  isVueRemoteModule() 判定
         ▼
    ┌─ Vue Remote ─┐
    │              │
    ▼              ▼
createVueHostBridge(expose, id)
    │  resolveMount() 解析 mount
    ▼
PluginModule {
  default: ReactComponent,  ← 内部调 mount(el, bridge)
  activate,
  deactivate
}
         │
         ▼
PluginHostPage 渲染 ReactComponent
         │
         ▼
useEffect → mount(el, bridgeRef.current)
         │
         ▼
Remote 内部：createApp(App, { bridge: reactive(bridge) }).mount(el)
         │
         ▼
cleanup → dispose() 或 expose.unmount()
```

### 4.2 关键设计决策

1. **Host 零 Vue 依赖**：`vue` 从 `package.json` 移除，`vite.config.ts` shared 不再配 `vue`
2. **Remote 自管生命周期**：Remote 的 `mount()` 返回 disposer 函数（或 `expose.unmount`），Host 不感知 Vue 内部实现
3. **reactive bridge 热更新**：Host 传同一对象引用，Remote 内部 `reactive(bridge)` 包裹后可响应 `api` / `plugin` 变化
4. **函数或对象两种形态**：`mount` 可直接是函数，也可包裹在 `{ mount, unmount }` 对象中
5. **`looksLikeVueMount` 启发式**：仅检测 `{ mount }` 对象，避免与 React FC 混淆（函数形式必须靠 `framework` 声明）

### 4.3 Vue HMR（热更新）保障机制

本次架构重写的核心驱动力之一是**解决 Vue 子应用在 Module Federation 下的 HMR 失效问题**。

#### 旧架构的 HMR 痛点

在旧架构中，Host 引入 Vue 作为 shared singleton，存在以下 HMR 问题：

1.  **预打包冲突**：Host 将 `vue` 配置为 shared，但 Vite 的 `optimizeDeps` 可能会预打包 Vue，导致 Remote 加载的是预打包版本而非 ESM 版本，切断了 HMR 的 WebSocket 通道。
2.  **实例不统一**：如果 Remote 也配置了 Vue 的 shared，可能导致版本不一致或重复实例，HMR 无法正确派发更新。
3.  **Host 劫持生命周期**：Host 通过 `useEffect` 管理 `createApp`，React 的重渲染可能导致 Vue 实例被意外销毁重建。

#### 新架构的 HMR 解决方案

新架构通过将 Vue 的控制权完全交还 Remote，从根本上解决了 HMR 问题：

**1. Host 完全不干扰 Remote 的 HMR 通道**

Host 不再 shared Vue，也不 install Vue。Remote 拥有独立的 Vue runtime 和 Vite dev server，其 HMR 通道完全自主：
- WebSocket 连接由 Remote 的 dev server 建立
- 模块热替换由 Remote 的 Vite 内部处理
- Host 仅作为容器，不感知 Remote 内部的模块更新

**2. `useEffect` 空依赖确保 mount 稳定性**

在 `createVueHostBridge.tsx` 中，mount 操作放在空依赖的 `useEffect` 中：

```typescript
// 空 deps：mount 一次；SFC HMR 由 Remote 自有 Vue runtime 处理
useEffect(() => {
    const el = elRef.current;
    if (!el) return;
    const dispose = mount(el, bridgeRef.current);
    // ...
    return () => { /* cleanup */ };
}, []); // ← 空依赖，只在首次挂载时执行
```

这确保了：
- Vue 应用只被 `createApp` 和 `mount` 一次
- React 的任何重渲染（`api`/`plugin` 变化）都不会触发 Vue 实例的销毁重建
- Vue 组件内部的状态得以保持（这是 HMR 保留状态的前提）

**3. Remote 侧 Vite 配置约束**

Remote 的 `vite.config.ts` 需遵循以下约束以保障 HMR：

```typescript
// Remote 的 vite.config.ts
export default defineConfig({
    // Module Federation 配置
    plugins: [
        vitePluginFederation({
            name: 'my-vue-plugin',
            filename: 'remoteEntry.js',
            exposes: {
                './MyApp': './src/views/MyApp/index.ts',
            },
            shared: {
                // 关键：vue 不与 Host shared，Remote 自管
                vue: { singleton: true, requiredVersion: '^3.5.0' },
            },
            // 关键：开启 HMR 支持
            dev: { remoteHmr: true },
        }),
        vue(),
    ],
    resolve: {
        // 关键：去重，避免多实例
        dedupe: ['vue'],
    },
    optimizeDeps: {
        // 关键：禁止预打包 Vue，否则 HMR 失效
        exclude: ['vue'],
    },
});
```

**配置说明**：
- `shared.vue`：Remote 内部的 shared 配置，用于 Remote 自身子模块间的 Vue 共享，**不涉及 Host**
- `dev.remoteHmr: true`：通知 MF 插件开启 HMR 模式，使 Remote 的代码更新能通过 HMR 通道传递
- `dedupe: ['vue']`：确保 Remote 内部只有一个 Vue 实例
- `optimizeDeps.exclude: ['vue']`：**关键配置**——防止 Vite 预打包 Vue，确保 ESM 模块链路完整，HMR 能正常拦截模块变更

**4. reactive bridge 的热更新兼容**

Host 的 `bridgeRef` 使用对象引用（而非 reactive），Remote 内部再 `reactive` 包裹：

```typescript
// Host 侧：普通对象引用
const bridgeRef = useRef<HostBridgeProps>({
    api: props.api,
    plugin: props.plugin,
});
// Host 热更新：修改同一对象的属性
useEffect(() => {
    bridgeRef.current.api = props.api;
    bridgeRef.current.plugin = props.plugin;
}, [props.api, props.plugin]);

// Remote 侧：reactive 包裹
export function mount(el: HTMLElement, bridge: HostBridgeProps) {
    const app = createApp(App, {
        bridge: reactive(bridge), // ← Remote 做 reactive 包裹
    });
    app.mount(el);
    return () => app.unmount();
}
```

这种设计的好处是：
- Host 不需要引入 Vue 的 `reactive`（保持零依赖）
- Remote 的 `reactive(bridge)` 会代理 Host 传入的对象引用
- Host 修改 `bridgeRef.current.api` 时，Remote 的 reactive 代理能检测到变更
- Vue 组件通过 `props.bridge.api` 访问时，能自动获取最新值

**5. HMR 完整链路**

```
开发者修改 Vue SFC 文件
        │
        ▼
Remote Vite Dev Server 检测变更
        │
        ▼
Remote HMR WebSocket 推送更新
        │
        ▼
Remote Vue Runtime 热替换模块
        │
        ▼
Vue 组件 props.bridge 响应式更新
        │  （如果涉及 api/plugin 变更）
        ▼
Host → bridgeRef.current.api = newApi
        │
        ▼
Remote reactive(bridge) 检测属性变更
        │
        ▼
Vue 组件自动重新渲染
```

这个链路中，Host 完全不参与 Remote 的模块热替换过程，仅负责 bridge 属性的同步，从而保证了 HMR 的可靠性。

## 5. 关键代码对比与注释

### 5.1 `createVueHostBridge` — 旧架构 vs 新架构

**对比范围**：完整文件重写（约 L1–L90 vs 旧版 L1–L67）

**改动前** · `apps/frontend/src/plugins/core/createVueHostBridge.tsx`（git HEAD 基线 · 旧架构，约 L1–L67）

```typescript
// 旧架构：Host 引入 Vue，代为 createApp + mount
// Vue 桥接工厂：PluginHostPage 只渲染 React default
import { type ComponentType, createElement, useEffect, useRef } from 'react';
// Host 直接 import Vue——这正是要消除的
import {
	createApp,
	reactive,
	type App as VueApp,
	type Component as VueComponent,
} from 'vue';
import type { HostBridgeProps } from './types';

// Vue 根组件 props：Host 注入的 bridge（reactive，可热更新 api/locale）
export type VuePluginRootProps = {
	bridge: HostBridgeProps;
};

// 把 Vue 根组件包成 Host 可用的 React 组件
export function createVueHostBridge(
	// Vue 根组件（SFC / setup / render 均可）
	VueRoot: VueComponent,
// 返回 Host 可直接渲染的 React ComponentType；函数体开始
): ComponentType<HostBridgeProps> {
	function VueHostBridge(props: HostBridgeProps) {
		const elRef = useRef<HTMLDivElement | null>(null);
		// Vue 应用实例 ref（供卸载时使用）
		const appRef = useRef<VueApp | null>(null);
		// reactive bridge：Vue 组件通过 props.bridge 访问 Host API
		const bridgeRef = useRef(
			reactive({
				api: props.api,
				plugin: props.plugin,
			}) as HostBridgeProps,
		);
		// bridge 热更新：props 变化时同步写入 reactive 对象
		useEffect(() => {
			bridgeRef.current.api = props.api;
			bridgeRef.current.plugin = props.plugin;
		}, [props.api, props.plugin]);
		// Vue 应用生命周期：挂载 + 卸载
		useEffect(() => {
			const el = elRef.current;
			if (!el) return;
			// Host 自行 createApp——引入 Vue 的根源
			const app = createApp(VueRoot, {
				bridge: bridgeRef.current,
			});
			app.mount(el);
			appRef.current = app;
			// 卸载时调 app.unmount()
			return () => {
				app.unmount();
				appRef.current = null;
			};
		}, []);
		// 返回挂载容器 div
		return createElement('div', {
			ref: elRef,
			className: 'h-full w-full min-h-0',
			'data-plugin-root': true,
			'data-mf-framework': 'vue',
		});
	}
	VueHostBridge.displayName = 'VueHostBridge';
	return VueHostBridge;
}
```

**改动后** · `apps/frontend/src/plugins/core/createVueHostBridge.tsx`（当前 · 新架构，约 L1–L90）

```typescript
// 新架构：Host 零 Vue 依赖，Remote 自管 createApp
// Host 侧 Vue 桥：PluginHostPage 只渲染 React default
// Host **不依赖 vue**——Vue Remote 自己 createApp，expose 导出 mount(el, bridge)
import { type ComponentType, createElement, useEffect, useRef } from 'react';
// 不再 import Vue——这是核心变化
import type { HostBridgeProps } from './types';

// Vue 根组件 props：Remote 在 mount 内对 bridge 做 reactive
export type VuePluginRootProps = {
	// 响应式 bridge 对象，Remote 内部会 reactive 包裹
	bridge: HostBridgeProps;
};

// Remote mount 返回的卸载函数（void 或 disposer）
export type VueRemoteDisposer = () => void;

// Remote mount 函数签名：挂到 el，bridge 为 Host 的 API 桥
// 可返回 disposer，也可返回 undefined
export type VueRemoteMount = (
	// 挂载目标 DOM 元素
	el: HTMLElement,
	// Host Bridge 对象（Remote 会 reactive 包裹）
	bridge: HostBridgeProps,
// 返回 disposer 或 undefined
) => VueRemoteDisposer | undefined;

// Remote expose 形态：mount 函数或 { mount, unmount } 对象
export type VueRemoteExpose =
	// 直接导出 mount 函数
	| VueRemoteMount
	// 导出对象包裹（可含显式 unmount）
	| { mount: VueRemoteMount; unmount?: () => void };

// 解析 Remote expose 为 mount 函数
function resolveMount(expose: unknown, pluginId: string): VueRemoteMount {
	// 纯函数形式：直接作为 mount
	if (typeof expose === 'function') return expose as VueRemoteMount;
	// 对象形式：取 .mount 方法
	if (
		// expose 为对象
		expose &&
		typeof expose === 'object' &&
		// 有 mount 方法
		typeof (expose as { mount?: unknown }).mount === 'function'
	) {
		// 返回 mount 方法
		return (expose as { mount: VueRemoteMount }).mount;
	}
	// 两种形态都不匹配则报错
	throw new Error(
		// 错误信息含 pluginId 和正确的导出约定
		`plugin ${pluginId}: framework "vue" 须 default 导出 mount(el, bridge) 或 { mount }（Host 不内置 Vue，勿直接 export SFC）`,
	);
// 结束 resolveMount
}

// 把 Vue Remote 的 mount 包成 Host 可用的 React 组件
// registry `framework: 'vue'`；Remote 勿自建 React 桥、勿让 Host 安装 vue
export function createVueHostBridge(
	// Remote 的 expose（mount 函数或 { mount, unmount }）
	expose: VueRemoteExpose,
	// 插件 id（用于错误信息）
	pluginId = 'unknown',
// 返回 Host 可直接渲染的 React ComponentType；函数体开始
): ComponentType<HostBridgeProps> {
	// 先解析出 mount 函数
	const mount = resolveMount(expose, pluginId);

	function VueHostBridge(props: HostBridgeProps) {
		// 挂载目标 DOM ref
		const elRef = useRef<HTMLDivElement | null>(null);
		// 可变 bridge 对象包：Remote 侧 reactive(bridge) 后可收到 api/locale 热更新
		// 同一个对象引用，Remote 拿到后包裹 reactive 即可响应变更
		const bridgeRef = useRef<HostBridgeProps>({
			// 从 props 取初始 api
			api: props.api,
			// 从 props 取初始 plugin 信息
			plugin: props.plugin,
		});
		// bridge 热更新：props 变化时同步写入同一对象
		useEffect(() => {
			// 直接改引用的属性，Remote 的 reactive 会自动追踪
			bridgeRef.current.api = props.api;
			// 同步 plugin 信息
			bridgeRef.current.plugin = props.plugin;
		}, [props.api, props.plugin]);

		// 空 deps：mount 一次；SFC HMR 由 Remote 自有 Vue runtime 处理
		useEffect(() => {
			// 取 DOM 容器
			const el = elRef.current;
			// 容器不存在则跳过
			if (!el) return;
			// 调 Remote 的 mount 函数，获取 disposer
			const dispose = mount(el, bridgeRef.current);
			// 检查 expose 是否有显式 unmount 方法（对象形态）
			const explicitUnmount =
				// expose 为对象且含 unmount
				typeof expose === 'object' && expose && 'unmount' in expose
					? expose.unmount
					// 函数形态或无 unmount
					: undefined;
			// cleanup：优先 disposer，回退到显式 unmount
			return () => {
				// disposer 优先（Remote mount 返回的）
				if (typeof dispose === 'function') dispose();
				// 回退到显式 unmount（expose 对象上的）
				else explicitUnmount?.();
			};
		}, []);
		// 返回挂载容器 div：作为 Remote mount 的目标节点
		return createElement('div', {
			// React ref 绑定
			ref: elRef,
			// 全高全宽，撑满 PluginHostPage
			className: 'h-full w-full min-h-0',
			// 标记为插件根容器
			'data-plugin-root': true,
			// 标记框架类型
			'data-mf-framework': 'vue',
		});
	}
	// 设置 displayName 便于 React DevTools 识别
	VueHostBridge.displayName = 'VueHostBridge';
	// 返回包装后的 React 组件
	return VueHostBridge;
// 结束 createVueHostBridge
}
```

**变更摘要**：旧架构 `createVueHostBridge(VueRoot)` 接收 Vue 组件并内部 `createApp` + `app.unmount`；新架构 `createVueHostBridge(expose, pluginId)` 接收 Remote 的 `mount` API，Host 零 Vue 依赖。新增 `resolveMount` 支持函数和 `{ mount, unmount }` 对象两种形态。

### 5.2 `normalizePluginModule` — 旧架构 vs 新架构

**对比范围**：完整文件重写（约 L1–L63 vs 旧版 L1–L70）

**改动前** · `apps/frontend/src/plugins/core/normalizePluginModule.ts`（git HEAD 基线 · 旧架构，约 L1–L70）

```typescript
// 旧架构：检测 Vue SFC/setup 组件形态
import type { ComponentType } from 'react';
import { createVueHostBridge } from './createVueHostBridge';
import type { HostBridgeProps, PluginDescriptor, PluginModule } from './types';

// Remote 原始模块
export type RawRemoteModule = {
	default: unknown;
	framework?: string;
	mfFramework?: string;
	activate?: PluginModule['activate'];
	deactivate?: PluginModule['deactivate'];
};

// 旧启发式：检测 __vccOpts / setup / render 等 Vue 组件特征
function looksLikeVueComponent(comp: unknown): boolean {
	if (!comp || (typeof comp !== 'object' && typeof comp !== 'function')) {
		return false;
	}
	const c = comp as Record<string, unknown>;
	// React memo / forwardRef 有 $$typeof 标记
	if ('$$typeof' in c) return false;
	// Vue SFC 编译产物带 __vccOpts
	if ('__vccOpts' in c) return true;
	// setup() 函数形式的组件
	if (typeof c.setup === 'function' || typeof c.render === 'function') {
		return true;
	}
	// 函数形式的 SFC 编译产物
	if (typeof comp === 'function' && '__vccOpts' in (comp as object)) {
		return true;
	}
	return false;
}

// 三级判定：registry > expose > 启发式
export function isVueRemoteModule(
	raw: RawRemoteModule,
	meta: PluginDescriptor,
): boolean {
	if (meta.framework === 'vue') return true;
	if (meta.framework === 'react') return false;
	const tag = raw.framework ?? raw.mfFramework;
	if (tag === 'vue') return true;
	if (tag === 'react') return false;
	// 旧启发式：检测组件形态
	return looksLikeVueComponent(raw.default);
}

// 规范化：Vue → createVueHostBridge(VueRoot) 包装
export function normalizePluginModule(
	raw: RawRemoteModule,
	meta: PluginDescriptor,
): PluginModule {
	if (!raw?.default) {
		throw new Error(`plugin ${meta.id}: expose missing default export`);
	}
	if (isVueRemoteModule(raw, meta)) {
		return {
			// 旧：传 Vue 组件给 createVueHostBridge
			default: createVueHostBridge(
				raw.default as Parameters<typeof createVueHostBridge>[0],
			),
			activate: raw.activate,
			deactivate: raw.deactivate,
		};
	}
	return {
		default: raw.default as ComponentType<HostBridgeProps>,
		activate: raw.activate,
		deactivate: raw.deactivate,
	};
}
```

**改动后** · `apps/frontend/src/plugins/core/normalizePluginModule.ts`（当前 · 新架构，约 L1–L63）

```typescript
// 新架构：检测 { mount } 对象形态
import type { ComponentType } from 'react';
// 引入新的类型
import {
	createVueHostBridge,
	type VueRemoteExpose,
} from './createVueHostBridge';
import type { HostBridgeProps, PluginDescriptor, PluginModule } from './types';

// Remote 原始模块：React 组件，或 Vue mount API + framework 标记
export type RawRemoteModule = {
	// 默认导出：React 组件或 Vue expose
	default: unknown;
	// expose 级别的框架标记（可选）
	framework?: string;
	// MF 约定的框架标记（可选）
	mfFramework?: string;
	// 可选的激活回调
	activate?: PluginModule['activate'];
	// 可选的失活回调
	deactivate?: PluginModule['deactivate'];
};

// 新启发式：只检测 { mount } 对象，避免与 React FC 混淆
// 函数形式容易与 React FC 混淆，必须靠 framework: 'vue' 声明
function looksLikeVueMount(comp: unknown): boolean {
	// 必须是非空对象，且有 mount 方法
	return (
		// 非空
		!!comp &&
		// 为对象类型
		typeof comp === 'object' &&
		// 含 mount 方法
		typeof (comp as { mount?: unknown }).mount === 'function'
	);
}

// 三级判定：registry / expose framework 标记 > { mount } 启发式
export function isVueRemoteModule(
	// loadRemote 返回的原始模块
	raw: RawRemoteModule,
	// 插件描述符
	meta: PluginDescriptor,
// 返回是否为 Vue Remote；函数体开始
): boolean {
	// 优先级 1：registry 显式声明为 vue
	if (meta.framework === 'vue') return true;
	// 优先级 1b：registry 显式声明为 react
	if (meta.framework === 'react') return false;
	// 优先级 2：expose 中导出的 framework 标记
	const tag = raw.framework ?? raw.mfFramework;
	// 命中 vue 标记
	if (tag === 'vue') return true;
	// 命中 react 标记
	if (tag === 'react') return false;
	// 优先级 3：新启发式——检测 { mount } 对象
	return looksLikeVueMount(raw.default);
// 结束 isVueRemoteModule
}

// 将 loadRemote 原始模块规范为 Host 可用的 PluginModule
export function normalizePluginModule(
	// loadRemote 返回的原始模块
	raw: RawRemoteModule,
	// 插件描述符
	meta: PluginDescriptor,
// 返回规范化后的 PluginModule；函数体开始
): PluginModule {
	// 缺 default 导出则报错
	if (!raw?.default) {
		// 错误信息含插件 id
		throw new Error(`plugin ${meta.id}: expose missing default export`);
	// 结束缺导出分支
	}
	// 判定是否为 Vue Remote
	if (isVueRemoteModule(raw, meta)) {
		// Vue Remote：用 createVueHostBridge 包装 mount API
		return {
			// 包装后的 React 组件作为 default，传 expose 和 pluginId
			default: createVueHostBridge(raw.default as VueRemoteExpose, meta.id),
			// 透传 activate 回调
			activate: raw.activate,
			// 透传 deactivate 回调
			deactivate: raw.deactivate,
		};
	// 结束 Vue Remote 分支
	}
	// React Remote：原样透传
	return {
		// default 即为 React 组件
		default: raw.default as ComponentType<HostBridgeProps>,
		// 透传 activate 回调
		activate: raw.activate,
		// 透传 deactivate 回调
		deactivate: raw.deactivate,
	};
// 结束 normalizePluginModule
}
```

**变更摘要**：`looksLikeVueComponent`（检测 Vue SFC 特征）→ `looksLikeVueMount`（仅检测 `{ mount }` 对象）；`createVueHostBridge` 调用从 `(VueRoot)` 改为 `(expose, meta.id)`；新架构下函数形态必须靠 `framework: 'vue'` 声明。

### 5.3 `loadRemoteApp` 集成 `normalizePluginModule`（`mf.ts`）

**对比范围**：`loadRemoteApp` 函数中 Remote 加载与规范化（约 L246–L263）

**改动前** · `apps/frontend/src/plugins/core/mf.ts`（基线，约 L246–L260）

```typescript
export async function loadRemoteApp(
	d: PluginDescriptor,
): Promise<PluginModule> {
	ensureShared();
	ensureBustPlugin();
	const name = remoteNameOf(d);
	const expose = exposeBaseOf(d);
	// 直接 loadRemote 拿 PluginModule
	const mod = await getMf().loadRemote<PluginModule>(`${name}/${expose}`);
	if (!mod?.default) {
		throw new Error(`plugin ${d.id}: expose missing default export`);
	}
	// 原样返回
	return mod;
}
```

**改动后** · `apps/frontend/src/plugins/core/mf.ts`（当前，约 L246–L263）

```typescript
// 引入 normalizePluginModule + RawRemoteModule 类型
import {
	normalizePluginModule,
	type RawRemoteModule,
} from './normalizePluginModule';

export async function loadRemoteApp(
	// 插件描述符（含 framework 字段）
	d: PluginDescriptor,
// 返回规范化后的 PluginModule；函数体开始
): Promise<PluginModule> {
	// 在加载插件之前，确保 shared 和 bust 插件已注册
	ensureShared();
	// 确保 bust 插件已注册（entry bust 机制）
	ensureBustPlugin();
	// 取 Remote federation name
	const name = remoteNameOf(d);
	// 取 expose 路径（相对路径，如 ./App）
	const expose = exposeBaseOf(d);
	// 加载原始模块（类型为 RawRemoteModule，可能是 React 或 Vue mount API）
	const raw = await getMf().loadRemote<RawRemoteModule>(`${name}/${expose}`);
	// 缺 default 导出直接报错
	if (!raw?.default) {
		// 错误信息含插件 id 和 expose 路径
		throw new Error(
			`plugin ${d.id}: expose ./${expose} missing default export`,
		);
	// 结束缺导出分支
	}
	// 规范化：Vue Remote → createVueHostBridge(mount) 包装；React Remote 原样返回
	return normalizePluginModule(raw, d);
// 结束 loadRemoteApp
}
```

**变更摘要**：`loadRemoteApp` 不再直接返回 `loadRemote` 结果，经 `normalizePluginModule` 规范化——Vue Remote 的 mount API 被包装为 React 组件。

### 5.4 `PluginDescriptor.framework` 字段（`types.ts`）

**对比范围**：`PluginDescriptor` 接口中新增 `framework` 字段（约 L55–L69）

**改动后** · `apps/frontend/src/plugins/core/types.ts`（当前，约 L55–L69）

```typescript
// MF registerRemotes.name；默认 `id`。多插件共享同一 Remote 时填 federation name
remoteName?: string;
// MF expose 路径；默认 `./App`（如 `./IdeasList`）
expose?: string;
// 子应用 UI 框架。`vue` 时 Host 用 `createVueHostBridge` 包装 default
// 省略时：看 expose 是否 `export const framework = 'vue'`，再启发式检测 { mount } 对象
framework?: 'react' | 'vue';
// 权限声明
permissions: PluginPermission[];
// 加载时机（默认 route = 懒加载）
preload?: 'eager' | 'route' | 'idle';
enabled: boolean;
```

**变更摘要**：在 `expose` 与 `permissions` 之间新增 `framework?: 'react' | 'vue'` 字段。

### 5.5 `vite.config.ts` — 移除 Vue shared

**对比范围**：`MF_SHARED_EXCLUDE` 与 `federation.shared`（约 L19–L27 + L58–L66）

**改动前** · `apps/frontend/vite.config.ts`（git HEAD 基线 · 旧架构，约 L19–L25 + L62–L64）

```typescript
// 旧架构：Host 需排除 vue 避免预打包
const MF_SHARED_EXCLUDE = [
	'react',
	'react/jsx-runtime',
	'react/jsx-dev-runtime',
	'react-dom',
	'react-dom/client',
	// Vue 子应用与 Host 桥共享同一运行时（createVueHostBridge）
	'vue',
];
// ...
shared: {
	react: { singleton: true, requiredVersion: '^19.1.0' },
	'react-dom': { singleton: true, requiredVersion: '^19.1.0' },
	// 旧：vue 也作为 shared 单例
	vue: { singleton: true, requiredVersion: '^3.5.0' },
},
```

**改动后** · `apps/frontend/vite.config.ts`（当前 · 新架构，约 L19–L27 + L58–L64）

```typescript
// MF_SHARED_EXCLUDE：排除 optimizeDeps 预打包的依赖
// 新架构：不 shared/不 exclude vue——Host 不安装 Vue；Vue Remote 自带 runtime
const MF_SHARED_EXCLUDE = [
	// React 核心运行时
	'react',
	// React JSX 运行时（生产）
	'react/jsx-runtime',
	// React JSX 运行时（开发）
	'react/jsx-dev-runtime',
	// React DOM 渲染
	'react-dom',
	// React DOM 客户端
	'react-dom/client',
	// 不再包含 vue——Host 无 Vue 依赖
];
// ...
// federation shared 配置：跨 Remote 共用单例
shared: {
	// React 单例，版本锁定
	react: { singleton: true, requiredVersion: '^19.1.0' },
	// React DOM 单例，版本锁定
	'react-dom': { singleton: true, requiredVersion: '^19.1.0' },
	// 不再包含 vue——Remote 自管 Vue runtime
},
```

**变更摘要**：`vue` 从 `MF_SHARED_EXCLUDE` 和 `federation.shared` 中移除；注释说明新架构下 Host 不安装 Vue。

### 5.6 `package.json` — 移除 Vue 依赖

**对比范围**：`dependencies` 中 `vue` 字段（1 行）

**改动前** · `apps/frontend/package.json`（git HEAD 基线 · 旧架构）

```json
{
  "dependencies": {
    "sonner": "^2.0.7",
    "tailwind-merge": "^3.4.0",
    "uuid": "9",
    "vue": "^3.5.41",
    "zod": "^4.2.1"
  }
}
```

**改动后** · `apps/frontend/package.json`（当前 · 新架构）

```json
{
  "dependencies": {
    "sonner": "^2.0.7",
    "tailwind-merge": "^3.4.0",
    "uuid": "9",
    "zod": "^4.2.1"
  }
}
```

**变更摘要**：`vue` 从 Host `dependencies` 移除——Remote 自管 Vue 版本。

### 5.7 `PluginPageShell.tsx` — 追加 `overflow-auto`

**对比范围**：内容区 className 变更（约 L35）

**改动前** · `apps/frontend/src/plugins/host/PluginPageShell.tsx`（git HEAD 基线）

```typescript
// 旧：无 overflow 声明，Vue 插件超长内容可能溢出
'h-full min-h-0 bg-theme-background rounded-md',
```

**改动后** · `apps/frontend/src/plugins/host/PluginPageShell.tsx`（当前，约 L35）

```typescript
// 新：追加 overflow-auto，确保 Vue 插件内滚动容器正确工作
'h-full min-h-0 bg-theme-background overflow-auto',
```

**变更摘要**：内容区容器追加 `overflow-auto`，修复 Vue 插件内容过长时无法滚动的问题。

### 5.8 barrel 导出（`index.ts`）

**对比范围**：Vue bridge 相关导出（约 L8–L13）

**改动后** · `apps/frontend/src/plugins/index.ts`（当前，约 L8–L13）

```typescript
// Vue 桥相关类型导出（新增 VueRemoteExpose、VueRemoteMount）
export type {
	VuePluginRootProps,
	VueRemoteExpose,
	VueRemoteMount,
} from './core/createVueHostBridge';
// Vue 桥接工厂导出
export { createVueHostBridge } from './core/createVueHostBridge';
// ... 其余导出
```

**变更摘要**：barrel 新增 `VueRemoteExpose`、`VueRemoteMount` 类型导出，供 Remote 侧 TypeScript 类型提示。

### 5.9 i18n — `framework` 字段帮助文本

**对比范围**：`plugins.registry.help.framework` 键（zh-CN.ts + en-US.ts，各 2 行）

**改动后** · `apps/frontend/src/i18n/locales/zh-CN.ts`（当前，约 L1785）

```typescript
// 新增 framework 字段帮助文本
'plugins.registry.help.framework':
	// 可选值说明 + Host 行为 + Remote 导出约定
	'可选 react | vue。vue 时 Remote 须导出 mount(el, bridge)；Host 不装 Vue，仅调用 mount。',
```

## 6. 插件接入流程（Vue Remote 开发者视角）

### 6.1 步骤

1. **Registry 声明**：`"framework": "vue"`
2. **Remote 依赖**：`pnpm add vue`（Remote 自带 Vue runtime）
3. **Expose 导出**：`default` 导出 `mount(el, bridge)` 函数或 `{ mount }` 对象
4. **样式契约**：每个 expose 入口 `import '@/styles.css'`

### 6.2 接入示例

**Remote 侧 mount API**：

```typescript
// src/views/MyVueApp/index.ts（expose 入口）
// Host 不执行 main.ts：样式必须挂在本入口
import '@/styles.css';
import { createApp, reactive } from 'vue';
import App from './App.vue';

// 导出 mount 函数（推荐简洁形式）
export function mount(el: HTMLElement, bridge: HostBridgeProps) {
	// 同一 bridge 对象会被 Host 热更新 api/locale
	// 用 reactive 包一层即可响应 Host 的属性写入
	const app = createApp(App, { bridge: reactive(bridge) });
	// 挂到 Host 分配的容器
	app.mount(el);
	// 返回 disposer——Host 卸载时调用
	return () => app.unmount();
}

// default 导出 mount 函数
export default mount;
// framework 由 registry "framework": "vue" 声明即可
```

**registry JSON**：

```json
{
  "id": "my-vue-plugin",
  "framework": "vue",
  "remoteName": "micro",
  "expose": "./MyVueApp",
  "entry": "http://127.0.0.1:9008/mf-manifest.json",
  "injectRoute": false,
  "permissions": [],
  "trust": "trusted",
  "enabled": true
}
```

**App.vue 组件**：

```vue
<!-- src/views/MyVueApp/App.vue -->
<script setup lang="ts">
// 从 Host 桥接注入的 reactive bridge 读取 API
const props = defineProps<{ bridge: import('@/plugins').VuePluginRootProps['bridge'] }>();
// props.bridge.api / props.bridge.plugin 响应式可用
</script>
```

## 7. 兼容性与影响

| 维度 | 说明 |
|------|------|
| Host 依赖 | 移除 `vue`——零 Vue 依赖 |
| React Remote | 完全不受影响 |
| Vue Remote | **新约定**：必须导出 `mount(el, bridge)` 而非 SFC |
| 版本控制 | Remote 自管 Vue 版本，不再受 Host 锁定 |
| 样式隔离 | Vue 组件挂载后处于 `data-plugin-root` 容器内，自动继承 `@scope` 隔离 |
| 热更新 | Host 改 `bridge.api` / `bridge.plugin` 属性，Remote 的 `reactive(bridge)` 自动响应 |
| 卸载清理 | Host 调 `disposer()` 或 `expose.unmount()`，Remote 内部调 `app.unmount()` |

## 8. 行为变化

| 场景 | 旧架构 | 新架构 |
|------|--------|--------|
| Host 依赖 | 需装 `vue@^3.5.0` | 无任何 Vue 依赖 |
| Vue 版本 | Host 锁定版本 | Remote 自管版本 |
| Remote 导出 | `export default App from './App.vue'` | `export function mount(el, bridge)` |
| 生命周期 | Host 代管 `createApp` / `app.unmount` | Remote 自管 `createApp`，返回 disposer |
| 类型安全 | 无类型导出 | `VueRemoteExpose` / `VueRemoteMount` 类型 |
| 启发式 | 检测 SFC 特征 | 仅检测 `{ mount }` 对象 |

## 9. 风险与回归

### 9.1 建议回归路径

1. **React Remote**：加载 / 卸载 / 切换插件正常
2. **Vue Remote**（新 mount API）：加载 / 卸载 / 切换 / HMR 正常
3. **混合场景**：React + Vue 插件共存、路由切换、全局状态同步
4. **样式隔离**：Vue 插件内 Tailwind 样式不泄漏、不被其他插件污染
5. **API 热更新**：Host `api` 变化时 Vue 组件通过 `reactive(bridge)` 实时响应
6. **卸载清理**：切换插件时 `app.unmount()` 正确执行，无内存泄漏
7. **`PluginPageShell` 滚动**：Vue 插件长内容可正常滚动

### 9.2 已知限制

- 函数形态的 mount 必须靠 `framework: 'vue'` 声明（裸函数易与 React FC 混淆）
- `trust: untrusted` 插件仍走 iframe，不进入 Vue 桥接流程
- Vue Remote 的 Teleport（`to="body"`）不受 portal-scope 收编

## 10. 相关文档索引

| 文档 | 说明 |
|------|------|
| [样式隔离乾坤加固.md](../style/样式隔离乾坤加固.md) | 样式隔离第三轮加固（transpile / CSSOM / Portal） |
| [样式隔离领域门户.md](../style/样式隔离领域门户.md) | Realm 键 + React Portal 收编 |
| [插件开发指南.md](./插件开发指南.md) | §4.3 Vue + registry framework / §5.2 expose 须 import styles.css |
| [模块联邦实现指南.md](./模块联邦实现指南.md) | MF 实现细节总览 |
| [plugin-info.md](./插件图标系统.md) | Remote 接入约定 |

---

（若与仓库最新源码不一致，以源码为准）