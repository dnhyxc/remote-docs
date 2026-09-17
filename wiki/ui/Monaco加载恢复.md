# Monaco 编辑器 loading 恢复与 Suspense 占位背景

## 延伸阅读

- [构建优化.md](../app/构建优化.md) — Monaco 组件级懒加载（薄壳 + `React.lazy`）
- [monaco-Markdown输入法鬼影.md](../monaco/Markdown输入法鬼影.md) — Monaco 输入法重影修复

## 1. 背景与目标

**问题**：在之前的打包优化中，Monaco 编辑器的 `loading` prop 被硬编码为 `loading={null}`（注释掉了 `loading={<Loading text={...} />}`），导致编辑器内核加载期间无任何加载指示。同时 `Suspense` fallback 占位 div 缺少背景色，在深色主题下与周围内容无视觉分隔。

**目标**：

1. 恢复 `loading` prop 为可配置：`MarkdownEditorProps` 新增 `loading?: React.ReactNode | null`，默认 `null`（不传时行为同改前硬编码 null）；调用方可传入自定义加载指示器。
2. `Suspense` fallback 占位 div 添加 `bg-theme/5` 微透明背景，在浅/深色主题下均与周围内容有轻微视觉区分。

## 2. 改动范围

- `apps/frontend/src/components/design/Monaco/MonacoEditor.tsx`（`MarkdownEditorProps` 新增 `loading` prop + 4 处 `loading={null}` 改为 `loading={loading ? loading : null}`）
- `apps/frontend/src/components/design/Monaco/index.tsx`（`Suspense` fallback div className 加 `bg-theme/5`）

## 3. 实现思路

1. **`loading` prop 入口**：在 `MarkdownEditorProps` 接口新增 `loading?: React.ReactNode | null`，解构默认值 `loading = null`。
2. **透传到 `@monaco-editor/react`**：将 4 处 `loading={null}` 改为 `loading={loading ? loading : null}`——若调用方传入了自定义加载节点则使用之，否则传 `null`（`@monaco-editor/react` 收到 `null` 时不渲染加载层）。
3. **Suspense fallback 背景**：在 `Monaco/index.tsx` 的 `Suspense` fallback div 的 `cn()` 中追加 `bg-theme/5`，使懒加载占位与已加载编辑器有视觉层次。

## 4. 关键代码对比与注释

### 4.1 `MarkdownEditorProps` 接口新增 `loading` 字段

**对比范围**：`MarkdownEditorProps` 接口中 `loading` 字段声明行（纯新增，无改动前对照行）。

**改动后** · `apps/frontend/src/components/design/Monaco/MonacoEditor.tsx`（当前，约 L259）

```typescript
// 新增可选 loading prop：调用方可传入自定义加载指示器；不传则 null（不渲染加载层）
loading?: React.ReactNode | null;
```

### 4.2 组件解构新增 `loading` 默认值

**对比范围**：`MarkdownEditor` 组件函数参数解构（仅展示 `loading` 行，前后对称摘录）。

**改动前** · `apps/frontend/src/components/design/Monaco/MonacoEditor.tsx`（基线，`MarkdownEditor` 解构中无 `loading`）

```tsx
// 改前：解构中无 loading 字段（loading prop 不存在于 MarkdownEditorProps）
const MarkdownEditor: React.FC<MarkdownEditorProps> = ({
	// ...（其它 props 未改动）
// 解构结束
}) => {
```

**改动后** · `apps/frontend/src/components/design/Monaco/MonacoEditor.tsx`（当前，约 L304）

```tsx
// 改后：解构新增 loading，默认 null
const MarkdownEditor: React.FC<MarkdownEditorProps> = ({
	// ...（其它 props 未改动）
	// loading prop：默认 null，调用方可传入自定义加载节点
	loading = null,
}) => {
```

**变更摘要**：解构新增 `loading = null`，与接口 `loading?: React.ReactNode | null` 对应。

### 4.3 `@monaco-editor/react` 的 `loading` prop 透传

**对比范围**：编辑器 / Diff 编辑器 JSX 中 `loading` 属性行（4 处同模式，此处展示一处，其余对称）。

**改动前** · `apps/frontend/src/components/design/Monaco/MonacoEditor.tsx`（基线，约 L1933–L1934）

```tsx
// 改前：loading 硬编码为 null，注释掉了原来的 Loading 组件
// loading={<Loading text={loadingEditorText} />}
loading={null}
```

**改动后** · `apps/frontend/src/components/design/Monaco/MonacoEditor.tsx`（当前，约 L1933）

```tsx
// 改后：若调用方传入 loading 则使用之，否则 null
loading={loading ? loading : null}
```

**变更摘要**：4 处 `loading={null}` 统一改为 `loading={loading ? loading : null}`；移除了上方注释掉的 `// loading={<Loading text={loadingEditorText} />}` 行。

### 4.4 `Suspense` fallback 占位背景

**对比范围**：`MarkdownEditor` 默认导出函数中 `Suspense` fallback 的 div className。

**改动前** · `apps/frontend/src/components/Monaco/index.tsx`（基线，约 L18–L25）

```tsx
// 改前：Suspense fallback div 无背景色
<Suspense
	fallback={
		// 仅 loading 时占位；加载完成后由 MonacoEditor 自己吃 height，避免双层 height 撑不满
		<div
			// className 无 bg-theme/5
			className={cn('min-h-0 min-w-0 w-full', className)}
			style={{ height }}
		>
			<Loading className="flex h-full w-full items-center justify-center" />
		</div>
	}
>
	<MonacoEditor {...props} />
</Suspense>
```

**改动后** · `apps/frontend/src/components/design/Monaco/index.tsx`（当前，约 L18–L31）

```tsx
// 改后：Suspense fallback div 新增 bg-theme/5 微透明背景
<Suspense
	fallback={
		// 仅 loading 时占位；加载完成后由 MonacoEditor 自己吃 height，避免双层 height 撑不满
		<div
			// className 追加 bg-theme/5：浅/深色主题下均与周围有轻微视觉分隔
			className={cn("min-h-0 min-w-0 w-full bg-theme/5 ", className)}
			style={{ height }}
		>
			<Loading className="flex h-full w-full items-center justify-center" />
		</div>
	}
>
	<MonacoEditor {...props} />
</Suspense>
```

**变更摘要**：`cn()` 第一个参数从 `'min-h-0 min-w-0 w-full'` 改为 `"min-h-0 min-w-0 w-full bg-theme/5 "`，追加 5% 透明度主题色背景。

## 5. 兼容性与影响

- **向下兼容**：`loading` 默认 `null`，不传时 `loading={loading ? loading : null}` 等价于 `loading={null}`，行为同改前。
- **视觉变化**：`Suspense` fallback 新增 `bg-theme/5` 背景，在编辑器内核加载期间占位区有轻微底色（浅色主题下极淡灰、深色主题下极淡白），加载完成后被编辑器覆盖。
- **调用方可扩展**：知识库编辑器等调用方可在未来传入自定义 `loading` 节点（如带文案的 Loading），无需改 MonacoEditor 本身。

## 6. 相关源码路径

| 说明 | 路径 |
| ---- | ---- |
| Monaco 编辑器组件（含 `loading` prop） | `apps/frontend/src/components/design/Monaco/MonacoEditor.tsx` |
| Monaco 懒加载薄壳（Suspense fallback） | `apps/frontend/src/components/design/Monaco/index.tsx` |

---

（若与仓库最新源码不一致，以源码为准）
