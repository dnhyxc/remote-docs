# 学习笔记富文本编辑器 — 源码级实现手册

> **状态**：实现归档 | **日期**：2026-07-24 | **适用范围**：`apps/remote-plugins` 子项目 · `RichEditor` 设计系统组件

---

## 0. 读本文你将得到什么

本文是 **源码级逐行详解手册**，覆盖学习笔记富文本编辑器的 **全部 15 个文件**，每一行代码的意图、输入输出、边界处理都有详细中文注释。读完本文你将能够：

- 从 0 到 1 理解 Tiptap 3.x 富文本编辑器的完整封装思路
- 看懂每一个自定义扩展（Title 节点、图片上传、Tab 缩进等）的实现原理
- 掌握工具栏响应式折叠、气泡菜单、链接表单等交互的细节实现
- 理解 ProseMirror Plugin、Transaction、NodeView 等核心概念的实际应用
- 直接复用或移植这套编辑器到你的项目中

---

## 1. 文件总览

### 1.1 RichEditor 组件目录结构

```
apps/remote-plugins/src/components/design/RichEditor/
├── index.tsx              # 主组件：RichEditor 封装
├── types.ts               # 类型定义：Props / ChangePayload / ExtensionsOptions
├── locale.ts              # 中文字典
├── styles.css             # 编辑器全部样式
├── extensions/            # 扩展配置
│   └── index.ts           # Tiptap 扩展组装：13 个扩展 + 自定义 3 个
├── title/                 # 标题节点
│   ├── TitleNode.ts       # 自定义 Title atom 节点 + 工具函数
│   ├── Title.tsx          # Title NodeView（React 组件）
│   └── index.ts           # 统一导出
├── toolbar/               # 工具栏
│   ├── Toolbar.tsx        # 顶部工具栏：响应式 + 更多折叠
│   ├── FormatBubble.tsx   # 选区气泡菜单
│   └── index.ts           # 统一导出
├── link/                  # 链接相关
│   ├── LinkForm.tsx       # 链接输入表单 + useLinkEditor Hook
│   ├── linkRange.ts       # 设链目标范围解析
│   └── index.ts           # 统一导出
├── image/                 # 图片相关
│   ├── image.ts           # 图片工具函数
│   ├── ImageUpload.ts     # 粘贴/拖放图片上传扩展
│   └── index.ts           # 统一导出
└── code/                  # 代码块相关
    ├── languages.ts       # 代码高亮语言列表
    └── index.ts           # 统一导出
```

### 1.2 相关文件

| 文件 | 作用 |
|------|------|
| `design/NotePreview/index.tsx` | 笔记只读预览组件 |
| `views/learning-notes/index.tsx` | 学习笔记主应用（组装编辑器+列表+分栏） |

---

## 2. 类型定义（types.ts）

**来源**：`apps/remote-plugins/src/components/design/RichEditor/types.ts`（共 62 行）

### 2.1 完整代码与逐行注释

```typescript
// 从 @tiptap/react 导入 Editor 类型（编辑器实例）、Extensions 类型（扩展数组）、JSONContent 类型（JSON 格式的文档内容）
import type { Editor, Extensions, JSONContent } from '@tiptap/react';
// 从 React 导入 ReactNode 类型（React 节点，用于插槽/children）
import type { ReactNode } from 'react';
// 从本地 image 模块导入 ResolveImageSrc 类型（图片上传解析函数）
import type { ResolveImageSrc } from './image';
// 从本地 locale 模块导入 RichEditorLocale 类型（国际化字典类型）
import type { RichEditorLocale } from './locale';

// 文本方向类型：从左到右 / 从右到左 / 自动检测
export type TextDirection = 'ltr' | 'rtl' | 'auto';

// 编辑器内容类型：支持 HTML 字符串或 JSONContent 对象两种格式
export type RichEditorContent = string | JSONContent;

// 内容变化时的回调参数类型：四种格式同时返回，方便业务按需取用
export type RichEditorChangePayload = {
	// HTML 字符串格式：方便直接渲染到预览或存储
	html: string;
	// 按需；热路径默认不序列化 JSON
	// JSON 对象格式：ProseMirror 的 JSON 表示，结构化数据便于操作
	json?: JSONContent;
	// 纯文本格式：用于空值判断、字数统计、搜索等
	text: string;
	// 文档首位 title 节点的纯文本：笔记标题，单独提取方便列表展示
	title: string;
};

// createExtensions 函数的配置选项类型
export type CreateExtensionsOptions = {
	// 占位提示文本（显示在空编辑器中）
	placeholder?: string;
	// 字符数上限；不传则只统计不限制
	maxLength?: number;
	// 为 false 时不挂 CharacterCount（无字数 UI 且无上限时关掉，避免每键 Segmenter）
	characterCount?: boolean;
	// 粘贴/拖放图片的解析函数引用（用 ref 包一层，避免扩展重建）
	resolveImageSrcRef?: { current: ResolveImageSrc };
	// 追加扩展：在默认扩展列表之后追加，不覆盖默认扩展
	extraExtensions?: Extensions;
	// 完全替换默认扩展列表：传入后默认扩展全部不用
	extensions?: Extensions;
	// 是否显示笔记标题节点（默认 true）
	// 为 false 时不挂 CustomDocument 和 TitleNode，StarterKit 用默认 document
	showTitle?: boolean;
};

// RichEditor 组件的 Props 类型定义
export type RichEditorProps = {
	// 受控内容（HTML 或 JSON）：外部控制编辑器内容时使用
	content?: RichEditorContent;
	// 非受控初始内容：只在首次挂载时生效，之后内部自行管理
	defaultContent?: RichEditorContent;
	// 内容变化回调：每次编辑都会触发，携带四种格式的内容
	onChange?: (payload: RichEditorChangePayload) => void;
	// 是否可编辑：true 为编辑模式，false 为只读预览
	editable?: boolean;
	// 自动聚焦：支持布尔值或 'start'/'end'/'all'/数字位置
	autofocus?: boolean | 'start' | 'end' | 'all' | number;
	// 占位提示文本：空编辑器时显示的灰色提示
	placeholder?: string;
	// 容器自定义类名：用于外层布局调整
	className?: string;
	// 编辑器正文自定义类名：用于正文样式微调
	editorClassName?: string;
	// 字数上限：到达后禁止继续输入，右下角变红
	maxLength?: number;
	// 默认文本方向：默认 auto 以支持 RTL（阿拉伯语/希伯来语等）
	textDirection?: TextDirection;
	// 是否显示顶部工具栏
	showToolbar?: boolean;
	// 是否显示选中气泡菜单
	showBubbleMenu?: boolean;
	// 是否显示底部字数统计
	showCharCount?: boolean;
	// 是否显示笔记标题节点（默认 true）
	// 透传给 createExtensions 的 showTitle 选项
	showTitle?: boolean;
	// 覆盖/合并文案：默认中文，可传入部分字段覆盖
	locale?: Partial<RichEditorLocale>;
	// 完全替换默认扩展：传入后所有默认扩展都不用
	extensions?: Extensions;
	// 在默认扩展后追加：不影响默认扩展，只新增
	extraExtensions?: Extensions;
	// 工具栏尾部插槽：业务方注入自定义按钮（保存、列表开关等）
	// 支持 ReactNode 或函数形式（函数可拿到 editor 实例）
	toolbarExtra?: ReactNode | ((editor: Editor) => ReactNode);
	// 自定义图片上传函数：工具栏选图/粘贴/拖放都会走这里
	// 不传则本地读成 base64 data URL（Tauri 桌面端可用）
	onUploadImage?: ResolveImageSrc;
	// 编辑器创建完成回调：拿到 editor 实例后可做自定义初始化
	onCreate?: (editor: Editor) => void;
};
```

---

## 3. 国际化字典（locale.ts）

**来源**：`apps/remote-plugins/src/components/design/RichEditor/locale.ts`（共 60 行）

### 3.1 完整代码与逐行注释

```typescript
// 富文本编辑器中文文案对象（默认语言）
// 使用 as const 确保类型是字面量类型，便于 RichEditorLocale 精确推导
export const zhCN = {
	// 正文占位提示
	placeholder: '开始输入…',
	// 标题输入框的占位提示
	placeholderHeadingHint: '请输入笔记标题',
	// 各级标题的占位前缀（如「标题 1」「标题 2」）
	placeholderHeading: '标题',
	// 粗体按钮标题
	bold: '粗体',
	// 斜体按钮标题
	italic: '斜体',
	// 下划线按钮标题
	underline: '下划线',
	// 删除线按钮标题
	strike: '删除线',
	// 行内代码按钮标题
	code: '行内代码',
	// 高亮按钮标题
	highlight: '高亮',
	// 一级标题
	h1: '一级标题',
	// 二级标题
	h2: '二级标题',
	// 三级标题
	h3: '三级标题',
	// 四级标题
	h4: '四级标题',
	// 五级标题
	h5: '五级标题',
	// 无序列表
	bulletList: '无序列表',
	// 有序列表
	orderedList: '有序列表',
	// 任务列表（复选框）
	taskList: '任务列表',
	// 引用块
	blockquote: '引用',
	// 代码块
	codeBlock: '代码块',
	// 代码语言选择
	codeLanguage: '代码语言',
	// 水平分隔线
	horizontalRule: '分隔线',
	// 左对齐
	alignLeft: '左对齐',
	// 居中对齐
	alignCenter: '居中',
	// 右对齐
	alignRight: '右对齐',
	// 两端对齐
	alignJustify: '两端对齐',
	// 从左到右（RTL 模式用）
	dirLtr: '从左到右',
	// 从右到左
	dirRtl: '从右到左',
	// 自动方向
	dirAuto: '自动方向',
	// 链接按钮
	link: '链接',
	// 移除链接按钮
	unlink: '移除链接',
	// 链接表单的标签文本
	linkPrompt: '链接地址',
	// 链接输入框占位符
	linkPlaceholder: 'https://example.com',
	// 链接应用按钮
	linkApply: '确定',
	// 链接取消按钮
	linkCancel: '取消',
	// 空行无法设链时的提示
	linkEmptyHint: '请先选中文字，或将光标放在要加链接的内容上',
	// 图片按钮
	image: '图片',
	// 选择本地图片按钮
	imagePick: '选择本地图片',
	// 插入表格按钮
	table: '插入表格',
	// 左侧插入列
	addColumnBefore: '左侧插入列',
	// 右侧插入列
	addColumnAfter: '右侧插入列',
	// 删除列
	deleteColumn: '删除列',
	// 上方插入行
	addRowBefore: '上方插入行',
	// 下方插入行
	addRowAfter: '下方插入行',
	// 删除行
	deleteRow: '删除行',
	// 合并单元格
	mergeCells: '合并单元格',
	// 拆分单元格
	splitCell: '拆分单元格',
	// 删除表格
	deleteTable: '删除表格',
	// 撤销
	undo: '撤销',
	// 重做
	redo: '重做',
	// 清除格式
	clearFormat: '清除格式',
	// 字符数标签
	chars: '字符',
	// 词数标签
	words: '词',
	// 达到字数上限的提示
	limitReached: '已达字数上限',
// 使用 as const 断言，确保类型为字面量只读类型
} as const;

// 从 zhCN 的类型推导 RichEditorLocale 类型，保证字典和类型永远同步
export type RichEditorLocale = typeof zhCN;

// 字典的 key 联合类型，便于按需引用单个字段
export type LocaleKey = keyof RichEditorLocale;
```

### 3.2 设计要点

1. **类型推导模式**：先定义 `zhCN` 常量（带 `as const`），再用 `typeof zhCN` 推导类型。这样**永远不会出现类型和值不同步**的问题——新增字段只需改常量，类型自动更新。
2. **完全中文默认**：编辑器默认全中文 UI，不需要额外配置语言。
3. **部分覆盖**：`RichEditorProps.locale` 是 `Partial<RichEditorLocale>`，业务方只需传入要修改的几个字段，其余默认中文。

---

## 4. 代码高亮语言列表（languages.ts）

**来源**：`apps/remote-plugins/src/components/design/RichEditor/code/languages.ts`（共 24 行）

### 4.1 完整代码与逐行注释

```typescript
// 代码块语法高亮支持的主流语言列表（中文标签已在 UI 中不需要，保留英文标签）
// 使用 as const 确保是字面量只读数组
export const CODE_LANGUAGES = [
	// JavaScript：最常用的前端语言
	{ value: 'javascript', label: 'JavaScript' },
	// TypeScript：JavaScript 的超集，带类型
	{ value: 'typescript', label: 'TypeScript' },
	// HTML：超文本标记语言
	{ value: 'html', label: 'HTML' },
	// CSS：层叠样式表
	{ value: 'css', label: 'CSS' },
	// Less：CSS 预处理器
	{ value: 'less', label: 'Less' },
	// SCSS：Sass 的一种语法
	{ value: 'scss', label: 'SCSS' },
	// Rust：系统级编程语言
	{ value: 'rust', label: 'Rust' },
	// Python：解释型编程语言
	{ value: 'python', label: 'Python' },
	// C：底层编程语言
	{ value: 'c', label: 'C' },
	// Java：面向对象编程语言
	{ value: 'java', label: 'Java' },
	// JSON：数据交换格式
	{ value: 'json', label: 'JSON' },
	// Go：Google 开发的编程语言
	{ value: 'go', label: 'Go' },
	// SQL：结构化查询语言
	{ value: 'sql', label: 'SQL' },
	// Wasm：WebAssembly
	{ value: 'wasm', label: 'Wasm' },
	// PHP：服务器端脚本语言
	{ value: 'php', label: 'PHP' },
	// Ruby：动态编程语言
	{ value: 'ruby', label: 'Ruby' },
	// Markdown：轻量级标记语言
	{ value: 'markdown', label: 'Markdown' },
	// Shell：Shell 脚本
	{ value: 'shell', label: 'Shell' },
	// Bash：Bash 脚本
	{ value: 'bash', label: 'Bash' },
// as const 断言，使数组元素类型为字面量类型（用于 CodeLanguage 类型推导）
] as const;

// 从 CODE_LANGUAGES 推导 CodeLanguage 类型：所有 value 的联合类型
// 例如：'javascript' | 'typescript' | 'html' | ...
export type CodeLanguage = (typeof CODE_LANGUAGES)[number]['value'];
```

---

## 5. 图片工具函数（image.ts）

**来源**：`apps/remote-plugins/src/components/design/RichEditor/image/image.ts`（共 70 行）

### 5.1 模块职责

提供图片相关的纯工具函数：
- 本地文件 → data URL 转换
- 系统文件选择器唤起
- 剪贴板/拖放图片提取
- 批量插入图片到编辑器

### 5.2 完整代码与逐行注释

```typescript
// 从 @tiptap/react 导入 Editor 类型，用于函数参数类型标注
import type { Editor } from '@tiptap/react';

// 本地 File 对象 → data URL（base64）的 Promise 封装
// 默认插图方式：兼容 Tauri WebView，因为 Tauri 环境可能没有 CDN 或后端上传
export function fileToDataUrl(file: File): Promise<string> {
	// 返回 Promise，异步读取文件
	return new Promise((resolve, reject) => {
		// 创建 FileReader 实例用于读取文件
		const reader = new FileReader();
		// 读取成功时：将 result 转成字符串并 resolve
		reader.onload = () => resolve(String(reader.result));
		// 读取失败时：reject 错误对象，没有则构造一个
		reader.onerror = () => reject(reader.error ?? new Error('read failed'));
		// 开始读取文件为 data URL（base64 格式）
		reader.readAsDataURL(file);
	});
}

// 唤起系统文件选择器，让用户选一张本地图片
// 不用 window.prompt 或自定义 UI，直接用原生 input[type=file]
export function pickImageFile(accept = 'image/*'): Promise<File | null> {
	// 返回 Promise：用户选择后 resolve，取消也 resolve(null)
	return new Promise((resolve) => {
		// 动态创建 input 元素（不插入 DOM，用完即销毁）
		const input = document.createElement('input');
		// 设置为文件选择类型
		input.type = 'file';
		// 限制可选文件类型（默认 image/* 即所有图片）
		input.accept = accept;
		// 不允许多选
		input.multiple = false;
		// 防止重复 resolve（有些浏览器 change 和 cancel 可能都触发）
		let settled = false;
		// 完成回调：确保只调用一次 resolve
		const done = (file: File | null) => {
			// 已经 resolve 过就直接返回，防止重复
			if (settled) return;
			// 标记为已完成
			settled = true;
			// resolve 结果
			resolve(file);
		};
		// 用户选择文件后触发：取第一个文件，没有就传 null
		input.onchange = () => done(input.files?.[0] ?? null);
		// Chromium / Tauri WebView 支持 cancel 事件：用户点取消也回调
		input.addEventListener('cancel', () => done(null));
		// 模拟点击，唤起文件选择对话框
		input.click();
	});
}

// 判断一个 File 是否是图片类型
export function isImageFile(file: File): boolean {
	// 通过 MIME type 前缀判断：image/png、image/jpeg、image/gif 等
	return file.type.startsWith('image/');
}

// 从剪贴板事件中提取图片文件数组
export function clipboardImageFiles(event: ClipboardEvent): File[] {
	// 获取剪贴板数据项列表（DataTransferItemList）
	const items = event.clipboardData?.items;
	// 没有数据项直接返回空数组
	if (!items) return [];
	// 准备输出数组
	const out: File[] = [];
	// 遍历所有剪贴板项
	for (let i = 0; i < items.length; i++) {
		// 取当前项
		const item = items[i];
		// 不是图片类型就跳过
		if (!item?.type.startsWith('image/')) continue;
		// 将 DataTransferItem 转成 File 对象
		const file = item.getAsFile();
		// 转换成功就加入结果数组
		if (file) out.push(file);
	}
	// 返回所有图片文件
	return out;
}

// 从 DataTransfer（拖放事件的 dataTransfer）中提取图片文件
export function dataTransferImageFiles(dt: DataTransfer | null): File[] {
	// 没有 dataTransfer 或 files 为空，返回空数组
	if (!dt?.files?.length) return [];
	// 转成数组后过滤，只保留图片文件
	return [...dt.files].filter(isImageFile);
}

// 图片 URL 解析函数类型：输入 File，输出 URL 字符串或 Promise
// 支持同步或异步返回，返回 null/undefined/空串表示不插入
export type ResolveImageSrc = (
	file: File,
) => string | Promise<string | null | undefined>;

// 批量插入图片到编辑器
// 遍历文件列表，逐个解析 src 后插入到当前光标位置
export async function insertImages(
	// Tiptap 编辑器实例
	editor: Editor,
	// 要插入的图片文件数组
	files: File[],
	// 图片 src 解析函数（base64 或上传到 CDN）
	resolveSrc: ResolveImageSrc,
): Promise<void> {
	// 遍历每个文件
	for (const file of files) {
		// 不是图片就跳过（双重保险，调用方可能已经过滤过）
		if (!isImageFile(file)) continue;
		// 调用解析函数获取图片 URL（可能是 base64 或 CDN 地址）
		const src = await resolveSrc(file);
		// src 为空或空白就跳过（上传失败时不插入）
		if (!src?.trim()) continue;
		// 使用 Tiptap chain API：聚焦 → 插入图片 → 执行
		// alt 属性用文件名，方便辅助技术和导出
		editor.chain().focus().setImage({ src: src.trim(), alt: file.name }).run();
	}
}
```

---

## 6. 图片上传扩展（ImageUpload.ts）

**来源**：`apps/remote-plugins/src/components/design/RichEditor/image/ImageUpload.ts`（共 56 行）

### 6.1 模块职责

自定义 Tiptap 扩展，拦截 **粘贴** 和 **拖放** 事件，自动将图片插入编辑器。

### 6.2 设计要点

- **通过 ref 读上传函数**：`resolveSrcRef.current` 而非直接存 options。因为 `useEditor` 的扩展只在首次创建时组装，props 变化不会重建扩展。用 ref 可以让上传实现动态更新而不重建编辑器。
- **只处理图片，不拦截文字**：`handlePaste` 返回 false 时走默认粘贴行为，返回 true 时表示已处理。

### 6.3 完整代码与逐行注释

```typescript
// 从 @tiptap/core 导入 Extension 基类，用于创建自定义扩展
import { Extension } from '@tiptap/core';
// 从 ProseMirror state 导入 Plugin 和 PluginKey，用于创建状态插件
import { Plugin, PluginKey } from '@tiptap/pm/state';
// 导入图片相关工具函数
import {
	clipboardImageFiles,
	dataTransferImageFiles,
	fileToDataUrl,
	insertImages,
	type ResolveImageSrc,
} from './image';

// ImageUpload 扩展的配置选项类型
export type ImageUploadOptions = {
	// 可变引用：始终读取最新的上传实现（默认 FileReader → data URL）
	// 用 ref 而不是直接传函数，是因为扩展只在创建时组装一次
	// 后续 onUploadImage prop 变化时，只需更新 ref.current 即可
	resolveSrcRef: { current: ResolveImageSrc };
};

// 图片上传扩展：粘贴 / 拖放本地图片到编辑器时自动插入
// 通过 ref 读上传函数，避免 useEditor 扩展不随 props 重建的问题
export const ImageUpload = Extension.create<ImageUploadOptions>({
	// 扩展名称，唯一标识
	name: 'imageUpload',

	// 定义默认选项
	addOptions() {
		return {
			// 默认用 base64 方式读取
			resolveSrcRef: { current: fileToDataUrl },
		};
	},

	// 添加 ProseMirror 插件（处理底层事件）
	addProseMirrorPlugins() {
		// 拿到编辑器实例
		const editor = this.editor;
		// 从 options 中解构出 resolveSrcRef
		const { resolveSrcRef } = this.options;

		// 返回插件数组
		return [
			// 创建一个新的 ProseMirror Plugin
			new Plugin({
				// 插件 key，用于在 state 中查找此插件
				key: new PluginKey('imageUpload'),
				// 插件属性：定义事件处理
				props: {
					// 处理粘贴事件
					handlePaste(_view, event) {
						// 从剪贴板提取图片文件
						const files = clipboardImageFiles(event);
						// 没有图片就返回 false，让 ProseMirror 走默认粘贴逻辑
						if (!files.length) return false;
						// 阻止默认粘贴行为
						event.preventDefault();
						// 异步插入图片（void 表示不等待，不阻塞粘贴事件）
						void insertImages(editor, files, (f) => resolveSrcRef.current(f));
						// 返回 true 表示已处理此事件
						return true;
					},
					// 处理拖放事件
					handleDrop(_view, event, _slice, moved) {
						// 如果是编辑器内部移动（moved=true），不处理，走默认拖拽排序
						if (moved) return false;
						// 从拖放数据中提取图片文件
						const files = dataTransferImageFiles(event.dataTransfer);
						// 没有图片就返回 false，走默认拖放逻辑
						if (!files.length) return false;
						// 阻止默认拖放行为
						event.preventDefault();
						// 异步插入图片
						void insertImages(editor, files, (f) => resolveSrcRef.current(f));
						// 返回 true 表示已处理
						return true;
					},
				},
			}),
		];
	},
});
```

---

## 7. 链接范围解析（linkRange.ts）

**来源**：`apps/remote-plugins/src/components/design/RichEditor/link/linkRange.ts`（共 86 行）

### 7.1 模块职责

解析「设链目标」——用户点链接按钮时，应该给哪段文字加链接？

对齐常见富文本行为（飞书/Notion/语雀）：
1. 已有文本选区 → 用选区
2. 光标在已有链接内 → 扩展到整段 link mark
3. 光标落在词/连续非空白内 → 扩展到该词（含中文连续字）
4. 否则 → 扩展到当前行（文本块）的全部文本
5. 空行 → null（绝不把 URL 插入正文）

### 7.2 完整代码与逐行注释

```typescript
// 从 @tiptap/core 导入 Editor 类型和工具函数
import type { Editor } from '@tiptap/core';
// getMarkRange：找到光标所在位置的某个 mark 的完整范围
// isTextSelection：判断是否是文本选区
import { getMarkRange, isTextSelection } from '@tiptap/core';
// 导入 ProseMirror 的 Node 类型（文档节点）
import type { Node as PmNode } from '@tiptap/pm/model';
// 导入 EditorState 类型（编辑器状态）
import type { EditorState } from '@tiptap/pm/state';

// 链接范围类型：起始位置和结束位置
export type LinkRange = { from: number; to: number };

// 解析「设链目标」选区（对齐常见富文本行为）
// 优先级：已选中文本 > 光标在链接内 > 光标在词中 > 整行文本 > 空行(null)
export function resolveLinkTarget(state: EditorState): LinkRange | null {
	// 从 state 中解构出选区、文档、schema
	const { selection, doc, schema } = state;
	// 从选区中解构起止位置和是否空选区
	const { from, to, empty, $from } = selection;

	// 情况1：已有非空选区 → 直接用选区范围
	if (!empty && to > from) return { from, to };

	// 情况2：光标在已有链接内 → 扩展到整个 link mark 的范围
	if (isTextSelection(selection) && schema.marks.link) {
		// getMarkRange 找到 $from 位置处 link mark 的完整范围
		const markRange = getMarkRange($from, schema.marks.link);
		// 找到了且范围有效 → 返回
		if (markRange && markRange.to > markRange.from) return markRange;
	}

	// 情况3：光标落在一个词/连续非空白字符内 → 扩展到这个词
	const word = expandNonWhitespaceAround(doc, from);
	// 找到了就返回
	if (word) return word;

	// 情况4：光标在文本块内 → 扩展到整行（当前文本块的全部内容）
	if ($from.parent.isTextblock) {
		// 当前文本块的起始位置
		const start = $from.start();
		// 当前文本块的结束位置
		const end = $from.end();
		// 有内容就返回整行范围
		if (end > start) return { from: start, to: end };
	}

	// 情况5：空行或其它情况 → 返回 null（不设链，也不插入 URL 文本）
	return null;
}

// 从 pos 位置向两侧扩展，找到包含该位置的连续非空白字符范围
// 用于「光标在一个单词中间时，点链接按钮自动选中整个单词」
function expandNonWhitespaceAround(
	// 文档节点
	doc: PmNode,
	// 光标位置
	pos: number,
): LinkRange | null {
	// 文档总长度（content.size）
	const size = doc.content.size;
	// 空文档直接返回 null
	if (size < 1) return null;

	// 将 pos 钳制在合法范围内（0 到 size）
	const clamped = Math.max(0, Math.min(pos, size));
	// 解析该位置，得到 ResolvedPos（带有层级信息的位置）
	const $pos = doc.resolve(clamped);
	// 光标不在文本块内 → 返回 null（比如在图片节点上）
	if (!$pos.parent.isTextblock) return null;

	// 当前文本块的起始位置
	const blockStart = $pos.start();
	// 当前文本块的结束位置
	const blockEnd = $pos.end();
	// 文本块为空 → 返回 null
	if (blockEnd <= blockStart) return null;

	// 提取文本块内的纯文本（blockStart 到 blockEnd）
	// textBetween 的后两个参数是：块之间用什么分隔、不同层级用什么
	const text = doc.textBetween(blockStart, blockEnd, '\n', '\0');
	// 文本全是空白 → 返回 null
	if (!text.trim()) return null;

	// 计算光标在当前文本块内的偏移量
	let offset = Math.max(0, Math.min(clamped - blockStart, text.length));

	// 光标在字符右侧时的边界处理：
	// 如果 offset 在空白处，且左边字符是非空白 → 往左贴一个字符
	// 这样「单词后点击」也能选中整个单词
	if (
		// offset 大于 0（不在最左边）
		offset > 0 &&
		// offset 已经到末尾或当前字符是空白
		(offset >= text.length || /\s/.test(text[offset]!)) &&
		// 左边一个字符是非空白
		!/\s/.test(text[offset - 1]!)
	) {
		// 左移一位，贴到左侧字符上
		offset -= 1;
	}

	// 修正后当前位置还是空白 → 不在任何词内，返回 null
	if (offset >= text.length || /\s/.test(text[offset]!)) return null;

	// 从 offset 向左找第一个空白字符的位置（即词的左边界）
	let left = offset;
	// 从 offset+1 向右找第一个空白字符的位置（即词的右边界）
	let right = offset + 1;
	// 向左扩展：没到左边、且左边字符非空白，就继续左移
	while (left > 0 && !/\s/.test(text[left - 1]!)) left -= 1;
	// 向右扩展：没到末尾、且当前字符非空白，就继续右移
	while (right < text.length && !/\s/.test(text[right]!)) right += 1;

	// 转换为文档绝对位置并返回
	return { from: blockStart + left, to: blockStart + right };
}

// 给指定范围设置链接
export function applyLinkToRange(editor: Editor, range: LinkRange, href: string) {
	// 先选中目标范围，再设置链接
	// 注意：只用 setTextSelection + setLink，不要串联 extendMarkRange
	// 因为当目标位置没有 mark 时，extendMarkRange 会中断 chain
	editor.chain().focus().setTextSelection(range).setLink({ href }).run();
}

// 移除指定范围的链接
export function removeLinkInRange(editor: Editor, range: LinkRange) {
	// 先选中目标范围，再取消链接
	editor.chain().focus().setTextSelection(range).unsetLink().run();
}
```

---

## 8. 链接表单与 Hook（LinkForm.tsx）

**来源**：`apps/remote-plugins/src/components/design/RichEditor/link/LinkForm.tsx`（共 167 行）

### 8.1 模块职责

- `LinkForm` 组件：自定义链接输入面板（替代 `window.prompt`，适配 Tauri 桌面端）
- `useLinkEditor` Hook：链接编辑的状态管理逻辑

### 8.2 设计要点

- **不用 window.prompt**：Tauri 桌面端可能不支持或样式不统一，用自定义表单更好看。
- **打开时先选中文本**：用户能明确看到将对哪段文字设链。
- **空行不设链**：绝不把 URL 作为文本插入正文，避免污染内容。
- **Enter 应用 / Esc 取消**：符合键盘操作习惯。

### 8.3 完整代码与逐行注释

```typescript
// 导入 Editor 类型
import type { Editor } from '@tiptap/react';
// 导入 React Hook
import { useCallback, useEffect, useRef, useState } from 'react';
// 导入国际化类型（从父目录的 locale 导入，因为 LinkForm.tsx 在 link/ 目录下）
// 注意：import 顺序相比旧版有调整，locale 类型上移到第三行
import type { RichEditorLocale } from '../locale';
// 导入链接范围相关工具
// 注意：具名导入顺序与旧版不同，type LinkRange 现在排在中间
import {
	applyLinkToRange,
	type LinkRange,
	removeLinkInRange,
	resolveLinkTarget,
} from './linkRange';
// 【新增】从设计系统 UI 库导入 Button 与 Input 组件
// 替代旧版的原生 <button> / <input>，统一走组件库样式
import { Button, Input } from '@/components/ui';

// 链接草稿状态类型
export type LinkDraft = {
	// 当前输入的链接地址
	href: string;
	// 设链目标范围；null 表示空行，无法设链
	range: LinkRange | null;
};

// LinkForm 组件的 Props 类型
type LinkFormProps = {
	// 国际化字典
	locale: RichEditorLocale;
	// 当前链接地址（受控）
	href: string;
	// 地址变化回调
	onHrefChange: (href: string) => void;
	// 应用按钮回调
	onApply: () => void;
	// 移除链接按钮回调
	onRemove: () => void;
	// 关闭按钮回调
	onClose: () => void;
	// 空行无法设链时的提示文本
	hint?: string;
};

// 自定义链接输入面板组件（替代 window.prompt，适配 Tauri）
export function LinkForm({
	// 解构 locale 为 t，简写方便
	locale: t,
	href,
	onHrefChange,
	onApply,
	onRemove,
	onClose,
	hint,
}: LinkFormProps) {
	// input 的 ref，用于自动聚焦
	const inputRef = useRef<HTMLInputElement>(null);

	// 组件挂载后自动聚焦输入框并全选文本
	useEffect(() => {
		// 聚焦输入框
		inputRef.current?.focus();
		// 选中全部文字，方便直接输入覆盖
		inputRef.current?.select();
	// 只在挂载时执行一次
	}, []);

	return (
		// 链接表单容器
		// 【变更】不再使用 rich-editor-link-form 自定义 class
		// 改用 Tailwind 原子类：flex 横向排列、items-center 垂直居中、gap-1 间距、p-3 pb-2 内边距
		<div
			className="flex items-center gap-1 p-3 pb-2"
			{/* 语义化角色：对话框 */}
			role="dialog"
			{/* aria 标签 */}
			aria-label={t.link}
			{/* 阻止在非交互元素上的鼠标按下事件 */}
			{/* 防止点击表单空白处导致编辑器失焦或选区变化 */}
			onMouseDown={(e) => {
				// 如果点击的是 input 或 button 等交互元素，不拦截
				if ((e.target as HTMLElement).closest('input,button')) return;
				// 阻止默认行为，避免编辑器选区丢失
				e.preventDefault();
			}}
		>
			{/* 【变更】链接地址标签已被注释掉，不再渲染 label 文案 */}
			{/* <span className="text-sm text-textcolor/60">{t.linkPrompt}</span> */}
			{/* 链接地址输入框 */}
			{/* 【变更】改用 UI 组件库的 Input 组件，替代原生 <input> */}
			{/* 【变更】不再使用 rich-editor-link-input 自定义 class */}
			{/* 样式改为 Tailwind 原子类：文字色 text-textcolor/80、flex-1 自适应宽度、*/}
			{/* shadow-none 去阴影、border-theme/15 主题色边框、聚焦时边框加深且去除聚焦环 */}
			<Input
				{/* 挂载 ref */}
				ref={inputRef}
				{/* 文本类型 */}
				type="text"
				{/* 输入模式：url（移动端显示优化） */}
				inputMode="url"
				{/* 自动填充：url */}
				autoComplete="url"
				{/* 样式类名：Tailwind 原子类，由主题变量驱动配色 */}
				className="text-textcolor/80 flex-1 shadow-none border-theme/15 focus-visible:border-theme/30 focus-visible:ring-0"
				{/* 占位符 */}
				placeholder={t.linkPlaceholder}
				{/* 当前值（受控） */}
				value={href}
				{/* 输入时回调 */}
				onChange={(e) => onHrefChange(e.target.value)}
				{/* 键盘事件：Enter 应用，Esc 取消 */}
				onKeyDown={(e) => {
					// 按 Enter
					if (e.key === 'Enter') {
						// 阻止默认（避免换行）
						e.preventDefault();
						// 应用链接
						onApply();
					}
					// 按 Escape
					if (e.key === 'Escape') {
						// 阻止默认
						e.preventDefault();
						// 关闭表单
						onClose();
					}
				}}
			/>
			{/* 有提示时显示（比如空行无法设链的提示） */}
			{hint ? <span className="rich-editor-link-hint">{hint}</span> : null}
			{/* 确定按钮 */}
			{/* 【变更】改用 UI 组件库的 Button 组件，替代原生 <button> */}
			{/* 【变更】不再有 rich-editor-link-action class */}
			<Button
				type="button"
				{/* 有 hint 时禁用（空行无法设链） */}
				disabled={!!hint}
				{/* 点击应用 */}
				onClick={onApply}
			>
				{t.linkApply}
			</Button>
			{/* 移除链接按钮 */}
			{/* 【变更】同样改用 Button 组件，无 rich-editor-link-action class */}
			<Button
				type="button"
				{/* 点击移除 */}
				onClick={onRemove}
			>
				{t.unlink}
			</Button>
			{/* 取消按钮 */}
			{/* 【变更】改用 Button 组件；不再使用 rich-editor-link-action ghost 变体 */}
			{/* 三个按钮统一走 Button 默认变体，样式由设计系统统一管理 */}
			<Button
				type="button"
				{/* 点击关闭 */}
				onClick={onClose}
			>
				{t.linkCancel}
			</Button>
		</div>
	);
}

// 规范化链接地址：补全协议、去掉空值
function normalizeHref(raw: string): string {
	// 去除首尾空白
	const url = raw.trim();
	// 空字符串或只有协议前缀 → 返回空串（不设链）
	if (!url || url === 'https://' || url === 'http://') return '';
	// 没有协议前缀（不是以 字母+数字+.-+: 开头） → 自动补 https://
	if (!/^[a-z][a-z0-9+.-]*:/i.test(url)) return `https://${url}`;
	// 已有协议 → 直接返回
	return url;
}

// useLinkEditor Hook：链接编辑的状态管理
// 打开时即锁定目标选区（选区 / 词 / 整行），应用时只给目标加 mark
// 绝不把 URL 作为文本插入正文
// 注：Hook 内部逻辑与旧版一致，仅 import 顺序有调整
export function useLinkEditor(editor: Editor | null) {
	// 链接草稿状态：null 表示未打开
	const [draft, setDraft] = useState<LinkDraft | null>(null);

	// 打开链接编辑器
	const open = useCallback(() => {
		// 编辑器不存在就返回
		if (!editor) return;
		// 解析目标范围
		const range = resolveLinkTarget(editor.state);
		// 获取当前光标位置已有的链接 href（用于编辑现有链接）
		const prev =
			(editor.getAttributes('link').href as string | undefined) ?? '';

		// 有目标范围时先选中，让用户看到将要加链接的范围
		if (range) {
			editor.chain().setTextSelection(range).run();
		}

		// 设置草稿状态
		setDraft({
			// 已有链接就显示原 href，没有就显示 https:// 前缀
			href: prev || 'https://',
			// 目标范围
			range,
		});
	// 依赖 editor 实例
	}, [editor]);

	// 关闭链接编辑器
	const close = useCallback(() => setDraft(null), []);

	// 应用链接
	const apply = useCallback(() => {
		// 编辑器或草稿不存在 → 不做任何事
		if (!editor || !draft) return;
		// 规范化 URL
		const href = normalizeHref(draft.href);

		// 没有目标范围（空行） → 直接关闭，不插入 URL 文本
		if (!draft.range) {
			setDraft(null);
			return;
		}

		// URL 为空 → 移除链接（而不是设置空链接）
		if (!href) {
			removeLinkInRange(editor, draft.range);
			setDraft(null);
			return;
		}

		// 正常情况：给目标范围设置链接
		applyLinkToRange(editor, draft.range, href);
		// 关闭草稿
		setDraft(null);
	// 依赖 draft 和 editor
	}, [draft, editor]);

	// 移除链接
	const remove = useCallback(() => {
		// 编辑器或草稿不存在 → 返回
		if (!editor || !draft) return;
		// 有范围就移除该范围的链接
		if (draft.range) removeLinkInRange(editor, draft.range);
		// 关闭草稿
		setDraft(null);
	// 依赖
	}, [draft, editor]);

	// 更新 href 输入值
	const setHref = useCallback((href: string) => {
		// 函数式更新：只改 href 字段
		setDraft((d) => (d ? { ...d, href } : d));
	}, []);

	// 返回所有状态和方法
	return { draft, open, close, apply, remove, setHref };
}
```

---

## 9. 选区气泡菜单（FormatBubble.tsx）

**来源**：`apps/remote-plugins/src/components/design/RichEditor/toolbar/FormatBubble.tsx`（共 68 行）

### 9.1 模块职责

用户选中文本后，在选区上方浮动显示的快捷格式菜单。只放最常用的行内格式按钮。

### 9.2 完整代码与逐行注释

```typescript
// 导入 Editor 类型
import type { Editor } from '@tiptap/react';
// 导入图标组件
import { Bold, Highlighter, Italic, Link2, Underline } from 'lucide-react';
// 导入 ReactNode 类型
import type { ReactNode } from 'react';
// 导入国际化类型（从父目录的 locale 导入，因为 FormatBubble.tsx 在 toolbar/ 目录下）
import type { RichEditorLocale } from '../locale';

// 组件 Props 类型
type Props = {
	// 编辑器实例
	editor: Editor;
	// 国际化字典
	locale: RichEditorLocale;
	// 打开链接表单的回调
	onOpenLink: () => void;
};

// 气泡菜单内部按钮组件（简化版，没有 active 态）
function Btn({
	title,
	onClick,
	children,
}: {
	// 按钮 title（tooltip）
	title: string;
	// 点击回调
	onClick: () => void;
	// 子元素（一般是图标）
	children: ReactNode;
}) {
	return (
		// 按钮元素
		<button
			type="button"
			{/* 复用工具栏按钮样式 */}
			className="rich-editor-btn"
			{/* title 属性，悬停时显示提示 */}
			title={title}
			{/* aria 标签，辅助技术使用 */}
			aria-label={title}
			{/* 阻止鼠标按下默认行为：避免点击按钮时编辑器失焦 */}
			onMouseDown={(e) => e.preventDefault()}
			{/* 点击事件 */}
			onClick={onClick}
		>
			{children}
		</button>
	);
}

// 选区气泡菜单：常用行内格式
export function FormatBubble({ editor, locale: t, onOpenLink }: Props) {
	return (
		// 气泡菜单容器
		<div className="rich-editor-bubble" role="toolbar" aria-label="快捷格式">
			{/* 粗体按钮 */}
			<Btn
				title={t.bold}
				{/* 点击：聚焦 → 切换粗体 → 执行 */}
				onClick={() => editor.chain().focus().toggleBold().run()}
			>
				<Bold size={14} />
			</Btn>
			{/* 斜体按钮 */}
			<Btn
				title={t.italic}
				onClick={() => editor.chain().focus().toggleItalic().run()}
			>
				<Italic size={14} />
			</Btn>
			{/* 下划线按钮 */}
			<Btn
				title={t.underline}
				onClick={() => editor.chain().focus().toggleUnderline().run()}
			>
				<Underline size={14} />
			</Btn>
			{/* 高亮按钮 */}
			<Btn
				title={t.highlight}
				onClick={() => editor.chain().focus().toggleHighlight().run()}
			>
				<Highlighter size={14} />
			</Btn>
			{/* 链接按钮 */}
			<Btn title={t.link} onClick={onOpenLink}>
				<Link2 size={14} />
			</Btn>
		</div>
	);
}
```

---

## 10. 自定义 Title 节点（title/TitleNode.ts）

**来源**：`apps/remote-plugins/src/components/design/RichEditor/title/TitleNode.ts`（共 175 行）

### 10.1 模块职责

这是整个编辑器最核心、技术含量最高的文件。定义了：
- **TitleNode**：自定义原子节点，作为笔记的固定标题
- **EMPTY_NOTE_DOC**：空笔记的文档结构（title + paragraph）
- **normalizeNoteContent**：内容归一化函数
- **getDocTitleText**：从文档中提取标题文本
- **indentEditor**：Tab 缩进逻辑
- **focusAfterTitle**：标题后跳转正文

### 10.2 设计要点

**为什么要用自定义 atom 节点而不是普通 heading？**
1. 标题必须**常驻首位**，不能被用户删除或移动
2. 标题用**原生 input** 编辑，比 contenteditable 更可控（IME、选中、placeholder）
3. 标题不参与正文的字数统计
4. 标题有自己独立的样式和装饰（标签图标）

**为什么用 atom 而不是 block？**
- atom 节点是「原子的」，不可再分，光标不能进入其内部
- 配合 `group: 'title'` 和自定义 Document，可以保证文档结构是 `title block+`
- 标题只能有一个，且永远在最前面

### 10.3 完整代码与逐行注释

```typescript
// 导入 Editor 类型和 JSONContent 类型
import type { Editor, JSONContent } from '@tiptap/core';
// 从 @tiptap/core 导入 mergeAttributes 工具与 Node 基类
import { mergeAttributes, Node } from '@tiptap/core';
// 导入 GapCursor（间隙光标，用于块级节点之间的光标）
import { GapCursor } from '@tiptap/pm/gapcursor';
// 从 ProseMirror state 导入 Plugin、PluginKey、Selection（新增）、TextSelection
// 新增 Selection：用于调用 Selection.atEnd 在文档末尾生成选区
import { Plugin, PluginKey, Selection, TextSelection } from '@tiptap/pm/state';
// 从 @tiptap/react 导入 ReactNodeViewRenderer（React 节点视图渲染器）
import { ReactNodeViewRenderer } from '@tiptap/react';
// 导入 TitleView React 组件
import TitleView from './Title';

// 空笔记的默认文档结构：必须有一个 title + 一段正文 paragraph
// 为什么要这样？因为如果文档只有一个 atom 节点（title），
// 光标会落在 atom 旁边的 GapCursor 上，看起来有光标但实际上输不进字
// 新版将 content 写成单行，等价于旧版多行写法，只是格式更紧凑
export const EMPTY_NOTE_DOC: JSONContent = {
	// 文档根节点类型
	type: 'doc',
	// 子节点数组：title + paragraph，单行写法
	// 第一个节点是标题（value 为空），第二个节点是空段落（保证有地方输入正文）
	content: [{ type: 'title', attrs: { value: '' } }, { type: 'paragraph' }],
};

// 内容归一化：空内容 → 合法的空笔记文档
// 处理三种空值情况：null/undefined、空字符串、空段落 HTML
export function normalizeNoteContent(
	// 输入内容：可以是 HTML 字符串、JSON 对象、空值
	content: string | JSONContent | undefined | null,
	// 返回类型：字符串或 JSON 对象（保证非空）
): string | JSONContent {
	// 如果是 null/undefined，或空字符串，或只有一个空段落
	if (content == null || content === '' || content === '<p></p>') {
		// 返回默认空笔记结构
		return EMPTY_NOTE_DOC;
	}
	// 否则原样返回
	return content;
}

/*
 * 笔记常驻标题节点：
 * - atom: 原子节点，不可再分，光标不能进入内部
 * - group: 'title'：自定义分组，配合 Document 保证结构合法
 * - 用原生 input 编辑（NodeView），而不是 contenteditable
 */
export const TitleNode = Node.create({
	// 节点名称，唯一标识
	name: 'title',

	// 节点所属的 group，用于 schema 约束
	// 自定义 'title' 组，这样 Document.content: 'title block+' 就能约束结构
	group: 'title',

	// 原子节点：不能被光标进入，作为一个整体存在
	atom: true,

	// 不可拖拽
	draggable: false,

	// 不可选中（不能用鼠标拖选整个标题节点）
	selectable: false,

	// 定义节点的属性（attrs）
	addAttributes() {
		return {
			// value 属性：存储标题文本
			value: {
				// 默认值为空字符串
				default: '',
				// 从 HTML 解析时如何取值
				parseHTML: (el) =>
					// 优先读 data-value 属性，其次读 textContent（兼容旧数据）
					(el as HTMLElement).getAttribute('data-value') ??
					(el as HTMLElement).textContent ??
					'',
				// 渲染成 HTML 时如何输出
				renderHTML: (attrs) =>
					// 有值就输出 data-value 属性，没值就不输出（减少冗余）
					attrs.value ? { 'data-value': attrs.value as string } : {},
			},
		};
	},

	// 从 HTML 解析时的匹配规则
	parseHTML() {
		// 匹配带 data-type="note-title" 的 div 元素
		return [{ tag: 'div[data-type="note-title"]' }];
	},

	// 渲染成 HTML 时的输出结构
	renderHTML({ HTMLAttributes, node }) {
		// 返回 ProseMirror 的 DOM 输出规范：[标签名, 属性对象, 内容]
		return [
			// 外层标签：div
			'div',
			// 合并默认属性和自定义属性
			mergeAttributes(HTMLAttributes, {
				// 标记类型，用于 parseHTML 识别
				'data-type': 'note-title',
				// 把 value 存到 data-value 上，便于解析和查看
				'data-value': node.attrs.value ?? '',
			}),
			// textContent 也输出一份，兼容无 JS 环境和旧版解析
			node.attrs.value ?? '',
		];
	},

	// 添加 NodeView：用 React 组件渲染这个节点
	addNodeView() {
		// stopEvent: () => true 表示标题内的所有事件都不交给 ProseMirror 处理
		// 这样标题 input 的输入、光标、选中完全由 React 控制，不和正文打架
		return ReactNodeViewRenderer(TitleView, {
			stopEvent: () => true,
		});
	},

	// 添加 ProseMirror 插件：保证文档结构始终合法
	addProseMirrorPlugins() {
		return [
			// 创建一个新的状态插件
			new Plugin({
				// 插件唯一 key
				key: new PluginKey('singleNoteTitle'),
				// 事务追加：每次 state 变化后，自动修正文档结构
				appendTransaction(transactions, _old, state) {
					// 如果没有任何事务改变了文档或选区，直接返回 null（不追加）
					if (!transactions.some((tr) => tr.docChanged || tr.selectionSet))
						return null;

					// 基于当前 state 创建一个新事务
					let tr = state.tr;
					// 标记是否有改动
					let changed = false;

					// --- 修正1：去掉多余的 title（保证只有一个） ---
					// 收集多余 title 的位置和大小
					const extras: { pos: number; nodeSize: number }[] = [];
					// 已见到的 title 计数
					let seen = 0;
					// 遍历文档所有直接子节点
					state.doc.forEach((node, offset) => {
						// 不是 title 节点就跳过
						if (node.type.name !== 'title') return;
						// 计数 +1
						seen += 1;
						// 第二个及以后的 title 都是多余的，记录下来
						if (seen > 1) extras.push({ pos: offset, nodeSize: node.nodeSize });
					});
					// 倒序删除多余的 title（倒序避免位置偏移）
					for (let i = extras.length - 1; i >= 0; i--) {
						// 解构位置和大小（新版去掉了 ! 非空断言，TS 已能推断为非空）
						const { pos, nodeSize } = extras[i];
						// 用 paragraph 替换该节点（删除后补一个段落，避免空文档）
						// 新版为多行调用写法，等价于旧版单行 tr.replaceWith(pos, pos + nodeSize, ...)
						tr.replaceWith(
							pos,
							pos + nodeSize,
							state.schema.nodes.paragraph.create(),
						);
						// 标记有改动
						changed = true;
					}

					// 如果改过了，用新文档；否则用原文档
					const doc = changed ? tr.doc : state.doc;
					// 取第一个子节点（应该是 title）
					const title = doc.firstChild;
					// --- 修正2：没有正文块时补一段 ---
					// 为什么？因为 atom 节点旁边的 GapCursor 看起来像有光标但输不进字
					if (title?.type.name === 'title' && doc.childCount < 2) {
						// 在 title 后面插入一个空段落
						// 新版为多行调用写法，等价于旧版单行 tr.insert(...)
						tr = tr.insert(
							title.nodeSize,
							state.schema.nodes.paragraph.create(),
						);
						// 标记有改动
						changed = true;
					}

					// 下一个文档（改了就用 tr.doc，否则用原文档）
					const nextDoc = changed ? tr.doc : state.doc;
					// 下一个文档的第一个子节点（标题节点）
					const titleNode = nextDoc.firstChild;
					// 只有首位是 title 时，才需要修正选区
					if (titleNode?.type.name === 'title') {
						// title 节点的总大小（用于计算跳过它的位置）
						const titleSize = titleNode.nodeSize;
						// 下一个选区：改了用 tr.selection，否则用原 state.selection
						const sel = changed ? tr.selection : state.selection;
						// 判断正文是否完全为空：title 之后所有可提取文本长度为 0
						// textBetween(from, to) 会把范围内 inline 内容拼成字符串
						const bodyEmpty =
							!nextDoc.textBetween(titleSize, nextDoc.content.size).length;
						// 当前选区的 $from（选区起点的位置引用）
						const $from = sel.$from;
						// 判断光标是否已经在正文某段内：
						// 必须同时满足四个条件——TextSelection、空选区、父节点是 textblock、位置在 title 之后
						const caretInBody =
							sel instanceof TextSelection &&
							sel.empty &&
							$from.parent.isTextblock &&
							$from.pos > titleSize;
						// --- 修正3：选区需要修正的条件（新版大改） ---
						// 满足以下任一即需要修正：
						//  1) 是 GapCursor（块与块之间的间隙光标，无法输入）
						//  2) 是空选区但父节点不是 textblock（也是一种间隙光标状态）
						//  3) 正文为空且塌缩光标不在正文段内（避免无可见光标却仍能输入的诡异状态）
						// 注意：有 range 选区时不干预，避免 Cmd+A 全选被清掉
						// 相比旧版只判断 isGap，新版多了「正文空却不在段内」这一分支
						// 本轮迭代又在第三个条件前加了 sel.empty，保护非塌缩的 range 选区
						const needsFix =
							sel instanceof GapCursor ||
							(sel.empty && !$from.parent.isTextblock) ||
							(bodyEmpty && sel.empty && !caretInBody);

						// 需要修正且位置合法时，把选区钉回正文
						if (needsFix && titleSize + 1 <= nextDoc.content.size) {
							// 选区修正策略（新版大改）：
							//  - 正文为空 → 跳到 title 之后第一段内部的起点（titleSize + 1）
							//    让用户直接在第一段内输入，光标可见
							//  - 正文非空 → 用 Selection.atEnd 落到正文末尾
							//    避免覆盖已有内容，引导用户在文末继续写
							// 旧版一律用 TextSelection.create(nextDoc, pos)，会无脑跳到首段起点
							const nextSel = bodyEmpty
								? TextSelection.create(nextDoc, titleSize + 1)
								: Selection.atEnd(nextDoc);
							// 把选区设置到目标位置
							tr = tr.setSelection(nextSel);
							// 标记有改动
							changed = true;
						}
					}

					// 有改动就返回事务，没改动返回 null
					return changed ? tr : null;
				},
			}),
		];
	},

	// 键盘快捷键扩展
	addKeyboardShortcuts() {
		// 返回快捷键映射表
		return {
			// Cmd/Ctrl + A：全选
			// 全选只覆盖正文，避开 title NodeView，让浏览器能画出原生选区高亮
			'Mod-a': ({ editor }) => {
				// 获取当前文档
				const { doc } = editor.state;
				// 取第一个子节点（应该是 title）
				const title = doc.firstChild;
				// 第一个节点不是 title（异常情况）→ 交给默认行为
				if (title?.type.name !== 'title') return false;

				// title 节点之后的正文起始位置
				const start = title.nodeSize + 1;
				// 起始位置越界（理论上不会发生，因为有正文保证）→ 直接返回 true 吃掉事件
				if (start >= doc.content.size) return true;

				// 找到 start 之后最近的文本位置（作为选区起点）
				// TextSelection.near(dir=1) 表示向后（文档末尾方向）找最近的可放文本选区的位置
				const from = TextSelection.near(doc.resolve(start), 1).from;
				// 选区终点：文档末尾位置
				const to = Selection.atEnd(doc).to;
				// 起点在终点之前 → 设置首尾选区
				if (from < to) {
					editor.commands.setTextSelection({ from, to });
				// 起点等于/超过终点（空文档）→ 只设塌缩光标
				} else {
					editor.commands.setTextSelection(from);
				}
				// 返回 true 表示已处理，阻止默认全选行为
				return true;
			},
		};
	},
});

// 默认导出
export default TitleNode;

// 从文档中提取标题文本，供笔记列表展示等场景使用
export function getDocTitleText(doc: {
	// 文档对象需要有 firstChild
	firstChild?: {
		// firstChild 的类型信息
		type: { name: string };
		// 属性字典
		attrs: Record<string, unknown>;
		// 文本内容
		textContent: string;
	} | null;
}): string {
	// 取第一个子节点
	const first = doc.firstChild;
	// 第一个节点不是 title → 返回空串
	if (first?.type.name !== 'title') return '';
	// 优先从 attrs.value 取（主要存储方式）
	const fromAttr = first.attrs.value;
	// 如果是字符串，trim 后返回
	if (typeof fromAttr === 'string') return fromAttr.trim();
	// 否则从 textContent 取（兼容性兜底）
	return first.textContent.trim();
}

// 正文 Tab 缩进逻辑：
// - 在列表里 → 下沉一级（sinkListItem）
// - 在任务列表里 → 下沉一级
// - 其他情况 → 插入制表符 \t
export function indentEditor(editor: Editor): boolean {
	// 在代码块里不处理，走代码块自己的 Tab 逻辑
	if (editor.isActive('codeBlock')) return false;
	// 普通列表：尝试下沉一级，成功就返回 true
	if (editor.commands.sinkListItem('listItem')) return true;
	// 任务列表：尝试下沉一级，成功就返回 true
	if (editor.commands.sinkListItem('taskItem')) return true;
	// 其他情况：插入一个制表符 \t
	return editor.commands.insertContent('\t');
}

// 标题 input 按 Enter / Tab 时：跳到正文末尾
export function focusAfterTitle(editor: Editor) {
	// 取文档第一个子节点
	const title = editor.state.doc.firstChild;
	// 第一个节点不是 title（异常情况）→ 直接 focus 到末尾
	if (!title || title.type.name !== 'title') {
		editor.commands.focus('end');
		return;
	}
	// title 节点之后的位置
	const after = title.nodeSize;
	// 该位置处的节点（应该是第一个正文段落）
	const next = editor.state.doc.nodeAt(after);
	// 如果没有下一个节点（理论上不会发生，因为插件会保证有正文）
	if (!next) {
		// 在 title 后插入一个段落，然后聚焦到末尾
		editor
			.chain()
			.insertContentAt(after, { type: 'paragraph' })
			.focus('end')
			.run();
		return;
	}
	// 正常情况：聚焦到编辑器末尾
	editor.commands.focus('end');
}
```

---

## 11. Title 节点视图组件（title/Title.tsx）

**来源**：`apps/remote-plugins/src/components/design/RichEditor/title/Title.tsx`（共 69 行）

### 11.1 模块职责

TitleNode 的 React NodeView 组件，用原生 `<input>` 编辑标题文本。

### 11.2 设计要点

**中文 IME 处理**：
- 用 `composing` ref 标记组字状态
- 组字期间只更新本地 state，不写 `updateAttributes`
- 避免受控重渲染把拼音一起提交进框

**为什么用原生 input 而不是 contenteditable？**
1. IME 更稳定（中文输入法在 contenteditable 里有各种问题）
2. placeholder 原生支持，不用自己写
3. maxLength 原生支持
4. 选中、光标行为完全可控
5. 可以用 `tabIndex={-1}` 排除在 Tab 序之外

### 11.3 完整代码与逐行注释

```typescript
// 从 @tiptap/react 导入 NodeViewProps（节点视图属性）和 NodeViewWrapper（节点视图包装器）
import { type NodeViewProps, NodeViewWrapper } from '@tiptap/react';
// 导入笔记本笔图标
import { NotebookPen } from 'lucide-react';
// 导入 React Hook
import { useEffect, useRef, useState } from 'react';
// 导入项目的 Input 组件
import { Input } from '@/components/ui';
// 从父目录的 locale 导入中文国际化字典
import { zhCN } from '../locale';
// 从同目录的 TitleNode.ts 导入 focusAfterTitle 工具函数
// Title.tsx 和 TitleNode.ts 都在 title/ 目录下，所以用 ./TitleNode
import { focusAfterTitle } from './TitleNode';

/**
 * 原生 input 编辑标题。
 * 中文 IME：组字期间不写 attrs，避免受控重渲染把拼音一起提交进框。
 */
export default function TitleView({
	// 当前节点（ProseMirror Node）
	node,
	// 更新节点属性的函数
	updateAttributes,
	// 编辑器实例
	editor,
}: NodeViewProps) {
	// IME 组字状态标记：true 表示正在输入中文拼音（还没确认）
	// 用 ref 而不用 state，因为不需要触发重渲染
	const composing = useRef(false);
	// 本地 state 存储输入框的值（用于受控输入）
	// 初始值从 node.attrs.value 读取
	const [value, setValue] = useState(String(node.attrs.value ?? ''));

	// 当外部 attrs.value 变化时同步到本地 state
	useEffect(() => {
		// 组字期间不更新，避免打断拼音输入
		if (composing.current) return;
		// 更新本地 state
		setValue(String(node.attrs.value ?? ''));
	// 依赖：node.attrs.value（外部变化时触发）
	}, [node.attrs.value]);

	// 提交函数：更新本地 state，如果不在组字中则同步到 ProseMirror
	const commit = (next: string) => {
		// 先更新本地 state，保证输入框显示正确
		setValue(next);
		// 只有不在组字期间才写 attrs，避免 IME 中间状态污染文档
		if (!composing.current) updateAttributes({ value: next });
	};

	return (
		// NodeViewWrapper 是 Tiptap 提供的节点视图包装器
		// 它会自动处理一些 ProseMirror 相关的 DOM 绑定
		<NodeViewWrapper
			{/* 渲染为 div 标签 */}
			as="div"
			{/* 样式类：flex 布局，列方向，间距 2，下边距 2 */}
			className="flex flex-col gap-2 mb-2"
			{/* 内容不可编辑（标题用原生 input，不用 contenteditable） */}
			contentEditable={false}
		>
			{/* 标题卡片容器：相对定位，flex 列布局，内边距，边框，背景色，圆角 */}
			<div className="relative flex flex-col gap-2 p-3 pt-9 border border-theme/5 bg-theme/5 rounded-md">
				{/* 左上角标签：绝对定位（-inset-0.5 略微外扩覆盖卡片边框），主题色背景，细边框，圆角，flex 布局，图标+文字 */}
				<div className="absolute -inset-0.5 bg-theme/20 border border-theme/5 text-theme/80 rounded-tl-md rounded-br-md pl-3 py-3.5 w-26 h-6 flex items-center gap-2">
					{/* 笔记本笔图标，尺寸 4（16px） */}
					<NotebookPen className="size-4" />
					{/* 标签文字：笔记标题（pb-0.5 微调垂直对齐，使文字与图标视觉居中） */}
					<span className="text-sm font-medium pb-0.5">笔记标题</span>
				</div>
				{/* 标题输入框 */}
				<Input
					{/* 自定义样式：高度 48px，全宽，无内边距，大字号，无边框，透明背景 */}
					{/* placeholder 透明度 35（更淡，避免抢占视觉焦点） */}
					className="h-12 size-full px-0 py-0 md:text-xl rounded-none border-0 bg-transparent pr-2 text-textcolor shadow-none placeholder:text-lg placeholder:text-textcolor/35 focus-visible:border-0 focus-visible:ring-0"
					{/* 当前值（受控） */}
					value={value}
					{/* 占位符文本（从国际化字典取） */}
					placeholder={zhCN.placeholderHeadingHint}
					{/* 最大长度 100 字符 */}
					maxLength={100}
					{/* 不进 Tab 序，避免正文按 Tab 时焦点跳到标题 */}
					tabIndex={-1}
					{/* 阻止鼠标按下事件冒泡：避免点击标题时 ProseMirror 改变选区 */}
					onMouseDown={(e) => e.stopPropagation()}
					{/* IME 开始：标记组字中 */}
					onCompositionStart={() => {
						composing.current = true;
					}}
					{/* IME 结束（确认输入）：标记组字结束，提交最终值 */}
					onCompositionEnd={(e) => {
						composing.current = false;
						commit(e.currentTarget.value);
					}}
					{/* 输入变化：提交当前值 */}
					onChange={(e) => commit(e.target.value)}
					{/* 键盘事件 */}
					onKeyDown={(e) => {
						// 正在组字时不处理（避免拼音输入时误触发）
						if (e.nativeEvent.isComposing) return;
						// 按 Enter 或 Tab：跳到正文
						if (e.key === 'Enter' || e.key === 'Tab') {
							// 阻止默认行为（避免换行或焦点跳转）
							e.preventDefault();
							// 聚焦到正文
							focusAfterTitle(editor);
						}
					}}
				/>
			</div>
			{/* 预留的底部装饰条（当前注释掉，保留以备后续启用） */}
			{/* <div className="h-2 w-full rounded-md bg-theme/10" /> */}
		</NodeViewWrapper>
	);
}
```

---

## 12. 扩展配置（extensions/index.ts）

**来源**：`apps/remote-plugins/src/components/design/RichEditor/extensions/index.ts`（共 139 行）

### 12.1 模块职责

组装所有 Tiptap 扩展，配置默认行为。包括：
- 自定义 Document（title + block+）
- 自定义 TitleNode
- 自定义 TabIndent
- StarterKit（基础功能）
- 代码块高亮（lowlight）
- 占位符
- 高亮
- 文本对齐
- 图片
- 图片上传
- 表格
- 任务列表
- 字符计数

### 12.2 设计要点

**可覆盖性**：
- 如果传了 `options.extensions`，直接用用户的，完全覆盖默认
- 否则用默认扩展，并支持 `extraExtensions` 追加

**为什么把 codeBlock 从 StarterKit 里关掉？**
因为要用 `@tiptap/extension-code-block-lowlight` 替代，它支持语法高亮。

**showTitle 开关（条件挂载）**：
- `showTitle !== false` 时（默认）：挂载 `CustomDocument`（content: `title block+`）+ `TitleNode`，StarterKit 的 `document` 设为 `false` 避免冲突，Placeholder 对 title 节点返回空串
- `showTitle === false` 时：不挂 CustomDocument 和 TitleNode，StarterKit 用默认 `document`（`undefined`），Placeholder 不会遇到 title 节点
- 这样编辑器既可作为「带标题的笔记编辑器」使用，也可作为「普通富文本编辑器」使用

### 12.3 完整代码与逐行注释

```typescript
// 导入 Extension 基类
import { Extension } from '@tiptap/core';
// 导入代码块扩展（带 lowlight 语法高亮）
import CodeBlockLowlight from '@tiptap/extension-code-block-lowlight';
// 导入 Document 扩展（文档根节点）
import Document from '@tiptap/extension-document';
// 导入高亮扩展
import Highlight from '@tiptap/extension-highlight';
// 导入图片扩展
import Image from '@tiptap/extension-image';
// 导入任务列表扩展
import { TaskItem, TaskList } from '@tiptap/extension-list';
// 导入占位符扩展
import { Placeholder } from '@tiptap/extension-placeholder';
// 导入表格扩展套件
import { TableKit } from '@tiptap/extension-table';
// 导入文本对齐扩展
import TextAlign from '@tiptap/extension-text-align';
// 导入字符计数扩展
import { CharacterCount } from '@tiptap/extensions';
// 导入 Extensions 类型
import type { Extensions } from '@tiptap/react';
// 导入 StarterKit（基础功能套件）
import StarterKit from '@tiptap/starter-kit';
// 导入 lowlight 的 common 语言包和创建函数
import { common, createLowlight } from 'lowlight';
// 从兄弟目录 image 导入图片上传扩展和工具函数
// 因为 extensions/index.ts 在 extensions/ 目录下，所以用 ../image 回到父级再进 image/
import { ImageUpload, fileToDataUrl } from '../image';
// 从兄弟目录 locale 导入中文国际化字典
import { zhCN } from '../locale';
// 从兄弟目录 title 导入 TitleNode 和 indentEditor
import { TitleNode, indentEditor } from '../title';
// 从兄弟目录 types 导入配置选项类型
import type { CreateExtensionsOptions } from '../types';

// 创建 lowlight 实例，加载 common 语言包（约 40 种常用语言）
const lowlight = createLowlight(common);

/*
 * TabIndent 扩展：自定义 Tab 键行为
 * - 列表中：下沉一级
 * - 正文中：插入制表符 \t
 * - 优先级 1000，确保比默认快捷键高
 */
const TabIndent = Extension.create({
	// 扩展名称
	name: 'tabIndent',
	// 高优先级，确保先匹配
	priority: 1000,
	// 键盘快捷键
	addKeyboardShortcuts() {
		return {
			// Tab 键
			Tab: ({ editor }) => {
				// 代码块里不处理，走代码块自己的 Tab 缩进
				if (editor.isActive('codeBlock')) return false;
				// 调用自定义缩进逻辑
				return indentEditor(editor);
			},
			// Shift+Tab 键（反向缩进）
			'Shift-Tab': ({ editor }) => {
				// 代码块里不处理
				if (editor.isActive('codeBlock')) return false;
				// 普通列表：尝试上提一级
				if (editor.commands.liftListItem('listItem')) return true;
				// 任务列表：尝试上提一级
				if (editor.commands.liftListItem('taskItem')) return true;
				// 其他情况也返回 true（不做任何事，但阻止默认焦点跳转）
				return true;
			},
		};
	},
});

/*
 * 自定义 Document：首位固定 title，其后至少一段正文
 * 避免仅有 atom 节点时 GapCursor 无法输入
 */
const CustomDocument = Document.extend({
	// 文档内容约束：一个 title，后跟至少一个 block 节点
	content: 'title block+',
});

/**
 * 组装默认扩展；业务可通过 extensions / extraExtensions 覆盖或追加
 */
export function createExtensions(
	// 配置选项
	options: CreateExtensionsOptions = {},
	// 返回扩展数组
): Extensions {
	// 如果传了自定义 extensions，直接使用（完全覆盖默认）
	if (options.extensions) return options.extensions;

	// 默认开启；显式 false 时跳过（无字数 UI 且无上限）
	const withCharCount = options.characterCount !== false;
	// 默认显示标题；显式 false 时不挂 CustomDocument 和 TitleNode
	const withTitle = options.showTitle !== false;

	// 占位符文本：默认用中文的
	const placeholder = options.placeholder ?? zhCN.placeholder;
	// 图片 src 解析 ref：默认用 base64
	const resolveImageSrcRef = options.resolveImageSrcRef ?? {
		current: fileToDataUrl,
	};

	// 返回扩展数组
	return [
		// 自定义文档结构 + 自定义标题节点（条件挂载：showTitle 为 false 时跳过）
		...(withTitle ? [CustomDocument, TitleNode] : []),
		// 自定义 Tab 缩进
		TabIndent,
		// StarterKit 基础套件（标题、段落、粗体、斜体、列表、链接等）
		StarterKit.configure({
			// 有自定义 document 时关掉默认的；否则用默认 document
			document: withTitle ? false : undefined,
			// 末尾节点：始终保证最后有一个段落（方便继续输入）
			trailingNode: {
				node: 'paragraph',
			},
			// 标题级别：支持 1-5 级
			heading: { levels: [1, 2, 3, 4, 5] },
			// 关掉默认 codeBlock，用带高亮的版本
			codeBlock: false,
			// 链接配置
			link: {
				// 点击链接不自动打开（避免误触）
				openOnClick: false,
				// 自动识别 URL 并转成链接
				autolink: true,
				// 默认协议：用户输入 example.com 时自动补 https://
				defaultProtocol: 'https',
				// 链接的 HTML 属性
				HTMLAttributes: {
					// 安全属性：防止新页面访问 window.opener
					rel: 'noopener noreferrer',
					// 在新标签页打开
					target: '_blank',
				},
			},
		}),
		// 代码块 + 语法高亮
		CodeBlockLowlight.configure({
			// lowlight 实例
			lowlight,
			// 默认语言
			defaultLanguage: 'javascript',
			// 启用 Tab 缩进
			enableTabIndentation: true,
			// Tab 大小 2 空格
			tabSize: 2,
			// 代码块的 HTML class（用于 hljs 样式识别）
			HTMLAttributes: { class: 'hljs' },
		}),
		// 占位符扩展
		Placeholder.configure({
			// 动态占位符：根据节点类型返回不同文本
			placeholder: ({ editor, node }) => {
				// 有 title 节点时，title 用自己的 placeholder（input 原生的），这里返回空
				if (withTitle && node.type.name === 'title') return '';
				// 标题节点：显示「标题 1」、「标题 2」等
				if (node.type.name === 'heading') {
					return `${zhCN.placeholderHeading} ${node.attrs.level}`;
				}
				// 避免 editor 未使用告警
				void editor;
				// 其他情况（主要是段落）：用默认占位符
				return placeholder;
			},
			// 空编辑器时的 class（用于样式区分）
			emptyEditorClass: 'is-editor-empty',
			// 空节点时的 class
			emptyNodeClass: 'is-empty',
			// 只在当前节点显示（不是所有空节点都显示）
			showOnlyCurrent: true,
			// 只在可编辑状态显示
			showOnlyWhenEditable: true,
		}),
		// 高亮扩展：支持多颜色
		Highlight.configure({ multicolor: true }),
		// 文本对齐扩展
		TextAlign.configure({
			// 支持的节点类型：标题和段落
			types: ['heading', 'paragraph'],
			// 支持的对齐方式：左、中、右、两端
			alignments: ['left', 'center', 'right', 'justify'],
		}),
		// 图片扩展
		Image.configure({
			// 不是行内图片，是块级
			inline: false,
			// 允许 base64 图片
			allowBase64: true,
			// 图片的 HTML class
			HTMLAttributes: { class: 'rich-editor-image' },
			// 调整大小配置
			resize: {
				// 启用调整大小
				enabled: true,
				// 始终保持宽高比
				alwaysPreserveAspectRatio: true,
			},
		}),
		// 自定义图片上传扩展（粘贴/拖放）
		ImageUpload.configure({ resolveSrcRef: resolveImageSrcRef }),
		// 表格套件
		TableKit.configure({
			// 表格可调整列宽
			table: { resizable: true },
		}),
		// 任务列表
		TaskList,
		// 任务项：支持嵌套
		TaskItem.configure({ nested: true }),
		// 字符计数（条件开启：显式 false 时跳过）
		...(withCharCount
			? [
					CharacterCount.configure({
						// 最大长度限制，null 表示不限制
						limit: options.maxLength ?? null,
						// 字符计数：用 Intl.Segmenter 按字素（grapheme）计数
						// 这样中文每个字算 1，表情符号也算 1，更符合直觉
						textCounter: (text) =>
							[
								...new Intl.Segmenter('zh', { granularity: 'grapheme' }).segment(text),
							].length,
						// 词计数：中文按字算，西文按词算
						wordCounter: (text) => {
							// 匹配所有 CJK 字符（中文、日文、韩文等）
							const cjk =
								text.match(
									/[\u4e00-\u9fff\u3400-\u4dbf\uf900-\ufaff]/g,
								)?.length ?? 0;
							// 把 CJK 字符替换成空格，然后按空白分割，数西文单词数
							const latin = text
								.replace(/[\u4e00-\u9fff\u3400-\u4dbf\uf900-\ufaff]/g, ' ')
								.split(/\s+/)
								.filter(Boolean).length;
							// 合计：中文字数 + 西文单词数
							return cjk + latin;
						},
					}),
				]
			: []),
		// 额外扩展：展开追加
		...(options.extraExtensions ?? []),
	];
}
```

---

## 13. 主组件 RichEditor（index.tsx）

**来源**：`apps/remote-plugins/src/components/design/RichEditor/index.tsx`（共 245 行）

### 13.1 模块职责

整个富文本编辑器的**入口组件**，对外暴露 `RichEditor`。它把所有子模块（工具栏、气泡菜单、链接表单、编辑器主体、字数统计）组装起来，并管理编辑器生命周期。

### 13.2 核心设计模式

1. **受控 + 非受控混合模式**：
   - `defaultContent` 非受控（初始值）
   - `content` 受控（外部传入时同步）
   - 内部用 `useEditor` 管理状态

2. **ref 模式传递可变数据**：
   - `resolveImageSrcRef` 用 ref 存上传函数
   - 因为扩展只在创建时组装，用 ref 可以动态更新上传实现而不重建编辑器

3. **EditorContext.Provider**：
   - 把 editor 实例放到 Context 里
   - 子组件（如 Toolbar 里的按钮）可以通过 `useCurrentEditor()` 拿到实例

### 13.3 完整代码与逐行注释

```typescript
// 导入 Editor 类型
import type { Editor } from '@tiptap/react';
// 从 @tiptap/react 导入核心组件和 Hook
import {
	// 编辑器内容渲染组件
	EditorContent,
	// 编辑器上下文
	EditorContext,
	// 创建编辑器实例的 Hook
	useEditor,
	// 订阅编辑器状态的 Hook
	useEditorState,
} from '@tiptap/react';
// 导入气泡菜单组件
import { BubbleMenu } from '@tiptap/react/menus';
// 导入 isTextSelection 类型守卫，用于判断选区是否为文本选区（气泡菜单显隐判断需要）
import { isTextSelection } from '@tiptap/core';
// 导入 React Hook（新增 useCallback，用于缓存 shouldShowBubble 回调）
import { useCallback, useEffect, useMemo, useRef } from 'react';
// 导入 ScrollArea 组件，用于包裹编辑器主体（替代原来的 div.rich-editor-body）
import { ScrollArea } from '@/components/ui/scroll-area';
// 导入 classnames 工具
import { cn } from '@/lib/utils';
// 导入创建扩展的函数（从 extensions/ 目录的 index.ts 导出）
import { createExtensions } from './extensions';
// 导入图片工具（从 image/ 目录的 index.ts 导出）
import { fileToDataUrl, type ResolveImageSrc } from './image';
// 导入链接表单和 Hook（从 link/ 目录的 index.ts 导出）
import { LinkForm, useLinkEditor } from './link';
// 导入国际化类型和中文默认值
import { type RichEditorLocale, zhCN } from './locale';
// 导入编辑器样式
import './styles.css';
// 导入文档工具函数（从 title/ 目录的 index.ts 导出，不再从 createNode 导入）
import { getDocTitleText, normalizeNoteContent } from './title';
// 导入气泡菜单格式化组件 FormatBubble 和工具栏组件 Toolbar（合并为同一行从 toolbar/ 目录导入）
import { FormatBubble, Toolbar } from './toolbar';
// 导入 Props 类型
import type { RichEditorProps } from './types';

// 合并国际化字典：默认中文 + 用户传入的部分覆盖
function mergeLocale(partial?: Partial<RichEditorLocale>): RichEditorLocale {
	// 先用 zhCN 作为默认，再用 partial 覆盖
	return { ...zhCN, ...partial };
}

// 字数统计组件：显示词数和字符数
function CharCount({
	// 编辑器实例
	editor,
	// 国际化字典
	locale,
	// 最大字符数限制
	maxLength,
}: {
	editor: Editor;
	locale: RichEditorLocale;
	maxLength?: number;
}) {
	// 用 useEditorState 订阅字符计数状态
	// selector 函数返回需要的数据，只有数据变化时才重渲染
	const count = useEditorState({
		// 关联的编辑器实例
		editor,
		// 选择器：从 state 中提取需要的数据
		selector: ({ editor: e }) => {
			// 获取 characterCount 扩展的 storage
			const storage = e.storage.characterCount as
				| { characters: () => number; words: () => number }
				| undefined;
			// 返回字符数和词数
			return {
				chars: storage?.characters() ?? 0,
				words: storage?.words() ?? 0,
			};
		},
	});

	// 是否超过最大长度限制
	const over = maxLength != null && count.chars >= maxLength;

	return (
		{/* 底部字数栏；超限时加 is-limit 类（红色警告） */}
		<div className={cn('rich-editor-footer', over && 'is-limit')}>
			{/* 左侧：词数 */}
			<span>
				{count.words} {locale.words}
			</span>
			{/* 右侧：字符数 / 最大限制 · 超限提示 */}
			<span>
				{count.chars}
				{/* 有最大限制时显示 / maxLength */}
				{maxLength != null ? ` / ${maxLength}` : ''} {locale.chars}
				{/* 超限时显示「已达上限」提示 */}
				{over ? ` · ${locale.limitReached}` : ''}
			</span>
		</div>
	);
}

/**
 * TipTap 二次封装富文本编辑器。
 * - 默认中文 UI
 * - 内置 Formatting / 表格 / 本地图片(选图·粘贴·拖放) / 任务 / 字数 / RTL
 * - 通过 extraExtensions / toolbarExtra / onUploadImage 扩展
 */
export function RichEditor({
	// 受控内容（HTML 字符串或 JSON 对象）
	content,
	// 默认内容（非受控初始值）
	defaultContent = '',
	// 内容变化回调
	onChange,
	// 是否可编辑
	editable = true,
	// 是否自动聚焦
	autofocus = true,
	// 占位符文本
	placeholder,
	// 外层容器类名
	className,
	// 编辑器主体类名
	editorClassName,
	// 最大字符数
	maxLength,
	// 文本方向
	textDirection = 'auto',
	// 是否显示工具栏
	showToolbar = true,
	// 是否显示气泡菜单
	showBubbleMenu = true,
	// 是否显示字数统计
	showCharCount = true,
	// 是否显示笔记标题节点（默认 true）
	showTitle = true,
	// 国际化字典（部分覆盖）
	locale: localePartial,
	// 自定义扩展（完全覆盖默认）
	extensions,
	// 额外扩展（追加到默认后面）
	extraExtensions,
	// 工具栏额外按钮
	toolbarExtra,
	// 图片上传回调（返回 URL 或 Promise<URL>）
	onUploadImage,
	// 编辑器创建完成回调
	onCreate,
}: RichEditorProps) {
	// 合并国际化字典：用 useMemo 缓存，避免每次渲染都合并
	const locale = useMemo(() => mergeLocale(localePartial), [localePartial]);

	// 图片 src 解析函数的 ref
	// 为什么用 ref？因为扩展只在编辑器创建时组装一次
	// 如果直接把函数传进扩展，onUploadImage 变化时不会生效
	// 用 ref 的话，扩展里读 resolveSrcRef.current，永远是最新的
	const resolveImageSrcRef = useRef<ResolveImageSrc>(fileToDataUrl);
	// 每次渲染都更新 ref.current，确保始终是最新的
	resolveImageSrcRef.current = async (file) => {
		// 有上传回调就用回调
		if (onUploadImage) return onUploadImage(file);
		// 否则默认 base64
		return fileToDataUrl(file);
	};

	// onChange 回调的 ref
	// 为什么用 ref？因为扩展只在编辑器创建时组装一次
	// 如果直接把函数传进扩展，onChange 变化时不会生效
	// 用 ref 的话，onUpdate 里读 onChangeRef.current，永远是最新的
	const onChangeRef = useRef(onChange);
	// 每次渲染都更新 ref.current，确保始终是最新的
	onChangeRef.current = onChange;

	// onCreate 回调的 ref
	// 同理：用 ref 保存最新回调，避免编辑器重建
	const onCreateRef = useRef(onCreate);
	// 每次渲染都更新 ref.current，确保始终是最新的
	onCreateRef.current = onCreate;

	// 是否启用字数统计扩展
	// 无字数 UI 且无上限时不挂 CharacterCount，避免每键 Segmenter
	// Segmenter 是 Intl.Segmenter，用于按字符/词分割，性能开销较大
	// 如果既不显示字数也没有最大长度限制，就不需要这个扩展
	const enableCharacterCount = showCharCount || maxLength != null;

	// 创建编辑器实例
	const editor = useEditor({
		// 不立即渲染：等 React 准备好再渲染，避免 SSR 问题
		immediatelyRender: false,
		// 扩展列表
		extensions: createExtensions({
			// 占位符
			placeholder: placeholder ?? locale.placeholder,
			// 最大长度
			maxLength,
			// 是否启用字数统计扩展
			characterCount: enableCharacterCount,
			// 是否显示标题节点
			showTitle,
			// 自定义扩展（覆盖默认）
			extensions,
			// 额外扩展（追加）
			extraExtensions,
			// 图片解析 ref
			resolveImageSrcRef,
		}),
		// 初始内容：有 title 时归一化（空内容 → 默认空笔记结构）；无 title 时直接用传入内容
		content: showTitle
			? normalizeNoteContent(content ?? defaultContent)
			: (content ?? defaultContent ?? ''),
		// 是否可编辑
		editable,
		// 是否自动聚焦
		autofocus,
		// 文本方向
		textDirection,
		// 编辑器属性
		editorProps: {
			attributes: {
				// 编辑器元素的 class
				class: cn('tiptap focus:outline-none', editorClassName),
				// 语言：中文
				lang: 'zh-CN',
			},
		},
		// 编辑器创建完成回调
		onCreate: ({ editor: e }) => {
			// 把焦点钉到正文末尾的内部函数
			// 旧版用 setTextSelection(pos) 把选区放进正文首段
			// 新版改成 focus('end')，让光标落在正文末尾，更符合直觉
			const focusBodyEnd = () => {
				// 防御：编辑器可能已被销毁（异步回调中调用时需要检查）
				if (e.isDestroyed) return;
				// 第一个节点是 title 时，把焦点移到正文末尾
				if (e.state.doc.firstChild?.type.name === 'title') {
					// focus('end') 把光标放到整个文档末尾（即正文最后）
					e.commands.focus('end');
				}
			};
			// 立即先调用一次，覆盖大多数场景
			focusBodyEnd();
			// Title NodeView 是用 React 渲染的，它挂载会重新设置选区
			// 这里用 requestAnimationFrame 两帧延迟，等 NodeView 挂载完再钉一次
			// 第一帧：通常 Title NodeView 已挂载但选区可能被打乱
			requestAnimationFrame(() => {
				// 再次钉到末尾
				focusBodyEnd();
				// 第二帧：保险起见再钉一次，彻底稳定选区
				requestAnimationFrame(focusBodyEnd);
			});
			// 调用用户的 onCreate 回调（通过 ref 读取最新函数）
			onCreateRef.current?.(e);
		},
		// 内容更新回调
		onUpdate: ({ editor: e }) => {
			// 通过 ref 读取最新的 onChange 回调
			const cb = onChangeRef.current;
			// 没有回调就直接返回，避免不必要的计算
			if (!cb) return;
			// 调用 onChange，传出多种格式
			cb({
				// HTML 格式
				html: e.getHTML(),
				// 纯文本格式（段落之间用两个换行分隔）
				text: e.getText({ blockSeparator: '\n\n' }),
				// 标题文本
				title: getDocTitleText(e.state.doc),
			});
			// 热路径不做 getJSON（学习笔记等只用 html/text/title）
			// 如果需要 JSON 格式，外部可以自己通过 editor 实例获取
		},
	});

	// 链接编辑器 Hook：管理链接表单的打开/关闭/应用/移除
	const link = useLinkEditor(editor);
	// 用 ref 镜像 link.draft，供 shouldShowBubble 读取最新值
	// shouldShowBubble 是 useCallback([]) 空依赖，闭包里拿不到最新 link.draft
	// 用 ref 可以让回调始终读到当前的 draft 状态，同时保持引用稳定
	const linkDraftRef = useRef(link.draft);
	// 每次渲染都同步 ref.current 到最新的 draft
	linkDraftRef.current = link.draft;

	/**
	 * 气泡菜单的 shouldShow 回调（提取为独立的 useCallback）
	 * - 旧版直接在 BubbleMenu 的 shouldShow prop 里内联写，每次渲染都创建新函数
	 * - 新版提取出来用 useCallback 缓存，引用稳定，避免 BubbleMenu 不必要重渲染
	 * - 通过 linkDraftRef 读取最新 link.draft，绕开 useCallback 的依赖闭包问题
	 * - 补回了 isTextSelection 判断和 doc.textBetween(from, to).length 空文本判断
	 *   （旧版只检查 selection.empty，对于空块选区会误判，导致空段落也弹气泡）
	 * - 新增 view.hasFocus() 和 e.isEditable 检查，避免失焦时还残留气泡
	 */
	const shouldShowBubble = useCallback(
		({
			// 编辑器实例
			editor: e,
			// ProseMirror 视图（用于检查焦点）
			view,
			// 编辑器状态
			state,
			// 选区起点
			from,
			// 选区终点
			to,
		}: {
			editor: Editor;
			// 视图只需要 hasFocus 方法
			view: { hasFocus: () => boolean };
			// state 类型：需要 doc.textBetween 和 selection.empty
			state: {
				doc: { textBetween: (a: number, b: number) => string };
				selection: { empty: boolean };
			};
			from: number;
			to: number;
		}) => {
			// 链接表单打开时（draft 非空）不显示气泡，避免与 LinkForm 打架
			// 用 ref 读最新值，绕过 useCallback 闭包
			if (linkDraftRef.current || !e.isEditable) return false;
			// 编辑器未获得焦点时不显示（防止失焦后气泡残留）
			if (!view.hasFocus()) return false;
			// 解构 doc 和 selection
			const { doc, selection } = state;
			// 任一条件成立都不显示：
			// - !isTextSelection(selection)：非文本选区（如节点选区、单元格选区）
			// - selection.empty：选区为空（没有选中内容）
			// - from === to：起点等于终点（实际就是空选区）
			// - !doc.textBetween(from, to).length：选区之间没有文本（如选中了纯图片节点）
			if (
				!isTextSelection(selection) ||
				selection.empty ||
				from === to ||
				!doc.textBetween(from, to).length
			) {
				return false;
			}
			// 选中的是图片或代码块时不显示气泡菜单（它们的格式化由别处处理）
			if (e.isActive('image') || e.isActive('codeBlock')) return false;
			// 其余情况：显示气泡菜单
			return true;
		},
		// 空依赖：依赖项都通过 ref 读取，回调引用永远稳定
		[],
	);

	// 监听 editable 变化，动态设置编辑器是否可编辑
	useEffect(() => {
		// 编辑器不存在就返回
		if (!editor) return;
		// 设置可编辑状态
		editor.setEditable(editable);
	// 依赖：editor 实例和 editable prop
	}, [editor, editable]);

	// 受控同步：仅在外部 content 与当前不一致时写入，避免打断输入
	useEffect(() => {
		// 编辑器不存在，或 content 是 undefined（非受控模式）→ 不处理
		if (!editor || content === undefined) return;
		// 下一个内容：统一转成字符串比较
		const next =
			typeof content === 'string' ? content : JSON.stringify(content);
		// 当前内容：根据 content 类型选择 HTML 或 JSON
		const current =
			typeof content === 'string'
				? editor.getHTML()
				: JSON.stringify(editor.getJSON());
		// 内容相同就不更新（避免打断用户输入）
		if (next === current) return;
		// 内容不同才设置
		// emitUpdate: false 表示不触发 onUpdate，避免循环
		editor.commands.setContent(normalizeNoteContent(content), {
			emitUpdate: false,
		});
	// 依赖：editor 实例和 content prop
	}, [editor, content]);

	// EditorContext 的 value：用 useMemo 缓存，避免不必要的重渲染
	const ctx = useMemo(() => ({ editor }), [editor]);

	// 工具栏额外内容：用 useMemo 缓存，避免每次渲染都重新计算
	// 如果是函数，传 editor 调用；否则直接用
	// 依赖：editor 实例和 toolbarExtra prop
	const extra = useMemo(() => {
		// 编辑器不存在时返回 undefined
		if (!editor) return undefined;
		// 根据 toolbarExtra 类型决定是调用还是直接使用
		return typeof toolbarExtra === 'function' ? toolbarExtra(editor) : toolbarExtra;
	}, [editor, toolbarExtra]);

	// 编辑器还没创建好 → 返回 null
	if (!editor) return null;

	// 渲染编辑器
	return (
		// 提供 EditorContext，子组件可以通过 useCurrentEditor() 获取实例
		<EditorContext.Provider value={ctx}>
			{/* 外层容器（新增 rounded-r-md：右侧圆角，配合左侧工具栏的整体视觉） */}
			<div
				className={cn('rich-editor rounded-r-md', className)}
				lang="zh-CN"
			>
				{/* 工具栏（可配置是否显示） */}
				{showToolbar && (
					<Toolbar
						editor={editor}
						locale={locale}
						onUploadImage={onUploadImage}
						onOpenLink={link.open}
						linkOpen={!!link.draft}
						extra={extra}
					/>
				)}

				{/* 链接表单：有草稿时显示（在工具栏下面，编辑器上面） */}
				{link.draft && (
					<LinkForm
						locale={locale}
						href={link.draft.href}
						onHrefChange={link.setHref}
						onApply={link.apply}
						onRemove={link.remove}
						onClose={link.close}
						{/* 没有目标范围（空行）时显示提示 */}
						hint={link.draft.range ? undefined : locale.linkEmptyHint}
					/>
				)}

				{/* 气泡菜单（选中文本时浮动显示） */}
				{showBubbleMenu && (
					<BubbleMenu
						editor={editor}
						{/* shouldShow 提取为稳定的 useCallback（见上方 shouldShowBubble） */}
						shouldShow={shouldShowBubble}
						{/* 配置：在上方，偏移 8px，空间不够时翻转 */}
						options={{ placement: 'top', offset: 8, flip: true }}
					>
						{/* 气泡菜单内容：格式化按钮 */}
						<FormatBubble
							editor={editor}
							locale={locale}
							onOpenLink={link.open}
						/>
					</BubbleMenu>
				)}

				{/* 编辑器主体区域（改用 ScrollArea 包裹，提供原生滚动条样式） */}
				<ScrollArea className="rich-editor-body">
					{/* 编辑器内容渲染组件 */}
					<EditorContent editor={editor} spellCheck="false" />
				</ScrollArea>

				{/* 字数统计（可配置是否显示） */}
				{showCharCount && (
					<CharCount editor={editor} locale={locale} maxLength={maxLength} />
				)}
			</div>
		</EditorContext.Provider>
	);
}

// 默认导出
export default RichEditor;
// 重新导出 Editor 类型，方便外部使用
export type { Editor } from '@tiptap/react';
// 重新导出代码语言相关（从 code/ 目录导出）
export type { CodeLanguage } from './code';
export { CODE_LANGUAGES } from './code';
// 重新导出 createExtensions，方便外部自定义扩展
export { createExtensions } from './extensions';
// 重新导出图片相关类型和函数（从 image/ 目录导出）
export type { ResolveImageSrc } from './image';
export { fileToDataUrl, pickImageFile } from './image';
// 重新导出国际化相关
export type { RichEditorLocale } from './locale';
export { zhCN } from './locale';
// 重新导出 Title 节点相关（从 title/ 目录导出，导出顺序按字母序：EMPTY_NOTE_DOC / getDocTitleText / normalizeNoteContent / TitleNode）
export {
	EMPTY_NOTE_DOC,
	getDocTitleText,
	normalizeNoteContent,
	TitleNode,
} from './title';
// 重新导出工具栏 Btn 组件（从 toolbar/ 目录导出）
export { Btn } from './toolbar';
// 重新导出类型定义
export type {
	CreateExtensionsOptions,
	RichEditorChangePayload,
	RichEditorContent,
	RichEditorProps,
	TextDirection,
} from './types';
```

---

## 14. 工具栏（toolbar/Toolbar.tsx）

**来源**：`apps/remote-plugins/src/components/design/RichEditor/toolbar/Toolbar.tsx`（共 1014 行）

### 14.1 模块职责

编辑器顶部工具栏，对外暴露 `Toolbar` 与基础按钮 `Btn`。提供：
- 文本格式（粗体、斜体、下划线、删除线、高亮、清除格式）
- 标题级别（H1-H5，下拉菜单切换）
- 列表（有序、无序、任务列表）
- 引用块、代码块（含代码语言选择器）
- 对齐方式（左、中、右、两端）
- 插入（链接、取消链接、图片、表格、分割线）
- 表格上下文操作（光标在表格内时动态出现：加列、加行、删表）
- 撤销/重做
- 响应式溢出处理（空间不够时把溢出按钮收起到「更多」下拉菜单）
- 右侧 `extra` 扩展位

### 14.2 核心设计

**1. ToolItem 双节点模式**

每个工具项定义为 `{ id, node, menu }`：
- `node`：工具栏内联渲染节点（一个 `Btn` 或一个 `DropdownMenu`）
- `menu`：折叠到「更多」下拉菜单时渲染的节点（一个 `MenuRow` 或一组 `MenuRow`）

这样一份配置同时服务两种展示场景，溢出项无需重新写一遍 UI。

**2. 响应式溢出处理**

- 渲染一个隐藏的 measure 行（`rich-editor-toolbar-measure`），结构与真实按钮同构，用于测量每个工具项的真实宽度。
- `useLayoutEffect` 中读取 measure 行各子元素的 `getBoundingClientRect().width`，结合容器 `clientWidth`、内边距、column-gap、`extra` 宽度，逐步累加计算最多能放下几项（`visibleCount`）。
- 若全部放得下则不显示「更多」按钮；否则预留 `MORE_W`（More 按钮宽度）后再算可见数量。
- `ResizeObserver` 监听容器与 extra 宽度变化，触发 `recalc` 重新计算，实现窗口缩放时动态折叠/展开。

**3. 条件渲染**

- 代码语言选择器（`<select>`）只在 `state.codeBlock` 为真时才 push 到工具项数组，避免非代码块场景出现无意义控件。
- 表格操作（加列、加行、删表）只在 `state.inTable` 为真时才 push，光标离开表格后自动消失。

**4. useEditorState 统一订阅**

用 `useEditorState` 一次性 selector 出所有按钮需要的 active/can 状态（bold、italic、各标题级别、列表、对齐、link、inTable、canUndo、canRedo 等），避免每个按钮单独订阅编辑器造成的重渲染浪费。`tools` 数组依赖 `state` 重建，状态变化时按钮 active 态自动刷新。

### 14.3 完整代码与逐行注释

```typescript
// 导入 Editor 类型（仅类型，不引入运行时）
import type { Editor } from '@tiptap/react';
// 从 @tiptap/react 导入 useEditorState，用于一次性订阅编辑器状态
import { useEditorState } from '@tiptap/react';
// 从 lucide-react 导入一系列图标组件
import {
	// 居中对齐图标
	AlignCenter,
	// 两端对齐图标
	AlignJustify,
	// 左对齐图标
	AlignLeft,
	// 右对齐图标
	AlignRight,
	// 粗体图标
	Bold,
	// 任务列表（复选框）图标
	CheckSquare,
	// 行内代码/代码块图标
	Code,
	// 通用标题图标（默认触发器）
	Heading,
	// 一级标题图标
	Heading1,
	// 二级标题图标
	Heading2,
	// 三级标题图标
	Heading3,
	// 四级标题图标
	Heading4,
	// 五级标题图标
	Heading5,
	// 高亮图标
	Highlighter,
	// 图片图标
	ImageIcon,
	// 斜体图标
	Italic,
	// 链接图标
	Link2,
	// 取消链接图标
	Link2Off,
	// 无序列表图标
	List,
	// 有序列表图标
	ListOrdered,
	// 分割线图标
	Minus,
	// 「更多」按钮图标（三个点）
	MoreHorizontal,
	// 引用块图标
	Quote,
	// 重做图标
	Redo2,
	// 清除格式图标
	RemoveFormatting,
	// 删除线图标
	Strikethrough,
	// 表格图标
	Table,
	// 下划线图标
	Underline,
	// 撤销图标
	Undo2,
} from 'lucide-react';
// 从 React 导入 Fragment、类型与 Hook
import {
	// Fragment：包裹多个子节点而不引入额外 DOM
	Fragment,
	// ReactNode 类型
	type ReactNode,
	// useLayoutEffect：在浏览器绘制前同步执行，用于测量布局
	useLayoutEffect,
	// useMemo：缓存计算结果
	useMemo,
	// useRef：保存可变引用
	useRef,
	// useState：状态管理
	useState,
} from 'react';
// 从项目 UI 库导入下拉菜单相关组件
import {
	// 下拉菜单根容器
	DropdownMenu,
	// 下拉菜单内容容器
	DropdownMenuContent,
	// 下拉菜单分组
	DropdownMenuGroup,
	// 下拉菜单项
	DropdownMenuItem,
	// 下拉菜单分组标签
	DropdownMenuLabel,
	// 下拉菜单触发器
	DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
// 导入 classnames 工具函数
import { cn } from '@/lib/utils';
// 从兄弟目录 code 导入代码高亮语言列表
import { CODE_LANGUAGES } from '../code';
// 从兄弟目录 image 导入图片工具函数和类型
import {
	// fileToDataUrl：把文件转成 data URL（默认上传实现）
	fileToDataUrl,
	// insertImages：批量插入图片到编辑器
	insertImages,
	// pickImageFile：弹出文件选择器，返回用户选中的文件
	pickImageFile,
	// ResolveImageSrc 类型：图片地址解析函数
	type ResolveImageSrc,
} from '../image';
// 从兄弟目录 locale 导入国际化字典类型
import type { RichEditorLocale } from '../locale';

// 组件 Props 类型定义
type Props = {
	// 编辑器实例（由父组件传入）
	editor: Editor;
	// 国际化字典
	locale: RichEditorLocale;
	// 图片上传函数（可选）；不传则用 fileToDataUrl 内联 base64
	onUploadImage?: ResolveImageSrc;
	// 打开链接表单的回调
	onOpenLink: () => void;
	// 链接表单是否打开（用于高亮链接按钮）
	linkOpen?: boolean;
	// 工具栏右侧额外内容（扩展位）
	extra?: ReactNode;
	// 自定义样式类名
	className?: string;
};

// 工具项类型：每个工具同时提供内联节点和更多菜单节点
type ToolItem = {
	// 唯一标识（用于 key 和测量定位）
	id: string;
	// 工具栏内联节点（说明）
	/** 工具栏内联节点 */
	// 内联渲染的 React 节点
	node: ReactNode;
	// 「更多」菜单内节点说明
	/** 「更多」菜单内节点；缺省则仅内联展示 */
	// 折叠到「更多」下拉菜单时渲染的节点（可选）
	menu?: ReactNode;
};

// 图标尺寸常量（15px）
const ICON = 15;
// More 按钮自身宽度说明
/** More 按钮自身宽度（1.75rem + ml-0.5），不含 flex gap */
// More 按钮自身宽度（1.75rem + ml-0.5），不含 flex gap
const MORE_W = 30;

// 工具栏按钮基础组件（导出供外部复用）
export function Btn({
	// 悬停提示与无障碍标签
	title,
	// 是否激活（高亮）
	active,
	// 是否禁用
	disabled,
	// 点击回调
	onClick,
	// 按钮内容（通常是图标）
	children,
	// 自定义样式类名
	className,
}: {
	// Props 类型
	// 提示文字
	title: string;
	// 激活态
	active?: boolean;
	// 禁用态
	disabled?: boolean;
	// 点击事件回调
	onClick: (e?: MouseEvent) => void;
	// 子节点
	children: ReactNode;
	// 类名
	className?: string;
}) {
	// 返回一个原生 button
	return (
		// 原生 button 元素
		<button
			{/* type="button" 避免触发表单提交 */}
			type="button"
			{/* 悬停提示 */}
			title={title}
			{/* 无障碍标签 */}
			aria-label={title}
			{/* 标记按钮按下/激活状态，供屏幕阅读器识别 */}
			aria-pressed={active}
			{/* 禁用属性 */}
			disabled={disabled}
			{/* 样式：基础按钮 + 左外边距 + 激活态 + 自定义类 */}
			className={cn('rich-editor-btn ml-0.5', active && 'is-active', className)}
			{/* 阻止默认 mousedown，避免点击按钮时编辑器失焦 */}
			onMouseDown={(e) => e.preventDefault()}
			{/* 点击时调用回调（把 React 事件转成 MouseEvent） */}
			onClick={(e) => onClick(e as unknown as MouseEvent)}
		>
			{/* 渲染子节点（图标） */}
			{children}
		</button>
	);
}

// 「更多」下拉菜单中的单行项（内部组件，未导出）
function MenuRow({
	// 行标题
	title,
	// 激活态
	active,
	// 禁用态
	disabled,
	// 选中回调
	onSelect,
	// 行内图标/内容
	children,
}: {
	// Props 类型
	title: string;
	active?: boolean;
	disabled?: boolean;
	// 选中回调（无参数）
	onSelect: () => void;
	children: ReactNode;
}) {
	// 返回一个下拉菜单项
	return (
		// 下拉菜单项组件
		<DropdownMenuItem
			{/* 禁用态 */}
			disabled={disabled}
			{/* 提示文字 */}
			title={title}
			{/* 激活时加浅色背景 */}
			className={cn(active && 'bg-theme/10')}
			{/* 选中回调 */}
			onSelect={onSelect}
		>
			{/* 行内布局：flex 全宽居中，间距 2 */}
			<div className="flex w-full items-center gap-2">
				{/* 图标内容 */}
				{children}
				{/* 标题文字 */}
				<span className="text-sm text-textcolor/90">{title}</span>
			</div>
		</DropdownMenuItem>
	);
}

// 工具栏主组件（导出）
export function Toolbar({
	// 编辑器实例
	editor,
	// 国际化字典（重命名为 t 方便使用）
	locale: t,
	// 图片上传函数
	onUploadImage,
	// 打开链接表单回调
	onOpenLink,
	// 链接表单是否打开
	linkOpen,
	// 额外内容
	extra,
	// 自定义类名
	className,
}: Props) {
	// 用 useEditorState 一次性订阅编辑器所有需要的状态，避免每个按钮单独订阅
	const state = useEditorState({
		// 关联的编辑器实例
		editor,
		// 选择器：从编辑器提取需要的状态字段，只有这些字段变化才重渲染
		selector: ({ editor: e }) => ({
			// 粗体是否激活
			bold: e.isActive('bold'),
			// 斜体是否激活
			italic: e.isActive('italic'),
			// 下划线是否激活
			underline: e.isActive('underline'),
			// 删除线是否激活
			strike: e.isActive('strike'),
			// 行内代码是否激活
			code: e.isActive('code'),
			// 高亮是否激活
			highlight: e.isActive('highlight'),
			// 一级标题是否激活
			h1: e.isActive('heading', { level: 1 }),
			// 二级标题是否激活
			h2: e.isActive('heading', { level: 2 }),
			// 三级标题是否激活
			h3: e.isActive('heading', { level: 3 }),
			// 四级标题是否激活
			h4: e.isActive('heading', { level: 4 }),
			// 五级标题是否激活
			h5: e.isActive('heading', { level: 5 }),
			// 无序列表是否激活
			bullet: e.isActive('bulletList'),
			// 有序列表是否激活
			ordered: e.isActive('orderedList'),
			// 任务列表是否激活
			task: e.isActive('taskList'),
			// 引用块是否激活
			quote: e.isActive('blockquote'),
			// 代码块是否激活
			codeBlock: e.isActive('codeBlock'),
			// 当前代码块语言
			codeLanguage:
				// 从 codeBlock 的 attributes 中读取 language
				(e.getAttributes('codeBlock').language as string | undefined) ??
				// 缺省为 javascript
				'javascript',
			// 链接是否激活
			link: e.isActive('link'),
			// 左对齐是否激活
			alignLeft: e.isActive({ textAlign: 'left' }),
			// 居中对齐是否激活
			alignCenter: e.isActive({ textAlign: 'center' }),
			// 右对齐是否激活
			alignRight: e.isActive({ textAlign: 'right' }),
			// 两端对齐是否激活
			alignJustify: e.isActive({ textAlign: 'justify' }),
			// 光标是否在表格内
			inTable: e.isActive('table'),
			// 是否可撤销
			canUndo: e.can().undo(),
			// 是否可重做
			canRedo: e.can().redo(),
		}),
	});

	// 插入图片的异步函数
	const insertImage = async () => {
		// 弹出文件选择器等待用户选择图片
		const file = await pickImageFile();
		// 用户取消则直接返回
		if (!file) return;
		// 上传实现：优先用外部传入的，否则用 base64 内联
		const resolve = onUploadImage ?? fileToDataUrl;
		// 调用 insertImages 把图片插入编辑器
		await insertImages(editor, [file], resolve);
	};

	// 标题级别配置数组（图标 + 标题 + 级别）
	const HEADING_LEVELS = [
		// H1：Heading1 图标，t.h1 文案
		{ level: 1 as const, icon: Heading1, title: t.h1 },
		// H2
		{ level: 2 as const, icon: Heading2, title: t.h2 },
		// H3
		{ level: 3 as const, icon: Heading3, title: t.h3 },
		// H4
		{ level: 4 as const, icon: Heading4, title: t.h4 },
		// H5
		{ level: 5 as const, icon: Heading5, title: t.h5 },
	];

	// 找到当前激活的标题级别（用于工具栏标题按钮显示对应图标）
	const activeHeading =
		// 通过 state.h1~h5 判断哪个级别激活，找不到则为 null
		HEADING_LEVELS.find(({ level }) => state[`h${level}` as const]) ?? null;
	// 标题按钮触发器图标：激活时用对应级别图标，否则用通用 Heading 图标
	const HeadingTriggerIcon = activeHeading?.icon ?? Heading;

	// 切换标题级别的处理函数
	const handleHeading = (level: 1 | 2 | 3 | 4 | 5) => {
		// focus 防失焦，toggleHeading 切换标题
		editor.chain().focus().toggleHeading({ level }).run();
	};

	// 用 useMemo 缓存工具项数组，依赖编辑器状态重建
	const tools = useMemo((): ToolItem[] => {
		// 工具项数组
		const items: ToolItem[] = [
			// 撤销按钮
			{
				// 唯一 id
				id: 'undo',
				// 工具栏内联节点
				node: (
					// 撤销按钮
					<Btn
						{/* 提示文案 */}
						title={t.undo}
						{/* 不可撤销时禁用 */}
						disabled={!state.canUndo}
						{/* 去掉左外边距（首个按钮） */}
						className="ml-0"
						{/* focus 后执行撤销 */}
						onClick={() => editor.chain().focus().undo().run()}
					>
						{/* 撤销图标 */}
						<Undo2 size={ICON} />
					</Btn>
				),
				// 「更多」菜单内节点
				menu: (
					// 撤销菜单项
					<MenuRow
						title={t.undo}
						disabled={!state.canUndo}
						{/* 选中后执行撤销 */}
						onSelect={() => editor.chain().focus().undo().run()}
					>
						<Undo2 size={ICON} />
					</MenuRow>
				),
			},
			// 重做按钮
			{
				id: 'redo',
				// 工具栏内联节点
				node: (
					<Btn
						title={t.redo}
						{/* 不可重做时禁用 */}
						disabled={!state.canRedo}
						onClick={() => editor.chain().focus().redo().run()}
					>
						{/* 重做图标 */}
						<Redo2 size={ICON} />
					</Btn>
				),
				menu: (
					<MenuRow
						title={t.redo}
						disabled={!state.canRedo}
						onSelect={() => editor.chain().focus().redo().run()}
					>
						<Redo2 size={ICON} />
					</MenuRow>
				),
			},
			// 粗体按钮
			{
				id: 'bold',
				node: (
					<Btn
						title={t.bold}
						{/* 当前是否粗体 */}
						active={state.bold}
						onClick={() => editor.chain().focus().toggleBold().run()}
					>
						{/* 粗体图标 */}
						<Bold size={ICON} />
					</Btn>
				),
				menu: (
					<MenuRow
						title={t.bold}
						active={state.bold}
						onSelect={() => editor.chain().focus().toggleBold().run()}
					>
						<Bold size={ICON} />
					</MenuRow>
				),
			},
			// 斜体按钮
			{
				id: 'italic',
				node: (
					<Btn
						title={t.italic}
						active={state.italic}
						onClick={() => editor.chain().focus().toggleItalic().run()}
					>
						{/* 斜体图标 */}
						<Italic size={ICON} />
					</Btn>
				),
				menu: (
					<MenuRow
						title={t.italic}
						active={state.italic}
						onSelect={() => editor.chain().focus().toggleItalic().run()}
					>
						<Italic size={ICON} />
					</MenuRow>
				),
			},
			// 下划线按钮
			{
				id: 'underline',
				node: (
					<Btn
						title={t.underline}
						active={state.underline}
						onClick={() => editor.chain().focus().toggleUnderline().run()}
					>
						{/* 下划线图标 */}
						<Underline size={ICON} />
					</Btn>
				),
				menu: (
					<MenuRow
						title={t.underline}
						active={state.underline}
						onSelect={() => editor.chain().focus().toggleUnderline().run()}
					>
						<Underline size={ICON} />
					</MenuRow>
				),
			},
			// 删除线按钮
			{
				id: 'strike',
				node: (
					<Btn
						title={t.strike}
						active={state.strike}
						onClick={() => editor.chain().focus().toggleStrike().run()}
					>
						{/* 删除线图标 */}
						<Strikethrough size={ICON} />
					</Btn>
				),
				menu: (
					<MenuRow
						title={t.strike}
						active={state.strike}
						onSelect={() => editor.chain().focus().toggleStrike().run()}
					>
						<Strikethrough size={ICON} />
					</MenuRow>
				),
			},
			// 高亮按钮
			{
				id: 'highlight',
				node: (
					<Btn
						title={t.highlight}
						active={state.highlight}
						onClick={() => editor.chain().focus().toggleHighlight().run()}
					>
						{/* 高亮图标 */}
						<Highlighter size={ICON} />
					</Btn>
				),
				menu: (
					<MenuRow
						title={t.highlight}
						active={state.highlight}
						onSelect={() => editor.chain().focus().toggleHighlight().run()}
					>
						<Highlighter size={ICON} />
					</MenuRow>
				),
			},
			// 清除格式按钮
			{
				id: 'clearFormat',
				node: (
					<Btn
						title={t.clearFormat}
						{/* 清除所有 marks 并清空节点格式 */}
						onClick={() =>
							editor.chain().focus().unsetAllMarks().clearNodes().run()
						}
					>
						{/* 清除格式图标 */}
						<RemoveFormatting size={ICON} />
					</Btn>
				),
				menu: (
					<MenuRow
						title={t.clearFormat}
						onSelect={() =>
							editor.chain().focus().unsetAllMarks().clearNodes().run()
						}
					>
						<RemoveFormatting size={ICON} />
					</MenuRow>
				),
			},
			// 标题级别（下拉菜单切换 H1-H5）
			{
				id: 'heading',
				// 内联节点是一个下拉菜单
				node: (
					<DropdownMenu>
						{/* 触发器：显示当前激活级别的图标 */}
						<DropdownMenuTrigger asChild>
							<button
								type="button"
								{/* 提示：当前激活级别标题或默认「标题级别」 */}
								title={activeHeading?.title ?? '标题级别'}
								aria-label={activeHeading?.title ?? '标题级别'}
								{/* 样式：基础按钮 + 左外边距，激活时高亮 */}
								className={cn(
									'rich-editor-btn ml-0.5',
									activeHeading && 'is-active',
								)}
								{/* 阻止失焦 */}
								onMouseDown={(e) => e.preventDefault()}
							>
								{/* 当前标题级别图标（或默认 Heading 图标） */}
								<HeadingTriggerIcon size={ICON} />
							</button>
						</DropdownMenuTrigger>
						{/* 下拉内容 */}
						<DropdownMenuContent
							{/* 居中对齐触发器 */}
							align="center"
							{/* 距触发器 8px */}
							sideOffset={8}
							className="w-20"
							{/* 关闭时不把焦点收回触发器，避免编辑器失焦 */}
							onCloseAutoFocus={(e) => e.preventDefault()}
						>
							<DropdownMenuGroup>
								{/* 分组标签 */}
								<DropdownMenuLabel className="text-textcolor/90">
									标题级别
								</DropdownMenuLabel>
								{/* 遍历各级标题生成菜单项 */}
								{HEADING_LEVELS.map(({ level, icon: Icon, title }) => {
									// 当前级别是否激活
									const active = state[`h${level}` as const];
									return (
										<DropdownMenuItem
											key={level}
											title={title}
											{/* 激活时浅色背景 */}
											className={cn(active && 'bg-theme/10')}
											{/* 选中后切换到该级别 */}
											onSelect={() => handleHeading(level)}
										>
											<div className="flex w-full items-center justify-between">
												{/* 级别图标 */}
												<Icon size={ICON} className="text-textcolor" />
												{/* 级别文案 */}
												<span className="text-sm text-textcolor/90">
													{title}
												</span>
											</div>
										</DropdownMenuItem>
									);
								})}
							</DropdownMenuGroup>
						</DropdownMenuContent>
					</DropdownMenu>
				),
				// 「更多」菜单内：直接铺开各级标题
				menu: (
					<>
						{/* 分组标签 */}
						<DropdownMenuLabel className="text-textcolor/90">
							标题级别
						</DropdownMenuLabel>
						{/* 遍历各级标题生成菜单行 */}
						{HEADING_LEVELS.map(({ level, icon: Icon, title }) => {
							const active = state[`h${level}` as const];
							return (
								<MenuRow
									key={level}
									title={title}
									active={active}
									onSelect={() => handleHeading(level)}
								>
									<Icon size={ICON} />
								</MenuRow>
							);
						})}
					</>
				),
			},
			// 无序列表按钮
			{
				id: 'bullet',
				node: (
					<Btn
						title={t.bulletList}
						active={state.bullet}
						onClick={() => editor.chain().focus().toggleBulletList().run()}
					>
						{/* 无序列表图标 */}
						<List size={ICON} />
					</Btn>
				),
				menu: (
					<MenuRow
						title={t.bulletList}
						active={state.bullet}
						onSelect={() => editor.chain().focus().toggleBulletList().run()}
					>
						<List size={ICON} />
					</MenuRow>
				),
			},
			// 有序列表按钮
			{
				id: 'ordered',
				node: (
					<Btn
						title={t.orderedList}
						active={state.ordered}
						onClick={() => editor.chain().focus().toggleOrderedList().run()}
					>
						{/* 有序列表图标 */}
						<ListOrdered size={ICON} />
					</Btn>
				),
				menu: (
					<MenuRow
						title={t.orderedList}
						active={state.ordered}
						onSelect={() => editor.chain().focus().toggleOrderedList().run()}
					>
						<ListOrdered size={ICON} />
					</MenuRow>
				),
			},
			// 任务列表按钮
			{
				id: 'task',
				node: (
					<Btn
						title={t.taskList}
						active={state.task}
						onClick={() => editor.chain().focus().toggleTaskList().run()}
					>
						{/* 任务列表图标 */}
						<CheckSquare size={ICON} />
					</Btn>
				),
				menu: (
					<MenuRow
						title={t.taskList}
						active={state.task}
						onSelect={() => editor.chain().focus().toggleTaskList().run()}
					>
						<CheckSquare size={ICON} />
					</MenuRow>
				),
			},
			// 引用块按钮
			{
				id: 'quote',
				node: (
					<Btn
						title={t.blockquote}
						active={state.quote}
						onClick={() => editor.chain().focus().toggleBlockquote().run()}
					>
						{/* 引用块图标 */}
						<Quote size={ICON} />
					</Btn>
				),
				menu: (
					<MenuRow
						title={t.blockquote}
						active={state.quote}
						onSelect={() => editor.chain().focus().toggleBlockquote().run()}
					>
						<Quote size={ICON} />
					</MenuRow>
				),
			},
			// 代码块按钮
			{
				id: 'codeBlock',
				node: (
					<Btn
						title={t.codeBlock}
						active={state.codeBlock}
						{/* 切换代码块，附带当前/默认语言 */}
						onClick={() =>
							editor
								.chain()
								.focus()
								.toggleCodeBlock({
									language: state.codeLanguage || 'javascript',
								})
								.run()
						}
					>
						{/* 代码块图标 */}
						<Code size={ICON} />
					</Btn>
				),
				menu: (
					<MenuRow
						title={t.codeBlock}
						active={state.codeBlock}
						onSelect={() =>
							editor
								.chain()
								.focus()
								.toggleCodeBlock({
									language: state.codeLanguage || 'javascript',
								})
								.run()
						}
					>
						<Code size={ICON} />
					</MenuRow>
				),
			},
		];

		// 条件渲染：仅在代码块激活时才追加语言选择器
		if (state.codeBlock) {
			items.push({
				id: 'codeLanguage',
				// 内联节点是一个原生 select
				node: (
					<select
						className="rich-editor-lang"
						title={t.codeLanguage}
						aria-label={t.codeLanguage}
						{/* 当前语言 */}
						value={state.codeLanguage}
						{/* 阻止 mousedown 冒泡，避免触发菜单关闭等 */}
						onMouseDown={(e) => e.stopPropagation()}
						{/* 切换语言：更新 codeBlock 的 language 属性 */}
						onChange={(e) => {
							editor
								.chain()
								.focus()
								.updateAttributes('codeBlock', { language: e.target.value })
								.run();
						}}
					>
						{/* 遍历语言列表生成 option */}
						{CODE_LANGUAGES.map((lang) => (
							<option key={lang.value} value={lang.value}>
								{lang.label}
							</option>
						))}
					</select>
				),
				// 「更多」菜单内：铺开所有语言为菜单行
				menu: (
					<>
						{/* 分组标签 */}
						<DropdownMenuLabel className="text-textcolor/90">
							{t.codeLanguage}
						</DropdownMenuLabel>
						{CODE_LANGUAGES.map((lang) => (
							<MenuRow
								key={lang.value}
								title={lang.label}
								{/* 当前语言高亮 */}
								active={state.codeLanguage === lang.value}
								onSelect={() =>
									editor
										.chain()
										.focus()
										.updateAttributes('codeBlock', { language: lang.value })
										.run()
								}
							>
								<Code size={ICON} />
							</MenuRow>
						))}
					</>
				),
			});
		}

		// 追加后续工具项：分割线、对齐、链接、图片、表格
		items.push(
			// 分割线按钮
			{
				id: 'hr',
				node: (
					<Btn
						title={t.horizontalRule}
						{/* 插入水平分割线 */}
						onClick={() => editor.chain().focus().setHorizontalRule().run()}
					>
						{/* 分割线图标 */}
						<Minus size={ICON} />
					</Btn>
				),
				menu: (
					<MenuRow
						title={t.horizontalRule}
						onSelect={() => editor.chain().focus().setHorizontalRule().run()}
					>
						<Minus size={ICON} />
					</MenuRow>
				),
			},
			// 左对齐按钮
			{
				id: 'alignLeft',
				node: (
					<Btn
						title={t.alignLeft}
						active={state.alignLeft}
						onClick={() => editor.chain().focus().setTextAlign('left').run()}
					>
						{/* 左对齐图标 */}
						<AlignLeft size={ICON} />
					</Btn>
				),
				menu: (
					<MenuRow
						title={t.alignLeft}
						active={state.alignLeft}
						onSelect={() => editor.chain().focus().setTextAlign('left').run()}
					>
						<AlignLeft size={ICON} />
					</MenuRow>
				),
			},
			// 居中对齐按钮
			{
				id: 'alignCenter',
				node: (
					<Btn
						title={t.alignCenter}
						active={state.alignCenter}
						onClick={() => editor.chain().focus().setTextAlign('center').run()}
					>
						{/* 居中对齐图标 */}
						<AlignCenter size={ICON} />
					</Btn>
				),
				menu: (
					<MenuRow
						title={t.alignCenter}
						active={state.alignCenter}
						onSelect={() => editor.chain().focus().setTextAlign('center').run()}
					>
						<AlignCenter size={ICON} />
					</MenuRow>
				),
			},
			// 右对齐按钮
			{
				id: 'alignRight',
				node: (
					<Btn
						title={t.alignRight}
						active={state.alignRight}
						onClick={() => editor.chain().focus().setTextAlign('right').run()}
					>
						{/* 右对齐图标 */}
						<AlignRight size={ICON} />
					</Btn>
				),
				menu: (
					<MenuRow
						title={t.alignRight}
						active={state.alignRight}
						onSelect={() => editor.chain().focus().setTextAlign('right').run()}
					>
						<AlignRight size={ICON} />
					</MenuRow>
				),
			},
			// 两端对齐按钮
			{
				id: 'alignJustify',
				node: (
					<Btn
						title={t.alignJustify}
						active={state.alignJustify}
						onClick={() => editor.chain().focus().setTextAlign('justify').run()}
					>
						{/* 两端对齐图标 */}
						<AlignJustify size={ICON} />
					</Btn>
				),
				menu: (
					<MenuRow
						title={t.alignJustify}
						active={state.alignJustify}
						onSelect={() =>
							editor.chain().focus().setTextAlign('justify').run()
						}
					>
						<AlignJustify size={ICON} />
					</MenuRow>
				),
			},
			// 链接按钮
			{
				id: 'link',
				node: (
					<Btn
						title={t.link}
						{/* 链接激活或链接表单打开时高亮 */}
						active={state.link || !!linkOpen}
						{/* 打开链接表单（不直接设链，由 LinkForm 处理） */}
						onClick={onOpenLink}
					>
						{/* 链接图标 */}
						<Link2 size={ICON} />
					</Btn>
				),
				menu: (
					<MenuRow
						title={t.link}
						active={state.link || !!linkOpen}
						onSelect={onOpenLink}
					>
						<Link2 size={ICON} />
					</MenuRow>
				),
			},
			// 取消链接按钮
			{
				id: 'unlink',
				node: (
					<Btn
						title={t.unlink}
						{/* 当前没有链接时禁用 */}
						disabled={!state.link}
						onClick={() => editor.chain().focus().unsetLink().run()}
					>
						{/* 取消链接图标 */}
						<Link2Off size={ICON} />
					</Btn>
				),
				menu: (
					<MenuRow
						title={t.unlink}
						disabled={!state.link}
						onSelect={() => editor.chain().focus().unsetLink().run()}
					>
						<Link2Off size={ICON} />
					</MenuRow>
				),
			},
			// 图片按钮
			{
				id: 'image',
				node: (
					<Btn
						title={t.imagePick}
						{/* 触发插入图片异步流程 */}
						onClick={() => void insertImage()}
					>
						{/* 图片图标 */}
						<ImageIcon size={ICON} />
					</Btn>
				),
				menu: (
					<MenuRow title={t.imagePick} onSelect={() => void insertImage()}>
						<ImageIcon size={ICON} />
					</MenuRow>
				),
			},
			// 表格按钮
			{
				id: 'table',
				node: (
					<Btn
						title={t.table}
						{/* 插入 3×3 表格，带表头行 */}
						onClick={() =>
							editor
								.chain()
								.focus()
								.insertTable({ rows: 3, cols: 3, withHeaderRow: true })
								.run()
						}
					>
						{/* 表格图标 */}
						<Table size={ICON} />
					</Btn>
				),
				menu: (
					<MenuRow
						title={t.table}
						onSelect={() =>
							editor
								.chain()
								.focus()
								.insertTable({ rows: 3, cols: 3, withHeaderRow: true })
								.run()
						}
					>
						<Table size={ICON} />
					</MenuRow>
				),
			},
		);

		// 条件渲染：仅在光标位于表格内时才追加表格操作按钮
		if (state.inTable) {
			items.push(
				// 在右侧加一列
				{
					id: 'addCol',
					node: (
						<Btn
							title={t.addColumnAfter}
							onClick={() => editor.chain().focus().addColumnAfter().run()}
					>
						{/* 文字按钮：「+列」 */}
						<span className="text-[10px] font-semibold">+列</span>
						</Btn>
					),
					menu: (
						<MenuRow
							title={t.addColumnAfter}
							onSelect={() => editor.chain().focus().addColumnAfter().run()}
						>
							<span className="text-[10px] font-semibold">+列</span>
						</MenuRow>
					),
				},
				// 在下方加一行
				{
					id: 'addRow',
					node: (
						<Btn
							title={t.addRowAfter}
							onClick={() => editor.chain().focus().addRowAfter().run()}
					>
						{/* 文字按钮：「+行」 */}
						<span className="text-[10px] font-semibold">+行</span>
						</Btn>
					),
					menu: (
						<MenuRow
							title={t.addRowAfter}
							onSelect={() => editor.chain().focus().addRowAfter().run()}
						>
							<span className="text-[10px] font-semibold">+行</span>
						</MenuRow>
					),
				},
				// 删除整个表格
				{
					id: 'delTable',
					node: (
						<Btn
							title={t.deleteTable}
							onClick={() => editor.chain().focus().deleteTable().run()}
					>
						{/* 文字按钮：「删表」 */}
						<span className="text-[10px] font-semibold">删表</span>
						</Btn>
					),
					menu: (
						<MenuRow
							title={t.deleteTable}
							onSelect={() => editor.chain().focus().deleteTable().run()}
						>
							<span className="text-[10px] font-semibold">删表</span>
						</MenuRow>
					),
				},
			);
		}

		// 返回最终工具项数组
		return items;
		// 说明：tools 随编辑状态重建；溢出宽度靠 measure 重算
		// eslint-disable-next-line react-hooks/exhaustive-deps -- 与 state / locale 字段对齐即可
	}, [editor, t, state, linkOpen, onOpenLink, onUploadImage]);

	// 工具栏根容器引用（用于测量可用宽度）
	const rootRef = useRef<HTMLDivElement>(null);
	// extra 容器引用（用于测量 extra 占用宽度）
	const extraRef = useRef<HTMLDivElement>(null);
	// 隐藏测量行引用（用于测量每个工具项真实宽度）
	const measureRef = useRef<HTMLDivElement>(null);
	// 可见工具项数量（初始为全部）
	const [visibleCount, setVisibleCount] = useState(tools.length);

	// 在绘制前同步计算溢出：决定显示几项、是否显示「更多」
	useLayoutEffect(() => {
		// 取根容器与测量行
		const root = rootRef.current;
		const measure = measureRef.current;
		// 任一不存在则跳过
		if (!root || !measure) return;

		// 重算函数：根据当前容器宽度计算 visibleCount
		const recalc = () => {
			// 读取根容器计算样式（用于取 padding 与 gap）
			const cs = getComputedStyle(root);
			// 左右内边距之和
			const padX =
				(parseFloat(cs.paddingLeft) || 0) + (parseFloat(cs.paddingRight) || 0);
			// 列间距（column-gap）
			const gap = parseFloat(cs.columnGap || cs.gap) || 0;
			// 内容可用宽度 = clientWidth - 左右内边距
			const contentW = root.clientWidth - padX;
			// extra 占用宽度（无 extra 则 0）
			const extraW = extraRef.current?.offsetWidth ?? 0;

			// 判断 [工具区宽度 + 可选 More 按钮] 再加 extra 是否放得进 contentW
			const fits = (toolsW: number, withMore: boolean) => {
				// 起始宽度：工具区 + More 按钮（若需要）
				const startW = toolsW + (withMore ? MORE_W : 0);
				let used = startW;
				// 有 extra 时加上 extra 宽度和一个 gap
				if (extraW > 0) used += extraW + gap;
				// 偏保守（留 0.5px），避免亚像素导致多塞一项被裁切
				return used <= contentW - 0.5;
			};

			// 测量行里的每个子元素对应一个工具项
			const nodes = [...measure.children] as HTMLElement[];
			// 没有工具项则可见数置 0
			if (nodes.length === 0) {
				setVisibleCount(0);
				return;
			}

			// 取每个工具项的真实宽度
			const widths = nodes.map((el) => el.getBoundingClientRect().width);
			// 全部工具项总宽度
			const total = widths.reduce((a, b) => a + b, 0);

			// 全放下：不显示 More
			if (fits(total, false)) {
				setVisibleCount(widths.length);
				return;
			}

			// 放不下：从头逐步累加，直到再加一项（含 More 宽度）放不下为止
			let used = 0;
			let count = 0;
			for (const w of widths) {
				// 判断「已用 + 当前项」再加上 More 是否还放得下
				if (!fits(used + w, true)) break;
				used += w;
				count += 1;
			}
			// 设置可见数量，超出部分收起到 More
			setVisibleCount(count);
		};

		// 首次立即计算一次
		recalc();
		// 用 ResizeObserver 监听容器与 extra 宽度变化，实时重算
		const ro = new ResizeObserver(recalc);
		ro.observe(root);
		if (extraRef.current) ro.observe(extraRef.current);
		// 卸载时断开观察
		return () => ro.disconnect();
	// 依赖 tools：工具项变化时重新测量
	}, [tools]);

	// 可见工具项 = 前 visibleCount 个
	const visible = tools.slice(0, visibleCount);
	// 溢出工具项 = 其余
	const overflow = tools.slice(visibleCount);
	// 是否显示「更多」按钮
	const showMore = overflow.length > 0;

	// 渲染工具栏
	return (
		// 根容器
		<div
			ref={rootRef}
			{/* 样式：工具栏基础类 + flex + 高度 40px + 两端对齐 + 底部边框 */}
			className={cn(
				'rich-editor-toolbar px-1.5 flex h-10 items-center justify-between border-b border-theme/10',
				className,
			)}
			{/* 无障碍角色：工具栏 */}
			role="toolbar"
			aria-label="格式工具栏"
		>
			{/* 隐形测量行：与真实按钮同构，用于算每项宽度（视觉隐藏，aria-hidden） */}
			<div ref={measureRef} className="rich-editor-toolbar-measure" aria-hidden>
				{/* 渲染所有工具项的 node 用于测量 */}
				{tools.map((item) => (
					<span key={item.id} className="inline-flex shrink-0">
						{item.node}
					</span>
				))}
			</div>

			{/* 左侧主区：可见按钮 + 更多菜单 */}
			<div className="rich-editor-toolbar-start">
				{/* 主按钮组 */}
				<div className="rich-editor-toolbar-main">
					{/* 只渲染可见的工具项 */}
					{visible.map((item) => (
						<span key={item.id} className="inline-flex shrink-0">
							{item.node}
						</span>
					))}
				</div>

				{/* 有溢出时渲染「更多」下拉菜单 */}
				{showMore ? (
					<span className="rich-editor-toolbar-more inline-flex shrink-0">
						<DropdownMenu>
							{/* 触发器：三个点按钮 */}
							<DropdownMenuTrigger asChild>
								<button
									type="button"
									title="更多"
									aria-label="更多"
									className="rich-editor-btn ml-0.5"
									{/* 阻止失焦 */}
									onMouseDown={(e) => e.preventDefault()}
								>
									{/* 更多图标 */}
									<MoreHorizontal size={ICON} />
								</button>
							</DropdownMenuTrigger>
							{/* 下拉内容 */}
							<DropdownMenuContent
								{/* 右对齐触发器 */}
								align="end"
								sideOffset={8}
								className="min-w-40"
								{/* 关闭时不收回焦点 */}
								onCloseAutoFocus={(e) => e.preventDefault()}
							>
								<DropdownMenuGroup>
									{/* 渲染溢出项的 menu 节点 */}
									{overflow.map((item) => (
										// 用 Fragment 包裹，key 放在 Fragment 上
										<Fragment key={item.id}>{item.menu}</Fragment>
									))}
								</DropdownMenuGroup>
							</DropdownMenuContent>
						</DropdownMenu>
					</span>
				) : null}
			</div>

			{/* 右侧 extra 扩展区（若有） */}
			{extra != null && (
				<div ref={extraRef} className="rich-editor-toolbar-extra shrink-0">
					<div className="rich-editor-toolbar-group">{extra}</div>
				</div>
			)}
		</div>
	);
}
```

---

## 15. 样式文件（styles.css）概览

**来源**：`apps/remote-plugins/src/components/design/RichEditor/styles.css`（根目录，未移动）

### 15.1 样式架构

编辑器样式遵循「BEM + CSS 变量」模式，主要类名（共 552 行）：

| 类名 | 说明 |
|------|------|
| `.rich-editor` | 外层容器（border/radius/background/color 已注释，由父级控制） |
| `.rich-editor-toolbar` | 工具栏容器（横向不换行、溢出隐藏、relative 定位） |
| `.rich-editor-toolbar-measure` | 隐藏测量层，离屏测量按钮实际宽度以判断溢出 |
| `.rich-editor-toolbar-start` | 工具栏起始区（flex:1，可被压缩） |
| `.rich-editor-toolbar-main` | 工具栏主按钮区（flex:0 1 auto，不抢剩余空间） |
| `.rich-editor-toolbar-more` | "更多"按钮容器（flex-shrink:0） |
| `.rich-editor-toolbar-extra` | 工具栏额外操作区（右侧固定） |
| `.rich-editor-toolbar-group` | 按钮分组（inline-flex） |
| `.rich-editor-toolbar-sep` | 分隔符（1px 竖线） |
| `.rich-editor-btn` | 工具栏按钮（28×28，opacity 0.75） |
| `.rich-editor-btn.is-active` | 激活状态的按钮 |
| `.rich-editor-body` | 编辑器主体区域（padding 0.75rem，滚动交由 ScrollArea） |
| `.rich-editor-footer` | 底部字数栏 |
| `.rich-editor-bubble` | 气泡菜单 |
| `.rich-editor-link-form` | 链接表单（flex-wrap 已注释） |
| `.rich-editor-link-action` | 链接表单按钮（含 ghost 变体） |
| `.rich-editor-lang` | 代码块语言选择器 |
| `.rich-editor-image` | 图片 |
| `.tiptap` | Tiptap 编辑器主体 |
| `.hljs-*` | highlight.js 语法高亮主题（VSCode Dark 风格，约 70 行） |

### 15.2 关键变化

相比早期版本，styles.css 有以下主要变更：

1. **`.rich-editor` 容器瘦身**：`border` / `border-radius` / `background` / `color` 四个属性全部注释掉，容器的视觉边框、背景改由父级布局（如分栏面板）统一控制，避免双重圆角/边框。

2. **工具栏溢出收纳体系**：新增 7 个 `.rich-editor-toolbar-*` 类，支撑「测量 → 分区 → 溢出收纳」的工具栏布局：
   - `toolbar-measure`：离屏隐藏测量层（`left:-9999px`），实时测量按钮实际宽度
   - `toolbar-start` / `toolbar-main` / `toolbar-more` / `toolbar-extra`：将工具栏拆为起始区、主按钮区、更多按钮、额外操作区；主区 `flex: 0 1 auto` 不抢空间，让 More 按钮紧跟最后一个可见按钮
   - `toolbar-group`：按钮分组
   - `toolbar-sep`：1px 竖向分隔符

3. **`.rich-editor-btn` 微调**：按钮尺寸统一为 `1.75rem × 1.75rem`（28px），默认 `opacity: 0.75`，hover/active 用 `color-mix(in oklab, ...)` 混入主题色。

4. **`.rich-editor-body` padding 调整**：padding 改为 `0.75rem`，并新增注释「滚动由 ScrollArea 接管，与左侧列表滚动条一致」。

5. **段落/标题/列表 margin 大量注释**：`p`、`h2`-`h5`、`ul/ol`、`blockquote`、`taskList label` 的 `margin` 被注释掉，改用 `line-height` 控制节奏，让正文更紧凑。

6. **`.rich-editor-note-title*` 整块注释**：note-title 相关的三个类（`note-title` / `note-title-label` / `note-title-content`）样式全部注释掉，标题视觉改由 NotePreview 顶栏承担。

7. **新增 hljs 语法高亮主题**：文件末尾新增约 70 行 `.hljs-*` 规则，采用 VSCode Dark 风格配色（注释绿 `#6a9955`、关键字紫 `#c586c0`、字符串橙 `#ce9178`、数字浅绿 `#b5cea8`、函数黄 `#dcdcaa`、类名青 `#4ec9b0` 等），配合 lowlight 实现代码块着色。

8. **链接表单部分注释**：`.rich-editor-link-form` 的 `flex-wrap: wrap` 被注释，改为单行布局。

9. **选区高亮样式新增**：新增 `.rich-editor-body .tiptap ::selection` 规则，用 `color-mix(in oklab, var(--theme-color, ...) 42%, transparent)` 计算主题色 42% 透明作为选区背景色，支持 `--theme-selection-bg` / `--theme-selection-fg` CSS 变量覆盖，让全选/文本选中的视觉与应用主题一致。

### 15.3 保留的样式要点

1. **编辑器 min-height**：`.rich-editor-body .tiptap` 设置 `min-height: 8rem`，保证内容很少时也可点击
2. **ProseMirror 内容样式**：h1-h6、p、ul、ol、blockquote、code、pre、table、img、hr、mark 等的默认样式
3. **表格样式**：边框、表头背景、`.selectedCell` 选中态、`.column-resize-handle` 调列宽手柄
4. **任务列表样式**：`ul[data-type="taskList"]` 去掉 list-style，li 用 flex 横向布局
5. **占位符样式**：`.is-editor-empty:first-child::before` / `.is-empty::before` 通过 `attr(data-placeholder)` 显示提示文字
6. **代码块 hljs 主题**：配合 lowlight 使用的语法高亮主题（见 15.2 第 7 点）

---

## 16. 整体运行时调用链

### 16.1 用户输入文字的完整流程

```
用户在编辑器输入文字
    ↓
ProseMirror 捕获 input 事件
    ↓
创建 Transaction（事务）
    ↓
经过所有 Plugin 的 appendTransaction
    ├→ TitleNode 插件：检查是否有多余 title、是否缺正文、是否 GapCursor
    ├→ CharacterCount 插件：更新字数统计
    └→ 其他插件...
    ↓
应用到 EditorState
    ↓
触发 onUpdate 回调
    ↓
RichEditor 的 onChange 被调用
    ├→ 传出 html / json / text / title
    └→ 父组件更新 state（如果是受控模式）
```

### 16.2 用户点击工具栏按钮的完整流程

```
用户点击「粗体」按钮
    ↓
onMouseDown 触发 e.preventDefault()（防止编辑器失焦）
    ↓
onClick 触发
    ↓
editor.chain().focus().toggleBold().run()
    ├→ focus()：确保编辑器获得焦点
    ├→ toggleBold()：切换粗体 mark
    └→ run()：执行命令链
    ↓
创建 Transaction，更新 EditorState
    ↓
触发 onUpdate
    ↓
UI 更新（按钮的 active 态、内容样式）
```

### 16.3 粘贴图片的完整流程

```
用户 Ctrl+V 粘贴一张图片
    ↓
ProseMirror 捕获 paste 事件
    ↓
ImageUpload 插件的 handlePaste 被调用
    ├→ clipboardImageFiles() 提取剪贴板中的图片文件
    ├→ 没有图片 → return false（走默认粘贴）
    └→ 有图片 → e.preventDefault() + insertImages()
        ↓
    insertImages() 遍历文件
        ├→ resolveSrcRef.current(file) 解析 src
        │   └→ 有 onUploadImage → 上传到 CDN
        │   └→ 没有 → fileToDataUrl 转 base64
        └→ editor.chain().focus().setImage({ src, alt }).run()
            ↓
    插入图片节点到文档
            ↓
    触发 onUpdate
```

---

## 17. 文件结构总览（当前最新）

### 17.1 design 组件总目录

```
design/
├── index.ts               # 统一导出入口（RichEditor + NotePreview）
├── RichEditor/            # 富文本编辑器主组件
│   ├── index.tsx          # 主组件（入口）
│   ├── types.ts           # 类型定义
│   ├── locale.ts          # 国际化字典
│   ├── styles.css         # 样式文件
│   ├── code/              # 代码块相关
│   │   ├── index.ts       # 导出
│   │   └── languages.ts   # 代码语言列表
│   ├── extensions/        # 扩展配置
│   │   └── index.ts       # createExtensions + TabIndent + CustomDocument
│   ├── image/             # 图片相关
│   │   ├── index.ts       # 导出
│   │   ├── image.ts       # 图片工具函数
│   │   └── ImageUpload.ts # 图片上传扩展（粘贴/拖放）
│   ├── link/              # 链接相关
│   │   ├── index.ts       # 导出
│   │   ├── linkRange.ts   # 链接范围解析
│   │   └── LinkForm.tsx   # 链接表单 + useLinkEditor Hook
│   ├── title/             # 标题节点相关
│   │   ├── index.ts       # 导出
│   │   ├── Title.tsx      # 标题节点视图（React 组件）
│   │   └── TitleNode.ts   # TitleNode 自定义节点 + 工具函数
│   └── toolbar/           # 工具栏相关
│       ├── index.ts       # 导出
│       ├── Toolbar.tsx    # 工具栏主组件
│       └── FormatBubble.tsx # 选区气泡菜单
└── NotePreview/           # 笔记预览组件
    ├── index.tsx          # NotePreview + stripNoteTitleHtml
    └── styles.css         # 预览态样式（透明背景、padding、文本选中）
```

### 17.2 设计原则：按功能域分目录

重构后遵循「按功能域分目录」的原则：

- **每个功能域一个目录**：title、image、link、toolbar、code、extensions
- **目录内有 index.ts**：作为该模块的统一出口
- **主组件只从子目录导入**：`import { createExtensions } from './extensions'`
- **外部使用从 design/index.ts 导入**：`import { RichEditor, NotePreview } from '@/components/design'`

**重构前后对比**：

| 重构前（扁平） | 重构后（分域） |
|----------------|----------------|
| `createNode.ts` | `title/TitleNode.ts` |
| `Title.tsx` | `title/Title.tsx` |
| `image.ts` | `image/image.ts` |
| `ImageUpload.ts` | `image/ImageUpload.ts` |
| `linkRange.ts` | `link/linkRange.ts` |
| `LinkForm.tsx` | `link/LinkForm.tsx` |
| `Toolbar.tsx` | `toolbar/Toolbar.tsx` |
| `FormatBubble.tsx` | `toolbar/FormatBubble.tsx` |
| `languages.ts` | `code/languages.ts` |
| `extensions.ts` | `extensions/index.ts` |

---

## 18. 笔记预览组件 NotePreview

**来源**：`apps/remote-plugins/src/components/design/NotePreview/index.tsx`（共 109 行）+ `styles.css`（共 24 行）

### 18.1 模块职责

笔记的**只读预览**组件，用于：
- 笔记列表中点击某条笔记后，在右侧查看详情
- 顶栏显示标题（替代编辑器 toolbar）
- 正文用 **RichEditor 只读模式**渲染，与编辑效果完全一致（代码高亮、表格、图片等都能正确显示）
- 自动剥离 HTML 中的 title 节点，避免与顶栏标题重复
- 支持 `headerExtra`、`footer`、`meta`、`children` 等扩展插槽

### 18.2 核心设计

**为什么需要 NotePreview？**
1. **编辑器 vs 预览分离**：编辑时是 RichEditor（可编辑，有工具栏），查看时是 NotePreview（只读，轻量）
2. **标题不重复**：编辑器里 title 是文档的第一个节点，预览时标题在顶栏，所以要从 HTML 里剥离 title 节点
3. **可扩展**：headerExtra / footer / meta / children 四个扩展位，适配不同场景

**为什么用 RichEditor 只读模式而不是 dangerouslySetInnerHTML？**
1. **渲染一致性**：代码块高亮、表格、任务列表、图片缩放等自定义节点的样式和行为在预览中完全一致
2. **NodeView 渲染**：TipTap 的 NodeView（如代码块高亮）无法通过纯 HTML 复现，必须走 ProseMirror 渲染
3. **样式复用**：直接复用 RichEditor 的样式体系，不需要单独维护预览样式
4. **showTitle={false}**：预览时不需要标题节点（标题在顶栏），通过 `showTitle={false}` 在 schema 层面禁用 title 节点

**安全考虑**：
- 内容来自本机 TipTap 产出，经过 `stripNoteTitleHtml` 预处理（剥离 title 节点）
- 如果是外部用户输入的 HTML，应先做 XSS 清洗

### 18.3 完整代码与逐行注释

```typescript
// 导入 ReactNode 类型（React 节点，用于插槽/children）
import type { ReactNode } from 'react';
// 导入 classnames 工具（合并类名）
import { cn } from '@/lib/utils';
// 导入 RichEditor 组件（预览用只读模式渲染，保证渲染一致性）
import RichEditor from '../RichEditor';
// 导入 RichEditor 的样式（预览也复用编辑器的内容样式）
import '../RichEditor/styles.css';
// 导入 NotePreview 专属样式（预览态的样式微调）
import './styles.css';

// NotePreview 组件的 Props 类型
export type NotePreviewProps = {
	// 顶栏标题（替代编辑器 toolbar）
	title: string;
	// TipTap HTML 或 JSON 内容
	html?: string;
	// 顶栏标题旁/下方的次要信息（时间、标签等）
	meta?: ReactNode;
	// 顶栏右侧操作（返回编辑、列表开关等）
	headerExtra?: ReactNode;
	// 自定义正文；传入时忽略 html
	children?: ReactNode;
	// 底部插槽
	footer?: ReactNode;
	// 外层容器类名
	className?: string;
	// 正文区域类名
	bodyClassName?: string;
	// 空内容时的提示文本
	emptyText?: string;
};

// 去掉文档内嵌的 title NodeView，正文只渲染 block 内容（兼容旧 API）
// 为什么要剥离？因为预览时标题在顶栏显示，正文里再显示一遍就重复了
export function stripNoteTitleHtml(html: string): string {
	// 空 HTML 直接返回空串
	if (!html) return '';
	// 兜底：DOMParser 不可用时（比如 SSR），用正则替换
	if (typeof DOMParser === 'undefined') {
		return html.replace(
			// 匹配 <div data-type="note-title">...</div>
			/<div[^>]*data-type=["']note-title["'][^>]*>[\s\S]*?<\/div>/i,
			// 替换成空串
			'',
		);
	}
	// 用 DOMParser 解析 HTML（更可靠，不会误伤嵌套结构）
	const doc = new DOMParser().parseFromString(html, 'text/html');
	// 查找所有带 data-type="note-title" 的元素
	for (const el of doc.querySelectorAll('[data-type="note-title"]')) {
		// 移除该元素
		el.remove();
	}
	// 返回 body 的 innerHTML
	return doc.body.innerHTML;
}

/**
 * 笔记只读预览：顶栏标题 + 可滚动正文。
 * - 使用 RichEditor 只读模式渲染，与编辑效果完全一致
 * - schema 层面禁用 title 节点，并用 stripNoteTitleHtml 预处理内容
 * - children / headerExtra / footer / meta 可扩展
 */
export function NotePreview({
	// 解构 props
	title,
	// TipTap HTML 内容
	html,
	// 顶栏次要信息
	meta,
	// 顶栏右侧操作
	headerExtra,
	// 自定义正文
	children,
	// 底部插槽
	footer,
	// 外层容器类名
	className,
	// 正文区域类名
	bodyClassName,
	// 空内容默认提示
	emptyText = '暂无内容',
}: NotePreviewProps) {
	// 处理后的正文 HTML（已剥离 title 节点）
	const bodyHtml = html ? stripNoteTitleHtml(html) : '';

	return (
		{/* 外层容器：flex 列布局，占满高度，隐藏溢出，右侧圆角贴合左邻面板 */}
		<div
			className={cn(
				'note-preview flex h-full min-h-0 min-w-0 flex-col overflow-hidden rounded-r-md',
				className,
			)}
		>
			{/* 顶栏：固定高度 40px，底部边框，flex 横向布局 */}
			<header className="note-preview-header h-10 border-theme/10 flex shrink-0 items-center gap-3 border-b pl-3 pr-1.5 py-2.5">
				{/* 左侧：标题 + meta，flex-1 占满剩余空间 */}
				<div className="min-w-0 flex-1">
					{/* 标题：截断显示，字体稍大，加粗 */}
					<h1 className="text-textcolor truncate text-base font-semibold leading-snug">
						{title.trim() || '无标题笔记'}
					</h1>
					{/* 有 meta 时显示：次要文字，小字号 */}
					{meta ? (
						<div className="text-textcolor/45 mt-0.5 truncate text-xs">
							{meta}
						</div>
					) : null}
				</div>
				{/* 右侧操作区：headerExtra 插槽 */}
				{headerExtra ? (
					<div className="flex shrink-0 items-center gap-0.5">
						{headerExtra}
					</div>
				) : null}
			</header>

			{/* 正文区域：占满剩余空间 */}
			<div className="note-preview-body min-h-0 flex-1">
				{/* 有 children 时优先渲染 children（自定义内容） */}
				{children != null ? (
					children
				{/* 有正文 HTML 时用 RichEditor 只读模式渲染 */}
				) : bodyHtml ? (
					{/* RichEditor 只读模式：与编辑效果完全一致 */}
					<RichEditor
						{/* 内容为剥离 title 后的 HTML */}
						content={bodyHtml}
						{/* 只读模式 */}
						editable={false}
						{/* 不自动聚焦 */}
						autofocus={false}
						{/* 不显示工具栏 */}
						showToolbar={false}
						{/* 不显示气泡菜单 */}
						showBubbleMenu={false}
						{/* 不显示字数统计 */}
						showCharCount={false}
						{/* 不显示标题节点（标题在顶栏） */}
						showTitle={false}
						{/* 容器类名 */}
						className={cn('note-preview-editor', bodyClassName)}
						{/* 编辑器正文类名 */}
						editorClassName="note-preview-tiptap"
					/>
				{/* 空内容显示提示 */}
				) : (
					<p className="text-textcolor/45 p-3 text-sm">{emptyText}</p>
				)}
			</div>

			{/* 底部插槽：有 footer 时显示 */}
			{footer ? <div className="shrink-0">{footer}</div> : null}
		</div>
	);
}

// 默认导出
export default NotePreview;
```

### 18.4 预览样式文件（styles.css）

**来源**：`apps/remote-plugins/src/components/design/NotePreview/styles.css`（共 24 行）

```css
/* 预览编辑器外层：透明背景（不需要编辑器的白色底） */
.note-preview-editor {
	background: transparent;
}

/* 预览正文区域：复用 rich-editor-body 但调整 padding 和对齐 */
.note-preview-editor .rich-editor-body {
	/* 内边距：上窄下宽，适配预览场景 */
	padding: 0.75rem;
	/* 顶部收紧，避免与 header 间距过大 */
	padding-top: 0.28rem;
	/* 两端对齐，阅读体验更好 */
	text-align: justify;
}

/* 预览 TipTap 区域：只读光标 + 文本可选中 */
.note-preview-tiptap {
	/* 只读光标（不显示文本插入光标） */
	cursor: default;
	/* 允许用户选中文本（Safari 需要 -webkit 前缀） */
	-webkit-user-select: text;
	user-select: text;
}

/* 兜底：隐藏残留的 title NodeView（schema 层面已禁用，这里再保险一层） */
.note-preview-editor .rich-editor-note-title,
.note-preview-editor [data-node-view-wrapper].rich-editor-note-title {
	/* 强制隐藏，防止 title 节点渲染出来 */
	display: none !important;
}

/* 预览正文首个子节点：去掉顶部 margin，避免与 header 间距过大 */
.note-preview-editor .ProseMirror > *:first-child {
	margin-top: 0;
}
```

---

## 19. 主应用分栏布局（LearningNotesApp）

**来源**：`apps/remote-plugins/src/views/learning-notes/index.tsx`（约 430 行）

### 19.1 模块职责

学习笔记插件的主应用组件，是整个插件运行时的入口视图，负责：
- **分栏布局**：左侧笔记列表（35%）+ 右侧编辑器/预览（65%），可拖拽调整
- **MobX 状态管理**：通过 `learningNotesStore` 集中管理所有业务状态（列表、预览、编辑、加载态等），组件用 `observer` 包裹响应式更新
- **分页加载**：滚动到底部时自动触发 `loadMore()`，支持无限滚动，列表头部显示「已加载 N 条/共 M 条」
- **CRUD 流程编排**：通过 store 封装数据层，串联 list / detail / save / update / remove / loadMore
- **编辑器生命周期管理**：用 `key={store.editorSeed}` 在新建/编辑切换时强制重建 RichEditor
- **预览/编辑切换**：点击列表项进入预览，编辑按钮回到编辑态；预览时编辑器用 `hidden` 保留挂载
- **删除确认**：用 `Confirm` 组件二次确认，避免误删
- **toast 通知**：通过 `api.ui?.showToast` 反馈操作结果
- **独立运行支持**：`independent` 为真时不显示列表

### 19.2 核心设计

**布局大改（与旧版对比）**：

旧版布局为「编辑器在左、列表在右」，新版调整为「列表在左、编辑器/预览在右」，更符合常见笔记应用的阅读习惯——左侧导航、右侧工作区。

```
┌─────────────────────────────────────────────┐
│  [Confirm 删除确认弹层（全局）]              │
├───────────────┬─────────────────────────────┤
│  笔记列表 35% │  编辑器 / 预览 65%          │
│  ┌──────────────┐ │  ┌────────────────────┐ │
│  │ 标题+加载统计│ │  │ toolbarExtra:      │ │
│  │ 已加载 N/共 M│ │  │  [新建][保存][列表] │ │
│  ├──────────────┤ │  ├────────────────────┤ │
│  │ 列表项        │ │  │  RichEditor        │ │
│  │ hover→       │ │  │  或 NotePreview    │ │
│  │ [编][删]     │ │  └────────────────────┘ │
│  ├──────────────┤ │                           │
│  │ 加载中/没有更多│ │                           │
│  └──────────────┘ │                           │
└───────────────┴─────────────────────────────┘
```

**MobX 状态管理重构**：

原实现用十多个 `useState` 分散管理状态（draft、listOpen、preview、notes、editingId、editorSeed、editorInitial、loading、saving、confirmOpen、pendingDeleteId），组件内充斥着 setState 调用，数据流不清晰。重构后全部收敛到 `learningNotesStore` 中，组件用 `observer` 包裹实现响应式更新：

| 状态分类 | store 中的状态 | 说明 |
|---------|--------------|------|
| 列表相关 | `list`、`total`、`loading`、`loadingMore`、`hasMore` | 分页列表数据与加载态 |
| 视图切换 | `listOpen`、`preview`、`loadingDetail` | 列表开关、预览数据、详情加载态 |
| 编辑相关 | `editingId`、`editorSeed`、`editorInitial`、`saving` | 编辑态标识、编辑器重建种子、保存态 |
| 交互确认 | `confirmOpen`、`pendingDeleteId` | 删除确认弹层与待删 id |
| 衍生状态 | `hasActive` | 是否有活跃的预览或编辑项 |

组件层只保留 UI 相关的本地状态：滚动位置（`scrollMode`、`scrollEdge`）、编辑器 ref（`editorRef`）、用于快捷键判断的 ref（`savingRef`、`previewRef`）。业务逻辑全部下沉到 store，组件只负责「从 store 取状态 + 调 store 方法 + 渲染」。

**store 绑定与初始化**：

通过 `store.bind(api.http, toast)` 把宿主 HTTP 客户端和 toast 函数注入 store，store 内部封装所有 CRUD 与分页逻辑。组件 mount 时调用 `void store.refreshList()` 拉取第一页数据。`bind` 方法的存在让 store 可以是单例（在 `useStore` 中创建），同时又能在组件挂载时动态绑定宿主能力——因为宿主能力是通过 props 传入的，store 创建时拿不到。

**分页加载（无限滚动）**：

列表从「一次性加载全部」改为分页加载，每页 `NOTES_PAGE_SIZE` 条：

1. **初始加载**：`refreshList()` 拉取第 1 页，重置 `list`、`total`、`hasMore`
2. **滚动触发**：`handleScroll` 中检测滚动到底部前 3 倍 `SCROLL_EDGE_PX` 时，调用 `void store.loadMore()`
3. **加载更多**：`loadMore()` 根据当前已加载数量计算下一页 page，追加到 `list`，更新 `hasMore`
4. **底部提示**：列表底部显示三种状态——`loadingMore` 时「加载中…」、已加载完时「没有更多了」、其他情况不显示
5. **头部统计**：列表标题右侧显示「已加载 N 条/共 M 条」，让用户知道整体规模

**防重复加载**：`loadMore` 内部通过 `loadingMore` 和 `hasMore` 双重判断，避免滚动抖动时重复发请求。

**CRUD 流程**：

| 操作 | 入口 | 调用 | 副作用 |
|------|------|------|--------|
| 拉列表 | mount / 增删改后 | `store.refreshList()` | 重置分页 + 写入 `list` / `total` |
| 加载更多 | 滚动到底部 | `store.loadMore()` | 追加 `list` + 更新 `hasMore` |
| 预览 | 点击列表项 | `store.openPreview(id)` | 写入 `preview` / `loadingDetail` |
| 新建 | 工具栏「新建」 | `store.openNew()` | 重置编辑态 + `editorSeed++` |
| 编辑 | 列表 hover「编辑」 | `store.openEditById(id)` | 拉详情 + 写入编辑态 + 重建编辑器 |
| 保存 | 工具栏「保存」 | `store.saveNote(payload)` | 保存 + 刷新列表 + toast |
| 删除请求 | 列表/预览「删除」 | `store.requestDelete(id)` | 打开确认弹层 |
| 删除确认 | Confirm 确认 | `store.confirmDelete()` | 执行删除 + 清理 + 刷新列表 |

**保存函数 useCallback 化**：

`onSave` 用 `useCallback` 包裹，依赖数组为 `[store]`。它从 `editorRef.current` 实时读取编辑器内容（title、text、html），然后调用 `store.saveNote()`。这样做有两个原因：一是 `onSave` 需要作为 `useEffect` 的依赖（快捷键监听），稳定的引用可以避免每次渲染都重新绑定/解绑键盘事件；二是避免子组件（如 `toolbarExtra` 中保存按钮）因 `onSave` 引用变化而产生不必要的重渲染。

**编辑器 ref 化（从 onChange 到 onCreate）**：

旧版通过 `onChange` 回调把编辑器内容实时同步到 `draft` state，再在保存时从 state 读。新版改为持有 `editorRef`，只在保存时从 `editorRef.current` 读取最新内容。好处：① 减少每一次编辑都触发 React 重渲染的开销；② 状态来源唯一（编辑器实例就是真值），避免 state 与编辑器不同步的问题；③ 组件代码更简洁，不需要维护 draft 状态。`onCreate` 回调在编辑器实例创建时把引用存到 `editorRef`。

**ref 同步 store 状态（快捷键判断用）**：

快捷键监听的 `useEffect` 依赖 `onSave`，但 `onSave` 是稳定引用（依赖 store），effect 不会因 `saving` / `preview` 变化而重新绑定。为了让键盘事件处理器能拿到最新的 `saving` 和 `preview` 值，用 `savingRef` 和 `previewRef` 两个 ref 同步 store 状态——每次渲染时都把 `store.saving` 和 `store.preview` 写入 ref，事件处理器从 ref 读取，避免闭包陈旧值问题。

**Cmd/Ctrl+S 快捷键保存**：

通过 `useEffect` 在 `window` 上全局监听 `keydown` 事件，当检测到 `metaKey`（macOS 的 ⌘）或 `ctrlKey`（Windows/Linux 的 Ctrl）+ `s` 时触发保存。有三重保护：① 预览态（`previewRef.current` 存在）直接忽略，因为预览没有草稿可保存；② 调用 `e.preventDefault()` 阻止浏览器默认的「保存页面」弹窗；③ `savingRef.current` 为 true 时不重复触发，避免并发保存请求。保存按钮的 tooltip 也同步加上 `⌘S` 提示，让用户知晓快捷键的存在。

**编辑器重建机制**：

`RichEditor` 是受 `key` 控制的非受控组件——一旦挂载，`defaultContent` 的变更不会生效。因此在「新建」和「编辑」时都通过 store 内部递增 `editorSeed`，配合 `key={store.editorSeed}` 强制 React 卸载旧实例、挂载新实例，从而把新的 `editorInitial`（空文档或笔记 HTML）注入编辑器。

**Confirm 删除确认**：

删除不再直接执行，而是先调用 `store.requestDelete(id)` 把 id 存到 store 并打开 `Confirm`，用户确认后调 `store.confirmDelete()` 真正执行删除。删除后 store 内部会判断当前预览/编辑是否正是被删笔记，是则同步清空，避免界面残留。

### 19.3 完整代码与逐行注释

```typescript
// 引入 Loading 加载动画组件，用于列表和详情加载态
import Loading from '@design/Loading';
// 从 design 统一出口引入 NotePreview 预览组件
import { NotePreview } from '@design/NotePreview';
// 从 design 统一出口引入 RichEditor、Btn 按钮、getDocTitleText 工具、Editor 类型
import {
	Btn,
	type Editor,
	getDocTitleText,
	RichEditor,
} from '@design/RichEditor';
// 引入 lucide 图标：ChevronDown/ChevronUp 上下箭头、FilePenLine 新建、LocateFixed 定位、NotebookText 列表、Save 保存、SquarePen 编辑、Trash2 删除
import {
	ChevronDown,
	ChevronUp,
	FilePenLine,
	LocateFixed,
	NotebookText,
	Save,
	SquarePen,
	Trash2,
} from 'lucide-react';
// 引入 mobx-react 的 observer，让组件成为响应式观察者
import { observer } from 'mobx-react';
// 引入 React hooks：useCallback 回调缓存、useEffect 副作用、useMemo 计算缓存、useRef 引用、useState 状态
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
// 引入二次确认弹层组件，用于删除前确认
import Confirm from '@/components/design/Confirm';
// 引入 react-resizable-panels 的分栏组件
import {
	ResizableHandle,
	ResizablePanel,
	ResizablePanelGroup,
} from '@/components/ui/resizable';
// 引入滚动区域组件
import { ScrollArea } from '@/components/ui/scroll-area';
// 引入 cn 类名合并工具
import { cn } from '@/lib/utils';
// 引入全局 store hook，获取学习笔记 store
import useStore from '@/store';
// 从同目录 api.ts 引入 HostHttp 类型
import type { HostHttp } from './api';
// 引入插件样式
import '@/styles.css';

// 滚动边缘判定像素值：距离顶部/底部多少像素内视为「到达边缘」
const SCROLL_EDGE_PX = 16;

/** 笔记列表滚动：同一按钮循环 底 → 顶 → 当前（无选中时底 → 顶） */
type NoteScrollMode = 'bottom' | 'top' | 'current';

// 主应用接收的 HostBridge 属性类型
type HostBridgeProps = {
	// host 注入的能力：主题、HTTP、UI（toast）
	api: {
		theme: 'light' | 'dark'; // 当前主题
		http?: HostHttp; // 可选的 HTTP 客户端，未授权时为 undefined
		ui?: {
			// 可选的 UI 能力，目前只有 toast
			showToast: (options: {
				message: string; // 提示文案
				type?: 'success' | 'error' | 'info'; // 提示类型
			}) => void;
		};
	};
	// 插件元信息
	plugin: { id: string; version: string; routePath: string };
	// 是否独立运行，独立运行时不显示笔记列表
	independent?: boolean;
};

// 主应用组件函数（内部实现），最后用 observer 包裹后导出
function LearningNotesApp({ api }: HostBridgeProps) {
	// 从全局 store 中获取学习笔记 store 实例
	const { learningNotesStore: store } = useStore();

	// 编辑器实例引用：通过 onCreate 回调获取，保存时从中读取内容
	const editorRef = useRef<Editor | null>(null);
	// 保存中状态的 ref 副本：用于快捷键事件处理器读取最新值，避免闭包陈旧值
	const savingRef = useRef(false);
	// 预览状态的 ref 副本：用于快捷键事件处理器判断是否处于预览态
	const previewRef = useRef(store.preview);
	// 每次渲染都同步 savingRef 为最新的 store.saving 值
	savingRef.current = store.saving;
	// 每次渲染都同步 previewRef 为最新的 store.preview 值
	previewRef.current = store.preview;

	// ScrollArea viewport：程序化滚到顶/底（纯 UI，不进 store）
	const scrollViewportRef = useRef<HTMLDivElement>(null);
	// 当前选中的列表项元素引用：用于滚动到当前选中项
	const activeItemRef = useRef<HTMLDivElement>(null);
	// 滚动模式状态：底 → 顶 → 当前（循环）
	const [scrollMode, setScrollMode] = useState<NoteScrollMode>('bottom');
	// 滚动边缘状态：到达顶部/底部时记录，用于滚动按钮图标切换
	const [scrollEdge, setScrollEdge] = useState<'top' | 'bottom' | null>(null);

	// toast 封装：统一走 api.ui?.showToast，依赖 api.ui
	const toast = useCallback(
		(message: string, type: 'success' | 'error' | 'info' = 'info') => {
			api.ui?.showToast({ message, type });
		},
		[api.ui],
	);

	// 组件挂载时：绑定宿主能力到 store，并刷新列表（拉第一页）
	useEffect(() => {
		// 把 HTTP 客户端和 toast 函数注入 store
		store.bind(api.http, toast);
		// 拉取第一页列表数据
		void store.refreshList();
	}, [api.http, store, toast]);

	// 滚动事件处理：检测滚动边缘 + 触底加载更多
	const handleScroll = useCallback(() => {
		// 获取滚动容器元素
		const el = scrollViewportRef.current;
		// 容器不存在则直接返回
		if (!el) return;
		// 解构滚动位置、总高度、可视高度
		const { scrollTop, scrollHeight, clientHeight } = el;
		// 到达顶部边缘（SCROLL_EDGE_PX 以内）
		if (scrollTop <= SCROLL_EDGE_PX) {
			setScrollEdge('top');
		// 到达底部边缘（SCROLL_EDGE_PX 以内）
		} else if (scrollTop + clientHeight >= scrollHeight - SCROLL_EDGE_PX) {
			setScrollEdge('bottom');
		// 中间区域
		} else {
			setScrollEdge(null);
		}
		// 距离底部还有 3 倍边缘距离时，提前触发加载更多
		if (scrollTop + clientHeight >= scrollHeight - SCROLL_EDGE_PX * 3) {
			void store.loadMore();
		}
	}, [store]);

	// 列表展开时绑定滚动监听，并初始化滚动位置
	useEffect(() => {
		// 列表关闭时不处理
		if (!store.listOpen) return;
		// 重置滚动模式为底部
		setScrollMode('bottom');
		// 获取滚动容器
		const el = scrollViewportRef.current;
		// 容器不存在则返回
		if (!el) return;
		// 绑定滚动事件监听
		el.addEventListener('scroll', handleScroll);
		// 立即执行一次，初始化 scrollEdge 状态
		handleScroll();
		// 卸载时移除监听，防止内存泄漏
		return () => el.removeEventListener('scroll', handleScroll);
	}, [store.listOpen, handleScroll]);

	// 没有活跃项但 scrollMode 是 current 时，回退到 bottom
	useEffect(() => {
		// 没有活跃的预览或编辑项，且当前滚动模式是「滚动到当前」
		if (!store.hasActive && scrollMode === 'current') {
			// 回退到底部模式
			setScrollMode('bottom');
		}
	}, [store.hasActive, scrollMode]);

	// 滚动浮动按钮点击：在 底 → 顶 → 当前 之间循环切换
	const onScrollFabClick = useCallback(() => {
		// 获取滚动视口元素
		const vp = scrollViewportRef.current;
		// 元素不存在则返回
		if (!vp) return;

		// 解构滚动位置、总高度、可视高度
		const { scrollTop, scrollHeight, clientHeight } = vp;
		// 是否在顶部
		const atTop = scrollTop <= SCROLL_EDGE_PX;
		// 是否在底部
		const atBottom = scrollTop + clientHeight >= scrollHeight - SCROLL_EDGE_PX;
		// 当前滚动模式
		let mode = scrollMode;
		// 底部模式且已在底部 → 切到顶部模式
		if (mode === 'bottom' && atBottom) {
			mode = 'top';
		// 顶部模式且已在顶部 → 切到底部模式
		} else if (mode === 'top' && atTop) {
			mode = 'bottom';
		}

		// 底部模式：滚到底部
		if (mode === 'bottom') {
			vp.scrollTo({ top: vp.scrollHeight, behavior: 'auto' });
		// 顶部模式：滚到顶部
		} else if (mode === 'top') {
			vp.scrollTo({ top: 0, behavior: 'auto' });
		// 当前模式：滚动到当前选中项
		} else {
			activeItemRef.current?.scrollIntoView({
				block: 'center',
				behavior: 'auto',
			});
		}

		// 更新下一次的滚动模式：底部 → 顶部
		if (mode === 'bottom') {
			setScrollMode('top');
		// 顶部 → 当前（有活跃项）或底部（无活跃项）
		} else if (mode === 'top') {
			setScrollMode(store.hasActive ? 'current' : 'bottom');
		// 当前 → 底部
		} else {
			setScrollMode('bottom');
		}
	}, [scrollMode, store.hasActive]);

	// 计算实际显示的滚动模式（考虑当前已在边缘的情况，图标显示下一个目标）
	const displayMode: NoteScrollMode =
		// 底部模式且已在底部 → 显示顶部（下一步要去顶部）
		scrollMode === 'bottom' && scrollEdge === 'bottom'
			? 'top'
			: // 顶部模式且已在顶部 → 显示底部（下一步要去底部）
			scrollMode === 'top' && scrollEdge === 'top'
				? 'bottom'
				: // 其他情况显示当前模式
				scrollMode;

	// 滚动按钮的 tooltip 文案
	const scrollTitle =
		displayMode === 'bottom'
			? '滚动到底部'
			: displayMode === 'top'
				? '滚动到顶部'
				: '滚动到当前选中';

	// 保存笔记：从 editorRef 读取内容，调用 store.saveNote
	const onSave = useCallback(async () => {
		// 获取编辑器实例
		const editor = editorRef.current;
		// 编辑器不存在或已销毁则返回
		if (!editor || editor.isDestroyed) return;
		// 调用 store 的保存方法，传入标题、纯文本、HTML
		await store.saveNote({
			title: getDocTitleText(editor.state.doc).trim(),
			text: editor.getText({ blockSeparator: '\n\n' }).trim(),
			html: editor.getHTML(),
		});
	}, [store]);

	// Cmd/Ctrl+S 快捷键保存：监听全局键盘事件，编辑态下触发保存
	useEffect(() => {
		// 键盘按下事件处理函数
		const onKeyDown = (e: KeyboardEvent) => {
			// 不是 metaKey(Command) 也不是 ctrlKey，或者按键不是 s，则直接返回
			if (!(e.metaKey || e.ctrlKey) || e.key.toLowerCase() !== 's') return;
			// 预览态不处理快捷键（预览时没有草稿可保存）——从 ref 读最新值
			if (previewRef.current) return;
			// 阻止浏览器默认的保存页面行为
			e.preventDefault();
			// 正在保存中则不重复触发，避免并发请求——从 ref 读最新值
			if (savingRef.current) return;
			// 触发保存
			void onSave();
		};
		// 挂载时在 window 上注册键盘监听
		window.addEventListener('keydown', onKeyDown);
		// 卸载时移除监听，防止内存泄漏
		return () => window.removeEventListener('keydown', onKeyDown);
	}, [onSave]);

	// 列表开关按钮组件（在工具栏与预览头部复用）
	const listToggleBtn = useCallback(
		() => (
			<Btn
				title={store.listOpen ? '关闭笔记列表' : '打开笔记列表'}
				onClick={() => store.toggleListOpen()}
			>
				<NotebookText size={15} />
			</Btn>
		),
		[store, store.listOpen],
	);

	// 工具栏额外按钮：新建 + 保存 + 列表开关
	const toolbarExtra = useMemo(
		() => (
			<>
				{/* 新建笔记按钮 */}
				<Btn title="新建笔记" onClick={() => store.openNew()}>
					<FilePenLine size={15} />
				</Btn>
				{/* 保存/更新按钮：saving 时禁用，文案随 editingId 变化，tooltip 显示快捷键提示 */}
				<Btn
					title={
						store.saving
							? '保存中…'
							: store.editingId
								? '更新笔记 ⌘S'
								: '保存笔记 ⌘S'
					}
					onClick={() => void onSave()}
					disabled={store.saving}
				>
					<Save size={15} />
				</Btn>
				{/* 列表开关按钮 */}
				{listToggleBtn()}
			</>
		),
		[listToggleBtn, onSave, store, store.editingId, store.saving],
	);

	// 根容器：纵向 flex，圆角 + 主题背景
	return (
		<div
			className={cn(
				'bg-theme/5 text-textcolor flex h-full min-h-0 min-w-0 flex-col text-sm rounded-md',
			)}
		>
			{/* 删除确认弹层：全局挂载，由 store.confirmOpen 控制 */}
			<Confirm
				open={store.confirmOpen}
				onOpenChange={(open) => store.setConfirmOpen(open)}
				title="确定删除这条笔记？"
				description="删除后将无法恢复"
				onConfirm={() => void store.confirmDelete()}
			/>
			{/* 水平分栏：左列表 + 右编辑器/预览 */}
			<ResizablePanelGroup
				id="learning-notes-split"
				orientation="horizontal"
				className="h-full min-h-0 min-w-0 flex-1"
			>
				{/* 列表栏：仅 store.listOpen 时渲染 */}
				{store.listOpen ? (
					<>
						<ResizablePanel
							id="learning-notes-list"
							{/* 默认占 35% */}
							defaultSize={35}
							{/* 允许收窄到 0 */}
							minSize={0}
							className="min-h-0 min-w-0"
						>
							<aside className="border-r mb-3 border-theme/10 flex h-full min-h-0 min-w-0 flex-col overflow-hidden">
								{/* 列表头：标题 + 加载统计 + 滚动按钮 */}
								<div className="flex h-10 shrink-0 items-center justify-between border-b border-theme/10 pl-3 pr-1.5 font-medium tracking-wide">
									<div className="text-textcolor/85">
										{/* 列表标题 */}
										笔记列表
										{/* 加载统计：已加载 N 条/共 M 条 */}
										<span className="ml-3 text-xs text-textcolor/60">
											已加载 {store.list.length} 条/共 {store.total} 条
										</span>
									</div>
									{/* 滚动模式切换按钮 */}
									<Btn title={scrollTitle} onClick={onScrollFabClick}>
										{/* 底部模式显示向下箭头 */}
										{displayMode === 'bottom' ? (
											<ChevronDown size={18} />
										// 顶部模式显示向上箭头
										) : displayMode === 'top' ? (
											<ChevronUp size={18} />
										// 当前模式显示定位图标
										) : (
											<LocateFixed size={15} />
										)}
									</Btn>
								</div>
								{/* 可滚动列表：内边距写在 ScrollArea，与主项目英语学习侧栏一致 */}
								<ScrollArea
									ref={scrollViewportRef}
									className="min-h-0 flex-1 p-3"
								>
									{/* 列表加载中：显示 Loading 动画 */}
									{store.loading ? (
										<div className="flex flex-1 flex-col items-center justify-center py-6 text-center text-sm text-textcolor/60">
											<Loading />
										</div>
									) : (
										<div className="flex flex-col gap-3">
											{/* 空态提示：列表为空且不在加载中时显示 */}
											{store.list.length === 0 && !store.loading ? (
												<p className="text-textcolor/45 px-1 py-6 text-center text-xs">
													暂无笔记，保存一条试试
												</p>
											) : null}
											{/* 列表项遍历：用 store.list 替代原 notes */}
											{store.list.map((n) => {
												// 高亮判定：预览优先，其次编辑态，避免两条同时高亮
												const active =
													(store.preview?.id ?? store.editingId) === n.id;
												return (
													<div
														key={n.id}
														{/* 活跃项挂载 activeItemRef，用于滚动到当前 */}
														ref={active ? activeItemRef : undefined}
														className={cn(
															'hover:bg-theme/10 bg-theme/5 group relative w-full rounded-md px-3 py-2.5 text-left transition-colors',
															active && 'bg-theme/15',
														)}
													>
														{/* 主区域：点击进入预览 */}
														<div
															className="w-full text-left"
															onClick={() => void store.openPreview(n.id)}
														>
															{/* 标题：hover 时右移给操作按钮腾位 */}
															<div className="text-textcolor truncate text-base font-semibold pr-0 transition-[padding] duration-200 group-hover:pr-14">
																{n.title}
															</div>
															{/* 时间 */}
															<div className="text-textcolor/45 mt-1.5 text-xs">
																{new Date(n.at).toLocaleString()}
															</div>
														</div>
														{/* hover 操作区：编辑 + 删除 */}
														<div className="absolute top-2 right-2 flex items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
															<button
																type="button"
																title="编辑"
																className="w-7 h-7 text-textcolor/80 hover:text-teal-500 hover:bg-teal-500/10 flex cursor-pointer items-center justify-center rounded-md p-1"
																onClick={(e) => {
																	e.stopPropagation();
																	void store.openEditById(n.id);
																}}
															>
																<SquarePen size={15} />
															</button>
															<button
																type="button"
																title="删除"
																className="w-7 h-7 text-textcolor/80 hover:text-destructive hover:bg-destructive/10 flex cursor-pointer items-center justify-center rounded-md p-1"
																onClick={(e) => {
																	e.stopPropagation();
																	store.requestDelete(n.id);
																}}
															>
																<Trash2 size={15} />
															</button>
														</div>
													</div>
												);
											})}
											{/* 加载更多中：显示「加载中…」提示 */}
											{store.loadingMore ? (
												<p className="text-textcolor/45 py-2 text-center text-xs">
													加载中…
												</p>
											) : null}
											{/* 没有更多了：已加载全部且列表非空时显示 */}
											{!store.loading &&
											!store.loadingMore &&
											store.list.length > 0 &&
											!store.hasMore ? (
												<p className="text-textcolor/35 py-2 text-center text-xs">
													没有更多了
												</p>
											) : null}
										</div>
									)}
								</ScrollArea>
							</aside>
						</ResizablePanel>
						{/* 分隔条 */}
						<ResizableHandle withHandle className="w-0" />
					</>
				) : null}
				{/* 右栏：编辑器 / 预览 */}
				<ResizablePanel
					id="learning-notes-editor"
					{/* 列表关闭时占满 */}
					defaultSize={store.listOpen ? 65 : 100}
					minSize={50}
					className="min-h-0 min-w-0"
				>
					<div className="border-theme/10 flex h-full min-h-0 min-w-0 flex-col overflow-hidden">
						{/* 编辑器容器：预览时用 hidden 隐藏（保留挂载，草稿不丢） */}
						<div
							className={cn(
								'flex h-full min-h-0 flex-1 flex-col overflow-hidden',
								store.preview && 'hidden',
							)}
						>
							<RichEditor
								{/* 递增即重建，用于切换新建/编辑 */}
								key={store.editorSeed}
								defaultContent={store.editorInitial}
								{/* 自动聚焦到文末 */}
								autofocus="end"
								placeholder="记下今天的单词、语法或口语收获…"
								showCharCount={false}
								{/* onCreate 回调：编辑器实例创建后把引用存到 editorRef */}
								onCreate={(e) => {
									editorRef.current = e;
								}}
								className="flex h-full min-h-0 flex-1 flex-col overflow-hidden"
								editorClassName="min-h-[6rem]"
								toolbarExtra={toolbarExtra}
							/>
						</div>
						{/* 预览组件：有 store.preview 时显示，header 含新建/编辑/删除/列表开关 */}
						{store.preview ? (
							// 详情加载中：显示 Loading 动画
							store.loadingDetail ? (
								<div className="flex flex-1 flex-col items-center justify-center py-6 text-center text-sm text-textcolor/60">
									<Loading />
								</div>
							) : (
								<NotePreview
									title={store.preview.title}
									html={store.preview.html}
									headerExtra={
										<>
											{/* 新建笔记按钮 */}
											<Btn title="新建笔记" onClick={() => store.openNew()}>
												<FilePenLine size={15} />
											</Btn>
											{/* 编辑按钮 */}
											<Btn
												title="编辑"
												onClick={() => {
													if (store.preview) store.openEdit(store.preview);
												}}
											>
												<SquarePen size={15} />
											</Btn>
											{/* 删除按钮 */}
											<Btn
												title="删除"
												onClick={() => {
													if (store.preview)
														store.requestDelete(store.preview.id);
												}}
											>
												<Trash2 size={15} />
											</Btn>
											{/* 列表开关按钮 */}
											{listToggleBtn()}
										</>
									}
								/>
							)
						) : null}
					</div>
				</ResizablePanel>
			</ResizablePanelGroup>
		</div>
	);
}

// 用 observer 包裹组件，使其响应 MobX store 变化而更新
export default observer(LearningNotesApp);

// 插件激活钩子（列表在组件 mount 时拉取，这里留空）
export async function activate() {
	// 列表在组件 mount 时拉取
}

// 插件停用钩子（无全局副作用需清理）
export async function deactivate() {
	// ponytail: 无全局副作用
}
```

---

## 20. 数据层 api.ts

**来源**：`apps/remote-plugins/src/views/learning-notes/api.ts`（约 92 行）

### 20.1 模块职责

学习笔记的数据访问层（DAL），把主站 `/english-learning/notes/*` 的 REST 接口封装成类型安全的 CRUD 方法，供 `index.tsx` 主应用调用：

- **定义契约类型**：`HostHttp`（host 注入的 HTTP 客户端形状）、`NoteRecord`/`NoteListItem`（后端原始行）、`Note`（前端统一视图模型）
- **响应解包**：`unwrapData` 兼容 `{ data: ... }` 包裹与裸返回两种风格
- **行→视图模型转换**：`toNote` 把后端行映射成前端 `Note`，处理空标题、空时间兜底
- **CRUD 工厂**：`createNotesApi(http)` 返回 `list / detail / save / update / remove` 五个方法，内部统一走 `BASE = '/english-learning/notes'`
- **导出类型**：`NotesApi = ReturnType<typeof createNotesApi>` 供外部类型标注

### 20.2 完整代码与逐行注释

```typescript
/** 学习笔记：经 HostBridge 调用主站 `/english-learning/notes/*` */

// host 注入的 HTTP 客户端形状：四个动词方法，均返回 Promise<T>
export type HostHttp = {
	get: <T = unknown>(url: string) => Promise<T>;
	post: <T = unknown>(url: string, body?: unknown) => Promise<T>;
	put: <T = unknown>(url: string, body?: unknown) => Promise<T>;
	delete: <T = unknown>(url: string) => Promise<T>;
};

// 列表默认每页条数：统一分页大小，避免各处硬编码不一致
export const NOTES_PAGE_SIZE = 10;

// 接口前缀：所有笔记接口都在该路径下
const BASE = '/english-learning/notes';

// 后端「笔记行」完整记录（含正文 content）
export type NoteRecord = {
	id: string;
	title: string | null; // 后端允许 null
	content: string; // 富文本 HTML
	userId?: number;
	createdAt?: string;
	updatedAt?: string;
};

// 列表接口返回的行：省略 content（列表只展示摘要）
export type NoteListItem = Omit<NoteRecord, 'content'>;

// 前端统一视图模型：字段都非空，方便组件直接用
export type Note = {
	id: string;
	title: string; // 已兜底为非空字符串
	html: string; // 由 content 映射而来
	at: number; // 毫秒时间戳，用于排序与展示
};

// 分页结果类型：列表页统一返回结构，含数据列表、总条数、当前页码、每页条数
export type NoteListPage = {
	// 当前页的笔记列表
	list: Note[];
	// 总条数：用于计算总页数和分页控件展示
	total: number;
	// 当前页码：从 1 开始
	pageNo: number;
	// 每页条数：与请求参数一致，便于前端校验
	pageSize: number;
};

// 解包后端响应：兼容 { data: ... } 包裹与裸返回两种风格
function unwrapData<T>(res: unknown): T {
	if (res && typeof res === 'object' && 'data' in res) {
		return (res as { data: T }).data;
	}
	return res as T;
}

// 把后端行转成前端 Note 视图模型
function toNote(row: NoteListItem | NoteRecord): Note {
	// content 仅在 NoteRecord 上存在；列表项没有，兜底空串
	const html =
		'content' in row && typeof row.content === 'string' ? row.content : '';
	// 优先 updatedAt，其次 createdAt，都没有则用当前时间
	const atRaw = row.updatedAt ?? row.createdAt;
	const at = atRaw ? new Date(atRaw).getTime() : Date.now();
	return {
		id: row.id,
		// 空标题兜底「无标题笔记」
		title: (row.title ?? '').trim() || '无标题笔记',
		html,
		// 非法时间戳兜底当前时间
		at: Number.isFinite(at) ? at : Date.now(),
	};
}

// 工厂：传入 host 的 http，返回封装好的笔记 CRUD API
export function createNotesApi(http: HostHttp) {
	return {
		// 列表：支持分页，默认第 1 页，每页 NOTES_PAGE_SIZE 条，返回分页对象
		async list(pageNo = 1, pageSize = NOTES_PAGE_SIZE): Promise<NoteListPage> {
			const res = await http.get(`${BASE}/list?pageNo=${pageNo}&pageSize=${pageSize}`);
			const page = unwrapData<{ list: NoteListItem[]; total: number }>(res);
			// 兜底：page.list 可能不是数组
			const rows = Array.isArray(page?.list) ? page.list : [];
			return {
				// 将后端行转成前端 Note 视图模型
				list: rows.map(toNote),
				// 总条数：优先用后端返回的 total，没有则用当前页条数兜底
				total: typeof page?.total === 'number' ? page.total : rows.length,
				// 当前页码：回显传入的 pageNo，便于调用方确认
				pageNo,
				// 每页条数：回显传入的 pageSize，便于调用方确认
				pageSize,
			};
		},

		// 详情：按 id 拉单条，返回完整 Note（含 html 正文）
		async detail(id: string): Promise<Note> {
			const res = await http.get(`${BASE}/detail/${id}`);
			return toNote(unwrapData<NoteRecord>(res));
		},

		// 新建：标题空则传 null 由后端兜底；content 存 html
		async save(input: {
			title: string;
			html: string;
		}): Promise<{ id: string }> {
			const res = await http.post(`${BASE}/save`, {
				title: input.title.trim() || null,
				content: input.html,
			});
			return unwrapData<{ id: string }>(res);
		},

		// 更新：put 到 /update/:id，body 含 id；返回更新后的 Note
		async update(
			id: string,
			input: { title: string; html: string },
		): Promise<Note> {
			const res = await http.put(`${BASE}/update/${id}`, {
				id,
				title: input.title.trim() || null,
				content: input.html,
			});
			return toNote(unwrapData<NoteRecord>(res));
		},

		// 删除：delete 到 /delete/:id，无返回值
		async remove(id: string): Promise<void> {
			await http.delete(`${BASE}/delete/${id}`);
		},
	};
}

// 推导出的 API 类型，供外部标注变量使用
export type NotesApi = ReturnType<typeof createNotesApi>;
```

---

## 21. 统一导出入口（design/index.ts）

**来源**：`apps/remote-plugins/src/components/design/index.ts`（共 20 行）

### 21.1 模块职责

design 组件库的**统一出口**，外部使用时只需要从 `@/components/design` 导入，不需要知道内部目录结构。

### 21.2 完整代码与逐行注释

```typescript
// 导入 Loading 组件默认导出，用于后续重新导出
import Loading from './Loading';

// 重新导出 RichEditor 的所有类型
export type {
	CodeLanguage,
	CreateExtensionsOptions,
	RichEditorChangePayload,
	RichEditorContent,
	RichEditorLocale,
	RichEditorProps,
	TextDirection,
} from './RichEditor';

// 重新导出 RichEditor 的值（函数、组件、常量）
export {
	CODE_LANGUAGES,
	createExtensions,
	getDocTitleText,
	RichEditor as default, // 默认导出是 RichEditor
	RichEditor,
	TitleNode,
	zhCN,
} from './RichEditor';

// 重新导出 NotePreview 的类型
export type { NotePreviewProps } from './NotePreview';

// 重新导出 NotePreview 组件和工具函数
export { NotePreview, stripNoteTitleHtml } from './NotePreview';

// 重新导出 Loading 模块的所有命名导出
export * from './Loading';
```

### 21.3 使用方式

```typescript
// 外部使用（推荐）
import { RichEditor, NotePreview } from '@/components/design';

// 而不是（不推荐，耦合内部结构）
import { RichEditor } from '@/components/design/RichEditor';
import { NotePreview } from '@/components/design/NotePreview';
```

---

## 22. 总结（更新版）

### 22.1 核心技术栈

- **Tiptap 3.x**：基于 ProseMirror 的 React 富文本编辑器框架
- **ProseMirror**：底层文档模型和事务系统
- **React**：UI 组件化
- **lowlight**：代码块语法高亮
- **lucide-react**：图标库
- **react-resizable-panels**：左右分栏可拖拽调整
- **@radix-ui/react-dropdown-menu**：工具栏下拉菜单
- **@radix-ui/react-scroll-area**：滚动区域

### 22.2 关键设计决策

| 决策 | 原因 |
|------|------|
| 自定义 Title atom 节点 | 标题常驻首位、不可删除、用原生 input 编辑 |
| 用 ref 存上传函数 | 扩展只创建一次，ref 可动态更新 |
| 链接表单不用 window.prompt | Tauri 桌面端兼容性 + 样式统一 |
| 中文 IME 组字期间不写 attrs | 避免受控重渲染把拼音提交进文档 |
| appendTransaction 保证文档结构合法 | 防止多余 title、缺正文、GapCursor |
| 空文档必须有 title + paragraph | 避免 GapCursor 无法输入的问题 |
| 字符计数用 Intl.Segmenter | 中文按字素计数更准确 |
| 按功能域分目录 | 模块边界清晰，便于维护和扩展 |
| 预览时编辑器 hidden 而非卸载 | 保留草稿状态，返回编辑不丢失 |
| NotePreview 剥离 title 节点 | 避免预览时标题重复显示 |

### 22.3 扩展方式

1. **添加新的格式化按钮**：修改 `toolbar/Toolbar.tsx`，加一个 `Btn`
2. **添加自定义节点**：参考 `title/TitleNode.ts` 的模式
3. **添加自定义 Mark**：参考 Tiptap 官方扩展文档，通过 `extraExtensions` 传入
4. **替换图片上传**：传 `onUploadImage` prop，返回 CDN URL
5. **完全自定义扩展**：传 `extensions` prop，覆盖所有默认扩展
6. **扩展 design 组件库**：在 `design/` 下加新目录，在 `design/index.ts` 导出

---

（文档完 · 已更新至最新代码结构）

---

（若与仓库最新源码不一致，以源码为准）
