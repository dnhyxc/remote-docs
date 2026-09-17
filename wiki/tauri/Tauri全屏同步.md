# Tauri 全屏状态同步：macOS 原生事件 → 前端影院态零延迟

## 1. 背景与目标

在 macOS 桌面端，当用户通过**绿色按钮**（系统手势）退出全屏时，Tauri 只报告 `WindowEvent::Resized` 事件——此时窗口尺寸已经在做缩放动画，前端若等 Resized 再收影院态（隐藏侧栏/顶栏），就会出现「壳先缩窗、侧栏后闪消失」的视觉错位。同理，菜单「全屏窗口」项关闭全屏时也是先缩窗再同步前端。

本文实现一套「**先通知前端收影院，再缩窗**」的双向同步机制：Rust 侧在 macOS 通过 `NSWindowWillExitFullScreenNotification` 捕捉原生退出全屏时机，在缩窗动画开始前发出 `host://will-exit-fullscreen` 事件；前端监听到该事件后立即清空影院态，使缩窗动画自始至终都发生在「影院态已收」的干净状态下。

## 2. 改动范围

| 文件 | 说明 |
| ---- | ---- |
| `apps/frontend/src-tauri/Cargo.toml` | 新增 `block2`、`objc2-foundation` 的 `NSNotification`/`NSOperation` 特性 |
| `apps/frontend/src-tauri/src/system/fullscreen_watch.rs` | **新增**：macOS 原生 `NSWindowWillExitFullScreenNotification` 观察者 |
| `apps/frontend/src-tauri/src/system/mod.rs` | 注册 `fullscreen_watch` 模块 |
| `apps/frontend/src-tauri/src/lib.rs` | `setup()` 中调用 `fullscreen_watch::install()` |
| `apps/frontend/src-tauri/src/system/event.rs` | `Resized` 事件增加 `emit_window_fullscreen`（含 80ms 二次上报兜底）+ `emit_window_fullscreen_state` 公开函数 |
| `apps/frontend/src-tauri/src/system/menu.rs` | 菜单「fullscreen」退出全屏时先发 `host://will-exit-fullscreen` 再缩窗 |
| `apps/frontend/src/federation/capabilities/appFullscreen.ts` | 新增 `TAURI_WILL_EXIT_FULLSCREEN_EVENT`、`TAURI_WINDOW_FULLSCREEN_EVENT`、`ignoreNativeUntil` 防抖、`installAppFullscreenExitSync()`、`getDocFullscreenElement()` |
| `apps/frontend/src/federation/index.ts` | 导出新常量与 `installAppFullscreenExitSync` |
| `apps/frontend/src/layout/index.tsx` | `subscribeAppFullscreen` 改用 `flushSync`；移除原 `fullscreenchange` 监听，改用 `installAppFullscreenExitSync()` |
| `apps/frontend/src/federation/host/PluginPageShell.tsx` | `subscribeAppFullscreen` 改用 `flushSync` |

## 3. 实现思路

1. **原生通知前置**：在 macOS 上注册 `NSWindowWillExitFullScreenNotification` 观察者，窗口将要退出全屏（但尚未缩窗）时发送 `host://will-exit-fullscreen`，让前端先收影院态。
2. **菜单同序**：菜单「全屏窗口」项关闭时，先发 `host://will-exit-fullscreen`，再 `set_fullscreen(false)`，确保与 Esc / 绿钮同序。
3. **Resized 兜底**：`WindowEvent::Resized` 仍保留，但用 `Date.now()` + `ignoreNativeUntil` 做防抖，避免「绿钮进场动画」误触发收影院态（进入全屏时 `ignoreNativeUntil` 设为 1000ms 忽略后续 resize）。
4. **双事件源**：前端同时监听 `host://will-exit-fullscreen`（精准，Tauri 特有）和 `host://window-fullscreen`（兜底），Web 端监听 `document.fullscreenchange`。
5. **flushSync 同步**：`notify()` 内的订阅者用 `flushSync` 包裹，确保壳层（Sidebar/Header）的隐藏在下一帧立即生效，不给缩窗动画留下视觉窗口期。
6. **enter 防抖**：`setAppFullscreen(true)` 时 `ignoreNativeUntil = Date.now() + 1000`，忽略进场动画期间的 `Resized` 事件，防止影院态被进场动画误清。
7. **exit 防抖**：`setAppFullscreen(false)` 时 `ignoreNativeUntil = Date.now() + 200`，给缩窗动画留点余量但不过度。

## 4. 关键代码对比与注释

### 4.1 `fullscreen_watch.rs`（新增，macOS 原生通知观察者）

**来源**：`apps/frontend/src-tauri/src/system/fullscreen_watch.rs`（**改动后**，新增文件，全量 L1–L49）

```rust
// 引入标准库的指针包装与锁机制，用于保存 WebviewWindow 引用
use std::ptr::NonNull;
use std::sync::Mutex;

// block2 提供 RcBlock，用于将 Rust 闭包转为 ObjC block
use block2::RcBlock;
// objc2 运行时的 AnyObject 类型
use objc2::runtime::AnyObject;
// macOS 通知常量：窗口将要退出全屏
use objc2_app_kit::NSWindowWillExitFullScreenNotification;
// Foundation 通知中心与操作队列
use objc2_foundation::{NSNotification, NSNotificationCenter, NSOperationQueue};
// Tauri 的 Emitter trait 与 WebviewWindow 类型
use tauri::{Emitter, WebviewWindow};

// 前端监听的事件名，窗口即将退出全屏时发出
const WILL_EXIT: &str = "host://will-exit-fullscreen";

// 进程级静态 Mutex，持有 WebviewWindow 引用供 block 内闭包访问
// 因为 RcBlock 内闭包要求 'static 且 !Send，无法直接捕获 WebviewWindow
static EMIT_WIN: Mutex<Option<WebviewWindow>> = Mutex::new(None);

// 安装 macOS 原生全屏退出观察者
pub fn install(win: &WebviewWindow) {
    // 把当前窗口引用存入静态 Mutex，供 block 闭包内读取
    if let Ok(mut g) = EMIT_WIN.lock() {
        *g = Some(win.clone());
    }

    // 获取底层 NSWindow 的原生指针
    let ns_ptr = match win.ns_window() {
        // 成功转换为 AnyObject 指针（用于注册观察者）
        Ok(p) => p as *const AnyObject,
        // 非 macOS 或无法获取指针时直接返回
        Err(_) => return,
    };

    // 进入 unsafe 块操作 Objective-C 运行时
    unsafe {
        // 获取默认的通知中心（NSNotificationCenter）
        let center = NSNotificationCenter::defaultCenter();
        // 创建 RcBlock，当通知触发时执行闭包逻辑
        let block = RcBlock::new(|_notif: NonNull<NSNotification>| {
            // 从静态 Mutex 中取出保存的窗口引用
            let w = EMIT_WIN
                .lock()
                .ok()
                .and_then(|g| g.as_ref().cloned());
            // 若窗口仍有效，向 WebView 发出 will-exit 事件
            if let Some(w) = w {
                let _ = w.emit(WILL_EXIT, ());
            }
        });

        // 把裸指针转回引用传给注册方法
        let obj = &*ns_ptr;
        // 注册观察者：监听 NSWindowWillExitFullScreenNotification
        // 绑定对象为当前窗口（仅该窗口的通知）
        // 使用主队列（保证主线程安全）
        // block 为回调
        let observer = center.addObserverForName_object_queue_usingBlock(
            Some(NSWindowWillExitFullScreenNotification),
            Some(obj),
            Some(&*NSOperationQueue::mainQueue()),
            &block,
        );
        // 进程级常驻 observer：forget 避免 RAII 自动释放
        // 否则 observer 会随函数作用域结束而被释放
        std::mem::forget(observer);
    }
}
```

**变更摘要**：新增 `fullscreen_watch.rs`，在 macOS 上通过 ObjC 运行时注册 `NSWindowWillExitFullScreenNotification` 观察者，在用户用绿钮/系统手势退出全屏时（缩窗动画之前）向 WebView 发送 `host://will-exit-fullscreen` 事件。

### 4.2 `mod.rs`（注册新模块）

**来源**：`apps/frontend/src-tauri/src/system/mod.rs`（**改动后**，L1–L9）

```rust
// 保留 dock 模块声明
pub mod dock;
// 保留 event 模块声明
pub mod event;
// macOS 平台专属：注册 fullscreen_watch 模块（原生全屏通知）
#[cfg(target_os = "macos")]
pub mod fullscreen_watch;
// macOS 平台专属：保留 zoom 模块
#[cfg(target_os = "macos")]
pub mod zoom;
// 保留 menu 模块
pub mod menu;
// 保留 shortcut 模块
pub mod shortcut;
// 保留 tray 模块
pub mod tray;
```

**来源**：`apps/frontend/src-tauri/src/system/mod.rs`（**改动前**，L1–L7）

```rust
// 保留 dock 模块声明
pub mod dock;
// 保留 event 模块声明
pub mod event;
// macOS 平台专属：保留 zoom 模块
#[cfg(target_os = "macos")]
pub mod zoom;
// 保留 menu 模块
pub mod menu;
// 保留 shortcut 模块
pub mod shortcut;
// 保留 tray 模块
pub mod tray;
```

**变更摘要**：在 `event` 和 `zoom` 之间新增 `fullscreen_watch` 模块声明，仅在 macOS 编译。

### 4.3 `lib.rs`（启动时安装原生观察者）

**来源**：`apps/frontend/src-tauri/src/lib.rs`（**改动后**，`setup()` 闭包内，L64–L67）

```rust
// macOS 平台专属：安装原生全屏退出观察者（绿钮/系统手势捕获）
#[cfg(target_os = "macos")]
system::fullscreen_watch::install(&main_window);
// macOS 平台专属：保留 zoom 安装
#[cfg(target_os = "macos")]
system::zoom::install(&main_window);
```

**来源**：`apps/frontend/src-tauri/src/lib.rs`（**改动前**，`setup()` 闭包内，约 L64–L65）

```rust
// macOS 平台专属：保留 zoom 安装
#[cfg(target_os = "macos")]
system::zoom::install(&main_window);
```

**变更摘要**：在 `zoom::install` 之前插入 `fullscreen_watch::install`，应用启动时即在 macOS 上注册原生全屏通知观察者。

### 4.4 `event.rs`（Resized 事件 + 全屏状态上报）

**来源**：`apps/frontend/src-tauri/src/system/event.rs`（**改动后**，全量 L1–L60）

```rust
// 获取 store 中保存的值（如 closeType）
use crate::utils::common::get_store_value;
// Tauri 的 Emitter trait（emit 事件）、Runtime 泛型、WindowEvent 枚举
use tauri::{Emitter, Runtime, WindowEvent};

// 全屏状态事件名，携带 bool 参数（true = 全屏中，false = 非全屏）
const WINDOW_FULLSCREEN_EVENT: &str = "host://window-fullscreen";

// 读取窗口 is_fullscreen() 并向 WebView 发送状态
fn emit_window_fullscreen<R: Runtime>(window: &tauri::WebviewWindow<R>) {
    // 读取当前窗口全屏状态，失败则回退为 false
    let fs = window.is_fullscreen().unwrap_or(false);
    // 发射 host://window-fullscreen 事件，携带当前全屏状态
    let _ = window.emit(WINDOW_FULLSCREEN_EVENT, fs);
}

// 设置窗口事件处理器（close request + resized 全屏同步）
pub fn setup_window_events(main_window: tauri::WebviewWindow, app_handle: tauri::AppHandle) {
    // 克隆窗口句柄供闭包使用
    let window = main_window.clone();
    // 克隆 app_handle 供闭包使用
    let app_handle = app_handle.clone();

    // 注册窗口事件监听
    main_window.on_window_event(move |event| match event {
        // 关闭请求：读取 closeType 决定最小化还是退出
        WindowEvent::CloseRequested { api, .. } => {
            // 先阻止默认关闭行为
            api.prevent_close();

            // 克隆 app_handle 供异步任务使用
            let app_handle_clone = app_handle.clone();
            // 克隆窗口供异步任务使用
            let window_clone = window.clone();

            // 异步执行关闭逻辑
            tauri::async_runtime::spawn(async move {
                // 从 store 读取 closeType 设置
                if let Ok(close_type) = get_store_value(&app_handle_clone, "closeType").await {
                    match close_type.as_str() {
                        // "2" = 直接退出应用
                        "2" => {
                            let _ = app_handle_clone.exit(0);
                        }
                        // "1" 或其他 = 最小化到托盘
                        "1" | _ => {
                            let _ = window_clone.hide();
                        }
                    }
                } else {
                    // 读取失败时默认最小化到托盘
                    let _ = window_clone.hide();
                }
            });
        }
        // 窗口尺寸变化：向 WebView 同步全屏状态
        WindowEvent::Resized(_) => {
            // 立即上报一次当前全屏状态
            emit_window_fullscreen(&window);
            // macOS 的 resize 事件早于 is_fullscreen() 状态落定
            // 延迟 80ms 后再上报一次，确保状态准确
            let win = window.clone();
            std::thread::spawn(move || {
                std::thread::sleep(std::time::Duration::from_millis(80));
                emit_window_fullscreen(&win);
            });
        }
        // 忽略其他事件
        _ => {}
    });
}

// 菜单/快捷键切换全屏后主动同步前端
pub fn emit_window_fullscreen_state<R: Runtime>(window: &tauri::WebviewWindow<R>) {
    // 委托给 emit_window_fullscreen 读取并上报当前状态
    emit_window_fullscreen(window);
}
```

**来源**：`apps/frontend/src-tauri/src/system/event.rs`（**改动前**，全量 L1–L38）

```rust
// 获取 store 中保存的值（如 closeType）
use crate::utils::common::get_store_value;
// Tauri 的 WindowEvent 枚举
use tauri::WindowEvent;

// 设置窗口事件处理器（仅处理关闭请求）
pub fn setup_window_events(main_window: tauri::WebviewWindow, app_handle: tauri::AppHandle) {
    // 克隆窗口句柄供闭包使用
    let window = main_window.clone();
    // 克隆 app_handle 供闭包使用
    let app_handle = app_handle.clone();

    // 注册窗口事件监听
    main_window.on_window_event(move |event| match event {
        // 关闭请求：读取 closeType 决定最小化还是退出
        WindowEvent::CloseRequested { api, .. } => {
            // 先阻止默认关闭行为
            api.prevent_close();

            // 克隆 app_handle 供异步任务使用
            let app_handle_clone = app_handle.clone();
            // 克隆窗口供异步任务使用
            let window_clone = window.clone();

            // 异步执行关闭逻辑
            tauri::async_runtime::spawn(async move {
                // 从 store 读取 closeType 设置
                if let Ok(close_type) = get_store_value(&app_handle_clone, "closeType").await {
                    match close_type.as_str() {
                        // "2" = 直接退出应用
                        "2" => {
                            let _ = app_handle_clone.exit(0);
                        }
                        // "1" 或其他 = 最小化到托盘
                        "1" | _ => {
                            let _ = window_clone.hide();
                        }
                    }
                } else {
                    // 读取失败时默认最小化到托盘
                    let _ = window_clone.hide();
                }
            });
        }
        // 忽略其他事件
        _ => {}
    });
}
```

**变更摘要**：新增 `emit_window_fullscreen()` 读取 `is_fullscreen()` 并向 WebView 上报；新增 `Resized` 事件分支（立即 + 80ms 延迟二次上报）；新增 `emit_window_fullscreen_state()` 公开函数供菜单调用。

### 4.5 `menu.rs`（菜单全屏项：先发 will-exit 再缩窗）

**来源**：`apps/frontend/src-tauri/src/system/menu.rs`（**改动后**，`"fullscreen"` 分支，约 L174–L182）

```rust
// 处理「全屏窗口」菜单项点击
"fullscreen" => {
    // 计算下一个全屏状态（取反当前状态）
    let next = !win.is_fullscreen().unwrap_or(false);
    // 若即将退出全屏（next=false），先发 will-exit 事件通知前端
    // 与 Esc / 绿钮同序：先收影院 UI，再缩窗
    if !next {
        let _ = win.emit("host://will-exit-fullscreen", ());
    }
    // 执行窗口全屏切换
    let _ = win.set_fullscreen(next);
    // 同步前端：读取并上报当前全屏状态
    crate::system::event::emit_window_fullscreen_state(&win);
}
```

**来源**：`apps/frontend/src-tauri/src/system/menu.rs`（**改动前**，`"fullscreen"` 分支，约 L175–L177）

```rust
// 处理「全屏窗口」菜单项点击
"fullscreen" => {
    // 计算下一个全屏状态（取反当前状态）
    let next = !win.is_fullscreen().unwrap_or(false);
    // 直接切换窗口全屏状态，未通知前端
    let _ = win.set_fullscreen(next);
}
```

**变更摘要**：关闭全屏时先发 `host://will-exit-fullscreen`，再 `set_fullscreen(false)`，最后 `emit_window_fullscreen_state` 兜底同步。

### 4.6 `appFullscreen.ts`（前端全屏状态机 + 多事件源同步）

**来源**：`apps/frontend/src/federation/capabilities/appFullscreen.ts`（**改动后**，全量 L1–L125）

```typescript
// 文件级 JSDoc：说明 Host 级影院/全屏状态与 Tauri 原生事件的关系
// Esc / 系统退出全屏同序：先 notify(false) 收影院与播放器最大化，再缩窗
// macOS 绿钮走原生 host://will-exit-fullscreen（缩窗动画之前），勿等 Resized

// 引入 Tauri 事件监听工具
import { onListen } from '@/utils/event';
// 引入运行时检测
import { isTauriRuntime } from '@/utils/runtime';

// 应用级全屏事件名（CustomEvent，供组件间通信）
export const APP_FULLSCREEN_EVENT = 'host:app-fullscreen';
// Tauri 窗口全屏态（Rust Resized 兜底事件）
export const TAURI_WINDOW_FULLSCREEN_EVENT = 'host://window-fullscreen';
// macOS willExitFullScreen / 菜单关全屏：缩窗前一刻发送
export const TAURI_WILL_EXIT_FULLSCREEN_EVENT = 'host://will-exit-fullscreen';

// 订阅回调类型（参数为是否全屏）
type Listener = (full: boolean) => void;

// 内部全屏状态（单例）
let full = false;
// 订阅者集合
const listeners = new Set<Listener>();

// 防抖时间戳：本地切入全屏时忽略原生 resize，避免进场动画误清
let ignoreNativeUntil = 0;

// 读取当前全屏状态
export function getAppFullscreen(): boolean {
    return full;
}

// 订阅全屏状态变化，返回取消订阅函数
export function subscribeAppFullscreen(fn: Listener): () => void {
    listeners.add(fn);
    return () => {
        listeners.delete(fn);
    };
}

// 内部通知：更新状态 → 调用订阅者 → 分发 CustomEvent
function notify(next: boolean) {
    // 更新状态
    full = next;
    // 先壳层（Sidebar/Header flushSync），再插件（订阅者按注册顺序调用）
    for (const fn of listeners) fn(next);
    // 向 document 分发 CustomEvent
    window.dispatchEvent(
        new CustomEvent(APP_FULLSCREEN_EVENT, { detail: { full: next } }),
    );
}

// 获取当前 document 全屏元素（含 webkit 前缀兼容）
function getDocFullscreenElement(): Element | null {
    // 扩展 document 类型以支持 webkitFullscreenElement
    const doc = document as Document & {
        webkitFullscreenElement?: Element | null;
    };
    // 优先用标准 fullscreenElement，回退到 webkit 前缀
    return document.fullscreenElement ?? doc.webkitFullscreenElement ?? null;
}

// Host / bridge 入口：改布局态 + 系统窗口全屏
export async function setAppFullscreen(next: boolean): Promise<void> {
    // 与 Esc 同序：先收影院 UI（notify），再动系统全屏
    if (full !== next) notify(next);
    // 进入全屏时设 1000ms 忽略窗口 resize（进场动画期间）
    // 退出全屏时设 200ms 忽略（缩窗动画期间）
    ignoreNativeUntil = Date.now() + (next ? 1000 : 200);

    // Tauri 运行时：调用 Tauri 窗口 API
    if (isTauriRuntime()) {
        try {
            // 动态导入 Tauri 窗口 API
            const { getCurrentWindow } = await import('@tauri-apps/api/window');
            await getCurrentWindow().setFullscreen(next);
        } catch (err) {
            // 设置全屏失败时仅打印警告，不阻塞 UI
            console.warn('[host] setFullscreen failed', err);
        }
        return;
    }

    // 浏览器运行时：使用 document.fullscreen API
    try {
        if (next) {
            // 进入全屏：当前未全屏时才请求
            if (!getDocFullscreenElement()) {
                await document.documentElement.requestFullscreen();
            }
        } else if (getDocFullscreenElement()) {
            // 退出全屏：当前已全屏时才退出
            await document.exitFullscreen();
        }
    } catch {
        // 布局态已切换即可，忽略全屏 API 失败
    }
}

// 系统退出全屏同步（Layout 挂载一次）
// will-exit：缩窗前先清影院（等同 Esc）；Resized / document 仅作兜底
export function installAppFullscreenExitSync(): () => void {
    // 收集所有清理函数
    const cleanups: Array<() => void> = [];

    // Web 端 document fullscreenchange 监听
    const onDocFs = () => {
        // 忽略本地全屏操作期间的事件（防抖）
        if (Date.now() < ignoreNativeUntil) return;
        // 仍处全屏则忽略（不是退出）
        if (getDocFullscreenElement()) return;
        // 若已非全屏态则忽略
        if (!full) return;
        // Tauri 运行时不走此路径（由 Rust 事件处理）
        if (isTauriRuntime()) return;
        // 触发退出影院态
        void setAppFullscreen(false);
    };
    // 标准 fullscreenchange 事件
    document.addEventListener('fullscreenchange', onDocFs);
    cleanups.push(() => {
        document.removeEventListener('fullscreenchange', onDocFs);
    });
    // webkit 前缀事件（Safari 旧版兼容）
    document.addEventListener('webkitfullscreenchange', onDocFs);
    cleanups.push(() => {
        document.removeEventListener('webkitfullscreenchange', onDocFs);
    });

    // Tauri 运行时：监听原生事件
    if (isTauriRuntime()) {
        // macOS 绿钮/菜单：will-exit 事件（精准时机）
        const willExitP = onListen(TAURI_WILL_EXIT_FULLSCREEN_EVENT, () => {
            // 已非全屏态则忽略
            if (!full) return;
            // 缩窗动画前立刻收影院，不被 ignore 挡住
            void setAppFullscreen(false);
        });
        cleanups.push(() => {
            void willExitP.then((un) => un());
        });

        // Resized 兜底事件（80ms 延迟后的状态上报）
        const resizedP = onListen<boolean>(TAURI_WINDOW_FULLSCREEN_EVENT, () => {
            // 忽略本地全屏操作期间的事件
            if (Date.now() < ignoreNativeUntil) return;
            // 已非全屏态则忽略
            if (!full) return;
            // 触发退出影院态
            void setAppFullscreen(false);
        });
        cleanups.push(() => {
            void resizedP.then((un) => un());
        });
    }

    // 返回清理函数（按 LIFO 顺序执行所有清理）
    return () => {
        while (cleanups.length) cleanups.pop()?.();
    };
}
```

**来源**：`apps/frontend/src/federation/capabilities/appFullscreen.ts`（**改动前**，全量 L1–L53）

```typescript
// 文件级 JSDoc：说明 Host 级影院/全屏状态
// 插件只调 bridge api.ui.setAppFullscreen；壳层显隐由 Layout 订阅

// 引入运行时检测
import { isTauriRuntime } from '@/utils/runtime';

// 应用级全屏事件名（CustomEvent）
export const APP_FULLSCREEN_EVENT = 'host:app-fullscreen';

// 订阅回调类型
type Listener = (full: boolean) => void;

// 内部全屏状态
let full = false;
// 订阅者集合
const listeners = new Set<Listener>();

// 读取当前全屏状态
export function getAppFullscreen(): boolean {
    return full;
}

// 订阅全屏状态变化
export function subscribeAppFullscreen(fn: Listener): () => void {
    listeners.add(fn);
    return () => {
        listeners.delete(fn);
    };
}

// 内部通知
function notify(next: boolean) {
    full = next;
    for (const fn of listeners) fn(next);
    window.dispatchEvent(
        new CustomEvent(APP_FULLSCREEN_EVENT, { detail: { full: next } }),
    );
}

// Host / bridge 入口
export async function setAppFullscreen(next: boolean): Promise<void> {
    if (full !== next) notify(next);

    if (isTauriRuntime()) {
        try {
            const { getCurrentWindow } = await import('@tauri-apps/api/window');
            await getCurrentWindow().setFullscreen(next);
        } catch (err) {
            console.warn('[host] setFullscreen failed', err);
        }
        return;
    }

    try {
        if (next) {
            if (!document.fullscreenElement) {
                await document.documentElement.requestFullscreen();
            }
        } else if (document.fullscreenElement) {
            await document.exitFullscreen();
        }
    } catch {
        /* 布局态已切换即可 */
    }
}
```

**变更摘要**：新增 `TAURI_WILL_EXIT_FULLSCREEN_EVENT` / `TAURI_WINDOW_FULLSCREEN_EVENT` 常量；新增 `ignoreNativeUntil` 防抖时间戳；`notify()` 调整为「先壳层再插件」；`getDocFullscreenElement()` 兼容 webkit 前缀；`setAppFullscreen()` 增加 `ignoreNativeUntil` 设置；新增 `installAppFullscreenExitSync()` 统一管理 Web document 事件 + Tauri 原生事件监听。

### 4.7 `layout/index.tsx`（Layout 挂载全屏同步 + flushSync）

**来源**：`apps/frontend/src/layout/index.tsx`（**改动后**，关键片段，import + 两个 useEffect，约 L14–L22、L71–L80）

```typescript
// 引入 React DOM 的 flushSync（同步刷新）
import { flushSync } from 'react-dom';
// 引入 react-router
import { Outlet, useLocation, useNavigate } from 'react-router';
// 引入 ChatCoreProvider
import { ChatCoreProvider } from '@/contexts';
// 从 federation 导入：全屏状态读取、退出同步安装、订阅
import {
    getAppFullscreen,
    installAppFullscreenExitSync,
    subscribeAppFullscreen,
} from '@/federation';
```

```typescript
// 订阅全屏状态：用 flushSync 确保壳层（Sidebar/Header）立即隐藏
// 避免缩窗动画过程中侧栏还在的视觉错位
useEffect(
    () =>
        subscribeAppFullscreen((next) => {
            // flushSync 强制同步刷新 React 状态，不等下一个微任务
            flushSync(() => setTheater(next));
        }),
    [],
);

// Tauri 原生 host://window-fullscreen / Web document：系统退出全屏时立刻收起影院
// 统一安装：will-exit（精准） + Resized（兜底） + document fullscreenchange（Web）
useEffect(() => installAppFullscreenExitSync(), []);
```

**来源**：`apps/frontend/src/layout/index.tsx`（**改动前**，关键片段，import + 两个 useEffect，约 L14–L20、L68–L82）

```typescript
// 引入 react-router
import { Outlet, useLocation, useNavigate } from 'react-router';
// 引入 ChatCoreProvider
import { ChatCoreProvider } from '@/contexts';
// 从 federation 导入：全屏状态读写 + 订阅
import {
    getAppFullscreen,
    setAppFullscreen,
    subscribeAppFullscreen,
} from '@/federation';
```

```typescript
// 订阅全屏状态（无 flushSync，异步刷新）
useEffect(() => subscribeAppFullscreen(setTheater), []);

// Web：系统 Esc 退出 document 全屏时同步关掉影院态
// Tauri 运行时由 Rust 事件处理，Web 走 document fullscreenchange
useEffect(() => {
    const onFs = () => {
        if (document.fullscreenElement) return;
        if (!getAppFullscreen()) return;
        if (isTauriRuntime()) return;
        void setAppFullscreen(false);
    };
    document.addEventListener('fullscreenchange', onFs);
    return () => document.removeEventListener('fullscreenchange', onFs);
}, []);
```

**变更摘要**：`subscribeAppFullscreen` 改用 `flushSync` 包裹；移除原 `fullscreenchange` 监听，改用 `installAppFullscreenExitSync()` 统一管理（包含 Tauri 原生事件 + Web document 事件）。

### 4.8 `PluginPageShell.tsx`（插件壳 flushSync）

**来源**：`apps/frontend/src/federation/host/PluginPageShell.tsx`（**改动后**，关键片段，L8–L30）

```typescript
// 引入 flushSync 用于同步刷新
import { type ReactNode, useEffect, useState } from 'react';
import { flushSync } from 'react-dom';
import { cn } from '@/lib/utils';
// 引入全屏状态读取与订阅
import {
    getAppFullscreen,
    subscribeAppFullscreen,
} from '../capabilities/appFullscreen';

// 插件页面壳组件
export function PluginPageShell({
    children,
    className,
}: {
    children: ReactNode;
    className?: string;
}) {
    // 从全局状态初始化影院态
    const [theater, setTheater] = useState(getAppFullscreen);
    // 订阅全屏状态变化，用 flushSync 确保同步刷新
    useEffect(
        () =>
            subscribeAppFullscreen((next) => {
                // flushSync 让影院态切换在下一帧立即生效
                flushSync(() => setTheater(next));
            }),
        [],
    );
```

**来源**：`apps/frontend/src/federation/host/PluginPageShell.tsx`（**改动前**，关键片段，L8–L24）

```typescript
// 原有 import
import { type ReactNode, useEffect, useState } from 'react';
import { cn } from '@/lib/utils';
// 全屏状态读取与订阅
import {
    getAppFullscreen,
    subscribeAppFullscreen,
} from '../capabilities/appFullscreen';

// 插件页面壳组件
export function PluginPageShell({
    children,
    className,
}: {
    children: ReactNode;
    className?: string;
}) {
    const [theater, setTheater] = useState(getAppFullscreen);
    // 无 flushSync，异步刷新可能导致视觉错位
    useEffect(() => subscribeAppFullscreen(setTheater), []);
```

**变更摘要**：`subscribeAppFullscreen` 回调改用 `flushSync` 包裹，确保影院态切换立即生效。

### 4.9 `federation/index.ts`（新增导出）

**来源**：`apps/frontend/src/federation/index.ts`（**改动后**，全屏导出段落，L38–L46）

```typescript
// 从 appFullscreen 重新导出所有全屏相关符号
export {
    // 应用级全屏事件（CustomEvent，组件间通信）
    APP_FULLSCREEN_EVENT,
    // 读取当前全屏状态
    getAppFullscreen,
    // 安装系统全屏退出同步（Layout 调用一次）
    installAppFullscreenExitSync,
    // 设置全屏（含 Tauri / Web 双路径）
    setAppFullscreen,
    // 订阅全屏状态变化
    subscribeAppFullscreen,
    // Tauri will-exit 事件名（macOS 原生退出全屏前一刻）
    TAURI_WILL_EXIT_FULLSCREEN_EVENT,
    // Tauri window-fullscreen 事件名（Resized 兜底）
    TAURI_WINDOW_FULLSCREEN_EVENT,
} from './capabilities/appFullscreen';
```

**来源**：`apps/frontend/src/federation/index.ts`（**改动前**，全屏导出段落，约 L38–L44）

```typescript
// 从 appFullscreen 重新导出（仅基础符号）
export {
    APP_FULLSCREEN_EVENT,
    getAppFullscreen,
    setAppFullscreen,
    subscribeAppFullscreen,
} from './capabilities/appFullscreen';
```

**变更摘要**：新增导出 `installAppFullscreenExitSync`、`TAURI_WILL_EXIT_FULLSCREEN_EVENT`、`TAURI_WINDOW_FULLSCREEN_EVENT`。

## 5. 依赖变更

`Cargo.toml` 新增：

- `block2 = "0.6"`：Rust 与 ObjC block 交互的库。
- `objc2-foundation` 新增 `NSNotification`、`NSOperation` 特性：提供 `NSNotificationCenter`、`NSOperationQueue` 等类型的 Rust 绑定。

## 6. 事件时序图

```
用户操作           Rust 层                              前端
  │                │                                   │
  │ ┌─ 绿钮退出 ──→ │ NSWindowWillExitFullScreenNotif   │
  │ │  (macOS)     │   emit("will-exit-fullscreen") ──────→ setAppFullscreen(false)
  │ │              │                                   │   notify(false) → flushSync
  │ │              │                                   │   Sidebar/Header 立即隐藏
  │ │              │ ┌─ set_fullscreen(false) ──────→  │ （缩窗动画开始，此时前端已收影院）
  │ │              │ │                                 │
  │ │              │ │ Resized(_) ──────────────────→ │ onListen("window-fullscreen")
  │ │              │ │   emit("window-fullscreen",false) │  (被 ignoreNativeUntil 过滤)
  │ │              │ │   80ms 后再 emit 一次           │
  │ │              │ │                                 │
  │ │              │ └─ emit_window_fullscreen_state   │
  │ │              │   (菜单路径)                      │
  │ │              │ ───────────────────────────────→ │ onListen("window-fullscreen")
  │ │              │                                   │   (兜底，已过 ignoreNativeUntil)
  │ └───────────────┤                                   │ 影院态已收，不会重复触发
```

## 7. 兼容性与影响

- **macOS 专属**：`fullscreen_watch.rs` 使用 `#[cfg(target_os = "macos")]`，非 macOS 平台不受影响。
- **Web 端不受影响**：Web 端仍走 `document.fullscreenchange`，新增的 `TAURI_*` 事件在非 Tauri 运行时不会触发。
- **进场防抖**：`setAppFullscreen(true)` 设 `ignoreNativeUntil = 1000ms`，防止进场动画期间的 `Resized` 误清影院态。
- **退出防抖**：`setAppFullscreen(false)` 设 `ignoreNativeUntil = 200ms`，给缩窗动画留余量。
- **flushSync**：仅包裹 `subscribeAppFullscreen` 回调，不影响 `notify()` 的 CustomEvent 分发。

## 8. 风险与回归

| 场景 | 测试点 |
| ---- | ------ |
| macOS 绿钮退出全屏 | 侧栏/顶栏在缩窗动画开始前已隐藏，无「壳先缩窗、侧栏后闪」现象 |
| macOS Esc 退出全屏 | 同上，且与绿钮行为一致 |
| macOS 菜单「全屏窗口」关闭 | 同上 |
| macOS 菜单「全屏窗口」开启 | 正常进入全屏，无误触发退出 |
| Tauri 进入全屏后播放视频 | 影院态正确保持，不受 Resized 误触发 |
| Tauri 退出全屏后重新进入 | `ignoreNativeUntil` 正确重置 |
| Web 端进入/退出全屏 | 行为不变（走 `document.fullscreenchange`） |
| 非 macOS 平台（Windows/Linux） | `fullscreen_watch` 不编译，行为不变 |
| 插件页全屏切换 | `PluginPageShell` 正确同步 |

## 9. 相关源码路径

| 说明 | 路径 |
| ---- | ---- |
| 新增 macOS 原生通知观察者 | `apps/frontend/src-tauri/src/system/fullscreen_watch.rs` |
| 模块注册 | `apps/frontend/src-tauri/src/system/mod.rs` |
| 启动时安装 | `apps/frontend/src-tauri/src/lib.rs` |
| Resized 事件处理 | `apps/frontend/src-tauri/src/system/event.rs` |
| 菜单全屏项 | `apps/frontend/src-tauri/src/system/menu.rs` |
| 前端全屏状态管理 | `apps/frontend/src/federation/capabilities/appFullscreen.ts` |
| federation 导出 | `apps/frontend/src/federation/index.ts` |
| Layout 挂载同步 | `apps/frontend/src/layout/index.tsx` |
| 插件壳 flushSync | `apps/frontend/src/federation/host/PluginPageShell.tsx` |
| Cargo 依赖 | `apps/frontend/src-tauri/Cargo.toml` |

---

（若与仓库最新源码不一致，以源码为准）
