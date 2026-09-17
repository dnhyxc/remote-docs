# Monaco：Markdown 围栏代码块（tsx）高亮与 Prettier 格式化策略

本文记录「知识库 Markdown 编辑器」中两类常见问题的**实现思路、边界条件与关键代码**，并解释为何这些改动**不会影响现有功能**。

- **问题 A（高亮）**：Markdown 中的 ```tsx 围栏代码块内代码**全白不高亮**（而 ```ts/```js 正常）。
- **问题 B（格式化）**：代码块内容里包含 “```mermaid” 等字面量时，Prettier 会把外层围栏从 ```tsx 升级为 ````tsx，用户希望**保持三反引号**不变。

---

## 1. 相关文件速查

- `apps/frontend/src/components/design/Monaco/index.tsx`
  - Monaco `beforeMount` 时注册主题/格式化/Markdown 高亮增强
- `apps/frontend/src/components/design/Monaco/markdownTokens.ts`
  - Markdown 围栏代码块嵌入语言高亮（Monarch + nextEmbedded）
- `apps/frontend/src/components/design/Monaco/format.ts`
  - Prettier 格式化（markdown + embedded language formatting）
  - Markdown 围栏反引号数量的“安全降级”（```` → ```）

补充：若你想了解“代码块按 Prettier 格式化”的完整链路（快捷键入口 + Provider 入口 + 回退策略），详见：

- `docs/monaco-Markdown代码块Prettier格式化.md`

---

## 2. 问题 A：为什么 ```tsx 会“全白”

### 2.1 根因

Monaco 对 Markdown 的默认 tokenization 通常**不会**对 fenced code block 内嵌入语言做高亮；即便你能在围栏首行写 ` ```tsx`，编辑器也可能把围栏内容当成纯文本显示。

另外，很多打包配置下 Monaco **并不存在** `typescriptreact` / `javascriptreact` 这类语言 id（或 tokenizer 未加载），此时把围栏嵌入目标设成这些 languageId，会退化为“无 token”（观感就是**全白**）。而 `typescript` / `javascript` 往往是存在的，因此 `ts/js` 看起来“正常”。

### 2.2 解决方案（轻量、可控）

使用 Monarch tokenizer 给 `markdown` 注册一个增强规则：

- 识别围栏开头行（允许前置空格）：`^\\s*```tsx\\b.*$`
- 进入围栏 state（例如 `@fence_tsx`）
- 在围栏 state 内启用 `nextEmbedded: 'typescript'`（而不是 `typescriptreact`），从而让 TS tokenizer 负责内部高亮
- 遇到围栏闭合行时 `nextEmbedded: '@pop'` 回到 Markdown

实现位置：`apps/frontend/src/components/design/Monaco/markdownTokens.ts`

关键点：

- **允许前置空格**：围栏在列表/引用/缩进场景下常见，否则正则不命中会退化为纯文本（全白）。
- **tsx 映射到 typescript**：保证在当前 Monaco 打包下可用；即使 JSX 语法细节不完美，也显著优于“全白”。
- **不改现有主题**：只做 tokenizer 层增强，不动颜色/主题变量。

### 2.3 注册入口

在 `beforeMount` 调用一次注册函数即可：

- 文件：`apps/frontend/src/components/design/Monaco/index.tsx`
- 调用：`registerMarkdownFenceEmbeddedHighlight(monaco)`

这不会影响非 Markdown 编辑器，也不会改变 Markdown 的渲染/预览，仅影响编辑器里的“显示高亮”。

---

## 3. 问题 B：为什么 Prettier 会把 ``` 升级成 ````

Prettier 的 Markdown 格式化为了避免“围栏提前闭合”，当它在 code fence 内容里看到 ``` 字面量时，可能会把外层围栏升级为更长的反引号序列（例如 ````tsx）。

这在语法上通常是安全的，但对阅读与复制（尤其是把大段源码粘贴进知识库）不友好。

### 3.1 关键事实（CommonMark 规则）

对于三反引号围栏，**真正会闭合围栏**的是这种行：

- `^\\s{0,3}```\\s*$`

而类似 “```mermaid” 并不是闭合行（它在反引号后还有内容），不会闭合外层围栏。

因此，**很多 Prettier 升级成 ```` 的情况其实是“过于保守”**，我们可以在不破坏语义正确性的前提下，将其降回 ```。

---

## 4. 解决方案：仅在“可证明安全”时把 ```` 降回 ```

实现位置：`apps/frontend/src/components/design/Monaco/format.ts`

新增函数（思路）：

- 扫描整个 Markdown 文本
- 找到外层为 **4+ 反引号** 的开围栏行：`^(\\s*)(`{4,})([^`]*)$`
  - 保留缩进与 info string（比如 `tsx`）
- 找到匹配的闭围栏行（缩进匹配、反引号长度 ≥ 开头）
- 检查围栏内容（开/闭之间的行）是否包含**会闭合三反引号围栏**的行：
  - `^ {0,3}```\\s*$`
- **如果不存在**上述闭合行：把开/闭围栏替换成三反引号，并保留 info
- 如果存在：保持 Prettier 的 ````（因为降级会导致语法错误/提前闭合）

这属于“后处理”（post-process），只改变围栏分隔符，不触碰代码块内容本身。

---

## 5. 为什么之前“看起来没生效”：格式化入口不唯一

Monaco 的格式化可能来自两条入口：

- **入口 1**：Markdown 专用的 `safeFormatMarkdownValue(value)`（通常绑定某个快捷键或按钮）
- **入口 2**：Monaco 的 `editor.action.formatDocument` → `registerDocumentFormattingEditProvider`（Provider 管线）

为了确保无论走哪个入口都一致，我们把“安全降级”同时接入：

- `safeFormatMarkdownValue`（Markdown 专用）
- `formatWithPrettierForModel`（Provider 管线，且仅对 `language === 'markdown'` 生效）

这样不会影响 `ts/js/css/json` 等其它语言的格式化结果。

---

## 6. 维护要点与边界条件

- **可降级的充分条件**：围栏内容里不存在 `^ {0,3}```\\s*$` 的独立闭合行。
- **不可降级**：如果代码块内容真的包含独立一行 ```（或你把别的代码块原样嵌进来），外层保持 ```` 才是语法正确的。
- **高亮与格式化解耦**：`markdownTokens.ts` 只管显示；`format.ts` 只管文本格式化。
- **英文技术术语（技术术语）**：
  - **Monarch tokenizer（Monarch 分词器）**：Monaco 内置的规则驱动 tokenizer
  - **nextEmbedded（嵌入分词切换）**：在一个语言的 tokenizer 中嵌入另一个语言
  - **Provider（提供器）**：Monaco `registerDocumentFormattingEditProvider` 注册的格式化提供逻辑

