# EPUB 想法侧栏：引用段落保持视口可见

## 文档角色

**增量专题**：打开或关闭 **读书想法** 右侧分栏（列表 / 写想法 / 详情）时，左侧 EPUB 正文因分栏宽度变化会 **soft resize 重排**，原先选中的 **引用段落** 容易滚出当前屏幕；本轮在分栏布局稳定后按 **CFI 锚点** 对连续滚动容器做 **最小 scrollTop 修正**，使引用内容始终留在视口内。

> **2026-07 更新**：通用「当前阅读行」保持已改由 [EPUB视口定位.md](./EPUB视口定位.md) 在每次 `applyHostResize` 完成；本文档的 CFI scroll 仍适用于 **侧栏已开、宽度不变** 时切换引用（`ensureQuoteCfiInViewport`）。侧栏输入焦点见 [EPUB侧面板输入焦点.md](./EPUB侧面板输入焦点.md)。

**延伸阅读**：[EPUB视口定位.md](./EPUB视口定位.md)、[EPUB侧面板输入焦点.md](./EPUB侧面板输入焦点.md)、[EPUB想法侧面板.md](./EPUB想法侧面板.md)、[EPUB分屏软调整.md](./EPUB分屏软调整.md)、[EPUB阅读分屏.md](./EPUB阅读分屏.md)、[EPUB想法聚类桥接.md](./EPUB想法聚类桥接.md)。

---

## 1. 背景与目标

### 1.1 问题

- 左侧阅读区默认 **占满父元素**；唤起想法列表或写想法侧栏后，宽度缩至约 **58%**，`EpubPane` 触发 `softResizeEpubRendition`，正文重排。
- 用户刚拖选或点击下划线对应的 **引用段** 会 **上移或下移**，滚出当前屏，无法对照侧栏引用编辑。

### 1.2 目标

| 场景 | 期望 |
|------|------|
| 拖选 → 写想法 / 开列表 | 分栏展开后左侧引用段仍在屏内 |
| 点下划线开列表 | 同上 |
| 列表 ↔ 详情 / 关列表 | 关侧栏恢复全宽后引用段仍可见 |
| 性能与逻辑 | 仅 O(1) 改 `scrollTop`；不改想法/MK/PopBar 既有状态机 |

### 1.3 边界

- **仅 EPUB 连续滚动**：`getEpubScrollContainer` 有值时才滚动；分页模式 no-op。
- **仅想法侧栏开合**：不扩 MK 拖拽等路径；与 `notifyEbookSplitPanelResizeEnd` 对齐时序（晚于 `EpubPane.settleHostResize`）。

---

## 2. 改动范围

| 路径 | 说明 |
|------|------|
| `apps/frontend/src/views/ebook/utils/epubScrolledNav.ts` | 新增 `scrollEpubCfiIntoView`、内部 `readRangeViewportBounds` |
| `apps/frontend/src/views/ebook/read.tsx` | `thoughtQuoteAnchorCfiRef`、同步/滚动回调、分栏 resize 订阅、入口写入锚点 |

---

## 3. 实现思路

1. **锚点 CFI**：`thoughtQuoteAnchorCfiRef` 记录当前引用段 CFI；开侧栏时从 `thoughtDraft.cfiRange`、列表 `getThoughtClusterHighlightSubject` 或 `openCreateThought` / `openThoughtCluster` 同步写入；**关侧栏不清 ref**，以便恢复全宽后再滚一次。
2. **几何计算**：`resolveCfiDomRange` → Range `getBoundingClientRect`，叠加 iframe 偏移得到视口坐标；零宽高选区回退到 **caret 折叠点**。
3. **最小滚动**：相对 epub 滚动容器 `getBoundingClientRect`，上下各留 `QUOTE_VIEW_MARGIN_PX`（72px）；仅当超出时 `scrollTop += delta`。
4. **触发时机**：
   - 订阅 `subscribeEbookSplitPanelResizeEnd`（与 `EbookReadSplitLayout` 开合、拖拽松手同频）；
   - `thoughtPanelOpen` 及相关 state 变化时 **双 rAF** 再滚（覆盖布局动画与 soft resize 时序）。
5. **监听顺序**：`EpubPane` 先注册 `settleHostResize`，`read.tsx` 后注册滚动回调，保证 **先重排再校正 scroll**。

---

## 4. 关键代码对比与注释

### 4.1 `readRangeViewportBounds` 与 `scrollEpubCfiIntoView`（`epubScrolledNav.ts`）

**对比范围**：纯新增导出函数及内部辅助函数（基线文件中不存在）。

**改动前** · `apps/frontend/src/views/ebook/utils/epubScrolledNav.ts`（基线，约 L1–L29）

```typescript
// 基线文件在 scrollEdges 之后直接进入 attachEpubScrolledEdgeNav
// 无 readRangeViewportBounds、无 scrollEpubCfiIntoView、无 resolveCfiDomRange 引入
```

**改动后** · `apps/frontend/src/views/ebook/utils/epubScrolledNav.ts`（当前，约 L3–L79）

```typescript
// 从 epubRangeGeometry 引入 CFI → DOM Range 解析
import { resolveCfiDomRange } from './epubRangeGeometry';

// 滚到章节顶/底判定用的像素阈值（既有常量，未改）
const SCROLL_EDGE_PX = 16;
// 分栏开合后保持引用段落在视口内的上下留白（像素）
const QUOTE_VIEW_MARGIN_PX = 72;
// 章节边缘衔接冷却时间（既有常量，未改）
const EDGE_COOLDOWN_MS = 320;

// ...（EpubManager 类型、getEpubScrollContainer、getManager、scrollEdges 未改动）

// 将 Range 在页面视口中的 top/bottom 转为相对主文档坐标（含 iframe 偏移）
function readRangeViewportBounds(range: Range, iframe: HTMLIFrameElement) {
	// 取选区/锚点在 iframe 文档内的包围盒
	const rect = range.getBoundingClientRect();
	// 有宽或高时用完整矩形
	if (rect.width > 0 || rect.height > 0) {
		// iframe 相对视口的位置
		const iframeRect = iframe.getBoundingClientRect();
		// 合成主页面坐标系下的 top
		return {
			top: iframeRect.top + rect.top,
			bottom: iframeRect.top + rect.bottom,
		};
	}
	// 零面积选区：折叠到起点 caret
	const caret = range.cloneRange();
	// 折叠到 range 起始边界
	caret.collapse(true);
	// caret 在 iframe 内的矩形
	const caretRect = caret.getBoundingClientRect();
	// iframe 外框
	const iframeRect = iframe.getBoundingClientRect();
	// caret 顶边合成到主视口
	const y = iframeRect.top + caretRect.top;
	// 至少 1px 高，避免 bottom === top 无法判断
	return { top: y, bottom: y + Math.max(caretRect.height, 1) };
}

/**
 * 连续滚动模式下，将 CFI 对应正文滚入 epub 滚动容器视口（分栏宽度变化后防引用段被挤出屏外）。
 * ponytail: 仅改 scrollTop，O(1)；分页模式无滚动容器时直接返回 false。
 */
export function scrollEpubCfiIntoView(
	rend: Rendition,
	cfiRange: string,
): boolean {
	// 去空白，空串直接失败
	const key = cfiRange.trim();
	if (!key) return false;
	// CFI 解析为 DOM Range
	const range = resolveCfiDomRange(rend, key);
	if (!range) return false;
	// epub.js 连续滚动实际滚动容器
	const container = getEpubScrollContainer(rend);
	if (!container) return false;
	// iframe 内 window
	const win = range.startContainer.ownerDocument?.defaultView;
	// 承载章节的 iframe 元素
	const iframe = win?.frameElement as HTMLIFrameElement | null;
	if (!iframe) return false;

	// 引用段在视口中的上下边界
	const { top, bottom } = readRangeViewportBounds(range, iframe);
	// 滚动容器相对视口的外框
	const containerRect = container.getBoundingClientRect();
	// 待应用的 scrollTop 增量，0 表示已在安全区内
	let delta = 0;
	// 上沿超出（含上边距）→ 向上滚
	if (top < containerRect.top + QUOTE_VIEW_MARGIN_PX) {
		delta = top - containerRect.top - QUOTE_VIEW_MARGIN_PX;
	// 下沿超出（含下边距）→ 向下滚
	} else if (bottom > containerRect.bottom - QUOTE_VIEW_MARGIN_PX) {
		delta = bottom - containerRect.bottom + QUOTE_VIEW_MARGIN_PX;
	}
	// 已在视口内，无需滚动
	if (delta === 0) return true;
	// 最小修正，不触发额外布局
	container.scrollTop += delta;
	return true;
}
```

**变更摘要**：新增 CFI 视口校正工具；分页或无滚动容器时返回 `false`；刻意只改 `scrollTop` 避免全页 `scrollIntoView` 副作用。

---

### 4.2 `thoughtQuoteAnchorCfiRef` 与滚动编排（`read.tsx`）

**对比范围**：ref 声明 + `syncThoughtQuoteAnchorCfi` / `scrollThoughtQuoteAnchorIntoView` + 两个 `useEffect`（完整符号）。

**改动前** · `apps/frontend/src/views/ebook/read.tsx`（基线，约 L198–L200、L1175–L1183）

```typescript
// returnToListClusterRef 之后无 thoughtQuoteAnchorCfiRef
const returnToListClusterRef = useRef<EbookThoughtClickCluster | null>(null);
const [thoughtDraft, setThoughtDraft] = useState({
	// ...（thoughtDraft 初始字段未改动）
});

// ...（中间大量逻辑未改动）

// 旧版：列表开或详情开即视为想法面板开，无 cluster 判空
const thoughtPanelOpen = thoughtListOpen || thoughtDialogOpen;
// 旧版：侧栏开 = MK 或想法面板，无独立 sidePanelOpen 推导块
const sidePanelOpen = assistantOpen || thoughtPanelOpen;

// 旧版：无 syncThoughtQuoteAnchorCfi、无 scrollThoughtQuoteAnchorIntoView、无 resize 订阅 effect

const closeThoughtDialog = useCallback(() => {
	setThoughtDialogOpen(false);
}, []);
```

**改动后** · `apps/frontend/src/views/ebook/read.tsx`（当前，约 L202–L204、L1233–L1293）

```typescript
// 从列表返回写想法时暂存的 cluster 快照（既有）
const returnToListClusterRef = useRef<EbookThoughtClickCluster | null>(null);
// 想法侧栏开合时保持左侧引用段落在视口内（分栏 resize 后回滚）
const thoughtQuoteAnchorCfiRef = useRef<string | undefined>(undefined);
const [thoughtDraft, setThoughtDraft] = useState({
	// ...（未改动）
});

// ...（中间逻辑未改动）

// 想法面板开：写/编详情弹层，或列表且 cluster 已就绪
const thoughtPanelOpen =
	thoughtDialogOpen || (thoughtListOpen && thoughtListCluster != null);

// 侧栏开时把当前引用 CFI 写入锚点 ref
const syncThoughtQuoteAnchorCfi = useCallback(() => {
	// 详情/写想法：以 draft 的 cfiRange 为准
	if (thoughtDialogOpen && thoughtDraft.cfiRange?.trim()) {
		thoughtQuoteAnchorCfiRef.current = thoughtDraft.cfiRange.trim();
		return;
	}
	// 列表模式：按 cluster 聚合规则取引用区 CFI
	if (thoughtListOpen && thoughtListCluster) {
		const rend = epubNavRef.current?.getRendition() ?? undefined;
		const { cfiRange } = getThoughtClusterHighlightSubject(
			thoughtListCluster,
			rend,
		);
		if (cfiRange.trim()) {
			thoughtQuoteAnchorCfiRef.current = cfiRange.trim();
		}
	}
}, [
	thoughtDialogOpen,
	thoughtDraft.cfiRange,
	thoughtListOpen,
	thoughtListCluster,
	epubNavReady,
]);

// 读取锚点并对 EPUB 连续滚动容器做视口校正
const scrollThoughtQuoteAnchorIntoView = useCallback(() => {
	if (book?.fmt !== 'epub') return;
	const cfi = thoughtQuoteAnchorCfiRef.current;
	if (!cfi) return;
	const rend = epubNavRef.current?.getRendition();
	if (!rend) return;
	scrollEpubCfiIntoView(rend, cfi);
}, [book?.fmt, epubNavReady]);

// 分栏布局稳定后（开合/拖拽结束）再滚一次
useEffect(() => {
	if (book?.fmt !== 'epub') return;
	return subscribeEbookSplitPanelResizeEnd(scrollThoughtQuoteAnchorIntoView);
}, [book?.fmt, scrollThoughtQuoteAnchorIntoView]);

// 想法面板开闭或 cluster/draft CFI 变化：同步锚点 + 双 rAF 滚动
useEffect(() => {
	if (book?.fmt !== 'epub') return;
	if (thoughtPanelOpen) syncThoughtQuoteAnchorCfi();
	let raf2 = 0;
	const raf1 = requestAnimationFrame(() => {
		raf2 = requestAnimationFrame(scrollThoughtQuoteAnchorIntoView);
	});
	return () => {
		cancelAnimationFrame(raf1);
		cancelAnimationFrame(raf2);
	};
}, [
	book?.fmt,
	thoughtPanelOpen,
	thoughtDialogOpen,
	thoughtListOpen,
	thoughtListCluster,
	thoughtDraft.cfiRange,
	syncThoughtQuoteAnchorCfi,
	scrollThoughtQuoteAnchorIntoView,
]);

const closeThoughtDialog = useCallback(() => {
	setThoughtDialogOpen(false);
}, []);
```

**变更摘要**：引入锚点 ref 与双通道触发（resize 结束 + 面板 state 双 rAF）；关面板时 **保留** ref 以便全宽恢复后仍校正；`thoughtPanelOpen` 与 cluster 对齐避免空列表占位（与 [EPUB阅读分屏.md](./EPUB阅读分屏.md) 一致）。

---

### 4.3 `openCreateThought` 写入锚点（`read.tsx`）

**对比范围**：`openCreateThought` 全函数。

**改动前** · `apps/frontend/src/views/ebook/read.tsx`（基线，约 L683–L716）

```typescript
const openCreateThought = useCallback(
	(quote: string, cfiRange?: string) => {
		const trimmed = quote.trim();
		if (!trimmed) return;
		if (!cfiRange) {
			Toast({
				type: 'error',
				title: t('ebook.read.thought.cfiFailed'),
			});
			return;
		}
		setAssistantOpen(false);
		setSelectionPopBar(null);
		selectionPopBarRef.current = null;
		if (thoughtListClusterRef.current) {
			returnToListClusterRef.current = thoughtListClusterRef.current;
		}
		setThoughtListOpen(false);
		setThoughtDraft({
			id: '',
			quote: trimmed,
			cfiRange,
			content: '',
			username: '',
			avatar: '',
			createdAt: '',
			updatedAt: '',
		});
		setThoughtDialogMode('create');
		setThoughtDialogOpen(true);
		setThoughtComposeScrollKey((key) => key + 1);
	},
	[t],
);
```

**改动后** · `apps/frontend/src/views/ebook/read.tsx`（当前，约 L701–L735）

```typescript
const openCreateThought = useCallback(
	(quote: string, cfiRange?: string) => {
		const trimmed = quote.trim();
		if (!trimmed) return;
		if (!cfiRange) {
			Toast({
				type: 'error',
				title: t('ebook.read.thought.cfiFailed'),
			});
			return;
		}
		// 打开写想法侧栏前锁定引用 CFI，供后续 resize 校正
		thoughtQuoteAnchorCfiRef.current = cfiRange.trim();
		setAssistantOpen(false);
		setSelectionPopBar(null);
		selectionPopBarRef.current = null;
		if (thoughtListClusterRef.current) {
			returnToListClusterRef.current = thoughtListClusterRef.current;
		}
		setThoughtListOpen(false);
		setThoughtDraft({
			id: '',
			quote: trimmed,
			cfiRange,
			content: '',
			username: '',
			avatar: '',
			createdAt: '',
			updatedAt: '',
		});
		setThoughtDialogMode('create');
		setThoughtDialogOpen(true);
		setThoughtComposeScrollKey((key) => key + 1);
	},
	[t],
);
```

**变更摘要**：在 state 更新前同步写入锚点，避免首帧 resize 时 ref 仍为空。

---

### 4.4 `openThoughtCluster` 写入锚点（`read.tsx`）

**对比范围**：`openThoughtCluster` 全函数。

**改动前** · `apps/frontend/src/views/ebook/read.tsx`（基线，约 L759–L769）

```typescript
const openThoughtCluster = useCallback(
	(cluster: EbookThoughtClickCluster) => {
		if (cluster.allThoughts.length === 0) return;
		startTransition(() => {
			setAssistantOpen(false);
			setThoughtListCluster({ ...cluster, selectedThoughtId: undefined });
			setThoughtListOpen(true);
		});
	},
	[],
);
```

**改动后** · `apps/frontend/src/views/ebook/read.tsx`（当前，约 L781–L796）

```typescript
const openThoughtCluster = useCallback(
	(cluster: EbookThoughtClickCluster) => {
		if (cluster.allThoughts.length === 0) return;
		const rend = epubNavRef.current?.getRendition() ?? undefined;
		const { cfiRange } = getThoughtClusterHighlightSubject(cluster, rend);
		if (cfiRange.trim()) {
			thoughtQuoteAnchorCfiRef.current = cfiRange.trim();
		}
		startTransition(() => {
			setAssistantOpen(false);
			setThoughtListCluster({ ...cluster, selectedThoughtId: undefined });
			setThoughtListOpen(true);
		});
	},
	[],
);
```

**变更摘要**：点下划线开列表时，在 `startTransition` 前用聚合后的引用 CFI 写锚点。

---

## 5. 兼容性与影响

| 项 | 说明 |
|----|------|
| 分页 EPUB | `getEpubScrollContainer` 为 null，滚动逻辑 no-op |
| MK 问书 | 不写入 `thoughtQuoteAnchorCfiRef`，不受本专题影响 |
| 性能 | 每次 resize 结束 O(1) 几何读 + 至多一次 `scrollTop` 写 |
| 阅读进度 | 不改 CFI 书签保存逻辑，仅视口 scroll |

---

## 6. 回归建议

1. 连续滚动 EPUB：拖选 → **写想法** → 引用段仍在屏内；保存后关侧栏仍可见。
2. 点 **虚线下划线** 开列表 → 关列表右上角 → 引用段不跑飞。
3. 列表 → 详情 → 关详情回列表：引用段稳定。
4. 与 [EPUB阅读分屏.md](./EPUB阅读分屏.md) 叠加：列表开 MK 再关 MK，引用仍可见。
5. 分页模式：开/关想法侧栏无报错、无异常跳动。

---

## 7. 相关源码路径

| 说明 | 路径 |
|------|------|
| CFI 视口滚动 | `apps/frontend/src/views/ebook/utils/epubScrolledNav.ts` |
| 锚点与触发 | `apps/frontend/src/views/ebook/read.tsx` |
| 分栏 resize 通知 | `apps/frontend/src/views/ebook/utils/ebookSplitResize.ts` |
| 分栏开合布局 | `apps/frontend/src/views/ebook/components/EbookReadSplitLayout.tsx` |
| soft resize | `apps/frontend/src/views/ebook/components/EpubPane.tsx` |

---

（若与仓库最新源码不一致，以源码为准）
