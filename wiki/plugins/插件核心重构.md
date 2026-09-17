# 插件 Core 模块分层重构实现说明

## 1. 背景与目标

随着微前端插件系统的演进，`apps/frontend/src/plugins/core/` 目录下的单文件实现（如 `PluginManager.ts`、`types.ts` 等）变得臃肿且耦合度高。为了提升代码的可维护性、清晰度和开发体验，本轮改动对插件核心模块进行了分层重构，将原先的扁平化结构调整为基于职责的模块化目录结构。

## 2. 改动范围

- **重构 `apps/frontend/src/plugins/core/`**：
  - **拆分 `PluginManager`**：移入 `runtime/PluginManager.ts`。
  - **拆分 `PluginVerifier`**：移入 `runtime/PluginVerifier.ts`。
  - **拆分 `types.ts`**：拆分为 `types/index.ts` 和 `types/plugin.ts` 等文件。
  - **拆分 `mf.ts`**：移入 `mf/mf.ts`。
  - **拆分 `createHostBridge`**：移入 `bridge/createHostBridge.ts`。
  - **新增 `index.ts`**：作为对外的统一 barrel 文件。
- **更新 `apps/frontend/src/plugins/host/PluginHostPage.tsx`**：
  - 修正因目录结构调整导致的 import 路径。
- **更新 `apps/frontend/src/plugins/index.ts`**：
  - 更新对 `core` 模块的导出路径。

## 3. 实现思路

1.  **按职责分层**：
    - `runtime/`: 包含核心运行时逻辑，如 `PluginManager`（插件生命周期管理）和 `PluginVerifier`（插件校验）。
    - `bridge/`: 包含桥接逻辑，如 `createHostBridge`（创建 Host 与 Remote 的通信桥）。
    - `types/`: 包含所有类型定义，实现类型与逻辑分离。
    - `mf/`: 包含 Module Federation 相关的工具函数。
2.  **Barrel 导出**：在 `core/index.ts` 中重新导出所有公共 API，保持外部调用接口不变，降低重构带来的破坏性。

## 4. 关键代码对比与注释

### 4.1 目录结构调整

**改动前**：`apps/frontend/src/plugins/core/` 为扁平结构。

```
core/
├── PluginManager.ts
├── PluginVerifier.ts
├── createHostBridge.ts
├── mf.ts
├── types.ts
└── ...
```

**改动后**：`apps/frontend/src/plugins/core/` 变为分层结构。

```
core/
├── index.ts          # 新增：统一导出
├── runtime/
│   ├── PluginManager.ts
│   └── PluginVerifier.ts
├── bridge/
│   └── createHostBridge.ts
├── types/
│   ├── index.ts
│   └── plugin.ts
├── mf/
│   └── mf.ts
└── ...
```

### 4.2 PluginHostPage.tsx import 路径修正

**对比范围**：`PluginHostPage.tsx` 顶部的 import 语句。

**改动前** · `apps/frontend/src/plugins/host/PluginHostPage.tsx`（基线，约 L15–L20）

```typescript
// 从 core 根目录直接导入
import { attachIframeBridge } from '../core/attachIframeBridge';
import { pluginManager } from '../core/PluginManager';
import type { HostBridgeProps, HostLocale } from '../core/types';
// ... (略)
import { attachPluginStyleIsolation, styleRealmKey } from './styleIsolation';
```

**改动后** · `apps/frontend/src/plugins/host/PluginHostPage.tsx`（当前，约 L15–L21）

```typescript
// 根据新的分层结构，从子目录导入
import { attachIframeBridge } from '../core/bridge/attachIframeBridge';
import { pluginManager } from '../core/runtime/PluginManager';
// types 目录拆分后，依然通过 core 根目录导出
import type { HostBridgeProps, HostLocale } from '../core/types';
// ... (略)
// 样式隔离模块独立出来
import { attachPluginStyleIsolation, styleRealmKey } from '../style-isolation';
```

**变更摘要**：修正了因 `core` 目录分层导致的 import 路径变更，同时将样式隔离模块的引入路径指向了其新的独立目录。

### 4.3 plugins/index.ts 导出路径调整

**对比范围**：`apps/frontend/src/plugins/index.ts` 对 `core` 模块的导出部分。

**改动前** · `apps/frontend/src/plugins/index.ts`（基线，约 L3–L45）

```typescript
// 旧的导出路径，直接指向 core 根目录
export {
  attachIframeBridge,
  MF_IFRAME_CHANNEL,
  createHostBridge,
  // ...
  pluginManager,
  satisfiesRange,
  verifyPlugin,
  // ...
} from './core';
```

**改动后** · `apps/frontend/src/plugins/index.ts`（当前，约 L3–L34）

```typescript
// 新的导出路径，指向 core/index.ts (即 core 根目录)
// 注意：这里的路径依然是 './core'，因为我们在 core/index.ts 中重新导出了所有公共 API
// 这保证了对外的 barrel 接口的稳定性
export {
  attachIframeBridge,
  MF_IFRAME_CHANNEL,
  createHostBridge,
  // ...
  pluginManager,
  satisfiesRange,
  verifyPlugin,
  // ...
} from './core';
// 样式隔离模块的导出
export {
  claimPluginPortalTarget,
  clearPluginPortalClaim,
  styleRealmKey,
} from './style-isolation';
```

**变更摘要**：尽管 `core` 内部结构发生了变化，但通过在 `core/index.ts` 中重新导出，`plugins/index.ts` 的主要导出路径保持不变，体现了良好的封装性。

## 5. 兼容性与影响

- **破坏性**：零。所有通过 `plugins` 主 barrel 文件 (`apps/frontend/src/plugins/index.ts`) 导入的代码不受影响。内部模块的 import 路径已全部同步更新。
- **风险**：低。主要风险在于部分深层路径的 `import` 可能未被完全更新，但这已在本轮改动中一并处理。

## 6. 相关源码路径

| 说明 | 路径 |
| ---- | ---- |
| 插件核心模块新结构 | `apps/frontend/src/plugins/core/` |
| PluginManager (新位置) | `apps/frontend/src/plugins/core/runtime/PluginManager.ts` |
| Core 模块 Barrel 文件 | `apps/frontend/src/plugins/core/index.ts` |
| Host 组件 | `apps/frontend/src/plugins/host/PluginHostPage.tsx` |
| 插件主入口 | `apps/frontend/src/plugins/index.ts` |

---

（若与仓库最新源码不一致，以源码为准）
