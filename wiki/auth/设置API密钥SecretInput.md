# 设置页 API Key 输入框改用 SecretInput 组件

本文档记录 **设置页 API Key 输入框**（LLM 设置、云端 TTS 设置）从「手搓 Input + 眼睛按钮」迁移到 `@design/SecretInput` 统一组件的完整改动，包含改动前/改动后成对对比与逐行中文注释。目标：去重样板代码、统一交互行为、保证 Tab 序一致性。

---

## 1. 改动背景

改动前，设置页中每个需要「密文显示 + 一键切换明文」的输入框都重复实现了：
- 各自维护一个 `useState` 控制显隐（`showApiKey` / `showVectorApiKey` / `visible`）
- 各自手写 `relative` 容器 + `Input` + `Eye/EyeOff` Button
- 各自重复 `aria-label`、禁用条件、`pr-10` 内边距等细节

这导致：
1. **代码重复**：每个密文框约 30 行样板，LLM 页有 2 个、云 TTS 页有 1 个
2. **行为不一致**：空值是否禁用、`autoComplete` 值、按钮样式等可能存在微小差异
3. **维护成本高**：要改交互（如加 Tab 序优化）需要同时改多处

本次改动将这些重复实现统一替换为 `@design/SecretInput` 组件（见 [SecretInput组件.md](./SecretInput组件.md)）。

---

## 2. LLM 设置页改造

**文件**：`apps/frontend/src/views/setting/llm/index.tsx`

LLM 设置页包含两个 API Key 输入框：对话大模型 API Key、向量模型 API Key。

### 2.1 改动前：import 与 state

```tsx
// 引入原生 Input 组件
import { Input } from '@ui/input';
// 引入眼睛图标（开/关）
import { Eye, EyeOff } from 'lucide-react';

// ...

// 对话模型 API Key 值
const [apiKey, setApiKey] = useState('');
// 已保存的 API Key（掩码展示用）
const [savedApiKey, setSavedApiKey] = useState('');
// 是否显示明文（每个框一个 state）
const [showApiKey, setShowApiKey] = useState(false);

// ...

// 向量模型 API Key 值
const [vectorApiKey, setVectorApiKey] = useState('');
// 已保存的向量 API Key
const [savedVectorApiKey, setSavedVectorApiKey] = useState('');
// 是否显示向量 API Key 明文
const [showVectorApiKey, setShowVectorApiKey] = useState(false);
```

### 2.2 改动后：import 与 state

```tsx
// 直接引入 SecretInput 组件，不再需要引入 Input 和眼睛图标
import SecretInput from '@design/SecretInput';

// ...

// 对话模型 API Key 值（保留）
const [apiKey, setApiKey] = useState('');
// 已保存的 API Key（保留，用于 key 强制重置组件显隐状态）
const [savedApiKey, setSavedApiKey] = useState('');
// showApiKey state 已删除 — 显隐交由 SecretInput 内部管理

// ...

// 向量模型 API Key 值（保留）
const [vectorApiKey, setVectorApiKey] = useState('');
// 已保存的向量 API Key（保留）
const [savedVectorApiKey, setSavedVectorApiKey] = useState('');
// showVectorApiKey state 已删除 — 显隐交由 SecretInput 内部管理
```

### 2.3 改动前：加载/保存时复位显隐状态

每次加载或保存成功后，都需要手动复位 `showApiKey` 为 `false`（回到密文）。

```tsx
// 加载设置成功后
const { displayKey, savedKey } = resolveApiKeyFields(res.data.apiKey);
setSavedApiKey(savedKey);
setApiKey(displayKey);
// 每次加载都要手动把显示状态复位为 false
setShowApiKey(false);

// 保存成功后
setSavedApiKey(savedKey);
setApiKey(displayKey);
// 保存后也要复位显示状态
setShowApiKey(false);

// 清空后
setSavedApiKey('');
setApiKey('');
// 清空后同样复位
setShowApiKey(false);
```

### 2.4 改动后：加载/保存无需关心显隐

显隐状态由 `SecretInput` 内部管理，且通过 `key={savedApiKey}` 触发组件重挂载来复位。父组件不再需要任何显隐相关的操作。

```tsx
// 加载设置成功后
const { displayKey, savedKey } = resolveApiKeyFields(res.data.apiKey);
setSavedApiKey(savedKey);
setApiKey(displayKey);
// setShowApiKey(false) 已删除

// 保存成功后
setSavedApiKey(savedKey);
setApiKey(displayKey);
// setShowApiKey(false) 已删除

// 清空后
setSavedApiKey('');
setApiKey('');
// setShowApiKey(false) 已删除
```

> **设计说明**：`key={savedApiKey}` 的作用——当 `savedApiKey` 变化时（如保存成功后从空变为掩码、或清空后从掩码变空），React 会卸载旧的 `SecretInput` 实例并挂载新实例，新实例的 `defaultRevealed=false` 自然回到密文状态。这样父组件完全不需要知道显隐状态的存在。

### 2.5 改动前：对话 API Key 输入框 JSX

```tsx
{/* 外层 relative 容器，手动设置 min-w-0 和 flex-1 */}
<div className="relative min-w-0 flex-1">
    {/* 原生 Input，type 由 showApiKey 控制 */}
    <Input
        id="llm-api-key"
        type={showApiKey ? 'text' : 'password'}
        value={apiKey}
        onChange={(e) => setApiKey(e.target.value)}
        placeholder={t('setting.llm.apiKeyPlaceholder')}
        disabled={saving}
        autoComplete="new-password"
        {/* 右侧留 padding 给眼睛按钮 */}
        className={cn(fieldInputClass, 'pr-10')}
    />
    {/* 眼睛切换按钮，手动绝对定位 */}
    <Button
        type="button"
        variant="ghost"
        size="icon"
        className="absolute top-1/2 right-1.5 size-6 -translate-y-1/2 text-textcolor/55 hover:text-textcolor"
        {/* 禁用条件：保存中或无值 */}
        disabled={saving || !apiKey}
        {/* aria-label 手动切换 */}
        aria-label={
            showApiKey
                ? t('setting.llm.hideApiKey')
                : t('setting.llm.showApiKey')
        }
        {/* 点击切换 */}
        onClick={() => setShowApiKey((v) => !v)}
    >
        {/* 根据状态渲染不同图标 */}
        {showApiKey ? (
            <EyeOff className="size-4" aria-hidden />
        ) : (
            <Eye className="size-4" aria-hidden />
        )}
    </Button>
</div>
```

### 2.6 改动后：对话 API Key 输入框 JSX

```tsx
{/* 外层容器去掉 relative，眼睛按钮由组件内部处理 */}
<div className="min-w-0 flex-1">
    {/* SecretInput 一行替代：Input + 眼睛按钮 + 显隐逻辑 */}
    <SecretInput
        {/* key 变化触发重挂载，复位显隐状态 */}
        key={savedApiKey}
        id="llm-api-key"
        value={apiKey}
        onChange={(e) => setApiKey(e.target.value)}
        placeholder={t('setting.llm.apiKeyPlaceholder')}
        disabled={saving}
        {/* 不再需要 pr-10，组件内部已处理 */}
        className={cn(fieldInputClass, 'w-full')}
    />
</div>
```

向量 API Key 输入框的改造完全对称，此处不再重复贴出。

---

## 3. 云端 TTS 设置页改造

**文件**：`apps/frontend/src/views/setting/cloudTts/index.tsx`

云 TTS 设置页的密文输入封装在 `PrefTextField` 子组件中，通过 `secret` prop 控制是否为密文模式。

### 3.1 改动前：PrefTextField 完整实现

```tsx
function PrefTextField({
    id,
    label,
    value,
    onChange,
    type = 'text',
    secret = false,
    disabled = false,
    placeholder,
    labelClassName,
}: {
    id: string;
    label: string;
    value: string;
    onChange: (value: string) => void;
    type?: string;
    secret?: boolean;
    disabled?: boolean;
    placeholder?: string;
    labelClassName?: string;
}) {
    const { t } = useI18n();
    // 显隐状态：每个实例自己维护
    const [visible, setVisible] = useState(false);
    // 计算 input type：secret 模式下由 visible 决定
    const inputType = secret ? (visible ? 'text' : 'password') : type;

    // placeholder 默认值：如果是 secret 则用 API Key 占位符
    const _placeholder = placeholder || t('setting.llm.apiKeyPlaceholder');

    return (
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-4">
            <Label htmlFor={id} className={labelClassName}>
                {label}
            </Label>
            {/* relative 容器 */}
            <div className="relative min-w-0 flex-1">
                {/* Input */}
                <Input
                    id={id}
                    type={inputType}
                    value={value}
                    disabled={disabled}
                    placeholder={_placeholder}
                    autoComplete={secret ? 'new-password' : 'off'}
                    onChange={(e) => onChange(e.target.value)}
                    className={cn(fieldInputClass, 'w-full', secret && 'pr-10')}
                />
                {/* secret 模式下渲染眼睛按钮 */}
                {secret ? (
                    <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="absolute top-1/2 right-1.5 size-6 -translate-y-1/2 text-textcolor/55 hover:text-textcolor"
                        disabled={disabled || !value}
                        aria-label={
                            visible
                                ? t('setting.llm.hideApiKey')
                                : t('setting.llm.showApiKey')
                        }
                        onClick={() => setVisible((v) => !v)}
                    >
                        {visible ? (
                            <EyeOff className="size-4" aria-hidden />
                        ) : (
                            <Eye className="size-4" aria-hidden />
                        )}
                    </Button>
                ) : null}
            </div>
        </div>
    );
}
```

### 3.2 改动后：PrefTextField 简化实现

```tsx
function PrefTextField({
    id,
    label,
    value,
    onChange,
    type = 'text',
    secret = false,
    disabled = false,
    placeholder,
    labelClassName,
}: {
    id: string;
    label: string;
    value: string;
    onChange: (value: string) => void;
    type?: string;
    secret?: boolean;
    disabled?: boolean;
    placeholder?: string;
    labelClassName?: string;
}) {
    const { t } = useI18n();
    // useState(visible) 已删除 — 显隐交由 SecretInput 内部管理
    // inputType 计算也删除了

    // placeholder 逻辑调整：secret 模式下默认用 API Key 占位符，非 secret 模式为空
    const _placeholder =
        placeholder || (secret ? t('setting.llm.apiKeyPlaceholder') : '');

    return (
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-4">
            <Label htmlFor={id} className={labelClassName}>
                {label}
            </Label>
            {/* 外层容器去掉 relative */}
            <div className="min-w-0 flex-1">
                {/* 根据 secret 选择不同组件 */}
                {secret ? (
                    // 密文模式：直接用 SecretInput，所有显隐逻辑封装在内
                    <SecretInput
                        id={id}
                        value={value}
                        disabled={disabled}
                        placeholder={_placeholder}
                        onChange={(e) => onChange(e.target.value)}
                        className={cn(fieldInputClass, 'w-full')}
                    />
                ) : (
                    // 普通模式：仍用原生 Input
                    <Input
                        id={id}
                        type={type}
                        value={value}
                        disabled={disabled}
                        placeholder={_placeholder}
                        autoComplete="off"
                        onChange={(e) => onChange(e.target.value)}
                        className={cn(fieldInputClass, 'w-full')}
                    />
                )}
            </div>
        </div>
    );
}
```

---

## 4. 改动收益

| 指标 | 改动前 | 改动后 |
|------|--------|--------|
| LLM 页显隐相关 state | 2 个（`showApiKey`、`showVectorApiKey`） | 0 个 |
| LLM 页显隐复位代码 | 6 处 `setShowApiKey(false)` / `setShowVectorApiKey(false)` | 0 处（靠 `key` 触发重挂载） |
| 云 TTS 页显隐相关代码 | ~25 行 | ~5 行（直接用组件） |
| 眼睛按钮重复实现 | 3 处（LLM×2 + 云TTS×1） | 1 处（组件内部） |
| Tab 序行为 | 眼睛按钮参与 Tab 导航（多一次 Tab 停顿） | 眼睛按钮 `tabIndex=-1`，Tab 直达下一个输入框 |

---

## 5. 延伸阅读

- [SecretInput组件.md](./SecretInput组件.md) — `SecretInput` 组件完整设计与源码
- use-inputs-only-tab.md — 全局 Tab 序策略（与 `SecretInput` 的 `tabIndex={-1}` 配合）
- [登录密码SecretInput标签.md](./登录密码SecretInput标签.md) — 登录/注册/找回密码页密码框改造
