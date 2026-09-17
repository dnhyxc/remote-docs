# EPUB 目录高亮：同 spine 多锚点 CFI 比较与视口回退

**文档角色**：当多个目录项落在同一 `spineIndex` 时，用 `tocCfi`/`epubCfi`（Foliate 策略）精确定位高亮项；比较器全 0 时勿误选末项；无 `tocCfi` 时按 DOM 视口顶边回退。

**延伸阅读**：[电子书目录激活高亮.md](./电子书目录激活高亮.md)（目录高亮初版）、[EPUB目录CFI导航.md](./EPUB目录CFI导航.md)（目录 CFI 跳转）、[EPUB听书栏播放头目录.md](./EPUB听书栏播放头目录.md)（底栏播放头与目录联动）

---

## 1. 背景与目标

### 1.1 问题

| 场景 | 旧行为 | 期望 |
|------|--------|------|
| 同一 HTML 文件内多个目录锚点（同 `spineIndex`） | `findActiveTocItemIndex` 只比 spine，**永远高亮同文件最后一项** | 按当前阅读 CFI 或视口位置选中**最接近**的目录项 |
| `EpubCFI.compare` 不可用或全返回 0 | 无防护，仍可能落到 `sameIndexes` 末项 | 检测 `sawNonZero`，比较器失效时**不走 CFI 分支** |
| 目录项无 `tocCfi` | 无二级策略 | 在滚动容器内查锚点 DOM，`getBoundingClientRect` 与视口顶边比较（Foliate `TOCProgress`） |

### 1.2 目标

1. `TocActivePosition` 扩展 `epubCfi`、`getRendition`。
2. 同 spine 候选集内：`compareCfi` → DOM 视口 → 取第一项（非末项）。
3. `read.tsx` 的 `activeTocIndex` 传入 `readingCfi` 与 `getRendition`。

---

## 2. 改动范围

| 路径 | 说明 |
|------|------|
| `apps/frontend/src/views/ebook/utils/common/tocActiveIndex.ts` | `TocActivePosition` 扩展；新增 `compareCfi`、`activeAmongSameSpine`；重写 EPUB 分支 |
| `apps/frontend/src/views/ebook/read.tsx` | `activeTocIndex` useMemo 传入 `epubCfi`、`getRendition` |

---

## 3. 实现思路

1. **先按 spine 粗筛**：`spineIndex < 当前` 记入 `bestBefore`；`=== 当前` 入 `same` 数组。
2. **无同 spine 候选**：直接返回 `bestBefore`（与旧版「≤ 当前 spine 的最后一项」一致）。
3. **有同 spine 候选**：委托 `activeAmongSameSpine`：
   - **CFI 层**：遍历 `same`，`compareCfi(tocCfi, epubCfi) <= 0` 更新 `best`；须 `sawNonZero` 才采纳，避免比较器全 0 误选。
   - **DOM 层**：`getEpubScrollContainer` 取容器，顶边 +16px 为阈值；按 `same` 顺序查 `id` / `a[name]` 锚点，最后一个 `top <= 阈值` 的项为 best。
   - **兜底**：`sameIndexes[0]`（第一项，**勿取最后一项**）。
4. **阅读页接线**：`readingCfi || currentEpubCfiRef.current` 作 `epubCfi`；`epubNavRef.current?.getRendition()` 作 `getRendition`。

---

## 4. 关键代码对比与注释

### 4.1 `TocActivePosition`（`apps/frontend/src/views/ebook/utils/common/tocActiveIndex.ts`）

**对比范围**：类型别名完整定义。

**改动前** · `apps/frontend/src/views/ebook/utils/common/tocActiveIndex.ts`（基线，约 L4–L7）

```typescript
// 目录高亮定位入参：仅支持 PDF 页码或 EPUB spine 序号
export type TocActivePosition = {
	// 可选 PDF 当前页码（1-based 或解析结果）
	pdfPage?: number;
	// 可选 EPUB 当前 spine 索引（nav 顺序）
	epubSpineIndex?: number;
};
```

**改动后** · `apps/frontend/src/views/ebook/utils/common/tocActiveIndex.ts`（当前，约 L13–L20）

```typescript
// 目录高亮定位入参：PDF 页码、EPUB spine，及同 spine 细分的 CFI / 渲染器
export type TocActivePosition = {
	// 可选 PDF 当前页码
	pdfPage?: number;
	// 可选 EPUB 当前 spine 索引
	epubSpineIndex?: number;
	/** 当前阅读 CFI；同 spine 多目录锚点时与 tocCfi 比较 */
	// 阅读位置 CFI 字符串，用于同文件多锚点时的 Foliate 式比较
	epubCfi?: string;
	/** 无 tocCfi 时回退：按锚点在视口中的位置判定（Foliate TOCProgress） */
	// 惰性获取 epubjs Rendition，供 DOM 视口回退查 iframe 内锚点
	getRendition?: () => Rendition | null;
};
```

**变更摘要**：新增 `epubCfi` 与 `getRendition`，支撑同 spine 二级判定。

---

### 4.2 `findActiveTocItemIndex`（`apps/frontend/src/views/ebook/utils/common/tocActiveIndex.ts`）

**对比范围**：导出函数全定义（基线 L16–L59；当前 L100–L135）。

**改动前** · `apps/frontend/src/views/ebook/utils/common/tocActiveIndex.ts`（基线，约 L16–L59）

```typescript
// 根据当前阅读位置在目录树中查找应对应高亮的项索引
export function findActiveTocItemIndex(
	// 扁平或树形展开后的目录项列表
	items: EbookTocItem[],
	// 当前阅读位置（PDF 页或 EPUB spine）
	position: TocActivePosition,
): number {
	// 空目录无法匹配，约定返回 -1
	if (items.length === 0) return -1;

	// 解构位置字段，后续分支分别使用
	const { pdfPage, epubSpineIndex } = position;

	// 情况 1: 当前定位是 PDF 页码，且有效
	if (pdfPage != null && Number.isFinite(pdfPage)) {
		// best 记录最后一个页码 ≤ 当前页的目录项索引
		let best = -1;
		// 线性扫描全部目录项
		for (let i = 0; i < items.length; i++) {
			// 从 href 解析 PDF 页码（如 #page=3）
			const page = parsePdfPageHref(items[i].href ?? '');
			// 页码有效且不超过当前页则更新 best（取最靠后的满足项）
			if (page != null && page <= pdfPage) {
				best = i;
			}
		}
		// 返回 PDF 分支结果（可能仍为 -1）
		return best;
	}

	// 情况 2: 当前定位是 EPUB 的 spineIndex，且有效
	if (epubSpineIndex != null && Number.isFinite(epubSpineIndex)) {
		// best 记录最后一个 spineIndex ≤ 当前的目录项索引
		let best = -1;
		// 线性扫描全部目录项
		for (let i = 0; i < items.length; i++) {
			// 取出该项预计算的 spine 索引
			const spineIndex = items[i].spineIndex;
			// spine 有效且不超过当前 spine 则更新 best
			if (spineIndex != null && spineIndex <= epubSpineIndex) {
				best = i;
			}
		}
		// 同 spine 多锚点时此处会误选该文件最后一项（本专题修复点）
		return best;
	}

	// 无法识别的定位类型
	return -1;
}
```

**改动后** · `apps/frontend/src/views/ebook/utils/common/tocActiveIndex.ts`（当前，约 L100–L135）

```typescript
// 根据当前阅读位置在目录树中查找应对应高亮的项索引
export function findActiveTocItemIndex(
	// 目录项列表
	items: EbookTocItem[],
	// 扩展后的位置（含 epubCfi、getRendition）
	position: TocActivePosition,
): number {
	// 空目录返回 -1
	if (items.length === 0) return -1;

	// 解构全部定位字段，EPUB 分支使用 epubCfi / getRendition
	const { pdfPage, epubSpineIndex, epubCfi, getRendition } = position;

	// PDF 分支：逻辑与基线相同
	if (pdfPage != null && Number.isFinite(pdfPage)) {
		// 最后一个页码 ≤ 当前页的目录索引
		let best = -1;
		for (let i = 0; i < items.length; i++) {
			const page = parsePdfPageHref(items[i].href ?? '');
			if (page != null && page <= pdfPage) {
				best = i;
			}
		}
		return best;
	}

	// EPUB 分支：先按 spine 分桶，再对同 spine 细判
	if (epubSpineIndex != null && Number.isFinite(epubSpineIndex)) {
		// 严格小于当前 spine 的最后一项（无同 spine 候选时的回退）
		let bestBefore = -1;
		// 与当前 spine 完全相同的目录项索引列表
		const same: number[] = [];
		for (let i = 0; i < items.length; i++) {
			const spineIndex = items[i].spineIndex;
			if (spineIndex == null) continue;
			// 小于当前：更新 bestBefore（等价旧版 ≤ 语义中的严格小于部分）
			if (spineIndex < epubSpineIndex) bestBefore = i;
			// 等于当前：收集到 same 待二级判定
			else if (spineIndex === epubSpineIndex) same.push(i);
		}
		// 无同 spine 目录项：退回 bestBefore
		if (same.length === 0) return bestBefore;

		// 惰性取 Rendition，供 DOM 视口回退
		const rend = getRendition?.() ?? null;
		// CFI 比较 → DOM 锚点 → 第一项兜底
		return activeAmongSameSpine(items, same, epubCfi, rend);
	}

	// 无法识别定位
	return -1;
}
```

**变更摘要**：EPUB 分支由「单一 `best` + `<=`」改为 `bestBefore` + `same` 分桶，同 spine 交给 `activeAmongSameSpine`。

---

### 4.3 `compareCfi` 与 `activeAmongSameSpine`（`apps/frontend/src/views/ebook/utils/common/tocActiveIndex.ts`）

**对比范围**：纯新增内部函数（仅改动后）。

**改动后** · `apps/frontend/src/views/ebook/utils/common/tocActiveIndex.ts`（当前，`compareCfi` 约 L22–L33，`activeAmongSameSpine` 约 L35–L95）

```typescript
// 封装 epubjs EpubCFI.compare，兼容多种打包导出形态
function compareCfi(a: string, b: string): number {
	// 优先取命名空间 EpubCFI 构造器
	const Ctor =
		EpubCFI ??
		(EpubJS as unknown as { default?: { EpubCFI?: typeof EpubCFI } }).default
			?.EpubCFI;
	// 构造器缺失时返回 0，交由上层 sawNonZero 逻辑处理
	if (!Ctor) return 0;
	try {
		// 实例化后调用 compare：负/零/正表示 a 在 b 前/同/后
		return new Ctor().compare(a, b);
	} catch {
		// 非法 CFI 等异常时返回 0，避免抛错中断目录高亮
		return 0;
	}
}

// 在同 spine 候选索引集合内选出应对应高亮的一项
function activeAmongSameSpine(
	// 完整目录项数组
	items: EbookTocItem[],
	// 与当前 spine 相同的目录项索引列表（保持 TOC 顺序）
	sameIndexes: number[],
	// 当前阅读 CFI，可为空
	epubCfi: string | undefined,
	// epubjs 渲染实例，DOM 回退时使用
	rend: Rendition | null,
): number {
	// 空候选集
	if (sameIndexes.length === 0) return -1;
	// 仅一项时无需细分
	if (sameIndexes.length === 1) return sameIndexes[0]!;

	// 1) 有 tocCfi：取「不超过当前 CFI」的最后一项（Foliate）
	if (epubCfi?.trim()) {
		// 当前最优目录索引
		let best = -1;
		// 是否见过非零比较结果（用于识别比较器失效）
		let sawNonZero = false;
		for (const i of sameIndexes) {
			// 目录项预存的锚点 CFI
			const tocCfi = items[i]?.tocCfi;
			// 无 tocCfi 的项跳过
			if (!tocCfi) continue;
			// tocCfi 相对 epubCfi 的位置
			const cmp = compareCfi(tocCfi, epubCfi);
			// 记录是否至少有一次有效比较
			if (cmp !== 0) sawNonZero = true;
			// toc 锚点不在阅读位置之后则候选
			if (cmp <= 0) best = i;
		}
		// 比较器失效时全 0，勿误选同 spine 最后一项
		if (sawNonZero && best >= 0) return best;
	}

	// 2) 活文档：视口顶边之上（含）的最后一个锚点
	const container = rend ? getEpubScrollContainer(rend) : null;
	if (container) {
		// 容器顶边 Y，+16px 与 Foliate TOCProgress 类似容差
		const topY = container.getBoundingClientRect().top + 16;
		// 初始取同 spine 第一项
		let best = sameIndexes[0]!;
		for (const i of sameIndexes) {
			const href = items[i]?.href ?? '';
			// 从 href 提取 # 后 fragment
			const hash = href.includes('#') ? href.slice(href.indexOf('#') + 1) : '';
			// 无 hash 的项视为章首，直接采纳并继续
			if (!hash) {
				best = i;
				continue;
			}
			// 默认用原始 hash
			let decoded = hash;
			try {
				// 尝试 URI 解码（%xx 锚点名）
				decoded = decodeURIComponent(hash);
			} catch {
				// 解码失败保留原 hash
			}
			// 在 iframe 文档中查找锚点元素
			let el: Element | null = null;
			for (const iframe of container.querySelectorAll('iframe')) {
				const doc = (iframe as HTMLIFrameElement).contentDocument;
				el =
					doc?.getElementById(decoded) ??
					doc?.querySelector(`a[name="${CSS.escape(decoded)}"]`) ??
					null;
				if (el) break;
			}
			// 找不到 DOM 则跳过该项
			if (!el) continue;
			// 锚点顶边在阈值之上或齐平：更新 best
			if (el.getBoundingClientRect().top <= topY) best = i;
			// 锚点已在视口下方：后续项更靠后，提前结束
			else break;
		}
		return best;
	}

	// 3) 未知碎片位置时取同 spine 第一项（勿取最后一项，否则全书落在该文件末节）
	return sameIndexes[0]!;
}
```

**变更摘要**：新增 CFI 比较与同 spine 三级策略（CFI → DOM → 首项兜底）。

---

### 4.4 `activeTocIndex` useMemo（`apps/frontend/src/views/ebook/read.tsx`）

**对比范围**：`useMemo` 完整定义（声明 → `}, [deps]);`）。

**改动前** · `apps/frontend/src/views/ebook/read.tsx`（基线，约 L1291–L1298）

```typescript
// 目录抽屉当前高亮项索引，随阅读位置重算
const activeTocIndex = useMemo(
	// 回调：调用 findActiveTocItemIndex 计算索引
	() =>
		findActiveTocItemIndex(
			// 当前书的目录项
			tocItems,
			// PDF 传页码；EPUB 仅传 spineIndex
			book?.fmt === 'pdf' ? { pdfPage } : { epubSpineIndex: epubSpineIndex },
		),
	// 依赖：目录、格式、PDF 页、EPUB spine
	[tocItems, book?.fmt, pdfPage, epubSpineIndex],
);
```

**改动后** · `apps/frontend/src/views/ebook/read.tsx`（当前，约 L1297–L1310）

```typescript
// 目录抽屉当前高亮项索引，随阅读位置重算
const activeTocIndex = useMemo(
	// 回调：传入扩展后的 EPUB 定位字段
	() =>
		findActiveTocItemIndex(
			// 当前书的目录项
			tocItems,
			// PDF 仍只传页码；EPUB 增加 CFI 与 Rendition 获取器
			book?.fmt === 'pdf'
				? { pdfPage }
				: {
						// 当前 EPUB spine 索引（state）
						epubSpineIndex: epubSpineIndex,
						// 阅读 CFI：优先 readingCfi，否则 ref 中最近一次 CFI
						epubCfi: readingCfi || currentEpubCfiRef.current,
						// 惰性取 rendition，供 tocActiveIndex DOM 视口回退
						getRendition: () => epubNavRef.current?.getRendition() ?? null,
					},
		),
	// 依赖：增加 readingCfi，CFI 变化时重算高亮
	[tocItems, book?.fmt, pdfPage, epubSpineIndex, readingCfi],
);
```

**变更摘要**：EPUB 分支传入 `epubCfi`、`getRendition`；deps 增加 `readingCfi`。

---

## 5. 行为变化与兼容性

| 维度 | 说明 |
|------|------|
| PDF | 无变化，仍按 `pdfPage` 线性扫描 |
| EPUB 单锚点/文件 | 与旧版一致（`same.length <= 1` 时行为等价） |
| EPUB 同 spine 多锚点 | **修复**：不再固定高亮最后一项 |
| 比较器全 0 | 跳过 CFI 分支，走 DOM 或首项兜底 |
| 破坏性 | 无 API 破坏；`findActiveTocItemIndex` 签名不变 |

---

## 6. 测试与回归建议

1. 同一 HTML 内 3+ 目录锚点：滚动到中间锚点，打开目录，高亮应对应中间项而非末项。
2. 无 `tocCfi` 的 EPUB：仅靠 DOM 锚点视口判定，逐项滚动验证。
3. 比较器异常环境：`compareCfi` 全 0 时不应高亮同文件最后一项。
4. PDF 阅读、单 spine 文件：高亮与改动前一致。
5. 听书/目录跳转后 `readingCfi` 更新：高亮应随 CFI 刷新（deps 含 `readingCfi`）。

---

## 7. 相关文档与代码索引

| 说明 | 路径 |
|------|------|
| 目录高亮初版 | `docs/ebook/电子书目录激活高亮.md` |
| 核心算法 | `apps/frontend/src/views/ebook/utils/common/tocActiveIndex.ts` |
| 阅读页接线 | `apps/frontend/src/views/ebook/read.tsx` |
| 滚动容器查询 | `apps/frontend/src/views/ebook/utils/epub/reader/epubScrolledNav.ts` |

---

（若与仓库最新源码不一致，以源码为准）
