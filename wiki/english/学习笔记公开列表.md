# 学习笔记公开可见与列表卡片重构

## 1. 背景与目标

此前「英语学习 · 学习笔记」仅自己可见，列表和详情没有作者信息，也无法让同学之间相互查阅。本次改动把笔记扩展为「本人笔记 + 他人公开笔记」的可见范围，并对列表卡片、预览工具栏、刷新/加载状态、富文本按钮 hover 效果做了一轮集中打磨。

解决的核心问题：

- 同一账号体系下，想把一条学习心得分享给同学或在多个设备间互看时，只能手动导出 Word。
- 笔记列表只显示标题与更新时间，当列表里混入他人公开笔记时无法区分作者与可见性。
- 列表加载逻辑只区分「加载空列表」和「加载更多」两种状态，没有「刷新当前列表」的中间态，导致保存后体验不够连贯。
- 富文本工具栏按钮 hover 时仅底色变化，与主站知识库 header 中「Lucide 图标描边画线」的动效不一致。

## 2. 改动范围

- `apps/backend/src/services/learning-notes/english-learning-note.entity.ts`（Entity 新增 `isPublic` 字段与索引）
- `apps/backend/src/services/learning-notes/dto/update-note-visibility.dto.ts`（新增 DTO）
- `apps/backend/src/services/learning-notes/learning-notes.module.ts`（注入 `User` 仓储）
- `apps/backend/src/services/learning-notes/learning-notes.controller.ts`（`PUT /visibility/:id`、列表/详情注释）
- `apps/backend/src/services/learning-notes/learning-notes.service.ts`（`findOne`、`findPage` 重写，新增 `setVisibility`、`authorMap`、`toListItem`，`save` 默认 `isPublic=false`）
- `apps/remote-plugins/src/i18n/locales/en-US.ts`、`zh-CN.ts`（新增公开/公开确认/Toast 等词条）
- `apps/remote-plugins/src/views/learning-notes/api.ts`（类型扩充 + `setVisibility` API）
- `apps/remote-plugins/src/store/learningNotes.ts`（`refreshing` 状态、`setListOpen`、`requestVisibility`/`confirmVisibility`、`openPreview` 保留 author/isPublic/isOwned、关闭列表丢弃迟到回包）
- `apps/remote-plugins/src/views/learning-notes/components/NotesListPanel.tsx`（卡片网格、公开徽章、作者、刷新按钮、hover 操作：公开/编辑/删除 只对 owner 可见）
- `apps/remote-plugins/src/views/learning-notes/index.tsx`（`previewOwned` 条件按钮、`visibilityConfirmOpen` 二次确认弹窗、分栏 `minSize=0`、去掉初始化 `refreshList`）
- `apps/remote-plugins/src/components/design/RichEditor/toolbar/FormatBubble.tsx`、`Toolbar.tsx`（`lucide-stroke-draw-hover` 类名、`[&_svg]:overflow-visible`）
- `apps/remote-plugins/src/styles.css`（新增 `lucide-stroke-draw` 关键帧与 hover 选择器）
- `apps/frontend/src/views/ebook/utils/epub/reader/epubReaderSettings.ts`、`EbookReadSplitLayout.tsx`、`EbookAssistant.tsx`、`EpubQuoteActionBar.tsx`、`Monaco/index.tsx`（边框 token 与 `ResizablePanel.minSize=0` 的同步清理，属于顺带维护，避免分栏残留最小宽度限制）

数据库迁移：
- `apps/backend/src/migrations/1785463755179-learning-notes-public.ts`
- `apps/backend/src/migrations/1785463760601-learning-notes-public.ts`

## 3. 实现思路

### 3.1 可见性模型与默认值

- 新增 `is_public BOOLEAN NOT NULL DEFAULT false`，通过 `@Index('IDX_eln_public', ['isPublic'])` 给公开过滤加索引。
- 新建笔记默认 `isPublic=false`，保持对旧数据、旧行为的完全兼容；历史数据在迁移里由 `DEFAULT false` 兜底。
- 公开与否只由作者本人切换：`requireOwned` 先校验归属，再改值；公开页和列表的读路径不暴露任何「直接设为公开」的旁路。

### 3.2 读路径：本人 + 公开

- `findOne`：先按 `(id, userId)` 查本人笔记；若命中直接返回并标记 `isOwned=true`。未命中再按 `(id, isPublic=true)` 查公开笔记；否则 `NotFoundException`。
- `findPage`：改为 QueryBuilder，`WHERE (n.userId = :userId OR n.isPublic = true)`，支持标题 `LIKE` 过滤并与分页排序组合。
- 列表 DTO 统一走 `toListItem`：把 `isOwned`、`author` 一并返回，前端卡片据此决定是否显示操作按钮与公开徽章的配色。

### 3.3 作者信息加载

- 新建私有 `authorMap(userIds)`：`In` 查询用户表，`Map<id, username>`；不存在的用户回退为 `String(userId)`，保证任何情况下都能渲染。
- 在 `findOne`、`findPage`、`setVisibility` 三处聚合调用，一次请求换取整页作者信息，避免 N+1。

### 3.4 前端状态机与 UI 适配

- Store 新增 `refreshing` 状态与 `clearList`、`setListOpen`：
  - 打开列表 → `refreshList()` 拉第一页；
  - 关闭列表 → 清空列表并在回包里判 `listOpen` 丢弃迟到响应，避免清空后被回包写回。
- 列表卡片改用 CSS Grid `grid-cols-[repeat(auto-fill,minmax(min(100%,15rem),1fr))]`，@container 查询下自动多列；作者、公开徽章仅在有数据时显示。
- 预览页「编辑/删除/导出」按钮仅对 owner 可见，并新增「公开/取消公开」确认弹窗，文案按 `isPublic` 分支渲染。
- `ResizablePanel.minSize` 从 `30/50` 调整为 `0`，让侧栏可完全收起，同时给容器加 `overflow-hidden` 避免残留阴影。

### 3.5 富文本按钮 hover 描边

- 在 `Toolbar.tsx`、`FormatBubble.tsx` 按钮类名上追加 `lucide-stroke-draw-hover` 与 `[&_svg]:overflow-visible`（让 SVG 路径超出裁剪区域）。
- `styles.css` 新增 `@keyframes lucide-stroke-draw` 与 `@media (prefers-reduced-motion: no-preference)` 下的 hover 选择器，将所有 Lucide 基本图形元素在 hover 时以 `stroke-dasharray` 画 0.5s 描边。

### 3.6 兼容性与开关

- 旧表无 `is_public` 列时，迁移脚本会补齐默认值；新代码 `@Column({ default: false })` 也能在新建记录时兜底。
- 列表/详情返回里的 `author`、`isOwned`、`isPublic` 对旧客户端是新增字段，前端用 `??` / `!== false` 做了缺省兜底（默认视为本人 + 空作者）。
- `ResizablePanel.minSize=0` 只是前端布局自由度提高，不改变任何业务行为。

### 3.7 为何不用备选方案

- **用单独的「分享记录表」代替 `isPublic`**：公开分享的粒度就是整条笔记，不需要分享对象（链接/权限/过期时间）这一套更复杂的模型，`isPublic` 已经足够且查询成本最低。
- **前端先按 `isOwned` 过滤再请求列表**：会失去他人公开笔记，也无法分页展示；服务端用 `QueryBuilder` 的 OR 过滤一次解决。
- **在前端写一个「仅渲染作者」的映射**：`authorMap` 在服务端做聚合查询更节省网络往返，也不会把用户名列表暴露给前端。

## 4. 关键代码对比与注释

### 4.1 `EnglishLearningNote` 实体（`apps/backend/src/services/learning-notes/english-learning-note.entity.ts`）

**对比范围**：整个实体（含 `@Index` 与新列）。

**改动前** · `apps/backend/src/services/learning-notes/english-learning-note.entity.ts`（基线，约 L10–L30）

```typescript
// 实体装饰器：映射到 english_learning_note 表
@Entity({ name: 'english_learning_note' })
// 既有索引：按 userId + 更新时间倒序拉自己的笔记
@Index('IDX_eln_user_updated', ['userId', 'updatedAt'])
export class EnglishLearningNote {
	// 主键 UUID
	@PrimaryGeneratedColumn('uuid')
	id!: string;

	// 作者（这里仍存 userId，展示时再通过用户表映射成用户名）
	@Column({ name: 'user_id', type: 'int' })
	userId!: number;

	// 可空标题；trim 后为空时写 NULL
	@Column({ type: 'varchar', length: 200, nullable: true })
	title!: string | null;

	// TipTap 富文本 HTML；longtext 避免超长正文截断
	@Column({ type: 'longtext' })
	content!: string;

	// 自动写入的创建时间
	@CreateDateColumn({ name: 'created_at', type: 'timestamp' })
	createdAt!: Date;

	// 自动写入的更新时间
	@UpdateDateColumn({ name: 'updated_at', type: 'timestamp' })
	updatedAt!: Date;
}
```

**改动后** · `apps/backend/src/services/learning-notes/english-learning-note.entity.ts`（当前，约 L10–L36）

```typescript
// 实体装饰器：映射到 english_learning_note 表
@Entity({ name: 'english_learning_note' })
// 既有索引：按 userId + 更新时间倒序拉自己的笔记
@Index('IDX_eln_user_updated', ['userId', 'updatedAt'])
// 新增公开索引：加速 WHERE isPublic = true 的公开列表查询
@Index('IDX_eln_public', ['isPublic'])
export class EnglishLearningNote {
	// 主键 UUID
	@PrimaryGeneratedColumn('uuid')
	id!: string;

	// 作者 userId
	@Column({ name: 'user_id', type: 'int' })
	userId!: number;

	// 可空标题
	@Column({ type: 'varchar', length: 200, nullable: true })
	title!: string | null;

	// TipTap HTML 正文
	@Column({ type: 'longtext' })
	content!: string;

	// 新增：是否公开；默认 false，保证旧数据/新数据落库一致
	@Column({ name: 'is_public', type: 'boolean', default: false })
	isPublic!: boolean;

	// 自动写入的创建时间
	@CreateDateColumn({ name: 'created_at', type: 'timestamp' })
	createdAt!: Date;

	// 自动写入的更新时间
	@UpdateDateColumn({ name: 'updated_at', type: 'timestamp' })
	updatedAt!: Date;
}
```

**变更摘要**：新增 `isPublic` 布尔列 + `IDX_eln_public` 索引，为公开列表查询提供加速路径。

---

### 4.2 `LearningNotesController.setVisibility`（`apps/backend/src/services/learning-notes/learning-notes.controller.ts`）

**对比范围**：新增的 `setVisibility` 路由与 `UpdateNoteVisibilityDto` 接入。

**改动前** · `apps/backend/src/services/learning-notes/learning-notes.controller.ts`（基线，约 L20–L87）

```typescript
// 基线路由：不含 PUT /visibility/:id
@Get('detail/:id')
async detail(@Req() req: AuthedRequest, @Param('id', ParseUUIDPipe) id: string) {
	// 直接走 findOne（旧版只支持本人笔记）
	return this.notesService.findOne(this.userId(req), id);
}

@Put('update/:id')
async update(/* ... */) {
	return this.notesService.update(this.userId(req), { ...dto, id });
}

@Delete('delete/:id')
async remove(/* ... */) {
	await this.notesService.remove(this.userId(req), id);
	return { id };
}
```

**改动后** · `apps/backend/src/services/learning-notes/learning-notes.controller.ts`（当前，约 L21–L106）

```typescript
// 新增 DTO 引入：公开/取消公开只需一个布尔字段
import { UpdateNoteVisibilityDto } from './dto/update-note-visibility.dto';

// list 路由注释更新：明确「本人 + 他人公开笔记」可见范围
@Get('list')
async list(@Req() req: AuthedRequest, @Query() query: QueryLearningNoteDto) {
	// 仍然走 findPage，底层 SQL 已改为 OR 过滤
	return this.notesService.findPage(this.userId(req), query);
}

// 新增路由：所有者切换公开可见性
@Put('visibility/:id')
async setVisibility(
	// 认证请求，从中取 userId 做权限校验
	@Req() req: AuthedRequest,
	// 路径参数：笔记 UUID
	@Param('id', ParseUUIDPipe) id: string,
	// 请求体：仅含 isPublic 布尔
	@Body() dto: UpdateNoteVisibilityDto,
) {
	// 委托给 service；内部会校验归属并返回最新列表项
	return this.notesService.setVisibility(this.userId(req), id, dto);
}

// detail 路由保持旧签名不变
@Get('detail/:id')
async detail(@Req() req: AuthedRequest, @Param('id', ParseUUIDPipe) id: string) {
	return this.notesService.findOne(this.userId(req), id);
}
```

**变更摘要**：新增 `PUT /english-learning/notes/visibility/:id`，通过 `UpdateNoteVisibilityDto` 接收 `{isPublic}`，并把列表可见范围的变化体现在注释上。

---

### 4.3 `LearningNotesService.findPage`（`apps/backend/src/services/learning-notes/learning-notes.service.ts`）

**对比范围**：`findPage` 方法整体，含 `authorMap`、`toListItem` 新辅助方法。

**改动前** · `apps/backend/src/services/learning-notes/learning-notes.service.ts`（基线，约 L71–L99）

```typescript
// 旧版分页：只按 userId 过滤
async findPage(userId: number, query: QueryLearningNoteDto) {
	// 页码与分页大小
	const pageNo = query.pageNo ?? 1;
	const pageSize = query.pageSize ?? 20;
	const take = Math.min(pageSize, 100);
	const skip = (pageNo - 1) * take;
	const title = query.title?.trim();

	// 仅按 userId 过滤；若有标题则加 LIKE
	const where: Record<string, unknown> = { userId };
	if (title) where.title = Like(`%${title}%`);

	// 用 findAndCount 一次性拿到列表与总数
	const [list, total] = await this.noteRepo.findAndCount({
		select: { id: true, title: true, userId: true, createdAt: true, updatedAt: true },
		where,
		order: { updatedAt: 'DESC' },
		take,
		skip,
	});
	return { list, total };
}
```

**改动后** · `apps/backend/src/services/learning-notes/learning-notes.service.ts`（当前，约 L102–L140）

```typescript
// 新版分页：本人笔记 + 他人公开笔记
async findPage(
	// 当前登录用户 userId，用于判定 isOwned 与过滤
	userId: number,
	// 分页与关键字 DTO
	query: QueryLearningNoteDto,
): Promise<{ list: LearningNoteListItem[]; total: number }> {
	// 页码与分页大小
	const pageNo = query.pageNo ?? 1;
	const pageSize = query.pageSize ?? 20;
	// 防滥用，单页最多 100
	const take = Math.min(pageSize, 100);
	const skip = (pageNo - 1) * take;
	// 标题关键字去空白
	const title = query.title?.trim();

	// 用 QueryBuilder 构造 OR 条件 + 显式 select
	const qb = this.noteRepo
		.createQueryBuilder('n')
		// 仅选择列表所需的字段，避免拉取 content（longtext）
		.select([
			'n.id',
			'n.title',
			'n.userId',
			'n.isPublic',
			'n.createdAt',
			'n.updatedAt',
		])
		// 公开 OR 本人
		.where('(n.userId = :userId OR n.isPublic = true)', { userId })
		// 按更新时间倒序
		.orderBy('n.updatedAt', 'DESC')
		.take(take)
		.skip(skip);

	// 标题关键字可选
	if (title) {
		qb.andWhere('n.title LIKE :title', { title: `%${title}%` });
	}

	// 一次性拿到行与总数
	const [rows, total] = await qb.getManyAndCount();
	// 聚合一次查作者，避免 N+1
	const authors = await this.authorMap(rows.map((r) => r.userId));
	return {
		// 行级映射为 LearningNoteListItem，补齐 isOwned 与 author
		list: rows.map((row) =>
			this.toListItem(row, userId, authors.get(row.userId)),
		),
		total,
	};
}
```

**变更摘要**：把 `findAndCount` 改为 QueryBuilder，SQL 过滤从单 userId 扩展为 `(userId = ? OR isPublic = true)`，并通过 `authorMap` 一次聚合作者信息，再由 `toListItem` 统一输出。

---

### 4.4 `LearningNotesService.findOne`（`apps/backend/src/services/learning-notes/learning-notes.service.ts`）

**对比范围**：`findOne` 方法整体（权限与作者信息）。

**改动前** · `apps/backend/src/services/learning-notes/learning-notes.service.ts`（基线，约 L57–L70）

```typescript
// 旧版：只允许本人读自己的笔记
async findOne(userId: number, id: string): Promise<EnglishLearningNote> {
	// requireOwned 找不到直接 404
	return this.requireOwned(userId, id);
}
```

**改动后** · `apps/backend/src/services/learning-notes/learning-notes.service.ts`（当前，约 L78–L100）

```typescript
// 新版：本人或公开笔记可读
async findOne(
	// 当前登录用户 userId
	userId: number,
	// 笔记 UUID
	id: string,
): Promise<EnglishLearningNote & { isOwned: boolean; author: string }> {
	// 第一步：按本人 + id 查
	const owned = await this.noteRepo.findOne({ where: { id, userId } });
	if (owned) {
		// 命中本人：补齐作者名，标记 isOwned=true
		const authors = await this.authorMap([owned.userId]);
		return Object.assign(owned, {
			isOwned: true,
			// 找不到用户时回退为 userId 字符串
			author: authors.get(owned.userId) ?? String(owned.userId),
		});
	}
	// 第二步：按公开 + id 查
	const pub = await this.noteRepo.findOne({
		where: { id, isPublic: true },
	});
	// 两侧都没命中：404
	if (!pub) throw new NotFoundException('笔记不存在');
	// 命中公开笔记：补齐作者，标记 isOwned=false
	const authors = await this.authorMap([pub.userId]);
	return Object.assign(pub, {
		isOwned: false,
		author: authors.get(pub.userId) ?? String(pub.userId),
	});
}
```

**变更摘要**：读权限从「本人限定」变为「本人 OR 公开」，并在详情返回里附带 `isOwned`、`author`，前端据此决定是否渲染编辑/删除/导出按钮。

---

### 4.5 `LearningNotesService.authorMap / toListItem / setVisibility`（`apps/backend/src/services/learning-notes/learning-notes.service.ts`）

**对比范围**：新增的私有辅助方法与公开的 `setVisibility`。

**改动前** · `apps/backend/src/services/learning-notes/learning-notes.service.ts`（基线，约 L1–L10，节选）

```typescript
// 旧版未引入 User 仓储；无 authorMap / toListItem / setVisibility
```

**改动后** · `apps/backend/src/services/learning-notes/learning-notes.service.ts`（当前，约 L60–L71、L164–L197）

```typescript
// 新增公开方法：切换公开状态；仅作者本人可调用
async setVisibility(
	// 当前登录用户 userId
	userId: number,
	// 笔记 UUID
	id: string,
	// 仅包含 isPublic 的 DTO
	dto: UpdateNoteVisibilityDto,
): Promise<LearningNoteListItem> {
	// 复用归属校验：不是作者直接 404
	const row = await this.requireOwned(userId, id);
	// 把新的可见性写回
	row.isPublic = dto.isPublic;
	const saved = await this.noteRepo.save(row);
	// 聚合一次作者信息
	const authors = await this.authorMap([saved.userId]);
	// 复用 toListItem 返回与列表一致的结构
	return this.toListItem(saved, userId, authors.get(saved.userId));
}

// 私有辅助：批量按 userId 查用户名；去重 + 缺失回退
private async authorMap(userIds: number[]): Promise<Map<number, string>> {
	// 去重并过滤非法 id
	const unique = [...new Set(userIds.filter((id) => id > 0))];
	const map = new Map<number, string>();
	// 空数组直接返回空 Map，不走 DB
	if (unique.length === 0) return map;
	// 只选 id / username 两列，避免泄漏其它字段
	const users = await this.userRepo.find({
		where: { id: In(unique) },
		select: { id: true, username: true },
	});
	// 聚合到 Map
	for (const u of users) map.set(u.id, u.username);
	// 兜底：找不到的用户用 userId 字符串
	for (const id of unique) {
		if (!map.has(id)) map.set(id, String(id));
	}
	return map;
}

// 私有辅助：把一行 Entity 转成前端使用的列表 DTO
private toListItem(
	// 行数据（限定到列表需要的字段）
	row: Pick<
		EnglishLearningNote,
		'id' | 'title' | 'userId' | 'isPublic' | 'createdAt' | 'updatedAt'
	>,
	// 当前登录用户 userId，用于判定 isOwned
	viewerUserId: number,
	// 可选的作者用户名；缺失时回退为 userId
	author?: string,
): LearningNoteListItem {
	return {
		// 直接透传 id
		id: row.id,
		// 标题保持原样；空标题由前端再兜底
		title: row.title,
		// userId 原样返回，方便前端做 debug 或未来扩展
		userId: row.userId,
		// 公开状态透传
		isPublic: row.isPublic,
		// 前端展示用的「是否本人」
		isOwned: row.userId === viewerUserId,
		// 作者名或 userId 字符串
		author: author?.trim() || String(row.userId),
		// 创建/更新时间透传
		createdAt: row.createdAt,
		updatedAt: row.updatedAt,
	};
}
```

**变更摘要**：用 `authorMap` 做一次聚合查询避免 N+1，用 `toListItem` 统一输出结构；`setVisibility` 在作者权限校验之上完成切换，返回与列表一致的 DTO。

---

### 4.6 `NotesListPanel` 卡片（`apps/remote-plugins/src/views/learning-notes/components/NotesListPanel.tsx`）

**对比范围**：列表卡片整体与 hover 操作区域（节选）。

**改动前** · `apps/remote-plugins/src/views/learning-notes/components/NotesListPanel.tsx`（基线，约 L130–L185，节选）

```tsx
// 旧版：一列平铺，无公开徽章、无作者、刷新按钮；hover 始终显示 编辑/删除
<div
	className={cn(
		'hover:bg-theme/10 bg-theme/5 group relative w-full rounded-md px-3 py-2.5 text-left',
		active && 'bg-theme/15',
	)}
>
	<button
		type="button"
		className="w-full cursor-pointer text-left"
		onClick={() => void store.openPreview(n.id)}
	>
		<div className="text-textcolor truncate text-base font-semibold pr-0 group-hover:pr-14">
			{n.title}
		</div>
		<div className="text-textcolor/45 mt-1.5 text-xs">
			{new Date(n.at).toLocaleString(locale)}
		</div>
	</button>
	<div className="absolute top-2 right-2 flex items-center gap-0.5 opacity-0 group-hover:opacity-100">
		<button type="button" title={t('learningNotes.edit')}
			className="w-7 h-7 text-textcolor/80 hover:text-teal-500 hover:bg-teal-500/10 ..."
			onClick={(e) => { e.stopPropagation(); void store.openEditById(n.id); }}>
			<SquarePen size={15} />
		</button>
		<button type="button" title={t('learningNotes.delete')}
			className="..."
			onClick={(e) => { e.stopPropagation(); store.requestDelete(n.id); }}>
			<Trash2 size={15} />
		</button>
	</div>
</div>
```

**改动后** · `apps/remote-plugins/src/views/learning-notes/components/NotesListPanel.tsx`（当前，约 L121–L288，节选）

```tsx
// 新版：面板头部增加刷新按钮；卡片容器为 CSS Grid，自动多列
<div className="flex shrink-0 items-center">
	// 既有的滚动定位按钮 ...
	<Btn
		// 新增刷新按钮：点击时重新拉第一页
		title={t('learningNotes.refresh')}
		// 三个 loading 状态同时禁用，避免重复请求
		disabled={store.loading || store.refreshing || store.loadingMore}
		onClick={() => void store.refreshList()}
	>
		<ListRestart size={15} />
	</Btn>
</div>

// ScrollArea 外层加上 @container，便于卡片网格按宽度自适应
<ScrollArea ref={scrollViewportRef} className="min-h-0 flex-1 p-3 pl-[13px]" onScroll={onViewportScroll}>
	// loading 态兼容 refreshing
	{store.loading || store.refreshing ? (
		<div className="..."><Loading className="flex-1" /></div>
	) : (
		// @container 为子元素 min() 宽度查询提供上下文
		<div className="@container flex flex-1 flex-col gap-3">
			// 列表为空的占位
			{store.list.length === 0 ? <div ...>{t('learningNotes.empty')}</div> : null}
			// 卡片网格：按 min(100%,15rem) 自动多列
			<div className="grid grid-cols-[repeat(auto-fill,minmax(min(100%,15rem),1fr))] gap-3">
			{store.list.map((n) => {
				// 判定是否本人：缺失视为本人（兼容写回包）
				const owned = n.isOwned !== false;
				return (
					<div key={n.id}
						className={cn(
							// min-w-0 保证 truncate 在 grid 项里生效
							'hover:bg-theme/10 bg-theme/5 group relative min-w-0 rounded-md px-3 py-2.5 text-left contain-[layout_paint]',
							active && 'bg-theme/15',
						)}
					>
						<button type="button"
							className="w-full cursor-pointer text-left"
							onClick={() => void store.openPreview(n.id)}
						>
							<div className={cn(
								// 公开徽章 + 标题同行；owner 预留 hover 后操作按钮位置
								'text-textcolor flex min-w-0 items-center gap-1.5',
								owned && 'pr-0 group-hover:pr-20',
							)}>
								// 公开徽章：owner 用 teal，读者用 sky，视觉区分
								{n.isPublic ? (
									<span className={cn(
										'shrink-0 rounded px-1.5 py-1 text-xs font-medium leading-none',
										owned ? 'bg-teal-500/15 text-teal-500' : 'bg-sky-500/15 text-sky-500',
									)}>
										{t('learningNotes.publicBadge')}
									</span>
								) : null}
								<span className="truncate text-base font-semibold">{n.title}</span>
							</div>
							<div className="text-textcolor/45 mt-1.5 flex min-w-0 items-center gap-2 text-xs">
								// 作者：有则显示，缺失不渲染节点
								{n.author ? (
									<span className="min-w-0 truncate" title={n.author}>{n.author}</span>
								) : null}
								// 时间：shrink-0 避免被作者挤掉
								<span className="shrink-0">{new Date(n.at).toLocaleString(locale)}</span>
							</div>
						</button>
						// hover 操作区仅 owner 显示，含「公开/取消公开」按钮
						{owned ? (
							<div className="absolute top-2 right-2 flex items-center gap-0.5 opacity-0 group-hover:opacity-100">
								<button type="button"
									// 切换公开：图标与颜色按当前状态区分
									title={n.isPublic ? t('learningNotes.makePrivate') : t('learningNotes.makePublic')}
									className={cn(
										'w-7 h-7 flex cursor-pointer items-center justify-center rounded-md p-1',
										n.isPublic
											? 'text-teal-500 hover:bg-teal-500/10'
											: 'text-textcolor/80 hover:text-teal-500 hover:bg-teal-500/10',
									)}
									onClick={(e) => {
										e.stopPropagation();
										// 请求变更：pending 状态由 store 管理
										store.requestVisibility(n.id, !n.isPublic);
									}}>
									<Globe size={15} />
								</button>
								<button type="button" title={t('learningNotes.edit')}
									className="... hover:text-teal-500 hover:bg-teal-500/10 ..."
									onClick={(e) => { e.stopPropagation(); void store.openEditById(n.id); }}>
									<SquarePen size={15} />
								</button>
								<button type="button" title={t('learningNotes.delete')}
									className="... hover:text-destructive hover:bg-destructive/10 ..."
									onClick={(e) => { e.stopPropagation(); store.requestDelete(n.id); }}>
									<Trash2 size={15} />
								</button>
							</div>
						) : null}
					</div>
				);
			})}
			</div>
			// 底部分页 loading 与「没有更多」判定同时考虑 refreshing
			{!store.loading &&
			!store.refreshing &&
			!store.loadingMore &&
			store.list.length > 0 &&
			!store.hasMore ? (
				<p className="text-textcolor/35 py-2 text-center text-xs">{t('common.noMore')}</p>
			) : null}
		</div>
	)}
</ScrollArea>
```

**变更摘要**：卡片网格 + @container 宽度自适应、公开徽章（owner 青/读者蓝）、作者字段；面板头新增刷新按钮；hover 操作区加上「公开/取消公开」并在非 owner 时整体隐藏。

---

### 4.7 `LearningNotesStore.fetchPage / openPreview / confirmVisibility`（`apps/remote-plugins/src/store/learningNotes.ts`）

**对比范围**：`fetchPage` 状态机、`openPreview` 的 author/isPublic/isOwned 填充、`requestVisibility/confirmVisibility` 新方法。

**改动前** · `apps/remote-plugins/src/store/learningNotes.ts`（基线，节选）

```typescript
// 旧版 fetchPage：只区分 loading（首次）与 loadingMore（追加）
async fetchPage(page: number, append: boolean) {
	if (!this.api) { this.toast(this.t('learningNotes.toast.httpDeniedSync'), 'error'); return; }
	if (this.loading || this.loadingMore || !this.hasMore) return;
	this.loadingMore = append;
	try {
		const data = await this.api.list(page, this.pageSize);
		runInAction(() => {
			this.total = data.total;
			this.pageNo = page;
			if (append) {
				const seen = new Set(this.list.map((n) => n.id));
				this.list = [...this.list, ...data.list.filter((n) => !seen.has(n.id))];
			} else {
				this.list = data.list;
			}
		});
	} catch (e) { this.toast(errMsg(e, this.t), 'error'); }
	finally { runInAction(() => { this.loading = false; this.loadingMore = false; }); }
}

// 旧版 openPreview：只填充 id/title/html/at
async openPreview(id: string) {
	if (!this.api) return;
	const listHit = this.list.find((n) => n.id === id);
	runInAction(() => {
		this.loadingDetail = true;
		this.preview = {
			id,
			title: listHit?.title ?? this.preview?.title ?? '',
			html: this.preview?.id === id ? this.preview.html : '',
			at: listHit?.at ?? this.preview?.at ?? Date.now(),
		};
	});
	// ...
}
```

**改动后** · `apps/remote-plugins/src/store/learningNotes.ts`（当前，节选）

```typescript
// 新版 fetchPage：新增 refreshing 中间态 + 关闭列表回包丢弃
async fetchPage(page: number, append: boolean): Promise<void> {
	if (!this.api) {
		this.toast(this.t('learningNotes.toast.httpDeniedSync'), 'error');
		return;
	}
	// 并发保护：正在加载或刷新时直接拒绝，避免错序
	if (this.loading || this.refreshing) return;
	if (append) {
		// 追加路径：只在真正有更多时才进入 loadingMore
		if (this.loadingMore || !this.hasMore) return;
		this.loadingMore = true;
	} else if (this.list.length > 0) {
		// 已有数据 → 走 refreshing，显示覆盖层但不清空列表
		this.refreshing = true;
	} else {
		// 首屏空列表 → 走 loading
		this.loading = true;
	}
	try {
		const data = await this.api.list(page, this.pageSize);
		runInAction(() => {
			// 关闭列表后丢弃迟到回包，避免清空后又被写回
			if (!this.listOpen) return;
			this.total = data.total;
			this.pageNo = page;
			if (append) {
				const seen = new Set(this.list.map((n) => n.id));
				this.list = [...this.list, ...data.list.filter((n) => !seen.has(n.id))];
			} else {
				// refreshing 或 loading 都会覆盖现有列表
				this.list = data.list;
			}
		});
	} catch (e) {
		// 关闭列表时不再弹 Toast，避免打扰
		if (this.listOpen) this.toast(errMsg(e, this.t), 'error');
	} finally {
		runInAction(() => {
			this.loading = false;
			this.loadingMore = false;
			this.refreshing = false;
		});
	}
}

// 新版 openPreview：把 author/isPublic/isOwned 一并带到预览壳里
async openPreview(id: string): Promise<void> {
	if (!this.api) return;
	const listHit = this.list.find((n) => n.id === id);
	// 立刻进入预览壳：卸掉编辑器，避免与即将挂载的预览双实例并存
	runInAction(() => {
		this.loadingDetail = true;
		this.preview = {
			// 基础字段
			id,
			title: listHit?.title ?? this.preview?.title ?? '',
			html: this.preview?.id === id ? this.preview.html : '',
			at: listHit?.at ?? this.preview?.at ?? Date.now(),
			// 作者：优先用列表数据，其次复用已存在的 preview
			author:
				listHit?.author ??
				(this.preview?.id === id ? this.preview.author : ''),
			// 公开：同上
			isPublic:
				listHit?.isPublic ??
				(this.preview?.id === id ? this.preview.isPublic : false),
			// 是否本人：默认 true；列表缺失时兜底为本人
			isOwned:
				listHit?.isOwned ??
				(this.preview?.id === id ? this.preview.isOwned : true),
		};
	});
	// ...
}

// 新增：请求变更可见性（弹二次确认）
requestVisibility(id: string, isPublic: boolean) {
	// 记录待操作项，供 Confirm 组件读取
	this.pendingVisibility = { id, isPublic };
	this.visibilityConfirmOpen = true;
}

// 新增：二次确认后真正调用后端
async confirmVisibility(): Promise<void> {
	const pending = this.pendingVisibility;
	// 无 api 或无 pending 直接返回
	if (!this.api || !pending) return;
	try {
		const updated = await this.api.setVisibility(pending.id, pending.isPublic);
		runInAction(() => {
			// 同步更新列表里的那一项，isOwned 置为 true（本人操作本人的）
			this.list = this.list.map((n) =>
				n.id === updated.id
					? { ...n, isPublic: updated.isPublic, isOwned: true }
					: n,
			);
			// 预览态也同步
			if (this.preview?.id === updated.id) {
				this.preview = {
					...this.preview,
					isPublic: updated.isPublic,
					isOwned: true,
				};
			}
			// 关闭弹窗，清掉 pending
			this.pendingVisibility = null;
			this.visibilityConfirmOpen = false;
		});
		// Toast 文案按 isPublic 分支
		this.toast(
			this.t(
				pending.isPublic
					? 'learningNotes.toast.madePublic'
					: 'learningNotes.toast.madePrivate',
			),
			'success',
		);
	} catch (e) {
		// 失败也清掉 pending 并关闭弹窗，避免卡死
		this.toast(errMsg(e, this.t), 'error');
		runInAction(() => {
			this.pendingVisibility = null;
			this.visibilityConfirmOpen = false;
		});
	}
}
```

**变更摘要**：Store 引入 `refreshing` 中间态、关闭列表丢弃回包；`openPreview` 补齐 `author/isPublic/isOwned`；新增 `requestVisibility/confirmVisibility` 串联「点击 → 二次确认 → HTTP → 本地同步 → Toast」。

---

### 4.8 `Toolbar` 按钮 hover 描边动画（`apps/remote-plugins/src/components/design/RichEditor/toolbar/Toolbar.tsx` + `styles.css`）

**对比范围**：`Toolbar.tsx` 中 `Btn` 与 `styles.css` 新增动画关键帧（节选）。

**改动前** · `apps/remote-plugins/src/components/design/RichEditor/toolbar/Toolbar.tsx`（基线，节选）

```tsx
// 旧版 Btn：只有底色变化
<button
	type="button"
	className={cn('rich-editor-btn ml-0.5', active && 'is-active', className)}
	// ...
>
```

**改动后** · `apps/remote-plugins/src/components/design/RichEditor/toolbar/Toolbar.tsx`（当前，节选）

```tsx
// 新版 Btn：追加 lucide-stroke-draw-hover 与 [&_svg]:overflow-visible
<button
	type="button"
	className={cn(
		// 新类名：hover 时会触发 styles.css 里的描边关键帧
		'rich-editor-btn lucide-stroke-draw-hover ml-0.5 [&_svg]:overflow-visible',
		active && 'is-active',
		className,
	)}
	// ...
>
```

**配套样式** · `apps/remote-plugins/src/styles.css`（当前，节选）

```css
/* 与主站知识库 header 一致：Lucide hover 描边画线 */
@keyframes lucide-stroke-draw {
	/* 关键帧：结束时描边偏移为 0，显示完整路径 */
	to { stroke-dashoffset: 0; }
}

/* 仅在用户未开启减少动画时生效 */
@media (prefers-reduced-motion: no-preference) {
	/* hover 时给常见 Lucide 基本图形统一加描边动画 */
	.lucide-stroke-draw-hover:hover svg path,
	.lucide-stroke-draw-hover:hover svg line,
	.lucide-stroke-draw-hover:hover svg circle,
	.lucide-stroke-draw-hover:hover svg polyline,
	.lucide-stroke-draw-hover:hover svg rect,
	.lucide-stroke-draw-hover:hover svg ellipse {
		/* 线帽/拐角设为圆角，更接近日笔描边 */
		stroke-linecap: round;
		stroke-linejoin: round;
		/* 初始：描边长度 80、偏移 80（完全隐藏） */
		stroke-dasharray: 80;
		stroke-dashoffset: 80;
		/* 0.5s 线性拉回，完成画线 */
		animation: lucide-stroke-draw 0.5s linear forwards;
	}
}
```

**变更摘要**：用一个 class 名 `lucide-stroke-draw-hover` 把 toolbar、bubble 按钮的 hover 效果从「只变底色」升级为「SVG 路径描边画线」，并通过 `prefers-reduced-motion` 尊重系统无障碍设置。

---

## 5. 兼容性与影响

- **数据库迁移**：需执行 `migrations/1785463755179-learning-notes-public.ts`（新增列）与 `1785463760601-learning-notes-public.ts`（新增索引）。历史记录 `isPublic` 默认 `false`，行为保持不变。
- **旧客户端**：旧前端拿到新增字段会被 `??` / `!== false` 兜底，不会报错；但无法切换公开状态，需升级才能使用。
- **删除与导出**：仍严格 `requireOwned`；公开笔记不会被他人误删或导出。
- **接口签名**：`GET /list`、`GET /detail` 响应体新增字段；`PUT /visibility/:id` 为新增接口；`save`、`update` 响应无破坏性变更。
- **前端布局**：`ResizablePanel.minSize=0` 在电子书阅读页、Monaco 编辑器、学习笔记分栏三处同步，让面板可完全收起；配合 `overflow-hidden` 避免残留阴影。

## 6. 风险与回归

- 回归路径建议覆盖：
  1. 新建/保存笔记 → 列表立即刷新（含「刷新」按钮）。
  2. 切换「公开/私有」→ 列表徽章、作者、hover 操作区同步更新。
  3. 登出再登录另一账号 → 只能看到自己的 + 他人公开笔记；操作区仅对 owner 显示。
  4. 详情页查看他人公开笔记 → 无编辑/删除/导出按钮。
  5. 分页加载更多、关键字搜索、翻页后列表与作者信息一致。
  6. 富文本工具栏 hover 图标描边动画（含 `prefers-reduced-motion` 下不触发）。
  7. 关闭列表 → 切到详情 → 关闭详情 → 重新打开列表 → 不会出现被清空列表被旧回包覆盖的闪烁。

## 7. 相关源码路径

| 说明 | 路径 |
| ---- | ---- |
| Entity（新增 `isPublic` 列与索引） | `apps/backend/src/services/learning-notes/english-learning-note.entity.ts` |
| DTO（新增 `UpdateNoteVisibilityDto`） | `apps/backend/src/services/learning-notes/dto/update-note-visibility.dto.ts` |
| Module（注入 `User` 仓储） | `apps/backend/src/services/learning-notes/learning-notes.module.ts` |
| Controller（`PUT /visibility/:id`） | `apps/backend/src/services/learning-notes/learning-notes.controller.ts` |
| Service（`findOne/findPage/setVisibility/authorMap/toListItem`） | `apps/backend/src/services/learning-notes/learning-notes.service.ts` |
| Entity 迁移 | `apps/backend/src/migrations/1785463755179-learning-notes-public.ts`、`.../1785463760601-learning-notes-public.ts` |
| i18n（中/英文新增词条） | `apps/remote-plugins/src/i18n/locales/zh-CN.ts`、`en-US.ts` |
| API 封装（`setVisibility`） | `apps/remote-plugins/src/views/learning-notes/api.ts` |
| Store（`refreshing`/`requestVisibility`/`confirmVisibility`） | `apps/remote-plugins/src/store/learningNotes.ts` |
| 列表面板（卡片网格/徽章/作者/刷新按钮） | `apps/remote-plugins/src/views/learning-notes/components/NotesListPanel.tsx` |
| 主页面（条件按钮 + 二次确认弹窗） | `apps/remote-plugins/src/views/learning-notes/index.tsx` |
| 富文本 toolbar hover 描边 | `apps/remote-plugins/src/components/design/RichEditor/toolbar/Toolbar.tsx`、`FormatBubble.tsx`、`styles.css` |
| 电子书/Monaco 分栏最小宽度调整 | `apps/frontend/src/views/ebook/components/layout/EbookReadSplitLayout.tsx`、`apps/frontend/src/components/design/Monaco/index.tsx` 等 |

---

（若与仓库最新源码不一致，以源码为准）
