# sonner Toaster 点击失效修复：`pointer-events: auto` 加固

## 1. 背景与目标

项目使用 `sonner` 作为全局 Toast 组件（封装在 `apps/frontend/src/components/ui/sonner.tsx`）。插件样式隔离落地后，个别场景下 Toast 的关闭按钮、`toast.custom` 内容区与整体 Toaster 容器出现**无法点击**的现象，影响交互。修复方案：为 `Toaster` 根容器、自定义 `Toast` 根节点与 `<Sonner>` 根 style 显式注入 `pointer-events: auto`，抵抗插件 `@scope` 与 iframe/Portal 链路的指针事件干扰。

## 2. 改动范围

- `apps/frontend/src/components/ui/sonner.tsx`

## 3. 核心思路

| # | 要点 | 说明 |
|---|------|------|
| 1 | 三处显式 `pointer-events: auto` | Toast 根 div、`<Sonner>` className、`<Sonner>` 根 style |
| 2 | 不碰 sonner 内部实现 | 只在外层 wrapper 与 `<Sonner>` props 上做最小修改 |
| 3 | 关闭按钮仍用 `pointer-events-none → hover:pointer-events-auto` 语义 | 与原实现一致，保持 UX |

## 4. 关键代码对比与注释

### 4.1 `Toast` 根容器加 `pointer-events-auto`

**改动前** · `apps/frontend/src/components/ui/sonner.tsx`（基线，约 L105–L156）

```tsx
// toast.custom 自定义渲染的根 div；未显式声明 pointer-events
toast.custom(
    (toastId) => {
        return (
            // 根 div 没有 pointer-events 类或 style，默认继承 pointer-events（可能被上游污染）
            <div className="group relative flex flex-col justify-center min-h-13 w-80 bg-theme-background/80 shadow-lg rounded-md py-2 pl-3 pr-9">
                <button
                    type="button"
                    className={cn(
                        'absolute right-1 top-1 flex size-7 shrink-0 cursor-pointer items-center justify-center rounded-md opacity-0 pointer-events-none transition-opacity duration-150 group-hover:opacity-100 group-hover:pointer-events-auto group-focus-within:opacity-100 group-focus-within:pointer-events-auto hover:bg-theme/15 focus-visible:opacity-100 focus-visible:pointer-events-auto focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50',
                        closeButtonTone[type],
                    )}
                    aria-label="关闭"
                    onClick={(e) => { e.stopPropagation(); toast.dismiss(toastId); }}
                >
                    <X className="size-4" strokeWidth={2} aria-hidden />
                </button>
                {/* 其余 content */}
            </div>
        );
    },
    // ...
);
```

**改动后** · `apps/frontend/src/components/ui/sonner.tsx`（当前，约 L105–L156）

```tsx
toast.custom(
    (toastId) => {
        return (
            // 根 div 显式声明 pointer-events-auto，抵抗样式隔离链路上游的 pointer-events:none 污染
            <div className="group relative flex flex-col justify-center min-h-13 w-80 bg-theme-background/80 shadow-lg rounded-md py-2 pl-3 pr-9 pointer-events-auto">
                // 关闭按钮保留 pointer-events-none → hover:pointer-events-auto 的渐进开启语义
                <button
                    type="button"
                    className={cn(
                        'absolute right-1 top-1 flex size-7 shrink-0 cursor-pointer items-center justify-center rounded-md opacity-0 pointer-events-none transition-opacity duration-150 group-hover:opacity-100 group-hover:pointer-events-auto group-focus-within:opacity-100 group-focus-within:pointer-events-auto hover:bg-theme/15 focus-visible:opacity-100 focus-visible:pointer-events-auto focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50',
                        closeButtonTone[type],
                    )}
                    aria-label="关闭"
                    onClick={(e) => { e.stopPropagation(); toast.dismiss(toastId); }}
                >
                    <X className="size-4" strokeWidth={2} aria-hidden />
                </button>
                {/* ... 其余内容 */}
            </div>
        );
    },
    // ...
);
```

**变更摘要**：`Toast` 根 div 的 `className` 追加 `pointer-events-auto`；关闭按钮内部的 `pointer-events-none → hover:pointer-events-auto` 语义保留不变。

---

### 4.2 `<Sonner>` 根 className 与 style 同时加 `pointer-events: auto`

**改动前** · `apps/frontend/src/components/ui/sonner.tsx`（基线，约 L205–L243）

```tsx
// Toaster 组件：渲染 sonner <Sonner>
const Toaster = (props: ToasterProps) => {
    const { theme = 'system' } = useTheme();
    const baseStyle = {
        '--normal-bg': 'var(--popover)',
        '--normal-text': 'var(--popover-foreground)',
        '--normal-border': 'var(--border)',
        '--border-radius': 'var(--radius)',
    } as React.CSSProperties;

    return (
        <Sonner
            {...props}
            theme={theme as ToasterProps['theme']}
            // className 仅包含 toaster / group，未声明 pointer-events
            className={cn('toaster group', props.className)}
            duration={props.duration ?? DEFAULT_TOAST_DURATION_MS}
            offset={props.offset ?? 30}
            position={props.position ?? DEFAULT_TOAST_POSITION}
            expand={props.expand ?? false}
            // ... icons
            // style 仅包含 baseStyle + props.style，未显式设置 pointer-events
            style={{ ...baseStyle, ...props.style }}
        />
    );
};
```

**改动后** · `apps/frontend/src/components/ui/sonner.tsx`（当前，约 L205–L243）

```tsx
const Toaster = (props: ToasterProps) => {
    const { theme = 'system' } = useTheme();
    const baseStyle = {
        '--normal-bg': 'var(--popover)',
        '--normal-text': 'var(--popover-foreground)',
        '--normal-border': 'var(--border)',
        '--border-radius': 'var(--radius)',
    } as React.CSSProperties;

    return (
        <Sonner
            {...props}
            theme={theme as ToasterProps['theme']}
            // className 追加 pointer-events-auto，保证 Toaster 根容器始终可点击
            className={cn('toaster group pointer-events-auto', props.className)}
            duration={props.duration ?? DEFAULT_TOAST_DURATION_MS}
            offset={props.offset ?? 30}
            position={props.position ?? DEFAULT_TOAST_POSITION}
            expand={props.expand ?? false}
            // ... icons
            // style 中显式声明 pointerEvents: 'auto'，即便 props.style 覆盖也能被后续 props 保护
            style={{
                ...baseStyle,
                pointerEvents: 'auto',
                ...props.style,
            }}
        />
    );
};
```

**变更摘要**：三处同时加固——`className` 加 `pointer-events-auto`、`style` 加 `pointerEvents: 'auto'`、`Toast` 根 div 加 `pointer-events-auto`。双重保障：CSS class 层 + inline style 层，避免被上游（插件 `@scope`、iframe、Portal）样式覆盖。

## 5. 兼容性与影响

| 项目 | 说明 |
|------|------|
| 破坏性改动 | 无；仅追加样式属性 |
| 性能影响 | 无；`pointer-events` 不触发重排 |
| 回滚 | 移除 `pointer-events-auto` / `pointerEvents: 'auto'` 即可 |

## 6. 风险与回归清单

| 风险 | 排查 |
|------|------|
| 关闭按钮仍不可点 | 用 DevTools 查看元素 `computed.pointer-events` 是否为 `auto`；若被其他样式覆盖，调整优先级 |
| `toast.custom` 根节点点击穿透 | 确认根 div 与关闭按钮的事件冒泡链，`e.stopPropagation()` 已在按钮 onClick 中 |
| `<Sonner>` 根被 body 级 `pointer-events:none` 污染 | `style={{ pointerEvents: 'auto' }}` 为 inline style，优先级最高 |

建议回归：
1. 普通 `toast.success/error/...` 弹出后，关闭按钮可点击、`duration` 到点自动消失
2. `toast.custom` 渲染的 Toast（含关闭按钮）可点击关闭
3. 插件 iframe 与 Host 页面混排场景下，Host Toast 仍可点击

## 7. 相关源码路径

| 说明 | 路径 |
|------|------|
| sonner 封装（修改） | `apps/frontend/src/components/ui/sonner.tsx` |

---

（若与仓库最新源码不一致，以源码为准）
