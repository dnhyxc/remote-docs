### 知识库 RAG（Retrieval Augmented Generation，检索增强生成）后端实现思路

> 覆盖模块：`apps/backend/src/services/knowledge`、`knowledge-embedding`、`knowledge-qa`、`qdrant`。  
> **向量 embedding/rerank 凭证**（SILICONFLOW_*、`KNOWLEDGE_EMBEDDING_MODEL` 等）见 [知识向量创建LLM.md](./知识向量创建LLM.md)；**会员 Qwen3 + 双 Qdrant collection** 见 [知识会员向量分层.md](./知识会员向量分层.md)。本文 §4.3 等 DashScope 描述可能滞后，以该文与源码为准。  
> 说明：文内引用的代码均为**现有代码片段**（用“代码引用块”表示）；额外的“逐点注释/伪代码”仅写在文档里，不会写回仓库源码。

---

### 1. 总览：一条“写入→入库→检索→生成”的完整链路

#### 1.1 写入侧（入库侧）链路

- **入口**：知识库保存/更新接口（MySQL/TypeORM 落库）
- **异步触发**：保存/更新成功后，**不阻塞主流程**，异步触发向量入库（embedding + 写 Qdrant）
- **入库步骤**（顺序非常关键）：
  - Markdown 切分（chunk）
  - 调 DashScope（百炼）Embedding 生成向量
  - 确保 Qdrant collection 存在（不存在则创建）
  - 删除旧 points（按 `knowledgeId` filter）
  - upsert 新 points（每个 chunk 一条 point，payload 带证据字段）

#### 1.2 读取侧（检索问答侧）链路

- **入口**：`POST /api/knowledge/qa/ask`（SSE 流，Server-Sent Events，服务器推送事件）
- **检索步骤**：
  - 将用户问题向量化（复用 `KnowledgeEmbeddingService.embedQuery`）
  - Qdrant `search` 检索 topK
  - 将命中片段拼成上下文（context）
  - 调 GLM（智谱）`/chat/completions` 流式输出（SSE）
  - 将模型 delta 逐段转换为后端 SSE 返回给前端

---

### 2. 模块职责边界（为什么拆成四块）

#### 2.1 `knowledge`：业务 CRUD 与回收站（MySQL）

- **负责**：知识条目增删改查、回收站、与助手会话（AssistantSession）的关联清理。
- **不负责**：embedding 细节、Qdrant SDK 细节、GLM 流式协议细节。

#### 2.2 `knowledge-embedding`：入库流水线（切分→向量化→写入）

- **负责**：chunk 策略、DashScope embedding 调用（含重试/超时/批量）、delete+upsert 覆盖式入库、失败保护日志。
- **不负责**：Controller 形态、前端 UI、QA 提示词、SSE 输出格式。

#### 2.3 `qdrant`：向量库基础设施封装（SDK 适配层）

- **负责**：collection 名、create/delete/upsert/search、filter DSL、协议（http/https）一致性。
- **不负责**：知识库字段业务含义（只把 payload 当作结构化数据存取）。

#### 2.4 `knowledge-qa`：检索问答（SSE + GLM）

- **负责**：事件序列（start/retrieval/delta/done/error）、topK、证据组织、GLM 流式解析与取消。
- **不负责**：知识库 CRUD/回收站细节、embedding 的实现细节（通过 service 复用）。

---

### 3. 写入侧：Knowledge CRUD 如何触发向量入库

#### 3.1 全局路径前缀：最终接口为什么都是 `/api/...`

`main.ts` 设置了全局前缀 `api`，因此 `@Controller('knowledge')` 实际路由为 `/api/knowledge/*`。

文件：`apps/backend/src/main.ts`（L13-L79）

```ts
// 定义应用启动函数：NestJS 应用的入口逻辑
async function bootstrap() {
	// 创建 Nest 应用实例：使用 Express 适配器（NestExpressApplication）
	const app = await NestFactory.create<NestExpressApplication>(AppModule, {
		cors: true,
		rawBody: true,
	});
	// 设置全局路由前缀：所有 Controller 路由都会自动加上 `/api`
	app.setGlobalPrefix("api");
	// 省略：日志、过滤器、Pipe、Swagger 等其它初始化逻辑
	// ...
	// 启动 HTTP 监听：默认端口 9112（或使用环境变量 PORT）
	await app.listen(process.env.PORT ?? 9112);
	// 结束 bootstrap：此处不 return 值，应用进入常驻监听状态
}
```

#### 3.2 Controller：知识库保存/更新入口（JWT + ResponseInterceptor）

知识库模块的 Controller 统一：

- `JwtGuard` 鉴权
- `ResponseInterceptor` 包装响应（注意：该拦截器**不应该**用于 SSE controller，QA 已移除）

文件：`apps/backend/src/services/knowledge/knowledge.controller.ts`（L24-L48）

```ts
// 声明 Controller 的路由前缀：最终路径为 `/api/knowledge/*`
@Controller("knowledge")
// 应用拦截器：序列化（ClassSerializer）+ 统一响应包装（ResponseInterceptor）
@UseInterceptors(ClassSerializerInterceptor, ResponseInterceptor)
// 应用 JWT 鉴权守卫：未登录/无 token 直接拦截
@UseGuards(JwtGuard)
// 导出 Controller 类：提供知识库的 HTTP API
export class KnowledgeController {
	// 声明保存接口：POST /api/knowledge/save
	@Post("save")
	// 处理保存请求：DTO 由 ValidationPipe 自动校验与 transform
	async save(@Body() dto: SaveKnowledgeDto) {
		// 调用 Service：把控制器层与业务/存储逻辑解耦
		return this.knowledgeService.saveMarkdown(dto);
	}

	// 声明更新接口：PUT /api/knowledge/update/:id（注意：DTO 内包含 id）
	@Put("update/:id")
	// 处理更新请求：Controller 仅转发 DTO
	async update(@Body() dto: UpdateKnowledgeDto) {
		// 调用 Service：更新 MySQL 主表并异步触发向量入库
		return this.knowledgeService.update(dto);
	}
	// Controller 其它路由（list/detail/delete/trash）在此省略
}
```

#### 3.3 Service：保存/更新后为什么用 `void safeIndexKnowledge(...)`

保存/更新后触发向量入库的关键点：

- **不 await**：主流程“保存成功”立即返回给用户；
- **失败不影响保存**：embedding/Qdrant 异常只记日志；
- **最终一致性**：向量库更新与 MySQL 更新存在短暂延迟是预期行为。

文件：`apps/backend/src/services/knowledge/knowledge.service.ts`（L46-L95）

```ts
// 新建一条知识库记录：返回 {id} 给前端
async saveMarkdown(dto: SaveKnowledgeDto): Promise<{ id: string }> {
  // 将 entity 保存到 MySQL：TypeORM 会生成主键与时间戳字段
  const saved = await this.knowledgeRepository.save(row);
  // 异步触发向量入库：使用 void 丢弃 Promise，避免阻塞保存主流程
  void this.embeddingService.safeIndexKnowledge({
    // 传入 knowledgeId：作为 Qdrant payload 的主关联键
    knowledgeId: saved.id,
    // 传入 authorId：用于 Qdrant 检索时按用户隔离（filter）
    authorId: saved.authorId ?? null,
    // 传入标题：用于 chunk 输入与证据展示
    title: saved.title ?? null,
    // 传入正文：用于切分与向量化
    content: saved.content ?? '',
    // 传入创建时间：写入 payload 供审计/展示
    createdAt: saved.createdAt,
    // 传入更新时间：写入 payload 供审计/展示
    updatedAt: saved.updatedAt,
  });
  // 返回保存后的 id：供前端跳转详情或后续更新
  return { id: saved.id };
}

// 更新一条知识库记录：返回更新后的 entity
async update(dto: UpdateKnowledgeDto): Promise<Knowledge> {
  // 将更新结果保存到 MySQL：此处 row 已在上文合并了要更新字段
  const saved = await this.knowledgeRepository.save(row);
  // 异步触发向量入库：覆盖式重建该 knowledgeId 的所有 chunks
  void this.embeddingService.safeIndexKnowledge({
    // knowledgeId：用于删除旧向量并写入新向量
    knowledgeId: saved.id,
    // authorId：用于检索隔离与证据归属
    authorId: saved.authorId ?? null,
    // title：更新后标题（可能变化）需要参与 embedding
    title: saved.title ?? null,
    // content：更新后正文需要重新切分与向量化
    content: saved.content ?? '',
    // createdAt：保留原创建时间
    createdAt: saved.createdAt,
    // updatedAt：写入最新更新时间
    updatedAt: saved.updatedAt,
  });
  // 返回更新后的行：供前端刷新详情
  return saved;
}
```

1. 为什么不 await：

- save/update 是用户可感知的主交易；embedding + 向量入库是衍生索引更新，允许延后。

2. 为什么用 safeIndexKnowledge 而不是 indexKnowledge：

- safeIndexKnowledge 捕获异常并打日志，避免未处理 promise rejection。

3. 代价：

- 用户刚保存完立刻提问，可能检索不到（向量仍未写入）；需要 UI/产品层可接受或做“入库完成提示”。

#### 3.4 删除主表条目：`remove` 的现状注意点（MySQL 删除 ≠ 向量删除）

当前 `remove(id)` 的事务逻辑包含“写回收站快照 + 删除 AssistantSession + 删除 Knowledge 主表”，但**不负责**删除向量库中的 points。也就是说：

- MySQL 主表条目被删（条目从列表消失）；
- 该条目对应的向量 points 仍可能存在于 Qdrant（直到后续被显式清理）。

> 重要：本仓库的“向量清理”目前绑定在 **回收站物理删除**（见下一节），而不是绑定在 `remove`。

文件：`apps/backend/src/services/knowledge/knowledge.service.ts`（L98-L127）

```ts
// 删除知识库条目：会在事务中写回收站并删除主表
async remove(id: string): Promise<void> {
  // 开启数据库事务：保证“写回收站 + 删会话 + 删主表”原子性
  await this.knowledgeRepository.manager.transaction(async (manager) => {
    // 省略：写入 KnowledgeTrash 的快照逻辑（把删除前内容保存到回收站）
    // ...写入 KnowledgeTrash...
    // 删除助手会话：避免会话引用不存在的 knowledgeArticleId
    await assistantSessionRepo.delete({ knowledgeArticleId: row.id });
    // 删除主表记录：物理删除 Knowledge
    await knowledgeRepo.delete({ id });
    // 事务函数结束：若无异常则提交
  });
  // remove 结束：返回 void
}
```

#### 3.5 回收站物理删除：删除回收站记录时同步删除向量 points（已实现）

当用户在回收站执行“物理删除”时，系统会：

- 读取回收站行（拿到 `originalId`，即原 Knowledge.id）；
- 调用 `KnowledgeEmbeddingService.deleteKnowledgeVectors({ knowledgeId: originalId })`；
- 在 Qdrant 中按 `payload.knowledgeId == originalId` 删除该条目的全部 points；
- 再删除回收站记录与回收站预览相关的 AssistantSession。

文件：`apps/backend/src/services/knowledge/knowledge.service.ts`（回收站单条/批量物理删除）

```ts
// 回收站单条物理删除：删除回收站行 + 删除会话 + 同步删除向量库 points
async removeTrash(id: string): Promise<void> {
  // 事务：保证“查回收站行→删向量→删会话→删回收站行”整体一致
  await this.knowledgeTrashRepository.manager.transaction(async (manager) => {
    // 获取回收站 repository：用于读取 originalId 与执行 delete
    const trashRepo = manager.getRepository(KnowledgeTrash);
    // 获取会话 repository：用于清理回收站预览产生的 AssistantSession
    const assistantSessionRepo = manager.getRepository(AssistantSession);
    // 先读取回收站行：必须拿到 originalId 才能删向量 points
    const trashRow = await trashRepo.findOne({ where: { id } });
    // 行不存在：直接抛错（与原有语义一致）
    if (!trashRow) {
      throw new NotFoundException('回收站条目不存在');
    }
    // 物理删除回收站条目时，同步清理该知识条目在向量库中的残留
    await this.embeddingService.deleteKnowledgeVectors({
      knowledgeId: trashRow.originalId,
    });
    // 回收站预览会话 id：与前端预览前缀一致
    const articleId = assistantArticleIdForTrashRow(id);
    // 删除与回收站预览绑定的会话
    await assistantSessionRepo.delete({ knowledgeArticleId: articleId });
    // 删除回收站行
    const res = await trashRepo.delete({ id });
    // 兜底：delete 未影响任何行时仍认为不存在
    if (!res.affected) {
      throw new NotFoundException('回收站条目不存在');
    }
  });
}

// 回收站批量物理删除：对 ids 去重后批量删除向量与会话，再删回收站行
async removeTrashBatch(ids: string[]): Promise<{ affected: number }> {
  // 去重与过滤空值
  const uniq = Array.from(new Set(ids)).filter(Boolean);
  // 空数组直接报错：与单条语义对齐
  if (uniq.length === 0) {
    throw new BadRequestException('请至少提供一条要删除的回收站 id');
  }
  // 事务：保证批量删除过程的一致性
  return await this.knowledgeTrashRepository.manager.transaction(async (manager) => {
    // 回收站 repo
    const trashRepo = manager.getRepository(KnowledgeTrash);
    // 会话 repo
    const assistantSessionRepo = manager.getRepository(AssistantSession);
    // 查询回收站行，拿到 originalId 列表
    const rows = await trashRepo.find({
      select: { id: true, originalId: true },
      where: { id: In(uniq) },
    });
    // 提取 originalId 并去重：避免重复删同一 knowledgeId 的 points
    const originalIds = rows.map((r) => r.originalId).filter(Boolean);
    // 批量物理删除回收站条目时，批量清理向量库残留（按 originalId）
    for (const knowledgeId of Array.from(new Set(originalIds))) {
      await this.embeddingService.deleteKnowledgeVectors({ knowledgeId });
    }
    // 删除每个回收站预览对应的会话
    for (const tid of uniq) {
      await assistantSessionRepo.delete({
        knowledgeArticleId: assistantArticleIdForTrashRow(tid),
      });
    }
    // 最后删除回收站行
    const res = await trashRepo.delete({ id: In(uniq) });
    // 返回影响行数：便于上层展示结果
    return { affected: res.affected ?? 0 };
  });
}
```

---

### 4. 入库侧：KnowledgeEmbeddingService 的每一步（切分→向量→写入）

#### 4.1 统一对外接口：`embedQuery` / `embedDocuments`

对 QA 来说只需要 `embedQuery`；对入库来说使用 `embedDocuments`。两者都复用同一套内部 client。

文件：`apps/backend/src/services/knowledge-embedding/knowledge-embedding.service.ts`（L217-L225）

```ts
// 对外暴露单条查询向量：用于 QA 等“单问题”场景
async embedQuery(text: string): Promise<number[]> {
  // 通过内部 client 生成 query embedding：保持与入库同源的向量空间
  return this.createEmbeddingsClient().embedQuery(text);
  // 注意：这里直接 return Promise 结果，由调用方决定 await 时机
}

// 对外暴露批量文档向量：用于入库时对多个 chunk 一次性向量化
async embedDocuments(texts: string[]): Promise<number[][]> {
  // 通过内部 client 批量生成 embeddings：内部会做分批/重试/超时
  return this.createEmbeddingsClient().embedDocuments(texts);
  // 返回二维数组：每个元素是一个 chunk 的向量
}
```

#### 4.1.1 对外暴露：删除某篇知识在向量库中的 points（供回收站物理删除使用）

文件：`apps/backend/src/services/knowledge-embedding/knowledge-embedding.service.ts`（删除向量封装）

```ts
// 对外暴露：删除某篇知识库文档在向量库中的全部 points（供回收站物理删除等场景使用）
async deleteKnowledgeVectors(input: { knowledgeId: string }): Promise<void> {
  // 调用 Qdrant 删除：按 payload.knowledgeId 过滤批量删除
  await this.qdrant.deleteKnowledgePointsByKnowledgeId(input.knowledgeId);
  // 返回 void：上层仅关心“已触发删除/删除完成”，不需要返回点数量
}
```

解释要点：

```ts
// 1) 为什么在 KnowledgeEmbeddingService 暴露 delete 而不是 KnowledgeService 直接调 Qdrant：
//    - 统一向量相关能力入口，后续若要加日志/重试/指标只改一处
// 2) 为什么按 knowledgeId filter 删除：
//    - points.id 当前是随机 UUID，不维护稳定 id 映射；filter 删除最简单可靠
```

#### 4.2 Markdown 切分：标题优先 + 长度兜底 + overlap

目标：把一篇 Markdown 切成多个 chunk，使每个 chunk 长度可控，且跨边界有 overlap，减少语义断裂。

文件：`apps/backend/src/services/knowledge-embedding/knowledge-embedding.service.ts`（L227-L266）

```ts
// 将一篇知识库 Markdown（标题+正文）切分为多个 chunk
chunkMarkdown(input: { title: string; content: string }): KnowledgeChunk[] {
  // 拼接原始文本：标题在前，正文在后，二者之间用空行分隔以增强结构信号
  const raw = `${input.title?.trim() || ''}\n\n${input.content ?? ''}`.trim();
  // 空内容直接返回：避免后续 embedding 与写库产生无意义数据
  if (!raw) return [];

  // target：单 chunk 目标长度（字符数），过长会增加向量化成本并可能触发服务限制
  const target = 1000;
  // overlap：相邻 chunk 的重叠长度，用于降低“切断语义”导致的召回不稳定
  const overlap = 160;
  // 按行拆分：便于识别 Markdown 标题行作为结构边界
  const lines = raw.split(/\r?\n/);

  // blocks：按标题（#~######）切出的结构块（尽量保持标题与其段落内容在同一块）
  const blocks: string[] = [];
  // buf：当前块的行缓冲区
  let buf: string[] = [];
  // 遍历每一行：遇到标题就切块
  for (const line of lines) {
    // 判断是否为 Markdown 标题：1~6 个 # + 空格
    const isHeading = /^#{1,6}\s+/.test(line);
    // 若遇到标题且 buf 已有内容：先把上一块 push 出去，再开始新块
    if (isHeading && buf.length > 0) {
      // 将当前缓冲行合并为一个块，并 trim 去掉首尾空白
      blocks.push(buf.join('\n').trim());
      // 清空缓冲：准备开始收集新块内容
      buf = [];
    }
    // 将当前行加入缓冲：无论是否标题，都属于当前块的一部分
    buf.push(line);
  }
  // 循环结束后，如果还有剩余缓冲：需要补进 blocks
  if (buf.length) blocks.push(buf.join('\n').trim());

  // chunks：最终输出的 chunk 文本数组（会对超长 block 再做滑窗切分）
  const chunks: string[] = [];
  // 遍历每个结构块：短块直接收集，长块进行切分
  for (const b of blocks) {
    // 若块长度不超过 target：直接作为一个 chunk
    if (b.length <= target) {
      // 收集 chunk
      chunks.push(b);
      // 进入下一个 block
      continue;
    }
    // i：滑窗起始下标
    let i = 0;
    // 在 block 内进行滑窗：每次取 [i, i+target) 的片段，并回退 overlap
    while (i < b.length) {
      // end：本次切片结束位置（不超过 block 长度）
      const end = Math.min(b.length, i + target);
      // piece：本次 chunk 文本，去掉首尾空白
      const piece = b.slice(i, end).trim();
      // 非空才加入 chunks：避免产生空 chunk
      if (piece) chunks.push(piece);
      // 下一窗口起点：回退 overlap，制造重叠区域
      i = end - overlap;
      // 防御：避免 i 为负
      if (i < 0) i = 0;
      // 若已经到达末尾：退出循环
      if (end === b.length) break;
    }
  }

  // 将 chunk 文本映射为结构化结果：带 chunkIndex（用于证据引用与定位）
  return chunks.map((text, idx) => ({ chunkIndex: idx, text }));
  // chunkIndex 从 0 开始递增：代表该文档内 chunk 的顺序
}
```

逐点解释（文档注释）：

```ts
// raw = 标题 + 正文：让标题参与 embedding，提升“按标题提问”的召回概率
// blocks：按 Markdown heading 切块，尽量保持结构性（标题下的段落聚合）
// target=1000：单 chunk 文本长度目标（字符级别），避免向量化输入过长导致模型/服务限制
// overlap=160：滑窗回退，减少跨边界切断语义导致的召回下降
// chunkIndex：同一篇文档内的相对位置，用于证据引用与 UI 展示
```

#### 4.3 DashScope embedding client：API Key、origin、endpoint、模型名

文件：`apps/backend/src/services/knowledge-embedding/knowledge-embedding.service.ts`（L56-L90）

```ts
const apiKey = // 读取 API Key：优先使用 DASHSCOPE_API_KEY，其次使用 QWEN_API_KEY 兜底
	this.config.get<string>(KnowledgeQaEnum.DASHSCOPE_API_KEY) || // 从配置读取 DASHSCOPE_API_KEY（百炼）
	this.config.get<string>(ModelEnum.QWEN_API_KEY) || // 从配置读取 QWEN_API_KEY（历史兼容）
	""; // 若都没有则为空字符串，后续会直接抛错
const baseURL = this.config.get<string>(ModelEnum.QWEN_BASE_URL) || undefined; // 读取 QWEN_BASE_URL：用于推导 DashScope 的 origin
if (!apiKey) {
	// 关键前置校验：避免后续“沉默失败”或返回 401 但难定位
	throw new Error(
		"缺少 DASHSCOPE_API_KEY（或 QWEN_API_KEY），无法进行知识库向量入库",
	); // 明确报错：提示缺失配置项
} // 结束 apiKey 校验分支
const model = // 确定 embedding 模型名：允许通过配置覆盖默认值
	this.config.get<string>(KnowledgeQaEnum.KNOWLEDGE_EMBEDDING_MODEL) || // 从配置读取 KNOWLEDGE_EMBEDDING_MODEL
	"qwen3-vl-embedding"; // 默认模型：qwen3-vl-embedding（DashScope 原生多模态向量服务）

const origin = (() => {
	// 计算请求 origin：将各种 baseURL 形式归一化为 origin
	if (!baseURL) return "https://dashscope.aliyuncs.com"; // 未配置 baseURL：直接使用默认 DashScope 国内域名
	try {
		// 尝试用 URL 解析 baseURL：提取 origin
		const u = new URL(baseURL); // 解析 baseURL：获得 hostname/protocol 等字段
		if (
			u.hostname.endsWith("dashscope.aliyuncs.com") ||
			u.hostname.endsWith("dashscope-intl.aliyuncs.com")
		) {
			// 若是官方域名
			u.protocol = "https:"; // 强制使用 https：避免误配为 http 引发协议/SSL 错误
		} // 结束官方域名判断
		return u.origin; // 返回 origin：如 https://dashscope.aliyuncs.com
	} catch {
		// baseURL 不是合法 URL 时进入兜底
		return baseURL; // 兜底返回原字符串：允许用户直接填 origin
	} // 结束 try/catch
})(); // 立即执行：得到 origin 字符串

const endpoint = `${origin}/api/v1/services/embeddings/multimodal-embedding/multimodal-embedding`; // 拼接 DashScope 原生 embedding 服务 endpoint
```

解释要点：

```ts
// 1) apiKey 必须存在：否则直接抛错，避免“沉默失败”
// 2) baseURL 仅用于推导 origin：
//    - 兼容把 QWEN_BASE_URL 配成 compatible-mode/v1 的情况
// 3) 对 dashscope 官方域名强制 https：
//    - 避免错误配置导致协议不一致、SSL 错误
// 4) endpoint 使用 DashScope 原生路径（不是 OpenAI compatible embeddings.create）
```

#### 4.4 可靠性：重试、超时、分批、错误信息结构化

文件：`apps/backend/src/services/knowledge-embedding/knowledge-embedding.service.ts`（L93-L206）

```ts
const callOnce = async (texts: string[]): Promise<number[][]> => {
	// 单次请求：对一批 texts 生成 embedding 向量
	const maxAttempts = 3; // 最大重试次数：用于容忍短暂网络抖动/临时服务错误
	for (let attempt = 1; attempt <= maxAttempts; attempt++) {
		// 逐次尝试：失败则进入下一次重试
		const controller = new AbortController(); // 创建中止控制器：用于实现超时取消
		const timeout = setTimeout(() => controller.abort(), 60_000); // 设置 60s 超时：避免请求永久挂起
		try {
			// try/finally：保证 timeout 总被清理
			// fetch(endpoint, { Authorization: Bearer ... }) // 实际实现：携带 Bearer token 请求 DashScope endpoint
			// resp.ok 检查 + body text 读取 + JSON 解析 + embeddings 结构兼容解析 // 实际实现：把多种返回形态归一为 number[][]
		} finally {
			// 无论成功/失败都执行
			clearTimeout(timeout); // 清理定时器：避免泄漏与误触发 abort
		} // 结束 try/finally
	} // 结束重试循环
	throw new Error("DashScope 向量请求失败：未知错误"); // 理论兜底：若所有尝试都失败则抛出统一错误
}; // 结束 callOnce 定义

const callBatched = async (texts: string[]): Promise<number[][]> => {
	// 分批调用：将大数组拆成多个小 batch 以降低失败概率
	const out: number[][] = []; // 输出向量列表：按输入 texts 的顺序拼接
	const batchSize = 10; // 单批大小：控制请求体积，规避网关/服务端 batch 限制
	for (let i = 0; i < texts.length; i += batchSize) {
		// 遍历分片：步长为 batchSize
		const batch = texts.slice(i, i + batchSize); // 取出当前批次文本
		const vecs = await callOnce(batch); // 调用单批向量化：内部带重试/超时
		out.push(...vecs); // 将本批结果按顺序追加到总输出
	} // 结束分批循环
	return out; // 返回所有向量：二维数组
}; // 结束 callBatched 定义
```

解释要点：

```ts
// 1) maxAttempts=3：网络抖动/临时 5xx 的容错
// 2) 超时 60s：避免单次请求无穷等待占用资源
// 3) batchSize=10：降低“请求体过大/服务端 batch 限制/网关限制”的概率
// 4) 错误信息包含 endpoint + attempt：排障时能快速定位是配置问题还是服务抖动
```

#### 4.5 入库主流程：`indexKnowledge`（覆盖式重建）

文件：`apps/backend/src/services/knowledge-embedding/knowledge-embedding.service.ts`（L276-L324）

```ts
const contentHash = sha256(`${title}\n\n${input.content ?? ""}`); // 计算内容哈希：用于审计/幂等标识（写入 payload）
const chunks = this.chunkMarkdown({ title, content: input.content ?? "" }); // 进行 Markdown 切分：得到多个 chunk（带 chunkIndex）
if (chunks.length === 0) {
	// 若切分后为空：说明内容为空或只有空白
	await this.qdrant.deleteKnowledgePointsByKnowledgeId(input.knowledgeId); // 删除该知识条目的旧向量：避免残留导致误召回
	return { contentHash, chunkCount: 0 }; // 返回入库结果：chunkCount=0 表示向量已清空
} // 结束空 chunk 分支

const vectors = await this.embedDocuments(chunks.map((c) => c.text)); // 对所有 chunk 文本做向量化：得到 vectors 与 chunk 一一对应
const vectorSize = vectors[0]?.length ?? 0; // 取第一条向量维度：用于建 collection（必须一致）
if (vectorSize <= 0) {
	// 若维度非法：说明 embedding 调用失败或解析失败
	throw new Error("embedding 向量维度为 0"); // 直接失败：避免写入错误结构到向量库
} // 结束维度校验

await this.qdrant.ensureKnowledgeCollection({ vectorSize }); // 确保 collection 存在且维度匹配：不存在则创建
await this.qdrant.deleteKnowledgePointsByKnowledgeId(input.knowledgeId); // 覆盖式更新第一步：先删除旧 points（按 knowledgeId filter）
// ...组装 points（id=randomUUID，payload 带 evidence 字段）... // 组装写入点：每个 chunk 一个 point，payload 包含 title/text/chunkIndex 等证据字段
await this.qdrant.upsertKnowledgeChunks({ points }); // 覆盖式更新第二步：批量 upsert 新 points
```

解释要点：

```ts
// 1) contentHash：
//    - 用于审计/幂等判断的内容摘要（当前实现写入 payload，暂未用于“跳过重复入库”）
// 2) chunks.length===0：
//    - 空文档意味着应该删除向量索引，避免旧向量残留
// 3) vectorSize 校验：
//    - 任何异常导致 vectors[0] 不存在会触发维度=0，从而快速失败（比写入错误维度更安全）
// 4) ensureKnowledgeCollection 必须在 delete/upsert 之前：
//    - collection 不存在时 delete/upsert 都会失败；先 ensure 可简化逻辑
// 5) delete + upsert：
//    - 覆盖式重建，避免旧 chunk 残留
```

#### 4.6 失败保护：`safeIndexKnowledge`（不影响 save/update）

文件：`apps/backend/src/services/knowledge-embedding/knowledge-embedding.service.ts`（L326-L345）

```ts
async safeIndexKnowledge(input: Parameters<KnowledgeEmbeddingService['indexKnowledge']>[0]) {
  try {
    return await this.indexKnowledge(input);
  } catch (err) {
    this.logger.error(`... message/cause/stack ...`);
    return null;
  }
}
```

---

### 5. 向量库侧：Qdrant（Vector DB，向量数据库）封装与关键细节

#### 5.1 QdrantClient 的协议坑：为什么要显式设置 `https`

当 `QDRANT_URL=http://localhost:6333` 时，如果 SDK 误用 https，会出现：

- `SSL routines:ssl3_get_record:wrong version number`

因此 module 里通过 URL protocol 显式设置：

文件：`apps/backend/src/services/qdrant/qdrant.module.ts`（L13-L31）

```ts
const url =
	config.get<string>(QdrantEnum.QDRANT_URL) || "http://localhost:6333";
const parsed = new URL(url);
const host = parsed.hostname || "localhost";
const port = Number(parsed.port || 6333);
const https = parsed.protocol === "https:";

return new QdrantClient({
	host,
	port,
	https,
	checkCompatibility: false,
});
```

#### 5.2 collection 命名：默认 `knowledge_chunks_v1`

文件：`apps/backend/src/services/qdrant/qdrant.service.ts`（L42-L51）

```ts
getKnowledgeCollectionName(): string {
  return (
    this.config.get<string>(QdrantEnum.QDRANT_KNOWLEDGE_COLLECTION) ||
    'knowledge_chunks_v1'
  );
}
```

#### 5.3 建表（collection）策略：幂等 ensure

文件：`apps/backend/src/services/qdrant/qdrant.service.ts`（L53-L71）

```ts
async ensureKnowledgeCollection(options: { vectorSize: number }): Promise<void> {
  const name = this.getKnowledgeCollectionName();
  try {
    await this.client.getCollection(name);
  } catch {
    await this.client.createCollection(name, {
      vectors: { size: options.vectorSize, distance: 'Cosine' },
    });
  }
}
```

解释要点：

```ts
// 1) distance=Cosine：文本 embedding 常用余弦相似度
// 2) vectorSize 必须与 embedding 输出维度一致：否则 upsert/search 会报错或结果不可信
// 3) try/catch：把“已存在”视为成功（幂等）
```

#### 5.4 删除策略：按 payload filter 一把删干净

文件：`apps/backend/src/services/qdrant/qdrant.service.ts`（L73-L85）

```ts
async deleteKnowledgePointsByKnowledgeId(knowledgeId: string): Promise<void> {
  const name = this.getKnowledgeCollectionName();
  await this.client.delete(name, {
    filter: { must: [{ key: 'knowledgeId', match: { value: knowledgeId } }] },
  });
}
```

解释要点：

```ts
// 1) 不需要维护旧 point id 列表：直接 filter 删除
// 2) 依赖 payload.knowledgeId：写入端必须保证每个 chunk payload 都带 knowledgeId
```

#### 5.5 upsert 策略：一批 points 批量写入

文件：`apps/backend/src/services/qdrant/qdrant.service.ts`（L87-L103）

```ts
async upsertKnowledgeChunks(input: { points: Array<{ id: string; vector: number[]; payload: QdrantKnowledgePayload }> }): Promise<void> {
  const name = this.getKnowledgeCollectionName();
  await this.client.upsert(name, { points: input.points });
}
```

#### 5.6 检索策略：topK + 可选 authorId filter

文件：`apps/backend/src/services/qdrant/qdrant.service.ts`（L105-L155）

```ts
async searchKnowledgeChunks(input: { vector: number[]; topK: number; authorId?: number | null }) {
  const name = this.getKnowledgeCollectionName();
  const filter = input.authorId
    ? { must: [{ key: 'authorId', match: { value: input.authorId } }] }
    : undefined;
  const res = await this.client.search(name, {
    vector: input.vector,
    limit: input.topK,
    with_payload: true,
    ...(filter ? { filter } : {}),
  });
  return (res as any).map((x: any) => ({ score: x.score, payload: x.payload as QdrantKnowledgePayload, id: x.id }));
}
```

解释要点：

```ts
// 1) with_payload=true：否则上层无法拼 context，也无法给出证据（evidence）
// 2) authorId filter：
//    - 只有传入 authorId 才会 filter
//    - 这是一种“多租户隔离”的最小实现（按作者）
// 3) 返回结构做了 map：
//    - 避免上层直接依赖 SDK 原始类型（减少耦合）
```

---

### 6. 检索问答侧：Knowledge QA 的 SSE 事件协议与 GLM 流式

#### 6.1 Controller：`@Sse()` + `concat(source$, done$)` 的意义

文件：`apps/backend/src/services/knowledge-qa/knowledge-qa.controller.ts`（L17-L49）

```ts
@Controller("knowledge/qa")
@UseInterceptors(ClassSerializerInterceptor)
@UseGuards(JwtGuard)
export class KnowledgeQaController {
	@Post("ask")
	@Sse()
	async ask(
		@Body() dto: AskKnowledgeQaDto,
		@Req() req: Request & { user?: { userId?: number } },
	): Promise<Observable<any>> {
		const authorId = Number(req.user?.userId ?? 0);
		const source$ = await this.qa.askStream({
			question: dto.question,
			authorId,
			topK: dto.topK,
			includeEvidences: dto.includeEvidences,
		});
		const done$ = of({ type: "qa.sse.done" });
		return concat(source$, done$).pipe(
			map((evt) => ({ data: evt })),
			catchError((error) =>
				of({
					data: { type: "qa.error", message: error?.message || "处理失败" },
				}),
			),
		);
	}
}
```

逐点解释（非常重要）：

```ts
// 1) 为什么要用 @Sse：
//    - Nest 会把 Observable 的每个 next() 变成 SSE event（默认以 data: JSON\n\n 发送）
//    - 避免手写 res.write / flush 的易错点
// 2) 为什么 controller 不用 ResponseInterceptor：
//    - ResponseInterceptor 会尝试包裹/序列化响应体，可能破坏 SSE 的逐行输出
// 3) 为什么 map(evt => ({data: evt}))：
//    - Nest SSE 的返回格式需要 { data: any }；data 会被序列化为 SSE 的 data 字段
// 4) 为什么 concat(source$, done$)：
//    - source$ complete 后再发送一个结束标记（qa.sse.done），方便前端稳态收尾
```

#### 6.2 Service：askStream 的事件模型（start/retrieval/delta/done/error）

事件类型定义：

文件：`apps/backend/src/services/knowledge-qa/knowledge-qa.service.ts`（L9-L22）

```ts
export type KnowledgeQaEvidence = {
	knowledgeId: string;
	title: string;
	chunkIndex: number;
	score: number;
	text: string;
};

type QaEvent =
	| { type: "qa.start"; runId: string }
	| { type: "qa.retrieval"; evidences: KnowledgeQaEvidence[] }
	| { type: "qa.delta"; content: string }
	| { type: "qa.done"; evidences: KnowledgeQaEvidence[] }
	| { type: "qa.error"; message: string };
```

解释要点：

```ts
// qa.start：一次提问的 runId（用于前端关联一条流）
// qa.retrieval：可选发送证据（evidences），前端可展示“命中来源”
// qa.delta：模型流式增量 token/文本
// qa.done：收尾（包含最终 evidences，便于 UI 一次性固化引用）
// qa.error：错误（在 SSE 上下文里更适合“发 error 事件并 complete”，避免连接悬挂）
```

#### 6.3 askStream 关键路径：向量化→检索→拼上下文→GLM 流

文件：`apps/backend/src/services/knowledge-qa/knowledge-qa.service.ts`（L127-L223）

```ts
async askStream(input: { question: string; authorId: number; topK?: number; includeEvidences?: boolean }): Promise<Observable<QaEvent>> {
  return new Observable<QaEvent>((subscriber) => {
    const runId = randomUUID();
    const abortController = new AbortController();

    (async () => {
      try {
        subscriber.next({ type: 'qa.start', runId });
        const topK = input.topK ?? Number(this.config.get<string>(KnowledgeQaEnum.KNOWLEDGE_QA_TOPK) || 6);

        const qvec = await this.embedding.embedQuery(input.question);

        const hits = await this.qdrant.searchKnowledgeChunks({ vector: qvec, topK, authorId: input.authorId });
        const evidences: KnowledgeQaEvidence[] = hits.map((h) => ({
          knowledgeId: h.payload.knowledgeId,
          title: h.payload.title,
          chunkIndex: h.payload.chunkIndex,
          score: h.score,
          text: h.payload.text,
        }));

        if (input.includeEvidences !== false) {
          subscriber.next({ type: 'qa.retrieval', evidences });
        }

        if (evidences.length === 0) {
          subscriber.next({ type: 'qa.delta', content: '我在你的知识库中没有检索到与问题直接相关的内容。你可以尝试补充关键词，或先把相关资料保存到知识库后再问我。' });
          subscriber.next({ type: 'qa.done', evidences: [] });
          subscriber.complete();
          return;
        }

        const context = evidences
          .slice(0, Math.min(12, evidences.length))
          .map((e) => `[${e.title}#${e.chunkIndex} | score=${e.score.toFixed(4)}]\n${e.text}`)
          .join('\n\n---\n\n');

        const system = [
          '你是一个企业级知识库检索问答助手。',
          '你必须只基于“已检索到的知识库片段”回答问题；不要编造不存在的事实。',
          '若片段不足以支撑结论，请明确说明“不确定/未找到”，并给出建议的补充信息。',
          '回答使用简体中文；保留英文技术术语，首次出现括号注明中文。',
        ].join('\n');
        const user = `问题：${input.question}\n\n已检索到的知识库片段：\n\n${context}`;

        for await (const text of this.streamGlmChatCompletions({ messages: [{ role: 'system', content: system }, { role: 'user', content: user }], temperature: 0.2, maxTokens: 4096 }, abortController.signal)) {
          if (text) subscriber.next({ type: 'qa.delta', content: text });
        }

        subscriber.next({ type: 'qa.done', evidences });
        subscriber.complete();
      } catch (err) {
        subscriber.next({ type: 'qa.error', message: err instanceof Error ? err.message : String(err) });
        subscriber.complete();
      }
    })().catch((e) => subscriber.error(e));

    return () => {
      abortController.abort();
    };
  });
}
```

逐点解释（按执行顺序）：

```ts
// 1) Observable：SSE 的天然载体，每个 subscriber.next 会变成一次 SSE 推送
// 2) runId：前端可以用它把“同一次提问”的所有事件串起来
// 3) AbortController：
//    - 当客户端断开/取消订阅时，触发 abort，能中断对 GLM 的 fetch 流读取
// 4) topK：
//    - dto.topK 优先，其次配置 KNOWLEDGE_QA_TOPK，最后默认 10（与当前服务端配置枚举注释一致）
// 5) embedding.embedQuery：
//    - 与入库共享同一套 DashScope 调用与错误处理，保证向量空间一致（很重要）
// 6) qdrant.searchKnowledgeChunks：
//    - 必须传 authorId（隔离用户知识库），否则会搜到所有用户的 chunks（取决于写入 authorId 是否为空）
// 7) evidences：
//    - 把 payload 的关键字段拉平，避免 UI/上层依赖 payload 内部结构
// 8) rerank（重排）：
//    - 在“向量召回（粗排）”之后，对候选片段做二次重排（精排），提升最终 Top-K 的相关性质量
//    - rerank 失败时必须回退原召回顺序，保证可用性（不能因为重排挂了就让 QA 挂）
// 9) includeEvidences：
//    - 允许前端关闭“先发一包证据”，减少首包体积（更快看到模型输出）
// 10) 空召回兜底：
//    - 明确告诉用户“没搜到”，并结束流（done）
// 11) context 拼接：
//    - 限制最多 12 条（防止上下文爆炸、成本上升、模型输入过长）
//    - 用分隔线 --- 提升可读性，也便于模型区分片段
// 12) system 提示词：
//    - 强约束“只基于片段回答”，降低幻觉（hallucination，幻觉）
// 13) streamGlmChatCompletions：
//    - 每解析出一段 delta 就发 qa.delta，让前端真正流式展示
```

#### 6.3.1 二次重排（Rerank，重排）：把“向量召回”结果再排序（已接入 QA）

QA 在拿到 Qdrant 的 `hits → evidences` 后，会调用 `KnowledgeEmbeddingService.rerank` 做二次排序。重排过程的核心原则：

- **只改变顺序，不丢证据**：rerank 返回的候选先排前面，未返回的追加到末尾（保证可解释性与完整性）。
- **失败回退**：任何异常只写日志，不影响主链路。

文件：`apps/backend/src/services/knowledge-qa/knowledge-qa.service.ts`（重排片段）

```ts
// 对召回结果进行二次重排（rerank），提升最终相关性；若失败则回退原召回顺序
if (evidences.length > 1) {
  try {
    // 将候选证据序列化为 documents：标题 + chunkIndex + chunk 文本
    const docs = evidences.map(
      (e) => `标题：${e.title}\n分片：#${e.chunkIndex}\n内容：\n${e.text}`,
    );
    // 调用 rerank：query 为用户问题，documents 为候选文本集合
    const reranked = await this.embedding.rerank({
      query: input.question,
      documents: docs,
      topN: Math.min(evidences.length, topK),
    });
    // 若重排返回有效结果：按返回 index 重排 evidences
    if (reranked.length > 0) {
      // used：记录已被 rerank 选中的原下标，避免重复
      const used = new Set<number>();
      // next：新的证据顺序
      const next: KnowledgeQaEvidence[] = [];
      // 先按 rerank 返回顺序放入
      for (const r of reranked) {
        const ev = evidences[r.index];
        if (!ev) continue;
        used.add(r.index);
        next.push(ev);
      }
      // 将未被 rerank 返回的证据追加到末尾，避免丢证据（保持可解释性）
      for (let i = 0; i < evidences.length; i++) {
        if (!used.has(i)) next.push(evidences[i]!);
      }
      // 覆盖 evidences 顺序：后续 context 拼接将使用重排后的顺序
      evidences = next;
    }
  } catch (e) {
    // 忽略重排失败：只记录日志并回退原召回顺序，确保 QA 可用
    this.logger.error(`[askStream]: Failed to rerank evidences: ${JSON.stringify(e)}`);
  }
}
```

#### 6.4 GLM（智谱）流式解析：从 `data:` 行提取 delta

关键点：智谱接口返回 SSE 风格行：`data: {json}\n`，结束为 `data: [DONE]`。

解析与流读取代码：

文件：`apps/backend/src/services/knowledge-qa/knowledge-qa.service.ts`（L41-L125）

```ts
private parseGlmStreamDelta(dataStr: string): string | null {
  if (dataStr.trim() === '[DONE]') return null;
  try {
    const data = JSON.parse(dataStr);
    if (data.choices?.[0]?.delta?.content) {
      return String(data.choices[0].delta.content);
    }
    if (data.choices?.[0]?.message?.content) {
      return String(data.choices[0].message.content);
    }
    return null;
  } catch {
    return null;
  }
}

private async *streamGlmChatCompletions(input: { messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>; temperature?: number; maxTokens?: number }, signal?: AbortSignal) {
  const apiKey = this.config.get<string>(ModelEnum.ZHIPU_API_KEY) || '';
  const baseURL = this.config.get<string>(ModelEnum.ZHIPU_BASE_URL) || 'https://open.bigmodel.cn/api/paas/v4';
  if (!apiKey) throw new Error('智谱 API 密钥未配置（ZHIPU_API_KEY）');
  const url = `${baseURL.replace(/\/$/, '')}/chat/completions`;
  const response = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` }, body: JSON.stringify({ model: this.getGlmModelName(), messages: input.messages, thinking: { type: 'disabled' }, stream: true, max_tokens: input.maxTokens ?? 4096, temperature: input.temperature ?? 0.2 }), ...(signal ? { signal } : {}) });
  if (!response.ok) throw new Error(`智谱 API 请求失败：${response.status} ${await response.text()}`);
  const reader = response.body?.getReader();
  if (!reader) throw new Error('无法读取响应流');
  const decoder = new TextDecoder('utf-8');
  let buffer = '';
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || !trimmed.startsWith('data:')) continue;
        const dataStr = trimmed.slice(5).trim();
        const delta = this.parseGlmStreamDelta(dataStr);
        if (delta) yield delta;
      }
    }
    if (buffer.trim().startsWith('data:')) {
      const dataStr = buffer.trim().slice(5).trim();
      const delta = this.parseGlmStreamDelta(dataStr);
      if (delta) yield delta;
    }
  } finally {
    reader.releaseLock();
  }
}
```

解释要点：

```ts
// 1) parseGlmStreamDelta 同时兼容 delta.content 与 message.content 两种返回形态
// 2) buffer + split('\n')：
//    - 处理 chunk 边界：一次 reader.read 可能拿到半行
// 3) 只处理以 "data:" 开头的行：
//    - SSE 可能还包含 event/id/retry 等字段（这里忽略）
// 4) AbortSignal：
//    - askStream 的 unsubscribe 会 abort，从而中断 fetch（避免后台继续读流浪费资源）
```

---

### 7. 配置项清单（与代码一一对应）

#### 7.1 Qdrant

文件：`apps/backend/src/enum/config.enum.ts`（L76-L83）

```ts
export enum QdrantEnum {
	/** 例如 http://127.0.0.1:6333 */
	QDRANT_URL = "QDRANT_URL",
	/** 可选：Qdrant API Key（云端/托管常用） */
	QDRANT_API_KEY = "QDRANT_API_KEY",
	/** collection 名，默认 knowledge_chunks_v1 */
	QDRANT_KNOWLEDGE_COLLECTION = "QDRANT_KNOWLEDGE_COLLECTION",
}
```

- **QDRANT_URL**：本地一般为 `http://localhost:6333`
- **QDRANT_KNOWLEDGE_COLLECTION**：不配则 `knowledge_chunks_v1`

#### 7.2 DashScope embedding（知识库向量）

文件：`apps/backend/src/enum/config.enum.ts`（L85-L93）

```ts
export enum KnowledgeQaEnum {
	KNOWLEDGE_EMBEDDING_MODEL = "KNOWLEDGE_EMBEDDING_MODEL",
	KNOWLEDGE_QA_MODEL = "KNOWLEDGE_QA_MODEL",
	KNOWLEDGE_QA_TOPK = "KNOWLEDGE_QA_TOPK",
	DASHSCOPE_API_KEY = "DASHSCOPE_API_KEY",
}
```

- **DASHSCOPE_API_KEY**：必配（或配 `QWEN_API_KEY` 兜底）
- **KNOWLEDGE_EMBEDDING_MODEL**：默认 `qwen3-vl-embedding`
- **QWEN_BASE_URL**（在 `ModelEnum`）：用于推导 DashScope origin（可不配，默认 `https://dashscope.aliyuncs.com`）

#### 7.3 GLM（智谱）问答模型

文件：`apps/backend/src/enum/config.enum.ts`（L49-L74）

```ts
export enum ModelEnum {
	ZHIPU_API_KEY = "ZHIPU_API_KEY",
	ZHIPU_MODEL_NAME = "ZHIPU_MODEL_NAME",
	ZHIPU_BASE_URL = "ZHIPU_BASE_URL",
	/** 助手模块专用 GLM 模型名，未配置时回退 ZHIPU_MODEL_NAME 或 glm-4.7 */
	ASSISTANT_GLM_MODEL_NAME = "ASSISTANT_GLM_MODEL_NAME",
}
```

- **ZHIPU_API_KEY**：必配，否则 QA 会直接报错
- **ZHIPU_BASE_URL**：默认 `https://open.bigmodel.cn/api/paas/v4`
- **KNOWLEDGE_QA_MODEL / ASSISTANT_GLM_MODEL_NAME / ZHIPU_MODEL_NAME**：按 `getGlmModelName()` 回退链决定最终模型名

---

### 8. 常见问题与排障清单（按现有实现的“最短路径定位”）

#### 8.1 保存成功但问答检索不到

- **可能原因**：入库是异步触发，Qdrant 还没写完。
- **定位**：看 `KnowledgeEmbeddingService` 的 error 日志是否出现；或在 Qdrant UI/接口中确认 points 数量。

#### 8.2 `fetch failed`（embedding）

现有实现会在网络错误时把 `endpoint` 与 `attempt` 打进错误信息（见 `createEmbeddingsClient.callOnce`）。
重点检查：

- `DASHSCOPE_API_KEY` 是否正确
- `QWEN_BASE_URL` 是否误配成 `http://...`（官方域名强制 https 已做兜底）
- 网络是否能访问 DashScope 域名

#### 8.3 `SSL routines: wrong version number`（Qdrant）

重点检查：

- `QDRANT_URL` 是否是 `http://...`（本地 docker 默认）
- module 已按协议设置 `https = parsed.protocol === 'https:'`（见 `qdrant.module.ts`）

#### 8.4 SSE 无输出/前端一直 pending

关键检查点：

- QA Controller 必须使用 `@Sse()`，并且**不能**套 `ResponseInterceptor`（当前已是这样）
- 返回值必须是 `Observable` 且 map 成 `{ data: evt }`

---

### 9. 现状下的“设计取舍”总结（帮助你做下一步演进）

- **写入一致性**：选择“异步入库 + safeIndexKnowledge”保障主交易可用性；代价是短暂延迟。
- **索引更新策略**：选择“delete + upsert 覆盖式重建”，换取正确性与实现简单；代价是写放大。
- **多用户隔离**：依赖 `authorId` filter；需要确保写入 payload 的 `authorId` 正确填充。
- **可观测性**：目前主要依赖日志；若要更易用，可加“入库任务状态表/队列/BullMQ”。
