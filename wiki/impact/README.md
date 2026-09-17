# 影响点分析（impact）

本目录收录 **跨功能改动的影响面分析**：某能力的新增/重构是否会波及已有模块的数据、DOM、同步逻辑或交互。

| 文档 | 范围 |
|------|------|
| [EPUB听书节奏引导影响.md](./EPUB听书节奏引导影响.md) | **云端切句提前 + kick 尾声提前**：对听书/听当前句高亮时序与选区朗读预览的影响 |
| [英语Agent选区朗读影响.md](./英语Agent选区朗读影响.md) | **英语 Agent 选区右键朗读/复制 + 通用 `PositionedQuickMenu`/`useSelectionContextMenu` 抽取**：对 EPUB 右键菜单薄壳化、Markdown/知识库助手未启用菜单、听书 TTS 链路复用的影响 |
| [插件宿主错误处理.md](../plugins/插件宿主错误处理.md) | **插件宿主卡片错误态新增「返回首页」「插件开发指南」按钮**：对 toolbar 变体、加载态、错误边界、全屏态、路由导航的影响 |
| [UI色调打磨.md](../ui/UI色调打磨.md) | **首页色相透明度 + 全局 `Button` default/outline variant + `ScrollFab` 尺寸 + `DropdownMenuContent` 内边距**：对 30+ 文件 Button 消费方、三端 ScrollFab、主题色切换豁免的影响 |
| [EPUB听书背景与注释影响.md](./EPUB听书背景与注释影响.md) | 听当前/听书 **播放背景色** 对用户划线、想法虚线的影响点 |
| [EPUB听书尺寸重布局影响.md](./EPUB听书尺寸重布局影响.md) | 阅读区 **resize 重绘**（`repaintActive` / ResizeObserver / `EpubPane` 接线）对原有功能的影响点 |
| [EPUB听书工具整合影响.md](./EPUB听书工具整合影响.md) | 听读 **utils 7→3 文件合并**：路径对照、API 不变项、文档滞后、回归清单 |
| [EPUB标注共享提取影响.md](./EPUB标注共享提取影响.md) | **mark 层公共 utils 抽取**（`epubMarkShared` + geometry export）：CFI/Range/SVG 去重、对各层影响 |
| [EPUB引用听书播放器栏影响.md](./EPUB引用听书播放器栏影响.md) | **听当前共用底部播放条**：按句播放重构、与听书互斥、句内 cadence 高亮变化 |
| [EPUB听书句首标点影响.md](./EPUB听书句首标点影响.md) | **句界算法句首中文标点**：`buildSentenceOffsetSpans` 对听书/听当前/TTS 分句与背景对齐的影响 |
| [EPUB听书云端预取影响.md](./EPUB听书云端预取影响.md) | **句间云端 TTS 预取**：`prefetchCloudTts` 对听书/听当前连播与其它 `playPreferred` 调用方的影响 |
| [Monaco Markdown视图面板影响.md](./Monaco Markdown视图面板影响.md) | **Markdown 预览/编辑与助手 Panel**：布局 co-mount、开助手不再强制 split、纯预览全宽对 split/Diff/知识库助手的影响 |
| [知识编辑器长文本性能.md](./知识编辑器长文本性能.md) | **知识库长文编辑性能**：纯 edit 停喂隐藏预览、Store 派生 boolean、助手输入内化与标题区渲染隔离 |
| [知识库预览助手面板性能影响.md](./知识库预览助手面板性能影响.md) | **预览+助手同开性能**：Monaco 预览态卸载/冻结、非受控轻量输入条、`KnowledgeMarkdownPane` 隔离 |
| [知识预览代码工具条滚动.md](./知识预览代码工具条滚动.md) | **长文多代码块预览滚动**：吸顶栏缓存/二分/O(1) 清理对预览·聊天·行内工具栏的影响 |
| [知识库助手流式吸附影响.md](./知识库助手流式吸附影响.md) | **助手流式贴底抖动**：同步 `stickFlush` + 内容区 ResizeObserver，对知识库/MK/英语 Agent 跟底与打断的影响 |
| [TTS本地取消结算影响.md](./TTS本地取消结算影响.md) | **本机 Web Speech cancel 后 50ms settle**：听当前首句修复、全站本机/回退路径起播延迟与云端无影响 |
| [EPUB滚动听书章节前进影响.md](./EPUB滚动听书章节前进影响.md) | **连续滚动听书逐 iframe 节间衔接**：`runScrollSectionLoop` / `advanceScrollListenSection` 对分页听书、播放条切句、听当前互斥的影响 |
| [EPUB窗口尺寸重布局影响.md](./EPUB窗口尺寸重布局影响.md) | **窗口放大/全屏 EPUB 居中**：`relayoutEpubViews` + `window.resize` settle 对分栏 soft resize、划线 sync、听书背景的影响 |
| [EPUB听书跟随浮动按钮布局影响.md](./EPUB听书跟随浮动按钮布局影响.md) | **布局变化后 Follow FAB**：`checkEpubListenFollowAfterLayout` 对听书/听当前 autoFollow、FAB 与 resize 链路的影响 |
| [EPUB划线自定义颜色选择器影响.md](./EPUB划线自定义颜色选择器影响.md) | **划线自定义色 ColorPicker**：`#rrggbb(aa)` 持久化、PopBar 嵌套取色、upsert 串行与想法侧栏展示 |
| [云端TTS用户凭据回退影响.md](./云端TTS用户凭据回退影响.md) | **云端 TTS 用户凭证与失败降级**：MiniMax/讯飞 Key 入库、`xfyunVoiceId` 独立、失败 Toast、移除讯飞→硅基中转、设置页 UI |
| [云端TTS MiniMax模型设置影响.md](./云端TTS MiniMax模型设置影响.md) | **MiniMax 模型默认 turbo / 白名单 2.8 两项 / Combobox 预设 / 后端 `@IsIn` 与 normalize 不再静默改 model** |
| [云端TTS边缘韵律会员影响.md](./云端TTS边缘韵律会员影响.md) | **Edge 免费 TTS / 分模式 prosody / 非会员 Edge 选路 / 设置页 Edge 前置** |
| [TTS桌面端云端播放影响.md](./TTS桌面端云端播放影响.md) | **Tauri 云端 MP3 播放修复**：Audio prime、`canplay` 后 play、Edge 非流式 endpoint、Tauri `arrayBuffer` 读 body |
| [Tauri HTTP重试影响.md](./Tauri HTTP重试影响.md) | **Tauri HttpClient 全方法重试**：POST 等写请求默认 2 次、`!response` 门槛、`catch`/`handleErrorResponse` 修复 |
| [微信小程序绑定影响.md](./微信小程序绑定影响.md) | **微信小程序登录与账号关联**：`user_wechat` 映射表、bind_token / link_code 绑定、JWT 解绑吊销、对既有认证与账号页的影响 |
| [EPUB小程序服务端解析影响.md](./EPUB小程序服务端解析影响.md) | **小程序 EPUB 服务端解析**：`parseEpubBuffer` 懒解析、章节 API、COS 键兼容、对 Web epub.js / 进度 / 下载链路的影响 |
| [电子书书架空标签重置影响.md](./电子书书架空标签重置影响.md) | **书架分类空 Tab 隐藏与自动回「全部」**：未分类/0 册分类不展示、移走最后一本切 Tab、卡片 Tooltip 分类 |
| [EPUB听书播放器栏UI影响.md](./EPUB听书播放器栏UI影响.md) | **听书播放条 UI**：分句虚拟列表、滚到当前句、刻度尺倍速 0.5–3×、列表选中样式 |
| [电子书进度远程防抖影响.md](./电子书进度远程防抖影响.md) | **阅读进度远端防抖 + keepalive flush**：8s PUT 合并、页内 2s debounce、`pagehide` 不丢进度 |
| [电子书公开分享影响.md](./电子书公开分享影响.md) | **公开书籍与协作阅读**：源书/读书记录、书架 `scope=public`、visibility、对私有书架与阅读的影响 |
| [EPUB公开想法实时同步影响.md](./EPUB公开想法实时同步影响.md) | **公开书想法 `/sync`**：双轨增量、私有书 gate、`openThoughtCluster` 先 sync 的波及面 |
| [EPUB想法视口标注影响.md](./EPUB想法视口标注影响.md) | **想法按章拉取 + 视口 mark**：`spineHints`、双轨 reclaim、sync 拆分、对划线/听书/大册私有书的影响 |
| [EPUB想法加载全量获取移除影响.md](./EPUB想法加载全量获取移除影响.md) | **移除误触发全量 list**：`book?.fmt` 未就绪竞态、PDF 无想法、进书仅 `spineHints` |
| [TTS边缘统一流式端点影响.md](./TTS边缘统一流式端点影响.md) | **Edge TTS 统一 `SPEECH_EDGE_TTS_STREAM`**：取消 Tauri/Web endpoint 分流对云端朗读的影响 |
| [对话流式选区保持影响.md](./对话流式选区保持影响.md) | **流式气泡选区保持**：命令式 HTML + 文本偏移恢复；对横滚冻结、贴底、引用、性能与复制的影响 |
| [英语Agent流式输入性能影响.md](./英语Agent流式输入性能影响.md) | **英语 Agent 流式输入性能**：MessageList/Signals 与 ChatEntry 解耦、`createStreamingMobxPatchScheduler` 就地写 content |
| [EPUB提问流式选区清除影响.md](./EPUB提问流式选区清除影响.md) | **MK 问书流式误清 EPUB 选区**：`onScroll` 仅阅读区清选；问书 store rAF 合并 |

**阅读约定**：结论以仓库 **当前源码** 为准；「历史风险」指旧实现曾出现的问题，不代表现行代码仍会触发。
