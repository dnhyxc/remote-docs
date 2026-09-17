# 小程序 EPUB 服务端解析 — 影响点分析

## 延伸阅读

- [小程序EPUB解析逻辑.md](../ideas/miniprogram/小程序EPUB解析逻辑.md) — 解析编排、API 与小程序消费链路（规划/已落地说明）
- [小程序EPUB服务端解析.md](../ebook/小程序EPUB服务端解析.md) — **实现归档**：BullMQ、`startParseTask`/`waitForParse` 改动前后对比与逐行注释
- [电子书COS对象键解析.md](../ebook/电子书COS对象键解析.md) — `resolveCosObjectKey` / `uploadEbookAssetBuffer` 动机与调用点
- [电子书阅读进度保存.md](../ideas/ebook/电子书阅读进度保存.md) — Web 端 CFI / percent 进度保存（未改调用方）
- [电子书进度远程防抖影响.md](./电子书进度远程防抖影响.md) — Web 进度 PUT 防抖与 keepalive

**阅读约定**：结论以仓库 **当前源码** 为准；「历史风险」指旧实现曾出现的问题，不代表现行代码仍会触发。

---

## 1. 分析目的

评估 **为微信小程序增加 EPUB 服务端章节解析** 相关改动，是否改变或破坏已有功能：

- Web / Tauri **epub.js 阅读**（`resolveOpen` → `fetchEbookBytes` → `EpubPane`）
- **书架上传 / 删除 / 公开书** 与 COS 存储
- **阅读进度** `PUT /ebook/progress`（CFI / PDF 页码）
- **划线 / 想法 / 听书 / 助手** 等 EPUB 标注与 TTS 链路
- **COS 下载与代理**（`GET /ebook/file/:id`、`/ext-cos/`）
- **聊天附件 / 封面上传** 等其它 `UploadService` 调用方

**改动范围（当前 diff）**：

| 文件 | 变更 |
|------|------|
| `apps/backend/src/services/ebook/epub-chapter-parser.service.ts` | **新增** EPUB 解压、spine 遍历、图片 COS 化、HTML 清洗 |
| `apps/backend/src/services/ebook/epub-html.util.ts` | **新增** `extractBodyHtml` / `sanitizeEpubHtml` / `countWords` |
| `apps/backend/src/services/ebook/ebook-chapter.entity.ts` | **新增** `ebook_chapter` 实体 |
| `apps/backend/src/services/ebook/ebook.service.ts` | **扩展** 懒解析编排、章节 API、`markEpubParsePending`、删书清章节 |
| `apps/backend/src/services/ebook/ebook.controller.ts` | **新增** `GET book/:id/chapters`、`GET book/:id/chapter/:index` |
| `apps/backend/src/services/ebook/ebook.module.ts` | 注册 `EbookChapter`、`EpubChapterParserService`、**BullMQ `epub-parse-queue`**、`EpubParseProcessor`、`EpubParseQueueEvents` |
| `apps/backend/src/services/ebook/ebook-book.entity.ts` | **新增** `parse_status` / `total_word_count` / `parse_attempt` |
| `apps/backend/src/services/ebook/ebook-progress.entity.ts` | **新增** `chapter_index` / `chapter_href` / `scroll_percent` |
| `apps/backend/src/services/ebook/dto/save-ebook-progress.dto.ts` | **可选** 上述进度字段 |
| `apps/backend/src/services/upload/upload.service.ts` | **扩展** `objectExists`、`resolveCosObjectKey`、`uploadEbookAssetBuffer`；`ebooks` 键规则 |
| `apps/backend/package.json` / `pnpm-lock.yaml` | **新增** 依赖 `jszip` |
| `apps/backend/src/services/ebook/epub-parse.processor.ts` | **新增** BullMQ Worker，`concurrency:1`，消费 `processEpubParseJob` |
| `apps/backend/src/services/ebook/epub-parse-queue-events.ts` | **新增** `QueueEvents`，供 `waitUntilFinished`（非 chat 日志监听器） |
| `apps/backend/src/services/ebook/epub-parse.constants.ts` | **新增** 队列名 `epub-parse-queue` |
| `apps/backend/src/migrations/1783853407238-wechat_epub.ts` 等 | `ebook_chapter` 表、`parse_attempt` 等（**`ebook_progress` 新列迁移待补全**，见 §7） |

**结论摘要**：

| 维度 | 是否影响原有功能 | 说明 |
|------|------------------|------|
| Web EPUB 阅读（epub.js） | **否** | 仍走 `resolveOpen` → `GET /ebook/file`；未调用新章节 API |
| Web 划线 / 想法 / 听书 | **否** | 标注仍基于 epub.js CFI；`getChapter` 未参与 Web 链路 |
| Web 进度保存（CFI / percent） | **否** | `saveEbookProgress` 仍只传 `epubCfi`/`percent`；新字段可选写入 |
| 书架 / 上传 / 删除 | **有条件变化** | EPUB 上传后 BullMQ 后台解析；删源书多删 `ebook_chapter`；新上传 COS 键格式变 |
| `GET /ebook/file` 云端下载 | **有条件变化** | `pipeObjectToWritable` **未**走 `resolveCosObjectKey`；历史中文键仍可能 404 |
| 小程序章节阅读 | **低（增强）** | 新 API + 解析；`ready` 后 `getChapter` 为 DB 直读 |
| 公开书 / 读书记录 | **低（增强）** | `getBook` 透传源书 `parseStatus`；章节读 `resolveContentBook` |
| 其它 COS 上传（chat/assets） | **否** | `buildCosObjectKey` 仅 `prefix==='ebooks'` 分支变化 |
| **Redis / BullMQ 依赖** | **是** | 解析入队依赖 Redis（与 chat 队列共用连接）；无 Redis 则章节 API 无法调度 |
| 部署 / 数据库 | **是** | 新表与新列；**`ebook_progress` 三列迁移待补全** |

---

## 2. 改动要点（相对改前行为）

### 2.1 上传后异步 EPUB 解析

**改前**：

```text
POST /ebook/upload → 写 ebook_book.file_path → 结束
Web 阅读时现场拉整包 EPUB 字节给 epub.js
```

**改后**：

```text
POST /ebook/upload → 写 file_path → void markEpubParsePending(resetAttempts)
  → epub-parse-queue.add(jobId=epub-parse-{bookId})
  → EpubParseProcessor(concurrency:1) → waitThenParse → runEpubParse → ebook_chapter 入库
小程序 GET /chapters|/chapter/:index：
  ensureEpubParseScheduled → 必要时 await startParseTask
  waitForParse：ready 秒退；pending 最多阻塞 120s（waitUntilFinished）
```

**动机**：个人小程序无法 web-view + epub.js，需预解析章节 HTML；BullMQ 限制并发避免多本 EPUB 打满 CPU。

**对原有功能**：上传 API **响应语义不变**；服务端 **额外 CPU / COS 写入** + **Redis 队列**（与 chat 共用 `BullModule.forRoot`）。

### 2.2 COS 电子书键与兼容读取

**改前**：

```text
ebooks/{uuid}_{原始文件名}.epub
getObject / pipeObject 直接用 DB 中的 file_path
```

**改后**：

```text
新上传：ebooks/{uuid}.epub（无中文文件名）
resolveCosObjectKey：DB 键 head 404 时按 UUID 列举前缀找回真实键
getObjectBuffer 统一先 resolve；pipeObjectToWritable 仍 normalize 后直读
解析成功时可回写 ebook_book.file_path
```

**动机**：历史中文键 404；小程序章节图需稳定外链。

### 2.3 进度 API 扩展（向后兼容）

**改前**：`ebook_progress` 仅 `epub_cfi` / `pdf_page` / `percent`。

**改后**：可选写入 `chapter_index` / `chapter_href` / `scroll_percent`；`toProgDto` 读出并返回。

**动机**：小程序无 CFI，用章索引 + 滚动比例定位。

**对 Web**：`apps/frontend/src/service/index.ts` 的 `saveEbookProgress` **未传新字段**；旧字段逻辑不变。小程序写入新字段 **不覆盖** Web 的 `epubCfi`（各写各的列）。

### 2.5 BullMQ 调度（相对进程内 Promise）

**改前（初版实现）**：

```text
startParseTask → 内存 Map<bookId, Promise> → 同进程 waitThenParse
多本并行无上限；API 重启丢任务
```

**改后（当前）**：

```text
startParseTask → epubParseQueue.add
EpubParseProcessor @Processor(concurrency:1) → processEpubParseJob
waitForParse → EpubParseQueueEvents + job.waitUntilFinished（仅 pending）
```

**与 chat `QueueEventsListener` 的区别**：chat 监听器仅打日志；epub 的 `EpubParseQueueEvents` 用于 **API 等待 job 完成**，二者互不替代。

**已修复的实现坑（历史风险，现行代码不应再触发）**：

| 问题 | 现象 | 修复 |
|------|------|------|
| `void startParseTask` | 入队未完成即 `waitForParse` → 秒 409 | 改为 `await startParseTask` |
| `jobId` 含 `:` | BullMQ 抛 `Custom Id cannot contain :` | 改为 `epub-parse-${bookId}` |
| `ready` 后 `waitForParse` 空轮询 | 每次换章多等 ~1s | `parse_status===ready` 直接 return |

---

### 2.4 删书级联

**改前**：删书清 thoughts / highlights / progress。

**改后**：删 **源书**（`!sourceBookId`）时额外 `chapterRepo.delete({ bookId })`。

**动机**：避免孤儿章节行；读书记录副本不删源书章节。

---

## 3. 影响点矩阵

| 模块 / 场景 | 影响等级 | 分析 |
|-------------|----------|------|
| **Web `read.tsx` + `EpubPane`** | 无 | 未引用 `getChapters`/`getChapter`；`resolveOpen` 路径未改 |
| **Web 进度 `saveEbookProgress`** | 无 | 仍 PUT `epubCfi`/`percent`；后端新列为 optional merge |
| **Web 划线 / 想法 / sync** | 无 | 仍依赖 epub.js `Rendition` 与 CFI；与 `ebook_chapter` 无交集 |
| **听书 / 听当前 / TTS** | 无 | 分句与标注链路未触达 `EpubChapterParserService` |
| **书架 UI** | 无 | 前端 `Book` 类型无 `parseStatus`；多字段 JSON 被忽略 |
| **EPUB 上传（Web/Tauri）** | 低 | 响应不变；后台 BullMQ 排队解析；`concurrency:1` 限制并行 |
| **EPUB 重传 / 覆盖 `bookId`** | 中 | `markEpubParsePending(resetAttempts)` 清章节重解析；不影响 Web 读原 EPUB 文件路径，但 COS 键可能更新 |
| **`GET /ebook/file/:id`（Web 纯在线阅读）** | 中 | `pipeFileToResponse` → `pipeObjectToWritable(payload.key)` **不经** `resolveCosObjectKey`；历史 `ebooks/{uuid}_中文.epub` 且 DB 键与 COS 不一致时仍 404（解析链路可修复 DB 键，但下载链路未复用） |
| **`getObjectBuffer`（解析读 EPUB）** | 低（增强） | 经 `resolveCosObjectKey`，老书解析成功率提升 |
| **新上传 COS 对象键** | 低 | 仅 `prefix=ebooks` 变为 `ebooks/{uuid}.ext`；chat/assets 不变 |
| **章节内图片 COS 存储** | 低 | 新增 `ebooks/assets/{bookId}/` 对象；删书 **不** 批量删资产（与改前删主 EPUB 一致，资产或残留） |
| **公开书读书记录** | 低 | `getChapters`/`getChapter` 经 `resolveContentBook` 读源书章节；副本 `bookId` 对外 API 不变 |
| **仅 `path` 未上云的书** | 无（Web）/ 高（小程序） | Web Tauri 仍本地读；小程序 `assertEpubSourceAvailable` → 400，属预期 |
| **PDF 书籍** | 无 | `canParseEpubSource` 要求 `fmt==='epub'`；无解析任务 |
| **新增章节 API** | 无（Web） | 纯增量路由；旧客户端不调用则无感 |
| **小程序 `GET /chapter/:index`（ready 后）** | 无 | `waitForParse` 见 `ready` 秒退；仅 DB 读 `mediumtext`；慢主要来自 HTML 体积与网络 |
| **Redis / BullMQ** | 中 | 解析依赖 Redis；与 chat 队列共用连接配置 | 确认 Redis 可用；观察 `epub-parse-queue` 堆积 |
| **数据库迁移** | 高 | 需 `ebook_chapter` + `ebook_book` 新列 + **`ebook_progress` 三列**；缺迁移则 SQL 失败 |
| **服务重启** | 低 | 任务在 Redis 队列持久化；`pending` 书下次 API 可重新入队 | 重启后打开 pending 书应能继续解析 |

---

## 4. 潜在风险与缓解

| 风险 | 等级 | 说明 | 建议验证 |
|------|------|------|----------|
| **`ebook_progress` 列未迁移** | 高 | 实体已加 `chapter_index` 等，diff 内无对应 `ALTER TABLE` | 部署前 `m:g` 补迁移；`m:run` 后 `saveProgress` smoke test |
| **Web 下载未 resolve 历史键** | 中 | `pipeObjectToWritable` 与 `getFileForDownload` 未调用 `resolveCosObjectKey` | 用历史中文键书籍 Web 在线打开；或统一让 `pipeObjectToWritable` 也 resolve（实现阶段） |
| **解析任务占满 CPU** | 低 | BullMQ `concurrency:1` 全书串行 | 多实例时仍建议 worker 独立进程或限核 |
| **BullMQ jobId 非法字符** | 低（已修复） | 历史 `epub-parse:{uuid}` 含 `:` 导致入队失败 | 已改为 `epub-parse-${bookId}` |
| **入队/等待竞态** | 低（已修复） | `void startParseTask` 或 `ready` 后空轮询导致慢/409 | 已 `await startParseTask` + `ready` 早退 |
| **解析失败态** | 中 | `parse_status=failed` 后小程序 409 含「失败」；Web 不受影响 | 损坏 EPUB 上传后仅小程序 API 失败，Web 仍可读原文件 |
| **COS 资产残留** | 低 | 重解析 / 删书不清理 `ebooks/assets/` | 存储监控；非功能回归项 |
| **`parse_status` 默认 pending** | 低 | 存量 EPUB 首次被小程序拉章节时才解析 | 确认迁移默认值；避免误触大量冷启动解析 |
| **409 与小程序文案耦合** | 低 | `isChapterParsePending` 解析中文错误消息 | 改后端文案时同步小程序判断 |

---

## 5. 未改动项

| 项 | 说明 |
|----|------|
| `EpubPane` / epub.js 渲染管线 | 仍消费 ArrayBuffer，不读 `ebook_chapter.html` |
| `saveEbookProgress` / `saveEbookProgressKeepalive`（Web） | 请求体字段集合未扩展 |
| `POST/GET /ebook/highlights`、`/thoughts` | 无签名与存储变更 |
| 听书 utils（`epubListen*`） | 未引用章节 API |
| `uploadObjectToCos`（chat 附件） | `prefix` 默认 `assets`，键规则不变 |
| `buildCosObjectKey` 非 ebooks 前缀 | 仍为 `assets/{uuid}_{safeName}` |
| `ChatMessageProcessor` / `chat-message-queue` | 独立队列；epub 不共用 Processor，仅共用 Redis 连接 |
| `QueueEventsListener`（chat） | 仅 chat 日志；epub 用 `EpubParseQueueEvents` 等功能组件 |

---

## 6. 回归清单

- [ ] **Web EPUB 主路径**：书架 → 打开书 → 滚动 → CFI 进度保存 → 刷新恢复
- [ ] **Web 划线 / 想法**：选区划线、想法创建、公开书 sync 仍正常
- [ ] **听书 / 听当前**：播放、换章、与划线层无叠层异常
- [ ] **Tauri 本地 path 书**：未上云仍可 `resolveOpen` 本地读
- [ ] **EPUB 上传**：新书记 `file_path` 为 `ebooks/{uuid}.epub`；Web 可打开
- [ ] **历史中文键 EPUB**：Web `GET /ebook/file` 是否仍 404（记录预期）；小程序 `GET /chapters` 是否解析成功并回写 `file_path`
- [ ] **重传同一 `bookId`**：章节重解析；Web 阅读内容与新文件一致
- [ ] **删源书**：`ebook_chapter` 同行删除；公开书读书记录副本仍在
- [ ] **PDF 书**：上传、阅读、进度不受影响
- [ ] **`PUT /ebook/progress`（Web）**：仅 CFI 时 `chapter_index` 不被误清（仍为 null 或旧值）
- [ ] **小程序**：首次 pending 书 → 目录 + 正文；`failed` 书提示失败不无限轮询
- [ ] **小程序 ready 后换章**：`GET /chapter/:index` TTFB 应 <1s（无队列等待）；缓存命中更快
- [ ] **BullMQ**：上传 EPUB 后日志出现 `EPUB 解析任务开始`；`EPUB 解析完成`
- [ ] **迁移**：`m:run` 后 `ebook_chapter` 存在；`saveProgress` 带 `chapterIndex` 不报错
- [ ] **聊天附件上传**：仍成功，键名格式不变

---

## 7. 相关文档滞后

| 文档 | 说明 |
|------|------|
| `docs/ideas/小程序EPUB解析逻辑.md` | 已同步 BullMQ、`waitForParse` ready 快路径、已修复坑 |
| `docs/ebook/电子书COS对象键解析.md` | 写明 `getObjectBuffer` 走 resolve；**未**说明 `pipeObjectToWritable` 未走 resolve |
| `apps/frontend/src/views/ebook/types.ts` | `Book` / `Prog` 未声明 `parseStatus`、`chapterIndex` 等（可选后续对齐，非阻塞） |
| **数据库迁移** | `ebook_progress.chapter_*` / `scroll_percent` 及 `ebook_book.total_word_count` 等 **需在实现阶段补 migration** |

---

（若与仓库最新源码不一致，以源码为准）
