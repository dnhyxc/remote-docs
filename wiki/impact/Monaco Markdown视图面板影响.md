# 知识库 Markdown 预览/编辑与助手 Panel — 影响点分析

## 延伸阅读

- [Markdown视图面板滚动.md](../monaco/Markdown视图面板滚动.md) — 实现思路与改动前后代码对比
- [Markdown分屏滚动同步.md](../monaco/Markdown分屏滚动同步.md) — 分屏左右跟随滚动（本改动复用其 sync 工具，未改算法）
- [Markdown底部栏.md](../monaco/Markdown底部栏.md) — 底部操作栏与快捷键入口
- [Markdown分屏差异对比.md](../monaco/Markdown分屏差异对比.md) — Diff 对照模式
- [知识编辑器长文本性能.md](./知识编辑器长文本性能.md) — 长文编辑性能优化对知识库编辑/助手的影响面

**阅读约定**：结论以仓库 **当前源码** 为准；「历史风险」指旧实现曾出现的问题，不代表现行代码仍会触发。

## 1. 分析目的

评估 **Monaco `MarkdownEditor` 在 preview / edit / split / splitDiff 与文档助手 Panel 组合下的布局与滚动行为调整**，是否改变或破坏已有功能：

- 知识库 Markdown 编辑、保存、自动保存、Diff 对照
- 分屏（split）左编右预览及**跟随滚动**（`splitScrollFollowMode`）
- 文档助手（受控 `markdownAssistantOpen`、选区发送、多轮会话）
- 纯预览 / 纯编辑 / 底部栏与全局快捷键
- 非 Markdown 语言编辑器路径（如英语学习 JSON 预览）
- 预览 TOC / hash 锚点跳转（依赖 `previewViewportRef`）
- 换篇（`documentIdentity`）时的 viewMode / 助手 / 滚动重置

**改动范围（当前 diff，业务源码）**：

| 文件 | 变更 |
|------|------|
| `apps/frontend/src/components/design/Monaco/index.tsx` | 新增 `markdownRightPaneVisible`、左栏 preview/edit 双挂载、`setViewMode` 包装与 scroll sync layout effect；删除「开助手强制 split」；右侧 preview 仅 `split` 渲染 |
| `apps/frontend/src/components/design/Monaco/MarkdownBottomBar.tsx` | 编辑/预览按钮点击不再 `closeMarkdownAssistant()` |
| `apps/frontend/src/hooks/useMarkdownBottomBarShortcuts.ts` | `markdownBarAction1` / `markdownBarAction3` 同上 |

（同轮另有 `docs/`、姊妹稿与 `/update-info` 结构化数据更新，不改变运行时逻辑。）

**结论摘要**：

| 维度 | 是否影响原有功能 | 说明 |
|------|------------------|------|
| 纯 preview / 纯 edit（无助手） | **有条件变化** | 纯 preview 修复为全宽（不再右侧空预览）；preview/edit 左栏 co-mount，DOM 与内存略增 |
| 分屏 split + 跟随滚动 | **否** | split 分支仍为左编右预览；`splitPreviewScrollSyncEligible` 与 scroll handler 未改语义 |
| Diff 对照（splitDiff） | **否** | 进入/退出 Diff 仍 `closeMarkdownAssistant()`；Diff 模型 dispose 时序未动 |
| 开/关文档助手 | **是**（产品语义变更） | 开助手不再强制 split；关助手时 preview 态保留（旧版一律回 edit） |
| 预览 ↔ 编辑（助手已开） | **是**（产品语义变更） | 切换不再关闭助手；左栏随 mode 在预览/Monaco 间切换 |
| preview ↔ edit 滚动位置 | **低（增强）** | 新增 layout sync；极端长文/图表仍可能略有偏差（与分屏 sync 同工具） |
| 底部栏 split / Diff / 助手按钮 | **否** | 进入 split 仍关助手；Diff 切换逻辑未改 |
| 知识库保存 / 自动保存 / MobX | **否** | `value` / `onChange` / `getMarkdownFromEditorRef` 对外契约未变 |
| 选区发送到助手 | **否** | `onInsertSelectionToAssistant`、右键菜单未改 |
| 非 Markdown 编辑器（JSON 等） | **否** | `isMarkdown === false` 仍走单栏 `Editor`，未进入 PanelGroup |
| 英语学习导入预览 | **否** | `language="json"`、`enableMarkdownBottomBar={false}`，不触达 Markdown 双栏路径 |
| 换篇 `documentIdentity` | **否** | 换篇关助手、退出 splitDiff、滚动清零等既有 effect 保留；新增 `pendingSplitPreviewScrollTopRef` 一并清零 |

---

## 2. 改动要点（相对改前行为）

### 2.1 右栏可见性与内容

**改前**：

```text
preview 时 viewMode !== 'edit' → 右栏 Handle 展开
右栏 fallback 始终渲染 ParserMarkdownPreviewPane（非助手、非 Diff）
→ 纯 preview 出现「左预览 + 右空预览」双栏
```

**改后**：

```text
markdownRightPaneVisible = 助手开 | split | splitDiff
纯 preview/edit 且无助手 → layout { editor:100, right:0 }
右栏 preview 仅在 viewMode === 'split' 且非助手时渲染
```

**动机**：修复纯预览占位；助手与 preview/edit 左栏内容解耦。

### 2.2 助手与 viewMode

**改前**：

```text
markdownAssistantOpen 变为 true → useEffect 强制 setViewMode('split')
关助手 → setViewMode('edit')
预览/编辑按钮 → closeMarkdownAssistant() 再切 mode
```

**改后**：

```text
开助手 → 不改 viewMode
关助手 → preview 保持 preview，否则 edit
预览/编辑按钮与 action1/action3 → 仅 setViewMode，不关助手
进入 split / Diff → 仍 closeMarkdownAssistant()（未改）
```

**动机**：助手 Panel 与阅读/编辑模式正交；避免切换视图时误关助手。

### 2.3 左栏 DOM 与滚动

**改前**：

```text
preview 与 edit 互斥挂载（切换卸载 DOM）
deferredPreviewMarkdown 供预览
```

**改后**：

```text
Markdown 统一 ResizablePanelGroup
preview/edit：左栏预览 + Monaco 叠放（invisible 切换）
leftPreviewMarkdown = value（即时）
viewMode 变化 → useLayoutEffect 调用 syncEditorScrollFromMarkdownPreview / syncPreviewScrollFromMarkdownEditor
split → preview：setViewMode 内缓存 scrollTop
```

**动机**：切换时保留可测量的 preview viewport，对齐阅读进度。

---

## 3. 影响点矩阵

| 模块 / 场景 | 影响等级 | 分析 |
|-------------|----------|------|
| **知识库 `index.tsx` + `KnowledgeAssistant`** | 中 | 主消费方：受控 `markdownAssistantOpen` 仍由父组件管理；**用户可见**：preview+助手、edit+助手 为新组合。助手会话、`documentIdentity` 绑定、`onInsertSelectionToAssistant` 调用链未改 |
| **纯 preview（无助手）** | 中 | **修复**：全宽单预览；改前右侧空 pane 为历史缺陷 |
| **纯 edit（无助手）** | 低 | 右栏折叠与改前一致；左栏 co-mount 多隐藏预览 DOM，编辑行为不变 |
| **split + 跟随滚动** | 无 | `viewMode === 'split'` 时左仅 Editor、右 preview；`splitPreviewScrollSyncEligible` 仍要求 `!assistantRightPaneActive`；onScroll RAF 路径未删改 |
| **splitDiff** | 无 | 右栏 DiffEditor；进入 `toggleMarkdownSplitDiffCompare` 仍关助手并 `setViewMode('splitDiff')` |
| **底部栏「分屏」按钮** | 无 | 仍 `closeMarkdownAssistant()` 后 toggle split/edit；与助手互斥策略保持 |
| **快捷键 action2 / action4 / split 相关** | 无 | Diff、助手、分屏 chord 仍走原 handler；仅 action1（编辑）、action3（预览）去掉关助手 |
| **Monaco `handleEditorMount` focus** | 低 | `viewModeRef.current !== 'preview'` 才 focus；preview 下 co-mount 编辑器不抢焦点，有利于预览阅读 |
| **预览 hash / TOC 跳转** | 低 | 左栏 co-mount 仍通过 `viewportRef={previewViewportRef}` 挂载；`useMarkdownHashLinkViewportScroll` 等外部 hook 若依赖 preview 容器，应仍在左栏 preview 上生效；需在长文 spot check |
| **Mermaid / 预览渲染** | 低 | `leftPreviewMarkdown` 即时值，preview 切换时可能比 deferred 略多重绘；split 仍用 `splitPaneMarkdown` |
| **IME / 中文输入** | 低 | co-mount 隐藏编辑器仍驻 DOM；preview 模式无 focus，IME 主要在 edit/split 触发，需回归中文输入 |
| **性能（长文 co-mount）** | 低 | preview/edit 同时保留 Monaco + 预览 DOM；split/Diff 无额外叠层；较改前 preview↔edit 切换时内存占用略增 |
| **英语学习 JSON 预览** | 无 | `language !== 'markdown'` → `!isMarkdown` 单栏路径，diff 未触达 |
| **回收站 / `documentIdentity` nonce** | 无 | 换篇 effect、助手关闭、`splitDiff` 退出逻辑仍在；新增 pending scroll ref 在换篇 layout effect 中清零 |

---

## 4. 潜在风险与缓解

| 风险 | 等级 | 说明 | 建议验证 |
|------|------|------|----------|
| preview↔edit 滚动仍不对齐 | 中 | 依赖 co-mount + microtask/rAF sync；图表/Mermaid 异步增高时可能偏移 | 长文含 Mermaid，章节中间来回切换 preview/edit |
| co-mount 隐藏编辑器仍响应部分事件 | 低 | `pointer-events-none` + preview 无 focus；极端浏览器差异 | preview 模式下点击、选择、快捷键是否误触编辑器 |
| 助手 + preview 时右栏无预览 | 中 | **预期行为**；用户若习惯「开助手=split」需产品说明 | 开助手前在 preview，确认左预览右助手 |
| 关助手后仍停留在 preview | 低 | 新语义；旧版会回 edit | 全屏 preview 开助手再关，应仍在 preview |
| split→preview 滚动丢失 | 低 | `pendingSplitPreviewScrollTopRef` + layout apply | 分屏滚到中部再切全屏 preview |
| 内存略增（双 DOM） | 低 | 仅 markdown preview/edit mode | 超大文档打开后看 DevTools Memory（可选） |

---

## 5. 未改动项

| 项 | 说明 |
|----|------|
| `MarkdownEditorProps` 对外 API | props 签名未增删；`markdownAssistantOpen` 仍可选受控 |
| `syncEditorScrollFromMarkdownPreview` / `syncPreviewScrollFromMarkdownEditor`（`utils.ts`） | 算法与导出签名未改 |
| 分屏跟随模式四态 | `splitScrollFollowMode` 按钮与快捷键仅在纯 split 显示 |
| Diff 准入 `isMarkdownDiffEntryEligible` | 底部栏 Diff 禁用规则未改 |
| 自动保存 / 覆写保存 / 剪贴板 adapter | 与 viewMode 无耦合 |
| 进入 split / Diff 时关助手 | `MarkdownBottomBar` split 按钮、`toggleMarkdownSplitDiffCompare` 仍调用 `closeMarkdownAssistant` |
| 非 Markdown 单栏 Editor | `!isMarkdown` 分支独立，未合并进 PanelGroup |
| 知识库 MobX `knowledgeStore.markdown` | 数据流仍为受控 `value` / `onChange` |

---

## 6. 回归清单

- [ ] 知识库：纯 preview 全宽，无右侧「预览内容为空」
- [ ] 知识库：纯 edit，右栏折叠，编辑/保存正常
- [ ] 知识库：split，左编右预览，双向/单向跟随滚动仍有效
- [ ] 知识库：splitDiff 进入/退出，对照内容与 sticky scroll 正常
- [ ] 知识库：开助手（preview 态）→ 左预览右助手，不切 split
- [ ] 知识库：开助手（edit 态）→ 左编右助手
- [ ] 知识库：助手开着，底部栏/快捷键切换 preview↔edit，助手不关
- [ ] 知识库：助手开着切换后，选区「发送到助手」仍可用
- [ ] 知识库：关助手（从 preview+助手）→ 仍为 preview
- [ ] 知识库：关助手（从 edit+助手 或 split+助手）→ 回 edit
- [ ] 底部栏 split 按钮：仍关助手并进入/退出 split
- [ ] 快捷键 action1/action3 与底部栏编辑/预览一致
- [ ] preview↔edit（无助手）：滚动位置大致一致
- [ ] split → preview：滚动尽量保留
- [ ] 换篇 / 回收站 pick：viewMode 与助手重置符合改前预期
- [ ] 英语学习导入：JSON Monaco 预览只读，无 Markdown 底栏
- [ ] 长文预览 TOC / hash 链接跳转（若有入口）
- [ ] 中文 IME 在 edit / split 下输入正常

---

## 7. 相关文档滞后

| 文档 | 说明 |
|------|------|
| `docs/项目更新信息.md` / `docs/项目指南.md` | 同轮已增 §7 / §12 条目，与改后产品语义一致 |
| `docs/monaco/Markdown视图面板滚动.md` | 同轮新增实现专题，可作为开发侧对照 |
| `docs/monaco/Markdown底部栏.md` | 若文中仍写「切换 preview/edit 会关助手」，需改为「仅 split/Diff 等路径关助手」 |

---

（若与仓库最新源码不一致，以源码为准）
