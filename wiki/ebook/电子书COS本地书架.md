# 电子书：COS 云端备份、本地优先与书架/阅读设置增强

> **文档角色**：本轮（2026-06-13）增量实现说明。主链路见 [电子书阅读书架.md](./电子书阅读书架.md)；连续滚动与 EPUB 设置初版见 [EPUB阅读器设置滚动.md](./EPUB阅读器设置滚动.md)。

## 1. 背景与目标

用户希望桌面端与 Web 端**统一将电子书备份到腾讯云 COS**，同时桌面端在导入大文件或上传未完成时也能**立刻在书架看到书并阅读**；阅读进度始终绑定同一 `bookId`，不因「读本地 / 读云端」而分叉。

本轮同时补齐：

- 书架**滚动分页**（与知识库列表一致）；
- EPUB **阅读设置**扩展（12 档背景/文字色块、系统主题背景、默认连续滚动、分段切换翻页方式、设置面板 `ScrollArea`）；
- 桌面 **Tauri 读盘上限**与上传上限分离（本地打开 512MB、上传 120MB）；
- **PDF / EPUB 阅读区滚动条**统一为细条 + 主题色（原生滚动条 Tailwind 样式，非 ScrollArea 包裹 canvas）。

## 2. 改动范围

| 区域 | 路径 |
|------|------|
| 后端书架分页 / 单书详情 / COS 绑定上传 | `apps/backend/src/services/ebook/` |
| COS 对象读写 | `apps/backend/src/services/upload/` |
| 前端 Store / API | `apps/frontend/src/store/ebook.ts`、`service/index.ts` |
| 打开分流 / Tauri 读盘 | `apps/frontend/src/views/ebook/utils/io.ts`、`src-tauri/.../ebook.rs` |
| 书架页 / 阅读页 | `views/ebook/index.tsx`、`read.tsx` |
| EPUB 设置与渲染 | `utils/epubReaderSettings.ts`、`EpubReaderSettingsPopover.tsx`、`EpubPane.tsx` |
| PDF 阅读区 | `components/PdfPane.tsx` |
| 阅读区滚动条样式 | `utils/readerScrollbar.ts` |
| 上传进度条 | `EbookShelfUploadBanner.tsx` |
| 错误文案 | `utils/fetch.ts`（`getRequestErrorMessage`） |

## 3. 实现思路

### 3.1 桌面「先上架、后上传、本地优先读」

1. **选文件** → 立即 `POST /ebook/add-path` 登记 `localPath`，书架出现该书（同一 `bookId`）。
2. **后台** `POST /ebook/upload` 携带 `bookId`，COS 上传成功后写 `filePath`，**保留** `localPath`。
3. **`resolveOpen`**：Tauri 下先 `read_ebook_file(forUpload: false)`；失败再 `GET /ebook/file/:id`。
4. **进度**：全程 `bookId` 不变，`saveProg` / `progMap` 无需区分来源。

Web 端仍直接上传 COS，无 `localPath`。

### 3.2 大文件策略

- **上传**（multer + Tauri `forUpload: true`）：120MB。
- **本地打开**（Tauri `forUpload: false`）：512MB，避免「超 120MB 无法读本地却又未上传云端」的死胡同。

### 3.3 书架分页

- `GET /ebook/shelf?pageNo=&pageSize=` 返回 `{ books, progMap, total, pageNo, pageSize }`。
- 前端 `ebookStore`：`fetchPage` / `loadMore` / `onShelfViewportScroll`（阈值 `SCROLL_LOAD_THRESHOLD_PX`）。
- 阅读页直链：`GET /ebook/book/:id` + `bookCache`，避免书不在已加载页时打不开。

### 3.4 EPUB 阅读设置

- **12 档背景 + 12 档文字**：色块网格选择；「跟随应用」背景读 `--theme-background`，不再返回 `null`。
- **背景注入**：外层 `style.backgroundColor` + epub.js iframe 内 `html/body` 同色（避免 Tailwind 动态 `bg-[#hex]` 不生效）。
- **默认翻页**：`pageFlow: 'scrolled'`；UI 为分段按钮（连续滚动在前）。
- **设置面板滚动**：`PopoverContent` 内嵌 `ScrollArea`，替代原生滚动条。

### 3.5 PDF / EPUB 阅读区滚动条统一

- **问题**：PDF 长页在 `overflow-auto` 容器内滚动时仍用系统默认粗滚动条，与 EPUB 连续滚动已美化的细条不一致。
- **方案**：抽出 `readerScrollbar.ts` 两组 Tailwind 类常量——`READER_NATIVE_SCROLLBAR`（PDF 外层容器）、`READER_NATIVE_SCROLLBAR_EPUB_CONTAINER`（epub.js 内部 `.epub-container`）。
- **为何不用 ScrollArea 包 canvas**：PDF 需原生滚动 + canvas 尺寸联动；ScrollArea 会改变布局与滚动事件，故仅对滚动条做 CSS 美化（`scrollbar-width:thin` + webkit 伪元素），与 EPUB 观感对齐。

## 4. 关键代码与注释

### 4.1 桌面导入：先 path 后 COS

**来源**：`apps/frontend/src/store/ebook.ts`（`addFromTauri` 与 `uploadBookToCloud` 附近）

```typescript
async addFromTauri(): Promise<Book | null> {
  const picked = await pickTauri();
  if (!picked) return null;

  // 说明：先登记路径，书架立即可见、可点「阅读」
  const book = await addEbookFromPath(picked.path, picked.fmt);

  runInAction(() => {
    this.books = [book, ...this.books.filter((b) => b.id !== book.id)];
    this.uploadState = { phase: 'reading', fileName, bookId: book.id, /* ... */ };
  });

  // 说明：不阻塞 UI；同一 bookId 绑定 COS
  void uploadBookToCloud(this, book.id, picked.path, picked.fmt);
  return book;
}
```

**来源**：`apps/backend/src/services/ebook/ebook.service.ts`（`addFromUpload` 带 `bookId` 分支）

```typescript
if (opts?.bookId) {
  const book = await this.bookRepo.findOne({ where: { id: opts.bookId, userId } });
  // 说明：校验归属与格式后写 filePath，保留 localPath
  book.filePath = cosResult.key;
  book.srcKind = 'store';
  await this.bookRepo.save(book);
  return this.toBookDto(book);
}
```

### 4.2 本地优先打开

**来源**：`apps/frontend/src/views/ebook/utils/io.ts`（`resolveOpen`）

```typescript
export async function resolveOpen(src, _fmt, bookId?) {
  const localPath = resolveLocalPath(src); // path 或 store.localPath
  if (localPath && isTauriRuntime()) {
    try {
      // 说明：forUpload=false，阅读上限 512MB
      return await readTauriBytes(localPath, false);
    } catch {
      // 说明：文件被移动/删除时回退云端
    }
  }
  if (!bookId) throw new Error(/* ... */);
  return await fetchEbookBytes(bookId);
}
```

### 4.3 书架分页

**来源**：`apps/frontend/src/store/ebook.ts`（`onShelfViewportScroll`）

```typescript
onShelfViewportScroll: UIEventHandler<HTMLDivElement> = (e) => {
  const el = e.currentTarget;
  const rest = el.scrollHeight - el.scrollTop - el.clientHeight;
  // 说明：距底 72px 触发下一页，与知识库列表一致
  if (rest < SCROLL_LOAD_THRESHOLD_PX) {
    void this.loadMore();
  }
};
```

### 4.4 系统主题背景色

**来源**：`apps/frontend/src/views/ebook/utils/epubReaderSettings.ts`（`resolveAppThemeBackground` / `resolveEpubBgColor`）

```typescript
export function resolveAppThemeBackground(appTheme: ThemeName): string {
  if (typeof window !== 'undefined') {
    const css = getComputedStyle(document.body)
      .getPropertyValue('--theme-background')
      .trim();
    if (css) return css; // 说明：跟随设置→主题配色的实际 CSS 值（含 oklch）
  }
  return appTheme === 'black' ? '#1a1a1a' : '#fafafa';
}

export function resolveEpubBgColor(bgTheme, appTheme): string {
  if (bgTheme === 'default') return resolveAppThemeBackground(appTheme);
  const opt = EPUB_BG_THEME_OPTIONS.find((o) => o.id === bgTheme);
  return opt?.bgColor ?? resolveAppThemeBackground(appTheme);
}
```

**来源**：`apps/frontend/src/views/ebook/components/EpubPane.tsx`（host 背景）

```typescript
const readerBgColor = resolveEpubBgColor(readerSettings.bgTheme, appThemeName);
// ...
<div ref={hostRef} style={{ backgroundColor: readerBgColor }} />
```

### 4.5 阅读区滚动条（PDF + EPUB）

**来源**：`apps/frontend/src/views/ebook/utils/readerScrollbar.ts`（约 L1–L21）

```typescript
/** 说明：PDF 外层 overflow-auto 容器直接挂这组 class */
export const READER_NATIVE_SCROLLBAR = [
  '[scrollbar-width:thin]',
  '[scrollbar-color:color-mix(in_oklch,var(--theme-border)_60%,transparent)_transparent]',
  '[&::-webkit-scrollbar]:w-2',
  '[&::-webkit-scrollbar-track]:bg-transparent',
  '[&::-webkit-scrollbar-thumb]:rounded-full',
  '[&::-webkit-scrollbar-thumb]:bg-theme-border/60',
  'hover:[&::-webkit-scrollbar-thumb]:bg-theme-border',
] as const;

/** 说明：epub.js 实际滚动发生在 host 内的 .epub-container，需后代选择器 */
export const READER_NATIVE_SCROLLBAR_EPUB_CONTAINER = [
  '[&_.epub-container]:[scrollbar-width:thin]',
  // ... 同上结构，前缀 [&_.epub-container]
] as const;
```

**来源**：`apps/frontend/src/views/ebook/components/PdfPane.tsx`（约 L161–L165）

```typescript
<div
  className={cn(
    'bg-theme/5 flex flex-1 min-h-0 justify-center overflow-auto p-4',
    READER_NATIVE_SCROLLBAR, // 说明：长 PDF 页纵向滚动时显示细条主题色滚动条
  )}
>
  <canvas ref={canvasRef} /* ... */ />
</div>
```

## 5. 兼容性与影响

| 项 | 说明 |
|----|------|
| 旧书架全量 API | 现为分页；未传 `pageNo` 时默认第 1 页、每页 20 条 |
| 旧 `dark`/`amoled` 背景 | 已迁移为 `lavender`/`moon` 等；localStorage 旧 id 经 `migrateBgTheme` 或校验回退 |
| 上传失败 | Toast 展示具体原因；本地书仍可读 |
| 进度 | 同一 `bookId`，无分叉 |

## 6. 建议回归

1. 桌面：选 >120MB 且 <512MB 的 PDF → 书架立现、可阅读、上传失败有提示。
2. 桌面：上传完成后改路径 → 应回退云端仍能打开；进度连续。
3. Web：导入 epub → COS 可读；书架滚到底加载更多。
4. EPUB：切换 12 档背景/文字、跟随应用主题、默认连续滚动、设置面板 ScrollArea 滚动。
5. PDF：多页长文档上下滚动 → 滚动条为细条、与 EPUB 连续滚动观感一致（Firefox `scrollbar-width` / Chromium webkit 伪元素）。
6. 阅读页 URL 直链 `/ebook/read/:id` 且书不在第 1 页书架 → 仍能加载。

## 7. 相关源码路径

| 说明 | 路径 |
|------|------|
| 书架 API | `apps/backend/src/services/ebook/ebook.controller.ts` |
| COS 电子书前缀 | `apps/backend/src/services/upload/cos.config.ts` |
| 前端 Store | `apps/frontend/src/store/ebook.ts` |
| 打开分流 | `apps/frontend/src/views/ebook/utils/io.ts` |
| 阅读设置 | `apps/frontend/src/views/ebook/utils/epubReaderSettings.ts` |
| 阅读区滚动条 | `apps/frontend/src/views/ebook/utils/readerScrollbar.ts` |
| PDF 渲染 | `apps/frontend/src/views/ebook/components/PdfPane.tsx` |

若与仓库最新源码不一致，以源码为准。
