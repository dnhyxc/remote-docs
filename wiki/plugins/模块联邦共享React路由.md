# Host 勿 shared react-router（避免双 Router）

> **文档角色（本轮主文档）**：线上 `/plugins` 报 `useLocation() may be used only in the context of a <Router>` 的根因与修复。  
> **延伸阅读**：[模块联邦插件宿主.md](../plugins/模块联邦插件宿主.md)（Host 总览；§3.3 已与本文对齐）。

## 1. 背景与目标

Host 把 `react-router` 放进 Module Federation `shared` 后，生产 `loadShare` 易与 `react-router` / `react-router/dom` 拆成双实例：页面里已有 `RouterProvider`，插件或插件页里的 `useLocation` 却打到另一份 context → 白屏。

目标：Host `shared` **只保留** `react` / `react-dom`；`react-router` 用 `resolve.dedupe` 收敛，不进 MF shared。Remote 也未共享 router。

## 2. 改动范围

| 路径 | 说明 |
|------|------|
| `apps/frontend/vite.config.ts` | federation `shared` 去掉 `react-router` |
| `apps/frontend/src/router/index.tsx` | `RouterProvider` 统一从 `react-router` 导入（与 hooks 同源） |

## 3. 实现思路

1. **不要**把 `react-router` 配进 federation `shared`（与「optimizeDeps 不要 exclude react-router」是两件事）。
2. 继续 `dedupe: ['react', 'react-dom', 'react-router']`，保证打包侧单实例。
3. Host 内所有 Router API 从同一包导入。

## 4. 关键代码对比与注释

### 4.1 federation `shared`

**改动前** · `apps/frontend/vite.config.ts`（基线）

```typescript
federation({
	// Host federation 名
	name: 'host',
	// 产出 remoteEntry 文件名（Host 侧占位）
	filename: 'remoteEntry.js',
	// 运行时动态 registerRemotes，构建期无静态 remotes
	remotes: {},
	// 共享依赖表
	shared: {
		// React 单例
		react: { singleton: true, requiredVersion: '^19.1.0' },
		// react-dom 单例
		'react-dom': { singleton: true, requiredVersion: '^19.1.0' },
		// 旧：把 react-router 也 shared，生产易双实例
		'react-router': { singleton: true },
	},
}),
```

**改动后** · `apps/frontend/vite.config.ts`（当前，约 L54–L63）

```typescript
federation({
	// Host federation 名
	name: 'host',
	// 产出 remoteEntry 文件名（Host 侧占位）
	filename: 'remoteEntry.js',
	// 运行时动态 registerRemotes，构建期无静态 remotes
	remotes: {},
	// 勿 shared react-router：生产 loadShare 易与 react-router/dom 拆成双实例，
	// 导致 useLocation 找不到 Router context（线上 /plugins 白屏）。Remote 也未共享它。
	shared: {
		// React 单例
		react: { singleton: true, requiredVersion: '^19.1.0' },
		// react-dom 单例
		'react-dom': { singleton: true, requiredVersion: '^19.1.0' },
	},
}),
```

**变更摘要**：从 MF shared 移除 `react-router`。

## 5. 兼容性与影响

- 与 `optimizeDeps.exclude` **不要**排除 `react-router`（Safari/Tauri CJS `cookie` 问题）并行成立。
- 需重新构建并部署 Host（Web 9002 / 桌面壳）。

## 6. 相关源码路径

| 说明 | 路径 |
|------|------|
| Vite MF 配置 | `apps/frontend/vite.config.ts` |
| 路由入口 | `apps/frontend/src/router/index.tsx` |

---

（若与仓库最新源码不一致，以源码为准）
