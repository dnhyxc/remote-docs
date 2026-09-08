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
- 插件手册代码块与 Host `pluginDevGuide` 一致：`@dnhyxc-ai/markdown-kit`（fenced Markdown → `MarkdownParser` + 围栏复制/下载）

## 日后 Host registry（本轮 Host 未改）

当前 `apps/frontend` 仍自带 `/update-info`、`/project-guide`、`/plugin-dev-guide`。接入本 Remote 时再改 Host `paths` / 路由或删除原 view，并增加类似条目：

```json
{
  "id": "remoteDocs",
  "title": { "zh-CN": "产品文档", "en-US": "Product docs" },
  "remoteName": "remoteDocs",
  "expose": "./App",
  "framework": "react",
  "entry": "http://127.0.0.1:9013/mf-manifest.json",
  "version": "1.0.0",
  "hostApiRange": "^1.0.0",
  "routePath": "/docs",
  "injectRoute": true,
  "trust": "first-party",
  "permissions": [],
  "enabled": true
}
```

省略 `menu` = 仅注入路由、不进侧栏。

## 文案同源

sections 数据自 Host `apps/frontend/src/views/{updateInfo,projectGuide,pluginDevGuide}` 拷贝；修订说明时请两边同步（或日后改为单一来源）。
