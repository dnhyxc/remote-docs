# EPUB 连续滚动 mark patch 性能 — 实现说明

> **状态**：已落地（2026-07-02）  
> **需求摘要**：连续滚动 + 公开书多人想法叠层投影时，`relocated` 高频触发 patch 导致主线程占满、滚动卡顿；通过 **relocated 停稳合并** 与 **叠层 CFI 投影缓存** 限频降本。

## 延伸阅读

- [EPUB注释同步性能.md](./EPUB注释同步性能.md) — patch 读 rect 快路径、sync 作用域缓存、想法 DOM restack（本轮 **叠加** 在其上）
- [EPUB公开想法下划线覆盖.md](./EPUB公开想法下划线覆盖.md) — 公开书叠层 rank + CFI 投影扣减（投影缓存服务于该 patch）
- [ideas/EPUB滚动卡顿性能.md](../ideas/epub/EPUB滚动卡顿性能.md) — 规划态架构图与调试手册

---

## 1. 背景与目标

### 1.1 问题

[EPUB注释同步性能.md](./EPUB注释同步性能.md) 已解决「每条 mark 每次 patch 都 CFI→getClientRects」与 sync 阻塞。公开书叠层上线后，**滚动热路径**仍出现：

| 现象 | 根因 |
|------|------|
| 连续滚动粘滞、划不动 | `relocated` **每帧** → `patchEpubReadingAnnotations` → `runEpubReadingAnnotationPatch` |
| 公开书段落 mark 多时分秒级掉帧 | `collectHigherStackOverlayBlockers` 内 **O(n²) CFI 投影**，滚动 patch **无缓存** |

### 1.2 目标

- **功能不变**：划线/想法样式、叠层 spec、点击行为与 [EPUB公开想法下划线覆盖.md](./EPUB公开想法下划线覆盖.md) 一致。
- **滚动**：停稳后 mark 坐标正确；滚动过程中 **不每帧** 跑完整 patch。
- **公开书**：同一段落多次 relocated patch 时 **复用** `(targetCfi, otherCfi)` 投影结果。

### 1.3 改动范围

| 路径 | 改动 |
|------|------|
| `apps/frontend/src/views/ebook/utils/epub/mark/epubUserHighlights.ts` | `onRelocated` 80ms idle；sync 开头 invalidate 投影缓存 + 想法 DOM |
| `apps/frontend/src/views/ebook/utils/epub/mark/epubThoughtAnnotations.ts` | `thoughtStackProjectionCache`、`resolveStackProjectionSegments` |

---

## 2. 实现思路

| # | 要点 | 理由 |
|---|------|------|
| 1 | **`relocated` 首帧 + 80ms 停稳各 patch 一次** | 滚动中 timer 不断重置，合并数十次 relocated |
| 2 | **仍走 `patchEpubReadingAnnotations` rAF** | 与 content/rendered 共用合并队列，不与 sync 同步 patch 争抢 |
| 3 | **`thoughtStackProjectionCache`** | 键 `targetCfi\0otherCfi`；miss 才 `resolveHighlightSvgLineSegments` |
| 4 | **sync 开头 `invalidateThoughtStackProjectionCache`** | 数据/apply 变更后几何可能变；滚动 patch 期间保留命中 |
| 5 | **sync 开头 `invalidateAppliedThoughtUnderlinesMissingDom`** | DOM 被 epub 重建时避免 appliedRef 误 skip（与滚动 patch 失步） |

**与 epub-annotation-sync-perf 的分工**：该文解决 **单次 patch 成本**（读 rect）；本文解决 **patch 调用频率** 与 **叠层投影重复计算**。

---

## 3. 关键代码对比与注释

### 3.1 `installEpubUserHighlightPatchListeners`（`epubUserHighlights.ts`）

**对比范围**：函数全量（relocated 监听与清理）。

**改动前** · `apps/frontend/src/views/ebook/utils/epub/mark/epubUserHighlights.ts`（基线，约 L2697–L2727）

```typescript
// 注册滚动/翻页/content 后仅 patch 样式（不 remove+readd）的监听器
export function installEpubUserHighlightPatchListeners(
	// epub.js Rendition 实例
	rend: Rendition,
): () => void {
	// 内部统一调度：defer 为 true 时走双 rAF 等 SVG 就绪
	const schedulePatch = (defer = false) => {
		// 转调 patch 调度器；滚动/relocated 默认单 rAF
		patchEpubReadingAnnotations(rend, defer ? { defer: true } : undefined);
	};

	// iframe 内容注入或变更：defer patch，避免与 epub.js 写 mark 竞态
	const onContent = () => schedulePatch(true);
	// 注册 content hook
	rend.hooks.content.register(onContent);

	// relocated：视口 CFI 变化（连续滚动时接近每帧触发）
	const onRelocated = () => schedulePatch(false);
	// 每次 relocated 立即排队 patch —— 滚动时频率过高
	rend.on('relocated', onRelocated);

	// 章节 render 完成：defer patch
	const onRendered = () => schedulePatch(true);
	rend.on('rendered', onRendered);

	// 初次挂载也 defer patch 一次
	schedulePatch(true);

	// 返回 teardown：解绑监听并取消排队中的 rAF
	return () => {
		// 取消未执行的 patch rAF
		cancelAnimationFrame(readingAnnotationPatchRaf);
		// 重置 rAF 句柄
		readingAnnotationPatchRaf = 0;
		// 重置 defer 全量 patch 标记
		pendingReadingAnnotationFullPatch = false;
		try {
			// 注销 content hook
			rend.hooks.content.deregister(onContent);
			// 注销 relocated
			rend.off('relocated', onRelocated);
			// 注销 rendered
			rend.off('rendered', onRendered);
		} catch {
			// rendition 已销毁时忽略
		}
	};
}
```

**改动后** · `apps/frontend/src/views/ebook/utils/epub/mark/epubUserHighlights.ts`（当前，约 L2697–L2741）

```typescript
// 注册滚动/翻页/content 后仅 patch 样式（不 remove+readd）的监听器
export function installEpubUserHighlightPatchListeners(
	rend: Rendition,
): () => void {
	const schedulePatch = (defer = false) => {
		patchEpubReadingAnnotations(rend, defer ? { defer: true } : undefined);
	};

	const onContent = () => schedulePatch(true);
	rend.hooks.content.register(onContent);

	// ponytail: relocated 连续滚动时合并 patch，避免每帧 O(n²) CFI 投影
	// relocated 停稳 debounce 的 timer 句柄
	let relocatedPatchTimer: ReturnType<typeof setTimeout> | null = null;
	// 停稳阈值 80ms：滚动中 timer 不断重置，仅在停滚后触发第二次 patch
	const RELOCATED_PATCH_IDLE_MS = 80;

	const onRelocated = () => {
		// 滚动 burst 的第一帧：立即 schedule 一次 patch（快速跟手）
		if (!relocatedPatchTimer) {
			schedulePatch(false);
		}
		// 若已有 timer 则清除，推迟停稳 patch
		if (relocatedPatchTimer) clearTimeout(relocatedPatchTimer);
		// 80ms 内无新 relocated 则认为停稳，再 patch 一次对齐坐标
		relocatedPatchTimer = setTimeout(() => {
			relocatedPatchTimer = null;
			schedulePatch(false);
		}, RELOCATED_PATCH_IDLE_MS);
	};
	rend.on('relocated', onRelocated);

	const onRendered = () => schedulePatch(true);
	rend.on('rendered', onRendered);

	schedulePatch(true);

	return () => {
		// teardown 时清除停稳 timer，避免卸载后仍 patch
		if (relocatedPatchTimer) clearTimeout(relocatedPatchTimer);
		cancelAnimationFrame(readingAnnotationPatchRaf);
		readingAnnotationPatchRaf = 0;
		pendingReadingAnnotationFullPatch = false;
		try {
			rend.hooks.content.deregister(onContent);
			rend.off('relocated', onRelocated);
			rend.off('rendered', onRendered);
		} catch {
			// rendition 已销毁
		}
	};
}
```

**变更摘要**：`onRelocated` 从「每事件 schedulePatch」改为 **首帧立即 + 80ms 停稳再 patch**；teardown 增加 `clearTimeout(relocatedPatchTimer)`。

---

### 3.2 `thoughtStackProjectionCache` 与 `resolveStackProjectionSegments`（`epubThoughtAnnotations.ts`）

**对比范围**：模块级缓存与投影解析（**纯新增**，基线无对应代码）。

**改动前** · `apps/frontend/src/views/ebook/utils/epub/mark/epubThoughtAnnotations.ts`（基线）

```typescript
// 基线无 thoughtStackProjectionCache；collectHigherStackOverlayBlockers 每次 patch 均 resolveHighlightSvgLineSegments
```

**改动后** · `apps/frontend/src/views/ebook/utils/epub/mark/epubThoughtAnnotations.ts`（当前，约 L266–L297）

```typescript
/** 跨 mark 叠层 CFI 投影缓存；滚动 patch 复用，thought/高亮 sync 时清空 */
// 键 targetCfi\0otherCfi → 投影到 target group 坐标系的线段数组
const thoughtStackProjectionCache = new Map<string, SvgLineSegment[]>();

// sync 开头调用：数据或 apply 变更后清空，避免 stale 几何
export function invalidateThoughtStackProjectionCache(): void {
	thoughtStackProjectionCache.clear();
}

// 生成缓存键：target 与 other 的 CFI 组合
function stackProjectionCacheKey(targetCfi: string, otherCfi: string): string {
	return `${targetCfi}\0${otherCfi}`;
}

// 解析「other 想法 CFI 投影到 target group」的 SVG 线段；优先读缓存
function resolveStackProjectionSegments(
	// Rendition；精确投影需要
	rend: Rendition | undefined,
	// 当前被扣减的下层 mark 的 SVG g
	targetGroup: SVGElement,
	// 下层 mark 的 CFI
	targetCfi: string,
	// 更高叠层 mark 的 CFI
	otherCfi: string,
	// 更高叠层 mark 的 g（无 rend 时回退读 rect）
	otherGroup: SVGElement,
): SvgLineSegment[] {
	const otherKey = otherCfi.trim();
	// 空 CFI 无投影
	if (!otherKey) return [];

	const cacheKey = stackProjectionCacheKey(targetCfi, otherKey);
	// 滚动 patch 热路径：命中则跳过 CFI→DOM→getClientRects
	const cached = thoughtStackProjectionCache.get(cacheKey);
	if (cached) return cached;

	// miss：CFI 投影到 targetGroup 所属 marks-pane 坐标
	const segments =
		rend && otherKey
			? resolveHighlightSvgLineSegments(rend, targetGroup, otherKey)
			: readMarkSvgLineSegmentsFromRects(otherGroup);
	thoughtStackProjectionCache.set(cacheKey, segments);
	return segments;
}
```

**变更摘要**：新增模块级 Map；`collectHigherStackOverlayBlockers` 改调 `resolveStackProjectionSegments` 替代每次直接投影。

---

### 3.3 `syncEpubReadingAnnotations` 开头 invalidate（`epubUserHighlights.ts`）

**对比范围**：函数签名与 try 块开头（与公开书 `currentUserId` 同批落地，invalidate 为本轮性能相关）。

**改动前** · `apps/frontend/src/views/ebook/utils/epub/mark/epubUserHighlights.ts`（基线，约 L2481–L2495）

```typescript
// 用户划线 / 想法变更后的正文批注同步入口
export function syncEpubReadingAnnotations(
	rend: Rendition,
	thoughts: EbookThought[],
	highlights: EbookUserHighlight[],
	appliedThoughtsRef: Map<string, string>,
	appliedHighlightsRef: Map<string, string>,
): void {
	// 启用单次 sync 内 CFI/clientRect 缓存
	beginEpubAnnotationSyncScope();
	try {
		// 用户线 DOM 失步时清 appliedRef
		invalidateAppliedUserHighlightsMissingDom(rend, appliedHighlightsRef);
		// 清空想法 patch 用的用户线 blocker 源
		setUserHighlightBlockerSourcesForThoughtPatch([]);
		// ... 后续 apply + runEpubReadingAnnotationPatch 未改动处省略
```

**改动后** · `apps/frontend/src/views/ebook/utils/epub/mark/epubUserHighlights.ts`（当前，约 L2481–L2495）

```typescript
export function syncEpubReadingAnnotations(
	rend: Rendition,
	thoughts: EbookThought[],
	highlights: EbookUserHighlight[],
	appliedThoughtsRef: Map<string, string>,
	appliedHighlightsRef: Map<string, string>,
	// 公开书：区分本人/他人想法色与 lineOwn
	currentUserId = 0,
): void {
	beginEpubAnnotationSyncScope();
	try {
		// sync 变更后投影几何可能变，清空滚动 patch 缓存
		invalidateThoughtStackProjectionCache();
		invalidateAppliedUserHighlightsMissingDom(rend, appliedHighlightsRef);
		// 想法 mark DOM 失步时清 appliedRef，迫使下次 apply 重绘
		invalidateAppliedThoughtUnderlinesMissingDom(rend, appliedThoughtsRef);
		setUserHighlightBlockerSourcesForThoughtPatch([]);
		// ... 后续 applyEpubThoughtUnderlines(..., currentUserId) 等见公开书专题
```

**变更摘要**：sync 开头增加 **投影缓存清空** 与 **想法 DOM invalidate**；新增 `currentUserId` 参数（公开书叠层，见 [EPUB公开想法下划线覆盖.md](./EPUB公开想法下划线覆盖.md)）。

---

## 4. 行为与复杂度

| 场景 | 优化前 | 优化后 |
|------|--------|--------|
| 连续滚动 1s，relocated ~60 次 | ~60 次 patch 排队 | **首帧 1 次 + 停稳 1 次**（timer 滚动中重置） |
| 同段落第二次 patch（公开书 M 条想法） | O(M²) 全量投影 | O(M²) **缓存命中**，仅 miss 对做布局 |
| 用户 save 想法 / 划线 | 无投影缓存概念 | sync **清空**缓存，保证几何 fresh |

---

## 5. 验收清单

| # | 步骤 | 期望 |
|---|------|------|
| AC1 | 100+ mark 连续滚动 10s | 无明显粘滞 |
| AC2 | 停滚 100ms | 划线/虚线与正文对齐 |
| AC3 | 公开书多人同段 | 叠层正确；滚动不因投影卡死 |
| AC4 | 保存新想法后 | 虚线即时更新；叠层 rank 正确 |
| AC5 | 翻页 / 分栏 resize | 与 [EPUB注释同步性能.md](./EPUB注释同步性能.md) 回归一致 |

---

## 6. 相关源码路径

| 说明 | 路径 |
|------|------|
| relocated idle | `apps/frontend/src/views/ebook/utils/epub/mark/epubUserHighlights.ts` |
| 投影缓存 | `apps/frontend/src/views/ebook/utils/epub/mark/epubThoughtAnnotations.ts` |
| patch 快路径（前置） | `apps/frontend/src/views/ebook/utils/epub/mark/epubRangeGeometry.ts` |

---

（若与仓库最新源码不一致，以源码为准）
