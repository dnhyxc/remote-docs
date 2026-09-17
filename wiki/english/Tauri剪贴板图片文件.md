# Tauri 桌面端剪贴板：图片位图与文件列表多图读取

> 延伸阅读：
> - [docs/english/Tauri剪贴板富文本.md](./Tauri剪贴板富文本.md) —— 早期「纯文本 / HTML flavor」剪贴板接管方案（基线）。
> - [docs/ideas/Tauri剪贴板富文本粘贴.md](../ideas/tauri/Tauri剪贴板富文本粘贴.md) —— 完整图文混合粘贴方案思路与四级降级设计。

## 1. 背景与目标

Tauri 桌面端此前只接管了剪贴板的「纯文本」与「HTML flavor」两种数据：前端通过 `@tauri-apps/plugin-clipboard-manager` 的 `readText` / `readImage` 以及自定义 Rust 命令 `read_clipboard_html` 完成粘贴。该方案在以下场景失效：

- **截图粘贴**：系统剪贴板里只有位图（bitmap），没有 HTML。旧实现虽调用插件 `readImage`，但需在前端用 `canvas.putImageData` 重绘再 `toDataURL`，路径长且在某些 WebView 下 `rgba()` / `size()` 行为不稳，导致截图粘不进 TipTap。
- **多图粘贴**：从 Finder 选中多张图片「复制」、或从富文本应用复制含多图的内容时，剪贴板里是「文件列表（file list）」flavor。`arboard::Clipboard::get_image()` 只能读单张位图，多图会被丢成一张或全丢。
- **纯图片剪贴板阻断 `Promise.all`**：旧 `readClipText` 在 Tauri 下直接 `return readText()`，当剪贴板无文本 flavor（纯截图）时插件抛错，使串行回退流程中断。

本轮目标：用 Rust 侧 `arboard` + `png` + `base64` 直读系统剪贴板「位图」与「文件列表」，前端并行读取 HTML / 位图 / 文件列表 / 纯文本 四种 flavor，再按四级降级合并插入 TipTap 编辑器，覆盖截图、多图、网页图文混合等全部粘贴场景。

## 2. 改动范围

- `apps/frontend/src-tauri/Cargo.toml` —— 新增 `base64 = "0.22"`、`png = "0.17"` 依赖。
- `apps/frontend/src-tauri/Cargo.lock` —— 上述依赖的锁文件更新（机械变更，本文不展开）。
- `apps/frontend/src-tauri/src/command/clipboard.rs` —— 新增 `read_clipboard_image_base64`、`read_clipboard_image_files_base64` 两个 `#[tauri::command]`，以及 `is_image_ext`、`mime_of` 两个私有辅助函数；文件头新增 `std::io::Cursor`、`std::path::Path`、`base64::Engine` 导入。
- `apps/frontend/src-tauri/src/lib.rs` —— 在 `use command::clipboard::{...}` 与 `invoke_handler!([...])` 中注册两个新命令。
- `apps/frontend/src/utils/clipboard.ts` —— `readClipImageAsDataUrl` 由「插件 `readImage` + canvas」改为自定义 Rust 命令；新增 `readClipImageFiles`、`getTipTapEditor`、`insertHtmlViaEditor`、`moveSelectionAfter`、`insertClipSegments`、`preprocessClipboardHtml`、`pickImgSrc`、`isPlaceholderSrc`、`isImgSrc`、`LITERAL_IMG_RE` 等；`readClipText` 加 try-catch；`parseHtmlSegments` 重构；粘贴主流程改为 `Promise.all` 并行读 4 种 flavor + 四级降级。

## 3. 实现思路

1. **位图走 Rust 直读**：`arboard::Clipboard::get_image()` 拿到 `ImageData { width, height, bytes(RGBA) }`，用 `png` crate 编码为 PNG 字节，再 `base64` 编码成 `data:image/png;base64,...` 一次性返回前端。相比旧方案省去前端 canvas 重绘，避免 WebView 下 `rgba()` / `size()` 不稳的问题。
2. **多图走文件列表**：`arboard::Clipboard::get().file_list()` 拿到剪贴板里所有文件路径，逐个用 `std::fs::read` 读字节 + 按扩展名定 MIME + base64 编码。非图片文件、读取失败的单项在 Rust 侧 `continue` 跳过，不影响其他图片。
3. **全局剪贴板锁复用**：`arboard::Clipboard` 非 `Send`，沿用既有 `CLIPBOARD_LOCK: Mutex<()>`，每个命令入口先 `_guard = CLIPBOARD_LOCK.lock()`，串行化对系统剪贴板的访问。
4. **前端并行读四 flavor**：粘贴时 `Promise.all([readClipHtml(), readClipImageAsDataUrl(), readClipImageFiles(), readClipText()])` 并行发起，单个 flavor 失败返回 `null` / `[]` / `''`，不阻断其他 flavor。`readClipText` 加 try-catch 正是为此。
5. **HTML 优先整段插入**：有 HTML 且能拿到 TipTap editor 时，优先用 schema 缓存的 `domParser.parseSlice`（贴近 web 原生粘贴，保留 `<a>` / 段落），失败再回退 `editor.chain().insertContent`。这是对齐 web 端原生粘贴体验的关键。
6. **图片补齐策略**：HTML 插入后若其 `<img>` 数量少于剪贴板实际图片数（`htmlImageCount < extraImages.length && extraImages.length > 1`），或 HTML 完全无图（`htmlImageCount === 0`），再把文件列表 + 位图图片作为额外片段补插，避免多图被 HTML 单图覆盖。
7. **块级图片光标推进**：插入 block image 后常停在 `NodeSelection`，再插下一段会盖掉上一张。新增 `moveSelectionAfter` 用 `Selection.near(doc.resolve(sel.to), 1)` 把光标挪到节点之后。
8. **HTML 预处理抽取**：新增 `preprocessClipboardHtml` 清洗剪贴板 HTML（去 `noscript/script/style`、img src 取懒加载真实地址、剥掉文本里转义的裸 `<img>`），`parseHtmlSegments` 与 `insertHtmlViaEditor` 共用，保证两条路径清洗一致。
9. **四级降级**：① HTML 整段插入 → ② HTML 解析为片段 + 补图 → ③ 纯文本 + 文件列表/位图图片片段 → ④ 无 ProseMirror view 时 `execCommand` 兜底。

## 4. 关键代码对比与注释

### 4.1 `Cargo.toml` `[dependencies]` 块

**对比范围**：`[dependencies]` 段中 `arboard` 到 `tauri-plugin-fs` 之间的图片编码依赖新增。

**改动前** · `apps/frontend/src-tauri/Cargo.toml`（基线，约 L20–L29）

```toml
# 依赖段声明开始
[dependencies]
# Tauri 核心框架，开启托盘图标与 PNG 图片特性
tauri = { version = "2", features = ["tray-icon", "image-png"] }
# 打开外部链接插件
tauri-plugin-opener = "2.5.3"
# 单实例插件，防止重复启动
tauri-plugin-single-instance = "2.3.7"
# 序列化框架
serde = { version = "1", features = ["derive"] }
# JSON 序列化库
serde_json = "1.0.149"
# 剪贴板插件（前端 writeText/readText/readImage 走它）
tauri-plugin-clipboard-manager = "2"
# arboard：跨平台系统剪贴板访问，读 HTML/位图/文件列表
arboard = "3"
# 进程插件（重启等）
tauri-plugin-process = "2"
# 文件系统插件
tauri-plugin-fs = "2"
```

**改动后** · `apps/frontend/src-tauri/Cargo.toml`（当前，约 L20–L31）

```toml
# 依赖段声明开始
[dependencies]
# Tauri 核心框架，开启托盘图标与 PNG 图片特性
tauri = { version = "2", features = ["tray-icon", "image-png"] }
# 打开外部链接插件
tauri-plugin-opener = "2.5.3"
# 单实例插件，防止重复启动
tauri-plugin-single-instance = "2.3.7"
# 序列化框架
serde = { version = "1", features = ["derive"] }
# JSON 序列化库
serde_json = "1.0.149"
# 剪贴板插件（前端 writeText/readText/readImage 走它）
tauri-plugin-clipboard-manager = "2"
# arboard：跨平台系统剪贴板访问，读 HTML/位图/文件列表
arboard = "3"
# 新增：base64 编码，把 PNG/图片字节编码为 data URL
base64 = "0.22"
# 新增：PNG 编码，把位图 RGBA 字节编码为 PNG
png = "0.17"
# 进程插件（重启等）
tauri-plugin-process = "2"
# 文件系统插件
tauri-plugin-fs = "2"
```

**变更摘要**：新增 `base64`、`png` 两个 crate，供 Rust 侧把剪贴板位图与图片文件字节编码为 `data:image/...;base64,...`。

### 4.2 `clipboard.rs` 文件头导入

**对比范围**：`clipboard.rs` 顶部 `use` 语句。

**改动前** · `apps/frontend/src-tauri/src/command/clipboard.rs`（基线，约 L1）

```rust
// 旧版仅需要互斥锁类型，用于全局剪贴板锁
use std::sync::Mutex;
```

**改动后** · `apps/frontend/src-tauri/src/command/clipboard.rs`（当前，约 L1–L4）

```rust
// 新增：Cursor 包装 Vec 作为 PNG 编码的内存输出缓冲
use std::io::Cursor;
// 新增：Path 用于判断文件扩展名是否为图片、定 MIME
use std::path::Path;
// 互斥锁类型，用于全局剪贴板锁（arboard Clipboard 非 Send）
use std::sync::Mutex;
// 新增：引入 base64 Engine trait，才能调用 .encode()
use base64::Engine as _;
```

**变更摘要**：新增 `Cursor`、`Path`、`base64::Engine` 三个导入，服务于 PNG 编码、文件扩展名判断与 base64 编码。

### 4.3 `clipboard.rs` `read_clipboard_image_base64`（纯新增）

**对比范围**：新增 `#[tauri::command]` 函数 `read_clipboard_image_base64` 全函数。纯新增，仅贴改动后。

**改动后** · `apps/frontend/src-tauri/src/command/clipboard.rs`（当前，约 L24–L56，符号 `read_clipboard_image_base64`）

```rust
// 文档注释：读取剪贴板图片位图，编码为 PNG 并返回 base64（含 data URL 前缀）
/// 读取剪贴板图片位图，编码为 PNG 并返回 base64 字符串（含 data URL 前缀）。
// 文档注释：用途说明——单独复制图片/截图场景，链路 arboard → png → base64
/// 用于单独复制图片/截图场景：arboard 读 ImageData → png crate 编码 → base64。
// 文档注释：剪贴板无图片时 get_image 抛错，返回 None
/// 剪贴板无图片时 readImage 抛错，返回 None。
// Tauri 命令宏，注册后前端可 invoke('read_clipboard_image_base64')
#[tauri::command]
// 函数签名：返回 Result<Option<String>, String>，成功为 data URL 或 None，失败为错误字符串
pub fn read_clipboard_image_base64() -> Result<Option<String>, String> {
    // 取全局剪贴板锁，串行化 arboard 访问（Clipboard 非 Send）
    let _guard = CLIPBOARD_LOCK.lock().map_err(|e| e.to_string())?;
    // 新建 arboard 剪贴板句柄，失败转字符串错误
    let mut clipboard = arboard::Clipboard::new().map_err(|e| e.to_string())?;
    // 尝试读取位图：成功拿到 ImageData，失败（无位图）直接返回 None
    let img = match clipboard.get_image() {
        // 成功：绑定 img
        Ok(img) => img,
        // 失败：剪贴板无图片位图，返回 Ok(None) 静默忽略
        Err(_) => return Ok(None),
    };
    // 取位图宽度
    let width = img.width;
    // 取位图高度
    let height = img.height;
    // 宽高为 0 或字节为空时视为无效，返回 None
    if width == 0 || height == 0 || img.bytes.is_empty() {
        // 返回 None 表示无可用位图
        return Ok(None);
    }
    // 注释：把 RGBA 字节编码为 PNG
    // RGBA 字节编码为 PNG
    // 创建基于 Vec 的 Cursor 作为 PNG 输出缓冲
    let mut png_buf = Cursor::new(Vec::new());
    // 用花括号限定 encoder/writer 作用域，使其在编码完成后及时释放借用
    {
        // 创建 PNG 编码器，写入 png_buf，宽高转 u32
        let mut encoder = png::Encoder::new(&mut png_buf, width as u32, height as u32);
        // 设置颜色类型为 RGBA（与 arboard 输出一致）
        encoder.set_color(png::ColorType::Rgba);
        // 设置位深为 8 位每通道
        encoder.set_depth(png::BitDepth::Eight);
        // 写 PNG 头，失败转带前缀的字符串错误
        let mut writer = encoder
            .write_header()
            .map_err(|e| format!("png header: {}", e))?;
        // 写入图像像素数据，失败转带前缀的字符串错误
        writer
            .write_image_data(&img.bytes)
            .map_err(|e| format!("png write: {}", e))?;
    }
    // 取出 Cursor 内部的 Vec<u8>，即最终 PNG 字节
    let png_bytes = png_buf.into_inner();
    // 用标准 base64 编码 PNG 字节
    let b64 = base64::engine::general_purpose::STANDARD.encode(&png_bytes);
    // 拼接 data URL 前缀返回前端
    Ok(Some(format!("data:image/png;base64,{}", b64)))
}
```

**变更摘要**：纯新增命令。`arboard::get_image` → `png` 编码 → `base64` → `data:image/png;base64,...`，无图片返回 `None`。

### 4.4 `clipboard.rs` `is_image_ext`（纯新增）

**对比范围**：新增私有辅助函数 `is_image_ext` 全函数。纯新增。

**改动后** · `apps/frontend/src-tauri/src/command/clipboard.rs`（当前，约 L58–L69，符号 `is_image_ext`）

```rust
// 文档注释：按扩展名判断是否常见图片格式
/// 判断文件扩展名是否为常见图片格式。
// 私有函数，入参为文件路径引用，返回 bool
fn is_image_ext(path: &Path) -> bool {
    // 取路径扩展名，OsStr 转 &str，再转小写，缺失则空串
    let ext = path
        // 取扩展名（Option<&OsStr>）
        .extension()
        // OsStr 转 &str
        .and_then(|e| e.to_str())
        // 转成 ASCII 小写，便于比较
        .map(|e| e.to_ascii_lowercase())
        // 无扩展名时给空字符串兜底
        .unwrap_or_default();
    // matches! 宏判断扩展名是否落在常见图片集合内
    matches!(
        // 取小写扩展名切片
        ext.as_str(),
        // 图片扩展名集合：png/jpg/jpeg/gif/bmp/webp/ico/tiff/tif
        "png" | "jpg" | "jpeg" | "gif" | "bmp" | "webp" | "ico" | "tiff" | "tif"
    )
}
```

**变更摘要**：纯新增。按扩展名白名单判断剪贴板文件列表中的文件是否为图片。

### 4.5 `clipboard.rs` `mime_of`（纯新增）

**对比范围**：新增私有辅助函数 `mime_of` 全函数。纯新增。

**改动后** · `apps/frontend/src-tauri/src/command/clipboard.rs`（当前，约 L71–L88，符号 `mime_of`）

```rust
// 文档注释：按扩展名猜测 MIME 类型，用于 data URL 前缀
/// 根据扩展名猜测 MIME 类型，用于 data URL 前缀。
// 私有函数，入参路径引用，返回静态 str（MIME）
fn mime_of(path: &Path) -> &'static str {
    // 取路径扩展名并转小写，缺失则空串
    let ext = path
        // 取扩展名
        .extension()
        // OsStr 转 &str
        .and_then(|e| e.to_str())
        // 转 ASCII 小写
        .map(|e| e.to_ascii_lowercase())
        // 无扩展名兜底空串
        .unwrap_or_default();
    // 按扩展名匹配对应 MIME 类型
    match ext.as_str() {
        // png 对应 image/png
        "png" => "image/png",
        // jpg/jpeg 对应 image/jpeg
        "jpg" | "jpeg" => "image/jpeg",
        // gif 对应 image/gif
        "gif" => "image/gif",
        // bmp 对应 image/bmp
        "bmp" => "image/bmp",
        // webp 对应 image/webp
        "webp" => "image/webp",
        // ico 对应 image/x-icon
        "ico" => "image/x-icon",
        // tiff/tif 对应 image/tiff
        "tiff" | "tif" => "image/tiff",
        // 未知扩展名回退为二进制流，避免 data URL 前缀错误
        _ => "application/octet-stream",
    }
}
```

**变更摘要**：纯新增。为文件列表中每张图片拼 `data:<mime>;base64,...` 提供按扩展名映射的 MIME。

### 4.6 `clipboard.rs` `read_clipboard_image_files_base64`（纯新增）

**对比范围**：新增 `#[tauri::command]` 函数 `read_clipboard_image_files_base64` 全函数。纯新增。

**改动后** · `apps/frontend/src-tauri/src/command/clipboard.rs`（当前，约 L90–L116，符号 `read_clipboard_image_files_base64`）

```rust
// 文档注释：读取剪贴板文件列表中的图片文件，逐个编码为 data URL 返回
/// 读取剪贴板文件列表中的图片文件，逐个编码为 data URL 返回。
// 文档注释：多图粘贴场景说明（Finder 多选复制、富文本应用多图）
/// 用于多图粘贴场景（如从 Finder 选中多个图片文件复制、从富文本应用复制多图）：
// 文档注释：arboard get_image 只能读单张位图，file_list 才能拿到全部路径
/// arboard get_image 只能读单张位图，file_list 能拿到所有文件路径。
// 文档注释：非图片、读取失败的单项会被跳过，不影响其他图片
/// 非图片文件、读取失败的单项会被跳过，不影响其他图片。
// Tauri 命令宏，前端可 invoke('read_clipboard_image_files_base64')
#[tauri::command]
// 函数签名：返回 Result<Vec<String>, String>，每项为 data URL
pub fn read_clipboard_image_files_base64() -> Result<Vec<String>, String> {
    // 取全局剪贴板锁，串行化 arboard 访问
    let _guard = CLIPBOARD_LOCK.lock().map_err(|e| e.to_string())?;
    // 新建 arboard 剪贴板句柄
    let mut clipboard = arboard::Clipboard::new().map_err(|e| e.to_string())?;
    // 读取文件列表：仅当非空时继续，否则返回空 Vec
    let paths = match clipboard.get().file_list() {
        // 成功且非空：绑定 paths
        Ok(paths) if !paths.is_empty() => paths,
        // 空 或 失败：返回空 Vec（剪贴板无文件列表）
        _ => return Ok(Vec::new()),
    };
    // 收集结果的 Vec
    let mut result: Vec<String> = Vec::new();
    // 遍历剪贴板里每个文件路径
    for path in paths {
        // 非图片扩展名直接跳过
        if !is_image_ext(&path) {
            // 跳过当前文件
            continue;
        }
        // 读文件字节：成功绑定 bytes，失败跳过该项
        let bytes = match std::fs::read(&path) {
            // 成功：绑定字节
            Ok(b) => b,
            // 读失败（权限/不存在）：跳过，不影响其他图片
            Err(_) => continue,
        };
        // 按扩展名取 MIME
        let mime = mime_of(&path);
        // base64 编码图片字节
        let b64 = base64::engine::general_purpose::STANDARD.encode(&bytes);
        // 拼接 data URL 并推入结果
        result.push(format!("data:{};base64,{}", mime, b64));
    }
    // 返回所有图片的 data URL 列表（可能为空）
    Ok(result)
}
```

**变更摘要**：纯新增命令。`arboard file_list` → 过滤图片扩展名 → `fs::read` → base64，多图逐个返回，单点失败不阻断。

### 4.7 `lib.rs` 命令导入与注册

**对比范围**：`use command::clipboard::{...}` 导入语句与 `invoke_handler!([...])` 中剪贴板命令注册行。

**改动前** · `apps/frontend/src-tauri/src/lib.rs`（基线，约 L29 与 L97）

```rust
// 旧版只导入 read_clipboard_html 一个剪贴板命令
use command::clipboard::read_clipboard_html;
```

```rust
// 旧版 invoke_handler 列表里只注册了 read_clipboard_html
            read_clipboard_html,   // 读取剪贴板 HTML（图文混合粘贴）
```

**改动后** · `apps/frontend/src-tauri/src/lib.rs`（当前，约 L29–L31 与 L97–L99）

```rust
// 导入剪贴板命令：HTML + 新增的位图、文件列表
use command::clipboard::{
    // 读取剪贴板 HTML flavor 命令
    read_clipboard_html, read_clipboard_image_base64, read_clipboard_image_files_base64,
};
```

```rust
            // 读取剪贴板 HTML（图文混合粘贴）
            read_clipboard_html,   // 读取剪贴板 HTML（图文混合粘贴）
            // 新增：读取剪贴板图片位图（单独复制图片 / 截图）
            read_clipboard_image_base64, // 读取剪贴板图片位图（单独复制图片）
            // 新增：读取剪贴板文件列表中的图片（多图粘贴）
            read_clipboard_image_files_base64, // 读取剪贴板文件列表中的图片（多图粘贴）
```

**变更摘要**：导入并注册两个新命令，前端可通过 `invoke('read_clipboard_image_base64')` / `invoke('read_clipboard_image_files_base64')` 调用。

### 4.8 `clipboard.ts` `readClipText`（改动前 / 改动后）

**对比范围**：`readClipText` 全函数。

**改动前** · `apps/frontend/src/utils/clipboard.ts`（基线，约 L22–L31，符号 `readClipText`）

```typescript
// 声明异步读纯文本函数，返回 string
async function readClipText(): Promise<string> {
	// Tauri 桌面端分支
	if (isTauriRuntime()) {
		// 动态导入插件 readText
		const { readText } = await import('@tauri-apps/plugin-clipboard-manager');
		// 直接返回 readText()，旧版未捕获异常：纯图片剪贴板会抛错并向上冒泡
		return readText();
	}
	// 浏览器分支：优先用 navigator.clipboard
	if (navigator.clipboard?.readText) {
		// 直接返回 readText()，旧版未捕获异常
		return navigator.clipboard.readText();
	}
	// 都不可用时返回空串
	return '';
}
```

**改动后** · `apps/frontend/src/utils/clipboard.ts`（当前，约 L22–L40，符号 `readClipText`）

```typescript
// 声明异步读纯文本函数，返回 string
async function readClipText(): Promise<string> {
	// Tauri 桌面端分支
	if (isTauriRuntime()) {
		// 新增 try-catch：纯图片/截图剪贴板无文本 flavor 时插件抛错，这里降级为空串
		try {
			// 动态导入插件 readText
			const { readText } = await import('@tauri-apps/plugin-clipboard-manager');
			// await 后返回，确保异常能被 try-catch 捕获
			return await readText();
		} catch {
			// 剪贴板无文本 flavor（如纯图片/截图）：返回空串，不阻断 Promise.all
			return '';
		}
	}
	// 浏览器分支：优先用 navigator.clipboard
	if (navigator.clipboard?.readText) {
		// 新增 try-catch：避免权限拒绝等异常冒泡
		try {
			// await 后返回
			return await navigator.clipboard.readText();
		} catch {
			// 浏览器拒绝读取时降级为空串
			return '';
		}
	}
	// 都不可用时返回空串
	return '';
}
```

**变更摘要**：两个分支均加 try-catch 并 `await`，纯图片剪贴板不再抛错，保证 `Promise.all` 四 flavor 并行不被单个失败阻断。

### 4.9 `clipboard.ts` 图片 src 辅助常量与函数（纯新增）

**对比范围**：新增 `LITERAL_IMG_RE`、`isPlaceholderSrc`、`isImgSrc`、`pickImgSrc`。其中 `isImgSrc` 在旧版 `parseHtmlSegments` 内部以 lambda 形式存在（仅校验 `http/data:image`），本轮抽到模块级并改用排除法（只排除 `javascript:`）。纯新增模块级符号。

**改动后** · `apps/frontend/src/utils/clipboard.ts`（当前，约 L62–L99，符号 `LITERAL_IMG_RE` / `isPlaceholderSrc` / `isImgSrc` / `pickImgSrc`）

```typescript
// 匹配文本中字面量 <img> 标签的正则，用于剥掉被转义进文本的裸 img 标签
const LITERAL_IMG_RE = /<img\b[^>]*>/gi;

// 文档注释：1x1 占位图（知乎等懒加载）判定
/** 1x1 占位图（知乎等懒加载） */
// 判断给定 src 是否为占位图，返回 bool
function isPlaceholderSrc(src: string): boolean {
	// 去首尾空白
	const s = src.trim();
	// 短小的 SVG base64 视为占位
	if (s.startsWith('data:image/svg+xml;base64,') && s.length < 250) return true;
	// 短小的 GIF base64 视为占位
	if (s.startsWith('data:image/gif;base64,') && s.length < 100) return true;
	// 短小的 PNG base64 视为占位
	if (s.startsWith('data:image/png;base64,') && s.length < 200) return true;
	// 其余视为正常图
	return false;
}

// 判断 src 是否可用：非空且非 javascript: 协议
function isImgSrc(src: string): boolean {
	// 去首尾空白
	const s = src.trim();
	// 空串或 javascript: 协议视为不可用
	if (!s || /^javascript:/i.test(s)) return false;
	// 其余（含 http、data、blob、相对路径）均可用
	return true;
}

// 文档注释：懒加载属性优先，拿真实图 URL
/** 懒加载属性优先，拿真实图 URL */
// 从 img 元素挑选真实 src，返回 string 或 null
function pickImgSrc(el: Element): string | null {
	// 候选属性列表：懒加载真实地址优先于 src
	const candidates = [
		// data-rawsrc 优先（部分站点自定义）
		el.getAttribute('data-rawsrc'),
		// data-src 常见懒加载
		el.getAttribute('data-src'),
		// data-original 常见懒加载
		el.getAttribute('data-original'),
		// src 兜底
		el.getAttribute('src'),
	// 过滤掉 null，断言为 string[]
	].filter(Boolean) as string[];
	// 遍历候选，取第一个可用且非占位的
	for (const src of candidates) {
		// 可用且非占位则直接返回
		if (isImgSrc(src) && !isPlaceholderSrc(src)) return src;
	}
	// 候选都不可用时尝试 srcset 的第一项
	const srcset = el.getAttribute('srcset');
	// 有 srcset 才处理
	if (srcset) {
		// 取 srcset 第一段、去掉描述符
		const first = srcset.split(',')[0]?.trim().split(' ')[0];
		// 第一项可用则返回
		if (first && isImgSrc(first)) return first;
	}
	// 仍无可用 src：返回第一个非空候选的原值（兜底，可能为占位图但总比 null 强）
	for (const src of candidates) {
		// 非空则返回 trim 后的值
		if (src.trim()) return src.trim();
	}
	// 全部为空返回 null
	return null;
}
```

**变更摘要**：把图片 src 选取逻辑抽成模块级 `pickImgSrc`，支持懒加载属性、占位图过滤、srcset 兜底，供 `preprocessClipboardHtml` 与 `parseHtmlSegments` 共用。

### 4.10 `clipboard.ts` `preprocessClipboardHtml`（纯新增）

**对比范围**：新增 `preprocessClipboardHtml` 全函数。旧版无此函数（清洗逻辑分散在 `parseHtmlSegments` 内）。纯新增。

**改动后** · `apps/frontend/src/utils/clipboard.ts`（当前，约 L101–L130，符号 `preprocessClipboardHtml`）

```typescript
// 文档注释：清洗剪贴板 HTML，交给 TipTap insertContent，对齐 web 原生粘贴
/**
 * 清洗剪贴板 HTML，交给 TipTap insertContent（对齐 web 原生粘贴：保留 <a>、段落，不人造空行）。
 * - 去掉 noscript/script 等重复源码
 * - img 的 src 改写为 data-original 等真实地址
 * - 剥掉文本里转义的裸 <img> 标签
 */
// 入参 html 原始字符串，返回清洗后的 innerHTML
function preprocessClipboardHtml(html: string): string {
	// 创建临时 div 承载 HTML 以便用 DOM API 遍历
	const tmp = document.createElement('div');
	// 把原始 HTML 注入临时 div
	tmp.innerHTML = html;
	// 移除会重复或危险的标签：noscript/script/style/template
	tmp
		.querySelectorAll('noscript, script, style, template')
		.forEach((el) => {
			// 直接删除该节点
			el.remove();
		});
	// 处理每个 img：把 src 改写为懒加载真实地址，无可用 src 则移除
	tmp.querySelectorAll('img').forEach((img) => {
		// 用 pickImgSrc 选真实 src
		const src = pickImgSrc(img);
		// 有可用 src 则写回 src 属性
		if (src) img.setAttribute('src', src);
		// 无可用 src 则移除该 img
		else img.remove();
	});
	// 创建 TreeWalker 遍历文本节点，处理被转义进文本的裸 <img>
	const walk = document.createTreeWalker(tmp, NodeFilter.SHOW_TEXT);
	// 收集需要处理的文本节点
	const texts: Text[] = [];
	// 逐个推进并把当前节点收入 texts
	while (walk.nextNode()) texts.push(walk.currentNode as Text);
	// 遍历收集到的文本节点
	for (const t of texts) {
		// 取文本内容
		const v = t.textContent ?? '';
		// 不含字面量 <img> 则跳过
		if (!LITERAL_IMG_RE.test(v)) continue;
		// 命中则重置正则 lastIndex（g 标志需手动重置）
		LITERAL_IMG_RE.lastIndex = 0;
		// 把文本里的裸 <img> 标签替换为空
		t.textContent = v.replace(LITERAL_IMG_RE, '');
	}
	// 返回清洗后的 HTML 字符串
	return tmp.innerHTML;
}
```

**变更摘要**：纯新增。集中清洗剪贴板 HTML（去脚本/样式、img 取真实 src、剥裸 img 文本），供 HTML 整段插入与片段解析两条路径共用。

### 4.11 `clipboard.ts` `parseHtmlSegments`（改动前 / 改动后）

**对比范围**：`parseHtmlSegments` 全函数。重构点：① 入口 `innerHTML = html` 改为先 `preprocessClipboardHtml(html)`；② 内联 `isImgSrc` lambda 与重复的 `blockTags` 删除，改用模块级 `pickImgSrc` 与函数级 `blockTags`；③ img 取 src 改用 `pickImgSrc`；④ 注释精简。

**改动前** · `apps/frontend/src/utils/clipboard.ts`（基线，约 L57–L155，符号 `parseHtmlSegments`）

```typescript
// 文档注释：按原始 DOM 顺序解析剪贴板 HTML，产出文本与图片片段序列
/**
 * 按原始 DOM 顺序解析剪贴板 HTML，产出文本与图片片段序列。
 * 保证粘贴后图文相对顺序与复制时一致（图片在前则插入时图片也在前）。
 */
// 函数签名：html → ClipSegment[]
function parseHtmlSegments(html: string): ClipSegment[] {
	// 创建临时 div 承载 HTML
	const tmp = document.createElement('div');
	// 旧版直接注入原始 HTML，未做脚本/占位图清洗
	tmp.innerHTML = html;
	// 注释：br 转换行，保留基本排版
	// br 转换行，保留基本排版
	// 把所有 <br> 替换为换行符
	tmp.querySelectorAll('br').forEach((br) => {
		// 用文本节点 '\n' 替换 br
		br.replaceWith('\n');
	});
	// 片段收集数组
	const segments: ClipSegment[] = [];
	// 旧版内联 isImgSrc：只接受 http/data:image，会漏掉 blob/相对路径
	const isImgSrc = (src: string) => /^https?:\/\/|^data:image\//i.test(src);

	// 注释：深度优先遍历：按文档顺序收集文本与图片节点
	// 深度优先遍历：按文档顺序收集文本与图片节点
	// walk 递归函数
	const walk = (node: Node) => {
		// 元素节点分支
		if (node.nodeType === Node.ELEMENT_NODE) {
			// 取元素与标签名小写
			const el = node as Element;
			const tag = el.tagName.toLowerCase();
			// img 节点：取 src
			if (tag === 'img') {
				// 旧版只取 src 属性
				const src = el.getAttribute('src') ?? '';
				// 旧版用内联 isImgSrc 校验
				if (src && isImgSrc(src)) {
					// 命中则推入图片片段
					segments.push({ type: 'image', src });
				}
				// img 内部不再遍历
				return; // img 内部不再遍历
			}
			// 注释：块级元素前后补换行，保留排版
			// 块级元素前后补换行，保留排版
			// 旧版每次进入 walk 都新建 blockTags（重复构造）
			const blockTags = new Set([
				// 段落
				'p',
				// div
				'div',
				// 列表项
				'li',
				// 各级标题
				'h1',
				'h2',
				'h3',
				'h4',
				'h5',
				'h6',
				// 表格行
				'tr',
				// 引用块
				'blockquote',
			]);
			// 块级标签前补换行
			if (blockTags.has(tag)) {
				// 推入文本换行片段
				segments.push({ type: 'text', value: '\n' });
			}
		}
		// 文本节点分支
		if (node.nodeType === Node.TEXT_NODE) {
			// 取文本内容
			const value = node.textContent ?? '';
			// 非空则推入文本片段
			if (value) segments.push({ type: 'text', value });
			// 文本节点无子节点
			return; // 文本节点无子节点
		}
		// 递归遍历子节点
		node.childNodes.forEach(walk);
		// 子节点遍历后再处理当前元素块级换行
		if (node.nodeType === Node.ELEMENT_NODE) {
			// 取标签名
			const tag = (node as Element).tagName.toLowerCase();
			// 旧版再次重复构造 blockTags
			const blockTags = new Set([
				// 段落
				'p',
				// div
				'div',
				// 列表项
				'li',
				// 标题
				'h1',
				'h2',
				'h3',
				'h4',
				'h5',
				'h6',
				// 表格行
				'tr',
				// 引用块
				'blockquote',
			]);
			// 块级标签后补换行
			if (blockTags.has(tag)) {
				// 推入换行片段
				segments.push({ type: 'text', value: '\n' });
			}
		}
	};
	// 从 tmp 根开始遍历
	walk(tmp);
	// 注释：合并相邻文本片段，压缩多余空行
	// 合并相邻文本片段，压缩多余空行
	// 合并结果数组
	const merged: ClipSegment[] = [];
	// 文本缓冲
	let buf = '';
	// 遍历原始片段
	for (const seg of segments) {
		// 文本片段累加到 buf
		if (seg.type === 'text') {
			// 累加
			buf += seg.value;
		} else {
			// 图片片段前先 flush buf
			if (buf) {
				// 推入累积文本
				merged.push({ type: 'text', value: buf });
				// 清空缓冲
				buf = '';
			}
			// 推入图片片段
			merged.push(seg);
		}
	}
	// 末尾残留 buf 推入
	if (buf) merged.push({ type: 'text', value: buf });
	// 注释：压缩 3+ 换行为 2 个，trim 首尾
	// 压缩 3+ 换行为 2 个，trim 首尾
	// 链式：先压缩换行，再过滤首尾空文本
	return merged
		// map：压缩 3 个及以上换行为 2 个
		.map((seg) =>
			// 文本片段才压缩
			seg.type === 'text'
				? { ...seg, value: seg.value.replace(/\n{3,}/g, '\n\n') }
				: seg,
		)
		// filter：丢弃首尾纯空文本，保留中间的换行
		.filter((seg, i, arr) => {
			// 文本片段处理
			if (seg.type === 'text') {
				// 纯空白文本
				if (seg.value.trim() === '') {
					// 注释：保留片段间的单个换行，仅丢弃纯空的首尾
					// 保留片段间的单个换行，仅丢弃纯空的首尾
					// 首尾丢弃，中间保留
					return i !== 0 && i !== arr.length - 1;
				}
			}
			// 非空文本与图片片段一律保留
			return true;
		});
}
```

**改动后** · `apps/frontend/src/utils/clipboard.ts`（当前，约 L132–L206，符号 `parseHtmlSegments`）

```typescript
// 文档注释：按原始 DOM 顺序解析剪贴板 HTML → 文本/图片片段（无 TipTap 时的回退路径）
/**
 * 按原始 DOM 顺序解析剪贴板 HTML → 文本/图片片段（无 TipTap 时的回退路径）。
 */
// 函数签名：html → ClipSegment[]
function parseHtmlSegments(html: string): ClipSegment[] {
	// 创建临时 div 承载 HTML
	const tmp = document.createElement('div');
	// 新版：先经 preprocessClipboardHtml 清洗（去脚本/真实 src/剥裸 img）
	tmp.innerHTML = preprocessClipboardHtml(html);
	// 把 <br> 替换为换行符
	tmp.querySelectorAll('br').forEach((br) => {
		// 用文本节点 '\n' 替换 br
		br.replaceWith('\n');
	});
	// 片段收集数组
	const segments: ClipSegment[] = [];
	// 新版：blockTags 提到函数级，只构造一次，避免 walk 内重复 new Set
	const blockTags = new Set([
		// 段落
		'p',
		// div
		'div',
		// 列表项
		'li',
		// 各级标题
		'h1',
		'h2',
		'h3',
		'h4',
		'h5',
		'h6',
		// 表格行
		'tr',
		// 引用块
		'blockquote',
	]);

	// walk 递归函数：深度优先遍历收集片段
	const walk = (node: Node) => {
		// 元素节点分支
		if (node.nodeType === Node.ELEMENT_NODE) {
			// 取元素与标签名小写
			const el = node as Element;
			const tag = el.tagName.toLowerCase();
			// img 节点：用 pickImgSrc 取真实 src
			if (tag === 'img') {
				// 新版：pickImgSrc 支持懒加载属性与占位图过滤
				const src = pickImgSrc(el);
				// 有可用 src 才推入图片片段
				if (src) segments.push({ type: 'image', src });
				// img 内部不再遍历
				return;
			}
			// 块级标签前补换行（单行写法）
			if (blockTags.has(tag)) segments.push({ type: 'text', value: '\n' });
		}
		// 文本节点分支
		if (node.nodeType === Node.TEXT_NODE) {
			// 取文本内容
			const value = node.textContent ?? '';
			// 非空则推入文本片段
			if (value) segments.push({ type: 'text', value });
			// 文本节点无子节点
			return;
		}
		// 递归遍历子节点
		node.childNodes.forEach(walk);
		// 子节点遍历后再处理当前元素块级换行
		if (node.nodeType === Node.ELEMENT_NODE) {
			// 取标签名
			const tag = (node as Element).tagName.toLowerCase();
			// 块级标签后补换行（单行写法，复用函数级 blockTags）
			if (blockTags.has(tag)) segments.push({ type: 'text', value: '\n' });
		}
	};
	// 从 tmp 根开始遍历
	walk(tmp);

	// 合并相邻文本片段
	const merged: ClipSegment[] = [];
	// 文本缓冲
	let buf = '';
	// 遍历原始片段
	for (const seg of segments) {
		// 文本片段累加到 buf
		if (seg.type === 'text') {
			// 累加
			buf += seg.value;
		} else {
			// 图片片段前先 flush buf
			if (buf) {
				// 推入累积文本
				merged.push({ type: 'text', value: buf });
				// 清空缓冲
				buf = '';
			}
			// 推入图片片段
			merged.push(seg);
		}
	}
	// 末尾残留 buf 推入
	if (buf) merged.push({ type: 'text', value: buf });
	// 链式：压缩换行 + 过滤首尾空文本
	return merged
		// map：压缩 3 个及以上换行为 2 个
		.map((seg) =>
			// 文本片段才压缩
			seg.type === 'text'
				? { ...seg, value: seg.value.replace(/\n{3,}/g, '\n\n') }
				: seg,
		)
		// filter：丢弃首尾纯空文本，保留中间换行
		.filter((seg, i, arr) => {
			// 文本且纯空白：仅首尾丢弃
			if (seg.type === 'text' && seg.value.trim() === '') {
				// 首尾丢弃，中间保留
				return i !== 0 && i !== arr.length - 1;
			}
			// 其余保留
			return true;
		});
}
```

**变更摘要**：入口改走 `preprocessClipboardHtml`；`blockTags` 提为函数级常量避免重复构造；img 取 src 改用模块级 `pickImgSrc`（支持懒加载与占位图过滤）；删除内联 `isImgSrc` lambda 与重复 `blockTags`，注释精简。

### 4.12 `clipboard.ts` `readClipImageAsDataUrl`（改动前 / 改动后）

**对比范围**：`readClipImageAsDataUrl` 全函数。核心改动：从「插件 `readImage` + canvas 重绘」改为「自定义 Rust 命令 `read_clipboard_image_base64`」。

**改动前** · `apps/frontend/src/utils/clipboard.ts`（基线，约 L163–L188，符号 `readClipImageAsDataUrl`）

```typescript
// 文档注释：读取系统剪贴板图片位图，经 canvas 转 PNG data URL
/**
 * Tauri 桌面端：读取系统剪贴板图片位图，经 canvas 转 PNG data URL。
 * 走 Tauri IPC（plugin-clipboard-manager），不触发 navigator.clipboard 的 Web 权限弹窗。
 * 剪贴板无图片位图时 readImage 抛错，返回 null 静默忽略。
 * 覆盖截图、从图片应用复制等"独立位图"场景；网页复制的 <img src> 远程图片拿不到。
 */
// 函数签名：返回 data URL 或 null
async function readClipImageAsDataUrl(): Promise<string | null> {
	// 非 Tauri 直接返回 null
	if (!isTauriRuntime()) return null;
	// try-catch：readImage 无图片时抛错
	try {
		// 旧版：动态导入插件 readImage
		const { readImage } = await import('@tauri-apps/plugin-clipboard-manager');
		// 读取图片句柄
		const img = await readImage();
		// 取 RGBA 像素字节
		const rgba = await img.rgba();
		// 取图片尺寸
		const size = await img.size();
		// 宽度兜底 0
		const width = size?.width ?? 0;
		// 高度兜底 0
		const height = size?.height ?? 0;
		// 注释：放宽校验：只要宽高非零且 rgba 存在就尝试转换
		// 放宽校验：只要宽高非零且 rgba 存在就尝试转换（位图长度由 Tauri 保证）
		// 宽高或 rgba 异常时返回 null
		if (!width || !height || !rgba || rgba.length === 0) return null;
		// 创建 canvas
		const canvas = document.createElement('canvas');
		// 设置画布宽度
		canvas.width = width;
		// 设置画布高度
		canvas.height = height;
		// 取 2d 上下文
		const ctx = canvas.getContext('2d');
		// 无上下文返回 null
		if (!ctx) return null;
		// 把 RGBA 写入 canvas
		ctx.putImageData(
			// 构造 ImageData
			new ImageData(new Uint8ClampedArray(rgba), width, height),
			// 起点坐标
			0,
			0,
		);
		// 导出 PNG data URL 返回
		return canvas.toDataURL('image/png');
	} catch {
		// 异常静默返回 null
		return null;
	}
}
```

**改动后** · `apps/frontend/src/utils/clipboard.ts`（当前，约 L213–L222，符号 `readClipImageAsDataUrl`）

```typescript
// 文档注释：读取系统剪贴板图片位图，Rust 侧用 arboard 读取并编码为 PNG base64 data URL
/**
 * Tauri 桌面端：读取系统剪贴板图片位图，Rust 侧用 arboard 读取并编码为 PNG base64 data URL。
 * 走自定义 Rust 命令 read_clipboard_image_base64，避免 Tauri plugin readImage 的 canvas 转换问题。
 * 剪贴板无图片位图时返回 null。覆盖截图、从图片应用复制等"独立位图"场景。
 */
// 函数签名：返回 data URL 或 null
async function readClipImageAsDataUrl(): Promise<string | null> {
	// 非 Tauri 直接返回 null
	if (!isTauriRuntime()) return null;
	// try-catch：Rust 侧无图片返回 null，命令异常也兜底 null
	try {
		// 新版：动态导入 Tauri invoke
		const { invoke } = await import('@tauri-apps/api/core');
		// 调用自定义 Rust 命令，直接拿 data URL（PNG 编码在 Rust 侧完成）
		const dataUrl = await invoke<string | null>('read_clipboard_image_base64');
		// 校验前缀是 data:image/ 才返回，否则 null
		return dataUrl?.startsWith('data:image/') ? dataUrl : null;
	} catch {
		// 异常静默返回 null
		return null;
	}
}
```

**变更摘要**：删除前端 canvas 重绘链路（`rgba` / `size` / `putImageData` / `toDataURL`），改为一次 `invoke('read_clipboard_image_base64')` 拿 Rust 侧已编码好的 PNG data URL，规避 WebView 下插件图片 API 不稳问题。

### 4.13 `clipboard.ts` `readClipImageFiles`（纯新增）

**对比范围**：新增 `readClipImageFiles` 全函数。纯新增。

**改动后** · `apps/frontend/src/utils/clipboard.ts`（当前，约 L230–L239，符号 `readClipImageFiles`）

```typescript
// 文档注释：读取剪贴板文件列表中的所有图片文件，逐个返回 data URL
/**
 * Tauri 桌面端：读取剪贴板文件列表中的所有图片文件，逐个返回 data URL。
 * 走自定义 Rust 命令 read_clipboard_image_files_base64（arboard file_list + fs::read）。
 * 覆盖从 Finder 选中多个图片文件复制、从富文本应用复制多图等场景（arboard get_image 只能读单张）。
 * 非图片文件、读取失败的单项在 Rust 侧已跳过。
 */
// 函数签名：返回 data URL 数组
async function readClipImageFiles(): Promise<string[]> {
	// 非 Tauri 返回空数组
	if (!isTauriRuntime()) return [];
	// try-catch：命令异常兜底空数组
	try {
		// 动态导入 Tauri invoke
		const { invoke } = await import('@tauri-apps/api/core');
		// 调用 Rust 命令读取文件列表中所有图片的 data URL
		const list = await invoke<string[]>('read_clipboard_image_files_base64');
		// 过滤出合法 data URL，防御 Rust 侧返回异常项
		return (list ?? []).filter((s) => s.startsWith('data:image/'));
	} catch {
		// 异常返回空数组
		return [];
	}
}
```

**变更摘要**：纯新增。前端封装 `read_clipboard_image_files_base64` 调用，多图粘贴场景的数据入口。

### 4.14 `clipboard.ts` `getTipTapEditor` 与 `getProseMirrorView`（改动前 / 改动后）

**对比范围**：`getTipTapEditor`（纯新增）与 `getProseMirrorView`（改动：先尝试 TipTap editor 再回退 pmViewDesc）。

**改动前** · `apps/frontend/src/utils/clipboard.ts`（基线，约 L194–L202，符号 `getProseMirrorView`）

```typescript
// 文档注释：从 DOM 元素向上查找 ProseMirror EditorView
/**
 * 从 DOM 元素向上查找 ProseMirror EditorView（内部 API pmViewDesc.view）。
 * 用于 Tauri 桌面端手动插入图文到 TipTap 编辑器。
 */
// 旧版函数签名：从元素向上找 pmViewDesc.view
function getProseMirrorView(el: HTMLElement): any | null {
	// 从 el 开始向上遍历
	let node: Element | null = el;
	// 循环到根
	while (node) {
		// 取 ProseMirror 内部描述符
		const desc = (node as any).pmViewDesc;
		// 有 view 就返回
		if (desc?.view) return desc.view;
		// 向上走
		node = node.parentElement;
	}
	// 未找到返回 null
	return null;
}
```

**改动后** · `apps/frontend/src/utils/clipboard.ts`（当前，约 L245–L265，符号 `getTipTapEditor` + `getProseMirrorView`）

```typescript
// 文档注释：从 DOM 向上取 TipTap Editor / ProseMirror EditorView
/**
 * 从 DOM 向上取 TipTap Editor / ProseMirror EditorView。
 * TipTap：view.dom.editor；原生 PM：pmViewDesc.view。
 */
// 纯新增函数：从元素向上找 TipTap editor 实例
function getTipTapEditor(el: HTMLElement): any | null {
	// 从 el 开始向上遍历
	let node: Element | null = el;
	// 循环到根
	while (node) {
		// 取节点上的 editor（TipTap 挂载在 view.dom.editor）
		const editor = (node as any).editor;
		// 有 commands 且未销毁则视为有效 editor
		if (editor?.commands && !editor.isDestroyed) return editor;
		// 向上走
		node = node.parentElement;
	}
	// 未找到返回 null
	return null;
}

// 改动后函数签名：先取 TipTap editor.view，再回退 pmViewDesc
function getProseMirrorView(el: HTMLElement): any | null {
	// 新增：优先从 TipTap editor 拿 view
	const editor = getTipTapEditor(el);
	// editor 有 view 直接返回（走 TipTap 主路径）
	if (editor?.view) return editor.view;
	// 回退：从 DOM 向上找原生 ProseMirror 的 pmViewDesc
	let node: Element | null = el;
	// 循环到根
	while (node) {
		// 取 ProseMirror 内部描述符
		const desc = (node as any).pmViewDesc;
		// 有 view 就返回
		if (desc?.view) return desc.view;
		// 向上走
		node = node.parentElement;
	}
	// 未找到返回 null
	return null;
}
```

**变更摘要**：新增 `getTipTapEditor` 取 TipTap `editor` 实例（用于 `insertContent` / `chain()`）；`getProseMirrorView` 改为先尝试 `editor.view` 再回退 `pmViewDesc.view`，使有 TipTap 时走更完整的命令链。

### 4.15 `clipboard.ts` `insertHtmlViaEditor`（纯新增）

**对比范围**：新增 `insertHtmlViaEditor` 全函数。纯新增。

**改动后** · `apps/frontend/src/utils/clipboard.ts`（当前，约 L271–L299，符号 `insertHtmlViaEditor`）

```typescript
// 文档注释：有 HTML 时优先用 schema 缓存的 DOMParser.parseSlice，否则 insertContent
/**
 * 有 HTML 时优先用 schema 缓存的 DOMParser.parseSlice（贴近 web 原生粘贴），
 * 否则 TipTap insertContent；保留 <a> / 段落。成功返回处理后的 HTML，失败 null。
 */
// 函数签名：editor + html → 处理后的 HTML 或 null
function insertHtmlViaEditor(editor: any, html: string): string | null {
	// 先用 preprocessClipboardHtml 清洗 HTML
	const processed = preprocessClipboardHtml(html);
	// 清洗后为空则返回 null
	if (!processed.trim()) return null;
	// 取 editor 的 ProseMirror view
	const view = editor.view;
	// 取 schema 缓存的 domParser（TipTap/PM 内部用于解析 DOM 到 Slice）
	const parser = view?.state?.schema?.cached?.domParser;
	// 有 parseSlice 方法时优先走它（最贴近 web 原生 paste）
	if (parser?.parseSlice) {
		// try-catch：parseSlice 失败则 fall through 到 insertContent
		try {
			// 创建承载容器
			const holder = document.createElement('div');
			// 注入清洗后的 HTML
			holder.innerHTML = processed;
			// 解析为 Slice，保留空白、带 selection 上下文
			const slice = parser.parseSlice(holder, {
				// 保留空白字符
				preserveWhitespace: true,
				// 以当前选区 $from 为上下文，避免上下文不匹配
				context: view.state.selection.$from,
			});
			// slice 有内容才插入
			if (slice?.content?.size) {
				// 替换当前选区为 slice 并滚动到视图
				view.dispatch(view.state.tr.replaceSelection(slice).scrollIntoView());
				// 聚焦编辑器
				view.focus();
				// 返回处理后的 HTML 表示成功
				return processed;
			}
		} catch {
			// 注释：fall through
			// fall through 到下方 insertContent
		}
	}
	// 回退：用 TipTap chain insertContent 插入 HTML
	try {
		// focus + insertContent，run() 返回是否成功
		const ok = !!editor.chain().focus().insertContent(processed).run();
		// 成功返回处理后的 HTML，否则 null
		return ok ? processed : null;
	} catch {
		// 异常返回 null
		return null;
	}
}
```

**变更摘要**：纯新增。HTML 整段插入的核心：优先 `domParser.parseSlice`（贴近 web 原生粘贴，保留链接/段落），失败回退 `editor.chain().insertContent`。

### 4.16 `clipboard.ts` `moveSelectionAfter` 与 `insertClipSegments`（纯新增）

**对比范围**：新增 `moveSelectionAfter` 与 `insertClipSegments` 两个函数。纯新增。

**改动后** · `apps/frontend/src/utils/clipboard.ts`（当前，约 L304–L328，符号 `moveSelectionAfter` + `insertClipSegments`）

```typescript
// 文档注释：块级图片插入后若停在 NodeSelection，下一段会盖掉上一张
/**
 * 块级图片插入后若仍停在 NodeSelection，下一段会盖掉上一张；near 把光标挪到节点后。
 */
// 函数签名：入参 transaction，返回调整选区后的 transaction
function moveSelectionAfter(tr: any): any {
	// 取当前选区
	const sel = tr.selection;
	// 取选区构造器（Selection 类），用于调用静态 near
	const Sel = sel?.constructor;
	// near 不可用（非标准 Selection）则原样返回
	if (typeof Sel?.near !== 'function') return tr;
	// 用 near 在 sel.to 之后正向找一个有效位置
	const next = Sel.near(tr.doc.resolve(sel.to), 1);
	// 找到则设置新选区，否则原样返回
	return next ? tr.setSelection(next) : tr;
}

// 文档注释：无 HTML / insertContent 失败时的回退——纯文本 + 图片片段
/** 无 HTML / insertContent 失败时的回退：纯文本 + 图片片段 */
// 函数签名：view + segments → 逐段插入
function insertClipSegments(view: any, segments: ClipSegment[]): void {
	// 取 image 节点类型（schema 中可能未注册）
	const imageType = view.state.schema.nodes.image;
	// 遍历每个片段
	for (const seg of segments) {
		// 文本片段分支
		if (seg.type === 'text') {
			// 空串跳过
			if (!seg.value) continue;
			// 当前停在节点选区时先把光标挪到节点后，避免文本覆盖图片
			if (view.state.selection.node) {
				// 派发 moveSelectionAfter 调整
				view.dispatch(moveSelectionAfter(view.state.tr));
			}
			// 插入文本
			view.dispatch(view.state.tr.insertText(seg.value));
		} else if (imageType) {
			// 图片片段：创建 image 节点并替换选区，再挪光标
			const node = imageType.create({ src: seg.src });
			// 替换选区为图片节点并移动光标到节点后
			view.dispatch(moveSelectionAfter(view.state.tr.replaceSelectionWith(node)));
		}
	}
	// 全部插入后聚焦
	view.focus();
}
```

**变更摘要**：纯新增。`moveSelectionAfter` 解决 block image 连插覆盖；`insertClipSegments` 把旧版内联在主流程的「逐段 dispatch」逻辑抽成可复用函数，文本与图片插入均带光标推进。

### 4.17 `clipboard.ts` 粘贴主流程 `key === 'v'` 分支（改动前 / 改动后）

**对比范围**：`attachTauriPlainFieldClipboardShortcuts` 内 `if (tipTapBody ...) { ... if (key === 'v') { ... } }` 中 `key === 'v'` 的处理块。核心改动：从「串行 HTML → 回退 readText+readImage」改为「`Promise.all` 并行读 4 flavor + 四级降级」。

**改动前** · `apps/frontend/src/utils/clipboard.ts`（基线，约 L424–L480，符号 `attachTauriPlainFieldClipboardShortcuts` 内 `key === 'v'` 块）

```typescript
		// 进入 v 键分支
		if (key === 'v') {
			// 注释：旧版策略——优先 HTML，回退 readText+readImage
			// Tauri WebView 原生 paste 不触发到 ProseMirror：
			// 优先读剪贴板 HTML（含 <img src>，覆盖网页复制图文混合），
			// 回退 readText + readImage（覆盖纯文本 / 截图独立位图）。
			// 按 HTML 原始 DOM 顺序插入片段，保证图文相对顺序与复制时一致。
			// 阻止默认粘贴
			event.preventDefault();
			// 取 TipTap 正文根
			const root = tipTapBody;
			// 异步立即执行
			void (async () => {
				// 根未挂载直接返回
				if (!root.isConnected) return;
				// 注释：1) 优先尝试 HTML
				// 1) 优先尝试 HTML：按顺序解析为文本/图片片段
				// 串行读 HTML
				const html = await readClipHtml();
				// 片段数组
				let segments: ClipSegment[] = [];
				// 位图 data URL 占位
				let imageDataUrl: string | null = null;
				// 有 HTML 走解析
				if (html) {
					// 解析 HTML 为片段
					segments = parseHtmlSegments(html);
				} else {
					// 注释：2) 无 HTML 回退 readText + readImage
					// 2) 无 HTML 时回退：readText 拿纯文本，readImage 拿截图位图
					// 串行 await Promise.all 只在读文本与位图两路
					const [t, img] = await Promise.all([
						// 读纯文本
						readClipText(),
						// 读位图
						readClipImageAsDataUrl(),
					]);
					// 有文本推入文本片段
					if (t) segments.push({ type: 'text', value: t });
					// 位图赋值
					imageDataUrl = img;
				}
				// 有位图追加图片片段
				if (imageDataUrl) {
					// 推入图片片段
					segments.push({ type: 'image', src: imageDataUrl });
				}
				// 无内容直接返回
				if (segments.length === 0) return;
				// 聚焦根
				root.focus();
				// 取 ProseMirror view
				const view = getProseMirrorView(root);
				// 有 view 走 PM dispatch
				if (view) {
					// 取 image 节点类型
					const imageType = view.state.schema.nodes.image;
					// 遍历片段逐个插入
					for (const seg of segments) {
						// 文本分支
						if (seg.type === 'text') {
							// 非空才插入
							if (seg.value)
								// 插入文本
								view.dispatch(view.state.tr.insertText(seg.value));
						} else if (imageType) {
							// 图片分支：创建节点并替换选区（旧版无光标推进，连插图片会覆盖）
							const node = imageType.create({ src: seg.src });
							// dispatch 替换
							view.dispatch(view.state.tr.replaceSelectionWith(node));
						}
					}
					// 聚焦 view
					view.focus();
				} else {
					// 无 view 用 execCommand 兜底
					for (const seg of segments) {
						// 文本分支
						if (seg.type === 'text') {
							// 非空才插入
							if (seg.value)
								// 插入文本
								document.execCommand('insertText', false, seg.value);
						} else {
							// 图片分支：insertHTML（旧版未转义 src 中的双引号）
							document.execCommand(
								// 插入 HTML
								'insertHTML',
								// false 表示不追加
								false,
								// 旧版直接拼 src，XSS/转义风险
								`<img src="${seg.src}" alt="" />`,
							);
						}
					}
				}
			})();
		}
```

**改动后** · `apps/frontend/src/utils/clipboard.ts`（当前，约 L550–L640，符号 `attachTauriPlainFieldClipboardShortcuts` 内 `key === 'v'` 块）

```typescript
		// 进入 v 键分支
		if (key === 'v') {
			// 注释：新版策略——并行读 4 flavor，HTML 优先整段插入，再补图，回退片段
			// Tauri WebView 原生 paste 往往到不了 ProseMirror：
			// 有 HTML → 预处理后 insertContent（对齐 web：保留链接/段落）
			// 无 HTML → 纯文本 + 文件列表/位图图片
			// 阻止默认粘贴
			event.preventDefault();
			// 取 TipTap 正文根
			const root = tipTapBody;
			// 异步立即执行
			void (async () => {
				// 根未挂载直接返回
				if (!root.isConnected) return;
				// 新版：Promise.all 并行读 4 种 flavor，单点失败不阻断
				const [html, imageDataUrl, imageFiles, text] = await Promise.all([
					// HTML flavor
					readClipHtml(),
					// 位图（截图）
					readClipImageAsDataUrl(),
					// 文件列表多图
					readClipImageFiles(),
					// 纯文本
					readClipText(),
				]);

				// 空行：先聚焦并取 editor/view
				// 聚焦根
				root.focus();
				// 取 TipTap editor（用于整段 HTML 插入）
				const editor = getTipTapEditor(root);
				// editor.view 优先，否则回退 pmViewDesc
				const view = editor?.view ?? getProseMirrorView(root);

				// 注释：第一级——有 HTML 且有 editor 时整段插入
				// 优先：整段 HTML 一次插入（链接、换行与 web 一致）
				// 有 HTML 且拿到 editor
				if (html && editor) {
					// 调 insertHtmlViaEditor（parseSlice 优先，insertContent 回退）
					const inserted = insertHtmlViaEditor(editor, html);
					// 插入成功（返回处理后的 HTML）
					if (inserted != null) {
						// 统计 HTML 中 <img> 数量
						const htmlImageCount = (inserted.match(/<img\b/gi) ?? [])
							.length;
						// 文件列表 + 位图合并为额外图片
						const extraImages: string[] = [
							// 文件列表多图在前
							...imageFiles,
							// 位图在后（若有）
							...(imageDataUrl ? [imageDataUrl] : []),
						];
						// 是否需要补图：HTML 无图，或多图场景下 HTML 图数少于实际
						const needExtra =
							htmlImageCount === 0 ||
							(htmlImageCount < extraImages.length &&
								extraImages.length > 1);
						// 需要补图且有图且拿到 view
						if (needExtra && extraImages.length > 0 && view) {
							// 用 insertClipSegments 逐张补插
							insertClipSegments(
								// 目标 view
								view,
								// 把 extraImages 映射为图片片段
								extraImages.map((src) => ({
									// 类型 image
									type: 'image' as const,
									// data URL
									src,
								})),
							);
						}
						// HTML 整段插入流程结束
						return;
					}
				}

				// 空行：进入回退分支
				// 回退：文本/图片片段
				// 片段数组
				let segments: ClipSegment[] = [];
				// 有 HTML 则解析为片段（第二级）
				if (html) segments = parseHtmlSegments(html);

				// 统计已解析片段中的图片数
				const htmlImageCount = segments.filter(
					// 取图片片段
					(s) => s.type === 'image',
				).length;
				// 额外图片：文件列表 + 位图
				const extraImages: string[] = [
					// 文件列表多图
					...imageFiles,
					// 位图（若有）
					...(imageDataUrl ? [imageDataUrl] : []),
				];
				// 是否需要补图（第三级：纯文本 + 文件列表/位图图片）
				const needExtraImages =
					htmlImageCount === 0 ||
					(htmlImageCount < extraImages.length && extraImages.length > 1);

				// 需要补图且有图
				if (needExtraImages && extraImages.length > 0) {
					// 片段为空且有文本：先补一段文本
					if (segments.length === 0 && text) {
						// 推入纯文本片段
						segments.push({ type: 'text', value: text });
					}
					// 逐张图片补入
					for (const src of extraImages) {
						// 推入图片片段
						segments.push({ type: 'image', src });
					}
				}
				// 仍无片段但有文本：兜底纯文本（第四级）
				if (segments.length === 0 && text) {
					// 推入纯文本片段
					segments.push({ type: 'text', value: text });
				}
				// 真的没内容则返回
				if (segments.length === 0) return;

				// 有 view 走 insertClipSegments（带光标推进）
				if (view) {
					// 复用片段插入函数
					insertClipSegments(view, segments);
				} else {
					// 无 view 用 execCommand 兜底
					for (const seg of segments) {
						// 文本分支
						if (seg.type === 'text') {
							// 非空才插入
							if (seg.value)
								// 插入文本
								document.execCommand('insertText', false, seg.value);
						} else {
							// 图片分支：insertHTML（新版转义 src 中的双引号，避免属性截断）
							document.execCommand(
								// 插入 HTML
								'insertHTML',
								// 不追加
								false,
								// 新版：把 src 中的 " 转义为 &quot;
								`<img src="${seg.src.replace(/"/g, '&quot;')}" alt="" />`,
							);
						}
					}
				}
			})();
		}
```

**变更摘要**：① 读剪贴板由串行改为 `Promise.all` 并行 4 flavor；② 新增「HTML 整段插入 + 补图」第一级路径（`insertHtmlViaEditor`）；③ 多图补齐策略基于 `htmlImageCount` 与 `extraImages.length` 比较；④ 片段插入改用 `insertClipSegments`（带 `moveSelectionAfter` 光标推进）；⑤ `execCommand` 兜底分支对 src 双引号做转义。

## 5. 兼容性与影响

- **行为兼容**：网页图文混合粘贴、纯文本粘贴、截图单图粘贴路径保留；新增多图粘贴与「HTML 整段插入对齐 web」能力，旧场景不回归。
- **Tauri 命令新增**：`read_clipboard_image_base64`、`read_clipboard_image_files_base64` 需在 `lib.rs` 注册（已完成）；前端 `invoke` 调用，命令不存在时前端 try-catch 兜底返回 `null` / `[]`，不会崩。
- **依赖体积**：新增 `base64`、`png` 两个纯 Rust crate，无系统库依赖，跨平台编译无额外配置。
- **权限**：`arboard` 读位图与文件列表复用既有系统剪贴板权限，无需新增 Tauri capability。`std::fs::read` 读剪贴板文件列表中的本地路径，文件由用户主动复制进剪贴板，属用户显式操作范围。
- **潜在风险**：
  - 文件列表中若包含大体积图片，base64 编码会放大 ~33% 体积经 IPC 传输，超大图片可能拖慢粘贴；后续可在 Rust 侧加尺寸阈值跳过。
  - `parseSlice` 走 ProseMirror 内部 `cached.domParser`，依赖 TipTap/PM 版本内部结构稳定；若未来升级导致 `parseSlice` 不可用，会 `catch` 后回退 `insertContent`，不会报错。
  - HTML 整段插入后补图的「多图」判定用 `htmlImageCount < extraImages.length && extraImages.length > 1`，单图场景（`extraImages.length === 1`）不补图，避免重复；这与「HTML 已含一张图 + 剪贴板还有一张位图」的边缘场景可能少补，属可接受取舍。
- **回归建议**：测试 ① 截图粘贴单图；② Finder 选中 2+ 张图片复制后粘贴；③ 网页复制含 `<img>` 与文字混合；④ 纯文本粘贴；⑤ 复制带懒加载 `data-src` 的图片；⑥ 标题原生 input 内 Cmd+V（走 plain field 分支，不受影响）。

## 6. 相关源码路径

| 说明 | 路径 |
| ---- | ---- |
| Tauri Rust 依赖清单（新增 base64、png） | `apps/frontend/src-tauri/Cargo.toml` |
| 依赖锁文件（机械更新） | `apps/frontend/src-tauri/Cargo.lock` |
| Rust 剪贴板命令（新增位图、文件列表命令与辅助函数） | `apps/frontend/src-tauri/src/command/clipboard.rs` |
| Tauri 入口（注册新命令） | `apps/frontend/src-tauri/src/lib.rs` |
| 前端剪贴板工具（并行读 4 flavor + 四级降级） | `apps/frontend/src/utils/clipboard.ts` |

---

若与仓库最新源码不一致，以源码为准。
