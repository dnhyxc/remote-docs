# 英语学习：快捷意图与输入框联动及名著导读意图文案

## 1. 背景与目标

- **快捷意图**：左栏「快捷意图」芯片选中后，`englishAgentStore.pendingIntentPrefix` 会在用户下次发送消息时拼到正文前（与 chip 展示名 `englishLearning.chip.*` 不同，前缀为长文案 `englishLearning.intent.*`）。
- **产品诉求**：选中芯片时，将**意图名称**（短标签）自动填入右侧 Agent 输入框，并**自动聚焦**；取消选中时，尽量只移除自动填入的那段，保留用户自己追加的内容；发送或新对话时避免 ref 状态残留。
- **文案诉求**：「名著导读」附带意图需明确要求摘抄原文优质段落、**不少于 5 段**、**逐段中文翻译**，并约束篇幅与无关照抄。

## 2. 改动范围

| 文件 | 说明 |
|------|------|
| `apps/frontend/src/views/englishLearning/LearningToolbar.tsx` | 导出 `QuickIntentInputSyncPayload`，工具栏接收 `onQuickIntentInputSync`，在选中/取消时回调父组件 |
| `apps/frontend/src/views/englishLearning/index.tsx` | `stripAutoFilledIntentName`、`intentInputAutoFillRef`、`chatInputRef`、`onQuickIntentInputSync`，向 `ChatEntry` 传入 `chatInputRef` |
| `apps/frontend/src/i18n/locales/zh-CN.ts` | `englishLearning.intent.literature` 中文长文案 |
| `apps/frontend/src/i18n/locales/en-US.ts` | 同上键位英文长文案 |

**说明**：`EnglishAgentStore` 的 `buildOutgoingContent` / `sendMessage` 未改；发送逻辑仍为「前缀 + 用户输入」。

## 3. 实现思路

1. **数据分层**：MobX store 只负责 `pendingIntentPrefix`（发送用长前缀）；输入框短标签的「自动填入 / 撤销」放在页面组件，用 `useRef` 记录最后一次自动填入的 `label`，避免与 store 强耦合。
2. **子传父回调**：工具栏不直接持有 `setInput`，通过可选回调 `onQuickIntentInputSync` 通知 `index.tsx`，保持 `LearningToolbar` 可在无回调场景下复用（当前仅英语学习页传入）。
3. **取消选中时的剥离**：`stripAutoFilledIntentName` 先处理「整框等于快照」→ 清空；否则在**保留行首空白**的前提下，若正文以快照字符串开头则去掉快照及紧随空白，否则不改（用户已改写成无关内容时不误删）。
4. **聚焦时机**：`setInput` 后使用 `requestAnimationFrame` 再 `focus()`，减少 ref 未挂载或 DOM 未提交导致的失焦。
5. **生命周期**：`sendMessage`、`onNewChat` 将 `intentInputAutoFillRef` 置 `null`，防止与下一轮选择错位。
6. **名著导读**：仅改 i18n 字符串，界面「下次发送附带」预览与 `t(prefixKey)` 发送前缀一并更新，无需改 `chipDefs` 映射。

## 4. 关键代码与注释

### 4.1 工具栏：类型与点击分支

**来源**：`apps/frontend/src/views/englishLearning/LearningToolbar.tsx`（约 L65–L85、L123–L149）

```typescript
/** 快捷意图与输入框联动：选中填入意图名，取消选中时由父级移除自动填入片段 */
export type QuickIntentInputSyncPayload =
	| { mode: 'select'; label: string }
	| { mode: 'clear' };

type EnglishLearningToolbarProps = {
	onQuickIntentInputSync?: (payload: QuickIntentInputSyncPayload) => void;
};

// 说明：prefix = t(c.prefixKey) 供 store 发送前拼接；label = t(c.labelKey) 供输入框展示
onClick={() => {
	if (selected) {
		englishAgentStore.setIntentPrefix('');
		onQuickIntentInputSync?.({ mode: 'clear' });
	} else {
		englishAgentStore.setIntentPrefix(prefix);
		onQuickIntentInputSync?.({
			mode: 'select',
			label: t(c.labelKey),
		});
	}
}}
```

### 4.2 页面：剥离自动填入 + 同步回调 + 聚焦

**来源**：`apps/frontend/src/views/englishLearning/index.tsx`（约 L35–L46、L108–L145、L149–L153）

```typescript
/** 取消选中意图时：去掉输入框开头的自动填充意图名，保留用户后续手动输入 */
function stripAutoFilledIntentName(input: string, snapshot: string): string {
	const s = snapshot.trim();
	if (!s) return input;
	// 说明：用户未改，整段就是 chip 文案 → 直接清空
	if (input.trim() === s) return '';
	const raw = input;
	const lead = raw.match(/^\s*/)?.[0] ?? ''; // 说明：保留用户故意留的前导空格
	const rest = raw.slice(lead.length);
	if (!rest.startsWith(s)) return raw; // 说明：已改写成不以快照开头 → 不碰
	const after = rest.slice(s.length).replace(/^\s+/, ''); // 说明：去掉快照后紧跟的空白
	return lead + after;
}

const chatInputRef = useRef<HTMLTextAreaElement | null>(null);
const intentInputAutoFillRef = useRef<string | null>(null);

const onQuickIntentInputSync = useCallback(
	(payload: QuickIntentInputSyncPayload) => {
		if (payload.mode === 'select') {
			intentInputAutoFillRef.current = payload.label;
			setInput(payload.label);
			// 说明：等浏览器下一帧再 focus，减少 React 提交前 ref 未就绪
			requestAnimationFrame(() => {
				chatInputRef.current?.focus();
			});
			return;
		}
		const snap = intentInputAutoFillRef.current;
		intentInputAutoFillRef.current = null;
		if (!snap) return;
		setInput((prev) => stripAutoFilledIntentName(prev, snap));
	},
	[],
);

// sendMessage 内：发送前清空自动填入快照，避免与下轮 chip 错位
intentInputAutoFillRef.current = null;
```

**来源**：`apps/frontend/src/views/englishLearning/index.tsx`（约 L202–L205、`<ChatEntry>` 处 `chatInputRef`）

```typescript
<EnglishLearningToolbar onQuickIntentInputSync={onQuickIntentInputSync} />

<ChatEntry
	chatInputRef={chatInputRef}
	// ... 其余 props：input / setInput / sendMessage 等
/>
```

**说明**：`ChatEntry` 已支持可选 `chatInputRef`，内部转给 `ChatTextArea`（`forwardRef` 到 `HTMLTextAreaElement`），无需改设计组件源码。

### 4.3 名著导读：i18n 前缀文案

**来源**：`apps/frontend/src/i18n/locales/zh-CN.ts`（约 L682–L683）

```typescript
'englishLearning.intent.literature':
	'【意图】请做名著/英语文献导读：摘要、背景与讨论题；并请从原文中摘取不少于 5 段优质段落（每段适度篇幅），逐段附带中文翻译；避免无关的冗长照抄。',
```

**来源**：`apps/frontend/src/i18n/locales/en-US.ts`（约 L765–L766）

```typescript
'englishLearning.intent.literature':
	'[Intent] Literature guide: context, summary, and discussion; also pick at least 5 high-quality passages from the original (each excerpt reasonably short), each followed by a Chinese translation; avoid unrelated long verbatim copying.',
```

## 5. 兼容性与影响

- **破坏性**：无 API 变更；`EnglishLearningToolbar` 新增可选 prop，旧调用方不传即可。
- **行为变化**：选中快捷意图会覆盖当前输入框内容为 chip 标签；切换另一意图会再次覆盖。用户若在选中后大量改写且不再以快照开头，取消选中不会删改其余正文。
- **多语言**：前缀串随当前 `t` 语言变化；若会话中途切换语言，已选中的 `pendingIntentPrefix` 与 chip 选中态仍以当时字符串比较，属既有模式边界。

## 6. 建议回归验证

1. 选中任意快捷意图 → 输入框为对应中文/英文 chip 文案，光标在文本域内。
2. 选中后追加「测试」→ 取消选中 → 仅剩「测试」。
3. 仅选中后取消 → 输入框清空。
4. 选中名著导读 → 左栏「下次发送附带」区域展示含「不少于 5 段」等的新长文案；发一条消息 → 前缀仍按 store 拼接（可与网络抓包或后端日志核对）。
5. 新对话 / 发送后再次选意图，无异常叠加或焦点丢失。

## 7. 相关源码路径

| 说明 | 路径 |
|------|------|
| 英语学习页 | `apps/frontend/src/views/englishLearning/index.tsx` |
| 左栏工具栏 | `apps/frontend/src/views/englishLearning/LearningToolbar.tsx` |
| Agent store（前缀拼接，本轮未改） | `apps/frontend/src/store/englishAgent.ts` |
| 聊天输入（已有 ref 能力） | `apps/frontend/src/components/design/ChatEntry/index.tsx` |

若与仓库最新源码不一致，以源码为准。
