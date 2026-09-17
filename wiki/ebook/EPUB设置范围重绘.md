# EPUB 阅读设置滑条 accent 卡灰修复

## 延伸阅读

- [EPUB听书节奏引导影响.md](./EPUB听书节奏引导影响.md) — 听书切句时序（同轮改动）
- [epub-reader-settings.md](./EPUB阅读器设置关闭.md) — 阅读设置面板字段与持久化

## 1. 背景与目标

**问题**：macOS/WebKit 下原生 `<input type="range">` 的 `accent-teal-600` 主题色在窗口失焦后会卡在非激活灰色，回焦后也不会自动恢复，导致阅读设置面板中的字号/行高滑条颜色与主题不一致。

**目标**：在不更换原生滑条形态（保持系统原生外观与触感）的前提下，在窗口回焦或面板重新打开时**强制 remount** `<input>` 元素，使浏览器重新绘制 `accent-color`。

## 2. 改动范围

- `apps/frontend/src/views/ebook/components/reader/EpubReaderSettingsPopover.tsx`

## 3. 实现思路

1. **抽取 `SettingsRange` 组件**：将字号/行高滑条的「label + display + `<input range>`」结构封装为独立组件，消除重复 JSX。
2. **`repaintKey` 驱动 remount**：在 `<input>` 上绑定 `key={`${inputId}-${repaintKey}`}`；`repaintKey` 递增时 React 卸载旧节点、挂载新节点，浏览器重新计算 `accent-color`。
3. **三触发点递增 key**：
   - `window focus` — 窗口回焦时（核心场景）。
   - `document visibilitychange` — 从其它 Tab/应用切回时。
   - `open` 变为 `true` — 面板每次重新打开时。
4. **`SettingsRange` 接收 `repaintKey` 作为 prop**：由父组件 `EpubReaderSettingsPopover` 统一管理，两个滑条共享同一 key，保证同步重绘。

## 4. 关键代码对比与注释

### 4.1 `SettingsRange` 组件（纯新增）

**对比范围**：`function SettingsRange` 全函数（纯新增组件，无改动前对照）。

**改动后** · `apps/frontend/src/views/ebook/components/reader/EpubReaderSettingsPopover.tsx`（当前，约 L36–L83）

```typescript
// 组件注释：说明为何使用原生 range + accent，以及 repaintKey 的作用
/**
 * 原生 range + accent-teal-600（与改前一致的系统滑条形态）。
 * macOS/WebKit 失焦后 accent 会卡在非激活灰：窗口回焦或重新打开时 remount 强制重绘主题色。
 */
// 滑条组件声明，接收 label/display/min/max/step/value/onValueChange/repaintKey 等 props
function SettingsRange({
	// input 元素 id，用于 label 关联
	inputId,
	// 滑条左侧标签文案
	label,
	// 滑条右侧显示值（如 "100%" 或 "1.5"）
	display,
	// 滑条最小值
	min,
	// 滑条最大值
	max,
	// 滑条步长
	step,
	// 当前值（受控）
	value,
	// 值变化回调
	onValueChange,
	// 重绘 key：递增时 remount input 以恢复 accent-color
	repaintKey,
}: {
	// inputId 字段类型
	inputId: string;
	// label 字段类型
	label: string;
	// display 字段类型
	display: string;
	// min 字段类型
	min: number;
	// max 字段类型
	max: number;
	// step 字段类型
	step: number;
	// value 字段类型
	value: number;
	// onValueChange 回调签名
	onValueChange: (next: number) => void;
	// repaintKey 字段类型
	repaintKey: number;
}) {
	// 返回 JSX：外层 flex-col 容器 + label/display 行 + input range
	return (
		// 外层容器：纵向排列
		<div className="flex flex-col gap-2">
			// label 与 display 水平排列
			<div className="flex items-center justify-between gap-2">
				// 左侧标签：主题色字 + xs 字号 + medium 字重
				<span className="text-textcolor text-xs font-medium">{label}</span>
				// 右侧显示值：半透明字 + tabular-nums 等宽数字 + xs 字号
				<span className="text-textcolor/55 tabular-nums text-xs">
					{display}
				</span>
			</div>
			// 原生 range input：key 绑定 repaintKey 以实现 remount 重绘
			<input
				// key 由 inputId + repaintKey 拼接：repaintKey 递增时 React 卸载旧 input 挂载新 input
				key={`${inputId}-${repaintKey}`}
				// id 用于 label htmlFor 关联（如需要）
				id={inputId}
				// 原生 range 类型
				type="range"
				// 最小值
				min={min}
				// 最大值
				max={max}
				// 步长
				step={step}
				// 当前值（受控）
				value={value}
				// aria-label 无障碍标签
				aria-label={label}
				// accent-teal-600：系统滑条主题色（macOS/WebKit 失焦后会卡灰）
				className="accent-teal-600 w-full"
				// 值变化时回调，将字符串转为 number
				onChange={(e) => onValueChange(Number(e.target.value))}
			/>
		</div>
	);
}
```

**变更摘要**：新增 `SettingsRange` 组件，封装「label + display + 原生 range input」结构，`key` 绑定 `repaintKey` 实现 remount 重绘。

### 4.2 字号滑条：内联 JSX → `<SettingsRange>` 调用

**对比范围**：字号滑条 JSX 片段（`fontSize` 那一块）。

**改动前** · `apps/frontend/src/views/ebook/components/reader/EpubReaderSettingsPopover.tsx`（基线，约 L240–L258）

```tsx
// 改前：字号滑条直接内联在 Popover body 中，无 repaintKey 机制
<div className="flex flex-col gap-2">
	// label 行：左侧 Label 组件 + 右侧值 span
	<div className="flex items-center justify-between gap-2">
		// 左侧 Label：htmlFor 关联 input id
		<Label htmlFor="epub-font-size" className="text-xs">
			{t('ebook.read.settings.fontSize')}
		</Label>
		// 右侧值：显示当前字号百分比
		<span className="text-textcolor/55 tabular-nums text-xs">
			{settings.fontSize}%
		</span>
	</div>
	// 原生 range input：无 key，失焦后 accent 卡灰无法恢复
	<input
		// id 关联 Label
		id="epub-font-size"
		// 原生 range 类型
		type="range"
		// 最小字号 80%
		min={80}
		// 最大字号 160%
		max={160}
		// 步长 5%
		step={5}
		// 当前字号值
		value={settings.fontSize}
		// accent 主题色（macOS 失焦后卡灰）
		className="accent-teal-600 w-full"
		// 值变化回调：直接 onChange settings
		onChange={(e) => onChange({ fontSize: Number(e.target.value) })}
	/>
</div>
```

**改动后** · `apps/frontend/src/views/ebook/components/reader/EpubReaderSettingsPopover.tsx`（当前，约 L308–L318）

```tsx
// 改后：用 SettingsRange 组件替换内联 JSX，传入 repaintKey
<SettingsRange
	// input id
	inputId="epub-font-size"
	// 标签文案（i18n）
	label={t("ebook.read.settings.fontSize")}
	// 显示值：字号百分比
	display={`${settings.fontSize}%`}
	// 最小字号
	min={80}
	// 最大字号
	max={160}
	// 步长
	step={5}
	// 当前值
	value={settings.fontSize}
	// 值变化回调
	onValueChange={(fontSize) => onChange({ fontSize })}
	// 重绘 key：由父组件 rangeRepaintKey 驱动
	repaintKey={rangeRepaintKey}
/>
```

**变更摘要**：内联 JSX 替换为 `<SettingsRange>` 调用，新增 `repaintKey` prop 透传。

### 4.3 行高滑条：同上替换

行高滑条（`lineHeight`）改动模式与字号完全一致，从内联 `<input range>` 替换为 `<SettingsRange>` 调用并传入 `repaintKey={rangeRepaintKey}`，此处不再重复贴代码。

### 4.4 `rangeRepaintKey` state + 重绘触发 effects

**对比范围**：`EpubReaderSettingsPopover` 组件函数体内的 state 声明与 `useEffect`（改前无此段）。

**改动前** · `apps/frontend/src/views/ebook/components/reader/EpubReaderSettingsPopover.tsx`（基线，`EpubReaderSettingsPopover` 函数体内）

```tsx
// 改前：EpubReaderSettingsPopover 函数体内无 rangeRepaintKey state、无重绘 effect
export function EpubReaderSettingsPopover({
	settings,
	onChange,
	onReset,
	open,
	onOpenChange,
	disabled,
}: EpubReaderSettingsPopoverProps) {
	// i18n 翻译函数
	const { t } = useI18n();
	// 当前应用主题（light/black）
	const { theme: appTheme } = useTheme();

	// ...（handleWheel / handleWheelCapture 等未改动逻辑）

	// 直接 return JSX，无 rangeRepaintKey 相关逻辑
	return (
		<Popover open={open} onOpenChange={onOpenChange}>
			// ...（Popover 内容）
		</Popover>
	);
}
```

**改动后** · `apps/frontend/src/views/ebook/components/reader/EpubReaderSettingsPopover.tsx`（当前，约 L218–L247）

```tsx
// 改后：新增 rangeRepaintKey state + 两个 useEffect 触发重绘
export function EpubReaderSettingsPopover({
	// 阅读设置对象
	settings,
	// 设置变更回调
	onChange,
	// 重置回调
	onReset,
	// Popover 是否展开（受控）
	open,
	// Popover 展开变化回调
	onOpenChange,
	// 是否禁用触发按钮
	disabled,
}: EpubReaderSettingsPopoverProps) {
	// i18n 翻译函数
	const { t } = useI18n();
	// 当前应用主题（light/black），用于 chrome CSS vars
	const { theme: appTheme } = useTheme();
	// rangeRepaintKey：递增时触发 SettingsRange 内 input remount，恢复 accent-color
	const [rangeRepaintKey, setRangeRepaintKey] = useState(0);

	// Effect 1：监听 window focus + visibilitychange，回焦/切回时递增 key
	useEffect(() => {
		// bump 闭包：递增 rangeRepaintKey
		const bump = () => setRangeRepaintKey((k) => k + 1);
		// 窗口回焦时 bump
		const onFocus = () => bump();
		// 页面可见性变化时：仅切回 visible 才 bump
		const onVis = () => {
			// 仅当页面变为 visible 时递增 key
			if (document.visibilityState === "visible") bump();
		};
		// 注册 window focus 监听
		window.addEventListener("focus", onFocus);
		// 注册 visibilitychange 监听
		document.addEventListener("visibilitychange", onVis);
		// 清理函数：卸载时移除监听
		return () => {
			// 移除 focus 监听
			window.removeEventListener("focus", onFocus);
			// 移除 visibilitychange 监听
			document.removeEventListener("visibilitychange", onVis);
		};
	// 空依赖：仅挂载时注册一次
	}, []);

	// Effect 2：面板每次展开时递增 key（重新打开时重绘 accent）
	useEffect(() => {
		// 仅 open 为 true 时递增
		if (open) setRangeRepaintKey((k) => k + 1);
	// 依赖 open：open 变化时触发
	}, [open]);

	// ...（handleWheel / handleWheelCapture 等未改动逻辑）
```

**变更摘要**：新增 `rangeRepaintKey` state（初始 0）；Effect 1 监听 `window.focus` + `visibilitychange` 回焦时递增；Effect 2 在 `open` 变 true 时递增。

## 5. 兼容性与影响

- **行为兼容**：滑条值变更逻辑（`onChange` → `onChange({ fontSize })`）不变，仅 UI 层封装。
- **视觉兼容**：`accent-teal-600` + 原生 `range` 形态不变；remount 瞬间无视觉闪烁（input 值受控恢复）。
- **性能**：`useState` 递增 + remount 成本极低（两个 `<input>`），不影响交互流畅度。
- **非 macOS 平台**：`focus` / `visibilitychange` 也会触发 remount，但 Windows/Linux 无 accent 卡灰问题，remount 无副作用。

## 6. 相关源码路径

| 说明 | 路径 |
| ---- | ---- |
| 设置面板（含 `SettingsRange` + `rangeRepaintKey`） | `apps/frontend/src/views/ebook/components/reader/EpubReaderSettingsPopover.tsx` |

---

（若与仓库最新源码不一致，以源码为准）
