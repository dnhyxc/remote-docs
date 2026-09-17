# Monaco：Markdown 代码块（fenced code block）按 Prettier 格式化 — 完整实现思路

本文整理知识库 Markdown 编辑器中「格式化代码块」的完整实现方案，包括：为什么需要自定义、如何保证与 Prettier 一致、如何处理 Markdown 内嵌代码块、以及为什么不会影响现有功能。

> 说明：本文以当前仓库实现为准，相关代码均位于 `apps/frontend/src/components/design/Monaco/`。

---

## 1. 需求与约束

### 1.1 目标

- 在知识库的 **Monaco 编辑器（编辑器）** 中，对 Markdown 文档执行“格式化文档”时：
  - **Markdown 语法本身**按 Prettier 规范格式化
  - fenced code block（例如 ```js / ```css / ```tsx）内部代码也按对应语言规则格式化（如补空格、分号、缩进）

### 1.2 约束（不影响现有功能）

- 不能破坏：
  - Mermaid / 预览渲染（markdown-it）
  - 现有快捷键逻辑与撤销栈（undo）
  - IME（输入法）输入稳定性（避免覆盖正在输入）
- 必须兼容：
  - 代码块内容中包含 “```mermaid” 等 **字面量**的场景（见 §4）

---

## 2. 总体架构：两条格式化入口要一致

Monaco 里“格式化”可能来自两条入口：

1. **自定义快捷键入口**（推荐、可控）
   - `apps/frontend/src/components/design/Monaco/commands.ts`（`editor.addCommand`）
   - 绑定 **`⌘+Shift+F`（macOS）/ `Ctrl+Shift+F`（Windows/Linux）**
   - 当当前 model 的 `languageId === 'markdown'` 时，调用 `safeFormatMarkdownValue()`

2. **Monaco Provider 入口**（右键/命令面板/默认行为）
   - `apps/frontend/src/components/design/Monaco/format.ts`
   - 通过 `registerDocumentFormattingEditProvider` 注册 Prettier Provider
   - `editor.action.formatDocument` 会走这条管线

**关键点**：两条入口最终必须产生一致的 Markdown 格式化结果，否则会出现“我按快捷键/点格式化，表现不一样”的问题。

---

## 3. Prettier 在浏览器端的接入方式

### 3.1 为什么用 `prettier/standalone`

前端（浏览器/WebView）无法使用 `import prettier from 'prettier'`（依赖 Node 环境），因此使用：

- `format`：`prettier/standalone`
- 插件：`prettier/plugins/*`

对应实现：`apps/frontend/src/components/design/Monaco/format.ts`

### 3.2 插件与 parser 的选择

核心思想：

- 根据 Monaco 的 `languageId` 映射到 Prettier 的 `parser`（例如 `typescript`、`babel`、`css`、`markdown`）
- 统一注入一组插件，避免某些 parser 找不到对应语法支持

实现片段（摘录并加注释）：

```ts
// ESM 下 Prettier 插件常为 default 导出：统一取 default
function asPrettierPlugin(mod: unknown): Plugin {
  const m = mod as { default?: Plugin };
  return (m?.default ?? mod) as Plugin;
}

// 浏览器端使用 standalone + plugins
const PRETTIER_PLUGINS: Plugin[] = [
  asPrettierPlugin(babelPluginMod),
  asPrettierPlugin(estreePluginMod),
  asPrettierPlugin(typescriptPluginMod),
  asPrettierPlugin(htmlPluginMod),
  asPrettierPlugin(markdownPluginMod),
  asPrettierPlugin(postcssPluginMod),
  asPrettierPlugin(yamlPluginMod),
];
```

---

## 4. Markdown 内嵌代码块：`embeddedLanguageFormatting`

仅对 Markdown 本身执行 `parser: 'markdown'` 还不够。要让 fenced code block 内部也被格式化，需要显式开启：

- `embeddedLanguageFormatting: 'auto'`

对应实现（节选）：

```ts
const formatted = await format(value, {
  parser: 'markdown',
  plugins: PRETTIER_PLUGINS,
  ...PRETTIER_BASE_OPTIONS,
  useTabs: true,
  // 关键：让 ```js / ```css 等围栏内代码自动走对应 parser
  embeddedLanguageFormatting: 'auto',
});
```

**效果**：

- ```javascript 内会按 JS 规则补空格、分号
- ```css 内会按 CSS 规则格式化花括号与缩进

---

## 5. 围栏反引号数量问题：为什么会变成 ````tsx

### 5.1 Prettier 的保守升级

当 fenced code block **内容里出现 ``` 字面量**时，Prettier 可能把外层围栏从 ```tsx 升级为 ````tsx，以避免“提前闭合”的潜在风险。

用户侧诉求是保持可读性：希望依然是 ` ```tsx ... ``` `。

### 5.2 CommonMark 关键规则（闭合行判定）

三反引号围栏真正的闭合行形态是：

- `^\s{0,3}```\s*$`

而像 “```mermaid” 这种行 **不会**闭合围栏（因为反引号后还有内容）。

### 5.3 解决方案：仅在“可证明安全”时把 ```` 降回 ```

实现函数：`downgradeLongBacktickFencesWhenSafe(markdown)`

策略：

- 只处理外层为 **4+** 反引号的围栏（````…）
- 找到其闭合行后，扫描围栏内容是否存在 **会闭合三反引号围栏**的行（`^ {0,3}```\s*$`）
- 若不存在：把开/闭围栏替换为三反引号，并保留 info string（例如 `tsx`）
- 若存在：保持 ````（因为降级会导致语法错误）

该策略属于“后处理”，只改变围栏分隔符，不改代码内容。

---

## 6. 自定义快捷键入口：保证撤销栈与只读安全

实现位置：`apps/frontend/src/components/design/Monaco/commands.ts`

关键点：

- 只读模式（readOnly）不允许写入
- 使用 `editor.pushUndoStop()` 包住一次 `executeEdits`，确保用户可一键撤销

节选（带说明）：

```ts
editor.addCommand(
  monaco.KeyMod.CtrlCmd | monaco.KeyMod.Shift | monaco.KeyCode.KeyF,
  () => {
    const model = editor.getModel();
    if (!model) return;

    // Markdown：走自定义安全格式化（包含围栏降级后处理）
    if (model.getLanguageId() === 'markdown') {
      if (editor.getOption(monaco.editor.EditorOption.readOnly)) return;
      void (async () => {
        const next = await safeFormatMarkdownValue(model.getValue());
        if (next == null) return;
        editor.pushUndoStop();
        editor.executeEdits('dnhyxc-markdown-safe-format', [
          { range: model.getFullModelRange(), text: next },
        ]);
        editor.pushUndoStop();
      })();
      return;
    }

    // 其它语言：走 Monaco 默认格式化（Provider）
    editor.trigger('keyboard', 'editor.action.formatDocument', null);
  },
);
```

---

## 7. Provider 入口：保证“格式化文档”与快捷键一致

实现位置：`apps/frontend/src/components/design/Monaco/format.ts`

要点：

- `registerPrettierFormatProviders(monaco)` 注册 document/range formatting provider
- `formatWithPrettierForModel` 中对 `language === 'markdown'` 也执行围栏降级后处理

这样无论用户用哪种方式触发“格式化文档”，结果一致。

---

## 8. 回退策略：Prettier 失败时不破坏正文

当 Prettier Markdown 格式化抛错时，不能“半格式化”导致围栏被破坏。

当前回退策略是：

- 仅对围栏外 prose 做轻量的「盘古之白（Pangu spacing，盘古空格）」处理
- 围栏段保持字节级原样

这依赖 `apps/frontend/src/utils/markdownFenceLineParser.ts` 的按行围栏切分，避免误把注释里的 ``` 字面量当成围栏边界。

---

## 9. 相关英文技术术语（首次出现带中文说明）

- **Monaco（编辑器内核）**：VS Code 同源的编辑器组件
- **Provider（提供器）**：Monaco 的格式化提供接口（document/range formatting）
- **Prettier（格式化器）**：统一代码风格的格式化工具
- **embeddedLanguageFormatting（嵌入语言格式化）**：Prettier 在 Markdown 中格式化 fenced code block 的能力
- **CommonMark（Markdown 规范）**：Markdown 的标准化语法规则集合

