# EPUB 阅读右侧分栏（MK 问书 + 读书想法）

## 文档角色

**主文档**：阅读页 **右侧分栏** 的 state 编排（MK 问书 / 读书想法互斥同栏）与 **布局收起**（关闭后阅读区全宽）。涵盖顶栏 Bot、PopBar「MK 问书」、想法侧栏入口，以及关闭列表、删最后一条想法、热更新刷新后的留白修复。

**延伸阅读**：[EPUB想法侧面板.md](./EPUB想法侧面板.md)（想法 UI）、[EPUB分屏软调整.md](./EPUB分屏软调整.md)（拖拽 soft resize）、[EPUB想法引用视口.md](./EPUB想法引用视口.md)（分栏 resize 后引用 scroll）、[EPUB想法列表删除关闭.md](./EPUB想法列表删除关闭.md)（删最后一条与详情样式）。

> 原 `epub-side-panel-moke.md`、`epub-split-panel-collapse.md`、`epub-split-panel-unmount.md` 已并入本文。

---

## 1. 背景与目标

### 1.1 现象

| 场景 | 用户感知 |
|------|----------|
| 关闭 MK 问书 / 想法列表 | 右侧 ~42% 空白，左侧未全宽 |
| 想法列表 → MK 问书 | 中间一帧分栏收起，左侧闪烁 |
| 删列表最后一条想法 | 侧栏关但布局仍 58/42 |
| 开发热更新刷新 | 侧栏关态下右侧空白持续 |
| MK 开着点用户划线 | 助手被误关 |

### 1.2 根因（分层）

**State（`read.tsx`）**

- 打开 MK 时若先 `setThoughtListOpen(false)`，分栏先收再开 → 闪烁。
- `sidePanelOpen` 与 `thoughtListOpen` / `cluster` 错位（列表已关但 cluster 仍在；**删最后一条** 后 `cluster` 空壳仍满足旧条件）。
- 删除想法时仅读 `returnToListClusterRef`，从划线进详情时快照缺失。
- 划线 PopBar 路径 `setAssistantOpen(false)` 误关 MK。

**Layout（`EbookReadSplitLayout.tsx`）**

- 曾用常驻 `assistant` panel + `collapse()` / `setLayout(100/0)`：`hidden`、`opacity-0`、多帧 rAF 均 **偶发不收宽**。
- 条件卸载右栏 panel 后 **未** `setLayout({ reader: 100 })`，reader 仍约 58%。

### 1.3 目标

| 层 | 策略 |
|----|------|
| 打开 MK | 只 `setAssistantOpen(true)`，**不**清想法 state；`sidePanel` 优先级切到助手 |
| 关闭 MK | `setAssistantOpen(false)`；有想法列表/详情则回退显示 |
| `sidePanelOpen` | `assistantOpen \|\| thoughtDialogOpen \|\| thoughtListPanelOpen`（列表须 `allThoughts.length > 0`） |
| 布局关闭 | **`sidePanelOpen` 为 false 时不挂载** handle + assistant panel；**且** rAF 内 `setLayout({ reader: 100 })` |
| 布局打开 | rAF 内且 `sidePanelOpenRef` 仍为 true 时 `setLayout(lastSplitLayoutRef)` |
| 删除想法 | 快照 `returnToListClusterRef ?? thoughtListClusterRef`；`fromList` 进详情时清 cluster |

---

## 2. 改动范围

| 路径 | 说明 |
|------|------|
| `apps/frontend/src/views/ebook/read.tsx` | MK 开闭、想法侧栏 state、`sidePanelOpen`、`deleteThought` |
| `apps/frontend/src/views/ebook/components/EbookReadSplitLayout.tsx` | 条件卸载右栏 panel |
| `apps/frontend/src/views/ebook/utils/ebookSplitResize.ts` | `notifyEbookSplitPanelResizeEnd` |

---

## 3. 实现思路

### 3.1 `sidePanel` 内容优先级

1. `assistantOpen` → `EbookAssistant`
2. `thoughtDialogOpen` → `EpubThought`（详情/编辑）
3. `thoughtListOpen && thoughtListCluster` → `EpubThoughtList`

打开想法时仍 `setAssistantOpen(false)`（显式切到想法）；打开 MK **不**关想法 state，由优先级决定渲染谁。

### 3.2 `sidePanelOpen` 与 slot

```typescript
const thoughtPanelOpen =
	thoughtDialogOpen || (thoughtListOpen && thoughtListCluster != null);

const sidePanelOpen =
	assistantOpen ||
	thoughtDialogOpen ||
	(Boolean(thoughtListOpen) && thoughtListCluster != null);
```

`sidePanelSlot` 包一层 `key={assistant|thought-dialog|thought-list}`，切换时正确挂载。

### 3.3 布局：条件卸载（当前方案）

- **关闭**：`{sidePanelOpen ? <Handle/><Assistant/> : null}`，分组内仅 reader → 100% 宽；只 `notifyEbookSplitPanelResizeEnd`，**不**对单 panel 调双栏 `setLayout`。
- **打开**：`useLayoutEffect` → rAF → `if (sidePanelOpenRef.current) setLayout(lastSplitLayoutRef)`。

### 3.4 演进简表（勿再实现旧方案）

| 阶段 | 做法 | 问题 |
|------|------|------|
| v1 | `useEffect` + `setLayout(100/0)` | 首帧仍 58/42 |
| v2 | 三帧 `collapse` + `hidden` | `hidden` 脱离度量，仍留白 |
| v3 | `applyClosedLayout` + `opacity-0` + 单 rAF | collapse 仍偶发失效 |
| **v4（当前）** | 关闭时不挂右栏 panel | 可靠全宽；打开需注意 1-panel layout |

---

## 4. 关键代码

### 4.1 `openAssistant` / `toggleAssistant`（`read.tsx`）

**改动前** · 打开 MK 会先关想法列表

```typescript
const openAssistant = useCallback((draft?: string) => {
	setThoughtListOpen(false);
	setThoughtDialogOpen(false);
	if (draft?.trim()) setAssistantInput(draft.trim());
	setAssistantOpen(true);
}, []);
```

**改动后** · 当前（约 L1216–L1231）

```typescript
const openAssistant = useCallback((draft?: string) => {
	if (draft?.trim()) setAssistantInput(draft.trim());
	setAssistantOpen(true);
}, []);

const toggleAssistant = useCallback(() => {
	setAssistantOpen((wasOpen) => {
		if (wasOpen && thoughtListOpen && !thoughtListClusterRef.current) {
			setThoughtListOpen(false);
			setThoughtListCluster(null);
		}
		return !wasOpen;
	});
}, [thoughtListOpen]);
```

---

### 4.2 想法侧栏 `onAskBook`（`read.tsx`）

**改动前**

```typescript
onAskBook: () => {
	setThoughtListOpen(false);
	window.setTimeout(() => openAssistantWithSelection(quote), 0);
},
```

**改动后**

```typescript
onAskBook: () => {
	openAssistantWithSelection(quote);
},
```

---

### 4.3 `closeThoughtList`（`read.tsx`）

```typescript
const closeThoughtList = useCallback(() => {
	returnToListClusterRef.current = null;
	setThoughtListOpen(false);
	setThoughtListCluster(null);
}, []);
```

---

### 4.4 `openViewThought` · `fromList`（`read.tsx`）

```typescript
if (fromList) {
	if (thoughtListClusterRef.current) {
		returnToListClusterRef.current = thoughtListClusterRef.current;
	}
	setThoughtListOpen(false);
	setThoughtListCluster(null);
} else {
	returnToListClusterRef.current = null;
}
```

快照存 ref，state 中 cluster 清空，避免 `sidePanelOpen` 与空 cluster 错位。

---

### 4.5 `deleteThought`（`read.tsx`）

```typescript
const listSnapshot =
	returnToListClusterRef.current ?? thoughtListClusterRef.current;
returnToListClusterRef.current = null;
if (listSnapshot) {
	restoreThoughtListFromSnapshot(listSnapshot, nextThoughts);
} else {
	setThoughtListCluster(null);
	setThoughtListOpen(false);
}
```

`restoreThoughtListFromSnapshot`：`reconciled.allThoughts.length > 0` 则回列表，否则关侧栏。

---

### 4.6 `thoughtListPanelOpen`（`apps/frontend/src/views/ebook/read.tsx`）

**对比范围**：想法列表侧栏是否挂载的派生 state（约 L1459–L1613 摘录）。

**改动前** · 基线，约 L1456–L1613（摘录）

```typescript
	// 想法面板开：详情弹层 或 列表开且 cluster 非 null（含空列表 cluster）
	const thoughtPanelOpen =
		thoughtDialogOpen || (thoughtListOpen && thoughtListCluster != null);

	// syncThoughtQuoteAnchorCfi 内
		if (thoughtListOpen && thoughtListCluster) {
			// ...
		}
	// useEffect deps 含 thoughtListOpen

	// sidePanel 渲染
		if (thoughtListOpen && thoughtListCluster) {
			return ( <EpubThoughtList ... /> );
		}

	// sidePanelOpen
	const sidePanelOpen =
		assistantOpen ||
		thoughtDialogOpen ||
		(Boolean(thoughtListOpen) && thoughtListCluster != null);
```

**改动后** · 当前，约 L1459–L1613（摘录）

```typescript
	// 列表侧栏仅在有至少一条想法时挂载（删最后一条后 cluster 可能暂留空壳）
	const thoughtListPanelOpen =
		thoughtListOpen &&
		thoughtListCluster != null &&
		thoughtListCluster.allThoughts.length > 0;

	const thoughtPanelOpen = thoughtDialogOpen || thoughtListPanelOpen;

		if (thoughtListPanelOpen && thoughtListCluster) {
			// syncThoughtQuoteAnchorCfi / sidePanel 同上条件
		}

	const sidePanelOpen =
		assistantOpen ||
		thoughtDialogOpen ||
		thoughtListPanelOpen;
```

**变更摘要**：`thoughtListOpen && cluster` 改为还要求 `allThoughts.length > 0`，避免删光后仍占分栏 slot。

---

### 4.7 `EbookReadSplitLayout` `useLayoutEffect`（`apps/frontend/src/views/ebook/components/EbookReadSplitLayout.tsx`）

**对比范围**：`useLayoutEffect` 闭包（约 L53–L73）。

**改动前** · 条件卸载但未 reset layout，约 L53–L65

```typescript
	useLayoutEffect(() => {
		const done = () => notifyEbookSplitPanelResizeEnd();
		if (!sidePanelOpen) {
			const raf = requestAnimationFrame(done);
			return () => cancelAnimationFrame(raf);
		}
		const raf = requestAnimationFrame(() => {
			if (!sidePanelOpenRef.current) return;
			panelGroupRef.current?.setLayout(lastSplitLayoutRef.current);
			done();
		});
		return () => cancelAnimationFrame(raf);
	}, [sidePanelOpen]);
```

**改动后** · 关闭时显式 `reader: 100`，约 L53–L73

```typescript
	useLayoutEffect(() => {
		const done = () => notifyEbookSplitPanelResizeEnd();
		if (!sidePanelOpen) {
			const raf = requestAnimationFrame(() => {
				try {
					panelGroupRef.current?.setLayout({ reader: 100 });
				} catch {
					// ponytail: 分组 panel 数变化时 setLayout 可能短暂失败，下一帧 layout effect 会再试
				}
				done();
			});
			return () => cancelAnimationFrame(raf);
		}
		const raf = requestAnimationFrame(() => {
			if (!sidePanelOpenRef.current) return;
			panelGroupRef.current?.setLayout(lastSplitLayoutRef.current);
			done();
		});
		return () => cancelAnimationFrame(raf);
	}, [sidePanelOpen]);
```

**变更摘要**：右栏卸载后 flex 仍可能保留 58/42，关闭分支内 `setLayout({ reader: 100 })` 强制全宽。

**组件结构（条件卸载）**：`sidePanelOpen` 为 false 时不挂载 handle + assistant panel（见 §3.2），与上段 layout reset 配合。

---

## 5. 兼容性与影响

- 打开想法详情/列表仍会关 MK（`setAssistantOpen(false)`），互斥展示不变。
- 键盘翻页判断 `assistantOpen || thoughtPanelOpen`。
- PDF 分栏仅用 `assistantOpen`，不受 EPUB 想法 slot 影响。
- EPUB resize 仍经 `notifyEbookSplitPanelResizeEnd` → `EpubPane.settleHostResize`。

---

## 6. 回归建议

1. 仅 MK：开 → 关 → 全宽。
2. 想法列表 → MK → 关 MK → 回列表，无闪烁。
3. PopBar / 想法条 MK 问书与顶栏一致。
4. MK 开着点用户划线，助手不收起。
5. 想法列表右上角关闭 → 全宽。
6. 列表 1 条 → 详情删最后一条 → 全宽，无 `Invalid 1 panel layout`。
7. 热更新后侧栏关态 → 全宽。
8. 拖拽分栏后关再开 → 比例记忆。
9. 引用段落仍可见（叠加 [EPUB想法引用视口.md](./EPUB想法引用视口.md)）。

---

## 7. 相关源码路径

| 说明 | 路径 |
|------|------|
| 状态编排 | `apps/frontend/src/views/ebook/read.tsx` |
| 分栏布局 | `apps/frontend/src/views/ebook/components/EbookReadSplitLayout.tsx` |
| resize 通知 | `apps/frontend/src/views/ebook/utils/ebookSplitResize.ts` |

---

（若与仓库最新源码不一致，以源码为准）
