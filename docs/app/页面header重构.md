# 页面 header 重构

## 1. 背景与目标

三个文档页（`update-info`、`project-guide`、`plugin-dev-guide`）的顶栏 header 原先依赖 `DocHomeButton` 组件——一个在非首页时显示的「回首页」按钮。随着应用从「仅嵌入 Host」升级为「嵌入 + 外链独立站」双模式，`DocHomeButton` 的内存路由回首页逻辑在独立站模式下不够直观（用户更习惯用浏览器后退），且顶栏缺少页面辨识图标。本轮重构移除 `DocHomeButton`、为每页添加语义图标、调整布局间距，使 header 更简洁、辨识度更高。

## 2. 改动范围

- `src/views/updateInfo/index.tsx` — 移除 DocHomeButton，添加 ScrollText 图标，调整布局
- `src/views/projectGuide/index.tsx` — 移除 DocHomeButton，添加 BookOpen 图标，调整布局
- `src/views/pluginDevGuide/index.tsx` — 移除 DocHomeButton，FencedCodeBlock 引用路径从 `@/components/` 改为 `@/views/pluginDevGuide/`
- `src/components/DocHomeButton.tsx` — 未删除（仍被 `HomePage` 间接引用场景保留），但三页不再使用

## 3. 实现思路

1. **移除 DocHomeButton**：独立站模式下用户习惯用浏览器后退键；嵌入模式下用户从 Host 导航进入，不需要「回首页」。`DocHomeButton` 的内存路由 `navigate('/home')` 在两种模式下都不够自然，移除后 header 更简洁
2. **每页添加语义图标**：`ScrollText`（更新信息，琥珀色）、`BookOpen`（产品指南，天蓝色）、`Puzzle`（插件开发手册，紫色）。图标颜色与页面语义对应，增强辨识度
3. **布局调整**：`header` 原先 `gap-3`（DocHomeButton + 标题水平间距），移除按钮后改为 `flex-1` 容器包裹图标 + 标题，语言切换按钮加 `ml-4` 左外边距与图标区保持间距
4. **FencedCodeBlock 引用路径迁移**：从 `@/components/FencedCodeBlock`（已删除）改为 `@/views/pluginDevGuide/FencedCodeBlock`（新位置），反映该组件是页面级封装而非通用组件

## 4. 关键代码对比与注释

### 4.1 updateInfo/index.tsx — header 区域

**对比范围**：`UpdateInfoPage` 组件的 `header` JSX（摘录）。

**改动前** · `src/views/updateInfo/index.tsx`（基线，约 L1–L30）

```typescript
// 旧版只引入 Languages 图标，无页面语义图标
import { Languages } from 'lucide-react';
// 引入已被移除的 DocHomeButton 组件
import { DocHomeButton } from '@/components/DocHomeButton';
// 引入 UI 组件库
import { Button, ScrollArea } from '@/components/ui';
// 引入 i18n 国际化
import { useI18n } from '@/i18n';
// 引入更新信息数据
import {
	getUpdateInfoIntro,
	getUpdateInfoSections,
} from './updateInfoSections';
```

**改动后** · `src/views/updateInfo/index.tsx`（当前，约 L1–L30）

```typescript
// 新增 ScrollText 图标（琥珀色，代表更新日志/发布说明）
import { Languages, ScrollText } from 'lucide-react';
// 移除 DocHomeButton 引入
import { Button, ScrollArea } from '@/components/ui';
import { useI18n } from '@/i18n';
import {
	getUpdateInfoIntro,
	getUpdateInfoSections,
} from './updateInfoSections';
```

**header JSX — 改动前** · `src/views/updateInfo/index.tsx`（基线，约 L21–L30）

```tsx
// header 旧布局：gap-3 让 DocHomeButton 与标题水平排列
<header className="flex h-12.5 shrink-0 items-center gap-3 border-b border-theme/5 pl-4 pr-2">
	// 回首页按钮（已移除）
	<DocHomeButton />
	// 标题直接占 flex-1，无图标
	<h1 className="min-w-0 flex-1 truncate text-base font-semibold">
		{t('route.updateInfo.title')}
	</h1>
	// 语言切换按钮无 ml-4（旧版不需要与图标区隔开）
	<Button
		type="button"
		variant="ghost"
		size="icon-sm"
		className="shrink-0 text-textcolor/70 hover:text-textcolor"
		title={t('header.toggleLanguage')}
		aria-label={t('header.toggleLanguage')}
		onClick={onToggleLanguage}
	>
		<Languages className="size-4" strokeWidth={2} />
	</Button>
</header>
```

**header JSX — 改动后** · `src/views/updateInfo/index.tsx`（当前，约 L21–L39）

```tsx
// header 新布局：无 gap-3（不需要与按钮水平间距），用 flex-1 容器包裹图标 + 标题
<header className="flex h-12.5 shrink-0 items-center border-b border-theme/5 pl-4 pr-2">
	// flex-1 容器：图标 + 标题水平排列，gap-2 间距
	<div className="flex min-w-0 flex-1 items-center gap-2">
		// ScrollText 图标：琥珀色，size-5，不收缩
		<ScrollText className="size-5 shrink-0 text-amber-400" />
		// 标题 truncate 防止溢出
		<h1 className="min-w-0 truncate text-base font-semibold">
			{t('route.updateInfo.title')}
		</h1>
	</div>
	// 语言切换按钮加 ml-4 与图标区保持间距
	<Button
		type="button"
		variant="ghost"
		size="icon-sm"
		className="ml-4 shrink-0 text-textcolor/70 hover:text-textcolor"
		title={t('header.toggleLanguage')}
		aria-label={t('header.toggleLanguage')}
		onClick={onToggleLanguage}
	>
		<Languages className="size-4" strokeWidth={2} />
	</Button>
</header>
```

**变更摘要**：移除 DocHomeButton；新增 ScrollText 琥珀色图标；header 改用 flex-1 容器包裹图标 + 标题；语言按钮加 ml-4。

### 4.2 projectGuide/index.tsx — header 区域

**改动前** · `src/views/projectGuide/index.tsx`（基线，约 L1–L27）

```typescript
// 旧版只引入 Languages
import { Languages } from 'lucide-react';
// 引入 DocHomeButton
import { DocHomeButton } from '@/components/DocHomeButton';
import { Button, ScrollArea } from '@/components/ui';
import { useI18n } from '@/i18n';
import { getProjectGuideSections } from './projectGuideSections';
```

**改动后** · `src/views/projectGuide/index.tsx`（当前，约 L1–L5）

```typescript
// 新增 BookOpen 图标（天蓝色，代表指南/手册）
import { BookOpen, Languages } from 'lucide-react';
// 移除 DocHomeButton
import { Button, ScrollArea } from '@/components/ui';
import { useI18n } from '@/i18n';
import { getProjectGuideSections } from './projectGuideSections';
```

**header JSX — 改动后** · `src/views/projectGuide/index.tsx`（当前，约 L17–L35）

```tsx
// header 新布局：与 updateInfo 一齐
<header className="flex h-12.5 shrink-0 items-center border-b border-theme/5 pl-4 pr-2">
	// flex-1 容器：图标 + 标题
	<div className="flex min-w-0 flex-1 items-center gap-2">
		// BookOpen 图标：天蓝色，size-5
		<BookOpen className="size-5 shrink-0 text-sky-400" />
		<h1 className="min-w-0 truncate text-base font-semibold">
			{t('route.projectGuide.title')}
		</h1>
	</div>
	<Button
		type="button"
		variant="ghost"
		size="icon-sm"
		className="ml-4 shrink-0 text-textcolor/70 hover:text-textcolor"
		title={t('header.toggleLanguage')}
		aria-label={t('header.toggleLanguage')}
		onClick={onToggleLanguage}
	>
		<Languages className="size-4" strokeWidth={2} />
	</Button>
</header>
```

**变更摘要**：移除 DocHomeButton；新增 BookOpen 天蓝色图标；布局与 updateInfo 对齐。

### 4.3 pluginDevGuide/index.tsx — header 与 FencedCodeBlock 引用

**改动前** · `src/views/pluginDevGuide/index.tsx`（基线，约 L1–L6）

```typescript
// 旧版引入 Languages + Puzzle
import { Languages, Puzzle } from 'lucide-react';
import { useCallback, useMemo } from 'react';
// 引入 DocHomeButton
import { DocHomeButton } from '@/components/DocHomeButton';
// 引入 FencedCodeBlock（旧路径：通用组件目录）
import { FencedCodeBlock } from '@/components/FencedCodeBlock';
import { Button, ScrollArea } from '@/components/ui';
import { useI18n } from '@/i18n';
```

**改动后** · `src/views/pluginDevGuide/index.tsx`（当前，约 L1–L6）

```typescript
import { Languages, Puzzle } from 'lucide-react';
import { useCallback, useMemo } from 'react';
// 移除 DocHomeButton
// 引入 FencedCodeBlock（新路径：页面级目录，反映它不是通用组件）
import { FencedCodeBlock } from '@/views/pluginDevGuide/FencedCodeBlock';
import { Button, ScrollArea } from '@/components/ui';
import { useI18n } from '@/i18n';
```

**变更摘要**：移除 DocHomeButton；FencedCodeBlock 引用从 `@/components/` 改为 `@/views/pluginDevGuide/`；Puzzle 图标保留（紫色）。

## 5. 兼容性与影响

- **向后兼容**：无破坏性变更。`DocHomeButton` 组件文件仍保留，仅三页不再使用
- **视觉变化**：用户可感知——每页 header 新增语义图标，颜色与页面主题对应
- **回归测试**：验证三页 header 布局在窄屏下不溢出；语言切换按钮位置正确

## 6. 相关源码路径

| 说明 | 路径 |
| ---- | ---- |
| 更新信息页 | `src/views/updateInfo/index.tsx` |
| 产品指南页 | `src/views/projectGuide/index.tsx` |
| 插件开发手册页 | `src/views/pluginDevGuide/index.tsx` |
| 回首页按钮（保留未删） | `src/components/DocHomeButton.tsx` |
| 新版 FencedCodeBlock | `src/views/pluginDevGuide/FencedCodeBlock.tsx` |

---

（若与仓库最新源码不一致，以源码为准）
