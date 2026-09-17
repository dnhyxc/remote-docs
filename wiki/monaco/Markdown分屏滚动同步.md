# Monaco Markdown 分屏跟随滚动：实现说明

> **延伸阅读**：[Markdown视图面板滚动.md](./Markdown视图面板滚动.md)（全屏预览/编辑与助手 Panel 布局、preview ↔ edit 滚动对齐；复用本文 sync 工具）。

本文记录知识库 / Markdown 编辑器**分屏（split）**下「左侧 Monaco、右侧预览」**纵向滚动对齐**的完整实现思路、涉及模块与维护要点。实现分布在 `apps/frontend` 与 `packages/markdown-kit` 中。

---

## 1. 背景与问题

### 1.1 需求

- 分屏时可选：**预览跟编辑**、**编辑跟预览**、**双向**、或关闭跟随。
- 对齐应大致反映「同一阅读位置」，而不是简单按整篇长度比例硬拉（长文、代码块、图片、Mermaid 等会导致左右可滚高度差异很大）。

### 1.2 历史痛点（为何弃用旧模型）

早期方案常用「**首可见行号**（first visible line）」在标题锚点表上插值。在 **Monaco 自动折行（word wrap）** 下，**同一模型行号**在垂直方向上只占一行逻辑行，但**首可见行**随折行剧烈变化，与预览侧「按块增高」的 DOM 进度并不同步，容易出现**左右差很多节**、方向感错乱。

### 1.3 当前方案的两条主线

1. **滚动热路径**：用 **Monaco `getScrollTop()`** 与预览 **`scrollTop`** 在一条**预先测好的单调折线**上插值（连续、与折行更一致）。
2. **冷路径 / 布局**：仅在正文或布局变化时重建快照；并保证预览里 **`data-md-heading-line` 与 Monaco 全文行号一致**（尤其 **Mermaid 岛分段渲染** 场景）。

---

## 2. 核心数据结构与算法（`utils.ts`）

文件：`apps/frontend/src/components/design/Monaco/utils.ts`

### 2.1 类型：`MarkdownScrollSyncSnapshot`

表示一条**分段线性、单调非降**的对应关系：

- `editorY[k]`：编辑器侧用于对齐的纵向坐标（与 `editor.getScrollTop()` **同一坐标系**，见下文）。
- `previewY[k]`：预览视口在「该锚点」下应对齐的 `scrollTop`。
- 折线包含 **文首 `(0,0)`** 与 **文末 `(maxEditor, maxPreview)`**，中间节点为各 **标题** 的采样点。
- `useRatioFallback`：无标题、无 model 等时退化为 **整篇垂直比例**（`editorVerticalScrollRatio` ↔ `setPreviewVerticalScrollRatio`）。

### 2.2 坐标系约定（必读）

- **Monaco**（官方 `editor.api.d.ts`）：`getTopForLineNumber(line)` 返回该行**顶边**相对**第一行**的纵向像素偏移；`getScrollTop()` 与之一致，表示「视口顶端」在内容里的位置。因此 **「把第 L 行顶对齐到视口顶」时，`scrollTop ≈ getTopForLineNumber(L)`**（忽略 sticky 等微调时）。
- **预览**：在标题 DOM 上读 `getBoundingClientRect`，结合当前 `viewport.scrollTop` 与元素的 `scroll-margin-top`（如 Tailwind `scroll-mt-*`），反推「若要把该标题顶贴齐视口顶」所需的 **`scrollTop`**，即 `scrollTopToAlignHeadingTop`。

快照里每个标题节点存的是一对 **(ey, py)**：

- `ey = clamp(getTopForLineNumber(line), 0, maxEditor)`：编辑器在该对齐语义下的纵向锚点。
- `py = clamp(scrollTopToAlignHeadingTop(viewport, el), 0, maxPreview)`：预览在同一时刻测量得到的锚点。

**滚动时**：用当前 `editor.getScrollTop()` 在 `(editorY[], previewY[])` 上 **分段线性插值** 得到目标预览 `scrollTop`；反向则用 `viewport.scrollTop` 在 `(previewY[], editorY[])` 上插值得到 `editor.setScrollTop`。

### 2.3 `stabilizeSyncNodes`（单调化）

测量误差或布局抖动可能导致少数点 **previewY 略小于前一点**。函数对 `editorY` / `previewY` 做前向非降修正，并强制首尾为 `(0,0)` 与 `(maxEditor, maxPreview)`，避免插值时出现倒序段。

### 2.4 同行多 DOM（同一 `data-md-heading-line`）

同一源码行若对应多个标题节点（极少见），循环内用 **`lastHeadingLine`** 合并：**只保留该行最后一次测量**，更新折线最后一个节点。

### 2.5 快照有效性：`isMarkdownScrollSyncSnapshotValid`

在滚动中复用快照前比对：

- model **行数**是否变化；
- 预览 **`scrollHeight` / `clientHeight`**；
- 编辑器 **`getContentHeight()`** 与 **`getLayoutInfo().height`**；

均在容差 `SYNC_SNAPSHOT_LAYOUT_EPS_PX`（当前 3px）内才认为快照仍可信；否则在同步函数内 **现场 `buildMarkdownScrollSyncSnapshot` 并写回 ref**。

### 2.6 写入死区

`applyPreviewScrollTop` / `applyEditorScrollTop` 使用 **`SCROLL_APPLY_DEADBAND_PX`**（当前 1.5px），避免亚像素来回写导致双向回声振荡。

### 2.7 关键导出一览

| 符号 | 作用 |
|------|------|
| `buildMarkdownScrollSyncSnapshot` | 冷路径：采标题 DOM + Monaco 行顶，构建折线 |
| `isMarkdownScrollSyncSnapshotValid` | 判断缓存快照是否仍与当前布局一致 |
| `syncPreviewScrollFromMarkdownEditor` | 编辑 → 预览 |
| `syncEditorScrollFromMarkdownPreview` | 预览 → 编辑 |
| `editorVerticalScrollRatio` / `setPreviewVerticalScrollRatio` | 无标题等时的比例回退 |

---

## 3. 宿主接线（`Monaco/index.tsx`）

文件：`apps/frontend/src/components/design/Monaco/index.tsx`

### 3.1 快照 Ref

- `markdownScrollSyncSnapshotRef`：持有 `MarkdownScrollSyncSnapshot | null`。
- **换篇**（`documentIdentity`）：`useLayoutEffect` 中置 `null`，并清零预览与编辑器滚动，避免沿用上一篇。

### 3.2 重建快照：`rebuildMarkdownScrollSyncSnapshot`

在 **分屏 + 开启跟随 + Markdown** 时调用 `buildMarkdownScrollSyncSnapshot(editor, viewport)` 写入 ref。触发时机包括：

- `useLayoutEffect`：`splitPaneMarkdown`、`viewMode`、`splitScrollFollowMode` 等变化后 **首帧 + 下一 rAF** 再测一次（应对 hljs / 异步增高）；
- `ResizeObserver`（预览 viewport）：**rAF 合并**后重建，必要时再 `flushEditorScrollToPreviewSync`。

### 3.3 同步入口

- **`flushEditorScrollToPreviewSync`**：`suppressPreviewScrollEchoRef` 置真后调用 `syncPreviewScrollFromMarkdownEditor(..., markdownScrollSyncSnapshotRef)`，再双 rAF 清除抑制（减轻预览 `scroll` 回声）。
- **`syncEditorFromPreview`**：在「编辑跟预览 / 双向」下，预览滚动 **rAF** 后 `syncEditorScrollFromMarkdownPreview`，并对称使用 `suppressEditorScrollEchoRef`。

### 3.4 分屏正文：`splitPaneMarkdown`

- 纯预览模式仍可用 `useDeferredValue(value)` 减轻输入抖动。
- **分屏**下必须传 **`value` 的即时副本**（`splitPaneMarkdown`），否则预览 DOM 滞后于 Monaco 的 `scrollTop`，快照测量与插值会系统性错位。

### 3.5 `onDidScrollChange`

仅当 **`e.scrollTopChanged`** 为真时才触发 `syncPreviewFromEditor`，避免横向滚动等无关事件刷同步。

---

## 4. 预览渲染与全文行号（`preview.tsx` + `MarkdownParser`）

### 4.1 标题属性：`data-md-heading-line`

`packages/markdown-kit` 中 `MarkdownParser` 在 `enableHeadingSourceLineAttr: true` 时，于 `heading_open` 注入 **`data-md-heading-line`**，值为 **`token.map[0] + 1`**（与 Monaco **1-based 行号**一致）。分屏预览构造 parser 时已开启该选项。

### 4.2 Mermaid 岛布局带来的行号陷阱

当正文含 **```mermaid** 等需拆岛渲染时，预览对 **每个 markdown 片段**单独调用 `render(part.text)`。此时 markdown-it 的 `token.map` 是**相对于该片段子串**的行号，注入的 `data-md-heading-line` 也是**片段内 1-based**，与 Monaco **全文行号**不一致 → 折线锚点整体错位，表现为「左右差很多」。

### 4.3 修复：`lineBase0` + `shiftMarkdownPreviewHeadingLineAttrs`

1. **`MarkdownParser.splitForMermaidIslands`**（`packages/markdown-kit/src/markdown/parser.ts`）  
   与 `render` 同源用 `md.parse` 切分；每个 `markdown` 段附带 **`lineBase0`**：整篇源在 **`\r\n`/`\r` 规范为 `\n` 后**，该段**首行**的 **0-based** 行下标。

2. **`MarkdownMermaidSplitPart` 类型**（同文件导出）  
   - `markdown`：`{ type: 'markdown', text, lineBase0 }`  
   - `mermaid`：`{ type: 'mermaid', text, complete }`

3. **预览侧**（`apps/frontend/src/components/design/Monaco/preview.tsx`）  
   岛布局下对每个片段：

   - `rawHtml = parser.render(part.text, { enableMermaid: false })`  
   - `__html = shiftMarkdownPreviewHeadingLineAttrs(rawHtml, part.lineBase0)`  

   其中替换规则：**全文 1-based 行号 = `lineBase0` + 片段内 `data-md-heading-line` 的数值**（片段内值本身已是「片段内 1-based」，故等价于 `lineBase0 + parseInt(...)`）。`lineBase0 === 0` 的首段可跳过替换。

补充说明（本轮优化点）：

- 过去预览为了“同一处既要开 Mermaid、又要关 Mermaid”只能 `new MarkdownParser` 两次（一个 `enableMermaid: true`、一个 `false`）。
- 现在 `@dnhyxc-ai/markdown-kit` 的 `MarkdownParser.render()` 支持 `render(text, { enableMermaid })`，因此 `preview.tsx` 可以只保留一个 parser，通过渲染参数按需禁用 Mermaid，占位 DOM 不会与 Mermaid 岛重复。

### 4.4 与 `splitForMermaidIslandsWithOpenTail` 的关系

`apps/frontend/src/utils/splitMarkdownFences.ts` 中的 **`splitForMermaidIslandsWithOpenTail`** 仍委托 `parser.splitForMermaidIslands`；`lineBase0` 由 parser 在切分时一并产出，**开放尾部 mermaid** 路径下前缀部分的行号与全文一致。

---

## 5. 代码摘录（带注释说明）

下列摘录与仓库一致，注释为说明性中文，便于对照阅读。

### 5.1 快照类型与预览标题对齐测量（`utils.ts`）

```typescript
// apps/frontend/src/components/design/Monaco/utils.ts

/** 分屏跟滚快照：仅在正文/布局变化时重建；滚动时只做分段线性插值 */
export type MarkdownScrollSyncSnapshot = {
	/** 与 editor.getScrollTop() 同坐标系的锚点 X 序列（非降） */
	editorY: number[];
	/** 与 viewport.scrollTop 对应的锚点 Y 序列（非降） */
	previewY: number[];
	scrollHeight: number;
	clientHeight: number;
	lineCount: number;
	editorContentHeight: number;
	editorViewportHeight: number;
	/** 无标题等：退化为整篇垂直比例同步 */
	useRatioFallback: boolean;
};

/** 将标题顶对齐到视口顶时所需的预览 scrollTop（考虑 scroll-margin-top） */
function scrollTopToAlignHeadingTop(viewport: HTMLElement, el: HTMLElement): number {
	const vr = viewport.getBoundingClientRect();
	const er = el.getBoundingClientRect();
	// ... 读取 scrollMarginTop ...
	// 几何意义：当前 scrollTop 加上标题相对视口的偏移，再减去 scroll-margin
	return viewport.scrollTop + (er.top - vr.top) - scrollMarginTop;
}
```

### 5.2 构建快照：标题循环与文末闭合（`utils.ts`）

```typescript
// 文首 (0,0)；对每个 [data-md-heading-line]：Monaco 行顶 + 预览测量 scrollTop；文末 (maxEditor,maxPreview)
const editorY: number[] = [0];
const previewY: number[] = [0];
let lastHeadingLine = -1;

for (const { line, el } of headingEls) {
	const ey = Math.min(maxEditor, Math.max(0, editor.getTopForLineNumber(line)));
	const py = Math.min(maxPreview, Math.max(0, scrollTopToAlignHeadingTop(viewport, el)));
	// 同一源码行号只保留最后一个采样点（避免重复节点拉断插值）
	if (line === lastHeadingLine) {
		editorY[editorY.length - 1] = ey;
		previewY[previewY.length - 1] = py;
		continue;
	}
	lastHeadingLine = line;
	editorY.push(ey);
	previewY.push(py);
}
editorY.push(maxEditor);
previewY.push(maxPreview);
```

### 5.3 编辑 → 预览同步（`utils.ts`）

```typescript
// 热路径：优先有效快照；否则 build 后写入 snapshotRef
export function syncPreviewScrollFromMarkdownEditor(
	editor: MonacoEditorInstance,
	viewport: HTMLElement,
	snapshotRef: { current: MarkdownScrollSyncSnapshot | null },
): void {
	const st = editor.getScrollTop();
	// snap 有效且非 ratio fallback → interpolateMonotone(snap.editorY, snap.previewY, st, maxPreview)
	// 否则比例或现场重建
}
```

### 5.4 分屏即时正文与滚动过滤（`index.tsx`）

```typescript
// apps/frontend/src/components/design/Monaco/index.tsx

const deferredPreviewMarkdown = useDeferredValue(value);
/** 分屏下用即时正文，避免 deferred 滞后导致预览 DOM 与编辑器 scroll 不同步 */
const splitPaneMarkdown = viewMode === 'split' ? (value ?? '') : '';

// onMount 内：
editor.onDidScrollChange((e) => {
	if (!e.scrollTopChanged) return;
	syncPreviewFromEditor();
});

// 分栏右侧 ParserMarkdownPreviewPane：
// markdown={splitPaneMarkdown}
```

### 5.5 分段渲染行号修正（`preview.tsx`）

```typescript
// apps/frontend/src/components/design/Monaco/preview.tsx

/**
 * 分段 render 时标题 data-md-heading-line 为片段内 1-based；
 * lineBase0 = 整篇 normalized 源里该段首行的 0-based 行下标；
 * 全文 1-based = lineBase0 + 片段内行号数值。
 */
function shiftMarkdownPreviewHeadingLineAttrs(html: string, lineBase0: number): string {
	if (!lineBase0) return html;
	return html.replace(
		/data-md-heading-line="(\d+)"/g,
		(_, d) => `data-md-heading-line="${lineBase0 + Number.parseInt(d, 10)}"`,
	);
}

// fenceParts.map 内：
const rawHtml = parser.render(part.text, { enableMermaid: false });
__html: shiftMarkdownPreviewHeadingLineAttrs(rawHtml, part.lineBase0),
```

### 5.6 拆岛类型与 `lineBase0` 语义（`markdown/parser.ts`）

```typescript
// packages/markdown-kit/src/markdown/parser.ts

/**
 * markdown 段带 lineBase0：整篇源（\r\n 已规范为 \n）中该段首行的 0-based 行下标，
 * 用于把分段 render 得到的 data-md-heading-line 还原为与 Monaco 一致的全文行号。
 */
export type MarkdownMermaidSplitPart =
	| { type: 'markdown'; text: string; lineBase0: number }
	| { type: 'mermaid'; text: string; complete: boolean };

// splitForMermaidIslands：在 sliceLines(lastLine, start) 产出 prose 时
// raw.push({ type: 'markdown', text: prose, lineBase0: lastLine });
```

---

## 6. 维护与扩展建议

1. **修改预览标题 DOM 或属性名**：需同步 `buildMarkdownScrollSyncSnapshot` 的 `querySelectorAll` 与 `MarkdownParser.patchHeadingPreviewAttrs`。
2. **异步增高**（大图、Mermaid 完成渲染）：若仍短时漂移，可在异步布局结束后再触发一次 `rebuildMarkdownScrollSyncSnapshot`（与现有双 rAF / ResizeObserver 策略叠加）。
3. **文档对齐**：旧文档若仍提及 `HeadingScrollCache`、`sync*ByHeadings` 等 API，应以本文与 `utils.ts` 为准更新。
4. **聊天流式正文**（`StreamingMarkdownBody`）：同样使用 `splitForMermaidIslandsWithOpenTail`，已获得 `lineBase0`；当前未做 HTML 行号平移（无 Monaco 分屏对齐需求）。若未来共用标题同步，可复用 `shiftMarkdownPreviewHeadingLineAttrs` 思路。

---

## 7. 相关文件索引

| 路径 | 职责 |
|------|------|
| `apps/frontend/src/components/design/Monaco/utils.ts` | 快照构建、插值、比例回退、死区 |
| `apps/frontend/src/components/design/Monaco/index.tsx` | 分屏模式、快照生命周期、回声抑制、Monaco/预览事件 |
| `apps/frontend/src/components/design/Monaco/preview.tsx` | 预览 DOM、拆岛渲染、行号平移；**TOC `#` 锚点**见 `Markdown预览目录哈希导航.md` |
| `apps/frontend/src/utils/external-link-click.ts` | 捕获阶段接管链接；**`#` + `skipHashAnchors` 须 `preventDefault`**，与预览内滚动配合 |
| `apps/frontend/src/utils/splitMarkdownFences.ts` | `splitForMermaidIslandsWithOpenTail` 组合开放尾围栏 |
| `packages/markdown-kit/src/markdown/parser.ts` | `splitForMermaidIslands`、`data-md-heading-line`、`MarkdownMermaidSplitPart` |
| `packages/markdown-kit/src/index.ts` | 导出 `MarkdownMermaidSplitPart` 等 |

---

## 8. 与既有文档的关系

- `docs/monaco-Markdown输入法鬼影.md`：侧重 Monaco Markdown **IME / 占位 / 分屏交互** 等；其中若仍有「按首可见行 / HeadingScrollCache」等旧描述，请以本文 **§2–§4** 的实现为准逐步修订，避免双套叙述冲突。

---

## 9. 预览目录锚点（`#fragment`）与 Layout 误滚（关联文档）

分屏「跟滚」与快照解决的是**左右同步**；**点击预览区 TOC / `href="#..."`** 时若处理不当，会触发浏览器**片段导航**或 `scrollIntoView` 的**滚动链**，导致 **Layout 主内容区（`Outlet` 外包 `overflow-y-auto`）被误滚**。该问题与拆岛渲染下**多个 `.markdown-body`** 的 DOM 结构相关，实录与带注释的参考代码见：

- **`docs/monaco/Markdown预览目录哈希导航.md`**

---

*文档版本：与仓库当前分屏跟滚实现同步；修改 `utils.ts` / `index.tsx` / `preview.tsx` / `markdown/parser.ts` 时请同步更新本节与摘录。*
