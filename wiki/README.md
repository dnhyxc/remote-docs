# 开发文档索引

本目录按**功能域**组织实现说明与排查文档。面向最终用户的产品说明见 [`项目指南.md`](./项目指南.md)、[`项目更新信息.md`](./项目更新信息.md)。

**约定**：以仓库**当前源码**为准。换 COS 桶时同步前后端 `.env`、Tauri allowlist 与 Nginx（见 [cos/COS对象存储.md](./cos/COS对象存储.md) §5、[cos/COS开发HTTP代理.md](./cos/COS开发HTTP代理.md)）。

---

## 功能域目录（简短命名）

| 目录                         | 说明                                    | 入口                                                                                                                                     |
| ---------------------------- | --------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| [`chat/`](./chat/)           | 主站对话、分享、联网、附件              | [chat/README.md](./chat/README.md)                                                                                                       |
| [`knowledge/`](./knowledge/) | 知识库、RAG、文档助手                   | [knowledge/README.md](./knowledge/README.md)                                                                                             |
| [`english/`](./english/)     | 英语学习（词包、收藏、TTS、Agent）      | [english/README.md](./english/README.md)                                                                                                 |
| [`cos/`](./cos/)             | 腾讯云 COS 上传与 `/ext-cos/` 展示      | [cos/README.md](./cos/README.md)                                                                                                         |
| [`llm/`](./llm/)             | 大模型接入（硅基、`createLlm`、设置页） | [llm/README.md](./llm/README.md)                                                                                                         |
| [`ops/`](./ops/)             | 部署、Nginx、本地上传目录               | [ops/README.md](./ops/README.md)                                                                                                         |
| [`app/`](./app/)             | 前端壳层（构建、网络、文件选择）        | [app/README.md](./app/README.md)                                                                                                         |
| [`plugins/`](./plugins/)    | 插件/微前端系统（MF、插件开发）        | [plugins/模块联邦实现指南.md](./plugins/模块联邦实现指南.md)                                                               |
| [`tauri/`](./tauri/)         | Tauri 桌面特性（窗口、菜单、全屏）      | [tauri/Tauri窗口缩放揭示.md](./tauri/Tauri窗口缩放揭示.md)                                                                 |
| [`auth/`](./auth/)           | 认证登录（路由守卫、SecretInput）      | [auth/路由认证.md](./auth/路由认证.md)                                                                                               |
| [`style/`](./style/)         | 样式隔离（@scope、Portal、qiankun）    | [style/样式隔离实现.md](./style/样式隔离实现.md)                                                     |
| [`video/`](./video/)         | 视频播放器（组件化、影院态、画中画）    | [video/视频播放器插件.md](./video/视频播放器插件.md)                                                                           |
| [`i18n/`](./i18n/)           | 国际化（中英文界面）                    | [i18n/中英双语实现指南.md](./i18n/中英双语实现指南.md)                                                       |
| [`ui/`](./ui/)               | 通用 UI/UX（组件、交互、编辑器）        | [ui/UI色调打磨.md](./ui/UI色调打磨.md)                                                                                           |
| [`monaco/`](./monaco/)       | Monaco / Markdown 编辑器                | [monaco/README.md](./monaco/README.md)                                                                                                    |
| [`mermaid/`](./mermaid/)     | Mermaid 围栏与预览                      | [mermaid/Markdown缩放与预览.md](./mermaid/Markdown缩放与预览.md)                                                           |
| [`tools/`](./tools/)         | `@dnhyxc-ai/markdown-kit`               | [tools/索引.md](./tools/索引.md)                                                                                                       |
| [`react/`](./react/)         | React Hooks 专题                        | 按文件名检索                                                                                                                             |
| [`setting/`](./setting/)     | 设置页（系统快捷键、主题色等）          | [setting/README.md](./setting/README.md)                                                                                                 |
| [`meta/`](./meta/)           | 发布与更新同步                          | [meta/项目功能更新.md](./meta/项目功能更新.md)                                                                     |
| [`pay/`](./pay/)             | Stripe 会员充值、开通与到期             | [pay/Stripe会员计费.md](./pay/Stripe会员计费.md)、[pay/会员激活钩子.md](./pay/会员激活钩子.md) |
| [`ebook/`](./ebook/)         | 电子书书架、EPUB/PDF 阅读与进度         | [ebook/README.md](./ebook/README.md)                                                                                                     |
| [`ideas/`](./ideas/)         | **规划态**功能实现思路（架构/流程图）   | [ideas/README.md](./ideas/README.md)                                                                                                     |
| [`agent/`](./agent/)         | Agent 通用调用与业务消息分表            | [agent/README.md](./agent/README.md)                                                                                                     |
| [`impact/`](./impact/)       | 跨功能改动影响面分析                    | [impact/README.md](./impact/README.md)                                                                                                   |
| [`guide/`](../guide/)         | **开发者上手手册**（按功能域端到端教程） | [guide/README.md](../guide/README.md)                                                                                                     |

---

## 常见排查

| 现象                                                              | 优先阅读                                                                                                                                                 |
| ----------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| COS 上传 AccessDenied                                             | [cos/COS对象存储.md](./cos/COS对象存储.md) §3.4、§6                                                                                        |
| COS 能传不能显（403 / ATS）                                       | [cos/COS对象存储.md](./cos/COS对象存储.md) §3.3 + [cos/COS开发HTTP代理.md](./cos/COS开发HTTP代理.md)                                 |
| COS 能预览但下载失败                                              | [cos/COS对象存储.md](./cos/COS对象存储.md) §3.7                                                                                            |
| 分享页无用户附件                                                  | [chat/分享.md](./chat/分享.md) §五 + [cos/COS对象存储.md](./cos/COS对象存储.md) §3.9                                                     |
| 知识分享「更新时间」差 8h（如凌晨变 18 点）                       | [chat/分享知识时区.md](./chat/分享知识时区.md)                                                                                   |
| Web HTTPS mixed content                                           | 同上 + [auth/路由认证.md](./auth/路由认证.md) §12 + [ops/Nginx配置.md](./ops/Nginx配置.md)                                                                     |
| Tauri macOS ATS                                                   | [tauri/Tauri macOS ATS 通信.md](./tauri/Tauri macOS ATS 通信.md)                                                                                             |
| 知识库助手 Mermaid 流式                                           | [knowledge/知识库助手Mermaid流式.md](./knowledge/知识库助手Mermaid流式.md)                                               |
| 知识库助手总览                                                    | [knowledge/知识库助手完成.md](./knowledge/知识库助手完成.md)                                                                 |
| 对话硅基接入                                                      | [llm/硅基对话统一.md](./llm/硅基对话统一.md)                                                                             |
| 聊天附件预览失败                                                  | [chat/对话上传预览.md](./chat/对话上传预览.md)                                                                                             |
| 助手消息选区朗读 / 右键菜单无反应 / 与听书同时出声                | [chat/助手选区朗读指南.md](./chat/助手选区朗读指南.md) |
| Skill 页开合库打断朗读 / 试跑与生成消息串台 / 切会话不停播        | [knowledge/Skill侧栏朗读与会话切换.md](./knowledge/Skill侧栏朗读与会话切换.md) |
| 助手拖选移出窗口后整页上移 / 底边黑缝 / 上下留白不一致              | [ui/选区拖拽壳层滚动指南.md](./ui/选区拖拽壳层滚动指南.md)                                                                     |
| 选区朗读控制条无法拖动缩放 / 高亮漂移 / 中英混排朗读不准          | [chat/助手选区朗读指南.md](./chat/助手选区朗读指南.md) · [chat/选区朗读通用.md](./chat/选区朗读通用.md)（历史对照） · [ebook/TTS音频进度同步.md](./ebook/TTS音频进度同步.md)         |
| 流式对话中选区文字丢失 / 拖选后选区自动消失 | [chat/流式选区保持.md](./chat/流式选区保持.md) |
| 选区朗读无法用系统媒体键（Touch Bar/控制中心）控制 | [chat/选区朗读媒体会话.md](./chat/选区朗读媒体会话.md) |
| 听书/朗读 loading 时 Touch Bar 仍可点 / 连点导致条状态错乱 | [ebook/EPUB听书触控栏加载.md](./ebook/EPUB听书触控栏加载.md) |
| 电子书听书与选区朗读同时出声 / 互斥异常                           | [ebook/听书互斥控制.md](./ebook/听书互斥控制.md)                                                                             |
| 生产 `/images/` 400                                               | [chat/对话上传生产访问.md](./chat/对话上传生产访问.md) + [ops/Nginx配置.md](./ops/Nginx配置.md)                                                    |
| 本地上传落盘 / UPLOAD_ROOT                                        | [ops/上传存储路径.md](./ops/上传存储路径.md)                                                                                             |
| 插件 registry 跨域 / Vite proxy 不生效 / `/remotes` 404             | [ops/远程注册静态.md](./ops/远程注册静态.md)                                                                                       |
| Remote `mf-manifest.json` CORS（9002 / `tauri://localhost`）        | [ops/远程注册静态.md](./ops/远程注册静态.md) §7 + [ideas/第三方联邦插件接入.md](./ideas/plugins/第三方联邦插件接入.md) |
| 第三方任意域名插件怎么接 / 加插件不发桌面版                         | [ideas/第三方联邦插件接入.md](./ideas/plugins/第三方联邦插件接入.md)（§14 接入者 / §15 基座）                                          |
| 桌面插件 RUNTIME-003 / Origin tauri://localhost                     | 对方 CORS 漏配；见上 + [apps/remote-plugins/README.md](./plugins/插件开发指南.md)                                                   |
| 插件样式污染主站 / 子应用 Button 无样式                             | [style/样式隔离实现.md](./style/样式隔离实现.md)（实现手册）、[style/样式隔离模块化.md](./style/样式隔离模块化.md)（模块化与 PluginHostPage 接入）、[ideas/模块联邦CSS隔离.md](./ideas/plugins/模块联邦CSS隔离.md)（思路）                                                                                                 |
| 同一 Remote 多插件切换后样式丢失 / Drawer Portal 组件无样式 / sonner Toaster 顶开布局 | [style/样式隔离领域门户.md](./style/样式隔离领域门户.md)（Realm 键 + createPortal 收编 + sonner 保护 + HMR 重包） |
| Vue Teleport / CSS-in-JS 样式泄漏 / `@font-face` 失效 / keyframes 撞名 | [style/样式隔离乾坤加固.md](./style/样式隔离乾坤加固.md)（transpile / CSSOM / body Portal / captureStack） |
| 样式隔离源码是怎么分 `protocol / css / sandbox / portal` 四层的 / Host 主题 token 剥离 | [style/样式隔离分层重构.md](./style/样式隔离分层重构.md)（巨石拆分 + `themeStrip` 新增职责 + barrel / smoke 迁位） |
| 插件 Core 模块怎么分层 / runtime / bridge / types / mf 各自职责 | [plugins/插件核心重构.md](./plugins/插件核心重构.md)（扁平单文件 → 分层目录 + barrel 对外接口稳定） |
| Vue Remote 加载报错 / React 插件中混跑 Vue 组件 / framework 识别失败 | [plugins/插件Vue桥接.md](./plugins/插件Vue桥接.md)（createVueHostBridge / normalizePluginModule / registry framework） |
| 动态插件加载失败闪烁 / virtual:mf 解析失败                          | [plugins/模块联邦插件宿主.md](./plugins/模块联邦插件宿主.md)                                                                                                         |
| 桌面发新版插件仍是旧版 / remoteEntry 被缓存                         | [plugins/插件入口缓存失效.md](./plugins/插件入口缓存失效.md)（`version@manifestHash`）+ [ops/远程无存储缓存.md](./ops/远程无存储缓存.md) |
| 线上 `/plugins` `useLocation` 无 Router context                     | [plugins/模块联邦共享React路由.md](./plugins/模块联邦共享React路由.md)                                                                                          |
| 保存 registry 报 hostApi 不兼容 / 误改 hostApiRange                   | [plugins/插件注册宿主API.md](./plugins/插件注册宿主API.md)                                                                                        |
| 改 remote-plugins 内容页面刷两次 / Importing a module script failed | [plugins/远程插件HMR.md](./plugins/远程插件HMR.md)                                                                                                    |
| 插件生命周期钩子同文件挂载 + Fast Refresh 兼容（App.activate / default 静态属性） | [app/插件生命周期共置.md](./plugins/插件生命周期共置.md)                                                                               |
| MF 插件语言同步（Host → Remote locale 推送 / i18n 完整接入）         | [plugins/模块联邦插件语言同步.md](./plugins/模块联邦插件语言同步.md)                                                                                            |
| MF 插件主题热推送（Host → Remote theme light/dark 推送，与 locale 对称） | [plugins/插件主题热推送.md](./plugins/插件主题热推送.md)（withLiveTheme + eventBus.emit("theme")） |
| MF 动态插件系统完整实现（Vite / PluginManager / 路由注入）          | [plugins/动态插件系统.md](./plugins/动态插件系统.md)（含改动前/后对比与逐行注释）                                                              |
| 插件开发手册（环境 / 组件 / 样式 / HostBridge / 发布）              | [plugins/插件开发指南.md](./plugins/插件开发指南.md)                                                                                      |
| 主项目接入插件方式（自动路由 / 手动挂载 / iframe 隔离）             | [plugins/宿主插件集成指南.md](./plugins/宿主插件集成指南.md)                                                                            |
| 插件图标 SVG URL 动态加载与内联（侧栏 / Host Surface）              | [plugins/插件宿主图标.md](./plugins/插件宿主图标.md)                                                                                                    |
| 插件上架/下架（setEnabled / 持久化 / Switch / Registry 编辑页）     | [plugins/插件书架切换.md](./plugins/插件书架切换.md)                                                                                                |
| 插件开关偏好换号不同步 / Web 与桌面不一致 / 默认全关 / 偏好写回 catalog 污染全局 | [plugins/插件启用偏好持久化.md](./plugins/插件启用偏好持久化.md)                                                                       |
| 同页多个 Switch 点 Label 文字总是只切第一个 / 多插件卡片 htmlFor 关联错误 | [plugins/动态切换ID修复.md](./plugins/动态切换ID修复.md)                                                                                            |
| 插件中心卡片白边 / 远程插件污染 border-border                       | [plugins/插件卡片边框主题.md](./plugins/插件卡片边框主题.md)                                                                                      |
| untrusted iframe 主题/强调色不同步 / outline 按钮边框消失 / Strict Mode 握手重复 / 路由切换白屏 / Tab 序被夺 | [plugins/插件iframe主题下发.md](./plugins/插件iframe主题下发.md)（HostIframeAppearance 快照 + 指纹去重 + about:blank 卸载 + 焦点陷阱兼容） |
| 插件中心不分插件/应用 / 卡片无图标无入口 / 信任级别硬编码             | [plugins/插件中心卡片重构.md](./plugins/插件中心卡片重构.md)（catalogKind 推断 + Tab 计数 + 图标兜底 + CardFooter 进入按钮）                |
| 视频播放器插件 / 影院态全屏（藏侧栏 + Tauri 窗口/Web document 全屏） | [video/视频播放器插件.md](./video/视频播放器插件.md)、[plugins/插件影院全屏.md](./plugins/插件影院全屏.md)                                                                                   |
| 视频播放器想在其它业务复用 / 上传 / 播放 / tooltip 全部解耦      | [video/视频播放器组件重构.md](./video/视频播放器组件重构.md)（组件化拆分 + `TooltipProvider` + 主题色 token）                                                                 |
| 视频播放器进度条 hover 无缩略图 / 画中画 Safari 不可用 / 长视频刻度卡 | [video/视频播放器功能增强.md](./video/视频播放器功能增强.md)（缩略图预览 + 多平台画中画 + 刻度上限）                                                                 |
| 视频播放器拖拽松手右抖 / 循环单条不重播 / 控制条毛玻璃慢一拍 / xgplayer 背景不跟随主题 | [video/视频播放器拖拽进度.md](./video/视频播放器拖拽进度.md)（拖拽重写 + scrubHoldUntil 抑制 + 画布固定 160×90 + visible 显隐） |
| 微前端插件目录 `plugins/` 被整包抽走、业务 import 全失效           | [plugins/联邦工具迁移.md](./plugins/联邦工具迁移.md)（`@dnhyxc-ai/federation-kit` + `src/federation` 薄适配 + `PluginHostSurface` 通用模版 + `mf.start()` 迁移） |
| sonner Toast 点击失效 / 关闭按钮按不动                             | [style/Sonner指针事件修复.md](./style/Sonner指针事件修复.md)（Toast 根 + `<Sonner>` className + style 三处 `pointer-events: auto` 加固） |
| 富文本编辑器标题与正文分离 / Tab 缩进失效 / Cmd+↑↓ 无响应 / 空段落删不掉 | [ui/富文本编辑器特性.md](./ui/富文本编辑器特性.md)（TitleNode + TabIndent + DocEdgeNav + EmptyParagraphDelete 自定义扩展） |
| 学习笔记列表不分页 / 无法导出 DOCX / 公开状态切换失败 / 保存无 Toast | [app/学习笔记实现.md](./app/学习笔记实现.md)（MobX Store + HostHttp 注入 + 累积分页 + 双端 downloadBlob） |
| `/account`、`/pay` 迁移到 `/profile/*` 路由壳 / 旧路径重定向       | [app/个人主页路由重构.md](./app/个人主页路由重构.md)（`ProfileLayout` + `Outlet` + `Navigate` 重定向） |
| 更新信息 / 产品指南 / 插件开发手册打开为独立站（非 SPA 内页）           | [app/独立文档站迁移.md](./app/独立文档站迁移.md)（`remote-docs-url.ts` + `openExternalUrl`，三路由移出主站） |
| 视频播放器影院态全屏下控制条看不见（黑底白字）                     | [video/视频播放器Chrome影院主题.md](./video/视频播放器Chrome影院主题.md)（`chromeFg` / `chromeFgMuted` 派生语义色） |
| 刷新插件路由（如 /video-player）先闪 404 再出插件页                  | [plugins/插件影院全屏.md](./plugins/插件影院全屏.md)（`pluginsReady` + `PluginRoutesPending` 占位）                                         |
| 插件全屏后 Host 侧栏仍在 / Esc 后壳卡住                              | [plugins/插件影院全屏.md](./plugins/插件影院全屏.md)（`api.ui.setAppFullscreen` + Layout `fullscreenchange` 兜底）                           |
| macOS 绿钮/菜单退出全屏时侧栏晚一步消失 / 缩窗动画与影院态不同步     | [tauri/Tauri全屏同步.md](./tauri/Tauri全屏同步.md)（`fullscreen_watch.rs` + `NSWindowWillExitFullScreenNotification` + `host://will-exit-fullscreen` + `flushSync` + `ignoreNativeUntil` 防抖） |
| 桌面端 WebView 右键仍弹系统菜单 / 想禁用右键菜单                    | [app/Tauri WebView右键菜单禁用.md](./tauri/Tauri WebView右键菜单禁用.md)                                                                  |
| macOS 双击标题栏放大窗口露白 / 壳先大页后跟 / 缩放不同步           | [tauri/Tauri窗口缩放揭示.md](./tauri/Tauri窗口缩放揭示.md)（实现：swizzle zoom: + 目标尺寸预布局 + 揭开动画）· [ideas/Tauri窗口缩放揭示.md](./ideas/tauri/Tauri窗口缩放揭示.md)（规划思路） |
| 系统菜单加速键改键后不更新 / 全局热键抢占系统 / 页面快捷键冲突     | [tauri/Tauri系统菜单快捷键.md](./tauri/Tauri系统菜单快捷键.md)（实现：store 单一真相源 + IconMenuItem set_accelerator + 失焦反注册 + 写法归一化冲突检测）· [ideas/Tauri系统菜单快捷键.md](./ideas/tauri/Tauri系统菜单快捷键.md)（规划思路） |
| 关于子窗加载慢 / 关于窗口主题与主窗不一致                          | [tauri/关于窗口轻量化.md](./tauri/关于窗口轻量化.md)（main.tsx 按 pathname 分流 + about.tsx 极简入口 + readWindowChromeThemeSync 同步读主题） |
| 菜单/侧边栏登出不一致 / 多窗口主题不同步 / 401 后状态残留          | [auth/登出统一主题同步.md](./auth/登出统一主题同步.md)（performLogout 集中清态 + 动态 import 规避循环依赖 + setThemeToAllWindows 广播） |
| 电子书阅读页插件化接入（PluginHostPage / ebookHostApi）             | [ebook/电子书插件想法列表.md](./ebook/电子书插件想法列表.md)                                                                                    |
| 后端 Remote 静态资源服务（serveRemote / uploads/remotes）           | [ops/远程静态资源.md](./ops/远程静态资源.md)                                                                                        |
| remotes registry 仍被缓存 / 桌面吃旧清单                            | [ops/远程无存储缓存.md](./ops/远程无存储缓存.md)                                                                                           |
| 资源库词条刷新 / 重开应用后回到首屏（续读丢失）                      | [english/资源库词条续读.md](./english/资源库词条续读.md)（跨会话持久化 + 双向分页 + keepalive flush）· [english/文库单词列表缓存.md](./english/文库单词列表缓存.md)（会话内缓存，姊妹稿） |
| 想关闭 / 一键清除某个侧栏模块的续读（收藏/错题/记词记录/单词库/语句库） | [english/续读模块开关.md](./english/续读模块开关.md)（服务端持久化模块开关 + 侧栏齿轮菜单 + 列表 Hook 订阅 revision 自动重载） |
| 英语学习「学习笔记」空白或 CORS                                     | [english/学习笔记远程.md](./english/学习笔记远程.md)                                                                                    |
| 学习笔记富文本编辑器（Tiptap 升级 / HTML 存储）                     | [english/学习笔记富文本编辑.md](./english/学习笔记富文本编辑.md)                                                                          |
| 学习笔记未保存橙点 / 保存图标脏标记                                 | [english/学习笔记脏保存.md](./english/学习笔记脏保存.md)                                                                            |
| 学习笔记导出 Word / 长文性能优化（TitleNode / opt-in 扩展 / 乐观预览） | [english/学习笔记导出性能.md](./english/学习笔记导出性能.md)                                                                          |
| 学习笔记编辑/预览卡顿（长文窗口化 / 列表隔离）                       | [ideas/学习笔记编辑器预览卡顿.md](./ideas/notes/学习笔记编辑器预览卡顿.md)                                                              |
| 学习笔记 DOCX 插图导出 + 长文编辑打磨（sharp / 落点 / 空段）         | [ideas/学习笔记导出与编辑打磨.md](./ideas/notes/学习笔记导出与编辑打磨.md)                                                    |
| 学习笔记 Cmd+↑ 跳到文末 / 缺少首尾导航快捷键                        | [english/富文本编辑器边缘导航.md](./english/富文本编辑器边缘导航.md)                                                                              |
| 学习笔记保存失败后光标不在标题 / 标题为空保存无引导                 | [english/学习笔记保存聚焦标题.md](./english/学习笔记保存聚焦标题.md)                                                                |
| Tauri 桌面端 TipTap 复制粘贴失效                                    | [english/Tauri剪贴板富文本.md](./english/Tauri剪贴板富文本.md)（早期纯文本版）· [ideas/Tauri剪贴板富文本粘贴.md](./ideas/tauri/Tauri剪贴板富文本粘贴.md)（完整图文方案：HTML/截图/多图）· [english/Tauri剪贴板图片文件.md](./english/Tauri剪贴板图片文件.md)（位图/文件列表多图读取专题） |
| 学习笔记列表分页 / 滚动加载更多                                     | [english/学习笔记MobX存储.md](./english/学习笔记MobX存储.md)                                                                            |
| 学习笔记列表看不到他人公开笔记 / 想切换公开状态 / 列表网格徽章与刷新按钮 | [english/学习笔记公开列表.md](./english/学习笔记公开列表.md)                                                                        |
| `createLlm` / 400                                                 | [llm/创建LLM.md](./llm/创建LLM.md)                                                                                                                 |
| 图片 OCR / 附件识图                                               | [llm/OCR创建LLM GLM.md](./llm/OCR创建LLM GLM.md)                                                                                                 |
| 知识库向量 404 / 400 入库失败                                     | [knowledge/硅基向量完整URL.md](./knowledge/硅基向量完整URL.md)                                                                   |
| 知识库向量 Key/模型                                               | [knowledge/知识向量创建LLM.md](./knowledge/知识向量创建LLM.md)                                                                   |
| 会员知识库向量双库                                                | [knowledge/知识会员向量分层.md](./knowledge/知识会员向量分层.md)                                                                 |
| 用户自定义向量与多库 RAG                                          | [knowledge/用户向量RAG配置.md](./knowledge/用户向量RAG配置.md)                                                                             |
| 全站 BGE / 入库 Bad Request                                       | [knowledge/向量BGE全局轮次.md](./knowledge/向量BGE全局轮次.md)                                                                           |
| 向量分片 ole.log / 代码截断                                       | [knowledge/知识分块边界.md](./knowledge/知识分块边界.md)                                                                     |
| 保存知识库后 `Invalid array length` / Node OOM                    | [knowledge/知识分块死循环内存溢出.md](./knowledge/知识分块死循环内存溢出.md)                                                       |
| 云端保存知识库报「请求体过大」/ PayloadTooLarge                   | [knowledge/知识保存正文限制.md](./knowledge/知识保存正文限制.md)                                                                       |
| 知识库长文编辑卡顿（标题/正文/助手输入）                          | [knowledge/知识编辑器长文本性能.md](./knowledge/知识编辑器长文本性能.md)                                                             |
| 预览+助手同开卡顿（流式输入/滚动/打字机）                         | [knowledge/知识预览助手性能.md](./knowledge/知识预览助手性能.md) · [knowledge/知识预览滚动卡顿.md](./knowledge/知识预览滚动卡顿.md) |
| 长预览滚动卡顿 / 预览+助手双侧滚动卡顿                            | [knowledge/知识预览滚动卡顿.md](./knowledge/知识预览滚动卡顿.md) · [ideas/知识库滚动卡顿修复.md](./ideas/knowledge/知识库滚动卡顿修复.md) |
| 知识库 Skill（AI→Agent，须兼容现网能力）（规划） | [ideas/知识库Skill编辑与Agent接入.md](./ideas/knowledge/知识库Skill编辑与Agent接入.md) |
| Skill 生成按编辑器锚定（规划→实现中） | [ideas/knowledge/Skill生成工件锚定.md](./ideas/knowledge/Skill生成工件锚定.md) |
| Skill 侧栏朗读与会话切换（mode 分桶 / remount 不停播） | [knowledge/Skill侧栏朗读与会话切换.md](./knowledge/Skill侧栏朗读与会话切换.md) |
| 知识库 Skill 对话接入（`/` 选择、Agent SSE、memorySource） | [knowledge/知识库Skill对话.md](./knowledge/知识库Skill对话.md) |
| 已应用 Skill 落库（刷新后 tip 仍在） | [knowledge/已应用Skill落库.md](./knowledge/已应用Skill落库.md) |
| Skill 编辑与试跑（独立 `/skills` 页、`memorySource=skill_try`） | [knowledge/Skill编辑试跑.md](./knowledge/Skill编辑试跑.md) |
| Agent 通用调用 + 业务消息分表（M0–M4 已落地） | [agent/Agent记忆分表.md](./agent/Agent记忆分表.md) · [agent/Agent业务消息分表落地.md](./agent/Agent业务消息分表落地.md) · [agent/业务记忆文件归位.md](./agent/业务记忆文件归位.md) · [ideas/agent/Agent业务消息分表.md](./ideas/agent/Agent业务消息分表.md) |
| 长文多代码块预览持续滚动卡顿（吸顶栏热路径）                      | [knowledge/知识预览代码工具条滚动.md](./knowledge/知识预览代码工具条滚动.md) · [impact/知识预览代码工具条滚动.md](./impact/知识预览代码工具条滚动.md) |
| 本地知识库文件夹目录树浏览（可展开层级/键盘可达）                 | [knowledge/知识库文件夹树.md](./knowledge/知识库文件夹树.md)                                                                               |
| 知识库列表与回收站：按文档标题搜索（Enter 提交、不区分大小写）    | [knowledge/知识库列表搜索标题.md](./knowledge/知识库列表搜索标题.md)                                                                     |
| 知识库自定义分类（新建/重命名/删除/排序/归档/Tab 筛选/默认分类播种） | [knowledge/知识库分类管理.md](./knowledge/知识库分类管理.md)                                                                                     |
| 知识库/电子书列表公开优先排序 + 电子书非本人书不可改分类           | [knowledge/公开优先排序.md](./knowledge/公开优先排序.md)                                                                                       |
| 对话运行久后 Node OOM / 附件重复解析                              | [chat/对话内存溢出.md](./chat/对话内存溢出.md)                                                                                                     |
| 流式输出时代码块无法横向滚动                                      | [chat/流式代码块滚动.md](./chat/流式代码块滚动.md)                                                                             |
| 对话/知识库发送钮重复实现 / 语音菜单状态机散落 ChatEntry           | [chat/消息发送按钮封装.md](./chat/消息发送按钮封装.md)（`MessageSendButton` 视觉底座 + `MessageSendControl` 三态状态机抽取） |
| 生产 rate-limit `ERR_ERL_UNEXPECTED_X_FORWARDED_FOR`              | [ops/代理信任与限流.md](./ops/代理信任与限流.md)                                                                                         |
| 插件 registry 保存接口 403「需要超级管理员权限」/ 非管理员能改插件清单 | [ops/注册表写入超级管理员鉴权.md](./ops/注册表写入超级管理员鉴权.md)（后端三层鉴权 + 前端编辑按钮显隐） |
| 浅色主题下 Sheet 抽屉无边界 / 卡片弹窗描边全透明 / 正文白字白底不可读 | [ui/Sheet描边与主题墨色修正.md](./ui/Sheet描边与主题墨色修正.md)（浅色 `--theme-color` 墨色基线纠正 + Sheet 四方向 `border-theme/10`） |
| 独立页 / 外链打开时强调色不跟随主站 | [ui/强调色外链同步.md](./ui/强调色外链同步.md)（URL `?accent=` 解析 + `appendShareAccentQuery` 分享链接 + 首屏内联脚本优先） |
| Markdown 外链在当前页打开顶掉应用 / 桌面要进系统浏览器 | [tools/外链新标签打开.md](./tools/外链新标签打开.md)（kit 补 `target="_blank"` + Host/remote-docs 点击拦截分工，见 §5） |
| 代码块与 Mermaid 围栏视觉不统一 / hljs 实色底覆盖外壳 | [mermaid/围栏视觉统一.md](./mermaid/围栏视觉统一.md)（`bg-theme/8` 统一 + hljs 透明 + `.chat-md-mermaid-block` 外壳） |
| 非可显示 SecretInput 密码框明文泄露 | [ui/SecretInput显示修正.md](./ui/SecretInput显示修正.md)（`inputType` 三元逻辑反转，`revealable=false` 时默认 `password`） |
| 桌面下载页硬编码 teal 光晕 / Hero 标题不跟随强调色 | [ui/桌面下载页视觉重构.md](./ui/桌面下载页视觉重构.md)（`color-mix(in oklch, var(--brand-accent))` 光晕 + 渐变标题 + 单卡片布局） |
| 复制到助手后输入框不聚焦                                          | [knowledge/助手插入焦点.md](./knowledge/助手插入焦点.md)                                                                             |
| 设置页大模型 Key                                                  | [llm/LLM运行时设置.md](./llm/LLM运行时设置.md)                                                                                             |
| 按用户 / 会员默认模型                                             | [llm/会员单用户LLM.md](./llm/会员单用户LLM.md)                                                                                       |
| 设置页预设 / Combobox                                             | [llm/LLM设置UI预设.md](./llm/LLM设置UI预设.md)                                                                                         |
| 英语学习 Agent + LLM                                              | [llm/Agent创建LLM统一.md](./llm/Agent创建LLM统一.md)                                                                                         |
| 今日记词无词可抽 / 时间不对                                       | [english/每日记词实现.md](./english/每日记词实现.md) §9                                                                |
| 云端朗读 404 / MiniMax 502 余额不足                               | [english/MiniMax云端TTS.md](./english/MiniMax云端TTS.md) §12                                                                                       |
| 讯飞云端 WebSocket is not defined / File is not defined（Node 18） | [english/讯飞云TTS.md](./english/讯飞云TTS.md) §3.3、§5                                                                                    |
| 设置页云端朗读参数不生效 / 改音色仍播旧音                         | [english/云端TTS设置.md](./english/云端TTS设置.md) §5–§6                                                                                   |
| 语言增强中文但音色列表仍是英文                                    | [english/MiniMax中文语音.md](./english/MiniMax中文语音.md)                                                                                 |
| 换设备后云端朗读参数丢失 / 需账号同步                             | [english/云端TTS偏好数据库.md](./english/云端TTS偏好数据库.md)                                                                                         |
| 长文云端朗读首声慢 / 播放中无声卡住                         | [english/云端TTS分段管线.md](./english/云端TTS分段管线.md) §3、§6；分段预取细节 [云端TTS节奏预取.md](./english/云端TTS节奏预取.md) |
| Tauri 桌面云端「播放中无声、暂停再播恢复」                    | [english/TTS桌面端云端播放影响.md](./english/TTS桌面端云端播放影响.md)                                                                             |
| Edge 云端不可用 / 非会员选路 / 分模式语速被覆盖               | [english/云端TTS边缘语音.md](./english/云端TTS边缘语音.md) §5                                                                                  |
| TTS 从点喇叭到出声（前后端全链路）                                | [english/TTS端到端指南.md](./english/TTS端到端指南.md)                                                                                     |
| 支付成功但资料页仍非会员 / 到期仍显示会员                         | [pay/Stripe会员计费.md](./pay/Stripe会员计费.md) §6–§7                                                                             |
| 支付页在 ProfileLayout 下溢出 / header 冗余 / 文案臃肿            | [pay/支付页布局重构.md](./pay/支付页布局重构.md)（ScrollArea 包裹 + 移除 header + 文案精简 + 测试账号拦截） |
| 换号后仍看到上一账号的草稿或助手对话                              | [auth/用户切换状态重置.md](./auth/用户切换状态重置.md)                                                                                       |
| 演示账号预填 + 测试账号保护（禁止改资料 / 购会员 / 忘记密码）   | [auth/测试账号预填与保护.md](./auth/测试账号预填与保护.md)（掩码密码 + `superRefine` 条件校验 + `sessionStorage` 跨页保持 + 6 页拦截） |
| 登录成功瞬间又回到登录页 / cloud-tts 401                          | [auth/登录云端TTS预取401.md](./auth/登录云端TTS预取401.md)                                                                             |
| Tauri 桌面频繁 Toast「网络异常，请检查网络后重试」                | [tauri/Tauri HTTP全方法重试.md](./tauri/Tauri HTTP全方法重试.md)                                                                              |
| 小程序 EPUB 章节 409 / Processor 无日志 / **已解析换章仍 ~1s** | [ebook/小程序EPUB服务端解析.md](./ebook/小程序EPUB服务端解析.md) §3.1、§4.7、[ideas/小程序EPUB解析逻辑.md](./ideas/miniprogram/小程序EPUB解析逻辑.md) |
| 强制刷新后 EPUB/PDF 续读位置丢失 / 听书时 progress 请求过频          | [ebook/电子书进度远程防抖影响.md](./ebook/电子书进度远程防抖影响.md)                                                                     |
| 阅读页顶栏显示「智能对话」而非书架                                | [ebook/电子书阅读书架.md](./ebook/电子书阅读书架.md) §3.4、[auth/路由认证.md](./auth/路由认证.md)                                              |
| PDF 目录跳转报 canvas 并发渲染错误                                | [ebook/书架阅读打磨.md](./ebook/书架阅读打磨.md) §3.6                                                                                      |
| EPUB 连续滚动无法自动进入下一章                                   | [ebook/EPUB阅读器设置滚动.md](./ebook/EPUB阅读器设置滚动.md) §3.2                                                                      |
| 桌面大文件上传中无法阅读 / 超 120MB 打不开                        | [ebook/电子书COS本地书架.md](./ebook/电子书COS本地书架.md) §3.1–§3.2                                                                             |
| 非会员 Web 无法导入 / 会员才云端备份                              | [ebook/电子书会员上传.md](./ebook/电子书会员上传.md)                                                                                   |
| 重复选同一路径仍上传                                              | [ebook/电子书本地路径去重.md](./ebook/电子书本地路径去重.md)                                                                                     |
| 刷新报 `getStorage` 未初始化                                      | [auth/会员存储循环依赖.md](./auth/会员存储循环依赖.md)                                                                         |
| 换号后书架仍是上一账号                                            | [auth/用户切换状态重置.md](./auth/用户切换状态重置.md)                                                                                       |
| 阅读背景色不生效                                                  | [ebook/电子书COS本地书架.md](./ebook/电子书COS本地书架.md) §3.4                                                                                  |
| PDF 页面太小 / 猛滚连跳多页                                       | [ebook/PDF阅读器适配滚动.md](./ebook/PDF阅读器适配滚动.md) §3.1–§3.3                                                                             |
| EPUB 右键无菜单 / 助手与知识库样式不一致                          | [ebook/EPUB助手右键菜单.md](./ebook/EPUB助手右键菜单.md)、[ebook/电子书Mock助手.md](./ebook/电子书Mock助手.md)         |
| 目录打开但看不出当前读到哪一章                                    | [ebook/电子书目录激活高亮.md](./ebook/电子书目录激活高亮.md)                                                                             |
| 长目录 / 分句列表如何快速滚到底、顶、当前                         | [ebook/电子书列表滚动循环.md](./ebook/电子书列表滚动循环.md)                                                                                   |
| 同 HTML 多 `#filepos` 点目录滚到错节/章末                           | [ebook/EPUB目录CFI导航.md](./ebook/EPUB目录CFI导航.md)                                                                                       |
| 同 HTML 多目录锚点高亮总落在最后一项                              | [ebook/EPUB目录激活CFI.md](./ebook/EPUB目录激活CFI.md)                                                                                           |
| PDF 无 MOKE 助手 / PDF 右键菜单                                   | [ebook/电子书Mock助手.md](./ebook/电子书Mock助手.md)                                                                                         |
| 保存读书想法后阅读页白屏 / 下划线异常                             | [ebook/EPUB想法下划线同步.md](./ebook/EPUB想法下划线同步.md)                                                                         |
| EPUB 用户划线如何实现（**唯一主文档**）                           | [ebook/developer/EPUB用户划线开发.md](./ebook/developer/EPUB用户划线开发.md)（**从 §0 读起**） |
| EPUB 想法添加与虚线如何实现（**唯一主文档**）                     | [ebook/developer/EPUB想法添加下划线开发.md](./ebook/developer/EPUB想法添加下划线开发.md)（**从 §0 读起**） |
| EPUB 划线同名句子误删 / PopBar 划线与删除状态不对                 | [ebook/EPUB划线DOM匹配.md](./ebook/EPUB划线DOM匹配.md)                                                                                 |
| EPUB PopBar 闪烁 / 划线卡顿 / 工具条空档                          | [ebook/EPUB PopBar性能体验.md](./ebook/EPUB PopBar性能体验.md)                                                                                           |
| 划线/写想法后数秒才出现线、同步时页面卡死；反向选到空行后应用卡死 | [ebook/EPUB注释同步性能.md](./ebook/EPUB注释同步性能.md)                                                                               |
| 两次想法选区相交时虚线叠成双线                                    | [ebook/EPUB想法部分重叠.md](./ebook/EPUB想法部分重叠.md)                                                                         |
| 段落内写想法无虚线 / 用户下划线误扣相邻想法虚线                   | [ebook/EPUB想法用户划线重叠.md](./ebook/EPUB想法用户划线重叠.md)                                                           |
| 点击想法列表引用合并/拆分不对（A、B、标点、换行桥接）             | [ebook/EPUB想法聚类桥接.md](./ebook/EPUB想法聚类桥接.md)                                                                       |
| 想法侧栏引用区划线/删除划线状态不对（部分已划仍显示删除）         | [ebook/EPUB想法引用划线切换.md](./ebook/EPUB想法引用划线切换.md)                                                           |
| 拖拽分栏 EPUB 白屏 / 拖拽时彩色划线消失                           | [ebook/EPUB分屏软调整.md](./ebook/EPUB分屏软调整.md)                                                                                     |
| 想法列表单击应进详情 / 分组摘录展开                               | [ebook/EPUB想法列表UI.md](./ebook/EPUB想法列表UI.md)                                                                                         |
| 跨段落写想法时空行也出现虚线                                      | [ebook/EPUB想法下划线空白间隙.md](./ebook/EPUB想法下划线空白间隙.md)                                                                 |
| 删想法列表最后一条后侧栏空白不收起 / 详情正文比列表下垂             | [ebook/EPUB想法列表删除关闭.md](./ebook/EPUB想法列表删除关闭.md)                                                                     |
| 书摘分享图片 / 复制到微信                                         | [ebook/EPUB引用分享.md](./ebook/EPUB引用分享.md)                                                                                                 |
| EPUB「听当前」无声 / 中文书摘本机不读                             | [ebook/EPUB引用听书.md](./ebook/EPUB引用听书.md)                                                                                               |
| EPUB「听当前」播完即停 / 起播偏下一句                             | [ebook/EPUB听书引用继续.md](./ebook/EPUB听书引用继续.md)                                                                             |
| EPUB 听当前后 PopBar/选区未收起                                   | [ebook/EPUB听书PopBar关闭.md](./ebook/EPUB听书PopBar关闭.md)                                                                             |
| EPUB 听书划选时仍自动滚回播放句                                   | [ebook/EPUB听书选择暂停跟随.md](./ebook/EPUB听书选择暂停跟随.md)                                                                   |
| EPUB 滚动后选区高亮残留                                           | [ebook/EPUB选区滚动清除.md](./ebook/EPUB选区滚动清除.md)                                                                           |
| EPUB 听书朗读整行星号分隔线                                       | [ebook/EPUB TTS分隔符过滤.md](./ebook/EPUB TTS分隔符过滤.md)                                                                               |
| EPUB 边听边读 / 顶栏听书 / 播放条 / 分句跳转 / 倍速                 | [ebook/EPUB章节听书.md](./ebook/EPUB章节听书.md) · [ebook/EPUB听书播放器栏.md](./ebook/EPUB听书播放器栏.md) · [ebook/EPUB滚动听书章节前进影响.md](./ebook/EPUB滚动听书章节前进影响.md) |
| EPUB 听读分句段首省略号/破折号/开引号错位或空句                     | [ebook/EPUB听书句首标点影响.md](./ebook/EPUB听书句首标点影响.md) · [impact/EPUB听书句首标点影响.md](./impact/EPUB听书句首标点影响.md) |
| EPUB 听书/听当前云端连播句间停顿过长                               | [ebook/EPUB听书云端预取影响.md](./ebook/EPUB听书云端预取影响.md) · [impact/EPUB听书云端预取影响.md](./impact/EPUB听书云端预取影响.md) |
| EPUB 听书/听当前按段合成仍逐句高亮 / 首句慢                       | [ebook/EPUB听书段落朗读.md](./ebook/EPUB听书段落朗读.md) · [ideas/EPUB听书段落朗读.md](./ideas/epub/EPUB听书段落朗读.md) |
| EPUB 听书中点目录切章不自动续听 / go trim 抛错                     | [ebook/EPUB听书目录章节重启.md](./ebook/EPUB听书目录章节重启.md)                                                               |
| 听书目录切章起播落在上一节末句或文件第 0 句                        | [ebook/EPUB听书目录锚点启动.md](./ebook/EPUB听书目录锚点启动.md)                                                                     |
| EPUB 听书首句出声慢 / 首包与预取抢带宽                             | [ebook/EPUB听书启动后预取.md](./ebook/EPUB听书启动后预取.md)                                                                 |
| EPUB 连续滚动听书远章后 FAB「回到播放位置」无效                    | [ebook/EPUB听书跟随CFI重挂载.md](./ebook/EPUB听书跟随CFI重挂载.md) · [ebook/EPUB听书自动跟随浮动按钮.md](./ebook/EPUB听书自动跟随浮动按钮.md) |
| EPUB 听书倍速 2× 但听感仍 1×（云端 MP3）                           | [ebook/EPUB听书源后速率.md](./ebook/EPUB听书源后速率.md)                                                                           |
| EPUB 听书倍速落库 /「设置为本书籍」仍影响其它书                     | [ebook/EPUB听书速率持久化.md](./ebook/EPUB听书速率持久化.md)                                                                               |
| EPUB 听书 loading 时倍速 pop 被关掉 / 右侧按钮灰掉                 | [ebook/EPUB听书栏加载控件.md](./ebook/EPUB听书栏加载控件.md)                                                               |
| EPUB 听书云端已停但播放条仍「播放中」                              | [ebook/EPUB听书音频结束UI.md](./ebook/EPUB听书音频结束UI.md)                                                                               |
| EPUB 听书播放本轮修复总览（含切章 / 软暂停 / loading / 选中色）    | [ebook/EPUB听书播放修复2026-07.md](./ebook/EPUB听书播放修复2026-07.md) · [ideas/EPUB听书播放优化.md](./ideas/epub/EPUB听书播放优化.md) |
| EPUB 听书连播时播放钮 loading 只在首启出现                          | [ebook/EPUB听书等待加载.md](./ebook/EPUB听书等待加载.md) · [ebook/EPUB听书播放加载.md](./ebook/EPUB听书播放加载.md) |
| 书架已读进度出现很长小数                                          | [ebook/电子书书架进度百分比.md](./ebook/电子书书架进度百分比.md)                                                                               |
| 电子书书架按书名搜索（Enter 提交、不区分大小写、关闭恢复完整列表） | [ebook/书架标题搜索.md](./ebook/书架标题搜索.md)                                                                                             |
| 电子书书架「全部」标签分页不准 / 追加加载后顺序错乱            | [ebook/书架全部标签统一分页.md](./ebook/书架全部标签统一分页.md)                                                                             |
| EPUB 听书底栏切章 / 暂停续播与系统媒体同步                        | [ebook/EPUB听书栏章节导航.md](./ebook/EPUB听书栏章节导航.md) · [ebook/EPUB听书栏播放头目录.md](./ebook/EPUB听书栏播放头目录.md) · [ebook/EPUB听书软暂停.md](./ebook/EPUB听书软暂停.md) |
| 听书底栏上下章切到错误邻节（同 spine 多节）                        | [ebook/EPUB听书栏播放头目录.md](./ebook/EPUB听书栏播放头目录.md)                                                                     |
| 本机听书/听当前第一句无声、第二句正常                               | [english/TTS本地取消结算影响.md](./english/TTS本地取消结算影响.md) · [impact/TTS本地取消结算影响.md](./impact/TTS本地取消结算影响.md) |
| EPUB 听读播放背景在分栏/侧栏 resize 后错位或消失                    | [ebook/EPUB听书背景重布局.md](./ebook/EPUB听书背景重布局.md) · [impact/EPUB听书尺寸重布局影响.md](./impact/EPUB听书尺寸重布局影响.md) |
| 听当前无逐句淡黄底 / Safari 无背景                                | [ebook/EPUB听书句背景.md](./ebook/EPUB听书句背景.md)                                                                                   |
| 听当前跨段多句同时高亮 / 换句背景不消                               | [ebook/EPUB听书宿主覆盖层.md](./ebook/EPUB听书宿主覆盖层.md)                                                                                 |
| 听当前后划线重复 / 无法取消划线                                   | [ebook/EPUB听书用户划线对账.md](./ebook/EPUB听书用户划线对账.md)                                                         |
| MK 问书关闭后右侧空白 / 想法列表关后留白 / 开 MK 闪烁 / 删最后一条后未全宽 | [ebook/EPUB阅读分屏.md](./ebook/EPUB阅读分屏.md)                                                                                       |
| 右键菜单 PopBar 闪烁 / 无选区右键自动点词                         | [ebook/EPUB右键菜单PopBar.md](./ebook/EPUB右键菜单PopBar.md)                                                                                 |
| 开/关想法侧栏后左侧引用段滚出屏幕                                 | [ebook/EPUB想法引用视口.md](./ebook/EPUB想法引用视口.md) · 通用阅读位 [ebook/EPUB视口定位.md](./ebook/EPUB视口定位.md)   |
| 开侧栏 / 拖分栏后正文阅读位置跳动                                 | [ebook/EPUB视口定位.md](./ebook/EPUB视口定位.md)                                                                                               |
| PopBar 写想法/问书输入框闪焦后丢失                                | [ebook/EPUB侧面板输入焦点.md](./ebook/EPUB侧面板输入焦点.md)                                                                           |
| EPUB 阅读背景与顶栏/侧栏色差                                      | [ebook/EPUB阅读器表面背景.md](./ebook/EPUB阅读器表面背景.md)                                                                                     |
| EPUB 粉/米背景下按钮、边框或听书菜单看不清                        | [ebook/EPUB阅读器Chrome对比度.md](./ebook/EPUB阅读器Chrome对比度.md) · [ebook/EPUB Chrome列表激活主题.md](./ebook/EPUB Chrome列表激活主题.md) |
| EPUB 放大/全屏后正文贴左、需刷新才居中                            | [ebook/EPUB窗口尺寸重布局影响.md](./ebook/EPUB窗口尺寸重布局影响.md)                                                                           |
| EPUB 选区 PopBar 字色/投影不对或顶栏样式条不该出现                | [ebook/EPUB选区PopBar Chrome.md](./ebook/EPUB选区PopBar Chrome.md)                                                                         |
| 书摘分享弹窗按钮看不清 / 预览区与图片底色不一致                   | [ebook/EPUB引用分享对话框Chrome.md](./ebook/EPUB引用分享对话框Chrome.md)                                                                     |
| EPUB 阅读设置无法点击正文关闭                                     | [ebook/EPUB阅读器设置关闭.md](./ebook/EPUB阅读器设置关闭.md)                                                                         |
| 复制到助手后输入中文乱码                                          | [knowledge/助手插入焦点.md](./knowledge/助手插入焦点.md) §5.1                                                                        |
| 知识库纯预览右侧空「预览内容为空」/ 双预览占位                    | [monaco/Markdown视图面板滚动.md](./monaco/Markdown视图面板滚动.md)                                                                           |
| 预览 ↔ 编辑切换滚动错位 / 开助手后左侧总是编辑器                  | [monaco/Markdown预览编辑滚动恢复.md](./monaco/Markdown预览编辑滚动恢复.md) · [monaco/Markdown视图面板滚动.md](./monaco/Markdown视图面板滚动.md) |
| 预览切编辑丢位置 / 助手开时编辑切预览总在文首                     | [monaco/Markdown预览编辑滚动恢复.md](./monaco/Markdown预览编辑滚动恢复.md)                                                       |
| 主题色（强调色）怎么换 / 全站 hover/选中色不跟随 / 首帧闪回 teal  | [setting/强调色设置.md](./setting/强调色设置.md)（10 色预设 + CSS 变量覆盖 + 首屏防闪 + 原版 teal 豁免）                            |
| 插件图标 SVG 渲染 / stroke/fill 动画不触发 / 主题色不跟随         | [app/插件图标系统.md](./plugins/插件图标系统.md)（PluginIcon + normalizeSvgForHostIcon + pathLength=1 动画） · [plugins/插件宿主图标.md](./plugins/插件宿主图标.md) |
| Registry 上传 SVG 图标失败 / 菜单选择后无反应 / 文件选择框闪退   | [app/注册图标上传.md](./plugins/注册图标上传.md)（Upload button 模式 + openRef + DropdownMenu scrollable） |
| 桌面端选文件 / 新增导入类型需写 Rust 命令 / accept 过滤器不灵活   | [app/统一文件选择.md](./app/统一文件选择.md)（通用 `select_files` 替代 3 个专用命令 + `select-files.ts` 模块） |
| 插件选本地文件 / iframe untrusted 无法选文件 / `convertFileSrc` 配置 | [app/插件选择本地文件.md](./plugins/插件选择本地文件.md)（bridge `api.ui.pickLocalFiles` + Host 适配层 + `assetProtocol` 配置） |
| Web/Tauri 选文件双路径重复 / `pickFileObject` 跨端 / Rust 读文件命令删除 | [app/选择文件对象.md](./app/选择文件对象.md)（跨端 `pickFileObject` + `pickBrowserFiles` + `convertFileSrc` + `fetch` + 错误码统一） |
| macOS 拖文件闪退 / 对话框打开时拖入 SIGABRT / wry nil pasteboard panic | [app/macOS拖拽选择器崩溃.md](./tauri/macOS拖拽选择器崩溃.md)（`AsyncFileDialog` + wry vendor 补丁 #1723 + `pickerOpenRef` 前端守卫） |
| 拖文件顶掉 SPA / WKWebView 导航到 file:// / dragDropEnabled false 副作用 | [app/文件拖放导航屏蔽.md](./app/文件拖放导航屏蔽.md)（Rust `on_navigation` 拦截 `file://` + 前端 window 级 `preventDefault`） |
| 主包体积大 / 首屏慢 / React.lazy / mermaid 动态加载（含形态修复见 §4.6.1）/ Monaco·Prettier 懒加载 / barrel 瘦身 | [app/构建优化.md](./app/构建优化.md) |
| 英语 Agent 选中文本右键朗读 / 复制 / 选区菜单复用 | [english/选中文本朗读菜单.md](./english/选中文本朗读菜单.md)（`useSelectionContextMenu` + `PositionedQuickMenu` + 按段云端 TTS + 悬浮条） |
| 英语学习 Agent 流式输出输入框卡顿 / 视觉抖动 | [english/英语Agent流式性能隔离.md](./english/英语Agent流式性能隔离.md) |
| 听书切句落后听感 / 首句尾音到下句高亮滞后 / rAF 进度轮询 | [ebook/EPUB听书节奏引导影响.md](./ebook/EPUB听书节奏引导影响.md)（`CLOUD_CADENCE_LEAD_SEC=0.35` + `requestAnimationFrame` + `onPlaybackProgress` + kick ≥0.8 提前切句） |
| 插件加载失败只能重试 / 想离开当前页或查接入文档 | [app/插件宿主错误处理.md](./plugins/插件宿主错误处理.md)（错误卡片新增「返回首页」「插件开发指南」按钮） |
| 首页色块/按钮饱和度过高 / 滚动 FAB 圆形过大 / 下拉菜单内边距 | [ui/UI色调打磨.md](./ui/UI色调打磨.md)（`HUE_STYLES` 透明度 + `Button` variant + `ScrollFab` 尺寸 + `DropdownMenuContent` 内边距） |
| EPUB 设置滑条 macOS 失焦后变灰 / accent-color 不恢复 | [ebook/EPUB设置范围重绘.md](./ebook/EPUB设置范围重绘.md)（`SettingsRange` + `rangeRepaintKey` + `focus`/`visibilitychange` remount） |
| EPUB 阅读区选区被问书侧栏滚动误清 | [ebook/EPUB选区滚动目标过滤.md](./ebook/EPUB选区滚动目标过滤.md) |
| 电子书助手流式输出卡顿 | [ebook/电子书助手流式补丁调度.md](./ebook/电子书助手流式补丁调度.md) |
| Tooltip 无法程序化控制展开 / 无法设置对齐 | [app/提示受控对齐.md](./ui/提示受控对齐.md)（`align` + `open` + `onOpenChange` 透传 Radix） |
| Tooltip 阴影偏色 / 默认无阴影 / 箭头遮内容 / 工具栏与底部栏 Tooltip 朝下遮挡 / 分类菜单与 Tooltip 抢焦点 | [app/Tooltip方向与阴影修复.md](./app/Tooltip方向与阴影修复.md)（`shadow` 默认 `true` + 投影改 teal-500 + drop-shadow 改 theme-background + Arrow `z-50→z-30` + 工具栏/底部栏 `side="top"` + 分类菜单 `disableHoverableContent`/`disabled` + `onCloseAutoFocus` 阻止回跳） |
| Portal（Dialog/Drawer/Popover）内字体不是应用字体 / Markdown 预览用系统字体 | [app/Portal与Markdown字体继承.md](./app/Portal与Markdown字体继承.md)（`font-family` 从 `#root` 移至 `body` + `.markdown-body` 显式覆盖第三方 CSS） |
| 书架与知识库图标按钮无悬停动画 / 导入按钮加载中可误触 / 分类标签样式不一致 | [app/书架知识库视觉微调.md](./app/书架知识库视觉微调.md)（`lucide-stroke-draw-hover` + Tooltip `side="top"` + `disabled={uploading \|\| showInitialLoading}` + Tab `variant="link"` + 图标 `size-4`） |
| Monaco 编辑器加载时无加载指示 / Suspense 占位无背景 | [app/Monaco加载恢复.md](./ui/Monaco加载恢复.md)（`loading` prop 恢复 + `bg-theme/5` fallback 背景） |

---

## 文档类型

- **实现 / 修复**：各域下 `*-implementation*`、`*-complete*` 或专题名 md。
- **规划 / 实现思路**：[`ideas/`](./ideas/) — 需求阶段的架构图、流程图与分阶段步骤（Skill：`feature-implementation-idea`）。
- **运维**：`ops/部署.md`、`ops/Nginx配置.md`、`ops/服务器部署.md`。
- **用户向**：根目录 `项目指南.md`、`项目更新信息.md`（正文不出现仓库路径）。

新增专题时请在对应域 `README.md` 登记一行，并视需要更新本表「常见排查」。
