# 英语学习

路径：`apps/frontend/src/views/english-learning/`、`apps/backend/src/services/english-learning/`、`agent/`。

## 入口与总览

| 文档 | 说明 |
|------|------|
| [学习笔记远程.md](./学习笔记远程.md) | **学习笔记 MF Remote**：`/english-learning/notes`、`remotePlugins/LearningNotes`（:9008）、`injectRoute: false` |
| [学习笔记脏保存.md](./学习笔记脏保存.md) | **学习笔记未保存橙点**：编辑有 diff 时保存图标显示脏标记 |
| [学习笔记富文本编辑.md](../ideas/notes/学习笔记富文本编辑.md) | **学习笔记富文本编辑器**：升级 Tiptap 至 3.28.0、支持格式化文本、高亮、列表等功能 |
| [学习笔记导出性能.md](./学习笔记导出性能.md) | **学习笔记导出 Word 与长文性能优化**：DOCX 导出全链路（后端→HostBridge→插件）、TitleNode 选区修复、RichEditor opt-in 扩展、openPreview 乐观预览、Toolbar ResizeObserver deps 修复 |
| [学习笔记DOCX构建.md](./学习笔记DOCX构建.md) | **DOCX Builder 端到端实现手册**：后端 `learning-note-docx.builder.ts` 全 28 个符号（HTML→DOCX 转换、sharp 懒加载转 JPEG、foreign/webp 兼容、本机 uploads 读盘、ImageBudget 图片预算、表格/列表/代码块转换、`buildLearningNoteDocxBuffer` 主入口） |
| [学习笔记大编辑器.md](./学习笔记大编辑器.md) | **长文笔记编辑器（LargeNoteEditor）**：切块窗口化挂载、`LargeNoteDoc` 模型、`flushWindow` 写回、`originForScroll` 滞回换窗、入场贴底、`NotesListPanel` 列表隔离 |
| [学习笔记窗口化预览.md](./学习笔记窗口化预览.md) | **长文窗口化预览（WindowedPreviewBody）**：`previewHtml.ts` 全正则化 HTML 处理（剥标题/补空段/图片懒加载/切块）、预览窗口化挂载、`NotePreview` 改造 `children` 插槽 |
| [学习笔记图片内联样式.md](./学习笔记图片内联样式.md) | **学习笔记图片内联样式**：`previewHtml.ts` 注入 `<img>` margin/圆角内联样式、首图去顶距、`NotePreview` 去 `contain:style`、`RichEditor/extensions` Image 配置加内联 style、`RichEditor/styles.css` 排除伪图与缩放容器间距；摆脱 MF @scope stylesheet 依赖（含改动前/后对比与逐行注释） |
| [学习笔记编辑器打磨.md](./学习笔记编辑器打磨.md) | **富文本编辑器打磨**：`TitleNode.appendTransaction` GapCursor 二次修正、`EmptyParagraphDelete` 扩展、`NoteTitleField` 抽取、`fileToDataUrl` 非 DOCX 安全 MIME 转 JPEG、GapCursor CSS、`mountEditor` 延迟挂载 |
| [学习笔记富文本编辑器深潜.md](./学习笔记富文本编辑器深潜.md) | **富文本编辑器源码级详解**：13 个模块逐行注释、架构/调用链/设计决策全景 |
| [富文本编辑器核心修复.md](./富文本编辑器核心修复.md) | **富文本编辑器核心优化**：appendTransaction GapCursor 精细化、onCreate 两帧 rAF 选区、shouldShowBubble 提取、工具栏 fits 溢出重算、LinkForm 迁 UI 组件、ScrollArea 接管滚动 |
| [富文本编辑器性能调优.md](./富文本编辑器性能调优.md) | **RichEditor 性能优化**：JSON 懒序列化、回调 ref 化、CharacterCount 按需挂载、toolbarExtra useMemo |
| [富文本编辑器边缘导航.md](./富文本编辑器边缘导航.md) | **Cmd/Ctrl+↑↓ 文档首尾导航**：新增 `DocEdgeNav` 扩展与 `scrollEditorViewport` 辅助函数、`TitleNode.appendTransaction` 选区纠正从 `Selection.atEnd` 改为 `TextSelection.near`（含改动前/后对比与逐行注释） |
| [Tauri剪贴板富文本.md](./Tauri剪贴板富文本.md) | **Tauri 剪贴板支持 TipTap**：桌面端 WebView 系统级 Cmd/Ctrl+C/V/X 快捷键接管 TipTap 富文本正文 |
| [Tauri剪贴板图片文件.md](./Tauri剪贴板图片文件.md) | **Tauri 剪贴板图片与文件列表读取**：Rust `arboard` 位图→PNG→base64、文件列表逐个读图→data URL、`clipboard.ts` 四 flavor 并行读取与降级插入、`getTipTapEditor`/`insertHtmlViaEditor`/`insertClipSegments` 全链路（含改动前/后对比与逐行注释）；与 [../ideas/Tauri剪贴板富文本粘贴.md](../ideas/tauri/Tauri剪贴板富文本粘贴.md) 互为专题/总文档 |
| [学习笔记CRUD.md](./学习笔记CRUD.md) | **学习笔记 CRUD 与 API 集成**：列表左/编辑器右布局重构、`createNotesApi` 工厂、`Confirm` 删除确认、HostBridge 扩展 `put/delete` 全链路 |
| [学习笔记图片上传与回收.md](./学习笔记图片上传与回收.md) | **学习笔记正文图片上传与孤儿回收**：COS `notes/` 前缀 + 附件表（`noteId × cosKey`）+ pending 表（`sessionId × cosKey`，TTL 1h）双表引用计数 + 正文为真相源 diff 附件表 + save/update `settlePendingSession` + 删笔记双源收 key + TTL 兜底 GC + 桌面端粘贴 `data:image/` 转 File 派发 `rich-editor:desktop-paste-images` 走 `onUploadImage` 钩子（含改动前/后对比与逐行注释）；与 [Tauri剪贴板图片文件.md](./Tauri剪贴板图片文件.md) 互为前后端姊妹稿 |
| [学习笔记独立弹窗.md](./学习笔记独立弹窗.md) | **学习笔记独立弹窗与多窗口同步**：Tauri 托管关窗（Rust `prevent_close` → eval → 前端 await 保存 → `destroy`）+ BroadcastChannel 跨窗同步总线（7 种消息类型）+ HostHttpClient 包装自动广播 + StoreSync（MobX `connectStore` binding）+ DomSync（ProseMirror `execCommand` 兜底）+ 关窗保存三重保障（`autoSaveIfDirty` → `await fetch` → `keepalive`）+ 外观跟随（主题/强调色/语言 `BroadcastChannel` 广播）+ `patchLearningNotesPlugin` monkey-patch 注入同步（含改动前/后对比与逐行注释、五层架构图、数据流说明） |
| [学习笔记弹窗Host瘦身.md](./学习笔记弹窗Host瘦身.md) | **学习笔记弹窗 Host 瘦身重构**：删除 StoreSync / DomSync / HttpSync / CloseSave / PatchPlugin / Popout 共 6 个文件（1083 行），Host 不再读插件 MobX store / ProseMirror DOM / 包装 HTTP / monkey-patch 插件入口；改为 Host 只提供通道（`sync.publish*` / `subscribe` / `registerBeforeClose`），插件注册 `beforeClose` 回调自行保存、订阅总线自行分发（`applyRemote` / `refreshList`）；`LearningNotesPluginHost` 从 69 行同步中继简化为 10 行纯挂载（含改动前/后对比与逐行注释、架构对比图、被删文件概览） |
| [移除SyncRelay桥接.md](./移除SyncRelay桥接.md) | **移除 SyncRelay 桥接组件（简化跨窗同步架构）**：删除 `LearningNotesSyncRelay.tsx` 冗余 EventBus 中继；`index.tsx` / `popout.tsx` 两处去挂载；`federation/guide.md` §9 合并步骤（9.3/9.4 → 新 9.3）、移除 Sync Relay 代码示例与 `+ <LearningNotesSyncRelay />` 清单项；`modules/learningNotes/README.md` 去 SyncRelay bullet；同步总线直连 `api.modules.*.sync.subscribe` 不再桥接 `eventBus`（含 5 组改动前/后成对对比、100% 逐行注释、纯删除文件专门处理） |
| [学习笔记同步总线双路径.md](./学习笔记同步总线双路径.md) | **学习笔记同步总线双路径（BC + Tauri emit）**：解决 macOS WKWebView 多 WebView 间 BroadcastChannel 不通问题——`publishLearningNotesSync` 同时发 BC + 本窗 dispatch + Tauri `emit`；`subscribeLearningNotesSync` 订阅 BC + Tauri `listen`（幂等 `ensureTauriListen` 启动一次）；抽取 `dispatchToHandlers` 消除三处 inline 遍历；Host API 新增 `openPopoutWindow`（dynamic import 绕过 TDZ：`@/utils/tauri → @/federation → routeInjector/getStorage` 死循环导致子窗冷启空白）；PopoutShell `data-tauri-drag-region` 移到最外层（`p-7 pt-7.5` 统一 padding）+ 内容区 `bg-theme-secondary rounded-md p-2`；Agent Atom 介绍卡边框色 `border` → `border-theme/5`（与 `bg-theme/5` 和谐）（含改动前/后成对对比与 100% 逐行注释、Web vs 桌面双通道架构图、兼容性与风险矩阵） |
| [学习笔记公开列表.md](./学习笔记公开列表.md) | **学习笔记公开可见与列表卡片重构**：`isPublic` 字段与索引、`PUT /visibility/:id`、`authorMap`/`toListItem`、列表网格与公开徽章、刷新状态机、富文本 hover 描边动画（含改动前/后对比与逐行注释） |
| [学习笔记保存聚焦标题.md](./学习笔记保存聚焦标题.md) | **保存时标题为空自动聚焦标题**：`focusTitle` 回调滚动到顶并聚焦标题输入框、`onSave` 两路径提取 title 变量、保存失败+dirty+空标题时 `focusTitle()`（含改动前/后对比与逐行注释） |
| [学习笔记MobX存储.md](./学习笔记MobX存储.md) | **学习笔记 MobX 状态管理与分页**：useState 重构为 MobX store、列表分页加载、滚动到底部加载更多 |
| [../ideas/第三方联邦插件接入.md](../ideas/plugins/第三方联邦插件接入.md) | **第三方/自建 Remote 接入契约**（registry + 对方 CORS，不改 capabilities） |
| [英语学习实现概述.md](./英语学习实现概述.md) | 产品能力总览 |
| [英语学习后端实现.md](./英语学习后端实现.md) | 后端模块总览 |
| [英语学习主Agent联网搜索转LLM.md](./英语学习主Agent联网搜索转LLM.md) | 主 Agent 与联网 |

## 词包 / 流式 / 会话

| 文档 | 说明 |
|------|------|
| [英语词包SSE.md](./英语词包SSE.md) | 词包 SSE |
| [英语词包流式存储.md](./英语词包流式存储.md) | 流式状态跨路由 |
| [英语词包会话存储.md](./英语词包会话存储.md) | Session/Item 存储模型 |
| [英语词包会话项.md](./英语词包会话项.md) | 结果页分页 |
| [英语词包历史UX.md](./英语词包历史UX.md) | 历史 UX |

## 收藏 / 资源库 / 导入

| 文档 | 说明 |
|------|------|
| [英语学习文库导入.md](./英语学习文库导入.md) | 资源库导入 |
| [英语学习JSON导入.md](./英语学习JSON导入.md) | JSON 导入 |
| [经典语句库导入.md](./经典语句库导入.md) | 经典句库 |
| [文库公开编辑.md](./文库公开编辑.md) | **资源库编辑**：重命名、Enter 保存、超管设公共库、列表权限 |
| [资源库词条续读.md](./资源库词条续读.md) | **资源库词条续读**：跨会话进度持久化（`english_library_items_resume` 表 + keepalive flush）、双向分页、prepend 钉视口、收藏增量识别 prepend、卡片 `h-full` |
| [固定列表统一虚拟滚动.md](./固定列表统一虚拟滚动.md) | **固定列表统一虚拟滚动与续读**：删除 `useVocabularyFavoritesList` 等 5 个重复 Hook，统一复用 `useEnglishLearningList`（新增 `resolveInitialResume` / `refetchOnEnter` / `reloadFromStart`），复用 `english_library_items_resume` 表（占位 libraryId）做 5 个固定列表的续读 |
| [英语学习列表模块收口.md](./英语学习列表模块收口.md) | **列表模块路径与命名收口**：`useLibraryWordsList` → `useEnglishLearningList`（类型 `ElListPageResult` / `UseEnglishLearningListOptions`）、`library/utils/*` → `utils/*`、`englishLibraryItemsResume.ts` + scope helper → `englishLearningResume.ts`、服务层 `patchElListResume` 统一路由、后端占位 id 常量独立 |
| [资源库虚拟网格.md](./资源库虚拟网格.md) | **资源库虚拟网格**：react-virtuoso 行级虚拟化 + CSS Grid 自适应列数，卡片可变高度，与续读 item index 对齐 |
| [资源库列表单向虚拟滚动.md](./资源库列表单向虚拟滚动.md) | **资源库单向滚动 Hook**：移除双向分页，并发预取 [0, resumeOffset+pageSize) 完整窗口 + `restoreFromCache` 缓存短路 + Virtuoso 锚点 |
| [列表悬浮角标.md](./列表悬浮角标.md) | **虚拟列表悬浮角标（FAB）**：`useListScrollCornerFab` 模式判定 + 锚点停靠（停在加载区上方避免误触发 endReached）+ `composeViewportScroll` 滚动事件组合 + ResizeObserver 自适应；收藏/错题/每日记词等虚拟滚动列表右下角置顶/置底按钮 |
| [续读模块开关.md](./续读模块开关.md) | **续读模块开关与一键清除**：服务端持久化 5 个侧栏模块（单词库/语句库/收藏/错题/每日记词记录）的续读开关（仅存关闭状态）+ 会话级本地缓存（默认全开）+ 侧栏标题齿轮菜单（清除/开关）；`elResumeModule.ts` hydrate/订阅 revision，`englishLearningResume.ts` 三段短路，`useEnglishLearningList` 订阅 revision 自动重载，`EnglishSidebarCard` 统一卡片容器（删 `SidebarPanel`），`EnglishSidebarResumeMenu` 齿轮菜单 |
| [资源库词条预取并发.md](./资源库词条预取并发.md) | **续读窗口并发预取**：`buildLibraryPrefetchChunks` 按 1000 切片 + `mapWithConcurrency` 限 3 并发池，结果序与输入一致 |
| [资源库收藏状态分页查询.md](./资源库收藏状态分页查询.md) | **收藏状态按 offset 分页**：后端 GET `.../:libraryId/favorites-status?limit&offset` 接口 + Hook libraryId 模式 + 会话级缓存避免重复查 |
| [单词收藏状态查询.md](./单词收藏状态查询.md) | 收藏状态查询（旧版：按词 POST 批量；资源库新场景请优先看上面的「分页查询」） |
| [收藏状态会话级缓存.md](./收藏状态会话级缓存.md) | **收藏状态会话级缓存与跨页同步**：两个增量收藏 Hook 新增会话级 `sessionFavoriteIdByWordKey` / `sessionQueriedWordKeys` + revision 事件（`bumpXxxFavoriteSession`）；后端在词包历史 / 错题 / 每日记词 / 复习队列 / 随机抽词返回体回填 `favoriteId`；列表快照 `patchVocabFavoriteInListCaches` / `patchClassicFavoriteInListCaches` 同步；消费方迁移到 `isXxxFavorited` / `resolveXxxFavoriteId` 新 API |
| [收藏按钮统一组件.md](./收藏按钮统一组件.md) | **统一收藏按钮组件**：新建 `FavoriteToggleButton`（单词 / 经典句二选一）+ 合并 `DailyCorrectFeedback` / `DailyWrongFeedback` 为 `DailyFeedback`（`variant` 切换）+ `DailyPlayIconButton` 改 Button+Tooltip + 练习答题页顶栏嵌入收藏钮 + `practiceFavoriteToggleProps` 分发 helper + `button.tsx` hover teal-500→teal-400 |
| [英语收藏抽屉.md](./英语收藏抽屉.md) | 收藏抽屉 |
| [英语收藏DOCX导出.md](./英语收藏DOCX导出.md) | 导出 DOCX |

## 练习

| 文档 | 说明 |
|------|------|
| [每日记词实现.md](./每日记词实现.md) | **今日记词**：词汇库随机抽词、认读/四选一、记词记录与 SRS（前后端详解） |
| [每日测验干扰项UI.md](./每日测验干扰项UI.md) | **今日记词 UX**：四选一干扰项迷惑度/去重、底栏按钮间距 |
| [练习复习SRS.md](./练习复习SRS.md) | **今日复习（SRS）**、侧栏整合、复习设置页入口、随机分页补足 |
| [练习总结UI.md](./练习总结UI.md) | 听写/拼写练习与结算页 UI、作答明细、统计条 |
| [练习会话提示.md](./练习会话提示.md) | 单题练习「提示」：听写释义/音标、拼写音标、固定高度无滚动 |
| [练习会话控件.md](./练习会话控件.md) | 两档答错、再试连播、软揭示布局、音波动画、播放钮 |
| [practice-wrong-panel-快捷键.md](./练习错题面板快捷键.md) | **答错/揭示面板 UI**、播放单次/三连播策略、顶栏快捷键 ? 菜单 |
| [练习揭示播放连续性.md](./练习揭示播放连续性.md) | 软揭示 → 完整揭示**播放不中断**（共用 Session `playing` / `playWord`） |
| [练习键盘上一个.md](./练习键盘上一个.md) | **Shift+空格** 播放、**上一题** 与方向键 **↑←→↓** 重映射 |
| [练习入口导航.md](./练习入口导航.md) | 多入口（资源库列表/历史抽屉）、设置页词数、返回导航 |
| [单词错题与共享UI.md](./单词错题与共享UI.md) | **单词**错题集、练习入口组件 `EnglishPracticeEntry`、单词卡片统一 |
| [经典练习与错题.md](./经典练习与错题.md) | **经典句**练习、`contentKind=classic`、语句错题集、判分与 batch 更新错拼 |

| 说明 | 路径 |
|------|------|
| 听写 / 拼写 | `/english-learning/practice`；`contentKind=vocab`（默认）或 `classic`；设置页总量显示「词」/「句」 |
| 错题集（单词/语句） | `/english-learning/mistakes?kind=vocab\|classic`；顶栏 Tab + 底栏练习；`/mistakes/classic` 会 replace |

## UI / 目录约定

| 文档 | 说明 |
|------|------|
| [侧边栏UI统一.md](./侧边栏UI统一.md) | **首页侧栏 UI 统一**：卡片/按钮 token、`Header`/`Actions`、导入示例折叠、chip 网格 |
| [英语模块文件夹布局.md](./英语模块文件夹布局.md) | **模块目录**：`components/`、`reference/`、`favorites`/`pack`/`library`/`sections` 分域；顶栏单行截断 |

## TTS / UI / 其它专题

| 文档 | 说明 |
|------|------|
| [MiniMax云端TTS.md](./MiniMax云端TTS.md) | **MiniMax 流式 TTS** 完整实现（§11 逐函数注释代码 + 排查） |
| [云端TTS设置.md](./云端TTS设置.md) | **设置页云端朗读**：UI、请求合并、ScrollArea |
| [云端TTS MiniMax模型设置影响.md](./云端TTS MiniMax模型设置影响.md) | **增量**：MiniMax model 默认 turbo、白名单 2.8、Combobox、后端 `@IsIn` |
| [MiniMax中文语音.md](./MiniMax中文语音.md) | **增量**：云端 MiniMax 中文系统音色（64 项）与语言增强联动 |
| [云端TTS分段管线.md](./云端TTS分段管线.md) | **增量**：云端长文分段流水线（预取下一段、放弃 MSE） |
| [云端TTS节奏预取.md](./云端TTS节奏预取.md) | **深度**：句读分段 + 播段预取实现（`pendingReady` 时序与完整源码） |
| [语音设置页.md](./语音设置页.md) | **语音设置页**：本机 + 云端分区、菜单与文案 |
| [英语TTS本地语音.md](./英语TTS本地语音.md) | **本机 Web Speech 音色**、按账号分键 |
| [云端TTS偏好数据库.md](./云端TTS偏好数据库.md) | **偏好入库**：`minimax_tts_user_config`、API、跨设备同步 |
| [../auth/登录云端TTS预取401.md](../auth/登录云端TTS预取401.md) | **登录 401 误登出**（预拉取与 token 时序） |
| [TTS端到端指南.md](./TTS端到端指南.md) | **TTS 端到端全景**：非技术可读 + 前后端逐行注释代码 |
| [TTS会员路由.md](./TTS会员路由.md) | **按会员选路**：单词/语句/练习统一云端或本机 |
| [TTS播放源.md](./TTS播放源.md) | **会员本机/MiniMax/讯飞** 三选一与 `playbackSource` 入库 |
| [云端TTS边缘语音.md](./云端TTS边缘语音.md) | **Edge 云端朗读**、分模式 prosody、非会员本机+Edge 选路（前后端实现） |
| [TTS桌面端云端播放影响.md](./TTS桌面端云端播放影响.md) | **Tauri 云端 MP3 播放修复**：Audio prime、`canplay` 后 play、Edge 非流式 endpoint（**endpoint 分流已被 [EdgeTTS统一流式.md](./EdgeTTS统一流式.md) 取代**） |
| [EdgeTTS统一流式.md](./EdgeTTS统一流式.md) | **增量（本轮）**：Edge TTS 统一 `SPEECH_EDGE_TTS_STREAM`，取消 Tauri/Web endpoint 分流 |
| [讯飞云TTS.md](../ideas/tts/讯飞云TTS.md) | **讯飞在线云端朗读**：WS 合成、设置页音量/音高、Node 18 `ws` |
| [云端TTS用户凭据.md](./云端TTS用户凭据.md) | **用户凭证与失败降级**：MiniMax/讯飞 Key 入库、Toast、xfyunVoiceId 独立 |
| [英语TTS播放.md](./英语TTS播放.md) | 播放世代、异步丢弃 |
| [英语TTS停止清理.md](./英语TTS停止清理.md) | **增量**：`stopAllPlayback` 彻底释放音频元素与 MediaSession（修复 Touch Bar/控制中心残留进度条）、路由壳子页切换自动停播、经典句朗读统一 `cloudSingleUtterance` |
| [TTS本地取消结算影响.md](./TTS本地取消结算影响.md) | **增量**：本机 `cancel()` 后 50ms settle，修复首句无声（听当前/听书本机路径） |
| [英语TTS缓存一致性.md](./英语TTS缓存一致性.md) | 云端同句 MP3 LRU |
| [选中文本朗读菜单.md](./选中文本朗读菜单.md) | **增量（本轮）**：英语 Agent 消息正文「选中文本 → 右键 → 朗读/复制」；抽取通用 `useSelectionContextMenu` hook + `PositionedQuickMenu` 组件（供 `ChatAssistantMessage` / `Markdown` 预览 / EPUB 右键复用）；朗读复用听书同款按段云端 TTS，悬浮条支持拖动/倍速/软暂停（含改动前/后对比与逐行注释） |
| [TTS回调优化.md](./TTS回调优化.md) | **增量**：`onAwaitingPlayback` 语义修正——仅「尚未出声且在等当前段就绪」点亮，本机分段停顿/预取不点亮；`clearAwaitingAndNotifyStart` 重构消除时序错位；修复本机 Web Speech 多段朗读 loading 卡死（含改动前/后对比与逐行注释） |
| [英语Agent流式性能隔离.md](./英语Agent流式性能隔离.md) | **增量**：英语学习 Agent 流式渲染隔离——`useEnglishAgentSignals` 精细化订阅、`EnglishAgentMessageList` 独立 observer、`EnglishAgentScrollShell` 组件拆分 + Store 层 rAF Patch 调度 |
- 列表/UI：[英语学习列表网络重试.md](./英语学习列表网络重试.md)、[英语学习单词UI重构.md](./英语学习单词UI重构.md)
- 完整列表：`ls docs/english/*.md`

LLM 工厂与设置见 [../llm/README.md](../llm/README.md)。

上级：[../README.md](../README.md)
