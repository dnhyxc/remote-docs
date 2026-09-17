# 知识库「公开」Tab：他人公开文档筛选

## 1. 背景与目标

**要解决的问题**：知识库列表「全部」Tab 同时包含本人与他人公开条目，但没有单独的入口让用户**只浏览他人分享的公开文档**，也无法直观看到「全部」Tab 中公有多少条他人公开内容。

**目标**：

1. 新增分类标签栏中的「公开」Tab，只筛选**他人公开**的知识条目（排除本人公开）。
2. 「全部」Tab 的计数角标改为 **本人总数 + 他人公开总数**，避免误导。
3. 后端 `GET /knowledge/list` 增加 `scope` 查询参数，明确区分「全部」与「仅公开」，并与既有 `categoryId / uncategorizedOnly` 做互斥校验。
4. 切换分类、改变条目归属时，Store 内对「公开」Tab 的命中判定与列表状态保持一致。

---

## 2. 改动范围

| 模块 | 路径 |
| ---- | ---- |
| 后端 DTO | `apps/backend/src/services/knowledge/dto/query-knowledge.dto.ts` |
| 后端列表查询 | `apps/backend/src/services/knowledge/knowledge.service.ts` |
| 前端类型 | `apps/frontend/src/types/index.ts` |
| 前端请求封装 | `apps/frontend/src/service/index.ts` |
| 前端知识库 Store | `apps/frontend/src/store/knowledge.ts` |
| 前端知识库列表 UI | `apps/frontend/src/views/knowledge/KnowledgeList.tsx` |
| 前端中文字典 | `apps/frontend/src/i18n/locales/zh-CN.ts` |
| 前端英文字典 | `apps/frontend/src/i18n/locales/en-US.ts` |
| 前端全局常量 | `apps/frontend/src/constants/index.ts` |
| 前端电子书 Store | `apps/frontend/src/store/ebook.ts` |

延伸阅读：
- [知识库分类管理.md](./知识库分类管理.md)
- [知识库列表搜索标题.md](./知识库列表搜索标题.md)
- [公开优先排序](./公开优先排序.md)
- [书架知识库分页常量归一化.md](./书架知识库分页常量归一化.md)

---

## 3. 实现思路

1. **后端查询语义分三档**：
   - `scope=public`：`isPublic=true AND authorId != userId`（他人公开）。
   - `scope=all` 或无 scope 时：
     - 带 `categoryId / uncategorizedOnly` → `authorId = userId` + 分类条件（仍是本人视角）。
     - 不带任何分类过滤 → `authorId = userId OR isPublic=true`（原「全部」行为）。
   - `scope=public` 与分类参数互斥，抛 400。
2. **前端新增 `publicItemTotal`**：进入云端模式时额外请求一条 `scope=public, pageSize=1` 的「count probe」，只取 `total`，不展示结果；失败不阻塞列表。
3. **CategoryKey 扩展 `{ kind: 'public' }`**：`listQueryFromKey` 直接映射到后端 `scope=public`，其余 key 复用分类逻辑。
4. **Store 派生值统一**：
   - `listAllCount = totalItemCount + publicItemTotal` 作为「全部」角标。
   - `itemMatchesActiveCategory` 改为接收完整条目对象，不再只拿 `categoryId`，以便判定 `isPublic + isOwned`。
5. **UI 条件渲染**：`publicItemTotal > 0` 时才把「公开」Chip 注入标签栏，避免 0 条时多一个无效 Tab。
6. **分页与总数健壮性**：`hasMore` 改用 `safeTotal()`，避免后端偶发 `total=NaN/null` 时持续请求下一页。

---

## 4. 关键代码对比与逐行注释

### 4.1 `QueryKnowledgeDto`（`apps/backend/src/services/knowledge/dto/query-knowledge.dto.ts`）

**对比范围**：DTO 全类。新增 `scope` 字段并引入 `IsIn` 校验。

**改动前** · `apps/backend/src/services/knowledge/dto/query-knowledge.dto.ts`（基线，约 L1–L48）

```typescript
// 从 class-transformer 导入装饰器：参数转换工具集
import { Transform, Type } from 'class-transformer';
// 从 class-validator 导入校验装饰器（改动前还未使用 IsIn）
import {
	IsBoolean,
	IsInt,
	IsNumber,
	IsOptional,
	IsString,
	IsUUID,
	MaxLength,
	Min,
} from 'class-validator';

// DTO 类的 JSDoc：描述其为知识库列表查询入参（分页 + 标题模糊 + 分类）
/** 知识库列表查询（分页 + 标题模糊 + 分类） */
// 声明 QueryKnowledgeDto 类，作为 NestJS DTO 供管道校验
export class QueryKnowledgeDto {
	// 声明 pageNo 为可选字段
	@IsOptional()
	// 使用 Type 把字符串（来自 query string）转成数值
	@Type(() => Number)
	// 校验为数字类型
	@IsNumber()
	// 校验最小值为 1，避免 0 或负数页
	@Min(1)
	// 字段定义：页码
	pageNo?: number;

	// 声明 pageSize 为可选字段
	@IsOptional()
	// 同样将 query 字符串转数字
	@Type(() => Number)
	// 校验为数字类型
	@IsNumber()
	// 最小每页 1 条
	@Min(1)
	// 字段定义：每页条数
	pageSize?: number;

	// 标题搜索关键字为可选
	@IsOptional()
	// 校验必须是字符串
	@IsString()
	// 长度上限 200，避免查询参数过长
	@MaxLength(200)
	// 字段定义：标题
	title?: string;

	// authorId 的业务说明：列表可见范围以 JWT 用户为准，此字段不再参与过滤
	/** 可选；列表可见范围以 JWT 用户为准（本人 OR 公开），不再依赖此字段过滤 */
	// authorId 为可选
	@IsOptional()
	// 查询串转整数
	@Type(() => Number)
	// 必须是整数；附带自定义错误消息
	@IsInt({ message: 'authorId 必须为数字' })
	// 必须大于等于 1
	@Min(1, { message: 'authorId 必须大于 0' })
	// 字段定义：作者 id
	authorId?: number;

	// 分类 id 为可选
	@IsOptional()
	// 必须是合法 UUID
	@IsUUID()
	// 字段定义：分类 id
	categoryId?: string;

	// 是否只看未分类：可选
	@IsOptional()
	// 将 'true'/'true' 字符串或布尔值都归一为布尔类型
	@Transform(({ value }) => value === 'true' || value === true)
	// 校验必须是布尔值
	@IsBoolean()
	// 字段定义：只显示未分类
	uncategorizedOnly?: boolean;
}
```

**改动后** · `apps/backend/src/services/knowledge/dto/query-knowledge.dto.ts`（当前，约 L1–L53）

```typescript
// 从 class-transformer 导入装饰器：参数转换工具集
import { Transform, Type } from 'class-transformer';
// 从 class-validator 导入校验装饰器（新增 IsIn 枚举校验）
import {
	IsBoolean,
	// 枚举值范围校验：限定 scope 只接受白名单字符串
	IsIn,
	IsInt,
	IsNumber,
	IsOptional,
	IsString,
	IsUUID,
	MaxLength,
	Min,
} from 'class-validator';

// DTO 类的 JSDoc：保持原语义不变
/** 知识库列表查询（分页 + 标题模糊 + 分类） */
// 声明 QueryKnowledgeDto 类
export class QueryKnowledgeDto {
	// 声明 pageNo 为可选字段
	@IsOptional()
	// 把 query string 解析为数字
	@Type(() => Number)
	// 数字校验
	@IsNumber()
	// 最小 1
	@Min(1)
	// 字段定义：页码
	pageNo?: number;

	// 声明 pageSize 为可选字段
	@IsOptional()
	// 转数字
	@Type(() => Number)
	// 数字校验
	@IsNumber()
	// 最小 1
	@Min(1)
	// 字段定义：每页条数
	pageSize?: number;

	// 标题为可选
	@IsOptional()
	// 字符串校验
	@IsString()
	// 最长 200
	@MaxLength(200)
	// 字段定义：标题
	title?: string;

	// authorId 字段注释
	/** 可选；列表可见范围以 JWT 用户为准（本人 OR 公开），不再依赖此字段过滤 */
	// authorId 可选
	@IsOptional()
	// 转整数
	@Type(() => Number)
	// 整数校验 + 消息
	@IsInt({ message: 'authorId 必须为数字' })
	// 最小 1 + 消息
	@Min(1, { message: 'authorId 必须大于 0' })
	// 字段定义：作者 id
	authorId?: number;

	// 分类 id 可选
	@IsOptional()
	// UUID 校验
	@IsUUID()
	// 字段定义：分类 id
	categoryId?: string;

	// uncategorizedOnly 可选
	@IsOptional()
	// 将 'true'/'true' 转为布尔 true，其余为 false
	@Transform(({ value }) => value === 'true' || value === true)
	// 布尔校验
	@IsBoolean()
	// 字段定义：只显示未分类
	uncategorizedOnly?: boolean;

	// 新增 JSDoc：说明两种取值语义与互斥关系
	/** all：本人 + 他人公开；public：仅他人公开；与 categoryId/uncategorizedOnly 互斥 */
	// scope 可选（不传时走默认 all）
	@IsOptional()
	// 仅允许两种枚举值
	@IsIn(['all', 'public'])
	// 字段定义：列表可见范围
	scope?: 'all' | 'public';
}
```

**变更摘要**：新增 `scope?: 'all' | 'public'` 字段，并用 `IsIn` 限定白名单；其它字段保持不变。

---

### 4.2 `KnowledgeService.findPage`（`apps/backend/src/services/knowledge/knowledge.service.ts`）

**对比范围**：`findPage` 方法完整声明到闭合。新增 scope 解析、互斥校验与 where 分支。

**改动前** · `apps/backend/src/services/knowledge/knowledge.service.ts`（基线，约 L180–L251）

```typescript
	// 方法注释：分页列表语义（本人 + 他人公开，倒序）
	/**
	 * 分页列表：本人条目 + 他人公开条目；默认按更新时间倒序
	 */
	// 异步方法：接收当前登录 userId 与 DTO query，返回列表 + 总数
	async findPage(
		// 入参 1：登录用户 id
		userId: number,
		// 入参 2：查询参数 DTO
		query: QueryKnowledgeDto,
		// 返回类型：{ 列表项数组, 总数 }
	): Promise<{ list: KnowledgeListItem[]; total: number }> {
		// 页码默认 1
		const pageNo = query.pageNo ?? 1;
		// 每页条数默认 10
		const pageSize = query.pageSize ?? 10;
		// TypeORM take = 本页取多少条
		const take = pageSize;
		// 跳过前 N 条
		const skip = (pageNo - 1) * take;
		// 标题搜索关键字：去除首尾空白
		const title = query.title?.trim();
		// 分类与未分类不能同时生效的前置互斥校验
		if (query.categoryId && query.uncategorizedOnly) {
			// 抛 Nest 400 异常（BadRequestException 需在文件顶部已引入）
			throw new BadRequestException(
				// 错误消息
				'categoryId 与 uncategorizedOnly 不能同时使用',
			);
		}

		// 创建查询构建器：别名 k 指向 knowledge 主表
		const qb = this.knowledgeRepository
			// 基于实体仓储创建 QueryBuilder
			.createQueryBuilder('k')
			// 选择轻量字段（不含正文）
			.select([
				'k.id',
				'k.title',
				'k.author',
				'k.authorId',
				'k.isPublic',
				'k.categoryId',
				'k.createdAt',
				'k.updatedAt',
			])
			// 公开条目优先
			.orderBy('k.isPublic', 'DESC')
			// 次级按更新时间倒序
			.addOrderBy('k.updatedAt', 'DESC')
			// 取 N 条
			.take(take)
			// 偏移
			.skip(skip);

		// 若指定分类或只看未分类：仅查本人并追加细分条件
		if (query.categoryId || query.uncategorizedOnly) {
			// 主条件：作者是当前用户
			qb.where('k.authorId = :userId', { userId });
			// 若指定分类 id：追加分类过滤
			if (query.categoryId) {
				// 校验该分类 id 属于当前用户（防止越权看他人分类）
				await this.resolveUserCategoryId(userId, query.categoryId);
				// 追加 where：category_id 等于目标
				qb.andWhere('k.category_id = :categoryId', {
					// 命名参数绑定
					categoryId: query.categoryId,
				});
			} else {
				// 未分类分支：category_id 为空
				qb.andWhere('k.category_id IS NULL');
			}
		} else {
			// 其余情况：本人所有 + 任何人公开（原「全部」Tab 语义）
			qb.where('(k.authorId = :userId OR k.isPublic = true)', { userId });
		}

		// 若标题有值：追加不区分大小写的模糊匹配
		if (title) {
			// 把数据库列先转小写，再与小写关键词 LIKE
			qb.andWhere('LOWER(k.title) LIKE :title', {
				// 前后加 % 以支持中缀匹配；关键字也转小写
				title: `%${title.toLowerCase()}%`,
			});
		}

		// 一次查询：拿到分页行 + 满足条件总数
		const [rows, total] = await qb.getManyAndCount();
		// 统一返回结构：把实体转为前端需要的 listItem（处理 isOwned 等派生字段）
		return {
			// 每行调用 toListItem 转换
			list: rows.map((row) => this.toListItem(row, userId)),
			// 总数透传
			total,
		};
	}
```

**改动后** · `apps/backend/src/services/knowledge/knowledge.service.ts`（当前，约 L180–L251）

```typescript
	// 方法注释：保持原分页语义
	/**
	 * 分页列表：本人条目 + 他人公开条目；默认按更新时间倒序
	 */
	// 异步方法 findPage
	async findPage(
		// 入参 1：当前登录用户 id
		userId: number,
		// 入参 2：DTO 查询参数
		query: QueryKnowledgeDto,
		// 返回类型
	): Promise<{ list: KnowledgeListItem[]; total: number }> {
		// 页码默认 1
		const pageNo = query.pageNo ?? 1;
		// 每页条数默认 10
		const pageSize = query.pageSize ?? 10;
		// 分页：取多少条
		const take = pageSize;
		// 分页：跳过多少条
		const skip = (pageNo - 1) * take;
		// 标题关键字 trim
		const title = query.title?.trim();
		// scope 默认 all；显式传 public 走「仅他人公开」
		const scope = query.scope ?? 'all';
		// 原有互斥：分类与未分类不同时生效
		if (query.categoryId && query.uncategorizedOnly) {
			// 抛 400
			throw new BadRequestException(
				// 错误信息
				'categoryId 与 uncategorizedOnly 不能同时使用',
			);
		}
		// 新增互斥：scope=public 不应再叠加「本人分类/未分类」过滤（语义冲突）
		if (
			// 当前仅看他人公开
			scope === 'public' &&
			// 且传了 categoryId 或 uncategorizedOnly 任一项
			(query.categoryId || query.uncategorizedOnly)
		) {
			// 抛 400
			throw new BadRequestException(
				// 错误提示：告知前端两套参数互斥
				'scope=public 与 categoryId/uncategorizedOnly 不能同时使用',
			);
		}

		// 创建 QueryBuilder：别名 k
		const qb = this.knowledgeRepository
			// 基于仓储创建查询构建器
			.createQueryBuilder('k')
			// 选择轻量字段集合（不含正文大字段）
			.select([
				'k.id',
				'k.title',
				'k.author',
				'k.authorId',
				'k.isPublic',
				'k.categoryId',
				'k.createdAt',
				'k.updatedAt',
			])
			// 公开优先
			.orderBy('k.isPublic', 'DESC')
			// 次级按更新时间倒序
			.addOrderBy('k.updatedAt', 'DESC')
			// 分页 take
			.take(take)
			// 分页 skip
			.skip(skip);

		// 新增分支：仅查看他人公开
		if (scope === 'public') {
			// where：isPublic=true 且作者不是当前用户
			qb.where('k.isPublic = true AND k.authorId != :userId', { userId });
			// 否则走原有分类分支：仍限定本人 + 分类/未分类
		} else if (query.categoryId || query.uncategorizedOnly) {
			// 主条件：作者是当前用户
			qb.where('k.authorId = :userId', { userId });
			// 有分类 id：校验归属并按 id 过滤
			if (query.categoryId) {
				// 校验分类 id 属当前用户
				await this.resolveUserCategoryId(userId, query.categoryId);
				// 追加：category_id 匹配
				qb.andWhere('k.category_id = :categoryId', {
					// 绑定分类 id
					categoryId: query.categoryId,
				});
			} else {
				// 未分类：category_id 为空
				qb.andWhere('k.category_id IS NULL');
			}
		} else {
			// all + 无分类：复用「本人 + 任意公开」原默认（既含本人公开，也含他人公开）
			qb.where('(k.authorId = :userId OR k.isPublic = true)', { userId });
		}

		// 标题模糊搜索（大小写不敏感）
		if (title) {
			// where：列小写匹配 关键字小写
			qb.andWhere('LOWER(k.title) LIKE :title', {
				// 构造带前后通配符的小写搜索串
				title: `%${title.toLowerCase()}%`,
			});
		}

		// 一次取分页结果 + 总数
		const [rows, total] = await qb.getManyAndCount();
		// 返回：行逐项转换 + 总数
		return {
			// 每行转 listItem
			list: rows.map((row) => this.toListItem(row, userId)),
			// 总数透传
			total,
		};
	}
```

**变更摘要**：

1. 引入 `scope = query.scope ?? 'all'`。
2. 新增 `scope=public` 与 `categoryId/uncategorizedOnly` 的互斥校验。
3. where 分支从两档扩充为三档：`public` → `isPublic && 非本人`；分类档 → 本人 + 分类条件；else → 本人 OR 公开（默认）。

---

### 4.3 `KnowledgeCategoryKey` 类型（`apps/frontend/src/types/index.ts`）

**对比范围**：`KnowledgeCategoryKey` 联合类型定义（含相邻 JSDoc）。

**改动前** · `apps/frontend/src/types/index.ts`（基线，约 L103–L111）

```typescript
// 类型 JSDoc：当时只含全部/分类/未分类三种
/** 知识库列表 Tab：全部 | 某分类 | 未分类 */
// 导出 discriminated union：Tab 键类型
export type KnowledgeCategoryKey =
	// kind=all：显示全部
	| { kind: 'all' }
	// kind=category：附带分类 id
	| { kind: 'category'; categoryId: string }
	// kind=uncategorized：只看未分类
	| { kind: 'uncategorized' };
```

**改动后** · `apps/frontend/src/types/index.ts`（当前，约 L106–L111）

```typescript
// 类型 JSDoc：补充「公开（他人）」一档
/** 知识库列表 Tab：全部 | 某分类 | 未分类 | 公开（他人） */
// 导出 discriminated union：Tab 键类型
export type KnowledgeCategoryKey =
	// all：全部 Tab
	| { kind: 'all' }
	// category：具体分类
	| { kind: 'category'; categoryId: string }
	// uncategorized：未分类
	| { kind: 'uncategorized' }
	// 新增：只看他人公开文档
	| { kind: 'public' };
```

**变更摘要**：新增 `{ kind: 'public' }` 作为第四种 Tab 键。

---

### 4.4 `getKnowledgeList` 请求封装（`apps/frontend/src/service/index.ts`）

**对比范围**：`getKnowledgeList` 函数声明与返回闭合。

**改动前** · `apps/frontend/src/service/index.ts`（基线，约 L1812–L1836）

```typescript
// JSDoc：接口注释
/** GET /knowledge/list：分页列表 */
// 导出异步函数：获取知识列表
export const getKnowledgeList = async (params?: {
	// 可选：页码
	pageNo?: number;
	// 可选：每页条数
	pageSize?: number;
	// 可选：标题
	title?: string;
	// 可选：作者 id
	authorId?: number;
	// 可选：分类 id
	categoryId?: string;
	// 可选：只看未分类
	uncategorizedOnly?: boolean;
}) => {
	// 返回：http get；泛型为 列表 + total
	return await http.get<{ list: KnowledgeListItem[]; total: number }>(
		// 接口常量 URL
		KNOWLEDGE_LIST,
		// 请求参数对象
		{
			// query 键下传 GET 参数
			querys: {
				// 传页码
				pageNo: params?.pageNo,
				// 传每页条数
				pageSize: params?.pageSize,
				// 传标题关键字
				title: params?.title,
				// 传作者 id
				authorId: params?.authorId,
				// 传分类 id
				categoryId: params?.categoryId,
				// 传是否只看未分类
				uncategorizedOnly: params?.uncategorizedOnly,
			},
		},
	);
};
```

**改动后** · `apps/frontend/src/service/index.ts`（当前，约 L1812–L1836）

```typescript
// JSDoc：接口注释
/** GET /knowledge/list：分页列表 */
// 导出异步函数：获取知识列表
export const getKnowledgeList = async (params?: {
	// 可选：页码
	pageNo?: number;
	// 可选：每页条数
	pageSize?: number;
	// 可选：标题关键字
	title?: string;
	// 可选：作者 id
	authorId?: number;
	// 可选：分类 id
	categoryId?: string;
	// 可选：只看未分类
	uncategorizedOnly?: boolean;
	// 新增：查询范围（全部 / 仅他人公开）
	scope?: 'all' | 'public';
}) => {
	// 返回：http GET 调用 + 泛型响应体
	return await http.get<{ list: KnowledgeListItem[]; total: number }>(
		// 接口 URL 常量
		KNOWLEDGE_LIST,
		// 请求配置对象
		{
			// query 字段承载 GET 查询参数
			querys: {
				// 透传页码
				pageNo: params?.pageNo,
				// 透传每页条数
				pageSize: params?.pageSize,
				// 透传标题关键字
				title: params?.title,
				// 透传作者 id
				authorId: params?.authorId,
				// 透传分类 id
				categoryId: params?.categoryId,
				// 透传未分类开关
				uncategorizedOnly: params?.uncategorizedOnly,
				// 新增：透传 scope
				scope: params?.scope,
			},
		},
	);
};
```

**变更摘要**：`params` 结构体追加 `scope?: 'all' | 'public'`，并在 `querys` 中透传到后端。

---

### 4.5 `listQueryFromKey` + Store 字段 + `fetchPublicCount` + `itemMatchesActiveCategory`（`apps/frontend/src/store/knowledge.ts`）

#### 4.5.1 头部常量 / 工具函数（约 L1–L38）

**改动前** · `apps/frontend/src/store/knowledge.ts`（基线，约 L1–L38）

```typescript
// 从 UI 包引入 Toast 轻提示组件
import { Toast } from '@ui/index';
// MobX 工具：自动响应式 + 在非 action 里安全批量赋值
import { makeAutoObservable, runInAction } from 'mobx';
// React 滚动事件处理器类型
import type { UIEventHandler } from 'react';
// 从 service 统一引入知识库相关 API 调用
import {
	assignKnowledgeItemCategory,
	createKnowledgeCategory,
	deleteKnowledge,
	getKnowledgeDetail,
	getKnowledgeList,
	getKnowledgeTrashList,
	loadKnowledgeCategoriesSummary,
	removeKnowledgeCategory,
	reorderKnowledgeCategories,
	setKnowledgeVisibility,
	updateKnowledge,
	updateKnowledgeCategory,
} from '@/service';
// 类型引入：知识库域内核心类型
import type {
	KnowledgeCategory,
	KnowledgeCategoryKey,
	KnowledgeListItem,
	KnowledgeRecord,
	KnowledgeTrashListItem,
} from '@/types';
// Markdown 保存 payload 类型
import type { SaveKnowledgeMarkdownPayload } from '@/utils/knowledge-save';
// 获取已登录的本地用户 id
import { getLoggedInUserId } from './loggedInUserId';

// 本地定义：默认每页 20 条（历史版本为 store 私有常量）
const DEFAULT_PAGE_SIZE = 20;
// 触发加载更多的底部剩余像素阈值
/** 距底部小于该像素时触发加载下一页 */
const SCROLL_LOAD_THRESHOLD_PX = 72;

// 工具函数：把 categoryKey 转为后端 query 中的分类/未分类参数（旧版无 scope）
function listQueryFromKey(key: KnowledgeCategoryKey): {
	// 返回可选分类 id
	categoryId?: string;
	// 返回可选未分类开关
	uncategorizedOnly?: boolean;
} {
	// 分类 Tab：返回 categoryId
	if (key.kind === 'category') return { categoryId: key.categoryId };
	// 未分类 Tab：返回 uncategorizedOnly
	if (key.kind === 'uncategorized') return { uncategorizedOnly: true };
	// 其它（all）：返回空对象，交由后端默认（本人+公开）
	return {};
}
```

**改动后** · `apps/frontend/src/store/knowledge.ts`（当前，约 L1–L38）

```typescript
// 从 UI 包引入 Toast
import { Toast } from '@ui/index';
// MobX：自动响应式 + 安全批量写
import { makeAutoObservable, runInAction } from 'mobx';
// React 滚动处理器类型
import type { UIEventHandler } from 'react';
// 从 service 引入知识库 API 封装
import {
	assignKnowledgeItemCategory,
	createKnowledgeCategory,
	deleteKnowledge,
	getKnowledgeDetail,
	getKnowledgeList,
	getKnowledgeTrashList,
	loadKnowledgeCategoriesSummary,
	removeKnowledgeCategory,
	reorderKnowledgeCategories,
	setKnowledgeVisibility,
	updateKnowledge,
	updateKnowledgeCategory,
} from '@/service';
// 知识库域核心类型
import type {
	KnowledgeCategory,
	KnowledgeCategoryKey,
	KnowledgeListItem,
	KnowledgeRecord,
	KnowledgeTrashListItem,
} from '@/types';
// 归一化后的全局分页常量 + 滚动加载阈值（原先在 store 内私有）
import { DEFAULT_PAGE_SIZE, SCROLL_LOAD_THRESHOLD_PX } from '@/constants';
// Markdown 保存 payload 类型
import type { SaveKnowledgeMarkdownPayload } from '@/utils/knowledge-save';
// 当前登录用户 id（本地缓存）
import { getLoggedInUserId } from './loggedInUserId';

// 工具函数：把 Tab Key 转为后端查询参数（新增 scope 返回字段）
function listQueryFromKey(key: KnowledgeCategoryKey): {
	// 返回值新增：范围枚举
	scope?: 'all' | 'public';
	// 返回：分类 id
	categoryId?: string;
	// 返回：只看未分类
	uncategorizedOnly?: boolean;
} {
	// 公开 Tab：明确传 scope=public
	if (key.kind === 'public') return { scope: 'public' };
	// 分类 Tab：传 categoryId
	if (key.kind === 'category') return { categoryId: key.categoryId };
	// 未分类 Tab：传 uncategorizedOnly
	if (key.kind === 'uncategorized') return { uncategorizedOnly: true };
	// 其它：显式传 scope=all，使后端明确进入「本人 OR 公开」默认分支
	return { scope: 'all' };
}
```

**变更摘要**：
- 分页/阈值常量从 store 私有迁移到 `@/constants`，配合《分页常量归一化.md》。
- `listQueryFromKey` 返回值增加 `scope`，显式驱动后端三档逻辑（不再依赖空对象 + 后端默认）。

#### 4.5.2 列表 Store 字段与派生 `hasMore` / `listAllCount`（约 L84–L211）

**改动前** · `apps/frontend/src/store/knowledge.ts`（基线，约 L84–L211）

```typescript
	// ...（类构造等上下文未改动，摘录范围：字段声明 + hasMore / trashHasMore）

	// 服务端总条数（当前 Tab 下）
	/** 服务端总条数 */
	total = 0;
	// 已加载到的最后一页页码
	/** 已加载到的最后一页页码 */
	pageNo = 1;
	// 每页条数，引用本地 DEFAULT_PAGE_SIZE
	pageSize = DEFAULT_PAGE_SIZE;
	// 标题模糊搜索关键字
	/** 标题模糊搜索关键字 */
	titleKeyword = '';
	// 是否首屏加载中
	loading = false;
	// 是否加载更多中
	loadingMore = false;
	// 分类列表
	categories: KnowledgeCategory[] = [];
	// 未分类计数（本人）
	uncategorizedCount = 0;
	// 本人条目总数
	totalItemCount = 0;
	// 当前激活的分类 Tab Key
	activeCategoryKey: KnowledgeCategoryKey = { kind: 'all' };

	// ...（回收站分页字段、编辑器草稿字段；此处略）

	// getter：是否还有更多可加载（对比当前已加载列表长度 vs total）
	get hasMore(): boolean {
		// 直接用 list.length < total
		return this.list.length < this.total;
	}

	// getter：回收站是否还有更多
	get trashHasMore(): boolean {
		// 直接比较
		return this.trashList.length < this.trashTotal;
	}
```

**改动后** · `apps/frontend/src/store/knowledge.ts`（当前，约 L84–L211）

```typescript
	// ...（摘录范围同基线：字段声明 + 派生 getter）

	// 当前 Tab 的服务端总条数
	/** 服务端总条数 */
	total = 0;
	// 已加载到的最后一页页码
	/** 已加载到的最后一页页码 */
	pageNo = 1;
	// 每页条数：引用全局 DEFAULT_PAGE_SIZE（归一化）
	pageSize = DEFAULT_PAGE_SIZE;
	// 搜索关键字
	/** 标题模糊搜索关键字 */
	titleKeyword = '';
	// 首屏加载态
	loading = false;
	// 加载更多态
	loadingMore = false;
	// 分类数组
	categories: KnowledgeCategory[] = [];
	// 未分类文档计数（本人）
	uncategorizedCount = 0;
	// 本人条目总数（来自 categoriesSummary 接口）
	totalItemCount = 0;
	// 新增：他人公开条目总数（来自 scope=public count probe）
	publicItemTotal = 0;
	// 当前激活的分类 Tab（默认 all）
	activeCategoryKey: KnowledgeCategoryKey = { kind: 'all' };

	// ...（回收站字段、草稿字段；此处略）

	// getter：是否还有更多可加载；走 safeTotal 避免后端 NaN/null 时的异常判断
	get hasMore(): boolean {
		// 返回：当前列表长度 < 安全总条数
		return this.list.length < this.safeTotal();
	}

	// 新增 getter：「全部」Tab 的角标 = 本人总数 + 他人公开总数
	/** 「全部」Tab 角标：我的文档 + 他人公开 */
	get listAllCount(): number {
		// 返回两计数之和
		return this.totalItemCount + this.publicItemTotal;
	}

	// 新增：把后端 total 归一为有限自然数（空/非法时 0）
	safeTotal(): number {
		// 判定有限数字且 >=0：返回原值，否则返回 0
		return Number.isFinite(this.total) && this.total >= 0 ? this.total : 0;
	}

	// getter：回收站更多
	get trashHasMore(): boolean {
		// 回收站直接用 strict 比较
		return this.trashList.length < this.trashTotal;
	}
```

**变更摘要**：
1. 字段新增 `publicItemTotal`。
2. 新增派生 `listAllCount` 与工具方法 `safeTotal`。
3. `hasMore` 从直接对比 `total` 改为走 `safeTotal`，健壮性提升。

#### 4.5.3 `fetchPublicCount` / `itemMatchesActiveCategory` / `assignItemCategory` / `reset`（约 L465–L582、L696–L714）

**改动前** · `apps/frontend/src/store/knowledge.ts`（基线，约 L465–L582）

```typescript
	// 拉取分类汇总：分类列表 + 未分类计数 + 本人总数
	async fetchCategories(): Promise<void> {
		// try 包裹，失败不阻塞
		try {
			// 调后端汇总接口
			const data = await loadKnowledgeCategoriesSummary();
			// MobX：在 action 环境下批量赋值
			runInAction(() => {
				// 写回分类数组
				this.categories = data.categories;
				// 写回未分类计数
				this.uncategorizedCount = data.uncategorizedCount;
				// 写回本人条目总数
				this.totalItemCount = data.totalItemCount;
			});
		} catch {
			// 吞异常：分类加载失败不阻塞列表 UI
			// 分类加载失败不阻塞列表
		}
	}

	// 设置当前分类 Key：刷新列表
	setActiveCategoryKey(key: KnowledgeCategoryKey): void {
		// 写激活 key
		this.activeCategoryKey = key;
		// 触发刷新（void 忽略 Promise：Store 内约定）
		void this.refreshList();
	}

	// 判断某分类 id 是否匹配当前激活 Tab（旧签名：仅 categoryId）
	itemMatchesActiveCategory(categoryId?: string | null): boolean {
		// 读激活 key
		const key = this.activeCategoryKey;
		// all：任何条目都匹配
		if (key.kind === 'all') return true;
		// uncategorized：匹配 categoryId 为空
		if (key.kind === 'uncategorized') return categoryId == null;
		// category：匹配分类 id 相等
		return categoryId === key.categoryId;
	}

	// ...（中间分类增删改：略）

	// 把某条目移动到目标分类（或未分类）
	async assignItemCategory(
		// 条目 id
		id: string,
		// 目标分类 id（null = 未分类）
		categoryId: string | null,
	): Promise<void> {
		// 在当前列表中找目标条目
		const current = this.list.find((item) => item.id === id);
		// 非本人条目不可改分类：直接短路
		if (current && current.isOwned === false) return;
		// 调服务端执行分类赋值
		const updated = await assignKnowledgeItemCategory(id, categoryId);
		// 写 Store 列表状态
		runInAction(() => {
			// 旧签名：只传更新后的 categoryId 判断该条目是否仍留在当前 Tab
			const stays = this.itemMatchesActiveCategory(updated.categoryId);
			// 若留在当前 Tab：更新数组中对应项
			if (stays) {
				// map 覆盖更新
				this.list = this.list.map((item) =>
					// 命中 id 则合并更新字段
					item.id === id ? { ...item, ...updated } : item,
				);
			} else {
				// 否则：移除出当前列表
				const had = this.list.some((item) => item.id === id);
				// 过滤掉目标 id
				this.list = this.list.filter((item) => item.id !== id);
				// 若之前存在，则把 total -1（乐观更新总数）
				if (had) this.total = Math.max(0, this.total - 1);
			}
			// 当前 Tab 被搬空时自动切回「全部」
			this.resetActiveCategoryIfEmpty();
		});
		// 后台刷新分类计数
		void this.fetchCategories();
	}
```

**改动前** · `apps/frontend/src/store/knowledge.ts`（基线，reset 片段，约 L696–L714）

```typescript
	// 只重置列表相关分页状态（不清空编辑器草稿）
	/** 仅重置列表分页状态（不清空编辑器草稿） */
	reset(): void {
		// 清空列表
		this.list = [];
		// 重置总数
		this.total = 0;
		// 重置页码
		this.pageNo = 1;
		// 清空标题关键字
		this.titleKeyword = '';
		// 关 loading
		this.loading = false;
		// 关 loadingMore
		this.loadingMore = false;
		// 清空分类
		this.categories = [];
		// 未分类计数归零
		this.uncategorizedCount = 0;
		// 本人总数归零
		this.totalItemCount = 0;
		// 激活 Tab 恢复 all
		this.activeCategoryKey = { kind: 'all' };
	}
```

**改动后** · `apps/frontend/src/store/knowledge.ts`（当前，约 L465–L582）

```typescript
	// 拉取分类汇总：分类数组 + 未分类 + 本人总数
	async fetchCategories(): Promise<void> {
		// try 包裹异常
		try {
			// 调后端汇总
			const data = await loadKnowledgeCategoriesSummary();
			// MobX：在 action 上下文中批量写
			runInAction(() => {
				// 写回分类数组
				this.categories = data.categories;
				// 写回未分类计数
				this.uncategorizedCount = data.uncategorizedCount;
				// 写回本人总数
				this.totalItemCount = data.totalItemCount;
			});
		} catch {
			// 吞异常：不阻塞主流程
			// 分类加载失败不阻塞列表
		}
	}

	// 新增：获取「他人公开」条目总数；只取 total，不消费 list body
	async fetchPublicCount(): Promise<void> {
		// 未登录：本地模式，直接短路
		if (!getLoggedInUserId()) return;
		// try 包裹
		try {
			// scope=public + 只取 1 条（减少 body 传输，total 仍准确）
			const res = await getKnowledgeList({
				// 显式公开档
				scope: 'public',
				// 第一页
				pageNo: 1,
				// 仅 1 条
				pageSize: 1,
			});
			// 请求失败或无 data：直接返回
			if (!res.success || !res.data) return;
			// MobX：写 Store
			runInAction(() => {
				// 把后端 total 转 number
				const nextTotal = Number(res.data.total);
				// 仅当是合法非负整数时写入，否则置 0
				this.publicItemTotal =
					Number.isFinite(nextTotal) && nextTotal >= 0 ? nextTotal : 0;
			});
		} catch {
			// 公开数量加载失败不阻塞列表
			// 吞异常：不影响主列表展示
		}
	}

	// 设置激活分类 Tab 并刷新
	setActiveCategoryKey(key: KnowledgeCategoryKey): void {
		// 写激活 key
		this.activeCategoryKey = key;
		// 后台刷新
		void this.refreshList();
	}

	// 重签名：由仅 categoryId 升级为条目 Pick 对象（含 isPublic/isOwned/categoryId）
	itemMatchesActiveCategory(
		// 入参：从列表项中取判定相关字段
		item: Pick<KnowledgeListItem, 'categoryId' | 'isPublic' | 'isOwned'>,
	): boolean {
		// 当前激活 Tab
		const key = this.activeCategoryKey;
		// 新增分支：公开 Tab 仅命中「公开 + 非本人」
		if (key.kind === 'public') {
			// 必须同时满足公开且不属于当前用户
			return item.isPublic === true && item.isOwned === false;
		}
		// all 匹配一切
		if (key.kind === 'all') return true;
		// uncategorized：categoryId 为空
		if (key.kind === 'uncategorized') return item.categoryId == null;
		// 其它（category）：分类 id 严格相等
		return item.categoryId === key.categoryId;
	}

	// ...（中间分类增删改：略）

	// 移动条目到分类 / 未分类
	async assignItemCategory(
		// 条目 id
		id: string,
		// 目标分类（null = 未分类）
		categoryId: string | null,
	): Promise<void> {
		// 找到当前列表中的条目
		const current = this.list.find((item) => item.id === id);
		// 非本人条目不可改分类，直接跳过
		if (current && current.isOwned === false) return;
		// 服务端执行，返回更新后的条目摘要
		const updated = await assignKnowledgeItemCategory(id, categoryId);
		// 批量更新 Store
		runInAction(() => {
			// 用新签名：传入完整更新后条目对象（含 isPublic/isOwned/categoryId）判定去留
			const stays = this.itemMatchesActiveCategory(updated);
			// 留下：更新列表项
			if (stays) {
				// map：命中 id 合并更新
				this.list = this.list.map((item) =>
					// id 相等时覆盖
					item.id === id ? { ...item, ...updated } : item,
				);
			} else {
				// 不留下：从列表移除
				const had = this.list.some((item) => item.id === id);
				// 过滤目标 id
				this.list = this.list.filter((item) => item.id !== id);
				// 若原本有：乐观 -1 总数
				if (had) this.total = Math.max(0, this.total - 1);
			}
			// 空 Tab 复位到 all
			this.resetActiveCategoryIfEmpty();
		});
		// 后台刷新分类计数
		void this.fetchCategories();
	}
```

**改动后** · `apps/frontend/src/store/knowledge.ts`（当前，reset 片段，约 L696–L714）

```typescript
	// 仅重置列表相关分页 / 分类状态
	/** 仅重置列表分页状态（不清空编辑器草稿） */
	reset(): void {
		// 清空列表
		this.list = [];
		// 总数归零
		this.total = 0;
		// 页码回到 1
		this.pageNo = 1;
		// 清空关键字
		this.titleKeyword = '';
		// loading 关
		this.loading = false;
		// loadingMore 关
		this.loadingMore = false;
		// 清空分类
		this.categories = [];
		// 未分类归零
		this.uncategorizedCount = 0;
		// 本人总数归零
		this.totalItemCount = 0;
		// 新增：他人公开计数同步归零
		this.publicItemTotal = 0;
		// 激活 Tab 回到 all
		this.activeCategoryKey = { kind: 'all' };
	}
```

**变更摘要**：
- 新增 `fetchPublicCount`：`scope=public, pageSize=1` 探针获取公开总数。
- `itemMatchesActiveCategory` 升级签名，增加 `public` 分支判定。
- `assignItemCategory` 调用处改为传完整对象，保证分类移动后的去留判断同时考虑公开 / 归属。
- `reset` 新增 `publicItemTotal = 0` 清理。

---

### 4.6 `KnowledgeList`：列表入口刷新 + 标签栏「公开」Chip（`apps/frontend/src/views/knowledge/KnowledgeList.tsx`）

#### 4.6.1 云端打开时并行刷新（约 L658–L664）

**改动前** · `apps/frontend/src/views/knowledge/KnowledgeList.tsx`（基线，约 L658–L664）

```tsx
		// 注释：打开云端知识库时拉当前已提交的搜索关键词（输入中未回车的不会提交）
		// 云端列表：打开 / 切回数据库时拉当前已提交的关键词（输入中未回车的不搜）
		// React effect：根据依赖变化执行刷新
		useEffect(() => {
			// 关闭抽屉 / 本地模式 / 禁止云端：不刷新
			if (!open || useLocalFolder || !allowCloudList) return;
			// 刷新当前列表（含查询条件）
			void knowledgeStore.refreshList(appliedQuery);
			// 拉分类汇总
			void knowledgeStore.fetchCategories();
			// 依赖：抽屉开关、本地/云端切换、云端可用、Store（observer 引用稳定）
		}, [open, useLocalFolder, allowCloudList, knowledgeStore]);
```

**改动后** · `apps/frontend/src/views/knowledge/KnowledgeList.tsx`（当前，约 L658–L664）

```tsx
		// 注释：云端打开时并发拉列表 / 分类汇总 + 公开总数 probe
		// 云端列表：打开 / 切回数据库时拉当前已提交的关键词（输入中未回车的不搜）
		useEffect(() => {
			// 关抽屉 / 本地模式 / 云端不可用：直接跳过
			if (!open || useLocalFolder || !allowCloudList) return;
			// 刷新列表
			void knowledgeStore.refreshList(appliedQuery);
			// 刷新分类摘要
			void knowledgeStore.fetchCategories();
			// 新增：并发拉他人公开文档总数（用于角标 + 是否显示「公开」Tab）
			void knowledgeStore.fetchPublicCount();
			// 依赖保持不变
		}, [open, useLocalFolder, allowCloudList, knowledgeStore]);
```

#### 4.6.2 分类标签栏：「全部」计数 + 新增「公开」Chip（约 L1282–L1330）

**改动前** · `apps/frontend/src/views/knowledge/KnowledgeList.tsx`（基线，约 L1282–L1330）

```tsx
				// JSX：分类标签容器；横向滚动 tablist 语义
										role="tablist"
				// aria-label：全部
										aria-label={t('knowledge.list.category.all')}
									>
				// 展开一个数组：每个元素是 Tab chip 描述对象
										{(
											[
				// 第一项：全部 Tab
													{
				// key：all 型类别键（做一次断言以统一类型）
														key: { kind: 'all' } as KnowledgeCategoryKey,
				// 标签：全部
														label: t('knowledge.list.category.all'),
				// 计数：本人总数（旧版只反映本人，不含他人公开）
														count: knowledgeStore.totalItemCount,
													},
				// 自定义分类：过滤掉 0 条的分类，再映射
													...knowledgeStore.categories
														.filter((c) => c.itemCount > 0)
														.map((c) => ({
				// key：category 型
															key: {
																kind: 'category' as const,
																categoryId: c.id,
															},
				// 标签：分类名
															label: c.name,
				// 计数：分类文档数
															count: c.itemCount,
														})),
				// 未分类：有未分类文档时显示
													...(knowledgeStore.uncategorizedCount > 0
														? [
																{
				// key：uncategorized 型
																	key: {
																		kind: 'uncategorized' as const,
																	},
				// 标签：未分类文案
																	label: t(
																		'knowledge.list.category.uncategorized',
																	),
				// 计数：未分类
																	count: knowledgeStore.uncategorizedCount,
																},
															]
														: []),
				// 断言为统一数组类型，便于 .map 的 chip 推导
											] as Array<{
												key: KnowledgeCategoryKey;
												label: string;
												count: number;
											}>
				// 对每个 chip 做渲染
										).map((chip) => {
				// 是否激活：用 deep 相等比较函数比较两个 categoryKey
											const active = isActiveCategoryKey(
												knowledgeStore.activeCategoryKey,
												chip.key,
											);
				// 为每个 tab 生成稳定的 dom id
											const tabId =
				// 分类 Tab：带 categoryId
													chip.key.kind === 'category'
														? `knowledge-cat-${chip.key.categoryId}`
														: `knowledge-cat-${chip.key.kind}`;
```

**改动后** · `apps/frontend/src/views/knowledge/KnowledgeList.tsx`（当前，约 L1282–L1330）

```tsx
				// tablist 角色：辅助技术可识别为可切换标签容器
										role="tablist"
				// 无障碍标签：用「全部」文案（分类栏整体说明）
										aria-label={t('knowledge.list.category.all')}
									>
				// 数组：按顺序拼 all → 自定义分类 → 公开 → 未分类
										{(
											[
				// 第一项：全部 Tab
													{
				// key：all 型；断言成联合类型便于后续 map
														key: { kind: 'all' } as KnowledgeCategoryKey,
				// 标签：全部
														label: t('knowledge.list.category.all'),
				// 计数：更新为「本人总数 + 他人公开总数」
														count: knowledgeStore.listAllCount,
													},
				// 自定义分类：过滤 0 条、再映射 chip
													...knowledgeStore.categories
														.filter((c) => c.itemCount > 0)
														.map((c) => ({
				// key：category 型
															key: {
																kind: 'category' as const,
																categoryId: c.id,
															},
				// 标签：分类名
															label: c.name,
				// 计数：分类下文档数
															count: c.itemCount,
														})),
				// 新增：仅当他人公开总数 > 0 时才显示「公开」Tab（0 条时避免噪音）
													...(knowledgeStore.publicItemTotal > 0
														? [
																{
				// key：public 型
																	key: {
																		kind: 'public' as const,
																	},
				// 标签：i18n 公开文案
																	label: t(
																		'knowledge.list.category.public',
																	),
				// 计数：他人公开文档总数
																	count: knowledgeStore.publicItemTotal,
																},
															]
														: []),
				// 未分类：> 0 才显示
													...(knowledgeStore.uncategorizedCount > 0
														? [
																{
				// key：uncategorized 型
																	key: {
																		kind: 'uncategorized' as const,
																	},
				// 标签：未分类
																	label: t(
																		'knowledge.list.category.uncategorized',
																	),
				// 计数：未分类
																	count: knowledgeStore.uncategorizedCount,
																},
															]
														: []),
				// 类型断言：声明 chip 三元组通用结构
											] as Array<{
												key: KnowledgeCategoryKey;
												label: string;
												count: number;
											}>
				// 逐个渲染 chip
										).map((chip) => {
				// 当前 chip 是否激活：通过 deep equal 工具函数比较
											const active = isActiveCategoryKey(
												knowledgeStore.activeCategoryKey,
												chip.key,
											);
				// 生成 Tab DOM id：分类带 categoryId，其它直接用 kind 字符串
											const tabId =
													chip.key.kind === 'category'
														? `knowledge-cat-${chip.key.categoryId}`
														: `knowledge-cat-${chip.key.kind}`;
```

**变更摘要**：
1. 「全部」Tab 的计数改为 `listAllCount`（含公开）。
2. 在「自定义分类」与「未分类」之间插入**条件渲染**的「公开」Chip：仅当 `publicItemTotal > 0` 时出现。
3. 切换效果依赖 Store 中 `setActiveCategoryKey → listQueryFromKey(kind:public) → scope=public`，整条链路已统一。

---

### 4.7 i18n 字典：新增「公开」文案（`apps/frontend/src/i18n/locales/zh-CN.ts`、`en-US.ts`）

**改动前** · `apps/frontend/src/i18n/locales/zh-CN.ts`（基线，约 L865–L870）

```typescript
	// 知识库分类：移动到分类
	'knowledge.list.category.move': '移动到分类',
	// 知识库分类：全部
	'knowledge.list.category.all': '全部',
	// 知识库分类：未分类
	'knowledge.list.category.uncategorized': '未分类',
```

**改动后** · `apps/frontend/src/i18n/locales/zh-CN.ts`（当前，约 L865–L870）

```typescript
	// 移动到分类
	'knowledge.list.category.move': '移动到分类',
	// 全部
	'knowledge.list.category.all': '全部',
	// 新增：公开 Tab 中文文案
	'knowledge.list.category.public': '公开',
	// 未分类
	'knowledge.list.category.uncategorized': '未分类',
```

**改动前** · `apps/frontend/src/i18n/locales/en-US.ts`（基线，约 L939–L944）

```typescript
	// 移动到分类（英文）
	'knowledge.list.category.move': 'Move to category',
	// 全部（英文）
	'knowledge.list.category.all': 'All',
	// 未分类（英文）
	'knowledge.list.category.uncategorized': 'Uncategorized',
```

**改动后** · `apps/frontend/src/i18n/locales/en-US.ts`（当前，约 L939–L944）

```typescript
	// Move to category
	'knowledge.list.category.move': 'Move to category',
	// All
	'knowledge.list.category.all': 'All',
	// 新增：Public Tab 英文文案
	'knowledge.list.category.public': 'Public',
	// Uncategorized
	'knowledge.list.category.uncategorized': 'Uncategorized',
```

---

## 5. 兼容性与影响

- **接口兼容性**：`scope` 是可选字段，旧客户端不传时仍走后端默认 `all` 语义（本人 + 任意公开），兼容历史 Web / 小程序端。
- **列表排序**：`orderBy` 规则未变，仍为公开优先 + 更新时间倒序，与《公开优先排序.md》一致。
- **用户体验**：
  - 「全部」角标从只算本人变为含公开，数字会更大；但文案不变，不会产生新误导。
  - 没有他人公开文档时不显示「公开」Tab，减少空状态噪声。
- **风险与回归建议**：
  1. 切换到「公开」Tab 后滚动分页、按标题搜索、切换分类再回到公开均应正确。
  2. 切换本人文档的「公开」状态：若该文档本在公开 Tab 展示且改作者就是本人，应从公开 Tab 列表中消失（因 `isOwned` 判定）。
  3. 后端返回 `total` 异常（NaN/null）时前端不应无限滚动请求。
  4. 登出/换号后 `publicItemTotal` 应清零并重新 probe。

---

## 6. 相关源码路径

| 说明 | 路径 |
| ---- | ---- |
| 后端 DTO：scope 字段声明 | `apps/backend/src/services/knowledge/dto/query-knowledge.dto.ts` |
| 后端列表查询：findPage where 分支 | `apps/backend/src/services/knowledge/knowledge.service.ts` |
| 前端 Tab Key 类型：新增 `kind:'public'` | `apps/frontend/src/types/index.ts` |
| 前端 HTTP 封装：getKnowledgeList scope 透传 | `apps/frontend/src/service/index.ts` |
| 前端 Store：公开计数 + 匹配函数 + hasMore 安全化 | `apps/frontend/src/store/knowledge.ts` |
| 前端列表 UI：打开时探针 + 标签栏公开 Chip | `apps/frontend/src/views/knowledge/KnowledgeList.tsx` |
| 中 / 英文文案：knowledge.list.category.public | `apps/frontend/src/i18n/locales/zh-CN.ts` / `en-US.ts` |
| 分页常量归一化（本修改同步） | 《书架知识库分页常量归一化.md》 |

---

（若与仓库最新源码不一致，以源码为准）
