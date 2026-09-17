# EPUB 连续滚动听书 — 逐 iframe 节间衔接 — 影响点分析

## 延伸阅读

- [EPUB章节听书.md](../ebook/EPUB章节听书.md) — 听书 MVP 总览（改前以 `waitForNextSection` 统一节间推进）
- [EPUB滚动听书章节前进影响.md](../ebook/EPUB滚动听书章节前进影响.md) — 实现思路与改动前后代码对比
- [EPUB滚动多iframe听书.md](../ideas/epub/EPUB滚动多iframe听书.md) — 多 iframe 续播解题套路与逐点改动清单
- [EPUB阅读器设置滚动.md](../ebook/EPUB阅读器设置滚动.md) — 连续滚动阅读与 `continuous` manager
- [EPUB听书播放器栏.md](../ebook/EPUB听书播放器栏.md) — 播放条切句 / 倍速 / 分句菜单
- [EPUB引用听书播放器栏影响.md](./EPUB引用听书播放器栏影响.md) — 听当前与听书互斥、播放条共用
- [developer/EPUB听书开发.md](../ebook/developer/EPUB听书开发.md) — 听书运行时链路（`runListenLoop` 描述可能滞后，见 §7）

**阅读约定**：结论以仓库 **当前源码** 为准；「历史风险」指旧实现或中间方案曾出现的问题，不代表现行代码仍会触发。

## 1. 分析目的

评估 **连续滚动模式下听书逐 iframe 节间衔接**（`runScrollSectionLoop` + `advanceScrollListenSection`）相关改动，是否改变或破坏已有功能：

- **分页模式**听书（`pageFlow !== 'scrolled'`）：`waitForNextSection` + `rend.next()` 连续章/节
- **连续滚动模式**听书：多 `.epub-view` / 多 iframe 下节末自动续播
- 听书 **开播**（顶栏听书、`startFromCurrentPosition`、CFI 起始句）
- 底部 **播放条**：暂停 / 恢复、上一句 / 下一句、分句菜单、倍速
- **听当前**（`useEbookQuoteListen`）三入口及与听书 **互斥**
- 目录跳转后 **`syncToCurrentView`** 重绑听书位置
- TTS 预取、句级高亮、播放背景与用户划线 **DOM 隔离**
- `onSessionEnd` → annotation sync 时机

**改动范围（当前 diff）**：

| 文件 | 变更 |
|------|------|
| `apps/frontend/src/views/ebook/hooks/useEpubChapterListen.ts` | 拆分 `runScrollSectionLoop` / `runPaginatedListenLoop`；`applySection` / `prepareSection`；`sectionDocRef`；切句改走 `runListenLoop`；循环中断不再误 `stopInternal` |
| `apps/frontend/src/views/ebook/utils/epubScrollListenAdvance.ts` | **新增** 连续滚动节末：`listEpubViewSlots` → `advanceScrollListenSection`（槽位 scroll + `manager.check()`，不用 `rend.next` / `rend.display`） |
| `apps/frontend/src/views/ebook/utils/epubListenChapter.ts` | **新增** `extractListenSectionForDocument`、`spineIndexForDocument`（按指定 iframe `document` 抽正文） |
| `apps/frontend/tsconfig.tsbuildinfo` | 构建缓存（无行为） |

**结论摘要**：

| 维度 | 是否影响原有功能 | 说明 |
|------|------------------|------|
| 分页模式听书 | **否** | `isScrollListenMode` 为 false 时仍走 `runPaginatedListenLoop` + `waitForNextSection`；仅共享「循环被取代时不误 stop」修复 |
| 连续滚动听书 — 首节开播 | **否** | 首节仍 `prepareSection` → `extractVisibleListenSection` + CFI `resolveListenStartSentence` |
| 连续滚动 — 节间续播 | **有条件变化** | 改前与分页共用 `waitForNextSection`（多 iframe 易卡死 / 误报读完）；改后按 DOM 槽位 `advanceScrollListenSection`，**不**合并句流、**不** `rend.display` |
| 播放条切句（上/下一句、分句菜单） | **有条件变化** | `goToSentence` 改 `runListenLoop(gen)` 重入完整循环；修复旧 gen 失效时误 `stopInternal` 导致「一切句就退出」 |
| 暂停 / 恢复 | **低（修复）** | `!finished` 时先判 `!isGenActive(gen)` 再判 `pausedRef`，暂停不再被旧循环拖入 `stopInternal` |
| 听当前 / PopBar / 想法 | **否** | 本 diff 未改 `useEbookQuoteListen`、`read.tsx` 互斥接线 |
| 播放条 hook 对外 API | **否** | `useEpubChapterListen` 导出字段与 `EpubListenPlayerBar` props 未变 |
| 句级高亮 / 划线 / overlay | **否** | 仍 `showChapterListenSentenceHighlight` + `epubListenMarkHighlight`；未改 overlay session |
| TTS 预取 | **否** | `playSentencesFromCursor` 内 `schedulePrefetch` 逻辑未变 |
| `syncToCurrentView`（TOC 跳转） | **低** | 增加 `sectionDocRef` 写入/清空，与 `prepareSection` 重绑一致 |
| 播放条章号显示 | **低** | 续播下一 iframe 时 `spineIndex` 来自 `spineIndexForDocument`，canonical 解析失败时可能仍用 rendition 当前 index |

---

## 2. 改动要点（相对改前行为）

### 2.1 听书主循环：按阅读模式分叉

**改前**：

```text
runListenLoop
  → prepareSection(rend, gen)   // 每轮都 extractVisibleListenSection（视口）
  → playSentencesFromCursor
  → waitForNextSection(rend)    // rend.next()，分页与连续滚动共用
```

**改后**：

```text
runListenLoop
  → isScrollListenMode(rend)?
       是: runScrollSectionLoop
         首节: prepareSection（视口 + CFI）
         后续节: extractListenSectionForDocument(sectionDoc) + applySection
         节末: advanceScrollListenSection(rend, sectionDoc)
       否: runPaginatedListenLoop（与改前 waitForNextSection 路径等价）
  → playSentencesFromCursor（共用）
```

**动机**：连续滚动下 epub.js 同时挂载多个 iframe（含空槽、`visibility:hidden` 预加载），`rend.next()` / 视口抽取无法稳定表示「当前 iframe 播完 → 下一 iframe」；改为 **逐 document 播放 + 槽位 scroll 加载**。

### 2.2 `applySection` 与 gen 门禁

**改前**：`prepareSection` 末尾 `return isGenActive(gen) ? ctx : null`，gen 被切句/暂停递增时可能 **静默 return null**，UI 卡在 loading。

**改后**：`applySection` 始终返回 `ctx`；gen 有效性由循环层 `isGenActive` 判断，不再在 apply 层丢弃 section。

### 2.3 播放条切句 `goToSentence`

**改前**：

```text
loopGenRef += 1 → stop TTS → gen = loopGenRef
→ playSentencesFromCursor(ctx, gen)   // 脱离主循环
旧 runListenLoop 中 play 返回 false → stopInternal()  // 误杀新播放
```

**改后**：

```text
sentenceCursorRef = index; scrollSeekRef = true
→ gen = ++loopGenRef → runListenLoop(gen)
旧循环: !finished && !isGenActive(gen) → return（不 stopInternal）
滚动模式: 切句后仍可在节末 advanceScrollListenSection
```

**动机**：切句必须 **取代** 旧 loop gen，且不能触发 `stopInternal`；重入 `runListenLoop` 保证节末仍可续播下一 iframe。

### 2.4 新增 `advanceScrollListenSection`

**机制**（`epubScrollListenAdvance.ts`）：

```text
listEpubViewSlots(.epub-view)
  → 已有下一 iframe document? 直接返回
  → 否则 ensureSlotDocument: scroll 到槽位 + manager.check()（最多 8 次 × 5 轮 nudge）
  → 仍无则 return null → Toast「全书读完」+ stopInternal
```

**刻意不做**：合并多 iframe 句流、`rend.display(spineIndex)`、`rend.next()`（历史方案曾导致页面跳动、句数突变、loading 卡住）。

---

## 3. 影响点矩阵

| 模块 / 场景 | 影响等级 | 分析 |
|-------------|----------|------|
| **分页听书** | 无 | `getEpubScrollContainer(rend) == null` 时不 import 新 advance 路径；`waitForNextSection` 保留 |
| **连续滚动 — 点击听书开播** | 低 | `startFromCurrentPosition` 预写 `sectionDocRef`；循环首节 `prepareSection` 解析 CFI；与改前用户可见语义一致 |
| **连续滚动 — 单 iframe 内连播** | 无 | 仍 `playSentencesFromCursor` 逐句；句数来自当前 document 的 plain |
| **连续滚动 — iframe 末自动续播** | 中 | 新路径；依赖槽位 DOM 顺序与 `manager.check()`；空槽加载失败仍可能 Toast「全书读完」（历史风险） |
| **节末 loading 态** | 低 | `syncState({ status: 'loading' })` 在 advance 前；与改前节间等待类似 |
| **播放条 — 下一句 / 上一句** | 中 | 行为修复 + 语义增强：切句后重新进入循环，节末可续播；`scrollSeekRef` 恢复切句居中滚动 |
| **播放条 — 暂停** | 低 | 旧 loop 静默退出，状态保持 `paused`（修复改前可能被 `stopInternal` 清掉） |
| **播放条 — 恢复** | 无 | 仍 `runListenLoop(gen, { continueSections: true })` |
| **分句菜单跳转** | 低 | 同 `goToSentence`；句数仍来自当前节 `sectionRef` |
| **倍速 `setRate`** | 无 | 未改 |
| **听当前 `useEbookQuoteListen`** | 无 | 无 diff；互斥仍在各自 hook 内 `invokeStop*` |
| **`read.tsx` / `EpubListenPlayerBar`** | 无 | 未改；仍 `chapterListen.isActive ? chapterListen : quoteListen` |
| **句级高亮 `showChapterListenSentenceHighlight`** | 无 | 仍按 `sentenceRanges`；滚动容器内 scroll 由既有 helper 处理 |
| **用户划线 / 想法 marks** | 无 | 听书背景层未改 |
| **`extractListenSectionForDocument` 导出** | 低 | 仅 `useEpubChapterListen` 滚动分支调用；不影响 `extractVisibleListenSection` 其它调用方 |
| **`syncToCurrentView`** | 低 | TOC 跳转后重置 `sectionDocRef` 并 `prepareSection`；连续滚动下与视口 iframe 对齐 |
| **章号 `spineIndex`（播放条）** | 低 | 跨 iframe 时 `spineIndexForDocument`：优先 rendition view.index，fallback canonical href |

---

## 4. 潜在风险与缓解

| 风险 | 等级 | 说明 | 建议验证 |
|------|------|------|----------|
| 节末误报「全书读完」 | 中 | `advanceScrollListenSection` 仅 5 轮 nudge，无 `rend.display` 兜底；下方仍有可见正文但槽位未挂 iframe | 连续滚动：播完 7/7 后观察是否进入下一 iframe；失败时看 DOM 是否为空 `.epub-view` |
| 节间 scroll 引起页面跳动 | 中 | `ensureSlotDocument` / nudge 会 `scrollTo` / `scrollTop += 0.9vh` | 听书节末 eyeball 视口是否大幅跳动 |
| 播放条章号与内容不一致 | 低 | `spineIndexForDocument` canonical 解析失败时 fallback | 跨 spine 续播时核对 PlayerBar 章号 |
| 切句后句数不变 | 低 | 切句仅当前 iframe 内；**不会**跨 iframe 跳句（改前亦如此） | 末句点「下一句」应播下一句而非换 iframe |
| 历史：`applySection` gen 门禁 | 低（已修） | 曾导致开播卡 loading | 回归：点击听书应秒级进入 playing + 有声 |
| 历史：切句误 exit | 低（已修） | 旧 loop `stopInternal` 误杀 | 播放中连点「下一句」不应退出播放条 |

---

## 5. 未改动项

| 项 | 说明 |
|----|------|
| `useEbookQuoteListen.ts` | 听当前状态机、API、overlay session 未 touch |
| `read.tsx` | 顶栏听书、播放条绑定、互斥 controller 未 touch |
| `EpubListenPlayerBar.tsx` | UI / props 未 touch |
| `waitForNextSection` | 实现未改；分页听书仍唯一调用方 |
| `playSentencesFromCursor` / TTS 预取 | 算法与 `speech` 调用未改 |
| `epubListenMarkHighlight` / 用户划线 sync | 未 touch |
| `invokeStopQuoteListen` / `registerChapterListenStop` | 互斥注册未改 |
| PDF / 非 EPUB 阅读 | 不在 scope |

---

## 6. 回归清单

- [ ] **分页模式**：顶栏听书 → 连续播放多章/多节 → 节末正常 `rend.next()`，不误报读完
- [ ] **连续滚动**：顶栏听书 → 首节 TTS 正常、播放条句数与当前 iframe 一致
- [ ] **连续滚动**：当前 iframe 末句播完 → 自动进入下一 iframe（非误报「全书读完」）
- [ ] **连续滚动**：下方仍有正文时，不应过早 Toast 全书读完
- [ ] 播放中 **下一句 / 上一句 / 分句菜单** → 继续播放，播放条不消失
- [ ] 切句后 **首句居中滚动**（`scrollSeekRef`）正常
- [ ] **暂停** → 状态 paused；**恢复** → 从当前句继续，节末仍可续播
- [ ] **倍速** 播放中切换立即生效
- [ ] 听书中点 **听当前** / 听当前中点 **听书** → 互斥，无双声
- [ ] **TOC 跳转** 后听书 `syncToCurrentView` 从新书签句开始
- [ ] 用户划线 / 想法虚线听书期间不被清掉
- [ ] `cd apps/frontend && npx tsc --noEmit`

---

## 7. 相关文档滞后

| 文档 | 说明 |
|------|------|
| `docs/ebook/EPUB章节听书.md` | § 核心流程仍写单一 `waitForNextSection` 环，未描述 `runScrollSectionLoop` / `advanceScrollListenSection` 分叉 |
| `docs/ebook/developer/EPUB听书开发.md` | `runListenLoop` 维护定位表未列 `epubScrollListenAdvance.ts` |
| `docs/ebook/EPUB听书播放器栏.md` | `goToSentence` 仍描述为直接 `playSentencesFromCursor`，未写 `runListenLoop` 重入 |

---

（若与仓库最新源码不一致，以源码为准）
