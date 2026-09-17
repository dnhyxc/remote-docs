# 独立预览环境优化

## 1. 背景与目标

`apps/remote-plugins` 提供独立预览环境（开发端口 `:9008`），用于脱离主应用宿主直接调试 MF（Module Federation）插件页面。本轮优化目标是让该预览环境与主应用（`apps/frontend`）的实际体验保持一致，并补齐插件页面依赖的 UI 组件与交互细节：

- **通知系统**：预览环境此前未挂载 `Toaster`，插件调用 `toast()` 时无任何可视反馈，需在路由入口补齐。
- **全高度布局**：预览壳的背景色与高度未包裹到根节点，导致弹层/抽屉的遮罩背景不一致；同时 `main` 的统一 `p-4` 会与各页面自身布局叠加，需把 padding 下放到页面。
- **UI 组件补齐**：`@ui/index` 聚合导出缺少 `alert-dialog`、`checkbox`、`sonner`，导致插件页引用这些组件时需绕路。
- **输入与滚动细节**：`Input` 拼写检查会干扰代码/英文输入；`ScrollArea` 的关键 hack 缺少注释，维护易踩坑。
- **主应用配套微调**：电子书阅读页想法列表抽屉的 `bodyClassName`、英语学习笔记页 padding 需与预览壳新布局对齐。
- **想法列表能力扩展**：`http` 类型补齐 `put/delete`，新增 `independent` 标识，边框/内边距与主站 EbookTocDrawer 对齐。

## 2. 改动范围

- `apps/remote-plugins/src/router/index.tsx`
- `apps/remote-plugins/src/router/routes.tsx`
- `apps/remote-plugins/src/layout/index.tsx`
- `apps/remote-plugins/src/views/home/index.tsx`
- `apps/remote-plugins/src/components/ui/index.ts`
- `apps/remote-plugins/src/components/ui/input.tsx`
- `apps/remote-plugins/src/components/ui/scroll-area.tsx`
- `apps/frontend/src/views/ebook/read.tsx`
- `apps/frontend/src/views/englishLearning/notes/index.tsx`
- `apps/remote-plugins/src/views/ebook-ideas/index.tsx`

## 3. 实现思路

1. **Toaster 挂载到路由入口**：在 `router/index.tsx` 的 `App` 根包裹一层 `bg-theme-background` 的全高容器，并渲染 `Toaster`，确保任意插件页调用 `toast()` 都能弹通知，且遮罩背景与主站一致。
2. **padding 从 layout 下放到 home**：`layout/index.tsx` 的 `main` 去掉统一 `p-4`，改由各页面自管 padding；`home/index.tsx` 补 `w-full h-full p-4`，让首页保留原视觉间距，而想法列表等全高页面不再被强行加边距。
3. **UI 组件导出补齐**：在 `components/ui/index.ts` 增加 `alert-dialog`、`checkbox`、`sonner` 的聚合导出，与主站 `@ui/index` 对齐，减少插件页 import 差异。
4. **Input 关闭拼写检查**：给 `Input` 加 `spellCheck="false"`，避免英文/代码输入被红线标记。
5. **ScrollArea 补注释**：为 `scrollbars` 字段与 Viewport 的 `flex` hack 补上中文注释，说明 Radix 内联 `display:table` 的副作用与覆盖理由。
6. **想法列表类型与样式对齐**：`HostBridgeProps.http` 补 `put/delete`；新增 `independent` 标识区分独立预览与嵌入；标题栏边框由 `border-theme-border` 改为更轻的 `border-theme/10`，`px-2` 改 `px-3.5`；`ScrollArea` 由 `pr-1.5` 改 `px-1.5` 以容纳横向 padding。
7. **路由传递 independent**：`routes.tsx` 给 `LearningNotesApp` 与 `IdeasListApp` 显式传 `independent`，并把想法列表 mock 的 `getBookTitle` 从占位文案改为空串，避免独立预览时显示误导性标题。
8. **主应用配套微调**：电子书阅读页想法列表抽屉 `bodyClassName` 由 `pt-1.5 pb-2` 调整为 `pt-2 pb-2 pl-0`，消除左侧多余 padding；英语学习笔记页 padding 由 `px-4 pb-4` 改为 `px-5.5 pb-5.5`，下架提示 `<p>` 去掉 `text-sm` 与主站正文风格统一。

## 4. 关键代码对比与注释

### 4.1 App 路由入口（`apps/remote-plugins/src/router/index.tsx`）

**对比范围**：`App` 默认导出函数全函数体。

**改动前** · `apps/remote-plugins/src/router/index.tsx`（基线，约 L1–L7）

```typescript
// 引入 react-router 的浏览器路由创建器与路由提供者组件
import { createBrowserRouter, RouterProvider } from 'react-router';
// 引入路由配置数组
import { routes } from './routes';

// 用路由配置创建浏览器路由实例
const router = createBrowserRouter(routes);

// 应用根组件：直接渲染路由提供者
export default function App() {
	// 旧版仅返回 RouterProvider，无背景容器与 Toaster，toast 调用无反馈
	return <RouterProvider router={router} />;
}
```

**改动后** · `apps/remote-plugins/src/router/index.tsx`（当前，约 L1–L15）

```typescript
// 引入 react-router 的浏览器路由创建器与路由提供者组件
import { createBrowserRouter, RouterProvider } from 'react-router';
// 引入 sonner 的 Toaster 组件，用于挂载全局 toast 通知容器
import { Toaster } from '@/components/ui/sonner';
// 引入路由配置数组
import { routes } from './routes';

// 用路由配置创建浏览器路由实例
const router = createBrowserRouter(routes);

// 应用根组件：包裹背景容器并挂载 Toaster
export default function App() {
	// 返回一个全高、铺满、带主题背景色的根容器，确保遮罩/抽屉背景与主站一致
	return (
		// 根 div：h-full w-full 撑满父级，bg-theme-background 提供主题背景
		<div className="h-full w-full bg-theme-background">
			// 渲染 Toaster 通知容器，使插件页 toast() 调用可见
			<Toaster />
			// 渲染路由提供者，匹配并挂载当前路由对应的页面
			<RouterProvider router={router} />
		</div>
	);
	// 保留旧实现作为注释参考，便于回退对照
	// return <RouterProvider router={router} />;
}
```

**变更摘要**：新增 `Toaster` 导入并包裹全高主题背景容器，补齐通知能力与背景一致性；旧实现以注释保留。

### 4.2 路由配置（`apps/remote-plugins/src/router/routes.tsx`）

**对比范围**：`routes` 数组中学习笔记与想法列表两条子路由的 `element` 配置。

**改动前** · `apps/remote-plugins/src/router/routes.tsx`（基线，约 L16–L43）

```typescript
// 学习笔记路由：未传 independent，mock 标题占位
{
	path: 'english-learning/notes',
	element: (
		// 渲染学习笔记插件页，仅传入 mock 的 api 与 plugin
		<LearningNotesApp
			api={mockApi()}
			plugin={mockPlugin('learningNotes', '/english-learning/notes')}
		/>
	),
},
// 想法列表路由：未传 independent，且 getBookTitle 返回占位文案
{
	path: 'ebook/plugins/ideas-list',
	element: (
		// 渲染想法列表插件页，传入自定义 ebook 模块 mock
		<IdeasListApp
			api={mockApi({
				modules: {
					ebook: {
						// mock：无书籍上下文
						getBookId: () => null,
						// 旧版返回占位文案，会在标题栏显示误导性文字
						getBookTitle: () => '独立预览（无书籍）',
						// mock：导航到 cfi 不做实际跳转
						navigateToCfi: () => undefined,
						// mock：打开想法不做实际处理
						openThought: () => undefined,
					},
				},
			})}
			plugin={mockPlugin('ebookIdeasList', '/ebook/plugins/ideas-list')}
		/>
	),
},
```

**改动后** · `apps/remote-plugins/src/router/routes.tsx`（当前，约 L16–L44）

```typescript
// 学习笔记路由：显式传 independent 标识独立预览
{
	path: 'english-learning/notes',
	element: (
		// 渲染学习笔记插件页，新增 independent prop 标记独立运行
		<LearningNotesApp
			independent
			api={mockApi()}
			plugin={mockPlugin('learningNotes', '/english-learning/notes')}
		/>
	),
},
// 想法列表路由：显式传 independent，getBookTitle 改为空串
{
	path: 'ebook/plugins/ideas-list',
	element: (
		// 渲染想法列表插件页，新增 independent prop 标记独立运行
		<IdeasListApp
			independent
			api={mockApi({
				modules: {
					ebook: {
						// mock：无书籍上下文
						getBookId: () => null,
						// 改为空串，避免标题栏显示误导性占位文案
						getBookTitle: () => '',
						// mock：导航到 cfi 不做实际跳转
						navigateToCfi: () => undefined,
						// mock：打开想法不做实际处理
						openThought: () => undefined,
					},
				},
			})}
			plugin={mockPlugin('ebookIdeasList', '/ebook/plugins/ideas-list')}
		/>
	),
},
```

**变更摘要**：两个插件页均新增 `independent` prop；想法列表 mock 的 `getBookTitle` 由占位文案改为空串，避免独立预览标题栏误导。

### 4.3 布局组件（`apps/remote-plugins/src/layout/index.tsx`）

**对比范围**：`Layout` 默认导出函数中 `<main>` 元素。

**改动前** · `apps/remote-plugins/src/layout/index.tsx`（基线，约 L38–L40）

```tsx
// 旧版 main：统一 p-4，会与页面自身 padding 叠加
<main className="min-h-0 flex-1 overflow-auto p-4">
	// 路由出口，渲染匹配的子路由页面
	<Outlet />
</main>
```

**改动后** · `apps/remote-plugins/src/layout/index.tsx`（当前，约 L38–L40）

```tsx
// 新版 main：去掉 p-4，padding 下放到各页面自管
<main className="min-h-0 flex-1 overflow-auto">
	// 路由出口，渲染匹配的子路由页面
	<Outlet />
</main>
```

**变更摘要**：移除 `main` 的 `p-4`，统一 padding 下放给各页面，避免与全高页面布局叠加。

### 4.4 首页（`apps/remote-plugins/src/views/home/index.tsx`）

**对比范围**：`Home` 默认导出函数返回的根容器 `<div>`。

**改动前** · `apps/remote-plugins/src/views/home/index.tsx`（基线，约 L16–L18）

```tsx
// 首页根容器：旧版依赖 layout 的 p-4，自身只做最大宽度与纵向间距
export default function Home() {
	return (
		// 旧版仅 mx-auto + max-w-lg + flex-col gap-4，无自身 padding
		<div className="mx-auto flex max-w-lg flex-col gap-4">
```

**改动后** · `apps/remote-plugins/src/views/home/index.tsx`（当前，约 L16–L18）

```tsx
// 首页根容器：补 w-full h-full p-4，承接 layout 下放的 padding
export default function Home() {
	return (
		// 新版补 w-full h-full 撑满父级，p-4 保留原视觉间距
		<div className="w-full h-full p-4 mx-auto flex max-w-lg flex-col gap-4">
```

**变更摘要**：根容器新增 `w-full h-full p-4`，承接 layout 移除的 padding，首页视觉与原来一致。

### 4.5 UI 组件导出（`apps/remote-plugins/src/components/ui/index.ts`）

**对比范围**：整个 `index.ts` 聚合导出文件。

**改动前** · `apps/remote-plugins/src/components/ui/index.ts`（基线，约 L1–L11）

```typescript
// 导出 Button 及其变体样式
export { Button, buttonVariants } from './button';
// 导出下拉菜单相关组件
export {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from './dropdown-menu';
// 导出输入框组件
export { Input } from './input';
// 导出可调整大小面板相关组件
export {
	ResizableHandle,
	ResizablePanel,
	ResizablePanelGroup,
} from './resizable';
// 导出滚动区域相关组件
export { ScrollArea, ScrollBar } from './scroll-area';
```

**改动后** · `apps/remote-plugins/src/components/ui/index.ts`（当前，约 L1–L17）

```typescript
// 新增：导出 alert-dialog 全部组件
export * from './alert-dialog';
// 导出 Button 及其变体样式
export { Button, buttonVariants } from './button';
// 新增：导出 checkbox 全部组件
export * from './checkbox';
// 导出下拉菜单相关组件
export {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from './dropdown-menu';
// 导出输入框组件
export { Input } from './input';
// 导出可调整大小面板相关组件
export {
	ResizableHandle,
	ResizablePanel,
	ResizablePanelGroup,
} from './resizable';
// 导出滚动区域相关组件
export { ScrollArea, ScrollBar } from './scroll-area';
// 新增：导出 sonner 通知组件（含 Toaster）
export * from './sonner';
```

**变更摘要**：新增 `alert-dialog`、`checkbox`、`sonner` 三项聚合导出，与主站 `@ui/index` 对齐。

### 4.6 Input 组件（`apps/remote-plugins/src/components/ui/input.tsx`）

**对比范围**：`Input` 函数返回的 `<input>` 元素。

**改动前** · `apps/remote-plugins/src/components/ui/input.tsx`（基线，约 L6–L18）

```tsx
// 返回 input 元素：旧版未关闭拼写检查
return (
	// 原生 input，data-slot 用于样式定位
	<input
		// 透传 type 属性
		type={type}
		// data-slot 供 CSS 选择器定位
		data-slot="input"
		// 合并基础样式与外部 className
		className={cn(
			// 基础尺寸/边框/背景/字号/禁用态等样式
			'h-9 w-full min-w-0 rounded-md border border-input bg-transparent px-3 py-1 text-base shadow-xs transition-[color,box-shadow] outline-none selection:bg-primary selection:text-primary-foreground file:inline-flex file:h-7 file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground placeholder:text-muted-foreground disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 md:text-sm dark:bg-input/30',
			// 聚焦可见态的边框与环
			'focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50',
			// 校验失败态的边框与环
			'aria-invalid:border-destructive aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40',
			// 外部传入的 className
			className,
		)}
		// 展开其余透传属性
		{...props}
	/>
);
```

**改动后** · `apps/remote-plugins/src/components/ui/input.tsx`（当前，约 L6–L19）

```tsx
// 返回 input 元素：新增 spellCheck="false"
return (
	// 原生 input，data-slot 用于样式定位
	<input
		// 透传 type 属性
		type={type}
		// data-slot 供 CSS 选择器定位
		data-slot="input"
		// 合并基础样式与外部 className
		className={cn(
			// 基础尺寸/边框/背景/字号/禁用态等样式
			'h-9 w-full min-w-0 rounded-md border border-input bg-transparent px-3 py-1 text-base shadow-xs transition-[color,box-shadow] outline-none selection:bg-primary selection:text-primary-foreground file:inline-flex file:h-7 file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground placeholder:text-muted-foreground disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 md:text-sm dark:bg-input/30',
			// 聚焦可见态的边框与环
			'focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50',
			// 校验失败态的边框与环
			'aria-invalid:border-destructive aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40',
			// 外部传入的 className
			className,
		)}
		// 展开其余透传属性
		{...props}
		// 关闭浏览器拼写检查，避免英文/代码输入被红线标记
		spellCheck="false"
	/>
);
```

**变更摘要**：在 `{...props}` 之后追加 `spellCheck="false"`，关闭拼写检查。

### 4.7 ScrollArea 注释（`apps/remote-plugins/src/components/ui/scroll-area.tsx`）

**对比范围**：`ScrollAreaProps` 接口的 `scrollbars` 字段，以及 `ScrollArea` 内 Viewport 的 `className` 中 flex hack 行。

**改动前** · `apps/remote-plugins/src/components/ui/scroll-area.tsx`（基线，约 L17–L18 与约 L55–L57）

```tsx
// 旧版 scrollbars 字段无注释，含义不直观
	scrollbars?: ScrollAreaScrollbars;
}
```

```tsx
						// 旧版 flex hack 无注释，难以理解为何用 ! 与 min-h-full
						'[&>div]:flex! [&>div]:min-h-full! [&>div]:min-w-full! [&>div]:flex-col!',
```

**改动后** · `apps/remote-plugins/src/components/ui/scroll-area.tsx`（当前，约 L17–L18 与约 L55–L57）

```tsx
// 新增注释：说明 scrollbars 字段的作用与默认值选择的理由
	/** Radix 须挂载对应 Scrollbar 才开启该方向滚动；Markdown 预览等需 both 以免撑破 flex 父级 */
	scrollbars?: ScrollAreaScrollbars;
}
```

```tsx
						// 新增注释：解释 Radix Viewport 内联 display:table 的副作用及覆盖方式
						// Radix 在 Viewport 内用内联 display:table 包裹子节点；子树无法按视口高度撑开，flex 垂直居中等布局会失效。用 flex + min-h-full 覆盖（需 ! 压过内联 table）
						'[&>div]:flex! [&>div]:min-h-full! [&>div]:min-w-full! [&>div]:flex-col!',
```

**变更摘要**：为 `scrollbars` 字段与 Viewport flex hack 各补一行中文注释，说明 Radix 行为与覆盖理由，纯注释变更。

### 4.8 电子书阅读页想法列表抽屉（`apps/frontend/src/views/ebook/read.tsx`）

**对比范围**：`EbookReadPage` 中想法列表 `Drawer` 的 `bodyClassName` 属性。

**改动前** · `apps/frontend/src/views/ebook/read.tsx`（基线，约 L2981–L2985）

```tsx
// 想法列表抽屉：旧版 bodyClassName 仅有上下 padding，左侧沿用 Drawer 默认
<Drawer
	// 抽屉标题
	title={t('ebook.read.ideasList.title')}
	// 抽屉开关
	open={ideasListOpen}
	// 开关回调
	onOpenChange={setIdeasListOpen}
	// 旧版：上 1.5 下 2，左侧 padding 由 Drawer 默认提供
	bodyClassName="pt-1.5 pb-2"
```

**改动后** · `apps/frontend/src/views/ebook/read.tsx`（当前，约 L2981–L2985）

```tsx
// 想法列表抽屉：bodyClassName 调整为 pt-2 pb-2 pl-0，消除左侧多余 padding
<Drawer
	// 抽屉标题
	title={t('ebook.read.ideasList.title')}
	// 抽屉开关
	open={ideasListOpen}
	// 开关回调
	onOpenChange={setIdeasListOpen}
	// 新版：上 2 下 2，左 0，让内部列表自行控制横向 padding
	bodyClassName="pt-2 pb-2 pl-0"
```

**变更摘要**：`bodyClassName` 由 `pt-1.5 pb-2` 改为 `pt-2 pb-2 pl-0`，上 padding 微调并显式清零左侧，交由内部列表控制横向间距。

### 4.9 英语学习笔记页（`apps/frontend/src/views/englishLearning/notes/index.tsx`）

**对比范围**：`EnglishLearningNotesPage` 返回的内层 `<div>` 及下架提示 `<p>`。

**改动前** · `apps/frontend/src/views/englishLearning/notes/index.tsx`（基线，约 L13–L19）

```tsx
// 旧版：px-4 pb-4，下架提示 p 带 text-sm
<div className="min-h-0 flex-1 overflow-auto px-4 pb-4">
	// 插件启用则渲染宿主页，否则显示下架提示
	{enabled ? (
		// 渲染学习笔记插件宿主页
		<PluginHostPage pluginId="learningNotes" />
	) : (
		// 旧版下架提示带 text-sm，与正文风格不一致
		<p className="text-textcolor/55 text-sm">
			// 下架提示文案
			{t('plugins.host.delisted')}
		</p>
	)}
</div>
```

**改动后** · `apps/frontend/src/views/englishLearning/notes/index.tsx`（当前，约 L13–L17）

```tsx
// 新版：px-5.5 pb-5.5，下架提示 p 去掉 text-sm 并合并为单行
<div className="min-h-0 flex-1 overflow-auto px-5.5 pb-5.5">
	// 插件启用则渲染宿主页，否则显示下架提示
	{enabled ? (
		// 渲染学习笔记插件宿主页
		<PluginHostPage pluginId="learningNotes" />
	) : (
		// 新版去掉 text-sm，与正文风格统一
		<p className="text-textcolor/55">{t('plugins.host.delisted')}</p>
	)}
</div>
```

**变更摘要**：内层容器 padding 由 `px-4 pb-4` 改为 `px-5.5 pb-5.5`；下架提示 `<p>` 去掉 `text-sm` 并合并为单行。

### 4.10 想法列表（`apps/remote-plugins/src/views/ebook-ideas/index.tsx`）

**对比范围**：`HostBridgeProps` 类型中 `http` 字段与 `plugin` 字段后的 `independent` 字段；以及渲染部分的书名标题栏 `<div>` 与 `ScrollArea` 的 `className`。

**改动前** · `apps/remote-plugins/src/views/ebook-ideas/index.tsx`（基线，约 L39–L43、L53、L187、L198）

```typescript
// 旧版 http 仅支持 get/post
		http?: {
			// GET 请求
			get: <T = unknown>(url: string) => Promise<T>;
			// POST 请求
			post: <T = unknown>(url: string, body?: unknown) => Promise<T>;
		};
```

```typescript
// 旧版无 independent 标识
	plugin: { id: string; version: string; routePath: string };
```

```tsx
// 旧版标题栏：border-theme-border + px-2
			<div className="text-textcolor/55 border-theme-border mb-1 shrink-0 border-b px-2 pb-2.5 text-xs">
```

```tsx
// 旧版 ScrollArea：仅 pr-1.5，无左侧 padding
			<ScrollArea
				ref={viewportRef}
				className="box-border flex min-h-0 flex-1 flex-col pr-1.5"
			>
```

**改动后** · `apps/remote-plugins/src/views/ebook-ideas/index.tsx`（当前，约 L39–L44、L53–L55、L187、L198）

```typescript
// 新版 http 补齐 put/delete
		http?: {
			// GET 请求
			get: <T = unknown>(url: string) => Promise<T>;
			// POST 请求
			post: <T = unknown>(url: string, body?: unknown) => Promise<T>;
			// 新增：PUT 请求，用于更新想法等场景
			put: <T = unknown>(url: string, body?: unknown) => Promise<T>;
			// 新增：DELETE 请求，用于删除想法等场景
			delete: <T = unknown>(url: string) => Promise<T>;
		};
```

```typescript
// 新增 independent 可选字段，标记是否独立运行
	plugin: { id: string; version: string; routePath: string };
	// 是否独立运行
	independent?: boolean;
```

```tsx
// 新版标题栏：border-theme/10 更轻，px-3.5 增大左右内边距
			<div className="text-textcolor/55 border-theme/10 mb-1 shrink-0 border-b px-3.5 pb-2.5 text-xs">
```

```tsx
// 新版 ScrollArea：pr-1.5 改 px-1.5，左右对称 padding
			<ScrollArea
				ref={viewportRef}
				className="box-border flex min-h-0 flex-1 flex-col px-1.5"
			>
```

**变更摘要**：`http` 类型补 `put`/`delete`；新增 `independent?: boolean` 字段及注释；标题栏边框由 `border-theme-border` 改为 `border-theme/10`、`px-2` 改为 `px-3.5`；`ScrollArea` 由 `pr-1.5` 改为 `px-1.5`，左右对称 padding。

## 5. 兼容性与影响

- **预览环境**：`:9008` 新增 `Toaster` 与全高背景容器，不会影响嵌入主站的 `/embed/*` 路由（仍走 `EmbedIdeasList` / `EmbedLearningNotes`，无预览壳）。
- **layout padding 下放**：`main` 去掉 `p-4` 后，所有预览页面需自行管理 padding。当前仅 `home` 已补 `p-4`；`learning-notes`、`ideas-list` 为全高页面，原本就自带内边距，不受影响。后续新增预览页需注意自行加 padding。
- **UI 组件导出**：`alert-dialog`、`checkbox`、`sonner` 的源文件需已存在于 `components/ui/` 目录，否则聚合导出会编译失败。
- **Input spellCheck**：对所有使用 `Input` 的表单生效，关闭拼写检查对英文/代码输入友好，对中文输入无影响。
- **ScrollArea 注释**：纯注释变更，无行为影响。
- **主应用 read.tsx**：`bodyClassName` 调整仅影响电子书阅读页想法列表抽屉的内部 padding，需回归确认抽屉内列表横向对齐无错位。
- **主应用 notes/index.tsx**：padding 由 `px-4 pb-4` 改为 `px-5.5 pb-5.5`，需回归确认学习笔记页内容不溢出；下架提示文案字号跟随 `text-textcolor/55` 默认继承。
- **ideas-list 类型扩展**：`http` 补 `put/delete` 为向后兼容新增，不破坏既有 `get/post` 调用；`independent` 为可选字段，未传时行为不变。
- **ideas-list 样式**：标题栏与 ScrollArea padding 调整需在主站电子书阅读页抽屉与独立预览页两处回归确认视觉一致。

## 6. 相关源码路径

| 说明 | 路径 |
| ---- | ---- |
| 预览环境路由入口（挂载 Toaster + 背景容器） | `apps/remote-plugins/src/router/index.tsx` |
| 预览环境路由配置（传递 independent） | `apps/remote-plugins/src/router/routes.tsx` |
| 预览壳布局（main 去掉 p-4） | `apps/remote-plugins/src/layout/index.tsx` |
| 预览首页（补 w-full h-full p-4） | `apps/remote-plugins/src/views/home/index.tsx` |
| UI 组件聚合导出（补 alert-dialog/checkbox/sonner） | `apps/remote-plugins/src/components/ui/index.ts` |
| Input 组件（补 spellCheck="false"） | `apps/remote-plugins/src/components/ui/input.tsx` |
| ScrollArea 组件（补注释） | `apps/remote-plugins/src/components/ui/scroll-area.tsx` |
| 电子书阅读页想法列表抽屉（bodyClassName 微调） | `apps/frontend/src/views/ebook/read.tsx` |
| 英语学习笔记页（padding 微调） | `apps/frontend/src/views/englishLearning/notes/index.tsx` |
| 想法列表插件页（http 补 put/delete + independent + 样式对齐） | `apps/remote-plugins/src/views/ebook-ideas/index.tsx` |

---

（若与仓库最新源码不一致，以源码为准）
