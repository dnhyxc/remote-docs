# MF 插件语言同步与远程插件 i18n 完整接入

## 1. 背景与目标

Module Federation（MF）远程插件运行在独立的 `remote-plugins` 子应用（开发端口 `:9008`）中，通过 Host（`apps/frontend`）的 `PluginHostPage` 加载。改动前，Host 通过 `HostBridgeProps.api.t` 把一个「原样返回 key」的占位函数注入给插件，既不真正翻译，也无法在运行时跟随 Host 顶栏语言切换；远程插件内部所有可见文案都是写死的中文，无法切英文。

本轮改动把语言同步做成「Host 推 locale、插件自管字典」的模型：

- **Host 侧**：把 `api.t` 替换为 `api.locale: HostLocale`（`'zh-CN' | 'en-US'`），并在三个层面向插件广播当前语言——`createHostBridge` 初始快照、`attachIframeBridge` 通过 `postMessage` 推送给 untrusted iframe、`PluginHostPage` 通过 `eventBus` 推送给已激活的 trusted 插件。
- **Remote 侧**：`iframeHostClient` 在收到 init 消息和后续 `locale` 消息时调用 `applyHostLocale` 同步到自身 i18n 实例；所有视图与组件改用 `useI18n` 钩子，`learningNotes` store 通过 `bind(http, toast, t)` 注入翻译函数，`RichEditor` 暴露 `richEditorLocaleOf()` 让笔记页能切换富文本编辑器内置文案。

目标：Host 顶栏切语言时，远程插件内的导航、按钮、Toast 文案、富文本编辑器工具栏同步切换，且对 untrusted iframe 也生效。

## 2. 改动范围

**Host 侧（apps/frontend/）**

- `src/plugins/core/types.ts` — 新增 `HostLocale` 类型；`api.t` → `api.locale`。
- `src/plugins/core/createHostBridge.ts` — 新增 `readLocale()`；bridge `api` 暴露 `locale`。
- `src/plugins/core/attachIframeBridge.ts` — init 消息携带 `locale`；新增 `pushLocale()` 与 `onListen('locale')`；清理时反注册监听。
- `src/plugins/host/PluginHostPage.tsx` — 新增 `withLiveLocale()`、`useI18n`、`eventBus.emit('locale')`、`className` 透传，所有硬编码中文改 `t(...)`。
- `src/plugins/host/PluginErrorBoundary.tsx` — 抽出 `PluginErrorFallback` 函数组件，用 `useI18n`。
- `src/i18n/locales/zh-CN.ts` / `en-US.ts` — 新增 `plugins.host.*` 文案。
- `src/views/englishLearning/notes/index.tsx` — `className="p-0"` 透传给 `PluginHostPage`。

**Remote 侧（apps/remote-plugins/）**

- `src/utils/iframeHostClient.ts` — `HostBridgeProps.api.locale`；init 与 `locale` 消息触发 `applyHostLocale`。
- `src/utils/mockHost.ts` — 删除 mock `t`。
- `src/layout/index.tsx` — 导航与品牌名走 `useI18n`；新增语言切换按钮。
- `src/views/home/index.tsx`、`src/views/embed/index.tsx` — 全量 i18n。
- `src/views/ebook-ideas/index.tsx`、`src/views/learning-notes/index.tsx` — i18n + `useHostLocale` + `richEditorLocaleOf`。
- `src/views/learning-notes/api.ts` — `translateSync` 兜底「无标题笔记」。
- `src/store/learningNotes.ts` — `bind(http, toast, t)` 注入；`errMsg` 与所有 Toast 文案改 `t(...)`。
- `src/components/design/Confirm/index.tsx`、`NotePreview/index.tsx` — i18n。
- `src/components/design/RichEditor/index.tsx` + `locale.ts` + `title/Title.tsx` — `mergeLocale` 合并基础文案、导出 `richEditorLocaleOf`。
- `src/components/design/index.ts` — 导出 `enUS`、`richEditorLocaleOf`。

## 3. 实现思路

1. **以 locale 取代 t**：旧 `api.t` 是占位函数（`(k) => k`），插件拿不到真实翻译；改为只下发 locale 字符串，由插件在自己 i18n 实例里查字典。Host 不再为插件维护翻译表，职责清晰。
2. **三路同步**：
   - **trusted 插件**（同源、直接 `import` 的 `mod.default`）：`PluginHostPage` 用 `withLiveLocale(bridge, locale)` 重新生成 `api.locale` 快照注入组件，配合 `useI18n` 让插件重渲染。
   - **trusted 已激活插件**：额外 `eventBus.emit(pluginId, 'locale', locale)`，让插件内部能监听到「自身没重渲染但有别处需要同步」的边角场景。
   - **untrusted iframe**：iframe 不能直接读 Host 内存，必须走 `postMessage`。`attachIframeBridge` 在 init 消息带 `locale`，并 `onListen('locale')` 在 Host 切语言时 `pushLocale` 给 iframe。
3. **iframe 协议扩展**：`attachIframeBridge` 与 `iframeHostClient` 之间新增 `type: 'locale'` 消息类型；`init` 消息多带一个 `locale` 字段。`iframeHostClient` 收到任一消息都调用 `applyHostLocale(locale)` 同步到自身 i18n 实例，所有 `useI18n` 订阅者自动重渲染。
4. **store 注入 t**：`learningNotes` 是 MobX 单例，不能在内部直接 `useI18n`（hook 只能在组件里用），所以由页面在 `bind(http, toast, t)` 时把 `t` 函数注入；store 默认值 `translateSync`（同步查字典）保证单测与未 bind 场景不崩。
5. **错误兜底**：`errMsg(e, t)` 兜底文案从硬编码「请求失败」改为 `t('common.requestFailed')`；`saveNote` 里「无标题笔记」走 `t('common.untitledNote')`。
6. **错误边界 i18n**：`PluginErrorBoundary` 是 class 组件不能直接 `useI18n`，抽出一个 `PluginErrorFallback` 函数组件包住 `useI18n`，class 的 `render` 里调用它。
7. **不破坏旧 API**：`HostBridgeProps.api.t` 字段被删除，是**破坏性变更**——但消费方只有 `remote-plugins` 自身，同轮全量替换，没有外部第三方插件消费此字段，因此不保留兼容层。

## 4. 关键代码对比与注释

### 4.1 `HostBridgeProps` 接口（apps/frontend/src/plugins/core/types.ts）

**对比范围**：`HostLocale` 类型别名 + `HostBridgeProps` 接口声明（`api` 字段块）。

**改动前** · `apps/frontend/src/plugins/core/types.ts`（基线，约 L57–L75）

```typescript
// 旧版没有独立的 locale 类型别名，Host 语言只通过 t 函数隐式传递
export interface HostBridgeProps {
	// api 是只读的能力集合，旧版包含一个占位用的 t 翻译函数
	api: Readonly<{
		// 旧版 t 函数：接受 key 与可选 params，返回字符串；Host 端实现为 (key) => key，原样返回
		t: (key: string, params?: Record<string, unknown>) => string;
		// 主题字段，与 Host html data-theme 保持一致
		theme: 'light' | 'dark';
		// 可选的 Host 路由跳转函数，由 PluginHostPage 注入
		navigate?: (to: string) => void;
		// 事件总线接口：on/off/emit 三件套
		event: {
			// 注册某事件监听
			on: (event: string, handler: (data?: unknown) => void) => void;
			// 注销某事件监听
			off: (event: string, handler: (data?: unknown) => void) => void;
			// 派发某事件
			emit: (event: string, data?: unknown) => void;
		};
		// http 子能力按 permissions 授权后才挂载（摘录省略）
		http?: { /* ... */ };
		// ui 子能力（toast 等），同上按需挂载（摘录省略）
		ui?: { /* ... */ };
		// 模块能力集合，例如 ebook 子模块（摘录省略）
		modules?: Readonly<Record<string, (...args: unknown[]) => unknown>>;
	}>;
	// ...（plugin 字段未改动，省略）
}
```

**改动后** · `apps/frontend/src/plugins/core/types.ts`（当前，约 L60–L89）

```typescript
// 新增 HostLocale 类型别名，限定 Host 支持的两种语言
export type HostLocale = 'zh-CN' | 'en-US';

// HostBridgeProps 接口声明，api 字段中 t 被替换为 locale
export interface HostBridgeProps {
	// api 仍是只读能力集合，但字段语义从「函数注入」改为「状态注入」
	api: Readonly<{
		// 主题字段（与旧版一致）
		theme: 'light' | 'dark';
		/**
		 * 与 Host 顶栏语言一致；插件自维护文案字典，仅跟随此 locale。
		 * 切换后由 PluginHostPage / iframe / eventBus 推送更新。
		 */
		// 新增 locale 字段：插件只接收语言标识，自行查字典
		locale: HostLocale;
		// 可选的 Host 路由跳转函数（与旧版一致）
		navigate?: (to: string) => void;
		// 事件总线接口，三件套不变
		event: {
			// 注册某事件监听
			on: (event: string, handler: (data?: unknown) => void) => void;
			// 注销某事件监听
			off: (event: string, handler: (data?: unknown) => void) => void;
			// 派发某事件
			emit: (event: string, data?: unknown) => void;
		};
		// http 子能力按权限挂载（摘录省略，未改动）
		http?: {
			// GET 请求
			get: <T = unknown>(url: string) => Promise<T>;
			// POST 请求
			post: <T = unknown>(url: string, body?: unknown) => Promise<T>;
			// PUT 请求
			put: <T = unknown>(url: string, body?: unknown) => Promise<T>;
			// DELETE 请求
			delete: <T = unknown>(url: string) => Promise<T>;
		};
		// ui 子能力（toast），未改动
		ui?: {
			// showToast 接收 message 与可选 type
			showToast: (options: {
				// toast 文案
				message: string;
				// toast 类型
				type?: 'success' | 'error' | 'info';
			}) => void;
		};
		// 模块能力集合，未改动
		modules?: Readonly<Record<string, (...args: unknown[]) => unknown>>;
	}>;
	// ...（plugin 字段未改动，省略）
}
```

**变更摘要**：删除 `api.t`，新增 `HostLocale` 类型与 `api.locale` 字段；语义从「Host 注入翻译函数」改为「Host 注入语言标识、插件自管字典」。

### 4.2 `createHostBridge` 函数（apps/frontend/src/plugins/core/createHostBridge.ts）

**对比范围**：`readLocale` 工具函数 + `createHostBridge` 中 `api` 对象的 `theme`/`t`/`locale` 字段组装。

**改动前** · `apps/frontend/src/plugins/core/createHostBridge.ts`（基线，约 L9–L48）

```typescript
// 旧版只有 readTheme，没有 readLocale
function readTheme(): 'light' | 'dark' {
	// 从 html data-theme 读取主题
	try {
		// 取 html 元素的 data-theme 属性
		const t = document.documentElement.getAttribute('data-theme');
		// 命中 dark 或 light 直接返回
		if (t === 'dark' || t === 'light') return t;
		// 兼容 html.dark 类名
		if (document.documentElement.classList.contains('dark')) return 'dark';
		// Host 黑色主题挂在 body.theme-black（不是 html.dark）
		if (
			// body 同时支持 dark 与 theme-black 两种类名
			document.body.classList.contains('dark') ||
			document.body.classList.contains('theme-black')
		) {
			// 命中任一即返回 dark
			return 'dark';
		}
	} catch {
		/* ignore */
	}
	// 兜底返回 light
	return 'light';
}

// 按 permissions 组装并密封；未授权能力不存在
export function createHostBridge(
	// 插件描述符，含 id/version/permissions 等
	d: PluginDescriptor,
	// Host 路由跳转函数
	navigate: (to: string) => void,
// 返回值类型为 HostBridgeProps
): HostBridgeProps {
	// 把 permissions 数组转 Set 加速 includes 判断
	const allow = new Set(d.permissions);
	// api 是一个可变 Record，先按需挂字段再 deepFreeze
	const api: Record<string, unknown> = {
		// 旧版：t 是占位函数，原样返回 key，不做翻译
		t: (key: string) => key,
		// 主题走 readTheme 快照
		theme: readTheme(),
		// 事件总线：on/off/emit 都桥接到 eventBus（以插件 id 为命名空间）
		event: {
			// on 转发到 eventBus.on
			on: (event: string, handler: (data?: unknown) => void) =>
				eventBus.on(d.id, event, handler),
			// off 转发到 eventBus.off
			off: (event: string, handler: (data?: unknown) => void) =>
				eventBus.off(d.id, event, handler),
			// emit 转发到 eventBus.emit
			emit: (event: string, data?: unknown) => eventBus.emit(d.id, event, data),
		},
	};
	// ...（permissions 授权挂载 ui/http/modules，未改动）
}
```

**改动后** · `apps/frontend/src/plugins/core/createHostBridge.ts`（当前，约 L1–L48）

```typescript
// 从 @/i18n 引入 getActiveLocale 与 Locale 类型
import { getActiveLocale, type Locale } from '@/i18n';
// 从 @ui/sonner 引入 Toast（旧版也有，未改动）
import { Toast } from '@ui/sonner';
// 从 @/utils/fetch 引入 http（未改动）
import { http } from '@/utils/fetch';
// 从 host-api/deepFreeze 引入 deepFreeze（未改动）
import { deepFreeze } from '../host-api/deepFreeze';
// 从 host-api/EventBus 引入 eventBus 单例（未改动）
import { eventBus } from '../host-api/EventBus';
// 从 host-api/ebookHostApi 引入 ebook 模块工厂（未改动）
import { createEbookModulesApi } from '../host-api/ebookHostApi';
// 从 ./types 引入 HostBridgeProps 与 PluginDescriptor 类型
import type { HostBridgeProps, PluginDescriptor } from './types';

// readTheme 与旧版完全一致，未改动
function readTheme(): 'light' | 'dark' {
	// 从 html data-theme 读取
	try {
		// 取 html 元素的 data-theme 属性
		const t = document.documentElement.getAttribute('data-theme');
		// 命中 dark/light 直接返回
		if (t === 'dark' || t === 'light') return t;
		// 兼容 html.dark
		if (document.documentElement.classList.contains('dark')) return 'dark';
		// Host 黑色主题挂在 body.theme-black（不是 html.dark）
		if (
			// body 两种类名都视为 dark
			document.body.classList.contains('dark') ||
			document.body.classList.contains('theme-black')
		) {
			// 返回 dark
			return 'dark';
		}
	} catch {
		/* ignore */
	}
	// 兜底 light
	return 'light';
}

// 新增 readLocale：读取 Host 当前 i18n 语言并归一化为 'zh-CN' | 'en-US'
function readLocale(): Locale {
	// 从 i18n 实例读当前 active locale
	const locale = getActiveLocale();
	// 仅当明确为 en-US 才返回 en-US，其余一律兜底为 zh-CN
	return locale === 'en-US' ? 'en-US' : 'zh-CN';
}

// 按 permissions 组装并密封；未授权能力不存在
export function createHostBridge(
	// 插件描述符
	d: PluginDescriptor,
	// Host 路由跳转函数
	navigate: (to: string) => void,
// 返回值类型 HostBridgeProps
): HostBridgeProps {
	// permissions 转 Set
	const allow = new Set(d.permissions);
	// api 可变 Record，先组装再 deepFreeze
	const api: Record<string, unknown> = {
		// 主题快照（与旧版一致）
		theme: readTheme(),
		// 新增：locale 快照，bridge 创建时刻的 Host 语言
		locale: readLocale(),
		// 事件总线桥接（与旧版一致）
		event: {
			// on 转发
			on: (event: string, handler: (data?: unknown) => void) =>
				eventBus.on(d.id, event, handler),
			// off 转发
			off: (event: string, handler: (data?: unknown) => void) =>
				eventBus.off(d.id, event, handler),
			// emit 转发
			emit: (event: string, data?: unknown) => eventBus.emit(d.id, event, data),
		},
	};
	// ...（ui/http/modules 授权挂载未改动）
}
```

**变更摘要**：新增 `readLocale()` 工具函数；`api` 中删除 `t` 字段，新增 `locale: readLocale()`。

### 4.3 `attachIframeBridge` — `sendInit` 与 locale 推送（apps/frontend/src/plugins/core/attachIframeBridge.ts）

**对比范围**：`sendInit` 函数 + 新增的 `pushLocale`/`onListen('locale')` 注册 + 末尾 cleanup 闭包。

**改动前** · `apps/frontend/src/plugins/core/attachIframeBridge.ts`（基线，`sendInit` 约原实现 + 末尾 return）

```typescript
// 旧版 sendInit：只推送 theme 与 plugin，不包含 locale
const sendInit = () => {
	// 取 iframe 的 contentWindow
	const w = win();
	// iframe 已销毁时直接返回
	if (!w) return;
	// 向 iframe 发送 init 消息
	w.postMessage(
		{
			// 频道标识，与 remote 侧 MF_IFRAME_CHANNEL 对齐
			channel: MF_IFRAME_CHANNEL,
			// 消息类型为 init
			type: 'init',
			// 当前 Host 主题快照
			theme: bridge.api.theme,
			// 旧版没有 locale 字段
			plugin: bridge.plugin,
		},
		// targetOrigin 限制只有该 origin 能收到
		targetOrigin,
	);
};

// ...（中间 onMessage 与 rpc 分发未改动）

// 旧版 cleanup：只反注册 message 与 load 监听，没有 locale 反注册
return () => {
	// 反注册 window message 监听
	window.removeEventListener('message', onMessage);
	// 反注册 iframe load 监听
	iframe.removeEventListener('load', onLoad);
};
```

**改动后** · `apps/frontend/src/plugins/core/attachIframeBridge.ts`（当前，`sendInit` L89–L102、`pushLocale`/`onListen` L104–L122、cleanup L178–L182）

```typescript
// 顶部新增 import：getActiveLocale 与 Locale 类型
import { getActiveLocale, type Locale } from '@/i18n';
// 顶部新增 import：onListen 工具
import { onListen } from '@/utils';
// 引入 HostBridgeProps 类型
import type { HostBridgeProps } from './types';

// 频道常量
export const MF_IFRAME_CHANNEL = 'dnhyxc-mf-iframe';

// ...（isRecord / dispatchRpc 未改动，省略）

// sendInit：iframe 加载完成 / 收到 ready 时调用，把 Host 当前能力一次性下发
const sendInit = () => {
	// 取 iframe 的 contentWindow
	const w = win();
	// iframe 销毁时跳过
	if (!w) return;
	// 向 iframe 发送 init 消息，新增 locale 字段
	w.postMessage(
		{
			// 频道标识
			channel: MF_IFRAME_CHANNEL,
			// 消息类型 init
			type: 'init',
			// 主题快照
			theme: bridge.api.theme,
			// 新增：直接读 getActiveLocale() 而非 bridge.api.locale，确保拿到最新值
			locale: getActiveLocale(),
			// 插件元信息
			plugin: bridge.plugin,
		},
		// targetOrigin 限制
		targetOrigin,
	);
};

// 新增 pushLocale：Host 切语言时主动给 iframe 推一条 locale 消息
const pushLocale = (locale: Locale) => {
	// 取 iframe contentWindow
	const w = win();
	// iframe 已销毁则跳过
	if (!w) return;
	// 发送 type: 'locale' 消息，iframe 收到后调 applyHostLocale
	w.postMessage(
		{
			// 频道标识
			channel: MF_IFRAME_CHANNEL,
			// 消息类型为 locale（区别于 init）
			type: 'locale',
			// 当前最新 locale
			locale,
		},
		// targetOrigin 限制
		targetOrigin,
	);
};

// unlistenLocale 占位，onListen 的 Promise resolve 后填充
let unlistenLocale: (() => void) | undefined;
// 订阅 Host 全局 'locale' 事件：Host 顶栏切语言时会触发
void onListen<Locale>('locale', (next) => {
	// 仅当 next 是合法 Locale 时才推送
	if (next === 'zh-CN' || next === 'en-US') pushLocale(next);
// then 中拿到反注册函数
}).then((fn) => {
	// 暂存到 unlistenLocale，cleanup 时调用
	unlistenLocale = fn;
});

// ...（onMessage / onLoad 中间逻辑未改动，省略）

// cleanup：返回给调用方的反注册闭包
return () => {
	// 反注册 message 监听
	window.removeEventListener('message', onMessage);
	// 反注册 iframe load 监听
	iframe.removeEventListener('load', onLoad);
	// 新增：反注册 onListen('locale')，避免内存泄漏
	unlistenLocale?.();
};
```

**变更摘要**：`sendInit` 消息体新增 `locale` 字段；新增 `pushLocale()` 与 `onListen('locale')` 订阅；cleanup 多调一次 `unlistenLocale?.()`。

### 4.4 `PluginHostPage` 组件（apps/frontend/src/plugins/host/PluginHostPage.tsx）

**对比范围**：顶层 `withLiveLocale` 工具函数 + `UntrustedIframe` + `PluginHostPage` 主体（含 i18n 与 eventBus 推送）。

**改动前** · `apps/frontend/src/plugins/host/PluginHostPage.tsx`（基线，全文件）

```typescript
// 旧版 import：未引入 useI18n / eventBus / HostLocale / cn
import { useEffect, useRef, useState } from 'react';
// Loading 组件
import Loading from '@/components/design/Loading';
// Button 组件
import { Button } from '@/components/ui';
// attachIframeBridge
import { attachIframeBridge } from '../core/attachIframeBridge';
// pluginManager 单例
import { pluginManager } from '../core/PluginManager';
// HostBridgeProps 类型
import type { HostBridgeProps } from '../core/types';
// 错误边界
import { PluginErrorBoundary } from './PluginErrorBoundary';
// 样式隔离
import { attachPluginStyleIsolation } from './styleIsolation';

// Props 旧版只有 pluginId，没有 className
type Props = { pluginId: string };

// 旧版没有 withLiveLocale 工具函数

// UntrustedIframe 组件：包 iframe 标签
function UntrustedIframe({ pluginId, src, bridge }: { pluginId: string; src: string; bridge: HostBridgeProps; }) {
	// iframe ref
	const iframeRef = useRef<HTMLIFrameElement>(null);
	// useEffect 中调 attachIframeBridge
	useEffect(() => {
		// 取 iframe 元素
		const el = iframeRef.current;
		// 元素不存在则跳过
		if (!el) return;
		// 解析 src 的 origin
		let origin: string;
		try { origin = new URL(src).origin; } catch { return; }
		// 调 attachIframeBridge 挂载，返回 cleanup
		return attachIframeBridge(el, bridge, origin);
	// deps 含 src 与 bridge
	}, [src, bridge]);
	// 渲染 iframe
	return (
		// iframe 标签
		<iframe ref={iframeRef} title={pluginId} src={src}
			// 全高全宽无边框
			className="h-full w-full border-0" data-mf-plugin={pluginId} data-mf-trust="untrusted"
			// sandbox 限制
			sandbox="allow-scripts allow-same-origin allow-forms allow-popups" />
	);
}

// PluginHostPage 主组件
export function PluginHostPage({ pluginId }: Props) {
	// 重试 key
	const [retryKey, setRetryKey] = useState(0);
	// busy 状态
	const [busy, setBusy] = useState(() => pluginManager.get(pluginId)?.status === 'loading');
	// error 状态（摘录省略初始逻辑）
	const [error, setError] = useState<string | null>(() => { /* ... */ });
	// 强制刷新计数器
	const [, bump] = useState(0);
	// 加载插件 effect（摘录省略）
	useEffect(() => { /* ... */ }, [pluginId, retryKey]);
	// 取已加载插件
	const loaded = pluginManager.get(pluginId);
	// ...（status checks 摘录省略）
	// 已激活分支
	if (loaded?.status === 'activated') {
		// untrusted 分支
		if (loaded.meta.trust === 'untrusted') {
			// 旧版：硬编码中文「插件「{pluginId}」为 untrusted，但缺少 iframeUrl」
			// ...（iframeUrl 缺失提示，硬编码中文）
			// 渲染 UntrustedIframe
			// ...
		}
		// trusted 分支：取默认导出组件
		const Comp = loaded.mod.default;
		// 渲染错误边界 + 插件根 div
		return (
			// 错误边界包裹
			<PluginErrorBoundary pluginId={pluginId}>
				{/* 插件根 div，类名 plugin-${pluginId} */}
				<div className={`plugin-${pluginId} h-full w-full`} data-mf-plugin={pluginId} data-plugin-root>
					{/* 把 bridge 作为 props 注入 */}
					<Comp {...loaded.bridge} />
				</div>
			</PluginErrorBoundary>
		);
	}
	// ...（loading/error UI 摘录省略，含硬编码中文文案）
}
```

**改动后** · `apps/frontend/src/plugins/host/PluginHostPage.tsx`（当前，全文件）

```typescript
// React hooks
import { useEffect, useMemo, useRef, useState } from 'react';
// Loading 组件
import Loading from '@/components/design/Loading';
// Button 组件
import { Button } from '@/components/ui';
// 新增：useI18n 钩子
import { useI18n } from '@/hooks';
// attachIframeBridge
import { attachIframeBridge } from '../core/attachIframeBridge';
// pluginManager 单例
import { pluginManager } from '../core/PluginManager';
// 新增：HostLocale 类型
import type { HostBridgeProps, HostLocale } from '../core/types';
// 新增：eventBus 单例
import { eventBus } from '../host-api/EventBus';
// 错误边界
import { PluginErrorBoundary } from './PluginErrorBoundary';
// 样式隔离
import { attachPluginStyleIsolation } from './styleIsolation';
// 新增：cn 类名合并工具
import { cn } from '@/lib/utils';

// Props 新增可选 className
type Props = { pluginId: string; className?: string };

// 新增 withLiveLocale：用 Host 当前语言覆盖 bridge 快照；插件自维护 t，只同步 locale
function withLiveLocale(
	// 原 bridge 快照
	bridge: HostBridgeProps,
	// 当前 Host 语言
	locale: HostLocale,
// 返回新的 bridge（api.locale 被覆盖）
): HostBridgeProps {
	// 浅拷贝 bridge，覆盖 api
	return {
		// 保留其余字段
		...bridge,
		// api 也是浅拷贝
		api: {
			// 保留其余 api 字段
			...bridge.api,
			// 覆盖 locale
			locale,
		},
	};
}

// UntrustedIframe 组件（与旧版逻辑一致，结构化重排）
function UntrustedIframe({
	// 插件 id
	pluginId,
	// iframe src
	src,
	// bridge
	bridge,
}: {
	// 参数类型
	pluginId: string;
	// src 类型
	src: string;
	// bridge 类型
	bridge: HostBridgeProps;
}) {
	// iframe ref
	const iframeRef = useRef<HTMLIFrameElement>(null);

	// useEffect 挂载 attachIframeBridge
	useEffect(() => {
		// 取 iframe 元素
		const el = iframeRef.current;
		// 元素不存在则跳过
		if (!el) return;
		// 解析 src 的 origin
		let origin: string;
		try {
			// new URL 解析
			origin = new URL(src).origin;
		} catch {
			// 解析失败直接返回
			return;
		}
		// 调 attachIframeBridge
		return attachIframeBridge(el, bridge, origin);
	// deps
	}, [src, bridge]);

	// 渲染 iframe
	return (
		// iframe 标签
		<iframe
			// ref
			ref={iframeRef}
			// title
			title={pluginId}
			// src
			src={src}
			// 类名
			className="h-full w-full border-0"
			// 自定义属性
			data-mf-plugin={pluginId}
			// 信任级别标记
			data-mf-trust="untrusted"
			// sandbox 限制
			sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
		/>
	);
}

// PluginHostPage 主组件
export function PluginHostPage({ pluginId, className }: Props) {
	// 新增：从 useI18n 取 locale 与 t
	const { locale, t } = useI18n();
	// 重试 key
	const [retryKey, setRetryKey] = useState(0);
	// busy 初始值：插件状态为 loading 时为 true
	const [busy, setBusy] = useState(
		() => pluginManager.get(pluginId)?.status === 'loading',
	);
	// error 初始值：失败时取 error
	const [error, setError] = useState<string | null>(() => {
		// 取当前插件
		const cur = pluginManager.get(pluginId);
		// 失败状态返回 error
		return cur?.status === 'failed' ? (cur.error ?? null) : null;
	});
	// 强制刷新计数器
	const [, bump] = useState(0);

	// 加载插件 effect
	useEffect(() => {
		// 取消标志
		let cancelled = false;
		// 异步立即执行函数
		(async () => {
			// 取当前插件
			const cur = pluginManager.get(pluginId);
			// 已激活则直接 bump 刷新
			if (cur?.status === 'activated') {
				// bump 触发重渲染
				bump((n) => n + 1);
				// 提前返回
				return;
			}
			// 已失败且非重试：直接展示 error
			if (cur?.status === 'failed' && retryKey === 0) {
				// 设置 error
				setError(cur.error ?? null);
				// 关闭 busy
				setBusy(false);
				// 返回
				return;
			}

			// 进入加载流程
			setBusy(true);
			// 清空 error
			setError(null);
			try {
				// 调 ensurePlugin 加载插件，retryKey > 0 时 force
				await pluginManager.ensurePlugin(pluginId, {
					// force 标志
					force: retryKey > 0,
				});
			} catch (e) {
				// 未取消时设置 error
				if (!cancelled) {
					// e 为 Error 取 message，否则 String
					setError(e instanceof Error ? e.message : String(e));
				}
			} finally {
				// 未取消时关闭 busy 并 bump
				if (!cancelled) {
					// 关闭 busy
					setBusy(false);
					// bump
					bump((n) => n + 1);
				}
			}
		})();
		// cleanup 设置 cancelled
		return () => {
			// 标记取消
			cancelled = true;
		};
	// deps：pluginId 与 retryKey
	}, [pluginId, retryKey]);

	// 取已加载插件
	const loaded = pluginManager.get(pluginId);
	// 取 meta.entry
	const entry = loaded?.meta.entry;
	// 取 meta.trust
	const trust = loaded?.meta.trust;
	// 取 status
	const status = loaded?.status;

	// 样式隔离 effect（与旧版一致）
	useEffect(() => {
		// 已激活 + trusted + 有 entry 才挂样式隔离
		if (status !== 'activated' || trust === 'untrusted' || !entry) return;
		// 挂载样式隔离
		return attachPluginStyleIsolation(pluginId, entry);
	// deps
	}, [pluginId, status, entry, trust]);

	// 已激活插件经 eventBus 收 locale（与 bridge.api.locale 热更新互补）
	useEffect(() => {
		// 未激活不派发
		if (status !== 'activated') return;
		// 派发 pluginId 命名空间下的 locale 事件，payload 为当前 locale
		eventBus.emit(pluginId, 'locale', locale);
	// deps：pluginId、status、locale
	}, [pluginId, status, locale]);

	// liveBridge：用 withLiveLocale 覆盖 locale 后的 bridge
	const liveBridge = useMemo(
		// loaded.bridge 存在则覆盖 locale，否则 null
		() => (loaded?.bridge ? withLiveLocale(loaded.bridge, locale) : null),
		// deps
		[loaded?.bridge, locale],
	);

	// 已激活分支
	if (loaded?.status === 'activated') {
		// untrusted 分支
		if (loaded.meta.trust === 'untrusted') {
			// 取 iframeUrl 并 trim
			const src = loaded.meta.iframeUrl?.trim();
			// 缺失 iframeUrl 提示
			if (!src) {
				// 渲染提示
				return (
					// 容器 div
					<div className="text-muted-foreground p-6 text-sm">
						{/* t 取 plugins.host.missingIframeUrl，传入 id 参数 */}
						{t('plugins.host.missingIframeUrl', { id: pluginId })}
					</div>
				);
			}
			// iframe 语言靠 attachIframeBridge 的 init + onListen('locale') 推送，勿用 liveBridge 以免重挂
			return (
				// 错误边界
				<PluginErrorBoundary pluginId={pluginId}>
					{/* UntrustedIframe，注意传的是 loaded.bridge 而非 liveBridge */}
					<UntrustedIframe
						// pluginId
						pluginId={pluginId}
						// src
						src={src}
						// bridge 用原始快照（iframe 走 postMessage 推 locale）
						bridge={loaded.bridge}
					/>
				</PluginErrorBoundary>
			);
		}

		// trusted 分支：liveBridge 不存在则返回 null
		if (!liveBridge) return null;
		// 取默认导出组件
		const Comp = loaded.mod.default;
		// 渲染
		return (
			// 错误边界
			<PluginErrorBoundary pluginId={pluginId}>
				{/* 插件根 div */}
				<div
					// 类名
					className={`plugin-${pluginId} h-full w-full`}
					// 自定义属性
					data-mf-plugin={pluginId}
					// 标记
					data-plugin-root
				>
					{/* 把 liveBridge 作为 props 注入 */}
					<Comp {...liveBridge} />
				</div>
			</PluginErrorBoundary>
		);
	}

	// 计算 detail 文案
	const detail =
		// 优先 error
		error ||
		// 其次 loaded.error
		loaded?.error ||
		// busy 时取 loading 文案，否则 notLoaded
		(busy || loaded?.status === 'loading'
			? t('plugins.host.loading')
			: t('plugins.host.notLoaded'));

	// 渲染 loading/error UI
	return (
		// 外层 div，cn 合并基础类名与传入 className
		<div
			className={cn(
				// 基础类名
				'mx-auto text-muted-foreground h-full flex flex-col gap-3 p-5.5 pt-0',
				// 外部传入的 className
				className,
			)}
		>
			{/* 内层卡片 */}
			<div className="bg-theme-background h-full p-4.5 rounded-md">
				{/* busy 或 loading 状态展示 Loading */}
				{busy || loaded?.status === 'loading' ? (
					// Loading 组件
					<Loading
						// text 取 plugins.host.loadingNamed，传 id
						text={t('plugins.host.loadingNamed', { id: pluginId })}
						// 类名
						className="flex items-center h-full"
					/>
				) : (
					// 否则展示不可用提示与重试按钮
					<div className="flex flex-col gap-3">
						{/* 提示文案 */}
						<span>
							{/* t 取 plugins.host.unavailable，传 id */}
							{t('plugins.host.unavailable', { id: pluginId })}
							{/* detail 存在则拼到后面 */}
							{detail ? `: ${detail}` : ''}
						</span>
						{/* 仅当有 error 时展示重试按钮 */}
						{error || loaded?.error ? (
							// Button
							<Button
								// 类型 button
								type="button"
								// busy 时变 loading variant
								variant={busy ? 'loading' : 'default'}
								// 类名
								className="w-fit"
								// busy 时禁用
								disabled={busy}
								// 点击递增 retryKey
								onClick={() => setRetryKey((n) => n + 1)}
							>
								{/* 按钮文案 */}
								{t('plugins.host.reload')}
							</Button>
						) : null}
					</div>
				)}
			</div>
		</div>
	);
}
```

**变更摘要**：新增 `withLiveLocale` 工具函数；`PluginHostPage` 接入 `useI18n`，所有硬编码中文改 `t(...)`；新增 `eventBus.emit('locale')` 与 `liveBridge` useMemo；Props 增加可选 `className`；untrusted 分支明确用 `loaded.bridge` 而非 `liveBridge`，避免 iframe 重挂。

### 4.5 `PluginErrorBoundary` 组件（apps/frontend/src/plugins/host/PluginErrorBoundary.tsx）

**对比范围**：新增 `PluginErrorFallback` 函数组件 + `PluginErrorBoundary` class 的 `render` 方法。

**改动前** · `apps/frontend/src/plugins/host/PluginErrorBoundary.tsx`（基线，全文件）

```typescript
// 旧版 import：只引入 React 的 Component / ErrorInfo / ReactNode
import { Component, type ErrorInfo, type ReactNode } from 'react';

// Props 类型
type Props = { pluginId: string; children: ReactNode; };
// State 类型
type State = { error: Error | null };

// PluginErrorBoundary class 组件
export class PluginErrorBoundary extends Component<Props, State> {
	// 初始 state
	state: State = { error: null };
	// 静态方法：从错误派生 state
	static getDerivedStateFromError(error: Error): State { return { error }; }
	// 错误捕获钩子
	componentDidCatch(error: Error, info: ErrorInfo) { console.error(`[plugin:${this.props.pluginId}]`, error, info); }
	// render：旧版直接返回硬编码中文 JSX
	render() {
		// 有错误时渲染错误兜底
		if (this.state.error) {
			return (
				// 容器 div
				<div className="p-6 text-sm text-muted-foreground">
					{/* 标题：硬编码「插件「{pluginId}」加载失败」 */}
					<p className="font-medium text-foreground mb-1">
						插件「{this.props.pluginId}」加载失败
					</p>
					{/* 错误消息 */}
					<p className="opacity-70">{this.state.error.message}</p>
				</div>
			);
		}
		// 无错误返回 children
		return this.props.children;
	}
}
```

**改动后** · `apps/frontend/src/plugins/host/PluginErrorBoundary.tsx`（当前，全文件 L1–L51）

```typescript
// React import
import { Component, type ErrorInfo, type ReactNode } from 'react';
// 新增：useI18n 钩子
import { useI18n } from '@/hooks';

// Props 类型
type Props = {
	// 插件 id
	pluginId: string;
	// 子节点
	children: ReactNode;
};

// State 类型
type State = { error: Error | null };

// 新增 PluginErrorFallback 函数组件：因为 class 组件不能用 hook，单独抽函数组件包 useI18n
function PluginErrorFallback({
	// 插件 id
	pluginId,
	// 错误消息
	message,
}: {
	// pluginId 类型
	pluginId: string;
	// message 类型
	message: string;
}) {
	// 从 useI18n 取 t
	const { t } = useI18n();
	// 渲染错误兜底
	return (
		// 容器 div
		<div className="p-6 text-sm text-muted-foreground">
			{/* 标题：t 取 plugins.host.loadFailed，传 id */}
			<p className="font-medium text-foreground mb-1">
				{t('plugins.host.loadFailed', { id: pluginId })}
			</p>
			{/* 错误消息 */}
			<p className="opacity-70">{message}</p>
		</div>
	);
}

// PluginErrorBoundary class 组件
export class PluginErrorBoundary extends Component<Props, State> {
	// 初始 state
	state: State = { error: null };

	// 静态方法：从错误派生 state
	static getDerivedStateFromError(error: Error): State {
		// 返回含 error 的新 state
		return { error };
	}

	// 错误捕获钩子
	componentDidCatch(error: Error, info: ErrorInfo) {
		// 控制台打印
		console.error(`[plugin:${this.props.pluginId}]`, error, info);
	}

	// render
	render() {
		// 有错误时渲染 PluginErrorFallback
		if (this.state.error) {
			return (
				// 渲染函数组件，把 pluginId 与 message 传入
				<PluginErrorFallback
					// pluginId
					pluginId={this.props.pluginId}
					// message 取 error.message
					message={this.state.error.message}
				/>
			);
		}
		// 无错误返回 children
		return this.props.children;
	}
}
```

**变更摘要**：抽出 `PluginErrorFallback` 函数组件以使用 `useI18n`；class 的 `render` 在错误态改为渲染该函数组件；硬编码中文「插件「...」加载失败」改为 `t('plugins.host.loadFailed', { id })`。

### 4.6 `iframeHostClient` — init 与 locale 接收（apps/remote-plugins/src/utils/iframeHostClient.ts）

**对比范围**：`HostBridgeProps` 类型 + `connectIframeHost` 中 `onMessage` 对 `init` 与 `locale` 消息的处理。

**改动前** · `apps/remote-plugins/src/utils/iframeHostClient.ts`（基线，类型 + init handler 摘录）

```typescript
// 旧版 HostBridgeProps：api 中包含 t 占位函数，没有 locale 字段
type HostBridgeProps = {
	// api 能力集合
	api: {
		// 旧版 t 函数占位
		t: (key: string, params?: Record<string, unknown>) => string;
		// 主题
		theme: 'light' | 'dark';
		// 事件总线
		event: { /* ... */ };
		// http
		http?: { /* ... */ };
		// ui
		ui?: { /* ... */ };
		// modules
		modules?: Readonly<Record<string, unknown>>;
	};
	// plugin 元信息
	plugin: { id: string; version: string; routePath: string };
};

// 在 connectIframeHost 的 onMessage 中，init 分支
if (data.type === 'init') {
	// ...（解析 theme、plugin）
	// 设置 html data-theme
	document.documentElement.dataset.theme = theme;
	// 旧版 bridge：api.t 是占位函数 (k) => k
	const bridge: HostBridgeProps = {
		api: {
			// t 占位
			t: (k) => k,
			// theme
			theme,
			// event
			event: { /* ... */ },
			// ...（其余字段省略）
		},
		// plugin
		plugin,
	};
	// ...
}
```

**改动后** · `apps/remote-plugins/src/utils/iframeHostClient.ts`（当前，类型 L7–L31、init/locale handler L80–L103）

```typescript
// 顶部 import：applyHostLocale、isLocale、Locale
import { applyHostLocale, isLocale, type Locale } from '@/i18n';

// 频道常量
export const MF_IFRAME_CHANNEL = 'dnhyxc-mf-iframe';

// 新版 HostBridgeProps：删除 t，新增 locale
type HostBridgeProps = {
	// api 能力集合
	api: {
		// 主题
		theme: 'light' | 'dark';
		// 新增 locale 字段
		locale: Locale;
		// 事件总线
		event: {
			// on
			on: (event: string, handler: (data?: unknown) => void) => void;
			// off
			off: (event: string, handler: (data?: unknown) => void) => void;
			// emit
			emit: (event: string, data?: unknown) => void;
		};
		// http
		http?: {
			// get
			get: <T = unknown>(url: string) => Promise<T>;
			// post
			post: <T = unknown>(url: string, body?: unknown) => Promise<T>;
			// put
			put: <T = unknown>(url: string, body?: unknown) => Promise<T>;
			// delete
			delete: <T = unknown>(url: string) => Promise<T>;
		};
		// ui
		ui?: {
			// showToast
			showToast: (options: {
				// message
				message: string;
				// type
				type?: 'success' | 'error' | 'info';
			}) => void;
		};
		// modules
		modules?: Readonly<Record<string, unknown>>;
	};
	// plugin 元信息
	plugin: { id: string; version: string; routePath: string };
};

// ...（isRecord / rpc 等中间逻辑未改动，省略）

// onMessage 内部：locale 消息分支（位于 init 之前）
if (data.type === 'locale' && isLocale(data.locale)) {
	// 调 applyHostLocale 同步到自身 i18n 实例
	applyHostLocale(data.locale);
	// 处理完直接 return，不走 init 分支
	return;
}

// onMessage 内部：init 消息分支
if (data.type === 'init') {
	// 收到 init 后清掉 ready 重试 interval
	window.clearInterval(retry);
	// 清掉超时定时器
	window.clearTimeout(timeout);
	// 解析 theme，非法值兜底 light
	const theme =
		data.theme === 'dark' || data.theme === 'light'
			? data.theme
			: 'light';
	// 解析 locale，isLocale 校验通过则用，否则兜底 zh-CN
	const locale: Locale = isLocale(data.locale) ? data.locale : 'zh-CN';
	// 解析 plugin 元信息
	const plugin =
		isRecord(data.plugin) && typeof data.plugin.id === 'string'
			? {
					// id 转字符串
					id: String(data.plugin.id),
					// version 缺省 0
					version: String(data.plugin.version ?? '0'),
					// routePath 缺省空串
					routePath: String(data.plugin.routePath ?? ''),
				}
			// 非法时退回 pluginId 与默认值
			: { id: pluginId, version: '0', routePath: '' };

	// 设置 html data-theme
	document.documentElement.dataset.theme = theme;
	// 新增：调 applyHostLocale 把 init 时的 locale 同步到自身 i18n
	applyHostLocale(locale);

	// 组装 bridge
	const bridge: HostBridgeProps = {
		// api
		api: {
			// theme
			theme,
			// locale（替代旧版 t）
			locale,
			// event（占位实现，不真正派发到 Host）
			event: {
				// on 占位
				on: () => undefined,
				// off 占位
				off: () => undefined,
				// emit 占位
				emit: () => undefined,
			},
			// http：通过 rpc 转发到 Host
			http: {
				// get
				get: (url) => rpc('http.get', [url]) as Promise<never>,
				// post
				post: (url, body) =>
					rpc('http.post', [url, body]) as Promise<never>,
				// put
				put: (url, body) =>
					rpc('http.put', [url, body]) as Promise<never>,
				// delete
				delete: (url) => rpc('http.delete', [url]) as Promise<never>,
			},
			// ui：toast 走 rpc
			ui: {
				// showToast
				showToast: (options) => {
					// rpc 调 ui.showToast
					void rpc('ui.showToast', [options]);
				},
			},
			// modules：ebook 子模块
			modules: {
				// ebook
				ebook: {
					// getBookId 初始返回 null
					getBookId: () => null,
					// getBookTitle 初始返回 null
					getBookTitle: () => null,
					// navigateToCfi 走 rpc
					navigateToCfi: (cfi: string) =>
						rpc('ebook.navigateToCfi', [cfi]),
					// openThought 走 rpc
					openThought: (thought: unknown) =>
						rpc('ebook.openThought', [thought]),
					// closeIdeasList 走 rpc
					closeIdeasList: () => rpc('ebook.closeIdeasList'),
				},
			},
		},
		// plugin 元信息
		plugin,
	};

	// ...（预取 bookId/bookTitle 并 resolve bridge，未改动）
}
```

**变更摘要**：`HostBridgeProps.api` 删除 `t`、新增 `locale: Locale`；`onMessage` 新增 `type: 'locale'` 分支调 `applyHostLocale`；`init` 分支解析 `locale` 字段并调 `applyHostLocale(locale)`，bridge `api.locale` 取该值。

### 4.7 `learningNotes` store — i18n 注入（apps/remote-plugins/src/store/learningNotes.ts）

**对比范围**：`errMsg` 函数 + `LearningNotesStore.bind` + `saveNote` 方法 + `fetchPage`/`openPreview` 等 catch 中的 toast 调用。

**改动前** · `apps/remote-plugins/src/store/learningNotes.ts`（基线，关键符号摘录）

```typescript
// 旧版 errMsg：兜底硬编码「请求失败」
function errMsg(e: unknown): string {
	// Error 实例且有 message 时返回
	if (e instanceof Error && e.message) return e.message;
	// 对象且有 message 字段时返回
	if (e && typeof e === 'object' && 'message' in e) {
		// 取 message
		const m = (e as { message?: unknown }).message;
		// 非空字符串则返回
		if (typeof m === 'string' && m.trim()) return m;
	}
	// 旧版兜底：硬编码「请求失败」
	return '请求失败';
}

// LearningNotesStore class
class LearningNotesStore {
	// api
	private api: NotesApi | null = null;
	// toast 函数
	private toast: ToastFn = () => {};
	// 旧版 bind：只接收 http 与 toast
	bind(http: HostHttp | undefined, toast: ToastFn) {
		// 创建 api
		this.api = http ? createNotesApi(http) : null;
		// 设置 toast
		this.toast = toast;
	}
	// 旧版 fetchPage：硬编码中文 toast
	async fetchPage(...) {
		// 未授权 HTTP 时硬编码 toast
		if (!this.api) { this.toast('未授权 HTTP，无法同步笔记', 'error'); return; }
		// ...（catch 中 this.toast(errMsg(e), 'error')）
	}
	// 旧版 saveNote：硬编码中文 toast
	async saveNote(input) {
		// 标题为空硬编码
		if (!input.title.trim()) { this.toast('请先输入标题', 'info'); return; }
		// 内容为空硬编码
		if (!input.text.trim()) { this.toast('请先输入内容', 'info'); return; }
		// 未授权 HTTP 硬编码
		if (!this.api) { this.toast('未授权 HTTP，无法保存', 'error'); return; }
		// 无标题笔记硬编码
		const payload = { title: input.title.trim() || '无标题笔记', html: input.html };
		// ...（成功时 this.toast('已更新笔记'/'已保存笔记', 'success')）
	}
}
```

**改动后** · `apps/remote-plugins/src/store/learningNotes.ts`（当前，`errMsg` L15–L22、`bind` L55–L59、`saveNote` L174–L218）

```typescript
// 顶部 import：translateSync 同步查字典
import { translateSync } from '@/i18n';
// EMPTY_NOTE_DOC
import { EMPTY_NOTE_DOC } from '@design/RichEditor';
// mobx
import { makeAutoObservable, runInAction } from 'mobx';
// api 工厂与类型
import {
	// createNotesApi
	createNotesApi,
	// HostHttp
	type HostHttp,
	// NOTES_PAGE_SIZE
	NOTES_PAGE_SIZE,
	// Note
	type Note,
	// NotesApi
	type NotesApi,
} from '@/views/learning-notes/api';

// ToastFn 类型
type ToastFn = (message: string, type?: 'success' | 'error' | 'info') => void;
// 新增 TFn 类型：t 函数签名
type TFn = (key: string, params?: Record<string, unknown>) => string;

// 新版 errMsg：接收 t 函数，兜底走 t('common.requestFailed')
function errMsg(e: unknown, t: TFn): string {
	// Error 实例且有 message
	if (e instanceof Error && e.message) return e.message;
	// 对象且有 message 字段
	if (e && typeof e === 'object' && 'message' in e) {
		// 取 message
		const m = (e as { message?: unknown }).message;
		// 非空字符串则返回
		if (typeof m === 'string' && m.trim()) return m;
	}
	// 新版兜底：t('common.requestFailed')
	return t('common.requestFailed');
}

// LearningNotesStore class
class LearningNotesStore {
	// api
	private api: NotesApi | null = null;
	// toast 函数
	private toast: ToastFn = () => {};
	// 新增：t 函数，默认值 translateSync 保证未 bind 也能用
	private t: TFn = translateSync;

	// 列表分页状态
	list: Note[] = [];
	// total
	total = 0;
	// pageNo
	pageNo = 1;
	// pageSize
	pageSize = NOTES_PAGE_SIZE;
	// loading
	loading = false;
	// loadingMore
	loadingMore = false;

	// ...（其余 observable 字段未改动，省略）

	// 构造函数
	constructor() {
		// makeAutoObservable
		makeAutoObservable(this, {}, { autoBind: true });
	}

	// 新版 bind：多接收一个可选 t 函数
	bind(http: HostHttp | undefined, toast: ToastFn, t?: TFn) {
		// 创建 api
		this.api = http ? createNotesApi(http) : null;
		// 设置 toast
		this.toast = toast;
		// t 传入则覆盖默认 translateSync
		if (t) this.t = t;
	}

	// ...（hasMore / hasActive / setListOpen 等未改动，省略）

	// fetchPage：未授权与 catch 走 t
	async fetchPage(page: number, append: boolean): Promise<void> {
		// 未授权 HTTP 时 toast
		if (!this.api) {
			// t 取 learningNotes.toast.httpDeniedSync
			this.toast(this.t('learningNotes.toast.httpDeniedSync'), 'error');
			// 返回
			return;
		}
		// append 分支判断
		if (append) {
			// 已在加载或没有更多则跳过
			if (this.loading || this.loadingMore || !this.hasMore) return;
			// 置 loadingMore
			this.loadingMore = true;
		} else {
			// 置 loading
			this.loading = true;
		}
		try {
			// 调 api.list
			const data = await this.api.list(page, this.pageSize);
			// runInAction 包裹可观察修改
			runInAction(() => {
				// 设置 total
				this.total = data.total;
				// 设置 pageNo
				this.pageNo = page;
				// append 分支
				if (append) {
					// 用 Set 去重
					const seen = new Set(this.list.map((n) => n.id));
					// 拼接新数据
					this.list = [
						// 旧数据
						...this.list,
						// 过滤已存在
						...data.list.filter((n) => !seen.has(n.id)),
					];
				} else {
					// 直接覆盖
					this.list = data.list;
				}
			});
		} catch (e) {
			// catch 走 errMsg(e, this.t)
			this.toast(errMsg(e, this.t), 'error');
		} finally {
			// finally 关闭 loading
			runInAction(() => {
				// loading false
				this.loading = false;
				// loadingMore false
				this.loadingMore = false;
			});
		}
	}

	// ...（refreshList / loadMore / openNew / openPreview / openEdit / openEditById 未改动，省略）

	// saveNote：所有硬编码中文改 t(...)
	async saveNote(input: {
		// title
		title: string;
		// html
		html: string;
		// text
		text: string;
	}): Promise<void> {
		// 标题为空 toast
		if (!input.title.trim()) {
			// t 取 learningNotes.toast.needTitle
			this.toast(this.t('learningNotes.toast.needTitle'), 'info');
			// 返回
			return;
		}
		// 内容为空 toast
		if (!input.text.trim()) {
			// t 取 learningNotes.toast.needContent
			this.toast(this.t('learningNotes.toast.needContent'), 'info');
			// 返回
			return;
		}
		// 未授权 HTTP toast
		if (!this.api) {
			// t 取 learningNotes.toast.httpDeniedSave
			this.toast(this.t('learningNotes.toast.httpDeniedSave'), 'error');
			// 返回
			return;
		}
		// 置 saving
		this.saving = true;
		try {
			// 组装 payload
			const payload = {
				// 标题 trim 后为空则取 t('common.untitledNote')
				title: input.title.trim() || this.t('common.untitledNote'),
				// html
				html: input.html,
			};
			// editingId 存在则走 update
			if (this.editingId) {
				// 调 api.update
				const updated = await this.api.update(this.editingId, payload);
				// runInAction
				runInAction(() => {
					// 更新 editingId
					this.editingId = updated.id;
				});
				// toast 已更新
				this.toast(this.t('learningNotes.toast.updated'), 'success');
			} else {
				// 否则走 save
				const { id } = await this.api.save(payload);
				// runInAction
				runInAction(() => {
					// 设置 editingId
					this.editingId = id;
				});
				// toast 已保存
				this.toast(this.t('learningNotes.toast.saved'), 'success');
			}
			// 刷新列表
			await this.refreshList();
		} catch (e) {
			// catch 走 errMsg(e, this.t)
			this.toast(errMsg(e, this.t), 'error');
		} finally {
			// finally 关闭 saving
			runInAction(() => {
				// saving false
				this.saving = false;
			});
		}
	}

	// ...（requestDelete / confirmDelete 未改动，省略）
}
```

**变更摘要**：`errMsg` 新增 `t: TFn` 参数，兜底文案改 `t('common.requestFailed')`；`bind` 新增可选 `t` 参数并覆盖默认 `translateSync`；`fetchPage`/`saveNote` 中所有硬编码中文（未授权、请先输入标题/内容、无标题笔记、已更新/已保存笔记）改为 `this.t(...)`。

### 4.8 `Layout` 组件 — i18n 与语言切换（apps/remote-plugins/src/layout/index.tsx）

**对比范围**：`Layout` 函数组件全量（含导航 links、品牌名、语言切换按钮）。

**改动前** · `apps/remote-plugins/src/layout/index.tsx`（基线，全文件）

```typescript
// 旧版 import：react-router 与 cn
import { NavLink, Outlet } from 'react-router';
// cn
import { cn } from '@/lib/utils';

// 旧版 links 写死中文 label，模块顶层定义
const links: { to: string; label: string; end?: boolean }[] = [
	// 首页
	{ to: '/', label: '首页', end: true },
	// 学习笔记
	{ to: '/english-learning/notes', label: '学习笔记' },
	// EPUB 想法列表
	{ to: '/ebook/plugins/ideas-list', label: 'EPUB 想法列表' },
];

// Layout 组件
export default function Layout() {
	return (
		// 最外层 div
		<div className="bg-theme-background text-textcolor flex h-screen flex-col">
			{/* header */}
			<header className="border-theme-border flex shrink-0 items-center gap-4 border-b px-4 py-2.5">
				{/* 品牌名硬编码 remote-plugins */}
				<span className="text-sm font-medium">remote-plugins</span>
				{/* nav */}
				<nav className="flex flex-wrap gap-1">
					{/* 遍历 links */}
					{links.map(({ to, label, end }) => (
						// NavLink
						<NavLink key={to} to={to} end={end}
							// 类名按 isActive 切换
							className={({ isActive }) => cn(...)}>
							{/* label */}
							{label}
						</NavLink>
					))}
				</nav>
				{/* 旧版右下角硬编码中文「独立预览 · :9008」 */}
				<span className="text-textcolor/40 ml-auto text-xs">独立预览 · :9008</span>
			</header>
			{/* main */}
			<main className="min-h-0 flex-1 overflow-auto">
				{/* Outlet */}
				<Outlet />
			</main>
		</div>
	);
}
```

**改动后** · `apps/remote-plugins/src/layout/index.tsx`（当前，全文件 L1–L55）

```typescript
// 新增 import：Languages 图标
import { Languages } from 'lucide-react';
// react-router
import { NavLink, Outlet } from 'react-router';
// 新增 import：useI18n 钩子
import { useI18n } from '@/hooks';
// cn
import { cn } from '@/lib/utils';

// Layout 组件
export default function Layout() {
	// 从 useI18n 取 t 与 toggleLocale
	const { t, toggleLocale } = useI18n();

	// links 移到函数内部，label 走 t(...)，每次重渲染跟随语言切换
	const links: { to: string; label: string; end?: boolean }[] = [
		// 首页，t 取 layout.home
		{ to: '/', label: t('layout.home'), end: true },
		// 学习笔记，t 取 layout.learningNotes
		{ to: '/english-learning/notes', label: t('layout.learningNotes') },
		// EPUB 想法列表，t 取 layout.ideasList
		{ to: '/ebook/plugins/ideas-list', label: t('layout.ideasList') },
	];

	// 返回 JSX
	return (
		// 最外层 div
		<div className="bg-theme-background text-textcolor flex h-screen flex-col">
			{/* header */}
			<header className="border-theme-border flex shrink-0 items-center gap-4 border-b px-4 py-2.5">
				{/* 品牌名走 t('layout.brand') */}
				<span className="text-sm font-medium">{t('layout.brand')}</span>
				{/* nav */}
				<nav className="flex flex-wrap gap-1">
					{/* 遍历 links */}
					{links.map(({ to, label, end }) => (
						// NavLink
						<NavLink
							// key
							key={to}
							// to
							to={to}
							// end
							end={end}
							// className 回调
							className={({ isActive }) =>
								// cn 合并类名
								cn(
									// 基础类名
									'rounded-md px-2.5 py-1 text-sm transition-colors',
									// active 时高亮
									isActive
										? 'bg-theme/20 text-textcolor'
										: 'text-textcolor/60 hover:bg-theme/10 hover:text-textcolor',
								)
							}
						>
							{/* label */}
							{label}
						</NavLink>
					))}
				</nav>
				{/* 新增：语言切换按钮 */}
				<button
					// 类型 button
					type="button"
					// title 走 t('common.toggleLanguage')
					title={t('common.toggleLanguage')}
					// 类名
					className="text-textcolor/60 hover:text-textcolor ml-auto flex h-8 w-8 cursor-pointer items-center justify-center rounded-md hover:bg-theme/10"
					// 点击调 toggleLocale
					onClick={() => toggleLocale()}
				>
					{/* Languages 图标 */}
					<Languages className="h-4 w-4" />
				</button>
				{/* 预览提示走 t('layout.previewHint') */}
				<span className="text-textcolor/40 text-xs">
					{t('layout.previewHint')}
				</span>
			</header>
			{/* main */}
			<main className="min-h-0 flex-1 overflow-auto">
				{/* Outlet */}
				<Outlet />
			</main>
		</div>
	);
}
```

**变更摘要**：`links` 从模块顶层移到组件内部，`label` 改为 `t(...)`；品牌名、预览提示改 `t(...)`；新增 `Languages` 图标按钮，点击 `toggleLocale()` 切换语言；右下角文案从 `ml-auto` 改为按钮 `ml-auto` + 文案紧随其后的布局。

## 5. 兼容性与影响

- **破坏性变更**：`HostBridgeProps.api.t` 字段被删除，替换为 `api.locale`。消费方仅 `apps/remote-plugins` 自身，同轮全量替换完成，无第三方插件受影响。
- **协议变更**：MF iframe `init` 消息新增 `locale` 字段，新增 `type: 'locale'` 消息类型。Host 与 remote 必须同版本部署；旧版 remote 收到 `locale` 字段会忽略（`isLocale` 校验失败兜底 `zh-CN`），不会崩溃。
- **行为变化**：Host 顶栏切语言时，trusted 插件通过 `withLiveLocale` + `eventBus.emit` 双路同步；untrusted iframe 通过 `postMessage` `locale` 消息同步。remote 侧所有 `useI18n` 订阅者自动重渲染。
- **回归重点**：
  - 切换 Host 顶栏语言后，remote-plugins 内的导航、按钮、Toast、错误兜底、富文本工具栏、`NotePreview`、`Confirm` 弹窗均应跟随切换。
  - untrusted iframe 嵌入页（`/embed`）在 Host 切语言后应收到 `locale` 消息并切换。
  - `learningNotes` store 在 `bind` 未传 `t` 时应回退到 `translateSync`，不影响单测。
  - `PluginErrorBoundary` 错误态文案应随语言切换。
- **未覆盖**：`mockHost.ts` 已同步删除 mock `t`，独立预览（`window.parent === window`）场景下走 remote 自身 i18n 默认语言。

## 6. 相关源码路径

| 说明 | 路径 |
| ---- | ---- |
| Host bridge 类型定义 | `apps/frontend/src/plugins/core/types.ts` |
| Host bridge 工厂 | `apps/frontend/src/plugins/core/createHostBridge.ts` |
| Host iframe 桥接 | `apps/frontend/src/plugins/core/attachIframeBridge.ts` |
| Host 插件挂载页 | `apps/frontend/src/plugins/host/PluginHostPage.tsx` |
| Host 错误边界 | `apps/frontend/src/plugins/host/PluginErrorBoundary.tsx` |
| Host i18n 文案（zh-CN） | `apps/frontend/src/i18n/locales/zh-CN.ts` |
| Host i18n 文案（en-US） | `apps/frontend/src/i18n/locales/en-US.ts` |
| Host 学习笔记页（透传 className） | `apps/frontend/src/views/englishLearning/notes/index.tsx` |
| Remote iframe 客户端 | `apps/remote-plugins/src/utils/iframeHostClient.ts` |
| Remote mock host | `apps/remote-plugins/src/utils/mockHost.ts` |
| Remote layout | `apps/remote-plugins/src/layout/index.tsx` |
| Remote home 视图 | `apps/remote-plugins/src/views/home/index.tsx` |
| Remote embed 视图 | `apps/remote-plugins/src/views/embed/index.tsx` |
| Remote ideas-list 视图 | `apps/remote-plugins/src/views/ebook-ideas/index.tsx` |
| Remote learning-notes 视图 | `apps/remote-plugins/src/views/learning-notes/index.tsx` |
| Remote learning-notes api | `apps/remote-plugins/src/views/learning-notes/api.ts` |
| Remote learningNotes store | `apps/remote-plugins/src/store/learningNotes.ts` |
| Remote Confirm 组件 | `apps/remote-plugins/src/components/design/Confirm/index.tsx` |
| Remote NotePreview 组件 | `apps/remote-plugins/src/components/design/NotePreview/index.tsx` |
| Remote RichEditor 组件 | `apps/remote-plugins/src/components/design/RichEditor/index.tsx` |
| Remote RichEditor locale | `apps/remote-plugins/src/components/design/RichEditor/locale.ts` |
| Remote RichEditor Title | `apps/remote-plugins/src/components/design/RichEditor/title/Title.tsx` |
| Remote design 导出 | `apps/remote-plugins/src/components/design/index.ts` |

---

（若与仓库最新源码不一致，以源码为准）
