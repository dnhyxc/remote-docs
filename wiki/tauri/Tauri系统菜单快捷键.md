# 系统菜单 + 全局/页面快捷键体系（store 单一真相源）

> 归档态实现说明。规划态思路见 [../ideas/Tauri系统菜单快捷键.md](../ideas/tauri/Tauri系统菜单快捷键.md)；窗口「缩放」分支动画见 [./Tauri窗口缩放揭示.md](../tauri/Tauri窗口缩放揭示.md)。

## 1. 背景与目标

桌面端原本有三类「键盘触发动作」各自割裂：

1. **系统菜单项**（关闭/缩放/填充/居中/全屏/最小化/关于/退出登录/退出应用）——`MenuBuilder` 用 `SubmenuBuilder.text(...)` 构建，**右侧加速键在构造时写死**，用户改键后菜单不会刷新。
2. **全局快捷键**（显隐应用 / 刷新 / 新建工作流 / 打开子窗口）——`tauri-plugin-global-shortcut` 注册系统级热键，**应用失焦后仍抢占其他 App 的同组合键**。
3. **页面内快捷键**（知识库保存/导入/分享等 20+ 项）—— 只在特定页面生效，**不该注册成全局热键**。

加上 File 菜单「退出登录」与侧边栏登出走的是两套清态逻辑、macOS 系统自动往 Edit 菜单注入「AutoFill / Start Dictation / Emoji & Symbols」英文项。本改动用一个 `shortcut_{n}` 编号 + 一个 `registerGlobally`/`syncWindowMenu` 标志把三者统一编排，并补齐 macOS 编辑菜单中文化与多窗主题/登出联动（多窗与登出归档见 [./关于窗口轻量化.md](./关于窗口轻量化.md)、[./登出统一主题同步.md](../auth/登出统一主题同步.md)）。

## 2. 改动范围

- `apps/frontend/src-tauri/src/system/menu.rs`（重写：IconMenuItem + 运行时 `set_accelerator`）
- `apps/frontend/src-tauri/src/system/shortcut.rs`（删除 `Hide` 枚举；失焦反注册加 `HideOrShowApp` 例外）
- `apps/frontend/src-tauri/src/command/common.rs`（新增 `sync_window_menu_shortcuts`；`reload_all_shortcuts` 顺带同步菜单）
- `apps/frontend/src-tauri/src/lib.rs`（注册 `sync_window_menu_shortcuts` 命令）
- `apps/frontend/src/views/setting/system/config.ts`（新增 `syncWindowMenu` 字段、`WINDOW_SHORTCUT_KEYS`/`FILE_SHORTCUT_KEYS`、删 `hide` 改 `window_close`、补 8 项菜单键）
- `apps/frontend/src/views/setting/system/index.tsx`（`pageOnly` 分支按 `syncWindowMenu` 调同步；动作分组集合更新）

## 3. 实现思路

1. **store 作单一真相源**：所有快捷键都以 `shortcut_{n}` 写入 `tauri-plugin-store` 的 `settings.json`，菜单加速键、全局热键、页面键都从同一处读，改键只改一处。
2. **键 ID 编排不重叠**：`1` 原为 `hide`（已删）；`2–5` 显隐/刷新/新建/子窗；`6–24` 知识库页面键；`25–30` 窗口菜单键；`31–33` File 菜单键；Rust 端 `WIN_SHORTCUT_*`/`FILE_SHORTCUT_*` 常量与前端 `WINDOW_SHORTCUT_KEYS`/`FILE_SHORTCUT_KEYS` 对齐。
3. **菜单项改用 `IconMenuItem`**：`IconMenuItemBuilder.with_id(...).accelerator(...)` 构造时传加速键，构建好的 `IconMenuItem` 句柄 `app.manage(MenuAccelHandles {...})` 进 Tauri State，后续 `set_accelerator(Some(...))` 即可运行时改键。
4. **改键后调 `sync_window_menu_shortcuts`**：设置页 `pageOnly` 分支写完 store 后，若 `info.syncWindowMenu` 为 true 且是 Tauri，`desktopInvoke('sync_window_menu_shortcuts')` 触发 Rust 重读 store 并刷新每个 `IconMenuItem` 加速键。
5. **store 字符串 → muda accelerator 归一化**：前端写 `"Meta + Shift + S"`，Rust `store_chord_to_accel` 按 ` + ` 切分，把 `Meta/Super/Command/Cmd` 统一为 `Command`、`Control/Ctrl` → `Control`、`Alt/Option` → `Alt`、`Shift` → `Shift`，再用 `+` 拼回，匹配 muda 期望。
6. **失焦反注册 + 显隐应用例外**：窗口失焦时遍历已注册快捷键反注册，但 `HideOrShowApp`（`shortcut_2`）跳过——它本身就是为了「应用不在前台时也能呼出」。
7. **删 `ShortcutActionType::Hide`**：原 `shortcut_1` 是「隐藏程序」，与 `window_close`（`shortcut_26`）功能重叠，删除以收敛心智。
8. **macOS 编辑菜单系统项中文化**：系统会往 Edit 菜单注入 `AutoFill / Start Dictation… / Emoji & Symbols`，`macos_strip_edit_system_items` 在 0/50ms/250ms/1s 四个延迟点重试剥离，覆盖系统晚于 `set_menu` 注入的时序；`macos_apply_uniform_menu_icons` 用 SF Symbol 模板图替换 `NativeIcon` 彩色位图，统一菜单栏视觉。

## 4. 关键代码对比与注释

### 4.1 菜单构建与加速键句柄（`apps/frontend/src-tauri/src/system/menu.rs` · `setup_menu`）

**对比范围**：`setup_menu` 全函数（构造菜单 + manage 句柄 + on_menu_event）。

**改动前** · `apps/frontend/src-tauri/src/system/menu.rs`（基线，约 L17–L83）

```rust
// 旧版 setup_menu 入口签名：与改动后一致，但内部用 SubmenuBuilder.text 写死加速键
pub fn setup_menu<R: tauri::Runtime>(app: &mut tauri::App<R>) -> tauri::Result<()> {
    // 旧 File 菜单：text() 不持有句柄，后续无法运行时改键
    let file_menu = SubmenuBuilder::new(app, "File")
        .text("about", "关于应用")
        .separator()
        .text("logout", "退出登录")
        .text("quit", "退出应用")
        .build()?;
    // 旧窗口菜单：text() 同上，scale 走 maximize 兜底（macOS 露白）
    let window_menu = SubmenuBuilder::new(app, "窗口")
        .text("minimize", "隐藏窗口")
        .separator()
        .text("close", "关闭窗口")
        .text("scale", "缩放窗口")
        .text("fill", "填充窗口")
        .text("center", "居中窗口")
        .separator()
        .text("fullscreen", "全屏窗口")
        .build()?;
    // 旧编辑菜单：text() 撤回/剪切等，macOS 会注入英文系统项
    let edit_menu = SubmenuBuilder::new(app, "编辑")
        .text("undo", "撤回")
        .separator()
        .text("cut", "剪切")
        .text("copy", "复制")
        .text("paste", "粘贴")
        .separator()
        .text("selectAll", "全选")
        .build()?;
    // 主菜单：三组 submenu
    let menu = MenuBuilder::new(app)
        .items(&[&file_menu, &window_menu, &edit_menu])
        .build()?;
    // 一次性 set_menu，无句柄管理
    app.set_menu(menu)?;
    // 旧事件闭包：每个分支手写动作，about 直接 emit 让前端弹窗
    app.on_menu_event(move |app_handle: &tauri::AppHandle<R>, event| {
        let win = app_handle.get_webview_window("main").unwrap();
        match event.id().0.as_str() {
            "minimize" => {
                // minimize 即隐藏到 Dock
                let _ = win.minimize();
            }
            "close" => {
                // 旧 close 是 hide（保留进程），与菜单文案「关闭窗口」语义模糊
                let _ = win.hide();
            }
            "scale" => {
                // 旧 scale：所有平台都 maximize/unmaximize，macOS 露白
                if win.is_maximized().unwrap_or(false) {
                    let _ = win.unmaximize();
                } else {
                    let _ = win.maximize();
                }
            }
            "center" => {
                // 居中：调用 utils::common::set_screen_center
                set_screen_center(&win);
            }
            "fill" => {
                // 填充：取当前显示器尺寸设给窗口，位置 (0,0)
                if let Ok(Some(monitor)) = win.current_monitor() {
                    let size = monitor.size();
                    let _ = win.set_size(tauri::Size::Physical(tauri::PhysicalSize {
                        width: size.width,
                        height: size.height,
                    }));
                    let _ = win.set_position(tauri::Position::Physical(tauri::PhysicalPosition {
                        x: 0,
                        y: 0,
                    }));
                }
            }
            "fullscreen" => {
                // 旧 fullscreen：只能进不能退
                let _ = win.set_fullscreen(true);
            }
            "quit" => {
                // 退出应用：exit(0)
                let _ = app_handle.exit(0);
            }
            "logout" => {
                // 旧 logout：用 win.emit 广播，前端 listen('logout') 自己清态
                let _ = win.emit("logout", ());
            }
            "about" => {
                // 旧 about：拿版本号 emit 给前端，前端 onCreateWindow 弹关于窗
                let app_version = app_handle.package_info().version.to_string();
                let _ = win.emit("about", serde_json::json!({"version": app_version}));
            }
            // ... undo/cut/copy/paste/selectAll 旧版用 document.execCommand（已废弃，由编辑菜单系统接管）
            _ => {}
        }
    });
    Ok(())
}
```

**改动后** · `apps/frontend/src-tauri/src/system/menu.rs`（当前，约 L41–L204）

```rust
// 新版 setup_menu：先读 store 拿当前所有菜单加速键，再用 IconMenuItem 构造
pub fn setup_menu<R: tauri::Runtime>(app: &mut tauri::App<R>) -> tauri::Result<()> {
	// load_menu_chords 一次性从 store 读全部 9 个菜单项的 chord 字符串
	let chords = load_menu_chords(app.handle());

	// File 菜单：about/logout/quit 三项，每个都带加速键 + 原生图标
	let about = IconMenuItemBuilder::with_id("about", "关于应用")
		// store_chord_to_accel 把 "Meta + Shift + A" 归一化为 "Command+Shift+A"
		.accelerator(store_chord_to_accel(&chords.about))
		// NativeIcon::Info 是 macOS 系统彩色位图（后续 macos_apply_uniform_menu_icons 会换成 SF Symbol）
		.native_icon(NativeIcon::Info)
		.build(app)?;
	let logout = IconMenuItemBuilder::with_id("logout", "退出登录")
		.accelerator(store_chord_to_accel(&chords.logout))
		.native_icon(NativeIcon::User)
		.build(app)?;
	let quit = IconMenuItemBuilder::with_id("quit", "退出应用")
		.accelerator(store_chord_to_accel(&chords.quit))
		.native_icon(NativeIcon::StopProgress)
		.build(app)?;

	// File 子菜单：about / 分隔 / logout / quit
	let file_menu = SubmenuBuilder::new(app, "File")
		.item(&about)
		.separator()
		.item(&logout)
		.item(&quit)
		.build()?;

	// 窗口菜单：close / 分隔 / minimize/scale/fill/center / 分隔 / fullscreen
	let minimize = IconMenuItemBuilder::with_id("minimize", "隐藏窗口")
		.accelerator(store_chord_to_accel(&chords.minimize))
		.native_icon(NativeIcon::Remove)
		.build(app)?;
	let close = IconMenuItemBuilder::with_id("close", "关闭窗口")
		.accelerator(store_chord_to_accel(&chords.close))
		.native_icon(NativeIcon::StopProgress)
		.build(app)?;
	let scale = IconMenuItemBuilder::with_id("scale", "缩放窗口")
		.accelerator(store_chord_to_accel(&chords.scale))
		.native_icon(NativeIcon::IconView)
		.build(app)?;
	let fill = IconMenuItemBuilder::with_id("fill", "填充窗口")
		.accelerator(store_chord_to_accel(&chords.fill))
		.native_icon(NativeIcon::EnterFullScreen)
		.build(app)?;
	let center = IconMenuItemBuilder::with_id("center", "居中窗口")
		.accelerator(store_chord_to_accel(&chords.center))
		.native_icon(NativeIcon::Computer)
		.build(app)?;
	let fullscreen = IconMenuItemBuilder::with_id("fullscreen", "全屏窗口")
		.accelerator(store_chord_to_accel(&chords.fullscreen))
		.native_icon(NativeIcon::EnterFullScreen)
		.build(app)?;

	// 窗口子菜单顺序：close / 分隔 / minimize scale fill center / 分隔 / fullscreen
	let window_menu = SubmenuBuilder::new(app, "窗口")
		.item(&close)
		.separator()
		.item(&minimize)
		.item(&scale)
		.item(&fill)
		.item(&center)
		.separator()
		.item(&fullscreen)
		.build()?;

	// 编辑子菜单：用 undo_with_text 等便捷方法，macOS 会接管实际编辑动作
	let edit_menu = SubmenuBuilder::new(app, "编辑")
		.undo_with_text("撤回")
		.separator()
		.cut_with_text("剪切")
		.copy_with_text("复制")
		.paste_with_text("粘贴")
		.separator()
		.select_all_with_text("全选")
		.build()?;

	// 主菜单：File / 窗口 / 编辑 三组
	let menu = MenuBuilder::new(app)
		.items(&[&file_menu, &window_menu, &edit_menu])
		.build()?;

	// set_menu 后菜单生效
	app.set_menu(menu)?;

	// 关键：把每个 IconMenuItem 句柄存进 Tauri State，后续 set_accelerator 才能拿到
	app.manage(MenuAccelHandles {
		about: about.clone(),
		logout: logout.clone(),
		quit: quit.clone(),
		minimize: minimize.clone(),
		close: close.clone(),
		scale: scale.clone(),
		fill: fill.clone(),
		center: center.clone(),
		fullscreen: fullscreen.clone(),
	});

	// macOS 专属：统一图标 + 剥离系统注入的英文 Edit 项
	#[cfg(target_os = "macos")]
	{
		macos_apply_uniform_menu_icons();
		macos_strip_edit_system_items();
	}

	// on_menu_event：match 分发，与旧版结构一致但分支语义更清晰
	app.on_menu_event(move |app_handle: &tauri::AppHandle<R>, event| {
		let win = app_handle.get_webview_window("main").unwrap();

		match event.id().0.as_str() {
			"minimize" => {
				// minimize：原生最小化到 Dock
				let _ = win.minimize();
			}
			"close" => {
				// close：直接 win.close()（关闭行为由 event.rs 按 closeType 分流）
				let _ = win.close();
			}
			"scale" => {
				// macOS 走自定义 zoom 动画（零露白），其它平台 maximize 兜底
				#[cfg(target_os = "macos")]
				{
					crate::system::zoom::toggle_main();
				}
				#[cfg(not(target_os = "macos"))]
				{
					if win.is_maximized().unwrap_or(false) {
						let _ = win.unmaximize();
					} else {
						let _ = win.maximize();
					}
				}
			}
			"center" => {
				// 居中：复用 utils::common::set_screen_center
				set_screen_center(&win);
			}
			"fill" => {
				// 填充：取当前显示器尺寸 + (0,0) 位置
				if let Ok(Some(monitor)) = win.current_monitor() {
					let size = monitor.size();
					let _ = win.set_size(tauri::Size::Physical(tauri::PhysicalSize {
						width: size.width,
						height: size.height,
					}));
					let _ = win.set_position(tauri::Position::Physical(tauri::PhysicalPosition {
						x: 0,
						y: 0,
					}));
				}
			}
			"fullscreen" => {
				// 全屏：改成 toggle，避免「只能进不能退」
				let next = !win.is_fullscreen().unwrap_or(false);
				let _ = win.set_fullscreen(next);
			}
			"quit" => {
				// 退出应用
				let _ = app_handle.exit(0);
			}
			"logout" => {
				// 退出登录：用 AppHandle 广播（不依赖 win 是否还在），前端 listen('logout') 走 performLogout 统一清态
				let _ = app_handle.emit("logout", ());
			}
			"about" => {
				// 关于窗：已打开则原生侧 set_focus（macOS JS setFocus 常被主窗盖住），否则 emit 让前端 onCreateWindow
				if let Some(about) = app_handle.get_webview_window("about") {
					let _ = about.unminimize();
					let _ = about.show();
					let _ = about.set_focus();
				} else {
					let app_version = app_handle.package_info().version.to_string();
					let _ = app_handle.emit(
						"about",
						serde_json::json!({ "version": app_version }),
					);
				}
			}
			_ => {}
		}
	});

	Ok(())
}
```

**变更摘要**：`SubmenuBuilder.text` → `IconMenuItemBuilder.with_id + accelerator + native_icon`，9 个菜单项句柄 `app.manage` 进 State；`close` 改 `win.close()`、`fullscreen` 改 toggle、`scale` macOS 走 `zoom::toggle_main`、`about` 已打开则 `set_focus`、`logout` 改 `app_handle.emit`。

### 4.2 菜单加速键句柄与 store 读取（`apps/frontend/src-tauri/src/system/menu.rs` · `MenuAccelHandles`/`load_menu_chords`/`chord_or_default`）

**对比范围**：新增的常量、`MenuAccelHandles` 结构、`load_menu_chords` 与 `chord_or_default` 函数（旧版无对应物，故只贴改动后）。

**改动后** · `apps/frontend/src-tauri/src/system/menu.rs`（当前，约 L8–L39 + L206–L240）

```rust
// 与前端 WINDOW_SHORTCUT_KEYS / FILE_SHORTCUT_KEYS / shortcut_{n} 对齐的常量
pub const WIN_SHORTCUT_MINIMIZE: i32 = 25;
// 关闭窗口对应 shortcut_26
pub const WIN_SHORTCUT_CLOSE: i32 = 26;
// 缩放窗口对应 shortcut_27
pub const WIN_SHORTCUT_SCALE: i32 = 27;
// 填充窗口对应 shortcut_28
pub const WIN_SHORTCUT_FILL: i32 = 28;
// 居中窗口对应 shortcut_29
pub const WIN_SHORTCUT_CENTER: i32 = 29;
// 全屏窗口对应 shortcut_30
pub const WIN_SHORTCUT_FULLSCREEN: i32 = 30;
// 关于应用对应 shortcut_31
pub const FILE_SHORTCUT_ABOUT: i32 = 31;
// 退出登录对应 shortcut_32
pub const FILE_SHORTCUT_LOGOUT: i32 = 32;
// 退出应用对应 shortcut_33
pub const FILE_SHORTCUT_QUIT: i32 = 33;

// 默认加速键（store 无值时兜底）
const DEFAULT_MINIMIZE: &str = "Meta + M";
const DEFAULT_CLOSE: &str = "Meta + W";
const DEFAULT_SCALE: &str = "Meta + Shift + S";
const DEFAULT_FILL: &str = "Meta + Shift + F";
const DEFAULT_CENTER: &str = "Meta + Shift + C";
const DEFAULT_FULLSCREEN: &str = "Control + Meta + F";
const DEFAULT_ABOUT: &str = "Meta + Shift + A";
const DEFAULT_LOGOUT: &str = "Meta + Shift + L";
const DEFAULT_QUIT: &str = "Meta + Q";

// 9 个 IconMenuItem 句柄，存进 Tauri State 供 sync_window_menu_accelerators 取出改键
pub struct MenuAccelHandles<R: Runtime> {
	// File 菜单三项
	about: IconMenuItem<R>,
	logout: IconMenuItem<R>,
	quit: IconMenuItem<R>,
	// 窗口菜单六项
	minimize: IconMenuItem<R>,
	close: IconMenuItem<R>,
	scale: IconMenuItem<R>,
	fill: IconMenuItem<R>,
	center: IconMenuItem<R>,
	fullscreen: IconMenuItem<R>,
}

// 9 个菜单项的 chord 字符串集合，load_menu_chords 一次填好
struct MenuChords {
	about: String,
	logout: String,
	quit: String,
	minimize: String,
	close: String,
	scale: String,
	fill: String,
	center: String,
	fullscreen: String,
}

// block_on 同步等 store 读完再返回，setup_menu 调用方不必改异步
fn load_menu_chords<R: Runtime>(app: &AppHandle<R>) -> MenuChords {
	async_runtime::block_on(async {
		MenuChords {
			// 每项都走 chord_or_default：store 有非空值用 store，否则用 DEFAULT_*
			about: chord_or_default(app, FILE_SHORTCUT_ABOUT, DEFAULT_ABOUT).await,
			logout: chord_or_default(app, FILE_SHORTCUT_LOGOUT, DEFAULT_LOGOUT).await,
			quit: chord_or_default(app, FILE_SHORTCUT_QUIT, DEFAULT_QUIT).await,
			minimize: chord_or_default(app, WIN_SHORTCUT_MINIMIZE, DEFAULT_MINIMIZE).await,
			close: chord_or_default(app, WIN_SHORTCUT_CLOSE, DEFAULT_CLOSE).await,
			scale: chord_or_default(app, WIN_SHORTCUT_SCALE, DEFAULT_SCALE).await,
			fill: chord_or_default(app, WIN_SHORTCUT_FILL, DEFAULT_FILL).await,
			center: chord_or_default(app, WIN_SHORTCUT_CENTER, DEFAULT_CENTER).await,
			fullscreen: chord_or_default(app, WIN_SHORTCUT_FULLSCREEN, DEFAULT_FULLSCREEN).await,
		}
	})
}

// 读 shortcut_{key}，空或读失败回退 default
async fn chord_or_default<R: Runtime>(app: &AppHandle<R>, key: i32, default: &str) -> String {
	// store key 格式固定 shortcut_{n}，与前端 setValue(`shortcut_${info.key}`) 一致
	let store_key = format!("shortcut_{key}");
	match get_store_value(app, &store_key).await {
		// 非空 trim 后返回
		Ok(v) if !v.trim().is_empty() => v.trim().to_string(),
		// 读失败或空字符串：用默认值
		_ => default.to_string(),
	}
}
```

**变更摘要**：新增 9 个键 ID 常量 + 9 个默认值 + `MenuAccelHandles` 句柄结构 + `MenuChords`/`load_menu_chords`/`chord_or_default`，统一从 store 读加速键。

### 4.3 store 字符串归一化与运行时改键（`apps/frontend/src-tauri/src/system/menu.rs` · `store_chord_to_accel`/`sync_window_menu_accelerators`）

**对比范围**：新增的归一化函数与同步入口（旧版无对应物）。

**改动后** · `apps/frontend/src-tauri/src/system/menu.rs`（当前，约 L242–L295）

```rust
// store 格式 "Meta + Shift + S" → muda 期望的 "Command+Shift+S"
fn store_chord_to_accel(chord: &str) -> String {
	chord
		// 按 " + " 切分（前端写入时固定用 " + " 连接）
		.split(" + ")
		// 去首尾空白
		.map(str::trim)
		// 丢空段，防 "Meta + + S" 这种异常输入
		.filter(|s| !s.is_empty())
		.map(|s| {
			// 小写化做匹配，原 case 保留输出
			let lower = s.to_lowercase();
			match lower.as_str() {
				// Meta/Super/Command/Cmd 都映射为 muda 的 "Command"
				"meta" | "super" | "command" | "cmd" => "Command".to_string(),
				// Control/Ctrl → "Control"
				"control" | "ctrl" => "Control".to_string(),
				// Alt/Option → "Alt"
				"alt" | "option" => "Alt".to_string(),
				// Shift 直接保留
				"shift" => "Shift".to_string(),
				// 普通键（如 S、F5）原样返回
				_ => s.to_string(),
			}
		})
		// 用 + 连接（muda 期望格式）
		.collect::<Vec<_>>()
		.join("+")
}

// 设置页改键后调用：重读 store 并刷新每个 IconMenuItem 的加速键
pub fn sync_window_menu_accelerators<R: Runtime>(app: &AppHandle<R>) {
	// 从 Tauri State 取句柄，未 manage 则直接返回（防 setup_menu 还没跑完）
	let Some(handles) = app.try_state::<MenuAccelHandles<R>>() else {
		return;
	};
	// 重新读 store（用户刚写入新值）
	let chords = load_menu_chords(app);
	// 9 项逐一 set_accelerator：Some 表示有加速键，None 会清掉
	let _ = handles
		.about
		.set_accelerator(Some(store_chord_to_accel(&chords.about)));
	let _ = handles
		.logout
		.set_accelerator(Some(store_chord_to_accel(&chords.logout)));
	let _ = handles
		.quit
		.set_accelerator(Some(store_chord_to_accel(&chords.quit)));
	let _ = handles
		.minimize
		.set_accelerator(Some(store_chord_to_accel(&chords.minimize)));
	let _ = handles
		.close
		.set_accelerator(Some(store_chord_to_accel(&chords.close)));
	let _ = handles
		.scale
		.set_accelerator(Some(store_chord_to_accel(&chords.scale)));
	let _ = handles
		.fill
		.set_accelerator(Some(store_chord_to_accel(&chords.fill)));
	let _ = handles
		.center
		.set_accelerator(Some(store_chord_to_accel(&chords.center)));
	let _ = handles
		.fullscreen
		.set_accelerator(Some(store_chord_to_accel(&chords.fullscreen)));
}
```

**变更摘要**：新增 `store_chord_to_accel` 写法归一化 + `sync_window_menu_accelerators` 运行时改键入口（被 `command/common.rs::sync_window_menu_shortcuts` 调用）。

### 4.4 macOS 菜单图标统一与系统项剥离（`apps/frontend/src-tauri/src/system/menu.rs` · `macos_apply_uniform_menu_icons`/`macos_strip_edit_system_items`/`is_edit_system_junk_title`/`strip_edit_system_items_now`）

**对比范围**：新增的 macOS 专属函数（旧版无对应物）。

**改动后** · `apps/frontend/src-tauri/src/system/menu.rs`（当前，约 L297–L428）

```rust
// NativeIcon::Info 等是彩色位图，与模板图标视觉尺寸不一致；改用同字号 SF Symbol 模板图
#[cfg(target_os = "macos")]
fn macos_apply_uniform_menu_icons() {
	use objc2::MainThreadMarker;
	use objc2_app_kit::{
		NSApplication, NSFontWeightRegular, NSImage, NSImageSymbolConfiguration,
	};
	use objc2_foundation::{NSSize, NSString};

	// 必须主线程操作 NSApplication
	let Some(mtm) = MainThreadMarker::new() else {
		return;
	};
	let app = NSApplication::sharedApplication(mtm);
	let Some(main_menu) = app.mainMenu() else {
		return;
	};

	// pointSize=14 + Regular 字重 + 偏好单色，菜单栏视觉一致
	let size_cfg =
		NSImageSymbolConfiguration::configurationWithPointSize_weight(14.0, unsafe {
			NSFontWeightRegular
		});
	// 强制单色（template），避免系统暗黑模式色偏
	let mono = NSImageSymbolConfiguration::configurationPreferringMonochrome();
	// 合并两个配置
	let cfg = size_cfg.configurationByApplyingConfiguration(&mono);

	// title → SF Symbol 映射表（与菜单文案一一对应）
	const MAP: &[(&str, &str)] = &[
		("关于应用", "info.circle"),
		("退出登录", "person.circle"),
		("退出应用", "xmark.circle"),
		("关闭窗口", "xmark"),
		("隐藏窗口", "minus"),
		("缩放窗口", "arrow.up.left.and.arrow.down.right"),
		("填充窗口", "rectangle.inset.filled"),
		("居中窗口", "dot.square"),
		("全屏窗口", "arrow.up.left.and.arrow.down.right"),
	];

	// 遍历顶层菜单 → 子菜单 → 每个 item，按 title 匹配换图
	for top in main_menu.itemArray() {
		let Some(sub) = top.submenu() else {
			continue;
		};
		for item in sub.itemArray() {
			let title = item.title().to_string();
			let Some((_, symbol)) = MAP.iter().find(|(t, _)| *t == title.as_str()) else {
				continue;
			};
			// 拿 SF Symbol 基础图
			let Some(base) = NSImage::imageWithSystemSymbolName_accessibilityDescription(
				&NSString::from_str(symbol),
				None,
			) else {
				continue;
			};
			// 应用配置（pointSize + 单色）
			let Some(img) = base.imageWithSymbolConfiguration(&cfg) else {
				continue;
			};
			// 标记为模板图（随系统明暗自适应）
			img.setTemplate(true);
			// 固定 18×18 与 NativeIcon 视觉尺寸一致
			img.setSize(NSSize::new(18.0, 18.0));
			item.setImage(Some(&img));
		}
	}
}

// macOS 会往 Edit 菜单注入「自动填充 / 听写 / 表情」；延后多次剥离（系统可能晚于 set_menu 注入）
#[cfg(target_os = "macos")]
fn macos_strip_edit_system_items() {
	use dispatch2::{DispatchQueue, DispatchTime};

	// 0ns / 50ms / 250ms / 1s 四个延迟点重试，覆盖系统不同注入时机
	for delay_ns in [0_i64, 50_000_000, 250_000_000, 1_000_000_000] {
		let when = DispatchTime::NOW.time(delay_ns);
		let _ = DispatchQueue::main().after(when, || {
			strip_edit_system_items_now();
		});
	}
}

// 判断是否为需要剥离的英文/中文系统项标题
#[cfg(target_os = "macos")]
fn is_edit_system_junk_title(title: &str) -> bool {
	matches!(
		title,
		"AutoFill"
			| "Autofill"
			| "Auto Fill"
			| "自动填充"
			| "Start Dictation..."
			| "Start Dictation…"
			| "开始听写…"
			| "开始听写..."
			| "Emoji & Symbols"
			| "表情与符号"
	)
}

// 实际剥离动作：找编辑子菜单 → 滤出 junk → 逐个 remove → 去末尾多余分隔线
#[cfg(target_os = "macos")]
fn strip_edit_system_items_now() {
	use objc2::MainThreadMarker;
	use objc2_app_kit::NSApplication;

	let Some(mtm) = MainThreadMarker::new() else {
		return;
	};
	let app = NSApplication::sharedApplication(mtm);
	let Some(main_menu) = app.mainMenu() else {
		return;
	};

	// 遍历顶层找标题为「编辑」的子菜单
	for top in main_menu.itemArray() {
		if top.title().to_string() != "编辑" {
			continue;
		}
		let Some(edit) = top.submenu() else {
			continue;
		};
		// 先收集要删的 item（边遍历边删会乱序）
		let junk: Vec<_> = edit
			.itemArray()
			.into_iter()
			.filter(|item| is_edit_system_junk_title(&item.title().to_string()))
			.collect();
		// 逐个 remove
		for item in junk {
			edit.removeItem(&item);
		}
		// 去末尾多余分隔线（系统注入常带尾部分隔线）
		loop {
			let Some(last) = edit.itemArray().into_iter().last() else {
				break;
			};
			if !last.isSeparatorItem() {
				break;
			}
			edit.removeItem(&last);
		}
	}
}
```

**变更摘要**：新增 4 个 macOS 专属函数——`macos_apply_uniform_menu_icons` 用 SF Symbol 模板图替换彩色 `NativeIcon`；`macos_strip_edit_system_items` 在 0/50ms/250ms/1s 四个延迟点调 `strip_edit_system_items_now` 剥离 `AutoFill / Start Dictation / Emoji & Symbols` 中英文变体并去尾部分隔线。

### 4.5 删除 `Hide` 动作与失焦反注册例外（`apps/frontend/src-tauri/src/system/shortcut.rs`）

**对比范围**：`ShortcutActionType` 枚举、`from_key` 映射、`setup_global_shortcut` 失焦分支。

**改动前** · `apps/frontend/src-tauri/src/system/shortcut.rs`（基线，约 L10–L34 + L130–L156）

```rust
// 旧枚举：含 Hide（key=1）与 HideOrShowApp（key=2）两个语义重叠项
#[derive(Debug, Clone, Copy, PartialEq)]
pub enum ShortcutActionType {
    // 旧 Hide：仅隐藏主窗，与 window_close 功能重叠
    Hide,
    Reload,
    NewWorkflow,
    OpenSubWindow,
    HideOrShowApp,
}

impl ShortcutActionType {
    fn from_key(key: i32) -> Option<Self> {
        match key {
            // 1 → Hide（已删，与 window_close 重叠）
            1 => Some(ShortcutActionType::Hide),
            2 => Some(ShortcutActionType::HideOrShowApp),
            3 => Some(ShortcutActionType::Reload),
            4 => Some(ShortcutActionType::NewWorkflow),
            5 => Some(ShortcutActionType::OpenSubWindow),
            _ => None,
        }
    }
}

// 旧失焦分支：失焦时无差别反注册全部快捷键，导致 HideOrShowApp 也在失焦后失效
window.on_window_event(move |event| match event {
    tauri::WindowEvent::Focused(focused) => {
        if *focused {
            // 聚焦：注册全部
            for shortcut_action in &shortcut_actions {
                let _ = app_handle
                    .global_shortcut()
                    .register(shortcut_action.shortcut.clone());
            }
        } else {
            // 失焦：反注册全部（含 HideOrShowApp，bug）
            for shortcut_action in &shortcut_actions {
                let _ = app_handle
                    .global_shortcut()
                    .unregister(shortcut_action.shortcut.clone());
            }
        }
    }
    _ => {}
});
```

**改动后** · `apps/frontend/src-tauri/src/system/shortcut.rs`（当前，约 L10–L15 + L23–L33 + L130–L157）

```rust
// 新枚举：删 Hide，只保留 4 个全局动作
#[derive(Debug, Clone, Copy, PartialEq)]
pub enum ShortcutActionType {
    // Hide 已删：与 window_close 重叠
    Reload,
    NewWorkflow,
    OpenSubWindow,
    HideOrShowApp,
}

impl ShortcutActionType {
    fn from_key(key: i32) -> Option<Self> {
        match key {
            // 1 已废弃（旧 Hide），不再映射
            2 => Some(ShortcutActionType::HideOrShowApp),
            3 => Some(ShortcutActionType::Reload),
            4 => Some(ShortcutActionType::NewWorkflow),
            5 => Some(ShortcutActionType::OpenSubWindow),
            _ => None,
        }
    }
}

// 新失焦分支：HideOrShowApp 跳过反注册，确保应用不在前台时也能呼出
window.on_window_event(move |event| match event {
    tauri::WindowEvent::Focused(focused) => {
        if *focused {
            // 聚焦：注册全部
            for shortcut_action in &shortcut_actions {
                let _ = app_handle
                    .global_shortcut()
                    .register(shortcut_action.shortcut.clone());
            }
        } else {
            // 失焦：反注册，但 HideOrShowApp 例外
            for shortcut_action in &shortcut_actions {
                let modifiers = shortcut_action.shortcut.mods;
                let code = shortcut_action.shortcut.key;

                // 查 SHORTCUT_KEY_MAPPING 看这个组合键映射到哪个动作
                if let Ok(mapping) = SHORTCUT_KEY_MAPPING.lock() {
                    if let Some(&action_type) = mapping.get(&(modifiers, code)) {
                        // HideOrShowApp 跳过：它本身就是「应用不在前台时呼出」
                        if action_type == ShortcutActionType::HideOrShowApp {
                            continue;
                        }
                    }
                }

                // 其它动作失焦即反注册，避免抢占其他 App 同组合键
                let owned_shortcut = shortcut_action.shortcut.clone();
                let _ = app_handle.global_shortcut().unregister(owned_shortcut);
            }
        }
    }
    _ => {}
});
```

**变更摘要**：删 `ShortcutActionType::Hide` 与 `from_key(1)` 映射；失焦反注册分支加 `HideOrShowApp` 跳过逻辑（查 `SHORTCUT_KEY_MAPPING` 判断动作类型）。

### 4.6 新增同步命令 + reload 顺带同步（`apps/frontend/src-tauri/src/command/common.rs`）

**对比范围**：新增 `sync_window_menu_shortcuts` + `reload_all_shortcuts` 末尾追加同步。

**改动前** · `apps/frontend/src-tauri/src/command/common.rs`（基线，约 L141–L160）

```rust
// 旧 reload_all_shortcuts：只重注册全局热键，不刷新菜单加速键
#[tauri::command]
pub fn reload_all_shortcuts(app: tauri::AppHandle) -> Result<(), String> {
    // 关闭处理开关，防 unregister/register 期间误触发
    SHORTCUT_HANDLING_ENABLED.store(false, Ordering::SeqCst);

    // 清空所有已注册全局热键
    let _ = app.global_shortcut().unregister_all();

    // 重新读 store + 注册
    let shortcut_actions = load_shortcuts_from_store(&app);

    for shortcut_action in &shortcut_actions {
        let _ = app
            .global_shortcut()
            .register(shortcut_action.shortcut.clone());
    }

    // 重新打开处理开关
    SHORTCUT_HANDLING_ENABLED.store(true, Ordering::SeqCst);
    Ok(())
}
```

**改动后** · `apps/frontend/src-tauri/src/command/common.rs`（当前，约 L134–L171）

```rust
// 新增命令：仅同步菜单加速键（设置页 pageOnly 改键后调用，不重注册全局热键）
#[tauri::command]
pub fn sync_window_menu_shortcuts(app: tauri::AppHandle) -> Result<(), String> {
	// 委托给 menu.rs 的同步函数：重读 store + set_accelerator 9 项
	crate::system::menu::sync_window_menu_accelerators(&app);
	Ok(())
}

// 改造后的 reload_all_shortcuts：顺带同步菜单加速键
#[tauri::command]
pub fn reload_all_shortcuts(app: tauri::AppHandle) -> Result<(), String> {
	// 关闭处理开关，防 unregister/register 期间误触发
	SHORTCUT_HANDLING_ENABLED.store(false, Ordering::SeqCst);

	// 清空所有已注册全局热键
	let _ = app.global_shortcut().unregister_all();

	// 重新读 store + 注册
	let shortcut_actions = load_shortcuts_from_store(&app);

	for shortcut_action in &shortcut_actions {
		let _ = app
			.global_shortcut()
			.register(shortcut_action.shortcut.clone());
	}

	// 新增：顺带同步菜单加速键（用户改了全局键可能也改了菜单键）
	crate::system::menu::sync_window_menu_accelerators(&app);

	// 重新打开处理开关
	SHORTCUT_HANDLING_ENABLED.store(true, Ordering::SeqCst);
	Ok(())
}
```

**变更摘要**：新增 `sync_window_menu_shortcuts` 命令（仅刷新菜单加速键）；`reload_all_shortcuts` 在重注册全局热键后追加 `sync_window_menu_accelerators` 调用。

### 4.7 命令注册（`apps/frontend/src-tauri/src/lib.rs`）

**对比范围**：`use` 导入 + `invoke_handler` 注册。

**改动前** · `apps/frontend/src-tauri/src/lib.rs`（基线，约 L24–L27 + L91）

```rust
// 旧 use：未导入 sync_window_menu_shortcuts
use command::common::{
    clear_all_shortcuts, clear_updater_cache, disable_auto_start, enable_auto_start,
    get_cache_size, greet_name, is_auto_start_enabled, register_shortcut, reload_all_shortcuts,
    read_english_learning_import_json_file, select_directory, select_file,
    select_english_learning_import_json_file,
};
// ... invoke_handler 旧列表（无 sync_window_menu_shortcuts）
    reload_all_shortcuts,
```

**改动后** · `apps/frontend/src-tauri/src/lib.rs`（当前，约 L24–L28 + L93–L95）

```rust
// 新 use：追加 sync_window_menu_shortcuts
use command::common::{
    clear_all_shortcuts, clear_updater_cache, disable_auto_start, enable_auto_start,
    get_cache_size, greet_name, is_auto_start_enabled, register_shortcut, reload_all_shortcuts,
    read_english_learning_import_json_file, select_directory, select_file,
    select_english_learning_import_json_file, sync_window_menu_shortcuts,
};
// ... invoke_handler 注册新命令
    reload_all_shortcuts,
    // 同步窗口菜单加速键（设置页改键后调用）
    sync_window_menu_shortcuts,
```

**变更摘要**：`use` 追加 `sync_window_menu_shortcuts`；`invoke_handler` 列表新增 `sync_window_menu_shortcuts`。

### 4.8 前端配置：`syncWindowMenu` 字段 + 键 ID 表 + 8 项菜单键（`apps/frontend/src/views/setting/system/config.ts`）

**对比范围**：`ShortcutSettingItem` 类型、`WINDOW_SHORTCUT_KEYS`/`FILE_SHORTCUT_KEYS`、`DEFAULT_INFO`（删 `hide` 改 `window_close` + 新增 8 项）。

**改动前** · `apps/frontend/src/views/setting/system/config.ts`（基线，约 L6–L60）

```typescript
// 旧 ShortcutSettingItem：无 syncWindowMenu 字段
export type ShortcutSettingItem = {
	labelKey: string;
	label: string;
	key: number;
	id: string;
	shortcut: string;
	defaultShortcut: string;
	placeholder: string;
	action: string;
	// 旧只有 registerGlobally：true 走 Rust 全局注册，false 仅写 store
	registerGlobally?: boolean;
};

// 旧 DEFAULT_INFO 第一项：hide（key=1，action=hide，registerGlobally=true）
export const DEFAULT_INFO: ShortcutSettingItem[] = [
	{
		labelKey: 'setting.system.shortcuts.item.hide',
		label: '隐藏程序',
		key: 1,
		id: 'shortcut',
		shortcut: '',
		// 旧默认 "Command + W"，与 window_close 重叠
		defaultShortcut: 'Command + W',
		placeholder: '按键盘输入快捷键',
		action: 'hide',
		// 旧 hide 走全局注册
		registerGlobally: true,
	},
	{
		// ... hideOrShowApp（key=2）等其它项不变
	},
	// ... reload 等剩余项
];
```

**改动后** · `apps/frontend/src/views/setting/system/config.ts`（当前，约 L6–L73 + L76–L172）

```typescript
// 新 ShortcutSettingItem：加 syncWindowMenu 字段
export type ShortcutSettingItem = {
	labelKey: string;
	label: string;
	key: number;
	id: string;
	shortcut: string;
	defaultShortcut: string;
	placeholder: string;
	action: string;
	/**
	 * true（默认）：绑定后调用 Tauri 注册全局快捷键；
	 * false：仅写入 store，由具体页面（如知识库）在窗口内监听。
	 */
	registerGlobally?: boolean;
	/** 写入 store 后同步到窗口菜单右侧加速键 */
	syncWindowMenu?: boolean;
};

/** 与 Rust menu.rs 中 WIN_SHORTCUT_* / FILE_SHORTCUT_* 对齐 */
export const WINDOW_SHORTCUT_KEYS = {
	// minimize=25，与 Rust WIN_SHORTCUT_MINIMIZE 对齐
	minimize: 25,
	// close=26
	close: 26,
	// scale=27
	scale: 27,
	// fill=28
	fill: 28,
	// center=29
	center: 29,
	// fullscreen=30
	fullscreen: 30,
} as const;

export const FILE_SHORTCUT_KEYS = {
	// about=31
	about: 31,
	// logout=32
	logout: 32,
	// quit=33
	quit: 33,
} as const;

export const DEFAULT_INFO: ShortcutSettingItem[] = [
	{
		// 第一项由 hide 改为 window_close：关闭窗口
		labelKey: 'setting.system.shortcuts.item.window.close',
		label: '关闭窗口',
		// key 用 WINDOW_SHORTCUT_KEYS.close（26），不再硬编码
		key: WINDOW_SHORTCUT_KEYS.close,
		id: 'shortcut',
		shortcut: '',
		// 默认 "Meta + W"（与 store_chord_to_accel 归一化为 Command+W）
		defaultShortcut: 'Meta + W',
		placeholder: '按键盘输入快捷键',
		action: 'window_close',
		// close 不走全局注册（菜单项自带 accelerator，由系统分发）
		registerGlobally: false,
		// 但要同步菜单加速键
		syncWindowMenu: true,
	},
	{
		// ... hideOrShowApp（key=2）保持不变
	},
	// ... reload（key=3）保持不变
	{
		labelKey: 'setting.system.shortcuts.item.window.scale',
		label: '缩放窗口',
		key: WINDOW_SHORTCUT_KEYS.scale,
		id: 'shortcut',
		shortcut: '',
		defaultShortcut: 'Meta + Shift + S',
		placeholder: '按键盘输入快捷键',
		action: 'window_scale',
		registerGlobally: false,
		syncWindowMenu: true,
	},
	{
		labelKey: 'setting.system.shortcuts.item.window.minimize',
		label: '隐藏窗口',
		key: WINDOW_SHORTCUT_KEYS.minimize,
		id: 'shortcut',
		shortcut: '',
		defaultShortcut: 'Meta + M',
		placeholder: '按键盘输入快捷键',
		action: 'window_minimize',
		registerGlobally: false,
		syncWindowMenu: true,
	},
	{
		labelKey: 'setting.system.shortcuts.item.window.fill',
		label: '填充窗口',
		key: WINDOW_SHORTCUT_KEYS.fill,
		id: 'shortcut',
		shortcut: '',
		defaultShortcut: 'Meta + Shift + F',
		placeholder: '按键盘输入快捷键',
		action: 'window_fill',
		registerGlobally: false,
		syncWindowMenu: true,
	},
	{
		labelKey: 'setting.system.shortcuts.item.window.center',
		label: '居中窗口',
		key: WINDOW_SHORTCUT_KEYS.center,
		id: 'shortcut',
		shortcut: '',
		defaultShortcut: 'Meta + Shift + C',
		placeholder: '按键盘输入快捷键',
		action: 'window_center',
		registerGlobally: false,
		syncWindowMenu: true,
	},
	{
		labelKey: 'setting.system.shortcuts.item.window.fullscreen',
		label: '全屏窗口',
		key: WINDOW_SHORTCUT_KEYS.fullscreen,
		id: 'shortcut',
		shortcut: '',
		defaultShortcut: 'Control + Meta + F',
		placeholder: '按键盘输入快捷键',
		action: 'window_fullscreen',
		registerGlobally: false,
		syncWindowMenu: true,
	},
	{
		labelKey: 'setting.system.shortcuts.item.file.about',
		label: '关于应用',
		key: FILE_SHORTCUT_KEYS.about,
		id: 'shortcut',
		shortcut: '',
		defaultShortcut: 'Meta + Shift + A',
		placeholder: '按键盘输入快捷键',
		action: 'file_about',
		registerGlobally: false,
		syncWindowMenu: true,
	},
	{
		labelKey: 'setting.system.shortcuts.item.file.logout',
		label: '退出登录',
		key: FILE_SHORTCUT_KEYS.logout,
		id: 'shortcut',
		shortcut: '',
		defaultShortcut: 'Meta + Shift + L',
		placeholder: '按键盘输入快捷键',
		action: 'file_logout',
		registerGlobally: false,
		syncWindowMenu: true,
	},
	{
		labelKey: 'setting.system.shortcuts.item.file.quit',
		label: '退出应用',
		key: FILE_SHORTCUT_KEYS.quit,
		id: 'shortcut',
		shortcut: '',
		defaultShortcut: 'Meta + Q',
		placeholder: '按键盘输入快捷键',
		action: 'file_quit',
		registerGlobally: false,
		syncWindowMenu: true,
	},
	// ... 知识库等剩余项
];
```

**变更摘要**：`ShortcutSettingItem` 加 `syncWindowMenu?: boolean`；新增 `WINDOW_SHORTCUT_KEYS`/`FILE_SHORTCUT_KEYS` 常量；`DEFAULT_INFO` 删 `hide`（key=1）改为 `window_close`（key=26），并补 8 项菜单键（scale/minimize/fill/center/fullscreen/about/logout/quit），全部 `registerGlobally: false, syncWindowMenu: true`。

### 4.9 设置页改键分发与动作分组（`apps/frontend/src/views/setting/system/index.tsx`）

**对比范围**：`pageOnly` 分支 + `appVisibilityActions` 分组集合。

**改动前** · `apps/frontend/src/views/setting/system/index.tsx`（基线，约 L147 + L384–L390）

```typescript
/** 知识库等：只写 store，由页面内 keydown 响应，不占用全局快捷键 */
if (pageOnly) {
	void (async () => {
		await setValue(`shortcut_${info.key}`, shortcuts);
		setShortcutInfo((prev) =>
			prev.map((item) =>
				item.key === activeKey
					? { ...item, shortcut: shortcuts, defaultShortcut: shortcuts }
					: item,
			),
		);
		window.dispatchEvent(
			new CustomEvent(KNOWLEDGE_SHORTCUTS_CHANGED_EVENT),
		);
		// 旧版 pageOnly 写完 store 就结束，不同步菜单加速键
	})();
	return;
}

// ... 后面 appVisibilityActions 旧集合
const appVisibilityActions = new Set([
	// 旧 hide 已删
	'hide',
	'hideOrShowApp',
	'reload',
]);
```

**改动后** · `apps/frontend/src/views/setting/system/index.tsx`（当前，约 L147–L166 + L387–L397）

```typescript
/** 知识库等：只写 store；窗口菜单项还需同步菜单加速键 */
if (pageOnly) {
	void (async () => {
		// 写 store（shortcut_{n}），Rust 菜单与页面键都从这读
		await setValue(`shortcut_${info.key}`, shortcuts);
		// 更新 UI 状态
		setShortcutInfo((prev) =>
			prev.map((item) =>
				item.key === activeKey
					? { ...item, shortcut: shortcuts, defaultShortcut: shortcuts }
					: item,
			),
		);
		// 通知知识库等页面键已变（监听 KNOWLEDGE_SHORTCUTS_CHANGED_EVENT）
		window.dispatchEvent(
			new CustomEvent(KNOWLEDGE_SHORTCUTS_CHANGED_EVENT),
		);
		// 新增：若是菜单项，调 Rust 同步菜单加速键
		if (info.syncWindowMenu && isTauriRuntime()) {
			void desktopInvoke('sync_window_menu_shortcuts');
		}
	})();
	return;
}

// ... 后面 appVisibilityActions 新集合（删 hide，加 9 个 window_/file_ 动作）
const appVisibilityActions = new Set([
	// hide 已删，hideOrShowApp 保留
	'hideOrShowApp',
	'reload',
	// 9 个菜单动作加入分组，设置页按「应用显示/刷新相关」归类展示
	'window_close',
	'window_scale',
	'window_minimize',
	'window_fill',
	'window_center',
	'window_fullscreen',
	'file_about',
	'file_logout',
	'file_quit',
]);
```

**变更摘要**：`pageOnly` 分支新增 `info.syncWindowMenu && isTauriRuntime()` 时调 `sync_window_menu_shortcuts`；`appVisibilityActions` 集合删 `'hide'`，追加 9 个 `window_*`/`file_*` 动作。

## 5. 兼容性与影响

- **旧 `shortcut_1`（hide）**：`from_key(1)` 不再映射，旧用户 store 里的 `shortcut_1` 会被忽略；功能由 `shortcut_26`（window_close）替代，无破坏性体验损失。
- **跨平台**：`macos_apply_uniform_menu_icons`/`macos_strip_edit_system_items` 用 `#[cfg(target_os = "macos")]` 隔离，Linux/Windows 编译不受影响。
- **`reload_all_shortcuts` 行为变化**：现在会顺带调 `sync_window_menu_accelerators`，对仅改全局键的用户无副作用（菜单键未变时 `set_accelerator` 写回相同值）。
- **回归点**：①设置页改任意菜单键后菜单右侧加速键是否立即更新；②macOS Edit 菜单是否还有 `AutoFill/Dictation/Emoji`；③失焦后按 `HideOrShowApp`（默认 ⌘⇧H）能否唤回主窗；④`reload_all_shortcuts` 后菜单加速键是否仍正确。

## 6. 相关源码路径

| 说明 | 路径 |
| ---- | ---- |
| 菜单构建 + 同步 + macOS 系统项 | `apps/frontend/src-tauri/src/system/menu.rs` |
| 全局快捷键 + 失焦反注册 | `apps/frontend/src-tauri/src/system/shortcut.rs` |
| 同步命令 + reload 顺带同步 | `apps/frontend/src-tauri/src/command/common.rs` |
| 命令注册 | `apps/frontend/src-tauri/src/lib.rs` |
| 前端配置（键 ID + syncWindowMenu） | `apps/frontend/src/views/setting/system/config.ts` |
| 设置页改键分发 | `apps/frontend/src/views/setting/system/index.tsx` |

---

（若与仓库最新源码不一致，以源码为准）
