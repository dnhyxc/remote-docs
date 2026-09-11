# 代码块视觉对齐 Host

## 1. 背景与目标

`remote-docs` 嵌入 Host 时，Host 内置的 Markdown 代码块（`.chat-md-code-block`）与 remote 自有样式存在三处视觉差异：边框颜色、工具栏背景、高亮实色底。用户在 Host 内切换文档页时可明显感知代码块外观不一致。本轮修订 `styles.css` 中的代码块样式，使 remote 的代码块观感与 Host 一致：边框用 `--theme-color` 派生色、工具栏背景改为 `--theme-color` 淡色、高亮底改为透明（透出外壳 `secondary` 底色）。

## 2. 改动范围

- `src/styles.css` — `.chat-md-code-block` 边框 + overflow；`.chat-md-code-toolbar` 圆角 + 背景；新增 `.hljs` 透明底规则

## 3. 实现思路

### 3.1 边框颜色：`--theme-border` → `--theme-color` 派生色

**旧**：`border: 1px solid var(--theme-border)` —— 使用 Host 的边框变量，在不同主题下可能不可见或过深。
**新**：`border: 1px solid color-mix(in oklch, var(--theme-color) 10%, transparent)` —— 从主题强调色（`--theme-color`）派生 10% 不透明度的边框，与 Host 代码块边框一致。

**为什么用 `color-mix(in oklch, ...)`**：OKLCH 色彩空间比 sRGB 更均匀，混合后的颜色在明暗主题下都自然。10% 不透明度让边框足够淡，不抢视觉焦点，但能界定代码块边界。

### 3.2 移除 `overflow: hidden`

**旧**：`overflow: hidden` —— 原意是裁切 toolbar / pre / .hljs 的直角背景，避免盖住四角圆边。
**新**：移除 `overflow: hidden` —— 注释改为「与 Host 同底；勿 overflow:hidden（会截断 sticky）」。

**为什么移除**：`overflow: hidden` 会创建新的 BFC（块格式化上下文），导致内部 `position: sticky` 的工具栏在滚动时无法粘在容器顶部（sticky 元素的 containing block 有 overflow:hidden 时，sticky 会在容器边界处被截断而非在视口边界粘住）。Host 的代码块不用 `overflow: hidden`，而是通过给内部元素（pre、toolbar）设置匹配的 `border-radius` 来实现圆角效果。

### 3.3 工具栏背景：`--theme-background` 混合 → `--theme-color` 淡色

**旧**：`background: color-mix(in oklch, var(--theme-background) 50%, transparent)` —— 用主题背景色混合 50% 透明，在深色主题下偏暗、浅色主题下偏白。
**新**：`background: color-mix(in oklch, var(--theme-color) 10%, transparent)` —— 用主题强调色混合 10% 透明，与 Host 工具栏一致（Host 用 `bg-theme/10`）。

**为什么改**：Host 的代码块工具栏用主题强调色淡色背景（`bg-theme/10`），而非背景色混合。这让工具栏在深浅主题下都带一点主题色调，与边框色呼应，视觉更统一。

### 3.4 工具栏圆角：`0.5rem` → `0.4rem`

**旧**：`border-radius: 0.5rem 0.5rem 0 0`（顶部圆角 0.5rem）
**新**：`border-radius: 0.4rem 0.4rem 0 0`（顶部圆角 0.4rem）

**为什么改**：与 Host 的代码块工具栏圆角对齐。Host 用 0.4rem，旧版用 0.5rem，差 0.1rem 在像素级有细微差异。

### 3.5 新增 `.hljs` 透明底规则

**新增**：
```css
.markdown-body .chat-md-code-block code.hljs,
.markdown-body .chat-md-code-block .hljs {
    background: transparent !important;
    padding: 0 !important;
}
```

**为什么新增**：highlight.js 主题（github-dark / atom-one-dark）会给 `.hljs` 元素设置实色背景（如 `#0d1117`）。这层实色底会盖住代码块外壳的 `secondary/55` 混合底色，导致代码块内部颜色与外部不协调。用 `!important` 强制透明后，外壳的半透明底色透出，与 Host 观感一致。同时 `padding: 0` 因为 padding 已由 `pre` 元素控制（`pre` 有 `padding: 0.75rem 1rem`），`.hljs` 的默认 padding 会导致双重内边距。

## 4. 关键代码对比与注释

### 4.1 `.chat-md-code-block` — 边框与 overflow（改动前/后对比）

**对比范围**：`.markdown-body .chat-md-code-block` 规则块。

**改动前** · `src/styles.css`（基线，约 L225–L235）

```css
/* 代码块外壳容器 */
.markdown-body .chat-md-code-block {
	/* 相对定位（sticky toolbar 的锚点） */
	position: relative;
	/* 上下外边距 */
	margin: 0.75rem 0;
	/* 旧版边框：用 --theme-border 变量 */
	border: 1px solid var(--theme-border);
	/* 圆角 */
	border-radius: 0.5rem;
	/* 旧版注释 + overflow:hidden：裁切内部直角背景，但会截断 sticky */
	/* 裁切 toolbar / pre / .hljs 直角背景，避免盖住四角圆边 */
	overflow: hidden;
	/* 背景：secondary 混合 55% 透明 */
	background: color-mix(in oklch, var(--theme-secondary) 55%, transparent);
	/* 允许选中文本 */
	user-select: text;
	/* 最大宽度限制 */
	max-width: 100%;
	/* 最小宽度 0（flex 子项防溢出） */
	min-width: 0;
	/* 盒模型 */
	box-sizing: border-box;
}
```

**改动后** · `src/styles.css`（当前，约 L225–L236）

```css
/* 代码块外壳容器 */
.markdown-body .chat-md-code-block {
	/* 相对定位（sticky toolbar 的锚点） */
	position: relative;
	/* 上下外边距 */
	margin: 0.75rem 0;
	/* 新版边框：用 --theme-color 派生 10% 透明，与 Host 一致 */
	border: 1px solid color-mix(in oklch, var(--theme-color) 10%, transparent);
	/* 圆角 */
	border-radius: 0.5rem;
	/* 新版注释：移除 overflow:hidden，因为会截断 sticky 工具栏 */
	/* 与 Host 同底；勿 overflow:hidden（会截断 sticky） */
	/* 背景：secondary 混合 55% 透明（保持不变） */
	background: color-mix(in oklch, var(--theme-secondary) 55%, transparent);
	/* 允许选中文本 */
	user-select: text;
	/* 最大宽度限制 */
	max-width: 100%;
	/* 最小宽度 0（flex 子项防溢出） */
	min-width: 0;
	/* 盒模型 */
	box-sizing: border-box;
}
```

**变更摘要**：边框从 `var(--theme-border)` 改为 `color-mix(in oklch, var(--theme-color) 10%, transparent)`；移除 `overflow: hidden`。

### 4.2 `.chat-md-code-toolbar` — 圆角与背景（改动前/后对比）

**对比范围**：`.markdown-body .chat-md-code-toolbar` 规则块。

**改动前** · `src/styles.css`（基线，约 L242–L253）

```css
/* 代码块工具栏（语言标签 + 复制/下载按钮） */
.markdown-body .chat-md-code-toolbar {
	/* 相对定位 */
	position: relative;
	/* z-index 高于 pre */
	z-index: 1;
	/* flex 布局 */
	display: flex;
	/* 垂直居中 */
	align-items: center;
	/* 两端对齐 */
	justify-content: space-between;
	/* 间距 */
	gap: 0.5rem;
	/* 内边距 */
	padding: 0.28rem 1px 0.32rem 0.72rem;
	/* 旧版圆角：0.5rem */
	border-radius: 0.5rem 0.5rem 0 0;
	/* 旧版背景：--theme-background 混合 50% */
	background: color-mix(in oklch, var(--theme-background) 50%, transparent);
	/* 背景模糊（毛玻璃效果） */
	backdrop-filter: blur(8px);
	/* Safari 兼容 */
	-webkit-backdrop-filter: blur(8px);
}
```

**改动后** · `src/styles.css`（当前，约 L242–L255）

```css
/* 代码块工具栏（语言标签 + 复制/下载按钮） */
.markdown-body .chat-md-code-toolbar {
	/* 相对定位 */
	position: relative;
	/* z-index 高于 pre */
	z-index: 1;
	/* flex 布局 */
	display: flex;
	/* 垂直居中 */
	align-items: center;
	/* 两端对齐 */
	justify-content: space-between;
	/* 间距 */
	gap: 0.5rem;
	/* 内边距 */
	padding: 0.28rem 1px 0.32rem 0.72rem;
	/* 新版圆角：0.4rem，与 Host 对齐 */
	border-radius: 0.4rem 0.4rem 0 0;
	/* 新版注释 + 背景：--theme-color 淡色，与 Host 一致（bg-theme/10） */
	/* 与 Host 一致：bg-theme/10 */
	background: color-mix(in oklch, var(--theme-color) 10%, transparent);
	/* 背景模糊（毛玻璃效果） */
	backdrop-filter: blur(8px);
	/* Safari 兼容 */
	-webkit-backdrop-filter: blur(8px);
}
```

**变更摘要**：圆角从 `0.5rem` 改为 `0.4rem`；背景从 `var(--theme-background) 50%` 改为 `var(--theme-color) 10%`。

### 4.3 `.hljs` 透明底规则（纯新增）

**来源** · `src/styles.css`（纯新增，约 L354–L359）

```css
/* 注释：压过 github-dark / atom-one 的高亮主题实色底，透出外壳 secondary/55 底色，与 Host 观感一致 */
/* 压过 github-dark / atom-one 的 .hljs 实色底，透出外壳 secondary/55（与 Host 观感一致） */
/* 选择器：代码块内的 code.hljs 和 .hljs 元素 */
.markdown-body .chat-md-code-block code.hljs,
.markdown-body .chat-md-code-block .hljs {
	/* 强制透明背景，让外壳底色透出 */
	background: transparent !important;
	/* 移除 .hljs 默认内边距（padding 已由 pre 元素控制） */
	padding: 0 !important;
}
```

**变更摘要**：新增 `.hljs` 透明底规则——用 `!important` 覆盖 highlight.js 主题的实色背景，让代码块外壳的 `secondary/55` 底色透出。

## 5. 兼容性与影响

- **向后兼容**：纯 CSS 变更，无破坏性影响
- **用户可感知**：是——代码块边框颜色、工具栏背景、高亮底色均与 Host 对齐
- **深浅主题一致性**：所有颜色用 CSS 变量 + `color-mix`，自动适配深浅主题
- **sticky 工具栏修复**：移除 `overflow: hidden` 后，工具栏的 sticky 定位恢复正常
- **回归测试**：验证深色/浅色主题下代码块外观与 Host 一致；验证工具栏 sticky 行为正常；验证长代码行水平滚动正常

## 6. 相关源码路径

| 说明 | 路径 |
| ---- | ---- |
| 代码块样式 | `src/styles.css` |
| Markdown 组件（使用样式） | `src/components/design/Markdown/index.tsx` |

---

（若与仓库最新源码不一致，以源码为准）
