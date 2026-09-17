# EPUB 听书 / 听当前 — 按段 TTS + 逐句高亮

## 延伸阅读

- [docs/ideas/EPUB听书段落朗读.md](../ideas/epub/EPUB听书段落朗读.md) — 规划稿：问题、方案总览、M1–M4 阶段与风险
- [EPUB听书云端预取影响.md](./EPUB听书云端预取影响.md) — 句间/段间云端预取基线（`prefetchCloudTts`）
- [developer/EPUB听书开发.md](./developer/EPUB听书开发.md) — 听当前 + 听书开发者总手册

**文档角色**：工作区相对 `HEAD` 未提交 diff 的**落地实现说明**；将外层播放循环从「逐句 HTTP」改为「首句 kick + 段内整段合成 + 播放进度驱动句高亮」。

**分析基准**：`git show HEAD:<path>` 为改动前；当前工作区文件为改动后。

---

## 1. 背景与目标

### 1.1 问题

Web / 桌面 EPUB **听书**与**听当前**此前对每一句单独调用 `playPreferred`，云端会员路径下 **HTTP 请求数 ≈ 句数**，句间等待明显；整段一次合成虽省请求，但首包延迟高、切章后首句出声慢。

### 1.2 目标

| 维度 | 目标 |
|------|------|
| 合成单位 | 多句打包为 **合成单元**（软目标约 420 字、硬上限 7500 UTF-8 字节），段内 **一次 HTTP** |
| 高亮单位 | UI 仍 **逐句** 淡黄底（`onCadenceChunk` / `onSentence`） |
| 首包体验 | **kick 首句**单独合成，尽快出声；同段剩余与后续单元走整段 |
| 预取 | **出声后**再预取下一段（`onPlaybackStart`），避免与首包抢带宽 |
| 兼容 | 播放条 API（句索引、切句、倍速）对外不变；小程序 **零改动** |

---

## 2. 改动范围

| 路径 | 变更类型 | 说明 |
|------|----------|------|
| `apps/frontend/src/views/ebook/utils/epub/listen/epubListenParagraphs.ts` | **新增** | `buildParagraphUnits` / `paragraphIndexForSentence` / `sliceParagraphFromSentence` |
| `apps/frontend/src/views/ebook/utils/epub/listen/epubListenPlayUnits.ts` | **新增** | `playListenUnitsFromCursor`（kick + rest + 预取调度） |
| `apps/frontend/src/utils/speech.ts` | **修改** | `cloudSingleUtterance`、`onPlaybackStart`、`playCloudTtsSingleUtterance`、`prefetchCloudTts({ whole: true })` |
| `apps/frontend/src/views/ebook/hooks/useEpubChapterListen.ts` | **修改** | `SectionCtx.paragraphs`、`playSentencesFromCursor` 委托 `playListenUnitsFromCursor` |
| `apps/frontend/src/views/ebook/hooks/useEbookQuoteListen.ts` | **修改** | `paragraphsRef`、`playFromCursor` 同上 |

---

## 3. 实现思路

1. **段表（合成单元）**  
   `buildParagraphUnits` 先按 `\n+` 切软段落，再把句 span 归属到段落；`packSpeakUnits` 在 **字节上限**内尽量凑够 `SPEAK_TARGET_CHARS`，必要时跨软段合并。网文「一句一 `<p>`」时软段多但 pack 仍会合并，避免句级 HTTP 风暴。

2. **播放编排（kick + rest）**  
   `playListenUnitsFromCursor`：每个播放会话 **首句** `cloudSingleUtterance: true` 只合成当前句；同单元内 **rest** 从 `si+1` 截到单元末一次合成；后续单元整段合成。单句单元（章标题）不消耗 kick 配额，下一段正文仍走首句 kick。

3. **句高亮（云端）**  
   `playCloudTtsSingleUtterance` 整段 MP3 播放时，用 `currentTime / duration` 比例映射 plain 偏移，再 `sentenceIndexAtOffset` 驱动 `onCadenceChunk`；段内第二句起由 hook 的 `onCadenceChunk` 回调更新 overlay。

4. **预取策略升级**  
   `prefetchCloudTts(raw, { whole: true })` 预取 **整段** 文本（≤8KB），与 `cloudSingleUtterance` 对齐；调度通过 `oncePrefetch` + `onPlaybackStart`，首包 HTTP 完成后再发起，并保留 await 后兜底调用。

5. **双 hook 共用**  
   听书 `useEpubChapterListen` 在 `ctxFromVisible` 预建 `paragraphs`；听当前 `useEbookQuoteListen` 在 `startPlayback` 建 `paragraphsRef`。二者播放循环均改为调用同一 `playListenUnitsFromCursor`。

6. **超长段回退**  
   超过 `CLOUD_SINGLE_UTTERANCE_MAX_BYTES` 时 `playCloudTtsPackedSingleUtterances` 按句打包多段「整段合成」，**禁止**回退到逐句 cadence HTTP。

---

## 4. 关键代码对比与注释

### 4.1 `buildParagraphUnits`（`apps/frontend/src/views/ebook/utils/epub/listen/epubListenParagraphs.ts`）

**对比范围**：纯新增导出函数；内部 `splitPlainParagraphSpans` / `assignSentencesToParagraphs` / `packSpeakUnits` 在块内以注释概括。

**改动后（新增）** · `apps/frontend/src/views/ebook/utils/epub/listen/epubListenParagraphs.ts`（约 L124–L165）

```typescript
// 导出：由 plain 与可选句表构建合成单元
export function buildParagraphUnits(
// plain 参数
	plain: string,
// sentences 可选参数
	sentences?: SentenceSpan[],
// 返回 ParagraphUnit[]
): ParagraphUnit[] {
// trim
	const trimmed = plain.trim();
// 空则 []
	if (!trimmed) return [];
// spans
	const spans = sentences ?? buildSentenceOffsetSpans(trimmed);
// 无句 []
	if (spans.length === 0) return [];

// paraSpans
	const paraSpans = splitPlainParagraphSpans(trimmed);
// softUnits 赋值
	const softUnits =
// length <= 1
		paraSpans.length <= 1
// 数组 [
			? [
// 对象 {
					{
// start 0
						start: 0,
// end trimmed.length
						end: trimmed.length,
// siStart 0
						siStart: 0,
// siEnd spans.length
						siEnd: spans.length,
// },
					},
// ]
				]
// assignSentencesToParagraphs
			: assignSentencesToParagraphs(paraSpans, spans);

// soft 赋值
	const soft =
// softUnits.length > 0
		softUnits.length > 0
// softUnits
			? softUnits
// 兜底 [
			: [
// 对象 {
					{
// start 0
						start: 0,
// end trimmed.length
						end: trimmed.length,
// siStart 0
						siStart: 0,
// siEnd spans.length
						siEnd: spans.length,
// },
					},
// ];
				];

// return packSpeakUnits(
	return packSpeakUnits(
// trimmed,
		trimmed,
// spans,
		spans,
// soft,
		soft,
// SPEAK_TARGET_CHARS,
		SPEAK_TARGET_CHARS,
// SPEAK_MAX_BYTES,
		SPEAK_MAX_BYTES,
// );
	);
// 函数 }
}
```

**变更摘要**：新增段表构建入口；pack 保证不超过 Edge/讯飞约 8KB 单次上限。

---

### 4.2 `paragraphIndexForSentence` / `sliceParagraphFromSentence`

**改动后（新增）** · `apps/frontend/src/views/ebook/utils/epub/listen/epubListenParagraphs.ts`（约 L167–L191）

```typescript
// 导出：给定全局句下标，返回其所属合成单元在 units 中的索引
export function paragraphIndexForSentence(
	// 已构建的合成单元数组
	units: ParagraphUnit[],
	// 全局句下标（0-based）
	sentenceIndex: number,
): number {
	// 无单元时无法定位
	if (units.length === 0) return -1;
	// 线性扫描各单元的 [siStart, siEnd) 句区间
	for (let i = 0; i < units.length; i += 1) {
		// 当前单元
		const u = units[i]!;
		// 句下标落在半开区间内则返回单元索引
		if (sentenceIndex >= u.siStart && sentenceIndex < u.siEnd) return i;
	}
	// 句在首单元之前：钳到 0（切章 seek 到章首前）
	if (sentenceIndex < units[0]!.siStart) return 0;
	// 句在末单元之后：钳到最后单元
	return units.length - 1;
}

// 导出：从句 si 截到该单元 plain 末的 TTS 文本（去 markdown、trim）
export function sliceParagraphFromSentence(
	// 节/选区完整 plain
	plain: string,
	// 目标合成单元（含 plain 与句区间）
	unit: ParagraphUnit,
	// 句 offset 表
	sentences: SentenceSpan[],
	// 起始句下标（含）
	si: number,
): string {
	// 将 si 钳在 [siStart, siEnd-1] 内
	const clamped = Math.min(unit.siEnd - 1, Math.max(unit.siStart, si));
	// 取钳位后的句 span
	const sent = sentences[clamped];
	// 无 span 则无可播文本
	if (!sent) return '';
	// 从该句起点切到单元 plain 末，去 markdown 并 trim
	return stripMarkdownForTts(plain.slice(sent.start, unit.end)).trim();
}
```

---

### 4.3 `playListenUnitsFromCursor`（`apps/frontend/src/views/ebook/utils/epub/listen/epubListenPlayUnits.ts`）

**对比范围**：纯新增；摘录含 kick / rest / 后续单元三分支，中间预取 Map 与 `oncePrefetch` 完整保留。

**改动后（新增）** · `apps/frontend/src/views/ebook/utils/epub/listen/epubListenPlayUnits.ts`（约 L56–L222）

```typescript
// 导出：从 startSi 起按合成单元播放；true=播完仍 active，false=中断
export async function playListenUnitsFromCursor(
// 函数入参类型 PlayListenUnitsArgs
	args: PlayListenUnitsArgs,
// Promise 返回是否完整播完且仍 active
): Promise<boolean> {
// 解构 args 常用字段
	const {
// plain 文本
		plain,
// 句 offset 表
		sentences,
// 合成单元数组
		units,
// 动态读取倍速（勿在循环外快照）
		getRate,
// 会话是否仍应继续（代次+未暂停）
		isActive,
// 句切换时更新高亮与 state
		onSentence,
// 单元播完间隙清背景
		onUnitIdle,
// 首句是否强制居中滚动
		scrollCenterOnFirst,
// 解构结束
	} = args;
// 记录循环入口句下标，供 forceCenter 判定
	const loopStartSi = args.startSi;

// 无单元或无句则无法播放
	if (units.length === 0 || sentences.length === 0) return false;

// 按段 plain 文本去重的预取 Map
	const prefetchedByText = new Map<
// Map key：strip 后的段文本
		string,
// Map value：prefetchCloudTts 返回的 Promise
		ReturnType<typeof prefetchCloudTts>
// Map 泛型参数闭合
	>();

// 闭包：为指定单元从 fromSi 起预取整段 MP3
	const schedulePrefetch = (paraIndex: number, fromSi: number) => {
// 已停播则不发起预取
		if (!isActive()) return;
// 单元索引越界则返回
		if (paraIndex >= units.length) return;
// 取目标合成单元
		const unit = units[paraIndex]!;
// 从 fromSi 截到单元末的 TTS 文本
		const raw = sliceParagraphFromSentence(plain, unit, sentences, fromSi);
// 空文本或同文本已预取则跳过
		if (!raw || prefetchedByText.has(raw)) return;
// whole:true 整段预取，与 cloudSingleUtterance 对齐
		prefetchedByText.set(raw, prefetchCloudTts(raw, { whole: true }));
// schedulePrefetch 函数闭合
	};

// 句游标钳在 [0, sentences.length-1]
	let si = Math.max(0, Math.min(args.startSi, sentences.length - 1));
// 定位游标所在单元索引 pi
	let pi = paragraphIndexForSentence(units, si);
// 无法定位单元则返回 false
	if (pi < 0) return false;

// 源码注释：单句段不消耗 kick，留给下一段正文
	/** 本轮需逐句首包；单句段（章标题等）不消耗，留给下一段正文 */
// 本会话是否尚未消耗 kick 首句配额
	let kickSentence = true;

// 按单元 pi 从当前位置递增循环
	for (; pi < units.length; pi += 1) {
// 每轮入口检查 isActive
		if (!isActive()) return false;

// 当前合成单元
		const unit = units[pi]!;
// 本单元实际起始句（seek 可能从段中句进入）
		const startSi = Math.max(si, unit.siStart);
// 本单元无可播句则 continue 下一 pi
		if (startSi >= unit.siEnd) continue;

// 源码注释：首包只合成当前句，出声后再预取
		// —— 首包：只合成当前句（1 路 HTTP）；出声后再预取，避免与首包抢带宽 ——
// kick 分支：单句快出声 + 同段 rest
		if (kickSentence) {
// 取 kick 仅含当前一句的 raw 文本
			const kickRaw = sentenceRaw(plain, sentences, startSi);
// kick 文本为空
			if (!kickRaw) {
// 游标推进到下一句
				si = startSi + 1;
// continue 尝试本单元下一句
				continue;
// 空 kick 分支结束
			}

// 通知 UI 高亮当前 kick 句
			onSentence(startSi, {
// 首句且 scrollCenterOnFirst 时 forceCenter
				forceCenter: !!scrollCenterOnFirst && startSi === loopStartSi,
// onSentence 第二参数对象闭合
			});

// oncePrefetch：出声后只触发一次的预取调度
			const prefetchAfterKickStart = oncePrefetch(() => {
// 同单元 kick 后还有 rest 句
				if (startSi + 1 < unit.siEnd) {
// 预取同单元 rest 整段
					schedulePrefetch(pi, startSi + 1);
// 否则若存在下一单元
				} else if (pi + 1 < units.length) {
// 预取下单元从 siStart 起的整段
					schedulePrefetch(pi + 1, units[pi + 1]!.siStart);
// 预取 lambda 闭合
				}
// oncePrefetch 包装函数闭合
			});

// await 播放 kick 单句
			await playPreferred(kickRaw, {
// Web Speech 倍速选项
				speak: { rate: getRate() },
// 云端整段一次 HTTP 合成 kick 句
				cloudSingleUtterance: true,
// 真正出声后回调 prefetchAfterKickStart
				onPlaybackStart: prefetchAfterKickStart,
// playPreferred 选项对象闭合
			});
// 源码注释：本机 Web Speech 无 onPlaybackStart 时的兜底
			// 本机无 onPlaybackStart 时仍兜底预取，保证后续等待不被拉长
// 兜底调用，避免 rest 段无预取
			prefetchAfterKickStart();

// kick 播完后再次检查活性
			if (!isActive()) return false;
// 单元内 kick 段结束，清句间高亮
			onUnitIdle?.();
// 游标移到 kick 句的下一句
			si = startSi + 1;

// 源码注释：单句单元（章标题）不消耗 kick
			// 单句合成单元（目录切章后常见标题）：不消耗 kick，下一段正文仍逐句首包
// 若 kick 后已超出本单元句范围
			if (si >= unit.siEnd) {
// continue 进入下一 pi（kickSentence 仍为 true）
				continue;
// 单句单元分支结束
			}

// 本会话 kick 配额已消耗，后续单元走整段分支
			kickSentence = false;

// 从 si 截到本单元 plain 末的 rest 文本
			const restRaw = sliceParagraphFromSentence(
// slice 参数 plain
				plain,
// slice 参数 unit
				unit,
// slice 参数 sentences
				sentences,
// slice 参数起始句 si
				si,
// sliceParagraphFromSentence 调用闭合
			);
// rest 段无有效文本
			if (!restRaw) {
// 游标跳到本单元末
				si = unit.siEnd;
// continue 下一单元
				continue;
// rest 空分支结束
			}

// 记录 rest 段起始句，供 cadence 映射全局索引
			const restStartSi = si;
// 高亮 rest 段首句
			onSentence(restStartSi, {});

// rest 段出声后预取下一段
			const prefetchAfterRestStart = oncePrefetch(() => {
// 存在下一单元时
				if (pi + 1 < units.length) {
// 预取下单元整段
					schedulePrefetch(pi + 1, units[pi + 1]!.siStart);
// 预取 lambda 闭合
				}
// oncePrefetch 闭合
			});

// await 播放 rest 整段
			await playPreferred(restRaw, {
// speak 倍速
				speak: { rate: getRate() },
// 注入 schedulePrefetch 已发起的预取 Promise
				prefetchedCloud: prefetchedByText.get(restRaw) ?? null,
// rest 段 cloudSingleUtterance 一次 HTTP
				cloudSingleUtterance: true,
// onPlaybackStart 触发下一段预取
				onPlaybackStart: prefetchAfterRestStart,
// 段内句切换：播放进度估算驱动
				onCadenceChunk: (event) => {
// 仅 phase==='start' 时更新高亮
					if (event.phase !== 'start') return;
// 已停播则忽略 cadence 事件
					if (!isActive()) return;
// rest 段内相对句索引映射为全局 si
					const globalSi = restStartSi + event.sentenceIndex;
// 全局 si 越出本单元句区间则忽略
					if (globalSi < unit.siStart || globalSi >= unit.siEnd) return;
// 调用 onSentence 更新 UI
					onSentence(globalSi, {});
// onCadenceChunk 回调闭合
				},
// playPreferred rest 调用闭合
			});
// 本机路径兜底预取
			prefetchAfterRestStart();

// rest 播完后活性检查
			if (!isActive()) return false;
// rest 单元结束清背景
			onUnitIdle?.();
// 游标移到本单元末
			si = unit.siEnd;
// continue 进入 for 下一 pi
			continue;
// kick+rest 分支整体结束
		}

// 源码注释：后续单元整段合成路径
		// —— 后续单元：整段合成；出声后再预取下一段 ——
// 从 startSi 截到单元末的 spoken 文本
		const spokenRaw = sliceParagraphFromSentence(
// slice 参数 plain
			plain,
// slice 参数 unit
			unit,
// slice 参数 sentences
			sentences,
// slice 参数 startSi
			startSi,
// slice 调用闭合
		);
// spoken 为空则跳过本单元
		if (!spokenRaw) {
// 游标到单元末
			si = unit.siEnd;
// continue
			continue;
// 空 spoken 分支结束
		}

// 高亮本段首句
		onSentence(startSi, {});

// 本段出声后预取下一段
		const prefetchAfterUnitStart = oncePrefetch(() => {
// 有下一单元
			if (pi + 1 < units.length) {
// schedulePrefetch 下单元
				schedulePrefetch(pi + 1, units[pi + 1]!.siStart);
// lambda 闭合
			}
// oncePrefetch 闭合
		});

// await 整段合成播放
		await playPreferred(spokenRaw, {
// speak 倍速
			speak: { rate: getRate() },
// 注入预取
			prefetchedCloud: prefetchedByText.get(spokenRaw) ?? null,
// cloudSingleUtterance
			cloudSingleUtterance: true,
// onPlaybackStart
			onPlaybackStart: prefetchAfterUnitStart,
// 段内 onCadenceChunk 句事件
			onCadenceChunk: (event) => {
// 仅 start phase
				if (event.phase !== 'start') return;
// 活性检查
				if (!isActive()) return;
// 全局句索引 = startSi + 段内 sentenceIndex
				const globalSi = startSi + event.sentenceIndex;
// 单元边界校验
				if (globalSi < unit.siStart || globalSi >= unit.siEnd) return;
// onSentence 更新高亮
				onSentence(globalSi, {});
// 回调闭合
			},
// play 调用闭合
		});
// 兜底预取
		prefetchAfterUnitStart();

// 播完后活性检查
		if (!isActive()) return false;
// onUnitIdle 清背景
		onUnitIdle?.();
// 游标到单元末
		si = unit.siEnd;
// for 循环闭合
	}

// 全部单元播完，返回是否仍 active
	return isActive();
// 函数闭合
}
```

**变更摘要**：新增统一播放编排；预取按 **段文本** 去重，且 `whole: true` 与整段合成一致。

---

### 4.4 `PlayPreferredOptions` 与 `prefetchCloudTts`

**对比范围**：类型新增字段 + 预取函数 `whole` 分支。

**改动前** · `apps/frontend/src/utils/speech.ts`（基线，约 L470–L488）

```typescript
// PlayPreferredOptions 类型定义（改前）
// 优选朗读（云端/本机）的可选参数类型
// preferLocal 强制本机
export type PlayPreferredOptions = {
// speak 本机 Web Speech 参数
	preferLocal?: boolean;
// onCadenceChunk 节奏段回调
	speak?: SpeakOptions;
// prefetchedCloud 句间预取 Promise
	onCadenceChunk?: (event: TtsCadenceChunkEvent) => void;
// 类型对象闭合
	prefetchedCloud?: Promise<TtsSentencePrefetch> | null;
// CadencePlaybackHooks 从 Options Pick
};

// Pick 字段 onCadenceChunk 与 prefetchedCloud
type CadencePlaybackHooks = Pick<
// Pick 泛型闭合
	PlayPreferredOptions,
// CloudTtsPlaybackOptions 扩展 cadence hooks
	'onCadenceChunk' | 'prefetchedCloud'
// rate 可选倍速
>;

// CloudTtsPlaybackOptions 闭合
type CloudTtsPlaybackOptions = CadencePlaybackHooks & {
// （行注释）
	rate?: number;
// （行注释）
};
```

**改动后** · `apps/frontend/src/utils/speech.ts`（当前，约 L470–L503）

```typescript
// PlayPreferredOptions（改后）
export type PlayPreferredOptions = {
// preferLocal 强制本机
	preferLocal?: boolean;
// speak 本机参数
	speak?: SpeakOptions;
// onCadenceChunk 节奏段/句事件
	onCadenceChunk?: (event: TtsCadenceChunkEvent) => void;
// prefetchedCloud 预取 Promise
	prefetchedCloud?: Promise<TtsSentencePrefetch> | null;
// cloudSingleUtterance 整段一次 HTTP 开关
	cloudSingleUtterance?: boolean;
// onPlaybackStart 真正出声后回调
	onPlaybackStart?: () => void;
// 类型闭合
};

// CadencePlaybackHooks 增加 onPlaybackStart
type CadencePlaybackHooks = Pick<
// Pick 三个字段
	PlayPreferredOptions,
// Pick 闭合
	'onCadenceChunk' | 'prefetchedCloud' | 'onPlaybackStart'
// CloudTtsPlaybackOptions 增加 singleUtterance
>;

// rate 倍速
type CloudTtsPlaybackOptions = CadencePlaybackHooks & {
// 类型闭合
	rate?: number;
// 云端单次合成字节上限 8000
	singleUtterance?: boolean;
// （行注释）
};

// （行注释）
const CLOUD_SINGLE_UTTERANCE_MAX_BYTES = 8000;
```

**变更摘要**：对外暴露整段合成开关与出声回调；内部 `CloudTtsPlaybackOptions.singleUtterance` 由 `cloudSingleUtterance` 映射。

---

**改动前** · `apps/frontend/src/utils/speech.ts`（基线，约 L1047–L1062）

```typescript
// 符号定义或 hook 回调：export function prefetchCloudTts(
export function prefetchCloudTts(
// 执行：rawText: string,
	rawText: string,
// 执行：options?: Pick<PlayPreferredOptions, 'preferLocal'>,
	options?: Pick<PlayPreferredOptions, 'preferLocal'>,
// 执行：): Promise<TtsSentencePrefetch> | null {
): Promise<TtsSentencePrefetch> | null {
// 条件分支：if (!shouldUseCloudTts(options)) return null;
	if (!shouldUseCloudTts(options)) return null;
// 执行：const plain = stripMarkdownForTts(rawText);
	const plain = stripMarkdownForTts(rawText);
// 条件分支：if (!plain) return null;
	if (!plain) return null;
// 执行：const chunkPlain = firstCloudTtsChunkPlain(plain);
	const chunkPlain = firstCloudTtsChunkPlain(plain);
// 返回：return startCloudTts(chunkPlain).then((ready) => ({
	return startCloudTts(chunkPlain).then((ready) => ({
// 执行：plain: chunkPlain,
		plain: chunkPlain,
// 执行：ready,
		ready,
// 执行：}));
	}));
// 块或调用闭合
}
```

**改动后** · `apps/frontend/src/utils/speech.ts`（当前，约 L1110–L1127）

```typescript
// 符号定义或 hook 回调：export function prefetchCloudTts(
export function prefetchCloudTts(
// 执行：rawText: string,
	rawText: string,
// 执行：options?: Pick<PlayPreferredOptions, 'preferLocal'> & {
	options?: Pick<PlayPreferredOptions, 'preferLocal'> & {
// 执行：whole?: boolean;
		whole?: boolean;
// 块或调用闭合
	},
// 执行：): Promise<TtsSentencePrefetch> | null {
): Promise<TtsSentencePrefetch> | null {
// 条件分支：if (!shouldUseCloudTts(options)) return null;
	if (!shouldUseCloudTts(options)) return null;
// 执行：const plain = stripMarkdownForTts(rawText);
	const plain = stripMarkdownForTts(rawText);
// 条件分支：if (!plain) return null;
	if (!plain) return null;
// 执行：const chunkPlain =
	const chunkPlain =
// 执行：options?.whole && cloudPlainWithinSingleLimit(plain)
		options?.whole && cloudPlainWithinSingleLimit(plain)
// 执行：? plain
			? plain
// 执行：: firstCloudTtsChunkPlain(plain);
			: firstCloudTtsChunkPlain(plain);
// 返回：return startCloudTts(chunkPlain).then((ready) => ({
	return startCloudTts(chunkPlain).then((ready) => ({
// 执行：plain: chunkPlain,
		plain: chunkPlain,
// 执行：ready,
		ready,
// 执行：}));
	}));
// 块或调用闭合
}
```

**变更摘要**：`whole: true` 且未超 8KB 时预取整段，与段内 `cloudSingleUtterance` 缓存 key 一致。

---

### 4.5 `playCloudTtsSingleUtterance` 与 cadence 路由

**对比范围**：`playCloudTtsSingleUtterance` 为纯新增；`playCloudTtsCadenceSegments` 入口增加 `singleUtterance` 分支（改动前无此分支）。

**改动前** · `apps/frontend/src/utils/speech.ts`（基线，`playCloudTtsCadenceSegments` 约 L1195–L1205，摘录函数头）

```typescript
// 符号定义或 hook 回调：async function playCloudTtsCadenceSegments(
async function playCloudTtsCadenceSegments(
// 执行：plain: string,
	plain: string,
// 执行：generation: number,
	generation: number,
// 执行：opts?: CloudTtsPlaybackOptions,
	opts?: CloudTtsPlaybackOptions,
// 执行：): Promise<void> {
): Promise<void> {
// 执行：const chunks = splitTextForTtsCadence(plain);
	const chunks = splitTextForTtsCadence(plain);
// 条件分支：if (chunks.length === 0) return;
	if (chunks.length === 0) return;
	// ...（未改动）按 cadence chunk 循环 playCloudTtsReady
// 块或调用闭合
}
```

**改动后** · `apps/frontend/src/utils/speech.ts`（当前，约 L1299–L1325）

```typescript
// 符号定义或 hook 回调：async function playCloudTtsCadenceSegments(
async function playCloudTtsCadenceSegments(
// 执行：plain: string,
	plain: string,
// 执行：generation: number,
	generation: number,
// 执行：opts?: CloudTtsPlaybackOptions,
	opts?: CloudTtsPlaybackOptions,
// 执行：): Promise<void> {
): Promise<void> {
// 执行：let playbackStartNotified = false;
	let playbackStartNotified = false;
// 执行：const notifyPlaybackStart = () => {
	const notifyPlaybackStart = () => {
// 条件分支：if (playbackStartNotified) return;
		if (playbackStartNotified) return;
// 执行：playbackStartNotified = true;
		playbackStartNotified = true;
// 执行：opts?.onPlaybackStart?.();
		opts?.onPlaybackStart?.();
// 块或调用闭合
	};

// 条件分支：if (opts?.singleUtterance) {
	if (opts?.singleUtterance) {
// 条件分支：if (cloudPlainWithinSingleLimit(plain)) {
		if (cloudPlainWithinSingleLimit(plain)) {
// 异步等待：await playCloudTtsSingleUtterance(plain, generation, {
			await playCloudTtsSingleUtterance(plain, generation, {
// 执行：...opts,
				...opts,
// 执行：onPlaybackStart: notifyPlaybackStart,
				onPlaybackStart: notifyPlaybackStart,
// 块或调用闭合
			});
// 执行：return;
			return;
// 块或调用闭合
		}
// 异步等待：await playCloudTtsPackedSingleUtterances(plain, generation, {
		await playCloudTtsPackedSingleUtterances(plain, generation, {
// 执行：...opts,
			...opts,
// 执行：onPlaybackStart: notifyPlaybackStart,
			onPlaybackStart: notifyPlaybackStart,
// 块或调用闭合
		});
// 执行：return;
		return;
// 块或调用闭合
	}

	// ...（未改动）原有 splitTextForTtsCadence 循环
// 块或调用闭合
}
```

**改动后（新增）** · `apps/frontend/src/utils/speech.ts`（约 L1412–L1473）

```typescript
// 符号定义或 hook 回调：async function playCloudTtsSingleUtterance(
async function playCloudTtsSingleUtterance(
// 执行：plain: string,
	plain: string,
// 执行：generation: number,
	generation: number,
// 执行：opts?: CloudTtsPlaybackOptions,
	opts?: CloudTtsPlaybackOptions,
// 执行：): Promise<void> {
): Promise<void> {
// 执行：const rate = clampPlaybackRate(opts?.rate);
	const rate = clampPlaybackRate(opts?.rate);
// 执行：const sentences = buildSentenceOffsetSpans(plain);
	const sentences = buildSentenceOffsetSpans(plain);
// 播放回调：const onCadence = opts?.onCadenceChunk;
	const onCadence = opts?.onCadenceChunk;

// 执行：const emitSentence = (
	const emitSentence = (
// 执行：si: number,
		si: number,
// 执行：phase: TtsCadenceChunkEvent['phase'],
		phase: TtsCadenceChunkEvent['phase'],
// 执行：): void => {
	): void => {
// 条件分支：if (!onCadence) return;
		if (!onCadence) return;
// 执行：const span = sentences[si];
		const span = sentences[si];
// 条件分支：if (!span) return;
		if (!span) return;
// 执行：onCadence({
		onCadence({
// 执行：phase,
			phase,
// 执行：index: si,
			index: si,
// 执行：text: plain.slice(span.start, span.end),
			text: plain.slice(span.start, span.end),
// 执行：sentenceIndex: si,
			sentenceIndex: si,
// 执行：isLastInSentence: true,
			isLastInSentence: true,
// 执行：plainStart: span.start,
			plainStart: span.start,
// 执行：plainEnd: span.end,
			plainEnd: span.end,
// 执行：sentencePlainStart: span.start,
			sentencePlainStart: span.start,
// 执行：sentencePlainEnd: span.end,
			sentencePlainEnd: span.end,
// 块或调用闭合
		});
// 块或调用闭合
	};

// 执行：let lastSi = -1;
	let lastSi = -1;
// 条件分支：if (sentences.length > 0) {
	if (sentences.length > 0) {
// 执行：lastSi = 0;
		lastSi = 0;
// 执行：emitSentence(0, 'start');
		emitSentence(0, 'start');
// 块或调用闭合
	}

// 执行：const ready = await resolveCloudTtsReady(plain, opts?.prefetchedCloud);
	const ready = await resolveCloudTtsReady(plain, opts?.prefetchedCloud);
// 条件分支：if (!isPlaybackGenerationActive(generation)) return;
	if (!isPlaybackGenerationActive(generation)) return;

// 异步等待：await playCloudTtsReady(
	await playCloudTtsReady(
// 执行：ready,
		ready,
// 执行：generation,
		generation,
// 执行：rate,
		rate,
// 执行：(currentTime, duration) => {
		(currentTime, duration) => {
// 条件分支：if (!onCadence || sentences.length === 0) return;
			if (!onCadence || sentences.length === 0) return;
// 条件分支：if (!(duration > 0) || !Number.isFinite(duration)) return;
			if (!(duration > 0) || !Number.isFinite(duration)) return;
// 执行：const ratio = Math.min(1, Math.max(0, currentTime / duration));
			const ratio = Math.min(1, Math.max(0, currentTime / duration));
// 执行：const offset = Math.min(
			const offset = Math.min(
// 执行：Math.max(0, plain.length - 1),
				Math.max(0, plain.length - 1),
// 执行：Math.floor(ratio * plain.length),
				Math.floor(ratio * plain.length),
// 块或调用闭合
			);
// 执行：const si = sentenceIndexAtOffset(sentences, offset);
			const si = sentenceIndexAtOffset(sentences, offset);
// 条件分支：if (si === lastSi) return;
			if (si === lastSi) return;
// 条件分支：if (lastSi >= 0) emitSentence(lastSi, 'end');
			if (lastSi >= 0) emitSentence(lastSi, 'end');
// 执行：emitSentence(si, 'start');
			emitSentence(si, 'start');
// 执行：lastSi = si;
			lastSi = si;
// 块或调用闭合
		},
// 执行：opts?.onPlaybackStart,
		opts?.onPlaybackStart,
// 块或调用闭合
	);

// 条件分支：if (!isPlaybackGenerationActive(generation)) return;
	if (!isPlaybackGenerationActive(generation)) return;
// 条件分支：if (lastSi >= 0) emitSentence(lastSi, 'end');
	if (lastSi >= 0) emitSentence(lastSi, 'end');
// 块或调用闭合
}
```

**变更摘要**：整段 MP3 无 WordBoundary 时，用 **播放进度比例** 估算 plain 偏移以切换句高亮；`playCloudTtsReady` 新增 `onTimeUpdate` 与 `onPlaybackStart` 透传。

---

### 4.6 `playSentencesFromCursor`（听书 hook）

**对比范围**：`useEpubChapterListen` 内完整 `playSentencesFromCursor` 回调。

**改动前** · `apps/frontend/src/views/ebook/hooks/useEpubChapterListen.ts`（基线，约 L200–L302）

```typescript
// 符号定义或 hook 回调：const playSentencesFromCursor = useCallback(
const playSentencesFromCursor = useCallback(
// 执行：async (
	async (
// 执行：ctx: SectionCtx,
		ctx: SectionCtx,
// 执行：gen: number,
		gen: number,
// 执行：opts?: { scrollCenterOnFirst?: boolean },
		opts?: { scrollCenterOnFirst?: boolean },
// 执行：): Promise<boolean> => {
	): Promise<boolean> => {
// 执行：const { plain, sentences, sentenceRanges } = ctx;
		const { plain, sentences, sentenceRanges } = ctx;
// 执行：const rend = getRenditionRef.current();
		const rend = getRenditionRef.current();
// 执行：const startSi = sentenceCursorRef.current;
		const startSi = sentenceCursorRef.current;
// 执行：const prefetchedByIndex = new Map<
		const prefetchedByIndex = new Map<
// 执行：number,
			number,
// 执行：ReturnType<typeof prefetchCloudTts>
			ReturnType<typeof prefetchCloudTts>
// 执行：>();
		>();

// 执行：const schedulePrefetch = (index: number) => {
		const schedulePrefetch = (index: number) => {
// 条件分支：if (index >= sentences.length || prefetchedByIndex.has(index)) return;
			if (index >= sentences.length || prefetchedByIndex.has(index)) return;
// 执行：const sent = sentences[index];
			const sent = sentences[index];
// 条件分支：if (!sent) return;
			if (!sent) return;
// 执行：const raw = stripMarkdownForTts(
			const raw = stripMarkdownForTts(
// 执行：plain.slice(sent.start, sent.end),
				plain.slice(sent.start, sent.end),
// 执行：).trim();
			).trim();
// 条件分支：if (!raw) return;
			if (!raw) return;
// 执行：prefetchedByIndex.set(index, prefetchCloudTts(raw));
			prefetchedByIndex.set(index, prefetchCloudTts(raw));
// 块或调用闭合
		};
// 执行：schedulePrefetch(startSi + 1);
		schedulePrefetch(startSi + 1);

// 循环：for (let si = sentenceCursorRef.current; si < sentences.length; si += 1) {
		for (let si = sentenceCursorRef.current; si < sentences.length; si += 1) {
// 条件分支：if (!isGenActive(gen) || pausedRef.current) return false;
			if (!isGenActive(gen) || pausedRef.current) return false;

// 执行：const sent = sentences[si]!;
			const sent = sentences[si]!;
// 执行：const spokenRaw = stripMarkdownForTts(
			const spokenRaw = stripMarkdownForTts(
// 执行：plain.slice(sent.start, sent.end),
				plain.slice(sent.start, sent.end),
// 块或调用闭合
			);
// 条件分支：if (!spokenRaw.trim()) continue;
			if (!spokenRaw.trim()) continue;

// 执行：sentenceCursorRef.current = si;
			sentenceCursorRef.current = si;
// 执行：syncState({
			syncState({
// 执行：status: 'playing',
				status: 'playing',
// 执行：sentenceIndex: si,
				sentenceIndex: si,
// 执行：sentenceCount: sentences.length,
				sentenceCount: sentences.length,
// 块或调用闭合
			});

// 执行：const domRange = sentenceRanges[si];
			const domRange = sentenceRanges[si];
// 执行：const hasHighlight = !!(rend && domRange);
			const hasHighlight = !!(rend && domRange);

// 条件分支：if (hasHighlight) {
			if (hasHighlight) {
// 执行：const jumpScroll =
				const jumpScroll =
// 执行：opts?.scrollCenterOnFirst && si === startSi
					opts?.scrollCenterOnFirst && si === startSi
// 执行：? ({ forceScroll: true, align: 'center' as const } as const)
						? ({ forceScroll: true, align: 'center' as const } as const)
// 执行：: undefined;
						: undefined;
// 执行：showChapterListenSentenceHighlight(rend, domRange, jumpScroll);
				showChapterListenSentenceHighlight(rend, domRange, jumpScroll);
// 块或调用闭合
			}

// 执行：schedulePrefetch(si + 1);
			schedulePrefetch(si + 1);

// try 捕获播放异常
			try {
// 异步等待：await playPreferred(spokenRaw, {
				await playPreferred(spokenRaw, {
// 执行：speak: { rate: rateRef.current },
					speak: { rate: rateRef.current },
// 执行：prefetchedCloud: prefetchedByIndex.get(si) ?? null,
					prefetchedCloud: prefetchedByIndex.get(si) ?? null,
// 块或调用闭合
				});
// 执行：} catch (err) {
			} catch (err) {
// 条件分支：if (
				if (
// 执行：isGenActive(gen) &&
					isGenActive(gen) &&
// 执行：!(err as { cloudTtsNotified?: boolean }).cloudTtsNotified
					!(err as { cloudTtsNotified?: boolean }).cloudTtsNotified
// 执行：) {
				) {
// 执行：Toast({
					Toast({
// 执行：type: 'warning',
						type: 'warning',
// 执行：title: tRef.current('englishLearning.tts.unsupported'),
						title: tRef.current('englishLearning.tts.unsupported'),
// 块或调用闭合
					});
// 块或调用闭合
				}
// 返回：return false;
				return false;
// 块或调用闭合
			}

// 条件分支：if (!isGenActive(gen) || pausedRef.current) return false;
			if (!isGenActive(gen) || pausedRef.current) return false;
// 条件分支：if (hasHighlight) clearChapterListenSentenceHighlight(rend);
			if (hasHighlight) clearChapterListenSentenceHighlight(rend);
// 块或调用闭合
		}

// 返回：return isGenActive(gen);
		return isGenActive(gen);
// 块或调用闭合
	},
// 执行：[syncState],
	[syncState],
// 块或调用闭合
);
```

**改动后** · `apps/frontend/src/views/ebook/hooks/useEpubChapterListen.ts`（当前，约 L262–L327）

```typescript
// 符号定义或 hook 回调：const playSentencesFromCursor = useCallback(
const playSentencesFromCursor = useCallback(
// 执行：async (
	async (
// 执行：ctx: SectionCtx,
		ctx: SectionCtx,
// 执行：gen: number,
		gen: number,
// 执行：opts?: { scrollCenterOnFirst?: boolean },
		opts?: { scrollCenterOnFirst?: boolean },
// 执行：): Promise<boolean> => {
	): Promise<boolean> => {
// 执行：const { plain, sentences, paragraphs } = ctx;
		const { plain, sentences, paragraphs } = ctx;
// 执行：const units =
		const units =
// 执行：paragraphs.length > 0
			paragraphs.length > 0
// 执行：? paragraphs
				? paragraphs
// 执行：: buildParagraphUnits(plain, sentences);
				: buildParagraphUnits(plain, sentences);
// 执行：const rend = getRenditionRef.current();
		const rend = getRenditionRef.current();
// 执行：const loopStartSi = sentenceCursorRef.current;
		const loopStartSi = sentenceCursorRef.current;

// try 捕获播放异常
		try {
// 返回：return await playListenUnitsFromCursor({
			return await playListenUnitsFromCursor({
// 执行：plain,
				plain,
// 执行：sentences,
				sentences,
// 执行：units,
				units,
// 执行：startSi: loopStartSi,
				startSi: loopStartSi,
// 执行：getRate: () => rateRef.current,
				getRate: () => rateRef.current,
// 执行：isActive: () => isGenActive(gen) && !pausedRef.current,
				isActive: () => isGenActive(gen) && !pausedRef.current,
// 执行：scrollCenterOnFirst: opts?.scrollCenterOnFirst,
				scrollCenterOnFirst: opts?.scrollCenterOnFirst,
// 播放回调：onSentence: (globalSi, info) => {
				onSentence: (globalSi, info) => {
// 条件分支：if (!isGenActive(gen) || pausedRef.current) return;
					if (!isGenActive(gen) || pausedRef.current) return;
// 执行：sentenceCursorRef.current = globalSi;
					sentenceCursorRef.current = globalSi;
// 执行：syncState({
					syncState({
// 执行：status: 'playing',
						status: 'playing',
// 执行：sentenceIndex: globalSi,
						sentenceIndex: globalSi,
// 执行：sentenceCount: sentences.length,
						sentenceCount: sentences.length,
// 块或调用闭合
					});
// 条件分支：if (!rend) return;
					if (!rend) return;
// 执行：let liveCtx = sectionRef.current;
					let liveCtx = sectionRef.current;
// 执行：let domRange = liveCtx?.sentenceRanges[globalSi];
					let domRange = liveCtx?.sentenceRanges[globalSi];
// 条件分支：if (!isLiveDomRange(domRange)) {
					if (!isLiveDomRange(domRange)) {
// 条件分支：if (!rebindSectionDomRanges(rend)) return;
						if (!rebindSectionDomRanges(rend)) return;
// 执行：liveCtx = sectionRef.current;
						liveCtx = sectionRef.current;
// 执行：domRange = liveCtx?.sentenceRanges[globalSi];
						domRange = liveCtx?.sentenceRanges[globalSi];
// 块或调用闭合
					}
// 条件分支：if (!isLiveDomRange(domRange)) return;
					if (!isLiveDomRange(domRange)) return;
// 执行：const jumpScroll = info.forceCenter
					const jumpScroll = info.forceCenter
// 执行：? ({ forceScroll: true, align: 'center' as const } as const)
						? ({ forceScroll: true, align: 'center' as const } as const)
// 执行：: undefined;
						: undefined;
// 执行：showChapterListenSentenceHighlight(rend, domRange, jumpScroll);
					showChapterListenSentenceHighlight(rend, domRange, jumpScroll);
// 块或调用闭合
				},
// 播放回调：onUnitIdle: () => {
				onUnitIdle: () => {
// 条件分支：if (rend) clearChapterListenSentenceHighlight(rend);
					if (rend) clearChapterListenSentenceHighlight(rend);
// 块或调用闭合
				},
// 块或调用闭合
			});
// 执行：} catch (err) {
		} catch (err) {
// 条件分支：if (
			if (
// 执行：isGenActive(gen) &&
				isGenActive(gen) &&
// 执行：!(err as { cloudTtsNotified?: boolean }).cloudTtsNotified
				!(err as { cloudTtsNotified?: boolean }).cloudTtsNotified
// 执行：) {
			) {
// 执行：Toast({
				Toast({
// 执行：type: 'warning',
					type: 'warning',
// 执行：title: tRef.current('englishLearning.tts.unsupported'),
					title: tRef.current('englishLearning.tts.unsupported'),
// 块或调用闭合
				});
// 块或调用闭合
			}
// 返回：return false;
			return false;
// 块或调用闭合
		}
// 块或调用闭合
	},
// 执行：[rebindSectionDomRanges, syncState],
	[rebindSectionDomRanges, syncState],
// 块或调用闭合
);
```

**变更摘要**：逐句 for 循环与 `prefetchedByIndex` 移除，改为段级播放 + `onSentence` 仍驱动 DOM 高亮与 state。

---

### 4.7 `playFromCursor`（听当前 hook）

**对比范围**：`useEbookQuoteListen` 内完整 `playFromCursor`。

**改动前** · `apps/frontend/src/views/ebook/hooks/useEbookQuoteListen.ts`（基线，约 L128–L216）

```typescript
// 符号定义或 hook 回调：const playFromCursor = useCallback(
const playFromCursor = useCallback(
// 执行：async (gen: number): Promise<boolean> => {
	async (gen: number): Promise<boolean> => {
// 执行：const rend = getRenditionRef.current?.() ?? null;
		const rend = getRenditionRef.current?.() ?? null;
// 执行：const meta = getEpubListenSessionMeta();
		const meta = getEpubListenSessionMeta();
// 执行：const plain = meta?.plain ?? fallbackPlainRef.current;
		const plain = meta?.plain ?? fallbackPlainRef.current;
// 执行：const sentenceCount =
		const sentenceCount =
// 执行：meta?.sentenceCount ?? buildSentenceOffsetSpans(plain.trim()).length;
			meta?.sentenceCount ?? buildSentenceOffsetSpans(plain.trim()).length;

// 条件分支：if (!plain.trim() || sentenceCount <= 0) return false;
		if (!plain.trim() || sentenceCount <= 0) return false;

// 执行：const prefetchedByIndex = new Map<
		const prefetchedByIndex = new Map<
// 执行：number,
			number,
// 执行：ReturnType<typeof prefetchCloudTts>
			ReturnType<typeof prefetchCloudTts>
// 执行：>();
		>();

// 执行：const schedulePrefetch = (index: number) => {
		const schedulePrefetch = (index: number) => {
// 条件分支：if (index >= sentenceCount || prefetchedByIndex.has(index)) return;
			if (index >= sentenceCount || prefetchedByIndex.has(index)) return;
// 执行：const raw = resolveSpokenAt(index, plain);
			const raw = resolveSpokenAt(index, plain);
// 条件分支：if (!raw) return;
			if (!raw) return;
// 执行：prefetchedByIndex.set(index, prefetchCloudTts(raw));
			prefetchedByIndex.set(index, prefetchCloudTts(raw));
// 块或调用闭合
		};
// 执行：schedulePrefetch(sentenceCursorRef.current + 1);
		schedulePrefetch(sentenceCursorRef.current + 1);

// 循环：for (let si = sentenceCursorRef.current; si < sentenceCount; si += 1) {
		for (let si = sentenceCursorRef.current; si < sentenceCount; si += 1) {
// 条件分支：if (!isGenActive(gen) || pausedRef.current) return false;
			if (!isGenActive(gen) || pausedRef.current) return false;

// 执行：const spokenRaw = resolveSpokenAt(si, plain);
			const spokenRaw = resolveSpokenAt(si, plain);
// 条件分支：if (!spokenRaw) continue;
			if (!spokenRaw) continue;

// 执行：sentenceCursorRef.current = si;
			sentenceCursorRef.current = si;
// 执行：syncState({
			syncState({
// 执行：status: 'playing',
				status: 'playing',
// 执行：sentenceIndex: si,
				sentenceIndex: si,
// 执行：sentenceCount,
				sentenceCount,
// 块或调用闭合
			});

// 条件分支：if (rend) showEpubListenPlainSpan(0, 0, si);
			if (rend) showEpubListenPlainSpan(0, 0, si);

// 执行：schedulePrefetch(si + 1);
			schedulePrefetch(si + 1);

// try 捕获播放异常
			try {
// 异步等待：await playPreferred(spokenRaw, {
				await playPreferred(spokenRaw, {
// 执行：speak: { rate: rateRef.current },
					speak: { rate: rateRef.current },
// 执行：prefetchedCloud: prefetchedByIndex.get(si) ?? null,
					prefetchedCloud: prefetchedByIndex.get(si) ?? null,
// 块或调用闭合
				});
// 执行：} catch (err) {
			} catch (err) {
// 条件分支：if (
				if (
// 执行：isGenActive(gen) &&
					isGenActive(gen) &&
// 执行：!(err as { cloudTtsNotified?: boolean }).cloudTtsNotified
					!(err as { cloudTtsNotified?: boolean }).cloudTtsNotified
// 执行：) {
				) {
// 执行：Toast({
					Toast({
// 执行：type: 'warning',
						type: 'warning',
// 执行：title: tRef.current('englishLearning.tts.unsupported'),
						title: tRef.current('englishLearning.tts.unsupported'),
// 块或调用闭合
					});
// 块或调用闭合
				}
// 返回：return false;
				return false;
// 块或调用闭合
			}

// 条件分支：if (!isGenActive(gen) || pausedRef.current) return false;
			if (!isGenActive(gen) || pausedRef.current) return false;
// 条件分支：if (rend) clearActiveListenHighlight(rend);
			if (rend) clearActiveListenHighlight(rend);
// 块或调用闭合
		}

// 返回：return isGenActive(gen);
		return isGenActive(gen);
// 块或调用闭合
	},
// 执行：[syncState],
	[syncState],
// 块或调用闭合
);
```

**改动后** · `apps/frontend/src/views/ebook/hooks/useEbookQuoteListen.ts`（当前，约 L124–L181）

```typescript
// 符号定义或 hook 回调：const playFromCursor = useCallback(
const playFromCursor = useCallback(
// 执行：async (gen: number): Promise<boolean> => {
	async (gen: number): Promise<boolean> => {
// 执行：const rend = getRenditionRef.current?.() ?? null;
		const rend = getRenditionRef.current?.() ?? null;
// 执行：const meta = getEpubListenSessionMeta();
		const meta = getEpubListenSessionMeta();
// 执行：const plain = meta?.plain ?? fallbackPlainRef.current;
		const plain = meta?.plain ?? fallbackPlainRef.current;
// 执行：const sentences =
		const sentences =
// 执行：sentencesRef.current.length > 0
			sentencesRef.current.length > 0
// 执行：? sentencesRef.current
				? sentencesRef.current
// 执行：: buildSentenceOffsetSpans(plain.trim());
				: buildSentenceOffsetSpans(plain.trim());
// 执行：const units =
		const units =
// 执行：paragraphsRef.current.length > 0
			paragraphsRef.current.length > 0
// 执行：? paragraphsRef.current
				? paragraphsRef.current
// 执行：: buildParagraphUnits(plain.trim(), sentences);
				: buildParagraphUnits(plain.trim(), sentences);
// 执行：const sentenceCount = sentences.length;
		const sentenceCount = sentences.length;

// 条件分支：if (!plain.trim() || sentenceCount <= 0 || units.length === 0) {
		if (!plain.trim() || sentenceCount <= 0 || units.length === 0) {
// 返回：return false;
			return false;
// 块或调用闭合
		}

// 执行：sentencesRef.current = sentences;
		sentencesRef.current = sentences;
// 执行：paragraphsRef.current = units;
		paragraphsRef.current = units;

// try 捕获播放异常
		try {
// 返回：return await playListenUnitsFromCursor({
			return await playListenUnitsFromCursor({
// 执行：plain,
				plain,
// 执行：sentences,
				sentences,
// 执行：units,
				units,
// 执行：startSi: sentenceCursorRef.current,
				startSi: sentenceCursorRef.current,
// 执行：getRate: () => rateRef.current,
				getRate: () => rateRef.current,
// 执行：isActive: () => isGenActive(gen) && !pausedRef.current,
				isActive: () => isGenActive(gen) && !pausedRef.current,
// 播放回调：onSentence: (globalSi) => {
				onSentence: (globalSi) => {
// 执行：sentenceCursorRef.current = globalSi;
					sentenceCursorRef.current = globalSi;
// 执行：syncState({
					syncState({
// 执行：status: 'playing',
						status: 'playing',
// 执行：sentenceIndex: globalSi,
						sentenceIndex: globalSi,
// 执行：sentenceCount,
						sentenceCount,
// 块或调用闭合
					});
// 条件分支：if (rend) showEpubListenPlainSpan(0, 0, globalSi);
					if (rend) showEpubListenPlainSpan(0, 0, globalSi);
// 块或调用闭合
				},
// 播放回调：onUnitIdle: () => {
				onUnitIdle: () => {
// 条件分支：if (rend) clearActiveListenHighlight(rend);
					if (rend) clearActiveListenHighlight(rend);
// 块或调用闭合
				},
// 块或调用闭合
			});
// 执行：} catch (err) {
		} catch (err) {
// 条件分支：if (
			if (
// 执行：isGenActive(gen) &&
				isGenActive(gen) &&
// 执行：!(err as { cloudTtsNotified?: boolean }).cloudTtsNotified
				!(err as { cloudTtsNotified?: boolean }).cloudTtsNotified
// 执行：) {
			) {
// 执行：Toast({
				Toast({
// 执行：type: 'warning',
					type: 'warning',
// 执行：title: tRef.current('englishLearning.tts.unsupported'),
					title: tRef.current('englishLearning.tts.unsupported'),
// 块或调用闭合
				});
// 块或调用闭合
			}
// 返回：return false;
			return false;
// 块或调用闭合
		}
// 块或调用闭合
	},
// 执行：[syncState],
	[syncState],
// 块或调用闭合
);
```

**变更摘要**：与听书共用 `playListenUnitsFromCursor`；`startPlayback` 侧新增 `paragraphsRef.current = buildParagraphUnits(...)`（约 L227）。

---

### 4.8 `ctxFromVisible` / `SectionCtx`

**改动前** · `apps/frontend/src/views/ebook/hooks/useEpubChapterListen.ts`（基线，约 L62–L86）

```typescript
// 类型声明：type SectionCtx = {
type SectionCtx = {
// 执行：plain: string;
	plain: string;
// 执行：sentences: Array<{ start: number; end: number }>;
	sentences: Array<{ start: number; end: number }>;
// 执行：sentenceRanges: Array<Range | null>;
	sentenceRanges: Array<Range | null>;
// 执行：spineIndex: number;
	spineIndex: number;
// 块或调用闭合
};

// 符号定义或 hook 回调：function ctxFromVisible(visible: VisibleListenSection): SectionCtx {
function ctxFromVisible(visible: VisibleListenSection): SectionCtx {
// 执行：const plain = visible.plain.trim();
	const plain = visible.plain.trim();
// 返回：return {
	return {
// 执行：plain,
		plain,
// 执行：sentences: buildSentenceOffsetSpans(plain),
		sentences: buildSentenceOffsetSpans(plain),
// 执行：sentenceRanges: indexChapterSentenceRanges(visible.outerRange, plain),
		sentenceRanges: indexChapterSentenceRanges(visible.outerRange, plain),
// 执行：spineIndex: visible.spineIndex,
		spineIndex: visible.spineIndex,
// 块或调用闭合
	};
// 块或调用闭合
}
```

**改动后** · `apps/frontend/src/views/ebook/hooks/useEpubChapterListen.ts`（当前，约 L66–L106）

```typescript
// 类型声明：type SectionCtx = {
type SectionCtx = {
// 执行：plain: string;
	plain: string;
// 执行：sentences: Array<{ start: number; end: number }>;
	sentences: Array<{ start: number; end: number }>;
// 执行：paragraphs: ParagraphUnit[];
	paragraphs: ParagraphUnit[];
// 执行：sentenceRanges: Array<Range | null>;
	sentenceRanges: Array<Range | null>;
// 执行：spineIndex: number;
	spineIndex: number;
// 块或调用闭合
};

// 符号定义或 hook 回调：function ctxFromVisible(visible: VisibleListenSection): SectionCtx {
function ctxFromVisible(visible: VisibleListenSection): SectionCtx {
// 执行：const plain = visible.plain.trim();
	const plain = visible.plain.trim();
// 执行：const sentences = buildSentenceOffsetSpans(plain);
	const sentences = buildSentenceOffsetSpans(plain);
// 返回：return {
	return {
// 执行：plain,
		plain,
// 执行：sentences,
		sentences,
// 执行：paragraphs: buildParagraphUnits(plain, sentences),
		paragraphs: buildParagraphUnits(plain, sentences),
// 执行：sentenceRanges: indexChapterSentenceRanges(visible.outerRange, plain),
		sentenceRanges: indexChapterSentenceRanges(visible.outerRange, plain),
// 执行：spineIndex: visible.spineIndex,
		spineIndex: visible.spineIndex,
// 块或调用闭合
	};
// 块或调用闭合
}
```

**变更摘要**：节上下文预计算合成单元，切句/续播可 O(1) 定位段界。

---

## 5. 行为变化

| 场景 | 改动前 | 改动后 |
|------|--------|--------|
| 云端听书/听当前 | 每句 1 次（或 cadence 多 chunk）HTTP | 首句 1 次 + 段内 1 次；请求数 ≈ **段数 + kick** |
| 句高亮 | 每句播放前切换 | 段内由 `onCadenceChunk` / 进度估算切换；段末 `onUnitIdle` 清背景 |
| 预取时机 | 播 N 时预取 N+1 **句** | 出声后预取 **下一段整段**（`whole: true`） |
| 本机 Web Speech | 逐句 `speakTextWithGeneration` | 仍走 `playPreferred`；段模式同样 `cloudSingleUtterance` 对本机生效（整段朗读 + cadence 句事件） |
| 播放条 / 切句 | 句索引 | **不变**（对外仍按句） |
| 小程序 | — | **未改** |

**已知取舍**：段内句高亮在云端为 **时间比例估算**，非 WordBoundary；极端语速/倍速下可能与听感略偏前或偏后。切句仍 `stopAll` 后从目标句重走 kick + 段尾。

---

## 6. 测试回归

| 优先级 | 场景 | 预期 |
|--------|------|------|
| P0 | Web 会员听书长章 | 首句 1–2s 内出声；段间无明显重复 HTTP；高亮随句移动 |
| P0 | 听当前选区 | kick 首句 + 段内连播；播放条切句/暂停/续播正常 |
| P0 | 非会员本机 | 首句有声；段内 cadence 句事件仍驱动高亮 |
| P1 | 切章后章标题（单句单元） | 标题 kick 后下一段正文仍 kick 首句 |
| P1 | 倍速 0.5×–3× 中途调节 | `getRate()` 每段读取，非闭包快照 |
| P1 | MiniMax/讯飞失败 | 会话降级 Edge；预取不匹配时现场合成 |
| P2 | 连续滚动多 iframe | `runScrollSectionLoop` + 新 `playSentencesFromCursor` 节间衔接 |
| P2 | DEV 自检 | 导入 `epubListenParagraphs.ts` 时 dev assert 不抛 |

---

## 7. 相关源码路径

| 说明 | 路径 |
|------|------|
| 合成单元构建 | `apps/frontend/src/views/ebook/utils/epub/listen/epubListenParagraphs.ts` |
| 段级播放编排 | `apps/frontend/src/views/ebook/utils/epub/listen/epubListenPlayUnits.ts` |
| TTS 整段合成 / 预取 | `apps/frontend/src/utils/speech.ts` |
| 听书 hook | `apps/frontend/src/views/ebook/hooks/useEpubChapterListen.ts` |
| 听当前 hook | `apps/frontend/src/views/ebook/hooks/useEbookQuoteListen.ts` |
| 规划稿 | `docs/ideas/EPUB听书段落朗读.md` |
| 预取基线 | `docs/ebook/EPUB听书云端预取影响.md` |
| 开发者手册 | `docs/ebook/developer/EPUB听书开发.md` |

---

若与仓库最新源码不一致，以源码为准。
