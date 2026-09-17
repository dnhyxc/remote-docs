# RichEditor 性能优化

## 1. 背景与目标

RichEditor 是基于 TipTap 二次封装的富文本编辑器，广泛用于学习笔记、知识库等场景。在实际使用中发现以下性能瓶颈：

1. **onUpdate 热路径开销大**：每次按键都会调用 `getJSON()` 进行完整序列化，但大部分业务场景只使用 html/text/title，不需要 JSON 数据。
2. **闭包捕获旧值问题**：`onChange` / `onCreate` 回调通过闭包引用，可能捕获到旧的 props 值，导致回调执行时数据不一致。
3. **CharacterCount 无差别挂载**：即使没有字数 UI 且没有字数限制，仍然挂载 CharacterCount 扩展，每次按键都会调用 `Intl.Segmenter` 进行分词统计，产生不必要的开销。
4. **toolbarExtra 重复计算**：`toolbarExtra` 在每次渲染时都重新计算，没有缓存。

本次优化的目标是：在不改变对外 API 行为的前提下，显著降低 RichEditor 的渲染与更新开销，特别是打字时的热路径性能。

## 2. 改动范围

| 模块 | 文件路径 |
| ---- | ---- |
| 主组件 | `apps/remote-plugins/src/components/design/RichEditor/index.tsx` |
| 类型定义 | `apps/remote-plugins/src/components/design/RichEditor/types.ts` |
| 扩展组装 | `apps/remote-plugins/src/components/design/RichEditor/extensions/index.ts` |
| 设计系统导出 | `apps/remote-plugins/src/components/design/index.ts` |

## 3. 实现思路

### 3.1 核心优化策略

1. **JSON 懒序列化**：将 `onUpdate` 回调中的 `json` 字段从必选改为可选，热路径默认不调用 `getJSON()`。需要 JSON 的调用方可自行从 editor 实例获取。
2. **回调 ref 化**：使用 `useRef` 保存最新的 `onChange` 和 `onCreate` 回调，避免闭包捕获旧值，同时保证每次渲染都能拿到最新函数引用。
3. **CharacterCount 按需挂载**：仅当 `showCharCount` 为 true 或设置了 `maxLength` 时才挂载 CharacterCount 扩展，从根源上避免无意义的 `Intl.Segmenter` 调用。
4. **toolbarExtra 记忆化**：使用 `useMemo` 缓存 `toolbarExtra` 的计算结果，仅在 `editor` 或 `toolbarExtra` 本身变化时重新计算。

### 3.2 权衡与决策

- **JSON 可选而非移除**：选择将 `json` 改为可选字段而非彻底移除，是为了保持向后兼容。已有代码如果依赖 `payload.json`，只需自行调用 `editor.getJSON()` 即可，迁移成本低。
- **默认开启 CharacterCount**：`characterCount` 选项默认值为 `true`（即 `options.characterCount !== false`），确保已有行为不变，只有显式传入 `false` 时才关闭。
- **ref 化而非 useCallback**：使用 `useRef` 模式比 `useCallback` + 依赖项更简洁，且完全避免了闭包陈旧问题，是 React 中处理"最新回调"的经典模式。

## 4. 关键代码对比与注释

### 4.1 onChange/onCreate ref 化 + JSON 懒序列化（index.tsx）

**对比范围**：`RichEditor` 组件函数内的 ref 声明、`onCreate` 回调、`onUpdate` 回调。

**改动前** · `apps/remote-plugins/src/components/design/RichEditor/index.tsx`（基线，约 L90–L155）

```tsx
// 合并默认中文 locale 与用户传入的部分 locale 配置
	const locale = useMemo(() => mergeLocale(localePartial), [localePartial]);

	// 图片解析函数的 ref，默认使用本地 FileReader 转 data URL
	const resolveImageSrcRef = useRef<ResolveImageSrc>(fileToDataUrl);
	// 每次渲染更新 ref.current，确保始终指向最新的上传函数
	resolveImageSrcRef.current = async (file) => {
		// 如果用户传入了 onUploadImage，则使用用户的上传逻辑
		if (onUploadImage) return onUploadImage(file);
		// 否则回退到本地 base64 方案
		return fileToDataUrl(file);
	};

	// 初始化 TipTap 编辑器实例
	const editor = useEditor({
		// 关闭立即渲染，提升首屏性能
		immediatelyRender: false,
		// 传入扩展配置
		extensions: createExtensions({
			// 占位符文本，优先用用户传入的，否则用 locale 中的默认值
			placeholder: placeholder ?? locale.placeholder,
			// 字数上限
			maxLength,
			// 自定义扩展（完全替换默认扩展）
			extensions,
			// 额外扩展（追加到默认扩展之后）
			extraExtensions,
			// 图片解析 ref
			resolveImageSrcRef,
		}),
		// 初始内容，归一化处理
		content: normalizeNoteContent(content ?? defaultContent),
		// 是否可编辑
		editable,
		// 是否自动聚焦
		autofocus,
		// 文本方向
		textDirection,
		// 编辑器 DOM 属性
		editorProps: {
			attributes: {
				// 编辑器类名
				class: cn('tiptap focus:outline-none', editorClassName),
				// 语言属性
				lang: 'zh-CN',
			},
		},
		// 编辑器创建完成回调
		onCreate: ({ editor: e }) => {
			// 定义聚焦到正文末尾的函数
			const focusBodyEnd = () => {
				// 如果编辑器已销毁，直接返回
				if (e.isDestroyed) return;
				// 如果第一个子节点是 title 节点
				if (e.state.doc.firstChild?.type.name === 'title') {
					// 聚焦到末尾
					e.commands.focus('end');
				}
			};
			// 首次执行聚焦
			focusBodyEnd();
			// Title NodeView 挂载可能打乱选区，下一帧再钉到末尾
			requestAnimationFrame(() => {
				// 第二帧聚焦
				focusBodyEnd();
				// 第三帧再聚焦一次，确保稳定
				requestAnimationFrame(focusBodyEnd);
			});
			// 调用用户传入的 onCreate 回调
			onCreate?.(e);
		},
		// 编辑器内容更新回调（每次按键都会触发）
		onUpdate: ({ editor: e }) => {
			// 如果没有传入 onChange 回调，直接返回
			if (!onChange) return;
			// 调用 onChange 回调，传入完整的 payload
			onChange({
				// HTML 格式内容
				html: e.getHTML(),
				// JSON 格式内容（每次都序列化，开销大）
				json: e.getJSON(),
				// 纯文本内容，块之间用两个换行分隔
				text: e.getText({ blockSeparator: '\n\n' }),
				// 文档标题（第一个 title 节点的纯文本）
				title: getDocTitleText(e.state.doc),
			});
		},
	});
```

**改动后** · `apps/remote-plugins/src/components/design/RichEditor/index.tsx`（当前，约 L90–L155）

```tsx
// 合并默认中文 locale 与用户传入的部分 locale 配置
	const locale = useMemo(() => mergeLocale(localePartial), [localePartial]);

	// 图片解析函数的 ref，默认使用本地 FileReader 转 data URL
	const resolveImageSrcRef = useRef<ResolveImageSrc>(fileToDataUrl);
	// 每次渲染更新 ref.current，确保始终指向最新的上传函数
	resolveImageSrcRef.current = async (file) => {
		// 如果用户传入了 onUploadImage，则使用用户的上传逻辑
		if (onUploadImage) return onUploadImage(file);
		// 否则回退到本地 base64 方案
		return fileToDataUrl(file);
	};

	// onChange 回调 ref 化，避免闭包捕获旧值
	const onChangeRef = useRef(onChange);
	// 每次渲染更新 ref.current，确保始终指向最新的 onChange
	onChangeRef.current = onChange;

	// onCreate 回调 ref 化，避免闭包捕获旧值
	const onCreateRef = useRef(onCreate);
	// 每次渲染更新 ref.current，确保始终指向最新的 onCreate
	onCreateRef.current = onCreate;

	// 无字数 UI 且无上限时不挂 CharacterCount，避免每键 Segmenter
	const enableCharacterCount = showCharCount || maxLength != null;

	// 初始化 TipTap 编辑器实例
	const editor = useEditor({
		// 关闭立即渲染，提升首屏性能
		immediatelyRender: false,
		// 传入扩展配置
		extensions: createExtensions({
			// 占位符文本，优先用用户传入的，否则用 locale 中的默认值
			placeholder: placeholder ?? locale.placeholder,
			// 字数上限
			maxLength,
			// 是否启用 CharacterCount 扩展
			characterCount: enableCharacterCount,
			// 自定义扩展（完全替换默认扩展）
			extensions,
			// 额外扩展（追加到默认扩展之后）
			extraExtensions,
			// 图片解析 ref
			resolveImageSrcRef,
		}),
		// 初始内容，归一化处理
		content: normalizeNoteContent(content ?? defaultContent),
		// 是否可编辑
		editable,
		// 是否自动聚焦
		autofocus,
		// 文本方向
		textDirection,
		// 编辑器 DOM 属性
		editorProps: {
			attributes: {
				// 编辑器类名
				class: cn('tiptap focus:outline-none', editorClassName),
				// 语言属性
				lang: 'zh-CN',
			},
		},
		// 编辑器创建完成回调
		onCreate: ({ editor: e }) => {
			// 定义聚焦到正文末尾的函数
			const focusBodyEnd = () => {
				// 如果编辑器已销毁，直接返回
				if (e.isDestroyed) return;
				// 如果第一个子节点是 title 节点
				if (e.state.doc.firstChild?.type.name === 'title') {
					// 聚焦到末尾
					e.commands.focus('end');
				}
			};
			// 首次执行聚焦
			focusBodyEnd();
			// Title NodeView 挂载可能打乱选区，下一帧再钉到末尾
			requestAnimationFrame(() => {
				// 第二帧聚焦
				focusBodyEnd();
				// 第三帧再聚焦一次，确保稳定
				requestAnimationFrame(focusBodyEnd);
			});
			// 通过 ref 调用最新的 onCreate 回调，避免闭包旧值
			onCreateRef.current?.(e);
		},
		// 编辑器内容更新回调（每次按键都会触发——热路径）
		onUpdate: ({ editor: e }) => {
			// 从 ref 获取最新的 onChange 回调
			const cb = onChangeRef.current;
			// 如果没有 onChange 回调，直接返回
			if (!cb) return;
			// 热路径不做 getJSON（学习笔记等只用 html/text/title）
			cb({
				// HTML 格式内容
				html: e.getHTML(),
				// 纯文本内容，块之间用两个换行分隔
				text: e.getText({ blockSeparator: '\n\n' }),
				// 文档标题（第一个 title 节点的纯文本）
				title: getDocTitleText(e.state.doc),
			});
		},
	});
```

**变更摘要**：
- 新增 `onChangeRef` 和 `onCreateRef` 两个 ref，每次渲染更新 `.current`，确保回调始终是最新的。
- `onUpdate` 中不再调用 `getJSON()`，`json` 字段从 payload 中移除（热路径优化）。
- `onCreate` 和 `onUpdate` 均通过 `ref.current` 调用回调，而非直接使用闭包变量。
- 新增 `enableCharacterCount` 计算变量，传入 `createExtensions` 的 `characterCount` 选项。

---

### 4.2 CharacterCount 按需挂载（extensions/index.ts + types.ts）

**对比范围**：`createExtensions` 函数及相关类型定义。

#### 4.2.1 types.ts 类型变更

**改动前** · `apps/remote-plugins/src/components/design/RichEditor/types.ts`（基线，约 L10–L31）

```typescript
// 编辑器内容变更时的 payload 类型
export type RichEditorChangePayload = {
	// HTML 格式的内容
	html: string;
	// JSON 格式的内容（ProseMirror 节点树）
	json: JSONContent;
	// 纯文本内容
	text: string;
	// 文档首位 title 节点纯文本
	title: string;
};

// createExtensions 函数的配置选项类型
export type CreateExtensionsOptions = {
	// 占位符文本
	placeholder?: string;
	// CharacterCount 上限；不传则只统计不限制
	maxLength?: number;
	// 粘贴/拖放图片解析（默认 FileReader → data URL）
	resolveImageSrcRef?: { current: ResolveImageSrc };
	// 追加扩展（在默认扩展之后）
	extraExtensions?: Extensions;
	// 完全替换默认扩展列表
	extensions?: Extensions;
};
```

**改动后** · `apps/remote-plugins/src/components/design/RichEditor/types.ts`（当前，约 L10–L31）

```typescript
// 编辑器内容变更时的 payload 类型
export type RichEditorChangePayload = {
	// HTML 格式的内容
	html: string;
	// 按需；热路径默认不序列化 JSON
	json?: JSONContent;
	// 纯文本内容
	text: string;
	// 文档首位 title 节点纯文本
	title: string;
};

// createExtensions 函数的配置选项类型
export type CreateExtensionsOptions = {
	// 占位符文本
	placeholder?: string;
	// CharacterCount 上限；不传则只统计不限制
	maxLength?: number;
	// 为 false 时不挂 CharacterCount（无字数 UI 且无上限时关掉，避免每键 Segmenter）
	characterCount?: boolean;
	// 粘贴/拖放图片解析（默认 FileReader → data URL）
	resolveImageSrcRef?: { current: ResolveImageSrc };
	// 追加扩展（在默认扩展之后）
	extraExtensions?: Extensions;
	// 完全替换默认扩展列表
	extensions?: Extensions;
};
```

**变更摘要**：
- `RichEditorChangePayload.json` 从必填改为可选（`json?`），并添加注释说明热路径默认不序列化。
- `CreateExtensionsOptions` 新增 `characterCount?: boolean` 选项，用于控制是否挂载 CharacterCount 扩展。

---

#### 4.2.2 extensions/index.ts 逻辑变更

**改动前** · `apps/remote-plugins/src/components/design/RichEditor/extensions/index.ts`（基线，约 L47–L152）

```typescript
// 组装默认扩展；业务可通过 extensions / extraExtensions 覆盖或追加
export function createExtensions(
	options: CreateExtensionsOptions = {},
): Extensions {
	// 如果用户传入了 extensions（完全替换），直接返回
	if (options.extensions) return options.extensions;

	// 占位符文本，优先用户传入，否则用中文默认值
	const placeholder = options.placeholder ?? zhCN.placeholder;
	// 图片解析 ref，优先用户传入，否则用默认的本地 base64 方案
	const resolveImageSrcRef = options.resolveImageSrcRef ?? {
		current: fileToDataUrl,
	};

	// 返回扩展数组
	return [
		// 自定义文档结构（title + block+）
		CustomDocument,
		// 标题节点扩展
		TitleNode,
		// Tab 缩进扩展
		TabIndent,
		// StarterKit 基础套件，关闭默认 document 和 codeBlock
		StarterKit.configure({
			document: false,
			trailingNode: {
				node: 'paragraph',
			},
			heading: { levels: [1, 2, 3, 4, 5] },
			codeBlock: false,
			link: {
				openOnClick: false,
				autolink: true,
				defaultProtocol: 'https',
				HTMLAttributes: {
					rel: 'noopener noreferrer',
					target: '_blank',
				},
			},
		}),
		// 代码块扩展（使用 lowlight 高亮）
		CodeBlockLowlight.configure({
			lowlight,
			defaultLanguage: 'javascript',
			enableTabIndentation: true,
			tabSize: 2,
			HTMLAttributes: { class: 'hljs' },
		}),
		// 占位符扩展
		Placeholder.configure({
			placeholder: ({ editor, node }) => {
				// 常驻 title NodeView 用自身 data-placeholder；此处只处理正文
				if (node.type.name === 'title') return '';
				// 标题节点的占位符带级别提示
				if (node.type.name === 'heading') {
					return `${zhCN.placeholderHeading} ${node.attrs.level}`;
				}
				// 忽略 editor 参数（类型要求但此处不用）
				void editor;
				// 其余节点用通用占位符
				return placeholder;
			},
			emptyEditorClass: 'is-editor-empty',
			emptyNodeClass: 'is-empty',
			showOnlyCurrent: true,
			showOnlyWhenEditable: true,
		}),
		// 高亮扩展（支持多色）
		Highlight.configure({ multicolor: true }),
		// 文本对齐扩展
		TextAlign.configure({
			types: ['heading', 'paragraph'],
			alignments: ['left', 'center', 'right', 'justify'],
		}),
		// 图片扩展
		Image.configure({
			inline: false,
			allowBase64: true,
			HTMLAttributes: { class: 'rich-editor-image' },
			resize: {
				enabled: true,
				alwaysPreserveAspectRatio: true,
			},
		}),
		// 图片上传扩展
		ImageUpload.configure({ resolveSrcRef: resolveImageSrcRef }),
		// 表格扩展套件
		TableKit.configure({
			table: { resizable: true },
		}),
		// 任务列表扩展
		TaskList,
		// 任务项扩展（支持嵌套）
		TaskItem.configure({ nested: true }),
		// 字数统计扩展（始终挂载）
		CharacterCount.configure({
			// 字数上限，不传则为 null（不限制）
			limit: options.maxLength ?? null,
			// 中文按字素计长；西文词 + CJK 字合计为「词」
			textCounter: (text) =>
				[
					...new Intl.Segmenter('zh', {
						granularity: 'grapheme',
					}).segment(text),
				].length,
			// 词数统计：CJK 字符数 + 西文单词数
			wordCounter: (text) => {
				// 统计 CJK 字符数量
				const cjk =
					text.match(
						/[\u4e00-\u9fff\u3400-\u4dbf\uf900-\ufaff]/g,
					)?.length ?? 0;
				// 统计西文单词数量
				const latin = text
					.replace(
						/[\u4e00-\u9fff\u3400-\u4dbf\uf900-\ufaff]/g,
						' ',
					)
					.split(/\s+/)
					.filter(Boolean).length;
				// 返回合计
				return cjk + latin;
			},
		}),
		// 追加用户传入的额外扩展
		...(options.extraExtensions ?? []),
	];
}
```

**改动后** · `apps/remote-plugins/src/components/design/RichEditor/extensions/index.ts`（当前，约 L47–L152）

```typescript
// 组装默认扩展；业务可通过 extensions / extraExtensions 覆盖或追加
export function createExtensions(
	options: CreateExtensionsOptions = {},
): Extensions {
	// 如果用户传入了 extensions（完全替换），直接返回
	if (options.extensions) return options.extensions;

	// 占位符文本，优先用户传入，否则用中文默认值
	const placeholder = options.placeholder ?? zhCN.placeholder;
	// 图片解析 ref，优先用户传入，否则用默认的本地 base64 方案
	const resolveImageSrcRef = options.resolveImageSrcRef ?? {
		current: fileToDataUrl,
	};
	// 默认开启；显式 false 时跳过（无字数 UI 且无上限）
	const withCharCount = options.characterCount !== false;

	// 返回扩展数组
	return [
		// 自定义文档结构（title + block+）
		CustomDocument,
		// 标题节点扩展
		TitleNode,
		// Tab 缩进扩展
		TabIndent,
		// StarterKit 基础套件，关闭默认 document 和 codeBlock
		StarterKit.configure({
			document: false,
			trailingNode: {
				node: 'paragraph',
			},
			heading: { levels: [1, 2, 3, 4, 5] },
			codeBlock: false,
			link: {
				openOnClick: false,
				autolink: true,
				defaultProtocol: 'https',
				HTMLAttributes: {
					rel: 'noopener noreferrer',
					target: '_blank',
				},
			},
		}),
		// 代码块扩展（使用 lowlight 高亮）
		CodeBlockLowlight.configure({
			lowlight,
			defaultLanguage: 'javascript',
			enableTabIndentation: true,
			tabSize: 2,
			HTMLAttributes: { class: 'hljs' },
		}),
		// 占位符扩展
		Placeholder.configure({
			placeholder: ({ editor, node }) => {
				// 常驻 title NodeView 用自身 data-placeholder；此处只处理正文
				if (node.type.name === 'title') return '';
				// 标题节点的占位符带级别提示
				if (node.type.name === 'heading') {
					return `${zhCN.placeholderHeading} ${node.attrs.level}`;
				}
				// 忽略 editor 参数（类型要求但此处不用）
				void editor;
				// 其余节点用通用占位符
				return placeholder;
			},
			emptyEditorClass: 'is-editor-empty',
			emptyNodeClass: 'is-empty',
			showOnlyCurrent: true,
			showOnlyWhenEditable: true,
		}),
		// 高亮扩展（支持多色）
		Highlight.configure({ multicolor: true }),
		// 文本对齐扩展
		TextAlign.configure({
			types: ['heading', 'paragraph'],
			alignments: ['left', 'center', 'right', 'justify'],
		}),
		// 图片扩展
		Image.configure({
			inline: false,
			allowBase64: true,
			HTMLAttributes: { class: 'rich-editor-image' },
			resize: {
				enabled: true,
				alwaysPreserveAspectRatio: true,
			},
		}),
		// 图片上传扩展
		ImageUpload.configure({ resolveSrcRef: resolveImageSrcRef }),
		// 表格扩展套件
		TableKit.configure({
			table: { resizable: true },
		}),
		// 任务列表扩展
		TaskList,
		// 任务项扩展（支持嵌套）
		TaskItem.configure({ nested: true }),
		// 条件挂载 CharacterCount：仅当 withCharCount 为 true 时才加入扩展数组
		...(withCharCount
			? [
					// 字数统计扩展
					CharacterCount.configure({
						// 字数上限，不传则为 null（不限制）
						limit: options.maxLength ?? null,
						// 中文按字素计长；西文词 + CJK 字合计为「词」
						textCounter: (text) =>
							[
								...new Intl.Segmenter('zh', {
									granularity: 'grapheme',
								}).segment(text),
							].length,
						// 词数统计：CJK 字符数 + 西文单词数
						wordCounter: (text) => {
							// 统计 CJK 字符数量
							const cjk =
								text.match(
									/[\u4e00-\u9fff\u3400-\u4dbf\uf900-\ufaff]/g,
								)?.length ?? 0;
							// 统计西文单词数量
							const latin = text
								.replace(
									/[\u4e00-\u9fff\u3400-\u4dbf\uf900-\ufaff]/g,
									' ',
								)
								.split(/\s+/)
								.filter(Boolean).length;
							// 返回合计
							return cjk + latin;
						},
					}),
				]
			: []),
		// 追加用户传入的额外扩展
		...(options.extraExtensions ?? []),
	];
}
```

**变更摘要**：
- 新增 `withCharCount` 变量，判断逻辑为 `options.characterCount !== false`，即默认开启，显式传 `false` 时关闭。
- CharacterCount 扩展从直接写入数组改为通过展开运算符条件加入：`...(withCharCount ? [CharacterCount.configure(...)] : [])`。
- 当 `characterCount` 为 `false` 时，完全不挂载 CharacterCount 扩展，从根源上避免 `Intl.Segmenter` 调用。

---

### 4.3 toolbarExtra useMemo 优化（index.tsx）

**对比范围**：`RichEditor` 组件内的 `toolbarExtra` 计算逻辑。

**改动前** · `apps/remote-plugins/src/components/design/RichEditor/index.tsx`（基线，约 L214–L222）

```tsx
// 创建编辑器上下文对象，用于跨组件传递 editor 实例
	const ctx = useMemo(() => ({ editor }), [editor]);

	// 计算工具栏尾部插槽内容
	const extra = !editor
		? null
		: typeof toolbarExtra === 'function'
		? toolbarExtra(editor)
		: toolbarExtra;
```

**改动后** · `apps/remote-plugins/src/components/design/RichEditor/index.tsx`（当前，约 L214–L222）

```tsx
// 创建编辑器上下文对象，用于跨组件传递 editor 实例
	const ctx = useMemo(() => ({ editor }), [editor]);

	// 工具栏尾部插槽内容，useMemo 缓存避免重复计算
	const extra = useMemo(() => {
		// 编辑器未初始化时返回 null
		if (!editor) return null;
		// 如果 toolbarExtra 是函数，调用它并传入 editor 实例
		// 否则直接返回 toolbarExtra 本身
		return typeof toolbarExtra === 'function'
			? toolbarExtra(editor)
			: toolbarExtra;
	}, [editor, toolbarExtra]);
```

**变更摘要**：
- `toolbarExtra` 的计算逻辑用 `useMemo` 包裹，依赖项为 `[editor, toolbarExtra]`。
- 仅当 `editor` 或 `toolbarExtra` 变化时才重新计算，避免每次渲染都执行函数调用或创建新的 ReactNode 引用。

---

### 4.4 Loading 组件导出（index.ts）

**对比范围**：`design` 模块的导出入口。

**改动前** · `apps/remote-plugins/src/components/design/index.ts`（基线，全部内容）

```typescript
// 导出 NotePreview 相关类型
export type { NotePreviewProps } from './NotePreview';
// 导出 NotePreview 组件和工具函数
export { NotePreview, stripNoteTitleHtml } from './NotePreview';
// 导出 RichEditor 相关类型
export type {
	CodeLanguage,
	CreateExtensionsOptions,
	RichEditorChangePayload,
	RichEditorContent,
	RichEditorLocale,
	RichEditorProps,
	TextDirection,
} from './RichEditor';
// 导出 RichEditor 组件和相关工具
export {
	CODE_LANGUAGES,
	createExtensions,
	getDocTitleText,
	RichEditor as default,
	RichEditor,
	TitleNode,
	zhCN,
} from './RichEditor';
```

**改动后** · `apps/remote-plugins/src/components/design/index.ts`（当前，全部内容）

```typescript
// 导入 Loading 组件（用于默认导出）
import Loading from './Loading';

// 导出 NotePreview 相关类型
export type { NotePreviewProps } from './NotePreview';
// 导出 NotePreview 组件和工具函数
export { NotePreview, stripNoteTitleHtml } from './NotePreview';
// 导出 RichEditor 相关类型
export type {
	CodeLanguage,
	CreateExtensionsOptions,
	RichEditorChangePayload,
	RichEditorContent,
	RichEditorLocale,
	RichEditorProps,
	TextDirection,
} from './RichEditor';
// 导出 RichEditor 组件和相关工具
export {
	CODE_LANGUAGES,
	createExtensions,
	getDocTitleText,
	RichEditor as default,
	RichEditor,
	TitleNode,
	zhCN,
} from './RichEditor';
// 导出 Loading 组件的所有命名导出
export * from './Loading';
```

**变更摘要**：
- 新增 `import Loading from './Loading'` 语句（用于默认导出兼容）。
- 新增 `export * from './Loading'` 语句，导出 Loading 组件的所有命名导出。
- 方便外部通过 `design` 统一入口使用 Loading 组件。

## 5. 兼容性与影响

### 5.1 向后兼容性

| 变更点 | 兼容性 | 说明 |
| ---- | ---- | ---- |
| `payload.json` 改为可选 | 完全兼容 | TypeScript 类型从必填变可选，运行时字段缺失不影响已有解构代码（值为 `undefined`）。如需 JSON，调用方可自行调用 `editor.getJSON()`。 |
| CharacterCount 默认开启 | 完全兼容 | `characterCount` 选项默认为 `true`（`options.characterCount !== false`），已有行为不变。 |
| 回调 ref 化 | 完全兼容 | 对外 API 不变，只是内部实现方式优化。 |
| toolbarExtra useMemo | 完全兼容 | 行为一致，仅性能优化。 |

### 5.2 性能收益

1. **打字热路径**：移除 `getJSON()` 调用后，每次按键减少一次完整的 ProseMirror 文档树序列化，对于长文档收益显著。
2. **CharacterCount 按需挂载**：无字数 UI 且无字数限制的场景下，完全跳过 `Intl.Segmenter` 分词，每次按键减少一次字符串遍历。
3. **toolbarExtra 记忆化**：避免不必要的函数调用和 ReactNode 重建，减少 Toolbar 组件的重渲染。

### 5.3 风险与回归

- **风险点**：依赖 `payload.json` 的旧代码如果直接访问 `payload.json.xxx` 可能报错。但 TypeScript 类型已标记为可选，编译期会有提示。
- **回归建议**：
  - 测试打字场景下的性能（长文档）。
  - 测试 `showCharCount={false}` 且无 `maxLength` 时，字数统计相关功能是否正常关闭。
  - 测试 `onChange` 回调中是否有代码依赖 `payload.json`。
  - 测试 `onCreate` 回调是否正常触发且能拿到最新 props。

## 6. 相关源码路径

| 说明 | 路径 |
| ---- | ---- |
| RichEditor 主组件 | `apps/remote-plugins/src/components/design/RichEditor/index.tsx` |
| 类型定义 | `apps/remote-plugins/src/components/design/RichEditor/types.ts` |
| 扩展组装 | `apps/remote-plugins/src/components/design/RichEditor/extensions/index.ts` |
| 设计系统导出入口 | `apps/remote-plugins/src/components/design/index.ts` |

---

（若与仓库最新源码不一致，以源码为准）
