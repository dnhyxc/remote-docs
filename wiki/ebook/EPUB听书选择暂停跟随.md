# EPUB 听书：划选正文暂停自动跟随

**文档角色**：听书播放中用户划选正文时，停止自动滚句（与手动滚动同一套 `pauseListenAutoFollow`），避免跟读抢滚。

**延伸阅读**：[EPUB听书自动跟随浮动按钮.md](./EPUB听书自动跟随浮动按钮.md)、[EPUB听书跟随CFI重挂载.md](./EPUB听书跟随CFI重挂载.md)

---

## 1. 背景与目标

听书时若用户开始**划选文字**，自动跟随仍把播放句滚回视口，会与选区/PopBar 对抗。期望与**手动滚动**一致：停 `autoFollow`；右下角「回到播放位置」在 `autoFollow === false` 时出现（与既有 FAB 订阅一致）。

---

## 2. 改动范围

| 路径 | 说明 |
|------|------|
| `apps/frontend/src/views/ebook/utils/epub/listen/epubListenSegmentOverlay.ts` | `attachListenScrollGuard` 增加 `selectionchange` → `onUserSelectIntent` |

---

## 3. 实现思路

1. 在各章 iframe `document` 上监听 `selectionchange`。
2. 非空选区且非程序滚动 → `pauseListenAutoFollow()`。
3. **空选区**（含听当前后 `clearEpubTextSelection`）不打断，避免刚恢复跟随后被误关。

---

## 4. 关键实现

### 4.1 `attachListenScrollGuard`（摘录）

**改动前** · 仅绑定 scroll/wheel，`bindContents` 只绑滚动元素。

**改动后** · `apps/frontend/src/views/ebook/utils/epub/listen/epubListenSegmentOverlay.ts`（当前，约 L498–L540）

```typescript
function attachListenScrollGuard(rend: Rendition): () => void {
	// 解绑回调列表
	const cleanups: (() => void)[] = [];
	// 用户滚动意图：停跟随
	const onUserScrollIntent = () => {
		if (programmaticScroll > 0) return;
		userScrolling = true;
		pauseListenAutoFollow();
		scheduleScrollSettle();
	};
	// 划选正文：停 autoFollow（清空选区不打断）
	const onUserSelectIntent = (doc: Document) => {
		if (programmaticScroll > 0) return;
		if (!session) return;
		const text = doc.getSelection()?.toString().trim() ?? '';
		if (!text) return;
		pauseListenAutoFollow();
	};
	// 绑定 scroll
	const bind = (target: EventTarget | null | undefined) => {
		if (!target) return;
		target.addEventListener('scroll', onUserScrollIntent, { passive: true });
		cleanups.push(() =>
			target.removeEventListener('scroll', onUserScrollIntent),
		);
	};
	// ... container + wheel 同改动前 ...
	const bindContents = (contents: { document: Document }) => {
		const doc = contents.document;
		bind(doc.scrollingElement ?? doc.documentElement);
		const onSel = () => onUserSelectIntent(doc);
		doc.addEventListener('selectionchange', onSel);
		cleanups.push(() => doc.removeEventListener('selectionchange', onSel));
	};
	rend.hooks.content.register(bindContents);
	for (const item of getContents(rend)) bindContents(item);
	return () => {
		for (const fn of cleanups) fn();
	};
}
```

**变更摘要**：划选与滚动共用暂停跟随入口。

---

## 5. 行为变化与兼容性

- 听书中划选 → 自动滚句停止；点 FAB 可恢复跟随。
- 程序滚动（跟读滚入视口）不计为用户划选打断。

## 6. 测试与回归建议

1. 听书中划一段字：播放句不再被自动拽回。
2. 点「回到播放位置」：滚回并恢复跟随。
3. 听当前清选区：不应因空 `selectionchange` 误停新会话跟随。

---

（若与仓库最新源码不一致，以源码为准）
