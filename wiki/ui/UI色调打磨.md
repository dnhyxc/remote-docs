# UI 配色透明度调优：首页色相 + 全局按钮 + 滚动 FAB

> **文档角色**：统一降低 teal/各色相实色饱和度（`/80` `/90` 透明度），让按钮与首页 hero 色块在浅/深主题下更柔和；全局 `Button` default/outline variant 配色微调；滚动 FAB 尺寸与圆角调整；下拉菜单内容区内边距微调。
> **延伸阅读**：[强调色设置.md](../setting/强调色设置.md)（强调色设置）

## 1. 背景与目标

**问题**：首页 hero 色块与全局 teal 按钮在浅色主题下饱和度过高，视觉过冲；滚动 FAB 圆形过大与英语 Agent 输入框上方的朗读条不协调。

**目标**：
1. 首页 `HUE_STYLES` 五个色相的 `icon` / `btn` 渐变终点加 `/80` `/90` 透明度。
2. 首页 CTA 按钮公共类提取到 `cn()` 首参，减少重复。
3. `Button` default variant 从 `text-default bg-teal-500` 改为 `text-textcolor bg-teal-500/80`；outline 加 `bg-teal-500/10` 底色。
4. `ScrollFab` 尺寸从 `h-8.5 w-8.5 rounded-full` 改为 `h-8 w-8 rounded-md`；english 变体改为更窄的 `h-5 w-8 rounded-sm`。
5. `DropdownMenuContent` 可滚动视口内边距 `p-1` → `p-2`。

## 2. 改动范围

| 路径 | 变更类型 | 说明 |
|------|----------|------|
| `apps/frontend/src/views/home/content.ts` | 修改 | `HUE_STYLES` 五色相 `icon`/`btn` 加透明度 |
| `apps/frontend/src/views/home/index.tsx` | 修改 | CTA 按钮 `className` 重构用 `cn()` 提取公共类（其余为引号统一，格式化不文档化） |
| `apps/frontend/src/components/ui/button.tsx` | 修改 | default / outline variant 配色微调（其余为引号统一，格式化） |
| `apps/frontend/src/components/ui/dropdown-menu.tsx` | 修改 | 可滚动视口 `p-1` → `p-2`（其余为引号统一，格式化） |
| `apps/frontend/src/components/design/Assistant/ScrollFab.tsx` | 修改 | 尺寸/圆角微调（其余为引号统一，格式化） |

> 注：`button.tsx` / `dropdown-menu.tsx` / `home/index.tsx` / `ScrollFab.tsx` 含大量单引号→双引号统一，属纯格式化（`code-before-after.md` §4 例外），本篇仅贴有实质视觉改动的片段。

## 3. 实现思路

| # | 要点 | 说明 |
|---|------|------|
| 1 | 透明度而非改色相 | 保留原色相，仅加 `/80` `/90` alpha，浅主题下更柔和，深主题下差异更小 |
| 2 | CTA 公共类提取 | 主/次按钮共享 `flex h-10 cursor-pointer ...` 公共类提到 `cn()` 首参，差异仅 `font-semibold` vs `font-medium` + hue |
| 3 | default variant 文字色 | `text-default` → `text-textcolor`，避免 default token 在某些主题下与按钮底色对比不足 |
| 4 | outline 加底色 | `bg-teal-500/10` 让 outline 按钮有微弱 teal 倾向，与 default 系列呼应 |
| 5 | ScrollFab 收窄 | english 变体从 `h-8.5 w-8.5 rounded-full` 改 `h-5 w-8 rounded-sm`，贴合朗读悬浮条上方的窄条形态 |

## 4. 关键代码对比与注释

### 4.1 `home/content.ts` — `HUE_STYLES` 色相透明度

**对比范围**：`HUE_STYLES` 常量五色相的 `icon` / `btn` 字段。

**改动前** · `apps/frontend/src/views/home/content.ts`（基线 `HEAD`，约 L37–L68）

```typescript
teal: {
	rail: 'bg-teal-400',
	// 旧版：实色渐变
	icon: 'from-teal-500 to-teal-300 shadow-teal-500/25',
	btn: 'from-teal-400 to-teal-500 hover:shadow-teal-500/30',
	glow: 'from-teal-600/15 via-cyan-500/8',
},
emerald: {
	rail: 'bg-emerald-400',
	// 旧版：实色
	icon: 'from-emerald-400 to-[#14b8a6] shadow-emerald-500/25',
	btn: 'from-emerald-400 to-[#14b8a6] hover:shadow-emerald-500/30',
	glow: 'from-emerald-500/15 via-teal-500/8',
},
amber: {
	rail: 'bg-amber-400',
	// 旧版：实色
	icon: 'from-amber-400 to-orange-500 shadow-amber-500/20',
	btn: 'from-amber-400 to-orange-500 hover:shadow-amber-500/30',
	glow: 'from-amber-500/15 via-orange-500/8',
},
rose: {
	rail: 'bg-rose-400',
	// 旧版：实色
	icon: 'from-rose-400 to-amber-600 shadow-rose-500/20',
	btn: 'from-rose-400 to-amber-600 hover:shadow-rose-500/30',
	glow: 'from-rose-500/15 via-amber-500/8',
},
violet: {
	rail: 'bg-violet-400',
	// 旧版：实色
	icon: 'from-violet-400 to-purple-600 shadow-violet-500/25',
	btn: 'from-violet-400 to-purple-600 hover:shadow-violet-500/30',
	glow: 'from-violet-500/15 via-purple-500/8',
},
```

**改动后** · `apps/frontend/src/views/home/content.ts`（当前，约 L37–L68）

```typescript
teal: {
	rail: 'bg-teal-400',
	// 新版：icon 渐变加 /90 透明度
	icon: 'from-teal-500/90 to-teal-300/90 shadow-teal-500/25',
	// 新版：btn 渐变加 /80 透明度
	btn: 'from-teal-400/80 to-teal-500/80 hover:shadow-teal-500/30',
	glow: 'from-teal-600/15 via-cyan-500/8',
},
emerald: {
	rail: 'bg-emerald-400',
	// 新版：emerald icon 终点改 teal-200/90
	icon: 'from-emerald-400/90 to-teal-200/90 shadow-emerald-500/25',
	// 新版：btn 加 /80
	btn: 'from-emerald-400/80 to-teal-200/80 hover:shadow-emerald-500/30',
	glow: 'from-emerald-500/15 via-teal-500/8',
},
amber: {
	rail: 'bg-amber-400',
	// 新版：icon 加 /90
	icon: 'from-amber-400/90 to-orange-500/90 shadow-amber-500/20',
	// 新版：btn 加 /80
	btn: 'from-amber-400/80 to-orange-500/80 hover:shadow-amber-500/30',
	glow: 'from-amber-500/15 via-orange-500/8',
},
rose: {
	rail: 'bg-rose-400',
	// 新版：icon 加 /90
	icon: 'from-rose-400/90 to-amber-600/90 shadow-rose-500/20',
	// 新版：btn 加 /80
	btn: 'from-rose-400/80 to-amber-600/80 hover:shadow-rose-500/30',
	glow: 'from-rose-500/15 via-amber-500/8',
},
violet: {
	rail: 'bg-violet-400',
	// 新版：icon 加 /90
	icon: 'from-violet-400/90 to-purple-600/90 shadow-violet-500/25',
	// 新版：btn 加 /80
	btn: 'from-violet-400/80 to-purple-600/80 hover:shadow-violet-500/30',
	glow: 'from-violet-500/15 via-purple-500/8',
},
```

**变更摘要**：五色相 `icon` 渐变加 `/90`、`btn` 渐变加 `/80`；emerald 终点由 `to-[#14b8a6]` 改为 `to-teal-200`（统一用 teal 色阶）。

---

### 4.2 `home/index.tsx` — CTA 按钮 `className` 重构

**对比范围**：hero slide CTA 按钮的 `className` 表达式。

**改动前** · `apps/frontend/src/views/home/index.tsx`（基线 `HEAD`，约 L285–L292）

```typescript
// 旧版：className 直接三元，主/次各写一长串公共类
className={
	c.primary
		? `relative flex h-10 cursor-pointer items-center justify-center gap-1.5 overflow-hidden rounded-md bg-linear-to-br px-5 text-sm font-semibold text-textcolor hover:shadow-md transition-[transform,box-shadow] duration-200 ease-out hover:scale-[1.03] active:scale-[0.98] focus-visible:ring-2 focus-visible:ring-teal-400/50 focus-visible:outline-none ${hue.btn}`
		: 'flex h-10 cursor-pointer items-center justify-center gap-1.5 rounded-md border border-theme/5 bg-teal-500/20 px-5 text-sm font-medium text-textcolor backdrop-blur-sm transition-[border-color,background-color] hover:border-theme/10 hover:bg-teal-500/30 focus-visible:ring-2 focus-visible:ring-teal-400/50 focus-visible:outline-none'
}
```

**改动后** · `apps/frontend/src/views/home/index.tsx`（当前，约 L262–L269）

```typescript
// 新版：公共类提到 cn 首参，差异仅 hue.btn + font + 渐变
className={cn(
	// 新版：主/次公共类
	"flex h-10 cursor-pointer items-center justify-center gap-1.5 hover:shadow-md px-5 text-sm rounded-md transition-all duration-200 ease-in-out focus-visible:ring-2 focus-visible:ring-teal-400/50 focus-visible:outline-none hover:scale-[1.03] active:scale-[0.98] ",
	c.primary
		// 新版：主按钮 = hue.btn + 渐变 + font-semibold
		? `${hue.btn} relative bg-linear-to-br font-semibold text-textcolor overflow-hidden`
		// 新版：次按钮 = hue.btn + 渐变 + font-medium（原 border + bg-teal-500/20 改为统一渐变）
		: `${hue.btn} bg-linear-to-br font-medium text-textcolor`,
)}
```

**变更摘要**：主/次 CTA 公共类提取到 `cn()` 首参；次按钮从 `border + bg-teal-500/20` 改为复用 `hue.btn` 渐变（与主按钮同色相不同字重），统一视觉语言。

---

### 4.3 `button.tsx` — default / outline variant 配色

**对比范围**：`buttonVariants` 的 `variant.default` 与 `variant.outline`。

**改动前** · `apps/frontend/src/components/ui/button.tsx`（基线 `HEAD`，约 L8–L13）

```typescript
variant: {
	// 旧版：text-default + 实色 bg-teal-500
	default: 'text-default bg-teal-500 hover:bg-teal-600',
	destructive:
		'bg-destructive text-white hover:bg-destructive/90 ...',
	// 旧版：outline 无底色
	outline:
		'border border-teal-500/20 text-theme shadow-xs hover:bg-teal-500/10 dark:bg-input/30 dark:border-input dark:hover:bg-input/50',
	// ...（其它 variant 未改动）
```

**改动后** · `apps/frontend/src/components/ui/button.tsx`（当前，约 L8–L13）

```typescript
variant: {
	// 新版：text-textcolor + bg-teal-500/80
	default: "text-textcolor bg-teal-500/80 hover:bg-teal-600",
	destructive:
		"bg-destructive text-white hover:bg-destructive/90 ...",
	// 新版：outline 加 bg-teal-500/10 底色 + border-teal-500/80
	outline:
		"border border-teal-500/80 bg-teal-500/10 text-textcolor shadow-xs hover:bg-teal-500/20 dark:bg-input/30 dark:border-input dark:hover:bg-input/50",
	// ...（其它 variant 未改动）
```

**变更摘要**：default 文字色 `text-default` → `text-textcolor`、底色 `bg-teal-500` → `bg-teal-500/80`；outline 边框 `/20` → `/80`、新增 `bg-teal-500/10` 底色、文字 `text-theme` → `text-textcolor`。

---

### 4.4 `dropdown-menu.tsx` — 可滚动视口内边距

**对比范围**：`DropdownMenuContent` 可滚动分支 `viewportClassName`。

**改动前** · `apps/frontend/src/components/ui/dropdown-menu.tsx`（基线 `HEAD`，约 L54）

```typescript
viewportClassName={cn(
	// 旧版：p-1
	'box-border p-1 px-2.5 [&>div]:min-h-0!',
	viewportClassName,
)}
```

**改动后** · `apps/frontend/src/components/ui/dropdown-menu.tsx`（当前，约 L54）

```typescript
viewportClassName={cn(
	// 新版：p-2（上下内边距加大）
	"box-border p-2 px-2.5 [&>div]:min-h-0!",
	viewportClassName,
)}
```

**变更摘要**：可滚动下拉菜单视口上下内边距 `p-1` → `p-2`，菜单项上下留白增加。

---

### 4.5 `ScrollFab.tsx` — 尺寸与圆角

**对比范围**：`ScrollFab` 组件 `button` 的 `className`。

**改动前** · `apps/frontend/src/components/design/Assistant/ScrollFab.tsx`（基线 `HEAD`，约 L10–L16）

```typescript
className={cn(
	// 旧版：h-8.5 w-8.5 rounded-full
	'absolute right-4 z-10 flex h-8.5 w-8.5 cursor-pointer items-center justify-center rounded-full border border-theme/5 bg-theme/5 text-textcolor/70 backdrop-blur-[2px] hover:bg-theme/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-theme/40',
	// 旧版：default 变体
	variant === 'default' && 'bottom-[calc(100%+1.05rem)]',
	// 旧版：english 变体 h-8.5 w-8.5 rounded-full
	variant === 'english' &&
		'bottom-full mb-3.5 focus-visible:ring-theme/40',
)}
```

**改动后** · `apps/frontend/src/components/design/Assistant/ScrollFab.tsx`（当前，约 L10–L16）

```typescript
className={cn(
	// 新版：h-8 w-8 rounded-md（收窄 + 方角）
	"absolute right-4.5 z-10 flex h-8 w-8 cursor-pointer items-center justify-center rounded-md border border-theme/5 bg-theme/5 text-textcolor/70 shadow-md backdrop-blur-sm hover:bg-theme/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-theme/40",
	// 新版：default 变体间距微调
	variant === "default" && "bottom-[calc(100%+1.12rem)]",
	// 新版：english 变体改为 h-5 w-8 rounded-sm（窄条）
	variant === "english" &&
		"bottom-[calc(100%+1.95rem)] h-5 w-8 rounded-sm focus-visible:ring-theme/40",
)}
```

**变更摘要**：FAB 从 `h-8.5 w-8.5 rounded-full` 收为 `h-8 w-8 rounded-md`，加 `shadow-md`；english 变体进一步收为 `h-5 w-8 rounded-sm`，贴合朗读悬浮条上方的窄条形态；`right-4` → `right-4.5`。

## 5. 兼容性与影响

| 项目 | 说明 |
|------|------|
| 主题适配 | 透明度在浅/深主题下均生效；深主题下差异较小 |
| 全局按钮 | default / outline variant 配色变化影响所有使用方；其余 variant 不变 |
| 首页 CTA | 次按钮从 border+底色改为渐变，视觉与主按钮统一 |
| 滚动 FAB | english 变体尺寸变窄，需确认点击热区仍足够 |

## 6. 风险与回归清单

| 风险 | 排查 |
|------|------|
| default 按钮对比度 | `text-textcolor` on `bg-teal-500/80` 在浅主题下对比是否足够 |
| outline 按钮过亮 | `bg-teal-500/10` 在深主题下是否过亮 |
| CTA 次按钮辨识度 | 主/次均用渐变后，次按钮是否仍能区分（靠 font-weight） |
| FAB 点击热区 | english 变体 `h-5` 较窄，确认可点中 |

建议回归：
1. 首页 hero 五色相轮播：icon 与按钮饱和度柔和
2. 全站 default 按钮：文字可读、hover 正常
3. outline 按钮：有微弱底色、hover 加深
4. 下拉菜单：项上下留白增加
5. 英语 Agent 滚动 FAB：窄条形态、可点击

## 7. 相关源码路径

| 说明 | 路径 |
|------|------|
| 首页色相 | `apps/frontend/src/views/home/content.ts` |
| 首页 CTA | `apps/frontend/src/views/home/index.tsx` |
| 全局按钮 | `apps/frontend/src/components/ui/button.tsx` |
| 下拉菜单 | `apps/frontend/src/components/ui/dropdown-menu.tsx` |
| 滚动 FAB | `apps/frontend/src/components/design/Assistant/ScrollFab.tsx` |

---

（若与仓库最新源码不一致，以源码为准）
