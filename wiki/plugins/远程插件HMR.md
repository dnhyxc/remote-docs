# Remote 插件开发态双次整页刷新

> **文档角色（本轮主文档）**：改 remote-plugins 源码时页面刷新两次、Host 报「Importing a module script failed」的原因与修复。  
> **延伸阅读**：[插件开发指南.md](../plugins/插件开发指南.md)；[../english/学习笔记远程.md](../english/学习笔记远程.md)。

## 1. 背景与目标

开发时改子项目/插件内容，Vite 日志常见：

1. `hmr invalidate ... Could not Fast Refresh ("activate" export is incompatible)` → **整页 reload**
2. `new dependencies optimized: @tiptap/pm/model` → `optimized dependencies changed. reloading` → **再 reload**

第二次 reload 时 Host 正在 `import()` remote 模块，出现「插件不可用: Importing a module script failed」。

目标：去掉无用的同文件 `activate`/`deactivate`；把 tiptap 列入 `optimizeDeps.include` 预打包。

## 2. 改动范围

| 路径 | 说明 |
|------|------|
| `apps/remote-plugins/src/views/learning-notes/index.tsx` | 删除空生命周期导出 |
| `apps/remote-plugins/src/views/ebook/ideas/index.tsx` | 同上 |
| `apps/remote-plugins/vite.config.ts` | `optimizeDeps.include` tiptap / lowlight |

## 3. 实现思路

| 触发 | 原因 | 处理 |
|------|------|------|
| Fast Refresh 失败 | 同文件混出 React 组件 + 非组件 `activate` | 无副作用则删除；有副作用则拆到独立文件再 re-export |
| 依赖优化 reload | HMR 中途首次发现 `@tiptap/pm/model` 等 | `optimizeDeps.include` 启动时预打包 |

`activate` / `deactivate` 在 Host 侧本就可选（`mod.activate?.()`）。

## 4. 关键代码对比与注释

### 4.1 删除同文件生命周期

**改动前** · `apps/remote-plugins/src/views/learning-notes/index.tsx`（基线末尾）

```typescript
export default observer(LearningNotesApp);

// 与 default 组件同文件导出非组件值 → Fast Refresh 整页刷新
export async function activate() {
	// 列表在组件 mount 时拉取
}

export async function deactivate() {
	// no-op
}
```

**改动后** · `apps/remote-plugins/src/views/learning-notes/index.tsx`（当前末尾）

```typescript
// 仅默认导出 React 组件，满足 Fast Refresh 约定
export default observer(LearningNotesApp);
```

**变更摘要**：去掉空钩子，编辑该文件可走 Fast Refresh。

### 4.2 `optimizeDeps.include`

**改动前** · `apps/remote-plugins/vite.config.ts`（基线）

```typescript
optimizeDeps: {
	// 仅排除 React，避免双实例
	exclude: [
		'react',
		'react/jsx-runtime',
		'react/jsx-dev-runtime',
		'react-dom',
		'react-dom/client',
	],
},
```

**改动后** · `apps/remote-plugins/vite.config.ts`（当前，约 L70–L98）

```typescript
optimizeDeps: {
	// 预打包 tiptap，避免 HMR 中途发现新 dep 再整页 reload（会打断 Host 对 remoteEntry 的 import）
	include: [
		'@tiptap/core',
		'@tiptap/pm/gapcursor',
		'@tiptap/pm/model',
		'@tiptap/pm/state',
		'@tiptap/react',
		'@tiptap/react/menus',
		'@tiptap/starter-kit',
		'@tiptap/extension-code-block-lowlight',
		'@tiptap/extension-document',
		'@tiptap/extension-highlight',
		'@tiptap/extension-image',
		'@tiptap/extension-list',
		'@tiptap/extension-placeholder',
		'@tiptap/extension-table',
		'@tiptap/extension-text-align',
		'@tiptap/extensions',
		'lowlight',
	],
	exclude: [
		'react',
		'react/jsx-runtime',
		'react/jsx-dev-runtime',
		'react-dom',
		'react-dom/client',
	],
},
```

**变更摘要**：tiptap 相关在 serve 启动时预构建，避免会话中途二次 reload。

## 5. 兼容性与影响

- 修改 `optimizeDeps.include` 后需 **重启** `apps/remote-plugins` 的 `pnpm dev`。
- 若插件确需生命周期：优先挂在 default 静态属性（`App.activate` / `App.deactivate`，模块仍只 `export default`）；或单独 `lifecycle.ts` + 入口 re-export。**禁止**与组件同文件 `export function activate`。

## 6. 相关源码路径

| 说明 | 路径 |
|------|------|
| Vite 配置 | `apps/remote-plugins/vite.config.ts` |
| 学习笔记入口 | `apps/remote-plugins/src/views/learning-notes/index.tsx` |
| 想法列表入口 | `apps/remote-plugins/src/views/ebook/ideas/index.tsx` |

---

（若与仓库最新源码不一致，以源码为准）
