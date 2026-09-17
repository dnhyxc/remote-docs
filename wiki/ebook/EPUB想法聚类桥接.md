# EPUB 读书想法：点击聚合与「桥接」规则实现说明

> **已归档**：规则 R1–R5、连通条件、流程与核心代码已并入 **[EPUB想法添加下划线开发.md](./developer/EPUB想法添加下划线开发.md) §16**。请勿在此维护细节。

| 原章节 | 主文档对应 |
|--------|------------|
| 产品规则 R1–R5 | **§16.2** |
| 五种连通条件 | **§16.3** |
| 运行时流程 / mermaid | **§16.4**、**§16.8** |
| 回归反例 | **§16.7** |
| `areThoughtCfisConnected` 等 | **§16.6**、**§16.9** |
| 性能 | **§16.5** |

**规范对照**：[`apps/frontend/specs/epub-thought-nested-cluster-list.md`](../../apps/frontend/specs/epub-thought-nested-cluster-list.md) §5.7。

**实现文件**：`apps/frontend/src/views/ebook/utils/epubThoughtCluster.ts`

若与仓库最新源码不一致，以源码为准。
