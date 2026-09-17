# 学习笔记 DOCX Builder 实现归档

> 文档角色：implementation-doc-from-diff 归档稿（纯新增）
> 改动一轮：学习笔记富文本导出 Word（DOCX）— 后端 HTML→DOCX 转换器
> 状态：已落地（2026-07）

## 1. 背景与目标

学习笔记前端使用 TipTap 富文本编辑器，正文以 HTML 形式存储。用户在「学习笔记」模块中希望将单篇笔记一键导出为 Word（DOCX）文档，且要求：

- 保留 TipTap 编辑器中的视觉样式（标题层级、加粗/斜体/下划线/删除线/行内代码、文字颜色、高亮 mark、对齐、引用块左边框等）。
- 内嵌图片需真正打入 DOCX（不是外链），支持 data URL、本机 uploads 路径、远程 http(s) 三类来源；webp/avif/heic 等非 Word 原生格式需转码为 JPEG。
- 保留表格（含 th/td、colspan/rowspan）、有序/无序列表、任务列表（taskList/taskItem 带 checkbox）、代码块（pre，带底色与等宽字体）、分割线。
- 严格控制资源上限：单篇 HTML 字符数、图片张数、单图字节数、图片总字节数均有软/硬上限，超限优雅降级（跳过并页脚提示）。
- 后端纯计算产出 Buffer，不落盘、不依赖外部服务；图片读取优先本机 uploads（避免生产机 hairpin/反代失败），其次远程拉取（带超时）。

本文件 `learning-note-docx.builder.ts` 即上述能力的后端实现核心：输入 `{ title, html }`，输出可直接回传前端的 DOCX `Buffer`。

## 2. 改动范围

| 路径 | 类型 | 说明 |
| --- | --- | --- |
| `apps/backend/src/services/learning-notes/learning-note-docx.builder.ts` | 纯新增 | HTML→DOCX 转换核心：常量、图片加载/转码、行内样式状态机、块级扫描、表格/列表/代码块/引用构造、主入口 |

依赖（既有，未改动）：

- `docx`：Word 文档生成库（`ImageRun` / `Paragraph` / `Table` / `TextRun` / `ExternalHyperlink` 等）。
- `../../utils/upload-paths`：`decodeUploadPublicPath` / `resolveUploadPublicPathToAbsolute`，把 `/images|files|remotes/...` 公开路径解码为本机绝对路径。

文件顶部 import（L1–L29）从 `docx` 引入排版所需的类型与构造器，从 `upload-paths` 引入路径解析工具，本归档不单独成节，在用到处随文说明。

## 3. 实现思路

1. **不依赖 DOM 解析器**：TipTap 输出的 HTML 用轻量正则 + 状态机扫描，避免引入 cheerio/jsdom 等重依赖；自写 `splitTopBlocks`（顶层块）与 `htmlToStyledRuns`（行内样式栈）两层扫描。
2. **行内样式用栈维护**：`htmlToStyledRuns` 维护 `tagStack` + `stack`（`InlineStyle` 栈），遇开标签 push 合并样式，遇闭标签 pop；输出 `runs` 段与 `img` 段交替序列，由外层按段拆 `Paragraph`。
3. **块级视觉对齐 CSS**：`blockVisual` 按 tag 返回 `spacing`/`indent`/`border`/`baseRun`，模拟 `remote-plugins/RichEditor/styles.css` 的视觉（标题不蓝、引用带左边框、代码块底色），不使用 Word 内置 Heading 样式避免蓝字。
4. **图片三源统一入口**：`loadImageBytes` 依次尝试 data URL → 本机 uploads → 远程 fetch；本机优先是因为生产机自拉公网常因 hairpin/反代失败。
5. **格式转码兜底链**：`docxNativeKind` 判定 Word 原生（jpg/png/gif/bmp）；webp/foreign 经 `rasterToJpeg` 转 JPEG——sharp 懒加载（避免启动路径耦合），失败回退 macOS `sips`（仅本机开发兜底）。
6. **资源预算可控**：`ImageBudget` 累计 `count`/`bytes`/`skipped`/`reasons`，超限调用 `skipImage` 记原因；最终在文档末尾以灰字段落输出未嵌入图片明细，便于线上排查。
7. **表格/代码块都用 `Table` 实现**：代码块用单格 `Table` + 底色 + 段落 indent/空段模拟 CSS padding（段落 shading 与 `tcMar` 在部分客户端不可靠）；表格不设 `tableHeader` 避免部分客户端跨页重复画表头。
8. **任务列表脱壳**：`unwrapTaskItemContent` 去掉 TipTap `taskItem` 的 label/checkbox UI，只留内容；checkbox 状态转为 `☑ / ☐` 文本前缀。
9. **主入口幂等纯函数**：`buildLearningNoteDocxBuffer` 校验 HTML 长度 → 构造标题段 → 剥离 `data-type="note-title"` 容器 → 块扫描 → 组装 `Document` → `Packer.toBuffer`。

## 4. 关键代码与逐行注释

### 4.1 常量定义（`apps/backend/src/services/learning-notes/learning-note-docx.builder.ts`）

本节汇集文件顶部所有导出/模块级常量：HTML 与图片的容量上限、正文段截断、图片显示宽、fetch 超时、表格宽度（DXA）、正文字号（half-points）、行距、列表缩进、表格/代码块边框、代码块底色。这些常量集中管控导出的视觉与资源边界，便于后续调参。同时附 `DocxChild` 便捷类型别名。

**改动后** · `apps/backend/src/services/learning-notes/learning-note-docx.builder.ts`（当前，约 L31–L75）

```typescript
// 单篇 HTML 字符上限（与 Save DTO 同量级），导出前先校验防止过大输入拖垮进程
export const NOTE_DOCX_HTML_MAX_CHARS = 5_000_000;
// 最多嵌入图片数，超过则跳过并记原因
export const NOTE_DOCX_IMAGE_MAX_COUNT = 120;
// 单张解码后建议上限（超过仍尝试嵌入，仅缩小显示尺寸）
export const NOTE_DOCX_IMAGE_SOFT_MAX_BYTES = 6_000_000;
// 全部图片解码字节合计软上限
export const NOTE_DOCX_IMAGES_TOTAL_SOFT_MAX_BYTES = 40_000_000;
// 正文单段文本截断，防止异常长文本撑爆单个 TextRun
const PARA_TEXT_MAX = 50_000;
// 导出图显示最大宽（px），超过按比例缩放
const IMAGE_MAX_WIDTH_PX = 640;
// 拉取外链图超时（ms），超时即放弃该图
const FETCH_TIMEOUT_MS = 20_000;
// 表格内容区宽度（DXA，约等于 A4 页边距内可用宽）
const TABLE_WIDTH_DXA = 9026;
// 对齐页面正文约 11pt；Word size 单位为 half-points，故 22 = 11pt
const BODY_SIZE = 22;
// 对齐页面 line-height: 1.9（240 = 单倍行距，456 ≈ 1.9 倍）
const BODY_LINE = 456;
// 列表每层缩进（twip）；约等于页面 padding-left 1.5em
const LIST_INDENT = 480;
// 表格边框：可见细线（size 单位为 1/8 pt，8 = 1pt）
const TABLE_BORDER: IBorderOptions = {
	// 单实线样式
	style: BorderStyle.SINGLE,
	// 粗细 1/8 pt × 8 = 1pt
	size: 8,
	// 浅灰色，接近页面预览
	color: 'BFBFBF',
};
// 代码块无可见边框（靠底色区分）
const CODE_BORDER: IBorderOptions = {
	// 无边框样式
	style: BorderStyle.NONE,
	// 粗细 0
	size: 0,
	// 白色（占位）
	color: 'FFFFFF',
};
// 对齐页面 .tiptap pre { padding: 0.75em 1em }（约 14px 字号 → px×15≈twip）。
// 水平用段落 indent（各端 Word/WPS 都认）；垂直用空段撑开。
// ponytail: 不依赖 tcMar——部分客户端会忽略单元格边距，看起来贴左边。
// 代码块水平内边距（twip），左右各一份
const CODE_PAD_H = 210;
// 代码块垂直内边距所用的空段行高（twip），上下各撑一段
const CODE_PAD_V_LINE = 200;
// 代码块底色（浅灰，接近页面预览）
const CODE_BG = 'F3F3F3';
// DOCX 块级子元素便捷类型：段落或表格
type DocxChild = Paragraph | Table;
```

**变更摘要**：纯新增导出/模块常量与 `DocxChild` 类型，集中定义容量上限与视觉参数。

### 4.2 `clip`（`apps/backend/src/services/learning-notes/learning-note-docx.builder.ts`）

`clip` 是一个极简的文本截断工具：超出 `max` 长度时截断并追加 `…`，用于标题、段落文本、代码块文本的兜底防溢出。

**改动后** · `apps/backend/src/services/learning-notes/learning-note-docx.builder.ts`（当前，约 L77–L80）

```typescript
// 截断函数：空串直接返回空；超长则截断并加省略号
function clip(s: string, max: number): string {
	// 空值短路
	if (!s) return '';
	// 未超长原样返回，超长截断并补省略号
	return s.length <= max ? s : `${s.slice(0, max)}…`;
}
```

**变更摘要**：纯新增通用截断工具。

### 4.3 `decodeEntities`（`apps/backend/src/services/learning-notes/learning-note-docx.builder.ts`）

`decodeEntities` 把 HTML 实体（`&nbsp;` / `&amp;` / `&lt;` / `&gt;` / `&quot;` / `&#39;` / 数字 `&#NN;` / 十六进制 `&#xHH;`）还原为字符。因为不依赖 DOM 解析器，文本节点需手动反转义。

**改动后** · `apps/backend/src/services/learning-notes/learning-note-docx.builder.ts`（当前，约 L82–L94）

```typescript
// HTML 实体反转义：覆盖命名实体与数字/十六进制实体
function decodeEntities(s: string): string {
	// 链式 replace 依次处理各类实体
	return s
		// 非断空格 → 普通空格
		.replace(/&nbsp;/gi, ' ')
		// & → &
		.replace(/&amp;/gi, '&')
		// < → <
		.replace(/&lt;/gi, '<')
		// > → >
		.replace(/&gt;/gi, '>')
		// " → "
		.replace(/&quot;/gi, '"')
		// ' → '
		.replace(/&#39;/gi, "'")
		// 数字实体 &#NN; → 对应字符
		.replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
		// 十六进制实体 &#xHH; → 对应字符
		.replace(/&#x([0-9a-f]+);/gi, (_, h) =>
			String.fromCharCode(Number.parseInt(h, 16)),
		);
}
```

**变更摘要**：纯新增实体反转义，支持命名/数字/十六进制三类。

### 4.4 `parseAttrs`（`apps/backend/src/services/learning-notes/learning-note-docx.builder.ts`）

`parseAttrs` 从一段标签原始文本（`<tag a="1" b='2' c=3>` 中 `tag` 之后的部分）解析出属性字典，键统一小写，值经 `decodeEntities` 反转义。兼容双引号、单引号、无引号三种写法，且属性名支持 `:@` 前缀（如 `data-*` / `@click` / `:prop`）。

**改动后** · `apps/backend/src/services/learning-notes/learning-note-docx.builder.ts`（当前，约 L96–L104）

```typescript
// 解析标签属性字符串为键值字典
function parseAttrs(raw: string): Record<string, string> {
	// 结果字典
	const attrs: Record<string, string> = {};
	// 正则：属性名（含 data-/@/:）= 值（双引号/单引号/无引号三选一）
	const re = /([:@\w.-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/g;
	// 匹配游标
	let m: RegExpExecArray | null;
	// 循环匹配所有属性
	while ((m = re.exec(raw)) !== null) {
		// 键小写，值取三组捕获之一并反转义实体
		attrs[m[1].toLowerCase()] = decodeEntities(m[2] ?? m[3] ?? m[4] ?? '');
	}
	// 返回属性字典
	return attrs;
}
```

**变更摘要**：纯新增属性解析器，兼容三种引号与 `data-/@/:` 前缀。

### 4.5 `styleMap`（`apps/backend/src/services/learning-notes/learning-note-docx.builder.ts`）

`styleMap` 把 `style="color:red; text-align:center"` 形式的内联 CSS 字符串解析为 `{ color: 'red', 'text-align': 'center' }` 字典，键小写、值 trim。空串返回空对象。

**改动后** · `apps/backend/src/services/learning-notes/learning-note-docx.builder.ts`（当前，约 L106–L117）

```typescript
// 内联 style 字符串解析为 CSS 属性字典
function styleMap(style: string | undefined): Record<string, string> {
	// 结果字典
	const out: Record<string, string> = {};
	// 空 style 直接返回空字典
	if (!style) return out;
	// 按 ; 分割多条声明
	for (const part of style.split(';')) {
		// 找 key:value 的冒号位置
		const i = part.indexOf(':');
		// 无冒号则跳过
		if (i < 0) continue;
		// 键 trim + 小写
		const k = part.slice(0, i).trim().toLowerCase();
		// 值 trim
		const v = part.slice(i + 1).trim();
		// 有键才写入
		if (k) out[k] = v;
	}
	// 返回 CSS 字典
	return out;
}
```

**变更摘要**：纯新增内联 CSS 解析器。

### 4.6 `cssColorToHex`（`apps/backend/src/services/learning-notes/learning-note-docx.builder.ts`）

`cssColorToHex` 把 CSS 颜色（`#rgb` / `#rrggbb` / `#rrggbbaa` / `rgb()` / `rgba()`）统一转为 6 位大写十六进制（`RRGGBB`），alpha 丢弃（Word 颜色不支持 alpha）。无法识别返回 `undefined`。

**改动后** · `apps/backend/src/services/learning-notes/learning-note-docx.builder.ts`（当前，约 L119–L138）

```typescript
// CSS 颜色字符串转 6 位大写 HEX（alpha 丢弃）
function cssColorToHex(input: string | undefined): string | undefined {
	// 空输入返回 undefined
	if (!input) return undefined;
	// trim + 小写
	const s = input.trim().toLowerCase();
	// 匹配 #RGB / #RRGGBB / #RRGGBBAA
	const hex = /^#([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i.exec(s);
	// 命中 HEX 分支
	if (hex) {
		// 取捕获组
		const h = hex[1];
		// 3 位短色展开为 6 位
		if (h.length === 3)
			return `${h[0]}${h[0]}${h[1]}${h[1]}${h[2]}${h[2]}`.toUpperCase();
		// 6/8 位取前 6 位（丢 alpha）转大写
		return h.slice(0, 6).toUpperCase();
	}
	// 匹配 rgb()/rgba() 前 3 个分量
	const rgb = /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/i.exec(s);
	// 命中 RGB 分支
	if (rgb) {
		// 分量转 0-255 内 2 位 hex 的辅助
		const to = (n: string) =>
			Math.max(0, Math.min(255, Number(n)))
				.toString(16)
				.padStart(2, '0');
		// 拼成 RRGGBB 大写
		return `${to(rgb[1])}${to(rgb[2])}${to(rgb[3])}`.toUpperCase();
	}
	// 无法识别
	return undefined;
}
```

**变更摘要**：纯新增颜色归一化器，覆盖 HEX 与 RGB 两种输入。

### 4.7 `readAlign`（`apps/backend/src/services/learning-notes/learning-note-docx.builder.ts`）

`readAlign` 从元素属性（`style` 的 `text-align` 或 `align` 属性）读取对齐方式，映射为 `docx` 的 `AlignmentType` 枚举。无法识别返回 `undefined`（让段落用默认对齐）。

**改动后** · `apps/backend/src/services/learning-notes/learning-note-docx.builder.ts`（当前，约 L140–L150）

```typescript
// 从属性读取对齐方式，映射为 docx AlignmentType
function readAlign(
	attrs: Record<string, string>,
): (typeof AlignmentType)[keyof typeof AlignmentType] | undefined {
	// 先看 style 里的 text-align，再看 align 属性，取小写
	const styles = styleMap(attrs.style);
	const align = (styles['text-align'] || attrs.align || '').toLowerCase();
	// 居中
	if (align === 'center') return AlignmentType.CENTER;
	// 右对齐（兼容 end）
	if (align === 'right' || align === 'end') return AlignmentType.RIGHT;
	// 两端对齐（兼容 both）
	if (align === 'justify' || align === 'both') return AlignmentType.JUSTIFIED;
	// 左对齐（兼容 start）
	if (align === 'left' || align === 'start') return AlignmentType.LEFT;
	// 未识别
	return undefined;
}
```

**变更摘要**：纯新增对齐读取器，兼容 `text-align` 与 `align` 两套来源。

### 4.8 `parseDataUrl`（`apps/backend/src/services/learning-notes/learning-note-docx.builder.ts`）

`parseDataUrl` 解析 `data:image/png;base64,xxxx` 形式的 data URL，返回 `{ mime, buf }`。仅接受 `;base64` 编码（非 base64 的 data URL 不处理），解析失败或空 buf 返回 `null`。

**改动后** · `apps/backend/src/services/learning-notes/learning-note-docx.builder.ts`（当前，约 L279–L292）

```typescript
// 解析 data: URL 为 { mime, buf }，仅接受 base64 编码
function parseDataUrl(src: string): { mime: string; buf: Buffer } | null {
	// 正则：data:<mime>[;params];base64,<data>
	const m =
		/^data:(image\/[a-z0-9.+-]+)((?:;[\w.=+-]+)*)?(;base64),([\s\S]+)$/i.exec(
			src.trim(),
		);
	// 必须含 ;base64 捕获组，否则不处理
	if (!m?.[3]) return null;
	// 尝试解码
	try {
		// 去掉空白后 base64 解码为 Buffer
		const buf = Buffer.from(m[4].replace(/\s+/g, ''), 'base64');
		// 空 buf 视为无效
		if (!buf.length) return null;
		// 返回 mime（小写）与 buf
		return { mime: m[1].toLowerCase(), buf };
	} catch {
		// 解码异常返回 null
		return null;
	}
}
```

**变更摘要**：纯新增 data URL 解析器，仅放行 base64 编码。

### 4.9 `fetchRemoteImage`（`apps/backend/src/services/learning-notes/learning-note-docx.builder.ts`）

`fetchRemoteImage` 用 `fetch` 拉取远程 http(s) 图片，带 `FETCH_TIMEOUT_MS` 超时（`AbortController`）与 `image/*` Accept 头。返回 `{ mime, buf }`，任何失败（非 http(s)、非 2xx、超时、空 body）都返回 `null`，不抛错。

**改动后** · `apps/backend/src/services/learning-notes/learning-note-docx.builder.ts`（当前，约 L294–L324）

```typescript
// 远程拉取图片，超时/失败统一返回 null
async function fetchRemoteImage(
	url: string,
): Promise<{ mime: string; buf: Buffer } | null> {
	// URL 变量
	let parsed: URL;
	// 尝试解析 URL
	try {
		// 构造 URL 对象，非法则进 catch
		parsed = new URL(url);
	} catch {
		// 非法 URL 直接返回 null
		return null;
	}
	// 仅允许 http/https 协议
	if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
	// 超时控制器
	const ac = new AbortController();
	// 设定超时定时器，到点 abort
	const timer = setTimeout(() => ac.abort(), FETCH_TIMEOUT_MS);
	// 主逻辑放 try
	try {
		// 发起 fetch，带 abort 信号、跟随重定向、图片 Accept 头
		const res = await fetch(url, {
			signal: ac.signal,
			redirect: 'follow',
			headers: { Accept: 'image/*,*/*;q=0.8' },
		});
		// 非 2xx 视为失败
		if (!res.ok) return null;
		// 从 content-type 取 mime，去掉 ; 参数，缺省用 octet-stream
		const mime =
			(res.headers.get('content-type') || '').split(';')[0].trim() ||
			'application/octet-stream';
		// 读取 body 为 Buffer
		const buf = Buffer.from(await res.arrayBuffer());
		// 空 body 视为失败
		if (!buf.length) return null;
		// 返回 mime 与 buf
		return { mime, buf };
	} catch {
		// 任何异常（含超时 abort）返回 null
		return null;
	} finally {
		// 无论成功失败都清掉定时器
		clearTimeout(timer);
	}
}
```

**变更摘要**：纯新增远程图片拉取器，带超时与协议白名单。

### 4.10 `extractUploadPublicPath`（`apps/backend/src/services/learning-notes/learning-note-docx.builder.ts`）

`extractUploadPublicPath` 从绝对/相对 URL 中抽出本机 uploads 公开路径（`/images|files|remotes/...` 或 `/upload/serve?path=...`）。生产机自拉公网常因 hairpin/反代失败，优先读盘比 fetch 稳，所以需要先把各类 URL 归一为本机公开路径再交给 `resolveUploadPublicPathToAbsolute`。无法识别返回 `null`。

**改动后** · `apps/backend/src/services/learning-notes/learning-note-docx.builder.ts`（当前，约 L326–L364）

```typescript
// 扩展名 → mime 映射表，本机读盘时按扩展名兜底 mime
const MIME_BY_EXT: Record<string, string> = {
	// jpg
	'.jpg': 'image/jpeg',
	// jpeg
	'.jpeg': 'image/jpeg',
	// png
	'.png': 'image/png',
	// gif
	'.gif': 'image/gif',
	// webp
	'.webp': 'image/webp',
	// bmp
	'.bmp': 'image/bmp',
};
// 从绝对/相对 URL 抽出本机 uploads 公开路径（/images|files|remotes/...）。
// 生产机自拉公网常因 hairpin/反代失败；优先读盘比 fetch 稳。
function extractUploadPublicPath(src: string): string | null {
	// trim 源
	const trimmed = src.trim();
	// 空串直接 null
	if (!trimmed) return null;
	// 主逻辑放 try
	try {
		// 若是 http(s) 开头按绝对 URL 解析，否则用 invalid 主机拼成 URL 解析 pathname
		const asUrl = /^https?:\/\//i.test(trimmed)
			? new URL(trimmed)
			: new URL(trimmed, 'http://local.invalid');
		// 若 pathname 是 /upload/serve 或 /api/upload/serve，取 query 的 path 参数
		const servePath =
			/\/upload\/serve\/?$/i.test(asUrl.pathname) ||
			/\/api\/upload\/serve\/?$/i.test(asUrl.pathname)
				? asUrl.searchParams.get('path')
				: null;
		// servePath 非空则解码返回
		if (servePath?.trim()) {
			return decodeUploadPublicPath(servePath);
		}
		// pathname 以 /images|files|remotes/ 开头则直接作为公开路径解码
		if (/^\/(images|files|remotes)\//.test(asUrl.pathname)) {
			return decodeUploadPublicPath(asUrl.pathname);
		}
	} catch {
		// 解析失败 fall through 到下面的相对路径兜底
		/* fall through */
	}
	// 兜底：去掉 query 后看是否以 /images|files|remotes/ 开头
	if (/^\/(images|files|remotes)\//.test(trimmed.split('?')[0])) {
		return decodeUploadPublicPath(trimmed.split('?')[0]);
	}
	// 都不匹配返回 null
	return null;
}
```

**变更摘要**：纯新增公开路径抽取器，覆盖 `/upload/serve?path=` 与 `/images|files|remotes/` 两类形态，附 `MIME_BY_EXT` 扩展名映射。

### 4.11 `tryReadLocalUpload`（`apps/backend/src/services/learning-notes/learning-note-docx.builder.ts`）

`tryReadLocalUpload` 尝试把 `src` 当作本机 uploads 路径读盘：先 `extractUploadPublicPath` 抽公开路径，再 `resolveUploadPublicPathToAbsolute` 转绝对路径，`existsSync` + `readFile` 读取，mime 按扩展名从 `MIME_BY_EXT` 兜底。任何环节失败返回 `null`。`node:fs` 等模块用动态 `import` 懒加载，避免在纯计算路径上强耦合。

**改动后** · `apps/backend/src/services/learning-notes/learning-note-docx.builder.ts`（当前，约 L366–L385）

```typescript
// 尝试把 src 当作本机 uploads 路径读盘
async function tryReadLocalUpload(
	src: string,
): Promise<{ mime: string; buf: Buffer } | null> {
	// 先抽出公开路径
	const publicPath = extractUploadPublicPath(src);
	// 抽不出则返回 null
	if (!publicPath) return null;
	// 读盘逻辑放 try
	try {
		// 懒加载 fs 的 existsSync
		const { existsSync } = await import('node:fs');
		// 懒加载 fs/promises 的 readFile
		const { readFile } = await import('node:fs/promises');
		// 懒加载 path 的 extname
		const { extname } = await import('node:path');
		// 公开路径转绝对路径
		const abs = resolveUploadPublicPathToAbsolute(publicPath);
		// 文件不存在返回 null
		if (!existsSync(abs)) return null;
		// 读取文件为 Buffer
		const buf = await readFile(abs);
		// 空 buf 返回 null
		if (!buf.length) return null;
		// 按扩展名取 mime，缺省 octet-stream
		const mime =
			MIME_BY_EXT[extname(abs).toLowerCase()] ?? 'application/octet-stream';
		// 返回 mime 与 buf
		return { mime, buf };
	} catch {
		// 任何读盘异常返回 null
		return null;
	}
}
```

**变更摘要**：纯新增本机读盘器，懒加载 Node 模块，按扩展名兜底 mime。

### 4.12 `loadImageBytes`（`apps/backend/src/services/learning-notes/learning-note-docx.builder.ts`）

`loadImageBytes` 是图片加载的统一入口，按优先级依次尝试：data URL → 本机 uploads → 远程 http(s)。任一环节成功即返回，全部失败返回 `null`。

**改动后** · `apps/backend/src/services/learning-notes/learning-note-docx.builder.ts`（当前，约 L387–L395）

```typescript
// 图片加载统一入口：data URL → 本机 → 远程
async function loadImageBytes(
	src: string,
): Promise<{ mime: string; buf: Buffer } | null> {
	// data: 开头走 parseDataUrl
	if (/^data:/i.test(src)) return parseDataUrl(src);
	// 否则先试本机读盘
	const local = await tryReadLocalUpload(src);
	// 本机命中直接返回
	if (local) return local;
	// http(s) 开头走远程拉取
	if (/^https?:\/\//i.test(src)) return fetchRemoteImage(src);
	// 三源都未命中返回 null
	return null;
}
```

**变更摘要**：纯新增图片加载统一入口，三源按优先级回退。

### 4.13 `mimeToType` / `sniffType`（`apps/backend/src/services/learning-notes/learning-note-docx.builder.ts`）

`mimeToType` 按 mime 字符串判定图片类型，`sniffType` 按文件头魔数（magic bytes）判定。两者互补：mime 不可信时用文件头兜底。返回值统一为 `ImgType | 'webp' | null`，其中 `ImgType = 'jpg' | 'png' | 'gif' | 'bmp'` 是 Word 原生支持的四种。`null` 表示完全无法识别。

**改动后** · `apps/backend/src/services/learning-notes/learning-note-docx.builder.ts`（当前，约 L152–L177）

```typescript
// Word 原生支持的四种图片类型
type ImgType = 'jpg' | 'png' | 'gif' | 'bmp';
// 按 mime 字符串判定图片类型
function mimeToType(mime: string): ImgType | 'webp' | null {
	// mime 转小写
	const m = mime.toLowerCase();
	// 含 png
	if (m.includes('png')) return 'png';
	// 含 jpeg/jpg
	if (m.includes('jpeg') || m.includes('jpg')) return 'jpg';
	// 含 gif
	if (m.includes('gif')) return 'gif';
	// 含 bmp
	if (m.includes('bmp')) return 'bmp';
	// 含 webp
	if (m.includes('webp')) return 'webp';
	// 无法识别
	return null;
}
// 按文件头魔数判定图片类型
function sniffType(buf: Buffer): ImgType | 'webp' | null {
	// JPEG：FF D8 FF
	if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff)
		return 'jpg';
	// PNG：89 50
	if (buf.length >= 8 && buf[0] === 0x89 && buf[1] === 0x50) return 'png';
	// GIF：47 49
	if (buf.length >= 6 && buf[0] === 0x47 && buf[1] === 0x49) return 'gif';
	// BMP：42 4D
	if (buf.length >= 2 && buf[0] === 0x42 && buf[1] === 0x4d) return 'bmp';
	// WEBP：RIFF....WEBP
	if (
		buf.length >= 12 &&
		buf.toString('ascii', 0, 4) === 'RIFF' &&
		buf.toString('ascii', 8, 12) === 'WEBP'
	)
		return 'webp';
	// 无法识别
	return null;
}
```

**变更摘要**：纯新增双路类型判定器（mime + 魔数），互补兜底。

### 4.14 `imageSize` / `scaleSize`（`apps/backend/src/services/learning-notes/learning-note-docx.builder.ts`）

本节包含图片尺寸解析与缩放。`pngSize` / `jpegSize` / `gifSize` / `webpSize` 分别从对应格式文件头读宽高（带 20000 上限防异常值）。`imageSize` 按 `kind` 分派，失败回退到默认 4:3 尺寸。`scaleSize` 把宽高按 `IMAGE_MAX_WIDTH_PX` 等比缩放，保证不超宽。

**改动后** · `apps/backend/src/services/learning-notes/learning-note-docx.builder.ts`（当前，约 L179–L263）

```typescript
// 读 PNG IHDR 宽高
function pngSize(buf: Buffer): { w: number; h: number } | null {
	// 至少 24 字节且首字节 0x89
	if (buf.length < 24 || buf[0] !== 0x89) return null;
	// IHDR 宽在 16、高在 20（大端 uint32）
	const w = buf.readUInt32BE(16);
	const h = buf.readUInt32BE(20);
	// 校验非 0 且不超 20000
	if (!w || !h || w > 20_000 || h > 20_000) return null;
	return { w, h };
}
// 读 JPEG 各 SOFn marker 的宽高
function jpegSize(buf: Buffer): { w: number; h: number } | null {
	// 至少 4 字节且头两字节 FF D8
	if (buf.length < 4 || buf[0] !== 0xff || buf[1] !== 0xd8) return null;
	// 从偏移 2 开始扫 marker
	let i = 2;
	// 边界检查
	while (i + 9 < buf.length) {
		// 非 FF 前缀跳过
		if (buf[i] !== 0xff) {
			i += 1;
			continue;
		}
		// 取 marker
		const marker = buf[i + 1];
		// EOI(0xD9)/SOS(0xDA) 表示进入扫描数据，停止
		if (marker === 0xd9 || marker === 0xda) break;
		// 读 marker 段长度
		const len = buf.readUInt16BE(i + 2);
		// 长度异常停止
		if (len < 2) break;
		// SOFn 系列 marker 携带宽高
		if (
			(marker >= 0xc0 && marker <= 0xc3) ||
			(marker >= 0xc5 && marker <= 0xc7) ||
			(marker >= 0xc9 && marker <= 0xcb) ||
			(marker >= 0xcd && marker <= 0xcf)
		) {
			// 高在 i+5、宽在 i+7（大端 uint16）
			const h = buf.readUInt16BE(i + 5);
			const w = buf.readUInt16BE(i + 7);
			// 校验后返回
			if (w && h && w <= 20_000 && h <= 20_000) return { w, h };
			return null;
		}
		// 跳到下一段
		i += 2 + len;
	}
	return null;
}
// 读 GIF 逻辑屏幕描述符宽高
function gifSize(buf: Buffer): { w: number; h: number } | null {
	// 至少 10 字节且头三字节 GIF
	if (buf.length < 10 || buf.toString('ascii', 0, 3) !== 'GIF') return null;
	// 宽在 6、高在 8（小端 uint16）
	const w = buf.readUInt16LE(6);
	const h = buf.readUInt16LE(8);
	// 校验
	if (!w || !h || w > 20_000 || h > 20_000) return null;
	return { w, h };
}
// 读 WEBP（VP8X/VP8）宽高
function webpSize(buf: Buffer): { w: number; h: number } | null {
	// 至少 30 字节且 RIFF 头
	if (buf.length < 30 || buf.toString('ascii', 0, 4) !== 'RIFF') return null;
	// 校验 WEBP 标识
	if (buf.toString('ascii', 8, 12) !== 'WEBP') return null;
	// chunk 类型
	const chunk = buf.toString('ascii', 12, 16);
	// VP8X（扩展/动画）宽高 24 位 +1
	if (chunk === 'VP8X' && buf.length >= 30) {
		const w = 1 + buf[24] + (buf[25] << 8) + (buf[26] << 16);
		const h = 1 + buf[27] + (buf[28] << 8) + (buf[29] << 16);
		if (w && h && w <= 20_000 && h <= 20_000) return { w, h };
	}
	// VP8（有损）宽高 14 位
	if (chunk === 'VP8 ' && buf.length >= 30) {
		const w = buf.readUInt16LE(26) & 0x3fff;
		const h = buf.readUInt16LE(28) & 0x3fff;
		if (w && h) return { w, h };
	}
	return null;
}
// 按 kind 分派尺寸解析，失败回退默认 4:3
function imageSize(
	buf: Buffer,
	kind: ImgType | 'webp',
): { w: number; h: number } {
	// 按 kind 选解析器
	const dim =
		kind === 'png'
			? pngSize(buf)
			: kind === 'jpg'
				? jpegSize(buf)
				: kind === 'gif'
					? gifSize(buf)
					: kind === 'webp'
						? webpSize(buf)
						: null;
	// 失败回退到 IMAGE_MAX_WIDTH_PX × 0.75 的默认尺寸
	return (
		dim ?? { w: IMAGE_MAX_WIDTH_PX, h: Math.round(IMAGE_MAX_WIDTH_PX * 0.75) }
	);
}
// 等比缩放，保证宽不超过 IMAGE_MAX_WIDTH_PX
function scaleSize(w: number, h: number): { width: number; height: number } {
	// 未超宽原样返回（高度至少 1）
	if (w <= IMAGE_MAX_WIDTH_PX) return { width: w, height: Math.max(1, h) };
	// 超宽按比例缩高
	const height = Math.max(1, Math.round((h * IMAGE_MAX_WIDTH_PX) / w));
	// 返回缩放后尺寸
	return { width: IMAGE_MAX_WIDTH_PX, height };
}
```

**变更摘要**：纯新增四种格式尺寸解析 + 统一分派 + 等比缩放。

### 4.15 `rasterToJpeg`（`apps/backend/src/services/learning-notes/learning-note-docx.builder.ts`）

`rasterToJpeg` 把非 Word 原生格式（webp/avif/heic 等）转 JPEG。优先用 sharp（懒加载 `require`，避免启动路径耦合；sharp 需 ≤0.33.x 支持 Node 18），sharp 不可用或失败时回退 macOS `sips`（仅本机开发兜底）。两路都失败返回 `null`。

**改动后** · `apps/backend/src/services/learning-notes/learning-note-docx.builder.ts`（当前，约 L397–L454）

```typescript
// Word 只稳吃 jpg/png/gif/bmp。webp/avif/heic 等经 sharp 转 JPEG。
// 懒加载 sharp：不能顶层 require——生产 Node18 装错版本时会拖垮整个进程。
// sharp 需 ≤0.33.x（支持 Node 18）；0.35+ 要求 Node ≥20.9。
async function rasterToJpeg(buf: Buffer): Promise<Buffer | null> {
	// sharp 路径放 try
	try {
		// ponytail: 延迟 require，启动路径与 sharp 解耦
		const mod = require('sharp') as
			| ((input: Buffer) => {
					rotate: () => {
						jpeg: (o: { quality: number }) => {
							toBuffer: () => Promise<Buffer>;
						};
					};
			  })
			| {
					default: (input: Buffer) => {
						rotate: () => {
							jpeg: (o: { quality: number }) => {
								toBuffer: () => Promise<Buffer>;
							};
						};
					};
			  };
		// 兼容 default 导出
		const sharpFn = typeof mod === 'function' ? mod : mod.default;
		// 非函数则抛错进 catch
		if (typeof sharpFn !== 'function') throw new Error('sharp unavailable');
		// 旋转校正 + 转 JPEG quality 90 + 输出 Buffer
		return await sharpFn(buf).rotate().jpeg({ quality: 90 }).toBuffer();
	} catch {
		// sharp 失败 fall through 到 sips（仅 macOS 本机开发兜底）
		/* fall through to sips（仅 macOS 本机开发兜底） */
	}
	// sips 路径放 try
	try {
		// 懒加载 fs/promises 的 mkdtemp/writeFile/readFile/rm
		const { mkdtemp, writeFile, readFile, rm } = await import(
			'node:fs/promises'
		);
		// 临时目录
		const { tmpdir } = await import('node:os');
		// 路径拼接
		const { join } = await import('node:path');
		// 执行子进程
		const { execFile } = await import('node:child_process');
		// promisify
		const { promisify } = await import('node:util');
		// 异步执行 sips
		const execFileAsync = promisify(execFile);
		// 建临时目录
		const dir = await mkdtemp(join(tmpdir(), 'note-img-'));
		// 输入文件路径
		const inPath = join(dir, 'in.bin');
		// 输出文件路径
		const outPath = join(dir, 'out.jpg');
		// 内层 try/finally 保证清理
		try {
			// 写入待转换 buffer
			await writeFile(inPath, buf);
			// 调 sips 转 jpeg，15s 超时
			await execFileAsync(
				'sips',
				['-s', 'format', 'jpeg', inPath, '--out', outPath],
				{ timeout: 15_000 },
			);
			// 读回结果
			return await readFile(outPath);
		} finally {
			// 无论成功失败递归删临时目录，错误吞掉
			await rm(dir, { recursive: true, force: true }).catch(() => undefined);
		}
	} catch {
		// sips 也失败返回 null
		return null;
	}
}
```

**变更摘要**：纯新增栅格转 JPEG 工具，sharp 懒加载 + sips 兜底双路。

### 4.16 `docxNativeKind`（`apps/backend/src/services/learning-notes/learning-note-docx.builder.ts`）

`docxNativeKind` 综合判定一张图能否被 Word 直接吃下：先 `mimeToType` 看 mime，再 `sniffType` 看文件头；都不在原生四种内但 mime 是 `image/*`（avif/heic/svg 等）则标 `'foreign'`（交 sharp 转）；完全不是图片返回 `null`。

**改动后** · `apps/backend/src/services/learning-notes/learning-note-docx.builder.ts`（当前，约 L456–L467）

```typescript
// 判定图片是否 Word 原生，否则标 foreign 交 sharp
function docxNativeKind(
	mime: string,
	buf: Buffer,
): ImgType | 'webp' | 'foreign' | null {
	// 先按 mime 判
	const fromMime = mimeToType(mime);
	// mime 命中直接返回
	if (fromMime) return fromMime;
	// mime 没命中按文件头判
	const sniffed = sniffType(buf);
	// 文件头命中直接返回
	if (sniffed) return sniffed;
	// image/* 但 Word 不认（avif/heic/svg…）→ 交 sharp
	if (mime.startsWith('image/')) return 'foreign';
	// 完全不是图片
	return null;
}
```

**变更摘要**：纯新增原生类型判定器，三段式 mime → 嗅探 → foreign。

### 4.17 `ImageBudget` + `skipImage`（`apps/backend/src/services/learning-notes/learning-note-docx.builder.ts`）

`ImageBudget` 是图片资源预算记账对象：`count` 已嵌入数、`bytes` 已嵌入字节、`skipped` 跳过数、`reasons` 跳过原因（最多 6 条，用于页脚排查）。`skipImage` 是统一的跳过记账函数：`skipped` 自增、原因入队（封顶 6 条）、返回 `null` 给调用方作为「跳过」信号。

**改动后** · `apps/backend/src/services/learning-notes/learning-note-docx.builder.ts`（当前，约 L265–L277）

```typescript
// 图片资源预算记账类型
type ImageBudget = {
	// 已嵌入图片数
	count: number;
	// 已嵌入字节合计
	bytes: number;
	// 跳过图片数
	skipped: number;
	// 跳过原因（最多记几条，写入页脚便于线上排查）
	reasons: string[];
};
// 统一的跳过记账函数：自增 skipped、入队原因、返回 null
function skipImage(budget: ImageBudget, reason: string): null {
	// 跳过数自增
	budget.skipped += 1;
	// 原因封顶 6 条
	if (budget.reasons.length < 6) budget.reasons.push(reason);
	// 返回 null 表示跳过
	return null;
}
```

**变更摘要**：纯新增资源预算类型与跳过记账器。

### 4.18 `toDocxImage`（`apps/backend/src/services/learning-notes/learning-note-docx.builder.ts`）

`toDocxImage` 是单图嵌入全流程：超数量上限跳过 → 加载字节 → 判定原生类型 → 非原生转 JPEG → 超单图字节上限跳过 → 读尺寸 + 缩放 → 记账 → 构造 `ImageRun`。任一失败经 `skipImage` 记原因返回 `null`。

**改动后** · `apps/backend/src/services/learning-notes/learning-note-docx.builder.ts`（当前，约 L469–L505）

```typescript
// 单图嵌入全流程：加载→判型→转码→记账→构造 ImageRun
async function toDocxImage(
	src: string,
	budget: ImageBudget,
): Promise<ParagraphChild | null> {
	// 超图片数量上限直接跳过
	if (budget.count >= NOTE_DOCX_IMAGE_MAX_COUNT) {
		return skipImage(budget, '超过图片数量上限');
	}
	// 截前 48 字符做预览（用于错误原因）
	const preview = src.trim().slice(0, 48);
	// 统一入口加载图片字节
	const loaded = await loadImageBytes(src);
	// 加载失败跳过
	if (!loaded) {
		return skipImage(
			budget,
			`无法读取(${preview}${src.length > 48 ? '…' : ''})`,
		);
	}
	// 解构 mime 与 buf（后续可能被转码覆盖）
	let { mime, buf } = loaded;
	// 判定 Word 原生类型
	let kind = docxNativeKind(mime, buf);
	// 无法识别跳过
	if (!kind) {
		return skipImage(budget, `无法识别格式(${mime || 'unknown'})`);
	}
	// webp 或 foreign 需转 JPEG
	if (kind === 'webp' || kind === 'foreign') {
		// 调 sharp/sips 转 JPEG
		const jpeg = await rasterToJpeg(buf);
		// 转码失败跳过
		if (!jpeg) {
			return skipImage(budget, `转JPEG失败(${mime || kind})`);
		}
		// 用转码后的 buf
		buf = jpeg;
		// 类型改为 jpg
		kind = 'jpg';
	}
	// 超 15MB 单图上限跳过
	if (buf.length > 15_000_000) {
		return skipImage(budget, '单图过大');
	}
	// 读图片尺寸
	const dim = imageSize(buf, kind);
	// 等比缩放
	const transformation = scaleSize(dim.w, dim.h);
	// 记账：数量 +1
	budget.count += 1;
	// 记账：字节累加
	budget.bytes += buf.length;
	// 构造 ImageRun 并返回
	return new ImageRun({ type: kind, data: buf, transformation });
}
```

**变更摘要**：纯新增单图嵌入全流程，含上限/加载/转码/记账五段。

### 4.19 `InlineStyle` + `htmlToStyledRuns`（`apps/backend/src/services/learning-notes/learning-note-docx.builder.ts`）

`InlineStyle` 是行内样式状态机的状态对象（加粗/斜体/下划线/删除线/行内代码/颜色/高亮/链接/字号）。`htmlToStyledRuns` 是行内扫描核心：维护 `tagStack`（开标签栈）+ `stack`（`InlineStyle` 栈），逐字符扫描 HTML，遇文本节点 `pushText`，遇 `img` 切段，遇开标签按 tag 与 style 合并出新 `InlineStyle` 压栈，遇闭标签弹栈。输出 `runs` 段与 `img` 段交替序列。`OpenTag` 类型与 `mergeStyle` 辅助函数一并附上。

**改动后** · `apps/backend/src/services/learning-notes/learning-note-docx.builder.ts`（当前，约 L507–L810）

```typescript
// —— 富文本：行内样式 ——
// 行内样式状态：记录当前文本 run 的所有视觉属性
type InlineStyle = {
	// 加粗
	bold?: boolean;
	// 斜体
	italics?: boolean;
	// 下划线
	underline?: boolean;
	// 删除线
	strike?: boolean;
	// 行内代码
	code?: boolean;
	// 文字颜色（HEX）
	color?: string;
	// 高亮底色（HEX）
	highlight?: string;
	// 超链接 href
	href?: string;
	// Word half-points；未设则沿用正文默认
	size?: number;
};
// 开标签栈元素：标签名 + 属性
type OpenTag = { name: string; attrs: Record<string, string> };
// 把一段 HTML 转成带样式的 runs（遇 img 返回占位，由外层拆段）
function htmlToStyledRuns(
	html: string,
	baseStyle: InlineStyle = {},
): Array<
	{ type: 'runs'; children: ParagraphChild[] } | { type: 'img'; src: string }
> {
	// 输出段序列：runs 段或 img 段交替
	const segments: Array<
		{ type: 'runs'; children: ParagraphChild[] } | { type: 'img'; src: string }
	> = [];
	// 当前 runs 段累积区
	let current: ParagraphChild[] = [];
	// InlineStyle 栈，栈底是 baseStyle
	const stack: InlineStyle[] = [baseStyle];
	// 开标签栈
	const tagStack: OpenTag[] = [];
	// 把当前累积的 runs flush 成一段
	const flushRuns = () => {
		// 非空才 flush
		if (current.length) {
			// 推入 runs 段
			segments.push({ type: 'runs', children: current });
			// 清空累积区
			current = [];
		}
	};
	// 取栈顶当前样式
	const styleNow = () => stack[stack.length - 1] ?? {};
	// 扫描游标
	let i = 0;
	// 主循环：逐字符扫
	while (i < html.length) {
		// 非 < 开头是文本节点
		if (html[i] !== '<') {
			// 找下一个 <
			const next = html.indexOf('<', i);
			// 取文本片段
			const raw = next < 0 ? html.slice(i) : html.slice(i, next);
			// 反转义后作为文本 run 推入当前段
			pushText(current, decodeEntities(raw), styleNow());
			// 推进游标
			i = next < 0 ? html.length : next;
			continue;
		}
		// 找 > 闭合
		const end = html.indexOf('>', i);
		// 无闭合直接结束
		if (end < 0) break;
		// 取标签原始文本（去掉 < >）
		const rawTag = html.slice(i + 1, end);
		// 游标越过 >
		i = end + 1;
		// 注释跳过
		if (rawTag.startsWith('!--')) continue;
		// 自闭合标志
		const selfClosing = rawTag.endsWith('/');
		// 去掉结尾 / 后的标签体
		const body = selfClosing ? rawTag.slice(0, -1).trim() : rawTag.trim();
		// 空体跳过
		if (!body) continue;
		// 闭标签分支
		if (body.startsWith('/')) {
			// 取闭标签名
			const name = body.slice(1).trim().toLowerCase().split(/\s+/)[0];
			// 弹栈直到匹配的同名开标签（容忍未配对）
			while (tagStack.length) {
				const top = tagStack.pop()!;
				stack.pop();
				if (top.name === name) break;
			}
			continue;
		}
		// 取开标签名
		const nameMatch = /^([a-z0-9-]+)/i.exec(body);
		// 无名跳过
		if (!nameMatch) continue;
		// 标签名小写
		const name = nameMatch[1].toLowerCase();
		// 解析属性
		const attrs = parseAttrs(body.slice(nameMatch[0].length));
		// <br> 推一个换行文本
		if (name === 'br') {
			pushText(current, '\n', styleNow());
			continue;
		}
		// <img> flush 当前段后推一个 img 段
		if (name === 'img') {
			const src = attrs.src?.trim();
			if (src) {
				flushRuns();
				segments.push({ type: 'img', src });
			}
			continue;
		}
		// <hr> 行内扫描阶段忽略（由块级处理）
		if (name === 'hr') continue;
		// HTML void 元素集合
		const voidTags = new Set([
			'area',
			'base',
			'col',
			'embed',
			'input',
			'link',
			'meta',
			'param',
			'source',
			'track',
			'wbr',
		]);
		// 自闭合或 void 元素不压栈
		if (selfClosing || voidTags.has(name)) continue;
		// 取上一层样式作为基底
		const prev = styleNow();
		// 复制一份作为新层
		const next = { ...prev };
		// 解析 style 属性
		const styles = styleMap(attrs.style);
		// strong/b → 加粗
		if (name === 'strong' || name === 'b') next.bold = true;
		// em/i → 斜体
		if (name === 'em' || name === 'i') next.italics = true;
		// u → 下划线
		if (name === 'u') next.underline = true;
		// s/del/strike → 删除线
		if (name === 's' || name === 'del' || name === 'strike') next.strike = true;
		// code → 行内代码
		if (name === 'code') next.code = true;
		// mark → 高亮，优先 data-color，其次 background-color，缺省黄色
		if (name === 'mark') {
			next.highlight =
				cssColorToHex(attrs['data-color']) ||
				cssColorToHex(styles['background-color']) ||
				'FFEB3B';
		}
		// a → 链接 + 下划线
		if (name === 'a' && attrs.href) {
			next.href = attrs.href;
			next.underline = true;
		}
		// style.color → 文字颜色
		if (styles.color) {
			const c = cssColorToHex(styles.color);
			if (c) next.color = c;
		}
		// style.background-color（非 mark）→ 高亮
		if (styles['background-color'] && name !== 'mark') {
			const h = cssColorToHex(styles['background-color']);
			if (h) next.highlight = h;
		}
		// span 上的 text-decoration
		const deco = (styles['text-decoration'] || '').toLowerCase();
		// underline
		if (deco.includes('underline')) next.underline = true;
		// line-through
		if (deco.includes('line-through')) next.strike = true;
		// font-weight
		const weight = (styles['font-weight'] || '').toLowerCase();
		// bold 或 ≥600
		if (weight === 'bold' || Number(weight) >= 600) next.bold = true;
		// font-style
		const fs = (styles['font-style'] || '').toLowerCase();
		// italic
		if (fs === 'italic') next.italics = true;
		// 开标签入栈
		tagStack.push({ name, attrs });
		// 合并后的新样式入栈
		stack.push(mergeStyle(prev, next));
	}
	// 收尾 flush 残留 runs
	flushRuns();
	// 返回段序列
	return segments;
}
```

**变更摘要**：纯新增行内样式状态机，输出 runs/img 交替段；`mergeStyle` 一并附上（见 §4.21）。

### 4.20 `BlockVisual` + `blockVisual`（`apps/backend/src/services/learning-notes/learning-note-docx.builder.ts`）

`BlockVisual` 描述块级元素的视觉参数（spacing/indent/border/baseRun）。`blockVisual` 按 tag 返回对应视觉：h1–h6 各自有字号/行距/颜色（不蓝）、blockquote 带左边框与灰字、其他用 body 默认行距。baseRun 让段落内的 `TextRun` 继承块级字体属性。

**改动后** · `apps/backend/src/services/learning-notes/learning-note-docx.builder.ts`（当前，约 L522–L609）

```typescript
// 对齐 remote-plugins RichEditor/styles.css 的块级视觉（不用 Word 内置 Heading，避免蓝字）。
// 字号按 body 11pt × CSS em 估算。
// 块级视觉参数类型
type BlockVisual = {
	// 段间距
	spacing?: ISpacingProperties;
	// 缩进
	indent?: { left?: number };
	// 边框
	border?: IBordersOptions;
	// 块级基底 run 样式
	baseRun?: InlineStyle;
};
// 按 tag 返回块级视觉
function blockVisual(tag: string): BlockVisual {
	// body 默认段间距
	const bodySpacing: ISpacingProperties = {
		// 段前
		before: 40,
		// 段后
		after: 40,
		// 行距 1.9
		line: BODY_LINE,
		// 行距规则 AUTO
		lineRule: LineRuleType.AUTO,
	};
	// 按 tag 分派
	switch (tag) {
		// h1
		case 'h1':
			return {
				spacing: {
					before: 160,
					after: 100,
					line: 312,
					lineRule: LineRuleType.AUTO,
				},
				baseRun: { bold: true, size: 40, color: '1A1A1A' },
			};
		// h2
		case 'h2':
			return {
				spacing: {
					before: 140,
					after: 90,
					line: 324,
					lineRule: LineRuleType.AUTO,
				},
				baseRun: { bold: true, size: 37, color: '1A1A1A' },
			};
		// h3
		case 'h3':
			return {
				spacing: {
					before: 120,
					after: 80,
					line: 336,
					lineRule: LineRuleType.AUTO,
				},
				baseRun: { bold: true, size: 33, color: '1A1A1A' },
			};
		// h4
		case 'h4':
			return {
				spacing: {
					before: 100,
					after: 70,
					line: 336,
					lineRule: LineRuleType.AUTO,
				},
				baseRun: { bold: true, size: 30, color: '1A1A1A' },
			};
		// h5/h6
		case 'h5':
		case 'h6':
			return {
				spacing: {
					before: 90,
					after: 60,
					line: 348,
					lineRule: LineRuleType.AUTO,
				},
				baseRun: { bold: true, size: 26, color: '1A1A1A' },
			};
		// 引用：左边框 + 灰字
		case 'blockquote':
			return {
				spacing: bodySpacing,
				indent: { left: 120 },
				border: {
					left: {
						style: BorderStyle.SINGLE,
						size: 24,
						color: 'C8C8C8',
						space: 14,
					},
				},
				baseRun: { color: '666666' },
			};
		// 默认 body
		default:
			return { spacing: bodySpacing };
	}
}
```

**变更摘要**：纯新增块级视觉表，h1–h6/blockquote/default 五档。

### 4.21 `runProps` / `makeTextRun` / `pushText`（`apps/backend/src/services/learning-notes/learning-note-docx.builder.ts`）

本节含三个紧密相关的辅助：`mergeStyle`（合并两层 `InlineStyle`，后者覆盖前者）、`runProps`（把 `InlineStyle` 转为 `docx` 的 `IRunStylePropertiesOptions`，处理 code 字体/shading、链接蓝色、高亮等）、`makeTextRun`（构造 `TextRun`，文本经 `clip` 截断）、`pushText`（把文本包成 `TextRun` 或 `ExternalHyperlink` 推入段，链接补 `https://` 前缀）。

**改动后** · `apps/backend/src/services/learning-notes/learning-note-docx.builder.ts`（当前，约 L611–L678）

```typescript
// 合并两层 InlineStyle，patch 覆盖 base
function mergeStyle(base: InlineStyle, patch: InlineStyle): InlineStyle {
	// 展开合并
	return { ...base, ...patch };
}
// 把 InlineStyle 转为 docx run 属性
function runProps(style: InlineStyle): IRunStylePropertiesOptions {
	// code 字号按 0.875 倍且不低于 16（half-points），无 size 时用 18
	const codeSize = style.size
		? Math.max(16, Math.round(style.size * 0.875))
		: 18;
	// 返回 run 属性对象
	return {
		// 加粗
		...(style.bold ? { bold: true } : {}),
		// 斜体
		...(style.italics ? { italics: true } : {}),
		// 下划线（含链接）
		...(style.underline || style.href
			? { underline: { type: UnderlineType.SINGLE } }
			: {}),
		// 删除线
		...(style.strike ? { strike: true } : {}),
		// 非 code 时显式传 size
		...(style.size && !style.code ? { size: style.size } : {}),
		// code：Courier New + 浅灰底
		...(style.code
			? {
					font: 'Courier New',
					size: codeSize,
					shading: { type: ShadingType.CLEAR, fill: 'F0F0F0' },
				}
			: {}),
		// 链接蓝色优先，否则自定义颜色
		...(style.href
			? { color: '0563C1' }
			: style.color
				? { color: style.color }
				: {}),
		// 高亮（code 不再加高亮，避免与 code 底色冲突）
		...(style.highlight && !style.code
			? {
					shading: {
						type: ShadingType.CLEAR,
						fill: style.highlight,
					},
				}
			: {}),
	};
}
// 构造 TextRun，文本经 clip 截断
function makeTextRun(text: string, style: InlineStyle): TextRun {
	// 新建 TextRun，文本截断 + run 属性
	return new TextRun({
		text: clip(text, PARA_TEXT_MAX),
		...runProps(style),
	});
}
// 把文本包成 TextRun/ExternalHyperlink 推入段
function pushText(
	out: ParagraphChild[],
	text: string,
	style: InlineStyle,
): void {
	// 空文本不推
	if (!text) return;
	// 构造 TextRun
	const run = makeTextRun(text, style);
	// 有 href 包成超链接
	if (style.href) {
		// 取链接 trim
		let link = style.href.trim();
		// 非 http(s)/mailto 补 https://
		if (link && !/^https?:\/\//i.test(link) && !/^mailto:/i.test(link)) {
			link = `https://${link}`;
		}
		// 推入 ExternalHyperlink
		out.push(
			new ExternalHyperlink({
				link,
				children: [run],
			}),
		);
		// 结束
		return;
	}
	// 普通文本直接推 TextRun
	out.push(run);
}
```

**变更摘要**：纯新增 run 属性构造器与文本推送器，含 `mergeStyle` 合并辅助。

### 4.22 `Block` + `splitTopBlocks`（`apps/backend/src/services/learning-notes/learning-note-docx.builder.ts`）

`Block` 是顶层块的联合类型：`el`（带 tag/attrs/inner 的元素块）、`img`、`hr`。`splitTopBlocks` 是顶层块扫描器：逐字符扫 HTML，遇到文本节点包成 `p` 块，遇到 `img`/`hr`/`br` 直接成块，遇到容器标签（p/h1–h6/blockquote/pre/ul/ol/div/li/table）用深度计数找到匹配闭合标签切出 inner，未知容器则递归展开内部。尊重 ul/ol/pre 嵌套，不把内部 p 提前拆出。

**改动后** · `apps/backend/src/services/learning-notes/learning-note-docx.builder.ts`（当前，约 L812–L929）

```typescript
// 顶层块联合类型
type Block =
	| {
			// 元素块
			kind: 'el';
			// 标签名
			tag: string;
			// 属性
			attrs: Record<string, string>;
			// 内部 HTML
			inner: string;
	  }
	// 图片块
	| { kind: 'img'; src: string }
	// 分割线块
	| { kind: 'hr' };
// 顶层块扫描（尊重 ul/ol/pre 嵌套，不把内部 p 提前拆出）
function splitTopBlocks(html: string): Block[] {
	// 结果块数组
	const blocks: Block[] = [];
	// 游标
	let i = 0;
	// 别名
	const s = html;
	// 跳过空白
	const skipWs = () => {
		while (i < s.length && /\s/.test(s[i])) i += 1;
	};
	// 主循环
	while (i < s.length) {
		// 先跳空白
		skipWs();
		// 到尾退出
		if (i >= s.length) break;
		// 非 < 开头是文本节点
		if (s[i] !== '<') {
			// 找下一个 <
			const next = s.indexOf('<', i);
			// 取文本并 trim
			const text = (next < 0 ? s.slice(i) : s.slice(i, next)).trim();
			// 非空文本包成 p 块
			if (text) {
				blocks.push({
					kind: 'el',
					tag: 'p',
					attrs: {},
					inner: text,
				});
			}
			// 推进游标
			i = next < 0 ? s.length : next;
			continue;
		}
		// 找 > 闭合
		const end = s.indexOf('>', i);
		// 无闭合退出
		if (end < 0) break;
		// 取标签原始文本
		const raw = s.slice(i + 1, end);
		// 游标越过 >
		i = end + 1;
		// 注释或闭标签跳过
		if (raw.startsWith('!--') || raw.startsWith('/')) continue;
		// 自闭合标志
		const selfClosing = raw.endsWith('/');
		// 标签体
		const body = (selfClosing ? raw.slice(0, -1) : raw).trim();
		// 取标签名
		const nameMatch = /^([a-z0-9-]+)/i.exec(body);
		// 无名跳过
		if (!nameMatch) continue;
		// 标签名小写
		const tag = nameMatch[1].toLowerCase();
		// 解析属性
		const attrs = parseAttrs(body.slice(nameMatch[0].length));
		// img 块
		if (tag === 'img') {
			const src = attrs.src?.trim();
			if (src) blocks.push({ kind: 'img', src });
			continue;
		}
		// hr 块
		if (tag === 'hr') {
			blocks.push({ kind: 'hr' });
			continue;
		}
		// br 当作空 p
		if (tag === 'br') {
			blocks.push({ kind: 'el', tag: 'p', attrs: {}, inner: '' });
			continue;
		}
		// ...（省略深度计数匹配闭合标签的中段实现，详见源码 L878–L901：
		//     用 openRe/closeRe + depth 计数找到匹配 </tag>，切出 inner，更新游标 i）
		// 找匹配闭合标签（简单深度计数）
		const openRe = new RegExp(`<${tag}\\b[^>]*>`, 'gi');
		const closeRe = new RegExp(`</${tag}\\s*>`, 'gi');
		// 深度从 1 开始
		let depth = 1;
		// 内层游标
		let cursor = i;
		// inner 结束位置，默认到串尾
		let innerEnd = s.length;
		// 深度计数循环
		while (cursor < s.length && depth > 0) {
			// 重置正则 lastIndex
			openRe.lastIndex = cursor;
			closeRe.lastIndex = cursor;
			// 找下一个开/闭
			const openM = openRe.exec(s);
			const closeM = closeRe.exec(s);
			// 无闭标签退出
			if (!closeM) break;
			// 开标签更近 → 深度 +1
			if (openM && openM.index < closeM.index) {
				depth += 1;
				cursor = openM.index + openM[0].length;
			} else {
				// 闭标签 → 深度 -1
				depth -= 1;
				// 深度归 0 表示找到匹配
				if (depth === 0) {
					innerEnd = closeM.index;
					i = closeM.index + closeM[0].length;
					break;
				}
				cursor = closeM.index + closeM[0].length;
			}
		}
		// 切出 inner（深度归 0 用 innerEnd，否则到串尾）
		const inner = s.slice(end + 1, depth === 0 ? innerEnd : s.length);
		// 未匹配到则游标推到尾
		if (depth !== 0) i = s.length;
		// 已知容器标签成块
		if (
			tag === 'p' ||
			tag === 'h1' ||
			tag === 'h2' ||
			tag === 'h3' ||
			tag === 'h4' ||
			tag === 'h5' ||
			tag === 'h6' ||
			tag === 'blockquote' ||
			tag === 'pre' ||
			tag === 'ul' ||
			tag === 'ol' ||
			tag === 'div' ||
			tag === 'li' ||
			tag === 'table'
		) {
			// 推入元素块
			blocks.push({ kind: 'el', tag, attrs, inner });
		} else {
			// 未知容器：展开内部（tbody/thead/tr/td 等会走到这里，仅当外层未按 table 整块吃掉时）
			blocks.push(...splitTopBlocks(inner));
		}
	}
	// 返回块数组
	return blocks;
}
```

**变更摘要**：纯新增顶层块扫描器，深度计数匹配闭合标签，尊重嵌套容器。

### 4.23 `extractClosedElements` / `parseHtmlTable` / `tableFromHtml`（`apps/backend/src/services/learning-notes/learning-note-docx.builder.ts`）

本节含表格三件套。`extractClosedElements` 是通用的按标签深度匹配提取器（用于扫 table 内的 tr/td）。`parseHtmlTable` 把 table inner 解析为二维 `HtmlTableCell[][]`。`tableFromHtml` 把二维单元格数据组装成 `docx` 的 `Table`：算列宽、遍历行/单元格、内部块递归 `blocksToDocxChildren`、单元格套 `TABLE_BORDER` 与 colspan/rowspan、th 加底色。`HtmlTableCell` 类型与 `extractLis`（li 提取器，复用 `extractClosedElements`）一并附上。

**改动后** · `apps/backend/src/services/learning-notes/learning-note-docx.builder.ts`（当前，约 L931–L1182）

```typescript
// li 提取器：返回 li 的 attrs 与 inner
function extractLis(inner: string): Array<{
	attrs: Record<string, string>;
	inner: string;
}> {
	// 深度匹配：避免嵌套 </li> 被非贪婪正则提前截断，导致缩进层级丢失
	return extractClosedElements(inner, new Set(['li'])).map((el) => ({
		// 透传 attrs
		attrs: el.attrs,
		// 透传 inner
		inner: el.inner,
	}));
}
// 按深度匹配提取指定标签（跳过其它开标签，便于扫 table 内的 tr/td）
function extractClosedElements(
	html: string,
	tags: Set<string>,
): Array<{ tag: string; attrs: Record<string, string>; inner: string }> {
	// 输出数组
	const out: Array<{
		tag: string;
		attrs: Record<string, string>;
		inner: string;
	}> = [];
	// 游标
	let i = 0;
	// 别名
	const s = html;
	// 主循环
	while (i < s.length) {
		// 找下一个 <
		const lt = s.indexOf('<', i);
		// 无 < 退出
		if (lt < 0) break;
		// 找对应 >
		const gt = s.indexOf('>', lt);
		// 无 > 退出
		if (gt < 0) break;
		// 取标签原始文本
		const raw = s.slice(lt + 1, gt);
		// 游标越过 >
		i = gt + 1;
		// 注释/闭/处理指令跳过
		if (raw.startsWith('!') || raw.startsWith('/') || raw.startsWith('?')) {
			continue;
		}
		// 自闭合标志
		const selfClosing = raw.endsWith('/');
		// 标签体
		const body = (selfClosing ? raw.slice(0, -1) : raw).trim();
		// 取标签名
		const nameMatch = /^([a-z0-9-]+)/i.exec(body);
		// 无名跳过
		if (!nameMatch) continue;
		// 标签名小写
		const tag = nameMatch[1].toLowerCase();
		// 不在目标集合跳过
		if (!tags.has(tag)) continue;
		// 解析属性
		const attrs = parseAttrs(body.slice(nameMatch[0].length));
		// 自闭合格式：inner 为空直接推
		if (selfClosing) {
			out.push({ tag, attrs, inner: '' });
			continue;
		}
		// 深度计数找匹配闭合（同 splitTopBlocks 思路）
		const openRe = new RegExp(`<${tag}\\b[^>]*>`, 'gi');
		const closeRe = new RegExp(`</${tag}\\s*>`, 'gi');
		// 深度 1 起
		let depth = 1;
		// 内层游标
		let cursor = i;
		// inner 结束位置
		let innerEnd = s.length;
		// 深度循环
		while (cursor < s.length && depth > 0) {
			openRe.lastIndex = cursor;
			closeRe.lastIndex = cursor;
			const openM = openRe.exec(s);
			const closeM = closeRe.exec(s);
			// 无闭退出
			if (!closeM) break;
			// 开更近 → +1
			if (openM && openM.index < closeM.index) {
				depth += 1;
				cursor = openM.index + openM[0].length;
			} else {
				// 闭 → -1
				depth -= 1;
				if (depth === 0) {
					innerEnd = closeM.index;
					i = closeM.index + closeM[0].length;
					break;
				}
				cursor = closeM.index + closeM[0].length;
			}
		}
		// 推入 { tag, attrs, inner }
		out.push({ tag, attrs, inner: s.slice(gt + 1, innerEnd) });
		// 深度未归 0 表示异常，退出
		if (depth !== 0) break;
	}
	// 返回提取结果
	return out;
}
// 单元格类型
type HtmlTableCell = {
	// td 或 th
	tag: 'td' | 'th';
	// 属性
	attrs: Record<string, string>;
	// 内部 HTML
	inner: string;
};
// 把 table inner 解析为二维单元格
function parseHtmlTable(inner: string): HtmlTableCell[][] {
	// 先提取所有 tr，再在每个 tr 内提取 td/th
	return extractClosedElements(inner, new Set(['tr']))
		.map((row) =>
			extractClosedElements(row.inner, new Set(['td', 'th'])).map((c) => ({
				// 统一 tag 为 td/th
				tag: (c.tag === 'th' ? 'th' : 'td') as 'td' | 'th',
				// 透传 attrs
				attrs: c.attrs,
				// 透传 inner
				inner: c.inner,
			})),
		)
		// 过滤空行
		.filter((r) => r.length > 0);
}
// 把 table inner 组装成 docx Table
async function tableFromHtml(
	inner: string,
	budget: ImageBudget,
): Promise<Table | null> {
	// 解析行数据
	const rowDatas = parseHtmlTable(inner);
	// 空表返回 null
	if (rowDatas.length === 0) return null;
	// 算最大列数（考虑 colspan）
	const colCount = Math.max(
		1,
		...rowDatas.map((r) =>
			r.reduce((n, c) => n + Math.max(1, Number(c.attrs.colspan) || 1), 0),
		),
	);
	// 每列宽度（DXA）
	const colW = Math.max(1, Math.floor(TABLE_WIDTH_DXA / colCount));
	// 行数组
	const rows: TableRow[] = [];
	// 遍历行
	for (const row of rowDatas) {
		// 单元格数组
		const cells: TableCell[] = [];
		// 遍历单元格
		for (const cell of row) {
			// 是否表头
			const isHeader = cell.tag === 'th';
			// colspan
			const colspan = Math.max(1, Number(cell.attrs.colspan) || 1);
			// rowspan
			const rowspan = Math.max(1, Number(cell.attrs.rowspan) || 1);
			// 单元格内部块
			const blocks = splitTopBlocks(cell.inner);
			// 单元格子元素
			const children: DocxChild[] = [];
			// 空块给一个空段
			if (blocks.length === 0) {
				children.push(
					new Paragraph({
						children: [
							new TextRun({ text: '', ...(isHeader ? { bold: true } : {}) }),
						],
					}),
				);
			} else {
				// 非空块遍历
				for (const b of blocks) {
					// 非 el 块走通用 blocksToDocxChildren
					if (b.kind !== 'el') {
						children.push(...(await blocksToDocxChildren([b], budget)));
						continue;
					}
					// 嵌套 table/ul/ol/div 走通用
					if (
						b.tag === 'table' ||
						b.tag === 'ul' ||
						b.tag === 'ol' ||
						b.tag === 'div'
					) {
						children.push(...(await blocksToDocxChildren([b], budget)));
						continue;
					}
					// 其余走 paragraphsFromStyledInner；th 内部强制加粗
					children.push(
						...(await paragraphsFromStyledInner(
							{
								tag: b.tag,
								attrs: b.attrs,
								inner: isHeader
									? `<span style="font-weight:700">${b.inner}</span>`
									: b.inner,
							},
							budget,
						)),
					);
				}
			}
			// 子元素为空补一个空段
			if (children.length === 0) {
				children.push(new Paragraph({ children: [new TextRun({ text: '' })] }));
			}
			// 构造单元格
			cells.push(
				new TableCell({
					// 四边表格边框
					borders: {
						top: TABLE_BORDER,
						bottom: TABLE_BORDER,
						left: TABLE_BORDER,
						right: TABLE_BORDER,
					},
					// 宽度 = 列宽 × colspan
					width: { type: WidthType.DXA, size: colW * colspan },
					// colspan > 1 设 columnSpan
					...(colspan > 1 ? { columnSpan: colspan } : {}),
					// rowspan > 1 设 rowSpan
					...(rowspan > 1 ? { rowSpan: rowspan } : {}),
					// th 加底色
					...(isHeader
						? { shading: { type: ShadingType.CLEAR, fill: 'EFEFEF' } }
						: {}),
					// 单元格内边距
					margins: { top: 60, bottom: 60, left: 80, right: 80 },
					// 子元素
					children,
				}),
			);
		}
		// 构造行
		rows.push(
			new TableRow({
				children: cells,
				// ponytail: 不设 tableHeader。Word 的 w:tblHeader（跨页重复表头）会在部分客户端
				// 把表头再画成一张「只有表头」的表，看起来像导出重复。表头外观靠 th 底色/加粗即可。
			}),
		);
	}
	// 构造并返回 Table
	return new Table({
		// 总宽
		width: { type: WidthType.DXA, size: TABLE_WIDTH_DXA },
		// 各列宽
		columnWidths: Array.from({ length: colCount }, () => colW),
		// 全边框
		borders: {
			top: TABLE_BORDER,
			bottom: TABLE_BORDER,
			left: TABLE_BORDER,
			right: TABLE_BORDER,
			insideHorizontal: TABLE_BORDER,
			insideVertical: TABLE_BORDER,
		},
		// 行
		rows,
	});
}
```

**变更摘要**：纯新增表格三件套 + `HtmlTableCell` + `extractLis`，支持 colspan/rowspan/th 底色。

### 4.24 `preToDocxTable`（`apps/backend/src/services/learning-notes/learning-note-docx.builder.ts`）

`preToDocxTable` 把代码块转成单格 `Table`：底色 `CODE_BG`、无边框、内部用空段（`spacer`）撑上下垂直内边距、用段落 indent 撑左右水平内边距、Courier New 14pt 等宽字体。文本先 `<br>` 转换行、去标签、反转义、`clip` 截断。

**改动后** · `apps/backend/src/services/learning-notes/learning-note-docx.builder.ts`（当前，约 L1184–L1274）

```typescript
// 代码块：单格表格底色 + 段落缩进/空段模拟 CSS padding
//（段落 shading 与 tcMar 在部分客户端不可靠）。
function preToDocxTable(
	inner: string,
	alignment: (typeof AlignmentType)[keyof typeof AlignmentType] | undefined,
): Table {
	// 提取纯文本：<br> 转换行、去标签、反转义、截断
	const text = clip(
		decodeEntities(inner.replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, '')),
		PARA_TEXT_MAX,
	);
	// 按行切分，空文本给一个空格行
	const lines = text ? text.split('\n') : [' '];
	// 上下垂直内边距用的空段工厂
	const spacer = () =>
		new Paragraph({
			// 继承对齐
			alignment,
			// 用 EXACT 行高撑出垂直空间
			spacing: {
				before: 0,
				after: 0,
				line: CODE_PAD_V_LINE,
				lineRule: LineRuleType.EXACT,
			},
			// 一个空格 TextRun
			children: [
				new TextRun({
					text: ' ',
					font: 'Courier New',
					size: 18,
					color: '1A1A1A',
				}),
			],
		});
	// 单元格子元素：上空段 + 代码行 + 下空段
	const children = [
		// 上空段
		spacer(),
		// 代码行段落
		...lines.map(
			(line) =>
				new Paragraph({
					// 继承对齐
					alignment,
					// 左右 indent 撑水平内边距
					indent: { left: CODE_PAD_H, right: CODE_PAD_H },
					// 紧凑行距
					spacing: {
						before: 0,
						after: 0,
						line: 276,
						lineRule: LineRuleType.AUTO,
					},
					children: [
						new TextRun({
							// 空行补一个空格，保证段落有高度
							text: line || ' ',
							font: 'Courier New',
							size: 18,
							color: '1A1A1A',
						}),
					],
				}),
		),
		// 下空段
		spacer(),
	];
	// 构造单格 Table
	return new Table({
		// 总宽
		width: { type: WidthType.DXA, size: TABLE_WIDTH_DXA },
		// 单列
		columnWidths: [TABLE_WIDTH_DXA],
		// 全无边框
		borders: {
			top: CODE_BORDER,
			bottom: CODE_BORDER,
			left: CODE_BORDER,
			right: CODE_BORDER,
			insideHorizontal: CODE_BORDER,
			insideVertical: CODE_BORDER,
		},
		// 单行单格
		rows: [
			new TableRow({
				children: [
					new TableCell({
						// 无边框
						borders: {
							top: CODE_BORDER,
							bottom: CODE_BORDER,
							left: CODE_BORDER,
							right: CODE_BORDER,
						},
						// 满宽
						width: { type: WidthType.DXA, size: TABLE_WIDTH_DXA },
						// 代码块底色
						shading: { type: ShadingType.CLEAR, fill: CODE_BG },
						// 边距交给段落 indent/空段，避免与 tcMar 叠加或被客户端忽略
						margins: { top: 0, bottom: 0, left: 0, right: 0 },
						// 子元素
						children,
					}),
				],
			}),
		],
	});
}
```

**变更摘要**：纯新增代码块表格构造器，单格底色 + 空段/indent 模拟 padding。

### 4.25 `paragraphsFromStyledInner`（`apps/backend/src/services/learning-notes/learning-note-docx.builder.ts`）

`paragraphsFromStyledInner` 把一个元素块（tag/attrs/inner + 可选 listPrefix/listIndent）转成 `DocxChild[]`。先算对齐、视觉、缩进、段落 extras；`pre` 走 `preToDocxTable`；其余调 `htmlToStyledRuns` 得到 runs/img 段序列，逐段构造 `Paragraph`，首段带 listPrefix，img 段调 `toDocxImage`，失败给灰字占位。

**改动后** · `apps/backend/src/services/learning-notes/learning-note-docx.builder.ts`（当前，约 L1276–L1369）

```typescript
// 把一个元素块转成 DocxChild[]（含列表前缀/缩进）
async function paragraphsFromStyledInner(
	opts: {
		// 标签名
		tag: string;
		// 属性
		attrs: Record<string, string>;
		// 内部 HTML
		inner: string;
		// 列表项前缀（如 "• " / "1. " / "☑ "）
		listPrefix?: string;
		// 列表层级缩进（twip）；与 listPrefix 独立，嵌套层可只加缩进不加前缀
		listIndent?: number;
	},
	budget: ImageBudget,
): Promise<DocxChild[]> {
	// 解构参数
	const { tag, attrs, inner, listPrefix, listIndent } = opts;
	// 读对齐
	const alignment = readAlign(attrs);
	// 读块级视觉
	const visual = blockVisual(tag);
	// 总左缩进 = 列表缩进 + 视觉缩进
	const indentLeft = (listIndent ?? 0) + (visual.indent?.left ?? 0);
	// 段落公共属性
	const paraExtras = {
		alignment,
		spacing: visual.spacing,
		border: visual.border,
		// 有缩进才传 indent
		...(indentLeft > 0 ? { indent: { left: indentLeft } } : {}),
	};
	// 输出数组
	const out: DocxChild[] = [];
	// pre 走代码块表格
	if (tag === 'pre') {
		out.push(preToDocxTable(inner, alignment));
		return out;
	}
	// 行内扫描得段序列
	const segments = htmlToStyledRuns(inner, visual.baseRun ?? {});
	// 空段：构造一个带前缀或空的段落
	if (segments.length === 0) {
		out.push(
			new Paragraph({
				...paraExtras,
				children: listPrefix
					? [
							new TextRun({
								text: listPrefix,
								...runProps(visual.baseRun ?? {}),
							}),
						]
					: [
							new TextRun({
								text: '',
								...runProps(visual.baseRun ?? {}),
							}),
						],
			}),
		);
		return out;
	}
	// 待用前缀（仅首段消费）
	let pendingPrefix = listPrefix;
	// 遍历段
	for (const seg of segments) {
		// img 段
		if (seg.type === 'img') {
			// 嵌入图片
			const run = await toDocxImage(seg.src, budget);
			// 推入图片段落
			out.push(
				new Paragraph({
					alignment,
					spacing: visual.spacing,
					...(indentLeft > 0 ? { indent: { left: indentLeft } } : {}),
					children: run
						? [run]
						: [
								new TextRun({
									text: '[图片无法嵌入]',
									italics: true,
									color: '888888',
								}),
							],
				}),
			);
			// 图片后不再加前缀
			pendingPrefix = undefined;
			continue;
		}
		// runs 段：复制 children
		const children = [...seg.children];
		// 有待用前缀则插到最前
		if (pendingPrefix) {
			children.unshift(
				new TextRun({
					text: pendingPrefix,
					...runProps(visual.baseRun ?? {}),
				}),
			);
			// 消费掉前缀
			pendingPrefix = undefined;
		}
		// 空children 跳过
		if (children.length === 0) continue;
		// 推入段落
		out.push(
			new Paragraph({
				...paraExtras,
				children,
			}),
		);
	}
	// 返回块数组
	return out;
}
```

**变更摘要**：纯新增元素块→段落转换器，处理 pre/空段/img/runs 四类与列表前缀。

### 4.26 `listToDocxChildren`（`apps/backend/src/services/learning-notes/learning-note-docx.builder.ts`）

`listToDocxChildren` 把 ul/ol 转成 `DocxChild[]`：识别 taskList/taskItem，剥 label/checkbox，按 tag 与 checked 决定前缀（`• ` / `N. ` / `☑ ` / `☐ `）；对每个 li 内部块递归处理——嵌套 ul/ol 递归 `listToDocxChildren`，table/img 走 `blocksToDocxChildren`，div 展开，其余走 `paragraphsFromStyledInner`（首块带前缀）。缩进随 depth 递增。配套辅助函数 `unwrapTaskItemContent` / `attrsToHtml` / `isTaskListAttrs` / `isTaskItemAttrs` / `taskItemChecked` 一并附上。

**改动后** · `apps/backend/src/services/learning-notes/learning-note-docx.builder.ts`（当前，约 L942–L1489）

```typescript
// 去掉 taskItem 的 label/checkbox UI，只留内容区（通常是外层 div）
function unwrapTaskItemContent(html: string): string {
	// 先按顶层块切
	const blocks = splitTopBlocks(html);
	// 切不出块则直接正则删 label
	if (blocks.length === 0) {
		return html.replace(/<label\b[^>]*>[\s\S]*?<\/label>/gi, '');
	}
	// 收集内容部分
	const parts: string[] = [];
	// 遍历块
	for (const b of blocks) {
		// 非 el 跳过
		if (b.kind !== 'el') continue;
		// label 块丢弃
		if (b.tag === 'label') continue;
		// div 块取 inner（脱壳）
		if (b.tag === 'div') {
			parts.push(b.inner);
			continue;
		}
		// 其余块原样重组
		parts.push(`<${b.tag}${attrsToHtml(b.attrs)}>${b.inner}</${b.tag}>`);
	}
	// 拼接；空则回退正则删 label
	return (
		parts.join('') || html.replace(/<label\b[^>]*>[\s\S]*?<\/label>/gi, '')
	);
}
// 把 attrs 字典序列化为 HTML 属性串
function attrsToHtml(attrs: Record<string, string>): string {
	// 取键
	const keys = Object.keys(attrs);
	// 无键返回空
	if (keys.length === 0) return '';
	// 拼成 ` k="v"` 序列，v 中的 " 转义
	return keys
		.map((k) => ` ${k}="${String(attrs[k]).replace(/"/g, '&quot;')}"`)
		.join('');
}
// 是否 taskList（data-type=taskList）
function isTaskListAttrs(attrs: Record<string, string>): boolean {
	return (attrs['data-type'] || '').toLowerCase() === 'tasklist';
}
// 是否 taskItem（data-type=taskItem 或 taskList 内带 data-checked）
function isTaskItemAttrs(
	attrs: Record<string, string>,
	inTaskList: boolean,
): boolean {
	// data-type=taskItem
	const type = (attrs['data-type'] || '').toLowerCase();
	if (type === 'taskitem') return true;
	// taskList 内带 data-checked 也算
	if (inTaskList && 'data-checked' in attrs) return true;
	return false;
}
// 判定 taskItem 是否勾选
function taskItemChecked(
	attrs: Record<string, string>,
	innerHtml: string,
): boolean {
	// 优先 data-checked 属性
	if ('data-checked' in attrs) {
		const raw = String(attrs['data-checked']).toLowerCase();
		// true/checked/空字符串都视为勾选
		return raw === 'true' || raw === 'checked' || raw === '';
	}
	// 否则看内部 input 是否有 checked 属性
	return /<input\b[^>]*\bchecked\b/i.test(innerHtml);
}
// ul/ol → DocxChild[]，递归处理嵌套
async function listToDocxChildren(
	tag: 'ul' | 'ol',
	attrs: Record<string, string>,
	inner: string,
	budget: ImageBudget,
	depth: number,
): Promise<DocxChild[]> {
	// 输出数组
	const out: DocxChild[] = [];
	// 是否 taskList
	const inTaskList = isTaskListAttrs(attrs);
	// 提取 li
	const items = extractLis(inner);
	// 有序列表计数
	let index = 1;
	// 当前层缩进
	const indent = LIST_INDENT * (depth + 1);
	// 遍历 li
	for (const item of items) {
		// 是否 taskItem
		const isTask = isTaskItemAttrs(item.attrs, inTaskList);
		// taskItem 剥 label/checkbox
		const contentHtml = isTask ? unwrapTaskItemContent(item.inner) : item.inner;
		// 默认前缀
		let prefix = '• ';
		// 有序列表用 N. 前缀并自增
		if (tag === 'ol') {
			prefix = `${index}. `;
			index += 1;
		}
		// taskItem 用 ☑/☐
		if (isTask) {
			prefix = taskItemChecked(item.attrs, item.inner) ? '☑ ' : '☐ ';
		}
		// 切 li 内部顶层块
		const innerBlocks = splitTopBlocks(contentHtml);
		// 无块：整段当一个 p 处理
		if (innerBlocks.length === 0) {
			out.push(
				...(await paragraphsFromStyledInner(
					{
						tag: 'p',
						attrs: item.attrs,
						inner: contentHtml,
						listPrefix: prefix,
						listIndent: indent,
					},
					budget,
				)),
			);
			continue;
		}
		// 前缀是否已消费（仅首块带前缀）
		let usedPrefix = false;
		// 遍历 li 内部块
		for (const ib of innerBlocks) {
			// 嵌套 ul/ol 递归
			if (ib.kind === 'el' && (ib.tag === 'ul' || ib.tag === 'ol')) {
				out.push(
					...(await listToDocxChildren(
						ib.tag,
						ib.attrs,
						ib.inner,
						budget,
						depth + 1,
					)),
				);
				continue;
			}
			// 非 el 块走通用
			if (ib.kind !== 'el') {
				out.push(...(await blocksToDocxChildren([ib], budget)));
				continue;
			}
			// table 走通用
			if (ib.tag === 'table') {
				out.push(...(await blocksToDocxChildren([ib], budget)));
				continue;
			}
			// div 展开
			if (ib.tag === 'div') {
				// 非 task 的残留 div：展开后继续按列表项渲染
				const nested = splitTopBlocks(ib.inner);
				for (const nb of nested) {
					// 嵌套 ul/ol 递归
					if (nb.kind === 'el' && (nb.tag === 'ul' || nb.tag === 'ol')) {
						out.push(
							...(await listToDocxChildren(
								nb.tag,
								nb.attrs,
								nb.inner,
								budget,
								depth + 1,
							)),
						);
						continue;
					}
					// 非 el 走通用
					if (nb.kind !== 'el') {
						out.push(...(await blocksToDocxChildren([nb], budget)));
						continue;
					}
					// 其余按段落（li 标签当 p）
					out.push(
						...(await paragraphsFromStyledInner(
							{
								tag: nb.tag === 'li' ? 'p' : nb.tag,
								attrs: nb.attrs,
								inner: nb.inner,
								listPrefix: usedPrefix ? undefined : prefix,
								listIndent: indent,
							},
							budget,
						)),
					);
					// 前缀已消费
					usedPrefix = true;
				}
				continue;
			}
			// 普通块按段落，首块带前缀
			out.push(
				...(await paragraphsFromStyledInner(
					{
						tag: ib.tag,
						attrs: ib.attrs,
						inner: ib.inner,
						listPrefix: usedPrefix ? undefined : prefix,
						listIndent: indent,
					},
					budget,
				)),
			);
			// 前缀已消费
			usedPrefix = true;
		}
	}
	// 返回列表子元素
	return out;
}
```

**变更摘要**：纯新增列表渲染器 + taskList 五件套，支持嵌套/前缀/缩进/勾选符号。

### 4.27 `blocksToDocxChildren`（`apps/backend/src/services/learning-notes/learning-note-docx.builder.ts`）

`blocksToDocxChildren` 是块调度总入口：遍历 `Block[]`，按 kind/tag 分派——`hr` 构造底边框段、`img` 调 `toDocxImage`、`table` 调 `tableFromHtml`、`ul/ol` 调 `listToDocxChildren`、`blockquote` 按内部块分段（保留多段换行）、`div` 展开递归、其余走 `paragraphsFromStyledInner`。

**改动后** · `apps/backend/src/services/learning-notes/learning-note-docx.builder.ts`（当前，约 L1491–L1596）

```typescript
// 块调度总入口：遍历 Block[] 分派到各构造器
async function blocksToDocxChildren(
	blocks: Block[],
	budget: ImageBudget,
): Promise<DocxChild[]> {
	// 输出数组
	const out: DocxChild[] = [];
	// 遍历块
	for (const block of blocks) {
		// hr：底边框段
		if (block.kind === 'hr') {
			out.push(
				new Paragraph({
					border: {
						bottom: {
							style: BorderStyle.SINGLE,
							size: 12,
							color: 'CCCCCC',
							space: 1,
						},
					},
					spacing: { before: 120, after: 120 },
					children: [],
				}),
			);
			continue;
		}
		// img：嵌入或灰字占位
		if (block.kind === 'img') {
			const run = await toDocxImage(block.src, budget);
			out.push(
				new Paragraph({
					children: run
						? [run]
						: [
								new TextRun({
									text: '[图片无法嵌入]',
									italics: true,
									color: '888888',
								}),
							],
				}),
			);
			continue;
		}
		// 解构 el 块
		const { tag, attrs, inner } = block;
		// table：构造后补一个空段分隔
		if (tag === 'table') {
			const table = await tableFromHtml(inner, budget);
			if (table) {
				out.push(table);
				out.push(new Paragraph({ children: [] }));
			}
			continue;
		}
		// ul/ol：走列表渲染
		if (tag === 'ul' || tag === 'ol') {
			out.push(...(await listToDocxChildren(tag, attrs, inner, budget, 0)));
			continue;
		}
		// 引用：按内部块分段，保留多段换行（避免多个 <p> 被拼成一行）
		if (tag === 'blockquote') {
			const innerBlocks = splitTopBlocks(inner);
			if (innerBlocks.length === 0) {
				out.push(
					...(await paragraphsFromStyledInner(
						{ tag: 'blockquote', attrs, inner },
						budget,
					)),
				);
			} else {
				for (const ib of innerBlocks) {
					if (ib.kind !== 'el') {
						out.push(...(await blocksToDocxChildren([ib], budget)));
						continue;
					}
					if (ib.tag === 'blockquote') {
						out.push(...(await blocksToDocxChildren([ib], budget)));
						continue;
					}
					out.push(
						...(await paragraphsFromStyledInner(
							{
								tag: 'blockquote',
								attrs: { ...attrs, ...ib.attrs },
								inner: ib.inner,
							},
							budget,
						)),
					);
				}
			}
			continue;
		}
		// div：展开递归（如 taskItem 内层）
		if (tag === 'div') {
			out.push(...(await blocksToDocxChildren(splitTopBlocks(inner), budget)));
			continue;
		}
		// 其余：走段落渲染
		out.push(
			...(await paragraphsFromStyledInner({ tag, attrs, inner }, budget)),
		);
	}
	// 返回子元素
	return out;
}
```

**变更摘要**：纯新增块调度总入口，分派 hr/img/table/ul-ol/blockquote/div/其他七路。

### 4.28 `buildLearningNoteDocxBuffer`（`apps/backend/src/services/learning-notes/learning-note-docx.builder.ts`）

`buildLearningNoteDocxBuffer` 是模块导出的主入口。流程：校验 HTML 长度上限 → 初始化 `ImageBudget` → 构造标题段（11pt 加粗 + 空行）→ 剥离 `data-type="note-title"` 容器 → `splitTopBlocks` + `blocksToDocxChildren` 生成正文 → 跳过图片明细页脚 → 组装 `Document`（默认 Calibri 11pt / 行距 1.9 / 页边距 720twip）→ `Packer.toBuffer` 返回 Buffer。

**改动后** · `apps/backend/src/services/learning-notes/learning-note-docx.builder.ts`（当前，约 L1598–L1695）

```typescript
// 将 TipTap HTML 转为 DOCX Buffer（保留样式与图片）。
export async function buildLearningNoteDocxBuffer(input: {
	// 笔记标题
	title: string;
	// 笔记正文 HTML
	html: string;
}): Promise<Buffer> {
	// 取 html，缺省空串
	const html = input.html ?? '';
	// 超字符上限直接抛错（提示用户精简）
	if (html.length > NOTE_DOCX_HTML_MAX_CHARS) {
		throw new Error(
			`笔记内容过大（>${NOTE_DOCX_HTML_MAX_CHARS} 字符），请精简后再导出`,
		);
	}
	// 初始化图片预算
	const budget: ImageBudget = { count: 0, bytes: 0, skipped: 0, reasons: [] };
	// 文档子元素，从标题段开始
	const children: DocxChild[] = [
		// 标题段：加粗 22 half-pt = 11pt×2，颜色深灰
		new Paragraph({
			spacing: {
				before: 0,
				after: 200,
				line: 312,
				lineRule: LineRuleType.AUTO,
			},
			children: [
				new TextRun({
					text: clip(input.title.trim() || '无标题笔记', 200),
					bold: true,
					size: 44,
					color: '1A1A1A',
				}),
			],
		}),
		// 标题后空行
		new Paragraph({ text: '' }),
	];
	// 剥离正文里的 note-title 容器（避免标题重复）
	const body = html.replace(
		/<div[^>]*data-type=["']note-title["'][^>]*>[\s\S]*?<\/div>/gi,
		'',
	);
	// 块扫描 + 渲染
	const paras = await blocksToDocxChildren(splitTopBlocks(body), budget);
	// 追加到 children
	children.push(...paras);
	// 有跳过的图片：页脚追加灰字明细
	if (budget.skipped > 0) {
		const detail = budget.reasons.length
			? budget.reasons.join('；')
			: '格式不支持或文件过大';
		children.push(new Paragraph({ text: '' }));
		children.push(
			new Paragraph({
				children: [
					new TextRun({
						text: `（有 ${budget.skipped} 张图片未能嵌入：${detail}）`,
						italics: true,
						color: '888888',
						size: 18,
					}),
				],
			}),
		);
	}
	// 构造 Document
	const doc = new Document({
		// 默认样式
		styles: {
			default: {
				document: {
					// run 默认：Calibri 11pt 深灰
					run: {
						font: 'Calibri',
						size: BODY_SIZE,
						color: '1A1A1A',
					},
					// 段落默认：行距 1.9
					paragraph: {
						spacing: {
							line: BODY_LINE,
							lineRule: LineRuleType.AUTO,
						},
					},
				},
			},
		},
		// 节：A4 页边距 720twip = 0.5"
		sections: [
			{
				properties: {
					page: {
						margin: {
							top: 720,
							right: 720,
							bottom: 720,
							left: 720,
						},
					},
				},
				// 子元素
				children,
			},
		],
	});
	// 打包为 Buffer 返回
	return Buffer.from(await Packer.toBuffer(doc));
}
```

**变更摘要**：纯新增主入口，校验→标题→正文→页脚→Document→Buffer 全链路。

## 5. 兼容性与影响

**图片上限**

- 单篇 HTML 字符上限 `NOTE_DOCX_HTML_MAX_CHARS = 5_000_000`，超出直接抛错（不静默截断，避免半截文档误导用户）。
- 图片张数上限 `NOTE_DOCX_IMAGE_MAX_COUNT = 120`，超出经 `skipImage` 跳过并在页脚列出原因。
- 单图字节上限 15MB（转码后），超出跳过；`NOTE_DOCX_IMAGE_SOFT_MAX_BYTES` / `NOTE_DOCX_IMAGES_TOTAL_SOFT_MAX_BYTES` 为模块级软上限常量（供上层调用方参考，本文件内部硬门槛是 15MB/张）。
- 跳过原因最多记 6 条入 `ImageBudget.reasons`，页脚以灰字段落输出，便于线上排查。

**格式兼容**

- Word 原生图片：jpg/png/gif/bmp 直接嵌入；webp 与 avif/heic/svg 等 `image/*` 经 sharp 转 JPEG；sharp 不可用时回退 macOS `sips`（仅本机开发兜底），两路都失败则跳过。
- 表格：支持 colspan/rowspan、th 底色与加粗；不设 `tableHeader`（避免部分客户端跨页重复画表头）；列宽按 `TABLE_WIDTH_DXA / colCount` 均分。
- 代码块：用单格 Table + 段落 indent/空段模拟 CSS padding，不依赖 `tcMar`（部分客户端会忽略）；Courier New 14pt 等宽。
- 列表：ul/ol 嵌套递归，taskList/taskItem 脱壳后用 `• / N. / ☑ / ☐` 文本前缀（不依赖 Word 原生 numbering，兼容性更稳）。
- 行内样式：加粗/斜体/下划线/删除线/行内代码/颜色/高亮/链接全覆盖；链接补 `https://` 前缀并染 Word 标准蓝 `0563C1`。
- 标题不使用 Word 内置 Heading 样式（避免蓝字），用 `baseRun` 自定字号颜色对齐页面 CSS。

**失败兜底**

- 图片三源（data URL / 本机 / 远程）任一失败均返回 `null`，由 `toDocxImage` 经 `skipImage` 记账，渲染处用 `[图片无法嵌入]` 灰字占位，不中断整篇导出。
- sharp 懒加载 `require`：避免在启动路径上耦合 sharp；sharp 不可用或版本不符（Node 18 装到 0.35+）时不会拖垮进程，仅降级到 `sips` 或跳过该图。
- HTML 解析全用正则 + 状态机，对畸形 HTML 容忍（未配对闭标签弹栈到匹配项、未知容器递归展开），最坏情况是少几段内容而非抛错。
- 主入口 `buildLearningNoteDocxBuffer` 仅在 HTML 超字符上限时抛错（让上层 HTTP 处理返回 4xx），其余失败均在文档内部以占位/页脚形式消化。

**对既有功能的影响**

- 本文件为纯新增模块，不改动既有 `learning-notes` 服务代码；上层调用方（导出路由/服务）通过 `buildLearningNoteDocxBuffer` 引入。
- 不引入新的全局状态、不落盘、不写日志（除页脚内置排查信息），对运行环境无副作用。
- 依赖既有 `../../utils/upload-paths`（`decodeUploadPublicPath` / `resolveUploadPublicPathToAbsolute`）与 `docx` 库，未新增第三方依赖（sharp 为可选懒加载，缺失时降级）。

**回归建议**

- 覆盖测：标题 + 多级标题 + 段落 + 加粗/斜体/下划线/删除线/行内代码/颜色/高亮/链接。
- 图片测：data URL、本机 `/images/..`、本机 `/upload/serve?path=`、远程 http(s)、webp 转 JPEG、损坏图占位、超 120 张跳过、超 15MB 跳过。
- 表格测：普通表、th 表头、colspan/rowspan 合并、嵌套表、空单元格。
- 列表测：ul/ol 单层、ul/ol 嵌套、taskList 勾选/未勾选、li 内含多段/图片/表格。
- 代码块测：单行、多行、含 `<br>`、空代码块、超长代码块截断。
- 边界测：空 HTML、仅标题、超 5_000_000 字符抛错、含 `data-type="note-title"` 容器被剥离。
- 客户端测：Word / WPS / macOS Pages 打开导出文件，确认代码块底色、表格边框、引用左边框、列表前缀均正常。

## 6. 相关源码路径

| 说明 | 路径 |
| ---- | ---- |
| 本归档主文件（HTML→DOCX 转换核心） | `apps/backend/src/services/learning-notes/learning-note-docx.builder.ts` |
| 上传公开路径解码/转绝对路径工具 | `apps/backend/src/utils/upload-paths.ts` |
| 学习笔记导出性能优化背景（姊妹文） | `docs/english/学习笔记导出性能.md` |
| 学习笔记富文本编辑器深度分析 | `docs/english/学习笔记富文本编辑器深潜.md` |
| 学习笔记导出实现思路（规划态） | `docs/ideas/学习笔记DOCX导出手册.md` |
| 学习笔记列表导出实现思路 | `docs/ideas/学习笔记列表导出.md` |

---

（若与仓库最新源码不一致，以源码为准）