# Monaco Markdown 底部操作栏：快捷键（⌘+1…⌘+0）、Tooltip 展示与组件封装

> 本文从 `docs/monaco/Markdown编辑器右键菜单.md` 拆分而来：  
> 右键菜单文档聚焦“ContextMenu + Monaco 注入 + 知识库助手选区”；  
> 底部操作栏（Bottom Bar）属于独立 UI/快捷键体系，单独维护更清晰。

---

## 1. 目标与约束（必须同时满足）

- **目标 1：按顺序绑定快捷键**  
  底部操作栏从左到右依次绑定：**⌘+1、⌘+2 … ⌘+9、⌘+0**；另有一条独立 chord（默认 **⌘ + -**，即 `Meta + -`）用于 **复位操作栏拖动后的初始位置**（与最右侧「复位」按钮同逻辑，见 §9.9.3）。

- **目标 2：支持系统设置自定义**  
  用户在系统设置里改了 chord 后，知识库页面无需刷新即可生效。

- **目标 3：不影响现有功能与布局**  
  只增加快捷键/提示与组件拆分，不改变既有按钮行为、可用性条件与布局结构。

- **目标 4：不干扰其它输入框**  
  当用户在页面其它输入框（`input/textarea/contenteditable`）里输入时，不抢占快捷键。

---

## 2. 系统设置：按顺序新增 10 个快捷键项 + 复位 1 项（仅页面内生效）

文件：`apps/frontend/src/views/setting/system/config.ts`

要点：

- **`registerGlobally: false`**：只写入 store，由页面内监听，不占用系统全局快捷键。
- **label 体现顺序与含义**：确保设置页展示清晰，并与底部操作栏顺序一致。

```typescript
// apps/frontend/src/views/setting/system/config.ts（节选）
{
  label: '知识库：操作栏：编辑源码（⌘+1）', // 设置页展示标题：强调“知识库/操作栏/顺序”
  key: KNOWLEDGE_SHORTCUT_KEY_IDS.markdownBarAction1, // 存储 key id：决定写入 store 的键名 `shortcut_${key}`
  defaultShortcut: KNOWLEDGE_SHORTCUT_DEFAULT_CHORDS.markdownBarAction1, // 默认 chord：未设置时回落（示例：Meta + 1）
  action: 'knowledge_markdown_bar_action_1', // 设置页分组/可读性字段：不直接参与运行时匹配
  registerGlobally: false, // 关键：仅页面内生效（不走 Tauri 注册全局快捷键）
}, // 一条设置项结束
// ...依次添加 markdownBarAction2...markdownBarAction9（省略中间项，保持顺序与底部栏一致）
{
  label: '知识库：操作栏：开关自动保存（⌘+0）', // 0 对应 Digit0：仍保持“按顺序”的最后一项
  key: KNOWLEDGE_SHORTCUT_KEY_IDS.markdownBarAction0, // 存储 key id：决定写入 store 的键名 `shortcut_${key}`
  defaultShortcut: KNOWLEDGE_SHORTCUT_DEFAULT_CHORDS.markdownBarAction0, // 默认 chord：未设置时回落（示例：Meta + 0）
  action: 'knowledge_markdown_bar_action_0', // 设置页分组/可读性字段：不直接参与运行时匹配
  registerGlobally: false, // 关键：仅页面内生效（不走 Tauri 注册全局快捷键）
}, // 一条设置项结束
{
  label: '知识库：操作栏：复位初始位置', // 与按钮「复位操作栏初始位置」语义一致
  key: KNOWLEDGE_SHORTCUT_KEY_IDS.markdownBarResetPosition, // 存储 key：shortcut_22
  defaultShortcut: KNOWLEDGE_SHORTCUT_DEFAULT_CHORDS.markdownBarResetPosition, // 默认 Meta + -（Command + -）
  action: 'knowledge_markdown_bar_reset_position', // 可读性字段
  registerGlobally: false, // 仅页面内：与 ⌘+数字 项一致
},
```

---

## 3. 快捷键存储与读取：`knowledge-shortcuts.ts`

文件：`apps/frontend/src/utils/knowledge-shortcuts.ts`

要点：

- 新增 10 个 key id：`markdownBarAction1`…`markdownBarAction0`
- 新增 1 个 key id：`markdownBarResetPosition`（`22` / `shortcut_22`）
- 新增默认 chord：`Meta + 1`…`Meta + 0`；复位默认 **`Meta + -`**
- 扩展 `loadKnowledgeShortcutChords()` 的返回值，能从 store 读取用户自定义值，未配置则回落默认

```typescript
// apps/frontend/src/utils/knowledge-shortcuts.ts（节选）
export const KNOWLEDGE_SHORTCUT_KEY_IDS = {
	// ...已有其它知识库快捷键（省略）                                         // 说明：与系统设置 `shortcut_${key}` 共用同一套存储方式
	markdownBarAction1: 12, // ⌘+1：底部操作栏第 1 个按钮的快捷键 key id
	markdownBarAction2: 13, // ⌘+2：底部操作栏第 2 个按钮的快捷键 key id
	markdownBarAction3: 14, // ⌘+3：底部操作栏第 3 个按钮的快捷键 key id
	markdownBarAction4: 15, // ⌘+4：底部操作栏第 4 个按钮的快捷键 key id
	markdownBarAction5: 16, // ⌘+5：底部操作栏第 5 个按钮的快捷键 key id
	markdownBarAction6: 17, // ⌘+6：底部操作栏第 6 个按钮的快捷键 key id
	markdownBarAction7: 18, // ⌘+7：底部操作栏第 7 个按钮的快捷键 key id
	markdownBarAction8: 19, // ⌘+8：底部操作栏第 8 个按钮的快捷键 key id
	markdownBarAction9: 20, // ⌘+9：底部操作栏第 9 个按钮的快捷键 key id
	markdownBarAction0: 21, // ⌘+0：底部操作栏第 10 个按钮的快捷键 key id
	markdownBarResetPosition: 22, // 复位拖动位置：store shortcut_22，默认 Meta + -
} as const;

export const KNOWLEDGE_SHORTCUT_DEFAULT_CHORDS = {
	// ...已有其它知识库默认 chord（省略）                                      // 说明：实际匹配由 chordMatchesStored 解析
	markdownBarAction1: "Meta + 1", // 默认 ⌘+1（macOS：Meta=⌘；其它平台：展示层可映射为 Ctrl）
	markdownBarAction2: "Meta + 2", // 默认 ⌘+2
	markdownBarAction3: "Meta + 3", // 默认 ⌘+3
	markdownBarAction4: "Meta + 4", // 默认 ⌘+4
	markdownBarAction5: "Meta + 5", // 默认 ⌘+5
	markdownBarAction6: "Meta + 6", // 默认 ⌘+6
	markdownBarAction7: "Meta + 7", // 默认 ⌘+7
	markdownBarAction8: "Meta + 8", // 默认 ⌘+8
	markdownBarAction9: "Meta + 9", // 默认 ⌘+9
	markdownBarAction0: "Meta + 0", // 默认 ⌘+0
	markdownBarResetPosition: "Meta + -", // 默认 Command（Meta）+ 减号：复位操作栏位置
} as const;
```

**主键 `-` 的匹配兜底（`eventKeyMatchesChord`）**：解析后的主键为小写 `'-'` 时，除 `e.key` 外还用 `e.code === 'Minus'` 或 `NumpadSubtract` 比对，避免部分环境下组合键下 `e.key` 不稳定导致快捷键失灵（实现见 `knowledge-shortcuts.ts`）。

---

## 4. 运行时绑定：公共 hook `useMarkdownBottomBarShortcuts`

文件：`apps/frontend/src/hooks/useMarkdownBottomBarShortcuts.ts`

### 4.1 为什么要抽 hook

底部操作栏快捷键包含 3 类逻辑，放在 `Monaco/index.tsx` 会让组件进一步膨胀：

- **读取/热更新 chord**（监听设置页变更事件）
- **window keydown 捕获**（保证“刚进入页面也可用”）
- **动作分发与可用性约束**（Diff/助手/跟随滚动/保存开关等）

抽成 hook 后，底部操作栏组件只需要提供“当前状态 + 回调”，即可完成快捷键绑定，降低耦合。

### 4.1.1 组件可移植改造：hook 不再直接依赖项目快捷键实现

随着组件通用化要求提升，`useMarkdownBottomBarShortcuts` 做了一个关键改造：**把 chord 的来源与匹配逻辑从 hook 内部移出**，改为由宿主通过 `shortcutSource` 注入（见 §4.2）。

这样 `Monaco` 组件可以：

- 在本项目继续使用知识库的快捷键 store（由知识库页注入）
- 在其它项目替换为任意配置中心/本地存储/远端策略

### 4.2 chord 的热更新策略（组件可移植：由外部注入数据源）

为保证 `Monaco` 组件可在其它项目直接复用，hook 不再直接依赖“知识库快捷键存储实现”，而是通过入参注入一个 `ShortcutSource`（数据源）：

- **`shortcutSource.defaultChords`**：首次渲染的默认 chord（用于 Tooltip 展示兜底）
- **`shortcutSource.loadChords()`**：异步加载用户自定义 chord（可返回部分字段覆盖默认）
- **`shortcutSource.subscribeChordsChanged()`**：订阅热更新（例如“设置页保存后派发事件”）
- **`shortcutSource.chordMatchesStored()`**：键位匹配逻辑（不同项目可能解析规则不同）

若不传 `shortcutSource`，hook 内部会使用一个 **空数据源**（全部 chord 为空、永不命中），效果是：

- UI 仍可用（按钮可点）
- 但不会注册任何底部栏快捷键（避免组件在未知项目里“误绑定”）

```typescript
// apps/frontend/src/hooks/useMarkdownBottomBarShortcuts.ts（节选，逐行中文注释）

export type ShortcutSource = {
  defaultChords: MarkdownBottomBarChords; // 1) 默认 chords：首次渲染兜底
  loadChords: () => Promise<Partial<MarkdownBottomBarChords> | null | undefined>; // 2) 加载 chords：可部分覆盖
  subscribeChordsChanged: (onChange: () => void) => () => void; // 3) 热更新订阅：返回取消订阅
  chordMatchesStored: (stored: string | undefined, e: KeyboardEvent) => boolean; // 4) 命中判定：交给外部实现
};

// 5) 内置空数据源：不注入时不注册快捷键（但 UI 仍可点）
const EMPTY_MARKDOWN_BOTTOM_BAR_SHORTCUT_SOURCE: ShortcutSource = {
  defaultChords: {
    toggleMarkdownBottomBar: '',
    markdownBarAction1: '',
    markdownBarAction2: '',
    markdownBarAction3: '',
    markdownBarAction4: '',
    markdownBarAction5: '',
    markdownBarAction6: '',
    markdownBarAction7: '',
    markdownBarAction8: '',
    markdownBarAction9: '',
    markdownBarAction0: '',
    markdownBarResetPosition: '',
  },
  loadChords: async () => null, // 6) 不加载
  subscribeChordsChanged: () => () => {}, // 7) 不订阅
  chordMatchesStored: () => false, // 8) 永不命中
};

// 9) 运行时选择：优先用外部注入；否则回落空数据源
const shortcutSource = shortcutSourceProp ?? EMPTY_MARKDOWN_BOTTOM_BAR_SHORTCUT_SOURCE;

// 10) chords state：用于 Tooltip 展示 + keydown 匹配的同一份来源（保持一致）
const [chords, setChords] = useState(() => shortcutSource.defaultChords);

useEffect(() => {
  let disposed = false;
  const load = async () => {
    const c = await shortcutSource.loadChords(); // 11) 外部加载：例如 localStorage / remote config
    if (disposed) return;
    if (!c) return;
    setChords((prev) => ({ ...prev, ...c })); // 12) 只覆盖有值的字段：不破坏默认兜底
  };
  void load(); // 13) 首次加载：保证一进入页面就展示/生效用户设置

  const unsubscribe = shortcutSource.subscribeChordsChanged(() => {
    void load(); // 14) 热更新：外部通知变更后重新 load
  });

  return () => {
    disposed = true;
    unsubscribe?.(); // 15) 清理：避免重复订阅
  };
}, [shortcutSource]);
```

**知识库页如何注入（示例）**：见 `apps/frontend/src/views/knowledge/index.tsx`，它用 `loadKnowledgeShortcutChords()` + `KNOWLEDGE_SHORTCUTS_CHANGED_EVENT` 构造 `shortcutSource` 并传给 `MarkdownEditor`。

### 4.3 keydown 的触发范围策略（避免“开始不生效”）

痛点：如果要求“必须在编辑器 DOM 内触发”，刚进入页面未点击编辑器时快捷键会失效。  
因此采用“更宽松但有保护”的策略：

- 不强制事件必须发生在组件内部
- 但如果目标是**组件外的可编辑输入区域**（`input/textarea/contenteditable`），则直接 return，避免干扰用户输入

```typescript
// apps/frontend/src/hooks/useMarkdownBottomBarShortcuts.ts（节选）
const target = e.target as HTMLElement | null; // 当前事件目标：用于判断是否来自输入框
const dom = rootRef.current; // MarkdownEditor 根容器：用于判断“是否在本组件内”
if (!dom) return; // 容器未挂载：不处理（避免空引用）

const tag = (target?.tagName ?? "").toUpperCase(); // 目标标签名：用于识别 input/textarea
const isEditable = // 是否为“可编辑输入区域”
	tag === "INPUT" || // 原生输入框：输入时必须让快捷键让路
	tag === "TEXTAREA" || // 多行输入框：输入时必须让快捷键让路
	Boolean(target?.isContentEditable); // contenteditable：富文本/可编辑区域同样需要保护

// 仅当“在组件外的输入框”输入时才跳过；其余场景允许快捷键生效
// - 好处：刚进入页面未聚焦编辑器也能触发（解决“开始不生效”）
// - 风险控制：不会影响页面其它输入框的输入体验
if (isEditable && !dom.contains(target)) return; // 输入发生在组件外：不处理（避免抢键）
```

---

## 5. Tooltip（tip）展示：显示“当前生效 chord”

要点：

- Tooltip 展示必须跟随用户配置变化（不是写死 `⌘+1`）
- “展示”与“匹配”解耦：展示用 `formatChordForTip`，功能匹配仍用 `chordMatchesStored`

```typescript
// apps/frontend/src/hooks/useMarkdownBottomBarShortcuts.ts（节选）
// 仅用于展示：mac 显示 ⌘/⇧/⌥，其它平台显示 Ctrl/Shift/Alt
export function formatChordForTip(raw: string | undefined | null): string {
	const s = String(raw ?? "").trim(); // 规范化输入：空/undefined 视为无快捷键
	if (!s) return ""; // 无内容：Tooltip 不显示快捷键部分
	// 下方省略：解析 `Meta + Shift + V` 为 token，并映射为平台友好的显示符号            // 设计原则见上文
}
```

---

## 6. 组件封装：`MarkdownBottomBar.tsx` 让底部栏更独立通用

文件：`apps/frontend/src/components/design/Monaco/MarkdownBottomBar.tsx`

封装目标：

- `Monaco/index.tsx` 只负责编辑器本体与大布局；底部栏的 UI/快捷键/提示尽量下沉
- 底部栏仅通过 `state/actions/options/shortcuts` 注入外部依赖，减少参数平铺

### 6.1 快捷键注册迁入组件内部

底部栏组件自己调用 hook 完成：

- chord 加载与热更新
- keydown 监听与动作分发
- Tooltip 展示同一份 chord

```tsx
// apps/frontend/src/components/design/Monaco/MarkdownBottomBar.tsx（节选）
const { chords } = useMarkdownBottomBarShortcuts({
	enabled: shortcuts.enabled, // 是否启用：仅 markdown 且底部栏存在时才注册监听
	rootRef: shortcuts.rootRef, // 根容器：用于“组件外输入框”保护策略
	viewModeRef: shortcuts.viewModeRef, // 视图模式 ref：避免 keydown 闭包滞后
	assistantRightPaneActive, // 右侧是否为助手：影响“跟随滚动”等按钮是否可用
	markdownDiffBottomBarVisible, // Diff 是否可见：影响 ⌘+2 是否可执行
	bottomBarCustomNodeEnabled, // 是否存在自定义节点（如助手）：决定 ⌘+4 是否有意义
	showOverwriteSaveToggle, // 是否展示覆盖保存：决定 ⌘+9 是否可执行
	overwriteSaveEnabled, // 当前覆盖保存开关状态：用于 toggle
	showAutoSaveControls, // 是否展示自动保存控制：决定 ⌘+0 是否可执行
	autoSaveEnabled, // 当前自动保存开关状态：用于 toggle
	focusEditor, // 执行完某些动作后拉回焦点：对齐“点击按钮”的体验
	closeMarkdownAssistant, // 切换视图前关闭助手：保持互斥关系与既有行为
	toggleMarkdownSplitDiffCompare, // Diff 开关：与按钮同源
	toggleMarkdownAssistant, // 助手开关：与按钮同源
	setViewMode, // 切换 edit/preview/split：与按钮同源
	setSplitScrollFollowMode, // 跟随滚动切换：与按钮同源
	onOverwriteSaveEnabledChange, // 覆盖保存开关回调：由外部业务决定含义
	onAutoSaveEnabledChange, // 自动保存开关回调：由外部业务决定含义
});

{
	/* Tooltip 展示与快捷键同源：用同一份 chords，保证用户看到的就是实际生效的按键 */
}
<Tooltip
	content={`编辑源码（${formatChordForTip(chords.markdownBarAction1)}）`}
>
	{/* ...按钮 */}
</Tooltip>;
```

### 6.2 能在组件内部推导的逻辑尽量内部化

例如：

- 是否展示覆盖保存按钮：`Boolean(onOverwriteSaveEnabledChange)`
- 是否展示自动保存控制组：`Boolean(onAutoSaveEnabledChange && onAutoSaveIntervalSecChange)`
- 自动保存间隔 options：由组件内部根据预设与当前 interval 合成（并使用 `useMemo` 避免每次 render 重建）

```tsx
// apps/frontend/src/components/design/Monaco/MarkdownBottomBar.tsx（节选）
const showOverwriteSaveToggle = Boolean(onOverwriteSaveEnabledChange); // 有回调才展示覆盖保存按钮（否则无意义）
const showAutoSaveControls = Boolean(
	onAutoSaveEnabledChange && onAutoSaveIntervalSecChange,
); // 两个回调齐全才展示自动保存控制组

// 仅用于下拉框 option：保持预设 + 当前值（若用户选择了非预设值也能回显）
const autoSaveIntervalOptions = useMemo(() => {
	const presets: number[] = [...KNOWLEDGE_AUTO_SAVE_INTERVAL_PRESETS]; // 复制预设：避免直接 mutate 常量
	if (!presets.includes(autoSaveIntervalSec)) presets.push(autoSaveIntervalSec); // 当前值非预设：追加以便下拉回显
	return presets.sort((a, b) => a - b); // 排序：从小到大显示
}, [autoSaveIntervalSec]); // 仅当 interval 改变时重算：减少无谓计算
```

这样 `Monaco/index.tsx` 就不需要维护这些底部栏细节，从而让底部栏组件更独立、更通用。

---

## 7. 相关文件索引

| 文件                                                               | 说明                                                                                                                                                  |
| ------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/frontend/src/views/setting/system/config.ts`                 | 系统设置：底部操作栏 ⌘+1…⌘+0（10 项）+ 复位初始位置（1 项，默认 `Meta + -`），均页面内生效                                                            |
| `apps/frontend/src/utils/knowledge-shortcuts.ts`                   | key id（含 `markdownBarResetPosition` / `shortcut_22`）、默认 chord、`loadKnowledgeShortcutChords` 扩展；`eventKeyMatchesChord` 对 `-` / `Minus` 兜底 |
| `apps/frontend/src/hooks/useMarkdownBottomBarShortcuts.ts`         | 底部操作栏快捷键 hook：通过 `shortcutSource` 注入 chord 数据源/热更新/匹配逻辑；支持“不注入则不注册快捷键”（含复位）                                   |
| `apps/frontend/src/components/design/Monaco/MarkdownBottomBar.tsx` | 底部操作栏 UI + Tooltip + 拖动 / 淡显隐 / 边界夹紧 / 复位按钮与快捷键装配（见 §9、§9.9、§9.9.3）                                                      |
| `apps/frontend/src/components/design/Monaco/index.tsx`             | 装配 `MarkdownBottomBar`（传入最小必要上下文）                                                                                                        |

---

## 8. 预览 / 分屏：选中态下再次点击（或快捷键）退出，并回到「编辑源码」

### 8.1 需求与行为约定

- **预览（preview）**：当 `viewMode === 'preview'` 时，用户再次点击「预览」按钮或触发 `markdownBarAction3`（默认 ⌘+3）→ 退出预览，**默认回到 `edit`（编辑源码）**，并 `focusEditor` 与「编辑源码」按钮一致。
- **分屏（split，左编右预览）**：仅当底部栏上该 Tab **处于选中高亮** 时才算「已选中」。高亮条件与 UI 一致：`viewMode === 'split' && !assistantRightPaneActive`（右侧为 Markdown 预览而非 AI 助手）。此时再次点击「分屏」或触发 `markdownBarAction5`（默认 ⌘+5）→ **回到 `edit`**，并 `focusEditor`。
- **分屏 + AI 助手**：`viewMode` 可能仍为 `split`，但 `assistantRightPaneActive === true` 时，分屏 Tab **不高亮**。此时点击「分屏」的语义仍是「关闭助手并进入左编右预览」，**不应**被误判为「退出纯分屏」；因此必须在 **`closeMarkdownAssistant()` 之前** 计算是否「纯分屏」，否则同一事件循环内助手状态尚未更新，会把「分屏+助手」误判成可退出态。

### 8.2 实现位置

| 位置                               | 职责                                                       |
| ---------------------------------- | ---------------------------------------------------------- |
| `MarkdownBottomBar.tsx`            | 预览 / 分屏按钮 `onClick`                                  |
| `useMarkdownBottomBarShortcuts.ts` | `markdownBarAction3` / `markdownBarAction5` 与按钮行为对齐 |

### 8.3 预览：按钮与快捷键（节选）

预览分支始终先 `closeMarkdownAssistant()`，再按当前 `viewMode` / `viewModeRef` 分支：

```tsx
// apps/frontend/src/components/design/Monaco/MarkdownBottomBar.tsx（预览按钮 onClick 节选）
onClick={() => {
  closeMarkdownAssistant(); // 与其它视图切换一致：先关右侧助手，避免互斥状态残留
  if (viewMode === 'preview') {
    // 已在预览：再次点击视为「关闭预览」，回到单栏编辑并聚焦编辑器
    setViewMode('edit');
    queueMicrotask(focusEditor); // 与「编辑源码」按钮一致：微任务后聚焦，避免与本次点击焦点冲突
  } else {
    setViewMode('preview'); // 非预览：进入预览（行为与改动前一致）
  }
}}
```

```typescript
// apps/frontend/src/hooks/useMarkdownBottomBarShortcuts.ts（markdownBarAction3 节选）
if (hit(chords.markdownBarAction3)) {
	e.preventDefault();
	e.stopPropagation();
	closeMarkdownAssistant();
	// 使用 viewModeRef：避免 keydown 回调闭包读到过期的 viewMode
	if (viewModeRef.current === "preview") {
		setViewMode("edit");
		queueMicrotask(focusEditor);
	} else {
		setViewMode("preview");
	}
	return;
}
```

### 8.4 分屏：按钮（必须在关助手前判断）

```tsx
// apps/frontend/src/components/design/Monaco/MarkdownBottomBar.tsx（分屏按钮 onClick 节选）
onClick={() => {
  // 需在关闭助手前判断：否则同一次点击内 assistant 仍为 true，会误判为「非纯分屏」
  const exitPureSplit = viewMode === 'split' && !assistantRightPaneActive;
  closeMarkdownAssistant();
  if (exitPureSplit) {
    setViewMode('edit');
    queueMicrotask(focusEditor);
  } else {
    setViewMode('split');
    queueMicrotask(focusEditor);
  }
}}
```

### 8.5 分屏：快捷键（与按钮同一判定顺序）

快捷键处理函数里 `assistantRightPaneActive` 来自 hook 入参（最近一次 render），与「在 `closeMarkdownAssistant` 之前读取」组合使用，语义与点击一致：

```typescript
// apps/frontend/src/hooks/useMarkdownBottomBarShortcuts.ts（markdownBarAction5 节选）
if (hit(chords.markdownBarAction5)) {
	e.preventDefault();
	e.stopPropagation();
	// 与底部栏点击一致：在关闭助手前读取，避免闭包内 assistant 状态滞后
	const exitPureSplit =
		viewModeRef.current === "split" && !assistantRightPaneActive;
	closeMarkdownAssistant();
	if (exitPureSplit) {
		setViewMode("edit");
		queueMicrotask(focusEditor);
	} else {
		setViewMode("split");
		queueMicrotask(focusEditor);
	}
	return;
}
```

### 8.6 未改动的相关语义（便于回归对照）

- **编辑源码（⌘+1）**、**Diff（⌘+2）**、**助手（⌘+4）**、**跟滚（⌘+6/7/8）** 等行为与本节改动无关。
- **`splitDiff`** 与预览/分屏的互斥、进入退出逻辑仍在 `Monaco/index.tsx` 中维护；本节仅在「已是 preview / 已是纯 split」时增加「第二次触发 → edit」分支。

---

## 9. 拖动位置、边界夹紧、宽度与「当前位置淡显隐」

本节记录 **Markdown 底部操作栏** 在拖动、布局约束与显隐方式上的实现思路；代码与注释以仓库当前实现为准。

### 9.1 设计目标（约束）

| 目标             | 说明                                                                                                                                     |
| ---------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| 可拖动           | 用户可调整操作栏在编辑器容器内的水平/垂直偏移，且不越出 `Monaco/index.tsx` 中 `rootRef` 所指的 `relative overflow-hidden` 根容器。       |
| 不影响既有交互   | 通过 **专用拖动手柄（Grip）** 发起拖动，避免与 Tab/按钮的 `click` 抢事件。                                                               |
| 宽度与改动前一致 | 外层保持 **`max-w-2xl`**，且 **不使用** 外层 `w-full` 拉满后再裁切，宽度语义与引入拖动前「内容 + 上限」一致。                            |
| 距底与水平锚定   | 使用 **`bottom: 0` + `left: 50%` + `-translate-x-1/2` + `-translate-y-[10px]`** 固定「距底约 10px + 水平居中」的基准（与产品约定对齐）。 |
| 显隐             | **在当前位置** 用 **透明度** 淡入淡出，不再用「整栏下移到底部」类 `translate-y` 隐藏；拖动后的 **像素偏移在收起前后保持不变**。          |

### 9.2 DOM 分层与 transform 职责拆分

- **外层 `role="toolbar"`**：负责绝对定位、水平居中、距底 10px 的 **CSS translate**，以及 **`opacity` / `pointer-events` / `aria-hidden`** 控制显隐与无障碍。
- **中间层 `dragLayerRef`**：仅承载用户拖动的 **`translate(xpx, ypx)`**；用 `getBoundingClientRect()` 与 `rootRef` 做夹紧时量的是这一层，与外层基准位移解耦。
- **无偏移时不写 `transform`**：`dragOffset === (0,0)` 时省略内联 `transform`，减少与「仅外层 translate」等价的合成层差异。

### 9.3 水平夹紧与 ResizeObserver（不在挂载瞬间强行 snap）

- 函数 **`snapMarkdownBottomBarOffset`** 只做 **水平 dx** 修正，**不改 y**：垂直基准由外层 `-translate-y-[10px]` 与用户拖动 `y` 共同决定；若在 Resize 回调里再改 y，易与「距底 10px」冲突。
- 使用 **`SNAP_RECT_EPS_PX`**（1px）容差，减轻子像素取整导致的假「溢出」。
- **`ResizeObserver` 监听 `rootRef`**：仅在容器尺寸变化时调用 `runSnap`；**不在** `open` 后首帧同步 `runSnap()`，避免首帧把 `(0,0)` 推开。

### 9.4 拖动手势与边界（指针事件）

- **`pointerdown`** 仅在手柄上；记录 `barRect0`（拖动起点栏位矩形）、指针 `sx/sy`、当前偏移 `ox/oy`。
- **`pointermove`**（`capture: true` 挂在 `window`）：用 **相对起点的屏幕位移** 与 **当前 root 的 `getBoundingClientRect()`** 计算 `minDx/maxDx`、`minDy/maxDy`，把位移夹紧后再 `setDragOffset`。
- **`openRef`**：收起后若仍有迟到的 `pointermove`，直接 return，避免在 `open === false` 时写回状态。
- **`dragPointerCleanupRef`**：`open` 变为 `false` 时在 `useLayoutEffect` 里调用保存的 `end`，移除监听并清空 gesture，与 **淡隐** 配合，避免隐藏过程中仍更新偏移。

### 9.5 显隐：当前位置淡入淡出（替代底部滑出）

- 展开：`opacity-100` + `pointer-events-auto`。
- 收起：`opacity-0` + `pointer-events-none` + `aria-hidden={!open}`。
- **`transition-opacity duration-300`**，并保留 **`motion-reduce`** 下关闭过渡。
- **不再**在收起时把 `dragOffset` 清零（曾用于配合「下移隐藏」与子层 `translate` 的合成）；淡隐后栏仍在同一几何位置，仅不可见、不可点。

### 9.6 其它控件（Diff / 自动保存等）

- **分屏对照（GitCompare）**、自动保存等分支的 Tooltip、`disabled` 与条件渲染以当前 `MarkdownBottomBar.tsx` 为准；与 §9 拖动/淡显隐逻辑正交。

### 9.7 关键实现代码（节选）

**水平夹紧（仅 x）与 1px 容差：**

```typescript
// apps/frontend/src/components/design/Monaco/MarkdownBottomBar.tsx（节选）

/** 子像素取整容差：避免误判「溢出」导致初始 (0,0) 被推开 */
const SNAP_RECT_EPS_PX = 1;

/**
 * 单次将底部栏（已应用 drag transform）在水平方向约束在 root 内。
 * 垂直位置由外层 bottom + translate-y 与用户拖动 translateY 负责，此处不改 y。
 */
function snapMarkdownBottomBarOffset(
	rootEl: HTMLElement,
	barEl: HTMLElement,
	prev: { x: number; y: number },
): { x: number; y: number } {
	const rootRect = rootEl.getBoundingClientRect();
	const barRect = barEl.getBoundingClientRect();
	let dx = 0;
	if (barRect.left + SNAP_RECT_EPS_PX < rootRect.left)
		dx = rootRect.left - barRect.left;
	else if (barRect.right - SNAP_RECT_EPS_PX > rootRect.right)
		dx = rootRect.right - barRect.right;
	if (dx === 0) return prev;
	return { x: prev.x + dx, y: prev.y };
}
```

**收起时打断拖动；仅 root 尺寸变化时水平夹紧：**

```typescript
// apps/frontend/src/components/design/Monaco/MarkdownBottomBar.tsx（节选）

/** 淡隐时结束拖动：避免 open=false 后 onMove 仍更新偏移 */
useLayoutEffect(() => {
	if (!open) {
		dragPointerCleanupRef.current?.();
		dragPointerCleanupRef.current = null;
		dragGestureRef.current = { active: false };
	}
}, [open]);

useLayoutEffect(() => {
	if (!open) return;
	const rootEl = rootRef.current;
	const barEl = dragLayerRef.current;
	if (!rootEl || !barEl) return;
	const runSnap = () => {
		setDragOffset((prev) => snapMarkdownBottomBarOffset(rootEl, barEl, prev));
	};
	const ro = new ResizeObserver(() => {
		runSnap();
	});
	ro.observe(rootEl);
	return () => ro.disconnect();
}, [open, rootRef]);
```

**指针拖动与夹紧（节选）：**

```typescript
// apps/frontend/src/components/design/Monaco/MarkdownBottomBar.tsx（onPointerDown / onMove 节选）

const onMove = (ev: PointerEvent) => {
	if (!openRef.current) return;
	const g = dragGestureRef.current;
	if (!g.active) return;
	const rootRect = g.rootEl.getBoundingClientRect();
	const ddx = ev.clientX - g.sx;
	const ddy = ev.clientY - g.sy;
	const minDx = rootRect.left - g.barRect0.left;
	const maxDx = rootRect.right - g.barRect0.right;
	const minDy = rootRect.top - g.barRect0.top;
	const maxDy = rootRect.bottom - g.barRect0.bottom;
	const cdx = Math.min(maxDx, Math.max(minDx, ddx));
	const cdy = Math.min(maxDy, Math.max(minDy, ddy));
	setDragOffset({ x: g.ox + cdx, y: g.oy + cdy });
};
```

**外层定位 + 淡显隐 + 拖动层 transform：**

```tsx
// apps/frontend/src/components/design/Monaco/MarkdownBottomBar.tsx（return 外层节选）

<div
	id={id}
	role="toolbar"
	aria-label="Markdown 底部操作"
	aria-hidden={!open}
	className={cn(
		// 距底 10px 与水平居中始终不变；显隐仅靠透明度，拖动后的位置保持不变
		"absolute bottom-0 left-1/2 z-30 flex max-w-2xl -translate-x-1/2 -translate-y-[10px] justify-center transition-opacity duration-300 ease-out motion-reduce:transition-none motion-reduce:duration-0",
		open ? "opacity-100 pointer-events-auto" : "opacity-0 pointer-events-none",
	)}
>
	<div
		ref={dragLayerRef}
		className="flex min-w-0 w-full justify-center"
		style={
			dragOffset.x === 0 && dragOffset.y === 0
				? undefined
				: { transform: `translate(${dragOffset.x}px, ${dragOffset.y}px)` }
		}
	>
		{/* 内层 pill：h-10、边框与 Tab 列表等 */}
	</div>
</div>
```

**拖动手柄（节选）：**

```tsx
// apps/frontend/src/components/design/Monaco/MarkdownBottomBar.tsx（手柄节选）

<Tooltip content="拖动调整操作栏位置（不超出编辑器区域）">
	<button
		type="button"
		className={cn("… cursor-grab touch-none … active:cursor-grabbing …")}
		aria-label="拖动底部操作栏位置"
		onPointerDown={onDragHandlePointerDown}
	>
		<GripVertical size={16} strokeWidth={1.75} aria-hidden />
	</button>
</Tooltip>
```

### 9.8 与 `Monaco/index.tsx` 的关系

- 边界与快捷键的「页面内输入保护」仍依赖传入的 **`rootRef`**（编辑器最外层 `relative overflow-hidden` 容器）。
- 不在 `index.tsx` 内维护 `dragOffset`：拖动状态完全局部在 `MarkdownBottomBar`，降低父组件复杂度。

### 9.9 复位操作栏位置（LocateFixed）

#### 9.9.1 需求与实现思路

- **入口**：在底部栏 **最右侧**（覆盖保存、自动保存等控件之后）增加一个图标按钮，语义为「恢复到拖动前的默认位置」。
- **默认位置含义**：`dragOffset === { x: 0, y: 0 }`，即拖动层 **不写** `transform: translate(...)`，仅保留外层 `absolute bottom-0 left-1/2 -translate-x-1/2 -translate-y-[10px]` 的基准布局（居中 + 距底 10px）。
- **为何分两步**：先 `setDragOffset({0,0})` 让 React 提交布局；再在 **`requestAnimationFrame`** 里调用已有的 **`snapMarkdownBottomBarOffset`**。这样在 **极窄编辑器宽度** 下，复位后仍可与 **ResizeObserver** 使用同一套水平夹紧规则，避免栏体超出 `rootRef` 左右边界。
- **不影响其它视图逻辑**：不修改 `viewMode`、助手、自动保存等；仅读写本地 `dragOffset` 状态。复位与 **新增** 的页面内 chord（`markdownBarResetPosition`，默认 `Meta + -`）共用同一 `resetBarPosition` 回调，不改变 ⌘+1…⌘+0 各按钮语义。
- **右侧容器始终渲染**：原先「仅有覆盖保存或自动保存时才渲染右侧整块」改为 **始终渲染右侧 `flex` 容器**，内部对覆盖保存 / 自动保存仍条件渲染；**复位按钮始终存在**，避免知识库等场景无保存控件时找不到复位入口。
- **禁用态**：当 `dragOffset.x === 0 && dragOffset.y === 0` 时 **`disabled`**，并加 `disabled:cursor-not-allowed`、`disabled:opacity-60`，避免无意义点击与误触反馈。
- **图标**：使用 **`LocateFixed`**（lucide），表达「回到既定位置」；Tooltip 展示为「复位操作栏初始位置」+ `formatChordForTip(chords.markdownBarResetPosition)`，与其它操作栏 Tab 的快捷键提示风格一致。

#### 9.9.2 核心代码（含注释）

**复位回调（与 snap 复用）：**

```typescript
// apps/frontend/src/components/design/Monaco/MarkdownBottomBar.tsx（节选）

/**
 * 复位操作栏几何位置：
 * 1) 将拖动层 translate 归零，与「从未拖动」时一致（外层仍是 bottom + 居中 + 距底 10px）。
 * 2) 下一帧再跑水平 snap：与 ResizeObserver 共用 snapMarkdownBottomBarOffset，避免极窄 root 下整栏仍溢出左右。
 */
const resetBarPosition = useCallback(() => {
	// 第一步：立即回到无内层 transform 的状态（见拖动层 style：x、y 均为 0 时不写 transform）
	setDragOffset({ x: 0, y: 0 });
	// 第二步：等浏览器完成上一帧布局后再量 rect，否则 getBoundingClientRect 可能仍对应旧 transform
	requestAnimationFrame(() => {
		const rootEl = rootRef.current; // 与拖动、Resize 夹紧一致：Monaco 外层 relative 容器
		const barEl = dragLayerRef.current; // 带 translate 的测量层，与 snap 约定一致
		if (!rootEl || !barEl) return;
		// 仅修正水平 dx，垂直仍由外层与用户拖动语义负责（见 §9.3）
		setDragOffset((prev) => snapMarkdownBottomBarOffset(rootEl, barEl, prev));
	});
}, []);
```

**最右侧按钮 JSX（节选）：**

```tsx
// apps/frontend/src/components/design/Monaco/MarkdownBottomBar.tsx（右侧栏末尾节选）

<div className="flex shrink-0 items-center gap-1.5 pl-2">
	{/* …覆盖保存、自动保存等条件块… */}

	{/* 最右侧：与覆盖保存/自动保存并列；无业务回调时也会渲染，保证始终可复位 */}
	<Tooltip
		content={`复位操作栏初始位置（${formatChordForTip(chords.markdownBarResetPosition)}）`}
	>
		<button
			type="button"
			className={cn(
				markdownBarIconBtnClass(false),
				// 已在默认位置时禁用，避免无意义点击；样式与其它 disabled 控件对齐
				"disabled:cursor-not-allowed disabled:opacity-60",
			)}
			disabled={dragOffset.x === 0 && dragOffset.y === 0}
			aria-label="复位操作栏位置"
			onClick={resetBarPosition}
		>
			<LocateFixed size={18} strokeWidth={1.75} aria-hidden />
		</button>
	</Tooltip>
</div>
```

#### 9.9.3 快捷键复位（默认 Command（Meta）+ -）

**设计要点**

- **监听在父组件**：快捷键监听收敛在 `Monaco/index.tsx` 的 `useMarkdownBottomBarShortcuts`（与 ⌘+1…⌘+0 等保持一致的统一入口），因此需要父组件能触发子组件内部的 `resetBarPosition`。
- **用 imperative（命令式句柄）桥接**：`MarkdownBottomBar` 内部暴露 `imperativeRef.current.resetMarkdownBottomBarPosition = resetBarPosition`；父组件在命中 chord 后调用该方法，实现“快捷键 → 子组件复位”。
- **仅在子组件存在时才会生效**：当底部操作栏未启用或未挂载时，`markdownBottomBarRef.current` 为空，复位调用自然是 no-op，不会影响其它逻辑。
- **与其它操作栏 chord 一致**：`window` **捕获阶段** `keydown`；命中后 **`preventDefault` + `stopPropagation`**，避免浏览器将 **`Meta + -`** 当作页面缩放等默认行为。
- **与按钮同路径（同实现）**：按钮 `onClick={resetBarPosition}`；快捷键触发则通过 imperative 调用同一个 `resetBarPosition`，不重复实现 snap。
- **存储与默认**：`KNOWLEDGE_SHORTCUT_KEY_IDS.markdownBarResetPosition === 22`（`shortcut_22`），默认 chord **`Meta + -`**；系统设置保存后派发 **`KNOWLEDGE_SHORTCUTS_CHANGED_EVENT`**，与其它知识库页内快捷键一致。

**A) 子组件暴露 imperative 句柄（节选 + 逐行中文注释）**

```tsx
// apps/frontend/src/components/design/Monaco/MarkdownBottomBar.tsx（节选）

useEffect(() => {
	// 1) 父组件若未传 imperativeRef，则不需要对外暴露任何方法
	if (!imperativeRef) return;

	// 2) 把“复位操作栏位置”的能力暴露给父组件（快捷键分发层）
	imperativeRef.current = {
		// 3) 注意：这里直接复用同一个 resetBarPosition（与按钮 onClick 同源）
		resetMarkdownBottomBarPosition: resetBarPosition,
	};

	return () => {
		// 4) 卸载时清空，避免父组件持有陈旧引用
		if (imperativeRef.current) imperativeRef.current = null;
	};
}, [
	imperativeRef, // 5) ref 变化时重新装配
	resetBarPosition, // 6) 复位回调（useCallback）
]);
```

**B) 父组件快捷键命中后调用 imperative（节选 + 逐行中文注释）**

```tsx
// apps/frontend/src/components/design/Monaco/index.tsx（节选）

// 1) 父组件持有底部栏 imperative ref：用于在快捷键命中时触发子组件内部动作
const markdownBottomBarRef = useRef<MarkdownBottomBarImperativeHandle | null>(null);

// 2) 复位动作：通过 ref 调用子组件暴露的方法
const resetBottomBarPosition = useCallback(() => {
	// 3) ref 为空时自然 no-op（例如未启用底部栏或未挂载完成）
	markdownBottomBarRef.current?.resetMarkdownBottomBarPosition();
}, []);

// 4) 快捷键统一在 hook 内监听；复位分支命中后调用 resetBottomBarPosition
useMarkdownBottomBarShortcuts({
	// ...其它参数省略
	resetMarkdownBottomBarPosition: resetBottomBarPosition, // 5) 命中 Meta + - 时会调用它
});

// 6) 装配子组件时把 imperativeRef 传下去，让子组件写入 current
<MarkdownBottomBar imperativeRef={markdownBottomBarRef} /* ...其它 props */ />;
```

**`eventKeyMatchesChord` 对减号主键的兜底（节选 + 中文注释）**

```typescript
// apps/frontend/src/utils/knowledge-shortcuts.ts — eventKeyMatchesChord 内

// 期望主键为 '-'（parseChordString 已将 token 规范为小写）时：除 e.key 外，用物理键码兜底
if (expectedKey === "-" && (code === "Minus" || code === "NumpadSubtract"))
	return true;
```

### 9.10 自定义 `customBottomBarNode`：让业务节点可调用编辑器所有可操作方法（render-prop）

本节记录一次对 `customBottomBarNode` 的增强：在**不破坏现有 `ReactNode` 用法**的前提下，支持把它作为 **render-prop**（函数）传入，从而在业务自定义区域中**直接调用** `Monaco/MarkdownBottomBar` 体系里暴露的全部可操作方法（例如 `focusEditor`、`setViewMode`、`toggleMarkdownSplitDiffCompare`、`toggleMarkdownAssistant`、以及新增的 `resetMarkdownBottomBarPosition` 等），并读取当前状态与快捷键 chord 用于展示。

#### 9.10.1 需求与约束

- **向后兼容**：原先 `customBottomBarNode={<div/>}` 必须完全可用，且渲染行为不变。
- **不影响现有功能**：不能改变底部操作栏原有按钮、快捷键、拖动、Diff、助手等的执行链路；只是额外提供“拿到上下文”的能力。
- **上下文稳定**：传给自定义节点的 actions 必须是底部栏正在使用的那一套（避免出现“按钮能用，自定义节点拿到的是另一个闭包”的分叉）。

#### 9.10.2 设计方案（为何用 render-prop）

`customBottomBarNode` 原本是 `ReactNode`，业务节点只能“展示”，无法获取底部栏内部的 actions/state。

解决方式：把类型升级为联合类型：

- 仍可传 `ReactNode | null`
- 也可传 `(ctx) => ReactNode`

其中 `ctx`（上下文对象）包含：

- `state`：底部栏的运行态（`viewMode`、`splitScrollFollowMode`、`markdownDiffBottomBarVisible`…）
- `actions`：底部栏的可操作方法（`setViewMode`、`focusEditor`…）+ 补充 `resetMarkdownBottomBarPosition`
- `options`：底部栏可用性（例如 `bottomBarAssistantNodeEnabled`）
- `chords`：底部栏快捷键 chord 字符串（用于 Tooltip/展示）

#### 9.10.3 关键实现代码（逐行注释版）

##### A) 类型扩展：`MarkdownBottomBar` 新增上下文类型并支持函数式 `customBottomBarNode`

```tsx
// 文件：apps/frontend/src/components/design/Monaco/MarkdownBottomBar.tsx

// 1) 组件 props：将 customBottomBarNode 从 “只能是 ReactNode” 扩展为 “ReactNode 或 (ctx)=>ReactNode”
//    说明：保留 ReactNode 分支即可保证向后兼容，老代码不需要任何改动。
customBottomBarNode?:
	| React.ReactNode // 旧用法：直接传 JSX 节点
	| null // 显式不渲染
	| ((ctx: MarkdownBottomBarCustomNodeContext) => React.ReactNode); // 新用法：render-prop

// 2) 新增上下文类型：把底部栏已经存在的 state/actions/options/chords 聚合成一份传给业务节点
export type MarkdownBottomBarCustomNodeContext = {
	// 当前底部栏状态：业务可根据 viewMode 等渲染不同按钮/禁用态
	state: MarkdownBottomBarProps['state'];
	// 底部栏 actions：与底部栏内部按钮/快捷键共用同一套回调
	actions: MarkdownBottomBarProps['actions'] & {
		// 补充：复位操作栏位置（与最右侧 LocateFixed 按钮一致）
		resetMarkdownBottomBarPosition: () => void;
	};
	// options：业务可读 bottomBarAssistantNodeEnabled 等可用性
	options: MarkdownBottomBarProps['options'];
	// chords：业务可用于展示快捷键提示（formatChordForTip）
	chords: MarkdownBottomBarChords;
};

// 3) 在组件内部构造 ctx，并将内部 resetBarPosition 注入给业务节点（与按钮/快捷键同路径）
const customNodeCtx = useMemo<MarkdownBottomBarCustomNodeContext>(
	() => ({
		state, // 直接透传当前 state（来自 props）
		actions: { ...actions, resetMarkdownBottomBarPosition: resetBarPosition }, // 注入 reset
		options, // 透传 options
		chords, // 透传 chords（与 Tooltip 同源）
	}),
	[state, actions, options, chords, resetBarPosition], // 依赖变化时更新 ctx
);

// 4) 解析 customBottomBarNode：函数则执行得到 ReactNode；否则按原样渲染
const resolvedCustomBottomBarNode =
	typeof customBottomBarNode === 'function'
		? customBottomBarNode(customNodeCtx) // render-prop：业务拿到 ctx
		: customBottomBarNode; // 旧用法：直接渲染 ReactNode

// 5) 最终渲染：使用 resolvedCustomBottomBarNode，不改变布局结构（仍在右侧容器内）
{resolvedCustomBottomBarNode ?? null}
```

##### B) 入口类型同步：`Monaco/index.tsx` 的 props 同样扩展为 render-prop（不破坏旧用法）

```tsx
// 文件：apps/frontend/src/components/design/Monaco/index.tsx

// 让外部调用方能传函数：这里的类型与 MarkdownBottomBar 一致即可
customBottomBarNode?:
	| React.ReactNode // 旧用法：静态 JSX
	| null // 显式不渲染
	| ((
			// ctx 类型从 MarkdownBottomBar 导出：保证上下文 shape 单一来源，避免拷贝漂移
			ctx: import('./MarkdownBottomBar').MarkdownBottomBarCustomNodeContext,
	  ) => React.ReactNode); // 新用法：render-prop
```

##### C) 业务侧示例：知识页通过 render-prop 调用编辑器 actions（不影响现有功能）

```tsx
// 文件：apps/frontend/src/views/knowledge/index.tsx（节选，示例）

customBottomBarNode={
	// 使用 render-prop：拿到 actions/state/chords/options
	({ actions }) => (
		<div className="flex items-center gap-2 ml-2">
			<button
				type="button"
				aria-label="聚焦编辑器"
				onClick={() => actions.focusEditor()} // 调用底部栏 actions：聚焦编辑器
			>
				{/* 这里仅做示例：实际可替换为任意业务图标 */}
				<NotebookPen size={16} aria-hidden />
			</button>
			<button
				type="button"
				aria-label="复位操作栏位置"
				onClick={() => actions.resetMarkdownBottomBarPosition()} // 调用与「复位」按钮一致的逻辑
			>
				<NotebookPen size={16} aria-hidden />
			</button>
		</div>
	)
}
```

#### 9.10.4 为什么这样不会影响现有功能

- **旧用法保留**：`customBottomBarNode` 仍可传 `ReactNode`，渲染路径不变。
- **不改既有分发**：底部栏按钮、快捷键仍调用 `actions` 与 `resetBarPosition`；render-prop 只是“把同一份 actions 暴露给业务节点”。
- **不引入全局监听**：没有新增任何 `window` 事件监听或快捷键分支，只是类型与渲染增强。
