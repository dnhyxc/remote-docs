# EPUB 听书：目录/底栏切章按锚点 CFI 起播（`mode: 'after'`）

**文档角色**：听书时从目录或底栏切章后，按跳转目标 CFI「处或之后」的第一句起播，避免落在整 HTML 第 0 句或上一节末句。

**延伸阅读**：[EPUB听书目录章节重启.md](./EPUB听书目录章节重启.md)（切章重开听书主链路）、[EPUB目录CFI导航.md](./EPUB目录CFI导航.md)（目录 CFI 跳转）、[EPUB听书栏播放头目录.md](./EPUB听书栏播放头目录.md)（底栏播放头与目录）

---

## 1. 背景与目标

### 1.1 问题

| 场景 | 旧行为 | 期望 |
|------|--------|------|
| 听书中点目录子锚点（同 HTML 多节） | `restartFromChapterStart` 设 `resolveStartCfiRef = false`，固定 **句 0** | 从 **锚点处或之后第一句** 起播 |
| 从当前位置开听（`startFromCurrentPosition`） | `resolveListenStartSentence` 从后往前找 CFI **左侧**最后一句（`before`） | 保持续听语义不变 |
| 目录切章与续听共用解析函数 | 第 4 参仅为 `sentenceRanges?`，无法区分模式 | 第 4 参改为 `opts?: { sentenceRanges?; mode? }`，目录用 `after` |

### 1.2 目标

1. `resolveListenStartSentence` 支持 `mode: 'before' | 'after'`。
2. 新增 `resolveStartCfiModeRef`：目录/底栏切章设 `'after'`，当前位置听书设 `'before'`。
3. `restartFromChapterStart` 启用 CFI 解析（`resolveStartCfiRef = true`）并设 `mode = 'after'`。

---

## 2. 改动范围

| 路径 | 说明 |
|------|------|
| `apps/frontend/src/views/ebook/utils/epub/listen/epubListenChapter.ts` | `resolveListenStartSentence` 第 4 参改为 opts；新增 `after` 分支 |
| `apps/frontend/src/views/ebook/hooks/useEpubChapterListen.ts` | `resolveStartCfiModeRef`；`applySection` 传 `mode`；`restartFromChapterStart` 启用 after |

---

## 3. 实现思路

1. **`before`（默认）**：从后往前，`Range.END_TO_START` 相对 CFI ≤ 0 的最后一句——适合「从当前阅读位置续听」。
2. **`after`**：从前往后，命中「句首 ≥ CFI」或「句内含 CFI」的第一句——适合「目录锚点起播」。
3. **模式传递**：`restartFromChapterStart` 设 `resolveStartCfiRef = true` + `resolveStartCfiModeRef = 'after'`；`applySection` 消费后重置为 `before`。
4. **与旧专题关系**：取代 [EPUB听书目录章节重启.md](./EPUB听书目录章节重启.md) 中「固定句 0」策略，改为 CFI 定位起播句。

---

## 4. 关键代码对比与注释

### 4.1 `resolveListenStartSentence`（`apps/frontend/src/views/ebook/utils/epub/listen/epubListenChapter.ts`）

**对比范围**：导出函数全定义（基线约 L471–L517；当前约 L471–L517）。

**改动前** · `apps/frontend/src/views/ebook/utils/epub/listen/epubListenChapter.ts`（基线，约 L471–L517）

```typescript
// 根据 startCfi 在可见节内反查起播句索引
export function resolveListenStartSentence(
	// epubjs 渲染实例
	rend: Rendition,
	// 当前可见朗读节（含 outerRange、plain 文本）
	section: VisibleListenSection,
	// 跳转后的 CFI 定位串
	startCfi: string,
	// 可选：已索引的句子 DOM Range，避免重复 TreeWalker
	sentenceRanges?: Array<Range | null>,
): number {
	// 节内纯文本（trim 后用于分句）
	const trimmed = section.plain.trim();
	// 按偏移构建句子 span 列表
	const sentences = buildSentenceOffsetSpans(trimmed);
	// 无句可播则回退句 0
	if (!sentences.length) return 0;

	// 规范化 CFI 字符串
	const cfi = startCfi.trim();
	// 空 CFI 回退句 0
	if (!cfi) return 0;

	// 将 CFI 解析为 DOM Range
	const at = resolveCfiDomRange(rend, cfi);
	// 解析失败回退句 0
	if (!at) return 0;

	// 节所在 document，用于校验 CFI 与节同文档
	const sectionDoc = section.outerRange.startContainer.ownerDocument;
	// CFI 落在别文档（跨 iframe 错位）则回退句 0
	if (at.startContainer.ownerDocument !== sectionDoc) return 0;

	// 复用传入的 sentenceRanges 或现场索引
	const ranges =
		sentenceRanges ?? indexChapterSentenceRanges(section.outerRange, trimmed);

	// 从后往前找，定位最靠前且比 CFI 范围「在左边」的句（续听语义）
	for (let i = sentences.length - 1; i >= 0; i -= 1) {
		const r = ranges[i];
		// 该句无有效 Range 则跳过
		if (!r) continue;
		// 句末在 CFI 起点之前或齐平：即 CFI 落在此句之后，起播此句
		if (r.compareBoundaryPoints(Range.END_TO_START, at) <= 0) return i;
	}
	// 找不到则回退句 0
	return 0;
}
```

**改动后** · `apps/frontend/src/views/ebook/utils/epub/listen/epubListenChapter.ts`（当前，约 L471–L517）

```typescript
// 根据 startCfi 在可见节内反查起播句索引
export function resolveListenStartSentence(
	// epubjs 渲染实例
	rend: Rendition,
	// 当前可见朗读节
	section: VisibleListenSection,
	// 跳转后的 CFI 定位串
	startCfi: string,
	// 可选配置：句子 Range 缓存与比较模式
	opts?: {
		// 已索引的句子 DOM Range，可复用避免重复 TreeWalker
		sentenceRanges?: Array<Range | null>;
		// before：CFI 左侧最后一句；after：CFI 处或之后第一句
		mode?: 'before' | 'after';
	},
): number {
	// 节内纯文本
	const trimmed = section.plain.trim();
	// 构建句子 offset span
	const sentences = buildSentenceOffsetSpans(trimmed);
	// 无句可播回退 0
	if (!sentences.length) return 0;

	// 规范化 CFI
	const cfi = startCfi.trim();
	// 空 CFI 回退 0
	if (!cfi) return 0;

	// CFI → DOM Range
	const at = resolveCfiDomRange(rend, cfi);
	// 解析失败回退 0
	if (!at) return 0;

	// 节 document，校验 CFI 同文档
	const sectionDoc = section.outerRange.startContainer.ownerDocument;
	// 跨文档则回退 0
	if (at.startContainer.ownerDocument !== sectionDoc) return 0;

	// 取缓存 ranges 或现场索引
	const ranges =
		opts?.sentenceRanges ??
		indexChapterSentenceRanges(section.outerRange, trimmed);

	// 默认 before，与基线行为一致
	const startMode = opts?.mode ?? 'before';
	// after 分支：目录/锚点起播
	if (startMode === 'after') {
		// 目录/锚点：从前往后，命中「含 CFI」或「句首 ≥ CFI」的第一句
		for (let i = 0; i < sentences.length; i += 1) {
			const r = ranges[i];
			if (!r) continue;
			// 句首相对 CFI 起点的位置
			const startVs = r.compareBoundaryPoints(Range.START_TO_START, at);
			// 句末相对 CFI 起点的位置（END_TO_START）
			const endVs = r.compareBoundaryPoints(Range.END_TO_START, at);
			// 句首在 CFI 之后，或句跨越 CFI：起播此句
			if (startVs >= 0 || (startVs <= 0 && endVs > 0)) return i;
		}
		// 未命中则回退 0
		return 0;
	}

	// before 分支：与基线相同，从后往前找 CFI 左侧最后一句
	for (let i = sentences.length - 1; i >= 0; i -= 1) {
		const r = ranges[i];
		if (!r) continue;
		if (r.compareBoundaryPoints(Range.END_TO_START, at) <= 0) return i;
	}
	return 0;
}
```

**变更摘要**：第 4 参改为 `opts`；新增 `after` 正扫分支；`before` 保持基线逆扫逻辑。

---

### 4.2 `resolveStartCfiModeRef`（`apps/frontend/src/views/ebook/hooks/useEpubChapterListen.ts`）

**对比范围**：纯新增 ref 声明（约 L144–L145）及 `stopInternal` 重置（约 L160）。

**改动后** · `apps/frontend/src/views/ebook/hooks/useEpubChapterListen.ts`（当前，约 L143–L145、L160）

```typescript
// 是否在 applySection 时按当前 CFI 解析起播句（而非固定句 0）
const resolveStartCfiRef = useRef(false);
/** 目录切章用 after，避免起播落在上一节末句；从当前位置听用 before */
// 起播句解析模式：目录/底栏切章为 after，当前位置续听为 before
const resolveStartCfiModeRef = useRef<'before' | 'after'>('before');
```

```typescript
		// stop 时重置 CFI 解析开关
		resolveStartCfiRef.current = false;
		// stop 时恢复默认 before，避免下次误用 after
		resolveStartCfiModeRef.current = 'before';
```

**变更摘要**：新增模式 ref；`stopInternal` 与 `applySection` 消费后均重置为 `before`。

---

### 4.3 `applySection` 内 CFI 起播句解析（`apps/frontend/src/views/ebook/hooks/useEpubChapterListen.ts`）

**对比范围**：`applySection` 回调内 `resolveStartCfiRef` 分支（基线约 L223–L232；当前约 L227–L240）。

**改动前** · `apps/frontend/src/views/ebook/hooks/useEpubChapterListen.ts`（基线，约 L223–L232）

```typescript
			// 若标记了解析起始 CFI，则按 CFI 定位起播句
			if (resolveStartCfiRef.current) {
				// 取当前阅读 CFI
				const cfi = getCurrentCfiRef.current()?.trim() ?? '';
				// 逆扫找 CFI 左侧最后一句（无 mode 参数）
				sentenceCursorRef.current = resolveListenStartSentence(
					rend,
					visible,
					cfi,
					ctx.sentenceRanges,
				);
				// 一次性消费标志
				resolveStartCfiRef.current = false;
			}
```

**改动后** · `apps/frontend/src/views/ebook/hooks/useEpubChapterListen.ts`（当前，约 L227–L240）

```typescript
			// 若标记了解析起始 CFI，则按 CFI 与 mode 定位起播句
			if (resolveStartCfiRef.current) {
				// 取跳转 settle 后的当前 CFI
				const cfi = getCurrentCfiRef.current()?.trim() ?? '';
				// 传入 sentenceRanges 缓存与 before/after 模式
				sentenceCursorRef.current = resolveListenStartSentence(
					rend,
					visible,
					cfi,
					{
						sentenceRanges: ctx.sentenceRanges,
						mode: resolveStartCfiModeRef.current,
					},
				);
				// 消费 CFI 解析标志
				resolveStartCfiRef.current = false;
				// 重置模式为 before，防止污染后续节
				resolveStartCfiModeRef.current = 'before';
			}
```

**变更摘要**：第 4 参改为 opts 对象；传入 `resolveStartCfiModeRef.current`；解析后重置 mode。

---

### 4.4 `restartFromChapterStart`（`apps/frontend/src/views/ebook/hooks/useEpubChapterListen.ts`）

**对比范围**：`useCallback` 全定义，中间 Toast / 预览重试循环对称省略（基线约 L625–L707；当前约 L625–L707）。

**改动前** · `apps/frontend/src/views/ebook/hooks/useEpubChapterListen.ts`（基线，约 L625–L707）

```typescript
	// 目录跳转完成后：与 startFromCurrentPosition 同一开听路径，仅从第 0 句起（不解析 CFI）
	const restartFromChapterStart = useCallback(() => {
		// TTS 不可用则 Toast 并返回
		if (!isPlaybackAvailable()) {
			Toast({
				type: 'warning',
				title: tRef.current('englishLearning.tts.unsupported'),
			});
			return;
		}

		// 无 rendition 则 Toast 并返回
		const rend = getRenditionRef.current();
		if (!rend) {
			Toast({
				type: 'warning',
				title: tRef.current('ebook.read.listenBook.notReady'),
			});
			return;
		}

		// 用户手势解锁音频播放
		primePlaybackForUserGesture();
		// 保留用户当前倍速
		const keepRate = rateRef.current;

		// 停止引用听书、清空叠加层、开启自动跟随
		invokeStopQuoteListen();
		stopAllPlayback();
		clearEpubListenSegmentOverlay();
		beginChapterListenAutoFollow(rend);

		void (async () => {
			// ...（未改动：等跳转后章文档可读的 25 次重试预览循环，含 rAF / setTimeout、extractVisibleListenSection）
			if (!preview?.plain.trim()) {
				Toast({
					type: 'warning',
					title: tRef.current('ebook.read.listenBook.emptySection'),
				});
				return;
			}

			// 新的一代循环 gen，用于中断旧循环
			const gen = ++loopGenRef.current;
			pausedRef.current = false;
			rateRef.current = keepRate;
			sentenceCursorRef.current = 0;
			// 与 start 相同：走 prepareSection；false 表示不按 CFI 取句，固定句 0
			resolveStartCfiRef.current = false;
			scrollSeekRef.current = true;
			sectionRef.current = null;
			// 置空 → usePrepare=true，与正常听书首段同一路径（勿钉死旧 sectionDoc）
			sectionDocRef.current = null;

			const plain = preview.plain.trim();
			const sentences = buildSentenceOffsetSpans(plain);
			syncState({
				status: 'loading',
				spineIndex: preview.spineIndex,
				sentenceIndex: 0,
				sentenceCount: sentences.length,
				sentenceLabels: buildSentenceLabels(plain, sentences),
				rate: keepRate,
			});

			void runListenLoop(gen);
		})();
	// 依赖 runListenLoop 与 syncState
	}, [runListenLoop, syncState]);
```

**改动后** · `apps/frontend/src/views/ebook/hooks/useEpubChapterListen.ts`（当前，约 L625–L707）

```typescript
	// 目录/切章完成后重开听书：按跳转后 CFI 定位起播句（同 HTML 多节时非文件第 0 句）
	const restartFromChapterStart = useCallback(() => {
		// TTS 不可用则 Toast 并返回
		if (!isPlaybackAvailable()) {
			Toast({
				type: 'warning',
				title: tRef.current('englishLearning.tts.unsupported'),
			});
			return;
		}

		// 无 rendition 则 Toast 并返回
		const rend = getRenditionRef.current();
		if (!rend) {
			Toast({
				type: 'warning',
				title: tRef.current('ebook.read.listenBook.notReady'),
			});
			return;
		}

		// 用户手势解锁音频播放
		primePlaybackForUserGesture();
		// 保留用户当前倍速
		const keepRate = rateRef.current;

		// 停止引用听书、清空叠加层、开启自动跟随
		invokeStopQuoteListen();
		stopAllPlayback();
		clearEpubListenSegmentOverlay();
		beginChapterListenAutoFollow(rend);

		void (async () => {
			// ...（未改动：等跳转后章文档可读的 25 次重试预览循环，含 rAF / setTimeout、extractVisibleListenSection）
			if (!preview?.plain.trim()) {
				Toast({
					type: 'warning',
					title: tRef.current('ebook.read.listenBook.emptySection'),
				});
				return;
			}

			// 新的一代循环 gen
			const gen = ++loopGenRef.current;
			pausedRef.current = false;
			rateRef.current = keepRate;
			sentenceCursorRef.current = 0;
			// 目录 / 底栏切章：按目标 CFI「处或之后」第一句起播（勿取上一节末句）
			resolveStartCfiRef.current = true;
			// 使用 after 模式：正扫找锚点处或之后第一句
			resolveStartCfiModeRef.current = 'after';
			scrollSeekRef.current = true;
			sectionRef.current = null;
			// 置空 → usePrepare=true，与正常听书首段同一路径（勿钉死旧 sectionDoc）
			sectionDocRef.current = null;

			const plain = preview.plain.trim();
			const sentences = buildSentenceOffsetSpans(plain);
			syncState({
				status: 'loading',
				spineIndex: preview.spineIndex,
				sentenceIndex: 0,
				sentenceCount: sentences.length,
				sentenceLabels: buildSentenceLabels(plain, sentences),
				rate: keepRate,
			});

			void runListenLoop(gen);
		})();
	// 依赖 runListenLoop 与 syncState
	}, [runListenLoop, syncState]);
```

**变更摘要**：`resolveStartCfiRef` 由 `false` 改为 `true`；新增 `resolveStartCfiModeRef = 'after'`；`applySection` 内按 CFI 正扫起播句。

---

## 5. 行为变化与兼容性

| 场景 | 改动前 | 改动后 |
|------|--------|--------|
| 目录/底栏切章起播 | 固定句 0 | CFI `after` 第一句 |
| 顶栏「从当前位置听」 | CFI `before`（隐式） | 显式 `before`，行为不变 |
| 节间自动推进 | `resolveStartCfiRef = false` | 不变，仍从句 0 |
| API | `resolveListenStartSentence` 第 4 参签名变更 | 调用方须传 opts 对象 |

---

## 6. 测试与回归建议

1. 听书中点目录子锚点（同 HTML）：应从锚点附近第一句起播，而非文件开头或上一节末句。
2. 底栏 ◀▶ 切章：与目录切章同样走 `restartFromChapterStart`，验证 `after`。
3. 顶栏开听（当前位置）：仍从 CFI 左侧最后一句续听（`before`）。
4. 空 CFI / 解析失败：回退句 0，不抛错。
5. 切章后 `stop` 再开听：mode 已重置为 `before`，不误用 `after`。

---

## 7. 相关文档与代码索引

| 说明 | 路径 |
|------|------|
| 切章重开主链路（旧「句 0」策略） | `docs/ebook/EPUB听书目录章节重启.md` |
| 起播句解析 | `apps/frontend/src/views/ebook/utils/epub/listen/epubListenChapter.ts` |
| 听书 Hook | `apps/frontend/src/views/ebook/hooks/useEpubChapterListen.ts` |
| 目录切章入口 | `apps/frontend/src/views/ebook/read.tsx`（`goEpubTocHref`） |

---

（若与仓库最新源码不一致，以源码为准）
