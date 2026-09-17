# 富文本编辑器打磨（GapCursor 修正 / 空段删除 / 落点 / 插图 MIME）实现归档

> 文档角色：implementation-doc-from-diff 归档稿
> 改动一轮：学习笔记富文本编辑器打磨
> 状态：已落地（2026-07）

## 1. 背景与目标

学习笔记富文本编辑器（`RichEditor`）在长期使用中暴露出一组交互与性能问题，本轮集中打磨：

- **GapCursor 误纠**：旧 `TitleNode.appendTransaction` 把正文里图片前后的 `GapCursor` 一律当成「非法选区」拉回文末，导致块级图片前无法继续输入。
- **空段无法删除**：标题与图片之间夹着一段空 `<p>` 时，原生 Backspace/Delete 受 atom 节点阻挡，删不掉该段。
- **标题外观重复**：TipTap 内 TitleView 与长文窗口外标题各自维护一份徽章 + Input + IME 逻辑，逻辑双份。
- **autofocus='end' 不生效**：长文入口传 `autofocus="end"` 时光标仍未钉到正文末尾。
- **插图 MIME 不被 DOCX 导出接纳**：本地插图 webp/avif 等 data URL，后端 sharp 导出 DOCX 失败。
- **GapCursor 视觉缺失**：图片前后没有可见光标提示，用户不知道可在此处输入。
- **长文挂载卡顿**：列表切换 + 长文解析同帧，遮罩都刷不出来；同时未区分长文 / 普通编辑器、未走 windowed 预览。

目标：让编辑器在「标题/正文/图片」混合结构里输入稳定，长文不卡，导出通路打通。

## 2. 改动范围

- `apps/remote-plugins/src/components/design/RichEditor/title/TitleNode.ts`（MODIFIED — GapCursor 修正）
- `apps/remote-plugins/src/components/design/RichEditor/title/NoteTitleField.tsx`（NEW — 标题外观组件抽取）
- `apps/remote-plugins/src/components/design/RichEditor/title/Title.tsx`（MODIFIED — TitleView 退化为壳）
- `apps/remote-plugins/src/components/design/RichEditor/extensions/EmptyParagraphDelete.ts`（NEW — 空段删除扩展）
- `apps/remote-plugins/src/components/design/RichEditor/extensions/index.ts`（MODIFIED — 注册 EmptyParagraphDelete + imageResize/tableResizable 开关）
- `apps/remote-plugins/src/components/design/RichEditor/index.tsx`（MODIFIED — autofocus='end' 钉文末 + onBodyScroll + renderBody + 导出 NoteTitleField）
- `apps/remote-plugins/src/components/design/RichEditor/image/image.ts`（MODIFIED — fileToDataUrl MIME 归一为 JPEG）
- `apps/remote-plugins/src/components/design/RichEditor/styles.css`（MODIFIED — GapCursor CSS 新增）
- `apps/remote-plugins/src/views/learning-notes/index.tsx`（MODIFIED — mountEditor 延迟挂载 + LargeNoteEditor 分支 + previewHeaderExtra）

## 3. 实现思路

1. **GapCursor 在正文中合法**：`appendTransaction` 区分「空正文」与「图片旁 GapCursor」。只有空正文或非文本块塌缩光标才纠正；正文内的 `GapCursor` 视为合法，不再强拉到 `Selection.atEnd`。
2. **`bodyEmpty` 加结构守卫**：旧逻辑用 `textBetween(titleSize, end).length === 0` 判空正文，遇到图片（atom 无文本）会误判为空。改为 `childCount < 2 || (childCount === 2 && child(1).isTextblock && content.size === 0)`，保证图片段不被当成空正文。
3. **结构修复与选区解耦**：扫多余 title / 补一段 paragraph 只在 `docChanged` 时跑；纯 `selectionSet` 不再扫描，避免选区变化触发结构事务链。
4. **空段删除扩展**：新增 `EmptyParagraphDelete`，在空段落首 Backspace / 末 Delete 时，链式 `tr.delete(from, to)` + `Selection.near`，并用 `canRemoveBlock` 守住最少块数。
5. **标题外观抽取**：`NoteTitleField` 承载徽章 + Input + IME + 字数，`TitleView` 退化为 22 行壳；长文窗口复用同一外观组件。
6. **autofocus='end' 钉文末**：`focusBodyEnd` 条件从「仅 title 在首位」扩为「title 在首位 || 显式 autofocus==='end'」；保留双 rAF 重钉（Title NodeView 挂载会打乱选区）。
7. **插图 MIME 归一**：非 jpeg/png/gif 走 `createImageBitmap` → canvas → `toDataURL('image/jpeg', 0.9)`；解码失败回退原始 data URL 交服务端 sharp 处理。`DOCX_SAFE` 集合白名单直读。
8. **GapCursor 视觉**：新增 `.ProseMirror-gapcursor::after` 顶部细线 + `@keyframes rich-editor-gapcursor-blink`，点进图前/图后可见闪烁光标。
9. **长文延迟挂载**：`LearningNotesApp` 引入 `mountEditor` 状态，先画 Loading 遮罩，下一 rAF 再挂 TipTap；同时区分 `useLarge` 走 `LargeNoteEditor`、预览走 `WindowedPreviewBody`。

## 4. 关键代码与逐行注释

### 4.1 `TitleNode.appendTransaction`（GapCursor 修正）

**对比范围**：`appendTransaction(transactions, _old, state)` 全方法（从方法签名到闭合 `},`）。

**改动前** · `apps/remote-plugins/src/components/design/RichEditor/title/TitleNode.ts`（基线，约 L79–L118）

```typescript
// appendTransaction 签名：接收本轮 transactions、旧 state、当前 state，返回 null 或新 tr
appendTransaction(transactions, _old, state) {
	// 旧版：只要任一 tr 改了文档或选区就进入；无法区分两类工作量
	if (!transactions.some((tr) => tr.docChanged || tr.selectionSet))
		return null;

	// 复用 state.tr 拼接后续 replaceWith/insert/setSelection
	let tr = state.tr;
	// 标记本事务是否产生过改动，决定最后是否 return tr
	let changed = false;

	// 旧版注释：去掉多余 title（结构修复）
	const extras: { pos: number; nodeSize: number }[] = [];
	// 计数已见 title 个数
	let seen = 0;
	// 遍历顶层块，找出第 2 个及以后的 title
	state.doc.forEach((node, offset) => {
		// 非 title 直接跳过
		if (node.type.name !== 'title') return;
		// 命中 title 计数
		seen += 1;
		// 第 2 个起记录位置与尺寸待删
		if (seen > 1) extras.push({ pos: offset, nodeSize: node.nodeSize });
	});
	// 从后往前删，避免前面的删除影响后面 pos
	for (let i = extras.length - 1; i >= 0; i--) {
		// 取当前待删 title 的位置和尺寸
		const { pos, nodeSize } = extras[i];
		// 把多余 title 替换成空 paragraph，保持 block+ 结构合法
		tr.replaceWith(
			pos,
			pos + nodeSize,
			state.schema.nodes.paragraph.create(),
		);
		// 标记改动
		changed = true;
	}

	// 若已改则取改动后的 doc，否则原 state.doc
	const doc = changed ? tr.doc : state.doc;
	// 取首位节点判断是否 title
	const title = doc.firstChild;
	// 没有正文块时补一段（atom 旁 GapCursor 看起来像有光标但输不进字）
	if (title?.type.name === 'title' && doc.childCount < 2) {
		// 在 title 之后插入空 paragraph
		tr = tr.insert(
			title.nodeSize,
			state.schema.nodes.paragraph.create(),
		);
		// 标记改动
		changed = true;
	}

	// 取最终 doc（可能经过结构修复）作为后续选区纠正的基准
	const nextDoc = changed ? tr.doc : state.doc;
	// 取首位节点
	const titleNode = nextDoc.firstChild;
	// 仅当首位是 title 时做选区纠正
	if (titleNode?.type.name === 'title') {
		// title 节点的尺寸（包含闭合 token），用作「正文起点」
		const titleSize = titleNode.nodeSize;
		// 若结构已改用 tr.selection，否则用 state.selection
		const sel = changed ? tr.selection : state.selection;
		// 旧版：用 textBetween 是否为空判断正文是否空——遇 atom 图片会误判
		const bodyEmpty = !nextDoc.textBetween(
			titleSize,
			nextDoc.content.size,
		).length;
		// 选区起点
		const $from = sel.$from;
		// 当前光标是否真在正文文本块里
		const caretInBody =
			sel instanceof TextSelection &&
			sel.empty &&
			$from.parent.isTextblock &&
			$from.pos > titleSize;
		// 旧版注释：GapCursor / 非正文块 / 塌缩光标不在正文 → 钉回首段
		// 旧版注释：有 range 选区时不干预，避免 Cmd+A 被清掉
		// 旧逻辑把所有 GapCursor 都视为非法，导致图片前无法停留
		const needsFix =
			sel instanceof GapCursor ||
			(sel.empty && !$from.parent.isTextblock) ||
			(bodyEmpty && sel.empty && !caretInBody);

		// 命中纠正且正文非空：把选区钉到首段或文末
		if (needsFix && titleSize + 1 <= nextDoc.content.size) {
			// 空正文钉到 title 后第一段首位；否则钉到文末
			const nextSel = bodyEmpty
				? TextSelection.create(nextDoc, titleSize + 1)
				: Selection.atEnd(nextDoc);
			// 写入新选区
			tr = tr.setSelection(nextSel);
			// 标记改动
			changed = true;
		}
	}

	// 有改动返回 tr，否则返回 null 不产生新事务
	return changed ? tr : null;
// appendTransaction 闭合
},
```

**改动后** · `apps/remote-plugins/src/components/design/RichEditor/title/TitleNode.ts`（当前，约 L79–L160）

```typescript
// appendTransaction 签名：接收本轮 transactions、旧 state、当前 state
appendTransaction(transactions, _old, state) {
	// 拆出 docChanged 与 selectionSet 两个布尔，后续按需分别处理
	const docChanged = transactions.some((tr) => tr.docChanged);
	// 单独判断选区是否变化
	const selectionSet = transactions.some((tr) => tr.selectionSet);
	// 二者皆无则不产生事务
	if (!docChanged && !selectionSet) return null;

	// 复用 state.tr 拼接后续 replaceWith/insert/setSelection
	let tr = state.tr;
	// 标记本事务是否产生过改动
	let changed = false;

	// 改动后注释：结构修复只在 doc 变化时做（选区变化不必扫多余 title）
	if (docChanged) {
		// 待删除的多余 title 列表
		const extras: { pos: number; nodeSize: number }[] = [];
		// 计数已见 title 个数
		let seen = 0;
		// 遍历顶层块，找出第 2 个及以后的 title
		state.doc.forEach((node, offset) => {
			// 非 title 直接跳过
			if (node.type.name !== 'title') return;
			// 命中 title 计数
			seen += 1;
			// 第 2 个起记录位置与尺寸待删
			if (seen > 1)
				extras.push({ pos: offset, nodeSize: node.nodeSize });
		});
		// 从后往前删，避免前面的删除影响后面 pos
		for (let i = extras.length - 1; i >= 0; i--) {
			// 取当前待删 title 的位置和尺寸
			const { pos, nodeSize } = extras[i];
			// 把多余 title 替换成空 paragraph，保持 block+ 结构合法
			tr.replaceWith(
				pos,
				pos + nodeSize,
				state.schema.nodes.paragraph.create(),
			);
			// 标记改动
			changed = true;
		}

		// 若已改则取改动后的 doc，否则原 state.doc
		const doc = changed ? tr.doc : state.doc;
		// 取首位节点判断是否 title
		const title = doc.firstChild;
		// 没有正文块时补一段（atom 旁 GapCursor 看起来像有光标但输不进字）
		if (title?.type.name === 'title' && doc.childCount < 2) {
			// 在 title 之后插入空 paragraph
			tr = tr.insert(
				title.nodeSize,
				state.schema.nodes.paragraph.create(),
			);
			// 标记改动
			changed = true;
		}
	// docChanged 分支闭合
	}

	// 取最终 doc（可能经过结构修复）作为后续选区纠正的基准
	const nextDoc = changed ? tr.doc : state.doc;
	// 取首位节点
	const titleNode = nextDoc.firstChild;
	// 仅当首位是 title 时做选区纠正
	if (titleNode?.type.name === 'title') {
		// title 节点的尺寸（包含闭合 token），用作「正文起点」
		const titleSize = titleNode.nodeSize;
		// 若结构已改用 tr.selection，否则用 state.selection
		const sel = changed ? tr.selection : state.selection;
		// 选区起点
		const $from = sel.$from;
		// 当前光标是否真在正文文本块里
		const caretInBody =
			sel instanceof TextSelection &&
			sel.empty &&
			$from.parent.isTextblock &&
			$from.pos > titleSize;

		// 改动后注释：仅「空正文」或非法非文本选区才纠正。
		// 改动后注释：正文里的 GapCursor（如图片前）合法——旧逻辑一律 atEnd，导致无法在图前输入。
		// 改用结构判断：少于 2 块视为空；正好 2 块且第二块是空文本块才视为空
		const bodyEmpty =
			nextDoc.childCount < 2 ||
			(nextDoc.childCount === 2 &&
				nextDoc.child(1).isTextblock &&
				nextDoc.child(1).content.size === 0);

		// 默认不纠正
		let needsFix = false;
		// 空正文 + 塌缩 + 不在正文：钉回首段
		if (bodyEmpty && sel.empty && !caretInBody) {
			// 命中纠正
			needsFix = true;
		// 否则若塌缩、且非 GapCursor、且父节点非文本块：纠正
		} else if (
			sel.empty &&
			!(sel instanceof GapCursor) &&
			!$from.parent.isTextblock
		) {
			// 命中纠正
			needsFix = true;
		}

		// 命中纠正且正文非空：把选区钉到首段或文末
		if (needsFix && titleSize + 1 <= nextDoc.content.size) {
			// 空正文钉到 title 后第一段首位；否则钉到文末
			const nextSel = bodyEmpty
				? TextSelection.create(nextDoc, titleSize + 1)
				: Selection.atEnd(nextDoc);
			// 写入新选区
			tr = tr.setSelection(nextSel);
			// 标记改动
			changed = true;
		}
	}

	// 有改动返回 tr，否则返回 null 不产生新事务
	return changed ? tr : null;
// appendTransaction 闭合
},
```

**变更摘要**：把 `docChanged` 与 `selectionSet` 拆开判断，结构修复只在 `docChanged` 时跑；`bodyEmpty` 改为结构判定（`childCount` + `child(1).isTextblock`），不再被图片 atom 误判；`needsFix` 重排为「空正文」或「非 GapCursor 的非文本块塌缩光标」才纠正，正文内的 `GapCursor` 合法保留。

### 4.2 `NoteTitleField` 组件（纯新增）

**对比范围**：`NoteTitleField` 全组件（声明到闭合 `}`），含 `Props` 类型。

**改动后** · `apps/remote-plugins/src/components/design/RichEditor/title/NoteTitleField.tsx`（当前，约 L1–L82，纯新增）

```tsx
// 引入 lucide 的笔记本笔图标，用作标题徽章
import { NotebookPen } from 'lucide-react';
// 引入 useEffect 同步外部 value、useRef 记 IME 状态、useState 维护本地输入
import { useEffect, useRef, useState } from 'react';
// 引入项目内 Input 组件（带 showCount/maxLength 等能力）
import { Input } from '@/components/ui';
// 引入 i18n hook
import { useI18n } from '@/hooks';
// 引入 cn 做 className 合并
import { cn } from '@/lib/utils';
// 引入富文本编辑器文案取值（按 locale 选 placeholder 等）
import { richEditorLocaleOf } from '../locale';

// Props 类型：value 受控值、onChange 写回、onContinue Enter/Tab 跳正文、className 外观覆盖
type Props = {
	// 受控标题文本
	value: string;
	// 写回父级（TipTap 写 attrs.value、长文窗写本地 state）
	onChange: (value: string) => void;
	// 注释：Enter / Tab：交给正文
	onContinue?: () => void;
	// 外层 className 覆盖
	className?: string;
};

/**
 * 注释：笔记标题外观（徽章 + 输入 + 字数）。
 * 注释：TipTap Title NodeView 与长文窗外标题共用，避免两套 UI。
 */
export function NoteTitleField({
	// 解构受控 value
	value,
	// 解构写回
	onChange,
	// 解构跳正文回调
	onContinue,
	// 解构外层 className
	className,
}: Props) {
	// 取 i18n 的 t 翻译函数与 locale
	const { locale, t } = useI18n();
	// 取编辑器对应 locale 文案对象
	const editorLocale = richEditorLocaleOf(locale);
	// IME 组字中标志，组字期间不写 attrs
	const composing = useRef(false);
	// 本地输入态，避免受控重渲染打断输入
	const [local, setLocal] = useState(value);

	// 外部 value 变化时同步本地；组字中不同步，避免拼音被提交
	useEffect(() => {
		// 组字中跳过同步
		if (composing.current) return;
		// 用外部 value 覆盖本地
		setLocal(value);
	// 依赖外部 value
	}, [value]);

	// commit：写本地 + 非组字时写父级
	const commit = (next: string) => {
		// 始终写本地，保证输入流畅
		setLocal(next);
		// 非组字才回写父级
		if (!composing.current) onChange(next);
	};

	// 返回外观 JSX
	return (
		// 外层 div：纵向布局 + 下方间距，可被 className 覆盖
		<div
			className={cn(
				'rich-editor-note-title flex flex-col gap-2 mb-2',
				className,
			)}
		>
			// 内层卡片：相对定位 + 内边距 + 边框/背景
			<div className="relative flex flex-col gap-2 p-3 pr-0 pt-9 border border-theme/5 bg-theme/5 rounded-md">
				// 左上角徽章：绝对定位 + 主题色背景 + 图标 + 文案
				<div className="absolute -inset-0.5 bg-theme/20 border border-theme/5 text-theme/80 rounded-tl-md rounded-br-md pl-3 py-3.5 w-26 h-6 flex items-center gap-2">
					// 笔记笔图标
					<NotebookPen className="size-4" />
					// 徽章文案（learningNotes.titleBadge）
					<span className="text-sm font-medium pb-0.5">
						{t('learningNotes.titleBadge')}
					</span>
				</div>
				// 受控 Input
				<Input
					// 视觉样式：大字号、无边框、透明背景
					className="h-12 size-full px-0 py-0 text-xl md:text-xl rounded-none border-0 bg-transparent text-textcolor shadow-none placeholder:text-lg placeholder:text-textcolor/35 focus-visible:border-0 focus-visible:ring-0"
					// 绑定本地输入
					value={local}
					// 占位文案
					placeholder={editorLocale.placeholderHeadingHint}
					// 标题最大长度
					maxLength={50}
					// 显示字数计数
					showCount
					// 不进 Tab 序，避免正文按 Tab 时焦点跳到标题
					tabIndex={-1}
					// 鼠标按下时阻止冒泡，避免触发 PM 选区
					onMouseDown={(e) => e.stopPropagation()}
					// IME 组字开始：置位
					onCompositionStart={() => {
						composing.current = true;
					}}
					// IME 组字结束：清位 + 提交最终值
					onCompositionEnd={(e) => {
						composing.current = false;
						commit(e.currentTarget.value);
					}}
					// 普通输入：走 commit
					onChange={(e) => commit(e.target.value)}
					// 键盘事件
					onKeyDown={(e) => {
						// 组字中不处理
						if (e.nativeEvent.isComposing) return;
						// Enter / Tab：阻止默认 + 跳正文
						if (e.key === 'Enter' || e.key === 'Tab') {
							// 阻止默认行为
							e.preventDefault();
							// 调用跳正文回调
							onContinue?.();
						}
					}}
				/>
			</div>
		</div>
	);
}
```

**变更摘要**：纯新增。把标题外观从 `TitleView` 内联实现里抽出为独立组件，供 `TitleView` 与长文窗复用；保留原有 IME 组字保护、Tab 序隔离、Enter/Tab 跳正文等行为。

### 4.3 `TitleView` 退化为壳

**对比范围**：`TitleView` 默认导出组件全函数。

**改动前** · `apps/remote-plugins/src/components/design/RichEditor/title/Title.tsx`（基线，约 L1–L74）

```tsx
// 引入 NodeViewProps 类型与 NodeViewWrapper 容器
import { type NodeViewProps, NodeViewWrapper } from '@tiptap/react';
// 引入笔记本笔图标
import { NotebookPen } from 'lucide-react';
// 引入 useEffect 同步 attrs、useRef 记 IME、useState 维护本地输入
import { useEffect, useRef, useState } from 'react';
// 引入项目内 Input 组件
import { Input } from '@/components/ui';
// 引入 i18n hook
import { useI18n } from '@/hooks';
// 引入富文本编辑器文案取值
import { richEditorLocaleOf } from '../locale';
// 引入跳正文工具函数
import { focusAfterTitle } from './TitleNode';

/**
 * 注释：原生 input 编辑标题。
 * 注释：中文 IME：组字期间不写 attrs，避免受控重渲染把拼音一起提交进框。
 */
export default function TitleView({
	// 解构 NodeView 的 node
	node,
	// 解构 updateAttributes
	updateAttributes,
	// 解构 editor 实例
	editor,
}: NodeViewProps) {
	// 取 i18n
	const { locale, t } = useI18n();
	// 取编辑器文案
	const editorLocale = richEditorLocaleOf(locale);
	// IME 标志
	const composing = useRef(false);
	// 本地输入态
	const [value, setValue] = useState(String(node.attrs.value ?? ''));

	// attrs.value 变化时同步本地
	useEffect(() => {
		// 组字中跳过
		if (composing.current) return;
		// 同步外部 value
		setValue(String(node.attrs.value ?? ''));
	// 依赖 attrs.value
	}, [node.attrs.value]);

	// commit：写本地 + 非组字时写 attrs
	const commit = (next: string) => {
		// 写本地
		setValue(next);
		// 非组字才写 attrs
		if (!composing.current) updateAttributes({ value: next });
	};

	// 返回 NodeView 外观
	return (
		// NodeViewWrapper：标题容器，contentEditable=false 让原生 input 接管
		<NodeViewWrapper
			as="div"
			className="rich-editor-note-title flex flex-col gap-2 mb-2"
			contentEditable={false}
		>
			// 卡片容器：相对定位 + 边框 + 背景
			<div className="relative flex flex-col gap-2 p-3 pr-0 pt-9 border border-theme/5 bg-theme/5 rounded-md">
				// 左上角徽章
				<div className="absolute -inset-0.5 bg-theme/20 border border-theme/5 text-theme/80 rounded-tl-md rounded-br-md pl-3 py-3.5 w-26 h-6 flex items-center gap-2">
					// 笔记笔图标
					<NotebookPen className="size-4" />
					// 徽章文案
					<span className="text-sm font-medium pb-0.5">
						{t('learningNotes.titleBadge')}
					</span>
				</div>
				// 受控 Input
				<Input
					// 视觉样式
					className="h-12 size-full px-0 py-0 text-xl md:text-xl rounded-none border-0 bg-transparent text-textcolor shadow-none placeholder:text-lg placeholder:text-textcolor/35 focus-visible:border-0 focus-visible:ring-0"
					// 绑定本地 value
					value={value}
					// 占位文案
					placeholder={editorLocale.placeholderHeadingHint}
					// 最大长度
					maxLength={50}
					// 显示计数
					showCount
					// 注释：不进 Tab 序，避免正文按 Tab 时焦点跳到标题
					tabIndex={-1}
					// 鼠标按下阻止冒泡
					onMouseDown={(e) => e.stopPropagation()}
					// IME 开始
					onCompositionStart={() => {
						composing.current = true;
					}}
					// IME 结束
					onCompositionEnd={(e) => {
						composing.current = false;
						commit(e.currentTarget.value);
					}}
					// 输入
					onChange={(e) => commit(e.target.value)}
					// 键盘
					onKeyDown={(e) => {
						// 组字中跳过
						if (e.nativeEvent.isComposing) return;
						// Enter/Tab 跳正文
						if (e.key === 'Enter' || e.key === 'Tab') {
							// 阻止默认
							e.preventDefault();
							// 跳正文
							focusAfterTitle(editor);
						}
					}}
				/>
			</div>
		</NodeViewWrapper>
	);
}
```

**改动后** · `apps/remote-plugins/src/components/design/RichEditor/title/Title.tsx`（当前，约 L1–L22）

```tsx
// 引入 NodeViewProps 类型与 NodeViewWrapper 容器
import { type NodeViewProps, NodeViewWrapper } from '@tiptap/react';
// 引入抽出的标题外观组件
import { NoteTitleField } from './NoteTitleField';
// 引入跳正文工具函数
import { focusAfterTitle } from './TitleNode';

/**
 * 注释：TipTap 标题 NodeView：外观走 NoteTitleField，写入 attrs.value。
 */
export default function TitleView({
	// 解构 NodeView 的 node
	node,
	// 解构 updateAttributes
	updateAttributes,
	// 解构 editor 实例
	editor,
}: NodeViewProps) {
	// 返回 NodeView 外观，外壳只负责把 attrs.value 透传给 NoteTitleField
	return (
		// NodeViewWrapper：contentEditable=false 让原生 input 接管
		<NodeViewWrapper as="div" contentEditable={false}>
			// 复用 NoteTitleField
			<NoteTitleField
				// 受控值取自 attrs.value
				value={String(node.attrs.value ?? '')}
				// onChange 写回 attrs
				onChange={(next) => updateAttributes({ value: next })}
				// Enter/Tab 跳正文
				onContinue={() => focusAfterTitle(editor)}
			/>
		</NodeViewWrapper>
	);
}
```

**变更摘要**：`TitleView` 从 74 行内联实现退化为 22 行壳，徽章 + Input + IME + 字数逻辑全部下沉到 `NoteTitleField`；行为等价，逻辑单份维护。

### 4.4 `EmptyParagraphDelete` 扩展（纯新增）

**对比范围**：`EmptyParagraphDelete` 全扩展，含 `isEmptyParagraphNode` / `emptyParagraphAt` / `canRemoveBlock` 辅助函数。

**改动后** · `apps/remote-plugins/src/components/design/RichEditor/extensions/EmptyParagraphDelete.ts`（当前，约 L1–L86，纯新增）

```ts
// 引入 TipTap Extension 基类
import { Extension } from '@tiptap/core';
// 引入 ProseMirror Node 类型
import type { Node as PmNode } from '@tiptap/pm/model';
// 引入 Selection 与 TextSelection
import { Selection, TextSelection } from '@tiptap/pm/state';

// 判定一个节点是否「空段落」：<p></p> 或 <p><br></p>
function isEmptyParagraphNode(node: PmNode): boolean {
	// 非 paragraph 直接 false
	if (node.type.name !== 'paragraph') return false;
	// content.size 为 0 即 <p></p>
	if (node.content.size === 0) return true;
	// 注释：<p><br></p> 也算空行
	// 假设全为 hardBreak，发现非 hardBreak 子节点则置 false
	let onlyBreaks = true;
	// 遍历子节点
	node.forEach((child) => {
		// 遇到非 hardBreak 即非空行
		if (child.type.name !== 'hardBreak') onlyBreaks = false;
	});
	// 返回是否全为 hardBreak
	return onlyBreaks;
}

/** 注释：当前是否在空段落内 */
function emptyParagraphAt(selection: Selection) {
	// 非 TextSelection 或非空选区直接 null
	if (!(selection instanceof TextSelection) || !selection.empty) return null;
	// 取选区起点
	const { $from } = selection;
	// 父节点
	const parent = $from.parent;
	// 父节点非空段落直接 null
	if (!isEmptyParagraphNode(parent)) return null;
	// 返回空段落定位信息
	return {
		// 起点 resolved pos
		$from,
		// 父节点
		parent,
		// 段落起点 pos（before）
		from: $from.before(),
		// 段落结束 pos（before + nodeSize）
		to: $from.before() + parent.nodeSize,
	};
}

/** 注释：删掉后文档是否仍满足最少块数（有 title 时至少 title+1 块，否则至少 1 块） */
function canRemoveBlock(doc: {
	// 文档子块数
	childCount: number;
	// 首位节点类型名
	firstChild?: { type: { name: string } } | null;
}): boolean {
	// 有 title 时最少 2 块，否则 1 块
	const min = doc.firstChild?.type.name === 'title' ? 2 : 1;
	// 当前块数必须大于最少块数才可删
	return doc.childCount > min;
}

/**
 * 注释：空段落卡在 title/文档开头与图片之间时，原生 Backspace 无法「并进」atom，表现为删不掉。
 * 注释：在空段开头 Backspace / 空段末尾 Delete 时直接删掉该段。
 */
export const EmptyParagraphDelete = Extension.create({
	// 扩展名
	name: 'emptyParagraphDelete',

	// 注册键盘快捷键
	addKeyboardShortcuts() {
		// 返回快捷键映射
		return {
			// Backspace：仅空段首位触发
			Backspace: ({ editor }) => {
				// 取当前空段定位
				const hit = emptyParagraphAt(editor.state.selection);
				// 不在空段 / 不在段首位 → 不处理
				if (!hit || hit.$from.parentOffset !== 0) return false;
				// 删后会破坏最少块数 → 不处理
				if (!canRemoveBlock(editor.state.doc)) return false;

				// 取段落 from/to
				const { from, to } = hit;
				// 链式命令：删段 + 重设选区
				return editor
					.chain()
					.command(({ tr, dispatch }) => {
						// 删除空段
						tr.delete(from, to);
						// 取安全 pos（不超过文档尺寸）
						const pos = Math.min(from, tr.doc.content.size);
						// 在删除点附近找一个合法 TextSelection
						tr.setSelection(Selection.near(tr.doc.resolve(pos), 1));
						// 派发
						dispatch?.(tr);
						// 命中已处理
						return true;
					})
					.run();
			},
			// Delete：仅空段末位触发
			Delete: ({ editor }) => {
				// 取当前空段定位
				const hit = emptyParagraphAt(editor.state.selection);
				// 不在空段 → 不处理
				if (!hit) return false;
				// 不在段末位 → 不处理
				if (hit.$from.parentOffset !== hit.parent.content.size) return false;
				// 删后会破坏最少块数 → 不处理
				if (!canRemoveBlock(editor.state.doc)) return false;
				// 已经是文档末尾 → 不处理（避免删后无块可放选区）
				if (hit.to >= editor.state.doc.content.size) return false;

				// 取段落 from/to
				const { from, to } = hit;
				// 链式命令：删段 + 重设选区
				return editor
					.chain()
					.command(({ tr, dispatch }) => {
						// 删除空段
						tr.delete(from, to);
						// 取安全 pos
						const pos = Math.min(from, tr.doc.content.size);
						// 在删除点附近找合法选区
						tr.setSelection(Selection.near(tr.doc.resolve(pos), 1));
						// 派发
						dispatch?.(tr);
						// 命中已处理
						return true;
					})
					.run();
			},
		};
	},
});
```

**变更摘要**：纯新增。在空段首位 Backspace / 末位 Delete 时，链式 `tr.delete(from, to)` 删除整段，并 `Selection.near` 重设选区；`canRemoveBlock` 守住「有 title 至少 2 块、无 title 至少 1 块」的最少块数约束。

### 4.5 `createExtensions` 注册 EmptyParagraphDelete

**对比范围**：`createExtensions` 全函数（聚焦注册 EmptyParagraphDelete 与 imageResize/tableResizable 开关段）。

**改动前** · `apps/remote-plugins/src/components/design/RichEditor/extensions/index.ts`（基线，约 L48–L90）

```ts
/** 注释：组装默认扩展；业务可通过 extensions / extraExtensions 覆盖或追加 */
export function createExtensions(
	// options：扩展组装可选项
	options: CreateExtensionsOptions = {},
): Extensions {
	// 业务完全替换扩展列表时直接返回
	if (options.extensions) return options.extensions;

	// 默认 placeholder
	const placeholder = options.placeholder ?? zhCN.placeholder;
	// 默认图片解析引用
	const resolveImageSrcRef = options.resolveImageSrcRef ?? {
		current: fileToDataUrl,
	};
	// 注释：默认开启；显式 false 时跳过（无字数 UI 且无上限）
	const withCharCount = options.characterCount !== false;
	// 注释：默认显示标题
	const withTitle = options.showTitle !== false;

	// 默认扩展数组
	const baseExtensions: Extensions = [
		// 有 title 时挂 CustomDocument + TitleNode
		...(withTitle ? [CustomDocument, TitleNode] : []),
		// Tab 缩进扩展
		TabIndent,
		// StarterKit 基础套件
		StarterKit.configure({
			// 有 title 时关掉自带 document
			document: withTitle ? false : undefined,
			// trailingNode 保证末尾有空段
			trailingNode: {
				node: 'paragraph',
			},
			// 标题级别
			heading: { levels: [1, 2, 3, 4, 5] },
			// 关掉自带 codeBlock（用 CodeBlockLowlight）
			codeBlock: false,
			// link 配置
			link: {
				// 不点开
				openOnClick: false,
				// 自动识别
				autolink: true,
				// 默认协议
				defaultProtocol: 'https',
				// HTML 属性
				HTMLAttributes: {
					rel: 'noopener noreferrer',
					target: '_blank',
				},
			},
		}),
		// 代码块（带 lowlight 高亮）
		CodeBlockLowlight.configure({
			// lowlight 实例
			lowlight,
			// 默认语言
			defaultLanguage: 'javascript',
			// 启用 Tab 缩进
			enableTabIndentation: true,
			// Tab 宽度
			tabSize: 2,
			// HTML 属性
			HTMLAttributes: { class: 'hljs' },
		}),
		// Placeholder 占位
		Placeholder.configure({
			// 按 node 类型返回 placeholder
			placeholder: ({ editor, node }) => {
				// title 节点不显示占位
				if (withTitle && node.type.name === 'title') return '';
				// 标题节点显示级别
				if (node.type.name === 'heading') {
					return `${zhCN.placeholderHeading} ${node.attrs.level}`;
				}
				// editor 引用避免未用警告
				void editor;
				// 默认占位文案
				return placeholder;
			},
			// ...（未改动）
		}),
		// ...（未改动）
	];
	// ...（未改动）
}
```

**改动后** · `apps/remote-plugins/src/components/design/RichEditor/extensions/index.ts`（当前，约 L48–L90 摘录）

```ts
/** 注释：组装默认扩展；业务可通过 extensions / extraExtensions 覆盖或追加 */
export function createExtensions(
	// options：扩展组装可选项
	options: CreateExtensionsOptions = {},
): Extensions {
	// 业务完全替换扩展列表时直接返回
	if (options.extensions) return options.extensions;

	// 默认 placeholder
	const placeholder = options.placeholder ?? zhCN.placeholder;
	// 默认图片解析引用
	const resolveImageSrcRef = options.resolveImageSrcRef ?? {
		current: fileToDataUrl,
	};
	// 注释：默认开启；显式 false 时跳过（无字数 UI 且无上限）
	const withCharCount = options.characterCount !== false;
	// 注释：默认显示标题
	const withTitle = options.showTitle !== false;

	// 默认扩展数组
	const baseExtensions: Extensions = [
		// 有 title 时挂 CustomDocument + TitleNode
		...(withTitle ? [CustomDocument, TitleNode] : []),
		// Tab 缩进扩展
		TabIndent,
		// 新增：空段删除扩展，解决 atom 旁空段删不掉
		EmptyParagraphDelete,
		// StarterKit 基础套件
		StarterKit.configure({
			// 有 title 时关掉自带 document
			document: withTitle ? false : undefined,
			// trailingNode 保证末尾有空段
			trailingNode: {
				node: 'paragraph',
			},
			// 标题级别
			heading: { levels: [1, 2, 3, 4, 5] },
			// 关掉自带 codeBlock（用 CodeBlockLowlight）
			codeBlock: false,
			// 注释：TipTap 3：undoRedo（非 history）；长文降低深度，减轻内存与事务
			// 新增：undoRedo 深度限制为 50
			undoRedo: { depth: 50 },
			// link 配置
			link: {
				// 不点开
				openOnClick: false,
				// 自动识别
				autolink: true,
				// 默认协议
				defaultProtocol: 'https',
				// HTML 属性
				HTMLAttributes: {
					rel: 'noopener noreferrer',
					target: '_blank',
				},
			},
		}),
		// ...（未改动：CodeBlockLowlight / Placeholder / Highlight / TextAlign）
		// Image 配置：新增 imageResize 开关
		Image.configure({
			// 块级图片
			inline: false,
			// 允许 base64
			allowBase64: true,
			// HTML 属性
			HTMLAttributes: { class: 'rich-editor-image' },
			// 仅在 options.imageResize 为真时启用拖拽缩放
			...(options.imageResize
				? {
						// 启用 resize
						resize: {
							enabled: true,
							// 保持比例
							alwaysPreserveAspectRatio: true,
						},
					}
				: {}),
		}),
		// 图片上传扩展
		ImageUpload.configure({ resolveSrcRef: resolveImageSrcRef }),
		// 表格套件：resizable 改为按 options 开关
		TableKit.configure({
			// 仅在显式 true 时启用列宽拖拽
			table: { resizable: options.tableResizable === true },
		}),
		// ...（未改动：TaskList / TaskItem / CharacterCount / extraExtensions）
	];
	// ...（未改动）
}
```

**变更摘要**：在 `TabIndent` 之后注册 `EmptyParagraphDelete`；为 `StarterKit.undoRedo` 设 `depth: 50`；`Image.resize` 与 `TableKit.table.resizable` 改为按 `options.imageResize` / `options.tableResizable` 显式开启（默认 false，长文下避免 NodeView/监听开销）。

### 4.6 `RichEditor` autofocus='end' 钉文末

**对比范围**：`onCreate` 处理器全块（含内部 `focusBodyEnd` 闭包与双 rAF 重钉）。

**改动前** · `apps/remote-plugins/src/components/design/RichEditor/index.tsx`（基线，约 L141–L152）

```tsx
// useEditor 的 onCreate 回调：编辑器创建后立即执行
onCreate: ({ editor: e }) => {
	// 闭包：把光标钉到正文末尾
	const focusBodyEnd = () => {
		// 编辑器已销毁则不操作
		if (e.isDestroyed) return;
		// 旧版：仅当首位是 title 时钉文末；显式 autofocus='end' 不被识别
		if (e.state.doc.firstChild?.type.name === 'title') {
			// 调用 focus('end')
			e.commands.focus('end');
		}
	};
	// 立即钉一次
	focusBodyEnd();
	// 注释：Title NodeView 挂载可能打乱选区，下一帧再钉到末尾
	// 双 rAF 重钉：第一帧 NodeView 挂载、第二帧再校正
	requestAnimationFrame(() => {
		// 第二次钉
		focusBodyEnd();
		// 第三次钉
		requestAnimationFrame(focusBodyEnd);
	});
	// 转发给业务 onCreate
	onCreateRef.current?.(e);
},
```

**改动后** · `apps/remote-plugins/src/components/design/RichEditor/index.tsx`（当前，约 L141–L159）

```tsx
// useEditor 的 onCreate 回调：编辑器创建后立即执行
onCreate: ({ editor: e }) => {
	// 闭包：把光标钉到正文末尾
	const focusBodyEnd = () => {
		// 编辑器已销毁则不操作
		if (e.isDestroyed) return;
		// 注释：有 title 节点，或显式 autofocus=end：都钉到正文末尾
		// 改动后：扩条件，autofocus==='end' 也命中（长文入口显式传 'end'）
		if (
			// 显式 autofocus='end'
			autofocus === 'end' ||
			// 或首位是 title
			e.state.doc.firstChild?.type.name === 'title'
		) {
			// 调用 focus('end')
			e.commands.focus('end');
		}
	};
	// 立即钉一次
	focusBodyEnd();
	// 注释：Title NodeView 挂载可能打乱选区，下一帧再钉到末尾
	// 双 rAF 重钉：保留旧版重钉逻辑
	requestAnimationFrame(() => {
		// 第二次钉
		focusBodyEnd();
		// 第三次钉
		requestAnimationFrame(focusBodyEnd);
	});
	// 转发给业务 onCreate
	onCreateRef.current?.(e);
},
```

**变更摘要**：`focusBodyEnd` 的命中条件从「仅首位是 title」扩为「首位是 title || 显式 `autofocus==='end'`」；双 rAF 重钉与 `onCreateRef` 转发保留不变。这样长文入口传 `autofocus="end"` 时也能稳定钉到正文末尾。

> 同文件还新增了 `imageResize` / `tableResizable` / `onBodyScroll` / `renderBody` 入参，并把它们透传到 `createExtensions` 与 `ScrollArea` / `renderBody` 渲染分支（详见 §4.5 与 `RichEditor` 组件签名）；末尾 `export { ... NoteTitleField } from './title'` 把抽出组件对外暴露给长文窗口复用。

### 4.7 `fileToDataUrl` MIME 归一

**对比范围**：`DOCX_SAFE` 常量、`bitmapToJpegDataUrl` / `fileToJpegDataUrl` / `fileToDataUrl` 三个函数。

**改动前** · `apps/remote-plugins/src/components/design/RichEditor/image/image.ts`（基线，约 L1–L11）

```ts
// 引入 Editor 类型（用于后续 insertImages，本段未直接用）
import type { Editor } from '@tiptap/react';

/** 注释：本地文件 → data URL（默认插图方式，兼容 Tauri WebView） */
export function fileToDataUrl(file: File): Promise<string> {
	// 旧版：直接用 FileReader.readAsDataURL，保留原始 MIME
	return new Promise((resolve, reject) => {
		// 新建 FileReader
		const reader = new FileReader();
		// 读完成 → resolve
		reader.onload = () => resolve(String(reader.result));
		// 读失败 → reject
		reader.onerror = () => reject(reader.error ?? new Error('read failed'));
		// 以 data URL 形式读
		reader.readAsDataURL(file);
	});
}
```

**改动后** · `apps/remote-plugins/src/components/design/RichEditor/image/image.ts`（当前，约 L1–L62）

```ts
// 引入 Editor 类型（用于后续 insertImages，本段未直接用）
import type { Editor } from '@tiptap/react';

// 新增：DOCX 导出可安全接纳的 MIME 白名单（jpeg/jpg/png/gif）
const DOCX_SAFE = new Set(['image/jpeg', 'image/jpg', 'image/png', 'image/gif']);

/** 注释：把浏览器能解码的图统一成 JPEG data URL（避免 webp/avif 线上导出失败） */
function bitmapToJpegDataUrl(
	// 输入：ImageBitmap 或 HTMLImageElement
	source: ImageBitmap | HTMLImageElement,
	// JPEG 质量，默认 0.9
	quality = 0.9,
): string {
	// 新建 canvas
	const canvas = document.createElement('canvas');
	// 宽度至少 1
	canvas.width = Math.max(1, source.width);
	// 高度至少 1
	canvas.height = Math.max(1, source.height);
	// 取 2d context
	const ctx = canvas.getContext('2d');
	// 取不到上下文抛错
	if (!ctx) throw new Error('canvas unsupported');
	// 把源图绘制到 canvas
	ctx.drawImage(source, 0, 0);
	// 输出为 JPEG data URL
	return canvas.toDataURL('image/jpeg', quality);
}

// 新增：把任意图片文件转 JPEG data URL
async function fileToJpegDataUrl(file: File): Promise<string> {
	// 优先走 createImageBitmap（更快、不进 DOM）
	if (typeof createImageBitmap === 'function') {
		// 解码为 ImageBitmap
		const bmp = await createImageBitmap(file);
		try {
			// 转 JPEG data URL
			return bitmapToJpegDataUrl(bmp);
		} finally {
			// 释放 bitmap 资源
			bmp.close();
		}
	}
	// 回退：用 ObjectURL + Image 解码
	const objectUrl = URL.createObjectURL(file);
	try {
		// 等 Image 加载完成
		const img = await new Promise<HTMLImageElement>((resolve, reject) => {
			// 新建 Image
			const el = new Image();
			// onload resolve
			el.onload = () => resolve(el);
			// onerror reject
			el.onerror = () => reject(new Error('image decode failed'));
			// 赋 src 触发加载
			el.src = objectUrl;
		});
		// 转 JPEG data URL
		return bitmapToJpegDataUrl(img);
	} finally {
		// 释放 ObjectURL
		URL.revokeObjectURL(objectUrl);
	}
}

/** 注释：本地文件 → data URL；非 jpeg/png/gif 先转 JPEG，兼容 DOCX 导出 */
export function fileToDataUrl(file: File): Promise<string> {
	// 取文件 MIME 小写
	const type = (file.type || '').toLowerCase();
	// 白名单 MIME 直接 readAsDataURL
	if (DOCX_SAFE.has(type)) {
		// 走原始 FileReader 通路
		return new Promise((resolve, reject) => {
			// 新建 FileReader
			const reader = new FileReader();
			// 读完成 resolve
			reader.onload = () => resolve(String(reader.result));
			// 读失败 reject
			reader.onerror = () => reject(reader.error ?? new Error('read failed'));
			// 以 data URL 读
			reader.readAsDataURL(file);
		});
	}
	// 非 DOCX_SAFE：尝试转 JPEG
	return fileToJpegDataUrl(file).catch(() => {
		// 注释：浏览器解不了（如部分 heic）时退回原始 data URL，交给服务端 sharp
		// 回退原始 FileReader
		return new Promise((resolve, reject) => {
			// 新建 FileReader
			const reader = new FileReader();
			// 读完成 resolve
			reader.onload = () => resolve(String(reader.result));
			// 读失败 reject
			reader.onerror = () => reject(reader.error ?? new Error('read failed'));
			// 以 data URL 读
			reader.readAsDataURL(file);
		});
	});
}
```

**变更摘要**：新增 `DOCX_SAFE` 集合 + `bitmapToJpegDataUrl` / `fileToJpegDataUrl` 两个内部函数；`fileToDataUrl` 改为：白名单 MIME（jpeg/jpg/png/gif）直接 `FileReader.readAsDataURL`，其余先 `createImageBitmap` → canvas → `toDataURL('image/jpeg', 0.9)`，解码失败回退原始 data URL 交服务端 sharp 处理。保证插图 data URL 能被后端 DOCX 导出接纳。

### 4.8 GapCursor CSS

**对比范围**：`.ProseMirror-gapcursor` 及其 `::after` 与 `@keyframes` 规则。改动前为空（纯新增）。

**改动后** · `apps/remote-plugins/src/components/design/RichEditor/styles.css`（当前，约 L251–L270，纯新增）

```css
/* 注释：块级图片前后的间隙光标（点进图前/图后） */
/* 选择器：编辑器正文区内 ProseMirror 的 gapcursor 容器 */
.rich-editor-body .tiptap .ProseMirror-gapcursor {
	/* 默认隐藏，由 PM 在 atom 旁控制可见性 */
	display: none;
	/* 不挡鼠标事件 */
	pointer-events: none;
	/* 绝对定位，避免撑高正文 */
	position: absolute;
}
/* gapcursor 的可见光标线 */
.rich-editor-body .tiptap .ProseMirror-gapcursor::after {
	/* 伪元素内容为空 */
	content: '';
	/* 块级显示 */
	display: block;
	/* 绝对定位 */
	position: absolute;
	/* 顶部偏移 -2px，与文字基线对齐 */
	top: -2px;
	/* 宽度 20px，模拟 caret */
	width: 20px;
	/* 顶部 1px 实线，颜色取主题文本色 */
	border-top: 1px solid var(--theme-textcolor, var(--foreground));
	/* 闪烁动画：1.1s 一步切换，无限循环 */
	animation: rich-editor-gapcursor-blink 1.1s steps(2, start) infinite;
}
/* 闪烁关键帧 */
@keyframes rich-editor-gapcursor-blink {
	/* 终态：隐藏 */
	to {
		/* 隐藏光标线 */
		visibility: hidden;
	}
}
```

**变更摘要**：纯新增。为正文内块级图片前后的 `GapCursor` 提供视觉反馈——顶部 1px 闪烁细线，颜色随主题文本色，避免用户误以为无法输入。

### 4.9 `LearningNotesApp` mountEditor 延迟挂载

**对比范围**：`LearningNotesApp` 组件全函数。该 diff 较大（-261/+163），下面分四组关键改动展示，未改动段落用对称 `// ...` 省略。

#### 4.9.1 组件状态声明（新增 pagedSaveRef / readyKey / mountEditor）

**改动前** · `apps/remote-plugins/src/views/learning-notes/index.tsx`（基线，约 L67–L80）

```tsx
// 组件签名：接收宿主桥 api
function LearningNotesApp({ api }: HostBridgeProps) {
	// 取 learningNotesStore
	const { learningNotesStore: store } = useStore();
	// 取 i18n
	const { t, locale } = useI18n();
	// 同步宿主 locale
	useHostLocale(api);

	// 编辑器实例 ref
	const editorRef = useRef<Editor | null>(null);
	// 保存中标志 ref（给全局快捷键读最新值）
	const savingRef = useRef(false);
	// 当前预览 ref（给全局快捷键读最新值）
	const previewRef = useRef(store.preview);
	// 同步 saving
	savingRef.current = store.saving;
	// 同步 preview
	previewRef.current = store.preview;

	// 列表滚动 viewport ref
	const scrollViewportRef = useRef<HTMLDivElement>(null);
	// 当前激活列表项 ref
	const activeItemRef = useRef<HTMLDivElement>(null);
	// 滚动模式：底/顶/当前
	const [scrollMode, setScrollMode] = useState<NoteScrollMode>('bottom');
	// 滚动边缘状态
	const [scrollEdge, setScrollEdge] = useState<'top' | 'bottom' | null>(null);
```

**改动后** · `apps/remote-plugins/src/views/learning-notes/index.tsx`（当前，约 L67–L79）

```tsx
// 组件签名：接收宿主桥 api
function LearningNotesApp({ api }: HostBridgeProps) {
	// 取 learningNotesStore
	const { learningNotesStore: store } = useStore();
	// 取 i18n
	const { t, locale } = useI18n();
	// 同步宿主 locale
	useHostLocale(api);

	// 编辑器实例 ref
	const editorRef = useRef<Editor | null>(null);
	// 新增：长文分页保存 API ref（LargeNoteEditor 提供 getTitle/getText/getHTML）
	const pagedSaveRef = useRef<LargeNoteSaveApi | null>(null);
	// 保存中标志 ref
	const savingRef = useRef(false);
	// 当前预览 ref
	const previewRef = useRef(store.preview);
	// 新增：编辑器 ready 标记，对应 editorKey，用于显示/隐藏 Loading 遮罩
	const [readyKey, setReadyKey] = useState<string | null>(null);
	// 新增：是否挂载编辑器（延迟一帧再挂，让 Loading 先画出来）
	const [mountEditor, setMountEditor] = useState(false);
	// 同步 saving
	savingRef.current = store.saving;
	// 同步 preview
	previewRef.current = store.preview;
```

**变更摘要**：移除列表滚动相关 ref/state（已下沉到 `NotesListPanel`）；新增 `pagedSaveRef`（长文保存 API）、`readyKey`（编辑器就绪标记）、`mountEditor`（延迟挂载开关）。

#### 4.9.2 `store.bind` 透传 `downloadBlob`

**改动前** · `apps/remote-plugins/src/views/learning-notes/index.tsx`（基线，约 L88–L91）

```tsx
// 绑定 store 与宿主 http、toast、t
useEffect(() => {
	// 旧版：未透传 downloadBlob，无法走宿主下载
	store.bind(api.http, toast, t);
	// 拉取列表
	void store.refreshList();
	// 依赖：http、store、toast、t
}, [api.http, store, toast, t]);
```

**改动后** · `apps/remote-plugins/src/views/learning-notes/index.tsx`（当前，约 L88–L91）

```tsx
// 绑定 store 与宿主 http、toast、t、downloadBlob
useEffect(() => {
	// 改动后：透传 api.ui?.downloadBlob，供 DOCX 导出走宿主下载
	store.bind(api.http, toast, t, api.ui?.downloadBlob);
	// 拉取列表
	void store.refreshList();
	// 依赖：http、downloadBlob、store、toast、t
}, [api.http, api.ui?.downloadBlob, store, toast, t]);
```

**变更摘要**：`store.bind` 多传一个 `api.ui?.downloadBlob`，依赖列表对应补齐，用于 DOCX 导出走宿主桥下载。

#### 4.9.3 `onSave` + `previewHeaderExtra`（长文保存 + 导出按钮）

**改动前** · `apps/remote-plugins/src/views/learning-notes/index.tsx`（基线，约 L174–L185 + 预览头部内联按钮）

```tsx
// onSave：保存当前编辑器内容
const onSave = useCallback(async () => {
	// 取编辑器实例
	const editor = editorRef.current;
	// 已销毁则不处理
	if (!editor || editor.isDestroyed) return;
	// 旧版：仅走 editor.getHTML/getText
	await store.saveNote({
		// 标题取自 doc 首位 title
		title: getDocTitleText(editor.state.doc).trim(),
		// 正文按段分隔
		text: editor.getText({ blockSeparator: '\n\n' }).trim(),
		// HTML
		html: editor.getHTML(),
	});
	// 依赖 store
}, [store]);

// ...（未改动：onKeyDown / listToggleBtn / toolbarExtra）

// 旧版：预览头部按钮内联在 NotePreview 的 headerExtra 里，无导出按钮
// （此处省略内联实现，改动后抽到 previewHeaderExtra useMemo）
```

**改动后** · `apps/remote-plugins/src/views/learning-notes/index.tsx`（当前，约 L93–L110 + L165–L210）

```tsx
// onSave：保存当前编辑器内容（普通 / 长文两条路径）
const onSave = useCallback(async () => {
	// 取长文分页保存 API
	const paged = pagedSaveRef.current;
	// 长文路径
	if (paged) {
		// 走分页 API 取 title/text/html
		await store.saveNote({
			// 标题
			title: paged.getTitle(),
			// 纯文本
			text: paged.getText(),
			// HTML
			html: paged.getHTML(),
		});
		// 长文路径结束
		return;
	}
	// 普通路径：取 TipTap 编辑器
	const editor = editorRef.current;
	// 已销毁则不处理
	if (!editor || editor.isDestroyed) return;
	// 走 editor.getHTML/getText
	await store.saveNote({
		// 标题取自 doc 首位 title
		title: getDocTitleText(editor.state.doc).trim(),
		// 正文按段分隔
		text: editor.getText({ blockSeparator: '\n\n' }).trim(),
		// HTML
		html: editor.getHTML(),
	});
	// 依赖 store
}, [store]);

// ...（未改动：onKeyDown / listToggleBtn / toolbarExtra）

// 新增：预览头部按钮 useMemo，含导出 DOCX 入口
const previewHeaderExtra = useMemo(
	// 返回按钮组
	() => (
		// Fragment 包裹
		<>
			// 新建按钮
			<Btn title={t('learningNotes.new')} onClick={() => store.openNew()}>
				// 新建图标
				<FilePenLine size={15} />
			</Btn>
			// 编辑按钮
			<Btn
				// 标题
				title={t('learningNotes.edit')}
				// 加载中禁用
				disabled={store.loadingDetail}
				// 点击进入编辑
				onClick={() => {
					// 有预览才编辑
					if (store.preview) store.openEdit(store.preview);
				}}
			>
				// 编辑图标
				<SquarePen size={15} />
			</Btn>
			// 删除按钮
			<Btn
				// 标题
				title={t('learningNotes.delete')}
				// 点击请求删除
				onClick={() => {
					// 有预览才删
					if (store.preview) store.requestDelete(store.preview.id);
				}}
			>
				// 删除图标
				<Trash2 size={15} />
			</Btn>
			// 新增：导出 DOCX 按钮
			<Btn
				// 标题：导出中 / 默认
				title={
					// 导出中显示 exportingDocx
					store.exportingDocx
						? t('learningNotes.exportingDocx')
						: t('learningNotes.exportDocx')
				}
				// 导出中或加载中禁用
				disabled={store.exportingDocx || store.loadingDetail}
				// 点击触发导出
				onClick={() => void store.exportPreviewDocx()}
			>
				// 下载图标
				<FileDown size={15} />
			</Btn>
			// 列表切换按钮
			{listToggleBtn()}
		</>
	),
	// 依赖：listToggleBtn、store 及若干状态、t
	[
		// listToggleBtn
		listToggleBtn,
		// store
		store,
		// 导出中状态
		store.exportingDocx,
		// 加载详情状态
		store.loadingDetail,
		// 当前预览
		store.preview,
		// t
		t,
	],
);
```

**变更摘要**：`onSave` 增加 `pagedSaveRef` 长文保存分支；新增 `previewHeaderExtra` useMemo，把预览头部的「新建/编辑/删除/导出 DOCX/列表切换」按钮抽出来复用，避免普通预览与 windowed 预览重复。

#### 4.9.4 `editorKey` / `useLarge` / `mountEditor` effect + 渲染分支

**改动前** · `apps/remote-plugins/src/views/learning-notes/index.tsx`（基线，约 L290–L340 摘录）

```tsx
// 旧版：直接渲染 RichEditor，无延迟挂载、无长文分支
<div className="border-theme/10 flex h-full min-h-0 min-w-0 flex-col overflow-hidden">
	// 编辑器容器
	<div
		className={cn(
			// 占满剩余空间
			'flex h-full min-h-0 flex-1 flex-col overflow-hidden',
			// 预览时隐藏编辑器
			store.preview && 'hidden',
		)}
	>
		// 直接挂 RichEditor
		<RichEditor
			// key 随 editorSeed + locale 变化
			key={`${store.editorSeed}:${locale}`}
			// 默认内容
			defaultContent={store.editorInitial}
			// autofocus 钉文末
			autofocus="end"
			// placeholder
			placeholder={t('learningNotes.placeholder')}
			// 编辑器文案
			locale={editorLocale}
			// 不显示字数
			showCharCount={false}
			// onCreate 拿到 editor 实例
			onCreate={(e) => {
				// 存 ref
				editorRef.current = e;
			}}
			// 外层样式
			className="flex h-full min-h-0 flex-1 flex-col overflow-hidden"
			// 编辑器样式
			editorClassName="min-h-[6rem]"
			// 工具栏尾部
			toolbarExtra={toolbarExtra}
		/>
	</div>
	// 预览分支：旧版内联按钮，无 windowed 预览
	{store.preview ? (
		// 加载中
		store.loadingDetail ? (
			// Loading 居中
			<div className="flex flex-1 flex-col items-center justify-center py-6 text-center text-sm text-textcolor/60">
				// Loading 组件
				<Loading />
			</div>
		) : (
			// NotePreview 内联 headerExtra
			<NotePreview
				// 标题
				title={store.preview.title}
				// HTML
				html={store.preview.html}
				// 头部按钮内联
				headerExtra={
					// Fragment
					<>
						// ...（新建/编辑/删除/列表切换，内联实现，无导出）
					</>
				}
			/>
		)
	) : null}
</div>
```

**改动后** · `apps/remote-plugins/src/views/learning-notes/index.tsx`（当前，约 L212–L337 摘录）

```tsx
// 取编辑器文案
const editorLocale = useMemo(() => richEditorLocaleOf(locale), [locale]);
// 编辑器 key：editorSeed + locale
const editorKey = `${store.editorSeed}:${locale}`;
// 编辑器是否就绪：readyKey 与 editorKey 相等
const editorReady = readyKey === editorKey;
// 是否走长文编辑器：按 editorInitial HTML 大小判断
const useLarge = isLargeNoteHtml(store.editorInitial);

// 注释：先画 Loading，下一帧再挂 TipTap，避免长文解析时连遮罩都刷不出来
// 延迟挂载 effect
useEffect(() => {
	// 预览模式下不挂编辑器
	if (store.preview) {
		// 重置 mountEditor
		setMountEditor(false);
		// 直接返回
		return;
	}
	// 先置 false，画 Loading
	setMountEditor(false);
	// 清空长文保存 API
	pagedSaveRef.current = null;
	// 下一帧置 true，挂 TipTap
	const id = requestAnimationFrame(() => setMountEditor(true));
	// 清理：取消 rAF
	return () => cancelAnimationFrame(id);
	// 依赖：editorKey、store.preview
}, [editorKey, store.preview]);

// ...（未改动：return 起始的容器、Confirm、ResizablePanelGroup 起始）

// 编辑器 / 预览根容器：相对定位，承载 Loading 遮罩
<div className="border-theme/10 relative flex h-full min-h-0 min-w-0 flex-col overflow-hidden">
	// 非预览：编辑器分支
	{!store.preview ? (
		// Fragment
		<>
			// 仅在 mountEditor 为 true 时挂编辑器
			{mountEditor ? (
				// 长文优先：useLarge 且 editorInitial 是字符串
				useLarge && typeof store.editorInitial === 'string' ? (
					// 长文编辑器
					<LargeNoteEditor
						// key
						key={editorKey}
						// 默认内容
						defaultContent={store.editorInitial}
						// placeholder
						placeholder={t('learningNotes.placeholder')}
						// 文案
						locale={editorLocale}
						// 就绪回调：拿到 editor + 保存 API
						onReady={(e, save) => {
							// 存编辑器实例
							editorRef.current = e;
							// 存分页保存 API
							pagedSaveRef.current = save;
							// 标记就绪
							setReadyKey(editorKey);
						}}
						// 外层样式
						className="flex h-full min-h-0 flex-1 flex-col overflow-hidden"
						// 编辑器样式
						editorClassName="min-h-[6rem]"
						// 工具栏尾部
						toolbarExtra={toolbarExtra}
					/>
				) : (
					// 普通编辑器
					<RichEditor
						// key
						key={editorKey}
						// 默认内容
						defaultContent={store.editorInitial}
						// autofocus 钉文末
						autofocus="end"
						// placeholder
						placeholder={t('learningNotes.placeholder')}
						// 文案
						locale={editorLocale}
						// 不显示字数
						showCharCount={false}
						// onCreate：拿到 editor，清空 pagedSaveRef，标记就绪
						onCreate={(e) => {
							// 存编辑器实例
							editorRef.current = e;
							// 普通编辑器无分页保存 API
							pagedSaveRef.current = null;
							// 标记就绪
							setReadyKey(editorKey);
						}}
						// 外层样式
						className="flex h-full min-h-0 flex-1 flex-col overflow-hidden"
						// 编辑器样式
						editorClassName="min-h-[6rem]"
						// 工具栏尾部
						toolbarExtra={toolbarExtra}
					/>
				)
			) : null}
			// 未就绪时显示 Loading 遮罩
			{!editorReady ? (
				// 绝对定位遮罩
				<div className="bg-background/60 absolute inset-0 z-10 flex items-center justify-center">
					// Loading 组件
					<Loading />
				</div>
			) : null}
		</>
	) : (
		// 预览分支：相对定位 + contain 限制重排
		<div className="relative flex h-full min-h-0 flex-1 flex-col overflow-hidden contain-[layout_paint]">
			// 长文预览走 windowed body
			{isLargeNoteHtml(store.preview.html) ? (
				// NotePreview 接 children 模式
				<NotePreview
					// 标题
					title={store.preview.title}
					// 头部按钮（抽出的 useMemo）
					headerExtra={previewHeaderExtra}
					// 加载状态
					loading={store.loadingDetail}
				>
					// 虚拟滚动预览体
					<WindowedPreviewBody
						// key 随预览 id
						key={store.preview.id}
						// HTML
						html={store.preview.html}
					/>
				</NotePreview>
			) : (
				// 普通预览：html 直传
				<NotePreview
					// 标题
					title={store.preview.title}
					// HTML
					html={store.preview.html}
					// 头部按钮
					headerExtra={previewHeaderExtra}
					// 加载状态
					loading={store.loadingDetail}
				/>
			)}
			// 详情加载中遮罩
			{store.loadingDetail ? (
				// 绝对定位遮罩
				<div className="bg-background/60 absolute inset-0 z-10 flex items-center justify-center">
					// Loading 组件
					<Loading />
				</div>
			) : null}
		</div>
	)}
</div>
```

**变更摘要**：引入 `editorKey` / `editorReady` / `useLarge`，新增 `mountEditor` effect（先画 Loading、下一 rAF 再挂 TipTap）；编辑器分支按 `useLarge` 走 `LargeNoteEditor` 或 `RichEditor`，挂载与就绪分离（`mountEditor` 控制是否渲染、`editorReady` 控制遮罩显隐）；预览分支按 `isLargeNoteHtml` 切换 `WindowedPreviewBody` 与普通 `NotePreview`，统一复用 `previewHeaderExtra`；侧边栏列表整体替换为 `<NotesListPanel />` 子组件。

## 5. 兼容性与影响

- **GapCursor 行为**：正文里图片前后的 `GapCursor` 现在合法保留，不再被强拉到文末；空正文仍钉回首段。回归要点：图片前后输入文字、图片后按 Backspace、Cmd+A 全选。
- **空段删除**：`EmptyParagraphDelete` 仅在「空段首位 Backspace / 末位 Delete」时触发，不影响有内容的段落；`canRemoveBlock` 保证最少块数。回归要点：标题后空段、图片间空段、文档末尾空段。
- **autofocus='end'**：长文入口传 `autofocus="end"` 现在生效；普通入口若不传仍按 title 在首位判断。回归要点：新建笔记、切到长文笔记、切 locale。
- **插图 MIME**：webp/avif 等会先转 JPEG 再插入；jpeg/png/gif 仍走原始 data URL；解码失败回退原始 data URL。回归要点：粘贴 webp 截图、拖入 avif、上传 heic。
- **GapCursor CSS**：仅视觉新增，不影响选区逻辑。
- **延迟挂载**：列表切换 + 长文场景下，先看到 Loading 遮罩再看到编辑器；`editorReady` 用于控制遮罩显隐。回归要点：快速切换笔记、长文笔记编辑/预览切换、Cmd+S 在 ready 前触发。
- **导出 DOCX**：`previewHeaderExtra` 新增导出按钮，依赖 `store.exportingDocx` 与 `store.exportPreviewDocx`，以及宿主 `api.ui?.downloadBlob`。
- **未覆盖边角**：`LargeNoteEditor` / `WindowedPreviewBody` / `NotesListPanel` / `isLargeNoteHtml` / `LargeNoteSaveApi` 为本轮同期新增/抽取的辅助模块，本文未展开其内部实现，详见各自源码。

## 6. 相关源码路径

| 说明 | 路径 |
| ---- | ---- |
| GapCursor 修正 | `apps/remote-plugins/src/components/design/RichEditor/title/TitleNode.ts` |
| 标题外观组件（新增） | `apps/remote-plugins/src/components/design/RichEditor/title/NoteTitleField.tsx` |
| TitleView 退化为壳 | `apps/remote-plugins/src/components/design/RichEditor/title/Title.tsx` |
| 空段删除扩展（新增） | `apps/remote-plugins/src/components/design/RichEditor/extensions/EmptyParagraphDelete.ts` |
| 扩展注册与开关 | `apps/remote-plugins/src/components/design/RichEditor/extensions/index.ts` |
| autofocus='end' + onBodyScroll + renderBody | `apps/remote-plugins/src/components/design/RichEditor/index.tsx` |
| 插图 MIME 归一 | `apps/remote-plugins/src/components/design/RichEditor/image/image.ts` |
| GapCursor CSS | `apps/remote-plugins/src/components/design/RichEditor/styles.css` |
| 延迟挂载 + 长文分支 | `apps/remote-plugins/src/views/learning-notes/index.tsx` |
| RichEditorProps / CreateExtensionsOptions 类型 | `apps/remote-plugins/src/components/design/RichEditor/types.ts` |
| title 模块导出 | `apps/remote-plugins/src/components/design/RichEditor/title/index.ts` |

---

若与仓库最新源码不一致，以源码为准。
