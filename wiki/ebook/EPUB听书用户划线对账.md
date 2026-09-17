# EPUB 听当前与用户划线 DOM 协调

## 延伸阅读

- [EPUB「听当前」逐句播放背景](EPUB听书句背景.md) — 播放层三层绘制与 plain 偏移定位
- [EPUB 用户划线实现](EPUB用户划线实现.md) — 用户划线 apply/sync 主流程

## 1. 背景与目标

**用户视角**：先给段落 A 设用户划线 → 对 A「听当前」→ 再选 A+B 设划线 → A 出现重复 mark；取消 A+B 后无法取消原 A 划线，刷新页面才消失。

**根因**：播放层曾通过 `rend.annotations.remove(cfi, 'highlight')` 或与用户划线共用 highlight 槽位清理，误删用户 mark，但 `appliedRef` 仍认为该 CFI 已应用 → sync 跳过 re-apply → DOM 孤儿/重复与数据不一致。

**目标**：

1. 播放清除**只**走独立 class / CSS Highlight / detach 播放 Annotation 对象，**禁止**按 CFI 全局 remove highlight。
2. apply 前校验 DOM mark 是否真实存在；签名相同但 mark 缺失时强制重绘。
3. purge 后 reconcile 孤儿 mark、同 CFI 去重；remove 时 DOM 直删补救 epub.js 漏删。

## 2. 改动范围

| 路径 | 说明 |
| ---- | ---- |
| `apps/frontend/src/views/ebook/utils/epubUserHighlights.ts` | reconcile、DOM 存在性校验、remove 直删 mark |
| `apps/frontend/src/views/ebook/hooks/useEbookQuoteListen.ts` | 播完 `onListenSessionEnd` → `syncReadingAnnotations()` |
| `apps/frontend/src/views/ebook/read.tsx` | 传入 `syncReadingAnnotations` 回调 |

## 3. 实现思路

1. **`iterHighlightDocuments`**：主 document + 各 iframe 文档统一遍历，供存在性检测与 reconcile 共用。
2. **`isUserHighlightMarkPresent`**：apply 快路径除签名外还要求 DOM 有对应 `dataset.epubcfi` 的 mark。
3. **`reconcileUserHighlightMarkDom(keepCfis)`**：purge 末尾调用；不在 keep 集合的 mark 全删；同 CFI 只留第一个。
4. **`removeUserHighlightMarkGroupsByCfi`**：`annotations.remove` 后 DOM 直删，防止孤儿。
5. **`invalidateAppliedUserHighlightsMissingDom`**：播放/relayout 后若 mark 被误伤，从 `appliedRef` 剔除以便下次 sync 重 apply。
6. **播放结束回调**：`read.tsx` 传 `syncReadingAnnotations`，恢复用户划线与想法虚线一致态。

## 4. 关键代码对比与注释

### 4.1 `purgeStaleUserHighlightAnnotations`（`apps/frontend/src/views/ebook/utils/epubUserHighlights.ts`）

**对比范围**：完整函数（purge 末尾是否 reconcile DOM）。

**改动前** · `apps/frontend/src/views/ebook/utils/epubUserHighlights.ts`（基线，约 L832–L853）

```typescript
// 清理不在 visible/keep 集合内的用户划线批注与 appliedRef 条目
function purgeStaleUserHighlightAnnotations(
	rend: Rendition,
	rawHighlights: EbookUserHighlight[],
	visibleCfis: Set<string>,
	appliedRef: Map<string, string>,
): void {
	// 由 visibleCfis 派生 keepCfis，过滤空 CFI
	const keepCfis = new Set(
		[...visibleCfis].filter((cfi) => cfi.trim().length > 0),
	);

	// 遍历原始高亮列表，删除不在 keep 内的项
	for (const item of rawHighlights) {
		const cfi = item.cfiRange.trim();
		if (!cfi || keepCfis.has(cfi)) continue;
		removeUserHighlightAnnotation(rend, cfi, appliedRef);
	}

	// 扫描 appliedRef 中可能残留的 CFI，同样不在 keep 则移除
	for (const cfiRange of [...appliedRef.keys()]) {
		if (!keepCfis.has(cfiRange)) {
			removeUserHighlightAnnotation(rend, cfiRange, appliedRef);
		}
	}
}
```

**改动后** · `apps/frontend/src/views/ebook/utils/epubUserHighlights.ts`（当前，约 L1029–L1052）

```typescript
// 清理不在 visible/keep 集合内的用户划线批注与 appliedRef 条目
function purgeStaleUserHighlightAnnotations(
	rend: Rendition,
	rawHighlights: EbookUserHighlight[],
	visibleCfis: Set<string>,
	appliedRef: Map<string, string>,
): void {
	// 由 visibleCfis 派生 keepCfis，过滤空 CFI
	const keepCfis = new Set(
		[...visibleCfis].filter((cfi) => cfi.trim().length > 0),
	);

	// 遍历原始高亮列表，删除不在 keep 内的项
	for (const item of rawHighlights) {
		const cfi = item.cfiRange.trim();
		if (!cfi || keepCfis.has(cfi)) continue;
		removeUserHighlightAnnotation(rend, cfi, appliedRef);
	}

	// 扫描 appliedRef 中可能残留的 CFI，同样不在 keep 则移除
	for (const cfiRange of [...appliedRef.keys()]) {
		if (!keepCfis.has(cfiRange)) {
			removeUserHighlightAnnotation(rend, cfiRange, appliedRef);
		}
	}

	// 新增：与 keepCfis 对齐 DOM mark，删孤儿并对同 CFI 去重
	reconcileUserHighlightMarkDom(rend, keepCfis);
}
```

**变更摘要**：purge 逻辑不变，末尾增加 `reconcileUserHighlightMarkDom`，把 SVG mark 层与数据层对齐。

---

### 4.2 `applyEpubUserHighlights` 快路径（同文件）

**对比范围**：`for (const item of sortedHighlights)` 循环内 skip 条件（约 L1077–L1102）。

**改动前** · 基线，约 L878–L898

```typescript
	// 遍历排序后的高亮，仅处理 visible CFI
	for (const item of sortedHighlights) {
		if (!visibleCfis.has(item.cfiRange)) continue;

		// 计算样式签名（style|color|id）
		const nextSig = buildHighlightApplySignature(item);
		// 签名未变则跳过 re-apply（旧版不校验 DOM）
		if (appliedRef.get(item.cfiRange) === nextSig) continue;

		// 先移除旧批注再 highlight
		removeUserHighlightAnnotation(rend, item.cfiRange, appliedRef);
		try {
			// 统一 highlight 类型，与想法 underline 批注槽位分离；点击走 markClicked + iframe click
			rend.annotations.highlight(
				item.cfiRange,
				buildHighlightData(item),
				buildUserHighlightClickHandler(item),
				buildHighlightClassName(item),
				buildHighlightStyles(item),
			);
			appliedRef.set(item.cfiRange, nextSig);
		} catch {
			appliedRef.delete(item.cfiRange);
		}
	}
```

**改动后** · 当前，约 L1077–L1102

```typescript
	// 遍历排序后的高亮，仅处理 visible CFI
	for (const item of sortedHighlights) {
		if (!visibleCfis.has(item.cfiRange)) continue;

		// 计算样式签名（style|color|id）
		const nextSig = buildHighlightApplySignature(item);
		// 签名相同且 DOM mark 仍在时才跳过；mark 被播放层误删时会强制重绘
		if (
			appliedRef.get(item.cfiRange) === nextSig &&
			isUserHighlightMarkPresent(rend, item.cfiRange)
		) {
			continue;
		}

		// 先移除旧批注再 highlight
		removeUserHighlightAnnotation(rend, item.cfiRange, appliedRef);
		try {
			// 统一 highlight 类型，与想法 underline 批注槽位分离；点击走 markClicked + iframe click
			rend.annotations.highlight(
				item.cfiRange,
				buildHighlightData(item),
				buildUserHighlightClickHandler(item),
				buildHighlightClassName(item),
				buildHighlightStyles(item),
			);
			appliedRef.set(item.cfiRange, nextSig);
		} catch {
			appliedRef.delete(item.cfiRange);
		}
	}
```

**变更摘要**：快路径增加 `isUserHighlightMarkPresent`，修复 appliedRef 与 DOM 脱节时跳过 apply 的问题。

---

### 4.3 `removeUserHighlightAnnotation`（同文件）

**对比范围**：完整函数（约 L1105–L1118）。

**改动前** · 基线，约 L901–L913

```typescript
// 移除单条用户划线的 epub.js 批注并清 appliedRef
function removeUserHighlightAnnotation(
	rend: Rendition,
	cfiRange: string,
	appliedRef: Map<string, string>,
): void {
	try {
		// 用户划线统一用 highlight 类型，避免 remove(underline) 误删想法虚线
		rend.annotations.remove(cfiRange, 'highlight');
	} catch {
		// ignore
	}
	appliedRef.delete(cfiRange);
}
```

**改动后** · 当前，约 L1105–L1118

```typescript
// 移除单条用户划线的 epub.js 批注并清 appliedRef
function removeUserHighlightAnnotation(
	rend: Rendition,
	cfiRange: string,
	appliedRef: Map<string, string>,
): void {
	try {
		// 用户划线统一用 highlight 类型，避免 remove(underline) 误删想法虚线
		rend.annotations.remove(cfiRange, 'highlight');
	} catch {
		// ignore
	}
	// 新增：epub.js remove 可能漏删 SVG mark，DOM 直删同 CFI 分组
	removeUserHighlightMarkGroupsByCfi(rend, cfiRange);
	appliedRef.delete(cfiRange);
}
```

**变更摘要**：remove 后追加 DOM 直删，避免孤儿 mark 导致重复或无法取消。

---

### 4.4 `invalidateAppliedUserHighlightsMissingDom`（纯新增）

**改动后** · `apps/frontend/src/views/ebook/utils/epubUserHighlights.ts`（当前，约 L1130–L1139）

```typescript
// 导出：播放/relayout 后校验 appliedRef，mark 已失则删条目以便下次 sync 重 apply
export function invalidateAppliedUserHighlightsMissingDom(
	rend: Rendition,
	appliedRef: Map<string, string>,
): void {
	// 遍历 appliedRef 快照，避免迭代中 mutate
	for (const cfi of [...appliedRef.keys()]) {
		// DOM 无对应 mark 则从 appliedRef 剔除
		if (!isUserHighlightMarkPresent(rend, cfi)) {
			appliedRef.delete(cfi);
		}
	}
}
```

**变更摘要**：纯新增导出函数；`syncReadingAnnotations` 路径在播放结束后调用，与 reconcile 配合恢复划线。

---

### 4.5 `reconcileUserHighlightMarkDom`（纯新增）

**改动后** · 同文件，约 L204–L241（完整函数）

```typescript
// 清理不在 keepCfis 内的孤儿 mark，并对同一 CFI 去重
function reconcileUserHighlightMarkDom(
	rend: Rendition,
	keepCfis: Set<string>,
): void {
	// 遍历主文档与各 iframe 阅读文档
	for (const doc of iterHighlightDocuments(rend)) {
		// CFI → 该文档下所有 mark 分组
		const byCfi = new Map<string, Element[]>();
		doc.querySelectorAll(USER_HIGHLIGHT_SELECTOR).forEach((group) => {
			const cfi = (group as SVGElement).dataset.epubcfi?.trim() ?? '';
			if (!cfi) {
				group.remove();
				return;
			}
			const list = byCfi.get(cfi) ?? [];
			list.push(group);
			byCfi.set(cfi, list);
		});
		for (const [cfi, groups] of byCfi) {
			if (!keepCfis.has(cfi)) {
				groups.forEach((g) => {
					g.remove();
				});
				continue;
			}
			for (let i = 1; i < groups.length; i += 1) {
				groups[i]!.remove();
			}
		}
	}
}
```

## 5. 兼容性与影响

- 用户划线数据模型与 API 不变；仅 sync/apply 与 DOM 协调更严格。
- 播放层须继续使用独立 class（见 [EPUB听书句背景.md](EPUB听书句背景.md)），禁止 `annotations.remove(cfi,'highlight')` 清播放色。

## 6. 回归建议

1. A 划线 → A 听当前 → 划线仍单份、可取消。
2. A 划线 → A 听当前 → 选 A+B 划线 → 取消 A+B → 原 A 可正常取消。
3. 播放中/播完手动改划线样式 → 无重复 mark。
4. 快速删最后一条想法后分栏关闭（见 [EPUB阅读分屏.md](EPUB阅读分屏.md)）不影响划线 reconcile。

## 7. 相关源码路径

| 说明 | 路径 |
| ---- | ---- |
| DOM reconcile 与 apply | `apps/frontend/src/views/ebook/utils/epubUserHighlights.ts` |
| 播完 sync 回调 | `apps/frontend/src/views/ebook/hooks/useEbookQuoteListen.ts` |
| 传入 sync | `apps/frontend/src/views/ebook/read.tsx` |

---

（若与仓库最新源码不一致，以源码为准）
