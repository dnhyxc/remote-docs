# 英语学习页：单词列表 / 语句列表折叠切换

## 1. 背景与目标

在「单词学习资料」与「经典语句」两个区块中，当已拉取到条目时，列表区域可能较长。需要在**列表标题与内容同一行标题的右侧**提供可点击的折叠控件，使用户能收起或展开卡片网格，减少纵向占用。

**目标**：

- 默认**展开**列表（`listExpanded` 初值为 `true`）。
- 折叠时仅隐藏下方 **grid（网格）** 卡片区域，**标题行与切换按钮保留**，便于再次展开。
- 新一次拉取或从历史载入数据后，自动展开列表，避免用户停留在「收起」状态却看不到新数据。
- 无障碍（a11y，accessibility）：`aria-expanded`、`aria-label`、`title` 与 i18n 对齐。

---

## 2. 改动范围

| 角色 | 路径 |
|------|------|
| 单词区块 UI 与状态 | `apps/frontend/src/views/englishLearning/VocabularySection.tsx` |
| 经典句区块 UI 与状态 | `apps/frontend/src/views/englishLearning/ClassicQuotesSection.tsx` |
| 中英文文案 | `apps/frontend/src/i18n/locales/zh-CN.ts`、`apps/frontend/src/i18n/locales/en-US.ts` |

两处组件结构**对称**：仅主题色、文案 key、条目类型不同，折叠逻辑一致。

---

## 3. 实现思路

1. **本地 UI 状态**  
   使用 `useState(true)` 保存 `listExpanded`，不请求后端；与拉取进度 `loading` / `progress` 解耦。

2. **条件渲染**  
   `items.length > 0` 时渲染外层容器；标题行始终渲染；内层 `items.map` 包在 `{listExpanded ? ( <div className="grid ...">...</div> ) : null}` 中，实现「只藏列表、不藏标题」。

3. **图标与按钮形态**  
   使用 `lucide-react` 的 `CircleChevronDown` / `CircleChevronRight`：展开态显示「圆圈内下箭头」暗示可收起，收起态显示「圆圈内右箭头」暗示可展开。按钮采用 `variant="link"`，弱化边框、贴近工具型图标按钮。

4. **新数据时强制展开**  
   - 用户点击「拉取」且校验通过后，在清空 `items` 并进入流式拉取前执行 `setListExpanded(true)`，保证本轮从展开态开始展示增量。  
   - 从历史抽屉载入详情并 `setItems` 成功后执行 `setListExpanded(true)`，避免载入后列表仍折叠导致「好像没数据」的错觉。

5. **i18n**  
   `collapseList` / `expandList` 分词条与经典句各一对 key，供 `aria-label` 与 `title` 复用，避免硬编码中英文。

6. **未采用全页折叠或 `details/summary` 的原因**  
   折叠范围需精确到「卡片网格」；与现有 `Button` + Tailwind 布局一致，便于与右侧工具按钮对齐，且不改变外层 `@container` 栅格语义。

---

## 4. 关键代码与注释（讲解版摘录）

### 4.1 状态：默认展开

**来源**：`apps/frontend/src/views/englishLearning/VocabularySection.tsx`（约 L72–L74，`VocabularyPackSectionInner` 内）

```typescript
const [loadedStreamId, setLoadedStreamId] = useState<string | null>(null);
/**
 * 说明：仅控制卡片网格是否挂载显示；为 true 时展示 grid，为 false 时隐藏 grid。
 * 说明：默认 true，即「默认展开列表」的产品语义。
 */
const [listExpanded, setListExpanded] = useState(true);
```

> `ClassicQuotesSection.tsx` 中对应为约 L73–L75，注释文案为「语句列表」。

### 4.2 历史载入成功后展开

**来源**：`apps/frontend/src/views/englishLearning/VocabularySection.tsx`（约 L168–L178，`openHistoryDetail`）

```typescript
const openHistoryDetail = useCallback(
	async (streamId: string) => {
		setLoadingHistoryDetailId(streamId);
		try {
			const res = await getEnglishVocabularyHistoryDetail(streamId);
			const d = res.data;
			if (d?.items?.length) {
				setItems(d.items);
				// 说明：从抽屉载入整表后主动展开，避免用户此前收起列表而忽略新内容
				setListExpanded(true);
				setLoadedStreamId(streamId);
				setHistoryDrawerOpen(false);
				// ... Toast 等
			}
		} finally {
			setLoadingHistoryDetailId(null);
		}
	},
	[t],
);
```

### 4.3 新一次流式拉取开始时展开

**来源**：`apps/frontend/src/views/englishLearning/VocabularySection.tsx`（约 L233–L239，`onGenerate` 内通过校验后）

```typescript
setLoading(true);
setAgentToolLine(null);
setProgress({ collected: 0, target: effectiveTarget, round: 0 });
setItems([]);
// 说明：每一轮新拉取都从展开态开始，流式 onChunk 追加卡片时用户能直接看到
setListExpanded(true);

const abort = await streamEnglishVocabularyPack({
	// ...
});
```

### 4.4 标题行 + 折叠按钮 + 条件网格

**来源**：`apps/frontend/src/views/englishLearning/VocabularySection.tsx`（约 L499–L538，列表区域 JSX；经典句见 `ClassicQuotesSection.tsx` 约 L495–L534，图标与 class 一致、色系随区块变化）

```tsx
{items.length > 0 ? (
	<div>
		{/* 说明：flex + justify-between：左侧标题、右侧折叠触发器同一行 */}
		<div className="mt-5 flex min-h-8 items-center justify-between gap-2">
			<div className="text-textcolor/45 text-sm font-medium">
				{t('englishLearning.vocab.listHeading')}
			</div>
			<Button
				type="button"
				variant="link"
				size="sm"
				className="text-textcolor/55 hover:text-textcolor h-8 w-8 shrink-0 p-0! mt-0.5 -mr-2"
				// 说明：函数式更新，避免依赖过期的 listExpanded 闭包
				onClick={() => setListExpanded((v) => !v)}
				aria-expanded={listExpanded}
				aria-label={
					listExpanded
						? t('englishLearning.vocab.collapseList')
						: t('englishLearning.vocab.expandList')
				}
				title={
					listExpanded
						? t('englishLearning.vocab.collapseList')
						: t('englishLearning.vocab.expandList')
				}
			>
				{/* 说明：用两种图标区分状态，比单图标旋转更直观 */}
				{listExpanded ? (
					<CircleChevronDown
						className="w-full h-full transition-transform duration-200"
						aria-hidden
					/>
				) : (
					<CircleChevronRight
						className="w-full h-full transition-transform duration-200"
						aria-hidden
					/>
				)}
			</Button>
		</div>
		{/* 说明：仅控制 grid 挂载；折叠不卸载 items 状态，故再次展开无需重拉接口 */}
		{listExpanded ? (
			<div className="mt-1.5 grid grid-cols-1 gap-4 @min-[26rem]:grid-cols-2">
				{/* 说明：items.map 渲染每条卡片，与仓库源码一致，此处从略 */}
			</div>
		) : null}
	</div>
) : null}
```

### 4.5 i18n 键（中文）

**来源**：`apps/frontend/src/i18n/locales/zh-CN.ts`（约 L707–L710、L740–L744）

```typescript
'englishLearning.vocab.listHeading': '单词列表',
'englishLearning.vocab.collapseList': '收起单词列表',
'englishLearning.vocab.expandList': '展开单词列表',

// ... 经典语句区块
'englishLearning.classic.listHeading': '语句列表',
'englishLearning.classic.collapseList': '收起语句列表',
'englishLearning.classic.expandList': '展开语句列表',
```

**来源**：`apps/frontend/src/i18n/locales/en-US.ts`（约 L791–L793、L825–L829）

```typescript
'englishLearning.vocab.listHeading': 'Words',
'englishLearning.vocab.collapseList': 'Collapse word list',
'englishLearning.vocab.expandList': 'Expand word list',

'englishLearning.classic.listHeading': 'Lines',
'englishLearning.classic.collapseList': 'Collapse quote list',
'englishLearning.classic.expandList': 'Expand quote list',
```

---

## 5. 兼容性与影响

- **破坏性**：无；未增加新网络接口。
- **状态持久化**：`listExpanded` 仅内存；刷新页面后恢复默认展开。
- **与流式拉取并存**：折叠仅隐藏 DOM，**不**中止 SSE；若需在折叠时仍停止生成，仍使用原有「停止拉取」按钮。

---

## 6. 建议回归

1. 有数据时：标题行右侧图标可切换，网格显隐正确。  
2. 收起后从历史载入：列表自动展开且可见新 `items`。  
3. 收起后再次点击拉取：流式过程中展开态下 chunk 正常追加。  
4. 读屏 / 键盘：焦点在按钮上时 `aria-expanded` 与文案随状态变化。

---

## 7. 相关源码路径

| 说明 | 路径 |
|------|------|
| 单词列表折叠 | `apps/frontend/src/views/englishLearning/VocabularySection.tsx` |
| 语句列表折叠 | `apps/frontend/src/views/englishLearning/ClassicQuotesSection.tsx` |
| 文案 | `apps/frontend/src/i18n/locales/zh-CN.ts`、`en-US.ts` |

若与仓库最新源码不一致，以源码为准。
