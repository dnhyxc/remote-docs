# Tauri 桌面端生产环境禁用 WebView 系统右键菜单

## 1. 背景与目标

在 Tauri 打包的桌面端应用中，WebView（各平台底层分别为 macOS WKWebView / Windows WebView2 / Linux WebKitGTK）默认会向用户暴露系统的右键菜单，包含「后退 / 前进 / 重新加载 / 检查元素 / 复制 / 粘贴」等浏览器原生项。这些项在桌面应用形态下存在两类问题：

1. **体验割裂**：用户在应用内右键会看到浏览器风格的菜单，与原生应用预期不符；「检查元素」在线上桌面包中暴露 DOM，既无意义也存在轻微的信息泄露与调试风险。
2. **与项目自定义菜单冲突**：项目内部分场景基于 `contextmenu` 事件自行渲染右键菜单。系统菜单与自定义菜单会同时弹出，造成双菜单叠加。

本改动的目标：**在 Tauri 桌面端且为生产构建时**，通过 `preventDefault()` 屏蔽 WebView 默认系统右键菜单；**不调用 `stopPropagation()`**，保留 `contextmenu` 事件继续冒泡派发，使项目内基于该事件的自定义菜单逻辑不受影响。

## 2. 改动范围

- `apps/frontend/src/router/index.tsx`（`App` 组件首个 `useEffect` 内新增 `contextmenu` 监听，约 L24–L30）

仅一处改动，未触及其它文件、未修改 Tauri 侧配置或 WebView 初始化参数。

## 3. 实现思路

1. **入口选址**：在 `App` 组件首个 `useEffect`（空依赖，仅运行一次）内注册监听，保证整应用生命周期只绑定一次，避免重复绑定。
2. **双条件门控**：
   - `import.meta.env.PROD`：仅生产构建生效。开发环境（`vite dev`）保留系统右键，便于开发者使用「检查元素」「重新加载」等能力调试。
   - `isTauriRuntime()`：仅 Tauri 桌面端生效。纯浏览器访问（含部署为 Web 站点时）不屏蔽，避免影响 Web 用户的浏览器原生右键体验。
3. **仅 `preventDefault`，不 `stopPropagation`**：`e.preventDefault()` 只取消浏览器默认行为（系统菜单弹出不发生），事件仍会沿 DOM 树冒泡，项目内任何基于 `contextmenu` 的自定义菜单监听仍可正常触发并自行渲染。
4. **无清理函数**：该监听绑定在 `document` 上、随应用生命周期常驻，故未在 `useEffect` 的 cleanup 中 `removeEventListener`。这是有意为之：应用整个生命周期都需要屏蔽系统右键；`useEffect` 的 cleanup 仅返回 `unsub`（routeInjector 订阅卸载），与新监听解耦。
5. **未改 Tauri 配置**：未在 `tauri.conf.json` 或 Rust 侧禁用 WebView 的 devtools / context menu，原因是该方案无法区分开发与生产、且对自定义菜单的干扰更大。前端方案更精细可控。

## 4. 关键代码对比与注释

### 4.1 `App` 组件首个 `useEffect`（`apps/frontend/src/router/index.tsx`）

**对比范围**：`App` 组件内负责订阅 `routeInjector` 与初始化 `pluginManager` 的 `useEffect`，从 `useEffect(() => {` 到 `}, []);` 闭合（完整符号）。

**改动前** · `apps/frontend/src/router/index.tsx`（基线 `HEAD`，约 L24–L33）

```tsx
// App 组件内首个 useEffect，空依赖数组保证仅在挂载时执行一次
useEffect(() => {
	// 订阅路由注入器 routeInjector，路由表发生变更时回调
	const unsub = routeInjector.subscribe(() => {
		// 以函数式更新自增 routeEpoch，避免闭包持有陈旧 state，触发后续 router 重建
		setRouteEpoch((n) => n + 1);
	});
	// 异步初始化插件管理器，不阻塞渲染
	void pluginManager
		// 触发 pluginManager 内部插件加载与注册流程
		.init()
		// 初始化成功后再次自增 routeEpoch，使依赖插件的路由得以重建
		.then(() => setRouteEpoch((n) => n + 1))
		// 初始化失败时在控制台输出错误，便于排查插件加载问题
		.catch((e) => console.error('[plugins] init failed', e));
	// 卸载时取消 routeInjector 订阅，防止内存泄漏与重复回调
	return unsub;
// 空依赖数组：该副作用只在组件挂载时运行一次
}, []);
```

**改动后** · `apps/frontend/src/router/index.tsx`（当前源码，约 L24–L39）

```tsx
// App 组件内首个 useEffect，空依赖数组保证仅在挂载时执行一次
useEffect(() => {
	// 双门控：仅生产构建（import.meta.env.PROD）且运行于 Tauri 桌面端（isTauriRuntime()）时进入屏蔽逻辑
	if (import.meta.env.PROD && isTauriRuntime()) {
		// 线上桌面端禁 WebView 系统右键（后退/刷新/检查元素）；仅 preventDefault，不拦截项目自定义菜单
		document.addEventListener('contextmenu', (e) => {
			// 仅阻止浏览器默认行为（系统右键菜单弹出不发生），不调用 stopPropagation，事件继续冒泡，项目自定义菜单仍可基于 contextmenu 自行渲染
			e.preventDefault();
		});
	}
	// 订阅路由注入器 routeInjector，路由表发生变更时回调（与改动前一致）
	const unsub = routeInjector.subscribe(() => {
		// 以函数式更新自增 routeEpoch，避免闭包持有陈旧 state，触发后续 router 重建
		setRouteEpoch((n) => n + 1);
	});
	// 异步初始化插件管理器，不阻塞渲染（与改动前一致）
	void pluginManager
		// 触发 pluginManager 内部插件加载与注册流程
		.init()
		// 初始化成功后再次自增 routeEpoch，使依赖插件的路由得以重建
		.then(() => setRouteEpoch((n) => n + 1))
		// 初始化失败时在控制台输出错误，便于排查插件加载问题
		.catch((e) => console.error('[plugins] init failed', e));
	// 卸载时取消 routeInjector 订阅，防止内存泄漏与重复回调（仅返回 routeInjector 的 unsub，未含 contextmenu 监听卸载，因其随应用生命周期常驻）
	return unsub;
// 空依赖数组：该副作用只在组件挂载时运行一次
}, []);
```

**变更摘要**：在 `useEffect` 顶部新增一个 `if` 块，于「生产 + Tauri 运行时」双条件下向 `document` 注册 `contextmenu` 监听并调用 `e.preventDefault()`，屏蔽 WebView 系统右键菜单；下方订阅 `routeInjector` 与初始化 `pluginManager` 的原逻辑未改动，`useEffect` 闭合与 cleanup 返回值保持不变。

## 5. 兼容性与影响

- **开发环境（`vite dev`）**：`import.meta.env.PROD` 为 `false`，不注册监听，开发者右键仍可见系统菜单与「检查元素」，无回归。
- **Web 站点访问**：`isTauriRuntime()` 为 `false`，不注册监听，浏览器用户的原生右键体验不受影响。
- **Tauri 桌面端生产包**：系统右键菜单不再弹出；项目内基于 `contextmenu` 事件的自定义菜单因未 `stopPropagation`，行为保持原样。
- **无破坏性变更**：未移除任何既有功能，未改变事件流；仅扩展「在特定环境下取消默认行为」。
- **内存与性能**：新增一个 `document` 级事件监听，常驻不卸载，开销可忽略。
- **回归建议**：
  - 桌面端生产包内右键空白处、文本输入框、自定义菜单区域（应仍弹出自定义菜单）。
  - 桌面端开发包内右键应仍可见系统菜单。
  - 浏览器访问站点时右键应仍可见浏览器原生菜单。

## 6. 相关源码路径

| 说明 | 路径 |
| ---- | ---- |
| 改动文件：`App` 组件首个 `useEffect` 内新增 `contextmenu` 监听 | `apps/frontend/src/router/index.tsx` |
| `isTauriRuntime` 运行时判定工具来源 | `apps/frontend/src/utils/runtime.ts` |
| `routeInjector` 路由注入器（被订阅对象，未改动） | `apps/frontend/src/plugins` |

---

若与仓库最新源码不一致，以源码为准。
