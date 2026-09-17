# PDF 阅读：适应宽度、缩放与滚动换页

> **文档角色**：本轮（2026-06-13）PDF 阅读体验增量。主链路见 [电子书阅读书架.md](./电子书阅读书架.md)；滚动条样式见 [电子书COS本地书架.md](./电子书COS本地书架.md) §3.5。

## 1. 背景与目标

PDF 原先按 **1:1 页尺寸** 渲染，在大屏上左右留白多、正文偏小。用户希望：

1. **默认适应阅读区宽度**（满宽显示）；
2. 顶栏 **+ / −** 手动缩放，偏好可记住；
3. 长页 **上下滚动** 时，滚到顶/底能 **衔接上一页/下一页**（类似 EPUB 连续滚动），且 **猛滚惯性不会连跳多页**。

## 2. 改动范围

| 区域 | 路径 |
|------|------|
| PDF 渲染与换页 | `apps/frontend/src/views/ebook/components/PdfPane.tsx` |
| 缩放偏好 | `apps/frontend/src/views/ebook/utils/pdfReaderSettings.ts` |
| 滚边换页 | `apps/frontend/src/views/ebook/utils/pdfScrolledNav.ts` |
| 顶栏缩放 UI | `apps/frontend/src/views/ebook/read.tsx` |
| 文案 | `apps/frontend/src/i18n/locales/zh-CN.ts`、`en-US.ts` |

## 3. 实现思路

### 3.1 适应宽度 + 高清渲染

- `ResizeObserver` 监听阅读区容器，读取 **扣除 padding 后的内容宽度** `layoutWidth`。
- 每页：`fitScale = layoutWidth / pageWidth@scale1`；`cssScale = fitScale × zoomMultiplier`（用户缩放倍数）。
- Canvas 物理像素：`renderScale = cssScale × devicePixelRatio`（上限 2.5），避免纯 CSS 放大导致模糊。
- 窗口/侧边栏变化时自动重绘，无需刷新。

### 3.2 顶栏缩放

- `zoomMultiplier` 相对「满宽」：**100% = 适应宽度**；范围 50%～300%，步进 10%。
- 存 `localStorage`（`dnhyxc_pdf_reader_zoom`），与 EPUB 阅读设置同类「本机偏好」。
- 顶栏顺序：`−` → 百分比 → `+` → 翻页 → 目录。

### 3.3 滚动换页（停稳后再翻）

- 参考 EPUB `apps/frontend/src/views/ebook/utils/epubScrolledNav.ts`，PDF 为 **单页 canvas + overflow 容器**。
- **下一页**：滚到 **底部贴边** → 滚动 **停稳 220ms** → 再向下滚一下 → 切下一页，新页从 **顶部** 开始。
- **上一页**：滚到 **顶部贴边** → 停稳 → 再向上滚 → 切上一页，新页定位 **底部**（便于继续向上读）。
- **整页一屏**（无滚动条）：滚轮即可直接翻页。
- **防误触**：
  - 不用 `scroll` 事件直接翻页（惯性滚动会连跳）；
  - 滚轮 `|deltaY| < 28` 忽略触控板微抖；
  - 换页后 `suppressEdgeNavRef` 屏蔽程序化 `scrollTop` 重置期间的边缘检测；
  - 换页冷却 600ms。

### 3.4 为何不用 ScrollArea 包 canvas

PDF 需原生滚动 + canvas 尺寸联动；ScrollArea 会改变布局与滚动事件。缩放仍走 pdf.js 重渲染，不用 CSS `transform: scale()`。

## 4. 关键代码与注释

### 4.1 适应宽度渲染

**来源**：`apps/frontend/src/views/ebook/components/PdfPane.tsx`（约 L152–L164）

```typescript
const baseVp = pdfPage.getViewport({ scale: 1 });
// 说明：layoutWidth 来自 ResizeObserver，已扣 padding
const fitScale = layoutWidth / baseVp.width;
const cssScale = fitScale * zoomMultiplier; // 用户顶栏缩放倍数
const pixelRatio = Math.min(2.5, window.devicePixelRatio || 1);
const renderScale = cssScale * pixelRatio;

const vp = pdfPage.getViewport({ scale: renderScale });
canvas.width = vp.width;
canvas.height = vp.height;
canvas.style.width = `${baseVp.width * cssScale}px`;
canvas.style.height = `${baseVp.height * cssScale}px`;
```

### 4.2 缩放偏好

**来源**：`apps/frontend/src/views/ebook/utils/pdfReaderSettings.ts`（约 L1–L37）

```typescript
/** 相对「适应宽度」的倍数，1 = 100%（满宽） */
export const DEFAULT_PDF_ZOOM = 1;
export const PDF_ZOOM_MIN = 0.5;
export const PDF_ZOOM_MAX = 3;
export const PDF_ZOOM_STEP = 0.1;

export function loadPdfZoom(): number {
  const raw = localStorage.getItem(PDF_READER_ZOOM_STORAGE_KEY);
  // 说明：非法或缺失时回退 1（满宽）
  return raw == null ? DEFAULT_PDF_ZOOM : clampPdfZoom(Number.parseFloat(raw));
}
```

### 4.3 滚边换页：停稳门闩

**来源**：`apps/frontend/src/views/ebook/utils/pdfScrolledNav.ts`（约 L44–L95）

```typescript
const scheduleStableEdges = () => {
  resetStableEdges();
  if (stableTimer) clearTimeout(stableTimer);
  // 说明：滚动停止 SCROLL_STABLE_MS 后，才标记 atTop/atBottom 为「可翻页」
  stableTimer = setTimeout(() => {
    const edges = scrollEdges(container);
    if (edges.atTop) stableAtTop = true;
    if (edges.atBottom) stableAtBottom = true;
  }, SCROLL_STABLE_MS);
};

const onWheel = (e: WheelEvent) => {
  const dy = e.deltaY;
  if (Math.abs(dy) < MIN_WHEEL_DELTA) return;
  const { noScroll, atTop, atBottom } = scrollEdges(container);

  if (noScroll) {
    // 整页一屏：滚轮直接翻
    if (dy > 0 && atBottom) runEdgeAction('next', e);
    else if (dy < 0 && atTop) runEdgeAction('prev', e);
    return;
  }

  // 长页：须 stableAtBottom / stableAtTop 为 true（已停稳）才翻
  if (dy > 0 && atBottom && stableAtBottom) runEdgeAction('next', e);
  else if (dy < 0 && atTop && stableAtTop) runEdgeAction('prev', e);
};
```

### 4.4 换页后滚动位置

**来源**：`apps/frontend/src/views/ebook/components/PdfPane.tsx`（约 L82–L86、L176–L189）

```typescript
const goToPage = useCallback((target: number, enterScroll: 'top' | 'bottom') => {
  pageEnterScrollRef.current = enterScroll;
  setPage(clamped);
}, []);

// 渲染完成后重置 scrollTop；suppressEdgeNavRef 避免误触发滚边换页
if (enter === 'bottom') container.scrollTop = container.scrollHeight;
else container.scrollTop = 0;
```

## 5. 兼容性与影响

| 项 | 说明 |
|----|------|
| 旧 PDF 阅读 | 打开即满宽，体验变化为正向；无 API 变更 |
| 缩放偏好 | 本机 localStorage；清站点数据后回 100% |
| 顶栏/键盘翻页 | 仍可用；目录跳转后从页顶开始 |
| 性能 | 高倍缩放 + 大页会增大 canvas 像素，极端 300% 可能略慢 |

## 6. 建议回归

1. 宽屏 PDF：打开后页面 **满宽**，不再两侧大块灰底。
2. 顶栏 `+`/`−`：50%～300% 生效，刷新后偏好保留。
3. 长页：慢滚到底 **停住** → 再滚一下 → 下一页；从顶猛滚到底 **不连跳**。
4. 短页（一屏）：滚轮上下直接翻页。
5. 侧边栏拖拽变窄/变宽：页面随宽度重绘。

## 7. 相关源码路径

| 说明 | 路径 |
|------|------|
| PDF 渲染 | `apps/frontend/src/views/ebook/components/PdfPane.tsx` |
| 缩放 | `apps/frontend/src/views/ebook/utils/pdfReaderSettings.ts` |
| 滚边换页 | `apps/frontend/src/views/ebook/utils/pdfScrolledNav.ts` |
| 顶栏 | `apps/frontend/src/views/ebook/read.tsx` |
| EPUB 同类逻辑 | `apps/frontend/src/views/ebook/utils/epubScrolledNav.ts` |

若与仓库最新源码不一致，以源码为准。
