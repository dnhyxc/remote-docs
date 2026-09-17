# 知识库：本地文件夹列表与 Monaco 清空同步 — 实现说明

本文整理**本次相关改动**的完整实现思路，并对**核心逻辑代码**按行说明含义（摘录自当前仓库，行号随文件演进可能略有偏移，以路径为准）。

---

## 1. 总览

### 1.1 目标

1. **知识库抽屉**：用开关在「云端数据库列表」与「本地指定文件夹内递归 `.md` 列表」之间切换；桌面端可选目录、读文件、删文件；打开条目后编辑器可保存到对应目录。
2. **Monaco 编辑器**：点击「清空」或从外部把正文设为空时，即使焦点仍在编辑器内，也能把视图与父组件 `value` 对齐（修复不同步问题）。
3. **本地文件夹列表**：在删除按钮左侧提供「在外部编辑器打开」，将当前 `.md` 绝对路径交给 Tauri，由 Rust 在 **Cursor** 或 **Trae**（字节，用户口语中的 tare）中打开；优先匹配前台应用与已运行进程，macOS 下可再按 `/Applications` 安装位置兜底。

### 1.2 涉及文件

| 路径                                                    | 作用                                                                             |
| ------------------------------------------------------- | -------------------------------------------------------------------------------- |
| `apps/frontend/src-tauri/src/command/knowledge.rs`      | 列出目录下 `.md`、读取单文件；`open_knowledge_markdown_in_editor`（Cursor/Trae） |
| `apps/frontend/src-tauri/src/lib.rs`                    | 注册 Tauri `invoke` 命令                                                         |
| `apps/frontend/src/utils/knowledge-save.ts`             | 前端封装 `invoke`                                                                |
| `apps/frontend/src/types/index.ts`                      | `KnowledgeRecord` / `KnowledgeListItem` 扩展字段                                 |
| `apps/frontend/src/views/knowledge/constants.ts`        | 本地条目 id 前缀与判定函数                                                       |
| `apps/frontend/src/store/knowledge.ts`                  | 列表分页 + 编辑器草稿（含 `knowledgeLocalDirPath`、清空草稿）                    |
| `apps/frontend/src/views/knowledge/index.tsx`           | 保存走云端或仅磁盘、回填 `localDirPath`；覆盖/另存为冲突流程                     |
| `apps/frontend/src/views/knowledge/KnowledgeList.tsx`   | 开关、选文件夹、本地列表与删除分支；本地模式下「在外部编辑器打开」按钮           |
| `apps/frontend/src/components/design/Confirm/index.tsx` | 通用确认框；支持 secondary/tertiary 两个可选操作按钮（用于「另存为」与「分流删除」） |
| `apps/frontend/src/components/design/Monaco/index.tsx`  | 外部 `value` 与编辑器同步策略                                                    |

---

## 2. 实现思路（架构）

### 2.1 本地条目与云端 UUID 区分

- 云端条目使用后端返回的 **UUID** 作为 `id`。
- 本地文件夹列表中的每一项没有数据库 id，使用**合成 id**：`__local_md__:` + `encodeURIComponent(绝对路径)`，避免与 UUID 冲突，且便于删除后回调比对。
- 判定函数 `isKnowledgeLocalMarkdownId(id)`：凡 `id` 以前缀开头，则视为「仅本地、不写库」的编辑会话。

### 2.2 保存策略

- **`persistKnowledgeApi`**：若当前 `knowledgeEditingKnowledgeId` 为本地合成 id，**直接 return**，不调用 `update` / `save` 接口。
- **Tauri 写盘**：`filePath` 传入的「目录」在本地条目下取 **`knowledgeStore.knowledgeLocalDirPath`**（打开文件时设为**该 `.md` 所在目录**），否则沿用 `TAURI_KNOWLEDGE_DIR`。与既有 `previousTitle` 逻辑配合，支持改标题时的本地重命名。

### 2.3 Rust 侧能力

- **`list_knowledge_markdown_files`**：`dirPath` 可选；空则 `resolve_knowledge_dir`；递归收集 `.md`（跳过以 `.` 开头的目录名）；按修改时间降序。
- **`read_knowledge_markdown_file`**：校验路径为存在的 `.md` 文件后 `read_to_string`（UTF-8）。

### 2.4 抽屉 UI 行为

- **数据库模式**：打开抽屉时 `knowledgeStore.refreshList()`；列表滚动继续触发分页。
- **本地模式**：仅 Tauri 可用；`select_directory` 更新 `localFolderPath`；`invokeListKnowledgeMarkdownFiles` 填充 `localList`；点击行 `invokeReadKnowledgeMarkdownFile` 后组装 `KnowledgeRecord`（含 `localDirPath`）再 `onPick`。
- **删除**：流程与 UI 约定见 **§2.6**。

### 2.5 Monaco 清空不同步的根因与修复

**根因简述：**

1. 原逻辑在 `ed.hasTextFocus()` 时**不** `setValue`，工具栏「清空」后焦点常仍在编辑器 → 正文不清。
2. 原逻辑用 `next === lastEmittedRef.current` 提前返回；换篇或清空时另一个 effect 可能已把 `lastEmittedRef` 设成 `''`，与 props 一致，但**编辑器模型仍是旧内容** → 仍不清。

**修复策略：**

- 以 **`ed.getValue()` 与 props `value` 规范化后是否一致** 为是否需同步的首要条件。
- **有焦点时**：若既非「清空」（`next === ''`），也非「换篇」（`documentIdentity` 相对上次同步引用发生变化），则**不**覆盖，避免 `onDidChangeModelContent` 里 RAF 合并导致父组件 `value` 暂时落后时误删正在输入的字符。
- **清空**或**换篇**：允许在焦点仍在编辑器时执行 `setValue`。

### 2.6 列表删除操作（实现思路）

**统一删除图标 UI（本地列表 = 数据库列表）**

- 数据库行与本地扫描行共用组件 `KnowledgeListRow`，同一颗 `Trash2`（`size={16}`）与同一套按钮样式（`p-1 rounded-md`、`hover:text-destructive`、`hover:bg-destructive/10`）。
- 默认 `opacity-0 pointer-events-none`，通过行容器 `className` 中的 **`group`**，配合 **`group-hover:opacity-100 group-hover:pointer-events-auto`**，仅在**鼠标悬停整行**时显示删除钮。
- **刻意不用 `focus-within`**：否则抽屉打开后焦点若落在第一行，第一个删除钮会长期可见，与产品预期不符。

**状态位**

| 状态                   | 含义                                                                             |
| ---------------------- | -------------------------------------------------------------------------------- |
| `deleteRecordOnlyOpen` | 仅删除云端记录的确认弹窗                                                         |
| `deleteLocalOpen`      | 涉及磁盘 `.md` 的确认弹窗（纯本地删文件 **或** 库+盘双删）                       |
| `localFileDeleteOnly`  | `true`：确认后**只**调 Tauri 删盘，**不**调 `deleteKnowledge`                    |
| `selectKnowledge`      | 当前在删流程中选中的列表项                                                       |
| `deleteLocalPath`      | 待删文件的绝对路径（本地行 = `localAbsolutePath`；库+盘流程 = resolve 出的路径） |

**`openDeleteFlow` 分支**

1. **`localAbsolutePath` 存在且 `isTauriRuntime()`**（本地文件夹列表行）：置 `localFileDeleteOnly = true`，`deleteLocalPath = localAbsolutePath`，打开 `deleteLocalOpen`。确认后走 `invokeDeleteKnowledgeMarkdown({ title, filePath })`，`filePath` 为**完整 `.md` 路径**，Rust 按既有规则解析为单文件；成功后 `onAfterLocalDelete(合成 id)`、`loadLocalMarkdownList()`。
2. **非 Tauri**：只打开「删除知识库记录」`deleteRecordOnlyOpen`（浏览器无法删本地默认目录文件）。
3. **Tauri + 云端列表行**：`invokeResolveKnowledgeMarkdownTarget({ title, filePath: TAURI_KNOWLEDGE_DIR })`；若目标不存在 → 同「仅删库」；若存在 → `deleteLocalPath = target.path`，`localFileDeleteOnly = false`，打开 `deleteLocalOpen`，文案为库+盘双删。

**确认删除（本次已拆分为多个 handler）**

- 本地文件夹浏览列表（仅删磁盘）：`onConfirmDeleteLocalFolderFile`（见 §2.6.4）。
- 合并删除主路径（旧行为，先删在线再删本地）：`onConfirmDeleteBoth`（见 §2.6.4）。

---

#### 2.6.1 新增需求：删除确认框提供「删除本地文件」「删除在线文件」

本次增强的目标是在**不影响现有功能**的前提下，为「数据库模式 + 桌面端（Tauri）+ 已定位到同名本地文件」这一合并删除场景提供更细粒度的选择：

- **删除本地文件**：只删磁盘 `.md`，不动云端数据库记录。
- **删除在线文件**：只删云端数据库记录，保留本地 `.md` 文件。
- **同时删除**：保持旧行为（先删在线，再删本地），确保历史逻辑与用户习惯不被破坏。

> 术语说明：这里的“在线文件”指云端知识库**数据库记录**（API `deleteKnowledge` 删除），并非对象存储文件；为贴合产品文案沿用“在线文件”称呼。

#### 2.6.2 关键设计点（保证“不影响当前功能”）

1. **仅在合并删除弹窗出现额外按钮**  
   `localFileDeleteOnly === true`（本地文件夹浏览列表）仍保持**只有一个「删除」按钮**，行为不变：只删磁盘并刷新本地列表。
2. **保留原主按钮行为**  
   合并删除弹窗的主按钮从文案上调整为「同时删除」，但其底层逻辑与原先单按钮「删除」一致：**先删库再删本地**。
3. **复用原有删除能力**  
   - 删在线复用 `handleDeleteApi`（内部包含登录态校验、Toast、`knowledgeStore.removeFromLocalList`、`onDeletedRecord` 回调）。
   - 删本地复用 `invokeDeleteKnowledgeMarkdown`（Rust 侧已有严格的 `.md` 删除校验与路径解析）。

#### 2.6.3 代码：`Confirm` 支持 tertiary 按钮（用于分流删除）

`Confirm` 原先只有主确认 + 可选 `secondaryAction`。为了在不改动既有弹窗样式与调用方代码的前提下扩展能力，本次新增了可选 `tertiaryAction`（第三个操作按钮）。

```tsx
// apps/frontend/src/components/design/Confirm/index.tsx
//
// 说明：
// - confirm = 主确认按钮（通常用于“覆盖保存/删除”等）
// - secondary = 可选第二操作按钮（历史用途：另存为）
// - tertiary = 可选第三操作按钮（本次用途：删除在线文件）
// - 这三个按钮均可“缺省不传”，不影响旧调用点。

interface ConfirmProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: ReactNode;

  confirmText?: string;
  cancelText?: string;
  confirmVariant?: 'default' | 'destructive';
  closeOnConfirm?: boolean;
  confirmOnEnter?: boolean;
  onConfirm: () => void;

  // secondary：位于“取消”和“主确认”之间，常用于“另存为/删除本地”等非主路径动作
  secondaryActionText?: string;
  onSecondaryAction?: () => void | Promise<void>;

  // tertiary：位于 secondary 与主确认之间（更靠近主操作），可用于另一条重要分支
  tertiaryActionText?: string;
  onTertiaryAction?: () => void | Promise<void>;
  tertiaryVariant?: 'outline' | 'destructive';
}

// 渲染顺序（从左到右）：
// 取消 → secondary（可选）→ tertiary（可选）→ 主确认
```

#### 2.6.4 代码：`KnowledgeList` 的删除分流实现

下面摘录的是“涉及本地文件的确认框”相关核心逻辑，并补充详细中文注释（便于未来维护者快速理解各分支为何存在）。

```tsx
// apps/frontend/src/views/knowledge/KnowledgeList.tsx

// 统一收口：关闭弹窗 + 清理状态，避免不同按钮分支忘记 reset 造成下次误用旧选中项
const closeDeleteLocalDialog = useCallback(() => {
  setDeleteLocalOpen(false);
  setDeleteLocalPath('');
  setLocalFileDeleteOnly(false);
  setSelectKnowledge(null);
}, []);

// ① 本地文件夹浏览列表：只删磁盘文件（与旧行为一致）
// 触发条件：localFileDeleteOnly === true 且 selectKnowledge.localAbsolutePath 存在
const onConfirmDeleteLocalFolderFile = useCallback(async () => {
  if (!selectKnowledge?.localAbsolutePath) return;
  try {
    // 注意：这里传入完整 .md 绝对路径，Rust 会按“单文件路径”规则删除
    const result = await invokeDeleteKnowledgeMarkdown({
      title: selectKnowledge.title ?? '',
      filePath: deleteLocalPath,
    });
    if (result.success === 'success') {
      Toast({ type: 'success', title: '文件已删除' });
      closeDeleteLocalDialog();
      // 合成 id 由调用方（index.tsx）决定是否清空编辑器
      onAfterLocalDelete?.(selectKnowledge.id);
      // 刷新本地扫描列表，确保 UI 立即消失
      await loadLocalMarkdownList();
    } else {
      Toast({ type: 'error', title: '删除失败', message: result.message });
    }
  } catch (e) {
    Toast({ type: 'error', title: formatTauriInvokeError(e) });
  }
}, [closeDeleteLocalDialog, deleteLocalPath, loadLocalMarkdownList, onAfterLocalDelete, selectKnowledge]);

// ② 合并删除弹窗：仅删本地（保留在线记录）
// 触发方式：Confirm.secondaryActionText = "删除本地文件"
const onSecondaryDeleteLocalOnly = useCallback(async () => {
  if (!selectKnowledge) return;
  try {
    // 注意：这里传 TAURI_KNOWLEDGE_DIR（默认目录）+ title，
    // Rust 会解析到“默认目录下同名文件”，与旧的“同时删除”本地部分一致。
    const result = await invokeDeleteKnowledgeMarkdown({
      title: selectKnowledge.title ?? '',
      filePath: TAURI_KNOWLEDGE_DIR,
    });
    if (result.success === 'success') {
      Toast({ type: 'success', title: '本地文件已删除' });
      closeDeleteLocalDialog();
      // 只删本地也可能需要清空编辑器（例如当前正在编辑的本地文件被删）
      onAfterLocalDelete?.(selectKnowledge.id);
    } else {
      Toast({ type: 'error', title: '删除失败', message: result.message });
    }
  } catch (e) {
    Toast({ type: 'error', title: formatTauriInvokeError(e) });
  }
}, [closeDeleteLocalDialog, onAfterLocalDelete, selectKnowledge]);

// ③ 合并删除弹窗：仅删在线（保留本地文件）
// 触发方式：Confirm.tertiaryActionText = "删除在线文件"
const onTertiaryDeleteOnlineOnly = useCallback(async () => {
  if (!selectKnowledge) return;
  // handleDeleteApi 内含：登录态校验、调用 deleteKnowledge、从 store 本地列表移除、触发 onDeletedRecord
  const ok = await handleDeleteApi(selectKnowledge);
  if (ok) closeDeleteLocalDialog();
}, [closeDeleteLocalDialog, handleDeleteApi, selectKnowledge]);

// ④ 合并删除弹窗：同时删除（保持旧行为：先删在线、再删本地）
// 触发方式：Confirm 主确认按钮（confirmText="同时删除"）
const onConfirmDeleteBoth = useCallback(async () => {
  if (!selectKnowledge) return;
  try {
    const dbOk = await handleDeleteApi(selectKnowledge);
    if (!dbOk) return;
    const result = await invokeDeleteKnowledgeMarkdown({
      title: selectKnowledge.title ?? '',
      filePath: TAURI_KNOWLEDGE_DIR,
    });
    if (result.success === 'success') {
      Toast({ type: 'success', title: '已同时删除' });
      closeDeleteLocalDialog();
      onAfterLocalDelete?.(selectKnowledge.id);
    } else {
      // 这里刻意提示“本地文件删除失败”，因为在线记录已删成功，便于用户补救
      Toast({ type: 'error', title: '本地文件删除失败', message: result.message });
    }
  } catch (e) {
    Toast({ type: 'error', title: formatTauriInvokeError(e) });
  }
}, [closeDeleteLocalDialog, handleDeleteApi, onAfterLocalDelete, selectKnowledge]);
```

#### 2.6.5 UI：确认框按钮配置（仅合并删除场景出现三按钮）

```tsx
// apps/frontend/src/views/knowledge/KnowledgeList.tsx
// deleteLocalOpen 弹窗：
//
// - localFileDeleteOnly=true（本地文件夹列表）：只有一个“删除”按钮
// - localFileDeleteOnly=false（合并删除）：出现“删除本地文件”“删除在线文件”“同时删除”

<Confirm
  open={deleteLocalOpen}
  onOpenChange={(v) => {
    setDeleteLocalOpen(v);
    if (!v) {
      // 关闭时清状态，避免下次误用上一次的 path/选中项
      setDeleteLocalPath('');
      setLocalFileDeleteOnly(false);
      setSelectKnowledge(null);
    }
  }}
  title="删除文件？"
  confirmText={localFileDeleteOnly ? '删除' : '同时删除'}
  confirmVariant="destructive"
  closeOnConfirm={false}
  onConfirm={localFileDeleteOnly ? onConfirmDeleteLocalFolderFile : onConfirmDeleteBoth}
  {...(localFileDeleteOnly
    ? {}
    : {
        // 仅合并删除弹窗展示两个额外按钮
        secondaryActionText: '删除本地文件',
        onSecondaryAction: onSecondaryDeleteLocalOnly,
        tertiaryActionText: '删除在线文件',
        tertiaryVariant: 'destructive',
        onTertiaryAction: onTertiaryDeleteOnlineOnly,
      })}
/>
```

**父页 `views/knowledge/index.tsx`**

- `onDeletedRecord`：`knowledgeEditingKnowledgeId === id` 时 `resetEditorToNewDraft()`。
- `onAfterLocalDelete`：比较**合成 id**（`__local_md__:…`），一致则清空草稿。

**Rust**：`delete_knowledge_markdown` 与保存共用路径解析（`DeleteKnowledgeMarkdownInput` / `compute_save_target_path`）；仅允许删除 `.md` 文件。

```mermaid
flowchart TD
  Trash[点击行内删除图标] --> StopProp[stopPropagation 避免触发行打开]
  StopProp --> Open[openDeleteFlow]
  Open --> Q1{localAbsolutePath 且 Tauri?}
  Q1 -->|是| OnlyDisk[localFileDeleteOnly=true 弹 deleteLocalOpen]
  Q1 -->|否| Q2{Tauri?}
  Q2 -->|否| OnlyApi[deleteRecordOnlyOpen 仅删库]
  Q2 -->|是| Resolve[invokeResolveKnowledgeMarkdownTarget]
  Resolve --> Q3{文件存在?}
  Q3 -->|否| OnlyApi
  Q3 -->|是| ApiDisk[localFileDeleteOnly=false 弹 deleteLocalOpen]
  OnlyDisk --> Invoke1[invokeDeleteKnowledgeMarkdown 全路径]
  ApiDisk --> DelApi[handleDeleteApi 再 invoke 默认目录]
```

### 2.7 本地落盘同名冲突：覆盖保存与另存为

**触发条件（桌面端）**

- 用户在知识页点击保存（或快捷键）时，先组 `SaveKnowledgeMarkdownPayload`（`title` = 当前编辑器标题 trim、`filePath` = 本地扫描目录或默认 `TAURI_KNOWLEDGE_DIR`、可选 `previousTitle` 用于重命名）。
- 调用 `invokeResolveKnowledgeMarkdownTarget`：若返回 **`exists: true`**，说明目标路径上已有文件，**不**直接写入，而是由 `knowledgeStore.openKnowledgeOverwriteConfirm(targetPath, payload)` 打开确认弹窗，并记住待保存的 `payload`。

**状态（MobX）**

- `knowledgeOverwriteOpen`：弹窗显隐。
- `knowledgeOverwriteTargetPath`：冲突文件的绝对路径，用于文案展示。
- `knowledgePendingSavePayload`：打开弹窗时的保存入参快照；确认「覆盖」或「另存为」时从中读取目录等信息。
- `knowledgeLocalDiskTitle`：**磁盘侧**上次保存/打开时认定的文件名（无路径）；与 `knowledgeTitle`（编辑器展示）可分离——另存为后磁盘名为带时间后缀的文件名，但编辑器标题 intentionally 不变，下次保存时 `previousTitle` 仍指向磁盘上的真实文件名。

**「覆盖保存」**

- 先走既有 `persistKnowledgeApi()`（本地合成 id 则跳过接口）。
- 将挂起 `payload` 与 `overwrite: true` 合并后 `runTauriSave`。
- 成功后：`setKnowledgeLocalDiskTitle(merged.title)`（与当前编辑器标题一致）、`syncSnapshotAfterPersist`、关弹窗。

**「另存为」**

- **不**调用 `setKnowledgeTitle`：界面标题保持用户当前看到的名字。
- 用 `pickNonConflictingDiskFileTitle(展示标题, pendingBase)` 在**同一目录**内生成新文件名：在「主名」与扩展名之间插入 `_年-月-日-时:分:秒`（例如 `_2026-04-01-15:30:45`）；若该名仍冲突则再追加 `_2`、`_3`…（最多尝试 50 次）。
- Rust `sanitize_filename` 会把非法路径字符（含 `:`）替换为 `-`，故 Windows 上实际文件名中时间为 `15-30-45` 形式。
- `persistKnowledgeApiSaveAs(展示标题)`：**新建**一条云端记录（不更新当前编辑 id 为「更新」语义）；若当前是 `__local_md__:` 纯本地会话则**直接 return**，不调接口，仅写磁盘。
- `runTauriSave` 使用 **`title: diskTitle`**、`overwrite: false`。
- 成功后：`knowledgeLocalDiskTitle = diskTitle`；`syncSnapshotAfterPersist(展示标题, markdown)` 使脏标记与「展示标题 + 正文」一致；若原为纯本地打开且 invoke 返回 `filePath`，则用新路径更新 `knowledgeEditingKnowledgeId`（合成 id）与 `knowledgeLocalDirPath`，保证后续保存仍针对新文件。

**UI 组件**

- `Confirm` 增加可选第三按钮：`secondaryActionText` + `onSecondaryAction`，样式 outline，位于「取消」与主操作（覆盖保存，destructive）之间。
- 覆盖弹窗设置 `closeOnConfirm={false}`，因 `onConfirm` 为异步，失败时需保持打开；`confirmOnEnter` 仅绑定主确认键，避免与编辑器抢键（内部已排除 input/contenteditable）。

```mermaid
flowchart TD
  Save[onSave] --> Tauri{Tauri?}
  Tauri -->|否| ApiOnly[persistKnowledgeApi 等]
  Tauri -->|是| Resolve[invokeResolveKnowledgeMarkdownTarget]
  Resolve --> Exists{exists?}
  Exists -->|否| Write[persist + runTauriSave]
  Exists -->|是| Open[openKnowledgeOverwriteConfirm]
  Open --> Dialog[Confirm: 取消 / 另存为 / 覆盖保存]
  Dialog --> Cancel[关弹窗]
  Dialog --> SaveAs[onSaveAsFromOverwrite]
  Dialog --> Over[onConfirmOverwrite]
  SaveAs --> Pick[pickNonConflictingDiskFileTitle]
  Pick --> ApiNew[persistKnowledgeApiSaveAs 展示标题]
  ApiNew --> TauriNew[runTauriSave diskTitle]
  Over --> ApiUp[persistKnowledgeApi]
  ApiUp --> TauriOv[runTauriSave overwrite true]
```

### 2.8 本地文件夹：在外部编辑器（Cursor / Trae）中打开

**范围**

- 仅当抽屉内 **数据来源 = 本地文件夹** 且运行环境为 **Tauri** 时，列表每一行在 **删除按钮左侧** 显示 `Code2` 图标按钮。
- 云端数据库列表无此按钮（无 `localAbsolutePath`）。

**前端**

- 点击后 `stopPropagation`，避免触发行点击打开详情。
- 调用 `invokeOpenKnowledgeMarkdownInEditor(localAbsolutePath)`，成功 Toast 展示 Rust 返回的 `openedWith`（`Cursor` 或 `Trae`）。

**Tauri 命令 `open_knowledge_markdown_in_editor`**

- 入参：`filePath`（camelCase）为绝对路径。
- 校验：非空、路径为已存在普通文件、扩展名为 `.md`（与读文件命令一致）。
- 通过 `detect_markdown_editor()` 决定用哪种编辑器，再 `open_markdown_with_detected_editor` 执行打开。

**编辑器选择逻辑 `detect_markdown_editor`（优先级）**

1. **前台应用名**（macOS：`osascript` + System Events；Windows：PowerShell + `user32` 取前台进程名）：名中含 `cursor` → Cursor；含 `trae` → Trae。
2. 否则判断 **是否已有对应进程在运行**（避免用户正在本应用内点击时前台永远是本应用）：
   - **macOS Cursor**：AppleScript 枚举进程名是否含 `Cursor`；`/bin/ps -ax -o command=` 是否含 `Cursor.app/`、`Cursor Helper`、`MacOS/Cursor`；`/usr/bin/pgrep` 多种参数。
   - **macOS Trae**：`pgrep -x Trae` / `Trae CN`、`pgrep -f Trae.app`。
   - **Windows**：`tasklist` 文本中是否含 `cursor.exe` / `trae.exe`。
   - **Linux 等**：`pgrep` 等；前台名在非 macOS/Windows 上可能恒为「无」。
3. **仍无法判定进程时（仅 macOS）**：检查 `/Applications` 与 `~/Applications` 下是否存在 `Cursor.app`、`Trae.app` / `Trae CN.app`——仅 Cursor → Cursor；仅 Trae → Trae；**两者皆装则优先 Cursor**；皆无则返回 Trae（后续打开会走 Trae 分支，可能报错提示安装）。
4. 在 **2** 中已明确 **优先 Cursor 再 Trae**，与「Cursor 已开、Trae 未开」的预期一致。

**实际打开方式**

- **macOS + Cursor**：依次尝试 `open -b com.todesktop.230313mzl4w4u92`（Todesktop 分发常见 Bundle ID）、`open -a Cursor`、`cursor <路径>`（PATH 中的 CLI）。
- **macOS + Trae**：`open -a Trae`，失败则 `open -a Trae CN`。
- **非 macOS + Cursor / Trae**：`std::process::Command` 启动 `cursor` / `trae` 可执行文件并传入路径。
- `open` 一律使用 **`/usr/bin/open`**，避免 GUI 进程 `PATH` 过短找不到命令。

**权限与维护**

- macOS 若未授权本应用通过 **自动化** 控制 **System Events**，AppleScript 列举进程可能失败，此时仍依赖 `ps` / `pgrep` / 安装目录兜底。
- Cursor 若更换 Bundle ID，需同步修改 `CURSOR_MACOS_BUNDLE_ID` 常量。

```mermaid
flowchart LR
  Row[本地行 hover] --> Btn[Code2 按钮]
  Btn --> Inv[invokeOpenKnowledgeMarkdownInEditor]
  Inv --> Cmd[open_knowledge_markdown_in_editor]
  Cmd --> Pick[detect_markdown_editor]
  Pick --> Open[open_markdown_with_detected_editor]
  Open --> Cur[Cursor 打开链 / Trae 打开链]
```

---

## 3. 核心代码与逐行注释

以下「逐行」指摘录块内**每一行源码**均配有说明；超长 UI 结构仅保留与行为相关的属性行注释。

### 3.1 `constants.ts` — 前缀与判定

```ts
/** Tauri 下默认知识库目录（与保存/删除 invoke 使用的目录约定一致） */
export const TAURI_KNOWLEDGE_DIR =
	"/Users/dnhyxc/Documents/code/dnhyxc-ai/knowledge";

/** 本地 .md 列表项的合成 id 前缀，避免与云端 UUID 混淆 */
export const KNOWLEDGE_LOCAL_MD_ID_PREFIX = "__local_md__:";

/** 根据 id 判断是否当前处于「仅写本地、不调云端 CRUD」的编辑会话 */
export function isKnowledgeLocalMarkdownId(
	id: string | null | undefined,
): boolean {
	return (
		id != null && // null / undefined 视为云端或新草稿
		id !== "" && // 空字符串不当作本地前缀 id
		id.startsWith(KNOWLEDGE_LOCAL_MD_ID_PREFIX) // 以前缀匹配为准
	);
}

/** 编辑器区域高度 CSS */
export const EDITOR_HEIGHT = "calc(100vh - 172px)";
```

### 3.2 `types/index.ts` — 类型扩展

```ts
export type KnowledgeRecord = {
	id: string;
	title: string | null;
	content: string;
	author: string | null;
	authorId: number | null;
	createdAt?: string;
	updatedAt?: string;
	/**
	 * 从本地文件夹打开时：Tauri 保存应使用的目录（一般为该文件父目录），
	 * 与仅用 TAURI_KNOWLEDGE_DIR 的云端条目区分
	 */
	localDirPath?: string;
};

/** 列表展示用：无 content；可附带本地绝对路径供读/删 */
export type KnowledgeListItem = Omit<KnowledgeRecord, "content"> & {
	localAbsolutePath?: string; // 有值表示该行来自本地扫描，而非接口列表
};
```

### 3.3 `knowledge.ts`（编辑器草稿段）— 目录状态与清空

```ts
	/**
	 * 从本地文件夹列表打开时：保存/覆盖解析使用的目录（该文件所在目录）；
	 * 云端条目保持 null，保存时用 TAURI_KNOWLEDGE_DIR
	 */
	knowledgeLocalDirPath: string | null = null;

	setKnowledgeLocalDirPath(value: string | null) {
		this.knowledgeLocalDirPath = value; // 打开本地文件时写入父目录；云端打开时置 null
	}

	clearKnowledgeDraft() {
		this.knowledgeTitle = '';
		this.knowledgeEditingKnowledgeId = null;
		this.knowledgeLocalDiskTitle = null;
		this.knowledgeLocalDirPath = null; // 清空本地目录上下文，避免沿用上一文件的保存目录
		this.knowledgePersistedSnapshot = { title: '', content: '' };
		this.markdown = '';
		// ... 覆盖弹窗等一并重置
	}

	applyKnowledgeDraftFromChatReply(markdown: string) {
		// ...
		this.knowledgeLocalDirPath = null; // 从聊天注入草稿时按默认目录保存，不设本地扫描目录
	}
```

（`knowledgeOverwriteOpen`、`knowledgePendingSavePayload`、`openKnowledgeOverwriteConfirm` 等与「覆盖 / 另存为」相关的字段与方法见 **§3.11.1**。）

### 3.4 `knowledge-save.ts` — invoke 封装

```ts
/** 列出目录下 .md 的入参：dirPath 缺省则由 Rust 使用默认知识库目录 */
export type ListKnowledgeMarkdownInput = {
	dirPath?: string;
};

/** Rust 序列化 camelCase：updatedAtMs 对应 updated_at_ms */
export type KnowledgeMarkdownFileEntry = {
	path: string; // 绝对路径
	title: string; // 文件名去扩展名
	updatedAtMs: number; // 修改时间毫秒，前端转 ISO 展示
};

export async function invokeListKnowledgeMarkdownFiles(
	input: ListKnowledgeMarkdownInput,
): Promise<KnowledgeMarkdownFileEntry[]> {
	const { invoke } = await import("@tauri-apps/api/core");
	return invoke<KnowledgeMarkdownFileEntry[]>("list_knowledge_markdown_files", {
		input: {
			// 仅非空时传 dirPath，否则 Rust 收到「未传」用默认目录
			...(input.dirPath != null && input.dirPath !== ""
				? { dirPath: input.dirPath }
				: {}),
		},
	});
}

export async function invokeReadKnowledgeMarkdownFile(
	filePath: string,
): Promise<string> {
	const { invoke } = await import("@tauri-apps/api/core");
	const res = await invoke<{ content: string }>(
		"read_knowledge_markdown_file",
		{
			input: { filePath }, // 与 Rust ReadKnowledgeMarkdownFileInput 对齐
		},
	);
	return res.content; // 只把正文交给调用方
}
```

### 3.5 `views/knowledge/index.tsx` — 云端跳过与保存目录

```ts
const persistKnowledgeApi = useCallback(async () => {
	const markdown = knowledgeStore.markdown ?? "";
	const trimmedTitle = knowledgeStore.knowledgeTitle.trim();
	const base = { title: trimmedTitle, content: markdown };
	const meta = buildAuthorMeta(getUserInfo);
	const editingId = knowledgeStore.knowledgeEditingKnowledgeId;
	/** 本地合成 id：不写后端，仅后续 Tauri 落盘 */
	if (isKnowledgeLocalMarkdownId(editingId)) {
		return; // 既不 update 也不 saveKnowledge
	}
	if (editingId) {
		// 云端更新...
	} else {
		// 云端新建...
	}
}, [knowledgeStore, getUserInfo]);
```

```ts
if (isTauriRuntime()) {
	const diskTitle = knowledgeStore.knowledgeLocalDiskTitle;
	const previousTitle =
		knowledgeStore.knowledgeEditingKnowledgeId &&
		diskTitle &&
		diskTitle !== trimmedTitle
			? diskTitle
			: undefined; // 标题变更时传给 Rust 做本地文件重命名
	const tauriBaseDir = isKnowledgeLocalMarkdownId(
		knowledgeStore.knowledgeEditingKnowledgeId,
	)
		? knowledgeStore.knowledgeLocalDirPath?.trim() || TAURI_KNOWLEDGE_DIR // 本地条目优先用打开文件所在目录
		: TAURI_KNOWLEDGE_DIR; // 云端条目固定默认目录
	const payload: SaveKnowledgeMarkdownPayload = {
		title: trimmedTitle,
		content: markdown,
		filePath: tauriBaseDir, // 与既有 resolve/save 语义一致：目录 + 标题 → 路径
		...(previousTitle ? { previousTitle } : {}),
	};
	// invokeResolveKnowledgeMarkdownTarget → 存在则弹覆盖确认
}
```

```ts
const handlePickRecord = useCallback(
	(record: KnowledgeRecord) => {
		knowledgeStore.setKnowledgeOverwriteOpen(false);
		knowledgeStore.setKnowledgeEditingKnowledgeId(record.id);
		knowledgeStore.setKnowledgeLocalDirPath(record.localDirPath ?? null); // 本地打开带目录；云端为 null
		const t = (record.title ?? "").trim();
		knowledgeStore.setKnowledgeLocalDiskTitle(t || null);
		const content = record.content ?? "";
		knowledgeStore.setKnowledgePersistedSnapshot({ title: t, content });
		knowledgeStore.setKnowledgeTitle(record.title ?? "");
		knowledgeStore.setMarkdown(content);
	},
	[knowledgeStore],
);
```

### 3.6 `KnowledgeList.tsx` — 路径工具与列表映射

```ts
/** 从绝对路径取父目录，兼容正斜杠与反斜杠 */
function dirnameFs(filePath: string): string {
	const n = filePath.replace(/[/\\]+$/, ""); // 去掉末尾多余分隔符
	const i = Math.max(n.lastIndexOf("/"), n.lastIndexOf("\\")); // 取最后一段分隔符
	if (i <= 0) return n; // 无分隔符则整体当作目录名退化处理
	return n.slice(0, i); // 父目录
}
```

```ts
const loadLocalMarkdownList = useCallback(async () => {
	if (!isTauriRuntime()) return; // 浏览器不调 Rust
	setLocalLoading(true);
	try {
		const entries = await invokeListKnowledgeMarkdownFiles({
			dirPath: localFolderPath.trim() || undefined, // 空串则走默认目录
		});
		setLocalList(
			entries.map((e) => ({
				id: `${KNOWLEDGE_LOCAL_MD_ID_PREFIX}${encodeURIComponent(e.path)}`, // 合成唯一 id
				title: e.title,
				author: null,
				authorId: null,
				updatedAt: new Date(e.updatedAtMs).toISOString(), // 与 formatDate 一致
				localAbsolutePath: e.path, // 后续读文件、删文件、展示路径
			})),
		);
	} catch (e) {
		Toast({
			/* ... */
		});
		setLocalList([]); // 失败时清空列表避免展示脏数据
	} finally {
		setLocalLoading(false);
	}
}, [localFolderPath]);
```

```ts
const handleRowClick = useCallback(
	async (item: KnowledgeListItem) => {
		if (item.localAbsolutePath) {
			try {
				const content = await invokeReadKnowledgeMarkdownFile(
					item.localAbsolutePath,
				);
				const dir = dirnameFs(item.localAbsolutePath);
				const record: KnowledgeRecord = {
					id: item.id,
					title: item.title,
					content,
					author: null,
					authorId: null,
					updatedAt: item.updatedAt,
					localDirPath: dir, // 保存时 filePath 用此目录
				};
				await onPick?.(record);
				onOpenChange(false);
			} catch (e) {
				Toast({
					/* ... */
				});
			}
			return; // 不再走 fetchDetail
		}
		const detail = await knowledgeStore.fetchDetail(item.id); // 云端条目
		// ...
	},
	[knowledgeStore, onPick, onOpenChange],
);
```

（行内删除的完整逐行注释见 **§3.10**。）

### 3.7 `knowledge.rs` — 列出与读取（Rust）

```rust
/// 递归收集目录下（含子目录）的 `.md` 文件路径
fn collect_md_files(dir: &Path, out: &mut Vec<PathBuf>) -> Result<(), String> {
	let rd = fs::read_dir(dir).map_err(|e| e.to_string())?; // 打开目录
	for ent in rd {
		let ent = ent.map_err(|e| e.to_string())?;
		let name = ent.file_name();
		if name.to_string_lossy().starts_with('.') {
			continue; // 跳过 .git、.DS_Store 等隐藏目录
		}
		let p = ent.path();
		let meta = ent.metadata().map_err(|e| e.to_string())?;
		if meta.is_dir() {
			collect_md_files(&p, out)?; // 深度优先递归
		} else if meta.is_file() && is_md_file_path(&p) {
			out.push(p); // 仅收集 md
		}
	}
	Ok(())
}
```

```rust
#[tauri::command]
pub async fn list_knowledge_markdown_files(
	app: AppHandle,
	input: ListKnowledgeMarkdownInput,
) -> Result<Vec<KnowledgeMarkdownFileEntry>, String> {
	let dir = match input.dir_path.as_ref().map(|s| s.trim()).filter(|s| !s.is_empty()) {
		Some(d) => PathBuf::from(d),           // 用户指定目录
		None => resolve_knowledge_dir(&app).await?, // 与保存默认目录一致
	};
	// ... 校验存在且为目录
	let mut paths: Vec<PathBuf> = Vec::new();
	collect_md_files(&dir, &mut paths)?;
	paths.sort_by(|a, b| {
		let ta = fs::metadata(a).and_then(|m| m.modified()).ok();
		let tb = fs::metadata(b).and_then(|m| m.modified()).ok();
		tb.cmp(&ta) // 修改时间新的排前
	});
	// ... 填充 path / title / updated_at_ms
	Ok(out)
}
```

```rust
#[tauri::command]
pub fn read_knowledge_markdown_file(
	input: ReadKnowledgeMarkdownFileInput,
) -> Result<ReadKnowledgeMarkdownFileResult, String> {
	let trimmed = input.file_path.trim();
	if trimmed.is_empty() {
		return Err("filePath 不能为空".to_string());
	}
	let p = PathBuf::from(trimmed);
	if !p.exists() || !p.is_file() {
		return Err("文件不存在或不是普通文件".to_string());
	}
	if !is_md_file_path(&p) {
		return Err("仅允许读取 .md 文件".to_string());
	}
	let content = fs::read_to_string(&p).map_err(|e| e.to_string())?;
	Ok(ReadKnowledgeMarkdownFileResult { content })
}
```

### 3.8 `lib.rs` — 命令注册（节选）

```rust
use command::knowledge::{
    delete_knowledge_markdown, list_knowledge_markdown_files, read_knowledge_markdown_file,
    resolve_knowledge_markdown_target, save_knowledge_markdown,
};
// ...
        .invoke_handler(tauri::generate_handler![
            // ...
            delete_knowledge_markdown,     // 前端：invokeDeleteKnowledgeMarkdown
            list_knowledge_markdown_files, // 前端：invokeListKnowledgeMarkdownFiles
            read_knowledge_markdown_file,  // 前端：invokeReadKnowledgeMarkdownFile
        ])
```

### 3.9 `Monaco/index.tsx` — 外部 `value` 同步（逐行）

```ts
/** 记录上一次完成同步时的 documentIdentity，用于判断是否「换篇」 */
const prevIdentityForValueSyncRef = useRef(documentIdentity);
```

```ts
/**
 * 不向 Editor 传受控 value；外部正文与模型不一致时 setValue。
 * 有焦点时若父组件 value 因 RAF 合并略滞后于编辑器，不可覆盖正在输入的内容；
 * 但「清空」或「换篇」（documentIdentity 变化）必须写入。
 */
useEffect(() => {
	const ed = editorRef.current;
	if (!ed || imeComposingRef.current || ed.inComposition) return; // IME 中间态不写
	const next = normalizeMonacoEol(value ?? ""); // 父组件目标正文
	const cur = normalizeMonacoEol(ed.getValue()); // 编辑器当前正文
	const identityChanged =
		prevIdentityForValueSyncRef.current !== documentIdentity; // 是否换了一篇文档
	if (cur === next) {
		lastEmittedRef.current = next; // 已与 props 对齐
		prevIdentityForValueSyncRef.current = documentIdentity; // 同步 identity 记忆
		return; // 无需 setValue
	}
	const clearing = next === ""; // 外部要求清空
	if (ed.hasTextFocus() && !clearing && !identityChanged) return; // 焦点内且非清空、非换篇：防 RAF 滞后误覆盖
	prevIdentityForValueSyncRef.current = documentIdentity; // 即将写入，更新记忆
	lastEmittedRef.current = next;
	ed.setValue(next); // 强制与 props 一致
	ed.updateOptions({ placeholder: next.trim() ? "" : placeholder }); // 占位符与正文联动
}, [value, placeholder, documentIdentity]); // identity 参与：换篇必同步
```

### 3.10 `KnowledgeList.tsx` / `knowledge-save.ts` / `index.tsx` — 删除操作（逐行注释）

#### 3.10.1 前端 invoke 封装

```ts
/** Tauri `delete_knowledge_markdown` 入参（与保存共用路径规则） */
export type DeleteKnowledgeMarkdownPayload = {
	title: string; // 与 filePath/dirPath 一起解析目标文件（目录模式下为「标题.md」）
	filePath?: string; // 可为完整 .md 路径或目录；本地列表删除传绝对路径文件
	dirPath?: string; // 仅目录时等价于 filePath 传目录
};

/** 桌面端按标题与路径删除本地 Markdown */
export async function invokeDeleteKnowledgeMarkdown(
	payload: DeleteKnowledgeMarkdownPayload,
): Promise<SaveKnowledgeMarkdownResult> {
	const { invoke } = await import("@tauri-apps/api/core"); // 动态 import，避免非 Tauri 打包问题
	return invoke<SaveKnowledgeMarkdownResult>("delete_knowledge_markdown", {
		input: buildDeleteInvokeInput(payload), // 转成 Rust 期望的 camelCase 字段
	});
}
```

#### 3.10.2 列表行：删除按钮（与数据源无关，样式一致）

```tsx
/** 单行：点击打开详情；删除图标与数据库列表一致，仅行 hover 时显示 */
function KnowledgeListRow(props: {
	item: KnowledgeListItem; // 云端或本地项；本地项带 localAbsolutePath
	selected: boolean; // 是否与当前编辑器 knowledgeEditingKnowledgeId 一致
	onActivate: (item: KnowledgeListItem) => void; // 点击行主体打开详情
	onTrashClick: (e: React.MouseEvent, item: KnowledgeListItem) => void; // 删除
}) {
	const { item, selected, onActivate, onTrashClick } = props; // 解构 props

	const onKeyDown = (e: React.KeyboardEvent) => {
		if (e.key === "Enter" || e.key === " ") {
			// 键盘激活行同点击
			e.preventDefault(); // 避免空格滚动页面
			void onActivate(item); // 打开条目
		}
	};

	return (
		<div
			role="button" // 可聚焦、可键盘操作
			tabIndex={0}
			aria-current={selected ? "true" : undefined} // 当前编辑高亮
			onClick={() => void onActivate(item)} // 整行打开详情
			onKeyDown={onKeyDown}
			className={cn(
				"w-full cursor-pointer overflow-hidden flex flex-col gap-1 p-2 rounded-md group transition-colors",
				// ↑ 必须有 group，供子元素 group-hover 显示删除钮
				selected ? "bg-theme/15" : "hover:bg-theme/10",
			)}
		>
			<div className="flex items-start justify-between gap-2 min-w-0 w-full">
				<div className="flow-root flex-1 min-w-0 max-w-full font-medium wrap-anywhere">
					{item.title?.trim() || "未命名"} {/* 列表标题 */}
				</div>
				<button
					type="button"
					aria-label={
						item.localAbsolutePath ? "删除本地 Markdown 文件" : "从知识库删除"
					} // 读屏区分语义；视觉样式相同
					className={cn(
						"cursor-pointer shrink-0 p-1 rounded-md text-textcolor/80 transition-opacity duration-150",
						"opacity-0 pointer-events-none", // 默认隐藏且不可点，避免误触
						"hover:text-destructive hover:bg-destructive/10", // 悬停删除钮本身高亮
						"group-hover:opacity-100 group-hover:pointer-events-auto", // 悬停整行才显示
					)}
					onClick={(e) => onTrashClick(e, item)} // 冒泡外层由 onTrashClick 内 stopPropagation
				>
					<Trash2 size={16} /> {/* 与数据库行相同图标尺寸 */}
				</button>
			</div>
			<div className="text-xs text-textcolor/50 space-y-0.5">
				更新 {formatDate(item.updatedAt?.toString() ?? "")}
			</div>
		</div>
	);
}
```

#### 3.10.3 状态与「仅删库」API

```ts
const [deleteLocalOpen, setDeleteLocalOpen] = useState(false); // 磁盘相关确认框显隐
const [deleteLocalPath, setDeleteLocalPath] = useState(""); // 弹窗展示的完整路径
const [localFileDeleteOnly, setLocalFileDeleteOnly] = useState(false); // true=只删盘不删库
const [deleteRecordOnlyOpen, setDeleteRecordOnlyOpen] = useState(false); // 仅删库确认框
const [selectKnowledge, setSelectKnowledge] =
	useState<KnowledgeListItem | null>(null); // 待删项

const handleDeleteApi = useCallback(
	async (item: KnowledgeListItem): Promise<boolean> => {
		const res = await deleteKnowledge(item.id); // REST 删除云端记录
		if (!res.success) {
			Toast({
				type: "error",
				title: "删除失败",
				message: res.message || "请稍后重试",
			});
			return false; // 中止后续删本地文件
		}
		knowledgeStore.removeFromLocalList(item.id); // 同步 MobX 列表与 total
		onDeletedRecord?.(item.id); // 通知父页：可能需清空编辑器
		return true;
	},
	[knowledgeStore, onDeletedRecord],
);
```

#### 3.10.4 `openDeleteFlow`（完整分支）

```ts
const openDeleteFlow = useCallback(async (knowledge: KnowledgeListItem) => {
	setLocalFileDeleteOnly(false); // 先清标记，避免沿用上一条的状态
	if (knowledge.localAbsolutePath && isTauriRuntime()) {
		setSelectKnowledge(knowledge); // 与 onTrashClick 重复设置，保证流程内一致
		setDeleteLocalPath(knowledge.localAbsolutePath); // Confirm 展示完整路径
		setLocalFileDeleteOnly(true); // 确认回调走「仅磁盘」分支
		setDeleteLocalOpen(true); // 打开删盘确认
		return; // 不再走云端 resolve
	}
	if (!isTauriRuntime()) {
		setDeleteRecordOnlyOpen(true); // Web 环境只能删库
		return;
	}
	try {
		const target = await invokeResolveKnowledgeMarkdownTarget({
			title: knowledge.title ?? "",
			content: "",
			filePath: TAURI_KNOWLEDGE_DIR, // 默认知识目录下是否有 标题.md
		});
		if (!target.exists) {
			setDeleteRecordOnlyOpen(true); // 无本地文件 → 只删库
			return;
		}
		setDeleteLocalPath(target.path); // 有文件 → 双删确认里展示路径
		setDeleteLocalOpen(true); // localFileDeleteOnly 仍为 false → 先删库再删盘
	} catch (e) {
		Toast({ type: "error", title: formatTauriInvokeError(e) });
	}
}, []);
```

#### 3.10.5 删除确认：拆分为「仅删本地 / 仅删在线 / 同时删除」（逐行注释）

> 说明：本节为 **2026-04** 的新版本实现；旧的 `onConfirmDeleteLocal` 已拆分为多个 handler。拆分的原因是需要在合并删除弹窗中提供「删除本地文件」与「删除在线文件」两条独立路径，同时保留“旧主行为”。

```ts
// 统一收口：关闭弹窗 + 清理状态，避免跨条目残留
const closeDeleteLocalDialog = useCallback(() => {
	setDeleteLocalOpen(false);
	setDeleteLocalPath("");
	setLocalFileDeleteOnly(false);
	setSelectKnowledge(null);
}, []);

// A. 本地文件夹浏览列表：仅删磁盘文件（不涉及云端）
const onConfirmDeleteLocalFolderFile = useCallback(async () => {
	if (!selectKnowledge?.localAbsolutePath) return;
	try {
		const result = await invokeDeleteKnowledgeMarkdown({
			title: selectKnowledge.title ?? "",
			filePath: deleteLocalPath, // 绝对 .md 路径：按“单文件路径”删除
		});
		if (result.success === "success") {
			Toast({ type: "success", title: "文件已删除", message: result.filePath });
			closeDeleteLocalDialog();
			onAfterLocalDelete?.(selectKnowledge.id); // 合成 id：父页可据此清空编辑器
			await loadLocalMarkdownList(); // 确保列表与磁盘一致
		} else {
			Toast({ type: "error", title: "删除失败", message: result.message });
		}
	} catch (e) {
		Toast({ type: "error", title: formatTauriInvokeError(e) });
	}
}, [
	closeDeleteLocalDialog,
	deleteLocalPath,
	loadLocalMarkdownList,
	onAfterLocalDelete,
	selectKnowledge,
]);

// B. 合并删除弹窗：仅删本地（保留在线记录）
const onSecondaryDeleteLocalOnly = useCallback(async () => {
	if (!selectKnowledge) return;
	try {
		const result = await invokeDeleteKnowledgeMarkdown({
			title: selectKnowledge.title ?? "",
			filePath: TAURI_KNOWLEDGE_DIR, // 默认目录 + 标题解析到本地同名文件
		});
		if (result.success === "success") {
			Toast({ type: "success", title: "本地文件已删除", message: result.filePath });
			closeDeleteLocalDialog();
			onAfterLocalDelete?.(selectKnowledge.id);
		} else {
			Toast({ type: "error", title: "删除失败", message: result.message });
		}
	} catch (e) {
		Toast({ type: "error", title: formatTauriInvokeError(e) });
	}
}, [closeDeleteLocalDialog, onAfterLocalDelete, selectKnowledge]);

// C. 合并删除弹窗：仅删在线（保留本地文件）
const onTertiaryDeleteOnlineOnly = useCallback(async () => {
	if (!selectKnowledge) return;
	const ok = await handleDeleteApi(selectKnowledge); // 内含登录态校验 + 删库 + store 更新 + onDeletedRecord
	if (ok) closeDeleteLocalDialog();
}, [closeDeleteLocalDialog, handleDeleteApi, selectKnowledge]);

// D. 合并删除弹窗：同时删除（保留旧行为：先删在线，再删本地）
const onConfirmDeleteBoth = useCallback(async () => {
	if (!selectKnowledge) return;
	try {
		const dbOk = await handleDeleteApi(selectKnowledge);
		if (!dbOk) return; // 只要在线删除失败，就不再动本地，避免“只删了一半”且难以解释
		const result = await invokeDeleteKnowledgeMarkdown({
			title: selectKnowledge.title ?? "",
			filePath: TAURI_KNOWLEDGE_DIR,
		});
		if (result.success === "success") {
			Toast({ type: "success", title: "已同时删除", message: result.filePath });
			closeDeleteLocalDialog();
			onAfterLocalDelete?.(selectKnowledge.id);
		} else {
			// 在线已删成功 → 这里明确提示“本地文件删除失败”，引导用户手动处理磁盘侧
			Toast({ type: "error", title: "本地文件删除失败", message: result.message });
		}
	} catch (e) {
		Toast({ type: "error", title: formatTauriInvokeError(e) });
	}
}, [closeDeleteLocalDialog, handleDeleteApi, onAfterLocalDelete, selectKnowledge]);
```

#### 3.10.6 点击删除与弹窗绑定

```ts
const onTrashClick = useCallback(
	async (e: React.MouseEvent, knowledge: KnowledgeListItem) => {
		e.stopPropagation(); // 防止触发行 onClick 打开详情
		setSelectKnowledge(knowledge); // 先记下当前行（openDeleteFlow 内会再设）
		await openDeleteFlow(knowledge); // 按行类型分支
	},
	[openDeleteFlow],
);

const deleteLocalFileName =
	deleteLocalPath.split(/[/\\]/).filter(Boolean).pop() ?? deleteLocalPath; // 弹窗标题用文件名
```

```tsx
				<Confirm open={deleteRecordOnlyOpen} onConfirm={onConfirmDeleteRecordOnly} title="删除知识库记录？" /* ... */ />
				<Confirm
					open={deleteLocalOpen}
					onOpenChange={(v) => {
						setDeleteLocalOpen(v);
						if (!v) {
							// 关闭弹窗时清理状态，防止下一次删除误用旧数据
							setDeleteLocalPath("");
							setLocalFileDeleteOnly(false);
							setSelectKnowledge(null);
						}
					}}
					title="删除文件？"
					description={
						<>
							{localFileDeleteOnly
								? "将仅从磁盘删除该文件，不涉及云端知识库数据。"
								: "已关联云端知识库条目与本地 Markdown，可选择仅删本地、仅删在线，或同时删除。"}
							{/* ... 文件名与 deleteLocalPath 展示 ... */}
						</>
					}
					// 本地文件夹列表：仍是单按钮“删除”
					// 合并删除弹窗：主按钮文案为“同时删除”（保持旧行为）
					confirmText={localFileDeleteOnly ? "删除" : "同时删除"}
					confirmVariant="destructive"
					closeOnConfirm={false}
					onConfirm={
						localFileDeleteOnly ? onConfirmDeleteLocalFolderFile : onConfirmDeleteBoth
					}
					// 仅合并删除弹窗提供额外按钮，避免影响本地文件夹列表的既有体验
					{...(localFileDeleteOnly
						? {}
						: {
								secondaryActionText: "删除本地文件",
								onSecondaryAction: onSecondaryDeleteLocalOnly,
								tertiaryActionText: "删除在线文件",
								tertiaryVariant: "destructive",
								onTertiaryAction: onTertiaryDeleteOnlineOnly,
							})}
				/>
```

#### 3.10.7 知识页父组件回调

```ts
	const handleDeletedRecord = useCallback(
		(id: string) => {
			if (knowledgeStore.knowledgeEditingKnowledgeId === id) {
				resetEditorToNewDraft(); // 正在编辑的云端条目被删 → 清空草稿
			}
		},
		[knowledgeStore, resetEditorToNewDraft],
	);

	const handleAfterLocalDelete = useCallback(
		(deletedKnowledgeId: string) => {
			if (!deletedKnowledgeId) return;
			if (knowledgeStore.knowledgeEditingKnowledgeId === deletedKnowledgeId) {
				resetEditorToNewDraft(); // 正在编辑的本地合成 id 对应文件被删
			}
		},
		[knowledgeStore, resetEditorToNewDraft],
	);

			<KnowledgeList
				onAfterLocalDelete={handleAfterLocalDelete}
				onDeletedRecord={handleDeletedRecord}
				// ...
			/>
```

### 3.11 另存为与覆盖确认 — `knowledge.ts` / `Confirm` / `index.tsx` / `knowledge.rs`（逐行注释）

以下摘录与仓库实现一致；行号以路径为准，重构后可能偏移。

#### 3.11.1 `store/knowledge.ts` — 覆盖弹窗状态与 `knowledgeLocalDiskTitle`

```ts
	/** 桌面端：打开该条时的原标题，用于本地 .md 重命名 */
	knowledgeLocalDiskTitle: string | null = null; // 另存为后存「磁盘文件名」，可与 knowledgeTitle（展示）不同

	/** Tauri 覆盖确认弹窗：离开知识页再进入仍可继续确认 */
	knowledgeOverwriteOpen = false; // 是否显示「覆盖已有文件？」对话框

	knowledgeOverwriteTargetPath = ''; // 冲突目标的绝对路径，仅用于文案

	knowledgePendingSavePayload: SaveKnowledgeMarkdownPayload | null = null; // 打开弹窗时挂起的保存入参

	setKnowledgeLocalDiskTitle(value: string | null) {
		this.knowledgeLocalDiskTitle = value; // 覆盖保存或另存为成功后更新磁盘侧标题记忆
	}

	/** 打开「覆盖已有文件」确认（桌面端保存冲突时） */
	openKnowledgeOverwriteConfirm(
		targetPath: string, // resolve 返回的已存在文件路径
		payload: SaveKnowledgeMarkdownPayload, // 用户原本要点保存时的 title/filePath/previousTitle 等
	) {
		this.knowledgeOverwriteTargetPath = targetPath; // 弹窗里展示完整路径
		this.knowledgePendingSavePayload = payload; // 确认覆盖或另存为时取出
		this.knowledgeOverwriteOpen = true; // 显示 Confirm
	}

	/** 关闭覆盖确认并清空挂起的保存入参 */
	setKnowledgeOverwriteOpen(open: boolean) {
		this.knowledgeOverwriteOpen = open; // 同步 Radix open
		if (!open) {
			this.knowledgeOverwriteTargetPath = ''; // 避免下次误展示旧路径
			this.knowledgePendingSavePayload = null; // 避免沿用过期 payload
		}
	}
```

#### 3.11.2 `Confirm/index.tsx` — 第三钮「另存为」

```ts
	/** 可选第三钮（如「另存为」），样式为 outline，位于取消与确认之间 */
	secondaryActionText?: string; // 有文案才渲染第三按钮
	onSecondaryAction?: () => void | Promise<void>; // 点击时 void 包裹，避免未处理 Promise
```

```tsx
{
	secondaryActionText && onSecondaryAction ? (
		<Button
			type="button" // 避免表单误提交
			variant="outline" // 与取消同层级视觉，弱于 destructive 主确认
			onClick={() => void onSecondaryAction()} // 异步函数也安全触发
		>
			{secondaryActionText}
		</Button>
	) : null;
}
<AlertDialogPrimitive.Action
	onClick={handleConfirm} // 主确认：覆盖保存等
	className={cn(buttonVariants({ variant: confirmVariant }))}
>
	{confirmText}
</AlertDialogPrimitive.Action>;
```

#### 3.11.3 `views/knowledge/index.tsx` — 路径工具、拆扩展名、另存为文件名探测

```ts
/** 保存路径解析用：从绝对路径取父目录 */
function dirnameFs(filePath: string): string {
	const n = filePath.replace(/[/\\]+$/, ""); // 去掉末尾多余 / 或 \
	const i = Math.max(n.lastIndexOf("/"), n.lastIndexOf("\\")); // 最后一个路径分隔符
	if (i <= 0) return n; // 无父级时退化返回整串
	return n.slice(0, i); // 父目录绝对路径
}

/** 拆分标题中的主名与扩展（无扩展时默认 `.md`） */
function splitKnowledgeTitleStemAndExt(title: string): {
	stem: string; // 不含扩展名的显示用主名
	ext: string; // `.md` / `.markdown` / `.mdx` 之一，或默认 `.md`
} {
	const t = title.trim() || "未命名"; // 空标题兜底
	const lower = t.toLowerCase(); // 扩展名比较忽略大小写
	for (const ext of [".md", ".markdown", ".mdx"] as const) {
		if (lower.endsWith(ext)) {
			return { stem: t.slice(0, -ext.length), ext }; // 剥离已知扩展
		}
	}
	return { stem: t, ext: ".md" }; // 未匹配则整体作主名，扩展默认 md
}

/**
 * 另存为专用：仅用于 Tauri 落盘文件名，**不修改编辑器标题**。
 * 后缀为 `_年-月-日-时:分:秒`（如 `_2026-04-01-15:30:45`）；Rust 侧 sanitize 会把 `:` 换成 `-` 以兼容 Windows。
 * 仍冲突则再追加 `_2`、`_3`…
 */
async function pickNonConflictingDiskFileTitle(
	seedTitle: string, // 一般取当前展示标题，用于 stem/ext
	pending: SaveKnowledgeMarkdownPayload, // 提供 filePath 等，仅改 title 做 resolve
): Promise<string> {
	const d = new Date(); // 生成后缀的时刻
	const pad = (n: number) => String(n).padStart(2, "0"); // 月日时分秒两位补零
	const timeStr = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}-${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`; // 年-月-日-时:分:秒
	const { stem, ext } = splitKnowledgeTitleStemAndExt(seedTitle); // 时间戳插在 stem 与 ext 之间
	for (let n = 0; n < 50; n++) {
		const mid = n === 0 ? `_${timeStr}` : `_${timeStr}_${n + 1}`; // 首次仅时间；冲突则 _2、_3…
		const candidate = `${stem}${mid}${ext}`; // 完整「标题」传给 Rust 再 sanitize
		const target = await invokeResolveKnowledgeMarkdownTarget({
			...pending, // 目录、previousTitle 等沿用挂起 payload（另存为流程里会删掉 previousTitle）
			title: candidate, // 只换文件名探测是否存在
			content: "", // 探测不需要正文
			overwrite: false, // 显式非覆盖语义
		});
		if (!target.exists) return candidate; // 第一个不存在的名字即为选用名
	}
	throw new Error("无法找到可用文件名"); // 极端情况：50 次仍冲突
}
```

#### 3.11.4 `runTauriSave` 与 `persistKnowledgeApiSaveAs`

```ts
const runTauriSave = useCallback(
	async (payload: SaveKnowledgeMarkdownPayload) => {
		const result = await invokeSaveKnowledgeMarkdown(payload); // 返回 success / message / filePath
		if (result.success === "success") {
			Toast({
				type: "success",
				title: "文件已保存",
				message: result.filePath
					? `已保存到：${result.filePath}` // 另存为后可从路径更新本地合成 id
					: "已保存到默认目录",
				duration: 1000,
			});
		} else {
			Toast({ type: "error", title: "保存失败", message: result.message });
		}
		return result; // 调用方读取 filePath、success
	},
	[],
);

/**
 * 另存为：始终新建云端记录（不更新当前 id），本地扫描打开的条目仍不写库。
 * @param apiTitle 与编辑器展示一致，写入接口的标题（可与本地磁盘文件名不同）
 */
const persistKnowledgeApiSaveAs = useCallback(
	async (apiTitle: string) => {
		const markdown = knowledgeStore.markdown ?? ""; // 当前正文（本函数内未直接上传，saveKnowledge 会带 content）
		const meta = buildAuthorMeta(getUserInfo); // author / authorId
		const editingId = knowledgeStore.knowledgeEditingKnowledgeId;
		if (isKnowledgeLocalMarkdownId(editingId)) {
			return; // 纯本地会话：只写盘，不调 saveKnowledge
		}
		const res = await saveKnowledge({
			title: apiTitle, // 接口标题 = 展示标题，非 diskTitle
			content: markdown,
			...meta,
		} as Omit<KnowledgeRecord, "id">);
		if (!res.success || !res.data?.id) {
			Toast({
				type: "error",
				title: "保存失败",
				message: res.message || "新建知识失败，请稍后重试",
			});
			throw new Error("saveKnowledge save-as failed"); // 阻止后续 Tauri 写盘与状态错乱
		}
		knowledgeStore.setKnowledgeEditingKnowledgeId(res.data.id); // 编辑上下文切到新云端 id
	},
	[knowledgeStore, getUserInfo],
);
```

#### 3.11.5 `onSave` 中冲突分支（打开弹窗）

```ts
const target = await invokeResolveKnowledgeMarkdownTarget(payload); // 保存前探测目标是否存在
if (!target.exists) {
	await persistKnowledgeApi(); // 无冲突：照常写库（或本地跳过）
	await runTauriSave(payload); // 写磁盘
	knowledgeStore.setKnowledgeLocalDiskTitle(trimmedTitle); // 磁盘名与展示一致
	syncSnapshotAfterPersist(trimmedTitle, markdown); // 脏标记归零
} else {
	knowledgeStore.openKnowledgeOverwriteConfirm(target.path, payload); // 有冲突：弹窗让用户选覆盖或另存为
}
```

#### 3.11.6 `onConfirmOverwrite`（覆盖保存）

```ts
const onConfirmOverwrite = useCallback(async () => {
	const pending = knowledgeStore.knowledgePendingSavePayload; // 打开弹窗时存的 payload
	if (!pending) return; // 已关闭或状态异常则直接返回
	const markdown = knowledgeStore.markdown ?? "";
	const trimmedTitle = knowledgeStore.knowledgeTitle.trim();
	const snap = knowledgeStore.knowledgePersistedSnapshot;
	if (snap.title === trimmedTitle && snap.content === markdown) {
		Toast({
			type: "info",
			title: "暂无修改",
			message: "标题与内容与上次保存一致，未执行保存",
			duration: 2000,
		});
		knowledgeStore.setKnowledgeOverwriteOpen(false); // 无变更则关弹窗
		return;
	}
	setSaveLoading(true);
	try {
		await persistKnowledgeApi(); // 先同步云端（本地 id 则跳过）
		const merged = { ...pending, overwrite: true }; // 强制覆盖落盘
		await runTauriSave(merged);
		knowledgeStore.setKnowledgeLocalDiskTitle(merged.title.trim()); // 覆盖后磁盘名即当前 title
		syncSnapshotAfterPersist(trimmedTitle, markdown); // 快照用展示标题 + 正文
		knowledgeStore.setKnowledgeOverwriteOpen(false); // 成功关闭
	} catch (e) {
		Toast({
			type: "error",
			title: formatTauriInvokeError(e),
		});
	} finally {
		setSaveLoading(false);
	}
}, [
	persistKnowledgeApi,
	runTauriSave,
	knowledgeStore,
	syncSnapshotAfterPersist,
]);
```

#### 3.11.7 `onSaveAsFromOverwrite`（另存为）

```ts
/** 覆盖弹窗：另存为——仅本地文件名带 `_时间`；编辑器标题与接口标题保持当前展示名 */
const onSaveAsFromOverwrite = useCallback(async () => {
	const pending = knowledgeStore.knowledgePendingSavePayload;
	if (!pending) return;
	const markdown = knowledgeStore.markdown ?? "";
	const displayTitle =
		knowledgeStore.knowledgeTitle.trim() || pending.title.trim(); // 展示/接口用标题
	const wasLocalOnly = isKnowledgeLocalMarkdownId(
		knowledgeStore.knowledgeEditingKnowledgeId,
	); // 另存为成功后是否需更新合成 id
	const pendingBase: SaveKnowledgeMarkdownPayload = { ...pending };
	delete pendingBase.previousTitle; // 新文件名不应再走「按旧名重命名」
	knowledgeStore.setKnowledgeOverwriteOpen(false); // 先关弹窗再执行耗时保存
	setSaveLoading(true);
	try {
		const diskTitle = await pickNonConflictingDiskFileTitle(
			displayTitle,
			pendingBase,
		); // 生成不冲突的磁盘文件名
		const savePayload: SaveKnowledgeMarkdownPayload = {
			...pendingBase,
			title: diskTitle, // Tauri 使用带时间后缀的名字
			content: markdown,
			overwrite: false, // 新文件路径，不应覆盖
		};
		await persistKnowledgeApiSaveAs(displayTitle); // 云端新建用展示名（纯本地则内部 return）
		const tauriRes = await runTauriSave(savePayload);
		if (tauriRes.success !== "success") return; // 失败则不更新本地磁盘标题与快照
		knowledgeStore.setKnowledgeLocalDiskTitle(diskTitle); // 下次保存 previousTitle 对应该文件
		syncSnapshotAfterPersist(displayTitle, markdown); // 快照标题仍为展示名，与输入框一致
		if (wasLocalOnly && tauriRes.filePath && tauriRes.filePath.length > 0) {
			knowledgeStore.setKnowledgeEditingKnowledgeId(
				`${KNOWLEDGE_LOCAL_MD_ID_PREFIX}${encodeURIComponent(tauriRes.filePath)}`,
			); // 编辑会话指向新文件的合成 id
			knowledgeStore.setKnowledgeLocalDirPath(dirnameFs(tauriRes.filePath)); // 父目录与文件一致
		}
	} catch (e) {
		Toast({
			type: "error",
			title: formatTauriInvokeError(e),
		});
	} finally {
		setSaveLoading(false);
	}
}, [
	knowledgeStore,
	persistKnowledgeApiSaveAs,
	runTauriSave,
	syncSnapshotAfterPersist,
]);
```

#### 3.11.8 覆盖确认 `Confirm` 绑定（节选）

```tsx
<Confirm
	open={knowledgeStore.knowledgeOverwriteOpen}
	onOpenChange={handleOverwriteOpenChange}
	title="覆盖已有文件？"
	description={
		<>
			当前目录下已存在同名文件「{overwriteFileName}
			」，确定要覆盖吗？此操作不可撤销。
			<div className="mt-2 block break-all text-xs opacity-80">
				{overwriteTargetPath}
			</div>
			<p className="mt-3 text-sm text-textcolor/80">
				也可选择「另存为」将文件保存为新文件
			</p>
		</>
	}
	descriptionClassName="text-left"
	confirmText="覆盖保存"
	confirmVariant="destructive"
	cancelText="取消保存"
	closeOnConfirm={false}
	confirmOnEnter
	secondaryActionText="另存为"
	onSecondaryAction={onSaveAsFromOverwrite}
	onConfirm={onConfirmOverwrite}
/>
```

```ts
const overwriteTargetPath = knowledgeStore.knowledgeOverwriteTargetPath; // 完整路径
const overwriteFileName =
	overwriteTargetPath.split(/[/\\]/).filter(Boolean).pop() ??
	overwriteTargetPath; // 弹窗标题行只展示文件名段
```

#### 3.11.9 `knowledge.rs` — `sanitize_filename` 与冒号

落盘前标题会经此函数处理：**冒号 `:` 会被替换为 `-`**，因此前端 `pickNonConflictingDiskFileTitle` 使用 `时:分:秒` 仅在「传入 Rust 前的字符串」层面对齐产品文案；实际文件名在 Windows 上合法。

```rust
fn sanitize_filename(title: &str) -> String {
	let base = if title.trim().is_empty() {
		let ms = SystemTime::now()
			.duration_since(UNIX_EPOCH)
			.map(|d| d.as_millis())
			.unwrap_or(0);
		format!("未命名-{}", ms) // 空标题用毫秒兜底文件名
	} else {
		title.trim().to_string() // 非空用 trim 后全文
	};
	let safe: String = base
		.chars()
		.map(|c| match c {
			'/' | '\\' | '?' | '%' | '*' | ':' | '|' | '"' | '<' | '>' => '-', // Windows/macOS 非法字符统一变 -
			c if c.is_whitespace() => '_', // 空白变下划线，避免文件名含空格问题
			c => c,
		})
		.collect();
	let trimmed: String = safe.chars().take(120).collect(); // 长度上限防路径过长
	format!("{}.md", trimmed) // 统一加 .md 扩展（与保存命令约定一致）
}
```

### 3.12 外部编辑器打开本地 `.md` — `lib.rs` / `knowledge-save.ts` / `KnowledgeList.tsx` / `knowledge.rs`（逐行注释）

以下摘录与仓库实现一致；行号随重构可能变化，以路径为准。

#### 3.12.1 `lib.rs` — 注册 invoke

```rust
use command::knowledge::{
    delete_knowledge_markdown, list_knowledge_markdown_files, open_knowledge_markdown_in_editor,
    read_knowledge_markdown_file, resolve_knowledge_markdown_target, save_knowledge_markdown,
};
// ...
            open_knowledge_markdown_in_editor, // 本地 .md 在 Cursor / Trae 中打开
```

- 第一处：`use` 引入命令函数，供 `generate_handler!` 宏注册。
- 第二处：与 `read_knowledge_markdown_file` 等并列注册，前端 `invoke('open_knowledge_markdown_in_editor', …)` 才能调到 Rust。

#### 3.12.2 `knowledge-save.ts` — 封装 invoke

```ts
/** 在检测到的编辑器中打开本地 .md（逻辑见 Tauri `open_knowledge_markdown_in_editor`） */
export async function invokeOpenKnowledgeMarkdownInEditor(
	filePath: string, // 列表项上的 localAbsolutePath
): Promise<{ openedWith: string }> {
	const { invoke } = await import("@tauri-apps/api/core"); // 动态 import，非 Tauri 构建不强制加载
	return invoke<{ openedWith: string }>("open_knowledge_markdown_in_editor", {
		input: { filePath }, // 与 Rust `OpenKnowledgeMarkdownInEditorInput` 的 camelCase 对齐
	});
}
```

- 返回的 `openedWith` 用于 Toast 文案（`Cursor` 或 `Trae`）。

#### 3.12.3 `KnowledgeList.tsx` — 行组件 props、按钮与回调

```tsx
import { Code2, Trash2 } from "lucide-react"; // Code2：外部编辑器；Trash2：删除
// ...
import {
	// ...
	invokeOpenKnowledgeMarkdownInEditor,
	// ...
} from "@/utils/knowledge-save";
```

```tsx
/** 单行：点击打开详情；删除图标与数据库列表一致，仅行 hover 时显示 */
function KnowledgeListRow(props: {
	item: KnowledgeListItem; // 含可选 localAbsolutePath
	selected: boolean; // 是否与当前编辑 id 一致
	onActivate: (item: KnowledgeListItem) => void; // 点击行主体
	onTrashClick: (e: React.MouseEvent, item: KnowledgeListItem) => void; // 删除
	/** 本地文件夹模式：在 Cursor / Trae 中打开（按钮在删除左侧） */
	showOpenInExternalEditor?: boolean; // 由父组件传入，仅本地+Tauri 为 true
	onOpenInExternalEditorClick?: (
		e: React.MouseEvent,
		item: KnowledgeListItem,
	) => void; // 点击 Code2 时调用
}) {
	const {
		item,
		selected,
		onActivate,
		onTrashClick,
		showOpenInExternalEditor = false, // 默认不展示外部打开
		onOpenInExternalEditorClick,
	} = props;
```

```tsx
<div className="flex shrink-0 items-start gap-0.5">
	{showOpenInExternalEditor &&
	item.localAbsolutePath &&
	onOpenInExternalEditorClick ? (
		<button
			type="button" // 避免 submit
			aria-label="在 Cursor 或 Trae 中打开" // 读屏
			title="前台为 Cursor/Trae 则对应用之；否则若 Cursor 已在运行则优先 Cursor，再检测 Trae，都未开则尝试 Trae" // 悬停说明检测规则
			className={cn(
				"cursor-pointer shrink-0 p-1 rounded-md text-textcolor/80 transition-opacity duration-150",
				"opacity-0 pointer-events-none", // 默认隐藏
				"hover:text-teal-400 hover:bg-theme/10", // 与删除钮区分色
				"group-hover:opacity-100 group-hover:pointer-events-auto", // 与删除钮同一套 hover 显隐
			)}
			onClick={(e) => {
				e.stopPropagation(); // 不触发行 onClick 打开详情
				onOpenInExternalEditorClick(e, item);
			}}
		>
			<Code2 size={16} />
		</button>
	) : null}
	<button
		type="button"
		aria-label={
			item.localAbsolutePath ? "删除本地 Markdown 文件" : "从知识库删除"
		}
		// ... 删除钮 className 与 onTrashClick 同前
	>
		<Trash2 size={16} />
	</button>
</div>
```

```ts
/** 本地列表：在 Cursor / Trae 中打开（由 Rust 判定编辑器并执行打开） */
const onOpenInExternalEditorClick = useCallback(
	async (_e: React.MouseEvent, knowledge: KnowledgeListItem) => {
		const p = knowledge.localAbsolutePath; // 仅本地行有值
		if (!p) return; // 防御
		try {
			const { openedWith } = await invokeOpenKnowledgeMarkdownInEditor(p); // Tauri 打开
			Toast({
				type: "success",
				title: "已在外部编辑器打开",
				message: `使用 ${openedWith} 打开文件`, // 与 Rust 返回一致
				duration: 2000,
			});
		} catch (err) {
			Toast({
				type: "error",
				title: "打开失败",
				message: formatTauriInvokeError(err), // 统一解析 Tauri 错误
			});
		}
	},
	[],
);
```

```tsx
<KnowledgeListRow
	key={knowledge.id}
	item={knowledge}
	selected={editingKnowledgeId != null && editingKnowledgeId === knowledge.id}
	onActivate={handleRowClick}
	onTrashClick={onTrashClick}
	showOpenInExternalEditor={
		useLocalFolder && isTauriRuntime() // 仅本地数据源且桌面端
	}
	onOpenInExternalEditorClick={onOpenInExternalEditorClick}
/>
```

#### 3.12.4 `knowledge.rs` — 枚举、前台名、Cursor 检测与打开

```rust
// —— 本地 .md 用 Cursor / Trae（用户所称 tare）打开 ——

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum DetectedMarkdownEditor {
	Cursor, // 选用 Cursor 打开
	Trae,   // 选用 Trae 打开
}
```

```rust
#[cfg(target_os = "macos")]
fn frontmost_application_name() -> Option<String> {
	let script =
		r#"tell application "System Events" to get name of first application process whose frontmost is true"#; // 前台应用显示名
	let output = Command::new("osascript").args(["-e", script]).output().ok()?; // 执行 AppleScript
	if !output.status.success() {
		return None; // 无权限或失败
	}
	let s = String::from_utf8(output.stdout).ok()?;
	let t = s.trim();
	if t.is_empty() {
		None
	} else {
		Some(t.to_string()) // 供 detect 与 cursor/trae 子串匹配
	}
}
```

（Windows / 非 macOS Unix 的 `frontmost_application_name` 实现见仓库同文件：`windows` 用 PowerShell + `GetForegroundWindow`；其它 Unix 返回 `None`。）

```rust
/// 子进程退出码 0 视为成功（如 pgrep 找到进程）
fn command_exit_zero(program: &str, args: &[&str]) -> bool {
	Command::new(program)
		.args(args)
		.status()
		.ok()
		.is_some_and(|s| s.success()) // pgrep 找到目标进程时 exit 0
}
```

```rust
#[cfg(target_os = "macos")]
fn is_cursor_running_applescript() -> bool {
	let Some(out) = Command::new("/usr/bin/osascript")
		.args([
			"-e", r#"tell application "System Events""#,
			"-e", r#"repeat with procName in (name of every process)"#,
			"-e", r#"set t to procName as string"#,
			"-e", r#"if t contains "Cursor" then return true"#,
			"-e", r#"end repeat"#,
			"-e", r#"end tell"#,
			"-e", r#"return false"#,
		])
		.output()
		.ok()
	else {
		return false; // 无法启动 osascript
	};
	if !out.status.success() {
		return false; // 自动化权限等
	}
	String::from_utf8_lossy(&out.stdout)
		.trim()
		.eq_ignore_ascii_case("true") // AppleScript 打印 true/false
}
```

```rust
#[cfg(target_os = "macos")]
fn is_cursor_running_ps() -> bool {
	let Ok(output) = Command::new("/bin/ps").args(["-ax", "-o", "command="]).output() else {
		return false;
	};
	String::from_utf8_lossy(&output.stdout).lines().any(|line| {
		line.contains("Cursor.app/")
			|| line.contains("Cursor Helper") // Electron 子进程名
			|| line.contains("MacOS/Cursor") // 路径截断时仍可能匹配
	})
}
```

```rust
#[cfg(target_os = "macos")]
fn is_cursor_running() -> bool {
	is_cursor_running_applescript()
		|| is_cursor_running_ps()
		|| command_exit_zero("/usr/bin/pgrep", &["-x", "Cursor"])
		|| command_exit_zero("/usr/bin/pgrep", &["-f", "Cursor.app"])
		|| command_exit_zero("/usr/bin/pgrep", &["-x", "cursor"])
}
```

```rust
#[cfg(target_os = "macos")]
const CURSOR_MACOS_BUNDLE_ID: &str = "com.todesktop.230313mzl4w4u92"; // Todesktop 分发常见 ID

#[cfg(target_os = "macos")]
fn spawn_open_cursor_macos(path: &Path) -> Result<(), String> {
	let path_str = path.to_str().ok_or("路径包含无效字符")?;
	if Command::new("/usr/bin/open")
		.args(["-b", CURSOR_MACOS_BUNDLE_ID, "--", path_str])
		.status()
		.map(|s| s.success())
		.unwrap_or(false)
	{
		return Ok(()); // Bundle ID 打开成功
	}
	if spawn_open_editor("Cursor", path).is_ok() {
		return Ok(()); // 显示名打开成功
	}
	Command::new("cursor")
		.arg(path_str)
		.spawn()
		.map_err(|e| format!("无法用 Cursor 打开文件: {e}"))?; // 官方 CLI
	Ok(())
}
```

#### 3.12.5 `knowledge.rs` — Trae 检测、安装兜底、分发打开与命令入口

```rust
#[cfg(target_os = "macos")]
fn is_trae_running() -> bool {
	for name in ["Trae", "Trae CN"] {
		if command_exit_zero("/usr/bin/pgrep", &["-x", name]) {
			return true;
		}
	}
	command_exit_zero("/usr/bin/pgrep", &["-f", "Trae.app"])
}
```

（Windows：`tasklist` 含 `trae.exe`；Linux：`pgrep` — 见仓库。）

```rust
fn detect_markdown_editor() -> DetectedMarkdownEditor {
	if let Some(name) = frontmost_application_name() {
		let lower = name.to_lowercase();
		if lower.contains("cursor") {
			return DetectedMarkdownEditor::Cursor; // 用户正停在 Cursor
		}
		if lower.contains("trae") {
			return DetectedMarkdownEditor::Trae;
		}
	}
	if is_cursor_running() {
		return DetectedMarkdownEditor::Cursor; // 后台已开 Cursor，优先于 Trae
	}
	if is_trae_running() {
		return DetectedMarkdownEditor::Trae;
	}
	#[cfg(target_os = "macos")]
	if let Some(kind) = detect_editor_by_cursor_trae_installed() {
		return kind; // 进程检测全失败时用 .app 是否安装推断
	}
	DetectedMarkdownEditor::Trae // 最后默认走 Trae 分支
}
```

```rust
#[cfg(target_os = "macos")]
fn macos_app_bundle_present(name: &str) -> bool {
	let home = env::var("HOME").unwrap_or_default();
	[
		format!("/Applications/{name}.app"),
		format!("{home}/Applications/{name}.app"),
	]
	.iter()
	.any(|p| Path::new(p).is_dir()) // 是否为目录即视为已安装
}

#[cfg(target_os = "macos")]
fn detect_editor_by_cursor_trae_installed() -> Option<DetectedMarkdownEditor> {
	let cursor = macos_app_bundle_present("Cursor");
	let trae = macos_app_bundle_present("Trae") || macos_app_bundle_present("Trae CN");
	match (cursor, trae) {
		(true, false) => Some(DetectedMarkdownEditor::Cursor),
		(false, true) => Some(DetectedMarkdownEditor::Trae),
		(true, true) => Some(DetectedMarkdownEditor::Cursor), // 双装优先 Cursor
		_ => None,
	}
}
```

```rust
#[cfg(target_os = "macos")]
fn spawn_open_editor(app_bundle_name: &str, path: &Path) -> Result<(), String> {
	let path_str = path.to_str().ok_or("路径包含无效字符")?;
	let status = Command::new("/usr/bin/open")
		.args(["-a", app_bundle_name, "--", path_str]) // -a：按应用名打开文件
		.status()
		.map_err(|e| format!("无法启动 {app_bundle_name}: {e}"))?;
	if status.success() {
		Ok(())
	} else {
		Err(format!("open -a {app_bundle_name} 退出码非 0"))
	}
}
```

```rust
fn open_markdown_with_detected_editor(path: &Path) -> Result<DetectedMarkdownEditor, String> {
	let kind = detect_markdown_editor();
	match kind {
		DetectedMarkdownEditor::Cursor => {
			#[cfg(target_os = "macos")]
			{
				spawn_open_cursor_macos(path)?; // macOS 专用打开链
			}
			#[cfg(not(target_os = "macos"))]
			{
				spawn_open_editor("cursor", path)?; // Windows/Linux CLI 名
			}
			Ok(DetectedMarkdownEditor::Cursor)
		}
		DetectedMarkdownEditor::Trae => {
			#[cfg(target_os = "macos")]
			{
				if spawn_open_editor("Trae", path).is_err() {
					spawn_open_editor("Trae CN", path)?; // 中文区安装名
				}
			}
			#[cfg(not(target_os = "macos"))]
			{
				spawn_open_editor("trae", path)?;
			}
			Ok(DetectedMarkdownEditor::Trae)
		}
	}
}
```

```rust
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OpenKnowledgeMarkdownInEditorInput {
	pub file_path: String, // 前端 filePath
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OpenKnowledgeMarkdownInEditorResult {
	pub opened_with: String, // "Cursor" | "Trae"
}

#[tauri::command]
pub fn open_knowledge_markdown_in_editor(
	input: OpenKnowledgeMarkdownInEditorInput,
) -> Result<OpenKnowledgeMarkdownInEditorResult, String> {
	let trimmed = input.file_path.trim();
	if trimmed.is_empty() {
		return Err("filePath 不能为空".to_string());
	}
	let p = PathBuf::from(trimmed);
	if !p.exists() || !p.is_file() {
		return Err("文件不存在或不是普通文件".to_string());
	}
	if !is_md_file_path(&p) {
		return Err("仅允许打开 .md 文件".to_string());
	}
	let used = open_markdown_with_detected_editor(&p)?; // 检测 + 打开
	let opened_with = match used {
		DetectedMarkdownEditor::Cursor => "Cursor",
		DetectedMarkdownEditor::Trae => "Trae",
	};
	Ok(OpenKnowledgeMarkdownInEditorResult {
		opened_with: opened_with.to_string(),
	})
}
```

---

## 4. 数据流简图

```mermaid
flowchart LR
  subgraph drawer [知识库抽屉]
    SW[开关 数据库/本地]
    L[list_knowledge_markdown_files]
    R[read_knowledge_markdown_file]
  end
  subgraph editor [知识页]
    KS[KnowledgeStore]
    P[persistKnowledgeApi]
    T[save_knowledge_markdown]
  end
  SW -->|本地| L
  L -->|列表| R
  R -->|KnowledgeRecord + localDirPath| KS
  KS -->|本地 id| P
  P -->|跳过| API[云端 API]
  KS --> T
```

---

## 5. 维护注意

- `TAURI_KNOWLEDGE_DIR` 当前为**写死的绝对路径**；多环境部署时可改为与 Rust `resolve_knowledge_dir` 对齐或由配置注入。
- 本地合成 id 依赖 `encodeURIComponent(path)`；若未来 id 长度或字符集成为问题，可改为哈希缩短，但需同步调整删除回调比对逻辑。
- 另存为文件名中的 `:` 依赖 Rust `sanitize_filename` 替换为 `-`；若修改 sanitize 规则，需同步核对 Windows 落盘与文档 **§2.7 / §3.11.9** 描述。
- **外部编辑器打开**：macOS 需在「隐私与安全性 → 自动化」中允许本应用控制 **System Events**，AppleScript 列举进程才稳定；若 Cursor 更换 **Bundle ID**，需同步 `knowledge.rs` 中 `CURSOR_MACOS_BUNDLE_ID` 与文档 **§2.8 / §3.12**。
- Trae 若仅提供其它 `.app` 名称，可在 `spawn_open_editor` / `macos_app_bundle_present` 中增补别名；Windows/Linux 依赖 `cursor`/`trae` 是否在 `PATH`。

---

_文档版本：与仓库实现同步整理；若代码重构请对照 Git 历史更新本节行号与摘录。_
