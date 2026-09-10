# Markdown 高亮主题隔离

## 1. 背景与目标

`remote-docs` 是基于 Module Federation 的远程微应用，会被 Host 通过 `loadRemote` 嵌入到主应用文档流中。Host 自身已经全局注入了 `@dnhyxc-ai/markdown-kit/styles.css`（内含 `github-dark`）的扁平 `.hljs` 全局选择器，作用于整个 `document`。

当 remote-docs 通过 `MarkdownParser` 渲染代码块并尝试注入自己的 highlight 主题（`atom-one-dark` / `atom-one-light`）时，若继续使用扁平 `.hljs` / `.hljs-keyword` 选择器，会出现两个问题：

1. **CSS 特异性打架**：Host 的 realm 样式与 remote 注入的样式同处一个 `document` 下竞争，Host 端 realm 样式特异性更高，会压过 remote 的主题，导致"浅底浅字"或"暗底亮字"的视觉错位。
2. **主题污染**：remote 注入的扁平 `.hljs` 反过来又会污染 Host 现有 markdown 视图，造成双向干扰。

**目标**：让 remote-docs 渲染的代码块始终使用自己的 atom-one 主题，并且：

- 不污染 Host 现有 markdown 视图；
- 不被 Host 全局 `github-dark` 压过；
- 主题随 Host chrome（`body.theme-black` / `html.dark`）自动切换。

## 2. 改动范围

| 文件 | 类型 | 说明 |
| --- | --- | --- |
| `src/hooks/useHighlightTheme.ts` | 纯新增 | 主题探测、scope 注入、`prefixFlatCss`、`usePreferDark` |
| `src/components/design/Markdown/index.tsx` | 纯新增 | 共享 Markdown 预览组件，关闭 Parser 全局注入、改用 realm-scoped 注入 |
| `src/views/pluginDevGuide/FencedCodeBlock.tsx` | 替换 + 迁移 | 从 `src/components/FencedCodeBlock.tsx` 迁到 view 目录，复用 `design/Markdown` |
| `src/components/FencedCodeBlock.tsx` | 删除 | 旧实现（含 inline highlight 主题逻辑）已废弃 |

## 3. 实现思路

### 3.1 总览

```
Host document
├── <style> Host github-dark (.hljs 全局)
└── <div data-mf-style-realm="http://127.0.0.1:9013/remoteEntry.js">
    └── <style id="remote-docs-hljs-theme">
        /*mf-iso:3*/
        [data-mf-style-realm="http://127.0.0.1:9013/..."] .hljs { ... }
        [data-mf-style-realm="http://127.0.0.1:9013/..."] .hljs-keyword { ... }
```

remote-docs 在每个 Markdown 渲染根节点上调用 `applyScopedHighlightTheme`，把 atom-one 主题 CSS 中每一条扁平选择器的前面都拼上 `[data-mf-style-realm="<realm>"]`，从而形成"只命中我自己的代码块"的 scoped 样式。

### 3.2 关键决策（WHY）

1. **为什么 `MarkdownParser` 设置 `injectHighlightTheme: false`**：Host 已经全局注入了 hljs 样式。若 MarkdownParser 再走自己的全局注入逻辑，两套 `.hljs` 全局规则会冲突。因此 remote 关闭 Parser 的全局注入，改由 `applyScopedHighlightTheme` 自己注入带 realm 前缀的 scoped 样式。
2. **为什么主题探测用 `isHostChromeDark` 而不是 `html.dark`**：Host 切主题主要改 `body.theme-black`。若只看 `html.dark`，会读回 remote 自己写入的 class，形成反馈环；`isHostChromeDark` 先看 body 再看 html，避免回环。
3. **为什么 `scopeSelector` 手动转义引号/反斜杠，而不用 `CSS.escape`**：federation-kit 写到 DOM 的 `data-mf-style-realm` 属性值通常是入口 URL（如 `http://127.0.0.1:9013/remoteEntry.js`）。`CSS.escape` 会把 `:` `/` 等也转义，转义后的字符串与 DOM 属性值不再相等，选择器永远匹配不到。只有引号 `"` 和反斜杠 `\` 才会影响选择器解析，需要手动转义。
4. **为什么 `prefixFlatCss` 拆 `}` 后给每个选择器加前缀**：hljs 主题 CSS 是扁平的 `.hljs`、`.hljs-keyword` 等。要压过 Host 全局 `github-dark`，每条选择器都得有 realm 前缀。函数按 `}` 切分规则，取 `{` 前的选择器列表，按逗号拆开后逐个加前缀，最后重新拼回。
5. **为什么用 `MF_ISO_MARK = /*mf-iso:3*/`**：与 federation-kit 的 `MF_ISO_MARK` 对齐，Host HMR 在重新 wrap 样式时会识别这个标记，不再二次包装 style 元素，避免重复前缀。
6. **为什么用 `useLayoutEffect` 注入高亮主题**：必须在浏览器 paint 之前完成样式注入，否则会先出现无主题闪烁（flash of wrong theme）。`useLayoutEffect` 在 DOM 变更后同步执行、先于 paint。
7. **为什么 `usePreferDark` 用同一个 `isHostChromeDark`**：Mermaid 图需要知道亮/暗才能渲染配色。复用同一探测逻辑，保证 markdown 代码块与 mermaid 图的明暗判定一致。
8. **为什么 FencedCodeBlock 从 `components/` 迁到 `views/pluginDevGuide/`**：旧 FencedCodeBlock 自带 inline 高亮主题逻辑（自己 `new MarkdownParser` 并传 `highlightTheme`）。新版本委托给共享的 `design/Markdown` 组件，由它集中处理 realm-scoped 主题。迁到 view 目录体现它是一个 view-specific 包装，而非通用组件。
9. **为什么旧 FencedCodeBlock 引入 `markdown-kit/styles.css`，新版改用 `markdown-base.css`**：旧版用 kit 自带的 styles（含 `github-dark`）。新版用 `markdown-base.css`（不含 `github-dark`），把高亮主题分离出来由 `applyScopedHighlightTheme` 单独注入并加 realm 前缀。

## 4. 关键代码对比与注释

> 约定：以下代码块内**每一行源码上方**均有详细中文注释（100% 覆盖）。代码与仓库当前源码一致；行号为大致范围，以源码为准。

### 4.1 useHighlightTheme.ts — useHighlightTheme（纯新增）

**来源** · `src/hooks/useHighlightTheme.ts`（纯新增，约 L59–L74）

```typescript
// 导出高亮主题 hook：返回当前应使用的 hljs 主题 id
export function useHighlightTheme(): HighlightJsThemeId {
	// 用 DOM 当前主题初始化 state，避免首次渲染时主题不匹配
	const [theme, setTheme] = useState(highlightThemeFromDom);
	// 副作用：订阅 Host 主题切换
	useEffect(() => {
		// sync 函数：每次 DOM class 变化时重新读取主题
		const sync = () => setTheme(highlightThemeFromDom());
		// 进入时立即同步一次，保证 SSR / hydrate 后立即对齐
		sync();
		// 用 MutationObserver 监听 class 变化
		const mo = new MutationObserver(sync);
		// 监听 body.theme-*：Host 切主题主要改 body
		mo.observe(document.body, { attributes: true, attributeFilter: ['class'] });
		// 监听 html.dark：兜底兼容只改 html 的场景
		mo.observe(document.documentElement, {
			attributes: true,
			attributeFilter: ['class'],
		});
		// 卸载时断开 observer，避免内存泄漏
		return () => mo.disconnect();
	}, []); // 空依赖：observer 只创建一次
	// 返回当前主题 id（'atom-one-dark' 或 'atom-one-light'）
	return theme;
}
```

### 4.2 useHighlightTheme.ts — applyScopedHighlightTheme 与 scopeSelector（纯新增）

**来源** · `src/hooks/useHighlightTheme.ts`（纯新增，约 L29–L33 与 L79–L105）

```typescript
// scopeSelector：把 realm 字符串包装成 CSS 属性选择器
function scopeSelector(realm: string): string {
	// 先把反斜杠翻倍（CSS 字符串里 \\ 表示一个 \），再转义双引号
	const v = realm.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
	// 拼成 [data-mf-style-realm="..."]，值用双引号包裹
	return `[data-mf-style-realm="${v}"]`;
}

// applyScopedHighlightTheme：把 hljs 主题钉到 realm（或独立预览的 data-plugin-root）
export function applyScopedHighlightTheme(
	theme: HighlightJsThemeId, // 当前主题 id
	anchor: HTMLElement | null, // Markdown 根节点，用于回查 realm
): void {
	// SSR 兜底：document 不存在时直接返回
	if (typeof document === 'undefined') return;
	// 根据主题选择对应 CSS 文本（亮色用 light，其它都按暗色处理）
	const css =
		theme === 'atom-one-light'
			? HIGHLIGHT_THEME_CSS['atom-one-light']
			: HIGHLIGHT_THEME_CSS['atom-one-dark'];

	// 从 anchor 向上找 federation-kit 写的 data-mf-style-realm 属性
	const realm = anchor
		?.closest('[data-mf-style-realm]')
		?.getAttribute('data-mf-style-realm');
	// 找到 realm 就用 realm 选择器；否则退回 [data-plugin-root]（独立预览场景）
	const scopeSel = realm ? scopeSelector(realm) : '[data-plugin-root]';

	// 复用同一个 style 元素，避免反复创建
	let el = document.getElementById(STYLE_ID) as HTMLStyleElement | null;
	if (!el) {
		// 不存在就新建 style 标签
		el = document.createElement('style');
		// 用固定 id 标识，便于下次复用
		el.id = STYLE_ID;
		// 挂到 head，让 CSS 立即生效
		document.head.appendChild(el);
	}
	if (realm) {
		// 标记是 mf scoped 样式，便于 federation-kit 识别
		el.dataset.mfScoped = '1';
		// 记录样式归属的 realm，HMR 时按 realm 处理
		el.dataset.mfStyleOwner = realm;
	}
	// 写入 CSS：MF_ISO_MARK 头 + 每条规则选择器前缀加 scopeSel
	el.textContent = `${MF_ISO_MARK}\n${prefixFlatCss(css, scopeSel)}`;
}
```

### 4.3 useHighlightTheme.ts — prefixFlatCss（纯新增）

**来源** · `src/hooks/useHighlightTheme.ts`（纯新增，约 L36–L57）

```typescript
// prefixFlatCss：给扁平 hljs CSS 规则的选择器加前缀
function prefixFlatCss(css: string, sel: string): string {
	return css
		// 按 } 切分成每条规则块
		.split('}')
		.map((chunk) => {
			// 找 { 位置区分选择器串与样式体
			const i = chunk.indexOf('{');
			// 没有 { 说明是末尾残留或注释，原样返回
			if (i < 0) return chunk;
			// 取 { 前面的选择器串并 trim
			const selectors = chunk.slice(0, i).trim();
			// 取 { 开始的样式体（含 { 本身）
			const body = chunk.slice(i);
			// 空选择器、或 @media / @keyframes 等 at-rule：不加前缀
			if (!selectors || selectors.startsWith('@')) {
				// 若原 chunk 末尾少了 }（split 后会丢），补回 }
				return chunk.endsWith('}') || !body ? chunk : `${chunk}}`;
			}
			// 普通选择器：按逗号拆开（处理 "a, b, c" 形式）
			const prefixed = selectors
				.split(',')
				.map((s) => {
					// 单个选择器先 trim
					const t = s.trim();
					// 非空选择器前面拼上 sel（realm 选择器），空选择器原样保留
					return t ? `${sel} ${t}` : t;
				})
				.join(','); // 重新拼成逗号分隔
			// 拼回：前缀后的选择器 + 样式体 + }
			return `${prefixed}${body}}`;
		})
		.join(''); // 把所有规则重新拼回完整 CSS
}
```

### 4.4 useHighlightTheme.ts — usePreferDark（纯新增）

**来源** · `src/hooks/useHighlightTheme.ts`（纯新增，约 L107–L121）

```typescript
// 导出 prefer-dark hook：给 Mermaid 判断亮/暗
export function usePreferDark(): boolean {
	// 用 isHostChromeDark 初始化（与 useHighlightTheme 同源，避免反馈环）
	const [dark, setDark] = useState(isHostChromeDark);
	useEffect(() => {
		// sync 函数：每次 DOM class 变化重新计算暗色
		const sync = () => setDark(isHostChromeDark());
		// 进入立即同步一次
		sync();
		// 用 MutationObserver 监听 class 变化
		const mo = new MutationObserver(sync);
		// 同样盯 body.theme-* 与 html.dark
		mo.observe(document.body, { attributes: true, attributeFilter: ['class'] });
		mo.observe(document.documentElement, {
			attributes: true,
			attributeFilter: ['class'],
		});
		// 卸载时断开 observer
		return () => mo.disconnect();
	}, []);
	// 返回当前是否暗色（供 Mermaid 配色）
	return dark;
}
```

### 4.5 src/components/design/Markdown/index.tsx — Markdown 组件（纯新增）

> Markdown 组件依赖的几个关键常量 / 函数定义在 `useHighlightTheme.ts` 顶部（约 L15–L27）。为便于通读，先列出它们，再贴完整 Markdown 组件。

**来源** · `src/hooks/useHighlightTheme.ts`（纯新增，约 L15–L27，Markdown 组件依赖）

```typescript
// HIGHLIGHT_THEME_CSS：把 atom-one-dark / atom-one-light 两份主题 CSS 通过 ?raw 内联进来
const HIGHLIGHT_THEME_CSS = {
	// 暗色主题 CSS 文本（由 applyScopedHighlightTheme 选中后写入 scoped style）
	'atom-one-dark': atomOneDarkCss,
	// 亮色主题 CSS 文本
	'atom-one-light': atomOneLightCss,
} as const; // as const：让键类型收窄为字面量，便于 keyof 推断

// STYLE_ID：注入 style 元素的固定 id，便于复用而非反复创建
const STYLE_ID = 'remote-docs-hljs-theme';
// MF_ISO_MARK：与 federation-kit 的 MF_ISO_MARK 对齐，Host HMR 见此标记不再二次 wrap
const MF_ISO_MARK = '/*mf-iso:3*/';

// highlightThemeFromDom：从 DOM 当前 class 推断应使用的主题
function highlightThemeFromDom(): keyof typeof HIGHLIGHT_THEME_CSS {
	// 不能只看 html.dark：Host 切主题主要改 body.theme-black
	return isHostChromeDark() ? 'atom-one-dark' : 'atom-one-light';
}
```

**来源** · `src/components/design/Markdown/index.tsx`（纯新增，约 L1–L213）

```typescript
// 从 markdown-kit 引入围栏代码块动作绑定器、Mermaid tailwind 类、Parser
import {
	bindMarkdownCodeFenceActions,
	MARKDOWN_MERMAID_TAILWIND_CURSOR_ZOOM_IN_CLASS,
	MarkdownParser,
} from '@dnhyxc-ai/markdown-kit';
// 引入 React 侧 Mermaid 渲染 hook
import { useMermaidInMarkdownRoot } from '@dnhyxc-ai/markdown-kit/react';
// 用 markdown-base（无内嵌 github-dark）；高亮主题由 applyScopedHighlightTheme 注入
import '@dnhyxc-ai/markdown-kit/markdown-base.css';
// 引入 lucide 的 Component 图标作为空态占位
import { Component } from 'lucide-react';
// 从 react 引入 memo、RefObject、UIEvent、useCallback、useEffect、useLayoutEffect、useMemo、useRef
import {
	memo,
	type RefObject,
	type UIEvent,
	useCallback,
	useEffect,
	useLayoutEffect,
	useMemo,
	useRef,
} from 'react';
// 引入 ScrollArea 与 Spinner 两个 UI 组件
import { ScrollArea, Spinner } from '@/components/ui';
// 从 useHighlightTheme 引入三个能力：主题 hook、prefer-dark hook、scoped 注入函数
import { useHighlightTheme, usePreferDark, applyScopedHighlightTheme } from '@/hooks/useHighlightTheme';
// 引入 i18n
import { useI18n } from '@/i18n';
// 引入 cn（tailwind-merge）拼接 className
import { cn } from '@/lib/utils';

// MarkdownPreviewT：Host 侧约定的 i18n 函数签名（key + 可选 params，返回文案）
type MarkdownPreviewT = (
	key: string,
	params?: Record<string, unknown>,
) => string;

// MarkdownProps：Markdown 组件对外 props
export interface MarkdownProps {
	// markdown 源文本
	markdown: string;
	/** i18n；不传则用本地 `useI18n` / 中文默认文案 */
	t?: MarkdownPreviewT;
	// 外部传入的视口 ref（用于跟随滚动）
	viewportRef?: RefObject<HTMLDivElement | null>;
	/** 换篇时重置滚动 */
	documentIdentity?: string;
	// 视口滚动跟随回调
	onViewportScrollFollow?: () => void;
	// 是否启用 Mermaid
	enableMermaid?: boolean;
	// 是否包 ScrollArea；false 时直接嵌入父级滚动
	withScrollArea?: boolean;
	/** 源正文已有内容但 markdown 尚未就绪时展示加载态 */
	pendingSourceMarkdown?: string;
}

// downloadCodeFence：把围栏代码块内容下载成文件
function downloadCodeFence(payload: { code: string; filename: string }) {
	// 用 Blob + URL.createObjectURL 生成临时下载链接
	const url = URL.createObjectURL(
		// 类型设为 text/plain;charset=utf-8 保证中文不乱码
		new Blob([payload.code], { type: 'text/plain;charset=utf-8' }),
	);
	// 新建 a 标签触发下载
	const a = document.createElement('a');
	// href 指向临时 URL
	a.href = url;
	// download 指定文件名
	a.download = payload.filename;
	// 触发点击
	a.click();
	// 用完释放临时 URL
	URL.revokeObjectURL(url);
}

/**
 * 精简对齐 Host `@design/Markdown`（ParserMarkdownPreviewPane）：
 * MarkdownParser + 围栏工具栏 + 可选 Mermaid / ScrollArea。
 * 未移植：聊天吸顶条、Mermaid 岛分栏、选区右键、预览角标 FAB。
 */
// Markdown 组件本体，用 memo 包裹避免不必要重渲染
const Markdown = memo(function Markdown({
	// markdown 源文本
	markdown,
	// 外部 i18n 函数（可选）
	t: tProp,
	// 外部视口 ref
	viewportRef,
	// 文档 id（换篇时重置滚动用）
	documentIdentity,
	// 滚动跟随回调
	onViewportScrollFollow,
	// 默认开启 Mermaid
	enableMermaid = true,
	// 默认包 ScrollArea
	withScrollArea = true,
	// 源正文 pending 文本
	pendingSourceMarkdown,
}: MarkdownProps) {
	// 取本地 i18n t 函数
	const { t: i18nT } = useI18n();
	// 直接用外部传入的 t（或 undefined）
	const t = tProp;
	// label：统一文案取值，优先用外部 t，其次用本地 i18nT，最后用 fallback
	const label = useCallback(
		(key: string, fallback: string) => {
			// 若外部传入 t，优先用之
			if (t) return t(key) || fallback;
			// 否则按 key 走本地 i18nT
			if (key === 'common.copy') return i18nT('code.copy');
			if (key === 'common.download') return i18nT('code.download');
			if (key === 'markdown.preview.loading') return i18nT('markdown.preview.loading');
			if (key === 'markdown.preview.empty') return i18nT('markdown.preview.empty');
			// 兜底用 fallback 文案
			return fallback;
		},
		[t, i18nT], // 依赖外部 t 与 i18nT
	);

	// markdownRef：Markdown 根 div，applyScopedHighlightTheme 用它回查 realm
	const markdownRef = useRef<HTMLDivElement>(null);
	// previewHtmlRootRef：放渲染后 HTML 的根，Mermaid 也要监听它
	const previewHtmlRootRef = useRef<HTMLDivElement>(null);
	// localViewportRef：ScrollArea 内部视口节点 ref
	const localViewportRef = useRef<HTMLDivElement | null>(null);
	// 当前高亮主题（'atom-one-dark' / 'atom-one-light'）
	const highlightTheme = useHighlightTheme();
	// 当前是否暗色，供 Mermaid 配色
	const preferDark = usePreferDark();

	// 换篇时把视口滚动复位到 0
	useLayoutEffect(() => {
		// 视口优先级：包 ScrollArea 时用 localViewportRef；否则用外部 viewportRef
		const vp = withScrollArea
			? localViewportRef.current
			: (viewportRef?.current ?? null);
		if (vp) {
			// 纵向复位
			vp.scrollTop = 0;
			// 横向复位
			vp.scrollLeft = 0;
		}
	}, [documentIdentity, withScrollArea, viewportRef]);

	// 绑定围栏代码块的复制 / 下载动作
	useEffect(() => {
		// 取 markdown 根
		const el = markdownRef.current;
		// 根不存在直接返回
		if (!el) return;
		// bindMarkdownCodeFenceActions 返回 cleanup
		return bindMarkdownCodeFenceActions(el, {
			// 下载动作：调用 downloadCodeFence
			onDownload(payload) {
				downloadCodeFence(payload);
			},
		});
	}, []); // 只绑定一次

	// assignViewportRef：把 ScrollArea 视口 ref 同时塞给本地与外部
	const assignViewportRef = useCallback(
		(node: HTMLDivElement | null) => {
			// 本地保存
			localViewportRef.current = node;
			// 若外部传了 viewportRef，也同步赋值
			if (viewportRef) viewportRef.current = node;
		},
		[viewportRef],
	);

	// 创建 MarkdownParser 实例（按依赖缓存）
	const parser = useMemo(
		() =>
			new MarkdownParser({
				// 不用 Parser 全局注入：嵌入 Host 时会被 styles/realm 特异性压过
				injectHighlightTheme: false,
				// 启用围栏工具栏（复制 / 下载按钮）
				enableChatCodeFenceToolbar: true,
				// 工具栏文案
				chatCodeFenceToolbarTexts: {
					// 复制按钮文案
					copy: label('common.copy', '复制'),
					// 下载按钮文案
					download: label('common.download', '下载'),
				},
				// 给标题渲染 source-line 属性，便于源码定位
				enableHeadingSourceLineAttr: true,
				// 是否启用 Mermaid（由 prop 决定）
				enableMermaid,
			}),
		[label, enableMermaid], // 依赖：label 与 enableMermaid
	);

	// 把 markdown 源文本渲染成 HTML
	const html = useMemo(
		() => parser.render(markdown, { enableMermaid }),
		[parser, markdown, enableMermaid],
	);

	// 在 paint 前注入 scoped 高亮主题，避免无主题闪烁
	useLayoutEffect(() => {
		// 用 markdownRef 回查 realm，注入对应主题 CSS
		applyScopedHighlightTheme(highlightTheme, markdownRef.current);
	}, [highlightTheme, html]); // 主题或 HTML 变化时重新注入

	// Mermaid 渲染：监听 previewHtmlRootRef，按 preferDark 渲染
	useMermaidInMarkdownRoot({
		// Mermaid 容器
		rootRef: previewHtmlRootRef,
		// 亮 / 暗
		preferDark,
		// 触发重新渲染的 trigger（用 html）
		trigger: html,
		// parser 配置
		parser: { enableMermaid },
	});

	// 滚动回调：转发给外部 onViewportScrollFollow
	const handleViewportScroll = useCallback(
		(_e: UIEvent<HTMLDivElement>) => {
			// 调用外部回调（如有）
			onViewportScrollFollow?.();
		},
		[onViewportScrollFollow],
	);

	// previewHtmlRoot：渲染后 HTML 的容器
	const previewHtmlRoot = (
		<div
			// ref 给 Mermaid 监听用
			ref={previewHtmlRootRef}
			// className：大量 tailwind 子选择器覆盖，对齐 Host 样式
			className={cn(
				// 通用 markdown-body 样式覆盖：宽度、换行、滚动、透明背景、文字色
				'[&_.markdown-body]:min-w-0 [&_.markdown-body]:max-w-none [&_.markdown-body]:wrap-break-word [&_.markdown-body]:overflow-x-auto [&_.markdown-body]:bg-transparent! [&_.markdown-body]:text-textcolor/90! [&_.markdown-body_:is(h1,h2,h3,h4,h5,h6)]:scroll-mt-3 [&_.markdown-body_pre]:max-w-full [&_.markdown-body_pre]:overflow-x-auto [&_.markdown-body_table]:block [&_.markdown-body_table]:max-w-full [&_.markdown-body_table]:overflow-x-auto',
				// 启用 Mermaid 时追加光标 zoom-in 类
				enableMermaid && MARKDOWN_MERMAID_TAILWIND_CURSOR_ZOOM_IN_CLASS,
			)}
		>
			// 用 dangerouslySetInnerHTML 直接挂渲染后的 HTML
			<div dangerouslySetInnerHTML={{ __html: html }} />
		</div>
	);

	// previewPending：源正文有内容但 markdown 本体还没就绪
	const previewPending =
		!markdown.trim() && Boolean(pendingSourceMarkdown?.trim());

	return (
		<div
			// markdownRef：applyScopedHighlightTheme 用它回查 realm
			ref={markdownRef}
			// 根容器样式
			className={cn(
				// 相对定位 + 占满父级 + contain inline-size + 文本可选
				'relative h-full min-h-0 min-w-0 max-w-full w-full contain-[inline-size] select-text',
				// 包 ScrollArea 时 overflow hidden，否则 visible
				withScrollArea ? 'overflow-hidden' : 'overflow-visible',
			)}
		>
			{markdown ? ( // 有 markdown 内容
				withScrollArea ? ( // 包 ScrollArea 分支
					<ScrollArea
						// 视口 ref 通过 assignViewportRef 同时给本地与外部
						ref={assignViewportRef}
						// 双向滚动条
						scrollbars="both"
						// 滚动事件转发
						onScroll={handleViewportScroll}
						// ScrollArea 自身样式
						className="h-full min-h-0 min-w-0 max-w-full w-full bg-transparent"
						// 视口内层 div 强制 box-border / block / 全宽
						viewportClassName="[&>div]:!box-border [&>div]:!block [&>div]:!w-full [&>div]:!min-w-0 [&>div]:!max-w-full overscroll-y-contain"
					>
						// 内层加 p-3 留白
						<div className="box-border min-w-0 max-w-full w-full p-3">
							{previewHtmlRoot}
						</div>
					</ScrollArea>
				) : (
					// 嵌入父级滚动（如插件手册代码块）：不加 p-3，避免外框与工具栏之间多出空白
					previewHtmlRoot
				)
			) : previewPending ? ( // 源 pending：显示加载态
				<div className="flex h-full min-h-0 items-center justify-center gap-2 p-3 text-sm text-textcolor/70">
					<Spinner className="size-4" />
					{label('markdown.preview.loading', '内容加载中…')}
				</div>
			) : ( // 空态：显示空图标 + 空文案
				<div className="flex h-full w-full min-w-0 max-w-full flex-col items-center justify-center gap-5 box-border p-3">
					<Component className="h-16 w-16 animate-bounce text-textcolor/70" />
					<div className="text-sm text-textcolor/80">
						{label('markdown.preview.empty', '预览内容为空')}
					</div>
				</div>
			)}
		</div>
	);
});

// 默认导出 Markdown
export default Markdown;
```

### 4.6 src/views/pluginDevGuide/FencedCodeBlock.tsx — 改动前/后对比

#### 改动前

**改动前** · `src/components/FencedCodeBlock.tsx`（基线，已删除）

```typescript
// 从 markdown-kit 引入围栏动作绑定器、主题类型、Parser
import {
	bindMarkdownCodeFenceActions,
	type HighlightJsThemeId,
	MarkdownParser,
} from '@dnhyxc-ai/markdown-kit';
// 直接引入 kit 自带 styles.css（含 github-dark，会与 Host 全局样式冲突）
import '@dnhyxc-ai/markdown-kit/styles.css';
// 从 react 引入 memo、useEffect、useMemo、useRef、useState
import { memo, useEffect, useMemo, useRef, useState } from 'react';
// 引入 i18n
import { useI18n } from '@/i18n';
// 引入 PluginGuideCode 类型
import type { PluginGuideCode } from '@/views/pluginDevGuide/pluginDevGuideSections';

/** 与 Host `getChatMarkdownHighlightTheme` 对齐：暗色 atom-one-dark，亮色 atom-one-light */
// highlightThemeFromDom：只看 html.dark（容易读回自己写入的 class，形成反馈环）
function highlightThemeFromDom(): HighlightJsThemeId {
	return document.documentElement.classList.contains('dark')
		? 'atom-one-dark'
		: 'atom-one-light';
}

// useHighlightTheme：旧实现，只盯 documentElement class
function useHighlightTheme(): HighlightJsThemeId {
	// 主题 state
	const [theme, setTheme] = useState(highlightThemeFromDom);
	useEffect(() => {
		// 只盯 root（documentElement），漏了 body.theme-black
		const root = document.documentElement;
		// sync：重新读取主题
		const sync = () => setTheme(highlightThemeFromDom());
		// MutationObserver 监听 root class
		const mo = new MutationObserver(sync);
		mo.observe(root, { attributes: true, attributeFilter: ['class'] });
		// 卸载断开
		return () => mo.disconnect();
	}, []);
	// 返回当前主题
	return theme;
}

/**
 * 与 Host `pluginDevGuide` 一致：把 { lang, code } 包成单一 fenced Markdown，
 * 经 MarkdownParser 渲染（高亮 + 围栏工具栏）；关闭 Mermaid / 浮动吸顶条。
 */
// FencedCodeBlock 组件本体
export const FencedCodeBlock = memo(function FencedCodeBlock({
	// 围栏 id
	id,
	// 代码块内容（lang + code）
	code,
}: {
	id: string;
	code: PluginGuideCode;
}) {
	// 取 i18n t
	const { t } = useI18n();
	// rootRef：root div
	const rootRef = useRef<HTMLDivElement>(null);
	// 当前高亮主题（旧 hook，只盯 html）
	const highlightTheme = useHighlightTheme();

	// fenced：把 lang + code 拼成 markdown 围栏
	const fenced = useMemo(
		() => `\`\`\`${code.lang}\n${code.code}\n\`\`\``,
		[code.lang, code.code],
	);

	// 自建 MarkdownParser（每次主题变就重建）
	const parser = useMemo(
		() =>
			new MarkdownParser({
				// 把 highlightTheme 直接传给 Parser，由 Parser 全局注入主题
				// 嵌入 Host 时会被 realm 样式压过，造成浅底浅字
				highlightTheme,
				// 启用围栏工具栏
				enableChatCodeFenceToolbar: true,
				// 工具栏文案
				chatCodeFenceToolbarTexts: {
					copy: t('code.copy'),
					download: t('code.download'),
				},
				// 关闭 Mermaid
				enableMermaid: false,
			}),
		[highlightTheme, t],
	);

	// 渲染 HTML
	const html = useMemo(
		() => parser.render(fenced, { enableMermaid: false }),
		[parser, fenced],
	);

	// 绑定围栏下载动作
	useEffect(() => {
		// root 元素
		const el = rootRef.current;
		if (!el) return;
		// bindMarkdownCodeFenceActions 返回 cleanup
		return bindMarkdownCodeFenceActions(el, {
			// 下载处理：生成临时 a 标签点击下载
			onDownload(payload) {
				// 生成临时 URL
				const url = URL.createObjectURL(
					new Blob([payload.code], { type: 'text/plain;charset=utf-8' }),
				);
				// 新建 a 标签
				const a = document.createElement('a');
				// href 指向临时 URL
				a.href = url;
				// download 文件名
				a.download = payload.filename;
				// 触发点击
				a.click();
				// 释放临时 URL
				URL.revokeObjectURL(url);
			},
		});
	}, []); // 只绑定一次

	return (
		// root div，挂 rootRef
		<div
			// 围栏 id
			id={id}
			// ref
			ref={rootRef}
			// 样式：圆角边框 + 透明背景 + 文字色 + 横向滚动
			className="my-4 overflow-hidden rounded-lg border border-theme-white/10 [&_.markdown-body]:min-w-0 [&_.markdown-body]:max-w-none [&_.markdown-body]:bg-transparent! [&_.markdown-body]:text-textcolor/90! [&_.markdown-body_pre]:max-w-full [&_.markdown-body_pre]:overflow-x-auto"
			// 直接挂渲染 HTML
			dangerouslySetInnerHTML={{ __html: html }}
		/>
	);
});
```

#### 改动后

**改动后** · `src/views/pluginDevGuide/FencedCodeBlock.tsx`（当前，约 L1–L31）

```typescript
// 从 react 引入 memo、useMemo
import { memo, useMemo } from 'react';
// 复用共享的 design/Markdown 组件，集中处理 realm-scoped 主题
import Markdown from '@/components/design/Markdown';
// 引入 PluginGuideCode 类型
import type { PluginGuideCode } from '@/views/pluginDevGuide/pluginDevGuideSections';

/**
 * 与 Host `pluginDevGuide` 一致：把 { lang, code } 包成单一 fenced Markdown，
 * 交给 design/Markdown（MarkdownParser）渲染。
 */
// FencedCodeBlock 组件本体
export const FencedCodeBlock = memo(function FencedCodeBlock({
	// 围栏 id
	id,
	// 代码块内容（lang + code）
	code,
}: {
	id: string;
	code: PluginGuideCode;
}) {
	// fenced：把 lang + code 拼成 markdown 围栏
	const fenced = useMemo(
		() => `\`\`\`${code.lang}\n${code.code}\n\`\`\``,
		[code.lang, code.code],
	);

	return (
		// 外层只保留垂直间距
		<div className="my-4">
			// 委托给 design/Markdown，主题 / realm / 围栏工具栏都由它内部统一处理
			<Markdown
				// markdown 源文本
				markdown={fenced}
				// 文档 id：换篇时重置滚动
				documentIdentity={id}
				// 关闭 Mermaid
				enableMermaid={false}
				// 不包 ScrollArea，嵌入父级滚动，避免外框与工具栏间多出空白
				withScrollArea={false}
			/>
		</div>
	);
});
```

## 5. 兼容性与影响

- **向 Host 兼容**：仅当 Markdown 根节点能找到 `[data-mf-style-realm]` 时才走 realm scoped 路径；独立运行（无 Host）时退回 `[data-plugin-root]` 选择器，仍可正常工作。
- **对 Host 无污染**：remote 注入的所有 hljs 规则都被 realm 选择器限定，不会污染 Host 原有 markdown 视图。
- **MF_ISO_MARK 防 HMR wrap**：Host HMR 触发重新 wrap 时，识别 `/*mf-iso:3*/` 标记后不会二次包装，避免重复前缀导致的选择器嵌套。
- **主题切换**：通过 `MutationObserver` 监听 `body` 与 `html` 的 `class`，自动响应 Host 主题切换。
- **Mermaid 配色**：与代码块共享 `isHostChromeDark` 探测，避免亮 / 暗判定不一致。
- **旧 FencedCodeBlock 删除**：原 `src/components/FencedCodeBlock.tsx` 已废弃，所有引用方都改为 `src/views/pluginDevGuide/FencedCodeBlock.tsx`。
- **无 SSR 影响**：`applyScopedHighlightTheme` 在 `typeof document === 'undefined'` 时直接 return，SSR 不会崩。

## 6. 相关源码路径

| 文件 | 说明 |
| --- | --- |
| `src/hooks/useHighlightTheme.ts` | 主题探测、scope 注入、`prefixFlatCss`、`usePreferDark` |
| `src/components/design/Markdown/index.tsx` | 共享 Markdown 预览组件 |
| `src/views/pluginDevGuide/FencedCodeBlock.tsx` | 插件手册代码块包装（迁后） |
| `src/hooks/useHostBridgeSync.ts` | `isHostChromeDark` 实现（被 `useHighlightTheme` 复用） |
| `src/components/FencedCodeBlock.tsx` | 旧实现（已删除，可在 `git show b812924` 查阅） |

---

（若与仓库最新源码不一致，以源码为准）
