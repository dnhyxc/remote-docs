# 插件 iframe 主题与强调色下发

## 0. 延伸阅读

- [插件iframe主题下发.md](./插件iframe主题下发.md) — 本文（untrusted iframe 外观能力总览）
- [插件中心卡片重构.md](./插件中心卡片重构.md) — 同轮姊妹篇：插件中心 Tab 分类与卡片底栏重构
- [模块联邦实现指南.md](./模块联邦实现指南.md) — Module Federation 实现总文档
- [插件书架切换.md](./插件书架切换.md) — 插件中心上架/下架与卡片交互
- [插件选择本地文件.md](./插件选择本地文件.md) — 既有 Host → iframe 桥接能力（`api.ui.pickLocalFiles`）

## 1. 背景与目标

`untrusted` 信任级别的远程插件运行在 iframe 内，与主站**跨域隔离**。在本次改动之前，iframe 桥接只在握手时下发一个 `theme: 'light' | 'dark'` 字符串，导致：

1. iframe 内的强调色（`--brand-accent` 等 CSS 变量）无法跟随主站「设置 → 强调色」实时变化，按钮、链接 hover 色与主站不一致。
2. 主站常用 `body.theme-black` 表示暗色而不挂 `.dark`，但 iframe 内若**强行加 `.dark`** 会误触 `dark:border-input` 等 Tailwind 工具类，导致 outline 按钮边框「消失」。
3. `attachIframeBridge` 在 React Strict Mode 与路由切换时存在内存泄漏与握手重复：`ready` 消息会被应答多次，`onLoad` 与 `ready` 时序竞争；路由切换硬拆 iframe 会让桌面端 WebView 主线程卡死（白屏无报错）。
4. `useInputsOnlyTab` 把 `iframe` 一起标 `tabIndex=-1`，会抢走插件内部可聚焦元素的 Tab 序；并且会与 Radix Dialog/Sheet 的 `FocusScope` 焦点陷阱互殴，卡死主线程。

本次改动新增 **HostIframeAppearance** 能力，把「主题 + 强调色 + 必要表面 token」作为快照下发到 iframe；同时修复桥接握手稳定性与生命周期清理，并修正 Tab 序策略让 iframe 不再被宿主「夺焦」。

## 2. 改动范围

**federation-kit（共享包）**

- `packages/federation-kit/src/config/types.ts` — 新增 `HostIframeAppearance` 类型；`HostCapabilities` 新增 `getAppearance` / `onAppearanceChange`。
- `packages/federation-kit/src/bridge/attachIframeBridge.ts` — `AttachIframeBridgeOptions` 增 appearance 入参；`sendInit` 携带 appearance；新增 `pushAppearance`（含指纹去重）；`ready` 单次应答；`onLoad` 不占 ready 槽；120ms kick 补推；cleanup 收尾。
- `packages/federation-kit/src/createFederation.ts` — `FederationHostOptions` 透传 `getAppearance` / `onAppearanceChange` 给 `attachIframeBridge`。
- `packages/federation-kit/src/index.ts` — 对外导出 `HostIframeAppearance`。
- `packages/federation-kit/src/react/PluginHostView.tsx` — `UntrustedIframe` 用 ref 持有最新 bridge/opts，effect 只依赖 `src`；卸载时先 `about:blank` 再 detach；渲染层外层 `<div>` 铺 `--theme-background` + iframe 透明，消除握手前白屏闪烁。
- `packages/federation-kit/src/types/index.ts` — 给 `injectRoute` 补注释，说明 `true` 且无 `menu` = 仅路由无侧栏。
- `packages/federation-kit/docs/host-guide/注册中心.md` — 补 menu 字段说明：省略 menu = 仅路由/内嵌，不进左侧菜单。

**apps/frontend（宿主侧）**

- `apps/frontend/src/federation/capabilities/iframeAppearance.ts` — **纯新增**：从 `body`/`html` 读取主题类、强调色与表面 token，组装 `HostIframeAppearance`。
- `apps/frontend/src/federation/capabilities/README.md` — 能力表登记 `iframeAppearance.ts`。
- `apps/frontend/src/federation/runtime/index.ts` — `readTheme` 收敛到 `readHostChromeTheme`；`onLocaleChange` 修复异步订阅竞态（cancelled 标志）；新增 `getAppearance` / `onAppearanceChange`（监听 `theme`/`accent` 事件、80ms 防抖、指纹去重）。
- `apps/frontend/src/federation/host/PluginHostPage.tsx` — `host` 改为本地 `useMemo`，强制注入 `getAppearance` / `onAppearanceChange`。
- `apps/frontend/src/hooks/useInputsOnlyTab.ts` — `NON_FIELD_FOCUSABLE` 移除 `iframe`；`applyInputsOnlyTab` 跳过 Radix Dialog/Sheet 焦点陷阱内的元素。

## 3. 实现思路

1. **能力即快照，非代理 DOM**：iframe 跨域，宿主无法直接改 iframe 内 `:root`。改为宿主把当前主题（`theme`）、是否挂 `.dark`（`darkClass`）、CSS 自定义属性集合（`cssVars`）打包成 `HostIframeAppearance` 快照，通过 `postMessage('appearance', ...)` 下发；iframe 侧自行 `document.documentElement.style.setProperty(name, value)` 应用。这避免跨域 DOM 写入与 CSP 报错。
2. **强调色与表面 token 分层**：始终下发强调色四件套（`--brand-accent` / `-soft` / `-light` / `-dark`，用 `color-mix(in oklch, ...)` 派生）；只在**主站无 `.dark` 但 theme 为 dark**（典型 `body.theme-black`）时下发表面 token（`--background` / `--foreground` / `--card` / `--theme-*` 等）。理由：主站有真实 `.dark` 时，iframe 也加 `.dark`，背景由本地 `:root/.dark` 管控即可；若此时再下发 `--background` 会被 iframe 本地样式覆盖打架。**绝不**给无 `.dark` 的主站强加 `.dark`——会误触 `dark:border-input` 让边框消失。
3. **指纹去重 + 80ms 防抖**：主题切换后 `applyThemeVariables` 有 ~10ms 延迟写 CSS 变量；再多等 80ms 避开与路由卸载叠在同一帧。`pushAppearance` 用 `theme|darkClass|JSON.stringify(cssVars)` 作指纹，未变即 return，避免 `postMessage` 风暴打满 iframe 主线程。
4. **握手单次 + load 不占 ready 槽**：iframe JS 真正就绪会发 `ready`，宿主应答 `init`。`load` 事件可能早于 iframe JS（仅 DOM 加载完成），所以 `onLoad` 只发 `init` 兜底，不消费 `readyAcked`；`ready` 才设 `readyAcked=true` 防止 Strict Mode 双调用与泄漏 interval 把主线程打爆。
5. **路由切换先 `about:blank` 再 detach**：跨域 iframe 在路由切换硬拆时，桌面 WebView（尤其 macOS WKWebView）会卡死主线程（白屏无报错）。cleanup 时先把 `iframe.src = 'about:blank'` 让嵌入文档卸载，再 detach bridge，保证监听器与定时器全清。
6. **ref 稳定 identity，effect 只依赖 `src`**：`UntrustedIframe` 之前依赖 `[src, bridge, iframeBridge]`，bridge/opts 是新对象就触发 detach/attach，反复 `postMessage` 抖动。改用 `useRef` 持有最新值，effect 只依赖 `src`，attach 一次稳定运行。
7. **Tab 序不抢 iframe**：`useInputsOnlyTab` 此前把 `iframe` 标 `tabIndex=-1`，会夺走插件内部可聚焦元素的 Tab 序；同时与 Radix `FocusScope`（Dialog/Sheet）的焦点陷阱互殴卡死。改为 selector 移除 `iframe`，并在扫描时跳过 `[role="dialog"]` / `[data-radix-focus-guard]` 内的元素，把焦点管理权还给 FocusScope。
8. **能力可选、缺省回退**：`getAppearance` / `onAppearanceChange` 都是可选方法；不提供时 `attachIframeBridge` 仍走旧路径（仅下发 `bridge.api.theme` 字符串），保证既有接入方零改动。
9. **渲染层铺主题底色防白屏**：握手前 iframe 未收到外观快照，`document.documentElement` 是浏览器默认白底，暗色主题下切到插件页会白屏闪一下。在 iframe 外层包一个 `<div>` 铺 `var(--theme-background, var(--background, transparent))`，iframe 设 `bg-transparent` + 内联 `backgroundColor: 'transparent'`，握手前透出的即宿主主题色。握手后 iframe 内 `setProperty` 覆盖，二者无缝衔接。

## 4. 关键代码对比与注释

### 4.1 `HostIframeAppearance` 类型与 `HostCapabilities`（`packages/federation-kit/src/config/types.ts`）

**对比范围**：新增 `HostIframeAppearance` 类型（纯新增）+ `HostCapabilities` 接口新增两个可选方法（修改）。

**改动前** · `packages/federation-kit/src/config/types.ts`（基线，约 L8–L80 `HostCapabilities` 接口节选）

```typescript
// 主题字面量类型，仅 light / dark 两种
export type HostTheme = 'light' | 'dark';

// 既有 HostCapabilities 接口声明（节选；其余方法用省略号对称省略）
export interface HostCapabilities {
// ...（未改动）既有方法：getTheme / onThemeChange / getLocale / onLocaleChange / pickLocalFiles 等
}
```

**改动后** · `packages/federation-kit/src/config/types.ts`（当前，约 L8–L92）

```typescript
// 主题字面量类型，仅 light / dark 两种（未改动，保留上下文）
export type HostTheme = 'light' | 'dark';

// 新增：Host → untrusted iframe 下发的外观快照类型
export type HostIframeAppearance = {
// 当前主题（light / dark），iframe 用它判断是否切暗色样式
theme: HostTheme;
// 计算后的 CSS 自定义属性集合，含 --brand-accent / --background 等；iframe setProperty 应用
cssVars: Record<string, string>;
/**
 * 是否给 iframe 加 .dark。
 * 须与 Host 一致：主站常用 theme-black 而无 .dark，
 * 若 iframe 强行 .dark，会误触 dark:border-input 等，outline 按钮边框会消失。
 */
darkClass?: boolean;
};

// 既有 HostCapabilities 接口声明（节选；其余方法用省略号对称省略）
export interface HostCapabilities {
// ...（未改动）既有方法：getTheme / onThemeChange / getLocale / onLocaleChange / pickLocalFiles 等
// 新增：读取当前外观快照；随 init / appearance 下发；缺省则 iframe 只用 bridge.api.theme
getAppearance?: () => HostIframeAppearance;
// 新增：主题 / 强调色等变化时推送；返回取消订阅
onAppearanceChange?: (
handler: (appearance: HostIframeAppearance) => void,
) => () => void;
}
```

**变更摘要**：新增 `HostIframeAppearance` 类型与 `HostCapabilities.getAppearance` / `onAppearanceChange` 两个可选方法，将 iframe 外观从「单一 theme 字符串」升级为「主题 + darkClass + cssVars 快照」。

### 4.2 `AttachIframeBridgeOptions` 与 `sendInit`（`packages/federation-kit/src/bridge/attachIframeBridge.ts`）

**对比范围**：`AttachIframeBridgeOptions` 接口新增 appearance 入参 + 闭包新增 `readyAcked` / `lastAppearanceFp` 状态 + `sendInit` 改造。

**改动前** · `packages/federation-kit/src/bridge/attachIframeBridge.ts`（基线，约 L90–L120）

```typescript
// 桥接选项接口（节选；其余字段用省略号对称省略）
export type AttachIframeBridgeOptions = {
// 通信频道，缺省 DEFAULT_MF_IFRAME_CHANNEL
channel?: string;
// 读取当前 locale
getLocale: () => HostLocale | string;
// locale 变化订阅
onLocaleChange?: (handler: (locale: HostLocale) => void) => () => void;
// ...（未改动）extraRpc / targetOrigin 等
};
// attachIframeBridge 主体（节选，符号闭合到 sendInit 末）
export function attachIframeBridge(
iframe: HTMLIFrameElement,
bridge: HostBridgeProps,
targetOrigin: string,
opts: AttachIframeBridgeOptions,
): () => void {
// 通信频道
const channel = opts.channel ?? DEFAULT_MF_IFRAME_CHANNEL;
// 取 contentWindow 的辅助函数
const win = () => iframe.contentWindow;
// 旧版 sendInit：只下发 theme 字符串 + locale + plugin
const sendInit = () => {
// contentWindow 不存在则直接返回
const w = win();
if (!w) return;
// postMessage init 消息，theme 来自 bridge.api.theme
w.postMessage(
{
channel,
type: 'init',
theme: bridge.api.theme,
locale: opts.getLocale(),
plugin: bridge.plugin,
},
targetOrigin,
);
};
```

**改动后** · `packages/federation-kit/src/bridge/attachIframeBridge.ts`（当前，约 L90–L130）

```typescript
// 导入 HostIframeAppearance 类型，用于 getAppearance / onAppearanceChange 签名
import type { HostIframeAppearance } from '../config/types';
// 既有类型导入（未改动）
import type { HostBridgeProps, HostLocale } from '../types';

// 通信频道常量（未改动，保留上下文）
export const DEFAULT_MF_IFRAME_CHANNEL = 'dnhyxc-mf-iframe';
// 桥接选项接口（节选；其余字段用省略号对称省略）
export type AttachIframeBridgeOptions = {
// 通信频道，缺省 DEFAULT_MF_IFRAME_CHANNEL
channel?: string;
// 读取当前 locale
getLocale: () => HostLocale | string;
// locale 变化订阅
onLocaleChange?: (handler: (locale: HostLocale) => void) => () => void;
// 新增：随 init / appearance 下发；缺省则 iframe 仅得 theme 字符串
getAppearance?: () => HostIframeAppearance;
// 新增：外观变化订阅；返回取消订阅
onAppearanceChange?: (
handler: (appearance: HostIframeAppearance) => void,
) => () => void;
// ...（未改动）extraRpc / targetOrigin 等
};
// attachIframeBridge 主体（节选，符号闭合到 sendInit 末）
export function attachIframeBridge(
iframe: HTMLIFrameElement,
bridge: HostBridgeProps,
targetOrigin: string,
opts: AttachIframeBridgeOptions,
): () => void {
// 通信频道
const channel = opts.channel ?? DEFAULT_MF_IFRAME_CHANNEL;
// 取 contentWindow 的辅助函数
const win = () => iframe.contentWindow;
// 新增：ready 轮询只应答一次，避免 Strict Mode / 泄漏 interval 打爆主线程
let readyAcked = false;
// 新增：记录上次下发的 appearance 指纹，用于去重
let lastAppearanceFp = '';
// 改造后 sendInit：携带 appearance（若有）
const sendInit = () => {
// contentWindow 不存在则直接返回
const w = win();
if (!w) return;
// 读取当前外观快照（可选能力，缺省 undefined）
const appearance = opts.getAppearance?.();
// postMessage init 消息，theme 优先取 appearance.theme，回退 bridge.api.theme
w.postMessage(
{
channel,
type: 'init',
theme: appearance?.theme ?? bridge.api.theme,
locale: opts.getLocale(),
plugin: bridge.plugin,
// 有 appearance 时一并下发，iframe 侧 setProperty 应用
...(appearance ? { appearance } : {}),
},
targetOrigin,
);
// 记录指纹，避免后续 pushAppearance 重复推送同一份
if (appearance) {
lastAppearanceFp = `${appearance.theme}|${appearance.darkClass ?? ''}|${JSON.stringify(appearance.cssVars)}`;
}
};
```

**变更摘要**：选项新增 `getAppearance` / `onAppearanceChange`；闭包新增 `readyAcked` / `lastAppearanceFp`；`sendInit` 优先用 `appearance.theme` 并在 init 中带 appearance，同时记录指纹供后续去重。

### 4.3 `pushAppearance` 与 `onMessage` 的 ready 单次应答（`packages/federation-kit/src/bridge/attachIframeBridge.ts`）

**对比范围**：新增 `pushAppearance` 函数 + `onMessage` 内 `ready` 分支加 `readyAcked` 守卫。

**改动前** · `packages/federation-kit/src/bridge/attachIframeBridge.ts`（基线，约 L127–L170，从 `pushLocale` 后到 `onMessage` 内 ready 分支）

```typescript
// 旧版无 pushAppearance；仅有 pushLocale 推送 locale
const pushLocale = (locale: HostLocale | string) => {
// contentWindow 不存在则直接返回
const w = win();
if (!w) return;
// postMessage locale 消息
w.postMessage({ channel, type: 'locale', locale }, targetOrigin);
};

// 旧版无 unlistenAppearance；仅有 unlistenLocale
const unlistenLocale = opts.onLocaleChange?.((next) => {
if (next === 'zh-CN' || next === 'en-US') pushLocale(next);
});

// onMessage 内 ready 分支（节选）
const onMessage = (ev: MessageEvent) => {
// 来源校验：必须来自目标 iframe
if (ev.source !== win()) return;
// origin 校验：跨域时必须匹配 targetOrigin
if (targetOrigin !== '*' && ev.origin !== targetOrigin) return;
const data = ev.data;
// channel 校验
if (!data || data.channel !== channel) return;
// ready 分支：iframe JS 就绪，应答 init
if (data.type === 'ready') {
const ready = data as ReadyMsg;
// pluginId 不匹配则忽略（多插件场景）
if (ready.pluginId && ready.pluginId !== bridge.plugin.id) return;
// 旧版：直接 sendInit，无单次守卫，Strict Mode 会应答多次
sendInit();
return;
}
};
```

**改动后** · `packages/federation-kit/src/bridge/attachIframeBridge.ts`（当前，约 L141–L175）

```typescript
// 旧版无 pushAppearance；仅有 pushLocale 推送 locale（未改动）
const pushLocale = (locale: HostLocale | string) => {
// contentWindow 不存在则直接返回
const w = win();
if (!w) return;
// postMessage locale 消息
w.postMessage({ channel, type: 'locale', locale }, targetOrigin);
};

// 新增：推送 appearance（主题/CSS 变量），含指纹去重
const pushAppearance = (appearance: HostIframeAppearance) => {
// contentWindow 不存在则直接返回
const w = win();
if (!w) return;
// 计算本次外观指纹
const fp = `${appearance.theme}|${appearance.darkClass ?? ''}|${JSON.stringify(appearance.cssVars)}`;
// 与上次相同则跳过，避免 postMessage 风暴
if (fp === lastAppearanceFp) return;
// 更新指纹缓存
lastAppearanceFp = fp;
// postMessage appearance 消息，iframe 侧 setProperty 应用
w.postMessage(
{ channel, type: 'appearance', appearance },
targetOrigin,
);
};

// 旧版无 unlistenAppearance；仅有 unlistenLocale（未改动）
const unlistenLocale = opts.onLocaleChange?.((next) => {
if (next === 'zh-CN' || next === 'en-US') pushLocale(next);
});

// 新增：订阅外观变化，触发 pushAppearance
const unlistenAppearance = opts.onAppearanceChange?.((next) => {
pushAppearance(next);
});

// onMessage 内 ready 分支（节选）
const onMessage = (ev: MessageEvent) => {
// 来源校验：必须来自目标 iframe
if (ev.source !== win()) return;
// origin 校验：跨域时必须匹配 targetOrigin
if (targetOrigin !== '*' && ev.origin !== targetOrigin) return;
const data = ev.data;
// channel 校验
if (!data || data.channel !== channel) return;
// ready 分支：iframe JS 就绪，应答 init
if (data.type === 'ready') {
const ready = data as ReadyMsg;
// pluginId 不匹配则忽略（多插件场景）
if (ready.pluginId && ready.pluginId !== bridge.plugin.id) return;
// 新增：单次守卫，防止 Strict Mode 双调用与泄漏 interval 反复应答
if (readyAcked) return;
// 标记已应答
readyAcked = true;
// 真正应答 init
sendInit();
return;
}
};
```

**变更摘要**：新增 `pushAppearance`（指纹去重推送）+ `unlistenAppearance`（订阅外观变化）；`ready` 分支加 `readyAcked` 单次守卫，根治 Strict Mode 与泄漏 interval 导致的重复握手。

### 4.4 `onLoad`、`kick` 与 cleanup（`packages/federation-kit/src/bridge/attachIframeBridge.ts`）

**对比范围**：`onLoad` 改为「不占 readyAcked，仅兜底 sendInit」+ 跨域 contentDocument try/catch + 120ms kick 补推 + cleanup 收尾。

**改动前** · `packages/federation-kit/src/bridge/attachIframeBridge.ts`（基线，约 L184–L216）

```typescript
// 旧版 onLoad：iframe load 即 sendInit
const onLoad = () => sendInit();
// 监听 load 事件
iframe.addEventListener('load', onLoad);
// 旧版：直接读 contentDocument，跨域时可能抛错导致 attach 半途崩
if (iframe.contentDocument?.readyState === 'complete') {
// 已 complete 也补发一次 init
sendInit();
}

// 旧版 cleanup：仅移除监听 + unlistenLocale
return () => {
// 移除 message 监听
window.removeEventListener('message', onMessage);
// 移除 load 监听
iframe.removeEventListener('load', onLoad);
// 取消 locale 订阅
unlistenLocale?.();
};
```

**改动后** · `packages/federation-kit/src/bridge/attachIframeBridge.ts`（当前，约 L216–L248）

```typescript
// 改造后 onLoad：load 可能早于 iframe JS；不占 readyAcked，留给真正的 ready 握手
const onLoad = () => {
// 仅兜底 sendInit；ready 消息来时再正式应答
sendInit();
};
// 监听 load 事件
iframe.addEventListener('load', onLoad);
// 跨域时 contentDocument 可能抛错；用 try/catch 防止 attach 半途抛掉导致监听泄漏
try {
// 同源且已 complete 时也补发一次 init
if (iframe.contentDocument?.readyState === 'complete') {
sendInit();
}
} catch {
// 跨域：contentDocument 不可访问，忽略
}

// 新增：iframe JS 就绪略晚于 load 时，ready 会再 init；这里再补推一次强调色
const kick = window.setTimeout(() => {
// 读取当前外观快照
const appearance = opts.getAppearance?.();
// 有外观则补推一次（pushAppearance 内部有指纹去重，不会重复）
if (appearance) pushAppearance(appearance);
}, 120);

// 改造后 cleanup：清 kick + 移除监听 + 取消 locale / appearance 订阅
return () => {
// 清掉 kick 定时器，防止 detach 后仍触发
window.clearTimeout(kick);
// 移除 message 监听
window.removeEventListener('message', onMessage);
// 移除 load 监听
iframe.removeEventListener('load', onLoad);
// 取消 locale 订阅
unlistenLocale?.();
// 新增：取消 appearance 订阅
unlistenAppearance?.();
};
```

**变更摘要**：`onLoad` 不再消费 `readyAcked`；跨域 `contentDocument` 读取包 try/catch 防监听泄漏；新增 120ms `kick` 补推强调色；cleanup 清 `kick` 并取消 `appearance` 订阅，监听与定时器全清。

### 4.5 `UntrustedIframe` 用 ref 稳定 identity + `about:blank` 卸载（`packages/federation-kit/src/react/PluginHostView.tsx`）

**对比范围**：`UntrustedIframe` 组件 effect 改为只依赖 `src`，用 ref 持有最新 bridge/opts；cleanup 先 `about:blank` 再 detach。

**改动前** · `packages/federation-kit/src/react/PluginHostView.tsx`（基线，约 L80–L98）

```typescript
// UntrustedIframe 组件（节选，符号闭合到 effect 末）
function UntrustedIframe({
// ...props（src / bridge / iframeBridge / origin，未改动）
}: {
iframeBridge: AttachIframeBridgeOptions;
}) {
// iframe 元素引用
const iframeRef = useRef<HTMLIFrameElement>(null);
// 旧版 effect：依赖 [src, bridge, iframeBridge]，bridge/opts 是新对象就重新 attach
useEffect(() => {
// 取 iframe 元素
const el = iframeRef.current;
if (!el) return;
// 解析 origin，跨域失败则直接 return
try {
// ...（未改动）origin 解析逻辑
} catch {
return;
}
// 旧版：直接返回 attachIframeBridge 的 cleanup
return attachIframeBridge(el, bridge, origin, iframeBridge);
}, [src, bridge, iframeBridge]);
```

**改动后** · `packages/federation-kit/src/react/PluginHostView.tsx`（当前，约 L80–L115）

```typescript
// UntrustedIframe 组件（节选，符号闭合到 effect 末）
function UntrustedIframe({
// ...props（src / bridge / iframeBridge / origin，未改动）
}: {
iframeBridge: AttachIframeBridgeOptions;
}) {
// iframe 元素引用
const iframeRef = useRef<HTMLIFrameElement>(null);
// 新增：用 ref 持有最新 bridge，避免 identity 抖动反复 detach/attach
const bridgeRef = useRef(bridge);
// 新增：用 ref 持有最新 opts，同理
const optsRef = useRef(iframeBridge);
// 每次渲染同步到 ref（不触发 effect）
bridgeRef.current = bridge;
optsRef.current = iframeBridge;

// 改造后 effect：只依赖 src，attach 一次稳定运行
useEffect(() => {
// 取 iframe 元素
const el = iframeRef.current;
if (!el) return;
// 解析 origin，跨域失败则直接 return
try {
// ...（未改动）origin 解析逻辑
} catch {
return;
}
// 用 ref 当前值 attach，避免 bridge/opts identity 变化触发重新 attach
const detach = attachIframeBridge(
el,
bridgeRef.current,
origin,
optsRef.current,
);
// cleanup：先 about:blank 再 detach
return () => {
// 先停掉 embed 文档再卸 bridge：跨域 iframe 在路由切换时硬拆会导致 WebView 主线程卡死（空白无报错）
try {
// 把 iframe 指向 about:blank，让嵌入文档卸载
el.src = 'about:blank';
} catch {
// 忽略：极少数情况下 src 不可写
}
// 再 detach bridge，移除监听与定时器
detach();
};
}, [src]);
```

**变更摘要**：新增 `bridgeRef` / `optsRef` 稳定 identity，effect 依赖收窄到 `[src]`；cleanup 先 `about:blank` 让嵌入文档卸载，再 detach，根治跨域 iframe 路由切换卡死主线程。

### 4.5.1 `UntrustedIframe` 渲染层铺主题底色防白屏（`packages/federation-kit/src/react/PluginHostView.tsx`）

**对比范围**：`UntrustedIframe` 组件 `return` 的 JSX，由「直接返回裸 `<iframe>`」改为「外层 `<div>` 铺 Host 主题背景 + iframe 透明」。属本轮增量改动，解决 iframe 握手前短暂白屏闪烁。

**背景**：握手阶段（`ready` → `init` 应答）期间，iframe 尚未收到外观快照，其 `document.documentElement` 背景为浏览器默认白色。在主站暗色主题下，切到 untrusted 插件页会先看到一块白底闪一下，再被 iframe 内 `setProperty` 覆盖成主题色。根因是 iframe 默认白底透出到了视口。解法：在 iframe 外层包一个 div，直接铺 `var(--theme-background, var(--background, transparent))`，iframe 自身设为透明（`bg-transparent` + `backgroundColor: 'transparent'`），握手前透出的就是宿主主题色而非白底。

**改动前** · `packages/federation-kit/src/react/PluginHostView.tsx`（基线，约 L112–L124，`UntrustedIframe` return 片段）

```typescript
// UntrustedIframe return（旧版：直接返回裸 iframe，握手前透出浏览器默认白底）
return (
// 裸 iframe：未包外层 div，暗色主题下握手前会白屏闪一下
<iframe
// iframe 元素引用，由 effect 内 attachIframeBridge 接管
ref={iframeRef}
// 无障碍 title，用 pluginId 标识
title={pluginId}
// 远程入口 src
src={src}
// 满铺 + 无边框
className="h-full w-full border-0"
// 插件 id 数据属性，供宿主定位
data-mf-plugin={pluginId}
// 信任级别：untrusted（跨域隔离）
data-mf-trust="untrusted"
// 沙箱权限：脚本 + 同源 + 表单 + 弹窗
sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
/>
);
```

**改动后** · `packages/federation-kit/src/react/PluginHostView.tsx`（当前，约 L115–L134，`UntrustedIframe` return 片段）

```typescript
// 底层铺 Host 主题色；iframe 握手前透明透出此底，避免默认白屏闪一下
return (
// 外层 div：满铺且 min-h-0 避免 flex 子项溢出，铺主题背景
<div
// 满宽满高 + min-h-0 保证在 flex 列布局下不撑爆父容器
className="h-full w-full min-h-0"
// 内联背景：优先 --theme-background，回退 --background，再回退透明
style={{
// 取宿主主题背景变量，握手前即透出主题色，暗色主题不再闪白
background: 'var(--theme-background, var(--background, transparent))',
}}
>
// iframe：设为透明，让外层主题底色透出
<iframe
// iframe 元素引用，由 effect 内 attachIframeBridge 接管
ref={iframeRef}
// 无障碍 title，用 pluginId 标识
title={pluginId}
// 远程入口 src
src={src}
// 满铺 + 无边框 + 透明背景（Tailwind bg-transparent）
className="h-full w-full border-0 bg-transparent"
// 内联再强制透明，避免某些 WebView 忽略 class
style={{ backgroundColor: 'transparent' }}
// 插件 id 数据属性，供宿主定位
data-mf-plugin={pluginId}
// 信任级别：untrusted（跨域隔离）
data-mf-trust="untrusted"
// 沙箱权限：脚本 + 同源 + 表单 + 弹窗
sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
/>
</div>
);
```

**变更摘要**：`return` 由裸 `<iframe>` 改为 `<div 主题底色>` 包透明 `<iframe>`；iframe 自身 `bg-transparent` + 内联 `backgroundColor: 'transparent'`，握手前透出的是宿主 `--theme-background` 而非浏览器白底，消除暗色主题下插件页切换的白屏闪烁。注意 iframe 的 `min-h-0` 由外层 div 承担，保证 flex 布局稳定。

### 4.6 `readHostIframeAppearance` 与 `readHostChromeTheme`（`apps/frontend/src/federation/capabilities/iframeAppearance.ts`）

> 纯新增文件。仅展示改动后。

**改动后** · `apps/frontend/src/federation/capabilities/iframeAppearance.ts`（新增，约 L13–L142 节选）

```typescript
// 由 hex 派生强调色四件套；Host 无 .dark 时也同步表面 token，避免内联盖住主题
function accentVarsFromHex(hex: string): Record<string, string> {
// 返回强调色 + 三个派生色（soft / light / dark），用 color-mix in oklch 混色
return {
// 主强调色，按钮 / 链接 hover / 选中
'--brand-accent': hex,
// soft：55% + white，用于淡背景 / hover 软高亮
'--brand-accent-soft': `color-mix(in oklch, ${hex} 55%, white)`,
// light：75% + white，用于更亮的 hover / 边框
'--brand-accent-light': `color-mix(in oklch, ${hex} 75%, white)`,
// dark：85% + black，用于深色态边框 / 文字
'--brand-accent-dark': `color-mix(in oklch, ${hex} 85%, black)`,
};
}

// 主题类挂在 body，优先从 body 读 CSS 变量（与 applyThemeVariables 一致）
function readHostVar(name: string): string {
// body 元素引用
const body = document.body;
// html 元素引用
const root = document.documentElement;
// 优先取 body.style（运行时已 set），再取 body 计算值，再回退 html
return (
body?.style.getPropertyValue(name).trim() ||
(body ? getComputedStyle(body).getPropertyValue(name).trim() : '') ||
root.style.getPropertyValue(name).trim() ||
getComputedStyle(root).getPropertyValue(name).trim()
);
}

// 解析 accentId：仅放行 ACCENT_COLORS 中存在的 id
function resolveAccentId(raw: string | null | undefined): AccentId | null {
// 空值返回 null
if (!raw) return null;
// 在预设列表中匹配，命中才返回，否则 null
return ACCENT_COLORS.some((c) => c.id === raw) ? (raw as AccentId) : null;
}

// 从 localStorage 读强调色 hex：bootstrap key 优先，再回退 settings json
function readStoredAccentHex(): string | null {
try {
// 从 bootstrap key（首屏防闪存的主题色 id）解析
const fromBootstrap = resolveAccentId(
localStorage.getItem(ACCENT_BOOTSTRAP_STORAGE_KEY),
);
// settings json 中的 accentColor 字段
let fromSettings: AccentId | null = null;
// 读 dnhyxc_settings_json
const j = localStorage.getItem('dnhyxc_settings_json');
if (j) {
// 解析 JSON 取 accentColor
fromSettings = resolveAccentId(
(JSON.parse(j) as { accentColor?: string }).accentColor,
);
}
// bootstrap 优先，settings 兜底
const id = fromBootstrap ?? fromSettings;
// 都没有则返回 null
if (!id) return null;
// 找到对应 hex 返回；找不到也返回 null
return ACCENT_COLORS.find((c) => c.id === id)?.hex ?? null;
} catch {
// 解析失败返回 null
return null;
}
}

// 按名称列表批量读取 CSS 变量，跳过空值
function pickVars(names: string[]): Record<string, string> {
// 输出对象
const out: Record<string, string> = {};
// 遍历名称列表
for (const name of names) {
// 读取变量值
const v = readHostVar(name);
// 有值才写入，避免覆盖 iframe 默认空字符串
if (v) out[name] = v;
}
// 返回非空集合
return out;
}

// 判断 Host 是否挂了 .dark（body 或 html）
function hostHasDarkClass(): boolean {
return (
// body 有 dark 类
document.body.classList.contains('dark') ||
// html 有 dark 类
document.documentElement.classList.contains('dark')
);
}

// Host chrome 主题：优先看 body.theme-black / body.dark（主站暗色挂在 body）
export function readHostChromeTheme(): 'light' | 'dark' {
try {
if (
// body 有 theme-black（主站暗色惯用类）
document.body.classList.contains('theme-black') ||
// body 有 dark
document.body.classList.contains('dark') ||
// html 有 dark
document.documentElement.classList.contains('dark')
) {
// 任一命中即判暗色
return 'dark';
}
// 都没有时回退到 chrome 同步读（防闪逻辑）
return readWindowChromeThemeSync();
} catch {
// 异常回退 light
return 'light';
}
}

// 读取当前 Host 主题 + 强调色 +（必要时）表面 token，供 iframe init / appearance 下发
export function readHostIframeAppearance(
// 主题参数，缺省调 readHostChromeTheme
theme: 'light' | 'dark' = readHostChromeTheme(),
): HostIframeAppearance {
// 强调色 hex：优先实时 CSS 变量，再回退 localStorage，最后兜底 teal
const hex =
readHostVar('--brand-accent') ||
readStoredAccentHex() ||
ACCENT_COLORS.find((c) => c.id === 'teal')!.hex;

// Host 是否挂 .dark
const darkClass = hostHasDarkClass();
// 始终下发：强调色四件套 + Select 等用的边框/主题色变量
const cssVars: Record<string, string> = {
...accentVarsFromHex(hex),
// Select 等用 border-theme/*，靠的是 --theme-color，不是 --border
...pickVars(['--theme-color', '--border', '--theme-border', '--ring']),
};

// 有真实 .dark：iframe 也加 .dark，本地 :root/.dark 管背景；只补边框/主题色
// 无 .dark（典型 theme-black）：必须下发表面 token，且不能加 .dark（否则 dark: 工具类跑偏）
if (!darkClass && theme === 'dark') {
// 无 .dark 但暗色：补齐表面 token，让 iframe 背景与主站一致
Object.assign(
cssVars,
pickVars([
// 表面语义色
'--background',
'--foreground',
'--card',
'--popover',
'--muted',
'--secondary',
'--border',
'--input',
'--ring',
'--primary',
// theme-* 派生
'--theme-background',
'--theme-foreground',
'--theme-card',
'--theme-muted',
'--theme-border',
'--theme-secondary',
'--theme-textcolor',
'--theme-color',
]),
);
} else {
// 有 .dark 或 light：只补 --input（input 边框），其余由 iframe 本地样式管
const input = readHostVar('--input');
if (input) cssVars['--input'] = input;
}

// 返回外观快照
return { theme, darkClass, cssVars };
}
```

**变更摘要**：纯新增。`accentVarsFromHex` 派生强调色四件套；`readHostChromeTheme` 兼容 `theme-black` / `dark` / 防闪回退；`readHostIframeAppearance` 按是否有 `.dark` 分层下发——有 `.dark` 只补边框/主题色，无 `.dark`（theme-black）补齐全部表面 token，**绝不**给无 `.dark` 的主站强加 `.dark`。

### 4.7 `runtime/index.ts` 的 `readTheme`、`onLocaleChange` 与 `getAppearance`/`onAppearanceChange`

**对比范围**：`readTheme` 收敛到 `readHostChromeTheme` + `onLocaleChange` 修复异步订阅竞态 + 新增 `getAppearance` / `onAppearanceChange`。

**改动前** · `apps/frontend/src/federation/runtime/index.ts`（基线，约 L43–L62 与 L150–L165 节选）

```typescript
// 旧版 readTheme：直接读 DOM 属性，逻辑与 iframeAppearance 重复
function readTheme(): 'light' | 'dark' {
try {
// 读 html data-theme
const t = document.documentElement.getAttribute('data-theme');
if (t === 'dark' || t === 'light') return t;
// html.dark
if (document.documentElement.classList.contains('dark')) return 'dark';
// body.dark 或 body.theme-black
if (
document.body.classList.contains('dark') ||
document.body.classList.contains('theme-black')
) {
return 'dark';
}
} catch {
// ignore
}
return 'light';
}
// ...（未改动）readLocale 等
// 旧版 onLocaleChange：异步 onListen 返回时若已 cancel 仍写 unlisten，留下悬挂订阅
onLocaleChange: (handler) => {
let unlisten: (() => void) | undefined;
// 订阅 locale 事件
void onListen<Locale>('locale', (next) => {
if (next === 'zh-CN' || next === 'en-US') handler(next);
}).then((fn) => {
// 异步写入 unlisten；若返回时组件已卸载，这里仍会写，留下悬挂订阅
unlisten = fn;
});
// cleanup 调 unlisten，但异步未就绪时为 undefined
return () => unlisten?.();
},
```

**改动后** · `apps/frontend/src/federation/runtime/index.ts`（当前，约 L46–L50 与 L149–L200 节选）

```typescript
// 导入 readHostChromeTheme 与 readHostIframeAppearance（新能力）
import { readHostChromeTheme, readHostIframeAppearance } from '../capabilities/iframeAppearance';
// ...（未改动）hostHttp 等
// 改造后 readTheme：收敛到 readHostChromeTheme，消除重复实现
function readTheme(): 'light' | 'dark' {
return readHostChromeTheme();
}
// ...（未改动）readLocale 等
// 改造后 onLocaleChange：用 cancelled 标志修复异步订阅竞态
onLocaleChange: (handler) => {
// 新增：取消标志，cleanup 后置位
let cancelled = false;
let unlisten: (() => void) | undefined;
// 订阅 locale 事件
void onListen<Locale>('locale', (next) => {
if (next === 'zh-CN' || next === 'en-US') handler(next);
}).then((fn) => {
// 异步返回时若已 cancel，立即取消订阅，不写 unlisten
if (cancelled) {
fn();
return;
}
// 否则写入 unlisten 供 cleanup 调用
unlisten = fn;
});
// cleanup：先置 cancelled 再调 unlisten，避免悬挂订阅
return () => {
cancelled = true;
unlisten?.();
};
},
// 新增：读取当前外观快照，供 attachIframeBridge init / kick 下发
getAppearance: () => readHostIframeAppearance(readTheme()),
// 新增：主题 / 强调色变化订阅，含 80ms 防抖与指纹去重
onAppearanceChange: (handler) => {
// theme 切换后 applyThemeVariables 有 ~10ms 延迟；再多等一会避开与路由卸载叠在同一帧
let cancelled = false;
let timer: number | undefined;
// 上次推送的指纹，未变不推
let lastFp = '';
// 防抖推送函数
const push = () => {
// 清掉上一次定时器
window.clearTimeout(timer);
// 80ms 后执行，避开 applyThemeVariables 写 CSS 变量的延迟
timer = window.setTimeout(() => {
// 已取消则不推
if (cancelled) return;
// 读取最新外观
const next = readHostIframeAppearance(readTheme());
// 指纹：theme + cssVars JSON
const fp = `${next.theme}|${JSON.stringify(next.cssVars)}`;
// 与上次相同则跳过
if (fp === lastFp) return;
// 更新指纹
lastFp = fp;
// 推送给下游 handler（attachIframeBridge 的 pushAppearance）
handler(next);
}, 80);
};
// 订阅列表，待 onListen 返回后填入
const unsubs: Array<() => void> = [];
// 同时监听 theme 与 accent 两个事件，任一变化都触发 push
void Promise.all([onListen('theme', push), onListen('accent', push)]).then(
(fns) => {
// 异步返回时若已 cancel，立即取消所有订阅
if (cancelled) {
for (const fn of fns) fn();
return;
}
// 否则写入 unsubs 供 cleanup
unsubs.push(...fns);
},
);
// cleanup：置 cancelled、清定时器、取消所有订阅
return () => {
cancelled = true;
window.clearTimeout(timer);
for (const u of unsubs) u();
};
},
```

**变更摘要**：`readTheme` 改为 `readHostChromeTheme` 复用；`onLocaleChange` 加 `cancelled` 标志修复异步竞态（取消后不再写 `unlisten`）；新增 `getAppearance` 直接调 `readHostIframeAppearance`；新增 `onAppearanceChange` 监听 `theme`/`accent` 事件，80ms 防抖 + 指纹去重后推送。

### 4.8 `PluginHostPage` 强制注入 appearance（`apps/frontend/src/federation/host/PluginHostPage.tsx`）

**对比范围**：新增本地 `host` useMemo，强制带上 `getAppearance` / `onAppearanceChange`；`FederationPlugin` 改用本地 `host`。

**改动前** · `apps/frontend/src/federation/host/PluginHostPage.tsx`（基线，约 L298–L320 节选）

```typescript
// 旧版：直接用 mf 作为 host，未注入 appearance 能力
return (
// FederationPlugin 组件，host 来自 mf（无 getAppearance）
<FederationPlugin
// host 即 mf 全局实例
host={mf}
// 插件 id
name={pluginId}
// ...（未改动）className / pageShell 等
/>
);
```

**改动后** · `apps/frontend/src/federation/host/PluginHostPage.tsx`（当前，约 L244–L320 节选）

```typescript
// 导入 readHostIframeAppearance（新能力）
import { readHostIframeAppearance } from '../capabilities/iframeAppearance';
// ...（未改动）其它 import
// 新增：强制带上 appearance；主题检测与 runtime 一致（含 body.dark）
const host = useMemo((): FederationPluginHost => {
return {
// 复用 mf 的 manager
manager: mf.manager,
// 复用 mf 的 config
config: mf.config,
// 重写 getIframeBridgeOptions，注入 appearance 能力
getIframeBridgeOptions: () => ({
// 展开 mf 既有选项
...mf.getIframeBridgeOptions(),
// 注入 getAppearance：读当前外观快照
getAppearance: () => readHostIframeAppearance(),
// 注入 onAppearanceChange：转发到 mf.config.capabilities
onAppearanceChange: (handler) =>
mf.config.capabilities.onAppearanceChange?.(handler) ??
// 无能力时返回 no-op，避免 attachIframeBridge 调用时报错
(() => undefined),
}),
};
}, []);

// ...（未改动）slots useMemo
// 改造后：用本地 host（带 appearance）替代 mf
return (
<FederationPlugin
// host 改为本地 useMemo 的 host
host={host}
// 插件 id
name={pluginId}
// ...（未改动）className / pageShell 等
/>
);
```

**变更摘要**：新增本地 `host` useMemo，把 `getIframeBridgeOptions` 包装一层，强制注入 `getAppearance` 与 `onAppearanceChange`；`FederationPlugin` 改用本地 `host`，确保 untrusted iframe 走 appearance 通道。

### 4.9 `useInputsOnlyTab` 不再夺 iframe 焦点（`apps/frontend/src/hooks/useInputsOnlyTab.ts`）

**对比范围**：`NON_FIELD_FOCUSABLE` selector 移除 `iframe` + `applyInputsOnlyTab` 跳过 Radix Dialog/Sheet 内的元素。

**改动前** · `apps/frontend/src/hooks/useInputsOnlyTab.ts`（基线，约 L1–L11）

```typescript
// 旧版 selector：含 iframe，会夺走插件内部 Tab 序
const NON_FIELD_FOCUSABLE =
'button, a[href], area[href], iframe, object, embed, summary, [tabindex]:not([tabindex="-1"])';

// 旧版 applyInputsOnlyTab：遍历所有匹配元素标 -1
function applyInputsOnlyTab(root: ParentNode) {
for (const el of root.querySelectorAll<HTMLElement>(NON_FIELD_FOCUSABLE)) {
// 跳过真正的表单控件
if (el.matches('input, textarea, select')) continue;
// 旧版：无差别标 -1，包括 Radix Dialog 内的元素，与 FocusScope 互殴
el.tabIndex = -1;
}
}
```

**改动后** · `apps/frontend/src/hooks/useInputsOnlyTab.ts`（当前，约 L1–L14）

```typescript
// 改造后 selector：移除 iframe，避免抢插件焦点
const NON_FIELD_FOCUSABLE =
'button, a[href], area[href], object, embed, summary, [tabindex]:not([tabindex="-1"])';

// 改造后 applyInputsOnlyTab：跳过 Radix Dialog/Sheet 焦点陷阱内的元素
function applyInputsOnlyTab(root: ParentNode) {
for (const el of root.querySelectorAll<HTMLElement>(NON_FIELD_FOCUSABLE)) {
// 跳过真正的表单控件
if (el.matches('input, textarea, select')) continue;
// 新增：Radix Dialog/Sheet 焦点陷阱依赖 tabbable；强行 -1 会与 FocusScope 互殴卡死主线程
if (el.closest('[role="dialog"], [data-radix-focus-guard]')) continue;
// 其余元素标 -1，让 Tab 只在表单字段间跳
el.tabIndex = -1;
}
}
```

**变更摘要**：selector 移除 `iframe`，不再夺走插件内部 Tab 序；扫描时跳过 `[role="dialog"]` / `[data-radix-focus-guard]` 内的元素，把焦点管理权还给 Radix `FocusScope`，避免互殴卡死。

### 4.10 `createFederation` 透传 appearance 选项（`packages/federation-kit/src/createFederation.ts`）

**对比范围**：`FederationHostOptions` 新增 `getAppearance` / `onAppearanceChange` 字段；`attachIframeBridge` 调用处透传。

**改动前** · `packages/federation-kit/src/createFederation.ts`（基线，约 L130–L145 与 L239–L245 节选）

```typescript
// 旧版 FederationHostOptions（节选；其余字段省略）
export type FederationHostOptions<
// ...类型参数（未改动）
> = {
// ...（未改动）channel / getLocale / onLocaleChange / extraRpc 等
};
// ...（未改动）createFederation 主体
// 旧版 attachIframeBridge 调用：只传 channel / getLocale / onLocaleChange / extraRpc
attachIframeBridge(el, bridge, origin, {
// 通信频道
channel: config.iframeChannel,
// 读取 locale
getLocale: () => capabilities.getLocale(),
// locale 变化订阅
onLocaleChange: capabilities.onLocaleChange,
// 额外 RPC
extraRpc: config.iframeRpcHandlers,
}),
```

**改动后** · `packages/federation-kit/src/createFederation.ts`（当前，约 L130–L145 与 L244–L250 节选）

```typescript
// 导入 HostIframeAppearance 类型
import type {
// ...（未改动）其它类型
HostIframeAppearance,
HostTheme,
// ...（未改动）其它类型
} from './config/types';
// ...（未改动）
// 改造后 FederationHostOptions（节选；其余字段省略）
export type FederationHostOptions<
// ...类型参数（未改动）
> = {
// ...（未改动）channel / getLocale / onLocaleChange / extraRpc 等
// 新增：读取外观快照
getAppearance?: () => HostIframeAppearance;
// 新增：外观变化订阅
onAppearanceChange?: (
handler: (appearance: HostIframeAppearance) => void,
) => () => void;
};
// ...（未改动）createFederation 主体
// 改造后 attachIframeBridge 调用：透传 appearance 能力
attachIframeBridge(el, bridge, origin, {
// 通信频道
channel: config.iframeChannel,
// 读取 locale
getLocale: () => capabilities.getLocale(),
// locale 变化订阅
onLocaleChange: capabilities.onLocaleChange,
// 新增：读取外观快照
getAppearance: capabilities.getAppearance,
// 新增：外观变化订阅
onAppearanceChange: capabilities.onAppearanceChange,
// 额外 RPC
extraRpc: config.iframeRpcHandlers,
}),
```

**变更摘要**：`FederationHostOptions` 新增 `getAppearance` / `onAppearanceChange` 两个可选字段；`attachIframeBridge` 调用处透传 `capabilities.getAppearance` / `capabilities.onAppearanceChange`，把能力从宿主一路传到 iframe 桥。

### 4.11 `index.ts` 导出 `HostIframeAppearance`（`packages/federation-kit/src/index.ts`）

**对比范围**：barrel 导出新增 `HostIframeAppearance` 类型。

**改动前** · `packages/federation-kit/src/index.ts`（基线，约 L15 节选）

```typescript
// 旧版 barrel 导出（节选）
export type {
// ...（未改动）EnabledStore / HostCapabilities / HostHttpClient / HostTheme 等
};
```

**改动后** · `packages/federation-kit/src/index.ts`（当前，约 L15–L22 节选）

```typescript
// 改造后 barrel 导出（节选）
export type {
// ...（未改动）EnabledStore / HostCapabilities / HostHttpClient 等
// 新增：导出 HostIframeAppearance，供宿主侧 capability 文件引用
HostIframeAppearance,
// ...（未改动）HostPickedLocalFile / HostTheme / PickLocalFilesOptions 等
};
```

**变更摘要**：barrel 新增 `HostIframeAppearance` 导出，宿主侧 `iframeAppearance.ts` 可从 `@dnhyxc-ai/federation-kit` 直接 import。

### 4.12 `injectRoute` 注释与注册中心文档（`packages/federation-kit/src/types/index.ts` 与 `packages/federation-kit/docs/host-guide/注册中心.md`）

**对比范围**：`PluginDescriptor.injectRoute` 补注释；注册中心文档补 menu 字段省略说明。

**改动前** · `packages/federation-kit/src/types/index.ts`（基线，约 L18–L22 节选）

```typescript
// 旧版 PluginDescriptor（节选）
export interface PluginDescriptor {
// ...（未改动）id / version / hostApiRange
// 旧版 menu 字段（未改动）
menu?: { order: number; icon?: string };
// 旧版 injectRoute：无注释，语义不清晰
injectRoute?: boolean;
// ...（未改动）host 等
}
```

**改动后** · `packages/federation-kit/src/types/index.ts`（当前，约 L18–L22 节选）

```typescript
// 改造后 PluginDescriptor（节选）
export interface PluginDescriptor {
// ...（未改动）id / version / hostApiRange
// menu 字段（未改动）
menu?: { order: number; icon?: string };
// 新增注释：缺省 true；false 由业务页挂 PluginHostPage；true 且无 menu = 仅路由无侧栏
injectRoute?: boolean;
// ...（未改动）host 等
}
```

**改动后** · `packages/federation-kit/docs/host-guide/注册中心.md`（当前，约 L74–L77 节选）

```markdown
// 侧栏菜单字段说明（在原 menu 段前补一行注释）
// 省略 menu：仅注册路由、不出现在左侧 Sidebar（适合深链 / 其它页 navigate 进入）。
"menu": {
"order": 90,
// ...（未改动）icon 等
}
```

**变更摘要**：给 `injectRoute` 补注释明确三种形态（缺省 true / false / true 且无 menu）；注册中心文档补一行说明「省略 menu = 仅路由/内嵌，不进侧栏」，与插件中心 Tab 分类（见姊妹篇）对齐。

## 5. 行为变化与兼容性

- **向后兼容**：`getAppearance` / `onAppearanceChange` 均为可选；既有 federation-kit 接入方不实现这两个方法时，`attachIframeBridge` 走旧路径（仅下发 `bridge.api.theme` 字符串），iframe 行为与升级前一致。
- **iframe 行为变化**：实现了这两个方法的宿主，untrusted iframe 现在会收到 `init.appearance` 与后续 `appearance` 推送，可在 iframe 侧 `setProperty` 应用 `--brand-accent` 等变量；未实现的 iframe 不受影响。
- **路由切换稳定性**：`UntrustedIframe` cleanup 改为先 `about:blank` 再 detach，跨域 iframe 路由切换不再卡死 WebView 主线程；`ready` 单次应答避免 Strict Mode 双发。
- **Tab 序**：`useInputsOnlyTab` 不再把 iframe 标 `-1`，插件内部可聚焦元素恢复 Tab 序；Radix Dialog/Sheet 内的元素不再被强行 `-1`，焦点陷阱不再互殴。
- **未改动路径**：trusted 插件（MF 直挂，非 iframe）走的是 `@scope` 样式隔离，不经过 `attachIframeBridge`，本次改动不影响其外观。

## 6. 测试与回归建议

- 切换主站主题（light / dark / theme-black）与强调色（10 色），确认 untrusted iframe 内按钮、链接 hover、outline 按钮边框、Select 边框颜色均跟随主站。
- 在 theme-black（无 `.dark`）暗色态下，确认 iframe 内 outline 按钮边框**不消失**（回归 `dark:border-input` 误触）。
- React Strict Mode 下进入/离开 untrusted 插件页，确认控制台无 `ready` 重复应答日志、无内存泄漏（Performance 监听器数稳定）。
- 路由快速在 untrusted 插件页之间切换（含 macOS 桌面端），确认不白屏、不卡死主线程。
- 在 untrusted 插件内用 Tab 键，确认焦点能进入插件内部可聚焦元素；打开主站 Radix Dialog/Sheet 时 Tab 键不卡死。
- 关闭主站 `getAppearance` 能力（注释掉 `PluginHostPage` 的 `host` useMemo），确认 iframe 回退到仅 `theme` 字符串，行为与升级前一致。

## 7. 相关文档与代码索引

| 说明 | 路径 |
| ---- | ---- |
| HostIframeAppearance 类型与 HostCapabilities | `packages/federation-kit/src/config/types.ts` |
| 桥接握手与 appearance 推送 | `packages/federation-kit/src/bridge/attachIframeBridge.ts` |
| UntrustedIframe ref 稳定与 about:blank 卸载 | `packages/federation-kit/src/react/PluginHostView.tsx` |
| createFederation 透传 appearance | `packages/federation-kit/src/createFederation.ts` |
| barrel 导出 HostIframeAppearance | `packages/federation-kit/src/index.ts` |
| injectRoute 注释 | `packages/federation-kit/src/types/index.ts` |
| 注册中心 menu 字段文档 | `packages/federation-kit/docs/host-guide/注册中心.md` |
| iframe 外观能力实现 | `apps/frontend/src/federation/capabilities/iframeAppearance.ts` |
| 能力表登记 | `apps/frontend/src/federation/capabilities/README.md` |
| runtime readTheme / getAppearance / onAppearanceChange | `apps/frontend/src/federation/runtime/index.ts` |
| PluginHostPage 强制注入 appearance | `apps/frontend/src/federation/host/PluginHostPage.tsx` |
| Tab 序不夺 iframe 焦点 | `apps/frontend/src/hooks/useInputsOnlyTab.ts` |
| 姊妹篇：插件中心 Tab 分类与卡片重构 | `docs/plugins/插件中心卡片重构.md` |

---

（若与仓库最新源码不一致，以源码为准）
