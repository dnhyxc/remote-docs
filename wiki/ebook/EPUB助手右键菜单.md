# EPUB 阅读：右键菜单与智能助手分栏

> **文档角色**：2026-06-17 增量专题。全链路书架/阅读见 [电子书阅读书架.md](./电子书阅读书架.md)；EPUB 阅读设置见 [EPUB阅读器设置滚动.md](./EPUB阅读器设置滚动.md)。  
> **延伸阅读**：知识库助手交互与流式贴底见 [knowledge/知识库助手完成.md](../knowledge/知识库助手完成.md)（若存在）及 `KnowledgeAssistant.tsx`。

## 1. 背景与目标

EPUB 正文由 epub.js 渲染在 **iframe** 内，无法像普通 DOM 一样用 `QuickContextMenu` 包裹触发区。本轮为 EPUB 阅读页补齐：

1. **右键菜单**：对齐知识库 Monaco 编辑器的声明式菜单（`build*ContextMenuItems` + `actionsRef`）。
2. **智能助手**：非弹窗/抽屉，采用与知识库 **MarkdownEditor + KnowledgeAssistant** 相同的 **左右分栏 + 可拖拽** 布局。
3. **助手 UI / 流式滚动**：复用 `KnowledgeMessageBubble`、`useStickToBottomScroll`、置顶/置底 FAB、代码块浮动工具条等，与知识库助手保持一致。

**范围**：仅 **EPUB**；PDF 阅读页未接入右键菜单与助手。

## 2. 改动范围

| 路径 | 说明 |
|------|------|
| `apps/frontend/src/views/ebook/read.tsx` | 菜单状态、actionsRef、分栏编排、助手开关 |
| `apps/frontend/src/views/ebook/components/EpubPane.tsx` | 挂载 iframe 右键监听 |
| `apps/frontend/src/views/ebook/components/EpubReaderContextMenu.tsx` | 锚定鼠标位置的菜单 UI |
| `apps/frontend/src/views/ebook/components/EbookReadSplitLayout.tsx` | 左读右助分栏（ResizablePanelGroup） |
| `apps/frontend/src/views/ebook/components/EbookAssistant.tsx` | 电子书智能助手面板 |
| `apps/frontend/src/views/ebook/utils/epubContextMenuAttach.ts` | iframe `contextmenu` 拦截与坐标换算 |
| `apps/frontend/src/views/ebook/utils/buildEpubContextMenuItems.ts` | 菜单项构建 |
| `apps/frontend/src/views/knowledge/KnowledgeMessageBubble.tsx` | `onSaveToKnowledge` 改为可选（电子书不展示） |
| `apps/frontend/src/views/knowledge/KnowledgeAssistantEntryToolbar.tsx` | 新增 `showAssistantModeSwitch`（电子书隐藏 AI/RAG 切换） |
| `apps/frontend/src/i18n/locales/zh-CN.ts`、`en-US.ts` | 菜单与助手文案 |

## 3. 实现思路

### 3.1 右键菜单：iframe 与宿主双通道

- epub.js 章节加载时通过 `rend.hooks.content.register` 在每个 iframe `document` 上监听 `contextmenu`，`preventDefault` 后上报 **视口坐标** 与 **选区文本**。
- iframe 内 `clientX/Y` 需加上 `frameElement.getBoundingClientRect()` 偏移，才能在主文档层正确锚定菜单。
- 阅读区外层 `div` 另挂 `onHostContextMenu`，覆盖 iframe 未铺满的宿主空白（行为与 iframe 内一致）。
- 菜单 UI 使用 `DropdownMenu` 受控 `open` + 1×1px 固定锚点（Radix `ContextMenu` 对 programmatic open 类型支持较弱，故与 iframe 场景采用 Dropdown 锚定方案）。

### 3.2 菜单项：有选区 / 无选区

| 场景 | 主要项 |
|------|--------|
| **有选中文字** | 复制、AI 问书、全选 → 分隔 → 智能助手、翻页、目录、设置、返回书架 |
| **无选中** | 智能助手、翻页、目录、设置、返回书架 |

动作经 `contextActionsRef` 注入（与 Monaco `editorContextActionsRef` 同模式），避免菜单重建时闭包陈旧。

### 3.3 智能助手：分栏而非弹窗

- `EbookReadSplitLayout` 使用 `ResizablePanelGroup`：`assistantOpen === false` 时 `setLayout({ reader: 100, assistant: 0 })`，打开时恢复 `lastSplitLayoutRef`（默认约 58% / 42%）。
- **不在阅读顶栏** 增加助手入口（产品要求）；仅右键 **智能助手** / **AI 问书** 打开右栏。
- 助手 `documentKey` 为 `ebook:{bookId}`，走现有 `assistantStore.activateForDocument` / 持久化会话；发送时附加 `extraUserContentForModel` 提示当前书名语境。

### 3.4 与知识库助手对齐的 UI / 滚动

- 消息：`KnowledgeMessageBubble`（不传 `onSaveToKnowledge`，不显示「保存到知识库」）。
- 滚动：`streamScrollTick` 含 `thinkContent` 长度；`useStickToBottomScroll` + `idleFlushKey`；发送前 `enableStreamStickToBottom()`。
- 辅助：`ChatCodeFloatingToolbar`、`refreshScrollCornerFab` + 置顶/置底按钮、`KnowledgeAssistantEntryToolbar`（`showAssistantModeSwitch={false}`）。

## 4. 关键代码与注释

### 4.1 iframe 右键挂载

**来源**：`apps/frontend/src/views/ebook/utils/epubContextMenuAttach.ts`（约 L17–L74）

```typescript
/** 将 iframe 内坐标换算为主窗口 fixed 定位用的视口坐标 */
function toViewportPoint(e: MouseEvent, win: Window): { x: number; y: number } {
	const iframe = win.frameElement as HTMLIFrameElement | null;
	const rect = iframe?.getBoundingClientRect();
	return {
		x: rect ? e.clientX + rect.left : e.clientX,
		y: rect ? e.clientY + rect.top : e.clientY,
	};
}

export function attachEpubIframeContextMenu(
	rend: Rendition,
	onMenu: (payload: EpubReaderContextMenuPayload) => void,
): () => void {
	const cleanups = new Map<EpubIframeContents, () => void>();

	const bindContents = (contents: EpubIframeContents) => {
		// 每章 iframe 只绑定一次；destroy 时由返回的 detach 统一 removeListener
		const onCtx = (e: MouseEvent) => {
			e.preventDefault();
			e.stopPropagation();
			const selectedText = readSelectionText(contents.window);
			const { x, y } = toViewportPoint(e, contents.window);
			onMenu({ clientX: x, clientY: y, selectedText, /* selectAll / copy */ });
		};
		contents.document.addEventListener('contextmenu', onCtx);
		cleanups.set(contents, () =>
			contents.document.removeEventListener('contextmenu', onCtx),
		);
	};

	rend.hooks.content.register(bindContents);
	// ... 对已存在的 getContents() 补绑；返回 detach 清理 Map
}
```

### 4.2 菜单项构建（对齐 Monaco）

**来源**：`apps/frontend/src/views/ebook/utils/buildEpubContextMenuItems.ts`（约 L28–L65）

```typescript
/** 有选区时前置「复制 / AI 问书 / 全选」；无选区时从「智能助手」开始 */
export function buildEpubContextMenuItems({
	hasSelection,
	actionsRef,
	t,
}: BuildEpubContextMenuItemsInput): QuickContextMenuEntry[] {
	const items: QuickContextMenuEntry[] = [];

	if (hasSelection) {
		items.push({
			type: 'item',
			id: 'copy',
			label: t('ebook.read.contextMenu.copy'),
			shortcut: shortcutHintCtrlOrCmd('C'),
			onSelect: () => actionsRef.current?.copy(),
		});
		items.push({
			type: 'item',
			id: 'askSelection',
			label: t('ebook.read.contextMenu.askSelection'),
			onSelect: () => actionsRef.current?.askAboutSelection(),
		});
		// ... 全选、分隔线
	}

	items.push({
		type: 'item',
		id: 'assistant',
		label: t('ebook.read.contextMenu.assistant'),
		onSelect: () => actionsRef.current?.openAssistant(),
	});
	// ... 翻页、目录、设置、返回书架
	return items;
}
```

### 4.3 阅读页：actionsRef 与 AI 问书

**来源**：`apps/frontend/src/views/ebook/read.tsx`（约 L229–L318）

```typescript
/** 打开右栏助手；AI 问书时预填摘录模板 */
const openAssistantWithSelection = useCallback((selectedText: string) => {
	const quote = selectedText.trim();
	if (!quote) return;
	openAssistant(t('ebook.read.assistant.askSelectionDraft', { quote }));
}, [openAssistant, t]);

contextActionsRef.current = {
	copy: () => {
		const text = contextPayloadRef.current?.selectedText.trim();
		if (!text) return;
		void copyToClipboard(text);
	},
	openAssistant: () => openAssistant(),
	askAboutSelection: () => {
		openAssistantWithSelection(contextPayloadRef.current?.selectedText ?? '');
	},
	// ... openToc / prevPage / nextPage 等
};
```

### 4.4 左读右助分栏

**来源**：`apps/frontend/src/views/ebook/components/EbookReadSplitLayout.tsx`（约 L32–L51）

```typescript
/** 关闭助手时阅读区占满；打开时恢复用户上次拖拽比例 */
useEffect(() => {
	if (!assistantOpen) {
		panelGroupRef.current?.setLayout({ reader: 100, assistant: 0 });
		return;
	}
	panelGroupRef.current?.setLayout(lastSplitLayoutRef.current);
}, [assistantOpen]);

<ResizablePanelGroup
	groupRef={panelGroupRef}
	onLayoutChanged={(layout) => {
		if (assistantOpen) lastSplitLayoutRef.current = layout;
	}}
>
	<ResizablePanel id="reader" /* ... */>{children}</ResizablePanel>
	<ResizableHandle withHandle className={cn(!assistantOpen && 'opacity-0')} />
	<ResizablePanel id="assistant" /* ... */>
		<EbookAssistant active={assistantOpen} /* ... */ />
	</ResizablePanel>
</ResizablePanelGroup>
```

### 4.5 流式贴底（与 KnowledgeAssistant 同源）

**来源**：`apps/frontend/src/views/ebook/components/EbookAssistant.tsx`（约 L70–L104、L217–L234）

```typescript
/** 与知识库一致：末条消息的 content + thinkContent + isStreaming 组成 revision */
const streamScrollTick =
	lastMsg != null
		? `${aiMessages.length}:${lastMsg.chatId}:${lastMsg.content.length}:${lastMsg.thinkContent?.length ?? 0}:${lastMsg.isStreaming ? 1 : 0}`
		: String(aiMessages.length);

const { scrollViewportHandlers, enableStreamStickToBottom, /* ... */ } =
	useStickToBottomScroll({
		isStreaming: assistantStore.isStreaming,
		contentRevision: streamScrollTick,
		resetKey: `${documentKey}:session:${assistantStore.activeSessionId ?? 'none'}`,
		idleFlushKey: aiIdleFlushKey,
	});

const sendMessage = useCallback(async (content?: string) => {
	// ...
	enableStreamStickToBottom(); // 发送前恢复跟滚，与知识库 sendMessage 一致
	await assistantStore.sendMessage(text, {
		extraUserContentForModel: t('ebook.read.assistant.systemHint', { title: bookTitle }),
	});
}, [/* ... */]);
```

## 5. 兼容性与影响

| 项 | 说明 |
|----|------|
| **PDF** | 无右键助手菜单；行为不变 |
| **登录** | 助手发送需登录；未登录 Toast 与知识库一致 |
| **顶栏** |  intentionally 无助手按钮；仅右键入口 |
| **键盘** | 助手打开时 `keyboardNavEnabled={false}`，避免与输入/翻页冲突 |
| **会话** | `ebook:{bookId}` 作为 assistant 文档键；与知识库文章键空间隔离 |

## 6. 建议回归

1. EPUB 正文 iframe 内右键：无选区 / 有选区菜单项是否正确。
2. **AI 问书**：选中段落 → 右键 → 右栏打开且输入框含摘录模板。
3. 分栏拖拽后关闭再打开，宽度是否记忆。
4. 流式输出时长按滚动是否贴底；上滑后是否停止跟滚；置顶/置底 FAB 是否出现。
5. 助手打开时方向键不翻页；关闭后恢复翻页。

## 7. 相关源码路径

| 说明 | 路径 |
|------|------|
| 阅读页编排 | `apps/frontend/src/views/ebook/read.tsx` |
| iframe 右键 | `apps/frontend/src/views/ebook/utils/epubContextMenuAttach.ts` |
| 分栏布局 | `apps/frontend/src/views/ebook/components/EbookReadSplitLayout.tsx` |
| 助手面板 | `apps/frontend/src/views/ebook/components/EbookAssistant.tsx` |
| 知识库助手（对照） | `apps/frontend/src/views/knowledge/KnowledgeAssistant.tsx` |
| 贴底 Hook | `apps/frontend/src/hooks/useStickToBottomScroll.ts` |

若与仓库最新源码不一致，以源码为准。
