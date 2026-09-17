# 公开书想法增量同步 — 影响点分析

## 延伸阅读

- [EPUB公开想法实时同步影响.md](../ebook/EPUB公开想法实时同步影响.md) — 实现说明
- [电子书公开分享影响.md](./电子书公开分享影响.md) — 公开书数据范围与读书记录
- [EPUB想法视口标注影响.md](./EPUB想法视口标注影响.md) — sync 后 `ephemeralPin` 与视口 apply 联动

## 1. 分析目的

评估 **`GET /thoughts/:bookId/sync`、`usePublicEbookThoughtSync`、`epubThoughtSync.ts`、`openThoughtCluster` 先 sync** 是否改变或破坏已有能力：

- 私有 EPUB 想法（创建/编辑/删除、列表、点击聚类）
- 进书想法加载路径
- 想法与正文虚线 sync 时机
- 网络请求量与节流
- 后端 `listThoughts` / `syncThoughts` 一致性
- PDF 想法（若存在）

**改动范围（当前 diff）**：

| 文件 | 变更 |
|------|------|
| `apps/backend/src/services/ebook/ebook.service.ts` | `syncThoughts`、`queryRemovedThoughtIdsSince`、revision |
| `apps/backend/src/services/ebook/ebook.controller.ts` | `GET .../sync`、`/revision`、`/changes` |
| `apps/backend/src/services/ebook/dto/query-ebook-thought-*.dto.ts` | sync/changes 查询参数 |
| `apps/frontend/src/service/index.ts` | `fetchEbookThoughtSync` 等 |
| `apps/frontend/src/views/ebook/utils/epub/mark/epubThoughtSync.ts` | 合并、`isSharedEbookThoughtContext` |
| `apps/frontend/src/views/ebook/hooks/usePublicEbookThoughtSync.ts` | 双轨 sync hook |
| `apps/frontend/src/views/ebook/read.tsx` | 接线、`openThoughtCluster` 异步 refresh |
| `apps/backend/src/services/ebook/dto/create|update-ebook-thought.dto.ts` | `isPublic` 字段 |

**结论摘要**：

| 维度 | 是否影响原有功能 | 说明 |
|------|------------------|------|
| 私有 EPUB 想法 CRUD | **否** | API 路径不变；`sync` gate 对私有书返回空包且不调用 |
| 私有书网络流量 | **否** | `isSharedEbookThoughtContext` 为 false 时 hook 不请求 |
| 点击虚线开列表（私有书） | **有条件变化** | 公开书先 `refreshThoughtsNow`；私有书仍同步开列表（无 await 网络） |
| 点击虚线开列表（公开书） | **是（增强）** | 一次点击即含他人最新想法；略增延迟 |
| 滚动时想法更新（公开书） | **是（增强）** | 停稳后最多 15s 间隔增量；私有书无此行为 |
| `listThoughts` 全量接口 | **否** | 仍存在；EPUB 进书改由 `useEbookThoughtLoader` 按章调用（见 viewport 文） |
| 删想法 / 改私密 | **有条件变化** | 公开上下文靠 `deletedIds` 剔除；私有书仅本地 state + 原 API |

---

## 2. 改动要点（相对改前行为）

### 2.1 后端 `/sync`

**改前**：无增量接口；`listThoughts` 每次全量。

**改后**：`syncThoughts(userId, bookId, since?)` 返回 `{ revision, changes, deletedIds }`；私有非读书记录直接空 DTO。

**动机**：公开多人共读时降低 payload、支持删除传播。

### 2.2 前端 hook 启用条件

**改前**：无后台 sync。

**改后**：`enabled = isSharedEbookThoughtContext(book, publicSource)`；`saveCfi` → `scheduleSync`（2s debounce + 15s 最小间隔）；`visibilitychange` 回前台 force 一次。

### 2.3 `openThoughtCluster`

**改前**：直接用 mark 携带的 cluster 开侧栏。

**改后**：公开书先 `await refreshThoughtsNow()`，再 `expandClusterFromMarkSeed`。

**动机**：避免 stale `thoughtIds` 导致「点两次才见人」。

---

## 3. 影响点矩阵

| 模块 / 场景 | 影响等级 | 分析 |
|-------------|----------|------|
| **私有 EPUB 写想法** | 无 | `createEbookThought` 不变；不触发 `/sync` |
| **私有 EPUB 点虚线** | 低 | 无网络等待；聚类逻辑仍 `reconcileThoughtClickCluster` |
| **公开 EPUB 点虚线** | 中 | 多一次 `/sync` RTT；列表更全 |
| **公开 EPUB 滚动** | 中 | 他人新想法延迟 ≤ debounce+15s；非实时推送 |
| **源书已取消公开** | 中 | `publicSource.isStillPublic=false` → sync 关闭；范围退回收窄 |
| **书主读自己公开源书** | 低 | `book.isPublic` 启用 sync；可见读者公开想法 |
| **想法侧栏列表** | 低 | `EpubThoughtList` 展示 `isPublic` 徽章；私有书仅本人条目 |
| **聚类缓存** | 低 | sync 合并后 `invalidateThoughtClusterConnectivityCache` |
| **sync 后虚线** | 中 | `ephemeralPinThoughtCfis` 与视口 apply 联动（viewport 文） |
| **PDF** | 无 | 无 `/sync`；loader 仍全书 `fetchEbookThoughts` 一次 |
| **高亮 sync** | 无 | `syncEpubUserHighlights` 独立；想法 sync 不 invalidate 投影缓存 |
| **revision/changes 端点** | 低 | 兼容保留；前端主路径仅用 `/sync` |

---

## 4. 潜在风险与缓解

| 风险 | 等级 | 说明 | 建议验证 |
|------|------|------|----------|
| 公开书点击虚线卡顿 | 低 | force sync 阻塞开列表 | 弱网下点虚线，列表应在一次点击后出现 |
| 15s 节流漏展示他人新线 | 中 | 滚动轨非实时；依赖 pin+视口 apply | A 写想法后 B 滚动停稳 20s 内应见灰线 |
| `since−1ms` 边界 | 低 | 同毫秒更新靠 SQL `>` | 快速连改同一条想法 |
| `deletedIds` 未剔除 | 中 | 改私密/软删后本地残留 | 书主改私密后读者 sync 后列表与虚线消失 |
| 并发 in-flight | 低 | `inFlightRef` 复用 Promise | 快速连点虚线不重复请求 |
| 私有书误调 sync | 低 | 后端+前端双 gate | 私有书 Network 无 `/sync` |

---

## 5. 未改动项

- 用户划线 create/update/delete API
- 想法虚线 patch 几何（叠层 rank）— 属 mark 层另文
- 听书 / 听当前 / MOKE
- 书摘分享 Canvas
- `GET /thoughts/:bookId` 响应 DTO 形状（仅增 `isPublic` 字段）

---

## 6. 回归清单

- [ ] 私有 EPUB：写/改/删想法；Network 无 `/sync`
- [ ] 私有 EPUB：点虚线开列表无感延迟
- [ ] 公开书 A/B：B 写想法，A 点一次虚线见 B
- [ ] 公开书：滚动停稳后视口内出现他人新虚线（允许 15s+debounce）
- [ ] 书主改想法为私密：读者 sync 后侧栏与虚线移除
- [ ] 页签切后台再回前台：公开书触发一次 sync
- [ ] 源书取消公开：读者 sync 停止、只见本人想法

---

## 7. 相关文档滞后

| 文档 | 说明 |
|------|------|
| `docs/ideas/电子书想法同步性能优化.md` | SQL 增量细节；实现以 `ebook.service` 为准 |
| `docs/ebook/EPUB想法下划线实现.md` | 未描述 `/sync`；以 `EPUB公开想法实时同步影响.md` 为准 |

---

（若与仓库最新源码不一致，以源码为准）
