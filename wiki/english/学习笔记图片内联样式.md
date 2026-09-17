# 学习笔记图片样式改内联 style（去 MF @scope 依赖）

## 1. 背景与目标

学习笔记的富文本编辑器与只读预览中，图片的 `margin` 间距与 `border-radius` 圆角原本由 Module Federation（MF）`@scope` 下的 stylesheet 提供。但在 Tauri/WebKit 环境下存在两个稳定性问题：

1. `contain: style` 会导致子树样式「进页不生效」——首屏渲染时图片间距/圆角缺失，鼠标移入才闪一下补上。
2. MF `@scope` stylesheet 在刷新后常常失效，图片几何样式丢失。

本次改动的目标：

- 把图片的 `margin`、`border-radius` 改为**内联 `style`**，不再依赖外部 stylesheet 命中。
- 去掉 `NotePreview` 容器上的 `contain: style`，仅保留 `contain: layout paint`，避免子树样式被 contain 隔断。
- 收敛「首图去顶距」逻辑：只有文档真正的起点（窗口 `origin === 0`）才让首图 `margin-top: 0`，长文滚动窗口的中间片段不再误把窗口首图当作文档首图。
- 调整首块去顶距选择器，避免 `*:first-child` 把图片顶距也清掉。
- 调整 Loading 蒙层背景色与 contain 策略，配合上述样式收敛。

## 2. 改动范围

- `apps/remote-plugins/src/components/design/NotePreview/index.tsx` — 容器 `contain-[layout_paint_style]` → `contain-[layout_paint]`。
- `apps/remote-plugins/src/components/design/NotePreview/previewHtml.ts` — 新增图片内联样式常量、`startsWithImg`、`withImgInlineStyle`、`DecoratePreviewHtmlOptions`；`decoratePreviewHtml` 增加 `flushLeadingImg` 选项；`preparePreviewBody` 注释更新。
- `apps/remote-plugins/src/components/design/NotePreview/styles.css` — 去掉 `padding-top: 0.28rem`；首块去顶距选择器由 `*:first-child` 收窄为 `:first-child:is(h1,…,table)`。
- `apps/remote-plugins/src/components/design/RichEditor/extensions/index.ts` — `Image` 的 `HTMLAttributes` 增加内联 `style`。
- `apps/remote-plugins/src/components/design/RichEditor/styles.css` — `img` 选择器加 `:not(.ProseMirror-separator)`；新增 `:hover` 锁圆角；新增 `[data-resize-container]` 间距规则。
- `apps/remote-plugins/src/views/learning-notes/components/PreviewBody.tsx` — `decoratePreviewHtml` 传 `flushLeadingImg: origin === 0`。
- `apps/remote-plugins/src/views/learning-notes/index.tsx` — 两处 Loading 蒙层去掉 `bg-theme/5`。

## 3. 实现思路

1. **样式内联优先**：编辑态由 TipTap `Image` 扩展的 `HTMLAttributes.style` 直接把 `margin`/`border-radius` 写到 `<img>` 上；预览态由 `decoratePreviewHtml` 在 HTML 字符串里为每个 `<img>` 注入/覆盖内联 `style`。这样即便 MF `@scope` stylesheet 失效，图片几何仍由内联样式兜底。
2. **去掉 contain: style**：`NotePreview` 容器只保留 `contain: layout paint`。`contain: style` 在 WebKit/Tauri 下会阻断子树样式生效，移除后预览子树（含图片）样式能正常进页。
3. **首图顶距分场景**：文档真正的起点首图应顶到容器顶部（`margin-top: 0`）；但长文窗口预览（`WindowedPreviewBody`）在滚动到中段时，窗口切片的首图并不是文档首图，不能去顶距。因此 `decoratePreviewHtml` 新增 `flushLeadingImg` 选项，调用方按 `origin === 0` 判定。
4. **首块选择器收窄**：原 `*:first-child` 会命中 `<img>`，把图片 `margin-top` 清成 0；改为 `:first-child:is(h1,…,table)` 仅对块级标题/列表/表格等去顶距，图片顶距交给内联 style 与 RichEditor 的「前驱 + img」规则负责。
5. **编辑态 resize 容器**：开启图片缩放时图片被包在 `[data-resize-container]` 里，需单独给容器加 `margin` 并把内部 `img` 的 `margin` 清零，避免内外双重间距。
6. **Loading 蒙层**：去掉 `bg-theme/5` 半透明背景，避免与 contain/样式收敛后的渲染层叠产生视觉残留。

## 4. 关键代码对比与注释

### 4.1 `NotePreview` 容器去 `contain: style`（`apps/remote-plugins/src/components/design/NotePreview/index.tsx`）

**对比范围**：`NotePreview` 组件函数（摘录 return 外层 div 的 `className` 区域，前后对称省略未改动部分）。

**改动前** · `apps/remote-plugins/src/components/design/NotePreview/index.tsx`（基线，`NotePreview` 组件 return 区域）

```tsx
// 笔记只读预览组件：与编辑态共用 ScrollArea + RichEditor 正文样式
export function NotePreview({
	// ...（未改动：props 解构，约 L39–L50）
}: NotePreviewProps) {
	// 取 i18n 翻译函数
	const { t } = useI18n();
	// ...（未改动：empty 兜底与 bodyHtml 的 useMemo，约 L52–L56）
	// 组件返回结构
	return (
		// 最外层容器 div：用 cn 合并基础类名与调用方传入的 className
		<div
			className={cn(
				// contain：预览大 DOM 不参与左侧列表滚动时的布局/绘制连锁（旧版含 style）
				'note-preview flex h-full min-h-0 min-w-0 flex-col overflow-hidden rounded-r-md contain-[layout_paint_style]',
				// 调用方透传的 className，可覆盖默认样式
				className,
			)}
		>
			{/* ...（未改动：header / 正文 / footer，约 L67–L107）*/}
		</div>
	);
}
```

**改动后** · `apps/remote-plugins/src/components/design/NotePreview/index.tsx`（当前，`NotePreview` 组件 return 区域，约 L58–L66）

```tsx
// 笔记只读预览组件：与编辑态共用 ScrollArea + RichEditor 正文样式
export function NotePreview({
	// ...（未改动：props 解构，约 L39–L50）
}: NotePreviewProps) {
	// 取 i18n 翻译函数
	const { t } = useI18n();
	// ...（未改动：empty 兜底与 bodyHtml 的 useMemo，约 L52–L56）
	// 组件返回结构
	return (
		// 最外层容器 div：用 cn 合并基础类名与调用方传入的 className
		<div
			className={cn(
				// 源码注释：说明 contain 只保留 layout/paint 的原因（上半句）
				// contain layout/paint：大预览 DOM 不拖累左侧列表；勿加 style——
				// 源码注释：续注，点出 WebKit/Tauri 下 contain:style 的副作用
				// WebKit/Tauri 下 contain:style 会导致子树样式进页不生效，鼠标移入才闪一下补上（如图 margin）
				// 容器基础类名：相比旧版去掉 _style，仅保留 layout_paint
				'note-preview flex h-full min-h-0 min-w-0 flex-col overflow-hidden rounded-r-md contain-[layout_paint]',
				// 调用方透传的 className，可覆盖默认样式
				className,
			)}
		>
			{/* ...（未改动：header / 正文 / footer，约 L67–L107）*/}
		</div>
	);
}
```

**变更摘要**：容器类名由 `contain-[layout_paint_style]` 改为 `contain-[layout_paint]`，移除 `contain: style` 以免 WebKit/Tauri 下预览子树样式（图片 margin 等）进页不生效。

### 4.2 图片内联样式工具与 `decoratePreviewHtml` 重构（`apps/remote-plugins/src/components/design/NotePreview/previewHtml.ts`）

#### 4.2.1 新增常量（纯新增）

**改动后** · `apps/remote-plugins/src/components/design/NotePreview/previewHtml.ts`（当前，约 L25–L27，纯新增）

```ts
// 图片圆角统一声明字符串，供内联 style 拼接复用
const IMG_RADIUS = 'border-radius: 0.5rem';
// 图片默认上下间距声明（左右 0），与编辑态内联 style 保持一致
const IMG_MARGIN = 'margin: 0.75em 0';
// 首图去顶距声明：仅首张图 margin-top 为 0，用于文档起点首图顶到容器顶部
const IMG_MARGIN_FLUSH_TOP = 'margin: 0 0 0.75em';
```

#### 4.2.2 `startsWithImg`（纯新增）

**改动后** · `apps/remote-plugins/src/components/design/NotePreview/previewHtml.ts`（当前，约 L29–L32，纯新增）

```ts
/** 正文是否以 `<img` 开头（忽略前导空白） */
// 判断正文片段是否以 <img 开头，用于决定首图是否去顶距
export function startsWithImg(html: string): boolean {
	// 正则：行首允许空白，随后匹配 <img 单词边界，大小写不敏感
	return /^\s*<img\b/i.test(html);
}
```

#### 4.2.3 `withImgInlineStyle`（纯新增）

**改动后** · `apps/remote-plugins/src/components/design/NotePreview/previewHtml.ts`（当前，约 L34–L60，纯新增）

```ts
/** 写入/覆盖 style 里的 margin 与 border-radius */
// 给 <img> 的属性串注入/覆盖 margin 与 border-radius 内联声明
function withImgInlineStyle(attrs: string, marginDecl: string): string {
	// 组装本次要写入的 style 值：先 margin 声明，再加圆角声明
	const styleValue = `${marginDecl}; ${IMG_RADIUS}`;
	// 分支一：已有双引号 style="..."，原地替换其内容
	if (/\bstyle\s*=\s*"/i.test(attrs)) {
		// 匹配并替换双引号包裹的 style 值
		return attrs.replace(/\bstyle\s*=\s*"([^"]*)"/i, (_m, raw: string) => {
			// 清掉旧的 margin 声明，避免重复
			const rest = raw
				.replace(/\bmargin\s*:[^;]*;?/gi, '')
				// 清掉旧的 border-radius 声明，避免重复
				.replace(/\bborder-radius\s*:[^;]*;?/gi, '')
				// 去首尾空白
				.trim()
				// 去掉首尾残留的分号
				.replace(/^;+|;+$/g, '')
				// 再次去空白
				.trim();
			// 若还有其它声明则拼在新声明之后，否则只写新声明
			return `style="${rest ? `${styleValue}; ${rest}` : styleValue}"`;
		});
	}
	// 分支二：已有单引号 style='...'，原地替换其内容
	if (/\bstyle\s*=\s*'/i.test(attrs)) {
		// 匹配并替换单引号包裹的 style 值
		return attrs.replace(/\bstyle\s*=\s*'([^']*)'/i, (_m, raw: string) => {
			// 清掉旧的 margin 声明
			const rest = raw
				.replace(/\bmargin\s*:[^;]*;?/gi, '')
				// 清掉旧的 border-radius 声明
				.replace(/\bborder-radius\s*:[^;]*;?/gi, '')
				// 去首尾空白
				.trim()
				// 去掉首尾残留的分号
				.replace(/^;+|;+$/g, '')
				// 再次去空白
				.trim();
			// 用单引号包裹返回，逻辑同双引号分支
			return `style='${rest ? `${styleValue}; ${rest}` : styleValue}'`;
		});
	}
	// 分支三：原本没有 style 属性，直接追加 style="..."
	return `${attrs} style="${styleValue}"`;
}
```

#### 4.2.4 `DecoratePreviewHtmlOptions`（纯新增）

**改动后** · `apps/remote-plugins/src/components/design/NotePreview/previewHtml.ts`（当前，约 L62–L68，纯新增）

```ts
// decoratePreviewHtml 的可选参数类型
export type DecoratePreviewHtmlOptions = {
	/**
	 * 为 true 且正文以图开头时，首张图 margin-top: 0。
	 * 长文窗口 origin>0 时须传 false，避免窗口首图误当成文档首图。
	 */
	// 首图是否去顶距；仅文档窗口起点传 true
	flushLeadingImg?: boolean;
};
```

#### 4.2.5 `decoratePreviewHtml`

**对比范围**：`decoratePreviewHtml` 全函数（声明到 `}`）。

**改动前** · `apps/remote-plugins/src/components/design/NotePreview/previewHtml.ts`（基线，约 L25–L33）

```ts
/** 预览图异步解码；已有对应属性则不改 */
// 旧版：仅为 <img> 补 loading/decoding，不处理内联样式
export function decoratePreviewHtml(html: string): string {
	// 空串直接返回
	if (!html) return '';
	// 全局匹配所有 <img ...>，逐个补懒加载属性
	return html.replace(/<img\b([^>]*)>/gi, (_full, attrs: string) => {
		// 当前 img 的属性串
		let next = attrs;
		// 没有 loading 属性则补 lazy
		if (!/\bloading\s*=/i.test(next)) next += ' loading="lazy"';
		// 没有 decoding 属性则补 async
		if (!/\bdecoding\s*=/i.test(next)) next += ' decoding="async"';
		// 拼回完整 <img> 标签返回
		return `<img${next}>`;
	});
}
```

**改动后** · `apps/remote-plugins/src/components/design/NotePreview/previewHtml.ts`（当前，约 L70–L91）

```ts
/** 预览图：懒加载 + 内联 margin/圆角（不依赖 MF @scope 下的 stylesheet） */
// 新版：除懒加载外，还为每个 <img> 注入内联 margin/圆角，并可让首图去顶距
export function decoratePreviewHtml(
	// 待处理的 HTML 字符串
	html: string,
	// 可选参数：控制首图是否去顶距
	opts?: DecoratePreviewHtmlOptions,
): string {
	// 空串直接返回
	if (!html) return '';
	// 是否允许首图去顶距：未显式传 false 且正文以 <img 开头时为 true
	const flushLeading =
		opts?.flushLeadingImg !== false && startsWithImg(html);
	// 标记是否正在处理第一张图
	let isFirst = true;
	// 全局匹配所有 <img ...>，逐个补懒加载 + 内联样式
	return html.replace(/<img\b([^>]*)>/gi, (_full, attrs: string) => {
		// 当前 img 的属性串
		let next = attrs;
		// 没有 loading 属性则补 lazy
		if (!/\bloading\s*=/i.test(next)) next += ' loading="lazy"';
		// 没有 decoding 属性则补 async
		if (!/\bdecoding\s*=/i.test(next)) next += ' decoding="async"';
		// 当前图是否要去顶距：仅允许首图去顶距且确实是第一张
		const flushTop = flushLeading && isFirst;
		// 处理过一张后关闭首图标记
		isFirst = false;
		// 注入/覆盖内联 style：首图用去顶距声明，其余用默认间距声明
		next = withImgInlineStyle(
			next,
			// 三目：去顶距则用 IMG_MARGIN_FLUSH_TOP，否则 IMG_MARGIN
			flushTop ? IMG_MARGIN_FLUSH_TOP : IMG_MARGIN,
		);
		// 拼回完整 <img> 标签返回
		return `<img${next}>`;
	});
}
```

**变更摘要**：`decoratePreviewHtml` 新增 `opts` 参数与首图去顶距逻辑，并为每个 `<img>` 调用 `withImgInlineStyle` 写入内联 `margin`/`border-radius`，不再依赖 stylesheet。

#### 4.2.6 `preparePreviewBody`

**对比范围**：`preparePreviewBody` 全函数（声明到 `}`）。

**改动前** · `apps/remote-plugins/src/components/design/NotePreview/previewHtml.ts`（基线，约 L58–L60）

```ts
/** 预览正文：去 title、保留空行（与编辑态一致），图懒加载 */
// 组装预览正文：去 title → 补空段 → 装饰 img
export function preparePreviewBody(html: string): string {
	// 串联三个处理步骤得到最终预览 HTML
	return decoratePreviewHtml(preserveEmptyParagraphs(stripNoteTitleHtml(html)));
}
```

**改动后** · `apps/remote-plugins/src/components/design/NotePreview/previewHtml.ts`（当前，约 L118–L121）

```ts
/** 预览正文：去 title、保留空行（与编辑态一致），图懒加载 + 首图顶距 */
// 组装预览正文：去 title → 补空段 → 装饰 img（注释补充首图顶距语义）
export function preparePreviewBody(html: string): string {
	// 串联三个处理步骤得到最终预览 HTML（decoratePreviewHtml 默认开启首图去顶距）
	return decoratePreviewHtml(preserveEmptyParagraphs(stripNoteTitleHtml(html)));
}
```

**变更摘要**：仅更新注释，点出 `decoratePreviewHtml` 现在会处理首图顶距；函数体未变（默认 `flushLeadingImg` 为 `true`，适用于 `NotePreview` 这种以文档正文为输入的场景）。

### 4.3 `NotePreview/styles.css` 去顶距与首块选择器（`apps/remote-plugins/src/components/design/NotePreview/styles.css`）

#### 4.3.1 正文容器 padding

**对比范围**：`.note-preview-editor .rich-editor-body, .note-preview-static.rich-editor-body` 规则块。

**改动前** · `apps/remote-plugins/src/components/design/NotePreview/styles.css`（基线，约 L5–L9）

```css
/* 编辑态与静态预览共用的正文容器 */
.note-preview-editor .rich-editor-body,
.note-preview-static.rich-editor-body {
	/* 四向内边距 */
	padding: 0.75rem;
	/* 顶部内边距收小，给标题/首块让位（旧版） */
	padding-top: 0.28rem;
	/* 两端对齐 */
	text-align: justify;
}
```

**改动后** · `apps/remote-plugins/src/components/design/NotePreview/styles.css`（当前，约 L5–L9）

```css
/* 编辑态与静态预览共用的正文容器 */
.note-preview-editor .rich-editor-body,
.note-preview-static.rich-editor-body {
	/* 四向内边距 */
	padding: 0.75rem;
	/* 两端对齐（去掉 padding-top:0.28rem，统一由首块去顶距规则处理） */
	text-align: justify;
}
```

**变更摘要**：删除 `padding-top: 0.28rem`，顶部留白统一交给首块去顶距规则，避免与图片内联 margin 叠加产生不一致顶距。

#### 4.3.2 首块去顶距选择器

**对比范围**：三个 `:first-child` 去顶距选择器合并块。

**改动前** · `apps/remote-plugins/src/components/design/NotePreview/styles.css`（基线，约 L23–L27）

```css
/* 旧版：任意首个子元素都去顶距 */
.note-preview-editor .ProseMirror > *:first-child,
.note-preview-static .ProseMirror > *:first-child,
.note-preview-static.rich-editor-body > .tiptap > *:first-child {
	/* 首块上外边距清零 */
	margin-top: 0;
}
```

**改动后** · `apps/remote-plugins/src/components/design/NotePreview/styles.css`（当前，约 L22–L67）

```css
/* 首块标题等去顶距。不要写 img/:first-child——WebKit+@scope 下会把后续图的间距也清掉；
   图的顶距由 RichEditor 里「前驱 + img」规则负责。 */
/* 编辑态：首个子元素若为标题/块级元素则去顶距 */
.note-preview-editor .ProseMirror > :first-child:is(
	/* 一级标题 */
	h1,
	/* 二级标题 */
	h2,
	/* 三级标题 */
	h3,
	/* 四级标题 */
	h4,
	/* 五级标题 */
	h5,
	/* 六级标题 */
	h6,
	/* 引用块 */
	blockquote,
	/* 代码块 */
	pre,
	/* 分割线 */
	hr,
	/* 无序列表 */
	ul,
	/* 有序列表 */
	ol,
	/* 表格 */
	table
),
/* 静态预览（ProseMirror 容器）：同样限定首块类型 */
.note-preview-static .ProseMirror > :first-child:is(
	/* 一级标题 */
	h1,
	/* 二级标题 */
	h2,
	/* 三级标题 */
	h3,
	/* 四级标题 */
	h4,
	/* 五级标题 */
	h5,
	/* 六级标题 */
	h6,
	/* 引用块 */
	blockquote,
	/* 代码块 */
	pre,
	/* 分割线 */
	hr,
	/* 无序列表 */
	ul,
	/* 有序列表 */
	ol,
	/* 表格 */
	table
),
/* 静态预览（tiptap 容器）：同样限定首块类型 */
.note-preview-static.rich-editor-body > .tiptap > :first-child:is(
	/* 一级标题 */
	h1,
	/* 二级标题 */
	h2,
	/* 三级标题 */
	h3,
	/* 四级标题 */
	h4,
	/* 五级标题 */
	h5,
	/* 六级标题 */
	h6,
	/* 引用块 */
	blockquote,
	/* 代码块 */
	pre,
	/* 分割线 */
	hr,
	/* 无序列表 */
	ul,
	/* 有序列表 */
	ol,
	/* 表格 */
	table
) {
	/* 首块上外边距清零 */
	margin-top: 0;
}
```

**变更摘要**：选择器由 `*:first-child` 收窄为 `:first-child:is(h1,…,table)`，避免命中 `<img>` 而把图片顶距清零；图片顶距改由内联 style 与 RichEditor 规则负责。

### 4.4 `Image` 扩展内联 style（`apps/remote-plugins/src/components/design/RichEditor/extensions/index.ts`）

**对比范围**：`createExtensions` 内 `Image.configure({ … })` 配置块（前后对称省略其余扩展）。

**改动前** · `apps/remote-plugins/src/components/design/RichEditor/extensions/index.ts`（基线，`createExtensions` 内 `Image.configure`，约 L111–L118）

```ts
		// 配置 Image 扩展（旧版仅 class）
		Image.configure({
			// 块级图片，不内联
			inline: false,
			// 允许 base64 内联图
			allowBase64: true,
			// 导出 HTML 时加 class，依赖 stylesheet 控制几何
			HTMLAttributes: { class: 'rich-editor-image' },
			// ...（未改动：imageResize 条件分支）
		}),
```

**改动后** · `apps/remote-plugins/src/components/design/RichEditor/extensions/index.ts`（当前，`createExtensions` 内 `Image.configure`，约 L111–L118）

```ts
		// 配置 Image 扩展（新版加内联 style）
		Image.configure({
			// 块级图片，不内联
			inline: false,
			// 允许 base64 内联图
			allowBase64: true,
			// HTMLAttributes 同时输出 class 与内联 style
			HTMLAttributes: {
				// 保留 class 供 hover/resize 等选择器使用
				class: 'rich-editor-image',
				// 内联间距/圆角：刷新后 MF @scope 样式常失效，不依赖 stylesheet
				style: 'margin: 0.75em 0; border-radius: 0.5rem',
			},
			// ...（未改动：imageResize 条件分支）
		}),
```

**变更摘要**：`HTMLAttributes` 由仅 `{ class }` 改为同时输出内联 `style`，让编辑态导出的 `<img>` 自带 `margin`/`border-radius`，刷新后 stylesheet 失效也不丢几何。

### 4.5 `RichEditor/styles.css` 图片选择器与新规则（`apps/remote-plugins/src/components/design/RichEditor/styles.css`）

**对比范围**：`img` / `.rich-editor-image` 几何规则块，及紧随其后的 `:hover`、`[data-resize-container]` 规则。

**改动前** · `apps/remote-plugins/src/components/design/RichEditor/styles.css`（基线，约 L242–L249）

```css
/* 旧版：所有 img 都命中，含 ProseMirror 分隔符伪图 */
.rich-editor-body .tiptap img,
.rich-editor-body .tiptap .rich-editor-image {
	/* 最大宽度不超过容器 */
	max-width: 100%;
	/* 高度自适应 */
	height: auto;
	/* 圆角 */
	border-radius: 0.5rem;
	/* 块级显示 */
	display: block;
	/* 上下间距（旧版仅靠 stylesheet） */
	margin: 0.75em 0;
}
```

**改动后** · `apps/remote-plugins/src/components/design/RichEditor/styles.css`（当前，约 L242–L263）

```css
/* 新版：img 排除 ProseMirror-separator 伪图 */
.rich-editor-body .tiptap img:not(.ProseMirror-separator),
.rich-editor-body .tiptap .rich-editor-image {
	/* 最大宽度不超过容器 */
	max-width: 100%;
	/* 高度自适应 */
	height: auto;
	/* 圆角 */
	border-radius: 0.5rem;
	/* 块级显示 */
	display: block;
	/* 与 img 内联 style 一致；stylesheet 失效时仍靠内联 */
	margin: 0.75em 0;
}

/* 悬停时仍锁圆角（防 WebKit 重绘后 stylesheet 丢失） */
.rich-editor-body .tiptap img:not(.ProseMirror-separator):hover,
.rich-editor-body .tiptap .rich-editor-image:hover {
	/* 悬停态强制圆角，避免重绘丢样式 */
	border-radius: 0.5rem;
}

/* 图片缩放容器：开启 imageResize 时图片被包在此容器中 */
.rich-editor-body .tiptap [data-resize-container][data-node='image'] {
	/* 容器承担上下间距 */
	margin: 0.75em 0;
}
/* 容器内 img 不再自带间距，避免内外双重 margin */
.rich-editor-body .tiptap [data-resize-container][data-node='image'] img {
	/* 清零内部 img 的 margin，间距交给容器 */
	margin: 0;
}
```

**变更摘要**：`img` 选择器加 `:not(.ProseMirror-separator)` 排除伪图；新增 `:hover` 锁圆角规则；新增 `[data-resize-container]` 容器间距与内部 `img` 清零规则，适配开启图片缩放时的 DOM 结构。

### 4.6 长文窗口预览按 `origin` 控制首图顶距（`apps/remote-plugins/src/views/learning-notes/components/PreviewBody.tsx`）

**对比范围**：`WindowedPreviewBody` 内 `windowHtml` 的 `useMemo`（前后对称省略组件其余部分）。

**改动前** · `apps/remote-plugins/src/views/learning-notes/components/PreviewBody.tsx`（基线，`windowHtml` useMemo，约 L48–L54）

```ts
	// 计算当前窗口可见片段的 HTML
	const windowHtml = useMemo(() => {
		// 按当前 origin 切出可见片段
		const { html: slice } = windowBodyHtml(boot.doc, origin);
		// 装饰片段：补懒加载（旧版不传首图选项，默认不去顶距）
		return decoratePreviewHtml(preserveEmptyParagraphs(slice));
		// 依赖：文档结构或窗口起点变化时重算
	}, [boot.doc, origin]);
```

**改动后** · `apps/remote-plugins/src/views/learning-notes/components/PreviewBody.tsx`（当前，`windowHtml` useMemo，约 L48–L54）

```ts
	// 计算当前窗口可见片段的 HTML
	const windowHtml = useMemo(() => {
		// 按当前 origin 切出可见片段
		const { html: slice } = windowBodyHtml(boot.doc, origin);
		// 仅文档窗口起点才允许「以图开头 → 首图去顶距」
		return decoratePreviewHtml(preserveEmptyParagraphs(slice), {
			// origin===0 表示文档真正的起点，此时首图才去顶距
			flushLeadingImg: origin === 0,
		});
		// 依赖：文档结构或窗口起点变化时重算
	}, [boot.doc, origin]);
```

**变更摘要**：`decoratePreviewHtml` 显式传入 `flushLeadingImg: origin === 0`，确保只有文档起点窗口的首图去顶距，滚动到中段时窗口切片首图保留正常 `margin-top`。

### 4.7 Loading 蒙层去 `bg-theme/5`（`apps/remote-plugins/src/views/learning-notes/index.tsx`）

**对比范围**：`LearningNotesApp` return JSX 中两处 Loading 蒙层 `<div>`（编辑态分支与预览态分支，前后对称省略其余 JSX）。

**改动前** · `apps/remote-plugins/src/views/learning-notes/index.tsx`（基线，编辑态 Loading 蒙层，约 L338–L342）

```tsx
							{/* 编辑器未就绪时的蒙层（旧版带半透明背景） */}
							{!editorReady ? (
								/* 绝对定位铺满，居中放 Loading */
								<div className="rounded-md bg-theme/5 absolute inset-0 z-10 flex items-center justify-center">
									{/* Loading 旋转图标 */}
									<Loading />
								</div>
							) : null}
```

**改动后** · `apps/remote-plugins/src/views/learning-notes/index.tsx`（当前，编辑态 Loading 蒙层，约 L338–L342）

```tsx
							{/* 编辑器未就绪时的蒙层（去掉 bg-theme/5） */}
							{!editorReady ? (
								/* 绝对定位铺满，居中放 Loading */
								<div className="rounded-md absolute inset-0 z-10 flex items-center justify-center">
									{/* Loading 旋转图标 */}
									<Loading />
								</div>
							) : null}
```

**变更摘要**：编辑态蒙层去掉 `bg-theme/5` 半透明背景。

**改动前** · `apps/remote-plugins/src/views/learning-notes/index.tsx`（基线，预览态 Loading 蒙层，约 L365–L369）

```tsx
							{/* 预览详情加载中的蒙层（旧版带半透明背景） */}
							{store.loadingDetail ? (
								/* 绝对定位铺满，居中放 Loading */
								<div className="w-full h-full bg-theme/5 absolute inset-0 z-10 flex items-center justify-center">
									{/* Loading 旋转图标 */}
									<Loading />
								</div>
							) : null}
```

**改动后** · `apps/remote-plugins/src/views/learning-notes/index.tsx`（当前，预览态 Loading 蒙层，约 L365–L369）

```tsx
							{/* 预览详情加载中的蒙层（去掉 bg-theme/5） */}
							{store.loadingDetail ? (
								/* 绝对定位铺满，居中放 Loading */
								<div className="w-full h-full absolute inset-0 z-10 flex items-center justify-center">
									{/* Loading 旋转图标 */}
									<Loading />
								</div>
							) : null}
```

**变更摘要**：预览态蒙层去掉 `bg-theme/5` 半透明背景，与 contain/样式收敛后的渲染层叠保持一致。

## 5. 兼容性与影响

- **行为兼容**：图片几何外观（`margin: 0.75em 0`、`border-radius: 0.5rem`）与改动前一致，仅来源由 stylesheet 改为内联 style；stylesheet 命中时仍是同样数值，二者不冲突（内联优先级更高，且 `withImgInlineStyle` 会去重）。
- **WebKit/Tauri 收益**：去掉 `contain: style` 后预览子树样式能正常进页，图片间距/圆角不再「鼠标移入才闪一下补上」；刷新后 MF `@scope` stylesheet 失效时，内联 style 仍兜底。
- **长文窗口预览**：`origin > 0` 时窗口切片首图保留正常顶距，避免中段片段首图误贴顶；`origin === 0` 时仍贴顶，与全文预览一致。
- **图片缩放**：开启 `imageResize` 时，`[data-resize-container]` 承担间距、内部 `img` 清零，避免双重 margin；未开启时 `img` 自带内联 margin，行为不变。
- **风险与回归建议**：
  - 验证普通笔记预览首图顶距是否符合预期（贴顶）。
  - 验证长文笔记滚动到中段时，窗口首图不应贴顶。
  - 验证编辑态插入图片后导出 HTML 的 `<img>` 是否带内联 `style`。
  - 验证开启图片缩放时容器与图片间距不重复。
  - 验证含 `ProseMirror-separator` 的场景下伪图不受几何规则影响。
  - 验证 Loading 蒙层在编辑/预览切换时的视觉表现。

## 6. 相关源码路径

| 说明 | 路径 |
| ---- | ---- |
| 预览容器去 contain:style | `apps/remote-plugins/src/components/design/NotePreview/index.tsx` |
| 预览 HTML 图片内联样式工具与 decoratePreviewHtml | `apps/remote-plugins/src/components/design/NotePreview/previewHtml.ts` |
| 预览样式：padding 与首块去顶距选择器 | `apps/remote-plugins/src/components/design/NotePreview/styles.css` |
| 编辑器 Image 扩展 HTMLAttributes 内联 style | `apps/remote-plugins/src/components/design/RichEditor/extensions/index.ts` |
| 编辑器图片样式选择器与 resize 容器规则 | `apps/remote-plugins/src/components/design/RichEditor/styles.css` |
| 长文窗口预览按 origin 控制首图顶距 | `apps/remote-plugins/src/views/learning-notes/components/PreviewBody.tsx` |
| Loading 蒙层去 bg-theme/5 | `apps/remote-plugins/src/views/learning-notes/index.tsx` |

---

若与仓库最新源码不一致，以源码为准。
