# 会员默认模型 + 按用户大模型配置

> **文档角色**：本轮将 `createLlm` 默认凭证按**会员状态**分流（会员 → 硅基流动 env，非会员 → 智谱 GLM env），并将设置页持久化由**全局 singleton** 改为**每用户一行**；前端设置页同步会员默认与 GLM 预设。  
> **延伸阅读**：[LLM运行时设置.md](./LLM运行时设置.md)（设置页持久化初版，现以本文为准）、[创建LLM.md](./创建LLM.md)（工厂与 preset）、[../pay/Stripe会员计费.md](../pay/Stripe会员计费.md)（会员开通与到期）。

若与仓库最新源码不一致，**以源码为准**。

---

## 1. 背景与目标

### 1.1 问题

- 此前 `llm_runtime_config` 为**单行 singleton**（`id = 1`），任一用户保存自定义配置会影响**全站所有用户**。
- 默认 env 凭证未区分会员：非会员与会员共用同一套 GLM 或硅基回退，与产品「会员享受硅基默认模型」不一致。
- `createLlm` 为同步函数且未传 `userId` 时，无法在解析链中判定会员或读取对应用户的 DB 配置。

### 1.2 目标

1. **按用户隔离**：每个登录用户在 `llm_runtime_config` 拥有独立一行（主键 `user_id`）。
2. **默认凭证分层**（未开启或未配齐自定义配置时）：
   - **有效会员** → `SILICONFLOW_API_KEY` / `SILICONFLOW_BASE_URL` / `SILICONFLOW_MODEL_NAME`
   - **非会员** → `GLM_API_KEY` / `GLM_BASE_URL` / `GLM_MODEL_NAME`
3. **自定义配置优先**：该用户若在设置页启用且三字段齐全，仍覆盖上述 env 默认。
4. **前端对齐**：设置页默认回显、恢复默认、预设列表与后端策略一致；切换 Base URL / 模型时清空 API Key，避免误用其它服务商密钥。

---

## 2. 改动范围

| 区域 | 路径 |
|------|------|
| LLM 工厂 | `apps/backend/src/utils/create-llm.ts` |
| 用户级配置服务 | `apps/backend/src/services/llm-config/*` |
| 会员判定 | `apps/backend/src/services/user/user.service.ts` |
| 各业务 `createLlm` 调用 | `chat` / `assistant` / `agent` / `knowledge-qa` / `english-learning` |
| 表结构迁移 | `apps/backend/src/migrations/1781115737011-key.ts` |
| 设置页 UI | `apps/frontend/src/views/setting/llm/index.tsx` |
| i18n / env 类型 | `zh-CN.ts`、`en-US.ts`、`vite-env.d.ts` |

---

## 3. 实现思路

### 3.1 凭证解析优先级（每个 userId 独立）

```text
createLlm(config, { preset, userId, ... }, llmConfigService)
  → resolveSiliconFlowCredentials(config, preset, userId)
       ① 该 userId 在 DB 中 enabled 且 Key/URL/Model 齐全 → 返回用户自定义三元组
       ② 否则 isUserMembershipActive(userId) → SILICONFLOW_* env preset
       ③ 否则 → GLM_* env preset
```

**要点**：

- 无 `userId` 或未登录场景**不读**用户 DB 配置，直接走 ② / ③。
- 会员判定读库并调用 `syncMembershipIfExpired`，与资料页、支付开通逻辑一致。

### 3.2 数据表：singleton → per-user

- 实体主键改为 `userId`（列名 `user_id`），移除 singleton `id` 与 `updated_by`。
- 迁移 `1781115737011-key.ts`：新建 `llm_runtime_config(user_id PK, ...)`。
- 进程内快照 `llm-runtime-snapshot.store.ts` 改为 `Map<userId, snapshot>`，避免用户 A 的配置进入用户 B 的请求。

### 3.3 API 行为

- `GET/PUT/DELETE /settings/llm` 均从 JWT 取 `userId`，只读写**当前用户**行。
- 接口路径与响应字段不变，前端无需改 API 封装，只需已登录并带 Bearer Token。

### 3.4 前端设置页

- 使用公共 Hook **`useMembershipActive()`**（`apps/frontend/src/hooks/useMembershipActive.ts`）判定有效会员，与后端 `isMembershipActive` 及资料页一致；详见 [../pay/会员激活钩子.md](../pay/会员激活钩子.md)。
- `getProviderDefaults(isMember)`：会员默认硅基 URL/模型/Key，非会员默认 GLM。
- 预设列表增加**智谱 GLM**；切换 Base URL 或模型名称时 `resetApiKey()` 清空 Key。
- 本地开发可通过 `VITE_GLM_*`、`VITE_SILICONFLOW_*` 预填（须 `VITE_` 前缀方可在浏览器读取）。

### 3.5 权衡

| 方案 | 未采用原因 |
|------|------------|
| 继续全局 singleton + 前端传 membership 标志 | 无法隔离多用户自定义配置 |
| 每次 `createLlm` 直查 DB、无缓存 | 可接受但增加延迟；现采用按 userId 懒加载 + 内存缓存 |
| 会员默认仍走 GLM | 与产品「会员硅基」不一致 |

---

## 4. 关键代码与注释

### 4.1 按 userId 解析凭证

**来源**：`apps/backend/src/services/llm-config/llm-config.service.ts`（约 L127–L146）

```typescript
/** 供 createLlm 使用：用户自定义配置 > 有效会员 SILICONFLOW_* > 非会员 GLM_* */
async resolveSiliconFlowCredentials(
	config: ConfigService,
	preset: SiliconFlowLlmPreset,
	userId?: number,
): Promise<SiliconFlowCredentials> {
	// ① 仅查当前 userId 的快照/DB 行
	const snapshot = await this.getActiveSnapshotForUser(userId);
	if (snapshot) {
		return {
			apiKey: snapshot.apiKey,
			baseURL: snapshot.baseUrl,
			modelName: snapshot.modelName,
		};
	}
	// ② / ③ 按会员状态选择 env preset 链
	const isMember = await this.userService.isUserMembershipActive(userId);
	const resolveOptions = isMember
		? memberSiliconFlowResolvePresetsForPreset(preset)(config)
		: siliconFlowResolvePresetsForPreset(preset)(config);
	return resolveEnvSiliconFlowCredentials(config, resolveOptions);
}
```

### 4.2 会员判定（读库 + 过期校正）

**来源**：`apps/backend/src/services/user/user.service.ts`（约 L119–L137）

```typescript
async isUserMembershipActive(userId?: number | null): Promise<boolean> {
	if (userId == null || !Number.isFinite(userId) || userId <= 0) {
		return false;
	}
	const user = await this.userRepository.findOne({ where: { id: userId } });
	if (!user) return false;
	// 过期则写回 isMember=false，与资料页展示一致
	const synced = await this.syncMembershipIfExpired(user);
	return this.isMembershipActive(synced);
}

isMembershipActive(user: User, now = new Date()): boolean {
	if (!user.isMember) return false;
	if (user.memberExpiresAt == null) return true; // 未设到期视为有效
	return user.memberExpiresAt > now;
}
```

### 4.3 createLlm 异步化并传入 userId

**来源**：`apps/backend/src/utils/create-llm.ts`（约 L282–L306）

```typescript
export async function createLlm(
	config: ConfigService,
	options: CreateLlmOptions, // 含 userId?: number
	resolver?: LlmCredentialResolver,
): Promise<ChatOpenAI> {
	const { preset, userId, /* ... */ } = options;

	// 注入 LlmConfigService 时走异步 per-user 解析
	const credentials = resolver
		? await resolver.resolveSiliconFlowCredentials(config, preset, userId)
		: resolveSiliconFlowCredentials(
				config,
				siliconFlowResolvePresets[preset](config), // 无 resolver 时仅非会员 GLM 链
			);
	// ... 构造 ChatOpenAI
}
```

各业务在调用处传入 JWT 对应的 `userId` 并 `await createLlm`（如 `chat.controller` → `chat.service.chatStream(dto, userId)`）。

### 4.4 实体与按用户快照

**来源**：`apps/backend/src/services/llm-config/llm-runtime-config.entity.ts`（全文）

```typescript
@Entity('llm_runtime_config')
export class LlmRuntimeConfig {
	@PrimaryColumn({ name: 'user_id', type: 'int' })
	userId!: number; // 每用户一行，不再使用 id=1 singleton

	@Column({ type: 'boolean', default: false })
	enabled!: boolean;
	// baseUrl、modelName、apiKeyEnc ...
}
```

**来源**：`apps/backend/src/services/llm-config/llm-runtime-snapshot.store.ts`（约 L9–L32）

```typescript
const loadedUserIds = new Set<number>();
const activeSnapshotsByUserId = new Map<number, LlmRuntimeSnapshot>();

export function setLlmRuntimeSnapshot(
	userId: number,
	snapshot: LlmRuntimeSnapshot | null,
): void {
	loadedUserIds.add(userId);
	if (snapshot) activeSnapshotsByUserId.set(userId, snapshot);
	else activeSnapshotsByUserId.delete(userId);
}
```

### 4.5 前端：会员默认与切换清空 Key

**来源**：`apps/frontend/src/views/setting/llm/index.tsx`（约 L65–L79、L131–L157）

```typescript
/** 有效会员默认硅基流动，否则默认 GLM（与后端 createLlm 一致） */
function getProviderDefaults(isMember: boolean): LlmProviderDefaults {
	if (isMember) {
		return {
			baseUrl: readEnvSiliconflowBaseUrl(),
			modelName: readEnvSiliconflowModelName(),
			apiKey: readEnvSiliconflowApiKey(),
		};
	}
	return {
		baseUrl: readEnvGlmBaseUrl(),
		modelName: readEnvGlmModelName(),
		apiKey: readEnvGlmApiKey(),
	};
}

const onBaseUrlChange = useCallback((next: string) => {
	if (next.trim() === baseUrl.trim()) return;
	setBaseUrl(next);
	resetApiKey(); // 切换服务商时清空 Key，避免 GLM Key 误用于硅基
	// ...
}, [baseUrl, resetApiKey]);
```

---

## 5. 兼容性与影响

| 项 | 说明 |
|----|------|
| **破坏性** | 旧 singleton 表需执行迁移；若曾用 singleton 保存配置，需各用户重新在设置页保存（或运维手工按 `user_id` 导入） |
| **API** | 路径与 JSON 字段不变；行为变为 per-user |
| **未登录** | 无用户 DB 配置；`userId` 缺失时仅用 env + 非会员 GLM 链 |
| **自定义配置** | 仍对该用户全局模块（对话、助手、Agent、英语学习等）生效，但**不再**影响其它账号 |

---

## 6. 建议回归

1. **用户 A / 用户 B**：分别保存不同 Base URL + 模型，交叉对话验证互不影响。
2. **会员 / 非会员**：关闭自定义配置，确认默认分别走硅基 / GLM（需服务端配置对应 env）。
3. **设置页**：切换预设后 API Key 被清空；保存后仅当前账号生效。
4. **会员到期**：到期后默认凭证应回落 GLM（无需重新登录时可刷新设置页或发起新对话验证）。

---

## 7. 相关源码路径

| 说明 | 路径 |
|------|------|
| 凭证工厂 | `apps/backend/src/utils/create-llm.ts` |
| 用户配置 CRUD + 解析 | `apps/backend/src/services/llm-config/llm-config.service.ts` |
| 控制器（JWT userId） | `apps/backend/src/services/llm-config/llm-config.controller.ts` |
| 表迁移 | `apps/backend/src/migrations/1781115737011-key.ts` |
| 设置页 | `apps/frontend/src/views/setting/llm/index.tsx` |
