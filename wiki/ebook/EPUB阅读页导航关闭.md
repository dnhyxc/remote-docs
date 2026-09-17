# EPUB 阅读页：分页翻页入口与浮层关闭

## 文档角色

**增量专题**：① **分页翻页** 模式下才在顶栏与右键菜单展示 **上一页/下一页**；② 点击阅读区正文（含 iframe）时 **统一关闭** 阅读设置、听书 **分句** 与 **倍速** 下拉；③ 目录抽屉标题文案统一为 **书籍目录**。

**姊妹文档**：[EPUB阅读器设置关闭.md](./EPUB阅读器设置关闭.md)（仅设置面板关闭，本轮扩展为听书菜单）、[EPUB阅读器Chrome对比度.md](./EPUB阅读器Chrome对比度.md)（chrome 字色与 Portal 背景）。

---

## 1. 背景与目标

### 1.1 问题

| 问题 | 说明 |
| ---- | ---- |
| 连续滚动仍显示顶栏翻页 | `pageFlow === 'scrolled'` 时翻页按钮无意义，易误导 |
| 听书分句/倍速点阅读区不关 | 原先仅 `epubSettingsOpen` 时关设置；听书 Dropdown 为 Portal，需受控 `open` + 阅读区 pointer |
| iframe 监听空窗 | 条件挂载 `onReaderPointerDown` 时，设置刚打开、监听未挂上，导致第一次点击无效 |

### 1.2 目标

- `pageFlow === 'paginated'` 才渲染顶栏 Chevron 与右键 prev/next。
- `onEpubReaderPointerDown` **常挂载**，用 ref 判断三种浮层是否打开再关闭。
- 听书条 `sentenceMenuOpen` / `rateMenuOpen` 受控于 `read.tsx`。
- i18n：`ebook.read.toc` → 「书籍目录」。

---

## 2. 改动范围

| 路径 | 变更要点 |
| ---- | -------- |
| `apps/frontend/src/views/ebook/read.tsx` | 受控听书菜单、统一 pointer 关闭、分页门控顶栏翻页、`showPageNav` |
| `apps/frontend/src/views/ebook/utils/epub/reader/buildEpubContextMenuItems.ts` | `showPageNav` 门控右键 prev/next |
| `apps/frontend/src/i18n/locales/zh-CN.ts`、`en-US.ts` | 目录标题文案 |
| `apps/frontend/src/views/ebook/components/listen/EpubListenPlayerBar.tsx` | 受控 open props（配合关闭逻辑） |

---

## 3. 实现思路

1. **分页门控**：`epubSettings.pageFlow === 'paginated'` 渲染顶栏按钮；`buildEpubContextMenuItems({ showPageNav: ... })` 控制右键项。
2. **统一关闭**：`closeReaderFloatingUi` 关设置 + 两个听书菜单；`onEpubReaderPointerDown` 读 ref 决定是否调用。
3. **常挂载 + ref**：避免 iframe 回调注册时序问题；与 [EPUB阅读器设置关闭.md](./EPUB阅读器设置关闭.md) 思路一致并扩展范围。

---

## 4. 关键代码对比与注释

### 4.1 `buildEpubContextMenuItems` 分页门控

**对比范围**：`showPageNav` 参数与 prev/next 菜单项条件块。

**改动前** · `apps/frontend/src/views/ebook/utils/epub/reader/buildEpubContextMenuItems.ts`（基线，约 L64–L82）

```typescript
// 无论翻页方式，始终 push 上一页、下一页与 sep-tools 分隔符
items.push({
	type: 'item',
	id: 'prev',
	label: t('ebook.read.prev'),
	shortcut: '←',
	onSelect: () => actionsRef.current?.prevPage(),
});
items.push({
	type: 'item',
	id: 'next',
	label: t('ebook.read.next'),
	shortcut: '→',
	onSelect: () => actionsRef.current?.nextPage(),
});
items.push({ type: 'separator', id: 'sep-tools' });
```

**改动后** · `apps/frontend/src/views/ebook/utils/epub/reader/buildEpubContextMenuItems.ts`（当前，约 L67–L88）

```typescript
// 仅分页翻页模式才展示上一页/下一页菜单项
if (showPageNav) {
	// 上一页菜单项
	items.push({
		type: 'item',
		id: 'prev',
		label: t('ebook.read.prev'),
		shortcut: '←',
		onSelect: () => actionsRef.current?.prevPage(),
	});
	// 下一页菜单项
	items.push({
		type: 'item',
		id: 'next',
		label: t('ebook.read.next'),
		shortcut: '→',
		onSelect: () => actionsRef.current?.nextPage(),
	});
	// 翻页项与工具项之间的分隔线
	items.push({ type: 'separator', id: 'sep-tools' });
	// 连续滚动且无选区时不插入多余分隔（有选区时 copy 块后仍需 sep-tools）
} else if (hasSelection) {
	items.push({ type: 'separator', id: 'sep-tools' });
}
```

**变更摘要**：新增 `showPageNav`；连续滚动时隐藏 prev/next，保留有选区时的分隔线结构。

---

### 4.2 `onEpubReaderPointerDown` 与听书菜单受控（`read.tsx`）

**对比范围**：浮层关闭 callback、pointer 处理、听书条受控 props（摘录）。

**改动前** · `apps/frontend/src/views/ebook/read.tsx`（基线）

```typescript
// 阅读区 host：仅设置打开时关闭设置
onPointerDown={() => {
	if (epubSettingsOpen) closeEpubSettings();
}}
// EpubPane：条件传递 pointer 回调
onReaderPointerDown={
	epubSettingsOpen ? closeEpubSettings : undefined
}
// 听书条：无 sentenceMenuOpen / rateMenuOpen 受控 props
```

**改动后** · `apps/frontend/src/views/ebook/read.tsx`（当前，约 L1257–L1272、L2243–L2288）

```typescript
// 关闭阅读设置 + 听书分句/倍速下拉
const closeReaderFloatingUi = useCallback(() => {
	closeEpubSettings();
	setListenSentenceMenuOpen(false);
	setListenRateMenuOpen(false);
}, [closeEpubSettings]);

// iframe 内 mousedown 不冒泡；监听常挂载，用 ref 判断是否需要关浮层
const onEpubReaderPointerDown = useCallback(() => {
	if (
		epubSettingsOpenRef.current ||
		listenSentenceMenuOpenRef.current ||
		listenRateMenuOpenRef.current
	) {
		closeReaderFloatingUi();
	}
}, [closeReaderFloatingUi]);

// 阅读区 host：始终绑定统一 pointer 处理
onPointerDown={onEpubReaderPointerDown}
// EpubPane：始终绑定（不再条件 undefined）
onReaderPointerDown={onEpubReaderPointerDown}

// 听书条：受控 open + chromeStyle
sentenceMenuOpen={listenSentenceMenuOpen}
onSentenceMenuOpenChange={setListenSentenceMenuOpen}
rateMenuOpen={listenRateMenuOpen}
onRateMenuOpenChange={setListenRateMenuOpen}
menuChromeStyle={epubSurfaceProps?.chromeStyle}
```

**变更摘要**：三种浮层统一关闭；pointer 监听常挂载；听书 Dropdown 改为受控以便阅读区点击关闭。

---

### 4.3 顶栏翻页按钮门控（`read.tsx`）

**对比范围**：顶栏 Chevron 按钮 JSX。

**改动前** · `apps/frontend/src/views/ebook/read.tsx`（基线）

```typescript
// 顶栏始终渲染上一页、下一页 Tooltip+Button
<Tooltip content={t('ebook.read.prev')}>
	<Button ... onClick={() => epubNavRef.current?.prev()} />
</Tooltip>
<Tooltip content={t('ebook.read.next')}>
	<Button ... onClick={() => epubNavRef.current?.next()} />
</Tooltip>
```

**改动后** · `apps/frontend/src/views/ebook/read.tsx`（当前，约 L1990–L2033）

```typescript
// 仅分页翻页模式渲染顶栏上一页/下一页
{epubSettings.pageFlow === 'paginated' ? (
	<>
		<Tooltip content={t('ebook.read.prev')}>
			<Button ... onClick={() => epubNavRef.current?.prev()} />
		</Tooltip>
		<Tooltip content={t('ebook.read.next')}>
			<Button ... onClick={() => epubNavRef.current?.next()} />
		</Tooltip>
	</>
) : null}
```

**变更摘要**：连续滚动模式下顶栏不再显示 epub 翻页按钮。

---

## 5. 兼容性与回归

- **键盘 ↑/←/↓/→**：行为未改（仍由既有 keydown 处理）。
- **PDF 顶栏翻页**：不受 `epubSettings.pageFlow` 影响（EPUB 专用设置）。
- **回归**：分页/连续各测顶栏与右键菜单；听书打开分句或倍速后点击正文应关闭；设置面板仍应关闭。

---

## 6. 相关源码路径

| 说明 | 路径 |
| ---- | ---- |
| 阅读页入口 | `apps/frontend/src/views/ebook/read.tsx` |
| 右键菜单构建 | `apps/frontend/src/views/ebook/utils/epub/reader/buildEpubContextMenuItems.ts` |
| 听书条受控 open | `apps/frontend/src/views/ebook/components/listen/EpubListenPlayerBar.tsx` |
| 目录文案 | `apps/frontend/src/i18n/locales/zh-CN.ts`、`en-US.ts` |

---

若与仓库最新源码不一致，以源码为准。
