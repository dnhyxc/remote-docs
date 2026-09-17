# Mermaid 在 Markdown 中的缩放与预览：实现说明

本文说明在应用内渲染 `mermaid` 围栏后，**工具栏缩放 / 平移**（可选模块）与**点击弹出 ImagePreview 大图预览**（当前前端已接入）的完整思路、DOM 约定、数据流与代码级注释。

### 维护性补充：DOM 契约集中在 `@dnhyxc-ai/markdown-kit`

**问题**：占位结构由 `MarkdownParser` 输出，但「取 SVG / closest wrap / 岛内写空壳 HTML / Tailwind 任意选择器」等逻辑历史上分散在前端与工具包各处；若用复制粘贴的 `querySelector('.markdown-mermaid-wrap …')` 字符串，**解析器一改 DOM**，很容易出现 **漏改**。

**现状（与仓库实现一致）**：在 `packages/markdown-kit/src/mermaid/markdown-selectors.ts` 维护 **单一真源**，并由 `@dnhyxc-ai/markdown-kit` 主入口导出，例如：

- **扫描渲染入口**：`MERMAID_MARKDOWN_ENTRY_SELECTOR`（供 `runMermaidInMarkdownRoot` 内部 `querySelectorAll` 使用）
- **读已渲染 SVG**：`MERMAID_MARKDOWN_SVG_SELECTOR`（预览/下载）
- **向上定位 wrap**：`closestMermaidMarkdownWrap`（点击委托；要求 **`data-mermaid="1"`**，比只匹配 class 更严格）
- **空壳 HTML**：`MARKDOWN_MERMAID_PLACEHOLDER_HTML`（`MermaidFenceIsland` 离屏/宿主初始化）
- **Tailwind**：`MARKDOWN_MERMAID_TAILWIND_CURSOR_ZOOM_IN_CLASS`（Monaco 预览 / 岛内 hover 光标）

**文档入口**：更系统的 API 表与动机见 `docs/tools/索引.md` **§11.2.1**；使用者速查见 `docs/tools/使用指南.md` **§8.5**。

**实现源码（每行行尾 `//` 中文注释）**：完整契约模块、`runMermaidInMarkdownRoot`、`patchMermaidFence` 节选、岛/Hook/工具栏节选，统一收录在 `docs/tools/索引.md` **§11.2.2**。
下文 **§6** 的 Hook 示例块也已改为「行尾注释风格」，便于与 `apps/frontend/src/hooks/useMermaidImagePreview.tsx` 对照阅读。

---

## 1. 总体架构

当前仓库存在 **两条并列的 Mermaid 渲染路径**（由「正文里是否出现 ```mermaid 围栏」与宿主 UI 决定）：

### 路径 A：整段 HTML 占位 + 根级扫描（无围栏拆分）

适用于 **Monaco 预览** 在正文 **不含** mermaid 围栏时，或其它仍使用「单次 `parser.render` + 整块 `innerHTML`」的页面。

```text
Markdown 源码
    ↓
MarkdownParser.patchMermaidFence → 占位 HTML（wrap + `data-mermaid="1"` + `.mermaid`；契约常量见 `mermaid/markdown-selectors.ts`）
    ↓
dangerouslySetInnerHTML 写入预览根节点
    ↓
useMermaidInMarkdownRoot（双 rAF）→ runMermaidInMarkdownRoot → mermaid.run({ nodes })
    ↓
[可选] attachMermaidZoomUiInRoot：工具栏 + viewport + transform
    ↓
useMermaidDiagramClickPreview：点击 SVG → data URL → ImagePreview
```

### 路径 B：围栏拆分 + Mermaid 岛（聊天流式、Monaco 含 mermaid 时）

适用于 **助手消息流式**（`StreamingMarkdownBody`）以及 **Monaco `ParserMarkdownPreviewPane`** 在正文含 ` ```mermaid ` 围栏时。动机是避免 **整段 `innerHTML` 替换** 冲掉已渲染的 SVG，或与 `mermaid.run` 的时序竞态；同时保证普通代码块（尤其列表内 ` ```ts`）在拆分后仍能被稳定渲染。

```text
Markdown 源码
    ↓
MarkdownParser.splitForMermaidIslands（markdown-it parse）→ 交替的 { markdown 段 | mermaid 岛 }
    ↓
markdown 段：MarkdownParser（enableMermaid: false）→ 小段 innerHTML（无 mermaid 占位）
    ↓
mermaid 段：MermaidFenceIsland → 离屏渲染（可测量）→ 成功才提交 SVG（避免“错误 SVG”闪烁）
    ↓
流式尾部未闭合 mermaid：按行规则仅探测“尾部开放 mermaid” → MermaidFenceIsland（节流 + 成功才提交）
    ↓
useMermaidDiagramClickPreview（岛 host 或预览根）：点击 SVG → ImagePreview
```

**Mermaid 围栏顶栏（sticky + 粘顶双态样式 + 下载）**：见独立说明 [围栏工具条吸顶.md](./围栏工具条吸顶.md)（`MermaidFenceToolbar` + `StreamingMarkdownBody`；Monaco / 知识库预览见 **§12**；**下载**见 **§13**）。

- **渲染入口（路径 A）**：`MarkdownParser` 在 `enableMermaid !== false` 时对 ` ```mermaid ` 输出占位节点；`escapeHtml` 之前经 **`normalizeMermaidFenceBody`** 做换行统一与部分方括号文案补引号（见 **§7.5**）。
- **渲染入口（路径 B）**：岛内用 **`textContent = normalizeMermaidFenceBody(code)`** 写入 DSL，再 **`runMermaidInMarkdownRoot(host)`**；根节点上的 **`useMermaidInMarkdownRoot` 通过 `parser.enableMermaid: false` 关闭**，避免重复扫描。
- **全局队列**：`mermaid/in-markdown.ts` 内 `runQueue` 串行化 `mermaid.run`。
- **缩放（可选）**：见 **§3、§4** 参考实现（带缩放壳 DOM）。
- **预览（当前仓库）**：`mermaidSvgToPreviewDataUrl` + `ImagePreview`；点击委托忽略 `.markdown-mermaid-zoom-chrome`（**§6**）。

> **与当前仓库对齐**：`packages/markdown-kit` 为「单层 `wrap` + `.mermaid`」的 `patchMermaidFence` + `normalizeMermaidFenceBody`；`mermaid/in-markdown.ts` 为精简版。**§3、§4** 为「带缩放壳」的参考实现。**§7** 描述 **围栏拆分 + `MermaidFenceIsland`** 的完整实现与逐行注释代码。**§8** 描述 **Monaco `ParserMarkdownPreviewPane`** 如何在路径 A / B 间切换。

---

## 2. 占位 DOM 约定（缩放版）

缩放能力要求 **不要把 `.mermaid` 直接放在 `overflow` 容器里硬裁切**，而是：

| 层级   | class                                        | 作用                                                 |
| ------ | -------------------------------------------- | ---------------------------------------------------- |
| 根     | `markdown-mermaid-wrap` + `data-mermaid="1"` | 与 `mermaid.run` 选择器一致；一块图一个 wrap         |
| 工具栏 | `markdown-mermaid-zoom-chrome`               | 放 − / 恢复 / + 按钮                                 |
| 视口   | `markdown-mermaid-zoom-viewport`             | `overflow: hidden`，限制可见区域与最大高度           |
| 舞台   | `markdown-mermaid-zoom-stage`                | `transform: translate + scale`，拖拽与缩放作用在此层 |
| 内容   | `.mermaid`                                   | Mermaid 官方约定入口，`mermaid.run` 只往这里写 SVG   |

**简化版（当前 parser 常见输出）**：仅 `wrap > .mermaid`，无工具栏；此时只能依赖外层 CSS（如 `overflow-x: auto`）或另做「点击预览」。

---

## 3. 围栏 HTML 生成（参考：`mermaid-fence-html`）

下列函数与 **markdown-it fence** 中 `escapeHtml(body)` 后的字符串拼接等价，**逐行注释**说明每一行字符串的职责。

```typescript
/**
 * Mermaid 围栏占位：预置工具栏槽、viewport、stage，便于缩放/拖拽只绑事件、不移动 .mermaid 节点。
 */

export function buildMermaidFenceHtml(escapedBody: string): string {
	return (
		'<div class="markdown-mermaid-wrap" data-mermaid="1">' + // 外层：run 与 attach 扫描的块根节点
		'<div class="markdown-mermaid-zoom-chrome" data-mermaid-zoom-chrome="1"></div>' + // 工具栏容器（初始空，由 JS 填按钮）
		'<div class="markdown-mermaid-zoom-viewport">' + // 裁剪视口，大图只在此区域内可见
		'<div class="markdown-mermaid-zoom-stage">' + // 应用 translate/scale 的层
		'<div class="mermaid">' + // Mermaid 写入 SVG 的目标节点
		escapedBody + // 已转义的 DSL 文本，防 XSS
		"</div></div></div></div>\n" // 依次闭合 mermaid / stage / viewport / wrap
	);
}

/** 空 DSL 容器；与 buildMermaidFenceHtml 结构一致（聊天流式「岛」用 innerHTML 再填 text） */
export const MERMAID_ISLAND_SHELL_HTML =
	'<div class="markdown-mermaid-wrap" data-mermaid="1">' +
	'<div class="markdown-mermaid-zoom-chrome" data-mermaid-zoom-chrome="1"></div>' +
	'<div class="markdown-mermaid-zoom-viewport">' +
	'<div class="markdown-mermaid-zoom-stage">' +
	'<div class="mermaid"></div>' +
	"</div></div></div>";
```

在 `MarkdownParser.patchMermaidFence` 中，将 ` ```mermaid ` 分支的 `return` 改为调用 `buildMermaidFenceHtml(body)` 即可与缩放脚本对齐。

---

## 4. 缩放 UI 脚本（参考：`mermaid-zoom-ui.ts`）逐行说明

逻辑要点：

1. **`WeakSet<HTMLElement> wiredWraps`**：每个 `wrap` 只 `wireZoomUi` 一次，幂等；失败时从 Set 删除以便重试。
2. **`setupWrap`**：若已有 viewport/stage（来自 HTML），补全 chrome 后绑定；否则从「旧结构 wrap > .mermaid」升级为四层结构（与历史 HTML 兼容）。
3. **`wireZoomUi`**：`ensureToolbar` 创建 − / ⌂ / +；`scale` 用乘法因子步进；`scale === 1` 时清零平移并去掉拖拽样式。
4. **无 `wheel` 监听**：避免与页面滚动抢事件。

下列为 **带行尾 `//` 注释** 的参考实现（可直接粘贴为 `mermaid-zoom-ui.ts` 再按项目微调）；与历史分支中的完整实现一致。

```typescript
const VIEWPORT_CLS = "markdown-mermaid-zoom-viewport"; // 视口节点 class，与 HTML/CSS 一致
const STAGE_CLS = "markdown-mermaid-zoom-stage"; // 舞台节点 class，transform 作用目标
const CHROME_CLS = "markdown-mermaid-zoom-chrome"; // 工具栏容器 class
const BTN_CLS = "markdown-mermaid-zoom-btn"; // 按钮统一 class，便于主题覆盖
const MIN_SCALE = 0.25; // 最小缩放比例
const MAX_SCALE = 4; // 最大缩放比例
const ZOOM_FACTOR = 1.15; // 每次放大/缩小乘以或除以的因子
const SCALE_EPS = 1e-4; // 与 1 比较的浮点容差

const wiredWraps = new WeakSet<HTMLElement>(); // 已绑定 UI 的 wrap，防止重复 addEventListener

function isZoomed(scale: number): boolean {
	return Math.abs(scale - 1) > SCALE_EPS; // 是否视为「已缩放」，用于开启拖拽与 UI 状态
}

function getDirectMermaidChild(wrap: HTMLElement): HTMLElement | null {
	for (let i = 0; i < wrap.children.length; i++) {
		const el = wrap.children[i]; // 只认「直接子节点」中的 .mermaid（兼容未包 viewport 的旧 DOM）
		if (el instanceof HTMLElement && el.classList.contains("mermaid"))
			return el;
	}
	return null;
}

function ensureToolbar(chrome: HTMLElement) {
	// 若 HTML 已带三个按钮则复用，否则清空并创建 − / 恢复 / +
	let btnOut = chrome.querySelector<HTMLButtonElement>(
		'button[data-mermaid-zoom-action="out"]',
	);
	let btnReset = chrome.querySelector<HTMLButtonElement>(
		'button[data-mermaid-zoom-action="reset"]',
	);
	let btnIn = chrome.querySelector<HTMLButtonElement>(
		'button[data-mermaid-zoom-action="in"]',
	);
	if (btnOut && btnReset && btnIn) return { btnOut, btnReset, btnIn };
	chrome.textContent = ""; // 清空占位
	chrome.setAttribute("role", "toolbar"); // 无障碍
	chrome.setAttribute("aria-label", "Mermaid 图表缩放");
	// 以下 style 保证条可见、可点、横向右对齐（具体项目可迁到 CSS）
	chrome.style.cssText =
		"display:flex!important;gap:6px;justify-content:flex-end;align-items:center;margin:0 0 8px;flex-shrink:0;position:relative;z-index:20;pointer-events:auto;width:100%;box-sizing:border-box;min-height:36px;visibility:visible!important;opacity:1!important;";
	const dark =
		typeof document !== "undefined" &&
		document.body?.classList.contains("dark");
	const mk = (
		action: string,
		label: string,
		text: string,
	): HTMLButtonElement => {
		const b = document.createElement("button");
		b.type = "button"; // 避免表单提交
		b.className = BTN_CLS;
		b.dataset.mermaidZoomAction = action; // out | reset | in
		b.title = label;
		b.setAttribute("aria-label", label);
		b.textContent = text;
		b.style.cssText = dark
			? "box-sizing:border-box;min-width:32px;height:32px;padding:0 8px;font-size:15px;line-height:1;border:1px solid rgba(200,200,200,.45);background:rgba(45,45,50,.96);color:#f0f0f0;cursor:pointer;border-radius:6px;opacity:1!important;"
			: "box-sizing:border-box;min-width:32px;height:32px;padding:0 8px;font-size:15px;line-height:1;border:1px solid rgba(100,100,100,.55);background:rgba(240,240,245,.95);color:#1a1a1a;cursor:pointer;border-radius:6px;opacity:1!important;";
		return b;
	};
	btnOut = mk("out", "缩小", "−");
	btnReset = mk("reset", "恢复", "⌂");
	btnIn = mk("in", "放大", "+");
	chrome.append(btnOut, btnReset, btnIn);
	return { btnOut, btnReset, btnIn };
}

function wireZoomUi(
	viewport: HTMLElement,
	stage: HTMLElement,
	chrome: HTMLElement,
): void {
	const { btnOut, btnReset, btnIn } = ensureToolbar(chrome);
	viewport.style.overflow = "hidden"; // 裁剪溢出 SVG
	viewport.style.minHeight = "120px"; // 空图时占位高度
	viewport.style.maxHeight = "min(70vh, 560px)"; // 限制单图最大高度，避免撑满屏
	viewport.style.boxSizing = "border-box"; // 含 border 的尺寸计算
	viewport.style.borderRadius = "6px"; // 圆角与描边在 CSS 或下行补充
	viewport.style.border = document.body?.classList.contains("dark")
		? "1px solid rgba(200,200,200,.35)" // 暗色主题描边
		: "1px solid rgba(100,100,100,.35)"; // 亮色主题描边
	stage.style.transformOrigin = "0 0"; // 缩放锚点在左上，便于与 translate 组合

	let scale = 1; // 当前缩放比例，1 为原始大小
	let tx = 0; // 舞台水平平移（像素）
	let ty = 0; // 舞台垂直平移（像素）

	const applyTransform = (): void => {
		stage.style.transform = `translate(${tx}px, ${ty}px) scale(${scale})`; // 先平移后缩放
	};

	const syncInteractionChrome = (): void => {
		const zoomed = isZoomed(scale);
		viewport.classList.toggle("is-mermaid-zoom-draggable", zoomed); // CSS 中 cursor: grab
		if (!zoomed) {
			viewport.classList.remove("is-mermaid-zoom-dragging");
			tx = 0;
			ty = 0;
			applyTransform(); // 恢复 = 归一化平移
		}
	};

	const zoomAtCenter = (nextScale: number): void => {
		const clamped = Math.min(MAX_SCALE, Math.max(MIN_SCALE, nextScale));
		const cx = viewport.clientWidth / 2; // 以视口中心为锚做近似 zoom-to-center（可按项目细化）
		const cy = viewport.clientHeight / 2;
		const k = clamped / scale;
		tx = cx - (cx - tx) * k;
		ty = cy - (cy - ty) * k;
		scale = clamped;
		applyTransform();
		syncInteractionChrome();
	};

	btnOut.addEventListener("click", () => zoomAtCenter(scale / ZOOM_FACTOR)); // 缩小一档
	btnIn.addEventListener("click", () => zoomAtCenter(scale * ZOOM_FACTOR)); // 放大一档
	btnReset.addEventListener("click", () => {
		scale = 1; // 比例复位
		tx = 0; // 平移复位
		ty = 0;
		applyTransform();
		syncInteractionChrome();
	});

	let dragging = false; // 是否处于拖拽中
	let startX = 0; // pointerdown 时指针 X
	let startY = 0; // pointerdown 时指针 Y
	let startTx = 0; // pointerdown 时已有的 tx
	let startTy = 0; // pointerdown 时已有的 ty

	viewport.addEventListener("pointerdown", (e) => {
		if (!isZoomed(scale)) return; // 仅缩放后可拖
		if (e.button !== 0) return; // 仅主键
		dragging = true;
		viewport.setPointerCapture(e.pointerId); // 拖出视口仍收事件
		startX = e.clientX;
		startY = e.clientY;
		startTx = tx;
		startTy = ty;
		viewport.classList.add("is-mermaid-zoom-dragging");
	});

	viewport.addEventListener("pointermove", (e) => {
		if (!dragging || !isZoomed(scale)) return;
		tx = startTx + (e.clientX - startX);
		ty = startTy + (e.clientY - startY);
		applyTransform();
	});

	const endDrag = (e: PointerEvent): void => {
		if (!dragging) return;
		dragging = false;
		viewport.classList.remove("is-mermaid-zoom-dragging");
		try {
			viewport.releasePointerCapture(e.pointerId);
		} catch {
			/* 忽略重复 release */
		}
	};
	viewport.addEventListener("pointerup", endDrag);
	viewport.addEventListener("pointercancel", endDrag);

	applyTransform();
	syncInteractionChrome();
}

function setupWrap(wrap: HTMLElement): void {
	if (wiredWraps.has(wrap)) return; // 已处理过则跳过

	let viewport = wrap.querySelector<HTMLElement>(`.${VIEWPORT_CLS}`);
	let stage = wrap.querySelector<HTMLElement>(`.${STAGE_CLS}`);
	let chrome = wrap.querySelector<HTMLElement>(`.${CHROME_CLS}`);

	if (viewport && stage) {
		if (!chrome) {
			chrome = document.createElement("div");
			chrome.className = CHROME_CLS;
			chrome.setAttribute("data-mermaid-zoom-chrome", "1");
			wrap.insertBefore(chrome, viewport); // 工具栏在视口上方
		}
		wiredWraps.add(wrap);
		try {
			wireZoomUi(viewport, stage, chrome);
		} catch {
			wiredWraps.delete(wrap); // 绑定失败允许下次重试
		}
		return;
	}

	const mermaidEl = getDirectMermaidChild(wrap); // 旧结构：wrap 下直接 .mermaid
	if (!mermaidEl) return;

	chrome = document.createElement("div");
	chrome.className = CHROME_CLS;
	chrome.setAttribute("data-mermaid-zoom-chrome", "1");
	viewport = document.createElement("div");
	viewport.className = VIEWPORT_CLS;
	stage = document.createElement("div");
	stage.className = STAGE_CLS;
	wrap.removeChild(mermaidEl); // 从 wrap 摘下 .mermaid
	stage.appendChild(mermaidEl); // 放入 stage
	viewport.appendChild(stage);
	wrap.appendChild(chrome); // 先条后图或按设计 insertBefore
	wrap.appendChild(viewport);
	wiredWraps.add(wrap);
	try {
		wireZoomUi(viewport, stage, chrome);
	} catch {
		wiredWraps.delete(wrap);
	}
}

/** 在 root 子树内为每个 .markdown-mermaid-wrap 挂载缩放条与视口交互（幂等） */
export function attachMermaidZoomUiInRoot(root: HTMLElement): void {
	const wraps = root.querySelectorAll<HTMLElement>(".markdown-mermaid-wrap"); // 子树内所有 Mermaid 块
	for (let i = 0; i < wraps.length; i++) {
		setupWrap(wraps[i]); // 每块独立 wiredWraps 记录，互不干扰
	}
}
```

### 4.0 配套样式（参考：`mermaid-zoom-ui.css`）逐行说明

```css
/* Mermaid：按钮缩放 + 仅缩放后可拖拽（无滚轮缩放） */

.markdown-mermaid-wrap[data-mermaid="1"] {
	position: relative; /* 子元素 z-index、定位参照 */
}

.markdown-mermaid-zoom-chrome {
	display: flex; /* 横向排列按钮 */
	gap: 6px;
	justify-content: flex-end; /* 工具栏靠右 */
	align-items: center;
	margin: 0 0 8px; /* 与下方视口间距 */
	min-height: 36px;
	pointer-events: auto; /* 防止被父级 pointer-events:none 误伤 */
	position: relative;
	z-index: 20;
	flex-shrink: 0;
	width: 100%;
	box-sizing: border-box;
}

.markdown-mermaid-zoom-btn:hover {
	filter: brightness(0.95); /* 轻微悬停反馈 */
}

.markdown-mermaid-zoom-viewport {
	overflow: hidden; /* 裁剪放大后的 SVG */
	cursor: default;
	min-height: 120px;
	max-height: min(70vh, 560px);
	border-radius: 6px;
	border: 1px solid color-mix(in srgb, currentColor 14%, transparent); /* 随正文色弱描边 */
	box-sizing: border-box;
}

.markdown-mermaid-zoom-viewport.is-mermaid-zoom-draggable {
	cursor: grab; /* 可拖提示 */
	touch-action: none; /* 避免触屏滚动抢走拖拽 */
	user-select: none;
	-webkit-user-select: none;
}

.markdown-mermaid-zoom-viewport.is-mermaid-zoom-dragging {
	cursor: grabbing; /* 拖拽中 */
}

.markdown-mermaid-zoom-stage {
	transform-origin: 0 0; /* 与 JS 一致 */
	will-change: transform; /* 提示合成层，拖拽更顺 */
}

.markdown-mermaid-zoom-viewport .markdown-mermaid-zoom-stage svg {
	max-width: none !important; /* 覆盖正文里对 svg 的 max-width，否则放大被压扁 */
	height: auto;
	display: block;
}

body.dark .markdown-mermaid-zoom-chrome button.markdown-mermaid-zoom-btn {
	border-color: rgba(200, 200, 200, 0.45) !important;
	background: rgba(45, 45, 45, 0.96) !important;
	color: #f0f0f0 !important;
}
```

### 4.1 与 `runMermaidInMarkdownRoot` 的衔接（参考）

在 `runMermaidInMarkdownRoot` **开头**与 **`await runQueue` 之后**各调用一次 `attachMermaidZoomUiInRoot(root)`（且由 `enableMermaidZoomUi !== false` 控制），可减轻「全局队列排队导致工具栏晚于 SVG 出现」的观感问题；并在 `useMermaidInMarkdownRoot` 的 `useLayoutEffect` 内、**双 rAF 之前**对 `rootRef.current` 再调一次，保证与 `innerHTML` 同一帧尽量挂上条。

导出：`packages/markdown-kit/src/react/index.ts` 导出 `attachMermaidZoomUiInRoot`；样式 `mermaid-zoom-ui.css` 经 `scripts/build-mk-css.js` 并入 `markdown-base.css` / `markdown-styles.css`，宿主另可 `import '@dnhyxc-ai/markdown-kit/mermaid-zoom-ui.css'`（以 `package.json` exports 为准）。

### 4.2 助手气泡内可点击（参考：`index.css`）

若外层对 `.markdown-body a` 等设置了 `pointer-events: none`，需对 **`.markdown-mermaid-zoom-chrome` 及其 button** 设回 `pointer-events: auto !important`，否则缩放按钮无法点击。

---

## 5. 工具函数：`mermaidSvgToPreviewDataUrl`（仓库：`apps/frontend/src/utils/mermaidImagePreview.ts`）

逐行说明（与源文件一致）。

```typescript
/**
 * Mermaid 图表点击放大预览：将 DOM 中的 SVG 转为 ImagePreview（<img>）可用的 data URL。
 */

/** 将 Mermaid 渲染得到的 SVG 转为可在 ImagePreview（<img>）中使用的 data URL */
export function mermaidSvgToPreviewDataUrl(svg: SVGElement): string | null {
	try {
		const clone = svg.cloneNode(true) as SVGSVGElement; // 克隆，避免改动页面上正在显示的节点
		if (!clone.getAttribute("xmlns")) {
			clone.setAttribute("xmlns", "http://www.w3.org/2000/svg"); // 独立成 XML 片段时补默认命名空间
		}
		const xml = new XMLSerializer().serializeToString(clone); // 序列化为字符串
		return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(xml)}`; // 编码后作为 img.src，避免裸 XML 断行问题
	} catch {
		return null; // 克隆或序列化失败则放弃预览
	}
}
```

---

## 6. Hooks：`useMermaidImagePreview` / `useMermaidDiagramClickPreview`（仓库：`apps/frontend/src/hooks/useMermaidImagePreview.tsx`）

```typescript
import ImagePreview from '@design/ImagePreview'; // 全屏/弹层图片预览组件（宿主 UI）
import {
	closestMermaidMarkdownWrap, // 向上查找契约 wrap：含 data-mermaid="1"，避免仅 class 误匹配
	MERMAID_ENTRY_SELECTOR, // `.mermaid`：拼接 `${MERMAID_ENTRY_SELECTOR} svg` 取主 SVG
} from '@dnhyxc-ai/markdown-kit'; // 工具包主入口：与 MarkdownParser / mermaid-in-markdown 同源契约
import {
	type ReactNode, // 模态节点类型：ImagePreview 作为 ReactNode 挂到树中
	type RefObject, // React ref 类型：委托根的 ref
	useCallback, // 稳定回调引用：减少子组件不必要渲染
	useEffect, // 浏览器端绑定 click：仅在 enabled 时注册
	useRef, // 保存最新 open 函数：避免 effect 依赖 open 导致频繁解绑
	useState, // 预览用 data URL：null 表示关闭
} from 'react';
import { mermaidSvgToPreviewDataUrl } from '@/utils/mermaidImagePreview'; // SVG → data URL：与下载管线复用序列化逻辑

export type UseMermaidImagePreviewResult = {
	openMermaidPreview: (dataUrl: string) => void; // 外部或委托逻辑调用以打开弹层
	mermaidImagePreviewModal: ReactNode; // 需渲染到组件树中的 ImagePreview
};

export function useMermaidImagePreview(): UseMermaidImagePreviewResult {
	const [previewUrl, setPreviewUrl] = useState<string | null>(null); // null：弹层关闭；非 null：当前预览 data URL

	const openMermaidPreview = useCallback((dataUrl: string) => {
		setPreviewUrl(dataUrl); // 外部（点击委托/工具栏）调用：写入预览 URL
	}, []); // 无依赖：setState 稳定

	const onPreviewVisibleChange = useCallback((visible: boolean) => {
		if (!visible) setPreviewUrl(null); // 弹层关闭：清空 URL，避免下次打开残留旧图
	}, []);

	const onDownload = useCallback((image: { url: string }) => {
		const a = document.createElement('a'); // 传统下载触发器：兼容 Web 环境
		a.href = image.url; // href 可为 data URL：浏览器会按 download 文件名落盘
		a.download = 'mermaid-diagram.svg'; // 默认文件名：产品可改为带时间戳
		a.rel = 'noopener'; // 安全：避免 target=_blank 类问题（此处虽为 download，仍保持习惯）
		a.click(); // 程序化点击：立即触发下载
	}, []);

	const mermaidImagePreviewModal = (
		<ImagePreview
			visible={previewUrl !== null} // 有 URL 即显示弹层
			selectedImage={previewUrl ? { url: previewUrl } : { url: '' }} // ImagePreview 需要对象形态：无选中时给空串占位
			onVisibleChange={onPreviewVisibleChange} // 弹层显隐：关闭时同步清空 previewUrl
			title="Mermaid 图表预览" // 弹层标题：产品文案
			showDownload // 展示下载按钮：走 onDownload（仓库实现内接 downloadMermaidPreviewSvg）
			download={onDownload} // 下载回调：入参含 url（data URL / https 等）
		/>
	);

	return { openMermaidPreview, mermaidImagePreviewModal };
}

export function useMermaidDiagramClickPreview(
	rootRef: RefObject<HTMLElement | null>, // 委托根：Monaco 预览容器或 MermaidFenceIsland 的 host
	openMermaidPreview: (dataUrl: string) => void, // 打开预览：通常来自 useMermaidImagePreview
	enabled: boolean, // 是否启用点击预览：与 enableMermaid 等产品开关对齐
	rebindWhen: unknown, // 重新绑定触发器：html/code 变化时 effect 重跑，避免旧监听挂在被替换 DOM 上
): void {
	const openRef = useRef(openMermaidPreview); // ref 保存最新回调：避免 effect 依赖 open 造成频繁解绑
	openRef.current = openMermaidPreview; // 每次 render 写入最新函数指针

	useEffect(() => {
		if (!enabled) return; // 未启用：不注册监听，避免无意义开销
		const root = rootRef.current; // 取出当前委托根（可能随渲染变化）
		if (!root) return; // ref 尚未挂载：跳过

		const onClick = (e: MouseEvent) => {
			const el = e.target as HTMLElement | null; // 事件目标：可能是 svg/path/text 等
			if (!el) return; // 无目标：忽略
			if (el.closest('.markdown-mermaid-zoom-chrome')) return; // 缩放条区域：避免与预览手势冲突

			const wrap = closestMermaidMarkdownWrap(el); // 命中契约 wrap：同屏多图时定位到当前块
			if (!wrap) return; // 不在 Mermaid 块内：忽略普通点击

			const svg = wrap.querySelector(
				`${MERMAID_ENTRY_SELECTOR} svg`,
			) as SVGSVGElement | null; // 取该块主 SVG：与 MERMAID_MARKDOWN_SVG_SELECTOR 等价（wrap 已确定）
			if (!svg || !svg.contains(el)) return; // 必须点击发生在 SVG 子树：避免点到 wrap 空白触发预览

			const url = mermaidSvgToPreviewDataUrl(svg); // 序列化为 data URL
			if (url) openRef.current(url); // 打开弹层预览
		};

		root.addEventListener('click', onClick); // 捕获阶段默认 false：在冒泡阶段处理即可
		return () => root.removeEventListener('click', onClick); // 卸载或依赖变化：移除监听，防泄漏
	}, [enabled, rebindWhen, rootRef]); // 依赖：enabled/rebind 变化需要重绑；rootRef 对象 identity 稳定即可
}
```

---

## 7. 围栏拆分与 Mermaid 岛：完整实现思路与逐行注释代码

本节对应 **路径 B**（见 **§1**）：聊天助手 **流式正文** 与 **Monaco Markdown 预览** 在检测到 ```mermaid 围栏时，将 Mermaid 从「整页 `innerHTML`」中拆出，用独立 React 子树（**岛**）承载 DOM 与 `runMermaidInMarkdownRoot`，从而：

- 避免父级频繁 `dangerouslySetInnerHTML` **整段替换**导致已生成的 SVG 被清空或闪烁；
- 让每一块图的 **DSL 变更** 只触发 **本岛** 的 `useLayoutEffect`，与 `useMermaidInMarkdownRoot` 的全局扫描解耦；
- **未闭合** 的 mermaid 围栏（流式尾部）只显示静态代码（`mermaidStreamingFallbackHtml`），不调用 `mermaid.run`，避免半成品 DSL 反复报错与闪烁。

**模块关系（更新版）**：

```text
MarkdownParser.splitForMermaidIslands（markdown-it parse）
  → StreamingMarkdownBody（聊天按段渲染）
    → MermaidFenceIsland（单块图：离屏渲染 + 成功才提交）
      → normalizeMermaidFenceBody（DSL 预处理）
      → runMermaidInMarkdownRoot（内部 mermaid.run + 串行队列）
```

---

### 7.1 `splitMarkdownByCodeFences`（`apps/frontend/src/utils/splitMarkdownFences.ts`）

仅识别 **顶格** ` ``` ` 围栏（与 markdown-it 常见写法一致）。`mermaid` 且缺少闭合围栏时，`complete: false`。

> **重要更新（2026-04）**：聊天流式正文已不再依赖本节的 `splitMarkdownByCodeFences` 作为主拆分器。
> 原因是它属于“按行扫描围栏”的纯函数实现，遇到 **列表内代码块**、**闭合行缩进不一致**、或 **段与段拼接丢失换行** 时，
> 容易把 ` ```typescript ` 等普通代码块拆坏，表现为“代码块无法渲染/后续正文被吞进围栏”。
>
> 目前聊天采用 `MarkdownParser.splitForMermaidIslands`（见下节 **§7.1.1**），本文件主要保留：
> - `mermaidStreamingFallbackHtml`（流式尾部 DSL 预览）
> - 旧页面/工具函数兼容入口（可逐步迁移）

```typescript
/**
 * 按顶格代码围栏拆分 Markdown，将 mermaid 与其它内容分离。
 * 用于聊天流式：Mermaid 单独 React 岛渲染，避免整段 dangerouslySetInnerHTML 冲掉已生成的 SVG。
 */

export type MarkdownFencePart =
	| { type: 'markdown'; text: string } // 非 mermaid 围栏聚合后的正文片段
	| { type: 'mermaid'; text: string; complete: boolean }; // mermaid 围栏 body；complete 表示是否已闭合

function coalesceMarkdownParts(
	parts: MarkdownFencePart[],
): MarkdownFencePart[] {
	const out: MarkdownFencePart[] = [];
	for (const p of parts) {
		if (p.type === 'markdown' && p.text === '') continue; // 去掉空 md 段，减少无效节点
		const last = out[out.length - 1];
		if (p.type === 'markdown' && last?.type === 'markdown') {
			last.text += p.text; // 相邻 md 段合并，稳定 map key 与 DOM 块数
		} else {
			out.push(
				p.type === 'markdown' ? { type: 'markdown', text: p.text } : { ...p },
			);
		}
	}
	return out;
}

/**
 * 扫描 ```lang 围栏；mermaid 且未闭合时 `complete: false`（流式尾部）。
 */
export function splitMarkdownByCodeFences(source: string): MarkdownFencePart[] {
	const out: MarkdownFencePart[] = [];
	let i = 0; // 当前扫描指针
	const n = source.length;

	while (i < n) {
		const fenceStart = source.indexOf('```', i); // 下一个围栏起点
		if (fenceStart === -1) {
			const tail = source.slice(i);
			if (tail) out.push({ type: 'markdown', text: tail }); // 剩余全是 md
			break;
		}
		if (fenceStart > i) {
			out.push({ type: 'markdown', text: source.slice(i, fenceStart) }); // 围栏前的 md
		}
		const langEnd = source.indexOf('\n', fenceStart + 3); // 语言行结束
		if (langEnd === -1) {
			out.push({ type: 'markdown', text: source.slice(fenceStart) }); // 畸形：无换行，整段当 md
			break;
		}
		const lang = source
			.slice(fenceStart + 3, langEnd)
			.trim()
			.toLowerCase(); // 围栏语言标记，如 mermaid
		const bodyStart = langEnd + 1; // body 起始（跳过首 newline）
		const closeIdx = source.indexOf('```', bodyStart); // 闭合围栏
		if (closeIdx === -1) {
			if (lang === 'mermaid') {
				out.push({
					type: 'mermaid',
					text: source.slice(bodyStart),
					complete: false, // 流式未闭合：不跑 Mermaid
				});
			} else {
				out.push({ type: 'markdown', text: source.slice(fenceStart) }); // 其它语言未闭合：保持原样 md
			}
			break;
		}
		const body = source.slice(bodyStart, closeIdx); // 围栏内原文（不含 ```）
		if (lang === 'mermaid') {
			out.push({ type: 'mermaid', text: body, complete: true });
		} else {
			out.push({
				type: 'markdown',
				text: source.slice(fenceStart, closeIdx + 3), // 非 mermaid 围栏整体保留为 md，交给 MarkdownParser
			});
		}
		i = closeIdx + 3; // 继续扫描闭合 ``` 之后
	}

	if (out.length === 0 && source) {
		out.push({ type: 'markdown', text: source }); // 全文无围栏
	}
	return coalesceMarkdownParts(out);
}

function escapeHtml(s: string): string {
	return s
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;');
}

/** 未闭合 mermaid 围栏：纯代码预览（不跑 Mermaid，避免语法不完整报错与整页重绘） */
export function mermaidStreamingFallbackHtml(code: string): string {
	const esc = escapeHtml(code);
	return `<div class="markdown-body"><pre class="chat-md-mermaid-streaming"><code class="language-mermaid">${esc}</code></pre></div>`;
}
```

---

### 7.1.1 `MarkdownParser.splitForMermaidIslands`：与渲染器同源的拆分（推荐）

位置：`packages/markdown-kit/src/markdown/parser.ts`

实现要点：

- **使用 markdown-it 的 `parse()`** 获取 fence token，再按 `token.map` 从源码切片，保证拆分边界与 `render()` 一致；
- **切片必须保留“段末换行”**：否则 `### 标题\n` 与下一段 ```lang 会粘连成同一行，围栏失效（普通代码块不渲染）。

摘录（示意）：

```typescript
// 按行号截取原文行块；若后面还有行（b < lineCount），段末补一个 \n
const sliceLines = (a: number, b: number) => {
  const body = lines.slice(a, b).join('\n');
  return b < lineCount ? `${body}\n` : body;
};

// fence token.map 的 [startLine, endLine) 与 sliceLines 对齐：
// - lang === 'mermaid' → 输出 { type:'mermaid', text: token.content, complete:true }
// - 其它 fence → 输出 { type:'markdown', text: rawFence } 交给 parser.render
```

### 7.2 `MermaidFenceIsland`（`apps/frontend/src/components/design/MermaidFenceIsland/index.tsx`）

单块 mermaid 的 **宿主 div**：当前仓库采用“**离屏渲染 + 成功才提交**”方案，满足：

- **流式边输出边出图**：DSL 逐步完善时持续尝试渲染；
- **不闪烁**：遇到“错误提示 SVG”（如 `Syntax error in text`）不提交到真实 DOM，保留上一帧；
- **类图/甘特图可渲染**：离屏容器必须可测量（`opacity:0` 且有足够宽高），避免 bbox 为 0；
- **不影响普通代码块**：本组件只处理 Mermaid 岛，不触达 markdown 段的 `parser.render`。

```typescript
/**
 * 单块 ```mermaid 围栏：独立 DOM 岛 + runMermaidInMarkdownRoot，
 * 避免父级整段 dangerouslySetInnerHTML 替换冲掉 SVG。
 */

import { normalizeMermaidFenceBody } from '@dnhyxc-ai/markdown-kit'; // DSL 预处理（换行、部分方括号补引号）
import { runMermaidInMarkdownRoot } from '@dnhyxc-ai/markdown-kit/react'; // 在 host 子树内 mermaid.run（内部有串行队列）
import { memo, useLayoutEffect, useRef } from 'react';
import { useMermaidDiagramClickPreview } from '@/hooks/useMermaidImagePreview'; // 点击 SVG → 大图预览
import { cn } from '@/lib/utils';

export type MermaidFenceIslandProps = {
	code: string; // 单块围栏 body（不含 ```）
	preferDark: boolean; // 与主题联动，传入 mermaid.initialize 风格由 run 内部处理
	/** 流式中间态时抑制 Mermaid 报错闪烁 */
	isStreaming?: boolean;
	openMermaidPreview?: (dataUrl: string) => void; // 可选：启用点击放大
};

const noopOpenPreview = (_dataUrl: string) => {}; // 无回调时给 hook 的稳定函数

export const MermaidFenceIsland = memo(function MermaidFenceIsland({
	code,
	preferDark,
	isStreaming = false,
	openMermaidPreview,
}: MermaidFenceIslandProps) {
	const hostRef = useRef<HTMLDivElement>(null); // 外层宿主（稳定 ref）
	const genRef = useRef(0); // 代数：作废过期渲染
	const lastRunAtRef = useRef(0); // 节流：上次 run 时间戳
	const throttleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null); // 节流定时器
	const hasEverRenderedRef = useRef(false); // 是否曾成功出过图（失败时决定是否展示 DSL 文本兜底）
	const lastCommittedSvgRef = useRef<string>(''); // 相同 SVG 跳过提交

	const previewEnabled = Boolean(openMermaidPreview); // 是否注册点击预览

	useLayoutEffect(() => {
		const host = hostRef.current;
		if (!host) return;

		// 真实 DOM：只创建一次 wrap，后续仅更新 .mermaid 内容
		let wrap = host.querySelector(
			'.markdown-mermaid-wrap[data-mermaid="1"]',
		) as HTMLElement | null;
		if (!wrap) {
			host.innerHTML =
				'<div class="markdown-mermaid-wrap" data-mermaid="1"><div class="mermaid"></div></div>';
			wrap = host.querySelector(
				'.markdown-mermaid-wrap[data-mermaid="1"]',
			) as HTMLElement | null;
		}
		const inner = wrap?.querySelector('.mermaid') as HTMLElement | null;
		if (!wrap || !inner) return;

		const dsl = normalizeMermaidFenceBody(code);
		const runId = ++genRef.current;

		// 离屏根节点：不可见但可测量（类图/甘特图需要文本测量）
		const stageRoot = ensureMermaidStageRoot();
		if (!stageRoot) return;

		// 清理节流
		const flushTimer = () => {
			if (throttleTimerRef.current) {
				clearTimeout(throttleTimerRef.current);
				throttleTimerRef.current = null;
			}
		};

		const looksLikeErrorSvg = (node: SVGElement | null): boolean => {
			if (!node) return true;
			const t = (node.textContent || '').toLowerCase();
			const aria = (node.getAttribute('aria-label') || '').toLowerCase();
			// 错误图的特征组合：Syntax error in text + mermaid version
			const looksLikeSyntax =
				t.includes('syntax error in text') ||
				aria.includes('syntax error in text');
			const looksLikeMermaidVersion =
				t.includes('mermaid version') || aria.includes('mermaid version');
			return looksLikeSyntax && looksLikeMermaidVersion;
		};

		const commitSvgIfOk = async () => {
			if (runId !== genRef.current) return;

			// 离屏渲染：把 DSL 写到 stageHost，跑完后检查是否生成有效 SVG
			const stageHost = document.createElement('div');
			stageHost.innerHTML =
				'<div class="markdown-mermaid-wrap" data-mermaid="1"><div class="mermaid"></div></div>';
			const stageInner = stageHost.querySelector('.mermaid') as HTMLElement | null;
			if (!stageInner) return;
			stageInner.textContent = dsl;

			stageRoot.appendChild(stageHost);
			try {
				await runMermaidInMarkdownRoot(stageHost, {
					preferDark,
					suppressErrors: isStreaming,
				});
			} finally {
				stageHost.remove();
			}

			if (runId !== genRef.current) return;
			const svg = stageInner.querySelector('svg');
			if (!svg || looksLikeErrorSvg(svg)) {
				// 不提交错误 SVG：保留上一帧，避免闪烁；首次无图时以 DSL 文本兜底
				if (!hasEverRenderedRef.current) inner.textContent = dsl;
				return;
			}

			const nextSvgHtml = stageInner.innerHTML;
			if (nextSvgHtml === lastCommittedSvgRef.current) return;
			lastCommittedSvgRef.current = nextSvgHtml;

			// 原子替换：避免同时存在两份 SVG 导致 id/url(#id) 冲突
			inner.innerHTML = nextSvgHtml;
			hasEverRenderedRef.current = true;
		};

		const schedule = () => {
			flushTimer();
			const now = Date.now();
			if (!isStreaming) {
				lastRunAtRef.current = now;
				void commitSvgIfOk();
				return;
			}
			if (lastRunAtRef.current === 0) {
				lastRunAtRef.current = now;
				void commitSvgIfOk();
				return;
			}
			const since = now - lastRunAtRef.current;
			if (since >= 200) {
				lastRunAtRef.current = now;
				void commitSvgIfOk();
				return;
			}
			throttleTimerRef.current = setTimeout(() => {
				throttleTimerRef.current = null;
				lastRunAtRef.current = Date.now();
				void commitSvgIfOk();
			}, 200 - since);
		};

		if (!isStreaming) lastRunAtRef.current = 0;
		schedule();
		return () => flushTimer();
	}, [code, preferDark, isStreaming]);

	useMermaidDiagramClickPreview(
		hostRef,
		openMermaidPreview ?? noopOpenPreview,
		previewEnabled,
		code, // rebindWhen：code 变则 DOM 已换，需重绑捕获
	);

	return (
		<div
			ref={hostRef}
			className={cn(
				'mermaid-island-root w-full',
				previewEnabled && '[&_.markdown-mermaid-wrap_.mermaid]:cursor-zoom-in',
			)}
		/>
	);
});
```

### 7.2.1 本次实现更新（防闪烁、类图/甘特图兼容、不中断代码块）

当前仓库中的 `MermaidFenceIsland` 已演进为“**离屏渲染 + 成功才提交**”方案（实现位置：`apps/frontend/src/components/design/MermaidFenceIsland/index.tsx`），以同时满足：

- **流式过程中不闪烁**：Mermaid 可能返回“错误提示 SVG”（例如 `Syntax error in text`），此时不提交，保留上一帧；
- **类图/甘特图可渲染**：离屏容器必须 **可测量**（`opacity:0` 且有足够宽高），避免 bbox/布局为 0；
- **不影响普通代码块**：岛仅负责 Mermaid，本段落不触达 markdown 段的 `parser.render`。

关键点摘录（示意）：

```typescript
// 1) document.body 下的离屏根节点：不可见但可测量（不要用 visibility:hidden + 1px）
el.style.left = '-99999px';
el.style.width = '2000px';
el.style.minHeight = '1200px';
el.style.opacity = '0';

// 2) 每次更新：在离屏 stageHost 上 runMermaidInMarkdownRoot，只有成功且非“错误 SVG”才提交
await runMermaidInMarkdownRoot(stageHost, { preferDark, suppressErrors: isStreaming });
const svg = stageInner.querySelector('svg');
if (!svg || looksLikeErrorSvg(svg)) return; // 保留上一帧，避免闪
inner.innerHTML = stageInner.innerHTML; // 原子替换：避免同时存在两份 SVG 导致 id 冲突
```

---

### 7.3 `StreamingMarkdownBody`（`apps/frontend/src/components/design/ChatAssistantMessage/StreamingMarkdownBody.tsx`）

助手消息 **不再内联** 岛组件实现，而是 **import `MermaidFenceIsland`**；`parser` 仍用于各 **markdown 段**（通常 `enableMermaid: false`，避免与岛重复占位，见聊天侧 `ChatAssistantMessage` 配置）。

#### 7.3.1 维护性优化：与 Monaco 预览共享“尾部开放 Mermaid”拆分逻辑

聊天流式与 Monaco 预览都需要“闭合围栏走 `splitForMermaidIslands`、尾部未闭合 mermaid 走按行探测”的组合逻辑。为避免两处维护产生边界差异，已将组合逻辑抽到公共方法：

- `apps/frontend/src/utils/splitMarkdownFences.ts`
  - `splitOpenMermaidTail`：只探测尾部未闭合 mermaid 围栏（返回 `{ prefix, body, openLine }`）
  - `splitForMermaidIslandsWithOpenTail`：组合 `splitForMermaidIslands + splitOpenMermaidTail`，并生成稳定 `openMermaidId`（基于 `openLine`）

调用差异仅保留在参数上（聊天 `enableOpenTail=isStreaming`、Monaco `enableOpenTail=enableMermaid`；两者 `openMermaidIdPrefix` 不同）。

```typescript
/**
 * 聊天流式正文：主拆分器使用 `parser.splitForMermaidIslands`（markdown-it parse），保证普通代码块边界稳定；
 * 仅对“流式尾部未闭合 mermaid 围栏”做额外探测，将其从 markdown 段剥离出来交给 MermaidFenceIsland。
 */

import { MermaidFenceIsland } from '@design/MermaidFenceIsland';
import type { MarkdownMermaidSplitPart, MarkdownParser } from '@dnhyxc-ai/markdown-kit';
import { type RefObject, useMemo } from 'react';
import { useMermaidImagePreview } from '@/hooks/useMermaidImagePreview';
import { cn } from '@/lib/utils';
import { mermaidStreamingFallbackHtml } from '@/utils/splitMarkdownFences';
import {
	fenceClosingIndentMatchesOpen,
	isPlausibleMarkdownFenceIndent,
} from '@/utils/markdownFenceLineParser';

function splitOpenMermaidTail(source: string): { prefix: string; body: string } | null {
	const normalized = source.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
	const lines = normalized.split('\n');
	for (let i = 0; i < lines.length; i++) {
		const line = lines[i];
		const openMatch = /^(\s*)(`{3,})([^`]*)$/.exec(line.trimEnd());
		if (!openMatch) continue;
		const openIndent = openMatch[1] ?? '';
		const tickLen = openMatch[2]?.length ?? 3;
		const lang = (openMatch[3] ?? '').trim().split(/\s+/)[0]?.toLowerCase();
		if (!isPlausibleMarkdownFenceIndent(openIndent)) continue;
		if (lang !== 'mermaid') continue;

		// 找闭合：若找不到 → 认为是“尾部开放 mermaid”
		let j = i + 1;
		let closed = false;
		while (j < lines.length) {
			const cur = lines[j];
			const closeMatch = /^(\s*)(`{3,})\s*$/.exec(cur.trimEnd());
			if (
				closeMatch &&
				(closeMatch[2]?.length ?? 0) >= tickLen &&
				fenceClosingIndentMatchesOpen(openIndent, closeMatch[1] ?? '')
			) {
				closed = true;
				break;
			}
			j++;
		}
		if (closed) {
			i = j;
			continue;
		}

		// 关键：prefix 必须保留行末换行，否则下一段 ```lang 会粘连导致围栏失效
		const prefixLines = lines.slice(0, i);
		const prefix = prefixLines.length > 0 ? `${prefixLines.join('\n')}\n` : '';
		const body = lines.slice(i + 1).join('\n');
		return { prefix, body };
	}
	return null;
}

export type StreamingMarkdownBodyProps = {
	markdown: string;
	parser: MarkdownParser;
	className?: string;
	preferDark: boolean;
	isStreaming: boolean;
	containerRef?: RefObject<HTMLDivElement | null>;
};

export function StreamingMarkdownBody({
	markdown,
	parser,
	className,
	preferDark,
	isStreaming,
	containerRef,
}: StreamingMarkdownBodyProps) {
	const parts = useMemo<MarkdownMermaidSplitPart[]>(() => {
		if (!isStreaming) return parser.splitForMermaidIslands(markdown);
		const openTail = splitOpenMermaidTail(markdown);
		if (!openTail) return parser.splitForMermaidIslands(markdown);
		const headParts = parser.splitForMermaidIslands(openTail.prefix);
		return [...headParts, { type: 'mermaid', text: openTail.body, complete: false }];
	}, [markdown, parser, isStreaming]);

	const { openMermaidPreview, mermaidImagePreviewModal } = useMermaidImagePreview();

	return (
		<div ref={containerRef} className={cn('streaming-md-body', className)}>
			{parts.map((part: MarkdownMermaidSplitPart, i: number) => {
				if (part.type === 'markdown') {
					return (
						<div
							key={`md-${i}`}
							dangerouslySetInnerHTML={{ __html: parser.render(part.text) }}
						/>
					);
				}
				if (!part.complete) {
					return (
						<div
							key={`mm-open-${i}`}
							dangerouslySetInnerHTML={{
								__html: mermaidStreamingFallbackHtml(part.text),
							}}
						/>
					);
				}
				return (
					<MermaidFenceIsland
						key={`mm-done-${i}`}
						code={part.text}
						preferDark={preferDark}
						isStreaming={isStreaming}
						openMermaidPreview={openMermaidPreview}
					/>
				);
			})}
			{mermaidImagePreviewModal}
		</div>
	);
}
```

### 7.3.1 本次实现更新（代码块稳定 + Mermaid 不串扰）

聊天流式正文已从 `splitMarkdownByCodeFences` 迁移到 `parser.splitForMermaidIslands`（markdown-it parse），根因与修复点：

- **根因**：纯函数按行扫围栏在“列表内代码块、闭合缩进不一致、段末换行丢失”等边界下容易拆坏普通代码块；
- **修复**：用 markdown-it token.map 切片源码，拆分与 `render()` 同源；并在流式尾部探测开放 mermaid 时确保 `prefix` 带行末 `\n`，避免 `上一行内容```typescript` 粘连造成围栏失效。

```typescript
// prefix 必须保留行末换行：否则下一段以 ``` 开头时会被拼成 `上一行内容```lang`
const prefix = prefixLines.length > 0 ? `${prefixLines.join('\n')}\n` : '';
```

---

### 7.3.2 ChatBotView：避免 Mermaid DOM 变更风暴影响代码块

Mermaid 渲染会在 SVG 子树内产生大量 DOM 变更。若聊天视图对 `#message-container` 使用
`MutationObserver({ subtree:true, characterData:true })`，会触发观察风暴，导致滚动同步与代码块工具栏布局反复重算，
进而影响代码块渲染稳定性。

本次修复（位置：`apps/frontend/src/components/design/ChatBot/ChatBotView.tsx`）：

- 仅监听消息行增删：`childList: true, subtree: false`
- 用 `requestAnimationFrame` 合并回调，降低抖动

关键代码（逐行注释摘录）：

```typescript
// ⚠️ 不能 observe subtree/characterData：Mermaid 渲染会在 SVG 子树内产生大量 DOM 变更，
// 会触发 MutationObserver 风暴，导致滚动同步/代码块工具栏布局反复重算，进而影响代码块渲染稳定性。
// 这里仅监听“消息行增删”（childList），并用 rAF 合并。
mutationObserverRef.current = new MutationObserver(() => schedule());
mutationObserverRef.current.observe(contentArea, {
  childList: true,
  subtree: false,
});
```

---

### 7.3.3 本次实现更新：每个 Mermaid 块独立「图/代码」切换 + 复制反馈

位置：`apps/frontend/src/components/design/ChatAssistantMessage/StreamingMarkdownBody.tsx`

诉求：

- **同一条消息里多个 Mermaid**：每块都可以独立切换「显示图」或「显示 markdown 代码」；
- **不影响 Mermaid 流式防闪**：切到“图”仍走 `MermaidFenceIsland`（离屏渲染 + 成功才提交）；
- **复制交互反馈**：点击“复制”后按钮图标切换为 `CheckCircle`，颜色为 `text-teal-400`，短暂后自动恢复；
- **流式不闪**：尾部未闭合 Mermaid 的 key 必须稳定，否则 remount 会导致闪烁。

实现要点：

1. **为每块 Mermaid 生成稳定 blockId**：
   - 已闭合块：`mmd-${hashText(part.text)}`（内容 hash，稳定）
   - 尾部开放块：`mmd-open-line-${openLine}`（开围栏行号稳定；不要用数组索引 `i`）

2. **组件内维护两张表**：
   - `mermaidModeById[blockId] = 'diagram' | 'code'`
   - `copiedById[blockId] = boolean`（并用 timer 自动回退）

3. **渲染分支**：
   - `mode === 'code'`：`mermaidStreamingFallbackHtml(part.text)`（仅展示 DSL，不跑 Mermaid）
   - `mode === 'diagram'`：`MermaidFenceIsland`（仍可流式出图、且由岛内策略防闪）

关键代码（逐行注释摘录）：

```typescript
const COPY_FEEDBACK_MS = 1600;

// 尾部开放 mermaid：用开围栏行号做稳定 id，避免流式过程中 key 漂移导致 remount 闪烁
const openTail = useMemo(
  () => (isStreaming ? splitOpenMermaidTail(markdown) : null),
  [markdown, isStreaming],
);
const openMermaidId = openTail ? `mmd-open-line-${openTail.openLine}` : null;

// 每块 Mermaid 独立切换/复制反馈
const [mermaidModeById, setMermaidModeById] = useState<Record<string, 'diagram' | 'code'>>({});
const [copiedById, setCopiedById] = useState<Record<string, boolean>>({});
const copiedTimersRef = useRef<Record<string, number>>({});

const markCopied = (blockId: string) => {
  const prevTid = copiedTimersRef.current[blockId];
  if (prevTid) window.clearTimeout(prevTid);
  setCopiedById((prev) => ({ ...prev, [blockId]: true }));
  copiedTimersRef.current[blockId] = window.setTimeout(() => {
    setCopiedById((prev) => ({ ...prev, [blockId]: false }));
  }, COPY_FEEDBACK_MS);
};

// map 内：blockId = complete ? hash : openLine
const blockId = part.complete ? `mmd-${hashText(part.text)}` : (openMermaidId ?? `mmd-open-${i}`);
const mode = mermaidModeById[blockId] ?? defaultMermaidViewMode;
const copied = copiedById[blockId] === true;

// 复制按钮：成功后切换图标与颜色（不使用 Toast）
const onCopy = async () => {
  await copyToClipboard(`\`\`\`mermaid\n${part.text}\n\`\`\``);
  markCopied(blockId);
};
```

### 7.4 `normalizeMermaidFenceBody` 与 `patchMermaidFence`（`packages/markdown-kit/src/markdown/parser.ts`）

- **`normalizeMermaidFenceBody`**：导出函数；`\r\n`/`\r` → `\n`；对 **未加引号** 且含 **`/`** 或 **`+`** 的 `subgraph … […]` / `nodeId[…]` 自动包一层双引号（跳过 `[/…/]` 梯形节点外观）。降低 Mermaid 解析失败导致预览只剩 DSL 文本的概率。
- **`patchMermaidFence`**：在 `escapeHtml` **之前**调用 `normalizeMermaidFenceBody(token.content)`，再写入占位 div（**路径 A** 的 HTML 输出与岛内 `textContent` 使用同一套预处理）。

下列为相关函数与 fence 分支的 **逐行注释摘录**（与源文件顺序一致）。

```typescript
/** 梯形等节点：[/.../]，勿对其中的 / 做自动加引号 */
function mermaidBracketLabelLooksTrapezoid(label: string): boolean {
	const t = label.trim();
	return t.length >= 3 && t.startsWith('/') && t.endsWith('/');
}

const MERMAID_FLOWCHART_ID_SKIP = new Set([
	'subgraph',
	'end',
	'flowchart',
	'graph',
	'direction',
	'classDef',
	'class',
	'linkStyle',
	'click',
	'style',
	'break',
	'continue',
]);

function escapeMermaidDoubleQuotedLabelInner(raw: string): string {
	return raw.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

/**
 * 为未加引号且含 / 或 + 的方括号文案补双引号，减轻 Mermaid 解析失败（预览区只剩 DSL 文本）。
 * 不改变已带引号的片段；跳过梯形 [/.../]。
 */
function relaxMermaidBracketLabels(body: string): string {
	let text = body;
	text = text.replace(
		/(^|\n)([\t ]*subgraph\s+\S+\s+)\[([^\]\r\n]+)\]/g,
		(full, lead, pre, title) => {
			const raw = title as string;
			const t = raw.trim();
			if (t.startsWith('"') || mermaidBracketLabelLooksTrapezoid(raw)) {
				return full;
			}
			if (t.includes('/') || t.includes('+')) {
				return `${lead}${pre}["${escapeMermaidDoubleQuotedLabelInner(raw)}"]`;
			}
			return full;
		},
	);
	text = text.replace(
		/\b([A-Za-z_][\w]*)\[([^\]\r\n]*)\]/g,
		(full, id, label) => {
			if (MERMAID_FLOWCHART_ID_SKIP.has(id)) return full;
			const raw = label as string;
			const t = raw.trim();
			if (t.startsWith('"') || mermaidBracketLabelLooksTrapezoid(raw)) {
				return full;
			}
			if (t.includes('/') || t.includes('+')) {
				return `${id}["${escapeMermaidDoubleQuotedLabelInner(raw)}"]`;
			}
			return full;
		},
	);
	return text;
}

/**
 * Mermaid 围栏源码预处理：统一换行，并对含 /、+ 的未加引号方括号文案补引号。
 * 供 MarkdownParser 与流式 Mermaid 岛等共用。
 */
export function normalizeMermaidFenceBody(body: string): string {
	const eol = body.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
	return relaxMermaidBracketLabels(eol);
}

// —— 以下为类内 patchMermaidFence 中与预处理衔接的片段 ——

private patchMermaidFence(): void {
	const md = this.md;
	const prev = md.renderer.rules.fence;
	if (!prev) return;
	md.renderer.rules.fence = (tokens, idx, options, env, self) => {
		const token = tokens[idx];
		const info = token.info
			? md.utils.unescapeAll(String(token.info)).trim()
			: '';
		const langName = info.split(/\s+/g)[0] || '';
		if (langName.toLowerCase() === 'mermaid') {
			const body = md.utils.escapeHtml(
				normalizeMermaidFenceBody(token.content),
			);
			return (
				'<div class="markdown-mermaid-wrap" data-mermaid="1">' +
				'<div class="mermaid">' +
				body +
				'</div></div>\n'
			);
		}
		return prev(tokens, idx, options, env, self);
	};
}
```

---

## 8. Monaco 预览：`ParserMarkdownPreviewPane`（`apps/frontend/src/components/design/Monaco/index.tsx`）

### 8.1 行为概要

- **`fenceParts`**：`splitMarkdownByCodeFences(markdown)`。
- **`hasMermaidIslandLayout`**：`enableMermaid && fenceParts` 中存在 `type === 'mermaid'`。为 true 时走 **路径 B**（与聊天一致：按段 map + `MermaidFenceIsland`）；为 false 时走 **路径 A**（整段 `parser.render` + 子节点单层 `dangerouslySetInnerHTML`）。
- **`parser`**：仅构造一次；在 **路径 B** 的 markdown 段用 `parser.render(part.text, { enableMermaid: false })` 禁用 Mermaid 占位（围栏已被拆出），避免重复渲染。
- **`html`**：路径 B 时为 `''`（占位，避免无意义全量 render）；路径 A 时为 `parser.render(markdown)`。
- **`mermaidRootScanParser`**：`{ enableMermaid: enableMermaid && !hasMermaidIslandLayout }`。路径 B 下为 false，`useMermaidInMarkdownRoot` 早退，**不在预览根上重复** `mermaid.run`。
- **`useMermaidInMarkdownRoot`**：`trigger` 在路径 B 用 **`markdown`**（内容变则 effect 依赖仍更新），路径 A 用 **`html`**。
- **`useMermaidDiagramClickPreview`**：`rebindWhen` 同步为 **`hasMermaidIslandLayout ? markdown : html`**，保证岛或整页替换后点击委托重建。
- **预览根 `className`**：仍含 `[&_.markdown-mermaid-wrap_.mermaid]:cursor-zoom-in`（岛内结构一致）。
- **分屏标题同步**：`buildHeadingScrollCache` 使用 `viewport.querySelectorAll('[data-md-heading-line]')`，多块 `.markdown-body` 仍在同一视口内，行为保持有效。

### 8.2 关键代码（逐行注释摘录）

下列从 `ParserMarkdownPreviewPane` 内部截取 **围栏判定、单 parser、hook 与 JSX 分支**，行尾注释说明意图。

```typescript
const fenceParts = useMemo(
	() => splitMarkdownByCodeFences(markdown),
	[markdown],
);
const hasMermaidIslandLayout = Boolean(
	enableMermaid && fenceParts.some((p) => p.type === 'mermaid'),
);

const parser = useMemo(
	() =>
		new MarkdownParser({
			highlightTheme: getChatMarkdownHighlightTheme(theme),
			enableChatCodeFenceToolbar: true,
			enableHeadingSourceLineAttr: true,
		}),
	[theme],
);

const html = useMemo(() => {
	if (hasMermaidIslandLayout) return '';
	return parser.render(markdown, { enableMermaid });
}, [hasMermaidIslandLayout, parser, markdown, enableMermaid]);

const mermaidRootScanParser = useMemo(
	() => ({
		enableMermaid: enableMermaid && !hasMermaidIslandLayout,
	}),
	[enableMermaid, hasMermaidIslandLayout],
);

useMermaidInMarkdownRoot({
	rootRef: previewHtmlRootRef,
	preferDark: theme === 'black',
	trigger: hasMermaidIslandLayout ? markdown : html,
	parser: mermaidRootScanParser,
});

const { openMermaidPreview, mermaidImagePreviewModal } =
	useMermaidImagePreview();

useMermaidDiagramClickPreview(
	previewHtmlRootRef,
	openMermaidPreview,
	enableMermaid,
	hasMermaidIslandLayout ? markdown : html,
);

// —— 预览内容区（缩略外层 ScrollArea，仅示 ref 与 innerHTML 分支）——

<div ref={previewHtmlRootRef} className={cn(/* …与 Mermaid 光标样式… */)}>
	{hasMermaidIslandLayout ? (
		fenceParts.map((part, i) => {
			if (part.type === 'markdown') {
				return (
					<div
						key={`pv-${i}`}
						dangerouslySetInnerHTML={{
							__html: parser.render(part.text, { enableMermaid: false }),
						}}
					/>
				);
			}
			if (!part.complete) {
				return (
					<div
						key={`pv-${i}`}
						dangerouslySetInnerHTML={{
							__html: mermaidStreamingFallbackHtml(part.text),
						}}
					/>
				);
			}
			return (
				<MermaidFenceIsland
					key={`pv-${i}`}
					code={part.text}
					preferDark={theme === 'black'}
					openMermaidPreview={openMermaidPreview}
				/>
			);
		})
	) : (
		<div dangerouslySetInnerHTML={{ __html: html }} />
	)}
</div>
```

同文件根部仍渲染 `{mermaidImagePreviewModal}`，与 **§6** 一致。

---

## 9. 构建与开发注意事项

- **`@dnhyxc-ai/markdown-kit`**：修改 `src` 后执行 `pnpm --filter @dnhyxc-ai/markdown-kit run build`，前端才能读到最新 `dist`。
- **Vite**：若将 `@dnhyxc-ai/markdown-kit/react` 放入 `optimizeDeps.include`，包内**新增导出**后可能缓存旧预构建，出现 `Importing binding ... is not found`；可对 `@dnhyxc-ai/markdown-kit/react` 使用 `optimizeDeps.exclude` 或清 `node_modules/.vite` 并 `--force`。
- **流式未闭合** ` ```mermaid `：仅展示代码 fallback，**不**执行 `mermaid.run`，因此无 SVG、无预览/缩放块——属预期。

---

## 10. 文件索引（便于检索）

| 能力                       | 典型路径                                                                                               |
| -------------------------- | ------------------------------------------------------------------------------------------------------ |
| Fence 占位 + DSL 预处理    | `packages/markdown-kit/src/markdown/parser.ts`（`patchMermaidFence`、`normalizeMermaidFenceBody` 等）        |
| `normalizeMermaidFenceBody` 导出 | `packages/markdown-kit/src/index.ts`（再导出供前端 `@dnhyxc-ai/markdown-kit` 引用）                             |
| `mermaid.run` 与队列       | `packages/markdown-kit/src/mermaid/in-markdown.ts`                                                            |
| React 调度                 | `packages/markdown-kit/src/react/use-mermaid-in-markdown-root.ts`                                             |
| 按围栏拆分                 | `apps/frontend/src/utils/splitMarkdownFences.ts`                                                       |
| 单块 Mermaid 岛            | `apps/frontend/src/components/design/MermaidFenceIsland.tsx`                                           |
| 缩放 UI（参考）            | `mermaid-zoom-ui.ts` + `mermaid-zoom-ui.css`（若存在于分支）                                           |
| SVG → data URL             | `apps/frontend/src/utils/mermaidImagePreview.ts`                                                       |
| 预览 Hooks                 | `apps/frontend/src/hooks/useMermaidImagePreview.tsx`                                                   |
| 聊天流式正文               | `apps/frontend/src/components/design/ChatAssistantMessage/StreamingMarkdownBody.tsx`                   |
| Monaco Markdown 预览       | `apps/frontend/src/components/design/Monaco/index.tsx`（`ParserMarkdownPreviewPane`）                    |

---

_文档与仓库具体文件可能随分支差异略有不同；以当前 `git` 树为准。缺失的缩放模块可按 §3～§4 参考实现补回。_
