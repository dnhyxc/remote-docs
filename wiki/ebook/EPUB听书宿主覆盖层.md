# EPUB 听当前：滚动容器浮层与跨段句间清除

## 延伸阅读

- [EPUB「听当前」逐句播放背景](EPUB听书句背景.md) — plain 偏移、TTS 回调与选区缓存（**绘制层已演进**，见本文）
- [EPUB 听当前与用户划线 DOM 协调](EPUB听书用户划线对账.md) — 播放层与用户划线隔离
- [EPUB 听当前播放自动跟随 FAB](EPUB听书自动跟随浮动按钮.md) — 手动滚动打断与回位按钮

## 1. 背景与目标

**用户视角**：选中跨 **换行/两段** 文字使用 **听当前** 时，上一段最后一句播完、下一段开始读时，上一句的 **淡黄色播放背景** 应立即消失；实际曾出现 **多句同时高亮**，直到整段播完才全部清除。

**根因**：旧版在 iframe 内用 **CSS Highlight → epub.js annotation → iframe body div** 三层绘制；跨段落换句时 annotation 的 SVG mark 在 `.marks-pane` 内 **detach 不彻底**，只跟踪单个 `activeListenAnnotation`，导致 mark **逐句累积**。

**目标**：

1. **单一绘制通道**：在 epub.js **滚动容器**（`.epub-container`）上挂 **一个浮层**，换句 `replaceChildren` 整层替换。
2. **句间必清**：`sentenceIndex` 变化、新 span、`end`+`isLastInSentence` 均触发清除。
3. **兼容清理**：启动/清除时仍 **purge** 旧版 CSS Highlight、listen 批注、iframe 内 div 残留。
4. **不碰用户划线**：仍 **禁止** `annotations.remove(cfi,'highlight')` 按 CFI 全局删 highlight。

## 2. 改动范围

| 路径 | 说明 |
| ---- | ---- |
| `apps/frontend/src/views/ebook/utils/epubListenSegmentOverlay.ts` | 容器浮层绘制、`purgeLegacyListenLayers`、`paintSerial`、句 index 跟踪 |
| `apps/frontend/src/views/ebook/hooks/useEbookQuoteListen.ts` | `onCadenceChunk` 传 `sentenceIndex`、句末 `end` 相清除 |

## 3. 实现思路

1. **坐标**：`getAccurateRangeLineClientRects(range)` 得 iframe 内行框 → 加 `iframe.getBoundingClientRect()` → 减 host 视口并加 `scrollLeft/Top`，得到容器内容坐标。
2. **绘制**：`ensureListenOverlayRoot` 在 host 下创建 `#moke-epub-listen-host-overlay`，按行 append 绝对定位 div；`paintListenRange` **先** `clearListenPaint` 再画。
3. **清除**：`clearListenPaint` = `purgeLegacyListenLayers` + host 浮层 `replaceChildren()`。
4. **句切换**：`showEpubListenPlainSpan` 比较 `lastSentenceIndex`，变化时递增 `paintSerial`、清层并重置 `plainStart/End`。
5. **回调顺序**：`useEbookQuoteListen` 在 `phase==='end'` 且 `isLastInSentence` 时清除；`phase==='start'` 时带 `sentenceIndex` 重画。
6. **异步滚动**：`paintPlainSpan` 滚入视口后用 `paintSerial` 丢弃过期重绘，避免旧句浮层被异步补画回来。

## 4. 关键代码对比与注释

### 4.1 `paintListenRange`（`apps/frontend/src/views/ebook/utils/epubListenSegmentOverlay.ts`）

**对比范围**：完整函数（绘制入口）。

**改动前** · `apps/frontend/src/views/ebook/utils/epubListenSegmentOverlay.ts`（基线，约 L287–L292）

```typescript
// 在 rendition 与 DOM Range 上绘制当前句播放背景（旧三层优先级）
function paintListenRange(rend: Rendition, range: Range): void {
	// 先清 CSS Highlight、detach 单个 active 批注、删 listen DOM、清 iframe div
	clearListenPaint(rend);
	// 优先 CSS Highlight API，成功则不再走后续层
	if (paintCssListenHighlight(range)) return;
	// 次选 epub.js highlight 批注（独立 class moke-epub-listen-bg）
	if (applyListenAnnotation(rend, range)) return;
	// 最后回退 iframe body 绝对定位 div 浮层
	paintDivListenOverlay(range);
}
```

**改动后** · `apps/frontend/src/views/ebook/utils/epubListenSegmentOverlay.ts`（当前，约 L337–L361）

```typescript
// 在滚动容器 host 浮层上绘制当前句（单一通道，换句整层替换）
function paintListenRange(rend: Rendition, range: Range): void {
	// 清 legacy 层 + host 浮层子节点，保证无跨段 mark 残留
	clearListenPaint(rend);
	// 确保 host 下存在 #moke-epub-listen-host-overlay 并同步宽高
	const root = ensureListenOverlayRoot(rend);
	// 解析 epub 连续滚动的 manager.container 作为坐标参照
	const host = resolveListenOverlayHost(rend);
	// host 或 root 不可用时放弃绘制（如无 rendition）
	if (!root || !host) return;
	// 将 range 各行 rect 换算为 host 内容区坐标
	const rects = rangeLineRectsInHost(range, host);
	// 逐行追加淡黄背景块
	for (const rect of rects) {
		// 创建不可点击的绝对定位 div
		const block = document.createElement('div');
		// 背景色与圆角，不拦截 pointer 事件
		block.style.cssText = `position:absolute;background:${EPUB_LISTEN_SEGMENT_FILL};pointer-events:none;border-radius:1px;`;
		// 相对 host 内容区左偏移
		block.style.left = `${rect.left}px`;
		// 相对 host 内容区顶偏移
		block.style.top = `${rect.top}px`;
		// 行宽
		block.style.width = `${rect.width}px`;
		// 行高
		block.style.height = `${rect.height}px`;
		// 挂到 host 浮层根节点
		root.appendChild(block);
	}
}
```

**变更摘要**：删除 iframe 内三层绘制，改为 **滚动容器单一浮层**；换句时 `clearListenPaint` 清空整层后再画当前句。

### 4.2 `clearListenPaint`（`apps/frontend/src/views/ebook/utils/epubListenSegmentOverlay.ts`）

**对比范围**：完整函数。

**改动前** · 基线，约 L228–L233

```typescript
// 清除播放背景各层（旧实现分散在 iframe 与 CSS registry）
function clearListenPaint(rend: Rendition): void {
	// 删除各 iframe document 的 CSS Highlight 名 moke-epub-listen-seg
	clearCssListenHighlight(rend);
	// 仅 detach 最近一次记录的 activeListenAnnotation
	detachActiveListenAnnotation(rend);
	// 按 LISTEN_DOM_SELECTOR 删 SVG g 节点（可能漏 marks-pane）
	removeListenDomGroups(rend);
	// 移除各 iframe 内 #moke-epub-listen-overlay
	clearDivListenOverlay(rend);
}
```

**改动后** · 当前，约 L337–L342

```typescript
// 清除播放背景：purge 历史层 + 清空 host 浮层
function clearListenPaint(rend: Rendition): void {
	// 扫 CSS Highlight、全部 listen 批注、marks-pane DOM、iframe 旧 div
	purgeLegacyListenLayers(rend);
	// host 浮层 replaceChildren，移除当前可见的播放行块
	resolveListenOverlayHost(rend)
		?.querySelector(`#${LISTEN_ROOT_ID}`)
		?.replaceChildren();
}
```

**变更摘要**：清除逻辑集中为 **purge 全量 listen 批注** + **host 浮层一次性清空**。

### 4.3 `showEpubListenPlainSpan`（`apps/frontend/src/views/ebook/utils/epubListenSegmentOverlay.ts`）

**对比范围**：完整导出函数。

**改动前** · 基线，约 L486–L491

```typescript
// 按 plain 句界偏移显示播放背景（无句 index 感知）
export function showEpubListenPlainSpan(
	plainStart: number,
	plainEnd: number,
): void {
	// 无活跃 session 时直接返回
	if (!session) return;
	// 委托 paintPlainSpan 解析 Range 并绘制
	paintPlainSpan(plainStart, plainEnd);
}
```

**改动后** · 当前，约 L592–L609

```typescript
// 按 plain 句界偏移显示播放背景，sentenceIndex 变化时强制清上一句
export function showEpubListenPlainSpan(
	plainStart: number,
	plainEnd: number,
	sentenceIndex = 0,
): void {
	// 无活跃 session 时直接返回
	if (!session) return;
	// 已播过至少一句且 TTS 句序号发生变化
	if (
		session.lastSentenceIndex >= 0 &&
		sentenceIndex !== session.lastSentenceIndex
	) {
		// 递增序列号，使进行中的异步滚入重绘失效
		paintSerial += 1;
		// 清 host 浮层与 legacy mark
		clearListenPaint(session.rend);
		// 重置 session 内 span 记录，使 paintPlainSpan 视为新 span
		session.plainStart = -1;
		session.plainEnd = -1;
	}
	// 记录当前 TTS 句序号供下次比较
	session.lastSentenceIndex = sentenceIndex;
	// 解析 plain 偏移为 DOM Range 并绘制
	paintPlainSpan(plainStart, plainEnd);
}
```

**变更摘要**：新增 **`sentenceIndex` 句界清除** 与 **`paintSerial` 防竞态**。

### 4.4 `useEbookQuoteListen` 内 `onCadenceChunk`（`apps/frontend/src/views/ebook/hooks/useEbookQuoteListen.ts`）

**对比范围**：`playPreferred` 的 `onCadenceChunk` 回调（摘录）。

**改动前** · 基线，约 L78–L90

```typescript
					// TTS 每个节奏段 start/end 回调
					onCadenceChunk: (event) => {
						// rendition 已销毁则忽略
						if (!rend) return;
						// 段开始：画当前句 plain 跨度
						if (event.phase === 'start') {
							showEpubListenPlainSpan(
								event.sentencePlainStart,
								event.sentencePlainEnd,
							);
							return;
						}
						// 段结束且为句内最后一段：清句 overlay
						if (event.isLastInSentence) {
							clearEpubListenSentenceOverlay();
						}
					},
```

**改动后** · 当前，约 L78–L91

```typescript
					// TTS 每个节奏段 start/end 回调
					onCadenceChunk: (event) => {
						// rendition 已销毁则忽略
						if (!rend) return;
						// 段结束相：句末清背景后 return，start 相再画下一句
						if (event.phase === 'end') {
							// 当前 chunk 是本句最后一个节奏段
							if (event.isLastInSentence) {
								// 清除 host 浮层播放背景
								clearEpubListenSentenceOverlay();
							}
							return;
						}
						// 段开始：带 sentenceIndex 触发句间清除与重绘
						showEpubListenPlainSpan(
							event.sentencePlainStart,
							event.sentencePlainEnd,
							event.sentenceIndex,
						);
					},
```

**变更摘要**：**先处理 `end` 再 `start`**；`start` 传入 **`event.sentenceIndex`** 驱动句界清除。

## 5. 兼容性与影响

- **连续滚动 / 分页**：host 取 `getEpubScrollContainer(rend)` 或 `manager.container`；分页模式若 host 不可用则静默不画（与旧版 div 回退类似）。
- **用户划线 / 想法**：播放层不再写入 iframe annotation，与用户 mark 冲突面更小；播完仍走 `onListenSessionEnd` → `syncReadingAnnotations`。
- **回归建议**：跨 `<p>` 选区听当前；单段内多子句；停止/重播；与用户划线叠加；relayout（改字号）后背景仍对齐。

## 6. 相关源码路径

| 说明 | 路径 |
| ---- | ---- |
| 播放浮层主模块 | `apps/frontend/src/views/ebook/utils/epubListenSegmentOverlay.ts` |
| TTS 回调接线 | `apps/frontend/src/views/ebook/hooks/useEbookQuoteListen.ts` |
| 滚动容器解析 | `apps/frontend/src/views/ebook/utils/epubScrolledNav.ts` |
| 行框几何 | `apps/frontend/src/views/ebook/utils/epubRangeGeometry.ts` |

---

（若与仓库最新源码不一致，以源码为准）
