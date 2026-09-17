# SecretInput 密码/密钥输入组件

本文档基于当前仓库实现，梳理 **前端设计系统** 中 `SecretInput`（密文输入框）组件的设计思路与完整源码，收录**逐行中文注释**版可复用代码。`SecretInput` 统一封装「密码 / API Key 等敏感输入 + 眼睛图标切换明文密文」的样板逻辑，替代各业务页手搓 Input + Eye/EyeOff 按钮的重复实现。

---

## 1. 目标与适用范围

| 维度 | 说明 |
|------|------|
| 组件定位 | `@design/SecretInput` — 设计系统级组件，`apps/frontend/src/components/design/SecretInput/` |
| 适用场景 | 登录 / 注册 / 找回密码的密码框、设置页 API Key 框、任何需要「密文 + 一键显隐」的输入 |
| 核心能力 | 内置眼睛按钮切换明文/密文、支持受控/非受控显隐状态、空值自动禁用切换、`tabIndex=-1` 不参与 Tab 序 |
| 依赖 | `@ui/button`、`@ui/index`（Input）、`lucide-react`（Eye/EyeOff）、`@/hooks`（useI18n）、`@/lib/utils`（cn） |

---

## 2. 改动前：各业务页重复实现（已被替代）

以 **LLM 设置页** 为例，改动前每个密文输入框都需要：
1. 一个本地 `useState` 控制显隐（如 `showApiKey` / `showVectorApiKey`）
2. 一个 `relative` 容器 + `Input` + 右边 `Eye/EyeOff` 按钮
3. 重复的 `aria-label`、`disabled` 条件、`pr-10` 内边距

每出现一次就复制一次，约 30+ 行样板代码，分散在 LLM 设置、云 TTS 设置、登录注册等多个文件中。

---

## 3. 改动后：统一组件 + 一行调用

### 3.1 组件完整源码（带逐行中文注释）

**来源**：`apps/frontend/src/components/design/SecretInput/index.tsx`

```tsx
// 引入 UI Button 基础组件，用于渲染显隐切换按钮
import { Button } from '@ui/button';
// 引入 Input 基础组件，作为内部实际输入框
import { Input } from '@ui/index';
// 引入 lucide-react 的眼睛图标（开/关）
import { Eye, EyeOff } from 'lucide-react';
// 引入 React Hooks：useCallback 用于性能优化、useState 用于内部显隐状态
import { useCallback, useState } from 'react';
// 引入国际化 Hook，用于读取「显示/隐藏」多语言文案
import { useI18n } from '@/hooks';
// 引入 classnames 工具函数，用于合并类名
import { cn } from '@/lib/utils';

// 组件 Props 类型定义：
// 从原生 input 的 Props 中排除 type 和 autoComplete（由组件内部接管），
// 再叠加 SecretInput 专属属性
export type SecretInputProps = Omit<
	React.ComponentProps<'input'>,
	'type' | 'autoComplete'
> & {
	/** 外层 relative 容器的自定义类名 */
	wrapperClassName?: string;
	/** 是否显示明文切换按钮，默认 true */
	revealable?: boolean;
	/** 无值时禁用切换按钮，默认 true */
	disableToggleWhenEmpty?: boolean;
	/** 显示明文按钮的 aria-label 文案（可覆盖默认 i18n） */
	showLabel?: string;
	/** 隐藏明文按钮的 aria-label 文案（可覆盖默认 i18n） */
	hideLabel?: string;
	/** autoComplete 属性，默认 'new-password' 阻止浏览器自动填充历史密码 */
	autoComplete?: string;
	/** 受控明文状态；不传则组件内部管理 */
	revealed?: boolean;
	/** 受控模式下显隐状态变化回调 */
	onRevealedChange?: (revealed: boolean) => void;
	/** 非受控模式下的默认显隐状态，默认 false（密文） */
	defaultRevealed?: boolean;
};

// SecretInput 组件函数定义
function SecretInput({
	// 输入框本身的类名
	className,
	// 外层容器的类名
	wrapperClassName,
	// 是否可显隐，默认 true
	revealable = true,
	// 空值时是否禁用切换，默认 true
	disableToggleWhenEmpty = true,
	// 显示按钮自定义文案
	showLabel,
	// 隐藏按钮自定义文案
	hideLabel,
	// autoComplete 默认值为 new-password
	autoComplete = 'new-password',
	// 受控显隐值（可选）
	revealed: revealedProp,
	// 受控显隐变化回调
	onRevealedChange,
	// 非受控默认显隐值，默认 false
	defaultRevealed = false,
	// 是否禁用
	disabled,
	// 输入框的值
	value,
	// 剩余 props 透传给内部 Input
	...props
}: SecretInputProps) {
	// 获取 i18n 翻译函数
	const { t } = useI18n();
	// 内部显隐状态（非受控模式下使用）
	const [internalRevealed, setInternalRevealed] = useState(defaultRevealed);
	// 实际生效的显隐值：受控模式取 revealedProp，非受控模式取内部 state
	const revealed = revealedProp ?? internalRevealed;

	// 统一的设置显隐函数，同时兼容受控/非受控模式
	const setRevealed = useCallback(
		(next: boolean | ((prev: boolean) => boolean)) => {
			// 解析新值：支持函数式更新（与 useState 一致）
			const resolved =
				typeof next === 'function'
					? next(revealedProp ?? internalRevealed)
					: next;
			// 如果有回调，通知父组件（受控模式必备）
			onRevealedChange?.(resolved);
			// 非受控模式下才更新内部 state
			if (revealedProp === undefined) {
				setInternalRevealed(resolved);
			}
		},
		// 依赖项：内部 state、回调函数、受控 prop
		[internalRevealed, onRevealedChange, revealedProp],
	);

	// 判断输入框是否有值（用于空值禁用切换按钮）
	const hasValue = value != null && String(value).length > 0;
	// 切换按钮是否禁用：组件整体禁用 || (空值禁用开关打开 && 无值)
	const toggleDisabled = disabled || (disableToggleWhenEmpty && !hasValue);
	// 显示按钮的 aria-label：优先用传入的 showLabel，否则取 i18n 的「显示密钥」
	const showAriaLabel = showLabel ?? t('setting.llm.showApiKey');
	// 隐藏按钮的 aria-label：优先用传入的 hideLabel，否则取 i18n 的「隐藏密钥」
	const hideAriaLabel = hideLabel ?? t('setting.llm.hideApiKey');
	// 实际输入框 type：可显隐且当前为密文时用 password，否则用 text
	const inputType = revealable && !revealed ? 'password' : 'text';

	return (
		// 外层容器：relative 定位（眼睛按钮绝对定位在右侧）、w-full 撑满
		<div className={cn('relative w-full', wrapperClassName)}>
			{/* 内部 Input 组件 */}
			<Input
				// type 由显隐状态动态决定
				type={inputType}
				// 值透传
				value={value}
				// 禁用态透传
				disabled={disabled}
				// autoComplete 透传（默认 new-password）
				autoComplete={autoComplete}
				// 合并类名：可显隐时右侧留出 pr-10 放眼睛按钮
				className={cn(revealable && 'pr-10', className)}
				// 其余 props 透传（placeholder、onChange、id 等）
				{...props}
			/>
			{/* 仅当 revealable 为 true 时渲染显隐切换按钮 */}
			{revealable ? (
				<Button
					// 按钮类型为普通按钮，避免触发表单提交
					type="button"
					// ghost 变体（透明背景）
					variant="ghost"
					// icon 尺寸
					size="icon"
					// tabIndex=-1：眼睛按钮不参与 Tab 键导航，
					// 配合 useInputsOnlyTab 让 Tab 只停在输入框本身
					tabIndex={-1}
					// 绝对定位：垂直居中、右侧 1.5 单位、尺寸 24x24
					className="absolute top-1/2 right-1.5 size-6 -translate-y-1/2 text-textcolor/55 hover:text-textcolor"
					// 禁用态（空值或整体禁用）
					disabled={toggleDisabled}
					// 无障碍标签：根据当前状态切换
					aria-label={revealed ? hideAriaLabel : showAriaLabel}
					// 点击切换显隐
					onClick={() => setRevealed((v) => !v)}
				>
					{/* 根据显隐状态渲染不同图标 */}
					{revealed ? (
						// 明文状态：显示「闭眼」图标（点击后切回密文）
						<EyeOff className="size-4" aria-hidden />
					) : (
						// 密文状态：显示「睁眼」图标（点击后切到明文）
						<Eye className="size-4" aria-hidden />
					)}
				</Button>
			) : null}
		</div>
	);
}

// 默认导出组件
export default SecretInput;
```

---

## 4. 关键设计点

### 4.1 受控 + 非受控双模式

组件同时支持两种使用方式：

- **非受控（默认）**：不传 `revealed` / `onRevealedChange`，组件自己 `useState` 管理，调用方只管拿 `value`。适用大多数场景（登录、注册、API Key 输入）。
- **受控**：传入 `revealed` + `onRevealedChange`，父组件完全掌控显隐状态。适用需要外部联动（如「显示所有密钥」批量开关）的场景。

实现思路：内部维护 `internalRevealed`，用 `revealedProp ?? internalRevealed` 决定当前值；`setRevealed` 同时回调父组件（若受控）和更新内部 state（若非受控）。

### 4.2 Tab 序友好

显隐按钮设置了 `tabIndex={-1}`，使眼睛按钮**不参与 Tab 键导航**。配合全局 `useInputsOnlyTab` Hook（见 use-inputs-only-tab.md），用户按 Tab 只会停在 `input` 上，跳过辅助按钮，提升表单填写效率。

### 4.3 默认 `autoComplete = 'new-password'`

默认使用 `new-password` 而非 `current-password`，避免浏览器对 API Key / 新密码场景弹出历史密码自动填充。登录页等「已有密码」场景需显式传入 `autoComplete="current-password"`。

### 4.4 空值禁用切换

`disableToggleWhenEmpty`（默认 `true`）：输入框为空时禁用眼睛按钮，避免用户点了也无内容可看。当 `value` 非空时自动恢复可用。

---

## 5. 使用示例

### 5.1 最简用法（密码框）

```tsx
import SecretInput from '@design/SecretInput';

<SecretInput
  placeholder="请输入密码"
  value={password}
  onChange={(e) => setPassword(e.target.value)}
/>
```

### 5.2 登录页（当前密码自动填充）

```tsx
<SecretInput
  placeholder="请输入密码"
  autoComplete="current-password"
  showLabel={t('auth.showPassword')}
  hideLabel={t('auth.hidePassword')}
  {...field}
/>
```

### 5.3 API Key 场景（设置页）

```tsx
<SecretInput
  key={savedApiKey}
  id="llm-api-key"
  value={apiKey}
  onChange={(e) => setApiKey(e.target.value)}
  placeholder={t('setting.llm.apiKeyPlaceholder')}
  disabled={saving}
  className={cn(fieldInputClass, 'w-full')}
/>
```

---

## 6. 影响范围

| 模块 | 文件 | 改动类型 |
|------|------|----------|
| 设计系统 | `apps/frontend/src/components/design/SecretInput/index.tsx` | **新增** |
| LLM 设置页 | `apps/frontend/src/views/setting/llm/index.tsx` | 两个 API Key 输入框改用组件（删除 `showApiKey`/`showVectorApiKey` state 及眼睛按钮） |
| 云 TTS 设置页 | `apps/frontend/src/views/setting/cloudTts/index.tsx` | `PrefTextField` 内 secret 分支改用组件（删除 `visible` state 及眼睛按钮） |
| 登录页 | `apps/frontend/src/views/login/login-form.tsx` | 密码框改用组件 |
| 注册页 | `apps/frontend/src/views/login/register-form.tsx` | 密码框改用组件 |
| 找回密码页 | `apps/frontend/src/views/login/forget-pwd-form.tsx` | 密码 + 确认密码框改用组件 |
| 国际化 | `apps/frontend/src/i18n/locales/zh-CN.ts` / `en-US.ts` | 新增 `auth.showPassword` / `auth.hidePassword` 两条文案 |

---

## 7. 延伸阅读

- use-inputs-only-tab.md — 全局 Tab 序策略，与 `SecretInput` 的 `tabIndex={-1}` 配合
- [设置API密钥SecretInput.md](./设置API密钥SecretInput.md) — 设置页 API Key 改造专题
- [登录密码SecretInput标签.md](./登录密码SecretInput标签.md) — 登录页密码框 + Tab 序改造专题
