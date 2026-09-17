# 学习笔记导出 Word 与长文性能优化

## 1. 背景与目标

学习笔记插件（`apps/remote-plugins/src/views/learning-notes/`）此前已具备 CRUD、列表分页、富文本编辑、预览等基础能力，但在以下两点上仍有缺口：

1. **导出能力缺失**：用户写完一篇笔记后无法把它导出成可离线归档 / 分发的 Word（DOCX）文件；既有收藏模块已实现 DOCX 落盘，但学习笔记域未接入。
2. **长文性能退化**：单篇笔记 HTML 体积较大时，编辑器挂载会出现明显卡顿，预览首帧白屏，工具栏 `ResizeObserver` 在每次按键都会触发全量 `getBoundingClientRect`，`TitleNode.appendTransaction` 在仅选区变化时也会扫全文做结构修复。

本轮针对上述两点做了一次端到端落地，目标：

- 学习笔记支持「一键导出当前预览笔记为 DOCX」，复用主站 Host 桥的 `downloadBlob` 能力，Web 与 Tauri 桌面端统一落盘，Tauri 端失败由 Host Toast、Web 端由插件 Toast，避免重复提示。
- 长文编辑 / 预览的挂载从「同步解析 TipTap + 全量 DOM」改为「先 Loading 遮罩 → 下一帧挂载 → 大文本走 `LargeNoteEditor` / `WindowedPreviewBody`」，并把富文本编辑器里图片缩放、表格列宽拖拽、字数统计、`appendTransaction`、工具栏溢出测量等若干热路径改为按需 / 浅比较，降低无谓的全量计算。

## 2. 改动范围

### 2.1 DOCX 导出链路

- **后端**
  - `apps/backend/src/services/learning-notes/learning-notes.controller.ts` — 新增 `exportDocx` 路由 `GET /english-learning/notes/export-docx/:id`，用 `@Res()` 直写二进制。
  - `apps/backend/src/services/learning-notes/learning-notes.service.ts` — 新增 `exportDocxBuffer(userId, id)`：取笔记 → 体积上限校验 → 调用 builder。
  - `apps/backend/src/services/learning-notes/learning-note-docx.builder.ts` — 新文件，封装 HTML → DOCX Buffer。
  - `apps/backend/src/interceptors/response.interceptor.ts` — `intercept` 增加「`headersSent` / `writableEnded` 时跳过 JSON 包装」短路逻辑，避免对 `@Res()` 已写完的二进制再裹一层 `{ data, code, message }`。
- **Host 桥（前端主站）**
  - `apps/frontend/src/plugins/core/types.ts` — `HostBridgeProps.api.ui` 新增可选 `downloadBlob`。
  - `apps/frontend/src/plugins/core/createHostBridge.ts` — `ui:toast` 权限下挂 `downloadBlob` 实现：复用主站 `downloadBlob` + `isTauriRuntime`，Tauri 成功 / 失败由 Host Toast。
  - `apps/frontend/src/plugins/core/attachIframeBridge.ts` — RPC `dispatchRpc` 新增 `ui.downloadBlob` 分支，校验入参后透传给 `api.ui.downloadBlob`。
- **远端插件侧**
  - `apps/remote-plugins/src/utils/iframeHostClient.ts` — bridge `ui` 增加 `downloadBlob`，经 RPC `ui.downloadBlob` 回调 Host。
  - `apps/remote-plugins/src/utils/mockHost.ts` — 独立预览无 Tauri：新增 `mockDownloadBlob`，用浏览器 `<a download>` 模拟。
  - `apps/remote-plugins/src/views/learning-notes/api.ts` — `createNotesApi` 新增 `exportDocx(id)`：`http.get` 拉二进制并归一成 `ArrayBuffer`。
  - `apps/remote-plugins/src/store/learningNotes.ts` — `bind` 多收一个 `downloadBlob`；新增 `exportingDocx` 状态与 `exportPreviewDocx()` action；`openPreview` 改为乐观预览（先壳后详情）。
  - `apps/remote-plugins/src/views/learning-notes/index.tsx` — 预览头部新增「导出 DOCX」按钮；`store.bind` 多传 `api.ui?.downloadBlob`。
  - i18n 文案新增导出相关 key（`exportDocx` / `exportingDocx` / `toast.exportOk` / `toast.exportFail` / `toast.exportEmpty` / `toast.exportNoDownload` / `toast.exportInvalid` / `toast.httpDeniedExport`）。

### 2.2 长文性能优化

- `apps/remote-plugins/src/components/design/RichEditor/title/TitleNode.ts` — `appendTransaction` 把结构修复限制在 `docChanged`；`bodyEmpty` 用 `childCount` + `child(1).content.size` 判断，避免 `textBetween` 扫全文。
- `apps/remote-plugins/src/components/design/RichEditor/title/Title.tsx` — 把标题 UI 抽到新组件 `NoteTitleField`，`TitleView` 只保留 NodeView 壳。
- `apps/remote-plugins/src/components/design/RichEditor/title/NoteTitleField.tsx` — 新文件，徽章 + Input + 字数 UI，编辑器内外复用。
- `apps/remote-plugins/src/components/design/RichEditor/types.ts` — `CreateExtensionsOptions` / `RichEditorProps` 新增 `imageResize`、`tableResizable`、`onBodyScroll`、`renderBody`。
- `apps/remote-plugins/src/components/design/RichEditor/extensions/index.ts` — 图片缩放 / 表格列宽改为 `opt-in`（默认 `false`）；`StarterKit` 增加 `undoRedo: { depth: 50 }`。
- `apps/remote-plugins/src/components/design/RichEditor/toolbar/Toolbar.tsx` — `ResizeObserver` 依赖从 `[tools]` 改为 `[tools.length, t, linkOpen]`，避免每键触发全量测量。
- `apps/remote-plugins/src/components/design/NotePreview/index.tsx` — 新增 `children` 插槽与 `loading` 态，供长文走 `WindowedPreviewBody`。
- `apps/remote-plugins/src/views/learning-notes/utils/` — 新增 `isLargeNoteHtml` 判定。
- `apps/remote-plugins/src/views/learning-notes/components/Editor/` — 新增 `LargeNoteEditor`（分页 / 懒挂 TipTap）。
- `apps/remote-plugins/src/views/learning-notes/components/PreviewBody/` — 新增 `WindowedPreviewBody`（虚拟滚动预览）。
- `apps/remote-plugins/src/views/learning-notes/components/NotesListPanel/` — 抽出列表面板。
- `apps/remote-plugins/src/views/learning-notes/index.tsx` — 重构：先 Loading → 下一帧挂编辑器；长文走 `LargeNoteEditor` / `WindowedPreviewBody`；列表抽到 `NotesListPanel`；新增导出按钮。

## 3. 实现思路

### 3.1 DOCX 导出

1. **后端 builder + 路由**：服务层 `exportDocxBuffer` 复用既有 `requireOwned`，确保用户只能导出自己拥有的笔记；体积超 `NOTE_DOCX_HTML_MAX_CHARS` 直接 `BadRequestException`，避免 builder 把超大 HTML 一次性塞进 DOCX 内存。控制器用 `@Res() res: Response` 直接 `res.end(buf)`，绕过 NestJS 默认返回值序列化。
2. **ResponseInterceptor 短路**：原本 `intercept` 无条件把返回值包成 `{ data, code, message }`，对二进制无效。改为从 `context.switchToHttp().getResponse()` 读 `headersSent` / `writableEnded`，已写完则原样返回（控制器已 `res.end`，`next.handle()` 的值实际不会再到客户端，但仍要走 RxJS 管道以免报错）。
3. **Host `downloadBlob` 统一落盘**：前端主站已有 `downloadBlob`（Tauri `download_blob` + Web `<a download>`），把它纳入 `HostBridgeProps.api.ui` 并受 `ui:toast` 权限收口，与 `showToast` 同权。Tauri 端 `downloadBlob` 内部已 Toast，因此返回值带 `hostToasted: boolean` 让插件决定是否再弹一次。
4. **iframe RPC 透传**：untrusted iframe 走 `postMessage` RPC，`attachIframeBridge.dispatchRpc` 新增 `ui.downloadBlob` 分支，对入参做最小校验（`fileName` 与 `data` 必填）。
5. **插件侧 store**：`exportPreviewDocx` 串行：`api.exportDocx(id)` 拿 ArrayBuffer → 用 `note.title` 生成安全文件名（去 `\/:*?"<>|`，截 60 字）→ 调 `downloadBlob` 落盘 → 据 `hostToasted` 决定是否补 Toast。`exportingDocx` 状态防重入。
6. **乐观预览**：`openPreview` 改为先用列表命中数据（标题 / at）立刻进入预览壳，再异步拉详情替换。慢网下用户不再盯着白屏，且 `loadingDetail` 与遮罩配合，列表命中数据先呈现，详情到达后无缝替换。
7. **乐观预览的失败回滚**：若详情拉失败且当前预览的 `html` 仍为空，则把 `preview` 清空，避免壳卡在「无内容」状态。

### 3.2 长文性能优化

1. **`appendTransaction` 拆分文档变更与选区变更**：原实现只要 `docChanged || selectionSet` 就跑结构修复（扫全文找多余 title、补正文段）。重构后：结构修复只在 `docChanged` 时跑；选区变更只做光标钉回（GapCursor / 非正文块 / 空正文）。
2. **`bodyEmpty` 用 `childCount` 判断**：原 `textBetween(titleSize, end).length` 会扫整段正文文本，长文下每键 O(n)。改为 `nextDoc.childCount <= 2 && (childCount < 2 || nextDoc.child(1).content.size === 0)`，仅判断第二段是否为空，O(1)。
3. **图片缩放 / 表格列宽 opt-in**：原默认开启，长文下 NodeView / 监听开销大。改为默认 `false`，由调用方（学习笔记）显式传 `imageResize / tableResizable`。
4. **`undoRedo.depth = 50`**：TipTap 3 用 `undoRedo` 而非 `history`，长文下默认深度会持续累积事务，限制到 50 降低内存与事务体积。
5. **Title UI 抽取 `NoteTitleField`**：TipTap `TitleView` 与长文窗外标题共用一份 UI，避免两套样式漂移；`TitleView` 退化为 NodeView 壳。
6. **工具栏 `ResizeObserver` 依赖收敛**：原 `useEffect(... [tools])`，`tools` 是 `useMemo` 出来的数组，每键 state 变都会新数组（即便槽位数不变），触发全量 `getBoundingClientRect`。改为 `useLayoutEffect(... [tools.length, t, linkOpen])`：只有槽位数 / 文案 / 链接开关变化才重测；并合并成单 `useLayoutEffect`，初始测量与 ResizeObserver 共用 `recalc`。
7. **编辑器懒挂载**：`LearningNotesApp` 新增 `mountEditor` 状态，进入编辑态时先 `setMountEditor(false)` + `requestAnimationFrame(() => setMountEditor(true))`，让 Loading 遮罩先画出来再挂 TipTap，避免长文解析时连遮罩都刷不出来。
8. **长文走专用组件**：`isLargeNoteHtml(html)` 判定后，编辑走 `LargeNoteEditor`（分页 / 懒挂 TipTap），预览走 `WindowedPreviewBody`（虚拟滚动），普通长度仍走 `RichEditor` / `NotePreview` 直挂。
9. **列表面板抽取**：`NotesListPanel` 独立组件，主视图只在 `store.listOpen` 时挂面板，缩窄编辑器时不再渲染列表 DOM。

## 4. 关键代码对比与注释

### 4.1 `response.interceptor.ts` — `intercept` 方法

**对比范围**：`ResponseInterceptor.intercept` 完整方法（含签名到 `}`）。

**改动前** · `apps/backend/src/interceptors/response.interceptor.ts`（基线，`intercept` 方法）

```typescript
// 拦截器方法签名：NestInterceptor 约定返回 Observable<Data<T>>
intercept(
        // 执行上下文：可拿到 request / response
        _context: ExecutionContext,
        // 下游 handler：调用 next.handle() 触发实际路由
        next: CallHandler,
): Observable<Data<T>> {
        // 直接把下游返回值包成统一响应体
        return next.handle().pipe(
                map((data) => {
                        // 无条件包装：对二进制无效
                        return {
                                data,
                                code: HttpStatus.OK,
                                message: 'success',
                        };
                }),
        );
}
```

**改动后** · `apps/backend/src/interceptors/response.interceptor.ts`（`intercept` 方法，约 L17–L39）

```typescript
// 拦截器方法签名：返回 Observable<Data<T>>
intercept(
        // 执行上下文：用于读 http 响应对象
        context: ExecutionContext,
        // 下游 handler
        next: CallHandler,
): Observable<Data<T>> {
        // 从上下文拿 HTTP 响应，标注 headersSent / writableEnded 两个可选字段
        const httpRes = context.switchToHttp().getResponse<{
                headersSent?: boolean;
                writableEnded?: boolean;
        }>();
        // 接管下游返回值
        return next.handle().pipe(
                map((data) => {
                        // @Res() 已写完二进制（如 DOCX）时勿再包一层 JSON
                        if (httpRes?.headersSent || httpRes?.writableEnded) {
                                // 直接原样返回，避免对二进制再序列化为 { data, code, message }
                                return data as Data<T>;
                        }
                        // 普通接口：统一包装
                        return {
                                data,
                                code: HttpStatus.OK,
                                message: '请求成功',
                                success: true,
                        };
                }),
        );
}
```

### 4.2 `learning-notes.controller.ts` — `exportDocx` 方法

**对比范围**：新增的 `exportDocx` 方法（含装饰器到方法闭合 `}`）。

**改动前** · `apps/backend/src/services/learning-notes/learning-notes.controller.ts`（基线：无 `exportDocx` 方法；控制器仅含 `save / list / detail / update / remove`）

```typescript
// 无 exportDocx：不支持导出 DOCX
```

**改动后** · `apps/backend/src/services/learning-notes/learning-notes.controller.ts`（`exportDocx` 方法，约 L50–L68）

```typescript
// 路由注释：导出单篇笔记 DOCX，原始二进制，与列表分页无关
/** 导出单篇笔记 DOCX（原始二进制；与列表分页无关） */
// GET 路由：路径参数 id 走 UUID 校验
@Get('export-docx/:id')
// 异步方法：返回 void（响应直接走 @Res()）
async exportDocx(
        // 取登录用户 id（JwtGuard 已写入 req.user）
        @Req() req: AuthedRequest,
        // 路径参数 id：ParseUUIDPipe 校验合法性
        @Param('id', ParseUUIDPipe) id: string,
        // 注入原生 Response：用 res.end(buf) 直写二进制，绕过 NestJS 序列化
        @Res() res: Response,
): Promise<void> {
        // 调 service 生成 DOCX Buffer（含权限校验与体积上限）
        const buf = await this.notesService.exportDocxBuffer(this.userId(req), id);
        // 设置 Content-Type 为 DOCX MIME
        res.setHeader(
                'Content-Type',
                'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        );
        // 设置 Content-Disposition：附件下载，固定文件名（实际落盘名由前端决定）
        res.setHeader(
                'Content-Disposition',
                'attachment; filename="learning-note.docx"',
        );
        // 设置 Content-Length：让浏览器显示下载进度
        res.setHeader('Content-Length', String(buf.length));
        // 写入 Buffer 并结束响应，触发 ResponseInterceptor 的 headersSent 短路
        res.end(buf);
}
```

### 4.3 `learning-notes.service.ts` — `exportDocxBuffer` 方法

**对比范围**：新增的 `exportDocxBuffer` 方法（含 JSDoc 到方法闭合 `}`）。

**改动前** · `apps/backend/src/services/learning-notes/learning-notes.service.ts`（基线：无 `exportDocxBuffer`；service 仅含 `save / update / remove / findOne / findPage / requireOwned`）

```typescript
// 无 exportDocxBuffer：不支持导出
```

**改动后** · `apps/backend/src/services/learning-notes/learning-notes.service.ts`（`exportDocxBuffer` 方法，约 L94–L114）

```typescript
// JSDoc：导出单篇笔记为 DOCX，保留正文图片；超大图缩小显示，极端体积才跳过
/**
 * 导出单篇笔记为 DOCX（保留正文图片；超大图缩小显示，极端体积才跳过）。
 */
// 异步方法：返回 Buffer（DOCX 二进制）
async exportDocxBuffer(userId: number, id: string): Promise<Buffer> {
        // 复用 requireOwned：确认笔记存在且归属当前用户
        const row = await this.requireOwned(userId, id);
        // 取正文 HTML，空则当空串处理
        const html = row.content ?? '';
        // 体积上限校验：超过 NOTE_DOCX_HTML_MAX_CHARS 直接拒
        if (html.length > NOTE_DOCX_HTML_MAX_CHARS) {
                // 抛 BadRequest，提示用户精简后再导出
                throw new BadRequestException(
                        `笔记内容过大（>${NOTE_DOCX_HTML_MAX_CHARS} 字符），请精简后再导出`,
                );
        }
        // try/catch：builder 内部异常转成 BadRequest，避免 500
        try {
                // 调 builder 生成 Buffer：title 兜底「无标题笔记」
                return await buildLearningNoteDocxBuffer({
                        title: row.title?.trim() || '无标题笔记',
                        html,
                });
        } catch (e) {
                // 取错误 message，非 Error 转 String
                const msg = e instanceof Error ? e.message : String(e);
                // 抛 BadRequest，把 builder 失败也当作业务错误
                throw new BadRequestException(msg || '导出失败');
        }
}
```

### 4.4 `types.ts` — `HostBridgeProps.api.ui.downloadBlob`

**对比范围**：`HostBridgeProps.api.ui` 完整类型（含 `showToast` 与新增 `downloadBlob`）。

**改动前** · `apps/frontend/src/plugins/core/types.ts`（基线，`ui` 段）

```typescript
// ui 能力：仅 showToast
ui?: {
        // 弹 Toast
        showToast: (options: {
                message: string;
                type?: 'success' | 'error' | 'info';
        }) => void;
};
```

**改动后** · `apps/frontend/src/plugins/core/types.ts`（`ui` 段，约 L82–L100）

```typescript
// ui 能力：受 ui:toast 权限收口
ui?: {
        // 弹 Toast
        showToast: (options: {
                message: string;
                type?: 'success' | 'error' | 'info';
        }) => void;
        // JSDoc：统一落盘（Web <a download> / Tauri download_blob）；Tauri 成功失败时 Host 已 Toast
        /**
         * 统一落盘（Web `<a download>` / Tauri `download_blob`）。
         * Tauri 成功/失败时 Host 已 Toast，`hostToasted: true` 时插件勿再弹成功提示。
         */
        // 可选：未授权或 Host 不支持时为 undefined
        downloadBlob?: (options: {
                // 文件名（含扩展名）
                fileName: string;
                // 二进制内容：ArrayBuffer 或 Uint8Array
                data: ArrayBuffer | Uint8Array;
                // MIME：缺省时 Host 默认 DOCX
                mimeType?: string;
        }) => Promise<{
                // 是否成功
                ok: boolean;
                // Host 是否已 Toast（true 时插件勿再弹）
                hostToasted: boolean;
                // 失败时的额外信息
                message?: string;
        }>;
};
```

### 4.5 `createHostBridge.ts` — `downloadBlob` 实现

**对比范围**：`if (allow.has('ui:toast'))` 块内 `api.ui = Object.freeze({...})` 完整对象（含 `showToast` 与新增 `downloadBlob`）。

**改动前** · `apps/frontend/src/plugins/core/createHostBridge.ts`（基线，`ui` 段）

```typescript
// 受 ui:toast 权限收口
if (allow.has('ui:toast')) {
        // Object.freeze：插件侧无法篡改
        api.ui = Object.freeze({
                // showToast：调主站 Toast 组件
                showToast: (options: {
                        message: string;
                        type?: 'success' | 'error' | 'info';
                }) => {
                        Toast({
                                type: options.type ?? 'info',
                                title: options.message,
                        });
                },
        });
}
```

**改动后** · `apps/frontend/src/plugins/core/createHostBridge.ts`（`ui` 段，约 L54–L97）

```typescript
// 受 ui:toast 权限收口：downloadBlob 与 showToast 同权
if (allow.has('ui:toast')) {
        // Object.freeze：插件侧无法篡改
        api.ui = Object.freeze({
                // showToast：调主站 Toast 组件
                showToast: (options: {
                        message: string;
                        type?: 'success' | 'error' | 'info';
                }) => {
                        Toast({
                                type: options.type ?? 'info',
                                title: options.message,
                        });
                },
                // JSDoc：与主站收藏导出同源，Web / Tauri2 统一落盘
                /** 与主站收藏导出同源：Web / Tauri2 统一落盘 */
                // downloadBlob：异步落盘
                downloadBlob: async (options: {
                        fileName: string;
                        data: ArrayBuffer | Uint8Array;
                        mimeType?: string;
                }) => {
                        // MIME 缺省默认 DOCX
                        const mime = options.mimeType?.trim() || DOCX_MIME;
                        // 取原始数据
                        const raw = options.data;
                        // 统一转 Uint8Array：ArrayBuffer 与 Uint8Array 入参都覆盖
                        const bytes =
                                raw instanceof ArrayBuffer
                                        ? new Uint8Array(raw)
                                        : new Uint8Array(raw);
                        // 构造 Blob
                        const blob = new Blob([bytes], { type: mime });
                        // 调主站 downloadBlob：复用 Tauri download_blob / Web <a download>
                        const result = await downloadBlob(
                                {
                                        // 文件名兜底 'download'
                                        file_name: options.fileName || 'download',
                                        // 唯一 id：插件 id + 时间戳，避免覆盖
                                        id: `plugin-${d.id}-${Date.now()}`,
                                        // 覆盖同名文件
                                        overwrite: true,
                                },
                                blob,
                        );
                        // hostToasted：仅 Tauri 端 Host 会 Toast
                        const hostToasted = isTauriRuntime();
                        // 失败：返回 ok:false + message
                        if (result.success !== 'success') {
                                return {
                                        ok: false as const,
                                        hostToasted,
                                        message: result.message || '下载失败',
                                };
                        }
                        // 成功：返回 ok:true，hostToasted 让插件决定是否再 Toast
                        return { ok: true as const, hostToasted };
                },
        });
}
```

### 4.6 `attachIframeBridge.ts` — `ui.downloadBlob` RPC 分支

**对比范围**：`dispatchRpc` 中新增的 `case 'ui.downloadBlob'` 分支（含到 `}` 闭合）。仅展示新增分支，`dispatchRpc` 其余 case 未改动。

**改动前** · `apps/frontend/src/plugins/core/attachIframeBridge.ts`（基线，`dispatchRpc` 的 switch：含 `http.*` / `ui.showToast` / `ebook.*`，无 `ui.downloadBlob`）

```typescript
// switch 内仅有 'http.get' / 'http.post' / 'http.put' / 'http.delete' / 'ui.showToast' / 'ebook.*'
switch (method) {
        // ...（未改动：http.* 分支）
        case 'ui.showToast':
                if (!api.ui) throw new Error('UI_DENIED');
                api.ui.showToast(
                        args[0] as {
                                message: string;
                                type?: 'success' | 'error' | 'info';
                        },
                );
                return null;
        // ...（未改动：ebook.* 分支）
        default:
                throw new Error(`UNKNOWN_RPC: ${method}`);
}
```

**改动后** · `apps/frontend/src/plugins/core/attachIframeBridge.ts`（`dispatchRpc` 的 `ui.downloadBlob` 分支，约 L63–L78；其余 case 未改动）

```typescript
// 块级作用域 case：用 {} 包裹避免 const opt 与其他 case 命名冲突
case 'ui.downloadBlob': {
        // 未授权或 Host 未实现：抛 UI_DENIED
        if (!api.ui?.downloadBlob) throw new Error('UI_DENIED');
        // 取首个参数为 options
        const opt = args[0] as {
                fileName?: string;
                data?: ArrayBuffer | Uint8Array;
                mimeType?: string;
        };
        // 入参最小校验：fileName 与 data 必填
        if (!opt?.fileName || opt.data == null) {
                throw new Error('INVALID_DOWNLOAD_ARGS');
        }
        // 透传给 api.ui.downloadBlob，返回 Promise 给 RPC 调用方
        return api.ui.downloadBlob({
                fileName: String(opt.fileName),
                data: opt.data,
                mimeType: opt.mimeType,
        });
}
```

### 4.7 `iframeHostClient.ts` — bridge `ui.downloadBlob`

**对比范围**：bridge `api.ui` 完整对象（含 `showToast` 与新增 `downloadBlob`）。

**改动前** · `apps/remote-plugins/src/utils/iframeHostClient.ts`（基线，`ui` 段）

```typescript
// ui：仅 showToast
ui: {
        // showToast：经 RPC 调 Host
        showToast: (options) => {
                void rpc('ui.showToast', [options]);
        },
},
```

**改动后** · `apps/remote-plugins/src/utils/iframeHostClient.ts`（`ui` 段，约 L131–L141）

```typescript
// ui：showToast + downloadBlob
ui: {
        // showToast：经 RPC 调 Host
        showToast: (options) => {
                void rpc('ui.showToast', [options]);
        },
        // downloadBlob：经 RPC 调 Host，返回带 hostToasted 的结果
        downloadBlob: (options) =>
                rpc('ui.downloadBlob', [options]) as Promise<{
                        ok: boolean;
                        hostToasted: boolean;
                        message?: string;
                }>,
},
```

### 4.8 `mockHost.ts` — `mockDownloadBlob`

**对比范围**：新增的 `mockDownloadBlob` 函数 + `mockApi` 内 `ui.downloadBlob` 字段。

**改动前** · `apps/remote-plugins/src/utils/mockHost.ts`（基线）

```typescript
// 独立预览用 mockApi：仅 showToast
export function mockApi(extra?: Record<string, unknown>) {
        return {
                theme: 'light' as const,
                event: { on: () => undefined, off: () => undefined, emit: () => undefined },
                ui: {
                        showToast: (o: { message: string }) => console.info('[toast]', o.message),
                },
                ...extra,
        };
}
```

**改动后** · `apps/remote-plugins/src/utils/mockHost.ts`（约 L1–L53）

```typescript
// 文件头注释：独立预览用假 HostBridge；嵌入主站时由 Host 注入真 api
/** 独立预览用假 HostBridge；嵌入主站时由 Host 注入真 api */

// DOCX MIME 常量：与 Host 一致
const DOCX_MIME =
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

// JSDoc：独立预览无 Tauri，用浏览器 <a download> 模拟 Host downloadBlob
/** 独立预览无 Tauri：用浏览器 `<a download>` 模拟 Host downloadBlob */
// mockDownloadBlob：异步函数，签名与 Host downloadBlob 一致
async function mockDownloadBlob(options: {
        fileName: string;
        data: ArrayBuffer | Uint8Array;
        mimeType?: string;
}): Promise<{ ok: boolean; hostToasted: boolean; message?: string }> {
        // try/catch：模拟过程任何异常都转成 ok:false
        try {
                // 统一转 Uint8Array
                const bytes =
                        options.data instanceof ArrayBuffer
                                ? new Uint8Array(options.data)
                                : new Uint8Array(options.data);
                // 构造 Blob
                const blob = new Blob([bytes], {
                        type: options.mimeType?.trim() || DOCX_MIME,
                });
                // 生成临时 URL
                const url = URL.createObjectURL(blob);
                // 创建 <a> 触发下载
                const a = document.createElement('a');
                a.href = url;
                a.download = options.fileName || 'download';
                // 必须 append 到 DOM 才能在部分浏览器触发 click
                document.body.appendChild(a);
                a.click();
                // 立即移除
                a.remove();
                // 释放 URL
                URL.revokeObjectURL(url);
                // 独立预览无 Host Toast，hostToasted 恒 false
                return { ok: true, hostToasted: false };
        } catch (e) {
                // 失败：返回 ok:false + message，hostToasted false（无 Host）
                return {
                        ok: false,
                        hostToasted: false,
                        message: e instanceof Error ? e.message : String(e),
                };
        }
}

// mockApi：导出 mock bridge
export function mockApi(extra?: Record<string, unknown>) {
        return {
                // 主题固定 light
                theme: 'light' as const,
                // 注释：不传 locale，独立预览用本地 useI18n
                // 不传 locale：独立预览用本地 useI18n；插件模式由 Host 注入
                event: {
                        on: () => undefined,
                        off: () => undefined,
                        emit: () => undefined,
                },
                ui: {
                        // showToast：控制台输出
                        showToast: (o: { message: string }) => console.info('[toast]', o.message),
                        // downloadBlob：用 mockDownloadBlob 浏览器兜底
                        downloadBlob: mockDownloadBlob,
                },
                ...extra,
        };
}

// mockPlugin：导出插件元信息
export function mockPlugin(id: string, routePath: string, version = '1.0.0') {
        return { id, version, routePath };
}
```

### 4.9 `api.ts` — `exportDocx` 方法

**对比范围**：`createNotesApi` 返回对象内新增的 `exportDocx` 方法（含 JSDoc 到方法闭合 `},`）。

**改动前** · `apps/remote-plugins/src/views/learning-notes/api.ts`（基线：`createNotesApi` 含 `list / detail / save / update / remove`，无 `exportDocx`）

```typescript
// 无 exportDocx：不支持导出
```

**改动后** · `apps/remote-plugins/src/views/learning-notes/api.ts`（`exportDocx` 方法，约 L83–L96）

```typescript
// JSDoc：拉取单篇笔记 DOCX 二进制（服务端生成）
/** 拉取单篇笔记 DOCX 二进制（服务端生成） */
// 异步方法：返回 ArrayBuffer
async exportDocx(id: string): Promise<ArrayBuffer> {
        // GET 拉二进制：Host http 已配置 responseType=arraybuffer（见 Host http 实现）
        const res = await http.get(`${BASE}/export-docx/${id}`);
        // 解包：response.interceptor 对二进制短路，理论上 res 即 ArrayBuffer；这里兼容万一被包一层的情况
        const data = unwrapData<unknown>(res);
        // 已经是 ArrayBuffer：直接返回
        if (data instanceof ArrayBuffer) return data;
        // 是 TypedArray（如 Uint8Array）：切出独立 ArrayBuffer
        if (ArrayBuffer.isView(data)) {
                const v = data as ArrayBufferView;
                // slice 出 [byteOffset, byteOffset+byteLength) 的副本
                return v.buffer.slice(
                        v.byteOffset,
                        v.byteOffset + v.byteLength,
                ) as ArrayBuffer;
        }
        // 既不是 ArrayBuffer 也不是 TypedArray：服务端返回异常，抛错
        throw new Error(translateSync('learningNotes.toast.exportInvalid'));
},
```

### 4.10 `learningNotes.ts` — `bind` / `openPreview` / `exportPreviewDocx`

**对比范围**：`LearningNotesStore` 内 `bind`、`openPreview` 两个方法的重构 + 新增 `exportPreviewDocx` 方法 + 新增 `downloadBlob` / `exportingDocx` 字段。

#### 4.10.1 新增字段与 `bind` 签名

**改动前** · `apps/remote-plugins/src/store/learningNotes.ts`（基线，`bind` 段）

```typescript
// bind：仅注入 http / toast / t
bind(http: HostHttp | undefined, toast: ToastFn, t?: TFn) {
        this.api = http ? createNotesApi(http) : null;
        this.toast = toast;
        if (t) this.t = t;
}
```

**改动后** · `apps/remote-plugins/src/store/learningNotes.ts`（字段 + `bind`，约 L15–L77）

```typescript
// HostDownloadBlob 类型：与 Host api.ui.downloadBlob 签名对齐
type HostDownloadBlob = (options: {
        fileName: string;
        data: ArrayBuffer | Uint8Array;
        mimeType?: string;
}) => Promise<{ ok: boolean; hostToasted: boolean; message?: string }>;

// DOCX MIME 常量：与 Host 一致
const DOCX_MIME =
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

// ...（未改动：errMsg 函数与 LearningNotesStore 类头部字段省略）

// 私有字段：Host 透传的 downloadBlob，独立预览可由 mock 注入
/** Host 透传的 downloadBlob（Web / Tauri2）；独立预览可由 mock 注入 */
private downloadBlob: HostDownloadBlob | null = null;

// ...（未改动：list / total / pageNo / pageSize / loading / loadingMore / listOpen / preview / loadingDetail / editingId / editorSeed / editorInitial / saving / confirmOpen / pendingDeleteId 字段省略）

// 新增字段：导出中状态，防重入
exportingDocx = false;

// ...（未改动：constructor makeAutoObservable 省略）

// bind：多收一个 downloadBlob 参数
bind(
        http: HostHttp | undefined,
        toast: ToastFn,
        t?: TFn,
        // 新增：Host 透传的 downloadBlob
        downloadBlob?: HostDownloadBlob,
) {
        // 注入 http：构造 NotesApi
        this.api = http ? createNotesApi(http) : null;
        // 注入 toast
        this.toast = toast;
        // 注入 downloadBlob：未传则置 null，exportPreviewDocx 时会兜底报错
        this.downloadBlob = downloadBlob ?? null;
        // 注入 t：可选
        if (t) this.t = t;
}
```

#### 4.10.2 `openPreview` 改为乐观预览

**改动前** · `apps/remote-plugins/src/store/learningNotes.ts`（基线，`openPreview`）

```typescript
// openPreview：先 loadingDetail=true，详情到达后才进入预览
async openPreview(id: string): Promise<void> {
        if (!this.api) return;
        try {
                this.loadingDetail = true;
                const note = await this.api.detail(id);
                this.loadingDetail = false;
                runInAction(() => {
                        this.preview = note;
                });
        } catch (e) {
                this.toast(errMsg(e, this.t), 'error');
                this.loadingDetail = false;
        }
}
```

**改动后** · `apps/remote-plugins/src/store/learningNotes.ts`（`openPreview`，约 L155–L186）

```typescript
// openPreview：乐观预览，先壳后详情
async openPreview(id: string): Promise<void> {
        // 无 api：直接 return
        if (!this.api) return;
        // 列表命中：用列表数据先填壳，避免白屏
        const listHit = this.list.find((n) => n.id === id);
        // 注释：立刻进入预览壳，卸掉编辑器，避免与即将挂载的预览双实例并存
        // 立刻进入预览壳：卸掉编辑器，避免与即将挂载的预览双实例并存
        runInAction(() => {
                // 标记 loadingDetail：触发遮罩
                this.loadingDetail = true;
                // 先用列表命中数据 + 旧 preview 兜底，构造壳
                this.preview = {
                        id,
                        // 标题：列表命中优先，否则旧 preview 标题，再否则空串
                        title: listHit?.title ?? this.preview?.title ?? '',
                        // html：仅当旧 preview 就是同 id 时复用（避免切回旧内容）
                        html: this.preview?.id === id ? this.preview.html : '',
                        // at：列表命中优先，否则旧 preview at，再否则当前时间
                        at: listHit?.at ?? this.preview?.at ?? Date.now(),
                };
        });
        // try/catch：详情请求失败要回滚
        try {
                // 拉详情
                const note = await this.api.detail(id);
                // 写回 preview：慢网下用户可能已点开另一篇，需校验 id
                runInAction(() => {
                        // 注释：慢网下用户可能已点开另一篇
                        // 慢网下用户可能已点开另一篇
                        if (this.preview?.id === id) this.preview = note;
                });
        } catch (e) {
                // 失败：Toast 错误
                this.toast(errMsg(e, this.t), 'error');
                // 回滚：仅当当前 preview 还是这个 id 且 html 仍为空时清空
                runInAction(() => {
                        if (this.preview?.id === id && !this.preview.html) {
                                this.preview = null;
                        }
                });
        } finally {
                // 无论成功失败，关闭 loadingDetail
                runInAction(() => {
                        this.loadingDetail = false;
                });
        }
}
```

#### 4.10.3 新增 `exportPreviewDocx`

**改动前** · `apps/remote-plugins/src/store/learningNotes.ts`（基线：无 `exportPreviewDocx`）

```typescript
// 无 exportPreviewDocx：不支持导出
```

**改动后** · `apps/remote-plugins/src/store/learningNotes.ts`（`exportPreviewDocx`，约 L260–L308）

```typescript
// JSDoc：导出当前预览笔记为 DOCX（服务端生成 + Host downloadBlob 落盘）
/** 导出当前预览笔记为 DOCX（服务端生成 + Host downloadBlob 落盘） */
// 异步 action：防重入
async exportPreviewDocx(): Promise<void> {
        // 取当前预览笔记
        const note = this.preview;
        // 无预览或无 id：提示并返回
        if (!note?.id) {
                this.toast(this.t('learningNotes.toast.exportEmpty'), 'info');
                return;
        }
        // 无 api：HTTP 未注入
        if (!this.api) {
                this.toast(this.t('learningNotes.toast.httpDeniedExport'), 'error');
                return;
        }
        // 无 downloadBlob：Host 不支持下载
        if (!this.downloadBlob) {
                this.toast(this.t('learningNotes.toast.exportNoDownload'), 'error');
                return;
        }
        // 防重入：已在导出中直接 return
        if (this.exportingDocx) return;
        // 标记导出中
        this.exportingDocx = true;
        // try/catch/finally：保证 exportingDocx 复位
        try {
                // 拉服务端生成的 DOCX Buffer
                const buf = await this.api.exportDocx(note.id);
                // 生成安全文件名：去 Windows 非法字符，截 60 字，空则兜底
                const safe =
                        note.title.replace(/[\\/:*?"<>|]+/g, '_').trim().slice(0, 60) ||
                        'learning-note';
                // 调 Host downloadBlob 落盘
                const result = await this.downloadBlob({
                        // 文件名：标题-时间戳.docx
                        fileName: `${safe}-${Date.now()}.docx`,
                        // 二进制内容
                        data: buf,
                        // MIME
                        mimeType: DOCX_MIME,
                });
                // 失败分支
                if (!result.ok) {
                        // 注释：对齐收藏导出，Tauri 失败时 Host 已 Toast
                        // 对齐收藏导出：Tauri 失败时 Host 已 Toast
                        if (!result.hostToasted) {
                                // Web 端：插件自己 Toast 失败
                                this.toast(
                                        result.message || this.t('learningNotes.toast.exportFail'),
                                        'error',
                                );
                        }
                        // 失败后直接返回
                        return;
                }
                // 成功分支
                // 注释：Tauri downloadBlob 内已成功 Toast；Web 由插件提示
                // Tauri：downloadBlob 内已成功 Toast；Web：由插件提示
                if (!result.hostToasted) {
                        // Web 端：插件自己 Toast 成功
                        this.toast(this.t('learningNotes.toast.exportOk'), 'success');
                }
        } catch (e) {
                // 异常：Toast 错误信息
                this.toast(errMsg(e, this.t), 'error');
        } finally {
                // 复位 exportingDocx：放 runInAction 确保 MobX 可观察
                runInAction(() => {
                        this.exportingDocx = false;
                });
        }
}
```

### 4.11 `Title.tsx` — `TitleView` 抽取 `NoteTitleField`

**对比范围**：`TitleView` 组件完整定义（含 import、签名、return 到 `}`）。

**改动前** · `apps/remote-plugins/src/components/design/RichEditor/title/Title.tsx`（基线，全文件）

```typescript
// 导入 NodeViewProps / NodeViewWrapper
import { type NodeViewProps, NodeViewWrapper } from '@tiptap/react';
// 导入 NotebookPen 图标
import { NotebookPen } from 'lucide-react';
// 导入 React hooks
import { useEffect, useRef, useState } from 'react';
// 导入 Input 组件
import { Input } from '@/components/ui';
// 导入 i18n hook
import { useI18n } from '@/hooks';
// 导入富文本 locale 工具
import { richEditorLocaleOf } from '../locale';
// 导入 focusAfterTitle
import { focusAfterTitle } from './TitleNode';

// TitleView：TipTap 标题 NodeView
export default function TitleView({
        node,
        updateAttributes,
        editor,
}: NodeViewProps) {
        // 取 locale / t
        const { locale, t } = useI18n();
        // 富文本 locale
        const editorLocale = richEditorLocaleOf(locale);
        // 输入法合成态
        const composing = useRef(false);
        // 本地 value
        const [value, setValue] = useState(String(node.attrs.value ?? ''));

        // 同步外部 attrs.value 到本地
        useEffect(() => {
                if (composing.current) return;
                setValue(String(node.attrs.value ?? ''));
        }, [node.attrs.value]);

        // commit：写本地 + 写 attrs
        const commit = (next: string) => {
                setValue(next);
                if (!composing.current) updateAttributes({ value: next });
        };

        // JSX：NodeViewWrapper 包裹徽章 + Input
        return (
                <NodeViewWrapper
                        as="div"
                        className="rich-editor-note-title flex flex-col gap-2 mb-2"
                        contentEditable={false}
                >
                        <div className="relative flex flex-col gap-2 p-3 pr-0 pt-9 border border-theme/5 bg-theme/5 rounded-md">
                                <div className="absolute -inset-0.5 bg-theme/20 border border-theme/5 text-theme/80 rounded-tl-md rounded-br-md pl-3 py-3.5 w-26 h-6 flex items-center gap-2">
                                        <NotebookPen className="size-4" />
                                        <span className="text-sm font-medium pb-0.5">
                                                {t('learningNotes.titleBadge')}
                                        </span>
                                </div>
                                <Input
                                        className="h-12 size-full px-0 py-0 text-xl md:text-xl rounded-none border-0 bg-transparent text-textcolor shadow-none placeholder:text-lg placeholder:text-textcolor/35 focus-visible:border-0 focus-visible:ring-0"
                                        value={value}
                                        placeholder={editorLocale.placeholderHeadingHint}
                                        maxLength={50}
                                        showCount
                                        tabIndex={-1}
                                        onMouseDown={(e) => e.stopPropagation()}
                                        onCompositionStart={() => { composing.current = true; }}
                                        onCompositionEnd={(e) => { composing.current = false; commit(e.currentTarget.value); }}
                                        onChange={(e) => commit(e.target.value)}
                                        onKeyDown={(e) => {
                                                if (e.nativeEvent.isComposing) return;
                                                if (e.key === 'Enter' || e.key === 'Tab') {
                                                        e.preventDefault();
                                                        focusAfterTitle(editor);
                                                }
                                        }}
                                />
                        </div>
                </NodeViewWrapper>
        );
}
```

**改动后** · `apps/remote-plugins/src/components/design/RichEditor/title/Title.tsx`（全文件，约 L1–L22）

```typescript
// 导入 NodeViewProps / NodeViewWrapper
import { type NodeViewProps, NodeViewWrapper } from '@tiptap/react';
// 导入抽取出的 NoteTitleField
import { NoteTitleField } from './NoteTitleField';
// 导入 focusAfterTitle：Enter / Tab 时跳正文
import { focusAfterTitle } from './TitleNode';

// JSDoc：TipTap 标题 NodeView，外观走 NoteTitleField，写入 attrs.value
/**
 * TipTap 标题 NodeView：外观走 NoteTitleField，写入 attrs.value。
 */
// TitleView：仅做 NodeView 壳
export default function TitleView({
        node,
        updateAttributes,
        editor,
}: NodeViewProps) {
        // JSX：NodeViewWrapper contentEditable=false，让输入交给 NoteTitleField 内的原生 Input
        return (
                // NodeViewWrapper：TipTap NodeView 容器
                <NodeViewWrapper as="div" contentEditable={false}>
                        {/* NoteTitleField：复用组件，value/onChange/onContinue 三个回调 */}
                        <NoteTitleField
                                // 当前 attrs.value
                                value={String(node.attrs.value ?? '')}
                                // onChange：写回 attrs
                                onChange={(next) => updateAttributes({ value: next })}
                                // onContinue：Enter / Tab 时跳正文
                                onContinue={() => focusAfterTitle(editor)}
                        />
                </NodeViewWrapper>
        );
}
```

> `NoteTitleField.tsx` 为新增文件，承载原 `Title.tsx` 中的徽章 + Input + 字数 UI，签名：`{ value, onChange, onContinue?, className? }`，与 TipTap 解耦，可被长文窗外标题复用。本文不展开其逐行注释。

### 4.12 `TitleNode.ts` — `appendTransaction` 优化

**对比范围**：`appendTransaction` 完整方法（含签名到 `},`）。

**改动前** · `apps/remote-plugins/src/components/design/RichEditor/title/TitleNode.ts`（基线，`appendTransaction`）

```typescript
// appendTransaction：每次文档/选区变更后做去重 title、补正文、纠正 GapCursor
appendTransaction(transactions, _old, state) {
        // 既没有文档变更也没有选区变更，直接返回 null
        if (!transactions.some((tr) => tr.docChanged || tr.selectionSet))
                return null;

        let tr = state.tr;
        let changed = false;

        // 去重 title：扫全文找第二个及以后的 title
        const extras: { pos: number; nodeSize: number }[] = [];
        let seen = 0;
        state.doc.forEach((node, offset) => {
                if (node.type.name !== 'title') return;
                seen += 1;
                if (seen > 1) extras.push({ pos: offset, nodeSize: node.nodeSize });
        });
        for (let i = extras.length - 1; i >= 0; i--) {
                const { pos, nodeSize } = extras[i];
                tr.replaceWith(pos, pos + nodeSize, state.schema.nodes.paragraph.create());
                changed = true;
        }

        // 补正文段
        const doc = changed ? tr.doc : state.doc;
        const title = doc.firstChild;
        if (title?.type.name === 'title' && doc.childCount < 2) {
                tr = tr.insert(title.nodeSize, state.schema.nodes.paragraph.create());
                changed = true;
        }

        // 钉回光标
        const nextDoc = changed ? tr.doc : state.doc;
        const titleNode = nextDoc.firstChild;
        if (titleNode?.type.name === 'title') {
                const titleSize = titleNode.nodeSize;
                const sel = changed ? tr.selection : state.selection;
                // bodyEmpty 用 textBetween 扫全文
                const bodyEmpty = !nextDoc.textBetween(titleSize, nextDoc.content.size).length;
                const $from = sel.$from;
                const caretInBody =
                        sel instanceof TextSelection &&
                        sel.empty &&
                        $from.parent.isTextblock &&
                        $from.pos > titleSize;
                const needsFix =
                        sel instanceof GapCursor ||
                        (sel.empty && !$from.parent.isTextblock) ||
                        (bodyEmpty && sel.empty && !caretInBody);

                if (needsFix && titleSize + 1 <= nextDoc.content.size) {
                        const nextSel = bodyEmpty
                                ? TextSelection.create(nextDoc, titleSize + 1)
                                : Selection.atEnd(nextDoc);
                        tr = tr.setSelection(nextSel);
                        changed = true;
                }
        }

        if (!changed) return null;
        return tr;
}
```

**改动后** · `apps/remote-plugins/src/components/design/RichEditor/title/TitleNode.ts`（`appendTransaction`，约 L79–L158）

```typescript
// appendTransaction：结构修复只在 docChanged；选区变更只做光标钉回
appendTransaction(transactions, _old, state) {
        // 单独取 docChanged / selectionSet，分别决定走哪条路径
        const docChanged = transactions.some((tr) => tr.docChanged);
        const selectionSet = transactions.some((tr) => tr.selectionSet);
        // 二者都没有：不产生新事务
        if (!docChanged && !selectionSet) return null;

        // 起一个新事务累积变更
        let tr = state.tr;
        let changed = false;

        // 注释：结构修复只在 doc 变化时做（选区变化不必扫多余 title）
        // 结构修复只在 doc 变化时做（选区变化不必扫多余 title）
        if (docChanged) {
                // 去重 title：扫顶层找第二个及以后的 title
                const extras: { pos: number; nodeSize: number }[] = [];
                let seen = 0;
                state.doc.forEach((node, offset) => {
                        // 非 title 跳过
                        if (node.type.name !== 'title') return;
                        // 命中计数
                        seen += 1;
                        // 第二个及以后入队待删
                        if (seen > 1) extras.push({ pos: offset, nodeSize: node.nodeSize });
                });
                // 从后往前删，避免位置偏移
                for (let i = extras.length - 1; i >= 0; i--) {
                        const { pos, nodeSize } = extras[i];
                        // 用空段落替换多余 title
                        tr.replaceWith(
                                pos,
                                pos + nodeSize,
                                state.schema.nodes.paragraph.create(),
                        );
                        changed = true;
                }

                // 计算当前 doc（changed 时取 tr.doc，否则 state.doc）
                const doc = changed ? tr.doc : state.doc;
                const title = doc.firstChild;
                // 注释：没有正文块时补一段（atom 旁 GapCursor 看起来像有光标但输不进字）
                // 没有正文块时补一段（atom 旁 GapCursor 看起来像有光标但输不进字）
                if (title?.type.name === 'title' && doc.childCount < 2) {
                        // 在 title 后插入空段落
                        tr = tr.insert(
                                title.nodeSize,
                                state.schema.nodes.paragraph.create(),
                        );
                        changed = true;
                }
        }

        // 计算 nextDoc：决定后续光标钉回用哪个文档
        const nextDoc = changed ? tr.doc : state.doc;
        const titleNode = nextDoc.firstChild;
        // 仅当首位是 title 时才需要钉光标
        if (titleNode?.type.name === 'title') {
                // title 节点尺寸
                const titleSize = titleNode.nodeSize;
                // sel：changed 时取 tr.selection，否则取 state.selection
                const sel = changed ? tr.selection : state.selection;
                const $from = sel.$from;
                // caretInBody：光标是否已在正文段内
                const caretInBody =
                        sel instanceof TextSelection &&
                        sel.empty &&
                        $from.parent.isTextblock &&
                        $from.pos > titleSize;

                // 注释：GapCursor / 非正文块 直接钉回；仅第三种情况才需要判断正文是否空
                // GapCursor / 非正文块 → 直接钉回；仅第三种情况才需要判断正文是否空
                let needsFix =
                        sel instanceof GapCursor ||
                        (sel.empty && !$from.parent.isTextblock);

                // 仅当 GapCursor / 非正文块 都不命中，且光标不在正文段内时，才判断 bodyEmpty
                if (!needsFix && sel.empty && !caretInBody) {
                        // 注释：ponytail 用 child 空内容判断，避免每次选区变化 textBetween 扫全文
                        // ponytail: 用 child 空内容判断，避免每次选区变化 textBetween 扫全文
                        const bodyEmpty =
                                nextDoc.childCount <= 2 &&
                                (nextDoc.childCount < 2 ||
                                        nextDoc.child(1).content.size === 0);
                        needsFix = bodyEmpty;
                }

                // 命中钉回
                if (needsFix && titleSize + 1 <= nextDoc.content.size) {
                        // 再次算 bodyEmpty：决定钉到首段还是末尾
                        const bodyEmpty =
                                nextDoc.childCount <= 2 &&
                                (nextDoc.childCount < 2 ||
                                        nextDoc.child(1).content.size === 0);
                        // 空正文钉首段（可输入），非空钉末尾
                        const nextSel = bodyEmpty
                                ? TextSelection.create(nextDoc, titleSize + 1)
                                : Selection.atEnd(nextDoc);
                        tr = tr.setSelection(nextSel);
                        changed = true;
                }
        }

        // 无变更返回 null
        return changed ? tr : null;
},
```

### 4.13 `extensions/index.ts` — `imageResize` / `tableResizable` / `undoRedo`

**对比范围**：`createExtensions` 内 `Image.configure` + `TableKit.configure` 段，以及 `StarterKit.configure` 内 `undoRedo` 段。`StarterKit.configure` 仅展示与改动相关字段，其余字段未改动。

#### 4.13.1 `StarterKit.configure` 新增 `undoRedo`

**改动前** · `apps/remote-plugins/src/components/design/RichEditor/extensions/index.ts`（基线，`StarterKit.configure` 段，省略未改动字段）

```typescript
// StarterKit.configure：未配置 undoRedo（用默认深度）
StarterKit.configure({
        document: withTitle ? false : undefined,
        trailingNode: {
                node: 'paragraph',
        },
        heading: { levels: [1, 2, 3, 4, 5] },
        codeBlock: false,
        link: {
                openOnClick: false,
                autolink: true,
                defaultProtocol: 'https',
                HTMLAttributes: {
                        rel: 'noopener noreferrer',
                        target: '_blank',
                },
        },
}),
```

**改动后** · `apps/remote-plugins/src/components/design/RichEditor/extensions/index.ts`（`StarterKit.configure` 段，约 L64–L82，省略未改动字段）

```typescript
// StarterKit.configure：新增 undoRedo.depth=50
StarterKit.configure({
        // document：有 title 时由 CustomDocument 接管，关掉 StarterKit 自带
        document: withTitle ? false : undefined,
        // trailingNode：保证末尾始终有空段落
        trailingNode: {
                node: 'paragraph',
        },
        // heading：仅 1-5 级
        heading: { levels: [1, 2, 3, 4, 5] },
        // codeBlock：关掉 StarterKit 自带，改用 CodeBlockLowlight
        codeBlock: false,
        // 注释：TipTap 3 用 undoRedo（非 history）；长文降低深度，减轻内存与事务
        // TipTap 3：undoRedo（非 history）；长文降低深度，减轻内存与事务
        undoRedo: { depth: 50 },
        // link：不自动跳转，开启 autolink
        link: {
                openOnClick: false,
                autolink: true,
                defaultProtocol: 'https',
                HTMLAttributes: {
                        rel: 'noopener noreferrer',
                        target: '_blank',
                },
        },
}),
```

#### 4.13.2 `Image.configure` 与 `TableKit.configure` 改为 opt-in

**改动前** · `apps/remote-plugins/src/components/design/RichEditor/extensions/index.ts`（基线，`Image` / `TableKit` 段）

```typescript
// Image：默认开启 resize
Image.configure({
        inline: false,
        allowBase64: true,
        HTMLAttributes: { class: 'rich-editor-image' },
        resize: {
                enabled: true,
                alwaysPreserveAspectRatio: true,
        },
}),
// ImageUpload：默认 ref
ImageUpload.configure({ resolveSrcRef: resolveImageSrcRef }),
// TableKit：默认 resizable: true
TableKit.configure({
        table: { resizable: true },
}),
```

**改动后** · `apps/remote-plugins/src/components/design/RichEditor/extensions/index.ts`（`Image` / `TableKit` 段，约 L109–L125）

```typescript
// Image.configure：resize 改为 opt-in，由 options.imageResize 决定
Image.configure({
        // 非行内
        inline: false,
        // 允许 base64
        allowBase64: true,
        // class
        HTMLAttributes: { class: 'rich-editor-image' },
        // 仅当 options.imageResize 为真时挂 resize 配置；否则空对象，不开启 resize
        ...(options.imageResize
                ? {
                        // resize 配置：开启 + 锁定纵横比
                        resize: {
                                enabled: true,
                                alwaysPreserveAspectRatio: true,
                        },
                }
                : {}),
}),
// ImageUpload：默认 ref
ImageUpload.configure({ resolveSrcRef: resolveImageSrcRef }),
// TableKit.configure：resizable 改为 opt-in，默认 false
TableKit.configure({
        // 仅当 options.tableResizable === true 时 resizable: true
        table: { resizable: options.tableResizable === true },
}),
```

### 4.14 `Toolbar.tsx` — `ResizeObserver` 依赖修复

**对比范围**：原 `useEffect`（ResizeObserver）→ 重构为 `useLayoutEffect`（合并初始测量与 ResizeObserver）。展示从 `const rootRef` 到 `useLayoutEffect` 闭合 `}, [tools.length, t, linkOpen]);` 的完整段。

**改动前** · `apps/remote-plugins/src/components/design/RichEditor/toolbar/Toolbar.tsx`（基线，ResizeObserver useEffect）

```typescript
// ref 与 visibleCount state（与改动后一致，省略）
// ...

// useEffect：ResizeObserver，依赖 [tools] —— 每键 state 变都会新数组
useEffect(() => {
        if (!root) return;
        const ro = new ResizeObserver(() => {
                setVisibleCount(countVisibleTools(root, extraRef.current));
        });
        ro.observe(root);
        if (extraRef.current) ro.observe(extraRef.current);
        return () => ro.disconnect();
}, [tools]);
```

**改动后** · `apps/remote-plugins/src/components/design/RichEditor/toolbar/Toolbar.tsx`（合并 measure + ResizeObserver 的 useLayoutEffect，约 L885–L945）

```typescript
// rootRef：工具栏根 div
const rootRef = useRef<HTMLDivElement>(null);
// extraRef：右侧 extra 插槽
const extraRef = useRef<HTMLDivElement>(null);
// measureRef：隐形测量行，与真实按钮同构，用于算每项宽度
const measureRef = useRef<HTMLDivElement>(null);
// visibleCount：可见按钮数，默认 tools.length
const [visibleCount, setVisibleCount] = useState(tools.length);

// useLayoutEffect：合并初始测量 + ResizeObserver，避免双 effect 抖动
useLayoutEffect(() => {
        // 取 root 与 measure
        const root = rootRef.current;
        const measure = measureRef.current;
        // 任一缺失不处理
        if (!root || !measure) return;

        // recalc：核心测量函数
        const recalc = () => {
                // 读 getComputedStyle 拿 padding / gap
                const cs = getComputedStyle(root);
                // padX：左右 padding 之和
                const padX =
                        (parseFloat(cs.paddingLeft) || 0) + (parseFloat(cs.paddingRight) || 0);
                // gap：列间距
                const gap = parseFloat(cs.columnGap || cs.gap) || 0;
                // contentW：可用内容宽
                const contentW = root.clientWidth - padX;
                // extraW：右侧 extra 插槽宽
                const extraW = extraRef.current?.offsetWidth ?? 0;

                // fits：[start=tools+more][+extra] 是否放得进 contentW
                /** [start=tools+more][+extra] 是否放得进 contentW */
                const fits = (toolsW: number, withMore: boolean) => {
                        // startW：工具区 + 可选 More
                        const startW = toolsW + (withMore ? MORE_W : 0);
                        // used：累计占用
                        let used = startW;
                        // 有 extra 时累加 extraW + gap
                        if (extraW > 0) used += extraW + gap;
                        // 偏保守，避免亚像素导致多塞一项被裁切
                        return used <= contentW - 0.5;
                };

                // nodes：测量行子节点
                const nodes = [...measure.children] as HTMLElement[];
                // 空节点：直接 0
                if (nodes.length === 0) {
                        setVisibleCount(0);
                        return;
                }

                // widths：每个工具按钮宽
                const widths = nodes.map((el) => el.getBoundingClientRect().width);
                // total：所有按钮宽之和
                const total = widths.reduce((a, b) => a + b, 0);

                // 全放下：不显示 More
                if (fits(total, false)) {
                        setVisibleCount(widths.length);
                        return;
                }

                // 不能全放下：逐项累加，直到放不下
                let used = 0;
                let count = 0;
                for (const w of widths) {
                        // 加上当前项 + More 是否还放得下
                        if (!fits(used + w, true)) break;
                        used += w;
                        count += 1;
                }
                // 设置可见数
                setVisibleCount(count);
        };

        // 初始同步测量一次
        recalc();
        // ResizeObserver：root 宽变化时重测
        const ro = new ResizeObserver(recalc);
        ro.observe(root);
        // extra 变化也观察
        if (extraRef.current) ro.observe(extraRef.current);
        // 卸载时断开
        return () => ro.disconnect();
        // 注释：ponytail 勿依赖 tools 引用——每键 state 变都会新数组，触发全量 getBoundingClientRect
        // ponytail: 勿依赖 tools 引用——每键 state 变都会新数组，触发全量 getBoundingClientRect
        // 注释：按钮槽位数 / 文案 / 右侧插槽变化时才需要重测
        // 按钮槽位数 / 文案 / 右侧插槽变化时才需要重测
        // eslint-disable-next-line：tools.length 足够代表槽位变化
        // eslint-disable-next-line react-hooks/exhaustive-deps -- tools.length 足够代表槽位变化
}, [tools.length, t, linkOpen]);
```

## 5. 兼容性与影响

### 5.1 DOCX 导出

- **ResponseInterceptor 短路**对既有 JSON 接口无影响：仅当控制器用 `@Res()` 并已 `res.end` 时才会触发短路，普通返回值的接口仍走 `{ data, code, message, success }` 包装。`success: true` 是顺手补的字段，前端若未消费不影响。
- **`HostBridgeProps.api.ui.downloadBlob` 为可选**：未升级的 Host 不会向插件下发 `downloadBlob`，插件 `store.downloadBlob` 为 `null` 时 `exportPreviewDocx` 会走 `toast.exportNoDownload` 兜底，不会崩溃。
- **`ui.downloadBlob` 与 `ui.showToast` 同权**：复用既有 `ui:toast` 权限，无需新增 permission 枚举，权限模型不变。
- **iframe RPC 新增 case**：仅影响 untrusted iframe 模式；trusted MF 模式由 `createHostBridge` 直接挂载，不经过 `dispatchRpc`。
- **`exportDocx` HTTP 路径与列表分页无关**：不依赖 query，仅 path 参数 `id`；与既有 `detail / update / delete` 一致，路由不冲突。
- **服务端体积上限 `NOTE_DOCX_HTML_MAX_CHARS`**：超过直接 `BadRequest`，避免 builder 内存爆掉；用户精简后可重试。
- **文件名安全处理**：`note.title` 经 `\\/:*?"<>|` 替换为 `_` 并截 60 字，兼容 Windows / macOS / Linux 文件名限制。
- **`hostToasted` 协议**：Tauri 端 Host 内部已 Toast，插件不重复弹；Web 端 `hostToasted=false`，由插件自己 Toast，避免两端都不提示。

### 5.2 长文性能优化

- **`appendTransaction` 结构修复仅在 `docChanged`**：选区变更不再触发「扫全文找多余 title / 补正文段」，长文下按键延迟显著降低。结构正确性仍由 `docChanged` 路径保证，无回归风险。
- **`bodyEmpty` 用 `childCount`**：仅判断第二段是否为空，不再 `textBetween` 扫整段正文。语义等价（正文是否完全为空），但 O(1)。
- **`imageResize` / `tableResizable` 默认 `false`**：未显式传入的调用方不再启用图片缩放 / 表格列宽拖拽。学习笔记页面未传，长文编辑器性能改善；如需启用由调用方显式 opt-in。RichEditor 默认行为对既有调用方有视觉变化（图片不可拖拽缩放、表格列宽不可拖拽），需要确认是否所有调用方都不依赖。
- **`undoRedo.depth = 50`**：长文下撤销栈变浅，超过 50 步后早期历史被丢弃。对一般写作无影响；如需更长撤销栈由调用方覆盖。
- **`Title.tsx` 抽取 `NoteTitleField`**：TipTap NodeView 与长文窗外标题共用一份 UI；`TitleView` 退化为壳，行为不变。
- **`Toolbar` `ResizeObserver` 依赖 `[tools.length, t, linkOpen]`**：原 `[tools]` 在每键 state 变都会新数组，导致全量 `getBoundingClientRect`；改后只在槽位数 / 文案 / 链接开关变化时重测，长文下按键不再触发测量。state 变化（如 bold 高亮）由 React 直接重渲染对应按钮，不影响溢出布局。
- **编辑器懒挂载（`mountEditor`）**：进入编辑态先 Loading 遮罩 → 下一帧挂 TipTap。初次进入有「闪一下 Loading」的视觉变化，但避免长文解析时整个面板冻住。预览态不挂编辑器，节省内存。
- **长文走 `LargeNoteEditor` / `WindowedPreviewBody`**：与普通长度走 `RichEditor` / `NotePreview` 形成两条路径，由 `isLargeNoteHtml(html)` 判定切换；普通长度行为不变。

## 6. 相关源码路径

### 6.1 后端

- `apps/backend/src/services/learning-notes/learning-notes.controller.ts` — `exportDocx` 方法（L50–L68）
- `apps/backend/src/services/learning-notes/learning-notes.service.ts` — `exportDocxBuffer` 方法（L94–L114）
- `apps/backend/src/services/learning-notes/learning-note-docx.builder.ts` — DOCX 生成 builder（新文件，本文未展开）
- `apps/backend/src/interceptors/response.interceptor.ts` — `intercept` 方法（L17–L39）

### 6.2 Host 桥

- `apps/frontend/src/plugins/core/types.ts` — `HostBridgeProps.api.ui.downloadBlob`（L82–L100）
- `apps/frontend/src/plugins/core/createHostBridge.ts` — `downloadBlob` 实现（L54–L97）
- `apps/frontend/src/plugins/core/attachIframeBridge.ts` — `dispatchRpc` 内 `ui.downloadBlob` 分支（L63–L78）

### 6.3 远端插件

- `apps/remote-plugins/src/utils/iframeHostClient.ts` — bridge `ui.downloadBlob`（L131–L141）
- `apps/remote-plugins/src/utils/mockHost.ts` — `mockDownloadBlob` + `mockApi`（L1–L53）
- `apps/remote-plugins/src/views/learning-notes/api.ts` — `exportDocx` 方法（L83–L96）
- `apps/remote-plugins/src/store/learningNotes.ts` — `bind` / `openPreview` / `exportPreviewDocx`（L67–L77、L155–L186、L260–L308）
- `apps/remote-plugins/src/views/learning-notes/index.tsx` — `LearningNotesApp`（导出按钮、`store.bind` 传 `downloadBlob`、懒挂载、长文组件切换）
- `apps/remote-plugins/src/views/learning-notes/utils/` — `isLargeNoteHtml`（新文件，本文未展开）
- `apps/remote-plugins/src/views/learning-notes/components/Editor/` — `LargeNoteEditor`（新文件，本文未展开）
- `apps/remote-plugins/src/views/learning-notes/components/PreviewBody/` — `WindowedPreviewBody`（新文件，本文未展开）
- `apps/remote-plugins/src/views/learning-notes/components/NotesListPanel/` — `NotesListPanel`（新文件，本文未展开）

### 6.4 RichEditor

- `apps/remote-plugins/src/components/design/RichEditor/title/Title.tsx` — `TitleView` 抽壳（L1–L22）
- `apps/remote-plugins/src/components/design/RichEditor/title/NoteTitleField.tsx` — 标题 UI 复用组件（新文件，本文未展开逐行注释）
- `apps/remote-plugins/src/components/design/RichEditor/title/TitleNode.ts` — `appendTransaction` 优化（L79–L158）
- `apps/remote-plugins/src/components/design/RichEditor/extensions/index.ts` — `imageResize` / `tableResizable` / `undoRedo`（L64–L82、L109–L125）
- `apps/remote-plugins/src/components/design/RichEditor/types.ts` — `CreateExtensionsOptions` / `RichEditorProps` 新增字段（L19–L37、L39–L81）
- `apps/remote-plugins/src/components/design/RichEditor/toolbar/Toolbar.tsx` — `ResizeObserver` 依赖修复（L885–L945）
- `apps/remote-plugins/src/components/design/NotePreview/index.tsx` — `children` / `loading` 插槽（本文未展开逐行注释）
- `apps/remote-plugins/src/components/design/NotePreview/styles.css` — 样式调整（本文未展开）

---
（若与仓库最新源码不一致，以源码为准）
