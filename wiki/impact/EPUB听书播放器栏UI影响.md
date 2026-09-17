# 听书播放条 UI（分句虚拟列表 + 刻度倍速）— 影响点分析

## 延伸阅读

- [EPUB听书播放器栏.md](../ebook/EPUB听书播放器栏.md) — 播放条分句菜单、倍速与 TTS 贯通（改前实现思路）
- [EPUB引用听书播放器栏影响.md](./EPUB引用听书播放器栏影响.md) — 听当前共用播放条、互斥与 `setRate` 接线
- [EPUB滚动听书章节前进影响.md](./EPUB滚动听书章节前进影响.md) — 连续滚动听书与播放条切句
- [云端TTS用户凭据回退影响.md](./云端TTS用户凭据回退影响.md) — 云端 TTS 与 `applyActivePlaybackRate`

**阅读约定**：结论以仓库 **当前源码** 为准；「历史风险」指旧实现曾出现的问题，不代表现行代码仍会触发。

## 1. 分析目的

评估 **听书/听当前底部 `EpubListenPlayerBar` UI 重构**（分句虚拟列表、ScrollArea、滚到当前句、刻度尺倍速面板、列表选中样式）是否改变或破坏已有听读能力。

**对照的既有能力**（来自 `docs/ebook/EPUB听书播放器栏.md`、`useEpubChapterListen` / `useEbookQuoteListen`、`read.tsx`）：

- 听书 / 听当前 **互斥**，共用播放条 props（`status`、`sentenceIndex`、`onGoToSentence`、`setRate` 等）
- 分句菜单：展示 `sentenceLabels`、跳转 `goToSentence`、打开时滚到当前句
- 倍速：`setRate` → `applyActivePlaybackRate`，范围约 **0.75×～3×**（原 `CHAPTER_LISTEN_RATES` 离散档）
- 上一句 / 下一句 / 播放暂停 / 停止
- 听书切句时正文高亮、`forceScroll` / autoFollow（与菜单内滚动 **独立**）
- TTS 连播、句间预取、云端 MP3 倍速

**改动范围（当前 diff）**：

| 文件 | 变更 |
|------|------|
| `apps/frontend/src/views/ebook/components/listen/EpubListenPlayerBar.tsx` | `VirtualSentenceMenuList`（虚拟行 + ScrollArea）；手动滚后「滚到当前句」；`EpubListenRatePanel`（0.5–3× 刻度尺 + 预设）；移除 `CHAPTER_LISTEN_RATES` 网格 |
| `apps/frontend/src/views/ebook/utils/epub/reader/epubReaderSettings.ts` | 分句列表选中/ hover 改为 `bg-theme/15 text-theme`（与 `EbookTocDrawer` 一致） |
| `apps/frontend/src/i18n/locales/zh-CN.ts`、`en-US.ts` | `scrollToCurrentSentence` |

**结论摘要**：

| 维度 | 是否影响原有功能 | 说明 |
|------|------------------|------|
| 播放条对外 props / `read.tsx` 接线 | **否** | 仍消费 `useEpubChapterListen` / `useEbookQuoteListen` 同一套字段 |
| 听书 / 听当前互斥 | **否** | 未改 hook 启动/停止 |
| 分句跳转 `onGoToSentence` | **否** | 菜单项仍 `onSelect(index)` |
| 分句菜单打开时滚到当前句 | **低（增强）** | 仍打开即滚；用户手动滚后 **暂停自动跟随**，需点定位钮恢复 |
| 长章（600+ 句）分句列表 | **低（增强）** | 虚拟列表仅渲染视口行，改前全量 DOM 易卡顿 |
| 倍速数值与 TTS | **有条件变化** | UI 改为 **0.5–3.0、步进 0.1**；原离散档 0.75/1.25/2.25/2.8 等 **无预设**，拖尺可近似 |
| 倍速下限 | **有条件变化** | 可选 **0.5×**（改前网格最低 0.75×） |
| `CHAPTER_LISTEN_RATES` 常量 | **低** | 仍导出自 `useEpubChapterListen.ts`，播放条 UI **不再引用** |
| 云端/本机 TTS `setRate` 实现 | **否** | `speech` / hook 内 `setRate` 未改 |
| 正文高亮 / autoFollow | **否** | 菜单内滚动不调用 `showEpubListenDomRange` |
| 键盘 / 无障碍（分句菜单） | **低** | 虚拟列表 + 绝对定位行；需 spot check 方向键与 `aria-current` |

---

## 2. 改动要点（相对改前行为）

### 2.1 分句列表：`VirtualSentenceMenuList`

**改前**：

```text
ScrollArea 内 map 全部 sentenceLabels → 每句一个 DropdownMenuItem
打开菜单 → useEffect 滚到 activeIndex（依赖 sentenceIndex，切句重复滚）
```

**改后**：

```text
固定行高 40px，按 scrollTop 只渲染视口 ± overscan 行
ScrollArea（对称 bleed + px 内边距）+ 标题行「分句 (i/n)」
打开菜单（仅 menuOpen）→ 强制滚到当前句
听书切句 → 若用户未手动滚列表则跟随；手动滚后停止跟随
userScrolled === true → 显示 LocateFixed，点击恢复跟随并滚到当前句
```

**动机**：长章列表性能；避免用户浏览列表时被听书切句 constantly 拽回当前行。

### 2.2 倍速：`EpubListenRatePanel`

**改前**：

```text
DropdownMenu 2 列网格，CHAPTER_LISTEN_RATES（0.75, 1, 1.25, …, 3）
按钮文案「1 X」
```

**改后**：

```text
大号当前倍速 + 刻度尺（短刻度 0.1、长刻度每 0.5，5 格/4 短线）
pointer 拖拽吸附刻度 index；预设 1 / 1.5 / 2 / 2.5 / 3
范围 0.5–3.0；指示器 teal-500；下拉宽约 w-80
仍调用 onRateChange(number) → 既有 setRate
```

**动机**：对齐产品设计稿；细粒度 0.1 步进；边界 0.5/3.0 可拖选。

### 2.3 列表选中样式（`epubReaderSettings`）

**改前**：`bg-textcolor/12` 中性灰底选中。

**改后**：`bg-theme/15 text-theme`（与目录抽屉一致）。

**影响面**：当前 **仅** `EpubListenPlayerBar` 分句项引用这两枚 class；其它 chrome 下拉未共用。

---

## 3. 影响点矩阵

| 模块 / 场景 | 影响等级 | 分析 |
|-------------|----------|------|
| **`read.tsx` 播放条** | 无 | props 未增删；`epubListenBar.setRate` / `goToSentence` 不变 |
| **听书 `useEpubChapterListen`** | 无 | `setRate`、`sentenceLabels`、`goToSentence` 语义不变 |
| **听当前 `useEbookQuoteListen`** | 无 | 同上 |
| **分句菜单性能** | 低 | 虚拟化降低 DOM；打开/滚动逻辑更复杂 |
| **分句菜单交互** | 低 | 手动滚后不再自动跟句；新增「滚到当前句」 |
| **倍速档位** | 中 | 用户可选 0.5–0.7、0.8、1.1 等原网格无档位；已存 `rate` 非 0.1 整数倍时 UI 吸附显示 |
| **TTS 播放速率** | 低 | `clampPlaybackRate` 仍在 TTS 层；极低/极高倍速听感需产品接受 |
| **播放条按钮区** | 无 | 播放/停/上下句/分句/倍速触发器未改 API |
| **Portal 下拉与阅读 chrome** | 低 | `menuChromeStyle`、`epubReaderChromeMenuContentClass` 仍挂变量 |
| **i18n** | 无 | 新增 1 key；旧 key 保留 |

---

## 4. 潜在风险与缓解

| 风险 | 等级 | 说明 | 建议验证 |
|------|------|------|----------|
| 虚拟列表键盘聚焦 | 低 | 未渲染行不在 DOM，Radix 菜单键盘导航可能跳行 | 打开分句菜单，方向键/Enter 选 distant 句 |
| 倍速与历史 `rate` 不一致 | 低 | 本地/session 存 1.25，面板显示吸附为 1.3 | 设 1.25 后打开倍速面板，确认 TTS 实际速率 |
| 0.5× 听感 / 云端限制 | 中 | 较改前更低档 | 0.5×、3.0× 各播一句，云端与本机各测 |
| 手动滚 + 切句 | 低 | 用户滚列表后当前行可能不在视口 | 点定位钮应回当前句并恢复跟随 |
| 刻度尺边界对齐 | 低 | inset + pointer 吸附 | 拖最左/最右应对齐 0.5x / 3.0x 长刻度 |
| `CHAPTER_LISTEN_RATES` 死导出 | 低 | 文档/测试若引用旧网格需更新 | grep 仓库仅 hook 定义处 |

---

## 5. 未改动项

| 项 | 说明 |
|----|------|
| `useEpubChapterListen` / `useEbookQuoteListen` 状态机 | 播放/暂停/切句/停止逻辑未改 |
| `speech` 倍速应用 | `applyActivePlaybackRate` 未改 |
| 听书顶栏入口、互斥停止 | `read.tsx` 听书/听当前切换未改 |
| 正文 `showEpubListenDomRange` / Follow FAB | 与菜单滚动 decoupled |
| 分句数据来源 `buildSentenceLabels` | 仍与 TTS 同源 |
| 后端 / annotation sync | 未触达 |

---

## 6. 回归清单

- [ ] 听书：打开分句菜单 → 当前句可见且高亮；600+ 句章滚动流畅
- [ ] 听书：手动滚分句列表 → 切句时列表 **不** 自动跳；点「滚到当前句」恢复
- [ ] 听书 / 听当前：选 arbitrary 句 → 正文跳转与高亮正确
- [ ] 倍速：拖刻度 0.5x、1.0x、3.0x → 当前句 TTS 速率即时变化
- [ ] 倍速：点预设 1.5 / 2.5 → 选中态与播放一致
- [ ] 倍速：改前若曾用 1.25×，打开面板后听感与显示可接受
- [ ] 听当前与听书互斥：一方播放时另一方启动仍互斥
- [ ] 下拉在 Portal 内字色/背景仍随阅读 chrome 主题
- [ ] `npx tsc --noEmit -p apps/frontend`（若本地跑 TS）

---

## 7. 相关文档滞后

| 文档 | 说明 |
|------|------|
| `docs/ebook/EPUB听书播放器栏.md` | 仍描述 2 列倍速网格与 `CHAPTER_LISTEN_RATES`；未写虚拟列表与刻度尺 |
| `apps/frontend/specs/epub-listen-while-read.md` | 倍速范围文案为 0.75–3×，未写 0.5× 与 0.1 步进 |

---

（若与仓库最新源码不一致，以源码为准）
