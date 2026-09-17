# 大模型设置页：预设联动、可输入 Combobox 与 API Key 环境默认

> **文档角色**：本轮**前端**设置页 `/setting/llm` 的 Combobox 与服务商预设联动（不含后端持久化变更）。  
> **延伸阅读**：[LLM设置保存流程.md](./LLM设置保存流程.md)、[LLM运行时设置.md](./LLM运行时设置.md)（**API Key 回显、向量 tier 联动、切换不清 Key** — 主文档）、[创建LLM.md](./创建LLM.md)。

> **API Key 与 env**：早期版本用 `VITE_SILICONFLOW_API_KEY` 预填并在切换预设时清空 Key；**当前行为**见 [LLM运行时设置.md](./LLM运行时设置.md) §3.3–§3.5（仅接口回显已保存 Key，切换保留 Key）。

若与仓库最新源码不一致，**以源码为准**。

---

## 1. 背景与目标

### 1.1 问题

- Base URL / 模型名原先为纯文本框，硅基与 DeepSeek 需手抄地址，易填错且两项不一致。
- 设置页在 `ScrollArea` 内，若用 Radix Popover 做下拉，列表易错位到视口左上角。
- 未在服务端保存过 API Key 时输入框为空，本地开发需在页面填写 Key 并保存（**不再**从 `VITE_*` 自动填入）。

### 1.2 目标

- **可输入 + 预设**：左侧直接编辑，右侧按钮展开与输入框**同宽**的预设列表。
- **服务商联动**：选中硅基 URL 时自动配对 GLM-5.1；选中 DeepSeek URL 时自动配对 `deepseek-chat`（反向选模型亦同步 URL）。
- **API Key**：仅回显服务端已保存 Key；切换预设**不清空** Key（详见 [LLM运行时设置.md](./LLM运行时设置.md) §3.3–§3.4）。
- **生效文案**：底部提示展示当前模型名，如「Pro/zai-org/GLM-5.1 模型配置生效中」。

---

## 2. 改动范围

| 路径 | 说明 |
|------|------|
| `apps/frontend/src/views/setting/llm/index.tsx` | 预设表、联动 Map、`resolveApiKeyFields`、`CreatableCombobox` |
| `apps/frontend/src/components/ui/combobox.tsx` | 新建 `CreatableCombobox` |
| `apps/frontend/src/components/ui/index.tsx` | 导出 combobox / command / popover |
| `apps/frontend/src/components/ui/command.tsx`、`popover.tsx` | shadcn 脚手架（`cmdk`、`@radix-ui/react-popover`），**当前 LLM 页未引用** |
| `apps/frontend/src/vite-env.d.ts` | `VITE_SILICONFLOW_API_KEY` 类型 |
| `apps/frontend/src/i18n/locales/zh-CN.ts`、`en-US.ts` | 预设标签、占位符、`activeHint` 插值 |
| `apps/frontend/package.json`、`pnpm-lock.yaml` | 新增 `cmdk`、`@radix-ui/react-popover` |

---

## 3. 实现思路

### 3.1 预设与双向联动

- 常量数组 `LLM_PROVIDER_PRESETS` 集中维护 `baseUrl`、`modelName` 与 i18n key。
- 启动时构建 `LLM_BASE_URL_TO_MODEL`、`LLM_MODEL_TO_BASE_URL` 两个 `Map`。
- `onBaseUrlChange` / `onModelNameChange`：在 `setState` 后若 `trim()` 后的值命中 Map，则同步另一字段；用户手输非预设值时不强制覆盖。

### 3.2 API Key：`displayKey` vs `savedKey`

| 字段 | 含义 |
|------|------|
| `savedApiKey` | 服务端已持久化的 Key（空表示从未保存） |
| `apiKey`（展示） | 仅等于 `savedApiKey`（来自 `GET`）；**不回退** `VITE_*` |

- **保存**：`trimmedKey === savedApiKey.trim()` 时不提交 `apiKey`，避免无意义覆写密文。
- **恢复默认**：`setApiKey('')`，不再写入 env 默认 Key。

完整策略见 [LLM运行时设置.md](./LLM运行时设置.md) §3.3。

### 3.3 CreatableCombobox 不用 Popover

- 列表容器 `absolute top-[calc(100%+4px)] left-0 z-50 w-full`，相对输入列定位，避免 ScrollArea / 变换层导致 Popover 锚点漂移。
- 点击外部（`pointerdown`）与 `Escape` 关闭列表；选项右侧 `CheckIcon` 表示选中。

### 3.4 安全与部署注意

- `VITE_*` 在 `vite build` 时静态替换进 bundle，**不适合**在生产公开仓库中存放真实生产密钥。
- 生产仍应以服务端 env +「设置页保存」或运维注入为准；前端 env 默认仅减轻本地首次填写成本。

---

## 4. 关键代码与注释

### 4.1 预设与 API Key 解析

**来源**：`apps/frontend/src/views/setting/llm/index.tsx`（约 L21–L73）

```typescript
/** 服务商联动预设：选 Base URL 或模型名称中的任一项时，另一项同步为配对值 */
const LLM_PROVIDER_PRESETS = [
	{
		baseUrl: 'https://api.siliconflow.cn/v1',
		modelName: 'Pro/zai-org/GLM-5.1',
		baseUrlLabelKey: 'setting.llm.baseUrlOption.siliconflow' as const,
		modelLabelKey: 'setting.llm.modelOption.glm51' as const,
	},
	{
		baseUrl: 'https://api.deepseek.com',
		modelName: 'deepseek-chat',
		baseUrlLabelKey: 'setting.llm.baseUrlOption.deepseek' as const,
		modelLabelKey: 'setting.llm.modelOption.deepseekChat' as const,
	},
] as const;

const LLM_BASE_URL_TO_MODEL = new Map(
	LLM_PROVIDER_PRESETS.map((p) => [p.baseUrl, p.modelName]),
);

function readEnvSiliconflowApiKey(): string {
	const raw = import.meta.env.VITE_SILICONFLOW_API_KEY;
	return typeof raw === 'string' ? raw.trim() : '';
}

const DEFAULT_LLM_API_KEY = readEnvSiliconflowApiKey();

function resolveApiKeyFields(savedFromServer: string | undefined | null) {
	const saved = (savedFromServer ?? '').trim();
	if (saved) return { displayKey: saved, savedKey: saved };
	// 未持久化：表单展示 env 默认，savedKey 仍为空以便首次保存会提交 apiKey
	return { displayKey: DEFAULT_LLM_API_KEY, savedKey: '' };
}
```

### 4.2 联动 onChange

**来源**：`apps/frontend/src/views/setting/llm/index.tsx`（约 L105–L115）

```typescript
const onBaseUrlChange = useCallback((next: string) => {
	setBaseUrl(next);
	const pairedModel = LLM_BASE_URL_TO_MODEL.get(next.trim());
	if (pairedModel) setModelName(pairedModel);
}, []);

const onModelNameChange = useCallback((next: string) => {
	setModelName(next);
	const pairedBase = LLM_MODEL_TO_BASE_URL.get(next.trim());
	if (pairedBase) setBaseUrl(pairedBase);
}, []);
```

### 4.3 CreatableCombobox 结构

**来源**：`apps/frontend/src/components/ui/combobox.tsx`（约 L64–L120）

```tsx
// 根节点 flex：左侧 relative 包裹 Input + 绝对定位 listbox，右侧 icon 按钮切换 open
<div ref={rootRef} className="flex w-full min-w-0">
	<div className="relative min-w-0 flex-1">
		<Input value={value} onChange={(e) => onChange(e.target.value)} /* ... */ />
		{open ? (
			<div role="listbox" className="absolute top-[calc(100%+4px)] left-0 z-50 w-full ...">
				{options.map((option) => (
					<button
						type="button"
						role="option"
						onClick={() => {
							onChange(option.value);
							setOpen(false);
						}}
					>
						{/* 选中项右侧 CheckIcon */}
					</button>
				))}
			</div>
		) : null}
	</div>
	<Button onClick={() => setOpen((v) => !v)} aria-label={presetsAriaLabel} />
</div>
```

### 4.4 生效提示插值

**来源**：`apps/frontend/src/views/setting/llm/index.tsx`（约 L331–L338）

```tsx
{t('setting.llm.activeHint', {
	modelName: view.modelName?.trim() || modelName.trim() || '—',
})}
```

---

## 5. 兼容性与影响

| 项 | 说明 |
|----|------|
| 后端 API | 无变更；仍 `GET/PUT /api/settings/llm` |
| 已保存配置 | 加载仍以服务端 `baseUrl` / `modelName` / `apiKey` 为准 |
| 清除配置 | 表单项回到硅基默认 URL/模型 + env 默认 Key |
| 自定义 URL | 可手输非预设地址，不会触发 Map 联动 |

### 5.1 建议回归

1. 开启自定义 → 从预设选硅基 / DeepSeek，确认另一字段联动。
2. 手输第三方 Base URL，确认模型名不被误改。
3. 无服务端 Key + 本地 `.env` 有 `VITE_SILICONFLOW_API_KEY`：打开页应回显；保存后刷新仍来自服务端。
4. 「恢复环境变量」后 Key 回到 env 默认（非空 env 时）。
5. 设置页在 `ScrollArea` 内展开预设列表，位置应在输入框正下方。

---

## 6. 相关源码路径

| 说明 | 路径 |
|------|------|
| 设置页 UI | `apps/frontend/src/views/setting/llm/index.tsx` |
| Combobox 组件 | `apps/frontend/src/components/ui/combobox.tsx` |
| 运行时持久化（后端） | `docs/llm/LLM运行时设置.md` |
| 环境变量类型 | `apps/frontend/src/vite-env.d.ts` |

本地开发在 `apps/frontend/.env` 配置（勿提交真实密钥到公开仓库）：

```env
VITE_SILICONFLOW_API_KEY=
```

修改后需**重启 Vite** 开发服务器。
