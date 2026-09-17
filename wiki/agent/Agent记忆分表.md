# Agent 记忆分表（业务消息表拆分）

> **文档角色**：实现思路专题（含改动前/后完整符号与逐行注释）  
> **延伸阅读**：
> - 落地清单：[Agent业务消息分表落地.md](./Agent业务消息分表落地.md)
> - 规划方案：[docs/ideas/agent/Agent业务消息分表.md](../ideas/agent/Agent业务消息分表.md)
> - 路径归位（2026-09-16，仅目录/import）：[业务记忆文件归位.md](./业务记忆文件归位.md) — 文内若仍写 `agent/*-table-memory.ts` 等旧路径，以归位文与当前源码为准
> - 知识库 `/` Skill：[docs/knowledge/知识库Skill对话.md](../knowledge/知识库Skill对话.md)
> - 已应用 Skill 落库：[docs/knowledge/已应用Skill落库.md](../knowledge/已应用Skill落库.md)
> - Skill 管理试跑：[docs/knowledge/Skill编辑试跑.md](../knowledge/Skill编辑试跑.md)

---

## 1. 背景与目标

原先英语学习、知识库 Skill、Skill 试跑等入口共用 `/agent/sse`，消息一律写入 `agent_messages`。结果是：

- 英语历史抽屉会扫到知识库 Skill 的运行句柄；
- 知识库助手历史与 Agent 表双写/串表风险；
- 无法按业务独立做摘要压缩与分享读库。

**目标**：保留 `/agent/sse` 作为通用推理与停流（`agent_sessions` + Redis epoch），把**多轮消息与 LangChain 历史**按 `memorySource` 落到业务表：

| memorySource | 消息表 | 典型入口 |
|---|---|---|
| `assistant` | `assistant_messages` | 知识库已保存会话 + Skill（持久化） |
| `english_learning` | `english_agent_messages` | 英语学习 Agent |
| `skill_try` | `skill_try_messages` | Skill 试跑 / 生成 |
| `agent` | `agent_messages` | 遗留句柄；**知识库草稿 ephemeral + Skill** 显式走此源，避免未建业务行时误查 |

**不做旧会话迁移**：migration 只建新表；验收以本方案下新产生会话为准。

---

## 2. 改动范围

### 新增

- `apps/backend/src/services/agent/agent-turn-memory.ts` — 记忆端口
- `apps/backend/src/services/agent/assistant-table-memory.ts` — M1 助手表实现
- `apps/backend/src/services/agent/english-table-memory.ts` — M2 英语表 + 摘要
- `apps/backend/src/services/agent/skill-try-table-memory.ts` — M3 试跑表 + 摘要
- 英语 / 试跑实体与 migration（见落地文档）

### 修改（本篇展开符号）

- `apps/backend/src/services/agent/agent-memory.service.ts` — `insertUserAndAssistantPlaceholder` 参数改为 `sessionId`
- `apps/backend/src/services/agent/agent.service.ts` — `inferMemorySource` / `resolveTurnMemory`；`createSession` / `listSessions` / `getSessionDetail` 按业务表路由
- `apps/backend/src/services/share/share.service.ts` — `sessionType=agent`：英语 → skill_try → `agent_messages`
- DTO：`memorySource` / `assistantSessionId`；前端 store 传源（见落地文档）

---

## 3. 实现思路

1. **端口化**：`AgentTurnMemory` 五方法统一「压缩 / 占位插入 / 组 LangChain 历史 / 回填 / 删对」。
2. **显式优先 + 推断兜底**：SSE 带 `memorySource`；缺省时 `inferMemorySource` 查 `english_agent_sessions` → `skill_try_sessions`，皆无则 `agent`。
3. **句柄与消息分离**：`agent_sessions.id` 仍管停流；`memorySource=assistant` 时消息写 `assistantSessionId` 对应行。
4. **英语双建会话**：`createSession(memorySource=english_learning)` 同 id 写入 `agent_sessions` + `english_agent_sessions`。
5. **列表收缩**：`listSessions` 只查英语表，避免 Skill 句柄污染历史抽屉。
6. **详情路由**：英语 → 试跑 → 遗留 `agent_messages`。
7. **分享同序**：`share.service` agent 分支同一优先级读消息。
8. **ephemeral 知识库 Skill**：前端显式 `memorySource: 'agent'`（草稿不落 assistant_*），已保存则 `assistant` + `assistantSessionId`。

```
SSE 请求
  → resolveTurnMemory(userId, dto, runSessionId)
       ├ assistant → AssistantTableMemory.forUser → assistant_*
       ├ english_learning → EnglishTableMemory → english_agent_*
       ├ skill_try → SkillTryTableMemory → skill_try_*
       └ agent → AgentMemoryService → agent_*
  → turnMemory.insert… / buildLangChain… / update…
  → 停流仍用 runSessionId（agent session）
```

---

## 4. 关键实现（改动前 / 改动后）

### 4.1 端口 `AgentTurnMemory`（新建，仅改动后）

**来源**：`apps/backend/src/services/agent/agent-turn-memory.ts` · **改动后** · 约 L1–L29，整文件

```typescript
// 类型导入 BaseMessage：LangChain 消息基类，约束历史组装返回值
import type { BaseMessage } from '@langchain/core/messages';
// 类型导入 SerperOrganicItem：联网有机结果，供 updateAssistantContent 可选落库
import type { SerperOrganicItem } from '../web-search/web-search.types';
	// 空行，分隔 import 与文件头注释

// 块注释开始：定义本端口产品语义
/**
 // 约定：流式一轮的业务记忆端口，读写与 LangChain 历史必须同源
 * Agent 流式一轮的业务记忆端口：读写与 LangChain 历史必须同源。
 // 缺省写 agent_*；知识库 Skill 用 assistant_*（见分表方案）
 * 缺省实现写 `agent_*`；知识库 Skill 用 `assistant_*`（见 Agent业务消息分表方案）。
 // 块注释结束
 */
// 导出接口 AgentTurnMemory：五方法契约，各业务表实现须对齐
export interface AgentTurnMemory {
	// compactSessionIfNeeded：超长会话摘要折叠；无摘要表可为 no-op
	compactSessionIfNeeded(businessSessionId: string): Promise<void>;
	// 空行，分隔方法签名

	// insertUserAndAssistantPlaceholder：落库用户行 + 空助手占位
	insertUserAndAssistantPlaceholder(
		// businessSessionId：业务会话主键（assistant 可与 agent 句柄分离）
		businessSessionId: string,
		// turnId：本轮 user/assistant 共享键，停流失败时按此删对
		turnId: string,
		// userContent：入库用户正文（不含仅影响模型的 intentPrefix）
		userContent: string,
	// 返回双方消息 UUID，供 SSE messageIds 与后续回填
	): Promise<{ userMessageId: string; assistantMessageId: string }>;
	// 空行

	// buildLangChainMessagesFromDb：从同源业务表组装多轮上下文
	buildLangChainMessagesFromDb(
		// 入参业务会话 id，与 insert/update 同一主键空间
		businessSessionId: string,
	// 返回 BaseMessage[] 供 Agent 图输入
	): Promise<BaseMessage[]>;
	// 空行

	// updateAssistantContent：流式结束后回填助手正文
	updateAssistantContent(
		// businessSessionId：刷新会话 updatedAt 等
		businessSessionId: string,
		// assistantMessageId：占位行主键
		assistantMessageId: string,
		// content：完整助手回复
		content: string,
		// searchOrganic 可选：有列的表可落库；assistant 可忽略
		searchOrganic?: SerperOrganicItem[] | null,
	// 无返回值
	): Promise<void>;
	// 空行

	// deleteTurnPair：按 session+turnId 删除本轮成对消息
	deleteTurnPair(businessSessionId: string, turnId: string): Promise<void>;
// 接口闭合
}
```

**变更摘要**：新建统一端口；各业务表实现与默认 `AgentMemoryService` 均对齐此契约。

### 4.2 `AssistantTableMemory`（新建，仅改动后，整文件）

**来源**：`apps/backend/src/services/agent/assistant-table-memory.ts` · **改动后** · 约 L1–L146，整文件

```typescript
// 具名运行时导入开始
import {
	// 导入符号：AIMessage
	AIMessage,
	// 导入符号：BaseMessage
	BaseMessage,
	// 导入符号：HumanMessage
	HumanMessage,
// 具名导入收口，来自 '@langchain/core/messages'
} from '@langchain/core/messages';
// 具名运行时导入开始
import { Injectable, NotFoundException } from '@nestjs/common';
// 具名运行时导入开始
import { InjectRepository } from '@nestjs/typeorm';
// 具名运行时导入开始
import { Repository } from 'typeorm';
// 具名运行时导入开始
import {
	// 导入符号：AssistantMessage
	AssistantMessage,
	// 导入符号：AssistantMessageRole
	AssistantMessageRole,
// 具名导入收口，来自 '../assistant/assistant-message.entity'
} from '../assistant/assistant-message.entity';
// 具名运行时导入开始
import { AssistantSession } from '../assistant/assistant-session.entity';
// 类型-only 具名导入开始（编译后擦除）
import type { SerperOrganicItem } from '../web-search/web-search.types';
// 类型-only 具名导入开始（编译后擦除）
import type { AgentTurnMemory } from './agent-turn-memory';
	// 空行，分隔上下逻辑块

// 常量 MAX_TAIL_MESSAGE_ROWS=48：与 Agent 尾部窗口对齐；assistant 无摘要只截尾
/** 与 Agent 默认记忆尾部窗口对齐；assistant 表暂无摘要，仅截尾 */
// 声明 const MAX_TAIL_MESSAGE_ROWS ← 48;
const MAX_TAIL_MESSAGE_ROWS = 48;
	// 空行，分隔上下逻辑块

// 类职责注释：知识库 Skill 读写 assistant_*，不写 agent_messages
/**
 // 停流 epoch 仍用请求中的 agent sessionId
 * 知识库 Skill：消息读写 `assistant_*`，供 Agent SSE 组上下文。
 // 块注释结束
 * 不写 `agent_messages`；停流 epoch 仍用请求里的 agent sessionId。
 // 块注释结束
 */
// NestJS：声明本类为可注入 Provider
@Injectable()
// 导出可注入类：AssistantTableMemory
export class AssistantTableMemory {
	// 构造函数：由 Nest DI 注入仓储与配置
	constructor(
		// TypeORM：注入实体 AssistantSession 的 Repository
		@InjectRepository(AssistantSession)
		// 私有只读依赖 `sessionRepo`，构造注入后不变
		private readonly sessionRepo: Repository<AssistantSession>,
		// TypeORM：注入实体 AssistantMessage 的 Repository
		@InjectRepository(AssistantMessage)
		// 私有只读依赖 `messageRepo`，构造注入后不变
		private readonly messageRepo: Repository<AssistantMessage>,
	// 构造函数参数列表结束并进入空函数体
	) {}
	// 空行，分隔上下逻辑块

	// 块注释开始（文件/方法语义）
	/** 按用户绑定，保证只能写本人助手会话 */
	// forUser：把 userId 闭包进端口，保证只能写本人助手会话
	forUser(userId: number): AgentTurnMemory {
		// 开始构造返回对象
		return {
			// 标注 `compactSessionIfNeeded`：(sid) => this.compactSessionIfNeeded(sid)
			compactSessionIfNeeded: (sid) => this.compactSessionIfNeeded(sid),
			// 标注 `insertUserAndAssistantPlaceholder`：(sid, turnId, content) =>
			insertUserAndAssistantPlaceholder: (sid, turnId, content) =>
				// 访问/调用实例：this.insertUserAndAssistantPlaceholder(userId, sid, turnId, content),
				this.insertUserAndAssistantPlaceholder(userId, sid, turnId, content),
			// 标注 `buildLangChainMessagesFromDb`：(sid) =>
			buildLangChainMessagesFromDb: (sid) =>
				// 访问/调用实例：this.buildLangChainMessagesFromDb(sid),
				this.buildLangChainMessagesFromDb(sid),
			// 标注 `updateAssistantContent`：(sid, msgId, content, organic) =>
			updateAssistantContent: (sid, msgId, content, organic) =>
				// 访问/调用实例：this.updateAssistantContent(sid, msgId, content, organic),
				this.updateAssistantContent(sid, msgId, content, organic),
			// 标注 `deleteTurnPair`：(sid, turnId) => this.deleteTurnPair(sid, turnId)
			deleteTurnPair: (sid, turnId) => this.deleteTurnPair(sid, turnId),
		// 结束当前调用、对象项或数组项
		};
	// 闭合当前作用域（方法/类/对象/块）
	}
	// 空行，分隔上下逻辑块

	// M1 注释：assistant 无摘要表
	/** M1：assistant 无独立摘要表，压缩为 no-op */
	// compact 空实现：直接 return
	async compactSessionIfNeeded(_businessSessionId: string): Promise<void> {
		// 代码：return;
		return;
	// 闭合当前作用域（方法/类/对象/块）
	}
	// 空行，分隔上下逻辑块

	// insert 四参：含 userId 做会话归属校验
	async insertUserAndAssistantPlaceholder(
		// 参数/字段 `userId`：number
		userId: number,
		// 参数/字段 `businessSessionId`：业务或运行会话主键（string）
		businessSessionId: string,
		// 参数/字段 `turnId`：string
		turnId: string,
		// 参数/字段 `userContent`：string
		userContent: string,
	// 方法返回类型：Promise<{ userMessageId: string; assistantMessageId: string }>
	): Promise<{ userMessageId: string; assistantMessageId: string }> {
		// 按 id+userId 查助手会话，防越权写库
		const session = await this.sessionRepo.findOne({
			// 标注 `where`：{ id: businessSessionId, userId }
			where: { id: businessSessionId, userId },
		// 代码：});
		});
		// 条件：(!session)
		if (!session) {
			// 会话不存在 → NotFoundException
			throw new NotFoundException('助手会话不存在');
		// 闭合当前作用域（方法/类/对象/块）
		}
	// 空行，分隔上下逻辑块

		// 创建 USER 角色 AssistantMessage
		const user = this.messageRepo.create({
			// 代码：session,
			session,
			// 对象属性 `role` ← AssistantMessageRole.USER
			role: AssistantMessageRole.USER,
			// 参数/字段 `content`：userContent
			content: userContent,
			// 代码：turnId,
			turnId,
		// 代码：});
		});
		// 先 save 用户行拿到 id
		await this.messageRepo.save(user);
	// 空行，分隔上下逻辑块

		// 创建 ASSISTANT 空占位，同一 turnId
		const assistant = this.messageRepo.create({
			// 代码：session,
			session,
			// 对象属性 `role` ← AssistantMessageRole.ASSISTANT
			role: AssistantMessageRole.ASSISTANT,
			// 参数/字段 `content`：''
			content: '',
			// 代码：turnId,
			turnId,
		// 代码：});
		});
		// save 助手占位
		await this.messageRepo.save(assistant);
	// 空行，分隔上下逻辑块

		// 无标题时用首句 60 字写助手会话 title
		if (!session.title?.trim()) {
			// 声明 const t ← userContent.slice(0, 60) || '新对话';
			const t = userContent.slice(0, 60) || '新对话';
			// 等待异步完成：this.sessionRepo.update({ id: session.id }, { title: t });
			await this.sessionRepo.update({ id: session.id }, { title: t });
			// 同步会话实体内存字段：session.title = t;
			session.title = t;
		// 闭合当前作用域（方法/类/对象/块）
		}
	// 空行，分隔上下逻辑块

		// 开始构造返回对象
		return { userMessageId: user.id, assistantMessageId: assistant.id };
	// 闭合当前作用域（方法/类/对象/块）
	}
	// 空行，分隔上下逻辑块

	// buildLangChain：升序拉全量再截尾
	async buildLangChainMessagesFromDb(
		// 参数/字段 `businessSessionId`：业务或运行会话主键（string）
		businessSessionId: string,
	// 方法返回类型：Promise<BaseMessage[]>
	): Promise<BaseMessage[]> {
		// 声明 const rows ← await this.messageRepo.find({
		const rows = await this.messageRepo.find({
			// 标注 `where`：{ session: { id: businessSessionId } }
			where: { session: { id: businessSessionId } },
			// 标注 `order`：{ createdAt: 'ASC' }
			order: { createdAt: 'ASC' },
			// 标注 `select`：['id', 'role', 'content', 'createdAt']
			select: ['id', 'role', 'content', 'createdAt'],
		// 代码：});
		});
		// 超长则只保留最后 48 条
		const tail =
			// 记忆窗口/压缩阈值常量：rows.length > MAX_TAIL_MESSAGE_ROWS
			rows.length > MAX_TAIL_MESSAGE_ROWS
				// 记忆窗口/压缩阈值常量：? rows.slice(-MAX_TAIL_MESSAGE_ROWS)
				? rows.slice(-MAX_TAIL_MESSAGE_ROWS)
				// 代码：: rows;
				: rows;
	// 空行，分隔上下逻辑块

		// 声明 const messages: BaseMessage[] ← [];
		const messages: BaseMessage[] = [];
		// USER → HumanMessage；非空 ASSISTANT → AIMessage
		for (const r of tail) {
			// 条件：(r.role === AssistantMessageRole.USER)
			if (r.role === AssistantMessageRole.USER) {
				// 把转换后的 LangChain 消息追加进上下文数组
				messages.push(new HumanMessage(r.content ?? ''));
			// 否则若：(
			} else if (
				// 代码：r.role === AssistantMessageRole.ASSISTANT &&
				r.role === AssistantMessageRole.ASSISTANT &&
				// 代码：(r.content ?? '').trim()
				(r.content ?? '').trim()
			// 代码：) {
			) {
				// 把转换后的 LangChain 消息追加进上下文数组
				messages.push(new AIMessage(r.content ?? ''));
			// 闭合当前作用域（方法/类/对象/块）
			}
		// 闭合当前作用域（方法/类/对象/块）
		}
		// 返回：messages;
		return messages;
	// 闭合当前作用域（方法/类/对象/块）
	}
	// 空行，分隔上下逻辑块

	// update：只更新 content；忽略 searchOrganic（表无列）
	async updateAssistantContent(
		// 参数/字段 `businessSessionId`：业务或运行会话主键（string）
		businessSessionId: string,
		// 参数/字段 `assistantMessageId`：string
		assistantMessageId: string,
		// 参数/字段 `content`：string
		content: string,
		// 标注 `_searchOrganic`：SerperOrganicItem[] | null
		_searchOrganic?: SerperOrganicItem[] | null,
	// 方法返回类型：Promise<void>
	): Promise<void> {
		// 源码注释：联网胶囊走 SSE，不落助手表
		// assistant_messages 无 search_organic 列；联网胶囊仍经 SSE 推前端，仅不落助手表
		// 声明 const now ← new Date();
		const now = new Date();
		// 等待异步完成：Promise.all([
		await Promise.all([
			// 访问/调用实例：this.messageRepo.update({ id: assistantMessageId }, { content }),
			this.messageRepo.update({ id: assistantMessageId }, { content }),
			// 访问/调用实例：this.sessionRepo.update(
			this.sessionRepo.update(
				// 代码：{ id: businessSessionId },
				{ id: businessSessionId },
				// 代码：{ updatedAt: now },
				{ updatedAt: now },
			// 结束实参列表并继续外层字面量
			),
		// 代码：]);
		]);
	// 闭合当前作用域（方法/类/对象/块）
	}
	// 空行，分隔上下逻辑块

	// 按 session_id+turn_id 删除本轮成对消息
	async deleteTurnPair(
		// 参数/字段 `businessSessionId`：业务或运行会话主键（string）
		businessSessionId: string,
		// 参数/字段 `turnId`：string
		turnId: string,
	// 方法返回类型：Promise<void>
	): Promise<void> {
		// 等待异步完成：this.messageRepo
		await this.messageRepo
			// 链式调用续行：.createQueryBuilder()
			.createQueryBuilder()
			// 链式调用续行：.delete()
			.delete()
			// 链式调用续行：.from(AssistantMessage)
			.from(AssistantMessage)
			// 链式调用续行：.where('session_id = :sid', { sid: businessSessionId })
			.where('session_id = :sid', { sid: businessSessionId })
			// 链式调用续行：.andWhere('turn_id = :tid', { tid: turnId })
			.andWhere('turn_id = :tid', { tid: turnId })
			// 链式调用续行：.execute();
			.execute();
	// 闭合当前作用域（方法/类/对象/块）
	}
// 闭合当前作用域（方法/类/对象/块）
}
```

**变更摘要**：M1；`forUser` 闭包 userId，SSE 调用形态与其它端口一致。

### 4.3 `EnglishTableMemory`（新建，仅改动后，整文件）

**来源**：`apps/backend/src/services/agent/english-table-memory.ts` · **改动后** · 约 L1–L221，整文件

```typescript
// 具名运行时导入开始
import {
	// 导入符号：AIMessage
	AIMessage,
	// 导入符号：BaseMessage
	BaseMessage,
	// 导入符号：HumanMessage
	HumanMessage,
	// 导入符号：SystemMessage
	SystemMessage,
// 具名导入收口，来自 '@langchain/core/messages'
} from '@langchain/core/messages';
// 具名运行时导入开始
import { ChatOpenAI } from '@langchain/openai';
// 具名运行时导入开始
import { Injectable } from '@nestjs/common';
// 具名运行时导入开始
import { ConfigService } from '@nestjs/config';
// 具名运行时导入开始
import { InjectRepository } from '@nestjs/typeorm';
// 具名运行时导入开始
import { ModelEnum } from 'src/enum/config.enum';
// 具名运行时导入开始
import { Repository } from 'typeorm';
// 类型-only 具名导入开始（编译后擦除）
import type { SerperOrganicItem } from '../web-search/web-search.types';
// 类型-only 具名导入开始（编译后擦除）
import type { AgentTurnMemory } from './agent-turn-memory';
// 具名运行时导入开始
import {
	// 导入符号：EnglishAgentMessage
	EnglishAgentMessage,
	// 导入符号：EnglishAgentMessageRole
	EnglishAgentMessageRole,
// 具名导入收口，来自 './english-agent-message.entity'
} from './english-agent-message.entity';
// 具名运行时导入开始
import { EnglishAgentSession } from './english-agent-session.entity';
// 具名运行时导入开始
import { EnglishAgentSessionSummary } from './english-agent-session-summary.entity';
	// 空行，分隔上下逻辑块

// 尾部保留行数 48
const MAX_TAIL_MESSAGE_ROWS = 48;
// 未折叠行数超过 56 才触发 compact
const COMPACT_ROW_THRESHOLD = 56;
	// 空行，分隔上下逻辑块

// 类注释：英语记忆写入 english_agent_*
/** 英语学习业务记忆 → english_agent_* */
// NestJS：声明本类为可注入 Provider
@Injectable()
// 导出类 EnglishTableMemory，实现 AgentTurnMemory 端口
export class EnglishTableMemory implements AgentTurnMemory {
	// 构造函数：由 Nest DI 注入仓储与配置
	constructor(
		// TypeORM：注入实体 EnglishAgentSession 的 Repository
		@InjectRepository(EnglishAgentSession)
		// 私有只读依赖 `sessionRepo`，构造注入后不变
		private readonly sessionRepo: Repository<EnglishAgentSession>,
		// TypeORM：注入实体 EnglishAgentMessage 的 Repository
		@InjectRepository(EnglishAgentMessage)
		// 私有只读依赖 `messageRepo`，构造注入后不变
		private readonly messageRepo: Repository<EnglishAgentMessage>,
		// TypeORM：注入实体 EnglishAgentSessionSummary 的 Repository
		@InjectRepository(EnglishAgentSessionSummary)
		// 私有只读依赖 `summaryRepo`，构造注入后不变
		private readonly summaryRepo: Repository<EnglishAgentSessionSummary>,
		// 私有只读依赖 `configService`，构造注入后不变
		private readonly configService: ConfigService,
	// 构造函数参数列表结束并进入空函数体
	) {}
	// 空行，分隔上下逻辑块

	// 私有方法：构建用于摘要合并的 ChatOpenAI
	private buildCompactionModel(): ChatOpenAI {
		// 声明 const apiKey ← this.configService.get<string>(ModelEnum.ZHIPU_API
		const apiKey = this.configService.get<string>(ModelEnum.ZHIPU_API_KEY);
		// 声明 const baseURL ← 
		const baseURL =
			// 访问/调用实例：this.configService.get<string>(ModelEnum.ZHIPU_BASE_URL) ||
			this.configService.get<string>(ModelEnum.ZHIPU_BASE_URL) ||
			// 字符串/模板字面量：'https://open.bigmodel.cn/api/paas/v4';
			'https://open.bigmodel.cn/api/paas/v4';
		// 声明 const modelName ← 
		const modelName =
			// 访问/调用实例：this.configService.get<string>('AGENT_SUMMARY_MODEL_NAME')?.trim() ||
			this.configService.get<string>('AGENT_SUMMARY_MODEL_NAME')?.trim() ||
			// 访问/调用实例：this.configService.get<string>(ModelEnum.SILICONFLOW_MODEL_NAME) ||
			this.configService.get<string>(ModelEnum.SILICONFLOW_MODEL_NAME) ||
			// 访问/调用实例：this.configService.get<string>(ModelEnum.ZHIPU_MODEL_NAME) ||
			this.configService.get<string>(ModelEnum.ZHIPU_MODEL_NAME) ||
			// 字符串/模板字面量：'glm-4.7';
			'glm-4.7';
		// 条件：(!apiKey)
		if (!apiKey) {
			// 抛出异常中断本路径：new Error('智谱 API 密钥未配置（ZHIPU_API_KEY）');
			throw new Error('智谱 API 密钥未配置（ZHIPU_API_KEY）');
		// 闭合当前作用域（方法/类/对象/块）
		}
		// 返回：new ChatOpenAI({
		return new ChatOpenAI({
			// 代码：apiKey,
			apiKey,
			// 代码：modelName,
			modelName,
			// 对象属性 `temperature` ← 0.2
			temperature: 0.2,
			// 对象属性 `maxTokens` ← 2048
			maxTokens: 2048,
			// 对象属性 `configuration` ← { baseURL }
			configuration: { baseURL },
			// 对象属性 `streaming` ← false
			streaming: false,
			// 对象属性 `modelKwargs` ← { thinking: { type: 'disabled' as const } }
			modelKwargs: { thinking: { type: 'disabled' as const } },
		// 代码：});
		});
	// 闭合当前作用域（方法/类/对象/块）
	}
	// 空行，分隔上下逻辑块

	// compact：按 coversBeforeAt 水印只折叠增量行
	async compactSessionIfNeeded(sessionId: string): Promise<void> {
		// 声明 const summaryRow ← 
		const summaryRow =
			// 代码：(await this.summaryRepo.findOne({ where: { sessionId } })) ??
			(await this.summaryRepo.findOne({ where: { sessionId } })) ??
			// 访问/调用实例：this.summaryRepo.create({
			this.summaryRepo.create({
				// 代码：sessionId,
				sessionId,
				// 标注 `summary`：''
				summary: '',
				// 标注 `coversBeforeAt`：null
				coversBeforeAt: null,
			// 代码：});
			});
	// 空行，分隔上下逻辑块

		// 声明 const qb ← this.messageRepo
		const qb = this.messageRepo
			// 链式调用续行：.createQueryBuilder('m')
			.createQueryBuilder('m')
			// 链式调用续行：.where('m.session_id = :sid', { sid: sessionId })
			.where('m.session_id = :sid', { sid: sessionId })
			// 链式调用续行：.orderBy('m.created_at', 'ASC');
			.orderBy('m.created_at', 'ASC');
		// 条件：(summaryRow.coversBeforeAt)
		if (summaryRow.coversBeforeAt) {
			// 代码：qb.andWhere('m.created_at > :t', { t: summaryRow.coversBeforeAt });
			qb.andWhere('m.created_at > :t', { t: summaryRow.coversBeforeAt });
		// 闭合当前作用域（方法/类/对象/块）
		}
		// 声明 const rows ← await qb.getMany();
		const rows = await qb.getMany();
		// 未超阈值则直接返回
		if (rows.length <= COMPACT_ROW_THRESHOLD) return;
		// 声明 const foldCount ← rows.length - MAX_TAIL_MESSAGE_ROWS;
		const foldCount = rows.length - MAX_TAIL_MESSAGE_ROWS;
		// 条件：(foldCount <= 0) return;
		if (foldCount <= 0) return;
	// 空行，分隔上下逻辑块

		// 声明 const toFold ← rows.slice(0, foldCount);
		const toFold = rows.slice(0, foldCount);
		// 声明 const transcript ← toFold
		const transcript = toFold
			// 链式调用续行：.map((r) => {
			.map((r) => {
				// 声明 const tag ← 
				const tag =
					// 代码：r.role === EnglishAgentMessageRole.USER ? '用户' : '助手';
					r.role === EnglishAgentMessageRole.USER ? '用户' : '助手';
				// 返回：`${tag}: ${r.content ?? ''}`;
				return `${tag}: ${r.content ?? ''}`;
			// 代码：})
			})
			// 链式调用续行：.join('\n');
			.join('\n');
		// 调用摘要模型合并「已有摘要+新增片段」
		const merged = await this.buildCompactionModel().invoke([
			// 实例化：SystemMessage(
			new SystemMessage(
				// 字符串/模板字面量：'你是摘要助手。将「已有摘要」与「新增对话片段」合并为一条连贯的中文摘要，保留事实、结论与用户偏好；省略寒暄，控制在约 2000 字以内。',
				'你是摘要助手。将「已有摘要」与「新增对话片段」合并为一条连贯的中文摘要，保留事实、结论与用户偏好；省略寒暄，控制在约 2000 字以内。',
			// 结束实参列表并继续外层字面量
			),
			// 实例化：HumanMessage(
			new HumanMessage(
				// 字符串/模板字面量：`已有摘要：\n${summaryRow.summary?.trim() || '（无）'}\n\n新增片段：\n${transcript}`,
				`已有摘要：\n${summaryRow.summary?.trim() || '（无）'}\n\n新增片段：\n${transcript}`,
			// 结束实参列表并继续外层字面量
			),
		// 代码：]);
		]);
		// 声明 const text ← 
		const text =
			// 运行时类型判别：typeof merged.content === 'string'
			typeof merged.content === 'string'
				// 代码：? merged.content
				? merged.content
				// 运行时类型判别：: Array.isArray(merged.content)
				: Array.isArray(merged.content)
					// 代码：? merged.content
					? merged.content
							// 链式调用续行：.map((c: any) => (typeof c?.text === 'string' ? c.text : ''))
							.map((c: any) => (typeof c?.text === 'string' ? c.text : ''))
							// 链式调用续行：.join('')
							.join('')
					// 代码：: String(merged.content ?? '');
					: String(merged.content ?? '');
		// 更新摘要行：summaryRow.summary = text.trim();
		summaryRow.summary = text.trim();
		// 更新摘要行：summaryRow.coversBeforeAt = toFold[toFold.length - 1]!.createdAt;
		summaryRow.coversBeforeAt = toFold[toFold.length - 1]!.createdAt;
		// 等待异步完成：this.summaryRepo.save(summaryRow);
		await this.summaryRepo.save(summaryRow);
	// 闭合当前作用域（方法/类/对象/块）
	}
	// 空行，分隔上下逻辑块

	// buildLangChain：先推 System 摘要再拼对话
	async buildLangChainMessagesFromDb(
		// 参数/字段 `sessionId`：业务或运行会话主键（string）
		sessionId: string,
	// 方法返回类型：Promise<BaseMessage[]>
	): Promise<BaseMessage[]> {
		// 声明 const summaryRow ← await this.summaryRepo.findOne({
		const summaryRow = await this.summaryRepo.findOne({
			// 标注 `where`：{ sessionId }
			where: { sessionId },
		// 代码：});
		});
		// 声明 const qb ← this.messageRepo
		const qb = this.messageRepo
			// 链式调用续行：.createQueryBuilder('m')
			.createQueryBuilder('m')
			// 链式调用续行：.where('m.session_id = :sid', { sid: sessionId })
			.where('m.session_id = :sid', { sid: sessionId })
			// 链式调用续行：.orderBy('m.created_at', 'ASC');
			.orderBy('m.created_at', 'ASC');
		// 条件：(summaryRow?.coversBeforeAt)
		if (summaryRow?.coversBeforeAt) {
			// 代码：qb.andWhere('m.created_at > :t', { t: summaryRow.coversBeforeAt });
			qb.andWhere('m.created_at > :t', { t: summaryRow.coversBeforeAt });
		// 闭合当前作用域（方法/类/对象/块）
		}
		// 声明 const rows ← await qb.getMany();
		const rows = await qb.getMany();
		// 声明 const messages: BaseMessage[] ← [];
		const messages: BaseMessage[] = [];
		// 条件：(summaryRow?.summary?.trim())
		if (summaryRow?.summary?.trim()) {
			// 把转换后的 LangChain 消息追加进上下文数组
			messages.push(
				// 实例化：SystemMessage(
				new SystemMessage(
					// 字符串/模板字面量：`以下为更早对话的摘要（水印折叠），请视作上下文的一部分：\n${summaryRow.summary.trim()}`,
					`以下为更早对话的摘要（水印折叠），请视作上下文的一部分：\n${summaryRow.summary.trim()}`,
				// 结束实参列表并继续外层字面量
				),
			// 结束当前调用、对象项或数组项
			);
		// 闭合当前作用域（方法/类/对象/块）
		}
		// 循环：(const r of rows)
		for (const r of rows) {
			// 条件：(r.role === EnglishAgentMessageRole.USER)
			if (r.role === EnglishAgentMessageRole.USER) {
				// 把转换后的 LangChain 消息追加进上下文数组
				messages.push(new HumanMessage(r.content ?? ''));
			// 否则若：(
			} else if (
				// 代码：r.role === EnglishAgentMessageRole.ASSISTANT &&
				r.role === EnglishAgentMessageRole.ASSISTANT &&
				// 代码：(r.content ?? '').trim()
				(r.content ?? '').trim()
			// 代码：) {
			) {
				// 把转换后的 LangChain 消息追加进上下文数组
				messages.push(new AIMessage(r.content ?? ''));
			// 闭合当前作用域（方法/类/对象/块）
			}
		// 闭合当前作用域（方法/类/对象/块）
		}
		// 返回：messages;
		return messages;
	// 闭合当前作用域（方法/类/对象/块）
	}
	// 空行，分隔上下逻辑块

	// insert：写入英语消息并可回填英语会话标题
	async insertUserAndAssistantPlaceholder(
		// 参数/字段 `sessionId`：业务或运行会话主键（string）
		sessionId: string,
		// 参数/字段 `turnId`：string
		turnId: string,
		// 参数/字段 `userContent`：string
		userContent: string,
	// 方法返回类型：Promise<{ userMessageId: string; assistantMessageId: string }>
	): Promise<{ userMessageId: string; assistantMessageId: string }> {
		// 声明 const session ← await this.sessionRepo.findOne({
		const session = await this.sessionRepo.findOne({
			// 标注 `where`：{ id: sessionId }
			where: { id: sessionId },
		// 代码：});
		});
		// 条件：(!session)
		if (!session) {
			// 抛出异常中断本路径：new Error(`英语学习会话不存在: ${sessionId}`);
			throw new Error(`英语学习会话不存在: ${sessionId}`);
		// 闭合当前作用域（方法/类/对象/块）
		}
		// 声明 const user ← this.messageRepo.create({
		const user = this.messageRepo.create({
			// 代码：session,
			session,
			// 对象属性 `role` ← EnglishAgentMessageRole.USER
			role: EnglishAgentMessageRole.USER,
			// 参数/字段 `content`：userContent
			content: userContent,
			// 代码：turnId,
			turnId,
		// 代码：});
		});
		// 等待异步完成：this.messageRepo.save(user);
		await this.messageRepo.save(user);
		// 声明 const assistant ← this.messageRepo.create({
		const assistant = this.messageRepo.create({
			// 代码：session,
			session,
			// 对象属性 `role` ← EnglishAgentMessageRole.ASSISTANT
			role: EnglishAgentMessageRole.ASSISTANT,
			// 参数/字段 `content`：''
			content: '',
			// 代码：turnId,
			turnId,
		// 代码：});
		});
		// 等待异步完成：this.messageRepo.save(assistant);
		await this.messageRepo.save(assistant);
		// 条件：(!session.title?.trim())
		if (!session.title?.trim()) {
			// 声明 const t ← userContent.slice(0, 60) || '新对话';
			const t = userContent.slice(0, 60) || '新对话';
			// 等待异步完成：this.sessionRepo.update({ id: session.id }, { title: t });
			await this.sessionRepo.update({ id: session.id }, { title: t });
			// 同步会话实体内存字段：session.title = t;
			session.title = t;
		// 闭合当前作用域（方法/类/对象/块）
		}
		// 开始构造返回对象
		return { userMessageId: user.id, assistantMessageId: assistant.id };
	// 闭合当前作用域（方法/类/对象/块）
	}
	// 空行，分隔上下逻辑块

	// update：可附带 searchOrganic JSON
	async updateAssistantContent(
		// 参数/字段 `sessionId`：业务或运行会话主键（string）
		sessionId: string,
		// 参数/字段 `assistantMessageId`：string
		assistantMessageId: string,
		// 参数/字段 `content`：string
		content: string,
		// 参数/字段 `searchOrganic`：SerperOrganicItem[] | null
		searchOrganic?: SerperOrganicItem[] | null,
	// 方法返回类型：Promise<void>
	): Promise<void> {
		// 声明 const now ← new Date();
		const now = new Date();
		// 声明 const patch: {
		const patch: {
			// 参数/字段 `content`：string;
			content: string;
			// 参数/字段 `searchOrganic`：SerperOrganicItem[] | null;
			searchOrganic?: SerperOrganicItem[] | null;
		// 代码：} = { content };
		} = { content };
		// 条件：(searchOrganic !== undefined)
		if (searchOrganic !== undefined) {
			// 写入更新补丁：patch.searchOrganic = searchOrganic;
			patch.searchOrganic = searchOrganic;
		// 闭合当前作用域（方法/类/对象/块）
		}
		// 等待异步完成：Promise.all([
		await Promise.all([
			// 访问/调用实例：this.messageRepo.update({ id: assistantMessageId }, patch),
			this.messageRepo.update({ id: assistantMessageId }, patch),
			// 访问/调用实例：this.sessionRepo.update({ id: sessionId }, { updatedAt: now }),
			this.sessionRepo.update({ id: sessionId }, { updatedAt: now }),
		// 代码：]);
		]);
	// 闭合当前作用域（方法/类/对象/块）
	}
	// 空行，分隔上下逻辑块

	// deleteTurnPair：删英语消息对
	async deleteTurnPair(sessionId: string, turnId: string): Promise<void> {
		// 等待异步完成：this.messageRepo
		await this.messageRepo
			// 链式调用续行：.createQueryBuilder()
			.createQueryBuilder()
			// 链式调用续行：.delete()
			.delete()
			// 链式调用续行：.from(EnglishAgentMessage)
			.from(EnglishAgentMessage)
			// 链式调用续行：.where('session_id = :sid', { sid: sessionId })
			.where('session_id = :sid', { sid: sessionId })
			// 链式调用续行：.andWhere('turn_id = :tid', { tid: turnId })
			.andWhere('turn_id = :tid', { tid: turnId })
			// 链式调用续行：.execute();
			.execute();
	// 闭合当前作用域（方法/类/对象/块）
	}
	// 空行，分隔上下逻辑块

	// listMessagesAsc：详情/分享升序投影
	async listMessagesAsc(sessionId: string) {
		// 返回：this.messageRepo.find({
		return this.messageRepo.find({
			// 标注 `where`：{ session: { id: sessionId } }
			where: { session: { id: sessionId } },
			// 标注 `order`：{ createdAt: 'ASC' }
			order: { createdAt: 'ASC' },
			// 标注 `select`：['id', 'turnId', 'role', 'content', 'searchOrganic', 'create
			select: ['id', 'turnId', 'role', 'content', 'searchOrganic', 'createdAt'],
		// 代码：});
		});
	// 闭合当前作用域（方法/类/对象/块）
	}
	// 空行，分隔上下逻辑块

	// deleteSummary：删除摘要行
	async deleteSummary(sessionId: string): Promise<void> {
		// 等待异步完成：this.summaryRepo.delete({ sessionId });
		await this.summaryRepo.delete({ sessionId });
	// 闭合当前作用域（方法/类/对象/块）
	}
// 闭合当前作用域（方法/类/对象/块）
}
```

**变更摘要**：M2 含水印摘要；会话 id 与 `agent_sessions` 对齐以便停流。

### 4.4 `SkillTryTableMemory`（新建，仅改动后，整文件）

**来源**：`apps/backend/src/services/agent/skill-try-table-memory.ts` · **改动后** · 约 L1–L230，整文件

```typescript
// 具名运行时导入开始
import {
	// 导入符号：AIMessage
	AIMessage,
	// 导入符号：BaseMessage
	BaseMessage,
	// 导入符号：HumanMessage
	HumanMessage,
	// 导入符号：SystemMessage
	SystemMessage,
// 具名导入收口，来自 '@langchain/core/messages'
} from '@langchain/core/messages';
// 具名运行时导入开始
import { ChatOpenAI } from '@langchain/openai';
// 具名运行时导入开始
import { Injectable } from '@nestjs/common';
// 具名运行时导入开始
import { ConfigService } from '@nestjs/config';
// 具名运行时导入开始
import { InjectRepository } from '@nestjs/typeorm';
// 具名运行时导入开始
import { ModelEnum } from 'src/enum/config.enum';
// 具名运行时导入开始
import { Repository } from 'typeorm';
// 具名运行时导入开始
import { SkillTrySession } from '../skill/skill-try-session.entity';
// 类型-only 具名导入开始（编译后擦除）
import type { SerperOrganicItem } from '../web-search/web-search.types';
// 具名运行时导入开始
import { AgentSession } from './agent-session.entity';
// 类型-only 具名导入开始（编译后擦除）
import type { AgentTurnMemory } from './agent-turn-memory';
// 具名运行时导入开始
import {
	// 导入符号：SkillTryMessage
	SkillTryMessage,
	// 导入符号：SkillTryMessageRole
	SkillTryMessageRole,
// 具名导入收口，来自 './skill-try-message.entity'
} from './skill-try-message.entity';
// 具名运行时导入开始
import { SkillTrySessionSummary } from './skill-try-session-summary.entity';
	// 空行，分隔上下逻辑块

// 尾部窗口 48
const MAX_TAIL_MESSAGE_ROWS = 48;
// 压缩阈值 56
const COMPACT_ROW_THRESHOLD = 56;
	// 空行，分隔上下逻辑块

// 类注释：试跑消息在 skill_try_messages；标题仍在 agent_sessions
/** Skill 试跑/生成业务记忆 → skill_try_messages（标题仍在 agent_sessions） */
// NestJS：声明本类为可注入 Provider
@Injectable()
// 导出类 SkillTryTableMemory，实现 AgentTurnMemory 端口
export class SkillTryTableMemory implements AgentTurnMemory {
	// 构造函数：由 Nest DI 注入仓储与配置
	constructor(
		// TypeORM：注入实体 SkillTrySession 的 Repository
		@InjectRepository(SkillTrySession)
		// 私有只读依赖 `trySessionRepo`，构造注入后不变
		private readonly trySessionRepo: Repository<SkillTrySession>,
		// TypeORM：注入实体 SkillTryMessage 的 Repository
		@InjectRepository(SkillTryMessage)
		// 私有只读依赖 `messageRepo`，构造注入后不变
		private readonly messageRepo: Repository<SkillTryMessage>,
		// TypeORM：注入实体 SkillTrySessionSummary 的 Repository
		@InjectRepository(SkillTrySessionSummary)
		// 私有只读依赖 `summaryRepo`，构造注入后不变
		private readonly summaryRepo: Repository<SkillTrySessionSummary>,
		// TypeORM：注入实体 AgentSession 的 Repository
		@InjectRepository(AgentSession)
		// 私有只读依赖 `agentSessionRepo`，构造注入后不变
		private readonly agentSessionRepo: Repository<AgentSession>,
		// 私有只读依赖 `configService`，构造注入后不变
		private readonly configService: ConfigService,
	// 构造函数参数列表结束并进入空函数体
	) {}
	// 空行，分隔上下逻辑块

	// 摘要模型构建（与英语实现同构）
	private buildCompactionModel(): ChatOpenAI {
		// 声明 const apiKey ← this.configService.get<string>(ModelEnum.ZHIPU_API
		const apiKey = this.configService.get<string>(ModelEnum.ZHIPU_API_KEY);
		// 声明 const baseURL ← 
		const baseURL =
			// 访问/调用实例：this.configService.get<string>(ModelEnum.ZHIPU_BASE_URL) ||
			this.configService.get<string>(ModelEnum.ZHIPU_BASE_URL) ||
			// 字符串/模板字面量：'https://open.bigmodel.cn/api/paas/v4';
			'https://open.bigmodel.cn/api/paas/v4';
		// 声明 const modelName ← 
		const modelName =
			// 访问/调用实例：this.configService.get<string>('AGENT_SUMMARY_MODEL_NAME')?.trim() ||
			this.configService.get<string>('AGENT_SUMMARY_MODEL_NAME')?.trim() ||
			// 访问/调用实例：this.configService.get<string>(ModelEnum.SILICONFLOW_MODEL_NAME) ||
			this.configService.get<string>(ModelEnum.SILICONFLOW_MODEL_NAME) ||
			// 访问/调用实例：this.configService.get<string>(ModelEnum.ZHIPU_MODEL_NAME) ||
			this.configService.get<string>(ModelEnum.ZHIPU_MODEL_NAME) ||
			// 字符串/模板字面量：'glm-4.7';
			'glm-4.7';
		// 条件：(!apiKey)
		if (!apiKey) {
			// 抛出异常中断本路径：new Error('智谱 API 密钥未配置（ZHIPU_API_KEY）');
			throw new Error('智谱 API 密钥未配置（ZHIPU_API_KEY）');
		// 闭合当前作用域（方法/类/对象/块）
		}
		// 返回：new ChatOpenAI({
		return new ChatOpenAI({
			// 代码：apiKey,
			apiKey,
			// 代码：modelName,
			modelName,
			// 对象属性 `temperature` ← 0.2
			temperature: 0.2,
			// 对象属性 `maxTokens` ← 2048
			maxTokens: 2048,
			// 对象属性 `configuration` ← { baseURL }
			configuration: { baseURL },
			// 对象属性 `streaming` ← false
			streaming: false,
			// 对象属性 `modelKwargs` ← { thinking: { type: 'disabled' as const } }
			modelKwargs: { thinking: { type: 'disabled' as const } },
		// 代码：});
		});
	// 闭合当前作用域（方法/类/对象/块）
	}
	// 空行，分隔上下逻辑块

	// compact 写入 skill_try_session_summaries
	async compactSessionIfNeeded(sessionId: string): Promise<void> {
		// 声明 const summaryRow ← 
		const summaryRow =
			// 代码：(await this.summaryRepo.findOne({ where: { sessionId } })) ??
			(await this.summaryRepo.findOne({ where: { sessionId } })) ??
			// 访问/调用实例：this.summaryRepo.create({
			this.summaryRepo.create({
				// 代码：sessionId,
				sessionId,
				// 标注 `summary`：''
				summary: '',
				// 标注 `coversBeforeAt`：null
				coversBeforeAt: null,
			// 代码：});
			});
		// 声明 const qb ← this.messageRepo
		const qb = this.messageRepo
			// 链式调用续行：.createQueryBuilder('m')
			.createQueryBuilder('m')
			// 链式调用续行：.where('m.session_id = :sid', { sid: sessionId })
			.where('m.session_id = :sid', { sid: sessionId })
			// 链式调用续行：.orderBy('m.created_at', 'ASC');
			.orderBy('m.created_at', 'ASC');
		// 条件：(summaryRow.coversBeforeAt)
		if (summaryRow.coversBeforeAt) {
			// 代码：qb.andWhere('m.created_at > :t', { t: summaryRow.coversBeforeAt });
			qb.andWhere('m.created_at > :t', { t: summaryRow.coversBeforeAt });
		// 闭合当前作用域（方法/类/对象/块）
		}
		// 声明 const rows ← await qb.getMany();
		const rows = await qb.getMany();
		// 条件：(rows.length <= COMPACT_ROW_THRESHOLD) return;
		if (rows.length <= COMPACT_ROW_THRESHOLD) return;
		// 声明 const foldCount ← rows.length - MAX_TAIL_MESSAGE_ROWS;
		const foldCount = rows.length - MAX_TAIL_MESSAGE_ROWS;
		// 条件：(foldCount <= 0) return;
		if (foldCount <= 0) return;
		// 声明 const toFold ← rows.slice(0, foldCount);
		const toFold = rows.slice(0, foldCount);
		// 声明 const transcript ← toFold
		const transcript = toFold
			// 链式调用续行：.map((r) => {
			.map((r) => {
				// 声明 const tag ← r.role === SkillTryMessageRole.USER ? '用户' : '助手';
				const tag = r.role === SkillTryMessageRole.USER ? '用户' : '助手';
				// 返回：`${tag}: ${r.content ?? ''}`;
				return `${tag}: ${r.content ?? ''}`;
			// 代码：})
			})
			// 链式调用续行：.join('\n');
			.join('\n');
		// 声明 const merged ← await this.buildCompactionModel().invoke([
		const merged = await this.buildCompactionModel().invoke([
			// 实例化：SystemMessage(
			new SystemMessage(
				// 字符串/模板字面量：'你是摘要助手。将「已有摘要」与「新增对话片段」合并为一条连贯的中文摘要，保留事实、结论与用户偏好；省略寒暄，控制在约 2000 字以内。',
				'你是摘要助手。将「已有摘要」与「新增对话片段」合并为一条连贯的中文摘要，保留事实、结论与用户偏好；省略寒暄，控制在约 2000 字以内。',
			// 结束实参列表并继续外层字面量
			),
			// 实例化：HumanMessage(
			new HumanMessage(
				// 字符串/模板字面量：`已有摘要：\n${summaryRow.summary?.trim() || '（无）'}\n\n新增片段：\n${transcript}`,
				`已有摘要：\n${summaryRow.summary?.trim() || '（无）'}\n\n新增片段：\n${transcript}`,
			// 结束实参列表并继续外层字面量
			),
		// 代码：]);
		]);
		// 声明 const text ← 
		const text =
			// 运行时类型判别：typeof merged.content === 'string'
			typeof merged.content === 'string'
				// 代码：? merged.content
				? merged.content
				// 运行时类型判别：: Array.isArray(merged.content)
				: Array.isArray(merged.content)
					// 代码：? merged.content
					? merged.content
							// 链式调用续行：.map((c: any) => (typeof c?.text === 'string' ? c.text : ''))
							.map((c: any) => (typeof c?.text === 'string' ? c.text : ''))
							// 链式调用续行：.join('')
							.join('')
					// 代码：: String(merged.content ?? '');
					: String(merged.content ?? '');
		// 更新摘要行：summaryRow.summary = text.trim();
		summaryRow.summary = text.trim();
		// 更新摘要行：summaryRow.coversBeforeAt = toFold[toFold.length - 1]!.createdAt;
		summaryRow.coversBeforeAt = toFold[toFold.length - 1]!.createdAt;
		// 等待异步完成：this.summaryRepo.save(summaryRow);
		await this.summaryRepo.save(summaryRow);
	// 闭合当前作用域（方法/类/对象/块）
	}
	// 空行，分隔上下逻辑块

	// buildLangChain：摘要 + 尾部对话
	async buildLangChainMessagesFromDb(
		// 参数/字段 `sessionId`：业务或运行会话主键（string）
		sessionId: string,
	// 方法返回类型：Promise<BaseMessage[]>
	): Promise<BaseMessage[]> {
		// 声明 const summaryRow ← await this.summaryRepo.findOne({
		const summaryRow = await this.summaryRepo.findOne({
			// 标注 `where`：{ sessionId }
			where: { sessionId },
		// 代码：});
		});
		// 声明 const qb ← this.messageRepo
		const qb = this.messageRepo
			// 链式调用续行：.createQueryBuilder('m')
			.createQueryBuilder('m')
			// 链式调用续行：.where('m.session_id = :sid', { sid: sessionId })
			.where('m.session_id = :sid', { sid: sessionId })
			// 链式调用续行：.orderBy('m.created_at', 'ASC');
			.orderBy('m.created_at', 'ASC');
		// 条件：(summaryRow?.coversBeforeAt)
		if (summaryRow?.coversBeforeAt) {
			// 代码：qb.andWhere('m.created_at > :t', { t: summaryRow.coversBeforeAt });
			qb.andWhere('m.created_at > :t', { t: summaryRow.coversBeforeAt });
		// 闭合当前作用域（方法/类/对象/块）
		}
		// 声明 const rows ← await qb.getMany();
		const rows = await qb.getMany();
		// 声明 const messages: BaseMessage[] ← [];
		const messages: BaseMessage[] = [];
		// 条件：(summaryRow?.summary?.trim())
		if (summaryRow?.summary?.trim()) {
			// 把转换后的 LangChain 消息追加进上下文数组
			messages.push(
				// 实例化：SystemMessage(
				new SystemMessage(
					// 字符串/模板字面量：`以下为更早对话的摘要（水印折叠），请视作上下文的一部分：\n${summaryRow.summary.trim()}`,
					`以下为更早对话的摘要（水印折叠），请视作上下文的一部分：\n${summaryRow.summary.trim()}`,
				// 结束实参列表并继续外层字面量
				),
			// 结束当前调用、对象项或数组项
			);
		// 闭合当前作用域（方法/类/对象/块）
		}
		// 循环：(const r of rows)
		for (const r of rows) {
			// 条件：(r.role === SkillTryMessageRole.USER)
			if (r.role === SkillTryMessageRole.USER) {
				// 把转换后的 LangChain 消息追加进上下文数组
				messages.push(new HumanMessage(r.content ?? ''));
			// 否则若：(
			} else if (
				// 代码：r.role === SkillTryMessageRole.ASSISTANT &&
				r.role === SkillTryMessageRole.ASSISTANT &&
				// 代码：(r.content ?? '').trim()
				(r.content ?? '').trim()
			// 代码：) {
			) {
				// 把转换后的 LangChain 消息追加进上下文数组
				messages.push(new AIMessage(r.content ?? ''));
			// 闭合当前作用域（方法/类/对象/块）
			}
		// 闭合当前作用域（方法/类/对象/块）
		}
		// 返回：messages;
		return messages;
	// 闭合当前作用域（方法/类/对象/块）
	}
	// 空行，分隔上下逻辑块

	// insert：消息挂 SkillTrySession；标题回填 agent_sessions
	async insertUserAndAssistantPlaceholder(
		// 参数/字段 `sessionId`：业务或运行会话主键（string）
		sessionId: string,
		// 参数/字段 `turnId`：string
		turnId: string,
		// 参数/字段 `userContent`：string
		userContent: string,
	// 方法返回类型：Promise<{ userMessageId: string; assistantMessageId: string }>
	): Promise<{ userMessageId: string; assistantMessageId: string }> {
		// 声明 const trySession ← await this.trySessionRepo.findOne({
		const trySession = await this.trySessionRepo.findOne({
			// 标注 `where`：{ id: sessionId }
			where: { id: sessionId },
		// 代码：});
		});
		// 条件：(!trySession)
		if (!trySession) {
			// 抛出异常中断本路径：new Error(`Skill 试跑会话不存在: ${sessionId}`);
			throw new Error(`Skill 试跑会话不存在: ${sessionId}`);
		// 闭合当前作用域（方法/类/对象/块）
		}
		// 声明 const user ← this.messageRepo.create({
		const user = this.messageRepo.create({
			// 对象属性 `session` ← trySession
			session: trySession,
			// 对象属性 `role` ← SkillTryMessageRole.USER
			role: SkillTryMessageRole.USER,
			// 参数/字段 `content`：userContent
			content: userContent,
			// 代码：turnId,
			turnId,
		// 代码：});
		});
		// 等待异步完成：this.messageRepo.save(user);
		await this.messageRepo.save(user);
		// 声明 const assistant ← this.messageRepo.create({
		const assistant = this.messageRepo.create({
			// 对象属性 `session` ← trySession
			session: trySession,
			// 对象属性 `role` ← SkillTryMessageRole.ASSISTANT
			role: SkillTryMessageRole.ASSISTANT,
			// 参数/字段 `content`：''
			content: '',
			// 代码：turnId,
			turnId,
		// 代码：});
		});
		// 等待异步完成：this.messageRepo.save(assistant);
		await this.messageRepo.save(assistant);
	// 空行，分隔上下逻辑块

		// 若 agent 会话无标题则用首句写入
		const agentSession = await this.agentSessionRepo.findOne({
			// 标注 `where`：{ id: sessionId }
			where: { id: sessionId },
		// 代码：});
		});
		// 条件：(agentSession && !agentSession.title?.trim())
		if (agentSession && !agentSession.title?.trim()) {
			// 声明 const t ← userContent.slice(0, 60) || '新对话';
			const t = userContent.slice(0, 60) || '新对话';
			// 等待异步完成：this.agentSessionRepo.update({ id: sessionId }, { title: t });
			await this.agentSessionRepo.update({ id: sessionId }, { title: t });
		// 闭合当前作用域（方法/类/对象/块）
		}
		// 同时刷新 agent_sessions 与 skill_try_sessions 的 updatedAt
		const now = new Date();
		// 等待异步完成：Promise.all([
		await Promise.all([
			// 访问/调用实例：this.agentSessionRepo.update({ id: sessionId }, { updatedAt: now }),
			this.agentSessionRepo.update({ id: sessionId }, { updatedAt: now }),
			// 访问/调用实例：this.trySessionRepo.update({ id: sessionId }, { updatedAt: now }),
			this.trySessionRepo.update({ id: sessionId }, { updatedAt: now }),
		// 代码：]);
		]);
		// 开始构造返回对象
		return { userMessageId: user.id, assistantMessageId: assistant.id };
	// 闭合当前作用域（方法/类/对象/块）
	}
	// 空行，分隔上下逻辑块

	// update：content/organic + 双表戳时间
	async updateAssistantContent(
		// 参数/字段 `sessionId`：业务或运行会话主键（string）
		sessionId: string,
		// 参数/字段 `assistantMessageId`：string
		assistantMessageId: string,
		// 参数/字段 `content`：string
		content: string,
		// 参数/字段 `searchOrganic`：SerperOrganicItem[] | null
		searchOrganic?: SerperOrganicItem[] | null,
	// 方法返回类型：Promise<void>
	): Promise<void> {
		// 声明 const now ← new Date();
		const now = new Date();
		// 声明 const patch: {
		const patch: {
			// 参数/字段 `content`：string;
			content: string;
			// 参数/字段 `searchOrganic`：SerperOrganicItem[] | null;
			searchOrganic?: SerperOrganicItem[] | null;
		// 代码：} = { content };
		} = { content };
		// 条件：(searchOrganic !== undefined)
		if (searchOrganic !== undefined) {
			// 写入更新补丁：patch.searchOrganic = searchOrganic;
			patch.searchOrganic = searchOrganic;
		// 闭合当前作用域（方法/类/对象/块）
		}
		// 等待异步完成：Promise.all([
		await Promise.all([
			// 访问/调用实例：this.messageRepo.update({ id: assistantMessageId }, patch),
			this.messageRepo.update({ id: assistantMessageId }, patch),
			// 访问/调用实例：this.agentSessionRepo.update({ id: sessionId }, { updatedAt: now }),
			this.agentSessionRepo.update({ id: sessionId }, { updatedAt: now }),
			// 访问/调用实例：this.trySessionRepo.update({ id: sessionId }, { updatedAt: now }),
			this.trySessionRepo.update({ id: sessionId }, { updatedAt: now }),
		// 代码：]);
		]);
	// 闭合当前作用域（方法/类/对象/块）
	}
	// 空行，分隔上下逻辑块

	// deleteTurnPair：删试跑消息对
	async deleteTurnPair(sessionId: string, turnId: string): Promise<void> {
		// 等待异步完成：this.messageRepo
		await this.messageRepo
			// 链式调用续行：.createQueryBuilder()
			.createQueryBuilder()
			// 链式调用续行：.delete()
			.delete()
			// 链式调用续行：.from(SkillTryMessage)
			.from(SkillTryMessage)
			// 链式调用续行：.where('session_id = :sid', { sid: sessionId })
			.where('session_id = :sid', { sid: sessionId })
			// 链式调用续行：.andWhere('turn_id = :tid', { tid: turnId })
			.andWhere('turn_id = :tid', { tid: turnId })
			// 链式调用续行：.execute();
			.execute();
	// 闭合当前作用域（方法/类/对象/块）
	}
	// 空行，分隔上下逻辑块

	// listMessagesAsc：供详情路由
	async listMessagesAsc(sessionId: string) {
		// 返回：this.messageRepo.find({
		return this.messageRepo.find({
			// 标注 `where`：{ session: { id: sessionId } }
			where: { session: { id: sessionId } },
			// 标注 `order`：{ createdAt: 'ASC' }
			order: { createdAt: 'ASC' },
			// 标注 `select`：['id', 'turnId', 'role', 'content', 'searchOrganic', 'create
			select: ['id', 'turnId', 'role', 'content', 'searchOrganic', 'createdAt'],
		// 代码：});
		});
	// 闭合当前作用域（方法/类/对象/块）
	}
	// 空行，分隔上下逻辑块

	// deleteSummary：删试跑摘要
	async deleteSummary(sessionId: string): Promise<void> {
		// 等待异步完成：this.summaryRepo.delete({ sessionId });
		await this.summaryRepo.delete({ sessionId });
	// 闭合当前作用域（方法/类/对象/块）
	}
// 闭合当前作用域（方法/类/对象/块）
}
```

**变更摘要**：M3；消息在试跑表，标题在 `agent_sessions`，故 insert/update 双写 `updatedAt`。

### 4.5 `AgentMemoryService.insertUserAndAssistantPlaceholder`

**对比范围**：完整方法（基线 `session: AgentSession` → 当前 `sessionId: string`）。

**来源**：`apps/backend/src/services/agent/agent-memory.service.ts` · **改动前** · HEAD 约 L193–L221，`insertUserAndAssistantPlaceholder`

```typescript
	// 方法声明（改动前）：第一参为已加载的 AgentSession 实体
	async insertUserAndAssistantPlaceholder(
		// 参数 session：调用方须先 findOne 再传入
		session: AgentSession,
		// 参数 turnId：本轮对话对共享 id
		turnId: string,
		// 参数 userContent：用户正文
		userContent: string,
	// 返回双方消息主键的 Promise 类型并打开方法体
	): Promise<{ userMessageId: string; assistantMessageId: string }> {
		// 创建 USER 消息实体
		const user = this.messageRepo.create({
			// 关联传入的 session 对象
			session,
			// 角色标记 USER
			role: AgentMessageRole.USER,
			// 写入用户内容
			content: userContent,
			// 挂上 turnId
			turnId,
		// create 对象字面量结束
		});
		// 持久化用户行到 agent_messages
		await this.messageRepo.save(user);
	// 空行

		// 创建 ASSISTANT 空占位
		const assistant = this.messageRepo.create({
			// 同一 session
			session,
			// 角色 ASSISTANT
			role: AgentMessageRole.ASSISTANT,
			// content 先空串，待流式回填
			content: '',
			// 同一 turnId
			turnId,
		// create 结束
		});
		// 持久化助手占位
		await this.messageRepo.save(assistant);
	// 空行

		// 若无标题则用首句生成
		if (!session.title?.trim()) {
			// 截取前 60 字，空则「新对话」
			const t = userContent.slice(0, 60) || '新对话';
			// 更新 agent_sessions.title
			await this.sessionRepo.update({ id: session.id }, { title: t });
			// 同步内存 session.title
			session.title = t;
		// 标题分支结束
		}
	// 空行

		// 返回 user/assistant 消息 id
		return { userMessageId: user.id, assistantMessageId: assistant.id };
	// 方法结束
	}
```

**来源**：`apps/backend/src/services/agent/agent-memory.service.ts` · **改动后** · 约 L195–L230，`insertUserAndAssistantPlaceholder`

```typescript
	// 方法声明（改动后）：与 AgentTurnMemory 对齐，第一参为 sessionId 字符串
	async insertUserAndAssistantPlaceholder(
		// 参数 sessionId：方法内自行加载会话
		sessionId: string,
		// 参数 turnId
		turnId: string,
		// 参数 userContent
		userContent: string,
	// 返回类型并打开方法体
	): Promise<{ userMessageId: string; assistantMessageId: string }> {
		// 按 id 查询 agent_sessions
		const session = await this.sessionRepo.findOne({
			// where 主键等于 sessionId
			where: { id: sessionId },
		// findOne 选项结束
		});
		// 不存在则抛错，避免悬挂消息
		if (!session) {
			// 错误信息带上缺失 id
			throw new Error(`Agent 会话不存在: ${sessionId}`);
		// 存在性校验结束
		}
	// 空行

		// 创建 USER 消息
		const user = this.messageRepo.create({
			// 关联查出的 session
			session,
			// 角色 USER
			role: AgentMessageRole.USER,
			// 用户正文
			content: userContent,
			// turnId
			turnId,
		// create 结束
		});
		// save 用户行
		await this.messageRepo.save(user);
	// 空行

		// 创建助手占位
		const assistant = this.messageRepo.create({
			// 同一 session
			session,
			// 角色 ASSISTANT
			role: AgentMessageRole.ASSISTANT,
			// 空 content
			content: '',
			// 同一 turnId
			turnId,
		// create 结束
		});
		// save 助手占位
		await this.messageRepo.save(assistant);
	// 空行

		// 无标题则生成
		if (!session.title?.trim()) {
			// 截断 60 字或默认文案
			const t = userContent.slice(0, 60) || '新对话';
			// 更新 sessions.title
			await this.sessionRepo.update({ id: session.id }, { title: t });
			// 同步内存 title
			session.title = t;
		// 标题分支结束
		}
	// 空行

		// 返回双方 id
		return { userMessageId: user.id, assistantMessageId: assistant.id };
	// 方法结束
	}
```

**变更摘要**：签名改为 `sessionId`，内部 `findOne`，满足端口统一调用。

### 4.6 `AgentService.inferMemorySource` / `resolveTurnMemory`（新建，仅改动后）

**来源**：`apps/backend/src/services/agent/agent.service.ts` · **改动后** · 约 L217–L242，`inferMemorySource`

```typescript
	// 块注释开始（文件/方法语义）
	/** 按会话归属推断业务记忆（未显式传 memorySource 时）；业务表未建则当作无归属 */
	// 方法 `inferMemorySource`：声明入口
	private async inferMemorySource(
		// 参数/字段 `sessionId`：业务或运行会话主键（string）
		sessionId: string,
	// 方法返回类型：Promise<'english_learning' | 'skill_try' | null>
	): Promise<'english_learning' | 'skill_try' | null> {
		// try：业务表可能未迁移，失败时降级而非打垮请求
		try {
			// 声明 const eng ← await this.englishSessionRepo.exist({
			const eng = await this.englishSessionRepo.exist({
				// 标注 `where`：{ id: sessionId }
				where: { id: sessionId },
			// 代码：});
			});
			// 条件：(eng) return 'english_learning';
			if (eng) return 'english_learning';
		// catch：记录警告后继续后续推断/逻辑
		} catch (e) {
			// 访问/调用实例：this.logger.warn?.(
			this.logger.warn?.(
				// 字符串/模板字面量：`[AgentService] 推断 english 记忆跳过: ${e instanceof Error ? e.message : e}`,
				`[AgentService] 推断 english 记忆跳过: ${e instanceof Error ? e.message : e}`,
			// 结束当前调用、对象项或数组项
			);
		// 闭合当前作用域（方法/类/对象/块）
		}
		// try：业务表可能未迁移，失败时降级而非打垮请求
		try {
			// 声明 const tryRow ← await this.skillTrySessionRepo.exist({
			const tryRow = await this.skillTrySessionRepo.exist({
				// 标注 `where`：{ id: sessionId }
				where: { id: sessionId },
			// 代码：});
			});
			// 条件：(tryRow) return 'skill_try';
			if (tryRow) return 'skill_try';
		// catch：记录警告后继续后续推断/逻辑
		} catch (e) {
			// 访问/调用实例：this.logger.warn?.(
			this.logger.warn?.(
				// 字符串/模板字面量：`[AgentService] 推断 skill_try 记忆跳过: ${e instanceof Error ? e.message : e}`,
				`[AgentService] 推断 skill_try 记忆跳过: ${e instanceof Error ? e.message : e}`,
			// 结束当前调用、对象项或数组项
			);
		// 闭合当前作用域（方法/类/对象/块）
		}
		// 返回：null;
		return null;
	// 闭合当前作用域（方法/类/对象/块）
	}
```

**来源**：`apps/backend/src/services/agent/agent.service.ts` · **改动后** · 约 L244–L290，`resolveTurnMemory`

```typescript
	// 块注释开始
	/**
	 // 职责：解析本轮 turnMemory 与 businessSessionId
	 * 解析本轮业务记忆实现与 businessSessionId。
	 // runSessionId 管停流/epoch；消息读写走 turnMemory
	 * runSessionId（agent session）仍用于停流/epoch；消息读写走 turnMemory。
	 // 块注释结束
	 */
	// 私有异步 resolveTurnMemory
	private async resolveTurnMemory(
		// userId：assistant 路由绑定用户
		userId: number,
		// dto：含 memorySource / assistantSessionId
		dto: AgentChatDto,
		// runSessionId：agent 运行句柄
		runSessionId: string,
	// 返回端口实例 + 业务会话 id
	): Promise<{ turnMemory: AgentTurnMemory; businessSessionId: string }> {
		// 先取 DTO 显式 source
		let source = dto.memorySource;
		// 未传则推断
		if (!source) {
			// 推断 null 时回退 agent（遗留/ephemeral）
			source = (await this.inferMemorySource(runSessionId)) ?? 'agent';
		// 缺省处理结束
		}
	// 空行

		// assistant：持久知识库 Skill → assistant_*
		if (source === 'assistant') {
			// 读取并 trim assistantSessionId
			const aid = (dto.assistantSessionId ?? '').trim();
			// 缺失则 400
			if (!aid) {
				// BadRequestException 文案
				throw new BadRequestException(
					// 抛错调用结束
					'memorySource=assistant 时须提供 assistantSessionId',
				// 校验结束
				);
			// 返回 forUser 端口
			}
			// turnMemory：按用户隔离的助手表实现
			return {
				// businessSessionId：助手会话 id（≠ run 句柄）
				turnMemory: this.assistantTableMemory.forUser(userId),
				// return 对象结束
				businessSessionId: aid,
			// assistant 分支结束
			};
		// english_learning 分支
		}
		// 返回英语记忆
		if (source === 'english_learning') {
			// englishTableMemory
			return {
				// businessSessionId = runSessionId
				turnMemory: this.englishTableMemory,
				// return 结束
				businessSessionId: runSessionId,
			// 英语分支结束
			};
		// skill_try 分支
		}
		// 返回试跑记忆
		if (source === 'skill_try') {
			// skillTryTableMemory
			return {
				// businessSessionId = runSessionId
				turnMemory: this.skillTryTableMemory,
				// return 结束
				businessSessionId: runSessionId,
			// 试跑分支结束
			};
		// agent 分支（遗留/显式）
		}
		// 源码注释：M4 产品路径应迁出；保留遗留
		if (source === 'agent') {
			// 返回默认 AgentMemoryService
			// M4：产品路径应已迁出；保留实现供遗留/未建业务行的句柄
			// turnMemory = this.memory
			return {
				// businessSessionId = runSessionId
				turnMemory: this.memory,
				// return 结束
				businessSessionId: runSessionId,
			// agent 分支结束
			};
		// 未知枚举 → 400
		}
		// 方法结束
		throw new BadRequestException(`不支持的 memorySource: ${source}`);
	// 闭合当前作用域（方法/类/对象/块）
	}
```

**变更摘要**：SSE 经此完成分表；`assistant` 必须带 `assistantSessionId`；ephemeral Skill 显式 `agent`。

### 4.7 `AgentService.createSession`

**来源**：`apps/backend/src/services/agent/agent.service.ts` · **改动前** · HEAD 约 L220–L235，`createSession`

```typescript
	// 块注释开始（文件/方法语义）
	/**
	 // 注释：新建Agent会话
	 * 新建Agent会话
	 // 注释：@param userId 用户ID
	 * @param userId 用户ID
	 // 注释：@param dto （可选）会话标题
	 * @param dto （可选）会话标题
	 // 块注释结束
	 */
	// 异步方法 `createSession`：开始定义
	async createSession(userId: number, dto?: CreateAgentSessionDto) {
		// 声明 const id ← randomUUID();
		const id = randomUUID();
		// 声明 const session ← this.sessionRepo.create({
		const session = this.sessionRepo.create({
			// 代码：id,
			id,
			// 代码：userId,
			userId,
			// 对象属性 `title` ← dto?.title?.trim() || null
			title: dto?.title?.trim() || null,
			// 对象属性 `updatedAt` ← new Date()
			updatedAt: new Date(),
		// 代码：});
		});
		// 等待异步完成：this.sessionRepo.save(session);
		await this.sessionRepo.save(session);
		// 开始构造返回对象
		return { sessionId: id, title: session.title };
	// 闭合当前作用域（方法/类/对象/块）
	}
```

**来源**：`apps/backend/src/services/agent/agent.service.ts` · **改动后** · 约 L368–L389，`createSession`

```typescript
	// 异步方法 `createSession`：开始定义
	async createSession(userId: number, dto?: CreateAgentSessionDto) {
		// 声明 const id ← randomUUID();
		const id = randomUUID();
		// 声明 const title ← dto?.title?.trim() || null;
		const title = dto?.title?.trim() || null;
		// 声明 const session ← this.sessionRepo.create({
		const session = this.sessionRepo.create({
			// 代码：id,
			id,
			// 代码：userId,
			userId,
			// 代码：title,
			title,
			// 对象属性 `updatedAt` ← new Date()
			updatedAt: new Date(),
		// 代码：});
		});
		// 等待异步完成：this.sessionRepo.save(session);
		await this.sessionRepo.save(session);
		// 条件：(dto?.memorySource === 'english_learning')
		if (dto?.memorySource === 'english_learning') {
			// 等待异步完成：this.englishSessionRepo.save(
			await this.englishSessionRepo.save(
				// 访问/调用实例：this.englishSessionRepo.create({
				this.englishSessionRepo.create({
					// 代码：id,
					id,
					// 代码：userId,
					userId,
					// 代码：title,
					title,
					// 对象属性 `updatedAt` ← new Date()
					updatedAt: new Date(),
				// 代码：}),
				}),
			// 结束当前调用、对象项或数组项
			);
		// 闭合当前作用域（方法/类/对象/块）
		}
		// 开始构造返回对象
		return { sessionId: id, title: session.title };
	// 闭合当前作用域（方法/类/对象/块）
	}
```

**变更摘要**：`memorySource=english_learning` 时同 id 双写英语业务会话。

### 4.8 `AgentService.listSessions`

**来源**：`apps/backend/src/services/agent/agent.service.ts` · **改动前** · HEAD 约 L237–L275，`listSessions`

```typescript
	// 块注释开始（文件/方法语义）
	/**
	 // 注释：分页列出当前用户的 Agent 会话（按更新时间倒序，供英语学习历史抽屉）
	 * 分页列出当前用户的 Agent 会话（按更新时间倒序，供英语学习历史抽屉）
	 // 块注释结束
	 */
	// 异步方法 `listSessions`：开始定义
	async listSessions(
		// 参数/字段 `userId`：number
		userId: number,
		// 代码：pageNo = 1,
		pageNo = 1,
		// 代码：pageSize = 20,
		pageSize = 20,
	// 方法返回类型：Promise<
	): Promise<{
		// 对象属性 `list` ← Array<{
		list: Array<{
			// 参数/字段 `sessionId`：业务或运行会话主键（string;）
			sessionId: string;
			// 对象属性 `title` ← string | null;
			title: string | null;
			// 对象属性 `createdAt` ← Date;
			createdAt: Date;
			// 对象属性 `updatedAt` ← Date;
			updatedAt: Date;
		// 代码：}>;
		}>;
		// 参数/字段 `pageNo`：number;
		pageNo: number;
		// 参数/字段 `pageSize`：number;
		pageSize: number;
		// 对象属性 `total` ← number;
		total: number;
	// 代码：}> {
	}> {
		// 声明 const pn ← Math.max(1, Math.floor(pageNo));
		const pn = Math.max(1, Math.floor(pageNo));
		// 声明 const ps ← Math.min(50, Math.max(1, Math.floor(pageSize)));
		const ps = Math.min(50, Math.max(1, Math.floor(pageSize)));
		// 声明 const qb ← this.sessionRepo
		const qb = this.sessionRepo
			// 链式调用续行：.createQueryBuilder('s')
			.createQueryBuilder('s')
			// 链式调用续行：.where('s.user_id = :uid', { uid: userId })
			.where('s.user_id = :uid', { uid: userId })
			// 链式调用续行：.orderBy('s.updated_at', 'DESC')
			.orderBy('s.updated_at', 'DESC')
			// 链式调用续行：.skip((pn - 1) * ps)
			.skip((pn - 1) * ps)
			// 链式调用续行：.take(ps);
			.take(ps);
		// 声明 const [rows, total] ← await qb.getManyAndCount();
		const [rows, total] = await qb.getManyAndCount();
		// 开始构造返回对象
		return {
			// 对象属性 `list` ← rows.map((r) => ({
			list: rows.map((r) => ({
				// 参数/字段 `sessionId`：业务或运行会话主键（r.id）
				sessionId: r.id,
				// 对象属性 `title` ← r.title
				title: r.title,
				// 对象属性 `createdAt` ← r.createdAt
				createdAt: r.createdAt,
				// 对象属性 `updatedAt` ← r.updatedAt
				updatedAt: r.updatedAt,
			// 代码：})),
			})),
			// 参数/字段 `pageNo`：pn
			pageNo: pn,
			// 参数/字段 `pageSize`：ps
			pageSize: ps,
			// 代码：total,
			total,
		// 结束当前调用、对象项或数组项
		};
	// 闭合当前作用域（方法/类/对象/块）
	}
```

**来源**：`apps/backend/src/services/agent/agent.service.ts` · **改动后** · 约 L418–L457，`listSessions`

```typescript
	// 块注释开始（文件/方法语义）
	/**
	 // 注释：分页列出英语学习会话（english_agent_sessions）。
	 * 分页列出英语学习会话（english_agent_sessions）。
	 // 注释：不再扫全部 agent_sessions，避免知识库 Skill 运行句柄混入列表。
	 * 不再扫全部 agent_sessions，避免知识库 Skill 运行句柄混入列表。
	 // 块注释结束
	 */
	// 异步方法 `listSessions`：开始定义
	async listSessions(
		// 参数/字段 `userId`：number
		userId: number,
		// 代码：pageNo = 1,
		pageNo = 1,
		// 代码：pageSize = 20,
		pageSize = 20,
	// 方法返回类型：Promise<
	): Promise<{
		// 对象属性 `list` ← Array<{
		list: Array<{
			// 参数/字段 `sessionId`：业务或运行会话主键（string;）
			sessionId: string;
			// 对象属性 `title` ← string | null;
			title: string | null;
			// 对象属性 `createdAt` ← Date;
			createdAt: Date;
			// 对象属性 `updatedAt` ← Date;
			updatedAt: Date;
		// 代码：}>;
		}>;
		// 参数/字段 `pageNo`：number;
		pageNo: number;
		// 参数/字段 `pageSize`：number;
		pageSize: number;
		// 对象属性 `total` ← number;
		total: number;
	// 代码：}> {
	}> {
		// 声明 const pn ← Math.max(1, Math.floor(pageNo));
		const pn = Math.max(1, Math.floor(pageNo));
		// 声明 const ps ← Math.min(50, Math.max(1, Math.floor(pageSize)));
		const ps = Math.min(50, Math.max(1, Math.floor(pageSize)));
		// 声明 const qb ← this.englishSessionRepo
		const qb = this.englishSessionRepo
			// 链式调用续行：.createQueryBuilder('s')
			.createQueryBuilder('s')
			// 链式调用续行：.where('s.user_id = :uid', { uid: userId })
			.where('s.user_id = :uid', { uid: userId })
			// 链式调用续行：.orderBy('s.updated_at', 'DESC')
			.orderBy('s.updated_at', 'DESC')
			// 链式调用续行：.skip((pn - 1) * ps)
			.skip((pn - 1) * ps)
			// 链式调用续行：.take(ps);
			.take(ps);
		// 声明 const [rows, total] ← await qb.getManyAndCount();
		const [rows, total] = await qb.getManyAndCount();
		// 开始构造返回对象
		return {
			// 对象属性 `list` ← rows.map((r) => ({
			list: rows.map((r) => ({
				// 参数/字段 `sessionId`：业务或运行会话主键（r.id）
				sessionId: r.id,
				// 对象属性 `title` ← r.title
				title: r.title,
				// 对象属性 `createdAt` ← r.createdAt
				createdAt: r.createdAt,
				// 对象属性 `updatedAt` ← r.updatedAt
				updatedAt: r.updatedAt,
			// 代码：})),
			})),
			// 参数/字段 `pageNo`：pn
			pageNo: pn,
			// 参数/字段 `pageSize`：ps
			pageSize: ps,
			// 代码：total,
			total,
		// 结束当前调用、对象项或数组项
		};
	// 闭合当前作用域（方法/类/对象/块）
	}
```

**变更摘要**：数据源从全量 `agent_sessions` 收窄为 `english_agent_sessions`。

### 4.9 `AgentService.getSessionDetail`

**来源**：`apps/backend/src/services/agent/agent.service.ts` · **改动前** · HEAD 约 L277–L307，`getSessionDetail`

```typescript
	// 块注释开始（文件/方法语义）
	/**
	 // 注释：查询会话详情及全部消息（升序）
	 * 查询会话详情及全部消息（升序）
	 // 注释：@param userId 用户ID（做权限隔离）
	 * @param userId 用户ID（做权限隔离）
	 // 注释：@param sessionId 会话ID
	 * @param sessionId 会话ID
	 // 块注释结束
	 */
	// 异步方法 `getSessionDetail`：开始定义
	async getSessionDetail(userId: number, sessionId: string) {
		// 声明 const session ← await this.sessionRepo.findOne({
		const session = await this.sessionRepo.findOne({
			// 标注 `where`：{ id: sessionId, userId }
			where: { id: sessionId, userId },
			// 标注 `select`：['id', 'title', 'createdAt', 'updatedAt']
			select: ['id', 'title', 'createdAt', 'updatedAt'],
		// 代码：});
		});
		// 条件：(!session)
		if (!session) {
			// 开始构造返回对象
			return { session: null, messages: [] };
		// 闭合当前作用域（方法/类/对象/块）
		}
		// 声明 const messages ← await this.memory.listMessagesAsc(sessionId);
		const messages = await this.memory.listMessagesAsc(sessionId);
		// 开始构造返回对象
		return {
			// 对象属性 `session` ← {
			session: {
				// 参数/字段 `sessionId`：业务或运行会话主键（session.id）
				sessionId: session.id,
				// 对象属性 `title` ← session.title
				title: session.title,
				// 对象属性 `createdAt` ← session.createdAt
				createdAt: session.createdAt,
				// 对象属性 `updatedAt` ← session.updatedAt
				updatedAt: session.updatedAt,
			// 结束当前调用、对象项或数组项
			},
			// 对象属性 `messages` ← messages.map((m) => ({
			messages: messages.map((m) => ({
				// 对象属性 `id` ← m.id
				id: m.id,
				// 参数/字段 `turnId`：m.turnId
				turnId: m.turnId,
				// 对象属性 `role` ← m.role
				role: m.role,
				// 参数/字段 `content`：m.content
				content: m.content,
				// 参数/字段 `searchOrganic`：m.searchOrganic ?? null
				searchOrganic: m.searchOrganic ?? null,
				// 对象属性 `createdAt` ← m.createdAt
				createdAt: m.createdAt,
			// 代码：})),
			})),
		// 结束当前调用、对象项或数组项
		};
	// 闭合当前作用域（方法/类/对象/块）
	}
```

**来源**：`apps/backend/src/services/agent/agent.service.ts` · **改动后** · 约 L459–L543，`getSessionDetail`

```typescript
	// 块注释开始（文件/方法语义）
	/**
	 // 注释：查询会话详情及全部消息（升序）；按业务表路由。
	 * 查询会话详情及全部消息（升序）；按业务表路由。
	 // 块注释结束
	 */
	// 异步方法 `getSessionDetail`：开始定义
	async getSessionDetail(userId: number, sessionId: string) {
		// 声明 const eng ← await this.englishSessionRepo.findOne({
		const eng = await this.englishSessionRepo.findOne({
			// 标注 `where`：{ id: sessionId, userId }
			where: { id: sessionId, userId },
			// 标注 `select`：['id', 'title', 'createdAt', 'updatedAt']
			select: ['id', 'title', 'createdAt', 'updatedAt'],
		// 代码：});
		});
		// 条件：(eng)
		if (eng) {
			// 声明 const messages ← await this.englishTableMemory.listMessagesAsc(sess
			const messages = await this.englishTableMemory.listMessagesAsc(sessionId);
			// 开始构造返回对象
			return {
				// 对象属性 `session` ← {
				session: {
					// 参数/字段 `sessionId`：业务或运行会话主键（eng.id）
					sessionId: eng.id,
					// 对象属性 `title` ← eng.title
					title: eng.title,
					// 对象属性 `createdAt` ← eng.createdAt
					createdAt: eng.createdAt,
					// 对象属性 `updatedAt` ← eng.updatedAt
					updatedAt: eng.updatedAt,
				// 结束当前调用、对象项或数组项
				},
				// 对象属性 `messages` ← messages.map((m) => ({
				messages: messages.map((m) => ({
					// 对象属性 `id` ← m.id
					id: m.id,
					// 参数/字段 `turnId`：m.turnId
					turnId: m.turnId,
					// 对象属性 `role` ← m.role
					role: m.role,
					// 参数/字段 `content`：m.content
					content: m.content,
					// 参数/字段 `searchOrganic`：m.searchOrganic ?? null
					searchOrganic: m.searchOrganic ?? null,
					// 对象属性 `createdAt` ← m.createdAt
					createdAt: m.createdAt,
				// 代码：})),
				})),
			// 结束当前调用、对象项或数组项
			};
		// 闭合当前作用域（方法/类/对象/块）
		}
	// 空行，分隔上下逻辑块

		// 声明 const tryRow ← await this.skillTrySessionRepo.findOne({
		const tryRow = await this.skillTrySessionRepo.findOne({
			// 标注 `where`：{ id: sessionId, userId }
			where: { id: sessionId, userId },
			// 标注 `select`：['id']
			select: ['id'],
		// 代码：});
		});
		// 条件：(tryRow)
		if (tryRow) {
			// 声明 const session ← await this.sessionRepo.findOne({
			const session = await this.sessionRepo.findOne({
				// 标注 `where`：{ id: sessionId, userId }
				where: { id: sessionId, userId },
				// 标注 `select`：['id', 'title', 'createdAt', 'updatedAt']
				select: ['id', 'title', 'createdAt', 'updatedAt'],
			// 代码：});
			});
			// 条件：(!session)
			if (!session) {
				// 开始构造返回对象
				return { session: null, messages: [] };
			// 闭合当前作用域（方法/类/对象/块）
			}
			// 声明 const messages ← 
			const messages =
				// 等待异步完成：this.skillTryTableMemory.listMessagesAsc(sessionId);
				await this.skillTryTableMemory.listMessagesAsc(sessionId);
			// 开始构造返回对象
			return {
				// 对象属性 `session` ← {
				session: {
					// 参数/字段 `sessionId`：业务或运行会话主键（session.id）
					sessionId: session.id,
					// 对象属性 `title` ← session.title
					title: session.title,
					// 对象属性 `createdAt` ← session.createdAt
					createdAt: session.createdAt,
					// 对象属性 `updatedAt` ← session.updatedAt
					updatedAt: session.updatedAt,
				// 结束当前调用、对象项或数组项
				},
				// 对象属性 `messages` ← messages.map((m) => ({
				messages: messages.map((m) => ({
					// 对象属性 `id` ← m.id
					id: m.id,
					// 参数/字段 `turnId`：m.turnId
					turnId: m.turnId,
					// 对象属性 `role` ← m.role
					role: m.role,
					// 参数/字段 `content`：m.content
					content: m.content,
					// 参数/字段 `searchOrganic`：m.searchOrganic ?? null
					searchOrganic: m.searchOrganic ?? null,
					// 对象属性 `createdAt` ← m.createdAt
					createdAt: m.createdAt,
				// 代码：})),
				})),
			// 结束当前调用、对象项或数组项
			};
		// 闭合当前作用域（方法/类/对象/块）
		}
	// 空行，分隔上下逻辑块

		// 声明 const session ← await this.sessionRepo.findOne({
		const session = await this.sessionRepo.findOne({
			// 标注 `where`：{ id: sessionId, userId }
			where: { id: sessionId, userId },
			// 标注 `select`：['id', 'title', 'createdAt', 'updatedAt']
			select: ['id', 'title', 'createdAt', 'updatedAt'],
		// 代码：});
		});
		// 条件：(!session)
		if (!session) {
			// 开始构造返回对象
			return { session: null, messages: [] };
		// 闭合当前作用域（方法/类/对象/块）
		}
		// 声明 const messages ← await this.memory.listMessagesAsc(sessionId);
		const messages = await this.memory.listMessagesAsc(sessionId);
		// 开始构造返回对象
		return {
			// 对象属性 `session` ← {
			session: {
				// 参数/字段 `sessionId`：业务或运行会话主键（session.id）
				sessionId: session.id,
				// 对象属性 `title` ← session.title
				title: session.title,
				// 对象属性 `createdAt` ← session.createdAt
				createdAt: session.createdAt,
				// 对象属性 `updatedAt` ← session.updatedAt
				updatedAt: session.updatedAt,
			// 结束当前调用、对象项或数组项
			},
			// 对象属性 `messages` ← messages.map((m) => ({
			messages: messages.map((m) => ({
				// 对象属性 `id` ← m.id
				id: m.id,
				// 参数/字段 `turnId`：m.turnId
				turnId: m.turnId,
				// 对象属性 `role` ← m.role
				role: m.role,
				// 参数/字段 `content`：m.content
				content: m.content,
				// 参数/字段 `searchOrganic`：m.searchOrganic ?? null
				searchOrganic: m.searchOrganic ?? null,
				// 对象属性 `createdAt` ← m.createdAt
				createdAt: m.createdAt,
			// 代码：})),
			})),
		// 结束当前调用、对象项或数组项
		};
	// 闭合当前作用域（方法/类/对象/块）
	}
```

**变更摘要**：详情读取顺序英语 → 试跑 → 遗留 `agent_messages`，与分享一致。

### 4.10 分享读库路由（说明）

`apps/backend/src/services/share/share.service.ts` 在 `sessionType === 'agent'` 时：

1. 若 `english_agent_sessions` 存在 → 读 `english_agent_messages`
2. 否则若 `skill_try_sessions` 存在 → 读 `skill_try_messages`（标题取 `agent_sessions`）
3. 否则 → 遗留 `agent_messages`

与 `getSessionDetail` 同源优先级，避免分享内容与历史抽屉不一致。

---

## 5. 兼容性

| 项 | 行为 |
|---|---|
| 旧 `agent_messages` 行 | **不迁移**；仍可读（详情/分享回退） |
| 新产品路径 | 英语 / 试跑 / 持久知识库 Skill **停写** `agent_messages` |
| 知识库草稿 ephemeral + Skill | 前端显式 `memorySource: 'agent'` |
| 无 Skill 知识库 | 仍走 `/assistant/sse`，本改动不强制迁移 |
| `memorySource` 缺省 | 按会话推断，失败回退 `agent` |
| 业务表未建 | `inferMemorySource` catch 后当无归属，不拖垮 SSE |

破坏性注意：`listSessions` 不再返回非英语的 agent 句柄；英语前端须用 `memorySource=english_learning` 建会话。

---

## 6. 测试回归

| # | 场景 | 期望 |
|---|---|---|
| 1 | 英语新建会话 + 多轮 SSE | 消息仅在 `english_agent_*`；历史抽屉可见 |
| 2 | 英语停流 / 失败 | turn 对从英语表删除；epoch 仍按 agent sessionId |
| 3 | Skill 试跑多轮 | 消息在 `skill_try_messages`；详情/分享可读 |
| 4 | 知识库已保存 + Skill | `memorySource=assistant`，写入 `assistant_messages` |
| 5 | 知识库草稿 ephemeral + Skill | `memorySource=agent`；不误查业务表 |
| 6 | 无 Skill 知识库助手 | `/assistant/sse` 行为不变 |
| 7 | 分享 agent 英语会话 | 读英语消息 |
| 8 | 分享试跑会话 | 读试跑消息 |
| 9 | 遗留 agent 会话详情 | 仍能从 `agent_messages` 读出 |
| 10 | 长对话英语摘要 | 超阈值后 compact，组上下文含 System 摘要 |

更细清单见 [Agent业务消息分表落地.md](./Agent业务消息分表落地.md) §4。

---

## 7. 相关路径

| 说明 | 路径 |
|---|---|
| 记忆端口 | `apps/backend/src/services/agent/agent-turn-memory.ts` |
| 助手表记忆 | `apps/backend/src/services/agent/assistant-table-memory.ts` |
| 英语表记忆 | `apps/backend/src/services/agent/english-table-memory.ts` |
| 试跑表记忆 | `apps/backend/src/services/agent/skill-try-table-memory.ts` |
| 默认 agent 记忆 | `apps/backend/src/services/agent/agent-memory.service.ts` |
| 路由 / 会话 API | `apps/backend/src/services/agent/agent.service.ts` |
| Chat DTO | `apps/backend/src/services/agent/dto/agent-chat.dto.ts` |
| 分享 | `apps/backend/src/services/share/share.service.ts` |
| 前端英语 | `apps/frontend/src/store/englishAgent.ts` |
| 前端试跑 | `apps/frontend/src/store/skillTry.ts` |
| 前端知识库 Skill | `apps/frontend/src/store/assistant.ts` |

---

## 延伸阅读

- [Agent业务消息分表落地.md](./Agent业务消息分表落地.md) — M0–M4 落地要点与手测清单
- [docs/ideas/agent/Agent业务消息分表.md](../ideas/agent/Agent业务消息分表.md) — 架构/流程/验收规划
- [docs/knowledge/知识库Skill对话.md](../knowledge/知识库Skill对话.md) — 助手 `/` 选 Skill + `memorySource=assistant|agent`
- [docs/knowledge/Skill编辑试跑.md](../knowledge/Skill编辑试跑.md) — `/skills` 管理页 + `memorySource=skill_try`

---

（若与仓库最新源码不一致，以源码为准）
