# Tauri 剪贴板支持 TipTap 富文本编辑器

## 1. 背景与目标

Tauri 桌面端应用运行在 WebView 中，系统级 Cmd/Ctrl+C/V/X 等剪贴板快捷键有时无法正常作用于普通 input/textarea，也无法作用于 TipTap 富文本编辑器的 contenteditable 正文区域。

此前的实现只接管了普通 input/textarea 的剪贴板快捷键，Monaco/CodeMirror 等代码编辑器因有自身的剪贴板方案则直接跳过。但 TipTap/ProseMirror 富文本编辑器的正文区域同样受到 Tauri WebView 剪贴板问题的影响，用户无法通过系统快捷键进行复制、粘贴、剪切操作。

**目标**：将 Tauri 剪贴板快捷键接管能力扩展到 TipTap 富文本编辑器正文，确保用户在 Tauri 桌面端可以正常使用 Cmd/Ctrl+C/V/X 进行文本复制、粘贴、剪切操作。

## 2. 改动范围

- `apps/frontend/src/utils/clipboard.ts`
  - 函数重命名：`richEditorInEventPath` → `monacoOrCodeMirrorInEventPath`（语义更准确）
  - 新增函数：`tipTapBodyInEventPath`，判断事件是否落在 TipTap/ProseMirror 正文 contenteditable 节点内
  - 主函数 `attachTauriPlainFieldClipboardShortcuts` 新增 TipTap 分支处理

## 3. 实现思路

1. **函数重命名提升语义准确性**：将原 `richEditorInEventPath` 重命名为 `monacoOrCodeMirrorInEventPath`，明确该函数仅用于判断 Monaco/CodeMirror 这类代码编辑器，避免与 TipTap 等富文本编辑器混淆。

2. **新增 TipTap 正文检测函数**：新增 `tipTapBodyInEventPath` 函数，通过选择器 `.tiptap.ProseMirror, .ProseMirror.tiptap, .rich-editor .tiptap[contenteditable="true"]` 匹配 TipTap 编辑器正文节点，并验证 `isContentEditable` 为 true，确保只作用于可编辑的正文区域。

3. **在主处理函数中插入 TipTap 分支**：在 Monaco/CodeMirror 判断之后、普通文本域判断之前，插入 TipTap 正文检测分支。如果事件落在 TipTap 正文内且当前活动元素不是普通文本域，则进入 TipTap 处理逻辑。

4. **TipTap 各快捷键处理策略**：
   - **全选（Cmd/Ctrl+A）**：直接 return，交给编辑器自身的快捷键处理，避免破坏编辑器内部的选区逻辑。
   - **复制（Cmd/Ctrl+C）**：通过 `window.getSelection().toString()` 获取选中文本，调用 `preventDefault` 阻止默认行为，然后通过 `writeClipText` 写入系统剪贴板。
   - **剪切（Cmd/Ctrl+X）**：先获取选中文本并写入系统剪贴板，然后 focus 回编辑器，通过 `document.execCommand('delete')` 删除选中内容。
   - **粘贴（Cmd/Ctrl+V）**：调用 `preventDefault` 阻止默认行为，异步读取剪贴板文本，focus 回编辑器后通过 `document.execCommand('insertText', false, text)` 插入文本。

5. **标题区走原生分支**：TipTap 编辑器的标题区是原生 input 元素，会走下方的 plain field 分支，不进入 TipTap 正文处理逻辑。

6. **使用 execCommand 而非自造选区**：粘贴和删除操作使用 `document.execCommand`，让 ProseMirror 内部监听并响应这些命令，避免自造选区破坏编辑器的事务（transaction）机制。

## 4. 关键代码对比与注释

### 4.1 函数重命名：`richEditorInEventPath` → `monacoOrCodeMirrorInEventPath`

**对比范围**：函数整体重命名，逻辑不变。

**改动前** · `apps/frontend/src/utils/clipboard.ts`（基线，约 L129–L142）

```typescript
/** 事件路径是否落在 Monaco / CodeMirror（自有剪贴板方案，此处不接管） */
// 函数名使用 richEditorInEventPath，语义不够准确，容易与富文本编辑器混淆
function richEditorInEventPath(event: KeyboardEvent): boolean {
	// 遍历事件的 composedPath，检查路径中是否有目标编辑器节点
	for (const n of event.composedPath()) {
		// 如果当前节点不是 Element 类型，跳过继续检查下一个
		if (!(n instanceof Element)) continue;
		// 使用 closest 方法向上查找匹配 Monaco 编辑器或 CodeMirror 编辑器选择器的祖先节点
		if (n.closest?.('.monaco-editor, .monaco-diff-editor, .cm-editor')) {
			// 找到匹配节点，返回 true，表示事件落在代码编辑器内
			return true;
		}
		// 检查是否包含 native-edit-context 类名（某些编辑器的原生编辑上下文）
		if (n.classList.contains('native-edit-context')) return true;
		// 检查是否是 Monaco 编辑器的隐藏输入 textarea（inputarea 类名）
		if (n instanceof HTMLTextAreaElement && n.classList.contains('inputarea')) {
			// 是 Monaco 的输入区域，返回 true
			return true;
		}
	}
	// 遍历完路径未找到匹配节点，返回 false
	return false;
}
```

**改动后** · `apps/frontend/src/utils/clipboard.ts`（当前，约 L129–L142）

```typescript
/** 事件路径是否落在 Monaco / CodeMirror（自有剪贴板方案，此处不接管） */
// 函数名改为 monacoOrCodeMirrorInEventPath，语义更准确，明确指代代码编辑器
function monacoOrCodeMirrorInEventPath(event: KeyboardEvent): boolean {
	// 遍历事件的 composedPath，检查路径中是否有目标编辑器节点
	for (const n of event.composedPath()) {
		// 如果当前节点不是 Element 类型，跳过继续检查下一个
		if (!(n instanceof Element)) continue;
		// 使用 closest 方法向上查找匹配 Monaco 编辑器或 CodeMirror 编辑器选择器的祖先节点
		if (n.closest?.('.monaco-editor, .monaco-diff-editor, .cm-editor')) {
			// 找到匹配节点，返回 true，表示事件落在代码编辑器内
			return true;
		}
		// 检查是否包含 native-edit-context 类名（某些编辑器的原生编辑上下文）
		if (n.classList.contains('native-edit-context')) return true;
		// 检查是否是 Monaco 编辑器的隐藏输入 textarea（inputarea 类名）
		if (n instanceof HTMLTextAreaElement && n.classList.contains('inputarea')) {
			// 是 Monaco 的输入区域，返回 true
			return true;
		}
	}
	// 遍历完路径未找到匹配节点，返回 false
	return false;
}
```

**变更摘要**：函数名从 `richEditorInEventPath` 改为 `monacoOrCodeMirrorInEventPath`，函数内部逻辑完全不变，仅提升语义准确性，避免与 TipTap 等富文本编辑器混淆。

### 4.2 新增函数：`tipTapBodyInEventPath`

**对比范围**：纯新增函数，用于检测事件是否落在 TipTap/ProseMirror 正文 contenteditable 节点内。

**改动前** · `apps/frontend/src/utils/clipboard.ts`（基线，无此函数）

```typescript
// ...（未改动）—— 基线版本不存在该函数，此处省略前后文
```

**改动后** · `apps/frontend/src/utils/clipboard.ts`（当前，约 L144–L157）

```typescript
/**
 * TipTap / ProseMirror 正文 contenteditable（非标题原生 input）。
 * Tauri WebView 下系统 Cmd+C/V 往往无法作用到该类节点。
 */
// 定义函数 tipTapBodyInEventPath，接收键盘事件参数，返回 HTMLElement 或 null
function tipTapBodyInEventPath(event: KeyboardEvent): HTMLElement | null {
	// 遍历事件的 composedPath，检查路径中是否有 TipTap 正文节点
	for (const n of event.composedPath()) {
		// 如果当前节点不是 Element 类型，跳过继续检查下一个
		if (!(n instanceof Element)) continue;
		// 使用 closest 方法向上查找匹配 TipTap/ProseMirror 选择器的祖先节点
		// 选择器覆盖三种可能的类名组合情况
		const el = n.closest?.(
			'.tiptap.ProseMirror, .ProseMirror.tiptap, .rich-editor .tiptap[contenteditable="true"]',
		);
		// 检查找到的元素是否是 HTMLElement 且 isContentEditable 为 true
		if (el instanceof HTMLElement && el.isContentEditable) return el;
	}
	// 遍历完路径未找到符合条件的 TipTap 正文节点，返回 null
	return null;
}
```

**变更摘要**：新增 `tipTapBodyInEventPath` 函数，通过多重选择器匹配 TipTap/ProseMirror 正文节点，并验证 `isContentEditable` 为 true，确保只识别可编辑的正文区域。

### 4.3 主函数新增 TipTap 分支

**对比范围**：`attachTauriPlainFieldClipboardShortcuts` 函数内部的 `onKeyDown` 处理函数，在 Monaco/CodeMirror 判断之后、普通文本域判断之前，新增 TipTap 正文处理分支。

**改动前** · `apps/frontend/src/utils/clipboard.ts`（基线，约 L190–L323）

```typescript
/**
 * 仅在 Tauri 下挂载：为普通 input/textarea 接管 Cmd/Ctrl+C/V/X（走插件剪贴板），不拦截 Z。
 * Monaco / CodeMirror 有各自实现，此处跳过。
 * @returns 卸载函数
 */
// 导出函数 attachTauriPlainFieldClipboardShortcuts，返回一个卸载函数
export function attachTauriPlainFieldClipboardShortcuts(): () => void {
	// 检查是否在 Tauri 运行环境中
	if (!isTauriRuntime()) {
		// 非 Tauri 环境返回空函数，不做任何操作
		return () => {};
	}

	// 定义键盘按下事件处理函数 onKeyDown
	const onKeyDown = (event: KeyboardEvent) => {
		// 检查是否按下了 Ctrl 键或 Meta（Cmd）键，如果都没按则直接返回不处理
		if (!event.ctrlKey && !event.metaKey) return;

		// 获取按键的小写形式
		const key = event.key.toLowerCase();
		// 只处理 a、c、v、x、z 这几个键，其他键直接返回
		if (!['a', 'c', 'v', 'x', 'z'].includes(key)) return;

		// 撤销交给 WebView 原生，避免破坏输入栈
		if (key === 'z') return;

		// Monaco / CodeMirror：自有 Tauri 剪贴板扩展
		if (richEditorInEventPath(event)) return;

		/**
		 * 兜底：普通页面文本（非输入框/非富编辑器）选区复制
		 * - 目的：修复 Tauri WebView 中"选中文本但无法复制"的问题
		 * - 约束：不影响 input/textarea/contenteditable 的原生行为，也不影响 Monaco/CodeMirror
		 */
		// 如果是复制键且事件路径不在可编辑区域内
		if (key === 'c' && !editableInEventPath(event)) {
			// 获取当前选区对象
			const selection = window.getSelection?.();
			// 获取选区的文本内容
			const text = selection?.toString?.() ?? '';
			// 检查选区存在、未折叠（有选中文本）、文本非空
			if (selection && !selection.isCollapsed && text.trim()) {
				// 阻止默认行为
				event.preventDefault();
				// 异步写入剪贴板，不等待结果
				void writeClipText(text);
				// 处理完毕，返回
				return;
			}
		}

		// 获取当前活动元素
		const active = document.activeElement;

		// 获取活动元素引用
		const el = active;
		// 检查是否是普通文本输入框（input/textarea），不是则直接返回
		if (!isPlainTextField(el)) return;
		// 如果元素被禁用，直接返回
		if (el.disabled) return;

		// 全选操作
		if (key === 'a') {
			// 阻止默认行为
			event.preventDefault();
			// 让元素获得焦点
			el.focus();
			// 选中全部文本
			el.select();
			// 处理完毕，返回
			return;
		}

		// number/date 等部分类型无 selection API，不拦截
		// 获取选区起始位置
		const start = el.selectionStart;
		// 获取选区结束位置
		const end = el.selectionEnd;
		// 如果选区位置为 null（不支持 selection API），直接返回
		if (start === null || end === null) return;

		// 复制操作
		if (key === 'c') {
			// 阻止默认行为
			event.preventDefault();
			// 截取选中的文本
			const slice = el.value.slice(start, end);
			// 如果有选中文本，异步写入剪贴板
			if (slice) void writeClipText(slice);
			// 处理完毕，返回
			return;
		}

		// 剪切操作
		if (key === 'x') {
			// 如果元素是只读的，直接返回
			if (el.readOnly) return;
			// 阻止默认行为
			event.preventDefault();
			// 如果选区起始和结束位置相同（无选中文本），直接返回
			if (start === end) return;
			// 截取选中的文本
			const slice = el.value.slice(start, end);
			// 异步写入剪贴板
			void writeClipText(slice);
			// 拼接删除选中文本后的新值
			const next = el.value.slice(0, start) + el.value.slice(end);
			// 使用原生方式设置表单值，确保 React 能检测到更新
			setNativeFormValue(el, next);
			// 设置光标位置到原起始位置
			el.setSelectionRange(start, start);
			// 派发 input 事件，让 React 感知值变化
			dispatchInputForReact(el, 'deleteByCut', null);
			// 处理完毕，返回
			return;
		}

		// 粘贴操作
		if (key === 'v') {
			// 如果元素是只读的，直接返回
			if (el.readOnly) return;
			// 阻止默认行为
			event.preventDefault();
			// 保存当前元素引用，供异步回调使用
			const field = el;
			// 异步执行粘贴操作
			void (async () => {
				// 从剪贴板读取文本
				const text = await readClipText();
				// 如果读取过程中活动元素变化了，不执行粘贴
				if (document.activeElement !== field) return;
				// 获取当前选区起始位置，默认为 0
				const s = field.selectionStart ?? 0;
				// 获取当前选区结束位置，默认为 0
				const e = field.selectionEnd ?? 0;
				// 拼接粘贴后的新值
				const next = field.value.slice(0, s) + text + field.value.slice(e);
				// 使用原生方式设置表单值
				setNativeFormValue(field, next);
				// 计算光标位置（粘贴文本末尾）
				const pos = s + text.length;
				// 设置光标位置
				field.setSelectionRange(pos, pos);
				// 派发 input 事件，让 React 感知值变化
				dispatchInputForReact(field, 'insertFromPaste', text);
			})();
		}
	};

	// 在 document 上注册 keydown 事件监听器，使用捕获阶段
	document.addEventListener('keydown', onKeyDown, true);
	// 返回卸载函数，用于移除事件监听器
	return () => document.removeEventListener('keydown', onKeyDown, true);
}
```

**改动后** · `apps/frontend/src/utils/clipboard.ts`（当前，约 L190–L323）

```typescript
/**
 * 仅在 Tauri 下挂载：为普通 input/textarea 与 TipTap 正文接管 Cmd/Ctrl+C/V/X（走插件剪贴板），不拦截 Z。
 * Monaco / CodeMirror 有各自实现，此处跳过。
 * @returns 卸载函数
 */
// 导出函数 attachTauriPlainFieldClipboardShortcuts，返回一个卸载函数
export function attachTauriPlainFieldClipboardShortcuts(): () => void {
	// 检查是否在 Tauri 运行环境中
	if (!isTauriRuntime()) {
		// 非 Tauri 环境返回空函数，不做任何操作
		return () => {};
	}

	// 定义键盘按下事件处理函数 onKeyDown
	const onKeyDown = (event: KeyboardEvent) => {
		// 检查是否按下了 Ctrl 键或 Meta（Cmd）键，如果都没按则直接返回不处理
		if (!event.ctrlKey && !event.metaKey) return;

		// 获取按键的小写形式
		const key = event.key.toLowerCase();
		// 只处理 a、c、v、x、z 这几个键，其他键直接返回
		if (!['a', 'c', 'v', 'x', 'z'].includes(key)) return;

		// 撤销交给 WebView 原生，避免破坏输入栈
		if (key === 'z') return;

		// Monaco / CodeMirror：自有 Tauri 剪贴板扩展
		if (monacoOrCodeMirrorInEventPath(event)) return;

		/**
		 * 兜底：普通页面文本（非输入框/非富编辑器）选区复制
		 * - 目的：修复 Tauri WebView 中"选中文本但无法复制"的问题
		 * - 约束：不影响 input/textarea/contenteditable 的原生行为，也不影响 Monaco/CodeMirror
		 */
		// 如果是复制键且事件路径不在可编辑区域内
		if (key === 'c' && !editableInEventPath(event)) {
			// 获取当前选区对象
			const selection = window.getSelection?.();
			// 获取选区的文本内容
			const text = selection?.toString?.() ?? '';
			// 检查选区存在、未折叠（有选中文本）、文本非空
			if (selection && !selection.isCollapsed && text.trim()) {
				// 阻止默认行为
				event.preventDefault();
				// 异步写入剪贴板，不等待结果
				void writeClipText(text);
				// 处理完毕，返回
				return;
			}
		}

		// 获取当前活动元素
		const active = document.activeElement;

		// TipTap 正文：与 Sandpack CM 一样显式读写系统剪贴板
		// 标题区是原生 input，走下方 plain field 分支
		// 检测事件路径是否落在 TipTap 正文内
		const tipTapBody = tipTapBodyInEventPath(event);
		// 如果在 TipTap 正文内且当前活动元素不是普通文本域
		if (tipTapBody && !isPlainTextField(active)) {
			// 全选由编辑器自身快捷键处理，直接返回
			if (key === 'a') return; // 全选由编辑器自身快捷键处理

			// 复制操作
			if (key === 'c') {
				// 获取当前选区的文本内容，若无选区则为空字符串
				const text = window.getSelection()?.toString() ?? '';
				// 没有选中文本，直接返回
				if (!text) return;
				// 阻止默认行为
				event.preventDefault();
				// 异步写入剪贴板，不等待结果
				void writeClipText(text);
				// 处理完毕，返回
				return;
			}

			// 剪切操作
			if (key === 'x') {
				// 获取当前选区的文本内容，若无选区则为空字符串
				const text = window.getSelection()?.toString() ?? '';
				// 没有选中文本，直接返回
				if (!text) return;
				// 阻止默认行为
				event.preventDefault();
				// 异步写入剪贴板，不等待结果
				void writeClipText(text);
				// focus 回 TipTap 编辑器正文，确保后续操作作用于编辑器
				tipTapBody.focus();
				// 使用 execCommand 执行删除操作，让 ProseMirror 响应此命令
				document.execCommand('delete');
				// 处理完毕，返回
				return;
			}

			// 粘贴操作
			if (key === 'v') {
				// 阻止默认行为
				event.preventDefault();
				// 保存 TipTap 正文元素引用，供异步回调使用
				const root = tipTapBody;
				// 异步执行粘贴操作
				void (async () => {
					// 从剪贴板读取文本
					const text = await readClipText();
					// 如果文本为空或编辑器已从 DOM 中断开连接，不执行粘贴
					if (!text || !root.isConnected) return;
					// focus 回 TipTap 编辑器正文
					root.focus();
					// ProseMirror 仍响应 insertText，避免自造选区破坏事务
					// 使用 execCommand 执行插入文本操作
					document.execCommand('insertText', false, text);
				})();
			}
			// TipTap 分支处理完毕，返回
			return;
		}

		// 获取活动元素引用
		const el = active;
		// 检查是否是普通文本输入框（input/textarea），不是则直接返回
		if (!isPlainTextField(el)) return;
		// 如果元素被禁用，直接返回
		if (el.disabled) return;

		// 全选操作
		if (key === 'a') {
			// 阻止默认行为
			event.preventDefault();
			// 让元素获得焦点
			el.focus();
			// 选中全部文本
			el.select();
			// 处理完毕，返回
			return;
		}

		// number/date 等部分类型无 selection API，不拦截
		// 获取选区起始位置
		const start = el.selectionStart;
		// 获取选区结束位置
		const end = el.selectionEnd;
		// 如果选区位置为 null（不支持 selection API），直接返回
		if (start === null || end === null) return;

		// 复制操作
		if (key === 'c') {
			// 阻止默认行为
			event.preventDefault();
			// 截取选中的文本
			const slice = el.value.slice(start, end);
			// 如果有选中文本，异步写入剪贴板
			if (slice) void writeClipText(slice);
			// 处理完毕，返回
			return;
		}

		// 剪切操作
		if (key === 'x') {
			// 如果元素是只读的，直接返回
			if (el.readOnly) return;
			// 阻止默认行为
			event.preventDefault();
			// 如果选区起始和结束位置相同（无选中文本），直接返回
			if (start === end) return;
			// 截取选中的文本
			const slice = el.value.slice(start, end);
			// 异步写入剪贴板
			void writeClipText(slice);
			// 拼接删除选中文本后的新值
			const next = el.value.slice(0, start) + el.value.slice(end);
			// 使用原生方式设置表单值，确保 React 能检测到更新
			setNativeFormValue(el, next);
			// 设置光标位置到原起始位置
			el.setSelectionRange(start, start);
			// 派发 input 事件，让 React 感知值变化
			dispatchInputForReact(el, 'deleteByCut', null);
			// 处理完毕，返回
			return;
		}

		// 粘贴操作
		if (key === 'v') {
			// 如果元素是只读的，直接返回
			if (el.readOnly) return;
			// 阻止默认行为
			event.preventDefault();
			// 保存当前元素引用，供异步回调使用
			const field = el;
			// 异步执行粘贴操作
			void (async () => {
				// 从剪贴板读取文本
				const text = await readClipText();
				// 如果读取过程中活动元素变化了，不执行粘贴
				if (document.activeElement !== field) return;
				// 获取当前选区起始位置，默认为 0
				const s = field.selectionStart ?? 0;
				// 获取当前选区结束位置，默认为 0
				const e = field.selectionEnd ?? 0;
				// 拼接粘贴后的新值
				const next = field.value.slice(0, s) + text + field.value.slice(e);
				// 使用原生方式设置表单值
				setNativeFormValue(field, next);
				// 计算光标位置（粘贴文本末尾）
				const pos = s + text.length;
				// 设置光标位置
				field.setSelectionRange(pos, pos);
				// 派发 input 事件，让 React 感知值变化
				dispatchInputForReact(field, 'insertFromPaste', text);
			})();
		}
	};

	// 在 document 上注册 keydown 事件监听器，使用捕获阶段
	document.addEventListener('keydown', onKeyDown, true);
	// 返回卸载函数，用于移除事件监听器
	return () => document.removeEventListener('keydown', onKeyDown, true);
}
```

**变更摘要**：
1. 函数注释更新，新增「与 TipTap 正文」的描述。
2. `richEditorInEventPath` 调用改为 `monacoOrCodeMirrorInEventPath`（对应函数重命名）。
3. 在普通文本域处理之前，新增 TipTap 正文检测分支。
4. TipTap 分支内处理四种快捷键：
   - `a`：直接 return，交给编辑器自身处理
   - `c`：获取选区文本，写入系统剪贴板
   - `x`：获取选区文本写入剪贴板，然后通过 `execCommand('delete')` 删除
   - `v`：异步读取剪贴板，通过 `execCommand('insertText')` 插入文本

## 5. 兼容性与影响

### 5.1 行为变化

- **新增能力**：Tauri 桌面端下，TipTap 富文本编辑器正文区域现在支持系统级 Cmd/Ctrl+C/V/X 剪贴板快捷键。
- **全选行为**：Cmd/Ctrl+A 不接管，继续由 TipTap 编辑器自身的快捷键处理，确保选区逻辑符合编辑器预期。
- **标题区不受影响**：TipTap 编辑器的标题区是原生 input 元素，继续走下方的 plain field 分支。

### 5.2 兼容性

- **Web 端不受影响**：该功能仅在 Tauri 运行环境下挂载（`isTauriRuntime()` 判断），Web 浏览器环境行为完全不变。
- **Monaco/CodeMirror 不受影响**：代码编辑器在 TipTap 判断之前就已跳过，不进入 TipTap 分支。
- **普通 input/textarea 不受影响**：TipTap 分支在普通文本域判断之前，但有 `!isPlainTextField(active)` 条件保护，普通文本域不会进入 TipTap 分支。

### 5.3 风险与回归

- **execCommand 兼容性**：`document.execCommand` 虽已被标记为废弃，但在主流浏览器（包括 Tauri 使用的 WebView）中仍广泛支持，且 ProseMirror 内部也依赖这些命令。需关注未来 Tauri/WebView 版本是否移除该 API。
- **粘贴富文本格式**：当前实现只粘贴纯文本（`readClipText`），若剪贴板中有富文本格式（如加粗、链接等），粘贴后会丢失格式。这与 Tauri 系统剪贴板插件能力相关，如需富文本粘贴需额外开发。
- **选区丢失风险**：在异步读取剪贴板的过程中，用户可能改变了选区位置。当前实现通过 `root.focus()` 重新聚焦，但选区位置可能与触发粘贴时不一致。

### 5.4 建议测试路径

1. Tauri 桌面端 TipTap 编辑器中选中文字，按 Cmd/Ctrl+C 复制，粘贴到其他应用验证。
2. 从其他应用复制文字，在 Tauri 桌面端 TipTap 编辑器中按 Cmd/Ctrl+V 粘贴验证。
3. Tauri 桌面端 TipTap 编辑器中选中文字，按 Cmd/Ctrl+X 剪切，验证文字被删除且剪贴板有内容。
4. Tauri 桌面端 TipTap 编辑器中按 Cmd/Ctrl+A，验证全选行为由编辑器自身处理。
5. TipTap 编辑器标题区（原生 input）的复制粘贴验证，确认走 plain field 分支。
6. Web 浏览器端验证 TipTap 编辑器剪贴板行为不受影响。
7. Monaco/CodeMirror 编辑器剪贴板行为验证，确认仍走自身方案。

## 6. 相关源码路径

| 说明 | 路径 |
| ---- | ---- |
| 剪贴板工具函数主文件 | `apps/frontend/src/utils/clipboard.ts` |
| Tauri 运行环境检测 | `apps/frontend/src/utils/runtime.ts` |
| 学习笔记富文本编辑器 | `apps/frontend/src/views/english-learning/` |

---

若与仓库最新源码不一致，以源码为准。
