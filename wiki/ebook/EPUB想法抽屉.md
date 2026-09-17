# EPUB 读书想法：全屏底部抽屉（已废弃）

## 文档角色

> **本文档仅作历史归档，请勿按此文实现或排查当前产品行为。**

**当前 UI（请以以下文档为准）**：

| 能力 | 文档 |
|------|------|
| 列表 / 详情 / 写想法 **右侧分栏**（与 MK 问书互斥） | **[EPUB想法侧面板.md](./EPUB想法侧面板.md)** |
| 选区浮动 PopBar 毛玻璃 / 箭头 / 阴影 | **[EPUB选区PopBar视觉.md](./EPUB选区PopBar视觉.md)** |
| 虚线下划线同步与稳定性 | **[EPUB想法下划线同步.md](./EPUB想法下划线同步.md)** |
| 数据模型、API、重叠去重 | **[EPUB阅读想法.md](./EPUB阅读想法.md)** |

---

## 1. 为何废弃

2026-06 前后曾将 `@design/Model` 弹窗改为 **Sheet 全屏底部抽屉**（`EpubThoughtBottomSheet`），并引入选区浮动条、头像展示等。随后产品改为与 **MOKE 问书** 一致的 **左读 + 右分栏** 布局：

- 底部抽屉遮挡阅读区过大，与「右侧助手」心智冲突。
- 写想法时长输入与外层滚动嵌套，光标/滚轮问题难彻底收敛。
- 右侧分栏可与 MK 问书 **互斥复用同一 Resizable 栏位**，拖拽宽度行为一致。

**结论**：全屏底部抽屉方案已 **完全移除**，不再存在于源码中。

---

## 2. 组件迁移对照（历史 → 当前）

| 历史（已删除） | 当前替代 |
|----------------|----------|
| `EpubThoughtDialog.tsx` | `EpubThought.tsx` + `EpubThoughtPanelShell.tsx`（右侧分栏） |
| `EpubThoughtListDialog.tsx` | `EpubThoughtList.tsx`（右侧分栏） |
| `EpubThoughtBottomSheet.tsx` | `EpubThoughtPanelShell.tsx` |
| `EpubThoughtDrawerParts.tsx` | `EpubThoughtParts.tsx` |
| Model 弹窗 / Sheet 全屏 | `EbookReadSplitLayout` 的 `sidePanel` |

**仍保留的命名**：`EpubQuoteActionBar` 的 `variant="panel"` 指 **右侧面板内引用区操作条布局**（非底部 Sheet），与已废弃的「全屏抽屉」无关。

---

## 3. 历史轮次仍有效的共性设计

以下能力在迁移到 **右侧分栏** 后 **仍然成立**，细节见 [EPUB想法侧面板.md](./EPUB想法侧面板.md)：

- 后端 `EbookThoughtDto` 含 `username` / `avatar`（profile 联查，不落库）。
- 写想法使用 `ChatTextArea` + `useEntry`：**Enter** 保存，**Shift/Ctrl/Cmd+Enter** 换行。
- `returnToListCfiRef`：列表 → 详情/编辑 → 关闭回同 CFI 列表。
- 选区浮动条：`epubSelectionToolbarAttach` + `EpubSelectionPopBar`。
- 点击下划线 **先开列表**；嵌套重叠选区 **一条可见线**。

---

## 4. 历史文档正文说明

原「全屏抽屉与选区工具条」实现细节（`EpubThoughtBottomSheet`、`EPUB_THOUGHT_DRAWER_SCROLL_CLASS` 等）已从仓库删除。若需回顾该轮次 git 历史，可在版本控制中检索上述已删文件名；**维护与交接请以 side-panel 专题为准**。

若与仓库最新源码不一致，以源码为准。
