# EPUB 阅读设置：点击正文关闭面板

## 文档角色

**增量专题**：阅读设置 Popover 打开时，用户点击 **左侧 EPUB 阅读区**（含 iframe 内正文）应 **关闭设置面板**，与点击页面其它外部区域的行为一致。

**姊妹文档**：[EPUB阅读器表面背景.md](./EPUB阅读器表面背景.md)（设置 Popover 背景同步）、[EPUB阅读器设置滚动.md](./EPUB阅读器设置滚动.md)（阅读设置项说明）。

---

## 1. 背景与目标

### 1.1 问题

Radix `Popover` 的 **Interact Outside** 仅在 **同一 document** 内判定。EPUB 正文渲染在 **epub.js 章节 iframe** 中，iframe 内 `mousedown` **不会冒泡** 到顶层 document，故点击正文 **无法** 触发 Popover 默认的「点击外部关闭」。

### 1.2 目标

- 设置面板打开时：点击阅读区（iframe 内 + 宿主容器非 iframe 区域）→ `setEpubSettingsOpen(false)`。
- 仅在 `epubSettingsOpen === true` 时挂载 iframe 监听，避免常态开销。
- 不干扰 Popover 触发钮与其它顶栏控件（监听范围限定在阅读区分栏左侧）。

---

## 2. 改动范围

| 路径 | 变更要点 |
| ---- | -------- |
| `apps/frontend/src/views/ebook/utils/epubContextMenuAttach.ts` | 新增 `attachEpubIframePointerDown` |
| `apps/frontend/src/views/ebook/components/EpubPane.tsx` | `onReaderPointerDown` prop + `useEffect` 挂载 |
| `apps/frontend/src/views/ebook/read.tsx` | `closeEpubSettings`；阅读区容器 `onPointerDown` + 传 prop |

**未改动**：`EpubReaderSettingsPopover` 仍用 Radix 受控 `open` / `onOpenChange`；顶栏点击外部关闭仍由 Popover 原生处理。

---

## 3. 实现思路

1. **复用 epub.js contents 挂载模式**：与右键菜单、`selectionPopBar` 相同，经 `rend.hooks.content.register` 绑定各章节 iframe 的 `document`。
2. **捕获阶段 mousedown**：在 iframe 内任意按下即关闭，不等待 click，与 Popover dismiss 时序一致。
3. **双通道**：iframe 走 `attachEpubIframePointerDown`；宿主 div（epub.js 容器边距等）走 React `onPointerDown`，覆盖非 iframe 点击。
4. **条件挂载**：`onReaderPointerDown={epubSettingsOpen ? closeEpubSettings : undefined}`，关闭面板后 effect cleanup 移除监听。

---

## 4. 关键代码对比与注释

### 4.1 `attachEpubIframePointerDown`

**对比范围**：基线文件末尾无此函数；以下为 **纯新增**。

**改动后** · `apps/frontend/src/views/ebook/utils/epubContextMenuAttach.ts`（当前，约 L92–L125）

```typescript
/**
 * 监听 epub.js 各章节 iframe 内的 pointer 按下（用于关闭浮层等）。
 * iframe 内事件不会冒泡到顶层，需单独挂载。
 */
export function attachEpubIframePointerDown(
	rend: Rendition,
	onPointerDown: () => void,
): () => void {
	// 每个 contents（章节 iframe）对应一份 detach
	const cleanups = new Map<EpubIframeContents, () => void>();

	const bindContents = (contents: EpubIframeContents) => {
		if (cleanups.has(contents)) return;
		const doc = contents.document;
		// 捕获阶段监听，尽早触发关闭
		const handler = () => onPointerDown();
		doc.addEventListener('mousedown', handler, true);
		cleanups.set(contents, () =>
			doc.removeEventListener('mousedown', handler, true),
		);
	};

	// 新章节 iframe 载入时自动绑定
	rend.hooks.content.register(bindContents);

	// 对已存在的 contents 补绑
	const existing = rend.getContents();
	if (Array.isArray(existing)) {
		for (const item of existing) bindContents(item as EpubIframeContents);
	} else if (existing) {
		bindContents(existing as EpubIframeContents);
	}

	return () => {
		for (const fn of cleanups.values()) fn();
		cleanups.clear();
	};
}
```

**变更摘要**：与 `attachEpubIframeContextMenu` 同构的 contents 生命周期管理，专用于 iframe 内按下回调。

---

### 4.2 `EpubPane` 条件挂载

**对比范围**：Props 新增 `onReaderPointerDown` 及对应 `useEffect`。

**改动前** · `apps/frontend/src/views/ebook/components/EpubPane.tsx`（基线，摘录）

```typescript
type Props = {
	// ...
	onReaderContextMenu?: (payload: EpubReaderContextMenuPayload) => void;
	onSelectionPopBar?: (payload: EpubSelectionPopBarPayload | null) => void;
	// 无 onReaderPointerDown
};

// 无 iframe pointerDown effect
```

**改动后** · `apps/frontend/src/views/ebook/components/EpubPane.tsx`（当前，约 L65–L68、L289–L297）

```typescript
type Props = {
	// ...
	onReaderContextMenu?: (payload: EpubReaderContextMenuPayload) => void;
	/** iframe 内按下时回调（如关闭阅读设置浮层） */
	onReaderPointerDown?: () => void;
	onSelectionPopBar?: (payload: EpubSelectionPopBarPayload | null) => void;
};

useEffect(() => {
	const rend = rendRef.current;
	// 无 rendition、未 ready、或未传回调时不挂载
	if (!rend || !rendReady || !onReaderPointerDown) return;

	return attachEpubIframePointerDown(rend, () => {
		onReaderPointerDownRef.current?.();
	});
}, [rendReady, onReaderPointerDown]);
```

**变更摘要**：父组件传入回调时绑定 iframe；`onReaderPointerDown` 变为 `undefined` 时 effect 清理并卸载监听。

---

### 4.3 `read.tsx` 关闭逻辑与阅读区点击

**对比范围**：`closeEpubSettings` 与阅读区容器 / `EpubPane` 传参。

**改动前** · `apps/frontend/src/views/ebook/read.tsx`（基线，摘录）

```typescript
const resetEpubSettings = useCallback(() => {
	setEpubSettings(DEFAULT_EPUB_READER_SETTINGS);
	saveEpubReaderSettings(DEFAULT_EPUB_READER_SETTINGS);
}, []);

// 阅读区容器仅 onContextMenu
<div
	className="flex h-full min-h-0 flex-1 flex-col"
	onContextMenu={onHostContextMenu}
>
	<EpubPane
		// ...
		onReaderContextMenu={showEpubContextMenu}
		onSelectionPopBar={onSelectionPopBarChange}
	/>
</div>
```

**改动后** · `apps/frontend/src/views/ebook/read.tsx`（当前，约 L957–L960、L1742–L1764）

```typescript
const closeEpubSettings = useCallback(() => {
	setEpubSettingsOpen(false);
}, []);

<div
	className="flex h-full min-h-0 flex-1 flex-col"
	onContextMenu={onHostContextMenu}
	onPointerDown={() => {
		// 宿主层点击（非 iframe 区域）同样关闭设置
		if (epubSettingsOpen) closeEpubSettings();
	}}
>
	<EpubPane
		// ...
		onReaderContextMenu={showEpubContextMenu}
		onReaderPointerDown={
			epubSettingsOpen ? closeEpubSettings : undefined
		}
		onSelectionPopBar={onSelectionPopBarChange}
	/>
</div>
```

**变更摘要**：打开设置时双路关闭；关闭后面板 state 为 false，iframe 监听随 prop 卸载。

---

## 5. 兼容性与影响

| 场景 | 行为 |
| ---- | ---- |
| 设置关闭 | 不挂载 iframe 监听 |
| 设置打开 + 点击正文 | 面板关闭，正文仍接收正常选区/滚动 |
| 设置打开 + 点击 Popover 内 | 不触发阅读区 handler，Popover 保持打开 |
| 设置打开 + 点击顶栏（Popover 外） | Radix 原生 outside dismiss + 可能重复 `setState(false)`（无害） |

**回归建议**：打开阅读设置 → 点击正文不同段落 → 面板应关闭；再次打开 → 在 iframe 内拖选文字 → 面板应先关闭再出现选区 PopBar（若适用）。

---

## 6. 相关源码路径

| 说明 | 路径 |
| ---- | ---- |
| iframe 挂载工具 | `apps/frontend/src/views/ebook/utils/epubContextMenuAttach.ts` |
| Rendition 侧消费 | `apps/frontend/src/views/ebook/components/EpubPane.tsx` |
| 状态与传参 | `apps/frontend/src/views/ebook/read.tsx` |
| Popover 受控 | `apps/frontend/src/views/ebook/components/EpubReaderSettingsPopover.tsx` |

---

（若与仓库最新源码不一致，以源码为准）
