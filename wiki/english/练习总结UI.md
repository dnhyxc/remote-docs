# 英语练习结算页与听写/拼写模块（前端）

## 延伸阅读

- 单题「提示」：[`练习会话提示.md`](./练习会话提示.md)
- 入口与返回导航：[`练习入口导航.md`](./练习入口导航.md)
- 产品使用说明：[`docs/项目指南.md`](../项目指南.md) §13.11
- 用户向更新条目：[`docs/项目更新信息.md`](../项目更新信息.md) §24（听写/拼写练习）
- 域总览：[`docs/english/README.md`](./README.md)

---

## 1. 背景与目标

在英语学习场景下提供**纯前端**的单词**听写**与**看中写（拼写）**练习闭环：从收藏、资源库或词包结果页带参进入 → 设置题量与顺序 → 逐题作答 → **练习报告（结算）** 查看统计、回顾本轮对错词、重练错题或继续拉取未练词。

本文说明练习模块的**单题作答 → 下一题 / 查看结果**链路，以及**结算页（Summary）** 的信息架构与 UI 决策；听写步骤条、拉词分页等见同目录源码与下文交叉引用。

---

## 2. 改动范围

| 路径 | 说明 |
|------|------|
| `apps/frontend/src/views/englishLearning/practice/index.tsx` | 路由页：阶段机 setup / running / summary，壳层返回与 `contentLayout` |
| `apps/frontend/src/views/englishLearning/practice/Summary.tsx` | 结算页编排：统计条、作答明细列表、底栏操作 |
| `apps/frontend/src/views/englishLearning/practice/components/summary/*` | 统计格、列表项、底栏按钮、配色 token |
| `apps/frontend/src/views/englishLearning/practice/components/shell/PracticePageShell.tsx` | 顶栏：结算阶段左侧返回图标 |
| `apps/frontend/src/views/englishLearning/practice/Setup.tsx` | 设置题量、顺序、开始练习 |
| `apps/frontend/src/views/englishLearning/practice/Session.tsx` | **单题 UI、判分、下一题 / 查看结果** |
| `apps/frontend/src/views/englishLearning/practice/utils/grading.ts` | 拼写规范化与 `gradeSpelling`（单词句末标点；经典句全标点忽略，见 [`经典练习与错题.md`](./经典练习与错题.md) §3.7） |
| `apps/frontend/src/views/englishLearning/practice/utils/fetchWords.ts` | 词表拉取、继续练习去重 |
| `apps/frontend/src/store/englishPracticePool.ts` | 会话内已练 key 集合（继续练习） |
| `apps/frontend/src/i18n/locales/zh-CN.ts` / `en-US.ts` | 练习与结算文案 |
| `apps/frontend/src/router/routes.ts` | `/english-learning/practice` 路由 |

入口（收藏 / 资源库 / 词包）在各自面板增加「听写/拼写」跳转，查询参数见 `practice/utils/paths.ts`。

---

## 3. 下一题切换：实现思路

「下一题」不是单独的路由跳转，而是**父级题序 + 子级单题 UI 状态**协作完成：路由页持有整轮 `queue` 与当前下标 `index`；`Session` 只负责**当前这一题**的展示、判分，并在「允许进入下一题」时通过回调把本题结果交给父级。

### 3.1 两层状态

| 层级 | 位置 | 状态 | 作用 |
|------|------|------|------|
| 页面阶段 | `index.tsx` | `PracticePhase`: `setup` \| `running` \| `summary` | 控制显示设置 / 单题 / 结算 |
| 题序 | `index.tsx` | `queue: PracticeItem[]`、`index: number`、`results: PracticeAttemptResult[]` | 当前题为 `queue[index]`，顶栏副标题为「第 current / total 题」 |
| 单题 UI | `Session.tsx` | `PracticeItemPhase`: `prompt` \| `revealed` | 答题中 vs 答错后的揭示区 |

父级仅在 `phase === 'running' && queue[index]` 存在时挂载 `<Session item={currentItem} />`。`index` 递增后 React 仍渲染 `Session`，但 **`item` prop 变化**会触发子组件重置（见 §3.5）。

### 3.2 端到端流程（Mermaid）

```mermaid
sequenceDiagram
  participant User
  participant Session
  participant Index as index.tsx
  participant Summary

  User->>Session: 输入拼写 + 检查
  alt 答对
    Session->>Session: gradeSpelling → true
    Session->>Index: onStepComplete(attempt)
    Index->>Index: results.push; index++
    alt index >= queue.length
      Index->>Summary: phase = summary
    else 仍有题
      Index->>Session: 新 item prop → 重置 prompt
    end
  else 答错
    Session->>Session: phase = revealed; 缓存 lastWrong
    User->>Session: 下一题 / Enter
    Session->>Index: onStepComplete(lastWrong)
    Index->>Index: 同上 index++ / 可能进 summary
  end
```

### 3.3 答对：无需点「下一题」，立即切题

用户提交表单（「检查」）时，`Session.onSubmit` 在 `phase === 'prompt'` 下调用 `gradeSpelling`。若正确，**直接** `completeStep(attempt)` → `onStepComplete`，不经过 `revealed` 阶段，因此不会出现「下一题」按钮。

设计意图：答对即视为本题结束，减少一次点击，加快节奏。

### 3.4 答错：先揭示，再「下一题」或「查看练习结果」

1. 判错后：`setLastWrong(attempt)`、`setPhase('revealed')`，中间区从听写/拼写提示切换为 `RevealedPanelInner`（你的答案 + 正确答案 + 播放）。
2. 底栏按钮由「检查」变为 **「下一题」** 或 **「查看练习结果」**（由父级传入 `isLastQuestion={index >= queue.length - 1}` 决定文案）。
3. 用户点击按钮或按 **Enter**（`Session` 内全局 `keydown` 监听）→ `onNext()` → `completeStep(lastWrong)`，才把**记为错误**的 `PracticeAttemptResult` 交给父级。

答错题目同样进入 `results`，结算页「作答明细」中会出现在错题列表（红左边框）。

### 3.5 父级 `onStepComplete`：题序推进与进入结算

`index.tsx` 中 `onStepComplete` 做两件事（顺序重要）：

1. `setResults(prev => [...prev, result])` — 追加本题结果（对/错都记）。
2. `setIndex(prev => prev + 1)`，并在 `setQueue` 回调里判断：若 `nextIndex >= q.length` 则 `setPhase('summary')`。

注意：`currentItem = queue[index]` 在 **index 已加 1 之后** 若仍小于 `length`，则下一帧渲染新题；若 `index === length`，`currentItem` 为 `undefined`，`Session` 卸载，显示 `Summary`。

**不在此处改 queue 内容**（不 splice），题表整轮固定，仅下标前进。

### 3.6 换题时 Session 本地状态重置

`Session` 对 `item.key` 建立 `useEffect` 依赖：每次父级换题（新 `key`）时执行：

- `phase` → `'prompt'`
- 清空 `input`、`lastWrong`
- 听写「拼写」步骤高亮复位
- `autoPlayedKeyRef` 清空；听写模式下一 effect 会自动播当前词

因此**不需要**给 `Session` 加 `key={item.key}` 强制 remount；逻辑上等同新题实例。

### 3.7 UI：同卡切换、固定高度、无过渡动画

- **固定卡片高度** `SESSION_CARD_H`：听写提示区与错题揭示区切换时外层高度不变，避免布局跳动。
- **叠层切换**：`prompt` 与 `revealed` 两个 `SessionPromptPanel` 放在同一 `grid` 单元（`*:col-start-1 *:row-start-1`），用 `hidden` / `aria-hidden` 切换可见性，并设 `transition-none`，避免播放钮等区域闪动。
- **顶栏进度**：`PracticePageShell` 的 `subtitle` 在 `running` 阶段显示 `progress` i18n（`current: index + 1`），与 `index` 同步更新。

### 3.8 与结算 / 重练 / 继续练习的关系

| 操作 | 题序行为 |
|------|----------|
| 本轮最后一题完成后 | `phase → summary`，`results` 含全部 attempt |
| 重练错题 | `setQueue(wrongQueue)`、`setIndex(0)`、`setResults([])`、`phase → running` |
| 继续练习 | 拉新 `items` 后同样 `index=0`、清空 `results`、重新 `running` |

---

## 4. 结算页与其它实现要点

1. **三阶段状态机**：`index.tsx` 用 `phase` 切换 Setup → Session → Summary；结算后保留 `config` 与 `results`，支持重练错题与继续练习（`fetchPracticeContinueQueue` 排除 `practicedKeys`）。
2. **结算页垂直空间**：有作答明细时 `contentLayout="fill"`，统计区 `compact`（单行五等分），中间 `ScrollArea` 占满剩余高度。
3. **作答明细**：先错题、后正确；顶栏「作答明细」+ 错误/正确角标；绿/红左边框。
4. **配色**：`metricTone.ts` 低透明度渐变底 + 语义色数值。
5. **返回**：结算页眉左侧返回图标；底栏无「返回」文案按钮。
6. **TTS**：单题与结算列表均用 `playPreferred`；切题 / 离页 `stopAllPlayback`。

---

## 5. 关键代码与注释

以下代码块为**讲解版**：在仓库源码基础上补充中文注释，便于脱离 IDE 阅读；逻辑与仓库一致，省略部分 import。

### 5.1 类型：题序、单题阶段、作答结果

**来源**：`apps/frontend/src/views/englishLearning/practice/types.ts`（约 L45–L51、L206）

```ts
/** 某一题的作答记录：无论对错都会进入 results，供结算页统计与列表 */
export type PracticeAttemptResult = {
  item: PracticeItem;   // 题目词条（含 word、translationZh、key 等）
  userInput: string;    // 用户提交的拼写（检查时已 trim）
  correct: boolean;     // gradeSpelling 判定结果
};

/** 路由页三阶段：设置 → 做题 → 报告 */
export type PracticePhase = 'setup' | 'running' | 'summary';

/** Session 内部 UI 阶段：答题中 | 答错揭示（等待点「下一题」） */
export type PracticeItemPhase = 'prompt' | 'revealed';
```

### 5.2 路由页：开始练习、题序推进、挂载 Session

**来源**：`apps/frontend/src/views/englishLearning/practice/index.tsx`（约 L64–L72、L97–L112、L186–L254）

```tsx
// —— 与「下一题」相关的核心状态（节选）——
const [phase, setPhase] = useState<PracticePhase>('setup');
const [queue, setQueue] = useState<PracticeItem[]>([]);       // 本轮题目队列（开始练习时确定）
const [index, setIndex] = useState(0);                      // 当前题下标，0-based
const [results, setResults] = useState<PracticeAttemptResult[]>([]); // 已完成题目的结果

/** Setup 点「开始练习」：写入队列并从第 0 题进入 running */
const onStarted = useCallback(
  (items: PracticeItem[], setup: PracticeSetupConfig, cursor: PracticeSessionCursor) => {
    setConfig(setup);
    setSessionCursor(cursor);
    setPracticedKeys(items.map((i) => i.key).filter(Boolean));
    setQueue(items);      // 整轮 queue 固定，后续只移动 index
    setIndex(0);
    setResults([]);
    setPhase('running');  // 挂载 Session，currentItem = queue[0]
  },
  [],
);

/**
 * 单题结束回调（Session 在「答对直进」或「答错后点下一题」时调用）
 * 步骤：
 * 1. 把本题 attempt 追加到 results（对错都记，结算页才能同时展示）
 * 2. index + 1；若 nextIndex >= queue.length，说明没有下一题 → phase = summary
 * 注意：不在此处 splice queue，题表长度不变
 */
const onStepComplete = useCallback((result: PracticeAttemptResult) => {
  setResults((prev) => [...prev, result]);

  setIndex((prevIndex) => {
    const nextIndex = prevIndex + 1;

    setQueue((q) => {
      if (nextIndex >= q.length) {
        // 例如共 10 题，最后一题完成后 nextIndex === 10，进入结算
        setPhase('summary');
      }
      return q;
    });

    return nextIndex;
  });
}, []);

/** 当前正在做的题；index 自增后若等于 length，则为 undefined，Session 卸载 */
const currentItem = queue[index];

/** running 且 currentItem 存在时才渲染 Session，避免越界 */
{phase === 'running' && config && currentItem ? (
  <Session
    mode={config.mode}
    item={currentItem}
    // 父级根据「是否为队列最后一题」决定底栏按钮文案
    isLastQuestion={index >= queue.length - 1}
    onStepComplete={onStepComplete}
  />
) : null}

/** 顶栏副标题：第 (index+1) / queue.length 题 — 与 index 同步更新 */
const shellSubtitle = useMemo(() => {
  if (phase !== 'running' || !config) return undefined;
  return t('englishLearning.practice.progress', {
    current: index + 1,
    total: queue.length,
  });
}, [config, index, phase, queue.length, t]);
```

### 5.3 判分：规范化后与标准词严格相等

**来源**：`apps/frontend/src/views/englishLearning/practice/utils/grading.ts`（约 L8–L32）

```ts
/**
 * 规范化用户输入，减少因大小写、弯引号、多空格导致的误判
 * - trim 首尾空白
 * - 转小写
 * - 弯引号统一为 ASCII 单引号 '
 * - 连续空白压成单个空格
 */
export function normalizeSpellingAnswer(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/[''']/g, "'")
    .replace(/\s+/g, ' ');
}

/**
 * 判分：单词 normalizeVocabSpellingAnswer（含句末标点剥离）；
 * 经典句 normalizeSentenceSpellingAnswer（再去全部标点）。
 * Session 对 classic 传 compareAsSentence: true。
 */
export function gradeSpelling(
  userInput: string,
  expectedWord: string,
  options?: { compareAsSentence?: boolean },
): boolean {
  const normalize = options?.compareAsSentence
    ? normalizeSentenceSpellingAnswer
    : normalizeVocabSpellingAnswer;
  const u = normalize(userInput);
  const e = normalize(expectedWord);
  if (!u || !e) return false;
  return u === e;
}
```

> 完整实现与边界见 [`经典练习与错题.md`](./经典练习与错题.md) §4.3–§4.4；若与仓库最新 `grading.ts` 不一致，以源码为准。

### 5.4 Session：换题重置、判分提交、下一题与 Enter

**来源**：`apps/frontend/src/views/englishLearning/practice/Session.tsx`（约 L43–L161、L100–L136）

```tsx
export function Session({ mode, item, isLastQuestion = false, onStepComplete }: SessionProps) {
  /** 单题 UI 阶段：prompt=答题区，revealed=错题揭示区 */
  const [phase, setPhase] = useState<PracticeItemPhase>('prompt');
  const [input, setInput] = useState('');
  /** 答错时暂存 attempt，点「下一题」后再交给父级 onStepComplete */
  const [lastWrong, setLastWrong] = useState<PracticeAttemptResult | null>(null);
  const nextButtonRef = useRef<HTMLButtonElement>(null);

  /**
   * 父级 index 递增 → item.key 变化 → 本 effect 执行
   * 等价于「进入下一题」后的状态重置，无需给 Session 加 key={item.key} 强制 remount
   */
  useEffect(() => {
    setPhase('prompt');
    setInput('');
    setLastWrong(null);
    setDictationSpellStepActive(false);
    autoPlayedKeyRef.current = null;
    requestAnimationFrame(() => inputRef.current?.focus());
  }, [item.key]);

  /** 统一出口：停 TTS 后通知父级推进题序 */
  const completeStep = useCallback(
    (result: PracticeAttemptResult) => {
      stopAllPlayback();
      onStepComplete(result);
    },
    [onStepComplete],
  );

  /**
   * 表单提交（「检查」按钮或 Enter）
   * 仅在 prompt 阶段有效，避免 revealed 时重复提交
   */
  const onSubmit = useCallback(
    (e?: FormEvent) => {
      e?.preventDefault();
      if (phase !== 'prompt') return;

      const trimmed = input.trim();
      if (!trimmed) return;

      const correct = gradeSpelling(trimmed, item.word);
      const attempt: PracticeAttemptResult = {
        item,
        userInput: trimmed,
        correct,
      };

      if (correct) {
        // 路径 A：答对 → 立即 completeStep → 父级 index++，不出现「下一题」按钮
        completeStep(attempt);
        return;
      }

      // 路径 B：答错 → 停播、进入揭示区，等待用户确认后再切题
      stopAllPlayback();
      setPlaying(false);
      setLastWrong(attempt);
      setPhase('revealed');
    },
    [completeStep, input, item, phase],
  );

  /** 揭示区底栏「下一题」/「查看练习结果」 */
  const onNext = useCallback(() => {
    if (lastWrong) {
      completeStep(lastWrong);
    }
  }, [completeStep, lastWrong]);

  /**
   * revealed 阶段：Enter 快捷切题；焦点移到「下一题」按钮
   * - 若焦点在拼写输入框，Enter 也触发 onNext（并 preventDefault 避免重复提交表单）
   * - 其它输入控件内不拦截 Enter
   */
  useEffect(() => {
    if (phase !== 'revealed' || !lastWrong) return;

    inputRef.current?.blur();

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Enter' || e.repeat) return;
      const target = e.target as HTMLElement | null;
      if (target?.id === 'practice-spelling-input') {
        e.preventDefault();
        onNext();
        return;
      }
      const tag = target?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      e.preventDefault();
      onNext();
    };

    window.addEventListener('keydown', onKeyDown);
    requestAnimationFrame(() => nextButtonRef.current?.focus());

    return () => window.removeEventListener('keydown', onKeyDown);
  }, [phase, lastWrong, onNext]);

  // ... 渲染见 §5.5
}
```

### 5.5 Session：固定高度、双面板叠层、底栏按 phase 切换

**来源**：`apps/frontend/src/views/englishLearning/practice/Session.tsx`（约 L33–34、L167–L320）

```tsx
/** 整张卡片高度锁定：听写区 ↔ 错题揭示切换时外层不跳高 */
const SESSION_CARD_H = 'h-[calc(14.625rem+min(14.5rem,38dvh))]';

const showSessionCard =
  phase === 'prompt' || (phase === 'revealed' && lastWrong != null);

return (
  <PracticeCard className={cn('...', SESSION_CARD_H)}>
    <SessionStageHeader
      trailing={
        <span className={cn(phase === 'revealed' ? 'text-destructive' : 'hidden')}>
          {/* 仅 revealed 时显示「拼写错误」 */}
          {t('englishLearning.practice.incorrect')}
        </span>
      }
    />

    <div className="flex min-h-0 flex-1 flex-col p-4">
      {/*
        关键布局：两层 SessionPromptPanel 叠在同一 grid 单元
        - *:col-start-1 *:row-start-1：两层重叠
        - transition-none：避免 CSS 过渡导致听写播放钮闪一下
        - hidden + aria-hidden：切换可见性，不卸载 DOM
      */}
      <div className="grid min-h-0 flex-1 w-full transition-none *:col-start-1 *:row-start-1 *:h-full *:min-h-0">
        <SessionPromptPanel
          fillHeight
          className={cn(phase !== 'prompt' && 'hidden')}
          aria-hidden={phase !== 'prompt'}
        >
          {/* 听写：DictationPromptBody；拼写：SpellingPromptBody 显示中文释义 */}
        </SessionPromptPanel>

        <SessionPromptPanel
          scrollable
          fillHeight
          className={cn(phase !== 'revealed' && 'hidden')}
          aria-hidden={phase !== 'revealed'}
        >
          <RevealedPanelInner
            wrongInput={lastWrong?.userInput || input.trim()}
            item={item}
            /* 你的答案 + 正确答案 + 播放按钮 */
          />
        </SessionPromptPanel>
      </div>
    </div>

    <form onSubmit={onSubmit}>
      {phase === 'prompt' ? (
        <>
          <Input id="practice-spelling-input" value={input} onChange={...} />
          <Button type="submit" disabled={!input.trim()}>
            {t('englishLearning.practice.check')}
          </Button>
        </>
      ) : (
        <Button ref={nextButtonRef} type="button" onClick={onNext}>
          {isLastQuestion
            ? t('englishLearning.practice.viewResults')  // 最后一题 → 进结算
            : t('englishLearning.practice.next')}         // 否则 → 下一题
        </Button>
      )}
    </form>
  </PracticeCard>
);
```

### 5.6 重练错题：重新入队并清零题序

**来源**：`apps/frontend/src/views/englishLearning/practice/index.tsx`（约 L114–L133）

```tsx
/**
 * 结算页「重练错题」：仅用错题子集作为新 queue，从 index=0 再来一轮
 * count 按错题数量向上取整到 10/20/30/40/50，与 Setup 题量选项对齐
 */
const onRetryWrong = useCallback(
  (wrongQueue: PracticeItem[]) => {
    if (!config || wrongQueue.length === 0) return;
    const n = wrongQueue.length;
    const count = (
      n <= 10 ? 10 : n <= 20 ? 20 : n <= 30 ? 30 : n <= 40 ? 40 : 50
    ) as PracticeCountOption;

    setConfig({ ...config, count });
    setPracticedKeys((prev) => mergePracticedKeys(prev, wrongQueue));
    setQueue(wrongQueue);
    setIndex(0);
    setResults([]);       // 新一轮 results，与上一轮回报告分离
    setPhase('running');  // 再次挂载 Session，走完整「检查 → 下一题」流程
  },
  [config],
);
```

### 5.7 结算页：从 results 拆列表并先错后对渲染

**来源**：`apps/frontend/src/views/englishLearning/practice/Summary.tsx`（约 L32–L170）

```tsx
export function Summary({ results, /* ... */ }: SummaryProps) {
  const correctCount = results.filter((r) => r.correct).length;
  const wrongCount = results.length - correctCount;

  /** 错题、正确题分别映射为 PracticeItem，供列表渲染 */
  const wrongItems = useMemo(
    () => results.filter((r) => !r.correct).map((r) => r.item),
    [results],
  );
  const correctItems = useMemo(
    () => results.filter((r) => r.correct).map((r) => r.item),
    [results],
  );

  const hasWordList = wrongItems.length > 0 || correctItems.length > 0;

  return (
    <PracticeCard className={cn(hasWordList && 'min-h-0 flex-1')}>
      <SummaryStatsPanel compact={hasWordList} /* 统计五等分 */ />

      {hasWordList ? (
        <div className="flex min-h-0 flex-1 flex-col">
          <div className="border-b px-3 py-1.5">
            <p>{t('englishLearning.practice.roundWordListTitle')}</p>
            {/* 角标：错误 N、正确 M，有则显示 */}
          </div>
          <ScrollArea className="min-h-0 flex-1">
            <div className="grid gap-2.5 p-2 sm:grid-cols-2">
              {/* 顺序重要：先错题（红左边框），后正确（绿左边框） */}
              {wrongItems.map((item) => (
                <WrongListItem key={item.key} variant="wrong" onTogglePlay={...} />
              ))}
              {correctItems.map((item) => (
                <WrongListItem key={item.key} variant="correct" onTogglePlay={...} />
              ))}
            </div>
          </ScrollArea>
        </div>
      ) : null}

      <SummaryActions hasWrongItems={wrongCount > 0} onRetryWrong={...} />
    </PracticeCard>
  );
}
```

### 5.8 列表项：variant 控制左边框颜色

**来源**：`apps/frontend/src/views/englishLearning/practice/components/summary/WrongListItem.tsx`（约 L9–L57）

```tsx
export function WrongListItem({
  item,
  playing,
  onTogglePlay,
  variant = 'wrong',
}: WrongListItemProps) {
  const isCorrect = variant === 'correct';

  return (
    <div
      className={cn(
        'flex min-w-0 items-start gap-2 rounded-md border border-l-3 py-2 pl-2.5',
        isCorrect
          ? 'border-l-teal-500/55 dark:border-l-teal-400/60'  // 正确：绿左边框
          : 'border-l-destructive/45',                         // 错误：红左边框
      )}
    >
      <div className="min-w-0 flex-1">
        <div className="truncate text-base font-semibold">{item.word}</div>
        {item.translationZh?.trim() ? (
          <p className="line-clamp-2 text-sm">{item.translationZh}</p>
        ) : null}
      </div>
      <Button onClick={onTogglePlay} aria-label={playing ? stopLabel : playLabel}>
        {/* Volume2 / Square 图标，与资源库播放样式一致 */}
      </Button>
    </div>
  );
}
```

### 5.9 统计区五等分与配色 token

**来源**：`apps/frontend/src/views/englishLearning/practice/components/summary/SummaryStatsPanel.tsx`（约 L48–L90）

```tsx
/** compact 模式：一行五格，grid-cols-5 均分父宽 */
if (compact) {
  return (
    <div className="grid h-16 w-full shrink-0 grid-cols-5 items-stretch">
      {accuracyCell}
      <SummaryMetric compact tone="correct" label={labels.correct} value={correctCount} />
      <SummaryMetric compact tone="wrong" label={labels.wrong} value={wrongCount} />
      <SummaryMetric compact tone="total" label={labels.roundTotal} value={roundTotal} />
      <SummaryMetric compact tone="practiced" label={labels.practiced} value={practicedTotal} />
    </div>
  );
}
```

**来源**：`apps/frontend/src/views/englishLearning/practice/components/summary/metricTone.ts`（约 L12–L46）

```ts
/** 各指标：低透明度渐变底 + 中性 label + 语义色 value（对齐英语学习区按钮色相） */
export const SUMMARY_METRIC_TONE = {
  accent: {
    shell: 'bg-linear-to-r from-teal-400/10 to-cyan-500/10',
    label: 'text-textcolor/65',
    value: 'text-teal-700 dark:text-teal-400',
  },
  correct: {
    shell: 'bg-linear-to-r from-lime-400/10 to-green-500/10',
    label: 'text-textcolor/65',
    value: 'text-green-700 dark:text-lime-400',
  },
  wrong: {
    shell: 'bg-linear-to-r from-red-400/10 to-red-500/10',
    label: 'text-textcolor/65',
    value: 'text-destructive dark:text-red-400',
  },
  total: {
    shell: 'bg-linear-to-r from-cyan-400/10 to-blue-500/12',
    label: 'text-textcolor/65',
    value: 'text-sky-700 dark:text-cyan-400',
  },
  practiced: {
    shell: 'bg-linear-to-r from-indigo-400/15 to-blue-500/15',
    label: 'text-textcolor/65',
    value: 'text-indigo-600 dark:text-indigo-300',
  },
};
```

### 5.10 页壳：结算阶段返回图标与 fill 布局

**来源**：`apps/frontend/src/views/englishLearning/practice/index.tsx`（约 L216–L266）

```tsx
return (
  <PracticePageShell
    title={shellTitle}
    subtitle={shellSubtitle}
    contentLayout={phase === 'summary' ? 'fill' : 'center'}
    onBack={phase === 'setup' || phase === 'summary' ? onExit : undefined}
    backLabel={t('englishLearning.practice.back')}
    headerRight={
      phase === 'running' ? (
        <Button variant="link" onClick={onBackToSetup}>
          {t('englishLearning.practice.exit')}
        </Button>
      ) : null
    }
  >
    {phase === 'summary' && config ? (
      <Summary results={results} onRetryWrong={onRetryWrong} /* ... */ />
    ) : null}
  </PracticePageShell>
);
```

**来源**：`apps/frontend/src/views/englishLearning/practice/components/shell/PracticePageShell.tsx`（约 L23–L39）

```tsx
<header className="flex h-12 shrink-0 items-center ...">
  <div className="flex min-w-0 flex-1 items-center gap-2">
    {onBack ? (
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        onClick={onBack}
        aria-label={backLabel}
      >
        <ArrowLeft className="size-4" />
      </Button>
    ) : null}
    <div className="truncate text-base font-semibold">
      {subtitle || title}
    </div>
  </div>
</header>
```

---

## 6. 兼容性与影响

- **纯前端 MVP**：词表来自收藏 API、资源库分页、词包 stream 等既有接口；无单独练习后端表。
- **继续练习**：依赖 `practicedKeys` 与会话内 store，刷新页面会丢失已练集合。
- **破坏性**：无；新路由与入口为增量能力。
- **i18n**：结算与列表文案键位于 `englishLearning.practice.*`。

---

## 7. 建议回归

**下一题 / 切题**

1. 连续答对多题：不应出现「下一题」按钮，顶栏 `current/total` 递增，听写题自动播新词。
2. 答错后：揭示区展示错误输入与正确答案；点「下一题」或 Enter 后进入下一题，且 `results` 记为错。
3. 最后一题答错：按钮为「查看练习结果」，点击后进入结算而非空白 Session。
4. 听写 ↔ 错题揭示切换：卡片总高不变、无明显闪屏。

**结算与其它**

5. 全对 / 全错 / 混合三种结算列表与角标；顶栏返回图标；底栏三按钮。
6. 列表 TTS；继续练习词池耗尽 Toast；深浅色统计格与左边框可辨性。

---

## 8. 相关源码路径

| 说明 | 路径 |
|------|------|
| 路由页（题序、`onStepComplete`） | `apps/frontend/src/views/englishLearning/practice/index.tsx` |
| 单题（判分、下一题、揭示） | `apps/frontend/src/views/englishLearning/practice/Session.tsx` |
| 判分 | `apps/frontend/src/views/englishLearning/practice/utils/grading.ts` |
| 结算页 | `apps/frontend/src/views/englishLearning/practice/Summary.tsx` |
| 统计 / 列表 / 底栏 | `apps/frontend/src/views/englishLearning/practice/components/summary/` |
| 单题壳 / 叠层面板 | `apps/frontend/src/views/englishLearning/practice/components/session/` |
| 页壳 | `apps/frontend/src/views/englishLearning/practice/components/shell/PracticePageShell.tsx` |
| 类型 | `apps/frontend/src/views/englishLearning/practice/types.ts` |

若与仓库最新源码不一致，以源码为准。
