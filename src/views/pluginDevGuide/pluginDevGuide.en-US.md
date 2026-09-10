Audience: frontend developers building React / Vue Module Federation remotes (plugins) and untrusted iframe remotes for this host.

Goal: scaffold the project, export exposes correctly, register in the Host registry, match standalone styling when embedded (Tooltip / Dialog / Teleport); multi-page remotes must expose a router shell with activate; third-party untrusted remotes use iframe + postMessage and must apply Host appearance snapshots (theme / accent).

References (micro-apps outside this monorepo):
- React multi-page: remote-react-shadcn (port 9010, in-memory NavigationProvider)
- Vue multi-page: remote-vue-shadcn (port 9009, vue-router WebHistory preview / MemoryHistory embed)
- iframe untrusted: micro-apps/remote-untrusted (port 9012; see chapter 10)
- Contracts: packages/federation-kit/docs/plugin-guide
- Host adapter: apps/frontend/src/federation (re-exports @dnhyxc-ai/federation-kit; appearance via capabilities/iframeAppearance.ts)

Updated: 2026-09-08

## 1. Architecture & loading

### 1.1 Roles

- Host (apps/frontend + @dnhyxc-ai/federation-kit): registry, registerRemotes, loadRemote, routes/sidebar, PluginHostPage, runtime @scope CSS isolation, Portal/Teleport retargeting.
- Remote: Vite + @module-federation/vite exposes; you own default export + HostBridge APIs allowed by permissions.
- Registry (plugins-registry.json): id / entry / expose / remoteName / framework / permissions / trust. Copy changes only need registry edits—not Host i18n keys.

### 1.2 Trust levels

- first-party / partner: MF embed; Host scopes CSS with @scope([data-mf-style-realm]); React createPortal + Vue Teleport(to body) are retargeted into [data-mf-portal-scope].
- untrusted: iframe + postMessage (sandbox); set iframeUrl (https in prod). Host sends init (with appearance snapshot) and hot-updates appearance / locale; RPC covers http / ui.* (see chapter 10).
Missing permissions ⇒ bridge fields undefined—always optional-chain.

### 1.3 MF load flow

1. PluginManager.init() fetches registry.
2. Routes/sidebar injected when injectRoute !== false.
3. ensurePlugin → one GET mf-manifest.json → bust version@manifestHash → remoteEntry.js?v=.
4. loadRemote → normalizePluginModule (pickPluginLifecycle: named export or default.activate).
   React default must be the shell for multi-page; Vue uses createVueHostBridge(mount).
5. Missing activate/deactivate → console.warn (non-blocking); else await activate(api).
6. PluginHostPage sets data-mf-plugin + data-mf-style-realm and attachPluginStyleIsolation.
7. Unload: deactivate + teardown isolation.

### 1.4 Suggested layout

One repo may expose many modules (see apps/micro).

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

## 2. Environment & scaffolding

### 2.1 Tooling

Node ≥ 20, pnpm ≥ 8. Use @module-federation/vite (not legacy @originjs/vite-plugin-federation). Typical ports: Host 9002, Vue remote 9009, React multi-page 9010.

### 2.2 .env

VITE_REMOTE_PUBLIC_ORIGIN must match registry entry origin and vite base.

```dotenv
# 与 Host registry entry 同源
# React 多页样例 remote-react-shadcn 常用 9010；Vue 多页样例 remote-vue-shadcn 常用 9009
VITE_REMOTE_PUBLIC_ORIGIN=http://127.0.0.1:9010

# React 插件：指向 Host 开发服，供 React Refresh
VITE_REACT_REFRESH_HOST=http://127.0.0.1:9002
```

### 2.3 React dependencies

Share React major with Host; shared singletons: react + react-dom only.

```bash
mkdir my-react-plugin && cd my-react-plugin
pnpm init

pnpm add react react-dom
pnpm add -D vite @vitejs/plugin-react @module-federation/vite \
  typescript @types/node @types/react @types/react-dom \
  tailwindcss @tailwindcss/vite
```

### 2.4 Vue dependencies

Host has no Vue. Remote owns vue + exports mount(el, bridge). No homemade React bridge.

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

## 3. React: Vite + Module Federation

### 3.1 Full vite.config.ts (React)

Must-haves: base; name/filename/manifest/exposes; react|react-dom singleton; hostInitInjectLocation: "entry"; optimizeDeps.exclude React; CORS; modulePreload: false. Do not share react-router.

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

### 3.2 React Vite checklist

- base ↔ registry entry
- name ↔ remoteName; expose path ↔ registry.expose
- Every expose file imports styles.css
- Start remote before opening the plugin in Host
- Invalid hook call ⇒ duplicate React

## 4. Vue: Vite + Module Federation

### 4.1 Full vite.config.ts (Vue)

plugin-vue; shared.vue only; expose an index.ts that re-exports App.vue.

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

### 4.2 Hard rules for Vue remotes

1. Registry MUST set "framework": "vue".
2. Export Vue default only—no required export const framework when registry has it.
3. Never build a React bridge inside the remote.
4. Root props: bridge: HostBridgeProps (reactive), not top-level {api, plugin}.
5. Do not custom-target Teleport containers; Host retargets body mounts.
6. Every expose imports "@/styles.css".

## 5. Implementing a React plugin

### 5.1 HostBridgeProps

No api.t. Maintain your own i18n; follow api.locale. Guard optional APIs.

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
    };
    modules?: Readonly<Record<string, (...args: unknown[]) => unknown>>;
  };
  plugin: { id: string; version: string; routePath: string };
};
```

### 5.2 Expose entry (must import styles)

Host loads only the expose module. Multi-page: default must be the shell App—not a leaf InfoPage.

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

### 5.3 Single-page App + static lifecycle

Hang activate/deactivate on App (do not export function activate—breaks Fast Refresh). Missing hooks → Host warns.

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

### 5.4 Standalone main.tsx

Render the same shell App. Host never runs this file.

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

### 5.5 Multi-page rules (remote-react-shadcn)

Host injects one routePath. Expose a NavigationProvider shell; leaves call useNavigation().navigate. activate must live on the shell App. See federation-kit plugin-guide ch.06 §5.

### 5.6 In-memory NavigationContext

Does not change the browser URL (stays on Host routePath).

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

### 5.7 Multi-page shell App.tsx

Provider + AppRouter; lifecycle on this function.

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

### 5.8 AppRouter

Switch child pages by internal path.

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

### 5.9 Leaf navigation

Use internal navigate only; never hang activate on a leaf.

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

### 5.10 Calling Host APIs safely

ui:toast (showToast / setAppFullscreen / downloadBlob / pickLocalFiles) / nav:subtree (must prefix routePath) / http:plugin-api / modules:* — check before use.

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

### 5.11 Lifecycle patterns

Prefer static props; optional named re-export from the expose entry.

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

## 6. Implementing a Vue plugin

### 6.1 How Host mounts Vue

normalizePluginModule → createVueHostBridge: React mounts a div, then Remote.mount(el, bridge). Remote createApp(App, { bridge: reactive(bridge) }).use(router).mount(el).

### 6.2 Types

Same HostBridgeProps; consume via props.bridge / useHostBridge().

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
    };
    modules?: Readonly<Record<string, (...args: unknown[]) => unknown>>;
  };
  plugin: { id: string; version: string; routePath: string };
};
```

### 6.3 Multi-page rules (remote-vue-shadcn)

mount the RouterView root App; preview = WebHistory, embed = MemoryHistory; share one routes table; activate receives api. See federation-kit plugin-guide ch.09 §5.

### 6.4 vue-router Web / Memory

Memory embed keeps Host URL on routePath.

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

### 6.5 useHostBridge

provide in App.vue; inject in leaves.

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

### 6.6 Root App.vue

provide bridge + RouterView.

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

### 6.7 Expose mount + lifecycle

Import styles; new Memory router per mount; hooks on default object.

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

### 6.8 Leaf router.push

Same API standalone and embedded.

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

### 6.9 Standalone main.ts

WebHistory + previewBridge; Host never runs this file.

```typescript
// src/main.ts —— 独立预览：WebHistory + 同一套 App / routes
import { createApp } from 'vue';
import App from './App.vue';
import { previewBridge } from './previewBridge';
import { router } from './router';
import './styles.css';

createApp(App, { bridge: previewBridge }).use(router).mount('#app');
```

### 6.10 Common Vue mistakes

- styles only in main.ts
- missing registry framework: "vue"
- WebHistory while embedded
- mount leaf without app.use(router)
- expecting top-level {api, plugin} props
- hand-written data-mf-* / portal containers

## 7. Styles, isolation & overlays

### 7.1 Host isolation (zero remote invasion)

Full Tailwind + Preflight is OK for first-party/partner. Host wraps injected CSS in @scope([data-mf-style-realm]). Do not rely on legacy "Tailwind prefix / disable Preflight" advice. Do not pass custom portal containers for MF.

### 7.2 CRITICAL: import styles in every expose

main.ts(x) CSS runs only in standalone preview. Expose-entry import runs when Host loads the remote. Multi-expose repos: import in each entry.

### 7.3 styles.css sample

Align tokens with Host or remote-*-shadcn styles.css.

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

### 7.4 Overlay acceptance

Tooltip/Dialog/ContextMenu/Sheet/Sonner keep utilities; nodes sit under [data-mf-portal-scope]; Host toaster stays fixed; do not invent data-mf-* in business UI.

## 8. Plugin i18n & Host locale

### 8.1 Rules

No api.t. Own dictionaries. MF: api.locale + event "locale". Standalone: ?lang= / local storage. iframe: init.locale + type:"locale"; appearance via type:"appearance" (ch.10). iframe api.event is a no-op. Isolate storage keys from Host.

### 8.2 useHostLocale (React)

Vue: watch bridge.api.locale + event.on("locale").

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

## 9. Permissions & registry fields

### 9.1 Permissions

ui:toast (showToast / setAppFullscreen / downloadBlob / pickLocalFiles), nav:subtree, http:plugin-api, modules:chat, modules:ebook — least privilege; null-check APIs.

### 9.2 React registry sample

No titleKey/descriptionKey/menu.nameKey. hostApiRange covers Host VITE_HOST_API_VERSION—not plugin version.

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

### 9.3 Vue registry (framework required)

Set framework: "vue". Align remoteName/expose with vite config.

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

### 9.4 Field cheat-sheet

id, remoteName, expose, framework, entry, routePath, injectRoute, menu, permissions, preload, trust, iframeUrl, host (ebook surfaces). Deploy new dist for cache bust—Host fingerprints mf-manifest.json.

### 9.5 untrusted iframe sample

trust + iframeUrl are required. entry is a placeholder for untrusted (no MF load). permissions still gate RPC. Full protocol & appearance sync: chapter 10.

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

## 10. iframe isolation (untrusted)

### 10.1 When iframe is mandatory

- Third-party / untrusted code: trust: "untrusted".
- Need browser-level isolation: separate JS/CSS document; cannot touch Host DOM.
- first-party / partner should NOT use iframe—use MF embed (Host @scope already isolates CSS).

Why not MF for untrusted? Dynamic import shares the Host realm; malware can touch document / cookies / storage. iframe + sandbox splits the execution context; capabilities only flow through postMessage RPC gated by permissions.

### 10.2 Architecture

Host PluginHostView sees trust===untrusted → UntrustedIframe(src=iframeUrl) → attachIframeBridge.
Your embed page: connectIframeHost(pluginId) → ready → init (theme/locale/plugin/appearance) → buildBridge → render App.
Then: Host locale pushes locale; theme/accent pushes appearance; business calls http/ui via rpc → rpc-result.
Default channel: dnhyxc-mf-iframe (must match Host createFederation({ iframeChannel })).

### 10.3 How Host mounts the iframe (lifecycle)

Do not copy this into the remote—but understand why effect deps are only [src], why about:blank on unload, and why the wrapper paints --theme-background (avoids flash / freeze / handshake storms).

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

### 10.4 Protocol (6 message types)

| msg | direction | payload | when |
| --- | --- | --- | --- |
| ready | iframe→Host | `{ channel, type, pluginId }` | poll until handshake |
| init | Host→iframe | `{ channel, type, theme, locale, plugin, appearance? }` | ready / load / 120ms kick |
| locale | Host→iframe | `{ channel, type, locale }` | Host language change |
| appearance | Host→iframe | `{ channel, type, appearance }` | theme/accent change (fingerprint dedupe) |
| rpc | iframe→Host | `{ channel, type, id, method, args }` | restricted capability call |
| rpc-result | Host→iframe | `{ channel, type, id, ok, value\|error }` | RPC done |

Built-in RPC: http.get/post/put/delete; ui.showToast; ui.downloadBlob; ui.pickLocalFiles. Extra methods via Host iframeRpcHandlers (e.g. ebook.*).

ready is acked once (readyAcked); load may send init without consuming the ready slot.

### 10.5 HostIframeAppearance: why a snapshot, not a theme string

Defined in remote-untrusted `src/utils/applyHostAppearance.ts` (aligned with federation-kit).
theme alone is not enough—accent/surface tokens will not follow Host. Host often uses theme-black without .dark; forcing .dark trips dark:border-*.
darkClass falls back to theme==="dark" when omitted (old Hosts); only add .dark when Host truly has it.

```typescript
export type HostIframeAppearance = {
	theme: 'light' | 'dark';
	cssVars: Record<string, string>;
	/** 与 Host 一致；缺省时回退为 theme==='dark'（旧协议） */
	darkClass?: boolean;
};
```

### 10.6 applyHostAppearance (full file from remote-untrusted)

Path: `src/utils/applyHostAppearance.ts`.
Fingerprint dedupe (same appearance → return false, still revealEmbedChrome); reject unresolved var() in cssVars; whitelist HOST_SYNC_VAR_RE; pin tokens via <style id="dnhyxc-host-chrome"> !important; toggle .dark from darkClass; clear embed-pending to avoid white flash.

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

### 10.7 iframeHostClient (full file from remote-untrusted)

Path: `src/utils/iframeHostClient.ts`.
channel dnhyxc-mf-iframe; ready polling + AbortSignal; ConnectedBridge with onAppearanceChange/disconnect; call appearance handler only when applyHostAppearance returns true; event/navigate no-op; ui.showToast via RPC; re-exports applyHostAppearance / HostIframeAppearance.

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

### 10.8 Dual-mode App entry (full file from remote-untrusted)

Path: `src/App.tsx`. iframeUrl can point at the app root (e.g. http://127.0.0.1:9012/); detect embed with window.parent !== window.
Embedded: AbortController + connectIframeHost; abort/disconnect on unmount; transparent placeholder before handshake; do not wrap another .dark.
Standalone: skip handshake, in-memory preview. pluginId must equal registry.id (untrustedDemo).

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

### 10.9 Entry & iframeUrl (no separate /embed route required)

remote-untrusted uses a single entry: main mounts App; Host registry.iframeUrl points at the root URL. A dedicated /embed/... page is optional—not what this sample does.

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

### 10.10 Registry (untrusted, matches remote-untrusted)

- trust: "untrusted" + iframeUrl required; prod iframeUrl must be https.
- entry may be a placeholder (no loadRemote).
- permissions gate RPC; sample minimum is ui:toast.
- id / pluginId = untrustedDemo; dev port 9012.

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

### 10.11 Pitfalls

- channel mismatch → never receives init.
- ignore appearance / skip applyHostAppearance → accent drift; theme-black borders break.
- add .dark when theme===dark (ignore Host darkClass) → outline borders vanish.
- rely on api.event for locale/theme → no-op in iframe.
- pluginId ≠ registry.id → ready dropped.
- missing AbortSignal / disconnect → Strict Mode leaks ready polling.
- wrong DevTools context → missing embed logs.

### 10.12 iframe acceptance

□ iframeUrl reachable (sample: http://127.0.0.1:9012/)
□ handshake ok (ready/init visible)
□ init.appearance applied; Host accent/theme changes sync
□ outline borders visible under theme-black (no bogus .dark)
□ ui.showToast works with ui:toast
□ fast route switches do not freeze; unmount clears intervals
□ Tab reaches iframe inputs

## 11. Preview, deploy & debug

### 11.1 Local order

[MF] Start remote → start Host → open plugin route. Expect one mf-manifest.json + remoteEntry.js?v=.

[iframe] Start remote-untrusted (http://127.0.0.1:9012/) → registry trust=untrusted + iframeUrl root + id=untrustedDemo → open Host route; pick iframe DevTools context for handshake & appearance.

### 11.2 Build & hosting

pnpm build; enable CORS; prefer no-store with Host bust. Prod iframeUrl must be https.

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

### 11.3 Debug tips

Duplicate React; CORS; missing expose on deployed build; CSS not on expose; Vue missing framework; locale not wired (MF: useHostLocale; iframe: type:"locale"); iframe theme/accent drift (applyHostAppearance + appearance listener); React leaf expose without Provider; Vue WebHistory while embedded; activate not on expose default.

## 12. Acceptance checklist

### 12.1 Before ship

[Build] MF vite plugin; manifest; entry inject; correct shared singletons; styles on every expose.
[Component] default export; React {api,plugin} / Vue props.bridge+mount; data-plugin-root; activate on shell; multi-page shell (React NavigationProvider / Vue MemoryHistory).
[Registry] locale maps; hostApiRange; Vue framework; minimal permissions; trust/iframeUrl match.
[iframe] dual-mode App + connectIframeHost(AbortSignal); applyHostAppearance; matching channel; theme-black borders OK.
[UX] overlays match standalone; in-plugin navigation works; activate visible or intentional warn; Host toaster intact; fullscreen paired if used.

## 13. FAQ

### 13.1 Fine standalone, broken overlays in Host?

Import "@/styles.css" from the expose entry first; then verify portal-scope + style-realm.

### 13.2 Vue blank / treated as React?

registry "framework": "vue"; export mount(el, bridge); Host has no vue package.

### 13.3 Styles leak into Host?

Host @scope should contain remote CSS. Check bypass injectors / wrong trust. Do not rely on legacy prefix/Preflight hacks.

### 13.4 backdrop-filter only broken when embedded?

Host shell overflow on the same node as border-radius—see PluginPageShell / Layout guidance.

### 13.5 Host still shows old bundle?

Deploy new dist; Host busts via remote mf-manifest fingerprint—no need to bump registry updatedAt just for cache.

### 13.6 React: detail click does nothing?

You likely exposed a leaf InfoPage without NavigationProvider. Expose the shell App (sections 5.5–5.9).

### 13.7 Vue: navigating detail breaks Host URL?

Embedded remotes must use createMemoryHistory (createHostRouter), not WebHistory (sections 6.3–6.4).

### 13.8 activate missing / console warn?

Hooks must sit on the expose default (App.activate or { mount, activate }). Leaf hooks are ignored. Force reload: pluginManager.ensurePlugin(id, { force: true }).

### 13.9 iframe accent / dark borders not following Host?

Handle init.appearance and type:"appearance" with applyHostAppearance. Do not force .dark when theme===dark—follow darkClass. See §10.5–10.7.

### 13.10 iframe stuck connecting / handshake timeout?

Check channel (dnhyxc-mf-iframe), pluginId===registry.id, iframeUrl reachable and origin matches; pick the iframe DevTools context and confirm ready is posting.
