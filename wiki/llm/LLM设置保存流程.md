# 大模型设置页：保存即启用与底部状态提示

> **文档角色（主文档）**：移除「使用自定义大模型配置」Switch；**保存**写入并启用自定义配置，**恢复默认**清空自定义；底部四态文案与「可保存」按钮联动。  
> **延伸阅读**：[`会员单用户LLM.md`](./会员单用户LLM.md)（按账号与会员默认）、[`LLM设置UI预设.md`](./LLM设置UI预设.md)（预设联动与 Combobox）。

若与仓库最新源码不一致，**以源码为准**。

---

## 1. 背景与目标

### 1.1 问题

改前需 **先开 Switch、再填表、再保存** 两步启用；底部「生效中」与 Switch 状态易不一致；恢复默认后表单预填默认项仍被算作「有未保存修改」。

### 1.2 改后 UX

| 操作 | 行为 |
|------|------|
| **保存** | 始终 `enabled: true` 提交；成功后底部绿色「{模型名} 模型配置生效中」 |
| **恢复默认配置** | 调用 `clearLlmSettings`；表单回到会员/非会员默认预设；底部灰色「当前默认 {模型名} 模型生效中」 |
| **编辑未保存** | 底部琥珀「有未保存更改，请保存」或「可保存设置让自定义模型生效」 |
| **必填未齐** | 底部灰色「请补全三项内容后再保存让模型生效」；保存按钮禁用 |

表单字段**始终可编辑**（不再 `disabled={!enabled}`）。

---

## 2. 改动范围

| 路径 | 职责 |
|------|------|
| `apps/frontend/src/views/setting/llm/index.tsx` | `footerHint`、`hasDraftChanges`、`onSave` / `onClear` |
| `apps/frontend/src/i18n/locales/zh-CN.ts`、`en-US.ts` | `activeHint`、`defaultHint`、`readyToSaveHint`、`incompleteDraftHint` |

---

## 3. 实现思路

### 3.1 保存即启用

`onSave` 固定 `updateLlmSettings({ enabled: true, ... })`，不再读页面 Switch。用户意图由「点保存」表达。

### 3.2 恢复默认 = 关闭自定义

`onClear` → `clearLlmSettings()`，后端 `active: false`；前端用 `getProviderDefaults(isMember)` 重填 Base URL / 模型 / Key 展示。

### 3.3 `hasDraftChanges` 双基线

- **`view.active === true`**：与已保存服务端字段比（`hasUnsavedChanges`）。
- **`view.active === false`**：与 `inactiveFormBaseline` 比——若服务端无存储字段，基线为会员/非会员默认 env 预设；避免恢复默认后误报待保存。

### 3.4 `footerHint` 四态

1. 已生效且无草稿 → **active**（绿）
2. 无草稿且未生效 → **default**（灰，默认模型名）
3. 有草稿但 `canSave` 为 false（缺 Key/URL/模型）→ **default** + incomplete 文案
4. 有草稿且可保存 → **pending**（琥珀）

`canSubmitSave = canSave && hasDraftChanges`，避免无改动时重复提交。

---

## 4. 关键代码与注释

### 4.1 未启用时的表单基线

**来源**：`apps/frontend/src/views/setting/llm/index.tsx`（约 L253–L274）

```typescript
/** 未启用自定义时，表单与基线一致则视为「无待保存修改」（含恢复默认后的预填项） */
const inactiveFormBaseline = useMemo(() => {
	const hasStoredFields =
		Boolean(view?.baseUrl?.trim()) ||
		Boolean(view?.modelName?.trim()) ||
		Boolean(savedApiKey);
	if (hasStoredFields) {
		// 说明：服务端曾有字段但未 active 时，仍以已存值为基线
		return {
			baseUrl: resolveTextField(view?.baseUrl, providerDefaults.baseUrl),
			modelName: resolveTextField(view?.modelName, providerDefaults.modelName),
			apiKey: savedApiKey || providerDefaults.apiKey,
		};
	}
	// 说明：完全无存储 → 与会员/非会员默认 env 一致，不算「有改动」
	return {
		baseUrl: providerDefaults.baseUrl,
		modelName: providerDefaults.modelName,
		apiKey: providerDefaults.apiKey,
	};
}, [providerDefaults, savedApiKey, view?.baseUrl, view?.modelName]);
```

### 4.2 底部提示与保存条件

**来源**：`apps/frontend/src/views/setting/llm/index.tsx`（约 L276–L323、L334–L344）

```typescript
const hasDraftChanges = useMemo(() => {
	if (view?.active) return hasUnsavedChanges;
	return (
		baseUrl.trim() !== inactiveFormBaseline.baseUrl.trim() ||
		modelName.trim() !== inactiveFormBaseline.modelName.trim() ||
		apiKey.trim() !== inactiveFormBaseline.apiKey.trim()
	);
}, [/* ... */]);

const canSubmitSave = canSave && hasDraftChanges;

const footerHint = useMemo(() => {
	if (view?.active && !hasDraftChanges) {
		return { tone: 'active' as const, message: t('setting.llm.activeHint', { modelName: /* ... */ }) };
	}
	if (!hasDraftChanges) {
		return { tone: 'default' as const, message: t('setting.llm.defaultHint', { modelName: providerDefaults.modelName }) };
	}
	if (!canSave) {
		return { tone: 'default' as const, message: t('setting.llm.incompleteDraftHint') };
	}
	return {
		tone: 'pending' as const,
		message: view?.active ? t('setting.llm.unsavedHint') : t('setting.llm.readyToSaveHint'),
	};
}, [/* ... */]);

const onSave = async () => {
	// 说明：不再依赖 Switch；保存即 enabled: true
	const res = await updateLlmSettings({
		enabled: true,
		baseUrl: baseUrl.trim(),
		modelName: modelName.trim(),
		...(!keyUnchanged && trimmedKey ? { apiKey: trimmedKey } : {}),
	});
};
```

---

## 5. 兼容性与影响

| 项 | 说明 |
|----|------|
| API | 仍用既有 `updateLlmSettings` / `clearLlmSettings`；仅前端交互变化 |
| 会员默认 | 未保存自定义时，后端 `createLlm` 仍按会员硅基 / 非会员 GLM |
| 破坏性 | 无；用户需 **点保存** 才会启用自定义（不再误触 Switch） |

### 建议回归

1. 新用户进入页 → 底部默认模型灰字，保存禁用直至有改动且三项齐全。
2. 填完保存 → 绿字生效；改一项 → 琥珀未保存；再保存恢复绿字。
3. 恢复默认 → 灰字默认模型，保存禁用（与预填一致）。
4. 切换预设清空 Key 后， incomplete 文案与按钮禁用。

---

## 6. 相关源码路径

| 说明 | 路径 |
|------|------|
| 设置页 | `apps/frontend/src/views/setting/llm/index.tsx` |
| 后端读写 | `apps/backend/src/services/settings/`（LLM 用户配置，见 会员单用户LLM.md） |
