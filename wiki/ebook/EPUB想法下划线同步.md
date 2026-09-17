# EPUB 读书想法：下划线同步稳定性

## 文档角色

**主文档（本轮）**：修复保存想法、切换章节或频繁更新 `thoughts` 时，阅读页偶发 **Unexpected Application Error**（堆栈指向 `epubThoughtAnnotations.ts`）的问题。根因是 **每次 thoughts 变化都重复注册 epub.js hooks**，以及异步 patch / 批注操作在 rendition 销毁后仍执行。

**延伸阅读**：[EPUB阅读想法.md](./EPUB阅读想法.md)（下划线绘制与重叠去重）、[EPUB想法侧面板.md](./EPUB想法侧面板.md)（右侧面板 UI）。

---

## 1. 背景与目标

原 `syncEpubThoughtUnderlines` 在 `thoughts` 每次变更时：

1. 重新 `register` `content` / `relocated` / `markClicked` 监听；
2. `attachThoughtMarkClickGuard` 内的 `bindContents` **从未 deregister**，hooks 累积；
3. `schedulePatchThoughtUnderlineMarks` 双 rAF 在组件卸载后仍可能访问已销毁文档；
4. `doc.head.appendChild` 在 iframe 未就绪时可能抛错，导致 React Router 白屏。

目标：**监听只装一次、批注随 thoughts 增量同步**；patch 与批注操作具备防御性 try/catch；卸载时可取消 pending rAF。

---

## 2. 改动范围

| 区域 | 路径 |
|------|------|
| 下划线工具 | `apps/frontend/src/views/ebook/utils/epubThoughtAnnotations.ts` |
| 集成 | `apps/frontend/src/views/ebook/components/EpubPane.tsx` |

---

## 3. 实现思路

1. **拆分 API**：
   - `applyEpubThoughtUnderlines(rend, thoughts, appliedRef)` — 仅增删改 underline 批注；
   - `installEpubThoughtUnderlineListeners(rend, options)` — `rendReady` 后装一次，通过 `getThoughts()` 读最新列表；
   - `teardownAppliedThoughtUnderlines(rend, appliedRef)` — cleanup 时移除批注。
2. **EpubPane 双 effect**：`[rendReady]` 装监听；`[thoughts, rendReady]` 同步批注并在 cleanup 调用 teardown。
3. **样式 patch**：`patchAllThoughtUnderlineMarks(rend)` 遍历主文档 + 各 iframe `document`；`schedulePatchThoughtUnderlineMarks` 返回 cancel 函数。
4. **head 守卫**：`ensureThoughtUnderlineStyles` 在 `doc.head` 缺失时回退 `documentElement` 或跳过。
5. **click guard 卸载**：`attachThoughtMarkClickGuard` 的 cleanup 增加 `rend.hooks.content.deregister(bindContents)`。
6. **兼容**：保留 `@deprecated syncEpubThoughtUnderlines` 组合上述两者，供旧调用方过渡。

---

## 4. 关键代码与注释

### 4.1 EpubPane 双 effect

**来源**：`apps/frontend/src/views/ebook/components/EpubPane.tsx`（约 L220–L243）

```tsx
// rendReady 后只注册一次交互与 patch 监听
useEffect(() => {
	const rend = rendRef.current;
	if (!rend || !rendReady) return;
	return installEpubThoughtUnderlineListeners(rend, {
		getThoughts: () => thoughtsRef.current ?? [], // ref 始终指向最新 thoughts
		onThoughtClick: (thought) => onThoughtClickRef.current?.(thought),
		onThoughtGroupClick: (group) => onThoughtGroupClickRef.current?.(group),
	});
}, [rendReady]);

// thoughts 变化时只同步批注，不重复 register hooks
useEffect(() => {
	const rend = rendRef.current;
	if (!rend || !rendReady) return;
	applyEpubThoughtUnderlines(rend, thoughts ?? [], appliedThoughtsRef.current);
	return () => {
		teardownAppliedThoughtUnderlines(rend, appliedThoughtsRef.current);
	};
}, [thoughts, rendReady]);
```

### 4.2 批注同步与容错

**来源**：`apps/frontend/src/views/ebook/utils/epubThoughtAnnotations.ts`（`applyEpubThoughtUnderlines`，约 L639–L692）

```typescript
export function applyEpubThoughtUnderlines(
	rend: Rendition,
	thoughts: EbookThought[],
	appliedRef: Map<string, string[]>,
): void {
	try {
		ensureThoughtUnderlineStyles();
	} catch {
		return; // 文档不可用时整轮跳过，避免白屏
	}

	const grouped = groupThoughtsByCfi(thoughts);
	// 移除已删除 CFI 的旧 underline
	for (const cfiRange of [...appliedRef.keys()]) {
		if (!grouped.has(cfiRange)) {
			try {
				rend.annotations.remove(cfiRange, 'underline');
			} catch { /* rendition 可能已销毁 */ }
			appliedRef.delete(cfiRange);
		}
	}

	for (const [cfiRange, group] of sortedEntries) {
		try {
			rend.annotations.remove(cfiRange, 'underline');
			rend.annotations.underline(cfiRange, { thoughtIds, /* showLine */ }, /* ... */);
			appliedRef.set(cfiRange, thoughtIds);
		} catch {
			appliedRef.delete(cfiRange); // 无效 CFI 不阻塞其它段
		}
	}
	schedulePatchThoughtUnderlineMarks(rend);
}
```

### 4.3 可取消的双 rAF patch

**来源**：`apps/frontend/src/views/ebook/utils/epubThoughtAnnotations.ts`（`schedulePatchThoughtUnderlineMarks`，约 L219–L236）

```typescript
function schedulePatchThoughtUnderlineMarks(rend?: Rendition): () => void {
	let cancelled = false;
	requestAnimationFrame(() => {
		if (cancelled) return;
		requestAnimationFrame(() => {
			if (cancelled) return;
			try {
				patchAllThoughtUnderlineMarks(rend); // 主文档 + iframe
			} catch {
				// rendition 销毁后 rAF 仍可能触发
			}
		});
	});
	return () => { cancelled = true; };
}
```

### 4.4 click guard 正确注销 content hook

**来源**：`apps/frontend/src/views/ebook/utils/epubThoughtAnnotations.ts`（`attachThoughtMarkClickGuard` cleanup，约 L377–L388）

```typescript
return () => {
	try {
		rend.hooks.content.deregister(bindContents); // 修复：此前未注销，hooks 累积
	} catch { /* rendition 已销毁 */ }
	for (const fn of contentCleanups.values()) fn();
	// ...
};
```

---

## 5. 兼容性与影响

- 对外下划线视觉与点击语义不变；`syncEpubThoughtUnderlines` 仍可用但标记 deprecated。
- `thoughts` 频繁更新时性能更好（不再重复绑监听）。

---

## 6. 风险与回归

- 保存第一条 / 多条想法后页面不应白屏。
- 快速切换章节、换书、HMR 热更新后下划线仍可见且可点击。
- 拖动选字松手仍不应误弹列表（click guard 仍生效）。

---

## 7. 相关源码路径

| 说明 | 路径 |
|------|------|
| 批注与监听 | `apps/frontend/src/views/ebook/utils/epubThoughtAnnotations.ts` |
| React 集成 | `apps/frontend/src/views/ebook/components/EpubPane.tsx` |

若与仓库最新源码不一致，以源码为准。
