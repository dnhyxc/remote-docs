# 运营后台（Admin）专题文档

本目录记录 `dnhyxc-ai-admin` 运营后台的实现说明。后台与主站共用 **dnhyxc-ai 业务库**（MySQL 通过 `AI_DB_*` 配置连接），提供用户/角色/菜单、日志、知识库、学习笔记、分享记录等运营视角的查看与清理能力。

路径前缀：`apps/backend/src/services/`、`apps/frontend/src/views/`（均为 `dnhyxc-ai-admin` 仓库）。

---

## 索引

| 文档 | 说明 |
|------|------|
| [分享记录删除.md](./分享记录删除.md) | **分享列表「删除」**：`DELETE /ai-share/deleteShare/:shareId`、管理员可删任意分享 / 普通账号仅删自己创建的、按 `shareId` 硬删除整行；含 `AiSharesPage` 操作列与后端服务层改动前/后对比 |
| [笔记详情富文本预览.md](./笔记详情富文本预览.md) | **学习笔记详情接入 richtext-kit**：`NotePreview` 替代手写 `.admin-rich-text` 预览，长文（块数 ≥ 80）自动切换 `WindowedNotePreview` 窗口化渲染；主题变量桥接与 Vite 预打包 |
| [长内容横向溢出修复.md](./长内容横向溢出修复.md) | **后台长文/表格撑宽页面**：`AdminLayout` 逐层 `min-w-0`、Radix ScrollArea 内容层 `display:block`、Markdown 表格与代码块就地横滚、`.admin-md-preview` 宽度约束 |

---

## 排查速查

| 现象 | 优先阅读 |
|------|----------|
| 后台分享删不掉 / 提示「分享不存在」 | [分享记录删除.md](./分享记录删除.md)（`resolveScope` 与 `createdBy` 作用域、未绑定前台账号返回 404） |
| 笔记详情排版和前台编辑器不一致 / 超长笔记打开卡顿 | [笔记详情富文本预览.md](./笔记详情富文本预览.md)（`NotePreview` / `WindowedNotePreview` 分支与主题变量） |
| 后台页面出现横向滚动条 / 内容右侧被裁掉 | [长内容横向溢出修复.md](./长内容横向溢出修复.md)（ScrollArea 内容层 `display:table` 撑宽链路） |
