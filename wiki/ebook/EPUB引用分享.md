# EPUB 书摘分享图片

## 文档角色

**增量专题**：选区 / 想法侧栏「分享书摘」生成微信读书式日历卡片 PNG，弹窗预览、复制到剪贴板、下载；保留 EPUB 原文字号比例的多样式居中绘制。

**延伸阅读**：[EPUB阅读分屏.md](./EPUB阅读分屏.md)（右侧分栏与 PopBar 共存）、[EPUB右键菜单PopBar.md](./EPUB右键菜单PopBar.md)、[EPUB想法侧面板.md](./EPUB想法侧面板.md)、[EPUB用户划线实现.md](./EPUB用户划线实现.md)、[EPUB引用分享对话框Chrome.md](./EPUB引用分享对话框Chrome.md)（弹窗阅读 chrome 与固定预览配色）。

---

## 1. 背景与目标

### 1.1 问题

用户希望将书中摘录以图片形式分享到微信等应用；需兼顾 Safari/WebKit 图片剪贴板、Tauri 桌面端、多样式标题（字号/字重混排）居中不乱、弹窗打开时 PopBar 不被误关。

### 1.2 目标

- PopBar、想法列表/详情引用条统一「分享书摘」入口。
- Canvas 绘制日历风卡片（日期区 + 分隔线 + 书摘 + 书名 + 品牌）。
- 从选区 DOM 提取 `QuoteShareRun[]` 保留原文字号；无片段时纯文本折行。
- 复制/下载 PNG；弹窗固定预览高度避免布局跳动。

---

## 2. 改动范围

| 路径 | 说明 |
|------|------|
| `apps/frontend/src/views/ebook/utils/epubQuoteShareCard.ts` | **新增** Canvas 测高与绘制 |
| `apps/frontend/src/views/ebook/utils/epubQuoteShareStyled.ts` | **新增** DOM 样式片段、折行、多样式居中绘制 |
| `apps/frontend/src/views/ebook/components/EpubQuoteShareDialog.tsx` | **新增** Model 弹窗 |
| `apps/frontend/src/utils/clipboard.ts` | `copyCanvasToClipboard` / `copyImageToClipboard` |
| `apps/frontend/src/views/ebook/read.tsx` | 状态、`openQuoteShare`、PopBar/想法接入 |
| `apps/frontend/src/views/ebook/components/EpubSelectionPopBar*.tsx` | `onShare` 透传 |
| `apps/frontend/src/views/ebook/components/EpubQuoteActionBar.tsx` | `onShare`、`share` 列入 `PRESERVE_SELECTION_ACTIONS` |
| `apps/frontend/src/views/ebook/utils/epubSelectionToolbarAttach.ts` | payload 增加 `quoteSegments` |
| `apps/frontend/src/components/ui/dialog.tsx` | 关闭钮去掉 `data-[state=open]:bg-accent` 避免弹窗打开时出现边框感 |
| `apps/frontend/src/i18n/locales/zh-CN.ts` / `en-US.ts` | `ebook.read.quoteShare.*` |

---

## 3. 实现思路

1. **入口统一**：`read.tsx` 的 `openQuoteShare(text, { segments?, cfiRange? })`；侧栏经 `resolveQuoteShareSegments` 在仅有 CFI 时回读 DOM。
2. **绘制管线**：`measureCardHeight` → `drawCard` → `canvas.toBlob`；`SCALE=2` 导出高清 PNG。
3. **多样式居中**：`drawStyledQuoteLines` 每行设 `textAlign: 'left'`，按 run 宽度累加后整体居中，避免根 `textAlign: center` 导致 x 偏移。
4. **剪贴板**：Web 须在用户点击回调内**同步** `clipboard.write` + `ClipboardItem` Promise；Tauri 走 `Image.fromBytes` + `writeImage`。
5. **PopBar**：`share` 在 `PRESERVE_SELECTION_ACTIONS`；打开分享弹窗时 `quoteShareOpenRef` 阻止选区失焦误关 PopBar；`suppressEpubSelectionPopBarDismiss` 于点击分享时调用。
6. **弹窗 UX**：预览区固定 `h-[min(calc(75vh-10rem),600px)]`；`overflow-hidden` + 圆角裁剪；复制按钮固定图标占位避免宽度跳动。

---

## 4. 关键代码对比与注释

### 4.1 `openQuoteShare`（`apps/frontend/src/views/ebook/read.tsx`）

**对比范围**：新增函数全文。

**改动前** · `apps/frontend/src/views/ebook/read.tsx`（基线 HEAD，无此函数）

```typescript
// （基线不存在书摘分享状态与 openQuoteShare）
```

**改动后** · `apps/frontend/src/views/ebook/read.tsx`（当前，约 L1054–L1066）

```typescript
// 打开书摘分享弹窗：写入文案与可选样式片段后展示 Model
const openQuoteShare = useCallback(
	(
		text: string,
		opts?: { segments?: QuoteShareRun[]; cfiRange?: string },
	) => {
		// 去空白后无内容则直接返回，避免空卡片
		const quote = text.trim();
		if (!quote) return;
		// 同步弹窗展示用的纯文本
		setQuoteShareText(quote);
		// 优先用 PopBar payload 的 segments，否则按 CFI 回读 DOM
		setQuoteShareSegments(resolveQuoteShareSegments(opts));
		// 触发 EpubQuoteShareDialog 打开并异步生成图片
		setQuoteShareOpen(true);
	},
	[resolveQuoteShareSegments],
);
```

**变更摘要**：新增分享弹窗状态入口；segments 与 CFI 回读逻辑解耦在 `resolveQuoteShareSegments`。

---

### 4.2 `copyCanvasToClipboard`（`apps/frontend/src/utils/clipboard.ts`）

**对比范围**：新增导出函数及 Tauri 分支。

**改动前** · `apps/frontend/src/utils/clipboard.ts`（基线 HEAD，约 L34 后无图片复制）

```typescript
// 基线仅有 copyToClipboard / pasteFromClipboard 等文本 API
```

**改动后** · `apps/frontend/src/utils/clipboard.ts`（当前，约 L37–L55）

```typescript
// 将 Canvas 生成的 PNG 写入系统剪贴板（Safari 须同步 write）
export function copyCanvasToClipboard(
	canvas: HTMLCanvasElement,
): Promise<void> {
	// Tauri 桌面端走原生图片 API
	if (isTauriRuntime()) {
		return copyCanvasToClipboardTauri(canvas);
	}
	// 浏览器无 ClipboardItem 则拒绝
	if (!navigator.clipboard?.write || typeof ClipboardItem === 'undefined') {
		return Promise.reject(new Error('剪贴板不可用'));
	}
	// 同步调用 write；Blob 通过 ClipboardItem 内 Promise 延迟生成
	return navigator.clipboard.write([
		new ClipboardItem({
			'image/png': canvasToPngBlob(canvas),
		}),
	]);
}
```

**变更摘要**：补齐图片剪贴板；WebKit 兼容同步 `write` + 异步 Blob Promise。

---

### 4.3 `renderQuoteShareCard`（`apps/frontend/src/views/ebook/utils/epubQuoteShareCard.ts`）

**对比范围**：新增异步导出函数（摘录核心流程）。

**改动前** · 基线无此文件。

**改动后** · `apps/frontend/src/views/ebook/utils/epubQuoteShareCard.ts`（当前，约 L257–L288）

```typescript
// 渲染书摘分享卡为 Canvas 与 PNG Blob
export async function renderQuoteShareCard(
	input: QuoteShareCardInput,
): Promise<QuoteShareCardResult> {
	// 离屏 Canvas 仅用于 measureCardHeight
	const measureCanvas = document.createElement('canvas');
	const measureCtx = measureCanvas.getContext('2d');
	if (!measureCtx) throw new Error('无法生成分享图片');
	// 按书摘行数与元数据计算卡片总高
	const height = measureCardHeight(measureCtx, input);
	// 正式导出 Canvas，宽高乘 SCALE 提升清晰度
	const canvas = document.createElement('canvas');
	canvas.width = CARD_WIDTH * SCALE;
	canvas.height = height * SCALE;
	const ctx = canvas.getContext('2d');
	if (!ctx) throw new Error('无法生成分享图片');
	// 坐标系缩放到逻辑像素，绘制函数仍用 CARD_WIDTH 坐标
	ctx.scale(SCALE, SCALE);
	drawCard(ctx, input, height);
	// 转 Blob 供下载；dataUrl 供 img 预览
	const blob = await new Promise<Blob>((resolve, reject) => {
		canvas.toBlob(
			(result) => {
				if (result) resolve(result);
				else reject(new Error('无法生成分享图片'));
			},
			'image/png',
		);
	});
	const dataUrl = canvas.toDataURL('image/png');
	return { canvas, dataUrl, blob };
}
```

**变更摘要**：测高与绘制分离；2x 导出；返回 canvas/dataUrl/blob 三件套供复制与下载。

---

## 5. 兼容性与影响

- 仅 EPUB 阅读页接入；PDF 无选区分享。
- 需现代浏览器 `ClipboardItem` 或 Tauri 剪贴板插件；失败 Toast 提示。
- 分享弹窗打开时 PopBar 保持；关闭弹窗后选区行为与原先一致。

## 6. 回归建议

- PopBar / 想法侧栏「分享书摘」→ 多样式标题居中、复制/下载。
- Safari 与 Tauri 复制图片后粘贴到微信/备忘录。
- 分享弹窗打开期间 PopBar 不收起；长书摘预览区滚动。
- MK 问书开启时点击分享，助手侧栏保持（见侧栏专题）。

## 7. 相关源码路径

| 说明 | 路径 |
|------|------|
| 卡片绘制 | `apps/frontend/src/views/ebook/utils/epubQuoteShareCard.ts` |
| 多样式文本 | `apps/frontend/src/views/ebook/utils/epubQuoteShareStyled.ts` |
| 弹窗 UI | `apps/frontend/src/views/ebook/components/EpubQuoteShareDialog.tsx` |
| 阅读页编排 | `apps/frontend/src/views/ebook/read.tsx` |

---

（若与仓库最新源码不一致，以源码为准）
