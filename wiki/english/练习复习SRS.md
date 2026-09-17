# 英语练习：今日复习（SRS）、侧栏整合与随机分页补足

## 延伸阅读

- 后端 SRS 规则细则：[`apps/backend/specs/english-练习复习SRS.md`](./练习复习SRS.md)
- 练习入口与返回：[`练习入口导航.md`](./练习入口导航.md)
- 错题集：[`单词错题与共享UI.md`](./单词错题与共享UI.md)、[`经典练习与错题.md`](./经典练习与错题.md)

**文档角色**：本轮 diff 的实现说明（间隔复习 + 首页侧栏 + 练习拉词行为）。产品向用法见 `docs/项目指南.md` §13.14；更新摘要见 `docs/项目更新信息.md` §24。

---

## 1. 背景与目标

| 问题 | 目标 |
|------|------|
| 错题集只有快照，没有「下次何时复习」 | 用 `next_review_at` 驱动「今日待复习」，答对后移出当日队列 |
| 历史错题无调度行时不应全部算「今日」 | 仅 **新入库 / 错拼更新** 的错题写入或拉回 `english_practice_review_state` |
| 侧栏入口分散在 `components/`、`favorites/`、`mistakes/` | 统一到 `sidebar/`，首页只挂载 `EnglishLearningSidebar` |
| 点击「今日复习」曾自动开 10 题听写 | 进入练习**设置页**，用户自选模式与题量 |
| 随机练习命中最后一页不足题量 | 继续拉其它页直至凑满或词表用尽 |

---

## 2. 改动范围

### 后端

- `apps/backend/src/migrations/1780300000000-english-practice-review-state.ts`
- `apps/backend/src/services/english-learning/entity/english-practice-review-state.entity.ts`
- `apps/backend/src/services/english-learning/english-practice-review.srs.ts`
- `apps/backend/src/services/english-learning/dto/practice-review.dto.ts`
- `apps/backend/src/services/english-learning/english-learning.service.ts`
- `apps/backend/src/services/english-learning/english-learning.controller.ts`
- `apps/backend/src/services/english-learning/english-learning.module.ts`
- `apps/backend/specs/english-练习复习SRS.md`

### 前端

- `apps/frontend/src/views/englishLearning/sidebar/`（新建）
- `apps/frontend/src/views/englishLearning/index.tsx`
- 删除：`components/EnglishSource.tsx`、`components/LearningToolbar.tsx`、`favorites/components/FavoriteSession.tsx`、`mistakes/components/MistakeBookSession.tsx`
- `apps/frontend/src/views/englishLearning/practice/`（`index.tsx`、`Setup.tsx`、`Summary.tsx`、`types.ts`、`utils/fetchWords.ts`、`utils/resolveTitle.ts`）
- `apps/frontend/src/service/api.ts`、`service/index.ts`
- `apps/frontend/src/i18n/locales/zh-CN.ts`、`en-US.ts`

---

## 3. 实现思路

### 3.1 复习调度与错题集解耦

- 表 `english_practice_review_state`：`(userId, contentKind, itemKey)` 唯一，存 `next_review_at`、`repetitions`、`interval_days`、`ease_factor`、`last_result` 等。
- **今日待复习** = `next_review_at <= now` 且 **INNER JOIN 错题表**（词仍在错题集中）；删错题时同步删 review state。
- **新错题 / 错拼变更**：`markMistakesDueForReview` 仅对本次 `toInsertKeys` + `toUpdateKeys` 写入或把 `next_review_at` 拉回当前时刻；批量加入时「跳过」的旧错题**不**改调度。
- **结算**：`recordPracticeReviewAttempts` 对每题调用 `applyReviewSrs`；答对则 `next_review_at` 推未来，首页计数下降。

### 3.2 API 与前端练习来源 `review`

| 方法 | 路径 | 作用 |
|------|------|------|
| GET | `practice/review/summary` | `vocabDue` / `classicDue` |
| GET | `practice/review/queue` | 拉到期队列（支持 `excludeKeys`） |
| POST | `practice/review/record` | 结算上报对错 |

`PracticeSource` 增加 `'review'`；`fetchWords` 的 `case 'review'` 走 `getEnglishPracticeReviewQueue`，不走路由分页。

### 3.3 侧栏与入口

- `EnglishLearningSidebar`：工具栏 → 词库/语句库 → 词包区 → 收藏 → **今日复习** → 错题集。
- `ReviewSession`：`openPractice({ source: 'review', contentKind, returnTo: 'home' })`，**不传** `mode`，不再触发练习页自动开练。
- 结算后 `dispatchEnglishReviewSummaryRefresh` 刷新侧栏待复习数。

### 3.4 随机分页补足

- 抽取 `collectSessionFromPaginatedPages`：按页索引循环拉取，跨页合并去重，直到 `pageSize`（用户题量）或无可加条目。
- 首次随机：`buildRandomPageTryOrder` = 随机首页 + 其余页顺序。
- `cursorAfterPages`：随机模式把**本次命中的所有页码**写入 `usedRandomPageIndices`（修复原先只记最后一页的问题）。
- `fetchLive` 改为复用同一套分页函数（内存 slice 模拟 `fetchPage`）。

---

## 4. 关键代码与注释

### 4.1 SM-2 轻量调度

**来源**：`apps/backend/src/services/english-learning/english-practice-review.srs.ts`（约 L58–L106，`applyReviewSrs`）

```typescript
export function applyReviewSrs(input: {
	repetitions: number;
	intervalDays: number;
	easeFactor: number;
	correct: boolean;
}) {
	const now = new Date();

	if (!input.correct) {
		// 答错：间隔归零，ease 下调（下限 1.3），明天再复习
		return {
			repetitions: 0,
			intervalDays: 0,
			easeFactor: Math.max(1.3, input.easeFactor - 0.2),
			nextReviewAt: addCalendarDays(now, 1),
			lastResult: 'wrong' as const,
		};
	}

	const repetitions = input.repetitions + 1;
	let intervalDays = input.intervalDays;
	if (repetitions === 1) intervalDays = 1;
	else if (repetitions === 2) intervalDays = 3;
	else intervalDays = Math.max(1, Math.round(intervalDays * input.easeFactor));

	const easeFactor = Math.min(2.5, input.easeFactor + 0.1);
	return {
		repetitions,
		intervalDays,
		easeFactor,
		nextReviewAt: addCalendarDays(now, intervalDays),
		lastResult: 'correct' as const,
	};
}
```

### 4.2 今日待复习计数（JOIN 错题）

**来源**：`apps/backend/src/services/english-learning/english-learning.service.ts`（约 L4304–L4329，`countDueReviewJoined`）

```typescript
private async countDueReviewJoined(
	userId: number,
	contentKind: 'vocab' | 'classic',
	now: Date,
): Promise<number> {
	const qb = this.practiceReviewStateRepo
		.createQueryBuilder('rs')
		.where('rs.userId = :userId', { userId })
		.andWhere('rs.contentKind = :contentKind', { contentKind })
		.andWhere('rs.nextReviewAt <= :now', { now });

	// 必须仍在错题表中，避免已删错题仍计入
	if (contentKind === 'vocab') {
		qb.innerJoin(
			EnglishVocabularyMistake,
			'm',
			'm.userId = rs.userId AND m.wordKey = rs.itemKey',
		);
	} else {
		qb.innerJoin(
			EnglishClassicQuoteMistake,
			'm',
			'm.userId = rs.userId AND m.contentKey = rs.itemKey',
		);
	}
	return qb.getCount();
}
```

### 4.3 侧栏「今日复习」入口

**来源**：`apps/frontend/src/views/englishLearning/sidebar/components/ReviewSession.tsx`（约 L83–L88）

```typescript
onClick={() =>
	openPractice({
		source: 'review',
		contentKind: 'vocab',
		returnTo: 'home', // 练习返回英语学习首页
		// 不传 mode：进入设置页，由用户选择听写/拼写与题量
	})
}
```

### 4.4 复习场次结算上报

**来源**：`apps/frontend/src/views/englishLearning/practice/Summary.tsx`（约 L126–L146）

```typescript
useEffect(() => {
	if (!isReviewSession || results.length === 0) return;
	// 签名防 StrictMode / 重复渲染重复 POST
	const signature = results.map((r) => `${r.item.key}:${r.correct ? 1 : 0}`).join('|');
	if (reviewRecordedRef.current === signature) return;
	reviewRecordedRef.current = signature;

	void (async () => {
		await recordEnglishPracticeReviewAttempts(
			results.map((r) => ({
				contentKind: r.item.contentKind,
				itemKey: r.item.key,
				correct: r.correct,
			})),
		);
		dispatchEnglishReviewSummaryRefresh(); // 刷新侧栏待复习数
	})();
}, [/* ... */]);
```

### 4.5 随机分页多页补足

**来源**：`apps/frontend/src/views/englishLearning/practice/utils/fetchWords.ts`（约 L224–L261，`collectSessionFromPaginatedPages`）

```typescript
async function collectSessionFromPaginatedPages(/* fetchPage, total, pageSize, pageIndices, ... */) {
	const acc: PracticeItem[] = [];
	const hitPages: number[] = [];

	for (const pageIndex of pageIndices) {
		if (acc.length >= pageSize) break;
		const page = await fetchPage(
			pageOffset(pageIndex, pageSize),
			pageLimit(pageIndex, pageSize, total), // 最后一页 limit 可能 < pageSize
		);
		const exclude = new Set(excludeKeys);
		for (const item of acc) {
			if (item.key) exclude.add(item.key); // 跨页去重
		}
		const chunk = filterUnpracticed(dedupeItems(page.items), exclude, pageSize - acc.length);
		if (chunk.length > 0) {
			hitPages.push(pageIndex);
			acc.push(...chunk);
		}
	}
	return {
		items: acc.slice(0, pageSize),
		cursor: cursorAfterPages(order, hitPages, cursor),
	};
}
```

**来源**：同文件（约 L327–L348，`fetchInitialFromPaginated`）

```typescript
const pageIndices =
	order === 'random'
		? buildRandomPageTryOrder(total, pageSize) // 随机首页 + 其余页
		: buildSequentialPageTryOrder(pageCount);
const result = await collectSessionFromPaginatedPages(
	fetchPage, total, pageSize, pageIndices, order, emptyCursor(), new Set(),
);
```

---

## 5. 兼容性与影响

| 项 | 说明 |
|----|------|
| 数据库 | 需执行迁移 `1780300000000-english-practice-review-state` |
| 历史错题 | 无 `review_state` 行的旧错题**默认不进**今日队列，直至再次答错入库/更新错拼 |
| 复习练习设置 | `source=review` 时隐藏「顺序/随机」；模式与题量（10–50）可选 |
| 词表总量 < 题量 | 仍只返回实际可用条数 |
| 破坏性 | 无公开 API 删除；侧栏 import 路径变更（统一从 `sidebar/` 导出） |

---

## 6. 建议回归

1. 新错题入库 → 侧栏「今日待复习」+1 → 进入设置页选 20 题听写 → 结算全对 → 计数减少。
2. 随机练习：词库总数非题量整数倍时，首轮仍应凑满所选题量（除非总量不足）。
3. 继续练习：随机模式下多页命中后，不应重复抽到本轮已用页（检查 `usedRandomPageIndices`）。
4. 删错题 → 对应项不再出现在 summary / queue。

---

## 7. 相关源码路径

| 说明 | 路径 |
|------|------|
| SRS 纯函数 | `apps/backend/src/services/english-learning/english-practice-review.srs.ts` |
| 业务编排 | `apps/backend/src/services/english-learning/english-learning.service.ts` |
| HTTP | `apps/backend/src/services/english-learning/english-learning.controller.ts` |
| 首页侧栏组合 | `apps/frontend/src/views/englishLearning/sidebar/EnglishLearningSidebar.tsx` |
| 练习拉词 | `apps/frontend/src/views/englishLearning/practice/utils/fetchWords.ts` |
| 复习事件 | `apps/frontend/src/views/englishLearning/sidebar/reviewEvents.ts` |

若与仓库最新源码不一致，以源码为准。
