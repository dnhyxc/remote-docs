# 插件上架偏好按账号持久化（Web/桌面跨端同步）

## 1. 背景与目标

原实现中，插件「上架/下架」状态与 plugins-registry.json catalog 的 `plugins[].enabled` 字段绑定——开关切换时直接整份写回远端 JSON，导致：

- **全局污染**：一个用户关闭插件，所有用户都受影响（同一 remotes 文件共享）
- **切换账号残留**：A 关了插件，切到 B 账号仍看到旧的 localStorage 缓存态
- **Web / 桌面不同步**：两端各读各的 localStorage，体验割裂
- **无法默认全关**：catalog 必须为每个插件写 enabled，否则默认不上架

本轮改造把「实际上架/下架」从 catalog 拆出，改为**按用户 ID 保存在服务端**，前端内存缓存 + 账号切换时重拉，默认全部关闭。仅保留 catalog 的 `enabled` 作为「目录建议默认值」，不再被写回。

---

## 2. 改动范围

后端新增：
- `apps/backend/src/migrations/1785431795367-plugins-prefs.ts`（建表迁移）
- `apps/backend/src/services/plugin-prefs/plugin-user-prefs.entity.ts`
- `apps/backend/src/services/plugin-prefs/dto/upsert-plugin-enabled-prefs.dto.ts`
- `apps/backend/src/services/plugin-prefs/plugin-prefs.service.ts`
- `apps/backend/src/services/plugin-prefs/plugin-prefs.controller.ts`
- `apps/backend/src/services/plugin-prefs/plugin-prefs.module.ts`
- `apps/backend/src/app.module.ts`（注册 PluginPrefsModule）

前端新增：
- `apps/frontend/src/service/pluginEnabledPrefs.ts`（HTTP 封装）
- `apps/frontend/src/plugins/core/pluginEnabledPrefs.ts`（缓存、迁移、同步核心）

前端改动：
- `apps/frontend/src/service/api.ts`（新增 `SETTINGS_PLUGIN_ENABLED` 常量）
- `apps/frontend/src/plugins/core/enabledOverrides.ts`（`isPluginEnabled` 切到内存缓存）
- `apps/frontend/src/plugins/core/registry.ts`（新增 `overlayUserEnabled`；`persistPluginEnabled` 写服务端偏好而非 catalog）
- `apps/frontend/src/plugins/core/PluginManager.ts`（init 预加载；`syncEnabledShells` 切号重挂；过滤用 `isPluginEnabled`）
- `apps/frontend/src/plugins/core/hostSurface.ts`（surface 过滤切到 `isPluginEnabled`）
- `apps/frontend/src/plugins/index.ts`（导出 `overlayUserEnabled`）
- `apps/frontend/src/store/user.ts`（setUserInfo / clearUserInfo 拉取偏好并同步壳）
- `apps/frontend/src/store/resetUserState.ts`（清插件偏好缓存）
- `apps/frontend/src/views/plugins/index.tsx`（偏好 overlay + 订阅更新 + 错误文案统一）
- `apps/frontend/src/i18n/locales/zh-CN.ts` + `en-US.ts`（描述文案调整为默认全关说明）

---

## 3. 实现思路

1. **数据分层**：
   - catalog（plugins-registry.json）= 静态插件清单 + 元信息（version、remote、trust）；`enabled` 仅为「目录建议默认」，Host 不再依赖
   - `plugin_user_prefs`（MySQL，按 userId 一行）= 当前账号真实启用列表 `enabledIds: string[]`
2. **运行时 overlay**：前端任何需要看 enabled 的地方（列表、过滤、渲染 UI）都用 `overlayUserEnabled(registry)` 或 `isPluginEnabled(id)`，不直接读 catalog 的 `enabled` 字段，避免两端语义混用。
3. **三层缓存**：
   - 内存 `cachedUserId + cachedIds`（Set<string>），同步读，零开销
   - 并发去重 `loadPromise`，避免组件树并行触发多次 HTTP
   - 旧 localStorage 一次性迁移：服务端空 + 本地有旧数据时迁到服务端后删除
4. **乐观写回**：`setPluginEnabledPref` 先改内存，再发 PUT；失败时不回滚（避免服务端 5xx 瞬间把用户开关全冲掉），但响应为空时保留乐观缓存。
5. **切号生命周期**：
   - `resetUserState` 只清缓存，不做壳操作（确保旧 userId 内存不泄漏到新账号）
   - `setUserInfo` 在 `userId` 落盘后调用 `syncPluginShellsAfterUserChange`：拉取偏好 → 调 `pluginManager.syncEnabledShells()` → 挂/卸路由 + 侧栏 → `notifyPluginEnabled` 通知 UI 刷新
   - `clearUserInfo` 传 `userId=0` 触发「全部关闭」的壳卸载
6. **默认值**：未登录 / 无偏好 / 拉取失败 → `cachedIds = Set([])` → 所有插件默认下架，符合「默认全关、用户按需开启」的安全语义。

---

## 4. 关键代码对比与注释

### 4.1 后端数据库迁移（新建）

**新增** · `apps/backend/src/migrations/1785431795367-plugins-prefs.ts`（约 L1–L13）

```typescript
// 引入 TypeORM 迁移接口，提供 up/down 两个钩子
import { MigrationInterface, QueryRunner } from "typeorm";

// 迁移类名带时间戳 1785431795367，name 字段显式声明保证 TypeORM 在 migrations 表里可识别
export class PluginsPrefs1785431795367 implements MigrationInterface {
    // 显式 name 字段，TypeORM 1785431795367 版本以此作为迁移唯一标识
    name = 'PluginsPrefs1785431795367'

    // up：建表 plugin_user_prefs；user_id 为主键，每用户一行
    public async up(queryRunner: QueryRunner): Promise<void> {
        // CREATE TABLE：user_id 整型主键、enabled_ids JSON 存启用 id 列表、updated_at 自动更新时间戳
        await queryRunner.query(`CREATE TABLE \`plugin_user_prefs\` (\`user_id\` int NOT NULL, \`enabled_ids\` json NOT NULL, \`updated_at\` timestamp(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6), PRIMARY KEY (\`user_id\`)) ENGINE=InnoDB`);
    }

    // down：DROP TABLE，与 up 严格对称以便回滚
    public async down(queryRunner: QueryRunner): Promise<void> {
        // 反向操作删除整张表
        await queryRunner.query(`DROP TABLE \`plugin_user_prefs\``);
    }

}
```

### 4.2 后端 Entity 定义（新建）

**新增** · `apps/backend/src/services/plugin-prefs/plugin-user-prefs.entity.ts`（约 L1–L15）

```typescript
// 引入 TypeORM 装饰器：列、实体、主键列、自动更新时间戳
import { Column, Entity, PrimaryColumn, UpdateDateColumn } from 'typeorm';

// JSDoc 说明该实体的业务含义：每用户一行存启用插件 id 列表
/** 用户级插件上架偏好（enabled 插件 id 列表），每用户一行 */
// 映射 MySQL 表名 plugin_user_prefs，与迁移中 CREATE TABLE 一致
@Entity('plugin_user_prefs')
export class PluginUserPrefs {
	// user_id 作为主键：每用户最多一行，INT 类型；与 JWT userId 类型对齐
	@PrimaryColumn({ type: 'int', name: 'user_id' })
	userId!: number;

	// JSDoc：空数组 = 全部关闭；JSON 类型支持灵活扩展（未来可排序、分组）
	/** 已上架的插件 id；空数组 = 全部关闭 */
	// enabled_ids 列，JSON 类型，与迁移一致；运行时是 string[]
	@Column({ name: 'enabled_ids', type: 'json' })
	enabledIds!: string[];

	// updated_at 自动管理：save 时自动写当前时间；前端可用来比较是否需要重新拉取
	@UpdateDateColumn({ name: 'updated_at', type: 'timestamp' })
	updatedAt!: Date;
}
```

### 4.3 后端 DTO（新建）

**新增** · `apps/backend/src/services/plugin-prefs/dto/upsert-plugin-enabled-prefs.dto.ts`（约 L1–L9）

```typescript
// 引入 class-validator 校验装饰器：数组校验、字符串校验、最大长度
import { IsArray, IsString, MaxLength } from 'class-validator';

// JSDoc 说明语义：整份覆盖，不是增量；避免前端做 patch 造成并发冲突
/** 全量覆盖当前账号已上架插件 id 列表 */
export class UpsertPluginEnabledPrefsDto {
	// 顶层必须是数组
	@IsArray()
	// 数组每一项必须是字符串
	@IsString({ each: true })
	// 单个插件 id 最大 64 字符，防止 DB JSON 被脏数据撑大；与前端 normalizeIds 的 slice(0, 64) 对齐
	@MaxLength(64, { each: true })
	// 字段名 enabledIds 与前端 PUT body 保持一致；NestJS ValidationPipe 基于此校验
	enabledIds!: string[];
}
```

### 4.4 后端 Service（新建）

**新增** · `apps/backend/src/services/plugin-prefs/plugin-prefs.service.ts`（约 L1–L60）

```typescript
// 引入 Nest 依赖注入与未授权异常
import { Injectable, UnauthorizedException } from '@nestjs/common';
// 引入 TypeORM 仓库注入装饰器与 Repository 泛型
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
// 引入 DTO 的类型（仅用作类型，不耦合校验逻辑——校验在 controller 层由 pipe 完成）
import type { UpsertPluginEnabledPrefsDto } from './dto/upsert-plugin-enabled-prefs.dto';
// 引入实体
import { PluginUserPrefs } from './plugin-user-prefs.entity';

// 给外部返回视图用的类型，与前端 PluginEnabledPrefsView 同构，保证前后端字段名一致
export type PluginEnabledPrefsView = {
	enabledIds: string[];
};

@Injectable()
export class PluginPrefsService {
	// 构造器注入 PluginUserPrefs 的仓库
	constructor(
		// 通过 TypeOrmModule.forFeature 注册后由 Nest 容器注入
		@InjectRepository(PluginUserPrefs)
		private readonly repo: Repository<PluginUserPrefs>,
	) {}

	// 私有方法：统一校验 userId 合法性，避免所有方法里重复写判断
	private assertUserId(userId?: number): number {
		// 空值、非有限数、<=0 都判定为未登录
		if (userId == null || !Number.isFinite(userId) || userId <= 0) {
			// 抛 401，与 JwtGuard 失败时的异常类一致，前端统一处理
			throw new UnauthorizedException('请先登录后再试');
		}
		// 返回安全的 number 值
		return userId;
	}

	// 私有方法：规范化 enabledIds；脏数据（非数组、非字符串、超长度、重复）一律过滤
	private normalizeIds(raw: unknown): string[] {
		// 非数组直接返回空；避免 JSON 被前端意外塞成对象
		if (!Array.isArray(raw)) return [];
		// 用 seen 做去重，防止前端重复 id 导致数组臃肿与后续 setPluginEnabledPref 行为不一致
		const seen = new Set<string>();
		const out: string[] = [];
		// 遍历每个元素
		for (const item of raw) {
			// 非字符串跳过（可能被手改 JSON 注入对象）
			if (typeof item !== 'string') continue;
			// trim 去掉前后空白，再截 64 字符，与 DTO MaxLength 对齐
			const id = item.trim().slice(0, 64);
			// 空字符串或重复项跳过
			if (!id || seen.has(id)) continue;
			// 记录已见
			seen.add(id);
			// 追加到输出
			out.push(id);
		}
		// 返回干净数组
		return out;
	}

	// 对外：GET /settings/plugin-enabled 用；返回当前用户视图
	async getView(userId?: number): Promise<PluginEnabledPrefsView> {
		// 先校验 userId，401 直接抛
		const id = this.assertUserId(userId);
		// findOne 按主键查；不存在返回 undefined
		const row = await this.repo.findOne({ where: { userId: id } });
		// 无论是否存在都走 normalizeIds，保证返回结构稳定（空数组 = 全关）
		return { enabledIds: this.normalizeIds(row?.enabledIds) };
	}

	// 对外：PUT /settings/plugin-enabled 用；幂等 upsert
	async upsert(
		// dto 已被 ValidationPipe 校验过（IsArray、IsString each、MaxLength each）
		dto: UpsertPluginEnabledPrefsDto,
		userId?: number,
	): Promise<PluginEnabledPrefsView> {
		// 同样的 userId 校验
		const id = this.assertUserId(userId);
		// 再次 normalizeIds（DTO 管第一层，service 做最终兜底，避免 DB 存脏）
		const enabledIds = this.normalizeIds(dto.enabledIds);
		// 先查是否已有行；没有就 create，有就 update 字段
		let row = await this.repo.findOne({ where: { userId: id } });
		if (!row) {
			// 无行 → repo.create 生成实例（不 save）
			row = this.repo.create({ userId: id, enabledIds });
		} else {
			// 有行 → 只改 enabledIds 字段（updatedAt 由 UpdateDateColumn 自动维护）
			row.enabledIds = enabledIds;
		}
		// save：新行 INSERT，旧行 UPDATE；一行搞定 upsert，无需专门写原生 SQL ON DUPLICATE KEY
		await this.repo.save(row);
		// 响应返回 service 最终规范化的结果，前端以此作为 truth
		return { enabledIds };
	}
}
```

### 4.5 后端 Controller（新建）

**新增** · `apps/backend/src/services/plugin-prefs/plugin-prefs.controller.ts`（约 L1–L42）

```typescript
// 引入 Nest 常用装饰器：控制器、请求体、请求、HTTP 方法、守卫、拦截器、未授权异常
import {
	Body,
	Controller,
	Get,
	Put,
	Req,
	UnauthorizedException,
	UseGuards,
	UseInterceptors,
} from '@nestjs/common';
// Express Request 类型
import type { Request } from 'express';
// JWT 守卫：只有带合法 token 才能访问
import { JwtGuard } from '../../guards/jwt.guard';
// 响应拦截器：统一包成 { code, data, message } 结构给前端
import { ResponseInterceptor } from '../../interceptors/response.interceptor';
// 引入 DTO 与 Service
import { UpsertPluginEnabledPrefsDto } from './dto/upsert-plugin-enabled-prefs.dto';
import { PluginPrefsService } from './plugin-prefs.service';

// 给 request.user 打类型：JwtStrategy validate 后会把 userId 挂在 req.user 上
type AuthedRequest = Request & { user?: { userId?: number } };

// 私有函数：从 req 中抽取 userId，不合法则抛 401；与 service.assertUserId 功能相同但守卫层语义不同
function requireUserId(req: AuthedRequest): number {
	// 从 JWT 解析后的 user 对象里取 userId
	const userId = req.user?.userId;
	// 同样的合法性校验
	if (userId == null || !Number.isFinite(userId) || userId <= 0) {
		// 抛 401，给前端统一处理
		throw new UnauthorizedException('请先登录后再试');
	}
	// 返回安全 userId
	return userId;
}

// 控制器路径前缀 settings/plugin-enabled，对应前端常量 SETTINGS_PLUGIN_ENABLED
@Controller('settings/plugin-enabled')
// 启用 JWT 守卫；未登录直接 401，不再进入方法体
@UseGuards(JwtGuard)
// 启用统一响应包装，保证前端拿到的 data 结构与 service.getView/upsert 返回一致
@UseInterceptors(ResponseInterceptor)
export class PluginPrefsController {
	// 注入 Service
	constructor(private readonly prefsService: PluginPrefsService) {}

	// HTTP GET：读取当前用户偏好
	@Get()
	// 接收 @Req 以获取 userId
	getPrefs(@Req() req: AuthedRequest) {
		// 提取 userId 后委托 service 返回视图
		return this.prefsService.getView(requireUserId(req));
	}

	// HTTP PUT：整体覆盖偏好
	@Put()
	// Body 经 ValidationPipe 校验为 UpsertPluginEnabledPrefsDto；同时取 @Req 拿 userId
	update(@Body() dto: UpsertPluginEnabledPrefsDto, @Req() req: AuthedRequest) {
		// 提取 userId 后委托 service upsert
		return this.prefsService.upsert(dto, requireUserId(req));
	}
}
```

### 4.6 后端 Module 与 app.module 注册

**新增** · `apps/backend/src/services/plugin-prefs/plugin-prefs.module.ts`（约 L1–L13）

```typescript
// 引入 Nest Module 装饰器
import { Module } from '@nestjs/common';
// 引入 TypeOrmModule 注册实体仓库
import { TypeOrmModule } from '@nestjs/typeorm';
// Controller、Service、Entity
import { PluginPrefsController } from './plugin-prefs.controller';
import { PluginPrefsService } from './plugin-prefs.service';
import { PluginUserPrefs } from './plugin-user-prefs.entity';

@Module({
	// 把 PluginUserPrefs 注册到 TypeOrm，这样才能在 service 里 @InjectRepository
	imports: [TypeOrmModule.forFeature([PluginUserPrefs])],
	// 声明当前模块的控制器
	controllers: [PluginPrefsController],
	// 声明当前模块提供的服务（给 controller 注入）
	providers: [PluginPrefsService],
	// 对外导出（暂未被其它 service 复用，但预留出口避免后续耦合）
	exports: [PluginPrefsService],
})
export class PluginPrefsModule {}
```

**改动前** · `apps/backend/src/app.module.ts`（基线，约 L27–L30）

```typescript
// 引入 MailModule
import { MailModule } from './services/mail/mail.module';
// 引入 MenusModule
import { MenusModule } from './services/menus/menus.module';
// 引入 OcrModule
import { OcrModule } from './services/ocr/ocr.module';
// 引入 PayModule
import { PayModule } from './services/pay/pay.module';
// 引入 PromptModule（尚未引入 PluginPrefsModule，旧版无此模块）
import { PromptModule } from './services/prompt/prompt.module';
```

**改动后** · `apps/backend/src/app.module.ts`（当前，约 L27–L31）

```typescript
// 引入 MailModule
import { MailModule } from './services/mail/mail.module';
// 引入 MenusModule
import { MenusModule } from './services/menus/menus.module';
// 引入 OcrModule
import { OcrModule } from './services/ocr/ocr.module';
// 引入 PayModule
import { PayModule } from './services/pay/pay.module';
// 新增：引入插件偏好模块（PluginPrefsModule）
import { PluginPrefsModule } from './services/plugin-prefs/plugin-prefs.module';
// 引入 PromptModule
import { PromptModule } from './services/prompt/prompt.module';
```

**改动前** · `apps/backend/src/app.module.ts`（基线，约 L102–L107）

```typescript
// 注册 KnowledgeQaModule
               KnowledgeQaModule,
// 注册 ShareModule
               ShareModule,
// 注册 PayModule
               PayModule,
// 注册 AssistantModule（尚没有 PluginPrefsModule）
               AssistantModule,
```

**改动后** · `apps/backend/src/app.module.ts`（当前，约 L103–L109）

```typescript
// 注册 KnowledgeQaModule
               KnowledgeQaModule,
// 注册 ShareModule
               ShareModule,
// 注册 PayModule
               PayModule,
// 新增：注册插件偏好模块（使其 routes/controller 生效）
               PluginPrefsModule,
// 注册 AssistantModule
               AssistantModule,
```

**变更摘要**：在 imports 数组中增加 PluginPrefsModule，Nest 启动时会实例化该模块并挂载 `/settings/plugin-enabled` 路由。

---

### 4.7 前端 API 常量与 HTTP 封装

**改动前** · `apps/frontend/src/service/api.ts`（基线，约 L129–L133）

```typescript
// 导出 LLM 默认模型配置常量
export const SETTINGS_LLM_DEFAULTS = '/settings/llm/defaults';
// 导出 LLM 向量模型配置常量
export const SETTINGS_LLM_VECTOR = '/settings/llm/vector';
// 导出云端朗读（MiniMax）用户偏好常量
/** 云端朗读（MiniMax）用户偏好 */
export const SETTINGS_CLOUD_TTS = '/settings/cloud-tts';
// 下一行是 ASSISTANT_SESSION（基线里尚没有插件偏好路径）
```

**改动后** · `apps/frontend/src/service/api.ts`（当前，约 L129–L136）

```typescript
// 导出 LLM 默认模型配置常量
export const SETTINGS_LLM_DEFAULTS = '/settings/llm/defaults';
// 导出 LLM 向量模型配置常量
export const SETTINGS_LLM_VECTOR = '/settings/llm/vector';
// 导出云端朗读（MiniMax）用户偏好常量
/** 云端朗读（MiniMax）用户偏好 */
export const SETTINGS_CLOUD_TTS = '/settings/cloud-tts';
// 新增：插件上架偏好接口路径（按账号，Web/桌面同步）
/** 插件上架偏好（按账号，Web/桌面同步） */
export const SETTINGS_PLUGIN_ENABLED = '/settings/plugin-enabled';
// 下一行是 ASSISTANT_SESSION
```

**新增** · `apps/frontend/src/service/pluginEnabledPrefs.ts`（约 L1–L14）

```typescript
// 引入通用 HTTP 封装（带 JWT、错误处理）和请求配置类型
import { http, type RequestConfig } from '@/utils/fetch';
// 引入接口路径常量
import { SETTINGS_PLUGIN_ENABLED } from './api';

// 前后端同构的响应数据视图：enabledIds 为已启用插件 id 数组
export type PluginEnabledPrefsView = {
	enabledIds: string[];
};

// GET：拉取当前账号偏好；config 允许传 silent: true 避免全局错误 toast
export const getPluginEnabledPrefs = (config?: RequestConfig) =>
	http.get<PluginEnabledPrefsView>(SETTINGS_PLUGIN_ENABLED, config);

// PUT：整体覆盖当前账号偏好；body.enabledIds = 新的启用列表
export const updatePluginEnabledPrefs = (
	body: PluginEnabledPrefsView,
	config?: RequestConfig,
) => http.put<PluginEnabledPrefsView>(SETTINGS_PLUGIN_ENABLED, body, config);
```

---

### 4.8 前端缓存核心（新增 pluginEnabledPrefs.ts）

**新增** · `apps/frontend/src/plugins/core/pluginEnabledPrefs.ts`（约 L1–L170）

```typescript
// 从 HTTP 封装层引入 GET/PUT 两个请求函数
import {
	getPluginEnabledPrefs,
	updatePluginEnabledPrefs,
} from '@/service/pluginEnabledPrefs';
// 从 store 取当前登录 userId 以及构建「按用户隔离」localStorage key 的辅助函数
import {
	getLoggedInUserId,
	userScopedStorageKey,
} from '@/store/loggedInUserId';

// 旧版本地缓存 key（一次性迁移到服务端后彻底删除）
/** 旧版 localStorage（一次性迁移到服务端后删除） */
const LEGACY_BASE_KEY = `dnhyxc.plugin.enabled.${import.meta.env.PROD ? 'prod' : 'dev'}.v1`;

// 偏好数据结构：Record<pluginId, enabled_boolean>；旧版按对象存，新版按数组存
type Prefs = Record<string, boolean>;

// 当前缓存对应的 userId；0 表示未登录或已清
let cachedUserId = 0;
// 已启用插件 id 集合；用 Set 做 O(1) 查询
let cachedIds = new Set<string>();
// 并发拉取共用的 Promise；第二次调用直接 await 同一个结果
let loadPromise: Promise<void> | null = null;

// 根据 userId 构造旧版 localStorage key（按用户隔离，避免 A/B 账号串数据）
function legacyKey(userId: number): string {
	// 走统一 userScopedStorageKey，未来迁移逻辑与其它存储保持风格
	return userScopedStorageKey(LEGACY_BASE_KEY, userId);
}

// 从旧版 localStorage 读偏好；失败时安全返回空对象
function readLegacyLocal(userId: number): Prefs {
	// SSR / 非浏览器环境不操作 localStorage；userId<=0 视为未登录，不读
	if (typeof window === 'undefined' || userId <= 0) return {};
	try {
		// 先尝试按用户隔离的 key，再回退到旧的全局 key（兼容未切号前的数据）
		const raw =
			localStorage.getItem(legacyKey(userId)) ??
			localStorage.getItem(LEGACY_BASE_KEY);
		// 没有数据返回空
		if (!raw) return {};
		// JSON.parse 可能抛错，用 try 包住
		const parsed = JSON.parse(raw) as unknown;
		// 只接受 plain object；数组、null、基本类型都丢弃
		if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
			return {};
		}
		// 断言为 Prefs
		return parsed as Prefs;
	} catch {
		// 任何异常：忽略，返回空对象（默认全关）
		return {};
	}
}

// 清理旧版 localStorage；迁移成功后立即调用，避免继续使用脏数据
function removeLegacyLocal(userId: number): void {
	// 非浏览器不做
	if (typeof window === 'undefined') return;
	// 删除按用户隔离的 key
	localStorage.removeItem(legacyKey(userId));
	// 顺手删除全局 key
	localStorage.removeItem(LEGACY_BASE_KEY);
}

// 通用规范化：任何输入 → string[]（去重、trim、截 64、丢弃非字符串），与后端 normalizeIds 语义对齐
function normalizeIds(raw: unknown): string[] {
	// 兼容后端偶发把 JSON 字符串塞给 enabledIds 的情况（例如旧数据库或中间层转换 bug）
	if (typeof raw === 'string') {
		try {
			// 递归解析；注意：解析失败不抛错，返回空数组
			return normalizeIds(JSON.parse(raw));
		} catch {
			return [];
		}
	}
	// 非数组直接空
	if (!Array.isArray(raw)) return [];
	// 用 seen 去重
	const seen = new Set<string>();
	const out: string[] = [];
	// 逐项处理
	for (const item of raw) {
		// 非字符串跳过
		if (typeof item !== 'string') continue;
		// trim + slice(0, 64)，长度上限与后端 MaxLength 对齐
		const id = item.trim().slice(0, 64);
		// 空串或已存在跳过
		if (!id || seen.has(id)) continue;
		// 记录已见
		seen.add(id);
		// 加入输出
		out.push(id);
	}
	// 返回规范数组
	return out;
}

// 写内存缓存：把 userId + ids 一次性覆盖
function setCache(userId: number, ids: string[]): void {
	// 记录当前是谁的缓存
	cachedUserId = userId;
	// 再走一次 normalizeIds，保证 setCache 的调用方哪怕传了脏数组，内存里也一定干净
	cachedIds = new Set(normalizeIds(ids));
}

// 兼容 response.data 的各种偶发形态：对象带 enabledIds、直接数组、JSON 字符串，最终都返回 string[]
/** 兼容 res.data.enabledIds / 偶发整包 / JSON 字符串 */
function idsFromResponse(data: unknown): string[] {
	// 非对象直接空
	if (!data || typeof data !== 'object') return [];
	// 先强转成 Record 做 in 判断
	const obj = data as Record<string, unknown>;
	// 正常情况：data = { enabledIds }
	if ('enabledIds' in obj) return normalizeIds(obj.enabledIds);
	// 偶发整包数组：data = [...]（少见，兜底）
	if (Array.isArray(data)) return normalizeIds(data);
	// 其它：返回空
	return [];
}

// 从旧版 Prefs 对象提取出「值为 true 的键」数组；与新版 enabledIds 语义一致
function idsFromPrefs(prefs: Prefs): string[] {
	// 遍历 key，仅保留显式 === true 的项，避免 0 / '' / undefined 被误判
	return Object.keys(prefs).filter((id) => prefs[id] === true);
}

// 清理前端缓存（用于切号/登出/401）
export function clearPluginEnabledPrefsCache(): void {
	// userId 归零
	cachedUserId = 0;
	// ids 置空 Set
	cachedIds = new Set();
	// 并发 Promise 置空，保证下次 ensure 会真正重新拉
	loadPromise = null;
}

// 同步读取单个插件是否启用；未加载时视为未启用（默认全关）
/** 同步读内存缓存；未加载则视为全关 */
export function getPluginEnabledPref(id: string): boolean {
	// O(1) 查询 Set
	return cachedIds.has(id);
}

// 保证「当前账号偏好已拉到内存」；可传入 userId（用于 setUserInfo 场景：store 中 userInfo 已落盘但 getLoggedInUserId 尚未读到）
/** 从服务端拉取并写入内存（含旧 localStorage 一次性迁移） */
export async function ensurePluginEnabledPrefsLoaded(
	userId?: number,
): Promise<void> {
	// 优先使用显式传入的 userId，否则从全局 store 取
	const id = userId ?? getLoggedInUserId();
	// 未登录：清空缓存，保证所有插件默认关闭，并直接返回
	if (id <= 0) {
		clearPluginEnabledPrefsCache();
		return;
	}
	// 缓存对得上且当前没有 inflight：直接命中，不产生网络请求
	if (cachedUserId === id && !loadPromise) return;
	// 已有 inflight：复用同一个 Promise（并发去重）
	if (loadPromise) {
		await loadPromise;
		return;
	}

	// 构造一个 Promise 写到 loadPromise 上，让后续并发 await 同一份
	loadPromise = (async () => {
		try {
			// 先读旧版本地数据，用于迁移兜底
			const legacy = readLegacyLocal(id);
			// 提取出旧版已启用 id 列表
			const legacyIds = idsFromPrefs(legacy);
			// GET 服务端偏好；silent: true 避免 401 或短离线吓用户
			const res = await getPluginEnabledPrefs({ silent: true });
			// 从响应里提取启用列表
			const serverIds = idsFromResponse(res.data);
			// 服务端为空 + 本地有旧数据：一次性迁上去
			// 服务端为空且本地空 → 不操作（默认全关）
			// 服务端已有数据 → 直接用服务端，忽略本地旧数据
			if (serverIds.length === 0 && legacyIds.length > 0) {
				// PUT 回服务端；silent 避免 toast
				const migrated = await updatePluginEnabledPrefs(
					{ enabledIds: legacyIds },
					{ silent: true },
				);
				// 迁移成功删除旧 localStorage，从此不再使用
				removeLegacyLocal(id);
				// 用服务端返回的结果写缓存（truth）
				setCache(id, idsFromResponse(migrated.data));
				return;
			}
			// 服务端有数据 或 本地也空：都顺手删一下旧 localStorage 避免体积臃肿
			if (legacyIds.length > 0) removeLegacyLocal(id);
			// 以服务端数据为准
			setCache(id, serverIds);
		} catch {
			// 网络异常：降级用旧本地数据（没有就是全关）；保证离线也能用
			const legacy = readLegacyLocal(id);
			// 写入旧值
			setCache(id, idsFromPrefs(legacy));
		} finally {
			// 无论成功/失败，都把 loadPromise 置空，保证失败后下一次可以重试
			loadPromise = null;
		}
	})();

	// 外层 await 上面那个 loadPromise；确保返回前内存已就绪
	await loadPromise;
}

// 登录后预拉取：不阻塞登录流程，fire-and-forget
/** 登录后预拉取 */
export function prefetchPluginEnabledPrefs(userId?: number): void {
	// void 明确表达不等待结果
	void ensurePluginEnabledPrefsLoaded(userId);
}

// 切换单个插件状态：先改内存（乐观），再 PUT 回服务端；未登录时仅改内存，刷新丢
/**
 * 更新单个插件上架状态并写回服务端。
 * 未登录时仅改内存（默认关，切号即丢）。
 */
export async function setPluginEnabledPref(
	id: string,
	enabled: boolean,
): Promise<void> {
	// 取当前 userId
	const userId = getLoggedInUserId();
	// 复制当前 Set，构造新的集合
	const next = new Set(cachedIds);
	if (enabled) {
		// 开启：追加 id
		next.add(id);
	} else {
		// 关闭：移除 id
		next.delete(id);
	}
	// 构造新的启用数组（用于 PUT 以及写缓存）
	const enabledIds = [...next];

	// 未登录：只写内存，不发起网络，刷新后归零（0 表示未登录态）
	if (userId <= 0) {
		setCache(0, enabledIds);
		return;
	}

	// 已登录：先乐观更新内存（让 UI 立刻响应）
	setCache(userId, enabledIds);
	// 发起 PUT 覆盖；失败会抛异常由上层 try/catch
	const res = await updatePluginEnabledPrefs({ enabledIds });
	// 写成功后顺手删旧本地数据
	removeLegacyLocal(userId);
	// 从响应提取 truth 结果
	const saved = idsFromResponse(res.data);
	// 防御逻辑：响应异常空数组且当前操作是「开启」时，保留乐观缓存；否则以响应为准
	// 避免服务端偶尔返回空 + 之前没开启过，把用户刚开启的一项冲成全关
	setCache(userId, saved.length > 0 || !enabled ? saved : enabledIds);
}
```

---

### 4.9 enabledOverrides：`isPluginEnabled` 切到内存缓存

**改动前** · `apps/frontend/src/plugins/core/enabledOverrides.ts`（基线，约 L1–L40）

```typescript
// 引入 PluginRegistry 类型（旧版从 registry 缓存里查 plugins[].enabled）
import type { PluginRegistry } from './types';

// 监听器类型：无参回调
type Listener = () => void;

/** 订阅插件启用状态变化的监听器集合 */
const listeners = new Set<Listener>();

// 旧版：复制一份 registry 缓存 key 常量，避免 import registry.ts 造成循环依赖
/** 与 registry.ts CACHE_KEY 保持一致（避免循环依赖） */
const REGISTRY_CACHE_KEY = `dnhyxc.plugin.registry.${import.meta.env.PROD ? 'prod' : 'dev'}.v1`;

// 通知所有监听者：状态变化了（用于 UI 订阅刷新）
export function notifyPluginEnabled() {
        // 遍历 Set 逐个调用
        for (const fn of listeners) fn();
}

// 订阅函数：返回 cleanup；被 usePluginEnabled / PluginsPage 使用
// 订阅插件启用状态变化
export function subscribePluginEnabled(fn: Listener) {
        // 加入 Set
        listeners.add(fn);
        // 返回 unsubscribe，避免组件卸载后内存泄漏
        return () => {
                listeners.delete(fn);
        };
}

// 旧版注释：从 registry 本地缓存读 enabled（来自 plugins-registry.json）
/**
 * 是否上架：读 registry 本地缓存中的 `enabled`（与服务端 remotes 同步后写入）。
 * 无缓存时视为未上架（保守，避免误展示入口）。
 */
// 旧版 isPluginEnabled：每次都去 localStorage parse 一次，且用的是 catalog 全局 enabled
export function isPluginEnabled(id: string): boolean {
        // try-catch 防 JSON 错、防 SSR
        try {
                // 读 registry 缓存
                const cached = localStorage.getItem(REGISTRY_CACHE_KEY);
                // 无缓存 → 未上架
                if (!cached) return false;
                // 解析成 PluginRegistry
                const data = JSON.parse(cached) as PluginRegistry;
                // 找到对应插件
                const p = data.plugins?.find((x) => x.id === id);
                // 读 enabled，缺省 false
                return p?.enabled ?? false;
        } catch {
                // 任何异常 → 未上架
                return false;
        }
}
```

**改动后** · `apps/frontend/src/plugins/core/enabledOverrides.ts`（当前，约 L1–L27）

```typescript
// 不再依赖 registry 类型与 localStorage key；改为从新增的 pluginEnabledPrefs 读内存
import { getPluginEnabledPref } from './pluginEnabledPrefs';

// 监听器类型不变
type Listener = () => void;

/** 订阅插件启用状态变化的监听器集合 */
const listeners = new Set<Listener>();

// 删除旧版 REGISTRY_CACHE_KEY 常量；不再有重复定义

// 通知函数实现不变（UI 订阅逻辑保持一致）
export function notifyPluginEnabled() {
        // 遍历触发
        for (const fn of listeners) fn();
}

// 订阅函数实现不变
export function subscribePluginEnabled(fn: Listener) {
        // 加入 Set
        listeners.add(fn);
        // 返回取消订阅
        return () => {
                listeners.delete(fn);
        };
}

// 新版注释：明确是按账号服务端偏好，Web/桌面同步，默认关闭
/**
 * 是否上架：读当前账号服务端偏好的内存缓存（按 userId 隔离，Web/桌面同步）。
 * 未设置 / 未加载时默认关闭。
 */
// 新版 isPluginEnabled：O(1) 读 Set，零 IO；与 catalog 解耦
export function isPluginEnabled(id: string): boolean {
        // 直接委托给内存缓存读取函数
        return getPluginEnabledPref(id);
}
```

**变更摘要**：`isPluginEnabled` 由「读 localStorage + 解析 catalog enabled」改为「读内存 Set」，性能更高、无 IO、按账号隔离、默认全关。

---

### 4.10 registry.ts：新增 overlay，persistPluginEnabled 改写服务端偏好

**改动前** · `apps/frontend/src/plugins/core/registry.ts`（基线，约 L165–L202）

```typescript
// 省略文件前半部分（未改动）……

/** 上架/下架：改 plugins[].enabled 并持久化到 plugins-registry.json */
// persistPluginEnabled 签名：(id, enabled) => Promise<PluginRegistry>
export async function persistPluginEnabled(
        id: string,
        enabled: boolean,
): Promise<PluginRegistry> {
        // 先 force 拉最新 catalog，避免覆盖别人刚改的版本
        const data = await fetchPluginRegistry({ force: true });
        // 找到目标插件
        const hit = data.plugins.find((p) => p.id === id);
        if (!hit) {
                // 找不到直接报错（多语言文案）
                throw new Error(translateSync('plugins.registry.pluginNotFound', { id }));
        }
        // 旧版短路：状态无变化直接写缓存返回，不写远端
        if (hit.enabled === enabled) {
                // 写一下缓存保证 notify
                writeCache(data);
                return data;
        }
        // 旧版：整份 catalog 写回 plugins-registry.json（会污染全局）
        return savePluginRegistry({
                ...data,
                // 只改目标插件的 enabled
                plugins: data.plugins.map((p) => (p.id === id ? { ...p, enabled } : p)),
        });
}
```

**改动后** · `apps/frontend/src/plugins/core/registry.ts`（当前，约 L2–L6 导入段 + 约 L170–L207）

**改动前** · `apps/frontend/src/plugins/core/registry.ts`（基线，导入段约 L1–L8）

```typescript
// 引入 i18n 同步翻译
import { translateSync } from '@/i18n';
// 引入上传远端 JSON 的能力
import { putUploadRemoteJson } from '@/service';
// 引入平台 fetch（Web vs Tauri）
import { getPlatformFetch } from '@/utils/fetch';
// 引入上传 URL 解析
import { resolveUploadedFileUrl } from '@/utils/upload-file-url';
// 引入通知（仅 notifyPluginEnabled）
import { notifyPluginEnabled } from './enabledOverrides';
// 引入版本范围校验
import { satisfiesRange } from './PluginVerifier';
// 引入 types
import { HOST_API_VERSION, type PluginRegistry } from './types';
```

**改动后** · `apps/frontend/src/plugins/core/registry.ts`（当前，导入段约 L1–L11）

```typescript
// 引入 i18n 同步翻译
import { translateSync } from '@/i18n';
// 引入上传远端 JSON 的能力
import { putUploadRemoteJson } from '@/service';
// 引入平台 fetch（Web vs Tauri）
import { getPlatformFetch } from '@/utils/fetch';
// 引入上传 URL 解析
import { resolveUploadedFileUrl } from '@/utils/upload-file-url';
// 新增：从 enabledOverrides 同时引入 isPluginEnabled（供 overlayUserEnabled 使用）
import { isPluginEnabled, notifyPluginEnabled } from './enabledOverrides';
// 引入版本范围校验
import { satisfiesRange } from './PluginVerifier';
// 新增：引入服务端偏好写回函数
import { setPluginEnabledPref } from './pluginEnabledPrefs';
// 引入 types
import { HOST_API_VERSION, type PluginRegistry } from './types';
```

**新增函数** · `apps/frontend/src/plugins/core/registry.ts`（当前，overlayUserEnabled）

```typescript
// 用当前账号偏好覆盖 registry 里的 plugins[].enabled；仅在展示/运行时使用，不写回服务端 catalog
/** 用当前账号偏好覆盖 registry 里的 enabled（仅展示/运行时，不写回服务端） */
export function overlayUserEnabled(data: PluginRegistry): PluginRegistry {
	// 浅拷贝顶层，避免直接 mutate 入参对象导致缓存被改
	return {
		// 保留原 data 的 updatedAt 等其它字段
		...data,
		// 遍历 plugins，每个插件只改 enabled 字段
		plugins: data.plugins.map((p) => ({
			// 保留插件元信息
			...p,
			// enabled 用当前账号实际偏好覆盖
			enabled: isPluginEnabled(p.id),
		})),
	};
}
```

**改动后** · `apps/frontend/src/plugins/core/registry.ts`（当前，persistPluginEnabled 约 L186–L208）

```typescript
// 新版注释：明确写入服务端账号偏好，不再写回 catalog
/** 上架/下架：写入服务端账号偏好（Web/桌面同步），不改 registry catalog */
export async function persistPluginEnabled(
        id: string,
        enabled: boolean,
): Promise<PluginRegistry> {
        // 仍然拉最新 catalog 用于校验插件存在性（顺便保证 overlay 出来的 plugins 列表是最新）
        const data = await fetchPluginRegistry({ force: true });
        // 找目标插件
        const hit = data.plugins.find((p) => p.id === id);
        if (!hit) {
                // 找不到就抛错（文案未变）
                throw new Error(translateSync('plugins.registry.pluginNotFound', { id }));
        }
        // 新版：不再比较 catalog.enabled，因为 catalog.enabled 已退化为「目录建议默认」；必须调用 setPluginEnabledPref 才能让偏好生效
        // 写入服务端偏好（乐观更新内存 + PUT）
        await setPluginEnabledPref(id, enabled);
        // 手动通知订阅者（因为 setPluginEnabledPref 不调 notify；职责分离）
        notifyPluginEnabled();
        // 返回 overlay 后的 registry，让后续代码（如 PluginManager.setEnabled）读 enabled 拿到的是偏好态
        return overlayUserEnabled(data);
}
```

---

### 4.11 PluginManager：init 预加载 + syncEnabledShells + 过滤改造

**改动前** · `apps/frontend/src/plugins/core/PluginManager.ts`（基线，init 约 L49–L65 + ensurePlugin 约 L83–L89 + setEnabled 约 L223–L237）

```typescript
// 省略部分未改动的 import……
import { fetchPluginRegistry, persistPluginEnabled } from './registry';

class PluginManagerImpl {
        // ...（省略未改动字段与方法）

        async init() {
                // 拉最新 registry
                const registry = await fetchPluginRegistry({ force: true });
                // 旧版：直接用 catalog.enabled 过滤
                const enabled = registry.plugins.filter((p) => p.enabled);
                // 逐个挂路由+侧栏壳
                for (const meta of enabled) {
                        this.mountShell(meta);
                }
                // eager 预加载逻辑不变
                const eager = enabled.filter((p) => p.preload === 'eager');
                if (eager.length === 0) return;
                queueMicrotask(() => {
                        void Promise.all(eager.map((p) => this.loadPlugin(p)));
                });
        }

        async ensurePlugin(id: string, opts?: { force?: boolean }) {
                const registry = await fetchPluginRegistry({ force: true });
                // 旧版：按 catalog.enabled 找插件
                const meta = registry.plugins.find((p) => p.id === id && p.enabled);
                if (!meta) {
                        throw new Error(`registry 中无启用插件 ${id}`);
                }
                // ...（省略未改动的 load 流程）
        }

        /**
         * 上架 / 下架：写入服务端 plugins-registry.json，并即时挂壳或卸载。
         * Web / 桌面共用同一 remotes 文件；下架后业务入口配合 `usePluginEnabled` 隐藏。
         */
        async setEnabled(id: string, enabled: boolean) {
                const registry = await persistPluginEnabled(id, enabled);
                if (!enabled) {
                        // 下架：卸载插件
                        await this.unloadPlugin(id);
                        return;
                }
                // 上架：从新 registry 找 enabled=true 的项再挂壳
                const meta = registry.plugins.find((p) => p.id === id && p.enabled);
                if (!meta) return;
                this.mountShell(meta);
        }
}
```

**改动后** · `apps/frontend/src/plugins/core/PluginManager.ts`（当前，新增 import + 改造方法）

**改动前** · `apps/frontend/src/plugins/core/PluginManager.ts`（基线，import 段约 L1–L11）

```typescript
import { type ComponentType, createElement } from 'react';
import type { RouteConfig } from '@/router/routes';
import { PluginHostPage } from '../host/PluginHostPage';
import { beginPluginStyleCapture } from '../host/styleIsolation';
import { eventBus } from '../host-api/EventBus';
import { routeInjector } from '../inject/RouteInjector';
import { sidebarInjector } from '../inject/SidebarInjector';
import { createHostBridge } from './createHostBridge';
import { loadRemoteApp, registerRemote, resolvePluginBust } from './mf';
import { verifyPlugin } from './PluginVerifier';
import { fetchPluginRegistry, persistPluginEnabled } from './registry';
```

**改动后** · `apps/frontend/src/plugins/core/PluginManager.ts`（当前，import 段约 L6–L13）

```typescript
// 省略未变 import……
// 新增：引入 enabledOverrides 的 isPluginEnabled 与通知
import { isPluginEnabled, notifyPluginEnabled } from './enabledOverrides';
// 省略未变 import……
// 新增：引入偏好预加载函数
import { ensurePluginEnabledPrefsLoaded } from './pluginEnabledPrefs';
```

**改动后** · `apps/frontend/src/plugins/core/PluginManager.ts`（当前，init 约 L53–L66 + 新增 syncEnabledShells）

```typescript
        async init() {
                // 新增：在拉 registry 之前先把当前账号偏好读进内存，保证后续 isPluginEnabled 结果正确
                await ensurePluginEnabledPrefsLoaded();
                // 拉最新 catalog
                const registry = await fetchPluginRegistry({ force: true });
                // 新版：用 isPluginEnabled 过滤（读的是账号偏好，不是 catalog.enabled）
                const enabled = registry.plugins.filter((p) => isPluginEnabled(p.id));
                // 挂壳不变
                for (const meta of enabled) {
                        this.mountShell(meta);
                }
                // eager 预加载不变
                const eager = enabled.filter((p) => p.preload === 'eager');
                if (eager.length === 0) return;
                queueMicrotask(() => {
                        void Promise.all(eager.map((p) => this.loadPlugin(p)));
                });
        }

        // 新增方法：切号后按新账号偏好重挂/卸载所有壳
        /** 切换账号后按服务端偏好重挂/卸载壳（路由、侧栏） */
        async syncEnabledShells() {
                // 确保偏好加载到内存；传 userId 场景下 ensure 已在外部调过，但这里再保险一次
                await ensurePluginEnabledPrefsLoaded();
                // 拿 catalog
                const registry = await fetchPluginRegistry();
                // 遍历 catalog 全量：对每个插件根据当前偏好进行 mount/unmount
                for (const meta of registry.plugins) {
                        // 偏好为 true → 保证壳在；mountShell 内有幂等判断（routeInjector.inject/sidebarInjector.add 可重入）
                        if (isPluginEnabled(meta.id)) this.mountShell(meta);
                        // 偏好为 false → 卸载（含路由、侧栏、mod.deactivate、事件清理）
                        else await this.unloadPlugin(meta.id);
                }
                // 通知 UI 订阅者刷新（PluginsPage、usePluginEnabled hooks 等）
                notifyPluginEnabled();
        }
```

**改动后** · `apps/frontend/src/plugins/core/PluginManager.ts`（当前，ensurePlugin 约 L97–L101）

```typescript
        async ensurePlugin(id: string, opts?: { force?: boolean }) {
                const registry = await fetchPluginRegistry({ force: true });
                // 新版：用 isPluginEnabled 判定，而非 catalog.enabled
                const meta = registry.plugins.find(
                        (p) => p.id === id && isPluginEnabled(p.id),
                );
                if (!meta) {
                        throw new Error(`registry 中无启用插件 ${id}`);
                }
                // ...（后续不变）
```

**改动后** · `apps/frontend/src/plugins/core/PluginManager.ts`（当前，setEnabled 注释约 L240–L243）

```typescript
        /**
         * 新版注释：写账号偏好，Web/桌面同步；下架后业务入口配合 usePluginEnabled 隐藏
         * 上架 / 下架：写入服务端账号偏好（Web/桌面同步），并即时挂壳或卸载。
         * 下架后业务入口配合 `usePluginEnabled` 隐藏。
         */
        async setEnabled(id: string, enabled: boolean) {
                // persistPluginEnabled 返回的是 overlayUserEnabled 后的 registry，plugins[].enabled 是偏好态
                const registry = await persistPluginEnabled(id, enabled);
                if (!enabled) {
                        await this.unloadPlugin(id);
                        return;
                }
                // 这里找 enabled=true 时，读的是偏好 overlay 后的结果，与旧版的 catalog.enabled 语义不同
                const meta = registry.plugins.find((p) => p.id === id && p.enabled);
                if (!meta) return;
                this.mountShell(meta);
        }
```

---

### 4.12 hostSurface.ts：surface 过滤改为读 isPluginEnabled

**改动前** · `apps/frontend/src/plugins/core/hostSurface.ts`（基线，约 L1–L24）

```typescript
// 引入类型
import type { PluginDescriptor } from './types';

// 同 registry 缓存 key；旧版直接读 registry catalog
const REGISTRY_CACHE_KEY = `dnhyxc.plugin.registry.${import.meta.env.PROD ? 'prod' : 'dev'}.v1`;

export type PluginHostSurface = NonNullable<
        PluginDescriptor['host']
>['surface'];

/** 同步读 registry 缓存中声明了指定 Host surface 且已上架的插件（按 order） */
export function listHostSurfacePlugins(
        surface: PluginHostSurface,
): PluginDescriptor[] {
        try {
                // 读 catalog 缓存
                const cached = localStorage.getItem(REGISTRY_CACHE_KEY);
                if (!cached) return [];
                // 解析
                const data = JSON.parse(cached) as { plugins?: PluginDescriptor[] };
                // 旧版：按 p.enabled（catalog 里的）过滤
                const list = (data.plugins ?? []).filter(
                        (p) => p.enabled && p.host?.surface === surface,
                );
                // 按 host.order 排序
                return list.sort((a, b) => (a.host?.order ?? 100) - (b.host?.order ?? 100));
        } catch {
                return [];
        }
}
```

**改动后** · `apps/frontend/src/plugins/core/hostSurface.ts`（当前，约 L1–L25）

```typescript
// 新增：引入 isPluginEnabled
import { isPluginEnabled } from './enabledOverrides';
// 引入类型
import type { PluginDescriptor } from './types';

// REGISTRY_CACHE_KEY 仍然保留（因为要读 catalog 元信息）
const REGISTRY_CACHE_KEY = `dnhyxc.plugin.registry.${import.meta.env.PROD ? 'prod' : 'dev'}.v1`;

export type PluginHostSurface = NonNullable<
        PluginDescriptor['host']
>['surface'];

// 新注释：明确是「当前账号已上架」
/** 同步读 registry 缓存中声明了指定 Host surface 且当前账号已上架的插件（按 order） */
export function listHostSurfacePlugins(
        surface: PluginHostSurface,
): PluginDescriptor[] {
        try {
                const cached = localStorage.getItem(REGISTRY_CACHE_KEY);
                if (!cached) return [];
                const data = JSON.parse(cached) as { plugins?: PluginDescriptor[] };
                // 新版：过滤条件从 p.enabled 换成 isPluginEnabled(p.id)
                const list = (data.plugins ?? []).filter(
                        (p) => isPluginEnabled(p.id) && p.host?.surface === surface,
                );
                return list.sort((a, b) => (a.host?.order ?? 100) - (b.host?.order ?? 100));
        } catch {
                return [];
        }
}
```

---

### 4.13 plugins/index.ts：导出 overlayUserEnabled

**改动前** · `apps/frontend/src/plugins/index.ts`（基线，export registry 相关约 L28–L36）

```typescript
// 省略未变的 exports
export {
        fetchPluginRegistry,
        fetchPluginRegistryRawText,
        formatRegistryUpdatedAt,
        PLUGIN_REGISTRY_CACHE_KEY,
        PLUGIN_REGISTRY_FILENAME,
        PLUGIN_REGISTRY_STATIC_PATH,
```

**改动后** · `apps/frontend/src/plugins/index.ts`（当前，export 段）

```typescript
export {
        fetchPluginRegistry,
        fetchPluginRegistryRawText,
        formatRegistryUpdatedAt,
        // 新增：导出给 PluginsPage 等外部消费者做列表 overlay
        overlayUserEnabled,
        PLUGIN_REGISTRY_CACHE_KEY,
        PLUGIN_REGISTRY_FILENAME,
        PLUGIN_REGISTRY_STATIC_PATH,
```

---

### 4.14 user.ts：登录/切号/登出时同步偏好与插件壳

**改动前** · `apps/frontend/src/store/user.ts`（基线，约 L1–L114）

```typescript
// 引入 mobx 自动观察
import { makeAutoObservable } from 'mobx';
// 引入 storage 工具
import { getStorage, removeStorage, setStorage } from '@/utils';
// 会员判定
import { isMembershipActiveFromUserInfo } from '@/utils/membershipActive';
// TTS 偏好预拉
import { prefetchMinimaxTtsUserPrefs } from '@/utils/minimaxTtsPrefs';
// 常量 + resetUserState
import { USER_INFO_STORAGE_KEY } from './loggedInUserId';
import { resetUserState } from './resetUserState';

// 省略 createDefaultUserInfo / normalizeUserId / readUserInfoFromStorage（未变）

class UserStore {
        userInfo: UserInfoShape = createDefaultUserInfo();

        constructor() {
                makeAutoObservable(this);
                // 构造时从 localStorage 恢复
                const stored = readUserInfoFromStorage();
                if (stored) {
                        this.userInfo = stored;
                        const id = normalizeUserId(stored);
                        if (id > 0) {
                                // 旧版：仅预拉 TTS
                                prefetchMinimaxTtsUserPrefs(id);
                        }
                }
        }

        setUserInfo(userInfo: any) {
                const prevId = normalizeUserId(this.userInfo);
                const nextId = normalizeUserId(userInfo as UserInfoShape);
                // 切号：resetUserState（清缓存）
                if (prevId !== nextId) {
                        resetUserState();
                }
                this.userInfo = userInfo as UserInfoShape;
                setStorage(USER_INFO_STORAGE_KEY, JSON.stringify(userInfo));
                // 会员登录时预拉 TTS
                if (nextId > 0 && isMembershipActiveFromUserInfo(userInfo)) {
                        prefetchMinimaxTtsUserPrefs(nextId);
                }
                // 派发 userInfoChanged 事件
                if (typeof window !== 'undefined') {
                        window.dispatchEvent(new Event('userInfoChanged'));
                }
        }

        clearUserInfo() {
                const hadUser = normalizeUserId(this.userInfo) > 0;
                this.userInfo = createDefaultUserInfo();
                removeStorage(USER_INFO_STORAGE_KEY);
                if (hadUser) {
                        resetUserState();
                }
        }
}
```

**改动后** · `apps/frontend/src/store/user.ts`（当前，约 L1–L120）

**改动前 import** vs **改动后 import**：

```typescript
import { makeAutoObservable } from 'mobx';
// 新增：引入偏好加载相关两个函数
import {
        ensurePluginEnabledPrefsLoaded,
        prefetchPluginEnabledPrefs,
} from '@/plugins/core/pluginEnabledPrefs';
import { getStorage, removeStorage, setStorage } from '@/utils';
import { isMembershipActiveFromUserInfo } from '@/utils/membershipActive';
import { prefetchMinimaxTtsUserPrefs } from '@/utils/minimaxTtsPrefs';
```

**新增函数** · `syncPluginShellsAfterUserChange`（约 L56–L69）

```typescript
// 私有函数：userId 变化后（登录/切号/登出）异步同步插件路由/侧栏壳
// 放在独立函数里，避免 setUserInfo 阻塞；不 await，不阻塞登录跳转
function syncPluginShellsAfterUserChange(userId: number): void {
        // fire-and-forget，显式 void
        void (async () => {
                try {
                        // userId>0：ensure 明确传 userId，保证在 setStorage 写盘后、getLoggedInUserId 还没读的时候也能拿到正确 id
                        if (userId > 0) await ensurePluginEnabledPrefsLoaded(userId);
                        // 动态 import 避免循环依赖（store/user → plugins/core/PluginManager → registry → enabledOverrides → store/loggedInUserId…）
                        const { pluginManager } = await import('@/plugins/core/PluginManager');
                        // 按新账号偏好重挂/卸载壳
                        await pluginManager.syncEnabledShells();
                } catch (e) {
                        // 同步失败只记日志，不影响用户主流程
                        console.error('[plugins] sync after user change failed', e);
                }
        })();
}
```

**构造器**（当前，约 L80–L86）

```typescript
        constructor() {
                makeAutoObservable(this);
                const stored = readUserInfoFromStorage();
                if (stored) {
                        this.userInfo = stored;
                        const id = normalizeUserId(stored);
                        if (id > 0) {
                                // 原 TTS 预拉
                                prefetchMinimaxTtsUserPrefs(id);
                                // 新增：fire-and-forget 预拉插件偏好
                                prefetchPluginEnabledPrefs(id);
                        }
                }
        }
```

**setUserInfo**（当前，约 L95–L110）

```typescript
        setUserInfo(userInfo: any) {
                const prevId = normalizeUserId(this.userInfo);
                const nextId = normalizeUserId(userInfo as UserInfoShape);
                if (prevId !== nextId) {
                        resetUserState();
                }
                this.userInfo = userInfo as UserInfoShape;
                setStorage(USER_INFO_STORAGE_KEY, JSON.stringify(userInfo));
                // 会员：预拉 TTS（旧逻辑不变）
                if (nextId > 0 && isMembershipActiveFromUserInfo(userInfo)) {
                        prefetchMinimaxTtsUserPrefs(nextId);
                }
                // 新增：用户 id 变化时，预拉偏好 + 异步同步壳
                if (prevId !== nextId) {
                        // nextId>0：预拉偏好
                        if (nextId > 0) prefetchPluginEnabledPrefs(nextId);
                        // 无论登录/登出（nextId 可为 0）都同步一次壳：登出→卸所有，登录→挂对应
                        syncPluginShellsAfterUserChange(nextId);
                }
                if (typeof window !== 'undefined') {
                        window.dispatchEvent(new Event('userInfoChanged'));
                }
        }
```

**clearUserInfo**（当前，约 L112–L119）

```typescript
        clearUserInfo() {
                const hadUser = normalizeUserId(this.userInfo) > 0;
                this.userInfo = createDefaultUserInfo();
                removeStorage(USER_INFO_STORAGE_KEY);
                if (hadUser) {
                        resetUserState();
                        // 新增：登出后传 userId=0 同步壳（卸所有插件入口）
                        syncPluginShellsAfterUserChange(0);
                }
        }
```

---

### 4.15 resetUserState.ts：切号时清插件偏好缓存

**改动前** · `apps/frontend/src/store/resetUserState.ts`（基线，约 L1–L31）

```typescript
// 旧版仅清 TTS 缓存等
import { clearMinimaxTtsUserPrefsCache } from '@/utils/minimaxTtsPrefs';
// 省略多个 store import

let resetting = false;

/**
 * 切换账号 / 登出 / 401 时清空与用户绑定的前端缓存（知识库草稿、助手对话、英语学习 Agent、电子书书架列表 等）。
 * 可重入：并发调用只会执行一次。
 */
export function resetUserState(): void {
        if (resetting) return;
        resetting = true;
        try {
                // ...（省略多个 reset 调用）
                // 最后：清 TTS 缓存
                clearMinimaxTtsUserPrefsCache();
        } finally {
                resetting = false;
        }
}
```

**改动后** · `apps/frontend/src/store/resetUserState.ts`（当前，约 L1–L34）

```typescript
// 新增：引入清插件偏好缓存函数
import { clearPluginEnabledPrefsCache } from '@/plugins/core/pluginEnabledPrefs';
// 原 import
import { clearMinimaxTtsUserPrefsCache } from '@/utils/minimaxTtsPrefs';

let resetting = false;

/**
 * 切换账号 / 登出 / 401 时清空与用户绑定的前端缓存（知识库草稿、助手对话、英语学习 Agent、电子书书架列表 等）。
 * 可重入：并发调用只会执行一次。
 * 新增注释：壳重挂由 setUserInfo / clearUserInfo 在 userId 落盘后再 sync，避免 reset 读旧账号
 */
export function resetUserState(): void {
        if (resetting) return;
        resetting = true;
        try {
                // ...（省略未变的 reset 调用）
                clearMinimaxTtsUserPrefsCache();
                // 新增：清插件偏好缓存；后面 syncEnabledShells 会拉新账号的真实偏好
                clearPluginEnabledPrefsCache();
        } finally {
                resetting = false;
        }
}
```

---

### 4.16 插件管理页：overlay + 订阅更新 + 统一错误文案

**改动前** · `apps/frontend/src/views/plugins/index.tsx`（基线，import + refresh + onToggle 约 L1–L83）

```typescript
import { SquarePen } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router';
// UI 组件……
import {
        fetchPluginRegistry,
        type PluginDescriptor,
        pickPluginLocaleText,
        pluginManager,
} from '@/plugins';

// 省略 pluginTitle / pluginBlurb 辅助函数

export default function PluginsPage() {
        const { t, locale } = useI18n();
        const navigate = useNavigate();
        const [plugins, setPlugins] = useState<PluginDescriptor[]>([]);
        const [busyId, setBusyId] = useState<string | null>(null);
        const [error, setError] = useState<string | null>(null);

        const refresh = useCallback(async () => {
                try {
                        const reg = await fetchPluginRegistry({ force: true });
                        // 旧版：直接用 catalog.plugins，enabled 可能是目录建议态
                        setPlugins(reg.plugins);
                        setError(null);
                } catch (e) {
                        // 旧版：用 instanceof Error 判断，拿不到 fetch 自定义结构里的 message
                        setError(e instanceof Error ? e.message : String(e));
                }
        }, []);

        useEffect(() => {
                void refresh();
        }, [refresh]);

        const onToggle = async (id: string, enabled: boolean) => {
                setBusyId(id);
                try {
                        await pluginManager.setEnabled(id, enabled);
                        // 旧版：每次 toggle 后重新拉 registry → enabled 写回到 catalog → 读回来展示
                        await refresh();
                } catch (e) {
                        // 同样 instanceof 判断
                        setError(e instanceof Error ? e.message : String(e));
                } finally {
                        setBusyId(null);
                }
        };
```

**改动后** · `apps/frontend/src/views/plugins/index.tsx`（当前，import + refresh + 订阅 + onToggle）

**改动前 import** vs **改动后 import**：

```typescript
// 省略不变的 lucide、react 等导入
import {
        fetchPluginRegistry,
        // 新增：isPluginEnabled 用于订阅回调；overlayUserEnabled 用于列表渲染
        isPluginEnabled,
        overlayUserEnabled,
        type PluginDescriptor,
        pickPluginLocaleText,
        pluginManager,
        // 新增：订阅状态变化通知
        subscribePluginEnabled,
} from '@/plugins';
// 新增：确保页面进入时偏好已加载
import { ensurePluginEnabledPrefsLoaded } from '@/plugins/core/pluginEnabledPrefs';
// 新增：统一提取请求错误信息（覆盖 fetch 封装的 data.message / code 等情况）
import { getRequestErrorMessage } from '@/utils/fetch';
```

**refresh 函数**（当前）

```typescript
        const refresh = useCallback(async () => {
                try {
                        // 先确保偏好已拉到内存；否则 overlay 出来的全是 false
                        await ensurePluginEnabledPrefsLoaded();
                        const reg = await fetchPluginRegistry({ force: true });
                        // 新版：用 overlayUserEnabled 把 catalog.enabled 覆盖成账号实际偏好
                        setPlugins(overlayUserEnabled(reg).plugins);
                        setError(null);
                } catch (e) {
                        // 新版：统一 getRequestErrorMessage，避免 error 是 fetch 封装体时显示 [object Object]
                        setError(getRequestErrorMessage(e));
                }
        }, []);
```

**新增订阅 useEffect**（当前，约 L66–L75）

```typescript
        // 新增：订阅偏好变化通知（切号、setPluginEnabledPref 写入等都会触发）
        // 只重贴 enabled 字段，不再拉 registry，避免 notify→refresh→拉 registry→notify→死循环
        useEffect(() => {
                // 返回 cleanup 自动 unsubscribe
                return subscribePluginEnabled(() => {
                        // 函数式 setState：用 prev，保证并发 refresh 时不丢其它字段
                        setPlugins((prev) =>
                                prev.map((p) => ({
                                        // 保留其它字段
                                        ...p,
                                        // 只把 enabled 覆盖为当前账号偏好
                                        enabled: isPluginEnabled(p.id),
                                })),
                        );
                });
        }, []);
```

**onToggle**（当前）

```typescript
        const onToggle = async (id: string, enabled: boolean) => {
                setBusyId(id);
                try {
                        // pluginManager.setEnabled 内部会 persistPluginEnabled → notifyPluginEnabled
                        await pluginManager.setEnabled(id, enabled);
                        // 仍然调一次 refresh：一来保证 catalog 是最新（版本、描述可能被管理员更新）；二来让 UI 看到「完整注册表」同步
                        await refresh();
                } catch (e) {
                        // 新版：统一错误文案
                        setError(getRequestErrorMessage(e));
                } finally {
                        setBusyId(null);
                }
        };
```

---

### 4.17 i18n 文案：调整为「默认全关 + 偏好按账号」语义

**改动前** · `apps/frontend/src/i18n/locales/zh-CN.ts`（基线，plugins.page.desc + plugins.registry.help.enabled 约 L1672–L1718）

```typescript
        'route.plugins.title': '插件中心',
        'plugins.page.title': '插件中心',
        'plugins.page.desc':
               '查看已接入的插件。关闭开关即下架：基座不再加载，相关业务入口也会隐藏。',
        // ...
        'plugins.registry.help.enabled':
               '是否上架；false 时 Host 不加载且隐藏业务入口。',
```

**改动后** · `apps/frontend/src/i18n/locales/zh-CN.ts`（当前）

```typescript
        'route.plugins.title': '插件中心',
        'plugins.page.title': '插件中心',
        'plugins.page.desc':
               '查看已接入的插件，默认全部关闭，关闭后基座不再加载，相关业务入口也会隐藏。',
        // ...
        'plugins.registry.help.enabled':
               '目录建议默认值（现已默认 false）。实际上架/下架按账号保存在服务端（Web/桌面同步），不再写回此字段。',
```

---

**改动前** · `apps/frontend/src/i18n/locales/en-US.ts`（基线）

```typescript
        'route.plugins.title': 'Plugins',
        'plugins.page.title': 'Plugins',
        'plugins.page.desc':
               'Browse installed plugins. Turn off to delist: the host stops loading them and related UI entries hide.',
        // ...
        'plugins.registry.help.enabled':
               'Whether the plugin is listed; false stops loading and hides host UI entries.',
```

**改动后** · `apps/frontend/src/i18n/locales/en-US.ts`（当前）

```typescript
        'route.plugins.title': 'Plugins',
        'plugins.page.title': 'Plugins',
        'plugins.page.desc':
               'Plugins Installed (All Disabled by Default). Disabling prevents base loading and hides entry points.',
        // ...
        'plugins.registry.help.enabled':
               'Catalog default (now false). Actual shelf state is per-account on the server (Web/desktop sync) and is not written back here.',
```

---

## 5. 兼容性与影响

| 维度 | 行为 |
|------|------|
| catalog 兼容性 | `plugins[].enabled` 字段仍保留在 JSON Schema 里，但 Host 运行时不再读取；老版本 Host 仍可按旧语义工作 |
| 旧 localStorage 迁移 | 首次拉偏好时，若服务端空且本地有旧 `dnhyxc.plugin.enabled.*.v1` 数据，会迁上去再删本地；后续只读服务端 |
| 默认值 | 未登录/无偏好/拉取失败 → 默认全关；新注册用户首次进入必须手动开启所需插件 |
| 并发写 | PUT 为全量覆盖，最后一次写入为准；配合前端「乐观写 + 响应兜底」可避免短时闪烁 |
| 管理员编辑 catalog | 编辑页（`/plugins/registry`）保存时仍写 `plugins-registry.json`，但不会覆盖用户偏好；管理员可改 catalog.enabled 作为「目录建议默认」，新用户首次无偏好时若有迁移逻辑可参考 |
| 切号 | `resetUserState` 清缓存 → `syncPluginShellsAfterUserChange` 重新拉取偏好并 mount/unmount；路由/侧栏入口与新账号一致 |
| 未登录 | 偏好缓存写在 `userId=0`，刷新即丢；避免未登录态开关写回服务端造成 401 体验 |
| 桌面端 | Tauri 的 HTTP 封装（`getPlatformFetch`）走同一套服务端 `/settings/plugin-enabled`，与 Web 共用同一份 MySQL 数据 |

**风险与回归建议**：

1. 测未登录 → 插件中心默认全关 → 切登录 → 手动开启两个插件 → 刷新仍在 → Web / Tauri 两端登录同一账号查看一致
2. 测 A 账号开启 X，B 账号登录默认 X 关闭；切回 A 仍开启
3. 测插件中心编辑 catalog（改描述）不影响用户 enabled；编辑后按 refresh 按钮 enabled 不被冲
4. 测 `listHostSurfacePlugins`（电子书阅读器 host surface 等）：关闭插件后相关 surface 项消失
5. 断网/服务端 5xx 时：首次访问插件中心默认全关；有旧 localStorage 的设备仍可恢复到旧开启状态

---

## 6. 相关源码路径

| 说明 | 路径 |
|------|------|
| 迁移（建表） | `apps/backend/src/migrations/1785431795367-plugins-prefs.ts` |
| 后端 Entity | `apps/backend/src/services/plugin-prefs/plugin-user-prefs.entity.ts` |
| 后端 DTO | `apps/backend/src/services/plugin-prefs/dto/upsert-plugin-enabled-prefs.dto.ts` |
| 后端 Service | `apps/backend/src/services/plugin-prefs/plugin-prefs.service.ts` |
| 后端 Controller | `apps/backend/src/services/plugin-prefs/plugin-prefs.controller.ts` |
| 后端 Module | `apps/backend/src/services/plugin-prefs/plugin-prefs.module.ts` |
| App Module 注册 | `apps/backend/src/app.module.ts` |
| 前端 API 常量 | `apps/frontend/src/service/api.ts`（SETTINGS_PLUGIN_ENABLED） |
| 前端 HTTP 封装 | `apps/frontend/src/service/pluginEnabledPrefs.ts` |
| 前端缓存核心 | `apps/frontend/src/plugins/core/pluginEnabledPrefs.ts` |
| 启用判定 | `apps/frontend/src/plugins/core/enabledOverrides.ts`（isPluginEnabled） |
| catalog overlay + 偏好写回 | `apps/frontend/src/plugins/core/registry.ts` |
| 插件生命周期管理 | `apps/frontend/src/plugins/core/PluginManager.ts` |
| Host surface 列表 | `apps/frontend/src/plugins/core/hostSurface.ts` |
| 插件中心 UI | `apps/frontend/src/views/plugins/index.tsx` |
| 切号联动 | `apps/frontend/src/store/user.ts`、`apps/frontend/src/store/resetUserState.ts` |
| i18n 文案 | `apps/frontend/src/i18n/locales/zh-CN.ts`、`en-US.ts` |

---

（若与仓库最新源码不一致，以源码为准）
