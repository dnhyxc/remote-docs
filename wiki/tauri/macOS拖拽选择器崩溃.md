# macOS 拖拽文件与选文件对话框冲突闪退修复

> **文档角色**：修复 macOS 下「打开系统文件选择对话框时，拖入文件导致应用 SIGABRT 闪退」的三层修复方案
> **延伸阅读**：[统一文件选择.md](../app/统一文件选择.md)（通用 `select_files` 命令）；[选择文件对象.md](../app/选择文件对象.md)（跨端 `pickFileObject`）

## 1. 背景与目标

**复现路径**（需求 `demand.md` 已标记 ✅）：
1. 用户点击「拖拽上传」区域 → 弹出系统文件选择对话框（rfd `FileDialog`）
2. 在对话框中选中文件，不点「打开」，直接把文件拖入应用窗口
3. 应用立即闪退（SIGABRT）

**根因**（两层）：
1. **Rust 层 — 同步 `FileDialog` 泵 AppKit runloop**：`rfd::FileDialog::pick_file()` 是同步阻塞调用，在 macOS 会泵 AppKit runloop。对话框未关闭时再往窗口拖文件，runloop 重入导致不可预期的崩溃。
2. **wry 层 — `collect_paths` unwrap nil pasteboard**：wry 0.53.5 的 macOS 拖拽实现中，`collect_paths` 对 pasteboard 调用 `NSFilenamesPboardType`，当拖拽源仅发布现代 `public.file-url`（如从系统打开面板拖出）时返回 nil，`.unwrap()` 触发 panic → 主线程 SIGABRT。

**目标**：三层修复，彻底消除该闪退：
1. **Rust**：`rfd::FileDialog` → `rfd::AsyncFileDialog`（不阻塞 runloop）
2. **wry**：vendor 补丁修复 `collect_paths` nil unwrap（tauri-apps/wry#1723）
3. **前端**：`DragDropFileUpload` 新增 `pickerOpenRef`，对话框打开期间忽略所有拖入事件

## 2. 改动范围

| 路径 | 变更类型 | 说明 |
|------|----------|------|
| `apps/frontend/src-tauri/src/command/common.rs` | 修改 | `rfd::FileDialog` → `rfd::AsyncFileDialog`；`select_files` / `select_file` / `select_directory` 全部改为 async |
| `apps/frontend/src-tauri/Cargo.toml` | 修改 | 新增 `[patch.crates-io] wry = { path = "vendor/wry" }` |
| `apps/frontend/src-tauri/Cargo.lock` | 修改 | 锁定 vendored wry 版本 |
| `apps/frontend/src-tauri/vendor/wry/` | **新增** | wry 0.53.5 补丁副本（含 tauri-apps/wry#1723 修复） |
| `apps/frontend/src-tauri/vendor/README.md` | **新增** | vendor 说明：原因、补丁来源、移除条件 |
| `apps/frontend/src/components/design/DragDropFileUpload/index.tsx` | 修改 | 新增 `pickerOpenRef`；拖入/放下/选文件回调增加 `pickerOpenRef` 守卫 |
| `apps/frontend/specs/demand.md` | 修改 | 两项需求标记 ✅ |

## 3. 实现思路

| # | 要点 | 说明 |
|---|------|------|
| 1 | AsyncFileDialog | `rfd::AsyncFileDialog` 的 `.pick_file().await` 不阻塞 runloop，避免 AppKit runloop 重入 |
| 2 | 路径提取 | `AsyncFileDialog` 返回 `FileHandle`（而非 `PathBuf`），需 `.path()` 取路径再 `.to_string_lossy()` |
| 3 | wry vendor 补丁 | `[patch.crates-io]` 指向本地 `vendor/wry`，覆盖 crates.io 的 wry 0.53.5 |
| 4 | 补丁内容 | macOS `collect_paths` 改用 `readObjectsForClasses:options:` + 不对 legacy fallback unwrap nil |
| 5 | pickerOpenRef | 前端 ref 标记「对话框打开中」；`onDragEnter` / `onDragLeave` / `onDragOver` / `onDrop` / `openFilePicker` 均检查此 ref |
| 6 | onDrop 特殊处理 | `onDrop` 先 `preventDefault` + 清理 drag 状态，再检查 `pickerOpenRef`——防止对话框关闭时残留 drag 状态 |
| 7 | openFilePicker 守卫 | 调用 `pick()` 前设 `pickerOpenRef = true` + 清 drag 状态；`.finally()` 复位 |

## 4. 关键代码对比与注释

### 4.1 `select_files` — 同步 → 异步

**对比范围**：`select_files` 函数全定义（含 doc comment）

**改动前** · `apps/frontend/src-tauri/src/command/common.rs`（基线 `7db04417`，约 L53–L94）

```rust
// 旧版 doc comment：无 AsyncFileDialog 说明
/// 通用选文件：支持 accept 过滤与单/多选；取消返回 `canceled`
// 旧版：同步函数签名
#[tauri::command]
pub fn select_files(input: Option<SelectFilesInput>) -> Result<Vec<String>, String> {
    // 解包入参
    let input = input.unwrap_or_default();
    // 多选标志
    let multiple = input.multiple.unwrap_or(false);
    // 旧版：同步 FileDialog
    let mut dialog = FileDialog::new();

    // 设置标题
    if let Some(title) = input
        .title
        .as_deref()
        .map(str::trim)
        .filter(|t| !t.is_empty())
    {
        dialog = dialog.set_title(title);
    }

    // 解析 accept
    let exts = input
        .accept
        .as_deref()
        .map(parse_accept_extensions)
        .unwrap_or_default();
    // 有扩展名 → 添加过滤器
    if !exts.is_empty() {
        let refs: Vec<&str> = exts.iter().map(String::as_str).collect();
        dialog = dialog.add_filter("Files", &refs);
    }

    // 多选分支
    if multiple {
        // 旧版：同步 pick_files 返回 Option<Vec<PathBuf>>
        match dialog.pick_files() {
            // 有选中 → 转字符串数组
            Some(paths) if !paths.is_empty() => Ok(paths
                .into_iter()
                // 旧版：PathBuf 直接 to_string_lossy
                .map(|p| p.to_string_lossy().into_owned())
                .collect()),
            // 取消
            _ => Err("canceled".to_string()),
        }
    } else {
        // 单选分支
        // 旧版：同步 pick_file 返回 Option<PathBuf>
        match dialog.pick_file() {
            // 旧版：PathBuf 直接 to_string_lossy
            Some(path) => Ok(vec![path.to_string_lossy().into_owned()]),
            None => Err("canceled".to_string()),
        }
    }
}
```

**改动后** · `apps/frontend/src-tauri/src/command/common.rs`（当前，约 L53–L95）

```rust
// 新版 doc comment：说明为何必须用 AsyncFileDialog
/// 通用选文件：支持 accept 过滤与单/多选；取消返回 `canceled`。
/// 必须用 AsyncFileDialog：同步 FileDialog 在 macOS 会泵 AppKit runloop，
/// 对话框未关时再往窗口拖文件易 SIGABRT 闪退。
// 新版：async 函数签名
#[tauri::command]
pub async fn select_files(input: Option<SelectFilesInput>) -> Result<Vec<String>, String> {
    // 解包入参
    let input = input.unwrap_or_default();
    // 多选标志
    let multiple = input.multiple.unwrap_or(false);
    // 新版：AsyncFileDialog（不阻塞 runloop）
    let mut dialog = AsyncFileDialog::new();

    // 设置标题
    if let Some(title) = input
        .title
        .as_deref()
        .map(str::trim)
        .filter(|t| !t.is_empty())
    {
        dialog = dialog.set_title(title);
    }

    // 解析 accept
    let exts = input
        .accept
        .as_deref()
        .map(parse_accept_extensions)
        .unwrap_or_default();
    // 有扩展名 → 添加过滤器
    if !exts.is_empty() {
        let refs: Vec<&str> = exts.iter().map(String::as_str).collect();
        dialog = dialog.add_filter("Files", &refs);
    }

    // 多选分支
    if multiple {
        // 新版：async pick_files().await 返回 Option<Vec<FileHandle>>
        match dialog.pick_files().await {
            // 有选中 → 转字符串数组
            Some(paths) if !paths.is_empty() => Ok(paths
                .into_iter()
                // 新版：FileHandle 需 .path() 取 &Path 再 to_string_lossy
                .map(|p| p.path().to_string_lossy().into_owned())
                .collect()),
            // 取消
            _ => Err("canceled".to_string()),
        }
    } else {
        // 单选分支
        // 新版：async pick_file().await 返回 Option<FileHandle>
        match dialog.pick_file().await {
            // 新版：FileHandle 需 .path() 取 &Path 再 to_string_lossy
            Some(path) => Ok(vec![path.path().to_string_lossy().into_owned()]),
            None => Err("canceled".to_string()),
        }
    }
}
```

**变更摘要**：`FileDialog` → `AsyncFileDialog`；函数签名加 `async`；`pick_files()` / `pick_file()` 加 `.await`；返回值从 `PathBuf` 改为 `FileHandle`，需 `.path()` 取路径。doc comment 说明为何必须用 async。

---

### 4.2 `select_file` / `select_directory` — 同步 → 异步

**对比范围**：`select_file` + `select_directory` 两个函数

**改动前** · `apps/frontend/src-tauri/src/command/common.rs`（基线 `7db04417`，约 L97–L115）

```rust
// 旧版 select_file
#[tauri::command]
pub async fn select_file() -> Result<String, String> {
    // 旧版：同步 FileDialog
    let dialog = FileDialog::new()
        .add_filter("所有文件", &["*"])
        .add_filter("文本文件", &["txt", "md", "json"])
        .add_filter("图片文件", &["png", "jpg", "jpeg", "gif", "bmp"]);

    // 旧版：同步 pick_file 返回 Option<PathBuf>
    match dialog.pick_file() {
        // 旧版：PathBuf 直接 to_string_lossy
        Some(path) => Ok(path.to_string_lossy().to_string()),
        None => Err("未选择文件".to_string()),
    }
}

// 旧版 select_directory
#[tauri::command]
pub async fn select_directory() -> Result<String, String> {
    // 旧版：同步 FileDialog pick_folder
    match FileDialog::new().pick_folder() {
        // 旧版：PathBuf 直接 to_string_lossy
        Some(path) => Ok(path.to_string_lossy().to_string()),
        None => Err("未选择目录".to_string()),
    }
}
```

**改动后** · `apps/frontend/src-tauri/src/command/common.rs`（当前，约 L97–L115）

```rust
// 新版 select_file
#[tauri::command]
pub async fn select_file() -> Result<String, String> {
    // 新版：AsyncFileDialog
    let dialog = AsyncFileDialog::new()
        .add_filter("所有文件", &["*"])
        .add_filter("文本文件", &["txt", "md", "json"])
        .add_filter("图片文件", &["png", "jpg", "jpeg", "gif", "bmp"]);

    // 新版：async pick_file().await 返回 Option<FileHandle>
    match dialog.pick_file().await {
        // 新版：FileHandle 需 .path() 再 to_string_lossy
        Some(path) => Ok(path.path().to_string_lossy().into_owned()),
        None => Err("未选择文件".to_string()),
    }
}

// 新版 select_directory
#[tauri::command]
pub async fn select_directory() -> Result<String, String> {
    // 新版：AsyncFileDialog pick_folder().await
    match AsyncFileDialog::new().pick_folder().await {
        // 新版：FileHandle 需 .path() 再 to_string_lossy
        Some(path) => Ok(path.path().to_string_lossy().into_owned()),
        None => Err("未选择目录".to_string()),
    }
}
```

**变更摘要**：两个遗留命令也迁移到 `AsyncFileDialog`。`pick_file()` / `pick_folder()` 加 `.await`，返回值 `.path()` 取路径。注意这两个命令签名原本已有 `async`（Tauri 2 要求），但内部用的是同步 `FileDialog`。

---

### 4.3 `Cargo.toml` — wry vendor 补丁

**对比范围**：`Cargo.toml` 末尾新增 `[patch.crates-io]` 段

**改动前** · `apps/frontend/src-tauri/Cargo.toml`（基线 `7db04417`，约 L66–L68）

```toml
# 旧版：无 patch 段
tauri-plugin-updater = "2"
# 文件结束
```

**改动后** · `apps/frontend/src-tauri/Cargo.toml`（当前，约 L66–L73）

```toml
# 旧版最后一行
tauri-plugin-updater = "2"

# 新增：macOS wry 崩溃补丁
# macOS: wry 0.53.5 panics on some file drags (nil NSFilenamesPboardType). See vendor/README.md.
# 上游修复合并后删除此 patch
[patch.crates-io]
# 指向本地 vendor 目录
wry = { path = "vendor/wry" }
```

**变更摘要**：新增 `[patch.crates-io]` 段，将 `wry` 指向本地 `vendor/wry` 目录，覆盖 crates.io 的 wry 0.53.5。上游 tauri-apps/wry#1723 合并后可删除。

---

### 4.4 `vendor/README.md` — vendor 说明（新增）

**对比范围**：整个文件。纯新增。

**当前** · `apps/frontend/src-tauri/vendor/README.md`（约 L1–L16）

```markdown
# Vendored crates

## wry 0.53.5

Patched copy of crates.io `wry@0.53.5`.

**Why:** Upstream macOS `collect_paths` unwraps a nil pasteboard payload when the drag
source only publishes modern `public.file-url` (e.g. dragging a selected file out of
the system open panel into the webview). That panics the main thread and the app
exits. Web is unaffected because it never hits wry.

**Patch:** Same fix as [tauri-apps/wry#1723](https://github.com/tauri-apps/wry/pull/1723)
(modern `readObjectsForClasses:options:` + no unwrap on legacy fallback).

**Remove when:** Tauri locks a wry release that includes #1723 (or equivalent).
Then delete `vendor/wry` and the `[patch.crates-io]` entry in `Cargo.toml`.
```

**变更摘要**：说明 vendor 原因（wry macOS `collect_paths` unwrap nil pasteboard）、补丁来源（tauri-apps/wry#1723）、移除条件（上游合并后删除）。

---

### 4.5 `DragDropFileUpload` — `pickerOpenRef` 守卫

**对比范围**：`useDragDropFileUpload` hook 中 `pickerOpenRef` 声明 + 5 个回调函数

**改动前** · `apps/frontend/src/components/design/DragDropFileUpload/index.tsx`（基线 `7db04417`，约 L255–L340）

```typescript
// 旧版：无 pickerOpenRef
const zoneRef = useRef<HTMLDivElement | null>(null);
const inputRef = useRef<HTMLInputElement | null>(null);
const dragDepthRef = useRef(0);
// 旧版：无 pickerOpenRef
const optsRef = useRef(options);
optsRef.current = options;

// ...（emit 未改动）

// 旧版 onDragEnter：仅检查 disabled
const onDragEnter = useCallback((e: DragEvent<HTMLDivElement>) => {
	if (optsRef.current.disabled) return;
	e.preventDefault();
	e.stopPropagation();
	dragDepthRef.current += 1;
	if (dragDepthRef.current === 1) setZoneDragActive(zoneRef.current, true);
}, []);

// 旧版 onDragLeave：仅检查 disabled
const onDragLeave = useCallback((e: DragEvent<HTMLDivElement>) => {
	if (optsRef.current.disabled) return;
	e.preventDefault();
	e.stopPropagation();
	dragDepthRef.current -= 1;
	if (dragDepthRef.current <= 0) {
		dragDepthRef.current = 0;
		setZoneDragActive(zoneRef.current, false);
	}
}, []);

// 旧版 onDragOver：仅检查 disabled
const onDragOver = useCallback((e: DragEvent<HTMLDivElement>) => {
	if (optsRef.current.disabled) return;
	e.preventDefault();
	e.stopPropagation();
	try {
		e.dataTransfer.dropEffect = 'copy';
	} catch {
		// ignore
	}
}, []);

// 旧版 onDrop：先检查 disabled，再 preventDefault
const onDrop = useCallback(
	(e: DragEvent<HTMLDivElement>) => {
		// 旧版：disabled 在最前面，未 preventDefault 就 return
		if (optsRef.current.disabled) return;
		e.preventDefault();
		e.stopPropagation();
		dragDepthRef.current = 0;
		setZoneDragActive(zoneRef.current, false);
		const files = e.dataTransfer?.files;
		if (files?.length) emit(files, 'drop');
	},
	[emit],
);

// ...（onInputChange 未改动）

// 旧版 openFilePicker：无 pickerOpenRef 守卫
const openFilePicker = useCallback(() => {
	if (optsRef.current.disabled) return;
	const pick = optsRef.current.pickFiles;
	if (pick) {
		// 旧版：直接调用 pick()，无状态标记
		void pick().then((files) => {
			if (files?.length) emit(files, 'input');
		});
		return;
	}
	inputRef.current?.click();
}, [emit]);
```

**改动后** · `apps/frontend/src/components/design/DragDropFileUpload/index.tsx`（当前，约 L255–L349）

```typescript
// 新版：新增 pickerOpenRef
const zoneRef = useRef<HTMLDivElement | null>(null);
const inputRef = useRef<HTMLInputElement | null>(null);
const dragDepthRef = useRef(0);
// 新增：原生/自定义选文件对话框打开中标记
/** 原生/自定义选文件对话框打开中：忽略拖入，避免与 rfd 事件冲突 */
const pickerOpenRef = useRef(false);
const optsRef = useRef(options);
optsRef.current = options;

// ...（emit 未改动）

// 新版 onDragEnter：增加 pickerOpenRef 守卫
const onDragEnter = useCallback((e: DragEvent<HTMLDivElement>) => {
	// 新增：pickerOpenRef.current 为 true 时忽略
	if (optsRef.current.disabled || pickerOpenRef.current) return;
	e.preventDefault();
	e.stopPropagation();
	dragDepthRef.current += 1;
	if (dragDepthRef.current === 1) setZoneDragActive(zoneRef.current, true);
}, []);

// 新版 onDragLeave：增加 pickerOpenRef 守卫
const onDragLeave = useCallback((e: DragEvent<HTMLDivElement>) => {
	// 新增：pickerOpenRef.current 为 true 时忽略
	if (optsRef.current.disabled || pickerOpenRef.current) return;
	e.preventDefault();
	e.stopPropagation();
	dragDepthRef.current -= 1;
	if (dragDepthRef.current <= 0) {
		dragDepthRef.current = 0;
		setZoneDragActive(zoneRef.current, false);
	}
}, []);

// 新版 onDragOver：增加 pickerOpenRef 守卫
const onDragOver = useCallback((e: DragEvent<HTMLDivElement>) => {
	// 新增：pickerOpenRef.current 为 true 时忽略
	if (optsRef.current.disabled || pickerOpenRef.current) return;
	e.preventDefault();
	e.stopPropagation();
	try {
		e.dataTransfer.dropEffect = 'copy';
	} catch {
		// ignore
	}
}, []);

// 新版 onDrop：先 preventDefault + 清状态，再检查 pickerOpenRef
const onDrop = useCallback(
	(e: DragEvent<HTMLDivElement>) => {
		// 新版：preventDefault 移到最前——即使要忽略也要阻止默认行为
		e.preventDefault();
		e.stopPropagation();
		dragDepthRef.current = 0;
		setZoneDragActive(zoneRef.current, false);
		// 新版：pickerOpenRef 检查移到 preventDefault 之后
		if (optsRef.current.disabled || pickerOpenRef.current) return;
		const files = e.dataTransfer?.files;
		if (files?.length) emit(files, 'drop');
	},
	[emit],
);

// ...（onInputChange 未改动）

// 新版 openFilePicker：增加 pickerOpenRef 守卫 + 状态管理
const openFilePicker = useCallback(() => {
	// 新增：pickerOpenRef 为 true 时不重复打开
	if (optsRef.current.disabled || pickerOpenRef.current) return;
	const pick = optsRef.current.pickFiles;
	if (pick) {
		// 新增：标记对话框已打开
		pickerOpenRef.current = true;
		// 新增：清 drag 状态（防止残留）
		dragDepthRef.current = 0;
		setZoneDragActive(zoneRef.current, false);
		// 新版：pick() 返回后通过 finally 复位
		void pick()
			.then((files) => {
				if (files?.length) emit(files, 'input');
			})
			// 新增：无论成功/失败都复位 pickerOpenRef
			.finally(() => {
				pickerOpenRef.current = false;
			});
		return;
	}
	inputRef.current?.click();
}, [emit]);
```

**变更摘要**：
1. 新增 `pickerOpenRef` ref 标记对话框打开状态
2. `onDragEnter` / `onDragLeave` / `onDragOver` / `openFilePicker` 增加 `|| pickerOpenRef.current` 守卫
3. `onDrop` 调整顺序：先 `preventDefault` + 清 drag 状态，再检查 `pickerOpenRef`（防止对话框关闭时浏览器默认行为残留）
4. `openFilePicker` 调用 `pick()` 前设 `pickerOpenRef = true` + 清 drag 状态；`.finally()` 复位

## 5. 三层修复关系

```
用户操作                    前端 (React)                 Rust (Tauri)               wry (vendored)
─────────────────────────────────────────────────────────────────────────────────────────────────────
点击上传区域
                    │ openFilePicker()
                    │   pickerOpenRef = true ──→ 拖入事件被忽略（前端守卫）
                    │   pick() ──────────────→ AsyncFileDialog.pick_file().await
                    │                            （不泵 runloop，不重入）
                    │
                    │  对话框打开期间拖入文件
                    │   onDrop → pickerOpenRef=true → return（前端拦截）
                    │                            │
                    │                            └──→ 即使 wry 收到拖拽事件
                    │                                 collect_paths 不再 unwrap nil（vendored 补丁）
                    │
                    │  对话框关闭
                    │   .finally() → pickerOpenRef = false
                    │   恢复正常拖拽
```

三层修复互为补充：
- **前端 `pickerOpenRef`**：第一道防线，对话框打开期间直接忽略拖入事件
- **Rust `AsyncFileDialog`**：消除 runloop 重入风险（即使前端守卫失效，也不会因 runloop 冲突崩溃）
- **wry vendor 补丁**：根治 pasteboard nil unwrap（即使拖拽事件到达 wry，也不会 panic）

## 6. 兼容性与影响

| 项目 | 说明 |
|------|------|
| `AsyncFileDialog` | API 与 `FileDialog` 基本一致，差异：`pick_file()` 返回 `FileHandle`（需 `.path()`）而非 `PathBuf` |
| `select_files` 签名 | 从 `pub fn` → `pub async fn`；Tauri 2 的 `#[tauri::command]` 已支持 async，前端 invoke 无需改动 |
| wry vendor | `[patch.crates-io]` 影响所有依赖 wry 的 crate（tauri 本身）；`Cargo.lock` 已更新 |
| 移除条件 | 上游 tauri-apps/wry#1723 合并 + Tauri 锁定新版 wry → 删除 `vendor/wry` + `[patch.crates-io]` 段 |
| `pickerOpenRef` | 纯前端 ref，不影响 API；`openFilePicker` 在对话框打开期间重复调用会被忽略 |
| `onDrop` 顺序变更 | 旧版 `disabled` 在 `preventDefault` 前 return（不阻止默认行为）；新版先 `preventDefault` 再检查——更安全 |
| Web 端 | 不受影响（不经过 rfd / wry） |

## 7. 风险与回归清单

| 风险 | 排查 |
|------|------|
| `AsyncFileDialog` 在 Windows/Linux 行为差异 | rfd 的 async 实现在非 macOS 平台用 tokio 线程；检查 `select_files` 在 Windows 下返回路径是否正确 |
| vendored wry 版本漂移 | `Cargo.lock` 已锁定；若 `cargo update` 升级 wry，需确认 vendor 版本匹配 |
| `pickerOpenRef` 未复位 | `openFilePicker` 用 `.finally()` 复位；检查 `pick()` 是否始终 resolve/reject（不会挂起） |
| `onDrop` 顺序变更 | 旧版 disabled 时不 `preventDefault` → 浏览器可能打开文件；新版始终 `preventDefault` → 更安全 |
| 重复打开对话框 | `pickerOpenRef` 为 true 时 `openFilePicker` 直接 return；用户需先关闭当前对话框 |

建议回归：
1. **macOS 崩溃路径**：点击上传 → 对话框打开 → 从对话框拖文件到窗口 → 不闪退
2. **正常选文件**：点击上传 → 选文件 → 确认 → 文件正确上传
3. **取消选文件**：点击上传 → 取消 → `pickerOpenRef` 复位 → 拖拽恢复正常
4. **拖拽上传**：直接拖文件到区域 → 文件正确上传（不经过对话框）
5. **disabled 状态**：`disabled=true` 时点击/拖拽均无效
6. **Windows/Linux**：`select_files` / `select_file` / `select_directory` 在非 macOS 下正常工作

## 8. 相关源码路径

| 说明 | 路径 |
|------|------|
| Rust 文件选择命令 | `apps/frontend/src-tauri/src/command/common.rs` |
| Cargo 依赖配置 | `apps/frontend/src-tauri/Cargo.toml` |
| Cargo 锁定文件 | `apps/frontend/src-tauri/Cargo.lock` |
| wry vendor 补丁 | `apps/frontend/src-tauri/vendor/wry/` |
| vendor 说明 | `apps/frontend/src-tauri/vendor/README.md` |
| 拖拽上传 hook | `apps/frontend/src/components/design/DragDropFileUpload/index.tsx` |
| 需求文档 | `apps/frontend/specs/demand.md` |

---

（若与仓库最新源码不一致，以源码为准）
