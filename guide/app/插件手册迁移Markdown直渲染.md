# 插件手册迁移 Markdown 直渲染

## 1. 背景与目标

插件开发手册（`plugin-dev-guide`）原先使用 2425 行结构化 TypeScript 数据文件（`pluginDevGuideSections.ts`）存储全部正文——章节标题、条目标题、描述文本、代码片段分别以 `PluginGuideSection` / `PluginGuideBullet` / `PluginGuideCode` 类型组织成嵌套数组，页面层手动 `map` 渲染 `<section>` / `<h2>` / `<h3>` / `<p>` / `<FencedCodeBlock>`。这种方式有三个痛点：

1. **维护成本高**：修订正文需操作 TS 字符串拼接（`'...\n' + '...'`），改一个标题要找到对应 `item()` 调用，无法用 Markdown 编辑器直接预览。
2. **代码片段管理笨重**：每段代码用 `String.raw` 或模板字符串存为常量，再通过 `item()` 的 `code` 参数传入，手册内 30+ 段代码导致文件臃肿。
3. **渲染逻辑冗余**：`index.tsx` 需手动遍历 sections → items，分别渲染标题/描述/代码块，而项目已有 `Markdown` 组件能直接渲染完整 Markdown（含标题、段落、围栏代码块工具栏、高亮主题）。

本轮改动将结构化数据一次性导出为 `.md` 文件，删除数据文件/转换脚本/封装组件，页面层直接用 `?raw` 导入 Markdown 字符串交给 `Markdown` 组件渲染。

## 2. 改动范围

| 文件 | 操作 | 说明 |
| ---- | ---- | ---- |
| `src/views/pluginDevGuide/pluginDevGuideSections.ts` | 删除（2425 行） | 结构化数据 + 类型定义 + 导出函数 |
| `src/views/pluginDevGuide/FencedCodeBlock.tsx` | 删除（31 行） | `{lang, code}` → 围栏 Markdown 封装组件 |
| `src/views/pluginDevGuide/dumpGuideMd.mts` | 删除（19 行） | 一次性导出脚本（已完成使命） |
| `src/views/pluginDevGuide/index.tsx` | 修改 | 从 sections map 渲染改为 `?raw` 导入 + `Markdown` 直渲染 |
| `src/views/pluginDevGuide/pluginDevGuide.zh-CN.md` | 新增（1778 行） | 中文手册 Markdown 全文 |
| `src/views/pluginDevGuide/pluginDevGuide.en-US.md` | 新增（1694 行） | 英文手册 Markdown 全文 |

## 3. 实现思路

### 3.1 为什么迁移到 Markdown 文件

1. **可维护性**：Markdown 是内容创作者的自然格式——标题用 `##`/`###`，代码块用围栏 ```` ```lang ````，段落直接写。无需 TS 字符串拼接，无需 `item()` 函数调用，直接用任何 Markdown 编辑器/预览器即可查看效果
2. **降低渲染层复杂度**：项目已有 `Markdown` 组件（`src/components/design/Markdown/index.tsx`），它内部用 `MarkdownParser` 渲染 HTML、注入高亮主题、绑定围栏复制/下载工具栏。结构化数据方式等于在 `Markdown` 组件之上又包了一层手动 JSX 渲染，重复造轮子
3. **Vite `?raw` 原生支持**：Vite 内置 `?raw` 后缀，编译时将文件内容作为字符串导入，零运行时开销，也无需额外 loader

### 3.2 为什么删除 `FencedCodeBlock` 组件

`FencedCodeBlock` 的职责是把 `{ lang: 'typescript', code: '...' }` 对象包装成 ```` ```typescript\n...\n``` ```` 围栏字符串再交给 `Markdown` 组件。迁移后代码片段直接以围栏格式写在 `.md` 文件里，不再需要这层转换——`Markdown` 组件直接处理原始 Markdown 文本中的围栏代码块。

### 3.3 为什么删除 `dumpGuideMd.mts` 脚本

`dumpGuideMd.mts` 是一次性迁移工具：它调用旧数据文件中的 `buildPluginGuideMarkdown(locale)` 函数，将结构化 sections 拼接成 Markdown 字符串并写入 `.md` 文件。迁移完成后，`.md` 文件成为唯一内容来源，脚本和数据文件都不再需要。

### 3.4 为什么删除 `pluginDevGuideSections.ts`

该文件包含：类型定义（`PluginGuideCode` / `PluginGuideBullet` / `PluginGuideSection`）、30+ 个代码常量（`CODE_ENV` / `CODE_REACT_DEPS` / ...）、中文 sections 数组（`sectionsZh`，612 行）、英文 sections 数组（`sectionsEn`，574 行）、导出函数（`getPluginGuideIntro` / `getPluginGuideSections` / `buildPluginGuideMarkdown`）。迁移后这些内容全部以自然 Markdown 格式存在于 `.md` 文件中，文件已无用。

### 3.5 `?raw` 导入如何工作

Vite 的 `?raw` 后缀在编译阶段将文件内容作为字符串导入：

```typescript
import guideZh from './pluginDevGuide.zh-CN.md?raw';
```

编译后 `guideZh` 是一个包含完整 `.md` 文件内容的字符串常量。`useMemo` 根据 `locale` 选择中/英文，传给 `Markdown` 组件的 `markdown` prop。

### 3.6 `documentIdentity` 的作用

```typescript
documentIdentity={`plugin-dev-guide-${locale}`}
```

`Markdown` 组件用 `documentIdentity` 做 `useLayoutEffect` 依赖——当文档切换（中/英切换）时重置滚动位置到顶部。旧版用 `codeblock-${section.id}-${item.id}-${locale}` 为每个代码块生成 ID，新版用单一 ID 因为整篇 Markdown 作为一个组件渲染。

## 4. 关键代码对比与注释

### 4.1 `index.tsx` — 页面组件（改动前/后对比）

**对比范围**：`PluginDevGuidePage` 组件全部（含 import 与 render）。

**改动前** · `src/views/pluginDevGuide/index.tsx`（基线，约 L1–L85）

```typescript
// 引入语言图标与拼图图标（页面语义图标）
import { Languages, Puzzle } from 'lucide-react';
// 引入 React hooks
import { useCallback, useMemo } from 'react';
// 引入 FencedCodeBlock 组件（本轮删除）
import { FencedCodeBlock } from '@/views/pluginDevGuide/FencedCodeBlock';
// 引入 UI 组件库
import { Button, ScrollArea } from '@/components/ui';
// 引入 i18n
import { useI18n } from '@/i18n';
// 引入结构化数据导出函数（本轮删除）
import {
	getPluginGuideIntro,
	getPluginGuideSections,
} from './pluginDevGuideSections';

// 页面组件
export default function PluginDevGuidePage() {
	// 获取 i18n 工具与当前语言
	const { t, locale, setLocale } = useI18n();
	// 用 useMemo 从结构化数据获取 intro（简介文本）
	const intro = useMemo(() => getPluginGuideIntro(locale), [locale]);
	// 用 useMemo 从结构化数据获取 sections（章节+条目数组）
	const sections = useMemo(() => getPluginGuideSections(locale), [locale]);

	// 语言切换回调
	const onToggleLanguage = useCallback(() => {
		setLocale(locale === 'en-US' ? 'zh-CN' : 'en-US');
	}, [locale, setLocale]);

	return (
		// 页面根容器：flex 纵向布局
		<div className="relative flex h-full min-h-0 w-full flex-col overflow-hidden bg-theme-background text-textcolor">
			// header：Puzzle 图标 + 标题 + 语言切换
			<header className="flex h-12.5 shrink-0 items-center border-b border-theme/5 pl-4 pr-2">
				<div className="flex min-w-0 flex-1 items-center gap-2">
					<Puzzle className="size-5 shrink-0 text-violet-400" />
					<h1 className="min-w-0 truncate text-base font-semibold">
						{t('route.pluginDevGuide.title')}
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

			// 滚动区域
			<ScrollArea className="min-h-0 flex-1" viewportClassName="pb-1">
				<main className="mx-auto w-full max-w-4xl px-4 py-6">
					// 渲染简介段落
					<p className="mb-10 whitespace-pre-line text-[15px] leading-7 text-textcolor/72">
						{intro}
					</p>

					// 遍历章节数组
					{sections.map((section) => (
						<section
							key={`${section.id}-${locale}`}
							className="pb-14 last:pb-4"
						>
							// 章节标题 h2
							<h2 className="mb-6 text-base font-semibold text-textcolor sm:text-lg">
								{section.title}
							</h2>
							<div className="flex flex-col gap-8">
								// 遍历条目数组
								{section.items.map((item) => {
									// 为每个代码块生成唯一 ID
									const codeBlockId = `codeblock-${section.id}-${item.id}-${locale}`;
									return (
										<article
											key={`${section.id}-${item.id}-${locale}`}
											className="scroll-mt-4"
										>
											// 条目标题 h3
											<h3 className="text-[15px] font-medium leading-snug text-textcolor">
												{item.title}
											</h3>
											// 条目描述（如有）
											{item.description ? (
												<p className="mt-2.5 whitespace-pre-line text-[14px] leading-7 text-textcolor/68">
													{item.description}
												</p>
											) : null}
											// 代码块（如有）：用 FencedCodeBlock 渲染
											{item.code ? (
												<FencedCodeBlock id={codeBlockId} code={item.code} />
											) : null}
										</article>
									);
								})}
							</div>
						</section>
					))}
				</main>
			</ScrollArea>
		</div>
	);
}
```

**改动后** · `src/views/pluginDevGuide/index.tsx`（当前，约 L1–L54）

```typescript
// 引入语言图标与拼图图标（保持不变）
import { Languages, Puzzle } from 'lucide-react';
// 引入 React hooks
import { useCallback, useMemo } from 'react';
// 引入 Markdown 组件（替代 FencedCodeBlock + 手动 JSX 渲染）
import Markdown from '@/components/design/Markdown';
// 引入 UI 组件库
import { Button, ScrollArea } from '@/components/ui';
// 引入 i18n
import { useI18n } from '@/i18n';
// 用 ?raw 导入 Markdown 文件（Vite 编译期转为字符串常量）
import guideEn from './pluginDevGuide.en-US.md?raw';
import guideZh from './pluginDevGuide.zh-CN.md?raw';

// 页面组件
export default function PluginDevGuidePage() {
	// 获取 i18n 工具与当前语言
	const { t, locale, setLocale } = useI18n();
	// 根据 locale 选择中/英文 Markdown 字符串
	const markdown = useMemo(
		() => (locale === 'en-US' ? guideEn : guideZh),
		[locale],
	);

	// 语言切换回调
	const onToggleLanguage = useCallback(() => {
		setLocale(locale === 'en-US' ? 'zh-CN' : 'en-US');
	}, [locale, setLocale]);

	return (
		// 页面根容器：与旧版一致
		<div className="relative flex h-full min-h-0 w-full flex-col overflow-hidden bg-theme-background text-textcolor">
			// header：与旧版一致
			<header className="flex h-12.5 shrink-0 items-center border-b border-theme/5 pl-4 pr-2">
				<div className="flex min-w-0 flex-1 items-center gap-2">
					<Puzzle className="size-5 shrink-0 text-violet-400" />
					<h1 className="min-w-0 truncate text-base font-semibold">
						{t('route.pluginDevGuide.title')}
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

			// 滚动区域
			<ScrollArea className="min-h-0 flex-1" viewportClassName="pb-1">
				<main className="mx-auto w-full max-w-4xl px-4 py-6">
					// 直接用 Markdown 组件渲染整篇 Markdown
					<Markdown
						// 传入 Markdown 字符串（中/英文）
						markdown={markdown}
						// 文档标识：用于换篇时重置滚动
						documentIdentity={`plugin-dev-guide-${locale}`}
						// 关闭 Mermaid 图表渲染
						enableMermaid={false}
						// 不用 ScrollArea（外层已有）
						withScrollArea={false}
					/>
				</main>
			</ScrollArea>
		</div>
	);
}
```

**变更摘要**：import 从 `FencedCodeBlock` + `getPluginGuideIntro/Sections` 改为 `Markdown` + `?raw` 导入两个 `.md` 文件；render 从 `intro` 段落 + `sections.map()` 手动渲染 h2/h3/p/FencedCodeBlock 改为单一 `<Markdown>` 组件；代码量从 85 行减至 54 行。

### 4.2 `pluginDevGuideSections.ts` — 旧数据文件结构（已删除）

**来源** · `src/views/pluginDevGuide/pluginDevGuideSections.ts`（基线，已删除，约 L1–L2425）

旧文件结构（摘录关键部分）：

```typescript
// 文件头注释：说明数据驱动的用途
/**
 * 插件 / 子应用开发手册（页面数据驱动）。
 * 与 packages/federation-kit/docs/plugin-guide 及现行 Host 契约对齐。
 * - 正文：标题 + description（视图层渲染）
 * - 代码：交给 ParserMarkdownPreviewPane 高亮
 */

// 代码片段类型：限定语言枚举
export interface PluginGuideCode {
	lang:
		| 'typescript'
		| 'tsx'
		| 'javascript'
		| 'jsx'
		| 'bash'
		| 'json'
		| 'yaml'
		| 'nginx'
		| 'dotenv'
		| 'css'
		| 'vue'
		| 'markdown';
	// 纯代码内容（不含 ``` 围栏）
	code: string;
}

// 条目类型：标题 + 日期 + 描述 + 可选代码
export interface PluginGuideBullet {
	id: string;
	title: string;
	dateLabel: string;
	description?: string;
	code?: PluginGuideCode;
}

// 章节类型：id + 标题 + 条目数组
export interface PluginGuideSection {
	id: string;
	title: string;
	items: PluginGuideBullet[];
}

// ...中间省略约 1200 行代码常量与 sections 数据...

// 导出函数：获取简介文本
export function getPluginGuideIntro(locale: string): string {
	return locale === 'en-US' ? introEn : introZh;
}

// 导出函数：获取章节数组
export function getPluginGuideSections(locale: string): PluginGuideSection[] {
	return locale === 'en-US' ? sectionsEn : sectionsZh;
}

// 一次性迁移函数：把 sections 拼成 Markdown 字符串
export function buildPluginGuideMarkdown(locale: string): string {
	const intro = getPluginGuideIntro(locale);
	const sections = getPluginGuideSections(locale);
	const parts: string[] = [intro.trim(), ''];
	// 遍历章节
	for (const section of sections) {
		parts.push(`## ${section.title}`, '');
		// 遍历条目
		for (const it of section.items) {
			parts.push(`### ${it.title}`, '');
			// 有描述则加入
			if (it.description?.trim()) {
				parts.push(it.description.trim(), '');
			}
			// 有代码则包装成围栏格式
			if (it.code?.code) {
				parts.push(`\`\`\`${it.code.lang}`, it.code.code.replace(/\n$/, ''), '```', '');
			}
		}
	}
	// 合并并清理多余空行
	return `${parts.join('\n').replace(/\n{3,}/g, '\n\n').trim()}\n`;
}
```

**变更摘要**：整文件删除。类型定义、代码常量、中英文 sections 数据、导出函数全部迁移到 `.md` 文件 + `index.tsx` 直接导入。

### 4.3 `FencedCodeBlock.tsx` — 封装组件（已删除）

**来源** · `src/views/pluginDevGuide/FencedCodeBlock.tsx`（基线，已删除，约 L1–L31）

```typescript
// 引入 memo 与 useMemo
import { memo, useMemo } from 'react';
// 引入 Markdown 组件
import Markdown from '@/components/design/Markdown';
// 引入代码片段类型（来自已删除的 sections 文件）
import type { PluginGuideCode } from '@/views/pluginDevGuide/pluginDevGuideSections';

// 封装组件：把 {lang, code} 对象包成围栏 Markdown
export const FencedCodeBlock = memo(function FencedCodeBlock({
	id,
	code,
}: {
	id: string;
	code: PluginGuideCode;
}) {
	// 用 useMemo 拼接围栏 Markdown 字符串
	const fenced = useMemo(
		() => `\`\`\`${code.lang}\n${code.code}\n\`\`\``,
		[code.lang, code.code],
	);

	return (
		// 外层容器
		<div className="my-4">
			// 交给 Markdown 组件渲染（含高亮 + 工具栏）
			<Markdown
				markdown={fenced}
				documentIdentity={id}
				enableMermaid={false}
				withScrollArea={false}
			/>
		</div>
	);
});
```

**变更摘要**：整文件删除。迁移后代码片段直接以围栏格式写在 `.md` 文件中，由 `Markdown` 组件统一渲染，无需封装层。

### 4.4 `dumpGuideMd.mts` — 一次性迁移脚本（已删除）

**来源** · `src/views/pluginDevGuide/dumpGuideMd.mts`（基线，已删除，约 L1–L19）

```typescript
// 一次性脚本：把 pluginDevGuideSections 导出为 zh/en .md
// 用法：cd remote-docs && npx --yes tsx src/views/pluginDevGuide/dumpGuideMd.mts
// 引入 Node.js 文件系统模块
import fs from 'node:fs';
// 引入 Node.js 路径模块
import path from 'node:path';
// 引入 URL 工具（获取 ESM 模块文件路径）
import { fileURLToPath } from 'node:url';
// 引入旧数据文件中的 buildPluginGuideMarkdown 函数
import { buildPluginGuideMarkdown } from './pluginDevGuideSections.ts';

// 获取当前脚本所在目录
const dir = path.dirname(fileURLToPath(import.meta.url));

// 遍历中英文两个 locale
for (const [locale, file] of [
	['zh-CN', 'pluginDevGuide.zh-CN.md'],
	['en-US', 'pluginDevGuide.en-US.md'],
] as const) {
	// 拼接输出文件完整路径
	const out = path.join(dir, file);
	// 调用 buildPluginGuideMarkdown 生成 Markdown 字符串并写入文件
	fs.writeFileSync(out, buildPluginGuideMarkdown(locale), 'utf8');
	// 打印输出路径
	console.log('wrote', out);
}
```

**变更摘要**：整文件删除。脚本已完成使命——生成了两个 `.md` 文件，之后数据文件被删，脚本无用。

## 5. 兼容性与影响

- **向后兼容**：无破坏性变更。页面行为不变——用户仍能看到完整的中/英文插件开发手册，含章节标题、条目描述、代码块（带复制/下载工具栏）
- **渲染差异**：旧版手动渲染的 `h2`/`h3`/`p` 标签与 `Markdown` 组件渲染的 Markdown 语义一致（`## ` → `<h2>`，`### ` → `<h3>`），样式由 `markdown-body` CSS 统一控制
- **包体积**：`pluginDevGuideSections.ts`（2425 行 TS）被两个 `.md` 文件（1778 + 1694 行）替代，但 `.md` 作为 `?raw` 字符串导入不经 Tree-shaking，编译产物中两者体积相近；主要收益是源码可维护性
- **回归测试**：验证中/英文页面内容完整渲染；验证代码块高亮、复制/下载工具栏正常；验证语言切换后内容与滚动重置正常

## 6. 相关源码路径

| 说明 | 路径 |
| ---- | ---- |
| 页面组件（当前） | `src/views/pluginDevGuide/index.tsx` |
| 中文 Markdown | `src/views/pluginDevGuide/pluginDevGuide.zh-CN.md` |
| 英文 Markdown | `src/views/pluginDevGuide/pluginDevGuide.en-US.md` |
| Markdown 渲染组件 | `src/components/design/Markdown/index.tsx` |
| 已删除：结构化数据 | `src/views/pluginDevGuide/pluginDevGuideSections.ts` |
| 已删除：代码块封装 | `src/views/pluginDevGuide/FencedCodeBlock.tsx` |
| 已删除：迁移脚本 | `src/views/pluginDevGuide/dumpGuideMd.mts` |

---

（若与仓库最新源码不一致，以源码为准）
