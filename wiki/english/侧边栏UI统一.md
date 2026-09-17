# 英语学习首页侧栏 UI 统一（卡片与按钮收敛）

**延伸阅读**：[英语学习侧边栏持久化.md](./英语学习侧边栏持久化.md)（左栏表单跨路由持久化）、[练习复习SRS.md](./练习复习SRS.md)（侧栏复习区块）、[英语模块文件夹布局.md](./英语模块文件夹布局.md)（模块目录约定）。

## 1. 背景与目标

**用户视角**：英语学习首页左侧栏集中了今日记词、快捷意图、词库/语句库、按主题拉取、收藏、今日复习与错题集等入口；此前各区块卡片 padding、按钮高度与间隙不一致，与右侧 Agent 区、知识库侧栏的 `border-theme/5` / `bg-theme/5` 气质也不完全对齐。

**本轮目标（保守收敛）**：

1. 抽出共享 **layout token** 与 **Header / Actions** 子组件，统一卡片壳与主/次按钮规格。
2. 保留 `sidebarAccents.ts` 中各区块的图标渐变与按钮色相（今日记词、快捷意图、词包等仍各自配色）。
3. 优化局部交互：导入 JSON 示例默认折叠；快捷意图芯片在窄侧栏保持双列，宽容器下多列自适应。
4. 首页 `aside` 增加与内容区分隔的细边框。

**未纳入本轮**：首屏三张卡片（今日记词 / 快捷意图 / 单词库）纵向铺满视口——需单独验证 `ScrollArea` 高度链与 flex 拉伸，见 §6。

## 2. 改动范围

| 路径 | 变更摘要 |
|------|----------|
| `apps/frontend/src/views/englishLearning/sidebar/tokens.ts` | **新建**：卡片、间距、标题、按钮 gap 等 token |
| `apps/frontend/src/views/englishLearning/sidebar/components/EnglishSidebarHeader.tsx` | **新建**：图标 + 标题 + 描述行 |
| `apps/frontend/src/views/englishLearning/sidebar/components/EnglishSidebarActions.tsx` | **新建**：主/次按钮行，`gradientKey` 叠 `ENGLISH_SIDEBAR_BTN_GRADIENT` |
| `apps/frontend/src/views/englishLearning/sidebar/components/SidebarPanel.tsx` | 统一使用 `SIDEBAR_CARD` |
| `apps/frontend/src/views/englishLearning/sidebar/EnglishLearningSidebar.tsx` | 根容器改用 `SIDEBAR_SECTION_STACK` |
| `apps/frontend/src/views/englishLearning/sidebar/components/DailySession.tsx` | 接入 Header + Actions；双主按钮均为 `daily` 渐变 |
| `apps/frontend/src/views/englishLearning/sidebar/components/LearningToolbar.tsx` | Header + chip 网格 `TOOLBAR_CHIP_GRID` |
| `apps/frontend/src/views/englishLearning/sidebar/components/EnglishSource.tsx` | Header + Actions；JSON 示例可折叠 |
| `apps/frontend/src/views/englishLearning/sidebar/components/FavoriteSession.tsx` | 同上模式 |
| `apps/frontend/src/views/englishLearning/sidebar/components/ReviewSession.tsx` | 同上模式 |
| `apps/frontend/src/views/englishLearning/sidebar/components/MistakeBookSession.tsx` | 同上模式 |
| `apps/frontend/src/views/englishLearning/sections/vocabulary/index.tsx` | 包进 `SidebarPanel`；表单与按钮用 token |
| `apps/frontend/src/views/englishLearning/sections/classic/index.tsx` | 同上 |
| `apps/frontend/src/views/englishLearning/daily/components/DailyWordsPerRoundPicker.tsx` | 与侧栏间距微调 |
| `apps/frontend/src/views/englishLearning/index.tsx` | `aside` 增加 `border-r border-theme/5` |

## 3. 实现思路

1. **Token 优先、少造组件**：卡片与按钮类名集中在 `tokens.ts`，避免各 Session 复制 Tailwind 字符串；色相仍读 `sidebarAccents.ts`，与既有渐变 key 对齐。
2. **SidebarPanel 作唯一卡片壳**：所有侧栏区块（含 `sections/vocabulary` / `classic` 拉取表单）外包一层 `SidebarPanel`，保证 `rounded-md border border-theme/5 bg-theme/5 p-4` 一致。
3. **EnglishSidebarHeader / Actions 拆分**：Header 负责左侧 40px 图标盒 + 标题描述；Actions 将 `EnglishSidebarAction[]` 映射为 `Button`，`variant: 'secondary'` 走描边次按钮，默认走 `SIDEBAR_BTN_PRIMARY_BASE` + 渐变。
4. **快捷意图网格**：`grid-cols-2` 为基线；在 `@container` 且宽度 ≥ 22rem 时用 `auto-fill` 多列，避免展开后芯片竖排成一列。
5. **导入示例折叠**：`EnglishSource` 内 `exampleExpanded` 默认 `false`；label 带 `CircleChevronRight/Down`，文案在展开/收起 i18n 键间切换，减少首屏信息密度。
6. **与持久化无冲突**：主题、词数、意图镜像仍在 `EnglishPackStore` / `englishAgentStore`；本轮仅改展示层，数据流不变。

## 4. 关键代码与注释

### 4.1 布局 token

**来源**：`apps/frontend/src/views/englishLearning/sidebar/tokens.ts`（约 L1–L30）

```typescript
/** 说明：侧栏统一卡片 — 与 Agent/知识库侧栏对齐的细边框 + 浅底 */
export const SIDEBAR_CARD =
	'rounded-md border border-theme/5 bg-theme/5 p-4';

/** 说明：侧栏纵向栈 — 区块间距略大于卡片内间距，形成层次 */
export const SIDEBAR_SECTION_STACK = 'flex flex-col gap-4.5';

/** 说明：主按钮骨架；具体色相由 sidebarAccents.ENGLISH_SIDEBAR_BTN_GRADIENT[key] 叠加 */
export const SIDEBAR_BTN_PRIMARY_BASE =
	'h-9 min-w-0 flex-1 gap-2 rounded-md px-3 text-sm text-white';

/** 说明：按钮组统一 gap-3，词数预设行与 Actions 行共用 SIDEBAR_BTN_GAP */
export const SIDEBAR_BTN_GAP = 'gap-3';
```

### 4.2 统一按钮行

**来源**：`apps/frontend/src/views/englishLearning/sidebar/components/EnglishSidebarActions.tsx`（约 L25–L56）

```typescript
export function EnglishSidebarActions({ actions, className }: EnglishSidebarActionsProps) {
	return (
		<div className={cn(SIDEBAR_ACTIONS_ROW, 'mt-3', className)}>
			{actions.map((action, index) => {
				const isSecondary = action.variant === 'secondary';
				return (
					<Button
						key={index}
						type="button"
						size="sm"
						disabled={action.disabled}
						className={cn(
							// 说明：次按钮 — 描边 + 主题浅底，用于非主路径操作
							isSecondary
								? SIDEBAR_BTN_SECONDARY
								: cn(
										SIDEBAR_BTN_PRIMARY_BASE,
										// 说明：primary 必须带 gradientKey，否则只有白字无背景渐变
										action.gradientKey &&
											ENGLISH_SIDEBAR_BTN_GRADIENT[action.gradientKey],
									),
							action.className,
						)}
						onClick={action.onClick}
					>
						{action.label}
					</Button>
				);
			})}
		</div>
	);
}
```

### 4.3 快捷意图 chip 网格

**来源**：`apps/frontend/src/views/englishLearning/sidebar/components/LearningToolbar.tsx`（约 L76–L80）

```typescript
/** 说明：默认双列；容器足够宽时 auto-fill，避免展开意图列表后单列竖排 */
const TOOLBAR_CHIP_GRID = cn(
	'grid min-w-0 grid-cols-2',
	SIDEBAR_BTN_GAP,
	'@min-[22rem]:grid-cols-[repeat(auto-fill,minmax(min(100%,7.25rem),1fr))]',
);
```

### 4.4 词库导入示例折叠

**来源**：`apps/frontend/src/views/englishLearning/sidebar/components/EnglishSource.tsx`（约 L70–L79、L96–L100）

```typescript
// 说明：默认收起 JSON 示例，降低首屏噪音
const [exampleExpanded, setExampleExpanded] = useState(false);
const exampleLabel = exampleExpanded
	? exampleLabelExpanded   // i18n：收起导入示例
	: exampleLabelCollapsed; // i18n：展开导入示例

// 说明：label 为 button，点击切换展开；右侧 Chevron 指示状态
<button
	type="button"
	className={cn(SIDEBAR_LABEL, 'inline-flex ...')}
	onClick={() => setExampleExpanded((v) => !v)}
>
	{exampleExpanded ? <CircleChevronDown /> : <CircleChevronRight />}
	{exampleLabel}
</button>
```

### 4.5 首页 aside 分隔线

**来源**：`apps/frontend/src/views/englishLearning/index.tsx`（约 L115–L117）

```typescript
<aside
	className={cn(
		// 说明：与右侧 Agent 面板视觉分隔，与卡片 border-theme/5 同一色系
		'flex h-full min-h-0 min-w-0 flex-col overflow-hidden border-r border-theme/5 bg-theme-background',
		// ...
	)}
>
```

## 5. 兼容性与影响

| 维度 | 说明 |
|------|------|
| 行为 | 无 API / Store 字段变更；路由与导航路径不变 |
| 破坏性 | 无；仅 className 与组件结构收敛 |
| 回归建议 | 窄/宽侧栏下快捷意图展开布局；各 Session 主按钮禁用态；导入示例展开滚动；词包/经典句拉取与历史删除弹窗 |
| 无障碍 | Header 图标 `aria-hidden`；词数输入仍带 `aria-describedby` hint |

## 6. 后续可做

- **首屏三卡铺满**：在 `ScrollArea` 内对「今日记词 + 快捷意图 + 单词库」使用 `flex-1` 分区或固定 `min-h` 链，需与 `scroll-area` 内层 `min-h-full` 联调（避免 `min-h-0 flex-1` 误压扁内容）。
- **语句库卡片 stretch**：若单词库拉伸落地，可对 `EnglishSource type="classic"` 对称处理。

## 7. 相关源码路径

| 说明 | 路径 |
|------|------|
| Token | `apps/frontend/src/views/englishLearning/sidebar/tokens.ts` |
| 色相表 | `apps/frontend/src/views/englishLearning/sidebar/sidebarAccents.ts` |
| 侧栏组装 | `apps/frontend/src/views/englishLearning/sidebar/EnglishLearningSidebar.tsx` |
| 布局入口 | `apps/frontend/src/views/englishLearning/index.tsx` |

若与仓库最新源码不一致，以源码为准。
