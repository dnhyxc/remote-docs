# macOS 窗口缩放零露白（目标尺寸预布局 + 揭开动画）

> 归档态实现说明。规划态思路见 [../ideas/Tauri窗口缩放揭示.md](../ideas/tauri/Tauri窗口缩放揭示.md)。

## 1. 背景与目标

macOS 上双击标题栏或菜单「缩放窗口」放大时，Tauri 窗口壳**瞬间**变到目标尺寸，而 WebView 重排是**异步**的，导致「壳先大、页后跟」，右侧与底部大面积露出 NSWindow 背景色。本改动用 swizzle `NSWindow.zoom:` + 目标尺寸预布局 + 顶对齐 cover + 窗口揭开动画，做到放大过程**零露白**、缩小过程**无末帧跳变**。

## 2. 改动范围

- `apps/frontend/src-tauri/src/system/zoom.rs`（**新增**）
- `apps/frontend/src-tauri/src/system/mod.rs`
- `apps/frontend/src-tauri/src/lib.rs`
- `apps/frontend/src-tauri/src/system/menu.rs`（`scale` 分支）
- `apps/frontend/src-tauri/Cargo.toml`
- `apps/frontend/src-tauri/capabilities/default.json`
- `apps/frontend/src/index.css`
- `apps/frontend/index.html`

## 3. 实现思路

1. **swizzle `NSWindow.zoom:`**：拦截双击标题栏（不经过 Tauri 菜单的触发路径），`ORIG_ZOOM` 保留原实现以便无窗口时回退。
2. **放大靠「预布局 + 揭开」**：先把页面（`#root`/body/html）钉到目标大尺寸并顶对齐，窗口只是自上而下揭开已画好的大画，揭到哪画已到哪。
3. **缩小靠「cover 同步收」**：`cover = lerp(content_from, content_to, t)` 与窗口同 t 收敛，避免结束才一瞬间 reflow。
4. **首帧立刻 `tick()`**：布局变更与窗口移动同一调用栈完成，消除「布局已变、窗未动」瞬时错位。
5. **移除 `background-attachment: fixed`**：让背景层随 body 延展，与内容同帧长大。
6. **`cocoa` → `objc2` 生态**：换用更现代的 Rust↣ObjC 桥 + `dispatch2` 帧调度。

## 4. 关键代码对比与注释

### 4.1 `zoom` 模块声明（`apps/frontend/src-tauri/src/system/mod.rs`）

**对比范围**：模块顶部声明。

**改动前** · `apps/frontend/src-tauri/src/system/mod.rs`（基线，约 L1–L5）

```rust
// 原有模块声明，无 zoom
pub mod dock;
pub mod event;
pub mod menu;
pub mod shortcut;
```

**改动后** · `apps/frontend/src-tauri/src/system/mod.rs`（当前，约 L1–L7）

```rust
// Dock 重开事件处理（macOS 点 Dock 图标恢复窗口）
pub mod dock;
// 窗口事件处理器（关闭拦截 + closeType 分流）
pub mod event;
// 仅 macOS 编译 zoom 模块：内部全是 AppKit API，Linux/Windows 编译会报错
#[cfg(target_os = "macos")]
pub mod zoom;
// 系统菜单构建与加速键同步
pub mod menu;
// 全局快捷键注册与分发
pub mod shortcut;
```

**变更摘要**：新增 `#[cfg(target_os = "macos")] pub mod zoom;`，仅在 macOS 编译该模块。

### 4.2 `install` 挂载与命令注册（`apps/frontend/src-tauri/src/lib.rs`）

**对比范围**：`setup` 闭包末尾 + `invoke_handler` 注册。

**改动前** · `apps/frontend/src-tauri/src/lib.rs`（基线，约 L61–L65）

```rust
// 窗口事件处理器，main_window 直接 move 进闭包
setup_window_events(main_window, app.handle().clone());
Ok(())
```

**改动后** · `apps/frontend/src-tauri/src/lib.rs`（当前，约 L61–L65）

```rust
// main_window clone 一份：下面 zoom::install 还要借用一次，原 move 会致编译失败
setup_window_events(main_window.clone(), app.handle().clone());
// macOS：挂载窗口缩放拦截（swizzle NSWindow.zoom: + 设背景色）
#[cfg(target_os = "macos")]
system::zoom::install(&main_window);
Ok(())
```

**变更摘要**：`main_window` 改 `clone()` 让 `install` 仍能借用；新增 macOS 条件挂载。

**改动前** · `apps/frontend/src-tauri/src/lib.rs`（基线，约 L93）

```rust
// invoke_handler 原注册列表（无 sync_window_menu_shortcuts）
reload_all_shortcuts,
```

**改动后** · `apps/frontend/src-tauri/src/lib.rs`（当前，约 L94–L95）

```rust
// 重新加载所有快捷键
reload_all_shortcuts,
// 同步窗口菜单加速键（设置页改键后调用）
sync_window_menu_shortcuts,
```

**变更摘要**：注册 `sync_window_menu_shortcuts` 命令（菜单加速键同步用，与 zoom 共用 lib.rs 入口）。

### 4.3 菜单「缩放窗口」分支（`apps/frontend/src-tauri/src/system/menu.rs`）

**对比范围**：`on_menu_event` 闭包内 `"scale"` 分支。

**改动前** · `apps/frontend/src-tauri/src/system/menu.rs`（基线，约 L116–L120）

```rust
"scale" => {
    // 旧版所有平台都走 maximize/unmaximize，macOS 露白
    if win.is_maximized().unwrap_or(false) {
        let _ = win.unmaximize();
    } else {
        let _ = win.maximize();
    }
}
```

**改动后** · `apps/frontend/src-tauri/src/system/menu.rs`（当前，约 L116–L129）

```rust
"scale" => {
    // macOS：走自定义 zoom 动画（零露白）
    #[cfg(target_os = "macos")]
    {
        crate::system::zoom::toggle_main();
    }
    // 非 macOS：回退到原生 maximize / unmaximize
    #[cfg(not(target_os = "macos"))]
    {
        if win.is_maximized().unwrap_or(false) {
            let _ = win.unmaximize();
        } else {
            let _ = win.maximize();
        }
    }
}
```

**变更摘要**：macOS 改走 `zoom::toggle_main()`，非 macOS 保留 `maximize` 兜底。

### 4.4 依赖替换（`apps/frontend/src-tauri/Cargo.toml`）

**对比范围**：macOS 依赖块。

**改动前** · `apps/frontend/src-tauri/Cargo.toml`（基线，约 L36–L37）

```toml
# 旧的 cocoa crate，已停止维护、API 笨重
cocoa = "0.26.1"
```

**改动后** · `apps/frontend/src-tauri/Cargo.toml`（当前，约 L36–L55）

```toml
# objc2：现代 Rust↣ObjC 桥，零成本、类型安全
objc2 = "0.6"
# 基础类型：NSGeometry(NSPoint/NSRect/NSSize)、NSArray、NSString
objc2-foundation = { version = "0.3", features = [
  "NSGeometry",
  "NSArray",
  "NSString",
  "objc2-core-foundation",
] }
# AppKit：NSWindow/NSView/NSScreen/NSColor/NSMenu 等
objc2-app-kit = { version = "0.3", features = [
  "NSWindow",
  "NSView",
  "NSScreen",
  "NSResponder",
  "NSGraphics",
  "NSColor",
  "NSApplication",
  "NSMenu",
  "NSMenuItem",
  "NSImage",
  "NSFontDescriptor",
  "objc2-core-foundation",
] }
# GCD 帧调度：DispatchQueue::main().after() 按帧回调 tick
dispatch2 = "0.3"
```

**变更摘要**：移除 `cocoa`，引入 `objc2`/`objc2-foundation`/`objc2-app-kit`/`dispatch2`。

### 4.5 权限补充（`apps/frontend/src-tauri/capabilities/default.json`）

**对比范围**：`permissions` 数组。

**改动前** · `apps/frontend/src-tauri/capabilities/default.json`（基线，约 L13）

```jsonc
"core:window:allow-set-theme",
// （无 set-size / set-position）
```

**改动后** · `apps/frontend/src-tauri/capabilities/default.json`（当前，约 L14–L15）

```jsonc
// 主窗口 focus 设置权限
"core:window:allow-set-focus",
// 主题设置权限
"core:window:allow-set-theme",
// 菜单「填充窗口」fill 需要：set_size
"core:window:allow-set-size",
// 菜单「填充窗口」fill 需要：set_position
"core:window:allow-set-position",
```

**变更摘要**：新增 `allow-set-size` / `allow-set-position`（菜单「填充窗口」`fill` 用，zoom 走底层 NSWindow 不需权限）。

### 4.6 背景层延展（`apps/frontend/src/index.css` 与 `apps/frontend/index.html`）

**对比范围**：`body` 背景规则。

**改动前** · `apps/frontend/src/index.css`（基线，约 L406–L409）

```css
body {
    /* 大气层背景图 */
    background-image: var(--theme-bg-atmosphere);
    background-repeat: no-repeat;
    background-size: cover;
    /* fixed 让背景固定 viewport，预布局大尺寸时不延展，导致错位 */
    background-attachment: fixed;
}
```

**改动后** · `apps/frontend/src/index.css`（当前，约 L406–L409）

```css
body {
    /* 大气层背景图 */
    background-image: var(--theme-bg-atmosphere);
    background-repeat: no-repeat;
    background-size: cover;
    /* 移除 fixed：背景随 body 延展，配合 push_page_size 钉大尺寸时同步长大 */
    font-family: var(--font-family);
}
```

**变更摘要**：移除 `background-attachment: fixed`，背景变回默认 `scroll` 随 body 延展。`index.html` 内联首屏背景同步移除同一行。

### 4.7 核心实现 `zoom.rs`（**新增** · `apps/frontend/src-tauri/src/system/zoom.rs`，约 L1–L344）

```rust
//! macOS 窗口缩放：目标尺寸预布局 + 只动画窗口（揭开/裁剪）。
//!
//! 放大：WebView/页面先布到目标大尺寸，窗口揭开已画好的区域（无露白）。
//! 缩小：cover 随窗口进度一起收，避免拖到结束才一瞬间 reflow 抖动。
//! 开场不再空等预布局帧，首帧同时改布局并动窗口，减轻「布局已变、窗未动」的一瞬。

// dispatch2：macOS GCD 队列，用来在主线程按帧调度 tick
use dispatch2::{DispatchQueue, DispatchTime};
// objc2 运行时类型：用于方法交换拿到原方法实现指针并替换
use objc2::runtime::{AnyObject, Imp, Sel};
use objc2::{sel, ClassType};
// NSColor 设窗口背景色；NSWindow 操作底层窗口
use objc2_app_kit::{NSColor, NSWindow};
// NSPoint/NSRect/NSSize：AppKit 几何类型
use objc2_foundation::{NSPoint, NSRect, NSSize};
// 原子与锁：BUSY 防重入、Once 保证只交换一次、Mutex 持有动画状态与窗口引用
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::sync::{Mutex, Once};
use tauri::WebviewWindow;

// 动画总时长（秒）：0.28s 接近 macOS 原生 zoom 体感
const ANIM_SECS: f64 = 0.28;
// 单帧时长（纳秒）：16.6ms ≈ 60fps
const FRAME_NS: i64 = 16_666_667;

/// 一个矩形帧：左下角坐标 + 宽高，NSRect 的 Rust 友好包装便于做 lerp
#[derive(Clone, Copy)]
struct Frame {
	// 左下角 x（NSView 坐标系原点在左下）
	x: f64,
	// 左下角 y
	y: f64,
	// 宽
	w: f64,
	// 高
	h: f64,
}

impl From<NSRect> for Frame {
	fn from(r: NSRect) -> Self {
		Self {
			// NSRect.origin 是左下角
			x: r.origin.x,
			y: r.origin.y,
			// NSRect.size 是宽高
			w: r.size.width,
			h: r.size.height,
		}
	}
}

impl Frame {
	// 回到 NSRect，用于 setFrame_display_animate
	fn to_ns(self) -> NSRect {
		NSRect::new(NSPoint::new(self.x, self.y), NSSize::new(self.w, self.h))
	}
}

/// 缩放状态：当前是否已放大、放大前的原始帧（用于还原）
struct ZoomState {
	// 放大前的原始小尺寸，还原时用
	restore: Option<Frame>,
	// 当前是否处于「已放大」状态
	filled: bool,
}

/// 单次动画的运行参数，tick 每帧读它推进 step，done 后置 None
struct Anim {
	// NSWindow 原始指针（跨帧持有，避开生命周期）
	ns_ptr: usize,
	// 起始窗口帧
	from: Frame,
	// 目标窗口帧
	to: Frame,
	// 起始 contentView 尺寸 (w,h)
	content_from: (f64, f64),
	// 目标 contentView 尺寸 (w,h) —— cover 的目标
	content_to: (f64, f64),
	// 是否在放大（决定 cover 算法）
	enlarging: bool,
	// 当前帧序号
	step: u32,
	// 总帧数
	steps: u32,
}

// Once 保证 swizzle 只装一次
static INSTALL: Once = Once::new();
// 存原 zoom: 实现指针，未初始化窗口时回退用
static ORIG_ZOOM: AtomicUsize = AtomicUsize::new(0);
// 缓存主窗口（toggle_main / push_page_size 用）
static EMIT_WIN: Mutex<Option<WebviewWindow>> = Mutex::new(None);
// 缩放状态
static STATE: Mutex<ZoomState> = Mutex::new(ZoomState {
	restore: None,
	filled: false,
});
// 当前动画
static ANIM: Mutex<Option<Anim>> = Mutex::new(None);
// 防重入：动画进行中再次触发直接丢
static BUSY: AtomicBool = AtomicBool::new(false);

/// 安装入口：setup 末尾调用一次
pub fn install(win: &WebviewWindow) {
	// 缓存窗口引用，后续菜单/全局快捷键不传参也能拿到
	if let Ok(mut g) = EMIT_WIN.lock() {
		*g = Some(win.clone());
	}

	// 拿底层 NSWindow，设背景色为深色：放大瞬间万一露缝也是深色不刺眼
	if let Ok(ns) = win.ns_window() {
		unsafe {
			let ns = &*(ns as *const NSWindow);
			let bg = NSColor::colorWithSRGBRed_green_blue_alpha(0.118, 0.118, 0.118, 1.0);
			ns.setBackgroundColor(Some(&bg));
		}
	}

	// 只交换一次
	INSTALL.call_once(|| {
		// 找到 NSWindow 的实例方法 zoom:
		let Some(method) = NSWindow::class().instance_method(sel!(zoom:)) else {
			// 找不到放弃（理论上 macOS 一定有）
			return;
		};
		// 存原实现指针
		ORIG_ZOOM.store(method.implementation() as usize, Ordering::SeqCst);
		// 把 zoom_fwd 转成 C 函数指针塞进去
		let new: Imp = unsafe {
			std::mem::transmute(
				zoom_fwd as unsafe extern "C-unwind" fn(*mut AnyObject, Sel, *mut AnyObject),
			)
		};
		unsafe {
			// 真正替换实现：此后所有 zoom: 调用都进 zoom_fwd
			method.set_implementation(new);
		}
	});
}

/// 主动触发缩放（外部传窗口时用）
pub fn toggle(win: &WebviewWindow) {
	let Ok(ns) = win.ns_window() else {
		return;
	};
	unsafe { apply_toggle(&*(ns as *const NSWindow)) };
}

/// 菜单 / 全局快捷键入口：从缓存取主窗口再 toggle
pub fn toggle_main() {
	// 必须先 clone 再放锁：toggle→tick→eval 还会锁 EMIT_WIN，持锁重入会卡死
	let win = {
		let Ok(g) = EMIT_WIN.lock() else {
			return;
		};
		g.as_ref().cloned()
	};
	let Some(win) = win else {
		return;
	};
	toggle(&win);
}

/// 交换后的 zoom: 实现：每次 macOS 要 zoom 都进这里
unsafe extern "C-unwind" fn zoom_fwd(
	this: *mut AnyObject,
	_cmd: Sel,
	sender: *mut AnyObject,
) {
	// 有缓存窗口 → 拦截走自定义动画
	if EMIT_WIN.lock().ok().and_then(|g| g.as_ref().map(|_| ())).is_some() {
		unsafe { apply_toggle(&*(this as *const NSWindow)) };
		return;
	}
	// 无窗口：回退原 zoom: 实现
	let orig = ORIG_ZOOM.load(Ordering::SeqCst);
	if orig == 0 {
		return;
	}
	let f: unsafe extern "C-unwind" fn(*mut AnyObject, Sel, *mut AnyObject) =
		unsafe { std::mem::transmute(orig) };
	unsafe { f(this, _cmd, sender) };
}

/// cubic ease-in-out：开始慢、中间快、结束慢，避免线性动画的机械感
fn ease(t: f64) -> f64 {
	if t < 0.5 {
		4.0 * t * t * t
	} else {
		1.0 - (-2.0 * t + 2.0).powi(3) / 2.0
	}
}

/// 窗口帧插值：在 from/to 之间按 t 算当前帧（x/y/w/h 都插值）
fn lerp(a: Frame, b: Frame, t: f64) -> Frame {
	Frame {
		x: a.x + (b.x - a.x) * t,
		y: a.y + (b.y - a.y) * t,
		w: a.w + (b.w - a.w) * t,
		h: a.h + (b.h - a.h) * t,
	}
}

/// cover 尺寸插值（缩小路径用）
fn lerp2(a: (f64, f64), b: (f64, f64), t: f64) -> (f64, f64) {
	(a.0 + (b.0 - a.0) * t, a.1 + (b.1 - a.1) * t)
}

/// 单次缩放核心：计算目标、初始化动画、首帧立刻 tick
unsafe fn apply_toggle(ns: &NSWindow) {
	// 原子 CAS：动画进行中直接丢，避免叠加动画造成帧混乱
	if BUSY.swap(true, Ordering::SeqCst) {
		return;
	}

	// 当前窗口帧 = 起点
	let from = Frame::from(ns.frame());
	// 决定本次是放大还是还原
	let to = {
		let Ok(mut st) = STATE.lock() else {
			BUSY.store(false, Ordering::SeqCst);
			return;
		};
		if st.filled {
			// 已放大 → 还原到存的小尺寸
			st.filled = false;
			st.restore.unwrap_or(from)
		} else {
			// 未放大 → 目标取屏幕可用区（排除 Dock / 菜单栏）
			let Some(screen) = ns.screen() else {
				BUSY.store(false, Ordering::SeqCst);
				return;
			};
			st.restore = Some(from);
			st.filled = true;
			Frame::from(screen.visibleFrame())
		}
	};

	// 当前 contentView 尺寸
	let content_from = ns
		.contentView()
		.map(|c| {
			let b = c.bounds().size;
			// max(1.0) 防除零
			(b.width.max(1.0), b.height.max(1.0))
		})
		.unwrap_or((from.w.max(1.0), from.h.max(1.0)));
	// 目标 contentView 尺寸 = 当前 + 窗口增量（标题栏高度不变，Δcontent = Δwindow）
	let content_to = (
		(content_from.0 + (to.w - from.w)).max(1.0),
		(content_from.1 + (to.h - from.h)).max(1.0),
	);
	// 是否放大：用面积比较
	let enlarging = to.w * to.h > from.w * from.h;

	// 开裁剪：subview 超出 contentView 的部分裁掉
	if let Some(content) = ns.contentView() {
		content.setClipsToBounds(true);
	}

	// 总帧数：0.28s × 60fps ≈ 17
	let steps = ((ANIM_SECS * 60.0).round() as u32).max(1);
	if let Ok(mut g) = ANIM.lock() {
		*g = Some(Anim {
			ns_ptr: ns as *const NSWindow as usize,
			from,
			to,
			content_from,
			content_to,
			enlarging,
			step: 0,
			steps,
		});
	}

	// 首帧立刻：布局与窗口同帧起步，去掉预等待造成的「布局已变窗未动」
	tick();
}

/// 下一帧调度：主线程 FRAME_NS 纳秒后再 tick
fn schedule_tick() {
	let when = DispatchTime::NOW.time(FRAME_NS);
	let _ = DispatchQueue::main().after(when, || {
		tick();
	});
}

/// 帧循环主体：每帧算插值、钉页面、钉窗口，done 时收尾
fn tick() {
	// 把要在持锁外做的值先拷出来（unsafe 块不能持锁太久）
	let (ns_ptr, frame, cover_w, cover_h, enlarging, done) = {
		let Ok(mut g) = ANIM.lock() else {
			BUSY.store(false, Ordering::SeqCst);
			return;
		};
		let Some(anim) = g.as_mut() else {
			// 没有动画（被外部清掉）：解 BUSY
			BUSY.store(false, Ordering::SeqCst);
			return;
		};
		anim.step = anim.step.saturating_add(1);
		// 归一化进度 [0,1]，套 ease
		let raw_t = (anim.step as f64 / anim.steps as f64).min(1.0);
		let t = ease(raw_t);
		// 当前窗口帧 = from→to 插值
		let frame = lerp(anim.from, anim.to, t);

		// 放大：cover 始终为目标大尺寸（窗口揭开）
		// 缩小：cover 随进度收到目标小尺寸（避免结束才跳）
		let (cover_w, cover_h) = if anim.enlarging {
			anim.content_to
		} else {
			lerp2(anim.content_from, anim.content_to, t)
		};

		let done = anim.step >= anim.steps;
		let out = (
			anim.ns_ptr,
			frame,
			cover_w,
			cover_h,
			anim.enlarging,
			done,
		);
		if done {
			// 动画结束：清状态
			*g = None;
		}
		out
	};

	unsafe {
		let ns = &*(ns_ptr as *const NSWindow);

		if enlarging && cover_w > 0.0 {
			// 放大：先保证大尺寸已钉住，再动窗口，同帧完成
			// 顺序重要：先 push_page_size（React 重排到目标大尺寸）→ pin_webview_cover（钉住大画顶对齐）→ 之后才动窗口
			push_page_size(cover_w, cover_h, false);
			pin_webview_cover(ns, cover_w, cover_h);
		}

		// 动窗口：display=true 同步刷新，animate=false 不走系统动画避免抢帧
		ns.setFrame_display_animate(frame.to_ns(), true, false);

		if enlarging {
			// 放大：窗口设完后再次钉 subview，防系统 layout 改回 bounds
			pin_webview_cover(ns, cover_w, cover_h);
		} else {
			// 缩小：布局跟 cover 同步收
			push_page_size(cover_w, cover_h, false);
			pin_webview_cover(ns, cover_w, cover_h);
		}

		if done {
			// 收尾：subview 钉回真实 bounds，恢复正常铺满
			pin_webview_fit(ns);
			// 清掉注入的内联尺寸，触发最后一次 resize 让响应式接管
			clear_page_size_override();
			BUSY.store(false, Ordering::SeqCst);
		}
	}

	if !done {
		// 下一帧
		schedule_tick();
	}
}

/// 顶对齐钉住 cover 尺寸（超高时 y 为负，露出顶部）
unsafe fn pin_webview_cover(ns: &NSWindow, cover_w: f64, cover_h: f64) {
	let Some(content) = ns.contentView() else {
		return;
	};
	// 必须裁剪，否则 cover 溢出到其他窗口
	content.setClipsToBounds(true);
	let b = content.bounds();
	// frame: 宽=cover_w, 高=cover_h, x=0, y=bounds.height-cover_h（顶对齐）
	// NSView 坐标系原点在左下、y 向上：y = bounds.h - cover_h 让 cover 顶部贴窗口顶
	let frame = NSRect::new(
		NSPoint::new(0.0, b.size.height - cover_h),
		NSSize::new(cover_w.max(1.0), cover_h.max(1.0)),
	);
	// 遍历 contentView 所有子视图（WebView 是其一）钉成同一 frame
	for view in content.subviews() {
		view.setFrame(frame);
	}
}

/// 收尾：把 subview 钉回 contentView 真实 bounds，并触发 layout + display
unsafe fn pin_webview_fit(ns: &NSWindow) {
	let Some(content) = ns.contentView() else {
		return;
	};
	let bounds = content.bounds();
	for view in content.subviews() {
		// 回到正常铺满
		view.setFrame(bounds);
	}
	// 标记需要布局
	content.setNeedsLayout(true);
	// 立即布局
	content.layoutSubtreeIfNeeded();
	// 立即刷新显示
	ns.displayIfNeeded();
}

/// 向前端注入 JS：把 html/body/#root 的 width/height 设成 (w,h)，dispatch resize
fn push_page_size(w: f64, h: f64, clear_after: bool) {
	let Ok(g) = EMIT_WIN.lock() else {
		return;
	};
	let Some(win) = g.as_ref() else {
		return;
	};
	let js = if clear_after {
		// 清除模式：把内联 width/height 全置空，dispatch resize
		r#"(function(){var r=document.documentElement,b=document.body;r.style.width="";r.style.height="";if(b){b.style.width="";b.style.height="";}var root=document.getElementById("root");if(root){root.style.width="";root.style.height="";}window.dispatchEvent(new Event("resize"));})()"#
			.to_string()
	} else {
		// 钉尺寸模式：设 html/body/#root 的 width/height 为 w/h（整数 px），dispatch resize
		format!(
			r#"(function(){{var w={w:.0},h={h:.0};var r=document.documentElement,b=document.body;r.style.width=w+"px";r.style.height=h+"px";if(b){{b.style.width=w+"px";b.style.height=h+"px";}}var root=document.getElementById("root");if(root){{root.style.width=w+"px";root.style.height=h+"px";}}window.dispatchEvent(new Event("resize"));}})()"#
		)
	};
	let _ = win.eval(&js);
}

/// 收尾清除：等价于 push_page_size(_, _, true)
fn clear_page_size_override() {
	push_page_size(0.0, 0.0, true);
}
```

## 5. 兼容性与影响

- **平台**：仅 macOS 生效；Linux/Windows 走 `maximize` 兜底，编译不受影响（`#[cfg]` 隔离）。
- **依赖**：移除 `cocoa`，新增 `objc2` 系列与 `dispatch2`；`Cargo.lock` 同步更新。
- **背景**：移除 `background-attachment: fixed` 后背景随 body 滚动，但应用 `overflow: hidden` 不滚动，视觉无差异。
- **行为**：动画期间用户拖拽窗口不触发新动画（`BUSY` 拦截）。

## 6. 相关源码路径

| 说明 | 路径 |
| ---- | ---- |
| 核心实现（新增） | `apps/frontend/src-tauri/src/system/zoom.rs` |
| 模块声明 | `apps/frontend/src-tauri/src/system/mod.rs` |
| 安装挂载 | `apps/frontend/src-tauri/src/lib.rs` |
| 菜单分支 | `apps/frontend/src-tauri/src/system/menu.rs` |
| 依赖 | `apps/frontend/src-tauri/Cargo.toml` |
| 权限 | `apps/frontend/src-tauri/capabilities/default.json` |
| 背景层 | `apps/frontend/src/index.css` / `apps/frontend/index.html` |

---

（若与仓库最新源码不一致，以源码为准）
