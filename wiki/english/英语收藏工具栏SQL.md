# 英语学习：收藏抽屉批量/单条移除、快捷意图折叠与 MySQL 安全导出

## 1. 背景与目标

- **收藏抽屉**：用户在「单词 / 经典句」收藏列表中需要**批量取消收藏**，并能在单条上**快速删除**；危险操作需**二次确认**，避免误触。
- **左栏快捷意图**：意图芯片较多时左栏过长，需在**默认少占空间**与**一眼看到常用项**之间平衡，并与主区「单词列表」折叠交互**一致**。
- **工程侧**：数据库结构导出在 Adminer 等环境执行时，避免默认 `DROP TABLE` 覆盖已有数据；提供**安全导出**脚本入口。
- **体验细节**：收藏抽屉底部操作区与主题边框对齐（`Drawer` 页脚）。

## 2. 改动范围

| 路径 | 说明 |
|------|------|
| `apps/frontend/src/views/englishLearning/VocabularyFavoritesDrawer.tsx` | 单词收藏抽屉：多选、批量/单条移除、双 `Confirm`、行内删除按钮、页脚布局等 |
| `apps/frontend/src/views/englishLearning/ClassicQuotesFavoritesDrawer.tsx` | 经典句收藏抽屉：与单词侧对称实现 |
| `apps/frontend/src/views/englishLearning/VocabularySection.tsx` | 注入 `onBatchRemoveVocabularyFavorites`（`Promise.all` + 状态刷新） |
| `apps/frontend/src/views/englishLearning/ClassicQuotesSection.tsx` | 注入 `onBatchRemoveClassicFavorites` |
| `apps/frontend/src/views/englishLearning/LearningToolbar.tsx` | 快捷意图：默认仅展示前 2 条，展开展示全部；折叠按钮与列表区一致 |
| `apps/frontend/src/i18n/locales/zh-CN.ts`、`en-US.ts` | `favoritesDrawer.*`、`quickIntentsCollapse/Expand` 等文案 |
| `apps/frontend/src/components/design/Drawer/index.tsx` | `SheetFooter` 增加 `border-theme/10` |
| `apps/backend/package.json` | 新增 `sql:safe`：`mysqldump` + `CREATE TABLE IF NOT EXISTS` 管道输出至 `dnhyxc_ai_db_schema_safe.sql` |

> 说明：`apps/frontend/tsconfig.tsbuildinfo` 等为工具生成物，交接时可忽略。

## 3. 实现思路

1. **父组件持有接口、抽屉持有交互**  
   抽屉通过 **`onBatchRemoveFavorites(entries[])`** 统一向上委托；父组件内用 **`Promise.all`** 调用既有单条 `removeEnglish*Favorite` API，再更新 **`favoritedWordKeys` / `favoritedContentKeys`** 并 **`fetch*FirstPage()`** 刷新分页，避免抽屉内重复封装 HTTP。

2. **批量与单条共用同一回调**  
   单条删除传 **`[target]`** 即可复用批量管线，减少分叉；单条成功 Toast 使用独立 **`removeOneSuccess`**，与批量 **`removeSuccess`** 区分。

3. **双确认框互斥**  
   **`removeConfirmOpen`**（批量）与 **`singleRemoveConfirmOpen`**（单条）打开一方时关闭另一方并清理 **`singleRemoveTarget`**，避免两个 `AlertDialog` 叠在逻辑上冲突。

4. **选择集与列表刷新**  
   **`selectedIds`** 在 **`entries` id 集合变化**时剔除已不存在的 id；关闭抽屉时清空选择及两个确认态。单条删除成功后从 **`selectedIds`** 中 **`delete(target.id)`**，避免 UI 仍显示已删行被勾选。

5. **二次确认**  
   使用 **`@design/Confirm`**，`**closeOnConfirm={false}**`，在异步 **`onConfirm`** 内自行关弹层并 Toast；与仓库内其他危险操作（如删除会话）模式一致。

6. **快捷意图折叠**  
   常量 **`QUICK_INTENTS_COLLAPSED_VISIBLE = 2`**：折叠时 **`visibleChipDefs = chipDefs.slice(0, 2)`**；展开时全量。若 **`chipDefs.length ≤ 2`** 则不渲染右侧箭头（无展开意义）。**`useMemo`** 依赖展开态与是否显示开关，避免无意义重算。

7. **MySQL 安全导出**  
   新增 **`sql:safe`**：`--skip-add-drop-table` 去掉默认 **`DROP TABLE IF EXISTS`**；管道 **`sed`** 将行首 **`CREATE TABLE `** 替换为 **`CREATE TABLE IF NOT EXISTS `**，输出到独立文件名，避免覆盖原 `dnhyxc_ai_db_schema.sql` 工作流（若仍保留原 `sql` 脚本）。

## 4. 关键代码与注释

### 4.1 父组件：批量移除并刷新首屏

**来源**：`apps/frontend/src/views/englishLearning/VocabularySection.tsx`（约 L323–L341、传入 Drawer 的 props 附近）

```typescript
// 说明：单词收藏取消接口仍为「按词」单条；批量通过 Promise.all 并行，失败则整次进入 catch（与抽屉 Toast 一致）。
const onBatchRemoveVocabularyFavorites = useCallback(
	async (selected: EnglishVocabularyFavoriteListEntry[]) => {
		if (selected.length === 0) return;
		await Promise.all(
			selected.map((it) => removeEnglishVocabularyFavorite(it.word)),
		);
		// 说明：与主列表收藏态同步，避免抽屉删了主区星标仍亮。
		setFavoritedWordKeys((prev) => {
			const next = new Set(prev);
			for (const it of selected) {
				next.delete(normalizeEnglishVocabWordKey(it.word));
			}
			return next;
		});
		// 说明：重置 offset/首屏，避免本地删后分页与后端不一致。
		await fetchFavoritesFirstPage();
	},
	[fetchFavoritesFirstPage],
);

// ... JSX：<VocabularyFavoritesDrawer ... onBatchRemoveFavorites={onBatchRemoveVocabularyFavorites} />
```

经典句侧 **`ClassicQuotesSection`** 对称使用 **`removeEnglishClassicQuoteFavorite(it.english)`** 与 **`classicQuoteFavoriteContentKey`** 更新 **`favoritedContentKeys`**，并 **`fetchFavoriteDrawerFirstPage()`**。

### 4.2 抽屉：批量确认、单条确认与执行

**来源**：`apps/frontend/src/views/englishLearning/VocabularyFavoritesDrawer.tsx`（约 L127–L212，摘录）

```typescript
// 说明：点击底部「移除所选」先校验勾选，再关单条弹层并打开批量确认。
const requestRemoveConfirm = useCallback(() => {
	if (selectedIds.size === 0) {
		Toast({ type: 'info', title: t('englishLearning.favoritesDrawer.removeNoneHint') });
		return;
	}
	setSingleRemoveConfirmOpen(false);
	setSingleRemoveTarget(null);
	setRemoveConfirmOpen(true);
}, [selectedIds, t]);

// 说明：行内垃圾桶：关批量确认，记录目标行，打开单条确认。
const requestSingleRemove = useCallback((entry: EnglishVocabularyFavoriteListEntry) => {
	setRemoveConfirmOpen(false);
	setSingleRemoveTarget(entry);
	setSingleRemoveConfirmOpen(true);
}, []);

// 说明：批量确认后按当前 entries + selectedIds 过滤出待删列表，再委托父组件。
const executeRemoveConfirm = useCallback(async () => {
	const toRemove = entries.filter((e) => selectedIds.has(e.id));
	// ... await onBatchRemoveFavorites(toRemove); 清空勾选、关弹层、Toast
}, [entries, onBatchRemoveFavorites, selectedIds, t]);

// 说明：单条确认使用同一 onBatchRemoveFavorites([target])，并从 selectedIds 去掉该行 id。
const executeSingleRemoveConfirm = useCallback(async () => {
	const target = singleRemoveTarget;
	// ... await onBatchRemoveFavorites([target]); ...
}, [onBatchRemoveFavorites, singleRemoveTarget, t]);
```

UI 层另有：**`Checkbox` 全选 / 行选**、**`Trash2` 行内按钮**、两个 **`Confirm`** 与 **`Drawer` footer** 中批量移除 + 导出 DOCX 等（经典句文件路径 **`ClassicQuotesFavoritesDrawer.tsx`**，结构对称）。

### 4.3 快捷意图：默认 2 条 + 展开全部

**来源**：`apps/frontend/src/views/englishLearning/LearningToolbar.tsx`（约 L65–L104、标题行与 `visibleChipDefs.map`）

```typescript
/** 说明：折叠态展示的芯片数量；展开后使用完整 chipDefs。 */
const QUICK_INTENTS_COLLAPSED_VISIBLE = 2;

const [quickIntentsExpanded, setQuickIntentsExpanded] = useState(false);

const showIntentExpandToggle = chipDefs.length > QUICK_INTENTS_COLLAPSED_VISIBLE;

const visibleChipDefs = useMemo(() => {
	if (quickIntentsExpanded || !showIntentExpandToggle) {
		return chipDefs; // 说明：展开，或总条数不足 3 个时始终全量。
	}
	return chipDefs.slice(0, QUICK_INTENTS_COLLAPSED_VISIBLE); // 说明：折叠只取前 2 条。
}, [quickIntentsExpanded, showIntentExpandToggle]);

// 说明：标题行右侧 CircleChevronRight / Down，与 VocabularySection 列表头折叠按钮一致；map 使用 visibleChipDefs。
```

### 4.4 Drawer 页脚边框

**来源**：`apps/frontend/src/components/design/Drawer/index.tsx`（`SheetFooter` 约 L113–L116）

```tsx
// 说明：顶部分隔线与主题色弱对比，避免浅色/玻璃主题下页脚与内容区「粘成一块」。
<SheetFooter className="pt-3.5 py-2.5 border-t border-theme/10 shrink-0 bg-background">
```

### 4.5 后端：安全 schema 导出脚本

**来源**：`apps/backend/package.json`（`scripts` 片段）

```json
"sql:safe": "docker exec dnhyxc_ai_db sh -lc 'mysqldump -uroot -pexample --databases dnhyxc_ai_db --no-data --skip-add-drop-table --routines --triggers --events --default-character-set=utf8mb4' | sed 's/^CREATE TABLE /CREATE TABLE IF NOT EXISTS /' > dnhyxc_ai_db_schema_safe.sql"
```

- **`--skip-add-drop-table`**：避免导出中出现 **`DROP TABLE IF EXISTS`**，导入时不先删表。
- **`sed`**：仅处理行首 **`CREATE TABLE `**（注意 **`CREATE TABLESPACE`** 不以该模式行首出现，避免误替换）。
- **输出文件名**：`dnhyxc_ai_db_schema_safe.sql`，与原有 **`sql`** 产物区分。

## 5. 兼容性与影响

- **API**：未新增批量删除接口；高并发下 **`Promise.all`** 会放大瞬时请求数，若后端限流需后续改为服务端批量接口。
- **存储过程 / 触发器**：`mysqldump` 仍带 **`--routines --triggers`**，其中可能含 **`DROP PROCEDURE IF EXISTS`** 等，导入「只加表」场景时仍需人工检查 SQL。
- **快捷意图**：折叠不隐藏下方「当前意图」预览块；选中项若不在前 2 个芯片中，仍可通过预览区感知（必要时可后续增强为「折叠时保证选中芯片可见」）。

## 6. 相关源码路径

| 说明 | 路径 |
|------|------|
| 单词收藏抽屉 | `apps/frontend/src/views/englishLearning/VocabularyFavoritesDrawer.tsx` |
| 经典句收藏抽屉 | `apps/frontend/src/views/englishLearning/ClassicQuotesFavoritesDrawer.tsx` |
| 单词区父逻辑 | `apps/frontend/src/views/englishLearning/VocabularySection.tsx` |
| 经典句区父逻辑 | `apps/frontend/src/views/englishLearning/ClassicQuotesSection.tsx` |
| 左栏快捷意图 | `apps/frontend/src/views/englishLearning/LearningToolbar.tsx` |
| 文案 | `apps/frontend/src/i18n/locales/zh-CN.ts`、`en-US.ts`（`englishLearning.favoritesDrawer.*`、`quickIntents*`） |
| Drawer 组件 | `apps/frontend/src/components/design/Drawer/index.tsx` |
| 安全导出脚本 | `apps/backend/package.json`（`sql:safe`） |

若与仓库最新源码不一致，以源码为准。
