# 登录页密码显隐按钮 + 全局 Tab 仅输入框导航

本文档记录两项与「表单输入体验」相关的改动：
1. **登录/注册/找回密码页密码输入框** 增加「眼睛按钮」切换明文/密文（使用 `@design/SecretInput` 组件）
2. **新增 `useInputsOnlyTab` Hook**：全局 Tab 键导航仅停在 `input` / `textarea` / `select` 上，按钮和链接跳过，加快表单填写

两项改动均落在 `apps/frontend` 前端应用壳层。

---

## 1. 密码输入框增加显隐切换

### 1.1 改动前

登录、注册、找回密码三个页面的密码框都使用原生 `<Input type="password">`，用户无法查看自己输入的内容，输错了只能全删重输。

**改动前代码（以登录页为例）**：

```tsx
<FormItem>
    <FormLabel className="text-md">{t('auth.password')}</FormLabel>
    <FormControl>
        {/* 原生 password 类型输入框，无显隐功能 */}
        <Input
            type="password"
            placeholder={t('auth.password.placeholder')}
            {...field}
        />
    </FormControl>
</FormItem>
```

注册页、找回密码页（密码 + 确认密码共 2 个框）的代码结构完全一致。

### 1.2 改动后

统一替换为 `@design/SecretInput` 组件，右侧出现眼睛按钮，点击可切换明文/密文。

**改动后代码（登录页）**：

```tsx
// 顶部引入 SecretInput 组件
import SecretInput from '@design/SecretInput';

// ...

<FormItem>
    <FormLabel className="text-md">{t('auth.password')}</FormLabel>
    <FormControl>
        {/* 替换为 SecretInput，获得内置显隐按钮 */}
        <SecretInput
            placeholder={t('auth.password.placeholder')}
            {/* 登录页用 current-password，允许浏览器自动填充已保存密码 */}
            autoComplete="current-password"
            {/* 自定义按钮 aria-label（组件默认用 setting.llm.* 文案，不适合登录场景） */}
            showLabel={t('auth.showPassword')}
            hideLabel={t('auth.hidePassword')}
            {/* 其余 props（value、onChange 等）由 react-hook-form 的 field 透传 */}
            {...field}
        />
    </FormControl>
</FormItem>
```

### 1.3 各页面差异

| 页面 | 文件 | 密码框数量 | autoComplete | 说明 |
|------|------|-----------|--------------|------|
| 登录 | `views/login/login-form.tsx` | 1 | `current-password` | 允许浏览器自动填充已有密码 |
| 注册 | `views/login/register-form.tsx` | 1 | `new-password` | 新密码，不触发历史密码填充 |
| 找回密码 | `views/login/forget-pwd-form.tsx` | 2 | `new-password` | 新密码 + 确认新密码 |

### 1.4 新增国际化文案

**`zh-CN.ts` / `en-US.ts`** 新增两条：

```typescript
// 显示密码按钮的无障碍标签
'auth.showPassword': '显示密码',
// 隐藏密码按钮的无障碍标签
'auth.hidePassword': '隐藏密码',
```

（英文对应：`Show password` / `Hide password`）

---

## 2. 全局 Tab 仅输入框导航（useInputsOnlyTab）

### 2.1 背景与目标

用户在填写表单（尤其是登录、注册等多输入框场景）时，按 Tab 键希望快速跳到下一个输入框。但默认行为下 Tab 会经过所有可聚焦元素（按钮、链接、图标等），需要按很多次才能到达下一个输入框。

**目标**：全站范围内，Tab 键仅在 `input` / `textarea` / `select` 之间跳转，跳过按钮、链接等非输入控件。按钮和链接仍然可以用鼠标点击，或通过表单的 Enter 键提交。

### 2.2 实现原理

通过 `MutationObserver` 监听 `document.body` 的 DOM 变化，每当有新元素插入时，在 `requestAnimationFrame` 中批量将非表单控件的 `tabIndex` 设为 `-1`，使其不参与 Tab 序。

### 2.3 完整源码（逐行注释）

**来源**：`apps/frontend/src/hooks/useInputsOnlyTab.ts`

```typescript
// 引入 useLayoutEffect，在 DOM 绘制前同步执行，避免 Tab 行为闪烁
import { useLayoutEffect } from 'react';

/**
 * 可能进入 Tab 序的非表单控件选择器
 * （不含 input/textarea/select 本身，后面会单独排除）
 */
const NON_FIELD_FOCUSABLE =
	'button, a[href], area[href], iframe, object, embed, summary, [tabindex]:not([tabindex="-1"])';

/**
 * 将 root 下所有非输入框的可聚焦元素的 tabIndex 设为 -1，
 * 使 Tab 键只停在 input / textarea / select 上。
 */
function applyInputsOnlyTab(root: ParentNode) {
	// 遍历所有匹配的可聚焦元素
	for (const el of root.querySelectorAll<HTMLElement>(NON_FIELD_FOCUSABLE)) {
		// 如果本身就是 input/textarea/select，跳过（保留可聚焦）
		if (el.matches('input, textarea, select')) continue;
		// 设置 tabIndex=-1：元素仍可通过鼠标/编程方式聚焦，但不参与 Tab 序
		el.tabIndex = -1;
	}
}

/**
 * 全站 Tab 顺序：仅 input / textarea / select 可聚焦；
 * 按钮与链接仍可用鼠标或表单 Enter 键提交。
 *
 * 监听 document.body，包含 Portal 弹层；
 * MutationObserver 合并 rAF 以减轻高频 DOM 更新的性能开销。
 */
export function useInputsOnlyTab() {
	// useLayoutEffect 确保首次渲染时 Tab 序就已就绪，避免用户刚进来 Tab 乱跑
	useLayoutEffect(() => {
		// 监听根节点：document.body（覆盖整个页面，包括 Portal 渲染的弹窗）
		const root = document.body;
		// rAF 帧 id，用于合并多次 Mutation 通知
		let raf = 0;
		// 调度一次应用：合并多次 DOM 变动到同一帧内执行
		const scheduleApply = () => {
			// 取消上一次未执行的 rAF，避免短时间内多次执行
			cancelAnimationFrame(raf);
			// 在下一帧执行
			raf = requestAnimationFrame(() => applyInputsOnlyTab(root));
		};

		// 首次执行：初始化当前页面的 Tab 序
		scheduleApply();
		// 创建 MutationObserver，监听 DOM 变化
		const observer = new MutationObserver(scheduleApply);
		// 开始观察：子节点增减 + 后代子树
		observer.observe(root, { childList: true, subtree: true });
		// 清理函数：组件卸载时取消 rAF 并断开观察
		return () => {
			cancelAnimationFrame(raf);
			observer.disconnect();
		};
	}, []);
}
```

### 2.4 挂载位置

在应用根组件 `App` 中调用一次即可全局生效。

**文件**：`apps/frontend/src/router/index.tsx`

```tsx
// 引入 Hook
import { useInputsOnlyTab } from '@/hooks';

const App = () => {
	// 在应用根组件调用，全局生效
	useInputsOnlyTab();

	// ... 其余逻辑
};
```

### 2.5 与 `SecretInput` 的配合

`SecretInput` 组件内部的眼睛按钮本身已设置 `tabIndex={-1}`，即使没有 `useInputsOnlyTab` 也不会被 Tab 聚焦。加上全局 Hook 后形成**双重保障**，并将这一策略扩展到全站所有按钮和链接。

### 2.6 注意事项

| 场景 | 影响 | 应对 |
|------|------|------|
| 纯按钮页（如分享页操作栏） | Tab 会跳过所有按钮 | 设计上仍可通过鼠标点击，或表单 Enter 提交；特殊页面可在组件内手动覆盖 `tabIndex` |
| Portal 弹层（Dialog 等） | MutationObserver 监听 subtree，弹层打开后会自动处理 | 无需额外操作 |
| 动态渲染的列表 | 每次 DOM 变化都会触发 rAF 批量更新 | 已合并到 rAF，性能开销可忽略 |
| 无障碍（A11y） | 纯键盘用户可能无法 Tab 到按钮 | 但表单场景下 Enter 即可提交，且 `SecretInput` 的眼睛按钮可用 `type="password"` 替代；本策略偏向「快速填表」效率优先 |

---

## 3. 涉及文件清单

| 文件 | 改动 |
|------|------|
| `apps/frontend/src/components/design/SecretInput/index.tsx` | **新增** — 密码/密钥输入组件 |
| `apps/frontend/src/hooks/useInputsOnlyTab.ts` | **新增** — Tab 仅输入框导航 Hook |
| `apps/frontend/src/hooks/index.ts` | 导出 `useInputsOnlyTab` |
| `apps/frontend/src/router/index.tsx` | 根组件调用 `useInputsOnlyTab()` |
| `apps/frontend/src/views/login/login-form.tsx` | 密码框改用 `SecretInput` |
| `apps/frontend/src/views/login/register-form.tsx` | 密码框改用 `SecretInput` |
| `apps/frontend/src/views/login/forget-pwd-form.tsx` | 密码 + 确认密码框改用 `SecretInput` |
| `apps/frontend/src/i18n/locales/zh-CN.ts` | 新增 `auth.showPassword` / `auth.hidePassword` |
| `apps/frontend/src/i18n/locales/en-US.ts` | 新增英文翻译 |

---

## 4. 延伸阅读

- [SecretInput组件.md](./SecretInput组件.md) — `SecretInput` 组件完整设计与源码
- [设置API密钥SecretInput.md](./设置API密钥SecretInput.md) — 设置页 API Key 输入框改用 `SecretInput` 专题
