# 公开书想法按章拉取与视口挂载 — 实现说明

> **状态**：已落地（2026-07-03）  
> **需求摘要**：公开书数百条想法场景下，换章/滚动不卡顿；多人公开想法正文虚线 **按视口动态挂载**；sync/新建后 **即时可见** 且 **不误删邻近划线**。

## 延伸阅读

- [EPUB公开想法实时同步影响.md](./EPUB公开想法实时同步影响.md) — `/sync` 双轨与 `ephemeralPinThoughtCfis`
- [电子书公开分享影响.md](./电子书公开分享影响.md) — `appendThoughtBookScope` 公开范围
- [EPUB滚动卡顿性能.md](../ideas/epub/EPUB滚动卡顿性能.md) — relocated 80ms 合并、叠层投影缓存
- [../ideas/电子书多用户想法视口性能.md](../ideas/ebook/电子书多用户想法视口性能.md) — 规划态架构图
- [../impact/EPUB想法视口标注影响.md](../impact/EPUB想法视口标注影响.md) — **影响点**：按章拉取/视口 mark 对全量 EPUB 的波及
- [../impact/EPUB想法加载全量获取移除影响.md](../impact/EPUB想法加载全量获取移除影响.md) — **影响点**：移除进书误全量 list（`book?.fmt` 竞态）

---

## 1. 背景与目标

### 1.1 问题链

| 阶段 | 现象 | 根因 |
|------|------|------|
| 1 | 改性能后划线全无 | 错误视口裁剪 |
| 2 | 去掉裁剪后换章卡 | 全书 CFI 一次 `annotations.underline` |
| 3 | sync 后他人新线不出现 | 视口判定 + 无 pin |
| 4 | 新建丢邻近虚线 | 数据变更也 `reclaim` + viewportOnly patch |

### 1.2 一句话方案

**数据按章进内存、mark 按视口进 DOM** — `useEbookThoughtLoader` + `spineHints` API；`applyEpubThoughtUnderlines` 超阈值后仅 keep 带内 apply；**数据轨**与**滚动轨**分轨 `reclaim`。

### 1.3 改动范围

| 层级 | 路径 |
|------|------|
| 后端 | `appendThoughtBookScope`、`appendThoughtSpineHintsFilter`、`QueryEbookListThoughtsDto` |
| 按章加载 | `hooks/useEbookThoughtLoader.ts` |
| 视口 apply | `utils/epub/mark/epubThoughtAnnotations.ts` |
| sync 拆分 | `utils/epub/mark/epubUserHighlights.ts` · `syncEpubThoughtUnderlines` |
| 阅读页 | `read.tsx`、`components/reader/EpubPane.tsx` |

---

## 2. 实现思路

| # | 要点 | 阈值 / 常量 |
|---|------|-------------|
| 1 | **扩展 `appendThoughtBookScope`** | 公开源书：源书全部 + 各读书记录；可见性 `(user_id=我 OR is_public)` |
| 2 | **`GET /thoughts?spineHints=/6/4`** | 每 spine 只请求一次 |
| 3 | **spine 按章 apply** | `SPINE_SCOPED_APPLY_MIN_GROUPS = 35` |
| 4 | **视口动态 mount** | 章≥8 或全书≥30 启用 |
| 5 | **keep/remove 滞回** | keep 0.85 屏、remove 1.7 屏 |
| 6 | **双轨 apply** | 数据：`reclaimOffViewportMarks=false`；滚动：`true` |
| 7 | **`ephemeralPinThoughtCfis`** | sync/create + 侧栏 `getPinnedThoughtCfis` |
| 8 | **空 rects 兜底** | 布局未就绪时 `isCfiRangeInThoughtBand` 返回 true |

---

## 3. 关键代码对比与注释

### 3.1 `appendThoughtBookScope`（`ebook.service.ts`）

**对比范围**：方法全量（**纯新增**）。

**改动后** · `apps/backend/src/services/ebook/ebook.service.ts`（当前，约 L1024–L1107）

```typescript
// 想法查询的书范围（不含 is_public / 软删过滤）
private async appendThoughtBookScope(
	qb: SelectQueryBuilder<EbookThought>,
	userId: number,
	book: EbookBook,
): Promise<void> {
	// 读书记录：合并源书 + 本人读书记录上的想法
	if (book.sourceBookId) {
		const source = await this.bookRepo.findOne({
			where: { id: book.sourceBookId },
		});
		if (!source) {
			throw new NotFoundException('源书不存在');
		}
		// 源书已取消公开：仅源书主想法 + 本人读书记录
		if (!source.isPublic) {
			// ... 收窄 scope
			return;
		}

		// 公开源书读书记录：源书全部想法 + 各读者读书记录
		const readingIds = (
			await this.bookRepo.find({
				where: { sourceBookId: source.id },
				select: ['id'],
			})
		).map((r) => r.id);
		qb.andWhere(
			new Brackets((where) => {
				where.where('t.book_id = :sourceBookId', {
					sourceBookId: source.id,
				});
				if (readingIds.length > 0) {
					where.orWhere('t.book_id IN (:...readingIds)', { readingIds });
				}
			}),
		);
		return;
	}

	// 书主读自己公开源书：本人 + 所有读书记录
	if (book.isPublic) {
		const readingIds = (
			await this.bookRepo.find({
				where: { sourceBookId: book.id },
				select: ['id'],
			})
		).map((r) => r.id);
		qb.andWhere(
			new Brackets((where) => {
				where.where('t.book_id = :bookId AND t.user_id = :viewerUserId', {
					bookId: book.id,
					viewerUserId: userId,
				});
				if (readingIds.length > 0) {
					where.orWhere('t.book_id IN (:...readingIds)', { readingIds });
				}
			}),
		);
		return;
	}

	// 私有书：仅本书本人
	qb.andWhere('t.book_id = :bookId AND t.user_id = :viewerUserId', {
		bookId: book.id,
		viewerUserId: userId,
	});
}
```

**变更摘要**：公开多人可见的数据范围；`listThoughts` / `syncThoughts` 共用。

---

### 3.2 `appendThoughtSpineHintsFilter`（`ebook.service.ts`）

**对比范围**：方法全量（**纯新增**）。

**改动后** · `apps/backend/src/services/ebook/ebook.service.ts`（当前，约 L1109–L1134）

```typescript
// 按 CFI spine 段过滤（LIKE epubcfi(/N/M!%）
private appendThoughtSpineHintsFilter(
	qb: SelectQueryBuilder<EbookThought>,
	spineHints?: string[],
): void {
	if (!spineHints?.length) return;
	// 归一化为 /N/M 形式并去重
	const normalized = [
		...new Set(
			spineHints
				.map((hint) => hint.trim())
				.filter(Boolean)
				.map((hint) => (hint.startsWith('/') ? hint : `/${hint}`)),
		),
	];
	if (normalized.length === 0) return;

	qb.andWhere(
		new Brackets((sub) => {
			for (let index = 0; index < normalized.length; index++) {
				const param = `thoughtSpineHint${index}`;
				sub.orWhere(`t.cfi_range LIKE :${param}`, {
					[param]: `%epubcfi(${normalized[index]}!%`,
				});
			}
		}),
	);
}
```

---

### 3.3 `useEbookThoughtLoader`（`useEbookThoughtLoader.ts`）

**对比范围**：Hook 全量（**纯新增**）。

**改动前** · `apps/frontend/src/views/ebook/read.tsx`（基线）

```typescript
// 基线：进书 useEffect 一次 fetchEbookThoughts(bookId) 全量
const [thoughts, setThoughts] = useState<EbookThought[]>([]);
```

**改动后** · `apps/frontend/src/views/ebook/hooks/useEbookThoughtLoader.ts`（当前，约 L32–L123）

```typescript
// EPUB：按已加载 spine 增量拉取；PDF：仍全书一次
export function useEbookThoughtLoader({
	bookId,
	bookFmt,
	epubNavReady,
	getRendition,
	onLoadError,
}: Options) {
	const [thoughts, setThoughts] = useState<EbookThought[]>([]);
	// 已请求过的 spine hint，避免重复 API
	const fetchedSpineHintsRef = useRef(new Set<string>());
	const inFlightRef = useRef(new Map<string, Promise<void>>());

	const mergeThoughts = useCallback((incoming: EbookThought[]) => {
		if (incoming.length === 0) return;
		// startTransition 降低大列表合并阻塞
		startTransition(() => {
			setThoughts((prev) => mergeThoughtLists(prev, incoming));
		});
	}, []);

	const ensureSpineThoughtsLoaded = useCallback(
		async (spineHint: string) => {
			if (!bookId || bookFmt !== 'epub') return;
			const hint = normalizeCfiSpineHint(spineHint);
			if (!hint || fetchedSpineHintsRef.current.has(hint)) return;

			const pending = inFlightRef.current.get(hint);
			if (pending) return pending;

			const run = (async () => {
				try {
					const list = await fetchEbookThoughts(bookId, {
						spineHints: [hint],
					});
					fetchedSpineHintsRef.current.add(hint);
					mergeThoughts(list);
				} catch (error) {
					onLoadErrorRef.current?.(error);
				} finally {
					inFlightRef.current.delete(hint);
				}
			})();
			inFlightRef.current.set(hint, run);
			return run;
		},
		[bookId, bookFmt, mergeThoughts],
	);

	const ensureLoadedSpineThoughts = useCallback(
		(rend: Rendition) => {
			for (const hint of collectLoadedSpineHints(rend)) {
				void ensureSpineThoughtsLoaded(hint);
			}
		},
		[ensureSpineThoughtsLoaded],
	);

	// 换书清空缓存
	useEffect(() => {
		fetchedSpineHintsRef.current.clear();
		inFlightRef.current.clear();
		setThoughts([]);
	}, [bookId]);

	// PDF 仍全书一次
	useEffect(() => {
		if (!bookId || bookFmt === 'epub') return;
		// ... fetchEbookThoughts(bookId)
	}, [bookId, bookFmt]);

	// EPUB nav 就绪后拉当前已挂载 spine
	useEffect(() => {
		if (!bookId || bookFmt !== 'epub' || !epubNavReady) return;
		const rend = getRendition();
		if (!rend) return;
		ensureLoadedSpineThoughts(rend);
	}, [bookId, bookFmt, epubNavReady, getRendition, ensureLoadedSpineThoughts]);

	return {
		thoughts,
		setThoughts,
		mergeThoughts,
		ensureLoadedSpineThoughts,
	};
}
```

**变更摘要**：`read.tsx` 不再进书全量 list；`saveCfi` / relocated 链上调用 `ensureLoadedSpineThoughts`。

---

### 3.4 `applyEpubThoughtUnderlines` 视口分支（`epubThoughtAnnotations.ts`）

**对比范围**：函数签名与视口/recycle 逻辑（摘录；underline 写入循环未改）。

**改动前** · `apps/frontend/src/views/ebook/utils/epub/mark/epubThoughtAnnotations.ts`（基线，约 L853–L902）

```typescript
// 全书全量 apply：无 currentUserId、无视口、无 reclaim
export function applyEpubThoughtUnderlines(
	rend: Rendition,
	thoughts: EbookThought[],
	appliedRef: Map<string, string>,
): void {
	try {
		ensureThoughtUnderlineStyles();
	} catch {
		return;
	}

	const grouped = groupThoughtsByCfi(thoughts);
	const nextCfis = new Set(grouped.keys());

	// 仅数据删除时 remove mark
	for (const cfiRange of [...appliedRef.keys()]) {
		if (!nextCfis.has(cfiRange)) {
			try {
				rend.annotations.remove(cfiRange, 'underline');
			} catch {
				// ignore
			}
			appliedRef.delete(cfiRange);
		}
	}

	const sortedEntries = sortCfiGroupsForUnderlineStack([...grouped.entries()]);

	// 对每个 CFI 无差别 underline
	for (const [cfiRange, group] of sortedEntries) {
		// ... remove + underline + appliedRef.set
	}
}
```

**改动后** · `apps/frontend/src/views/ebook/utils/epub/mark/epubThoughtAnnotations.ts`（当前，约 L1254–L1348，摘录）

```typescript
export type ApplyThoughtUnderlineOptions = {
	pinCfis?: Iterable<string>;
	reclaimOffViewportMarks?: boolean;
};

export function applyEpubThoughtUnderlines(
	rend: Rendition,
	thoughts: EbookThought[],
	appliedRef: Map<string, string>,
	currentUserId = 0,
	options?: ApplyThoughtUnderlineOptions,
): void {
	try {
		ensureThoughtUnderlineStyles();
	} catch {
		ephemeralPinCfis.clear();
		return;
	}

	const pinCfis = resolvePinnedCfis(options);
	const scopedThoughts = filterThoughtsForAnnotationApply(rend, thoughts);
	const grouped = groupThoughtsByCfi(scopedThoughts);
	const allGrouped = groupThoughtsByCfi(thoughts);
	const loadedSpines = collectLoadedSpineHints(rend);
	const scopeBySpine = shouldScopeThoughtApplyBySpine(
		allGrouped.size,
		loadedSpines,
	);
	const viewportMode = shouldUseViewportThoughtApply(
		allGrouped.size,
		grouped.size,
	);
	const viewportRoot = viewportMode ? resolveThoughtViewportRoot(rend) : null;
	const viewportBands = viewportRoot
		? readThoughtViewportBands(viewportRoot)
		: null;

	// 判断 CFI 是否仍在 remove 滞回带内（已挂载 mark 或 CFI range rects）
	const shouldKeepCfiApplied = (cfiRange: string): boolean => {
		if (pinCfis.has(cfiRange)) return true;
		if (!viewportMode || !viewportBands) return true;
		// ... 查 DOM mark 或 isCfiRangeInThoughtBand(keep)
	};

	// 回收：数据删除 / 未加载 spine / 视口外（仅 reclaimOffViewportMarks）
	for (const cfiRange of [...appliedRef.keys()]) {
		const dropData =
			!nextCfis.has(cfiRange) ||
			(scopeBySpine && !loadedSpines.has(thoughtSpineHint(cfiRange)));
		const dropViewport =
			Boolean(options?.reclaimOffViewportMarks) &&
			viewportMode &&
			!shouldKeepCfiApplied(cfiRange);
		if (!dropData && !dropViewport) continue;
		if (pinCfis.has(cfiRange) && dropViewport && nextCfis.has(cfiRange)) {
			continue;
		}
		rend.annotations.remove(cfiRange, 'underline');
		appliedRef.delete(cfiRange);
	}

	for (const [cfiRange, group] of sortedEntries) {
		// 视口模式：keep 带外且未 pin 则跳过 apply
		if (viewportMode && !pinCfis.has(cfiRange) && viewportBands) {
			if (!isCfiRangeInThoughtBand(rend, cfiRange, viewportBands.keep)) {
				continue;
			}
		}
		// ... underline + 本人/他人色
	}
}
```

**变更摘要**：新增 `currentUserId`、视口 keep/remove 滞回、`reclaimOffViewportMarks` 分轨；小书阈值以下行为与基线一致。

---

### 3.5 `refreshThoughtUnderlinesInViewport`（`epubThoughtAnnotations.ts`）

**对比范围**：滚动轨入口（**纯新增**）。

**改动后** · `apps/frontend/src/views/ebook/utils/epub/mark/epubThoughtAnnotations.ts`（当前，约 L414–L424）

```typescript
// 滚动/换章：视口内增量 apply，视口外回收 mark
export function refreshThoughtUnderlinesInViewport(rend: Rendition): void {
	const ctx = thoughtUnderlineApplyContext;
	if (!ctx) return;
	applyEpubThoughtUnderlines(
		rend,
		ctx.getThoughts(),
		ctx.appliedRef,
		ctx.getCurrentUserId(),
		{ reclaimOffViewportMarks: true },
	);
}
```

**变更摘要**：relocated 80ms patch 调用此函数；`thoughts` 变更 sync 走 `reclaimOffViewportMarks: false`。

---

### 3.6 `ephemeralPinThoughtCfis`（`epubThoughtAnnotations.ts`）

**对比范围**：pin 机制（**纯新增**）。

**改动后** · `apps/frontend/src/views/ebook/utils/epub/mark/epubThoughtAnnotations.ts`（当前，约 L267–L276）

```typescript
// sync / 本地新建后下一轮 apply 强制挂载的 CFI（无视视口裁剪）
const ephemeralPinCfis = new Set<string>();

export function ephemeralPinThoughtCfis(cfis: Iterable<string>): void {
	ephemeralPinCfis.clear();
	for (const cfi of cfis) {
		const key = cfi.trim();
		if (key) ephemeralPinCfis.add(key);
	}
}
```

调用方：`usePublicEbookThoughtSync`（sync changes）、`read.tsx` `saveThought`（create）、侧栏 `getPinnedThoughtCfis`。

---

## 4. 双轨 apply 对照

| 触发 | `reclaimOffViewportMarks` | patch 范围 |
|------|---------------------------|------------|
| `thoughts` 变更 / sync / 新建 | `false` | 全量 patch（防丢邻近线） |
| relocated 停稳 `refreshThoughtUnderlinesInViewport` | `true` | viewportOnly patch |

`EpubPane` 已将 `syncEpubThoughtUnderlines` 与 `syncEpubUserHighlights` 拆为独立 `useEffect`。

---

## 5. 回归清单

- [ ] 公开书 400+ 想法：换章无明显卡顿
- [ ] 滚动经过他人想法段：停稳后出现灰虚线
- [ ] sync 后视口内新线自动出现（无需点击）
- [ ] 同屏多条摘录新建想法：邻近虚线不丢
- [ ] 私有小书（<30 CFI）：行为与改前一致

## 6. 相关源码路径

| 说明 | 路径 |
|------|------|
| 后端 scope / spine | `apps/backend/src/services/ebook/ebook.service.ts` |
| 按章加载 Hook | `apps/frontend/src/views/ebook/hooks/useEbookThoughtLoader.ts` |
| 视口 apply | `apps/frontend/src/views/ebook/utils/epub/mark/epubThoughtAnnotations.ts` |
| sync 编排拆分 | `apps/frontend/src/views/ebook/utils/epub/mark/epubUserHighlights.ts` |
| 阅读页 | `apps/frontend/src/views/ebook/read.tsx` |
| Epub 容器 | `apps/frontend/src/views/ebook/components/reader/EpubPane.tsx` |

---

（若与仓库最新源码不一致，以源码为准）
