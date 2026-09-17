# EPUB 听读 utils 文件合并 — 影响点分析

## 1. 分析目的

记录 **听当前 / 听书** 工具模块从 **7 个文件合并为 3 个** 的重构影响：哪些路径失效、哪些对外 API 不变、谁需要改 import、文档与死代码如何处理。

**结论摘要**：

| 维度 | 影响 |
|------|------|
| **运行时行为** | **无变化**（纯搬代码 + 删未引用文件，未改分支逻辑） |
| **对外 export 符号** | **无变化**（函数名、参数、语义与合并前一致） |
| **业务调用方** | 仅 **2 个 hook** 的 import 路径调整；其余仍走 `epubListenSegmentOverlay` |
| **用户划线 / 想法** | **无影响**（见 [EPUB听书背景与注释影响.md](./EPUB听书背景与注释影响.md)） |
| **文档 / spec** | 多处仍写旧文件名，需以本文 **路径对照表** 为准 |
| **删除 `epubListenSpineText.ts`** | 运行时无引用，删除 **不影响** 当前听书/听当前 |

---

## 2. 合并前后对照

### 2.1 文件映射

| 合并前（已删除） | 合并后（现行） | 说明 |
|------------------|----------------|------|
| `epubListenMarkHighlight.ts` | **`epubListenMarkHighlight.ts`** | 未动，播放背景 SVG/iframe 层 |
| `epubListenSegmentOverlay.ts` | **`epubListenSegmentOverlay.ts`** | 吸收 `SentenceIndex` + `Controller` |
| `epubListenSentenceIndex.ts` | ↑ 内联于 overlay 顶部 | 听当前 `buildDomSentenceIndex` 等 |
| `epubListenController.ts` | ↑ 内联于 overlay 末尾 | `register*` / `invokeStop*` |
| `epubListenVisibleSection.ts` | **`epubListenChapter.ts`** | 可见节 innerText、waitForNextSection 等 |
| `epubListenChapterHighlight.ts` | ↑ 同文件 | `indexChapterSentenceRanges`、句高亮入口 |
| `epubListenSpineText.ts` | **已删除** | 全仓库无 import；原计划 async spine 加载未接入主流程 |

### 2.2 现行三文件职责

```text
epubListenMarkHighlight.ts    视觉：淡黄底绘制/清除（moke-epub-listen-bg）
epubListenSegmentOverlay.ts   听当前 session + autoFollow + PopBar 选区 + 互斥
epubListenChapter.ts          听书：正文抽取、句 DOM Range、章节衔接
```

**依赖方向**（无环）：

```text
useEbookQuoteListen ──► epubListenSegmentOverlay ──► epubListenMarkHighlight
useEpubChapterListen ──► epubListenChapter ──► epubListenSegmentOverlay
                                              └──► epubListenMarkHighlight
```

---

## 3. 对外 API：不变 vs 路径变更

### 3.1 仍从 `epubListenSegmentOverlay` 导入（路径不变）

| 符号 | 调用方 |
|------|--------|
| `beginEpubListenOverlaySession` | `useEbookQuoteListen` |
| `clearEpubListenSegmentOverlay` | quote/chapter hooks |
| `showEpubListenPlainSpan` | `useEbookQuoteListen` |
| `resolveEpubListenPlain` | `useEbookQuoteListen` |
| `subscribeEpubListenAutoFollow` / `resumeEpubListenAutoFollow` | `EpubListenFollowFab` |
| `rememberEpubPopBarSelectionRange` / `getRememberedEpubPopBarSelectionRange` | `epubSelectionToolbarAttach`、`read.tsx` |
| `registerQuoteListenStop` / `invokeStopChapterListen` | `useEbookQuoteListen`（互斥，**原 controller 文件**） |
| `registerChapterListenStop` / `invokeStopQuoteListen` | `useEpubChapterListen`（互斥，**原 controller 文件**） |
| `beginChapterListenAutoFollow` / `syncChapterListenScrollSession` | chapter 链路 |

### 3.2 改从 `epubListenChapter` 导入（原 visibleSection + chapterHighlight）

| 符号 | 原文件 | 现文件 |
|------|--------|--------|
| `extractVisibleListenSection` | `epubListenVisibleSection` | `epubListenChapter` |
| `resolveListenStartSentence` | 同上 | 同上 |
| `waitForNextSection` / `waitForRelocated` | 同上 | 同上 |
| `indexChapterSentenceRanges` | `epubListenChapterHighlight` | 同上 |
| `showChapterListenSentenceHighlight` | 同上 | 同上 |
| `clearChapterListenSentenceHighlight` | 同上 | 同上 |
| `teardownChapterListenHighlight` | 同上 | 同上 |
| `VisibleListenSection`（type） | 同上 | 同上 |

### 3.3 不再单独存在、亦未对外 re-export 的符号

| 符号 | 原位置 | 现况 |
|------|--------|------|
| `buildDomSentenceIndex` | `epubListenSentenceIndex` | overlay **模块内** private，外部本就不应 import |
| `DomListenSentence` / `DomTextAnchor` | 同上 | 仍由 overlay **export type**（听当前 session 类型） |
| `epubListenSpineText` 全部 export | `epubListenSpineText` | **文件已删**；若未来要 async spine 加载需重新实现或恢复 |

---

## 4. 按模块的影响点

### 4.1 无影响（无需改代码）

| 模块 | 原因 |
|------|------|
| `epubUserHighlights.ts` / 用户划线 | 未 import 听读 utils |
| `epubThoughtAnnotations.ts` / 想法虚线 | 同上 |
| `EpubPane.tsx` / annotation sync | 仅 `onSessionEnd` → sync，不依赖旧路径 |
| `speech.ts` | 无反向依赖 |
| `EpubListenFollowFab` | 仍 import overlay |
| `read.tsx`（除 hook 间接） | PopBar Range 仍 overlay |

### 4.2 已改动的调用方（本轮已落地）

| 文件 | 变更 |
|------|------|
| `hooks/useEpubChapterListen.ts` | chapter 相关 import → `epubListenChapter`；互斥 → overlay |
| `hooks/useEbookQuoteListen.ts` | 互斥 import：`epubListenController` → `epubListenSegmentOverlay` |

### 4.3 文档 / 规范滞后（不影响运行，维护时注意）

以下仍引用 **已删除路径**，阅读时需对照 §2.1：

| 文档 | 说明 |
|------|------|
| `docs/ebook/developer/EPUB听书开发.md` | §0.2 定位表、§9 路径速查 |
| `docs/ebook/EPUB章节听书.md` | 改动范围表、mermaid 节点名 |
| `docs/impact/EPUB听书背景与注释影响.md` | 部分源码路径 |
| `apps/frontend/specs/epub-listen-while-read.md` | 仍规划 `epubListenSpineText` |
| `.cursor/skills/ebook-feature-dev-guide/SKILL.md` | 提及 `epubListenController` |

**建议**：维护听读功能时以 **`epubListenChapter` + `epubListenSegmentOverlay` + `epubListenMarkHighlight`** 三文件为准；批量改 doc 可另开文档任务。

---

## 5. 删除 `epubListenSpineText.ts` 的影响

| 项 | 结论 |
|----|------|
| 运行时 | **无** — grep 无 `from './epubListenSpineText'` |
| 听书主流程 | 仍走 `extractVisibleListenSection`（同步 innerText），与 spine 异步预加载方案无关 |
| 若将来接入 | 需新建模块或恢复文件；**不可**假设仓库内仍有 `loadSectionText` 等 API |

---

## 6. 合并带来的维护变化（非功能）

| 变化 | 维护侧影响 |
|------|------------|
| 文件数 7→3 | 听读逻辑集中，减少「改 hook 要打开几个 utils」 |
| `epubListenSegmentOverlay` 体积增大 | 听当前句表 + session 同文件；改 quote listen 时只读 overlay 上半 + session 段 |
| `epubListenChapter` 单文件 | 听书正文 + 句 Range 索引一体；与 overlay 边界：chapter 调 `syncChapterListenScrollSession` |
| 冗长块注释已删减 | 行为不变；深读实现以源码为准 |

---

## 7. 回归清单（合并后必跑）

- [ ] 听当前：选区 PopBar 朗读、句背景、停止后 overlay 清除
- [ ] 听书：顶栏启动、逐句播放、句背景、节末 `next()`
- [ ] 互斥：听书中点听当前 / 反向
- [ ] FAB：手动滚动 → 回位
- [ ] 用户划线 + 听当前/听书叠加（播完 mark 仍在）
- [ ] 想法虚线 + 听书（停止后虚线可点）
- [ ] `npx tsc --noEmit`（apps/frontend）通过

---

## 8. 相关文档

| 文档 | 关系 |
|------|------|
| [EPUB听书背景与注释影响.md](./EPUB听书背景与注释影响.md) | 播放背景 vs 用户/想法（功能隔离，与本次文件合并无关） |
| [../ebook/developer/EPUB听书开发.md](../ebook/developer/EPUB听书开发.md) | 开发者总手册（路径表待与 §2 对齐） |

---

（若与仓库最新源码不一致，以源码为准）
