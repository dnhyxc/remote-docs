# 视频播放器影院态控制条主题适配

> **延伸阅读**：本文记录视频播放器「影院态全屏」下控制条文字/图标颜色的适配方案。
>
> 播放器组件化重构见 [视频播放器组件重构.md](../video/视频播放器组件重构.md)；
> 功能增强（缩略图、画中画等）见 [视频播放器功能增强.md](./视频播放器功能增强.md)；
> 拖拽与背景跟随见 [视频播放器拖拽进度.md](./视频播放器拖拽进度.md)；
> 影院态全屏容器实现见 [插件影院全屏.md](../plugins/插件影院全屏.md)。

## 1. 背景与目标

### 1.1 问题

视频播放器进入影院态全屏（`isFullscreen === true`）后，播放器外壳 `bg-black`，但控制条（上侧视频标题、底部播放/选集/音量/倍速/画中画/全屏等按钮）仍沿用日间主题的 `text-textcolor`（深色文字），在黑底背景下**几乎不可见**。具体表现：

- 顶部视频名称在影院态下看不见；
- 底部播放/上一集/下一集/选集/重置/音量/倍速/画中画/全屏等按钮的图标与文字在黑底上难以辨识；
- 已禁用的按钮（如首条视频的「上一集」）的 `text-textcolor/50` 在黑地下几乎等于消失。

### 1.2 目标

在不改变现有「影院态黑底」视觉基调的前提下，让控制条文字与图标在影院态自动切换为浅色，并把「禁用态」与「常规态」的对比度在影院态下重新拉开；同时保留日间（非影院态）的 `text-textcolor` / `text-textcolor/50` 语义色，不破坏既有浅色/深色主题一致性。

### 1.3 方案选择

在 `VideoPlayer` 顶层引入两个派生 className：

- `chromeFg`：影院态 → `text-white`；非影院态 → `text-textcolor`。
- `chromeFgMuted`：影院态 → `text-white/50`；非影院态 → `text-textcolor/50`。

把原先硬编码在每处按钮/标题 `className` 里的 `text-textcolor` / `text-textcolor/50` 替换为 `chromeFg` / `chromeFgMuted`，通过 `cn()` 与其它状态类合并。

该方案的优点：

- 改动集中在播放器单一文件（`player.tsx`）顶部两个常量；
- 所有控制条图标/文字均走同一条主题通道，未来若需适配其它「黑底容器」（如画中画覆盖层）只需复用 `chromeFg` 即可；
- 不改变任何 Tailwind 语义类（仍保留 `text-textcolor` / `text-textcolor/50` 的非影院态表现），只是在 `theater` 条件下覆盖。

## 2. 改动范围

| 路径 | 改动类型 | 说明 |
| ---- | -------- | ---- |
| `apps/micro/src/components/design/VideoPlayer/player.tsx` | 修改 | 新增 `chromeFg` / `chromeFgMuted` 两个派生类；将顶部标题、底部播放控制条（播放/上一集/下一集/选集/重置/列表/音量/倍速/画中画/全屏等）以及禁用态的 `text-textcolor` 替换为 `chromeFg` / `chromeFgMuted` |

## 3. 实现思路

### 3.1 派生语义色

在组件顶部 `theater` 与 `chromeHidden` 之后立即派生两个常量：

- `chromeFg = theater ? 'text-white' : 'text-textcolor'`
- `chromeFgMuted = theater ? 'text-white/50' : 'text-textcolor/50'`

使用 `text-white/50` 而非 `text-white opacity-50`，因为 Tailwind 中带斜杠的颜色不透明度（`color-opacity`）会作用于 `color` 属性本身，比 `opacity-50` 更不易被父级透明度覆盖（影院态下控制条 `opacity-0` 隐藏时不影响，正常显示时独立控制文字不透明度）。

### 3.2 控制条替换范围

替换覆盖以下区域：

1. **顶部标题行**：视频名称 `text-textcolor` → `chromeFg`。
2. **底部播放控制条**：
   - 左侧「上一集 / 播放或暂停 / 下一集 / 当前时间」组：`text-textcolor` → `chromeFg`；
   - 右侧「选集 / 重置」按钮：`text-textcolor` → `chromeFg`；
   - 「选集」按钮：`text-textcolor` → `chromeFg`；
   - 「倍速」按钮：`text-textcolor` → `chromeFg`；
   - 「音量」按钮：`text-textcolor` → `chromeFg`；
   - 「画中画」按钮：`text-textcolor` → `chromeFg`；
   - 「全屏」按钮：`text-textcolor` → `chromeFg`；
   - 禁用态分支：`text-textcolor/50` → `chromeFgMuted`。

每处替换均采用 `cn('... 基础类 ...', chromeFg)` 形式与原有状态类（如 `safeIndex === 0 && playType !== 'loop'` 禁用态、`chromeHidden && 'opacity-0!'`）组合，不改变现有行为。

## 4. 关键代码对比与注释

### 4.1 派生语义色（`player.tsx` 顶部常量区）

**对比范围**：`theater` / `chromeHidden` 常量之后的新增 `chromeFg` / `chromeFgMuted`。

**改动前** · `apps/micro/src/components/design/VideoPlayer/player.tsx`（基线，约 L1195–L1197）

```typescript
// theater：影院态判定，直接取 isFullscreen（含应用级影院态）
const theater = isFullscreen;
// chromeHidden：控制条是否完全隐藏（非 hover 状态）
const chromeHidden = !chromeOn;
// 旧版未派生 chromeFg，各按钮自行硬编码 text-textcolor
```

**改动后** · `apps/micro/src/components/design/VideoPlayer/player.tsx`（当前，约 L1196–L1200）

```typescript
// theater：影院态判定，直接取 isFullscreen（含应用级影院态）
const theater = isFullscreen;
// chromeHidden：控制条是否完全隐藏（非 hover 状态）
const chromeHidden = !chromeOn;
// 新增：影院态黑底上主题色偏暗，chrome 强制白字，保证控制条图标/文字可见
// 非影院态（日间/彩色主题）继续使用 text-textcolor 语义色，跟主题切换
const chromeFg = theater ? 'text-white' : 'text-textcolor';
// 新增：禁用态 / 次级文字在影院态下用 50% 白，非影院态用 50% text-textcolor
// 使用 color-opacity（text-white/50）而非 opacity-50，避免父级 opacity 干扰
const chromeFgMuted = theater ? 'text-white/50' : 'text-textcolor/50';
```

**变更摘要**：新增两个派生常量，把「影院态 vs 非影院态」的前景色语义抽成统一变量，后续所有控制条复用。

---

### 4.2 顶部标题行（`player.tsx` 顶部视频名）

**对比范围**：视频名称 `<div>` 的 `className` 中 `text-textcolor` 替换为 `chromeFg`。

**改动前** · `apps/micro/src/components/design/VideoPlayer/player.tsx`（基线，约 L1262–L1275）

```tsx
// 顶部标题行：视频名称，text-textcolor 硬编码
<div
	className={cn(
		// 基础排版：左上对齐、单行省略
		'pointer-events-none absolute top-0 left-0 z-2 box-border w-full overflow-hidden p-[9px_10px_0] text-left text-base text-ellipsis whitespace-nowrap text-textcolor',
		// 控制条隐藏时完全透明，不可点击
		chromeHidden && 'pointer-events-none opacity-0!',
	)}
>
	{currentVideoName ? currentVideoName : null}
</div>
```

**改动后** · `apps/micro/src/components/design/VideoPlayer/player.tsx`（当前，约 L1265–L1278）

```tsx
// 顶部标题行：视频名称，改由 chromeFg 派生主题
<div
	className={cn(
		// 基础排版：左上对齐、单行省略（移除旧 text-textcolor）
		'pointer-events-none absolute top-0 left-0 z-2 box-border w-full overflow-hidden p-[9px_10px_0] text-left text-base text-ellipsis whitespace-nowrap',
		// 新增：影院态白字 / 非影院态 text-textcolor
		chromeFg,
		// 控制条隐藏时完全透明，不可点击（保持不变）
		chromeHidden && 'pointer-events-none opacity-0!',
	)}
>
	{currentVideoName ? currentVideoName : null}
</div>
```

**变更摘要**：标题行不再硬编码 `text-textcolor`，改用 `chromeFg`；影院态下视频名变白、在黑底上可见。

---

### 4.3 底部播放控制条（`player.tsx` 播放 / 选集 / 重置等按钮）

**对比范围**：底部左侧「上一集 / 播放或暂停 / 下一集」组、右侧各功能按钮、以及外层包装的 `text-textcolor`。

**改动前** · `apps/micro/src/components/design/VideoPlayer/player.tsx`（基线，约 L1378–L1660）

```tsx
// 底部播放控制条主容器
<div className="relative z-1 my-[15px] flex items-end justify-between">
	// 左侧：上一集 + 播放/暂停 + 下一集 + 当前时间
	<div className="flex items-center text-textcolor">
		// 上一集按钮
		<div className={cn(
			'flex cursor-pointer items-center text-textcolor hover:text-teal-500',
			// 首条且非循环：禁用
			safeIndex === 0 && playType !== 'loop' &&
				'pointer-events-none cursor-not-allowed text-textcolor/50',
		)} onClick={onPrev}>
			<SkipBack size={CTRL_ICON} />
		</div>
		// 播放/暂停按钮（保持 text-textcolor）
		<div className="mx-3 flex cursor-pointer items-center text-textcolor hover:text-teal-500">
			{!playStatus ? <Play size={CTRL_ICON} onClick={onPlay} /> : <Pause size={CTRL_ICON} onClick={onPause} />}
		</div>
		// 下一集按钮
		<div className={cn(
			'flex cursor-pointer items-center text-textcolor hover:text-teal-500',
			safeIndex === videos.length - 1 && playType !== 'loop' &&
				'pointer-events-none cursor-not-allowed text-textcolor/50',
		)} onClick={onNext}>
			<SkipForward size={CTRL_ICON} />
		</div>
		// 当前时间：时间信息
		<div className="m-0 flex items-center text-sm leading-none">{existDuration ? timeInfo : timeInfo.split('/')[0]}</div>
	</div>

	// 右侧：选集 / 重置 / 倍速 / 音量 / 画中画 / 全屏 等，均硬编码 text-textcolor
	<div className="flex items-center gap-[15px]">
		// 选集按钮
		<div className="flex cursor-pointer items-center justify-center text-textcolor hover:text-teal-500" onClick={onEpisodes}>
			<ListVideo size={CTRL_ICON} />
		</div>
		// 重置按钮
		<div className="flex cursor-pointer items-center justify-center text-textcolor hover:text-teal-500" onClick={onReset}>
			<ListRestart size={CTRL_ICON} />
		</div>
		// 倍速、音量、画中画、全屏按钮同构 ...
	</div>
</div>
```

**改动后** · `apps/micro/src/components/design/VideoPlayer/player.tsx`（当前，约 L1378–L1664）

```tsx
// 底部播放控制条主容器
<div className="relative z-1 my-[15px] flex items-end justify-between">
	// 左侧：上一集 + 播放/暂停 + 下一集 + 当前时间
	<div className={cn(
		// 基础布局（移除旧 text-textcolor）
		'flex items-center',
		// 新增：影院态白字 / 非影院态 text-textcolor
		chromeFg,
	)}>
		// 上一集按钮
		<div className={cn(
			// 基础交互：指针光标 + hover 主色
			'flex cursor-pointer items-center hover:text-teal-500',
			// 新增：前景色走 chromeFg
			chromeFg,
			// 首条且非循环：禁用；前景色走 chromeFgMuted（影院态 50% 白、非影院态 50% text-textcolor）
			safeIndex === 0 && playType !== 'loop' &&
				cn('pointer-events-none cursor-not-allowed', chromeFgMuted),
		)} onClick={onPrev}>
			<SkipBack size={CTRL_ICON} />
		</div>
		// 播放/暂停按钮
		<div className={cn(
			// 基础布局
			'mx-3 flex cursor-pointer items-center hover:text-teal-500',
			// 新增：前景色走 chromeFg
			chromeFg,
		)}>
			{!playStatus ? <Play size={CTRL_ICON} onClick={onPlay} /> : <Pause size={CTRL_ICON} onClick={onPause} />}
		</div>
		// 下一集按钮（同上）
		<div className={cn(
			'flex cursor-pointer items-center hover:text-teal-500',
			chromeFg,
			safeIndex === videos.length - 1 && playType !== 'loop' &&
				cn('pointer-events-none cursor-not-allowed', chromeFgMuted),
		)} onClick={onNext}>
			<SkipForward size={CTRL_ICON} />
		</div>
		// 当前时间：继续保留 text-textcolor 语义（由父级 chromeFg 决定）
		<div className="m-0 flex items-center text-sm leading-none">{existDuration ? timeInfo : timeInfo.split('/')[0]}</div>
	</div>

	// 右侧：选集 / 重置 / 倍速 / 音量 / 画中画 / 全屏
	<div className="flex items-center gap-[15px]">
		// 选集按钮：改用 chromeFg
		<div className={cn(
			'flex cursor-pointer items-center justify-center hover:text-teal-500',
			chromeFg,
		)} onClick={onEpisodes}>
			<ListVideo size={CTRL_ICON} />
		</div>
		// 重置按钮：改用 chromeFg
		<div className={cn(
			'flex cursor-pointer items-center justify-center hover:text-teal-500',
			chromeFg,
		)} onClick={onReset}>
			<ListRestart size={CTRL_ICON} />
		</div>
		// 倍速 / 音量 / 画中画 / 全屏按钮：同样用 chromeFg（下同，略）
	</div>
</div>
```

**变更摘要**：所有控制条按钮与容器的 `text-textcolor` 全部替换为 `chromeFg`；禁用态 `text-textcolor/50` 替换为 `chromeFgMuted`；`chromeFg` / `chromeFgMuted` 在影院态返回 `text-white` / `text-white/50`，保证黑底下对比度。

---

## 5. 兼容性与影响

- **日间（非影院态）**：`chromeFg === 'text-textcolor'`、`chromeFgMuted === 'text-textcolor/50'`，与改动前**完全等价**，不影响浅色/深色主题表现。
- **影院态全屏**：`chromeFg === 'text-white'`、`chromeFgMuted === 'text-white/50'`，所有控制条图标/文字在 `bg-black` 背景下可见；禁用态按钮仍可辨识但弱化。
- **画中画 / 迷你播放器**：画中画覆盖层仍用独立的 `bg-theme-background text-textcolor`，未受本次改动影响。
- **控制条隐藏（`chromeHidden`）**：继续用 `opacity-0!` 隐藏，`chromeFg` 不参与显隐判定。

## 6. 风险与回归

建议回归路径：

1. 日间主题下进入视频播放器：控制条所有按钮、标题、禁用态颜色与改动前一致。
2. 切换到深色主题（如支持）：非影院态控制条颜色仍跟随 `text-textcolor`。
3. 进入影院态全屏（`isFullscreen === true`）：
   - 顶部视频标题清晰可见；
   - 底部「上一集 / 播放 / 下一集 / 选集 / 重置 / 倍速 / 音量 / 画中画 / 全屏」按钮图标与文字可见；
   - 首条视频时「上一集」按钮以 50% 白显示、不可点击；末条视频时「下一集」按钮同上；
   - 鼠标悬停时 `hover:text-teal-500` 仍生效。
4. 退出影院态：所有按钮颜色立即切回 `text-textcolor`。
5. 画中画模式：覆盖层 `text-textcolor` 不受影响。

## 7. 相关源码路径

| 说明 | 路径 |
| ---- | ---- |
| `chromeFg` / `chromeFgMuted` 派生常量 | `apps/micro/src/components/design/VideoPlayer/player.tsx` |
| 顶部标题行（`currentVideoName`） | 同上 |
| 底部播放控制条（播放/上一集/下一集/选集/重置等） | 同上 |
| 倍速 / 音量 / 画中画 / 全屏按钮 | 同上 |
| 影院态容器实现 | `apps/frontend/src/plugins/host/PluginHostPage.tsx`（`插件影院全屏.md`） |

---

（若与仓库最新源码不一致，以源码为准）
