# EPUB 选区：滚动时收起 PopBar 并清除选中样式

**文档角色**：页面滚动后若 PopBar 已隐藏，原生选区高亮常仍残留；滚动（及 relocated）时一并 `removeAllRanges`。

**延伸阅读**：[EPUB听书PopBar关闭.md](./EPUB听书PopBar关闭.md)、[EPUB右键菜单PopBar.md](./EPUB右键菜单PopBar.md)、[MK 问书流式误清 EPUB 选区（影响点）](../impact/EPUB提问流式选区清除影响.md)

---

## 1. 背景与目标

`onScroll` 旧实现只 `hidePopBar()` → `onChange(null)`，**不**清 Selection，导致「条没了、蓝/灰选中还在」。期望：非拖选中的滚动/relocated 同步清选区与记忆 Range。

---

## 2. 改动范围

| 路径 | 说明 |
|------|------|
| `apps/frontend/src/views/ebook/utils/epub/reader/epubSelectionToolbarAttach.ts` | `onScroll` / `onRelocated` |

---

## 3. 实现思路

1. 尊重 `shouldSuppressDismiss`（划线等短窗口不误清）。
2. `selecting === true`（拖选中）不清选区，避免划选伴随微滚打断。
3. `rememberEpubPopBarSelectionRange(null)` 同步忘掉锚点。

---

## 4. 关键实现

### 4.1 `onScroll`

**改动前**

```typescript
	const onScroll = () => {
		suppressEmitUntil = Date.now() + 350;
		hidePopBar();
	};
```

**改动后** · `apps/frontend/src/views/ebook/utils/epub/reader/epubSelectionToolbarAttach.ts`（当前，约 L296–L305）

```typescript
	// 滚动：关 PopBar；非拖选时清原生选区
	const onScroll = () => {
		// 短时抑制重新弹出 PopBar
		suppressEmitUntil = Date.now() + 350;
		// 划线等抑制窗口内不关不关清
		if (shouldSuppressDismiss()) return;
		// 取消待 emit
		clearPendingEmit();
		// 通知上层关 PopBar
		onChange(null);
		// 拖选过程中的伴随滚动保留选区
		if (selecting) return;
		// 去掉 iframe/顶层 Selection 高亮
		clearEpubTextSelection(rend);
		// 忘掉 PopBar 记忆 Range
		rememberEpubPopBarSelectionRange(null);
	};
```

### 4.2 `onRelocated`

**改动后** · 约 L468–L478

```typescript
	const onRelocated = () => {
		suppressEmitUntil = Date.now() + 350;
		if (!shouldSuppressDismiss()) {
			clearPendingEmit();
			onChange(null);
			if (!selecting) {
				clearEpubTextSelection(rend);
				rememberEpubPopBarSelectionRange(null);
			}
		}
		bindEpubScrollContainer();
	};
```

**变更摘要**：翻页/重定位与滚动一致，避免残留选中样式。

---

## 5. 测试与回归建议

1. 选区弹出 PopBar → 滚动：条消失且选中高亮消失。
2. 拖选过程中轻微滚动：选区仍在，松手仍可出条。
3. 划线操作抑制窗口内滚动：不误清。

---

（若与仓库最新源码不一致，以源码为准）
