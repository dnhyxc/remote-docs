# EPUB 听当前共用底部播放条 — 影响点分析

## 延伸阅读

- [EPUB听书播放器栏.md](../ebook/EPUB听书播放器栏.md) — 听书播放条 UI 与倍速/分句菜单
- [EPUB引用听书.md](../ebook/EPUB引用听书.md) — 听当前三入口与 TTS 复用（改前无播放条）
- [EPUB听书背景与注释影响.md](./EPUB听书背景与注释影响.md) — 播放背景 vs 用户划线 / 想法虚线
- [TTS本地取消结算影响.md](./TTS本地取消结算影响.md) — 本机 Web Speech cancel settle（听当前首句）
- [developer/EPUB听书开发.md](../ebook/developer/EPUB听书开发.md) — 听当前 + 听书总手册

## 1. 分析目的

评估 **听当前（`useEbookQuoteListen`）与听书共用 `EpubListenPlayerBar`** 相关改动，是否破坏或意外改变已有功能：

- PopBar / 想法 / 上下文菜单 **听当前** 入口
- **听书** 顶栏与底部播放条
- 听当前 **句级淡黄背景**、**自动跟随 FAB**
- 与用户划线 / 想法虚线的 **DOM 隔离**
- TTS 播放、互斥、`syncReadingAnnotations` 回调时机

**改动范围（当前 diff）**：

| 文件 | 变更 |
|------|------|
| `apps/frontend/src/views/ebook/hooks/useEbookQuoteListen.ts` | 状态机重构：按句循环播放、暂停/切句/倍速；对接播放条 API |
| `apps/frontend/src/views/ebook/read.tsx` | `epubListenBar` 在听书 / 听当前间切换；`useEbookQuoteListen` 增加 `getSpineIndex` |
| `apps/frontend/src/views/ebook/utils/epubListenSegmentOverlay.ts` | 新增 `getEpubListenSessionMeta`、`getEpubListenSentenceSpokenRaw`（+ 注释，无逻辑变更） |

**结论摘要**：

| 维度 | 是否影响原有功能 | 说明 |
|------|------------------|------|
| 听书播放条 / 顶栏听书 | **否** | 互斥不变；`chapterListen.isActive` 优先驱动播放条 |
| 听当前三入口 `toggleListen` / `listenLabel` | **否** | 对外签名不变；PopBar 仍传 text/key/cfi/Range |
| 用户划线 / 想法虚线 | **否** | 仍只动 `moke-epub-listen-*`；停止仍 `clearEpubListenSegmentOverlay` |
| 听当前 **句级背景** | **有条件变化** | 由「整段 TTS + `onCadenceChunk` 驱动高亮」改为「按句播放 + 句首 `showEpubListenPlainSpan`」 |
| 句内子节奏高亮（cadence chunk） | **是（体验变化）** | 改前长句内可随 cadence 细粒度换高亮；改后与听书一致，**整句一块亮** |
| 暂停 / 切句 / 倍速（听当前） | **是（新增）** | 改前不支持；改后播放条可控 |
| `onListenSessionEnd` / annotation sync | **否（语义一致）** | 仍在 **停止或播完** 时触发；暂停中间不 sync |
| 无 Rendition / 无 DOM Range | **低影响** | 仍可播音频；无 session 时用 plain 偏移 fallback，无句背景 |
| 与听书同时活跃 | **否** | 启动前仍 `invokeStopChapterListen` / `invokeStopQuoteListen` |

---

## 2. 改动要点（相对改前行为）

### 2.1 播放模型：整段 TTS → 按句循环

**改前**（`useEbookQuoteListen`）：

```text
beginEpubListenOverlaySession → playPreferred(整段 plain, { onCadenceChunk })
  → cadence 回调 showEpubListenPlainSpan(sentenceIndex)
  → finally clear overlay + onListenSessionEnd
```

**改后**：

```text
beginEpubListenOverlaySession → for 每句:
  showEpubListenPlainSpan(i) → playPreferred(单句, { rate })
  → 句末 clearActiveListenHighlight
→ stopInternal → clear overlay + onListenSessionEnd
```

**动机**：与听书 `useEpubChapterListen` 对齐，使底部播放条可 **暂停 / 上一句 / 下一句 / 倍速**。

### 2.2 `read.tsx` — 播放条数据源

**改前**：`EpubListenPlayerBar` 仅绑定 `chapterListen.*`。

**改后**：

```typescript
const epubListenBar = chapterListen.isActive
  ? chapterListen
  : quoteListen.isActive
    ? quoteListen
    : chapterListen; // idle 时 fallback，Bar 内 status==='idle' 仍 return null
```

听当前活跃时，**同一组件** 展示进度与控制；听书优先（二者互斥，不应同时 active）。

### 2.3 overlay 新增只读 API

| 符号 | 作用 |
|------|------|
| `getEpubListenSessionMeta()` | 当前 session 的 plain、句数、分句预览文案 |
| `getEpubListenSentenceSpokenRaw(i)` | 第 i 句 TTS 文本（stripMarkdown 后） |

**未改**：`beginEpubListenOverlaySession`、`paintSentence`、`clearEpubListenSegmentOverlay` 语义。

---

## 3. 影响点矩阵

| 模块 / 场景 | 影响等级 | 分析 |
|-------------|----------|------|
| **PopBar 听当前** | 低（增强） | `toggleListen` 不变；播放中出现底部条；再点「停止」或条上停止结束 |
| **想法卡片 / 详情听当前** | 低 | 同上；`listenKey` 各入口独立 |
| **顶栏听书** | 无 | 听当前前仍 `invokeStopChapterListen`；听书启动前仍 `invokeStopQuoteListen` |
| **EpubListenFollowFab** | 低 | session / autoFollow 仍由 overlay 管理；暂停不销毁 session |
| **用户划线 apply/sync** | 无 | `onListenSessionEnd` → `syncReadingAnnotations` 时机与改前「播完 finally」等价 |
| **播放中新增划线** | 无 | 与改前相同，并行 allowed |
| **English TTS 云端/本机** | 低 | 每句一次 `playPreferred` vs 一次整段：句间可能有极短间隙；会员云端路径仍走同一 API |
| **倍速** | 新增 | 听当前可 `setRate`；句间切换生效，当前句中途改速走 `applyActivePlaybackRate` |
| **暂停后继续** | 新增 | 从 **当前句索引** 重播该句及后续，非句内时间点续播（与听书一致） |
| **分句菜单跳转** | 新增 | `goToSentence` 重算 cursor 并 `playFromCursor`；无听书式 `scrollCenterOnFirst`（仅 autoFollow） |
| **PDF 阅读** | 无 | 无听当前入口 |
| **侧栏 / 分栏布局** | 低 | 播放条高度与听书相同，阅读区少 48px（`h-12`） |

---

## 4. 潜在风险与缓解

| 风险 | 等级 | 说明 | 建议验证 |
|------|------|------|----------|
| 长句内 cadence 高亮消失 | 中（体验） | 改前 `onCadenceChunk` 可在一句内多次移动背景；改后一句一亮 | 接受与听书一致；若需恢复需单独设计 |
| DOM 句界 vs TTS 句界不一致 | 低 | 高亮用 `buildDomSentenceIndex`；TTS 按 `buildSentenceOffsetSpans` 分句播放，plain 同源 | 跨 `<p>` 选区、省略号段首 |
| 暂停后 overlay 仍占用 session | 低 | 暂停不清 session，FAB / autoFollow 仍有效 | 暂停 → 手动滚动 → 恢复播放 |
| 快速连点不同入口听当前 | 低 | `loopGenRef` 递增作废上一轮 | PopBar → 想法卡片切换 |
| `spineIndex` 为 -1 时进度文案 | 低 | 播放条显示「第 0 章 · …」若 spine 未就绪 | 打开书后听当前，看进度章号 |
| 无 rend 纯音频 | 极低 | 不建 session 时无高亮，仍按 plain 分句播 | 极端降级路径 |

---

## 5. 未改动项

| 项 | 说明 |
|----|------|
| `EpubListenPlayerBar` 组件本身 | 仅 props 来源变化 |
| `useEpubChapterListen` | 无 diff |
| `epubListenMarkHighlight` 清除边界 | 仍仅 `moke-epub-listen-*` |
| 互斥注册 `registerQuoteListenStop` / `registerChapterListenStop` | 机制不变 |
| 三入口调用方（除 read 接线） | 仍只解构 `toggleListen`、`listenLabel` |

---

## 6. 回归清单

- [ ] PopBar **听当前** → 底部播放条出现 → 进度句数正确
- [ ] 播放条：**暂停 / 继续 / 停止 / 上一句 / 下一句 / 倍速 / 分句菜单**
- [ ] 想法列表 / 详情 **听当前** 同上
- [ ] 再点 PopBar「停止」或同 key `toggleListen` 可结束
- [ ] 听当前播放中启动 **听书** → 听当前停、条切听书态
- [ ] 听书中启动 **听当前** → 听书停、条切听当前态
- [ ] 跨段落选区：句背景换句清除、无叠层
- [ ] 播放中 / 停止后 **用户划线、想法虚线** 正常
- [ ] **FAB** 手动滚动打断 → 回位仍有效
- [ ] 播完或停止后 `syncReadingAnnotations` 兜底正常
- [ ] `npx tsc --noEmit`（apps/frontend）通过

---

## 7. 相关文档滞后

| 文档 | 说明 |
|------|------|
| `docs/ebook/EPUB引用听书.md` | 仍写「无独立播放条」→ 可更新为「与听书共用条」 |
| `docs/ebook/developer/EPUB听书开发.md` §1.2 | 听当前行「无独立播放条」需修订 |
| `apps/frontend/specs/epub-listen-while-read.md` | 规划态 controller 拆分仍有效，播放条已部分落地 |

---

（若与仓库最新源码不一致，以源码为准）
