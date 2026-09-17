# Markdown 分屏修改对照（Diff）实现说明

本文档说明在 `MarkdownEditor`（`apps/frontend/src/components/design/Monaco/index.tsx`）中，**分屏左编右预览**与**分屏左编右只读 Diff 对照**的设计思路、状态划分、与跟滚/布局的衔接方式，便于后续维护或接入「对照基线来自已保存版本」等业务能力。

相关代码文件：

- 主实现：`apps/frontend/src/components/design/Monaco/index.tsx`
- 换行归一化、Diff 准入判定等工具：`apps/frontend/src/components/design/Monaco/utils.ts`（`normalizeMonacoEol`、`isMarkdownDiffEntryEligible`、`MarkdownDiffBaselineSource` 等）
- 玻璃主题（含粘性条占位透明）：`apps/frontend/src/components/design/Monaco/glassTheme.ts`
- 全局粘性条样式覆盖：`apps/frontend/src/index.css`（`html, body` 内 `.monaco-editor` / `.sticky-widget` 等）
- Monaco 默认 options（stickyScroll 默认值会被组件 props 覆盖）：`apps/frontend/src/components/design/Monaco/options.ts`
- 分屏跟滚（与本文模式互斥的预览侧逻辑）：`docs/monaco-Markdown分屏滚动同步.md`

---

## 1. 目标与交互

| 能力 | 说明 |
|------|------|
| 对照展示 | 类似 VS Code 的并排 Diff（side-by-side）：**左侧为快照（original）**，**右侧为当前正文（modified）**，由 Monaco 绘制增删改高亮。 |
| 可编辑性 | **仅左侧主编辑器**可编辑；Diff 区域整体 **只读**（不在 Diff 内改正文）。 |
| 与「分屏」关系 | **「分屏」（左编右预览）**与**「分屏对照」（左编右 Diff）**在视图状态上 **互斥**：不会同时高亮「分屏」Tab 与对照模式；进入对照即离开「纯分屏+预览」语义。 |
| 基线（baseline）来源 | 当前实现：用户**开启对照瞬间**，从主编辑器（或兜底 `value`）读取全文并 `normalizeMonacoEol` 后写入快照；**非**磁盘上次保存（若需要可由业务传入并替换该快照逻辑）。 |
| 粘性滚动（sticky scroll） | 由外部参数控制是否开启；**主编辑器与 Diff 两侧**同步使用同一组参数（见 §15.5）。 |

底部操作栏：在「预览」左侧提供 `GitCompare` 按钮，用于进入/退出 `splitDiff`；**仅当允许进入对照**（与 `isMarkdownDiffEntryEligible` 一致）**或当前已在 `splitDiff`** 时显示，否则隐藏（避免灰显禁用态）。

---

## 2. 设计思路（为何用独立 `splitDiff` 而非「split + 布尔」）

### 2.1 问题

若用 `viewMode === 'split'` 再叠一层 `diffEnabled` 布尔：

- Tab 语义容易矛盾：用户看到「分屏」被选中，右侧却是 Diff 而非预览。
- 条件分支变多：`split && !diff`、`split && diff` 散落在跟滚、预览 `viewportRef`、布局等处，易漏判。

### 2.2 做法

将 Markdown 视图扩展为四种互斥模式（类型别名 `MarkdownViewMode`）：

- `edit`：单栏编辑。
- `preview`：单栏预览。
- `split`：**左编 + 右预览**（原有分屏）。
- `splitDiff`：**左编 + 右只读 Diff**（新增）。

「分屏」Tab 的 `aria-selected` **仅**在 `viewMode === 'split'` 时为真；进入 `splitDiff` 时「分屏」不高亮，**对照按钮**用 `aria-pressed` 表示开启。二者产品语义清晰、代码分支与跟滚条件可统一用 `viewMode` 表达。

---

## 3. 状态与数据流

### 3.1 视图状态

```ts
// 语义：split 与 splitDiff 互斥，由 viewMode 单字段表达
type MarkdownViewMode = 'edit' | 'preview' | 'split' | 'splitDiff';
```

### 3.2 快照状态 `diffBaselineOriginal`

- **写入时机**：用户从非 `splitDiff` 点击开启对照时，在 `toggleMarkdownSplitDiffCompare` 内 `setDiffBaselineOriginal(base)`，其中 `base` 来自 `editorRef.current?.getValue()`，兜底 `valueFromPropsRef.current`（避免未挂载编辑器时无值）。
- **清空时机**：
  - `useEffect` 依赖 `viewMode`：当 `viewMode !== 'splitDiff'` 时清空，避免 baseline 残留在其它模式。
  - `documentIdentity` 变化：`splitDiff` 时退回 `edit`，随后同上逻辑清空。

### 3.3 Diff 右侧（modified）正文

与受控 `value` / 主编辑器模型一致，使用即时正文（与分屏预览同样避免 `useDeferredValue` 滞后）：

```ts
// splitDiff 下右侧 Diff 的 modified 与父级 value 同步
const splitDiffModifiedText =
  viewMode === 'splitDiff' ? normalizeMonacoEol(value ?? '') : '';
```

左侧主编辑器仍通过既有 `onChange` / `setValue` 同步逻辑与父组件一致；**不在 Diff 内**写回 modified，避免双源编辑。

### 3.4 Diff 基线来源（知识库 / 回收站 / 新建草稿）

本组件支持由外部传入“Diff 基线来源”，以满足不同业务入口的对照语义：

| 场景 | 期望对照 | 推荐配置 |
|------|----------|----------|
| 知识库打开既有条目 | “打开时的内容” vs 当前修改 | `diffBaselineSource="persisted"` + `diffBaselineText=knowledgePersistedSnapshot.content` |
| 回收站打开（按新草稿展示） | “打开时的内容” vs 当前修改 | 同上：`persisted` + `diffBaselineText` 为打开时内容（回收站入口已将 snapshot 设为打开时内容） |
| 新建草稿 | 空内容 vs 当前正文 | `diffBaselineSource="empty"`（或 `persisted` 且 `diffBaselineText=''` 也等价） |

实现上，点击开启对照时会按 `diffBaselineSource` 决定 `original`：

- `persisted`：使用 `diffBaselineText`（建议传“进入编辑器时的快照”）
- `empty`：使用空字符串
- `current`：使用“点击瞬间”的当前正文（优先读编辑器模型，preview 下用受控 `value` 兜底）

---

## 4. Monaco DiffEditor 接入要点

### 4.1 依赖

使用 `@monaco-editor/react` 的 **`DiffEditor`**（与 `Editor` 同源包），在 `beforeMount` 中复用与主编辑器相同的主题与语言扩展注册（`handleMonacoBeforeMount`）。

### 4.2 模型路径（避免与主编辑器 URI 冲突）

为 original / modified 各建独立 `*ModelPath`（`useMemo` + `documentIdentity` 消毒后缀），避免与主 `Editor` 的 `path={monacoModelPath}` 抢同一 URI。

### 4.3 只读与折行

`mergedDiffEditorOptions` 中：

- `readOnly: true`：整块 Diff **两侧均不可编辑**（满足「仅左侧主编辑器可改」）。
- `automaticLayout: false`：与主编辑器一致，**由宿主测量后显式 `layout()`**，减少 Tauri / WebView 全屏切换后尺寸陈旧问题（见 `docs/monaco-编辑器Tauri布局.md`）。
- Markdown 时传入与主编辑器一致的 `wordWrap` / `wordWrapColumn`。
- `stickyScroll`：与主编辑器一致，**由外部 props**（`stickyScrollEnabled` / `stickyScrollScrollWithEditor`）控制；为避免 Diff 两侧子编辑器不继承顶层配置，`originalEditor` / `modifiedEditor` 也显式同步（见源码 `mergedDiffEditorOptions`）。

### 4.4 Diff 的 `layout`（类型限制）

当前 TypeScript 上的 `IStandaloneDiffEditor` **无** `getDomNode()`，因此**不**从 Diff 实例取 DOM 测宽高；统一用外层包裹 `div` 的 `ref={diffEditorHostRef}` 的 `clientWidth` / `clientHeight` 调用 `diffEd.layout({ width, height })`，并在 `ResizeObserver`、窗口 `resize`、`visualViewport`、`fullscreenchange` 上与主编辑器策略对齐。

---

## 5. 与「分屏跟滚」的隔离

`splitDiff` 右侧是 Monaco Diff，**没有** `ParserMarkdownPreviewPane` 的滚动容器，`previewViewportRef` 为空。若仍走「编辑 ↔ 预览」滚动同步，会空指针或逻辑无意义。

因此引入 **`splitPreviewScrollSyncEligible`**：

```ts
// 仅「左编右预览」且开启跟滚时才做锚点测量与双向同步
const splitPreviewScrollSyncEligible =
  viewMode === 'split' && scrollFollowActive && isMarkdown;
```

在以下路径对 `splitDiff` 早退（使用 **`viewModeRef.current === 'splitDiff'`**，避免滚动回调闭包滞后）：

- `flushEditorScrollToPreviewSync`
- `syncEditorFromPreview`
- `syncEditorFromPreview`

`useLayoutEffect` / `useEffect` 中重建快照、监听预览 `ResizeObserver` 的逻辑统一以 `splitPreviewScrollSyncEligible` 为门禁。

底部栏「跟滚」一组按钮本身仍仅在 `viewMode === 'split'` 时渲染，故 `splitDiff` 下不会误显。

---

## 6. 换篇（`documentIdentity`）

换篇时必须退出 `splitDiff`，否则 baseline 属于上一篇文档，Diff 语义错误：

```ts
useEffect(() => {
  setViewMode((vm) => (vm === 'splitDiff' ? 'edit' : vm));
}, [documentIdentity]);
```

其它模式（如 `split`）保持不变；`splitDiff` 强制回到 `edit`，再由 `viewMode` 的 `useEffect` 清空 `diffBaselineOriginal`。

### 6.1 回收站入口：为何要“强制变更 documentIdentity”

知识库打开既有条目时，`documentIdentity` 通常是条目 id，因此每次 pick 都会变化，`MarkdownEditor` 能稳定重置视图回 `edit`。

回收站打开按“新草稿”展示时，业务层往往会把 `editingKnowledgeId` 置空，若直接传 `documentIdentity="draft-new"`，则：

- 用户上一次可能停留在 `splitDiff`（底部栏仍是 Diff 状态）
- 再次从回收站 pick 时 `documentIdentity` 不变，组件不会触发“换篇重置”
- 结果：底部操作栏/右侧 Diff 状态可能残留

因此知识库页采用 **nonce 拼接** 方式：回收站 pick / 清空草稿时递增一个计数，把它拼到 `documentIdentity` 上，保证每次都触发组件内部“换篇重置”。对应实现见 `apps/frontend/src/views/knowledge/index.tsx`。

---

## 7. 关键代码位置索引（便于跳转）

| 主题 | 文件内大致位置 |
|------|----------------|
| `MarkdownViewMode` 含 `splitDiff` | 类型定义靠近文件顶部 |
| `diffBaselineOriginal` / `splitDiffModifiedText` | state 与派生变量区 |
| `viewMode !== 'splitDiff'` 清空 baseline | `useEffect` |
| 换篇退出 `splitDiff` | `useEffect([documentIdentity])` |
| `mergedDiffEditorOptions` | `useMemo` |
| `diffOriginalModelPath` / `diffModifiedModelPath` | `useMemo` |
| `splitPreviewScrollSyncEligible` | `viewMode === 'split' && …` |
| 滚动同步早退 | `flushEditorScrollToPreviewSync`、`syncEditorFromPreview`、`syncEditorFromPreview` |
| `handleDiffEditorMount` | `DiffOnMount` 回调：布局与监听 |
| 分栏 JSX：`split \|\| splitDiff`、右侧 Diff / 预览分支 | `ResizablePanelGroup` 一段 |
| 底部栏 `GitCompare` 与 `toggleMarkdownSplitDiffCompare` | 底部 `role="toolbar"` 区域 |

---

## 8. 摘录：类型与状态（带注释）

以下为从实现文件中整理的逻辑等价摘录，**行号以仓库当前版本为准**；若代码移动请以语义为准。

```typescript
/**
 * Markdown 四态视图：
 * - edit / preview：单栏
 * - split：左源码编辑器 + 右 HTML 预览（跟滚仅在此模式有意义）
 * - splitDiff：左源码编辑器 + 右 Monaco Diff（与 split 互斥，不复用「分屏」Tab 选中态）
 */
type MarkdownViewMode = 'edit' | 'preview' | 'split' | 'splitDiff';

// 进入 splitDiff 时写入；离开 splitDiff 时由 effect 清空
const [diffBaselineOriginal, setDiffBaselineOriginal] = useState('');

// Diff 右侧：与 props value 一致，保证与左侧主编辑器展示同源
const splitDiffModifiedText =
  viewMode === 'splitDiff' ? normalizeMonacoEol(value ?? '') : '';

// 仅 split + 跟滚：避免 splitDiff 下无预览 viewport 仍参与同步
const splitPreviewScrollSyncEligible =
  viewMode === 'split' && scrollFollowActive && isMarkdown;
```

---

## 9. 摘录：切换对照（带注释）

```typescript
/**
 * 分屏对照开关（与「分屏」Tab 互斥）：
 * - 已在 splitDiff：回到 edit 单栏
 * - 否则：按 diffBaselineSource 选择 baseline（original），进入 splitDiff（左编 + 右 Diff）
 */
const toggleMarkdownSplitDiffCompare = useCallback(() => {
  if (viewMode === 'splitDiff') {
    setViewMode('edit');
    queueMicrotask(focusEditor);
    return;
  }
  /**
   * baseline 必须与「当前正文」同源，否则 Diff 会出现整体偏移（例如顶部多出空行导致全量变更）。
   *
   * - current：优先读编辑器模型（避免父级 value 因 rAF 合并略滞后），preview 下用受控 value 兜底
   * - persisted：用外部传入的 diffBaselineText（用于知识库/回收站“打开时内容为基线”）
   * - empty：与空内容对照（新建草稿：当前 vs 空）
   */
  const ed = editorRef.current;
  let raw = '';
  if (diffBaselineSource === 'empty') {
    raw = '';
  } else if (diffBaselineSource === 'persisted') {
    raw = diffBaselineText ?? '';
  } else {
    raw =
      ed?.getModel?.() != null
        ? ed.getValue()
        : valueFromPropsRef.current ?? '';
  }
  const base = normalizeMonacoEol(raw);
  setDiffBaselineOriginal(base);
  setViewMode('splitDiff');
  queueMicrotask(focusEditor);
}, [viewMode, focusEditor, diffBaselineSource, diffBaselineText]);
```

---

## 10. 摘录：条件渲染结构（带注释）

```tsx
{/* 分屏与分屏对照共用同一套 Resizable 两栏，仅右侧内容不同 */}
{isMarkdown && (viewMode === 'split' || viewMode === 'splitDiff') ? (
  <ResizablePanelGroup orientation="horizontal">
    <ResizablePanel>{/* 左侧：始终为单一 Monaco Editor，可编辑 */}</ResizablePanel>
    <ResizableHandle withHandle />
    <ResizablePanel>
      {viewMode === 'splitDiff' ? (
        <div ref={diffEditorHostRef}>
          <DiffEditor
            // 关键：Diff 以 sessionId 组成独立 modelPath，避免 keepCurrent*Model 复用旧 TextModel 内容
            key={`${diffModifiedModelPath}__${diffSessionId}`}
            original={diffBaselineOriginal}
            modified={splitDiffModifiedText}
            originalModelPath={diffOriginalModelPath}
            modifiedModelPath={diffModifiedModelPath}
            // 关键：避免 monaco 0.55.1 下卸载时模型先 dispose、DiffEditorWidget 后 reset 的竞态报错
            keepCurrentOriginalModel
            keepCurrentModifiedModel
            options={mergedDiffEditorOptions} // readOnly: true 等
            onMount={handleDiffEditorMount}
          />
        </div>
      ) : (
        <ParserMarkdownPreviewPane markdown={splitPaneMarkdown} /* ... */ />
      )}
    </ResizablePanel>
  </ResizablePanelGroup>
) : null}
```

---

## 11. 摘录：知识库/回收站接入（基线与重置）

以下摘录来自 `apps/frontend/src/views/knowledge/index.tsx`，展示知识库页如何把“入口语义”传给 `MarkdownEditor`：

```tsx
<MarkdownEditor
  // 1) Diff 基线：始终以“打开时的快照”为主（知识库/回收站一致）
  diffBaselineSource="persisted"
  diffBaselineText={knowledgeStore.knowledgePersistedSnapshot.content}

  // 2) 回收站入口：documentIdentity 拼接 nonce，确保每次 pick 都会触发组件内部重置到 edit
  documentIdentity={`${knowledgeStore.knowledgeEditingKnowledgeId ?? 'draft-new'}__trash-${trashOpenNonce}`}
/>
```

回收站 pick 时将 `knowledgePersistedSnapshot.content` 设为“打开时内容”，确保清空/编辑时 Diff 以该内容为基线：

```ts
// 从回收站打开：按“新草稿”保存，但 Diff/脏检查基线用打开时内容
const content = record.content ?? '';
knowledgeStore.setKnowledgePersistedSnapshot({ title: '', content });
knowledgeStore.setMarkdown(content);
```

清空草稿时无需再额外递增 nonce：

- 组件内部在 `value === ''` 且处于 `splitDiff` 时会自动切回 `edit`（见 §12.4）
- 同时 Diff 使用 session 化模型路径，不会因 keepCurrent*Model 复用旧内容（见 §12.3）

---

## 12. Diff 清空时报错与“内容残留”的最终解法（monaco 0.55.1）

### 12.1 现象

在 `splitDiff` 模式下清空正文（例如知识库/回收站里点“清空”）时，部分场景会出现控制台报错：

> `TextModel got disposed before DiffEditorWidget model got reset`

同时，如果为规避报错而简单开启 `keepCurrentOriginalModel/keepCurrentModifiedModel`，又可能出现：

- 清空后退出 Diff，再次进入 Diff：仍复用上一轮的 TextModel，导致 **Diff 内容残留/不正确**（尤其是回收站 `documentIdentity` 不变时更明显）

### 12.2 根因（竞态 + 模型复用）

- `@monaco-editor/react` 的 `DiffEditor` 在卸载（unmount）时默认可能 dispose 它创建/使用的 TextModel
- Monaco 内部 `DiffEditorWidget` 存在异步的 model reset 流程
- 当卸载与 reset 的时序交错：**模型先被 dispose**，而 widget 还没 reset → 抛错

若开启 keepCurrent*Model：卸载时不 dispose，避免报错；但也因此 **同一 modelPath** 下的模型会被复用，造成“下一次进入 Diff 仍是旧内容”。

### 12.3 最终策略：Diff 会话（session）+ 延迟 dispose

本组件采用两步组合拳，保证“无报错 + 不残留 + 不泄漏内存”：

1. **Diff 会话化（sessionId）**：每次进入 `splitDiff` 都 `diffSessionId + 1`，并把它拼进 `diffOriginalModelPath/diffModifiedModelPath`（`__s${diffSessionId}`），确保每次进入 Diff 都是全新 model。
2. **keepCurrent*Model + 退出后双 rAF dispose**：保留 keepCurrent*Model 避免卸载竞态；退出 `splitDiff` 后用双 `requestAnimationFrame` 延迟 dispose 当次 session 的 original/modified model，等待 `DiffEditorWidget` 完成内部 reset 再释放。

对应关键实现（伪码级摘录，语义与源码一致）：

```ts
// 进入 Diff：开启新 session，生成新的 modelPath，避免复用旧 TextModel
setDiffSessionId((s) => s + 1);

// modelPath = documentIdentity + sessionId
const diffOriginalModelPath = `...__s${diffSessionId}`;
const diffModifiedModelPath = `...__s${diffSessionId}`;

// 卸载时保留模型，避免 dispose/reset 竞态
<DiffEditor keepCurrentOriginalModel keepCurrentModifiedModel ... />

// 退出 Diff：双 rAF 后 dispose 当次 session 的两个 model
requestAnimationFrame(() => {
  requestAnimationFrame(() => {
    monaco.editor.getModel(Uri.parse(diffOriginalModelPath))?.dispose();
    monaco.editor.getModel(Uri.parse(diffModifiedModelPath))?.dispose();
  });
});
```

### 12.4 额外体验：清空正文时强制退出 Diff

为了让“清空”行为与知识库编辑器预期一致，组件内部在 `value === ''` 且处于 `splitDiff` 时会自动切回 `edit`。

---

## 13. 后续扩展建议

1. **基线来自已保存版本**：增加可选 prop（如 `diffCompareBaseline?: string`），在开启 `splitDiff` 时优先用该字符串作为 `original`，无则仍用当前「点击瞬间快照」。
2. **重新对齐基线**：在 `splitDiff` 工具栏增加「以当前内容为新的对照基准」按钮，仅更新 `diffBaselineOriginal` 而不退出模式。
3. **与跟滚文档的关系**：实现跟滚的细节仍以 `docs/monaco-Markdown分屏滚动同步.md` 为准；本文仅说明 **splitDiff 必须从该链路中排除** 的原因与门禁变量。

---

## 14. 小结

- 用 **`splitDiff` 独立视图**表达「分屏对照」，与 **`split`（左编右预览）** 在状态机层面互斥，避免 Tab 语义与条件分支纠缠。
- Diff 使用 **`DiffEditor` + `readOnly` + 外层宿主显式 layout**，与主编辑器 Tauri/WebView 布局策略一致。
- **预览跟滚**严格限制在 `viewMode === 'split'`，并在滚动相关回调里对 **`splitDiff` 早退**，避免空 `viewportRef` 与无效同步。

---

## 15. 粘性滚动条（sticky scroll）背景与 CSS 覆盖

本节说明：**为何**在玻璃主题 `defineTheme` 里直接写 `var()` / `color-mix` 或误用 `--theme-color` 会导致粘性条异常色；**最终方案**（`glassTheme.ts` + `index.css`）；以及与 **Diff 分栏内嵌双编辑器** 的关系。普通 Markdown 单栏编辑与 **splitDiff** 下 Diff 两侧子编辑器 **共用** 同一套全局 CSS，维护时一并考虑。

### 15.1 什么是粘性滚动

在 Monaco（与 VS Code 同源）中，**粘性滚动（sticky scroll）** 指编辑长文件时，在视口顶部「钉住」当前所在的**外层语法块标题行**（如类名、函数名），便于始终知道上下文。对应 DOM 上常见类名为 **`.sticky-widget`**，主题里对应颜色键为：

| 颜色键（Monaco `colors` / CSS 变量） | 含义 |
|--------------------------------------|------|
| `editorStickyScroll.background` | 常态背景 |
| `editorStickyScrollHover.background` | 悬停背景 |

Monaco 会把主题中的颜色写入编辑器 DOM 上的 **`--vscode-editorStickyScroll-background`** 等变量，由内部样式消费。

### 15.2 本仓库中的目标

- 编辑区整体为 **玻璃效果**（`editor.background` 等透明，透出外层 `bg-theme/5`），见 `glassTheme.ts`。
- 粘性条需要 **与产品主题协调** 的可读底色，且随 **`body` / `.dark` 与各主题预设** 下的 CSS 变量变化。
- **分屏 Diff**（`DiffEditor`）内左右各有一个内嵌 **`.monaco-editor`**，样式必须 **一并命中**（见下文 `index.css` 选择器），否则只有普通编辑器生效。

### 15.3 走过的弯路（为何不要用 `defineTheme` 写 `var()` / `--theme-color`）

#### 15.3.1 在 `defineTheme({ colors })` 里写 `var(--theme-color)` 或 `color-mix(...)`

`monaco.editor.defineTheme` 的 `colors` 值在很多版本里会走 **Monaco 自己的颜色解析管线**（用于与内置主题合并、生成内部 token）。**并非所有值都会原样变成浏览器里的 CSS**：

- 若解析失败或走兜底路径，可能落到 **与预期不符的默认色**（实践中出现过 **偏红** 等与当前主题无关的观感）。
- 因此：**不要把依赖「运行时 CSS 变量」的复杂字符串，当作唯一手段写在 `glassTheme` 的粘性键上**。

#### 15.3.2 误用 `--theme-color` 作为「背景色`

在本项目 `index.css` 中，`--theme-color` 在**不同主题预设**下表示 **强调 / 品牌色**（高饱和、色相随主题变化），**不是**页面大面的「背景灰/底」。

- 若粘性条大面积使用 `--theme-color`，在部分主题下会呈现 **明显偏红或其它高饱和色**，与「跟页面背景一致」的预期不符。
- **背景系**应优先使用：`--theme-background`、`--theme-muted`、`--theme-secondary`、`--theme-card` 等（语义以 `index.css` 为准）。

### 15.4 最终方案（双轨）

#### 15.4.1 `glassTheme.ts`：粘性键保持「可解析的透明实色」

- **`editorStickyScroll.background` / `editorStickyScrollHover.background`** 设为 **`#00000000`（全透明）**。
- 目的：与玻璃编辑区一致；**不在主题层引入不可解析字符串**；真实可见背景交给 **`index.css`**，由浏览器解析 `var()` / `color-mix`。

```typescript
/**
 * 继承内置主题语法高亮，仅把编辑区相关层改为透明，透出外层 bg-theme/5。
 * 粘性滚动条背景勿在此写 var()/color-mix：Monaco defineTheme 解析失败易偏色；
 * 由 `index.css` 中 `--vscode-editorStickyScroll-*` 与 `.sticky-widget` 覆盖为应用主题变量。
 */
const GLASS_CHROME: Record<string, string> = {
	'editor.background': '#00000000',
	'editorGutter.background': '#00000000',
	'minimap.background': '#00000000',
	'editorOverviewRuler.background': '#00000000',
	// 全透明占位：实际底色见 index.css，避免 defineTheme 解析 var/color-mix 异常
	'editorStickyScroll.background': '#00000000',
	'editorStickyScrollHover.background': '#00000000',
};
```

#### 15.4.2 `index.css`：覆盖语义变量 + `.sticky-widget` 实背景

文件：`apps/frontend/src/index.css`（挂在 `html, body { ... }` 内，与 `.monaco-editor .find-widget` 等同级）

**两层：**

1. **在 `.monaco-editor` 上重写 VS Code 语义变量**  
   Monaco 内部仍读 `--vscode-editorStickyScroll-background`，值由我们提供；**浏览器原生**解析 `color-mix` 与 `var(--theme-secondary)`，不经过 Monaco 颜色解析器。

2. **直接给 `.sticky-widget` 写 `background-color`**  
   防止子层仍用旧背景；使用 **`!important`** 覆盖内联或主题注入。

**选择器为何带 `.monaco-diff-editor .monaco-editor`？**

- **Diff 分栏**：根节点多为 **`.monaco-diff-editor`**，左右各嵌 **`.monaco-editor`**；显式写出可让代码审查时意图清晰，并与部分 DOM 变体兼容。

**当前仓库中的颜色（以 `index.css` 为准，可按产品调）**：

- 使用 **`color-mix(in oklch, var(--theme-secondary) 80%, transparent)`** 作为粘性条与悬停底色（偏浅玻璃条）。
- 若需 **更贴近整页底**：可把 `var(--theme-secondary)` 改为 **`var(--theme-background)`** 或 **`var(--theme-muted)`**。

```css
/*
 * Monaco 粘性滚动（sticky scroll）：
 * 1）defineTheme 里写 var()/color-mix 易解析失败 → 异常色；
 * 2）此处由浏览器解析，并覆盖 --vscode-* 与 .sticky-widget；
 * 3）Diff 内嵌多实例 .monaco-editor，选择器需命中。
 */
.monaco-editor,
.monaco-diff-editor .monaco-editor {
	/* Monaco 内部消费：主题次要底 + 透明混合，避免误用 --theme-color（强调色） */
	--vscode-editorStickyScroll-background: color-mix(
		in oklch,
		var(--theme-secondary) 80%,
		transparent
	) !important;
	--vscode-editorStickyScrollHover-background: color-mix(
		in oklch,
		var(--theme-secondary) 80%,
		transparent
	) !important;
}

.monaco-editor .sticky-widget,
.monaco-diff-editor .monaco-editor .sticky-widget {
	background-color: color-mix(
		in oklch,
		var(--theme-secondary) 80%,
		transparent
	) !important;
}

.monaco-editor .sticky-widget:hover,
.monaco-diff-editor .monaco-editor .sticky-widget:hover {
	/* 悬停可与常态相同，或改为更高比例的 theme-muted / theme-background */
	background-color: color-mix(
		in oklch,
		var(--theme-secondary) 80%,
		transparent
	) !important;
}
```

### 15.5 与 `options.ts` 的关系

文件：`apps/frontend/src/components/design/Monaco/options.ts`

#### 15.5.1 默认值 vs 组件外部覆盖

- **`options.ts`** 提供 Monaco 通用默认配置，其中包含：
  - `stickyScroll: { enabled: true, scrollWithEditor: true }`
- **`MarkdownEditor`** 会在运行时用外部 props 覆盖该默认值，使业务层可控：
  - `stickyScrollEnabled?: boolean`：是否开启粘性滚动（默认 `true`）
  - `stickyScrollScrollWithEditor?: boolean`：粘性条是否跟随横向滚动（默认 `true`）
- **覆盖范围**：
  - 主编辑器：在 `mergedEditorOptions` 中覆盖 `stickyScroll`
  - Diff 编辑器：在 `mergedDiffEditorOptions` 中同步 `stickyScroll`，并对 `originalEditor` / `modifiedEditor` 两侧子编辑器显式同步，避免部分版本仅对顶层生效

#### 15.5.2 背景色与开关的分离

- **开关**由 `stickyScrollEnabled` 等 props / `stickyScroll` options 控制。
- **背景色**由「主题透明 + `index.css` 覆盖 `--vscode-editorStickyScroll-*` / `.sticky-widget`」完成（见 §15.4）。

若需关闭粘性滚动以规避极端场景 bug，可改 `enabled: false`；详见 `docs/monaco-Markdown输入法鬼影.md`。

### 15.6 维护清单（粘性条）

| 操作 | 建议 |
|------|------|
| 改粘性条颜色 | 优先改 **`index.css`** 中 `color-mix` 与变量名；**避免**在 `glassTheme.ts` 的粘性键上写 `var()`。 |
| 换主题 token 命名 | 同步检查 `index.css` 里 `--theme-*` 是否仍存在于 `:root` / `.dark` / `body.theme-*`。 |
| 升级 Monaco 大版本 | 抽查 DOM 是否仍使用 `.sticky-widget` 与 `--vscode-editorStickyScroll-*`。 |
| 排查「仍是红/异常色」 | 查是否有别处对 `.sticky-widget` 或 `--vscode-editorStickyScroll-*` 更高优先级覆盖；用开发者工具看**计算后的 background**。 |

### 15.7 小结（粘性条）

- **`defineTheme` 的 `colors`**：粘性键用 **`#00000000`** 占位，**不写**依赖运行时 CSS 变量的字符串。  
- **全局 CSS**：在 **`.monaco-editor` / `.monaco-diff-editor .monaco-editor`** 上覆盖 **`--vscode-editorStickyScroll-*`**，并给 **`.sticky-widget`** 写 **`background-color`**。  
- **语义**：**`--theme-color` 为强调色**，勿作大面积粘性条底；背景系用 **`--theme-background` / `--theme-muted` / `--theme-secondary`** 等。

---

## 16. 本轮补充：Diff 准入判定抽取、清空/换篇与回收站一致性

本节记录**近期实现**中与本 Diff 能力强相关的两处改动思路，便于以后排查「底部栏显示与 toggle 不一致」「回收站清空仍卡在 splitDiff」等问题。

### 16.1 背景问题（为什么要动）

1. **准入逻辑重复**  
   「是否允许进入 `splitDiff`」与底部栏是否展示 `GitCompare`、以及 `toggle` 早退若在多处各写一遍，容易出现**条件漂移**（例如应隐藏却仍响应快捷键等边界）。

2. **回收站清空不退出 Diff、知识库清空却可以**  
   根因通常**不在** `splitDiff` 内部「正文清空」那条 `useEffect` 本身，而在**知识库页**拼出来的 `documentIdentity`：  
   - 从**知识库列表**打开既有条目时，`knowledgeEditingKnowledgeId` 有值；用户执行「清空/新建草稿」后 id 变为 `null`，`documentIdentity` 字符串变化，会触发 `MarkdownEditor` 里「换篇退出 splitDiff」的链路。  
   - 从**回收站**打开时，业务上按「新草稿」处理，`knowledgeEditingKnowledgeId` **本来就是** `null`；清空后 id 仍为 `null`，若 `documentIdentity` 仅依赖 id，则**字符串不变**，`MarkdownEditor` 收不到「换篇」信号，**可能仍停留在 `splitDiff`**（与列表入口行为不一致）。

### 16.2 实现思路一：把「能否进入 Diff」抽成纯函数（单源规则）

**目标**：同一套布尔规则驱动 **底部栏 Diff 是否展示**（可进入对照或已在 `splitDiff` 时展示）与 **`toggleMarkdownSplitDiffCompare` 早退**，并可在业务页按需复用（不依赖 React）。

**落点文件**：`apps/frontend/src/components/design/Monaco/utils.ts`

- 将 `MarkdownDiffBaselineSource` 与判定函数放在工具模块，避免 `index.tsx` 内联重复。  
- 判定前先 `normalizeMonacoEol`，再 `trim`，与编辑器/父组件对「空」的感知一致。

**规则（与组件行为一致，注释已写在源码）**：

- 当前正文（`trim` 后）非空 → **允许**进入 Diff。  
- 否则，仅当 `diffBaselineSource === 'persisted'` 且外部传入的 `diffBaselineText`（`trim` 后）非空 → **允许**（用于「打开时有内容、当前删光」的**全量删除**对照）。  
- 其它情况 → **不允许**（避免无意义的「空对空」）。

对应实现（节选，完整以仓库为准）。

**位置**：`apps/frontend/src/components/design/Monaco/utils.ts`（约第 `537`–`577` 行，随仓库版本可能略有偏移）

```ts
export type MarkdownDiffBaselineSource = 'current' | 'persisted' | 'empty';

export function isMarkdownDiffEntryEligible(
	editorValue: string,
	diffBaselineSource: MarkdownDiffBaselineSource,
	diffBaselineText?: string,
): boolean {
	const curTrimmed = normalizeMonacoEol(editorValue ?? '').trim();
	if (curTrimmed.length > 0) return true;
	if (diffBaselineSource !== 'persisted') return false;
	const baselineTrimmed = normalizeMonacoEol(diffBaselineText ?? '').trim();
	return baselineTrimmed.length > 0;
}

export function isMarkdownDiffToolbarDisabled(
	editorValue: string,
	diffBaselineSource: MarkdownDiffBaselineSource,
	diffBaselineText?: string,
): boolean {
	return !isMarkdownDiffEntryEligible(
		editorValue,
		diffBaselineSource,
		diffBaselineText,
	);
}
```

**`MarkdownEditor` 内用法（要点）**：

- 用 `useMemo` 计算一次 `markdownDiffEntryEligible`；底部栏用 `markdownDiffEntryEligible || viewMode === 'splitDiff'` 控制 **是否渲染** `GitCompare`（已在对照时必须保留按钮以便退出）。  
- `toggleMarkdownSplitDiffCompare` 在「进入」分支里仅判断 `if (!markdownDiffEntryEligible) return;`，与展示条件同源。  
- 底部栏 `GitCompare` 不再包一层 IIFE 重复计算。

节选。

**位置**：`apps/frontend/src/components/design/Monaco/index.tsx`（约第 `297`–`302` 行）

```tsx
	const markdownDiffEntryEligible = useMemo(
		() =>
			isMarkdownDiffEntryEligible(value, diffBaselineSource, diffBaselineText),
		[value, diffBaselineSource, diffBaselineText],
	);
	const markdownDiffToolbarDisabled = !markdownDiffEntryEligible;
```

**位置**：`apps/frontend/src/components/design/Monaco/index.tsx`（约第 `1116`–`1156` 行）

```tsx
	const toggleMarkdownSplitDiffCompare = useCallback(() => {
		if (viewMode === 'splitDiff') {
			setViewMode('edit');
			queueMicrotask(focusEditor);
			return;
		}
		if (!markdownDiffEntryEligible) return;
		// ...
	}, [
		viewMode,
		focusEditor,
		markdownDiffEntryEligible,
		diffBaselineSource,
		diffBaselineText,
	]);
```

### 16.3 实现思路二：知识库页用 `trashOpenNonce` 制造「会话级 documentIdentity」

**目标**：在「`editingKnowledgeId` 恒为 `draft-new`」这类场景下，仍能**可靠触发** `MarkdownEditor` 的 `documentIdentity` 变更链路（换篇重置视图、退出 `splitDiff`、避免 Diff 模型路径复用带来的陈旧内容）。

**落点文件**：`apps/frontend/src/views/knowledge/index.tsx`

#### 16.3.1 `MarkdownEditor` 侧：换篇即退出对照

`documentIdentity` 变化时，强制把 `splitDiff` 收敛回 `edit`，避免沿用上一篇快照。

**位置**：`apps/frontend/src/components/design/Monaco/index.tsx`（约第 `485`–`488` 行）

```tsx
	// 换篇时退出分屏对照，避免沿用上一篇快照
	useEffect(() => {
		setViewMode((vm) => (vm === 'splitDiff' ? 'edit' : vm));
	}, [documentIdentity]);
```

因此：**只要业务层能让 `documentIdentity` 在「应视为换篇」时变化**，就能统一处理「退出 Diff / 不串篇」问题，而不必在 `MarkdownEditor` 里写死「是否回收站」等业务判断。

#### 16.3.2 知识库页：`documentIdentity` 拼接 `__trash-${nonce}`

知识库页把 `trashOpenNonce` 拼进 `documentIdentity`，并在**回收站 pick**时递增（见下节）。`MarkdownEditor` 上相关注释意图是：**pick / clear 都应 bump**，从而触发上述 effect。

节选。

**位置**：`apps/frontend/src/views/knowledge/index.tsx`（约第 `680`–`681` 行）

```tsx
					// 回收站入口：documentIdentity 拼接 nonce，确保每次 pick/clear 都会触发组件内部重置到 edit，不重置会导致 diff 内容出现问题
					documentIdentity={`${knowledgeStore.knowledgeEditingKnowledgeId ?? 'draft-new'}__trash-${trashOpenNonce}`}
```

#### 16.3.3 清空草稿时递增 `trashOpenNonce`（修复「回收站清空不退出 Diff」）

`resetEditorToNewDraft` 在调用 `clearKnowledgeDraft()` **之前**执行 `setTrashOpenNonce((n) => n + 1)`：

- **从列表打开的云端条目**清空：`editingKnowledgeId` 从有值变 `null`，`documentIdentity` 前缀会变；**再**加 nonce 递增属于「双保险」，副作用主要是 Monaco 视为新会话（通常可接受）。  
- **从回收站打开的新草稿**清空：`editingKnowledgeId` 本来就是 `null`，若仅清空 store 而不改 nonce，`documentIdentity` 可能完全不变 → **不会**触发 `MarkdownEditor` 的换篇退出；这就是要补 nonce 的原因。

节选。

**位置**：`apps/frontend/src/views/knowledge/index.tsx`（约第 `97`–`103` 行）

```tsx
	const resetEditorToNewDraft = useCallback(() => {
		// 与「从列表打开条目」类似：editingId 从有值变 null 会改变 documentIdentity，从而触发 MarkdownEditor 换篇并退出 splitDiff。
		// 从回收站打开时 id 本就为 null，仅靠 id 不会变；递增 nonce 才能让 documentIdentity 变化，避免清空后仍卡在 Diff。
		setTrashOpenNonce((n) => n + 1);
		knowledgeStore.clearKnowledgeDraft();
	}, [knowledgeStore]);
```

#### 16.3.4 回收站 pick：persisted 快照必须与「打开时正文」一致

`diffBaselineText` 来自 `knowledgePersistedSnapshot.content`。若回收站打开时把快照误写成空串，会导致：

- Diff 左侧基线（`persisted`）与真实「打开时内容」不一致；  
- 「全量删除」语义与按钮禁用逻辑出现难以排查的组合问题。

因此 `handlePickTrashRecord` 在仍按「新草稿」处理 `editingKnowledgeId` 的前提下，将快照设为**打开时的标题/正文**（与列表 `handlePickRecord` 一致）。

**位置**：`apps/frontend/src/views/knowledge/index.tsx`（约第 `583`–`599` 行）

```tsx
	const handlePickTrashRecord = useCallback(
		(record: { title: string | null; content: string }) => {
			setTrashOpenNonce((n) => n + 1);
			// ...
			const content = record.content ?? '';
			const trimmedTitle = (record.title ?? '').trim();
			// 从回收站打开按新草稿处理（保存走新建），Diff / 脏检查基线仍为「打开时正文/标题」（与列表 pick 一致）
			knowledgeStore.setKnowledgePersistedSnapshot({
				title: trimmedTitle,
				content,
			});
			knowledgeStore.setKnowledgeTitle(record.title ?? '');
			knowledgeStore.setMarkdown(content);
		},
		[knowledgeStore],
	);
```

### 16.4 与「正文清空」组件内 effect 的关系（不要混淆两条路径）

`MarkdownEditor` 另有一条**仅依赖正文与内存基线**的自动退出逻辑：当 `splitDiff` 且受控 `value` 已空，且 **`diffBaselineOriginal`（进入 Diff 时写入的快照）也为空**时，回到 `edit`，用于避免「空对空」无意义对照；若 `diffBaselineOriginal` 非空（典型：`persisted` 基线有内容、当前删光），则**不退出**，用于展示全量删除。

节选。

**位置**：`apps/frontend/src/components/design/Monaco/index.tsx`（约第 `423`–`430` 行）

```tsx
	// 清空正文时：仅在“没有任何可对照基线”时退出 Diff，避免无意义的空对空对照；
	// 若基线不为空（如知识库/回收站：打开时内容 vs 当前清空），应允许保留 Diff 来展示“全量删除”。
	useEffect(() => {
		if (viewMode !== 'splitDiff') return;
		if (normalizeMonacoEol(value ?? '') !== '') return;
		if (diffBaselineOriginal.trim() !== '') return;
		setViewMode('edit');
	}, [viewMode, value, diffBaselineOriginal]);
```

**与上文 16.3 节的分工**：

- **16.3 节**：业务层通过 `documentIdentity` 表达「换篇 / 换会话」，**强制**退出 `splitDiff`（更偏全局重置）。  
- **16.4 节**：组件内根据「当前是否还能构成有意义的 Diff」自动退出（更偏编辑态细节）。

回收站「清空仍卡在 Diff」这类问题，在已引入 persisted 全量删除语义后，**优先检查 16.3 节所述 identity 是否变化**；不要误以为仅靠 16.4 节的 effect 就能覆盖所有业务入口。

### 16.5 维护清单（本节选相关）

| 现象 | 优先排查 |
|------|----------|
| Diff 按钮显示与 toggle 行为不一致 | `index.tsx` 是否仍用同一 `markdownDiffEntryEligible`，且 `markdownDiffBottomBarVisible` 是否包含 `viewMode === 'splitDiff'`；`utils.ts` 规则是否被改坏。 |
| 回收站清空不退出 Diff | `knowledge/index.tsx` 的 `resetEditorToNewDraft` 是否在清 store 前递增 `trashOpenNonce`；`documentIdentity` 是否仍拼接 nonce。 |
| 回收站 Diff 左侧基线不对 | `handlePickTrashRecord` 写入的 `knowledgePersistedSnapshot` 是否与打开时 `content` 一致；`MarkdownEditor` 的 `diffBaselineText` 绑定是否仍指向 snapshot。 |
| 业务侧想预判断能否开 Diff | 直接调用 `isMarkdownDiffEntryEligible`（或 `isMarkdownDiffToolbarDisabled`），传入与编辑器一致的 `normalizeMonacoEol` 前原文即可（函数内部会归一化）。 |

---

## 17. 扩展阅读

- 分屏跟滚：`docs/monaco-Markdown分屏滚动同步.md`
- Tauri / WebView 下 Monaco 显式布局：`docs/monaco-编辑器Tauri布局.md`
- Markdown IME 与装饰层（含 sticky 开关讨论）：`docs/monaco-Markdown输入法鬼影.md`
