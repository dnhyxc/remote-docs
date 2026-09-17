# MF 插件手册（原 `apps/frontend/src/plugins/docs`）

文档已从已删除的 `plugins/` 迁出。实现真源：

- 通用包：[`packages/federation-kit`](../../../packages/federation-kit)
- 本仓适配：[`apps/frontend/src/federation`](../../../apps/frontend/src/federation)

| 文档 | 说明 |
|------|------|
| [宿主插件集成指南.md](../宿主插件集成指南.md) | Host 接入（历史路径请对照 `federation-kit` + `src/federation`） |
| [插件开发指南.md](../插件开发指南.md) | 插件开发者 |
| [模块联邦实现指南.md](../模块联邦实现指南.md) | 实现细节（源码路径多处仍写旧 `plugins/`，以仓库现行路径为准） |
| [../插件宿主图标.md](../插件宿主图标.md) | **插件侧栏 / Host Surface 图标**：SVG URL → `PluginIcon` 内联、注册表上传写回、动画与选中色 |

规划：[`docs/ideas/联邦工具提取.md`](../../ideas/plugins/联邦工具提取.md)
