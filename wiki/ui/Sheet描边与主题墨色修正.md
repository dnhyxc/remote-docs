# Sheet 组件描边与浅色主题墨色修正

## 0. 延伸阅读

- [样式隔离实现.md](../style/样式隔离实现.md) — 全局主题 token 与插件域样式的边界
- [插件卡片边框主题.md](../plugins/插件卡片边框主题.md) — `border-theme/5` 如何解决远程插件污染白边（同 token 体系问题）
- [UI色调打磨.md](../ui/UI色调打磨.md) — 既有浅色/深色主题对比度与强调色规范

## 1. 背景与目标

本轮修复两个视觉边界问题，根源均指向「浅色主题 token 误用」：

1. **Sheet 抽屉分隔线不清晰**：右侧抽屉（`side === 'right'`）原通过 `border-l border-theme-border` 画左分隔线；`border-theme-border` 是一个接近白灰的低饱和色，在浅色背景下与纯白卡片底几乎融为一体，抽屉看起来「飘在画面里没有锚点」；顶/底/左其它三个方向同样只带 `border-*` 裸写，颜色不统一。
2. **`border-theme/10` 在浅色模式下完全透明**：`:root`（浅色系全局）原先把 `--theme-color` 写成了 `oklch(100% 0.00011 271.152)` ≈ 近白色。Tailwind 的 `border-theme/10` 等价于「墨色 + alpha=10%」，当墨色本身是白色时，10% 白色叠加在白底上对比度为 0，肉眼等于没描边。之前所有使用 `border-theme/N` 写法的卡片、弹窗、抽屉在浅色模式下都缺描边。

本轮目标：
- **Sheet 父容器统一补 1px `border-theme/10`**（四面同色描边，由 token 管），并取消右侧方向专属的 `border-theme-border` 具体色引用，改成纯 `border-l`（依赖父级 token）。
- **浅色 `:root` 中的 `--theme-color` 与 `--theme-textcolor`** 改为与 `.theme-white` 定义对齐的墨色 `oklch(0.15 0.02 264.665)`，保证 `border-theme/N`、`bg-theme/N` 有实际视觉效果。

## 2. 改动范围

| 说明 | 路径 |
| ---- | ---- |
| shadcn Sheet 组件：Content className（父级加 `border-theme/10`、右侧去 `border-theme-border`） | `apps/frontend/src/components/ui/sheet.tsx` |
| 浅色主题 CSS 变量（`--theme-color`、`--theme-textcolor` 纠正） | `apps/frontend/src/index.css` |

## 3. 实现思路

### 3.1 「墨色」= 设计 token 中的「通用描边色」

`--theme-color` 是全站 UI 墨色基线（非强调色、非前景色），用于：
- 低透明描边：`border-theme/10` ≈ 墨色 10% 透明度
- 低透明底色：`bg-theme/5` ≈ 墨色 5% 透明度（如卡片悬浮激活底）
- 文字反色兜底：`--theme-textcolor` 常与之同步（浅色下是深墨、深色下是近白）

浅色主题写 `100%` 白其实是把反色逻辑搞反了——那一行应属于 `.dark` 的反色，不该出现在 `:root` 浅色默认块。

### 3.2 为什么把 `border-theme/10` 放到父级而非每个 side 分支

旧版只在 `side === 'right'` 给了单独的 `border-l border-theme-border`、left/bottom/top 不给具体颜色。这样导致：
- 只有 right 侧实际有 border 可见颜色（而且是近白灰不可见）
- 三面颜色无法统一，很难跟随主题强调色切换

把 `border-theme/10` 写进 `cn()` 第一个公共 className 后，四个方向共享一条 10% 墨色描边；`side === 'right'` 只需再加 `border-l`（宽度 1px，颜色自动继承父级 `border-theme/10`）即可。这同时保证了强调色切换时描边颜色与 `--theme-color` 自动联动，无需改组件代码。

### 3.3 `border-theme-border` 该不该删

`border-theme-border` 仍然是合法 token（浅灰边界），但它对应的是 form input 等「需要真正的边框线」而不是「墨色投影」的场景。Sheet 侧栏本质上是浮层，使用近透明描边 + shadow 叠加的观感更好；硬边框会显得「生硬、嵌入感」。因此改为只保留 `border-l`（宽度）而不指定颜色，让父级的 `border-theme/10` 统一生效。

### 3.4 CSS 注释作为防守

在 `index.css` 的 `--theme-color` 上方增加了一行解释性注释（为什么不能是白、哪些 class 会受到影响），避免后续调优时再次把浅色 token 反色化。

## 4. 关键代码对比与注释

### 4.1 `SheetContent` className（`apps/frontend/src/components/ui/sheet.tsx`）

**对比范围**：`SheetContent` 函数返回的 `<SheetPrimitive.Content>` 的整个 `className={cn(...)}` 表达式（含四个 side 分支）。

**改动前** · `apps/frontend/src/components/ui/sheet.tsx`（基线 HEAD，约 L52–L68）

```tsx
// 组件返回 JSX 根：Portal + Overlay + Content 三件套
return (
        // Radix Sheet Portal：把内容挂到 body 末尾避免被父级裁剪
        <SheetPortal>
                // 半透明遮罩：背景用 theme-background/80，带淡入淡出
                <SheetOverlay />
                // Radix 原生 Content：data-slot 标记便于样式选择
                <SheetPrimitive.Content
                        // 槽位：sheet-content（全局 CSS 选择器可用）
                        data-slot="sheet-content"
                        // className 用 cn 合并基础 + side 条件 + props 覆盖
                        className={cn(
                                // 基础 className：
                                // [&>button]:hidden — 关掉 Radix 默认关闭按钮（有自定义 X 图标）；
                                // bg-theme-background — 与主站底色一致；
                                // （旧版缺失全局描边）
                                // data-state 进出动画 — 开/关状态 CSS 类；
                                // fixed z-50 — 全屏固定层 最顶层 z-index；
                                // flex flex-col gap-4 — 纵向布局子元素；
                                // shadow-lg — 大投影；
                                // transition ease-in-out 开关时长 300/500
                                '[&>button]:hidden bg-theme-background data-[state=open]:animate-in data-[state=closed]:animate-out fixed z-50 flex flex-col gap-4 shadow-lg transition ease-in-out data-[state=closed]:duration-300 data-[state=open]:duration-500',
                                // right 侧抽屉：从右滑入 + 贴右 + 高全满 + 3/4 宽 + **左分隔线 1px + border-theme-border**；
                                // sm 断点最大宽度 sm（约 400px）
                                side === 'right' &&
                                        'data-[state=closed]:slide-out-to-right data-[state=open]:slide-in-from-right inset-y-0 right-0 h-full w-3/4 border-l border-theme-border sm:max-w-sm',
                                // left 侧抽屉：从左滑入 + 贴左 + 宽 3/4 + border-r 无颜色；
                                // （旧版缺颜色，父级又没默认 → 实际不可见）
                                side === 'left' &&
                                        'data-[state=closed]:slide-out-to-left data-[state=open]:slide-in-from-left inset-y-0 left-0 h-full w-3/4 border-r sm:max-w-sm',
                                // top 侧抽屉：向下滑入 + 贴上 + 高度自适应 + border-b
                                side === 'top' &&
                                        'data-[state=closed]:slide-out-to-top data-[state=open]:slide-in-from-top inset-x-0 top-0 h-auto border-b',
                                // bottom 侧抽屉：向上滑入 + 贴底 + 高度自适应 + border-t
                                side === 'bottom' &&
                                        'data-[state=closed]:slide-out-to-bottom data-[state=open]:slide-in-from-bottom inset-x-0 bottom-0 h-auto border-t',
                                // 调用方透传的自定义 className（最后生效）
                                className,
                        )}
                        // 其余 Radix props（如 onOpenAutoFocus、forceMount 等）
                        {...props}
                >
                        // ...（children、Close 图标未改动，略）
```

**改动后** · `apps/frontend/src/components/ui/sheet.tsx`（当前源码，约 L56–L69）

```tsx
return (
        // Radix Portal：挂到 document.body，避开父级 overflow:hidden / transform
        <SheetPortal>
                // 遮罩层：半透明底，阻止点击背景
                <SheetOverlay />
                // Radix 可聚焦 Content 根节点
                <SheetPrimitive.Content
                        // slot 标记：用于自定义样式、开发工具识别
                        data-slot="sheet-content"
                        // 合并基础 + side 条件 + 用户自定义 className
                        className={cn(
                                // 基础 className 变化：
                                // 1. 保留 [&>button]:hidden / bg-theme-background；
                                // 2. **新增 border-theme/10**：四面统一 10% 墨色描边（修复浅色模式下抽屉无边界感）；
                                // 3. 其余动画 / 定位 / z-index / flex / 阴影 / 过渡保持不变
                                '[&>button]:hidden bg-theme-background border-theme/10 data-[state=open]:animate-in data-[state=closed]:animate-out fixed z-50 flex flex-col gap-4 shadow-lg transition ease-in-out data-[state=closed]:duration-300 data-[state=open]:duration-500',
                                // right 侧：**移除 border-theme-border**，只留 `border-l`（宽度 1px，颜色由父级 border-theme/10 继承）
                                side === 'right' &&
                                        'data-[state=closed]:slide-out-to-right data-[state=open]:slide-in-from-right inset-y-0 right-0 h-full w-3/4 border-l sm:max-w-sm',
                                // left 侧：继续只有 border-r，颜色现由基础 border-theme/10 给值（之前不可见 → 现在可见）
                                side === 'left' &&
                                        'data-[state=closed]:slide-out-to-left data-[state=open]:slide-in-from-left inset-y-0 left-0 h-full w-3/4 border-r sm:max-w-sm',
                                // top 侧：border-b（宽度）仍在，颜色继承基础描边
                                side === 'top' &&
                                        'data-[state=closed]:slide-out-to-top data-[state=open]:slide-in-from-top inset-x-0 top-0 h-auto border-b',
                                // bottom 侧：border-t（宽度）仍在，颜色继承基础描边
                                side === 'bottom' &&
                                        'data-[state=closed]:slide-out-to-bottom data-[state=open]:slide-in-from-bottom inset-x-0 bottom-0 h-auto border-t',
                                // 用户自定义 className（最高优先级覆盖）
                                className,
                        )}
                        // 其余 props 透传 Radix API
                        {...props}
                >
                        // ...（children、Close 图标未改动，略）
```

**变更摘要**：基础 className 新增 `border-theme/10` 为所有四个方向统一提供浅色可见描边；`side === 'right'` 删除 `border-theme-border` 专属颜色，四个方向只声明「哪边画线」（border-l/r/t/b 宽度），颜色全部由基础 token 一致供给。

### 4.2 浅色 `:root` `--theme-color` 与 `--theme-textcolor`（`apps/frontend/src/index.css`）

**对比范围**：浅色默认主题（`:root`）中 `--font-family` 之后、`--theme-white` 之前的 CSS 自定义属性段。仅截取相关 token，未改上下文保持对称。

**改动前** · `apps/frontend/src/index.css`（基线 HEAD，约 L473–L491）

```css
/* 全局默认字体：中文手写体风格（手札体-简）；若缺失会回退系统字体 */
--font-family: "手札体-简";
/* 浅色下 **错误**：把 theme-color 写成 100% 近白，导致 border-theme/10 在白底上完全透明 */
--theme-color: oklch(100% 0.00011 271.152);
/* 主站面板底色：纯白 */
--theme-background: oklch(1 0 0);
/* 卡片底色：纯白（与 background 同色，靠阴影分层） */
--theme-card: oklch(1 0 0);
/* muted（次级背景）：极淡淡灰 */
--theme-muted: oklch(0.967 0.003 264.542);
/* border：表单/输入默认边框线颜色（白灰） */
--theme-border: oklch(0.928 0.006 264.531);
/* foreground：主前景/标题深墨色 */
--theme-foreground: oklch(0.13 0.028 261.692);
/* textcolor：正文颜色——浅色下**同样错误地**写成白色 */
--theme-textcolor: oklch(100% 0.00011 271.152);
/* default：按钮/徽章等默认实体色 */
--theme-default: oklch(0.15 0.02 264.665);
/* secondary：次级实体色（与 muted 同色级） */
--theme-secondary: oklch(0.967 0.003 264.542);
/* sidebar：侧栏背景（比 background 稍深一点点） */
--theme-sidebar: oklch(0.985 0.002 247.839);
/* active-color：激活/按压态叠加色 */
--theme-active-color: oklch(0% 0 0);
/* from：渐变起始色（深墨色） */
--theme-from: oklch(0.1592 0.0133 272.86);
/* via：渐变中间色（纯黑 低饱和） */
--theme-via: oklch(0.2178 0 0);
/* to：渐变结束色（中灰） */
--theme-to: oklch(0.4202 0 0);
/* text-from：渐变文本渐变起始色（浅色应为深色，**但这里仍被写成白色**） */
--theme-text-from: oklch(100% 0.00011 271.152);
/* text-to：渐变文本渐变结束色（同样错误） */
--theme-text-to: oklch(100% 0.00011 271.152);
/* theme-white：纯白常量（用于显式取白色） */
--theme-white: oklch(1 0 0);
```

**改动后** · `apps/frontend/src/index.css`（当前源码，约 L473–L491）

```css
/* 全局默认中文字体：手写体风格（手札体-简），用户端可替换 */
--font-family: "手札体-简";
/* 新增注释：与 .theme-white 语义对齐；theme-color 是「墨色」基线，用于 border-theme/N、bg-theme/N 等半透明类，不能写白（否则浅色底上完全透明） */
/* 与 .theme-white 对齐：theme-color 是描边/淡底用的「墨色」，不能是白（否则 border-theme/10 在浅底上全透明） */
--theme-color: oklch(0.15 0.02 264.665);
/* 主面板底色：纯白 oklch 1 */
--theme-background: oklch(1 0 0);
/* 卡片底色：纯白（与 background 同级，靠投影分层） */
--theme-card: oklch(1 0 0);
/* 次级背景 muted：比纯白稍暖一点灰 0.967 */
--theme-muted: oklch(0.967 0.003 264.542);
/* 表单 border 色：白灰 0.928 */
--theme-border: oklch(0.928 0.006 264.531);
/* 前景 foreground：正文字深墨色（比墨色基线更饱和少许，确保标题可读性） */
--theme-foreground: oklch(0.13 0.028 261.692);
/* textcolor 正文色：与墨色基线对齐（修正原先「白色正文」错值）——浅色下是深色墨，保证白底可读 */
--theme-textcolor: oklch(0.15 0.02 264.665);
/* default：按钮/徽章默认墨色 */
--theme-default: oklch(0.15 0.02 264.665);
/* secondary：次级实体色（与 muted 同档，浅色下作背景） */
--theme-secondary: oklch(0.967 0.003 264.542);
/* sidebar 侧栏底色：比纯白略浅蓝灰 0.985（低对比，弱化侧栏存在感） */
--theme-sidebar: oklch(0.985 0.002 247.839);
/* 激活/按压态叠加色：纯黑 0%（后续 alpha 控制） */
--theme-active-color: oklch(0% 0 0);
/* 主渐变起始色：深色低饱和墨 from */
--theme-from: oklch(0.1592 0.0133 272.86);
/* 主渐变 via：过渡黑灰 via */
--theme-via: oklch(0.2178 0 0);
/* 主渐变 to：结束色中灰 to */
--theme-to: oklch(0.4202 0 0);
/* （未改动）渐变文本 from：保留 100% 白 — 只在 Hero 渐变字用（深色底上做文字渐变，仍需白起点） */
--theme-text-from: oklch(100% 0.00011 271.152);
/* （未改动）渐变文本 to：同上，保留白色终点 — 文本渐变场景与正文文本场景 token 语义不同 */
--theme-text-to: oklch(100% 0.00011 271.152);
/* theme-white 常量：永远纯白（显式取白使用，避免随 theme-color 漂移） */
--theme-white: oklch(1 0 0);
```

**变更摘要**：
- `--theme-color`：由 `oklch(100% 0.00011 271.152)`（近白）改为 `oklch(0.15 0.02 264.665)`（墨色基线）；上方补充「为什么不能白」的防守性注释。
- `--theme-textcolor`：由近白同步改为同墨色值，浅色正文可读（`text-textcolor` class 从此不会再出现「白字在白底」的不可读场景）。
- `--theme-text-from` / `--theme-text-to` 未动：它们只服务于 Hero 渐变文字（深色背景上的文字渐变），场景与正文文本不同。
- 其它 CSS 变量保持不变，不影响 form border、sidebar background 等既有渲染。

## 5. 行为变化与兼容性

| 区域 | 旧表现 | 新表现 |
| ---- | ---- | ---- |
| Sheet（任意方向）浅色模式 | 除 right 侧有淡灰近白线、其他 3 侧无线 | 四面统 1 条 10% 墨色描边，滑入滑出可见边界 |
| Sheet right 侧（旧 left border） | `border-theme-border` 白灰色，贴近浅色卡片底时几乎消失 | `border-l` 继承父级 `border-theme/10`，边界柔和但始终可见 |
| `border-theme/10`（全局） | 浅色下 10% 白 + 白 ≈ 完全透明 | 浅色下 10% 墨色 ≈ 真实描边线，卡片/弹窗不会「浮空」 |
| `bg-theme/[5-20]`（全局） | 浅色下近透明 → 实际看不出底色 | 墨色 5–20% 叠加在白底上：确有淡淡墨底，hover/激活态反馈真实 |
| `text-textcolor`（正文色） | 浅色下曾接近白 → 若某处未配套设置卡片深色底会白字白底 | 浅色下为墨色 → 无论容器是否显式带背景，正文均可读 |

**向下兼容**：
- `.dark`（暗色主题）的 token 不在本节涉及，暗色体验不变。
- 使用 `border-theme-border` 的其它组件（表单 inputs、对话框 borders 等）未改，仍按旧白灰 token 绘制。
- 没有删除或重命名任何 CSS 变量，只是修正错误值。

**潜在回归面**：
- 若某处原本**依赖** `--theme-color` 为「白色」做视觉（例如显式 `bg-theme` 当背景色用），新值会变成深色。由于 `--theme-white` 常量一直存在，合规场景应使用 `bg-white` 或 `bg-theme-white`，不应 `bg-theme`。若发现卡片底色骤变，需改为 `bg-theme-background` / `bg-theme-white` 等语义键。

## 6. 测试与回归建议

- **Sheet 四方向描边**：分别打开 right/left/top/bottom 四种 Sheet（例如设置抽屉、登录抽屉、电子书目录抽屉等），浅色模式下确认每侧都有一条柔和描边。
- **全局卡片不再浮空**：打开插件中心、知识库列表、电子书书架等 grid 页面，浅色模式下确认每张卡片有淡淡的 `border-theme/[5-10]` 边缘感，不再像贴在背景上的纯白色块。
- **正文可读**：浅色模式下首页欢迎语、设置页说明、插件中心描述等确认文字颜色不是白字。
- **强调色联动**：切换「设置 → 强调色」后确认 Sheet 描边仍保持墨色（`border-theme/10` 用的是 `--theme-color`，不受强调色影响）。
- **暗色不受影响**：切到深色主题，确认 Sheet 描边和卡片边框与改造前一致，不发生「出现多余的亮边」。
- **text-from / text-to 渐变字**：查看首页舞台 Hero 渐变标题，确认仍是白到白的文本渐变（未被墨色替换）。

## 7. 相关文档与代码索引

| 说明 | 路径 |
| ---- | ---- |
| Sheet 组件 className（四方向统一描边） | `apps/frontend/src/components/ui/sheet.tsx` `SheetContent` |
| 浅色主题墨色基线（token 修正） | `apps/frontend/src/index.css` `:root` 块 |
| 同根因：插件卡片白边修复（`border-theme/5`） | `docs/plugins/插件卡片边框主题.md` |
| 样式隔离领域文档（token 边界说明） | `docs/style/样式隔离实现.md` |
| 既有：UI 色调打磨 | `docs/ui/UI色调打磨.md` |

---

（若与仓库最新源码不一致，以源码为准）
