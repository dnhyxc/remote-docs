# EPUB 想法加载 — 移除误触发全量拉取 — 影响点分析

## 延伸阅读

- [EPUB想法视口标注影响.md](./EPUB想法视口标注影响.md) — 按章 `spineHints` + 视口 mark 总体波及面
- [EPUB想法视口性能.md](../ebook/EPUB想法视口性能.md) — `useEbookThoughtLoader` 实现说明
- [EPUB公开想法实时同步影响.md](./EPUB公开想法实时同步影响.md) — 公开书 `/sync` 增量（与 list 全量无关）

**阅读约定**：结论以仓库 **当前源码** 为准；「历史风险」指旧实现曾出现的问题，不代表现行代码仍会触发。

## 1. 分析目的

评估 **`useEbookThoughtLoader` 删除非 EPUB 分支的全量 `fetchEbookThoughts(bookId)`** 是否改变或破坏已有能力：

- EPUB 进书想法按章拉取（`?spineHints=`）
- EPUB 翻章 / relocated 后增量拉取
- 公开书想法 `/sync` 增量
- 想法虚线下划线 apply、侧栏 cluster、新建/编辑/删除
- PDF 阅读（产品当前 **不支持** 想法）
- 网络请求形态（进书是否仍发无 `spineHints` 的全量 list）

**改动范围（当前 diff）**：

| 文件 | 变更 |
|------|------|
| `apps/frontend/src/views/ebook/hooks/useEbookThoughtLoader.ts` | 删除 `bookFmt !== 'epub'` 时全书 `fetchEbookThoughts(bookId)` 的 `useEffect` |

**结论摘要**：

| 维度 | 是否影响原有功能 | 说明 |
|------|------------------|------|
| EPUB 按章拉取（设计主路径） | **否** | 仍由 `epubNavReady` + `ensureLoadedSpineThoughts` 与 `saveCfi` 触发 `?spineHints=` |
| EPUB 进书多余全量请求 | **是（修复）** | 改前 `book?.fmt` 为 `undefined` 时误走非 EPUB 分支，多发一次无 `spineHints` 的 list |
| EPUB 内存中想法全集 | **有条件变化** | 若全量请求曾先于 `fmt` 就绪返回，会短暂 `setThoughts(全书)`；改后仅按章 merge，与按章设计一致 |
| 公开书 `/sync` | **否** | `usePublicEbookThoughtSync` 独立走 `/thoughts/:bookId/sync`，不依赖被删 effect |
| 想法虚线 / cluster / CRUD | **否** | 消费方仍为 `read.tsx` → `thoughts` state；数据来源从「误全量」收敛为「按章 + sync」 |
| PDF 想法 | **否** | 产品不支持 PDF 想法；删掉的分支本为死代码，PDF 下 `thoughts` 保持 `[]` |
| 后端 `GET /thoughts/:bookId` 全量 | **低** | EPUB 进书少一次无参 list；按章与 sync 接口不变 |

---

## 2. 改动要点（相对改前行为）

### 2.1 删除非 EPUB 全量 `useEffect`

**改前**：

```text
bookId 或 bookFmt 变化时：
  若 bookFmt === 'epub' → 跳过
  否则（含 bookFmt === undefined、'pdf'）→ fetchEbookThoughts(bookId) 全量 setThoughts
```

**改后**：

```text
bookId 变化 → 清空 thoughts / spine 去重缓存
bookFmt === 'epub' 且 epubNavReady → ensureLoadedSpineThoughts → 仅 ?spineHints= 按章 merge
无其它 list 入口
```

**动机**：

1. **竞态 bug**：`read.tsx` 传入 `bookFmt: book?.fmt`，进书瞬间 `fmt` 未就绪为 `undefined`，`undefined === 'epub'` 为 false，误触发全量 list（与按章设计重复、浪费带宽）。
2. **死代码**：PDF 当前不支持想法，非 EPUB 全量分支无产品语义。

### 2.2 调用链（改后唯一 list 路径）

```text
read.tsx
  └─ useEbookThoughtLoader({ bookFmt: book?.fmt, epubNavReady, ... })
       ├─ useEffect [bookId]           → setThoughts([])
       └─ useEffect [epub + navReady]  → ensureLoadedSpineThoughts(rend)
            └─ ensureSpineThoughtsLoaded(hint)
                 └─ fetchEbookThoughts(bookId, { spineHints: [hint] })

read.tsx saveCfi（翻页/滚动停稳）
  └─ ensureLoadedSpineThoughts(rend)   → 同上，新 spine 只请求一次
```

`fetchEbookThoughts` 全仓库仅 `useEbookThoughtLoader.ts` 调用（`codegraph`）；删 effect 后 **无全量 list 调用方**。

---

## 3. 影响点矩阵

| 模块 / 场景 | 影响等级 | 分析 |
|-------------|----------|------|
| **EPUB 进书网络** | 低（改善） | 不再出现 `GET /thoughts/:id`（无 `spineHints`）；仅保留当前章 `?spineHints=` |
| **EPUB 当前章虚线** | 无 | `epubNavReady` 后仍拉当前已加载 spine；`EpubPane` apply 链未改 |
| **EPUB 换章** | 无 | `saveCfi` → `ensureLoadedSpineThoughts` 行为未变 |
| **大册内存占用** | 低（改善） | 不再偶发全书进 `thoughts`；与 `filterThoughtsForAnnotationApply` 按章策略一致 |
| **小册（&lt;35 CFI 组）** | 无 | 未达 spine 过滤阈值；仍依赖已加载章数据，与按章设计相同 |
| **公开书多人 sync** | 无 | `usePublicEbookThoughtSync` + `applyEbookThoughtSync` 未触及 |
| **openThoughtCluster 先 sync** | 无 | `refreshThoughtsNow` 走 sync API，不依赖 list 全量 |
| **想法新建/编辑/删除** | 无 | `createEbookThought` 等 + 本地 `setThoughts` / `mergeThoughts` 未改 |
| **用户划线 / 听书 / PopBar** | 无 | 不读被删 effect；`highlights` 独立 fetch |
| **PDF 阅读** | 无 | 无想法 UI；`thoughts` 恒 `[]`，与改前用户可见行为一致 |
| **后端 list 全量接口** | 无 | 接口仍保留，仅前端 EPUB 进书不再误调 |

---

## 4. 潜在风险与缓解

| 风险 | 等级 | 说明 | 建议验证 |
|------|------|------|----------|
| 依赖「进书即全书在内存」的隐式行为 | 低 | 按章设计本不要求全书；cluster 在 `allThoughts` 内扩展 | 大书：未访问章无虚线，滚到该章后出现（预期） |
| 全量请求与按章请求竞态导致状态覆盖 | 低（已消除） | 改前全量 `setThoughts` 可覆盖按章 merge；改后无全量 | 进书 DevTools：仅见 `spineHints` 请求 |
| 未来 PDF 支持想法 | 低 | 需新 loader 分支，不能复用已删 effect | 规格落地时单独设计（非 CFI spine） |
| `bookFmt` 长期 `undefined` | 低 | 书籍解析失败时不拉想法，与改前 EPUB 终态一致 | 异常书详情：无想法请求或仅重试后按章拉 |

---

## 5. 未改动项

| 项 | 说明 |
|----|------|
| `ensureSpineThoughtsLoaded` / `mergeThoughtLists` | 按章 merge、每 spine 只请求一次 |
| `usePublicEbookThoughtSync` | relocated 防抖 sync、`visibilitychange` 刷新 |
| `epubThoughtAnnotations` 视口 apply | `SPINE_SCOPED_APPLY_MIN_GROUPS`、pin、双轨 reclaim |
| `read.tsx` 想法 CRUD、侧栏、cluster | 仍消费同一 `thoughts` state |
| 后端 `listThoughts(spineHints?)` | API 与 SQL 过滤未改 |
| PDF 高亮、进度、目录 | 与想法无关 |

---

## 6. 回归清单

- [ ] EPUB 进书：Network 仅 `GET /thoughts/:bookId?spineHints=...`，**无**无参全量 list
- [ ] EPUB 当前章：他人/本人想法虚线正常；点击打开 cluster / 详情
- [ ] EPUB 换章：新章虚线出现；Network 每 spine 仅一次 `spineHints`
- [ ] 公开书：滚动停稳后 sync；他人新想法视口内出现
- [ ] 新建想法：保存后虚线即时可见，邻近线不丢
- [ ] PDF 阅读：无想法入口；无多余 `/thoughts` 请求
- [ ] 换书：`thoughts` 清空，无上一本残留
- [ ] `npx tsc --noEmit`（`apps/frontend`）

---

## 7. 相关文档滞后

| 文档 | 说明 |
|------|------|
| [EPUB想法视口标注影响.md](./EPUB想法视口标注影响.md) §1 | 「PDF 想法 \| loader 仍全书一次 fetch」已过时；PDF 不支持想法且无 list |
| [EPUB想法视口性能.md](../ebook/EPUB想法视口性能.md) §3.2 | 仍写「PDF：仍全书一次」；应以本篇为准 |

---

（若与仓库最新源码不一致，以源码为准）
