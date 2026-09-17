# EPUB 想法按章拉取与视口 mark — 影响点分析

## 延伸阅读

- [EPUB想法视口性能.md](../ebook/EPUB想法视口性能.md) — 实现说明
- [EPUB公开想法下划线覆盖.md](../ebook/EPUB公开想法下划线覆盖.md) — 多人虚线叠层几何
- [EPUB滚动卡顿性能.md](../ebook/EPUB滚动卡顿性能.md) — relocated 80ms 与投影缓存
- [EPUB听书背景与注释影响.md](./EPUB听书背景与注释影响.md) — 听书背景 vs mark 层历史隔离

## 1. 分析目的

评估 **`useEbookThoughtLoader`（`spineHints`）、`applyEpubThoughtUnderlines` 视口挂载、`syncEpubThoughtUnderlines` 拆分、`refreshThoughtUnderlinesInViewport`、`ephemeralPin`** 对既有 EPUB 能力的影响：

- 私有书想法虚线（少量 / 大量想法）
- 用户划线与想法叠加
- 连续滚动 mark patch 与换章
- 听当前 / 听书播放背景
- MOKE 分栏、soft resize、窗口 resize
- PopBar、选区、想法侧栏 pin 锚点
- 公开书多人灰/橙虚线叠层

**改动范围（当前 diff）**：

| 文件 | 变更 |
|------|------|
| `apps/backend/src/services/ebook/ebook.service.ts` | `appendThoughtSpineHintsFilter`、`listThoughts(spineHints?)` |
| `apps/backend/src/services/ebook/dto/query-ebook-list-thoughts.dto.ts` | `spineHints` 查询 |
| `apps/frontend/src/views/ebook/hooks/useEbookThoughtLoader.ts` | 按章 merge thoughts |
| `apps/frontend/src/views/ebook/utils/epub/mark/epubThoughtAnnotations.ts` | 视口阈值、pin、双轨 reclaim、foreign 色、`currentUserId` |
| `apps/frontend/src/views/ebook/utils/epub/mark/epubUserHighlights.ts` | 拆分 sync、`relocated` 调 `refreshThoughtUnderlinesInViewport` |
| `apps/frontend/src/views/ebook/utils/epub/mark/epubMarkShared.ts` | `collectLoadedSpineHints`、`normalizeCfiSpineHint` |
| `apps/frontend/src/views/ebook/components/reader/EpubPane.tsx` | 独立 `useEffect` sync 想法/划线；`setThoughtUnderlineApplyContext` |
| `apps/frontend/src/views/ebook/read.tsx` | `saveCfi` → `ensureLoadedSpineThoughts`；`ephemeralPinThoughtCfis` on create |

**结论摘要**：

| 维度 | 是否影响原有功能 | 说明 |
|------|------------------|------|
| 小册私有 EPUB（想法 &lt;30 CFI） | **否** | 未达视口阈值；行为接近改前全量 apply |
| 大册私有 EPUB | **有条件变化** | 按章拉取 + 视口 mount；换章才拉数据，滚动回收远处 mark |
| 用户划线 | **低** | 高亮 sync 独立；想法变更不再 `invalidateThoughtStackProjectionCache` |
| 想法+划线叠加几何 | **低** | 用户线变更仍 patch 想法虚线；叠层 rank 对私有书仅单人 tier |
| 连续滚动流畅度 | **是（增强）** | relocated 80ms + 视口 patch 降频；全量 EPUB 受益 |
| 听书/听当前背景 | **否** | host 浮层独立；未改 `epubListenMarkHighlight` |
| 新建想法后邻近虚线 | **有条件变化** | 修复：数据轨 `reclaimOffViewportMarks=false`；历史曾误删邻近线 |
| 公开书多人虚线 | **是（增强）** | 灰/橙色 + CFI 投影扣减；与私有部分重叠规则一致 |
| PDF 想法 | **否** | 产品不支持想法；见 [EPUB想法加载全量获取移除影响.md](./EPUB想法加载全量获取移除影响.md) |

---

## 2. 改动要点（相对改前行为）

### 2.1 想法数据加载

**改前**：`read.tsx` 进书 `useEffect` 一次 `fetchEbookThoughts(bookId)` 全量。

**改后**：`useEbookThoughtLoader` 对 EPUB 按 `collectLoadedSpineHints` 每章 `?spineHints=` 一次；`saveCfi`/relocated 后 `ensureLoadedSpineThoughts`。

**动机**：公开书数百条想法换章不全量请求+apply。

### 2.2 `applyEpubThoughtUnderlines` 视口模式

**改前**：对所有 CFI 无差别 `annotations.underline`。

**改后**：超阈值仅 keep 带（0.85 屏）内 apply；滚动轨 `reclaimOffViewportMarks=true` 回收 1.7 屏外 mark；数据轨不 reclaim。

**动机**：DOM 规模与主线程成本；微信读书式按视口挂载。

### 2.3 EpubPane sync 拆分

**改前**：`thoughts`/`highlights` 变更共走 `syncEpubReadingAnnotations`（想法变更会清叠层投影缓存）。

**改后**：`syncEpubThoughtUnderlines` 与 `syncEpubUserHighlights` 分 `useEffect`；仅高亮变更 `invalidateThoughtStackProjectionCache`。

**动机**：sync 新想法时避免 O(n²) 投影重算导致卡顿。

### 2.4 滚动 patch 调用链

**改后**：`onRelocated` 80ms 停稳 → `patchEpubReadingAnnotations` → 内部 `refreshThoughtUnderlinesInViewport`（`reclaim=true`）。

---

## 3. 影响点矩阵

| 模块 / 场景 | 影响等级 | 分析 |
|-------------|----------|------|
| **私有书 &lt;8 条/章** | 无 | `shouldUseViewportThoughtApply` 为 false |
| **私有书 大册换章** | 中 | 侧栏列表含已加载章合并数据；未访问章想法不在内存 |
| **侧栏打开时引用锚点** | 低 | `getPinnedThoughtCfis` 经 `thoughtUnderlineApplyContext` pin，避免裁剪 |
| **sync/新建想法** | 中 | `ephemeralPinThoughtCfis` + 空 `getClientRects` 兜底 |
| **滚动边界闪烁** | 低 | keep/remove 滞回 0.85/1.7 屏 |
| **用户划线 PopBar** | 无 | 未改 `resolveSelectionHighlightCoverage` |
| **删用户划线** | 低 | 高亮 sync 仍 patch 想法 mark |
| **听当前句背景** | 无 | 与 marks-pane 隔离（见 `epub-listen-bg-vs-annotations`） |
| **听书章节背景** | 无 | 未触达 |
| **MOKE 分栏 resize** | 低 | 视口 band 随 scroll 容器变；与 `epub-split-soft-resize` 同测 |
| **公开书他人虚线** | 中 | `currentUserId` 驱动琥珀/灰；叠层 rank 本人&gt;他人 |
| **本人多条部分相交** | 低 | 与改前私有规则一致；投影扣减 |
| **连续滚动卡顿** | 低（改善） | 80ms 合并 + 视口 patch；大书明显改善 |
| **章未加载时点远处虚线** | 中 | 该章 thoughts 可能未在内存；需滚到该章触发 load |
| **想法点击 mark** | 无 | `installEpubThoughtUnderlineListeners` 未移除 |
| **teardown 换书** | 低 | `useEbookThoughtLoader` 换 `bookId` 清空 thoughts |

---

## 4. 潜在风险与缓解

| 风险 | 等级 | 说明 | 建议验证 |
|------|------|------|----------|
| 换章后侧栏列表缺未加载章 | 中 | 内存仅累积已访问 spine | 大书：A 章想法在侧栏「全部」是否需滚章后才出现 |
| 视口外 mark 被回收后点击落空 | 低 | 滚回 keep 带应 re-apply | 快滚过长章再滚回，虚线可点 |
| sync 新线不出现（历史 bug） | 中 | 已 pin + rects 兜底 | 公开书 sync 后视口内自动出线 |
| 新建丢邻近线（历史 bug） | 高→已缓解 | 数据轨禁止 reclaim | 同屏多摘录连续新建 |
| 想法 sync 不清投影缓存 | 低 | 仅高亮变更清缓存；几何仍 invalidate DOM | 公开书叠层密集段滚动+改划线 |
| spineHints SQL 漏匹配 | 低 | `LIKE %epubcfi(/N/M!%` | 跨 spine 极少；异常 CFI 人工测 |
| PDF 误走按章逻辑 | 无 | `bookFmt !== 'epub'` 分支 | PDF 阅读无 spine loader |

---

## 5. 未改动项

- PDF 阅读与想法（若后端支持）
- 用户划线 upsert、颜色持久化、`#rrggbb(aa)`
- 听书 `runScrollSectionLoop`、TTS 预取
- 阅读进度远端防抖
- 书摘分享、quote listen
- EPUB 分页模式翻页（非滚动）主路径；relocated 仍触发但频率低

---

## 6. 回归清单

- [ ] 私有小书（&lt;30 想法）：进书虚线全显；点/写/删正常
- [ ] 私有大书：换章不卡；当前章虚线正确；滚回已访问章仍可见
- [ ] 同屏多条摘录：连续新建不丢邻近虚线
- [ ] 公开书：灰/橙区分；重叠仅一条；sync 后视口内线自动出现
- [ ] 用户划线 + 想法：叠加与 PopBar 与改前一致
- [ ] 听当前播放：句背景不碰虚线/划线
- [ ] 拖动 MOKE/想法分栏：虚线/划线不断裂
- [ ] 连续滚动大书：无明显粘滞；停滚后对齐
- [ ] 侧栏打开引用段落：对应虚线仍挂载（pin）
- [ ] 换书：thoughts 清空，无上一本残留 mark

---

## 7. 相关文档滞后

| 文档 | 说明 |
|------|------|
| `docs/ebook/EPUB注释同步性能.md` | 未含视口 mount / 按章 list；与本篇互补 |
| `docs/ebook/developer/EPUB标注分层共享.md` | 需补 `syncEpubThoughtUnderlines` 拆分与 context |
| `docs/impact/EPUB滚动卡顿性能.md` | 未单独成文；滚动收益已并入 `EPUB滚动卡顿性能.md` 实现文 |
| [EPUB想法加载全量获取移除影响.md](./EPUB想法加载全量获取移除影响.md) | 移除进书误全量 list；本篇 §1「PDF 全书 fetch」结论已修订 |

---

（若与仓库最新源码不一致，以源码为准）
