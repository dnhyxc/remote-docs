# 学习笔记 CRUD 与 API 集成

## 1. 背景与目标

学习笔记此前为「本地 demo 态」：仅在前端用 `useState` 维护一份带种子数据的内存数组，`onSubmit` 直接 `setNotes` 本地追加，刷新即丢，且无编辑、删除能力。

本轮将其升级为完整的后端 CRUD：

- 新增后端 `LearningNotesModule`（`/english-learning/notes/*`），提供 list / detail / save / update / delete 接口。
- 前端 `learning-notes/index.tsx` 重构为「列表在左、编辑器/预览在右」的持久化笔记应用，支持新建、编辑、删除（带确认）。
- 为支撑 update / delete，`HostBridge` 的 `http` 能力从 `get/post` 扩展到 `get/post/put/delete`，全链路（`types.ts` → `createHostBridge.ts` → `attachIframeBridge.ts` → `iframeHostClient.ts` → 各插件本地类型）同步补齐。
- 新增 `Confirm` 通用确认对话框组件，承接删除前的二次确认。

## 2. 改动范围

- `apps/remote-plugins/src/views/learning-notes/index.tsx` — 主应用大改：布局重构、CRUD、Confirm 删除（本轮迭代追加：快捷键保存、useCallback 优化、tooltip 与列表标题微调）。
- `apps/remote-plugins/src/views/learning-notes/api.ts` — **纯新增**：API 层（`createNotesApi` 工厂、`HostHttp` / `Note` / `NoteRecord` 类型）。
- `apps/remote-plugins/src/components/design/Confirm/index.tsx` — **纯新增**：确认对话框组件。
- `apps/backend/src/app.module.ts` — 注册 `LearningNotesModule`。
- `apps/frontend/src/plugins/core/attachIframeBridge.ts` — 新增 `http.put` / `http.delete` RPC 分发。
- `apps/frontend/src/plugins/core/createHostBridge.ts` — 新增 `put` / `delete` 方法。
- `apps/frontend/src/plugins/core/types.ts` — `HostBridgeProps.api.http` 类型新增 `put` / `delete`。
- `apps/remote-plugins/src/utils/iframeHostClient.ts` — 新增 `put` / `delete` RPC 与本地类型。
- `apps/remote-plugins/src/views/ebook-ideas/index.tsx` — 本地 `HostBridgeProps` 类型新增 `put` / `delete` + `independent` 属性。

## 3. 实现思路

1. **布局从「编辑器左 58% / 列表右 42%」翻转为「列表左 35% / 编辑器右 65%」**：笔记已成为持久化数据，列表是主要导航入口，应常驻左侧；编辑器需要更多书写空间，故放大到 65%。`listOpen` 默认值由 `false` 改为 `true`，首屏即展示列表。
2. **用 `key={editorSeed}` 重建编辑器**：`RichEditor` 内部 Tiptap 实例由 `defaultContent` 初始化后即自我管理，外部再改 `defaultContent` 不会重置内容。新建/编辑切换时通过 `setEditorSeed((n) => n + 1)` 改变 `key`，强制 React 卸载旧实例并挂载新实例，从而用新的 `editorInitial` 重新初始化。
3. **提取 `api.ts` 工厂**：把所有 HTTP 调用与字段映射（`NoteRecord` → `Note`）收敛到 `createNotesApi(http)`，组件只持有 `notesApi` 引用；便于测试与替换，且让组件聚焦 UI 状态。
4. **`HostBridge` 扩展 `put/delete` 的设计**：沿用既有 `http:plugin-api` 单一权限，不新增权限位——`put/delete` 与 `get/post` 同属「插件调用主站 API」能力范畴，避免权限粒度膨胀；类型、Host 装配、iframe RPC 分发、embed 端 client 四处同步补齐，保持契约一致性。
5. **删除走 `Confirm` 二次确认**：`onDelete` 仅记录 `pendingDeleteId` 并打开弹层，`onConfirmDelete` 才真正调接口；失败时弹层已关但 toast 提示错误，列表 `refreshList` 兜底回滚视觉态。
6. **列表项不带正文，编辑前先拉详情**：`/list` 接口为瘦身不返回 `content`，故 `openEditById` 先 `notesApi.detail(id)` 拿到 `html` 再进编辑；而 `openEdit(note)` 接收已含 `html` 的 `Note`（来自预览态）直接进入编辑。
7. **`independent` 属性**：为 `LearningNotesApp` / `IdeasListApp` 的 `HostBridgeProps` 增加 `independent?` 标记，供独立运行场景（不显示列表 / 不绑定书籍）使用，是后续嵌入主站英语学习页的预留开关。
8. **保存操作改为 `useCallback` 稳定引用**：将 `onSave` 从普通函数改为 `useCallback` 包裹并显式声明依赖数组（`draft` / `editingId` / `notesApi` / `refreshList` / `toast`），配合下方快捷键 `useEffect` 的依赖项，避免闭包捕获旧值导致保存时读到过期草稿。
9. **新增 Cmd/Ctrl+S 快捷键保存**：通过 `useEffect` 注册全局 `keydown` 监听，`metaKey`/`ctrlKey` + `s` 触发保存；预览态（有 `preview`）不处理，`saving` 进行中不重复触发（防抖）；同时在保存按钮 tooltip 追加 `⌘S` 提示，列表标题去掉 loading 省略号以保持视觉简洁。

## 4. 关键代码对比与注释

### 4.1 `LearningNotesApp` 组件（`apps/remote-plugins/src/views/learning-notes/index.tsx`）

本文件改动最大，拆为 5 个对比组：A 类型与辅助、B 状态与初始化、C CRUD 函数、D toolbarExtra、E 布局 JSX。

#### 对比组 A：`HostBridgeProps` 类型与 `errMsg` 辅助

**对比范围**：`type HostBridgeProps` 完整定义 + 新增 `errMsg` 辅助函数（改动前无 `http` 字段、无 `independent`、无 `errMsg`）。

**改动前** · `apps/remote-plugins/src/views/learning-notes/index.tsx`（基线，约 L16–L27）

```typescript
// 旧版插件契约类型，仅声明主题与 toast，没有任何 HTTP 能力
type HostBridgeProps = {
	// api 命名空间：宿主注入给插件的能力集合
	api: {
		// 主题：light 或 dark，用于插件内样式适配
		theme: 'light' | 'dark';
		// 可选的 UI 能力：弹 toast
		ui?: {
			// showToast 接收 message 与可选 type
			showToast: (options: {
				message: string;
				type?: 'success' | 'error' | 'info';
			}) => void;
		};
	};
	// 插件元信息：id / 版本 / 路由路径
	plugin: { id: string; version: string; routePath: string };
};
```

**改动后** · `apps/remote-plugins/src/views/learning-notes/index.tsx`（当前，约 L27–L50）

```typescript
// 新版插件契约类型：新增 http（用 api.ts 的 HostHttp 类型）与 independent 标记
type HostBridgeProps = {
	// api 命名空间：宿主注入给插件的能力集合
	api: {
		// 主题：light 或 dark
		theme: 'light' | 'dark';
		// 可选 HTTP 能力，类型复用 api.ts 导出的 HostHttp（含 get/post/put/delete）
		http?: HostHttp;
		// 可选 UI 能力：弹 toast
		ui?: {
			// showToast 接收 message 与可选 type
			showToast: (options: {
				message: string;
				type?: 'success' | 'error' | 'info';
			}) => void;
		};
	};
	// 插件元信息：id / 版本 / 路由路径
	plugin: { id: string; version: string; routePath: string };
	// 是否独立运行，独立运行时不会显示笔记列表（嵌入主站时的预留开关）
	independent?: boolean;
};

// 统一错误信息提取：优先取 Error.message，再取对象 message，兜底「请求失败」
function errMsg(e: unknown): string {
	// 命中 Error 实例且 message 非空，直接返回
	if (e instanceof Error && e.message) return e.message;
	// 否则若是带 message 字段的对象，尝试读取
	if (e && typeof e === 'object' && 'message' in e) {
		// 取出 message 字段
		const m = (e as { message?: unknown }).message;
		// message 为非空字符串时返回
		if (typeof m === 'string' && m.trim()) return m;
	}
	// 兜底文案
	return '请求失败';
}
```

**变更摘要**：`HostBridgeProps` 新增 `http?: HostHttp` 与 `independent?`；新增 `errMsg` 工具函数统一异常文案。

#### 对比组 B：组件状态与初始化

**对比范围**：`LearningNotesApp` 组件从声明起到首次拉取列表的 `useEffect`（含 `notesApi` / 各 state / `toast` / `refreshList`）。

**改动前** · `apps/remote-plugins/src/views/learning-notes/index.tsx`（基线，约 L29–L42）

```typescript
// 组件默认导出：接收宿主 bridge
export default function LearningNotesApp({ api }: HostBridgeProps) {
	// 草稿：编辑器当前内容（html / 纯文本 / 标题）
	const [draft, setDraft] = useState({ html: '', text: '', title: '' });
	// 笔记列表是否展开（旧版默认收起）
	const [listOpen, setListOpen] = useState(false);
	// 当前预览的笔记（null 表示在编辑态）
	const [preview, setPreview] = useState<Note | null>(null);
	// 笔记数组：旧版用 useState 初始化器写入种子数据，纯内存
	const [notes, setNotes] = useState<Note[]>(() => [
		{
			// 种子 id
			id: 'seed',
			// 种子标题
			title: '示例笔记',
			// 种子正文 html
			html: '<p>示例：今天复习了 present perfect 与过去时的区别</p>',
			// 种子时间：一分钟前
			at: Date.now() - 60_000,
		},
	]);

	// 排序快照：按时间倒序，旧版用于列表渲染
	const sorted = useMemo(() => [...notes].sort((a, b) => b.at - a.at), [notes]);
```

**改动后** · `apps/remote-plugins/src/views/learning-notes/index.tsx`（当前，约 L52–L96）

```typescript
// 组件默认导出：接收宿主 bridge
export default function LearningNotesApp({ api }: HostBridgeProps) {
	// notesApi：仅当 api.http 存在时才创建，依赖 api.http 缓存
	const notesApi = useMemo(
		// 有 http 则构造 API 实例，否则 null（后续流程会 toast 拒绝）
		() => (api.http ? createNotesApi(api.http) : null),
		// 依赖项：http 引用不变则不重建
		[api.http],
	);

	// 草稿：编辑器当前内容（html / 纯文本 / 标题）
	const [draft, setDraft] = useState({ html: '', text: '', title: '' });
	// 笔记列表是否展开（新版默认展开，首屏即见列表）
	const [listOpen, setListOpen] = useState(true);
	// 当前预览的笔记（null 表示在编辑态）
	const [preview, setPreview] = useState<Note | null>(null);
	// 笔记数组：新版初始为空，由 refreshList 从后端拉取
	const [notes, setNotes] = useState<Note[]>([]);
	// 当前编辑中的笔记 id（null 表示新建态）
	const [editingId, setEditingId] = useState<string | null>(null);
	// 编辑器重建种子：变化则 RichEditor 因 key 改变而重挂载
	const [editorSeed, setEditorSeed] = useState(0);
	// 编辑器初始内容：新建用 EMPTY_NOTE_DOC，编辑用笔记 html
	const [editorInitial, setEditorInitial] = useState<
		string | typeof EMPTY_NOTE_DOC
	>(EMPTY_NOTE_DOC);
	// 列表加载中标记
	const [loading, setLoading] = useState(false);
	// 保存中标记（禁用保存按钮 + 文案变化）
	const [saving, setSaving] = useState(false);
	// 删除确认弹层是否打开
	const [confirmOpen, setConfirmOpen] = useState(false);
	// 待删除的笔记 id（确认后才真正删除）
	const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);

	// toast 封装：统一调用 api.ui?.showToast，依赖 api.ui
	const toast = useCallback(
		// message 必填，type 默认 info
		(message: string, type: 'success' | 'error' | 'info' = 'info') => {
			// 调用宿主 toast（未授权 ui 时静默 no-op）
			api.ui?.showToast({ message, type });
		},
		// 依赖项：api.ui 引用
		[api.ui],
	);

	// 刷新列表：调 notesApi.list 并写回 notes，失败 toast
	const refreshList = useCallback(async () => {
		// 未授权 HTTP 时提示并返回
		if (!notesApi) {
			// 提示未授权
			toast('未授权 HTTP，无法同步笔记', 'error');
			return;
		}
		// 置加载中
		setLoading(true);
		try {
			// 拉取并按时间倒序返回
			setNotes(await notesApi.list());
		} catch (e) {
			// 失败 toast 错误文案
			toast(errMsg(e), 'error');
		} finally {
			// 无论成败关闭加载态
			setLoading(false);
		}
		// 依赖项：notesApi 与 toast
	}, [notesApi, toast]);

	// 首次挂载及 refreshList 变化时拉取列表
	useEffect(() => {
		// void 显式忽略返回 Promise
		void refreshList();
		// 依赖项：refreshList 引用
	}, [refreshList]);
```

**变更摘要**：移除种子数据与 `sorted`；新增 `notesApi` 工厂缓存、7 个 CRUD/编辑器相关 state、`toast` / `refreshList` 与首次拉取 effect。

#### 对比组 C：CRUD 函数

**对比范围**：旧版 `onSubmit` / `toggleNotesList` / `backToEdit` → 新版 `openNew` / `openPreview` / `openEdit` / `openEditById` / `onSave` / `onDelete` / `onConfirmDelete`（`toggleNotesList` 保留）。

**改动前** · `apps/remote-plugins/src/views/learning-notes/index.tsx`（基线，约 L44–L60）

```typescript
// 旧版提交：本地追加一条笔记
const onSubmit = (e: MouseEvent) => {
	// 阻止表单默认提交
	e.preventDefault();
	// 标题与正文都为空则忽略
	if (!draft.text.trim() && !draft.title.trim()) return;
	// 本地追加到 notes 头部
	setNotes((list) => [
		{
			// 用时间戳当 id
			id: `${Date.now()}`,
			// 标题空则占位「无标题笔记」
			title: draft.title.trim() || '无标题笔记',
			// 草稿 html
			html: draft.html,
			// 当前时间戳
			at: Date.now(),
		},
		// 保留旧列表
		...list,
	]);
	// toast 成功提示
	api.ui?.showToast({ message: '已添加学习笔记' });
};

// 列表开关：取反 listOpen
const toggleNotesList = () => setListOpen((o) => !o);
// 返回编辑：清空预览
const backToEdit = () => setPreview(null);
```

**改动后** · `apps/remote-plugins/src/views/learning-notes/index.tsx`（当前，约 L98–L188）

```typescript
// 新建：清空编辑态并重建编辑器
const openNew = () => {
	// 退出预览
	setPreview(null);
	// 清空编辑 id（进入新建态）
	setEditingId(null);
	// 清空草稿
	setDraft({ html: '', text: '', title: '' });
	// 编辑器初始内容置为空文档
	setEditorInitial(EMPTY_NOTE_DOC);
	// 自增种子触发编辑器重挂载
	setEditorSeed((n) => n + 1);
};

// 预览：按 id 拉详情后进入预览态
const openPreview = async (id: string) => {
	// 未授权 HTTP 直接返回
	if (!notesApi) return;
	try {
		// 拉取笔记详情（含 content）
		const note = await notesApi.detail(id);
		// 写入预览态
		setPreview(note);
	} catch (e) {
		// 失败 toast
		toast(errMsg(e), 'error');
	}
};

// 编辑：接收已含 html 的 Note，直接进入编辑态
const openEdit = (note: Note) => {
	// 退出预览
	setPreview(null);
	// 记录编辑 id
	setEditingId(note.id);
	// 用笔记内容回填草稿
	setDraft({ html: note.html, text: '', title: note.title });
	// 编辑器初始内容用笔记 html（空则空文档）
	setEditorInitial(note.html || EMPTY_NOTE_DOC);
	// 自增种子触发编辑器重挂载
	setEditorSeed((n) => n + 1);
};

// 列表项无正文：先拉详情再进编辑
const openEditById = async (id: string) => {
	// 未授权 HTTP 直接返回
	if (!notesApi) return;
	try {
		// 拉详情拿到含 html 的 Note 后调 openEdit
		openEdit(await notesApi.detail(id));
	} catch (e) {
		// 失败 toast
		toast(errMsg(e), 'error');
	}
};

// 保存：新建走 save，已有 id 走 update
const onSave = async () => {
	// 标题为空提示并中断
	if (!draft.title.trim()) return toast('请先输入标题', 'info');
	// 正文为空提示并中断
	if (!draft.text.trim()) return toast('请先输入内容', 'info');
	// 未授权 HTTP 提示并中断
	if (!notesApi) return toast('未授权 HTTP，无法保存', 'error');
	// 置保存中
	setSaving(true);
	try {
		// 组装保存载荷
		const payload = {
			// 标题空则占位
			title: draft.title.trim() || '无标题笔记',
			// 草稿 html
			html: draft.html,
		};
		// 有编辑 id 走更新分支
		if (editingId) {
			// 调 update 返回更新后的 Note
			const updated = await notesApi.update(editingId, payload);
			// 同步编辑 id（后端可能规范化）
			setEditingId(updated.id);
			// toast 更新成功
			toast('已更新笔记', 'success');
		} else {
			// 新建分支：save 返回新 id
			const { id } = await notesApi.save(payload);
			// 写入编辑 id（后续保存变更新）
			setEditingId(id);
			// toast 保存成功
			toast('已保存笔记', 'success');
		}
		// 保存后刷新列表
		await refreshList();
	} catch (e) {
		// 失败 toast
		toast(errMsg(e), 'error');
	} finally {
		// 关闭保存中
		setSaving(false);
	}
};

// 删除：仅记录待删 id 并打开确认弹层
const onDelete = (id: string) => {
	// 记录待删 id
	setPendingDeleteId(id);
	// 打开 Confirm
	setConfirmOpen(true);
};

// 确认删除：真正调接口
const onConfirmDelete = async () => {
	// 取出待删 id
	const id = pendingDeleteId;
	// 未授权或无 id 直接返回
	if (!notesApi || !id) return;
	try {
		// 调 remove 删除
		await notesApi.remove(id);
		// 仅当左侧正展示被删笔记时关掉预览；编辑草稿同理，不误伤其它预览
		if (preview?.id === id) setPreview(null);
		// 若正在编辑被删笔记，重置为新建态
		if (editingId === id) {
			// 清空编辑 id
			setEditingId(null);
			// 清空草稿
			setDraft({ html: '', text: '', title: '' });
			// 编辑器置空文档
			setEditorInitial(EMPTY_NOTE_DOC);
			// 自增种子重挂载编辑器
			setEditorSeed((n) => n + 1);
		}
		// toast 删除成功
		toast('已删除', 'success');
		// 刷新列表
		await refreshList();
	} catch (e) {
		// 失败 toast
		toast(errMsg(e), 'error');
	} finally {
		// 清空待删 id
		setPendingDeleteId(null);
	}
};

// 列表开关：取反 listOpen（与旧版一致）
const toggleNotesList = () => setListOpen((o) => !o);
```

**变更摘要**：`onSubmit` 本地追加被替换为 `onSave`（save/update 分支）+ 一组 `open*` 编辑/预览入口 + `onDelete`/`onConfirmDelete` 确认删除流程；`backToEdit` 删除（预览态由 `openNew`/`openEdit` 退出）。

#### 对比组 D：`listToggleBtn` 与 `toolbarExtra`

**对比范围**：`listToggleBtn` 与 `toolbarExtra` 两个内部函数完整定义。

**改动前** · `apps/remote-plugins/src/views/learning-notes/index.tsx`（基线，约 L62–L80）

```typescript
// 列表开关按钮：复用于编辑器工具栏与预览头
const listToggleBtn = () => (
	// Btn 带 title 提示
	<Btn
		// 根据当前状态切换提示文案
		title={listOpen ? '关闭笔记列表' : '打开笔记列表'}
		// 点击切换
		onClick={toggleNotesList}
	>
		{/* 列表图标 */}
		<NotebookText size={15} />
	</Btn>
);

// 编辑器工具栏右侧扩展：旧版仅保存 + 列表开关
const toolbarExtra = (editor: Editor) => {
	// 占位避免未用警告
	void editor;
	return (
		// 工具栏按钮组容器
		<div className="rich-editor-toolbar-group">
			{/* 保存按钮：调 onSubmit */}
			<Btn title="保存笔记" onClick={(e) => onSubmit(e as MouseEvent)}>
				{/* 保存图标 */}
				<Save size={15} />
			</Btn>
			{/* 列表开关按钮 */}
			{listToggleBtn()}
		</div>
	);
};
```

**改动后** · `apps/remote-plugins/src/views/learning-notes/index.tsx`（当前，约 L190–L217）

```typescript
// 列表开关按钮：复用于编辑器工具栏与预览头
const listToggleBtn = () => (
	// Btn 带 title 提示
	<Btn
		// 根据当前状态切换提示文案
		title={listOpen ? '关闭笔记列表' : '打开笔记列表'}
		// 点击切换
		onClick={toggleNotesList}
	>
		{/* 列表图标 */}
		<NotebookText size={15} />
	</Btn>
);

// 编辑器工具栏右侧扩展：新版新增「新建」+ 保存态控制
const toolbarExtra = (editor: Editor) => {
	// 占位避免未用警告
	void editor;
	return (
		// 用 Fragment 包裹三个按钮
		<>
			{/* 新建按钮：清空编辑态 */}
			<Btn title="新建笔记" onClick={openNew}>
				{/* 备选图标注释保留 */}
				{/* <FilePlus size={15} /> */}
				{/* 新建图标 */}
				<FilePenLine size={15} />
			</Btn>
			{/* 保存/更新按钮：文案随 saving/editingId 变化，禁用 saving */}
			<Btn
				// 动态 title：保存中 / 已有 id 时显示更新 / 否则保存
				title={saving ? '保存中…' : editingId ? '更新笔记' : '保存笔记'}
				// 点击调 onSave（void 忽略 Promise）
				onClick={() => void onSave()}
				// 保存中禁用
				disabled={saving}
			>
				{/* 保存图标 */}
				<Save size={15} />
			</Btn>
			{/* 列表开关按钮 */}
			{listToggleBtn()}
		</>
	);
};
```

**变更摘要**：`toolbarExtra` 新增「新建」按钮，保存按钮增加 `saving`/`editingId` 驱动的 title 与 disabled；容器由 `<div>` 改为 Fragment。

#### 对比组 E：布局 JSX

**对比范围**：组件 `return` 的 JSX 主体（面板顺序、列表项、编辑器 props、预览头按钮）。

**改动前** · `apps/remote-plugins/src/views/learning-notes/index.tsx`（基线，约 L83–L169）

```typescript
// 组件渲染主体
return (
	// 最外层容器：旧版用 bg-theme-background
	<div
		className={cn(
			'bg-theme-background text-textcolor flex h-full min-h-0 min-w-0 flex-col text-sm rounded-md',
		)}
	>
		{/* ponytail: 关闭时不挂右栏，避免 collapse 留白；对齐 EbookReadSplitLayout */}
		<ResizablePanelGroup
			// 分组 id
			id="learning-notes-split"
			// 水平排列
			orientation="horizontal"
			className="h-full min-h-0 min-w-0 flex-1"
		>
			{/* 旧版：编辑器在左 */}
			<ResizablePanel
				id="learning-notes-editor"
				// 列表开时占 58%
				defaultSize={listOpen ? 58 : 100}
				minSize={30}
				className="min-h-0 min-w-0"
			>
				<div className="flex h-full min-h-0 min-w-0 flex-col overflow-hidden">
					{/* 预览时隐藏编辑器，保留挂载以免草稿丢失 */}
					<div
						className={cn(
							'flex h-full min-h-0 flex-1 flex-col overflow-hidden',
							preview && 'hidden',
						)}
					>
						<RichEditor
							// 旧版固定空内容
							defaultContent=""
							placeholder="记下今天的单词、语法或口语收获…"
							showCharCount={false}
							onChange={({ html, text, title }) =>
								setDraft({ html, text, title })
							}
							className="flex h-full min-h-0 flex-1 flex-col overflow-hidden"
							editorClassName="min-h-[6rem] text-sm"
							toolbarExtra={toolbarExtra}
						/>
					</div>
					{preview ? (
						<NotePreview
							title={preview.title}
							html={preview.html}
							{/* 旧版预览头：返回编辑 + 列表开关 */}
							headerExtra={
								<>
									<Btn title="返回编辑" onClick={backToEdit}>
										<PenLine size={15} />
									</Btn>
									{listToggleBtn()}
								</>
							}
						/>
					) : null}
				</div>
			</ResizablePanel>
			{/* 旧版：列表在右 */}
			{listOpen ? (
				<>
					<ResizableHandle withHandle className="w-0" />
					<ResizablePanel
						id="learning-notes-list"
						// 列表占 42%
						defaultSize={42}
						minSize={0}
						className="min-h-0 min-w-0"
					>
						<aside className="border-theme/10 flex h-full min-h-0 min-w-0 flex-col overflow-hidden border-l">
							<div className="text-textcolor/80 mb-2 flex h-10 shrink-0 items-center border-b border-theme/10 px-3.5 font-medium tracking-wide">
								笔记列表
							</div>
							<ScrollArea
								className="min-h-0 flex-1"
								viewportClassName="px-2"
								scrollbarClassName="border-l-0 pr-0 right-0"
							>
								<div className="flex flex-col gap-2.5 pb-2">
									{/* 旧版列表项：整行按钮，无 hover 编辑/删除 */}
									{sorted.map((n) => {
										// 高亮当前预览项
										const active = preview?.id === n.id;
										return (
											<button
												key={n.id}
												type="button"
												onClick={() => setPreview(n)}
												className={cn(
													'border-theme/10 bg-theme/5 hover:bg-theme/10 w-full rounded-md border px-3 py-2.5 text-left transition-colors',
													active &&
														'border-theme/40 bg-theme/15 ring-theme/30 ring-1',
												)}
											>
												<div className="text-textcolor truncate text-sm font-semibold">
													{n.title}
												</div>
												<div className="text-textcolor/45 mt-1.5 text-xs">
													{new Date(n.at).toLocaleString()}
												</div>
											</button>
										);
									})}
								</div>
							</ScrollArea>
						</aside>
					</ResizablePanel>
				</>
			) : null}
		</ResizablePanelGroup>
	</div>
);
```

**改动后** · `apps/remote-plugins/src/views/learning-notes/index.tsx`（当前，约 L219–L371）

```typescript
// 组件渲染主体
return (
	// 最外层容器：新版用 bg-theme/5
	<div
		className={cn(
			'bg-theme/5 text-textcolor flex h-full min-h-0 min-w-0 flex-col text-sm rounded-md',
		)}
	>
		{/* 删除确认弹层：受控 open/onOpenChange，确认调 onConfirmDelete */}
		<Confirm
			open={confirmOpen}
			onOpenChange={setConfirmOpen}
			title="确定删除这条笔记？"
			description="删除后将无法恢复"
			onConfirm={() => void onConfirmDelete()}
		/>
		<ResizablePanelGroup
			// 分组 id
			id="learning-notes-split"
			// 水平排列
			orientation="horizontal"
			className="h-full min-h-0 min-w-0 flex-1"
		>
			{/* 新版：列表在左 */}
			{listOpen ? (
				<>
					<ResizablePanel
						id="learning-notes-list"
						// 列表占 35%
						defaultSize={35}
						minSize={0}
						className="min-h-0 min-w-0"
					>
						<aside className="border-r mb-3 border-theme/10 flex h-full min-h-0 min-w-0 flex-col overflow-hidden">
							{/* 列表头：标题 + 新建按钮 */}
							<div className="flex h-10 shrink-0 items-center justify-between border-b border-theme/10 pl-3 pr-1.5 font-medium tracking-wide">
								<span className="text-textcolor/85">
									笔记列表{loading ? '…' : ''}
								</span>
								<Btn title="新建笔记" onClick={openNew}>
									<FilePenLine size={15} />
								</Btn>
							</div>
							{/* 与主项目英语学习侧栏一致：内边距写在 ScrollArea Root */}
							<ScrollArea className="min-h-0 flex-1 p-3">
								<div className="flex flex-col gap-3">
									{/* 空列表占位 */}
									{notes.length === 0 && !loading ? (
										<p className="text-textcolor/45 px-1 py-6 text-center text-xs">
											暂无笔记，保存一条试试
										</p>
									) : null}
									{/* 列表项：新版带 hover 编辑/删除按钮 */}
									{notes.map((n) => {
										// 预览优先：避免 preview 与 editingId 同时高亮两条
										const active = (preview?.id ?? editingId) === n.id;
										return (
											<div
												key={n.id}
												className={cn(
													'hover:bg-theme/10 bg-theme/5 group relative w-full rounded-md px-3 py-2.5 text-left transition-colors',
													active && 'bg-theme/15',
												)}
											>
												{/* 整行点击进预览 */}
												<button
													type="button"
													className="w-full text-left"
													onClick={() => void openPreview(n.id)}
												>
													{/* 动态调整 padding-right 配合 transition 实现 hover 平滑过渡 */}
													<div className="text-textcolor truncate text-base font-semibold pr-0 transition-[padding] duration-200 group-hover:pr-14">
														{n.title}
													</div>
													<div className="text-textcolor/45 mt-1.5 text-xs">
														{new Date(n.at).toLocaleString()}
													</div>
												</button>
												{/* hover 时浮现的编辑/删除按钮组 */}
												<div className="absolute top-2 right-2 flex items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
													{/* 编辑按钮：先拉详情再进编辑 */}
													<button
														type="button"
														title="编辑"
														className="w-7 h-7 text-textcolor/80 hover:text-teal-500 hover:bg-teal-500/10 flex cursor-pointer items-center justify-center rounded-md p-1"
														onClick={(e) => {
															// 阻止冒泡到整行预览
															e.stopPropagation();
															// 拉详情后进编辑
															void openEditById(n.id);
														}}
													>
														<SquarePen size={15} />
													</button>
													{/* 删除按钮：打开确认弹层 */}
													<button
														type="button"
														title="删除"
														className="w-7 h-7 text-textcolor/80 hover:text-destructive hover:bg-destructive/10 flex cursor-pointer items-center justify-center rounded-md p-1"
														onClick={(e) => {
															// 阻止冒泡
															e.stopPropagation();
															// 触发删除确认
															onDelete(n.id);
														}}
													>
														<Trash2 size={15} />
													</button>
												</div>
											</div>
										);
									})}
								</div>
							</ScrollArea>
						</aside>
					</ResizablePanel>
					<ResizableHandle withHandle className="w-0" />
				</>
			) : null}
			{/* 新版：编辑器/预览在右 */}
			<ResizablePanel
				id="learning-notes-editor"
				// 列表开时占 65%
				defaultSize={listOpen ? 65 : 100}
				// 最小 50%，保证书写空间
				minSize={50}
				className="min-h-0 min-w-0"
			>
				<div className="border-theme/10 flex h-full min-h-0 min-w-0 flex-col overflow-hidden">
					{/* 预览时隐藏编辑器 */}
					<div
						className={cn(
							'flex h-full min-h-0 flex-1 flex-col overflow-hidden',
							preview && 'hidden',
						)}
					>
						<RichEditor
							// key 变化触发重挂载，配合 editorInitial 重置内容
							key={editorSeed}
							// 初始内容：新建空文档 / 编辑笔记 html
							defaultContent={editorInitial}
							// 自动聚焦到末尾
							autofocus="end"
							placeholder="记下今天的单词、语法或口语收获…"
							showCharCount={false}
							onChange={({ html, text, title }) =>
								setDraft({ html, text, title })
							}
							className="flex h-full min-h-0 flex-1 flex-col overflow-hidden"
							editorClassName="min-h-[6rem]"
							toolbarExtra={toolbarExtra}
						/>
					</div>
					{preview ? (
						<NotePreview
							title={preview.title}
							html={preview.html}
							{/* 新版预览头：新建 + 编辑 + 删除 + 列表开关 */}
							headerExtra={
								<>
									<Btn title="新建笔记" onClick={openNew}>
										<FilePenLine size={15} />
									</Btn>
									<Btn title="编辑" onClick={() => openEdit(preview)}>
										<SquarePen size={15} />
									</Btn>
									<Btn title="删除" onClick={() => onDelete(preview.id)}>
										<Trash2 size={15} />
									</Btn>
									{listToggleBtn()}
								</>
							}
						/>
					) : null}
				</div>
			</ResizablePanel>
		</ResizablePanelGroup>
	</div>
);
```

**变更摘要**：面板顺序由「编辑器左/列表右」翻转为「列表左 35%/编辑器右 65%」；列表项加 hover 编辑/删除按钮；`RichEditor` 加 `key`/`defaultContent`/`autofocus`；预览头改为新建/编辑/删除/列表开关；外层插入 `<Confirm>`。

### 4.2 `createNotesApi` 工厂（`apps/remote-plugins/src/views/learning-notes/api.ts`）— 纯新增

**改动后** · `apps/remote-plugins/src/views/learning-notes/api.ts`（当前，约 L1–L93）

```typescript
// 文件头注释：学习笔记 API 层，经 HostBridge 调主站 /english-learning/notes/*
/** 学习笔记：经 HostBridge 调用主站 `/english-learning/notes/*` */

// HostHttp：描述宿主注入的 HTTP 能力形状（与 HostBridge http 契约一致）
export type HostHttp = {
	// GET 请求
	get: <T = unknown>(url: string) => Promise<T>;
	// POST 请求，可带 body
	post: <T = unknown>(url: string, body?: unknown) => Promise<T>;
	// PUT 请求，可带 body（本轮新增）
	put: <T = unknown>(url: string, body?: unknown) => Promise<T>;
	// DELETE 请求（本轮新增）
	delete: <T = unknown>(url: string) => Promise<T>;
};

// 后端基础路径常量
const BASE = '/english-learning/notes';

// 后端记录类型：与 DB 实体一致，title 可空、content 为 html
export type NoteRecord = {
	// 主键 id
	id: string;
	// 标题（可空，空时 UI 占位「无标题笔记」）
	title: string | null;
	// 正文 html
	content: string;
	// 用户 id（后端写入）
	userId?: number;
	// 创建时间 ISO
	createdAt?: string;
	// 更新时间 ISO
	updatedAt?: string;
};

// 列表项类型：列表接口不返回 content，用 Omit 去除
export type NoteListItem = Omit<NoteRecord, 'content'>;

// 前端展示用 Note 类型：扁平化 + 时间戳
export type Note = {
	// 主键 id
	id: string;
	// 标题（已占位处理，必非空）
	title: string;
	// 正文 html
	html: string;
	// 毫秒时间戳
	at: number;
};

// unwrapData：统一剥离 { data: T } 外壳，兼容裸返回
function unwrapData<T>(res: unknown): T {
	// 若返回值是带 data 字段的对象，取 data
	if (res && typeof res === 'object' && 'data' in res) {
		return (res as { data: T }).data;
	}
	// 否则直接当 T 返回
	return res as T;
}

// toNote：把后端记录映射为前端 Note
function toNote(row: NoteListItem | NoteRecord): Note {
	// 若含 content 字段且为字符串则取，否则空串
	const html =
		'content' in row && typeof row.content === 'string' ? row.content : '';
	// 优先 updatedAt，回退 createdAt
	const atRaw = row.updatedAt ?? row.createdAt;
	// 转毫秒时间戳
	const at = atRaw ? new Date(atRaw).getTime() : Date.now();
	return {
		// 透传 id
		id: row.id,
		// 标题空则占位
		title: (row.title ?? '').trim() || '无标题笔记',
		// 正文 html
		html,
		// 时间戳非有限数则兜底当前时间
		at: Number.isFinite(at) ? at : Date.now(),
	};
}

// createNotesApi：工厂函数，注入 http 返回五个方法的 API 对象
export function createNotesApi(http: HostHttp) {
	return {
		// list：拉取笔记列表（按时间倒序）
		async list(pageSize = 100): Promise<Note[]> {
			// 调 list 接口，默认取前 100 条
			const res = await http.get(`${BASE}/list?pageNo=1&pageSize=${pageSize}`);
			// 剥离 data 外壳得到分页对象
			const page = unwrapData<{ list: NoteListItem[]; total: number }>(res);
			// 防御：list 非数组则当空数组
			const list = Array.isArray(page?.list) ? page.list : [];
			// 逐条转 Note 并按时间倒序
			return list.map(toNote).sort((a, b) => b.at - a.at);
		},

		// detail：拉取单条笔记详情（含 content）
		async detail(id: string): Promise<Note> {
			// 调 detail 接口
			const res = await http.get(`${BASE}/detail/${id}`);
			// 剥离外壳并转 Note
			return toNote(unwrapData<NoteRecord>(res));
		},

		// save：新建笔记，返回新 id
		async save(input: {
			title: string;
			html: string;
		}): Promise<{ id: string }> {
			// 调 save 接口，标题空转 null
			const res = await http.post(`${BASE}/save`, {
				title: input.title.trim() || null,
				content: input.html,
			});
			// 剥离外壳得到 { id }
			return unwrapData<{ id: string }>(res);
		},

		// update：更新已有笔记，返回更新后的 Note
		async update(
			id: string,
			input: { title: string; html: string },
		): Promise<Note> {
			// 调 update 接口（PUT），带上 id/标题/正文
			const res = await http.put(`${BASE}/update/${id}`, {
				id,
				title: input.title.trim() || null,
				content: input.html,
			});
			// 剥离外壳并转 Note
			return toNote(unwrapData<NoteRecord>(res));
		},

		// remove：删除笔记
		async remove(id: string): Promise<void> {
			// 调 delete 接口
			await http.delete(`${BASE}/delete/${id}`);
		},
	};
}

// 导出 API 对象类型，便于组件标注
export type NotesApi = ReturnType<typeof createNotesApi>;
```

**变更摘要**：纯新增 API 层，含 `HostHttp` / `NoteRecord` / `NoteListItem` / `Note` 类型、`unwrapData` / `toNote` 映射、`createNotesApi` 工厂（list/detail/save/update/remove）。

### 4.3 `Confirm` 组件（`apps/remote-plugins/src/components/design/Confirm/index.tsx`）— 纯新增

**改动后** · `apps/remote-plugins/src/components/design/Confirm/index.tsx`（当前，约 L1–L157）

```typescript
// 基于 radix AlertDialog 的确认对话框
import { AlertDialog as AlertDialogPrimitive } from 'radix-ui';
// ReactNode 用于 description 类型
import type { ReactNode } from 'react';
// useCallback 缓存 handleConfirm；useEffect 处理回车确认
import { useCallback, useEffect } from 'react';
// 复用主项目 Button 与 buttonVariants
import { Button, buttonVariants } from '@/components/ui/button';
// cn 合并 className
import { cn } from '@/lib/utils';

// Confirm 组件 Props 契约
interface ConfirmProps {
	// 是否打开（受控）
	open: boolean;
	// 开关回调
	onOpenChange: (open: boolean) => void;
	// 标题
	title: string;
	// 描述（可为 ReactNode，支持富文本）
	description: ReactNode;
	// 描述区域额外 className（例如 text-left）
	/** 描述区域额外 className（例如 text-left） */
	descriptionClassName?: string;
	// 确认按钮文案，默认「确认」
	confirmText?: string;
	// 取消按钮文案，默认「取消」
	cancelText?: string;
	// 确认按钮样式，覆盖保存等危险操作用 destructive
	/** 确认按钮样式，覆盖保存等危险操作用 destructive */
	confirmVariant?: 'default' | 'destructive';
	// 点击确认后是否立即关闭；异步 onConfirm 失败需保持打开时设 false
	/**
	 * 点击确认后是否立即关闭。异步 onConfirm 且需在失败时保持打开时设为 false，由调用方自行 onOpenChange(false)
	 */
	closeOnConfirm?: boolean;
	// 为 true 且弹层打开时，回车触发与「确认」相同逻辑（排除 input/textarea 等）
	/**
	 * 为 true 且弹层打开时，回车触发与「确认」相同逻辑（会排除 input/textarea 等，避免与编辑器冲突）
	 */
	confirmOnEnter?: boolean;
	// 确认回调
	onConfirm: () => void;
	// 可选第三钮（如「另存为」），样式为 outline，位于取消与确认之间
	/** 可选第三钮（如「另存为」），样式为 outline，位于取消与确认之间 */
	secondaryActionText?: string;
	// 第三钮回调
	onSecondaryAction?: () => void | Promise<void>;
	// 可选第四钮，位于 secondary 与主确认之间
	/** 可选第四钮，位于 secondary 与主确认之间 */
	tertiaryActionText?: string;
	// 第四钮回调
	onTertiaryAction?: () => void | Promise<void>;
	// 第四钮样式
	tertiaryVariant?: 'outline' | 'destructive';
	// 取消回调（可选）
	onCancel?: () => void;
	// 内容区额外 className
	className?: string;
}

// Confirm 组件实现
const Confirm = ({
	// 解构 props（含默认值）
	open,
	onOpenChange,
	title,
	description,
	descriptionClassName,
	// 确认文案默认「确认」
	confirmText = '确认',
	// 取消文案默认「取消」
	cancelText = '取消',
	// 确认样式默认 default
	confirmVariant = 'default',
	// 默认点击确认即关闭
	closeOnConfirm = true,
	// 默认不开启回车确认
	confirmOnEnter = false,
	onConfirm,
	secondaryActionText,
	onSecondaryAction,
	tertiaryActionText,
	onTertiaryAction,
	// 第四钮默认 outline
	tertiaryVariant = 'outline',
	onCancel,
	className,
}: ConfirmProps) => {
	// handleConfirm：缓存，先调 onConfirm 再按 closeOnConfirm 决定是否关闭
	const handleConfirm = useCallback(() => {
		// 调用业务确认回调
		onConfirm();
		// 默认立即关闭
		if (closeOnConfirm) {
			onOpenChange(false);
		}
		// 依赖项：三个回调/开关
	}, [onConfirm, closeOnConfirm, onOpenChange]);

	// handleCancel：调可选 onCancel 后强制关闭
	const handleCancel = () => {
		// 可选取消回调
		onCancel?.();
		// 关闭弹层
		onOpenChange(false);
	};

	// 按需：弹层打开时回车等同点击确认（排除输入类元素，避免与编辑器抢键）
	/** 按需：弹层打开时回车等同点击确认（排除输入类元素，避免与编辑器抢键） */
	useEffect(() => {
		// 未开或未启用回车确认则不注册
		if (!open || !confirmOnEnter) return;
		// 键盘事件处理
		const onKeyDown = (e: KeyboardEvent) => {
			// 非回车或长按重复则忽略
			if (e.key !== 'Enter' || e.repeat) return;
			// 命中输入类元素则放过（避免与编辑器/输入框冲突）
			const el = e.target as HTMLElement | null;
			if (
				el?.closest(
					'input, textarea, select, [contenteditable="true"], [role="textbox"]',
				)
			) {
				return;
			}
			// 阻止默认与冒泡
			e.preventDefault();
			e.stopPropagation();
			// 触发确认
			handleConfirm();
		};
		// 捕获阶段注册，确保早于编辑器
		window.addEventListener('keydown', onKeyDown, true);
		// 卸载时移除
		return () => window.removeEventListener('keydown', onKeyDown, true);
		// 依赖项
	}, [open, confirmOnEnter, handleConfirm]);

	return (
		// radix AlertDialog 根
		<AlertDialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
			{/* Portal 挂到 body */}
			<AlertDialogPrimitive.Portal>
				{/* 遮罩层 + 淡入淡出动画 */}
				<AlertDialogPrimitive.Overlay
					className={cn(
						'data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 fixed inset-0 z-50 bg-theme-background/80',
					)}
				/>
				{/* 内容区：居中 + 缩放动画 */}
				<AlertDialogPrimitive.Content
					className={cn(
						'bg-theme-background data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 fixed top-[50%] left-[50%] z-50 grid w-full min-w-0 max-w-[calc(100%-2rem)] translate-x-[-50%] translate-y-[-50%] gap-4 rounded-lg border border-theme/10 p-6 shadow-lg duration-200 sm:max-w-lg',
						className,
					)}
				>
					{/* 标题 */}
					<AlertDialogPrimitive.Title className="min-w-0 wrap-break-word text-lg font-semibold">
						{title}
					</AlertDialogPrimitive.Title>
					{/* 描述：用 asChild + div 避免默认 p 内嵌 div 非法 DOM */}
					{/* 使用 asChild + div：避免默认 <p> 内嵌 <div> 导致非法 DOM 与水合报错 */}
					<AlertDialogPrimitive.Description asChild>
						<div
							className={cn(
								'text-textcolor text-md min-w-0 wrap-anywhere',
								descriptionClassName,
							)}
						>
							{description}
						</div>
					</AlertDialogPrimitive.Description>
					{/* 按钮区：移动端反向列排，桌面端右对齐 */}
					<div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end mt-4">
						{/* 取消按钮 */}
						<AlertDialogPrimitive.Cancel
							onClick={handleCancel}
							className={cn(buttonVariants({ variant: 'outline' }))}
						>
							{cancelText}
						</AlertDialogPrimitive.Cancel>
						{/* 可选第三钮 */}
						{secondaryActionText && onSecondaryAction ? (
							<Button
								type="button"
								variant="outline"
								onClick={() => void onSecondaryAction()}
							>
								{secondaryActionText}
							</Button>
						) : null}
						{/* 可选第四钮 */}
						{tertiaryActionText && onTertiaryAction ? (
							<Button
								type="button"
								variant={tertiaryVariant}
								onClick={() => void onTertiaryAction()}
							>
								{tertiaryActionText}
							</Button>
						) : null}
						{/* 确认按钮 */}
						<AlertDialogPrimitive.Action
							onClick={handleConfirm}
							className={cn(buttonVariants({ variant: confirmVariant }))}
						>
							{confirmText}
						</AlertDialogPrimitive.Action>
					</div>
				</AlertDialogPrimitive.Content>
			</AlertDialogPrimitive.Portal>
		</AlertDialogPrimitive.Root>
	);
};

// 默认导出 Confirm
export default Confirm;
```

**变更摘要**：纯新增通用确认对话框，基于 radix `AlertDialog`，支持确认/取消/可选第三/第四钮、回车确认、`closeOnConfirm` 异步控制。

### 4.4 HostBridge HTTP 扩展（`apps/remote-plugins/src/.../attachIframeBridge.ts`）

**对比范围**：`dispatchRpc` 函数内 `switch (method)` 的 http 分支（其余分支未改动，对称省略）。

**改动前** · `apps/frontend/src/plugins/core/attachIframeBridge.ts`（基线，约 L39–L45）

```typescript
// RPC 分发：旧版仅处理 http.get / http.post
	switch (method) {
		case 'http.get':
			// 未授权 http 抛 HTTP_DENIED
			if (!api.http) throw new Error('HTTP_DENIED');
			// 调 get，args[0] 为 url
			return api.http.get(String(args[0] ?? ''));
		case 'http.post':
			// 未授权 http 抛 HTTP_DENIED
			if (!api.http) throw new Error('HTTP_DENIED');
			// 调 post，args[0] 为 url，args[1] 为 body
			return api.http.post(String(args[0] ?? ''), args[1]);
		// ...（未改动：ui.showToast / ebook.* 等其余 case 省略）
```

**改动后** · `apps/frontend/src/plugins/core/attachIframeBridge.ts`（当前，约 L39–L51）

```typescript
// RPC 分发：新版补齐 http.put / http.delete
	switch (method) {
		case 'http.get':
			// 未授权 http 抛 HTTP_DENIED
			if (!api.http) throw new Error('HTTP_DENIED');
			// 调 get，args[0] 为 url
			return api.http.get(String(args[0] ?? ''));
		case 'http.post':
			// 未授权 http 抛 HTTP_DENIED
			if (!api.http) throw new Error('HTTP_DENIED');
			// 调 post，args[0] 为 url，args[1] 为 body
			return api.http.post(String(args[0] ?? ''), args[1]);
		case 'http.put':
			// 新增：未授权 http 抛 HTTP_DENIED
			if (!api.http) throw new Error('HTTP_DENIED');
			// 调 put，args[0] 为 url，args[1] 为 body
			return api.http.put(String(args[0] ?? ''), args[1]);
		case 'http.delete':
			// 新增：未授权 http 抛 HTTP_DENIED
			if (!api.http) throw new Error('HTTP_DENIED');
			// 调 delete，args[0] 为 url
			return api.http.delete(String(args[0] ?? ''));
		// ...（未改动：ui.showToast / ebook.* 等其余 case 省略）
```

**变更摘要**：`dispatchRpc` switch 新增 `http.put` / `http.delete` 两个 case，复用既有 `HTTP_DENIED` 鉴权。

### 4.5 HostBridge 类型扩展（`apps/frontend/src/plugins/core/types.ts`）

**对比范围**：`HostBridgeProps` 接口中 `http?` 字段类型（接口其余字段未改动，对称省略）。

**改动前** · `apps/frontend/src/plugins/core/types.ts`（基线，约 L70–L73）

```typescript
// HostBridgeProps.api.http：旧版仅 get/post
		http?: {
			// GET 请求
			get: <T = unknown>(url: string) => Promise<T>;
			// POST 请求，可带 body
			post: <T = unknown>(url: string, body?: unknown) => Promise<T>;
		};
		// ...（未改动：ui / modules 等其余字段省略）
```

**改动后** · `apps/frontend/src/plugins/core/types.ts`（当前，约 L70–L75）

```typescript
// HostBridgeProps.api.http：新版补齐 put/delete
		http?: {
			// GET 请求
			get: <T = unknown>(url: string) => Promise<T>;
			// POST 请求，可带 body
			post: <T = unknown>(url: string, body?: unknown) => Promise<T>;
			// 新增：PUT 请求，可带 body
			put: <T = unknown>(url: string, body?: unknown) => Promise<T>;
			// 新增：DELETE 请求
			delete: <T = unknown>(url: string) => Promise<T>;
		};
		// ...（未改动：ui / modules 等其余字段省略）
```

**变更摘要**：`http?` 字段类型新增 `put` / `delete` 签名。

### 4.6 `createHostBridge` 扩展（`apps/frontend/src/plugins/core/createHostBridge.ts`）

**对比范围**：`createHostBridge` 内 `http:plugin-api` 权限分支装配 `api.http` 的代码块。

**改动前** · `apps/frontend/src/plugins/core/createHostBridge.ts`（基线，约 L67–L73）

```typescript
// 授权 http:plugin-api 时装配 http 能力：旧版仅 get/post
	if (allow.has('http:plugin-api')) {
		api.http = Object.freeze({
			// get 透传主站 http.get
			get: <T = unknown>(url: string) => http.get<T>(url),
			// post 透传主站 http.post
			post: <T = unknown>(url: string, body?: unknown) =>
				http.post<T>(url, body),
		});
	}
```

**改动后** · `apps/frontend/src/plugins/core/createHostBridge.ts`（当前，约 L67–L75）

```typescript
// 授权 http:plugin-api 时装配 http 能力：新版补齐 put/delete
	if (allow.has('http:plugin-api')) {
		api.http = Object.freeze({
			// get 透传主站 http.get
			get: <T = unknown>(url: string) => http.get<T>(url),
			// post 透传主站 http.post
			post: <T = unknown>(url: string, body?: unknown) =>
				http.post<T>(url, body),
			// 新增：put 透传主站 http.put
			put: <T = unknown>(url: string, body?: unknown) => http.put<T>(url, body),
			// 新增：delete 透传主站 http.delete
			delete: <T = unknown>(url: string) => http.delete<T>(url),
		});
	}
```

**变更摘要**：`api.http` 冻结对象新增 `put` / `delete`，复用既有 `http:plugin-api` 权限位。

### 4.7 `iframeHostClient` 扩展（`apps/remote-plugins/src/utils/iframeHostClient.ts`）

**对比范围**：本地 `HostBridgeProps` 的 `http?` 类型 + `connectIframeHost` 内 bridge.api.http 装配。

**改动前** · `apps/remote-plugins/src/utils/iframeHostClient.ts`（基线，约 L14–L18 / L105–L108）

```typescript
// embed 端本地 HostBridgeProps.http：旧版仅 get/post
		http?: {
			// GET
			get: <T = unknown>(url: string) => Promise<T>;
			// POST
			post: <T = unknown>(url: string, body?: unknown) => Promise<T>;
		};
```

```typescript
// bridge.api.http 装配：旧版仅 get/post 走 RPC
					http: {
						// get 经 RPC 调宿主
						get: (url) => rpc('http.get', [url]) as Promise<never>,
						// post 经 RPC 调宿主
						post: (url, body) =>
							rpc('http.post', [url, body]) as Promise<never>,
					},
```

**改动后** · `apps/remote-plugins/src/utils/iframeHostClient.ts`（当前，约 L14–L19 / L105–L111）

```typescript
// embed 端本地 HostBridgeProps.http：新版补齐 put/delete
		http?: {
			// GET
			get: <T = unknown>(url: string) => Promise<T>;
			// POST
			post: <T = unknown>(url: string, body?: unknown) => Promise<T>;
			// 新增：PUT
			put: <T = unknown>(url: string, body?: unknown) => Promise<T>;
			// 新增：DELETE
			delete: <T = unknown>(url: string) => Promise<T>;
		};
```

```typescript
// bridge.api.http 装配：新版补齐 put/delete 走 RPC
					http: {
						// get 经 RPC 调宿主
						get: (url) => rpc('http.get', [url]) as Promise<never>,
						// post 经 RPC 调宿主
						post: (url, body) =>
							rpc('http.post', [url, body]) as Promise<never>,
						// 新增：put 经 RPC 调宿主
						put: (url, body) =>
							rpc('http.put', [url, body]) as Promise<never>,
						// 新增：delete 经 RPC 调宿主
						delete: (url) => rpc('http.delete', [url]) as Promise<never>,
					},
```

**变更摘要**：embed 端本地类型与 bridge 装配同步补齐 `put` / `delete`，经 `rpc('http.put'/'http.delete')` 走 postMessage 到宿主。

### 4.8 后端模块注册（`apps/backend/src/app.module.ts`）

**对比范围**：`import` 区与 `@Module.imports` 数组中 `LearningNotesModule` 的引入。

**改动前** · `apps/backend/src/app.module.ts`（基线，约 L20–L21 / L96）

```typescript
// 旧版 import 区：仅有 EnglishLearningModule，无 LearningNotesModule
import { EnglishLearningModule } from './services/english-learning/english-learning.module';
import { KnowledgeModule } from './services/knowledge/knowledge.module';
		// ...（未改动：其余 imports / providers 省略）
				EnglishLearningModule,
				EbookModule,
```

**改动后** · `apps/backend/src/app.module.ts`（当前，约 L20–L23 / L96–L98）

```typescript
// 新版 import 区：在 EnglishLearning 与 Knowledge 之间插入 LearningNotesModule
import { EnglishLearningModule } from './services/english-learning/english-learning.module';
import { KnowledgeModule } from './services/knowledge/knowledge.module';
// 新增：学习笔记后端模块
import { LearningNotesModule } from './services/learning-notes/learning-notes.module';
import { LlmConfigModule } from './services/llm-config/llm-config.module';
		// ...（未改动：其余 imports / providers 省略）
				EnglishLearningModule,
				// 新增：注册学习笔记模块
				LearningNotesModule,
				EbookModule,
```

**变更摘要**：新增 `LearningNotesModule` 的 import 与 `@Global() @Module.imports` 注册（紧随 `EnglishLearningModule`）。

### 4.9 ideas-list 本地类型同步（`apps/remote-plugins/src/views/ebook-ideas/index.tsx`）

**对比范围**：`IdeasListApp` 本地 `HostBridgeProps` 类型（与主契约同步 put/delete + 新增 `independent`）。

**改动前** · `apps/remote-plugins/src/views/ebook-ideas/index.tsx`（基线，约 L29–L53）

```typescript
// IdeasList 本地 HostBridgeProps：旧版 http 仅 get/post、无 independent
type HostBridgeProps = {
	api: {
		// i18n 占位
		t: (key: string, params?: Record<string, unknown>) => string;
		// 主题
		theme: 'light' | 'dark';
		// 可选导航
		navigate?: (to: string) => void;
		// 事件总线
		event: {
			on: (event: string, handler: (data?: unknown) => void) => void;
			off: (event: string, handler: (data?: unknown) => void) => void;
			emit: (event: string, data?: unknown) => void;
		};
		// http：旧版仅 get/post
		http?: {
			get: <T = unknown>(url: string) => Promise<T>;
			post: <T = unknown>(url: string, body?: unknown) => Promise<T>;
		};
		// ...（未改动：ui / modules 省略）
	};
	plugin: { id: string; version: string; routePath: string };
};
```

**改动后** · `apps/remote-plugins/src/views/ebook-ideas/index.tsx`（当前，约 L29–L56）

```typescript
// IdeasList 本地 HostBridgeProps：新版补齐 put/delete + independent
type HostBridgeProps = {
	api: {
		// i18n 占位
		t: (key: string, params?: Record<string, unknown>) => string;
		// 主题
		theme: 'light' | 'dark';
		// 可选导航
		navigate?: (to: string) => void;
		// 事件总线
		event: {
			on: (event: string, handler: (data?: unknown) => void) => void;
			off: (event: string, handler: (data?: unknown) => void) => void;
			emit: (event: string, data?: unknown) => void;
		};
		// http：新版补齐 put/delete
		http?: {
			get: <T = unknown>(url: string) => Promise<T>;
			post: <T = unknown>(url: string, body?: unknown) => Promise<T>;
			// 新增：PUT
			put: <T = unknown>(url: string, body?: unknown) => Promise<T>;
			// 新增：DELETE
			delete: <T = unknown>(url: string) => Promise<T>;
		};
		// ...（未改动：ui / modules 省略）
	};
	plugin: { id: string; version: string; routePath: string };
	// 新增：是否独立运行
	// 是否独立运行
	independent?: boolean;
};
```

**变更摘要**：本地 `HostBridgeProps.http` 补齐 `put` / `delete`，并新增 `independent?` 属性，与学习笔记侧契约对齐。

### 4.10 快捷键保存与交互细节优化（`apps/remote-plugins/src/views/learning-notes/index.tsx`）

本文件本轮迭代追加 4 处改动，拆成 3 个对比组：A `onSave` 改 `useCallback`、B 新增 Cmd/Ctrl+S 快捷键、C 保存按钮 tooltip 与列表标题微调。

#### 对比组 A：`onSave` 改为 `useCallback`

**对比范围**：`onSave` 函数完整定义（从函数签名到闭合）。

**改动前** · `apps/remote-plugins/src/views/learning-notes/index.tsx`（基线，约 L143–L172）

```typescript
// 保存：新建走 save，已有 id 走 update（普通函数声明，每次渲染重建）
const onSave = async () => {
	// 标题为空提示并中断
	if (!draft.title.trim()) return toast('请先输入标题', 'info');
	// 正文为空提示并中断
	if (!draft.text.trim()) return toast('请先输入内容', 'info');
	// 未授权 HTTP 提示并中断
	if (!notesApi) return toast('未授权 HTTP，无法保存', 'error');
	// 置保存中
	setSaving(true);
	try {
		// 组装保存载荷
		const payload = {
			// 标题空则占位
			title: draft.title.trim() || '无标题笔记',
			// 草稿 html
			html: draft.html,
		};
		// 有编辑 id 走更新分支
		if (editingId) {
			// 调 update 返回更新后的 Note
			const updated = await notesApi.update(editingId, payload);
			// 同步编辑 id（后端可能规范化）
			setEditingId(updated.id);
			// toast 更新成功
			toast('已更新笔记', 'success');
		} else {
			// 新建分支：save 返回新 id
			const { id } = await notesApi.save(payload);
			// 写入编辑 id（后续保存变更新）
			setEditingId(id);
			// toast 保存成功
			toast('已保存笔记', 'success');
		}
		// 保存后刷新列表
		await refreshList();
	} catch (e) {
		// 失败 toast
		toast(errMsg(e), 'error');
	} finally {
		// 关闭保存中
		setSaving(false);
	}
};
```

**改动后** · `apps/remote-plugins/src/views/learning-notes/index.tsx`（当前，约 L240–L265）

```typescript
// 保存：新建走 save，已有 id 走 update（useCallback 包裹，依赖不变则引用稳定）
const onSave = useCallback(async () => {
	// 标题为空提示并中断
	if (!draft.title.trim()) return toast('请先输入标题', 'info');
	// 正文为空提示并中断
	if (!draft.text.trim()) return toast('请先输入内容', 'info');
	// 未授权 HTTP 提示并中断
	if (!notesApi) return toast('未授权 HTTP，无法保存', 'error');
	// 置保存中
	setSaving(true);
	try {
		// 组装保存载荷
		const payload = {
			// 标题空则占位
			title: draft.title.trim() || '无标题笔记',
			// 草稿 html
			html: draft.html,
		};
		// 有编辑 id 走更新分支
		if (editingId) {
			// 调 update 返回更新后的 Note
			const updated = await notesApi.update(editingId, payload);
			// 同步编辑 id（后端可能规范化）
			setEditingId(updated.id);
			// toast 更新成功
			toast('已更新笔记', 'success');
		} else {
			// 新建分支：save 返回新 id
			const { id } = await notesApi.save(payload);
			// 写入编辑 id（后续保存变更新）
			setEditingId(id);
			// toast 保存成功
			toast('已保存笔记', 'success');
		}
		// 保存后刷新列表
		await refreshList();
	} catch (e) {
		// 失败 toast
		toast(errMsg(e), 'error');
	} finally {
		// 关闭保存中
		setSaving(false);
	}
	// 依赖数组：所有外部用到的响应式值，变化则重建函数
}, [draft, editingId, notesApi, refreshList, toast]);
```

**变更摘要**：`onSave` 从普通函数改为 `useCallback` 包裹，显式声明 `[draft, editingId, notesApi, refreshList, toast]` 依赖，保证引用稳定，供下方快捷键 `useEffect` 安全依赖。

#### 对比组 B：Cmd/Ctrl+S 快捷键（新增 `useEffect`）

**对比范围**：`onSave` 之后、`onDelete` 之前新增的 `keydown` 监听 `useEffect`（改动前无此段）。

**改动前** · `apps/remote-plugins/src/views/learning-notes/index.tsx`（基线，约 L174 前后）

```typescript
// （改动前：无快捷键监听，直接接 onDelete）
```

**改动后** · `apps/remote-plugins/src/views/learning-notes/index.tsx`（当前，约 L267–L278）

```typescript
// Cmd/Ctrl+S：编辑态保存或更新（预览态不处理）
useEffect(() => {
	// 键盘按下事件处理函数
	const onKeyDown = (e: KeyboardEvent) => {
		// 不是 meta+S 也不是 ctrl+S 则直接返回（不处理）
		if (!(e.metaKey || e.ctrlKey) || e.key.toLowerCase() !== 's') return;
		// 预览态不处理（预览时没有编辑器，保存无意义）
		if (preview) return;
		// 阻止浏览器默认保存行为
		e.preventDefault();
		// 保存中则不重复触发（简单防抖）
		if (saving) return;
		// 调用保存函数（void 显式忽略 Promise）
		void onSave();
	};
	// 注册全局 keydown 监听
	window.addEventListener('keydown', onKeyDown);
	// 清理：卸载或依赖变化时移除监听
	return () => window.removeEventListener('keydown', onKeyDown);
	// 依赖项：onSave 引用变化则重新注册监听；preview/saving 变化也需重新绑定以拿到最新值
}, [onSave, preview, saving]);
```

**变更摘要**：新增全局 `keydown` 监听 `useEffect`，Cmd/Ctrl+S 触发保存；预览态跳过、`saving` 中防抖；依赖 `onSave` / `preview` / `saving`，保证回调内读到最新状态。

#### 对比组 C：保存按钮 tooltip + 列表标题

**对比范围**：`toolbarExtra` 中保存按钮的 `title` 属性 + 列表头标题的 `loading` 省略号。

**改动前** · `apps/remote-plugins/src/views/learning-notes/index.tsx`（基线，约 L110–L112 / L196–L198）

```typescript
// 保存按钮 tooltip：仅显示保存/更新/保存中，无快捷键提示
title={saving ? '保存中…' : editingId ? '更新笔记' : '保存笔记'}
```

```typescript
// 列表标题：loading 时追加省略号
<span className="text-textcolor/85">
	笔记列表{loading ? '…' : ''}
</span>
```

**改动后** · `apps/remote-plugins/src/views/learning-notes/index.tsx`（当前，约 L325–L327 / L364–L366）

```typescript
// 保存按钮 tooltip：保存/更新文案后追加 ⌘S 提示，告知用户有快捷键
title={saving ? '保存中…' : editingId ? '更新笔记 ⌘S' : '保存笔记 ⌘S'}
```

```typescript
// 列表标题：去掉 loading 省略号，保持视觉简洁（加载态已有空列表占位 + 后续条目渐入）
<span className="text-textcolor/85">笔记列表</span>
```

**变更摘要**：保存按钮 tooltip 追加 `⌘S` 快捷键提示；列表标题去掉 `loading` 状态的省略号，简化视觉。

## 5. 兼容性与影响

- **HostBridge 契约向后兼容**：`put` / `delete` 是 `http?` 对象上的新增成员，旧插件不会因缺实现而崩溃（未用到即不调）；但旧版本的 `iframeHostClient` / `attachIframeBridge` 若未升级，调用 `put` / `delete` 会命中 `UNKNOWN_RPC`，因此 iframe 隔离插件升级 `put/delete` 时须同步升级 host 端分发。
- **权限位未新增**：仍复用 `http:plugin-api`，已授权该权限的插件自动获得 `put` / `delete` 能力；若需更细粒度需后续单独引入权限位。
- **学习笔记数据持久化**：旧版内存种子数据被移除，首次进入会从后端拉取；无后端或未授权 HTTP 时列表为空并 toast 提示，不影响编辑器输入（但无法保存）。
- **编辑器重挂载**：`key={editorSeed}` 会在新建/编辑切换时卸载重建 Tiptap 实例，草稿不会跨笔记串扰；但 `autofocus="end"` 会在每次重建后抢焦点。
- **Cmd/Ctrl+S 快捷键**：全局 `keydown` 监听绑定在 `window` 上，仅在编辑态（无 `preview`）触发，预览态静默跳过；`saving` 进行中不重复触发（简单防抖）；不会与浏览器默认保存冲突（已 `preventDefault`）；若组件外层还有其他快捷键监听，注意事件冒泡顺序——当前未做 `stopPropagation`，若有冲突可后续加作用域判断。
- **回归建议**：测新建→保存→列表出现；编辑→更新→列表时间刷新；删除确认→列表消失；预览态编辑/删除；列表关闭/打开按钮；未授权 HTTP 的降级提示；iframe 隔离插件下 `put/delete` RPC 链路；Cmd/Ctrl+S 编辑态保存、预览态不触发、连按不重复提交。

## 6. 相关源码路径

| 说明 | 路径 |
| ---- | ---- |
| 学习笔记主应用（CRUD + 布局） | `apps/remote-plugins/src/views/learning-notes/index.tsx` |
| 学习笔记 API 工厂 | `apps/remote-plugins/src/views/learning-notes/api.ts` |
| Confirm 确认对话框 | `apps/remote-plugins/src/components/design/Confirm/index.tsx` |
| HostBridge 类型契约 | `apps/frontend/src/plugins/core/types.ts` |
| HostBridge 装配 | `apps/frontend/src/plugins/core/createHostBridge.ts` |
| iframe RPC 分发 | `apps/frontend/src/plugins/core/attachIframeBridge.ts` |
| embed 端 iframe host client | `apps/remote-plugins/src/utils/iframeHostClient.ts` |
| ideas-list 本地类型同步 | `apps/remote-plugins/src/views/ebook-ideas/index.tsx` |
| 后端模块注册 | `apps/backend/src/app.module.ts` |
| 学习笔记后端模块 | `apps/backend/src/services/learning-notes/learning-notes.module.ts` |

延伸阅读：[学习笔记远程.md](./学习笔记远程.md)（MF Remote 接入）、[学习笔记富文本编辑.md](../ideas/notes/学习笔记富文本编辑.md)（富文本编辑器）。

---

（若与仓库最新源码不一致，以源码为准）
