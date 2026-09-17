# Monaco 组件（`apps/frontend/src/components/design/Monaco`）使用说明（超详细）

本文面向“第一次接触该组件”的开发者，目标是：**你不需要理解 Monaco 的全部细节，也能把编辑器稳定接入业务页面**；并且知道每个常用 prop 的作用、什么时候该用受控、什么时候该传 ref、如何接入底部操作栏/预览/助手/Diff 等能力。

> 组件入口：`apps/frontend/src/components/design/Monaco/index.tsx`  
> 组件名：默认导出 `MarkdownEditor`（历史原因，名字偏 Markdown；其实也能用于非 Markdown 的普通 Monaco 编辑器）

---

## 0. 你到底要用哪个能力？先选“场景模板”

你只需要在下表里找到最接近你的场景，然后照抄对应“最小示例”，再按需增量开启功能：

- **场景 A：普通 Monaco 编辑器（非 Markdown）**  
  你只想要一个代码编辑器（JSON/TS/SQL…），不需要预览、底部操作栏、Diff、助手。

- **场景 B：Markdown 编辑器（编辑/预览/分屏）**  
  你需要 Markdown 的预览渲染、分屏、滚动同步等。

- **场景 C：知识库编辑器（Markdown + 底部操作栏 + Diff + 助手）**  
  这是“全功能”模板：底部操作栏、分屏预览、分屏 Diff、右侧助手面板、自定义底部节点等。

---

## 1. 组件基础：必传/常用 props 一览

`MarkdownEditor` 的核心 props（按使用频率排序）：

- **`value?: string`**：编辑器内容（建议受控）。
- **`onChange?: (value: string) => void`**：内容变化回调（业务 store 在此更新）。
- **`language?: string`**：Monaco language id（如 `markdown`、`json`、`typescript`…）。
- **`theme?: 'vs' | 'vs-dark' | 'hc-black'`**：Monaco 主题（通常由全局 theme 映射）。
- **`documentIdentity?: string`**：逻辑文档 id（非常重要）。变化时会换 Monaco model，避免串文。
- **`height?: string`**：编辑器高度（例如 `'100%'` / `'300px'`）。
- **`readOnly?: boolean`**：只读模式。
- **`toolbar?: React.ReactNode`**：顶部右侧工具区（可选）。不需要时可省略或显式传 `null`。
- **`title?: React.ReactNode`**：顶部左侧标题区（可选）。

Markdown 专属/扩展能力的 props（你用到再看）在后续章节展开。

补充：底部操作栏相关的两个“开关型”参数（默认都开启，保证组件开箱即用）：

- **`enableMarkdownBottomBar?: boolean`**：是否启用 Markdown 底部操作栏（默认 `true`）。设为 `false` 时不渲染底部操作栏，也不会显示顶部「操作栏」按钮。
- **`enableMarkdownBottomBarToggleShortcut?: boolean`**：是否由组件内部监听「切换操作栏」快捷键（默认 `true`）。设为 `false` 时，组件不再注册该快捷键监听（避免与页面级快捷键冲突）；此时若业务仍需快捷键切换，请在页面层自行实现“打开/关闭操作栏”的策略（注意：操作栏开合状态由组件内部维护，不提供外部受控 props）。

补充（通用性）：底部操作栏快捷键所需的数据源由外部注入：

- **`shortcutSource?: ShortcutSource`**：底部操作栏快捷键数据源（可选）。
  - 你可以把“默认 chords / 加载 chords / 订阅变更 / 匹配逻辑”封装成一个对象传入，组件不直接依赖你项目里的快捷键存储实现。
  - 若不传，则底部操作栏仍可用（按钮可点），但不会注册任何底部栏快捷键监听。

补充（通用性）：剪贴板能力也由外部注入（避免组件依赖特定运行时）：

- **`clipboardAdapter?: { copyToClipboard(text): void|Promise<void>; pasteFromClipboard(): Promise<string> }`**：
  - 组件内部的右键菜单与自定义 copy/cut/paste 命令会统一走该适配器（适配 Web Clipboard / Tauri 插件等差异）。
  - 若不传，编辑器仍可用，但上述自定义剪贴板路径将退化为空实现（不再强绑定某个项目的剪贴板封装）。

### 1.1 `shortcutSource` / `clipboardAdapter`：为什么要注入（实现思路）

这两个参数的目的都是：**让 `Monaco` 组件保持独立、可直接拎到其它项目复用**。

- **`shortcutSource`**：组件不再硬编码依赖“知识库项目”的快捷键存储与热更新事件；改为由宿主页面提供“默认 chords / 加载 / 订阅变更 / 匹配逻辑”。
- **`clipboardAdapter`**：组件不再硬编码依赖某个运行时的剪贴板封装（Web Clipboard / Tauri 插件差异）；右键菜单与 copy/cut/paste 命令统一通过 adapter 读写剪贴板。

### 1.2 关键实现代码（逐行注释版）

#### A) `Monaco/index.tsx`：props 定义（节选）

```tsx
// apps/frontend/src/components/design/Monaco/index.tsx（节选）

/**
 * 底部操作栏快捷键数据源（由使用方注入，保证组件可移植）。
 * - 包含：默认 chords、加载 chords、订阅变更、匹配逻辑
 * - 组件内部不再直接依赖知识库快捷键存储实现
 */
shortcutSource?: ShortcutSource;

/**
 * 剪贴板适配器（adapter，适配层）：由使用方注入，保证组件可移植。
 *
 * 设计目标：
 * - 避免组件内部直接依赖某个项目的剪贴板实现（Web Clipboard / Tauri 插件等）
 * - 右键菜单与自定义命令（copy/cut/paste）统一走此实现，保证行为一致
 */
clipboardAdapter?: {
  copyToClipboard: (text: string) => Promise<void> | void; // 写入剪贴板
  pasteFromClipboard: () => Promise<string>; // 读取剪贴板
};
```

#### B) `Monaco/index.tsx`：把 adapter 变成稳定函数（节选）

```tsx
// apps/frontend/src/components/design/Monaco/index.tsx（节选）

// 1) 用 ref 保存最新 adapter：避免把 clipboardAdapter 直接放进 useCallback 依赖导致 onMount 逻辑抖动
const clipboardAdapterRef = useRef(clipboardAdapter);
clipboardAdapterRef.current = clipboardAdapter; // 2) 每次 render 更新 ref：确保回调读到最新实现

// 3) 统一写入剪贴板：右键菜单「复制/剪切」与快捷键路径共用
const copyToClipboard = useCallback(async (text: string) => {
	await clipboardAdapterRef.current?.copyToClipboard(text); // 4) 未注入时为 undefined：自然 no-op
}, []);

// 5) 统一读取剪贴板：用于自定义「粘贴」命令把文本注入光标/选区
const pasteFromClipboard = useCallback(async () => {
	return (await clipboardAdapterRef.current?.pasteFromClipboard()) ?? ""; // 6) 未注入则回空串，避免异常
}, []);
```

#### C) `useMarkdownBottomBarShortcuts.ts`：接收 `shortcutSource` 注入（节选）

```ts
// apps/frontend/src/hooks/useMarkdownBottomBarShortcuts.ts（节选）

export type ShortcutSource = {
	defaultChords: MarkdownBottomBarChords; // 1) 默认 chord：首次渲染兜底（Tooltip 展示）
	loadChords: () => Promise<
		Partial<MarkdownBottomBarChords> | null | undefined
	>; // 2) 加载 chord：可部分覆盖
	subscribeChordsChanged: (onChange: () => void) => () => void; // 3) 热更新订阅
	chordMatchesStored: (stored: string | undefined, e: KeyboardEvent) => boolean; // 4) 命中匹配：交给宿主实现
};

// 5) 未注入时回落空数据源：确保组件不在未知项目里“误绑定”快捷键
const shortcutSource =
	shortcutSourceProp ?? EMPTY_MARKDOWN_BOTTOM_BAR_SHORTCUT_SOURCE;
```

#### D) 知识库页如何装配（节选）

```tsx
// apps/frontend/src/views/knowledge/index.tsx（节选）

// 1) 由知识库页构造 shortcutSource：将既有的 chord 读取/事件热更新/匹配逻辑封装起来
const shortcutSource = useMemo<ShortcutSource>(
	() => ({
		defaultChords: {
			/* ...使用 KNOWLEDGE_SHORTCUT_DEFAULT_CHORDS ... */
		},
		loadChords: async () => {
			const c = await loadKnowledgeShortcutChords();
			return {
				/* ...映射为底部栏 chords... */
			};
		},
		subscribeChordsChanged: (onChange) => {
			const handler = () => onChange();
			window.addEventListener(KNOWLEDGE_SHORTCUTS_CHANGED_EVENT, handler);
			return () =>
				window.removeEventListener(KNOWLEDGE_SHORTCUTS_CHANGED_EVENT, handler);
		},
		chordMatchesStored: (stored, e) => chordMatchesStored(stored, e),
	}),
	[],
);

// 2) 注入剪贴板 adapter：复用本项目对 WebView/Tauri 的封装
<MarkdownEditor
	shortcutSource={shortcutSource}
	clipboardAdapter={{ copyToClipboard, pasteFromClipboard }}
	// ...其它 props
/>;
```

---

## 2. 场景 A：普通编辑器（非 Markdown）最小示例

下面是最小可运行示例：一个 typescript 编辑器，受控 `value/onChange`。

```tsx
import MonacoEditor from "@/components/design/Monaco";

export function ExamplePlainEditor() {
	// 你的业务 state（示例用 useState；实际可用 mobx/zustand/redux）
	const [code, setCode] = useState('console.log("hello")\n');

	return (
		<MonacoEditor
			// 1) 受控内容：业务负责保存 code，编辑器只负责展示与编辑
			value={code}
			onChange={(next) => setCode(next)}
			// 2) 文档身份：只要你切换“不同文件/不同记录”，一定要换这个值
			documentIdentity="example-plain-editor"
			// 3) Monaco 基础配置
			language="typescript"
			theme="vs-dark"
			height="300px"
			// 4) 顶部区域：toolbar 可选（不需要可省略；这里显式传 null 便于读者理解结构）
			title={<div className="px-3 text-sm text-textcolor">示例编辑器</div>}
			toolbar={null}
		/>
	);
}
```

### 2.1 `documentIdentity` 必须传对，否则你会遇到“串文”

如果你用同一个组件实例去编辑多个“逻辑文档”（例如列表里切换不同记录），但 `documentIdentity` 不变，Monaco 可能会复用旧 model，表现为：

- 切换记录后内容残留
- Diff/分屏状态沿用上一条记录

**规则**：只要你认为“这是另一篇文档/另一个文件”，就让 `documentIdentity` 变化（例如用数据库 id、文件 path、或你构造的复合 key）。

---

## 3. 场景 B：Markdown 编辑器（预览/分屏）最小示例

你要开启预览能力时，至少保证：

- `language="markdown"`
- `enableMarkdownPreview={true}`（默认就是 true）

```tsx
import MonacoEditor from "@/components/design/Monaco";

export function ExampleMarkdownEditor() {
	const [md, setMd] = useState("# 标题\n\n正文...\n");

	return (
		<MonacoEditor
			value={md}
			onChange={setMd}
			documentIdentity="example-md"
			language="markdown"
			theme="vs"
			height="420px"
			// 顶部栏：你可以只放一个空占位
			title={<div className="px-3 text-sm text-textcolor">Markdown 编辑</div>}
			toolbar={null}
			// 预览能力（默认 true，这里写出来是为了让你知道它存在）
			enableMarkdownPreview
			// Mermaid（图表语法）渲染：默认 true；如果你不想渲染围栏里的 mermaid，可关
			markdownEnableMermaid
		/>
	);
}
```

### 3.1 分屏滚动同步怎么来的？

分屏滚动同步的详细实现见：

- `docs/monaco/Markdown分屏滚动同步.md`

如果你出现“滚动不同步/跳动”，先看该文档的“坐标系约定”和“快照有效性”章节。

---

## 4. 场景 C：知识库编辑器（全功能）推荐模板

这是你在“知识库”页看到的那套能力组合（底部操作栏 + Diff + 助手 + 自定义底部节点）。

### 4.1 最小模板（建议照抄再删减）

```tsx
import MonacoEditor from "@/components/design/Monaco";
import type { ShortcutSource } from "@/hooks/useMarkdownBottomBarShortcuts";

export function ExampleKnowledgeLikeEditor() {
	const [md, setMd] = useState("");
	const [assistantOpen, setAssistantOpen] = useState(false);
	const [assistantInput, setAssistantInput] = useState("");

	// 保存前同步正文：避免父级 onChange 被 rAF 合并时出现“业务态滞后”
	const getMarkdownFromEditorRef = useRef<(() => string) | null>(null);

	// Diff 基线：如果你有“打开时快照”，传 persisted + baselineText；否则用 current/empty
	const baselineSource: "current" | "persisted" | "empty" = "current";

	// 1) shortcutSource：把底部操作栏快捷键的数据源/热更新/匹配逻辑封装起来注入
	const shortcutSource = useMemo<ShortcutSource>(
		() => ({
			defaultChords: {
				toggleMarkdownBottomBar: "Meta + Shift + B",
				markdownBarAction1: "Meta + 1",
				markdownBarAction2: "Meta + 2",
				markdownBarAction3: "Meta + 3",
				markdownBarAction4: "Meta + 4",
				markdownBarAction5: "Meta + 5",
				markdownBarAction6: "Meta + 6",
				markdownBarAction7: "Meta + 7",
				markdownBarAction8: "Meta + 8",
				markdownBarAction9: "Meta + 9",
				markdownBarAction0: "Meta + 0",
				markdownBarResetPosition: "Meta + -",
			},
			loadChords: async () => {
				// 这里用你的项目设置源替换：例如 localStorage / remote config
				return null;
			},
			subscribeChordsChanged: (onChange) => {
				// 这里用你的项目事件替换：例如 settingsSavedEvent
				// 返回取消订阅函数
				return () => {};
			},
			chordMatchesStored: (stored, e) => {
				// 这里用你的项目匹配逻辑替换（解析 stored 并与 e 匹配）
				return false;
			},
		}),
		[],
	);

	// 2) clipboardAdapter：把剪贴板实现注入（Web Clipboard / Tauri 插件都可）
	const clipboardAdapter = useMemo(
		() => ({
			copyToClipboard: async (text: string) => {
				await navigator.clipboard.writeText(text);
			},
			pasteFromClipboard: async () => {
				return await navigator.clipboard.readText();
			},
		}),
		[],
	);

	// 3) 将编辑器选区写入助手输入框（建议抽成组件内部方法，避免 JSX 内堆逻辑）
	const onInsertSelectionToAssistant = useCallback(
		(text: string) => {
			// 先从编辑器 flush 最新正文：避免切换助手导致重挂载时出现“内容短暂清空”的错觉
			getMarkdownFromEditorRef.current?.();

			// 选区追加到输入框：保留原输入内容，用空行分隔
			setAssistantInput((prev) => {
				const next = (text ?? "").trim();
				if (!next) return prev;
				const cur = (prev ?? "").trim();
				return cur ? `${cur}\n\n${next}` : next;
			});

			// 若助手未打开则展开（用 microtask 避免与本次事件的焦点/布局竞争）
			if (!assistantOpen) {
				queueMicrotask(() => setAssistantOpen(true));
			}
		},
		[assistantOpen],
	);

	return (
		<MonacoEditor
			value={md}
			onChange={setMd}
			documentIdentity="knowledge:example"
			language="markdown"
			height="100%"
			title={<div className="px-3 text-sm text-textcolor">知识库示例</div>}
			toolbar={<div>toolbar</div>}
			// 1) 底部操作栏：开合状态由组件内部维护（无需业务页再写一份 state）
			//    - 如需“切换操作栏”快捷键：请注入 shortcutSource（并保持 enableMarkdownBottomBarToggleShortcut=true）
			enableMarkdownBottomBar
			enableMarkdownBottomBarToggleShortcut
			// 2) 底部操作栏快捷键数据源（通用化注入）
			shortcutSource={shortcutSource}
			// 3) 剪贴板适配器（通用化注入）
			clipboardAdapter={clipboardAdapter}
			// 4) 右侧助手面板（受控）：避免在 documentIdentity 变更时被内部逻辑误关
			markdownAssistantOpen={assistantOpen}
			onMarkdownAssistantOpenChange={setAssistantOpen}
			bottomBarAssistantNode={<div className="h-full">这里放你的助手组件</div>}
			// 5) Diff（按需）
			diffBaselineSource={baselineSource}
			diffBaselineText={undefined}
			// 6) 保存前取编辑器当前全文：自动保存/脏检查常用
			getMarkdownFromEditorRef={getMarkdownFromEditorRef}
			// 7) 选区写入助手输入框（右键菜单 / 命令会走这个回调）
			onInsertSelectionToAssistant={onInsertSelectionToAssistant}
			// 8) 自定义底部节点（render-prop 形式）：可直接调用底部栏所有 actions
			customBottomBarNode={({ actions, chords }) => (
				<div className="ml-2 flex items-center gap-2">
					<button
						type="button"
						className="rounded-md px-2 py-1 text-xs text-textcolor/80 hover:bg-theme/10"
						onClick={() => actions.focusEditor()}
					>
						聚焦编辑器
					</button>
					<button
						type="button"
						className="rounded-md px-2 py-1 text-xs text-textcolor/80 hover:bg-theme/10"
						onClick={() => actions.resetMarkdownBottomBarPosition()}
						title={`复位（${chords.markdownBarResetPosition}）`}
					>
						复位操作栏
					</button>
				</div>
			)}
		/>
	);
}
```

### 4.2 受控 vs 非受控：什么时候必须受控？

该组件里有一类 UI 状态可受控：

- **右侧助手**：`markdownAssistantOpen` + `onMarkdownAssistantOpenChange`

**建议**：在业务页面（知识库这类重页面）中对「右侧助手」使用受控，原因：

- 页面快捷键通常在页面层实现，需要准确控制开/关
- 切换文档（`documentIdentity` 变）时，内部状态可能会被重置；受控可以避免“你以为开着，其实被关了”

补充：**底部操作栏开合不再对外受控**（组件内部维护），这是为了让组件更“开箱即用”并减少业务页样板代码。

---

## 5. `customBottomBarNode`：如何在自定义区域“操作编辑器”

### 5.1 两种用法（都支持）

- **旧用法（兼容）**：

```tsx
customBottomBarNode={<div className="ml-2 text-xs text-textcolor/60">自定义内容</div>}
```

- **新用法（推荐）**：render-prop，拿到 `ctx`：

```tsx
customBottomBarNode={({ state, actions, chords, options }) => {
  // 你可以：
  // - 读 state：例如 state.viewMode
  // - 调 actions：例如 actions.setViewMode('preview')
  // - 读 chords：用于 Tooltip/提示文案
  // - 读 options：例如 options.bottomBarAssistantNodeEnabled
  return (
    <div className="ml-2 flex items-center gap-2">
      <button type="button" onClick={() => actions.setViewMode('preview')}>
        去预览
      </button>
    </div>
  );
}}
```

### 5.2 “所有可操作的方法”都在哪里？

你在 `ctx.actions` 里能拿到的就是底部操作栏在用的那一套方法（同源、同闭包），包括但不限于：

- `focusEditor`
- `setViewMode`
- `setSplitScrollFollowMode`
- `toggleMarkdownSplitDiffCompare`
- `toggleMarkdownAssistant` / `closeMarkdownAssistant`
- `onOverwriteSaveEnabledChange` / `onAutoSaveEnabledChange` / `onAutoSaveIntervalSecChange`（如果业务传了回调才有）
- `resetMarkdownBottomBarPosition`（复位操作栏拖动位置）

render-prop 能力的实现原理与设计约束见：

- `docs/monaco/Markdown底部栏.md`（§9.10）

---

## 6. 常见坑位（按踩坑概率排序）

### 6.1 忘记传 `toolbar`

`toolbar` 已是可选项：你可以直接省略它。

如果你希望在 JSX 中“显式表达顶部右侧区域为空”，也可以传 `null`：

```tsx
toolbar={null}
```

### 6.2 `documentIdentity` 不变导致“串文”

见 §2.1。

### 6.3 自动保存/脏检查不准

如果你的业务有“保存前读当前编辑器全文”的需求（避免父级 state 滞后），请使用：

- `getMarkdownFromEditorRef`

典型做法是：保存按钮点击时先 `getMarkdownFromEditorRef.current?.()`，再走保存逻辑。

### 6.4 IME（输入法编辑器）重影/叠字

如果用户反馈中文输入法异常，相关经验文档：

- `docs/monaco/Markdown输入法鬼影.md`

---

## 7. 进一步阅读（按主题）

- **底部操作栏（快捷键/拖动/复位/自定义节点）**：`docs/monaco/Markdown底部栏.md`
- **分屏滚动同步**：`docs/monaco/Markdown分屏滚动同步.md`
- **分屏 Diff 对照**：`docs/monaco/Markdown分屏差异对比.md`
- **右键菜单与上下文动作**：`docs/monaco/Markdown编辑器右键菜单.md`
- **剪贴板与快捷键冲突处理**：`docs/monaco/剪贴板全局处理绕过.md`
