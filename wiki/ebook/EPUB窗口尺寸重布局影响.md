# EPUB 窗口放大/全屏后正文居中重排

## 文档角色

**增量专题**：在 [EPUB分屏软调整.md](./EPUB分屏软调整.md) 已用 `softResizeEpubRendition` 处理 **分栏拖拽** 的基础上，修复 **应用窗口放大或全屏** 后已加载 EPUB 章节 **正文贴左、右侧大片空白**、需刷新才恢复的问题。

**姊妹文档**：[EPUB分屏软调整.md](./EPUB分屏软调整.md)、[EPUB听书背景重布局.md](./EPUB听书背景重布局.md)、[EPUB阅读分屏.md](./EPUB阅读分屏.md)、[../impact/EPUB窗口尺寸重布局影响.md](../impact/EPUB窗口尺寸重布局影响.md)（窗口 resize 影响面）、[../impact/EPUB听书跟随浮动按钮布局影响.md](../impact/EPUB听书跟随浮动按钮布局影响.md)（布局离屏 FAB 影响面）。

---

## 1. 背景与目标

### 1.1 问题

| 现象 | 根因 |
| ---- | ---- |
| 窗口放大/全屏后正文仍按旧栏宽贴左 | `renderTo` 传入 **固定像素** 宽高后，epub.js **不再** 监听 `window.resize` |
| soft resize 只改 stage，iframe 未重排 | `updateLayout()` 重算 column，但已渲染 **view** 仍锁在旧 `lockedWidth`，未 `size`/`expand` |
| 仅 ResizeObserver 偶发不足 | 最大化时布局链更新与容器观测时序不一致，需补 **window resize** |

### 1.2 目标

- soft resize 后对 **已显示** 的 iframe view 调用 `size` + `expand(true)`，栏宽居中无需 `rendition.resize()` 清 view。
- `EpubPane` 增加 `window.resize` → rAF `applyHostResize` → 150ms 防抖 `settleHostResize`（分栏拖拽期间跳过 settle，沿用既有信号）。
- 保持分栏拖拽仍走 soft 路径，避免白屏。

---

## 2. 改动范围

| 路径 | 变更要点 |
| ---- | -------- |
| `apps/frontend/src/views/ebook/utils/epub/reader/epubSoftResize.ts` | `relayoutEpubViews`；`updateLayout` 后重排各 view |
| `apps/frontend/src/views/ebook/components/reader/EpubPane.tsx` | `window.resize` 监听与防抖 settle；清理 timer/listener |

---

## 3. 实现思路

1. **为何不直接 `rend.resize()`**：manager.resize 会 `clear()` 全部 view 再 display，连续调用易白屏；分栏拖拽已证明 soft 路径可用。
2. **view 重排**：epub.js `IframeView.lock` → `expand()` 按新 `viewSettings.width/height` 重算 iframe 尺寸；须在 `updateLayout()` **之后** 调用。
3. **window 监听**：与 ResizeObserver 并行；稳定后 `settleHostResize` 做完整 `syncEpubReadingAnnotations`。
4. **分栏互斥**：`ebookSplitPanelResizingRef.current` 为 true 时仅 schedule，不 debounce settle（松手仍走 `subscribeEbookSplitPanelResizeEnd`）。

---

## 4. 关键代码对比与注释

### 4.1 `softResizeEpubRendition`（`apps/frontend/src/views/ebook/utils/epub/reader/epubSoftResize.ts`）

**对比范围**：全文件（含新增 `relayoutEpubViews`）。

**改动前** · `apps/frontend/src/views/ebook/utils/epub/reader/epubSoftResize.ts`（基线 HEAD）

```typescript
// epubjs Rendition 类型
import type { Rendition } from 'epubjs';

// manager 上 soft resize 用到的最小类型
type EpubViewManager = {
	// stage.size 更新容器像素宽高
	stage?: {
		size: (
			width?: number | null,
			height?: number | null,
		) => { width: number; height: number };
	};
	// 上次 stage 尺寸缓存
	_stageSize?: { width: number; height: number };
	// 重算 layout（column 宽高等）
	updateLayout: () => void;
};

/**
 * 在不 clear 已有 view 的前提下更新 EPUB 排版。
 * rendition.resize() 会清空视图并重载章节，连续调用会白屏；拖拽分栏应优先走此路径。
 */
export function softResizeEpubRendition(
	// epubjs 渲染实例
	rend: Rendition,
	// 目标容器宽度
	width: number,
	// 目标容器高度
	height: number,
): boolean {
	// 从 rendition 取出 view manager
	const manager = (rend as unknown as { manager?: EpubViewManager }).manager;
	// manager 或 stage.size / updateLayout 不可用时走硬 resize 兜底
	if (!manager?.stage?.size || typeof manager.updateLayout !== 'function') {
		return false;
	}

	// 宽高取整且至少 1px
	const w = Math.max(Math.floor(width), 1);
	const h = Math.max(Math.floor(height), 1);
	// 读取上次 stage 尺寸
	const prev = manager._stageSize;
	// 尺寸未变则直接返回 true（旧版不重排 view，放大后可能仍贴左）
	if (prev && prev.width === w && prev.height === h) {
		return true;
	}

	try {
		// rendition.settings 供 epub.js 内部读取
		const rendition = rend as unknown as {
			settings: { width?: number; height?: number };
		};
		// 同步 settings
		rendition.settings.width = w;
		rendition.settings.height = h;
		// 更新 stage DOM 宽高
		manager.stage.size(w, h);
		// 重算 layout（不 clear view）
		manager.updateLayout();
		// 旧版到此结束，已渲染 iframe 仍可能保持旧栏宽
		return true;
	} catch {
		// soft 失败，由调用方 rend.resize
		return false;
	}
}
```

**改动后** · `apps/frontend/src/views/ebook/utils/epub/reader/epubSoftResize.ts`（当前，约 L1–L69）

```typescript
// epubjs Rendition 类型
import type { Rendition } from 'epubjs';

// 单个 iframe view 上 soft relayout 需要的方法
type EpubView = {
	// 是否已 display
	displayed?: boolean;
	// 按新宽高 lock 轴
	size?: (width?: number, height?: number) => void;
	// 按 lock 后尺寸展开 iframe
	expand?: (force?: boolean) => void;
};

// manager 上 soft resize 用到的类型（扩展 viewSettings / views）
type EpubViewManager = {
	stage?: {
		size: (
			width?: number | null,
			height?: number | null,
		) => { width: number; height: number };
	};
	_stageSize?: { width: number; height: number };
	// updateLayout 写入的 column 宽高
	viewSettings?: { width?: number; height?: number };
	// 连续滚动下多章 view 列表
	views?: { all?: () => EpubView[] };
	updateLayout: () => void;
};

// updateLayout 后让已渲染 iframe view 按新 column 尺寸 re-lock / expand（避免宽屏仍贴左）
function relayoutEpubViews(manager: EpubViewManager): void {
	// 新 column 宽
	const w = manager.viewSettings?.width;
	// 新 column 高
	const h = manager.viewSettings?.height;
	// 缺尺寸或 views API 则跳过
	if (!w || !h || !manager.views?.all) return;
	// 遍历当前 manager 内所有 view
	for (const view of manager.views.all()) {
		// 未展示的章不处理
		if (!view.displayed) continue;
		// 更新 lock 宽高
		view.size?.(w, h);
		// 强制 expand 重算 iframe 布局
		view.expand?.(true);
	}
}

/**
 * 在不 clear 已有 view 的前提下更新 EPUB 排版。
 * rendition.resize() 会清空视图并重载章节，连续调用会白屏；拖拽分栏应优先走此路径。
 */
export function softResizeEpubRendition(
	rend: Rendition,
	width: number,
	height: number,
): boolean {
	const manager = (rend as unknown as { manager?: EpubViewManager }).manager;
	if (!manager?.stage?.size || typeof manager.updateLayout !== 'function') {
		return false;
	}

	const w = Math.max(Math.floor(width), 1);
	const h = Math.max(Math.floor(height), 1);
	const prev = manager._stageSize;
	// 尺寸未变仍 relayout view（修复 view 与 stage 不同步的边角）
	if (prev && prev.width === w && prev.height === h) {
		relayoutEpubViews(manager);
		return true;
	}

	try {
		const rendition = rend as unknown as {
			settings: { width?: number; height?: number };
		};
		rendition.settings.width = w;
		rendition.settings.height = h;
		manager.stage.size(w, h);
		manager.updateLayout();
		// 关键：让已加载章节 iframe 跟随新栏宽居中
		relayoutEpubViews(manager);
		return true;
	} catch {
		return false;
	}
}
```

**变更摘要**：新增 `relayoutEpubViews`，在 `updateLayout` 后对已 display 的 view 执行 `size` + `expand(true)`；尺寸未变分支也补 relayout。

---

### 4.2 `EpubPane` 窗口 resize 监听（`apps/frontend/src/views/ebook/components/reader/EpubPane.tsx`）

**对比范围**：主 effect 内「页面尺寸自适应」段落（ResizeObserver 至 cleanup 相关片段）。

**改动前** · `apps/frontend/src/views/ebook/components/reader/EpubPane.tsx`（基线 HEAD，约 L485–L545）

```typescript
		// ============================ 页面尺寸自适应机制 ============================
		// rAF 合并 ResizeObserver 回调
		let resizeRaf: number | null = null;

		// 实际尺寸应用及高亮样式恢复
		const applyHostResize = () => {
			if (!hostRef.current || !readyRef.current || !rendRef.current) return;
			const w = Math.max(hostRef.current.clientWidth, 320);
			const h = Math.max(hostRef.current.clientHeight, 320);
			const rend = rendRef.current;
			if (!softResizeEpubRendition(rend, w, h)) {
				try {
					rend.resize(w, h);
				} catch {
					// 忽略
				}
			}
			patchEpubReadingAnnotations(rend, { sync: true });
			relayoutListenMarkHighlight(rend);
		};

		const scheduleHostResize = () => {
			if (resizeRaf != null) cancelAnimationFrame(resizeRaf);
			resizeRaf = requestAnimationFrame(() => {
				resizeRaf = null;
				applyHostResize();
			});
		};

		const settleHostResize = () => {
			applyHostResize();
			const rend = rendRef.current;
			if (!rend || !readyRef.current) return;
			syncEpubReadingAnnotations(
				rend,
				thoughtsRef.current ?? [],
				highlightsRef.current ?? [],
				appliedThoughtsRef.current,
				appliedHighlightsRef.current,
			);
		};

		// 仅监听 host 容器 ResizeObserver
		const ro = new ResizeObserver(() => {
			scheduleHostResize();
		});
		ro.observe(el);

		const unsubSplitResizeEnd =
			subscribeEbookSplitPanelResizeEnd(settleHostResize);

		return () => {
			if (resizeRaf != null) cancelAnimationFrame(resizeRaf);
			unsubSplitResizeEnd();
			// ...（其余 cleanup 未改动）
		};
```

**改动后** · `apps/frontend/src/views/ebook/components/reader/EpubPane.tsx`（当前，约 L487–L565）

```typescript
		// ============================ 页面尺寸自适应机制 ============================
		let resizeRaf: number | null = null;
		// 窗口 resize 防抖 settle 定时器
		let windowResizeSettleTimer: ReturnType<typeof setTimeout> | null = null;

		const applyHostResize = () => {
			if (!hostRef.current || !readyRef.current || !rendRef.current) return;
			const w = Math.max(hostRef.current.clientWidth, 320);
			const h = Math.max(hostRef.current.clientHeight, 320);
			const rend = rendRef.current;
			if (!softResizeEpubRendition(rend, w, h)) {
				try {
					rend.resize(w, h);
				} catch {
					// 忽略
				}
			}
			patchEpubReadingAnnotations(rend, { sync: true });
			relayoutListenMarkHighlight(rend);
		};

		const scheduleHostResize = () => {
			if (resizeRaf != null) cancelAnimationFrame(resizeRaf);
			resizeRaf = requestAnimationFrame(() => {
				resizeRaf = null;
				applyHostResize();
			});
		};

		const settleHostResize = () => {
			applyHostResize();
			const rend = rendRef.current;
			if (!rend || !readyRef.current) return;
			syncEpubReadingAnnotations(
				rend,
				thoughtsRef.current ?? [],
				highlightsRef.current ?? [],
				appliedThoughtsRef.current,
				appliedHighlightsRef.current,
			);
		};

		const ro = new ResizeObserver(() => {
			scheduleHostResize();
		});
		ro.observe(el);

		// 窗口放大/全屏：epub.js 固定初始宽高时不自带 window resize；补监听并在稳定后 settle
		const onWindowResize = () => {
			// 每帧合并一次 apply
			scheduleHostResize();
			// 分栏拖拽中不 debounce settle（松手走 splitResizeEnd）
			if (ebookSplitPanelResizingRef.current) return;
			if (windowResizeSettleTimer) clearTimeout(windowResizeSettleTimer);
			windowResizeSettleTimer = setTimeout(() => {
				windowResizeSettleTimer = null;
				if (ebookSplitPanelResizingRef.current) return;
				// 稳定后完整 sync 划线/想法
				settleHostResize();
			}, 150);
		};
		window.addEventListener('resize', onWindowResize);

		const unsubSplitResizeEnd =
			subscribeEbookSplitPanelResizeEnd(settleHostResize);

		return () => {
			if (resizeRaf != null) cancelAnimationFrame(resizeRaf);
			if (windowResizeSettleTimer) clearTimeout(windowResizeSettleTimer);
			window.removeEventListener('resize', onWindowResize);
			unsubSplitResizeEnd();
			// ...（其余 cleanup 未改动）
		};
```

**变更摘要**：import `ebookSplitPanelResizingRef`；新增 `window.resize` + 150ms settle；cleanup 清理 timer 与 listener。

---

## 5. 兼容性与影响

- **分栏拖拽**：逻辑不变，仍优先 soft resize + 松手 settle。
- **听书播放背景**：`applyHostResize` 末尾仍调用 `relayoutListenMarkHighlight`。
- **回归建议**：打开 EPUB → 放大窗口/全屏 → 正文应居中无需刷新；再拖分栏手柄 → 无白屏；划线/想法仍可见。

---

## 6. 相关源码路径

| 说明 | 路径 |
| ---- | ---- |
| soft resize + view relayout | `apps/frontend/src/views/ebook/utils/epub/reader/epubSoftResize.ts` |
| 窗口/容器 resize 接线 | `apps/frontend/src/views/ebook/components/reader/EpubPane.tsx` |
| 分栏拖拽信号 | `apps/frontend/src/views/ebook/utils/common/ebookSplitResize.ts` |

---

（若与仓库最新源码不一致，以源码为准）
