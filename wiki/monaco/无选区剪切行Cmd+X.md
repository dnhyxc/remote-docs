# Monaco：无选区时 Command/Ctrl + X 剪切整行

## 背景

封装组件 `apps/frontend/src/components/design/Monaco/index.tsx` 在 **Tauri WebView** 等环境下，通过 `onMount` 里 **`editor.addCommand`** 显式绑定 **Cmd/Ctrl + C / X / V**（与 `docs/monaco-剪贴板全局处理绕过.md` 一致），用模型选区 + 统一剪贴板 API 替代不可靠的系统默认行为。

在此前提下，需要与 **VS Code** 一致：**光标落在某一行、没有任何选区（零宽度 selection）时，Cmd/Ctrl + X 应剪切「当前逻辑行」**（含行尾换行符（EOL）），而不是必须先拖选整行。

## 问题根因

剪切流程分为两步：

1. **剪贴板**：根据选区拼出要写入剪贴板的字符串。
2. **文档**：用 `editor.executeEdits` 删除对应内容。

其中 **`getCopyTextFromSelections`** 在「空选区」时已按行处理：若 `startLineNumber === endLineNumber` 且 `startColumn === endColumn`，则返回 `getLineContent(line) + model.getEOL()`，剪贴板内容是正确的。

但若 **`executeEdits` 使用的 `range` 仍是该零宽度 `Selection`**，则删除范围为 **空**，模型不会删掉任何字符，表现为「复制了整行到剪贴板，但编辑器里行还在」或用户感知为「必须选中才能剪切」。

## 方案概览

在 **`handleEditorMount`**（`@monaco-editor/react` 的 `OnMount` 回调）内，在原有 `getCopyTextFromSelections` 与 `KeyX` 命令之间增加 **`rangeForCutWhenCursorOnly`**：

- **有选区**（非零宽度）：`range` 仍用原 `Selection`（与 `getValueInRange` 语义一致）。
- **仅光标**：将 `range` 换算为覆盖「整行 + 行间换行」的 **`monaco.Range`**，再 `text: ''` 删除。

## 详细实现逻辑

### 1. `getCopyTextFromSelections`（剪贴板文本）

- 无 model 或无选区：返回空字符串。
- 对每个 selection：
  - **光标**（单行且起止行列相同）：`getLineContent(line) + eol`。
  - **有选区**：`model.getValueInRange(sel)`。
- 多光标时各段用当前 model 的 **EOL**（`getEOL()`）拼接，与多行复制习惯一致。

### 2. `rangeForCutWhenCursorOnly`（删除范围，对齐 VS Code）

输入为 `editor.getSelections()` 中的单个 selection；类型使用

`NonNullable<ReturnType<MonacoEditorInstance['getSelections']>>[number]`，

避免在工程里直接写 `monaco.Selection` 等 **TypeScript 命名空间** 类型（当前配置下可能报 `Cannot find namespace 'monaco'`）。

逻辑分支：

| 条件 | `Range` 含义 |
|------|----------------|
| 非光标（已有选区） | 返回原 `sel`，由 `executeEdits` 按选区删除 |
| 光标且 **非最后一行** | `(line, 1)` 到 `(line + 1, 1)`：删除本行及行尾换行 |
| 光标且 **最后一行**且 **上方还有行** | 从 `(line - 1, getLineMaxColumn(line - 1))` 到 `(line, getLineMaxColumn(line))`：去掉上一行末尾到本行末尾的区间，避免单独删 `(line,1)-(line,max)` 时留下多余空行或换行语义不一致 |
| 光标且 **全文仅一行** | `(1, 1)` 到 `(1, getLineMaxColumn(1))`：清空该行内容 |

### 3. `Cmd/Ctrl + X` 命令处理顺序

1. **只读**：`readOnly` 时直接返回（不写剪贴板、不改文档）。
2. `getCopyTextFromSelections()` 为空则返回。
3. **`await copyToClipboard(text)`**（与 C 命令一致，含 Tauri 分支）。
4. 再次 `getSelections()`，对每个 selection 调用 `rangeForCutWhenCursorOnly(sel)`，**`executeEdits('cut', [{ range, text: '' }, ...])`**。

异步使用 **IIFE** `void (async () => { ... })()`，避免 `addCommand` 回调本身必须是同步的限制。

## 实现代码（摘自仓库）

下列片段来自 `apps/frontend/src/components/design/Monaco/index.tsx` 的 **`handleEditorMount`**（`OnMount` 回调内）。**行号会随改动漂移**，以仓库文件为准；此处便于对照阅读。

### `getCopyTextFromSelections`

```typescript
/** 从模型选区取待复制文本；空选区时复制当前行（与常见编辑器一致） */
const getCopyTextFromSelections = (): string => {
	const model = editor.getModel();
	if (!model) return '';
	const sels = editor.getSelections();
	if (!sels?.length) return '';
	const eol = model.getEOL();
	return sels
		.map((sel) => {
			if (
				sel.startLineNumber === sel.endLineNumber &&
				sel.startColumn === sel.endColumn
			) {
				return model.getLineContent(sel.startLineNumber) + eol;
			}
			return model.getValueInRange(sel);
		})
		.join(eol);
};
```

### `rangeForCutWhenCursorOnly`

```typescript
/**
 * 剪切时使用的范围：与 VS Code 一致，**空选区（仅光标）**表示「当前逻辑行」。
 * - 非最后一行：删除 (line,1)～(line+1,1)，去掉该行及行尾换行
 * - 最后一行且上文还有行：从上一行末尾到本行末尾，一并去掉行间换行
 * - 仅一行：删本行内容
 */
const rangeForCutWhenCursorOnly = (
	sel: NonNullable<
		ReturnType<MonacoEditorInstance['getSelections']>
	>[number],
) => {
	const model = editor.getModel();
	if (!model) return sel;
	const isCursor =
		sel.startLineNumber === sel.endLineNumber &&
		sel.startColumn === sel.endColumn;
	if (!isCursor) return sel;
	const line = sel.startLineNumber;
	const lineCount = model.getLineCount();
	if (line < lineCount) {
		return new monaco.Range(line, 1, line + 1, 1);
	}
	if (line > 1) {
		return new monaco.Range(
			line - 1,
			model.getLineMaxColumn(line - 1),
			line,
			model.getLineMaxColumn(line),
		);
	}
	return new monaco.Range(1, 1, 1, model.getLineMaxColumn(1));
};
```

说明：`MonacoEditorInstance` 在 `apps/frontend/src/components/design/Monaco/utils.ts` 中导出为 `Parameters<OnMount>[0]`（`OnMount` 来自 `@monaco-editor/react`），用于从 `getSelections()` 推导 **selection** 元素类型，避免使用 `monaco` 的 TS 命名空间标注。

### `Cmd/Ctrl + X`：`addCommand` + `executeEdits`

紧邻 `KeyC` 绑定之后，对 **`monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyX`** 注册：

```typescript
editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyX, () => {
	if (editor.getOption(monaco.editor.EditorOption.readOnly)) return;
	void (async () => {
		const text = getCopyTextFromSelections();
		if (!text) return;
		await copyToClipboard(text);
		const sels = editor.getSelections();
		if (!sels?.length) return;
		editor.executeEdits(
			'cut',
			sels.map((sel) => ({
				range: rangeForCutWhenCursorOnly(sel),
				text: '',
			})),
		);
	})();
});
```

`copyToClipboard` 定义在 `apps/frontend/src/utils/clipboard.ts`（与 `docs/monaco-剪贴板全局处理绕过.md` 一致）。

## 相关代码位置

实现集中在：

- **`apps/frontend/src/components/design/Monaco/index.tsx`**
  - `handleEditorMount` 内：`getCopyTextFromSelections`、`rangeForCutWhenCursorOnly`、`monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyX` 的 `addCommand`。
- **`apps/frontend/src/components/design/Monaco/utils.ts`**
  - `export type MonacoEditorInstance`：供上述 selection 类型推导使用。

## 行为说明与注意点

- **多光标**：每个光标独立按上表规则生成 range；剪贴板为多段文本用 EOL 连接，与复制逻辑一致。
- **Diff 编辑器**：若项目另有 `DiffEditor` 的 `onMount` 且单独绑定了 C/X/V，需要在对应实例上 **复用同一套「光标 → Range」规则**，否则仅在单编辑器模式下有无选区剪切整行。
- **与剪贴板总览文档的关系**：全局快捷键绕过、Tauri 普通输入框等见 **`docs/monaco-剪贴板全局处理绕过.md`**。
