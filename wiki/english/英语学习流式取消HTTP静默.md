# 英语学习流取消：前端 `http.post` + `silent` 与后端 SSE / Abort 联动

## 1. 背景与目标

用户在单词包或经典句的 **SSE（Server-Sent Events，服务端推送事件）** 生成过程中点击「停止」时，前端需要：

1. **本地**立刻 `abort` 读流，避免 UI 继续累加内容；
2. **可选地**通知后端释放资源（通过 `streamId` 取消对应生成任务）。

原先若用 `getPlatformFetch` 手写 `POST`，与业务里大量使用的 **`http` 客户端（HttpClient）** 风格不一致，且难以复用统一的 **Base URL**、**鉴权头**、**Tauri 下 fetch 插件** 等逻辑。

**目标**：让取消接口的调用方式与 `generateEnglishVocabularyPack` 等一致，使用 **`http.post(url, body, config)`**；同时避免「用户主动停止 / 流已自然结束」等场景下仍弹出 **错误 Toast（轻提示）**，干扰体验。

---

## 2. 改动范围

| 角色 | 路径 |
|------|------|
| HTTP 请求配置扩展 | `apps/frontend/src/utils/fetch.ts` |
| 取消流 API 封装 | `apps/frontend/src/service/index.ts` |
| 路由常量（无逻辑变更，文档引用） | `apps/frontend/src/service/api.ts` |
| SSE 工具在停止时调用取消 | `apps/frontend/src/utils/englishLearningPackSse.ts`（单词包与经典句共用） |
| Nest 模块注册取消注册表 | `apps/backend/src/services/english-learning/english-learning.module.ts` |
| 取消路由 + 两条 SSE 流入口 | `apps/backend/src/services/english-learning/english-learning.controller.ts` |
| 按 `streamId` 内存登记 `AbortController` | `apps/backend/src/services/english-learning/english-learning-stream-abort.registry.ts` |
| 取消请求 Body 校验（UUID v4） | `apps/backend/src/services/english-learning/dto/cancel-english-learning-stream.dto.ts` |
| 生成循环内消费 `AbortSignal`、中断 LLM | `apps/backend/src/services/english-learning/english-learning.service.ts` |

---

## 3. 实现思路

1. **在 `RequestConfig` 上增加 `silent?: boolean`**  
   表示本次请求在失败路径上**不展示** `Toast` 错误提示，仍正常构造 `RequestError` 并 **rethrow**，便于调用方用 `try/catch` 决定是否吞掉。

2. **在 `HttpClient.request` 的 `catch` 分支中分支 Toast**  
   仅在 `!finalConfig.silent` 时调用 `Toast`。**401（未授权）** 仍执行清 token 与 `notifyUnauthorized()`，与「静默」只针对**错误 Toast** 的语义区分：登出引导不应被静默掉。

3. **`postEnglishLearningStreamCancel`**  
   使用 `http.post(ENGLISH_LEARNING_STREAM_CANCEL, { streamId }, { silent: true })`，与 `generateEnglishVocabularyPack` 的写法对齐；外层 `try/catch` 吞异常，保证**绝不向上抛**，不阻塞调用方已有的 `abort` 流程。

4. **SSE 停止回调**  
   在已有 `serverStreamId` 时 `void postEnglishLearningStreamCancel(serverStreamId)`，**不 await**，避免停止操作被网络拖慢；取消请求失败由服务端与 `silent` 兜底，前端本地仍以 `abort` 为主。

5. **为何不用「全局关 Toast」之类 hack**  
   `silent` 按请求粒度控制，不影响其他接口的错误提示，可维护性更好。

6. **后端：`streamId` + 内存注册表（Registry，注册表）**  
   每条单词包 / 经典句 SSE 连接在控制器内 `randomUUID()` 生成 `streamId`，首帧 `*.progress` 带给前端；同时在 `EnglishLearningStreamAbortRegistry` 中登记 `(userId, streamId) → AbortController`。显式 `POST /english-learning/stream/cancel` 仅在校验 JWT 用户与登记用户一致时对对应 `AbortController` 调用 `abort()`。

7. **后端：双路触发 abort**  
   - **连接断开**：`wireEnglishLearningSseAbort` 监听 `req` / `socket` / `res` 的 `close`、`aborted`、`error`，避免仅依赖单一事件导致 TCP 已断但生成仍跑。  
   - **显式取消**：HTTP `POST stream/cancel` 命中 Registry 后 `abort()`，与断开共用同一个 `AbortController`。

8. **后端：生成任务如何真正停下**  
   `EnglishLearningService.runVocabularyGeneration` / `runClassicQuotesGeneration` 接收 `context.signal`（即上文的 `streamAbort.signal`），在子模型调用与循环中检测 `aborted` 或 `AbortError` 类异常，从而尽快结束 LLM HTTP 与后续逻辑。

9. **后端：`cancelled` 语义**  
   `cancelByStreamId` 若未找到记录或 `userId` 不匹配则返回 `false`（例如流已 `finally` 里 `unregister`、或恶意猜他人 `streamId`）；成功 `abort` 返回 `true`。响应体 `{ success: true, cancelled }` 与前端 `http.post` 泛型一致。

---

## 4. 关键代码与注释（前端 + 后端）

### 4.1 请求配置：`silent` 字段

**来源**：`apps/frontend/src/utils/fetch.ts`（约 L72–L83，`RequestConfig` 接口）

```typescript
// 说明：在 CustomHttpOptions 基础上扩展业务层常用字段
export interface RequestConfig
	extends Omit<CustomHttpOptions, 'method' | 'body'> {
	params?: any[];
	querys?: Record<string, any>;
	data?: any;
	timeout?: number;
	headers?: Record<string, string>;
	// 说明：上传进度，与「静默」无关
	onUploadProgress?: (progress: number) => void;

	/**
	 * 说明：为 true 时，请求进入 catch 后**不弹**错误 Toast。
	 * 典型场景：用户主动取消、或业务上「失败概率高且不应打扰用户」的请求。
	 * 注意：不改为「不抛错」——调用方仍可用 try/catch 处理。
	 */
	silent?: boolean;
}
```

### 4.2 错误处理：401 与 Toast 分支

**来源**：`apps/frontend/src/utils/fetch.ts`（约 L471–L505，`request` 方法内 `catch`）

```typescript
} catch (error) {
	// ... 省略：将 error 归一为 requestError（网络错误 / 业务错误结构）

	const isUnauthorized =
		response?.status === 401 || requestError.code === 401;

	if (isUnauthorized) {
		// 说明：未授权时仍清理登录态并引导重新登录（不受 silent 影响）
		this.setAuthToken('');
		notifyUnauthorized();
	}

	// 说明：仅非静默请求才弹 Toast，避免「用户点停止」仍看到红色错误条
	if (!finalConfig.silent) {
		Toast({
			type: 'error',
			title: resolveRequestErrorToastTitle(requestError),
		});
	}

	// 说明：保持原有行为，继续向外抛，便于上层捕获或统一处理
	throw requestError.data?.data || requestError;
}
```

### 4.3 `http.post` 第三参传入 `silent`

**来源**：`apps/frontend/src/utils/fetch.ts`（约 L516–L523，`post` 方法）

```typescript
// 说明：第三个参数 config 会合并进 request 的 finalConfig，因此可传 { silent: true }
public post<T = any>(
	url: string,
	data?: any,
	config: RequestConfig = {},
): Promise<ResponseData<T>> {
	return this.request<T>('POST', url, { ...config, data });
}
```

### 4.4 服务层：取消流与词汇包写法对齐

**来源**：`apps/frontend/src/service/index.ts`（约 L436–L462）

```typescript
// 说明：与下面「取消流」同属英语学习 service，风格一致：统一 http.post
export const generateEnglishVocabularyPack = async (params: {
	topic: string;
	count?: number;
}) => {
	return await http.post<{ items: EnglishVocabularyItem[] }>(
		ENGLISH_LEARNING_VOCABULARY_PACK,
		params,
	);
};

/**
 * 说明：显式通知后端中止正在进行的单词包 / 经典句 SSE 生成。
 * streamId 需与 SSE progress 事件里下发的服务端流标识一致。
 */
export async function postEnglishLearningStreamCancel(
	streamId: string,
): Promise<void> {
	try {
		await http.post<{ success: boolean; cancelled: boolean }>(
			ENGLISH_LEARNING_STREAM_CANCEL,
			{ streamId },
			// 说明：静默错误 Toast；流已结束、网络抖动时不打扰用户
			{ silent: true },
		);
	} catch {
		// 说明：取消是「尽力而为」，失败不阻塞本地 Reader.cancel / AbortController
	}
}
```

### 4.5 API 路径常量

**来源**：`apps/frontend/src/service/api.ts`（约 L121–L122）

```typescript
/** 说明：POST body 为 { streamId: string }，与后端英语学习模块约定一致 */
export const ENGLISH_LEARNING_STREAM_CANCEL = '/english-learning/stream/cancel';
```

### 4.6 SSE 停止时触发后端取消（摘录）

**来源**：`apps/frontend/src/utils/englishLearningPackSse.ts`（`runEnglishLearningPackSseStream` 返回的 `abort` 闭包末尾，与合并前 `englishVocabularySse` 行为一致）

```typescript
return (fromUser?: boolean) => {
	if (fromUser === true) {
		userAbortRequested = true;
	}
	if (serverStreamId) {
		// 说明：fire-and-forget，不阻塞本地 abort；失败由 silent + 空 catch 消化体验
		void postEnglishLearningStreamCancel(serverStreamId);
	}
	void streamReader?.cancel().catch(() => {});
	controller.abort();
};
```

> 经典句 `streamEnglishClassicQuotes` 与单词包共用同一套 `runEnglishLearningPackSseStream` 返回的 abort 逻辑。

### 4.7 后端模块：将注册表注入 Nest 容器

**来源**：`apps/backend/src/services/english-learning/english-learning.module.ts`（约 L10–L20）

```typescript
@Module({
	imports: [
		// ... 省略：TypeORM 实体、KnowledgeQa 等
	],
	controllers: [EnglishLearningController],
	// 说明：EnglishLearningStreamAbortRegistry 为 @Injectable()，与 Service 并列注册，供 Controller 注入
	providers: [EnglishLearningService, EnglishLearningStreamAbortRegistry],
	exports: [EnglishLearningService],
})
export class EnglishLearningModule {}
```

### 4.8 后端 DTO：`streamId` 必须为 UUID v4

**来源**：`apps/backend/src/services/english-learning/dto/cancel-english-learning-stream.dto.ts`（全文）

```typescript
import { IsNotEmpty, IsString, IsUUID } from 'class-validator';

/**
 * 说明：与 SSE 首包 progress 下发的 streamId 一致；后端用 UUID 收窄格式，避免随意字符串刷注册表。
 */
export class CancelEnglishLearningStreamDto {
	@IsString()
	@IsNotEmpty()
	@IsUUID('4') // 说明：要求 UUID 版本 4，与 randomUUID() 产物一致
	streamId!: string;
}
```

### 4.9 后端注册表：按 `streamId` 查找并 `abort`

**来源**：`apps/backend/src/services/english-learning/english-learning-stream-abort.registry.ts`（全文）

```typescript
import { Injectable, OnModuleDestroy } from '@nestjs/common';

type StreamEntry = {
	userId: number;
	controller: AbortController;
};

/**
 * 说明：单进程内存 Map；多副本部署时，显式 cancel 需跨实例广播（例如 Redis Pub/Sub），否则只能断开本机 SSE。
 */
@Injectable()
export class EnglishLearningStreamAbortRegistry implements OnModuleDestroy {
	private readonly streams = new Map<string, StreamEntry>();

	register(userId: number, streamId: string, controller: AbortController): void {
		this.streams.set(streamId, { userId, controller });
	}

	unregister(streamId: string): void {
		this.streams.delete(streamId);
	}

	/**
	 * 说明：仅当 streamId 存在且 userId 与登记一致时才 abort，防止横向越权取消他人任务。
	 */
	cancelByStreamId(userId: number, streamId: string): boolean {
		const entry = this.streams.get(streamId);
		if (entry == null || entry.userId !== userId) {
			return false;
		}
		entry.controller.abort();
		return true;
	}

	/** 说明：进程退出时尽量中止仍在跑的流，避免悬挂的下游请求 */
	onModuleDestroy(): void {
		for (const { controller } of this.streams.values()) {
			controller.abort();
		}
		this.streams.clear();
	}
}
```

### 4.10 后端：SSE 连接与 `AbortController` 多路绑定

**来源**：`apps/backend/src/services/english-learning/english-learning.controller.ts`（约 L33–L65，`wireEnglishLearningSseAbort`）

```typescript
/**
 * 说明：客户端断开或显式 cancel 时都要中止生成；多事件监听避免某些环境下仅 `req.close` 不可靠。
 */
function wireEnglishLearningSseAbort(
	req: Request,
	streamAbort: AbortController,
): () => void {
	const onDisconnect = () => {
		streamAbort.abort();
	};
	if (req.aborted) {
		queueMicrotask(onDisconnect);
	}
	req.once('close', onDisconnect);
	req.once('aborted', onDisconnect);
	req.once('error', onDisconnect);
	const socket = req.socket;
	if (socket) {
		socket.once('close', onDisconnect);
	}
	const res = (req as Request & { res?: Response }).res;
	if (res) {
		res.once('close', onDisconnect);
	}
	// 说明：返回 teardown：取消监听并在 Observable 退订时再 abort 一次，兜底重复 complete
	return () => {
		req.removeListener('close', onDisconnect);
		req.removeListener('aborted', onDisconnect);
		req.removeListener('error', onDisconnect);
		socket?.removeListener('close', onDisconnect);
		res?.removeListener('close', onDisconnect);
		streamAbort.abort();
	};
}
```

### 4.11 后端路由：`POST english-learning/stream/cancel`

**来源**：`apps/backend/src/services/english-learning/english-learning.controller.ts`（约 L100–L130，`EnglishLearningController` 片段）

```typescript
@Controller('english-learning')
@UseGuards(JwtGuard) // 说明：整控制器 JWT；取消接口依赖 req.user.userId 做隔离
export class EnglishLearningController {
	constructor(
		private readonly englishLearningService: EnglishLearningService,
		private readonly streamAbortRegistry: EnglishLearningStreamAbortRegistry,
	) {}

	/**
	 * 说明：不依赖 TCP 断开是否及时上报；与 SSE 首帧 progress 中的 streamId 对齐。
	 */
	@Post('stream/cancel')
	async cancelActiveStream(
		@Req() req: AuthedRequest,
		@Body() dto: CancelEnglishLearningStreamDto,
	) {
		const userId = req.user?.userId;
		if (userId == null) {
			throw new UnauthorizedException('未授权');
		}
		const cancelled = this.streamAbortRegistry.cancelByStreamId(
			userId,
			dto.streamId,
		);
		return { success: true, cancelled };
	}
}
```

### 4.12 后端 SSE：登记、下发 `streamId`、传入 `signal`、清理

**来源**：`apps/backend/src/services/english-learning/english-learning.controller.ts`（约 L197–L302，`vocabularyPackStream`；经典句 `classicQuotesStream` 结构相同，事件名为 `classic.*`）

```typescript
@Post('vocabulary-pack/stream')
@Sse()
@Header('X-Accel-Buffering', 'no')
@Header('Cache-Control', 'no-cache, no-transform')
vocabularyPackStream(
	@Req() req: AuthedRequest,
	@Body() dto: GenerateVocabularyDto,
): Observable<{ data: Record<string, unknown> }> {
	const userId = req.user?.userId;
	if (userId == null) {
		throw new UnauthorizedException('未授权');
	}
	const target = resolveVocabularyPackTargetCount(dto.count);
	const streamId = randomUUID(); // 说明：与会话一一对应，前端保存后用于 cancel
	return new Observable((subscriber) => {
		const streamAbort = new AbortController();
		this.streamAbortRegistry.register(userId, streamId, streamAbort);
		const detachSseAbort = wireEnglishLearningSseAbort(req, streamAbort);
		const emit = (data: Record<string, unknown>) => {
			try {
				subscriber.next({ data });
			} catch {
				streamAbort.abort();
			}
		};
		emit({
			type: 'vocab.progress',
			streamId,
			collected: 0,
			target,
			round: 0,
		});
		void (async () => {
			try {
				const items =
					await this.englishLearningService.runVocabularyGeneration(
						dto,
						async (p) => {
							emit({ type: 'vocab.progress', streamId, /* ... */ });
							// ... 省略：chunk 与 saveVocabularyPackBatch
						},
						{
							userId,
							signal: streamAbort.signal, // 说明：与显式 cancel / 断开共用同一 signal
							onAgentTool: async (ev) => {
								emit({ type: 'vocab.agent_tool', streamId, /* ... */ });
							},
						},
					);
				emit({ type: 'vocab.complete', success: true, streamId, items, requested: target });
			} catch (e: unknown) {
				emit({ type: 'vocab.error', success: false, message: /* ... */ });
			} finally {
				this.streamAbortRegistry.unregister(streamId);
				detachSseAbort();
				subscriber.complete();
			}
		})();
		return () => {
			detachSseAbort();
			this.streamAbortRegistry.unregister(streamId);
		};
	});
}
```

### 4.13 后端 Service：`signal` 贯穿子模型调用（摘录）

**来源**：`apps/backend/src/services/english-learning/english-learning.service.ts`（约 L868–L906，`invokeEnglishPackSubModelJson` 片段）

```typescript
/**
 * 说明：硅基流动 JSON 子模型；signal 与 SSE 的 AbortController 相连，abort 后尽快抛错退出上层循环。
 */
private async invokeEnglishPackSubModelJson(params: {
	system: string;
	user: string;
	maxTokens: number;
	priorThread?: BaseMessage[];
	/** 说明：与 SSE / 显式 cancel 联动，中止子模型 HTTP 请求 */
	signal?: AbortSignal;
}): Promise<string> {
	if (params.signal?.aborted) {
		const err = new Error('Aborted');
		err.name = 'AbortError';
		throw err;
	}
	const llm = this.buildSiliconFlowJsonLlm(params.maxTokens, params.signal);
	// ... 省略：组装 messages
	const res = await llm.invoke(msgs, { signal: params.signal });
	// ...
	return /* 解析后的 JSON 字符串 */;
}
```

> `runVocabularyGeneration` / `runClassicQuotesGeneration` 内部在多轮生成中反复检查 `context?.signal?.aborted` 并将 `signal` 传入工具 / LLM 调用；细节见同文件中带 `signal` 与 `isAbortLike` 的分支。

---

## 5. 兼容性与影响

- **破坏性**：无。未传 `silent` 的请求行为与改前一致（失败仍 Toast）。
- **语义**：`silent` 仅抑制**错误 Toast**，不改变 HTTP 方法、URL、body 与抛错行为（除仍走原有 `throw` 路径）。
- **401**：取消接口若返回 401，用户仍会走 `notifyUnauthorized()`，与是否 `silent` 无关。
- **后端部署**：`EnglishLearningStreamAbortRegistry` 为**单进程内存**；多副本时，若 SSE 与 `POST stream/cancel` 落到不同实例，`cancelled` 可能为 `false`，此时仍依赖客户端断开连接触发 `wireEnglishLearningSseAbort`（本机）或需引入跨实例取消机制。

---

## 6. 建议回归场景

1. 单词包 SSE 生成中点击停止：本地内容立即停止增长，**不应**出现因取消接口失败导致的错误 Toast（可故意断网验证静默）。
2. 经典句 SSE 同上。
3. 其他普通接口失败：仍应正常弹出错误 Toast（确认未误传 `silent`）。
4. 生成中调用取消：后端响应 `cancelled: true`；在流已自然结束后再调一次取消，期望 `cancelled: false` 且不报错。
5. 使用他人 `streamId` 或伪造 UUID：应 `cancelled: false`（无法越权 abort 他人任务）。

---

## 7. 相关源码路径速查

| 说明 | 路径 |
|------|------|
| `silent` 与 `HttpClient` | `apps/frontend/src/utils/fetch.ts` |
| 取消流封装 | `apps/frontend/src/service/index.ts` |
| 路径常量 | `apps/frontend/src/service/api.ts` |
| 单词包 / 经典句 SSE（共用模块） | `apps/frontend/src/utils/englishLearningPackSse.ts` |
| Nest 模块 | `apps/backend/src/services/english-learning/english-learning.module.ts` |
| 控制器：取消 + SSE + `wireEnglishLearningSseAbort` | `apps/backend/src/services/english-learning/english-learning.controller.ts` |
| `streamId` → `AbortController` 注册表 | `apps/backend/src/services/english-learning/english-learning-stream-abort.registry.ts` |
| 取消 Body DTO | `apps/backend/src/services/english-learning/dto/cancel-english-learning-stream.dto.ts` |
| 生成与 `AbortSignal` / LLM | `apps/backend/src/services/english-learning/english-learning.service.ts` |

---

## 8. 附录：SSE 客户端合并为 `englishLearningPackSse.ts`

原先拆分为 `englishVocabularySse.ts` 与 `englishClassicQuotesSse.ts` 的两套 **读流、`processLine`、`abort` + `postEnglishLearningStreamCancel`** 逻辑，已合并为单一模块 **`apps/frontend/src/utils/englishLearningPackSse.ts`**：通过 `PackSseDefinition<TItem>` 与 `runEnglishLearningPackSseStream` 参数化 `vocab.*` / `classic.*` 与 `parseItems`，对外仍导出 `streamEnglishVocabularyPack`、`streamEnglishClassicQuotes`。与本文 **`http.post` + `silent`** 正交：取消请求在 `service/index.ts`，本附录仅说明「谁在什么时机调用取消」。

**专题文档（实现思路 + 带注释代码摘录）**：[英语词包SSE.md](./英语词包SSE.md)

---

若与仓库最新源码不一致，以源码为准。
