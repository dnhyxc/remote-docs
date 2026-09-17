# 运维与部署

路径前缀：`apps/backend/`（部署、静态资源、本地上传落盘）。

| 文档 | 说明 |
|------|------|
| [服务器部署.md](./服务器部署.md) | 部署总览 |
| [部署.md](./部署.md) | 部署步骤 |
| [Nginx配置.md](./Nginx配置.md) | Nginx：`/api`、`/images`、`/ext-cos/`、可选 `/mf-proxy/` 等 |
| [上传存储路径.md](./上传存储路径.md) | **本地上传** `uploads/`、`UPLOAD_ROOT`（聊天附件已迁 COS，见 [../cos/COS对象存储.md](../cos/COS对象存储.md)） |
| [远程注册静态.md](./远程注册静态.md) | **插件 registry**：`uploads/remotes`、`GET /remotes/`、Vite/Nginx 同源代理、Remote CORS（含 `tauri://localhost`） |
| [远程静态资源.md](./远程静态资源.md) | **后端 Remote 静态资源服务**：`upload-paths.ts` 新增 `REMOTES` 目录、`upload-public.controller.ts` 新增 `serveRemote`，含改动前/后对比与逐行注释 |
| [远程无存储缓存.md](./远程无存储缓存.md) | **remotes 禁止缓存**：`Cache-Control: no-store`，避免桌面/代理吃旧 registry |
| [../ideas/第三方联邦插件接入.md](../ideas/plugins/第三方联邦插件接入.md) | **第三方 MF 插件接入**：对方 CORS 契约、registry 上架、不加 capabilities、`/mf-proxy` 兜底 |
| [代理信任与限流.md](./代理信任与限流.md) | 生产 **trust proxy** + rate-limit 标准头（修复 X-Forwarded-For 报错） |
| [注册表写入超级管理员鉴权.md](./注册表写入超级管理员鉴权.md) | **插件 Registry 写接口仅超级管理员**：后端 JwtGuard + userHasSuperAdminRole 三层鉴权（401/403 语义分支）+ 前端 useIsSuperAdmin 隐藏「编辑配置」按钮 |

相关：[../chat/对话上传生产访问.md](../chat/对话上传生产访问.md)、[../plugins/插件中心卡片重构.md](../plugins/插件中心卡片重构.md)（同轮编辑按钮入口）

上级：[../README.md](../README.md)
