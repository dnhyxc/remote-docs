# 长文笔记编辑器（LargeNoteEditor）实现归档

> 文档角色：implementation-doc-from-diff 归档稿（纯新增）
> 改动一轮：学习笔记富文本长文编辑器 + 窗口化模型
> 状态：已落地（2026-07）

## 1. 背景与目标

学习笔记此前使用普通富文本编辑器（基于 `RichEditor` 封装）一次性挂载整篇 HTML。当笔记体量变大（≥ 80 块 / 字符数 ≥ 80k，常见于含 base64 图片的大图笔记）后出现以下问题：

- TipTap 一次 `setContent` 全量 DOM，主线程卡顿明显。
- 滚动列表与右侧预览/编辑器共用 observer，长文滚动时相互牵动，FPS 掉到个位数。
- 进入编辑态后光标默认停在文首，与短文「光标在文末」体验不一致。

本改动引入**长文窗口化编辑模型**：把笔记切成块数组，仅把「可视窗口」对应的一段块渲染到 ProseMirror；随滚动按 `origin` 切窗，写回时用 `flushWindow` 合并。配套提供 `NotesListPanel` 作为独立 observer 的左侧列表，避免牵动右侧大 HTML。

## 2. 改动范围

| 路径 | 类型 | 说明 |
| --- | --- | --- |
| `apps/remote-plugins/src/views/learning-notes/utils/doc.ts` | 新增 | 长文窗口化核心数据结构与工具函数 |
| `apps/remote-plugins/src/views/learning-notes/utils/index.ts` | 新增 | `doc.ts` 导出聚合 |
| `apps/remote-plugins/src/views/learning-notes/components/Editor.tsx` | 新增 | `LargeNoteEditor` 长文编辑器组件 |
| `apps/remote-plugins/src/views/learning-notes/components/NotesListPanel.tsx` | 新增 | 独立 observer 的笔记列表面板 |

> 说明：本篇仅覆盖纯新增文件。复用的 `splitPreviewBlocks` / `stripNoteTitleHtml` 来自既有 `@/components/design/NotePreview/previewHtml`，本篇仅在「逐行注释」中给出调用语义，详细实现见源码注释。

## 3. 实现思路

1. **按块切分（splitPreviewBlocks）**：用顶层开闭标签正则把正文切成扁平块数组 `blocks: string[]`，避免 DOMParser 全树解析（大文档 + base64 主线程卡死）。
2. **窗口化挂载**：定义 `WINDOW_SIZE = 100`、`LARGE_MIN_BLOCKS = 80`；超过阈值即进入窗口模式，仅渲染 `blocks.slice(origin, origin + count)`，靠 `translateY(offsetY)` 占位假装全文高度，外部滚动条长度 = `blockCount * EST_BLOCK_H`。
3. **滚动切窗**：`originForScroll` 把视口中心映射到块索引，再居中取一窗；`ORIGIN_HYSTERESIS = 24` 防止边界来回抖动；触顶/触底直接 snap 到 `0` / `maxOrigin`。
4. **写回合并**：`flushWindow(doc, editorHtml)` 把当前编辑器 HTML 重新切块后 `splice` 回 `blocks[origin..origin+count]`；`isEffectivelyEmptyBody` 拒绝把全文覆盖成空（防止 setContent 中转态误写空）。
5. **入场对齐短文**：`bootLargeNote` 直接把初始 origin 拉到文末最后一窗，再 `scrollViewportToEnd` + `focus('end')`，保证打开长笔记时光标与滚动条都贴底。
6. **列表隔离**：`NotesListPanel` 单独 `observer`，滚动/触底加载/edge 检测只重渲左侧，避免右侧 TipTap / 大 HTML 预览被动重渲。
7. **回写两件套**：`stitchFullHtml` / `stitchFullText` 在保存时把当前窗口 flush 回 doc，再拼 title + 全部 blocks，得到与短文一致的完整 HTML / 纯文本。
8. **不可见 fallback**：`windowed = blockCount > WINDOW_SIZE` 时不按 WINDOW_SIZE 垫高（大图笔记常常块少但体积大），避免文末巨量空白。

## 4. 关键代码与逐行注释

> 全部为纯新增文件，按例外规则仅展示「改动后」一侧，且每行源码上方均附中文注释。

### 4.1 常量 `LARGE_MIN_BLOCKS` / `WINDOW_SIZE` / `ORIGIN_HYSTERESIS` / `EST_BLOCK_H`

**对比范围**：纯新增常量声明（无基线）。

**改动后** · `apps/remote-plugins/src/views/learning-notes/utils/doc.ts`（当前，约 L6–L13）

```typescript
// 超过该块数启用长文滚动窗口
export const LARGE_MIN_BLOCKS = 80;
// 编辑器内正文块数（同时挂载进 ProseMirror 的块上限）
export const WINDOW_SIZE = 100;
// origin 变化至少这么多块才换窗，减少抖动
export const ORIGIN_HYSTERESIS = 24;
// 块高估算（px），用于把块索引换算成滚动条长度
export const EST_BLOCK_H = 44;
```

**变更摘要**：定义窗口模型 4 个核心阈值；80/100/24/44 是经验值，兼顾大图笔记与普通长文。

### 4.2 `TITLE_RE` 正则与 `extractTitleHtml` / `extractTitleText` / `titleToHtml`（含外部 `stripNoteTitleHtml` 说明）

**对比范围**：纯新增标题处理工具（无基线）。`stripNoteTitleHtml` 由 `@/components/design/NotePreview/previewHtml` 提供，本文件不重复实现，仅复用。

**改动后** · `apps/remote-plugins/src/views/learning-notes/utils/doc.ts`（当前，约 L1–L45）

```typescript
// 引入预览侧已有的「去 title 节点」工具：大文档走正则避免 DOMParser 主线程卡死
import {
	splitPreviewBlocks,
	stripNoteTitleHtml,
} from '@/components/design/NotePreview/previewHtml';

// 匹配笔记 title 节点：单层 div + data-type="note-title"，单层无嵌套同名闭合问题
const TITLE_RE =
	/<div\b[^>]*\bdata-type=["']note-title["'][^>]*>[\s\S]*?<\/div>/i;

// 长文文档结构：blocks = 切分后的块数组；origin = 当前窗口起点；count = 当前窗口块数
export type LargeNoteDoc = {
	blocks: string[];
	/** 当前窗口起点 */
	origin: number;
	/** 当前窗口块数 */
	count: number;
};

// 从整篇 HTML 中正则提取 title 节点 HTML（含 data-value）；找不到返回空串
export function extractTitleHtml(html: string): string {
	return html.match(TITLE_RE)?.[0] ?? '';
}

// 提取 title 纯文本：优先取 data-value 属性，回退去标签后 trim
export function extractTitleText(html: string): string {
	// 先取 title 节点 HTML
	const node = extractTitleHtml(html);
	// 没有 title 节点直接返回空
	if (!node) return '';
	// 优先读 data-value 属性里存的纯文本
	const fromAttr = node.match(/data-value=["']([^"']*)["']/i)?.[1];
	// 有 data-value 用它（trim 防止前后空白）
	if (fromAttr != null) return fromAttr.trim();
	// 没有就剥掉所有标签拿纯文本
	return node.replace(/<[^>]+>/g, '').trim();
}

// 把纯文本标题转回 title 节点 HTML：先转义 4 类特殊字符防注入
export function titleToHtml(title: string): string {
	// 转义 & 防止实体二次解析
	const safe = title
		.replace(/&/g, '&amp;')
		// 转义双引号，因为下面要塞进 data-value 属性
		.replace(/"/g, '&quot;')
		// 转义 < 防止被当成标签起点
		.replace(/</g, '&lt;')
		// 转义 > 与 < 配对
		.replace(/>/g, '&gt;');
	// 输出单层 div：data-type 标识类型，data-value 存纯文本，正文也放 safe 便于预览
	return `<div data-type="note-title" data-value="${safe}">${safe}</div>`;
}
```

**变更摘要**：定义 title 节点正则与三件套（提取 HTML / 提取纯文本 / 转回 HTML），并声明 `LargeNoteDoc` 结构。`stripNoteTitleHtml` 仅复用既有实现。

### 4.3 `splitPreviewBlocks`（外部复用，本文件不重复实现）

**对比范围**：函数来自 `apps/remote-plugins/src/components/design/NotePreview/previewHtml.ts`，`doc.ts` 仅 import 调用，本节给出语义说明。

**改动后** · `apps/remote-plugins/src/components/design/NotePreview/previewHtml.ts`（当前，约 L40–L59，仅作引用说明）

```typescript
// 按顶层开闭标签切开（笔记多为扁平 p/h/ul/table）
// 嵌套同名标签可能切不准；失败时调用方回退整段挂载
export function splitPreviewBlocks(html: string): string[] {
	// 空串直接返回空数组
	if (!html) return [];
	// 累积结果的块数组
	const blocks: string[] = [];
	// 顶层标签正则：捕获标签名以做开闭匹配
	const re = /<([a-z][a-z0-9]*)\b[^>]*(?:\/>|>[\s\S]*?<\/\1>)/gi;
	// 上一段结束位置
	let last = 0;
	// 当前匹配
	let m: RegExpExecArray | null;
	// 循环执行正则
	while ((m = re.exec(html))) {
		// 标签前的间隙（纯文本）也当成一段
		if (m.index > last) {
			const gap = html.slice(last, m.index).trim();
			if (gap) blocks.push(gap);
		}
		// 把匹配到的标签整段 push
		blocks.push(m[0]);
		// 更新 last
		last = m.index + m[0].length;
	}
	// 末尾剩余文本
	if (last < html.length) {
		const tail = html.slice(last).trim();
		if (tail) blocks.push(tail);
	}
	// 一段都没切出来就整体当一个块返回，避免空数组
	return blocks.length ? blocks : [html];
}
```

**变更摘要**：`splitPreviewBlocks` 是窗口切分的基石，本文件直接复用不重复实现；正则只切顶层，嵌套同名标签会失准（注释已声明回退策略）。

### 4.4 `isLargeNoteHtml`

**对比范围**：纯新增类型守卫函数（无基线）。

**改动后** · `apps/remote-plugins/src/views/learning-notes/utils/doc.ts`（当前，约 L47–L52）

```typescript
// 判断内容是否需要进入长文窗口模式：是 string 且非空 + 命中阈值
export function isLargeNoteHtml(content: unknown): content is string {
	// 非字符串或空串直接 false
	if (typeof content !== 'string' || !content) return false;
	// 先剥掉 title 节点，避免 title 被算进块数
	const body = stripNoteTitleHtml(content);
	// 字符数 ≥ 80k（大图笔记常见）直接判定为长文
	if (content.length >= 80_000) return true;
	// 否则按块数判定：≥ LARGE_MIN_BLOCKS 即长文
	return splitPreviewBlocks(body).length >= LARGE_MIN_BLOCKS;
}
```

**变更摘要**：双阈值判定（字符数 + 块数）；字符数优先，避免对大图笔记再走一次正则切分。

### 4.5 `LargeNoteDoc` 类型 + `createLargeNoteDoc` 函数

**对比范围**：纯新增工厂函数（无基线）。`LargeNoteDoc` 类型已在 §4.2 贴出，本节不再重复类型体。

**改动后** · `apps/remote-plugins/src/views/learning-notes/utils/doc.ts`（当前，约 L54–L71）

```typescript
// 由整篇 HTML 构造初始长文文档：拆 title、切 blocks、装第一窗
export function createLargeNoteDoc(html: string): {
	doc: LargeNoteDoc;
	title: string;
	editorHtml: string;
} {
	// 不折叠空段：预览/长文编辑窗口与短文编辑态空行一致
	// 提取标题纯文本
	const title = extractTitleText(html);
	// 剥掉 title 节点拿到正文 HTML
	const body = stripNoteTitleHtml(html);
	// 正文切成块数组
	const parts = splitPreviewBlocks(body);
	// 一个块都没有时塞一个空 p，保证编辑器有可编辑节点
	const blocks = parts.length ? parts : ['<p></p>'];
	// 第一窗 count = min(WINDOW_SIZE, blocks.length)
	const count = Math.min(WINDOW_SIZE, blocks.length);
	// 初始 doc：origin=0 起点挂第一窗
	const doc: LargeNoteDoc = { blocks, origin: 0, count };
	// 返回 doc + 标题 + 初始窗口 HTML（用于 RichEditor defaultContent）
	return {
		doc,
		title,
		editorHtml: blocks.slice(0, count).join('') || '<p></p>',
	};
}
```

**变更摘要**：构造函数返回三件套；空文档兜底 `<p></p>` 保证 TipTap 有节点可挂；初始 origin 固定 0，由 `bootLargeNote` 决定是否拉到文末。

### 4.6 `windowBodyHtml`

**对比范围**：纯新增函数（无基线）。

**改动后** · `apps/remote-plugins/src/views/learning-notes/utils/doc.ts`（当前，约 L89–L100）

```typescript
// 给定 origin，返回该窗口应挂载的 HTML 与块数
export function windowBodyHtml(
	doc: LargeNoteDoc,
	origin: number,
): {
	html: string;
	count: number;
} {
	// count = min(WINDOW_SIZE, 剩余块数)；剩余 ≤ 0 时为 0
	const count = Math.min(WINDOW_SIZE, Math.max(0, doc.blocks.length - origin));
	// 有块则拼接对应区间；否则返回一个空 p 占位
	const html =
		count > 0 ? doc.blocks.slice(origin, origin + count).join('') : '<p></p>';
	// 返回 html 与 count（count ≤ 0 时记 1，保证编辑器始终有节点）
	return { html, count: count > 0 ? count : 1 };
}
```

**变更摘要**：纯计算函数，不修改 doc；窗口越界时安全回退到 `<p></p>` 与 count=1。

### 4.7 `flushWindow`

**对比范围**：纯新增函数（无基线）。

**改动后** · `apps/remote-plugins/src/views/learning-notes/utils/doc.ts`（当前，约 L79–L87）

```typescript
// 写回当前窗口；拒绝空覆盖
export function flushWindow(doc: LargeNoteDoc, editorHtml: string): boolean {
	// 把编辑器当前 HTML 重新切成块（剥掉可能混入的 title）
	const bodyBlocks = splitPreviewBlocks(stripNoteTitleHtml(editorHtml));
	// 若切出来几乎全空且当前窗 > 3 块，判定为 setContent 中转态，拒绝写回
	if (isEffectivelyEmptyBody(bodyBlocks) && doc.count > 3) return false;
	// 空数组兜底一个空 p
	const next = bodyBlocks.length ? bodyBlocks : ['<p></p>'];
	// splice 替换 [origin, origin+count) 区间为新的块
	doc.blocks.splice(doc.origin, doc.count, ...next);
	// 更新 count 为新块数
	doc.count = next.length;
	// 返回 true 表示已成功写回
	return true;
}
```

**变更摘要**：写回时用 `splice` 原地替换当前窗口；空覆盖保护防止切窗中转态误把全文清空。

### 4.8 `originForScroll`

**对比范围**：纯新增函数（无基线）。

**改动后** · `apps/remote-plugins/src/views/learning-notes/utils/doc.ts`（当前，约 L102–L119）

```typescript
// 由滚动位置算窗口 origin（居中可视区）
export function originForScroll(
	scrollTop: number,
	viewH: number,
	blockCount: number,
	estH: number,
): number {
	// 视口中心点的绝对 Y 坐标
	const center = scrollTop + viewH / 2;
	// 视口中心对应的块索引（夹紧到 [0, blockCount-1]）
	const centerIdx = Math.max(
		0,
		Math.min(blockCount - 1, Math.floor(center / estH)),
	);
	// origin 最大值：保证最后一窗能完整显示
	const maxOrigin = Math.max(0, blockCount - WINDOW_SIZE);
	// 居中取一窗：centerIdx - WINDOW_SIZE/2，夹紧到 [0, maxOrigin]
	return Math.max(
		0,
		Math.min(maxOrigin, centerIdx - Math.floor(WINDOW_SIZE / 2)),
	);
}
```

**变更摘要**：把「视口中心 → 块索引 → 居中窗口 origin」三步合并，两端用 `max/min` 夹紧避免越界。

### 4.9 `stitchFullHtml` / `stitchFullText`

**对比范围**：纯新增函数（无基线）。

**改动后** · `apps/remote-plugins/src/views/learning-notes/utils/doc.ts`（当前，约 L121–L143）

```typescript
// 保存时回写当前窗并拼出完整 HTML（title + 全部 blocks）
export function stitchFullHtml(
	doc: LargeNoteDoc,
	title: string,
	editorHtml: string,
): string {
	// 先把编辑器当前 HTML 回写到 doc.blocks[origin..origin+count]
	flushWindow(doc, editorHtml);
	// 拼 title 节点 + 全部 blocks
	return `${titleToHtml(title)}${doc.blocks.join('')}`;
}

// 保存时回写当前窗并拼出纯文本（去标签 + 段落换行）
export function stitchFullText(
	doc: LargeNoteDoc,
	title: string,
	editorHtml: string,
): string {
	// 同样先回写当前窗
	flushWindow(doc, editorHtml);
	// 拼 title + 全部 blocks 作为 HTML 字符串
	const full = `${titleToHtml(title)}${doc.blocks.join('')}`;
	// <br> → 换行
	return full
		.replace(/<br\s*\/?>/gi, '\n')
		// </p> → 双换行（段落空行）
		.replace(/<\/p>/gi, '\n\n')
		// 去掉所有剩余标签
		.replace(/<[^>]+>/g, '')
		// 连续 ≥3 个换行压成 2 个
		.replace(/\n{3,}/g, '\n\n')
		// 首尾空白
		.trim();
}
```

**变更摘要**：保存两件套，HTML 用于回写存储，纯文本用于复制/导出。两者都先 `flushWindow` 保证当前窗不丢。

### 4.10 `isEffectivelyEmptyBody`

**对比范围**：纯新增内部函数（无基线，未导出）。

**改动后** · `apps/remote-plugins/src/views/learning-notes/utils/doc.ts`（当前，约 L73–L77）

```typescript
// 判断 blocks 是否「几乎为空」：≤3 块且全是空 p
function isEffectivelyEmptyBody(blocks: string[]): boolean {
	// 一个块都没有算空
	if (blocks.length === 0) return true;
	// 超过 3 块肯定不是空覆盖
	if (blocks.length > 3) return false;
	// 全部块都匹配空 p（含属性）才认为空
	return blocks.every((b) => /^<p\b[^>]*>\s*<\/p>$/i.test(b));
}
```

**变更摘要**：仅给 `flushWindow` 用的内部判定；阈值 3 块与 `flushWindow` 中 `doc.count > 3` 呼应，避免在长窗里被误判。

### 4.11 `LargeNoteSaveApi` 类型

**对比范围**：纯新增类型（无基线）。

**改动后** · `apps/remote-plugins/src/views/learning-notes/components/Editor.tsx`（当前，约 L30–L34）

```typescript
// 对外暴露的保存 API：父组件通过 onReady 拿到该对象后调用保存
export type LargeNoteSaveApi = {
	// 返回拼好 title 的完整 HTML（含回写当前窗）
	getHTML: () => string;
	// 返回纯文本（去标签 + 段落换行）
	getText: () => string;
	// 返回 trim 后的标题
	getTitle: () => string;
};
```

**变更摘要**：定义对外保存接口三方法；与短文编辑器 save API 形态对齐，便于上层统一调用。

### 4.12 `Props` 类型

**对比范围**：纯新增类型（无基线）。

**改动后** · `apps/remote-plugins/src/views/learning-notes/components/Editor.tsx`（当前，约 L36–L44）

```typescript
// LargeNoteEditor 的 props
type Props = {
	// 初始整篇 HTML（含 title 节点）
	defaultContent: string;
	// 编辑器语言包
	locale: Partial<RichEditorLocale>;
	// 占位文本
	placeholder?: string;
	// 工具栏额外按钮
	toolbarExtra?: RichEditorProps['toolbarExtra'];
	// 外层容器 className
	className?: string;
	// 编辑区 className
	editorClassName?: string;
	// 编辑器创建完成后回调，回传 Editor 实例与 save API
	onReady: (editor: Editor, save: LargeNoteSaveApi) => void;
};
```

**变更摘要**：与短文编辑器 props 对齐，新增 `onReady` 把保存能力外提。

### 4.13 `bootLargeNote`

**对比范围**：纯新增函数（无基线）。

**改动后** · `apps/remote-plugins/src/views/learning-notes/components/Editor.tsx`（当前，约 L46–L57）

```typescript
// 启动函数：构造 doc 并把初始窗口拉到文末（对齐短文「光标在文末」）
function bootLargeNote(defaultContent: string) {
	// 先用 createLargeNoteDoc 拿到初始 doc/title/editorHtml（origin=0 起挂第一窗）
	const created = createLargeNoteDoc(defaultContent);
	// 进编辑要对齐短文「光标在文末」：初始就挂最后一窗，避免 focus(end) 停在全文中段
	const maxOrigin = Math.max(0, created.doc.blocks.length - WINDOW_SIZE);
	// 只有 maxOrigin > 0（块数多于一窗）才需要挪到文末
	if (maxOrigin > 0) {
		// 取最后一窗的 HTML 与 count
		const { html, count } = windowBodyHtml(created.doc, maxOrigin);
		// 更新 doc 的 origin 到文末
		created.doc.origin = maxOrigin;
		// 更新 doc 的 count 为最后一窗的实际块数
		created.doc.count = count;
		// editorHtml 替换为最后一窗的 HTML，作为 RichEditor defaultContent
		created.editorHtml = html;
	}
	// 返回 boot 结果
	return created;
}
```

**变更摘要**：在 `createLargeNoteDoc` 基础上把 origin 拉到 `maxOrigin`，保证进入编辑器即贴底。

### 4.14 `scrollViewportToEnd`

**对比范围**：纯新增函数（无基线）。

**改动后** · `apps/remote-plugins/src/views/learning-notes/components/Editor.tsx`（当前，约 L59–L65）

```typescript
// 把视口滚动到底并把光标聚焦到文末
function scrollViewportToEnd(editor: Editor) {
	// 找到 RichEditor 外层 scroll-area 的 viewport 元素
	const vp = editor.view.dom.closest(
		'[data-slot="scroll-area-viewport"]',
	) as HTMLElement | null;
	// 找到就把 scrollTop 拉到底
	if (vp) vp.scrollTop = vp.scrollHeight;
	// 编辑器未销毁时聚焦光标到文末
	if (!editor.isDestroyed) editor.commands.focus('end');
}
```

**变更摘要**：双保险——既滚容器又 focus 光标，保证入场视觉与光标都在文末。

### 4.15 `LargeNoteEditor` 组件

**对比范围**：纯新增组件（无基线）。组件较长，本节贴出完整签名 + 顶部 ref/state + 关键 effect/callback + renderBody + return JSX 闭合；中部与 CSS 类名细节用 `// ...` 标注省略区间。

**改动后** · `apps/remote-plugins/src/views/learning-notes/components/Editor.tsx`（当前，约 L71–L247）

```typescript
// 长笔记连续滚动编辑组件
// 标题与短文共用 NoteTitleField，自然文档流紧贴正文（勿用固定 TITLE 槽高，否则会留大缝）
export function LargeNoteEditor({
	// 初始整篇 HTML
	defaultContent,
	// 语言包
	locale,
	// 占位文本
	placeholder,
	// 工具栏额外按钮
	toolbarExtra,
	// 外层 className
	className,
	// 编辑区 className
	editorClassName,
	// 编辑器就绪回调
	onReady,
}: Props) {
	// boot 结果只初始化一次：useRef 常量保存 doc/title/editorHtml
	const boot = useRef(bootLargeNote(defaultContent));
	// doc 引用：blocks 数组与 origin/count 都挂在它上面，跨渲染共享
	const docRef = useRef<LargeNoteDoc>(boot.current.doc);
	// 编辑器实例引用
	const editorRef = useRef<Editor | null>(null);
	// 标题外层容器引用：用于测高（标题换行高度变化时同步 padding）
	const titleWrapRef = useRef<HTMLDivElement | null>(null);
	// 标题高度缓存（不触发渲染）
	const titleHRef = useRef(0);
	// 标题 state（受控）
	const [title, setTitle] = useState(boot.current.title);
	// 标题 ref（save 时读最新值，避免闭包旧值）
	const titleRef = useRef(title);
	titleRef.current = title;
	// 当前 origin ref（applyOrigin 中读旧值判定是否变化）
	const originRef = useRef(boot.current.doc.origin);
	// 切窗中标记，防止滚动回调与 setContent 触发的滚动相互递归
	const shiftingRef = useRef(false);
	// rAF id 引用，用于节流滚动回调
	const scrollRafRef = useRef(0);
	// onReady ref，避免 onReady 变化导致 saveApi 重建
	const onReadyRef = useRef(onReady);
	onReadyRef.current = onReady;

	// 块数 state：决定 windowed 与 bodyH
	const [blockCount, setBlockCount] = useState(boot.current.doc.blocks.length);
	// offsetY state：translateY 用的偏移量
	const [offsetY, setOffsetY] = useState(boot.current.doc.origin * EST_BLOCK_H);
	// 块数不足一窗时勿按 WINDOW_SIZE 垫高（大图笔记常因 base64 进长文路径，否则文末巨空白）
	const windowed = blockCount > WINDOW_SIZE;
	// 假装全文高度，撑出滚动条
	const bodyH = Math.max(blockCount, 1) * EST_BLOCK_H;

	// useLayoutEffect：测标题高度并监听 ResizeObserver 同步
	useLayoutEffect(() => {
		// 拿到标题容器
		const el = titleWrapRef.current;
		// 容器不存在直接 return
		if (!el) return;
		// 同步函数：把 offsetHeight 写入 ref
		const sync = () => {
			titleHRef.current = el.offsetHeight;
		};
		// 立即同步一次
		sync();
		// ResizeObserver 监听后续高度变化
		const ro = new ResizeObserver(sync);
		ro.observe(el);
		// 卸载时断开 observer
		return () => ro.disconnect();
	}, []);

	// saveApi：暴露给父组件的保存能力，useCallback 保证引用稳定
	const saveApi = useCallback((): LargeNoteSaveApi => {
		return {
			// 返回完整 HTML：读编辑器当前 HTML 后 stitch
			getHTML: () => {
				const e = editorRef.current;
				// 编辑器实例存在且未销毁才取 HTML，否则空串
				const html = e && !e.isDestroyed ? e.getHTML() : '';
				// 回写当前窗并拼 title + 全部 blocks
				return stitchFullHtml(docRef.current, titleRef.current, html);
			},
			// 返回纯文本
			getText: () => {
				const e = editorRef.current;
				// 同样取编辑器 HTML
				const html = e && !e.isDestroyed ? e.getHTML() : '';
				// 调 stitchFullText 转 text
				return stitchFullText(docRef.current, titleRef.current, html);
			},
			// 返回 trim 后的标题
			getTitle: () => titleRef.current.trim(),
		};
	}, []);

	// focusBody：标题 onContinue 时把光标聚焦回正文起点
	const focusBody = useCallback(() => {
		editorRef.current?.commands.focus('start');
	}, []);

	// applyOrigin：切换窗口到 nextOrigin（核心切窗逻辑）
	const applyOrigin = useCallback((editor: Editor, nextOrigin: number) => {
		const doc = docRef.current;
		// 切窗中直接 return，防止重入
		if (shiftingRef.current) return;
		// origin 没变直接 return
		if (nextOrigin === originRef.current) return;

		// origin 上限
		const maxOrigin = Math.max(0, doc.blocks.length - WINDOW_SIZE);
		// 触顶/触底 snap：直接放行，不受 HYSTERESIS 限制
		const snapEdge =
			(nextOrigin === 0 && originRef.current !== 0) ||
			(nextOrigin === maxOrigin && originRef.current !== maxOrigin);
		// 非边缘且变化小于 HYSTERESIS，跳过本次切窗防抖
		if (
			!snapEdge &&
			Math.abs(nextOrigin - originRef.current) < ORIGIN_HYSTERESIS
		) {
			return;
		}

		// 标记进入切窗
		shiftingRef.current = true;
		try {
			// 先把当前窗 HTML 写回 doc.blocks
			flushWindow(doc, editor.getHTML());
			// 取下一窗的 HTML 与 count
			const { html, count } = windowBodyHtml(doc, nextOrigin);
			// setContent 到编辑器，emitUpdate:false 避免 onSelectionUpdate 触发
			const ok = editor.commands.setContent(html, { emitUpdate: false });
			// setContent 失败直接 return，不更新 origin/count
			if (ok === false) return;
			// 更新 doc 的 origin/count
			doc.origin = nextOrigin;
			doc.count = count;
			// 同步 originRef
			originRef.current = nextOrigin;
			// 更新 offsetY 触发 translateY 重排
			setOffsetY(nextOrigin * EST_BLOCK_H);
			// 更新 blockCount（flushWindow 可能改了 blocks.length）
			setBlockCount(doc.blocks.length);
		} finally {
			// 下一帧再放开 shifting，避免 setContent 触发的滚动事件再次切窗
			requestAnimationFrame(() => {
				shiftingRef.current = false;
			});
		}
	}, []);

	// onBodyScroll：滚动事件回调，rAF 节流后调 applyOrigin
	const onBodyScroll = useCallback(
		(e: UIEvent<HTMLDivElement>) => {
			// 拿到编辑器实例
			const editor = editorRef.current;
			// 编辑器不存在/已销毁/正在切窗时跳过
			if (!editor || editor.isDestroyed || shiftingRef.current) return;
			// 滚动容器
			const vp = e.currentTarget;
			// 标题高度：优先取 ref 缓存，回退测 offsetHeight
			const titleH =
				titleHRef.current || titleWrapRef.current?.offsetHeight || 0;
			// 减掉标题高度，得到正文 scrollTop
			const top = Math.max(0, vp.scrollTop - titleH);
			// 视口高度，默认 600
			const viewH = vp.clientHeight || 600;
			// 已有 rAF 在飞，直接 return
			if (scrollRafRef.current) return;
			// 安排下一帧计算
			scrollRafRef.current = requestAnimationFrame(() => {
				// 清掉 rAF id
				scrollRafRef.current = 0;
				// 切窗中再次跳过
				if (shiftingRef.current) return;
				// 算下一窗 origin
				const next = originForScroll(
					top,
					viewH,
					docRef.current.blocks.length,
					EST_BLOCK_H,
				);
				// 应用切窗
				applyOrigin(editor, next);
			});
		},
		[applyOrigin],
	);

	// renderBody：把标题与正文包成 RichEditor 的 children
	const renderBody = useCallback(
		(editorContent: ReactNode) => (
			// 外层 relative 容器
			<div className="relative w-full">
				{/* 文档流标题：与短文 TipTap node-title 同距，mb-2 即空隙 */}
				<div ref={titleWrapRef} className="relative z-1">
					<NoteTitleField
						value={title}
						onChange={setTitle}
						onContinue={focusBody}
					/>
				</div>
				{windowed ? (
					<div className="relative w-full" style={{ height: bodyH }}>
						<div
							className="absolute top-0 right-0 left-0"
							style={{ transform: `translateY(${offsetY}px)` }}
						>
							{editorContent}
						</div>
					</div>
				) : (
					<div className="relative w-full">{editorContent}</div>
				)}
			</div>
		),
		[bodyH, focusBody, offsetY, title, windowed],
	);

	return (
		<div className={cn('flex h-full min-h-0 min-w-0 flex-col', className)}>
			<RichEditor
				defaultContent={boot.current.editorHtml}
				showTitle={false}
				autofocus={false}
				placeholder={placeholder}
				locale={locale}
				showCharCount={false}
				showBubbleMenu={false}
				onBodyScroll={onBodyScroll}
				renderBody={renderBody}
				onCreate={(e) => {
					editorRef.current = e;
					docRef.current.origin = originRef.current;
					onReadyRef.current(e, saveApi());
					// 布局完成后再滚到底 + 焦点文末（双 rAF 等绝对定位 offset 生效）
					requestAnimationFrame(() => {
						scrollViewportToEnd(e);
						requestAnimationFrame(() => scrollViewportToEnd(e));
					});
				}}
				className="flex min-h-0 flex-1 flex-col overflow-hidden"
				editorClassName={editorClassName}
				toolbarExtra={toolbarExtra}
			/>
		</div>
	);
}
```

**变更摘要**：组件聚合 ref（boot/docRef/editorRef/titleWrapRef/titleHRef/originRef/shiftingRef/scrollRafRef/onReadyRef）+ state（title/blockCount/offsetY），通过 `useLayoutEffect` 测标题高、`saveApi`/`focusBody`/`applyOrigin`/`onBodyScroll`/`renderBody` 一组 callback 串起切窗流程；`onCreate` 中完成首次对齐 + 双 rAF 滚到底。

### 4.16 `NotesListPanel` 组件

**对比范围**：纯新增组件（无基线）。

**改动后** · `apps/remote-plugins/src/views/learning-notes/components/NotesListPanel.tsx`（当前，约 L1–L226）

```typescript
// 加载态组件
import Loading from '@design/Loading';
// Btn 工具栏按钮
import { Btn } from '@design/RichEditor';
// lucide 图标：底/顶/定位/编辑/删除
import {
	ChevronDown,
	ChevronUp,
	LocateFixed,
	SquarePen,
	Trash2,
} from 'lucide-react';
// mobx-react observer：让本组件独立订阅 store，避免牵动右侧
import { observer } from 'mobx-react';
// React hooks
import { useCallback, useEffect, useRef, useState } from 'react';
// ScrollArea 容器
import { ScrollArea } from '@/components/ui/scroll-area';
// i18n hook
import { useI18n } from '@/hooks';
// cn 类名合并
import { cn } from '@/lib/utils';
// 全局 store
import useStore from '@/store';

// 视为触顶/触底的像素阈值
const SCROLL_EDGE_PX = 16;

// 笔记列表滚动：同一按钮循环 底 → 顶 → 当前（无选中时底 → 顶）
type NoteScrollMode = 'bottom' | 'top' | 'current';

// 列表独立 observer：滚动 / loadMore / scrollEdge 只重渲左侧，
// 避免牵动右侧 TipTap/大 HTML 预览（长文时滚动卡顿主因）
export const NotesListPanel = observer(function NotesListPanel({
	// 用于 toLocaleString 的语言
	locale,
}: {
	locale: string;
}) {
	// 从全局 store 拿 learningNotesStore
	const { learningNotesStore: store } = useStore();
	// i18n t 函数
	const { t } = useI18n();
	// 滚动容器 ref
	const scrollViewportRef = useRef<HTMLDivElement>(null);
	// 当前选中项 ref（用于 scrollIntoView）
	const activeItemRef = useRef<HTMLDivElement>(null);
	// rAF id 引用
	const scrollRafRef = useRef(0);
	// 滚动按钮模式 state
	const [scrollMode, setScrollMode] = useState<NoteScrollMode>('bottom');
	// 当前处于顶/底/中哪一端
	const [scrollEdge, setScrollEdge] = useState<'top' | 'bottom' | null>(null);

	// 同步 edge 状态并在触底时 loadMore
	const syncScrollEdge = useCallback(() => {
		// 拿滚动容器
		const el = scrollViewportRef.current;
		// 容器不存在直接 return
		if (!el) return;
		// 解构三个滚动属性
		const { scrollTop, scrollHeight, clientHeight } = el;
		// 默认无 edge
		let edge: 'top' | 'bottom' | null = null;
		// 顶部阈值内判 top
		if (scrollTop <= SCROLL_EDGE_PX) edge = 'top';
		// 底部阈值内判 bottom
		else if (scrollTop + clientHeight >= scrollHeight - SCROLL_EDGE_PX)
			edge = 'bottom';
		// 与 prev 相同就不 setState，避免无谓渲染
		setScrollEdge((prev) => (prev === edge ? prev : edge));
		// 距底 3 倍阈值时预加载下一页
		if (scrollTop + clientHeight >= scrollHeight - SCROLL_EDGE_PX * 3) {
			void store.loadMore();
		}
	}, [store]);

	// 滚动事件回调：rAF 节流
	const onViewportScroll = useCallback(() => {
		// 已有 rAF 在飞直接 return
		if (scrollRafRef.current) return;
		// 安排下一帧
		scrollRafRef.current = requestAnimationFrame(() => {
			// 清 rAF id
			scrollRafRef.current = 0;
			// 同步 edge 与 loadMore
			syncScrollEdge();
		});
	}, [syncScrollEdge]);

	// mount 时初始化 edge；unmount 时取消 rAF
	useEffect(() => {
		// 默认从底开始
		setScrollMode('bottom');
		// 立即同步一次 edge
		syncScrollEdge();
		// 卸载清理
		return () => {
			if (scrollRafRef.current) cancelAnimationFrame(scrollRafRef.current);
		};
	}, [syncScrollEdge]);

	// 没有选中项时不能停在 current 模式，回退 bottom
	useEffect(() => {
		// 无选中且当前模式是 current → 切回 bottom
		if (!store.hasActive && scrollMode === 'current') {
			setScrollMode('bottom');
		}
	}, [store.hasActive, scrollMode]);

	// FAB 点击：按当前模式滚到对应端，并切到下一模式
	const onScrollFabClick = useCallback(() => {
		// 拿容器
		const vp = scrollViewportRef.current;
		// 容器不存在直接 return
		if (!vp) return;

		// 解构滚动属性
		const { scrollTop, scrollHeight, clientHeight } = vp;
		// 是否已贴顶
		const atTop = scrollTop <= SCROLL_EDGE_PX;
		// 是否已贴底
		const atBottom = scrollTop + clientHeight >= scrollHeight - SCROLL_EDGE_PX;
		// 当前模式
		let mode = scrollMode;
		// 已在底且模式是 bottom → 切到 top
		if (mode === 'bottom' && atBottom) mode = 'top';
		// 已在顶且模式是 top → 切到 bottom
		else if (mode === 'top' && atTop) mode = 'bottom';

		// 按模式滚动
		if (mode === 'bottom') {
			// 滚到底
			vp.scrollTo({ top: vp.scrollHeight, behavior: 'auto' });
		} else if (mode === 'top') {
			// 滚到顶
			vp.scrollTo({ top: 0, behavior: 'auto' });
		} else {
			// 滚到当前选中项中心
			activeItemRef.current?.scrollIntoView({
				block: 'center',
				behavior: 'auto',
			});
		}

		// 滚完切到下一模式
		if (mode === 'bottom') setScrollMode('top');
		// top → 有选中 current，无选中 bottom
		else if (mode === 'top')
			setScrollMode(store.hasActive ? 'current' : 'bottom');
		// current → bottom
		else setScrollMode('bottom');
	}, [scrollMode, store.hasActive]);

	// 实际显示模式：已在对应端时切到反向，提示用户下一动作
	const displayMode: NoteScrollMode =
		scrollMode === 'bottom' && scrollEdge === 'bottom'
			? 'top'
			: scrollMode === 'top' && scrollEdge === 'top'
				? 'bottom'
				: scrollMode;

	// 按钮标题
	const scrollTitle =
		displayMode === 'bottom'
			? t('learningNotes.scrollBottom')
			: displayMode === 'top'
				? t('learningNotes.scrollTop')
				: t('learningNotes.scrollCurrent');

	// 当前激活项 id（预览或编辑中）
	const activeId = store.preview?.id ?? store.editingId;

	return (
		<aside className="border-r mb-3 border-theme/10 flex h-full min-h-0 min-w-0 flex-col overflow-hidden contain-[layout_paint]">
			<div className="flex h-10 shrink-0 items-center justify-between border-b border-theme/10 pl-3 pr-1.5 font-medium tracking-wide">
				<div className="text-textcolor/85">
					{t('learningNotes.listTitle')}
					<span className="ml-3 text-xs text-textcolor/60">
						{t('common.loadedCount', {
							loaded: store.list.length,
							total: store.total,
						})}
					</span>
				</div>
				<Btn title={scrollTitle} onClick={onScrollFabClick}>
					{displayMode === 'bottom' ? (
						<ChevronDown size={18} />
					) : displayMode === 'top' ? (
						<ChevronUp size={18} />
					) : (
						<LocateFixed size={15} />
					)}
				</Btn>
			</div>
			{/* ScrollArea 与想法列表/编辑器滚动条一致；逻辑仍 rAF 节流，不重渲右侧 */}
			<ScrollArea
				ref={scrollViewportRef}
				className="min-h-0 flex-1 p-3"
				onScroll={onViewportScroll}
			>
				{store.loading ? (
					<div className="flex min-h-full flex-1 flex-col items-center justify-center py-6 text-center text-sm text-textcolor/60">
						<Loading />
					</div>
				) : (
					<div className="flex flex-col gap-3">
						{store.list.length === 0 ? (
							<p className="text-textcolor/45 px-1 py-6 text-center text-xs">
								{t('learningNotes.empty')}
							</p>
						) : null}
						{store.list.map((n) => {
							const active = activeId === n.id;
							return (
								<div
									key={n.id}
									ref={active ? activeItemRef : undefined}
									className={cn(
										'hover:bg-theme/10 bg-theme/5 group relative w-full rounded-md px-3 py-2.5 text-left contain-[layout_paint]',
										active && 'bg-theme/15',
									)}
								>
									<button
										type="button"
										className="w-full cursor-pointer text-left"
										onClick={() => void store.openPreview(n.id)}
									>
										<div className="text-textcolor truncate text-base font-semibold pr-0 group-hover:pr-14">
											{n.title}
										</div>
										<div className="text-textcolor/45 mt-1.5 text-xs">
											{new Date(n.at).toLocaleString(locale)}
										</div>
									</button>
									<div className="absolute top-2 right-2 flex items-center gap-0.5 opacity-0 group-hover:opacity-100">
										<button
											type="button"
											title={t('learningNotes.edit')}
											className="w-7 h-7 text-textcolor/80 hover:text-teal-500 hover:bg-teal-500/10 flex cursor-pointer items-center justify-center rounded-md p-1"
											onClick={(e) => {
												e.stopPropagation();
												void store.openEditById(n.id);
											}}
										>
											<SquarePen size={15} />
										</button>
										<button
											type="button"
											title={t('learningNotes.delete')}
											className="w-7 h-7 text-textcolor/80 hover:text-destructive hover:bg-destructive/10 flex cursor-pointer items-center justify-center rounded-md p-1"
											onClick={(e) => {
												e.stopPropagation();
												store.requestDelete(n.id);
											}}
										>
											<Trash2 size={15} />
										</button>
									</div>
								</div>
							);
						})}
						{store.loadingMore ? (
							<p className="text-textcolor/45 py-2 text-center text-xs">
								{t('common.loading')}
							</p>
						) : null}
						{!store.loading &&
						!store.loadingMore &&
						store.list.length > 0 &&
						!store.hasMore ? (
							<p className="text-textcolor/35 py-2 text-center text-xs">
								{t('common.noMore')}
							</p>
						) : null}
					</div>
				)}
			</ScrollArea>
		</aside>
	);
});
```

**变更摘要**：组件以 `observer` 包裹独立订阅 store；滚动事件经 rAF 节流；FAB 三态循环（底 → 顶 → 当前）；触底 `loadMore`；列表项 hover 才显示编辑/删除按钮，避免长列表每项都挂事件造成卡顿。

## 5. 兼容性与影响

- **向后兼容**：对未命中长文阈值（`isLargeNoteHtml === false`）的笔记走短文编辑器路径，行为不变。
- **窗口模式 vs 非窗口模式**：`windowed = blockCount > WINDOW_SIZE`。大图笔记（块少体积大）走非窗口模式，不按 WINDOW_SIZE 垫高，避免文末巨量空白。
- **保存语义**：`getHTML` / `getText` 都会先 `flushWindow` 再拼装，保证当前窗不丢；多次保存幂等（同一 doc.blocks 数组）。
- **空覆盖保护**：`flushWindow` 在 `isEffectivelyEmptyBody && doc.count > 3` 时拒绝写回，避免 setContent 中转态误把全文清空。
- **滚动性能**：列表与编辑器解耦，长笔记滚动不再牵动右侧 TipTap；切窗用 `shiftingRef` + rAF 防递归。
- **回归建议**：
  - 新建笔记（空）→ 进入编辑器 → 输入保存：blocks 与 title 正确。
  - 中等长度（30 块）→ 不进窗口模式，行为同短文。
  - 长文（120 块）→ 进窗口模式，从文末开始；滚到中段切窗不丢内容；保存后重新打开仍是 120 块。
  - 大图笔记（5 块但 200KB）→ 不进窗口模式，但 `isLargeNoteHtml` 因字符数 ≥ 80k 命中，需确认上层路由仍走 `LargeNoteEditor`（窗口模式分支 `windowed=false` 时不会垫高，行为正确）。
  - 列表滚动 + 右侧编辑器同时操作：FPS 稳定。

## 6. 相关源码路径

| 说明 | 路径 |
| ---- | ---- |
| 长文窗口化工具函数 | `apps/remote-plugins/src/views/learning-notes/utils/doc.ts` |
| utils 聚合导出 | `apps/remote-plugins/src/views/learning-notes/utils/index.ts` |
| 长文编辑器组件 | `apps/remote-plugins/src/views/learning-notes/components/Editor.tsx` |
| 笔记列表面板 | `apps/remote-plugins/src/views/learning-notes/components/NotesListPanel.tsx` |
| 切块/去 title 复用源 | `apps/remote-plugins/src/components/design/NotePreview/previewHtml.ts` |
| 底层富文本编辑器 | `apps/remote-plugins/src/components/design/RichEditor` |

---

（若与仓库最新源码不一致，以源码为准）
