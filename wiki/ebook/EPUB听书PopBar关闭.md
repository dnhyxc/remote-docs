# EPUB PopBar「听当前」：无播放态 + 听后收起清选

**文档角色**：对齐微信读书——PopBar「听当前」每次点击重新起播，不切换暂停/继续；起播后隐藏 PopBar 并去掉选中高亮。

**延伸阅读**：[EPUB听书引用继续.md](./EPUB听书引用继续.md)、[EPUB选区滚动清除.md](./EPUB选区滚动清除.md)

---

## 1. 背景与目标

| 旧行为 | 期望 |
|--------|------|
| 同 key 再次点击 → 暂停/继续；文案变「暂停」「继续」 | 文案固定「听当前」；每次点击从选区重新起播 |
| 点听当前后 PopBar 仍开着、选区高亮仍在 | 先清选区与 PopBar，再用冻结 Range 起播 |

---

## 2. 改动范围

| 路径 | 说明 |
|------|------|
| `apps/frontend/src/views/ebook/hooks/useEbookQuoteListen.ts` | 去掉 playingKey / pause 切换；`listenLabel` 恒返回默认文案 |
| `apps/frontend/src/views/ebook/read.tsx` | `onSelectionPopBarListen`：先 `clearEpubSelection` 再 `toggleListen` |

---

## 3. 实现思路

1. **无播放态**：暂停/继续只在底栏；PopBar 只负责「从这里听」。
2. **先抓后清**：`getRememberedEpubPopBarSelectionRange()` → `clearEpubSelection()` → `toggleListen(..., frozen)`，避免清选后丢锚点。

---

## 4. 关键实现

### 4.1 `onSelectionPopBarListen`（`read.tsx`）

**改动前** · `apps/frontend/src/views/ebook/read.tsx`（基线）

```typescript
	// PopBar 点听当前
	const onSelectionPopBarListen = useCallback(() => {
		// 读当前 PopBar payload
		const payload = selectionPopBarRef.current;
		// 无有效选文则忽略
		if (!payload?.selectedText.trim()) return;
		// 抑制 PopBar 因选区变化被关掉（保持条可见）
		suppressEpubSelectionPopBarDismiss();
		// 起听，带上记忆选区 Range
		void toggleListen(
			payload.selectedText,
			'popbar',
			payload.cfiRange,
			getRememberedEpubPopBarSelectionRange(),
		);
	}, [toggleListen]);
```

**改动后** · `apps/frontend/src/views/ebook/read.tsx`（当前，约 L1673–L1681）

```typescript
	// PopBar 点听当前
	const onSelectionPopBarListen = useCallback(() => {
		// 读当前 PopBar payload
		const payload = selectionPopBarRef.current;
		// 无有效选文则忽略
		if (!payload?.selectedText.trim()) return;
		// 先克隆记忆选区，供起播锚定
		const frozen = getRememberedEpubPopBarSelectionRange();
		// 隐藏 PopBar + 去掉原生选中高亮
		clearEpubSelection();
		// 用冻结 Range 起听（文案仍为听当前）
		void toggleListen(payload.selectedText, 'popbar', payload.cfiRange, frozen);
	}, [toggleListen, clearEpubSelection]);
```

**变更摘要**：听完入口即收起工具条并清选区样式。

### 4.2 `listenLabel` / `toggleListen`（`useEbookQuoteListen.ts`）

**改动前**：同 `playingKey` 且会话 active 时，按 `paused`/`playing` 调用 `resume`/`pause`，文案切「继续」「暂停」。

**改动后** · 约 L159–L170

```typescript
	// 固定返回默认文案，不反映播放态
	const listenLabel = useCallback(
		// 入口 key 忽略
		(_key: string, defaultLabel: string) => defaultLabel,
		// 无依赖
		[],
	);

	// ... return 中：
		// 对外仍叫 toggleListen，实为每次起播
		toggleListen: startFromSelection,
		// 无 playingKey
		playingKey: null as string | null,
		// 固定文案函数
		listenLabel,
```

**变更摘要**：PopBar/想法入口不再承担暂停逻辑。

---

## 5. 行为变化与兼容性

- 连续点「听当前」会**重启**听书会话（从新选区起）。
- 复制/划线仍可用 `suppressEpubSelectionPopBarDismiss` 保条。

## 6. 测试与回归建议

1. 选区 → 听当前：PopBar 消失、选区高亮消失、底栏出现并开播。
2. 再次划选 → 听当前：从新选区起播。
3. 想法入口听当前：文案仍为「听当前」。

---

（若与仓库最新源码不一致，以源码为准）
