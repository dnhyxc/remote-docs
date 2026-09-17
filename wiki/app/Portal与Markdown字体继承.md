# Portal 与 Markdown 字体继承修复

## 1. 背景与目标

应用通过 `:root` 上的 `--font-family` 自定义令牌声明主题字体（默认 `"手札体-简"`），并在 `#root` 上通过 `font-family: var(--font-family)` 应用到主界面。但存在两个字体继承断点：

1. **Portal 组件字体丢失**：`Dialog` / `Drawer` / `Popover` / `Tooltip` 等 Portal 组件通过 `createPortal` 挂载到 `document.body` 下，不在 `#root` 子树内。原先 `font-family` 只声明在 `#root` 上，Portal 内的内容无法继承，回退到浏览器默认字体（如 Times New Roman / SF Pro），与主界面字体不一致。

2. **Markdown 预览字体被第三方 CSS 覆盖**：`markdown-kit/github-markdown` 样式表给 `.markdown-body` 写死了 `-apple-system, BlinkMacSystemFont, "Segoe UI", ...` 等系统字体栈，优先级高于 `body` 上的继承值，导致 Markdown 预览区使用系统字体而非应用主题字体。

**目标**：让 Portal 组件内容与 Markdown 预览内容都正确使用 `--font-family` 主题字体，与主界面保持一致。

## 2. 改动范围

- `apps/frontend/src/index.css`
  - `html, body` 规则块：新增 `font-family: var(--font-family)`，使 Portal（挂载在 `body` 下）可继承应用字体。
  - `.markdown-body` 规则块：新增 `font-family: var(--font-family)`，显式覆盖 `github-markdown` 写死的系统字体栈。
  - `#root` 规则块：移除 `font-family: var(--font-family)`（已上移到 `body`，`#root` 通过继承即可生效，避免重复声明）。

## 3. 实现思路

1. **字体声明上移到 `body`**：CSS `font-family` 是可继承属性。将其声明在 `body` 上而非 `#root` 上，可覆盖两个场景：
   - `#root` 仍在 `body` 内，通过继承自动获得字体；
   - Portal 节点直接挂在 `body` 下（与 `#root` 平级），也能继承 `body` 的字体。
2. **移除 `#root` 上的冗余声明**：`#root` 不再单独声明 `font-family`，避免「`body` 设一次、`#root` 又设一次」的重复；`#root` 作为 `body` 的子节点自然继承。
3. **显式覆盖 `.markdown-body` 字体**：`github-markdown` 第三方 CSS 在 `.markdown-body` 上直接声明了 `font-family`，属于「元素自身声明」，优先级高于继承值。必须在 `.markdown-body` 上显式写 `font-family: var(--font-family)` 才能覆盖第三方写死的系统字体栈。
4. **不影响 Monaco 编辑器内部字体**：Monaco 编辑器有独立的字体配置（`editorOptions.fontFamily`），不受 `body` / `.markdown-body` 的 `font-family` 影响。

## 4. 关键代码对比与注释

### 4.1 `html, body` 规则块：新增 `font-family`（`apps/frontend/src/index.css`）

**对比范围**：`html, body` 规则块开头片段（摘录，展示声明行至首个子规则；该规则块内其余子规则未改动）。

**改动前** · `apps/frontend/src/index.css`（基线，约 L19–L36）

```css
/* html 与 body 共用的基础重置选择器 */
html,
/* body 选择器：Portal 节点会作为 body 的直接子节点挂载 */
body {
	/* 清除外边距，消除浏览器默认 body margin */
	margin: 0;
	/* 清除内边距，内容由各布局组件自行控制 */
	padding: 0;
	/* 高度撑满 html，确保后续 #root 的 fixed 布局有基准 */
	height: 100%;
	/* 宽度撑满 html */
	width: 100%;
	/* 禁止滚动链/回弹，避免拖选时整页跟随滚动 */
	overscroll-behavior: none;
	/* 文档层禁止滚动；即便 WKWebView 仍改 scrollTop，#root 为 fixed 也不跟着走 */
	overflow: clip;
	/* 禁止页面选中文本（避免误选）；编辑器/输入框区域会单独放开 */
	-webkit-user-select: none;
	/* 同上，标准属性，覆盖 user-select */
	user-select: none;
	/* find 样式关闭按钮样式 */
	.monaco-editor .find-widget > .button.codicon-widget-close {
		/* 将关闭按钮向下偏移 8px，对齐 find widget 视觉中线 */
		top: 8px;
	}
```

**改动后** · `apps/frontend/src/index.css`（当前，约 L19–L37）

```css
/* html 与 body 共用的基础重置选择器 */
html,
/* body 选择器：Portal 节点会作为 body 的直接子节点挂载 */
body {
	/* 清除外边距，消除浏览器默认 body margin */
	margin: 0;
	/* 清除内边距，内容由各布局组件自行控制 */
	padding: 0;
	/* 高度撑满 html，确保后续 #root 的 fixed 布局有基准 */
	height: 100%;
	/* 宽度撑满 html */
	width: 100%;
	/* 禁止滚动链/回弹，避免拖选时整页跟随滚动 */
	overscroll-behavior: none;
	/* 文档层禁止滚动；即便 WKWebView 仍改 scrollTop，#root 为 fixed 也不跟着走 */
	overflow: clip;
	/* 禁止页面选中文本（避免误选）；编辑器/输入框区域会单独放开 */
	-webkit-user-select: none;
	/* 同上，标准属性，覆盖 user-select */
	user-select: none;
	/* Portal（Dialog/Drawer/Popover）挂在 body 下，须在此设字体，不能只写 #root */
	font-family: var(--font-family);
	/* find 样式关闭按钮样式 */
	.monaco-editor .find-widget > .button.codicon-widget-close {
		/* 将关闭按钮向下偏移 8px，对齐 find widget 视觉中线 */
		top: 8px;
	}
```

**变更摘要**：在 `body` 上新增 `font-family: var(--font-family)`，使挂在 `body` 下的 Portal 节点能继承应用主题字体。

### 4.2 `.markdown-body` 规则块：新增 `font-family` 覆盖第三方 CSS（`apps/frontend/src/index.css`）

**对比范围**：`body` 规则块内、`.markdown-body table tr` 规则之前的注释与新规则片段（摘录）。

**改动前** · `apps/frontend/src/index.css`（基线，约 L195–L200）

```css
	/*
	 * 表格行背景：GitHub Markdown 默认用 --bgColor-default/--bgColor-muted（跟系统深浅走），
	 * 改为跟随应用主题 body.theme-* 的 token。
	 */
	/* 表格行选择器，设置奇数行背景与上边框 */
	.markdown-body table tr {
```

**改动后** · `apps/frontend/src/index.css`（当前，约 L197–L206）

```css
	/*
	 * 表格行背景：GitHub Markdown 默认用 --bgColor-default/--bgColor-muted（跟系统深浅走），
	 * 改为跟随应用主题 body.theme-* 的 token。
	 */
	/* markdown-kit/github-markdown 给 .markdown-body 写死了 -apple-system 等，需显式覆盖 */
	/* Markdown 渲染根容器，覆盖第三方 CSS 写死的系统字体栈 */
	.markdown-body {
		/* 使用应用主题字体令牌，确保预览区与主界面字体一致 */
		font-family: var(--font-family);
	}
	/* 表格行选择器，设置奇数行背景与上边框 */
	.markdown-body table tr {
```

**变更摘要**：在 `.markdown-body` 上显式声明 `font-family: var(--font-family)`，覆盖 `github-markdown` 第三方 CSS 写死的 `-apple-system` 等系统字体栈。

### 4.3 `#root` 规则块：移除 `font-family`（`apps/frontend/src/index.css`）

**对比范围**：`#root` 规则块完整定义（声明行到闭合 `}`）。

**改动前** · `apps/frontend/src/index.css`（基线，约 L404–L415）

```css
/* 应用根容器，钉在视口固定层 */
#root {
	/* 钉在视口：拖选移出窗口时 document 被改 scrollTop 也不会带动整页 UI */
	position: fixed;
	/* 四方向归零，撑满视口 */
	inset: 0;
	/* 裁剪溢出，配合内部滚动区域 */
	overflow: clip;
	/* 背景色：跟随主题 --background 令牌 */
	background-color: var(--background);
	/* 氛围渐变（atmosphere gradient）：由各主题 --theme-bg-atmosphere 提供，避免单调平涂 */
	background-image: var(--theme-bg-atmosphere);
	/* 渐变不重复平铺 */
	background-repeat: no-repeat;
	/* 背景图覆盖整个容器 */
	background-size: cover;
	/* 字体：原先在此声明，现已上移到 body，#root 通过继承生效 */
	font-family: var(--font-family);
}
```

**改动后** · `apps/frontend/src/index.css`（当前，约 L408–L418）

```css
/* 应用根容器，钉在视口固定层 */
#root {
	/* 钉在视口：拖选移出窗口时 document 被改 scrollTop 也不会带动整页 UI */
	position: fixed;
	/* 四方向归零，撑满视口 */
	inset: 0;
	/* 裁剪溢出，配合内部滚动区域 */
	overflow: clip;
	/* 背景色：跟随主题 --background 令牌 */
	background-color: var(--background);
	/* 氛围渐变（atmosphere gradient）：由各主题 --theme-bg-atmosphere 提供，避免单调平涂 */
	background-image: var(--theme-bg-atmosphere);
	/* 渐变不重复平铺 */
	background-repeat: no-repeat;
	/* 背景图覆盖整个容器 */
	background-size: cover;
}
```

**变更摘要**：移除 `#root` 上的 `font-family: var(--font-family)`，该声明已上移到 `body`；`#root` 作为 `body` 的子节点通过 CSS 继承自动获得字体。

## 5. 兼容性与影响

- **Portal 组件**（`Dialog` / `Drawer` / `Popover` / `Tooltip`）：内容现在正确使用 `--font-family` 应用主题字体，不再回退到浏览器默认字体。
- **Markdown 预览区**（`.markdown-body`）：内容现在正确使用 `--font-family` 应用主题字体，不再被 `github-markdown` 的系统字体栈覆盖。
- **`#root` 主界面**：不再单独声明 `font-family`，但作为 `body` 子节点通过继承仍然生效，视觉效果无变化。
- **Monaco 编辑器**：不受影响，编辑器内部字体由 `editorOptions.fontFamily` 独立配置。
- **主题切换**：`--font-family` 令牌定义在 `:root` 上，各主题类（`.theme-*`）如需自定义字体可覆盖该令牌，本改动自动跟随。
- 无破坏性变更，纯样式修复。

## 6. 相关源码路径表

| 说明 | 路径 |
| ---- | ---- |
| 字体修复改动文件 | `apps/frontend/src/index.css` |
| `--font-family` 令牌定义位置 | `apps/frontend/src/index.css`（`:root` 规则块内） |
| Portal 挂载目标 | `document.body`（由 React `createPortal` 实现） |
| 第三方 Markdown 样式来源 | `@dnhyxc-ai/markdown-kit` 的 `github-markdown` CSS |

---

若与仓库最新源码不一致，以源码为准。
