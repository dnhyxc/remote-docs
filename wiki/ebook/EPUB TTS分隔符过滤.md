# TTS：过滤网文装饰分隔线（`***` / `---` 等）

**文档角色**：听书/听当前不再朗读整行星号、破折号等装饰分隔符。

**延伸阅读**：[EPUB章节听书.md](./EPUB章节听书.md)、[developer/EPUB听书开发.md](./developer/EPUB听书开发.md)

---

## 1. 背景与目标

章节中常见 `**************************************************` 场景分隔线；`stripMarkdownForTts` 折叠空白后星号仍留在 plain，TTS 会读出。期望在清洗阶段剔除连续装饰符。

---

## 2. 改动范围

| 路径 | 说明 |
|------|------|
| `apps/frontend/src/utils/speech.ts` | `stripMarkdownForTts` + DEV 自检 |

---

## 3. 实现思路

在 Markdown 语法剥离之后、空白合并之前：

- `[*＊]{3,}`、`[-—_=~～]{3,}`、`[·•.]{3,}`
- 间隔形式 `(?:^|\s)(?:\*[ \t]*){2,}\*(?=\s|$)`

听书节 plain、单句 `sentenceRaw`、云端/本机播放均走该函数，一处生效。

---

## 4. 关键实现

### 4.1 `stripMarkdownForTts`

**改动前** · 列表编号剥离后直接 `\s+` 合并。

**改动后** · `apps/frontend/src/utils/speech.ts`（当前，约 L51–L93）

```typescript
export function stripMarkdownForTts(raw: string): string {
	if (!raw?.trim()) return '';
	return (
		raw
			.replace(/```[\s\S]*?```/g, ' ')
			.replace(/`[^`\n]+`/g, ' ')
			.replace(/\*\*([^*]+)\*\*/g, '$1')
			.replace(/\*([^*]+)\*/g, '$1')
			.replace(/^#{1,6}\s+/gm, '')
			.replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
			.replace(/^[-*+]\s+/gm, '')
			.replace(/^\d+\.\s+/gm, '')
			// 连续星号分隔线
			.replace(/[*＊]{3,}/g, ' ')
			// 连续横线/破折号等
			.replace(/[-—_=~～]{3,}/g, ' ')
			// 连续中点/句点装饰
			.replace(/[·•.]{3,}/g, ' ')
			// * * * 间隔星号
			.replace(/(?:^|\s)(?:\*[ \t]*){2,}\*(?=\s|$)/gm, ' ')
			.replace(/\s+/g, ' ')
			.trim()
	);
}

// DEV：分隔星号不得泄漏进 TTS 文本
if (import.meta.env.DEV) {
	const sep = stripMarkdownForTts(
		'上一句。\n**************************************************\n下一句。',
	);
	if (sep.includes('*') || !sep.includes('上一句') || !sep.includes('下一句')) {
		throw new Error(`[speech] separator stars leaked into TTS: ${sep}`);
	}
}
```

**变更摘要**：装饰分隔线在进 TTS 前清空；开发态断言防回归。

---

## 5. 测试与回归建议

1. 含整行星号的章节听书：不应读出「星号」。
2. 正常 `*斜体*` / `**粗体**` Markdown 仍只留正文。
3. 英语学习喇叭长文仍走同一清洗函数。

---

（若与仓库最新源码不一致，以源码为准）
