# Monaco 编辑器在 Tauri / WebView 下的显式布局（容器缩放与全屏恢复）

本文记录：**为何**在 Tauri 中窗口从全屏/最大化回到默认尺寸后，Monaco 编辑区宽度会超出容器、内容被遮挡；**完整实现思路**；涉及文件；以及 **`apps/frontend/src/components/design/Monaco/index.tsx`** 中与布局相关代码的**逐行说明**（行号以文档编写时仓库版本为准，重构后请以实际文件为准）。

---

## 1. 现象与根因

### 1.1 现象

- 窗口或容器**变宽**后再**缩回**（例如 Tauri 从占满屏幕回到默认窗口大小时），编辑器**可视区域宽度仍像放大时一样宽**，超出外层容器，右侧内容被裁切或需横向滚动才能看到。

### 1.2 根因（简要）

1. **`automaticLayout: true`（Monaco 默认策略）**  
   Monaco 依赖内部对**容器 DOM** 的测量与 `ResizeObserver`。在 **WebView / Tauri** 中，窗口尺寸动画结束前后，测量或回调**可能滞后**，导致布局仍沿用**缩小前**的宽度。

2. **仅调用无参 `editor.layout()`**  
   无参 `layout()` 仍依赖上述测量链；在异常时机下读到的宽高不可靠。

3. **Flex 子项缺 `min-w-0` / `max-w-full`**  
   子项默认 `min-width: auto`，可能按内容撑开，父级变窄时子项**不跟着收缩**，加剧「溢出感」（与 Monaco 内部宽度叠加）。

### 1.3 对策总览

| 手段 | 作用 |
|------|------|
| `automaticLayout: false` | 关闭 Monaco 自带自动布局，避免与 WebView 不同步的内部测量主导结果 |
| 固定**宿主** div + `ref` | 用**我们选的** DOM 节点的 `clientWidth` / `clientHeight` 作为唯一尺寸来源 |
| `editor.layout({ width, height })` | **显式**把画布尺寸设为宿主像素，强制与容器一致 |
| `ResizeObserver` + `resize` + `visualViewport` + `fullscreenchange` | 多路触发重新 layout；**双 rAF** 照顾窗口动画结束后一帧尺寸才稳定 |
| `useLayoutEffect` + `applyEditorLayoutRef` | `height` / `viewMode` / `isMarkdown` 变化时与挂载逻辑对齐再 layout |
| 宿主 CSS：`min-w-0 max-w-full overflow-hidden contain-[inline-size]` | 约束在父级宽度内，减少 flex 溢出 |

---

## 2. 相关文件

| 文件 | 角色 |
|------|------|
| `apps/frontend/src/components/design/Monaco/index.tsx` | 宿主 ref、`mergedEditorOptions` 覆盖 `automaticLayout`、`onMount` 内监听与 `layout()`、`useLayoutEffect`、JSX 包裹层 |
| `apps/frontend/src/components/design/Monaco/options.ts` | 共享 `options` 仍含 `automaticLayout: true`；**MarkdownEditor 在 `mergedEditorOptions` 中覆盖为 `false`**，其它若直接引用 `options` 不受影响 |

---

## 3. `options.ts` 与覆盖关系（说明）

`options.ts` 第 18 行仍为 `automaticLayout: true`，作为通用默认。  
`index.tsx` 中 `mergedEditorOptions` 使用：

```ts
const base = { ...options, readOnly, automaticLayout: false as const };
```

从而在 **MarkdownEditor 使用的 Editor** 上强制关闭自动布局，改由本节所述逻辑显式 `layout`。

---

## 4. `index.tsx`：Ref 与 `mergedEditorOptions` 逐行说明

| 行号 | 代码（摘录） | 说明 |
|------|----------------|------|
| 514 | `const editorRef = ...` | 保存 Monaco 编辑器实例，供滚动同步、layout 等使用。 |
| 515–516 | `editorHostRef` 注释 | 宿主容器 ref：测量 client 尺寸，避免全屏恢复后沿用旧宽度。 |
| 516 | `useRef<HTMLDivElement \| null>(null)` | 包裹 `@monaco-editor/react` 的外层 div 引用。 |
| 517–518 | `applyEditorLayoutRef` 注释 | 保存「按宿主 layout」的函数，供 React 生命周期在 onMount 外调用。 |
| 518 | `useRef<(() => void) \| null>(null)` | 初始为 null，在 `handleEditorMount` 内赋值。 |
| 588–601 | `mergedEditorOptions` | 合并只读、占位、markdown wordWrap 等。 |
| 589 | 注释 | 说明为何在 WebView/Tauri 下关闭 automaticLayout。 |
| 590 | `automaticLayout: false as const` | **核心**：禁用 Monaco 内部自动布局，改用手动 `layout({width,height})`。 |
| 591–598 | markdown 分支 | 附加 placeholder、wordWrap、wordWrapColumn。 |
| 600 | 非 markdown | 仅 base + placeholder。 |

---

## 5. `useLayoutEffect`（height / viewMode / isMarkdown）逐行说明

| 行号 | 说明 |
|------|------|
| 648 | 注释：容器高度或 Markdown 视图切换后强制 layout。 |
| 649 | `useLayoutEffect`：在浏览器绘制前执行，减少闪动。 |
| 650–653 | `run`：调用 `applyEditorLayoutRef.current?.()`，再在下一帧再调一次（与挂载时双 rAF 策略一致）。 |
| 654 | `queueMicrotask(run)`：等当前 commit/DOM 更新后再测尺寸。 |
| 655 | 依赖 `[height, viewMode, isMarkdown]`：高度 prop 或编辑/预览/分屏切换时重跑。 |

---

## 6. `handleEditorMount` 内布局逻辑逐行说明

| 行号 | 说明 |
|------|------|
| 865 | 挂载时把当前 editor 赋给 `editorRef`。 |
| 867–868 | `applyEditorLayoutFromHost`：按宿主显式 layout 的闭包。 |
| 869–871 | `host`：优先 `editorHostRef.current`，否则退回 `editor.getDomNode()?.parentElement`（兼容未包宿主时的兜底）。 |
| 872–875 | 无 host 时退化为无参 `editor.layout()`。 |
| 876–877 | 取宿主 `clientWidth` / `clientHeight` 并向下取整。 |
| 878–882 | 宽高均大于 0 时 `editor.layout({ width: w, height: h })`，否则无参 layout。 |
| 884 | 把闭包挂到 `applyEditorLayoutRef`，供 `useLayoutEffect` 使用。 |
| 886 | `layoutRaf`：合并高频 resize 回调。 |
| 887–895 | `scheduleEditorLayout`：取消上一帧请求 → rAF 内调用一次 `applyEditorLayoutFromHost` → **再嵌套一帧**再调一次（窗口动画后尺寸稳定）。 |
| 897–899 | `layoutHost`：与上面 host 选择逻辑一致，供 ResizeObserver 观察。 |
| 900–904 | 存在 `ResizeObserver` 与 `layoutHost` 时，监听宿主尺寸变化并 `scheduleEditorLayout`。 |
| 905–906 | `window.resize`：Tauri 改窗口大小时常见入口。 |
| 907–909 | `visualViewport` 的 `resize`：部分移动端/WebView 缩放场景。 |
| 910–911 | `fullscreenchange`：浏览器全屏 API 进出时补一刀。 |
| 913 起 | 快捷键、剪贴板等（与布局无直接关系）。 |
| 1022–1029 | IME `compositionend` 后双 rAF 调用 `applyEditorLayoutFromHost`（替代原先无参 `layout`），避免合成结束后测量仍旧。 |
| 1073–1082 | `layoutCleanup`：dispose 时断开 Observer、移除 window/vv/document 监听、取消 `layoutRaf`。 |
| 1082 | `disposables.push(layoutCleanup)`：与编辑器其它订阅一并释放。 |
| 1084–1095 | `onDidDispose`：清空 `applyEditorLayoutRef`、取消各 rAF、遍历 `disposables`（含 layout 清理）。 |
| 1112–1115 | 挂载末尾 `queueMicrotask` + 内层 `requestAnimationFrame` 再 `applyEditorLayoutFromHost`：首屏布局与 DOM 对齐。 |

---

## 7. JSX：宿主包裹与 `Editor` 逐行说明

### 7.1 仅编辑模式 / 非 Markdown（约 1179–1201 行）

| 行号 | 说明 |
|------|------|
| 1179–1182 | 外层 `style={{ height }}` 的容器：`min-w-0 max-w-full overflow-hidden`，保证纵向高度由 props 控制且横向可收缩。 |
| 1183 | 条件：`!isMarkdown \|\| viewMode === 'edit'` 时渲染编辑器。 |
| 1184–1187 | **宿主 div**：`ref={editorHostRef}`；`box-border`；`h-full min-h-0 min-w-0 max-w-full w-full`；`overflow-hidden`；`contain-[inline-size]` 限制子级沿行向撑破。 |
| 1188–1200 | `Editor`：`height={height}`、`width="100%"`，与宿主同宽；`options={mergedEditorOptions}` 含 `automaticLayout: false`。 |

### 7.2 分屏左栏编辑器（约 1225–1243 行）

| 行号 | 说明 |
|------|------|
| 1225 | 外层 flex 列，保证 ResizablePanel 内占满高度。 |
| 1226–1229 | 与 7.1 相同的宿主 div + `editorHostRef` + 样式类。 |
| 1230–1242 | `Editor`：`height="100%"`、`width="100%"`，在分栏内填满宿主。 |

**说明**：编辑模式与分屏模式**互斥**挂载，共用同一个 `editorHostRef`；切换视图时 ref 会挂到当前可见的宿主上。

---

## 8. 维护与注意事项

1. **行号漂移**：重构 `index.tsx` 后，本文档中的行号需人工或脚本同步更新。  
2. **若恢复 `automaticLayout: true`**：可能与显式 `layout({width,height})` 叠加产生竞态，一般**不要**在 MarkdownEditor 上同时开启。  
3. **父级布局**：知识库等页面应为 `MarkdownEditor` 提供 `className="... min-w-0 max-w-full ..."`，保证 flex 链上每一环都能收缩。  
4. **性能**：`scheduleEditorLayout` 已用 rAF 合并；ResizeObserver 回调仍可能较频，若需可再加节流（当前以正确性优先）。

---

## 9. 小结

- **问题**：Tauri/WebView 下窗口缩小后 Monaco 仍像「宽屏」布局，内容溢出容器。  
- **做法**：对本组件 **关闭 `automaticLayout`**，用 **宿主 `clientWidth`/`clientHeight`** 调用 **`editor.layout({ width, height })`**，并用 **ResizeObserver + window + visualViewport + fullscreenchange + useLayoutEffect** 多时机触发，**双 rAF** 覆盖窗口动画结束后的稳定帧。  
- **配套**：宿主 **ref + CSS（min-w-0、max-w-full、overflow-hidden、contain-inline-size）** + **`Editor` `width="100%"`**。

以上与当前 `Monaco/index.tsx` 实现一致；若后续改动布局策略，请同步更新本文档。

---

## 10. 参见

- **粘性滚动条背景**（`defineTheme` 与全局 CSS、`--theme-color` 与背景 token、Diff 内嵌编辑器）：[`Markdown分屏差异对比.md`](./Markdown分屏差异对比.md) 第 **13** 节
