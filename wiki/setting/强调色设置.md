# 主题色（强调色）可配置系统

## 1. 背景与目标

此前全站的交互强调色（hover、选中、链接、按钮等）硬编码为 Tailwind 默认 `teal-*` 色板，用户无法更换；而彩色主题（white/dark/red/beige…）只决定背景与文字色相，与强调色耦合度低。

本轮新增一套**与彩色主题正交**的「主题色（强调色）」体系：在 **设置 → 主题** 页提供 10 色预设，用户切换后全站 `text-teal-*` / `bg-teal-*` 等类随主题色变化；同时为**不应跟随**的「原版 teal」装饰区（首页渐变按钮、英语学习侧栏渐变、单词资料流式进度条、词包数量按钮）做硬编码豁免，避免被全局覆盖误伤。

**用户视角**：进入 **设置 → 主题**，在「主题色设置」区点选任一颜色，hover/选中/链接等交互强调色即时全站生效，并按账号持久化、跨端同步；刷新或重启不会闪回默认 teal。

## 2. 改动范围

- `apps/frontend/src/hooks/theme.ts`：新增 `ACCENT_COLORS`、`accentBadgeFg`、`applyAccentToDocument` 等，`useTheme` 增加 `accent` / `changeAccent`。
- `apps/frontend/index.html`：首屏脚本新增主题色 bootstrap，防首帧 teal 闪一下。
- `apps/frontend/src/index.css`：`:root` 新增 `--brand-accent*` 默认值；覆盖 Tailwind `--color-teal-300/400/500/600`；听写练习条渐变改用主题色变量。
- `apps/frontend/src/views/setting/theme/index.tsx`：新增主题色选择器区块；预览区强调色行改用 `--brand-accent` / `text-teal-500`。
- `apps/frontend/src/i18n/locales/zh-CN.ts`、`en-US.ts`：新增 10 色名称与描述、预览文案。
- `apps/frontend/src/views/home/index.tsx`：首页快速开始按钮、对话卡片等原版 teal 改为固定 hex 豁免。
- `apps/frontend/src/views/englishLearning/sidebar/sidebarAccents.ts`：侧栏渐变 `teal-*` 改固定 hex。
- `apps/frontend/src/views/englishLearning/pack/components/PackStreamLiveLink.tsx`、`PackStreamProgress.tsx`：单词资料流式条 `teal-*` 改固定 hex。
- `apps/frontend/src/views/englishLearning/sections/vocabulary/index.tsx`：词包数量按钮 `teal-*` 改固定 hex。

## 3. 实现思路

- **CSS 变量单点覆盖**：在 `:root` 定义 `--brand-accent` 及 `soft/light/dark` 派生（用 `color-mix(in oklch, …)` 现场调亮/调暗），再把 Tailwind 的 `--color-teal-300/400/500/600` 重指到这些变量。这样全站既有的 `text-teal-500` / `bg-teal-500/15` / `hover:text-teal-400` 等类**无需改动**即跟随主题色，改动面最小。
- **三处写入同一套变量**：首屏 `index.html` 内联脚本、`useTheme` 的 `useEffect` 初始化、`changeAccent` 三处都调用同一组 `--brand-accent*` 赋值，保证「首帧 / React 挂载 / 用户切换」三阶段一致。
- **首帧防闪**：主题色与彩色主题一样存在「刷新后 React 晚于首帧」问题。新增 `dnhyxc_accent_bootstrap` localStorage 键，首屏脚本先读它（回退 `dnhyxc_settings_json.accentColor`）写变量，`useTheme` 挂载后再用 Tauri store 校正。
- **与彩色主题正交**：彩色主题仍走 `body.theme-xxx` class + `--theme-*`；主题色独立走 `--brand-accent*`，互不干扰。
- **原版 teal 豁免**：首页渐变按钮、英语学习侧栏渐变、单词资料流式条等「设计上就是 teal」的装饰区，若被全局覆盖会随用户选色变粉/变黄，破坏视觉。这些点改为写死 `#14b8a6` / `#0d9488` / `#2dd4bf` 等 Tailwind 默认 teal hex（任意值类 `bg-[#14b8a6]`），绕开 `--color-teal-*` 覆盖。
- **徽章字色自动对比**：`accentBadgeFg` 按标准亮度公式（`r*299+g*587+b*114)/1000`）判断深底白字 / 浅底深字，保证 10 色预设的 hex 徽章都可读。
- **持久化与跨端同步**：`changeAccent` 写入 Tauri store `accentColor` 键（与 `themeType` 并列），换设备登录同一账号可同步；同时写 localStorage bootstrap 供首帧使用。

## 4. 关键代码对比与注释

### 4.1 `ACCENT_COLORS` 预设表与 `accentBadgeFg`（新增）

**对比范围**：`apps/frontend/src/hooks/theme.ts` 中新增的 `ACCENT_COLORS` 常量与 `accentBadgeFg` 函数。基线中不存在，属纯新增。

**改动后** · `apps/frontend/src/hooks/theme.ts`（新增，约 L80–L168）

```typescript
// 交互强调色预设表：与彩色主题正交，默认 teal-500；id 与 hex 一一对应
export const ACCENT_COLORS = [
// 第一项：默认 teal，hex 取 Tailwind 默认 teal-500
	{
// 颜色 id，写入 Tauri store accentColor 与 localStorage bootstrap
		id: 'teal',
// 该色 hex，写入 --brand-accent 与徽章底色
		hex: '#14B8A6',
// 中文兜底标签（i18n 缺失时显示）
		label: '默认',
// i18n 名称 key，设置页优先取此值
		labelKey: 'setting.theme.accent.teal',
// i18n 描述 key，设置页副文案
		descKey: 'setting.theme.accent.teal.desc',
// 闭合 teal 项
	},
// 第二项：青柠，亮色底，徽章字色将走深字
	{
// 颜色 id
		id: 'yuebai',
// 该色 hex
		hex: '#B9D731',
// 中文兜底标签
		label: '青柠',
// i18n 名称 key
		labelKey: 'setting.theme.accent.yuebai',
// i18n 描述 key
		descKey: 'setting.theme.accent.yuebai.desc',
// 闭合 yuebai 项
	},
// ...（中间 zhizi / xueqing / canglang / wuxin / yushi / tuoyan 共 6 色结构同上，见源码 L100–L133）
// 倒数第二项：松花，浅色底
	{
// 颜色 id
		id: 'xicao',
// 该色 hex
		hex: '#EBEFBA',
// 中文兜底标签
		label: '松花',
// i18n 名称 key
		labelKey: 'setting.theme.accent.xicao',
// i18n 描述 key
		descKey: 'setting.theme.accent.xicao.desc',
// 闭合 xicao 项
	},
// 末项：苍翠，深色底，徽章字色将走白字
	{
// 颜色 id
		id: 'qiansui',
// 该色 hex
		hex: '#1F3028',
// 中文兜底标签
		label: '苍翠',
// i18n 名称 key
		labelKey: 'setting.theme.accent.qiansui',
// i18n 描述 key
		descKey: 'setting.theme.accent.qiansui.desc',
// 闭合 qiansui 项
	},
// as const：收紧字面量类型，便于下方 AccentId 推导
] as const;
// 徽章字色：按标准亮度公式返回白字或深字，保证 hex 徽章可读
export function accentBadgeFg(hex: string): '#fff' | '#1a1a1a' {
// 去掉 # 前缀，取 6 位 hex 段
	const h = hex.replace('#', '');
// 短码或异常值回退深字
	if (h.length < 6) return '#1a1a1a';
// 解析红通道（0–255）
	const r = Number.parseInt(h.slice(0, 2), 16);
// 解析绿通道
	const g = Number.parseInt(h.slice(2, 4), 16);
// 解析蓝通道
	const b = Number.parseInt(h.slice(4, 6), 16);
// 加权亮度 < 160 视为深底，返回白字；否则深字
	return (r * 299 + g * 587 + b * 114) / 1000 < 160 ? '#fff' : '#1a1a1a';
// 闭合 accentBadgeFg
}
// 主题色 id 联合类型，供 useTheme 状态与 changeAccent 入参约束
export type AccentId = (typeof ACCENT_COLORS)[number]['id'];
// 默认主题色 id，首帧与回退用
const DEFAULT_ACCENT_ID: AccentId = 'teal';
```

**变更摘要**：新增 10 色预设表、徽章字色工具函数、`AccentId` 类型与默认 id；为后续 `useTheme` 与设置页提供数据源。

### 4.2 主题色应用与首帧读取函数（新增）

**对比范围**：`apps/frontend/src/hooks/theme.ts` 中新增的 `applyAccentToDocument`、`resolveAccentId`、`persistAccentBootstrap`、`readAccentBootstrapSync`。基线中不存在，属纯新增。

**改动后** · `apps/frontend/src/hooks/theme.ts`（新增，约 L173–L231）

```typescript
// 主题色 bootstrap localStorage 键，与 theme 并列，防首帧 teal 闪一下
export const ACCENT_BOOTSTRAP_STORAGE_KEY = 'dnhyxc_accent_bootstrap';
// 写入主题色 bootstrap：私密模式等场景忽略异常
function persistAccentBootstrap(accentId: AccentId) {
// try 块：写 localStorage 可能抛错（私密模式等）
	try {
// 把当前 accentId 写入 localStorage，供下次首帧读取
		localStorage.setItem(ACCENT_BOOTSTRAP_STORAGE_KEY, accentId);
// catch 块：忽略异常
	} catch {
// 私密模式等场景忽略
	}
// 闭合 persistAccentBootstrap
}
// 校验原始字符串是否为合法 AccentId，合法则返回，否则 null
function resolveAccentId(raw: string | null | undefined): AccentId | null {
// 空值直接返回 null
	if (!raw) return null;
// 在预设表中能找到则视为合法，断言为 AccentId
	return ACCENT_COLORS.some((c) => c.id === raw) ? (raw as AccentId) : null;
// 闭合 resolveAccentId
}
// 将主题色写入 html 根元素：--brand-accent 及 soft/light/dark 派生
export function applyAccentToDocument(accentId: AccentId) {
// 按 id 查预设，找不到回退默认 teal
	const item =
// 在预设表中按 id 查找
		ACCENT_COLORS.find((c) => c.id === accentId) ??
// 回退到默认 teal 项（非空断言保证存在）
		ACCENT_COLORS.find((c) => c.id === DEFAULT_ACCENT_ID)!;
// 取 html 根元素，CSS 变量挂在 :root
	const root = document.documentElement;
// 主色变量，覆盖 :root 默认值
	root.style.setProperty('--brand-accent', item.hex);
// soft 派生：主色混 55% 白，对应 teal-300 档
	root.style.setProperty(
// soft 变量名
		'--brand-accent-soft',
// 用 color-mix 现场混色
		`color-mix(in oklch, ${item.hex} 55%, white)`,
// 闭合 setProperty 调用
	);
// light 派生：主色混 75% 白，对应 teal-400 档
	root.style.setProperty(
// light 变量名
		'--brand-accent-light',
// 用 color-mix 现场混色
		`color-mix(in oklch, ${item.hex} 75%, white)`,
// 闭合 setProperty 调用
	);
// dark 派生：主色混 85% 黑，对应 teal-600 档
	root.style.setProperty(
// dark 变量名
		'--brand-accent-dark',
// 用 color-mix 现场混色
		`color-mix(in oklch, ${item.hex} 85%, black)`,
// 闭合 setProperty 调用
	);
// 闭合 applyAccentToDocument
}
// 同步读取首帧主题色：bootstrap 键优先，回退 settings_json.accentColor
function readAccentBootstrapSync(): AccentId | null {
// SSR 或无 window 直接返回 null
	if (typeof window === 'undefined') return null;
// try 块：读 localStorage / JSON.parse 可能抛错
	try {
// 先读 bootstrap 键并校验
		const b = resolveAccentId(
// 从 localStorage 取 bootstrap 键值
			localStorage.getItem(ACCENT_BOOTSTRAP_STORAGE_KEY),
// 闭合 resolveAccentId 调用
		);
// 命中则返回
		if (b) return b;
// 否则读 settings_json 兼容旧路径
		const j = localStorage.getItem('dnhyxc_settings_json');
// 无则返回 null
		if (!j) return null;
// 解析 JSON，仅取 accentColor 字段
		const o = JSON.parse(j) as { accentColor?: string };
// 校验并返回
		return resolveAccentId(o.accentColor);
// catch 块：解析异常回退 null
	} catch {
// 解析异常回退 null
		return null;
	}
// 闭合 readAccentBootstrapSync
}
```

**变更摘要**：新增主题色 CSS 变量写入函数、id 校验、bootstrap 持久化与首帧读取；与既有 `persistThemeBootstrap` / `readThemeBootstrapSync` 对称。

### 4.3 `useTheme` hook：状态、初始化与 `changeAccent`

**对比范围**：`apps/frontend/src/hooks/theme.ts` 中 `useTheme` 的 `useState` 初值、`useEffect` 初始化、`changeAccent` 与返回对象。改动前无 `accent` 相关逻辑。

**改动前** · `apps/frontend/src/hooks/theme.ts`（基线，约 L175–L205、L299）

```typescript
// useTheme hook：提供主题 state 与切换方法（旧版无主题色）
export const useTheme = () => {
// 主题 state：首帧同步读 bootstrap，回退 white
	const [theme, setTheme] = useState<ThemeName>(
// useState 惰性初值：同步读 bootstrap，无则 white
		() => readThemeBootstrapSync() ?? 'white',
// 闭合 useState 调用
	);
// 挂载时同步主题并异步从 Tauri store 校正
	useEffect(() => {
// 启动时先把当前主题应用到 body，否则默认 white 不会写入 body class
		setThemeClass(theme);
// 持久化主题 bootstrap 供下次首帧
		persistThemeBootstrap(theme);
// 异步初始化主题（URL 优先，否则读 store）
		const initTheme = async () => {
// URL 优先：分享链接带 ?theme=，浏览器无 store 也能对齐
			if (typeof window !== 'undefined') {
// 解析 URL 中的 theme 参数
				const fromUrl = parseThemeFromSearch(window.location.search);
// 命中则采用 URL 主题，不再读 store
				if (fromUrl) {
// 更新 state
					setTheme(fromUrl);
// 写 body class
					setThemeClass(fromUrl);
// 持久化 bootstrap
					persistThemeBootstrap(fromUrl);
// 命中 URL 主题后直接返回，不读 store
					return;
// 闭合 if (fromUrl)
				}
// 闭合 if (typeof window)
			}
// 读 Tauri store 的 themeType
			const themeType = (await getValue('themeType')) as ThemeName;
// 查预设表确认是否彩色主题
			const themeItem = THEMES.find((t) => t.name === themeType);
// 仅彩色主题才覆盖 state（white/dark 走默认）
			const isColorTheme = themeItem?.type === 'color';
// 是彩色主题且有值时覆盖
			if (isColorTheme && themeType) {
// 更新 state
				setTheme(themeType);
// 写 body class
				setThemeClass(themeType);
// 持久化 bootstrap
				persistThemeBootstrap(themeType);
// 闭合 if (isColorTheme)
			}
// 闭合 initTheme
		};
// 触发异步初始化
		initTheme();
// 闭合 useEffect，仅挂载时执行一次
	}, []);

// ...（中间 setThemeClass / applyThemeVariables / changeTheme 与本轮无关，略）
// 旧版返回对象：仅主题相关三项
	return { theme, changeTheme, themes: THEMES };
// 闭合 useTheme
};
```

**改动后** · `apps/frontend/src/hooks/theme.ts`（当前，约 L317–L323、L325–L364、L456–L473）

```typescript
// useTheme hook：提供主题与主题色 state 及切换方法
export const useTheme = () => {
// 主题 state：首帧同步读 bootstrap，回退 white
	const [theme, setTheme] = useState<ThemeName>(
// useState 惰性初值：同步读 bootstrap，无则 white
		() => readThemeBootstrapSync() ?? 'white',
// 闭合 useState 调用
	);
// 新增主题色 state：首帧同步读 bootstrap，回退默认 teal
	const [accent, setAccent] = useState<AccentId>(
// useState 惰性初值：同步读 bootstrap，无则默认 teal
		() => readAccentBootstrapSync() ?? DEFAULT_ACCENT_ID,
// 闭合 useState 调用
	);
// 挂载时同步主题/主题色并异步从 Tauri store 校正
	useEffect(() => {
// 启动时先把当前主题应用到 body，否则默认 white 不会写入 body class
		setThemeClass(theme);
// 持久化主题 bootstrap 供下次首帧
		persistThemeBootstrap(theme);
// 同步把当前主题色写变量，避免挂载阶段仍是默认 teal
		applyAccentToDocument(accent);
// 持久化主题色 bootstrap，供下次首帧
		persistAccentBootstrap(accent);
// 异步初始化主题与主题色（URL 优先，否则读 store）
		const initTheme = async () => {
// URL 优先：分享链接带 ?theme=，浏览器无 store 也能对齐
			const fromUrl =
// 有 window 时解析 URL theme 参数，否则 null
				typeof window !== 'undefined'
					? parseThemeFromSearch(window.location.search)
					: null;
// 命中 URL 主题则采用，不再读 store 主题
			if (fromUrl) {
// 更新 state
				setTheme(fromUrl);
// 写 body class
				setThemeClass(fromUrl);
// 持久化 bootstrap
				persistThemeBootstrap(fromUrl);
// 否则未命中 URL，读 Tauri store 主题
			} else {
// 读 Tauri store 的 themeType
				const themeType = (await getValue('themeType')) as ThemeName;
// 查预设表确认是否彩色主题
				const themeItem = THEMES.find((t) => t.name === themeType);
// 仅彩色主题才覆盖 state（white/dark 走默认）
				if (themeItem?.type === 'color' && themeType) {
// 更新 state
					setTheme(themeType);
// 写 body class
					setThemeClass(themeType);
// 持久化 bootstrap
					persistThemeBootstrap(themeType);
// 闭合 if (彩色主题)
				}
// 闭合 else
			}
// 读 Tauri store 的 accentColor 并校验
			const storedAccent = resolveAccentId(
// 从 Tauri store 取 accentColor 值
				(await getValue('accentColor')) as string | undefined,
// 闭合 resolveAccentId 调用
			);
// 命中则覆盖 state、写变量、持久化 bootstrap
			if (storedAccent) {
// 更新主题色 state 触发组件重渲
				setAccent(storedAccent);
// 立即写 CSS 变量
				applyAccentToDocument(storedAccent);
// 写 bootstrap 供下次首帧
				persistAccentBootstrap(storedAccent);
// 闭合 if (storedAccent)
			}
// 闭合 initTheme
		};
// 触发异步初始化（void 显式忽略 Promise）
		void initTheme();
// 闭合 useEffect，仅挂载时执行一次
	}, []);

// ...（中间 setThemeClass / applyThemeVariables / changeTheme 与本轮无关，略）
// 新增主题色切换：校验合法后写 state、变量、bootstrap、Tauri store
	const changeAccent = async (accentId: AccentId) => {
// 查预设表，非法 id 直接返回
		const item = ACCENT_COLORS.find((c) => c.id === accentId);
// 非法 id 不处理
		if (!item) return;
// 更新 state 触发组件重渲
		setAccent(accentId);
// 立即写 CSS 变量，全站 teal-* 即时跟随
		applyAccentToDocument(accentId);
// 写 bootstrap 供下次首帧
		persistAccentBootstrap(accentId);
// 写 Tauri store，跨端同步
		await setValue('accentColor', accentId);
// 闭合 changeAccent
	};
// 返回对象新增 accent / changeAccent / accents 三项
	return {
// 当前主题名
		theme,
// 主题切换方法
		changeTheme,
// 彩色主题预设表
		themes: THEMES,
// 当前主题色 id
		accent,
// 主题色切换方法
		changeAccent,
// 主题色预设表
		accents: ACCENT_COLORS,
// 闭合返回对象
	};
// 闭合 useTheme
};
```

**变更摘要**：`useTheme` 新增 `accent` state、挂载时同步写变量与 bootstrap、异步从 Tauri store 校正、`changeAccent` 切换方法，返回对象暴露 `accent` / `changeAccent` / `accents`。

### 4.4 首屏脚本 `index.html`

**对比范围**：`apps/frontend/index.html` 内联首屏脚本，新增 `ACCENT_HEX` 表、`accentFromStorage` 读取与 `--brand-accent*` 赋值。改动前仅处理彩色主题。

**改动前** · `apps/frontend/index.html`（基线，约 L206–L240）

```html
// 彩色主题白名单（1 表示合法）
                                var COLOR_THEMES = {
// dark 主题合法
                                        dark: 1,
// red 主题合法
                                        red: 1,
// beige 主题合法
                                        beige: 1,
// 闭合 COLOR_THEMES
                                };
// fromSearch：解析 URL ?theme= 参数
                                function fromSearch() {
// ...（解析 URL ?theme=，与本轮无关，略）
                                }
// ...（fromStorage 读 localStorage 主题，与本轮无关，略）
// 取主题：URL 优先，否则 localStorage
                                var theme = fromSearch() || fromStorage();
// 命中主题时给 body 加 class
                                if (theme) {
// 给 body 加 theme-xxx class
                                        document.body.classList.add(`theme-${theme}`);
// 闭合 if (theme)
                                }
```

**改动后** · `apps/frontend/index.html`（当前，约 L206–L255）

```html
// 彩色主题白名单（1 表示合法）
                                var COLOR_THEMES = {
// dark 主题合法
                                        dark: 1,
// red 主题合法
                                        red: 1,
// beige 主题合法
                                        beige: 1,
// 闭合 COLOR_THEMES
                                };
// 与 ACCENT_COLORS.id 保持一致的 hex 映射，供首帧写变量
                                var ACCENT_HEX = {
// 默认 teal
                                        teal: "#14B8A6",
// 青柠
                                        yuebai: "#B9D731",
// 桃红
                                        zhizi: "#EB507E",
// 靛青
                                        xueqing: "#1361AB",
// 赭石
                                        canglang: "#B95036",
// 缃黄
                                        wuxin: "#F2CE2B",
// 杏橙
                                        yushi: "#F09C5A",
// 黛青
                                        tuoyan: "#21373D",
// 松花
                                        xicao: "#EBEFBA",
// 苍翠
                                        qiansui: "#1F3028",
// 闭合 ACCENT_HEX
                                };
// fromSearch：解析 URL ?theme= 参数
                                function fromSearch() {
// ...（解析 URL ?theme=，与本轮无关，略）
                                }
// 新增 accentFromStorage：从 localStorage 读主题色 id
                                function accentFromStorage() {
// try 块：读 localStorage / JSON.parse 可能抛错
                                        try {
// 先读 bootstrap 键
                                                const b = localStorage.getItem("dnhyxc_accent_bootstrap");
// 命中合法 id 则返回
                                                if (b && ACCENT_HEX[b]) return b;
// 否则读 settings_json 兼容旧路径
                                                const j = localStorage.getItem("dnhyxc_settings_json");
// 无则返回 null
                                                if (!j) return null;
// 解析 JSON
                                                const o = JSON.parse(j);
// 取 accentColor 字段
                                                const a = o?.accentColor;
// 合法则返回，否则 null
                                                return typeof a === "string" && ACCENT_HEX[a] ? a : null;
// catch 块：解析异常回退 null
                                        } catch (_e) {
// 解析异常回退 null
                                                return null;
                                        }
// 闭合 accentFromStorage
                                }
// 取主题：URL 优先，否则 localStorage
                                var theme = fromSearch() || fromStorage();
// 命中主题时给 body 加 class
                                if (theme) {
// 给 body 加 theme-xxx class
                                        document.body.classList.add(`theme-${theme}`);
// 闭合 if (theme)
                                }
// 主题色 id：bootstrap 命中或回退默认 teal
                                var accentId = accentFromStorage() || "teal";
// 取对应 hex，找不到回退 teal
                                var hex = ACCENT_HEX[accentId] || ACCENT_HEX.teal;
// 取 html 根元素，CSS 变量挂在 :root
                                var root = document.documentElement;
// 主色变量，覆盖 :root 默认值
                                root.style.setProperty("--brand-accent", hex);
// soft 派生：主色混 55% 白
                                root.style.setProperty(
// soft 变量名
                                        "--brand-accent-soft",
// 用 color-mix 现场混色
                                        "color-mix(in oklch, " + hex + " 55%, white)",
// 闭合 setProperty 调用
                                );
// light 派生：主色混 75% 白
                                root.style.setProperty(
// light 变量名
                                        "--brand-accent-light",
// 用 color-mix 现场混色
                                        "color-mix(in oklch, " + hex + " 75%, white)",
// 闭合 setProperty 调用
                                );
// dark 派生：主色混 85% 黑
                                root.style.setProperty(
// dark 变量名
                                        "--brand-accent-dark",
// 用 color-mix 现场混色
                                        "color-mix(in oklch, " + hex + " 85%, black)",
// 闭合 setProperty 调用
                                );
```

**变更摘要**：首屏脚本镜像 `ACCENT_COLORS` 的 hex 表，在 React 挂载前先把 `--brand-accent*` 写到 `:root`，消除首帧 teal 闪烁；与 `useTheme` 挂载后的校正形成接力。

### 4.5 CSS 变量默认值与 teal 覆盖 `index.css`

**对比范围**：`apps/frontend/src/index.css` 的 `:root` 段、Tailwind teal 色变量覆盖段、听写练习条渐变。改动前 `:root` 无 `--brand-accent*`，teal 走 Tailwind 默认值，听写条用固定 rgb。

**改动前** · `apps/frontend/src/index.css`（基线，约 L410–L412、L1230–L1235、L1340–L1345）

```css
/* :root 变量段（旧版无 --brand-accent*） */
:root {
/* 旧版 :root 无 --brand-accent* 变量 */
	--background: oklch(1 0 0);
/* 正文前景色 */
	--foreground: oklch(0.13 0.028 261.692);
/* ...（其余 :root 变量与本轮无关，略） */
/* 闭合 :root */
}
/* ...（主题变量声明段，旧版未覆盖 --color-teal-*，略） */
/* sidebar ring 色 */
	--color-sidebar-ring: var(--sidebar-ring);
/* 旧版未覆盖 --color-teal-*，全站 text-teal-* 走 Tailwind 默认值 */
	--color-theme: var(--theme-color);
/* ...（其余主题映射与本轮无关，略） */
/* 听写练习条渐变：旧版写死 teal rgb */
	background: linear-gradient(
/* 渐变方向：自下而上 */
		to top,
/* 底部：teal-600 半透明 */
		rgb(13 148 136 / 0.5),
/* 顶部：teal-300 高透明 */
		rgb(94 234 212 / 0.9)
/* 闭合 linear-gradient */
	);
```

**改动后** · `apps/frontend/src/index.css`（当前，约 L410–L418、L1230–L1238、L1340–L1345）

```css
/* :root 变量段（新增 --brand-accent* 默认值） */
:root {
/* 主题色默认 teal-500；由 useTheme.changeAccent / 首屏脚本覆盖 */
	--brand-accent: #14b8a6;
/* soft 派生：主色混 55% 白，对应 teal-300 档 */
	--brand-accent-soft: color-mix(in oklch, var(--brand-accent) 55%, white);
/* light 派生：主色混 75% 白，对应 teal-400 档 */
	--brand-accent-light: color-mix(in oklch, var(--brand-accent) 75%, white);
/* dark 派生：主色混 85% 黑，对应 teal-600 档 */
	--brand-accent-dark: color-mix(in oklch, var(--brand-accent) 85%, black);
/* 页面背景 */
	--background: oklch(1 0 0);
/* 正文前景色 */
	--foreground: oklch(0.13 0.028 261.692);
/* ...（其余 :root 变量与本轮无关，略） */
/* 闭合 :root */
}
/* ...（主题变量声明段，下方新增 teal 覆盖，略） */
/* sidebar ring 色 */
	--color-sidebar-ring: var(--sidebar-ring);
/* 覆盖 Tailwind 默认 teal-300，使 text-teal-300 跟随主题色 soft 档 */
	--color-teal-300: var(--brand-accent-soft);
/* 覆盖 Tailwind 默认 teal-400，使 text-teal-400 跟随主题色 light 档 */
	--color-teal-400: var(--brand-accent-light);
/* 覆盖 Tailwind 默认 teal-500，使 text-teal-500 跟随主题色主色 */
	--color-teal-500: var(--brand-accent);
/* 覆盖 Tailwind 默认 teal-600，使 text-teal-600 跟随主题色 dark 档 */
	--color-teal-600: var(--brand-accent-dark);
/* theme 色映射 */
	--color-theme: var(--theme-color);
/* ...（其余主题映射与本轮无关，略） */
/* 听写练习条渐变：改用主题色变量，随主题色变化 */
	background: linear-gradient(
/* 渐变方向：自下而上 */
		to top,
/* 底部：主题色 dark 档 50% 透明 */
		color-mix(in oklch, var(--brand-accent-dark) 50%, transparent),
/* 顶部：主题色 light 档 90% 透明 */
		color-mix(in oklch, var(--brand-accent-light) 90%, transparent)
/* 闭合 linear-gradient */
	);
```

**变更摘要**：`:root` 增 `--brand-accent*` 默认值；主题段把 Tailwind `--color-teal-300/400/500/600` 重指到主题色变量；听写练习条渐变改用 `color-mix` + 主题色变量。

### 4.6 设置页主题色选择器与预览 `setting/theme/index.tsx`

**对比范围**：`apps/frontend/src/views/setting/theme/index.tsx` 的 import、`Theme` 组件 `useTheme` 解构、新增主题色选择器区块、预览区强调色行。改动前无主题色选择器，预览强调色行用 `--theme-color` / `text-theme`。

**改动前** · `apps/frontend/src/views/setting/theme/index.tsx`（基线，约 L1–L4、L34、L141–L145）

```typescript
// 旧版 import：仅 THEMES / useI18n / useTheme
import { THEMES, useI18n, useTheme } from '@/hooks';
// ...（StyleRow 等与本轮无关，略）
// Theme 组件：主题设置页
const Theme = () => {
// 旧版仅解构 theme / changeTheme
	const { theme, changeTheme } = useTheme();
// 取 i18n 翻译函数
	const { t } = useI18n();
// ...（彩色主题选择区与预览区，略）
// 预览区强调色行（旧版用 --theme-color）
							<StyleRow
/* 预览强调色标题 */
								title={t('setting.theme.preview.accent.title')}
/* 旧版强调色行用 --theme-color 变量名 */
								varName="--theme-color"
/* 旧版 classHint 指向 text-theme */
								classHint="· text-theme"
/* 闭合 StyleRow 开始标签 */
							>
/* 旧版强调色示例用 text-theme */
								<p className="font-medium text-theme">
/* 预览强调色描述文案 */
									{t('setting.theme.preview.accent.desc')}
/* 闭合 p 标签 */
								</p>
/* 闭合 StyleRow */
							</StyleRow>
```

**改动后** · `apps/frontend/src/views/setting/theme/index.tsx`（当前，约 L1–L11、L43–L44、L91–L137、L196–L202）

```typescript
// 新增 import：ACCENT_COLORS / accentBadgeFg；cn 用于条件类
import {
// 主题色预设表
	ACCENT_COLORS,
// 徽章字色工具函数
	accentBadgeFg,
// 彩色主题预设表
	THEMES,
// i18n hook
	useI18n,
// 主题 hook
	useTheme,
// 闭合 import
} from '@/hooks';
// cn：条件类拼接工具
import { cn } from '@/lib/utils';
// ...（StyleRow 等与本轮无关，略）
// Theme 组件：主题设置页（新增主题色选择器）
const Theme = () => {
// 新增解构 accent / changeAccent
	const { theme, changeTheme, accent, changeAccent } = useTheme();
// 取 i18n 翻译函数
	const { t } = useI18n();
// ...（彩色主题选择区与本轮无关，略）
/* 新增主题色选择器区块容器，与彩色主题区结构对称 */
				<div className="my-3.5 w-full border-b border-theme/20 pb-4.5">
/* 区块标题：i18n 主题色设置 */
					<div className="text-md font-bold">
/* 标题文案 */
						{t('setting.theme.accentTitle')}
/* 闭合标题 div */
					</div>
/* 列表外层内边距 */
					<div className="mt-3.5 px-8.5">
/* 列表容器：分隔线 + 圆角边框 + 卡片底色 */
						<div className="divide-y divide-theme-border/60 overflow-hidden rounded-xl border border-theme-border bg-theme-card">
/* 遍历 10 色预设渲染单行按钮 */
							{ACCENT_COLORS.map((item) => {
/* 当前是否选中：state 与 item.id 比较 */
								const selected = accent === item.id;
/* 返回单行按钮元素 */
								return (
/* 按钮元素 */
									<button
/* key 用 id，稳定 */
										key={item.id}
/* type=button 避免提交表单 */
										type="button"
/* 点击调用 changeAccent 并 void 掉 Promise */
										onClick={() => void changeAccent(item.id)}
/* className 用 cn 拼接条件类 */
										className={cn(
/* 基础类：整行可点、左对齐、过渡 */
											'flex w-full cursor-pointer items-center gap-3 px-3.5 py-2.5 text-left transition-colors',
/* 选中态用 teal-500/10 底（teal 已被主题色覆盖） */
											selected ? 'bg-teal-500/10' : 'hover:bg-theme/10',
/* 闭合 cn 调用 */
										)}
/* 闭合 button 开始标签 */
									>
/* 色块圆点容器 */
										<span
/* 圆点样式：固定尺寸、圆、边框、阴影 */
											className="size-5 shrink-0 rounded-full border border-theme-border/50 shadow-sm"
/* 行内样式：用 item.hex 作底色 */
											style={{ backgroundColor: item.hex }}
/* 对屏幕阅读器隐藏装饰圆点 */
											aria-hidden
/* 闭合 span */
										/>
/* 色名文字容器 */
										<span className="w-16 shrink-0 text-sm font-medium text-textcolor">
/* 色名：优先 i18n，缺失回退 label */
											{t(item.labelKey) ?? item.label}
/* 闭合色名 span */
										</span>
/* hex 徽章容器 */
										<span
/* 徽章样式：圆角、等宽字体、小字号 */
											className="shrink-0 rounded-md px-1.5 py-0.5 font-mono text-[10px] font-medium text-textcolor/90"
/* 行内样式：底色用 hex，字色按亮度自动对比 */
											style={{
/* 徽章底色 */
												backgroundColor: item.hex,
/* 徽章字色：深底白字 / 浅底深字 */
												color: accentBadgeFg(item.hex),
/* 闭合 style 对象 */
											}}
/* 闭合 span 开始标签 */
										>
/* 徽章文字：显示 hex */
											{item.hex}
/* 闭合徽章 span */
										</span>
/* 描述文字容器 */
										<span className="min-w-0 flex-1 truncate text-xs text-textcolor/55">
/* 描述：i18n descKey */
											{t(item.descKey)}
/* 闭合描述 span */
										</span>
/* 选中态显示对勾图标，teal-500 即主题色 */
										{selected ? (
/* 对勾图标 */
											<CircleCheckBig className="size-4 shrink-0 text-teal-500" />
/* 闭合三元：未选中渲染 null */
										) : null}
/* 闭合 button */
									</button>
/* 闭合 map 回调返回 */
								);
/* 闭合 map 回调 */
							})}
/* 闭合列表容器 div */
						</div>
/* 闭合外层内边距 div */
					</div>
/* 闭合主题色选择器区块 div */
				</div>
// ...（预览区，下方强调色行已改，略）
// 预览区强调色行（改动后用 --brand-accent）
							<StyleRow
/* 预览强调色标题 */
								title={t('setting.theme.preview.accent.title')}
/* 改动后强调色行用 --brand-accent 变量名 */
								varName="--brand-accent"
/* classHint 指向 text-teal-500（跟随主题色） */
								classHint="· text-teal-500"
/* 闭合 StyleRow 开始标签 */
							>
/* 强调色示例用 text-teal-500（跟随主题色） */
								<p className="font-medium text-teal-500">
/* 预览强调色描述文案 */
									{t('setting.theme.preview.accent.desc')}
/* 闭合 p 标签 */
								</p>
/* 闭合 StyleRow */
							</StyleRow>
```

**变更摘要**：新增主题色选择器区块（色块 / 色名 / hex 徽章 / 描述 / 选中对勾），预览区强调色行从 `--theme-color` / `text-theme` 改为 `--brand-accent` / `text-teal-500`。

### 4.7 i18n 主题色文案（新增）

**对比范围**：`apps/frontend/src/i18n/locales/zh-CN.ts` 与 `en-US.ts` 新增 `setting.theme.accent.*` 键、调整 `preview.accent` 文案。基线中不存在 accent 键，属纯新增；预览文案为改动。

**改动后** · `apps/frontend/src/i18n/locales/zh-CN.ts`（新增 / 改动，约 L295–L316、L331–L333）

```typescript
/* 主题色设置区块标题 */
	'setting.theme.accentTitle': '主题色设置',
/* teal：默认色名 */
	'setting.theme.accent.teal': '默认',
/* teal：描述 */
	'setting.theme.accent.teal.desc': '经典青绿，清晰醒目',
/* yuebai：色名 */
	'setting.theme.accent.yuebai': '青柠',
/* yuebai：描述 */
	'setting.theme.accent.yuebai.desc': '鲜活明快，春芽初绽',
/* ...（zhizi ~ yushi 共 5 色结构同上，见源码 L300–L310） */
/* tuoyan：色名 */
	'setting.theme.accent.tuoyan': '黛青',
/* tuoyan：描述 */
	'setting.theme.accent.tuoyan.desc': '静谧沉着，深夜湖色',
/* xicao：色名 */
	'setting.theme.accent.xicao': '松花',
/* xicao：描述 */
	'setting.theme.accent.xicao.desc': '清浅柔和，晨雾初开',
/* qiansui：色名 */
	'setting.theme.accent.qiansui': '苍翠',
/* qiansui：描述 */
	'setting.theme.accent.qiansui.desc': '深邃沉静，林荫苔色',
/* ...（previewTitle 等与本轮无关，略） */
/* 预览强调色标题：由「主题强调色」改为「主题色」 */
	'setting.theme.preview.accent.title': '主题色',
/* 预览强调色描述：改为 hover/选中/链接/按钮等交互强调色 */
	'setting.theme.preview.accent.desc': 'hover、选中、链接与按钮等交互强调色',
```

**改动后** · `apps/frontend/src/i18n/locales/en-US.ts`（新增 / 改动，约 L307–L326、L346）

```typescript
/* Accent color section title */
	'setting.theme.accentTitle': 'Accent color',
/* teal: default name */
	'setting.theme.accent.teal': 'Default',
/* teal: description */
	'setting.theme.accent.teal.desc': 'Classic teal, clear and crisp',
/* yuebai: name */
	'setting.theme.accent.yuebai': 'Lime',
/* yuebai: description */
	'setting.theme.accent.yuebai.desc': 'Fresh and vivid, spring buds',
/* ...（zhizi ~ yushi 共 5 colors, same structure, see source L312–L322） */
/* tuoyan: name */
	'setting.theme.accent.tuoyan': 'Dai teal',
/* tuoyan: description */
	'setting.theme.accent.tuoyan.desc': 'Quiet and composed, midnight lake',
/* xicao: name */
	'setting.theme.accent.xicao': 'Pine flower',
/* xicao: description */
	'setting.theme.accent.xicao.desc': 'Soft and pale, morning mist',
/* qiansui: name */
	'setting.theme.accent.qiansui': 'Evergreen',
/* qiansui: description */
	'setting.theme.accent.qiansui.desc': 'Deep and still, forest moss',
/* ...（previewTitle etc. unrelated, omitted） */
/* Preview accent description: changed to interactive accents */
	'setting.theme.preview.accent.desc':
		'Hover, selected, links, buttons, and other interactive accents.',
```

**变更摘要**：两份 locale 各新增 10 色名称 + 描述 + 区块标题；预览强调色描述调整为「交互强调色」语义。

### 4.8 原版 teal 豁免点（home / english sidebar / PackStream / vocabulary）

**对比范围**：四处「设计上就是 teal」的装饰区，把 `teal-*` 类改为固定 hex 任意值类，绕开 `--color-teal-*` 全局覆盖。改动前均用 `teal-*` 类（会被主题色覆盖）。

#### 4.8.1 首页 `home/index.tsx`

**改动前** · `apps/frontend/src/views/home/index.tsx`（基线，约 L71、L114、L117、L264、L341、L437、L489）

```typescript
/* 旧版快速开始步骤 1 渐变色用 teal-500 类 */
				color: 'from-teal-500 to-cyan-600',
// ...（步骤 2/3 与本轮无关，略）
/* 旧版对话卡片渐变色用 teal-500 类 */
				color: 'from-emerald-400 to-teal-500',
/* 旧版对话卡片投影色 */
				glow: 'shadow-emerald-500/25',
/* 旧版对话卡片 hover 底色用 teal-600 类 */
				hoverBg:
					'group-hover:bg-linear-to-br group-hover:from-emerald-500/15 group-hover:to-teal-600/5',
// ...（其它卡片与本轮无关，略）
/* 旧版快速开始按钮渐变用 teal-500 类 */
				className="relative h-10 w-30 cursor-pointer overflow-hidden rounded-md bg-linear-to-r from-teal-500 to-cyan-600 px-6 pt-3 text-sm font-semibold text-textcolor shadow-lg transition-[transform,box-shadow] duration-200 ease-out hover:scale-[1.03] hover:shadow-teal-500/30 active:scale-[0.98]"
// ...（特性卡入口箭头等与本轮无关，略）
/* 旧版特性卡入口文字用 teal-400/300 类 */
			<div className="relative mt-4 flex items-center gap-2 border-t border-dashed border-theme/5 pt-4 text-sm font-semibold text-teal-400/85 transition-all duration-300 group-hover:translate-x-0.5 group-hover:text-teal-300">
// ...（快速开始列表项 hover 文字色与本轮无关，略）
/* 旧版快速开始列表项 hover 标题色用 teal-300 类 */
			<h4 className="mb-1 font-semibold text-textcolor transition-colors group-hover:text-teal-300">
// ...（另一处列表项同上，略）
/* 旧版快速开始列表项箭头 hover 色用 teal-400 类 */
				<ArrowRight className="h-5 w-5 text-textcolor/40 group-hover:text-teal-400" />
```

**改动后** · `apps/frontend/src/views/home/index.tsx`（当前，约 L71–L72、L114–L117、L264、L341、L437、L489）

```typescript
/* 注释：固定原版 teal hex，不跟随全局主题色 */
/* 步骤 1 渐变改用 #14b8a6 任意值类 */
				color: 'from-[#14b8a6] to-cyan-600',
// ...（步骤 2/3 与本轮无关，略）
/* 注释：固定原版 teal hex，不跟随全局主题色 */
/* 对话卡片渐变改用 #14b8a6 */
				color: 'from-emerald-400 to-[#14b8a6]',
/* 对话卡片投影色（未改） */
				glow: 'shadow-emerald-500/25',
/* hover 底色改用 #0d9488（teal-600 hex） */
				hoverBg:
					'group-hover:bg-linear-to-br group-hover:from-emerald-500/15 group-hover:to-[#0d9488]/5',
// ...（其它卡片与本轮无关，略）
/* 快速开始按钮渐变与投影改用 #14b8a6 */
				className="relative h-10 w-30 cursor-pointer overflow-hidden rounded-md bg-linear-to-r from-[#14b8a6] to-cyan-600 px-6 pt-3 text-sm font-semibold text-textcolor shadow-lg transition-[transform,box-shadow] duration-200 ease-out hover:scale-[1.03] hover:shadow-[#14b8a6]/30 active:scale-[0.98]"
// ...（特性卡入口箭头等与本轮无关，略）
/* 特性卡入口文字改用 teal-500/400（保留类，因这是入口强调，应跟随主题色；仅档位调整） */
			<div className="relative mt-4 flex items-center gap-2 border-t border-dashed border-theme/5 pt-4 text-sm font-semibold text-teal-500/85 transition-all duration-300 group-hover:translate-x-0.5 group-hover:text-teal-400">
// ...（快速开始列表项 hover 文字色与本轮无关，略）
/* 快速开始列表项 hover 标题色改用 teal-400（保留类，跟随主题色） */
			<h4 className="mb-1 font-semibold text-textcolor transition-colors group-hover:text-teal-400">
// ...（另一处列表项同上，略）
/* 快速开始列表项箭头 hover 色改用 teal-500（保留类，跟随主题色） */
				<ArrowRight className="h-5 w-5 text-textcolor/40 group-hover:text-teal-500" />
```

**变更摘要**：首页快速开始按钮、对话卡片等「原版 teal 渐变」装饰区改为固定 hex 豁免；特性卡入口与列表项 hover 文字保留 `teal-*` 类（跟随主题色），仅档位微调（300→400/500）。

#### 4.8.2 英语学习侧栏渐变 `sidebarAccents.ts`

**改动前** · `apps/frontend/src/views/englishLearning/sidebar/sidebarAccents.ts`（基线，约 L11、L16、L30、L35、L52）

```typescript
/* 旧版 daily 渐变用 teal-600 类 */
	daily: 'bg-linear-to-r from-emerald-500 to-teal-600',
/* 旧版 vocabPack 渐变用 teal-500 类 */
	vocabPack: 'bg-linear-to-r from-teal-500 to-cyan-600',
// ...（其它渐变与本轮无关，略）
/* 旧版 daily 按钮渐变用 teal-600 / teal-500 类 */
	daily:
		'bg-linear-to-r from-emerald-500 to-teal-600 hover:bg-linear-to-r hover:from-emerald-400 hover:to-teal-500',
// ...（vocabSource / classicSource 与本轮无关，略）
/* 旧版 vocabPack 按钮渐变用 teal-500 / teal-400 类 */
	vocabPack:
		'bg-linear-to-r from-teal-500 to-cyan-600 hover:bg-linear-to-r hover:from-teal-400 hover:to-cyan-600',
// ...（其它按钮渐变与本轮无关，略）
/* 旧版 daily 文字链渐变用 teal-600 / teal-500 类 */
	daily:
		'bg-linear-to-r from-emerald-500 to-teal-600 hover:from-emerald-400 hover:to-teal-500 bg-clip-text text-transparent',
```

**改动后** · `apps/frontend/src/views/englishLearning/sidebar/sidebarAccents.ts`（当前，约 L11、L16、L30、L35、L52）

```typescript
/* daily 渐变改用 #0d9488（teal-600 hex），固定不跟随主题色 */
	daily: 'bg-linear-to-r from-emerald-500 to-[#0d9488]',
/* vocabPack 渐变改用 #14b8a6（teal-500 hex） */
	vocabPack: 'bg-linear-to-r from-[#14b8a6] to-cyan-600',
// ...（其它渐变与本轮无关，略）
/* daily 按钮渐变改用 #0d9488 / #14b8a6 */
	daily:
		'bg-linear-to-r from-emerald-500 to-[#0d9488] hover:bg-linear-to-r hover:from-emerald-400 hover:to-[#14b8a6]',
// ...（vocabSource / classicSource 与本轮无关，略）
/* vocabPack 按钮渐变改用 #14b8a6 / #2dd4bf（teal-400 hex） */
	vocabPack:
		'bg-linear-to-r from-[#14b8a6] to-cyan-600 hover:bg-linear-to-r hover:from-[#2dd4bf] hover:to-cyan-600',
// ...（其它按钮渐变与本轮无关，略）
/* daily 文字链渐变改用 #0d9488 / #14b8a6 */
	daily:
		'bg-linear-to-r from-emerald-500 to-[#0d9488] hover:from-emerald-400 hover:to-[#14b8a6] bg-clip-text text-transparent',
```

**变更摘要**：侧栏 daily / vocabPack 三组渐变（icon / 按钮 / 文字链）改用固定 teal hex，避免随主题色变粉/变黄。

#### 4.8.3 单词资料流式条 `PackStreamLiveLink.tsx` / `PackStreamProgress.tsx`

**改动前** · `apps/frontend/src/views/englishLearning/pack/components/PackStreamLiveLink.tsx`（基线，约 L57–L65）

```typescript
/* 旧版 accentBar 用 teal-500 类 */
	const accentBar = isVocab ? 'bg-teal-500/85' : 'bg-violet-500/85';
/* 旧版 accentToolLine 用 teal-600 / teal-400 类 */
	const accentToolLine = isVocab
		? 'text-teal-600/90 dark:text-teal-400/90'
		: 'text-indigo-600/90 dark:text-indigo-400/90';
/* 旧版 accentBorder 用 teal-500 类 */
	const accentBorder = isVocab
		? 'border-teal-500/6 bg-linear-to-r from-teal-500/18 to-cyan-600/18'
		: 'border-violet-500/6 bg-linear-to-r from-violet-500/18 to-indigo-600/18';
/* 旧版 bgColor 用 teal-500 类 */
	const bgColor = isVocab
		? 'bg-linear-to-r from-teal-500/35 to-cyan-600/30'
		: 'bg-linear-to-r from-violet-500/30 to-indigo-600/30';
```

**改动后** · `apps/frontend/src/views/englishLearning/pack/components/PackStreamLiveLink.tsx`（当前，约 L55–L65）

```typescript
/* 注释：单词资料固定原版 teal hex，不跟随全局主题色 */
/* accentBar 改用 #14b8a6 */
	const accentBar = isVocab ? 'bg-[#14b8a6]/85' : 'bg-violet-500/85';
/* accentToolLine 改用 #0d9488 / #2dd4bf */
	const accentToolLine = isVocab
		? 'text-[#0d9488]/90 dark:text-[#2dd4bf]/90'
		: 'text-indigo-600/90 dark:text-indigo-400/90';
/* accentBorder 改用 #14b8a6 */
	const accentBorder = isVocab
		? 'border-[#14b8a6]/6 bg-linear-to-r from-[#14b8a6]/18 to-cyan-600/18'
		: 'border-violet-500/6 bg-linear-to-r from-violet-500/18 to-indigo-600/18';
/* bgColor 改用 #14b8a6 */
	const bgColor = isVocab
		? 'bg-linear-to-r from-[#14b8a6]/35 to-cyan-600/30'
		: 'bg-linear-to-r from-violet-500/30 to-indigo-600/30';
```

**改动后** · `apps/frontend/src/views/englishLearning/pack/components/PackStreamProgress.tsx`（当前，约 L34–L40）

```typescript
/* 注释：单词资料固定原版 teal hex，不跟随全局主题色 */
/* accentBar 改用 #14b8a6 */
	const accentBar = kind === 'vocab' ? 'bg-[#14b8a6]/85' : 'bg-violet-500/85';
/* accentText 改用 #0d9488 / #2dd4bf */
	const accentText =
		kind === 'vocab'
			? 'text-[#0d9488]/90 dark:text-[#2dd4bf]/90'
			: 'text-indigo-600/90 dark:text-indigo-400/90';
```

**变更摘要**：单词资料（vocab）流式条的四组强调色与文字色改用固定 teal hex；经典句（classic）保持 violet/indigo 不变。

#### 4.8.4 词包数量按钮 `vocabulary/index.tsx`

**改动前** · `apps/frontend/src/views/englishLearning/sections/vocabulary/index.tsx`（基线，约 L458–L461）

```typescript
/* 旧版数量按钮底色用 teal-500 类 */
									'flex-1 rounded-md border bg-teal-500/15 hover:bg-teal-500/20 px-0 py-1 text-xs font-medium transition-colors',
/* 旧版选中态用 teal-500 类 */
									countInput === String(n)
										? 'border-teal-500/35 text-teal-500 bg-teal-500/20'
										: 'border-teal-500/10 text-textcolor hover:border-teal-500/20 hover:text-teal-500 hover:bg-teal-500/20',
```

**改动后** · `apps/frontend/src/views/englishLearning/sections/vocabulary/index.tsx`（当前，约 L458–L461）

```typescript
/* 注释：固定 teal-500 hex，不跟随全局主题色 */
									'flex-1 rounded-md border bg-[#14b8a6]/15 hover:bg-[#14b8a6]/20 px-0 py-1 text-xs font-medium transition-colors',
/* 选中态改用 #14b8a6 */
									countInput === String(n)
										? 'border-[#14b8a6]/35 text-[#14b8a6] bg-[#14b8a6]/20'
										: 'border-[#14b8a6]/10 text-textcolor hover:border-[#14b8a6]/20 hover:text-[#14b8a6] hover:bg-[#14b8a6]/20',
```

**变更摘要**：词包数量按钮底色 / 选中态 / hover 全部改用 `#14b8a6` 任意值类，绕开全局 teal 覆盖。

## 5. 行为变化与兼容性

- **用户可感知**：设置 → 主题 新增「主题色设置」区，10 色可切换；全站 hover / 选中 / 链接 / 按钮等交互强调色即时跟随；按账号持久化、跨端同步。
- **首帧体验**：刷新或重启不再闪回默认 teal（首屏脚本与 bootstrap 接力）。
- **向后兼容**：默认 teal 与原视觉一致；未切换主题色的账号无视觉变化。`--theme-color` / `text-theme` 既有路径未删除，仅预览区强调色行改用 `--brand-accent`。
- **豁免区不变**：首页渐变按钮、英语学习侧栏渐变、单词资料流式条、词包数量按钮保持原版 teal 视觉，不随主题色变化。
- **破坏性**：无。新增 Tauri store 键 `accentColor`，旧账号无该键时回退默认 teal。

## 6. 测试与回归建议

- 切换 10 色各一次，确认全站 `text-teal-*` / `bg-teal-*` / `hover:text-teal-*` 跟随变化（首页特性卡入口、设置页对勾、知识库链接等）。
- 刷新页面 / 重启桌面端，确认无首帧 teal 闪烁；切换后立即刷新仍保持所选色。
- 登录账号 A 选色 → 登出登录账号 B，确认 B 看到自己的主题色（按账号独立）。
- 换设备登录同一账号，确认主题色同步（Tauri store `accentColor`）。
- 确认首页快速开始按钮、对话卡片渐变、英语学习侧栏 daily / vocabPack 渐变、单词资料流式条、词包数量按钮**不随**主题色变化（保持原版 teal）。
- 确认经典句流式条 / classicPack 渐变仍为 violet/indigo，未受影响。
- 切换彩色主题（dark/red/beige）与主题色组合，确认两者正交、无相互覆盖。
- 中英文界面下确认主题色选择器文案与预览区文案齐全。
- 徽章字色：选 tuoyan（深底）确认 hex 徽章字为白；选 xicao（浅底）确认为深字。

## 7. 相关源码路径

| 说明 | 路径 |
| ---- | ---- |
| 主题色预设、应用函数、useTheme | `apps/frontend/src/hooks/theme.ts` |
| 首屏主题色 bootstrap | `apps/frontend/index.html` |
| CSS 变量默认值与 teal 覆盖 | `apps/frontend/src/index.css` |
| 主题色选择器与预览 | `apps/frontend/src/views/setting/theme/index.tsx` |
| 中英文文案 | `apps/frontend/src/i18n/locales/zh-CN.ts`、`en-US.ts` |
| 首页原版 teal 豁免 | `apps/frontend/src/views/home/index.tsx` |
| 英语学习侧栏渐变豁免 | `apps/frontend/src/views/englishLearning/sidebar/sidebarAccents.ts` |
| 单词资料流式条豁免 | `apps/frontend/src/views/englishLearning/pack/components/PackStreamLiveLink.tsx`、`PackStreamProgress.tsx` |
| 词包数量按钮豁免 | `apps/frontend/src/views/englishLearning/sections/vocabulary/index.tsx` |

---

（若与仓库最新源码不一致，以源码为准）
