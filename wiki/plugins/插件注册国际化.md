# 插件 Registry i18n 解耦（自带多语言文案）实现归档

> 文档角色：implementation-doc-from-diff 归档稿
> 改动一轮：插件 registry 自带多语言 title/description，不再依赖 Host i18n key
> 状态：已落地（2026-07）

## 1. 背景与目标

此前插件展示文案（标题 / 描述 / 侧栏名）依赖 Host i18n 字典里的 key：

- `PluginDescriptor.titleKey` / `descriptionKey` / `menu.nameKey` 指向 Host `zh-CN.ts` / `en-US.ts` 中的条目；
- 每新增或改名一个插件，都要同步改 Host 两份语言包，耦合严重；
- 第三方插件作者无法控制自己的文案，只能等宿主合并 i18n key。

本轮把多语言文案下沉到 **插件 registry 自身**：

- registry 直接内嵌 `{ 'zh-CN': ..., 'en-US': ... }` 形式的 `title` / `description`；
- Host 路由 meta 新增 `titleI18n` 字段，面包屑 / 标题解析链优先消费它；
- Host i18n 中 3 个 `plugins.desc.*` key 随之删除，registry 成为文案唯一来源；
- 侧栏 `nameKey` 退化为稳定 id（不再查 Host i18n），仅作去重 / key 用。

目标是让 **插件作者改 registry 即可改文案**，Host i18n 不再为插件文案背书。

## 2. 改动范围

- `apps/frontend/src/plugins/core/localeText.ts`（**新增**）：`PluginLocaleMap` 类型 + `pickPluginLocaleText` 取值函数。
- `apps/frontend/src/plugins/core/types.ts`：`PluginDescriptor` 接口去 `titleKey/descriptionKey/menu.nameKey`，改 `title/description` 多语言形态。
- `apps/frontend/src/plugins/core/PluginManager.ts`：路由 meta 由 `titleKey` 改 `titleI18n`；侧栏 `nameKey` 固定为 `meta.id`。
- `apps/frontend/src/plugins/index.ts`：导出新增的 `PluginLocaleMap` / `pickPluginLocaleText`。
- `apps/frontend/src/router/routes.ts`：`RouteMeta` 新增 `titleI18n`。
- `apps/frontend/src/router/routeMeta.ts`：`metaOf` 升级为导出函数 `resolveRouteMetaLabel`；`resolveRoutePageTitleKeys` 重命名为 `resolveRoutePageLabels`（带 `translate/locale` 参数）；`formatRoutePageLabel` 加 `locale` 形参。
- `apps/frontend/src/layout/index.tsx`：解构 `locale` 并透传给 `formatRoutePageLabel`。
- `apps/frontend/src/components/design/Header/index.tsx`：面包屑 `titleKey` 全量替换为已本地化的 `label`，复用 `resolveRouteMetaLabel`。
- `apps/frontend/src/views/plugins/index.tsx`：`pluginTitle` / `pluginBlurb` 改用 `pickPluginLocaleText`，按 `locale` 取文案。
- `apps/frontend/src/i18n/locales/zh-CN.ts` / `en-US.ts`：删除 3 个 `plugins.desc.*` key。

## 3. 实现思路

1. **新增 locale map 类型与取值器**：`PluginLocaleMap = Partial<Record<HostLocale, string>>`，`pickPluginLocaleText` 按 当前 locale → zh-CN → en-US → 空串 回退，兼容旧版纯字符串 `description`。
2. **descriptor 字段重塑**：`title?: PluginLocaleMap`、`description?: string | PluginLocaleMap`、`menu` 去掉 `nameKey`，从契约上断开 Host i18n 依赖。
3. **路由 meta 通道**：`RouteMeta.titleI18n` 承载 registry 的多语言标题；`createPluginRoute` 把 `meta.title` 直接放进 `titleI18n`，`title` 仍兜底为 `meta.id`。
4. **统一解析入口**：`resolveRouteMetaLabel(meta, locale, translate)` 实现 `titleI18n → titleKey(i18n) → title` 三级优先级，供面包屑、鉴权 Toast 共用。
5. **标题链本地化前移**：`resolveRoutePageLabels` 在解析阶段就用 `locale/translate` 把每段标题解析成最终字符串，`Crumb` 由 `{ titleKey }` 改 `{ label }`，下游不再二次翻译。
6. **侧栏 nameKey 稳定化**：`sidebarInjector.add` 的 `nameKey` 直接用 `meta.id`，仅作稳定 key，不再承担显示职责（侧栏只展示 icon）。
7. **Host i18n 瘦身**：删除 `plugins.desc.remoteDemo/learningNotes/ebookIdeas` 三条 key，文案回归 registry。

## 4. 关键代码与逐行注释

### 4.1 `PluginLocaleMap` 类型 + `pickPluginLocaleText` 函数（纯新增）

**对比范围**：`apps/frontend/src/plugins/core/localeText.ts` 整文件（新增）。

**改动后** · `apps/frontend/src/plugins/core/localeText.ts`（当前，约 L1–L19，新增文件）

```typescript
// 引入 Host 支持的语言联合类型，作为 locale map 的键约束
import type { HostLocale } from './types';

// registry 内嵌多语言文案的类型：每个 HostLocale 可选对应一段字符串
/** registry 内嵌多语言文案（与 Host `locale` 对齐） */
export type PluginLocaleMap = Partial<Record<HostLocale, string>>;

// 取值函数：按 当前 locale → zh-CN → en-US → 空串 的顺序回退，兼容旧版纯字符串
/**
 * 从 registry 的 locale map（或旧版纯字符串）取当前语言文案。
 * 优先当前 locale → zh-CN → en-US → 空串。
 */
export function pickPluginLocaleText(
	// 入参既可能是新版 locale map，也可能是旧版单语字符串，或空值
	value: PluginLocaleMap | string | undefined | null,
	// 当前 Host 顶栏语言，如 'zh-CN' / 'en-US'
	locale: string,
): string {
	// null / undefined 直接返回空串，避免后续取属性报错
	if (value == null) return '';
	// 旧版纯字符串：trim 后原样返回，保持向后兼容
	if (typeof value === 'string') return value.trim();
	// 优先取当前 locale 对应文案并 trim
	const cur = value[locale as HostLocale]?.trim();
	// 命中则返回当前语言文案
	if (cur) return cur;
	// 当前 locale 缺失时回退 zh-CN，再回退 en-US，最后空串
	return value['zh-CN']?.trim() || value['en-US']?.trim() || '';
}
```

**变更摘要**：纯新增文件，定义多语言文案类型与统一取值器，作为后续解耦的基础原语。

### 4.2 `PluginDescriptor` 接口改造

**对比范围**：`PluginDescriptor` 接口（从 `export interface PluginDescriptor {` 到闭合 `}`；中间未改字段用 `// ...` 对称省略）。

**改动前** · `apps/frontend/src/plugins/core/types.ts`（基线，约 L17–L31 起的字段段）

```typescript
// 插件描述符接口声明（旧版：标题/说明均走 Host i18n key）
export interface PluginDescriptor {
	// 插件稳定唯一 id
	id: string;
	// 旧版：指向 Host i18n 字典的标题 key
	titleKey?: string;
	// 旧版：指向 Host i18n 字典的说明 key（插件中心卡片展示）
	/** 插件作用说明的 i18n key（插件中心卡片展示） */
	descriptionKey?: string;
	// 旧版：明文说明，第三方无 Host i18n 时用；有 descriptionKey 时以 key 为准
	/** 明文说明（第三方无 Host i18n 时用；有 descriptionKey 时以 key 为准） */
	description?: string;
	// 插件路由路径
	routePath: string;
	// MF 入口
	entry: string;
	// 插件版本
	version: string;
	// 宿主 API semver 范围
	hostApiRange: string;
	// 旧版：侧栏菜单项，nameKey 指向 Host i18n
	menu?: { order: number; icon?: string; nameKey?: string };
	// ...（未改动：injectRoute / remoteName / expose / permissions / preload / enabled / integrity / signature / trust / iframeUrl）
}
```

**改动后** · `apps/frontend/src/plugins/core/types.ts`（当前，约 L17–L32 起的字段段）

```typescript
// 引入新增的多语言文案类型，供 title/description 使用
// （import 在文件顶部 L2，此处略）
// 插件描述符接口声明（新版：标题/说明自带多语言 map）
export interface PluginDescriptor {
	// 插件稳定唯一 id
	id: string;
	// 新版：多语言标题 map，改文案只动 registry，不动 Host i18n
	/**
	 * 多语言插件名（插件中心 / 注入路由标题）。
	 * 新增或改名只改 registry，不必改 Host i18n。
	 */
	title?: PluginLocaleMap;
	// 新版：多语言说明 map，或旧版单语字符串（联合类型兼容）
	/**
	 * 多语言说明，或旧版单语字符串。
	 */
	description?: string | PluginLocaleMap;
	// 插件路由路径
	routePath: string;
	// MF 入口
	entry: string;
	// 插件版本
	version: string;
	// 宿主 API semver 范围
	hostApiRange: string;
	// 新版：侧栏菜单项去掉 nameKey，仅保留 order/icon
	menu?: { order: number; icon?: string };
	// ...（未改动：injectRoute / remoteName / expose / permissions / preload / enabled / integrity / signature / trust / iframeUrl）
}
```

**变更摘要**：删除 `titleKey` / `descriptionKey` / `menu.nameKey` 三个 Host i18n key 字段；`title` 改为 `PluginLocaleMap`，`description` 扩为 `string | PluginLocaleMap` 联合类型。

### 4.3 `createPluginRoute` 路由 meta 改造

**对比范围**：`createPluginRoute` 全函数（声明到闭合 `}`）。

**改动前** · `apps/frontend/src/plugins/core/PluginManager.ts`（基线，约 L14–L25）

```typescript
// 工厂函数：根据插件 meta 构造一条 RouteConfig（旧版 meta 走 titleKey）
function createPluginRoute(meta: PluginDescriptor): RouteConfig {
	// 用 createElement 包一层 PluginHostPage，绑定 pluginId
	const Page: ComponentType = () =>
		createElement(PluginHostPage, { pluginId: meta.id });
	// 返回路由配置对象
	return {
		// 路由路径取自 descriptor
		path: meta.routePath,
		// 渲染组件
		Component: Page,
		// 路由元信息
		meta: {
			// 旧版：titleKey 优先取 descriptor.titleKey，否则回落 menu.nameKey
			titleKey: meta.titleKey ?? meta.menu?.nameKey,
			// 静态 title 兜底为插件 id
			title: meta.id,
		},
	};
}
```

**改动后** · `apps/frontend/src/plugins/core/PluginManager.ts`（当前，约 L14–L26）

```typescript
// 工厂函数：根据插件 meta 构造一条 RouteConfig（新版 meta 走 titleI18n）
function createPluginRoute(meta: PluginDescriptor): RouteConfig {
	// 用 createElement 包一层 PluginHostPage，绑定 pluginId
	const Page: ComponentType = () =>
		createElement(PluginHostPage, { pluginId: meta.id });
	// 返回路由配置对象
	return {
		// 路由路径取自 descriptor
		path: meta.routePath,
		// 渲染组件
		Component: Page,
		// 路由元信息
		meta: {
			// 新版：titleI18n 直接放 descriptor 的多语言 title map，由面包屑按 locale 解析
			/** 面包屑按当前 Host locale 从 title 解析，不绑 Host i18n key */
			titleI18n: meta.title,
			// 静态 title 兜底为插件 id
			title: meta.id,
		},
	};
}
```

**变更摘要**：`meta.titleKey`（聚合 descriptor 的 Host i18n key）替换为 `meta.titleI18n`（直接承载 descriptor 的多语言 map）。

### 4.4 `sidebarInjector.add` 侧栏注入改造

**对比范围**：`mountShell` 方法内 `sidebarInjector.add({ ... })` 调用块（到 `});` 闭合）。

**改动前** · `apps/frontend/src/plugins/core/PluginManager.ts`（基线，约 L70–L77）

```typescript
		// 向侧栏注入器注册一项（旧版 nameKey 仍指向 Host i18n）
		sidebarInjector.add({
			// 插件 id
			pluginId: meta.id,
			// 侧栏点击跳转路径
			path: meta.routePath,
			// 旧版：nameKey 优先 menu.nameKey，再 titleKey，最后 id
			nameKey: meta.menu.nameKey ?? meta.titleKey ?? meta.id,
			// 图标，缺省 Puzzle
			icon: meta.menu.icon ?? 'Puzzle',
			// 排序权重
			order: meta.menu.order,
		});
```

**改动后** · `apps/frontend/src/plugins/core/PluginManager.ts`（当前，约 L71–L78）

```typescript
		// 向侧栏注入器注册一项（新版 nameKey 仅作稳定 id）
		sidebarInjector.add({
			// 插件 id
			pluginId: meta.id,
			// 侧栏点击跳转路径
			path: meta.routePath,
			// 新版：nameKey 固定为 meta.id，不再指向 Host i18n，仅作稳定 key
			// 侧栏仅用 icon；nameKey 仅作稳定 id，不再指向 Host i18n
			nameKey: meta.id,
			// 图标，缺省 Puzzle
			icon: meta.menu.icon ?? 'Puzzle',
			// 排序权重
			order: meta.menu.order,
		});
```

**变更摘要**：`nameKey` 由「menu.nameKey → titleKey → id」三级回落简化为直接用 `meta.id`，彻底切断侧栏对 Host i18n 的依赖。

### 4.5 `plugins/index.ts` 导出新 API

**对比范围**：插件包对外导出段（`HOST_API_VERSION` 到 `usePluginEnabled` 之间）。

**改动前** · `apps/frontend/src/plugins/index.ts`（基线，约 L33–L34）

```typescript
// 导出 Host API 版本号
export { HOST_API_VERSION } from './core/types';
// 紧接着导出 usePluginEnabled（旧版无 localeText 导出）
export { usePluginEnabled } from './hooks/usePluginEnabled';
```

**改动后** · `apps/frontend/src/plugins/index.ts`（当前，约 L33–L36）

```typescript
// 导出 Host API 版本号
export { HOST_API_VERSION } from './core/types';
// 新增：导出多语言文案类型（type-only）
export type { PluginLocaleMap } from './core/localeText';
// 新增：导出多语言取值函数
export { pickPluginLocaleText } from './core/localeText';
// 紧接着导出 usePluginEnabled
export { usePluginEnabled } from './hooks/usePluginEnabled';
```

**变更摘要**：在插件包入口新增 `PluginLocaleMap`（type）与 `pickPluginLocaleText`（value）两个导出，供 `views/plugins` 等消费方使用。

### 4.6 `RouteMeta` 新增 `titleI18n` 字段

**对比范围**：`RouteMeta` 接口（声明到闭合 `}`）。

**改动前** · `apps/frontend/src/router/routes.ts`（基线，约 L56–L59）

```typescript
// 路由元信息接口（旧版只有静态 title 与 Host i18n titleKey）
export interface RouteMeta {
	// 静态标题（纯字符串）
	title?: string;
	// Host i18n 标题 key，优先于 title 渲染
	/** 多语言标题 key；优先于 title 渲染 */
	titleKey?: string;
}
```

**改动后** · `apps/frontend/src/router/routes.ts`（当前，约 L56–L62）

```typescript
// 路由元信息接口（新版增加 titleI18n 承载插件多语言标题）
export interface RouteMeta {
	// 静态标题（纯字符串）
	title?: string;
	// Host i18n 标题 key，优先于 title 渲染
	/** 多语言标题 key；优先于 title 渲染 */
	titleKey?: string;
	// 新增：插件 registry 内嵌的多语言标题 map，优先级高于 titleKey
	/** 插件 registry 内嵌多语言标题（优先于 titleKey） */
	titleI18n?: Partial<Record<'zh-CN' | 'en-US', string>>;
}
```

**变更摘要**：新增 `titleI18n` 字段，作为插件路由的多语言标题通道，优先级置于 `titleKey` 之上。

### 4.7 `resolveRouteMetaLabel` 新函数 + `resolveRoutePageLabels` 重命名

本节为 `routeMeta.ts` 的大改动，按 4 个子符号分别对比。

#### 4.7a `metaOf` → `resolveRouteMetaLabel`

**对比范围**：路由 meta 文案解析器（旧版为内部 const `metaOf`，新版为导出函数 `resolveRouteMetaLabel`）。

**改动前** · `apps/frontend/src/router/routeMeta.ts`（基线，约 L9–L10）

```typescript
// 旧版：内部箭头函数，只看 titleKey 与静态 title，未涉及 locale
const metaOf = (route: RouteConfig) =>
	// 优先返回 titleKey，否则回落 title
	route.meta?.titleKey || route.meta?.title;
```

**改动后** · `apps/frontend/src/router/routeMeta.ts`（当前，约 L9–L21）

```typescript
// 新版：导出函数，按 titleI18n → titleKey(i18n) → title 三级解析，需 locale 与 translate
/** 解析路由 meta 展示文案：titleI18n → titleKey(i18n) → title */
export function resolveRouteMetaLabel(
	// 路由元信息，可能为空
	meta: RouteMeta | undefined,
	// 当前 Host locale
	locale: string,
	// Host i18n 翻译函数，用于解析 titleKey
	translate: (key: string) => string,
): string | undefined {
	// meta 为空直接返回 undefined
	if (!meta) return undefined;
	// 优先用 pickPluginLocaleText 从 titleI18n map 取当前语言文案
	const fromMap = pickPluginLocaleText(meta.titleI18n, locale);
	// 命中则返回
	if (fromMap) return fromMap;
	// 次选：titleKey 走 Host i18n 翻译
	if (meta.titleKey) return translate(meta.titleKey);
	// 末选：静态 title
	if (meta.title) return meta.title;
	// 都没有则 undefined
	return undefined;
}
```

**变更摘要**：由「内部 const + 仅看 titleKey/title」升级为「导出函数 + 三级优先级 + 显式 locale/translate 参数」，统一了插件与非插件路由的文案解析。

#### 4.7b `dedupeAdjacentTitleKeys` → `dedupeAdjacent`

**对比范围**：相邻标题去重工具函数（声明到闭合 `}`）。

**改动前** · `apps/frontend/src/router/routeMeta.ts`（基线，约 L22–L29）

```typescript
// 旧版：针对 titleKey 数组做相邻去重
const dedupeAdjacentTitleKeys = (keys: string[]) => {
	// 输出数组
	const out: string[] = [];
	// 遍历每个 key
	for (const key of keys) {
		// 与末尾相同则跳过
		if (out.length > 0 && out[out.length - 1] === key) continue;
		// 否则推入
		out.push(key);
	}
	// 返回去重后的数组
	return out;
};
```

**改动后** · `apps/frontend/src/router/routeMeta.ts`（当前，约 L34–L41）

```typescript
// 新版：泛化为对已本地化 label 数组做相邻去重
const dedupeAdjacent = (labels: string[]) => {
	// 输出数组
	const out: string[] = [];
	// 遍历每个 label
	for (const label of labels) {
		// 与末尾相同则跳过
		if (out.length > 0 && out[out.length - 1] === label) continue;
		// 否则推入
		out.push(label);
	}
	// 返回去重后的数组
	return out;
};
```

**变更摘要**：函数名去掉 `TitleKeys` 后缀，参数语义由「i18n key」改为「已本地化 label」，与上游 `Crumb.label` 对齐。

#### 4.7c `resolveRoutePageTitleKeys` → `resolveRoutePageLabels`

**对比范围**：路由标题链解析主函数（声明到闭合 `}`；中间 `findRouteTitle` 递归体用 `// ...` 对称省略）。

**改动前** · `apps/frontend/src/router/routeMeta.ts`（基线，约 L31–L95）

```typescript
// 旧版：解析 titleKey 链，返回的是待翻译的 key 数组
/** 从嵌套路由树解析当前 pathname 的 meta 标题链（titleKey 或静态 title） */
export function resolveRoutePageTitleKeys(pathname: string): string[] {
	// 面包屑单项类型，携带 titleKey
	type Crumb = { titleKey: string; path: string };

	// 在嵌套路由树中回溯收集面包屑
	const findBreadcrumbTrail = (
		routeList: RouteConfig[],
		currentPath: string,
		parentBase: string,
		prefix: Crumb[],
	): Crumb[] | null => {
		for (const route of routeList) {
			// 拼绝对路径
			const absolute = resolveAbsolute(route, parentBase);
			// 旧版：用内部 metaOf 取 titleKey
			const titleK = metaOf(route);
			// 组装父级面包屑项
			const parentCrumb =
				titleK && absolute ? { titleKey: titleK, path: absolute } : null;

			if (route.children?.length) {
				// 递归子路由
				const nextBase = absolute ?? parentBase;
				const extendedPrefix = parentCrumb ? [...prefix, parentCrumb] : prefix;
				const hit = findBreadcrumbTrail(
					route.children,
					currentPath,
					nextBase,
					extendedPrefix,
				);
				if (hit) return hit;
			}

			// 当前节点精确匹配则收尾
			if (absolute && titleK && pathMatches(absolute, currentPath)) {
				return [...prefix, { titleKey: titleK, path: absolute }];
			}
		}
		return null;
	};

	// ...（未改动：findRouteTitle 递归，内部用 metaOf 取标题）

	// 构建路由树
	const routes = buildRoutes();
	// 取原始面包屑链
	const rawTrail = findBreadcrumbTrail(routes, pathname, '', []) ?? [];
	// 旧版：对 titleKey 数组去重
	const trail = dedupeAdjacentTitleKeys(rawTrail.map((item) => item.titleKey));
	if (trail.length > 0) return trail;

	// 面包屑为空时回落单标题
	const single = findRouteTitle(routes, pathname, '');
	return single ? [single] : [];
}
```

**改动后** · `apps/frontend/src/router/routeMeta.ts`（当前，约 L43–L112）

```typescript
// 新版：解析已本地化 label 链，需 translate/locale 在解析阶段就翻译
/** 从嵌套路由树解析当前 pathname 的已本地化标题链 */
export function resolveRoutePageLabels(
	pathname: string,
	// Host i18n 翻译函数
	translate: (key: string) => string,
	// 当前 Host locale
	locale: string,
): string[] {
	// 面包屑单项类型，携带已本地化 label
	type Crumb = { label: string; path: string };

	// 新版：每个路由的 label 统一走 resolveRouteMetaLabel
	const labelOf = (route: RouteConfig) =>
		resolveRouteMetaLabel(route.meta, locale, translate);

	// 在嵌套路由树中回溯收集面包屑
	const findBreadcrumbTrail = (
		routeList: RouteConfig[],
		currentPath: string,
		parentBase: string,
		prefix: Crumb[],
	): Crumb[] | null => {
		for (const route of routeList) {
			// 拼绝对路径
			const absolute = resolveAbsolute(route, parentBase);
			// 新版：用 labelOf 取已本地化 label
			const label = labelOf(route);
			// 组装父级面包屑项
			const parentCrumb =
				label && absolute ? { label, path: absolute } : null;

			if (route.children?.length) {
				// 递归子路由
				const nextBase = absolute ?? parentBase;
				const extendedPrefix = parentCrumb ? [...prefix, parentCrumb] : prefix;
				const hit = findBreadcrumbTrail(
					route.children,
					currentPath,
					nextBase,
					extendedPrefix,
				);
				if (hit) return hit;
			}

			// 当前节点精确匹配则收尾
			if (absolute && label && pathMatches(absolute, currentPath)) {
				return [...prefix, { label, path: absolute }];
			}
		}
		return null;
	};

	// ...（未改动：findRouteTitle 递归，内部 metaOf 改为 labelOf）

	// 构建路由树
	const routes = buildRoutes();
	// 取原始面包屑链
	const rawTrail = findBreadcrumbTrail(routes, pathname, '', []) ?? [];
	// 新版：对 label 数组去重
	const trail = dedupeAdjacent(rawTrail.map((item) => item.label));
	if (trail.length > 0) return trail;

	// 面包屑为空时回落单标题
	const single = findRouteTitle(routes, pathname, '');
	return single ? [single] : [];
}
```

**变更摘要**：函数更名为 `resolveRoutePageLabels`，新增 `translate/locale` 形参；`Crumb` 由 `{ titleKey }` 改 `{ label }`，解析阶段即完成本地化，返回值由「待翻译 key 链」变为「可直接展示的 label 链」。

> 旧版 `resolveRoutePageTitleKeys` 保留为 `@deprecated` 兼容包装（内部以 `(k) => k` 恒等翻译 + `'zh-CN'` 调用新版），供尚未迁移的调用方过渡使用：

**改动后** · `apps/frontend/src/router/routeMeta.ts`（当前，约 L114–L117，纯新增兼容包装）

```typescript
// 兼容旧调用方：标记废弃，转发到新版实现
/** @deprecated 使用 resolveRoutePageLabels */
export function resolveRoutePageTitleKeys(pathname: string): string[] {
	// 恒等翻译 + 默认 zh-CN，行为等价旧版
	return resolveRoutePageLabels(pathname, (k) => k, 'zh-CN');
}
```

#### 4.7d `formatRoutePageLabel` 新增 `locale` 参数

**对比范围**：`formatRoutePageLabel` 全函数（声明到闭合 `}`）。

**改动前** · `apps/frontend/src/router/routeMeta.ts`（基线，约 L88–L95）

```typescript
// 旧版：把 titleKey 链格式化为可读页面名（鉴权拦截 Toast 用）
/** 鉴权拦截 Toast：将 titleKey 链格式化为可读页面名 */
export function formatRoutePageLabel(
	// 当前路径
	pathname: string,
	// Host i18n 翻译函数
	translate: (key: string) => string,
): string {
	// 旧版：取 titleKey 链
	const keys = resolveRoutePageTitleKeys(pathname);
	// 空链回落未知页文案
	if (keys.length === 0) return translate('route.guard.unknownPage');
	// 旧版：每段 key 翻译后用 › 连接
	return keys.map((key) => translate(key)).join(' › ');
}
```

**改动后** · `apps/frontend/src/router/routeMeta.ts`（当前，约 L119–L128）

```typescript
// 新版：把已本地化 label 链格式化为可读页面名，新增 locale 形参
/** 鉴权拦截 Toast：将标题链格式化为可读页面名 */
export function formatRoutePageLabel(
	// 当前路径
	pathname: string,
	// Host i18n 翻译函数
	translate: (key: string) => string,
	// 新增：当前 locale，默认 zh-CN
	locale = 'zh-CN',
): string {
	// 新版：取已本地化 label 链
	const labels = resolveRoutePageLabels(pathname, translate, locale);
	// 空链回落未知页文案
	if (labels.length === 0) return translate('route.guard.unknownPage');
	// 新版：label 已是最终文案，直接 join
	return labels.join(' › ');
}
```

**变更摘要**：新增可选 `locale` 形参（默认 `zh-CN`）；内部改用 `resolveRoutePageLabels` 返回的 label 链，去掉末尾 `.map(translate)` 二次翻译。

### 4.8 `Layout` 传 `locale` 给 `formatRoutePageLabel`

**对比范围**：`Layout` 组件中 `useI18n` 解构与鉴权 Toast 内 `formatRoutePageLabel` 调用（中间未改逻辑用 `// ...` 对称省略）。

**改动前** · `apps/frontend/src/layout/index.tsx`（基线，约 L24 与 L43）

```typescript
// 旧版：只解构 t，未取 locale
const { t } = useI18n();
// ...（未改动：authRedirectToastShownRef / useTheme / needAuth / authed 等）
			// 旧版：formatRoutePageLabel 不传 locale
			message: t('route.guard.needLoginMessage', {
				page: formatRoutePageLabel(location.pathname, t),
			}),
```

**改动后** · `apps/frontend/src/layout/index.tsx`（当前，约 L24 与 L44）

```typescript
// 新版：额外解构 locale，供 formatRoutePageLabel 使用
const { t, locale } = useI18n();
// ...（未改动：authRedirectToastShownRef / useTheme / needAuth / authed 等）
			// 新版：透传 locale，让标题链按当前语言解析
			message: t('route.guard.needLoginMessage', {
				page: formatRoutePageLabel(location.pathname, t, locale),
			}),
```

**变更摘要**：`useI18n` 多解构 `locale`，并在鉴权 Toast 调用 `formatRoutePageLabel` 时透传，使拦截提示按当前语言展示页面名。

### 4.9 `Header` 面包屑 `titleKey` → `label` 改造

本节为 `Header/index.tsx` 的大改动，按 3 个子符号分别对比。

#### 4.9a `HeaderBreadcrumbCrumb` 类型

**对比范围**：面包屑单项类型定义。

**改动前** · `apps/frontend/src/components/design/Header/index.tsx`（基线，约 L15–L16）

```typescript
// 旧版：面包屑单项携带 titleKey，渲染时再 t() 翻译
/** 顶栏面包屑单项：titleKey 走 i18n，path 为可导航的绝对 pathname */
type HeaderBreadcrumbCrumb = { titleKey: string; path: string };
```

**改动后** · `apps/frontend/src/components/design/Header/index.tsx`（当前，约 L16–L17）

```typescript
// 新版：面包屑单项携带已本地化 label，渲染直接展示
/** 顶栏面包屑单项：label 已按 locale 解析，path 可导航 */
type HeaderBreadcrumbCrumb = { label: string; path: string };
```

**变更摘要**：字段 `titleKey` 改为 `label`，语义由「待翻译 key」变为「已本地化文案」。

#### 4.9b 面包屑 `useMemo` 块

**对比范围**：`Header` 组件内 `useMemo`（声明到 `}, [deps]);` 闭合；中间 `resolveAbsolute` / `findRouteTitle` 等未改体用 `// ...` 对称省略，聚焦 `metaOf→labelOf`、`dedupeAdjacentTitleKeys→dedupeAdjacent`、`titleKey→label`、`headerTitleKey→headerTitle`、deps 增项）。

**改动前** · `apps/frontend/src/components/design/Header/index.tsx`（基线，约 L27–L88 起）

```typescript
	// 旧版：useMemo 解构 headerTitleKey
	const { breadcrumbTrail, headerTitleKey } = useMemo(() => {
		// 构建路由树
		const routes = buildRoutes();
		// 旧版：内部 metaOf 只看 titleKey/title
		const metaOf = (r: RouteConfig) => r.meta?.titleKey || r.meta?.title;

		// ...（未改动：resolveAbsolute 实现）
		// ...（未改动：findRouteTitle 实现，内部 const m = metaOf(route)）

		// 旧版：相邻去重按 titleKey 字段
		/** 相邻两级 meta 标题相同（如 layout 与 index 同 titleKey）时只保留一项 */
		const dedupeAdjacentTitleKeys = (items: HeaderBreadcrumbCrumb[]) => {
			const out: HeaderBreadcrumbCrumb[] = [];
			for (const it of items) {
				// 旧版：比较 titleKey
				if (out.length > 0 && out[out.length - 1].titleKey === it.titleKey) {
					continue;
				}
				out.push(it);
			}
			return out;
		};

		// ...（未改动：findBreadcrumbTrail 签名）
			for (const route of routeList) {
				const absolute = resolveAbsolute(route, parentBase);
				// 旧版：取 titleKey
				const titleK = metaOf(route);
				const parentCrumb =
					// 旧版：titleK 命中时存 titleKey
					titleK && absolute
						? ({
								titleKey: titleK,
								path: absolute,
						} satisfies HeaderBreadcrumbCrumb)
						: null;
				// ...（未改动：子路由递归段）
				// 旧版：匹配时存 titleKey
				if (absolute && titleK && pathMatches(absolute, pathname)) {
					return [
						...prefix,
						{
							titleKey: titleK,
							path: absolute,
						} satisfies HeaderBreadcrumbCrumb,
					];
				}
			}
			return null;
		};

		const rawTrail =
			findBreadcrumbTrail(routes, location.pathname, '', []) ?? [];
		// 旧版：调 dedupeAdjacentTitleKeys
		const trail = dedupeAdjacentTitleKeys(rawTrail);

		if (trail.length >= 2) {
			// 旧版：返回 headerTitleKey: undefined
			return { breadcrumbTrail: trail, headerTitleKey: undefined };
		}
		if (trail.length === 1) {
			return {
				breadcrumbTrail: null,
				// 旧版：单条时 headerTitleKey 取 titleKey
				headerTitleKey: trail[0].titleKey,
			};
		}

		// 无匹配时回落单标题
		const single = findRouteTitle(routes, location.pathname, '');
		// 旧版：返回 headerTitleKey: single
		return { breadcrumbTrail: null, headerTitleKey: single };
	// 旧版：deps 只有 location.pathname 与 routeEpoch
	}, [location.pathname, routeEpoch]);
```

**改动后** · `apps/frontend/src/components/design/Header/index.tsx`（当前，约 L63–L186）

```typescript
	// 新版：useMemo 解构 headerTitle；额外从 useI18n 取 locale/t（见组件顶部）
	const { breadcrumbTrail, headerTitle } = useMemo(() => {
		// 构建路由树
		const routes = buildRoutes();
		// 新版：labelOf 复用 resolveRouteMetaLabel，传入 locale 与 t
		const labelOf = (r: RouteConfig) =>
			resolveRouteMetaLabel(r.meta, locale, t);

		// ...（未改动：resolveAbsolute 实现）
		// ...（未改动：findRouteTitle 实现，内部 const m = labelOf(route)）

		// 新版：相邻去重按 label 字段
		/** 相邻两级 meta 标题相同（如 layout 与 index）时只保留一项 */
		const dedupeAdjacent = (items: HeaderBreadcrumbCrumb[]) => {
			const out: HeaderBreadcrumbCrumb[] = [];
			for (const it of items) {
				// 新版：比较 label
				if (out.length > 0 && out[out.length - 1].label === it.label) {
					continue;
				}
				out.push(it);
			}
			return out;
		};

		// ...（未改动：findBreadcrumbTrail 签名）
			for (const route of routeList) {
				const absolute = resolveAbsolute(route, parentBase);
				// 新版：取已本地化 label
				const label = labelOf(route);
				const parentCrumb =
					// 新版：label 命中时直接存 label
					label && absolute
						? ({
								label,
								path: absolute,
						} satisfies HeaderBreadcrumbCrumb)
						: null;
				// ...（未改动：子路由递归段）
				// 新版：匹配时存 label
				if (absolute && label && pathMatches(absolute, pathname)) {
					return [
						...prefix,
						{
							label,
							path: absolute,
						} satisfies HeaderBreadcrumbCrumb,
					];
				}
			}
			return null;
		};

		const rawTrail =
			findBreadcrumbTrail(routes, location.pathname, '', []) ?? [];
		// 新版：调 dedupeAdjacent
		const trail = dedupeAdjacent(rawTrail);

		if (trail.length >= 2) {
			// 新版：返回 headerTitle: undefined
			return { breadcrumbTrail: trail, headerTitle: undefined };
		}
		if (trail.length === 1) {
			return {
				breadcrumbTrail: null,
				// 新版：单条时 headerTitle 取 label
				headerTitle: trail[0].label,
			};
		}

		// 无匹配时回落单标题
		const single = findRouteTitle(routes, location.pathname, '');
		// 新版：返回 headerTitle: single
		return { breadcrumbTrail: null, headerTitle: single };
	// 新版：deps 增加 locale、t，语言切换时重算面包屑
	}, [location.pathname, routeEpoch, locale, t]);
```

**变更摘要**：`metaOf` 改为复用导出的 `resolveRouteMetaLabel`（带 locale/t）；`dedupeAdjacentTitleKeys` 更名 `dedupeAdjacent` 并按 `label` 去重；`Crumb.titleKey` 全量替换为 `label`；返回值 `headerTitleKey` 改 `headerTitle`；`useMemo` deps 增加 `locale`、`t`。

#### 4.9c 面包屑 JSX 渲染

**对比范围**：面包屑 `nav` 内 `breadcrumbTrail.map` 渲染段与单标题回落段。

**改动前** · `apps/frontend/src/components/design/Header/index.tsx`（基线，约 L210–L227）

```typescript
							{breadcrumbTrail.map((c, i) => (
								<span
									// 旧版：key 含 titleKey
									key={`${c.path}:${c.titleKey}:${i}`}
									className="flex min-w-0 items-center gap-0.5"
								>
									{/* 分隔箭头 */}
									{i > 0 ? <ChevronRight ... /> : null}
									{i < breadcrumbTrail.length - 1 ? (
										<button ...>
											{/* 旧版：渲染时 t() 翻译 titleKey */}
											{t(c.titleKey)}
										</button>
									) : (
										<span ...>
											{/* 旧版：末项同样 t() 翻译 */}
											{t(c.titleKey)}
										</span>
									)}
								</span>
							))}
						</nav>
					) : headerTitleKey ? (
						{/* 旧版：headerTitleKey 走 t() */}
						<div className="cursor-default truncate">{t(headerTitleKey)}</div>
					) : null}
```

**改动后** · `apps/frontend/src/components/design/Header/index.tsx`（当前，约 L211–L240）

```typescript
							{breadcrumbTrail.map((c, i) => (
								<span
									// 新版：key 含 label
									key={`${c.path}:${c.label}:${i}`}
									className="flex min-w-0 items-center gap-0.5"
								>
									{/* 分隔箭头 */}
									{i > 0 ? <ChevronRight ... /> : null}
									{i < breadcrumbTrail.length - 1 ? (
										<button ...>
											{/* 新版：label 已本地化，直接展示 */}
											{c.label}
										</button>
									) : (
										<span ...>
											{/* 新版：末项直接展示 label */}
											{c.label}
										</span>
									)}
								</span>
							))}
						</nav>
					) : headerTitle ? (
						{/* 新版：headerTitle 已本地化，直接展示 */}
						<div className="cursor-default truncate">{headerTitle}</div>
					) : null}
```

**变更摘要**：渲染层去掉所有 `t(...)` 包裹，`titleKey` / `headerTitleKey` 全部改为直接展示 `label` / `headerTitle`；React `key` 同步用 `c.label`。

### 4.10 `pluginTitle` / `pluginBlurb` 改用 `pickPluginLocaleText`

**对比范围**：`pluginTitle` / `pluginBlurb` 两个函数（各自声明到闭合 `}`），以及插件卡片 JSX 中的两处调用点。

**改动前** · `apps/frontend/src/views/plugins/index.tsx`（基线，约 L18–L33）

```typescript
// 旧版：pluginTitle 接收 t，优先查 titleKey/menu.nameKey
function pluginTitle(p: PluginDescriptor, t: (k: string) => string) {
	// 旧版：key 取 titleKey 或 menu.nameKey
	const key = p.titleKey ?? p.menu?.nameKey;
	if (key) {
		// 旧版：翻译 key
		const label = t(key);
		// 翻译命中且不等于 key 本身则返回
		if (label && label !== key) return label;
	}
	// 否则回落 id
	return p.id;
}

// 旧版：pluginBlurb 接收 t，优先 descriptionKey 再 description
function pluginBlurb(p: PluginDescriptor, t: (k: string) => string) {
	// 旧版：有 descriptionKey 时优先走 i18n，避免 registry 残留中文 description 锁死文案
	if (p.descriptionKey) {
		const label = t(p.descriptionKey);
		if (label && label !== p.descriptionKey) return label;
	}
	// 旧版：再回落明文 description
	if (p.description?.trim()) return p.description.trim();
	// 最终回落占位文案
	return t('plugins.card.noDesc');
}
```

**改动后** · `apps/frontend/src/views/plugins/index.tsx`（当前，约 L22–L36）

```typescript
// 新版：pluginTitle 接收 locale，只认 registry.title
/** 标题只认 registry.title[locale]，缺省回退 id */
function pluginTitle(p: PluginDescriptor, locale: string) {
	// 新版：pickPluginLocaleText 取当前语言标题，命中则返回，否则 id
	return pickPluginLocaleText(p.title, locale) || p.id;
}

// 新版：pluginBlurb 接收 locale 与 t，只认 registry.description
/** 描述只认 registry.description，缺省占位文案 */
function pluginBlurb(
	p: PluginDescriptor,
	// 当前 locale
	locale: string,
	// Host i18n 翻译函数（仅用于占位文案）
	t: (k: string) => string,
) {
	return (
		// 新版：pickPluginLocaleText 兼容 string | PluginLocaleMap
		pickPluginLocaleText(p.description, locale) || t('plugins.card.noDesc')
	);
}
```

**调用点对比**

**改动前** · `apps/frontend/src/views/plugins/index.tsx`（基线，约 L113 与 L130）

```typescript
							{/* 旧版：传 t */}
							<CardTitle className="min-w-0 flex-1 text-base">
								{pluginTitle(p, t)}
							</CardTitle>
// ...（未改动：上下架 Switch 等）
						<CardDescription className="text-textcolor/70 line-clamp-3 text-sm leading-relaxed text-justify">
							{/* 旧版：传 t */}
							{pluginBlurb(p, t)}
						</CardDescription>
```

**改动后** · `apps/frontend/src/views/plugins/index.tsx`（当前，约 L111 与 L128）

```typescript
							{/* 新版：传 locale */}
							<CardTitle className="min-w-0 flex-1 text-base">
								{pluginTitle(p, locale)}
							</CardTitle>
// ...（未改动：上下架 Switch 等）
						<CardDescription className="text-textcolor/70 line-clamp-3 text-sm leading-relaxed text-justify">
							{/* 新版：传 locale 与 t */}
							{pluginBlurb(p, locale, t)}
						</CardDescription>
```

**变更摘要**：`pluginTitle` 形参由 `t` 改 `locale`，`pluginBlurb` 形参增 `locale`；两者内部改用 `pickPluginLocaleText` 直接消费 registry 多语言字段，不再查 Host i18n key。页面组件 `useI18n` 同步多解构 `locale`。

### 4.11 Host i18n 移除 3 个 `plugins.desc.*` key

**对比范围**：`plugins.host.loadFailed` 之后、`plugins.registry.noChanges` 之前的 `plugins.desc.*` 连续键段。

#### zh-CN

**改动前** · `apps/frontend/src/i18n/locales/zh-CN.ts`（基线，约 L1703–L1708）

```typescript
	// 旧版：remoteDemo 插件描述（中文）
	'plugins.desc.remoteDemo':
		'Module Federation 接入演示：验证 Host 动态加载、侧栏入口与共享 React。',
	// 旧版：learningNotes 插件描述（中文）
	'plugins.desc.learningNotes':
		'在英语学习中记录单词、语法与口语收获，支持本地添加笔记。',
	// 旧版：ebookIdeas 插件描述（中文）
	'plugins.desc.ebookIdeas':
		'在 EPUB 阅读页浏览本书全部想法，点击可跳转到对应划线位置。',
```

**改动后** · `apps/frontend/src/i18n/locales/zh-CN.ts`（当前，3 个 key 已删除）

```typescript
	// 新版：plugins.desc.* 三键整体删除，文案回归 registry 自带多语言字段
	// （此段已无 plugins.desc.* 条目，紧邻上下文为 plugins.host.loadFailed 与 plugins.registry.noChanges）
```

#### en-US

**改动前** · `apps/frontend/src/i18n/locales/en-US.ts`（基线，约 L1854–L1859）

```typescript
	// 旧版：remoteDemo 插件描述（英文）
	'plugins.desc.remoteDemo':
		'Module Federation demo: verifies host dynamic load, sidebar entry, and shared React.',
	// 旧版：learningNotes 插件描述（英文）
	'plugins.desc.learningNotes':
		'Capture vocabulary, grammar, and speaking notes in English Learning.',
	// 旧版：ebookIdeas 插件描述（英文）
	'plugins.desc.ebookIdeas':
		'Browse all ideas for the current EPUB and jump to the matching highlight.',
```

**改动后** · `apps/frontend/src/i18n/locales/en-US.ts`（当前，3 个 key 已删除）

```typescript
	// 新版：plugins.desc.* 三键整体删除，文案回归 registry 自带多语言字段
	// （此段已无 plugins.desc.* 条目，紧邻上下文为 plugins.host.loadFailed 与 plugins.registry.noChanges）
```

**变更摘要**：中英两份语言包各删除 `plugins.desc.remoteDemo` / `plugins.desc.learningNotes` / `plugins.desc.ebookIdeas` 三条 key，对应文案改由各插件 registry 的 `description` 多语言 map 提供。

## 5. 兼容性与影响

- **对插件 registry 作者：破坏性变更（breaking change）**。
  - 旧字段 `titleKey` / `descriptionKey` / `menu.nameKey` 已从 `PluginDescriptor` 移除，不再被读取。
  - registry 必须改用 `title: { 'zh-CN': ..., 'en-US': ... }` 提供标题，`description` 可用同形态 map 或旧版单语字符串。
  - **旧 registry 若未提供 `title` / `description`，将回落到插件 `id`（标题）与 `plugins.card.noDesc` 占位（描述）**，不再有 Host i18n 兜底。
- **对路由面包屑 / 鉴权 Toast**：非插件路由仍走 `titleKey`（Host i18n），行为不变；插件路由走 `titleI18n`，按当前 locale 解析，切换语言即时生效。
- **对侧栏**：`nameKey` 不再承担显示，仅作稳定 key，视觉无变化（侧栏本就只显 icon）。
- **过渡兼容**：`resolveRoutePageTitleKeys` 保留为 `@deprecated` 包装，旧调用方仍可编译运行，但应尽快迁移到 `resolveRoutePageLabels`。
- **回归建议**：
  - 插件中心卡片：中英切换下标题 / 描述正确切换；
  - 插件页面包屑：进入插件页时显示 registry 标题，语言切换后刷新；
  - 鉴权拦截：未登录访问受保护插件路由时，Toast 中页面名为当前语言；
  - 旧 registry（仅含 `titleKey`）：标题回落为 id，不报错。

## 6. 相关源码路径

| 说明 | 路径 |
| ---- | ---- |
| 多语言取值原语（新增） | `apps/frontend/src/plugins/core/localeText.ts` |
| 插件描述符契约 | `apps/frontend/src/plugins/core/types.ts` |
| 插件路由 / 侧栏注入 | `apps/frontend/src/plugins/core/PluginManager.ts` |
| 插件包对外导出 | `apps/frontend/src/plugins/index.ts` |
| 路由元信息类型 | `apps/frontend/src/router/routes.ts` |
| 路由标题链解析 | `apps/frontend/src/router/routeMeta.ts` |
| 布局 / 鉴权 Toast | `apps/frontend/src/layout/index.tsx` |
| 顶栏面包屑 | `apps/frontend/src/components/design/Header/index.tsx` |
| 插件中心页 | `apps/frontend/src/views/plugins/index.tsx` |
| Host 中文语言包 | `apps/frontend/src/i18n/locales/zh-CN.ts` |
| Host 英文语言包 | `apps/frontend/src/i18n/locales/en-US.ts` |

---

若与仓库最新源码不一致，以源码为准。
