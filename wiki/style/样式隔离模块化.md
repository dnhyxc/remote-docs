# 样式隔离模块化与 PluginHostPage 接入实现说明

## 1. 背景与目标

为了解决微前端架构中，Host 应用与 Remote 子应用之间的样式污染和冲突，本轮改动将原有的样式隔离逻辑从 `PluginHostPage` 中彻底剥离，抽象为一个独立、可复用的 `style-isolation` 模块，并通过 `PluginHostPage` 的 `useLayoutEffect` 钩子完成运行时接入。

## 2. 改动范围

- **新增 `apps/frontend/src/plugins/style-isolation/`**：
  - `index.ts`: 模块入口，导出核心 API。
  - `protocol/`: 协议层，处理 realm 键生成和选择器构造。
  - `css/`: CSS 转译层，负责选择器前缀化、关键帧改名等。
  - `sandbox/`: 沙箱层，劫持 `head.appendChild` 和 `CSSStyleSheet.insertRule`。
  - `portal/`: Portal 层，收编 body 弹层到插件 scope。
- **删除 `apps/frontend/src/plugins/host/styleIsolation.ts`**：旧的样式隔离实现。
- **修改 `apps/frontend/src/plugins/core/runtime/PluginManager.ts`**：
  - 在 `runLoad` 方法中，Remote 加载前后包裹 `beginPluginStyleCapture` 调用。
- **修改 `apps/frontend/src/plugins/host/PluginHostPage.tsx`**：
  - 引入并调用 `attachPluginStyleIsolation`。
  - 在插件根 DOM 节点上添加 `data-mf-style-realm` 属性。
- **修改 `apps/frontend/src/plugins/index.ts`**：
  - 导出 `style-isolation` 模块的公共 API。

## 3. 实现思路

1.  **模块化分层**：将样式隔离拆分为 `Protocol`、`CSS`、`Sandbox` 和 `Portal` 四层，各司其职，互不耦合。
    -   `Protocol` 定义了隔离的“身份证”（realm）和“规则”（选择器前缀）。
    -   `CSS` 负责重写样式文本，使其符合隔离规则。
    -   `Sandbox` 劫持 DOM API，拦截所有动态样式注入。
    -   `Portal` 解决 Dialog、Tooltip 等弹层组件挂载到 body 时的样式泄漏问题。
2.  **两阶段捕获**：
    -   **加载期**：在 `PluginManager` 调用 `loadRemoteApp` 前后，使用 `beginPluginStyleCapture` 包裹，确保 Remote 入口文件（如 `remoteEntry.js`）及其依赖的 CSS 在加载瞬间就被捕获和处理。
    -   **运行时**：在 `PluginHostPage` 渲染时，通过 `useLayoutEffect` 立即调用 `attachPluginStyleIsolation`，确保后续任何时刻（如用户交互、HMR 热更新）的样式注入都能被持续捕获和隔离。
3.  **DOM 属性标记**：在插件根容器上通过 `data-mf-style-realm` 标记其样式域，使得前缀化的 CSS 选择器能够精准匹配到对应插件的 DOM 子树。

## 4. 关键代码对比与注释

### 4.1 PluginHostPage 接入样式隔离

**对比范围**：`PluginHostPage` 组件的 `import` 部分、`useLayoutEffect` 钩子及 JSX 渲染部分。

**改动前** · `apps/frontend/src/plugins/host/PluginHostPage.tsx`（基线，约 L15–L20, L188–L204）

```typescript
// 旧的 import 路径，从同目录文件引入
import { attachPluginStyleIsolation, styleRealmKey } from './styleIsolation';
// ... (略)
export function PluginHostPage({ pluginId, className, part, pageShell }: Props) {
  // ... (略)
  // 旧的 JSX，缺少 data-mf-style-realm 标记
  return wrap(
    <PluginErrorBoundary pluginId={pluginId}>
      <div className={cn(`plugin-${pluginId} h-full w-full min-h-0`, className)}>
        <Comp {...liveBridge} />
      </div>
    </PluginErrorBoundary>
  );
}
```

**改动后** · `apps/frontend/src/plugins/host/PluginHostPage.tsx`（当前，约 L15–L21, L141–L203）

```typescript
// 新的 import 路径，指向独立的 style-isolation 模块
import { attachPluginStyleIsolation, styleRealmKey } from '../style-isolation';
// ... (略)
export function PluginHostPage({ pluginId, className, part, pageShell }: Props) {
  // ... (略)
  
  // 新增：在 useLayoutEffect 中开启运行时样式隔离
  // 确保在 DOM 绘制前完成劫持，捕获所有动态样式
  useLayoutEffect(() => {
    if (status !== 'activated' || trust === 'untrusted' || !entry) return;
    // 调用样式隔离模块的挂载方法，返回清理函数
    return attachPluginStyleIsolation(pluginId, entry, loaded?.meta.remoteName);
  }, [pluginId, status, entry, trust, loaded?.meta.remoteName]);

  // ... (略)
  // 新的 JSX，添加了 data-mf-plugin 和 data-mf-style-realm 属性
  const realm = styleRealmKey(loaded.meta.entry, loaded.meta.remoteName, pluginId);
  return wrap(
    <PluginErrorBoundary pluginId={pluginId}>
      <div
        className={cn(`plugin-${pluginId} h-full w-full min-h-0`, className)}
        // 标记插件的唯一标识
        data-mf-plugin={pluginId}
        // 标记插件的样式域，是 CSS 选择器前缀化后能够命中的关键
        data-mf-style-realm={realm}
      >
        <Comp {...liveBridge} />
      </div>
    </PluginErrorBoundary>,
  );
}
```

**变更摘要**：`PluginHostPage` 现在通过 `useLayoutEffect` 在组件挂载的早期阶段（DOM 同步之前）激活样式隔离，并在其根 DOM 节点上添加了 `data-mf-style-realm` 属性，作为样式隔离的锚点。

### 4.2 PluginManager 加载期样式捕获

**对比范围**：`PluginManager` 类中的 `runLoad` 方法。

**改动前** · `apps/frontend/src/plugins/core/PluginManager.ts`（基线，约 L166–L205）

```typescript
private async runLoad(meta: PluginDescriptor, bust: string) {
  // ... (略)
  registerRemote(meta, bust);
  // 旧逻辑：直接加载 Remote，无样式捕获
  const endCapture = beginPluginStyleCapture(meta.id, meta.entry, meta.remoteName);
  let mod: Awaited<ReturnType<typeof loadRemoteApp>>;
  try {
    mod = await loadRemoteApp(meta);
  } finally {
    endCapture();
  }
  // ... (略)
}
```

**改动后** · `apps/frontend/src/plugins/core/runtime/PluginManager.ts`（当前，约 L166–L205）

```typescript
private async runLoad(meta: PluginDescriptor, bust: string) {
  // ... (略)
  registerRemote(meta, bust);
  // 新逻辑：在 loadRemoteApp 前后包裹样式捕获
  const endCapture = beginPluginStyleCapture(
    meta.id,
    meta.entry,
    meta.remoteName,
  );
  let mod: Awaited<ReturnType<typeof loadRemoteApp>>;
  try {
    // 在捕获窗口内加载 Remote，确保其注入的所有样式（包括异步加载的）都能被拦截
    mod = await loadRemoteApp(meta);
  } finally {
    // 无论加载成功与否，都必须结束捕获，释放劫持
    endCapture();
  }
  // ... (略)
}
```

**变更摘要**：`PluginManager` 的 `runLoad` 方法现在会在调用 `loadRemoteApp` 前后，通过 `beginPluginStyleCapture` 开启和结束一个“捕获窗口”，在此期间，所有 Remote 注入的样式都会被劫持和处理。

## 5. 兼容性与影响

-   **对 Remote 应用的影响**：**零**。Remote 开发者无需修改任何代码，Host 侧自动完成样式隔离。
-   **对 Host 应用的影响**：`PluginHostPage` 的 DOM 结构发生了微小变化（新增了 `data-*` 属性），但不影响任何视觉或行为。
-   **性能影响**：引入了轻量级的 DOM API 劫持和 CSS 文本处理，但对整体性能影响微乎其微。

## 6. 相关源码路径

| 说明 | 路径 |
| ---- | ---- |
| 样式隔离模块入口 | `apps/frontend/src/plugins/style-isolation/index.ts` |
| PluginManager (新位置) | `apps/frontend/src/plugins/core/runtime/PluginManager.ts` |
| Host 组件 | `apps/frontend/src/plugins/host/PluginHostPage.tsx` |
| 插件主入口 | `apps/frontend/src/plugins/index.ts` |

---

（若与仓库最新源码不一致，以源码为准）
