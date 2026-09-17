# Module Federation 远程对接

## 1. 背景与目标

`remote-docs` 是一个 Module Federation（模块联邦，下文简称 MF）远程微应用，承载三个文档页面：

- **update-info**（更新日志）
- **project-guide**（项目指南）
- **plugin-dev-guide**（插件开发指南）

MF 远程模块名为 `remoteDocs`，通过 `./App` 暴露入口，本地开发端口为 `9013`。

该应用支持两种运行模式：

1. **嵌入 Host 模式**：Host 通过 MF 加载 `remoteDocs/App`，以 props 传入 `api`（Bridge API）与 `plugin`（插件元信息），应用根据 `plugin.routePath` 决定初始路由。
2. **独立（standalone）模式**：通过外链直接打开，使用 `?lang=&theme=` 查询参数控制语言与主题，根据浏览器地址栏 pathname 决定初始路由。

Host 侧在 `apps/backend/uploads/remotes/plugins-registry.json` 注册了三个条目，共享同一个 remote / expose / port，但 `routePath` 各不相同：

| 注册名 | routePath | 说明 |
|---|---|---|
| `remoteDocsUpdateInfo` | `/update-info` | 更新日志 |
| `remoteDocsProjectGuide` | `/project-guide` | 项目指南 |
| `remoteDocsPluginDevGuide` | `/plugin-dev-guide` | 插件开发指南 |

三者均配置 `injectRoute: true`、无 `menu`。

本文档记录将 `remote-docs` 从「仅支持嵌入 Host」升级为「嵌入 Host + 外链独立预览」双模式的实现思路与关键代码。

---

## 2. 改动范围

| 文件 | 改动类型 | 说明 |
|---|---|---|
| `vite.config.ts` | 纯已有（未改动） | MF 构建配置，本文档仅做逐行注释 |
| `src/index.ts` | 纯已有（未改动） | MF expose 入口，引入样式并导出 App |
| `src/types/host.ts` | 纯已有（未改动） | Host Bridge 类型契约 |
| `src/App.tsx` | **已改动** | 新增 `standalone` 标志、`pluginRootRef`、`DOC_PATHS` 集合、`resolveInitialPath` 函数 |
| `package.json` | **已改动** | 新增 `publish` / `deploy` / `restart` 脚本 |

---

## 3. 实现思路

### 3.1 为什么用 Module Federation 而不是 iframe

- MF 共享 React 单例，避免双 React 实例导致的 Hooks 失效。
- MF 支持跨边界 HMR（Hot Module Replacement，热模块替换），远程模块改动可热推到 Host。
- MF 允许 Host 直接以 props 传入 Bridge API，无需 postMessage 序列化，调用链更直接、类型更安全。

### 3.2 为什么 `react` / `react-dom` 设置 `singleton: true`

- 防止 Host 与 Remote 各自打包一份 React 实例。双实例会导致 `useContext` 拿不到 Provider 值、`useState` 报错等致命问题。`singleton: true` 强制全局只加载一个实例。

### 3.3 为什么 `hostInitInjectLocation: 'entry'`

- 确保 Host 的运行时初始化注入发生在入口（entry）级别，而非模块级别，避免 MF 共享模块在注入完成前被提前加载。

### 3.4 为什么 `optimizeDeps.exclude` 包含 react 系列

- Vite 默认会预打包（pre-bundle）`node_modules` 中的依赖。但 `react` / `react-dom` 已由 MF 的 `shared` 机制管理，若 Vite 也预打包，会导致运行时出现两份不一致的模块。排除后由 MF 统一管控。

### 3.5 为什么需要 `clearMfViteDepCache` 插件

- MF 的 `mf_owner` id 会随配置递增，导致 `node_modules/.vite/deps` 缓存失效。若不清除，`vite serve` 启动时会因缓存与实际配置不匹配而崩溃。该插件在每次 `serve` 启动前同步删除 `.vite` 目录。

### 3.6 为什么 `base` 设置为完整 origin URL

- MF 远程资源（remoteEntry.js、chunk 等）会被 Host 跨域加载。`base` 必须是绝对 URL（如 `https://dnhyxc.cn:9017/`），否则资源会按 Host 的 origin 解析，导致 404。

### 3.7 为什么 `dts: false`

- 本 remote 不向 Host 暴露 TypeScript 类型声明。Host 侧通过自有的 `HostBridgeProps` 类型契约与 remote 交互，无需 remote 提供 `.d.ts`。

### 3.8 为什么 `remoteHmr: true`

- 开启从 remote 到 host 的热模块替换。在 `vite serve` 开发时，remote 代码改动会自动推送到正在运行的 Host 页面，无需手动刷新。

### 3.9 为什么 `index.ts` 单独引入样式

- Host 加载 remote 时只执行 `src/index.ts`（MF expose 入口），不执行 `src/main.tsx`。`main.tsx` 中的 `import '@/styles.css'` 不会被触发，因此样式必须在 `index.ts` 中再次引入，否则嵌入 Host 后无样式。

### 3.10 为什么需要 `App.activate` / `App.deactivate`

- 这是 Host 的插件生命周期钩子。Host 在激活 / 停用插件时调用这两个方法，remote 可在此做日志记录、资源初始化 / 清理等工作。

### 3.11 为什么需要 `DOC_PATHS` Set

- 用于校验 Host 传入的 `routePath` 是否属于本 remote 已知的内部路由。若 routePath 不在白名单中，回退到默认 `/update-info`，防止任意路径注入。

### 3.12 为什么需要 `standalone` 标志

- `standalone = !hasBridge`：没有 Bridge props 时为独立模式。独立模式下，应用同步浏览器 URL（`syncBrowserUrl={standalone}`），并根据地址栏 pathname 决定初始路由；嵌入模式下，跟随 Host 的 `routePath`。

---

## 4. 关键代码对比与注释

### 4.1 `vite.config.ts` — MF 构建配置

**来源** · `vite.config.ts`（当前源码，约 L1–L97，纯已有文件未改动）

```typescript
// 引入 Node.js 文件系统模块（fs），用于同步删除缓存目录
import fs from 'node:fs';
// 引入 Node.js 路径处理模块（path），用于跨平台拼接目录路径
import path from 'node:path';
// 引入 Module Federation 的 Vite 插件（federation），将本应用暴露为远程模块
import { federation } from '@module-federation/vite';
// 引入 Tailwind CSS 的 Vite 插件（tailwindcss），负责扫描类名并生成样式
import tailwindcss from '@tailwindcss/vite';
// 引入 Vite 官方 React 插件（react），提供 JSX 转换与 Fast Refresh 热更新
import react from '@vitejs/plugin-react';
// 引入 Vite 配置工具：defineConfig（带类型提示的配置函数）、loadEnv（加载环境变量）、Plugin（插件类型）
import { defineConfig, loadEnv, type Plugin } from 'vite';

/** MF mf_owner id 递增后 .vite/deps 会失效，serve 时清缓存 */
// 定义清理 Vite 依赖预打包缓存的自定义插件工厂函数，返回符合 Vite Plugin 接口的对象
function clearMfViteDepCache(): Plugin {
	// 返回一个 Vite 插件对象字面量
	return {
		// 插件名称，用于在 Vite 插件流水线中唯一标识
		name: 'clear-mf-vite-dep-cache',
		// 强制该插件在 pre 阶段（最前面）执行，确保缓存清理先于其他插件读取依赖
		enforce: 'pre',
		// config 钩子：Vite 解析配置时调用，第二个参数解构出 command（serve 或 build）
		config(config, { command }) {
			// 仅在本地开发服务（serve）时执行清理，构建（build）时直接返回跳过
			if (command !== 'serve') return;
			// 解析项目根目录：优先使用 config.root，否则回退到当前工作目录（process.cwd()）
			const root = config.root ? path.resolve(config.root) : process.cwd();
			// 同步删除 node_modules/.vite 目录（Vite 依赖预打包缓存），recursive 递归删除，force 忽略不存在错误
			fs.rmSync(path.join(root, 'node_modules/.vite'), {
				// recursive: true 表示递归删除目录及其子内容
				recursive: true,
				// force: true 表示目录不存在时不报错
				force: true,
			});
		},
	};
}

// 本地开发监听 IP，使用 127.0.0.1 避免暴露到局域网
const host = '127.0.0.1';
// 本地开发监听端口，与 Host 注册表中声明的端口 9013 一致
const port = 9013;
// 拼接本地开发完整源地址（origin），供 server.origin 与默认 public origin 使用
const devOrigin = `http://${host}:${port}`;

// 导出 Vite 配置，使用 defineConfig 传入函数形式以接收 mode 参数（development/production）
export default defineConfig(({ mode }) => {
	// 加载环境变量：mode 为当前模式，process.cwd() 为项目根，第三个参数 '' 表示加载所有前缀的变量（不限于 VITE_）
	const env = loadEnv(mode, process.cwd(), '');
	// 优先取环境变量中的对外公开 origin（生产用域名），不存在则回退到本地 devOrigin
	const origin = env.VITE_REMOTE_PUBLIC_ORIGIN || devOrigin;
	// React Refresh（热更新）宿主地址，优先取环境变量，默认指向 Host 的 9002 端口
	const reactRefreshHost =
		env.VITE_REACT_REFRESH_HOST || 'http://127.0.0.1:9002';

	// 返回最终的 Vite 配置对象
	return {
		// 设置资源基址（base）为完整 origin + '/'，保证 MF 远程资源以绝对 URL 加载（跨域必需）
		base: `${origin}/`,
		// 指定 Vite 缓存目录为项目根下的 .vite-cache，与默认 node_modules/.vite 区分避免冲突
		cacheDir: path.resolve(__dirname, '.vite-cache'),
		// 插件数组，按注册顺序执行
		plugins: [
			// 注册自定义缓存清理插件，放在最前确保 serve 启动时先清理
			clearMfViteDepCache(),
			// 注册 React 插件，传入 reactRefreshHost 让热更新连接到 Host 的 9002 端口
			react({
				// reactRefreshHost：热更新 WebSocket 连接的目标地址
				reactRefreshHost,
			}),
			// 注册 Tailwind CSS 插件，扫描类名并生成最终样式
			tailwindcss(),
			// 注册 Module Federation 插件，声明远程模块的全部配置
			federation({
				// 远程模块名（name），Host 通过此名引用本 remote
				name: 'remoteDocs',
				// 远程入口文件名（filename），Host 通过此文件加载远程模块清单
				filename: 'remoteEntry.js',
				// 开启 manifest（清单）生成，便于 Host 解析共享依赖版本与暴露项
				manifest: true,
				// 暴露映射表（exposes）：Host 通过 'remoteDocs/App' 加载 ./src/index.ts
				exposes: {
					// 键为对外暴露的路径，值为本地入口文件
					'./App': './src/index.ts',
				},
				// 共享依赖配置（shared），避免 Host 与 Remote 各自打包一份
				shared: {
					// react 设为单例（singleton），强制全局唯一实例，requiredVersion 约束版本范围
					react: { singleton: true, requiredVersion: '^19.1.0' },
					// react-dom 设为单例，与 react 配套，防止双实例导致 Hooks 失效
					'react-dom': { singleton: true, requiredVersion: '^19.1.0' },
				},
				// Host 初始化注入位置为 entry（入口级别），保证 Host 运行时注入在入口完成
				hostInitInjectLocation: 'entry',
				// 关闭类型声明（dts）生成，本 remote 不向 Host 暴露 TypeScript 类型
				dts: false,
				// 开发态配置块（dev）
				dev: {
					// 开启远程热更新（remoteHmr），让 Remote 代码改动能热推到正在运行的 Host
					remoteHmr: true,
				},
			}),
		],
		// 模块解析配置（resolve）
		resolve: {
			// 路径别名（alias）映射
			alias: {
				// '@' 指向 src 目录，简化导入路径
				'@': path.resolve(__dirname, 'src'),
			},
		},
		// 依赖预打包配置（optimizeDeps）
		optimizeDeps: {
			// 排除列表（exclude）：阻止 Vite 预打包这些由 MF 管理的共享依赖
			exclude: [
				// 排除 react 本体
				'react',
				// 排除 react JSX 运行时（生产模式）
				'react/jsx-runtime',
				// 排除 react JSX 开发运行时（开发模式）
				'react/jsx-dev-runtime',
				// 排除 react-dom 本体
				'react-dom',
				// 排除 react-dom 的 client 入口（createRoot）
				'react-dom/client',
			],
		},
		// 本地开发服务器配置（server）
		server: {
			// 监听 IP
			host,
			// 监听端口
			port,
			// 严格端口（strictPort）：端口被占用时直接报错而不自动 +1
			strictPort: true,
			// 服务器 origin，用于生成内部绝对 URL
			origin: devOrigin,
			// 开启 CORS（跨域资源共享），允许 Host 跨域加载本 remote 资源
			cors: true,
			// 自定义响应头
			headers: {
				// 允许任意来源跨域访问，MF 跨域加载 remoteEntry.js 必需
				'Access-Control-Allow-Origin': '*',
			},
		},
		// 预览服务器配置（preview，对应 vite preview 命令）
		preview: {
			// 监听 IP
			host,
			// 监听端口
			port,
			// 严格端口
			strictPort: true,
			// 开启 CORS
			cors: true,
		},
		// 构建配置（build）
		build: {
			// 构建目标为 esnext（最新 ES 标准），配合现代浏览器
			target: 'esnext',
			// 关闭 modulePreload（模块预加载），MF 场景下由 Host 统一管理加载时机
			modulePreload: false,
			// 关闭压缩（minify），便于调试远程模块；生产压缩由 CDN / 网关层处理
			minify: false,
		},
	};
});
```

---

### 4.2 `src/index.ts` — MF expose 入口

**来源** · `src/index.ts`（当前源码，约 L1–L8，纯已有文件未改动）

```typescript
/**
 * MF expose 入口。
 * Host 不跑 main.tsx，须在此引入样式。
 */
// 引入全局样式表（styles.css）；Host 加载本 remote 时只执行此入口，不走 main.tsx，样式必须在此引入
import '@/styles.css';
// 引入根组件 App，作为 MF 暴露的默认导出
import App from './App';

// 将 App 作为默认导出（default export），Host 通过 remoteDocs/App 即可获取该组件
export default App;
```

---

### 4.3 `src/types/host.ts` — Host Bridge 类型契约

**来源** · `src/types/host.ts`（当前源码，约 L1–L28，纯已有文件未改动）

```typescript
// 定义 Host 支持的语言类型联合：简体中文 / 英文（美国）
export type HostLocale = 'zh-CN' | 'en-US';

// 定义 Host Bridge 的完整 props 类型契约，Host 加载 remote 时传入此结构的子集
export interface HostBridgeProps {
	// api 字段：Host 提供的运行时 API，包含主题、语言、导航、事件、UI 等
	api: {
		// 主题模式：light（亮色）或 dark（暗色）
		theme: 'light' | 'dark';
		// 语言，可选，未传时由 remote 自行决定默认值
		locale?: HostLocale;
		// 导航函数：调用后由 Host 执行路由跳转（如切换到其他页面）
		navigate: (to: string) => void;
		// 事件总线（event bus），提供 on / off / emit 三方法
		event: {
			// on：监听指定事件，handler 在事件触发时被调用，data 为事件载荷
			on: (event: string, handler: (data?: unknown) => void) => void;
			// off：取消监听指定事件，需传入与 on 时相同的 handler 引用
			off: (event: string, handler: (data?: unknown) => void) => void;
			// emit：向 Host 发射指定事件，携带可选 data 载荷
			emit: (event: string, data?: unknown) => void;
		};
		// ui 字段：Host 提供的 UI 能力，可选
		ui?: {
			// showToast：弹出轻提示（toast），config 包含消息、类型与标题
			showToast?: (config: {
				// 提示正文消息
				message: string;
				// 提示类型：info / success / warning / error
				type?: 'info' | 'success' | 'warning' | 'error';
				// 提示标题，可选
				title?: string;
			}) => void;
		};
	};
	// plugin 字段：Host 注册的插件元信息
	plugin: {
		// 插件唯一标识 ID
		id: string;
		// 插件显示名称，可选
		name?: string;
		// 插件版本号
		version: string;
		// 插件描述，可选
		description?: string;
		// 插件路由路径（routePath），Host 据此决定 remote 的初始路由
		routePath?: string;
	};
}
```

---

### 4.4 `src/App.tsx` — BridgeSync 与 routePath 路由解析

本文件是本次改动核心。改动前仅支持嵌入 Host 模式，改动后新增独立（standalone）模式支持。

#### 4.4.1 改动前（来自 `git HEAD`）

**来源** · `src/App.tsx`（git HEAD 版本，改动前）

```tsx
// 引入 NavigationProvider（导航上下文提供者），用于管理内存路由状态
import { NavigationProvider } from '@/router/NavigationContext';
// 引入 AppRouter（应用路由器），根据当前路径渲染对应页面组件
import { AppRouter } from '@/router/AppRouter';
// 引入 I18nProvider（国际化提供者），提供多语言上下文
import { I18nProvider } from '@/i18n';
// 从 useHostBridgeSync 模块引入 Host 同步 Hooks
import {
	// useHostLocale：从 Bridge api 同步语言设置
	useHostLocale,
	// useHostTheme：从 Bridge api 同步主题设置
	useHostTheme,
} from '@/hooks/useHostBridgeSync';
// 引入 HostBridgeProps 类型，用于标注 props 类型
import type { HostBridgeProps } from '@/types/host';
// 引入全局样式
import '@/styles.css';

// 定义 AppProps 类型：从 HostBridgeProps 中 Pick 出 api 和 plugin，再设为 Partial（全部可选）
type AppProps = Partial<Pick<HostBridgeProps, 'api' | 'plugin'>>;

// BridgeSync 组件：无渲染，仅负责将 Bridge api 的语言与主题同步到 remote 的上下文
function BridgeSync({ api }: { api?: HostBridgeProps['api'] }) {
	// 调用 useHostLocale，将 api.locale 同步到 i18n 上下文
	useHostLocale(api);
	// 调用 useHostTheme，将 api.theme 同步到主题上下文
	useHostTheme(api);
	// 返回 null，此组件不产生 DOM
	return null;
}

/**
 * 文档 Remote 壳：三页内存路由。
 * 嵌入 Host → 默认 /update-info；独立预览 → /home。
 */
// App 根组件：接收可选的 api 与 plugin props
function App(props: AppProps = {}) {
	// hasBridge：判断是否同时存在 api 和 plugin，存在则为嵌入 Host 模式
	const hasBridge = !!(props.api && props.plugin);
	// initialPath：嵌入模式默认 /update-info，非嵌入模式默认 /home
	const initialPath = hasBridge ? '/update-info' : '/home';

	// 返回根 JSX 结构
	return (
		// 最外层 div，标记 data-plugin-root 供 Host 识别插件根节点
		<div
			// data-plugin-root 属性，Host 可据此定位插件 DOM 根
			data-plugin-root
			// className 设置背景色、文字色与全屏布局
			className="bg-theme-background text-textcolor h-full min-h-0 w-full"
		>
			// I18nProvider 包裹，提供国际化上下文
			<I18nProvider>
				// BridgeSync 无渲染组件，同步语言与主题
				<BridgeSync api={props.api} />
				// NavigationProvider 包裹，提供内存路由上下文，initialPath 为初始路径
				<NavigationProvider initialPath={initialPath}>
					// AppRouter 根据 bridge 是否存在决定路由模式
					<AppRouter
						// bridge：嵌入模式传入完整 props，非嵌入模式传 undefined
						bridge={hasBridge ? (props as HostBridgeProps) : undefined}
					/>
				</NavigationProvider>
			</I18nProvider>
		</div>
	);
}

// 定义 HostApi 类型别名，取 HostBridgeProps 的 api 字段类型
type HostApi = HostBridgeProps['api'];

// App.activate：Host 激活插件时调用的生命周期钩子
App.activate = async (api: HostApi) => {
	// 打印激活日志，输出当前语言与主题
	console.log('[remoteDocs] activate', {
		// 输出当前语言
		locale: api.locale,
		// 输出当前主题
		theme: api.theme,
	});
};

// App.deactivate：Host 停用插件时调用的生命周期钩子
App.deactivate = () => {
	// 打印停用日志
	console.log('[remoteDocs] deactivate');
};

// 默认导出 App 组件
export default App;
```

#### 4.4.2 改动后（当前源码）

**来源** · `src/App.tsx`（当前源码，改动后，约 L1–L96）

```tsx
// 从 react 引入 useRef（持久化 ref 引用）与 RefObject 类型
import { useRef, type RefObject } from 'react';
// 从 NavigationContext 引入 NavigationProvider 与 browserPathname（读取地址栏 pathname 的工具函数）
import { NavigationProvider, browserPathname } from '@/router/NavigationContext';
// 引入 AppRouter（应用路由器）
import { AppRouter } from '@/router/AppRouter';
// 引入 I18nProvider（国际化提供者）
import { I18nProvider } from '@/i18n';
// 从 useHostBridgeSync 引入三个同步 Hooks
import {
	// useHostLocale：从 Bridge api 同步语言
	useHostLocale,
	// useHostTheme：从 Bridge api 同步主题，接收 pluginRootRef 用于主题切换时的 DOM 操作
	useHostTheme,
	// useStandaloneThemeFromSearch：独立模式时从 URL 查询参数 ?theme= 同步主题
	useStandaloneThemeFromSearch,
} from '@/hooks/useHostBridgeSync';
// 引入 HostBridgeProps 类型契约
import type { HostBridgeProps } from '@/types/host';
// 引入全局样式
import '@/styles.css';

// 定义 AppProps 类型：从 HostBridgeProps Pick 出 api 和 plugin，设为 Partial 全部可选
type AppProps = Partial<Pick<HostBridgeProps, 'api' | 'plugin'>>;

// DOC_PATHS：本 remote 支持的全部合法路由路径集合，用于校验 routePath 与地址栏 pathname
const DOC_PATHS = new Set([
	// 首页
	'/home',
	// 更新日志页
	'/update-info',
	// 项目指南页
	'/project-guide',
	// 插件开发指南页
	'/plugin-dev-guide',
]);

// BridgeSync 组件：无渲染，负责将 Bridge api 或 URL 参数同步到 remote 上下文
function BridgeSync({
	// api：Host 传入的运行时 API，独立模式时为 undefined
	api,
	// standalone：是否为独立模式
	standalone,
	// pluginRootRef：插件根 DOM 的 ref 引用，供主题 Hook 操作 DOM
	pluginRootRef,
}: {
	// api 类型声明：可选的 HostBridgeProps['api']
	api?: HostBridgeProps['api'];
	// standalone 类型声明：布尔值
	standalone: boolean;
	// pluginRootRef 类型声明：指向 HTMLElement 或 null 的 RefObject
	pluginRootRef: RefObject<HTMLElement | null>;
}) {
	// 调用 useHostLocale，将 api.locale 同步到 i18n 上下文
	useHostLocale(api);
	// 调用 useHostTheme，将 api.theme 同步到主题上下文，传入 pluginRootRef 供主题切换操作 DOM
	useHostTheme(api, pluginRootRef);
	// 调用 useStandaloneThemeFromSearch，独立模式时从 ?theme= 查询参数读取并同步主题
	useStandaloneThemeFromSearch(standalone, pluginRootRef);
	// 返回 null，此组件不产生 DOM
	return null;
}

/** 嵌入跟 routePath；独立站跟地址栏 pathname（外链打开用） */
// resolveInitialPath：根据模式与 props 解析初始路由路径
function resolveInitialPath(props: AppProps, standalone: boolean): string {
	// 非独立模式（嵌入 Host）分支
	if (!standalone) {
		// 从 props.plugin 取 routePath，可能为 undefined
		const routePath = props.plugin?.routePath;
		// 若 routePath 存在且在 DOC_PATHS 白名单中，直接返回该路径
		if (routePath && DOC_PATHS.has(routePath)) return routePath;
		// routePath 不存在或不在白名单中，回退到默认 /update-info
		return '/update-info';
	}
	// 独立模式：从浏览器地址栏读取 pathname
	const fromUrl = browserPathname();
	// 若 pathname 在白名单中返回该路径，否则回退到 /home
	return DOC_PATHS.has(fromUrl) ? fromUrl : '/home';
}

/**
 * 文档 Remote 壳：三页内存路由。
 * 嵌入 Host → routePath；独立预览 / 外链 → 地址栏 path。
 */
// App 根组件：接收可选的 api 与 plugin props，默认为空对象
function App(props: AppProps = {}) {
	// hasBridge：判断是否同时存在 api 和 plugin
	const hasBridge = !!(props.api && props.plugin);
	// standalone：无 Bridge 即为独立模式（外链打开）
	const standalone = !hasBridge;
	// initialPath：调用 resolveInitialPath 解析初始路由
	const initialPath = resolveInitialPath(props, standalone);
	// pluginRootRef：创建指向 div 的 ref，传给主题 Hook 供 DOM 操作
	const pluginRootRef = useRef<HTMLDivElement>(null);

	// 返回根 JSX 结构
	return (
		// 最外层 div，绑定 ref 与 data-plugin-root 标记
		<div
			// ref 绑定到 pluginRootRef，使主题 Hook 可操作此 DOM 节点
			ref={pluginRootRef}
			// data-plugin-root 属性，Host 据此定位插件 DOM 根
			data-plugin-root
			// className 设置背景色、文字色与全屏布局
			className="bg-theme-background text-textcolor h-full min-h-0 w-full"
		>
			// I18nProvider 包裹，提供国际化上下文
			<I18nProvider>
				// BridgeSync 无渲染组件，同步语言与主题，传入 api、standalone、pluginRootRef
				<BridgeSync
					// api：Host 传入的运行时 API，独立模式时为 undefined
					api={props.api}
					// standalone：是否为独立模式
					standalone={standalone}
					// pluginRootRef：插件根 DOM 的 ref
					pluginRootRef={pluginRootRef}
				/>
				// NavigationProvider 包裹，提供内存路由上下文
				<NavigationProvider
					// initialPath：初始路由路径
					initialPath={initialPath}
					// syncBrowserUrl：独立模式时同步浏览器地址栏 URL，嵌入模式不同步
					syncBrowserUrl={standalone}
				>
					// AppRouter 根据 bridge 是否存在决定路由模式
					<AppRouter
						// bridge：嵌入模式传入完整 props，非嵌入模式传 undefined
						bridge={hasBridge ? (props as HostBridgeProps) : undefined}
					/>
				</NavigationProvider>
			</I18nProvider>
		</div>
	);
}

// 定义 HostApi 类型别名，取 HostBridgeProps 的 api 字段类型
type HostApi = HostBridgeProps['api'];

// App.activate：Host 激活插件时调用的生命周期钩子
App.activate = async (api: HostApi) => {
	// 打印激活日志，输出当前语言与主题
	console.log('[remoteDocs] activate', {
		// 输出当前语言
		locale: api.locale,
		// 输出当前主题
		theme: api.theme,
	});
};

// App.deactivate：Host 停用插件时调用的生命周期钩子
App.deactivate = () => {
	// 打印停用日志
	console.log('[remoteDocs] deactivate');
};

// 默认导出 App 组件
export default App;
```

#### 4.4.3 改动前 / 改动后对比要点

| 维度 | 改动前 | 改动后 |
|---|---|---|
| `BridgeSync` 入参 | 仅 `api` | `api` + `standalone` + `pluginRootRef` |
| `useHostTheme` 调用 | `useHostTheme(api)` | `useHostTheme(api, pluginRootRef)` |
| 新增 Hook | — | `useStandaloneThemeFromSearch(standalone, pluginRootRef)` |
| 初始路由解析 | `hasBridge ? '/update-info' : '/home'` | `resolveInitialPath(props, standalone)`，校验 `routePath` 白名单 |
| 路由白名单 | 无 | `DOC_PATHS` Set，防止任意路径注入 |
| `standalone` 标志 | 无 | `standalone = !hasBridge` |
| `pluginRootRef` | 无 | `useRef<HTMLDivElement>(null)`，绑定到根 div |
| `NavigationProvider` | 仅传 `initialPath` | 额外传 `syncBrowserUrl={standalone}` |
| 根 div | 无 `ref` | 绑定 `ref={pluginRootRef}` |
| 新增导入 | — | `useRef` / `RefObject` / `browserPathname` / `useStandaloneThemeFromSearch` |

---

### 4.5 `package.json` — 发布与部署脚本

**来源** · `package.json`（当前源码 scripts 段，改动后）

```json
// scripts 字段：定义项目的可执行脚本命令
"scripts": {
	// dev：启动 Vite 本地开发服务器（vite serve）
	"dev": "vite",
	// build：执行生产构建（vite build）
	"build": "vite build",
	// preview：本地预览构建产物（vite preview）
	"preview": "vite preview",
	// publish：调用 dnhyxc-ci 工具发布 remoteDocs 远程模块到 Host 注册表（新增）
	"publish": "dnhyxc-ci publish remoteDocs",
	// deploy：先构建再发布，一步完成部署（新增）
	"deploy": "pnpm run build && pnpm run publish",
	// restart：重启 Host 服务端，使新发布的远程模块生效（新增）
	"restart": "npx dnhyxc-ci restart server -rsc 'pm2 restart server'"
}
```

**环境变量参考** · `.env`

```
# 远程模块对外公开的 origin，生产环境用域名 + 端口，vite.config.ts 中 base 据此生成绝对 URL
VITE_REMOTE_PUBLIC_ORIGIN=https://dnhyxc.cn:9017
```

**Host 注册表参考** · `apps/backend/uploads/remotes/plugins-registry.json`

三个条目共享同一 remote / expose / port，仅 `routePath` 不同：

| 字段 | 值 |
|---|---|
| remoteName | `remoteDocs` |
| expose | `./App` |
| port | `:9013` |
| injectRoute | `true` |
| menu | 无 |

---

## 5. 兼容性与影响

### 5.1 向后兼容

- **嵌入 Host 模式完全兼容**：`standalone = !hasBridge`，当 Host 正常传入 `api` + `plugin` 时 `standalone` 为 `false`，行为与改动前一致。
- **`routePath` 白名单回退**：Host 传入的 `routePath` 若不在 `DOC_PATHS` 中，回退到 `/update-info`，不会因未知路径导致白屏。
- **`pluginRootRef` 向下游透**：`useHostTheme` 和 `useStandaloneThemeFromSearch` 收到 ref 后可用于主题切换时的 DOM 操作，不影响无 ref 的旧调用路径。

### 5.2 新增能力

- **外链独立预览**：无 Bridge props 时自动进入 standalone 模式，通过 `?lang=&theme=` 查询参数控制语言与主题。
- **浏览器 URL 同步**：standalone 模式下 `syncBrowserUrl={true}`，路由变化同步到地址栏，支持前进 / 后退 / 分享。
- **路径白名单校验**：`DOC_PATHS` 防止 routePath 或 pathname 注入未知路由。

### 5.3 影响面

| 模块 | 影响 |
|---|---|
| Host 加载逻辑 | 无需改动，`plugins-registry.json` 三个条目配置不变 |
| `useHostBridgeSync` Hook | 需新增 `useStandaloneThemeFromSearch` 并让 `useHostTheme` 接收 `pluginRootRef` 参数 |
| `NavigationContext` | 需导出 `browserPathname` 函数，并支持 `syncBrowserUrl` 选项 |
| 样式引入 | 无变化，`index.ts` 已在 expose 入口引入 `styles.css` |
| 构建部署 | 新增 `publish` / `deploy` / `restart` 脚本，发布流程从手动变为半自动 |

---

## 6. 相关源码路径

| 文件 | 绝对路径 | 说明 |
|---|---|---|
| Vite 配置 | `/Users/dnhyxc/Documents/code/micro-apps/remote-docs/vite.config.ts` | MF 构建配置 |
| MF 入口 | `/Users/dnhyxc/Documents/code/micro-apps/remote-docs/src/index.ts` | expose 入口，引入样式 |
| 类型契约 | `/Users/dnhyxc/Documents/code/micro-apps/remote-docs/src/types/host.ts` | HostBridgeProps 定义 |
| 根组件 | `/Users/dnhyxc/Documents/code/micro-apps/remote-docs/src/App.tsx` | 改动核心：standalone / routePath / pluginRootRef |
| 包配置 | `/Users/dnhyxc/Documents/code/micro-apps/remote-docs/package.json` | 新增 publish / deploy / restart 脚本 |
| 环境变量 | `/Users/dnhyxc/Documents/code/micro-apps/remote-docs/.env` | VITE_REMOTE_PUBLIC_ORIGIN |
| Host 同步 Hook | `/Users/dnhyxc/Documents/code/micro-apps/remote-docs/src/hooks/useHostBridgeSync.ts` | useHostTheme / useStandaloneThemeFromSearch |
| 导航上下文 | `/Users/dnhyxc/Documents/code/micro-apps/remote-docs/src/router/NavigationContext.tsx` | NavigationProvider / browserPathname |
| 路由器 | `/Users/dnhyxc/Documents/code/micro-apps/remote-docs/src/router/AppRouter.tsx` | AppRouter |
| 国际化 | `/Users/dnhyxc/Documents/code/micro-apps/remote-docs/src/i18n/index.ts` | I18nProvider |

---

（若与仓库最新源码不一致，以源码为准）
