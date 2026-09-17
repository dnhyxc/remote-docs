# EPUB 目录 Foliate 式 CFI 跳转（同 HTML 多 `#filepos` 节）

> **文档角色**：本轮将目录跳转从「仅 `display(href)` / 连续滚动专用对齐」升级为 **Foliate 式 resolveHref → goTo**：有 `#fragment` 时先转 **CFI** 再 `display`，连续滚动用 **iframe 坐标系顶对齐**；`attachTocCfis` 为同 spine 多锚点挂 `tocCfi`；`EpubPane.go` 返回 **destCFI** 供听书起播定位。  
> **延伸阅读**：[EPUB滚动目录导航对齐.md](./EPUB滚动目录导航对齐.md)（连续滚动章首对齐前序方案）、[EPUB目录激活CFI.md](./EPUB目录激活CFI.md)（`tocCfi` 目录高亮）、[EPUB听书目录锚点启动.md](./EPUB听书目录锚点启动.md)（听书目录切章起播句定位）。

---

## 1. 背景与目标

### 1.1 多 TOC 项共用一个 spine

部分 EPUB（尤其 Kindle 导出）把**同一 HTML/XHTML 文件**拆成多个目录节，href 形如：

- `part0004.html`（整章）
- `part0004.html#filepos12345`（同文件内第 2 节）
- `part0004.html#filepos67890`（同文件内第 3 节）

这些项的 **`spineIndex` 相同**，仅靠 URL **fragment**（`#filepos…` 或 `id`）区分节首。

旧路径问题：

| 场景 | 旧行为 | 用户感知 |
|------|--------|----------|
| 点 `#filepos` 目录 | `rend.display(href)` 或 `displayEpubScrolledHref` 仅按 spine/fragment 粗跳 | 滚到**章末**或**错误节**，与目录标题不一致 |
| 目录高亮 | 只比 `spineIndex` | 同章多节时**始终高亮第一项** |
| 听书点目录 | `go` 无返回值 | 无法从 **destCFI** 定位**该节起播句** |

### 1.2 目标

1. **Foliate / epub.js#986**：TOC `href` → 锚点元素 → `section.cfiFromElement` → `display(cfi)`，同文件多节精确落点。
2. **连续滚动顶对齐**：锚点须在**外层滚动容器坐标系**顶对齐；误用 iframe 内局部 `top` 会把 `scrollTop` 加上数千像素滚到章末。
3. **`attachTocCfis`**：按 spine 批量 `load` 一次，为每项写入 `tocCfi`，供 `tocActiveIndex` CFI 比较。
4. **`NavApi.go`**：统一走 `navigateEpubTocHref`，**返回**目标 CFI（听书 `goEpubTocHref` 消费）。

---

## 2. 改动范围

| 路径 | 说明 |
|------|------|
| `apps/frontend/src/views/ebook/utils/epub/reader/epubTocNavigate.ts` | **新建**：`cfiFromTocHref`、`navigateEpubTocHref`、`attachTocCfis`、`snapAnchorToContainerTop` 等 |
| `apps/frontend/src/views/ebook/components/reader/EpubPane.tsx` | `go` 改调 `navigateEpubTocHref` 并返回 CFI；目录加载后 `attachTocCfis` |
| `apps/frontend/src/views/ebook/utils/epub/reader/epubSpineIndex.ts` | `flattenEpubNavToc`、`canonicalizeEpubTocHref`（目录展平与 href 规范化，本文不展开） |
| `apps/frontend/src/views/ebook/utils/common/tocActiveIndex.ts` | 消费 `tocCfi` 做同 spine 多锚点高亮（见姊妹专题） |
| `apps/frontend/src/views/ebook/types.ts` | `EbookTocItem.tocCfi?: string` |
| `apps/frontend/src/views/ebook/read.tsx` | `goEpubTocHref` 使用 `go` 返回的 destCFI（姊妹专题） |

---

## 3. 实现思路

1. **href 规范化**：`canonicalizeEpubTocHref` 把 nav href 映射到 spine 内真实路径 + `spineIndex`。
2. **有 fragment → CFI 跳转**：`cfiFromTocHref` 临时 `section.load`，在 spine 文档内 `findTocAnchor`（`id` / `a[name]`），`cfiFromElement` 后 `unload`。
3. **无 fragment → spineIndex**：`rend.display(canon.spineIndex)`，行为与整章跳转一致。
4. **continuous 同章二次跳转**：`clearContinuousViews` 在 `display` 前清 manager views，避免 prepend 邻章干扰对齐。
5. **顶对齐三层 fallback**（`snapAfterTocDisplay`）：
   - 优先 `#fragment` 锚点（章首/节首，避免 CFI range 落到父块末尾）；
   - 其次 CFI → `resolveCfiDomRange` 起始节点；
   - 最后整章 `.epub-view` 顶。
6. **坐标系**：`snapAnchorToContainerTop` 用 `viewEl.offsetTop + 锚点 offsetTop` 链（与 `readRangeViewportBounds` 一致）；无 view 时 `iframe.getBoundingClientRect().top + rect.top` 转外层视口坐标，再 `scrolledNavAlignDelta` 增量改 `scrollTop`。
7. **布局双帧 settle**：`pauseForLayout`（双 rAF）后对齐两次，覆盖 continuous `fill/trim` 后的高度变化；不做超时轮询。
8. **`attachTocCfis`**：按 `spineIndex` 分组，每章 load 一次、批量写 `tocCfi`，单章失败不影响其余。

### 3.1 未采用方案

- **仅 `displayEpubScrolledHref`**：无法为听书返回 destCFI，同文件多 `#filepos` 仍依赖 fragment 查找，与 Foliate CFI 路径不统一。
- **iframe 内 `getBoundingClientRect().top` 直接作 scrollTop**：未加 iframe 在外层文档中的偏移，连续滚动下会滚到章末（见 §4.1 注释）。
- **目录跳转临时改分页 manager**：破坏连续滚动 UX。

---

## 4. 关键代码与注释

### 4.1 `snapAnchorToContainerTop`（`apps/frontend/src/views/ebook/utils/epub/reader/epubTocNavigate.ts`）

**对比范围**：目录锚点顶对齐完整函数（纯新增文件，仅改动后）。

**改动后** · `apps/frontend/src/views/ebook/utils/epub/reader/epubTocNavigate.ts`（当前，约 L58–L90）

```typescript
// 将 rendition 内已渲染的锚点元素顶对齐到外层连续滚动容器顶边（保留 SCROLL_EDGE_PX）
function snapAnchorToContainerTop(rend: Rendition, anchor: HTMLElement): void {
	// 取 epub.js 连续滚动模式下的外层可滚动宿主（.epub-container 等）
	const container = getEpubScrollContainer(rend);
	// 无滚动容器（分页模式或未挂载）则无法校正，直接返回
	if (!container) return;

	// filepos 等多为空 span：高度为 0 时改用其后兄弟节点（常为标题）作为对齐目标
	const el = resolveSnapElement(anchor);
	// 锚点所在 iframe 的 window，用于取 frameElement
	const win = el.ownerDocument?.defaultView;
	// iframe 元素本身，其在外层文档中的位置须参与坐标换算
	const iframe = win?.frameElement as HTMLIFrameElement | null;
	// 包裹该 iframe 的 .epub-view，其 offsetTop 是章块在外层滚动流中的起点
	const viewEl = iframe?.closest('.epub-view') as HTMLElement | null;

	// 优先 offset 绝对定位：不受 continuous fill 后 getBoundingClientRect 抖动影响
	if (viewEl) {
		// 锚点从当前节点沿 offsetParent 链累加到文档根前的垂直偏移（iframe 内坐标）
		let innerTop = 0;
		// 从对齐目标节点开始向上遍历 offsetParent
		let node: HTMLElement | null = el;
		// 累加至 html 根之前（不含 documentElement 本身）
		while (node && node !== el.ownerDocument?.documentElement) {
			// 当前层相对其 offsetParent 的 top
			innerTop += node.offsetTop;
			// 下一层 offsetParent；无或自引用则终止链
			const parent = node.offsetParent as HTMLElement | null;
			if (!parent || parent === node) break;
			// 继续向上
			node = parent;
		}
		// 外层 scrollTop = 章 view 顶 + iframe 内锚点顶，再经 scrolledChapterScrollTop 扣边距
		container.scrollTop = scrolledChapterScrollTop(viewEl.offsetTop + innerTop);
		// offset 路径已写入 scrollTop，无需再走 rect 增量分支
		return;
	}

	// fallback：无 .epub-view 时用视口 rect 算目标顶（须把 iframe 偏移加到 rect.top）
	const rect = el.getBoundingClientRect();
	// 有 iframe 时目标顶 = iframe 在外层的 top + 元素在 iframe 视口内的 top
	const targetTop = iframe
		? iframe.getBoundingClientRect().top + rect.top
		: rect.top;
	// 相对滚动容器顶边的差值（正数表示目标在容器顶下方，需增大 scrollTop）
	const delta = scrolledNavAlignDelta(
		targetTop,
		container.getBoundingClientRect().top,
	);
	// 差值至少 1px 才写入，避免亚像素抖动反复 scroll
	if (Math.abs(delta) >= 1) container.scrollTop += delta;
}
```

**要点**：`viewEl.offsetTop + innerTop` 把锚点映射到**外层滚动文档**纵坐标；若只用 iframe 内 `rect.top` 或 `offsetTop` 当作 `scrollTop`，会漏加章块在 continuous 流中的位移（常为数千像素），表现为滚到章末。

---

### 4.2 `cfiFromTocHref`（`apps/frontend/src/views/ebook/utils/epub/reader/epubTocNavigate.ts`）

**对比范围**：TOC href → 元素 CFI 的 async 导出函数（纯新增，仅改动后）。

**改动后** · `apps/frontend/src/views/ebook/utils/epub/reader/epubTocNavigate.ts`（当前，约 L108–L132）

```typescript
// Foliate / epub.js#986：将 nav TOC 的 href 解析为 epub CFI 字符串，供 display(cfi) 精确落点
export async function cfiFromTocHref(
	// epub.js Book：提供 spine、load 与章节 document
	book: Book,
	// 原始或规范化前的 TOC href（可含 #fragment）
	href: string,
): Promise<string | undefined> {
	// 规范化 href：得到 spine 内路径、spineIndex 等；无法映射则无法生成 CFI
	const canon = canonicalizeEpubTocHref(book, href);
	// 无对应 spine 项时中止
	if (!canon) return undefined;

	// 从规范化 href 拆出 # 后的 fragment（filepos、id 等）
	const { fragment } = splitFragment(canon.href);
	// spine 以内部 get(index) 访问章节 section（epub.js 类型未完全导出，故断言）
	const spine = book.spine as unknown as {
		get?: (t: number) => SpineSection | null;
	};
	// 按 spineIndex 取章节 section 对象
	const section = spine.get?.(canon.spineIndex);
	// section 无 load 能力则无法临时载入文档
	if (!section?.load) return undefined;

	// 临时载入该 spine 节（不经过 rendition display），解析 DOM 后会在 finally unload
	await Promise.resolve(section.load(book.load.bind(book)));
	try {
		// load 完成后 section.document 指向该节解析后的 Document
		const doc = section.document;
		// 文档未就绪则无法取锚点
		if (!doc) return undefined;
		// 有 fragment 则查锚点元素；无 fragment 用 body 代表章首
		const el = fragment ? findTocAnchor(doc, fragment) : doc.body;
		// 锚点不存在则无法生成 CFI
		if (!el) return undefined;
		// epub.js section API：由 DOM 元素生成稳定 CFI 字符串
		return section.cfiFromElement(el);
	} finally {
		// 释放临时载入的章节，避免占用内存与污染后续 display
		section.unload?.();
	}
}
```

---

### 4.3 `navigateEpubTocHref`（`apps/frontend/src/views/ebook/utils/epub/reader/epubTocNavigate.ts`）

**对比范围**：目录跳转主入口，含 display、对齐与返回值（纯新增，仅改动后）。

**改动后** · `apps/frontend/src/views/ebook/utils/epub/reader/epubTocNavigate.ts`（当前，约 L204–L247）

```typescript
// 目录跳转（Foliate：resolveHref → goTo）；连续滚动顶对齐；返回目标 CFI 供听书起播
export async function navigateEpubTocHref(
	// 当前 rendition（continuous 或分页）
	rend: Rendition,
	// 书籍实例，用于 CFI 解析与 spine 索引
	book: Book,
	// 用户点击的 TOC href
	href: string,
): Promise<string | undefined> {
	// 去掉首尾空白，空串视为无效跳转
	const raw = href.trim();
	// 无有效 href 时不 display、不返回值
	if (!raw) return undefined;

	// 规范化：得到书内 href 与 spineIndex；失败则 display 仍可用原始 raw
	const canon = canonicalizeEpubTocHref(book, raw);
	// display 用的路径：优先规范化结果，否则原始 href
	const displayHref = canon?.href ?? raw;
	// 拆 fragment，供 CFI 分支与 snap 锚点查找
	const { fragment } = splitFragment(displayHref);

	// display 目标：默认字符串 href；有 fragment 时可能改为 CFI；无 fragment 时可能改为 spine 序号
	let displayTarget: string | number = displayHref;
	// 记录用于 snap 与返回的 CFI（仅有 fragment 且 cfiFromTocHref 成功时赋值）
	let snapCfi: string | undefined;

	// 同文件多节：有 #fragment 时转 CFI 再 display，避免只滚到 spine 默认位置
	if (fragment) {
		// 异步解析锚点 CFI
		const cfi = await cfiFromTocHref(book, displayHref);
		// 解析成功则用 CFI 作为 display 参数，并记下供对齐与返回
		if (cfi) {
			displayTarget = cfi;
			snapCfi = cfi;
		}
	} else if (canon) {
		// 无 fragment：整章跳转，直接用 spine 索引（epub.js display(number)）
		displayTarget = canon.spineIndex;
	}

	// continuous 同章内二次跳转前清空已有 views，减少 prepend 邻章干扰
	clearContinuousViews(rend);
	// displayTarget 为数字时走 spine 索引 display
	if (typeof displayTarget === 'number') {
		await rend.display(displayTarget);
	} else {
		// 字符串：href 或 CFI，由 epub.js 解析
		await rend.display(displayTarget);
	}
	// 等待两帧 layout，使 iframe 高度与 view 插入稳定
	await pauseForLayout();
	// 第一次顶对齐：优先 fragment 锚点 → CFI 节点 → 整章 view
	snapAfterTocDisplay(rend, snapCfi, fragment, canon?.spineIndex);
	// fill/trim 后布局可能再动一次；仅补一帧，不对齐超时轮询
	await pauseForLayout();
	// 第二次顶对齐，覆盖 continuous manager 异步 trim 后的偏移
	snapAfterTocDisplay(rend, snapCfi, fragment, canon?.spineIndex);

	// 返回值：优先 snap 用的 CFI；否则读 rendition.location.start.cfi；都无则 undefined
	return (
		snapCfi ||
		(rend as { location?: { start?: { cfi?: string } } }).location?.start
			?.cfi ||
		undefined
	);
}
```

---

### 4.4 `attachTocCfis`（`apps/frontend/src/views/ebook/utils/epub/reader/epubTocNavigate.ts`）

**对比范围**：为目录项批量挂载 `tocCfi`（纯新增，仅改动后）。

**改动后** · `apps/frontend/src/views/ebook/utils/epub/reader/epubTocNavigate.ts`（当前，约 L250–L295）

```typescript
// 为目录项挂 tocCfi，供同 spine 多锚点时 CFI 比较高亮（findActiveTocItemIndex）
export async function attachTocCfis(
	// epub.js Book
	book: Book,
	// 已展平、含 spineIndex 的目录项列表
	items: EbookTocItem[],
): Promise<EbookTocItem[]> {
	// 空目录直接返回原引用，避免无意义 load
	if (items.length === 0) return items;

	// 单章内待解析的作业：记录 items 下标与 fragment
	type Job = { itemIndex: number; fragment: string };
	// spineIndex → 该章所有需写 tocCfi 的 job 列表
	const bySpine = new Map<number, Job[]>();
	// 遍历目录项，按 spine 分组
	for (let i = 0; i < items.length; i++) {
		// 当前目录项
		const item = items[i];
		// 无 spineIndex 的项（解析失败）跳过
		if (item?.spineIndex == null) continue;
		// 从 href 拆 fragment；无 href 则空串（整章用 body）
		const fragment = item.href ? splitFragment(item.href).fragment : '';
		// 取或创建该 spine 的 job 数组
		const list = bySpine.get(item.spineIndex) ?? [];
		// 追加本条 job
		list.push({ itemIndex: i, fragment });
		// 写回 Map
		bySpine.set(item.spineIndex, list);
	}

	// 浅拷贝每项，后续只改 tocCfi 字段
	const out = items.map((item) => ({ ...item }));
	// spine get 访问器（类型断言同 cfiFromTocHref）
	const spine = book.spine as unknown as {
		get?: (t: number) => SpineSection | null;
	};

	// 按章批量处理：每 spine 只 load/unload 一次
	for (const [spineIndex, jobs] of bySpine) {
		// 取该 spine section
		const section = spine.get?.(spineIndex);
		// 无法 load 则跳过整章
		if (!section?.load) continue;
		try {
			// 临时载入该章 document
			await Promise.resolve(section.load(book.load.bind(book)));
			// 载入后的 Document
			const doc = section.document;
			// 无 document 则跳过该章所有 job
			if (!doc) continue;
			// 对该章每条目录项生成 tocCfi
			for (const job of jobs) {
				// 有 fragment 找锚点，否则 body 代表章首
				const el = job.fragment ? findTocAnchor(doc, job.fragment) : doc.body;
				// 锚点缺失则该项不写 tocCfi
				if (!el) continue;
				// 写回 out 对应下标，保留其余字段
				out[job.itemIndex] = {
					...out[job.itemIndex]!,
					tocCfi: section.cfiFromElement(el),
				};
			}
		} catch {
			// 单章失败不影响其余 spine 的 tocCfi 挂载
		} finally {
			// 无论成功失败都 unload 该章
			section.unload?.();
		}
	}

	// 返回带 tocCfi 的新数组（调用方替换 state）
	return out;
}
```

---

### 4.5 `EpubPane` — `NavApi.go` 类型与实现（`apps/frontend/src/views/ebook/components/reader/EpubPane.tsx`）

**对比范围**：`NavApi` 中 `go` 签名 + `onReady` 内 `go` 箭头函数完整实现。

**改动前** · `apps/frontend/src/views/ebook/components/reader/EpubPane.tsx`（基线，约 L56–L58、L485–L497）

```typescript
// 阅读器对外导航 API：父层 read.tsx 通过 onReady 持有
type NavApi = {
	// 上一页/章
	prev: () => Promise<void>;
	// 下一页/章
	next: () => Promise<void>;
	// 按 href 跳转目录；旧版无返回值
	go: (href: string) => Promise<void>;
	// 清除 iframe 内文字选区
	clearTextSelection: () => void;
	// 取当前 rendition
	getRendition: () => Rendition | null;
	// 取当前 book
	getBook: () => Book | null;
	// 同步划线与想法到 DOM
	syncReadingAnnotations: (nextHighlights?: EbookUserHighlight[]) => void;
};
```

```typescript
// onReady 注入的目录跳转：连续滚动走 displayEpubScrolledHref，分页走 display
go: async (href) => {
	// 当前 rendition 与 book 引用
	const rend = rendRef.current;
	const spineBook = bookRef.current;
	// rendition 未就绪则静默返回
	if (!rend) return;
	// 连续滚动且有 book 时走 scrolled 专用对齐跳转
	if (
		readerSettingsRef.current.pageFlow === 'scrolled' &&
		spineBook
	) {
		// display + 章首/锚点顶对齐（不返回 CFI）
		await displayEpubScrolledHref(rend, spineBook, href);
		// 结束，不走下方 display
		return;
	}
	// 分页模式：直接 epub.js display(href)
	await rend.display(href);
},
```

**改动后** · `apps/frontend/src/views/ebook/components/reader/EpubPane.tsx`（当前，约 L58–L60、L487–L503）

```typescript
// 阅读器对外导航 API：父层 read.tsx 通过 onReady 持有
type NavApi = {
	// 上一页/章
	prev: () => Promise<void>;
	// 下一页/章
	next: () => Promise<void>;
	// 按 href 跳转目录；返回目标 CFI 供听书目录切章定位起播句
	go: (href: string) => Promise<string | undefined>;
	// 清除 iframe 内文字选区
	clearTextSelection: () => void;
	// 取当前 rendition
	getRendition: () => Rendition | null;
	// 取当前 book
	getBook: () => Book | null;
	// 同步划线与想法到 DOM
	syncReadingAnnotations: (nextHighlights?: EbookUserHighlight[]) => void;
};
```

```typescript
// onReady 注入的目录跳转：统一 navigateEpubTocHref（CFI + 顶对齐 + 返回 destCFI）
go: async (href) => {
	// 当前 rendition 与 book 引用
	const rend = rendRef.current;
	const spineBook = bookRef.current;
	// rendition 未就绪则返回 undefined（调用方勿当作有效 CFI）
	if (!rend) return undefined;
	// Foliate：TOC → CFI/spineIndex 导航（同文件 #filepos 等多锚点）
	if (spineBook) {
		// 分页与连续滚动共用；内部处理 fragment→CFI、顶对齐与返回值
		return navigateEpubTocHref(rend, spineBook, href);
	}
	// 极端情况无 book：回退 epub.js display(href)
	await rend.display(href);
	// 从 rendition.location 读取跳转后的起始 CFI 作为 destCFI
	return (
		(
			rend as {
				location?: { start?: { cfi?: string } };
			}
		).location?.start?.cfi ?? undefined
	);
},
```

**变更摘要**：移除 `pageFlow === 'scrolled'` 分支与 `displayEpubScrolledHref` 依赖；`go` 在有无 book 时均可能返回 **destCFI**；听书 `goEpubTocHref` 用该值定位节首起播句。

**改动后（目录加载接线摘录）** · `apps/frontend/src/views/ebook/components/reader/EpubPane.tsx`（当前，约 L524–L530）

```typescript
// 12. 读取目录：展平 subitems + 规范化 href；后台挂 tocCfi
// 等待 epub.js navigation 加载完成
const nav = await book.loaded.navigation;
// flattenEpubNavToc：展平嵌套 subitems 并写入 spineIndex
const toc = flattenEpubNavToc(nav.toc, book);
// 先上报基础目录，抽屉可立即展示
if (!destroyed) onTocRef.current?.(toc);
// 后台 attachTocCfis，不阻塞首屏；完成后用 enriched 列表刷新父层
void attachTocCfis(book, toc).then((enriched) => {
	// 组件已销毁则不再回调，避免 setState on unmounted
	if (!destroyed) onTocRef.current?.(enriched);
});
```

---

## 5. 兼容性与影响

| 维度 | 说明 |
|------|------|
| 分页模式 | `navigateEpubTocHref` 同样适用；无滚动容器时 `snapAnchorToContainerTop` 早退，仅 `display` + 返回 CFI |
| 连续滚动 | 顶对齐逻辑替代 `displayEpubScrolledHref` 接线；`epubScrolledNav` 工具仍被 `getEpubScrollContainer` / `scrolledNavAlignDelta` 复用 |
| 破坏性 | `NavApi.go` 返回类型由 `Promise<void>` 改为 `Promise<string \| undefined>`；调用方须 `await` 返回值（`read.tsx` 已接） |
| 目录高亮 | 首次 `onToc` 无 `tocCfi`；`attachTocCfis` 完成后第二次回调才有 CFI 高亮（短暂回退 spineIndex 判定） |
| 性能 | `attachTocCfis` 按 spine 分组 load，大书目录为 O(章数) 次临时 load，在后台异步执行 |

---

## 6. 测试与回归建议

| # | 场景 | 预期 |
|---|------|------|
| 1 | 连续滚动，点同 HTML 多个 `#filepos` 目录项 | 各节标题顶对齐视口，不滚到章末 |
| 2 | 连续滚动，点无 fragment 的整章目录 | 章 `.epub-view` 顶对齐 |
| 3 | 分页模式，点 `#filepos` 目录 | 落到对应节首页，无回归 |
| 4 | 听书播放中点目录另一节 | `go` 返回 destCFI，起播句从该节首附近开始（见 `EPUB听书目录锚点启动.md`） |
| 5 | 打开目录抽屉 | `attachTocCfis` 完成后，同 spine 多节仅高亮「不超过当前 CFI」的最后一项 |
| 6 | 无 fragment 且 `canonicalize` 失败 | 回退 `display(raw href)`，不抛错 |
| 7 | 单章 `attachTocCfis` load 失败 | 其余章仍有 `tocCfi`，抽屉仍可用 |

---

## 7. 相关源码路径

| 说明 | 路径 |
|------|------|
| 目录 CFI 跳转与顶对齐（本文主模块） | `apps/frontend/src/views/ebook/utils/epub/reader/epubTocNavigate.ts` |
| 阅读器 `go` / `attachTocCfis` 接线 | `apps/frontend/src/views/ebook/components/reader/EpubPane.tsx` |
| 连续滚动容器与对齐增量 | `apps/frontend/src/views/ebook/utils/epub/reader/epubScrolledNav.ts` |
| href → spineIndex 规范化 | `apps/frontend/src/views/ebook/utils/epub/reader/epubSpineIndex.ts` |
| `tocCfi` 活跃项判定 | `apps/frontend/src/views/ebook/utils/common/tocActiveIndex.ts` |
| 目录项类型 `tocCfi` | `apps/frontend/src/views/ebook/types.ts` |
| 听书消费 `go` 返回值 | `apps/frontend/src/views/ebook/read.tsx`（`goEpubTocHref`） |
| 前序连续滚动对齐专题 | `docs/ebook/EPUB滚动目录导航对齐.md` |

---

*若与仓库最新源码不一致，以源码为准。*
