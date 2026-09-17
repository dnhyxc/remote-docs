# 英语学习 Agent 流式渲染隔离

## 1. 背景与目标

### 1.1 用户可见问题

在英语学习 Agent 对话中，当 AI 回复流式输出时，每接收一个 token 都会触发整个 `AgentPanel` 组件重新渲染。这包括输入框（`ChatEntry`）、分享栏（`AssistantShareBar`）、会话工具栏（`AssistantSessionEntryToolbar`）等与消息内容无关的 UI 区域。

**具体表现**：

- 流式输出期间，输入框打字出现明显卡顿，按键响应延迟
- 分享栏与会话工具栏随 token 频繁重绘，造成视觉抖动
- 滚动贴底逻辑被大量无关重渲拖慢，偶尔出现跟底不及时

### 1.2 目标

将英语学习 Agent 的流式渲染范围缩小到仅消息列表自身，实现「流式 token 只重渲染消息行，不带动输入框、分享栏、会话工具栏」的隔离效果。

---

## 2. 根因分析

重构前的 `AgentPanel` 采用了单一层级的 `observer()` 包裹，整个组件树直接读取 `englishAgentStore.messages`。MobX 的依赖追踪机制使得任何 observable 属性变化（包括 `message.content` 的每个 token 增量）都会触发整个 `observer` 组件的重渲染。

同时，Store 层在流式更新时使用 `st.messages[idx] = { ...prev, content: accumulated }` 替换数组元素，这会触发数组级别的 observable 通知，进一步放大了重渲染范围。

**核心矛盾**：组件订阅的粒度（整个 messages 数组）远大于实际需要的粒度（仅消息条数 / 仅最后一条的 content 长度）。

---

## 3. 方案总览

### 3.1 核心决策

采用三层隔离策略，从 Store → Hook → Component 逐层缩小渲染影响面：

| 层级 | 技术手段 | 隔离效果 |
|------|----------|----------|
| **Store 层** | `createStreamingMobxPatchScheduler` + 原地 `prev.content = accumulated` | 每帧最多一次 MobX 写入，不替换数组元素 |
| **Signal Hook 层** | `reaction()` 精细订阅，将「消息条数」「流式 tick」「标志位」拆为独立 hook | 组件只订阅实际需要的字段，content 变化不触发非相关 hook |
| **Component 层** | `EnglishAgentMessageList = memo(observer(...))` 独立 observer 组件 | 消息列表独立重渲，不影响父级 AgentPanel |

**数据流全景**：

```
SSE onDelta
  → accumulated += delta
  → scheduler.schedule()          // 每帧合并一次
  → flush: prev.content = accumulated  // 原地改，不替换数组

EnglishAgentMessageList (observer)  // 直接读 messages → 仅消息列重渲
  ↓
useEnglishAgentMessageCount (reaction)  // 仅条数变化 → 贴底/空态
useEnglishAgentStreamTick (reaction)    // content 同频 → 贴底滚动 revision
useEnglishAgentIsSending / IsStreaming / IsHydrating / SessionId / ToolStatus  // 标志位

AgentPanel (observer, 不含 messages 订阅)
  → footerBody = useMemo(ChatEntry ...)  // 流式期间引用稳定
  → EnglishAgentScrollShell              // 组装滚动壳 + 消息列表
```

---

## 4. 关键代码对比与注释

### 4.1 `useEnglishAgentSignals`（useEnglishAgentSignals.ts）

**路径**：`apps/frontend/src/views/englishLearning/agent/useEnglishAgentSignals.ts`
**版本**：新增文件
**行数**：1–62

```typescript
// 从 MobX 导入 reaction 函数，用于创建精细化响应式订阅
import { reaction } from 'mobx';
// 从 React 导入 useEffect 和 useState，用于在函数组件中建立副作用订阅
import { useEffect, useState } from 'react';
// 导入 buildStreamTick 工具函数，用于构建流式贴底的 revision 字符串
import { buildStreamTick } from '@/components/design/Assistant';
// 导入英语学习 Agent 的全局 Store 实例
import englishAgentStore from '@/store/englishAgent';

// 自定义 Hook：仅订阅消息条数的变化，不关心消息内容
// 流式改 content 不会触发此 hook 的状态更新
/** 仅条数变化；流式改 content 不触发 */
export function useEnglishAgentMessageCount(): number {
    // 使用 useState 保存当前消息条数，初始值为 0
    const [count, setCount] = useState(0);
    // 使用 useEffect 在组件挂载时建立 reaction 订阅，组件卸载时自动清理
    useEffect(() => {
        // reaction 接收两个参数：
        //   第一个函数（data 函数）：读取 englishAgentStore.messages.length，建立依赖追踪
        //   第二个函数（effect 函数）：当依赖变化时调用 setCount 更新状态
        //   { fireImmediately: true }：组件挂载时立即执行一次 effect，确保初始值同步
        return reaction(() => englishAgentStore.messages.length, setCount, {
            fireImmediately: true,
        });
    }, []); // 空依赖数组，reaction 只在挂载时建立一次
    // 返回当前消息条数
    return count;
}

// 自定义 Hook：订阅流式贴底 revision（与消息 content 同频变化）
// Store 层已通过 rAF 合并，确保每帧最多更新一次，同步 setTick 避免贴底晚于撑高
/**
 * 流式贴底 revision：与消息 content 同频（store 已 rAF 合并），同步 setTick 避免贴底晚于撑高。
 */
export function useEnglishAgentStreamTick(): string {
    // 使用 useState 保存当前流式 revision 字符串，初始为空串
    const [tick, setTick] = useState('');
    // 使用 useEffect 在组件挂载时建立 reaction 订阅
    useEffect(() => {
        // reaction 的 data 函数调用 buildStreamTick(messages)：
        //   读取最后一条消息的 content.length / thinkContent.length / isStreaming 等字段
        //   生成一个复合字符串作为 revision，当 content 增量时此值变化
        return reaction(() => buildStreamTick(englishAgentStore.messages), setTick, {
            fireImmediately: true,
        });
    }, []); // 空依赖数组，reaction 只建立一次
    // 返回当前流式 revision 字符串
    return tick;
}

// 通用 Hook 工厂：订阅任意单一 Store 属性的变化
// 通过 reaction 隔离 Store 属性读取，避免父级 observer 订阅整个 Store
function useEnglishAgentFlag<T>(read: () => T): T {
    // 使用 useState 保存当前属性值，初始值直接调用 read 函数获取
    const [value, setValue] = useState(read);
    // 使用 useEffect 在组件挂载时建立 reaction 订阅
    useEffect(() => {
        // reaction 的 data 函数为外部传入的 read 函数，建立对目标属性的依赖追踪
        return reaction(read, setValue, { fireImmediately: true });
    }, [read]); // 依赖 read 函数引用，read 变化时重建订阅
    // 返回当前属性值
    return value;
}

// 以下为各具体标志位的读取函数，每个只订阅 Store 中的单一属性
// 读取 isSending 属性
const readIsSending = () => englishAgentStore.isSending;
// 读取 isStreaming 属性
const readIsStreaming = () => englishAgentStore.isStreaming;
// 读取 isHydrating 属性
const readIsHydrating = () => englishAgentStore.isHydrating;
// 读取 sessionId 属性
const readSessionId = () => englishAgentStore.sessionId;
// 读取 toolStatus 属性
const readToolStatus = () => englishAgentStore.toolStatus;

// 导出：订阅「正在发送」标志
export function useEnglishAgentIsSending(): boolean {
    return useEnglishAgentFlag(readIsSending);
}

// 导出：订阅「正在流式」标志
export function useEnglishAgentIsStreaming(): boolean {
    return useEnglishAgentFlag(readIsStreaming);
}

// 导出：订阅「正在水合」标志
export function useEnglishAgentIsHydrating(): boolean {
    return useEnglishAgentFlag(readIsHydrating);
}

// 导出：订阅当前会话 ID
export function useEnglishAgentSessionId(): string | null {
    return useEnglishAgentFlag(readSessionId);
}

// 导出：订阅工具调用状态文案
export function useEnglishAgentToolStatus(): string | null {
    return useEnglishAgentFlag(readToolStatus);
}
```

---

### 4.2 `EnglishAgentMessageList`（EnglishAgentMessageList.tsx）

**路径**：`apps/frontend/src/views/englishLearning/agent/EnglishAgentMessageList.tsx`
**版本**：新增文件
**行数**：1–65

```typescript
// 从 mobx-react 导入 observer 装饰器，使组件成为响应式观察者
import { observer } from 'mobx-react';
// 从 React 导入 memo 用于组件记忆化，RefObject 用于类型标注
import { memo, type RefObject } from 'react';
// 从 Assistant 组件导入消息行组件和相关类型
import {
    AssistantMessageRow, // 单条消息渲染组件
    type AssistantShareSelection, // 分享选择状态类型
    type SelectMessageByChatId, // 按 chatId 选择消息的函数类型
} from '@/components/design/Assistant';
// 从 ContextMenu 组件导入选区菜单项类型
import type { SelectionContextMenuItemsFn } from '@/components/design/ContextMenu';
// 导入英语学习 Agent 的全局 Store
import englishAgentStore from '@/store/englishAgent';
// 导入 Message 类型定义
import type { Message } from '@/types/chat';

// 定义按 chatId 选择消息的函数，从 Store 的 messages 数组中查找
const selectEnglishMessageByChatId: SelectMessageByChatId = (chatId) =>
    englishAgentStore.messages.find((m) => m.chatId === chatId);

// 定义组件 Props 类型，包含消息列表所需的全部回调与状态
type EnglishAgentMessageListProps = {
    // 当前已复制的消息 ID（用于高亮已复制状态）
    isCopyedId: string | undefined;
    // 复制回调：接收 content 和 chatId
    onCopy: (content: string, chatId: string) => void;
    // 保存到知识库回调
    onSaveToKnowledge: (message: Message) => void;
    // 是否允许 AI 分享
    allowAiShare: boolean;
    // 分享选择状态
    shareSelection: AssistantShareSelection;
    // 分享回调
    onShare: (message?: Message) => void;
    // 滚动视口引用
    scrollViewportRef: RefObject<HTMLElement | null>;
    // 是否正在加载（用于显示 loading 态）
    isLoading: boolean;
    // 国际化翻译函数
    t: (key: string, params?: Record<string, unknown>) => string;
    // 选区上下文菜单项生成函数（可选）
    getSelectionContextMenuItems?: SelectionContextMenuItemsFn;
};

// 导出：被 memo 包裹的 observer 组件
// memo 防止父级重渲时不必要地重新渲染本组件（在 props 未变化时）
// observer 使本组件独立订阅 messages 数组的变化
/** 单独订阅 messages：流式 chunk 只重渲染消息列，不带动 ChatEntry / 左侧栏 */
export const EnglishAgentMessageList = memo(
    // observer 包裹的函数组件，独立订阅 englishAgentStore.messages
    observer(function EnglishAgentMessageList({
        isCopyedId, // 已复制消息 ID
        onCopy, // 复制回调
        onSaveToKnowledge, // 存知识库回调
        allowAiShare, // 是否允许 AI 分享
        shareSelection, // 分享选择状态
        onShare, // 分享回调
        scrollViewportRef, // 滚动视口引用
        isLoading, // 加载状态
        t, // 翻译函数
        getSelectionContextMenuItems, // 选区菜单项生成函数
    }: EnglishAgentMessageListProps) {
        // 直接从 Store 读取 messages 数组，建立响应式依赖
        // 因被 observer 包裹，messages 的任何变化（含 content 增量）都会触发本组件重渲
        const messages = englishAgentStore.messages;

        // 遍历 messages 数组，为每条消息渲染一个 AssistantMessageRow
        return messages.map((m, index) => (
            // 每条消息用 m.chatId 作为 React key，确保消息行的稳定性
            <AssistantMessageRow
                key={m.chatId}
                // 传入按 chatId 选择消息的查找函数
                selectMessageByChatId={selectEnglishMessageByChatId}
                // 消息的 chatId
                chatId={m.chatId}
                // 消息在数组中的索引
                index={index}
                // 消息总数（用于判断是否为最后一条）
                messagesLength={messages.length}
                // 已复制消息 ID
                isCopyedId={isCopyedId ?? ''}
                // 复制回调
                onCopy={onCopy}
                // 加载状态
                isLoading={isLoading}
                // 存知识库回调
                onSaveToKnowledge={onSaveToKnowledge}
                // 是否允许 AI 分享
                allowAiShare={allowAiShare}
                // 分享选择状态
                shareSelection={shareSelection}
                // 分享回调
                onShare={onShare}
                // 滚动视口引用
                scrollViewportRef={scrollViewportRef}
                // 指定 variant 为 english，使用英语学习专用样式
                variant="english"
                // 翻译函数
                t={t}
                // 选区菜单项生成函数
                getSelectionContextMenuItems={getSelectionContextMenuItems}
            />
        ));
    }),
);
```

---

### 4.3 AgentPanel 组件拆分（index.tsx）

**路径**：`apps/frontend/src/views/englishLearning/agent/index.tsx`
**版本**：改前 vs 改后
**行数**：1–400

#### 4.3.1 改前：单一 observer AgentPanel（核心片段）

```typescript
// 改前：AgentPanel 是单一 observer，直接读取 messages 数组
// 每接收一个 token，整个组件树（含 ChatEntry）重渲

// 导入 observer
import { observer } from 'mobx-react';

// 主组件：observer 包裹
export const AgentPanel = observer(function AgentPanel({
    input,
    setInput,
    chatInputRef,
    sendMessage,
    onNewChat,
}: AgentPanelProps) {
    // ... 省略：useI18n, useNavigate, useStore 等初始化 ...

    // 直接从 Store 读取 messages，建立对整个数组的响应式依赖
    // 流式 content 变化会触发整个 AgentPanel 重渲
    const messages = englishAgentStore.messages;

    // 直接读取 isStreaming，也会建立对 Store 的依赖
    const isStreaming = englishAgentStore.isStreaming;

    // ... 其余 flag 也直接从 Store 读取 ...

    // footerBody 内联定义，每次重渲都会重新创建 ChatEntry 元素
    // 流式期间每帧重建 ChatEntry，导致输入框卡顿
    const footerBody = (
        <ChatEntry
            // ... props ...
            loading={englishAgentStore.isSending}
            stopGenerating={isStreaming ? () => englishAgentStore.stopGenerating() : undefined}
            // ...
        />
    );

    // 内联消息列表映射，在 AgentPanel 内遍历 messages
    return (
        <AssistantShell
            // ...
            messageList={messages.map((m, index) => (
                <AssistantMessageRow
                    key={m.chatId}
                    // ... 每条消息 props ...
                />
            ))}
            footer={<AssistantFooter>{footerBody}</AssistantFooter>}
        />
    );
});
```

#### 4.3.2 改后：三层组件拆分

**新增子组件 1 — `EnglishAgentShareBar`**

```typescript
// 改后：EnglishAgentShareBar 独立 observer 组件
// 路径：apps/frontend/src/views/englishLearning/agent/index.tsx:64-82
// 版本：改后

// 独立 observer 组件，仅订阅 messages 用于分享全量选择
const EnglishAgentShareBar = observer(function EnglishAgentShareBar({
    shareSelection, // 分享选择状态
    shareFlow, // 分享流程控制
    setShareModelVisible, // 分享弹窗显隐控制
}: {
    shareSelection: ReturnType<typeof useAssistantShare>['shareSelection'];
    shareFlow: ReturnType<typeof useAssistantShare>['shareFlow'];
    setShareModelVisible: Dispatch<SetStateAction<boolean>>;
}) {
    return (
        // AssistantShareBar 组件，传入当前 messages 用于全选计算
        <AssistantShareBar
            messages={englishAgentStore.messages}
            checkboxId="english-learning-agent-share-all"
            shareSelection={shareSelection}
            shareFlow={shareFlow}
            setShareModelVisible={setShareModelVisible}
        />
    );
});
```

**新增子组件 2 — `EnglishAgentScrollShell`**

```typescript
// 改后：EnglishAgentScrollShell 独立组件
// 路径：apps/frontend/src/views/englishLearning/agent/index.tsx:84-235
// 版本：改后

// Scroll 壳组件：使用 signal hooks 订阅流式相关状态
// 不被 observer 包裹，内部使用的 hooks 已通过 reaction 隔离
function EnglishAgentScrollShell({
    scrollControlsRef, // 滚动控制引用
    footerBody, // footer 内容（ChatEntry 或 ShareBar）
    shareChatNode, // 分享节点
    floatAbove, // 浮动元素
    selectionSpeakGetItems, // 选区朗读菜单项
    isCopyedId, // 已复制消息 ID
    onCopy, // 复制回调
    onSaveToKnowledge, // 存知识库回调
    allowAiShare, // 是否允许 AI 分享
    shareSelection, // 分享选择状态
    onShare, // 分享回调
    isSending, // 正在发送标志
    t, // 翻译函数
}: {
    // Props 类型定义（省略详细注释）
    scrollControlsRef: RefObject<ScrollControls>;
    footerBody: ReactNode;
    shareChatNode: ReactNode;
    floatAbove: ReactNode;
    selectionSpeakGetItems: ReturnType<typeof useAssistantSelectionSpeak>['getSelectionContextMenuItems'];
    isCopyedId: string | undefined;
    onCopy: (content: string, chatId: string) => void;
    onSaveToKnowledge: (message: Message) => void;
    allowAiShare: boolean;
    shareSelection: ReturnType<typeof useAssistantShare>['shareSelection'];
    onShare: (message?: Message) => void;
    isSending: boolean;
    t: (key: string, params?: Record<string, unknown>) => string;
}) {
    // 使用 signal hook 订阅流式 tick：仅 content 变化时更新
    const streamTick = useEnglishAgentStreamTick();
    // 使用 signal hook 订阅消息条数：仅条数变化时更新
    const messageCount = useEnglishAgentMessageCount();
    // 使用 signal hook 订阅 isStreaming 标志
    const isStreaming = useEnglishAgentIsStreaming();
    // 使用 signal hook 订阅 isHydrating 标志
    const isHydrating = useEnglishAgentIsHydrating();
    // 使用 signal hook 订阅 sessionId
    const sessionId = useEnglishAgentSessionId();
    // 使用 signal hook 订阅 toolStatus
    const toolStatus = useEnglishAgentToolStatus();

    // 计算空闲 flush key：用于滚动 hook 的空闲态重置
    // 仅在非 hydrating 且有消息时生成
    const idleFlushKey = useMemo((): string | null => {
        if (isHydrating) return null;
        if (messageCount === 0) return null;
        return `${sessionId ?? 'none'}-${messageCount}`;
    }, [isHydrating, sessionId, messageCount]);

    // 调用 useAssistantScroll hook，传入 streamTick 作为 contentRevision
    // streamTick 变化时触发贴底滚动逻辑
    const {
        viewportRef: scrollViewportRef, // 滚动视口引用
        scrollAreaHandlers, // 滚动区域事件处理器
        enableStickToBottom: enableStreamStickToBottom, // 启用贴底函数
        flushScrollToBottom, // 立即刷入贴底函数
        scrollFabMode, // 滚动 FAB 模式
        onScrollFabClick, // FAB 点击处理
    } = useAssistantScroll({
        contentRevision: streamTick, // 流式 revision，每帧最多变一次
        messageCount, // 消息条数
        isStreaming, // 是否正在流式
        resetKey: `english-learning:${sessionId ?? 'none'}`, // 会话级重置 key
        idleFlushKey, // 空闲 flush key
        scrollBehavior: 'auto', // 滚动行为
    });

    // 将 enableStickToBottom 暴露给外部引用
    scrollControlsRef.current.enableStickToBottom = enableStreamStickToBottom;
    // 将 flushScrollToBottom 暴露给外部引用
    scrollControlsRef.current.flushScrollToBottom = flushScrollToBottom;

    // 判断会话列是否激活（非 hydrating 且有消息）
    const conversationColumnActive = !isHydrating && messageCount > 0;

    // 渲染工具状态条（toolStatus 存在时显示）
    const toolStatusBlock = toolStatus ? (
        <div className="max-w-3xl px-4.5 py-3">
            <div className="w-full border border-theme/10 rounded-md bg-theme/5 text-textcolor/60 shrink-0 px-4 py-2 text-center text-sm">
                {toolStatus}
            </div>
        </div>
    ) : null;

    // 渲染 AssistantShell 外壳
    return (
        <div
            className={cn(
                'relative flex h-full w-full flex-col overflow-hidden bg-theme-background',
            )}
        >
            <AssistantShell
                t={t}
                isLoading={isHydrating}
                loadingText={t('englishLearning.loading')}
                hasMessages={messageCount > 0}
                emptyState={/* 空态内容 */}
                viewportRef={scrollViewportRef}
                scrollAreaHandlers={scrollAreaHandlers}
                className="mt-4.5"
                messageContainerClassName="px-4.5 pt-0"
                // 关键：消息列表使用独立的 EnglishAgentMessageList 组件
                messageList={
                    <EnglishAgentMessageList
                        isCopyedId={isCopyedId}
                        onCopy={onCopy}
                        onSaveToKnowledge={onSaveToKnowledge}
                        allowAiShare={allowAiShare}
                        shareSelection={shareSelection}
                        onShare={onShare}
                        scrollViewportRef={scrollViewportRef as RefObject<HTMLElement | null>}
                        isLoading={isSending}
                        t={t}
                        getSelectionContextMenuItems={selectionSpeakGetItems}
                    />
                }
                afterScroll={toolStatusBlock}
                footer={
                    <AssistantFooter
                        embedded={conversationColumnActive}
                        containerClassName="px-4.5"
                        showScrollFab={conversationColumnActive && scrollFabMode !== 'hidden'}
                        scrollFab={{/* FAB 配置 */}}
                        floatAbove={floatAbove}
                    >
                        {footerBody}
                        {shareChatNode}
                    </AssistantFooter>
                }
            />
            {/* 空态下的工具状态条 */}
            {!conversationColumnActive && toolStatus ? (
                <div className="border-theme/10 bg-theme/5 text-textcolor/60 shrink-0 border-t px-4 py-2 text-center text-sm">
                    {toolStatus}
                </div>
            ) : null}
        </div>
    );
}
```

**外层 `AgentPanel`（observer，不订阅 messages 内容）**

```typescript
// 改后：AgentPanel 外层 observer，使用 signal hooks 读取 Store
// 路径：apps/frontend/src/views/englishLearning/agent/index.tsx:237-400
// 版本：改后

// observer 仅用于 userStore 等非流式字段；勿在 render 读 messages / content
/** observer 仅用于 userStore 等非流式字段；勿在 render 读 messages / content */
export const AgentPanel = observer(function AgentPanel({
    input,
    setInput,
    chatInputRef,
    sendMessage,
    onNewChat,
}: AgentPanelProps) {
    // 国际化
    const { t } = useI18n();
    // 路由导航
    const navigate = useNavigate();
    // 获取全局 store（含 userStore，知识库 store）
    const { knowledgeStore, userStore } = useStore();
    // 判断登录状态
    const isLoggedIn = Boolean(userStore.userInfo?.id);
    // 历史抽屉开关状态
    const [isHistoryDrawerOpen, setIsHistoryDrawerOpen] = useState(false);
    // 复制相关功能
    const { isCopyedId, onCopy } = useAssistantCopy();
    // 选区朗读功能
    const selectionSpeak = useAssistantSelectionSpeak();

    // 使用 signal hooks 替代直接读取 Store
    // 这些 hook 通过 reaction 隔离，不会因 content 变化触发重渲
    const isSending = useEnglishAgentIsSending();
    const isStreaming = useEnglishAgentIsStreaming();
    const sessionId = useEnglishAgentSessionId();

    // 滚动控制引用，暴露给子组件和回调使用
    const scrollControlsRef = useRef<ScrollControls>({
        enableStickToBottom: () => {},
        flushScrollToBottom: () => {},
    });

    // 登录后刷新会话列表
    useEffect(() => {
        if (!isLoggedIn) return;
        void englishAgentStore.refreshSessionList();
    }, [isLoggedIn]);

    // 历史抽屉打开时刷新会话列表
    useEffect(() => {
        if (!isHistoryDrawerOpen) return;
        void englishAgentStore.refreshSessionList();
    }, [isHistoryDrawerOpen]);

    // 初始化分享功能
    const {
        allowAiShare,
        shareFlow,
        shareSelection,
        onShare,
        setShareModelVisible,
        shareChatNode,
    } = useAssistantShare({
        getAllMessages: getEnglishMessages, // 惰性读取函数
        sessionId,
        sessionType: 'agent',
        enabled: isLoggedIn && Boolean(sessionId),
    });

    // 保存到知识库回调
    const onSaveToKnowledge = useCallback(
        (message: Message) => {
            // ... 保存逻辑 ...
        },
        [knowledgeStore, navigate, t],
    );

    // 发送消息回调
    const handleSendMessage = useCallback(async () => {
        scrollControlsRef.current.enableStickToBottom();
        await sendMessage();
    }, [sendMessage]);

    // 新建对话回调
    const handleNewChat = useCallback(() => {
        selectionSpeak.stop();
        onNewChat();
    }, [onNewChat, selectionSpeak.stop]);

    // 暴露 enableStickToBottom 的稳定回调
    const enableStickToBottomStable = useCallback(() => {
        scrollControlsRef.current.enableStickToBottom();
    }, []);

    // 暴露 flushScrollToBottom 的稳定回调
    const flushScrollToBottomStable = useCallback(
        (options?: { force?: boolean }) => {
            scrollControlsRef.current.flushScrollToBottom(options);
        },
        [],
    );

    // footerBody 通过 useMemo 保持引用稳定
    // 当 allowAiShare 为 true 且处于分享态时，渲染 EnglishAgentShareBar
    // 否则渲染 ChatEntry（输入框）
    // useMemo 的 deps 不包含 messages，因此流式期间 footerBody 引用稳定
    const footerBody = useMemo(() => {
        if (allowAiShare && shareSelection.isSharing) {
            return (
                <EnglishAgentShareBar
                    shareSelection={shareSelection}
                    shareFlow={shareFlow}
                    setShareModelVisible={setShareModelVisible}
                />
            );
        }
        return (
            <ChatEntry
                t={t}
                chatInputRef={chatInputRef}
                input={input}
                setInput={setInput}
                className="w-full px-0 pb-4.5"
                textareaClassName="min-h-12 rounded-md"
                inputWrapClassName="border-theme/5 bg-theme/5"
                sendMessage={handleSendMessage}
                placeholder={t('englishLearning.placeholder')}
                disableTextInput={false}
                loading={isSending}
                stopGenerating={
                    isStreaming ? () => englishAgentStore.stopGenerating() : undefined
                }
                entryChildren={
                    <AssistantSessionEntryToolbar
                        store="english"
                        visible={isLoggedIn}
                        showSessionActions
                        isSessionSwitcherLocked={false}
                        isHistoryDrawerOpen={isHistoryDrawerOpen}
                        setIsHistoryDrawerOpen={setIsHistoryDrawerOpen}
                        enableStreamStickToBottom={enableStickToBottomStable}
                        flushScrollToBottom={flushScrollToBottomStable}
                        onNewConversation={handleNewChat}
                    />
                }
            />
        );
    }, [
        // deps：仅包含与 footer 结构相关的变量，不含 messages
        allowAiShare,
        shareSelection,
        shareFlow,
        setShareModelVisible,
        t,
        chatInputRef,
        input,
        setInput,
        handleSendMessage,
        isSending,
        isStreaming,
        isLoggedIn,
        isHistoryDrawerOpen,
        enableStickToBottomStable,
        flushScrollToBottomStable,
        handleNewChat,
    ]);

    // 渲染 EnglishAgentScrollShell，将所有 props 传递给子组件
    return (
        <EnglishAgentScrollShell
            scrollControlsRef={scrollControlsRef}
            footerBody={footerBody}
            shareChatNode={shareChatNode}
            floatAbove={selectionSpeak.floatAbove}
            selectionSpeakGetItems={selectionSpeak.getSelectionContextMenuItems}
            isCopyedId={isCopyedId}
            onCopy={onCopy}
            onSaveToKnowledge={onSaveToKnowledge}
            allowAiShare={allowAiShare}
            shareSelection={shareSelection}
            onShare={onShare}
            isSending={isSending}
            t={t}
        />
    );
});
```

---

### 4.4 Store 层 MobX Patch 调度（englishAgent.ts）

**路径**：`apps/frontend/src/store/englishAgent.ts`
**版本**：改前 vs 改后
**涉及函数**：`sendMessage` 内的 `patchAssistant` 相关逻辑

#### 4.4.1 改前：数组元素替换 + 无调度

```typescript
// 改前：sendMessage 内的流式 patch 逻辑
// 路径：apps/frontend/src/store/englishAgent.ts（sendMessage 函数内部）
// 版本：改前

// 累积字符串
let accumulated = '';

// patchAssistant：每接收一个 delta token 立即触发一次 MobX 写入
const patchAssistant = (delta: string) => {
    // 累加 delta 到 accumulated
    accumulated += delta;
    // 立即在 action 中查找并替换数组元素
    runInAction(() => {
        // 在 messages 中找到 assistant 消息的索引
        const idx = st.messages.findIndex((m) => m.chatId === assistantRowId);
        // 若未找到则直接返回
        if (idx < 0) return;
        // 读取旧的消息对象
        const prev = st.messages[idx] as Message;
        // 用展开运算符创建新对象替换数组元素
        // 问题：数组元素替换触发 MobX 数组级通知，整个 MessageList 重渲
        st.messages[idx] = { ...prev, content: accumulated };
    });
};
```

#### 4.4.2 改后：rAF 合并 + 原地 mutation + flush 收尾

```typescript
// 改后：sendMessage 内的流式 patch 逻辑
// 路径：apps/frontend/src/store/englishAgent.ts:531-684
// 版本：改后

// 累积字符串
let accumulated = '';

// flushAssistantPatch：将累积的 content 一次性写入 Store
// 使用 findIndex 定位消息，采用原地 mutation（prev.content = accumulated）
// 而非数组元素替换，避免触发数组级 observer 通知
/** 就地改 content：不替换数组元素，避免整表 MessageList 随 token 重渲染 */
const flushAssistantPatch = () => {
    // 包裹在 runInAction 中，确保 MobX 事务性
    runInAction(() => {
        // 在 messages 中定位 assistant 消息
        const idx = st.messages.findIndex((m) => m.chatId === assistantRowId);
        // 未找到则跳过
        if (idx < 0) return;
        // 获取消息对象的引用（makeAutoObservable 下为 observable 对象）
        const prev = st.messages[idx] as Message;
        // 内容未变化则跳过，避免不必要的触发
        if (prev.content === accumulated) return;
        // 原地修改 content 属性，不替换数组元素
        // MobX 会通知订阅了该 message.content 的 observer（即 AssistantMessageRow）
        // 但不会通知订阅了 messages 数组引用的 observer
        prev.content = accumulated;
    });
};

// 创建流式 MobX Patch 调度器
// createStreamingMobxPatchScheduler 内部使用 requestAnimationFrame 合并多次写入
// 每帧最多调用一次 flushAssistantPatch，将多个 token 合并为一次 UI 更新
const assistantPatchScheduler =
    createStreamingMobxPatchScheduler(flushAssistantPatch);

// patchAssistant：每接收一个 delta token 调用 schedule()，而非立即写入
const patchAssistant = (delta: string) => {
    // 累加 delta 到 accumulated
    if (delta) accumulated += delta;
    // 请求调度器在下一帧执行 flushAssistantPatch
    // 若当前帧已有待执行的 flush，则 skip（合并多次 schedule）
    assistantPatchScheduler.schedule();
};
```

**onComplete / onError / catch 中的 flush 调用**

```typescript
// 改后：在 onComplete 中先 flush 再收尾
// 路径：apps/frontend/src/store/englishAgent.ts:614-663
// 版本：改后

// onComplete 回调：流式结束时触发
onComplete: (err) => {
    // 关键：先 flush 调度器，确保最后一批 token 写入 Store
    // 避免 rAF 中的 flush 还未执行，isStreaming 已被设为 false
    assistantPatchScheduler.flush();
    // 然后执行收尾逻辑
    runInAction(() => {
        st.isSending = false;
        // ... 设置 isStreaming=false, 清理 abortStream 和 toolStatus ...
    });
    // 刷新会话列表
    void this.refreshSessionList();
},

// onError 回调：流式出错时触发
onError: () => {
    // 先 flush 调度器，确保已接收的内容不丢失
    assistantPatchScheduler.flush();
    // 然后执行错误收尾
    runInAction(() => {
        st.isSending = false;
        // ... 设置 isStreaming=false, content='请求中断', 清理 ...
    });
},

// catch 块：streamAgentSse 抛出异常时
catch {
    // 先 flush 调度器
    assistantPatchScheduler.flush();
    // 然后执行异常收尾
    runInAction(() => {
        st.isSending = false;
        // ... 设置 isStreaming=false, 清理 ...
    });
}
```

**调度器工具函数**

```typescript
// 路径：apps/frontend/src/utils/scheduleStreamingMobxPatch.ts
// 版本：工具函数（未改动，被新引入使用）

// 导入类型定义
export type StreamingMobxPatchScheduler = {
    // schedule：请求在下一帧执行 flush，若当前帧已有待执行则跳过
    schedule: () => void;
    // flush：立即执行 pending 的 flush，并取消 rAF
    flush: () => void;
    // cancel：取消 pending 的 rAF，不执行 flush
    cancel: () => void;
};

// 创建流式 MobX Patch 调度器
export function createStreamingMobxPatchScheduler(
    flush: () => void, // 刷写函数，由调用方提供
): StreamingMobxPatchScheduler {
    // rAF 帧 ID，初始为 0 表示无待执行
    let rafId = 0;
    // dirty 标志：当前帧是否有待执行的 flush
    let dirty = false;

    // rAF 回调：执行 flush 并重置状态
    const runFlush = () => {
        dirty = false;
        rafId = 0;
        flush(); // 执行调用方提供的刷写函数
    };

    return {
        // schedule：请求下一帧执行 flush
        schedule: () => {
            if (dirty) return; // 已有待执行，skip（合并多次调用）
            dirty = true;
            rafId = requestAnimationFrame(runFlush);
        },
        // flush：立即执行 pending flush
        flush: () => {
            if (rafId) cancelAnimationFrame(rafId); // 取消待执行的 rAF
            dirty = false;
            rafId = 0;
            flush(); // 立即执行
        },
        // cancel：取消 pending flush
        cancel: () => {
            if (rafId) cancelAnimationFrame(rafId);
            dirty = false;
            rafId = 0;
        },
    };
}
```

---

## 5. 兼容性与影响

### 5.1 功能兼容性

| 维度 | 影响 | 说明 |
|------|------|------|
| 发送 / 停止生成 | **无影响** | 仍调 `sendMessage` / `stopGenerating`；`loading`←`isSending`，`stopGenerating`←`isStreaming` |
| 流式贴底 / 上滑打断 / FAB | **无影响** | 仍通过 `useAssistantScroll({ contentRevision: streamTick, ... })`；打断策略未改 |
| 消息展示 / SSE 全文 | **无影响** | 累积 `accumulated` 语义不变；仅改为每帧最多一次写入 + 原地改 `content` |
| ChatEntry / 输入 | **增强** | 流式期间 `footerBody` 引用稳定，输入框不再随 token 重渲 |
| 分享勾选 / ShareBar | **无影响** | `getAllMessages` 惰性读；分享态仍通过 `EnglishAgentShareBar` observer 独立订阅 |
| 选区朗读 / 复制 / 存知识库 | **无影响** | Props 与 Hook 接线不变 |
| 工具状态条 / 空态 / hydrate | **无影响** | `toolStatus` / `isHydrating` / `messageCount` 经 reaction，语义同前 |
| 会话切换 / 历史抽屉 | **无影响** | `switchSession` / `hydrateSession` 逻辑未变 |

### 5.2 性能影响

| 场景 | 改前 | 改后 |
|------|------|------|
| 流式 token 到达 | 整个 AgentPanel + ChatEntry + ShareBar 重渲 | 仅 EnglishAgentMessageList 重渲 |
| 每帧 MobX 写入次数 | 每 token 1 次 | 每帧最多 1 次（rAF 合并） |
| 数组元素操作 | `{ ...prev, content }` 替换 | `prev.content = accumulated` 原地 mutation |

### 5.3 潜在风险

| 风险 | 缓解 |
|------|------|
| 末包未 flush 丢字 | `onComplete` / `onError` / `catch` 三处均调用 `flush()` |
| 原地 mutation 不触发 UI | `makeAutoObservable` 下 `push` 的消息对象为 observable，`content` 赋值可被 `AssistantMessageRow` 订阅 |
| `footerBody` deps 含 `shareSelection` | 分享态切换会重建 ChatEntry；非分享流式路径不会每帧变化 |
| AgentPanel 误再读 `messages` | 代码注释已警告；Code Review 把关 |

---

## 6. 相关源码路径

| 文件 | 职责 |
|------|------|
| `apps/frontend/src/views/englishLearning/agent/useEnglishAgentSignals.ts` | 精细化 signal hooks：messageCount / streamTick / flags |
| `apps/frontend/src/views/englishLearning/agent/EnglishAgentMessageList.tsx` | 独立 observer 消息列表组件 |
| `apps/frontend/src/views/englishLearning/agent/index.tsx` | AgentPanel 主组件 + EnglishAgentShareBar + EnglishAgentScrollShell |
| `apps/frontend/src/store/englishAgent.ts` | EnglishAgentStore：sendMessage 流式 patch + scheduler |
| `apps/frontend/src/utils/scheduleStreamingMobxPatch.ts` | rAF 合并调度器工具函数 |
| `apps/frontend/src/components/design/Assistant/utils.ts` | `buildStreamTick` revision 构建工具 |

### 交叉引用

- [影响点分析：英语学习 Agent 流式输入性能](../impact/英语Agent流式输入性能影响.md)
- [相关优化：流式代码块滚动](../chat/流式代码块滚动.md)
- [同源实现：知识库 Signal Hooks](./hooks/useAssistantMessageCount.ts)
- [相关工具：createStreamingMobxPatchScheduler](./utils/scheduleStreamingMobxPatch.ts)

（若与仓库最新源码不一致，以源码为准）