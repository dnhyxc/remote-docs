# 长文窗口化预览（WindowedPreviewBody）实现归档

> 文档角色：implementation-doc-from-diff 归档稿
> 改动一轮：学习笔记长文预览窗口化 + 预览 HTML 处理
> 状态：已落地（2026-07）

## 1. 背景与目标

学习笔记的预览态此前直接复用 `RichEditor`（TipTap 只读实例）渲染整篇 HTML。当笔记含大量段落、图片（含 base64）时：

- TipTap 实例化 + ProseMirror schema 解析整树开销大，首次预览有明显卡顿；
- 整篇大 DOM 长驻滚动容器，与左侧笔记列表同步布局/绘制时引发 jank；
- `stripNoteTitleHtml` 用 `DOMParser` 整树解析含 base64 图的 HTML，会卡死主线程。

本轮目标：

- **静态 HTML 直渲染**：预览不再挂 TipTap，用 `dangerouslySetInnerHTML` 渲染处理过的 HTML，与编辑态共享样式表；
- **窗口化长文**：复用 `LargeNoteEditor` 的滚动窗口逻辑（`createLargeNoteDoc` / `windowBodyHtml` / `originForScroll`），只挂载当前可视窗口的块；
- **HTML 处理下沉**：`stripNoteTitleHtml` / `preserveEmptyParagraphs` / `decoratePreviewHtml` / `splitPreviewBlocks` / `preparePreviewBody` 抽到独立 `previewHtml.ts`，全部用正则，避免 DOMParser；
- **NotePreview 通用化**：新增 `children` / `loading` 插槽与 `contain-[layout_paint_style]`，支持长文场景注入 `WindowedPreviewBody`。

## 2. 改动范围

- `apps/remote-plugins/src/components/design/NotePreview/previewHtml.ts`（NEW）：纯函数 HTML 预处理工具集。
- `apps/remote-plugins/src/views/learning-notes/components/PreviewBody.tsx`（NEW）：长文窗口化预览组件 `WindowedPreviewBody`。
- `apps/remote-plugins/src/components/design/NotePreview/index.tsx`（MODIFIED）：移除内联 `stripNoteTitleHtml`、改用 `preparePreviewBody` + `ScrollArea` 静态渲染，新增 `loading` 插槽与 `contain` 样式。

## 3. 实现思路

### 3.1 HTML 处理全正则化（`previewHtml.ts`）

- `stripNoteTitleHtml`：用正则 `<div\b[^>]*\bdata-type=["']note-title["'][^>]*>[\s\S]*?<\/div>` 一次性删除 title 节点。title 的 `renderHTML` 是单层 div，正则非贪婪匹配第一个 `</div>` 即闭合，无嵌套同名标签歧义。
- `preserveEmptyParagraphs`：把 `<p></p>`、`<p>&nbsp;</p>`、`<p>\u00a0</p>` 一律改写为 `<p><br></p>`，与 TipTap 编辑态占位一致，避免静态 HTML 中空段落高度塌缩。
- `decoratePreviewHtml`：给所有 `<img>` 追加 `loading="lazy"` 与 `decoding="async"`，已有属性则保留原值。
- `splitPreviewBlocks`：按顶层开闭标签正则切片，扁平笔记（p/h/ul/table）切得准；嵌套同名标签可能切错，调用方在窗口化失败时回退整段挂载。
- `preparePreviewBody`：流水线串接 `strip → preserve → decorate`，作为 `NotePreview` 默认 body 处理入口。

### 3.2 窗口化预览（`WindowedPreviewBody`）

复用 `LargeNoteEditor` 同款滚动窗口基础设施（来自 `../utils`）：

- `createLargeNoteDoc(html)`：把 HTML 切成 blocks，构建 `{ blocks, origin, count }` 文档模型；block 数 ≤ `WINDOW_SIZE` 时直接整段挂载，不走滚动窗口。
- 双层 ref + state：
  - `docRef` / `originRef` / `shiftingRef` / `scrollRafRef` 为同步 ref，避免 setState 异步引发抖动；
  - `origin` / `offsetY` 为渲染 state，驱动窗口内容与 translateY。
- `applyOrigin`：带磁滞（`ORIGIN_HYSTERESIS`）和边缘 snap 的 origin 更新；写入时同步把 `doc.origin` / `doc.count` 落到 doc，并设置 `shiftingRef` 抑制下一帧的滚动回写。
- `onScroll`：rAF 节流，调用 `originForScroll(top, viewH, blockCount, EST_BLOCK_H)` 推算目标 origin，交给 `applyOrigin`。
- 渲染：`windowed` 时外层 div 撑到 `blockCount * EST_BLOCK_H` 总高，内层绝对定位 + `translateY(offsetY)`，仅挂窗口片段 `windowHtml`；非窗口模式直接整段挂载。

### 3.3 `NotePreview` 改造

- 移除 `RichEditor` 只读实例，改用 `ScrollArea + dangerouslySetInnerHTML`：预览只读、不需要 TipTap 编辑能力，静态 HTML 足够；
- `bodyHtml` 用 `useMemo(preparePreviewBody(html))`，依赖 `html`；
- 新增 `loading?: boolean`：内容为空且 `loading` 时不渲染空态占位，让上层骨架/Loading 接管；
- 新增 `children?: ReactNode` 插槽：长文场景下传入 `<WindowedPreviewBody />` 接管正文，`children != null` 时跳过默认 body；
- 外层 div 追加 `contain-[layout_paint_style]`：containment 隔离预览大 DOM 的布局/绘制，避免外溢到左侧列表滚动。

## 4. 关键代码与逐行注释

### 4.1 `stripNoteTitleHtml` 函数（`apps/remote-plugins/src/components/design/NotePreview/previewHtml.ts`）

**纯新增** · `apps/remote-plugins/src/components/design/NotePreview/previewHtml.ts`（当前，约 L1–L12）

```typescript
// 文件顶部 JSDoc：说明本函数的目的与为何用正则而非 DOMParser
/**
 * 去掉文档内嵌的 title 节点。
 * ponytail: 大文档（含 base64 图）用正则，避免 DOMParser 整树解析卡死主线程。
 * title 的 renderHTML 是单层 div，无嵌套同名闭合问题。
 */
// 导出函数：接收原始 HTML 字符串，返回去掉 title 节点后的 HTML
export function stripNoteTitleHtml(html: string): string {
	// 空字符串短路返回，避免后续正则空跑
	if (!html) return '';
	// 用 String.prototype.replace 做一次性删除
	return html.replace(
		// 匹配 <div ... data-type="note-title" ...>...</div>；\b 边界避免误中 data-type2 等
		/<div\b[^>]*\bdata-type=["']note-title["'][^>]*>[\s\S]*?<\/div>/i,
		// 替换为空串，即删除整个 title div
		'',
	);
}
```

**变更摘要**：相比旧版（`NotePreview/index.tsx` 内联）改用正则非贪婪匹配，删除 `DOMParser` 整树解析分支，避免含 base64 图的大文档卡死主线程；签名不变，向后兼容。

### 4.2 `preserveEmptyParagraphs` 函数（`apps/remote-plugins/src/components/design/NotePreview/previewHtml.ts`）

**纯新增** · `apps/remote-plugins/src/components/design/NotePreview/previewHtml.ts`（当前，约 L14–L23）

```typescript
// JSDoc：解释为何要给空段落补 <br>
/**
 * 空段落补 `<br>`，与 TipTap 编辑态占位一致（纯 `<p></p>` 在静态 HTML 高度会塌掉）。
 */
// 导出函数：接收 HTML，返回空段落补 <br> 后的 HTML
export function preserveEmptyParagraphs(html: string): string {
	// 空字符串短路
	if (!html) return '';
	// 用 replace 改写所有匹配的空段落
	return html.replace(
		// <p(\b[^>]*)> 捕获 p 的属性（保留 class 等）；(?:\s|&nbsp;|\u00a0)* 匹配空内容（含三种空白形态）
		/<p(\b[^>]*)>(?:\s|&nbsp;|\u00a0)*<\/p>/gi,
		// 替换为带 <br> 的同属性段落，保证行高与编辑态一致
		'<p$1><br></p>',
	);
}
```

**变更摘要**：新工具函数，解决静态 HTML 直渲染时空段落高度塌缩（与 TipTap 编辑态占位不一致）问题。

### 4.3 `decoratePreviewHtml` 函数（`apps/remote-plugins/src/components/design/NotePreview/previewHtml.ts`）

**纯新增** · `apps/remote-plugins/src/components/design/NotePreview/previewHtml.ts`（当前，约 L25–L34）

```typescript
// JSDoc：图片懒加载与异步解码，已有属性则保留
/** 预览图异步解码；已有对应属性则不改 */
// 导出函数：接收 HTML，返回图片加 loading/decoding 后的 HTML
export function decoratePreviewHtml(html: string): string {
	// 空字符串短路
	if (!html) return '';
	// 正则匹配所有 <img ...>，回调函数返回替换串；第一个捕获组 attrs 是 img 的属性串
	return html.replace(/<img\b([^>]*)>/gi, (_full, attrs: string) => {
		// next 初始等于原属性串，下面按需追加
		let next = attrs;
		// 若没有 loading 属性，追加 loading="lazy"（懒加载，视口外不请求）
		if (!/\bloading\s*=/i.test(next)) next += ' loading="lazy"';
		// 若没有 decoding 属性，追加 decoding="async"（异步解码，不阻塞主线程）
		if (!/\bdecoding\s*=/i.test(next)) next += ' decoding="async"';
		// 返回补全属性后的 <img>
		return `<img${next}>`;
	});
}
```

**变更摘要**：新工具函数，给所有 `<img>` 注入 `loading="lazy"` + `decoding="async"`，避免预览大图阻塞主线程渲染。

### 4.4 `splitPreviewBlocks` 函数（`apps/remote-plugins/src/components/design/NotePreview/previewHtml.ts`）

**纯新增** · `apps/remote-plugins/src/components/design/NotePreview/previewHtml.ts`（当前，约 L36–L59）

```typescript
// JSDoc：按顶层开闭标签切片，扁平笔记切得准；嵌套同名标签可能切错
/**
 * 按顶层开闭标签切开（笔记多为扁平 p/h/ul/table）。
 * ponytail: 嵌套同名标签可能切不准；失败时调用方回退整段挂载。
 */
// 导出函数：接收 HTML，返回切好的顶层块数组
export function splitPreviewBlocks(html: string): string[] {
	// 空字符串返回空数组
	if (!html) return [];
	// blocks 累积切出的块
	const blocks: string[] = [];
	// 正则：捕获 <tag ...>...</tag> 或 <tag .../>；\1 反向引用确保开闭标签同名
	const re = /<([a-z][a-z0-9]*)\b[^>]*(?:\/>|>[\s\S]*?<\/\1>)/gi;
	// last 记录上次匹配结束位置，用于切片之间的 gap
	let last = 0;
	// m 为每次 exec 的结果
	let m: RegExpExecArray | null;
	// 循环执行正则，直到没有匹配
	while ((m = re.exec(html))) {
		// 若匹配前有 gap（文本节点等），切出 gap
		if (m.index > last) {
			// 取 gap 原文
			const gap = html.slice(last, m.index).trim();
			// trim 后非空才推入（避免空白噪声）
			if (gap) blocks.push(gap);
		}
		// 推入本次匹配的整块
		blocks.push(m[0]);
		// 推进 last 到本次匹配末尾
		last = m.index + m[0].length;
	}
	// 末尾若还有 tail，也切出
	if (last < html.length) {
		// 取 tail 原文
		const tail = html.slice(last).trim();
		// tail trim 后非空才推入
		if (tail) blocks.push(tail);
	}
	// 返回 blocks；若一个都没切出来（异常 HTML），回退为整段
	return blocks.length ? blocks : [html];
}
```

**变更摘要**：新工具函数，按顶层开闭标签切片，供窗口化预览 `createLargeNoteDoc` 调用；异常情况回退整段，避免空白崩盘。

### 4.5 `preparePreviewBody` 函数（`apps/remote-plugins/src/components/design/NotePreview/previewHtml.ts`）

**纯新增** · `apps/remote-plugins/src/components/design/NotePreview/previewHtml.ts`（当前，约 L61–L64）

```typescript
// JSDoc：作为 NotePreview 默认 body 处理流水线
/** 预览正文：去 title、保留空行（与编辑态一致），图懒加载 */
// 导出函数：接收 HTML，返回处理后的预览正文 HTML
export function preparePreviewBody(html: string): string {
	// 流水线串接：先 stripNoteTitleHtml 去 title，再 preserveEmptyParagraphs 补空段，最后 decoratePreviewHtml 加图懒加载
	return decoratePreviewHtml(preserveEmptyParagraphs(stripNoteTitleHtml(html)));
}
```

**变更摘要**：新工具函数，串接 strip → preserve → decorate 三步流水线，作为 `NotePreview` 默认 body 的处理入口。

### 4.6 `Props` 类型（`apps/remote-plugins/src/views/learning-notes/components/PreviewBody.tsx`）

**纯新增** · `apps/remote-plugins/src/views/learning-notes/components/PreviewBody.tsx`（当前，约 L25–L28）

```typescript
// Props 类型：WindowedPreviewBody 的入参
type Props = {
	// 待预览的 HTML 字符串（已含 title 节点也无所谓，会被 stripNoteTitleHtml 处理）
	html: string;
	// 透传给外层 ScrollArea 的 className
	className?: string;
};
```

**变更摘要**：新组件 Props，仅 `html` 与 `className` 两个 prop，与 `NotePreview` 的 `children` 插槽对接。

### 4.7 `WindowedPreviewBody` 组件（`apps/remote-plugins/src/views/learning-notes/components/PreviewBody.tsx`）

**纯新增** · `apps/remote-plugins/src/views/learning-notes/components/PreviewBody.tsx`（当前，约 L30–L137）

```typescript
// 组件顶部 JSDoc：说明本组件与 LargeNoteEditor 共用滚动窗口逻辑
/**
 * 长文只读预览：与 LargeNoteEditor 同一套滚动窗口，避免全文 DOM 拖垮左侧列表滚动。
 */
// 组件签名：解构 html 与 className
export function WindowedPreviewBody({ html, className }: Props) {
	// 用 useMemo 把 html 转成 LargeNoteDoc，依赖 html；html 变化才重建
	const boot = useMemo(() => createLargeNoteDoc(html), [html]);
	// docRef 持有最新 doc，供回调同步读取，避免闭包陈旧
	const docRef = useRef<LargeNoteDoc>(boot.doc);
	// originRef 持有最新 origin，供 applyOrigin 比较去抖
	const originRef = useRef(0);
	// shiftingRef 标记「正在切换窗口」，抑制 onScroll 在切换帧内回写
	const shiftingRef = useRef(false);
	// scrollRafRef 持有 rAF id，用于节流与卸载清理
	const scrollRafRef = useRef(0);

	// origin state：当前窗口起始 block 索引，驱动 windowBodyHtml 切片
	const [origin, setOrigin] = useState(0);
	// offsetY state：窗口容器的 translateY，对齐当前 origin 的虚拟高度
	const [offsetY, setOffsetY] = useState(0);
	// blockCount：doc 的总块数
	const blockCount = boot.doc.blocks.length;
	// bodyH：虚拟总高度 = blockCount * EST_BLOCK_H（每块估算高度）
	const bodyH = Math.max(blockCount, 1) * EST_BLOCK_H;
	// windowed：是否启用窗口化（块数超过 WINDOW_SIZE 才启用）
	const windowed = blockCount > WINDOW_SIZE;

	// 每次 render 把最新 doc 同步到 docRef，保证回调读到最新
	docRef.current = boot.doc;

	// windowHtml memo：基于当前 origin 切窗口片段，并补空段 + 图懒加载
	const windowHtml = useMemo(() => {
		// windowBodyHtml 返回 { html } 切片
		const { html: slice } = windowBodyHtml(boot.doc, origin);
		// 对切片做 preserve + decorate（不需要再 strip title，doc 已处理）
		return decoratePreviewHtml(preserveEmptyParagraphs(slice));
		// 依赖 boot.doc 与 origin
	}, [boot.doc, origin]);

	// applyOrigin：带磁滞与边缘 snap 的 origin 更新回调
	const applyOrigin = useCallback((nextOrigin: number) => {
		// 读取最新 doc
		const doc = docRef.current;
		// 若正在切换窗口，直接 return，避免重入
		if (shiftingRef.current) return;
		// 若 origin 未变，直接 return
		if (nextOrigin === originRef.current) return;

		// maxOrigin：origin 的上界
		const maxOrigin = Math.max(0, doc.blocks.length - WINDOW_SIZE);
		// snapEdge：是否跳到边缘（0 或 maxOrigin），边缘跳变立即响应不等磁滞
		const snapEdge =
			(nextOrigin === 0 && originRef.current !== 0) ||
			(nextOrigin === maxOrigin && originRef.current !== maxOrigin);
		// 非边缘跳变且位移小于磁滞阈值，return 抑制抖动
		if (
			!snapEdge &&
			Math.abs(nextOrigin - originRef.current) < ORIGIN_HYSTERESIS
		) {
			return;
		}

		// 标记正在切换窗口
		shiftingRef.current = true;
		// 同步 originRef
		originRef.current = nextOrigin;
		// 把新 origin 落到 doc（影响下一次 windowBodyHtml 切片）
		doc.origin = nextOrigin;
		// 同步 doc.count = 窗口大小（末尾不足时取剩余）
		doc.count = Math.min(
			WINDOW_SIZE,
			Math.max(0, doc.blocks.length - nextOrigin),
		);
		// 触发 re-render：origin 驱动 windowHtml 重算
		setOrigin(nextOrigin);
		// 触发 re-render：offsetY 驱动 translateY
		setOffsetY(nextOrigin * EST_BLOCK_H);
		// 下一帧释放 shiftingRef，让 onScroll 重新接管
		requestAnimationFrame(() => {
			// 解除切换标记
			shiftingRef.current = false;
		});
		// 无依赖（仅读 ref + setState，setState 稳定）
	}, []);

	// onScroll：ScrollArea 滚动回调，rAF 节流推算新 origin
	const onScroll = useCallback(
		(e: UIEvent<HTMLDivElement>) => {
			// 正在切换窗口则忽略，避免回写抖动
			if (shiftingRef.current) return;
			// 当前滚动容器
			const vp = e.currentTarget;
			// top：当前 scrollTop，下限 0
			const top = Math.max(0, vp.scrollTop);
			// viewH：可视高度，兜底 600
			const viewH = vp.clientHeight || 600;
			// 已有 rAF 在飞，直接 return（节流）
			if (scrollRafRef.current) return;
			// 申请新 rAF
			scrollRafRef.current = requestAnimationFrame(() => {
				// 进入 rAF 立即清零 id，允许下一帧再申请
				scrollRafRef.current = 0;
				// 切换窗口期间忽略
				if (shiftingRef.current) return;
				// 用 originForScroll 推算目标 origin
				applyOrigin(
					originForScroll(
						top,
						viewH,
						docRef.current.blocks.length,
						EST_BLOCK_H,
					),
				);
			});
		},
		// 依赖 applyOrigin
		[applyOrigin],
	);

	// 卸载时清理未完成的 rAF，避免对已卸载组件 setState
	useEffect(
		() => () => {
			// 若有未完成 rAF，取消
			if (scrollRafRef.current) cancelAnimationFrame(scrollRafRef.current);
		},
		// 空依赖：仅卸载时执行
		[],
	);

	// 渲染：外层 ScrollArea；windowed 时启用 onScroll
	return (
		<ScrollArea
			className={cn(
				// 基础样式：rich-editor-body 复用编辑态样式；min-h-0 flex-1 撑满
				'rich-editor-body note-preview-static text-textcolor min-h-0 flex-1',
				// 透传外部 className
				className,
			)}
			// 仅窗口化时挂 onScroll
			onScroll={windowed ? onScroll : undefined}
		>
			{/* 窗口化分支：外层撑总高，内层绝对定位 + translateY */}
			{windowed ? (
				<div className="relative w-full" style={{ height: bodyH }}>
					<div
						className="tiptap note-preview-tiptap ProseMirror absolute top-0 right-0 left-0"
						style={{ transform: `translateY(${offsetY}px)` }}
						dangerouslySetInnerHTML={{ __html: windowHtml }}
					/>
				</div>
			) : (
				/* 非窗口化：直接整段挂载（块数少，无性能问题） */
				<div
					className="tiptap note-preview-tiptap ProseMirror relative w-full"
					dangerouslySetInnerHTML={{ __html: windowHtml }}
				/>
			)}
		</ScrollArea>
	);
}
```

**变更摘要**：新组件 `WindowedPreviewBody`，复用 `LargeNoteEditor` 同款滚动窗口基础设施；通过 `boot/docRef/originRef/shiftingRef/scrollRafRef` 五个 ref + `origin/offsetY` 两个 state 实现 rAF 节流的窗口切换；窗口化分支用绝对定位 + translateY 虚拟总高度，非窗口化直接整段挂载。

### 4.8 `NotePreview` 组件（`apps/remote-plugins/src/components/design/NotePreview/index.tsx`）

#### 4.8.1 imports 与 re-export 块

**对比范围**：文件头部 import 与 `stripNoteTitleHtml` 相关导出。

**改动前** · `apps/remote-plugins/src/components/design/NotePreview/index.tsx`（基线 HEAD，约 L1–L9）

```typescript
// 旧版只导 ReactNode 类型
import type { ReactNode } from 'react';
// 旧版用 useI18n 拿 t
import { useI18n } from '@/hooks';
// 旧版用 cn 拼类名
import { cn } from '@/lib/utils';
// 旧版正文用 RichEditor 只读渲染
import RichEditor from '../RichEditor';
// 旧版引入编辑态样式
import '../RichEditor/styles.css';
// 旧版引入预览自身样式
import './styles.css';
```

**改动后** · `apps/remote-plugins/src/components/design/NotePreview/index.tsx`（当前，约 L1–L8）

```typescript
// 新版同时导 ReactNode 类型与 useMemo hook
import { type ReactNode, useMemo } from 'react';
// 新版改用 ScrollArea 容器（替代 RichEditor 只读实例）
import { ScrollArea } from '@/components/ui/scroll-area';
// 新版仍用 useI18n
import { useI18n } from '@/hooks';
// 新版仍用 cn
import { cn } from '@/lib/utils';
// 新版仍引入编辑态样式（与编辑态共享 ProseMirror 样式）
import '../RichEditor/styles.css';
// 新版从新文件导入 preparePreviewBody（strip + preserve + decorate 流水线）
import { preparePreviewBody } from './previewHtml';
// 新版仍引入预览自身样式
import './styles.css';
// 新版从 lucide-react 导入 Component 图标，用作空态占位
import { Component } from 'lucide-react';
```

**变更摘要**：去掉 `RichEditor` 默认导入，新增 `useMemo` / `ScrollArea` / `preparePreviewBody` / `Component` 四个导入，为静态 HTML 渲染 + 空态图标做准备。

#### 4.8.2 `NotePreviewProps` 类型（新增 `loading`）

**对比范围**：`NotePreviewProps` 类型定义全文。

**改动前** · `apps/remote-plugins/src/components/design/NotePreview/index.tsx`（基线 HEAD，约 L10–L24）

```typescript
// 旧版导出 NotePreviewProps 类型
export type NotePreviewProps = {
	// 顶栏标题（替代编辑器 toolbar）
	/** 顶栏标题（替代编辑器 toolbar） */
	// 标题文本
	title: string;
	// TipTap HTML 或 JSON 内容
	/** TipTap HTML 或 JSON 内容 */
	// html 内容（旧版直接给 RichEditor）
	html?: string;
	// 顶栏标题旁/下方的次要信息
	/** 顶栏标题旁/下方的次要信息（时间、标签等） */
	// meta ReactNode
	meta?: ReactNode;
	// 顶栏右侧操作
	/** 顶栏右侧操作（返回编辑、列表开关等） */
	// headerExtra ReactNode
	headerExtra?: ReactNode;
	// 自定义正文插槽
	/** 自定义正文；传入时忽略 html */
	// children ReactNode
	children?: ReactNode;
	// footer ReactNode
	footer?: ReactNode;
	// 外层 className
	className?: string;
	// body 区域 className
	bodyClassName?: string;
	// 空态文案
	emptyText?: string;
};
```

**改动后** · `apps/remote-plugins/src/components/design/NotePreview/index.tsx`（当前，约 L10–L26）

```typescript
// 新版导出 NotePreviewProps 类型
export type NotePreviewProps = {
	// 顶栏标题（替代编辑器 toolbar）
	/** 顶栏标题（替代编辑器 toolbar） */
	// 标题文本
	title: string;
	// TipTap HTML 或 JSON 内容
	/** TipTap HTML 或 JSON 内容 */
	// html 内容（新版用 preparePreviewBody 处理后静态渲染）
	html?: string;
	// 顶栏标题旁/下方的次要信息
	/** 顶栏标题旁/下方的次要信息（时间、标签等） */
	// meta ReactNode
	meta?: ReactNode;
	// 顶栏右侧操作
	/** 顶栏右侧操作（返回编辑、列表开关等） */
	// headerExtra ReactNode
	headerExtra?: ReactNode;
	// 自定义正文插槽（长文场景下传 WindowedPreviewBody）
	/** 自定义正文；传入时忽略 html */
	// children ReactNode
	children?: ReactNode;
	// footer ReactNode
	footer?: ReactNode;
	// 外层 className
	className?: string;
	// body 区域 className
	bodyClassName?: string;
	// 空态文案
	emptyText?: string;
	// 新增：loading 标记；为 true 且无内容时不渲染空态，让上层骨架接管
	loading?: boolean;
};
```

**变更摘要**：新增 `loading?: boolean` 字段，配合上层 Loading 骨架/骨架屏使用；其余字段保持不变。

#### 4.8.3 `stripNoteTitleHtml` 内联函数 → 从 `./previewHtml` re-export

**对比范围**：原内联 `stripNoteTitleHtml` 函数被删除，改为从 `./previewHtml` re-export 全套工具函数。

**改动前** · `apps/remote-plugins/src/components/design/NotePreview/index.tsx`（基线 HEAD，约 L26–L40）

```typescript
// 旧版内联函数的文档注释
/** 去掉文档内嵌的 title NodeView，正文只渲染 block 内容（兼容旧 API） */
// 旧版内联 stripNoteTitleHtml：用 DOMParser 整树解析，含 base64 图的大文档会卡死
export function stripNoteTitleHtml(html: string): string {
	// 空串短路
	if (!html) return '';
	// 旧版分支：SSR/无 DOMParser 环境走正则
	if (typeof DOMParser === 'undefined') {
		// 正则删除 title div（无 \b 边界，比新版宽松）
		return html.replace(
			/<div[^>]*data-type=["']note-title["'][^>]*>[\s\S]*?<\/div>/i,
			// 替换为空串
			'',
		);
	}
	// 浏览器环境用 DOMParser 整树解析
	const doc = new DOMParser().parseFromString(html, 'text/html');
	// querySelectorAll 找所有 title 节点
	for (const el of doc.querySelectorAll('[data-type="note-title"]')) {
		// 逐个删除
		el.remove();
	}
	// 返回 body innerHTML
	return doc.body.innerHTML;
}
```

**改动后** · `apps/remote-plugins/src/components/design/NotePreview/index.tsx`（当前，约 L28–L34）

```typescript
// 新版改为 re-export 块：从 ./previewHtml 把全套工具函数透出，保持公共 API 不破
export {
	// 图片懒加载/异步解码装饰器
	decoratePreviewHtml,
	// 默认 body 处理流水线
	preparePreviewBody,
	// 空段落补 <br>
	preserveEmptyParagraphs,
	// 顶层块切片
	splitPreviewBlocks,
	// 去除 title 节点（原内联函数）
	stripNoteTitleHtml,
} from './previewHtml';
```

**变更摘要**：删除内联 `stripNoteTitleHtml`（含 DOMParser 整树解析），改为从 `./previewHtml` re-export 全套 5 个工具函数；公共 API 名称保留，外部引用不破。

#### 4.8.4 `NotePreview` 组件函数体

**对比范围**：`NotePreview` 组件从函数签名到 `}` 全文（含 bodyHtml 计算、return JSX）。

**改动前** · `apps/remote-plugins/src/components/design/NotePreview/index.tsx`（基线 HEAD，约 L42–L92）

```typescript
// 旧版组件 JSDoc
/**
 * 笔记只读预览：顶栏标题 + 可滚动正文。
 * - 使用 RichEditor 只读模式渲染，与编辑效果完全一致
 * - schema 层面禁用 title 节点，并用 stripNoteTitleHtml 预处理内容
 * - children / headerExtra / footer / meta 可扩展
 */
// 旧版组件签名
export function NotePreview({
	// 标题
	title,
	// html 内容
	html,
	// meta
	meta,
	// headerExtra
	headerExtra,
	// children
	children,
	// footer
	footer,
	// className
	className,
	// bodyClassName
	bodyClassName,
	// emptyText
	emptyText,
}: NotePreviewProps) {
	// 旧版用 useI18n 拿 t
	const { t } = useI18n();
	// 旧版 bodyHtml：直接 stripNoteTitleHtml，无 memo、无空段/图懒加载处理
	const bodyHtml = html ? stripNoteTitleHtml(html) : '';
	// 空态文案
	const empty = emptyText ?? t('common.emptyContent');

	// 旧版 return
	return (
		// 外层 div
		<div
			// cn 拼类名
			className={cn(
				// 旧版无 contain 隔离
				'note-preview flex h-full min-h-0 min-w-0 flex-col overflow-hidden rounded-r-md',
				// 透传 className
				className,
			)}
		>
			{/* 顶栏 header */}
			<header className="note-preview-header h-10 border-theme/10 flex shrink-0 items-center gap-3 border-b pl-3 pr-1.5 py-2.5">
				{/* header 左侧标题区 */}
				<div className="min-w-0 flex-1">
					{/* 标题 h1 */}
					<h1 className="text-textcolor truncate text-base font-semibold leading-snug">
						{/* 标题文本，空则显示「无标题笔记」 */}
						{title.trim() || t('common.untitledNote')}
					</h1>
					{/* 有 meta 才渲染 */}
					{meta ? (
						// meta 容器
						<div className="text-textcolor/45 mt-0.5 truncate text-xs">
							{/* meta 内容 */}
							{meta}
						</div>
					) : null}
				</div>
				{/* 有 headerExtra 才渲染 */}
				{headerExtra ? (
					// headerExtra 容器
					<div className="flex shrink-0 items-center gap-0.5">
						{/* headerExtra 内容 */}
						{headerExtra}
					</div>
				) : null}
			</header>

			{/* 旧版 body 容器：包了一层 note-preview-body div */}
			<div className="note-preview-body min-h-0 flex-1">
				{/* children 优先 */}
				{children != null ? (
					// 直接渲染 children
					children
				) : bodyHtml ? (
					// 有内容用 RichEditor 只读渲染（重）
					<RichEditor
						// content 为处理后的 bodyHtml
						content={bodyHtml}
						// 只读
						editable={false}
						// 不自动聚焦
						autofocus={false}
						// 不显示工具栏
						showToolbar={false}
						// 不显示气泡菜单
						showBubbleMenu={false}
						// 不显示字数统计
						showCharCount={false}
						// 不显示 title
						showTitle={false}
						// 外层 className
						className={cn('note-preview-editor', bodyClassName)}
						// 编辑器 className
						editorClassName="note-preview-tiptap"
					/>
				) : (
					// 空态：简单 <p> 文案
					<p className="text-textcolor/45 p-3 text-sm">{empty}</p>
				)}
			</div>

			{/* footer 容器 */}
			{footer ? <div className="shrink-0">{footer}</div> : null}
		</div>
	);
}
```

**改动后** · `apps/remote-plugins/src/components/design/NotePreview/index.tsx`（当前，约 L36–L109）

```typescript
// 新版组件 JSDoc：强调静态 HTML，不挂 TipTap
/**
 * 笔记只读预览：与编辑态同一套 ScrollArea + RichEditor 正文样式（静态 HTML，不挂 TipTap）。
 */
// 新版组件签名：新增 loading 解构
export function NotePreview({
	// 标题
	title,
	// html 内容
	html,
	// meta
	meta,
	// headerExtra
	headerExtra,
	// children
	children,
	// footer
	footer,
	// className
	className,
	// bodyClassName
	bodyClassName,
	// emptyText
	emptyText,
	// 新增 loading
	loading,
}: NotePreviewProps) {
	// 新版仍用 useI18n
	const { t } = useI18n();
	// 新版先算 empty（顺序调整，避免与 bodyHtml 抢优先级）
	const empty = emptyText ?? t('common.emptyContent');
	// 新版 bodyHtml 用 useMemo + preparePreviewBody，依赖 html
	const bodyHtml = useMemo(
		// 有 html 才走流水线，否则空串
		() => (html ? preparePreviewBody(html) : ''),
		// 依赖 html
		[html],
	);

	// 新版 return
	return (
		// 外层 div
		<div
			// cn 拼类名
			className={cn(
				// 新版追加 contain-[layout_paint_style]，隔离预览大 DOM 的布局/绘制
				// contain：预览大 DOM 不参与左侧列表滚动时的布局/绘制连锁
				'note-preview flex h-full min-h-0 min-w-0 flex-col overflow-hidden rounded-r-md contain-[layout_paint_style]',
				// 透传 className
				className,
			)}
		>
			{/* 顶栏 header */}
			<header className="note-preview-header h-10 border-theme/10 flex shrink-0 items-center gap-3 border-b pl-3 pr-1.5 py-2.5">
				{/* header 左侧标题区 */}
				<div className="min-w-0 flex-1">
					{/* 标题 h1 */}
					<h1 className="text-textcolor truncate text-base font-semibold leading-snug">
						{/* 标题文本，空则显示「无标题笔记」 */}
						{title.trim() || t('common.untitledNote')}
					</h1>
					{/* 有 meta 才渲染 */}
					{meta ? (
						// meta 容器
						<div className="text-textcolor/45 mt-0.5 truncate text-xs">
							{/* meta 内容 */}
							{meta}
						</div>
					) : null}
				</div>
				{/* 有 headerExtra 才渲染 */}
				{headerExtra ? (
					// headerExtra 容器
					<div className="flex shrink-0 items-center gap-0.5">
						{/* headerExtra 内容 */}
						{headerExtra}
					</div>
				) : null}
			</header>

			{/* 新版 body：去掉 note-preview-body 包裹层，三选一渲染 */}
			{/* children 优先（长文场景下注入 WindowedPreviewBody） */}
			{children != null ? (
				// 直接渲染 children
				children
			) : bodyHtml ? (
				// 有内容用 ScrollArea + dangerouslySetInnerHTML 静态渲染（轻）
				<ScrollArea
					// ScrollArea className
					className={cn(
						// 复用 rich-editor-body 样式
						'rich-editor-body note-preview-static text-textcolor min-h-0 flex-1',
						// 透传 bodyClassName
						bodyClassName,
					)}
				>
					{/* 内层 div 套 tiptap/ProseMirror 类，复用编辑态样式 */}
					<div
						// 类名：与编辑态一致
						className="tiptap note-preview-tiptap ProseMirror"
						// tipTap 导出 HTML；预览只读
						// 直接注入处理后的 bodyHtml
						dangerouslySetInnerHTML={{ __html: bodyHtml }}
					/>
				</ScrollArea>
			) : loading ? null : (
				/* loading 为 true 时不渲染空态（让上层骨架接管）；否则渲染新的空态 UI */
				/* 新空态：居中 + Component 图标弹跳 + 文案 */
				<div className="flex items-center justify-center flex-col gap-5 h-full box-border min-w-0 max-w-full w-full p-3 rounded-md">
					{/* lucide-react Component 图标，animate-bounce 弹跳 */}
					<Component className="w-16 h-16 text-textcolor/70 animate-bounce" />
					{/* 空态文案 */}
					<div className="text-sm text-textcolor/80">{empty}</div>
				</div>
			)}

			{/* footer 容器 */}
			{footer ? <div className="shrink-0">{footer}</div> : null}
		</div>
	);
}
```

**变更摘要**：

1. `bodyHtml` 改用 `useMemo + preparePreviewBody`，依赖 `html`；
2. 移除 `<div className="note-preview-body">` 包裹层，children 直接挂到外层 flex 容器；
3. 默认 body 由 `RichEditor` 只读实例改为 `ScrollArea + dangerouslySetInnerHTML` 静态渲染；
4. 空态由简单 `<p>` 改为「居中 + Component 弹跳图标 + 文案」，并新增 `loading` 分支（loading 时不渲染空态）；
5. 外层 div 追加 `contain-[layout_paint_style]`，隔离预览大 DOM 的布局/绘制，避免外溢到左侧列表滚动。

## 5. 兼容性与影响

- **公共 API 兼容**：`NotePreview` 仍导出 `stripNoteTitleHtml`（改为 re-export），外部引用名称不变；`NotePreviewProps` 仅新增可选字段 `loading`，旧调用点零改动。
- **行为差异**：
  - 预览态不再挂 TipTap，与编辑态「视觉一致」但「行为只读」——任何依赖 TipTap 实例 API 的调用方需改用静态 HTML；
  - `stripNoteTitleHtml` 不再走 DOMParser 分支，全部正则；含 base64 图的大文档主线程开销显著下降；
  - 空段落补 `<br>`、图片懒加载/异步解码，预览态视觉与编辑态更一致，渲染更流畅。
- **回归建议**：
  - 含 base64 图的大笔记预览：滚动是否流畅、图是否懒加载；
  - 含 title 节点的笔记：title 是否被正确剥离；
  - 空笔记 + `loading=true`：是否正确隐藏空态；
  - 长文（块数 > `WINDOW_SIZE`）：窗口化切换是否抖动、滚动到边缘是否 snap；
  - `children` 插槽：长文场景下 `WindowedPreviewBody` 是否正确接管正文。

## 6. 相关源码路径

| 说明 | 路径 |
| ---- | ---- |
| 预览 HTML 处理工具集（NEW） | `apps/remote-plugins/src/components/design/NotePreview/previewHtml.ts` |
| 长文窗口化预览组件（NEW） | `apps/remote-plugins/src/views/learning-notes/components/PreviewBody.tsx` |
| 通用预览容器（MODIFIED） | `apps/remote-plugins/src/components/design/NotePreview/index.tsx` |
| 滚动窗口基础设施（既有，被复用） | `apps/remote-plugins/src/views/learning-notes/utils`（`createLargeNoteDoc` / `windowBodyHtml` / `originForScroll` / `WINDOW_SIZE` / `EST_BLOCK_H` / `ORIGIN_HYSTERESIS` / `LargeNoteDoc`） |
| 编辑态 RichEditor（既有，预览态不再依赖） | `apps/remote-plugins/src/components/design/RichEditor` |

---

（若与仓库最新源码不一致，以源码为准）
