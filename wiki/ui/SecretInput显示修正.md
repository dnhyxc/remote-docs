# SecretInput 显示逻辑修正

> 延伸阅读：
> - [SecretInput 组件](../auth/SecretInput组件.md)
> - [登录密码 SecretInput 标签](../auth/登录密码SecretInput标签.md)

## 1. 背景与目标

`SecretInput` 组件用于承载敏感文本（如登录密码、API Key）。它通过 `revealable` 标志位控制是否允许用户「点眼睛」切换明文/密文显示，再由 `revealed` 状态位记录当前是否已切到明文。

本次修复的 Bug：当 `revealable` 为 `false`（即该输入框不支持显隐切换、纯密文场景）时，组件会把 `input` 的 `type` 算成 `'text'`，导致**密码以明文直接展示**——这是一个潜在的安全问题，非可显隐的密文输入框本应始终为 `'password'`。

目标：把 `inputType` 的三元判断条件反转，使非可显隐输入框默认走 `'password'`，同时保持可显隐输入框在「未点击显示」「已点击显示」两种状态下的行为不变。

## 2. 改动范围

- `apps/frontend/src/components/design/SecretInput/index.tsx`（仅一行 `inputType` 表达式）

## 3. 实现思路

`inputType` 由 `revealable && revealed` 两标志位共同决定。下表穷举三个标志组合，对比改动前/改动后结果：

| `revealable` | `revealed` | 改动前 `revealable && !revealed ? 'password' : 'text'` | 改动后 `revealable && revealed ? 'text' : 'password'` | 是否修复 |
| ------------ | ---------- | ----------------------------------------------------- | ----------------------------------------------------- | -------- |
| `false`      | 任意       | `false && !revealed` → `false` → `'text'`（明文，**Bug**） | `false && revealed` → `false` → `'password'`（密文） | ✅ 修复  |
| `true`       | `false`（未点击显示） | `true && !false` → `true` → `'password'`（密文，正确） | `true && false` → `false` → `'password'`（密文，正确） | 行为不变 |
| `true`       | `true`（已点击显示）  | `true && !true` → `false` → `'text'`（明文，正确）   | `true && true` → `true` → `'text'`（明文，正确）     | 行为不变 |

核心要点：

1. **只翻条件、不翻分支结果**：旧版把 `!revealed` 作为「取 password」的条件，导致 `revealable=false` 时条件恒为 `false` 落到 `'text'`。新版改为 `revealed` 作为「取 text」的条件，使 `revealable=false` 时条件恒为 `false` 落到 `'password'`，默认安全。
2. **可显隐场景零行为变化**：`revealable=true` 时两种状态在改动前后结果完全一致，回归面收敛。
3. **默认值偏向安全**：新表达式在所有不确定/未设置场景下均收敛到 `'password'`，符合密文输入组件的最小暴露原则。

## 4. 关键代码对比与注释

### 4.1 `inputType` 表达式（`apps/frontend/src/components/design/SecretInput/index.tsx`）

**对比范围**：组件内部 `inputType` 变量声明单行（摘录自 `SecretInput` 组件函数体，完整符号为该 `const` 声明；上下文用 `// ...` 标注）。

**改动前** · `apps/frontend/src/components/design/SecretInput/index.tsx`（基线，约 L64）

```typescript
// ...（组件函数体上文未改动：props 解析、revealable/revealed 状态声明等）
// 旧逻辑：仅当「可显隐 且 尚未点击显示」时取密文，否则一律明文——
// 这会让 revealable=false（不支持显隐）的纯密文输入框落到明文分支，存在安全隐患
const inputType = revealable && !revealed ? 'password' : 'text';
// ...（组件函数体下文未改动：返回 JSX、渲染 input 与显隐切换按钮等）
```

**改动后** · `apps/frontend/src/components/design/SecretInput/index.tsx`（当前，约 L64）

```typescript
// ...（组件函数体上文未改动：props 解析、revealable/revealed 状态声明等）
// 新逻辑：仅当「可显隐 且 已点击显示」时取明文，否则一律密文——
// 这样 revealable=false 的纯密文输入框默认落到密文分支，修复了明文泄露隐患
const inputType = revealable && revealed ? 'text' : 'password';
// ...（组件函数体下文未改动：返回 JSX、渲染 input 与显隐切换按钮等）
```

**变更摘要**：将三元条件由 `revealable && !revealed` 反转为 `revealable && revealed`，同时交换两个分支结果（`'password'`/`'text'` 互换），使非可显隐输入框默认密文，可显隐输入框行为保持不变。

## 5. 兼容性与影响

- **安全修复**：所有 `revealable={false}` 或未传 `revealable`（默认 `false`）的 `SecretInput` 实例，由原先明文展示改为密文展示，修复了非可显隐密文输入框的明文泄露隐患。
- **行为兼容**：`revealable={true}` 的可显隐输入框在「未点击显示」「已点击显示」两种状态下渲染结果与旧版完全一致，无需调用方调整。
- **下游影响**：依赖 `inputType` 的 DOM 渲染、表单提交、浏览器自动填充（password vault 识别）等均会受益于 `type=password` 的正确语义。
- **无 API 变更**：props 形态、组件签名、默认值均未改动，属纯实现层修复。

## 6. 风险与回归

- **建议回归路径**：
  - 登录页密码框（`revealable`，默认 `revealed=false`）：初始应密文，点击眼睛后明文，再点击恢复密文。
  - 注册页/修改密码页的「确认密码」框（`revealable`）：同上。
  - API Key / Token 类纯密文输入框（`revealable={false}`）：始终密文，不显示眼睛图标。
  - 表单自动填充场景：浏览器 password manager 能正确识别 `type=password` 并提示保存。
- **风险点**：若有调用方依赖旧版 `revealable=false` 时明文展示的「特性」（例如把 `SecretInput` 当普通输入框用），会在视觉上变为密文圆点。此类用法本就不符合组件语义，建议改为普通 `Input`。
- **无破坏性 API 变更**，无需调用方迁移。

## 7. 相关源码路径

| 说明 | 路径 |
| ---- | ---- |
| 修复所在组件 | `apps/frontend/src/components/design/SecretInput/index.tsx` |
| 组件设计文档（姊妹） | `docs/auth/SecretInput组件.md` |
| 登录密码标签使用文档 | `docs/auth/登录密码SecretInput标签.md` |

---

（若与仓库最新源码不一致，以源码为准）
