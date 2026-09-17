# EPUB 阅读 chrome 字色与对比度

## 文档角色

**增量专题**：在 [EPUB阅读器表面背景.md](./EPUB阅读器表面背景.md) 已同步 **阅读背景** 到壳层/侧栏的基础上，本轮将 **阅读设置中的文字颜色** 与 **基于正文字色的边框/按钮/Portal 菜单** 贯通到顶栏、想法侧栏、MOKE 问书输入框、听书 **分句/倍速** 下拉、设置 Popover、目录 Drawer 等 **阅读 chrome**，修复自定义阅读背景（如粉色/米色）下 **按钮文字、分隔线、textarea、Portal 黑底** 几乎不可见的问题。

**姊妹文档**：[EPUB阅读器表面背景.md](./EPUB阅读器表面背景.md)、[EPUB想法侧面板.md](./EPUB想法侧面板.md)、[EPUB听书播放器栏.md](./EPUB听书播放器栏.md)、[电子书Mock助手.md](./电子书Mock助手.md)。

**延伸阅读**：[EPUB阅读页导航关闭.md](./EPUB阅读页导航关闭.md)（分页翻页入口、点击正文关浮层、目录文案）、[EPUB选区PopBar Chrome.md](./EPUB选区PopBar Chrome.md)（选区 PopBar）、[EPUB引用分享对话框Chrome.md](./EPUB引用分享对话框Chrome.md)（书摘分享弹窗）、[EPUB Chrome列表激活主题.md](./EPUB Chrome列表激活主题.md)（**2026-07-15**：分句/目录选中态勿用 `text-theme`，改跟阅读字色）。

---

## 1. 背景与目标

### 1.1 问题

| 现象 | 根因 |
| ---- | ---- |
| 想法侧栏「取消/保存」字色发灰、几乎看不见 | `@ui/button` 的 `outline` 用 `text-theme`、`default` 用 `bg-theme text-default`，与 **阅读表面** 同色或对比不足 |
| 侧栏/面板 `border-theme/10` 看不见 | `border-theme` 取自 **应用主题色**，在粉/米阅读背景上透明度极低 |
| MOKE 问书 textarea 字色不随阅读设置变 | `body` 的 `color` 在子树 **继承为固定计算值**；`ui/Textarea` 未挂 `text-textcolor` |
| 听书分句/倍速 Pop **黑底 + 深字** | Portal 上 `DropdownMenuContent` 仍 `bg-theme-background`（应用深色），仅注入 CSS 变量未设 `backgroundColor` |

### 1.2 目标

- 单一入口：`getEpubReaderChromeCssVars(bgTheme, textColor, appTheme)` 输出表面变量、字色变量、`color` 与 `backgroundColor`。
- Tailwind 工具类统一替换 `border-theme/*`、主题色按钮、Portal 菜单容器与列表项选中态。
- PDF 阅读页 **不** 挂载 chrome 变量，行为不变。

---

## 2. 改动范围

| 路径 | 变更要点 |
| ---- | -------- |
| `apps/frontend/src/views/ebook/utils/epub/reader/epubReaderSettings.ts` | `getEpubReaderChromeCssVars`、chrome 边框/按钮/textarea/菜单/列表项 class |
| `apps/frontend/src/views/ebook/read.tsx` | `epubSurfaceProps` 改用 chrome 变量；向听书条/目录传 `chromeStyle` |
| `apps/frontend/src/components/design/Drawer/index.tsx` | `contentStyle` 供目录 Portal |
| `apps/frontend/src/views/ebook/components/layout/EbookTocDrawer.tsx` | 接收 `chromeStyle` |
| `apps/frontend/src/views/ebook/components/layout/EbookPanelHeader.tsx` | 顶栏分隔线 |
| `apps/frontend/src/views/ebook/components/layout/EbookReadSplitLayout.tsx` | 分栏竖线 |
| `apps/frontend/src/views/ebook/components/reader/EpubReaderSettingsPopover.tsx` | Popover 边框与 chrome 变量 |
| `apps/frontend/src/views/ebook/components/reader/EbookAssistant.tsx` | textarea 字色与输入框边框 |
| `apps/frontend/src/views/ebook/components/listen/EpubListenPlayerBar.tsx` | 分句/倍速菜单背景与列表项 |
| `apps/frontend/src/views/ebook/components/thought/*` | 想法面板边框与底部按钮 |
| `apps/frontend/src/views/ebook/components/selection/EpubHighlightStyleBar.tsx` | PopBar 顶栏分隔线 |
| `apps/frontend/src/views/ebook/components/selection/EpubQuoteActionBar.tsx` | inline 引用条边框 |

---

## 3. 实现思路

1. **字色变量 + 显式 `color`**：`--color-textcolor` / `--theme-textcolor` 设为 `resolveEpubTextColor`；根节点再设 `color: resolvedText`，解决 textarea 等 **未挂 utility** 节点的继承问题。
2. **Portal 背景**：同对象设 `backgroundColor: resolveEpubReaderSurfaceBackground(bgTheme)`，避免 Dropdown/Drawer 仍用应用 `bg-theme-background`。
3. **边框与按钮改跟正文字色**：`border-textcolor/18`、`epubReaderChromeOutlineButtonClass`（描边按钮）、`epubReaderChromePrimaryButtonClass`（字/底反转主按钮）。
4. **听书菜单**：`epubReaderChromeMenuContentClass` 覆盖 `DropdownMenuContent` 默认背景；列表项用 `epubReaderChromeListItemIdleClass` / `ActiveClass` 替代 `bg-theme/15 text-theme`。
5. **挂载点**：`EbookPageShell` 的 `surfaceStyle`；Popover/Drawer/Dropdown 的 `style={chromeStyle}`。

---

## 4. 关键代码对比与注释

### 4.1 `getEpubReaderChromeCssVars`（`apps/frontend/src/views/ebook/utils/epub/reader/epubReaderSettings.ts`）

**对比范围**：纯新增函数及相邻 chrome 工具常量（基线无此符号）。

**改动后** · `apps/frontend/src/views/ebook/utils/epub/reader/epubReaderSettings.ts`（当前，约 L169–L264）

```typescript
// 阅读页 chrome 注入到 DOM 的正文字色 CSS 变量名（供调试与任意值引用）
export const EPUB_READER_TEXT_CSS_VAR = '--epub-reader-text-color';

// 阅读页 chrome：表面背景 + 正文字色（覆盖 --color-textcolor 供 text-textcolor/* 使用）
export function getEpubReaderChromeCssVars(
	// 用户选择的阅读背景主题 id（如 pink、cream、default）
	bgTheme: EpubReaderBgTheme,
	// 用户选择的阅读文字颜色 id（如 auto、sepia、brown）
	textColor: EpubReaderTextColor,
	// 当前应用配色主题名（如 black、teal），用于 auto 字色解析
	appTheme: ThemeName,
): Record<string, string> {
	// 将设置项解析为实际 hex/rgb 字色字符串
	const resolvedText = resolveEpubTextColor(textColor, appTheme);
	// 返回可挂到 style 上的键值对（壳层根节点或 Portal 内容区）
	return {
		// 展开表面背景变量 --epub-reader-surface-bg
		...getEpubReaderSurfaceCssVars(bgTheme),
		// 自定义变量：阅读 chrome 正文字色
		[EPUB_READER_TEXT_CSS_VAR]: resolvedText,
		// Tailwind text-textcolor 使用的 CSS 变量
		'--color-textcolor': resolvedText,
		// 部分 legacy 样式仍读 --theme-textcolor
		'--theme-textcolor': resolvedText,
		// body 上 text-textcolor 的子树继承的是 body 处算出的色值；根节点显式 color 才能让 textarea 跟随阅读字色
		color: resolvedText,
		// Portal 不在阅读壳子 DOM 内，须 inline 背景，避免 Dropdown 仍用 bg-theme-background（应用主题黑底）
		backgroundColor: resolveEpubReaderSurfaceBackground(bgTheme),
	};
}

// 阅读页 chrome 分隔线：基于正文字色透明度，替代 border-theme/10
export const epubReaderChromeBorderColorClass = 'border-textcolor/18';

// 次要按钮（取消、删除）：描边 + 透明底 + 正文字色
export const epubReaderChromeOutlineButtonClass =
	'border-textcolor/28 text-textcolor bg-transparent shadow-none hover:bg-textcolor/10';

// 主按钮（保存、编辑）：字色作底、表面色作字，保证与阅读背景对比
export const epubReaderChromePrimaryButtonClass =
	'bg-textcolor text-[var(--epub-reader-surface-bg,var(--color-theme-background))] hover:bg-textcolor/90 border-transparent';

// textarea：覆盖 ui/Textarea 默认 placeholder:text-muted-foreground
export const epubReaderChromeTextareaClass =
	'text-textcolor placeholder:text-textcolor/40 caret-textcolor';

// Portal 下拉容器：表面背景 class + 正文字色边框 + 显式 text-textcolor
export const epubReaderChromeMenuContentClass = cn(
	epubReaderSurfaceBgClass,
	epubReaderChromeBorderColorClass,
	'border text-textcolor',
);

// 列表项默认态：hover/focus 用正文字色浅底
export const epubReaderChromeListItemIdleClass =
	'text-textcolor hover:bg-textcolor/10 focus:bg-textcolor/10 focus:text-textcolor';

// 列表项选中态：正文字色 12% 透明底 + 加粗
export const epubReaderChromeListItemActiveClass =
	'bg-textcolor/12 text-textcolor font-medium hover:bg-textcolor/12 focus:bg-textcolor/12 focus:text-textcolor';
```

**变更摘要**：新增 chrome 变量聚合函数与一组 Tailwind 工具 class；Portal 场景同时写入 `color` 与 `backgroundColor`。

---

### 4.2 `epubSurfaceProps`（`apps/frontend/src/views/ebook/read.tsx`）

**对比范围**：`useMemo` 计算 EPUB 壳层 props 的完整回调。

**改动前** · `apps/frontend/src/views/ebook/read.tsx`（基线，约 L1856–L1865）

```typescript
// 仅 EPUB 时向 EbookPageShell 提供表面样式 props
const epubSurfaceProps = useMemo(() => {
	// 非 EPUB（如 PDF）不挂载阅读背景变量
	if (book?.fmt !== 'epub') return undefined;
	// 返回壳层 class 与仅含 --epub-reader-surface-bg 的 style
	return {
		surfaceClassName: epubReaderSurfaceBgClass,
		surfaceStyle: getEpubReaderSurfaceCssVars(epubSettings.bgTheme),
	};
	// 依赖：书籍格式与阅读背景主题
}, [book?.fmt, epubSettings.bgTheme]);
```

**改动后** · `apps/frontend/src/views/ebook/read.tsx`（当前，约 L1885–L1897）

```typescript
// 仅 EPUB 时向 EbookPageShell 与 Portal 子组件提供 chrome 样式 props
const epubSurfaceProps = useMemo(() => {
	// 非 EPUB（如 PDF）不挂载阅读 chrome 变量
	if (book?.fmt !== 'epub') return undefined;
	// 聚合表面背景、正文字色、color 与 backgroundColor
	const chromeStyle = getEpubReaderChromeCssVars(
		epubSettings.bgTheme,
		epubSettings.textColor,
		appTheme,
	);
	// 返回壳层 class、inline style，以及供 Portal 复用的 chromeStyle
	return {
		surfaceClassName: epubReaderSurfaceBgClass,
		surfaceStyle: chromeStyle,
		chromeStyle,
	};
	// 依赖：格式、背景、文字颜色与应用主题（auto 字色需要 appTheme）
}, [book?.fmt, epubSettings.bgTheme, epubSettings.textColor, appTheme]);
```

**变更摘要**：由仅表面背景扩展为完整 chrome 变量；导出 `chromeStyle` 供听书条、目录 Drawer 等 Portal 使用。

---

### 4.3 听书分句/倍速 `DropdownMenuContent`（`apps/frontend/src/views/ebook/components/listen/EpubListenPlayerBar.tsx`）

**对比范围**：分句菜单 `DropdownMenuContent` 的 `className` 与列表项 `className`（倍速菜单结构对称，此处以分句为例）。

**改动前** · `apps/frontend/src/views/ebook/components/listen/EpubListenPlayerBar.tsx`（基线）

```typescript
// 分句下拉内容区：仅尺寸与 z-index，背景沿用 ui 默认 bg-theme-background
<DropdownMenuContent
	side="top"
	align="end"
	className="z-50 w-72 overflow-hidden p-1 pb-4"
	style={menuChromeStyle}
>
// ...（标签与 ScrollArea 未改动）...
	<DropdownMenuItem
		className={cn(
			'min-w-0 scroll-my-1 items-start gap-2 rounded-md px-2 py-2 text-xs leading-snug transition-colors',
			selected
				? TOC_LIST_ITEM_ACTIVE_CLASS
				: 'text-textcolor hover:bg-theme/10 focus:bg-theme/10',
		)}
	>
```

**改动后** · `apps/frontend/src/views/ebook/components/listen/EpubListenPlayerBar.tsx`（当前，约 L304–L338）

```typescript
// 分句下拉内容区：覆盖 Portal 默认背景，并应用阅读 chrome 边框与字色
<DropdownMenuContent
	side="top"
	align="end"
	className={cn(
		'z-50 w-72 overflow-hidden p-1 pb-4',
		epubReaderChromeMenuContentClass,
	)}
	style={menuChromeStyle}
>
// ...（标签与 ScrollArea 未改动）...
	<DropdownMenuItem
		className={cn(
			'min-w-0 scroll-my-1 items-start gap-2 rounded-md px-2 py-2 text-xs leading-snug transition-colors',
			selected
				? epubReaderChromeListItemActiveClass
				: epubReaderChromeListItemIdleClass,
		)}
	>
```

**变更摘要**：菜单容器增加 `epubReaderChromeMenuContentClass`；列表项选中/默认态改为基于 `textcolor` 的工具 class；配合 `menuChromeStyle` 中的 `backgroundColor` 消除黑底。

---

### 4.4 想法侧栏底部按钮（`apps/frontend/src/views/ebook/components/thought/EpubThought.tsx`）

**对比范围**：新建/编辑 footer 内「取消」「保存」按钮 className。

**改动前** · `apps/frontend/src/views/ebook/components/thought/EpubThought.tsx`（基线）

```typescript
// 取消：ui Button outline  variant，默认 text-theme / border-theme
<Button
	type="button"
	size="sm"
	variant="outline"
	disabled={saving}
	onClick={onClose}
>
// 保存：ui Button default，默认 bg-theme text-default
<Button
	type="button"
	size="sm"
	disabled={!content.trim() || saving}
	onClick={() => void onSave()}
>
```

**改动后** · `apps/frontend/src/views/ebook/components/thought/EpubThought.tsx`（当前）

```typescript
// 取消：outline variant + chrome 描边按钮 class 覆盖主题色
<Button
	type="button"
	size="sm"
	variant="outline"
	className={epubReaderChromeOutlineButtonClass}
	disabled={saving}
	onClick={onClose}
>
// 保存：default variant + chrome 主按钮 class（字/底反转）
<Button
	type="button"
	size="sm"
	className={epubReaderChromePrimaryButtonClass}
	disabled={!content.trim() || saving}
	onClick={() => void onSave()}
>
```

**变更摘要**：显式覆盖 Button 默认 theme 色，使按钮在自定义阅读背景下可读。

---

## 5. 兼容性与影响

- **PDF**：不调用 `getEpubReaderChromeCssVars`，无行为变化。
- **default 阅读背景**：`backgroundColor` 为 `var(--theme-background)`，仍跟随应用主题。
- **应用主题色 accent**（如 teal 播放图标）：未改，仍用显式 `text-teal-500` 等 class。
- **回归建议**：粉/米阅读背景 + 深/浅文字色各测一遍——想法新建/编辑/查看、MOKE 输入、听书分句与倍速 Pop、设置 Popover、目录 Drawer、顶栏与分栏分隔线。

---

## 6. 相关源码路径

| 说明 | 路径 |
| ---- | ---- |
| chrome 变量与工具 class | `apps/frontend/src/views/ebook/utils/epub/reader/epubReaderSettings.ts` |
| 阅读页挂载 | `apps/frontend/src/views/ebook/read.tsx` |
| 听书播放条菜单 | `apps/frontend/src/views/ebook/components/listen/EpubListenPlayerBar.tsx` |
| 想法侧栏 | `apps/frontend/src/views/ebook/components/thought/` |
| MOKE 问书输入 | `apps/frontend/src/views/ebook/components/reader/EbookAssistant.tsx` |
| 目录 Drawer Portal | `apps/frontend/src/components/design/Drawer/index.tsx`、`components/layout/EbookTocDrawer.tsx` |

---

若与仓库最新源码不一致，以源码为准。
