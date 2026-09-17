# EPUB 阅读设置与连续滚动衔接

> **文档角色**：在 [书架阅读打磨.md](./书架阅读打磨.md) 之上的**增量专题**，覆盖 EPUB 阅读设置 Popover、本地持久化、分页/连续滚动切换，以及连续滚动模式下章节边界自动衔接。  
> **延伸阅读**：[电子书阅读书架.md](./电子书阅读书架.md)（全链路）；[书架阅读打磨.md](./书架阅读打磨.md)（书架卡片、PDF 目录、主题文字）。

## 1. 背景与目标

EPUB 阅读在基础翻页与目录可用后，用户仍需要：

- **排版个性化**：字号、行距、文字颜色、阅读背景可调，且下次打开仍生效。
- **翻页方式**：分页（左右/上下翻页）与连续滚动两种模式。
- **连续滚动体验**：滚到当前章节底部应自动进入下一章，滚到顶部应回到上一章，而不是卡住后只能点顶栏「下一页」。

## 2. 改动范围

| 路径 | 说明 |
|------|------|
| `apps/frontend/src/views/ebook/utils/epubReaderSettings.ts` | **新增** 设置类型、load/save、`applyEpubReaderAppearance` |
| `apps/frontend/src/views/ebook/components/EpubReaderSettingsPopover.tsx` | **新增** 顶栏设置 Popover（Bolt 图标） |
| `apps/frontend/src/views/ebook/utils/epubScrolledNav.ts` | **新增** 连续滚动边界 wheel → `check()` / `prev`/`next` |
| `apps/frontend/src/views/ebook/components/EpubPane.tsx` | 传入 `readerSettings`；`continuous` manager；`overflow-hidden`；挂载边界导航 |
| `apps/frontend/src/views/ebook/read.tsx` | 设置状态、`EpubReaderSettingsPopover`、仅 EPUB 展示 |
| `apps/frontend/src/i18n/locales/zh-CN.ts`、`en-US.ts` | `ebook.read.settings.*` 文案 |

## 3. 实现思路

### 3.1 设置模型与持久化

- 统一结构 `EpubReaderSettings`：字号 80–160%、行距 1.2–2.4、文字颜色（自动/深/浅/护眼）、背景（默认/纸白/深色/护眼/绿色）、翻页方式（分页/连续滚动）。
- 读写 `localStorage` 键 `dnhyxc_epub_reader_settings`；非法值回退默认。
- **外观类设置**（字号、行距、颜色、背景）通过单独 `useEffect` 调用 `applyEpubReaderAppearance`，避免每次微调都整书重载。
- **翻页方式**变更会触发 `EpubPane` 主 effect 重建 rendition（依赖 `readerSettings.pageFlow`），切换前保留当前 CFI。

### 3.2 连续滚动与 epub.js

- `flow: 'scrolled'` 且 `manager: 'continuous'`：epub.js 在连续容器内按需 `append`/`prepend` spine 章节（`manager.check()`）。
- 阅读区 host 使用 **`overflow-hidden`**，滚动只发生在 epub 内部 `.epub-container`；若外层 `overflow-auto`，滚动事件进不了 manager，`check()` 无法加载下一章——这是「滚到底卡住」的主因。
- `attachEpubScrolledEdgeNav` 在容器上监听 `wheel`：已到底且继续向下 → 调用 `manager.check()`（有则优先）或 `rend.next()`；已到顶且继续向上 → 同理 `prev`。`passive: false` + 320ms 冷却，避免连触发。

### 3.4 连续滚动条样式（原生滚动条美化）

- 实际滚动发生在 epub.js 的 `.epub-container` 上，**不能**用 Radix `ScrollArea` 替换滚动容器（会破坏 `manager.check()` 与章节衔接，且双层滚动同步会导致布局异常）。
- 曾尝试：`ScrollArea` 双向同步 `scrollTop`、在 `index.css` 给容器加 `.epub-reader-scrollbar` class——均因影响显示与滚动而**回退**。
- **现行方案**：仅在 `EpubPane` host 上用 Tailwind 后代选择器美化 `.epub-container` 原生滚动条（细轨道、`theme-border` 圆角滑块、`w-2` 宽度）。滚动逻辑仍完全由 epub.js 内部容器承担。

### 3.5 与分页模式的差异

| 模式 | manager | 交互 |
|------|---------|------|
| `paginated` | `default` | 按屏翻页；顶栏/键盘 `prev`/`next` |
| `scrolled` | `continuous` | 容器内纵向滚动；边界 wheel 衔接章节；顶栏按钮仍可滚动一屏或触发 `check()` |

### 3.6 未采用方案

- **仅改外层 overflow 不加边界监听**：部分 EPUB 短章节或触控板惯性仍可能在边界停住；边界 `wheel` 作为兜底。
- **切换 scrolled 仍用 default manager**：default 模式下 `next()` 直接换 spine 整章替换，不符合「连续滚动」语义；continuous 才支持流式加载相邻章节。
- **ScrollArea 包裹或同步滚动**：阅读区外层套 `ScrollArea`、或在 viewport 与 `.epub-container` 间同步 `scrollTop`，会导致正文显示错位、滚动卡顿；已明确放弃。
- **全局 CSS class 动态挂到 container**：与 Tailwind 方案并列尝试过，为保持与 EpubPane 样式一致已回退到 host 上的 Tailwind 后代选择器。

## 4. 关键代码与注释

### 4.1 设置持久化与注入 rendition

**来源**：`apps/frontend/src/views/ebook/utils/epubReaderSettings.ts`（约 L21–L27、L60–L82、L96–L134）

```typescript
// 说明：默认值与 localStorage 键；pageFlow 切换会整书重建 rendition
export const DEFAULT_EPUB_READER_SETTINGS: EpubReaderSettings = {
  fontSize: 100,
  lineHeight: 1.6,
  textColor: 'auto',   // auto 时随应用 black 主题用浅色字
  bgTheme: 'default',
  pageFlow: 'paginated',
};

export function loadEpubReaderSettings(): EpubReaderSettings {
  // ... 从 localStorage 解析并 clamp 到合法区间
}

/** 将字号、行距、文字颜色注入 epub.js themes，不触发整书重载 */
export function applyEpubReaderAppearance(
  rend: Rendition,
  settings: EpubReaderSettings,
  appTheme: ThemeName,
): void {
  const color = resolveEpubTextColor(settings.textColor, appTheme);
  rend.themes.fontSize(`${settings.fontSize}%`);
  rend.themes.default({
    body: {
      color: `${color} !important`,
      'line-height': `${settings.lineHeight} !important`,
      'font-size': `${settings.fontSize}% !important`,
    },
    // ... 段落级 color / line-height
  });
}
```

### 4.2 连续 manager 与边界导航

**来源**：`apps/frontend/src/views/ebook/components/EpubPane.tsx`（约 L220–L248）

```typescript
// 说明：scrolled 时用 continuous manager；挂载后注册边界 wheel 导航
rend = book.renderTo(el, {
  width: w,
  height: h,
  flow: pageFlow,
  manager: pageFlow === 'scrolled' ? 'continuous' : 'default',
  spread: 'none',
  allowScriptedContent: true,
});

if (pageFlow === 'scrolled') {
  detachScrolledNav = attachEpubScrolledEdgeNav(rend, () => destroyed);
}
```

### 4.3 连续滚动条（host 后代选择器）

**来源**：`apps/frontend/src/views/ebook/components/EpubPane.tsx`（约 L327–L344）

```typescript
// 说明：scrolled 时在 host 上美化内部 .epub-container 原生滚动条（非 ScrollArea）
<div
  ref={hostRef}
  className={cn(
    'h-full min-h-0 w-full overflow-hidden rounded-b-md ring-1 ring-theme/10',
    readerSettings.pageFlow === 'paginated' && 'min-h-[320px]',
    epubReaderHostBgClass(readerSettings.bgTheme),
    readerSettings.pageFlow === 'scrolled' && [
      '[&_.epub-container]:[scrollbar-width:thin]',
      '[&_.epub-container]:[scrollbar-color:color-mix(in_oklch,var(--theme-border)_60%,transparent)_transparent]',
      '[&_.epub-container::-webkit-scrollbar]:w-2',
      '[&_.epub-container::-webkit-scrollbar-track]:bg-transparent',
      '[&_.epub-container::-webkit-scrollbar-thumb]:rounded-full',
      '[&_.epub-container::-webkit-scrollbar-thumb]:bg-theme-border/60',
      'hover:[&_.epub-container::-webkit-scrollbar-thumb]:bg-theme-border',
    ],
  )}
/>
```

### 4.4 边界 wheel 衔接相邻 spine

**来源**：`apps/frontend/src/views/ebook/utils/epubScrolledNav.ts`（约 L27–L71）

```typescript
// 说明：滚到顶/底且 wheel 仍向该方向时，优先 manager.check() 加载相邻章节
const runEdgeAction = (action: 'prev' | 'next', e?: Event) => {
  if (isDestroyed() || busy || Date.now() < cooldownUntil) return;
  e?.preventDefault();
  busy = true;
  cooldownUntil = Date.now() + EDGE_COOLDOWN_MS;

  const manager = getManager(rend);
  const task = manager?.check
    ? Promise.resolve(manager.check())   // continuous：append/prepend spine
    : Promise.resolve(action === 'next' ? rend.next() : rend.prev());

  void task.finally(() => { busy = false; });
};

const onWheel = (e: WheelEvent) => {
  const { atTop, atBottom } = scrollEdges(container);
  if (e.deltaY > 0 && atBottom) runEdgeAction('next', e);
  else if (e.deltaY < 0 && atTop) runEdgeAction('prev', e);
};
```

### 4.5 阅读页顶栏设置入口

**来源**：`apps/frontend/src/views/ebook/components/EpubReaderSettingsPopover.tsx`（约 L43–L135）

```typescript
// 说明：目录按钮右侧 Bolt 图标；Popover 内含字号/行距/翻页方式/颜色/背景/恢复默认
<Popover open={open} onOpenChange={onOpenChange}>
  <PopoverTrigger asChild>
    <Button aria-label={t('ebook.read.settings')} /* ... */>
      <Bolt className="size-4" />
    </Button>
  </PopoverTrigger>
  <PopoverContent className="w-72 p-4">
    {/* 字号 slider 80–160 */}
    {/* 行距 slider 1.2–2.4 */}
    <Select value={settings.pageFlow} onValueChange={(v) => onChange({ pageFlow: v })}>
      <SelectItem value="paginated">{t('...paginated')}</SelectItem>
      <SelectItem value="scrolled">{t('...scrolled')}</SelectItem>
    </Select>
    {/* 文字颜色、阅读背景 Select；恢复默认 Button */}
  </PopoverContent>
</Popover>
```

## 5. 兼容性与影响

| 项 | 说明 |
|----|------|
| 设置存储 | 仅本机 `localStorage`；换浏览器/清缓存恢复默认。 |
| 切换翻页方式 | 短暂重建 rendition；尽量保留 CFI，极端 EPUB 可能需手动目录跳转。 |
| 连续滚动 | 依赖 epub.js continuous；极个别内嵌样式可能导致 iframe 内独立滚动，边界行为以实测为准。 |
| 滚动条外观 | 连续滚动下为系统原生滚动条 + host 后代 Tailwind 美化；部分浏览器对嵌套 `::-webkit-scrollbar` 选择器支持有限，样式以实测为准。 |
| PDF | 不受本专题影响；无 EPUB 阅读设置 Popover。 |

### 5.1 回归建议

- EPUB 分页模式：翻页、键盘、目录、设置调整后即时生效且不闪屏。
- EPUB 连续滚动：长章滚到底自动下一章；滚到顶自动上一章；顶栏下一页仍可用；滚动条样式与滚动手感正常。
- 切换 `pageFlow` 后进度与 CFI 是否大致连续。
- 恢复默认、刷新页面后设置是否持久化。

## 6. 相关源码路径

| 说明 | 路径 |
|------|------|
| 设置工具 | `apps/frontend/src/views/ebook/utils/epubReaderSettings.ts` |
| 边界导航 | `apps/frontend/src/views/ebook/utils/epubScrolledNav.ts` |
| 设置 UI | `apps/frontend/src/views/ebook/components/EpubReaderSettingsPopover.tsx` |
| EPUB 渲染 | `apps/frontend/src/views/ebook/components/EpubPane.tsx` |
| 阅读页编排 | `apps/frontend/src/views/ebook/read.tsx` |

若与仓库最新源码不一致，以源码为准。
