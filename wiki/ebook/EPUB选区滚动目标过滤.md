# EPUB 选区滚动目标过滤

**文档角色**：在 EPUB 阅读器滚动监听链路中增加「阅读区目标过滤」——只有真正来自 EPUB 阅读区的滚动事件才会触发 PopBar 收起与选区清除，避免问书侧栏流式贴底等非阅读区滚动误伤 EPUB 正文选区。

**延伸阅读**：[EPUB 选区：滚动时收起 PopBar 并清除选中样式](./EPUB选区滚动清除.md)、[MK 问书流式误清 EPUB 选区（影响点）](../impact/EPUB提问流式选区清除影响.md)

---

## 1. 背景与目标

### 1.1 用户可见问题

在 EPUB 阅读器内，用户对正文进行拖选（选中文字、弹出 PopBar 工具栏）后，打开右侧 MK 问书面板并发起流式提问。问书侧栏的 `ScrollArea` 在流式输出过程中会自动贴底滚动，该滚动事件通过 `document` 的 capture 阶段传播到 EPUB 的 `onScroll` 监听器，导致：

1. **PopBar 被误关闭**：`onChange(null)` 被调用，选区工具栏消失
2. **iframe 内选区被误清除**：`clearEpubTextSelection(rend)` 清空了用户在 EPUB 正文中的文字选区
3. **选区记忆丢失**：`rememberEpubPopBarSelectionRange(null)` 清除了选区锚点

用户表现为「选中的文字突然没了」、「划线/想法/问书按钮消失」，需要重新拖选。

### 1.2 目标

在保持「阅读区滚动 → 收起 PopBar + 清选区」这一既有契约不变的前提下，**排除非阅读区滚动事件**（侧栏贴底、想法面板滚动等），使其不再触发 PopBar 收起和选区清除逻辑。

---

## 2. 根因分析

`attachEpubSelectionPopBar` 中 `onScroll` 的注册方式为：

```typescript
addScrollListener(document);   // document capture 阶段
addScrollListener(window);     // window capture 阶段
```

以及：

```typescript
target.addEventListener('scroll', onScroll, { capture: true, passive: true });
```

由于 `capture: true`，**所有** scroll 事件（包括侧栏 `ScrollArea` 内的滚动）都会经过 `document` 捕获阶段并传递到 `onScroll`。改前的 `onScroll` 没有任何来源过滤，只要收到 scroll 事件就无条件执行：

1. 抑制 PopBar 重新弹出（`suppressEmitUntil`）
2. 隐藏 PopBar（`onChange(null)`）
3. 清除 iframe 内选区（`clearEpubTextSelection`）
4. 清除选区记忆（`rememberEpubPopBarSelectionRange(null)`）

---

## 3. 方案总览

### 3.1 核心决策

引入 `isEpubReaderScrollTarget(rend, target)` 函数，在 `onScroll` 入口处判断滚动事件的 `target` 是否属于 EPUB 阅读区。仅当 target 位于阅读区内部时，才继续执行后续的 PopBar 收起与选区清除逻辑；否则直接 `return`，不做任何处理。

判定逻辑覆盖 EPUB 的两种渲染模式：

| 模式 | 判定方式 |
|------|----------|
| 连续滚动模式（scrolled-doc） | `getEpubScrollContainer(rend)` 返回的容器元素及其所有子孙节点 |
| 分页模式（paginated） | `rend.getContents()` 返回的各 iframe 的 `window`、`document`、`documentElement`、`body`、`scrollingElement` 及其所有子孙节点 |

---

## 4. 关键代码对比与注释

### 4.1 `isEpubReaderScrollTarget`（epubSelectionToolbarAttach.ts）

**改动前**：无此函数。`onScroll` 直接接收事件并执行清除逻辑，不区分滚动来源。

**改动后** · `apps/frontend/src/views/ebook/utils/epub/reader/epubSelectionToolbarAttach.ts`（当前，约 L137–L178）

```typescript
// 判断滚动事件是否源自 EPUB 阅读区（连续滚容器 / iframe 文档），非阅读区滚动不应触发 PopBar 收起与选区清除
function isEpubReaderScrollTarget(
	// epub.js Rendition 实例，用于获取滚动容器和 iframe contents
	rend: Rendition,
	// scroll 事件的 target，即实际发生滚动的 DOM 节点或 Window
	target: EventTarget | null,
// 返回值：true 表示属于阅读区滚动，false 表示非阅读区滚动
): boolean {
	// target 为 null 时直接判定为非阅读区
	if (target == null) return false;
	// 获取 epub.js 连续滚动模式下的主滚动容器 HTMLElement
	const container = getEpubScrollContainer(rend);
	// 若容器存在，且 target 就是容器本身，或 target 是容器内的子节点（容器包含 target）
	if (
		container &&
		(target === container ||
			(target instanceof Node && container.contains(target)))
	) {
		// 属于连续滚动模式下的阅读区滚动
		return true;
	}
	// 分页模式下，rend.getContents() 返回 iframe contents（可能是数组也可能是单个）
	const raw = rend.getContents();
	// 统一为数组形式，兼容单个或多个 iframe 的情况
	const list: EpubIframeContents[] = Array.isArray(raw)
		? (raw as EpubIframeContents[])
		: raw
			? [raw as EpubIframeContents]
			: [];
	// 遍历所有 iframe contents，逐一检查 target 是否属于其中任何一个
	for (const contents of list) {
		// 使用 try/catch 防止 iframe 已卸载时访问属性抛出异常
		try {
			// 获取当前 iframe 的 document 对象
			const doc = contents.document;
			// 精确匹配 iframe 内常见的滚动相关根节点
			if (
				// target 是 iframe 的 window 对象
				target === contents.window ||
				// target 是 iframe 的 document 对象
				target === doc ||
				// target 是 iframe 的 documentElement（即 <html>）
				target === doc.documentElement ||
				// target 是 iframe 的 body
				target === doc.body ||
				// target 是 iframe 的 scrollingElement（通常等于 documentElement）
				target === doc.scrollingElement
			) {
				// target 命中 iframe 内的根节点，属于阅读区
				return true;
			}
			// 若 target 是 Node 实例，检查 doc 是否包含该节点（即 target 在 iframe DOM 树内）
			if (target instanceof Node && doc.contains(target)) return true;
		} catch {
			// iframe 已卸载或跨域无法访问时，忽略异常，继续检查下一个
		}
	}
	// 所有判定均未命中，说明 target 不在阅读区内部
	return false;
}
```

### 4.2 `onScroll` 事件处理改造（epubSelectionToolbarAttach.ts）

**改动前** · `apps/frontend/src/views/ebook/utils/epub/reader/epubSelectionToolbarAttach.ts`（基线，约 L296）

```typescript
// 滚动事件处理：隐藏 PopBar 并抑制重新弹出
const onScroll = () => {
	// 设置 350ms 抑制窗口，防止滚动过程中重新弹出 PopBar
	suppressEmitUntil = Date.now() + 350;
	// 划线等操作的抑制窗口内不误清
	if (shouldSuppressDismiss()) return;
	// 取消尚未执行的异步 emit（rAF 或 setTimeout）
	clearPendingEmit();
	// 通知外部隐藏 PopBar 工具栏
	onChange(null);
	// 拖选过程中的伴随滚动保留选区
	if (selecting) return;
	// 清除 iframe 内的原生选区高亮
	clearEpubTextSelection(rend);
	// 清除选区记忆锚点
	rememberEpubPopBarSelectionRange(null);
};
```

**改动后** · `apps/frontend/src/views/ebook/utils/epub/reader/epubSelectionToolbarAttach.ts`（当前，约 L354–L365）

```typescript
// 滚动事件处理：仅阅读区滚动才关 PopBar / 清选区；问书 ScrollArea 贴底滚动勿误伤 EPUB 选区
const onScroll = (e: Event) => {
	// 通过 isEpubReaderScrollTarget 过滤非阅读区滚动，侧栏/面板滚动直接跳过
	if (!isEpubReaderScrollTarget(rend, e.target)) return;
	// 设置 350ms 抑制窗口，防止滚动过程中重新弹出 PopBar
	suppressEmitUntil = Date.now() + 350;
	// 划线等操作的抑制窗口内不误清
	if (shouldSuppressDismiss()) return;
	// 取消尚未执行的异步 emit（rAF 或 setTimeout）
	clearPendingEmit();
	// 通知外部隐藏 PopBar 工具栏
	onChange(null);
	// 拖选过程中的伴随滚动保留选区
	if (selecting) return;
	// 清除 iframe 内的原生选区高亮
	clearEpubTextSelection(rend);
	// 清除选区记忆锚点
	rememberEpubPopBarSelectionRange(null);
};
```

**变更摘要**：

| 对比项 | 改前 | 改后 |
|--------|------|------|
| 函数签名 | `const onScroll = () =>` | `const onScroll = (e: Event) =>` |
| 过滤逻辑 | 无，所有 scroll 事件一律处理 | `isEpubReaderScrollTarget(rend, e.target)` 判定，非阅读区直接 `return` |
| 其余逻辑 | — | 完全不变，保持向后兼容 |

---

## 5. 兼容性与影响

### 5.1 行为变化

| 场景 | 改前行为 | 改后行为 |
|------|----------|----------|
| 用户滚 EPUB 正文（连续滚） | 关 PopBar + 清选区 | 关 PopBar + 清选区（不变） |
| 用户滚 EPUB 正文（分页翻页） | 关 PopBar + 清选区 | 关 PopBar + 清选区（不变） |
| 拖选过程中轻微滚动 | 保留选区（`selecting === true`） | 保留选区（不变） |
| 划线操作抑制窗口内滚动 | 不误清（`shouldSuppressDismiss`） | 不误清（不变） |
| 问书流式贴底滚动 | **误**关 PopBar + **误**清选区 | 跳过，不影响 EPUB 选区 |
| 想法侧栏滚动 | **误**关 PopBar + **误**清选区 | 跳过，不影响 EPUB 选区 |
| 其他非阅读区 DOM 滚动 | **误**关 PopBar + **误**清选区 | 跳过，不影响 EPUB 选区 |

### 5.2 判定边界说明

1. **连续滚动模式**：`getEpubScrollContainer(rend)` 访问 epub.js 私有 `manager.container`。若 `manager` 未初始化（如首次渲染前），返回 `null`，走分页 iframe 判定分支。
2. **分页模式**：`rend.getContents()` 返回 iframe 内容数组。对每个 iframe 检查精确节点匹配（window/document/documentElement/body/scrollingElement）和 `contains` 包含匹配。
3. **已卸载 iframe**：通过 `try/catch` 保护，iframe 卸载后访问其 `document` 属性可能抛出异常，捕获后跳过。
4. **`EventTarget` 类型兼容**：`scroll` 事件的 `target` 可能是 `Window`（`target instanceof Node` 为 `false`），也可能是 DOM 节点。函数同时处理两种情况。

### 5.3 未影响的路径

| 路径 | 说明 |
|------|------|
| `onRelocated` | 翻页/重定位独立路径，未加过滤，仍会清选区（符合预期：翻页 = 阅读区行为） |
| `clearEpubTextSelection` 导出与主动调用方 | 签名与「只清 iframe」语义未改 |
| `suppressEpubSelectionPopBarDismiss` / `shouldSuppressDismiss` | 逻辑未变 |
| `bindContents` 内各 iframe 事件绑定 | 未改 |
| PopBar 业务按钮（划线/想法/问书/复制/听当前/分享） | 未改 |

---

## 6. 相关源码路径

| 路径 | 说明 |
|------|------|
| `apps/frontend/src/views/ebook/utils/epub/reader/epubSelectionToolbarAttach.ts` | 主文件：`isEpubReaderScrollTarget`、`onScroll`、`attachEpubSelectionPopBar` |
| `apps/frontend/src/views/ebook/utils/epub/reader/epubScrolledNav.ts` | `getEpubScrollContainer`：获取连续滚动模式下的容器 |
| `apps/frontend/src/views/ebook/utils/epub/mark/epubRangeGeometry.ts` | `resolveSelectionCfiRange`、`normalizeSelectionRangeForEpub`、`getAccurateRangeLineClientRects` |
| `apps/frontend/src/views/ebook/utils/epub/listen/epubListenSegmentOverlay.ts` | `rememberEpubPopBarSelectionRange`：选区记忆存储 |
| `apps/frontend/src/views/ebook/read.tsx` | `setSelectionPopBar`：PopBar 状态管理与渲染 |

---

（若与仓库最新源码不一致，以源码为准）