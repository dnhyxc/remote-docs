# 学习笔记 MobX 状态管理与分页加载

## 1. 背景与目标

学习笔记原实现使用多个 `useState` 在组件内分散管理状态（列表、草稿、预览、编辑中 ID、加载状态等），存在以下问题：

- **状态分散**：十余个 `useState` 散落在组件顶部，逻辑与 UI 耦合度高
- **难以测试**：业务逻辑与 React 生命周期强绑定，无法独立单元测试
- **复用困难**：状态逻辑无法在其他组件或插件中复用
- **分页缺失**：列表接口一次性拉取 100 条，数据量大时性能差

本次重构目标：

1. 将状态与业务逻辑抽离到 MobX Store 集中管理
2. API 层改造为分页返回，支持滚动加载更多
3. 组件层改为 `observer` 响应式渲染，简化状态读取
4. 保持原有功能体验不变，为后续功能迭代奠定基础

## 2. 改动范围

| 模块 | 路径 | 改动类型 |
| ---- | ---- | -------- |
| API 层 | `apps/remote-plugins/src/views/learning-notes/api.ts` | 修改：分页结构、list 方法签名 |
| Store 层 | `apps/remote-plugins/src/store/learningNotes.ts` | 新增：LearningNotesStore 类 |
| Store 根 | `apps/remote-plugins/src/store/index.ts` | 新增：RootStore + Context + useStore |
| 组件层 | `apps/remote-plugins/src/views/learning-notes/index.tsx` | 修改：observer 包装、状态从 store 取、分页加载 UI |

## 3. 实现思路

### 3.1 架构分层

采用「API 层 → Store 层 → 组件层」三层架构：

- **API 层**：仅负责 HTTP 请求封装与数据转换，无状态
- **Store 层**：集中管理状态、业务逻辑、副作用，与 React 无关
- **组件层**：仅负责渲染与用户交互转发，通过 `observer` 响应式更新

### 3.2 MobX 核心设计

- 使用 `makeAutoObservable` 自动推导可观察属性与动作
- `autoBind: true` 确保方法 `this` 始终指向 store 实例，可直接作为回调传入组件
- 计算属性 `hasMore`、`hasActive` 基于现有状态派生，避免重复手动维护
- 异步操作使用 `runInAction` 包装状态修改，确保响应式追踪正确

### 3.3 分页加载设计

- API 返回 `{ list, total, pageNo, pageSize }` 分页结构
- Store 维护累积列表 `list`、总数 `total`、当前页 `pageNo`
- `fetchPage(page, append)` 通用方法：`append=false` 刷新替换，`append=true` 追加去重
- 滚动到底部阈值（3 倍边缘距离）时触发 `loadMore()`
- 底部展示「加载中…」与「没有更多了」状态提示

### 3.4 依赖注入

- Store 不直接依赖宿主环境，通过 `bind(http, toast)` 注入 HTTP 客户端与 toast 方法
- 组件在 `useEffect` 中调用 `store.bind()`，支持 HTTP 实例动态变化
- 私有字段 `api`、`toast` 封装内部实现，外部不可直接访问

## 4. 关键代码对比与注释

### 4.1 API 层分页改造（`api.ts`）

**改动前** · `apps/remote-plugins/src/views/learning-notes/api.ts`（基线，约 L10–L77）

```typescript
// 接口基础路径常量
const BASE = '/english-learning/notes';

// 后端返回的完整笔记记录类型（包含 content 字段）
export type NoteRecord = {
	// 笔记唯一标识
	id: string;
	// 笔记标题，可能为空
	title: string | null;
	// 笔记正文内容（HTML 字符串）
	content: string;
	// 用户 ID（可选）
	userId?: number;
	// 创建时间（可选，ISO 字符串）
	createdAt?: string;
	// 更新时间（可选，ISO 字符串）
	updatedAt?: string;
};

// 列表项类型：省略 content 字段以减少传输量
export type NoteListItem = Omit<NoteRecord, 'content'>;

// 前端统一使用的笔记类型
export type Note = {
	// 笔记唯一标识
	id: string;
	// 笔记标题（处理后的非空字符串）
	title: string;
	// 笔记 HTML 内容
	html: string;
	// 时间戳（更新时间或创建时间）
	at: number;
};

// 统一解包响应数据：如果有 data 字段则取 data，否则直接返回
function unwrapData<T>(res: unknown): T {
	// 判断 res 是否为对象且包含 data 属性
	if (res && typeof res === 'object' && 'data' in res) {
		// 类型断言后返回 data 字段
		return (res as { data: T }).data;
	}
	// 无 data 字段时直接返回（类型断言）
	return res as T;
}

// 将后端记录转换为前端 Note 类型
function toNote(row: NoteListItem | NoteRecord): Note {
	// 提取 HTML 内容：如果有 content 字段则使用，否则为空字符串
	const html =
		'content' in row && typeof row.content === 'string' ? row.content : '';
	// 优先取更新时间，其次取创建时间
	const atRaw = row.updatedAt ?? row.createdAt;
	// 转换为毫秒时间戳
	const at = atRaw ? new Date(atRaw).getTime() : Date.now();
	// 返回标准化的 Note 对象
	return {
		// 笔记 ID
		id: row.id,
		// 标题：去除首尾空格，空则显示「无标题笔记」
		title: (row.title ?? '').trim() || '无标题笔记',
		// HTML 内容
		html,
		// 时间戳：确保为有效数字，否则用当前时间
		at: Number.isFinite(at) ? at : Date.now(),
	};
}

// 创建笔记 API 实例的工厂函数
export function createNotesApi(http: HostHttp) {
	// 返回包含各方法的 API 对象
	return {
		// 获取笔记列表：默认拉取 100 条，返回 Note 数组
		async list(pageSize = 100): Promise<Note[]> {
			// 调用 HTTP GET 请求，pageNo 固定为 1
			const res = await http.get(`${BASE}/list?pageNo=1&pageSize=${pageSize}`);
			// 解包响应数据，期望包含 list 和 total
			const page = unwrapData<{ list: NoteListItem[]; total: number }>(res);
			// 安全获取 list 数组，非数组则默认为空
			const list = Array.isArray(page?.list) ? page.list : [];
			// 转换为 Note 类型并按时间倒序排序（新的在前）
			return list.map(toNote).sort((a, b) => b.at - a.at);
		},

		// ...（其余方法未改动，省略）
	};
}
```

**改动后** · `apps/remote-plugins/src/views/learning-notes/api.ts`（当前，约 L10–L77）

```typescript
// 接口基础路径常量
const BASE = '/english-learning/notes';

// 列表默认每页条数常量
export const NOTES_PAGE_SIZE = 10;

// 后端返回的完整笔记记录类型（包含 content 字段）
export type NoteRecord = {
	// 笔记唯一标识
	id: string;
	// 笔记标题，可能为空
	title: string | null;
	// 笔记正文内容（HTML 字符串）
	content: string;
	// 用户 ID（可选）
	userId?: number;
	// 创建时间（可选，ISO 字符串）
	createdAt?: string;
	// 更新时间（可选，ISO 字符串）
	updatedAt?: string;
};

// 列表项类型：省略 content 字段以减少传输量
export type NoteListItem = Omit<NoteRecord, 'content'>;

// 前端统一使用的笔记类型
export type Note = {
	// 笔记唯一标识
	id: string;
	// 笔记标题（处理后的非空字符串）
	title: string;
	// 笔记 HTML 内容
	html: string;
	// 时间戳（更新时间或创建时间）
	at: number;
};

// 分页返回结构类型
export type NoteListPage = {
	// 当前页的笔记列表
	list: Note[];
	// 总记录数
	total: number;
	// 当前页码
	pageNo: number;
	// 每页条数
	pageSize: number;
};

// 统一解包响应数据：如果有 data 字段则取 data，否则直接返回
function unwrapData<T>(res: unknown): T {
	// 判断 res 是否为对象且包含 data 属性
	if (res && typeof res === 'object' && 'data' in res) {
		// 类型断言后返回 data 字段
		return (res as { data: T }).data;
	}
	// 无 data 字段时直接返回（类型断言）
	return res as T;
}

// 将后端记录转换为前端 Note 类型
function toNote(row: NoteListItem | NoteRecord): Note {
	// 提取 HTML 内容：如果有 content 字段则使用，否则为空字符串
	const html =
		'content' in row && typeof row.content === 'string' ? row.content : '';
	// 优先取更新时间，其次取创建时间
	const atRaw = row.updatedAt ?? row.createdAt;
	// 转换为毫秒时间戳
	const at = atRaw ? new Date(atRaw).getTime() : Date.now();
	// 返回标准化的 Note 对象
	return {
		// 笔记 ID
		id: row.id,
		// 标题：去除首尾空格，空则显示「无标题笔记」
		title: (row.title ?? '').trim() || '无标题笔记',
		// HTML 内容
		html,
		// 时间戳：确保为有效数字，否则用当前时间
		at: Number.isFinite(at) ? at : Date.now(),
	};
}

// 创建笔记 API 实例的工厂函数
export function createNotesApi(http: HostHttp) {
	// 返回包含各方法的 API 对象
	return {
		// 获取笔记列表：支持分页参数，返回分页结构
		async list(
			// 页码，默认为 1
			pageNo = 1,
			// 每页条数，默认为 NOTES_PAGE_SIZE（10）
			pageSize = NOTES_PAGE_SIZE,
			// 返回分页结构对象
		): Promise<NoteListPage> {
			// 调用 HTTP GET 请求，传入 pageNo 和 pageSize 参数
			const res = await http.get(
				`${BASE}/list?pageNo=${pageNo}&pageSize=${pageSize}`,
			);
			// 解包响应数据，期望包含 list 和 total
			const page = unwrapData<{ list: NoteListItem[]; total: number }>(res);
			// 安全获取 list 数组，非数组则默认为空
			const rows = Array.isArray(page?.list) ? page.list : [];
			// 返回分页结构：包含转换后的列表、总数、当前页、每页条数
			return {
				// 转换为 Note 类型列表（不再前端排序，后端已排好序）
				list: rows.map(toNote),
				// 总记录数：确保为数字，否则用当前列表长度兜底
				total: typeof page?.total === 'number' ? page.total : rows.length,
				// 当前页码
				pageNo,
				// 每页条数
				pageSize,
			};
		},

		// ...（其余方法未改动，省略）
	};
}
```

**变更摘要**：
1. 新增 `NOTES_PAGE_SIZE = 10` 常量作为默认分页大小
2. 新增 `NoteListPage` 分页返回类型（`list`、`total`、`pageNo`、`pageSize`）
3. `list` 方法从 `list(pageSize=100): Promise<Note[]>` 改为 `list(pageNo=1, pageSize=NOTES_PAGE_SIZE): Promise<NoteListPage>`
4. 返回分页结构对象，不再做前端排序（依赖后端排序结果）

---

### 4.2 LearningNotesStore 实现（`store/learningNotes.ts`）

> 本文件为**纯新增**，无改动前版本。以下为完整实现源码及逐行注释。

**改动后** · `apps/remote-plugins/src/store/learningNotes.ts`（当前，全文）

```typescript
// 从富文本编辑器包导入空文档常量，用于新建笔记的初始内容
import { EMPTY_NOTE_DOC } from '@design/RichEditor';
// 导入 MobX 核心：makeAutoObservable 自动创建响应式，runInAction 确保在 action 中修改状态
import { makeAutoObservable, runInAction } from 'mobx';
// 从 API 模块导入工厂函数、类型及常量
import {
	// 创建 API 实例的工厂函数
	createNotesApi,
	// HTTP 客户端类型
	type HostHttp,
	// 笔记类型
	type Note,
	// API 实例类型
	type NotesApi,
	// 分页大小常量
	NOTES_PAGE_SIZE,
} from '@/views/learning-notes/api';

// Toast 提示函数类型定义
type ToastFn = (
	// 提示消息内容
	message: string,
	// 提示类型：成功/错误/信息，可选
	type?: 'success' | 'error' | 'info',
	// 返回 void
) => void;

// 从错误对象中提取错误消息的工具函数
function errMsg(e: unknown): string {
	// 如果是 Error 实例且有 message，直接返回 message
	if (e instanceof Error && e.message) return e.message;
	// 如果是对象且包含 message 属性
	if (e && typeof e === 'object' && 'message' in e) {
		// 提取 message 字段
		const m = (e as { message?: unknown }).message;
		// 如果是字符串且非空，返回该消息
		if (typeof m === 'string' && m.trim()) return m;
	}
	// 兜底返回通用错误提示
	return '请求失败';
}

/**
 * 学习笔记域 store（对齐主站 MobX 单例模式）。
 * HTTP 由页面 bind(http, toast) 注入，列表分页与编辑态集中在此。
 */
// 定义 LearningNotesStore 类
class LearningNotesStore {
	// 私有字段：API 实例，初始为 null，通过 bind 注入
	private api: NotesApi | null = null;
	// 私有字段：Toast 函数，初始为空函数，通过 bind 注入
	private toast: ToastFn = () => {};

	/** 列表（分页累积） */
	// 笔记列表数组，分页加载时累积
	list: Note[] = [];
	// 总记录数，用于判断是否还有更多
	total = 0;
	// 当前已加载到的页码
	pageNo = 1;
	// 每页条数，使用 API 层定义的常量
	pageSize = NOTES_PAGE_SIZE;
	// 首次加载（刷新）的 loading 状态
	loading = false;
	// 加载更多的 loading 状态，与 loading 区分用于不同 UI 展示
	loadingMore = false;

	// 笔记列表侧边栏是否展开
	listOpen = false;
	// 当前预览的笔记，为 null 时显示编辑器
	preview: Note | null = null;
	// 预览详情加载状态（点击列表项加载详情时显示）
	loadingDetail = false;
	// 当前正在编辑的笔记 ID，为 null 表示新建
	editingId: string | null = null;
	// 编辑器种子值，修改后触发编辑器重新挂载（用于切换笔记时重置内容）
	editorSeed = 0;
	// 编辑器初始内容，支持字符串或 EMPTY_NOTE_DOC 空文档对象
	editorInitial: string | typeof EMPTY_NOTE_DOC = EMPTY_NOTE_DOC;
	// 保存中状态
	saving = false;
	// 删除确认对话框是否打开
	confirmOpen = false;
	// 待删除的笔记 ID，配合确认对话框使用
	pendingDeleteId: string | null = null;

	// 构造函数
	constructor() {
		// 使用 makeAutoObservable 自动将所有属性设为 observable，所有方法设为 action
		// autoBind: true 确保方法的 this 始终指向 store 实例，可直接作为回调传递
		makeAutoObservable(this, {}, { autoBind: true });
	}

	// 绑定 HTTP 客户端和 toast 函数（依赖注入）
	bind(http: HostHttp | undefined, toast: ToastFn) {
		// 如果有 http 则创建 API 实例，否则为 null
		this.api = http ? createNotesApi(http) : null;
		// 保存 toast 函数引用
		this.toast = toast;
	}

	// 计算属性：是否还有更多数据可加载
	get hasMore(): boolean {
		// 已加载数量小于总数时表示还有更多
		return this.list.length < this.total;
	}

	// 计算属性：是否有当前活动的笔记（预览中或编辑中）
	get hasActive(): boolean {
		// 预览 ID 优先，其次编辑 ID，只要有一个存在即为 true
		return !!(this.preview?.id ?? this.editingId);
	}

	// 设置列表展开状态
	setListOpen(open: boolean) {
		// 直接赋值，MobX 会追踪变化
		this.listOpen = open;
	}

	// 切换列表展开/收起
	toggleListOpen() {
		// 取反当前状态
		this.listOpen = !this.listOpen;
	}

	// 设置确认对话框打开状态
	setConfirmOpen(open: boolean) {
		// 直接赋值
		this.confirmOpen = open;
	}

	// 设置详情加载状态
	setLoadingDetail(loading: boolean) {
		// 直接赋值
		this.loadingDetail = loading;
	}

	// 通用分页拉取方法
	async fetchPage(page: number, append: boolean): Promise<void> {
		// 如果 API 未初始化（未授权）
		if (!this.api) {
			// 提示错误
			this.toast('未授权 HTTP，无法同步笔记', 'error');
			// 直接返回
			return;
		}
		// 如果是追加模式（加载更多）
		if (append) {
			// 防止重复加载：正在加载中或没有更多时直接返回
			if (this.loading || this.loadingMore || !this.hasMore) return;
			// 设置加载更多状态为 true
			this.loadingMore = true;
			// 如果是替换模式（刷新）
		} else {
			// 设置首次加载状态为 true
			this.loading = true;
		}
		// try 块捕获请求错误
		try {
			// 调用 API 的 list 方法获取分页数据
			const data = await this.api.list(page, this.pageSize);
			// 使用 runInAction 确保状态修改在 action 中进行（MobX 最佳实践）
			runInAction(() => {
				// 更新总数
				this.total = data.total;
				// 更新当前页码
				this.pageNo = page;
				// 如果是追加模式
				if (append) {
					// 创建已存在笔记 ID 的 Set，用于去重
					const seen = new Set(this.list.map((n) => n.id));
					// 合并列表：原列表 + 新列表中未存在的项
					this.list = [
						// 原有列表
						...this.list,
						// 过滤掉已存在的笔记
						...data.list.filter((n) => !seen.has(n.id)),
					];
					// 如果是替换模式
				} else {
					// 直接替换为新列表
					this.list = data.list;
				}
			});
			// 捕获异常
		} catch (e) {
			// 显示错误提示
			this.toast(errMsg(e), 'error');
			// finally 块确保 loading 状态重置
		} finally {
			// 使用 runInAction 包装状态修改
			runInAction(() => {
				// 重置首次加载状态
				this.loading = false;
				// 重置加载更多状态
				this.loadingMore = false;
			});
		}
	}

	// 刷新列表：重新加载第一页
	async refreshList(): Promise<void> {
		// 调用 fetchPage，第 1 页，不追加（替换）
		await this.fetchPage(1, false);
	}

	// 加载更多：加载下一页并追加
	async loadMore(): Promise<void> {
		// 边界检查：没有更多、正在加载中时直接返回
		if (!this.hasMore || this.loading || this.loadingMore) return;
		// 调用 fetchPage，下一页，追加模式
		await this.fetchPage(this.pageNo + 1, true);
	}

	// 新建笔记
	openNew() {
		// 清空预览
		this.preview = null;
		// 清空编辑 ID（表示新建）
		this.editingId = null;
		// 编辑器初始内容设为空文档
		this.editorInitial = EMPTY_NOTE_DOC;
		// 编辑器种子 +1，触发重新挂载
		this.editorSeed += 1;
	}

	// 打开笔记预览
	async openPreview(id: string): Promise<void> {
		// API 未初始化时直接返回
		if (!this.api) return;
		// try 块捕获请求错误
		try {
			// 设置详情加载状态为 true
			this.loadingDetail = true;
			// 调用 API 获取笔记详情
			const note = await this.api.detail(id);
			// 加载完成，关闭 loading（放在 action 前也可，MobX 会追踪）
			this.loadingDetail = false;
			// 使用 runInAction 包装状态修改
			runInAction(() => {
				// 设置预览笔记
				this.preview = note;
			});
			// 捕获异常
		} catch (e) {
			// 显示错误提示
			this.toast(errMsg(e), 'error');
			// 关闭 loading
			this.loadingDetail = false;
		}
	}

	// 打开编辑（传入笔记对象）
	openEdit(note: Note) {
		// 清空预览，切换到编辑器
		this.preview = null;
		// 设置编辑中的笔记 ID
		this.editingId = note.id;
		// 设置编辑器初始内容，为空则用空文档
		this.editorInitial = note.html || EMPTY_NOTE_DOC;
		// 编辑器种子 +1，触发重新挂载
		this.editorSeed += 1;
	}

	// 通过 ID 打开编辑（列表项无正文，需先拉详情）
	async openEditById(id: string): Promise<void> {
		// API 未初始化时直接返回
		if (!this.api) return;
		// try 块捕获请求错误
		try {
			// 先拉取笔记详情
			const note = await this.api.detail(id);
			// 使用 runInAction 包装，调用 openEdit（虽然 openEdit 也是 action，但在 async 中需要包一下）
			runInAction(() => {
				// 调用 openEdit 打开编辑
				this.openEdit(note);
			});
			// 捕获异常
		} catch (e) {
			// 显示错误提示
			this.toast(errMsg(e), 'error');
		}
	}

	/** 由页面从 editor 取出最新内容后调用 */
	// 保存笔记（新建或更新）
	async saveNote(input: {
		// 笔记标题
		title: string;
		// 笔记 HTML 内容
		html: string;
		// 笔记纯文本内容（用于非空校验）
		text: string;
		// 返回 Promise<void>
	}): Promise<void> {
		// 标题为空时提示
		if (!input.title.trim()) {
			// 显示信息提示
			this.toast('请先输入标题', 'info');
			// 直接返回
			return;
		}
		// 内容为空时提示
		if (!input.text.trim()) {
			// 显示信息提示
			this.toast('请先输入内容', 'info');
			// 直接返回
			return;
		}
		// API 未初始化时提示错误
		if (!this.api) {
			// 显示错误提示
			this.toast('未授权 HTTP，无法保存', 'error');
			// 直接返回
			return;
		}
		// 设置保存中状态
		this.saving = true;
		// try 块捕获请求错误
		try {
			// 构造请求 payload
			const payload = {
				// 标题：去除首尾空格，空则用「无标题笔记」
				title: input.title.trim() || '无标题笔记',
				// HTML 内容
				html: input.html,
			};
			// 如果是编辑模式（有 editingId）
			if (this.editingId) {
				// 调用更新接口
				const updated = await this.api.update(this.editingId, payload);
				// 使用 runInAction 包装
				runInAction(() => {
					// 更新编辑 ID（虽然一般不变，但确保与返回一致）
					this.editingId = updated.id;
				});
				// 提示更新成功
				this.toast('已更新笔记', 'success');
				// 如果是新建模式
			} else {
				// 调用保存接口，返回新笔记 ID
				const { id } = await this.api.save(payload);
				// 使用 runInAction 包装
				runInAction(() => {
					// 设置编辑 ID 为新笔记 ID
					this.editingId = id;
				});
				// 提示保存成功
				this.toast('已保存笔记', 'success');
			}
			// 保存成功后刷新列表
			await this.refreshList();
			// 捕获异常
		} catch (e) {
			// 显示错误提示
			this.toast(errMsg(e), 'error');
			// finally 确保 saving 状态重置
		} finally {
			// 使用 runInAction 包装
			runInAction(() => {
				// 重置保存中状态
				this.saving = false;
			});
		}
	}

	// 请求删除（弹出确认框）
	requestDelete(id: string) {
		// 保存待删除的笔记 ID
		this.pendingDeleteId = id;
		// 打开确认对话框
		this.confirmOpen = true;
	}

	// 确认删除
	async confirmDelete(): Promise<void> {
		// 获取待删除 ID（局部变量，防止异步过程中被修改）
		const id = this.pendingDeleteId;
		// API 未初始化或 ID 为空时直接返回
		if (!this.api || !id) return;
		// try 块捕获请求错误
		try {
			// 调用删除接口
			await this.api.remove(id);
			// 使用 runInAction 包装状态修改
			runInAction(() => {
				// 如果删除的是当前预览的笔记，清空预览
				if (this.preview?.id === id) this.preview = null;
				// 如果删除的是当前编辑的笔记
				if (this.editingId === id) {
					// 清空编辑 ID
					this.editingId = null;
					// 重置编辑器初始内容为空文档
					this.editorInitial = EMPTY_NOTE_DOC;
					// 编辑器种子 +1，触发重新挂载
					this.editorSeed += 1;
				}
				// 清空待删除 ID
				this.pendingDeleteId = null;
			});
			// 提示删除成功
			this.toast('已删除', 'success');
			// 刷新列表
			await this.refreshList();
			// 捕获异常
		} catch (e) {
			// 显示错误提示
			this.toast(errMsg(e), 'error');
			// 使用 runInAction 包装
			runInAction(() => {
				// 清空待删除 ID
				this.pendingDeleteId = null;
			});
		}
	}
}

// 导出单例实例
export default new LearningNotesStore();
```

---

### 4.3 RootStore 与 useStore（`store/index.ts`）

> 本文件为**纯新增**，无改动前版本。以下为完整实现源码及逐行注释。

**改动后** · `apps/remote-plugins/src/store/index.ts`（当前，全文）

```typescript
// 从 React 导入 createContext 和 useContext，用于 Context API
import { createContext, useContext } from 'react';
// 导入学习笔记 store 单例
import LearningNotesStore from './learningNotes';

// 根 Store 类，集中管理所有子域 store
class RootStore {
	// 学习笔记模块的 store 实例
	learningNotesStore = LearningNotesStore;
}

// 创建根 store 单例
const store = new RootStore();

// 创建 React Context，默认值为根 store 实例
const Context = createContext(store);

// 自定义 Hook：在组件中获取 store 实例
export default function useStore() {
	// 使用 useContext 从 Context 中获取 store
	return useContext(Context);
}

// 导出 LearningNotesStore 类，方便类型引用或测试
export { LearningNotesStore };
```

---

### 4.4 组件层接入 observer 与 store（`index.tsx`）

以下选取核心改动部分进行对比。

#### 4.4.1 导入与组件定义

**改动前** · `apps/remote-plugins/src/views/learning-notes/index.tsx`（基线，约 L1–L85）

```typescript
// 导入笔记预览组件
import { NotePreview } from '@design/NotePreview';
// 从富文本编辑器包导入按钮、编辑器类型、空文档常量、富文本编辑器组件
import {
	Btn,
	type Editor,
	EMPTY_NOTE_DOC,
	RichEditor,
} from '@design/RichEditor';
// 从 lucide-react 导入图标组件
import {
	FilePenLine,
	NotebookText,
	Save,
	SquarePen,
	Trash2,
} from 'lucide-react';
// 从 React 导入常用 Hooks
import { useCallback, useEffect, useMemo, useState } from 'react';
// 导入确认对话框组件
import Confirm from '@/components/design/Confirm';
// 导入可调整大小面板组件
import {
	ResizableHandle,
	ResizablePanel,
	ResizablePanelGroup,
} from '@/components/ui/resizable';
// 导入滚动区域组件
import { ScrollArea } from '@/components/ui/scroll-area';
// 导入 classnames 工具函数
import { cn } from '@/lib/utils';
// 导入全局样式
import '@/styles.css';
// 从本地 API 模块导入工厂函数和类型
import { createNotesApi, type HostHttp, type Note } from './api';

// HostBridge 传入的 Props 类型定义
type HostBridgeProps = {
	// API 相关配置
	api: {
		// 主题：亮/暗
		theme: 'light' | 'dark';
		// HTTP 客户端实例（可选）
		http?: HostHttp;
		// UI 相关方法（可选）
		ui?: {
			// 显示 Toast 提示
			showToast: (options: {
				// 消息内容
				message: string;
				// 消息类型（可选）
				type?: 'success' | 'error' | 'info';
			}) => void;
		};
	};
	// 插件信息
	plugin: { id: string; version: string; routePath: string };
	// 是否独立运行，独立运行时不会显示笔记列表
	independent?: boolean;
};

// 从错误对象中提取错误消息的工具函数
function errMsg(e: unknown): string {
	// 如果是 Error 实例且有 message，直接返回 message
	if (e instanceof Error && e.message) return e.message;
	// 如果是对象且包含 message 属性
	if (e && typeof e === 'object' && 'message' in e) {
		// 提取 message 字段
		const m = (e as { message?: unknown }).message;
		// 如果是字符串且非空，返回该消息
		if (typeof m === 'string' && m.trim()) return m;
	}
	// 兜底返回通用错误提示
	return '请求失败';
}

// 默认导出的学习笔记应用组件
export default function LearningNotesApp({ api }: HostBridgeProps) {
	// 使用 useMemo 创建 API 实例，http 变化时重新创建
	const notesApi = useMemo(
		// 工厂函数：有 http 则创建实例，否则为 null
		() => (api.http ? createNotesApi(api.http) : null),
		// 依赖项：api.http
		[api.http],
	);

	// 草稿状态：存储编辑器中的标题、HTML、文本
	const [draft, setDraft] = useState({ html: '', text: '', title: '' });
	// 列表侧边栏是否展开，默认为 true
	const [listOpen, setListOpen] = useState(true);
	// 当前预览的笔记，为 null 时显示编辑器
	const [preview, setPreview] = useState<Note | null>(null);
	// 笔记列表数组
	const [notes, setNotes] = useState<Note[]>([]);
	// 当前正在编辑的笔记 ID，为 null 表示新建
	const [editingId, setEditingId] = useState<string | null>(null);
	// 编辑器种子值，修改后触发编辑器重新挂载
	const [editorSeed, setEditorSeed] = useState(0);
	// 编辑器初始内容
	const [editorInitial, setEditorInitial] = useState<
		string | typeof EMPTY_NOTE_DOC
	>(EMPTY_NOTE_DOC);
	// 列表加载中状态
	const [loading, setLoading] = useState(false);
	// 保存中状态
	const [saving, setSaving] = useState(false);
	// 删除确认对话框是否打开
	const [confirmOpen, setConfirmOpen] = useState(false);
	// 待删除的笔记 ID
	const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);

	// ...（其余方法与 JSX 省略）
}
```

**改动后** · `apps/remote-plugins/src/views/learning-notes/index.tsx`（当前，约 L1–L80）

```typescript
// 导入笔记预览组件
import { NotePreview } from '@design/NotePreview';
// 从富文本编辑器包导入按钮、编辑器类型、获取标题文本函数、富文本编辑器组件
import {
	Btn,
	type Editor,
	getDocTitleText,
	RichEditor,
} from '@design/RichEditor';
// 导入加载中组件
import Loading from '@design/Loading';
// 从 lucide-react 导入图标组件
import {
	ChevronDown,
	ChevronUp,
	FilePenLine,
	LocateFixed,
	NotebookText,
	Save,
	SquarePen,
	Trash2,
} from 'lucide-react';
// 从 mobx-react 导入 observer，用于让组件响应 store 变化
import { observer } from 'mobx-react';
// 从 React 导入常用 Hooks
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
// 导入确认对话框组件
import Confirm from '@/components/design/Confirm';
// 导入可调整大小面板组件
import {
	ResizableHandle,
	ResizablePanel,
	ResizablePanelGroup,
} from '@/components/ui/resizable';
// 导入滚动区域组件
import { ScrollArea } from '@/components/ui/scroll-area';
// 导入 classnames 工具函数
import { cn } from '@/lib/utils';
// 导入自定义 useStore Hook
import useStore from '@/store';
// 从本地 API 模块导入 HTTP 类型（仅作类型引用）
import type { HostHttp } from './api';
// 导入全局样式
import '@/styles.css';

// 滚动到边缘的检测阈值（像素）
const SCROLL_EDGE_PX = 16;

/** 笔记列表滚动：同一按钮循环 底 → 顶 → 当前（无选中时底 → 顶） */
// 滚动模式类型定义
type NoteScrollMode = 'bottom' | 'top' | 'current';

// HostBridge 传入的 Props 类型定义
type HostBridgeProps = {
	// API 相关配置
	api: {
		// 主题：亮/暗
		theme: 'light' | 'dark';
		// HTTP 客户端实例（可选）
		http?: HostHttp;
		// UI 相关方法（可选）
		ui?: {
			// 显示 Toast 提示
			showToast: (options: {
				// 消息内容
				message: string;
				// 消息类型（可选）
				type?: 'success' | 'error' | 'info';
			}) => void;
		};
	};
	// 插件信息
	plugin: { id: string; version: string; routePath: string };
	// 是否独立运行，独立运行时不会显示笔记列表
	independent?: boolean;
};

// 学习笔记应用组件（内部定义，最后用 observer 包装后导出）
function LearningNotesApp({ api }: HostBridgeProps) {
	// 从 Context 中获取 store，并重命名为 store 简化使用
	const { learningNotesStore: store } = useStore();

	// 编辑器实例引用（用于保存时获取最新内容）
	const editorRef = useRef<Editor | null>(null);
	// 保存中状态的 ref（用于键盘快捷键判断，避免闭包陷阱）
	const savingRef = useRef(false);
	// 预览状态的 ref（用于键盘快捷键判断）
	const previewRef = useRef(store.preview);
	// 同步 saving 状态到 ref（每次渲染更新）
	savingRef.current = store.saving;
	// 同步 preview 状态到 ref（每次渲染更新）
	previewRef.current = store.preview;

	// ScrollArea viewport 引用：用于程序化滚动（纯 UI，不进 store）
	const scrollViewportRef = useRef<HTMLDivElement>(null);
	// 当前活动项的 DOM 引用：用于滚动到选中位置
	const activeItemRef = useRef<HTMLDivElement>(null);
	// 滚动模式状态（底/顶/当前）
	const [scrollMode, setScrollMode] = useState<NoteScrollMode>('bottom');
	// 当前处于哪个边缘（顶/底/null）
	const [scrollEdge, setScrollEdge] = useState<'top' | 'bottom' | null>(null);

	// Toast 函数封装
	const toast = useCallback(
		// 接收消息和类型，调用宿主的 showToast
		(message: string, type: 'success' | 'error' | 'info' = 'info') => {
			api.ui?.showToast({ message, type });
		},
		// 依赖项：api.ui
		[api.ui],
	);

	// 组件挂载时绑定依赖并刷新列表
	useEffect(() => {
		// 注入 HTTP 和 toast 到 store
		store.bind(api.http, toast);
		// 刷新列表（第一页）
		void store.refreshList();
		// 依赖项：api.http、store、toast
	}, [api.http, store, toast]);

	// ...（其余方法与 JSX 省略）
}
```

**变更摘要**：
1. 新增 `observer` 导入，组件改为 `function LearningNotesApp` + `export default observer(LearningNotesApp)`
2. 新增 `useStore` 导入，替换原有的 `createNotesApi` 导入（改为仅类型引用 `HostHttp`）
3. 移除 `EMPTY_NOTE_DOC` 导入（store 内部处理），新增 `getDocTitleText`、`Loading` 导入
4. 移除十余个 `useState`（`draft`、`notes`、`preview`、`editingId` 等），状态全部从 `store` 读取
5. 新增 `editorRef`、`savingRef`、`previewRef` 等 ref 用于编辑器和键盘快捷键
6. 新增滚动相关的纯 UI 状态（`scrollMode`、`scrollEdge` 等，仍用 useState，因不属业务逻辑）
7. 在 `useEffect` 中调用 `store.bind()` 注入依赖，替代原有的 `useMemo` 创建 API 实例

---

#### 4.4.2 列表区域与分页加载 UI

**改动前** · `apps/remote-plugins/src/views/learning-notes/index.tsx`（基线，约 L200–L280）

```tsx
// 列表侧边栏面板
<ResizablePanel
	// 面板 ID
	id="learning-notes-list"
	// 默认宽度占比 35%
	defaultSize={35}
	// 最小宽度为 0
	minSize={0}
	// 样式类名
	className="min-h-0 min-w-0"
>
	// 侧边栏容器
	<aside className="border-r mb-3 border-theme/10 flex h-full min-h-0 min-w-0 flex-col overflow-hidden">
		// 顶部标题栏
		<div className="flex h-10 shrink-0 items-center justify-between border-b border-theme/10 pl-3 pr-1.5 font-medium tracking-wide">
			// 标题文字，加载中显示省略号
			<span className="text-textcolor/85">
				笔记列表{loading ? '…' : ''}
			</span>
			// 新建笔记按钮
			<Btn title="新建笔记" onClick={openNew}>
				<FilePenLine size={15} />
			</Btn>
		</div>
		// 滚动区域
		<ScrollArea className="min-h-0 flex-1 p-3">
			// 列表容器
			<div className="flex flex-col gap-3">
				// 空状态提示
				{notes.length === 0 && !loading ? (
					<p className="text-textcolor/45 px-1 py-6 text-center text-xs">
						暂无笔记，保存一条试试
					</p>
				) : null}
				// 遍历渲染笔记列表项
				{notes.map((n) => {
					// 预览优先：避免 preview 与 editingId 同时高亮两条
					const active = (preview?.id ?? editingId) === n.id;
					// 返回列表项 JSX
					return (
						// 列表项容器
						<div
							// key 用笔记 ID
							key={n.id}
							// 动态样式：hover 效果 + 激活态高亮
							className={cn(
								'hover:bg-theme/10 bg-theme/5 group relative w-full rounded-md px-3 py-2.5 text-left transition-colors',
								active && 'bg-theme/15',
							)}
						>
							// ...（列表项内容省略）
						</div>
					);
				})}
			</div>
		</ScrollArea>
	</aside>
</ResizablePanel>
```

**改动后** · `apps/remote-plugins/src/views/learning-notes/index.tsx`（当前，约 L238–L344）

```tsx
// 列表侧边栏面板
<ResizablePanel
	// 面板 ID
	id="learning-notes-list"
	// 默认宽度占比 35%
	defaultSize={35}
	// 最小宽度为 0
	minSize={0}
	// 样式类名
	className="min-h-0 min-w-0"
>
	// 侧边栏容器
	<aside className="border-r mb-3 border-theme/10 flex h-full min-h-0 min-w-0 flex-col overflow-hidden">
		// 顶部标题栏
		<div className="flex h-10 shrink-0 items-center justify-between border-b border-theme/10 pl-3 pr-1.5 font-medium tracking-wide">
			// 标题 + 计数
			<div className="text-textcolor/85">
				// 主标题
				笔记列表
				// 已加载/总数统计
				<span className="ml-3 text-xs text-textcolor/60">
					已加载 {store.list.length} 条/共 {store.total} 条
				</span>
			</div>
			// 滚动定位按钮（底/顶/当前，循环切换）
			<Btn title={scrollTitle} onClick={onScrollFabClick}>
				// 根据 displayMode 显示不同图标
				{displayMode === 'bottom' ? (
					// 向下箭头：滚动到底部
					<ChevronDown size={18} />
				) : displayMode === 'top' ? (
					// 向上箭头：滚动到顶部
					<ChevronUp size={18} />
				) : (
					// 定位图标：滚动到当前选中
					<LocateFixed size={15} />
				)}
			</Btn>
		</div>
		// 滚动区域，绑定 viewport ref 用于检测滚动位置
		<ScrollArea
			// viewport DOM 引用
			ref={scrollViewportRef}
			// 样式类名
			className="min-h-0 flex-1 p-3"
		>
			// 首次加载中：显示加载动画
			{store.loading ? (
				<div className="flex flex-1 flex-col items-center justify-center py-6 text-center text-sm text-textcolor/60">
					<Loading />
				</div>
			) : (
				// 列表容器
				<div className="flex flex-col gap-3">
					// 空状态提示
					{store.list.length === 0 && !store.loading ? (
						<p className="text-textcolor/45 px-1 py-6 text-center text-xs">
							暂无笔记，保存一条试试
						</p>
					) : null}
					// 遍历渲染笔记列表项
					{store.list.map((n) => {
						// 预览优先：避免 preview 与 editingId 同时高亮两条
						const active =
							(store.preview?.id ?? store.editingId) === n.id;
						// 返回列表项 JSX
						return (
							// 列表项容器
							<div
								// key 用笔记 ID
								key={n.id}
								// 活动项绑定 ref，用于滚动到当前选中
								ref={active ? activeItemRef : undefined}
								// 动态样式：hover 效果 + 激活态高亮
								className={cn(
									'hover:bg-theme/10 bg-theme/5 group relative w-full rounded-md px-3 py-2.5 text-left transition-colors',
									active && 'bg-theme/15',
								)}
							>
								// ...（列表项内容省略）
							</div>
						);
					})}
					// 加载更多中：显示「加载中…」提示
					{store.loadingMore ? (
						<p className="text-textcolor/45 py-2 text-center text-xs">
							加载中…
						</p>
					) : null}
					// 已加载完且非加载中且有数据且无更多：显示「没有更多了」提示
					{!store.loading &&
					!store.loadingMore &&
					store.list.length > 0 &&
					!store.hasMore ? (
						<p className="text-textcolor/35 py-2 text-center text-xs">
							没有更多了
						</p>
					) : null}
				</div>
			)}
		</ScrollArea>
	</aside>
</ResizablePanel>
```

**变更摘要**：
1. 顶部标题栏新增「已加载 X 条/共 Y 条」计数显示
2. 顶部标题栏新增滚动定位按钮（底→顶→当前，循环切换）
3. 首次加载时显示居中的 Loading 动画（替代原有的文字省略号）
4. 列表底部新增「加载中…」提示（`loadingMore` 状态）
5. 列表底部新增「没有更多了」提示（`!hasMore` 状态）
6. 活动列表项绑定 `activeItemRef`，用于「滚动到当前选中」功能
7. 所有状态从 `store.xxx` 读取，替代原有的本地 `useState`

---

#### 4.4.3 预览区域 loadingDetail 状态

**改动前** · `apps/remote-plugins/src/views/learning-notes/index.tsx`（基线，约 L300–L340）

```tsx
// 如果有预览笔记，显示预览组件
{preview ? (
	// 笔记预览组件
	<NotePreview
		// 预览标题
		title={preview.title}
		// 预览 HTML 内容
		html={preview.html}
		// 头部额外操作按钮
		headerExtra={
			<>
				// 新建笔记按钮
				<Btn title="新建笔记" onClick={openNew}>
					<FilePenLine size={15} />
				</Btn>
				// 编辑按钮
				<Btn title="编辑" onClick={() => openEdit(preview)}>
					<SquarePen size={15} />
				</Btn>
				// 删除按钮
				<Btn title="删除" onClick={() => onDelete(preview.id)}>
					<Trash2 size={15} />
				</Btn>
				// 列表切换按钮
				{listToggleBtn()}
			</>
		}
	/>
) : null}
```

**改动后** · `apps/remote-plugins/src/views/learning-notes/index.tsx`（当前，约 L377–L413）

```tsx
// 如果有预览笔记
{store.preview ? (
	// 如果正在加载详情
	store.loadingDetail ? (
		// 显示居中加载动画
		<div className="flex flex-1 flex-col items-center justify-center py-6 text-center text-sm text-textcolor/60">
			<Loading />
		</div>
	) : (
		// 加载完成后显示笔记预览组件
		<NotePreview
			// 预览标题
			title={store.preview.title}
			// 预览 HTML 内容
			html={store.preview.html}
			// 头部额外操作按钮
			headerExtra={
				<>
					// 新建笔记按钮
					<Btn title="新建笔记" onClick={() => store.openNew()}>
						<FilePenLine size={15} />
					</Btn>
					// 编辑按钮
					<Btn
						title="编辑"
						onClick={() => {
							// 有 preview 时才调用 openEdit
							if (store.preview) store.openEdit(store.preview);
						}}
					>
						<SquarePen size={15} />
					</Btn>
					// 删除按钮
					<Btn
						title="删除"
						onClick={() => {
							// 有 preview 时才调用 requestDelete
							if (store.preview)
								store.requestDelete(store.preview.id);
						}}
					>
						<Trash2 size={15} />
					</Btn>
					// 列表切换按钮
					{listToggleBtn()}
				</>
			}
		/>
	)
) : null}
```

**变更摘要**：
1. 新增 `loadingDetail` 状态判断：点击列表项加载详情时显示 Loading 动画
2. 所有操作从 `store.xxx()` 调用，替代原有的本地函数
3. 编辑/删除按钮增加 `store.preview` 存在性检查（TypeScript 类型收窄）

---

#### 4.4.4 组件导出方式

**改动前** · `apps/remote-plugins/src/views/learning-notes/index.tsx`（基线，约 L370–L378）

```tsx
// 组件结束
}

// 默认导出组件函数
export default LearningNotesApp;

// 激活生命周期钩子
export async function activate() {
	// 列表在组件 mount 时拉取
}

// 停用生命周期钩子
export async function deactivate() {
	// ponytail: 无全局副作用
}
```

**改动后** · `apps/remote-plugins/src/views/learning-notes/index.tsx`（当前，约 L419–L429）

```tsx
// 组件结束
}

// 使用 observer 包装组件后导出，使组件能响应 MobX 状态变化
export default observer(LearningNotesApp);

// 激活生命周期钩子
export async function activate() {
	// 列表在组件 mount 时拉取
}

// 停用生命周期钩子
export async function deactivate() {
	// ponytail: 无全局副作用
}
```

**变更摘要**：
- 组件从直接导出改为 `observer(LearningNotesApp)` 包装后导出，使组件成为 MobX 响应式组件，当 store 中的可观察属性变化时自动重新渲染。

## 5. 兼容性与影响

### 5.1 行为变化

| 维度 | 重构前 | 重构后 | 兼容性 |
| ---- | ------ | ------ | ------ |
| 列表加载方式 | 一次性拉取 100 条 | 分页加载，默认每页 10 条 | 兼容：用户体验更平滑 |
| 列表排序 | 前端排序（`sort((a, b) => b.at - a.at)`） | 依赖后端排序 | 需确保后端按时间倒序返回 |
| 状态管理 | 组件内 useState | MobX Store 集中管理 | 兼容：对外行为一致 |
| 组件导出 | `export default function` | `export default observer(...)` | 兼容：使用方式不变 |

### 5.2 新增功能

- **分页加载**：滚动到底部自动加载下一页
- **加载状态细分**：`loading`（首次加载）、`loadingMore`（加载更多）、`loadingDetail`（预览详情）三种 loading 态分别展示
- **列表计数**：顶部显示「已加载 X 条/共 Y 条」
- **滚动定位**：支持滚动到底部/顶部/当前选中（循环切换）
- **底部提示**：加载中、没有更多了等状态提示

### 5.3 风险与回归建议

**风险点**：

1. **后端分页接口依赖**：前端不再做排序，依赖后端返回正确的排序结果
2. **去重逻辑**：分页追加时基于 ID 去重，若后端分页有数据变化可能出现重复或遗漏
3. **observer 性能**：整个根组件被 observer 包装，任何 store 变化都会触发重渲染；当前规模下无性能问题，未来可考虑拆分细粒度 observer

**回归测试清单**：

- [ ] 新建笔记 → 保存 → 列表刷新正常
- [ ] 编辑笔记 → 保存 → 列表更新正常
- [ ] 删除笔记 → 确认 → 列表刷新 + 预览/编辑器状态正确
- [ ] 滚动到底部 → 自动加载下一页
- [ ] 列表顶部显示正确的已加载/总数计数
- [ ] 点击列表项 → 预览态 loading → 详情展示
- [ ] ⌘S 快捷键保存正常
- [ ] 列表展开/收起切换正常
- [ ] 空状态显示正常
- [ ] 「没有更多了」提示在全部加载完后出现

## 6. 相关源码路径

| 说明 | 路径 |
| ---- | ---- |
| API 层（分页改造） | `apps/remote-plugins/src/views/learning-notes/api.ts` |
| 组件层（observer + store 接入） | `apps/remote-plugins/src/views/learning-notes/index.tsx` |
| 学习笔记 Store | `apps/remote-plugins/src/store/learningNotes.ts` |
| 根 Store 与 useStore Hook | `apps/remote-plugins/src/store/index.ts` |

---

（若与仓库最新源码不一致，以源码为准）
