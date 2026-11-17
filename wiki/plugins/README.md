# 插件与微前端文档索引

本域记录 Module Federation 动态插件、Host / Remote 桥接、声明式扩展点、插件注册与发布等实现。业务页面如何挂载扩展点见对应功能域专题；规划态方案仍放在 `ideas/`，不与已落地实现混写。

## 当前主文档

| 文档 | 说明 |
|------|------|
| [声明式扩展点.md](./声明式扩展点.md) | **当前扩展点主文档**：四种角色编译成槽、`stacks` 叠放、槽位会话、`HostPoint`、`command.ts` 与页面绑定的命令，以及 `modules:point` |
| [统一point模块桥.md](./统一point模块桥.md) | **Remote 当前桥接契约**：统一 `PointModule` 五方法、页面上下文与槽位载荷、单词及电子书信号和命令，以及 `previewPoint` / `ebookPoint`；破坏性替换旧 `vocabDetail`、`vocabDetailImport`、`ebook` 专属模块。对应 `dnhyxc-ai-plugins` 未提交工作区：`point.ts`、三个单词插件、三个电子书插件、`routes.tsx`、`iframeHostClient.ts` |
| [../ui/下拉菜单键盘高亮.md](../ui/下拉菜单键盘高亮.md) | 插件仓 `DropdownMenuItem`：`data-[highlighted]` → `data-highlighted`，修好键盘高亮 |
| [阅读页扩展点.md](./阅读页扩展点.md) | **EPUB 阅读页当前接入**：`ebook.read` 由 `HostPoint` 画顶栏、图标和抽屉；`navigateToCfi`、`openThought` 绑在阅读页，`closeIdeasList` 在启动时绑定 |
| [单词详解插件接入.md](./单词详解插件接入.md) | 单词详解、详解列表、手动导入三个 Remote 的注册、预览、导航与发布；当前宿主 API 以 `api.modules.point` 为准 |
| [电子书宿主表面插件.md](./电子书宿主表面插件.md) | 阅读页早期 Host Surface 快照。现行挂载是 `HostPoint`，以阅读页扩展点为准 |
| [学习页扩展点.md](../english/学习页扩展点.md) | 英语学习各页的角色、上下文和抽屉。叠放在 `stacks`，词库列表由页面上的 `HostPoint` 画 |
| [详解抽屉瞬时让位.md](../english/详解抽屉瞬时让位.md) | 从列表或导入点开单词详解时，下层同一帧隐藏，详解不滑入。现行规则是 `stacks` |

## 接入与开发

| 文档 | 说明 |
|------|------|
| [插件开发指南.md](./插件开发指南.md) | Remote 环境、组件、样式、HostBridge、构建与发布。页面内嵌插件的现行接口是 `api.modules.point` |
| [宿主插件集成指南.md](./宿主插件集成指南.md) | 主站自动路由、手动挂载、Host Surface 与不可信 iframe 的接入方式 |
| [模块联邦实现指南.md](./模块联邦实现指南.md) | Module Federation 清单、运行时加载、共享依赖与插件描述符的整体实现 |
| [插件注册宿主API.md](./插件注册宿主API.md) | Registry 的 `hostApi` / `hostApiRange` 校验与兼容规则 |
| [动态插件系统.md](./动态插件系统.md) | 动态插件系统早期完整实现与演进基线 |
| [插件核心重构.md](./插件核心重构.md) | runtime、bridge、types、mf 等核心模块的分层职责 |
| [联邦工具迁移.md](./联邦工具迁移.md) | `@dnhyxc-ai/federation-kit` 与主站薄适配层的职责边界 |

## 运行时与跨框架

| 文档 | 说明 |
|------|------|
| [模块联邦插件宿主.md](./模块联邦插件宿主.md) | Remote 加载、错误边界与虚拟模块排查 |
| [模块联邦共享React路由.md](./模块联邦共享React路由.md) | React Router 共享约束与双 Router 问题 |
| [插件Vue桥接.md](./插件Vue桥接.md) | Vue Remote 的桥接、模块归一化与框架识别 |
| [远程插件HMR.md](./远程插件HMR.md) | Remote 开发态刷新与模块脚本加载问题 |
| [插件生命周期共置.md](./插件生命周期共置.md) | 生命周期钩子与 Fast Refresh 兼容 |
| [插件入口缓存失效.md](./插件入口缓存失效.md) | `version@manifestHash` 入口缓存破坏与桌面端更新 |
| [模块联邦清单去重.md](./模块联邦清单去重.md) | manifest 去重与 remoteEntry 直连优化 |

## 界面、主题与偏好

| 文档 | 说明 |
|------|------|
| [插件中心卡片重构.md](./插件中心卡片重构.md) | 插件中心分类、图标、信任级别与进入操作 |
| [插件书架切换.md](./插件书架切换.md) | 插件启用、停用与持久化 |
| [插件启用偏好持久化.md](./插件启用偏好持久化.md) | 按账号同步启用偏好，避免 Web 与桌面端状态不一致 |
| [插件图标系统.md](./插件图标系统.md) | SVG 内联；插件页面用 `api.ui.readIconSvg` 读取插件中心图标（第 0 节可照抄） |
| [插件宿主图标.md](./插件宿主图标.md) | Host 侧 SVG URL 加载与内联；插件消费见插件图标系统第 0 节 |
| [注册图标上传.md](./注册图标上传.md) | Registry 图标上传与写入 |
| [插件注册国际化.md](./插件注册国际化.md) | Registry 自带多语言文案 |
| [模块联邦插件语言同步.md](./模块联邦插件语言同步.md) | Host 向 Remote 推送界面语言 |
| [插件主题热推送.md](./插件主题热推送.md) | Host 向 Remote 推送明暗主题 |
| [插件iframe主题下发.md](./插件iframe主题下发.md) | 不可信 iframe 的主题、强调色、握手与焦点兼容 |
| [插件卡片边框主题.md](./插件卡片边框主题.md) | 插件中心卡片边框的主题隔离 |
| [插件影院全屏.md](./插件影院全屏.md) | 插件影院态全屏、侧栏让位与路由加载占位 |
| [插件宿主错误处理.md](./插件宿主错误处理.md) | 插件加载失败后的返回与开发指南入口 |

## 其他专项

| 文档 | 说明 |
|------|------|
| [插件选择本地文件.md](./插件选择本地文件.md) | 通过 federation-kit 桥接选择本地文件 |
| [动态切换ID修复.md](./动态切换ID修复.md) | 多实例 Switch 的 `htmlFor` / `id` 冲突修复 |
| [插件文档更新.md](./插件文档更新.md) | 插件开发文档的同步维护记录 |
| [微前端5分钟分享.md](./微前端5分钟分享.md) | 面向分享的微前端与可插拔架构概览 |

样式污染、Portal 认领和 Shadow DOM 等跨域问题同时参见 [style/样式隔离实现.md](../style/样式隔离实现.md) 与 [style/样式隔离领域门户.md](../style/样式隔离领域门户.md)；远程静态资源、跨域和缓存见 [ops/远程注册静态.md](../ops/远程注册静态.md) 与 [ops/远程无存储缓存.md](../ops/远程无存储缓存.md)。
