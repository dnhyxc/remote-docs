# 知识库页面 RAG 问答助手（前端）实现说明

本文记录本仓库在 `apps/frontend/src` 内新增「知识库 RAG 问答助手」的实现思路、关键代码与逐行注释，确保：

- **不影响**现有知识库功能与既有 AI 助手（`assistantStore`）的任何逻辑分支；
- RAG 与 AI 助手 **数据域完全隔离**；
- **切换路由 / 切换面板不停止流式输出**；
- RAG 不绑定文章：在任意文章、甚至左侧无正文时都能问答，且清空左侧正文不清空 RAG 对话；
- RAG 流式结束后显示 **「新对话」**，可一键重置 RAG 对话并开始新一轮。

> 关联文档：既有 AI 助手完整链路见 `知识库助手完成.md`（本文仅补充 RAG 新增部分）。

---

## 1. 文件索引（本次新增/改动点）

- `apps/frontend/src/views/knowledge/KnowledgeAssistant.tsx`
  - 在 `ChatEntry.entryChildren` 增加「AI / RAG」模式切换（默认 AI）
  - RAG 独立输入框状态 `ragInput`
  - RAG 消息渲染 `KnowledgeRagMessageBubble`
  - 切换到 RAG 时自动滚动到底部（不影响 AI）
  - RAG 流式结束后展示「新对话」按钮

- `apps/frontend/src/store/knowledgeRagQa.ts`
  - RAG 独立 store：全局单会话（不按 `documentKey` 分桶）
  - `sendMessage`：调用后端 `/knowledge/qa/ask` SSE 并流式累积
  - `stopGenerating`：只中断 RAG，不影响 AI
  - `resetConversation`：新对话入口（清空消息与证据）

- `apps/frontend/src/utils/knowledgeRagQaSse.ts`
  - SSE 消费：解析 NestJS `@Sse()` 的 `data:` 行，事件类型对齐后端 `KnowledgeQaController`

---

## 2. 关键设计决策（为什么这么做）

### 2.1 RAG 与 AI 助手的“会话维度”不同

- **AI 助手（assistant）**：按 `documentKey/canonicalKey` 绑定文档会话（这是既有逻辑，不能动）。
- **RAG 助手（knowledge qa）**：面向“当前用户的知识库整体检索问答”，**不绑定文章**。
  - 切换文章不会创建新会话、不会清空对话；
  - 清空左侧正文不会清空 RAG 对话；
  - 路由切换回来仍可看到正在输出的流（store 全局单例持有 abort 与 messages）。

### 2.2 “切换面板不停止流”靠 store 持有 SSE 生命周期

原则：**组件只是“视图指针”**，SSE 的 `AbortController` 与累积的 `messages` 必须放在 store 内部。

- 切到 AI 面板时：RAG 的 store 仍在后台收 delta 并累积；
- 切回 RAG 面板时：渲染读到的 `messages` 已经是最新状态，因此仍呈现打字机效果。

---

## 3. SSE 协议与消费（RAG 专用）

后端：`POST /api/knowledge/qa/ask`（NestJS `@Sse()`），前端消费需解析 `data:` 行。

### 3.1 SSE 工具：`streamKnowledgeQaSse`

文件：`apps/frontend/src/utils/knowledgeRagQaSse.ts`

```ts
// 引入 Toast：用于在流解析失败时提示（不抛出致命异常）
import { Toast } from '@ui/index';
// 引入 BASE_URL：统一 API 域名（开发/生产）
import { BASE_URL } from '@/constant';
// 引入鉴权失败通知：401 时统一走登出/提示逻辑
import { notifyUnauthorized } from '@/router/authSession';
// 引入跨平台 fetch：兼容浏览器 / 桌面端环境
import { getPlatformFetch } from '@/utils/fetch';

// 读取 token：与其它 SSE 工具保持一致
function readToken(): string {
  // SSR 下无 window：直接返回空
  if (typeof window === 'undefined') {
    return '';
  }
  // 从 localStorage 读取 token
  return localStorage.getItem('token') || '';
}

// 定义后端单条事件 payload：可能是扁平结构，也可能嵌套在 {data:{...}} 下
export type KnowledgeQaSsePayload = {
  // 事件类型：qa.start / qa.delta / qa.done / qa.error / qa.sse.done 等
  type?: string;
  // qa.start 的 runId：用于关联一次问答
  runId?: string;
  // qa.delta 的增量文本
  content?: string;
  // qa.error 的错误信息
  message?: string;
  // qa.retrieval / qa.done 的证据列表（结构由后端定义）
  evidences?: unknown;
};

// SSE 回调集合：由 store 注入，用于更新消息与状态
export interface KnowledgeRagQaSseCallbacks {
  // 触发开始：用于记录 runId
  onStart?: (runId: string) => void;
  // 召回阶段：用于缓存 evidences（可选）
  onRetrieval?: (evidences: unknown) => void;
  // 增量输出：用于打字机效果
  onDelta?: (text: string) => void;
  // 完成：用于固化 evidences 并结束流
  onDone?: (evidences: unknown) => void;
  // 错误：用于 UI 提示与结束流
  onError?: (message: string) => void;
  // 完整结束（含错误）：用于收尾把 isSending 复位
  onComplete?: (error?: string) => void;
}

// 统一拆出 payload：兼容 Nest SSE 的 { data: ... } 结构
function unwrapPayload(raw: Record<string, unknown>): KnowledgeQaSsePayload {
  // 取 raw.data
  const inner = raw.data;
  // 若 data 是对象：返回 data
  if (inner && typeof inner === 'object' && !Array.isArray(inner)) {
    return inner as KnowledgeQaSsePayload;
  }
  // 否则认为 raw 本身就是 payload
  return raw as KnowledgeQaSsePayload;
}

// 消费 SSE：返回 abort()，只允许显式 stop 或发起新流前调用
export async function streamKnowledgeQaSse(options: {
  // api 路径：默认 /knowledge/qa/ask（由 BASE_URL 统一补全域名）
  api?: string;
  // 请求体：至少包含 question
  body: Record<string, unknown>;
  // 回调：由 store 驱动
  callbacks: KnowledgeRagQaSseCallbacks;
}): Promise<() => void> {
  // 解构并设置默认 api
  const { api = '/knowledge/qa/ask', body, callbacks } = options;
  // 解构回调
  const { onStart, onRetrieval, onDelta, onDone, onError, onComplete } = callbacks;

  // 创建中止控制器：用于 stop 或发起新一轮前中断
  const controller = new AbortController();

  try {
    // 获取平台 fetch：兼容桌面端/浏览器
    const platformFetch = await getPlatformFetch();
    // 发起 POST 请求：后端用 @Sse() 返回流
    const response = await platformFetch(BASE_URL + api, {
      // 方法：POST
      method: 'POST',
      // 头：Bearer token + JSON
      headers: {
        Authorization: `Bearer ${readToken()}`,
        'Content-Type': 'application/json',
      },
      // body：序列化 JSON
      body: JSON.stringify(body),
      // signal：用于 abort
      signal: controller.signal,
    });

    // 非 2xx：抛错，由 catch 统一处理
    if (!response.ok) {
      // 401：触发统一未授权逻辑
      if (response.status === 401) {
        notifyUnauthorized();
        throw new Error('请先登录后再试');
      }
      // 其它状态：带上 statusText
      throw new Error(`HTTP error! status: ${response.statusText}`);
    }

    // 获取 reader：用于消费流
    const reader = response.body?.getReader();
    // 没有 reader：直接报错
    if (!reader) {
      throw new Error('无法读取流式响应');
    }

    // decoder：把 Uint8Array 解成字符串
    const decoder = new TextDecoder('utf-8');
    // buffer：用于处理半行数据（一次 read 可能拿到半行）
    let buffer = '';
    // streamFinished：避免多次调用 onComplete
    let streamFinished = false;
    // finish：统一收尾
    const finish = (err?: string) => {
      // 已结束则跳过
      if (streamFinished) return;
      // 标记结束
      streamFinished = true;
      // 回调 complete
      onComplete?.(err);
    };

    // 异步读循环：不阻塞调用方
    (async () => {
      try {
        // 外层循环：持续读
        readLoop: while (true) {
          // read：获取下一段字节
          const { done, value } = await reader.read();
          // done：流结束
          if (done) {
            finish();
            break;
          }
          // decode：把字节转成字符串 chunk
          const chunk = decoder.decode(value, { stream: true });
          // 累加到 buffer
          buffer += chunk;
          // 按行拆分
          const lines = buffer.split('\n');
          // 保留最后一段（可能是半行）
          buffer = lines.pop() || '';

          // 遍历完整行
          for (const line of lines) {
            // trim：去掉空白
            const trimmed = line.trim();
            // 非 data: 行跳过
            if (!trimmed.startsWith('data:')) continue;
            // 截掉 data:
            const dataStr = trimmed.slice(5).trimStart();
            // 空行 / [DONE] 跳过
            if (!dataStr || dataStr === '[DONE]') continue;

            // raw：解析 JSON
            let raw: Record<string, unknown>;
            try {
              raw = JSON.parse(dataStr) as Record<string, unknown>;
            } catch {
              // 解析失败：提示并跳过该行
              Toast({ type: 'error', title: 'RAG 流解析失败' });
              continue;
            }

            // parsed：兼容 {data:{...}}
            const parsed = unwrapPayload(raw);
            // t：事件类型
            const t = parsed.type;

            // controller 追加的 done：直接 finish 并退出
            if (t === 'qa.sse.done') {
              finish();
              break readLoop;
            }
            // start：记录 runId
            if (t === 'qa.start' && typeof parsed.runId === 'string') {
              onStart?.(parsed.runId);
              continue;
            }
            // retrieval：缓存 evidences
            if (t === 'qa.retrieval') {
              onRetrieval?.(parsed.evidences);
              continue;
            }
            // delta：打字机增量
            if (t === 'qa.delta' && typeof parsed.content === 'string') {
              onDelta?.(parsed.content);
              continue;
            }
            // done：固化 evidences
            if (t === 'qa.done') {
              onDone?.(parsed.evidences);
              continue;
            }
            // error：结束流并上报错误
            if (t === 'qa.error') {
              const msg =
                typeof parsed.message === 'string' ? parsed.message : 'RAG 请求失败';
              onError?.(msg);
              finish(msg);
              break readLoop;
            }
          }
        }
      } catch (err: unknown) {
        // AbortError：认为是正常结束（用户 stop / 切换触发）
        if (err instanceof DOMException && err.name === 'AbortError') {
          finish();
          return;
        }
        // 其它异常：转成 Error
        const e = err instanceof Error ? err : new Error(String(err ?? '请求中断'));
        // 上报 error
        onError?.(e.message);
        // complete 也带上错误
        onComplete?.(e.message);
      }
    })();
  } catch (err: unknown) {
    // fetch 前置错误：统一处理
    const e = err instanceof Error ? err : new Error(String(err ?? '请求失败'));
    // 回调错误
    onError?.(e.message);
    // 回调 complete
    onComplete?.(e.message);
  }

  // 返回 abort：由调用方决定何时中断
  return () => controller.abort();
}
```

---

## 4. RAG Store：全局单会话（不按 documentKey）

文件：`apps/frontend/src/store/knowledgeRagQa.ts`

> 说明：代码块只展示关键方法；核心要求是“RAG 不与文章绑定、且不被左侧清空逻辑联动清空”。

```ts
// 引入 Toast：用于用户提示（未登录、并发发送等）
import { Toast } from '@ui/index';
// 引入 mobx：用于可观察状态与批量更新
import { makeAutoObservable, runInAction } from 'mobx';
// 引入 uuid：用于生成 chatId（与现有消息结构一致）
import { v4 as uuidv4 } from 'uuid';
// 引入 Message 类型：复用现有气泡 UI
import type { Message } from '@/types/chat';
// 引入 SSE 工具：消费后端 knowledge/qa/ask
import { streamKnowledgeQaSse } from '@/utils/knowledgeRagQaSse';

// 读取 token：用于前端判断是否登录
function readToken(): string {
  // SSR 下无 window：直接返回空
  if (typeof window === 'undefined') return '';
  // 从 localStorage 读取 token
  return localStorage.getItem('token') || '';
}

// RAG store：全局单会话，不按 documentKey 分桶
export class KnowledgeRagQaStore {
  // 消息列表：包含 user 与 assistant（assistant 流式时 isStreaming=true）
  messages: Message[] = [];
  // 发送态：用于禁用输入与按钮
  isSending = false;
  // 错误态：最近一次错误信息
  loadError: string | null = null;
  // abortStream：当前 SSE 的 abort 函数（只属于 RAG）
  abortStream: (() => void) | null = null;

  // lastRunId：后端 qa.start 的 runId（可用于调试）
  lastRunId: string | null = null;
  // lastEvidences：检索证据缓存（可选用于 UI 展示）
  lastEvidences: any[] = [];

  // 构造：让属性变成 observable
  constructor() {
    makeAutoObservable(this);
  }

  // 是否仍在流式：由 messages 中是否存在 isStreaming 推导
  get isStreaming(): boolean {
    return this.messages.some((m) => m.isStreaming);
  }

  // 停止生成：只中断 RAG SSE，不影响 AI 助手
  stopGenerating(): void {
    // 中断 SSE
    this.abortStream?.();
    // 批量更新状态
    runInAction(() => {
      // 清空 abort 引用
      this.abortStream = null;
      // 复位 sending
      this.isSending = false;
      // 将仍在流式的 assistant 消息标记为 stopped
      this.messages = this.messages.map((m) => {
        // 非流式消息不动
        if (!m.isStreaming) return m;
        // 流式消息置为停止
        return { ...m, isStreaming: false, isStopped: true };
      });
    });
  }

  // 新对话：中断 SSE 并清空全部 RAG 对话
  resetConversation(): void {
    // 先中断 SSE：避免后台仍在 append delta
    this.abortStream?.();
    // 统一清空状态：不影响 AI 侧任何内容
    runInAction(() => {
      // 清空 abort
      this.abortStream = null;
      // 复位 sending
      this.isSending = false;
      // 清空消息：进入全新对话
      this.messages = [];
      // 清空证据：避免 UI 误展示旧 evidence
      this.lastEvidences = [];
      // 清空 runId：新一轮会写入新的 runId
      this.lastRunId = null;
      // 清空错误：避免旧错误残留影响体验
      this.loadError = null;
    });
  }

  // 发送问题：创建占位 assistant 消息并消费 SSE 增量
  async sendMessage(question: string): Promise<void> {
    // trim：去掉空白
    const text = (question ?? '').trim();
    // 空串直接返回
    if (!text) return;
    // 未登录：提示并返回
    if (!readToken()) {
      Toast({ type: 'warning', title: '请先登录后再使用 RAG 助手' });
      return;
    }
    // 防并发：发送中或仍在流式时不允许新发
    if (this.isSending || this.isStreaming) {
      Toast({ type: 'warning', title: '请等待当前回复结束后再试' });
      return;
    }

    // 清理旧 abort（理论上此时为空，但保守处理）
    this.abortStream?.();
    // 设置发送态
    runInAction(() => {
      this.abortStream = null;
      this.loadError = null;
      this.isSending = true;
    });

    // 生成 user 与 assistant 的 chatId
    const userChatId = uuidv4();
    const assistantChatId = uuidv4();

    // 入队两条消息：user + assistant 占位（流式）
    runInAction(() => {
      this.messages.push({
        chatId: userChatId,
        role: 'user',
        content: text,
        timestamp: new Date(),
      });
      this.messages.push({
        chatId: assistantChatId,
        role: 'assistant',
        content: '',
        timestamp: new Date(),
        isStreaming: true,
        thinkContent: '',
      });
    });

    // accumulated：累计正文，用于打字机
    let accumulated = '';
    // patchAssistant：用“替换对象”的方式更新消息，保证 MobX 列表稳定刷新
    const patchAssistant = (delta: string) => {
      // 累加增量
      if (delta) accumulated += delta;
      // 用新对象替换 messages[idx]
      runInAction(() => {
        // 找到占位助手消息
        const idx = this.messages.findIndex((m) => m.chatId === assistantChatId);
        // 找不到则返回
        if (idx < 0) return;
        // 取出旧对象
        const prev = this.messages[idx] as Message;
        // 替换为新对象：只变 content
        this.messages[idx] = { ...prev, content: accumulated };
      });
    };

    // 发起 SSE：并保存 abort
    const abort = await streamKnowledgeQaSse({
      // body：对齐后端 AskKnowledgeQaDto
      body: {
        question: text,
        includeEvidences: true,
      },
      // callbacks：驱动 store 状态
      callbacks: {
        // start：记录 runId
        onStart: (runId) => {
          runInAction(() => {
            this.lastRunId = runId;
          });
        },
        // retrieval：缓存 evidences（可选）
        onRetrieval: (ev) => {
          if (Array.isArray(ev)) {
            runInAction(() => {
              this.lastEvidences = ev as any[];
            });
          }
        },
        // delta：打字机
        onDelta: (d) => patchAssistant(d),
        // done：结束流式并固化 evidences
        onDone: (ev) => {
          if (Array.isArray(ev)) {
            runInAction(() => {
              this.lastEvidences = ev as any[];
            });
          }
          runInAction(() => {
            this.isSending = false;
            const idx = this.messages.findIndex((m) => m.chatId === assistantChatId);
            if (idx >= 0) {
              const prev = this.messages[idx] as Message;
              this.messages[idx] = { ...prev, isStreaming: false };
            }
            this.abortStream = null;
          });
        },
        // error：显示错误并结束流
        onError: (msg) => {
          runInAction(() => {
            this.loadError = msg;
            this.isSending = false;
            const idx = this.messages.findIndex((m) => m.chatId === assistantChatId);
            if (idx >= 0) {
              const prev = this.messages[idx] as Message;
              this.messages[idx] = {
                ...prev,
                isStreaming: false,
                content: prev.content || msg,
              };
            }
            this.abortStream = null;
          });
        },
        // complete：兜底收尾（含异常/断流）
        onComplete: (err) => {
          runInAction(() => {
            this.isSending = false;
            const idx = this.messages.findIndex((m) => m.chatId === assistantChatId);
            if (idx >= 0) {
              const prev = this.messages[idx] as Message;
              if (prev.isStreaming) {
                this.messages[idx] = {
                  ...prev,
                  isStreaming: false,
                  ...(err && !prev.content ? { content: `生成失败：${err}` } : {}),
                };
              }
            }
            this.abortStream = null;
          });
        },
      },
    });

    // 保存 abort：供 stop/new conversation 使用
    runInAction(() => {
      this.abortStream = abort;
    });
  }
}
```

---

## 5. UI：KnowledgeAssistant 双模式（AI / RAG）接入点

文件：`apps/frontend/src/views/knowledge/KnowledgeAssistant.tsx`

**流式输出时的消息操作条**（复制、保存到知识库）：AI 与 RAG 共用同一套气泡与 **`ChatMessageActions`**；**正在流式输出的那条**（`message.isStreaming`）在知识库侧**不展示**操作条，通用组件内仍对复制/保存做禁用兜底。完整说明见 **`知识库助手完成.md` §8.2.1**。

### 5.1 模式切换：默认 AI，RAG 独立输入 `ragInput`

```ts
// 仅 UI：localStorage key，用于记住上次选择
const KNOWLEDGE_ASSISTANT_MODE_KEY = 'knowledge-assistant-mode';
// 助手模式：ai / rag
type KnowledgeAssistantMode = 'ai' | 'rag';

// assistantMode：初始化时读取 localStorage，默认 ai
const [assistantMode, setAssistantModeState] = useState<KnowledgeAssistantMode>(() => {
  // SSR 下无 window：默认 ai
  if (typeof window === 'undefined') return 'ai';
  // 读取缓存
  const v = localStorage.getItem(KNOWLEDGE_ASSISTANT_MODE_KEY);
  // 只允许 rag，否则一律 ai
  return v === 'rag' ? 'rag' : 'ai';
});

// setAssistantMode：写入 state + localStorage
const setAssistantMode = useCallback((m: KnowledgeAssistantMode) => {
  // 更新 state
  setAssistantModeState(m);
  // 写入 localStorage：仅 UI 偏好，不影响业务
  if (typeof window !== 'undefined') {
    localStorage.setItem(KNOWLEDGE_ASSISTANT_MODE_KEY, m);
  }
}, []);

// RAG 独立输入：不复用 AI 的 input，且不被 markdown 清空逻辑影响
const [ragInput, setRagInput] = useState('');
// isRagMode：派生布尔，用于分支渲染
const isRagMode = assistantMode === 'rag';
```

### 5.2 “左侧 markdown 清空”只清 AI 输入，不清 RAG

```ts
// 左侧编辑器被清空时，同步清空「AI 助手」输入框（RAG 独立输入，且不因正文清空而清空）
useEffect(() => {
  // 仅 AI 模式生效：避免误伤 RAG
  if (assistantMode !== 'ai') return;
  // 读取 markdown
  const raw = knowledgeStore.markdown ?? '';
  // 有正文则不清空
  if (raw.trim()) return;
  // 延迟清空：规避 Monaco 重挂载瞬态
  const id = window.setTimeout(() => {
    if (!(knowledgeStore.markdown ?? '').trim()) {
      setInput('');
    }
  }, 200);
  // cleanup：清理定时器
  return () => window.clearTimeout(id);
}, [knowledgeStore.markdown, setInput, knowledgeStore, assistantMode]);
```

### 5.3 切换到 RAG 时自动滚到底部（不影响 AI）

```ts
// wasRagModeRef：检测是否“刚进入 RAG”
const wasRagModeRef = useRef(false);

// 切换到 RAG 助手时：将消息区滚到底部（仅在进入 RAG 的瞬间触发，不改变 AI 模式行为）
useLayoutEffect(() => {
  // 不在 RAG：复位 ref
  if (!isRagMode) {
    wasRagModeRef.current = false;
    return;
  }
  // enteredRag：只在 false→true 时触发
  const enteredRag = !wasRagModeRef.current;
  // 标记已进入
  wasRagModeRef.current = true;
  // 非首次进入则跳过（避免每次渲染都滚）
  if (!enteredRag) return;
  // 开启贴底：让后续内容增长继续贴底
  enableStreamStickToBottom();
  // 立即贴底
  flushScrollToBottom();
  // 下一帧再贴底：应对 scrollHeight 尚未稳定
  requestAnimationFrame(() => {
    flushScrollToBottom();
  });
}, [isRagMode, enableStreamStickToBottom, flushScrollToBottom]);
```

### 5.4 RAG 流式结束后显示「新对话」

核心逻辑：当 RAG 模式下“有消息且不在 sending/streaming”时展示按钮；点击后仅重置 RAG store 与 RAG 输入，不影响 AI。

```ts
// showRagNewConversation：RAG 本轮流式结束后展示「新对话」
const showRagNewConversation =
  isRagMode && // 必须在 RAG 模式
  isLoggedIn && // 必须已登录（与输入区一致）
  ragMessages.length > 0 && // 必须已有对话
  !knowledgeRagQaStore.isSending && // 不能在发送
  !knowledgeRagQaStore.isStreaming; // 不能仍在流式

// RAG「新对话」条带出现后同样贴底，避免按钮把视口顶在旧位置
useLayoutEffect(() => {
  // 不显示则不处理
  if (!showRagNewConversation) return;
  // 贴底一次
  flushScrollToBottom();
  // 下一帧再贴底
  requestAnimationFrame(() => flushScrollToBottom());
}, [showRagNewConversation, flushScrollToBottom]);

// JSX：插入在消息列表之后
{showRagNewConversation ? (
  <div className="mb-3 flex w-full min-w-0 justify-start">
    <Button
      type="button"
      variant="dynamic"
      className="w-fit rounded-md border border-theme/10 bg-theme/5 px-3 py-1.5 text-sm text-textcolor/80 transition-colors hover:border-theme/20 hover:text-textcolor"
      onClick={() => {
        // 只重置 RAG：清空消息与证据
        knowledgeRagQaStore.resetConversation();
        // 清空 RAG 输入：体验一致
        setRagInput('');
      }}
    >
      新对话
    </Button>
  </div>
) : null}
```

### 5.5 输入区工具条在 RAG 下保持可见（本次修复）

问题背景：如果把 `entryChildren` 整体绑定到「仅 AI 可见」条件，切到 RAG 后工具条会整体消失，用户无法直接切回 AI。  
当前实现将工具条门控拆为两层：

- **`showEntryToolbar`**：控制工具条整体（登录后展示，AI/RAG 都可见）。
- **`showAiSessionActions`**：控制 AI 多会话按钮（历史/新对话），RAG 下隐藏。

这样 RAG 下仍显示模式切换按钮，但不会误开放 AI 会话能力。

```tsx
// 文件：apps/frontend/src/views/knowledge/KnowledgeAssistant.tsx（节选 + 文档注释）

/** 工具条整体展示：登录后始终可见（含 AI/RAG 模式切换） */
const showEntryToolbar = isLoggedIn;

/** AI 多会话操作仅在 AI 模式展示；RAG 模式下隐藏“历史/新对话” */
const showAiSessionActions =
  !isRagMode &&
  isLoggedIn &&
  assistantStore.knowledgeAssistantPersistenceAllowed &&
  Boolean(assistantStore.sessionListForActiveDocument);

const isAiSessionSwitcherLocked =
  showAiSessionActions && assistantStore.isAssistantSessionSwitcherLocked;

<ChatEntry
  // ...其余 props 省略
  entryChildren={
    <KnowledgeAssistantEntryToolbar
      showEntryToolbar={showEntryToolbar}          // 工具条整体开关
      showAiSessionActions={showAiSessionActions}  // 仅 AI 显示历史/新对话
      isAiSessionSwitcherLocked={isAiSessionSwitcherLocked}
      isAiHistoryDrawerOpen={isAiHistoryDrawerOpen}
      setIsAiHistoryDrawerOpen={setIsAiHistoryDrawerOpen}
      enableStreamStickToBottom={enableStreamStickToBottom}
      flushScrollToBottom={flushScrollToBottom}
      assistantMode={assistantMode}
      setAssistantMode={setAssistantMode}
    />
  }
/>
```

---

## 6. 回归清单（确保不影响现有逻辑）

- AI 模式默认选择：
  - 页面加载默认仍是 AI（如果用户没切过；切过则按 localStorage 偏好）
  - `assistantStore.activateForDocument(documentKey)` 触发条件不变
  - `disableTextInput={!editorHasBody}` 等与正文绑定逻辑不变

- RAG 模式：
  - 左侧 markdown 为空仍可发送
  - 切换文章/清空正文不会清空 RAG messages
  - 切到 AI 面板不停止 RAG 流；切回 RAG 可继续看到流式增长
  - 流式结束后出现「新对话」，点击后仅清空 RAG

