# ParserMarkdownPreviewPane（Markdown 预览面板组件）实现归档

> 文档角色：implementation-doc-from-diff 归档稿
> 改动一轮：知识库预览 + 助手同开时滚动卡顿修复 — Markdown 预览面板改造
> 状态：已落地（2026-07）

## 1. 背景与目标

知识库左栏 `ParserMarkdownPreviewPane` 在与右栏 AI 助手（尤其流式输出）同屏时，滚动预览会出现明显卡顿。根因集中在三处：

1. **FAB（置顶/置底角标）热路径 `setState` 过频**：每次 `scroll` 事件都调用 `setPreviewScrollFabMode`，即使 mode 未变也触发 React re-render；re-render 又连带触发整棵预览树 reconcile。
2. **Mermaid 岛屿布局在 render 路径内同步 parse**：`fenceParts.map` 内联 `parser.render` + `shiftMarkdownPreviewHeadingLineAttrs`，任意父级 re-render（含 FAB）都会整篇重跑 Markdown parse，主线程被占满。
3. **`useChatCodeFloatingToolbar` 无法硬关**：调用方仅用 `enableCodeFloatingToolbar ? { layoutDeps } : undefined` 控制传参，hook 内仍挂 resize/RO/layout effect，助手同开时仍与左栏 scroll 争用主线程。

本轮改造目标：

| 目标 | 手段 |
|------|------|
| 滚动热路径零多余 render | `previewScrollFabModeRef` 与 state 镜像，mode 不变时不 `setState` |
| 岛屿布局 parse 移出 render | `useMemo` 预渲染 `mermaidIslandMarkdownHtml` |
| 左栏代码吸顶条可硬关 | `useChatCodeFloatingToolbar` 新增 `enabled` 字段 |
| 功能不变 | FAB、Mermaid、代码栏、贴底、分屏开关行为与改前一致 |

> 延伸阅读：滚动层完整根因表与流式贴底合并见 [../knowledge/知识预览滚动卡顿.md](../knowledge/知识预览滚动卡顿.md)；编辑↔预览滚动恢复见 [Markdown预览编辑滚动恢复.md](./Markdown预览编辑滚动恢复.md)；TOC/hash 跳转见 [Markdown预览目录哈希导航.md](./Markdown预览目录哈希导航.md)。

## 2. 改动范围

| 路径 | 变更类型 |
|------|----------|
| `apps/frontend/src/components/design/Markdown/index.tsx` | FAB ref 去重、`mermaidIslandMarkdownHtml` 预 memo、`useChatCodeFloatingToolbar` 调用方接入 `enabled`、`handleViewportScroll` 注释收敛、FAB `useEffect` 同步 ref |

本文聚焦该组件本身的实现归档（含未在 diff 中变动、但属于本轮功能闭环的既有结构，以纯新增形式摘录）。`useChatCodeFloatingToolbar` hook 内部 `enabled` 门禁与 scroll rAF 合并、`useStickToBottomScroll` 流式贴底合并由 [../knowledge/知识预览滚动卡顿.md](../knowledge/知识预览滚动卡顿.md) 主文档负责，本文不重复粘贴。

## 3. 实现思路

1. **FAB mode 去重**：新增 `previewScrollFabModeRef` 与 `previewScrollFabMode` state 镜像；`refreshPreviewScrollFab` 先计算 `next`，与 ref 比对，仅在不等时写 ref + setState。`scroll` 帧零 React 更新。
2. **岛屿 HTML 预 memo**：把原本写在 `fenceParts.map` render 内的 `parser.render(part.text, { enableMermaid: false })` + `shiftMarkdownPreviewHeadingLineAttrs` 上提到 `useMemo(mermaidIslandMarkdownHtml, [hasMermaidIslandLayout, fenceParts, parser])`；render 阶段按索引取缓存 HTML，零 parse。
3. **吸顶条硬关**：调用方把 `enableCodeFloatingToolbar ? { layoutDeps: [markdown] } : undefined` 改为始终传 `{ enabled: enableCodeFloatingToolbar, layoutDeps: [markdown] }`；hook 内 `enabled=false` 时所有 effect 早 return（详见主文档）。
4. **`handleViewportScroll` 注释收敛**：删除逐行说明注释，保留逻辑；行为不变，仅减少源码噪音。
5. **FAB `useEffect` 同步 ref**：关闭 FAB 时除 `setPreviewScrollFabMode('hidden')` 外，同步 `previewScrollFabModeRef.current = 'hidden'`，避免 ref 与 state 不一致导致后续 `refreshPreviewScrollFab` 误判。
6. **`previewPending` 兜底**：源正文已有内容但 `markdown` deferred 未追平时，展示 `Loading` 而非「预览为空」，避免一帧空态闪烁。

## 4. 关键代码与逐行注释

### 4.1 imports（纯新增摘录）

**对比范围**：组件顶部 import 区，本轮功能依赖的模块导入。

**改动后** · `apps/frontend/src/components/design/Markdown/index.tsx`（当前，约 L1–L43）

```typescript
// 加载态组件，用于 deferred 未就绪时的预览兜底
import Loading from '@design/Loading';
// Mermaid 岛屿组件：流式/完成态 mermaid 围栏渲染
import { MermaidFenceIsland } from '@design/MermaidFenceIsland';
// Mermaid 围栏顶栏 + sticky 吸顶 + code/diagram 切换容器
import { MermaidFenceToolbarActions } from '@design/MermaidFenceToolbar';
// FAB 提示气泡
import Tooltip from '@design/Tooltip';
// markdown-kit：代码围栏动作绑定、mermaid cursor class、拆分片段类型、parser
import {
	bindMarkdownCodeFenceActions,
	MARKDOWN_MERMAID_TAILWIND_CURSOR_ZOOM_IN_CLASS,
	type MarkdownMermaidSplitPart,
	MarkdownParser,
} from '@dnhyxc-ai/markdown-kit';
// markdown-kit/react：在 root 上扫描 .mermaid 并渲染
import { useMermaidInMarkdownRoot } from '@dnhyxc-ai/markdown-kit/react';
// ScrollArea 容器（Radix）
import { ScrollArea } from '@ui/index';
// FAB 图标 + 空态图标
import { ChevronDown, ChevronUp, Component } from 'lucide-react';
// React hooks 与类型
import {
	memo,
	type RefObject,
	type UIEvent,
	useCallback,
	useEffect,
	useLayoutEffect,
	useMemo,
	useRef,
	useState,
} from 'react';
// 聊天 markdown 高亮主题
import { getChatMarkdownHighlightTheme } from '@/constants';
// hooks：hash 跳转、mermaid 点击预览、mermaid 图片预览、主题
import {
	useMarkdownHashLinkViewportScroll,
	useMermaidDiagramClickPreview,
	useMermaidImagePreview,
	useTheme,
} from '@/hooks';
// 代码吸顶条组件 + hook
import {
	ChatCodeFloatingToolbar,
	useChatCodeFloatingToolbar,
} from '@/hooks/useChatCodeFloatingToolbar';
// Tailwind class 合并工具
import { cn } from '@/lib/utils';
// 代码块下载工具
import { downloadChatCodeBlock } from '@/utils/chatCodeToolbar';
// markdown 拆分工具：hash、流式 fallback HTML、含未闭合尾的 mermaid 岛拆分
import {
	hashText,
	mermaidStreamingFallbackHtml,
	splitForMermaidIslandsWithOpenTail,
} from '@/utils/splitMarkdownFences';
```

**变更摘要**：本轮未新增/删除 import；此处摘录用于建立后续章节的符号来源索引。

### 4.2 `shiftMarkdownPreviewHeadingLineAttrs` 函数（纯新增摘录）

**对比范围**：模块级纯函数，分段渲染时校正 heading 行号属性。

**改动后** · `apps/frontend/src/components/design/Markdown/index.tsx`（当前，约 L44–L57）

```typescript
/**
 * 分段 `render` 时标题 `data-md-heading-line` 为片段内 1-based；
 * 加上 `lineBase0`（整篇 normalized 源里该段首行的 0-based 行下标）得到与 Monaco 一致的全文 1-based 行号。
 */
// 入参：分段渲染出的 HTML 字符串；该段首行在整篇里的 0-based 行号
function shiftMarkdownPreviewHeadingLineAttrs(
	html: string,
	lineBase0: number,
): string {
	// lineBase0 为 0 时无需偏移，直接返回原 HTML
	if (!lineBase0) return html;
	// 正则匹配所有 heading 的 data-md-heading-line 属性，捕获其中的 1-based 数字
	return html.replace(
		/data-md-heading-line="(\d+)"/g,
		// 替换回调：lineBase0 + 段内 1-based = 全文 1-based 行号
		(_, d) => `data-md-heading-line="${lineBase0 + Number.parseInt(d, 10)}"`,
	);
}
```

**变更摘要**：本轮未改动该函数；摘录因为 §4.8 `mermaidIslandMarkdownHtml` 内部调用它，需建立符号链路。

### 4.3 `PreviewScrollCornerFabMode` 类型（纯新增摘录）

**对比范围**：FAB 展示模式字面量联合类型。

**改动后** · `apps/frontend/src/components/design/Markdown/index.tsx`（当前，约 L59–L60）

```typescript
/** 纯预览模式右下角：可滚动时显示置底，触底后切换为置顶 */
// hidden=不可滚/功能关；toBottom=可滚且未贴底；toTop=已贴底
type PreviewScrollCornerFabMode = 'hidden' | 'toBottom' | 'toTop';
```

**变更摘要**：类型本身未改；§4.5 引入的 `previewScrollFabModeRef` 复用此类型。

### 4.4 `Props` 类型新增字段（纯新增摘录）

**对比范围**：`ParserMarkdownPreviewPaneProps` 接口；本轮功能闭环相关字段为 `enableCodeFloatingToolbar` / `pendingSourceMarkdown` / `embedInParentScroll`（`embedInParentScroll` 为派生常量，非 props，见 §4.6）。

**改动后** · `apps/frontend/src/components/design/Markdown/index.tsx`（当前，约 L67–L93）

```typescript
// 组件 Props 接口
interface ParserMarkdownPreviewPaneProps {
	// 待渲染的 markdown 源串
	markdown: string;
	/** i18n 翻译函数（可选）；不传则沿用组件内默认中文文案 */
	t?: MarkdownPreviewT;
	/**
	 * 分屏同步滚动：指向 ScrollArea 的 Viewport（Radix ref 落在 viewport 上）。
	 * 与 `withScrollArea={false}` 联用时：不再套内层 ScrollArea，由宿主提供唯一滚动层，
	 * 使 `MermaidFenceToolbar` 的 `closest([data-slot="scroll-area-viewport"])` 与代码吸顶条与宿主 viewport 一致。
	 */
	// 外部传入的滚动 viewport ref（分享页/分屏嵌入场景）
	viewportRef?: RefObject<HTMLDivElement | null>;
	/** 逻辑文档切换时重置预览滚动，避免沿用上一篇的 scrollTop */
	// 文档唯一标识，变化时重置 scrollTop
	documentIdentity?: string;
	/** 分屏且开启跟随时：预览滚动时驱动编辑器对齐 */
	// 预览滚动时的外部跟随回调（通常驱动 Monaco 对齐）
	onViewportScrollFollow?: () => void;
	/** 纯预览模式：右下角置底 / 触底后置顶浮动按钮 */
	// 是否展示右下角 FAB
	showPreviewScrollCornerFab?: boolean;
	/** 是否启用 Mermaid 围栏解析与前端渲染 */
	// Mermaid 总开关
	enableMermaid?: boolean;
	/** 是否启用自动滚动 */
	// 是否包裹 ScrollArea
	withScrollArea?: boolean;
	/** 右栏助手等同屏重任务时关闭，避免与助手侧共用全局代码吸顶条 layout 争用主线程 */
	// 代码吸顶条硬开关；助手同开时 Monaco 传 false
	enableCodeFloatingToolbar?: boolean;
	/**
	 * 源正文已有内容但 `markdown` 尚未就绪（deferred/latch 追平帧）时展示加载态，避免误显示「预览为空」。
	 */
	// 源正文已有内容但 markdown 未就绪时的兜底源串
	pendingSourceMarkdown?: string;
}
```

**变更摘要**：`enableCodeFloatingToolbar` 与 `pendingSourceMarkdown` 是本轮卡顿修复与 deferred 兜底的对外 API；其余字段为既有结构。

### 4.5 `previewScrollFabModeRef` + `refreshPreviewScrollFab` 改造（before/after）

**对比范围**：组件内 FAB state/ref 声明 + `refreshPreviewScrollFab` 回调全函数。

**改动前** · `apps/frontend/src/components/design/Markdown/index.tsx`（基线，约 L119–L141）

```typescript
	// 预览右下角置顶/置底 FAB 的展示模式（hidden / toTop / toBottom）
	const [previewScrollFabMode, setPreviewScrollFabMode] =
		useState<PreviewScrollCornerFabMode>('hidden');

	// 读取当前主题，供 Markdown 高亮与 Mermaid 暗色偏好使用
	const { theme } = useTheme();

	// 根据滚动视口位置刷新 FAB 应显示「置顶」还是「置底」
	const refreshPreviewScrollFab = useCallback(() => {
		// 功能关闭时直接隐藏 FAB
		if (!showPreviewScrollCornerFab) {
			// 每次调用都会 setState，即使已是 hidden 也会触发 re-render
			setPreviewScrollFabMode('hidden');
			// 提前返回，不再读 viewport 度量
			return;
		}
		// 取有效滚动容器（本地 ScrollArea 或父级嵌入 viewport）
		const vp = effectiveScrollViewportRef.current;
		// ref 尚未挂载到 DOM 时无法计算
		if (!vp) return;
		// 读取当前滚动位置与可滚范围
		const { scrollTop, scrollHeight, clientHeight } = vp;
		// 最大可滚距离 = 内容高 − 视口高
		const maxScroll = scrollHeight - clientHeight;
		// 几乎不可滚（≤4px）则隐藏 FAB
		if (maxScroll <= 4) {
			// 无条件 setState，滚动过程中可能反复触发 render
			setPreviewScrollFabMode('hidden');
			// 结束
			return;
		}
		// 距底 8px 内视为「已在底部」，显示「置顶」
		const threshold = 8;
		// 否则显示「置底」；每次 scroll 事件都会 setState
		setPreviewScrollFabMode(
			scrollTop >= maxScroll - threshold ? 'toTop' : 'toBottom',
		);
	}, [showPreviewScrollCornerFab, effectiveScrollViewportRef]);
```

**改动后** · `apps/frontend/src/components/design/Markdown/index.tsx`（当前，约 L119–L144）

```typescript
	// 预览右下角 FAB 模式；驱动 React 渲染的唯一 state
	const [previewScrollFabMode, setPreviewScrollFabMode] =
		useState<PreviewScrollCornerFabMode>('hidden');
	// 与 state 镜像的 ref：scroll 热路径先比对 ref，避免同 mode 重复 setState
	const previewScrollFabModeRef = useRef<PreviewScrollCornerFabMode>('hidden');

	// 主题上下文，供 Markdown 高亮与 Mermaid 暗色偏好
	const { theme } = useTheme();

	// 刷新 FAB 模式；仅在 computed next !== ref 时 setState
	const refreshPreviewScrollFab = useCallback(() => {
		// 角标功能关闭
		if (!showPreviewScrollCornerFab) {
			// 仅当 ref 不是 hidden 时才写 state，避免无效 render
			if (previewScrollFabModeRef.current !== 'hidden') {
				// 同步 ref，后续 scroll 不再进入 setState 分支
				previewScrollFabModeRef.current = 'hidden';
				// 通知 React 隐藏 FAB
				setPreviewScrollFabMode('hidden');
			}
			// 结束
			return;
		}
		// 有效滚动 viewport
		const vp = effectiveScrollViewportRef.current;
		// ref 未挂载时无法度量
		if (!vp) return;
		// 度量三元组：当前滚动偏移、内容总高、视口高
		const { scrollTop, scrollHeight, clientHeight } = vp;
		// 最大可滚距离
		const maxScroll = scrollHeight - clientHeight;
		// 默认隐藏；可滚时再赋 toTop/toBottom
		let next: PreviewScrollCornerFabMode = 'hidden';
		// 可滚余量大于 4px 才展示 FAB
		if (maxScroll > 4) {
			// 贴底阈值 8px：近底 toTop，否则 toBottom
			next = scrollTop >= maxScroll - 8 ? 'toTop' : 'toBottom';
		}
		// mode 未变则直接返回，scroll 帧零 React 更新
		if (previewScrollFabModeRef.current === next) return;
		// 记录新 mode 到 ref
		previewScrollFabModeRef.current = next;
		// 仅此一处触发 re-render
		setPreviewScrollFabMode(next);
	}, [showPreviewScrollCornerFab, effectiveScrollViewportRef]);
```

**变更摘要**：新增 `previewScrollFabModeRef` 与 state 镜像；`refreshPreviewScrollFab` 改为先算 `next` 再与 ref 比对，mode 不变则跳过 setState。关闭分支亦加 ref 守卫，避免重复 `hidden` 触发 render。配合 §4.8，mode 变化触发的 re-render 不再连带 islands 重 parse。

### 4.6 `effectiveScrollViewportRef` + `assignViewportRef`（纯新增摘录）

**对比范围**：双 ref（本地 + 外部）写入机制；本轮未改动，但 `refreshPreviewScrollFab` / `syncScrollMetrics` / `useChatCodeFloatingToolbar` 均依赖它，摘录以闭环符号链路。

**改动后** · `apps/frontend/src/components/design/Markdown/index.tsx`（当前，约 L111–L118、L178–L184）

```typescript
	// markdown 根容器 ref（hash 跳转、代码围栏动作绑定目标）
	const markdownRef = useRef<HTMLDivElement>(null);
	/** 与 `dangerouslySetInnerHTML` 同层，保证 Mermaid 在内容写入后再扫描节点 */
	// 预览 HTML 根 ref；useMermaidInMarkdownRoot / useMermaidDiagramClickPreview 目标
	const previewHtmlRootRef = useRef<HTMLDivElement>(null);
	// 本地 ScrollArea 的 viewport ref（withScrollArea=true 时使用）
	const localViewportRef = useRef<HTMLDivElement | null>(null);
	/** 分享页等：父级 ScrollArea 为唯一滚动层，避免嵌套双 viewport 导致 Mermaid 顶栏/吸顶条失效 */
	// 派生常量：父级嵌入滚动模式 = 不包 ScrollArea 且外部传入 viewportRef
	const embedInParentScroll = !withScrollArea && Boolean(viewportRef);
	// 有效滚动 viewport：嵌入模式用外部 ref，否则用本地 ref
	const effectiveScrollViewportRef: RefObject<HTMLDivElement | null> =
		embedInParentScroll && viewportRef ? viewportRef : localViewportRef;
```

```typescript
	// 双 ref 写入回调：同时写本地 ref 与外部传入 ref
	const assignViewportRef = useCallback(
		(node: HTMLDivElement | null) => {
			// 本地 ref 始终更新（供 effectiveScrollViewportRef 回退）
			localViewportRef.current = node;
			// 外部 ref 仅在传入时更新（分享页/分屏嵌入场景）
			if (viewportRef) viewportRef.current = node;
		},
		// 依赖：外部 viewportRef（变化时重建回调）
		[viewportRef],
	);
```

**变更摘要**：本轮未改动；摘录因为 §4.5、§4.10 均以 `effectiveScrollViewportRef` 为滚动度量来源。

### 4.7 `useMarkdownHashLinkViewportScroll` / `bindMarkdownCodeFenceActions` 接入（纯新增摘录）

**对比范围**：目录/hash 跳转 hook 接入 + 代码围栏动作绑定 effect；本轮未改动。

**改动后** · `apps/frontend/src/components/design/Markdown/index.tsx`（当前，约 L160–L176）

```typescript
	// 目录 / 页内 #：与聊天共用 `useMarkdownHashLinkViewportScroll`
	const getMarkdownHashScrollViewport = useCallback(
		// 返回当前有效滚动 viewport（供 hash 跳转计算目标 scrollTop）
		() => effectiveScrollViewportRef.current,
		// 依赖：effectiveScrollViewportRef
		[effectiveScrollViewportRef],
	);
	// 接入 hash 跳转 hook：监听 markdownRef 内锚点点击，滚到对应 heading
	useMarkdownHashLinkViewportScroll(markdownRef, getMarkdownHashScrollViewport);

	// 代码围栏动作绑定（复制/下载等通过事件委托挂在根上）
	useEffect(() => {
		// 取 markdown 根 DOM
		const el = markdownRef.current;
		// 未挂载则跳过
		if (!el) return;
		// 绑定代码围栏动作；返回卸载函数
		const detachCodeFenceActions = bindMarkdownCodeFenceActions(el, {
			// 下载回调：调用 utils 中的下载实现
			onDownload(payload) {
				void downloadChatCodeBlock(payload.block, payload.lang);
			},
		});
		// 卸载时解绑
		return () => detachCodeFenceActions();
	}, []);
```

**变更摘要**：本轮未改动；摘录因为 FAB re-render 不应破坏这两个 effect（依赖 `[]` 或稳定 ref，与 state 无关）。

### 4.8 Mermaid island 布局：`splitForMermaidIslandsWithOpenTail` / `mermaidIslandMarkdownHtml` / `useMermaidInMarkdownRoot` / `renderMermaidPreviewPart`

**对比范围**：岛屿布局的拆分、HTML 预 memo、root 扫描、岛段渲染回调；其中 `mermaidIslandMarkdownHtml` 为本轮纯新增 useMemo，render 内消费由 inline parse 改为读 memo。

#### 4.8a `splitForMermaidIslandsWithOpenTail` 拆分（纯新增摘录，约 L201–L216）

**改动后** · `apps/frontend/src/components/design/Markdown/index.tsx`（当前，约 L201–L216）

```typescript
	// 拆分 markdown 为 markdown 段 + mermaid 岛段（含尾部未闭合 mermaid）
	const { parts: fenceParts, openMermaidId } = useMemo(
		() =>
			// 使用 splitForMermaidIslandsWithOpenTail 拆分 markdown
			// 将 mermaid 围栏（包括尾部未闭合的 mermaid 代码块）单独提取成岛（parts）
			// 支持流式 mermaid 渲染：未闭合块也能单独处理与展示
			splitForMermaidIslandsWithOpenTail({
				// 源 markdown
				markdown,
				// 单例 parser
				parser,
				// 仅启用时检测尾部未闭合的 mermaid 围栏
				enableOpenTail: enableMermaid,
				// 生成未闭合 mermaid 块的唯一 key 前缀
				openMermaidIdPrefix: 'pv-mmd-open-line-',
			}),
		// 依赖：markdown、parser、enableMermaid
		[markdown, parser, enableMermaid],
	);

	// 是否启用岛屿布局：enableMermaid 且 fenceParts 中存在 mermaid 段
	const hasMermaidIslandLayout = Boolean(
		enableMermaid && fenceParts.some((p) => p.type === 'mermaid'),
	);

	// 非岛屿布局时整篇 HTML（岛屿布局返回空串，由 fenceParts.map 渲染）
	const html = useMemo(() => {
		// 岛屿布局走 fenceParts，不在此整篇 render
		if (hasMermaidIslandLayout) return '';
		// 非岛屿布局：整篇 render，启用 mermaid 占位
		return parser.render(markdown, { enableMermaid });
	}, [hasMermaidIslandLayout, parser, markdown, enableMermaid]);
```

#### 4.8b `mermaidIslandMarkdownHtml` 预 memo（纯新增，本轮重点）

**改动后** · `apps/frontend/src/components/design/Markdown/index.tsx`（当前，约 L223–L231）

```typescript
	/** 岛屿布局下预渲染 markdown 段 HTML，避免 scroll FAB setState 时整篇重 parse */
	const mermaidIslandMarkdownHtml = useMemo(() => {
		// 非岛屿布局（无 mermaid 段）走整篇 html useMemo，此处返回 null
		if (!hasMermaidIslandLayout) return null;
		// 与 fenceParts 同序：每段 markdown 预 render 一次
		return fenceParts.map((part) => {
			// mermaid 段由 MermaidFenceIsland 渲染，map 位填 null
			if (part.type !== 'markdown') return null;
			// 段内禁用 mermaid 占位，避免与岛组件重复
			const rawHtml = parser.render(part.text, { enableMermaid: false });
			// 校正 heading 行号属性（+ lineBase0）供目录/hash 跳转
			return shiftMarkdownPreviewHeadingLineAttrs(rawHtml, part.lineBase0);
		});
	}, [hasMermaidIslandLayout, fenceParts, parser]);
```

#### 4.8c `useMermaidInMarkdownRoot` + `renderMermaidPreviewPart`（纯新增摘录，约 L233–L291）

**改动后** · `apps/frontend/src/components/design/Markdown/index.tsx`（当前，约 L233–L298）

```typescript
	/** 含 Mermaid 岛时不在整段 HTML 上跑 run（岛内自渲染），否则与聊天流一致扫描 .mermaid */
	const mermaidRootScanParser = useMemo(
		() => ({
			// 非岛屿布局才在整段 HTML 上扫描 .mermaid
			enableMermaid: enableMermaid && !hasMermaidIslandLayout,
		}),
		// 依赖：enableMermaid、hasMermaidIslandLayout
		[enableMermaid, hasMermaidIslandLayout],
	);

	// 在 previewHtmlRootRef 上扫描 .mermaid 节点并渲染
	useMermaidInMarkdownRoot({
		// 根 ref：与 dangerouslySetInnerHTML 同层
		rootRef: previewHtmlRootRef,
		// 暗色偏好
		preferDark: theme === 'black',
		// trigger：岛屿布局用 markdown（岛内自渲染，root 仅扫非岛部分），否则用 html
		trigger: hasMermaidIslandLayout ? markdown : html,
		// parser 配置对象
		parser: mermaidRootScanParser,
	});

	// mermaid 图片预览 modal 控制器
	const { openMermaidPreview, mermaidImagePreviewModal } =
		useMermaidImagePreview(t);

	// 渲染 mermaid 岛段：顶栏 + code/diagram 切换 + 流式 fallback
	const renderMermaidPreviewPart = useCallback(
		(
			// mermaid 段类型（Extract 出 type==='mermaid'）
			part: Extract<MarkdownMermaidSplitPart, { type: 'mermaid' }>,
			// 段索引
			i: number,
		) => {
			// blockId：完成态用 hash，未闭合态用 openMermaidId
			const blockId = part.complete
				? `mmd-${hashText(part.text)}`
				: (openMermaidId ?? `mmd-open-${i}`);

			return (
				<MermaidFenceToolbarActions
					// key：基于 blockId 稳定
					key={`pv-mm-wrap-${blockId}`}
					// 块 id
					blockId={blockId}
					// mermaid 源码
					mermaidCode={part.text}
					// 图片预览打开回调
					openMermaidPreview={openMermaidPreview}
					// 默认图表视图
					defaultViewMode="diagram"
					// 文档切换时重置内部状态
					resetKey={documentIdentity}
					// i18n
					t={t}
				>
					{(mode) =>
						// code 模式：渲染 fallback HTML（高亮源码）
						mode === 'code' ? (
							<div
								dangerouslySetInnerHTML={{
									__html: mermaidStreamingFallbackHtml(part.text),
								}}
							/>
						) : (
							// diagram 模式：渲染 MermaidFenceIsland
							<MermaidFenceIsland
								code={part.text}
								preferDark={theme === 'black'}
								isStreaming={!part.complete}
								openMermaidPreview={openMermaidPreview}
								className="monaco-preview-mode-mermaid"
							/>
						)
					}
				</MermaidFenceToolbarActions>
			);
		},
		// 依赖：documentIdentity、openMermaidId、openMermaidPreview、theme、t
		[documentIdentity, openMermaidId, openMermaidPreview, theme, t],
	);

	// mermaid 图表点击预览：在 root 上监听 .mermaid 点击
	useMermaidDiagramClickPreview(
		// root ref
		previewHtmlRootRef,
		// 打开图片预览回调
		openMermaidPreview,
		// mermaid 总开关
		enableMermaid,
		// trigger：岛屿布局用 markdown，否则用 html
		hasMermaidIslandLayout ? markdown : html,
	);
```

#### 4.8d 渲染消费侧（before/after，本轮重点）

**改动前** · `apps/frontend/src/components/design/Markdown/index.tsx`（基线，约 L396–L410）

```typescript
							// 处理普通 markdown 块，禁用 mermaid，避免二次渲染
							const rawHtml = parser.render(part.text, {
								enableMermaid: false,
							});
							return (
								<div
									key={`pv-${i}`}
									dangerouslySetInnerHTML={{
										// 对当前段落的 heading data-md-heading-line 属性进行校正（+part.lineBase0 偏移）
										__html: shiftMarkdownPreviewHeadingLineAttrs(
											rawHtml,
											part.lineBase0,
										),
									}}
								/>
							);
```

**改动后** · `apps/frontend/src/components/design/Markdown/index.tsx`（当前，约 L408–L420）

```typescript
							// 从 memo 数组按索引取 HTML，render 阶段零 parse
							const segmentHtml = mermaidIslandMarkdownHtml?.[i];
							// mermaid 位或空段跳过
							if (!segmentHtml) return null;
							return (
								<div
									key={`pv-${i}`}
									dangerouslySetInnerHTML={{
										// 注入预计算 HTML（含已校正的 heading 行号）
										__html: segmentHtml,
									}}
								/>
							);
```

**变更摘要**：parse 从 render 路径挪至 `useMemo`，依赖 `fenceParts`/`parser`；FAB 等触发的 re-render 仅复用缓存 HTML，零 parse。`mermaidIslandMarkdownHtml` 纯新增；render 消费侧由 inline `parser.render` + `shiftMarkdownPreviewHeadingLineAttrs` 改为按索引读 memo。

### 4.9 `useMermaidImagePreview` / `useMermaidDiagramClickPreview` 接入（纯新增摘录）

**对比范围**：mermaid 图片预览 modal + 点击预览 hook 接入；本轮未改动，已在 §4.8c 摘录，此处不重复粘贴。详见约 L248–L249、L293–L298。

**变更摘要**：本轮未改动；`openMermaidPreview` 由 `useMermaidImagePreview` 提供，`useMermaidDiagramClickPreview` 在 `previewHtmlRootRef` 上监听 `.mermaid` 点击并调用 `openMermaidPreview`。

### 4.10 `useChatCodeFloatingToolbar` 调用 + `syncScrollMetrics` + `handleViewportScroll`（before/after）

**对比范围**：hook 调用签名、滚动度量同步、滚动事件回调；本轮三处均有改动。

#### 4.10a `useChatCodeFloatingToolbar` 调用签名（before/after，约 L300–L306）

**改动前** · `apps/frontend/src/components/design/Markdown/index.tsx`（基线，约 L288–L291）

```typescript
	const { relayout: relayoutCodeToolbar } = useChatCodeFloatingToolbar(
		effectiveScrollViewportRef,
		// 启用时传 layoutDeps，禁用时传 undefined：hook 仍挂载全局 effect
		enableCodeFloatingToolbar ? { layoutDeps: [markdown] } : undefined,
	);
```

**改动后** · `apps/frontend/src/components/design/Markdown/index.tsx`（当前，约 L300–L306）

```typescript
	const { relayout: relayoutCodeToolbar } = useChatCodeFloatingToolbar(
		// 滚动 viewport ref
		effectiveScrollViewportRef,
		{
			// enabled=false 时 hook 内零监听零 layout（详见主文档）
			enabled: enableCodeFloatingToolbar,
			// 正文变化仍驱动非 scroll 路径 relayout（enabled 时）
			layoutDeps: [markdown],
		},
	);
```

**变更摘要**：始终传 options 对象，新增 `enabled` 字段；`enableCodeFloatingToolbar=false` 时 hook 内部所有 effect 早 return（hook 内部改造见 [../knowledge/知识预览滚动卡顿.md](../knowledge/知识预览滚动卡顿.md) §4.3）。

#### 4.10b `syncScrollMetrics`（纯新增摘录，约 L308–L322）

**改动后** · `apps/frontend/src/components/design/Markdown/index.tsx`（当前，约 L308–L322）

```typescript
	// 同步滚动区域的度量数据（比如触发代码工具栏重新布局）
	const syncScrollMetrics = useCallback(() => {
		// 如果未启用代码浮动工具栏，则无需同步
		if (!enableCodeFloatingToolbar) return;
		// 获取当前滚动视口 DOM 元素
		const el = effectiveScrollViewportRef.current;
		// 如果视口不存在也不用处理
		if (!el) return;
		// 触发代码工具栏重新布局（scroll 合并版 relayout）
		relayoutCodeToolbar();
	}, [
		// 依赖：是否启用代码浮动工具栏
		enableCodeFloatingToolbar,
		// 依赖：重新布局回调
		relayoutCodeToolbar,
		// 依赖：滚动视口引用
		effectiveScrollViewportRef,
	]);
```

**变更摘要**：函数体未改；`relayoutCodeToolbar` 在本轮改造后指向 hook 对外暴露的 `relayoutOnScroll`（scroll rAF 合并版），因此 `syncScrollMetrics` 在 scroll 热路径同帧最多 layout 一次。

#### 4.10c `handleViewportScroll`（before/after，约 L324–L337）

**改动前** · `apps/frontend/src/components/design/Markdown/index.tsx`（基线，约 L305–L321）

```typescript
	// 处理滚动视口滚动事件
	const handleViewportScroll = useCallback(
		// _e: UIEvent<HTMLDivElement> 为滚动事件对象，这里没有使用
		(_e: UIEvent<HTMLDivElement>) => {
			// 同步滚动区域的各种度量（比如用于代码工具栏的重新定位）
			syncScrollMetrics();
			// 若有传入 onViewportScrollFollow 回调，则调用（通常用于触底保持跟随等逻辑）
			onViewportScrollFollow?.();
			// 如果显示右下角滚动浮动按钮（如置顶/置底），刷新其展示状态
			if (showPreviewScrollCornerFab) refreshPreviewScrollFab();
		},
		[
			// 依赖：度量同步函数
			syncScrollMetrics,
			// 依赖：自定义滚动跟随回调
			onViewportScrollFollow,
			// 依赖：是否展示滚动浮动按钮
			showPreviewScrollCornerFab,
			// 依赖：刷新浮动按钮显示的回调
			refreshPreviewScrollFab,
		],
	);
```

**改动后** · `apps/frontend/src/components/design/Markdown/index.tsx`（当前，约 L324–L337）

```typescript
	// 处理滚动视口滚动事件（FAB 仅在 mode 变化时 setState，避免滚动重渲染触发整篇 parse）
	const handleViewportScroll = useCallback(
		// _e: 滚动事件对象，未使用
		(_e: UIEvent<HTMLDivElement>) => {
			// 同步滚动度量（触发代码工具栏 scroll 合并版 relayout）
			syncScrollMetrics();
			// 外部跟随回调（分屏时驱动编辑器对齐）
			onViewportScrollFollow?.();
			// 刷新 FAB mode（ref 去重，mode 不变则零 setState）
			if (showPreviewScrollCornerFab) refreshPreviewScrollFab();
		},
		[
			// 依赖：度量同步函数
			syncScrollMetrics,
			// 依赖：自定义滚动跟随回调
			onViewportScrollFollow,
			// 依赖：是否展示滚动浮动按钮
			showPreviewScrollCornerFab,
			// 依赖：刷新浮动按钮显示的回调
			refreshPreviewScrollFab,
		],
	);
```

**变更摘要**：函数体逻辑等价；删除逐行说明注释，留顶部一句说明 FAB 去重意图。行为不变，源码噪音收敛。

#### 4.10d FAB `useEffect` 同步 ref（before/after，约 L346–L366）

**改动前** · `apps/frontend/src/components/design/Markdown/index.tsx`（基线，约 L335–L355）

```typescript
	// 正文变化 / 视口尺寸变化时更新「是否可滚、是否触底」
	useEffect(() => {
		// 功能关闭时隐藏 FAB 并返回
		if (!showPreviewScrollCornerFab) {
			// 仅 setState，未同步 ref（ref 可能仍为旧 mode）
			setPreviewScrollFabMode('hidden');
			// 结束
			return;
		}
		// ...（未改动：RO + rAF + refreshPreviewScrollFab，省略对称）
	}, [markdown, html, showPreviewScrollCornerFab, refreshPreviewScrollFab]);
```

**改动后** · `apps/frontend/src/components/design/Markdown/index.tsx`（当前，约 L346–L366）

```typescript
	// 正文变化 / 视口尺寸变化时更新 FAB mode
	useEffect(() => {
		// 功能关闭时隐藏 FAB 并返回
		if (!showPreviewScrollCornerFab) {
			// 同步 ref，避免 ref 残留旧 mode 导致 refreshPreviewScrollFab 误判
			previewScrollFabModeRef.current = 'hidden';
			// setState 隐藏 FAB
			setPreviewScrollFabMode('hidden');
			// 结束
			return;
		}
		// ...（未改动：RO + rAF + refreshPreviewScrollFab，省略对称）
	}, [markdown, html, showPreviewScrollCornerFab, refreshPreviewScrollFab]);
```

**变更摘要**：关闭分支补 `previewScrollFabModeRef.current = 'hidden'`，保证 ref 与 state 一致；避免「关闭→重开」时 ref 残留 `toBottom`/`toTop` 导致 `refreshPreviewScrollFab` 误跳过首次 setState。

### 4.11 `previewPending` 兜底（纯新增摘录）

**对比范围**：`pendingSourceMarkdown` 有内容但 `markdown` deferred 未就绪时的 Loading 兜底；本轮未改动，但属于卡顿修复的 deferred 配套。

**改动后** · `apps/frontend/src/components/design/Markdown/index.tsx`（当前，约 L432–L433、L470–L474）

```typescript
	// 兜底条件：markdown 为空但源正文已有内容（deferred/latch 未追平帧）
	const previewPending =
		!markdown.trim() && Boolean(pendingSourceMarkdown?.trim());
```

```tsx
			) : previewPending ? (
				// deferred 未就绪：展示 Loading 而非「预览为空」
				<div className="flex h-full min-h-0 items-center justify-center p-3">
					<Loading text={t?.('markdown.preview.loading') ?? '内容加载中…'} />
				</div>
			) : (
				// ...（未改动：空态占位，省略）
			)}
```

**变更摘要**：本轮未改动；摘录因为 Monaco 调用方在长文停喂预览时传 `pendingSourceMarkdown`，deferred 追平前展示 Loading，与卡顿修复的「停喂预览」策略配套。

### 4.12 `<ChatCodeFloatingToolbar t={t} />` 渲染（纯新增摘录）

**对比范围**：代码吸顶条 Portal 组件渲染；本轮未改动。

**改动后** · `apps/frontend/src/components/design/Markdown/index.tsx`（当前，约 L443–L445）

```tsx
			{/* 启用 ScrollArea 且启用代码吸顶条时，渲染全局吸顶条 Portal */}
			{withScrollArea && enableCodeFloatingToolbar ? (
				<ChatCodeFloatingToolbar t={t} />
			) : null}
```

**变更摘要**：本轮未改动；`enableCodeFloatingToolbar=false` 时不渲染吸顶条，与 hook 内 `enabled=false` 门禁一致，助手同开时左栏零吸顶条 layout。

### 4.13 FAB 渲染（纯新增摘录）

**对比范围**：右下角 FAB 按钮渲染；本轮未改 JSX，仅 `previewScrollFabMode` state 的更新逻辑变化（见 §4.5）。

**改动后** · `apps/frontend/src/components/design/Markdown/index.tsx`（当前，约 L482–L511）

```tsx
			{/* FAB：功能开启且 mode 非 hidden 时渲染 */}
			{showPreviewScrollCornerFab && previewScrollFabMode !== 'hidden' ? (
				<Tooltip
					// tooltip 内容：toBottom→滚动到底部，toTop→滚动到顶部
					content={
						previewScrollFabMode === 'toBottom'
							? (t?.('markdown.preview.scroll.toBottom') ?? '滚动到底部')
							: (t?.('markdown.preview.scroll.toTop') ?? '滚动到顶部')
					}
				>
					<button
						// 按钮类型
						type="button"
						// 样式：与 ChatControls 滚动按钮一致 + backdrop blur
						className={cn(
							'absolute bottom-2.5 right-2.5 z-10 flex h-8.5 w-8.5 cursor-pointer items-center justify-center rounded-full border border-theme/5 bg-theme/5 text-textcolor/70 backdrop-blur-[2px] hover:bg-theme/15',
							'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-theme/40',
						)}
						// aria-label：与 tooltip 一致
						aria-label={
							previewScrollFabMode === 'toBottom'
								? (t?.('markdown.preview.scroll.toBottom') ?? '滚动到底部')
								: (t?.('markdown.preview.scroll.toTop') ?? '滚动到顶部')
						}
						// 点击：toBottom 滚到底，toTop 滚到顶
						onClick={onPreviewScrollCornerFabClick}
					>
						{/* 图标：toBottom 用 ChevronDown，toTop 用 ChevronUp */}
						{previewScrollFabMode === 'toBottom' ? (
							<ChevronDown aria-hidden />
						) : (
							<ChevronUp aria-hidden />
						)}
					</button>
				</Tooltip>
			) : null}
```

**`onPreviewScrollCornerFabClick` 摘录**（约 L368–L379，本轮未改动）

```typescript
	// FAB 点击回调：根据 mode 滚到底/滚到顶
	const onPreviewScrollCornerFabClick = useCallback(() => {
		// 取有效 viewport
		const vp = effectiveScrollViewportRef.current;
		// 未挂载则跳过
		if (!vp) return;
		// toBottom：滚到 scrollHeight - clientHeight
		if (previewScrollFabMode === 'toBottom') {
			vp.scrollTo({
				top: vp.scrollHeight - vp.clientHeight,
				behavior: 'smooth',
			});
		// toTop：滚到 0
		} else if (previewScrollFabMode === 'toTop') {
			vp.scrollTo({ top: 0, behavior: 'smooth' });
		}
	// 依赖：previewScrollFabMode
	}, [previewScrollFabMode]);
```

**变更摘要**：FAB JSX 与点击回调本轮未改动；`previewScrollFabMode` 的更新路径（§4.5）改为 ref 去重，UI 展示行为等价，滚动中 mode 不变时更少中间帧。

## 5. 兼容性与影响

| 维度 | 变化 |
|------|------|
| FAB 展示 | 逻辑等价；滚动中 mode 不变时不 `setState`，更少中间帧闪烁 |
| Mermaid 岛屿 | HTML 与改前一致；仅计算时机从 render → memo，依赖 `fenceParts`/`parser` |
| 代码吸顶条 | `enableCodeFloatingToolbar=false` 时 hook 内零监听零 layout（详见主文档） |
| `handleViewportScroll` | 逻辑等价；仅删除逐行注释 |
| FAB `useEffect` | 关闭分支补 ref 同步，行为更稳健 |
| `pendingSourceMarkdown` | 兜底 Loading，避免一帧空态 |
| API | Props 新增字段均向后兼容（可选 + 默认值） |

**风险与回归建议**：

1. 长文 + Mermaid 预览滚动：含多个 mermaid 块；快速 flick 滚动，DevTools Performance 中 Scripting 应无连续 `MarkdownParser.render` 尖峰。
2. FAB：可滚文档底部/中部/顶部，角标 toTop/toBottom 切换正确；不可滚文档 FAB hidden；「关闭→重开」FAB 首次显示正确。
3. 预览 + 助手同开 + 流式：右栏 SSE 输出时长文左栏滚动应明显优于改前；左栏无代码吸顶条。
4. 仅预览 / 分享页：`enableCodeFloatingToolbar=true` 时代码块吸顶条仍跟 scroll。
5. edit↔preview 同步：分屏滚动同步精度未因本篇退化。

## 6. 相关源码路径

| 说明 | 路径 |
| ---- | ---- |
| Markdown 预览面板组件（本篇主角） | `apps/frontend/src/components/design/Markdown/index.tsx` |
| 代码吸顶条 hook（`enabled` 门禁 + scroll rAF 合并） | `apps/frontend/src/hooks/useChatCodeFloatingToolbar.tsx` |
| 流式贴底 hook（`streamFlushRafRef` 合并） | `apps/frontend/src/hooks/useStickToBottomScroll.ts` |
| Monaco 调用方（`enableCodeFloatingToolbar={!assistantRightPaneActive}`） | `apps/frontend/src/components/design/Monaco/index.tsx` |
| markdown 拆分工具（`splitForMermaidIslandsWithOpenTail`） | `apps/frontend/src/utils/splitMarkdownFences.ts` |
| 滚动层完整根因表与流式贴底合并（主文档） | `docs/knowledge/知识预览滚动卡顿.md` |
| 编辑↔预览滚动恢复 | `docs/monaco/Markdown预览编辑滚动恢复.md` |
| TOC / hash 跳转 | `docs/monaco/Markdown预览目录哈希导航.md` |

---

若与仓库最新源码不一致，以源码为准。
