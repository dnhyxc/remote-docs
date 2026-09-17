# 公开书想法增量同步 — 实现说明

> **状态**：已落地（2026-07-02）  
> **需求摘要**：多人共读公开 EPUB 时，读者应能 **低开销** 看到他人新增/更新的想法与正文虚线；点击划线打开列表须 **一次交互即最新**；滚动停稳后 **后台增量** 对齐；私有书 **零额外 `/sync` 请求**。

## 延伸阅读

- [电子书公开分享影响.md](./电子书公开分享影响.md) — 公开书 MVP、`listThoughts` 合并范围
- [EPUB想法视口性能.md](./EPUB想法视口性能.md) — 按章拉取 + 视口挂载（与 sync 后 `ephemeralPin` 配合）
- [EPUB公开想法下划线覆盖.md](./EPUB公开想法下划线覆盖.md) — 多人虚线叠层几何
- [../ideas/电子书公开想法实时同步.md](../ideas/ebook/电子书公开想法实时同步.md) — 规划态架构图与时序
- [../impact/EPUB公开想法实时同步影响.md](../impact/EPUB公开想法实时同步影响.md) — **影响点**：`/sync` 对私有书与列表交互

---

## 1. 背景与目标

### 1.1 问题

公开书想法原先仅在进书时 `GET /thoughts/:bookId` 全量拉一次。他人新增想法后本地 `thoughts[]` stale：点击虚线列表可能缺人（需点两次），滚动经过新段落时虚线不出现（需整页刷新）。

### 1.2 方案（双轨同步）

| 轨道 | 触发 | 行为 |
|------|------|------|
| **交互轨** | 点击正文虚线 `openThoughtCluster` | `refreshThoughtsNow()`（`force` 跳节流）→ `expandClusterFromMarkSeed` → 开侧栏 |
| **背景轨** | 滚动停稳 `scheduleSync`、页签回前台 | `syncThoughts()`，15s 最小间隔 + 2s relocated debounce |

私有书 / 源书已取消公开：`isSharedEbookThoughtContext` 为 false，hook 空转，**不请求** `/sync`。

### 1.3 改动范围

| 层级 | 路径 |
|------|------|
| 后端 | `ebook.service.ts` · `syncThoughts`；`ebook.controller.ts` · `GET thoughts/:bookId/sync` |
| 前端 API | `service/index.ts` · `fetchEbookThoughtSync` |
| 合并工具 | `utils/epub/mark/epubThoughtSync.ts` |
| Hook | `hooks/usePublicEbookThoughtSync.ts` |
| 阅读页 | `read.tsx` · `openThoughtCluster`、接线 `schedulePublicThoughtSync` |

---

## 2. 实现思路

| # | 要点 | 理由 |
|---|------|------|
| 1 | **单接口** `GET .../sync?since=` | 一次返回 `{ revision, changes, deletedIds }`，省 RTT |
| 2 | **since = max(updatedAt) − 1ms** | 服务端 `updatedAt > since`，避免同毫秒漏增量 |
| 3 | **先 sync 后开列表** | 避免先展示 seed cluster 再异步补数据（「点两次」） |
| 4 | **`expandClusterFromMarkSeed`** | 与 mark 点击同构的连通 CFI 闭包，跨段扩展 |
| 5 | **`deletedIds` 增量剔除** | 软删 / 改私密不再二次无 since 全量 |
| 6 | **sync 后 `ephemeralPinThoughtCfis`** | 视口裁剪模式下强制下一轮 apply 新 CFI（见视口专题） |
| 7 | **模块路径** `epub/mark/epubThoughtSync.ts` | 与 mark 层同目录；导出符号名仍保留 `Ebook` 前缀 |

---

## 3. 关键代码对比与注释

### 3.1 `syncThoughts`（`ebook.service.ts`）

**对比范围**：方法全量（**纯新增**）。

**改动前** · `apps/backend/src/services/ebook/ebook.service.ts`（基线）

```typescript
// 基线无 syncThoughts；公开书仅 listThoughts 全量查询
```

**改动后** · `apps/backend/src/services/ebook/ebook.service.ts`（当前，约 L1323–L1368）

```typescript
// 公开书 / 读书记录：增量同步可见想法；私有源书直接空包
async syncThoughts(
	userId: number,
	bookId: string,
	since?: Date,
): Promise<EbookThoughtSyncDto> {
	// 校验归属并取 book 行
	const book = await this.assertBookOwned(userId, bookId);
	// 非公开且非读书记录：前端不应调，后端 gate 返回空
	if (!book.isPublic && !book.sourceBookId) {
		return {
			revision: { count: 0, latestUpdatedAt: null },
			changes: [],
			deletedIds: [],
		};
	}

	// 有 since：走 SQL 增量（changes + deletedIds + revision）
	if (since) {
		const revision = await this.queryVisibleThoughtRevision(userId, book);
		const deletedIds = await this.queryRemovedThoughtIdsSince(
			userId,
			book,
			since,
		);
		const changedRows = await this.queryVisibleThoughtRows(
			userId,
			book,
			since,
		);
		// 无变更则早退，省序列化
		if (changedRows.length === 0 && deletedIds.length === 0) {
			return { revision, changes: [], deletedIds: [] };
		}
		return {
			revision,
			changes:
				changedRows.length > 0
					? await this.mapThoughtRowsToDtos(changedRows)
					: [],
			deletedIds,
		};
	}

	// 无 since：兼容全量（前端主路径不用）
	const rows = await this.queryVisibleThoughtRows(userId, book);
	return {
		revision: this.buildThoughtRevision(rows),
		changes: await this.mapThoughtRowsToDtos(rows),
		deletedIds: [],
	};
}
```

**变更摘要**：新增 `/sync` 核心；私有书 gate；增量与 `listThoughts` 共用 `createVisibleThoughtsQueryBuilder`。

---

### 3.2 `fetchEbookThoughtSync`（`service/index.ts`）

**对比范围**：导出函数（**纯新增**）。

**改动后** · `apps/frontend/src/service/index.ts`（当前，约 L2117–L2126）

```typescript
// GET /ebook/thoughts/:bookId/sync?since= — 公开书单次同步（版本戳 + 增量）
export const fetchEbookThoughtSync = async (
	bookId: string,
	since?: string,
): Promise<EbookThoughtSync> => {
	// since 有值时作为 query 传给后端
	const res = await http.get<EbookThoughtSync>(`${EBOOK_THOUGHTS}/${bookId}/sync`, {
		querys: since ? { since } : undefined,
	});
	return res.data;
};
```

---

### 3.3 `applyEbookThoughtSync`（`epubThoughtSync.ts`）

**对比范围**：合并工具文件（**纯新增**；自 `utils/ebookThoughtSync.ts` 迁至 `epub/mark/epubThoughtSync.ts`）。

**改动后** · `apps/frontend/src/views/ebook/utils/epub/mark/epubThoughtSync.ts`（当前，约 L80–L94）

```typescript
// 应用 sync 响应：deletedIds 剔除 + changes 按 id 合并；无变更则保持引用
export function applyEbookThoughtSync(
	local: EbookThought[],
	sync: EbookThoughtSync,
): { next: EbookThought[] } {
	// revision/count/watermark 未变且无 changes/deleted 时跳过
	if (isThoughtSyncUnchanged(local, sync)) {
		return { next: local };
	}

	// 先删后并：软删/改私密从本地列表移除
	let next = pruneEbookThoughtsByIds(local, sync.deletedIds ?? []);
	if (sync.changes.length > 0) {
		next = mergeEbookThoughts(next, sync.changes);
	}
	return { next };
}
```

**变更摘要**：增量合并策略集中于此；`ebookThoughtSyncSinceParam` / `isSharedEbookThoughtContext` 同文件导出。

---

### 3.4 `usePublicEbookThoughtSync`（`usePublicEbookThoughtSync.ts`）

**对比范围**：Hook 全量（**纯新增**）。

**改动后** · `apps/frontend/src/views/ebook/hooks/usePublicEbookThoughtSync.ts`（当前，约 L30–L129）

```typescript
// 公开书想法背景/交互增量同步
export function usePublicEbookThoughtSync({
	bookId,
	book,
	publicSource,
	thoughts,
	setThoughts,
	onMerged,
}: Options) {
	// thoughts 最新值供 async sync 读取
	const thoughtsRef = useRef(thoughts);
	thoughtsRef.current = thoughts;

	const onMergedRef = useRef(onMerged);
	onMergedRef.current = onMerged;

	// 读书记录或公开源书且源书仍公开时才启用
	const enabled =
		Boolean(bookId) &&
		Boolean(book) &&
		isSharedEbookThoughtContext(book, publicSource);

	const lastSyncAtRef = useRef(0);
	const inFlightRef = useRef<Promise<EbookThought[] | null> | null>(null);
	const relocTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

	const syncThoughts = useCallback(
		async (options?: SyncOptions): Promise<EbookThought[] | null> => {
			if (!enabled || !bookId) return null;
			// 并发复用同一 in-flight Promise
			if (inFlightRef.current) return inFlightRef.current;

			const now = Date.now();
			// 背景轨 15s 节流；force 时跳过
			if (
				!options?.force &&
				now - lastSyncAtRef.current < MIN_SYNC_INTERVAL_MS
			) {
				return thoughtsRef.current;
			}

			const run = async (): Promise<EbookThought[] | null> => {
				try {
					const local = thoughtsRef.current;
					const since = ebookThoughtSyncSinceParam(
						maxEbookThoughtUpdatedAt(local),
					);
					const sync = await fetchEbookThoughtSync(bookId, since);
					const { next } = applyEbookThoughtSync(local, sync);

					if (next !== local) {
						// sync 到的新 CFI 下一轮 apply 强制挂载（视口模式）
						if (sync.changes.length > 0) {
							ephemeralPinThoughtCfis(
								sync.changes.map((thought) => thought.cfiRange),
							);
						}
						setThoughts(next);
						onMergedRef.current?.();
					}
					lastSyncAtRef.current = Date.now();
					return next;
				} catch {
					return thoughtsRef.current;
				} finally {
					inFlightRef.current = null;
				}
			};

			inFlightRef.current = run();
			return inFlightRef.current;
		},
		[bookId, enabled, setThoughts],
	);

	const refreshThoughtsNow = useCallback(
		() => syncThoughts({ force: true }),
		[syncThoughts],
	);

	// relocated → saveCfi 链路上 scheduleSync：2s debounce
	const scheduleSync = useCallback(() => {
		if (!enabled) return;
		if (relocTimerRef.current) clearTimeout(relocTimerRef.current);
		relocTimerRef.current = setTimeout(() => {
			relocTimerRef.current = null;
			void syncThoughts();
		}, RELOC_DEBOUNCE_MS);
	}, [enabled, syncThoughts]);

	useEffect(() => {
		if (!enabled) return;
		// 页签回前台：重置节流并立即 sync
		const onVisibility = () => {
			if (document.visibilityState === 'visible') {
				lastSyncAtRef.current = 0;
				void syncThoughts();
			}
		};
		document.addEventListener('visibilitychange', onVisibility);
		return () => {
			document.removeEventListener('visibilitychange', onVisibility);
			if (relocTimerRef.current) clearTimeout(relocTimerRef.current);
		};
	}, [enabled, syncThoughts]);

	return { scheduleSync, refreshThoughtsNow };
}
```

**变更摘要**：双轨触发 + 节流 + in-flight 去重；合并后 pin CFI 并 invalidate 聚类缓存（`onMerged`）。

---

### 3.5 `openThoughtCluster`（`read.tsx`）

**对比范围**：回调全量。

**改动前** · `apps/frontend/src/views/ebook/read.tsx`（基线，约 L1019–L1034）

```typescript
// 点击虚线：直接用 mark 携带的 cluster 开侧栏，无网络刷新
const openThoughtCluster = useCallback(
	(cluster: EbookThoughtClickCluster) => {
		if (cluster.allThoughts.length === 0) return;
		const rend = epubNavRef.current?.getRendition() ?? undefined;
		const { cfiRange } = getThoughtClusterHighlightSubject(cluster, rend);
		if (cfiRange.trim()) {
			thoughtQuoteAnchorCfiRef.current = cfiRange.trim();
		}
		startTransition(() => {
			setAssistantOpen(false);
			setThoughtListCluster({ ...cluster, selectedThoughtId: undefined });
			setThoughtListOpen(true);
		});
	},
	[],
);
```

**改动后** · `apps/frontend/src/views/ebook/read.tsx`（当前，约 L1063–L1099）

```typescript
// 点击虚线：先 force sync，再按连通闭包重建 cluster，一次点击即最新
const openThoughtCluster = useCallback(
	(cluster: EbookThoughtClickCluster) => {
		if (cluster.allThoughts.length === 0) return;
		const seedCluster = { ...cluster, selectedThoughtId: undefined };

		void (async () => {
			const rend = epubNavRef.current?.getRendition() ?? undefined;
			// 交互轨：跳过节流拉增量
			const fresh = await refreshThoughtsNow();
			const allThoughts = fresh ?? thoughtsRef.current;

			invalidateThoughtClusterConnectivityCache();
			const reconciled = rend
				? expandClusterFromMarkSeed(
						rend,
						allThoughts,
						seedCluster.allThoughts,
					)
				: reconcileThoughtClickCluster(seedCluster, allThoughts, rend);
			if (!reconciled || reconciled.allThoughts.length === 0) return;

			const { cfiRange } = getThoughtClusterHighlightSubject(
				reconciled,
				rend,
			);
			if (cfiRange.trim()) {
				thoughtQuoteAnchorCfiRef.current = cfiRange.trim();
			}

			startTransition(() => {
				setAssistantOpen(false);
				setThoughtListCluster(reconciled);
				setThoughtListOpen(true);
			});
		})();
	},
	[refreshThoughtsNow],
);
```

**变更摘要**：异步 `refreshThoughtsNow` + `expandClusterFromMarkSeed`；解决 stale mark `thoughtIds` 漏人。

---

## 4. 兼容性与影响

| 场景 | 行为 |
|------|------|
| 私有书 | `enabled=false`，零 `/sync` |
| 源书取消公开 | `publicSource.isStillPublic=false` 时 sync 关闭 |
| 进书首屏 | 仍由 `useEbookThoughtLoader` 按章 `listThoughts`（见视口专题） |
| 高亮 sync | 未改动；仅想法走本链路 |

## 5. 回归清单

- [ ] 公开书 A、B 两账号：B 写想法后 A **点一次** 虚线见 B 条目
- [ ] A 滚动停稳后视口内出现 B 新增灰虚线（≤15s + debounce）
- [ ] 私有书 Network 面板无 `/sync`
- [ ] 删/改私密想法后 `deletedIds` 从列表与正文移除

## 6. 相关源码路径

| 说明 | 路径 |
|------|------|
| Sync API | `apps/backend/src/services/ebook/ebook.controller.ts` |
| Sync 服务 | `apps/backend/src/services/ebook/ebook.service.ts` |
| 合并工具 | `apps/frontend/src/views/ebook/utils/epub/mark/epubThoughtSync.ts` |
| Hook | `apps/frontend/src/views/ebook/hooks/usePublicEbookThoughtSync.ts` |
| 阅读页接线 | `apps/frontend/src/views/ebook/read.tsx` |

---

（若与仓库最新源码不一致，以源码为准）
