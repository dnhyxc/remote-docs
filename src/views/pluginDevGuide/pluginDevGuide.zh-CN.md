阅读对象：为本平台开发 React / Vue Module Federation 子应用（插件），以及 untrusted iframe 隔离子应用的前端开发者。

目标：从零搭好工程、正确导出 expose、配置 Registry，并在 Host 内获得与独立预览一致的样式（含 Tooltip / Dialog / Teleport）；多页插件须 expose 路由壳并正确挂载 activate；不进侧栏、嵌在英语学习已有页面里的插件见第 14 章（三种挂法、从文件到启用的步骤、`modules:point`）；第三方不可信场景走 iframe + postMessage，并正确接入主题/强调色外观快照。

参考实现（仓外 micro-apps）：
- React 多页：remote-react-shadcn（端口 9010，内存 NavigationProvider）
- Vue 多页：remote-vue-shadcn（端口 9009，vue-router：预览 WebHistory / 嵌入 MemoryHistory）
- iframe untrusted：仓外 micro-apps/remote-untrusted（端口 9012；见本文第 10 章）
- 契约文档：packages/federation-kit/docs/plugin-guide（尤其 自动路由接入、Vue插件开发、iframe隔离接入）
- Host 适配层：apps/frontend/src/federation（再导出 @dnhyxc-ai/federation-kit；外观能力见 capabilities/iframeAppearance.ts）

更新日期：2026-11-17

## 目录

- [1. 架构与加载模型](#1-架构与加载模型)
  - [1.1 角色分工](#11-角色分工)
  - [1.2 信任等级与嵌入方式](#12-信任等级与嵌入方式)
  - [1.3 加载流程（MF）](#13-加载流程mf)
  - [1.4 推荐目录结构](#14-推荐目录结构)
- [2. 环境与项目初始化](#2-环境与项目初始化)
  - [2.1 工具版本](#21-工具版本)
  - [2.2 环境变量 .env](#22-环境变量-env)
  - [2.3 初始化 React 子应用依赖](#23-初始化-react-子应用依赖)
  - [2.4 初始化 Vue 子应用依赖](#24-初始化-vue-子应用依赖)
- [3. React：Vite + Module Federation](#3-reactvite-module-federation)
  - [3.1 完整 vite.config.ts（React）](#31-完整-viteconfigtsreact)
  - [3.2 React Vite 检查表](#32-react-vite-检查表)
- [4. Vue：Vite + Module Federation](#4-vuevite-module-federation)
  - [4.1 完整 vite.config.ts（Vue）](#41-完整-viteconfigtsvue)
  - [4.2 Vue Remote 硬性约定](#42-vue-remote-硬性约定)
- [5. React 插件实现](#5-react-插件实现)
  - [5.1 HostBridgeProps（复制到子项目）](#51-hostbridgeprops复制到子项目)
  - [5.2 expose 入口（必须 import styles）](#52-expose-入口必须-import-styles)
  - [5.3 单页根组件 + 生命周期静态属性](#53-单页根组件-生命周期静态属性)
  - [5.4 独立预览 main.tsx](#54-独立预览-maintsx)
  - [5.5 多页铁律（参考 remote-react-shadcn）](#55-多页铁律参考-remote-react-shadcn)
  - [5.6 内存路由 NavigationContext](#56-内存路由-navigationcontext)
  - [5.7 多页壳 App.tsx](#57-多页壳-apptsx)
  - [5.8 AppRouter 按 path 渲染](#58-approuter-按-path-渲染)
  - [5.9 子页跳转示例](#59-子页跳转示例)
  - [5.10 调用 Host API（权限安全）](#510-调用-host-api权限安全)
  - [5.10.1 画出插件中心设置的图标](#5101-画出插件中心设置的图标)
  - [5.11 生命周期写法对照](#511-生命周期写法对照)
- [6. Vue 插件实现](#6-vue-插件实现)
  - [6.1 Host 如何挂载 Vue](#61-host-如何挂载-vue)
  - [6.2 类型（与 React 同一套 HostBridgeProps）](#62-类型与-react-同一套-hostbridgeprops)
  - [6.3 多页铁律（参考 remote-vue-shadcn）](#63-多页铁律参考-remote-vue-shadcn)
  - [6.4 vue-router：WebHistory / MemoryHistory](#64-vue-routerwebhistory-memoryhistory)
  - [6.5 useHostBridge（provide / inject）](#65-usehostbridgeprovide-inject)
  - [6.6 根组件 App.vue](#66-根组件-appvue)
  - [6.7 expose 入口 mount + 生命周期](#67-expose-入口-mount-生命周期)
  - [6.8 子页 router.push](#68-子页-routerpush)
  - [6.9 独立预览 main.ts](#69-独立预览-maints)
  - [6.10 Vue 常见错误](#610-vue-常见错误)
- [7. 样式、隔离与悬浮层](#7-样式隔离与悬浮层)
  - [7.1 Host 隔离模型（插件零侵入）](#71-host-隔离模型插件零侵入)
  - [7.2 【关键】每个 expose 必须 import styles.css](#72-关键每个-expose-必须-import-stylescss)
  - [7.3 styles.css 示例](#73-stylescss-示例)
  - [7.4 悬浮层验收清单](#74-悬浮层验收清单)
- [8. 插件内 i18n 与 Host locale](#8-插件内-i18n-与-host-locale)
  - [8.1 规则](#81-规则)
  - [8.2 useHostLocale（React）](#82-usehostlocalereact)
- [9. 权限与 Registry 字段](#9-权限与-registry-字段)
  - [9.1 权限列表](#91-权限列表)
  - [9.2 React 插件 Registry 示例](#92-react-插件-registry-示例)
  - [9.3 Vue 插件 Registry（必须 framework）](#93-vue-插件-registry必须-framework)
  - [9.4 字段速查](#94-字段速查)
  - [9.5 untrusted（iframe）示例](#95-untrustediframe示例)
- [10. iframe 隔离子应用（untrusted）](#10-iframe-隔离子应用untrusted)
  - [10.1 何时必须用 iframe](#101-何时必须用-iframe)
  - [10.2 整体架构](#102-整体架构)
  - [10.3 Host 如何挂 iframe（理解生命周期）](#103-host-如何挂-iframe理解生命周期)
  - [10.4 通信协议（6 种消息）](#104-通信协议6-种消息)
  - [10.5 HostIframeAppearance：为什么是快照而不是 theme 字符串](#105-hostiframeappearance为什么是快照而不是-theme-字符串)
  - [10.6 applyHostAppearance](#106-applyhostappearance)
  - [10.7 iframeHostClient](#107-iframehostclient)
  - [10.8 App 单入口双模式](#108-app-单入口双模式)
  - [10.9 入口与 iframeUrl（无需单独 /embed 路由）](#109-入口与-iframeurl无需单独-embed-路由)
  - [10.10 Registry（untrusted，对齐 remote-untrusted）](#1010-registryuntrusted对齐-remote-untrusted)
  - [10.11 常见坑](#1011-常见坑)
  - [10.12 iframe 验收清单](#1012-iframe-验收清单)
- [11. 预览、部署与调试](#11-预览部署与调试)
  - [11.1 本地联调顺序](#111-本地联调顺序)
  - [11.2 构建与静态托管](#112-构建与静态托管)
  - [11.3 调试要点](#113-调试要点)
- [12. 验收清单](#12-验收清单)
  - [12.1 上线前核对](#121-上线前核对)
- [13. 常见问题](#13-常见问题)
  - [13.1 独立预览正常，嵌进 Host 后 Tooltip / 菜单没样式？](#131-独立预览正常嵌进-host-后-tooltip-菜单没样式)
  - [13.2 Vue 插件白屏 / 被当成 React？](#132-vue-插件白屏-被当成-react)
  - [13.3 样式污染了 Host？](#133-样式污染了-host)
  - [13.4 仅嵌入后毛玻璃失效？](#134-仅嵌入后毛玻璃失效)
  - [13.5 发版后 Host 仍旧包？](#135-发版后-host-仍旧包)
  - [13.6 React：info 点详情没反应？](#136-reactinfo-点详情没反应)
  - [13.7 Vue：嵌 Host 跳详情跳出主站 / 404？](#137-vue嵌-host-跳详情跳出主站-404)
  - [13.8 activate 没执行 / 控制台 warn？](#138-activate-没执行-控制台-warn)
  - [13.9 iframe 内强调色 / 暗色边框不跟随主站？](#139-iframe-内强调色-暗色边框不跟随主站)
  - [13.10 iframe 一直 connecting / 握手超时？](#1310-iframe-一直-connecting-握手超时)
- [14. 开发一个页面内嵌插件](#14-开发一个页面内嵌插件)
  - [14.1 先选挂法](#141-先选挂法)
  - [14.2 能挂在哪](#142-能挂在哪)
  - [14.3 要改哪些文件](#143-要改哪些文件)
  - [14.4 顶栏插件怎么写](#144-顶栏插件怎么写)
  - [14.5 按钮抽屉插件怎么写](#145-按钮抽屉插件怎么写)
  - [14.6 页面抽屉插件怎么写](#146-页面抽屉插件怎么写)
  - [14.7 命令](#147-命令)
  - [14.8 样式、请求和预览](#148-样式请求和预览)
  - [14.9 挂上去之后看不到](#149-挂上去之后看不到)
  - [14.10 什么时候改主项目](#1410-什么时候改主项目)
  - [14.11 验收](#1411-验收)

## 1. 架构与加载模型

### 1.1 角色分工

- Host（apps/frontend + @dnhyxc-ai/federation-kit）：拉 Registry、registerRemotes、loadRemote、注入路由/侧栏、挂载 PluginHostPage、运行时 CSS @scope 隔离、Portal/Teleport 收编。
- Remote（子应用）：Vite + @module-federation/vite 暴露模块；业务只关心 default 导出与权限内的 HostBridge API。
- Registry（plugins-registry.json）：声明 id / entry / expose / remoteName / framework / permissions / trust 等；改标题文案只改 registry，不必改 Host 语言包。

### 1.2 信任等级与嵌入方式

- first-party / partner：Module Federation 嵌入；Host 用 @scope([data-mf-style-realm]) 隔离 CSS；Portal（React createPortal）与 Vue Teleport（body 挂载）由 Host 收编到 [data-mf-portal-scope]。
- untrusted：iframe + postMessage（sandbox）；样式天然隔离；须配置 iframeUrl（开发可用 localhost http，生产须 https）。Host 会下发 init（含 appearance 外观快照）与热更新 appearance / locale；RPC 走 http / ui.*（见第 10 章）。
权限由 Host 按 registry.permissions 注入：未声明的能力在 bridge 上为 undefined，调用前必须可选链/判空。

### 1.3 加载流程（MF）

1. Host PluginManager.init() 拉取 Registry（可有本地启用覆盖）。
2. `injectRoute !== false` 时注入顶层路由。侧栏是另一条：只有写了 `menu` 才会加侧栏入口，和 `injectRoute` 无关。只嵌业务页的插件两项都不要（`injectRoute: false`，并且不要 `menu`）。见第 14 章。
3. 进入插件路由 → ensurePlugin → GET 一次 mf-manifest.json 算 bust（version@manifestHash）→ 加载 remoteEntry.js?v=…。
4. loadRemote(expose) → normalizePluginModule（pickPluginLifecycle：named export 或 default.activate）：
   - React：default 即组件（多页时须为带 NavigationProvider 的壳）；
   - Vue：framework === "vue" → createVueHostBridge 调 Remote.mount(el, bridge)。
5. 缺 activate/deactivate 时 console.warn（不阻断）；有则先 await activate(api)。
6. PluginHostPage 渲染 data-mf-plugin + data-mf-style-realm，并 attachPluginStyleIsolation。
7. 卸载：deactivate + 释放隔离。

### 1.4 推荐目录结构

一仓可多 expose（如 apps/micro）。每个 expose 对应 views 下独立入口。

```markdown
my-plugin/
├── src/
│   ├── main.tsx / main.ts     # 仅独立预览
│   ├── index.ts               # MF expose：styles + default App（+ activate 再导出）
│   ├── App.tsx / App.vue      # MF 壳（Provider/RouterView + activate）；untrusted 则为单入口双模式（嵌入握手 / 独立预览）
│   ├── styles.css
│   ├── types/host.ts
│   ├── utils/                 # untrusted 常用
│   │   ├── iframeHostClient.ts
│   │   └── applyHostAppearance.ts
│   ├── router/                # React: NavigationContext；Vue: vue-router
│   ├── views/home|info|detail # 叶子页（勿作为 expose default）
│   ├── composables/           # Vue: useHostBridge
│   ├── hooks/ / i18n/
│   └── components/ui/
├── vite.config.ts
└── package.json
```

## 2. 环境与项目初始化

### 2.1 工具版本

- Node.js ≥ 20
- pnpm ≥ 8
- Host 开发服默认 9002；Remote 示例 9009（Vue）/ 9010（React 多页）——勿与 Host 冲突。
- MF 插件用 @module-federation/vite（不是旧的 @originjs/vite-plugin-federation）。

### 2.2 环境变量 .env

VITE_REMOTE_PUBLIC_ORIGIN 必须与 registry 的 entry 同源（含协议/主机/端口），并与 vite base 一致。

```dotenv
# 与 Host registry entry 同源
# React 多页样例 remote-react-shadcn 常用 9010；Vue 多页样例 remote-vue-shadcn 常用 9009
VITE_REMOTE_PUBLIC_ORIGIN=http://127.0.0.1:9010

# React 插件：指向 Host 开发服，供 React Refresh
VITE_REACT_REFRESH_HOST=http://127.0.0.1:9002
```

### 2.3 初始化 React 子应用依赖

与 Host 共用 React 大版本（当前示例 ^19）。shared 仅 singleton react / react-dom。

```bash
mkdir my-react-plugin && cd my-react-plugin
pnpm init

pnpm add react react-dom
pnpm add -D vite @vitejs/plugin-react @module-federation/vite \
  typescript @types/node @types/react @types/react-dom \
  tailwindcss @tailwindcss/vite
```

### 2.4 初始化 Vue 子应用依赖

Host 不装 Vue：Remote 自带 vue，expose 导出 mount(el, bridge)（或 { mount }）。勿自建 React 桥；vue 不必与 Host shared。

```bash
mkdir my-vue-plugin && cd my-vue-plugin
pnpm init

pnpm add vue vue-router
pnpm add -D vite @vitejs/plugin-vue @module-federation/vite \
  typescript @types/node vue-tsc \
  tailwindcss @tailwindcss/vite

# UI（可选，与样例 remote-vue-shadcn 对齐）
pnpm add reka-ui class-variance-authority clsx tailwind-merge @vueuse/core @lucide/vue
```

## 3. React：Vite + Module Federation

### 3.1 完整 vite.config.ts（React）

必选核对：base；federation.name / filename / manifest / exposes；shared.react|react-dom.singleton；hostInitInjectLocation: "entry"；optimizeDeps.exclude React；server.cors + ACAO；build.modulePreload: false。
勿 shared react-router。

```typescript
import fs from 'node:fs';
import path from 'node:path';
import { federation } from '@module-federation/vite';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig, loadEnv, type Plugin } from 'vite';

/** MF mf_owner id 递增后 .vite/deps 会失效，serve 时清缓存 */
function clearMfViteDepCache(): Plugin {
  return {
    name: 'clear-mf-vite-dep-cache',
    enforce: 'pre',
    config(config, { command }) {
      if (command !== 'serve') return;
      const root = config.root ? path.resolve(config.root) : process.cwd();
      fs.rmSync(path.join(root, 'node_modules/.vite'), {
        recursive: true,
        force: true,
      });
    },
  };
}

const host = '127.0.0.1';
const port = 9008;
const devOrigin = 'http://' + host + ':' + port;

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const origin = env.VITE_REMOTE_PUBLIC_ORIGIN || devOrigin;
  const reactRefreshHost =
    env.VITE_REACT_REFRESH_HOST || 'http://127.0.0.1:9002';

  return {
    // 必须与 Host registry entry 同源
    base: origin + '/',
    plugins: [
      clearMfViteDepCache(),
      react({ reactRefreshHost }),
      tailwindcss(),
      federation({
        name: 'myReactPlugin', // 与 registry.remoteName 一致
        filename: 'remoteEntry.js',
        manifest: true,
        exposes: {
          // 每个 expose 入口内必须 import '@/styles.css'
          './App': './src/views/app/index.tsx',
        },
        shared: {
          // 勿 shared react-router；仅 react / react-dom
          react: { singleton: true, requiredVersion: '^19.1.0' },
          'react-dom': { singleton: true, requiredVersion: '^19.1.0' },
        },
        hostInitInjectLocation: 'entry',
        dts: false,
        dev: { remoteHmr: true },
      }),
    ],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, 'src'),
        '@ui': path.resolve(__dirname, 'src/components/ui'),
      },
    },
    optimizeDeps: {
      include: [], // 重依赖（如 @tiptap/*）建议 include，避免 HMR 整页 reload
      exclude: [
        'react',
        'react/jsx-runtime',
        'react/jsx-dev-runtime',
        'react-dom',
        'react-dom/client',
      ],
    },
    server: {
      host,
      port,
      strictPort: true,
      origin: devOrigin,
      cors: true,
      headers: { 'Access-Control-Allow-Origin': '*' },
    },
    preview: { host, port, strictPort: true, cors: true },
    build: { target: 'esnext', modulePreload: false, minify: false },
  };
});
```

### 3.2 React Vite 检查表

- base 与 registry entry 同源
- name ↔ remoteName；expose 路径 ↔ registry.expose
- 每个 exposes 指向的文件内 import styles.css
- 开发：先起 Remote，再在 Host 打开插件路由
- Invalid hook call → 双 React：查 singleton / 清 node_modules/.vite / 勿在插件内再 createRoot

## 4. Vue：Vite + Module Federation

### 4.1 完整 vite.config.ts（Vue）

与 React 差异：plugin-vue；shared 只配 vue；optimizeDeps.exclude vue；无 reactRefreshHost。expose 指向含 mount 的 index.ts（参考 remote-vue-shadcn）。

```typescript
import fs from 'node:fs';
import path from 'node:path';
import { federation } from '@module-federation/vite';
import tailwindcss from '@tailwindcss/vite';
import vue from '@vitejs/plugin-vue';
import { defineConfig, loadEnv, type Plugin } from 'vite';

function clearMfViteDepCache(): Plugin {
  return {
    name: 'clear-mf-vite-dep-cache',
    enforce: 'pre',
    config(config, { command }) {
      if (command !== 'serve') return;
      const root = config.root ? path.resolve(config.root) : process.cwd();
      fs.rmSync(path.join(root, 'node_modules/.vite'), {
        recursive: true,
        force: true,
      });
    },
  };
}

const host = '127.0.0.1';
const port = 9009;
const devOrigin = 'http://' + host + ':' + port;

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const origin = env.VITE_REMOTE_PUBLIC_ORIGIN || devOrigin;

  return {
    base: origin + '/',
    plugins: [
      clearMfViteDepCache(),
      vue(),
      tailwindcss(),
      federation({
        name: 'microVue', // registry.remoteName
        filename: 'remoteEntry.js',
        manifest: true,
        exposes: {
          './StyleIsolationLab': './src/views/info/index.ts',
        },
        shared: {
          // Vue 只 shared vue；勿在 Remote 自建 React 桥
          vue: { singleton: true, requiredVersion: '^3.5.0' },
        },
        hostInitInjectLocation: 'entry',
        dts: false,
        // 与 Host remoteHmr 配合；Vue 无 reactRefreshHost，靠 shared vue + Host HMR guard
        dev: { remoteHmr: true },
      }),
    ],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, 'src'),
        '@ui': path.resolve(__dirname, 'src/components/ui'),
      },
      dedupe: ['vue'],
    },
    // 禁止预打包 vue，否则与 Host registerShared(vue) 拆成双实例，嵌入后 HMR 失效
    optimizeDeps: { exclude: ['vue'] },
    server: {
      host,
      port,
      strictPort: true,
      origin: devOrigin,
      cors: true,
      headers: { 'Access-Control-Allow-Origin': '*' },
    },
    preview: { host, port, strictPort: true, cors: true },
    build: { target: 'esnext', modulePreload: false, minify: false },
  };
});
```

### 4.2 Vue Remote 硬性约定

1. Registry 必须写 "framework": "vue"（Host normalizePluginModule 优先读该字段）。
2. expose default 须为 mount(el, bridge) 或 { mount }（Host 不 createApp）；不必再 export framework。
3. 禁止在 Remote 内自建 React 桥；Vue 的 createApp 只写在 Remote mount 里。
4. 根组件接收 props.bridge（reactive HostBridgeProps），不是顶层展开的 api/plugin。
5. Teleport→body 的弹层：不要手写 container；Host body 原型 patch 会收编进同 realm 的 portal-scope。
6. 同样：每个 expose 入口 import "@/styles.css"。

## 5. React 插件实现

### 5.1 HostBridgeProps（复制到子项目）

Host 不提供 api.t。插件自维护 i18n，只跟随 api.locale。权限不足时 http / ui / navigate 可能为 undefined。

```typescript
/** 与 @dnhyxc-ai/federation-kit HostBridgeProps 对齐的最小子集（无 api.t） */
export type HostLocale = 'zh-CN' | 'en-US';

export type HostBridgeProps = {
  api: {
    theme: 'light' | 'dark';
    locale: HostLocale;
    navigate?: (to: string) => void;
    event: {
      on: (event: string, handler: (data?: unknown) => void) => void;
      off: (event: string, handler: (data?: unknown) => void) => void;
      emit: (event: string, data?: unknown) => void;
    };
    http?: {
      get: <T = unknown>(url: string) => Promise<T>;
      post: <T = unknown>(url: string, body?: unknown) => Promise<T>;
      put: <T = unknown>(url: string, body?: unknown) => Promise<T>;
      delete: <T = unknown>(url: string) => Promise<T>;
    };
    ui?: {
      showToast: (options: {
        message: string;
        type?: 'success' | 'error' | 'info' | 'warning';
        title?: string;
      }) => void;
      /** 应用级影院全屏（藏侧栏/顶栏）；需 ui:toast */
      setAppFullscreen?: (full: boolean) => Promise<void>;
      downloadBlob?: (options: {
        fileName: string;
        data: ArrayBuffer | Uint8Array;
        mimeType?: string;
      }) => Promise<{ ok: boolean; hostToasted: boolean; message?: string }>;
      /** 让用户选本地文件（跨端）；需 ui:toast */
      pickLocalFiles?: (options?: {
        accept?: string;
        multiple?: boolean;
      }) => Promise<{ path: string; name: string; src: string }[] | null>;
      /** 插件中心图标地址 → 已上色的整段 svg。需 ui:toast */
      readIconSvg?: (url: string) => Promise<string | null>;
    };
    modules?: Readonly<Record<string, (...args: unknown[]) => unknown>>;
  };
  plugin: { id: string; version: string; routePath: string };
};
```

### 5.2 expose 入口（必须 import styles）

Host 只 loadRemote(expose)，不会执行 main.tsx。多页插件：default 必须是壳 App，不要导出叶子 InfoPage。漏 styles → 独立预览正常、嵌入后 Tooltip「裸奔」。

```tsx
// src/index.ts —— MF expose 入口（Host 只加载这里，不跑 main.tsx）
// ★ default 必须是带 NavigationProvider 的壳 App，不要再导出叶子页 InfoPage
import '@/styles.css';
import App from './App';

export default App;
// 兼容只读 named export 的 Host；入口无 JSX，不影响 App.tsx Fast Refresh
export const activate = App.activate;
export const deactivate = App.deactivate;
```

### 5.3 单页根组件 + 生命周期静态属性

default 导出组件；根节点 data-plugin-root。activate/deactivate 挂在 App 上（勿 export function activate，会破坏 Fast Refresh）。缺钩子时 Host 会 warn。

```tsx
// src/App.tsx —— 单页插件最小形态
import type { HostBridgeProps } from '@/types/host';

function App({ api, plugin }: HostBridgeProps) {
  return (
    <div className="plugin-standalone h-full" data-plugin-root>
      <h1>
        {plugin.id} v{plugin.version}
      </h1>
      <p>
        theme={api.theme} · locale={api.locale}
      </p>
      <button
        type="button"
        onClick={() =>
          api.ui?.showToast({ message: 'Hello from React plugin', type: 'success' })
        }
      >
        Toast
      </button>
    </div>
  );
}

// 钩子挂在 expose 的 default 上（勿同文件 export function activate —— 会破坏 Fast Refresh）
App.activate = async (api: HostBridgeProps['api']) => {
  console.log('[plugin] activate', api.locale);
};
App.deactivate = () => {
  console.log('[plugin] deactivate');
};

export default App;
```

### 5.4 独立预览 main.tsx

渲染同一套壳 App。嵌入 Host 时此文件完全不跑。

```tsx
// src/main.tsx —— 仅独立预览；Host 嵌入时不会执行
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './styles.css';
import App from './App';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
```

### 5.5 多页铁律（参考 remote-react-shadcn）

Host 只注入一条 routePath。列表→详情由子应用内部解决。
- expose default = 带 NavigationProvider 的壳 App
- 叶子页用 useNavigation().navigate("/detail")
- 若 expose 叶子页：Context 默认 navigate 为空函数 → 点击无反应
- activate 必须挂在壳 App，挂 InfoPage 无效
详见 packages/federation-kit/docs/plugin-guide/自动路由接入.md §5

### 5.6 内存路由 NavigationContext

不改浏览器 URL（始终停在 Host routePath）。适合多数插件内切页。

```tsx
// src/router/NavigationContext.tsx —— 内存路由（不改 Host URL）
import {
  createContext,
  useContext,
  useState,
  useCallback,
  type ReactNode,
} from 'react';

type NavigationContextValue = {
  path: string;
  navigate: (to: string) => void;
};

// 默认 navigate 为空函数：忘记包 Provider 时点击「没反应」，便于发现 expose 接错
const NavigationContext = createContext<NavigationContextValue>({
  path: '/home',
  navigate: () => {},
});

export function NavigationProvider({
  children,
  initialPath = '/home',
}: {
  children: ReactNode;
  initialPath?: string;
}) {
  const [path, setPath] = useState(initialPath);
  const navigate = useCallback((to: string) => setPath(to), []);
  return (
    <NavigationContext.Provider value={{ path, navigate }}>
      {children}
    </NavigationContext.Provider>
  );
}

export function useNavigation() {
  return useContext(NavigationContext);
}
```

### 5.7 多页壳 App.tsx

包 Provider + AppRouter；生命周期挂在此函数上。

```tsx
// src/App.tsx —— 多页壳（参考 remote-react-shadcn）
import { NavigationProvider } from '@/router/NavigationContext';
import { AppRouter } from '@/router/AppRouter';
import type { HostBridgeProps } from '@/types/host';

type AppProps = Partial<Pick<HostBridgeProps, 'api' | 'plugin'>>;

function App(props: AppProps = {}) {
  const hasBridge = !!(props.api && props.plugin);
  // 嵌入 Host 默认进业务页；独立预览进首页
  const initialPath = hasBridge ? '/info' : '/home';

  return (
    <NavigationProvider initialPath={initialPath}>
      <AppRouter bridge={hasBridge ? (props as HostBridgeProps) : undefined} />
    </NavigationProvider>
  );
}

// ★ 生命周期必须挂在壳 App 上；挂 InfoPage 无效（Host 只读 expose default）
App.activate = async (api: HostBridgeProps['api']) => {
  console.log('[remote-react-shadcn] activate', api.locale);
};
App.deactivate = () => {
  console.log('[remote-react-shadcn] deactivate');
};

export default App;
```

### 5.8 AppRouter 按 path 渲染

按内部 path switch 子页；需要 Host API 的页面把 bridge 往下传。

```tsx
// src/router/AppRouter.tsx
import { useNavigation } from './NavigationContext';
import HomePage from '@/views/home/HomePage';
import InfoPage from '@/views/info';
import DetailPage from '@/views/detail/DetailPage';
import type { HostBridgeProps } from '@/types/host';

export function AppRouter({ bridge }: { bridge?: HostBridgeProps }) {
  const { path } = useNavigation();
  switch (path) {
    case '/info':
      return <InfoPage bridge={bridge} />;
    case '/detail':
      return <DetailPage />;
    case '/home':
    default:
      return <HomePage />;
  }
}
```

### 5.9 子页跳转示例

只用内部 navigate；不要在叶子页挂 activate。

```tsx
// 子页跳转：只用内部 useNavigation，不要 expose 叶子页
import { useNavigation } from '@/router/NavigationContext';

function InfoPage({ bridge }: { bridge?: HostBridgeProps }) {
  const { navigate } = useNavigation();
  return (
    <div data-plugin-root>
      <button type="button" onClick={() => navigate('/detail')}>
        查看详情
      </button>
    </div>
  );
}
export default InfoPage;
```

### 5.10 调用 Host API（权限安全）

常用：api.ui.showToast / setAppFullscreen / downloadBlob / pickLocalFiles / readIconSvg（需 ui:toast）；api.navigate（nav:subtree，路径须带 routePath 前缀）；api.http.*；api.modules.*。readIconSvg 的用法见 §5.10.1。

```tsx
export default function App({ api, plugin }: HostBridgeProps) {
  const onFetch = async () => {
    // ✅ 受限 API 使用前检查存在性（无权限时 Host 不注入该字段）
    if (!api.http) return;
    const data = await api.http.get('/api/plugin-data');
    console.log(data);
  };

  const onNav = () => {
    api.navigate?.(plugin.routePath + '/detail');
  };

  const onToast = () => {
    api.ui?.showToast({ message: 'ok', type: 'success' });
  };

  const onFullscreen = async () => {
    // 需 ui:toast；进出影院态成对调用，卸载时记得退出
    await api.ui?.setAppFullscreen?.(true);
  };

  return null;
}
```

### 5.10.1 画出插件中心设置的图标

侧栏和 HostPoint 的图标由主项目画。插件页面要显示某个插件在插件中心上传的 SVG 时，自己读缓存，再请宿主上色。

1. permissions 加上 ui:toast。否则没有 api.ui。
2. 读 localStorage。键是 `dnhyxc.plugin.registry.${import.meta.env.PROD ? 'prod' : 'dev'}.v1`。
3. 找到目标插件，取 `(menu?.icon ?? host?.icon)?.trim()`。
4. `const markup = await api.ui.readIconSvg(url)`。markup 是整段 `<svg>…</svg>`，失败是 null。
5. 放进 dangerouslySetInnerHTML。外层 `inline-flex size-4 text-current`，颜色跟按钮文字。
6. 没有地址、没有 read、返回 null、或抛错：画 Puzzle。请求中留一个 size-4 空位。

不要在插件里 fetch 这个地址，也不要安装 @tauri-apps/plugin-http。桌面生产环境的 COS 是跨域绝对地址，CSS mask 会得到空方块，img 里的 currentColor 会变成黑色。宿主的 loadPluginIconMarkup 已经做了地址改写、Tauri HTTP 和上色。iframe 的 RPC 没有 ui.readIconSvg。

```tsx
import { Puzzle } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';

type RegistryPlugin = {
  id: string;
  menu?: { icon?: string };
  host?: { icon?: string };
};

function registryIcon(id: string): string | undefined {
  try {
    const key = `dnhyxc.plugin.registry.${import.meta.env.PROD ? 'prod' : 'dev'}.v1`;
    const raw = localStorage.getItem(key);
    if (!raw) return;
    const plugins = (JSON.parse(raw) as { plugins?: RegistryPlugin[] }).plugins;
    const plugin = plugins?.find((item) => item.id === id);
    return (plugin?.menu?.icon ?? plugin?.host?.icon)?.trim() || undefined;
  } catch {
    return;
  }
}

function RegistryIcon({
  id,
  read,
}: {
  id: string;
  read?: (url: string) => Promise<string | null>;
}) {
  const url = registryIcon(id);
  const [svg, setSvg] = useState<string | null>(null);
  const [miss, setMiss] = useState(false);
  useEffect(() => {
    if (!url || !read) {
      setSvg(null);
      setMiss(!url || !read);
      return;
    }
    let cancel = false;
    setMiss(false);
    void read(url)
      .then((markup) => {
        if (cancel) return;
        setSvg(markup);
        setMiss(!markup);
      })
      .catch(() => {
        if (!cancel) setMiss(true);
      });
    return () => {
      cancel = true;
    };
  }, [url, read]);
  const markup = useMemo(() => (svg ? { __html: svg } : null), [svg]);
  if (!url || miss) return <Puzzle className="size-4" aria-hidden />;
  if (!markup) return <span className="inline-block size-4" aria-hidden />;
  return (
    <span
      aria-hidden
      className="inline-flex size-4 text-current"
      dangerouslySetInnerHTML={markup}
    />
  );
}

<RegistryIcon id="vocabDetailList" read={api.ui?.readIconSvg} />
```

独立预览没有 readIconSvg，按钮显示 Puzzle。嵌进宿主并保存过图标后，刷新即可看到 SVG。

### 5.11 生命周期写法对照

推荐静态属性；入口可 named 再导出。禁止同文件 export function activate。

```typescript
// 推荐：挂在 default 组件静态属性上（与组件同文件且保 Fast Refresh）
function App(props: HostBridgeProps) {
  return <div data-plugin-root>...</div>;
}
App.activate = async (api: HostBridgeProps['api']) => {
  api.event.on('book-changed', (data) => console.log(data));
};
App.deactivate = () => {
  /* 清理订阅 / 定时器 */
};
export default App;

// expose 入口再导出 named（兼容旧 Host）：
// export const activate = App.activate;
// export const deactivate = App.deactivate;
//
// ✗ 禁止：同文件 export function activate —— Vite Fast Refresh 整页刷新
// ✗ 禁止：钩子挂在叶子页，expose 却是壳 App —— Host 读不到
// 缺钩子时 Host normalizePluginModule 会 console.warn，不阻断加载
```

## 6. Vue 插件实现

### 6.1 Host 如何挂载 Vue

loadRemote → normalizePluginModule（framework: vue）→ createVueHostBridge(mount)：
- React 渲染 div[data-plugin-root][data-mf-framework=vue]，再调用 Remote.mount(el, bridge)
- createApp(App, { bridge: reactive(bridge) }).use(router).mount(el)
- bridge.api / bridge.plugin 热更新时写入同一 reactive 对象
因此 Vue 根必须 defineProps<{ bridge: HostBridgeProps }>()。

### 6.2 类型（与 React 同一套 HostBridgeProps）

放到 src/types/host.ts。Vue 消费方式为 props.bridge / useHostBridge()。

```typescript
/** 与 @dnhyxc-ai/federation-kit HostBridgeProps 对齐的最小子集（无 api.t） */
export type HostLocale = 'zh-CN' | 'en-US';

export type HostBridgeProps = {
  api: {
    theme: 'light' | 'dark';
    locale: HostLocale;
    navigate?: (to: string) => void;
    event: {
      on: (event: string, handler: (data?: unknown) => void) => void;
      off: (event: string, handler: (data?: unknown) => void) => void;
      emit: (event: string, data?: unknown) => void;
    };
    http?: {
      get: <T = unknown>(url: string) => Promise<T>;
      post: <T = unknown>(url: string, body?: unknown) => Promise<T>;
      put: <T = unknown>(url: string, body?: unknown) => Promise<T>;
      delete: <T = unknown>(url: string) => Promise<T>;
    };
    ui?: {
      showToast: (options: {
        message: string;
        type?: 'success' | 'error' | 'info' | 'warning';
        title?: string;
      }) => void;
      /** 应用级影院全屏（藏侧栏/顶栏）；需 ui:toast */
      setAppFullscreen?: (full: boolean) => Promise<void>;
      downloadBlob?: (options: {
        fileName: string;
        data: ArrayBuffer | Uint8Array;
        mimeType?: string;
      }) => Promise<{ ok: boolean; hostToasted: boolean; message?: string }>;
      /** 让用户选本地文件（跨端）；需 ui:toast */
      pickLocalFiles?: (options?: {
        accept?: string;
        multiple?: boolean;
      }) => Promise<{ path: string; name: string; src: string }[] | null>;
      /** 插件中心图标地址 → 已上色的整段 svg。需 ui:toast */
      readIconSvg?: (url: string) => Promise<string | null>;
    };
    modules?: Readonly<Record<string, (...args: unknown[]) => unknown>>;
  };
  plugin: { id: string; version: string; routePath: string };
};
```

### 6.3 多页铁律（参考 remote-vue-shadcn）

- mount 必须挂带 <RouterView /> 的根 App.vue，并 app.use(router)
- 独立预览：createWebHistory；Host 嵌入：createMemoryHistory（否则 push("/detail") 会改掉主站 URL）
- 预览与嵌入共用同一 routes 表
- activate 参数是 api，不是整个 bridge
详见 packages/federation-kit/docs/plugin-guide/Vue插件开发.md §5

### 6.4 vue-router：WebHistory / MemoryHistory

嵌入用 Memory，主站地址栏仍停在 routePath。

```typescript
// src/router/index.ts —— 预览 WebHistory / 嵌入 MemoryHistory
import {
  createMemoryHistory,
  createRouter,
  createWebHistory,
  type Router,
  type RouterHistory,
} from 'vue-router';
import HomePage from '@/views/home/HomePage.vue';
import InfoPage from '@/views/info/App.vue';
import DetailPage from '@/views/detail/index.vue';

const routes = [
  { path: '/', name: 'home', component: HomePage },
  { path: '/info', name: 'info', component: InfoPage },
  { path: '/detail', name: 'detail', component: DetailPage },
];

export function createAppRouter(
  history: RouterHistory = createWebHistory(),
): Router {
  return createRouter({ history, routes });
}

/** 独立预览：可改浏览器地址栏 */
export const router = createAppRouter(createWebHistory());

/** Host 嵌入：不改写主站 URL（等价 React 内存路由） */
export function createHostRouter(): Router {
  return createAppRouter(createMemoryHistory());
}
```

### 6.5 useHostBridge（provide / inject）

App.vue provide；子页 inject，避免层层 props。

```typescript
// src/composables/useHostBridge.ts
import { inject, type InjectionKey, type Ref } from 'vue';
import type { HostBridgeProps } from '@/types/host';

export const HOST_BRIDGE_KEY: InjectionKey<Ref<HostBridgeProps>> =
  Symbol('hostBridge');

export function useHostBridge(): Ref<HostBridgeProps> {
  const bridge = inject(HOST_BRIDGE_KEY);
  if (!bridge) throw new Error('useHostBridge() 须在 App.vue 子树内使用');
  return bridge;
}
```

### 6.6 根组件 App.vue

provide bridge + RouterView；业务页不要当作 expose default。

```vue
<!-- src/App.vue —— 根壳：provide bridge + RouterView -->
<script setup lang="ts">
import { provide, toRef } from 'vue';
import { RouterView } from 'vue-router';
import { HOST_BRIDGE_KEY } from '@/composables/useHostBridge';
import type { HostBridgeProps } from '@/types/host';

const props = defineProps<{ bridge: HostBridgeProps }>();
provide(HOST_BRIDGE_KEY, toRef(props, 'bridge'));
</script>

<template>
  <RouterView />
</template>
```

### 6.7 expose 入口 mount + 生命周期

务必 import styles；每次 mount 新建 Memory router；钩子挂在 default 对象上。

```typescript
// src/views/info/index.ts —— MF expose（Vue，参考 remote-vue-shadcn）
// Host 不装 Vue：须导出 mount(el, bridge)；嵌入用 MemoryHistory，不改主站 URL
import '@/styles.css';
import { createApp, reactive } from 'vue';
import App from '@/App.vue';
import { createHostRouter } from '@/router';
import type { HostBridgeProps } from '@/types/host';

export function mount(el: HTMLElement, bridge: HostBridgeProps) {
  const router = createHostRouter(); // createMemoryHistory
  const app = createApp(App, { bridge: reactive(bridge) as HostBridgeProps });
  app.use(router);
  void router.replace({ name: 'info' }); // 嵌入默认进业务页
  app.mount(el);
  return () => app.unmount();
}

async function activate(api: HostBridgeProps['api']) {
  console.log('[vue-shadcn] activate', api.locale);
}
async function deactivate() {
  console.log('[vue-shadcn] deactivate');
}

export default { mount, activate, deactivate };
```

### 6.8 子页 router.push

与独立预览写法完全相同；嵌入时走 MemoryHistory。

```vue
<!-- 子页：标准 vue-router；嵌入与预览写法相同 -->
<script setup lang="ts">
import { useRouter } from 'vue-router';
import { useHostBridge } from '@/composables/useHostBridge';

const bridge = useHostBridge();
const router = useRouter();

function goDetail() {
  void router.push('/detail');
}
</script>

<template>
  <div data-plugin-root>
    <p>plugin={{ bridge.plugin.id }}</p>
    <button type="button" @click="goDetail">跳转到详情页</button>
  </div>
</template>
```

### 6.9 独立预览 main.ts

WebHistory + previewBridge；Host 嵌入不会走 main。

```typescript
// src/main.ts —— 独立预览：WebHistory + 同一套 App / routes
import { createApp } from 'vue';
import App from './App.vue';
import { previewBridge } from './previewBridge';
import { router } from './router';
import './styles.css';

createApp(App, { bridge: previewBridge }).use(router).mount('#app');
```

### 6.10 Vue 常见错误

- 只在 main.ts import styles → Host 内无 utility
- registry 漏 framework: vue → 白屏
- 嵌入仍用 createWebHistory → 主站 URL 被改成 /detail
- mount 只挂叶子页、未 app.use(router) → useRouter 报错
- 根 props 写成 { api, plugin } 顶层 —— Host 传的是 { bridge }
- 手写 data-mf-* / portal container → 干扰 Host 认领

## 7. 样式、隔离与悬浮层

### 7.1 Host 隔离模型（插件零侵入）

- first-party/partner：Remote 可正常 @import "tailwindcss"（含 Preflight）。Host 把注入 CSS 包进 @scope([data-mf-style-realm="…"])；同 Remote 多 expose 共享 realm。
- 勿再给 Tailwind 强行加 hp- 前缀、勿为「防污染」关掉 Preflight（旧文档已过时）。
- Portal/Drawer/POP：不要为 MF 特传 getPopupContainer；Host 劫持 createPortal + body 原型挂载（覆盖 Vue Teleport）。
- 独立预览正常、仅嵌入后 backdrop-filter 失效 → 查 Host PluginPageShell/Layout 是否在圆角同层 overflow-hidden，不是插件 CSS 写错。

### 7.2 【关键】每个 expose 必须 import styles.css

- main.ts / main.tsx 里的 import "./styles.css"：仅独立预览执行；嵌入 Host 时不跑。
- expose 入口里的 import "@/styles.css"：随 Remote 模块注入，嵌入 Host 时必须有。
- 一仓多 expose：每个入口都要写（可重复 import）。
漏写典型症状：独立预览正常；Host 内 Tooltip 只剩文字/箭头、Context Menu 字体错乱。

### 7.3 styles.css 示例

token / @theme 建议对齐 Host 或 remote-*-shadcn 的 styles.css。嵌入时部分变量可继承 Host :root。

```css
/* src/styles.css —— 可完整 @import tailwind（含 Preflight）；隔离由 Host @scope 负责 */
@import "tailwindcss";
@import "tw-animate-css";

@custom-variant dark (&:where(.dark, .dark *));

#app,
#root,
[data-plugin-root] {
  height: 100%;
  min-height: 100%;
  width: 100%;
  background-color: var(--background);
  color: var(--foreground);
  font-family: ui-sans-serif, system-ui, sans-serif;
}

:root {
  --radius: 0.625rem;
  --background: oklch(1 0 0);
  --foreground: oklch(0.145 0.02 264);
  --popover: oklch(1 0 0);
  --popover-foreground: oklch(0.145 0.02 264);
  /* …其余 token 对齐 Host / apps/micro/src/styles.css */
}

.dark {
  --background: oklch(0.145 0.02 264);
  --foreground: oklch(0.985 0.002 247.839);
  /* … */
}

@theme inline {
  --color-background: var(--background);
  --color-foreground: var(--foreground);
  --color-popover: var(--popover);
  --color-popover-foreground: var(--popover-foreground);
}
```

### 7.4 悬浮层验收清单

打开 Tooltip / Dialog / Context Menu / Sheet / Sonner 后：
1. utility 与背景色仍正常（未被剥光，也不污染 Host）
2. DevTools：弹层在 [data-mf-portal-scope="pluginId"] 内，且 data-mf-style-realm 与插件根一致
3. 插件内 Sonner 不顶开 Host 布局；Host Toast 仍 fixed
4. 勿手写 data-mf-* 业务标记

## 8. 插件内 i18n 与 Host locale

### 8.1 规则

- Host 不注入 api.t。
- 插件自建字典（src/i18n + useI18n）。
- MF：props api.locale + event.on("locale")；用 useHostLocale(api)。
- 独立预览：URL ?lang= / 本地 storage；mock 可不传 locale。
- iframe：init.locale + postMessage type:"locale"；外观另见 type:"appearance"（第 10 章）。iframe 的 api.event 是 no-op，不要用 event 听语言。
- storage key 与 Host 隔离（勿占用 Host 的 locale key）。

### 8.2 useHostLocale（React）

Vue 侧可用 watch(() => bridge.api.locale, …) + 监听 bridge.api.event 的 locale 事件，语义相同。

```typescript
// src/hooks/useHostLocale.ts
import { useEffect } from 'react';
import { applyHostLocale, isLocale, type Locale } from '@/i18n';

export function useHostLocale(api?: {
  locale?: Locale;
  event?: {
    on: (event: string, handler: (data?: unknown) => void) => void;
    off: (event: string, handler: (data?: unknown) => void) => void;
  };
}) {
  useEffect(() => {
    if (isLocale(api?.locale)) applyHostLocale(api.locale);
  }, [api?.locale]);

  useEffect(() => {
    const event = api?.event;
    if (!event) return;
    const onLocale = (data?: unknown) => {
      if (isLocale(data)) applyHostLocale(data);
    };
    event.on('locale', onLocale);
    return () => event.off('locale', onLocale);
  }, [api?.event]);
}
```

## 9. 权限与 Registry 字段

### 9.1 权限列表

- ui:toast — showToast / setAppFullscreen / downloadBlob / pickLocalFiles / readIconSvg（插件中心图标，见 §5.10.1）
- nav:subtree — api.navigate
- http:plugin-api — api.http.*
- modules:point — 挂到已登记扩展点，得到 `api.modules.point`。接法见第 14 章
- modules:learningNotes — 学习笔记。不走扩展点
- modules:chat — 打开某个会话。不走扩展点
原则：最小权限；用前判空。没写进 permissions 的能力在 bridge 上是 undefined。

### 9.2 React 插件 Registry 示例

不要写 titleKey / descriptionKey / menu.nameKey。menu 仅 order + icon（侧栏不展示文字）。hostApiRange 须覆盖 Host 的 VITE_HOST_API_VERSION（默认 1.0.0），勿与插件 version 混淆。

```json
{
  "id": "myReactPlugin",
  "remoteName": "myReactPlugin",
  "expose": "./App",
  "title": {
    "zh-CN": "我的 React 插件",
    "en-US": "My React plugin"
  },
  "description": {
    "zh-CN": "React MF 子应用示例。",
    "en-US": "React Module Federation remote sample."
  },
  "routePath": "/my-react-plugin",
  "entry": "http://127.0.0.1:9008/mf-manifest.json",
  "version": "1.0.0",
  "hostApiRange": "^1.0.0",
  "injectRoute": true,
  "menu": { "order": 100, "icon": "Puzzle" },
  "permissions": ["ui:toast", "nav:subtree"],
  "preload": "route",
  "enabled": true,
  "trust": "first-party"
}
```

### 9.3 Vue 插件 Registry（必须 framework）

framework: "vue" 为上架硬性要求。remoteName 对齐 vite federation.name；expose 对齐 exposes 键。

```json
{
  "id": "vueStyleIsolationLab",
  "remoteName": "microVue",
  "expose": "./StyleIsolationLab",
  "framework": "vue",
  "title": {
    "zh-CN": "Vue 样式实验室",
    "en-US": "Vue style lab"
  },
  "description": {
    "zh-CN": "Vue3 子应用：验收 Teleport 与 Host 样式隔离。",
    "en-US": "Vue3 remote for Teleport + Host CSS isolation."
  },
  "routePath": "/vue-style-lab",
  "entry": "http://127.0.0.1:9009/mf-manifest.json",
  "version": "1.0.0",
  "hostApiRange": "^1.0.0",
  "injectRoute": true,
  "menu": { "order": 102, "icon": "FlaskConical" },
  "permissions": ["ui:toast", "nav:subtree"],
  "preload": "route",
  "enabled": true,
  "trust": "first-party"
}
```

### 9.4 字段速查

- id — 唯一；侧栏/路由内部键
- remoteName — MF 容器名；多插件共 Remote 时填同一 name
- expose — 如 "./App" / "./StyleIsolationLab"
- framework — "vue" | "react"（可省略，默认按 React；Vue 必填 vue）
- entry — …/mf-manifest.json
- routePath / injectRoute / menu / permissions / preload / trust / iframeUrl
- host — 嵌进业务页。`surface` 和 `slot` 必须是第 14.2 节表里已有的名字，`icon` 用 SVG URL，`order` 排序。从建文件到启用的步骤见第 14 章
发版：部署新产物即可；Host 用 manifest 指纹 bust，不必为刷缓存改 registry updatedAt。

### 9.5 untrusted（iframe）示例

trust + iframeUrl 是硬门槛。entry 对 untrusted 仅占位（不加载 MF）。permissions 仍决定 RPC 门闩。完整接入步骤、协议与主题跟随见第 10 章。

```json
{
  "id": "untrustedDemo",
  "title": { "zh-CN": "不受信演示", "en-US": "Untrusted demo" },
  "routePath": "/untrusted-demo",
  "entry": "https://example.com/unused-for-iframe.json",
  "version": "1.0.0",
  "hostApiRange": "^1.0.0",
  "permissions": ["ui:toast"],
  "enabled": true,
  "trust": "untrusted",
  "iframeUrl": "http://127.0.0.1:9012/"
}
```

## 10. iframe 隔离子应用（untrusted）

### 10.1 何时必须用 iframe

- 第三方 / 不可信代码：trust: "untrusted"。
- 需要浏览器级隔离：独立 JS/CSS 文档，不能操作 Host DOM。
- first-party / partner 不要用 iframe：应走 MF 嵌入（Host @scope 已隔离样式）。

为什么不可信不能用 MF？动态 import 与 Host 同 realm，恶意脚本可直接碰 document / cookie / 本地存储。iframe + sandbox 把执行环境拆开；能力只经 postMessage RPC 按 permissions 放行。

### 10.2 整体架构

Host PluginHostView 发现 trust===untrusted → 渲染 UntrustedIframe(src=iframeUrl) → attachIframeBridge。
你的 embed 页：connectIframeHost(pluginId) → 发 ready → 收 init（theme/locale/plugin/appearance）→ buildBridge → 渲染业务 App。
之后：Host 语言切换推 locale；主题/强调色变化推 appearance；业务调 http/ui 走 rpc → rpc-result。
channel 默认 dnhyxc-mf-iframe（与 Host createFederation({ iframeChannel }) 一致）。

### 10.3 Host 如何挂 iframe（理解生命周期）

子应用不必复制这段代码，但必须理解：为何只依赖 src、为何 about:blank、为何铺主题底色——否则联调时会误判「白屏 / 卡死 / 握手重复」是自己的 bug。

```tsx
/** Host 侧 UntrustedIframe（federation-kit PluginHostView）——理解即可，子应用勿抄进 Remote
 *
 * 为何 effect 只依赖 src？bridge / iframeBridge 每次 render 可能是新对象；
 * 若放进 deps 会反复 detach/attach，postMessage 抖动、Strict Mode 下更糟。
 * 为何 unload 先 about:blank？跨域 iframe 在路由切换时硬拆，桌面 WebView 可能主线程卡死。
 * 为何外层铺 --theme-background？握手前 iframe 默认白底，暗色主题会闪白屏。
 */
function UntrustedIframe({ pluginId, src, bridge, iframeBridge }) {
  const iframeRef = useRef(null);
  const bridgeRef = useRef(bridge);
  const optsRef = useRef(iframeBridge);
  bridgeRef.current = bridge;
  optsRef.current = iframeBridge;

  useEffect(() => {
    const el = iframeRef.current;
    if (!el) return;
    let origin;
    try {
      origin = new URL(src).origin;
    } catch {
      return;
    }
    const detach = attachIframeBridge(el, bridgeRef.current, origin, optsRef.current);
    return () => {
      try {
        el.src = 'about:blank';
      } catch {
        /* ignore */
      }
      detach();
    };
  }, [src]);

  return (
    <div
      className="h-full w-full min-h-0"
      style={{ background: 'var(--theme-background, var(--background, transparent))' }}
    >
      <iframe
        ref={iframeRef}
        title={pluginId}
        src={src}
        className="h-full w-full border-0 bg-transparent"
        style={{ backgroundColor: 'transparent' }}
        data-mf-plugin={pluginId}
        data-mf-trust="untrusted"
        sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
      />
    </div>
  );
}
```

### 10.4 通信协议（6 种消息）

| 消息 | 方向 | 载荷 | 触发 |
| --- | --- | --- | --- |
| ready | iframe→Host | `{ channel, type, pluginId }` | embed 加载后轮询直至握手成功 |
| init | Host→iframe | `{ channel, type, theme, locale, plugin, appearance? }` | 收到 ready / iframe load / 120ms kick |
| locale | Host→iframe | `{ channel, type, locale }` | Host 语言切换 |
| appearance | Host→iframe | `{ channel, type, appearance }` | 主题/强调色变化（指纹去重） |
| rpc | iframe→Host | `{ channel, type, id, method, args }` | 调用受限能力 |
| rpc-result | Host→iframe | `{ channel, type, id, ok, value\|error }` | RPC 完成 |

Host 内置 RPC：http.get/post/put/delete；ui.showToast；ui.downloadBlob；ui.pickLocalFiles。没有 ui.readIconSvg，iframe 插件目前不能读取插件中心图标。额外方法经 Host iframeRpcHandlers 扩展（如 ebook.*）。

ready 只应答一次（readyAcked），避免 Strict Mode / 泄漏 interval 打爆主线程；load 发 init 但不占 ready 槽。

### 10.5 HostIframeAppearance：为什么是快照而不是 theme 字符串

类型定义在示例项目 `src/utils/applyHostAppearance.ts`（与 federation-kit HostIframeAppearance 对齐）。
仅下发 theme:"dark" 不够：强调色与表面 token 无法跟随；主站常用 theme-black 而无 .dark，iframe 若强行加 .dark 会误触 dark:border-*。
darkClass 缺省时回退 theme==="dark"（兼容旧协议 Host）；有真实 .dark 才加类，否则只靠 cssVars 钉表面色。

```typescript
export type HostIframeAppearance = {
	theme: 'light' | 'dark';
	cssVars: Record<string, string>;
	/** 与 Host 一致；缺省时回退为 theme==='dark'（旧协议） */
	darkClass?: boolean;
};
```

### 10.6 applyHostAppearance

路径：`src/utils/applyHostAppearance.ts`。
要点：指纹去重（同外观 return false，仍会 revealEmbedChrome）；拒绝 cssVars 里未解析的 var()；白名单 HOST_SYNC_VAR_RE；用 <style id="dnhyxc-host-chrome"> !important 钉死 token；darkClass 用 classList.toggle，勿 theme===dark 强加 .dark；揭开 embed-pending 防白屏。

```typescript
/** Host 外观快照 → 写进本页 :root / body（untrusted iframe） */

export type HostIframeAppearance = {
	theme: 'light' | 'dark';
	cssVars: Record<string, string>;
	/** 与 Host 一致；缺省时回退为 theme==='dark'（旧协议） */
	darkClass?: boolean;
};

/** 允许 Host 热推的 chrome token（强调色 + 边框/表面） */
const HOST_SYNC_VAR_RE =
	/^(--brand-accent|--border|--theme-border|--theme-color|--input|--ring|--background|--foreground|--card|--popover|--muted|--secondary|--primary|--theme-background|--theme-foreground|--theme-card|--theme-muted|--theme-secondary|--theme-textcolor)/;

/** 仅清「不应残留」的误写 token；当前要同步的表面色不在此列 */
const STALE_THEME_VARS = [
	'--card-foreground',
	'--popover-foreground',
	'--primary-foreground',
	'--secondary-foreground',
	'--muted-foreground',
	'--accent',
	'--accent-foreground',
	'--destructive',
	'--sidebar',
	'--radius',
	'--theme-sidebar',
	'--theme-default',
] as const;

let lastAppliedFp = '';

/** 揭开 embed-pending：主题已就绪（或至少收到过 appearance） */
function revealEmbedChrome() {
	document.documentElement.classList.remove('embed-pending');
	document.getElementById('embed-pending-style')?.remove();
}

/** Host 外观：按 darkClass 决定是否加 .dark；cssVars 用 <style !important> 注入 */
export function applyHostAppearance(appearance: HostIframeAppearance) {
	const root = document.documentElement;
	const body = document.body;
	const darkClass = appearance.darkClass ?? appearance.theme === 'dark';
	const fp = `${appearance.theme}|${darkClass}|${JSON.stringify(appearance.cssVars)}`;
	if (fp === lastAppliedFp) {
		revealEmbedChrome();
		return false;
	}
	lastAppliedFp = fp;

	for (const name of STALE_THEME_VARS) {
		root.style.removeProperty(name);
		body.style.removeProperty(name);
	}

	const decls: string[] = [];
	for (const [name, value] of Object.entries(appearance.cssVars)) {
		if (!value || !HOST_SYNC_VAR_RE.test(name)) continue;
		// 拒绝未解析 var()：写入后 color-mix(border-theme/10) 会整段失效
		if (value.includes('var(')) continue;
		decls.push(`${name}: ${value} !important`);
		root.style.setProperty(name, value);
		body.style.setProperty(name, value);
		// Tailwind 工具类也可能吃 --color-theme；与 --theme-color 一并钉死
		if (name === '--theme-color') {
			decls.push(`--color-theme: ${value} !important`);
			root.style.setProperty('--color-theme', value);
			body.style.setProperty('--color-theme', value);
		}
	}

	let styleEl = document.getElementById(
		'dnhyxc-host-chrome',
	) as HTMLStyleElement | null;
	if (!styleEl) {
		styleEl = document.getElementById(
			'dnhyxc-host-accent',
		) as HTMLStyleElement | null;
	}
	if (!styleEl) {
		styleEl = document.createElement('style');
		styleEl.id = 'dnhyxc-host-chrome';
		document.head.appendChild(styleEl);
	} else {
		styleEl.id = 'dnhyxc-host-chrome';
	}
	styleEl.textContent = decls.length
		? `:root, html, body, .dark { ${decls.join('; ')}; }`
		: '';

	// 与 Host 对齐：theme-black 场景通常无 .dark，勿强加（否则 outline 走 dark:border-input）
	root.classList.toggle('dark', darkClass);
	body.classList.toggle('dark', darkClass);
	root.setAttribute('data-theme', appearance.theme);
	root.style.colorScheme = appearance.theme;
	revealEmbedChrome();
	return true;
}
```

### 10.7 iframeHostClient

路径：`src/utils/iframeHostClient.ts`。
要点：channel=dnhyxc-mf-iframe；ready 轮询 + AbortSignal 可取消；ConnectedBridge 含 onAppearanceChange / disconnect；appearance 仅当 applyHostAppearance 返回 true 才回调（避免无意义重渲染）；event/navigate 在 iframe 下为 no-op；ui.showToast 走 RPC。对外 re-export applyHostAppearance / HostIframeAppearance。

```typescript
/** Host ↔ untrusted iframe 协议客户端（与 federation-kit attachIframeBridge 对齐） */

import type { HostBridgeProps } from '@/types/host';
import {
	applyHostAppearance,
	type HostIframeAppearance,
} from './applyHostAppearance';

export type { HostIframeAppearance } from './applyHostAppearance';
export { applyHostAppearance } from './applyHostAppearance';

const CHANNEL = 'dnhyxc-mf-iframe';
const PLUGIN_ID = 'untrustedDemo';

type HostLocale = 'zh-CN' | 'en-US';

type RpcResult =
	| { channel: string; type: 'rpc-result'; id: string; ok: true; value: unknown }
	| {
			channel: string;
			type: 'rpc-result';
			id: string;
			ok: false;
			error: string;
	  };

const pending = new Map<
	string,
	{ resolve: (v: unknown) => void; reject: (e: Error) => void }
>();

function post(msg: unknown) {
	window.parent.postMessage(msg, '*');
}

function rpc<T = unknown>(method: string, ...args: unknown[]): Promise<T> {
	const id = `rpc-${Date.now()}-${Math.random().toString(36).slice(2)}`;
	return new Promise<T>((resolve, reject) => {
		pending.set(id, {
			resolve: (v) => resolve(v as T),
			reject,
		});
		post({ channel: CHANNEL, type: 'rpc', id, method, args });
	});
}

export type ConnectedBridge = HostBridgeProps & {
	onLocaleChange: (fn: (locale: HostLocale) => void) => void;
	onAppearanceChange: (fn: (appearance: HostIframeAppearance) => void) => void;
	appearance?: HostIframeAppearance;
	/** 卸监听 / 停 ready 轮询；Strict Mode / 卸载时必须调 */
	disconnect: () => void;
};

function buildBridge(
	init: Record<string, unknown>,
	onLocaleChange: (fn: (locale: HostLocale) => void) => void,
	onAppearanceChange: (fn: (appearance: HostIframeAppearance) => void) => void,
	disconnect: () => void,
	appearance?: HostIframeAppearance,
): ConnectedBridge {
	const plugin = (init.plugin as HostBridgeProps['plugin']) ?? {
		id: PLUGIN_ID,
		version: '1.0.0',
		routePath: '/untrusted-demo',
	};
	const theme =
		appearance?.theme ?? (init.theme as 'light' | 'dark') ?? 'light';

	return {
		api: {
			theme,
			locale: (init.locale as HostLocale) || 'zh-CN',
			navigate: () => undefined,
			event: {
				on: () => undefined,
				off: () => undefined,
				emit: () => undefined,
			},
			ui: {
				showToast: (o) => {
					void rpc('ui.showToast', o);
				},
			},
		},
		plugin,
		appearance,
		onLocaleChange,
		onAppearanceChange,
		disconnect,
	};
}

export type ConnectIframeHostOptions = {
	signal?: AbortSignal;
};

/** 握手 Host：ready → init；之后可用 bridge.api.ui.showToast（RPC） */
export function connectIframeHost(
	pluginId = PLUGIN_ID,
	opts?: ConnectIframeHostOptions,
): Promise<ConnectedBridge> {
	return new Promise((resolve, reject) => {
		let settled = false;
		let localeHandler: ((locale: HostLocale) => void) | undefined;
		let appearanceHandler:
			| ((appearance: HostIframeAppearance) => void)
			| undefined;
		const setLocaleHandler = (fn: (locale: HostLocale) => void) => {
			localeHandler = fn;
		};
		const setAppearanceHandler = (
			fn: (appearance: HostIframeAppearance) => void,
		) => {
			appearanceHandler = fn;
		};

		const disconnect = () => {
			window.clearInterval(timer);
			window.removeEventListener('message', onMessage);
			opts?.signal?.removeEventListener('abort', onAbort);
		};

		const fail = (err: Error) => {
			if (settled) return;
			settled = true;
			disconnect();
			reject(err);
		};

		const onAbort = () => {
			fail(new Error('iframe host handshake aborted'));
		};

		const onMessage = (ev: MessageEvent) => {
			const data = ev.data as Record<string, unknown>;
			if (!data || data.channel !== CHANNEL) return;

			if (data.type === 'init') {
				window.clearInterval(timer);
				const appearance = data.appearance as
					| HostIframeAppearance
					| undefined;
				const theme =
					appearance?.theme ?? (data.theme as 'light' | 'dark') ?? 'light';
				const next: HostIframeAppearance = appearance ?? {
					theme,
					cssVars: {},
				};
				if (!appearance) {
					next.theme = theme;
				}
				applyHostAppearance(next);
				// 握手完成：停 ready；保留 listener 收 locale / appearance / rpc-result
				if (settled) return;
				settled = true;
				opts?.signal?.removeEventListener('abort', onAbort);
				resolve(
					buildBridge(
						data,
						setLocaleHandler,
						setAppearanceHandler,
						disconnect,
						next,
					),
				);
				return;
			}

			if (data.type === 'locale') {
				localeHandler?.(data.locale as HostLocale);
				return;
			}

			if (data.type === 'appearance') {
				const appearance = data.appearance as HostIframeAppearance;
				if (appearance && applyHostAppearance(appearance)) {
					appearanceHandler?.(appearance);
				}
				return;
			}

			if (data.type === 'rpc-result') {
				const result = data as unknown as RpcResult;
				const p = pending.get(result.id);
				if (!p) return;
				pending.delete(result.id);
				if (result.ok) p.resolve(result.value);
				else p.reject(new Error(result.error));
			}
		};

		window.addEventListener('message', onMessage);
		if (opts?.signal) {
			if (opts.signal.aborted) {
				onAbort();
				return;
			}
			opts.signal.addEventListener('abort', onAbort);
		}

		let attempts = 0;
		const timer = window.setInterval(() => {
			if (settled) {
				window.clearInterval(timer);
				return;
			}
			attempts += 1;
			post({ channel: CHANNEL, type: 'ready', pluginId });
			if (attempts > 25) {
				fail(new Error('iframe host handshake timeout'));
			}
		}, 400);
		post({ channel: CHANNEL, type: 'ready', pluginId });
	});
}
```

### 10.8 App 单入口双模式

路径：`src/App.tsx`。iframeUrl 可直接指向应用根（如 http://127.0.0.1:9012/），用 window.parent !== window 判断嵌入。
嵌入：AbortController + connectIframeHost；卸载 abort/disconnect；握手前透明占位；勿再包一层 .dark（外观已写到 documentElement）。
独立打开：跳过握手，内存路由预览。pluginId 必须与 registry.id 一致（示例为 untrustedDemo）。

```tsx
import { useEffect, useState } from 'react';
import { NavigationProvider } from '@/router/NavigationContext';
import { AppRouter } from '@/router/AppRouter';
import {
	connectIframeHost,
	type ConnectedBridge,
	type HostIframeAppearance,
} from '@/utils/iframeHostClient';
import type { HostBridgeProps } from '@/types/host';
import '@/styles.css';

const PLUGIN_ID = 'untrustedDemo';

/**
 * 主题 / 强调色由 applyHostAppearance 写到 documentElement；此处勿再包一层 .dark，
 * 否则 portal 到 body 的 Dialog/Sheet 与树内主题不同步，且 appearance 热更新会多余重渲染。
 */
export default function App() {
	const embedded = typeof window !== 'undefined' && window.parent !== window;
	const [bridge, setBridge] = useState<HostBridgeProps | null>(null);
	const [theme, setTheme] = useState<'light' | 'dark'>('light');
	const [error, setError] = useState<string | null>(null);

	useEffect(() => {
		if (!embedded) return;
		const ac = new AbortController();
		let disconnect: (() => void) | undefined;
		void connectIframeHost(PLUGIN_ID, { signal: ac.signal })
			.then((b: ConnectedBridge) => {
				if (ac.signal.aborted) {
					b.disconnect();
					return;
				}
				disconnect = b.disconnect;
				setBridge(b);
				setTheme(b.appearance?.theme ?? b.api.theme);
				b.onAppearanceChange((appearance: HostIframeAppearance) => {
					// 只更新展示用 theme；同值跳过，避免无意义整树渲染
					setTheme((prev) =>
						prev === appearance.theme ? prev : appearance.theme,
					);
				});
			})
			.catch((e) => {
				if (ac.signal.aborted) return;
				if (e instanceof Error && e.message.includes('aborted')) return;
				setError(e instanceof Error ? e.message : String(e));
			});
		return () => {
			ac.abort();
			disconnect?.();
		};
	}, [embedded]);

	if (!embedded) {
		return (
			<NavigationProvider initialPath="/home">
				<AppRouter />
			</NavigationProvider>
		);
	}

	if (error) {
		return (
			<div className="text-destructive box-border h-full p-5.5 text-sm">
				握手失败：{error}
			</div>
		);
	}

	if (!bridge) {
		// 握手前保持空白透明，避免白底 +「连接中」文案再闪一次
		return <div className="h-full w-full bg-transparent" aria-busy="true" />;
	}

	return (
		<div className="h-full min-h-0 w-full" data-theme={theme}>
			<NavigationProvider initialPath="/info">
				<AppRouter bridge={bridge} />
			</NavigationProvider>
		</div>
	);
}
```

### 10.9 入口与 iframeUrl（无需单独 /embed 路由）

remote-untrusted 采用单入口：main 只挂 App，Host registry.iframeUrl 指向根 URL。若你拆 /embed/... 页也可以，但不是本示例的做法。

```markdown
/** remote-untrusted：无需单独 /embed 路由
 *
 * iframeUrl 直接指向应用根（如 http://127.0.0.1:9012/）。
 * App 用 window.parent !== window 判断是否嵌入：
 * - 独立打开：跳过握手，走内存路由预览（/home）
 * - Host 嵌入：connectIframeHost → 握手后渲染业务壳（默认 /info）
 *
 * 若你坚持单独 /embed 页也可以，但本示例项目采用「单入口双模式」更简单。
 */
// vite: port 9012；Host registry.iframeUrl = "http://127.0.0.1:9012/"
// main.tsx 只挂载 <App />；嵌入判定与握手全在 App.tsx（见 10.8）
```

### 10.10 Registry（untrusted，对齐 remote-untrusted）

- trust: "untrusted" + iframeUrl 必填；生产 iframeUrl 必须 https。
- entry 可占位，不会 loadRemote。
- permissions 仍控制 RPC：示例最小集 ui:toast（showToast）。
- id / pluginId 均为 untrustedDemo；开发服端口 9012。

```json
{
  "id": "untrustedDemo",
  "title": { "zh-CN": "不受信演示", "en-US": "Untrusted demo" },
  "routePath": "/untrusted-demo",
  "entry": "https://example.com/unused-for-iframe.json",
  "version": "1.0.0",
  "hostApiRange": "^1.0.0",
  "permissions": ["ui:toast"],
  "enabled": true,
  "trust": "untrusted",
  "iframeUrl": "http://127.0.0.1:9012/"
}
```

### 10.11 常见坑

- channel 不一致 → 永远无 init。
- 只用 theme、忽略 appearance / 未调用 applyHostAppearance → 强调色不跟、theme-black 边框异常。
- theme===dark 就加 .dark（忽略 Host darkClass）→ outline 边框消失。
- 依赖 api.event 做语言/主题 → iframe 下是 no-op。
- pluginId 与 registry.id 不一致 → ready 被丢弃。
- 未传 AbortSignal / 未 disconnect → Strict Mode 双挂载泄漏轮询。
- 调试时选错 DevTools 上下文（要选 iframe）→ 看不到 embed 日志。

### 10.12 iframe 验收清单

□ iframeUrl 指向可访问的入口（示例为 http://127.0.0.1:9012/）
□ 握手成功（Console 可见 ready/init）
□ init.appearance 已 apply；切换主站强调色/主题后 iframe 同步
□ 暗色 theme-black 下 outline 按钮边框仍可见（未误加 .dark）
□ ui.showToast（需 ui:toast）可用
□ 快速切换路由不白屏卡死；卸载无泄漏 interval
□ Tab 键能进入 iframe 内输入框

## 11. 预览、部署与调试

### 11.1 本地联调顺序

【MF】
1. pnpm dev 启动 Remote（确认 /mf-manifest.json 可访问）
2. 启动 Host；Registry 指向该 entry 且 enabled
3. `injectRoute` 不为 false 时从侧栏进入插件路由。内嵌插件没有侧栏入口，到对应业务页，并在插件中心启用后再看槽位（第 14 章）
4. Network：进入插件应主要看到 1 条 mf-manifest.json + remoteEntry.js?v=
5. 独立预览：React 开 main 路由；Vue 开实验室 path

【iframe untrusted】
1. 启动 remote-untrusted（确认 http://127.0.0.1:9012/ 可打开）
2. Registry trust=untrusted + iframeUrl 指向该根 URL，id=untrustedDemo
3. Host 进入插件路由后，DevTools 选 iframe 上下文查握手与 appearance

### 11.2 构建与静态托管

pnpm build → 托管 dist；CORS 放开；建议 Cache-Control: no-store（配合 Host bust）。iframe 生产须 https。

```nginx
server {
  listen 9008;
  server_name _;
  root /path/to/plugin/dist;
  location / {
    try_files $uri $uri/ /index.html;
    add_header Access-Control-Allow-Origin "*";
    add_header Access-Control-Allow-Methods "GET, OPTIONS";
    add_header Cache-Control "no-store";
  }
}
```

### 11.3 调试要点

- 双 React / Invalid hook call：shared singleton + 清 .vite + 勿二次 createRoot
- CORS：server.cors + ACAO
- Module ./X does not exist：线上未部署含该 expose 的构建
- 样式进 Host 却污染：查是否绕过 head 注入；Host sonner 应有 data-mf-host-style 保护
- 嵌入无样式：expose 是否 import styles.css
- Vue 白屏：registry framework: vue
- 语言不跟随：MF 用 useHostLocale；iframe 用 type:"locale"
- iframe 主题/强调色不跟随：是否 applyHostAppearance + 监听 appearance
- React 详情跳转无效：expose 是否为壳 App
- Vue 跳转改主站 URL：嵌入是否误用 WebHistory
- activate 未跑：钩子是否挂在 expose default

## 12. 验收清单

### 12.1 上线前核对

【工程】
□ @module-federation/vite；manifest: true；hostInitInjectLocation: entry
□ React：shared 仅 react/react-dom singleton；Vue：shared 仅 vue singleton
□ 每个 expose 入口 import "@/styles.css"

【组件】
□ default 导出；React 收 {api,plugin}；Vue 收 props.bridge / mount
□ 根 data-plugin-root；activate 挂在壳 App（静态属性或 default 对象）
□ 多页：React expose 壳+NavigationProvider；Vue 嵌入 MemoryHistory
□ 自有 i18n；无 api.t

【Registry】
□ title/description locale map；hostApiRange 正确
□ Vue：framework: "vue"
□ permissions 最小集；trust/iframeUrl 匹配

【iframe untrusted】
□ App 双模式 + connectIframeHost(AbortSignal)；applyHostAppearance；channel 一致
□ 主题/强调色热更新；theme-black 下边框正常

【体验】
□ 独立预览与 Host 嵌入样式一致（含悬浮层）
□ 列表→详情跳转在 Host 内正常
□ activate 日志可见（或确认 warn 后按需补钩子）
□ Host Toast 不被插件样式顶开
□ 若用影院全屏：成对 setAppFullscreen，卸载退出

## 13. 常见问题

### 13.1 独立预览正常，嵌进 Host 后 Tooltip / 菜单没样式？

先查 expose 入口是否 import "@/styles.css"。再查弹层是否在 [data-mf-portal-scope] + 同 style-realm。

### 13.2 Vue 插件白屏 / 被当成 React？

registry 写 "framework": "vue"；Remote 导出 mount(el, bridge)；不要自建 React 桥；Host 不装 vue。

### 13.3 样式污染了 Host？

first-party 下应由 Host @scope。仍污染则查是否绕过 head 注入、或 untrusted 误配成 MF。不要用旧的「关 Preflight / 加 prefix」当主方案。

### 13.4 仅嵌入后毛玻璃失效？

查 Host PluginPageShell / Layout：圆角容器同层不要 overflow-hidden（会废掉子树 backdrop-filter）。

### 13.5 发版后 Host 仍旧包？

确认已部署新 dist；Host 会读 Remote 自己的 mf-manifest.json 算指纹。不必为刷缓存去改 Host registry updatedAt。桌面壳需含 bust 逻辑的版本。

### 13.6 React：info 点详情没反应？

多半 expose 了叶子 InfoPage，Host 树没有 NavigationProvider，navigate 是空函数。改为 expose 壳 App（见 5.5–5.9）。

### 13.7 Vue：嵌 Host 跳详情跳出主站 / 404？

嵌入用了 createWebHistory。改用 createMemoryHistory（createHostRouter），见 6.3–6.4。

### 13.8 activate 没执行 / 控制台 warn？

钩子须在 expose 的 default 上（App.activate 或 { mount, activate }）。挂叶子页无效。缺钩子会 warn 不阻断；force 重载：pluginManager.ensurePlugin(id, { force: true })。

### 13.9 iframe 内强调色 / 暗色边框不跟随主站？

确认 connectIframeHost 处理了 init.appearance 与 type:"appearance"，并用 applyHostAppearance。不要在 theme===dark 时强加 .dark；darkClass 须跟 Host。详见第 10.5–10.7 章。

### 13.10 iframe 一直 connecting / 握手超时？

核对 channel（dnhyxc-mf-iframe）、pluginId===registry.id、iframeUrl 可访问且同 origin 与 registry 一致；DevTools 选 iframe 上下文看是否在发 ready。

## 14. 开发一个页面内嵌插件

这一章只讲一种插件：不进侧栏，嵌在英语学习已经有的页面里。外壳由主项目画，包括按钮、抽屉、抽屉标题。你写的是外壳里面的内容。

做完一个能在页面上看到的插件，交付这四样：

1. 一个 React 组件，默认导出，入参是 `{ api }`。
2. `vite.config.ts` 的 `exposes` 里多一个键，指向该组件的入口。
3. 注册表里多一条：`injectRoute: false`，不写 `menu`，`permissions` 含 `modules:point`，`host.surface` 和 `host.slot` 用 14.2 表里已有的名字。
4. 插件中心启用这条，并重新拉取注册表。

工程、样式隔离、联邦共享依赖沿用第 1–8 章。单词解析、解析列表、导入已经在子项目 `dnhyxc-ai-plugins` 里，和它们打在同一个 Remote 时，`entry` 继续指向同一份 `mf-manifest.json`。

学习笔记、打开某个聊天会话仍走 `modules:learningNotes`、`modules:chat`，不走本章。阅读页 `ebook.read` 走本章：上下文是 `bookId`、`bookTitle`，命令是 `navigateToCfi`、`openThought`、`closeIdeasList`。阅读页的按钮和抽屉由阅读页自己画。

### 14.1 先选挂法

先在 14.2 里选定页面，再从下面三种里选一种。三种的组件入参一样，差别是注册表的 `slot`，以及组件挂上之后该读 `getContext` 还是 `getPayload`。

**顶栏。** 注册表 `slot` 写 `toolbar`。主项目把你的组件直接画进顶栏，启用后立刻出现，没有点击。数据在 `point.getContext()`。根节点就是内容本身，宽度跟着顶栏走。

**图标按钮，点开后看你的内容。** 注册表 `slot` 写动作槽的名字，例如 `card-action`、`item-action`、`library-card-action`。主项目用注册表的 `icon` 和 `title` 画一枚 28px 的图标按钮。你的组件画在该动作 `opens` 指向的抽屉里。用户点击之后，主项目先把这一下的载荷写进抽屉，再挂载你的组件。所以组件第一次执行时，点击已经发生，要立刻 `getPayload(抽屉槽名)`。抽屉槽名在 14.2 的「组件画在」一列，和注册表的 `slot` 不是同一个字符串。

**页面自己有按钮的抽屉。** 目前只有单词库的解析列表是这种。注册表 `slot` 写 `drawer`。打开按钮在单词库页面上，文案和图标仍读你的注册表。组件是抽屉正文。当前词库 id 在 `point.getContext().libraryId`，不在点击载荷里。

同一个 `surface` 上可以挂多个插件，每个插件一条注册表。同一个动作槽上的多个插件会并排出现多枚按钮；点哪一枚，抽屉里就只挂那一条插件。`host.order` 小的排在前面。

语句库目录里也有一个名叫 `drawer` 的槽，当前页面没有按钮去打开它。语句库插件用 `toolbar`、`item-action` 或 `library-card-action`。

### 14.2 能挂在哪

`host.surface` 必须等于下表的 surface，`host.slot` 必须等于「注册表 slot」列。写了表里没有的名字，页面不出现这个插件，`api.modules.point` 也是 `undefined`。

表里的「读」是组件里实际调用的方法。字段名是主项目现在写进去的键，多出来的键插件读不到，少写的键就是 `undefined`。要新字段，得改主项目对应页面，见 14.10。

| surface | 页面 | 注册表 slot | 组件画在 | 组件里读 | 字段 |
| --- | --- | --- | --- | --- | --- |
| `english.vocab.card` | 每张单词卡尾部 | `card-action` | 抽屉 `drawer` | `getPayload('drawer')` | `word`、`pos`、`ipa`、`translationZh`、`example`。从词库列表用 `openCard` 打开时还有 `source: 'list'` |
| `english.vocab.library` | 单词库顶栏 | `toolbar` | 顶栏 | `getContext()` | `libraryId`，当前词库。还没选库时上下文是 `null` |
| `english.vocab.library` | 单词库每一行尾部 | `item-action` | 抽屉 `item-drawer` | `getPayload('item-drawer')` | 与词卡相同：`word`、`pos`、`ipa`、`translationZh`、`example` |
| `english.vocab.library` | 单词库页面上的列表按钮 | `drawer` | 该抽屉 | `getContext()` | `libraryId`。这个点还能 `publishSignal('stats', …)`，标题上的「已加载 / 总数」读的就是它 |
| `english.vocab.library` | 词库卡片上的导入按钮 | `library-card-action` | 抽屉 `import-drawer` | `getPayload('import-drawer')` | `libraryId`、`title` |
| `english.classic.card` | 每张语句卡尾部 | `card-action` | 抽屉 `drawer` | `getPayload('drawer')` | `english`、`translationZh`、`source`、`noteZh` |
| `english.classic.library` | 语句库顶栏 | `toolbar` | 顶栏 | `getContext()` | `libraryId` |
| `english.classic.library` | 语句库每一行尾部 | `item-action` | 抽屉 `item-drawer` | `getPayload('item-drawer')` | 与语句卡相同：`english`、`translationZh`、`source`、`noteZh` |
| `english.classic.library` | 语句库卡片上的按钮 | `library-card-action` | 抽屉 `import-drawer` | `getPayload('import-drawer')` | `libraryId`、`title` |
| `english.mistakes` | 错题集顶栏 | `toolbar` | 顶栏 | `getContext()` | `kind`：`'vocab'` 或 `'classic'`，跟当前单词/语句页签一致 |
| `english.mistakes` | 错题集每一行尾部 | `item-action` | 抽屉 `drawer` | `getPayload('drawer')` | 单词行是词卡那一组字段；语句行是语句卡那一组字段 |
| `english.review` | 今日复习 | 与错题集相同 | 与错题集相同 | 与错题集相同 | `kind` 同样是 `'vocab'` 或 `'classic'` |
| `english.favorites` | 我的收藏 | 与错题集相同 | 与错题集相同 | 与错题集相同 | `kind` |
| `english.dailyReading` | 每日阅读顶栏 | `toolbar` | 顶栏 | `getContext()` | `origin` |
| `english.dailyReading` | 每日阅读每一行尾部 | `item-action` | 抽屉 `drawer` | `getPayload('drawer')` | `id`、`titleEn`、`publishDate`、`origin` |
| `ebook.read` | 阅读页顶栏，或阅读页自己的抽屉 | `toolbar` 或 `drawer` | 顶栏，或阅读页抽屉 | `getContext()` | `bookId`、`bookTitle`。命令：`navigateToCfi`、`openThought`、`closeIdeasList` |

错题集、今日复习、收藏、每日阅读的行按钮和 `drawer` 共用一个抽屉。这两处不要各放一个都要一直开着的插件，后打开的会换掉先打开的正文。单词库和语句库的行按钮打开的是单独的 `item-drawer`，点一行不会换掉 `drawer` 里的列表。

今日复习和错题集是两个 surface。要两页都出现，就注册两条，只改 `id`、`remoteName` 和 `host.surface`。一条插件不会自己判断「现在是不是复习页」。

信号和命令按 surface 给，不按槽给。挂在单词库上的顶栏插件和导入插件，拿到的是同一份 `api.modules.point`，所以都能调 `pickJsonFile` 和 `openCard`。语句库、错题集、复习、收藏、每日阅读目前没有信号，也没有命令。

| surface | 可以 `publishSignal` 的名字 | 可以 `command` 的名字 |
| --- | --- | --- |
| `english.vocab.card` | `pending` | `play`、`stop` |
| `english.vocab.library` | `stats` | `pickJsonFile`、`openCard` |
| `ebook.read` | 无 | `navigateToCfi`（CFI 字符串）、`openThought`（想法对象）、`closeIdeasList`（`undefined`）。只在 EPUB 阅读页挂着时有实现 |
| 其余 surface | 无。写了会被丢掉 | 无。调用会抛 `UNKNOWN_POINT_COMMAND` |

`pending` 的值是 `{ pluginId, key, on }`。`pluginId` 用注册表 `id`，`key` 用当前 `word`，`on` 是布尔。只有载荷里带 `word` 的按钮会转圈，语句卡的 `english` 不会转。关抽屉不会清掉转圈，请求结束把 `on` 设为 `false` 才停。

`stats` 的值是 `{ total, loaded }`，或 `null` 表示清掉。`total`、`loaded` 不是有限数时，顶栏保持上次的数字。单词库标题读这一份。其它页面没有接这个信号。

### 14.3 要改哪些文件

下面用「错题集顶栏显示当前是单词还是语句」做最小插件。名字换成你的即可。子项目是 `dnhyxc-ai-plugins`。

**1. 类型文件** `src/views/mistake-note/point.ts`

主项目固定下发这五个方法。名字不要改，也不要再声明 `modules:vocabDetail`。

```ts
export type PointModule = {
  getContext: () => Record<string, unknown> | null;
  getPayload: (slot: string) => Record<string, unknown> | null;
  subscribe: (listener: () => void) => () => void;
  publishSignal: (name: string, value: unknown) => void;
  command: (name: string, arg?: unknown) => unknown;
};
```

单词解析目录里已有同一份类型：`src/views/vocab-detail/point.ts`。新插件可以继续从那里 import，也可以把上面几行抄到自己目录。

**2. 入口** `src/views/mistake-note/index.ts`

第一行必须引入样式，否则嵌进主项目后没有 Tailwind。

```ts
import '@/styles.css';

export { default } from './panel';
```

**3. 组件** `src/views/mistake-note/panel.tsx`，见 14.4。按钮类插件改用 14.5 的组件，单词库列表抽屉改用 14.6。

**4. 联邦导出。** `vite.config.ts` 的 `exposes` 增加一行，键和注册表 `expose` 一字不差：

```ts
exposes: {
  './MistakeNote': './src/views/mistake-note/index.ts',
}
```

**5. 注册表。** 本地开发追加到主项目 `apps/backend/uploads/remotes/plugins-registry.json` 的 `plugins` 数组：

```json
{
  "id": "mistakeNote",
  "remoteName": "dnhyxc-ai-mistake-note",
  "expose": "./MistakeNote",
  "title": { "zh-CN": "错题备注", "en-US": "Mistake note" },
  "description": {
    "zh-CN": "错题集顶栏里的备注。",
    "en-US": "A note in the mistakes toolbar."
  },
  "routePath": "/english-learning/mistake-note",
  "entry": "http://127.0.0.1:9008/mf-manifest.json",
  "version": "1.0.0",
  "hostApiRange": "^1.0.0",
  "injectRoute": false,
  "host": {
    "surface": "english.mistakes",
    "slot": "toolbar",
    "order": 10,
    "icon": "https://example.com/note.svg"
  },
  "permissions": ["modules:point"],
  "preload": "idle",
  "enabled": false,
  "trust": "first-party"
}
```

逐项怎么填：

1. `id` 是插件中心里的唯一名字，也是 `pending.pluginId` 要写的值。
2. `remoteName` 每个插件各写一个。两个插件共用一个 `remoteName` 时，后加载的会盖掉前一个的缓存刷新标记。
3. `expose` 等于 `exposes` 的键，含前面的 `./`。
4. `entry` 是插件 dev server 的 `mf-manifest.json`。和单词解析打在一起时就是 `http://127.0.0.1:9008/mf-manifest.json`。
5. `host.surface`、`host.slot` 只从表里抄。
6. `title` 是按钮文案和抽屉标题。顶栏插件没有标题栏，`title` 仍要填，插件中心用它做名字。
7. `icon` 是 SVG 的 URL。按钮读 `plugin.host.icon`。顶栏插件不画这枚图标，组件自己画内容。
8. `permissions` 至少要有 `modules:point`。要请求接口再加 `http:plugin-api`，要 `showToast` 再加 `ui:toast`。没写的能力在 `api` 上是 `undefined`。
9. `injectRoute` 固定 `false`。不要写 `menu`，写了侧栏会多一个点进去是空的入口。
10. `routePath` 描述符需要它。`injectRoute: false` 时用户打不开这个 URL。
11. `hostApiRange` 保持 `^1.0.0`。这次改动没有升主项目 API 版本。
12. `enabled` 先写 `false`。用户在插件中心打开之后，页面才会画出来。

保存注册表后，到插件中心重新拉取再启用。只改文件、浏览器仍缓存着旧权限时，`api.modules.point` 仍是 `undefined`。

**6. 启动。** 子项目执行它原来的 dev 命令，确认 `entry` 能打开。主项目刷新英语学习页。插件中心启用 `mistakeNote` 后，错题集顶栏出现这块内容。今日复习不会出现。

### 14.4 顶栏插件怎么写

组件直接出现在顶栏。下面这份就是 14.3 的 `panel.tsx`，启用后能在错题集顶栏看到当前页签。

```tsx
import { useEffect, useState } from 'react';
import { useHostLocale } from '@/hooks';
import type { PointModule } from './point';

type HostApi = {
  locale?: 'zh-CN' | 'en-US';
  event?: {
    on: (event: string, handler: (data?: unknown) => void) => void;
    off: (event: string, handler: (data?: unknown) => void) => void;
  };
  modules?: { point?: PointModule };
};

export default function MistakeNotePanel({ api }: { api: HostApi }) {
  useHostLocale(api);
  const point = api.modules?.point;
  const [kind, setKind] = useState('');

  useEffect(() => {
    if (!point) return;
    const pull = () => {
      const ctx = point.getContext();
      setKind(ctx && typeof ctx.kind === 'string' ? ctx.kind : '');
    };
    pull();
    return point.subscribe(pull);
  }, [point]);

  if (!point) return <p className="text-sm">缺少 modules:point</p>;

  return (
    <p className="px-2 text-sm text-textcolor/80">
      {kind === 'classic' ? '语句错题' : kind === 'vocab' ? '单词错题' : '尚未进入列表'}
    </p>
  );
}
```

这几行各自负责什么：

- `useHostLocale(api)` 让插件文案跟着主项目语言走。独立预览没有 `event` 时它什么都不做。
- `api.modules?.point` 没有，就是注册表没写 `modules:point`，或 `surface` 不在目录里，或注册表还是旧的。此时画一句缺少权限，不要渲染半份业务。
- `pull` 先执行一次。顶栏挂载时上下文已经在，不会再补发一次「页面打开了」。
- `subscribe` 在上下文变了，或这个点上任意槽开关时调用。返回值是退订函数，放进 `useEffect` 的 return。单词页签和语句页签切换时，`kind` 会从 `'vocab'` 变成 `'classic'`。
- `publishSignal` 不会调用 `subscribe`。回写条数、转圈不会走进 `pull`。

换成自己的业务时，只改三处：`surface` 决定 `getContext()` 里有哪个键（对照 14.2）；请求地址；根节点里画什么。顶栏根节点不要再包一层 Drawer 或 Dialog。

要请求接口时，`permissions` 加上 `http:plugin-api`，在 `pull` 里按上下文发请求。`api.http` 的 baseURL 已经含 `/api`，路径从业务段开始写，不带 token，业务字段在响应的 `data` 上：

```tsx
const res = await api.http.get(
  `/english-learning/vocab-detail?word=${encodeURIComponent(word)}`,
);
const body =
  res && typeof res === 'object' && 'data' in res
    ? (res as { data: unknown }).data
    : res;
```

`libraryId`、`kind`、`origin` 没变就不要把列表清掉重拉。`subscribe` 在别的抽屉开关时也会进来，用一个 ref 记下上次的 id，相同则 return。单词库列表现成写法在 `src/views/vocab-detail-list/list.tsx`。

### 14.5 按钮抽屉插件怎么写

注册表 `slot` 用动作槽。组件是抽屉正文。下面以错题集单词行为例：`surface` 是 `english.mistakes`，注册表 `slot` 是 `item-action`，正文读 `getPayload('drawer')`。换页面时，把 `PAYLOAD_SLOT` 改成 14.2 的「组件画在」那一列，把读取的字段换成该行的字段。

```tsx
import { useEffect, useState } from 'react';
import { useHostLocale } from '@/hooks';
import type { PointModule } from './point';

const PAYLOAD_SLOT = 'drawer';

type HostApi = {
  locale?: 'zh-CN' | 'en-US';
  event?: {
    on: (event: string, handler: (data?: unknown) => void) => void;
    off: (event: string, handler: (data?: unknown) => void) => void;
  };
  http?: { get: <T = unknown>(url: string) => Promise<T> };
  modules?: { point?: PointModule };
};

export default function RowPanel({ api }: { api: HostApi }) {
  useHostLocale(api);
  const point = api.modules?.point;
  const [word, setWord] = useState('');

  useEffect(() => {
    if (!point) return;
    const pull = () => {
      const payload = point.getPayload(PAYLOAD_SLOT);
      setWord(
        payload && typeof payload.word === 'string' ? payload.word.trim() : '',
      );
    };
    pull();
    return point.subscribe(pull);
  }, [point]);

  if (!point) {
    return (
      <div className="flex h-full min-h-0 items-center justify-center text-sm">
        缺少 modules:point
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col px-4 py-3 text-sm">
      {word ? word : '这一行没有 word'}
    </div>
  );
}
```

点击之后实际发生的事：

1. 页面上先出现图标按钮。这一步你的组件还没挂载。
2. 用户点击。主项目若发现同一个插件、同一个 `word` 或 `english` 的抽屉已经开着，就关掉它。再点一次是打开，不是由插件自己切换。
3. 打开时，主项目把这一行的 payload 写进 `PAYLOAD_SLOT`，再挂载你的组件。
4. `pull()` 马上读到这个词。不要等下一次点击，也不会有「按钮被点击」的事件传进组件。
5. 用户关掉抽屉，组件卸载。再次打开是一次新的挂载，`useEffect` 会再跑。

词卡解析就是这种插件：`surface` 为 `english.vocab.card`，`slot` 为 `card-action`，`PAYLOAD_SLOT` 为 `'drawer'`。导入插件也是：`slot` 为 `library-card-action`，`PAYLOAD_SLOT` 为 `'import-drawer'`，字段改读 `libraryId` 和 `title`。语句卡把 `payload.word` 换成 `payload.english`。每日阅读读 `payload.id`。

词卡上请求这个词时，把转圈交给主项目。`pluginId` 用注册表 `id`，和 `mistakeNote` 这种自己起的名字一致：

```tsx
point.publishSignal('pending', {
  pluginId: 'vocabDetail',
  key: word,
  on: true,
});
```

请求结束，无论成功失败，再发一次 `on: false`。这个点没有 `pending` 时，这行会被丢掉，按钮不转，组件照常显示。

同一个点上别的槽开关时，`subscribe` 也会进来。导入抽屉在详解还开着时只是被藏起来，`getPayload('import-drawer')` 仍有值。`pull` 里按载荷本身更新即可，不要因为「另一个抽屉开了」就把自己的目标清掉。

抽屉正文的根节点用 `flex h-full min-h-0 flex-col`，否则 Loading 贴在顶部。`Loading`、`Button`、`ScrollArea` 用插件自己的组件。不要再包一层 Drawer 或 Dialog，也不要自己指定 portal 容器。主项目已经把浮层收进插件的样式域。

### 14.6 页面抽屉插件怎么写

这种只有单词库的 `drawer`：按钮在单词库页面，组件只负责列表。当前库在上下文里。页面一切换词库就发布新的 `libraryId`，离开或还没选库时是 `null`。

```tsx
import { useEffect, useRef, useState } from 'react';
import { useHostLocale } from '@/hooks';
import type { PointModule } from './point';

type HostApi = {
  locale?: 'zh-CN' | 'en-US';
  event?: {
    on: (event: string, handler: (data?: unknown) => void) => void;
    off: (event: string, handler: (data?: unknown) => void) => void;
  };
  http?: { get: <T = unknown>(url: string) => Promise<T> };
  modules?: { point?: PointModule };
};

export default function LibraryListPanel({ api }: { api: HostApi }) {
  useHostLocale(api);
  const point = api.modules?.point;
  const libraryRef = useRef('');
  const [libraryId, setLibraryId] = useState('');

  useEffect(() => {
    if (!point) return;
    const apply = () => {
      const ctx = point.getContext();
      const next = ctx && typeof ctx.libraryId === 'string' ? ctx.libraryId : '';
      if (next === libraryRef.current) return;
      libraryRef.current = next;
      setLibraryId(next);
      point.publishSignal('stats', { total: 0, loaded: 0 });
    };
    apply();
    return point.subscribe(apply);
  }, [point]);

  if (!point) {
    return (
      <div className="flex h-full min-h-0 items-center justify-center text-sm">
        缺少 modules:point
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col px-4 py-3 text-sm">
      {libraryId || '还没有词库'}
    </div>
  );
}
```

`if (next === libraryRef.current) return` 必须留着。这个点的导入抽屉、行抽屉开关时也会调用 `apply`。库 id 没变就保持现有列表。去掉这行，用户每开一次别的抽屉，列表都会被清掉重拉。

每一页请求成功后把条数写回去，标题由主项目重绘。这行不会再次进入 `apply`：

```tsx
point.publishSignal('stats', { total: page.total, loaded: loadedCount });
```

点一行要打开词卡详解时调用 `openCard`，见 14.7。它只打开词卡抽屉，不会把当前列表关掉。词库列表抽屉会盖住词卡抽屉；关掉列表后，词卡抽屉还在。

现成列表在 `src/views/vocab-detail-list/list.tsx`：游标分页、`stats`、`openCard` 都在里面。第一页用整块 Loading，继续翻页只用一行小字。第一页失败给重试；后面页失败只在底部放重试，已经加载的行留着。

### 14.7 命令

`command` 的第二个参数必须传。没有参数时传 `undefined`。名字不在 14.2 的命令表里会抛 `UNKNOWN_POINT_COMMAND`。目录里有、主项目还没绑定实现会抛 `POINT_COMMAND_UNBOUND`。语句库和错题集现在调用任何命令都会抛第一种。

| 点 | 调用 | 结果 |
| --- | --- | --- |
| 词卡 | `command('play', text)` | 返回 `Promise`。`text` 用要朗读的字符串。空字符串直接结束，不发起合成。缓存目录由主项目决定 |
| 词卡 | `command('stop', undefined)` | 停掉当前正在播的声音。组件卸载时调用一次 |
| 词库 | `command('pickJsonFile', undefined)` | `Promise<File \| null>`。用户取消是 `null`。选了非 JSON 会抛 `accept`，用 `try/catch` 接住 |
| 词库 | `command('openCard', lemma)` | 返回 `true` 表示词卡详解抽屉打开了。`lemma` 是词字符串。空词，或 id 为 `vocabDetail` 的插件没启用，返回 `false` |

`openCard` 再传同一个词不会关闭。关闭由用户点抽屉外侧或词卡上的同一枚按钮完成。

```tsx
const opened = point.command('openCard', lemma) === true;
if (!opened) {
  api.ui?.showToast({ message: '请先在插件中心启用单词解析', type: 'info' });
}
```

`showToast` 需要权限 `ui:toast`。没有 `point` 时不要调 `command`。独立预览里文件选择可以退回页面上的隐藏 `<input type="file">`，嵌进主项目后走 `pickJsonFile`。

朗读不要自己 `new SpeechSynthesisUtterance`。独立预览可以在假的 `command` 里用浏览器语音，嵌进主项目时必须走 `play`，才会使用主项目的会员语音和磁盘缓存。

### 14.8 样式、请求和预览

入口第一行的 `import '@/styles.css'` 不要删。组件里需要浮层时用插件自己的 Tooltip、Dialog，它们会被主项目收进插件样式域。再包一层抽屉会和主项目的抽屉套在一起。

HTTP：

- 路径不写死后端域名，不带 `/api` 前缀，不自己加 token。未登录时接口 401，组件显示失败和重试。
- 列表用游标。不带 `cursor` 是第一页；`nextCursor` 为字符串就原样传回去；`null` 表示到底。用 ref 区分「还没请求」和「已经到底」，空列表不要把第一页再请求一遍。
- 失败时设 hold，等用户点重试再清掉，避免视口底部的哨兵连续打失败请求。
- 同一词正在请求时用 `Map` 复用这一次 Promise。关掉抽屉不要取消它。转圈跟着 `pending`，不跟着抽屉开关。
- `GET /english-learning/vocab-detail/list` 必须注册在 `GET /english-learning/vocab-detail` 之前，否则 `list` 会被当成单词。这是主项目路由的顺序，插件只负责把路径写对。

独立预览没有主项目注入的 `api`。在子项目自己的路由里用 `mockApi` 塞一份假的 `point`，让 `getContext` / `getPayload` 返回 14.2 里该插件要读的字段。`subscribe` 返回空的退订函数即可。单词解析的预览在 `src/router/routes.tsx` 的 `previewPoint`。预览能看出组件布局，看不出按钮、抽屉叠放和「未启用时不占位」，这三件要在主项目页面里看。

### 14.9 挂上去之后看不到

按这个顺序查，上一件没过就不用看下一件：

1. 插件 dev server 开着，浏览器能打开注册表里的 `entry`。
2. `expose` 和 `vite.config.ts` 的键一致，改完 exposes 后 dev server 已重新编译。
3. 注册表这条 `enabled` 在插件中心是打开的。文件里写 `true` 但中心没拉取，页面仍当它是关的。
4. `injectRoute` 是 `false`，并且没有 `menu`。侧栏多出来的入口说明 `menu` 还在。
5. `host.surface`、`host.slot` 和 14.2 表完全一致，大小写也一致。语句库不要用 `drawer`。
6. `permissions` 含 `modules:point`。改完权限后重新拉取注册表。控制台里这个插件的 `api.modules` 没有 `point`，就是这一条。
7. 动作槽插件：页面上应先出现图标按钮。组件在点开之后的抽屉里。顶栏插件：内容直接在顶栏，没有按钮。
8. 单词库 `drawer`：按钮在词库列表页的标题旁边，不在词库卡片上。卡片上那枚是 `library-card-action`。
9. 抽屉里是「缺少 modules:point」：权限或 surface 不对。抽屉里是「这一行没有 word」：这个页面的载荷用的是别的键，回到 14.2 对字段。
10. 控制台 `UNKNOWN_POINT_COMMAND`：这个 surface 没有该命令。词卡才能 `play`，词库才能 `openCard`。

同一词重复打开不应打出两发请求。关掉抽屉后，带 `word` 的按钮继续转，请求结束才停。

### 14.10 什么时候改主项目

挂到 14.2 已有的槽：只改子项目和注册表。不要在 `apps/frontend/src/federation/modules/` 下为这个插件新建目录，也不要在 `buildModules` 里加 `modules:<插件 id>`。

主项目要改的只有这些，改完插件仍用 `modules:point`：

1. 新的挂载位置。在 `apps/frontend/src/federation/points/catalog.ts` 给那个点加槽，或新增一个点，并在对应页面放上 `HostPoint`。动作槽要写 `opens: '某个抽屉槽'`，页面还要再放一个该抽屉槽的 `HostPoint`，否则按钮打开后没有地方挂组件。
2. 新的载荷字段或上下文字段。目录不负责字段。字段来自页面：上下文是 `usePointContext(pointId, data)`，点击载荷是 `<HostPoint payload={...} />`。插件读到的就是这里写进去的键。
3. 新的外壳状态。该点的 `signals` 加上名字，页面再订阅并画出来。插件才能 `publishSignal`。
4. 新的主项目动作，例如另一种朗读或另一种跳转。该点的 `commands` 加上名字。不依赖页面闭包的，在 `points/command.ts` 里 `bindPointCommand`；要路由或当前页状态的，在那个页面的 effect 里绑定并在卸载时解绑。插件再 `command`。

词库列表抽屉的标题带条数、从详解切过来时不播入场，这两件是单词库页面自己的。新插件挂到别的槽，用主项目统一的抽屉，不要再复制一套抽屉组件。

### 14.11 验收

- 插件中心未启用时，对应按钮或顶栏片段不出现，也不占空白。
- 启用后，图标和抽屉标题来自注册表的 `icon` 和 `title`。侧栏没有多出来的入口。
- 桥上能读到 `api.modules.point`。只声明了 `modules:vocabDetail` 的旧包读不到。
- 顶栏插件在页面打开时就能读到 `getContext()`，切换单词/语句页签或切换词库后内容跟着变。
- 按钮插件在远程包返回前打开，`getPayload` 里已经有这一行的字段。
- 再点同一枚按钮、同一个词或同一句，抽屉关闭。点另一行，抽屉换成那一行的内容。
- 单词库列表换词库会重载；只是开关导入抽屉或行抽屉、或回写 `stats` 时不重载。
- `openCard` 为 `true` 时词卡详解打开，列表抽屉还在。`vocabDetail` 未启用时得到 `false`，只提示，不打开空抽屉。
- 导入在详解打开时不把目标清掉。关掉详解后导入目标还在。
- 错题集插件不会出现在今日复习。两条注册表才会两页都有。
- 未登录时接口 401，插件显示失败和重试，不自己拼 token。
- 同一词重复打开不会打出两发请求。关掉抽屉后，带 `word` 的按钮继续转，请求结束后才停。
