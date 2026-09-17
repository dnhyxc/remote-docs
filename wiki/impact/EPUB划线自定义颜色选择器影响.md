# EPUB 划线自定义色与 ColorPicker — 影响点分析

## 延伸阅读

- [EPUB划线自定义颜色.md](../ebook/EPUB划线自定义颜色.md) — 实现说明与改动前后代码对比
- [developer/EPUB用户划线开发.md](../ebook/developer/EPUB用户划线开发.md) — 用户划线主手册（仍写「五色」，见 §7）
- [EPUB PopBar性能体验.md](../ebook/EPUB PopBar性能体验.md) — PopBar 防闪烁与 sync 增量
- [EPUB想法用户划线重叠.md](../ebook/EPUB想法用户划线重叠.md) — 想法虚线与用户划线叠加
- [EPUB听书背景与注释影响.md](./EPUB听书背景与注释影响.md) — 播放背景 vs 用户划线 DOM 隔离

## 1. 分析目的

评估 **EPUB PopBar 样式条新增自定义色 ColorPicker + 服务端/前端支持 `#rrggbb` / `#rrggbbaa`** 相关改动，是否改变或破坏已有功能：

- PopBar **五色预设**（粉/紫/蓝/绿/黄）与 **三色样式**（高亮/直线下划线/波浪线）
- 划线 **新建 / 改色 / 删除 / 重叠合并**（以最后一次 style/color 为准）
- **想法虚线** 与用户划线 **共存**、restack、blocker 扣线
- **听书 / 听当前** 播放背景与用户划线 **DOM 隔离**
- 划线 **登录同步**、annotation sync、分栏 resize 后 patch
- 想法侧栏引用区 **划线展示** 与 PopBar 对齐
- 通用 `@/components/ui` 组件导出（`ColorPicker` 可被其它模块复用）

**阅读约定**：「历史风险」指旧实现曾出现的问题，不代表现行代码仍会触发。

**改动范围（当前 diff）**：

| 文件 | 变更 |
|------|------|
| `apps/frontend/src/components/ui/color-picker.tsx` | **新增** Ant Design 风格取色器（饱和度区、色相/透明度、HEX/RGB；松手/失焦/Enter 提交） |
| `apps/frontend/src/components/ui/index.tsx` | 导出 `ColorPicker` 及颜色工具类型 |
| `apps/frontend/src/views/ebook/components/selection/EpubHighlightStyleBar.tsx` | 预设五色后增加 ColorPicker 自定义色按钮 |
| `apps/frontend/src/views/ebook/components/selection/EpubSelectionPopBar.tsx` | `onMouseDown` 对 input/textarea/select/嵌套 Popover 白名单，避免阻断取色器输入 |
| `apps/frontend/src/views/ebook/utils/epub/mark/epubUserHighlights.ts` | `EpubHighlightColorId` 扩展；`resolveHighlightPalette` / `normalizeHighlightColor` / localStorage 上次自定义色 |
| `apps/frontend/src/views/ebook/read.tsx` | `highlightUpsertQueueRef` 串行 upsert；`onHighlightColorChange` 持久化自定义色 |
| `apps/frontend/src/views/ebook/components/thought/EpubThoughtParts.tsx` | 引用区展示改用 `resolveHighlightPalette` |
| `apps/frontend/src/views/ebook/types.ts` | `EpubHighlightPresetColorId` 与 `EpubHighlightColorId` 联合类型 |
| `apps/backend/src/services/ebook/dto/create-ebook-highlight.dto.ts` | `EBOOK_HIGHLIGHT_COLOR_PATTERN`（预设 + 6/8 位 hex） |
| `apps/backend/src/services/ebook/dto/update-ebook-highlight.dto.ts` | `color` 校验同上 |
| `apps/backend/src/services/ebook/ebook.service.ts` | `EbookHighlightDto.color` 类型放宽为 `string` |
| `apps/frontend/src/i18n/locales/zh-CN.ts`、`en-US.ts` | `ebook.read.selectionPop.customColor` |

**结论摘要**：

| 维度 | 是否影响原有功能 | 说明 |
|------|------------------|------|
| 五色预设划线 | **否** | `EPUB_HIGHLIGHT_COLOR_OPTIONS` 与 `COLOR_BY_ID` 未改色值；点击预设仍走 `onColorChange(option.id)` |
| 三色样式切换 | **否** | `EpubHighlightStyleBar` 左侧样式区逻辑未变 |
| PopBar 划线 / 删除 / 合并 | **否** | `upsertHighlightForQuote` 合并与 CFI 逻辑未改；仅 `color` 可为 hex |
| PopBar 交互（选区保持） | **有条件变化** | `onMouseDown` 对白名单内元素不再 `preventDefault`，以便 ColorPicker 内 RGB 输入可聚焦 |
| 自定义色 + 透明度 | **是（新增）** | 样式条第 6 个入口；`color` 可存 `#rrggbbaa`，每条划线透明度独立 |
| 连续拖色 API 竞态 | **低（修复）** | 改前快速改色可能并发 upsert 报「划线不存在」；改后 `highlightUpsertQueueRef` 串行 |
| 想法虚线共存 / restack | **否** | 未改 `epubThoughtAnnotations` / blocker；仅用户 mark 的 fill/stroke 解析路径扩展 |
| 听书 / 听当前播放背景 | **无** | 未触达 `epubListenSegmentOverlay` |
| 想法侧栏引用色块展示 | **低（增强）** | 自定义色由 `resolveHighlightPalette` 渲染，改前 `COLOR_BY_ID[hex]` 为 `undefined` |
| 后端划线 API | **有条件变化** | create/update 接受 hex；旧客户端仍只发预设 id，兼容 |
| 非法/未知 `color` 入库 | **低** | 前端 `normalizeHighlightColor` 无法解析时回退 `pink`；后端 DTO 正则拦截非法串 |
| PDF 阅读 | **无** | 无划线入口，未改 PDF 路径 |
| 通用 `ColorPicker` 组件 | **低（新增）** | 仅 EPUB 样式条引用；导出至 `@/components/ui` 供后续复用 |

---

## 2. 改动要点（相对改前行为）

### 2.1 颜色模型：预设 id → 预设 + 自定义 hex

**改前**：

```text
EpubHighlightColorId = 'pink' | … | 'yellow'
DOM / API color 仅为五枚举
patchUserHighlightMarks → COLOR_BY_ID[colorId].fill / stroke
```

**改后**：

```text
EpubHighlightColorId = EpubHighlightPresetColorId | `#rrggbb` | `#rrggbbaa`
resolveHighlightPalette(colorId):
  预设 → 原 COLOR_BY_ID
  自定义 → stroke=#rrggbb；fill 透明度来自末字节或默认 28%
normalizeHighlightColor 解析失败 → 'pink'
```

**动机**：产品需要任意色相；透明度随 **单条划线** `color` 字段持久化，避免全局 localStorage 污染其它自定义色。

### 2.2 PopBar 样式条 — ColorPicker 入口

**改前**：右侧仅 5 个圆形预设色按钮。

**改后**：第 6 个为 `ColorPicker` 触发器（彩虹环 / 当前自定义色 + 勾）；`onChange` → `formatCustomHighlightColor(hex, alpha)` → 与当前 `color` 不同时才 `onColorChange`；`loadEpubHighlightCustomColor` / `saveEpubHighlightCustomColor` 仅记 **上次自定义色**（含 8 位 hex 时含透明度，供下次打开面板默认值）。

**动机**：在 PopBar 内完成取色，不新增独立设置页。

### 2.3 `read.tsx` — upsert 串行队列

**改前**：`upsertHighlightForQuote` 每次调用直接 `async` 执行，快速连续改色可能重叠 DELETE+PATCH 同一 `id`。

**改后**：

```text
highlightUpsertQueueRef.current = highlightUpsertQueueRef.current.then(execute, execute)
```

**动机**：ColorPicker 松手连续提交时保证 API 顺序，消除「划线不存在」类竞态。

### 2.4 PopBar `onMouseDown` 白名单

**改前**：`PopoverContent` 上全局 `e.preventDefault()`，保持 iframe 选区不丢。

**改后**：目标在 `input, textarea, select, [data-slot=popover-content], [data-slot=select-content]` 内则 **不** `preventDefault`。

**动机**：嵌套 Popover 内 ColorPicker 的 RGB 输入需获得焦点；配合 ColorPicker `modal={false}` 减轻焦点陷阱。

### 2.5 后端校验

**改前**：`@IsIn(EBOOK_HIGHLIGHT_COLORS)`。

**改后**：`@Matches(EBOOK_HIGHLIGHT_COLOR_PATTERN)`，允许预设名或 `#` + 6/8 位十六进制。

---

## 3. 影响点矩阵

| 模块 / 场景 | 影响等级 | 分析 |
|-------------|----------|------|
| **PopBar 预设五色** | 无 | 按钮与 `EPUB_HIGHLIGHT_COLOR_OPTIONS` 不变；`active` 判定仍为 `color === option.id` |
| **PopBar 自定义色** | 中（新增） | 新 UI 入口；需登录同步；改色仍走 `onHighlightColorChange` → `upsertSelectionHighlight` |
| **全新选区（未划线）** | 无 | 样式条仍仅在 `selectionHasHighlight` 时展示（`EpubSelectionPopBarPanel` 未改该条件） |
| **点击已有划线改色** | 低 | 同路径 upsert update；自定义色写入 `data-hlColor` 经 `normalizeHighlightColor` |
| **重叠合并** | 低 | 合并后 `color` 取最后一次；可为 hex，与改前「最后写入为准」一致 |
| **正文 SVG mark 绘制** | 低 | `patchUserHighlightMarks` / `buildHighlightStyles` 经 `resolveHighlightPalette` 统一取色 |
| **annotation sync / 增量 patch** | 低 | sync 仍传 `item.color` 字符串；patch 逻辑未改分支，仅 palette 解析扩展 |
| **分栏 resize / soft resize** | 无 | 未改 `epub-split-soft-resize` 链路 |
| **想法虚线** | 无 | 未改 `applyEpubThoughtUnderlines`；用户高亮 blocker 仍按几何扣线 |
| **听书 / 听当前** | 无 | 播放层 `moke-epub-listen-*` 与用户 `moke-epub-user-hl` 仍分离 |
| **想法侧栏引用预览** | 低 | `EpubHighlightedQuoteText` 用 `resolveHighlightPalette`，自定义色可见 |
| **分享书摘 / MK 问书 / 听当前** | 无 | PopBar 底栏动作未改 |
| **后端 GET 划线列表** | 低 | 返回 `color` 可能为 hex；旧版前端若未升级会对 hex 显示异常（本仓库前后端同批发布） |
| **localStorage** | 低 | 新增键 `dnhyxc_epub_highlight_custom_color`；仅影响自定义色按钮默认色，不覆盖预设划线 |
| **`@/components/ui` ColorPicker** | 低 | 新公共组件；当前唯一调用方 `EpubHighlightStyleBar` |
| **i18n** | 低 | 新增 `customColor` 文案键 |

---

## 4. 潜在风险与缓解

| 风险 | 等级 | 说明 | 建议验证 |
|------|------|------|----------|
| 嵌套 Popover 焦点 / 选区丢失 | 中 | PopBar 与 ColorPicker 双层 Popover；已 `modal={false}` + mousedown 白名单 | 打开自定义色 → 编辑 RGB → 拖透明度 → 确认 iframe 选区与 PopBar 仍开 |
| 快速连续改色 API 竞态 | 中（已缓解） | 改前易触发；队列串行 upsert | 按住饱和度区快速拖松多次，观察无「划线不存在」 Toast |
| 服务端非法 color | 低 | 正则拒绝；DB 若有人工脏数据，前端 normalize 回退 pink | Postman 发 `color: '#gggggg'` 应 400 |
| 6 位 hex 与 8 位 hex 混用 | 低 | 6 位默认 28% 填充；8 位按末字节 | 同书一条 6 位、一条 8 位，透明度互不影响 |
| 想法引用展示与正文色差 | 低 | 侧栏用 CSS `backgroundColor`/`textDecorationColor`，正文用 SVG fill/stroke | 自定义色在正文与侧栏目测一致 |
| 旧文档写「仅五色」 | 低 | 产品说明与 dev 手册未同步 | 见 §7 |
| ColorPicker 拖动性能 | 低 | 拖动仅本地预览，提交节流到松手/失焦 | 长段落划线改色时滚动不卡顿 |

---

## 5. 未改动项

| 项 | 说明 |
|----|------|
| `resolveMergedOverlappingHighlight` | CFI/Range 合并规则未改 |
| `epubThoughtAnnotations` / 虚线分组 | 想法层绘制与点击簇逻辑未改 |
| `epubListenSegmentOverlay` | 听读播放背景与用户划线 reconcile 未改 |
| PDF 阅读 | 仍无用户划线 |
| PopBar `highlightToggle` 单槽位 | 划线/删除划线按钮逻辑未改 |
| 预设五色色值 | `rgba` / `stroke` 常量与改前一致 |
| 划线 style 枚举 | `highlight` / `underline` / `wavy` 未扩展 |
| 账号级 sync 时机 | 仍 login 后 pull；upsert/delete 后 setState + apply |

---

## 6. 回归清单

- [ ] 全新选区：仅显示底栏「划线」，**不**显示顶栏样式条
- [ ] 点「划线」默认粉色高亮；预设五色切换正常
- [ ] 打开自定义色：选色 + 调透明度 → 正文 mark 与侧栏引用色一致
- [ ] 两条重叠划线合并后，颜色为最后一次（含自定义 hex）
- [ ] 快速连续拖色/透明度：无保存失败 Toast
- [ ] ColorPicker 内 RGB 输入可聚焦、可编辑
- [ ] 点击已有预设色划线 → 改自定义色 → 再点预设色恢复
- [ ] 删除划线后想法琥珀虚线恢复（若曾有想法）
- [ ] 听当前播放中改色：播放背景与用户划线互不干扰
- [ ] 分栏拖拽后自定义色 mark 仍对齐
- [ ] 刷新 / 重开书籍：自定义色从服务端拉回正确
- [ ] `npx tsc --noEmit`（frontend）

---

## 7. 相关文档滞后

| 文档 | 说明 |
|------|------|
| `docs/项目指南.md` §16.7 | 仍写「粉/紫/蓝/绿/黄 五色可选」，未提及自定义色 |
| `docs/ebook/developer/EPUB用户划线开发.md` | `EpubHighlightColorId` 摘录仍为五枚举；`EpubHighlightStyleBar` 描述为「三色 + 五色」 |
| `docs/ebook/EPUB用户划线实现.md` | 归档索引，指向 dev 手册，同步滞后 |

---

（若与仓库最新源码不一致，以源码为准）
