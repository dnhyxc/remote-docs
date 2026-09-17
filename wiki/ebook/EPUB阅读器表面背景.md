# EPUB 阅读背景：全页表面色同步

## 文档角色

**增量专题**：用户在 **阅读设置** 中选择的 **阅读背景** 不再只作用于 EPUB iframe 正文，而是经 CSS 变量 `--epub-reader-surface-bg` 同步到 **顶栏 header**、**右侧分栏**（读书想法 / MOKE 问书）、**阅读设置 Popover** 及侧栏内 muted/hover/渐变等子层，消除「正文护眼绿、壳层仍白底」的分层感。

**姊妹文档**：[EPUB阅读器设置滚动.md](./EPUB阅读器设置滚动.md)（12 档背景与翻页方式）、[EPUB想法侧面板.md](./EPUB想法侧面板.md)（右栏分栏）、[电子书Mock助手.md](./电子书Mock助手.md)（MOKE 问书）。

**延伸阅读**：[EPUB阅读器设置关闭.md](./EPUB阅读器设置关闭.md)（点击正文关闭设置面板）。

---

## 1. 背景与目标

### 1.1 问题

| 区域 | 旧行为 |
| ---- | ------ |
| EPUB iframe 正文 | `resolveEpubBgColor` 注入背景 |
| 页面壳 / 顶栏 / 右栏 | 固定 `bg-theme-background` |
| 设置 Popover | Portal 到 `body`，默认白底 |
| 侧栏子块 | `bg-theme/2`、`from-theme-background` 等基于应用主题 |

用户切换「暖黄 / 护眼绿」等背景后，**仅正文变色**，header、想法列表、MOKE 问书、设置面板仍为应用默认底色。

### 1.2 目标

- 单一来源：`epubSettings.bgTheme` → `--epub-reader-surface-bg`。
- **default** 仍跟随 `--theme-background`；其余与 iframe 内 `EPUB_BG_THEME_OPTIONS` 色值一致。
- PDF 阅读页 **不** 挂载变量，行为不变。
- Popover 经 Portal 渲染，须在 `PopoverContent` **内联** 设置变量与 `backgroundColor`。

---

## 2. 改动范围

| 路径 | 变更要点 |
| ---- | -------- |
| `apps/frontend/src/views/ebook/utils/epubReaderSettings.ts` | 新增 surface 解析、CSS 变量与 Tailwind 工具 class |
| `apps/frontend/src/views/ebook/components/EbookPageShell.tsx` | `surfaceClassName` / `surfaceStyle` |
| `apps/frontend/src/views/ebook/read.tsx` | EPUB 模式下 `epubSurfaceProps` 传入 Shell |
| `apps/frontend/src/views/ebook/components/EpubPane.tsx` | host 背景改用 `resolveEpubReaderSurfaceBackground` |
| `apps/frontend/src/views/ebook/components/EpubReaderSettingsPopover.tsx` | Popover 与翻页切换条跟随 surface |
| `apps/frontend/src/views/ebook/components/EpubThoughtParts.tsx` | 列表 hover/选中、引用渐变、输入 muted |
| `apps/frontend/src/views/ebook/components/EbookAssistant.tsx` | 空态遮罩与 intro 卡片 muted |

**未改动**：iframe 内 `applyEpubReaderAppearance` 仍用 `resolveEpubReaderBackground`；PDF 路径无 surface 挂载。

---

## 3. 实现思路

1. **CSS 变量而非逐组件传色**：子树用 `bg-[var(--epub-reader-surface-bg,...)]` 与 `color-mix(...)` 派生 muted/hover，切换背景时只改一处变量。
2. **Shell 挂变量**：`read.tsx` 在 `book.fmt === 'epub'` 时把 `getEpubReaderSurfaceCssVars(bgTheme)` 写到圆角面板根节点，顶栏与分栏自然继承。
3. **Popover 例外**：Radix Portal 脱离 Shell，在 `PopoverContent` 上同时设 `style.backgroundColor` 与 CSS 变量，保证面板与正文同色且内部 `epubReaderSurfaceMutedClass` 可用。
4. **default 语义**：`resolveEpubReaderSurfaceBackground('default')` 返回 `var(--theme-background)`，替代 EpubPane host 旧版 `transparent`（避免壳层与 iframe 之间露底不一致）。

---

## 4. 关键代码对比与注释

### 4.1 `resolveEpubReaderSurfaceBackground` 与工具 class（`epubReaderSettings.ts`）

**对比范围**：基线无 surface 模块；以下为 **纯新增**（改动后全文）。

**改动后** · `apps/frontend/src/views/ebook/utils/epubReaderSettings.ts`（当前，约 L137–L185）

```typescript
// EPUB 阅读页壳层/侧栏共用的表面背景 CSS 变量名
export const EPUB_READER_SURFACE_CSS_VAR = '--epub-reader-surface-bg';

/**
 * 页面壳、顶栏、侧栏与阅读区共用的表面背景。
 * default 跟随应用主题；其余与 iframe 内阅读背景一致。
 */
export function resolveEpubReaderSurfaceBackground(
	bgTheme: EpubReaderBgTheme,
): string {
	// 跟随应用主题时引用全局 theme token，而非透明或固定 hex
	if (bgTheme === 'default') {
		return 'var(--theme-background)';
	}
	// 其余档位与 EPUB_BG_THEME_OPTIONS 中 bgColor 一致
	return resolveEpubBgColor(bgTheme);
}

/** 挂到阅读页壳层根节点，供子树 Tailwind 任意值引用 */
export function getEpubReaderSurfaceCssVars(
	bgTheme: EpubReaderBgTheme,
): Record<string, string> {
	return {
		[EPUB_READER_SURFACE_CSS_VAR]:
			resolveEpubReaderSurfaceBackground(bgTheme),
	};
}

/** 阅读页统一表面背景（需配合 getEpubReaderSurfaceCssVars） */
export const epubReaderSurfaceBgClass =
	'bg-[var(--epub-reader-surface-bg,var(--color-theme-background))]';

/** 略深于表面的 muted 层（替代 bg-theme/2） */
export const epubReaderSurfaceMutedClass =
	'bg-[color-mix(in_oklch,var(--epub-reader-surface-bg,var(--color-theme-background))_92%,var(--color-theme)_8%)]';

/** 列表选中态（替代 bg-theme/12） */
export const epubReaderSurfaceSelectedClass =
	'bg-[color-mix(in_oklch,var(--epub-reader-surface-bg,var(--color-theme-background))_88%,var(--color-theme)_12%)]';

/** 列表 hover（替代 hover:bg-theme/10） */
export const epubReaderSurfaceHoverClass =
	'hover:bg-[color-mix(in_oklch,var(--epub-reader-surface-bg,var(--color-theme-background))_90%,var(--color-theme)_10%)]';

/** 引用折叠渐变起点（替代 from-theme-background） */
export const epubReaderSurfaceFadeFromClass =
	'from-[var(--epub-reader-surface-bg,var(--color-theme-background))]';

/** 加载遮罩（替代 bg-theme-background/80） */
export const epubReaderSurfaceOverlayClass =
	'bg-[color-mix(in_oklch,var(--epub-reader-surface-bg,var(--color-theme-background))_80%,transparent)]';
```

**变更摘要**：新增 surface 解析与一组 Tailwind 任意值 class，供 Shell、侧栏、设置 Popover 共用。

---

### 4.2 `EbookPageShell` 表面 props

**对比范围**：`EbookPageShell` 组件 props 与圆角面板根节点。

**改动前** · `apps/frontend/src/views/ebook/components/EbookPageShell.tsx`（基线）

```typescript
export type EbookPageShellProps = {
	header?: ReactNode;
	footer?: ReactNode;
	children: ReactNode;
	contentClassName?: string;
	contentPadding?: boolean;
};

export function EbookPageShell({
	header,
	footer,
	children,
	contentClassName,
	contentPadding = true,
}: EbookPageShellProps) {
	return (
		<div className="flex min-h-0 h-full w-full flex-col">
			<div className="box-border flex h-full min-h-0 w-full min-w-0 flex-col p-5.5 pt-0">
				<div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-md bg-theme-background">
					{header}
					{/* ... content / footer ... */}
				</div>
			</div>
		</div>
	);
}
```

**改动后** · `apps/frontend/src/views/ebook/components/EbookPageShell.tsx`（当前，约 L1–L40）

```typescript
import type { CSSProperties, ReactNode } from 'react';

export type EbookPageShellProps = {
	header?: ReactNode;
	footer?: ReactNode;
	children: ReactNode;
	contentClassName?: string;
	contentPadding?: boolean;
	/** 面板根节点背景 class（默认 bg-theme-background） */
	surfaceClassName?: string;
	/** 面板根节点 inline 样式（如 EPUB 阅读背景 CSS 变量） */
	surfaceStyle?: CSSProperties;
};

export function EbookPageShell({
	header,
	footer,
	children,
	contentClassName,
	contentPadding = true,
	surfaceClassName,
	surfaceStyle,
}: EbookPageShellProps) {
	return (
		<div className="flex min-h-0 h-full w-full flex-col">
			<div className="box-border flex h-full min-h-0 w-full min-w-0 flex-col p-5.5 pt-0">
				<div
					className={cn(
						'flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-md bg-theme-background',
						surfaceClassName,
					)}
					style={surfaceStyle}
				>
					{header}
					{/* ... content / footer 未改动 ... */}
				</div>
			</div>
		</div>
	);
}
```

**变更摘要**：圆角面板根节点可叠加 surface class 与 inline CSS 变量；默认仍为 `bg-theme-background`（PDF / 书架页不传 props）。

---

### 4.3 `read.tsx` 挂载 `epubSurfaceProps`

**对比范围**：`epubSurfaceProps` useMemo 与 `EbookPageShell` 传参（**纯新增**逻辑 + 两处 props）。

**改动前** · `apps/frontend/src/views/ebook/read.tsx`（基线，摘录）

```typescript
// 无 epubSurfaceProps；EbookPageShell 仅 contentPadding={false}
<EbookPageShell
	contentPadding={false}
	header={/* ... */}
>
```

**改动后** · `apps/frontend/src/views/ebook/read.tsx`（当前，约 L1423–L1700）

```typescript
const epubSurfaceProps = useMemo(() => {
	// 仅 EPUB 阅读页注入 surface；PDF 与其它页面保持默认壳层
	if (book?.fmt !== 'epub') return undefined;
	return {
		// Tailwind 背景 class，引用 --epub-reader-surface-bg
		surfaceClassName: epubReaderSurfaceBgClass,
		// 在壳层根节点写入 CSS 变量，供子树 color-mix 工具 class 使用
		surfaceStyle: getEpubReaderSurfaceCssVars(epubSettings.bgTheme),
	};
}, [book?.fmt, epubSettings.bgTheme]);

// ... 须在 early return 之前声明 hook，避免条件调用 ...

<EbookPageShell
	contentPadding={false}
	surfaceClassName={epubSurfaceProps?.surfaceClassName}
	surfaceStyle={epubSurfaceProps?.surfaceStyle}
	header={/* ... */}
>
```

**变更摘要**：`bgTheme` 变化时 Shell 与侧栏同步换色；依赖 `epubSettings.bgTheme` 与书籍格式。

---

### 4.4 `EpubReaderSettingsPopover` 面板背景

**对比范围**：`PopoverContent` 的 `className` 与 `style`。

**改动前** · `apps/frontend/src/views/ebook/components/EpubReaderSettingsPopover.tsx`（基线）

```typescript
<PopoverContent
	align="end"
	side="bottom"
	sideOffset={8}
	className="w-80 overflow-hidden p-0"
>
```

**改动后** · `apps/frontend/src/views/ebook/components/EpubReaderSettingsPopover.tsx`（当前，约 L212–L224）

```typescript
<PopoverContent
	align="end"
	side="bottom"
	sideOffset={8}
	className={cn(
		'w-80 overflow-hidden p-0 border-theme/10',
		epubReaderSurfaceBgClass,
	)}
	style={{
		...getEpubReaderSurfaceCssVars(settings.bgTheme),
		// 内联 backgroundColor 覆盖 Popover 基类 bg-theme-background，Portal 内立即生效
		backgroundColor: resolveEpubReaderSurfaceBackground(settings.bgTheme),
	}}
>
```

**变更摘要**：设置面板背景随当前选中档位实时变化；`PageFlowToggle` 外层/选中项改用 `epubReaderSurfaceMutedClass` / `epubReaderSurfaceBgClass`，避免暖黄底上出现白块。

---

## 5. 兼容性与影响

| 场景 | 行为 |
| ---- | ---- |
| EPUB + default 背景 | 与改前一致，跟随应用主题 |
| EPUB + 自定义背景 | 壳层、顶栏、右栏、设置 Popover 与正文同色 |
| PDF 阅读 | 不传 surface props，无回归 |
| 夜间 `night` 背景 | 壳层与 iframe 同为 `#121212`，侧栏 muted 基于该色 mix |

**回归建议**：切换多种阅读背景（暖黄、sepia、night）；打开想法列表 / MOKE 问书 / 设置 Popover，确认无白边分层；PDF 阅读页壳层仍为默认主题色。

---

## 6. 相关源码路径

| 说明 | 路径 |
| ---- | ---- |
| Surface 变量与 class | `apps/frontend/src/views/ebook/utils/epubReaderSettings.ts` |
| 页面壳 | `apps/frontend/src/views/ebook/components/EbookPageShell.tsx` |
| 阅读页挂载 | `apps/frontend/src/views/ebook/read.tsx` |
| iframe host 背景 | `apps/frontend/src/views/ebook/components/EpubPane.tsx` |
| 设置 Popover | `apps/frontend/src/views/ebook/components/EpubReaderSettingsPopover.tsx` |
| 想法侧栏子层 | `apps/frontend/src/views/ebook/components/EpubThoughtParts.tsx` |
| MOKE 侧栏子层 | `apps/frontend/src/views/ebook/components/EbookAssistant.tsx` |

---

（若与仓库最新源码不一致，以源码为准）
