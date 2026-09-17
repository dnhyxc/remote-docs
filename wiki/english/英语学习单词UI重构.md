# 英语学习页：单词区与历史抽屉、上下限与布局调整

## 1. 背景与目标

从用户视角，本轮要实现：

- **对话区**：与主 Chat 一致，在 **ChatEntry** 底部左侧提供「新对话」；去掉原先仅起装饰作用的对话标题栏及对应 i18n。
- **单词拉取**：单次可请求条数上限提升到 **12000**，前后端校验与生成轮次上限需一致，避免大数量永远凑不满。
- **历史记录**：从侧栏内嵌列表改为 **抽屉（Drawer）** 展示；列表采用与知识库 **`KnowledgeList`** 相同的 **`ScrollArea` + 视口 `onScroll` 触底加载** 模式；抽屉内 **去掉手动「刷新」**，改为打开抽屉 / 拉取成功等时机由父组件自动拉首屏。
- **交互精简**：「拉取单词表」与「停止」合并为 **单一按钮**；「拉取」与「打开历史」**同一行**。
- **工程结构**：历史抽屉 UI 独立为 **`VocabularyHistoryDrawer.tsx`**，便于维护。
- **其它**：左栏文件重组（如 `LearningToolbar` / `VocabularySection` 命名与拆分）；**ResizableHandle** 样式微调（抓手区域视觉对齐）。

## 2. 改动范围（相对仓库根）

| 类型 | 路径 |
|------|------|
| 页面入口 | `apps/frontend/src/views/englishLearning/index.tsx` |
| 左栏工具条 | `apps/frontend/src/views/englishLearning/LearningToolbar.tsx` |
| 单词包区块 | `apps/frontend/src/views/englishLearning/VocabularySection.tsx` |
| 历史抽屉 | `apps/frontend/src/views/englishLearning/VocabularyHistoryDrawer.tsx` |
| 分栏手柄 | `apps/frontend/src/components/ui/resizable.tsx` |
| 文案 | `apps/frontend/src/i18n/locales/zh-CN.ts`、`en-US.ts` |
| 后端单词生成 | `apps/backend/src/services/english-learning/dto/generate-vocabulary.dto.ts`、`english-learning.controller.ts`、`english-learning.service.ts` |

说明：若本地仍存在对已删除文件的引用（如旧 `EnglishLearningToolbar.tsx` / `VocabularyPackSection.tsx`），以当前 `index.tsx` 的 import 为准。

## 3. 实现思路（要点）

1. **`clearChat={onNewChat}`**  
   与 `apps/frontend/src/views/chat/index.tsx` 相同，利用 **ChatEntry** 内置的「新对话」按钮；左栏不再重复放「新对话」，避免两处入口。

2. **单词历史分页**  
   - API：`listEnglishVocabularyHistory({ limit, offset })`。  
   - 首屏：`limit = 20`，`offset = 0`；**打开抽屉**时 `useEffect` 触发 `fetchHistoryFirstPage`。  
   - 下一页：`fetchHistoryMore` 用 **`historyOffsetRef`** 累加 offset；**`historyHasMoreRef`** 在本页条数 `=== PAGE_SIZE` 时认为可能还有下一页。  
   - 防抖并发：**`historyFetchingMoreRef`** 避免重复触底请求。  
   - 触底阈值：**`SCROLL_LOAD_THRESHOLD_PX = 72`**，与 `knowledgeStore.onListViewportScroll` 一致。

3. **抽屉内无刷新按钮**  
   父组件仍在「单词 SSE 完成且抽屉仍打开」时调用 `fetchHistoryFirstPage`，保证列表可见更新；用户不能在抽屉内手动点刷新。

4. **12000 条上限**  
   后端 **`ENGLISH_VOCAB_GENERATION_MAX`** 与 DTO **`@Max`**、controller/service 的 `Math.min` 对齐；**`maxRounds`** 从固定 400 改为随 `count` 放宽，否则约 8000 条即耗尽轮次。

5. **组件拆分**  
   **`VocabularyHistoryDrawer`** 只接收数据与回调（`onViewportScroll`、`onSelectEntry` 等），不包含拉取 API，保证职责清晰。

## 4. 关键代码与注释

### 4.1 页面：`ChatEntry` 新对话与布局

**来源**：`apps/frontend/src/views/englishLearning/index.tsx`（约 L228–L246）

```tsx
// 说明：与主 Chat 页一致，传入 clearChat，ChatEntry 会在底部工具区渲染「新对话」
<ChatEntry
	t={t}
	input={input}
	setInput={setInput}
	className="w-full border-0 px-0 pb-3 pt-1"
	textareaClassName="min-h-11 rounded-md"
	sendMessage={sendMessage}
	clearChat={onNewChat} // 新对话：清空会话、清 URL session 等，定义于本文件 onNewChat
	placeholder={t('englishLearning.placeholder')}
	disableTextInput={false}
	loading={englishAgentStore.isSending}
	stopGenerating={
		englishAgentStore.isStreaming
			? () => englishAgentStore.stopGenerating()
			: undefined
	}
/>
```

### 4.2 单词区：历史分页 + 打开抽屉时拉首屏 + 触底加载

**来源**：`apps/frontend/src/views/englishLearning/VocabularySection.tsx`（约 L38–L164）

```tsx
// 说明：每页 20 条，与知识库列表分页量级一致
const VOCAB_HISTORY_PAGE_SIZE = 20;
// 说明：距视口底部小于 72px 时触发 load more（与 knowledgeStore 一致）
const SCROLL_LOAD_THRESHOLD_PX = 72;

// 说明：打开抽屉时 ref 同步，供 SSE onDone 判断是否正在看历史列表
// historyDrawerOpenRef.current === true 时可选择重新拉首屏

/** 抽屉内历史列表：从第一页重拉 */
const fetchHistoryFirstPage = useCallback(async () => {
	historyFetchingMoreRef.current = false;
	setHistoryLoading(true);
	setHistoryLoadingMore(false);
	historyOffsetRef.current = 0;
	historyHasMoreRef.current = true;
	setHistoryEntries([]);
	try {
		const res = await listEnglishVocabularyHistory({
			limit: VOCAB_HISTORY_PAGE_SIZE,
			offset: 0,
		});
		const list = Array.isArray(res.data) ? res.data : [];
		setHistoryEntries(list);
		historyOffsetRef.current = list.length;
		// 说明：满页则认为可能还有后续页
		historyHasMoreRef.current = list.length >= VOCAB_HISTORY_PAGE_SIZE;
	} catch {
		setHistoryEntries([]);
		historyHasMoreRef.current = false;
	} finally {
		setHistoryLoading(false);
	}
}, []);

// 说明：抽屉打开即拉首屏（无需抽屉内「刷新」按钮）
useEffect(() => {
	if (!historyDrawerOpen) return;
	void fetchHistoryFirstPage();
}, [historyDrawerOpen, fetchHistoryFirstPage]);

const onHistoryViewportScroll = useCallback<UIEventHandler<HTMLDivElement>>(
	(e) => {
		const el = e.currentTarget;
		const rest = el.scrollHeight - el.scrollTop - el.clientHeight;
		if (rest < SCROLL_LOAD_THRESHOLD_PX) {
			void fetchHistoryMore();
		}
	},
	[fetchHistoryMore],
);
```

### 4.3 单词区：单行「拉取 / 停止」+「历史」

**来源**：`apps/frontend/src/views/englishLearning/VocabularySection.tsx`（约 L444–L484）

```tsx
// 说明：flex 一行；主按钮 flex-1，历史按钮 shrink-0
<div className="flex min-w-0 items-stretch gap-2">
	<Button
		type="button"
		variant={loading ? 'outline' : 'default'}
		onClick={() => (loading ? cancelGenerate() : void onGenerate())}
		className={cn(
			'h-9 min-w-0 flex-1 gap-2 rounded-md px-3 text-textcolor',
			loading
				? 'border-red-500/20 bg-red-500/20 ...'
				: 'bg-linear-to-r from-teal-500 to-cyan-600',
		)}
	>
		{loading ? (
			<>
				<Spinner className="size-4 shrink-0 text-textcolor" />
				<span className="truncate">{t('englishLearning.vocab.stop')}</span>
			</>
		) : (
			<span className="truncate">{t('englishLearning.vocab.generate')}</span>
		)}
	</Button>
	<Button
		type="button"
		variant="outline"
		onClick={() => setHistoryDrawerOpen(true)}
		title={t('englishLearning.vocab.historyTitle')}
	>
		<span className="max-[340px]:sr-only">
			{t('englishLearning.vocab.historyOpenDrawer')}
		</span>
	</Button>
</div>
```

### 4.4 历史抽屉组件（无刷新，仅 ScrollArea + 列表）

**来源**：`apps/frontend/src/views/englishLearning/VocabularyHistoryDrawer.tsx`（约 L50–L117）

```tsx
// 说明：纯展示；滚动加载由父组件传入 onViewportScroll
return (
	<Drawer
		title={t('englishLearning.vocab.historyTitle')}
		open={open}
		onOpenChange={onOpenChange}
		bodyClassName="pt-1.5 pb-2"
	>
		<div className="flex h-full min-h-0 flex-col">
			<ScrollArea
				className="box-border flex min-h-0 flex-1 flex-col pr-1.5"
				onScroll={onViewportScroll}
			>
				<div className="flex min-h-0 w-full flex-1 flex-col gap-2">
					{/* 说明：首屏加载中且尚无条目 → 居中 Loading */}
					{showInitialLoading ? <Loading ... /> : null}
					{entries.map((h) => (
						<button
							key={h.streamId}
							type="button"
							onClick={() => void onSelectEntry(h.streamId)}
						>
							{/* ... 主题、词数、时间、行内 loading */}
						</button>
					))}
					{/* 说明：加载下一页时底部提示，文案 common.loadingMore */}
					{showLoadMoreHint ? <div>...</div> : null}
					{showEmpty ? <div>...</div> : null}
				</div>
			</ScrollArea>
		</div>
	</Drawer>
);
```

### 4.5 后端：单词生成条数上限与轮次上限

**来源**：`apps/backend/src/services/english-learning/dto/generate-vocabulary.dto.ts`（约 L12–L26）

```typescript
// 说明：单一常量，供 DTO、service、controller 共用，与前端 VOCAB_COUNT_MAX 对齐
export const ENGLISH_VOCAB_GENERATION_MAX = 12000;

export class GenerateVocabularyDto {
	// ...
	@Max(ENGLISH_VOCAB_GENERATION_MAX)
	count?: number;
}
```

**来源**：`apps/backend/src/services/english-learning/english-learning.service.ts`（约 L379–L388，`runVocabularyGeneration` 内）

```typescript
const count = Math.min(
	ENGLISH_VOCAB_GENERATION_MAX,
	Math.max(1, dto.count ?? 10),
);
const ITEMS_PER_ROUND = 20;
// 说明：提高 maxRounds，避免目标 12000 时过早退出 while 循环
const maxRounds = Math.min(1200, Math.ceil(count / ITEMS_PER_ROUND) + 200);
```

### 4.6 分栏手柄（抓手视觉）

**来源**：`apps/frontend/src/components/ui/resizable.tsx`（约 L26–L48，`ResizableHandle`）

```tsx
// 说明：Separator 根节点 + ::after 命中区；抓手子节点 z-10；具体 class 以仓库为准
<ResizablePrimitive.Separator
	className={cn(
		'bg-theme/5 ... after:absolute after:inset-y-0 after:left-1/2 after:w-1 after:-translate-x-1/2 ...',
		className,
	)}
>
	{withHandle && (
		<div className="bg-theme/5 z-10 flex h-4 ml-px w-3 items-center justify-center rounded-xs border border-theme/10">
			<GripVerticalIcon className="size-2.5" />
		</div>
	)}
</ResizablePrimitive.Separator>
```

## 5. 兼容性与影响

- **破坏性**：移除抽屉内「刷新」及 i18n `englishLearning.vocab.historyRefresh`；依赖该文案或 `onRefresh` prop 的外链文档需更新。
- **会话 URL**：`onNewChat` 仍通过 **`setSearchParams({}, { replace: true })`** 清 `session` 查询参数，行为与先前「新对话」一致。
- **性能**：历史列表分页减轻单次 payload；大 `count` 生成仍依赖后端多轮 LLM，耗时会显著增加。

## 6. 建议回归路径

1. 英语学习页：发送消息、停止流式、ChatEntry「新对话」是否清空对话与 URL。
2. 单词：输入合法数量（含 12000 边界）、拉取中同一按钮显示停止并可中止。
3. 打开历史抽屉：首屏 20 条；滚到底是否加载更多；选中一条是否载入词条并关闭抽屉。
4. 抽屉打开时完成一次单词拉取：列表是否自动更新（父组件 `fetchHistoryFirstPage`）。
5. 左右分栏拖拽：手柄是否可见、可操作。

## 7. 相关源码路径速查

| 说明 | 路径 |
|------|------|
| 英语学习入口页 | `apps/frontend/src/views/englishLearning/index.tsx` |
| 单词 + 历史状态机 | `apps/frontend/src/views/englishLearning/VocabularySection.tsx` |
| 历史抽屉 UI | `apps/frontend/src/views/englishLearning/VocabularyHistoryDrawer.tsx` |
| 单词历史 API | `apps/frontend/src/service/index.ts`（`listEnglishVocabularyHistory` 等） |
| 知识库列表滚动参考 | `apps/frontend/src/views/knowledge/KnowledgeList.tsx` |
| 后端 DTO 上限 | `apps/backend/src/services/english-learning/dto/generate-vocabulary.dto.ts` |

若与仓库最新源码不一致，以源码为准。
