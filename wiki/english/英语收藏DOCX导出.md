# 英语学习收藏导出 DOCX：实现说明

## 1. 背景与目标

为「单词收藏」「经典句收藏」提供 **一键导出 Word（DOCX）**：用户在抽屉中点击导出后，浏览器或 Tauri 客户端下载到本地。导出数据与列表 **分页无关**，由服务端按用户 **最多拉取 3000 条**（按收藏时间倒序）拼成文档，避免超大文件占满内存。

## 2. 改动范围

| 层级 | 路径 | 说明 |
|------|------|------|
| 后端依赖 | `apps/backend/package.json` | 增加 `docx` 依赖，用于生成 OOXML（docx） |
| 后端构建 | `apps/backend/src/services/english-learning/english-favorites-docx.builder.ts` | 使用 `docx` 将行数据拼 `Document` → `Packer.toBuffer` |
| 后端服务 | `apps/backend/src/services/english-learning/english-learning.service.ts` | 查询收藏表、`take` 上限、调用 builder |
| 后端控制器 | `apps/backend/src/services/english-learning/english-learning.controller.ts` | 两个 `GET` 路由，**原始二进制响应**（`@Res()`） |
| 前端 API 常量 | `apps/frontend/src/service/api.ts` | 导出路径常量 |
| 前端服务层 | `apps/frontend/src/service/index.ts` | `http.get<ArrayBuffer>` + `downloadBlob` 统一下载 |
| 前端抽屉 | `apps/frontend/src/views/englishLearning/VocabularyFavoritesDrawer.tsx`、`ClassicQuotesFavoritesDrawer.tsx` | 导出按钮、加载态、Toast 与 Tauri 协调 |
| 国际化 | `apps/frontend/src/i18n/locales/zh-CN.ts`、`en-US.ts` | 导出相关文案 |
| UI 微调 | `apps/frontend/src/components/design/Drawer/index.tsx` | 抽屉 footer 内边距 |
| 仓库忽略 | `.gitignore` | 增加 `.pnpm-store`（与导出功能弱相关，属同批改动） |

## 3. 实现思路

1. **为何不走统一 JSON 包装**  
   若仍用 `{ success, data }` 包一层二进制，前端无法直接当文件下载。故控制器对导出接口使用 **`@Res() res`**，设置 `Content-Type`、`Content-Disposition`、`Content-Length` 后 **`res.end(buf)`**，与常规 JSON 接口区分。

2. **为何服务端限制 3000 条**  
   DOCX 在内存中构建，单次 `find` 使用 `take: 3000`，避免极端收藏量拖垮进程；与抽屉列表分页（如每页 20）**解耦**。

3. **为何前端用 `http.get` + `ArrayBuffer`**  
   项目 HTTP 封装 `http` 在非 JSON 响应时会解析为 **`ArrayBuffer`**，与 `getPlatformFetch` 底层一致，且自动带 **Bearer Token**。导出请求使用 **`silent: true`**，避免与抽屉内错误 Toast 重复（失败仍通过 `throw` / 返回值由调用方提示）。

4. **为何落地用 `downloadBlob`**  
   **Web**：`downloadBlob` 内用 `Blob` + `<a download>`。**Tauri**：同一 API 内部 `invoke('download_blob', …)`，与项目其它二进制下载一致（系统另存为）。前端将 `ArrayBuffer` 包成带 DOCX MIME 的 `Blob` 再传入。

5. **Toast 策略**  
   Tauri 下 `downloadBlob` 成功/失败会自带 Toast；抽屉内 **成功** Toast 仅在 **`!isTauriRuntime()`** 时弹出，避免双成功提示。失败时 HTTP 层 `silent` + 业务 `throw`，抽屉 **`catch`** 统一错误 Toast。

6. **DOCX 内容结构**  
   Builder 中为标题 + 摘要行 + 逐条字段段落；长文本通过 `clip` 截断，防止单字段过大。

## 4. 关键代码与注释

本节约定：**每个代码块内，对几乎每一条可执行语句或声明单独写注释**（紧挨该行上方用 `//`，或行尾 `//`），便于对照阅读。注释略长于源码属正常。

### 4.1 后端：控制器原始流式响应

**来源**：`apps/backend/src/services/english-learning/english-learning.controller.ts`（约 L243–L267、L523–L547）

```typescript
// 使用 @Res() 后，Nest 不会用默认拦截器把返回值包成 JSON；必须自行 setHeader + end，否则响应可能挂起或格式错误。
/** 导出当前用户单词收藏为 DOCX（服务端拉全量至多 3000 条，与列表分页无关） */
@Get('vocabulary-favorites/export-docx') // 注册 GET 路由，相对控制器前缀拼出完整 URL。
async exportVocabularyFavoritesDocx( // 异步方法：返回 Promise<void> 表示不通过 return body 返回 JSON。
	@Req() req: AuthedRequest, // 注入请求对象，类型含 JWT 解析后的 user（项目自定义 AuthedRequest）。
	@Res() res: Response, // 注入 Express Response，用于写原始字节流。
): Promise<void> { // 显式 void：强调本方法只写 res，不 return 业务 DTO。
	// 从 req.user 取数字型 userId；可选链避免 req.user 为空时抛 TypeError。
	const userId = req.user?.userId;
	// 未登录或未写入 user 时拒绝导出，抛 401 由全局异常过滤器转成错误响应。
	if (userId == null) {
		// 抛出 Nest 内置未授权异常，HTTP 状态码 401。
		throw new UnauthorizedException('未授权');
	}
	// await：等待 Service 查库并生成 docx 二进制；结果类型为 Node.js Buffer。
	const buf =
		// 调用注入的 englishLearningService 实例方法，传入当前用户 id。
		await this.englishLearningService.exportVocabularyFavoritesDocxBuffer(
			userId, // 仅导出该用户的收藏行。
		);
	// 设置响应头 Content-Type，告知客户端 body 为 OOXML Word 文档（.docx）。
	res.setHeader(
		'Content-Type', // 头名称，固定字符串。
		'application/vnd.openxmlformats-officedocument.wordprocessingml.document', // OOXML Word 的 IANA 注册 MIME。
	);
	// 设置下载行为：attachment 表示附件；filename 为浏览器/Tauri 建议的默认文件名。
	res.setHeader(
		'Content-Disposition', // RFC 5987 相关头，此处用简单 ASCII filename。
		'attachment; filename="english-vocabulary-favorites.docx"', // attachment 触发「保存」而非 inline 打开（视客户端而定）。
	);
	// Content-Length 为字节数，帮助客户端显示进度或完整性检查；buf.length 为 Buffer 字节长度。
	res.setHeader('Content-Length', String(buf.length)); // Header 值须为字符串，故 String()。
	// res.end 发送 body 并结束响应；传入 Buffer 即原始二进制。
	res.end(buf);
}

// ---------- 经典句导出：路由与文件名不同，其余模式与单词导出一致 ----------
@Get('classic-quotes-favorites/export-docx') // 经典句收藏导出路径。
async exportClassicQuoteFavoritesDocx( // 方法名与资源对应，便于日志与路由检索。
	@Req() req: AuthedRequest, // 同上，取鉴权上下文。
	@Res() res: Response, // 同上，写原始响应。
): Promise<void> { // 同上，不 return JSON。
	const userId = req.user?.userId; // 同上，取用户主键。
	if (userId == null) { // 同上，鉴权守卫。
		throw new UnauthorizedException('未授权'); // 同上，401。
	}
	const buf = // 同上，接收 Buffer。
		await this.englishLearningService.exportClassicQuoteFavoritesDocxBuffer( // 调用另一 Service 方法，查经典句收藏表。
			userId, // 用户维度隔离数据。
		);
	res.setHeader( // 同上，声明 MIME。
		'Content-Type', // 头名。
		'application/vnd.openxmlformats-officedocument.wordprocessingml.document', // 与单词导出相同 MIME。
	);
	res.setHeader( // 同上，声明下载文件名建议值。
		'Content-Disposition', // 头名。
		'attachment; filename="english-classic-quote-favorites.docx"', // 默认文件名与单词导出区分。
	);
	res.setHeader('Content-Length', String(buf.length)); // 同上，字节长度。
	res.end(buf); // 同上，写出二进制并结束。
}
```

### 4.2 后端：Service 查询上限与调用 Builder

**来源**：`apps/backend/src/services/english-learning/english-learning.service.ts`（约 L2180–L2213）

```typescript
/** 导出收藏为 DOCX 时单次最多行数，避免超大文档占用内存 */
private static readonly FAVORITES_DOCX_EXPORT_MAX = 3000; // static readonly：编译期常量语义，全类共享且不可重新赋值。

/** 当前用户单词收藏导出为 Word（最多 FAVORITES_DOCX_EXPORT_MAX 条，按收藏时间倒序） */
async exportVocabularyFavoritesDocxBuffer(userId: number): Promise<Buffer> { // 公开异步方法，返回 Promise<Buffer> 供控制器 end。
	const rows = await this.vocabFavoriteRepo.find({ // TypeORM Repository：异步查询 favorite 表。
		where: { userId }, // SQL WHERE userId = ?，只取当前用户行。
		order: { createdAt: 'DESC' }, // 按收藏创建时间倒序，与产品「最新在前」一致。
		take: EnglishLearningService.FAVORITES_DOCX_EXPORT_MAX, // LIMIT 3000，与分页接口的 limit 无关。
	});
	// map：将每条 Entity 转为纯 POJO，供 docx builder 使用（避免把 TypeORM 元数据带进生成层）。
	const list = rows.map((r) => ({
		word: r.word, // 单词正文，必填字段。
		ipa: r.ipa ?? '', // 空合并：数据库 null/undefined 时变空串，避免 XML 里出现 undefined。
		translationZh: r.translationZh ?? '', // 中文释义，同理可空。
		example: r.example ?? '', // 例句，同理可空。
	}));
	// return：把 list 交给 builder；await 隐式包含在 build 函数内部（此处 build 已是 async）。
	return buildVocabularyFavoritesDocxBuffer(list); // 静态导入的纯函数，输出 Buffer。
}

/** 当前用户经典句收藏导出为 Word（最多 FAVORITES_DOCX_EXPORT_MAX 条，按收藏时间倒序） */
async exportClassicQuoteFavoritesDocxBuffer(userId: number): Promise<Buffer> { // 与单词方法对称。
	const rows = await this.classicQuoteFavoriteRepo.find({ // 另一张收藏表 Repository。
		where: { userId }, // 用户隔离。
		order: { createdAt: 'DESC' }, // 时间倒序。
		take: EnglishLearningService.FAVORITES_DOCX_EXPORT_MAX, // 同一上限常量。
	});
	const list = rows.map((r) => ({ // 映射为经典句 builder 所需字段集。
		english: r.english, // 英文原句。
		translationZh: r.translationZh ?? '', // 译文。
		source: r.source ?? '', // 出处。
		noteZh: r.noteZh ?? '', // 赏析。
	}));
	return buildClassicQuoteFavoritesDocxBuffer(list); // 另一 builder 入口。
}
```

### 4.3 后端：DOCX Builder（结构与截断）

**来源**：`apps/backend/src/services/english-learning/english-favorites-docx.builder.ts`（约 L1–L83；经典句镜像结构见同文件后半）

```typescript
/**
 * 文件头注释：声明本模块职责边界——只生成 docx 字节，不访问数据库、不做鉴权。
 */
import {
	Document, // 表示整份 Word 文档根节点。
	HeadingLevel, // 枚举：映射 Word 内置标题级别（如 HEADING_1）。
	Packer, // 将内存中的 Document 序列化为 Buffer / Blob。
	Paragraph, // 段落块级元素。
	TextRun, // 段落内连续文本及其样式（加粗、斜体）。
} from 'docx'; // 第三方库入口。

const FIELD_MAX = 12000; // 单字段默认最大字符数上限，用于 clip 的默认参数。

/** 截断过长字符串，避免单段 XML 过大 */
function clip(s: string, max: number = FIELD_MAX): string { // 默认 max 绑定 FIELD_MAX。
	if (!s) return ''; // 假值（undefined/null/''）直接返回空串，避免后续 trim 异常。
	const t = s.trim(); // 去掉首尾空白，减少无意义空格进入 Word。
	return t.length <= max ? t : `${t.slice(0, max)}…`; // 超长：截断并加省略号（Unicode 单字符）。
}

/** 单词收藏：标题 + 逐条（词、音标、释义、例句） */
export async function buildVocabularyFavoritesDocxBuffer( // export 供 Service 导入；async 因 Packer.toBuffer 为异步。
	rows: ReadonlyArray<{ // 只读数组类型，调用方不可在函数内被改引用。
		word: string; // 单词。
		ipa: string; // 音标。
		translationZh: string; // 释义。
		example: string; // 例句。
	}>,
): Promise<Buffer> { // 最终返回 Node Buffer，与控制器 res.end 类型一致。
	const children: Paragraph[] = [ // 先用数组收集所有段落，再一次性塞进 Document。
		new Paragraph({ // 文档主标题段。
			heading: HeadingLevel.HEADING_1, // 应用内置「标题 1」样式，便于导航窗格。
			children: [new TextRun({ text: '英语单词收藏', bold: true })], // 一个 TextRun：加粗标题文案。
		}),
		new Paragraph({ // 统计说明段。
			children: [new TextRun({ text: `共 ${rows.length} 条（按收藏时间倒序）` })], // 模板字符串插入条数。
		}),
		new Paragraph({ text: '' }), // 空段：视觉分隔标题与列表。
	];

	for (let i = 0; i < rows.length; i++) { // 下标从 0 到 length-1，与展示序号 i+1 区分。
		const r = rows[i]; // 当前行只读对象。
		children.push( // 向数组追加编号 + 词条行。
			new Paragraph({
				children: [
					new TextRun({ text: `${i + 1}. `, bold: true }), // 序号与句点，加粗。
					new TextRun({ text: clip(r.word, 500), bold: true }), // 词条最多 500 字符，防极端长词。
				],
			}),
		);
		if (r.ipa?.trim()) { // 可选链 + trim：无音标或全空白则跳过音标段。
			children.push(
				new Paragraph({
					children: [
						new TextRun({ text: '音标：', bold: true }), // 标签加粗。
						new TextRun({ text: clip(r.ipa, 500) }), // 音标内容单独 Run，默认不加粗。
					],
				}),
			);
		}
		children.push(
			new Paragraph({
				children: [
					new TextRun({ text: '释义：', bold: true }),
					new TextRun({ text: clip(r.translationZh) }), // 使用默认 FIELD_MAX 上限。
				],
			}),
		);
		children.push(
			new Paragraph({
				children: [
					new TextRun({ text: '例句：', bold: true }),
					new TextRun({ text: clip(r.example), italics: true }), // italics：例句用斜体区分正文。
				],
			}),
		);
		children.push(new Paragraph({ text: '' })); // 每条记录后空行，提高可读性。
	}

	const doc = new Document({ // 构造文档根。
		sections: [{ children }], // 单节文档：children 即正文流；节属性此处用库默认。
	});
	return Buffer.from(await Packer.toBuffer(doc)); // await 等待序列化；Buffer.from 确保为 Node Buffer 类型。
}
```

### 4.4 前端：API 路径常量

**来源**：`apps/frontend/src/service/api.ts`（约 L127–L148）

```typescript
/** 单词收藏：新增、取消、批量查询已收藏词形 */
export const ENGLISH_LEARNING_VOCABULARY_FAVORITES = // 命名导出，供其它模块 import。
	'/english-learning/vocabulary-favorites'; // 字符串常量：相对路径，与 http 客户端 baseURL 拼接成完整 URL。
/** 导出当前用户单词收藏为 Word（DOCX） */
export const ENGLISH_LEARNING_VOCABULARY_FAVORITES_EXPORT_DOCX = // 导出专用路径常量，语义与列表路径分离。
	'/english-learning/vocabulary-favorites/export-docx'; // 与 Nest 控制器 @Get('vocabulary-favorites/export-docx') 一一对应。

/** 经典句收藏：新增、取消、批量查询已收藏内容键（SHA256 hex） */
export const ENGLISH_LEARNING_CLASSIC_QUOTES_FAVORITES = // 经典句收藏资源根路径。
	'/english-learning/classic-quotes-favorites'; // 不以斜杠结尾，便于与 params 拼接时统一处理。
/** 导出当前用户经典句收藏为 Word（DOCX） */
export const ENGLISH_LEARNING_CLASSIC_QUOTES_FAVORITES_EXPORT_DOCX = // 经典句导出路径常量。
	'/english-learning/classic-quotes-favorites/export-docx'; // 与后端 classic-quotes-favorites/export-docx 对齐。
```

### 4.5 前端：Service 层下载（鉴权 + 双端落盘）

**来源**：`apps/frontend/src/service/index.ts`（约 L9–L11、L28–L34、L701–L744）

```typescript
import { downloadBlob } from '@/utils'; // 从 barrel 引入：内部区分 Web / Tauri 落盘方式。
import { http } from '@/utils/fetch'; // 项目封装 HTTP 客户端，默认带 Token、走 getPlatformFetch。
import { isTauriRuntime } from '@/utils/runtime'; // 布尔探测：是否在 Tauri WebView 环境。

// 同文件顶部从 './api' 已 import ENGLISH_LEARNING_VOCABULARY_FAVORITES_EXPORT_DOCX 与 ENGLISH_LEARNING_CLASSIC_QUOTES_FAVORITES_EXPORT_DOCX（与别的 ENGLISH_* 常量并列，此处不重复贴 import 块）。

/**
 * 内部函数：只供本文件两个 export 下载函数复用，不对外再 export。
 */
async function downloadEnglishFavoritesAuthorizedDocx( // async：内部含 await http.get / await downloadBlob。
	path: string, // API 路径常量，例如 '/english-learning/.../export-docx'。
	filename: string, // 建议本地文件名，常带时间戳避免覆盖。
): Promise<void> { // 无返回值：成功即结束；失败抛错由调用方 Toast。
	const { data } = await http.get<ArrayBuffer>(path, { silent: true }); // 解构 ResponseData.data；泛型 ArrayBuffer 提示解析目标类型；silent 抑制 http 内错误 Toast。
	if (!(data instanceof ArrayBuffer)) { // 严格运行时类型检查，防止把 JSON 对象当二进制。
		throw new Error('导出文件无效'); // 构造 Error，供上层 catch 取 message。
	}
	const blob = new Blob([data], { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' }); // 用二进制构造 Blob；type 为 MIME（多用途互联网邮件扩展类型）。
	const result = await downloadBlob( // await：Tauri 侧 invoke 为异步；Web 侧同步完成也会包在 Promise 里。
		{
			file_name: filename, // downloadBlob 选项：保存对话框或 <a download> 使用的文件名。
			id: `english-favorites-${Date.now()}`, // 任务 id：用于进度或去重（此处主要满足类型必填）。
			overwrite: true, // Tauri 另存为若目标存在则允许覆盖（行为依 Rust 侧实现）。
		},
		blob, // 第二参：Blob 实例，内部会转字节数组再 IPC。
	);
	if (result.success !== 'success') { // DownloadResult.success 为字面量联合类型，成功为 'success'。
		if (isTauriRuntime()) { // 桌面端：downloadBlob 已弹 Toast，这里静默返回。
			return; // 早退：不抛错，避免抽屉再弹一次错误/取消。
		}
		throw new Error(result.message || '下载失败'); // Web：无内置 Toast，抛出让抽屉 catch。
	}
}

/** 下载当前用户单词收藏 Word（服务端至多导出 3000 条） */
export async function downloadEnglishVocabularyFavoritesDocx(): Promise<void> { // export 给抽屉 import。
	await downloadEnglishFavoritesAuthorizedDocx( // await：直到下载流程结束或抛错。
		ENGLISH_LEARNING_VOCABULARY_FAVORITES_EXPORT_DOCX, // 单词导出 API 路径。
		`vocabulary-${Date.now()}.docx`, // 模板字符串：时间戳保证多次导出文件名不冲突。
	);
}

/** 下载当前用户经典句收藏 Word（服务端至多导出 3000 条） */
export async function downloadEnglishClassicQuoteFavoritesDocx(): Promise<void> { // 与上一 export 对称。
	await downloadEnglishFavoritesAuthorizedDocx( // 复用同一套鉴权 + Blob + downloadBlob 逻辑。
		ENGLISH_LEARNING_CLASSIC_QUOTES_FAVORITES_EXPORT_DOCX, // 经典句导出 API 路径。
		`classic-quote-${Date.now()}.docx`, // 另一前缀，区分文件来源。
	);
}
```

### 4.6 前端：单词收藏抽屉导出交互

**来源**：`apps/frontend/src/views/englishLearning/VocabularyFavoritesDrawer.tsx`（约 L13–L17、L48–L79）

```typescript
import {
	downloadEnglishVocabularyFavoritesDocx, // 具名导入：实际执行下载的 service 函数。
	type EnglishVocabularyFavoriteListEntry, // type 关键字：仅类型导入，编译后擦除，不增加运行时代码。
} from '@/service'; // 路径别名 @ 指向 src，聚合在 service/index.ts。
import { displayIpaWrapped, isTauriRuntime } from '@/utils'; // displayIpaWrapped：列表展示 IPA；isTauriRuntime：Toast 分支。

const exportDisabled = // 派生布尔：控制导出按钮 disabled。
	exportingDocx || loading || (!loading && entries.length === 0); // 三条件或：导出中禁用；首屏加载中禁用；已确认空列表禁用。

const handleExportDocx = async () => { // 箭头函数 + async：供 onClick 调用，可用 void 前缀吞 Promise。
	if (entries.length === 0 && !loading) { // 双条件：避免加载中误报「无可导出」。
		Toast({ // 来自 @ui，全局轻提示。
			type: 'info', // 信息级别，非错误。
			title: t('englishLearning.vocab.exportDocxEmpty'), // i18n：提示当前无收藏可导出。
		});
		return; // 早退：不进入 loading 态。
	}
	setExportingDocx(true); // React setState：按钮文案切到「加载中」并禁用点击。
	try { // try/catch/finally：捕获 service 抛出的 Error。
		await downloadEnglishVocabularyFavoritesDocx(); // 等待下载完成；内部已处理 Blob/Tauri。
		if (!isTauriRuntime()) { // 仅浏览器环境补成功 Toast（Tauri 由 downloadBlob 已提示）。
			Toast({
				type: 'success', // 成功样式（绿勾等，依主题）。
				title: t('englishLearning.vocab.exportDocxSuccess'), // i18n 成功文案。
			});
		}
	} catch (e) { // 捕获任意 throw（含 http 错误、downloadBlob Web 失败）。
		Toast({
			type: 'error', // 错误样式。
			title: // title 支持多行表达式：优先展示 Error.message。
				e instanceof Error // 运行时类型收窄。
					? e.message // Error 实例：通常含后端 message 或「导出文件无效」。
					: t('englishLearning.vocab.exportDocxFail'), // 非 Error：回退通用失败文案。
		});
	} finally { // 无论成功失败都执行：恢复按钮状态。
		setExportingDocx(false); // 关闭导出中标志。
	}
};
```

### 4.7 前端：经典句收藏抽屉（与单词对称）

**来源**：`apps/frontend/src/views/englishLearning/ClassicQuotesFavoritesDrawer.tsx`（约 L13–L17、L48–L79）

```typescript
import {
	downloadEnglishClassicQuoteFavoritesDocx, // 经典句专用下载函数（与单词函数不同名）。
	type EnglishClassicQuoteFavoriteListEntry, // 列表项类型：字段为 english/translationZh 等。
} from '@/service'; // 同一 barrel 出口。
import { isTauriRuntime } from '@/utils'; // 本抽屉不展示 IPA，故无需 displayIpaWrapped。

const exportDisabled = // 与单词抽屉相同逻辑：导出中、加载中、空列表时禁用。
	exportingDocx || loading || (!loading && entries.length === 0); // 与单词抽屉逐项含义相同。

const handleExportDocx = async () => { // 导出按钮点击处理函数。
	if (entries.length === 0 && !loading) { // 空列表且非加载态。
		Toast({
			type: 'info', // 非错误提示。
			title: t('englishLearning.classic.exportDocxEmpty'), // classic 命名空间下的 i18n key。
		});
		return; // 不发起网络请求。
	}
	setExportingDocx(true); // 进入导出中 UI 状态。
	try {
		await downloadEnglishClassicQuoteFavoritesDocx(); // 调用经典句导出 service。
		if (!isTauriRuntime()) { // 浏览器补成功提示。
			Toast({
				type: 'success',
				title: t('englishLearning.classic.exportDocxSuccess'), // 与 vocab 文案 key 对称。
			});
		}
	} catch (e) { // 网络或保存失败。
		Toast({
			type: 'error',
			title:
				e instanceof Error // 与单词抽屉相同收窄逻辑。
					? e.message
					: t('englishLearning.classic.exportDocxFail'),
		});
	} finally {
		setExportingDocx(false); // 恢复按钮可点。
	}
};
```

### 4.8 前端：抽屉 Footer 样式微调

**来源**：`apps/frontend/src/components/design/Drawer/index.tsx`（约 L115–L118）

```tsx
{footer && ( // 短路求值：无 footer 插槽时不渲染 SheetFooter，减少 DOM。
	<SheetFooter className="pt-3.5 py-2.5 border-t shrink-0 bg-background"> // SheetFooter：shadcn/sheet 底部区域组件；className 为 Tailwind 原子类组合。
		{footer} // 渲染调用方传入的 footer ReactNode（如导出按钮条）。
	</SheetFooter> // 闭合标签。
)} // 闭合 JSX 表达式与外层括号。
```

## 5. 兼容性与影响

- **鉴权**：导出路由与现有收藏接口一致依赖登录态；未登录应返回 401，前端 `http` 会走统一未授权处理（与 `silent` 组合行为以当前 `fetch.ts` 为准）。
- **文件名**：控制器 `Content-Disposition` 中的 `filename` 与前端 `downloadBlob` 的 `file_name`（带时间戳）可能不同：前者为服务端建议名，后者为用户侧另存为默认名，属预期差异。
- **回归建议**：Web 与 Tauri 各导出一次；空收藏、未登录、超过 0 条小于 3000、边界大文本截断；经典句与单词两条路由各测一遍。

## 6. 相关源码路径

| 说明 | 路径 |
|------|------|
| DOCX 拼装 | `apps/backend/src/services/english-learning/english-favorites-docx.builder.ts` |
| 导出查询与上限 | `apps/backend/src/services/english-learning/english-learning.service.ts` |
| 原始二进制响应 | `apps/backend/src/services/english-learning/english-learning.controller.ts` |
| 前端下载与类型 | `apps/frontend/src/service/index.ts` |
| API 常量 | `apps/frontend/src/service/api.ts` |
| 单词收藏抽屉 | `apps/frontend/src/views/englishLearning/VocabularyFavoritesDrawer.tsx` |
| 经典句收藏抽屉 | `apps/frontend/src/views/englishLearning/ClassicQuotesFavoritesDrawer.tsx` |
| 统一 Blob 下载 | `apps/frontend/src/utils/index.ts`（`downloadBlob`） |

若与仓库最新源码不一致，以源码为准。
