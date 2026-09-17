# EPUB 想法虚线：跨段落空行误画修复

## 文档角色

**增量专题**：跨多个段落写「读书想法」时，段落之间的**空行**不应出现琥珀虚线；修复 `collectRangeTextClientRects` 对纯空白文本片段取 `clientRect` 的问题，并加强 `resolveMarkSvgLineSegments` 校正快路径。

**姊妹文档**：[EPUB想法下划线实现.md](./EPUB想法下划线实现.md)、[EPUB想法部分重叠.md](./EPUB想法部分重叠.md)。

---

## 1. 背景与目标

### 1.1 问题

用户跨段落选中正文（中间含空行）写想法后，虚线在**无文字的空白行**上出现横贯虚线，与视觉选区不符。

### 1.2 根因

- DOM `Range` 在文档序上穿过段落间空白文本节点时，`getClientRects()` 对**仅空白**片段仍可能返回整行宽度矩形。
- epub.js 初始 mark rect 含空行；旧快路径仅比较 `existing.length === accurate.length`，行数偶然相等时跳过校正。

### 1.3 目标

- 收集 client rect 时跳过无可见字符的文本片段。
- patch 阶段对 CFI 还原的 Range 先做 `normalizeSelectionRangeForEpub`。
- 快路径增加总宽度比对，空行 rect 被去掉后强制用精确几何替换。

---

## 2. 改动范围

- `apps/frontend/src/views/ebook/utils/epubRangeGeometry.ts`

---

## 3. 实现思路

1. **`containsNonWhitespaceText`**：判断文本节点片段内是否存在非 `\s` 字符。
2. **`collectRangeTextClientRects`**：遍历片段时，纯空白片段直接 `return`，不 `getClientRects`。
3. **`resolveHighlightSvgLineSegments`**：CFI → DOM 后先 `normalizeSelectionRangeForEpub`，再算精确行几何。
4. **`segmentsRoughlyMatch`**：比较已有 rect 与精确几何的宽度总和；不一致则不走快路径。
5. **`resolveMarkSvgLineSegments`**：快路径同时要求行数一致且 `segmentsRoughlyMatch`。

---

## 4. 关键代码对比与注释

### 4.1 `containsNonWhitespaceText`（`apps/frontend/src/views/ebook/utils/epubRangeGeometry.ts`）

**对比范围**：新增辅助函数全文。

**改动前** · `apps/frontend/src/views/ebook/utils/epubRangeGeometry.ts`（基线）

无此函数；`collectRangeTextClientRects` 对所有文本片段一律取 rect。

**改动后** · `apps/frontend/src/views/ebook/utils/epubRangeGeometry.ts`（当前，约 L216–L224）

```typescript
// 判断文本节点片段 [start,end) 内是否含非空白字符
function containsNonWhitespaceText(node: Text, start: number, end: number): boolean {
	// 从左到右扫描片段内每个字符索引
	for (let i = start; i < end; i++) {
		// 取出当前字符（可能为 undefined 若索引越界）
		const ch = node.data[i];
		// 字符存在且不是 Unicode 空白类时视为可见文本
		if (ch && !/\s/u.test(ch)) return true;
	}
	// 片段内全是空白或为空
	return false;
}
```

**变更摘要**：新增空白检测，供收集 rect 前过滤段落间隙。

---

### 4.2 `collectRangeTextClientRects` 片段过滤（同文件）

**对比范围**：`forEachTextNodeInRange` 回调开头。

**改动前** · 约 L237–L246

```typescript
	forEachTextNodeInRange(range, (node, start, end) => {
		const segment = doc.createRange();
		segment.setStart(node, start);
		segment.setEnd(node, end);
		for (const rect of segment.getClientRects()) {
			if (rect.width > 0.5 && rect.height > 0.5) {
				rects.push(rect);
			}
		}
	});
```

**改动后** · 约 L245–L256

```typescript
	forEachTextNodeInRange(range, (node, start, end) => {
		// 纯空白片段（空行缩进等）不参与 rect 收集，避免空行虚线
		if (!containsNonWhitespaceText(node, start, end)) return;

		const segment = doc.createRange();
		segment.setStart(node, start);
		segment.setEnd(node, end);
		for (const rect of segment.getClientRects()) {
			if (rect.width > 0.5 && rect.height > 0.5) {
				rects.push(rect);
			}
		}
	});
```

**变更摘要**：在创建子 Range 前跳过空白片段。

---

### 4.3 `resolveHighlightSvgLineSegments` 与 `resolveMarkSvgLineSegments`（同文件）

**改动前** · `resolveHighlightSvgLineSegments` 约 L369–L372

```typescript
	const range = resolveCfiDomRange(rend, cfiRange.trim());
	if (!range) return [];
```

**改动后** · 约 L379–L384

```typescript
	const rawRange = resolveCfiDomRange(rend, cfiRange.trim());
	if (!rawRange) return [];

	const range = normalizeSelectionRangeForEpub(rawRange) ?? rawRange;
```

**改动前** · `resolveMarkSvgLineSegments` 快路径约 L422–L428

```typescript
		if (accurate.length > 0) {
			// 行数一致说明已校正过（含滚动同步），直接读 rect 属性
			if (existing.length === accurate.length) {
				return existing;
			}
			return accurate;
		}
```

**改动后** · 约 L434–L444

```typescript
		if (accurate.length > 0) {
			// 行数一致且总宽接近说明已校正（滚动 patch 快路径）；否则用精确几何替换 epub.js 空行 rect
			if (
				existing.length === accurate.length &&
				segmentsRoughlyMatch(existing, accurate)
			) {
				return existing;
			}
			return accurate;
		}
```

**改动后** · 新增 `segmentsRoughlyMatch` 约 L452–L460

```typescript
function segmentsRoughlyMatch(
	existing: SvgLineSegment[],
	accurate: SvgLineSegment[],
): boolean {
	if (existing.length !== accurate.length) return false;
	const sumWidth = (segments: SvgLineSegment[]) =>
		segments.reduce((sum, s) => sum + s.width, 0);
	return Math.abs(sumWidth(existing) - sumWidth(accurate)) < 1;
}
```

**变更摘要**：规范化 CFI Range；快路径增加宽度总和校验，避免空行 rect 残留。

---

## 5. 兼容性与影响

| 项 | 说明 |
| ---- | ---- |
| 用户划线 | 共用 `getAccurateRangeLineClientRects`，空行误划一并改善 |
| 已有想法 | 下次 patch（滚动/翻页）后空行虚线自动消失，无需重存 |
| 性能 | 快路径仍可用，仅多一次宽度求和 |

### 5.1 回归建议

- 跨两段以上正文写想法：虚线仅覆盖有字行。
- 单段、嵌套选区虚线行为与改前一致。
- 快速滚动后虚线位置仍正确。

---

## 6. 相关源码路径

| 说明 | 路径 |
| ---- | ---- |
| 选区几何 | `apps/frontend/src/views/ebook/utils/epubRangeGeometry.ts` |
| 想法虚线 patch | `apps/frontend/src/views/ebook/utils/epubThoughtAnnotations.ts` |

---

若与仓库最新源码不一致，以源码为准。
