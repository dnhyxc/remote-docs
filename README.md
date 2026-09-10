# remote-docs

Host **产品文档三页** MF Remote：更新信息 / 产品指南 / 插件开发手册。

| 项 | 值 |
|---|---|
| MF `name` | `remoteDocs` |
| expose | `./App` |
| 端口 | `9013` |
| trust（日后） | `first-party` |

## 内部路由（内存 NavigationProvider）

| path | 页面 |
|---|---|
| `/home` | 独立预览首页（三文档入口） |
| `/update-info` | 更新信息 |
| `/project-guide` | 产品指南 |
| `/plugin-dev-guide` | 插件开发手册 |

Host 嵌入时默认进 `/update-info`；独立预览进 `/home`。浏览器地址栏仍停在 Host `routePath`。

## 开发

```bash
pnpm install
pnpm dev   # http://127.0.0.1:9013/
```

- manifest：`http://127.0.0.1:9013/mf-manifest.json`
- 插件手册代码块与 Host `pluginDevGuide` 一致：`@/components/design/Markdown`（fenced → MarkdownParser + 围栏复制/下载）

Host 外链（`get*AbsoluteUrl` → `openExternalUrl`）默认打开本独立站，例如：

- `http://127.0.0.1:9013/update-info?lang=zh-CN&theme=…`
- `http://127.0.0.1:9013/project-guide?…`
- `http://127.0.0.1:9013/plugin-dev-guide?…`

可用 Host 环境变量 `VITE_REMOTE_DOCS_ORIGIN` 覆盖 origin。

## Host registry

`apps/backend/uploads/remotes/plugins-registry.json` 已挂三条（共用 `remoteDocs` / `./App` / `:9013`）：

| id | routePath |
|---|---|
| `remoteDocsUpdateInfo` | `/update-info` |
| `remoteDocsProjectGuide` | `/project-guide` |
| `remoteDocsPluginDevGuide` | `/plugin-dev-guide` |

- `injectRoute: true`，省略 `menu`（不进侧栏）
- 壳按 `plugin.routePath` 打开对应内部页
- Host 已去掉同路径静态 view，由插件注入承接

本地需同时跑 Host 与本 Remote：

```bash
pnpm dev   # http://127.0.0.1:9013/
```

## 文案同源

sections 数据自 Host `apps/frontend/src/views/{updateInfo,projectGuide,pluginDevGuide}` 拷贝；修订说明时请两边同步（或日后改为单一来源）。
