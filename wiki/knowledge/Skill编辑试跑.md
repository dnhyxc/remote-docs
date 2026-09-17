# Skill 编辑与试跑

> **文档角色**：实现思路专题（落地归档）  
> **日期**：2026-09-15  
> **需求摘要**：独立 **Skill 管理页**（三栏：列表 / Monaco 编辑 / 右侧 Agent 试跑·生成），与知识库助手 `/` 多选 Skill 对话**解耦**；消息经通用 Agent SSE，显式 `memorySource=skill_try` 写入 `skill_try_*` 业务表。

## 延伸阅读

- [docs/agent/Agent记忆分表.md](../agent/Agent记忆分表.md) — `memorySource` / MemoryPort；`skill_try` → `SkillTryTableMemory` → `skill_try_messages`
- [docs/knowledge/知识库Skill对话.md](./知识库Skill对话.md) — 知识库助手 `/` 选 Skill + `memorySource=assistant|agent`（**不是**本页试跑）
- [docs/ideas/knowledge/知识库Skill编辑与Agent接入.md](../ideas/knowledge/知识库Skill编辑与Agent接入.md) — 规划稿
- [docs/ideas/knowledge/Skill生成工件锚定.md](../ideas/knowledge/Skill生成工件锚定.md) — 生成会话锚定与 `mode:` 分桶
- [docs/knowledge/Skill侧栏朗读与会话切换.md](./Skill侧栏朗读与会话切换.md) — 朗读条生命周期 + 试跑/生成分桶修复
- [docs/agent/Agent业务消息分表落地.md](../agent/Agent业务消息分表落地.md) — 分表落地与回归

---

## 1. 背景与目标

此前 Skill 能力主要挂在知识库助手（`/` 多选 → Agent）。本轮补齐**独立管理入口** `/skills`：

1. **CRUD**：标题 + Markdown 正文落 `skill` 表（不进知识向量库）。
2. **试跑（try）**：绑定已保存 `skillId`，侧栏多会话；发送时 `skillIds` + `memorySource=skill_try`。
3. **生成（generate）**：用户级全局历史（不挂 Skill）；可把当前编辑器草稿作 `intentPrefix`；解析 Agent 回复写回 Monaco。
4. **会话双写索引**：`skill_try_sessions` 与 `agent_sessions` **同 id**；标题在 `agent_sessions`，消息在 `skill_try_messages`（见 Agent 记忆分表）。

与 [知识库Skill对话.md](./知识库Skill对话.md) 的边界：知识库路径复用助手 UI/`assistant_*`（或草稿 `agent`）；**本页**固定走 `skill_try` 记忆源。

---

## 2. 改动范围

### 2.1 纯新增（本文仅「改动后」）

| 路径 | 作用 |
|------|------|
| `apps/backend/src/services/skill/skill.entity.ts` | `skill` 表 |
| `apps/backend/src/services/skill/skill-try-session.entity.ts` | 侧栏会话索引 |
| `apps/backend/src/services/skill/skill.service.ts` | CRUD + try 会话 |
| `apps/backend/src/services/skill/skill.controller.ts` | REST `/skill/*` |
| `apps/backend/src/services/skill/skill.module.ts` | Nest 模块 |
| `apps/backend/src/services/skill/dto/*.ts` | 校验 DTO |
| `apps/frontend/src/views/skills/index.tsx` | 三栏页面 |
| `apps/frontend/src/views/skills/SkillTryPanel.tsx` | 试跑/生成面板 |
| `apps/frontend/src/store/skill.ts` | 列表/编辑草稿（亦供知识库 `/` 多选） |
| `apps/frontend/src/store/skillTry.ts` | 侧栏会话 + SSE |

### 2.2 关联既有（分表 / Agent，细节见延伸阅读）

- `apps/backend/src/services/agent/skill-try-table-memory.ts`、`skill-try-message.entity.ts`、`agent-chat.dto.ts`（`memorySource` 含 `skill_try`）
- 路由 `/skills`、侧栏、i18n、`service/index.ts` Skill API 封装

---

## 3. 实现思路

### 3.1 页面结构

- **路由** `/skills`
- **左栏**：`skillStore.list` → `openSkill` / `createNew`
- **中栏**：Monaco ← `skillStore.title` / `content` → save / update / delete
- **右栏** `SkillTryPanel`：
  - `mode=try | generate`（工具条切换）
  - `bindSkill(editingId)`；试跑必须先保存才有 `skillId`
  - `sendMessage` →（无会话则）`createSkillTrySession` → `streamAgentSse({ memorySource: 'skill_try' })`

### 3.2 `memorySource=skill_try` 与记忆分表

通用 Agent SSE 根据 `memorySource` 选择 `AgentTurnMemory` 实现：

| memorySource | 适配器 | 消息表 |
|--------------|--------|--------|
| `skill_try` | `SkillTryTableMemory` | `skill_try_messages`（摘要 `skill_try_session_summaries`） |
| `assistant` | `AssistantTableMemory` | `assistant_*`（知识库已保存文档） |
| `english_learning` | English 表适配器 | `english_agent_*` |
| `agent` / 缺省 | 默认 Agent 记忆 | `agent_messages` |

本页 **一律显式**传 `memorySource: 'skill_try'`，避免 `inferMemorySource` 误判或表探测失败。会话创建时先插 `agent_sessions` + `skill_try_sessions`（同 UUID），保证详情/分享/停流仍走通用 Agent session API。

试跑请求体另带 `skillIds: [skillId]`（强制加载工具）；生成带 `assistMode: 'skill_generate'`，可选 `intentPrefix`（当前草稿）。

完整分表设计见 [Agent记忆分表.md](../agent/Agent记忆分表.md)；知识库 `/` 路径见 [知识库Skill对话.md](./知识库Skill对话.md)。

### 3.3 历史隔离

- **try**：`listTrySessions(kind=try, skillId)` — 按 Skill 隔离。
- **generate**：`kind=generate`，`skill_id` 恒 null，用户级全局列表。
- 前端 `stateBySession`：切换 Skill/模式/历史**不中止**其它会话 SSE（对齐英语学习）。

### 3.4 关键决策

1. Skill 正文不向量化 — 仅 Prompt 包，走 Agent 工具注入。
2. 删除 Skill 时清该 skill 下 try 会话的双表 id（避免脏索引）。
3. 生成模式「应用到编辑器」用 `parseSkillDraft`：优先整段围栏 + `# 标题`，与气泡所见一致。

---

## 4. 关键代码（纯新增 · 改动后）

> 下列模块相对基线均为**新建文件/符号**，按规范只贴 **改动后**；围栏内每一行源码上方有中文注释。外层使用四反引号围栏，以免源码中的三反引号正则打断文档。

### 4.1 `Skill` 实体（完整文件）

**对比范围**：全文。


**改动后** · `apps/backend/src/services/skill/skill.entity.ts`（当前，全文约 L1–L31）

````typescript
// 从 typeorm 导入实体装饰器
import {
	// 列装饰器
	Column,
	// 创建时间列装饰器
	CreateDateColumn,
	// 实体装饰器
	Entity,
	// 索引装饰器
	Index,
	// UUID 主键装饰器
	PrimaryGeneratedColumn,
	// 更新时间列装饰器
	UpdateDateColumn,
// typeorm 导入结束
} from 'typeorm';

// 见下行：用户可编辑 Skill，不进知识向量库
/** 用户可编辑的 Skill / Prompt 指令包（不进知识向量库） */
// 表名 skill
@Entity({ name: 'skill' })
// 作者维度索引，加速 listMine
@Index('IDX_skill_author', ['authorId'])
// 导出实体类 Skill
export class Skill {
	// 主键 UUID 自生成
	@PrimaryGeneratedColumn('uuid')
	// id 字段
	id!: string;

	// 标题 varchar(200)
	@Column('varchar', { length: 200 })
	// title
	title!: string;

	// 正文 longtext
	@Column({ type: 'longtext' })
	// content
	content!: string;

	// 作者 userId，列名 author_id
	@Column({ name: 'author_id', type: 'int' })
	// authorId
	authorId!: number;

	// created_at
	@CreateDateColumn({ name: 'created_at', type: 'timestamp' })
	// createdAt
	createdAt!: Date;

	// updated_at
	@UpdateDateColumn({ name: 'updated_at', type: 'timestamp' })
	// updatedAt
	updatedAt!: Date;
// 类结束
}
````


**变更摘要**：新建 `skill` 表实体，仅存标题/正文/作者与时间戳。


### 4.2 `SkillTrySession` 实体（完整文件）

**对比范围**：全文。


**改动后** · `apps/backend/src/services/skill/skill-try-session.entity.ts`（当前，全文约 L1–L44）

````typescript
// 导入 typeorm 列与索引 API
import {
	// Column
	Column,
	// CreateDateColumn
	CreateDateColumn,
	// Entity
	Entity,
	// Index
	Index,
	// PrimaryColumn（与 agent 同 UUID）
	PrimaryColumn,
	// UpdateDateColumn
	UpdateDateColumn,
// 导入结束
} from 'typeorm';

// kind 联合类型
export type SkillTrySessionKind = 'try' | 'generate';

// 见下行块注释：侧栏索引，消息在 skill_try_messages
/**
 // 见下行：try 按 skill_id；generate 全局
 * Skill 侧栏 Agent 历史索引（与 agent_sessions 同 id；消息在 skill_try_messages）。
 // 见下行续
 * kind=try 按 skill_id 隔离；kind=generate 为用户级全局历史（skill_id 恒为 null）。
 // 块注释结束
 */
// 表 skill_try_sessions
@Entity('skill_try_sessions')
// 复合索引支撑列表查询
@Index('idx_skill_try_session_user_kind_skill_updated', [
	// 索引字段 userId
	'userId',
	// 索引字段 kind
	'kind',
	// 索引字段 skillId
	'skillId',
	// 索引字段 updatedAt
	'updatedAt',
// Index 结束
])
// 导出实体
export class SkillTrySession {
	// 见下行：主键 = agent_sessions.id
	/** 与 agent_sessions.id 相同，便于复用 Agent SSE / 消息表 */
	// 主键 varchar(36)
	@PrimaryColumn('varchar', { length: 36 })
	// id
	id: string;

	// user_id
	@Column({ type: 'int', name: 'user_id' })
	// userId
	userId: number;

	// 见下行 kind 语义
	/** try = 试跑；generate = 生成 */
	// kind 列默认 try
	@Column({ type: 'varchar', length: 16, default: 'try' })
	// kind 字段
	kind: SkillTrySessionKind;

	// 见下行 skillId 可空
	/** 绑定的 Skill；生成草稿可为 null */
	// skill_id 可空列
	@Column({ type: 'varchar', length: 36, name: 'skill_id', nullable: true })
	// skillId
	skillId: string | null;

	// created_at
	@CreateDateColumn({ name: 'created_at', type: 'timestamp' })
	// createdAt
	createdAt: Date;

	// updated_at
	@UpdateDateColumn({ name: 'updated_at', type: 'timestamp' })
	// updatedAt
	updatedAt: Date;
// 类结束
}
````


**变更摘要**：业务会话索引与 `agent_sessions` 同 id；`kind` 区分试跑/生成。


### 4.3 DTO（完整文件）


**改动后** · `apps/backend/src/services/skill/dto/save-skill.dto.ts`（当前，全文）

````typescript
// class-validator 导入
import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

// 新建 Skill 体
export class SaveSkillDto {
	// title 字符串
	@IsString()
	// 非空
	@IsNotEmpty()
	// 最长 200
	@MaxLength(200)
	// title
	title!: string;

	// content 字符串
	@IsString()
	// 非空
	@IsNotEmpty()
	// 最长 200000
	@MaxLength(200_000)
	// content
	content!: string;
// 类结束
}
````



**改动后** · `apps/backend/src/services/skill/dto/update-skill.dto.ts`（当前，全文）

````typescript
// 校验装饰器导入
import { IsNotEmpty, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';

// 更新体（含 id）
export class UpdateSkillDto {
	// id 必须 UUID
	@IsUUID()
	// id
	id!: string;

	// title 可选
	@IsOptional()
	// 若有则字符串
	@IsString()
	// 若有则非空
	@IsNotEmpty()
	// 最长 200
	@MaxLength(200)
	// title?
	title?: string;

	// content 可选
	@IsOptional()
	// 若有则字符串
	@IsString()
	// 若有则非空
	@IsNotEmpty()
	// 最长 200000
	@MaxLength(200_000)
	// content?
	content?: string;
// 类结束
}
````



**改动后** · `apps/backend/src/services/skill/dto/create-skill-try-session.dto.ts`（当前，全文）

````typescript
// 校验装饰器
import { IsIn, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';

// 创建侧栏会话体
export class CreateSkillTrySessionDto {
	// 见下行 kind 说明
	/** try = 试跑（须 skillId）；generate = 全局生成（忽略 skillId） */
	// kind 可选
	@IsOptional()
	// 枚举 try|generate
	@IsIn(['try', 'generate'])
	// kind?
	kind?: 'try' | 'generate';

	// 见下行：仅试跑有效
	/** 仅试跑有效；生成模式服务端会强制置空 */
	// skillId 可选
	@IsOptional()
	// UUID
	@IsUUID()
	// skillId?
	skillId?: string;

	// title 可选
	@IsOptional()
	// 字符串
	@IsString()
	// 最长 255
	@MaxLength(255)
	// title?
	title?: string;
// 类结束
}
````



### 4.4 `SkillModule`（完整文件）


**改动后** · `apps/backend/src/services/skill/skill.module.ts`（当前，全文约 L1–L15）

````typescript
// Nest Module 装饰器
import { Module } from '@nestjs/common';
// TypeORM 模块
import { TypeOrmModule } from '@nestjs/typeorm';
// 复用 AgentSession 实体
import { AgentSession } from '../agent/agent-session.entity';
// 控制器
import { SkillController } from './skill.controller';
// Skill 实体
import { Skill } from './skill.entity';
// 服务
import { SkillService } from './skill.service';
// TrySession 实体
import { SkillTrySession } from './skill-try-session.entity';

// 模块元数据
@Module({
	// 注册三实体仓储
	imports: [TypeOrmModule.forFeature([Skill, SkillTrySession, AgentSession])],
	// controllers
	controllers: [SkillController],
	// providers
	providers: [SkillService],
	// 导出 Service 供 Agent 注入 findByIdsForUser
	exports: [SkillService],
// 结束
})
// 导出模块类
export class SkillModule {}
````



### 4.5 `SkillService`（完整文件）

**对比范围**：全文（CRUD + `createTrySession` / `listTrySessions` / `findByIdsForUser`）。


**改动后** · `apps/backend/src/services/skill/skill.service.ts`（当前，全文约 L1–L214）

````typescript
// 导入：import {
import {
	// 语句：BadRequestException,
	BadRequestException,
	// 语句：ForbiddenException,
	ForbiddenException,
	// 语句：Injectable,
	Injectable,
	// 语句：NotFoundException,
	NotFoundException,
// 导入：} from '@nestjs/common';
} from '@nestjs/common';
// 导入：import { InjectRepository } from '@nestjs/typeorm';
import { InjectRepository } from '@nestjs/typeorm';
// 导入：import { randomUUID } from 'node:crypto';
import { randomUUID } from 'node:crypto';
// 导入：import { In, Repository } from 'typeorm';
import { In, Repository } from 'typeorm';
// 导入：import { AgentSession } from '../agent/agent-session.entity';
import { AgentSession } from '../agent/agent-session.entity';
// 导入：import { CreateSkillTrySessionDto } from './dto/create-skill-try-sessi
import { CreateSkillTrySessionDto } from './dto/create-skill-try-session.dto';
// 导入：import { SaveSkillDto } from './dto/save-skill.dto';
import { SaveSkillDto } from './dto/save-skill.dto';
// 导入：import { UpdateSkillDto } from './dto/update-skill.dto';
import { UpdateSkillDto } from './dto/update-skill.dto';
// 导入：import { Skill } from './skill.entity';
import { Skill } from './skill.entity';
// 导入：import { SkillTrySession } from './skill-try-session.entity';
import { SkillTrySession } from './skill-try-session.entity';

// Agent 强制加载用的精简 Skill 结构
export type SkillBody = {
	// 语句：id: string;
	id: string;
	// 语句：title: string;
	title: string;
	// 语句：content: string;
	content: string;
// 结构：};
};

// 单次注入正文总字符上限（靠前优先截断）
const SKILL_CHARS_CAP = 80_000;

// Nest 可注入服务
@Injectable()
// Skill CRUD + 试跑会话索引
export class SkillService {
	// 构造函数
	constructor(
		// 装饰器：@InjectRepository(Skill)
		@InjectRepository(Skill)
		// 成员：private readonly skillRepo: Repository<Skill>,
		private readonly skillRepo: Repository<Skill>,
		// 装饰器：@InjectRepository(SkillTrySession)
		@InjectRepository(SkillTrySession)
		// 成员：private readonly trySessionRepo: Repository<SkillTrySession>,
		private readonly trySessionRepo: Repository<SkillTrySession>,
		// 装饰器：@InjectRepository(AgentSession)
		@InjectRepository(AgentSession)
		// 成员：private readonly agentSessionRepo: Repository<AgentSession>,
		private readonly agentSessionRepo: Repository<AgentSession>,
	// 语句：) {}
	) {}

	// 新建 Skill，authorId=当前用户
	async create(userId: number, dto: SaveSkillDto): Promise<Skill> {
		// 声明：const row = this.skillRepo.create({
		const row = this.skillRepo.create({
			// 语句：title: dto.title.trim(),
			title: dto.title.trim(),
			// 语句：content: dto.content,
			content: dto.content,
			// 语句：authorId: userId,
			authorId: userId,
		// 结构：});
		});
		// 返回：return this.skillRepo.save(row);
		return this.skillRepo.save(row);
	// 结构：}
	}

	// 更新本人 Skill（部分字段）
	async update(userId: number, dto: UpdateSkillDto): Promise<Skill> {
		// 声明：const row = await this.findOwned(userId, dto.id);
		const row = await this.findOwned(userId, dto.id);
		// 分支：if (dto.title != null) row.title = dto.title.trim();
		if (dto.title != null) row.title = dto.title.trim();
		// 分支：if (dto.content != null) row.content = dto.content;
		if (dto.content != null) row.content = dto.content;
		// 返回：return this.skillRepo.save(row);
		return this.skillRepo.save(row);
	// 结构：}
	}

	// 删除 Skill，并清同 skill 的 try 会话双表
	async remove(userId: number, id: string): Promise<void> {
		// 声明：const row = await this.findOwned(userId, id);
		const row = await this.findOwned(userId, id);
		// 声明：const tryRows = await this.trySessionRepo.find({
		const tryRows = await this.trySessionRepo.find({
			// 语句：where: { userId, skillId: id },
			where: { userId, skillId: id },
			// 语句：select: ['id'],
			select: ['id'],
		// 结构：});
		});
		// 分支：if (tryRows.length) {
		if (tryRows.length) {
			// 声明：const ids = tryRows.map((r) => r.id);
			const ids = tryRows.map((r) => r.id);
			// await：await this.trySessionRepo.delete({ id: In(ids), userId });
			await this.trySessionRepo.delete({ id: In(ids), userId });
			// await：await this.agentSessionRepo.delete({ id: In(ids), userId });
			await this.agentSessionRepo.delete({ id: In(ids), userId });
		// 结构：}
		}
		// await：await this.skillRepo.remove(row);
		await this.skillRepo.remove(row);
	// 结构：}
	}

	// 列出本人 Skill，updatedAt 倒序
	async listMine(userId: number): Promise<Skill[]> {
		// 返回：return this.skillRepo.find({
		return this.skillRepo.find({
			// 语句：where: { authorId: userId },
			where: { authorId: userId },
			// 语句：order: { updatedAt: 'DESC' },
			order: { updatedAt: 'DESC' },
		// 结构：});
		});
	// 结构：}
	}

	// 取单条本人 Skill
	async findOneMine(userId: number, id: string): Promise<Skill> {
		// 返回：return this.findOwned(userId, id);
		return this.findOwned(userId, id);
	// 结构：}
	}

	// 见下行源码自带注释
	/**
	 // 见下行源码自带注释
	 * 按请求顺序返回本人 Skill；丢弃无权/缺失 ID。
	 // 见下行源码自带注释
	 * 合计正文超长时从尾部截断集合（靠前优先）。
	 // 见下行源码自带注释
	 */
	// 按 ids 顺序取本人 Skill，超 SKILL_CHARS_CAP 截断
	async findByIdsForUser(
		// 语句：ids: string[] | undefined,
		ids: string[] | undefined,
		// 语句：userId: number,
		userId: number,
	// 语句：): Promise<SkillBody[]> {
	): Promise<SkillBody[]> {
		// 分支：if (!ids?.length) return [];
		if (!ids?.length) return [];
		// 声明：const unique = [...new Set(ids.filter(Boolean))];
		const unique = [...new Set(ids.filter(Boolean))];
		// 分支：if (!unique.length) return [];
		if (!unique.length) return [];
		// 声明：const rows = await this.skillRepo.find({
		const rows = await this.skillRepo.find({
			// 语句：where: { id: In(unique), authorId: userId },
			where: { id: In(unique), authorId: userId },
		// 结构：});
		});
		// 声明：const byId = new Map(rows.map((r) => [r.id, r]));
		const byId = new Map(rows.map((r) => [r.id, r]));
		// 声明：const ordered: SkillBody[] = [];
		const ordered: SkillBody[] = [];
		// 声明：let chars = 0;
		let chars = 0;
		// 循环：for (const id of ids) {
		for (const id of ids) {
			// 声明：const row = byId.get(id);
			const row = byId.get(id);
			// 分支：if (!row) continue;
			if (!row) continue;
			// 声明：const next = chars + row.content.length;
			const next = chars + row.content.length;
			// 分支：if (next > SKILL_CHARS_CAP && ordered.length > 0) break;
			if (next > SKILL_CHARS_CAP && ordered.length > 0) break;
			// 语句：ordered.push({
			ordered.push({
				// 语句：id: row.id,
				id: row.id,
				// 语句：title: row.title,
				title: row.title,
				// 语句：content: row.content,
				content: row.content,
			// 结构：});
			});
			// 语句：chars = next;
			chars = next;
		// 结构：}
		}
		// 返回：return ordered;
		return ordered;
	// 结构：}
	}

	// 见下行源码自带注释
	/** 新建 Skill 侧栏会话：skill_try_sessions + 同 id 的 agent_sessions */
	// 新建侧栏会话：agent_sessions + skill_try_sessions 同 id
	async createTrySession(userId: number, dto: CreateSkillTrySessionDto) {
		// kind 归一：非 generate 一律 try
		const kind = dto.kind === 'generate' ? 'generate' : 'try';
		// 见下行源码自带注释
		// 生成历史全局独立，不挂 Skill；试跑必须绑 skillId
		// generate 强制 skillId=null；try 取 dto.skillId
		const skillId =
			// 语句：kind === 'generate' ? null : dto.skillId?.trim() || null;
			kind === 'generate' ? null : dto.skillId?.trim() || null;
		// 试跑必须绑定 skillId，否则 400
		if (kind === 'try' && !skillId) {
			// 抛错：throw new BadRequestException('试跑会话必须绑定 skillId');
			throw new BadRequestException('试跑会话必须绑定 skillId');
		// 结构：}
		}
		// 有 skillId 时校验归属
		if (skillId) await this.findOwned(userId, skillId);
		// 会话 UUID（与 agent_sessions 共用）
		const id = randomUUID();
		// 声明：const title = dto.title?.trim() || null;
		const title = dto.title?.trim() || null;
		// 声明：const now = new Date();
		const now = new Date();
		// 先写 agent_sessions（标题载体）
		await this.agentSessionRepo.save(
			// 语句：this.agentSessionRepo.create({
			this.agentSessionRepo.create({
				// 语句：id,
				id,
				// 语句：userId,
				userId,
				// 语句：title,
				title,
				// 语句：updatedAt: now,
				updatedAt: now,
			// 语句：}),
			}),
		// 结构：);
		);
		// 再写 skill_try_sessions 业务索引
		await this.trySessionRepo.save(
			// 语句：this.trySessionRepo.create({
			this.trySessionRepo.create({
				// 语句：id,
				id,
				// 语句：userId,
				userId,
				// 语句：kind,
				kind,
				// 语句：skillId,
				skillId,
				// 语句：updatedAt: now,
				updatedAt: now,
			// 语句：}),
			}),
		// 结构：);
		);
		// 返回 sessionId/title/skillId/kind
		return { sessionId: id, title, skillId, kind };
	// 结构：}
	}

	// 见下行源码自带注释
	/**
	 // 见下行源码自带注释
	 * 列出 Skill 侧栏历史。
	 // 见下行源码自带注释
	 * try：按 skillId；generate：用户级全局列表（不按 Skill）。
	 // 见下行源码自带注释
	 */
	// 分页列侧栏历史
	async listTrySessions(
		// 语句：userId: number,
		userId: number,
		// 语句：opts: {
		opts: {
			// 语句：skillId?: string | null;
			skillId?: string | null;
			// 语句：kind?: 'try' | 'generate';
			kind?: 'try' | 'generate';
			// 语句：pageNo?: number;
			pageNo?: number;
			// 语句：pageSize?: number;
			pageSize?: number;
		// 结构：},
		},
	// 语句：): Promise<{
	): Promise<{
		// 语句：skillId: string | null;
		skillId: string | null;
		// 语句：kind: 'try' | 'generate';
		kind: 'try' | 'generate';
		// 语句：list: Array<{
		list: Array<{
			// 语句：sessionId: string;
			sessionId: string;
			// 语句：title: string | null;
			title: string | null;
			// 语句：createdAt: Date;
			createdAt: Date;
			// 语句：updatedAt: Date;
			updatedAt: Date;
		// 语句：}>;
		}>;
		// 语句：pageNo: number;
		pageNo: number;
		// 语句：pageSize: number;
		pageSize: number;
		// 语句：total: number;
		total: number;
	// 语句：}> {
	}> {
		// 声明：const kind = opts.kind === 'generate' ? 'generate' : 'try';
		const kind = opts.kind === 'generate' ? 'generate' : 'try';
		// kind 归一
		const sid = kind === 'try' ? opts.skillId?.trim() || null : null;
		// try 才带 skillId；generate 列表不按 Skill
		if (kind === 'try' && !sid) {
			// 试跑历史缺 skillId → 400
			throw new BadRequestException('试跑历史须传 skillId');
		// 结构：}
		}
		// 分支：if (sid) await this.findOwned(userId, sid);
		if (sid) await this.findOwned(userId, sid);
		// 声明：const pn = Math.max(1, Math.floor(opts.pageNo ?? 1));
		const pn = Math.max(1, Math.floor(opts.pageNo ?? 1));
		// 声明：const ps = Math.min(50, Math.max(1, Math.floor(opts.pageSize ?? 20)));
		const ps = Math.min(50, Math.max(1, Math.floor(opts.pageSize ?? 20)));
		// 声明：const qb = this.agentSessionRepo
		const qb = this.agentSessionRepo
			// 以 agent_sessions 为主表分页
			.createQueryBuilder('a')
			// 语句：.where('a.user_id = :uid', { uid: userId });
			.where('a.user_id = :uid', { uid: userId });
		// 见下行源码自带注释
		// ponytail: 子查询避免 innerJoin(Entity) 多库 databaseName 崩
		// ponytail：子查询避免 Entity join 跨库 databaseName 问题
		if (kind === 'generate') {
			// generate：子查询 kind=generate
			qb.andWhere(
				// 语句：`a.id IN (SELECT t.id FROM skill_try_sessions t WHERE t.user_id = :uid
				`a.id IN (SELECT t.id FROM skill_try_sessions t WHERE t.user_id = :uid AND t.kind = 'generate')`,
			// 结构：);
			);
		// 分支：} else {
		} else {
			// try：子查询 kind=try 且 skill_id=sid
			qb.andWhere(
				// 语句：`a.id IN (SELECT t.id FROM skill_try_sessions t WHERE t.user_id = :uid
				`a.id IN (SELECT t.id FROM skill_try_sessions t WHERE t.user_id = :uid AND t.kind = 'try' AND t.skill_id = :sid)`,
				// 语句：{ sid },
				{ sid },
			// 结构：);
			);
		// 结构：}
		}
		// 语句：qb.orderBy('a.updated_at', 'DESC')
		qb.orderBy('a.updated_at', 'DESC')
			// 语句：.skip((pn - 1) * ps)
			.skip((pn - 1) * ps)
			// 语句：.take(ps);
			.take(ps);
		// 声明：const [rows, total] = await qb.getManyAndCount();
		const [rows, total] = await qb.getManyAndCount();
		// 返回：return {
		return {
			// 语句：skillId: sid,
			skillId: sid,
			// 语句：kind,
			kind,
			// 语句：list: rows.map((r) => ({
			list: rows.map((r) => ({
				// 语句：sessionId: r.id,
				sessionId: r.id,
				// 语句：title: r.title,
				title: r.title,
				// 语句：createdAt: r.createdAt,
				createdAt: r.createdAt,
				// 语句：updatedAt: r.updatedAt,
				updatedAt: r.updatedAt,
			// 语句：})),
			})),
			// 语句：pageNo: pn,
			pageNo: pn,
			// 语句：pageSize: ps,
			pageSize: ps,
			// 语句：total,
			total,
		// 结构：};
		};
	// 结构：}
	}

	// 异步方法：private async findOwned(userId: number, id: string): Promise<Skill> {
	private async findOwned(userId: number, id: string): Promise<Skill> {
		// 鉴权：存在且 authorId 匹配
		const row = await this.skillRepo.findOne({ where: { id } });
		// 分支：if (!row) throw new NotFoundException('Skill 不存在');
		if (!row) throw new NotFoundException('Skill 不存在');
		// 分支：if (row.authorId !== userId) throw new ForbiddenException('无权操作该 Skill
		if (row.authorId !== userId) throw new ForbiddenException('无权操作该 Skill');
		// 返回：return row;
		return row;
	// 结构：}
	}
// 结构：}
}
````


**变更摘要**：Skill CRUD；试跑/生成会话双写；`findByIdsForUser` 供知识库/Agent 强制加载（字符上限截断）。


### 4.6 `SkillController`（完整文件）


**改动后** · `apps/backend/src/services/skill/skill.controller.ts`（当前，全文约 L1–L106）

````typescript
// 导入：import {
import {
	// 语句：Body,
	Body,
	// 语句：ClassSerializerInterceptor,
	ClassSerializerInterceptor,
	// 语句：Controller,
	Controller,
	// 语句：Delete,
	Delete,
	// 语句：Get,
	Get,
	// 语句：Param,
	Param,
	// 语句：ParseUUIDPipe,
	ParseUUIDPipe,
	// 语句：Post,
	Post,
	// 语句：Put,
	Put,
	// 语句：Query,
	Query,
	// 语句：Req,
	Req,
	// 语句：UnauthorizedException,
	UnauthorizedException,
	// 语句：UseGuards,
	UseGuards,
	// 语句：UseInterceptors,
	UseInterceptors,
// 导入：} from '@nestjs/common';
} from '@nestjs/common';
// 导入：import type { Request } from 'express';
import type { Request } from 'express';
// 导入：import { JwtGuard } from 'src/guards/jwt.guard';
import { JwtGuard } from 'src/guards/jwt.guard';
// 导入：import { ResponseInterceptor } from '../../interceptors/response.inter
import { ResponseInterceptor } from '../../interceptors/response.interceptor';
// 导入：import { CreateSkillTrySessionDto } from './dto/create-skill-try-sessi
import { CreateSkillTrySessionDto } from './dto/create-skill-try-session.dto';
// 导入：import { SaveSkillDto } from './dto/save-skill.dto';
import { SaveSkillDto } from './dto/save-skill.dto';
// 导入：import { UpdateSkillDto } from './dto/update-skill.dto';
import { UpdateSkillDto } from './dto/update-skill.dto';
// 导入：import { SkillService } from './skill.service';
import { SkillService } from './skill.service';

// 类型：type AuthedRequest = Request & { user?: { userId?: number } };
type AuthedRequest = Request & { user?: { userId?: number } };

// HTTP 前缀 /skill
@Controller('skill')
// 统一响应包装 + 序列化
@UseInterceptors(ClassSerializerInterceptor, ResponseInterceptor)
// 全路由 JWT
@UseGuards(JwtGuard)
// Skill REST 控制器
export class SkillController {
	// 构造函数
	constructor(private readonly skillService: SkillService) {}

	// 从 JWT 取 userId
	private userId(req: AuthedRequest): number {
		// 声明：const userId = req.user?.userId;
		const userId = req.user?.userId;
		// 分支：if (userId == null) throw new UnauthorizedException('未登录');
		if (userId == null) throw new UnauthorizedException('未登录');
		// 返回：return userId;
		return userId;
	// 结构：}
	}

	// POST /skill/save
	@Post('save')
	// 异步方法：async save(@Req() req: AuthedRequest, @Body() dto: SaveSkillDto) {
	async save(@Req() req: AuthedRequest, @Body() dto: SaveSkillDto) {
		// 返回：return this.skillService.create(this.userId(req), dto);
		return this.skillService.create(this.userId(req), dto);
	// 结构：}
	}

	// GET /skill/list
	@Get('list')
	// 异步方法：async list(@Req() req: AuthedRequest) {
	async list(@Req() req: AuthedRequest) {
		// 返回：return this.skillService.listMine(this.userId(req));
		return this.skillService.listMine(this.userId(req));
	// 结构：}
	}

	// 见下行：须注册在 detail/:id 之前，避免被当成 id
	/** 按 kind + skillId 列出侧栏历史（须在 detail/:id 前） */
	// GET /skill/sessions 侧栏历史
	@Get('sessions')
	// 异步方法：async listTrySessions(
	async listTrySessions(
		// 装饰器：@Req() req: AuthedRequest,
		@Req() req: AuthedRequest,
		// 装饰器：@Query('skillId') skillId?: string,
		@Query('skillId') skillId?: string,
		// 装饰器：@Query('kind') kind?: string,
		@Query('kind') kind?: string,
		// 装饰器：@Query('pageNo') pageNo?: string,
		@Query('pageNo') pageNo?: string,
		// 装饰器：@Query('pageSize') pageSize?: string,
		@Query('pageSize') pageSize?: string,
	// 语句：) {
	) {
		// 解析 pageNo
		const pn = Math.max(1, parseInt(pageNo ?? '1', 10) || 1);
		// 解析 pageSize 并夹到 ≤50
		const ps = Math.min(50, Math.max(1, parseInt(pageSize ?? '20', 10) || 20));
		// 声明：const data = await this.skillService.listTrySessions(this.userId(req),
		const data = await this.skillService.listTrySessions(this.userId(req), {
			// 语句：skillId,
			skillId,
			// 语句：kind: kind === 'generate' ? 'generate' : 'try',
			kind: kind === 'generate' ? 'generate' : 'try',
			// 语句：pageNo: pn,
			pageNo: pn,
			// 语句：pageSize: ps,
			pageSize: ps,
		// 结构：});
		});
		// Date → ISO 字符串给前端
		return {
			// 语句：...data,
			...data,
			// 语句：list: data.list.map((row) => ({
			list: data.list.map((row) => ({
				// 语句：...row,
				...row,
				// 语句：createdAt: row.createdAt.toISOString(),
				createdAt: row.createdAt.toISOString(),
				// 语句：updatedAt: row.updatedAt.toISOString(),
				updatedAt: row.updatedAt.toISOString(),
			// 语句：})),
			})),
		// 结构：};
		};
	// 结构：}
	}

	// POST /skill/session
	@Post('session')
	// 异步方法：async createTrySession(
	async createTrySession(
		// 装饰器：@Req() req: AuthedRequest,
		@Req() req: AuthedRequest,
		// 装饰器：@Body() dto: CreateSkillTrySessionDto,
		@Body() dto: CreateSkillTrySessionDto,
	// 语句：) {
	) {
		// 返回：return this.skillService.createTrySession(this.userId(req), dto);
		return this.skillService.createTrySession(this.userId(req), dto);
	// 结构：}
	}

	// GET /skill/detail/:id
	@Get('detail/:id')
	// 异步方法：async one(@Req() req: AuthedRequest, @Param('id', ParseUUIDPipe) id: s
	async one(@Req() req: AuthedRequest, @Param('id', ParseUUIDPipe) id: string) {
		// 返回：return this.skillService.findOneMine(this.userId(req), id);
		return this.skillService.findOneMine(this.userId(req), id);
	// 结构：}
	}

	// PUT /skill/update/:id（路径 id 合并进 dto）
	@Put('update/:id')
	// 异步方法：async update(
	async update(
		// 装饰器：@Req() req: AuthedRequest,
		@Req() req: AuthedRequest,
		// 装饰器：@Param('id', ParseUUIDPipe) id: string,
		@Param('id', ParseUUIDPipe) id: string,
		// 装饰器：@Body() dto: UpdateSkillDto,
		@Body() dto: UpdateSkillDto,
	// 语句：) {
	) {
		// 返回：return this.skillService.update(this.userId(req), { ...dto, id });
		return this.skillService.update(this.userId(req), { ...dto, id });
	// 结构：}
	}

	// DELETE /skill/delete/:id
	@Delete('delete/:id')
	// 异步方法：async remove(
	async remove(
		// 装饰器：@Req() req: AuthedRequest,
		@Req() req: AuthedRequest,
		// 装饰器：@Param('id', ParseUUIDPipe) id: string,
		@Param('id', ParseUUIDPipe) id: string,
	// 语句：) {
	) {
		// await：await this.skillService.remove(this.userId(req), id);
		await this.skillService.remove(this.userId(req), id);
		// 返回：return { ok: true };
		return { ok: true };
	// 结构：}
	}
// 结构：}
}
````


**变更摘要**：REST 入口；`GET sessions` 须在 `detail/:id` 前，避免路由冲突。


### 4.7 前端 `skillStore`（完整文件）

**对比范围**：列表/编辑/保存/删除；`selectedSkillIds` 亦服务知识库 `/`（本页主用编辑态）。


**改动后** · `apps/frontend/src/store/skill.ts`（当前，全文约 L1–L209）

````typescript
// 见下行源码自带注释
/**
 // 见下行源码自带注释
 * Skill / Prompt：列表、编辑草稿、知识库 `/` 多选芯片。
 // 见下行源码自带注释
 * 页面可直接 import，不必挂 root store（同 assistantStore）。
 // 见下行源码自带注释
 */
// 导入：import { Toast } from '@ui/index';
import { Toast } from '@ui/index';
// 导入：import { makeAutoObservable, runInAction } from 'mobx';
import { makeAutoObservable, runInAction } from 'mobx';
// 导入：import {
import {
	// 语句：deleteSkill,
	deleteSkill,
	// 语句：getSkillDetail,
	getSkillDetail,
	// 语句：listSkills,
	listSkills,
	// 语句：saveSkill,
	saveSkill,
	// 类型：type SkillRecord,
	type SkillRecord,
	// 语句：updateSkill,
	updateSkill,
// 导入：} from '@/service';
} from '@/service';

// Skill 状态类
class SkillStore {
	// 列表
	list: SkillRecord[] = [];
	// 见下行：知识库多选
	/** 知识库助手 `/` 选中的 Skill（发送 Agent 时带 skillIds） */
	// selectedSkillIds
	selectedSkillIds: string[] = [];
	// 当前编辑 id；null=新建
	editingId: string | null = null;
	// 标题草稿
	title = '';
	// 正文草稿
	content = '';
	// 语句：loadingList = false;
	loadingList = false;
	// 语句：saving = false;
	saving = false;
	// 语句：loadingDetail = false;
	loadingDetail = false;

	// 构造函数
	constructor() {
		// 语句：makeAutoObservable(this);
		makeAutoObservable(this);
	// 结构：}
	}

	// getter：get selectedSkills(): SkillRecord[] {
	get selectedSkills(): SkillRecord[] {
		// 声明：const map = new Map(this.list.map((s) => [s.id, s]));
		const map = new Map(this.list.map((s) => [s.id, s]));
		// 返回：return this.selectedSkillIds
		return this.selectedSkillIds
			// 语句：.map((id) => map.get(id))
			.map((id) => map.get(id))
			// 语句：.filter((s): s is SkillRecord => Boolean(s));
			.filter((s): s is SkillRecord => Boolean(s));
	// 结构：}
	}

	// 拉列表
	async loadList(): Promise<void> {
		// 分支：if (this.loadingList) return;
		if (this.loadingList) return;
		// 语句：this.loadingList = true;
		this.loadingList = true;
		// 异常：try {
		try {
			// 声明：const res = await listSkills();
			const res = await listSkills();
			// 语句：runInAction(() => {
			runInAction(() => {
				// 语句：this.list = Array.isArray(res.data) ? res.data : [];
				this.list = Array.isArray(res.data) ? res.data : [];
			// 结构：});
			});
		// 语句：} catch {
		} catch {
			// 语句：Toast({ type: 'error', title: '加载 Skill 列表失败' });
			Toast({ type: 'error', title: '加载 Skill 列表失败' });
		// 语句：} finally {
		} finally {
			// 语句：runInAction(() => {
			runInAction(() => {
				// 语句：this.loadingList = false;
				this.loadingList = false;
			// 结构：});
			});
		// 结构：}
		}
	// 结构：}
	}

	// 清空为新建
	createNew(): void {
		// 语句：this.editingId = null;
		this.editingId = null;
		// 语句：this.title = '';
		this.title = '';
		// 语句：this.content = '';
		this.content = '';
	// 结构：}
	}

	// 打开：缓存预填 + 详情校准
	async openSkill(id: string): Promise<void> {
		// 声明：const cached = this.list.find((s) => s.id === id);
		const cached = this.list.find((s) => s.id === id);
		// 分支：if (cached) {
		if (cached) {
			// 语句：this.editingId = cached.id;
			this.editingId = cached.id;
			// 语句：this.title = cached.title;
			this.title = cached.title;
			// 语句：this.content = cached.content;
			this.content = cached.content;
		// 结构：}
		}
		// 语句：this.loadingDetail = true;
		this.loadingDetail = true;
		// 异常：try {
		try {
			// 声明：const res = await getSkillDetail(id);
			const res = await getSkillDetail(id);
			// 声明：const row = res.data;
			const row = res.data;
			// 分支：if (!row?.id) return;
			if (!row?.id) return;
			// 语句：runInAction(() => {
			runInAction(() => {
				// 语句：this.editingId = row.id;
				this.editingId = row.id;
				// 语句：this.title = row.title ?? '';
				this.title = row.title ?? '';
				// 语句：this.content = row.content ?? '';
				this.content = row.content ?? '';
				// 声明：const idx = this.list.findIndex((s) => s.id === row.id);
				const idx = this.list.findIndex((s) => s.id === row.id);
				// 分支：if (idx >= 0) this.list[idx] = row;
				if (idx >= 0) this.list[idx] = row;
				// 语句：else this.list = [row, ...this.list];
				else this.list = [row, ...this.list];
			// 结构：});
			});
		// 语句：} catch {
		} catch {
			// 语句：Toast({ type: 'error', title: '加载 Skill 失败' });
			Toast({ type: 'error', title: '加载 Skill 失败' });
		// 语句：} finally {
		} finally {
			// 语句：runInAction(() => {
			runInAction(() => {
				// 语句：this.loadingDetail = false;
				this.loadingDetail = false;
			// 结构：});
			});
		// 结构：}
		}
	// 结构：}
	}

	// 语句：setTitle(v: string): void {
	setTitle(v: string): void {
		// 语句：this.title = v;
		this.title = v;
	// 结构：}
	}

	// 语句：setContent(v: string): void {
	setContent(v: string): void {
		// 语句：this.content = v;
		this.content = v;
	// 结构：}
	}

	// 保存：update 或 save
	async save(): Promise<boolean> {
		// 声明：const title = this.title.trim();
		const title = this.title.trim();
		// 声明：const content = this.content.trim();
		const content = this.content.trim();
		// 分支：if (!title || !content) {
		if (!title || !content) {
			// 语句：Toast({ type: 'warning', title: '请填写标题与内容' });
			Toast({ type: 'warning', title: '请填写标题与内容' });
			// 返回：return false;
			return false;
		// 结构：}
		}
		// 分支：if (this.saving) return false;
		if (this.saving) return false;
		// 语句：this.saving = true;
		this.saving = true;
		// 异常：try {
		try {
			// 分支：if (this.editingId) {
			if (this.editingId) {
				// 声明：const res = await updateSkill(this.editingId, { title, content });
				const res = await updateSkill(this.editingId, { title, content });
				// 声明：const row = res.data;
				const row = res.data;
				// 语句：runInAction(() => {
				runInAction(() => {
					// 分支：if (row?.id) {
					if (row?.id) {
						// 声明：const idx = this.list.findIndex((s) => s.id === row.id);
						const idx = this.list.findIndex((s) => s.id === row.id);
						// 分支：if (idx >= 0) this.list[idx] = row;
						if (idx >= 0) this.list[idx] = row;
						// 语句：this.title = row.title;
						this.title = row.title;
						// 语句：this.content = row.content;
						this.content = row.content;
					// 结构：}
					}
				// 结构：});
				});
			// 分支：} else {
			} else {
				// 声明：const res = await saveSkill({ title, content });
				const res = await saveSkill({ title, content });
				// 声明：const row = res.data;
				const row = res.data;
				// 语句：runInAction(() => {
				runInAction(() => {
					// 分支：if (!row?.id) return;
					if (!row?.id) return;
					// 声明：const now = new Date().toISOString();
					const now = new Date().toISOString();
					// 声明：const next: SkillRecord = {
					const next: SkillRecord = {
						// 语句：id: row.id,
						id: row.id,
						// 语句：title: row.title ?? title,
						title: row.title ?? title,
						// 语句：content: row.content ?? content,
						content: row.content ?? content,
						// 语句：authorId: row.authorId ?? 0,
						authorId: row.authorId ?? 0,
						// 语句：createdAt: row.createdAt ?? now,
						createdAt: row.createdAt ?? now,
						// 语句：updatedAt: row.updatedAt ?? now,
						updatedAt: row.updatedAt ?? now,
					// 结构：};
					};
					// 语句：this.editingId = next.id;
					this.editingId = next.id;
					// 语句：this.list = [next, ...this.list];
					this.list = [next, ...this.list];
					// 语句：this.title = next.title;
					this.title = next.title;
					// 语句：this.content = next.content;
					this.content = next.content;
				// 结构：});
				});
			// 结构：}
			}
			// 语句：Toast({ type: 'success', title: '已保存' });
			Toast({ type: 'success', title: '已保存' });
			// 返回：return true;
			return true;
		// 语句：} catch {
		} catch {
			// 语句：Toast({ type: 'error', title: '保存失败' });
			Toast({ type: 'error', title: '保存失败' });
			// 返回：return false;
			return false;
		// 语句：} finally {
		} finally {
			// 语句：runInAction(() => {
			runInAction(() => {
				// 语句：this.saving = false;
				this.saving = false;
			// 结构：});
			});
		// 结构：}
		}
	// 结构：}
	}

	// 异步方法：async remove(id?: string): Promise<boolean> {
	async remove(id?: string): Promise<boolean> {
		// 声明：const target = (id ?? this.editingId ?? '').trim();
		const target = (id ?? this.editingId ?? '').trim();
		// 分支：if (!target) return false;
		if (!target) return false;
		// 异常：try {
		try {
			// await：await deleteSkill(target);
			await deleteSkill(target);
			// 语句：runInAction(() => {
			runInAction(() => {
				// 语句：this.list = this.list.filter((s) => s.id !== target);
				this.list = this.list.filter((s) => s.id !== target);
				// 语句：this.selectedSkillIds = this.selectedSkillIds.filter(
				this.selectedSkillIds = this.selectedSkillIds.filter(
					// 语句：(x) => x !== target,
					(x) => x !== target,
				// 结构：);
				);
				// 分支：if (this.editingId === target) this.createNew();
				if (this.editingId === target) this.createNew();
			// 结构：});
			});
			// 语句：Toast({ type: 'success', title: '已删除' });
			Toast({ type: 'success', title: '已删除' });
			// 返回：return true;
			return true;
		// 语句：} catch {
		} catch {
			// 语句：Toast({ type: 'error', title: '删除失败' });
			Toast({ type: 'error', title: '删除失败' });
			// 返回：return false;
			return false;
		// 结构：}
		}
	// 切换多选（≤8）
	}

	// 语句：toggleSelectedSkillId(id: string): void {
	toggleSelectedSkillId(id: string): void {
		// 声明：const sid = id.trim();
		const sid = id.trim();
		// 分支：if (!sid) return;
		if (!sid) return;
		// 分支：if (this.selectedSkillIds.includes(sid)) {
		if (this.selectedSkillIds.includes(sid)) {
			// 语句：this.selectedSkillIds = this.selectedSkillIds.filter((x) => x !== sid)
			this.selectedSkillIds = this.selectedSkillIds.filter((x) => x !== sid);
		// 分支：} else if (this.selectedSkillIds.length < 8) {
		} else if (this.selectedSkillIds.length < 8) {
			// 语句：this.selectedSkillIds = [...this.selectedSkillIds, sid];
			this.selectedSkillIds = [...this.selectedSkillIds, sid];
		// 结构：}
		}
	// 结构：}
	}

	// 语句：setSelectedSkillIds(ids: string[]): void {
	setSelectedSkillIds(ids: string[]): void {
		// 声明：const uniq: string[] = [];
		const uniq: string[] = [];
		// 循环：for (const id of ids) {
		for (const id of ids) {
			// 声明：const sid = (id ?? '').trim();
			const sid = (id ?? '').trim();
			// 分支：if (!sid || uniq.includes(sid)) continue;
			if (!sid || uniq.includes(sid)) continue;
			// 语句：uniq.push(sid);
			uniq.push(sid);
			// 分支：if (uniq.length >= 8) break;
			if (uniq.length >= 8) break;
		// 结构：}
		}
		// 语句：this.selectedSkillIds = uniq;
		this.selectedSkillIds = uniq;
	// 结构：}
	}

	// 语句：clearSelected(): void {
	clearSelected(): void {
		// 语句：this.selectedSkillIds = [];
		this.selectedSkillIds = [];
	// 结构：}
	}

	// 用户切换重置
	resetOnUserSwitch(): void {
		// 语句：this.list = [];
		this.list = [];
		// 语句：this.selectedSkillIds = [];
		this.selectedSkillIds = [];
		// 语句：this.editingId = null;
		this.editingId = null;
		// 语句：this.title = '';
		this.title = '';
		// 语句：this.content = '';
		this.content = '';
		// 语句：this.loadingList = false;
		this.loadingList = false;
		// 语句：this.saving = false;
		this.saving = false;
		// 语句：this.loadingDetail = false;
		this.loadingDetail = false;
	// 结构：}
	}
// 结构：}
}

// 声明：const skillStore = new SkillStore();
const skillStore = new SkillStore();
// 默认导出
export default skillStore;
````



### 4.8 前端 `skillTryStore` 关键方法

文件较长；下列为**完整符号**：`parseSkillDraft`、`refreshSessionList`、`switchSession`、`sendMessage`（内含 `createSkillTrySession` + `memorySource: 'skill_try'`）。


#### 4.8.1 `parseSkillDraft`


**改动后** · `apps/frontend/src/store/skillTry.ts`（当前，约 L70–L94）

````typescript
// 从 Agent 回复解析标题+正文，供写入 Monaco（须与气泡所见一致）
export function parseSkillDraft(raw: string): { title: string; content: string } {
	// 声明：const text = (raw ?? '').trim();
	const text = (raw ?? '').trim();
	// 分支：if (!text) return { title: '', content: '' };
	if (!text) return { title: '', content: '' };

	// 见下行源码自带注释
	// 仅当整段就是一个代码围栏时才解包；禁止摘取文中第一个 ```，否则气泡全文与写入内容会分叉
	// 声明：const wholeFence = text.match(
	const wholeFence = text.match(
		// 语句：/^```(?:skill|markdown)?\s*\r?\n([\s\S]*?)\r?\n```\s*$/i,
		/^```(?:skill|markdown)?\s*\r?\n([\s\S]*?)\r?\n```\s*$/i,
	// 结构：);
	);
	// 声明：const body = (wholeFence?.[1] ?? text).trim();
	const body = (wholeFence?.[1] ?? text).trim();

	// 声明：const heading = body.match(/^#\s+(.+?)\s*\r?\n([\s\S]*)$/);
	const heading = body.match(/^#\s+(.+?)\s*\r?\n([\s\S]*)$/);
	// 分支：if (heading) {
	if (heading) {
		// 返回：return {
		return {
			// 语句：title: heading[1].trim().slice(0, 200),
			title: heading[1].trim().slice(0, 200),
			// 语句：content: heading[2].trim(),
			content: heading[2].trim(),
		// 结构：};
		};
	// 结构：}
	}
	// 声明：const lines = body.split(/\r?\n/);
	const lines = body.split(/\r?\n/);
	// 声明：const first = (lines[0] ?? '').replace(/^#\s*/, '').trim() || '未命名 Ski
	const first = (lines[0] ?? '').replace(/^#\s*/, '').trim() || '未命名 Skill';
	// 声明：const rest = lines.slice(1).join('\n').trim();
	const rest = lines.slice(1).join('\n').trim();
	// 返回：return {
	return {
		// 语句：title: first.slice(0, 200),
		title: first.slice(0, 200),
		// 语句：content: rest || body,
		content: rest || body,
	// 结构：};
	};
// 结构：}
}
````



#### 4.8.2 `refreshSessionList`（历史列表）


**改动后** · `apps/frontend/src/store/skillTry.ts`（当前，约 L300–L357）

````typescript
	// 刷新侧栏会话列表：generate 全局；try 按 skillId
	async refreshSessionList(skillId?: string | null): Promise<void> {
		// 声明：const sid =
		const sid =
			// 语句：this.mode === 'generate'
			this.mode === 'generate'
				// 语句：? null
				? null
				// 语句：: skillId !== undefined
				: skillId !== undefined
					// 语句：? skillId?.trim() || null
					? skillId?.trim() || null
					// 语句：: this.boundSkillId;
					: this.boundSkillId;
		// 分支：if (!readToken()) {
		if (!readToken()) {
			// 语句：runInAction(() => {
			runInAction(() => {
				// 语句：this.sessionList = [];
				this.sessionList = [];
				// 语句：this.sessionsPage = { pageNo: 1, pageSize: 20, total: 0 };
				this.sessionsPage = { pageNo: 1, pageSize: 20, total: 0 };
			// 结构：});
			});
			// 语句：return;
			return;
		// 结构：}
		}
		// 分支：if (this.mode === 'try' && !sid) {
		if (this.mode === 'try' && !sid) {
			// 语句：runInAction(() => {
			runInAction(() => {
				// 语句：this.sessionList = [];
				this.sessionList = [];
				// 语句：this.sessionsPage = { pageNo: 1, pageSize: 20, total: 0 };
				this.sessionsPage = { pageNo: 1, pageSize: 20, total: 0 };
			// 结构：});
			});
			// 语句：return;
			return;
		// 结构：}
		}
		// 异常：try {
		try {
			// 语句：runInAction(() => {
			runInAction(() => {
				// 语句：this.historySessionLoading = true;
				this.historySessionLoading = true;
			// 结构：});
			});
			// 声明：const pageNo = 1;
			const pageNo = 1;
			// 声明：const pageSize = this.sessionsPage.pageSize ?? 20;
			const pageSize = this.sessionsPage.pageSize ?? 20;
			// 声明：const res = await listSkillTrySessions({
			const res = await listSkillTrySessions({
				// 语句：...(this.mode === 'try' && sid ? { skillId: sid } : {}),
				...(this.mode === 'try' && sid ? { skillId: sid } : {}),
				// 语句：kind: this.mode,
				kind: this.mode,
				// 语句：pageNo,
				pageNo,
				// 语句：pageSize,
				pageSize,
			// 结构：});
			});
			// 声明：const data = res.data;
			const data = res.data;
			// 分支：if (data?.list) {
			if (data?.list) {
				// 语句：runInAction(() => {
				runInAction(() => {
					// 语句：this.sessionList = data.list ?? [];
					this.sessionList = data.list ?? [];
					// 语句：this.sessionsPage = {
					this.sessionsPage = {
						// 语句：pageNo: data.pageNo ?? pageNo,
						pageNo: data.pageNo ?? pageNo,
						// 语句：pageSize: data.pageSize ?? pageSize,
						pageSize: data.pageSize ?? pageSize,
						// 语句：total: data.total ?? data.list?.length ?? 0,
						total: data.total ?? data.list?.length ?? 0,
					// 结构：};
					};
					// 分支：if (this.activeSessionId) {
					if (this.activeSessionId) {
						// 声明：const row = this.sessionList.find(
						const row = this.sessionList.find(
							// 语句：(s) => s.sessionId === this.activeSessionId,
							(s) => s.sessionId === this.activeSessionId,
						// 结构：);
						);
						// 分支：if (row?.title != null) this.sessionTitle = row.title;
						if (row?.title != null) this.sessionTitle = row.title;
					// 结构：}
					}
				// 结构：});
				});
			// 结构：}
			}
		// 语句：} catch {
		} catch {
			// 见下行源码自带注释
			// ignore
		// 语句：} finally {
		} finally {
			// 语句：runInAction(() => {
			runInAction(() => {
				// 语句：this.historySessionLoading = false;
				this.historySessionLoading = false;
			// 结构：});
			});
		// 结构：}
		}
	// 结构：}
	}
````



#### 4.8.3 `switchSession`（加载消息）


**改动后** · `apps/frontend/src/store/skillTry.ts`（当前，约 L445–L484）

````typescript
	// 切换展示会话；本地已有消息则不重拉、不中止其它 SSE
	async switchSession(sessionId: string): Promise<void> {
		// 分支：if (!readToken()) return;
		if (!readToken()) return;
		// 声明：const sid = (sessionId ?? '').trim();
		const sid = (sessionId ?? '').trim();
		// 分支：if (!sid) return;
		if (!sid) return;
		// 语句：runInAction(() => {
		runInAction(() => {
			// 语句：this.activeSessionId = sid;
			this.activeSessionId = sid;
			// 语句：this.rememberActiveForCurrentScope();
			this.rememberActiveForCurrentScope();
		// 结构：});
		});
		// 声明：const st = this.ensureSessionState(sid);
		const st = this.ensureSessionState(sid);
		// 分支：if (st.messages.length > 0 || st.isHistoryLoading || st.isSending) {
		if (st.messages.length > 0 || st.isHistoryLoading || st.isSending) {
			// 声明：const row = this.sessionList.find((s) => s.sessionId === sid);
			const row = this.sessionList.find((s) => s.sessionId === sid);
			// 分支：if (row?.title != null) {
			if (row?.title != null) {
				// 语句：runInAction(() => {
				runInAction(() => {
					// 语句：this.sessionTitle = row.title;
					this.sessionTitle = row.title;
				// 结构：});
				});
			// 结构：}
			}
			// 语句：return;
			return;
		// 结构：}
		}
		// 语句：runInAction(() => {
		runInAction(() => {
			// 语句：st.isHistoryLoading = true;
			st.isHistoryLoading = true;
		// 结构：});
		});
		// 异常：try {
		try {
			// 声明：const res = await getAgentSessionDetail(sid);
			const res = await getAgentSessionDetail(sid);
			// 声明：const payload = res.data;
			const payload = res.data;
			// 声明：const sess = payload?.session;
			const sess = payload?.session;
			// 语句：runInAction(() => {
			runInAction(() => {
				// 分支：if (!sess) {
				if (!sess) {
					// 语句：st.messages = [];
					st.messages = [];
					// 语句：this.sessionTitle = null;
					this.sessionTitle = null;
				// 分支：} else {
				} else {
					// 语句：this.sessionTitle = sess.title;
					this.sessionTitle = sess.title;
					// 语句：st.messages = mapApiMessagesToUi(payload.messages ?? []);
					st.messages = mapApiMessagesToUi(payload.messages ?? []);
				// 结构：}
				}
			// 结构：});
			});
		// 语句：} finally {
		} finally {
			// 语句：runInAction(() => {
			runInAction(() => {
				// 语句：st.isHistoryLoading = false;
				st.isHistoryLoading = false;
			// 结构：});
			});
		// 结构：}
		}
	// 结构：}
	}
````



#### 4.8.4 `sendMessage`（创建会话 + Agent SSE）


**改动后** · `apps/frontend/src/store/skillTry.ts`（当前，约 L517–L819）

````typescript
	// 发送入口：校验登录/skillId；懒创建会话；SSE memorySource=skill_try
	async sendMessage(
		// 语句：rawText: string,
		rawText: string,
		// 语句：options: {
		options: {
			// 语句：skillId?: string | null;
			skillId?: string | null;
			// 语句：draftTitle?: string;
			draftTitle?: string;
			// 语句：draftContent?: string;
			draftContent?: string;
		// 语句：} = {},
		} = {},
	// 语句：): Promise<void> {
	): Promise<void> {
		// 声明：const userText = (rawText ?? '').trim();
		const userText = (rawText ?? '').trim();
		// 分支：if (!userText) return;
		if (!userText) return;
		// 分支：if (!readToken()) {
		if (!readToken()) {
			// 语句：Toast({
			Toast({
				// 语句：type: 'warning',
				type: 'warning',
				// 语句：title:
				title:
					// 语句：this.mode === 'generate'
					this.mode === 'generate'
						// 语句：? '请先登录后再生成 Skill'
						? '请先登录后再生成 Skill'
						// 语句：: '请先登录后再试跑 Skill',
						: '请先登录后再试跑 Skill',
			// 结构：});
			});
			// 语句：return;
			return;
		// 结构：}
		}
		// 声明：const skillId = options.skillId?.trim() || null;
		const skillId = options.skillId?.trim() || null;
		// 声明：const isGenerate = this.mode === 'generate';
		const isGenerate = this.mode === 'generate';
		// 分支：if (!isGenerate && !skillId) {
		if (!isGenerate && !skillId) {
			// 语句：Toast({ type: 'warning', title: '请先保存 Skill 后再试跑' });
			Toast({ type: 'warning', title: '请先保存 Skill 后再试跑' });
			// 语句：return;
			return;
		// 结构：}
		}
		// 分支：if (this.isSending || this.isStreaming) {
		if (this.isSending || this.isStreaming) {
			// 语句：Toast({ type: 'warning', title: '请等待当前回复结束后再试' });
			Toast({ type: 'warning', title: '请等待当前回复结束后再试' });
			// 语句：return;
			return;
		// 结构：}
		}

		// 分支：if (!isGenerate && skillId !== this.boundSkillId) {
		if (!isGenerate && skillId !== this.boundSkillId) {
			// 语句：this.bindSkill(skillId);
			this.bindSkill(skillId);
		// 分支：} else if (isGenerate && skillId !== this.boundSkillId) {
		} else if (isGenerate && skillId !== this.boundSkillId) {
			// 语句：runInAction(() => {
			runInAction(() => {
				// 语句：this.boundSkillId = skillId;
				this.boundSkillId = skillId;
			// 结构：});
			});
		// 结构：}
		}

		// 声明：const titlePreview = userText.slice(0, 60);
		const titlePreview = userText.slice(0, 60);

		// 声明：let sid = this.activeSessionId;
		let sid = this.activeSessionId;
		// 分支：if (!sid) {
		if (!sid) {
			// 见下行源码自带注释
			// 不传 title：首条用户消息由后端 memory 写入标题；本地先用提问预览
			// 懒创建：POST /skill/session → skill_try_sessions + agent_sessions 同 id
			const res = await createSkillTrySession({
				// 创建会话 kind=generate|try
				kind: isGenerate ? 'generate' : 'try',
				// 语句：...(isGenerate || !skillId ? {} : { skillId }),
				...(isGenerate || !skillId ? {} : { skillId }),
			// 结构：});
			});
			// 语句：sid = res.data?.sessionId ?? null;
			sid = res.data?.sessionId ?? null;
			// 分支：if (!sid) {
			if (!sid) {
				// 语句：Toast({ type: 'error', title: '创建会话失败' });
				Toast({ type: 'error', title: '创建会话失败' });
				// 语句：return;
				return;
			// 结构：}
			}
			// 语句：runInAction(() => {
			runInAction(() => {
				// 语句：this.activeSessionId = sid;
				this.activeSessionId = sid;
				// 语句：this.sessionTitle = titlePreview;
				this.sessionTitle = titlePreview;
				// 语句：this.ensureSessionState(sid!);
				this.ensureSessionState(sid!);
				// 语句：this.rememberActiveForCurrentScope();
				this.rememberActiveForCurrentScope();
				// 分支：if (!this.sessionList.some((s) => s.sessionId === sid)) {
				if (!this.sessionList.some((s) => s.sessionId === sid)) {
					// 声明：const now = new Date().toISOString();
					const now = new Date().toISOString();
					// 语句：this.sessionList = [
					this.sessionList = [
						// 结构：{
						{
							// 语句：sessionId: sid!,
							sessionId: sid!,
							// 语句：title: titlePreview,
							title: titlePreview,
							// 语句：createdAt: now,
							createdAt: now,
							// 语句：updatedAt: now,
							updatedAt: now,
						// 结构：},
						},
						// 语句：...this.sessionList,
						...this.sessionList,
					// 语句：];
					];
					// 语句：this.sessionsPage.total = (this.sessionsPage.total ?? 0) + 1;
					this.sessionsPage.total = (this.sessionsPage.total ?? 0) + 1;
				// 结构：}
				}
			// 结构：});
			});
		// 分支：} else if (!this.sessionTitle?.trim()) {
		} else if (!this.sessionTitle?.trim()) {
			// 语句：this.patchSessionListTitle(sid, titlePreview);
			this.patchSessionListTitle(sid, titlePreview);
		// 结构：}
		}

		// 声明：const st = this.ensureSessionState(sid);
		const st = this.ensureSessionState(sid);
		// 见下行源码自带注释
		// 同会话重发：只中止本会话旧流
		// 语句：st.abortStream?.();
		st.abortStream?.();
		// 语句：runInAction(() => {
		runInAction(() => {
			// 语句：st.abortStream = null;
			st.abortStream = null;
			// 语句：st.isSending = true;
			st.isSending = true;
		// 结构：});
		});

		// 声明：const userChatId = uuidv4();
		const userChatId = uuidv4();
		// 声明：const assistantChatId = uuidv4();
		const assistantChatId = uuidv4();
		// 声明：let userRowId = userChatId;
		let userRowId = userChatId;
		// 声明：let assistantRowId = assistantChatId;
		let assistantRowId = assistantChatId;

		// 语句：runInAction(() => {
		runInAction(() => {
			// 语句：st.messages.push({
			st.messages.push({
				// 语句：chatId: userRowId,
				chatId: userRowId,
				// 语句：id: userChatId,
				id: userChatId,
				// 语句：role: 'user',
				role: 'user',
				// 语句：content: userText,
				content: userText,
				// 语句：timestamp: new Date(),
				timestamp: new Date(),
			// 结构：});
			});
			// 语句：st.messages.push({
			st.messages.push({
				// 语句：chatId: assistantRowId,
				chatId: assistantRowId,
				// 语句：id: assistantChatId,
				id: assistantChatId,
				// 语句：role: 'assistant',
				role: 'assistant',
				// 语句：content: '',
				content: '',
				// 语句：timestamp: new Date(),
				timestamp: new Date(),
				// 语句：isStreaming: true,
				isStreaming: true,
				// 语句：thinkContent: '',
				thinkContent: '',
			// 结构：});
			});
		// 结构：});
		});

		// 声明：let accumulated = '';
		let accumulated = '';
		// 声明：const flushAssistantPatch = () => {
		const flushAssistantPatch = () => {
			// 语句：runInAction(() => {
			runInAction(() => {
				// 声明：const idx = st.messages.findIndex((m) => m.chatId === assistantRowId);
				const idx = st.messages.findIndex((m) => m.chatId === assistantRowId);
				// 分支：if (idx < 0) return;
				if (idx < 0) return;
				// 声明：const prev = st.messages[idx] as Message;
				const prev = st.messages[idx] as Message;
				// 分支：if (prev.content === accumulated) return;
				if (prev.content === accumulated) return;
				// 见下行源码自带注释
				// 就地改 content：对齐 englishAgent，避免每 token 整表 MessageList 重渲染
				// 语句：prev.content = accumulated;
				prev.content = accumulated;
			// 结构：});
			});
		// 结构：};
		};
		// 声明：const assistantPatchScheduler =
		const assistantPatchScheduler =
			// 语句：createStreamingMobxPatchScheduler(flushAssistantPatch);
			createStreamingMobxPatchScheduler(flushAssistantPatch);

		// 声明：const patchAssistant = (delta: string) => {
		const patchAssistant = (delta: string) => {
			// 分支：if (delta) accumulated += delta;
			if (delta) accumulated += delta;
			// 语句：assistantPatchScheduler.schedule();
			assistantPatchScheduler.schedule();
		// 结构：};
		};

		// 声明：const patchAssistantOrganic = (organic: SearchOrganicItem[]) => {
		const patchAssistantOrganic = (organic: SearchOrganicItem[]) => {
			// 语句：runInAction(() => {
			runInAction(() => {
				// 声明：const idx = st.messages.findIndex((m) => m.chatId === assistantRowId);
				const idx = st.messages.findIndex((m) => m.chatId === assistantRowId);
				// 分支：if (idx < 0) return;
				if (idx < 0) return;
				// 声明：const prev = st.messages[idx] as Message;
				const prev = st.messages[idx] as Message;
				// 语句：st.messages[idx] = { ...prev, searchOrganic: organic };
				st.messages[idx] = { ...prev, searchOrganic: organic };
			// 结构：});
			});
		// 结构：};
		};

		// 声明：const draftTitle = options.draftTitle?.trim() ?? '';
		const draftTitle = options.draftTitle?.trim() ?? '';
		// 声明：const draftContent = options.draftContent?.trim() ?? '';
		const draftContent = options.draftContent?.trim() ?? '';
		// 声明：const intentPrefix =
		const intentPrefix =
			// 语句：isGenerate && (draftTitle || draftContent)
			isGenerate && (draftTitle || draftContent)
				// 语句：? `【当前编辑器草稿（可选参考，可改写）】\n标题：${draftTitle || '（空）'}\n正文：\n${draftContent
				? `【当前编辑器草稿（可选参考，可改写）】\n标题：${draftTitle || '（空）'}\n正文：\n${draftContent || '（空）'}\n`
				// 语句：: undefined;
				: undefined;

		// 声明：const streamSid = sid;
		const streamSid = sid;
		// 异常：try {
		try {
			// 启动 Agent SSE；返回 abort 供停止
			const abort = await streamAgentSse({
				// 语句：body: {
				body: {
					// 语句：sessionId: streamSid,
					sessionId: streamSid,
					// 语句：content: userText,
					content: userText,
					// 关键：显式 memorySource=skill_try，消息落 skill_try_messages
					memorySource: 'skill_try',
					// 语句：...(isGenerate
					...(isGenerate
						// 语句：? {
						? {
								// 生成模式 assistMode
								assistMode: 'skill_generate',
								// 语句：...(intentPrefix ? { intentPrefix } : {}),
								...(intentPrefix ? { intentPrefix } : {}),
							// 结构：}
							}
						// 试跑：skillIds 强制加载当前 Skill
						: { skillIds: skillId ? [skillId] : [] }),
				// 结构：},
				},
				// 语句：callbacks: {
				callbacks: {
					// 语句：onMessageIds: ({ userMessageId, assistantMessageId }) => {
					onMessageIds: ({ userMessageId, assistantMessageId }) => {
						// 语句：runInAction(() => {
						runInAction(() => {
							// 声明：const ui = st.messages.findIndex((m) => m.chatId === userRowId);
							const ui = st.messages.findIndex((m) => m.chatId === userRowId);
							// 声明：const ai = st.messages.findIndex(
							const ai = st.messages.findIndex(
								// 语句：(m) => m.chatId === assistantRowId,
								(m) => m.chatId === assistantRowId,
							// 结构：);
							);
							// 分支：if (ui >= 0) {
							if (ui >= 0) {
								// 声明：const prev = st.messages[ui] as Message;
								const prev = st.messages[ui] as Message;
								// 语句：st.messages[ui] = { ...prev, chatId: userMessageId };
								st.messages[ui] = { ...prev, chatId: userMessageId };
							// 结构：}
							}
							// 分支：if (ai >= 0) {
							if (ai >= 0) {
								// 声明：const prev = st.messages[ai] as Message;
								const prev = st.messages[ai] as Message;
								// 语句：st.messages[ai] = { ...prev, chatId: assistantMessageId };
								st.messages[ai] = { ...prev, chatId: assistantMessageId };
							// 结构：}
							}
							// 语句：userRowId = userMessageId;
							userRowId = userMessageId;
							// 语句：assistantRowId = assistantMessageId;
							assistantRowId = assistantMessageId;
						// 结构：});
						});
					// 结构：},
					},
					// 语句：onDelta: (d) => patchAssistant(d),
					onDelta: (d) => patchAssistant(d),
					// 语句：onSearchOrganic: (organic) => patchAssistantOrganic(organic),
					onSearchOrganic: (organic) => patchAssistantOrganic(organic),
					// 语句：onSkillsApplied: (skills) => {
					onSkillsApplied: (skills) => {
						// 语句：runInAction(() => {
						runInAction(() => {
							// 声明：const idx = st.messages.findIndex(
							const idx = st.messages.findIndex(
								// 语句：(m) => m.chatId === assistantRowId,
								(m) => m.chatId === assistantRowId,
							// 结构：);
							);
							// 分支：if (idx < 0) return;
							if (idx < 0) return;
							// 声明：const prev = st.messages[idx] as Message;
							const prev = st.messages[idx] as Message;
							// 语句：st.messages[idx] = { ...prev, appliedSkills: skills };
							st.messages[idx] = { ...prev, appliedSkills: skills };
						// 结构：});
						});
					// 结构：},
					},
					// 语句：onComplete: (err) => {
					onComplete: (err) => {
						// 语句：assistantPatchScheduler.flush();
						assistantPatchScheduler.flush();
						// 声明：const userAborted = err === AGENT_SSE_USER_ABORT_MARKER;
						const userAborted = err === AGENT_SSE_USER_ABORT_MARKER;
						// 声明：const finishLocal = (content: string) => {
						const finishLocal = (content: string) => {
							// 语句：runInAction(() => {
							runInAction(() => {
								// 语句：st.isSending = false;
								st.isSending = false;
								// 语句：st.abortStream = null;
								st.abortStream = null;
								// 声明：const idx = st.messages.findIndex(
								const idx = st.messages.findIndex(
									// 语句：(m) => m.chatId === assistantRowId,
									(m) => m.chatId === assistantRowId,
								// 结构：);
								);
								// 分支：if (idx < 0) return;
								if (idx < 0) return;
								// 声明：const prev = st.messages[idx] as Message;
								const prev = st.messages[idx] as Message;
								// 语句：st.messages[idx] = {
								st.messages[idx] = {
									// 语句：...prev,
									...prev,
									// 语句：content: resolveAssistantEndContent({
									content: resolveAssistantEndContent({
										// 语句：accumulated: content,
										accumulated: content,
										// 语句：prevContent: prev.content,
										prevContent: prev.content,
										// 语句：err,
										err,
									// 语句：}),
									}),
									// 语句：isStreaming: false,
									isStreaming: false,
									// 语句：...(err && !userAborted ? { isStopped: true } : {}),
									...(err && !userAborted ? { isStopped: true } : {}),
								// 结构：};
								};
							// 结构：});
							});
						// 结构：};
						};

						// 声明：const localText = accumulated.trim();
						const localText = accumulated.trim();
						// 分支：if (localText || userAborted || err) {
						if (localText || userAborted || err) {
							// 语句：finishLocal(accumulated);
							finishLocal(accumulated);
							// 语句：void this.refreshSessionList();
							void this.refreshSessionList();
							// 分支：if (err && !userAborted) {
							if (err && !userAborted) {
								// 语句：Toast({ type: 'error', title: err });
								Toast({ type: 'error', title: err });
							// 结构：}
							}
							// 语句：return;
							return;
						// 结构：}
						}

						// 见下行源码自带注释
						// 正文空且无显式错误：可能是 SSE 丢帧；尝试从服务端找回已落库内容
						// 语句：void (async () => {
						void (async () => {
							// 声明：let recovered = '';
							let recovered = '';
							// 异常：try {
							try {
								// 声明：const res = await getAgentSessionDetail(streamSid);
								const res = await getAgentSessionDetail(streamSid);
								// 声明：const list = res.data?.messages ?? [];
								const list = res.data?.messages ?? [];
								// 循环：for (let i = list.length - 1; i >= 0; i -= 1) {
								for (let i = list.length - 1; i >= 0; i -= 1) {
									// 声明：const m = list[i];
									const m = list[i];
									// 分支：if (m?.role === 'assistant' && m.content?.trim()) {
									if (m?.role === 'assistant' && m.content?.trim()) {
										// 语句：recovered = m.content;
										recovered = m.content;
										// 语句：break;
										break;
									// 结构：}
									}
								// 结构：}
								}
							// 语句：} catch {
							} catch {
								// 见下行源码自带注释
								/* ignore */
							// 结构：}
							}
							// 语句：finishLocal(recovered);
							finishLocal(recovered);
							// 语句：void this.refreshSessionList();
							void this.refreshSessionList();
							// 分支：if (!recovered.trim()) {
							if (!recovered.trim()) {
								// 语句：Toast({
								Toast({
									// 语句：type: 'warning',
									type: 'warning',
									// 语句：title: '本轮未生成文本，请重试',
									title: '本轮未生成文本，请重试',
								// 结构：});
								});
							// 结构：}
							}
						// 语句：})();
						})();
					// 结构：},
					},
					// 语句：onError: (e) => {
					onError: (e) => {
						// 语句：assistantPatchScheduler.flush();
						assistantPatchScheduler.flush();
						// 语句：runInAction(() => {
						runInAction(() => {
							// 语句：st.isSending = false;
							st.isSending = false;
							// 语句：st.abortStream = null;
							st.abortStream = null;
							// 声明：const idx = st.messages.findIndex(
							const idx = st.messages.findIndex(
								// 语句：(m) => m.chatId === assistantRowId,
								(m) => m.chatId === assistantRowId,
							// 结构：);
							);
							// 分支：if (idx >= 0) {
							if (idx >= 0) {
								// 声明：const prev = st.messages[idx] as Message;
								const prev = st.messages[idx] as Message;
								// 语句：st.messages[idx] = {
								st.messages[idx] = {
									// 语句：...prev,
									...prev,
									// 语句：isStreaming: false,
									isStreaming: false,
									// 语句：isStopped: true,
									isStopped: true,
									// 语句：content: resolveAssistantEndContent({
									content: resolveAssistantEndContent({
										// 语句：accumulated,
										accumulated,
										// 语句：prevContent: prev.content,
										prevContent: prev.content,
										// 语句：err: e.message || '请求中断',
										err: e.message || '请求中断',
									// 语句：}),
									}),
								// 结构：};
								};
							// 结构：}
							}
						// 结构：});
						});
					// 结构：},
					},
				// 结构：},
				},
			// 结构：});
			});
			// 语句：runInAction(() => {
			runInAction(() => {
				// 语句：st.abortStream = abort;
				st.abortStream = abort;
			// 结构：});
			});
		// 语句：} catch (e) {
		} catch (e) {
			// 语句：assistantPatchScheduler.flush();
			assistantPatchScheduler.flush();
			// 语句：runInAction(() => {
			runInAction(() => {
				// 语句：st.isSending = false;
				st.isSending = false;
				// 语句：st.abortStream = null;
				st.abortStream = null;
				// 声明：const idx = st.messages.findIndex((m) => m.chatId === assistantRowId);
				const idx = st.messages.findIndex((m) => m.chatId === assistantRowId);
				// 分支：if (idx >= 0) {
				if (idx >= 0) {
					// 声明：const prev = st.messages[idx] as Message;
					const prev = st.messages[idx] as Message;
					// 语句：st.messages[idx] = {
					st.messages[idx] = {
						// 语句：...prev,
						...prev,
						// 语句：isStreaming: false,
						isStreaming: false,
						// 语句：isStopped: true,
						isStopped: true,
						// 语句：content: resolveAssistantEndContent({
						content: resolveAssistantEndContent({
							// 语句：accumulated,
							accumulated,
							// 语句：prevContent: prev.content,
							prevContent: prev.content,
							// 语句：err: e instanceof Error ? e.message : '发送失败',
							err: e instanceof Error ? e.message : '发送失败',
						// 语句：}),
						}),
					// 结构：};
					};
				// 结构：}
				}
			// 结构：});
			});
			// 语句：Toast({
			Toast({
				// 语句：type: 'error',
				type: 'error',
				// 语句：title: e instanceof Error ? e.message : '发送失败',
				title: e instanceof Error ? e.message : '发送失败',
			// 结构：});
			});
		// 结构：}
		}
	// 结构：}
	}
````


**变更摘要**：首条消息懒创建会话（`createSkillTrySession`）；试跑带 `skillIds`，生成带 `assistMode`/`intentPrefix`；**固定** `memorySource: 'skill_try'`；流式就地补丁 content。


### 4.9 `SkillsPage`（完整文件）


**改动后** · `apps/frontend/src/views/skills/index.tsx`（当前，全文约 L1–L216）

````tsx
// 见下行：三栏 Skills 页
/**
 // 见下行：Resizable 列宽
 * Skills 三栏：列表 / Monaco 编辑 / 右侧 Agent 试跑（通用 Assistant 栈）。
 // 块注释结束
 * 列宽用 Resizable 可拖拽调整。
 // 见下行源码自带注释
 */
// 导入：import Confirm from '@design/Confirm';
import Confirm from '@design/Confirm';
// 导入：import { Button, Input, ScrollArea } from '@ui/index';
import { Button, Input, ScrollArea } from '@ui/index';
// 导入：import { FilePlus, NotebookPen, SaveIcon, Trash2 } from 'lucide-react'
import { FilePlus, NotebookPen, SaveIcon, Trash2 } from 'lucide-react';
// 导入：import { observer } from 'mobx-react';
import { observer } from 'mobx-react';
// 导入：import { useCallback, useEffect, useMemo, useState } from 'react';
import { useCallback, useEffect, useMemo, useState } from 'react';
// 导入：import MarkdownEditor from '@/components/design/Monaco';
import MarkdownEditor from '@/components/design/Monaco';
// 导入：import {
import {
	// 语句：ResizableHandle,
	ResizableHandle,
	// 语句：ResizablePanel,
	ResizablePanel,
	// 语句：ResizablePanelGroup,
	ResizablePanelGroup,
// 导入：} from '@/components/ui/resizable';
} from '@/components/ui/resizable';
// 导入：import { useI18n } from '@/hooks';
import { useI18n } from '@/hooks';
// 导入：import { cn } from '@/lib/utils';
import { cn } from '@/lib/utils';
// 导入：import skillStore from '@/store/skill';
import skillStore from '@/store/skill';
// 导入：import { copyToClipboard, pasteFromClipboard } from '@/utils/clipboard
import { copyToClipboard, pasteFromClipboard } from '@/utils/clipboard';
// 导入：import SkillTryPanel from './SkillTryPanel';
import SkillTryPanel from './SkillTryPanel';

// 见下行源码自带注释
/** 与知识库编辑器顶栏一致：link 按钮 + 固定图标槽 */
// 声明：const iconSlot =
const iconSlot =
	// 语句：'relative inline-flex size-4 shrink-0 items-center justify-center over
	'relative inline-flex size-4 shrink-0 items-center justify-center overflow-hidden [&_svg]:size-4';
// 声明：const linkBtn =
const linkBtn =
	// 语句：'lucide-stroke-draw-hover flex items-center gap-1 px-0! has-[>svg]:px-
	'lucide-stroke-draw-hover flex items-center gap-1 px-0! has-[>svg]:px-0! text-textcolor transition-none hover:text-teal-500 disabled:hover:text-textcolor';

// 函数：function formatUpdatedAt(raw: string): string {
function formatUpdatedAt(raw: string): string {
	// 异常：try {
	try {
		// 声明：const d = new Date(raw);
		const d = new Date(raw);
		// 分支：if (Number.isNaN(d.getTime())) return '';
		if (Number.isNaN(d.getTime())) return '';
		// 返回：return d.toLocaleString();
		return d.toLocaleString();
	// 语句：} catch {
	} catch {
		// 返回：return '';
		return '';
	// 结构：}
	}
// 结构：}
}

// observer 页面组件
const SkillsPage = observer(function SkillsPage() {
	// 声明：const { t } = useI18n();
	const { t } = useI18n();
	// 声明：const [deleteOpen, setDeleteOpen] = useState(false);
	const [deleteOpen, setDeleteOpen] = useState(false);
	// 声明：const clipboardAdapter = useMemo(
	const clipboardAdapter = useMemo(
		// 语句：() => ({ copyToClipboard, pasteFromClipboard }),
		() => ({ copyToClipboard, pasteFromClipboard }),
		// 语句：[],
		[],
	// 结构：);
	);

	// 挂载拉列表
	useEffect(() => {
		// 语句：void skillStore.loadList();
		void skillStore.loadList();
	// hook 依赖/回调闭合
	}, []);

	// 确认删除
	const onDelete = useCallback(async () => {
		// 声明：const ok = await skillStore.remove();
		const ok = await skillStore.remove();
		// 分支：if (ok) setDeleteOpen(false);
		if (ok) setDeleteOpen(false);
	// hook 依赖/回调闭合
	}, []);

	// 返回 JSX
	return (
		// JSX 标签：<div className="box-border flex h-full min-h-0 w-full min-w-0 flex-col
		<div className="box-border flex h-full min-h-0 w-full min-w-0 flex-col overflow-hidden p-5.5 pt-0">
			// 见下行 JSX 注释
			{/* defaultLayout 锁左右等宽；overflow-hidden 防止 Monaco/ChatEntry 内容撑破比例 */}
			// JSX 标签：<ResizablePanelGroup
			<ResizablePanelGroup
				// 语句：id="skills-split-v3"
				id="skills-split-v3"
				// 语句：orientation="horizontal"
				orientation="horizontal"
				// 语句：className="min-h-0 min-w-0 flex-1 gap-0"
				className="min-h-0 min-w-0 flex-1 gap-0"
				// 语句：defaultLayout={{
				defaultLayout={{
					// 语句：'skills-list': 28,
					'skills-list': 28,
					// 语句：'skills-editor': 44,
					'skills-editor': 44,
					// 语句：'skills-try': 28,
					'skills-try': 28,
				// 语句：}}
				}}
			// 结构：>
			>
				// JSX 标签：<ResizablePanel
				<ResizablePanel
					// 语句：id="skills-list"
					id="skills-list"
					// 语句：defaultSize="30%"
					defaultSize="30%"
					// 语句：className="min-h-0 min-w-0 overflow-hidden"
					className="min-h-0 min-w-0 overflow-hidden"
				// 结构：>
				>
					// JSX 标签：<aside className="flex h-full min-h-0 min-w-0 flex-col overflow-hidden
					<aside className="flex h-full min-h-0 min-w-0 flex-col overflow-hidden bg-theme-background">
						// JSX 标签：<ScrollArea className="min-h-0 flex-1">
						<ScrollArea className="min-h-0 flex-1">
							// 语句：{skillStore.list.length === 0 ? (
							{skillStore.list.length === 0 ? (
								// JSX 标签：<p className="p-3 text-sm text-textcolor/60">
								<p className="p-3 text-sm text-textcolor/60">
									// 语句：{t('skill.list.empty')}
									{t('skill.list.empty')}
								// JSX 标签：</p>
								</p>
							// 语句：) : (
							) : (
								// JSX 标签：<ul className="flex flex-col gap-0.5 p-1">
								<ul className="flex flex-col gap-0.5 p-1">
									// 语句：{skillStore.list.map((item) => (
									{skillStore.list.map((item) => (
										// JSX 标签：<li key={item.id}>
										<li key={item.id}>
											// JSX 标签：<button
											<button
												// 语句：type="button"
												type="button"
												// 语句：className={cn(
												className={cn(
													// 语句：'w-full rounded-md px-2 py-2 text-left text-sm hover:bg-theme/5',
													'w-full rounded-md px-2 py-2 text-left text-sm hover:bg-theme/5',
													// 语句：skillStore.editingId === item.id && 'bg-theme/8',
													skillStore.editingId === item.id && 'bg-theme/8',
												// 语句：)}
												)}
												// 语句：onClick={() => void skillStore.openSkill(item.id)}
												onClick={() => void skillStore.openSkill(item.id)}
											// 结构：>
											>
												// JSX 标签：<div className="truncate font-medium text-textcolor">
												<div className="truncate font-medium text-textcolor">
													// 语句：{item.title}
													{item.title}
												// JSX 标签：</div>
												</div>
												// JSX 标签：<div className="truncate text-xs text-textcolor/50">
												<div className="truncate text-xs text-textcolor/50">
													// 语句：{formatUpdatedAt(item.updatedAt)}
													{formatUpdatedAt(item.updatedAt)}
												// JSX 标签：</div>
												</div>
											// JSX 标签：</button>
											</button>
										// JSX 标签：</li>
										</li>
									// 语句：))}
									))}
								// JSX 标签：</ul>
								</ul>
							// 语句：)}
							)}
						// JSX 标签：</ScrollArea>
						</ScrollArea>
					// JSX 标签：</aside>
					</aside>
				// JSX 标签：</ResizablePanel>
				</ResizablePanel>

				// 见下行 JSX 注释
				{/* 与英语学习一致：仅 Handle 竖线，面板无外框/圆角 */}
				// JSX 标签：<ResizableHandle
				<ResizableHandle
					// 语句：withHandle
					withHandle
					// 语句：className={cn(
					className={cn(
						// 语句：'w-0 bg-transparent',
						'w-0 bg-transparent',
						// 语句：'before:bg-theme/10 before:absolute before:inset-y-0 before:left-1/2 b
						'before:bg-theme/10 before:absolute before:inset-y-0 before:left-1/2 before:w-px before:-translate-x-1/2',
					// 语句：)}
					)}
				// 结构：/>
				/>

				// JSX 标签：<ResizablePanel
				<ResizablePanel
					// 语句：id="skills-editor"
					id="skills-editor"
					// 语句：defaultSize="40%"
					defaultSize="40%"
					// 语句：className="min-h-0 min-w-0 overflow-hidden"
					className="min-h-0 min-w-0 overflow-hidden"
				// 结构：>
				>
					// JSX 标签：<section className="h-full min-h-0 min-w-0 overflow-hidden">
					<section className="h-full min-h-0 min-w-0 overflow-hidden">
						// JSX 标签：<MarkdownEditor
						<MarkdownEditor
							// 语句：className="h-full min-h-0"
							className="h-full min-h-0"
							// 语句：rounded={false}
							rounded={false}
							// 语句：value={skillStore.content}
							value={skillStore.content}
							// 语句：onChange={(v) => skillStore.setContent(v)}
							onChange={(v) => skillStore.setContent(v)}
							// 语句：height="100%"
							height="100%"
							// 语句：placeholder={t('skill.content.placeholder')}
							placeholder={t('skill.content.placeholder')}
							// 语句：documentIdentity={skillStore.editingId ?? 'skill-new'}
							documentIdentity={skillStore.editingId ?? 'skill-new'}
							// 语句：showTabBar={false}
							showTabBar={false}
							// 语句：enableMarkdownPreview={false}
							enableMarkdownPreview={false}
							// 语句：clipboardAdapter={clipboardAdapter}
							clipboardAdapter={clipboardAdapter}
							// 语句：title={
							title={
								// JSX 标签：<div className="flex flex-1 items-center pl-3">
								<div className="flex flex-1 items-center pl-3">
									// JSX 标签：<NotebookPen size={16} className="shrink-0 text-textcolor" />
									<NotebookPen size={16} className="shrink-0 text-textcolor" />
									// JSX 标签：<Input
									<Input
										// 语句：value={skillStore.title}
										value={skillStore.title}
										// 语句：onChange={(e) => skillStore.setTitle(e.target.value)}
										onChange={(e) => skillStore.setTitle(e.target.value)}
										// 语句：placeholder={t('skill.title.placeholder')}
										placeholder={t('skill.title.placeholder')}
										// 语句：maxLength={200}
										maxLength={200}
										// 语句：aria-label={t('skill.title.placeholder')}
										aria-label={t('skill.title.placeholder')}
										// 语句：className="md:text-base h-full border-0 bg-transparent pr-2 text-textc
										className="md:text-base h-full border-0 bg-transparent pr-2 text-textcolor shadow-none placeholder:text-sm placeholder:text-textcolor/60 focus-visible:border-0 focus-visible:ring-0"
									// 结构：/>
									/>
								// JSX 标签：</div>
								</div>
							// 结构：}
							}
							// 语句：toolbar={
							toolbar={
								// JSX 标签：<div className="flex items-center gap-3 pr-3">
								<div className="flex items-center gap-3 pr-3">
									// JSX 标签：<Button
									<Button
										// 语句：variant="link"
										variant="link"
										// 语句：className={linkBtn}
										className={linkBtn}
										// 语句：onClick={() => skillStore.createNew()}
										onClick={() => skillStore.createNew()}
									// 结构：>
									>
										// JSX 标签：<span className={iconSlot}>
										<span className={iconSlot}>
											// JSX 标签：<FilePlus aria-hidden />
											<FilePlus aria-hidden />
										// JSX 标签：</span>
										</span>
										// JSX 标签：<span>{t('skill.new')}</span>
										<span>{t('skill.new')}</span>
									// JSX 标签：</Button>
									</Button>
									// JSX 标签：<Button
									<Button
										// 语句：variant="link"
										variant="link"
										// 语句：className={linkBtn}
										className={linkBtn}
										// 语句：disabled={skillStore.saving}
										disabled={skillStore.saving}
										// 语句：aria-busy={skillStore.saving}
										aria-busy={skillStore.saving}
										// 语句：onClick={() => void skillStore.save()}
										onClick={() => void skillStore.save()}
									// 结构：>
									>
										// JSX 标签：<span className={iconSlot}>
										<span className={iconSlot}>
											// JSX 标签：<SaveIcon aria-hidden />
											<SaveIcon aria-hidden />
										// JSX 标签：</span>
										</span>
										// JSX 标签：<span>{t('skill.save')}</span>
										<span>{t('skill.save')}</span>
									// JSX 标签：</Button>
									</Button>
									// JSX 标签：<Button
									<Button
										// 语句：variant="link"
										variant="link"
										// 语句：className={cn(linkBtn, 'hover:text-orange-500')}
										className={cn(linkBtn, 'hover:text-orange-500')}
										// 语句：disabled={!skillStore.editingId}
										disabled={!skillStore.editingId}
										// 语句：onClick={() => setDeleteOpen(true)}
										onClick={() => setDeleteOpen(true)}
									// 结构：>
									>
										// JSX 标签：<span className={iconSlot}>
										<span className={iconSlot}>
											// JSX 标签：<Trash2 aria-hidden />
											<Trash2 aria-hidden />
										// JSX 标签：</span>
										</span>
										// JSX 标签：<span>{t('skill.delete')}</span>
										<span>{t('skill.delete')}</span>
									// JSX 标签：</Button>
									</Button>
								// JSX 标签：</div>
								</div>
							// 结构：}
							}
						// 结构：/>
						/>
					// JSX 标签：</section>
					</section>
				// JSX 标签：</ResizablePanel>
				</ResizablePanel>

				// JSX 标签：<ResizableHandle
				<ResizableHandle
					// 语句：withHandle
					withHandle
					// 语句：className={cn(
					className={cn(
						// 语句：'w-0 bg-transparent',
						'w-0 bg-transparent',
						// 语句：'before:bg-theme/10 before:absolute before:inset-y-0 before:left-1/2 b
						'before:bg-theme/10 before:absolute before:inset-y-0 before:left-1/2 before:w-px before:-translate-x-1/2',
					// 语句：)}
					)}
				// 结构：/>
				/>

				// JSX 标签：<ResizablePanel
				<ResizablePanel
					// 语句：id="skills-try"
					id="skills-try"
					// 语句：defaultSize="30%"
					defaultSize="30%"
					// 语句：className="min-h-0 min-w-0 overflow-hidden"
					className="min-h-0 min-w-0 overflow-hidden"
				// 结构：>
				>
					// JSX 标签：<SkillTryPanel />
					<SkillTryPanel />
				// JSX 标签：</ResizablePanel>
				</ResizablePanel>
			// JSX 标签：</ResizablePanelGroup>
			</ResizablePanelGroup>

			// JSX 标签：<Confirm
			<Confirm
				// 语句：open={deleteOpen}
				open={deleteOpen}
				// 语句：onOpenChange={setDeleteOpen}
				onOpenChange={setDeleteOpen}
				// 语句：title={t('skill.delete.confirmTitle')}
				title={t('skill.delete.confirmTitle')}
				// 语句：description={t('skill.delete.confirmDesc')}
				description={t('skill.delete.confirmDesc')}
				// 语句：confirmVariant="destructive"
				confirmVariant="destructive"
				// 语句：closeOnConfirm={false}
				closeOnConfirm={false}
				// 语句：onConfirm={() => void onDelete()}
				onConfirm={() => void onDelete()}
			// 结构：/>
			/>
		// JSX 标签：</div>
		</div>
	// 结构：);
	);
// 结构：});
});

// 默认导出
export default SkillsPage;
````


**变更摘要**：左列表、中 Monaco、右 `SkillTryPanel`；删除走 Confirm。


### 4.10 `SkillTryPanel`（完整文件）


**改动后** · `apps/frontend/src/views/skills/SkillTryPanel.tsx`（当前，全文约 L1–L366）

````tsx
// 见下行：试跑/生成侧栏，复用 Assistant 壳
/**
 // 块注释续
 * Skill 侧栏：试跑 / 生成（与知识库 AI/RAG 切换同款）。
 // 块注释结束
 */
// 导入：import Tooltip from '@design/Tooltip';
import Tooltip from '@design/Tooltip';
// 导入：import { Button, Toast } from '@ui/index';
import { Button, Toast } from '@ui/index';
// 导入：import { NotebookPen, Sparkles, WandSparkles } from 'lucide-react';
import { NotebookPen, Sparkles, WandSparkles } from 'lucide-react';
// 导入：import { observer } from 'mobx-react';
import { observer } from 'mobx-react';
// 导入：import {
import {
	// 类型：type RefObject,
	type RefObject,
	// 语句：useCallback,
	useCallback,
	// 语句：useEffect,
	useEffect,
	// 语句：useMemo,
	useMemo,
	// 语句：useState,
	useState,
// 导入：} from 'react';
} from 'react';
// 导入：import { useNavigate } from 'react-router';
import { useNavigate } from 'react-router';
// 导入：import {
import {
	// 语句：AssistantFooter,
	AssistantFooter,
	// 语句：AssistantMessageRow,
	AssistantMessageRow,
	// 语句：AssistantSessionEntryToolbar,
	AssistantSessionEntryToolbar,
	// 语句：AssistantShareBar,
	AssistantShareBar,
	// 语句：AssistantShell,
	AssistantShell,
	// 类型：type SelectMessageByChatId,
	type SelectMessageByChatId,
	// 语句：useAssistantShare,
	useAssistantShare,
// 导入：} from '@/components/design/Assistant';
} from '@/components/design/Assistant';
// 导入：import ChatEntry from '@/components/design/ChatEntry';
import ChatEntry from '@/components/design/ChatEntry';
// 导入：import { useAssistantSelectionSpeak } from '@/components/design/Select
import { useAssistantSelectionSpeak } from '@/components/design/SelectionSpeak';
// 导入：import { useI18n } from '@/hooks';
import { useI18n } from '@/hooks';
// 导入：import { useAssistantCopy } from '@/hooks/useAssistantCopy';
import { useAssistantCopy } from '@/hooks/useAssistantCopy';
// 导入：import { useAssistantScroll } from '@/hooks/useAssistantScroll';
import { useAssistantScroll } from '@/hooks/useAssistantScroll';
// 导入：import { cn } from '@/lib/utils';
import { cn } from '@/lib/utils';
// 导入：import useStore from '@/store';
import useStore from '@/store';
// 导入：import skillStore from '@/store/skill';
import skillStore from '@/store/skill';
// 导入：import skillTryStore, {
import skillTryStore, {
	// 类型：type SkillPanelMode,
	type SkillPanelMode,
	// 语句：parseSkillDraft,
	parseSkillDraft,
// 导入：} from '@/store/skillTry';
} from '@/store/skillTry';
// 导入：import type { Message } from '@/types/chat';
import type { Message } from '@/types/chat';

// 声明：const selectSkillTryMessageByChatId: SelectMessageByChatId = (chatId) 
const selectSkillTryMessageByChatId: SelectMessageByChatId = (chatId) =>
	// 语句：skillTryStore.messages.find((m) => m.chatId === chatId);
	skillTryStore.messages.find((m) => m.chatId === chatId);

// 声明：const MODE_ITEMS: Array<{
const MODE_ITEMS: Array<{
	// 语句：id: SkillPanelMode;
	id: SkillPanelMode;
	// 语句：labelKey: string;
	labelKey: string;
	// 语句：icon: typeof Sparkles;
	icon: typeof Sparkles;
// 语句：}> = [
}> = [
	// 语句：{ id: 'try', labelKey: 'skill.panel.mode.try', icon: Sparkles },
	{ id: 'try', labelKey: 'skill.panel.mode.try', icon: Sparkles },
	// 语句：{ id: 'generate', labelKey: 'skill.panel.mode.generate', icon: WandSpa
	{ id: 'generate', labelKey: 'skill.panel.mode.generate', icon: WandSparkles },
// 语句：];
];

// observer 面板
const SkillTryPanel = observer(function SkillTryPanel() {
	// 声明：const { t } = useI18n();
	const { t } = useI18n();
	// 声明：const navigate = useNavigate();
	const navigate = useNavigate();
	// 声明：const { userStore, knowledgeStore } = useStore();
	const { userStore, knowledgeStore } = useStore();
	// 声明：const [input, setInput] = useState('');
	const [input, setInput] = useState('');
	// 声明：const [isHistoryDrawerOpen, setIsHistoryDrawerOpen] = useState(false);
	const [isHistoryDrawerOpen, setIsHistoryDrawerOpen] = useState(false);
	// 声明：const { isCopyedId, onCopy } = useAssistantCopy();
	const { isCopyedId, onCopy } = useAssistantCopy();
	// 声明：const selectionSpeak = useAssistantSelectionSpeak();
	const selectionSpeak = useAssistantSelectionSpeak();
	// 声明：const isLoggedIn = Boolean(userStore.userInfo?.id);
	const isLoggedIn = Boolean(userStore.userInfo?.id);
	// 声明：const skillId = skillStore.editingId;
	const skillId = skillStore.editingId;
	// 声明：const mode = skillTryStore.mode;
	const mode = skillTryStore.mode;
	// 声明：const isGenerate = mode === 'generate';
	const isGenerate = mode === 'generate';
	// 声明：const aiMessages = skillTryStore.messages;
	const aiMessages = skillTryStore.messages;
	// 声明：const canUseToolbar = isLoggedIn && (isGenerate || Boolean(skillId));
	const canUseToolbar = isLoggedIn && (isGenerate || Boolean(skillId));

	// editingId 变化 → bindSkill
	useEffect(() => {
		// 语句：skillTryStore.bindSkill(skillId);
		skillTryStore.bindSkill(skillId);
	// hook 依赖/回调闭合
	}, [skillId]);

	// 登录后刷新会话列表
	useEffect(() => {
		// 分支：if (!isLoggedIn) return;
		if (!isLoggedIn) return;
		// 分支：if (mode === 'try' && !skillId) return;
		if (mode === 'try' && !skillId) return;
		// 语句：void skillTryStore.refreshSessionList(
		void skillTryStore.refreshSessionList(
			// 语句：mode === 'generate' ? null : skillId,
			mode === 'generate' ? null : skillId,
		// 结构：);
		);
	// hook 依赖/回调闭合
	}, [isLoggedIn, skillId, mode]);

	// 打开历史抽屉再刷列表
	useEffect(() => {
		// 分支：if (!isHistoryDrawerOpen || !isLoggedIn) return;
		if (!isHistoryDrawerOpen || !isLoggedIn) return;
		// 分支：if (mode === 'try' && !skillId) return;
		if (mode === 'try' && !skillId) return;
		// 语句：void skillTryStore.refreshSessionList(
		void skillTryStore.refreshSessionList(
			// 语句：mode === 'generate' ? null : skillId,
			mode === 'generate' ? null : skillId,
		// 结构：);
		);
	// hook 依赖/回调闭合
	}, [isHistoryDrawerOpen, isLoggedIn, skillId, mode]);

	// 声明：const {
	const {
		// 语句：allowAiShare,
		allowAiShare,
		// 语句：shareFlow,
		shareFlow,
		// 语句：shareSelection,
		shareSelection,
		// 语句：onShare,
		onShare,
		// 语句：setShareModelVisible,
		setShareModelVisible,
		// 语句：shareChatNode,
		shareChatNode,
	// 语句：} = useAssistantShare({
	} = useAssistantShare({
		// 语句：messages: aiMessages,
		messages: aiMessages,
		// 语句：sessionId: skillTryStore.activeSessionId,
		sessionId: skillTryStore.activeSessionId,
		// 语句：sessionType: 'agent',
		sessionType: 'agent',
		// 语句：enabled: isLoggedIn && Boolean(skillTryStore.activeSessionId),
		enabled: isLoggedIn && Boolean(skillTryStore.activeSessionId),
	// 结构：});
	});

	// 试跑：写入知识库正文并跳转
	const onSaveToKnowledge = useCallback(
		// 语句：(message: Message) => {
		(message: Message) => {
			// 声明：const body = (message.content ?? '').trim();
			const body = (message.content ?? '').trim();
			// 分支：if (!body) {
			if (!body) {
				// 语句：Toast({
				Toast({
					// 语句：type: 'warning',
					type: 'warning',
					// 语句：title: t('knowledge.assistant.noBodyToWrite'),
					title: t('knowledge.assistant.noBodyToWrite'),
				// 结构：});
				});
				// 语句：return;
				return;
			// 结构：}
			}
			// 声明：const cur = knowledgeStore.markdown.trimEnd();
			const cur = knowledgeStore.markdown.trimEnd();
			// 声明：const next = cur ? `${cur}\n\n${body}\n` : `${body}\n`;
			const next = cur ? `${cur}\n\n${body}\n` : `${body}\n`;
			// 语句：knowledgeStore.setMarkdown(next);
			knowledgeStore.setMarkdown(next);
			// 语句：navigate('/knowledge');
			navigate('/knowledge');
		// 结构：},
		},
		// 语句：[knowledgeStore, navigate, t],
		[knowledgeStore, navigate, t],
	// 结构：);
	);

	// 生成：parseSkillDraft 写回 Monaco
	const onApplyToEditor = useCallback(
		// 语句：(message: Message) => {
		(message: Message) => {
			// 声明：const raw = (message.content ?? '').trim();
			const raw = (message.content ?? '').trim();
			// 分支：if (!raw) {
			if (!raw) {
				// 语句：Toast({
				Toast({
					// 语句：type: 'warning',
					type: 'warning',
					// 语句：title: t('skill.generate.emptyApply'),
					title: t('skill.generate.emptyApply'),
				// 结构：});
				});
				// 语句：return;
				return;
			// 结构：}
			}
			// 声明：const { title, content } = parseSkillDraft(raw);
			const { title, content } = parseSkillDraft(raw);
			// 分支：if (!title.trim() || !content.trim()) {
			if (!title.trim() || !content.trim()) {
				// 语句：Toast({
				Toast({
					// 语句：type: 'warning',
					type: 'warning',
					// 语句：title: t('skill.generate.parseFail'),
					title: t('skill.generate.parseFail'),
				// 结构：});
				});
				// 语句：return;
				return;
			// 结构：}
			}
			// 语句：skillStore.setTitle(title);
			skillStore.setTitle(title);
			// 语句：skillStore.setContent(content);
			skillStore.setContent(content);
			// 语句：Toast({ type: 'success', title: t('skill.generate.applied') });
			Toast({ type: 'success', title: t('skill.generate.applied') });
		// 结构：},
		},
		// 语句：[t],
		[t],
	// 结构：);
	);

	// 声明：const idleFlushKey = useMemo((): string | null => {
	const idleFlushKey = useMemo((): string | null => {
		// 分支：if (aiMessages.length === 0) return null;
		if (aiMessages.length === 0) return null;
		// 返回：return `${skillTryStore.activeSessionId ?? 'none'}-${aiMessages.length
		return `${skillTryStore.activeSessionId ?? 'none'}-${aiMessages.length}`;
	// hook 依赖/回调闭合
	}, [aiMessages.length, skillTryStore.activeSessionId]);

	// 声明：const {
	const {
		// 语句：viewportRef: scrollViewportRef,
		viewportRef: scrollViewportRef,
		// 语句：scrollAreaHandlers,
		scrollAreaHandlers,
		// 语句：enableStickToBottom: enableStreamStickToBottom,
		enableStickToBottom: enableStreamStickToBottom,
		// 语句：flushScrollToBottom,
		flushScrollToBottom,
		// 语句：scrollFabMode,
		scrollFabMode,
		// 语句：onScrollFabClick,
		onScrollFabClick,
	// 语句：} = useAssistantScroll({
	} = useAssistantScroll({
		// 语句：messages: aiMessages,
		messages: aiMessages,
		// 语句：isStreaming: skillTryStore.isStreaming,
		isStreaming: skillTryStore.isStreaming,
		// 语句：resetKey: `skill-${mode}:${skillId ?? 'none'}:${skillTryStore.activeSe
		resetKey: `skill-${mode}:${skillId ?? 'none'}:${skillTryStore.activeSessionId ?? 'none'}`,
		// 语句：idleFlushKey,
		idleFlushKey,
	// 结构：});
	});

	// 发送：try 需 skillId；generate 可带草稿
	const sendMessage = useCallback(
		// 异步方法：async (content?: string) => {
		async (content?: string) => {
			// 声明：const text = (content ?? input).trim();
			const text = (content ?? input).trim();
			// 分支：if (!text) return;
			if (!text) return;
			// 分支：if (!isGenerate && !skillId) {
			if (!isGenerate && !skillId) {
				// 语句：Toast({ type: 'warning', title: '请先保存 Skill 后再试跑' });
				Toast({ type: 'warning', title: '请先保存 Skill 后再试跑' });
				// 语句：return;
				return;
			// 结构：}
			}
			// 分支：if (!isLoggedIn) {
			if (!isLoggedIn) {
				// 语句：Toast({
				Toast({
					// 语句：type: 'warning',
					type: 'warning',
					// 语句：title: t('knowledge.assistant.loginToUse'),
					title: t('knowledge.assistant.loginToUse'),
				// 结构：});
				});
				// 语句：return;
				return;
			// 结构：}
			}
			// 语句：setInput('');
			setInput('');
			// 语句：enableStreamStickToBottom();
			enableStreamStickToBottom();
			// await：await skillTryStore.sendMessage(text, {
			await skillTryStore.sendMessage(text, {
				// 语句：skillId,
				skillId,
				// 语句：...(isGenerate
				...(isGenerate
					// 语句：? {
					? {
							// 语句：draftTitle: skillStore.title,
							draftTitle: skillStore.title,
							// 语句：draftContent: skillStore.content,
							draftContent: skillStore.content,
						// 结构：}
						}
					// 语句：: {}),
					: {}),
			// 结构：});
			});
		// 结构：},
		},
		// 语句：[input, skillId, isLoggedIn, isGenerate, enableStreamStickToBottom, t]
		[input, skillId, isLoggedIn, isGenerate, enableStreamStickToBottom, t],
	// 结构：);
	);

	// 声明：const stopGenerating = useCallback(() => {
	const stopGenerating = useCallback(() => {
		// 语句：skillTryStore.stopGenerating();
		skillTryStore.stopGenerating();
	// hook 依赖/回调闭合
	}, []);

	// 声明：const onNewChat = useCallback(() => {
	const onNewChat = useCallback(() => {
		// 语句：selectionSpeak.stop();
		selectionSpeak.stop();
		// 语句：skillTryStore.newChat();
		skillTryStore.newChat();
		// 语句：flushScrollToBottom({ force: true });
		flushScrollToBottom({ force: true });
	// hook 依赖/回调闭合
	}, [flushScrollToBottom, selectionSpeak]);

	// 声明：const enableStickToBottomStable = useCallback(() => {
	const enableStickToBottomStable = useCallback(() => {
		// 语句：enableStreamStickToBottom();
		enableStreamStickToBottom();
	// hook 依赖/回调闭合
	}, [enableStreamStickToBottom]);

	// 声明：const flushScrollToBottomStable = useCallback(
	const flushScrollToBottomStable = useCallback(
		// 语句：(options?: { force?: boolean }) => {
		(options?: { force?: boolean }) => {
			// 语句：flushScrollToBottom(options);
			flushScrollToBottom(options);
		// 结构：},
		},
		// 语句：[flushScrollToBottom],
		[flushScrollToBottom],
	// 结构：);
	);

	// 声明：const conversationColumnActive = aiMessages.length > 0;
	const conversationColumnActive = aiMessages.length > 0;
	// 声明：const emptyHint = isGenerate
	const emptyHint = isGenerate
		// 语句：? t('skill.generate.empty')
		? t('skill.generate.empty')
		// 语句：: skillId
		: skillId
			// 语句：? t('skill.try.empty')
			? t('skill.try.empty')
			// 语句：: t('skill.try.saveFirst');
			: t('skill.try.saveFirst');

	// 声明：const assistantFooter = (
	const assistantFooter = (
		// JSX 标签：<AssistantFooter
		<AssistantFooter
			// 语句：containerClassName="px-3 pb-3"
			containerClassName="px-3 pb-3"
			// 语句：maxWidth="max-w-none"
			maxWidth="max-w-none"
			// 语句：showScrollFab={conversationColumnActive && scrollFabMode !== 'hidden'}
			showScrollFab={conversationColumnActive && scrollFabMode !== 'hidden'}
			// 语句：scrollFab={{
			scrollFab={{
				// 语句：mode: scrollFabMode,
				mode: scrollFabMode,
				// 语句：onClick: onScrollFabClick,
				onClick: onScrollFabClick,
				// 语句：toBottomLabel: t('knowledge.assistant.scrollToBottom'),
				toBottomLabel: t('knowledge.assistant.scrollToBottom'),
				// 语句：toTopLabel: t('knowledge.assistant.scrollToTop'),
				toTopLabel: t('knowledge.assistant.scrollToTop'),
				// 语句：variant: 'english',
				variant: 'english',
			// 语句：}}
			}}
			// 语句：floatAbove={selectionSpeak.floatAbove}
			floatAbove={selectionSpeak.floatAbove}
		// 结构：>
		>
			// 语句：{allowAiShare && shareSelection.isSharing ? (
			{allowAiShare && shareSelection.isSharing ? (
				// JSX 标签：<AssistantShareBar
				<AssistantShareBar
					// 语句：messages={aiMessages}
					messages={aiMessages}
					// 语句：checkboxId="skill-try-share-all"
					checkboxId="skill-try-share-all"
					// 语句：shareSelection={shareSelection}
					shareSelection={shareSelection}
					// 语句：shareFlow={shareFlow}
					shareFlow={shareFlow}
					// 语句：setShareModelVisible={setShareModelVisible}
					setShareModelVisible={setShareModelVisible}
				// 结构：/>
				/>
			// 语句：) : (
			) : (
				// JSX 标签：<ChatEntry
				<ChatEntry
					// 语句：t={t}
					t={t}
					// 语句：input={input}
					input={input}
					// 语句：setInput={setInput}
					setInput={setInput}
					// 语句：className="w-full p-0"
					className="w-full p-0"
					// 语句：textareaClassName="min-h-12 rounded-md"
					textareaClassName="min-h-12 rounded-md"
					// 语句：inputWrapClassName="border border-theme/10"
					inputWrapClassName="border border-theme/10"
					// 语句：sendMessage={sendMessage}
					sendMessage={sendMessage}
					// 语句：placeholder={
					placeholder={
						// 语句：isGenerate
						isGenerate
							// 语句：? t('skill.generate.placeholder')
							? t('skill.generate.placeholder')
							// 语句：: t('skill.try.placeholder')
							: t('skill.try.placeholder')
					// 结构：}
					}
					// 语句：disableTextInput={!isGenerate && !skillId}
					disableTextInput={!isGenerate && !skillId}
					// 语句：loading={skillTryStore.isSending}
					loading={skillTryStore.isSending}
					// 语句：stopGenerating={
					stopGenerating={
						// 语句：skillTryStore.isStreaming ? stopGenerating : undefined
						skillTryStore.isStreaming ? stopGenerating : undefined
					// 结构：}
					}
					// 语句：entryChildren={
					entryChildren={
						// JSX 标签：<AssistantSessionEntryToolbar
						<AssistantSessionEntryToolbar
							// 语句：store="skill"
							store="skill"
							// 语句：visible={isLoggedIn}
							visible={isLoggedIn}
							// 语句：showSessionActions={canUseToolbar}
							showSessionActions={canUseToolbar}
							// 语句：isSessionSwitcherLocked={false}
							isSessionSwitcherLocked={false}
							// 语句：isHistoryDrawerOpen={isHistoryDrawerOpen}
							isHistoryDrawerOpen={isHistoryDrawerOpen}
							// 语句：setIsHistoryDrawerOpen={setIsHistoryDrawerOpen}
							setIsHistoryDrawerOpen={setIsHistoryDrawerOpen}
							// 语句：enableStreamStickToBottom={enableStickToBottomStable}
							enableStreamStickToBottom={enableStickToBottomStable}
							// 语句：flushScrollToBottom={flushScrollToBottomStable}
							flushScrollToBottom={flushScrollToBottomStable}
							// 语句：onNewConversation={onNewChat}
							onNewConversation={onNewChat}
							// 语句：extraActions={MODE_ITEMS.map((item) => (
							extraActions={MODE_ITEMS.map((item) => (
								// JSX 标签：<Tooltip key={item.id} side="top" content={t(item.labelKey)}>
								<Tooltip key={item.id} side="top" content={t(item.labelKey)}>
									// JSX 标签：<Button
									<Button
										// 语句：variant="link"
										variant="link"
										// 语句：className={cn(
										className={cn(
											// 语句：'mb-0.5 h-8.5 w-8.5 mt-0.5 rounded-full border border-theme/10 p-0 [&_
											'mb-0.5 h-8.5 w-8.5 mt-0.5 rounded-full border border-theme/10 p-0 [&_svg]:overflow-visible',
											// 语句：mode === item.id
											mode === item.id
												// 语句：? 'text-teal-500 bg-theme/5'
												? 'text-teal-500 bg-theme/5'
												// 语句：: 'text-textcolor/80 hover:bg-theme/5 hover:text-teal-500',
												: 'text-textcolor/80 hover:bg-theme/5 hover:text-teal-500',
										// 语句：)}
										)}
										// 语句：aria-label={t(item.labelKey)}
										aria-label={t(item.labelKey)}
										// 语句：aria-pressed={mode === item.id}
										aria-pressed={mode === item.id}
										// 语句：onClick={() => skillTryStore.setMode(item.id)}
										onClick={() => skillTryStore.setMode(item.id)}
									// 结构：>
									>
										// JSX 标签：<item.icon className="h-4 w-4" />
										<item.icon className="h-4 w-4" />
									// JSX 标签：</Button>
									</Button>
								// JSX 标签：</Tooltip>
								</Tooltip>
							// 语句：))}
							))}
						// 结构：/>
						/>
					// 结构：}
					}
				// 结构：/>
				/>
			// 语句：)}
			)}
			// 语句：{shareChatNode}
			{shareChatNode}
		// JSX 标签：</AssistantFooter>
		</AssistantFooter>
	// 结构：);
	);

	// 返回 JSX
	return (
		// JSX 标签：<div className="relative flex h-full min-h-0 w-full min-w-0 flex-col o
		<div className="relative flex h-full min-h-0 w-full min-w-0 flex-col overflow-hidden bg-theme-background">
			// JSX 标签：<AssistantShell
			<AssistantShell
				// 语句：t={t}
				t={t}
				// 语句：isLoading={skillTryStore.isHistoryLoading}
				isLoading={skillTryStore.isHistoryLoading}
				// 语句：loadingText={t('knowledge.assistant.loadingConversation')}
				loadingText={t('knowledge.assistant.loadingConversation')}
				// 语句：hasMessages={aiMessages.length > 0}
				hasMessages={aiMessages.length > 0}
				// 语句：maxWidth="max-w-none"
				maxWidth="max-w-none"
				// 语句：messageContainerClassName="px-3 pt-3"
				messageContainerClassName="px-3 pt-3"
				// 语句：emptyState={
				emptyState={
					// JSX 标签：<div className="relative flex min-h-0 w-full flex-1 flex-col p-3">
					<div className="relative flex min-h-0 w-full flex-1 flex-col p-3">
						// JSX 标签：<div className="flex w-full items-start text-sm text-textcolor/70">
						<div className="flex w-full items-start text-sm text-textcolor/70">
							// JSX 标签：<div className="flex w-full justify-between rounded-md border border-t
							<div className="flex w-full justify-between rounded-md border border-theme/10 p-2">
								// 语句：{isGenerate ? (
								{isGenerate ? (
									// JSX 标签：<NotebookPen
									<NotebookPen
										// 语句：size={18}
										size={18}
										// 语句：className="mr-2 mt-0.5 shrink-0 text-teal-500"
										className="mr-2 mt-0.5 shrink-0 text-teal-500"
									// 结构：/>
									/>
								// 语句：) : (
								) : (
									// JSX 标签：<Sparkles
									<Sparkles
										// 语句：size={18}
										size={18}
										// 语句：className="mr-2 mt-0.5 shrink-0 text-teal-500"
										className="mr-2 mt-0.5 shrink-0 text-teal-500"
									// 结构：/>
									/>
								// 语句：)}
								)}
								// JSX 标签：<div className="flex-1 leading-relaxed">{emptyHint}</div>
								<div className="flex-1 leading-relaxed">{emptyHint}</div>
							// JSX 标签：</div>
							</div>
						// JSX 标签：</div>
						</div>
					// JSX 标签：</div>
					</div>
				// 结构：}
				}
				// 语句：viewportRef={scrollViewportRef}
				viewportRef={scrollViewportRef}
				// 语句：scrollAreaHandlers={scrollAreaHandlers}
				scrollAreaHandlers={scrollAreaHandlers}
				// 语句：messageList={aiMessages.map((message, index) => (
				messageList={aiMessages.map((message, index) => (
					// JSX 标签：<AssistantMessageRow
					<AssistantMessageRow
						// 语句：key={message.id ?? message.chatId}
						key={message.id ?? message.chatId}
						// 语句：selectMessageByChatId={selectSkillTryMessageByChatId}
						selectMessageByChatId={selectSkillTryMessageByChatId}
						// 语句：t={t}
						t={t}
						// 语句：chatId={message.chatId}
						chatId={message.chatId}
						// 语句：index={index}
						index={index}
						// 语句：messagesLength={aiMessages.length}
						messagesLength={aiMessages.length}
						// 语句：isCopyedId={isCopyedId}
						isCopyedId={isCopyedId}
						// 语句：onCopy={onCopy}
						onCopy={onCopy}
						// 语句：isLoading={skillTryStore.isSending}
						isLoading={skillTryStore.isSending}
						// 语句：onSaveToKnowledge={
						onSaveToKnowledge={
							// 语句：isGenerate ? onApplyToEditor : onSaveToKnowledge
							isGenerate ? onApplyToEditor : onSaveToKnowledge
						// 结构：}
						}
						// 语句：saveKnowledgeTitle={
						saveKnowledgeTitle={
							// 语句：isGenerate
							isGenerate
								// 语句：? t('skill.generate.applyToEditor')
								? t('skill.generate.applyToEditor')
								// 语句：: undefined
								: undefined
						// 结构：}
						}
						// 语句：allowAiShare={allowAiShare}
						allowAiShare={allowAiShare}
						// 语句：shareSelection={shareSelection}
						shareSelection={shareSelection}
						// 语句：onShare={onShare}
						onShare={onShare}
						// 语句：scrollViewportRef={
						scrollViewportRef={
							// 语句：scrollViewportRef as RefObject<HTMLElement | null>
							scrollViewportRef as RefObject<HTMLElement | null>
						// 结构：}
						}
						// 语句：getSelectionContextMenuItems={
						getSelectionContextMenuItems={
							// 语句：selectionSpeak.getSelectionContextMenuItems
							selectionSpeak.getSelectionContextMenuItems
						// 结构：}
						}
						// 语句：onSpeakContent={selectionSpeak.start}
						onSpeakContent={selectionSpeak.start}
					// 结构：/>
					/>
				// 语句：))}
				))}
				// 语句：footer={assistantFooter}
				footer={assistantFooter}
			// 结构：/>
			/>
		// JSX 标签：</div>
		</div>
	// 结构：);
	);
// 结构：});
});

// 默认导出
export default SkillTryPanel;
````


**变更摘要**：模式切换、历史抽屉、分享/朗读复用 Assistant 组件；生成消息「应用到编辑器」。


## 5. 兼容性与影响

| 项 | 说明 |
|----|------|
| 知识库 `/` Skill 对话 | **独立**：仍用 `assistant`/`agent` memorySource；共享 `skill` 表与 `skillStore` 多选字段 |
| 英语 Agent / 默认 agent | 分表路由不变；本页显式 `skill_try`，不污染其它源 |
| 旧数据 | 新表；无 Skill 存量时列表为空即可 |
| 破坏性 | 无；新增路由 `/skills` 与 API `/skill/*` |
| 鉴权 | 全接口 JWT；非作者 403 |

---

## 6. 回归建议

1. **CRUD**：新建 / 编辑保存 / 删除；删后列表与试跑历史索引消失。
2. **试跑**：未保存 Skill 发送应提示；保存后多轮 SSE；切换历史不中断其它流。
3. **生成**：全局历史不按 Skill；「应用到编辑器」解析 `# 标题`；草稿作 intentPrefix。
4. **记忆表**：一轮对话后 `skill_try_messages` 有 user/assistant；`agent_sessions.title` 有首条预览。
5. **隔离**：知识库助手带 Skill 仍写 `assistant_*`（已保存）或 `agent`（草稿），**不**写入 `skill_try_*`。
6. **路由**：`GET /skill/sessions` 与 `GET /skill/detail/:id` 无冲突。

---

## 7. 相关源码路径

| 说明 | 路径 |
|------|------|
| Skill 实体 | `apps/backend/src/services/skill/skill.entity.ts` |
| 试跑会话索引 | `apps/backend/src/services/skill/skill-try-session.entity.ts` |
| Skill 服务 | `apps/backend/src/services/skill/skill.service.ts` |
| Skill 控制器 | `apps/backend/src/services/skill/skill.controller.ts` |
| Skill 模块 | `apps/backend/src/services/skill/skill.module.ts` |
| DTO | `apps/backend/src/services/skill/dto/` |
| 记忆适配器 | `apps/backend/src/services/agent/skill-try-table-memory.ts` |
| 消息实体 | `apps/backend/src/services/agent/skill-try-message.entity.ts` |
| 管理页 | `apps/frontend/src/views/skills/index.tsx` |
| 试跑面板 | `apps/frontend/src/views/skills/SkillTryPanel.tsx` |
| skillStore | `apps/frontend/src/store/skill.ts` |
| skillTryStore | `apps/frontend/src/store/skillTry.ts` |
| API 封装 | `apps/frontend/src/service/index.ts`（Skill / session） |
| 路由 | `apps/frontend/src/router/routes.ts`（`/skills`） |
| 记忆分表文档 | `docs/agent/Agent记忆分表.md` |
| 知识库 Skill 对话 | `docs/knowledge/知识库Skill对话.md` |

---

若与仓库最新源码不一致，**以源码为准**。
