# EPUB 书摘分享弹窗阅读 chrome 与固定预览配色

## 文档角色

**增量专题**：在 [EPUB引用分享.md](./EPUB引用分享.md) 已实现 Canvas 日历卡与复制/下载的基础上，本轮让 **分享书摘 Model 弹窗外壳**（标题、按钮、边框）跟随 [EPUB阅读器Chrome对比度.md](./EPUB阅读器Chrome对比度.md) 的阅读 chrome；**生成 PNG 与预览区底色** 保持微信读书风固定 `#F7F7F7`，不随阅读主题变化。

**姊妹文档**：[EPUB引用分享.md](./EPUB引用分享.md)、[EPUB阅读器Chrome对比度.md](./EPUB阅读器Chrome对比度.md)、[EPUB选区PopBar Chrome.md](./EPUB选区PopBar Chrome.md)。

---

## 1. 背景与目标

### 1.1 问题

| 现象 | 根因 |
| ---- | ---- |
| 分享弹窗在粉/米阅读背景下标题/按钮不可读 | `Model` → `DialogContent` 仍 `bg-theme-background`，Portal 未挂 chrome 变量 |
| 预览区与生成图配色曾尝试跟随阅读主题 | 分享图作为对外素材需固定品牌浅灰卡；预览区若随主题会与 PNG 不一致 |

### 1.2 目标

- `Model` 支持 `contentStyle` / `contentClassName`，分享弹窗挂载 `getEpubReaderChromeCssVars`。
- 弹窗按钮使用 `epubReaderChromePrimaryButtonClass`。
- 预览容器与 ScrollArea 视口固定 `EPUB_QUOTE_SHARE_CARD_BG`（`#F7F7F7`），与 Canvas `CARD_PALETTE` 一致。
- Canvas 文字/背景均使用 `CARD_PALETTE` 常量，不读取阅读字色。

---

## 2. 改动范围

| 路径 | 变更要点 |
| ---- | -------- |
| `apps/frontend/src/components/design/Model/index.tsx` | `contentStyle`、`contentClassName` |
| `apps/frontend/src/views/ebook/components/share/EpubQuoteShareDialog.tsx` | chrome 弹壳 + 固定预览区 |
| `apps/frontend/src/views/ebook/utils/epub/reader/epubQuoteShareCard.ts` | `CARD_PALETTE`、`EPUB_QUOTE_SHARE_CARD_BG` 导出 |
| `apps/frontend/src/views/ebook/read.tsx` | 传入 `chromeStyle` |

---

## 3. 实现思路

1. **弹窗外壳跟 chrome**：`contentStyle={epubSurfaceProps?.chromeStyle}` + `epubReaderSurfaceBgClass` / `text-textcolor`。
2. **预览区与 PNG 分离**：UI 壳层随阅读主题；预览盒与 Canvas 共用 `EPUB_QUOTE_SHARE_CARD_BG`，避免图片下方滚动空白出现色差。
3. **Model 通用扩展**：与 `Drawer.contentStyle` 同模式，供其它 Portal 弹窗复用。

---

## 4. 关键代码对比与注释

### 4.1 `Model` 的 `contentStyle`（`apps/frontend/src/components/design/Model/index.tsx`）

**对比范围**：`IProps` 新增字段与 `DialogContent` 绑定。

**改动前** · `apps/frontend/src/components/design/Model/index.tsx`（基线 HEAD，约 L33–L65）

```typescript
// Model 组件 props 接口
interface IProps {
	// 受控 open
	open: boolean;
	// open 变化回调
	onOpenChange: (open: boolean) => void;
	// 标题文案
	title?: string;
	// 子节点（正文区）
	children: React.ReactNode;
	// 弹窗最大宽度
	width?: string;
	// 弹窗高度
	height?: string;
	// 自定义 header 节点
	header?: React.ReactNode;
	// 自定义 footer 节点
	footer?: React.ReactNode;
	// 描述文案
	description?: string;
	// 触发器（可选）
	trigger?: React.ReactNode;
	// 确定按钮回调
	onSubmit?: () => void;
	// 关闭回调（legacy）
	close?: () => void;
	// 是否展示默认 footer
	showFooter?: boolean;
	// 是否展示取消按钮
	showClose?: boolean;
	// 是否展示右上角关闭图标
	showCloseIcon?: boolean;
}

// ... Model 组件实现中 DialogContent 仅 style={{ maxWidth, height }}
```

**改动后** · `apps/frontend/src/components/design/Model/index.tsx`（当前，约 L33–L70）

```typescript
// Model 组件 props 接口
interface IProps {
	// 受控 open
	open: boolean;
	// open 变化回调
	onOpenChange: (open: boolean) => void;
	// 标题文案
	title?: string;
	// 子节点（正文区）
	children: React.ReactNode;
	// 弹窗最大宽度
	width?: string;
	// 弹窗高度
	height?: string;
	// 自定义 header 节点
	header?: React.ReactNode;
	// 自定义 footer 节点
	footer?: React.ReactNode;
	// 描述文案
	description?: string;
	// 触发器（可选）
	trigger?: React.ReactNode;
	// 确定按钮回调
	onSubmit?: () => void;
	// 关闭回调（legacy）
	close?: () => void;
	// 是否展示默认 footer
	showFooter?: boolean;
	// 是否展示取消按钮
	showClose?: boolean;
	// 是否展示右上角关闭图标
	showCloseIcon?: boolean;
	// DialogContent inline 样式（如 EPUB 阅读 chrome CSS 变量）
	contentStyle?: React.CSSProperties;
	// DialogContent 额外 className（如 surface 背景与边框）
	contentClassName?: string;
}

// DialogContent 渲染处（节选）
			<DialogContent
				// 右上角关闭钮
				showCloseButton={showCloseIcon}
				// 遮罩 class
				overlayClassName={MODEL_OVERLAY_CLASS}
				// 传入 chrome className
				className={contentClassName}
				// 合并 width/height 与 chrome inline 变量
				style={{ maxWidth: width, height, ...contentStyle }}
			>
```

**变更摘要**：Model 允许 Portal 弹层挂载阅读 chrome，与 Drawer 的 `contentStyle` 对齐。

---

### 4.2 `EpubQuoteShareDialog` 渲染（`apps/frontend/src/views/ebook/components/share/EpubQuoteShareDialog.tsx`）

**对比范围**：`return` 中 `Model` 与预览区 JSX（约 L171–L252）。

**改动前** · `apps/frontend/src/views/ebook/components/share/EpubQuoteShareDialog.tsx`（基线 HEAD，约 L157–L216）

```typescript
	// 组件 render 返回分享 Model
	return (
		<Model
			// 受控 open
			open={open}
			// 关闭回调
			onOpenChange={onOpenChange}
			// 弹窗标题 i18n
			title={t('ebook.read.quoteShare.title')}
			// 副标题 hint
			description={t('ebook.read.quoteShare.hint')}
			// 固定宽度 400px
			width="400px"
			// 不使用 Model 默认 footer
			showFooter={false}
			// footer 显式 null
			footer={null}
		>
			<div
				// 预览区：theme 边框 + 固定 #F7F7F7（仅预览盒，弹壳仍应用主题）
				className={`flex min-h-0 flex-col overflow-hidden rounded-md border border-theme/10 bg-[#F7F7F7] ${PREVIEW_BOX_CLASS}`}
			>
				<ScrollArea
					// 横向 bleed 与圆角继承
					className="min-h-0 flex-1 -mx-4.5 min-w-0 w-[calc(100%+2.25rem)] rounded-[inherit]"
					// 视口无固定背景
					viewportClassName="min-w-0 max-w-full rounded-[inherit] [&>div]:!block [&>div]:!min-h-0"
				>
					<div className="px-4.5">
						{loading ? (
							<div
								// 加载文案用 text-textcolor/50（随 body，弹壳未 chrome 时可能不可读）
								className={`flex w-full min-h-[min(calc(75vh-10rem),600px)] items-center justify-center text-sm text-textcolor/50`}
							>
								{t('ebook.read.quoteShare.generating')}
							</div>
						) : previewUrl ? (
							<div className="overflow-hidden rounded-md">
								<img
									src={previewUrl}
									alt={t('ebook.read.quoteShare.previewAlt')}
									className="block w-full"
								/>
							</div>
						) : null}
					</div>
				</ScrollArea>
			</div>

			<div className="grid shrink-0 grid-cols-2 gap-4 pt-0.5">
				<Button
					type="button"
					// 默认 Button 样式
					className="min-w-0 w-full cursor-pointer"
					disabled={loading || copying || downloading || !canvas}
					onClick={onCopyImage}
				>
					{/* copied 态图标与文案 */}
					{copied ? (
						<span
							className="inline-flex size-4 shrink-0 items-center justify-center"
							aria-hidden
						>
							<CheckCircle className="size-4" />
						</span>
					) : null}
					{copied
						? t('ebook.read.quoteShare.copied')
						: t('ebook.read.quoteShare.copyImage')}
				</Button>
				<Button
					type="button"
					className="min-w-0 w-full cursor-pointer"
					disabled={loading || copying || downloading || !canvas}
					onClick={onDownloadImage}
				>
					{t('common.download')}
				</Button>
			</div>
		</Model>
	);
```

**改动后** · `apps/frontend/src/views/ebook/components/share/EpubQuoteShareDialog.tsx`（当前，约 L171–L252）

```typescript
	// 组件 render 返回分享 Model
	return (
		<Model
			// 受控 open
			open={open}
			// 关闭回调
			onOpenChange={onOpenChange}
			// 弹窗标题 i18n
			title={t('ebook.read.quoteShare.title')}
			// 副标题 hint
			description={t('ebook.read.quoteShare.hint')}
			// 固定宽度 400px
			width="400px"
			// 不使用 Model 默认 footer
			showFooter={false}
			// footer 显式 null
			footer={null}
			// Portal 挂载阅读 chrome CSS 变量
			contentStyle={chromeStyle}
			// 弹壳 surface 背景、边框与字色
			contentClassName={cn(
				epubReaderSurfaceBgClass,
				epubReaderChromeBorderColorClass,
				'text-textcolor',
			)}
		>
			<div
				className={cn(
					// 预览外框：中性黑边 8% 透明
					'flex min-h-0 flex-col overflow-hidden rounded-md border border-black/8',
					PREVIEW_BOX_CLASS,
				)}
				style={
					{
						// 预览盒背景与 PNG 一致
						backgroundColor: EPUB_QUOTE_SHARE_CARD_BG,
						// CSS 变量供 ScrollArea 视口继承
						'--epub-quote-share-preview-bg': EPUB_QUOTE_SHARE_CARD_BG,
					} as CSSProperties
				}
			>
				<ScrollArea
					className="min-h-0 flex-1 -mx-4.5 min-w-0 w-[calc(100%+2.25rem)] rounded-[inherit]"
					// 视口背景与卡片同色，图片下方空白无色差
					viewportClassName="min-w-0 max-w-full rounded-[inherit] bg-[var(--epub-quote-share-preview-bg)] [&>div]:!block [&>div]:!min-h-0"
				>
					<div className="px-4.5">
						{loading ? (
							<div
								// 加载文案用卡片次要色 #999
								className={`flex w-full min-h-[min(calc(75vh-10rem),600px)] items-center justify-center text-sm text-[#999999]`}
							>
								{t('ebook.read.quoteShare.generating')}
							</div>
						) : previewUrl ? (
							<div className="overflow-hidden rounded-md">
								<img
									src={previewUrl}
									alt={t('ebook.read.quoteShare.previewAlt')}
									className="block w-full"
								/>
							</div>
						) : null}
					</div>
				</ScrollArea>
			</div>

			<div className="grid shrink-0 grid-cols-2 gap-4 pt-0.5">
				<Button
					type="button"
					className={cn(
						'min-w-0 w-full cursor-pointer',
						// 阅读 chrome 主按钮（字/底反转）
						epubReaderChromePrimaryButtonClass,
					)}
					disabled={loading || copying || downloading || !canvas}
					onClick={onCopyImage}
				>
					{copied ? (
						<span
							className="inline-flex size-4 shrink-0 items-center justify-center"
							aria-hidden
						>
							<CheckCircle className="size-4" />
						</span>
					) : null}
					{copied
						? t('ebook.read.quoteShare.copied')
						: t('ebook.read.quoteShare.copyImage')}
				</Button>
				<Button
					type="button"
					className={cn(
						'min-w-0 w-full cursor-pointer',
						epubReaderChromePrimaryButtonClass,
					)}
					disabled={loading || copying || downloading || !canvas}
					onClick={onDownloadImage}
				>
					{t('common.download')}
				</Button>
			</div>
		</Model>
	);
```

**变更摘要**：弹壳跟阅读 chrome；预览区与 PNG 固定浅灰；按钮改用 chrome 主按钮 class。

---

### 4.3 `EPUB_QUOTE_SHARE_CARD_BG`（`apps/frontend/src/views/ebook/utils/epub/reader/epubQuoteShareCard.ts`）

**对比范围**：顶部配色常量由分散变量改为 `CARD_PALETTE` 对象并导出预览背景。

**改动前** · `apps/frontend/src/views/ebook/utils/epub/reader/epubQuoteShareCard.ts`（基线 HEAD，约 L16–L21）

```typescript
// 参考微信读书书摘卡配色（分散常量）
const BG = '#F7F7F7';
// 主文字色
const TEXT_PRIMARY = '#332C2B';
// 次要文字（星期等）
const TEXT_SECONDARY = '#999999';
// 品牌行
const TEXT_BRAND = '#888888';
// 分隔线
const DIVIDER = '#E0E0E0';
```

**改动后** · `apps/frontend/src/views/ebook/utils/epub/reader/epubQuoteShareCard.ts`（当前，约 L16–L26）

```typescript
// 分享卡固定配色（微信读书风，不随阅读主题变化）
const CARD_PALETTE = {
	// 卡片背景
	bg: '#F7F7F7',
	// 日期与书摘主色
	textPrimary: '#332C2B',
	// 星期、作者等次要色
	textSecondary: '#999999',
	// 底部品牌色
	textBrand: '#888888',
	// 日期区分隔线
	divider: '#E0E0E0',
} as const;

// 分享卡与弹窗预览区共用的固定背景色（对外导出供 Dialog 预览盒引用）
export const EPUB_QUOTE_SHARE_CARD_BG = CARD_PALETTE.bg;
```

**变更摘要**：集中为 `CARD_PALETTE` 并导出 `EPUB_QUOTE_SHARE_CARD_BG`，Canvas 与预览 UI 共用同一色值源。

---

## 5. 兼容性与影响

- **复制/下载 PNG**：配色与改版前一致（固定浅灰卡），对外分享素材不变。
- **PopBar 共存**：仍可通过 `PRESERVE_SELECTION_ACTIONS` 保持选区条；chrome 仅影响弹窗 Portal。
- **回归建议**：粉/米背景下打开分享 → 标题/按钮可读；预览图下方滚动区仍为 `#F7F7F7`；复制图片到微信外观与以前一致。

---

## 6. 相关源码路径

| 说明 | 路径 |
| ---- | ---- |
| Model Portal 扩展 | `apps/frontend/src/components/design/Model/index.tsx` |
| 分享弹窗 | `apps/frontend/src/views/ebook/components/share/EpubQuoteShareDialog.tsx` |
| Canvas 配色 | `apps/frontend/src/views/ebook/utils/epub/reader/epubQuoteShareCard.ts` |
| chrome 注入 | `apps/frontend/src/views/ebook/read.tsx` |

---

（若与仓库最新源码不一致，以源码为准）
