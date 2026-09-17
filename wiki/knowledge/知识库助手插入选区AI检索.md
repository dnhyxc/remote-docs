# 知识库助手：「复制选中内容到助手」同时支持 AI 与 RAG 输入框

本文记录 **`KnowledgeAssistant`**（AI / RAG 双模式）下，编辑器「复制选中内容到助手」（右键菜单或 **⌘/Ctrl+Shift+V**）应写入**当前模式对应输入框**的实现思路、代码结构与注释说明。

关联文档：

- Monaco 右键与快捷键入口：`docs/monaco/Markdown编辑器右键菜单.md`
- 同路径下的重复写入防护（rAF 合并 + 短时去重）：`docs/knowledge/知识编辑器发送选区助手去重.md`

---

## 1. 背景与问题

- **改造前**：知识页父组件只维护 **`assistantInput`**，通过 `input` / `setInput` 传给 `KnowledgeAssistant`。Monaco 回调 **`onInsertSelectionToAssistant`** 只更新这一路状态。
- **RAG 模式**：`ChatEntry` 实际绑定的是组件内部的 **`ragInput` / `setRagInput`**，与父组件无关，因此「复制到助手」无法写入 RAG 输入框。
- **目标**：插入逻辑仍在**知识页**（与 Monaco、防抖、展开助手面板一致），但根据当前是 **AI** 还是 **RAG**，写入**不同的受控 state**。

---

## 2. 实现思路（摘要）

1. **双输入状态落在知识页**  
   - `assistantInput`：AI 模式输入（与原逻辑一致）。  
   - `ragAssistantInput`：RAG 模式输入（新增，与 AI 对称）。

2. **当前模式用 ref 同步**  
   - `KnowledgeAssistant` 内部的 `assistantMode`（`'ai' | 'rag'`）仍是唯一真相来源（含 localStorage 持久化）。  
   - 通过 **`onAssistantModeChange`** + **`useLayoutEffect`**，在模式变化时把最新值写入父组件的 **`knowledgeAssistantModeRef`**。  
   - 父组件在 **`flushAssistantInsertFromEditor`** 里读 ref，决定调用 **`setAssistantInput`** 还是 **`setRagAssistantInput`**。

3. **ref 初始值与 localStorage 对齐**  
   - 导出 **`readKnowledgeAssistantPanelMode()`** 与存储键 **`KNOWLEDGE_ASSISTANT_MODE_STORAGE_KEY`**，父组件初始化 ref 时使用与子组件 **`useState` 初始值**相同的读取规则，避免首帧误差。

4. **子组件 RAG 输入支持受控**  
   - 与 `input` 相同：`ragInput` / `setRagInput` 可选；传入则用父组件状态，否则回落到内部 `useState`。

5. **换篇时双清空**  
   - `assistantArticleBinding` 变化时，同时 **`setAssistantInput('')`** 与 **`setRagAssistantInput('')`**，避免上一篇任一模式的草稿带到下一篇。

6. **保留既有防抖**  
   - rAF 合并与约 160ms 同文案去重仍作用于「一次用户意图」，不因分流而拆成两套（仍共用 `lastAssistantInsertRef`）。

---

## 3. `KnowledgeAssistant.tsx`：Props、存储键、模式上报与 RAG 受控

下列代码为讲解版注释（若源码有微调，以仓库为准）。

```typescript
// --- 类型与 Props：AI / RAG 输入均可由父组件受控；模式变化回调供父组件更新 ref ---
export type KnowledgeAssistantMode = 'ai' | 'rag';

interface KnowledgeAssistantProps {
  documentKey: string;
  /** AI 模式输入：不传则组件内 internalInput */
  input?: string;
  setInput?: Dispatch<SetStateAction<string>>;
  /**
   * RAG 模式输入：不传则组件内 internalRagInput。
   * 父组件传入后，「复制选中内容到助手」即可写入 RAG 框。
   */
  ragInput?: string;
  setRagInput?: Dispatch<SetStateAction<string>>;
  /** 子 → 父：当前是 AI 还是 RAG，便于父组件 decide 写入哪一路 state */
  onAssistantModeChange?: (mode: KnowledgeAssistantMode) => void;
}

/** localStorage 键名：与工具条切换写入一致，父组件可读同一键初始化 ref */
export const KNOWLEDGE_ASSISTANT_MODE_STORAGE_KEY = 'knowledge-assistant-mode';

/** 与组件初次 assistantMode state 一致，避免父 ref 与子 state 首帧不一致 */
export function readKnowledgeAssistantPanelMode(): KnowledgeAssistantMode {
  if (typeof window === 'undefined') return 'ai';
  return localStorage.getItem(KNOWLEDGE_ASSISTANT_MODE_STORAGE_KEY) === 'rag'
    ? 'rag'
    : 'ai';
}

// --- 组件内：双受控合并逻辑 + 模式变化上抛 ---
const KnowledgeAssistant = observer((props: KnowledgeAssistantProps) => {
  const {
    input: inputProp,
    setInput: setInputProp,
    ragInput: ragInputProp,
    setRagInput: setRagInputProp,
    onAssistantModeChange,
  } = props;

  const [internalInput, setInternalInput] = useState('');
  const input = inputProp ?? internalInput;
  const setInput = setInputProp ?? setInternalInput;

  const [assistantMode, setAssistantModeState] =
    useState<KnowledgeAssistantMode>(readKnowledgeAssistantPanelMode);

  const [internalRagInput, setInternalRagInput] = useState('');
  const ragInput = ragInputProp ?? internalRagInput;
  const setRagInput = setRagInputProp ?? setInternalRagInput;

  const isRagMode = assistantMode === 'rag';

  // 在 layout 之后同步到父级，保证父组件 flush 读取的 ref 与界面一致
  useLayoutEffect(() => {
    onAssistantModeChange?.(assistantMode);
  }, [assistantMode, onAssistantModeChange]);

  // ChatEntry：根据模式切换绑定哪一路 input（原有逻辑，不变）
  // input={isRagMode ? ragInput : input}
  // setInput={isRagMode ? setRagInput : setInput}
});
```

---

## 4. `knowledge/index.tsx`：双 state、模式 ref、flush 分流与挂载

```typescript
import KnowledgeAssistant, {
  readKnowledgeAssistantPanelMode,
  type KnowledgeAssistantMode,
} from './KnowledgeAssistant';

// --- 状态：AI 与 RAG 各一份草稿 ---
const [assistantInput, setAssistantInput] = useState('');
const [ragAssistantInput, setRagAssistantInput] = useState('');

/**
 * 与 KnowledgeAssistant 内 assistantMode 同步（通过 onAssistantModeChange）。
 * 「复制到助手」的 flush 在 rAF 内读取，避免闭包拿到过期的 mode。
 */
const knowledgeAssistantModeRef = useRef<KnowledgeAssistantMode>(
  readKnowledgeAssistantPanelMode(),
);

/**
 * 防抖与合并逻辑见 dedupe 文档；此处仅展示「写入哪一路」的分支。
 */
const flushAssistantInsertFromEditor = useCallback(() => {
  assistantInsertFlushRafRef.current = 0;
  const next = pendingAssistantInsertRef.current;
  pendingAssistantInsertRef.current = null;
  if (!next) return;

  const now = performance.now();
  const last = lastAssistantInsertRef.current;
  if (last && last.text === next && now - last.at < 160) {
    return;
  }
  lastAssistantInsertRef.current = { text: next, at: now };

  const appendBlock = (prev: string) => {
    const cur = (prev ?? '').trim();
    return cur ? `${cur}\n\n${next}` : next;
  };

  // 核心：按当前助手模式写入对应输入框
  if (knowledgeAssistantModeRef.current === 'rag') {
    setRagAssistantInput((prev) => appendBlock(prev));
  } else {
    setAssistantInput((prev) => appendBlock(prev));
  }

  if (!markdownAssistantOpenRef.current) {
    queueMicrotask(() => setMarkdownAssistantOpen(true));
  }
}, []);

// 切换知识条目：两种草稿一并清空，避免串篇
useEffect(() => {
  setAssistantInput('');
  setRagAssistantInput('');
}, [assistantArticleBinding]);

// --- 挂载 KnowledgeAssistant：传入 RAG 受控与模式回调 ---
<KnowledgeAssistant
  documentKey={knowledgeAssistantDocumentKey(assistantArticleBinding, trashOpenNonce)}
  input={assistantInput}
  setInput={setAssistantInput}
  ragInput={ragAssistantInput}
  setRagInput={setRagAssistantInput}
  onAssistantModeChange={(mode) => {
    knowledgeAssistantModeRef.current = mode;
  }}
/>;
```

---

## 5. 兼容性说明

- **`KnowledgeAssistant` 单独使用**（不传 `ragInput` / `setRagInput` / `onAssistantModeChange`）时：RAG 仍为内部 state，行为与改造前一致。
- **知识页（云登录）**：传入完整受控 props，「复制到助手」与 AI/RAG 输入框一致。
- **与 dedupe 的关系**：`onInsertSelectionToAssistant` → `pending` → `requestAnimationFrame` → `flushAssistantInsertFromEditor` 的链路不变；仅在 flush 内增加「按 `knowledgeAssistantModeRef` 分流 setter」。

---

## 6. 相关源码路径

| 说明 | 路径 |
|------|------|
| 助手双模式 UI、受控合并、`onAssistantModeChange` | `apps/frontend/src/views/knowledge/KnowledgeAssistant.tsx` |
| 双输入 state、模式 ref、flush 分流、换篇双清空、挂载 props | `apps/frontend/src/views/knowledge/index.tsx` |
| Monaco 发送到助手 | `apps/frontend/src/components/design/Monaco/contextMenu.ts`、`commands.ts` |
