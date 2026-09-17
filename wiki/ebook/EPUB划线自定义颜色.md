# EPUB 划线自定义色与 ColorPicker — 实现说明

## 延伸阅读

- [developer/EPUB用户划线开发.md](./developer/EPUB用户划线开发.md) — 用户划线主手册（五色基线）
- [../impact/EPUB划线自定义颜色选择器影响.md](../impact/EPUB划线自定义颜色选择器影响.md) — 影响面矩阵与回归清单
- [EPUB PopBar性能体验.md](./EPUB PopBar性能体验.md) — PopBar 防闪烁与 sync 增量

## 1. 背景与目标

**用户视角**：阅读 EPUB 时，除五种预设划线色外，可在选区工具条样式条中打开 **自定义色**，用取色器选任意色相并调节 **填充透明度**；每条划线的颜色（含透明度）随账号同步。

**技术目标**：

1. 扩展 `color` 字段：预设 id + `#rrggbb` / `#rrggbbaa`（末字节为填充 alpha）。
2. 新增通用 `ColorPicker`（`@/components/ui`），嵌套在 PopBar Popover 内可用。
3. 修复连续改色时 upsert 并发导致 API 报「划线不存在」。
4. 想法侧栏引用区正确展示自定义色。

## 2. 改动范围

| 路径 | 摘要 |
|------|------|
| `apps/frontend/src/components/ui/color-picker.tsx` | **新增** 取色器组件 |
| `apps/frontend/src/components/ui/index.tsx` | 导出 `ColorPicker` |
| `apps/frontend/src/views/ebook/types.ts` | `EpubHighlightColorId` 联合类型 |
| `apps/frontend/src/views/ebook/utils/epub/mark/epubUserHighlights.ts` | 调色板解析、localStorage、patch 取色 |
| `apps/frontend/src/views/ebook/components/selection/EpubHighlightStyleBar.tsx` | ColorPicker 入口 |
| `apps/frontend/src/views/ebook/components/selection/EpubSelectionPopBar.tsx` | mousedown 白名单 |
| `apps/frontend/src/views/ebook/read.tsx` | upsert 串行队列、保存自定义色 |
| `apps/frontend/src/views/ebook/components/thought/EpubThoughtParts.tsx` | `resolveHighlightPalette` |
| `apps/backend/src/services/ebook/dto/create-ebook-highlight.dto.ts` | 颜色正则校验 |
| `apps/backend/src/services/ebook/dto/update-ebook-highlight.dto.ts` | 同上 |
| `apps/backend/src/services/ebook/ebook.service.ts` | DTO `color: string` |
| `apps/frontend/src/i18n/locales/zh-CN.ts`、`en-US.ts` | `customColor` 文案 |

## 3. 实现思路

1. **颜色存哪**：服务端 `EbookUserHighlight.color` 存预设名或 6/8 位 hex；8 位时末两字符为填充透明度（0–255），与描边色 `#rrggbb` 分离编码。
2. **localStorage 只记「上次自定义色」**：键 `dnhyxc_epub_highlight_custom_color`，供 ColorPicker 默认色块；**不**做全局透明度——透明度跟每条划线走。
3. **调色板统一入口**：`resolveHighlightPalette(colorId)` 替代散落的 `COLOR_BY_ID[id]`，预设与自定义同源。
4. **ColorPicker 提交策略**：拖动饱和度/色相/透明度仅本地预览；**松手、失焦、Enter** 才 `onChange`；`modal={false}` 避免嵌套 Popover 焦点陷阱。
5. **PopBar 保选区**：`EpubSelectionPopBar` 对 `input/textarea/select` 及嵌套 `[data-slot=popover-content]` 不 `preventDefault`，否则 RGB 输入无法聚焦。
6. **upsert 串行**：`highlightUpsertQueueRef` 将 `upsertHighlightForQuote` 包进 Promise 链，ColorPicker 连续提交不并发删改同一 id。

**数据流（改色）**：

```text
ColorPicker onChange(hex, { alpha })
  → formatCustomHighlightColor → EpubHighlightStyleBar onColorChange
  → read.onHighlightColorChange → upsertSelectionHighlight
  → upsertHighlightForQuote（队列）→ API → setHighlights → sync patch
```

## 4. 关键代码对比与注释

### 4.1 `EpubHighlightColorId` 类型（`apps/frontend/src/views/ebook/types.ts`）

**对比范围**：划线颜色类型定义。

**改动前** · `apps/frontend/src/views/ebook/types.ts`（基线，约 L118–L123）

```typescript
// EPUB 用户划线样式：背景高亮 / 直线下划线 / 波浪线
export type EpubHighlightStyle = 'highlight' | 'underline' | 'wavy';
// 划线颜色仅为五种预设字符串 id
export type EpubHighlightColorId =
	| 'pink'
	| 'purple'
	| 'blue'
	| 'green'
	| 'yellow';
```

**改动后** · `apps/frontend/src/views/ebook/types.ts`（当前，约 L115–L123）

```typescript
// EPUB 用户划线样式：背景高亮 / 直线下划线 / 波浪线
export type EpubHighlightStyle = 'highlight' | 'underline' | 'wavy';
// 五种预设色的字面量联合类型，供 EPUB_HIGHLIGHT_COLOR_OPTIONS 使用
export type EpubHighlightPresetColorId =
	| 'pink'
	| 'purple'
	| 'blue'
	| 'green'
	| 'yellow';
// 预设色或自定义 hex；8 位时末字节为填充透明度
export type EpubHighlightColorId = EpubHighlightPresetColorId | `#${string}`;
```

**变更摘要**：拆出 `EpubHighlightPresetColorId`；`EpubHighlightColorId` 扩展为预设 + 模板字面量 hex。

---

### 4.2 `CreateEbookHighlightDto` 颜色校验（`apps/backend/src/services/ebook/dto/create-ebook-highlight.dto.ts`）

**对比范围**：创建划线 DTO 的 `color` 字段校验。

**改动前** · `apps/backend/src/services/ebook/dto/create-ebook-highlight.dto.ts`（基线）

```typescript
// class-validator：枚举成员校验
import { IsIn, IsString, IsUUID, MaxLength, MinLength } from 'class-validator';
// 允许的划线样式常量数组
export const EBOOK_HIGHLIGHT_STYLES = [
	'highlight',
	'underline',
	'wavy',
] as const;
// 允许的五种预设颜色名
export const EBOOK_HIGHLIGHT_COLORS = [
	'pink',
	'purple',
	'blue',
	'green',
	'yellow',
] as const;
// 创建用户划线请求体
export class CreateEbookHighlightDto {
	// 书籍 UUID
	@IsUUID()
	bookId: string;
	// 选区 CFI 范围字符串
	@IsString()
	@MinLength(1)
	@MaxLength(8192)
	cfiRange: string;
	// 选区引用文本
	@IsString()
	@MinLength(1)
	@MaxLength(8192)
	quote: string;
	// 样式须在 EBOOK_HIGHLIGHT_STYLES 内
	@IsIn(EBOOK_HIGHLIGHT_STYLES)
	style: (typeof EBOOK_HIGHLIGHT_STYLES)[number];
	// 颜色须在五种预设名内
	@IsIn(EBOOK_HIGHLIGHT_COLORS)
	color: (typeof EBOOK_HIGHLIGHT_COLORS)[number];
}
```

**改动后** · `apps/backend/src/services/ebook/dto/create-ebook-highlight.dto.ts`（当前）

```typescript
// class-validator：增加正则匹配装饰器
import {
	IsIn,
	IsString,
	IsUUID,
	Matches,
	MaxLength,
	MinLength,
} from 'class-validator';
// 允许的划线样式常量数组（未变）
export const EBOOK_HIGHLIGHT_STYLES = [
	'highlight',
	'underline',
	'wavy',
] as const;
// 预设色名列表（仍导出，供其它模块引用）
export const EBOOK_HIGHLIGHT_COLORS = [
	'pink',
	'purple',
	'blue',
	'green',
	'yellow',
] as const;
// 预设名或 #rrggbb / #rrggbbaa
export const EBOOK_HIGHLIGHT_COLOR_PATTERN =
	/^(pink|purple|blue|green|yellow|#[0-9a-fA-F]{6}(?:[0-9a-fA-F]{2})?)$/;
// 创建用户划线请求体
export class CreateEbookHighlightDto {
	@IsUUID()
	bookId: string;
	@IsString()
	@MinLength(1)
	@MaxLength(8192)
	cfiRange: string;
	@IsString()
	@MinLength(1)
	@MaxLength(8192)
	quote: string;
	@IsIn(EBOOK_HIGHLIGHT_STYLES)
	style: (typeof EBOOK_HIGHLIGHT_STYLES)[number];
	// 颜色匹配预设或 hex 正则
	@Matches(EBOOK_HIGHLIGHT_COLOR_PATTERN)
	color: string;
}
```

**变更摘要**：`@IsIn` 改为 `@Matches(EBOOK_HIGHLIGHT_COLOR_PATTERN)`；`UpdateEbookHighlightDto` 同步引用同一正则。

---

### 4.3 自定义色工具函数（`apps/frontend/src/views/ebook/utils/epub/mark/epubUserHighlights.ts`）

**对比范围**：基线中不存在下列导出函数；以下为 **新增** 模块（插入于 `EPUB_HIGHLIGHT_COLOR_OPTIONS` 与 `UNDERLINE_OFFSET_PX` 之间）。

**改动后（新增）** · `apps/frontend/src/views/ebook/utils/epub/mark/epubUserHighlights.ts`（当前，约 L77–L188）

```typescript
// localStorage 键：仅存用户上次在取色器选中的自定义色（含可选 8 位 alpha）
export const EPUB_HIGHLIGHT_CUSTOM_COLOR_STORAGE_KEY =
	'dnhyxc_epub_highlight_custom_color';
// 预设色 id 集合，用于 O(1) 判断是否为预设
const PRESET_COLOR_IDS = new Set<EpubHighlightPresetColorId>(
	EPUB_HIGHLIGHT_COLOR_OPTIONS.map((item) => item.id),
);
// 自定义 6 位 hex 正则
const CUSTOM_HEX6 = /^#[0-9a-fA-F]{6}$/;
// 自定义 8 位 hex 正则（含 alpha 字节）
const CUSTOM_HEX8 = /^#[0-9a-fA-F]{8}$/;
// 6 位 hex 未带 alpha 时填充使用的默认透明度（28%）
const CUSTOM_HIGHLIGHT_FILL_ALPHA = 0.28;
// 判断字符串是否为五种预设之一
export function isPresetHighlightColor(
	color: string,
): color is EpubHighlightPresetColorId {
	return PRESET_COLOR_IDS.has(color as EpubHighlightPresetColorId);
}
// 判断是否为 #rrggbb 或 #rrggbbaa 自定义色
export function isCustomHighlightColor(
	color: EpubHighlightColorId,
): color is `#${string}` {
	return CUSTOM_HEX6.test(color) || CUSTOM_HEX8.test(color);
}
// 从 8 位 hex 截取前 7 字符作为描边色 #rrggbb
export function customHighlightStroke(color: `#${string}`): `#${string}` {
	return color.slice(0, 7) as `#${string}`;
}
// 从 color 解析填充透明度百分比；8 位读末字节，6 位用默认 28%
export function customHighlightFillAlpha(color: `#${string}`): number {
	if (CUSTOM_HEX8.test(color)) {
		return Math.round((Number.parseInt(color.slice(7, 9), 16) / 255) * 100);
	}
	return Math.round(CUSTOM_HIGHLIGHT_FILL_ALPHA * 100);
}
// 将色相 hex 与透明度百分比合成为 #rrggbbaa 存储串
export function formatCustomHighlightColor(
	hex: string,
	alphaPercent: number,
): `#${string}` {
	const rgb = hex.replace('#', '').slice(0, 6).toLowerCase();
	const a = Math.min(
		255,
		Math.max(0, Math.round((alphaPercent / 100) * 255)),
	);
	return `#${rgb}${a.toString(16).padStart(2, '0')}` as `#${string}`;
}
// 规范化 API/DOM 读到的 color 字符串；无法解析则回退 pink
export function normalizeHighlightColor(color: string): EpubHighlightColorId {
	if (isPresetHighlightColor(color)) return color;
	const m = /^#?([0-9a-fA-F]{6})([0-9a-fA-F]{2})?$/i.exec(color.trim());
	if (m) {
		const hex = m[1]!.toLowerCase();
		const aa = m[2]?.toLowerCase();
		return (aa ? `#${hex}${aa}` : `#${hex}`) as EpubHighlightColorId;
	}
	return 'pink';
}
// 模块内：hex 转 rgba 字符串供 SVG fill
function hexToRgba(hex: string, alpha: number): string {
	const h = hex.replace('#', '');
	const r = Number.parseInt(h.slice(0, 2), 16);
	const g = Number.parseInt(h.slice(2, 4), 16);
	const b = Number.parseInt(h.slice(4, 6), 16);
	return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}
// 统一解析 fill/stroke：预设走 COLOR_BY_ID，自定义动态算 rgba
export function resolveHighlightPalette(colorId: EpubHighlightColorId): {
	fill: string;
	stroke: string;
} {
	if (isPresetHighlightColor(colorId)) {
		return COLOR_BY_ID[colorId];
	}
	if (isCustomHighlightColor(colorId)) {
		const stroke = customHighlightStroke(colorId);
		const alpha = customHighlightFillAlpha(colorId) / 100;
		return {
			stroke,
			fill: hexToRgba(stroke, alpha),
		};
	}
	return COLOR_BY_ID.pink;
}
// 读取上次自定义色；无效或缺失时默认 #ff6b81
export function loadEpubHighlightCustomColor(): `#${string}` {
	try {
		const raw = localStorage.getItem(EPUB_HIGHLIGHT_CUSTOM_COLOR_STORAGE_KEY);
		if (raw && isCustomHighlightColor(raw as EpubHighlightColorId)) {
			return raw as `#${string}`;
		}
	} catch {
		// ignore
	}
	return '#ff6b81';
}
// 写入上次自定义色到 localStorage
export function saveEpubHighlightCustomColor(hex: `#${string}`): void {
	try {
		localStorage.setItem(EPUB_HIGHLIGHT_CUSTOM_COLOR_STORAGE_KEY, hex);
	} catch {
		// ignore
	}
}
```

**变更摘要**：新增一整块颜色工具；`patchUserHighlightMarks` / `buildHighlightStyles` 中 `COLOR_BY_ID[colorId]` 改为 `resolveHighlightPalette(colorId)`；DOM 元数据读取改用 `normalizeHighlightColor`。

---

### 4.4 `ColorPicker` 组件（`apps/frontend/src/components/ui/color-picker.tsx`）

**对比范围**：基线中不存在该文件；以下为导出组件 **新增** 实现（面板内部 `ColorPickerPanel` 含饱和度区、滑条、HEX/RGB 输入，全文约 605 行）。

**改动后（新增）** · `apps/frontend/src/components/ui/color-picker.tsx`（当前，约 L151–L605）

```typescript
// 取色器支持的输入格式枚举
export type ColorPickerFormat = 'hex' | 'rgb';
// 对外 props：受控 value/alpha、onChange 在提交时触发
export type ColorPickerProps = {
	value?: string;
	defaultValue?: string;
	/** 受控透明度 0–100；与 `value` 的 hex/rgba 分离，便于 EPUB 划线仅存 hex */
	alpha?: number;
	onChange?: (
		color: string,
		detail: { hex: string; rgb: Rgb; alpha: number },
	) => void;
	disabled?: boolean;
	showAlpha?: boolean;
	size?: 'default' | 'sm';
	className?: string;
	triggerClassName?: string;
	children?: ReactNode;
};
// Popover 内面板使用的 RGB + alpha + 色相状态
type ColorState = { rgb: Rgb; alpha: number; h: number };
// ...（未改动）ColorPickerPanel、颜色数学工具函数等约 L170–L513 ...
// 取色器根组件：Radix Popover 包裹触发器与面板
export function ColorPicker({
	value,
	defaultValue = '#43860c',
	alpha: alphaProp,
	onChange,
	disabled,
	showAlpha = true,
	size = 'default',
	className,
	triggerClassName,
	children,
}: ColorPickerProps) {
	const [open, setOpen] = useState(false);
	const [state, setState] = useState(() =>
		stateFromValue(value ?? defaultValue, alphaProp ?? 100),
	);
	useEffect(() => {
		if (value === undefined) return;
		const parsed = parseColorString(value);
		if (!parsed) return;
		setState((prev) => {
			const { h } = rgbToHsv(parsed.rgb.r, parsed.rgb.g, parsed.rgb.b);
			const nextAlpha = alphaProp ?? parsed.alpha;
			if (
				prev.rgb.r === parsed.rgb.r &&
				prev.rgb.g === parsed.rgb.g &&
				prev.rgb.b === parsed.rgb.b &&
				prev.alpha === nextAlpha
			) {
				return prev;
			}
			return { rgb: parsed.rgb, alpha: nextAlpha, h };
		});
	}, [value, alphaProp]);
	const preview = useMemo(
		() => toRgbaString(state.rgb, showAlpha ? state.alpha : 100),
		[state.rgb, state.alpha, showAlpha],
	);
	const emitChange = useCallback(
		(next: ColorState) => {
			const hex = rgbToHex(next.rgb);
			onChange?.(hex, {
				hex,
				rgb: next.rgb,
				alpha: showAlpha ? next.alpha : 100,
			});
		},
		[onChange, showAlpha],
	);
	const triggerSize =
		size === 'sm' ? 'size-5 rounded-full' : 'size-7 rounded-md';
	const trigger = children ?? (
		<button
			type="button"
			disabled={disabled}
			className={cn(
				'border border-theme/20 shadow-xs transition-shadow outline-none focus-visible:ring-2 focus-visible:ring-theme/40',
				triggerSize,
				triggerClassName,
			)}
			style={{ backgroundColor: preview } as CSSProperties}
			aria-label="Color picker"
		/>
	);
	return (
		<Popover modal={false} open={open} onOpenChange={setOpen}>
			<PopoverTrigger asChild disabled={disabled}>
				{trigger}
			</PopoverTrigger>
			<PopoverContent
				align="start"
				sideOffset={8}
				className={cn('w-auto border-theme/10 p-3 shadow-lg', className)}
				onOpenAutoFocus={(e) => e.preventDefault()}
			>
				<ColorPickerPanel
					state={state}
					setState={setState}
					showAlpha={showAlpha}
					onChangeComplete={emitChange}
				/>
			</PopoverContent>
		</Popover>
	);
}
```

**变更摘要**：新文件；`modal={false}` 专为 PopBar 嵌套；`onChangeComplete` 仅在用户完成交互时向上提交。

---

### 4.5 `EpubHighlightStyleBar`（`apps/frontend/src/views/ebook/components/selection/EpubHighlightStyleBar.tsx`）

**对比范围**：`EpubHighlightStyleBar` 导出函数（`STYLE_OPTIONS` 常量两侧相同，摘录中省略）。

**改动前** · `apps/frontend/src/views/ebook/components/selection/EpubHighlightStyleBar.tsx`（基线，约 L97–L163）

```typescript
// PopBar 顶栏：左侧划线样式、右侧颜色
export function EpubHighlightStyleBar({
	style,
	color,
	onStyleChange,
	onColorChange,
	labels,
}: Props) {
	return (
		<div
			className={cn(
				'flex items-center justify-between gap-3 border-b px-2 py-1.5',
				epubReaderChromeBorderColorClass,
			)}
		>
			<div className="flex items-center gap-1">
				{/* ... STYLE_OPTIONS 按钮映射（未改动） ... */}
			</div>
			<div className="flex items-center gap-1.5">
				{EPUB_HIGHLIGHT_COLOR_OPTIONS.map((option) => {
					const active = color === option.id;
					return (
						<button
							key={option.id}
							type="button"
							aria-label={`${labels.colorPrefix} ${option.id}`}
							title={`${labels.colorPrefix} ${option.id}`}
							onClick={() => onColorChange(option.id)}
							className={cn(
								'relative flex size-5 items-center justify-center rounded-full transition-transform',
								active &&
									'scale-110 ring-2 ring-teal-500/50 ring-offset-1 ring-offset-transparent',
							)}
							style={{ backgroundColor: option.stroke }}
						>
							{active ? (
								<Check
									className="size-3 text-white"
									strokeWidth={3}
									aria-hidden
								/>
							) : null}
						</button>
					);
				})}
			</div>
		</div>
	);
}
```

**改动后** · `apps/frontend/src/views/ebook/components/selection/EpubHighlightStyleBar.tsx`（当前，约 L108–L229）

```typescript
// PopBar 顶栏：左侧划线样式、右侧预设色 + 自定义 ColorPicker
export function EpubHighlightStyleBar({
	style,
	color,
	onStyleChange,
	onColorChange,
	labels,
}: Props) {
	const lastCustom = loadEpubHighlightCustomColor();
	const customSwatch = isCustomHighlightColor(color)
		? customHighlightStroke(color)
		: customHighlightStroke(lastCustom);
	const pickerAlpha = isCustomHighlightColor(color)
		? customHighlightFillAlpha(color)
		: customHighlightFillAlpha(lastCustom);
	const customActive = isCustomHighlightColor(color);
	return (
		<div
			className={cn(
				'flex items-center justify-between gap-3 border-b px-2 py-1.5',
				epubReaderChromeBorderColorClass,
			)}
		>
			<div className="flex items-center gap-1">
				{/* ... STYLE_OPTIONS 按钮映射（未改动） ... */}
			</div>
			<div className="flex items-center gap-1.5">
				{EPUB_HIGHLIGHT_COLOR_OPTIONS.map((option) => {
					const active = color === option.id;
					return (
						<button
							key={option.id}
							type="button"
							aria-label={`${labels.colorPrefix} ${option.id}`}
							title={`${labels.colorPrefix} ${option.id}`}
							onClick={() => onColorChange(option.id)}
							className={cn(
								'relative flex size-5 items-center justify-center rounded-full transition-transform',
								active &&
									'scale-110 ring-2 ring-teal-500/50 ring-offset-1 ring-offset-transparent',
							)}
							style={{ backgroundColor: option.stroke }}
						>
							{active ? (
								<Check
									className="size-3 text-white"
									strokeWidth={3}
									aria-hidden
								/>
							) : null}
						</button>
					);
				})}
				<ColorPicker
					value={customSwatch}
					alpha={pickerAlpha}
					size="sm"
					onChange={(hex, { alpha }) => {
						const next = formatCustomHighlightColor(hex, alpha);
						saveEpubHighlightCustomColor(next);
						if (next !== color.toLowerCase()) {
							onColorChange(next);
						}
					}}
				>
					<button
						type="button"
						aria-label={labels.customColor}
						title={labels.customColor}
						className={cn(
							'relative flex size-5 shrink-0 items-center justify-center overflow-hidden rounded-full border-0 p-0 transition-transform outline-none focus-visible:ring-2 focus-visible:ring-teal-500/50',
							customActive &&
								'scale-110 ring-2 ring-teal-500/50 ring-offset-1 ring-offset-transparent',
						)}
						style={
							customActive
								? { backgroundColor: customHighlightStroke(color) }
								: {
										backgroundColor: 'transparent',
										backgroundImage:
											'conic-gradient(from 0deg, #ff6b81, #9b59b6, #78bfff, #96c24e, #ffdc6a, #ff6b81)',
									}
						}
					>
						{customActive ? (
							<Check
								className="size-3 text-white"
								strokeWidth={3}
								aria-hidden
							/>
						) : (
							<Palette
								className="size-3 text-white drop-shadow-sm"
								aria-hidden
							/>
						)}
					</button>
				</ColorPicker>
			</div>
		</div>
	);
}
```

**变更摘要**：预设五色后增加 `ColorPicker`；`labels` 增加 `customColor`；仅当合成色与当前 `color` 不同时才触发 upsert。

---

### 4.6 `upsertHighlightForQuote` 串行队列（`apps/frontend/src/views/ebook/read.tsx`）

**对比范围**：`upsertHighlightForQuote` 的 `useCallback` 外壳与队列接线（内部 `execute` 业务逻辑与基线相同，对称省略）。

**改动前** · `apps/frontend/src/views/ebook/read.tsx`（基线，约 L360–L510）

```typescript
const upsertHighlightForQuote = useCallback(
	async (
		cfiRange: string,
		quote: string,
		style: EpubHighlightStyle,
		color: EpubHighlightColorId,
	): Promise<EbookUserHighlight | null> => {
		// ...（未改动）合并、API create/update/delete、setHighlights ...
	},
	[bookId, t],
);
```

**改动后** · `apps/frontend/src/views/ebook/read.tsx`（当前，约 L249–L252、L366–L510）

```typescript
/** 串行化划线 upsert，避免 ColorPicker 连续提交并发删改同一 id */
const highlightUpsertQueueRef = useRef(
	Promise.resolve(null as EbookUserHighlight | null),
);
const upsertHighlightForQuote = useCallback(
	async (
		cfiRange: string,
		quote: string,
		style: EpubHighlightStyle,
		color: EpubHighlightColorId,
	): Promise<EbookUserHighlight | null> => {
		const execute = async (): Promise<EbookUserHighlight | null> => {
			// ...（未改动）与基线相同的合并与 API 逻辑 ...
		};
		const result = highlightUpsertQueueRef.current.then(execute, execute);
		highlightUpsertQueueRef.current = result.catch(() => null);
		return result;
	},
	[bookId, t],
);
```

**变更摘要**：新增 `highlightUpsertQueueRef`；原函数体包入 `execute` 并经 Promise 链串行。

---

### 4.7 `onHighlightColorChange`（`apps/frontend/src/views/ebook/read.tsx`）

**对比范围**：颜色变更回调开头（保存 localStorage 与后续 upsert 逻辑未改）。

**改动前** · `apps/frontend/src/views/ebook/read.tsx`（基线，约 L814–L816）

```typescript
const onHighlightColorChange = useCallback(
	(color: EpubHighlightColorId) => {
		setHighlightColor(color);
		// ...（未改动）payload 校验与 upsertSelectionHighlight ...
```

**改动后** · `apps/frontend/src/views/ebook/read.tsx`（当前，约 L814–L820）

```typescript
const onHighlightColorChange = useCallback(
	(color: EpubHighlightColorId) => {
		setHighlightColor(color);
		if (isCustomHighlightColor(color)) {
			saveEpubHighlightCustomColor(color);
		}
		// ...（未改动）payload 校验与 upsertSelectionHighlight ...
```

**变更摘要**：自定义色时同步写入 `localStorage` 供下次打开取色器默认值。

---

### 4.8 `EpubSelectionPopBar` `onMouseDown`（`apps/frontend/src/views/ebook/components/selection/EpubSelectionPopBar.tsx`）

**对比范围**：`PopoverContent` 的 `onMouseDown` 处理器。

**改动前** · `apps/frontend/src/views/ebook/components/selection/EpubSelectionPopBar.tsx`（基线，约 L109–L112）

```typescript
onMouseDown={(e) => e.preventDefault()}
```

**改动后** · `apps/frontend/src/views/ebook/components/selection/EpubSelectionPopBar.tsx`（当前，约 L112–L122）

```typescript
onMouseDown={(e) => {
	const el = e.target as HTMLElement;
	if (
		el.closest(
			'input, textarea, select, [data-slot=popover-content], [data-slot=select-content]',
		)
	) {
		return;
	}
	e.preventDefault();
}}
```

**变更摘要**：嵌套取色器内的表单控件与 Popover 内容区不再被 `preventDefault`，以保留焦点与文本选区。

---

### 4.9 `EpubHighlightedQuoteText` 调色板（`apps/frontend/src/views/ebook/components/thought/EpubThoughtParts.tsx`）

**对比范围**：想法侧栏引用区高亮色解析。

**改动前** · `apps/frontend/src/views/ebook/components/thought/EpubThoughtParts.tsx`（基线）

```typescript
// 模块内自建 COLOR_BY_ID，仅覆盖五种预设
const COLOR_BY_ID = Object.fromEntries(
	EPUB_HIGHLIGHT_COLOR_OPTIONS.map((item) => [item.id, item]),
) as Record<
	EpubHighlightColorId,
	(typeof EPUB_HIGHLIGHT_COLOR_OPTIONS)[number]
>;
function EpubHighlightedQuoteText({ quote, highlight, onHighlightClick }: { /* ... */ }) {
	const palette = highlight ? COLOR_BY_ID[highlight.color] : undefined;
	// ...
}
```

**改动后** · `apps/frontend/src/views/ebook/components/thought/EpubThoughtParts.tsx`（当前）

```typescript
// 删除本地 COLOR_BY_ID，改用 mark 层统一解析
import { resolveHighlightPalette } from '../../utils/epub/mark/epubUserHighlights';
function EpubHighlightedQuoteText({ quote, highlight, onHighlightClick }: { /* ... */ }) {
	const palette = highlight ? resolveHighlightPalette(highlight.color) : undefined;
	// ...
}
```

**变更摘要**：自定义 hex 在侧栏引用区可正确显示 fill/stroke。

## 5. 兼容性与影响

| 项 | 说明 |
|----|------|
| 旧数据 | 仅含预设名的划线无需迁移 |
| API | 旧客户端仍发预设 id；新客户端可发 hex |
| 预设行为 | 五色色值与合并规则不变 |
| PDF | 仍无划线 |
| 听书/听当前 | 未改播放层 |

## 6. 相关源码路径

| 说明 | 路径 |
|------|------|
| 取色器 UI | `apps/frontend/src/components/ui/color-picker.tsx` |
| 颜色工具与 patch | `apps/frontend/src/views/ebook/utils/epub/mark/epubUserHighlights.ts` |
| PopBar 样式条 | `apps/frontend/src/views/ebook/components/selection/EpubHighlightStyleBar.tsx` |
| 阅读页 upsert | `apps/frontend/src/views/ebook/read.tsx` |
| 后端校验 | `apps/backend/src/services/ebook/dto/create-ebook-highlight.dto.ts` |

---

（若与仓库最新源码不一致，以源码为准）
