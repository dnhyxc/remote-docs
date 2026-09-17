# Tauri HttpClient 全方法瞬时网络重试 — 实现说明

**文档角色**：修复线上桌面端频繁 Toast「网络异常，请检查网络后重试」的 HttpClient 层改动。影响面见 [../impact/Tauri HTTP重试影响.md](../impact/Tauri HTTP重试影响.md)。Toast 脱敏与 i18n 见 [HTTP网络错误提示.md](../app/HTTP网络错误提示.md)；首轮 GET 重试背景见 [../english/英语学习列表网络重试.md](../english/英语学习列表网络重试.md)（其中「仅 GET/HEAD」描述已滞后，以本篇为准）。

## 1. 背景与目标

### 1.1 用户视角

**Tauri 桌面端**访问远程 HTTPS API 时，原生 HTTP 插件偶发抛出 `error sending request for url (...)`（**未收到 HTTP 响应**）。改前 HttpClient 仅对 **GET/HEAD** 默认额外重试 2 次；**POST/PUT** 等写请求（登录、Edge TTS、收藏增删等）**0 重试**，瞬时失败即弹 `common.networkErrorTryAgain`，用户感知为「网络一直异常」。Web 浏览器路径默认不重试，问题少见。

### 1.2 本轮目标

| 层级 | 目标 |
|------|------|
| 默认重试 | Tauri 下**所有 HTTP 方法**默认 `retries: 2`（总尝试 3 次） |
| 安全门槛 | 仍仅在 `canRetry`：`!response` + 非 401 + `isTransientNetworkError` 时重试 |
| 错误分支 | `catch` 先识别已构造的 `RequestError`；`handleErrorResponse` 复用已解析 body |
| Web | 行为不变（`defaultRetries === 0`） |

## 2. 改动范围

| 说明 | 路径 |
|------|------|
| HttpClient 重试与错误处理 | `apps/frontend/src/utils/fetch.ts` |
| 瞬时错误判定（未改逻辑，仍被引用） | `apps/frontend/src/utils/retryAsync.ts` → `isTransientNetworkError` |

## 3. 实现思路

1. **扩大默认重试范围**：删除 `isIdempotentRead` 分支；`defaultRetries = isTauriRuntime() ? 2 : 0`。注释标明 ponytail 取舍：写请求在 `!response` 时重试与读请求同类，极端「服务端已处理、客户端未收到响应」竞态可接受。
2. **不重试有响应的错误**：`canRetry` 仍要求 `!response`；4xx/5xx、401 不会进入重试环。
3. **`catch` 顺序**：`!response.ok` 路径已 `parseResponseBody` 并 `throw errorInfo`（`RequestError`）；改后优先 `if ('code' in error && 'message' in error)`，避免再次 `handleErrorResponse` 读空流。
4. **`handleErrorResponse`**：第二参数由 `error` 改为 `parsedBody`；成功路径传入 `responseData`，fallback 的 `data` 字段也改为 `parsedBody`。
5. **调用方覆盖**：`RequestConfig.retries` 仍可显式设为 `0`；业务层 `retryAsync`（如收藏 `/status` 分批）叠加规则不变。

## 4. 关键代码对比与注释

### 4.1 `handleErrorResponse`（`apps/frontend/src/utils/fetch.ts`）

**对比范围**：`HttpClient` 私有方法 `handleErrorResponse` 全函数。

**改动前** · `apps/frontend/src/utils/fetch.ts`（基线，约 L362–L398）

```typescript
// 根据 HTTP 响应构造业务 RequestError（旧版第二参数误命名为 error）
private async handleErrorResponse(
	response: Response,
	error?: any,
): Promise<RequestError> {
	try {
		// 无论是否已在 try 内解析过，此处总是再次读 response body
		const responseBody = await this.parseResponseBody(response);

		// 后端返回 JSON 对象时映射 code/message/data
		if (responseBody && typeof responseBody === 'object') {
			return {
				code: responseBody.code || response.status || 500,
				message:
					responseBody.message ||
					responseBody.error ||
					response.statusText ||
					'请求失败',
				data: responseBody,
				error: responseBody.error,
				success: responseBody.success,
			};
		} else if (responseBody && typeof responseBody === 'string') {
			// 纯文本错误体
			return {
				code: response.status || 500,
				message: responseBody || response.statusText || '请求失败',
				data: responseBody,
			};
		}
	} catch (parseError) {
		// 解析失败仅打 warn，走下方 fallback
		console.warn('Failed to parse error response:', parseError);
	}

	// fallback：data 误用 catch 传入的 error（常为 undefined 或非 body）
	return {
		code: response.status || 500,
		message: response.statusText || '请求失败',
		data: error,
	};
}
```

**改动后** · `apps/frontend/src/utils/fetch.ts`（当前，约 L362–L400）

```typescript
// 根据 HTTP 响应构造业务 RequestError（第二参数为已解析 body，可选）
private async handleErrorResponse(
	response: Response,
	parsedBody?: unknown,
): Promise<RequestError> {
	try {
		// 若调用方已 parse，直接复用，避免 Response 流二次读取为空
		const responseBody =
			parsedBody !== undefined
				? parsedBody
				: await this.parseResponseBody(response);

		// 后端返回 JSON 对象时映射 code/message/data
		if (responseBody && typeof responseBody === 'object') {
			return {
				code: responseBody.code || response.status || 500,
				message:
					responseBody.message ||
					responseBody.error ||
					response.statusText ||
					'请求失败',
				data: responseBody,
				error: responseBody.error,
				success: responseBody.success,
			};
		} else if (responseBody && typeof responseBody === 'string') {
			// 纯文本错误体
			return {
				code: response.status || 500,
				message: responseBody || response.statusText || '请求失败',
				data: responseBody,
			};
		}
	} catch (parseError) {
		// 解析失败仅打 warn，走下方 fallback
		console.warn('Failed to parse error response:', parseError);
	}

	// fallback：data 使用 parsedBody（可能为 undefined）
	return {
		code: response.status || 500,
		message: response.statusText || '请求失败',
		data: parsedBody,
	};
}
```

**变更摘要**：参数语义修正为「已解析 body」；`!response.ok` 分支传入 `responseData` 后不再重复读流；fallback `data` 与参数一致。

### 4.2 `request` 默认重试与 `catch` 分流（`apps/frontend/src/utils/fetch.ts`）

**对比范围**：`request` 方法内「构建 `requestOptions` 之后」至 `catch` 结束（重试环核心；前后 URL/body 构建未改，对称省略）。

**改动前** · `apps/frontend/src/utils/fetch.ts`（基线，约 L489–L581）

```typescript
		// ...（未改动：requestOptions 构建，method/body/headers）

		// 旧版：仅 Tauri 的 GET/HEAD 默认多 2 次重试
		const isIdempotentRead = method === 'GET' || method === 'HEAD';
		const defaultRetries = isTauriRuntime() && isIdempotentRead ? 2 : 0;
		const retryCount = finalConfig.retries ?? defaultRetries;
		const maxAttempts = retryCount + 1;

		for (let attempt = 0; attempt < maxAttempts; attempt++) {
			let response: Response | null = null;

			try {
				await new Promise((resolve) => setTimeout(resolve, 0));

				const platformFetch = await getPlatformFetch();
				response = await platformFetch(finalUrl, requestOptions);

				const responseData = await this.parseResponseBody(response);

				if (!response.ok) {
					const errorInfo = await this.handleErrorResponse(
						response,
						responseData,
					);
					throw errorInfo;
				}

				// ...（未改动：成功 return 分支）

			} catch (error) {
				let requestError: RequestError;

				// 旧版：有 response 时优先进入 handleErrorResponse，可能覆盖已 throw 的 RequestError
				if (response) {
					requestError = await this.handleErrorResponse(response, error);
				} else if (
					error &&
					typeof error === 'object' &&
					'code' in error &&
					'message' in error
				) {
					requestError = error as RequestError;
				} else {
					requestError = this.handleNetworkError(error);
				}

				const isUnauthorized =
					response?.status === 401 || requestError.code === 401;

				if (isUnauthorized && !finalConfig.silent) {
					this.setAuthToken('');
					notifyUnauthorized();
				}

				const canRetry =
					attempt < maxAttempts - 1 &&
					!response &&
					!isUnauthorized &&
					(isTransientNetworkError(error) ||
						isTransientNetworkError(requestError.message));

				if (canRetry) {
					await new Promise((resolve) =>
						setTimeout(resolve, 400 * (attempt + 1)),
					);
					continue;
				}

				if (!finalConfig.silent) {
					Toast({
						type: 'error',
						title: resolveRequestErrorToastTitle(requestError),
					});
				}

				throw requestError.data?.data || requestError;
			}
		}

		throw new Error('请求失败');
```

**改动后** · `apps/frontend/src/utils/fetch.ts`（当前，约 L489–L587）

```typescript
		// ...（未改动：requestOptions 构建，method/body/headers）

		// ponytail: 线上 Tauri 远程 HTTPS 对所有方法均可能 error sending request；canRetry 要求 !response
		const defaultRetries = isTauriRuntime() ? 2 : 0;
		const retryCount = finalConfig.retries ?? defaultRetries;
		const maxAttempts = retryCount + 1;

		for (let attempt = 0; attempt < maxAttempts; attempt++) {
			let response: Response | null = null;

			try {
				await new Promise((resolve) => setTimeout(resolve, 0));

				const platformFetch = await getPlatformFetch();
				response = await platformFetch(finalUrl, requestOptions);

				const responseData = await this.parseResponseBody(response);

				if (!response.ok) {
					const errorInfo = await this.handleErrorResponse(
						response,
						responseData,
					);
					throw errorInfo;
				}

				// ...（未改动：成功 return 分支）

			} catch (error) {
				let requestError: RequestError;

				// 新版：先认 !response.ok 已 throw 的 RequestError
				if (
					error &&
					typeof error === 'object' &&
					'code' in error &&
					'message' in error
				) {
					requestError = error as RequestError;
				} else if (response) {
					requestError = await this.handleErrorResponse(response, error);
				} else {
					requestError = this.handleNetworkError(error);
				}

				const isUnauthorized =
					response?.status === 401 || requestError.code === 401;

				if (isUnauthorized && !finalConfig.silent) {
					this.setAuthToken('');
					notifyUnauthorized();
				}

				const canRetry =
					attempt < maxAttempts - 1 &&
					!response &&
					!isUnauthorized &&
					(isTransientNetworkError(error) ||
						isTransientNetworkError(requestError.message));

				if (canRetry) {
					await new Promise((resolve) =>
						setTimeout(resolve, 400 * (attempt + 1)),
					);
					continue;
				}

				if (!finalConfig.silent) {
					Toast({
						type: 'error',
						title: resolveRequestErrorToastTitle(requestError),
					});
				}

				throw requestError.data?.data || requestError;
			}
		}

		throw new Error('请求失败');
```

**变更摘要**：Tauri 写请求获得与读请求相同的默认重试；`catch` 先处理 `RequestError`；`canRetry` / Toast / 401 逻辑未改。

### 4.3 `RequestConfig.retries` JSDoc（`apps/frontend/src/utils/fetch.ts`）

**对比范围**：接口字段注释（约 L87–L92）。

**改动前** · 注释写「Tauri 下 GET/HEAD 为 2，其余为 0」。

**改动后** · 注释写「Tauri 下为 2；Web 为 0；仅 `!response` 时重试」。

**变更摘要**：文档与实现对齐；类型签名未变，对外 API 兼容。

## 5. 兼容性与影响

| 场景 | 变化 |
|------|------|
| Web 任意方法 | 无（仍 0 默认重试） |
| Tauri GET/HEAD | 低：重试次数不变；4xx 错误信息更准确 |
| Tauri POST 等 | 有条件：`!response` 瞬时失败多试 2 次；有响应不重试 |
| 显式 `retries: 0` | 无 |
| SSE / 非 HttpClient | 无 |

## 6. 相关源码路径

| 说明 | 路径 |
|------|------|
| HttpClient | `apps/frontend/src/utils/fetch.ts` |
| 瞬时错误 | `apps/frontend/src/utils/retryAsync.ts` |
| 全站 HTTP 入口 | `apps/frontend/src/service/index.ts` → `http` |
| 影响面矩阵 | `docs/impact/Tauri HTTP重试影响.md` |

---

（若与仓库最新源码不一致，以源码为准）
