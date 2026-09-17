# Tauri HttpClient 全方法网络重试 — 影响点分析

## 延伸阅读

- [HTTP网络错误提示.md](../app/HTTP网络错误提示.md) — 重试仍失败时的 Toast 脱敏与 i18n（**展示层**不变）
- [Tauri HTTP全方法重试.md](../tauri/Tauri HTTP全方法重试.md) — 本篇对应的实现说明与代码对比
- [英语学习列表网络重试.md](../english/英语学习列表网络重试.md) — 首轮 Tauri GET/HEAD 重试、`retryAsync`、收藏 `/status` 分批（**部分描述已滞后**，见 §7）
- [TTS桌面端云端播放影响.md](./TTS桌面端云端播放影响.md) — 同轮 diff 中 Edge TTS 播放修复（**独立主题**，不重复矩阵）

**阅读约定**：结论以仓库 **当前源码** 为准；「历史风险」指旧实现曾出现的问题（如线上桌面频繁 Toast「网络异常，请检查网络后重试」），不代表现行代码仍会触发。

## 1. 分析目的

评估 **`apps/frontend/src/utils/fetch.ts` HttpClient 重试与错误分支调整** 是否改变或破坏已有 HTTP 能力：

- **全站 `http` 单例**（`service/index.ts`、登录、电子书、知识库、TTS 设置、英语练习等经 `HttpClient` 的请求）
- **Tauri 桌面 vs Web 浏览器**（`isTauriRuntime()` 分支）
- **读请求 GET/HEAD**（改前已有 Tauri 默认 2 次重试）
- **写请求 POST/PUT/PATCH/DELETE**（改前 Tauri 默认 0 次重试）
- **瞬时网络错误判定**（`isTransientNetworkError`、`canRetry` 内 `!response` 门槛）
- **HTTP 4xx/5xx 与 401**（有 `response` 时不重试、错误体解析）
- **Toast 与 `silent: true`**（最终失败才弹；文案仍走 `resolveRequestErrorToastTitle`）
- **业务层二次重试**（`retryAsync`、`useLibraryWordsList` 的 `retries: 2`、收藏 `/status` 分批）
- **SSE / 流式 fetch**（`sse.ts`、`assistantSse.ts` 等若直连 `fetch` 则**不经过**本改动）

**改动范围（当前 diff，本主题）**：

| 文件 | 变更 |
|------|------|
| `apps/frontend/src/utils/fetch.ts` | Tauri 下**所有 HTTP 方法**默认 `retries: 2`（改前仅 GET/HEAD）；`catch` 优先识别已构造的 `RequestError`；`handleErrorResponse` 复用已解析 body，避免重复读空响应流 |

（同轮 diff 中的 `speech.ts`、`api.ts`、版本号文件属 **TTS 播放** 主题，见 [TTS桌面端云端播放影响.md](./TTS桌面端云端播放影响.md)。）

**结论摘要**：

| 维度 | 是否影响原有功能 | 说明 |
|------|------------------|------|
| **Web 浏览器** 全站 HTTP | **否** | `defaultRetries` 仍为 0；`catch` / `handleErrorResponse` 为正确性修复，成功路径与改前一致 |
| **Tauri GET/HEAD** | **低（增强）** | 默认仍 2 次重试；`catch` 顺序修复避免 4xx 被误当网络错误二次包装 |
| **Tauri POST/PUT/PATCH/DELETE** | **有条件变化** | 仅在 **`!response` + 瞬时网络错误** 时最多再试 2 次（总 3 次尝试）；有 HTTP 响应或 401 仍不重试 |
| **Tauri 非幂等写**（登录、收藏增删、上传等） | **有条件变化** | 同上：仅「请求未到达服务端」类失败会重试；若服务端已处理但客户端未收到响应，理论上存在重复副作用风险（与 GET 重试同类 ponytail 取舍） |
| **Toast「网络异常，请检查网络后重试」** | **低（增强）** | 瞬时失败多被吞掉于重试环，最终失败次数减少；文案与脱敏逻辑未改 |
| **显式 `retries: 0` 或业务层 `retryAsync`** | **否** | `finalConfig.retries ?? defaultRetries` 仍允许调用方覆盖；service / Hook 层额外重试叠加规则不变 |
| **SSE / 非 HttpClient fetch** | **否** | 代码路径未触达 `HttpClient.request` |

---

## 2. 改动要点（相对改前行为）

### 2.1 Tauri 默认重试范围：GET/HEAD → 全方法

**改前**：

```text
defaultRetries = isTauriRuntime() && (GET || HEAD) ? 2 : 0
→ Tauri 下 POST 登录、Edge TTS、收藏增删等写请求：瞬时 `error sending request` 即失败，立刻 Toast
```

**改后**：

```text
defaultRetries = isTauriRuntime() ? 2 : 0
canRetry 仍要求：attempt 未用尽 && !response && !401 && isTransientNetworkError(...)
→ 仅「未收到 HTTP 响应」的瞬时失败才重试；退避 400ms × (attempt+1)
```

**动机**：线上 Tauri 访问远程 HTTPS（如 `https://dnhyxc.cn:9112`）时，**不限于读请求**，POST 同样高频出现原生层 `error sending request`；改前写请求 0 重试导致用户感知为「网络一直异常」。

### 2.2 `catch` 分支顺序：先认 `RequestError`

**改前**：`if (response)` 优先 → 对 `!response.ok` 已 `throw` 的 `RequestError` 可能再次进入 `handleErrorResponse(response, error)`，重复读 body 或错误类型混淆。

**改后**：若 `error` 已含 `code` + `message`（`handleErrorResponse` 抛出），直接当作 `RequestError`；否则再按 `response` / 纯网络错误分流。

**动机**：4xx/5xx 应稳定映射为业务错误，不应再走 `handleNetworkError` 或二次解析。

### 2.3 `handleErrorResponse` 复用已解析 body

**改前**：第二参数名为 `error`，成功路径里 `throw` 前已 `parseResponseBody`，`catch` 内可能再次 `parseResponseBody(response)`（流已消费 → 空 body / 警告）。

**改后**：第二参数为 `parsedBody`；`!response.ok` 分支传入已解析的 `responseData`；仅在未传入时才读流。

---

## 3. 影响点矩阵

| 模块 / 场景 | 影响等级 | 分析 |
|-------------|----------|------|
| **Tauri 登录 / 注册 / 重置密码**（`service/index.ts` → `http.post`） | 低 | 瞬时 `!response` 失败会多试最多 2 次，减少误报 Toast；若服务端已创建会话但响应丢失，极端情况下可能重复提交（改前不重试则直接失败） |
| **Tauri Edge / MiniMax / 讯飞 TTS**（`speech.ts` → `http.post`） | 低 | 与线上「TTS 请求偶发网络 Toast」同源；重试后更易拿到 MP3，配合 [TTS桌面端云端播放影响.md](./TTS桌面端云端播放影响.md) 播放链路 |
| **Tauri 收藏增删**（非幂等 POST） | 低 | 文档 [`英语学习列表网络重试.md`](../english/英语学习列表网络重试.md) 曾写「add/remove 不重试」——**HttpClient 层**现对 Tauri 瞬时 `!response` 会重试；`/status` 查询仍主要靠 service 层 `retryAsync` |
| **Tauri GET 列表 / 分页**（资源库、收藏、电子书书架） | 低 | 行为与改前基本一致（原本即有 2 次默认重试）；`catch` 修复使 4xx 错误信息更准确 |
| **Tauri 401 未授权** | 无 | `canRetry` 排除 401；仍清 token + `notifyUnauthorized()`，与改前一致 |
| **Tauri 4xx/5xx 业务错误** | 无 | 有 `response` → `canRetry` 为 false；不重试，Toast 展示后端 message（或 i18n 兜底） |
| **Web 全站 HTTP** | 无 | `isTauriRuntime()` 为 false 时 `defaultRetries === 0` |
| **`silent: true` 请求** | 无 | 仍不弹 Toast；仅重试次数可能增加（Tauri 写请求） |
| **Hook 显式 `retries: 2`**（`useLibraryWordsList`） | 无 | 与默认值相同，总尝试次数不变 |
| **service 层 `retryAsync` 包裹的 `/status` 批** | 无 | 在 HttpClient 之外独立重试；HttpClient 多试一层仅叠加在单批 HTTP 上 |
| **SSE 流**（`assistantSse.ts` 等） | 无 | 不经过 `HttpClient.request` 重试环 |

---

## 4. 潜在风险与缓解

| 风险 | 等级 | 说明 | 建议验证 |
|------|------|------|----------|
| **非幂等 POST 重复提交** | 低 | 仅 `!response` 时重试；服务端已处理、客户端未收到响应的极端竞态下可能重复（如双收藏、重复注册尝试） | Tauri 弱网下快速连点「收藏」/「注册」；查后端是否出现重复记录 |
| **重试拉长写请求等待** | 低 | 最多 3 次尝试 + 400ms/800ms 退避，失败路径多 ~1.2s | 断网环境下点 TTS / 登录，确认最终 Toast 时机可接受 |
| **与业务层 `retryAsync` 叠加** | 低 | 单操作可能 HttpClient 3 次 × 外层 retryAsync 3 次 | 收藏列表 `/status` 弱网 spot check，确认无异常长时间挂起 |
| **文档仍写「仅 GET/HEAD 重试」** | 低 | 姊妹稿未同步 | 见 §7；以 `fetch.ts` 源码为准 |

---

## 5. 未改动项

| 项 | 说明 |
|----|------|
| **`isTransientNetworkError` 规则** | 仍匹配 `error sending request`、`failed to fetch`、`timeout` 等；未扩大为任意 Error |
| **`canRetry` 门槛** | 仍要求 `!response`；有 HTTP 状态码的请求不重试 |
| **Web 默认不重试** | 浏览器路径 `defaultRetries === 0` |
| **Toast 文案与脱敏** | `handleNetworkError` / `resolveRequestErrorToastTitle` / `translateSync` 未改 |
| **`RequestConfig.retries` 覆盖** | 调用方可显式 `retries: 0` 关闭 HttpClient 重试 |
| **SSE / 原生 upload 进度** | 未改 `buildFormDataAsync`、超时、`getPlatformFetch` |
| **后端 API 契约** | 无新参数、无新 endpoint |

---

## 6. 回归清单

- [ ] **Tauri 线上**：弱网或飞行模式切换下，POST 登录 / Edge TTS / 收藏增删 — 瞬时失败应自动重试，少出现「网络异常，请检查网络后重试」
- [ ] **Tauri**：故意错误密码登录 — 应展示业务错误 Toast，**不应**无限重试
- [ ] **Tauri**：401 过期 token 请求 — 仍跳转/通知未授权，不重试
- [ ] **Web**：同上 POST/GET — 行为与改前一致（失败即 Toast，无默认重试）
- [ ] **Tauri GET** 资源库首屏 / 加载更多 — 仍正常；4xx 时错误信息完整
- [ ] **Tauri** 收藏 `/status` 星标 — 弱网下渐进亮星仍正常（service + Hook 路径）
- [ ] **`silent: true`** 列表请求 — 仍无 HttpClient 层 Toast
- [ ] `cd apps/frontend && npx tsc --noEmit`

---

## 7. 相关文档滞后

| 文档 | 说明 |
|------|------|
| `docs/english/英语学习列表网络重试.md` | §1.2 / §1.4 / §P1 仍写「Tauri 下 GET/HEAD 默认 retries: 2」；§1.3 P9 行「刻意不重试 add/remove POST」与改后 HttpClient 行为不一致 — **以 `fetch.ts` 为准** |
| `docs/app/HTTP网络错误提示.md` | §1.2「重试逻辑不变」指 Toast 层；HttpClient **默认重试范围**已扩大至 Tauri 全方法 |

---

（若与仓库最新源码不一致，以源码为准）
