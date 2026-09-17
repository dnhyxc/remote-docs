# 前端应用壳层

路径前缀：`apps/frontend/`（非单一业务模块的横切能力）。

本目录现仅保留**构建优化、网络、文件选择、语音输入**等通用壳层能力。插件系统、Tauri 桌面、认证、样式隔离、视频播放、国际化、通用 UI 已拆分为独立功能域目录。

| 文档 | 说明 |
|------|------|
| [构建优化.md](../app/构建优化.md) | 前端打包优化：路由 `React.lazy` + `manualChunks` + mermaid 动态 `import()`、CSS 显式引入、Monaco/Prettier 懒加载、barrel 瘦身 |
| [HTTP网络错误提示.md](../app/HTTP网络错误提示.md) | 网络错误 Toast |
| [语音输入实现.md](./语音输入实现.md) | 语音输入（对话等） |
| [统一文件选择.md](../app/统一文件选择.md) | 通用文件选择命令统一：Tauri `select_files` 命令、前端 `select-files.ts` 模块、`assetProtocol` 配置 |
| [选择文件对象.md](../app/选择文件对象.md) | 跨端 pickFileObject 统一文件选取：Web input + Tauri `convertFileSrc` + `fetch` |
| [文件拖放导航屏蔽.md](./文件拖放导航屏蔽.md) | 拦截拖放文件导航：Rust `block_file_drop_navigation` 插件 + 前端 `dragover` / `drop` `preventDefault` |
| [学习笔记实现.md](./学习笔记实现.md) | 学习笔记实现：MobX `LearningNotesStore`、Host API 依赖注入、累积分页加载、DOCX 导出 |
| [Tooltip方向与阴影修复.md](./Tooltip方向与阴影修复.md) | Tooltip 阴影默认开启 + 颜色改 teal-500/theme-background + Arrow z-50→z-30；工具栏 / Monaco 底部栏 Tooltip 改 `side="top"`；EbookShelfBookCard 分类菜单 Tooltip 禁 hover + Popover 阻止焦点回跳；Monaco 删除 `console.log` |
| [搜索组件提取.md](./搜索组件提取.md) | 知识库 `KnowledgeSearchInput` 提取为通用 `@design/SearchInput`；新增 `autoFocus` / `inputRef` / `onEscape` 三个可选 props；删除原业务文件，知识库列表与回收站两处调用切换 |
| [书架知识库视觉微调.md](./书架知识库视觉微调.md) | 统一电子书书架与知识库列表按钮视觉：图标按钮加 `lucide-stroke-draw-hover` 描边动画；电子书导入 Tooltip `side` 从 `bottom` 改 `top`；导入按钮初始加载期间禁用；知识库分类管理图标 `size-3.5`→`size-4`；分类标签 `variant` 从 `ghost` 改 `link` 并精简样式 |
| [Portal与Markdown字体继承.md](./Portal与Markdown字体继承.md) | 字体继承修复：`font-family` 从 `#root` 上移到 `body` 使 Portal（Dialog/Drawer/Popover）继承应用字体；`.markdown-body` 显式覆盖 `github-markdown` 写死的系统字体栈 |
| [书架知识库分页常量归一化.md](./书架知识库分页常量归一化.md) | **全局分页默认值归一**：删除知识库 Store 私有 `DEFAULT_PAGE_SIZE / SCROLL_LOAD_THRESHOLD_PX`，与电子书共用 `@/constants`；`EBOOK_SHELF_PAGE_SIZE` 重命名为通用 `DEFAULT_PAGE_SIZE`；纯重构，运行时值无变化 |
| [首页舞台卡片重构.md](./首页舞台卡片重构.md) | **首屏拆为 `StageCard` 壳层 + `FocusCarousel` 轮播**：删除 `Home` 内联 hero 状态与 JSX，下沉到两个可复用组件；`StageCard` 提供顶栏 / 近景区 / 水印 / 底栏入口 + 鼠标 3D 倾斜与分层视差（RAF 节流、`prefers-reduced-motion` / `IntersectionObserver` 守卫）；`FocusCarousel` 提供叠层 fade + 方向位移 + blur 切页、自动播放、触屏与水平滚轮、受控 / 非受控双模式 |
| [个人主页路由重构.md](./个人主页路由重构.md) | `/profile` 路由改为 `ProfileLayout` + 子路由（资料 / 账号 / 充值），`/account`、`/pay` 旧路径用 `Navigate` 重定向到 `/profile/account`、`/profile/pay` |
| [独立文档站迁移.md](./独立文档站迁移.md) | `/update-info`、`/project-guide`、`/plugin-dev-guide` 从本地 SPA 路由迁移到 `remote-docs` 独立站（`getRemoteDocsOrigin` + `openExternalUrl`），主站删除对应视图与路由，跳转自动携带 lang/theme/accent |
| [文档快捷键统一.md](./文档快捷键统一.md) | **保存/新建提升为应用级快捷键**：`useDocumentShortcuts` 由 Layout 统一监听，`bindDocumentShortcutHandlers` 页面注册回调；设置页分类重命名为「通用/编辑器」；新建默认键改 `Meta+Shift+N` |

---

## 已拆分至独立功能域

| 新目录 | 说明 | 入口 |
|--------|------|------|
| [plugins/](../plugins/) | 插件/微前端系统（MF、插件开发、样式隔离） | [plugins/模块联邦实现指南.md](../plugins/模块联邦实现指南.md) |
| [tauri/](../tauri/) | Tauri 桌面特性（窗口、菜单、全屏、右键） | [tauri/Tauri窗口缩放揭示.md](../tauri/Tauri窗口缩放揭示.md) |
| [auth/](../auth/) | 认证登录（路由守卫、SecretInput、小程序绑定） | [auth/路由认证.md](../auth/路由认证.md) |
| [style/](../style/) | 样式隔离（@scope、Portal、qiankun 加固） | [style/样式隔离实现.md](../style/样式隔离实现.md) |
| [video/](../video/) | 视频播放器（组件化、影院态、画中画） | [video/视频播放器插件.md](../video/视频播放器插件.md) |
| [i18n/](../i18n/) | 国际化（中英文界面） | [i18n/中英双语实现指南.md](../i18n/中英双语实现指南.md) |
| [ui/](../ui/) | 通用 UI/UX（组件、交互、编辑器） | [ui/UI色调打磨.md](../ui/UI色调打磨.md) |

上级：[../README.md](../README.md)
