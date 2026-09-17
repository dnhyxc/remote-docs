# 今日记词：四选一干扰项与底栏按钮 UX

> **文档角色**：本轮在 **今日记词** 会话内优化 **四选一干扰项** 的迷惑度与同轮去重，并统一 **开始记词 / 考考我** 等底栏按钮间距。  
> **延伸阅读**：[每日记词实现.md](./每日记词实现.md)（今日记词全链路）、[练习总结UI.md](./练习总结UI.md)（听写/拼写练习 UI 约定）

---

## 1. 背景与目标

### 问题

1. **干扰项重复**：旧逻辑从本轮词池随机抽 3 个中文释义作干扰项，同一释义（如「地面」）会在多道题中反复出现，用户靠排除法即可过关。
2. **迷惑性不足**：干扰项长度、词性与正确答案差异过大（如正确答案「使混和,混淆」旁出现整段「炼狱；涤罪…」），四选一难度偏低。
3. **底栏间距不一致**：Intro「开始记词」多包一层 `p-2`；会话内「考考我」外包 `DAILY_FOOTER_PANEL_CLASS` 产生深色边框间隙，与听写/拼写 Setup「开始练习」视觉不对齐。

### 目标

- 同轮记词内 **尽量不重复** 已出现过的干扰项释义。
- 优先选 **同词性、释义长度接近、与答案有少量汉字重叠** 的干扰项。
- Intro 底栏与 **听写/拼写 Setup** 一致；会话内主操作按钮 **贴边全宽**，无额外黑框面板。

---

## 2. 改动范围

| 路径 | 说明 |
|------|------|
| `apps/frontend/src/views/englishLearning/daily/utils/buildQuizOptions.ts` | 干扰项评分、会话去重参数、fallback 扩充 |
| `apps/frontend/src/views/englishLearning/daily/components/DailyCardSession.tsx` | 维护 `usedDistractorLabelsRef`；去掉会话底栏边框面板 |
| `apps/frontend/src/views/englishLearning/daily/components/DailyIntroPanel.tsx` | 去掉多余 `p-2`，按钮 `gap-2` 与 Setup 对齐 |

---

## 3. 实现思路

### 3.1 同轮干扰项去重（会话级）

`DailyCardSession` 用 `useRef<Set<string>>` 记录本轮已展示过的干扰项 **中文释义**（非 word key，因干扰项按释义展示）。

- 进入新一批 `cards` 时 `clear()`。
- 用户点「考考我」生成选项后，将 3 个干扰项 label 写入 Set，下一题 `buildQuizOptions` 传入 `usedDistractorLabels`，对已用释义 **-200 分** 降权。

词池较小时（如 10 词 × 3 干扰 / 9 个可用释义）仍可能复用，但会推迟到池子用尽之后。

### 3.2 迷惑度评分（替代纯随机）

对本轮其它词卡逐条打分，取得分最高的 3 个不重复释义：

| 因子 | 权重思路 |
|------|----------|
| 已在同轮用过 | -200 |
| 词性相同（`normalizePos` 归一化 `v` / `v.` / `n` 等） | +5 |
| 释义长度比 ∈ [0.45, 2.2] | +4 |
| 释义过长（比 > 3.5） | -3 |
| 与正确答案共享汉字（最多计 +2） | +0～2 |
| 随机扰动 | +0～1，避免每轮顺序完全相同 |

仍保留 `FALLBACK_LABELS` 兜底；优先选用 **未在 used 集合** 中的 fallback，用尽后再允许复用。

### 3.3 底栏按钮间距

| 场景 | 结构 |
|------|------|
| Intro「开始记词」 | `border-t px-4 py-4` → `DAILY_FOOTER_PANEL_CLASS`（`p-1`）→ 按钮；与 `Setup.tsx` 的 `SETUP_SEGMENTED_PANEL_CLASS` 同规格 |
| 会话「考考我 / 下一词 / 完成」 | 仅 `border-t px-4 py-4` → 全宽 `h-10` 按钮，**无** `DAILY_FOOTER_PANEL_CLASS`（与听写 Session「检查」一致，避免深色间隙） |

---

## 4. 关键代码与注释

### 4.1 干扰项评分与组装

**来源**：`apps/frontend/src/views/englishLearning/daily/utils/buildQuizOptions.ts`（约 L36–L128）

```typescript
/** 干扰项迷惑度：同词性、释义长度接近、与答案有少量汉字重叠更优；已用过的大幅降权 */
function scoreDistractor(
	candidate: DailyVocabCard,
	card: DailyVocabCard,
	answerLen: number,
	used: ReadonlySet<string>,
): number {
	const label = candidate.translationZh.trim();
	let score = 0;

	// 说明：同轮已出现过的释义强惩罚，避免「地面」在多题重复
	if (used.has(label)) score -= 200;

	const cardPos = normalizePos(card.pos);
	const candPos = normalizePos(candidate.pos);
	if (cardPos && candPos && cardPos === candPos) score += 5;

	const len = label.length;
	const ratio = len / Math.max(answerLen, 1);
	if (ratio >= 0.45 && ratio <= 2.2) score += 4;
	else if (ratio > 3.5) score -= 3;

	// 说明：少量汉字重叠增加误判概率，上限 +2 防止长句刷分
	score += Math.min(sharedHanCount(label, card.translationZh.trim()), 2);

	score += Math.random();
	return score;
}

export function buildQuizOptions(
	card: DailyVocabCard,
	pool: DailyVocabCard[],
	options?: BuildQuizOptionsParams,
): DailyQuizOption[] {
	const used = options?.usedDistractorLabels ?? new Set<string>();
	// ... 按 score 降序取 3 个释义，fallback 补足，再与正确答案 shuffle
}
```

### 4.2 会话内维护已用干扰项

**来源**：`apps/frontend/src/views/englishLearning/daily/components/DailyCardSession.tsx`（约 L50–L83、L261–L284）

```typescript
const usedDistractorLabelsRef = useRef(new Set<string>());

// 说明：换一批 cards（新开一轮记词）时清空，避免上一场的 used 污染
useEffect(() => {
	usedDistractorLabelsRef.current.clear();
}, [cards]);

const onStartQuiz = useCallback(() => {
	if (!card) return;
	const options = buildQuizOptions(card, cards, {
		usedDistractorLabels: usedDistractorLabelsRef.current,
	});
	// 说明：本题展示过的干扰项立即记入 Set，下一题 build 时会降权
	for (const opt of options) {
		if (!opt.correct) {
			usedDistractorLabelsRef.current.add(opt.label);
		}
	}
	setQuizOptions(options);
	setStep('quiz');
}, [card, cards]);

// 说明：会话底栏不再包 DAILY_FOOTER_PANEL_CLASS，按钮直接 px-4 py-4 容器内全宽
<div className="border-theme/10 shrink-0 border-t px-4 py-4">
	<Button className={cn('h-10 w-full gap-2', PRACTICE_PRIMARY_ACTION_BTN_CLASS)} … />
</div>
```

### 4.3 Intro 底栏与 Setup 对齐

**来源**：`apps/frontend/src/views/englishLearning/daily/components/DailyIntroPanel.tsx`（约 L57–L76）

```typescript
<div className="border-theme/10 border-t px-4 py-4">
	{/* 说明：仅 p-1 边框面板，去掉历史误加的 p-2 */}
	<div className={DAILY_FOOTER_PANEL_CLASS}>
		<Button
			className={cn('h-10 w-full gap-2', PRACTICE_PRIMARY_ACTION_BTN_CLASS)}
			…
		/>
	</div>
</div>
```

---

## 5. 兼容性与影响

- **纯前端**：不改后端接口与记词记录结构。
- **行为变化**：四选一难度略升；同轮干扰项重复显著减少。
- **回归建议**：
  - 开一轮 10～20 词，连续做多题四选一，观察干扰项是否仍高频重复同一释义。
  - 对比 Intro「开始记词」与听写 Setup「开始练习」底栏内外边距。
  - 认读页「考考我」底栏无深色双边框间隙。

---

## 6. 相关源码路径

| 说明 | 路径 |
|------|------|
| 干扰项算法 | `apps/frontend/src/views/englishLearning/daily/utils/buildQuizOptions.ts` |
| 记词会话 | `apps/frontend/src/views/englishLearning/daily/components/DailyCardSession.tsx` |
| 介绍页 | `apps/frontend/src/views/englishLearning/daily/components/DailyIntroPanel.tsx` |
| 听写 Setup 底栏参考 | `apps/frontend/src/views/englishLearning/practice/Setup.tsx` |

若与仓库最新源码不一致，以源码为准。
