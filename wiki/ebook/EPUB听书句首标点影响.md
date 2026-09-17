# EPUB 听读分句 — 句首中文标点

## 延伸阅读

- [EPUB听书句首标点影响.md](../impact/EPUB听书句首标点影响.md) — 本次改动的**影响面矩阵**与回归清单
- [developer/EPUB听书开发.md](./developer/EPUB听书开发.md) — 听当前 + 听书总手册（`buildSentenceOffsetSpans` 调用链）
- [EPUB听书播放器栏.md](./EPUB听书播放器栏.md) — 听书分句列表与播放条
- [EPUB引用听书.md](./EPUB引用听书.md) — 听当前入口与按句 TTS

**文档角色**：commit `58645d24` 在 `speech.ts` 内对 **句界算法** 的实现说明；影响面见 Influence-point 姊妹稿。

---

## 1. 背景与目标

### 1.1 问题

EPUB **听书**、**听当前** 与英语学习 TTS 共用 `buildSentenceOffsetSpans(plain)` 将正文 plain 文本切成 `{ start, end }[]` 句界。改前算法已处理 **句末** 中文标点 extend（闭合引号、重复叹号、省略号等），但对 **段首 / 句首** 中文标点未对称处理：

| 场景 | 改前行为 | 用户感知 |
|------|----------|----------|
| `……他走了。` | `……` 被单独切成一句 | 分句列表多一条空句；TTS 与淡黄背景错位 |
| `——他说完就走了。` | `——` 单独成句 | 同上 |
| `第一句。……第二句。` | 句中 `……` 被 **句末 extend** 吞入前句 | 第二句丢失段首省略号 |
| `完。"下一句。"` | 开引号 `"` 可能被前句 **TRAILING_CLOSER** 吞掉 | 下一句不从开引号起算 |

### 1.2 目标

- 与句末 extend **对称**：段首 `……`、`——`、开引号 / 开括号等 **归入本句**，不单拆一句。
- **不破坏** 既有句末闭合引号、重复叹号 extend 行为。
- **对外 API 不变**：`buildSentenceOffsetSpans(plain)` 签名与返回类型不变；调用方（听书 hook、听当前 overlay、cadence 分句）无需改动。

---

## 2. 改动范围

| 路径 | 变更 |
|------|------|
| `apps/frontend/src/utils/speech.ts` | `TRAILING_CLOSER` 收紧；新增句首 helper 组；`sentenceBoundaryEnd` 增 `segmentStart` 参数；`buildSentenceOffsetSpans` 调用 `computeSentenceSpanStart`；模块自检扩充 |

**未改**：`useEpubChapterListen`、`useEbookQuoteListen`、`epubListenSegmentOverlay`、`epubListenChapter` 等调用方；播放条 UI。

**分析基准**：`58645d24^`（父提交） vs `58645d24`（当前 HEAD）。

---

## 3. 实现思路

1. **句首 attach 与句末 extend 对称**  
   新增 `LEADING_OPENER_BEFORE_SENTENCE_START`、`isAttachableBeforeSentenceStart`、`consumeLeadingAttachableBeforeSentenceStart`，在 span 写入前通过 `computeSentenceSpanStart` 把段首标点 **左扩** `start`。

2. **段首省略号不当断句点**  
   `sentenceBoundaryEnd` 增加 `segmentStart`；当扫描到 `\u2026` / `...` 且 `isWithinSentenceLeadingAttachables` 为真时 **返回 -1**（不在此处断句），避免 `……他走了。` 拆成两句。

3. **句末 extend 不再吞 `\u2026`**  
   从 `isAttachableAfterSentenceEnd` / `consumeAttachableAfterSentenceEnd` 移除 `\u2026` 分支，修复 `第一句。……第二句。` 中省略号被前句 extend 的问题。

4. **TRAILING_CLOSER 去掉开引号 / 开括号**  
   改前 regex 含 `\u2018\u201c\u300c` 等 **开** 符号，句末 extend 可能把下一句开引号吞入前句；改后仅保留 **闭** 符号与 `]`。

5. **调用方零改动**  
   听书 / 听当前 / overlay 均通过 `buildSentenceOffsetSpans` 间接受益；句数、分句菜单、TTS 切片、DOM Range 锚点 **同源算法**。

6. **模块自检**  
   文件末尾 import 时执行断言，覆盖段首省略号、句中省略号、破折号、开引号等用例；与 ponytail 规则一致。

---

## 4. 关键代码对比与注释

### 4.1 `TRAILING_CLOSER_AFTER_SENTENCE_END` 常量

**对比范围**：句末闭合符号正则（单行常量）。

**改动前** · `apps/frontend/src/utils/speech.ts`（基线 `58645d24^`，约 L471–L473）

```typescript
// 句末标点后仍属同一句的闭合符号（弯引号/直角引号/全角引号等）
const TRAILING_CLOSER_AFTER_SENTENCE_END =
	/[\u2018\u2019\u201c\u201d\u0022\u0027\u300c\u300d\u300e\u300f\ufe41\ufe42\uff02\u00bb\u300b\u3011\uff09)]/u;
```

**改动后** · `apps/frontend/src/utils/speech.ts`（当前，约 L472–L474）

```typescript
// 句末标点后仍属同一句的闭合符号（不含开引号/开括号，避免吞掉下一句句首）
const TRAILING_CLOSER_AFTER_SENTENCE_END =
	/[\u2019\u201d\u0022\u0027\u300d\u300f\ufe42\uff02\u00bb\u300b\u3011\uff09)\]]/u;
```

**变更摘要**：从 regex 移除开引号（`\u2018\u201c\u300c\u300e\ufe41` 等）与 `[`；新增 `\]` 作为闭括号。

---

### 4.2 句首 attach helper 组（纯新增）

**对比范围**：`isLeadingEllipsisAt` 至 `isWithinSentenceLeadingAttachables` 五个私有函数（改前不存在）。

**改动后** · `apps/frontend/src/utils/speech.ts`（当前，约 L476–L553）

```typescript
// 句首仍属同一句的开引号/开括号/破折号/省略号（与句末 extend 对称）
const LEADING_OPENER_BEFORE_SENTENCE_START =
	/[\u2018\u201c\u300c\u300e\ufe41\uff02\u00ab\u300a\u3010\uff08([]/u;

// 判断 index 处是否为段首省略号（Unicode … 或 ASCII ... / ......）
function isLeadingEllipsisAt(trimmed: string, index: number): boolean {
	// 取当前字符，越界则非省略号
	const ch = trimmed[index];
	// 无字符则返回 false
	if (!ch) return false;
	// 单个 Unicode 省略号 U+2026
	if (ch === '\u2026') return true;
	// 连续六个 ASCII 点视为长省略
	if (ch === '.' && trimmed.startsWith('......', index)) return true;
	// 三个点且第四字符不是点（排除 ...... 的中间段）
	return (
		ch === '.' && trimmed.startsWith('...', index) && trimmed[index + 3] !== '.'
	);
}

// 判断 index 处字符是否可 attach 到即将开始的句子（句首标点）
function isAttachableBeforeSentenceStart(
	trimmed: string,
	index: number,
): boolean {
	// 取当前字符
	const ch = trimmed[index];
	// 无字符则不可 attach
	if (!ch) return false;
	// 开引号/开括号类符号
	if (LEADING_OPENER_BEFORE_SENTENCE_START.test(ch)) return true;
	// 省略号（…… 或 ...）
	if (isLeadingEllipsisAt(trimmed, index)) return true;
	// 中文破折号 ——（两个 U+2014 或 ASCII --）
	if (ch === '-' && trimmed.startsWith('——', index)) return true;
	// ASCII 双连字符破折号
	if (ch === '-' && trimmed.startsWith('--', index)) return true;
	// 其余字符不属于句首 attach
	return false;
}

// 从 index 起消费一段句首 attach 字符，返回消费后的下标
function consumeLeadingAttachableBeforeSentenceStart(
	trimmed: string,
	index: number,
): number {
	// 当前字符（调用方保证 index 合法）
	const ch = trimmed[index]!;
	// 中文破折号占 2 码元
	if (ch === '-' && trimmed.startsWith('——', index)) return index + 2;
	// ASCII -- 占 2 码元
	if (ch === '-' && trimmed.startsWith('--', index)) return index + 2;
	// 省略号分支
	if (isLeadingEllipsisAt(trimmed, index)) {
		// Unicode 省略号：连续吞掉多个 U+2026
		if (ch === '\u2026') {
			// 从 index 向后扫描
			let j = index;
			// 直到非 U+2026
			while (j < trimmed.length && trimmed[j] === '\u2026') j += 1;
			// 返回省略号段结束位置
			return j;
		}
		// 六个 ASCII 点
		if (ch === '.' && trimmed.startsWith('......', index)) return index + 6;
		// 三个 ASCII 点
		return index + 3;
	}
	// 开引号/开括号：单码元消费
	if (LEADING_OPENER_BEFORE_SENTENCE_START.test(ch)) return index + 1;
	// 兜底前进 1（不应常走到）
	return index + 1;
}

// 句首标点前扩 span.start（开引号、……、—— 等归入本句，不单拆一句）
function computeSentenceSpanStart(
	trimmed: string,
	segmentStart: number,
	contentStart: number,
): number {
	// 从 segment 起点向 contentStart 扫描句首 attach
	let pos = segmentStart;
	// 未到达正文内容起点前持续
	while (pos < contentStart) {
		// 跳过 attach 之间的空白
		while (pos < contentStart && /\s/u.test(trimmed[pos]!)) pos += 1;
		// 已到 contentStart 则结束
		if (pos >= contentStart) break;
		// 当前非句首 attach 则停止左扩
		if (!isAttachableBeforeSentenceStart(trimmed, pos)) break;
		// 消费一段 attach（引号、省略号、破折号等）
		pos = consumeLeadingAttachableBeforeSentenceStart(trimmed, pos);
	}
	// 若左扩成功则返回 segmentStart，否则保持 trim 后的 contentStart
	return pos > segmentStart ? segmentStart : contentStart;
}

// 判断 index 是否落在 segmentStart 起的句首 attach 区间内（用于省略号不当断点）
function isWithinSentenceLeadingAttachables(
	trimmed: string,
	index: number,
	segmentStart: number,
): boolean {
	// 从 segment 起点模拟 consume 路径
	let pos = segmentStart;
	// 扫描直到超过 index 或无法继续
	while (pos <= index && pos < trimmed.length) {
		// 跳过空白
		while (pos < trimmed.length && /\s/u.test(trimmed[pos]!)) pos += 1;
		// 空白后已超过 index 则不在 attach 内
		if (pos > index) return false;
		// 非 attach 起点则 index 不在句首 attach 区
		if (!isAttachableBeforeSentenceStart(trimmed, pos)) return false;
		// 本段 attach 结束位置
		const next = consumeLeadingAttachableBeforeSentenceStart(trimmed, pos);
		// index 落在此段 attach 内
		if (index < next) return true;
		// 继续下一段 attach
		pos = next;
	}
	// 扫完仍未命中
	return false;
}
```

**变更摘要**：全新句首 attach 管线；与句末 `extendSentenceBoundaryEnd` 对称，供 `buildSentenceOffsetSpans` 与 `sentenceBoundaryEnd` 共用。

---

### 4.3 `isAttachableAfterSentenceEnd` 与 `consumeAttachableAfterSentenceEnd`

**对比范围**：两个私有函数完整定义。

**改动前** · `apps/frontend/src/utils/speech.ts`（基线，约 L475–L517）

```typescript
// 判断 index 处是否可在句末 extend 中继续吞并
function isAttachableAfterSentenceEnd(trimmed: string, index: number): boolean {
	// 当前字符
	const ch = trimmed[index];
	// 越界则不可 attach
	if (!ch) return false;
	// 终止符本身可 extend（重复叹号等）
	if (SENTENCE_TERMINATOR.test(ch)) return true;
	// 闭合引号/括号
	if (TRAILING_CLOSER_AFTER_SENTENCE_END.test(ch)) return true;
	// Unicode 省略号 U+2026 也可在句末 extend（改前会导致句中 …… 被前句吞掉）
	if (ch === '\u2026') return true;
	// 六个 ASCII 点
	if (ch === '.' && trimmed.startsWith('......', index)) return true;
	// 三个 ASCII 点（非第四个点）
	if (
		ch === '.' &&
		trimmed.startsWith('...', index) &&
		trimmed[index + 3] !== '.'
	) {
		return true;
	}
	// 其余不可 attach
	return false;
}

// 从 index 消费一段句末 attach，返回消费后下标
function consumeAttachableAfterSentenceEnd(
	trimmed: string,
	index: number,
): number {
	// 当前字符
	const ch = trimmed[index]!;
	// 终止符：连续吞掉多个
	if (SENTENCE_TERMINATOR.test(ch)) {
		// 起始下标
		let j = index;
		// 向后扫描终止符
		while (j < trimmed.length && SENTENCE_TERMINATOR.test(trimmed[j]!)) j += 1;
		// 返回终止符段结束位置
		return j;
	}
	// Unicode 省略号：连续吞（改前行为）
	if (ch === '\u2026') {
		// 起始
		let j = index;
		// 连续 U+2026
		while (j < trimmed.length && trimmed[j] === '\u2026') j += 1;
		// 结束位置
		return j;
	}
	// 六个 ASCII 点
	if (ch === '.' && trimmed.startsWith('......', index)) return index + 6;
	// 三个 ASCII 点
	if (
		ch === '.' &&
		trimmed.startsWith('...', index) &&
		trimmed[index + 3] !== '.'
	) {
		return index + 3;
	}
	// 闭合符号单码元
	if (TRAILING_CLOSER_AFTER_SENTENCE_END.test(ch)) return index + 1;
	// 无法消费则原样返回 index
	return index;
}
```

**改动后** · `apps/frontend/src/utils/speech.ts`（当前，约 L555–L592）

```typescript
// 判断 index 处是否可在句末 extend 中继续吞并
function isAttachableAfterSentenceEnd(trimmed: string, index: number): boolean {
	// 当前字符
	const ch = trimmed[index];
	// 越界则不可 attach
	if (!ch) return false;
	// 终止符本身可 extend（重复叹号等）
	if (SENTENCE_TERMINATOR.test(ch)) return true;
	// 闭合引号/括号（已不含开引号）
	if (TRAILING_CLOSER_AFTER_SENTENCE_END.test(ch)) return true;
	// ponytail: 省略号只作句末断点，不在 extend 里吞掉下一句段首的 ……
	// 六个 ASCII 点仍可在句末 extend
	if (ch === '.' && trimmed.startsWith('......', index)) return true;
	// 三个 ASCII 点
	if (
		ch === '.' &&
		trimmed.startsWith('...', index) &&
		trimmed[index + 3] !== '.'
	) {
		return true;
	}
	// 其余不可 attach（含 U+2026，改后不在 extend 中处理）
	return false;
}

// 从 index 消费一段句末 attach，返回消费后下标
function consumeAttachableAfterSentenceEnd(
	trimmed: string,
	index: number,
): number {
	// 当前字符
	const ch = trimmed[index]!;
	// 终止符：连续吞掉多个
	if (SENTENCE_TERMINATOR.test(ch)) {
		// 起始下标
		let j = index;
		// 向后扫描终止符
		while (j < trimmed.length && SENTENCE_TERMINATOR.test(trimmed[j]!)) j += 1;
		// 返回终止符段结束位置
		return j;
	}
	// 六个 ASCII 点（U+2026 分支已删除）
	if (ch === '.' && trimmed.startsWith('......', index)) return index + 6;
	// 三个 ASCII 点
	if (
		ch === '.' &&
		trimmed.startsWith('...', index) &&
		trimmed[index + 3] !== '.'
	) {
		return index + 3;
	}
	// 闭合符号单码元
	if (TRAILING_CLOSER_AFTER_SENTENCE_END.test(ch)) return index + 1;
	// 无法消费则原样返回 index
	return index;
}
```

**变更摘要**：移除 `\u2026` 的句末 extend 分支，避免 `第一句。……第二句。` 错位；ASCII `...` / `......` 句末 extend 保留。

---

### 4.4 `sentenceBoundaryEnd`

**对比范围**：`function sentenceBoundaryEnd` 全函数。

**改动前** · `apps/frontend/src/utils/speech.ts`（基线，约 L538–L557）

```typescript
// 句末边界（trimmed plain 内下标，不含边界字符之后的内容）
function sentenceBoundaryEnd(trimmed: string, i: number): number {
	// 当前扫描字符
	const ch = trimmed[i];
	// 无字符则非边界
	if (!ch) return -1;
	// 边界结束位置（exclusive），-1 表示 i 处非断点
	let end = -1;
	// 终止符：边界为 i+1
	if (SENTENCE_TERMINATOR.test(ch)) end = i + 1;
	// Unicode 省略号：连续吞并后作为边界（段首 …… 也会在此断句，改前 bug）
	else if (ch === '\u2026') {
		// 从 i+1 向后
		let j = i + 1;
		// 连续 U+2026
		while (j < trimmed.length && trimmed[j] === '\u2026') j += 1;
		// 边界为省略号段之后
		end = j;
	} else if (ch === '.' && trimmed.startsWith('......', i)) end = i + 6;
	else if (
		ch === '.' &&
		trimmed.startsWith('...', i) &&
		trimmed[i + 3] !== '.'
	) {
		end = i + 3;
	}
	// 非断点字符
	if (end < 0) return -1;
	// 句末 extend（闭合引号、重复叹号等）
	return extendSentenceBoundaryEnd(trimmed, end);
}
```

**改动后** · `apps/frontend/src/utils/speech.ts`（当前，约 L613–L646）

```typescript
// 句末边界（trimmed plain 内下标，不含边界字符之后的内容）
function sentenceBoundaryEnd(
	trimmed: string,
	i: number,
	segmentStart: number,
): number {
	// 当前扫描字符
	const ch = trimmed[i];
	// 无字符则非边界
	if (!ch) return -1;
	// 边界结束位置（exclusive）
	let end = -1;
	// 终止符：边界为 i+1
	if (SENTENCE_TERMINATOR.test(ch)) end = i + 1;
	// Unicode 省略号
	else if (ch === '\u2026') {
		// 若 i 落在当前 segment 的句首 attach 内，不在此断句
		if (isWithinSentenceLeadingAttachables(trimmed, i, segmentStart)) {
			return -1;
		}
		// 否则作为句末省略号断点
		let j = i + 1;
		while (j < trimmed.length && trimmed[j] === '\u2026') j += 1;
		end = j;
	} else if (ch === '.' && trimmed.startsWith('......', i)) {
		// ASCII 长省略：段首 attach 内不断句
		if (isWithinSentenceLeadingAttachables(trimmed, i, segmentStart)) {
			return -1;
		}
		end = i + 6;
	} else if (
		ch === '.' &&
		trimmed.startsWith('...', i) &&
		trimmed[i + 3] !== '.'
	) {
		// ASCII 三点点省略：段首 attach 内不断句
		if (isWithinSentenceLeadingAttachables(trimmed, i, segmentStart)) {
			return -1;
		}
		end = i + 3;
	}
	// 非断点字符
	if (end < 0) return -1;
	// 句末 extend
	return extendSentenceBoundaryEnd(trimmed, end);
}
```

**变更摘要**：新增 `segmentStart` 参数；段首省略号经 `isWithinSentenceLeadingAttachables` 判定后 **跳过断句**。

---

### 4.5 `buildSentenceOffsetSpans`

**对比范围**：`export function buildSentenceOffsetSpans` 全函数。

**改动前** · `apps/frontend/src/utils/speech.ts`（基线，约 L560–L599）

```typescript
// 与 DOM 锚点 / TTS sentenceIndex 对齐的句界（plain 内 start/end 偏移）
export function buildSentenceOffsetSpans(
	plain: string,
): Array<{ start: number; end: number }> {
	// 去掉首尾空白后的 plain
	const trimmed = plain.trim();
	// 空文本无句界
	if (!trimmed) return [];

	// 累积句界 span 数组
	const spans: Array<{ start: number; end: number }> = [];
	// 当前 segment 在 trimmed 内的起始下标
	let rawStart = 0;

	// 逐字符扫描寻找句末边界
	for (let i = 0; i < trimmed.length; i += 1) {
		// 在 i 处求句末边界（改前无 segmentStart）
		const boundary = sentenceBoundaryEnd(trimmed, i);
		// i 非断点则继续
		if (boundary < 0) continue;

		// rawStart 到 boundary 的切片
		const slice = trimmed.slice(rawStart, boundary);
		// 去空白后的有效内容
		const content = slice.trim();
		// 有内容才写入 span
		if (content) {
			// slice 左侧空白长度
			const lead = slice.length - slice.trimStart().length;
			// slice 右侧空白长度
			const trail = slice.length - slice.trimEnd().length;
			// start 为 trim 后内容起点，未做句首左扩
			spans.push({ start: rawStart + lead, end: boundary - trail });
		}

		// 下一句 segment 从 boundary 起
		rawStart = boundary;
		// 跳过 boundary 后空白
		while (rawStart < trimmed.length && /\s/u.test(trimmed[rawStart]!)) {
			rawStart += 1;
		}
		// for 循环跳到 boundary 之后（-1 因循环末尾 i+=1）
		i = boundary - 1;
	}

	// 处理尾部未断句的剩余文本
	if (rawStart < trimmed.length) {
		// 尾部去空白
		const tail = trimmed.slice(rawStart).trim();
		if (tail) {
			// 尾部左侧空白
			const lead =
				trimmed.slice(rawStart).length -
				trimmed.slice(rawStart).trimStart().length;
			// 尾部 span，start 未左扩
			spans.push({ start: rawStart + lead, end: trimmed.length });
		}
	}

	// 无 span 时整段作为一句
	return spans.length > 0 ? spans : [{ start: 0, end: trimmed.length }];
}
```

**改动后** · `apps/frontend/src/utils/speech.ts`（当前，约 L649–L698）

```typescript
// 与 DOM 锚点 / TTS sentenceIndex 对齐的句界（plain 内 start/end 偏移）
export function buildSentenceOffsetSpans(
	plain: string,
): Array<{ start: number; end: number }> {
	// 去掉首尾空白后的 plain
	const trimmed = plain.trim();
	// 空文本无句界
	if (!trimmed) return [];

	// 累积句界 span 数组
	const spans: Array<{ start: number; end: number }> = [];
	// 当前 segment 在 trimmed 内的起始下标
	let rawStart = 0;

	// 逐字符扫描寻找句末边界
	for (let i = 0; i < trimmed.length; i += 1) {
		// 传入 rawStart 供段首省略号判定
		const boundary = sentenceBoundaryEnd(trimmed, i, rawStart);
		// i 非断点则继续
		if (boundary < 0) continue;

		// rawStart 到 boundary 的切片
		const slice = trimmed.slice(rawStart, boundary);
		// 去空白后的有效内容
		const content = slice.trim();
		// 有内容才写入 span
		if (content) {
			// slice 左侧空白长度
			const lead = slice.length - slice.trimStart().length;
			// slice 右侧空白长度
			const trail = slice.length - slice.trimEnd().length;
			// 句首 attach 左扩 start（……、——、开引号等）
			const start = computeSentenceSpanStart(
				trimmed,
				rawStart,
				rawStart + lead,
			);
			// 写入 span
			spans.push({ start, end: boundary - trail });
		}

		// 下一句 segment 从 boundary 起
		rawStart = boundary;
		// 跳过 boundary 后空白
		while (rawStart < trimmed.length && /\s/u.test(trimmed[rawStart]!)) {
			rawStart += 1;
		}
		// for 循环跳到 boundary 之后
		i = boundary - 1;
	}

	// 处理尾部未断句的剩余文本
	if (rawStart < trimmed.length) {
		// 尾部去空白
		const tail = trimmed.slice(rawStart).trim();
		if (tail) {
			// 尾部左侧空白
			const lead =
				trimmed.slice(rawStart).length -
				trimmed.slice(rawStart).trimStart().length;
			// 尾部也做句首左扩
			const start = computeSentenceSpanStart(
				trimmed,
				rawStart,
				rawStart + lead,
			);
			// 写入尾部 span
			spans.push({ start, end: trimmed.length });
		}
	}

	// 无 span 时整段作为一句
	return spans.length > 0 ? spans : [{ start: 0, end: trimmed.length }];
}
```

**变更摘要**：`sentenceBoundaryEnd` 传入 `rawStart`；span 写入前调用 `computeSentenceSpanStart` 左扩句首标点。

---

### 4.6 模块自检块

**对比范围**：文件末尾 `buildSentenceOffsetSpans` 断言 IIFE（叹号/引号用例之后的新增用例）。

**改动前** · `apps/frontend/src/utils/speech.ts`（基线，约 L1313–L1332）

```typescript
// 块作用域：句界回归用例（import 时执行一次）
{
	// 叹号 + 闭合引号 extend 用例
	const cases = [
		'赞叹一声：\u201c阿弥陀佛！\u201d这个在政治上',
		'赞叹一声：\u201c阿弥陀佛！ \u201d这个在政治上',
		'太好了！！！\u201d接下来',
	];
	// 逐条校验
	for (const plain of cases) {
		// 分句
		const spans = buildSentenceOffsetSpans(plain);
		// trim 后 plain
		const trimmed = plain.trim();
		// 第一句文本
		const first = trimmed.slice(spans[0]?.start ?? 0, spans[0]?.end ?? 0);
		// 须至少两句且第一句含叹号
		if (spans.length < 2 || !first.includes('！')) {
			throw new Error(`[speech] 叹号句界异常: ${plain}`);
		}
		// 第一句须以闭引号结尾
		if (!first.endsWith('\u201d')) {
			throw new Error(`[speech] 闭合引号未纳入前句: ${plain}`);
		}
		// 第二句须以「这」或「接下」开头
		if (!trimmed.slice(spans[1]?.start ?? 0).match(/^这|接下/)) {
			throw new Error(`[speech] 叹号后句界错位: ${plain}`);
		}
	}
}
```

**改动后** · `apps/frontend/src/utils/speech.ts`（当前，约 L1413–L1467）

```typescript
// 块作用域：句界回归用例（import 时执行一次）
{
	// 叹号 + 闭合引号 extend 用例
	const cases = [
		'赞叹一声：\u201c阿弥陀佛！\u201d这个在政治上',
		'赞叹一声：\u201c阿弥陀佛！ \u201d这个在政治上',
		'太好了！！！\u201d接下来',
	];
	// 逐条校验句末 extend 行为
	for (const plain of cases) {
		// 分句
		const spans = buildSentenceOffsetSpans(plain);
		// trim 后 plain
		const trimmed = plain.trim();
		// 第一句文本
		const first = trimmed.slice(spans[0]?.start ?? 0, spans[0]?.end ?? 0);
		// 须至少两句且第一句含叹号
		if (spans.length < 2 || !first.includes('！')) {
			throw new Error(`[speech] 叹号句界异常: ${plain}`);
		}
		// 第一句须以闭引号结尾
		if (!first.endsWith('\u201d')) {
			throw new Error(`[speech] 闭合引号未纳入前句: ${plain}`);
		}
		// 第二句须以「这」或「接下」开头
		if (!trimmed.slice(spans[1]?.start ?? 0).match(/^这|接下/)) {
			throw new Error(`[speech] 叹号后句界错位: ${plain}`);
		}
	}
	// 句中省略号应并入下一句
	const ellipsisMid = buildSentenceOffsetSpans('第一句。……第二句。');
	// trim 后全文
	const emMid = '第一句。……第二句。'.trim();
	// 第二句 span
	const e1 = ellipsisMid[1];
	// 须两句且第二句以 ……第二句 开头
	if (
		ellipsisMid.length !== 2 ||
		emMid.slice(e1?.start ?? 0, e1?.end ?? 0) !== '……第二句'
	) {
		throw new Error('[speech] 句中省略号应并入下一句');
	}
	// 段首破折号应并入本句
	const dashStart = buildSentenceOffsetSpans('——他说完就走了。');
	// 第一句 span
	const d0 = dashStart[0];
	// 须一句且含完整破折号句
	if (
		dashStart.length !== 1 ||
		'——他说完就走了。'.trim().slice(d0?.start ?? 0, d0?.end ?? 0) !==
			'——他说完就走了'
	) {
		throw new Error('[speech] 句首破折号应并入本句');
	}
	// 段首省略号不应单独成句
	const leading = buildSentenceOffsetSpans('……他走了。');
	// trim 后全文
	const leadingText = '……他走了。'.trim();
	// 第一句 span
	const l0 = leading[0];
	// 须一句、start 为 0、文本为 ……他走了
	if (
		leading.length !== 1 ||
		l0?.start !== 0 ||
		leadingText.slice(l0.start, l0.end) !== '……他走了'
	) {
		throw new Error('[speech] 段首省略号不应单独成句');
	}
	// 句首开引号应归入下一句
	const openerNext = buildSentenceOffsetSpans('完。\u201c下一句。\u201d');
	// trim 后全文
	const t2 = '完。\u201c下一句。\u201d'.trim();
	// 第二句文本
	const s1 = t2.slice(openerNext[1]?.start ?? 0, openerNext[1]?.end ?? 0);
	// 须两句且第二句以开引号开头
	if (openerNext.length !== 2 || !s1.startsWith('\u201c')) {
		throw new Error('[speech] 句首开引号应归入下一句');
	}
}
```

**变更摘要**：在原有叹号/闭引号用例后新增四句界回归（句中省略号、段首破折号、段首省略号、句首开引号）。

---

## 5. 兼容性与影响

| 维度 | 说明 |
|------|------|
| 对外 API | **不变** — `buildSentenceOffsetSpans(plain)` 签名与返回类型不变 |
| 听书 / 听当前 | **有条件变化** — 含段首 `……` / `——` / 开引号的章节或选区，句数与 span 与改前不同；**预期修复** |
| 句末 extend | **主路径不变** — 叹号 + 闭引号、重复叹号等原有自检仍通过 |
| 英语学习 cadence | **有条件变化** — 长文含中文段首标点时段落边界可能变 |
| 用户划线 / 想法 | **无影响** — 无调用链 |

详细影响面矩阵见 [Influence-point 姊妹稿](../impact/EPUB听书句首标点影响.md)。

### 建议回归

1. 听书：章节含 `……` 段首、对话开引号 — 分句列表句数与正文一致，播放背景对齐。
2. 听当前：选中 `——他说完就走了。` — 单句播放，无空句。
3. `第一句。……第二句。` — 第二句 TTS 含 `……`。
4. 原有叹号 + 闭引号书摘 — 句界与改前一致。

---

## 6. 相关源码路径

| 说明 | 路径 |
|------|------|
| 句界算法（本轮改动） | `apps/frontend/src/utils/speech.ts` |
| 听书分句 | `apps/frontend/src/views/ebook/hooks/useEpubChapterListen.ts` |
| 听当前分句 | `apps/frontend/src/views/ebook/hooks/useEbookQuoteListen.ts` |
| 选区 DOM 句索引 | `apps/frontend/src/views/ebook/utils/epubListenSegmentOverlay.ts` |

---

（若与仓库最新源码不一致，以源码为准）
