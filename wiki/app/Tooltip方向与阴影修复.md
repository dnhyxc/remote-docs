# Tooltip 方向与阴影修复

## 1. 背景与目标

Tooltip 是仓库前端 UI 基础组件（`apps/frontend/src/components/ui/tooltip.tsx`），被知识编辑器、Monaco 编辑器、电子书书架卡片等多处使用。本轮修复围绕 Tooltip 自身默认值与颜色配置、以及调用方在不同场景下对展开方向与交互的微调展开。

- 阴影默认关闭（`shadow = false`）导致多数 Tooltip 显得"飘"，且阴影色取自 `--color-theme`（强调色），在浅色背景下投影偏色、对比不足。
- 知识编辑器工具栏位于页面顶部，Tooltip 仍向下展开，容易被工具栏遮挡或挤出可视区。
- Monaco 编辑器底部栏的「切换操作栏」Tooltip 同样向下展开，与底部栏布局语义不符，且组件中残留一行 `console.log` 调试语句。
- 电子书书架卡片「移动分类」菜单的触发器外层套了 Tooltip，菜单打开时 Tooltip 仍会因 hover 重复触发，与 Popover 抢焦点；菜单关闭后焦点自动回到触发器导致页面跳动。

目标：

1. 让 Tooltip 默认带阴影，并使用更柔和、稳定的颜色来源；
2. 工具栏 / 底部栏这类位于顶/底边的 Tooltip 统一向上展开；
3. 修复电子书书架卡片分类菜单的 Tooltip 与 Popover 焦点冲突；
4. 清理 Monaco 编辑器中的调试 `console.log`。

## 2. 改动范围

- `apps/frontend/src/components/ui/tooltip.tsx`：阴影类常量、`TooltipContent` 默认 `shadow` 值、`shadow` 条件渲染、Arrow `z-index`。
- `apps/frontend/src/views/knowledge/KnowledgeEditorToolbar.tsx`：import / save / clear / share / openLibrary / openTrash 六处 Tooltip 的 `side` 由 `"bottom"` 改为 `"top"`。
- `apps/frontend/src/components/design/Monaco/MonacoEditor.tsx`：删除 `console.log(compactChrome, ...)`；底部栏 Tooltip 的 `side` 由 `"bottom"` 改为 `"top"`。
- `apps/frontend/src/views/ebook/components/shelf/EbookShelfBookCard.tsx`：「移动分类」Tooltip 新增 `disableHoverableContent` 与 `disabled`；`PopoverContent` 新增 `onCloseAutoFocus` 阻止焦点回跳。

## 3. 实现思路

- **阴影默认开启**：将 `TooltipContent` 的 `shadow` 默认值从 `false` 改为 `true`。这样所有未显式传 `shadow` 的调用点自动获得阴影，避免每个调用点都补 `shadow`。仍保留 `shadow` prop，调用方需要禁用阴影时显式传 `false`。
- **阴影颜色分两路**：投影类（`shadow-[...]`）由原来的 `--color-theme` 改为 `--color-teal-500`，避免主题强调色被覆盖时 Tooltip 投影随之偏色；同时新增 `drop-shadow-[...]` 取 `--color-theme-background` 15%，使阴影更贴合内容区底色，视觉更柔和。
- **`shadow` 条件渲染改三元**：原写法 `shadow && TOOLTIP_SHADOW_CLASS` 在 `shadow` 为 `false` 时返回 `false`，被 `cn` 当作无效值过滤掉，但语义不直观。改为 `shadow ? TOOLTIP_SHADOW_CLASS : ''`，明确两种取值都返回字符串，便于阅读与排错。
- **Arrow `z-index` 下调**：内容区本身是 `z-50`，箭头也是 `z-50`，二者同层时箭头会盖住内容区的下沿（尤其是带阴影时）。将箭头降为 `z-30`，使其位于内容区下方，避免遮盖文字与投影。
- **工具栏方向反转**：知识编辑器工具栏与 Monaco 底部栏均位于容器顶/底边，原本向下展开的 Tooltip 在小屏或贴近视口边时会与工具栏自身重叠。统一改为 `side="top"`，使 Tooltip 朝远离工具栏的方向展开，留出更多可视空间。
- **分类菜单 Tooltip 与 Popover 协同**：Popover 触发器外层套 Tooltip，默认情况下 Tooltip 内容会保持 hoverable（鼠标移到内容上不关闭），这会与 Popover 菜单抢焦点。新增 `disableHoverableContent` 让 Tooltip 内容不可 hover；`disabled={categoryMenuOpen || categoryBusy}` 在菜单打开或分类移动进行中禁用 Tooltip，避免菜单打开时 Tooltip 同时弹出。
- **`onCloseAutoFocus` 阻止回跳**：Popover 默认在关闭时把焦点还给触发器并滚动到视口，会引发页面跳动。在 `PopoverContent` 上加 `onCloseAutoFocus={(e) => e.preventDefault()}`，阻止焦点自动回跳，使关闭菜单后页面保持原位。

## 4. 关键代码对比与注释

### 4.1 `TOOLTIP_SHADOW_CLASS` 阴影常量（`apps/frontend/src/components/ui/tooltip.tsx`）

**对比范围**：`TOOLTIP_SHADOW_CLASS` 常量定义。

**改动前** · `apps/frontend/src/components/ui/tooltip.tsx`（基线，约 L7–L8）

```typescript
// 顶部注释：说明该常量是 Tooltip 外圈阴影，来源是主题色 theme 10% 透明度（旧版口径）
/** Tooltip 外圈阴影：主题色 theme 10% 透明度（与 bg-theme/10 语义一致） */
// 声明常量 TOOLTIP_SHADOW_CLASS，用于内容区与箭头的阴影类名
const TOOLTIP_SHADOW_CLASS =
	// 旧版投影用 --color-theme（强调色）10%，与背景底色无关
	'shadow-[0_3px_12px_color-mix(in_oklch,var(--color-theme)_10%,transparent)] drop-shadow-[0_3px_12px_color-mix(in_oklch,var(--color-theme)_10%,transparent)]';
```

**改动后** · `apps/frontend/src/components/ui/tooltip.tsx`（当前，约 L6–L8）

```typescript
// 顶部注释：与改动前一致，说明该常量是 Tooltip 外圈阴影，来源是主题色 theme 10% 透明度
/** Tooltip 外圈阴影：主题色 theme 10% 透明度（与 bg-theme/10 语义一致） */
// 声明常量 TOOLTIP_SHADOW_CLASS，用于内容区与箭头的阴影类名
const TOOLTIP_SHADOW_CLASS =
	// 投影（box-shadow）改用 --color-teal-500 10%，避免被强调色覆盖时投影偏色
	'shadow-[0_3px_12px_color-mix(in_oklch,var(--color-teal-500)_10%,transparent)] drop-shadow-[0_3px_12px_color-mix(in_oklch,var(--color-theme-background)_15%,transparent)]';
```

**变更摘要**：投影色由 `--color-theme` 改为 `--color-teal-500`；drop-shadow 改用 `--color-theme-background` 15%，使阴影与内容底色更协调。

### 4.2 `TooltipContent` 默认 `shadow` 值（`apps/frontend/src/components/ui/tooltip.tsx`）

**对比范围**：`TooltipContent` 函数签名与解构默认值。

**改动前** · `apps/frontend/src/components/ui/tooltip.tsx`（基线，约 L42–L48）

```typescript
// TooltipContent 组件函数签名开始，解构 className / sideOffset / shadow / children 与其它 props
function TooltipContent({
	// 透传给根元素的 className
	className,
	// 内容区与触发器之间的偏移，默认 0
	sideOffset = 0,
	// 旧版默认不显示阴影，需要调用方显式传 shadow 才出现
	shadow = false,
	// Tooltip 内容节点
	children,
	// 其余透传给 Radix Content 的 props（如 side、align、onClick 等）
	...props
// 类型注解：TooltipContentProps
}: TooltipContentProps) {
```

**改动后** · `apps/frontend/src/components/ui/tooltip.tsx`（当前，约 L42–L48）

```typescript
// TooltipContent 组件函数签名开始，解构 className / sideOffset / shadow / children 与其它 props
function TooltipContent({
	// 透传给根元素的 className
	className,
	// 内容区与触发器之间的偏移，默认 0
	sideOffset = 0,
	// 新版默认显示阴影，调用方无需显式传 shadow 即可获得阴影
	shadow = true,
	// Tooltip 内容节点
	children,
	// 其余透传给 Radix Content 的 props（如 side、align、onClick 等）
	...props
// 类型注解：TooltipContentProps
}: TooltipContentProps) {
```

**变更摘要**：`shadow` 默认值由 `false` 改为 `true`，所有未显式传 `shadow` 的 Tooltip 现在默认带阴影。

### 4.3 `shadow` 条件渲染（`apps/frontend/src/components/ui/tooltip.tsx`）

**对比范围**：`TooltipContent` 内 `TooltipPrimitive.Content` 的 `className` 合成段。

**改动前** · `apps/frontend/src/components/ui/tooltip.tsx`（基线，约 L54–L57）

```typescript
// cn 合成内容区的 className
								className={cn(
										// 基础类名：选中禁选、文字色、z-50、宽度自适应、变换原点、圆角、内边距、文字大小与平衡
										'select-none text-textcolor z-50 w-fit origin-(--radix-tooltip-content-transform-origin) rounded-md px-3 py-1.5 text-xs text-balance',
										// 内容区底色，使用主题背景色
										'bg-theme-background',
										// 旧版写法：shadow 为 false 时整段为 false，被 cn 过滤
										shadow && TOOLTIP_SHADOW_CLASS,
```

**改动后** · `apps/frontend/src/components/ui/tooltip.tsx`（当前，约 L54–L57）

```typescript
// cn 合成内容区的 className
								className={cn(
										// 基础类名：选中禁选、文字色、z-50、宽度自适应、变换原点、圆角、内边距、文字大小与平衡
										'select-none text-textcolor z-50 w-fit origin-(--radix-tooltip-content-transform-origin) rounded-md px-3 py-1.5 text-xs text-balance',
										// 内容区底色，使用主题背景色
										'bg-theme-background',
										// 新版写法：三元表达式，shadow 取真返回阴影类，取假返回空串，语义更直观
										shadow ? TOOLTIP_SHADOW_CLASS : '',
```

**变更摘要**：`shadow && TOOLTIP_SHADOW_CLASS` 改为 `shadow ? TOOLTIP_SHADOW_CLASS : ''`，两种取值都返回字符串，便于阅读与排错。

### 4.4 `TooltipContent` Arrow `z-index`（`apps/frontend/src/components/ui/tooltip.tsx`）

**对比范围**：`TooltipContent` 内 `TooltipPrimitive.Arrow` 的 `className` 合成段。

**改动前** · `apps/frontend/src/components/ui/tooltip.tsx`（基线，约 L66–L68）

```typescript
// 渲染箭头组件，类名通过 cn 合成
								<TooltipPrimitive.Arrow
										className={cn(
												// 旧版箭头 z-50，与内容区同层，会盖住内容下沿
												'z-50 size-2.5 translate-y-[calc(-50%-2px)] rotate-45 rounded-[2px]',
```

**改动后** · `apps/frontend/src/components/ui/tooltip.tsx`（当前，约 L66–L68）

```typescript
// 渲染箭头组件，类名通过 cn 合成
								<TooltipPrimitive.Arrow
										className={cn(
												// 新版箭头 z-30，位于内容区（z-50）下方，避免遮盖内容与投影
												'z-30 size-2.5 translate-y-[calc(-50%-2px)] rotate-45 rounded-[2px]',
```

**变更摘要**：箭头 `z-index` 由 `z-50` 降为 `z-30`，避免遮盖内容区文字与阴影。

### 4.5 知识编辑器工具栏 Tooltip 方向（`apps/frontend/src/views/knowledge/KnowledgeEditorToolbar.tsx`）

**对比范围**：import / save / clear / share / openLibrary / openTrash 六处 Tooltip。各处结构一致，仅 `side` 取值变化，下面以 save 为例给出对比，其余五处改动同构。

**改动前** · `apps/frontend/src/views/knowledge/KnowledgeEditorToolbar.tsx`（基线，约 L82–L85）

```typescript
// 包裹保存按钮的 Tooltip
				<Tooltip
					// 旧版方向：向下展开，工具栏在顶部时容易被自身遮挡
					side="bottom"
					// Tooltip 文案：优先使用系统设置中的快捷键提示，否则回退到 i18n 默认文案
					content={shortcutHintSave ?? t('knowledge.shortcuts.save')}
				>
```

**改动后** · `apps/frontend/src/views/knowledge/KnowledgeEditorToolbar.tsx`（当前，约 L82–L85）

```typescript
// 包裹保存按钮的 Tooltip
				<Tooltip
					// 新版方向：向上展开，远离工具栏，留出更多可视空间
					side="top"
					// Tooltip 文案：优先使用系统设置中的快捷键提示，否则回退到 i18n 默认文案
					content={shortcutHintSave ?? t('knowledge.shortcuts.save')}
				>
```

**变更摘要**：import / save / clear / share / openLibrary / openTrash 六处 Tooltip 的 `side` 统一从 `"bottom"` 改为 `"top"`，工具栏在页面顶部时 Tooltip 向上展开更合理。

### 4.6 Monaco 编辑器底部栏 Tooltip 方向（`apps/frontend/src/components/design/Monaco/MonacoEditor.tsx`）

**对比范围**：底部栏「切换操作栏」按钮外的 Tooltip。

**改动前** · `apps/frontend/src/components/design/Monaco/MonacoEditor.tsx`（基线，约 L1875–L1878）

```typescript
// 包裹「切换操作栏」按钮的 Tooltip
							<Tooltip
								// 旧版方向：向下展开，与底部栏布局语义不符
								side="bottom"
								// Tooltip 文案：优先使用外部传入的快捷键提示，否则回退到默认 Meta + Shift + B
								content={markdownBottomBarShortcutHint ?? 'Meta + Shift + B'}
							>
```

**改动后** · `apps/frontend/src/components/design/Monaco/MonacoEditor.tsx`（当前，约 L1875–L1878）

```typescript
// 包裹「切换操作栏」按钮的 Tooltip
							<Tooltip
								// 新版方向：向上展开，远离底部栏
								side="top"
								// Tooltip 文案：优先使用外部传入的快捷键提示，否则回退到默认 Meta + Shift + B
								content={markdownBottomBarShortcutHint ?? 'Meta + Shift + B'}
							>
```

**变更摘要**：Monaco 底部栏 Tooltip 的 `side` 由 `"bottom"` 改为 `"top"`，与底部栏位置语义一致。

### 4.7 Monaco 编辑器删除 `console.log`（`apps/frontend/src/components/design/Monaco/MonacoEditor.tsx`）

**对比范围**：`editorPixelHeight` 计算前后的调试输出。

**改动前** · `apps/frontend/src/components/design/Monaco/MonacoEditor.tsx`（基线，约 L1847–L1850）

```typescript
// useEffect / useMemo 等代码块的闭合括号
	});
	// 残留的调试语句：打印紧凑模式标志、字面量、高度，无业务用途
	console.log(compactChrome, 'compactChrome', height);
	// 根据 compactChrome 决定编辑区像素高度：紧凑模式占满父级为 100%，否则使用传入的 height
	const editorPixelHeight = compactChrome ? '100%' : height;
```

**改动后** · `apps/frontend/src/components/design/Monaco/MonacoEditor.tsx`（当前，约 L1847–L1849）

```typescript
// useEffect / useMemo 等代码块的闭合括号
	});
	// 删除调试 console.log，避免生产环境控制台噪声与潜在性能影响
	// 根据 compactChrome 决定编辑区像素高度：紧凑模式占满父级为 100%，否则使用传入的 height
	const editorPixelHeight = compactChrome ? '100%' : height;
```

**变更摘要**：删除 `console.log(compactChrome, 'compactChrome', height)` 调试语句。

### 4.8 EbookShelfBookCard 分类菜单 Tooltip 交互（`apps/frontend/src/views/ebook/components/shelf/EbookShelfBookCard.tsx`）

**对比范围**：「移动分类」触发器外层 Tooltip 的属性。

**改动前** · `apps/frontend/src/views/ebook/components/shelf/EbookShelfBookCard.tsx`（基线，约 L273–L281）

```typescript
// 包裹分类移动按钮的 Tooltip
						<Tooltip
							// 方向：向上展开（与卡片顶角按钮一致）
							side="top"
							// 与触发器的偏移
							sideOffset={4}
							// 悬停延时，避免快速划过时频繁弹出
							delayDuration={200}
							// 显式开启阴影
							shadow
							// Tooltip 文案：移动分类
							content={t('ebook.shelf.category.move')}
						>
```

**改动后** · `apps/frontend/src/views/ebook/components/shelf/EbookShelfBookCard.tsx`（当前，约 L273–L281）

```typescript
// 包裹分类移动按钮的 Tooltip
						<Tooltip
							// 方向：向上展开（与卡片顶角按钮一致）
							side="top"
							// 与触发器的偏移
							sideOffset={4}
							// 悬停延时，避免快速划过时频繁弹出
							delayDuration={200}
							// 显式开启阴影
							shadow
							// 新增：禁用 Tooltip 内容区的 hover 保持，避免与 Popover 菜单抢焦点
							disableHoverableContent
							// 新增：菜单打开或分类移动进行中时禁用 Tooltip，避免 Tooltip 与菜单同时弹出
							disabled={categoryMenuOpen || categoryBusy}
							// Tooltip 文案：移动分类
							content={t('ebook.shelf.category.move')}
						>
```

**变更摘要**：Tooltip 新增 `disableHoverableContent` 与 `disabled={categoryMenuOpen || categoryBusy}`，在菜单打开或分类移动进行中禁用 Tooltip，避免与 Popover 冲突。

### 4.9 EbookShelfBookCard 分类菜单 `PopoverContent` `onCloseAutoFocus`（`apps/frontend/src/views/ebook/components/shelf/EbookShelfBookCard.tsx`）

**对比范围**：分类菜单 `PopoverContent` 的属性。

**改动前** · `apps/frontend/src/views/ebook/components/shelf/EbookShelfBookCard.tsx`（基线，约 L300–L304）

```typescript
// Popover 内容容器，承载分类列表
							side="bottom"
							// 与触发器的偏移
							sideOffset={6}
							// 宽度与内边距
							className="w-48 overflow-hidden p-0"
```

**改动后** · `apps/frontend/src/views/ebook/components/shelf/EbookShelfBookCard.tsx`（当前，约 L300–L305）

```typescript
// Popover 内容容器，承载分类列表
							side="bottom"
							// 与触发器的偏移
							sideOffset={6}
							// 宽度与内边距
							className="w-48 overflow-hidden p-0"
							// 新增：阻止关闭菜单时焦点自动回跳到触发器，避免页面跳动
							onCloseAutoFocus={(e) => e.preventDefault()}
```

**变更摘要**：`PopoverContent` 新增 `onCloseAutoFocus={(e) => e.preventDefault()}`，阻止关闭菜单后焦点跳回触发器导致页面跳动。

## 5. 兼容性与影响

- **阴影默认开启**：`TooltipContent` 的 `shadow` 默认值改为 `true`，所有未显式传 `shadow` 的 Tooltip 现在默认带阴影。若某处调用方不希望出现阴影，需显式传 `shadow={false}`。
- **阴影颜色变化**：投影色由 `--color-theme` 改为 `--color-teal-500`，drop-shadow 改为 `--color-theme-background` 15%。视觉上更柔和、更稳定，不再随强调色变化而偏色。
- **Arrow `z-index` 下调**：箭头由 `z-50` 降为 `z-30`，位于内容区下方，不再遮盖内容与投影。
- **工具栏 / 底部栏方向反转**：知识编辑器工具栏与 Monaco 底部栏的 Tooltip 改为向上展开。若触发器距视口顶部过近，Radix 会自动避让到其它方向（仍由 Radix 的 collision padding 处理）。
- **分类菜单交互**：电子书书架卡片分类菜单打开时禁用 Tooltip，关闭时不再回跳焦点。该改动仅影响「移动分类」入口，对其它 Popover / Tooltip 无副作用。
- **回归建议**：
  - 验证知识编辑器工具栏六个按钮的 Tooltip 朝上展开且不被工具栏遮挡；
  - 验证 Monaco 底部栏「切换操作栏」Tooltip 朝上展开；
  - 验证电子书书架卡片「移动分类」菜单：打开菜单时 Tooltip 不再弹出，关闭菜单后页面不跳动；
  - 验证默认 Tooltip 在浅 / 深主题下均有柔和阴影，且箭头不遮盖文字；
  - 抽查其它使用 `Tooltip` 未显式传 `shadow` 的调用点，确认阴影符合预期。

## 6. 相关源码路径表

| 说明 | 路径 |
| ---- | ---- |
| Tooltip 基础组件（阴影常量、`TooltipContent` 默认 `shadow`、`shadow` 条件渲染、Arrow `z-index`） | `apps/frontend/src/components/ui/tooltip.tsx` |
| 知识编辑器工具栏（六处 Tooltip `side` 改 `top`） | `apps/frontend/src/views/knowledge/KnowledgeEditorToolbar.tsx` |
| Monaco 编辑器（删除 `console.log`、底部栏 Tooltip `side` 改 `top`） | `apps/frontend/src/components/design/Monaco/MonacoEditor.tsx` |
| 电子书书架卡片（分类菜单 Tooltip 加 `disableHoverableContent` / `disabled`、`PopoverContent` 加 `onCloseAutoFocus`） | `apps/frontend/src/views/ebook/components/shelf/EbookShelfBookCard.tsx` |

---

若与仓库最新源码不一致，以源码为准。
