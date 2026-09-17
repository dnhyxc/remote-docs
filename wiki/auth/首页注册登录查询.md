# 首页「快速开始」步骤与登录页 `?mode=register`：实现说明

## 1. 背景与目标

- **产品诉求**：用户在首页「快速开始」区块的**步骤列表**中，点击第 **2** 步「注册账号」卡片（整行可点）应进入**账号注册**流程，而不是误绑在顶栏其它按钮上。
- **技术目标**：登录页 `/login` 支持通过 **Query String（查询字符串）** `mode=register` 直接打开注册表单；页内「登录 / 注册」切换时 **URL 与界面状态一致**，便于分享链接与刷新后仍落在正确视图。
- **顺带行为**：步骤 **4**（「开始使用」类文案）点击后进入 **`/chat`**（智能对话），避免步骤区只有第 1 步有交互、后几步无反馈。

## 2. 改动范围（以当前仓库与近期 `git diff` 为准）

| 路径 | 说明 |
|------|------|
| `apps/frontend/src/views/home/index.tsx` | `STEPS` 增加 `navigateRegister` / `navigateChat`；步骤列表 `onClick` 分支；顶栏主按钮处理函数更名为 `onClickQuickStart` 仍进 `/chat` |
| `apps/frontend/src/views/login/index.tsx` | `useSearchParams` 读写 `mode=register`；`onRegister` 支持显式布尔并同步 URL；`switchLogin` 清空 query；底部链接触发改为 `() => onRegister()` 避免类型冲突 |

## 3. 实现思路

1. **为何用 Query 而不是新路由 `/register`**  
   注册 UI 已集中在 `Login` 组件内（`RegisterForm`），复用同一页可减少路由与布局分叉；`?mode=register` 为**浅层状态**，与「去注册」链接触发同一套 `isRegister` 逻辑。

2. **为何步骤数据用布尔开关字段**  
   `STEPS` 为 `useMemo` 生成的配置数组：第 1 步已有 `downloadDesktop`；为第 2、4 步增加 **`navigateRegister` / `navigateChat`**，在 `onClick` 里 **`if / else if`** 分支清晰，避免用 `step === '2'` 等魔法数字导致改文案序号时误伤。

3. **为何 `onRegister` 接收可选 `status`**  
   `RegisterForm` 在注册成功后会调用 `onRegister(false)` 切回登录；原先仅 `toggle` 时语义不直观。改为 **`next = status ?? !isRegister`** 后，成功回调与底部「去登录 / 去注册」共用同一函数。

4. **为何 `setSearchParams` 与 `replace: true`**  
   使用 **`replace`** 避免用户从「注册」切到「登录」时在浏览器历史里堆叠大量相同 `/login` 记录；清空 query 用 **`setSearchParams({})`**。

5. **为何底部按钮 `onClick={() => onRegister()}`**  
   `Button` 的 `onClick` 类型为 `MouseEventHandler`，若直接传 `onRegister`，会把 **MouseEvent** 当成 `status?: boolean` 的第一个参数，触发 **TypeScript** 报错；包一层箭头函数可消参。

6. **顶栏「快速开始」与步骤区的职责划分**  
   顶栏主按钮仍 **`navigate('/chat')`**，作为全局「进产品」快捷入口；**注册账号**由步骤第 2 步承担，避免一个按钮承担两种易混淆的产品语义。

## 4. 关键代码与注释

### 4.1 首页：`STEPS` 配置与点击路由

**来源**：`apps/frontend/src/views/home/index.tsx`（约 L56–L87、L145–L147、L364–L374）

```typescript
// 说明：步骤区数据由 useMemo 生成，依赖 t / locale，切换语言时标题与描述会更新。
const STEPS = useMemo(
	() => [
		{
			step: '1',
			// ... 标题、描述、icon、color 略
			/** 在默认浏览器打开桌面端下载落地页 */
			downloadDesktop: true, // 说明：唯一「外链下载」分支，点击走 openExternalUrl。
		},
		{
			step: '2',
			// ... title 使用 home.steps.register.*，即「注册账号」等 i18n
			/** 点击后进入登录页「账号注册」视图 */
			navigateRegister: true, // 说明：自定义标记；在 onClick 里与 downloadDesktop 互斥分支处理。
		},
		{
			step: '4',
			// ... start 相关文案
			/** 点击后进入智能对话 */
			navigateChat: true, // 说明：进入应用内 /chat，与顶栏快速开始一致。
		},
	],
	[t, locale],
);

// 说明：顶栏主按钮专用；与步骤第 2 步「注册」解耦，避免同一 CTA 语义过载。
const onClickQuickStart = () => {
	navigate('/chat'); // 说明：React Router 编程式导航，进入智能对话主界面。
};

// 说明：步骤列表每一项为可点击 motion.div；以下为 onClick 核心分支（摘录）。
onClick={() => {
	if (item.downloadDesktop) {
		// 说明：仅第 1 步为 true；void 显式忽略 Promise，满足 @typescript-eslint 等规则习惯。
		void openExternalUrl(getDesktopDownloadAbsoluteUrl(locale));
	} else if (item.navigateRegister) {
		// 说明：带 query 进入登录页；Login 首屏即 isRegister=true（见下一节）。
		navigate('/login?mode=register');
	} else if (item.navigateChat) {
		navigate('/chat'); // 说明：第 4 步与顶栏快速开始一致。
	}
}}
```

### 4.2 登录页：Query 与 `isRegister` 同步

**来源**：`apps/frontend/src/views/login/index.tsx`（约 L11–L39、L99–L104）

```typescript
// 说明：useSearchParams 来自 react-router，读写当前 URL 的 search 部分（如 ?mode=register）。
const [searchParams, setSearchParams] = useSearchParams();
// 说明：useState 惰性初始化，首次渲染即读取 URL，避免先闪「登录」再 useEffect 切「注册」。
const [isRegister, setIsRegister] = useState(
	() => searchParams.get('mode') === 'register',
);

// 说明：统一处理「底部链接切换」与「注册表单成功回调 onRegister(false)」。
const onRegister = (status?: boolean) => {
	const next = status !== undefined ? status : !isRegister; // 说明：有参则强制目标态，无参则 toggle。
	setIsRegister(next);
	setIsForget(false); // 说明：从注册/登录切走时关闭忘记密码视图。
	if (next) {
		// 说明：进入注册态时写入 query，便于刷新、复制链接仍打开注册。
		setSearchParams({ mode: 'register' }, { replace: true });
	} else {
		// 说明：回登录态时去掉 mode，避免与「当前是登录表单」不一致。
		setSearchParams({}, { replace: true });
	}
};

// 说明：忘记密码流程结束回到登录时，同步清掉 register query。
const switchLogin = () => {
	setIsRegister(false);
	setIsForget(false);
	setSearchParams({}, { replace: true });
};

// 说明：必须包一层箭头函数，禁止把 onRegister 直接赋给 onClick（否则 MouseEvent 会传入 status）。
<Button variant="link" onClick={() => onRegister()}>
	{isRegister ? t('auth.login.go') : t('auth.register.go')}
</Button>
```

## 5. 兼容性与影响

- **深链接**：任意入口 `navigate('/login?mode=register')`（含首页步骤）均可打开注册；依赖 `Login` 组件挂载时 `useState` 初始化读取 query。
- **注册成功**：`RegisterForm` 内 `onRegister(false)` 会清 query 并显示登录表单；若后续希望在成功後直接 `navigate('/chat')`，需在产品层另议（当前未改）。
- **回归建议**：首页依次点击步骤 1（下载）、2（注册）、4（对话）；登录页手动改 URL 带/不带 `mode`；注册成功返回登录；忘记密码返回登录后 URL 无残留 `mode`。

## 6. 相关源码路径

| 说明 | 路径 |
|------|------|
| 首页步骤与顶栏快速开始 | `apps/frontend/src/views/home/index.tsx` |
| 登录 / 注册 / Query 同步 | `apps/frontend/src/views/login/index.tsx` |
| 步骤文案（注册标题/描述） | `apps/frontend/src/i18n/locales/zh-CN.ts`、`en-US.ts` 中 `home.steps.register.*` |
| 侧栏菜单顺序（若与产品排序有关） | `apps/frontend/src/components/design/Sidebar/enum.ts` |

若与仓库最新源码不一致，以源码为准。
