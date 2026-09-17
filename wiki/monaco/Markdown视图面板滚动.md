# Markdown 预览/编辑与助手 Panel 布局及滚动对齐

> **文档角色**：本轮 Monaco 知识库编辑器在「预览 / 编辑 / 分屏 / Diff / 文档助手」组合下的布局与滚动行为实现说明。  
> **延伸阅读**：[Markdown预览编辑滚动恢复.md](./Markdown预览编辑滚动恢复.md)（preview↔edit 双向滚动恢复现行实现）、[Markdown分屏滚动同步.md](./Markdown分屏滚动同步.md)（分屏左右跟随滚动算法）、[Markdown底部栏.md](./Markdown底部栏.md)（底部栏入口）、[../impact/Monaco Markdown视图面板影响.md](../impact/Monaco Markdown视图面板影响.md)（对既有功能的影响面与回归清单）。

> **说明**：§3/§4 中「切换时滚动对齐」的早期叙述已被 [Markdown预览编辑滚动恢复.md](./Markdown预览编辑滚动恢复.md) 覆盖并修正（edit 清空预览正文、助手同开卸载 Monaco 等根因）；阅读滚动恢复请以该专文为准，本文仍保留布局与右栏可见性说明。

## 1. 背景与目标

**用户视角**：在知识库 Markdown 编辑器中，希望：

1. 开启右侧 Panel（文档助手）时，**预览模式**左侧仍是预览、**编辑模式**左侧仍是编辑器，而不是一律变成编辑器或强制分屏。
2. 预览 ↔ 编辑切换时**不要关闭**已打开的助手 Panel。
3. 预览 ↔ 编辑切换时**尽量保持阅读进度**（滚动位置对齐）。
4. **纯预览**（未开助手、非 split/Diff）应占满全宽，右侧不出现空的「预览内容为空」占位。

**技术约束**：复用既有 `syncEditorScrollFromMarkdownPreview` / `syncPreviewScrollFromMarkdownEditor`（见 `utils.ts`），不新增 capture/apply 包装；左栏预览与编辑器**同层叠放**（`invisible` + `pointer-events-none`），避免 `display:none` 导致无法测量 scrollHeight。

## 2. 改动范围

| 路径 | 变更概要 |
| --- | --- |
| `apps/frontend/src/components/design/Monaco/index.tsx` | 右栏可见性、助手开关逻辑、左栏双挂载、viewMode 切换滚动 sync、右侧 preview 条件渲染、mount 时 focus  guard |
| `apps/frontend/src/components/design/Monaco/MarkdownBottomBar.tsx` | 预览/编辑切换不再调用 `closeMarkdownAssistant` |
| `apps/frontend/src/hooks/useMarkdownBottomBarShortcuts.ts` | 快捷键切换预览/编辑同上 |

## 3. 实现思路

1. **`markdownRightPaneVisible`（布尔）**：`assistantRightPaneActive || viewMode === 'split' | 'splitDiff'` 时右栏展开；纯 `preview` / 纯 `edit` 且无助手时 `panelGroup.setLayout({ editor: 100, right: 0 })`，修复纯预览时右侧仍挂预览 pane 的问题。
2. **取消「开助手强制 split」**：删除 `useEffect` 中 `markdownAssistantOpen` 时 `setViewMode('split')`；助手开启后保持当前 `preview` 或 `edit`。
3. **左栏 co-mount**：Markdown 统一走 `ResizablePanelGroup`；`preview`/`edit` 时左栏预览与 Monaco **绝对定位叠放**（`invisible pointer-events-none`）。`split`/`splitDiff` 左栏仅 Monaco。`leftPreviewMarkdown = value ?? ''` 替代 `useDeferredValue`。
4. **滚动对齐**：新增 `useLayoutEffect` + 内联 `runSync`，复用 `syncEditorScrollFromMarkdownPreview` / `syncPreviewScrollFromMarkdownEditor`（传入 `editorRef`、`previewViewportRef`、`markdownScrollSyncSnapshotRef`）；`preview → edit` 在 `queueMicrotask` + `rAF` 后再跑；`split → preview` 在 `setViewMode` 包装器里先缓存 `previewViewportRef.scrollTop` 到 `pendingSplitPreviewScrollTopRef`。
5. **关助手**：`toggleMarkdownAssistant` 关闭时 `setViewMode(vm => vm === 'preview' ? 'preview' : 'edit')`。
6. **右侧内容**：`ParserMarkdownPreviewPane` 仅在 `viewMode === 'split'` 且非助手时渲染；`preview` 模式不再在右侧 fallback 预览。
7. **底部栏 / 快捷键**：编辑、预览按钮及对应快捷键移除 `closeMarkdownAssistant()`；进入 split/Diff 仍会关助手（未改）。
8. **`handleEditorMount`**：`viewModeRef.current !== 'preview'` 时才 `editor.focus()`，避免 co-mount 下隐藏编辑器抢焦点。

## 4. 关键代码对比与注释

### 4.1 `markdownRightPaneVisible`（`apps/frontend/src/components/design/Monaco/index.tsx`）

**对比范围**：右栏是否参与分栏的布尔派生量（新增）及 `ResizableHandle` 可见性条件（摘录）。

**改动前** · `apps/frontend/src/components/design/Monaco/index.tsx`（基线，ResizableHandle 约 L1688–L1695）

```typescript
// 旧版无 markdownRightPaneVisible；纯 preview 时 viewMode !== 'edit' 仍为 true
// 右栏 Handle 展开且 fallback 渲染 ParserMarkdownPreviewPane → 双预览占位
<ResizableHandle
	className={cn(
		'w-0',
		viewMode === 'edit'
			? 'pointer-events-none opacity-0'
			: 'pointer-events-auto opacity-100',
	)}
/>
```

**改动后** · `apps/frontend/src/components/design/Monaco/index.tsx`（当前，约 L407–L411、L1804–L1811）

```typescript
// 助手打开或 split / splitDiff 时为 true；纯 preview/edit 且无助手为 false
const markdownRightPaneVisible =
	assistantRightPaneActive ||
	viewMode === 'split' ||
	viewMode === 'splitDiff';
// Handle 与右 Panel 统一绑定该布尔量
<ResizableHandle
	className={cn(
		'w-0',
		markdownRightPaneVisible
			? 'pointer-events-auto opacity-100'
			: 'pointer-events-none opacity-0',
	)}
/>
```

**变更摘要**：新增布尔量；纯 preview 折叠右栏，配合 §4.5 仅 split 渲染右侧预览。

---

### 4.2 删除「开助手强制 split」与 `toggleMarkdownAssistant`（`index.tsx`）

**对比范围**：助手相关 `useEffect`（删除）与 `toggleMarkdownAssistant` 关闭分支。

**改动前** · `apps/frontend/src/components/design/Monaco/index.tsx`（基线，约 L701–L712、L456–L462）

```typescript
// 开启助手后强制 split
useEffect(() => {
	if (!markdownAssistantOpen || !bottomBarAssistantNode) return;
	setViewMode((vm) =>
		vm === 'split'
			? vm
			: vm === 'splitDiff' || vm === 'edit' || vm === 'preview'
				? 'split'
				: vm,
	);
}, [markdownAssistantOpen, bottomBarAssistantNode]);

// 关闭助手时一律 edit
if (!next) {
	setViewMode('edit');
}
```

**改动后** · `apps/frontend/src/components/design/Monaco/index.tsx`（当前，约 L476–L487）

```typescript
// 上述 useEffect 已删除

const toggleMarkdownAssistant = useCallback(() => {
	if (!bottomBarAssistantNode) return;
	const next = !markdownAssistantOpen;
	if (!next) {
		setViewMode((vm) => (vm === 'preview' ? 'preview' : 'edit'));
	}
	// ...更新 markdownAssistantOpen（受控/非受控，未改动）
}, [bottomBarAssistantNode, markdownAssistantOpen, /* ... */]);
```

**变更摘要**：开助手不再强制 split；关助手保留 preview 态。

---

### 4.3 `setViewMode` 包装器与滚动 `useLayoutEffect`（`index.tsx`）

**对比范围**：`setViewMode` 完整 `useCallback`；preview↔edit 滚动 `useLayoutEffect`（改动前无后者）。

**改动前** · `apps/frontend/src/components/design/Monaco/index.tsx`（基线，约 L300）

```typescript
// 直接使用 useState setter，无 split→preview scroll 缓存与切换 sync
const [viewMode, setViewMode] = useState<MarkdownViewMode>('edit');
```

**改动后** · `apps/frontend/src/components/design/Monaco/index.tsx`（当前，约 L445–L457、L846–L907）

```typescript
const setViewMode = useCallback(
	(next: MarkdownViewMode | ((prev: MarkdownViewMode) => MarkdownViewMode)) => {
		setViewModeState((prev) => {
			const resolved = typeof next === 'function' ? next(prev) : next;
			if (prev === 'split' && resolved === 'preview') {
				pendingSplitPreviewScrollTopRef.current =
					previewViewportRef.current?.scrollTop ?? null;
			}
			return resolved;
		});
	},
	[],
);

useLayoutEffect(() => {
	const prev = prevViewModeRef.current;
	if (prev === viewMode) return;
	const runSync = () => {
		const ed = editorRef.current;
		const vp = previewViewportRef.current;
		if (!ed?.getModel() || !vp) return;
		applyEditorLayoutRef.current?.();
		markdownScrollSyncSnapshotRef.current = null;
		if (prev === 'preview' && viewMode === 'edit') {
			suppressEditorScrollEchoRef.current = true;
			try {
				syncEditorScrollFromMarkdownPreview(ed, vp, markdownScrollSyncSnapshotRef);
			} finally {
				scheduleClearSuppressEditorEcho();
			}
			return;
		}
		if (prev === 'edit' && viewMode === 'preview') {
			suppressPreviewScrollEchoRef.current = true;
			try {
				syncPreviewScrollFromMarkdownEditor(ed, vp, markdownScrollSyncSnapshotRef);
			} finally {
				scheduleClearSuppressPreviewEcho();
			}
			return;
		}
		if (prev === 'split' && viewMode === 'preview') {
			const top = pendingSplitPreviewScrollTopRef.current;
			pendingSplitPreviewScrollTopRef.current = null;
			if (top == null) return;
			const max = Math.max(0, vp.scrollHeight - vp.clientHeight);
			vp.scrollTop = Math.min(max, Math.max(0, top));
		}
	};
	if (prev === 'preview' && viewMode === 'edit') {
		queueMicrotask(() => {
			runSync();
			requestAnimationFrame(runSync);
		});
		return;
	}
	runSync();
	requestAnimationFrame(runSync);
}, [viewMode, leftPreviewMarkdown, scheduleClearSuppressEditorEcho, scheduleClearSuppressPreviewEcho]);
```

**变更摘要**：`setViewMode` 在 split→preview 时缓存 scrollTop；layout effect 复用分屏 sync API，`preview→edit` 延迟到 microtask+rAF。

---

### 4.4 左栏预览 co-mount 与 `leftPreviewMarkdown`（`index.tsx`）

**对比范围**：左栏 JSX 摘录（`viewMode` 为 preview/edit 时的叠层结构；对称省略 split 分支）。

**改动前** · `apps/frontend/src/components/design/Monaco/index.tsx`（基线，约 L1618–L1665）

```typescript
// preview 独立分支，与 ResizablePanelGroup 互斥
{isMarkdown && viewMode === 'preview' ? (
	<ParserMarkdownPreviewPane markdown={deferredPreviewMarkdown} ... />
) : null}
{isMarkdown && viewMode !== 'preview' ? (
	<ResizablePanelGroup>/* 左栏仅 Editor */</ResizablePanelGroup>
) : null}
const deferredPreviewMarkdown = useDeferredValue(value);
```

**改动后** · `apps/frontend/src/components/design/Monaco/index.tsx`（当前，约 L1700–L1801）

```typescript
const leftPreviewMarkdown = value ?? '';
{isMarkdown ? (
	<ResizablePanelGroup>
		<ResizablePanel id="editor">
			{viewMode === 'split' || viewMode === 'splitDiff' ? (
				<Editor ... />
			) : (
				<div className="relative h-full ...">
					<div className={cn('absolute inset-0 ...', viewMode !== 'preview' && 'invisible pointer-events-none')}>
						<ParserMarkdownPreviewPane markdown={leftPreviewMarkdown} viewportRef={previewViewportRef} ... />
					</div>
					<div className={cn('absolute inset-0 ...', viewMode === 'preview' && 'invisible pointer-events-none')}>
						<Editor onMount={handleEditorMount} ... />
					</div>
				</div>
			)}
		</ResizablePanel>
	</ResizablePanelGroup>
) : null}
```

**变更摘要**：preview/edit 双挂载 + `leftPreviewMarkdown`；为 scroll sync 提供稳定 DOM。

---

### 4.5 右侧预览条件渲染（`index.tsx`）

**对比范围**：右栏 `ParserMarkdownPreviewPane` 渲染条件（摘录）。

**改动前** · `apps/frontend/src/components/design/Monaco/index.tsx`（基线，右栏 ternary 末支）

```typescript
) : (
	<ParserMarkdownPreviewPane markdown={splitPaneMarkdown} viewportRef={previewViewportRef} ... />
)}
```

**改动后** · `apps/frontend/src/components/design/Monaco/index.tsx`（当前，约 L1855–L1868）

```typescript
) : viewMode === 'split' ? (
	<ParserMarkdownPreviewPane markdown={splitPaneMarkdown} viewportRef={previewViewportRef} ... />
) : null}
```

**变更摘要**：右侧 preview 限定 `viewMode === 'split'`，消除纯预览双栏空占位。

---

### 4.6 `handleEditorMount` 聚焦 guard（`index.tsx`）

**对比范围**：`handleEditorMount` 内 `editor.focus()` 条件（摘录）。

**改动前** · `apps/frontend/src/components/design/Monaco/index.tsx`（基线，约 L1433）

```typescript
editor.focus();
```

**改动后** · `apps/frontend/src/components/design/Monaco/index.tsx`（当前，约 L1509–L1511）

```typescript
if (viewModeRef.current !== 'preview') {
	editor.focus();
}
```

**变更摘要**：全屏 preview 下 co-mount 的 Monaco 不抢焦点。

---

### 4.7 底部栏编辑/预览按钮（`MarkdownBottomBar.tsx`）

**对比范围**：编辑、预览按钮 `onClick`（摘录）。

**改动前** · `apps/frontend/src/components/design/Monaco/MarkdownBottomBar.tsx`（基线，约 L383、L426）

```typescript
onClick={() => {
	closeMarkdownAssistant();
	setViewMode('edit');
	queueMicrotask(focusEditor);
}}
onClick={() => {
	closeMarkdownAssistant();
	// ...preview/edit 切换
}}
```

**改动后** · `apps/frontend/src/components/design/Monaco/MarkdownBottomBar.tsx`（当前，同位置）

```typescript
onClick={() => {
	setViewMode('edit');
	queueMicrotask(focusEditor);
}}
onClick={() => {
	// 无 closeMarkdownAssistant()
	// ...preview/edit 切换
}}
```

**变更摘要**：两处移除 `closeMarkdownAssistant()`。

---

### 4.8 快捷键 `markdownBarAction1` / `markdownBarAction3`（`useMarkdownBottomBarShortcuts.ts`）

**对比范围**：编辑/预览快捷键分支（摘录）。

**改动前** · `apps/frontend/src/hooks/useMarkdownBottomBarShortcuts.ts`（基线，约 L213–L235）

```typescript
if (hit(chords.markdownBarAction1)) {
	closeMarkdownAssistant();
	setViewMode('edit');
	queueMicrotask(focusEditor);
	return;
}
if (hit(chords.markdownBarAction3)) {
	closeMarkdownAssistant();
	// ...
}
```

**改动后** · `apps/frontend/src/hooks/useMarkdownBottomBarShortcuts.ts`（当前，同位置）

```typescript
if (hit(chords.markdownBarAction1)) {
	setViewMode('edit');
	queueMicrotask(focusEditor);
	return;
}
if (hit(chords.markdownBarAction3)) {
	// 无 closeMarkdownAssistant()
	// ...
}
```

**变更摘要**：与底部栏一致，切换预览/编辑不关助手。

## 5. 兼容性与影响

| 场景 | 行为 |
| --- | --- |
| 纯 preview / 纯 edit | 与改前一致，纯 preview 修复为全宽 |
| split / splitDiff | 左编右预览/Diff 不变；滚动仍见 [Markdown分屏滚动同步.md](./Markdown分屏滚动同步.md) |
| 助手 + preview/edit | **新**：左栏随模式切换预览/编辑器，右栏助手常驻 |
| 开助手 | **变**：不再自动进入 split |
| 关助手 | preview 态保留；其它回 edit |

**风险**：co-mount 在 preview/edit 下同时保留预览与 Monaco DOM；长文需回归滚动与 IME。`prevViewModeRef` 在 Diff 清理用的 `useEffect`（约 L669）中更新，晚于 scroll 的 `useLayoutEffect`，故 layout 内读到的 `prev` 仍为切换前 mode。

## 6. 建议回归

1. 纯预览：全宽，无右侧空 preview。
2. 预览 + 助手：左预览右助手；切编辑左变 Monaco，助手不关。
3. 编辑 + 助手：左编右助手；切预览左变预览。
4. 预览 ↔ 编辑（无助手）：章节中间滚动大致一致。
5. split → preview：滚动尽量保留。
6. Diff 开/关、关助手、底部栏 split 按钮：与改前一致。

## 7. 相关源码路径

| 说明 | 路径 |
| --- | --- |
| 主组件 | `apps/frontend/src/components/design/Monaco/index.tsx` |
| 底部栏 | `apps/frontend/src/components/design/Monaco/MarkdownBottomBar.tsx` |
| 快捷键 | `apps/frontend/src/hooks/useMarkdownBottomBarShortcuts.ts` |
| 滚动 sync 工具 | `apps/frontend/src/components/design/Monaco/utils.ts` |

---

（若与仓库最新源码不一致，以源码为准）
