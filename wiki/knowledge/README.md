# 知识库专题文档

路径前缀：`apps/frontend` 知识页 + `apps/backend` 知识/RAG 模块。

---

## 总览与权威长文

| 文档 | 说明 |
|------|------|
| **[知识库助手完成.md](./知识库助手完成.md)** | 右侧 Assistant **总览**（状态机、SSE、持久化、UI） |
| [硅基对话统一.md](../llm/硅基对话统一.md) | 助手 / RAG / 主 Chat **LLM 接入**（硅基 + ChatOpenAI） |
| [知识RAG后端实现.md](./知识RAG后端实现.md) | RAG 后端实现 |
| [硅基向量完整URL.md](./硅基向量完整URL.md) | **向量完整 URL**（`SILICONFLOW_EMBEDDING_URL` / 分片档位 / 入库 400 修复） |
| [知识向量创建LLM.md](./知识向量创建LLM.md) | **向量 embedding/rerank 凭证**收敛至 `create-llm` |
| [知识会员向量分层.md](./知识会员向量分层.md) | **会员 Qwen3 向量 + 双 collection 检索**（兼容 1024 存量） |
| [用户向量RAG配置.md](./用户向量RAG配置.md) | **用户向量设置 + 多库 RAG**（独立保存、profiles 累积、系统默认 bge 始终检索） |
| [向量BGE全局轮次.md](./向量BGE全局轮次.md) | **全站仅 BGE**、入库分批/Unicode、会员默认 4B 库、设置页保存与表单 |
| [知识分块边界.md](./知识分块边界.md) | **向量分片语义边界**（代码围栏、按行切、`console.log` 防截断） |
| [知识分块死循环内存溢出.md](./知识分块死循环内存溢出.md) | **分片死循环 / OOM**（`splitByLinesOnly` overlap 不前进、`KNOWLEDGE_CHUNK_MAX_PIECES`） |
| [知识RAG问答助手前端.md](./知识RAG问答助手前端.md) | RAG 问答前端 |
| [RAG检索NestJS React Qdrant.md](./RAG检索NestJS React Qdrant.md) | Qdrant 检索链路 |

---

## 助手：问题修复与专题

| 文档 | 说明 |
|------|------|
| [知识库助手Mermaid流式.md](./知识库助手Mermaid流式.md) | 流式 ` ```mermaid ` 不出图 |
| [知识库助手跨文档流式.md](./知识库助手跨文档流式.md) | 切文档后流式状态丢失 |
| [知识库助手临时持久化.md](./知识库助手临时持久化.md) | 未保存草稿 ephemeral |
| [知识库助手提示卡片.md](./知识库助手提示卡片.md) | 快捷卡片 |
| [知识库助手大纲目录前置.md](./知识库助手大纲目录前置.md) | 「生成目录」文首写入 / 补 `## 目录`（三分支） |
| [知识库助手流式体验.md](./知识库助手流式体验.md) | 流式：隐藏思考链、Spinner 动画 |
| [知识库助手布局滚动条对齐.md](./知识库助手布局滚动条对齐.md) | 滚动条对齐 |
| [助手流式结束滚动定位.md](./助手流式结束滚动定位.md) | **流式结束后误滚底**（idleFlushKey / userPinnedAway / 条带 flush） |
| [知识编辑器发送选区助手去重.md](./知识编辑器发送选区助手去重.md) | 选中发送到助手去重 |
| [助手插入焦点.md](./助手插入焦点.md) | 复制到助手后自动聚焦输入框（右键 + 快捷键） |
| [知识库助手插入选区AI检索.md](./知识库助手插入选区AI检索.md) | 选中写入 AI/RAG 输入框 |
| [知识库助手多会话前端实现.md](./知识库助手多会话前端实现.md) | 多会话前端 |
| [知识库助手多会话后端实现.md](./知识库助手多会话后端实现.md) | 多会话后端 |
| [知识库Skill对话.md](./知识库Skill对话.md) | **Skill `/` 多选 + Agent SSE**：`sendMessageWithAgentSkills`、`memorySource` assistant/agent、`appliedSkills`、标题与停流链接；不再 `append-turn` 双写 |
| [已应用Skill落库.md](./已应用Skill落库.md) | **「已应用 Skill」持久化**：`applied_skills` 列、流前早写、详情回读、草稿 `import-transcript` 透传；刷新后 tip 仍在 |
| [Skill编辑试跑.md](./Skill编辑试跑.md) | **独立 Skill 管理页** `/skills`（列表 / Monaco / 试跑·生成）：CRUD、`skill_try_sessions`、`memorySource=skill_try`；与知识库 `/` 对话解耦 |
| [Skill侧栏朗读与会话切换.md](./Skill侧栏朗读与会话切换.md) | **Skill 侧栏**：朗读条抬到页面防 remount 误断；`mode:skillId` 分桶；切 Skill/模式/历史显式停播 |
| [Skill生成工件锚定.md](../ideas/knowledge/Skill生成工件锚定.md) | **生成模式按编辑器锚定**（规划→实现）：会话隔离、条件 intentPrefix、保存回填、M4 mode 分桶 |

`知识库助手完成.md` 文首「问题修复记录」汇总上述链接；新增修复文时请同步该节。

---

## 编辑器、本地与导入

| 文档 | 说明 |
|------|------|
| [知识库文件夹树.md](./知识库文件夹树.md) | **本地文件夹目录树**：可展开层级浏览、空目录过滤、键盘可达 |
| [知识列表在访达中显示.md](./知识列表在访达中显示.md) | **列表行「在访达中显示」按钮**：新增 `revealItemInDir` 封装 Tauri `plugin:opener\|reveal_item_in_dir`；`KnowledgeListRow` 新增 `FolderSearch` 按钮（编辑器按钮左侧）；`actionCount` / `hoverPr` 从嵌套三元式重构为 `ROW_HOVER_PR` 数组查表；中英文 i18n（含改动前/后成对对比与 100% 逐行注释） |
| [知识库列表搜索标题.md](./知识库列表搜索标题.md) | **列表与回收站按标题搜索**：搜索框 + Enter 提交、云端不区分大小写、本地命中自动展开目录 |
| [知识库分类管理.md](./知识库分类管理.md) | **自定义分类**：新建 / 重命名 / 删除 / 排序、行内归入分类、按 Tab 筛选、首次自动播种 5 个默认分类（中英文不同） |
| [知识库公开文档Tab筛选.md](./知识库公开文档Tab筛选.md) | **「公开」Tab + 全部角标修正**：分类栏新增仅他人公开的 Tab（> 0 条时显示）；「全部」角标=本人+公开总数；后端 scope 参数互斥；派生 `safeTotal` + `listAllCount` 与条目级 `itemMatchesActiveCategory` 对齐 |
| [本地文件夹与Monaco同步.md](./本地文件夹与Monaco同步.md) | |
| [知识Markdown导入.md](./知识Markdown导入.md) | |
| [自动保存.md](./自动保存.md) | |
| [知识保存格式化前置.md](./知识保存格式化前置.md) | 保存 / 自动保存前先格式化再落库 |
| [知识保存正文限制.md](./知识保存正文限制.md) | 云端保存请求体上限与 DTO 对齐（修复 PayloadTooLargeError） |
| [知识编辑器长文本性能.md](./知识编辑器长文本性能.md) | **长文编辑性能**：纯 edit 停喂隐藏预览、Store 派生 boolean、助手输入内化 |
| [知识预览助手性能.md](../ideas/knowledge/知识预览助手性能.md) | **预览+助手同开**：SSE rAF 合并、消息列隔离、busy latch、预览加载态 |
| [知识预览滚动卡顿.md](./知识预览滚动卡顿.md) | **长预览滚动卡顿**：FAB 去重、岛屿 HTML memo、toolbar enabled、流式贴底 rAF 合并；步骤手册见 [../ideas/知识库滚动卡顿修复.md](../ideas/knowledge/知识库滚动卡顿修复.md) |
| [知识预览代码工具条滚动.md](./知识预览代码工具条滚动.md) | **长文多代码块预览滚动**：吸顶栏块列表缓存、二分定位、O(1) 清 pinned；影响点见 [../impact/知识预览代码工具条滚动.md](../impact/知识预览代码工具条滚动.md) |
| [快捷键.md](./快捷键.md) | |
| [未认证仅本地.md](./未认证仅本地.md) | |

---

## 列表与排序

| 文档 | 说明 |
|------|------|
| [公开优先排序](./公开优先排序.md) | **知识库/电子书列表公开优先排序**：后端 SQL `isPublic DESC` + 前端内存稳定排序双层对齐；电子书非本人书不可改分类守卫 |
| [知识库公开文档Tab筛选.md](./知识库公开文档Tab筛选.md) | **「公开」Tab 筛选 + 列表/分类/公开归属一致性**：配套专题，含后端 scope、前端 store、UI Chip 注入的完整改动前/后对比与逐行注释 |
| 延伸：[书架知识库分页常量归一化.md](../app/书架知识库分页常量归一化.md) | **分页常量出处收敛**：`EBOOK_SHELF_PAGE_SIZE` → 全局 `DEFAULT_PAGE_SIZE`；知识库 Store 删除私有分页/阈值常量 |

---

## 相关（包外）

- Markdown / Mermaid 工具包：[../tools/索引.md](../tools/索引.md)
- Monaco 预览：[../monaco/](../monaco/)
- Mermaid UI：[../mermaid/](../mermaid/)

上级索引：[../README.md](../README.md)
