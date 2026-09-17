# Markdown 围栏按行解析与安全格式化

本文说明：为何在「Markdown 中嵌入大段 TS/注释含 \`\`\`」时会出现围栏被破坏、预览错位等问题；仓库采用的**完整实现思路**；相关源文件职责；核心代码的**逐行含义**（与当前实现对齐）。

补充（2026-04）：Monaco 侧新增了「Markdown 围栏内嵌语言高亮（含 tsx）」与「Prettier Markdown 格式化后围栏反引号数量安全降级（```` → ```）」两项增强，详见：

- `docs/monaco-Markdown围栏TSX高亮与Prettier格式化.md`

---

## 1. 背景与问题分层

### 1.1 现象

- 在知识库 Markdown 里用 \`\`\`ts / \`\`\`tsx 包裹整份 `index.tsx` 等内容时，**格式化**或**预览拆分**后，围栏语言标签丢失、正文被插入空格、Mermaid 岛与 HTML 预览错乱等。
- 典型触发：JSDoc 或注释里出现 **行内** 的 \`\`\`mermaid（例如 `Monaco/index.tsx` 中 `markdownEnableMermaid` 的说明）。

### 1.2 根因（按层）

| 层级 | 原因 | 后果 |
|------|------|------|
| Prettier `markdown` 解析器 | 会改写围栏反引号数量、语言标签位置、内嵌代码块形状 | \`\`\`ts 变四反引号或 \`\`\` 等 |
| 正则 `/(```[\s\S]*?```)/g` | 非贪婪匹配到**正文里第一次**出现的连续三个 \` | 围栏在注释内被「截断」，后面被当正文做 CJK 空格 |
| `indexOf('```', bodyStart)` | 在围栏**正文**里找**第一个** \`\`\` | 与上一行相同：\`\`\`mermaid 被误判为围栏结束 |
| Monaco `editor.action.formatDocument` | 走 DocumentFormatting 管线，与自定义逻辑叠加时行为不直观 | 难以单独保证「只动正文」 |

本方案：**统一用按行状态机**切围栏；**禁止**对围栏正文用 `indexOf('```')` 与非贪婪整段正则；**Markdown 不注册** Prettier 文档格式化，**快捷键**单独走安全格式化。

---

## 2. 整体设计思路

1. **单一真相源（single source of truth）**  
   在 `apps/frontend/src/utils/markdownFenceLineParser.ts` 实现「按行切围栏」，供：
   - `format.ts`（盘古空格 / `safeFormatMarkdownValue`）
   - `splitMarkdownFences.ts`（`splitMarkdownByCodeFences`，预览与 Mermaid 岛）

2. **重要演进（2026-04）：拆 Mermaid 的“主路径”迁移到 markdown-it parse**  
   过去聊天/预览为了把 ` ```mermaid ` 拆成独立岛，使用 `splitMarkdownByCodeFences`（纯函数按行扫围栏）。  
   该实现虽能规避 `indexOf('```')` 的误截断，但在以下场景仍会把**普通代码块**拆坏（导致“代码块无法渲染”）：
   - 列表内代码块：开头行与闭合行缩进不一致（例如开头 `   ```ts`，闭合顶格 ```）；
   - 拆分后拼接丢失段末换行：`### 标题\n` 与下一段 ```lang 粘连成同一行，围栏失效；
   - 与渲染器（markdown-it）解析边界不一致：拆分认为是 fence，渲染器认为不是（或反之）。
   
   当前仓库在 `packages/markdown-kit/src/markdown/parser.ts` 中新增 `MarkdownParser.splitForMermaidIslands`：
   - **始终使用 `markdown-it` 的 `parse()`** 得到 fence token；
   - 仅把 ` ```mermaid ` fence 拆成 `type:'mermaid'` 岛，其它 fence 原文保持为 markdown 段交给 `render()`；
   - 切片时**保留段末换行**，避免围栏粘连。
   
   因此：  
   - **普通代码块渲染稳定性**：由 `splitForMermaidIslands` 保障（与渲染器同源）；  
   - **`markdownFenceLineParser.ts` 仍保留价值**：用于“流式尾部未闭合 mermaid 围栏”的**按行探测**（见下文 §5.2），以及盘古空格/安全格式化。

2. **围栏行的判定规则（与 CommonMark 常见写法对齐，并偏保守）**  
   - **开头行**：`trimEnd` 后匹配「可选缩进 + 至少 3 个反引号 + info（无反引号）直到行尾」。  
   - **缩进**：仅允许 **空格且长度 ≤ 3**，**不允许 Tab**（避免内嵌源码里 `Tab + 单独一行 \`\`\`` 被当成围栏边界）。  
   - **闭合行**：`trimEnd` 后仅为「缩进 + 至少与开头等长的反引号 + 可选尾部空白」；且缩进须与 `fenceClosingIndentMatchesOpen` 一致（开头无缩进时允许 0～3 个空格的闭合行）。

3. **未闭合围栏**  
   `splitMarkdownFencedBlocks` 在遇到合法开头但未找到合法闭合时，产出 `fenced: true, complete: false`，供流式 Mermaid 等场景。

4. **Monaco 侧**  
   - `markdown` **不在** `LANGUAGES_WITH_FORMAT` 中，不注册文档格式化 Provider。  
   - `⌘/Ctrl+Shift+F`：若 `languageId === 'markdown'`，调用 `safeFormatMarkdownValue` + `executeEdits`；否则仍触发 `formatDocument`（Prettier）。

---

## 3. 相关文件与调用关系

```
markdownFenceLineParser.ts
    ├── splitMarkdownFencedBlocks / joinMarkdownSegments
    │
    ├── format.ts
    │     spacingMarkdownProse → safeFormatMarkdownValue
    │     （Monaco index.tsx 快捷键）
    │
    └── splitMarkdownFences.ts
          splitMarkdownByCodeFences（历史主拆分器；仍保留 fallback 与工具函数）
          splitOpenMermaidTail（流式尾部开放 mermaid 探测：只对尾部做按行扫描）
          （聊天 StreamingMarkdownBody、Monaco/preview.tsx 使用：闭合 fence 交给 splitForMermaidIslands）

packages/markdown-kit/src/markdown/parser.ts
    └── MarkdownParser.splitForMermaidIslands（markdown-it parse，同源拆分；保障普通代码块渲染）
          （聊天 StreamingMarkdownBody、Monaco/preview.tsx）
```

路径速查：

- `apps/frontend/src/utils/markdownFenceLineParser.ts`
- `apps/frontend/src/utils/splitMarkdownFences.ts`
- `apps/frontend/src/components/design/Monaco/format.ts`
- `apps/frontend/src/components/design/Monaco/index.tsx`（`handleEditorMount` 内 `addCommand`）

---

## 4. `markdownFenceLineParser.ts` 逐行说明

下列「行号」对应当前仓库中该文件行号；「说明」为该行在逻辑上的作用。

| 行号 | 代码（摘录） | 说明 |
|------|----------------|------|
| 1–4 | 文件头注释 | 模块用途：按行解析围栏；服务盘古空格与 Mermaid 拆分；避免 `indexOf` 误截断。 |
| 6–9 | `isPlausibleMarkdownFenceIndent` 注释 | 说明缩进规则与 Tab 排除原因。 |
| 10 | `export function isPlausibleMarkdownFenceIndent` | 导出缩进校验，供开闭行共用。 |
| 11 | `if (indent.includes('\t')) return false` | Tab 一律不视为 Markdown 围栏行的合法缩进。 |
| 12 | `return /^ {0,3}$/.test(indent)` | 仅 0～3 个普通空格（U+0020）。 |
| 15–17 | `fenceClosingIndentMatchesOpen` 注释 | 闭合缩进与开头对齐；顶格开头时允许 CM 常见的有限空格闭合。 |
| 18–21 | 函数签名 | `openIndent` / `closeIndent` 为围栏行正则捕获的缩进子串。 |
| 22 | `if (!isPlausibleMarkdownFenceIndent(closeIndent))` | 闭合行缩进也必须通过「无 Tab、≤3 空格」。 |
| 23 | `if (openIndent === closeIndent) return true` | 最常见：开闭缩进完全一致。 |
| 24 | `if (openIndent === '' && /^ {0,3}$/.test(closeIndent))` | 顶格围栏允许 0～3 空格缩进的闭合行。 |
| 25 | `return false` | 其它情况不算合法闭合配对。 |
| 28–30 | `MarkdownFenceSegment` 联合类型 | 非围栏段只有 `text`；围栏段额外带 `complete`（是否遇到合法闭合）。 |
| 32–35 | `splitMarkdownFencedBlocks` 注释 | 切段策略与 `complete: false` 含义。 |
| 36 | `export function splitMarkdownFencedBlocks` | 导出入口。 |
| 37 | `replace(/\r\n/g, '\n').split('\n')` | 统一换行再按行处理。 |
| 38 | `parts` | 累积输出段。 |
| 39 | `let i = 0` | 当前扫描行下标。 |
| 40 | `while (i < lines.length)` | 主循环直到耗尽所有行。 |
| 41 | `const line = lines[i]` | 当前行原文（保留行首缩进等）。 |
| 42 | `openMatch = /^(\s*)(`{3,})([^`]*)$/.exec(line.trimEnd())` | 从行尾去掉空白后匹配：整行是否为「缩进+反引号+info」；`[^`]*` 保证 info 内不能再含反引号。 |
| 43 | `if (openMatch && isPlausibleMarkdownFenceIndent(openMatch[1]))` | 同时满足语法与缩进策略才视为**围栏开始**。 |
| 44 | `openIndent = openMatch[1]` | 记下开头缩进，供闭合比对。 |
| 45 | `tickLen = openMatch[2].length` | 开头反引号个数（支持 4+ 反引号围栏）。 |
| 46 | `fenceLines = [line]` | 围栏累积从首行开始。 |
| 47 | `i++` | 移向围栏内第一行正文。 |
| 48 | `let closed = false` | 是否已找到合法闭合。 |
| 49 | `while (i < lines.length)` | 在内层扫描直至闭合或 EOF。 |
| 50 | `cur = lines[i]` | 当前候选行。 |
| 51 | `fenceLines.push(cur)` | 先纳入围栏文本（闭合行也暂存，最后整块输出）。 |
| 52 | `closeMatch = /^(\s*)(`{3,})\s*$/.exec(cur.trimEnd())` | 闭合行：除缩进外**只有**反引号（长度可 ≥ 开头）。 |
| 53–57 | `if (closeMatch && ...)` | 反引号个数不少于开头，且缩进对与 `fenceClosingIndentMatchesOpen` 通过。 |
| 58 | `closed = true` | 标记已闭合。 |
| 59 | `i++` | 消费闭合行，游标移到围栏外下一行。 |
| 60 | `break` | 结束内层循环。 |
| 61 | `i++` | 非闭合行：继续向下扫。 |
| 64–68 | `parts.push({ fenced: true, text, complete })` | 输出一整段围栏；`complete` 反映是否找到闭合。 |
| 69 | `if (!closed) break` | 未闭合则不再解析后续（剩余内容已都在 `fenceLines` 内）。 |
| 70 | `continue` | 闭合则回到外层，继续从当前 `i` 解析下一段。 |
| 72 | `proseStart = i` | 非围栏起始：准备收一段正文。 |
| 73 | `while (i < lines.length)` | 向后吞行直到下一行「像围栏开头」。 |
| 74 | `peek = ...exec(lines[i].trimEnd())` | 与开头行同一套 open 正则。 |
| 75 | `if (peek && isPlausibleMarkdownFenceIndent(peek[1])) break` | 遇到合法围栏开头则停止吞正文。 |
| 76 | `i++` | 否则本行属于正文。 |
| 78–81 | `parts.push({ fenced: false, text })` | 输出正文段。 |
| 83 | `return parts` | 返回交替的围栏/正文段列表。 |
| 86 | `export function joinMarkdownSegments` | 将处理后的各段用 `\n` 拼回（避免段边界粘行）。 |
| 87 | `let acc = ''` | 拼接累加器。 |
| 88 | `for (const text of segments)` | 逐段连接。 |
| 89–90 | `if (acc === '') acc = text else acc = \`\n\${text}\`` | 首段无前导换行；之后段前加 `\n`。 |
| 92 | `return acc` | 还原为完整字符串。 |

---

## 5. `splitMarkdownFences.ts` 中与本次相关的逐行说明

| 行号 | 说明 |
|------|------|
| 1–7 | 模块说明：Mermaid 岛用途；**强调**闭合须按行、禁止 `indexOf('```')` 的原因。 |
| 9 | 从 `markdownFenceLineParser` 引入 `splitMarkdownFencedBlocks`。 |
| 11–13 | `MarkdownFencePart`：markdown 文本段 vs mermaid 代码段及是否闭合。 |
| 15–31 | `coalesceMarkdownParts`：合并相邻空 markdown、合并连续 markdown 段，减少碎片。 |
| 36–37 | `splitMarkdownByCodeFences`：统一换行后交给 `splitMarkdownFencedBlocks`。 |
| 38 | 调用按行切段。 |
| 39 | 输出数组。 |
| 40 | 遍历每个段。 |
| 41–43 | 非围栏且非空 → 记为 markdown。 |
| 44 | `continue`。 |
| 45 | 围栏段按行拆开。 |
| 46 | 首行（含 \`\`\`lang）。 |
| 47 | 用与解析器一致的正则从首行取语言 info。 |
| 48 | `lang` 小写、去空白。 |
| 49–52 | `body`：已闭合则去掉首尾行（开/闭围栏行），未闭合则去掉开头行后全部算 body。 |
| 53–54 | `mermaid` → 输出 mermaid 部件，`complete` 沿用段级标志。 |
| 55–56 | 其它语言 → 整段围栏原文仍作为 markdown（由 MarkdownParser 渲染）。 |
| 59–61 | 空输入兜底。 |
| 62 | `coalesceMarkdownParts` 归并。 |

### 5.2 本次新增：`splitOpenMermaidTail`（仅探测流式尾部未闭合 mermaid）

位置：`apps/frontend/src/utils/splitMarkdownFences.ts`

用途：

- `markdown-it` 在围栏未闭合时不会产出 fence token，因此 `splitForMermaidIslands` 无法识别“尾部开放 mermaid”；
- 聊天/预览在编辑或流式过程中，仍希望“边输出边渲染 Mermaid”（或至少展示 DSL），就需要一个**只对尾部开放围栏**的按行探测器；
- 该探测器必须**不破坏普通代码块**：因此仅在“找到 ` ```mermaid` 且未找到闭合行”的情况下返回 `{ prefix, body, openLine }`：
  - `prefix`：围栏开头之前的正文（并强制补上行末 `\n`，避免下一段 fence 粘连）
  - `body`：围栏内 DSL（到 EOF）
  - `openLine`：开围栏所在行号，用于生成稳定 key，避免流式过程中 remount 引发闪烁

关键片段（示意，行尾中文注释说明意图）：

```typescript
// prefix 必须保留行末换行：否则下一段以 ``` 开头时会被拼成 `上一行内容```lang`，围栏失效
const prefixLines = lines.slice(0, i);
const prefix = prefixLines.length > 0 ? `${prefixLines.join('\n')}\n` : '';
const body = lines.slice(i + 1).join('\n');
return { prefix, body, openLine: i };
```

### 5.3 本次优化：抽取公共拆分方法 `splitForMermaidIslandsWithOpenTail`（避免两处维护）

位置：`apps/frontend/src/utils/splitMarkdownFences.ts`

动机：

- `StreamingMarkdownBody.tsx` 与 `Monaco/preview.tsx` 都需要同一套逻辑：
  - “闭合围栏”交给 `MarkdownParser.splitForMermaidIslands`
  - “尾部未闭合 mermaid 围栏”用 `splitOpenMermaidTail` 只探测尾部开放围栏
  - 生成稳定 `openMermaidId`（基于 `openLine`），避免流式/编辑过程中 React remount 引发闪烁
- 若两处各自维护，很容易出现边界差异（比如 `prefix` 是否补 `\n`、key 前缀是否一致）。

做法：

- 在 `splitMarkdownFences.ts` 新增组合函数 `splitForMermaidIslandsWithOpenTail`，把上述“组合 + 兜底策略”集中到一处：
  - `enableOpenTail=false`：直接返回 `parser.splitForMermaidIslands(markdown)`（不探测尾部开放围栏）
  - `enableOpenTail=true` 且存在 openTail：对 `openTail.prefix` 做 `splitForMermaidIslands`，并追加一个 `{ type:'mermaid', complete:false }` 尾段
  - `openMermaidId = openMermaidIdPrefix + openLine`，前缀由调用方决定（聊天/预览互不冲突）

调用方：

- `apps/frontend/src/components/design/ChatAssistantMessage/StreamingMarkdownBody.tsx`
  - `enableOpenTail = isStreaming`
  - `openMermaidIdPrefix = 'mmd-open-line-'`
- `apps/frontend/src/components/design/Monaco/preview.tsx`
  - `enableOpenTail = enableMermaid`
  - `openMermaidIdPrefix = 'pv-mmd-open-line-'`

---

## 6. `format.ts` 中与本次相关的逐行说明

| 行号 | 说明 |
|------|------|
| 11–14 | 从 `markdownFenceLineParser` 引入 `joinMarkdownSegments`、`splitMarkdownFencedBlocks`。 |
| 16–18 | `PANGU_CJK`：CJK Unicode 范围，用于中英文数字间插空格。 |
| 82–98 | `spacingMarkdownProse`：对 `splitMarkdownFencedBlocks` 的每个段，围栏原样返回；正文段再按行内单引号 `` `...` `` 保护后做 CJK 替换，最后 `joinMarkdownSegments`。 |
| 101–107 | `safeFormatMarkdownValue`：对外 API；无变化返回 `null`，供调用方跳过 `executeEdits`。 |
| 109–136 | `formatWithPrettierForModel`：**不包含** markdown 分支（markdown 不在下方列表中）。 |
| 190–204 | `LANGUAGES_WITH_FORMAT`：包含 `'markdown'` 时，会让 Monaco 的「格式化文档」走 Provider 管线；若你希望 Markdown 始终走自定义安全逻辑，需要额外约束（见上方补充文档）。 |
| 206–227 | 为所列语言注册 Prettier 文档/选区格式化；Markdown 会在 Provider 中额外做围栏降级后处理（```` → ```）。 |

---

## 7. `Monaco/index.tsx` 中格式化快捷键逐行说明

| 行号（约） | 说明 |
|------------|------|
| 58–61 | 从 `./format` 引入 `registerPrettierFormatProviders`、`safeFormatMarkdownValue`。 |
| 853–854 | 注册 `⌘/Ctrl+Shift+F`（实现位于 `commands.ts`）。 |
| 856–857 | 取 model，无则返回。 |
| 858 | 仅 Markdown 模型走安全分支。 |
| 859 | 只读不写。 |
| 860 | `safeFormatMarkdownValue` 得到新文本。 |
| 861 | 无变更则返回。 |
| 862–866 | `pushUndoStop` + 全文档 `executeEdits` + 再 `pushUndoStop`，保证可撤销。 |
| 867 | 结束 Markdown 分支。 |
| 869 | 其它语言仍触发 Monaco 默认 `formatDocument`（Prettier Provider）。 |

---

## 8. 限制与约定

- **列表内多层缩进围栏**：当前对缩进采取「≤3 空格、无 Tab」的保守策略；若未来需要更贴近完整 CommonMark 的列表嵌套，可在 `isPlausibleMarkdownFenceIndent` / `fenceClosingIndentMatchesOpen` 上扩展，并与 `splitMarkdownFencedBlocks` 联调。
- **顶格围栏 + 2 空格闭合**：由 `openIndent === ''` 时对 `closeIndent` 的 `^ {0,3}$` 分支支持；若开头条有缩进，则要求开闭缩进**字符串完全一致**。
- **命令面板「格式化文档」**：Markdown 注册 Provider 后会生效；为了避免 ```` 围栏可读性问题，Provider 内对 Markdown 也会做“安全降级”后处理（详见补充文档）。

---

## 9. 小结

- **根因**：正文中的 \`\`\` 子串（如注释里的 \`\`\`mermaid）被 **非贪婪正则** 或 **`indexOf('```')`** 误判为围栏边界。  
- **做法**：**按行**识别围栏，**收紧**开闭行缩进；**共享** `markdownFenceLineParser.ts`；**拆分 Mermaid** 与 **盘古空格** 同逻辑；**Markdown** 不走 Prettier 文档格式化，**快捷键**走 `safeFormatMarkdownValue`。

以上与当前代码保持一致；若迁移或重构，请同步更新本文档中的行号与路径，尤其注意：

- 聊天/预览拆 Mermaid 的主路径为 `MarkdownParser.splitForMermaidIslands`（markdown-it parse）；
- `markdownFenceLineParser.ts` 仍用于安全格式化与“尾部开放 mermaid”探测（`splitOpenMermaidTail`）。
