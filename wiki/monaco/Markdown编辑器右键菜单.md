# Monaco Markdown 编辑器：右键上下文菜单（Design ContextMenu）

## 1. 目标与范围

在 **`apps/frontend/src/components/design/Monaco/index.tsx`**（`MarkdownEditor`）的主编辑区域提供**与快捷键一致**的右键菜单：复制 / 剪切 / 粘贴 / 全选 / 格式化（Markdown 走安全格式化，其它语言走 Monaco 默认格式化）。

**当前接入范围**：

- 纯 **编辑** 视图下的主编器；
- Markdown **分屏** 左侧主编器。

**未接入**（可后续扩展）：

- **分屏 Diff** 右侧的 `DiffEditor`（只读对照，需单独考虑菜单项与模型来源）。

---

## 2. 分层与依赖关系

| 层级 | 路径 | 职责 |
|------|------|------|
| UI 原语 | `apps/frontend/src/components/ui/context-menu.tsx` | Radix（`radix-ui`）+ Tailwind，**单一事实来源**的样式与无障碍行为；**业务与 Monaco 不直接改此文件**。 |
| Design 二次封装 | `apps/frontend/src/components/design/ContextMenu/` | 在 UI 之上 `memo`、声明式 `QuickContextMenu`、`ContextMenuUi` 命名空间导出等，见该目录 `index.tsx` 顶部说明。 |
| Monaco 菜单模块 | `apps/frontend/src/components/design/Monaco/contextMenu.ts` | 菜单项生成（纯函数）+ 动作注入（与 `addCommand` 同源）；把右键菜单从 `index.tsx` 中拆出，便于复用与单点优化。 |
| Monaco 快捷键命令 | `apps/frontend/src/components/design/Monaco/commands.ts` | **集中注册** `editor.addCommand(...)`：把快捷键（格式化/注释/复制/剪切/粘贴/发送选区到助手）从 `index.tsx` 抽离，减少 `onMount` 体积并统一语义。 |
| Monaco 宿主 | `apps/frontend/src/components/design/Monaco/index.tsx` | 用 **`QuickContextMenu`** 包住带 **`editorHostRef`** 的宿主 `div`，菜单 **`items`** 来自 `contextMenu.ts`，`onMount` 通过注入函数绑定动作。 |

依赖方向：**Monaco → Design ContextMenu → UI context-menu**（单向，无循环引用）。

---

## 3. 实现思路（摘要）

1. **关闭 Monaco 内置右键菜单**  
   全局默认已在 **`apps/frontend/src/components/design/Monaco/options.ts`** 中设置 **`contextmenu: false`**，避免与 Radix 菜单抢事件；否则 Monaco 可能 `preventDefault`，外层收不到 `contextmenu`。

2. **动作与快捷键同源**  
   Tauri/WebView 下复制粘贴不可靠，主编器已在 `onMount` 里用 **`editor.addCommand`** 绑定 **Ctrl/⌘+C/X/V**（见 **`monaco/剪贴板全局处理绕过.md`**、**`monaco/无选区剪切行Cmd+X.md`**）。  
   右键项不重复实现业务规则，而是由 **`apps/frontend/src/components/design/Monaco/contextMenu.ts`** 把**同一套闭包逻辑**注入到 **`editorContextActionsRef`**，菜单只调 `ref.current?.copy()` 等。

3. **声明式菜单 + 稳定 `items`**  
   使用 **`QuickContextMenu`** + **`useMemo([readOnly, language])`** 生成 **`editorContextMenuItems`**，只读时隐藏剪切/粘贴/格式化；`onSelect` 内仅调 ref，避免把整份 `handleEditorMount` 拉进 `useMemo` 依赖。

4. **触发区域与布局**  
   **`QuickContextMenu`** 默认 **`triggerAsChild`**：子节点必须是**单个**可合并 props 的元素，此处为带 **`editorHostRef`** 的宿主 **`div`**（与原有 **`ResizeObserver` / `layout` 测量**一致，不额外包一层抢尺寸的 DOM）。

5. **生命周期**  
   在 **`editor.onDidDispose`** 与组件卸载 **`useEffect`** 中将 **`editorContextActionsRef.current = null`**，防止卸载后仍点菜单。

6. **与知识库助手输入框联动（选区→输入框）**  
   为了让知识库场景可以把“编辑器选中的片段”快速塞进右侧助手输入框，本实现增加一个**可选外部回调**：  
   - Monaco 侧只负责：读取**非空选区**、调用回调、并在右键菜单中暴露入口。  
   - 知识库侧负责：如何写入输入框（覆盖/追加/是否自动展开助手）与输入框的受控状态管理。  
   - 知识库页对右键「复制选中内容到助手」可能出现的**同一次操作重复追加**，另有宿主层合并与去重说明，见 **`docs/knowledge/知识编辑器发送选区助手去重.md`**。  
   - 复制到助手后的**自动聚焦**（Radix `onCloseAutoFocus` 拦截 + `focusInputAtEndKey`）见 **`docs/knowledge/助手插入焦点.md`**。

7. **避免“打开助手导致编辑器重载（loading）”**  
   在旧实现里，Markdown `edit ↔ split` 之间渲染了两套不同的 `<Editor />` 分支；当“未开启助手时复制选区 → 自动打开助手”触发 `edit→split`，编辑器会卸载/重挂载，出现明显的 loading。  
   解决方案是：  
   - **保持同一个 Monaco TextModel**：给 `Editor` 传 `keepCurrentModel`，避免卸载时 dispose model。  
   - **保持同一棵面板树**：Markdown 非 preview 模式统一走 `ResizablePanelGroup`，在 `edit` 时把右侧面板布局设为 0，但不从 DOM 树移除（避免重挂载）。  
   - **命令式恢复布局**：`react-resizable-panels` 的 `defaultSize` 只在首次挂载生效，切换回 split 时需要 `groupRef.setLayout(...)` 恢复右侧宽度，否则会出现“右侧无法撑开”。  

---

## 4. 先决条件：`contextmenu: false`

下列为 **`options.ts`** 中与右键相关的片段（合并进 `mergedEditorOptions` 后同样生效）：

```typescript
// apps/frontend/src/components/design/Monaco/options.ts
// 关闭 Monaco 自带右键菜单，便于外层 Radix ContextMenu 接收 `contextmenu` 事件。
//
// 为什么要关：
// - Monaco 内置菜单会抢占右键事件，并可能 `preventDefault`，导致外层 Radix 菜单无法弹出
// - 我们希望“右键菜单动作”与“快捷键动作”同源（统一剪贴板/安全格式化/发送选区到助手）
//
// 影响范围：
// - 只影响编辑器内的右键菜单“显示”，不影响复制/剪切/粘贴等命令本身（命令由 addCommand/注入动作接管）
export const options: any = {
	// ...其它选项
	contextmenu: false,
	// ...
};
```

---

## 5. Monaco 侧：ref + `useMemo` 菜单项

### 5.0 对外接口：`onInsertSelectionToAssistant`

为支持“编辑器选区 → 助手输入框”，`MarkdownEditor` 额外暴露一个可选回调：

```typescript
// apps/frontend/src/components/design/Monaco/index.tsx（节选）
interface MarkdownEditorProps {
	/**
	 * 外部接入：将“编辑器当前选区文本”写入某个输入框（例如知识库助手输入框）。
	 *
	 * 约束：
	 * - 仅处理**非空选区**（不会降级为“复制整行”），避免误把整行/整段塞进对话框。
	 * - 具体写入方式（覆盖/追加、是否聚焦输入框）由外部决定。
	 */
	onInsertSelectionToAssistant?: (text: string) => void;
}
```

该能力本身不依赖知识库模块，**任何宿主**都可传入回调实现“把选区送到任意输入框”。  
知识库接入见本文 **§6**。

### 5.1 `editorContextActionsRef` 与 `editorContextMenuItems`

**设计意图注释**（与源码一致）：

- `editorContextActionsRef`：**onMount 注入**，供右键与快捷键共用。
- `editorContextMenuItems`：**主编辑器右键菜单**，依赖 ref；`readOnly` / `language` 变化时重建列表。

```typescript
// apps/frontend/src/components/design/Monaco/index.tsx（节选）

const editorRef = useRef<MonacoEditorInstance | null>(null);
/** onMount 注入：右键菜单与 Cmd/Ctrl+C/V/X 等同源 */
const editorContextActionsRef = useRef<MonacoEditorContextActions | null>(null);
/** 包裹 Editor 的宿主，用于测量 client 尺寸并显式 layout（Tauri 全屏恢复后避免沿用旧宽度） */
const editorHostRef = useRef<HTMLDivElement | null>(null);

// ...

/** 主编辑器右键菜单（与快捷键逻辑一致，依赖 editorContextActionsRef） */
const editorContextMenuItems = useMemo(
	() =>
		buildMonacoEditorContextMenuItems({
			// 只读模式下：菜单会隐藏剪切/粘贴/格式化等“会修改内容”的条目
			readOnly,
			// 不同语言可能有不同菜单策略（例如 markdown 的安全格式化）
			language,
			// 菜单条目点击时通过 ref 调用动作，避免把 editor 实例塞进 useMemo 依赖导致频繁重建
			actionsRef: editorContextActionsRef,
			// 外部传了回调才展示该菜单项，避免“点了无效果”
			enableSendSelectionToAssistant:
				typeof onInsertSelectionToAssistant === 'function',
		}),
	[readOnly, language],
);
```

### 5.2 `onMount`：注入与 `onDidDispose` 清理

**注释要点**：在 `onMount` 中完成两件事，并保持顺序清晰：

- **先注入右键动作**：`injectMonacoEditorContextActions(...)` 将 copy/cut/paste/format/sendToAssistant 等动作写入 `editorContextActionsRef`，供右键菜单与其它入口复用
- **再集中注册快捷键命令**：`registerMonacoEditorCommands(...)` 在同一处把 `editor.addCommand(...)` 全部注册完成，避免 `handleEditorMount` 过长且减少维护成本

```typescript
// handleEditorMount 内（节选）：

/**
 * ① 注入右键菜单动作（写入 ref）
 *
 * 说明：
 * - 右键菜单本身是声明式渲染（items），但“点击后执行什么”需要在 onMount 拿到 editor 实例后才能绑定
 * - 因此这里把 copy/cut/paste/format/发送选区到助手 等动作注入到 `editorContextActionsRef`
 * - 之后无论是右键菜单点击还是快捷键触发，都可以复用同一套动作，保证语义一致
 */
injectMonacoEditorContextActions({
	/** Monaco 编辑器实例：读取选区/模型、执行编辑（executeEdits）、触发内置 action 等 */
	editor,
	/** Monaco 命名空间：Range/KeyMod/KeyCode/editor option 等能力来源 */
	monaco,
	/** IME（输入法，Input Method Editor）合成态 ref：合成期间避免执行自定义粘贴等动作 */
	imeComposingRef,
	/**
	 * 输出参数：动作注入目标 ref
	 * - `injectMonacoEditorContextActions` 会把实现写入该 ref（例如 `copy()`/`paste()`/`sendSelectionToAssistant()`）
	 * - 右键菜单 items 的 onSelect 只需要调用 `ref.current?.xxx?.()`，避免闭包与依赖膨胀
	 */
	actionsRef: editorContextActionsRef,
	/**
	 * Copy 语义：获取“应该复制”的文本
	 * - 有选区：复制选区
	 * - 无选区（仅光标）：复制当前行（与常见编辑器一致）
	 */
	getCopyTextFromSelections,
	/**
	 * Selection 语义：仅返回“真实选区文本”
	 * - 无选区（仅光标）返回空串（不降级整行）
	 * - 专用于“发送到助手输入框”，避免误把整行作为对话草稿
	 */
	getSelectedTextOnlyFromSelections,
	/**
	 * 外部接入：将选区写入助手输入框
	 * - 具体如何写入（覆盖/追加/是否自动展开助手）由知识库页面决定
	 */
	onInsertSelectionToAssistant,
	/**
	 * Cut 语义：无选区剪切时的删除范围
	 * - 尽量对齐 VS Code：光标处剪切整行并处理换行
	 */
	rangeForCutWhenCursorOnly,
	/** 统一剪贴板写入：适配 WebView/Tauri 下系统复制不稳定的问题 */
	copyToClipboard,
	/** 统一剪贴板读取：用于右键菜单“粘贴”动作 */
	pasteFromClipboard,
	/**
	 * Markdown 安全格式化（safe format/安全格式化）：
	 * - markdown 下避免围栏反引号/缩进等被不安全 formatter 破坏
	 * - 其它语言可回落到 Monaco 内置格式化
	 */
	safeFormatMarkdownValue,
});

/**
 * ② 集中注册快捷键命令（editor.addCommand）
 *
 * 说明：
 * - 把 `editor.addCommand(...)` 从 `index.tsx` 抽离到 `commands.ts`，降低 `handleEditorMount` 复杂度
 * - 依赖全部通过参数注入：便于复用/测试，也避免把业务逻辑写死在命令注册中
 */
registerMonacoEditorCommands({
	/** Monaco 编辑器实例 */
	editor,
	/** Monaco 命名空间（用于 KeyMod/KeyCode 等） */
	monaco,
	/** IME 合成态 ref：粘贴命令在合成期间跳过 */
	imeComposingRef,
	/**
	 * 右键菜单动作 ref：
	 * - `Ctrl/⌘+Shift+V`（发送选区到助手）优先复用 `sendSelectionToAssistant`，与右键点击保持一致
	 */
	editorContextActionsRef,
	/** Copy 语义文本获取：用于 Ctrl/⌘+C、Ctrl/⌘+X（先复制再删） */
	getCopyTextFromSelections,
	/** Cut 语义删除范围：用于 Ctrl/⌘+X 无选区剪切整行 */
	rangeForCutWhenCursorOnly,
	/** 统一剪贴板写入：用于复制/剪切 */
	copyToClipboard,
	/** 统一剪贴板读取：用于粘贴 */
	pasteFromClipboard,
	/** ⌘/Ctrl+Shift+F：markdown 走 safeFormat，其它走 Monaco formatDocument */
	safeFormatMarkdownValue,
	/** “真实选区”获取：用于 Ctrl/⌘+Shift+V（无选区不触发） */
	getSelectedTextOnlyFromSelections,
	/** 外部接入：写入助手输入框（知识库页面负责拼接与自动展开） */
	onInsertSelectionToAssistant,
	flushEditorValueToParent: () => {
		/**
		 * 在触发可能导致 UI 变化（例如自动打开助手）之前，先把 editor 当前值同步到父级：
		 * - 避免后续视图切换/重挂载瞬态时出现“编辑器内容被清空”的观感
		 */
		const v = normalizeMonacoEol(editor.getValue());
		lastEmittedRef.current = v;
		onChangeRef.current?.(v);
	},
});

// editor.onDidDispose 开头：
editorContextActionsRef.current = null;
```

#### 5.2.1 快捷键命令抽离：`commands.ts`

本次将 `editor.addCommand(...)` 的实现从 `index.tsx` 抽离到 **`apps/frontend/src/components/design/Monaco/commands.ts`**，原因与收益如下：

- **降低 `onMount` 复杂度**：`handleEditorMount` 同时包含 layout 测量、订阅清理、IME 状态同步、右键动作注入、快捷键注册等，抽离后更易维护
- **语义一致**：快捷键与右键菜单共享同一套“动作/规则”，减少两处实现漂移
- **不影响现有功能与布局**：仅迁移代码位置与调用方式，UI 结构、面板布局、monaco 选项不变

`commands.ts` 内部集中注册的快捷键清单（与之前保持一致）：

- `⌘+Shift+F` / `Ctrl+Shift+F`：格式化（markdown 走 `safeFormatMarkdownValue`，其它语言触发 Monaco `editor.action.formatDocument`）。Monaco 默认的 **Shift+Alt+F（Option+Shift+F）** 已在 `MarkdownEditor` 的 `beforeMount` 中通过 `monaco.editor.addKeybindingRules` 配合 `-editor.action.formatDocument` **注销**，避免旧组合仍走内置格式化。
- `Ctrl/⌘ + B`：注释当前行（触发 Monaco `editor.action.commentLine`）
- `Ctrl/⌘ + C`：复制（走统一剪贴板封装，支持“无选区复制整行”）
- `Ctrl/⌘ + X`：剪切（先复制再删；无选区剪切整行，范围由 `rangeForCutWhenCursorOnly` 计算）
- `Ctrl/⌘ + V`：粘贴（走统一剪贴板封装；IME 合成态跳过）
- `Ctrl/⌘ + Shift + V`：发送“真实选区”到助手输入框（无选区不触发）

##### 5.2.2 修复：发送选区到助手时重复写入输入框

抽离后曾出现“内容写入 assistant 输入框重复追加”的问题，根因是同一快捷键同时走了两条写入链路：

- 直接调用 `onInsertSelectionToAssistant(selected)`
- 同时调用 `editorContextActionsRef.current?.sendSelectionToAssistant?.()`（该动作内部也会调用 `onInsertSelectionToAssistant`）

修复原则：**同一个触发点只走一条写入链路**。当前策略为：

- **优先**复用右键菜单动作 `sendSelectionToAssistant`（与右键点击一致）
- **兜底**：若该动作未注入，再直接调用 `onInsertSelectionToAssistant(selected)`

对应代码形态：

```typescript
// apps/frontend/src/components/design/Monaco/commands.ts（节选）
const action = editorContextActionsRef.current?.sendSelectionToAssistant;
if (action) {
	action();
	return;
}
onInsertSelectionToAssistant?.(selected);
```

组件卸载时同样清空 ref（与 `getMarkdownFromEditorRef` 清理并列）：

```typescript
useEffect(() => {
	return () => {
		editorContextActionsRef.current = null;
		if (getMarkdownFromEditorRef) {
			getMarkdownFromEditorRef.current = null;
		}
	};
}, [getMarkdownFromEditorRef]);
```

### 5.3 JSX：`QuickContextMenu` 包裹宿主

**注释意图**：`triggerAsChild` 下**唯一子节点**为测量用的 **`div`**，`Editor` 仍在内层，不改变原有 layout 行为。

```tsx
{/* 单栏「编辑」模式 */}
<QuickContextMenu items={editorContextMenuItems} triggerAsChild>
	<div
		ref={editorHostRef}
		// 该 div 是“右键触发区域 + layout 测量宿主”：
		// - 不能多包一层会影响尺寸计算/contain/overflow 的 DOM
		// - triggerAsChild 保证 Radix Trigger 不额外插入 DOM，避免破坏现有布局
		className="box-border h-full min-h-0 min-w-0 max-w-full w-full overflow-hidden contain-[inline-size]"
	>
		<Editor
			height={height}
			width="100%"
			/* ...path、onMount、options 等 */
		/>
	</div>
</QuickContextMenu>

{/* Markdown 分屏：左侧主编器 */}
<QuickContextMenu items={editorContextMenuItems} triggerAsChild>
	<div
		ref={editorHostRef}
		// 同一宿主策略：保证 split 模式下右键行为与单栏编辑一致
		className="box-border h-full min-h-0 min-w-0 max-w-full w-full overflow-hidden contain-[inline-size]"
	>
		<Editor height="100%" width="100%" /* ... */ />
	</div>
</QuickContextMenu>
```

---

## 6. Design：`QuickContextMenu` 职责简述

**文件**：`apps/frontend/src/components/design/ContextMenu/QuickContextMenu.tsx`

- 组合 **`ContextMenu` / `ContextMenuTrigger` / `ContextMenuContent`** 与递归的 **`QuickMenuEntries`**（支持 `item` / `separator` / `sub`）。
- 根组件 **`React.memo`**；`items` 建议调用方 **`useMemo`** 稳定引用（见文件内 JSDoc）。

```typescript
// QuickContextMenuProps（节选，注释与源码一致）
export interface QuickContextMenuProps {
	/**
	 * 右键/长按触发区域：
	 * - `triggerAsChild=true` 时必须提供“单个可合并 props 的子元素”（与 Radix Trigger 约束一致）
	 * - 这样可以复用现有 DOM 作为触发器，避免插入额外 wrapper 影响布局/测量
	 */
	children: React.ReactNode;
	/**
	 * 菜单结构（声明式数据）：
	 * - 建议调用方用 `useMemo` 稳定引用，减少 `QuickMenuEntries` 递归渲染的开销
	 * - 条目点击最终只会调用 `actionsRef.current?.xxx?.()`，避免把业务逻辑写进菜单渲染层
	 */
	items: readonly QuickContextMenuEntry[];
	/** 与 Radix Trigger 一致：为 true 时不包裹额外 DOM（布局零侵入） */
	triggerAsChild?: boolean;
	// ...
}
```

---

## 6. 知识库接入：选区写入 Knowledge Assistant 输入框

### 6.1 受控输入框：`KnowledgeAssistant` 支持外部写入

知识库页需要一个“外部入口”写入助手输入框（右键菜单只是其中一种），因此 `KnowledgeAssistant` 增加可选受控 props：

```typescript
// apps/frontend/src/views/knowledge/KnowledgeAssistant.tsx（节选）
interface KnowledgeAssistantProps {
	documentKey: string;
	/**
	 * 外部受控输入框（可选）：用于从编辑器右键菜单等外部入口写入草稿。
	 * 若不传则组件内部维护 input state。
	 *
	 * 设计目的：
	 * - “编辑器→助手输入框”属于跨组件写入，需要把输入框状态上移到父级（知识库页面）
	 * - 受控模式可确保：即使助手面板当前未展开，写入也不会丢失（展开后能看到已写入的草稿）
	 */
	input?: string;
	setInput?: (value: string) => void;
}
```

组件内部做“受控/非受控”双模式兼容：  
若传入 `input/setInput` 就使用外部状态，否则回退到内部 `useState`，不影响其它用法。

### 6.2 知识库页装配：上移 `assistantInput` + 传入 `onInsertSelectionToAssistant`

知识库页面（`views/knowledge/index.tsx`）将助手输入框状态上移，保证编辑器回调可以写入同一份草稿，并自动展开助手面板：

```tsx
// apps/frontend/src/views/knowledge/index.tsx（节选）
const [assistantInput, setAssistantInput] = useState('');

<MarkdownEditor
	// ...其它 props
	onInsertSelectionToAssistant={(text) => {
		/**
		 * 将编辑器选区写入助手输入框，并在未打开时自动展开助手面板。
		 *
		 * 关键：先把 Monaco 当前正文同步到 store，再写入输入框，最后再打开助手。
		 * 否则开启助手触发 edit→split 重挂载期间，父级 markdown 可能短暂为空，导致：
		 * - 编辑器看起来“被清空”
		 * - KnowledgeAssistant 的输入框清空逻辑抢先执行，刚写入的草稿被清掉
		 */
		// ① 先同步正文：避免 viewMode/面板切换过程出现“父级 markdown 短暂为空”的瞬态
		getMarkdownFromEditorRef.current?.();
		// ② 再写入草稿：非空选区才会调用到这里；此处采用“追加”而非“覆盖”
		setAssistantInput((prev) => {
			const next = (text ?? '').trim();
			if (!next) return prev;
			const cur = (prev ?? '').trim();
			return cur ? `${cur}\n\n${next}` : next;
		});
		// ③ 最后再展开助手：用 microtask 延后，避免与同帧的编辑器事件/布局更新互相打架
		if (!markdownAssistantOpen) {
			queueMicrotask(() => setMarkdownAssistantOpen(true));
		}
	}}
	chatNode={
		<KnowledgeAssistant
			documentKey={/* ... */}
			input={assistantInput}
			setInput={setAssistantInput}
		/>
	}
/>
```

### 6.3 为什么只处理“非空选区”

- **复制（Copy）**：允许空选区复制整行（编辑器常见行为）。  
- **送入助手输入框**：只处理非空选区，避免用户只是点了一下光标就把整行/整段写入对话草稿，造成误操作与噪声。

### 6.4 知识库快捷键：Command + Shift + V（发送选区到助手输入框）

除右键菜单外，知识库还支持通过快捷键把**编辑器当前非空选区**写入助手输入框。  
该快捷键在系统设置里配置（默认 **`Meta + Shift + V`**，即 macOS 的 **Command + Shift + V**），由 **Monaco 编辑器内部**处理（仅在编辑器聚焦时生效），并且**无选区时不会写入**。

涉及文件：

- `apps/frontend/src/utils/knowledge-shortcuts.ts`：新增 `pasteToAssistant` 的 key id 与默认 chord
- `apps/frontend/src/views/setting/system/config.ts`：系统设置里新增「知识库：发送选中内容到助手输入框」
- `apps/frontend/src/components/design/Monaco/index.tsx`：Monaco 内部注册 `Ctrl/⌘ + Shift + V`，触发 `sendSelectionToAssistant`
- `apps/frontend/src/components/design/Monaco/contextMenu.ts`：菜单项展示 `Ctrl/⌘+Shift+V`，并通过注入动作实现“只在非空选区时写入”

核心代码形态如下（快捷键注册已抽离到 `commands.ts`，`index.tsx` 只负责调用注册函数）：

```typescript
// apps/frontend/src/components/design/Monaco/index.tsx（节选）
registerMonacoEditorCommands({
	// ...省略：editor/monaco/剪贴板/选区等依赖注入
	onInsertSelectionToAssistant,
	flushEditorValueToParent: () => {
		const v = normalizeMonacoEol(editor.getValue());
		lastEmittedRef.current = v;
		onChangeRef.current?.(v);
	},
});
```

---

## 7. 知识库：Markdown 底部操作栏（快捷键 / Tooltip / 组件下沉）

底部操作栏与「右键上下文菜单」是不同主线：前者依赖系统设置 store、`KNOWLEDGE_SHORTCUTS_CHANGED_EVENT` 热更新、`useMarkdownBottomBarShortcuts` 的 `window` 捕获，以及 `MarkdownBottomBar` 内部的 Tooltip 与 UI 推导。  
详细实现说明与逐段示例代码已单独维护：

- 详见：[Markdown底部栏.md](./Markdown底部栏.md)

## 9. Markdown 编辑器：避免 edit→split 的 Editor 重挂载

### 9.1 `keepCurrentModel`：保留 TextModel，避免卸载导致正文回退

```tsx
// apps/frontend/src/components/design/Monaco/index.tsx（节选）
<Editor
	path={monacoModelPath}
	// 保留当前 TextModel：
	// - 避免组件卸载/重挂载时 dispose model 导致正文回退/选区丢失
	// - 配合 “edit/split 复用同一棵面板树” 可显著降低打开助手时的闪断与 loading 观感
	keepCurrentModel
	defaultValue={editorBootstrapTextRef.current}
	// ...
/>
```

### 9.2 `react-resizable-panels`：用 `groupRef.setLayout` 恢复右侧宽度

```tsx
// apps/frontend/src/components/design/Monaco/index.tsx（节选）
const panelGroupRef = useRef<GroupImperativeHandle | null>(null);
const lastSplitLayoutRef = useRef<Layout>({ editor: 50, right: 50 });

useEffect(() => {
	// viewMode 变化时用命令式布局同步面板宽度：
	// - `defaultSize` 只在首次挂载生效，后续切换模式不会自动“恢复”右侧宽度
	// - 因此需要 `groupRef.setLayout(...)` 显式设置 editor/right 的百分比
	if (viewMode === 'edit') {
		// 纯编辑模式：右侧收起到 0（但不卸载右侧面板，避免 Editor 重挂载）
		panelGroupRef.current?.setLayout({ editor: 100, right: 0 });
		return;
	}
	if (viewMode === 'split' || viewMode === 'splitDiff') {
		// 分屏模式：恢复用户上一次拖拽后的布局比例
		panelGroupRef.current?.setLayout(lastSplitLayoutRef.current);
	}
}, [viewMode]);

<ResizablePanelGroup
	orientation="horizontal"
	groupRef={panelGroupRef}
	onLayoutChanged={(layout) => {
		// 仅在分屏态持久化布局，避免 edit 模式下 100/0 覆盖用户偏好
		if (viewMode === 'split' || viewMode === 'splitDiff') {
			lastSplitLayoutRef.current = layout;
		}
	}}
>
	<ResizablePanel id="editor" defaultSize={50} minSize={20}>{/* Editor */}</ResizablePanel>
	<ResizableHandle withHandle />
	<ResizablePanel id="right" defaultSize={50} minSize={0}>{/* chat/preview/diff */}</ResizablePanel>
</ResizablePanelGroup>
```


---

## 7. 相关文件索引

| 文件 | 说明 |
|------|------|
| `apps/frontend/src/components/design/Monaco/contextMenu.ts` | `buildMonacoEditorContextMenuItems`（菜单项生成）、`injectMonacoEditorContextActions`（动作注入）与 `MonacoEditorContextActions` 类型 |
| `apps/frontend/src/components/design/Monaco/index.tsx` | 右键菜单装配：`editorContextActionsRef`、`editorContextMenuItems`、`QuickContextMenu`、`handleEditorMount` 中调用注入函数 |
| `apps/frontend/src/views/knowledge/index.tsx` | 知识库接入：向 `MarkdownEditor` 传 `onInsertSelectionToAssistant`，并把 `KnowledgeAssistant` 输入框状态上移为受控 |
| `apps/frontend/src/views/knowledge/KnowledgeAssistant.tsx` | 支持受控输入框（`input/setInput` 可选），供编辑器右键菜单等外部入口写入草稿 |
| `apps/frontend/src/components/design/Monaco/options.ts` | `contextmenu: false` |
| `apps/frontend/src/components/design/ContextMenu/QuickContextMenu.tsx` | 声明式右键菜单 |
| `apps/frontend/src/components/design/ContextMenu/types.ts` | `QuickContextMenuEntry` 等类型 |
| `apps/frontend/src/components/design/ContextMenu/primitives.tsx` | 对 `ui/context-menu` 的 memo 二次封装 |
| `apps/frontend/src/components/ui/context-menu.tsx` | Radix + 样式原语 |
| `apps/frontend/src/utils/clipboard.ts` | `copyToClipboard` / `pasteFromClipboard` |
| `monaco/剪贴板全局处理绕过.md` | Monaco 与 Tauri 剪贴板总览 |
| `monaco/无选区剪切行Cmd+X.md` | 无选区剪切整行 |
| `monaco/Markdown底部栏.md` | Markdown 底部操作栏：⌘+1…⌘+0、`useMarkdownBottomBarShortcuts`、`MarkdownBottomBar` |

---

## 8. 排查与优化提示

- **底部操作栏快捷键 / Tooltip 不同步**：配置、热更新与 `MarkdownBottomBar` 装配说明见 **`monaco/Markdown底部栏.md`**。
- **右键无菜单**：确认 `mergedEditorOptions` 是否仍包含 **`contextmenu: false`**；检查 Monaco 是否在某处改写了 `contextmenu`。
- **菜单点了没反应**：多为 **`editorContextActionsRef` 尚未注入**（`onMount` 未完成）或已 **`onDidDispose` 清空**；挂载完成前菜单通常不会稳定出现。
- **与快捷键行为不一致**：应把差异收敛到 **`editorContextActionsRef` 与 `addCommand` 共用的一段逻辑**，避免只在菜单里改一份。

行号会随提交漂移，**以仓库当前文件为准**；本文中的代码块用于说明结构与注释意图。
