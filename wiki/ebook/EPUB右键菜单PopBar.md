# EPUB 右键菜单与选区 PopBar 协同

## 文档角色

**增量专题**：修复 EPUB 阅读时「右键打开菜单 PopBar 先关再开闪烁」与「未手动选中时右键自动点词」两类体验问题；与选区工具条、自定义右键菜单的状态协同。

**延伸阅读**：[EPUB助手右键菜单.md](./EPUB助手右键菜单.md)、[EPUB PopBar性能体验.md](./EPUB PopBar性能体验.md)、[EPUB阅读分屏.md](./EPUB阅读分屏.md)。

---

## 1. 背景与目标

### 1.1 问题

1. **PopBar 闪烁**：已有文字选区并显示 PopBar 时，右键打开菜单会先关掉 PopBar，菜单出现前又闪回一帧。根因是浏览器事件顺序为 `mousedown` → `mouseup` → `contextmenu`；旧逻辑在 `mouseup` 上再次 `emitSelection()`，在 `contextmenu` 真正关 PopBar 之前把工具条重新打开。
2. **右键自动点词**：未手动拖选时，浏览器会在右键按下/弹菜单时自动选中光标下词语，菜单按「有选区」展示复制 / MK 问书 / 写想法，且正文出现灰色高亮，与「无选区菜单」预期不符。

### 1.2 目标

- 右键打开菜单时 PopBar **直接关闭**，不闪烁。
- 未事先手动选区时，右键菜单按 **无选区** 处理（智能助手、翻页、目录等），并清除浏览器临时选区。
- 用户先拖选再右键时，保留选区与带选区菜单项。

---

## 2. 改动范围

| 路径 | 说明 |
|------|------|
| `apps/frontend/src/views/ebook/utils/epubSelectionToolbarAttach.ts` | 右键手势跳过 `emitSelection`；`forceHidePopBar` |
| `apps/frontend/src/views/ebook/utils/epubContextMenuAttach.ts` | 右键前快照选区；自动点词时清选区并上报空文本 |
| `apps/frontend/src/views/ebook/read.tsx` | `contextMenuOpenRef`；打开菜单时关 PopBar；`onSelectionPopBarChange` 兜底 |

---

## 3. 实现思路

1. **iframe 选区层**（`attachEpubSelectionPopBar`）：右键 `mousedown` 标记 `contextMenuGesture` 并 `suppressEmitUntil`；右键 `mouseup` **不**调用 `emitSelection`；`contextmenu` 时 `forceHidePopBar()`（不受 `suppressDismiss` 影响）。
2. **iframe 菜单层**（`attachEpubIframeContextMenu`）：capture 阶段 `mousedown(button===2)` 记录 `hadSelectionBeforeRightClick`；`contextmenu` 时若右键前无选区则 `removeAllRanges()`，`selectedText` 置空，`hasSelection=false`。
3. **React 层**（`read.tsx`）：`showReaderContextMenu` 同步 `contextMenuOpenRef=true` 并清 PopBar state；`onSelectionPopBarChange` 在 `contextMenuOpenRef` 为 true 时忽略重新打开；`closeContextMenu` 复位 ref。

---

## 4. 关键代码对比与注释

### 4.1 `bindContents` 内指针与 `contextmenu`（`epubSelectionToolbarAttach.ts`）

**对比范围**：`attachEpubSelectionPopBar` 内 `bindContents` 的 `onPointerDown` / `onPointerUp` / `onContextMenu` 及辅助 `forceHidePopBar`（摘录）。

**改动前** · `apps/frontend/src/views/ebook/utils/epubSelectionToolbarAttach.ts`（基线 HEAD，约 L287–L321）

```typescript
		// 任意按下即隐藏 PopBar，不区分左键/右键
		const onPointerDown = () => {
			// 标记正在拖选
			selecting = true;
			// 隐藏浮动工具条
			hidePopBar();
		};

		// 松手后一律尝试上报选区并展示 PopBar
		const onPointerUp = () => {
			// 非拖选流程则忽略
			if (!selecting) return;
			// 结束拖选
			selecting = false;
			// 右键mouseup也会走到这里，导致 contextmenu 前 PopBar 被重新打开
			emitSelection();
		};

		// ... onSelectionChange 未改动（摘录省略） ...

		// contextmenu 时 hidePopBar，可能被 suppressDismiss 挡住
		const onContextMenu = () => hidePopBar();
```

**改动后** · `apps/frontend/src/views/ebook/utils/epubSelectionToolbarAttach.ts`（当前，约 L217–L237、L320–L375）

```typescript
	// 右键菜单手势：mouseup 早于 contextmenu，须跳过 emit 避免 PopBar 闪一下再关
	let contextMenuGesture = false;

	// 取消待执行的 rAF / 键盘选区定时器
	const clearPendingEmit = () => {
		cancelAnimationFrame(rafId);
		rafId = 0;
		window.clearTimeout(keyboardEmitTimer);
		keyboardEmitTimer = 0;
	};

	// 普通隐藏：尊重 suppressDismiss（分享弹窗等）
	const hidePopBar = () => {
		if (shouldSuppressDismiss()) return;
		clearPendingEmit();
		onChange(null);
	};

	// 右键菜单等场景：必须关 PopBar，不受 suppressDismiss 影响
	const forceHidePopBar = () => {
		clearPendingEmit();
		onChange(null);
	};

		// 指针按下：识别右键并抑制后续 emit
		const onPointerDown = (e: Event) => {
			if (e instanceof MouseEvent && e.button === 2) {
				// 进入右键菜单手势
				contextMenuGesture = true;
				// 600ms 内禁止 emitSelection / selectionchange 延迟上报
				suppressEmitUntil = Date.now() + 600;
			}
			// 标记拖选开始
			selecting = true;
			// 先隐藏 PopBar
			hidePopBar();
		};

		// 指针松开：右键路径不 emit
		const onPointerUp = (e: Event) => {
			if (!selecting) return;
			selecting = false;
			if (
				contextMenuGesture ||
				(e instanceof MouseEvent && e.button === 2)
			) {
				// 等待 contextmenu 统一 forceHide，避免闪回
				return;
			}
			emitSelection();
		};

		// 真正弹出右键菜单时强制关闭 PopBar
		const onContextMenu = () => {
			contextMenuGesture = false;
			suppressEmitUntil = Date.now() + 600;
			forceHidePopBar();
		};
```

**变更摘要**：右键 `mouseup` 不再 `emitSelection`；`contextmenu` 用 `forceHidePopBar` 保证关闭。

---

### 4.2 `bindContents` 右键选区判定（`epubContextMenuAttach.ts`）

**对比范围**：`attachEpubIframeContextMenu` 内 `bindContents` 全文（含 `clearWindowSelection`）。

**改动前** · `apps/frontend/src/views/ebook/utils/epubContextMenuAttach.ts`（基线 HEAD，约 L42–L75）

```typescript
	const bindContents = (contents: EpubIframeContents) => {
		if (cleanups.has(contents)) return;
		const doc = contents.document;
		const win = contents.window;

		const onCtx = (e: MouseEvent) => {
			e.preventDefault();
			e.stopPropagation();
			// 直接读取当前选区，含浏览器右键自动点词
			const selectedText = readSelectionText(win);
			let cfiRange: string | undefined;
			const sel = win.getSelection();
			if (sel && sel.rangeCount > 0) {
				const range = sel.getRangeAt(0);
				if (!range.collapsed) {
					cfiRange = resolveSelectionCfiRange(rend, win, range);
				}
			}
			const { x, y } = toViewportPoint(e, win);
			onMenu({
				clientX: x,
				clientY: y,
				selectedText,
				cfiRange,
				copySelection: () => {
					const text = readSelectionText(win);
					if (!text) return;
					void copyToClipboard(text);
				},
			});
		};

		doc.addEventListener('contextmenu', onCtx);
		cleanups.set(contents, () => doc.removeEventListener('contextmenu', onCtx));
	};
```

**改动后** · `apps/frontend/src/views/ebook/utils/epubContextMenuAttach.ts`（当前，约 L62–L141）

```typescript
	const bindContents = (contents: EpubIframeContents) => {
		if (cleanups.has(contents)) return;
		const doc = contents.document;
		const win = contents.window;
		// 右键 mousedown 前是否已有用户选区（区分浏览器右键自动点词）
		let hadSelectionBeforeRightClick = false;

		// capture 阶段记录右键按下前的选区状态
		const onRightMouseDown = (e: MouseEvent) => {
			if (e.button !== 2) return;
			hadSelectionBeforeRightClick = Boolean(readSelectionText(win));
		};

		const onCtx = (e: MouseEvent) => {
			e.preventDefault();
			e.stopPropagation();

			// 右键前无选区 → 当前高亮视为浏览器自动点词
			const browserAutoSelected = !hadSelectionBeforeRightClick;
			hadSelectionBeforeRightClick = false;

			if (browserAutoSelected) {
				clearWindowSelection(win);
			}

			const selectedText = browserAutoSelected ? '' : readSelectionText(win);
			let cfiRange: string | undefined;
			const sel = win.getSelection();
			if (sel && sel.rangeCount > 0) {
				const range = sel.getRangeAt(0);
				if (!range.collapsed) {
					cfiRange = resolveSelectionCfiRange(rend, win, range);
				}
			}
			const { x, y } = toViewportPoint(e, win);
			onMenu({
				clientX: x,
				clientY: y,
				selectedText,
				cfiRange,
				copySelection: () => {
					const text = readSelectionText(win);
					if (!text) return;
					void copyToClipboard(text);
				},
			});
		};

		doc.addEventListener('mousedown', onRightMouseDown, true);
		doc.addEventListener('contextmenu', onCtx);
		cleanups.set(contents, () => {
			doc.removeEventListener('mousedown', onRightMouseDown, true);
			doc.removeEventListener('contextmenu', onCtx);
		});
	};
```

**变更摘要**：右键前快照选区；自动点词时清选区并按无选区上报，菜单不展示复制/MK 问书/写想法。

---

### 4.3 `showReaderContextMenu` / `onSelectionPopBarChange`（`read.tsx`）

**对比范围**：`closeContextMenu`、`showReaderContextMenu` 全文；`onSelectionPopBarChange` 开头守卫（摘录）。

**改动前** · `apps/frontend/src/views/ebook/read.tsx`（基线 HEAD，约 L1264–L1280、无 `contextMenuOpenRef`）

```typescript
	const closeContextMenu = useCallback(() => {
		setContextMenu(null);
	}, []);

	const showReaderContextMenu = useCallback(
		(payload: { clientX: number; clientY: number; hasSelection?: boolean }) => {
			setSelectionPopBar(null);
			selectionPopBarRef.current = null;
			setContextMenu({
				open: true,
				x: payload.clientX,
				y: payload.clientY,
				hasSelection: Boolean(payload.hasSelection),
			});
		},
		[],
	);

	// onSelectionPopBarChange 打开分支无 contextMenu 守卫（基线）
```

**改动后** · `apps/frontend/src/views/ebook/read.tsx`（当前，约 L164、L732–L741、L1330–L1348）

```typescript
	const contextMenuOpenRef = useRef(false);

	const onSelectionPopBarChange = useCallback(
		(payload: EpubSelectionPopBarPayload | null) => {
			if (!payload) {
				if (quoteShareOpenRef.current) return;
				setSelectionPopBar(null);
				selectionPopBarRef.current = null;
				return;
			}
			// 菜单已打开时忽略 iframe 延迟 emit，防止 PopBar 闪回
			if (contextMenuOpenRef.current) return;
			// ... 其余未改动（摘录） ...
		},
		[],
	);

	const closeContextMenu = useCallback(() => {
		contextMenuOpenRef.current = false;
		setContextMenu(null);
	}, []);

	const showReaderContextMenu = useCallback(
		(payload: { clientX: number; clientY: number; hasSelection?: boolean }) => {
			contextMenuOpenRef.current = true;
			setSelectionPopBar(null);
			selectionPopBarRef.current = null;
			setContextMenu({
				open: true,
				x: payload.clientX,
				y: payload.clientY,
				hasSelection: Boolean(payload.hasSelection),
			});
		},
		[],
	);
```

**变更摘要**：`contextMenuOpenRef` 同步菜单开关；React 层兜底拦截 PopBar 重开。

---

## 5. 兼容性与影响

| 项 | 说明 |
|----|------|
| 先选区再右键 | 保留选区与带选区菜单项 |
| 无选区右键 | 菜单为智能助手 + 导航项；正文无灰色点词 |
| 分享书摘弹窗 | `quoteShareOpenRef` / `suppressDismiss` 逻辑不变 |
| PDF | 不受本次 iframe 选区监听影响 |

## 6. 回归建议

1. 拖选文字 → PopBar 显示 → 右键：PopBar 立即消失，仅菜单，无闪烁。
2. 不选文字 → 右键：无灰色选区，菜单无复制/MK 问书/写想法。
3. 拖选 → 右键 → 复制 / MK 问书：行为与改前一致。
4. PopBar 点分享书摘 → 弹窗打开：PopBar 不因失焦误关（见 [EPUB引用分享.md](./EPUB引用分享.md)）。

## 7. 相关源码路径

| 说明 | 路径 |
|------|------|
| 选区 PopBar 监听 | `apps/frontend/src/views/ebook/utils/epubSelectionToolbarAttach.ts` |
| 右键菜单挂载 | `apps/frontend/src/views/ebook/utils/epubContextMenuAttach.ts` |
| 阅读页编排 | `apps/frontend/src/views/ebook/read.tsx` |

---

（若与仓库最新源码不一致，以源码为准）
