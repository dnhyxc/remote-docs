# EPUB 听读句界 — 句首中文标点 — 影响点分析

## 延伸阅读

- [EPUB听书句首标点影响.md](../ebook/EPUB听书句首标点影响.md) — **实现说明**（改动前后对比、逐行注释）
- [EPUB听书开发.md](../ebook/developer/EPUB听书开发.md) — 听书 / 听当前总手册（`buildSentenceOffsetSpans` 同源原则）
- [EPUB引用听书播放器栏影响.md](./EPUB引用听书播放器栏影响.md) — 听当前按句播放与播放条
- [EPUB听书句背景.md](../ebook/EPUB听书句背景.md) — 句级播放背景与 plain 偏移

**阅读约定**：结论以仓库 **当前源码** 为准；「历史风险」指旧实现曾出现的问题，不代表现行代码仍会触发。

## 1. 分析目的

评估 **`buildSentenceOffsetSpans` 句首中文标点处理**（commit `58645d24`）是否破坏或意外改变已有功能。改前仅完善 **句末** 闭合引号 / 省略号 extend；改后与句末对称，处理 **段首 / 句首** 开引号、`……`、`——` 等。

**对照的既有能力**：

- **听书**（`useEpubChapterListen`）：章 plain 分句、句数、分句菜单、TTS 切片、播放背景 Range
- **听当前**（`useEbookQuoteListen` + `epubListenSegmentOverlay`）：选区分句、句标签、按句 TTS、句级淡黄背景
- **英语学习 TTS**（`splitTextForTtsCadence` / `emitCadenceChunk`）：句索引与 cadence 回调
- **用户划线 / 想法 / 播放条 UI**：不直接调用句界算法
- **English TTS 对外 API**：`buildSentenceOffsetSpans` **签名不变**

**改动范围（commit `58645d24`）**：

| 文件 | 变更 |
|------|------|
| `apps/frontend/src/utils/speech.ts` | `buildSentenceOffsetSpans` 及私有 helper：句首 attach、`TRAILING_CLOSER` 收紧、模块自检扩充 |

**结论摘要**：

| 维度 | 是否影响原有功能 | 说明 |
|------|------------------|------|
| `buildSentenceOffsetSpans` 对外 API | **否** | 仍为 `(plain) => { start, end }[]`；无新增导出 |
| 听书分句 / 句数 / 播放条进度 | **有条件变化** | 含段首 `……` / `——` / 开引号的章，句界与改前不同；**预期修复** |
| 听当前分句 / 标签 / 按句 TTS | **有条件变化** | 同上；与 overlay `buildDomSentenceIndex` 仍 **同源** |
| 播放背景 DOM 对齐 | **低（正向）** | 锚点与 TTS 切片共用算法，段首标点错位场景应改善 |
| 句末闭合引号 / 叹号 extend | **否（主路径）** | 原有自检用例仍通过；仅 `TRAILING_CLOSER` 去掉开引号 |
| 英语学习 cadence 句索引 | **有条件变化** | 长文中含中文段首标点时段落边界可能变；非 EPUB 专属 |
| 用户划线 / 想法 / sync | **否** | 无调用链 |
| 听书 vs 听当前互斥 / 播放条组件 | **否** | 未改 hook 签名与 UI |

---

## 2. 改动要点（相对改前行为）

### 2.1 改前（`7ba1c1b8` 及父提交）

```text
句末：SENTENCE_TERMINATOR + extendSentenceBoundaryEnd
  → 吞掉闭合引号、重复叹号、省略号（含 \u2026）
句首：仅 skip 段间空白；段首 …… 可能被当成独立句界
TRAILING_CLOSER：开引号与闭引号均在列表 → 句末 extend 可能吞掉下一句的 "
```

### 2.2 改后

```text
句首：computeSentenceSpanStart + isWithinSentenceLeadingAttachables
  → …… / —— / 开引号 / 开括号 归入 **本句** start，不单拆一句
句末 extend：不再把 \u2026 当作「下一句段首」吞进上一句
TRAILING_CLOSER：仅 **闭** 引号/括号
sentenceBoundaryEnd(trimmed, i, rawStart)：段首省略号 run 不触发断句
```

**动机**：中文 EPUB 常见「段落以 …… 起」「句号后开引号对白」「—— 转场」，改前会出现 **多一句空读**、**上一句吞标点**、**背景与朗读句错位**。

### 2.3 调用链（未改文件，仅算法输出变化）

```text
buildSentenceOffsetSpans(plain)
  ├─ useEpubChapterListen → prepareSection / playSentencesFromCursor / 分句菜单
  ├─ useEbookQuoteListen → buildLabelsFromPlain / sentenceCount / resolveSpokenAt
  ├─ epubListenSegmentOverlay → buildDomSentenceIndex → paintSentence / 背景 Range
  ├─ epubListenChapter → indexChapterSentenceRanges / plain 预览
  └─ speech → splitTextForTtsCadence / emitCadenceChunk
```

---

## 3. 影响点矩阵

| 模块 / 场景 | 影响等级 | 分析 |
|-------------|----------|------|
| **听书 — 普通中英句号分句** | 无 | 无段首 attach 标点时 span 与改前一致 |
| **听书 — 段首 …… / ——** | 中（体验修复） | 改前可能 `……` 单独成句；改后并入后文，句数减少、TTS 不再空读省略号 |
| **听书 — `第一句。……第二句`** | 中（体验修复） | 改前 `……` 可能并进第一句；改后归第二句 |
| **听书 — 句号后开引号对白** | 中（体验修复） | 改前 extend 可能把 `"` 并进上一句；改后 `"下一句` 整句播放 |
| **听当前 — PopBar 选区** | 低 | `buildDomSentenceIndex` 与 TTS 同源；段首标点选区朗读与背景应对齐 |
| **听当前 — 播放条分句菜单** | 低 | 标签文本随 span 变短/合并，与朗读内容一致 |
| **播放背景高亮** | 低（正向） | `paintSentence(i)` 的 Range 随 span 变；与 TTS 第 i 句对齐 |
| **autoFollow / FAB** | 无 | 仍跟 `paintSentence` / `showChapterListenSentenceHighlight` |
| **英语学习 — 整句 TTS cadence** | 低 | 仅当 plain 含上述标点时段落 `sentenceIndex` 可能偏移 |
| **用户划线 / 想法** | 无 | 不经过 `buildSentenceOffsetSpans` |
| **云端 / 本机 TTS 路由** | 无 | `playPreferred` 接口不变 |
| **句末 `！」」` 闭合 extend** | 无 | 模块自检保留原 3 条叹号/闭引号用例 |

---

## 4. 潜在风险与缓解

| 风险 | 等级 | 说明 | 建议验证 |
|------|------|------|----------|
| 章末单独 `……` 成句 | 低 | 改后 `他走了。……` 可能仍拆出仅省略号的尾句 | 找含段末省略号的书试播 |
| 英文引号歧义 | 低 | ASCII `"` 仍在 TRAILING_CLOSER；极罕见跨句误判 | 英文对白 + 句号换行 |
| 句数变少导致进度文案跳变 | 低 | 用户感知为修复；旧进度百分比仍按 spine 无关 | 听书分句菜单句数 |
| 与旧文档描述不一致 | 低 | dev 手册 §8.2 仍写「句界」未列句首规则 | 可选更新 `EPUB听书开发.md` §8.2 |

---

## 5. 未改动项

| 项 | 说明 |
|----|------|
| `buildSentenceOffsetSpans` 函数签名 | 仍 `(plain: string) => { start, end }[]` |
| `stripMarkdownForTts` / `playPreferred` | 无 diff |
| `useEpubChapterListen` / `useEbookQuoteListen` hook 文件 | 无 diff |
| 播放条 / 互斥 / `onListenSessionEnd` | 无 diff |
| marks-pane 播放背景绘制 | 仅输入 Range 边界随 span 变 |
| `epubListenChapter` 除调用句界外的索引逻辑 | 无 diff |

---

## 6. 回归清单

- [ ] 听书：段首 `……他走了。` — **一句**朗读，播放背景覆盖含省略号全文
- [ ] 听书：`第一句。……第二句。` — 两句；第二句 TTS/菜单以 `……第二句` 开头
- [ ] 听书：`——他说完就走了。` — 一句，破折号被朗读
- [ ] 听书：`完。"下一句。"` — 第二句含开引号
- [ ] 听书：原回归 `赞叹一声："阿弥陀佛！"这个` — 闭引号仍归前句
- [ ] 听当前：选中含段首 `……` 的段落 — 按句播放条句数与背景换句一致
- [ ] 听当前 ↔ 听书互斥、停止后划线 sync — 仍正常
- [ ] 导入 `speech` 不抛自检异常（开发启动 / 电子书听读页）
- [ ] `npx tsc --noEmit`（apps/frontend）通过

---

## 7. 相关文档滞后

| 文档 | 说明 |
|------|------|
| `docs/ebook/developer/EPUB听书开发.md` §8.2 | 可补充句首 attach 规则与 `TRAILING_CLOSER` 不含开引号 |
| `docs/ebook/EPUB章节听书.md` 句界表 | 可增一行「段首 …… / —— / 开引号」 |
| `docs/impact/EPUB引用听书播放器栏影响.md` §3 | 「DOM 句界 vs TTS」行仍成立，段首标点错位风险 **降低** |

---

（若与仓库最新源码不一致，以源码为准）
