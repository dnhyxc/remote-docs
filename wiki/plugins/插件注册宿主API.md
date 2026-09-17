# 插件 Registry：hostApi 校验与字段说明

> **文档角色（本轮主文档）**：保存 registry 时校验 `hostApiRange`、可配置 `HOST_API_VERSION`、编辑页字段说明与快捷保存。  
> **延伸阅读**：[插件书架切换.md](./插件书架切换.md)；[插件注册国际化.md](./插件注册国际化.md)；[插件入口缓存失效.md](../plugins/插件入口缓存失效.md)。

## 1. 背景与目标

运维常把插件 **`version`** 的 bump 误写进 **`hostApiRange`**（如改成 `^1.0.1`），而 Host 契约仍是 `1.0.0`，导致 `hostApi 1.0.0 not in ^1.0.1`。

目标：

1. `HOST_API_VERSION` 可读 `VITE_HOST_API_VERSION`（默认 `1.0.0`）。
2. `savePluginRegistry` 前 `assertRegistryHostApiCompatible`。
3. 注册表页：字段说明下拉、未保存橙点、⌘/Ctrl+S 保存；保存后强制同步编辑器。

## 2. 改动范围

| 路径 | 说明 |
|------|------|
| `apps/frontend/src/plugins/core/types.ts` | `HOST_API_VERSION` |
| `apps/frontend/src/plugins/core/registry.ts` | `assertRegistryHostApiCompatible` |
| `apps/frontend/src/views/plugins/RegistryFieldsHelp.tsx` | **新增**字段说明 |
| `apps/frontend/src/views/plugins/registry.tsx` | 快捷键 / dirty / 保存后同步 |
| `apps/frontend/src/i18n/locales/zh-CN.ts` 等 | 校验与 help 文案 |

## 3. 实现思路

- **version**：插件资源版本，可随意 bump。
- **hostApiRange**：必须覆盖 Host 当前 `HOST_API_VERSION`（semver range）。
- UI：左侧信息图标打开说明；内容变更显示橙点；保存成功后 `docEpoch++` 并 force 拉原文。

## 4. 关键代码对比与注释

### 4.1 `HOST_API_VERSION`

**改动前** · `apps/frontend/src/plugins/core/types.ts`（基线）

```typescript
/** Host 插件契约 semver；破坏性变更才升 major */
export const HOST_API_VERSION = '1.0.0';
```

**改动后** · `apps/frontend/src/plugins/core/types.ts`（当前，约 L4–L9）

```typescript
/**
 * Host 插件契约 semver；破坏性变更才升 major。
 * 优先读 `VITE_HOST_API_VERSION`，缺省 `1.0.0`。
 */
export const HOST_API_VERSION =
	// 构建时注入的环境变量；trim 后空则回退
	import.meta.env.VITE_HOST_API_VERSION?.trim() || '1.0.0';
```

**变更摘要**：契约版本可经环境变量对齐多环境 Host。

### 4.2 `assertRegistryHostApiCompatible`

**对比范围**：纯新增；`savePluginRegistry` 入口调用。

**改动后** · `apps/frontend/src/plugins/core/registry.ts`（当前，约 L136–L171）

```typescript
/** 保存前校验：hostApiRange 必须覆盖当前 Host API，避免误把 version 语义写进 hostApiRange */
export function assertRegistryHostApiCompatible(data: PluginRegistry): void {
	// 遍历每一个插件描述符
	for (const p of data.plugins) {
		// 取去空白后的 range
		const range = p.hostApiRange?.trim();
		// 缺字段 → 国际化错误
		if (!range) {
			throw new Error(
				translateSync('plugins.registry.missingHostApiRange', { id: p.id }),
			);
		}
		// Host 版本不在 range 内 → 国际化错误（含 range 与 hostApi）
		if (!satisfiesRange(HOST_API_VERSION, range)) {
			throw new Error(
				translateSync('plugins.registry.hostApiIncompatible', {
					id: p.id,
					range,
					hostApi: HOST_API_VERSION,
				}),
			);
		}
	}
}

/** 将整份 registry 写回服务端 remotes，并刷新本地缓存 */
export async function savePluginRegistry(
	data: PluginRegistry,
): Promise<PluginRegistry> {
	// 先校验再写盘
	assertRegistryHostApiCompatible(data);
	// 写入新的 updatedAt 并 PUT
	const next: PluginRegistry = {
		...data,
		updatedAt: formatRegistryUpdatedAt(),
		plugins: data.plugins,
	};
	// ... putUploadRemoteJson + writeCache
	return next;
}
```

**变更摘要**：不兼容的 hostApiRange 无法保存到服务器。

### 4.3 `RegistryFieldsHelp`（摘录）

**改动后** · `apps/frontend/src/views/plugins/RegistryFieldsHelp.tsx`（纯新增，约 L19–L36）

```typescript
// 下拉中分区展示的字段表
const SECTIONS: FieldSection[] = [
	{
		// 根级：updatedAt / plugins
		titleKey: 'plugins.registry.help.sectionRoot',
		rows: [
			{ field: 'updatedAt', descKey: 'plugins.registry.help.updatedAt' },
			{ field: 'plugins', descKey: 'plugins.registry.help.plugins' },
		],
	},
	{
		// 基础字段含 version 与 hostApiRange 对照说明
		titleKey: 'plugins.registry.help.sectionBasic',
		rows: [
			{ field: 'id', descKey: 'plugins.registry.help.id' },
			{ field: 'title', descKey: 'plugins.registry.help.fieldTitle' },
			{ field: 'description', descKey: 'plugins.registry.help.description' },
			{ field: 'routePath', descKey: 'plugins.registry.help.routePath' },
			{ field: 'entry', descKey: 'plugins.registry.help.entry' },
			{ field: 'version', descKey: 'plugins.registry.help.version' },
			{ field: 'hostApiRange', descKey: 'plugins.registry.help.hostApiRange' },
			{ field: 'enabled', descKey: 'plugins.registry.help.enabled' },
			{ field: 'trust', descKey: 'plugins.registry.help.trust' },
		],
	},
];
```

**变更摘要**：编辑页可查字段含义，降低误改 `hostApiRange`。

## 5. 兼容性与影响

- 已有不合法 registry 在下次「保存」时会被拦住；加载旧缓存不受影响。
- 破坏性 Host API 变更时升 `VITE_HOST_API_VERSION`，并同步各插件 `hostApiRange`。

## 6. 相关源码路径

| 说明 | 路径 |
|------|------|
| 契约版本 | `apps/frontend/src/plugins/core/types.ts` |
| 保存校验 | `apps/frontend/src/plugins/core/registry.ts` |
| 字段说明 UI | `apps/frontend/src/views/plugins/RegistryFieldsHelp.tsx` |
| 编辑页 | `apps/frontend/src/views/plugins/registry.tsx` |

---

（若与仓库最新源码不一致，以源码为准）
