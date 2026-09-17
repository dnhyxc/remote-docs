# Switch 组件动态 ID 修复（解决多实例 htmlFor/id 冲突）

## 1. 背景与目标

原 Switch 组件把 `<SwitchPrimitive.Root>` 的 `id` 硬编码为 `"airplane-mode"`，同时旁边 `<Label htmlFor="airplane-mode">` 也写死。这导致**同一页面有两个 Switch 时**：

- 所有 Label 的点击行为都触发第一个 Switch（DOM 按 id 找，只能匹配第一个）
- 辅助技术（屏幕阅读器）读到错误的 label-swith 关联
- `<PluginCard>` 等网格布局里同时出现 3+ 个 Switch 时，除第一个外其余都无法通过文字点击切换

本轮把 Switch 的 id 改为**动态生成**（React.useId 兜底外部传入的 `id` prop），Label 的 `htmlFor` 同步使用同一个值，保证每个实例都有唯一关联。

---

## 2. 改动范围

- `apps/frontend/src/components/ui/switch.tsx`

---

## 3. 实现思路

1. **新增 `id` prop**：允许调用方显式传稳定 id（如 `<Switch id="plugin-xxx-shelf" />`），在循环渲染中用业务 id 最稳定。
2. **`React.useId` 作为兜底**：调用方不传 id 时由 React 生成全局唯一 id；React SSR/CSR 都保证 hydration 一致。
3. **`switchId = id ?? autoId`**：把外部传的 id 与自动生成合并为一个变量，让 Root 和 Label 都引用同一个，避免两侧写两次逻辑。
4. **不改动 className、size、checked 等 props**：组件对外行为完全向后兼容，只有 htmlFor/id 的语义修复。

---

## 4. 关键代码对比与注释

### 4.1 Switch 函数参数与 id 生成

**改动前** · `apps/frontend/src/components/ui/switch.tsx`（基线，约 L1–L47）

```typescript
// 引入 Radix Switch 原语
import * as SwitchPrimitive from '@radix-ui/react-switch';
// 引入 Label 组件（Switch 文字标签共用）
import { Label } from '@ui/label';
// 引入 React 用于组件类型
import * as React from 'react';
// 工具：合并 className
import { cn } from '@/lib/utils';

// 组件签名：继承 Radix Root 的全部 props，自定义 size + children（Label 内容）
function Switch({
        className,
        // size 控制滑块大小，默认 default；可选 sm
        size = 'default',
        // children 作为 Label 文案渲染在开关右侧
        children,
        // 剩余 props（checked、onCheckedChange、disabled 等）透传给 Root
        ...props
}: React.ComponentProps<typeof SwitchPrimitive.Root> & {
        size?: 'sm' | 'default';
        children?: React.ReactNode;
}) {
        // 旧版：无 id 处理逻辑，下面直接写死字符串
        return (
                // 外层用 div 包 Root + Label 的对齐布局
                <div className="flex items-center">
                        <SwitchPrimitive.Root
                                data-slot="switch"
                                data-size={size}
                                // 旧版：id 硬编码为 "airplane-mode"，多实例冲突根源
                                id="airplane-mode"
                                className={cn(
                                        'peer cursor-pointer data-[state=checked]:bg-theme/50 data-[state=unchecked]:bg-theme/20 focus-visible:border-theme/10 focus-visible:ring-theme/50 dark:data-[state=unchecked]:bg-theme/80 group/switch inline-flex shrink-0 items-center rounded-full border border-transparent shadow-xs transition-all outline-none focus-visible:ring-[3px] disabled:cursor-not-allowed disabled:opacity-50 data-[size=default]:h-[1.15rem] data-[size=default]:w-8 data-[size=sm]:h-3.5 data-[size=sm]:w-6',
                                        className,
                                )}
                                // 透传 checked/onCheckedChange/disabled 等
                                {...props}
                        >
                                // 滑块：用 Radix Thumb，平移距离按 group/switch 的 size 计算
                                <SwitchPrimitive.Thumb
                                        data-slot="switch-thumb"
                                        className={cn(
                                                'bg-theme data-[state=checked]:bg-theme/80 dark:data-[state=unchecked]:bg-theme dark:data-[state=checked]:bg-theme-background pointer-events-none block rounded-full ring-0 transition-transform group-data-[size=default]/switch:size-4 group-data-[size=sm]/switch:size-3 data-[state=checked]:translate-x-[calc(100%-2px)] data-[state=unchecked]:translate-x-0',
                                        )}
                                />
                        </SwitchPrimitive.Root>
                        // 有 children 就渲染 Label
                        {children ? (
                                // 旧版：htmlFor 同样硬编码 "airplane-mode"，点击永远触达第一个同名 id 的 Switch
                                <Label htmlFor="airplane-mode" className="ml-2">
                                        {children}
                                </Label>
                        ) : null}
                </div>
        );
}

export { Switch };
```

**改动后** · `apps/frontend/src/components/ui/switch.tsx`（当前，约 L1–L51）

```typescript
// 引入 Radix Switch 原语
import * as SwitchPrimitive from '@radix-ui/react-switch';
// 引入 Label 组件
import { Label } from '@ui/label';
// 引入 React，含 useId（18+）用于自动生成唯一 id
import * as React from 'react';
// 工具：合并 className
import { cn } from '@/lib/utils';

function Switch({
        className,
        // size 默认值不变
        size = 'default',
        // children 作为 Label 文案
        children,
        // 新增：从 props 中解构出 id，允许调用方传稳定业务 id（如列表循环）
        id,
        // 剩余 props 透传
        ...props
}: React.ComponentProps<typeof SwitchPrimitive.Root> & {
        size?: 'sm' | 'default';
        children?: React.ReactNode;
}) {
        // React 18 内置 hook：生成 SSR/CSR 一致的唯一 id；不传外部 id 时走这个
        const autoId = React.useId();
        // 外部 id 优先（允许业务传稳定值，方便 e2e/testing-library 定位），否则用 autoId
        const switchId = id ?? autoId;
        return (
                // 布局不变
                <div className="flex items-center">
                        <SwitchPrimitive.Root
                                data-slot="switch"
                                data-size={size}
                                // 新版：把 switchId 赋给 Root id，每个实例唯一
                                id={switchId}
                                className={cn(
                                        'peer cursor-pointer data-[state=checked]:bg-theme/50 data-[state=unchecked]:bg-theme/20 focus-visible:border-theme/10 focus-visible:ring-theme/50 dark:data-[state=unchecked]:bg-theme/80 group/switch inline-flex shrink-0 items-center rounded-full border border-transparent shadow-xs transition-all outline-none focus-visible:ring-[3px] disabled:cursor-not-allowed disabled:opacity-50 data-[size=default]:h-[1.15rem] data-[size=default]:w-8 data-[size=sm]:h-3.5 data-[size=sm]:w-6',
                                        className,
                                )}
                                // 透传其它 props
                                {...props}
                        >
                                // 滑块部分：未改动
                                <SwitchPrimitive.Thumb
                                        data-slot="switch-thumb"
                                        className={cn(
                                                'bg-theme data-[state=checked]:bg-theme/80 dark:data-[state=unchecked]:bg-theme dark:data-[state=checked]:bg-theme-background pointer-events-none block rounded-full ring-0 transition-transform group-data-[size=default]/switch:size-4 group-data-[size=sm]/switch:size-3 data-[state=checked]:translate-x-[calc(100%-2px)] data-[state=unchecked]:translate-x-0',
                                        )}
                                />
                        </SwitchPrimitive.Root>
                        {children ? (
                                // 新版：Label htmlFor 用同一个 switchId，保证点击文字绑定正确的 Switch
                                <Label htmlFor={switchId} className="ml-2">
                                        {children}
                                </Label>
                        ) : null}
                </div>
        );
}

export { Switch };
```

**变更摘要**：新增 `id` prop + `useId` 自动兜底 → 用单一 `switchId` 变量同时驱动 `<Root id>` 和 `<Label htmlFor>`，消除多实例下 htmlFor 指向错误的 bug。

---

## 5. 兼容性与影响

| 维度 | 行为 |
|------|------|
| 调用方式 | 完全向后兼容；不传 `id` 时自动生成 |
| 可访问性 | `aria-labelledby`/屏幕阅读器关联恢复正确；多 Switch 页可通过 Label 名定位 |
| E2E 测试 | 推荐传业务级稳定 `id`（如 `id="plugin-english-pack-shelf"`），避免依赖自动生成的 `r1:`/`:r2:` 这类 React 内部 id 导致快照脆弱 |
| 插件中心网格 | 3+ 个插件卡片 Switch 同时渲染时，每个开关均可通过文字点击正确切换 |

**风险与回归建议**：

1. 在插件中心页面点击任意卡片的「开关右侧或 Label 文字」确认只切换该卡片的 Switch，不影响其它卡片
2. 循环渲染多个 `<Switch>`，分别点每个 Label，断言被点的 Switch 状态翻转，其它保持不变
3. 传显式 `id="foo"` 时确认 DOM 上 id 确实为 `foo`；不传时确认每个实例 id 不同

---

## 6. 相关源码路径

| 说明 | 路径 |
|------|------|
| Switch 组件 | `apps/frontend/src/components/ui/switch.tsx` |

---

（若与仓库最新源码不一致，以源码为准）
