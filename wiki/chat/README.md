# 对话（Chat）专题文档

路径前缀：`apps/frontend/src/views/chat/`、`apps/backend/src/services/chat/`。总览见 [聊天机器人.md](./聊天机器人.md)。

---

## 索引

| 文档 | 说明 |
|------|------|
| [聊天机器人.md](./聊天机器人.md) | 对话架构、SSE、附件与 OCR、联网检索 |
| [对话上传预览.md](./对话上传预览.md) | **历史**本地上传附件 URL、Vite `/images`、CORP 排查 |
| [../cos/COS对象存储.md](../cos/COS对象存储.md) | **当前**聊天附件 COS 上传、`chat/` 前缀、展示与分享 |
| [对话上传生产访问.md](./对话上传生产访问.md) | **生产 Web 附件访问、`/api/upload/serve`、路径规范化、Nginx** |
| [../ops/上传存储路径.md](../ops/上传存储路径.md) | 后端 uploads 落盘、`UPLOAD_ROOT`、与 dist 同级 |
| [联网搜索.md](./联网搜索.md) | 联网搜索与引用 |
| [分享.md](./分享.md) | 会话分享（顺序、附件、排版） |
| [助手分享栏.md](./助手分享栏.md) | **增量**：助手分享底栏与 `useAssistantShare` 统一（知识库 / 英语 Agent / 电子书） |
| [分享知识时区.md](./分享知识时区.md) | **知识文章分享**「更新时间」MySQL 时区 ±8h 修复 |
| [对话更新.md](./对话更新.md) | Chat 重构与性能相关记录 |
| [对话内存溢出.md](./对话内存溢出.md) | **对话堆 OOM**：流式 Registry、附件缓存与解析上限、上下文 60 条 |
| [流式代码块滚动.md](./流式代码块滚动.md) | **流式代码块横滚**：拆段渲染、`StreamingCodeFenceBlock` 冻结 DOM |
| [助手选区朗读指南.md](./助手选区朗读指南.md) | **现行主文档**：助手选区「右键菜单 + 悬浮条 + 状态机」整条链路（F1–F14；英语 Agent / 电子书问书） |
| [选区朗读通用.md](./选区朗读通用.md) | **历史 / 重构对照**：`SelectionSpeak` 组件化与跨域复用过程；现行实现见 [助手选区朗读指南.md](./助手选区朗读指南.md) |
| [流式选区保持.md](./流式选区保持.md) | **流式选区保持**：`domTextSelection` 文本偏移快照/恢复、`StreamingCodeFenceBlock` 与 `StableMarkdownChunk` 选区保护、稳定 key 策略 |
| [选区朗读媒体会话.md](./选区朗读媒体会话.md) | **选区朗读 Media Session**：系统 Touch Bar / 控制中心 play·pause 接入选区朗读（`registerPlaybackMediaHandlers` + `pauseRef`/`resumeRef` 闭包新鲜度） |
| [消息操作朗读内容.md](./消息操作朗读内容.md) | **消息操作条朗读整条内容**：`ChatMessageActions` 新增 Volume2 按钮、`onSpeakContent` prop、`useAssistantSelectionSpeak.start` 暴露，英语 Agent / 电子书 MOKE 助手接入 |
| [消息发送按钮封装.md](./消息发送按钮封装.md) | **消息发送按钮抽取**：`MessageSendButton` 视觉底座 + `MessageSendControl` 三态状态机（停止 / 语音菜单 / 发送），ChatEntry / KnowledgeAssistantEntry 接入 |
| [会话标题重命名.md](./会话标题重命名.md) | **历史抽屉行内重命名**：`AssistantHistoryDrawer` 编辑态 + IME composition 安全；后端 `/assistant/session/title`、`/agent/session/title`；Skill 试跑已接入 |
