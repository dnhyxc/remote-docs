# EPUB 想法列表：删最后一条收起侧栏与详情正文对齐

## 文档角色

**增量专题**：从想法列表进入详情删除**最后一条**时，按列表「共 N 条」判断并**收起右侧分栏**（避免空白侧栏）；关闭列表时清空 cluster；详情正文样式与列表项对齐，消除进入详情时的下垂感。

**姊妹文档**：[EPUB想法列表UI.md](./EPUB想法列表UI.md)、[EPUB想法侧面板.md](./EPUB想法侧面板.md)、[EPUB阅读分屏.md](./EPUB阅读分屏.md)（分栏 state 与布局，**以该文为准**）。

---

## 1. 背景与目标

### 1.1 问题

1. 列表仅 1 条想法时，点进详情删除后侧栏仍占位但无内容（空白分栏）。
2. 从列表进入详情后，想法正文相对列表项**略向下偏移**（详情用了更大 `line-height`）。

### 1.2 目标

- 以 `reconcileThoughtClickCluster` 后的 `allThoughts.length`（即列表「共 N 条」）为准：N=0 时关闭列表并清空 cluster。
- 删除时若来自列表（`returnToListClusterRef` 有快照），立即 reconcile，不依赖 effect 时序。
- 详情查看模式正文 class 与 `EpubThoughtList` 列表项一致。

---

## 2. 改动范围

- `apps/frontend/src/views/ebook/read.tsx`
- `apps/frontend/src/views/ebook/components/EpubThought.tsx`

---

## 3. 实现思路

1. **`restoreThoughtListFromSnapshot`**：统一「关闭详情后回列表」与「删除后判断」逻辑；`reconciled.allThoughts.length > 0` 则打开列表，否则 `setThoughtListOpen(false)` + `setThoughtListCluster(null)`。
2. **`deleteThought`**：删除 API 成功后，若有 `returnToListClusterRef` 快照，用删除后的 `nextThoughts` 调用上述函数并清空 ref。
3. **`closeThoughtList`**：手动关闭时同步 `setThoughtListCluster(null)`，避免 `thoughtListOpen` 与 null cluster 错位。
4. **`EpubThought` 查看模式**：正文 `<p>` 使用与列表相同的 `text-sm wrap-break-word`，去掉 `leading-[1.8]` 与 `whitespace-pre-wrap`。

---

## 4. 关键代码对比与注释

### 4.1 `restoreThoughtListFromSnapshot`（`apps/frontend/src/views/ebook/read.tsx`）

**对比范围**：新增 `useCallback` 全文；并替换原 `useEffect` 内联 reconcile。

**改动前** · 约 L650–L661（`useEffect` 内）

```typescript
	useEffect(() => {
		if (thoughtDialogOpen) return;
		const snapshot = returnToListClusterRef.current;
		if (!snapshot) return;
		returnToListClusterRef.current = null;
		const rend = epubNavRef.current?.getRendition() ?? undefined;
		const reconciled = reconcileThoughtClickCluster(snapshot, thoughts, rend);
		if (reconciled && reconciled.allThoughts.length > 0) {
			setThoughtListCluster(reconciled);
			setThoughtListOpen(true);
		}
	}, [thoughtDialogOpen, thoughts, epubNavReady]);
```

**改动后** · `restoreThoughtListFromSnapshot` 约 L650–L668

```typescript
	/** 从列表快照恢复侧栏；按列表「共 N 条」判断，无数据则收起 */
	const restoreThoughtListFromSnapshot = useCallback(
		(snapshot: EbookThoughtClickCluster, nextThoughts: EbookThought[]) => {
			const rend = epubNavRef.current?.getRendition() ?? undefined;
			const reconciled = reconcileThoughtClickCluster(
				snapshot,
				nextThoughts,
				rend,
			);
			if (reconciled && reconciled.allThoughts.length > 0) {
				setThoughtListCluster(reconciled);
				setThoughtListOpen(true);
			} else {
				setThoughtListCluster(null);
				setThoughtListOpen(false);
			}
		},
		[],
	);
```

**改动后** · `useEffect` 约 L670–L681

```typescript
	useEffect(() => {
		if (thoughtDialogOpen) return;
		const snapshot = returnToListClusterRef.current;
		if (!snapshot) return;
		returnToListClusterRef.current = null;
		restoreThoughtListFromSnapshot(snapshot, thoughts);
	}, [
		thoughtDialogOpen,
		thoughts,
		epubNavReady,
		restoreThoughtListFromSnapshot,
	]);
```

**变更摘要**：抽出共享恢复逻辑；簇内无想法时主动收起侧栏并清空 cluster。

---

### 4.2 `deleteThought`（同文件）

**改动前** · 约 L805–L821

```typescript
	const deleteThought = useCallback(async () => {
		if (!thoughtDraft.id || thoughtSaving) return;
		setThoughtSaving(true);
		try {
			await deleteEbookThought(thoughtDraft.id);
			setThoughts((prev) => prev.filter((t) => t.id !== thoughtDraft.id));
			setThoughtDialogOpen(false);
		} catch (e) {
			// ...
		} finally {
			setThoughtSaving(false);
		}
	}, [t, thoughtDraft.id, thoughtSaving]);
```

**改动后** · 约 L827–L855

```typescript
	const deleteThought = useCallback(async () => {
		if (!thoughtDraft.id || thoughtSaving) return;
		setThoughtSaving(true);
		try {
			await deleteEbookThought(thoughtDraft.id);
			const nextThoughts = thoughts.filter((t) => t.id !== thoughtDraft.id);
			const listSnapshot = returnToListClusterRef.current;
			if (listSnapshot) {
				returnToListClusterRef.current = null;
				restoreThoughtListFromSnapshot(listSnapshot, nextThoughts);
			}
			setThoughts(nextThoughts);
			setThoughtDialogOpen(false);
		} catch (e) {
			// ...
		} finally {
			setThoughtSaving(false);
		}
	}, [
		t,
		thoughtDraft.id,
		thoughtSaving,
		thoughts,
		restoreThoughtListFromSnapshot,
	]);
```

**变更摘要**：删除后立即按列表快照 reconcile；最后一条时侧栏关闭而非留空。

---

### 4.3 `closeThoughtList`（同文件）

**改动前**

```typescript
	const closeThoughtList = useCallback(() => {
		setThoughtListOpen(false);
	}, []);
```

**改动后**

```typescript
	const closeThoughtList = useCallback(() => {
		setThoughtListOpen(false);
		setThoughtListCluster(null);
	}, []);
```

**变更摘要**：关闭列表时清空 cluster，避免状态残留。

---

### 4.4 详情正文样式（`apps/frontend/src/views/ebook/components/EpubThought.tsx`）

**改动前** · 约 L156–L158

```typescript
					<p className="text-textcolor whitespace-pre-wrap text-sm leading-[1.8]">
						{content.trim() || t('ebook.read.thought.empty')}
					</p>
```

**改动后**

```typescript
					<p className="text-textcolor text-sm wrap-break-word">
						{content.trim() || t('ebook.read.thought.empty')}
					</p>
```

**变更摘要**：与 `EpubThoughtList` 列表项正文 class 一致，消除行高差导致的视觉下移。

---

## 5. 兼容性与影响

| 项 | 说明 |
| ---- | ---- |
| 删非最后一条 | 仍回到更新后的列表，条数减少 |
| 非列表入口进详情 | 无 `returnToListClusterRef`，删除后仅关详情 |
| 关闭详情回列表 | 仍走 `useEffect` + `restoreThoughtListFromSnapshot` |

### 5.1 回归建议

- 列表 1 条 → 详情 → 删除：侧栏完全收起，正文区恢复全宽。
- 列表多条 → 删一条：回到列表且条数正确。
- 列表 → 详情：正文与列表项垂直位置一致。

---

## 6. 相关源码路径

| 说明 | 路径 |
| ---- | ---- |
| 阅读页状态 | `apps/frontend/src/views/ebook/read.tsx` |
| 详情组件 | `apps/frontend/src/views/ebook/components/EpubThought.tsx` |
| 列表组件 | `apps/frontend/src/views/ebook/components/EpubThoughtList.tsx` |
| 簇 reconcile | `apps/frontend/src/views/ebook/utils/epubThoughtCluster.ts` |

---

若与仓库最新源码不一致，以源码为准。
