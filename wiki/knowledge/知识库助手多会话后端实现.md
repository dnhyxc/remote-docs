### 知识库助手（AI 模式）——按文章多 Session（会话）能力（后端实现思路与逐行注释代码）

> 本文从 `apps/backend/src/services` 的**现有改动**反推实现思路，聚焦“同一篇知识文章支持多个 session、历史会话列表、创建会话可强制新建、草稿迁入可指定目标会话”等能力。
>
> 约束：
> - **兼容旧行为**：不传新字段时，保持“同文章复用最近会话 / 迁入到最近会话”的既有逻辑。
> - **鉴权一致**：所有接口仍使用 `JwtGuard`，未登录返回 `success:false` 或 `401`（由守卫/网关处理）。
>
> 术语：
> - **Session（会话）**：助手多轮对话容器，对应 `assistant_sessions.id`。
> - **SSE（Server-Sent Events，服务端推送事件）**：流式输出协议，本文不改动协议本身，仅说明与多会话的关系。

---

### 1. 改动范围与文件清单

本次后端改动集中在 `assistant` 服务模块：

- **Controller**
  - `apps/backend/src/services/assistant/assistant.controller.ts`
- **Service**
  - `apps/backend/src/services/assistant/assistant.service.ts`
- **DTO（Data Transfer Object，数据传输对象）**
  - `apps/backend/src/services/assistant/dto/create-assistant-session.dto.ts`
  - `apps/backend/src/services/assistant/dto/import-assistant-transcript.dto.ts`
  - `apps/backend/src/services/assistant/dto/assistant-sessions-for-knowledge.dto.ts`

---

### 2. 目标与总体设计

#### 2.1 为什么需要新增“按文章列出全部会话”

旧实现只有：

- `GET /assistant/session/for-knowledge`：按 `knowledgeArticleId` **只返回最近会话**（以及消息），用于“切回文章恢复一条对话”。

当产品要求“每篇文章可以开启多个 session，并展示历史列表”时，仅“最近会话”无法满足 UI 侧的抽屉列表，因此需要：

- `GET /assistant/sessions/for-knowledge`：按 `knowledgeArticleId` 返回该文章下**全部**会话（按 `updatedAt` 倒序）。

#### 2.2 为什么创建会话需要 `forceNew`

旧逻辑在 `POST /assistant/session` 中：如果传 `knowledgeArticleId`，会复用该文章最近会话（避免重复创建）。

但“新对话”按钮的语义是“无论是否有最近会话，都创建一个新会话”，所以扩展：

- `forceNew=true`：跳过复用逻辑，强制新建。
- 不传/false：完全保持旧逻辑。

#### 2.3 为什么迁入草稿需要可选 `sessionId`

旧 `import-transcript` 行为：把草稿阶段对话迁入“该文章最近会话”（不存在则新建）。多会话场景下，前端可能希望把草稿迁入“指定会话”（例如：迁入到刚刚为草稿新建的 session，避免覆盖用户已有历史）。

因此扩展：

- `sessionId` 可选：传入时先校验会话归属与文章绑定，避免误写。
- 不传：保持旧行为。

---

### 3. 接口设计（Controller）

#### 3.1 新增：按文章列出全部会话

接口：

- `GET /assistant/sessions/for-knowledge?knowledgeArticleId=...`

实现代码（逐行注释）：

```ts
// apps/backend/src/services/assistant/assistant.controller.ts

/** 按知识条目标识拉取该文章下全部会话（用于历史记录/切换会话） */
@Get('sessions/for-knowledge') // 1) 路由：/assistant/sessions/for-knowledge
async listSessionsForKnowledge(
  @Req() req: AuthedRequest, // 2) 从 JwtGuard 注入的 req.user 取 userId
  @Query() query: AssistantSessionsForKnowledgeDto, // 3) query 校验：knowledgeArticleId 必填且长度限制
) {
  const userId = req.user?.userId; // 4) 取登录用户 id（与会话数据隔离）
  if (userId == null) { // 5) 未登录兜底（正常情况下 JwtGuard 会拦截；这里保持一致风格）
    return { success: false, message: '未登录' };
  }

  // 6) 调用 service：按文章列出该用户的全部会话（updatedAt 倒序）
  const data = await this.assistantService.listSessionsByKnowledgeArticle(
    userId,
    query.knowledgeArticleId,
  );

  // 7) 返回统一 envelope：success + data
  return { success: true, data };
}
```

#### 3.2 兼容保留：按文章取最近会话（用于“自动恢复”）

接口仍保留：

- `GET /assistant/session/for-knowledge?knowledgeArticleId=...`

它的职责仍是“快速恢复最近会话 + 消息”，在 UI 层（例如切换文章）作为兜底路径。

---

### 4. 业务实现（Service）

#### 4.1 扩展 createSession：支持 `forceNew`

关键逻辑：当 `knowledgeArticleId` 存在且 `forceNew !== true` 时才复用最近会话；否则强制新建。

```ts
// apps/backend/src/services/assistant/assistant.service.ts

async createSession(userId: number, dto?: CreateAssistantSessionDto) {
  const articleId = dto?.knowledgeArticleId?.trim(); // 1) 文章 id：可选，trim 规避空格
  const forceNew = dto?.forceNew === true; // 2) 是否强制新建（默认 false）

  // 3) 兼容旧行为：仅在“传了 articleId 且没要求强制新建”时复用最近会话
  if (articleId && !forceNew) {
    const existingId = await this.findLatestSessionIdByKnowledgeArticle(
      userId,
      articleId,
    );
    if (existingId) {
      const existing = await this.sessionRepo.findOne({
        where: { id: existingId, userId }, // 4) 强制 userId 过滤，避免越权
        select: ['id', 'title'], // 5) 只取必要字段减少开销
      });
      if (existing) {
        // 6) 找到则直接返回旧会话 id：保持旧 API 语义不变
        return { sessionId: existing.id, title: existing.title };
      }
    }
  }

  // 7) 强制新建：生成 uuid 并写入 assistant_sessions
  const id = randomUUID();
  const session = this.sessionRepo.create({
    id,
    userId,
    title: dto?.title?.trim() || null, // 8) 标题可选；为空时后续首轮对话会自动生成
    knowledgeArticleId: articleId || null, // 9) 可绑定文章（用于按文章筛选/恢复）
  });
  await this.sessionRepo.save(session); // 10) 持久化
  return { sessionId: id, title: session.title }; // 11) 返回新会话
}
```

#### 4.2 新增 listSessionsByKnowledgeArticle：返回文章下全部会话

```ts
// apps/backend/src/services/assistant/assistant.service.ts

async listSessionsByKnowledgeArticle(userId: number, knowledgeArticleId: string) {
  const articleId = knowledgeArticleId.trim(); // 1) 规范化输入
  if (!articleId) { // 2) 空值直接判错（避免全表扫描）
    throw new BadRequestException('knowledgeArticleId 不能为空');
  }

  // 3) 查询：限定 userId + knowledgeArticleId，按 updatedAt 倒序
  const list = await this.sessionRepo.find({
    where: { userId, knowledgeArticleId: articleId },
    select: ['id', 'title', 'createdAt', 'updatedAt'], // 4) 仅返回列表展示所需
    order: { updatedAt: 'DESC' },
  });

  // 5) 返回结构：knowledgeArticleId + list
  return {
    knowledgeArticleId: articleId,
    list: list.map((s) => ({
      sessionId: s.id,
      title: s.title,
      createdAt: s.createdAt,
      updatedAt: s.updatedAt,
    })),
  };
}
```

> 说明：这里按 `updatedAt DESC` 排序的目的，是让“最近有消息/最近活跃”的会话排在最前，以匹配历史列表的 UX。

#### 4.3 扩展 importTranscript：支持可选 `sessionId` 并做安全校验

目标：允许前端把草稿迁入到指定 session，同时避免“把 A 文章的草稿导入到 B 文章的会话”。

```ts
// apps/backend/src/services/assistant/assistant.service.ts

async importTranscript(userId: number, dto: ImportAssistantTranscriptDto) {
  const articleId = dto.knowledgeArticleId.trim(); // 1) 目标文章 id
  const targetSid = dto.sessionId?.trim(); // 2) 可选：目标会话 id
  let sessionId: string | null = targetSid || null; // 3) 优先使用用户指定的 sessionId

  // 4) 如果用户指定了 sessionId，先做归属校验与文章绑定校验
  if (sessionId) {
    const owned = await this.sessionRepo.findOne({
      where: { id: sessionId, userId }, // 5) 必须属于当前用户
      select: ['id', 'knowledgeArticleId'],
    });
    if (!owned) {
      throw new NotFoundException('目标会话不存在'); // 6) 指定的会话不存在或不属于该用户
    }

    // 7) 防误写：如果会话已经绑定了文章，必须与 articleId 一致
    if (owned.knowledgeArticleId && owned.knowledgeArticleId !== articleId) {
      throw new BadRequestException('目标会话不属于该知识条目');
    }

    // 8) 如果会话还没绑定文章（knowledgeArticleId 为 null），导入时顺便绑定到 articleId
    if (!owned.knowledgeArticleId) {
      await this.sessionRepo.update(
        { id: sessionId, userId },
        { knowledgeArticleId: articleId },
      );
    }
  }

  // 9) 如果未指定 sessionId，则保持旧行为：取该文章最近会话
  if (!sessionId) {
    sessionId = await this.findLatestSessionIdByKnowledgeArticle(userId, articleId);
  }

  // 10) 如果仍然没有会话，则创建一个新会话
  if (!sessionId) {
    const id = randomUUID();
    await this.sessionRepo.save(
      this.sessionRepo.create({
        id,
        userId,
        title: null,
        knowledgeArticleId: articleId,
      }),
    );
    sessionId = id;
  } else {
    // 11) 兼容旧逻辑：若会话存在，则清空旧消息后再导入（保证导入结果是“当前草稿快照”）
    await this.assertSessionOwned(userId, sessionId);
    await this.messageRepo
      .createQueryBuilder()
      .delete()
      .from(AssistantMessage)
      .where('session_id = :sid', { sid: sessionId })
      .execute();
  }

  // 12) 后续：按 dto.lines 的顺序写入 user/assistant 成对消息，并更新标题/updatedAt
  // （该段逻辑保持不变，本文不重复展开）
}
```

---

### 5. DTO 变更（输入契约）

#### 5.1 CreateAssistantSessionDto：新增 `forceNew`

```ts
// apps/backend/src/services/assistant/dto/create-assistant-session.dto.ts

import { IsBoolean, IsOptional, IsString, MaxLength } from 'class-validator';

export class CreateAssistantSessionDto {
  @IsOptional()              // 1) 可选字段
  @IsString()                // 2) 必须为字符串
  @MaxLength(255)            // 3) 标题最大长度
  title?: string;

  @IsOptional()
  @IsString()
  @MaxLength(1024)           // 4) 与知识条目 id 的长度约束对齐
  knowledgeArticleId?: string;

  @IsOptional()
  @IsBoolean()               // 5) 新增：布尔类型，避免传 'true'/'false' 等字符串歧义
  forceNew?: boolean;        // 6) true：强制新建；false/不传：复用最近会话（兼容旧）
}
```

#### 5.2 ImportAssistantTranscriptDto：新增可选 `sessionId`

```ts
// apps/backend/src/services/assistant/dto/import-assistant-transcript.dto.ts

export class ImportAssistantTranscriptDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(1024)
  knowledgeArticleId!: string; // 1) 目标文章 id（必填）

  @IsOptional()
  @IsString()
  @MaxLength(128)
  sessionId?: string;          // 2) 可选：指定导入到哪个会话（多会话场景）

  @IsArray()
  @ArrayMaxSize(200)           // 3) 最大 200 行：由前端截断保证
  @ValidateNested({ each: true })
  @Type(() => AssistantTranscriptLineDto)
  lines!: AssistantTranscriptLineDto[]; // 4) 对话行（按时间升序）
}
```

#### 5.3 AssistantSessionsForKnowledgeDto：新增列表查询 DTO

```ts
// apps/backend/src/services/assistant/dto/assistant-sessions-for-knowledge.dto.ts

import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

export class AssistantSessionsForKnowledgeDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(1024)
  knowledgeArticleId!: string; // 1) 必填：按文章过滤会话列表
}
```

---

### 6. 验收清单（后端）

- **创建会话兼容**
  - `POST /assistant/session` 不传 `forceNew`：同一 `knowledgeArticleId` 返回最近会话（旧行为）。
  - 传 `forceNew=true`：每次都新建，并返回新的 `sessionId`。

- **历史会话列表**
  - `GET /assistant/sessions/for-knowledge` 返回当前用户、当前文章下全部 session，按 `updatedAt DESC`。

- **草稿迁入**
  - 不传 `sessionId`：迁入到文章最近会话（不存在则新建），保持旧行为。
  - 传 `sessionId`：
    - 会校验会话归属（userId）；
    - 会校验会话绑定文章一致（若已绑定且不一致则拒绝）；
    - 若会话未绑定文章则导入时绑定。

