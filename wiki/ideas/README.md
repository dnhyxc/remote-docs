# 规划态实现思路（ideas）

本目录收录 **尚未写进 `docs/<功能域>/` 正式专题**、或 **面向从零复刻 / onboarding** 的架构与流程设计文档。正文以 Mermaid 图 + 分阶段步骤为主，**默认描述仓库已有实现** 时会在文首标明「核心能力已上线」。

| 文档                                                                         | 范围                                                                                                                                                            |
| ---------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [auth/登录互斥踢下线.md](./auth/登录互斥踢下线.md) | **登录互斥踢下线**（规划）：JWT `sid`+`cli`，Redis 按 `web`/`mini` 分槽；Web/桌面同槽互踢，小程序与 Web/桌面互不踢；401 + `notifyUnauthorized`；无多设备白名单 / 推送踢人 |
| [english/阅读模型过载降级.md](./english/阅读模型过载降级.md) | **阅读模型过载降级**（M1 已落地）：每日阅读默认 `glm-4.7-flash` 遇智谱 1305「访问量过大」时，分码退避 + 模型冷却，降级到同 Key `glm-4-flash`；互补已落地的 [阅读限流重试](./english/阅读限流重试.md)；M2 SSE 提示 / M3 硅基三级未做 |
| [english/主模型后再分类.md](./english/主模型后再分类.md) | **主模型后再分类**（规划）：`allVocabCategoryText` 收成工具 `el_vocab_classify`，主模型调用后才分类；分类 `maxTokens` 改为该模型最大输出 65536，不再用 1500 |
| [english/点名库先定位.md](./english/点名库先定位.md) | **点名库先定位**（规划）：点名一本词汇库时先抽槽再按目录消歧，只滤那一本；没有库名才扫全部库，对不上则交给 `el_libraries`，不按库数创建分类模型。进模型前就分类的做法由 [主模型后再分类](./english/主模型后再分类.md) 取代 |
| [english/分类截断续批.md](./english/分类截断续批.md) | **分类截断续批**（规划）：80 行硬切改为输入字数预算；模型写得完就自报游标，输出被 1500 token 掐断时下一批从最后一个完整词面开始，同一起点不能前进两次 |
| [english/所有词库一次分类.md](./english/所有词库一次分类.md) | **所有词库一次分类**（规划）：从全部词汇库列出某一类的日常说法，词表未中则用一次 `decide()`，线索必须是原话子串；认定后进模型前逐库分类，正文固定一句 |
| [english/同库分类只扫一次.md](./english/同库分类只扫一次.md) | **同库分类只扫一次**（规划）：同一轮并行的关于类取词在出卡前会各扫整库；进行中的分类记在本轮 `elSurface`，同库只分类一次，不同库仍各扫一次 |
| [english/关于类一次出卡.md](./english/关于类一次出卡.md) | **关于类一次出卡**（规划）：语句库「关于某一类」被字面 search 拆成多次工具调用后触发 `GRAPH_RECURSION_LIMIT`；第一次带库 id 的取词改为整库分类并只挂一张卡，下一轮工具在执行前结束图 |
| [english/语句库分类列出.md](./english/语句库分类列出.md) | **语句库分类列出**（规划）：单独增加 `el_classic_classify`，只读语句库目录并复用现有整库分类；不并进 `el_vocab_classify` |
| [english/库内筛选不中断.md](./english/库内筛选不中断.md) | **库内筛选不中断**（规划）：glm-4.7-flash 只调一次 `el_libraries` 就停；流结束后若未出卡且库名唯一命中，服务端取词并复用整类分类器挂卡 |
| [english/资源卡上下间距.md](./english/资源卡上下间距.md) | **资源卡上下间距**（工作区已落地）：清单卡仅在上方有正文或另一张卡时加 `mt-4`，下方有内容时才加 `mb-4`；空行与未渲染锚点不算内容 |
| [english/系统日推稳定生成.md](./english/系统日推稳定生成.md) | **系统日推稳定生成**（规划）：前台无重试；今天/明天自动重试。后台列出全部历史缺口，详情展示每次失败原因、入队时间、耗时和 token；补生成走无延迟入队，工人空闲即生成 |
| [english/英语Agent关联侧栏.md](./english/英语Agent关联侧栏.md) | **英语 Agent 关联侧栏**（规划）：右侧 Agent 用 7 个 `el_*` 领域工具读写词汇库/语料库/日推/收藏/复习/记词；M1 只读→M2 写入→M3 触发自选生成→M4 上下文；系统日推补生成与 SRS 代评分默认不开 |
| [english/收藏提案直确认.md](./english/收藏提案直确认.md) | **收藏提案直确认**（规划）：一批词一次 `propose_add.items`；点确认走 HTTP `commit`，只追加助手回执，不再插入「请对提案调用 commit」用户句；同轮第二次提案刹车，避免 `GRAPH_RECURSION_LIMIT` |
| [english/整类词一次收藏.md](./english/整类词一次收藏.md) | **整类词一次收藏**（规划）：超过 40 的一类词不靠再问一句补齐；只传本轮清单 `artifactId`，服务端分批对照用户原话挑词，一次确认写入全部命中。点名截断见 [大批收藏稳落库](./english/大批收藏稳落库.md) |
| [english/清单按库取全.md](./english/清单按库取全.md) | **清单按库取全**（规划）：Agent 全量清单不再停在 2000（目录 500、日推 200）并说「未穷尽」；`fetchAllPages` 翻到数据库没有下一行，全量只进 artifact，模型仍看瘦索引 |
| [english/大批收藏稳落库.md](./english/大批收藏稳落库.md) | **大批收藏稳落库**（规划）：不恢复 400/2000 条数顶。整类用本轮词库 artifact 判定并忽略模型附带的 `items`；失败批重试一次；确认后按错题批量的形状一次写入收藏 |
| [english/语句收藏确认.md](./english/语句收藏确认.md) | **语句收藏确认**（规划）：原话里的「进行收藏」由服务端认定；凡是 Agent 会改业务表的操作都先挂现有确认条。收藏直写、单词/语句生成、自选阅读生成在点确认前不落库 |
| [english/语句整类一次收藏.md](./english/语句整类一次收藏.md) | **语句整类一次收藏**（规划）：「将这些进行收藏」时，本轮和上一轮的语句卡合并成一张确认；点确认后不再开一轮去补日常交流库 |
| [english/词句一起收藏.md](./english/词句一起收藏.md) | **词句一起收藏**（规划，工作区已落地，触发仍失败）：工具里当场组两边。语句先占位时轮末合并不会跑。触发改由 [词句分表收藏](./english/词句分表收藏.md) 取代 |
| [english/词句分表收藏.md](./english/词句分表收藏.md) | **词句分表收藏**（规划，工作区已落地）：同时点名单词和语句时，工具中途不挂确认；轮末用原卡片合成一条，点一次后单词、语句各写各的表 |
| [english/取消沿用上次收藏.md](./english/取消沿用上次收藏.md) | **取消沿用上次收藏**（规划，工作区已落地）：没点名英文的取消只撤上一次收藏那一轮的行；「有关…语句…收藏」不再连带更早的单词卡，第二次取消也不再扫进整本语句收藏 |
| [english/收藏确认跟卡片.md](./english/收藏确认跟卡片.md) | **收藏确认跟卡片**（规划，工作区已落地）：确认条和正文共用 `favoriteSet`。窗口跨过「还是取消吧」，集合只取最满的筛选卡；「都收藏」不再退成「确认收藏 1 条语句」，模型列举用 `contentReplace` 换成同一组数字 |
| [english/收藏意图总控.md](./english/收藏意图总控.md) | **收藏意图总控**（规划，工作区已落地）：「我需要收藏之前的单词和语句」旧 `SAVE_RE` 认不出导致整条服务端挂条跳过、确认条只剩 2 句；统一 `resolveFavoriteIntent`，命中后 propose 只延期，轮末按卡片挂一条 |
| [english/收藏只收库卡.md](./english/收藏只收库卡.md) | **收藏只收库卡**（规划，M1 已落地）：先看复习 71 再收藏「家庭」时确认条变成 71+2；添加选卡只收 `source=library`，本轮∪历史再 richest；名单永不信模型散文 |
| [english/取消正文跟确认条.md](./english/取消正文跟确认条.md) | **取消正文跟确认条**（规划，M1 已落地）：确认条 14+3 正确但气泡写整夹 68+38；取消也写 `favoriteReplyText`，与挂条 id 计数同源后 contentReplace |
| [english/再收藏不断窗.md](./english/再收藏不断窗.md) | **再收藏不断窗**（规划，M1 已落地）：分类 14+3 → 都收藏 →「那帮我取消」→ 再都收藏变成词条 107+51；省略取消进闸不断窗，有筛选则丢整库卡 |
| [english/查询收藏不挂确认.md](./english/查询收藏不挂确认.md) | **查询收藏不挂确认**（规划，M1 已落地）：「当前收藏了哪些」误判 add，弹出确认收藏 14+2 并 replace 正文；查询优先、收紧无动词 add |
| [english/收藏先出筛选卡.md](./english/收藏先出筛选卡.md) | **收藏先出筛选卡**（规划，M1–M3 已落地）：长对话「需要收藏…关于家庭…」变成「上面没有单词卡」+ grade3 空 list；复合句先分类出卡再挂条 |
| [english/生成不跑库筛选.md](./english/生成不跑库筛选.md) | **生成不跑库筛选**（规划，M1 已落地）：「生成关于努力的语句」确认条对，正文被三年级空卡盖住；生成问法禁止继承旧库做关于类续查 |
| [english/语境意图总路由.md](./english/语境意图总路由.md) | **语境意图总路由**（规划）：盘点散落闸；单一 `resolveEnglishIntent` 按固定优先级合成分域谓词 + ctx；收尾/挂条只认枚举；禁止每轮 LLM 意图主闸；decide 仅补歧义槽 |
| [english/复合意图槽位化.md](./english/复合意图槽位化.md) | **复合意图槽位化**（规划）：在单 kind 之上引入 IntentFrame + 有序 plan；副作用（挂库卡/presented）由步骤声明；短语表分域；放弃多标签 LLM 主闸；M1 适配→M2 计划器→M3 跨轮槽位 |
| [english/续问沿用原库.md](./english/续问沿用原库.md) | **续问沿用原库**（规划）：「我还需要关于问候的」沿用上一句点名的那一本库；单词与语句同一套。没写「所有库」时不再扫全部库 |
| [english/分类命中前后一致.md](./english/分类命中前后一致.md) | **分类命中前后一致**（规划）：同一库同一类别只判一次并记在卡片上；「家庭和问候」拆开再合并。确认条和卡片用同一份句子，主模型另写的清单不进入收藏 |
| [english/语句分类稳定出卡.md](./english/语句分类稳定出卡.md) | **语句分类稳定出卡**（规划）：同一句关于类不再时而 3 条、时而 4 条；筛选卡禁止按 libraryId 重拉整库。命中按库版本记住，正文固定为「库名：共 n 条。」 |
| [english/阅读生成不误分类.md](./english/阅读生成不误分类.md) | **阅读生成不误分类**（规划，工作区已落地）：「生成关于…的阅读资料」不再沿用上一本语句库挂空筛选卡，也不再把已写好的自选说明换成「没有可展示的行。」；语句分类、收藏合并、自选确认条保持原样 |
| [english/英语工具防空转.md](./english/英语工具防空转.md) | **英语工具防空转**（核心已落地）：同一会话不设工具次数配额。空转只认三道：相同参数连调、同一句第 25 次来回、联网第 4 次。下一句从 0 再计 |
| [english/Agent自选认配置.md](./english/Agent自选认配置.md) | **Agent 自选认配置**（规划）：只走自选生成 `generate_manual`，不触发系统日推。没点名档位就用已保存的自选生成配置；原话点到的字段只覆盖对应项；模型自填的 themes/profile 不采用 |
| [english/自选沿用上一篇.md](./english/自选沿用上一篇.md) | **自选沿用上一篇**（规划）：「同样再来一篇，主题改成…」沿用本会话上一篇已生效档，只覆盖本句点名的字段；冷启动和「按设置」仍用已保存配置。不把档位交回模型 |
| [english/Agent词句生成.md](./english/Agent词句生成.md) | **Agent 词句生成**（规划）：走已落地的 `wrap` / `listIntent` / `fetchAllPages` / 整表卡。生成主题从原话提炼，词数和条数没写则 100，且必须显式传入，避免落到 12000 / 6000 |
| [通用决策封装.md](./通用决策封装.md) | **通用 Flash 决策**（规划）：`decide()` 固定 `glm-4.7-flash`、关思考、无会话。调用方只传任务、原文和验收；会员档不把这次决策换成硅基。词句抽槽是第一个调用方 |
| [english/决策改用千问.md](./english/决策改用千问.md) | **决策改用千问**（规划）：`decide` 档整档改打硅基 `Qwen/Qwen3.6-35B-A3B` 并关思考；分类与抽槽共用 `decideLlmOptions`。不跟对话模型，不改分批和验收 |
| [english/Agent词句认意图.md](./english/Agent词句认意图.md) | **Agent 词句认意图**（规划）：正则仍是快路径；只有主题或条数对不上原话时，才经通用 `decide()` 用 `glm-4.7-flash` 抽槽位，并通过子串校验后才生成 |
| [english/Agent笔记检索.md](./english/Agent笔记检索.md) | **Agent 笔记检索**（规划）：标题用 `fetchAllPages` 拉全后按意图出卡或瘦索引；只有点名的一篇才读正文，正文在卡片里，模型只看瘦字段 |
| [english/Agent大结果旁路展示.md](./english/Agent大结果旁路展示.md) | **Agent 大结果旁路展示**（规划）：全量 list 已拉齐仍被 `maxTokens≈4096` 截断；最优解为 artifact spill + SSE 清单 UI，模型只写导语；对照 Trigger/Codex/LangChain；含边界与 M0–M3 |
| [english/问答清单按需出卡.md](./english/问答清单按需出卡.md) | **问答清单按需出卡**（规划）：筛选题不再挂整库卡片；旁路仍给模型瘦字段，用户卡片只来自 `el_present` 或「要整份清单」的收尾兜底 |
| [english/清单索引可筛选.md](./english/清单索引可筛选.md) | **清单索引可筛选**（规划）：日推/词库/语句库/收藏/错题/复习/记词的大 list 不再只给 5 条 preview；模型看完整瘦索引后再 `el_present` |
| [english/意图决定出卡.md](./english/意图决定出卡.md) | **意图决定出卡**（规划）：讲解不出卡；成组顿号词表改为组标题下的 `el_present` 卡片；仅「列出/导出」且模型忘了调用时兜底 |
| [english/整库全量出卡.md](./english/整库全量出卡.md) | **整库全量出卡**（规划）：「给出所有…单词」隔开也认成整库；卡片按 libraryId 分页滚完总数，模型只看条数，不再把全表截在 2000 |
| [english/整库稳定出卡.md](./english/整库稳定出卡.md) | **整库稳定出卡**（规划）：整库卡由服务端按库名挂上，同一句每次同一张卡；对不上库名时禁止声称卡片已生成 |
| [分享链接过期时间.md](./分享链接过期时间.md) | **分享弹窗自定义过期时间**（规划，上限已定为 30 天）：六个链接分享入口共用一个控件；不改则仍是 7 天；Redis TTL 与 `expiresAt` 同时长；创建弹窗和分享页顶栏都显示失效时刻；书摘图片不在范围 |
| [分享链接持久化.md](./分享链接持久化.md) | **分享持久化 + Admin 台账**（规划）：AI 库 `shares`=权威元数据+创建时正文快照+`view_count`；Redis 旁路；公开活读可回退快照；**dnhyxc-ai-admin** 直读同库做列表/Modal（仿学习笔记），M3 点进资源详情；放弃 Redis SCAN / Admin 复刻分表 resolve |
| [EPUB标注分层.md](./epub/EPUB标注分层.md)                                 | EPUB **用户划线 / 想法虚线 / 播放背景** 三层架构、sync 编排、分阶段验收                                                                                         |
| [EPUB标注epubjs基础.md](./epub/EPUB标注epubjs基础.md)           | 同上三层的 **epub.js 原语详解**：选区、文本提取、CFI、annotations、marks-pane                                                                                   |
| [讯飞云TTS.md](./tts/讯飞云TTS.md)                                   | **讯飞在线云端 TTS**（已上线）：三选一选路、Nest `ws` 代理、前后端架构/时序/分阶段                                                                              |
| [TTS合成结果缓存.md](./tts/TTS合成结果缓存.md) | **TTS 音频 Redis bytes 缓存**（前一版）：固定 TTL；云 Redis 大 value 延迟差 → **推荐改看** [TTS本地文件缓存.md](./tts/TTS本地文件缓存.md) |
| [TTS本地文件缓存.md](./tts/TTS本地文件缓存.md) | **TTS 落盘 uploads/tts + Cache 路径索引**（M0–M2 已落地）：**默认 TTL 30 天**；mtime 到期才删盘；预算/磁盘不够则跳过落盘并记 `logs`；禁止磁盘满删最早 |
| [EdgeTTS端点迁移.md](./tts/EdgeTTS端点迁移.md) | **Edge TTS 换包修挂死**（核心已落地）：旧 `edge-tts-universal`→bing 401；换 `@andresaya/edge-tts` + `generate()`；Controller/FE/L1·L2 缓存不动；M2 超时·429、M3 GPL/子进程备选 |
| [Edge机房握手.md](./tts/Edge机房握手.md) | **Edge 机房握手**（工作区已落地，待部署）：`api.msedgeservices.com` 回 HTTP 200；改走 bing + Sec-MS-GEC v2，失败再退回旧主机；不换 Azure，前端与缓存不动 |
| [TTS仅英语学习落盘.md](./tts/TTS仅英语学习落盘.md) | **TTS L2 仅英语学习**（核心已落地）：请求 `persistDisk` 默认 false；听书/朗读不写 Redis·uploads/tts；默认 TTL **30 天→6 个月（180d）**；英语 practice/词库等 opt-in |
| [TTS按资源库分目录.md](./tts/TTS按资源库分目录.md) | **TTS 按库隔离落盘**（§13 M4 已落地）：`vocab_<libraryId>/` + `_meta.json`；`cacheFolder`=稳定 scope，`cacheTitle` 旁路；旧标题目录 TTL GC |
| [EPUB滚动多iframe听书.md](./epub/EPUB滚动多iframe听书.md)   | **EPUB 连续滚动多 iframe 听书续播**（已上线）：问题根因、逐点改动清单、架构/时序/复现步骤、类似问题通用套路                                                     |
| [电子书阅读进度保存.md](./ebook/电子书阅读进度保存.md)           | **阅读进度保存**（已上线）：EPUB CFI / PDF 页码、三层防抖、keepalive flush、端到端架构与时序                                                                   |
| [知识预览助手性能.md](./knowledge/知识预览助手性能.md) | **知识库预览+助手同开卡顿**（已上线）：规划态思路；**归档见** [knowledge/知识预览助手性能.md](../knowledge/知识预览助手性能.md) |
| [知识库滚动卡顿修复.md](./knowledge/知识库滚动卡顿修复.md) | **知识库预览/助手滚动卡顿详细解决步骤**（已上线）：S0–S7 逐步问题→代码→意图→为何有效；**归档见** [knowledge/知识预览滚动卡顿.md](../knowledge/知识预览滚动卡顿.md)、[knowledge/知识预览代码工具条滚动.md](../knowledge/知识预览代码工具条滚动.md) |
| [知识库Skill编辑与Agent接入.md](./knowledge/知识库Skill编辑与Agent接入.md) | **Skill 页 + 知识库 AI→Agent SSE + `/` 选 Skill**（规划）；**硬约束不破坏知识库既有能力**；强制加载与 `apply_skill` 预置 |
| [Skill生成工件锚定.md](./knowledge/Skill生成工件锚定.md) | **Skill 生成按编辑器锚定**（核心已落地）：会话按 `mode:skillId`/`__draft__` 隔离、条件 `intentPrefix` 控 token、保存回填；**朗读/切会话修复归档** [Skill侧栏朗读与会话切换.md](../knowledge/Skill侧栏朗读与会话切换.md) |
| [Agent业务消息分表.md](./agent/Agent业务消息分表.md) | **Agent 通用调用 + 业务分表**：M0–M4 已落地 → [归档](../agent/Agent业务消息分表落地.md) |
| [EPUB公开想法下划线修复.md](./epub/EPUB公开想法下划线修复.md) | **公开书多人想法虚线叠层 bug**（已落地）：断续/双线根因、CFI 投影扣减、rank 叠层、排查手册 |
| [EPUB滚动卡顿性能.md](./epub/EPUB滚动卡顿性能.md) | **EPUB 连续滚动卡顿**（已上线）：双轨 patch 调度、rect 快路径、relocated 80ms 合并、叠层投影缓存、复杂度对比与调试手册 |
| [电子书公开想法实时同步.md](./ebook/电子书公开想法实时同步.md) | **公开书想法实时同步**（核心已上线）：/sync 增量、双轨触发、点击列表聚类 → **归档** [EPUB公开想法实时同步影响.md](../ebook/EPUB公开想法实时同步影响.md) |
| [电子书想法同步性能优化.md](./ebook/电子书想法同步性能优化.md) | **Sync 性能优化**（已上线）：P0 私有 gate、M8 SQL 增量、M6 deletedIds 软删、改前改后对照 |
| [电子书多用户想法视口性能.md](./ebook/电子书多用户想法视口性能.md) | **多人想法划线 + 视口性能**（已上线）→ **归档** [EPUB想法视口性能.md](../ebook/EPUB想法视口性能.md) |
| [EPUB目录章节顶部对齐.md](./epub/EPUB目录章节顶部对齐.md) | **EPUB 点击目录章首对齐**（规划）：连续滚动升级为 ResizeObserver 稳定性循环、分页新增章首 CFI 重排 + `break-before:column` 注入 |
| [微信小程序EPUB阅读器.md](./miniprogram/微信小程序EPUB阅读器.md) | **微信小程序 EPUB 电子书阅读器**（规划）：书架/EPUB 阅读/听书/想法/划线五大模块、web-view+epub.js 渲染方案、M1–M6 分阶段落地、与 Web 端数据互通 |
| [小程序EPUB解析逻辑.md](./miniprogram/小程序EPUB解析逻辑.md) | **小程序 EPUB 解析逻辑**（部分已落地）：后端 `parseEpubBuffer` 懒解析、COS 键兼容、章节 API、`mp-html` 消费与 409 轮询；M1–M2 已上线 → **归档** [小程序EPUB服务端解析.md](../ebook/小程序EPUB服务端解析.md) |
| [EPUB听书段落朗读.md](./epub/EPUB听书段落朗读.md) | **Web/桌面听书·听当前按段 TTS + 逐句高亮**（核心已落地）：规划脉络 → **归档** [ebook/EPUB听书段落朗读.md](../ebook/EPUB听书段落朗读.md) |
| [EPUB听书核心逻辑.md](./epub/EPUB听书核心逻辑.md) | **EPUB 听书核心实现逻辑梳理**（已上线）：架构/流程/时序/状态机 + **§14 相关实现完整源码**（PlayUnits/Paragraphs/Chapter/Hook/底栏/Overlay 等全文 + `speech.ts` 听书节选） |
| [EPUB听书播放优化.md](./epub/EPUB听书播放优化.md) | **听书播放优化**（主项已落地）：loading / 分句选中色 / 进度取整见 ebook 专题；总索引 [ebook/EPUB听书播放修复2026-07.md](../ebook/EPUB听书播放修复2026-07.md) |
| [富文本Kit抽包.md](./notes/富文本Kit抽包.md) | **富文本编辑+预览 npm 抽包**（规划）：新建 `@dnhyxc-ai/richtext-kit`（对齐 markdown-kit 子路径/Changesets）；迁 RichEditor/NotePreview/长文窗口；默认薄 UI + slots 解耦 shadcn/i18n；学习笔记改 import，Store/API 不进包 |
| [学习笔记富文本编辑.md](./notes/学习笔记富文本编辑.md) | **学习笔记富文本编辑器**（核心已上线）：Tiptap 3.x 封装、自定义 Title 节点、工具栏+气泡菜单、左右分栏布局、M1–M5 分阶段落地 → **归档** [english/学习笔记富文本编辑.md](../english/学习笔记富文本编辑.md) |
| [学习笔记编辑器预览卡顿.md](./notes/学习笔记编辑器预览卡顿.md) | **学习笔记编辑/预览卡顿**（已上线）：根因拆解、S1–S8（卸 TipTap、列表隔离、长文窗口化编辑/预览、延迟挂载等）、否决虚拟列表/iframe、带注释代码与原理 |
| [学习笔记独立弹窗.md](./notes/学习笔记独立弹窗.md) | **学习笔记独立弹窗与多窗口同步**（核心已上线）：Tauri 托管关窗（Rust `prevent_close` → `eval`/`emit` → 前端 await 保存 → `destroy`）、BroadcastChannel 跨窗同步总线（七类消息 + `windowId` 回声抑制 + `revision` LWW）、三层保存兜底（store autoSave → DOM await → keepalive）、HTTP 包装自动广播、DOM ponyfill 同步、外观跟随双通道、插件 monkey-patch；含架构/主流程/时序三图 + 全部源码逐行注释 + 分阶段 M1–M3 + 验收清单 → **归档** [english/学习笔记独立弹窗.md](../english/学习笔记独立弹窗.md) |
| [第三方联邦插件接入.md](./plugins/第三方联邦插件接入.md) | **第三方 MF 插件接入配置**（核心加载已上线）：对方 CORS 契约、`tauri://localhost`、registry 上架、capabilities 不加第三方域、双端验收与 `/mf-proxy` 兜底 |
| [模块联邦CSS隔离.md](./plugins/模块联邦CSS隔离.md) | **MF 主/子样式互不影响**（已落地）：构建期 scoped CSS vs 半套 Shadow 否决、`untrusted` iframe、验收清单 |
| [学习笔记列表导出.md](./notes/学习笔记列表导出.md) | **学习笔记列表导出 Word**（规划）：后端拉全量笔记合成单个 .docx、复用单篇 HTML→DOCX 管线、200 篇上限 + 图片预算共享、M1–M2 分阶段 |
| [学习笔记导出与编辑打磨.md](./notes/学习笔记导出与编辑打磨.md) | **DOCX 插图导出可靠化 + 长文编辑打磨**（核心已落地）：sharp@0.33.5 懒加载、foreign/webp→JPEG、长文自然高度/末窗落点、GapCursor/空段删除；含 C1–C13 改动点对照 |
| [学习笔记DOCX导出手册.md](./notes/学习笔记DOCX导出手册.md) | **学习笔记富文本导出 Word（DOCX）端到端实现手册**（已上线）：从零复刻教学手册；M1–M14 全链路（DB→builder→Service→Controller→拦截器短路→Host downloadBlob→HostBridge→iframe RPC→插件 API→MobX action→按钮 UI→TipTap 富文本→长文性能优化），含完整源码 + 逐行注释 + 验收清单 + 常见坑排查 |
| [学习笔记全面实现.md](./notes/学习笔记全面实现.md) | **学习笔记端到端全面实现手册**（已上线，从零复刻）：以 MobX 单例 Store 为中枢，串联 CRUD、分栏列表、编辑/预览切换、长文窗口化、图片上传会话防孤儿、跨窗草稿同步（BroadcastChannel + localStorage 共享原始基线仲裁脏标记）、DOCX 服务端导出；含分层架构图 + CRUD 主流程图 + 保存跨窗同步时序图 + 编辑/预览状态机四图 + 13 个核心模块完整源码逐行注释 + M1–M7 分阶段落地 + 验收清单；DOCX 链路逐行讲解见 [学习笔记DOCX导出手册.md](./notes/学习笔记DOCX导出手册.md) |
| [电子书插件动态集成.md](./ebook/电子书插件动态集成.md) | **主项目 Ebook 插件动态接入**（核心已上线）：从零复刻端到端实现手册；Host Surface 发现机制、模块级单例 handlers 冻结代理、MF runtime + 共享 React 单例、PluginManager 生命周期、createHostBridge 按权限装配、Iframe RPC + 同步 getter 预取改写、`@scope` 样式隔离、i18n 双轨同步；M1–M8 分阶段 + 23 章节 + 完整源码逐行注释 + 验收清单 + 排查手册 |
| [Tauri剪贴板富文本粘贴.md](./tauri/Tauri剪贴板富文本粘贴.md) | **Tauri 桌面端剪贴板（文本/图文混合/图片/文件列表）**（已上线）：全局 keydown 接管 C/V/X/A、Rust arboard 读 HTML/位图/文件列表、四种 flavor 并行读 + 四级降级插入、TipTap parseSlice、React 受控输入同步、Web 端 ImageUpload handlePaste；含架构/流程/时序三图 + 完整源码逐行注释 + 验收清单 |
| [Tauri窗口缩放揭示.md](../tauri/Tauri窗口缩放揭示.md) | **macOS 窗口缩放零露白**（已落地）：swizzle `NSWindow.zoom:`、目标尺寸预布局 + 顶对齐 cover + 窗口揭开、dispatch2 帧循环、注入 JS 钉 `#root`/body 尺寸、首帧立刻 tick、移除 `background-attachment:fixed`；含架构/主流程/时序三图 + 完整源码逐行注释 + 几何数学 + 验收/排查清单 |
| [Tauri系统菜单快捷键.md](../tauri/Tauri系统菜单快捷键.md) | **系统菜单 + 全局/页面快捷键体系**（已上线）：store 为唯一真相源串起菜单加速键/全局热键/页面快捷键三类；IconMenuItem 运行时 `set_accelerator` 可改键、失焦反注册（显隐应用例外）、改键前 `clear_all_shortcuts` + `SHORTCUT_HANDLING_ENABLED` 双保险防误触、前端 `chordStringsSemanticallyEqual` 写法归一化冲突检测、页面键 `registerGlobally=false` 仅 store+DOM、macOS 编辑菜单系统项三延迟点中文化；含架构/改键流程/触发时序/失焦时序四图 + 完整源码逐行注释 + 键 ID 编排表 + 验收/排查清单 |
| [Vue插件HMR桥接.md](./plugins/Vue插件HMR桥接.md) | **Vue 插件桥接与 HMR 保障**（规划→已落地）：React Host 加载 Vue Remote 插件，Host 零 Vue 依赖，Remote 自管 `createApp` 生命周期；解决 MF 下 `optimizeDeps` 预打包冲突、双实例、React 重渲染劫持三大 HMR 根因；含架构图 + 主流程图 + HMR 时序图 + 分阶段落地与验收清单 |
| [模块联邦样式隔离实现.md](./plugins/模块联邦样式隔离实现.md) | **微前端样式隔离实现思路**（核心已落地）：Host 侧「选择器前缀 + CSSOM insertRule patch + Portal body 收编」三层架构，覆盖静态 CSS / CSS-in-JS / body 弹层 / HMR / 同 Remote 多插件共享 realm / 嵌套插件引用计数 / Host 关键样式保护 / untrusted iframe 兜底；含架构图 + 主流程图 + 时序图 + 完整 TS 代码逐行中文注释 + 分阶段落地 + 验收清单 + 读者 5 步复用方案 |
| [联邦工具提取.md](./plugins/联邦工具提取.md) | **微前端通用包 `@dnhyxc-ai/federation-kit` 抽离**（落地中）：内核 + HostCapabilities DI、style-isolation / react 子路径、本仓薄适配层、M0–M5 与兼容 barrel；任意项目可接入 |
| [非会员Token用量限制.md](./非会员Token用量限制.md) | **非会员 token 按模型记账（Chat + 向量）**（规划）：已确认免费白名单 `glm-4.7-flash` / `BAAI/bge-large-zh-v1.5` / `BAAI/bge-reranker-v2-m3`；计费模型共用 billable 额度；超额 Confirm |
| [经典句整集标注预热.md](./english/经典句整集标注预热.md) | **经典句库/Pack 一键标注预热**（SSE 已落地）：前端只传源 id；后端分批 LLM + **SSE 进度**（start/progress/complete）；≤6000 一次取句、>6000 批读；不含收藏/错题入口 |
| [整集标注省Token.md](./english/整集标注省Token.md) | **整集标注省 Token**（规划）：不改 SSE/验收/落库/练习契约；窗口清 priorThread + 入参/出参去冗余；M1–M3 主路径、M4 封闭词可选 |
| [标注任务持久化续跑.md](./english/标注任务持久化续跑.md) | **标注任务持久化与暂停继续**（核心已落地）：任务表+再开 SSE/句缓存 hit；暂停 force 快照、Token seed 累计；failed>0→部分失败可 resume；不含离线 Job |
| [语句库导出JSON.md](./english/语句库导出JSON.md) | **语句库 / 拉取历史导出 JSON**（规划）：行内按钮、复用 items 分页拉全、`saveFileWithPicker` 存原句四字段；不含单词库与词性标注 |
| [词库设为公共.md](./english/词库设为公共.md) | **单词库 / 语句库设为公共**（规划）：读侧/`is_public` 已有；放宽为所有者自助 + 列表公共按钮；对齐知识库 Owned‖SuperAdmin |
| [词库导出Word.md](./english/词库导出Word.md) | **单词库 / 语句库导出 Word**（规划/已部分落地）：复用收藏 DOCX builder；整库分页装载；JSON 入口保留 |
| [收藏错题全量导出Word.md](./english/收藏错题全量导出Word.md) | **收藏 / 错题 / 今日复习全量 Word**（规划）：去掉 3000 静默截断；分页装载全量；安全硬顶 + 大集合可选异步 Job |
| [英语学习DOCX导出.md](./english/英语学习DOCX导出.md) | **收藏 / 错题 / 今日复习导出 Word**（核心已落地）：共用 builder、`POST …/export-docx`；现网全量仍≤3000，全量改造见上篇 |
| [语句库标注手动导入.md](./english/语句库标注手动导入.md) | **标注按钮 hover 二选菜单**（核心已落地）：在线走 SSE；手动导入对齐 `batch2`（可**部分句**、忽略 `id`）→ `cache_key` upsert；不要求覆盖库/Pack 全集 |
| [练习题量上限对齐.md](./english/练习题量上限对齐.md) | **单场练习硬顶统一 100**（核心已落地）：`ENGLISH_PRACTICE_SESSION_MAX` ↔ `PRACTICE_MAX_WORDS`；覆盖复习/记词队列、结算 attempts、错题 batch、开局标注 batch |
| [短语词槽标注.md](./english/短语词槽标注.md) | **多词短语词槽挂载**（核心已落地）：`phr.n.` → 名词短语；音标段数等于词数才拆到各槽；词性与释义整组居中，不改分词、不调标注模型 |
| [练习报告存档.md](./english/练习报告存档.md) | **练习报告入库与回看页**（核心已落地）：Setup 手动/自动、`POST …/reports`、列表/详情；同 id 覆盖续写见续篇 |
| [练习多轮结算与报告续练.md](./english/练习多轮结算与报告续练.md) | **继续练习多轮明细 + 报告 rounds + 详情续练**（核心已落地）：`sessionRounds`、`sourceMeta`、同 reportId upsert、`resumeFromReport`；今日记词已对齐 |
| [今日记词与今日复习.md](./english/今日记词与今日复习.md) | **今日记词 → 今日复习入队**（核心已落地）：整场词入复习调度、不自动写错题；内容 `mistake ∪ daily_record`（优先错题）；`markReviewDueNow` 与加错题重置分离 |
| [听写TTS分批预取.md](./english/听写TTS分批预取.md) | **听写/拼写云端 TTS 预取**（核心已落地）：首题 stream + 出声后 `speech/batch`；每批 5 条**未启动**题；会话 LRU=100；修「已预取占窗口→一句一批」 |
| [练习听写请求防阻塞.md](./english/练习听写请求防阻塞.md) | **听写防阻塞定稿**：Abort + 应用层超时 + TTS 复用 CACHE_MANAGER/配额/mtime GC + 标注两步预热；含 §14 TTS·Redis·配额、§15 标注详解；**不改**验证码/Bull 连接 |
| [练习草稿按库分槽.md](./english/练习草稿按库分槽.md) | **练习续档按库/来源分槽**（已落地）：`active`=`kind:source:id`；多库草稿并存互不覆盖；今日记词保持 `el-daily-draft` 独立 |
| [练习与记词独立路由续档.md](./english/练习与记词独立路由续档.md) | **练习 + 今日记词**独立路由续档（**M1–M6 已落地**）：分槽续档；practice Setup + **daily Intro** 续练联动（模式写回/回显；题量·词数 Confirm 清档） |
| [拼写IME回车防跳题.md](./english/拼写IME回车防跳题.md) | **拼写中文输入法回车防跳题**（核心已落地）：compositionend 一拍 `imeConfirmGuard` + 全局 capture 过滤；上屏停全对结果态，再按 Enter 才下一题 |
| [每日阅读.md](./english/每日阅读.md) | **语句库下方每日阅读**（规划）：侧栏独立卡片；前一天 21:00 用 BullMQ 生成、当天再展示；独立列表页与详情页；`playPreferred` 朗读英文 |
| [每日阅读设置.md](./english/每日阅读设置.md) | **每日阅读设置页**：入口「生成资源」、页标题「资源生成配置」；联网按钮为「开启智能搜索 / 关闭智能搜索」；加载中 `contentLayout=fill` 让 Loading 居中覆盖内容区 |
| [每日阅读手动生成.md](./english/每日阅读手动生成.md) | **设置页底栏手动生成**（规划）：同步另插一篇 `slot` 行，发布日为今天所以立刻进列表；不覆盖定时篇，未保存不能生成 |
| [每日阅读流式生成.md](./english/每日阅读流式生成.md) | **手动生成改 SSE**（规划）：`streaming: true` + 模块级 Store；离开页面不断流；刷新靠 `sessionStorage` 保持按钮生成中，再续上同一条流，不再定时查 pending |
| [每日阅读流式防卡.md](./english/每日阅读流式防卡.md) | **手动生成白屏**（规划）：对齐英语 Agent——一帧就地写正文、只有预览订阅全文；生成中继续 `StreamingMarkdownBody`，未闭合围栏只换代码节点，闭合后冻住；不改 SSE |
| [刷新续接生成流.md](./english/刷新续接生成流.md) | **刷新后续接同一条模型流**（规划）：生产者与 SSE 拆开，按序号重放再实时听；手动任务只能改自己的 pending 行，不能清空已在列表里的 ready 篇 |
| [每日阅读来源切换.md](./english/每日阅读来源切换.md) | **列表按系统日推 / 手动生成分栏**（已落地）：收藏页同款下拉 + `?origin=`；详情面包屑带回手动栏；下拉无聚焦框 |
| [详情侧栏阅读列表.md](./english/详情侧栏阅读列表.md) | **详情页左侧阅读列表**（已按思路落地）：默认关闭；继续生成旁图标打开；`ResizablePanel` 分栏；`OriginMenu` 切系统日推 / 手动 |
| [每日阅读播放句高亮.md](./english/每日阅读播放句高亮.md) | **播放当前句高亮 + 句下中文**（规划）：`onCadenceChunk` + `buildSentenceOffsetSpans` SSOT；React CSS 高亮（对齐书库浅绿）；`sentenceZh` 优先、旧篇启发式兜底；不搬 EPUB SVG |
| [每日阅读按用户生成.md](./english/每日阅读按用户生成.md) | **已放弃**：定时生成不传 userId，继续用环境变量默认模型；不按用户拆篇，也不把某个人的 Key 用来写全站短文 |
| [每日阅读超管配置.md](./english/每日阅读超管配置.md) | **自动档仅超管可写**：壳标题「资源生成配置」；超管两块分别为「手动生成配置」「自动生成配置」；21:00 读自动档 |
| [日推入队时刻.md](./english/日推入队时刻.md) | **系统日推按超管整点入队**（已落地）：默认 23:00 上海；列表不再入队明天；只补已过点且未发布的一天 |
| [阅读档位随机.md](./english/阅读档位随机.md) | **难度 / 篇幅 / 侧重 / 理解题可随机**（已落地）：设置记住随机；每次生成再抽具体档；侧重含附词汇加语法 |
| [弱模型补单词释义.md](./english/弱模型补单词释义.md) | **flash 漏词再补一次**（规划）：仅 `glm-4-flash` / `glm-4.7-flash` 且释义不全时，同一模型只补 `wordGloss`；不重写正文，付费模型仍一次调用。截断场景改看下篇 |
| [阅读截断补释义.md](./english/阅读截断补释义.md) | **输出顶满 8192 时拆开短文与释义**（规划）：第一次不要 `wordGloss`；释义截断则抢救已闭合句，缺句每批 4 句；释义不齐也发布。历史行标题只读第一段短文 JSON |
| [阅读附件分请求.md](./english/阅读附件分请求.md) | **词汇 / 语法 / 理解题移出短文 JSON**（规划）：短文合格后另一次要附件；截断则抢救已闭合项，整类为空只补一次；附件失败仍发布。所有模型，不提高 8192 |
| [阅读语法说明.md](./english/阅读语法说明.md) | **语法须讲本文结构**（规划）：`point` + 正文摘录 + 含「表示/用于」的用法；翻译句丢掉后再要一次；旧字符串只读展示 |
| [阅读分路并行.md](./english/阅读分路并行.md) | **附件与序号释义并行**（已落地）：§3.3 对照调用次数。§3.4 段落后面缺词只补缺词，每批最多 4 句 |
| [阅读限流重试.md](./english/阅读限流重试.md) | **避免账户 429**（已落地）：同一篇生成的模型请求串行；只在 429 时退避重试这一次，然后继续后面的缺词批 |
| [阅读生成历史.md](./english/阅读生成历史.md) | **设置页生成历史**（规划）：终态快照进本机、按用户分桶；历史图标在生成按钮右侧；点记录打开资源生成信息弹窗；进行中行右侧 loading。行标题只解析第一段已闭合的短文 JSON |
| [手动阅读按用户隔离.md](./english/手动阅读按用户隔离.md) | **手动篇只给本人**（规划）：`user_id` 可空；列表和详情为定时篇或当前用户的手动篇；无主旧手动篇不展示 |

**生成 Skill**：主仓 `dnhyxc-ai/.cursor/skills/feature-implementation-idea/SKILL.md`（默认落盘根目录：**本目录**）

**与正式文档边界**：

- 实现归档、改动前后对比 → **本目录上一级功能域**（如 `wiki/knowledge/`、`wiki/ebook/`；Skill：`implementation-doc-from-diff`）
- 开发者符号手册 → 主仓 `docs/ebook/developer/`（若仍用该 Skill）
- 改动影响面 → `wiki/impact/` 或 `wiki/Influence-point/`
- **规划态实现思路** → **本目录**（`remote-docs/wiki/ideas/`），不再写入主仓 `docs/ideas/`
