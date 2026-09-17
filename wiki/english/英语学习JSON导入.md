# 英语学习 JSON 独立导入页与嵌套路由

> **更新**：单词库子表持久化、multipart 大包上传、左栏 `EnglishSource` 等完整说明见 [英语学习文库导入.md](./英语学习文库导入.md)。经典语句库对称实现见 [经典语句库导入.md](./经典语句库导入.md)。  
> **音节划分 `segmentation`、导入页编辑后实时校验**：见 [单词分词导入.md](./单词分词导入.md)。

## 1. 背景与目标

- **用户问题**：单词包、经典语句区块的「导入」原先仅占位（`console.log`），无法在应用内完成 JSON 校验与预览。
- **目标**：提供独立路由 **`/english-learning/import`**，通过查询参数 **`kind=vocab` / `kind=classic`** 区分导入类型；支持拖拽或点击选择 `.json`、Monaco 编辑预览、错误提示、标题输入与「重新上传」、保存入口（当前保存逻辑仍为占位 `console.log`，后续可接 API / Store）。
- **配套**：顶栏标题需识别**嵌套路由**真实 pathname；Monaco 增加 **`compactChrome`** 以在嵌入场景占满高度；默认编辑器选项关闭 **unicode 高亮告警**，避免中文 JSON 顶栏干扰。

---

## 2. 改动范围

| 类型 | 路径 |
|------|------|
| 路由 | `apps/frontend/src/router/routes.ts` |
| 布局壳（新建） | `apps/frontend/src/views/englishLearning/EnglishLearningLayout.tsx` |
| 导入页（新建） | `apps/frontend/src/views/englishLearning/EnglishLearningImportPage.tsx` |
| 单词 / 经典区块入口 | `apps/frontend/src/views/englishLearning/VocabularySection.tsx`、`ClassicQuotesSection.tsx` |
| 顶栏标题解析 | `apps/frontend/src/components/design/Header/index.tsx` |
| Monaco 封装 | `apps/frontend/src/components/design/Monaco/index.tsx`、`options.ts` |
| 拖拽上传组件（新建目录） | `apps/frontend/src/components/design/DragDropFileUpload/`（主文件 `index.tsx`） |
| 文案 | `apps/frontend/src/i18n/locales/zh-CN.ts`、`en-US.ts` |
| 构建缓存（可忽略文档） | `apps/frontend/tsconfig.tsbuildinfo` |

**说明**：`DragDropFileUpload` 与导入页在部分工作区可能为 **未跟踪（untracked）** 文件；若与本地 `git status` 不一致，以仓库为准。

---

## 3. 实现思路与步骤

### 步骤 1：路由嵌套

1. 将原 `/english-learning` 单层 `Component: EnglishLearning` 改为 **`EnglishLearningLayout`**，子路由 **`index: true`** 仍渲染原首页 **`EnglishLearning`**。
2. 新增子路由 **`path: 'import'`**（完整 URL 为 **`/english-learning/import`**），挂载 **`EnglishLearningImportPage`**，并配置 **`meta.titleKey`** 供顶栏与文档标题使用。

### 步骤 2：顶栏标题与 pathname 对齐

嵌套后子路由的 `path` 在配置里多为**相对片段**（如 `'import'`），而 `location.pathname` 为**绝对路径**（如 `/english-learning/import`）。原 `Header` 用 `route.path === pathname` 无法命中。  
引入 **`resolveAbsolute(route, parentBase)`**：把父级前缀与子 `path` 拼接；**`index` 路由**继承父级 pathname；再以 **`findRouteTitle(..., parentBase)`** 递归子节点匹配当前路径，从而解析 **`titleKey`**。

### 步骤 3：左栏「导入」跳转

在 **`VocabularySection`** / **`ClassicQuotesSection`** 使用 **`useNavigate`**，分别跳转 **`?kind=vocab`** 与 **`?kind=classic`**，按钮文案改为 i18n 键 **`englishLearning.vocab.import`** / **`englishLearning.classic.import`**。

### 步骤 4：导入页数据流

1. **`useSearchParams`** 读取 `kind`，默认 **`vocab`**。
2. **`DragDropFileUpload`**：接受 **仅 `.json`**（`acceptExtensionOnly` + `pickFiles`）、`maxCount={1}`，回调 **`onDropZoneFiles`** → **`processJsonFile`**。详见 **§7**。
3. **`FileReader`** 读 UTF-8 → **`JSON.parse`**；失败则 **`jsonErrorKind: 'parse'`** 并保留原始文本便于手改。
4. 成功则 **`JSON.stringify(..., null, 2)`** 写入 **`previewText`**，驱动 **`MarkdownEditor`**（`language="json"`）；同时 **`parseVocabularyImport` / `parseClassicImport`** 填充 **`parsedVocab` / `parsedClassic`** 或 **`structFailReason`**。
5. **「重新上传」**：与空态上传区共用 **`pickEnglishLearningJsonFile()`**（Tauri 为仅 JSON 系统对话框）；不再使用根级隐藏 `input`。
6. **保存**：校验无 JSON/结构错误、已解析条数、标题非空；通过后当前为 **`console.log`** 占位。

### 步骤 5：Monaco 与编辑器默认项

- **`compactChrome`**：隐藏内置顶栏条，根容器与编辑区使用 **flex + `min-h-0`**，**`Editor` 的 `height`** 在紧凑模式下为 **`100%`**，**`layout` effect** 依赖中增加 **`compactChrome`**，避免切换后高度未重算。
- **`unicodeHighlight`**：在 **`options.ts`** 中关闭 **ambiguous / nonBasicASCII / invisible** 相关高亮提示，减少中文内容编辑时的噪音。

### 步骤 6：国际化

在 **`zh-CN.ts` / `en-US.ts`** 增加 **`route.englishLearning.import.title`**、**`englishLearning.import.*`** 全套导入页与错误文案，以及 **`englishLearning.vocab.import`**、**`englishLearning.classic.import`**。

---

## 4. 关键代码与注释

### 4.1 路由嵌套与导入子路由

**来源**：`apps/frontend/src/router/routes.ts`（约 L120–L141）

```typescript
// 说明：/english-learning 使用布局组件，子路由由 Outlet 渲染
{
	path: '/english-learning',
	Component: EnglishLearningLayout,
	meta: {
		titleKey: 'route.englishLearning.title',
	},
	children: [
		{
			index: true, // 说明：访问 /english-learning 仍打开原学习首页
			Component: EnglishLearning,
			meta: {
				titleKey: 'route.englishLearning.title',
			},
		},
		{
			path: 'import', // 说明：实际 URL 为 /english-learning/import（相对父 path 拼接）
			Component: EnglishLearningImportPage,
			meta: {
				titleKey: 'route.englishLearning.import.title',
			},
		},
	],
},
```

### 4.2 英语学习布局壳（Outlet）

**来源**：`apps/frontend/src/views/englishLearning/EnglishLearningLayout.tsx`（约 L1–L11）

```typescript
/**
 * 英语学习路由壳：子路由为首页（index）与导入页（import）。
 * 说明：仅负责占位与高度约束，具体页面由各子路由 Component 渲染。
 */
import { Outlet } from 'react-router';

export default function EnglishLearningLayout() {
	return (
		<div className="h-full min-h-0 w-full min-w-0">
			{/* 说明：Outlet 渲染 index 的 EnglishLearning 或 import 的 EnglishLearningImportPage */}
			<Outlet />
		</div>
	);
}
```

### 4.3 Header：嵌套路由 pathname 与 meta 解析

**来源**：`apps/frontend/src/components/design/Header/index.tsx`（约 L46–L93）

```typescript
const title = useMemo(() => {
	const metaOf = (r: RouteConfig) => r.meta?.titleKey || r.meta?.title;

	/** 将当前 route 与父级前缀拼成绝对 pathname（与 React Router 嵌套路由一致） */
	const resolveAbsolute = (
		route: RouteConfig,
		parentBase: string,
	): string | null => {
		if (route.index) {
			// 说明：索引路由没有 path 片段，pathname 就是父级已解析的前缀
			return parentBase || null;
		}
		if (!route.path) return null;
		if (route.path.startsWith('/')) {
			// 说明：已是绝对路径，直接使用
			return route.path;
		}
		if (!parentBase) {
			// 说明：顶层相对 path，规范成以 / 开头
			return `/${route.path}`.replace(/\/+/g, '/');
		}
		// 说明：子级相对 path，拼到 parentBase 后去重多余的 /
		return `${parentBase.replace(/\/$/, '')}/${route.path}`.replace(
			/\/+/g,
			'/',
		);
	};

	const findRouteTitle = (
		routeList: RouteConfig[],
		pathname: string,
		parentBase: string,
	): string | undefined => {
		for (const route of routeList) {
			const absolute = resolveAbsolute(route, parentBase);
			if (absolute === pathname) {
				const m = metaOf(route);
				if (m) return m;
			}
			if (route.children?.length) {
				const nextBase = absolute ?? parentBase;
				const nested = findRouteTitle(route.children, pathname, nextBase);
				if (nested) return nested;
			}
		}
		return undefined;
	};

	return (
		findRouteTitle(routes, location.pathname, '') ??
		routes.find((i) => i.path === '/chat/:id?')?.meta?.title
	);
}, [location.pathname]);
```

### 4.4 左栏跳转导入页

**来源**：`apps/frontend/src/views/englishLearning/VocabularySection.tsx`（约 L512–L515）

```typescript
// 导入单词：跳转独立导入页
const onImportVocabulary = useCallback(() => {
	navigate('/english-learning/import?kind=vocab'); // 说明：查询参数驱动导入页解析模式
}, [navigate]);
```

**来源**：`apps/frontend/src/views/englishLearning/ClassicQuotesSection.tsx`（约 L513–L516）

```typescript
// 导入语句：跳转独立导入页
const onImportClassicQuotes = useCallback(() => {
	navigate('/english-learning/import?kind=classic');
}, [navigate]);
```

### 4.5 导入页：kind、读文件、解析与重新上传

**来源**：`apps/frontend/src/views/englishLearning/EnglishLearningImportPage.tsx`（约 L99–L105、L152–L230、L302–L312）

```typescript
// 说明：URL ?kind=classic 时为经典语句，否则默认单词 vocab
const kind: ImportKind = useMemo(() => {
	return searchParams.get('kind') === 'classic' ? 'classic' : 'vocab';
}, [searchParams]);

const processJsonFile = useCallback(
	(file: File) => {
		resetParsed(); // 说明：新文件前先清空上一轮的解析态与错误
		const reader = new FileReader();
		reader.onload = () => {
			const text = typeof reader.result === 'string' ? reader.result : '';
			let parsed: unknown;
			try {
				parsed = text ? JSON.parse(text) : null;
				setJsonErrorKind(null);
			} catch {
				setJsonErrorKind('parse');
				setStructFailReason(null);
				// 非法 JSON 时仍展示完整原始文本，便于对照修正
				setPreviewText(text);
				return;
			}
			const pretty = JSON.stringify(parsed, null, 2);
			setPreviewText(pretty);

			if (kind === 'vocab') {
				const res = parseVocabularyImport(parsed);
				if (res.ok) {
					setParsedVocab(res.items);
					setParsedClassic(null);
					setStructFailReason(null);
				} else {
					setStructFailReason(res.reason);
				}
			} else {
				const res = parseClassicImport(parsed);
				if (res.ok) {
					setParsedClassic(res.items);
					setParsedVocab(null);
					setStructFailReason(null);
				} else {
					setStructFailReason(res.reason);
				}
			}
		};
		reader.onerror = () => {
			setJsonErrorKind('read');
			setPreviewText('');
		};
		reader.readAsText(file, 'UTF-8');
	},
	[kind, resetParsed],
);

/** 标题栏「重新上传」：清空当前内容并打开文件选择（与拖拽区 accept 一致） */
const onReuploadHiddenFileChange = useCallback(
	(e: ChangeEvent<HTMLInputElement>) => {
		const file = e.target.files?.[0];
		e.target.value = ''; // 说明：允许用户再次选择同一文件名
		if (file) processJsonFile(file);
	},
	[processJsonFile],
);

const onReupload = useCallback(() => {
	resetParsed();
	setPreviewText('');
	reuploadInputRef.current?.click(); // 说明：必须在用户手势同步路径内调用，才能稳定打开系统文件框
}, [resetParsed]);
```

```tsx
{/* 说明：始终挂在 DOM，避免预览态下 DragDropFileUpload 卸载导致无法编程式选文件 */}
<input
	ref={reuploadInputRef}
	type="file"
	accept=".json,application/json"
	className="hidden"
	aria-hidden
	tabIndex={-1}
	onChange={onReuploadHiddenFileChange}
/>
```

### 4.6 Monaco：`compactChrome` 与编辑器高度

**来源**：`apps/frontend/src/components/design/Monaco/index.tsx`（约 L246–L250、L1493–L1554）

```typescript
/**
 * 紧凑模式：隐藏顶栏（标题/工具区），编辑区域在父级 flex 布局下占满剩余高度。
 * 请与外层 `h-full min-h-0 flex-1` 及 `height="100%"` 配合使用。
 */
compactChrome?: boolean;

// ... 组件内 ...
const editorPixelHeight = compactChrome ? '100%' : height;

return (
	<div
		className={cn(
			'relative min-w-0 max-w-full overflow-hidden',
			compactChrome && 'flex h-full min-h-0 flex-col',
			className,
		)}
		ref={rootRef}
	>
		<div
			className={cn(
				'flex h-full min-h-0 min-w-0 flex-col overflow-hidden rounded-md bg-theme/5',
				compactChrome && 'min-h-0 flex-1',
			)}
		>
			{!compactChrome ? (
				<div className={cn('flex h-10 min-w-0 shrink-0 items-center gap-2 border-b border-theme/5')}>
					{/* 说明：默认顶栏：自定义 title + Markdown 底栏开关等 */}
				</div>
			) : null}

			<div
				className={cn(
					'box-border min-h-0 min-w-0 max-w-full overflow-hidden',
					compactChrome && 'flex min-h-0 flex-1 flex-col',
				)}
				style={compactChrome ? undefined : { height }}
			>
				<Editor
					height={editorPixelHeight}
					// ...
				/>
			</div>
		</div>
	</div>
);
```

### 4.7 Monaco 默认选项：关闭 unicode 顶栏告警

**来源**：`apps/frontend/src/components/design/Monaco/options.ts`（约 L68–L73）

```typescript
// 中文 JSON / Markdown 等含大量非 ASCII 时，Monaco 会弹出「ambiguous unicode characters」顶栏警告
unicodeHighlight: {
	ambiguousCharacters: false,
	nonBasicASCII: false,
	invisibleCharacters: false,
},
```

### 4.8 DragDropFileUpload：编程式打开文件选择与 input 清空

**来源**：`apps/frontend/src/components/design/DragDropFileUpload/index.tsx`（约 L282–L294）

```typescript
const onInputChange = useCallback(
	(e: ChangeEvent<HTMLInputElement>) => {
		const files = e.target.files;
		if (files?.length) emit(files, 'input');
		e.target.value = ''; // 说明：一次选择结束后清空，便于下次 onChange 仍触发
	},
	[emit],
);

const openFilePicker = useCallback(() => {
	if (optsRef.current.disabled) return;
	inputRef.current?.click(); // 说明：委托给隐藏的原生 file input
}, []);
```

---

## 5. 兼容性与影响

- **URL**：原 **`/english-learning`** 仍由 **index 子路由** 承接，旧书签与跳转一般**无需修改**。
- **顶栏**：凡使用**相对 path + children** 的路由，只要 **`meta.titleKey` / `title`** 配置正确，均可被新的 **`findRouteTitle`** 命中。
- **保存**：导入页「保存到单词库 / 经典语句库」当前为占位日志；上线前需替换为真实持久化并处理失败 Toast。

---

## 6. 建议回归测试

| 场景 | 操作 |
|------|------|
| 嵌套标题 | 打开 `/english-learning`、`/english-learning/import`，确认顶栏标题与 i18n 一致 |
| 单词导入入口 | 左栏单词区点「导入单词」，URL 含 `kind=vocab` |
| 经典导入入口 | 左栏经典区点「导入语句」，URL 含 `kind=classic` |
| 拖拽 JSON | 合法 / 非法 JSON、结构不符时的错误文案 |
| 重新上传 | 预览态点击「重新上传」，选新文件后预览与解析更新 |
| Monaco | 若某页传入 **`compactChrome`**，确认编辑区纵向撑满且无双重顶栏 |

---

## 7. 严格 `.json` 文件选择（增补）

### 7.1 问题

仅设置 `accept=".json,application/json"` 时：

- 系统文件对话框仍常出现「所有文件」或可按 MIME 误匹配；
- 用户反馈「设置了 accept 仍能选其它类型」。

### 7.2 方案（与知识库 `.md` 导入同构）

| 层级 | 做法 |
|------|------|
| **Tauri** | `select_english_learning_import_json_file` + `read_english_learning_import_json_file`（`common.rs`） |
| **Web** | `accept=".json"` + 选中后扩展名校验（`not_json`） |
| **拖拽** | `DragDropFileUpload` 的 **`acceptExtensionOnly`**（忽略 MIME，只认 `.json`） |
| **点击上传** | **`pickFiles`** 注入 `pickEnglishLearningJsonFile`，桌面端不走隐藏 input |

新建 **`englishLearningImportFile.ts`** 统一 Web/Tauri 分支；导入页通过 **`pickImportJsonFiles`** 传给 `DragDropFileUpload` 与「重新上传」。

### 7.3 `DragDropFileUpload` 新增能力

**来源**：`apps/frontend/src/components/design/DragDropFileUpload/index.tsx`（选项与 `openFilePicker`，约 L50–L63、L320 附近）

```typescript
// acceptExtensionOnly：parseFileList 内用 matchAcceptExtensionOnly，避免 application/json MIME 误放行
acceptExtensionOnly?: boolean;

// pickFiles：若提供，点击区域/编程式 open 调用自定义选择器（Tauri 原生对话框）
pickFiles?: () => Promise<File[] | null>;
```

### 7.4 Tauri 命令

**来源**：`apps/frontend/src-tauri/src/command/common.rs`（约 L31–L56）

```rust
// 对话框过滤器仅 ["json"]
pub fn select_english_learning_import_json_file() -> Result<String, String> { ... }

// 读取前再次校验路径以 .json 结尾
pub fn read_english_learning_import_json_file(file_path: String) -> Result<String, String> { ... }
```

前端将读到的字符串包装为 `new File([content], fileName, { type: 'application/json' })`，后续仍走既有 **`processJsonFile`**。

### 7.5 导入页接线

**来源**：`apps/frontend/src/views/englishLearning/import/EnglishLearningImportPage.tsx`（`DragDropFileUpload` 与 `pickImportJsonFiles`，约 L227–L260、L500 附近）

```tsx
<DragDropFileUpload
  accept={JSON_IMPORT_ACCEPT}       // '.json'
  acceptExtensionOnly
  pickFiles={pickImportJsonFiles}   // Tauri: 系统对话框；Web: 隐藏 input
  onReject={...}                    // 拖拽非 .json → Toast
/>
```

**来源**：`apps/frontend/src/views/englishLearning/import/englishLearningImportFile.ts`（全文）

知识库 Markdown 导入的平行实现见 [`../knowledge/知识Markdown导入.md`](../knowledge/知识Markdown导入.md)。

---

## 8. 相关源码路径速查

| 说明 | 路径 |
|------|------|
| 路由表 | `apps/frontend/src/router/routes.ts` |
| 导入页 | `apps/frontend/src/views/englishLearning/EnglishLearningImportPage.tsx` |
| JSON 选择工具 | `apps/frontend/src/views/englishLearning/import/englishLearningImportFile.ts` |
| 布局壳 | `apps/frontend/src/views/englishLearning/EnglishLearningLayout.tsx` |
| 顶栏 | `apps/frontend/src/components/design/Header/index.tsx` |
| Monaco | `apps/frontend/src/components/design/Monaco/index.tsx`、`options.ts` |
| 拖拽上传 | `apps/frontend/src/components/design/DragDropFileUpload/index.tsx` |
| Tauri JSON 命令 | `apps/frontend/src-tauri/src/command/common.rs` |

若与仓库最新源码不一致，**以源码为准**。
