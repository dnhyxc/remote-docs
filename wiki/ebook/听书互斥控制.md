# 电子书听书与选区朗读互斥控制

## 1. 背景与目标

电子书阅读器（MOKE 阅读页）同时支持两种音频播放功能：
1. **章节听书（Chapter Listen）**：后台连续朗读整章内容，配合页面滚动高亮。
2. **选区朗读（Selection Speak）**：在助手面板中选中文本后朗读，配合悬浮控制条逐句预览。

两者共享同一个 TTS 播放引擎，若同时启用会导致音频冲突和状态混乱。本次变更的目标是建立**互斥控制机制**，确保在任意时刻只能有一个朗读会话活跃，并优化相关 UI 体验。

## 2. 改动范围

- **互斥控制逻辑**：
  - `apps/frontend/src/views/ebook/read.tsx`：听书页主容器，新增双向互斥控制
  - `apps/frontend/src/views/ebook/components/reader/EbookAssistant.tsx`：电子书助手，新增选区朗读停止暴露
- **UI 细节**：
  - `apps/frontend/src/views/ebook/components/listen/EpubListenPlayerBar.tsx`：图标替换、布局微调
- **选区清理修复**：
  - `apps/frontend/src/views/ebook/utils/epub/reader/epubSelectionToolbarAttach.ts`：修复选区清理逻辑

## 3. 实现思路

### 3.1 双向互斥控制

核心原则：**听书和选区朗读在同一页面内互斥，但跨页面独立。**

在 `read.tsx` 中建立双向停止机制：

1. **开听书前停朗读**：当用户点击"开始听书"时，先调用 `stopAssistantSelectionSpeak()` 停掉助手面板中可能正在播放的选区朗读，然后再启动章节听书。
2. **开朗读前停听书**：当用户在助手面板中选择"朗读"时，`onBeforeSelectionSpeak` 钩子会先调用 `stopChapterListenForSpeak()` 停掉当前章节听书，再启动选区朗读。

### 3.2 状态暴露模式

使用 `useRef` + 回调模式将子组件的停止方法暴露给父组件：

- `EbookAssistant` 组件接收 `selectionSpeakStopRef` 属性（`RefObject`），将内部 `selectionSpeak.stop` 写入该 ref。
- `read.tsx` 持有 `assistantSpeakStopRef`，通过 `stopAssistantSelectionSpeak` 回调调用 `assistantSpeakStopRef.current?.()`。
- 反向：`read.tsx` 将 `stopChapterListenForSpeak` 回调传给 `EbookAssistant` 的 `onBeforeSelectionSpeak` 属性。

这种 ref 模式避免了不必要的 re-render，停止方法只有在真正需要调用时才通过 ref 访问。

### 3.3 听书播放器 UI 优化

- **图标替换**：将 `Pause`/`Play`/`Square` 替换为 `SquarePause`/`SquarePlay`/`SquareStop`，风格更统一。
- **布局微调**：进度标签区增加左边距 `ml-2`，倍速按钮宽度从 `w-15` 收窄为 `w-11`，增加 `ml-2` 左外边距。
- **Spinner 颜色**：`Spinner` 组件默认使用 `text-default`，关于页的 `Spinner` 增加 `text-textcolor` 显式指定颜色。

### 3.4 选区清理修复

旧版 `clearEpubTextSelection` 函数在清理 iframe 内选区后，还会调用 `window.getSelection()?.removeAllRanges()` 清理顶层选区。这在侧栏助手面板拖选时会导致选区被意外清除——因为侧边栏的选区（用于助手面板的拖选/上下文菜单）也在顶层 `document` 上。

修复：移除对 `window.getSelection()` 的清理操作，只清理 iframe 内的选区。注释明确说明这是为了避免侧栏问书拖选断裂。

## 4. 关键代码对比与注释

### 4.1 听书页互斥控制

**对比范围**：`EbookReadPage` 组件内的互斥逻辑

**改动前** · `apps/frontend/src/views/ebook/read.tsx`（基线，约 L225-L2600）

```typescript
// 旧版：听书和选区朗读独立管理，没有互斥控制
function EbookReadPage() {
    // 章节听书控制
    const { toggleListen, listenLabel } = useEbookQuoteListen(t, ..., {
        startFromCfi: (cfi, mode, anchorRange, selectionPlain) =>
            chapterListenRef.current.startFromCfi(cfi, mode, anchorRange, selectionPlain),
    });

    // 助手面板（可能在右侧或底部）
    {assistantOpen && (
        <EbookAssistant
            bookTitle={book.title}
            input={assistantInput}
            onInputChange={setAssistantInput}
        />
    )}

    // 听书按钮直接调用 toggle，不涉及选区朗读
    <Button onClick={chapterListen.toggleChapterListen}>
        <Headphones />
    </Button>
}
```

**改动后** · `apps/frontend/src/views/ebook/read.tsx`（当前，约 L225-L2960）

```typescript
// 新版：建立双向互斥控制
function EbookReadPage() {
    const chapterListenRef = useRef(chapterListen);
    chapterListenRef.current = chapterListen;

    // ===== 新增：双向互斥控制 =====

    // 1. 暴露助手选区朗读的 stop 方法（供听书使用）
    const assistantSpeakStopRef = useRef<(() => void) | null>(null);
    const stopAssistantSelectionSpeak = useCallback(() => {
        assistantSpeakStopRef.current?.();
    }, []);

    // 2. 暴露章节听书的 stop 方法（供助手选区朗读使用）
    const stopChapterListenForSpeak = useCallback(() => {
        chapterListenRef.current.stop();
    }, []);

    // 3. 核心互斥逻辑：开听书前先停选区朗读
    const toggleChapterListenExclusive = useCallback(() => {
        // 只有在启动听书时（从 idle 状态）才需要停朗读
        // 暂停/继续听书时不需要停朗读
        if (chapterListenRef.current.status === 'idle') {
            stopAssistantSelectionSpeak();
        }
        chapterListenRef.current.toggleChapterListen();
    }, [stopAssistantSelectionSpeak]);

    // ===== 听书启动接口也加入互斥 =====
    const { toggleListen, listenLabel } = useEbookQuoteListen(t, ..., {
        startFromCfi: (cfi, mode, anchorRange, selectionPlain) => {
            // 朗读新章节前先停助手选区朗读
            stopAssistantSelectionSpeak();
            chapterListenRef.current.startFromCfi(cfi, mode, anchorRange, selectionPlain);
        },
    });

    // 切章时，如果正在听书，停掉选区朗读后再重启
    // ... useEffect 内的逻辑

    // ===== 助手面板集成 =====
    {assistantOpen && (
        <EbookAssistant
            bookTitle={book.title}
            input={assistantInput}
            onInputChange={setAssistantInput}
            // 开播前钩子：停掉章节听书
            onBeforeSelectionSpeak={stopChapterListenForSpeak}
            // 暴露 stop 方法供听书调用
            selectionSpeakStopRef={assistantSpeakStopRef}
        />
    )}

    // ===== 听书按钮改用互斥版 =====
    <Button onClick={toggleChapterListenExclusive}>
        <Headphones className="size-4" />
    </Button>

    // 另一个助手面板实例（详情弹窗）
    // ... 同样传递 onBeforeSelectionSpeak 和 selectionSpeakStopRef
}
```

**变更摘要**：通过 `useRef` + `useCallback` 建立双向停止机制。听书启动前停选区朗读（`toggleChapterListenExclusive`），选区朗读启动前停听书（`onBeforeSelectionSpeak` 钩子）。切章时也会停掉选区朗读再重启听书。

### 4.2 `EbookAssistant` 集成互斥钩子

**对比范围**：`EbookAssistant` 组件选区朗读集成部分

**改动前** · `apps/frontend/src/views/ebook/components/reader/EbookAssistant.tsx`（基线）

```typescript
// 旧版：无选区朗读集成
export type EbookAssistantProps = {
    // ...
    bookTitle: string;
    input?: string;
    onInputChange?: (value: string) => void;
};

const EbookAssistantInner = observer(function EbookAssistantInner({ ... }) {
    // 无 selectionSpeak 相关逻辑
    return (
        <AssistantShell ... />
    );
});
```

**改动后** · `apps/frontend/src/views/ebook/components/reader/EbookAssistant.tsx`（当前，约 L38-L280）

```typescript
// 新版：集成选区朗读并暴露停止方法
export type EbookAssistantProps = {
    // ...
    bookTitle: string;
    input?: string;
    onInputChange?: (value: string) => void;
    // ===== 新增：互斥控制接口 =====
    // 选区朗读开播前调用（听书页用来先停章节听书）
    onBeforeSelectionSpeak?: () => void;
    // 向外暴露 stop，供听书开播前停选区朗读
    selectionSpeakStopRef?: RefObject<(() => void) | null>;
};

const EbookAssistantInner = observer(function EbookAssistantInner({
    // ...
    onBeforeSelectionSpeak,
    selectionSpeakStopRef,
}) {
    // 创建面板 ref（用于内容布局，不再作为控制条拖动边界）
    const panelRef = useRef<HTMLDivElement>(null);

    // 接入选区朗读 Hook，传入开播前钩子和初始宽度
    // 不再需要传 panelRef——控制条通过 [data-app-layout] 自动定位拖动边界
    const selectionSpeak = useAssistantSelectionSpeak({
        onBeforeStart: onBeforeSelectionSpeak,
        initialWidth: 344,  // 电子书助手面板宽度
    });

    // 将 selectionSpeak.stop 暴露给父组件
    useEffect(() => {
        if (!selectionSpeakStopRef) return;
        selectionSpeakStopRef.current = selectionSpeak.stop;
        return () => {
            selectionSpeakStopRef.current = null;
        };
    }, [selectionSpeak.stop, selectionSpeakStopRef]);

    // 换书/切会话时停掉选区朗读，避免串台
    useEffect(() => {
        selectionSpeak.stop();
    }, [bookId, ebookAssistantStore.activeSessionId, selectionSpeak.stop]);

    return (
        <div ref={panelRef} className="relative flex h-full min-h-0 w-full flex-col">
            <AssistantShell
                // ...
                // 传递选区朗读的菜单项和悬浮条
                floatAbove={selectionSpeak.floatAbove}
                // 每条消息的上下文菜单项中包含"朗读"
                getSelectionContextMenuItems={selectionSpeak.getSelectionContextMenuItems}
            >
                {/* 消息列表 */}
            </AssistantShell>
        </div>
    );
});
```

**变更摘要**：`EbookAssistant` 通过 `useAssistantSelectionSpeak` 集成选区朗读能力，通过 `selectionSpeakStopRef` 将 `stop` 方法暴露给父组件，通过 `onBeforeSelectionSpeak` 在开播前停掉章节听书。换书或切换会话时自动停止选区朗读，防止"串台"。

### 4.3 选区清理修复

**对比范围**：`clearEpubTextSelection` 函数

**改动前** · `apps/frontend/src/views/ebook/utils/epub/reader/epubSelectionToolbarAttach.ts`（基线，约 L96-L127）

```typescript
/** 清除 rendition 各 iframe 及顶层的文字选区 */
export function clearEpubTextSelection(rend: Rendition): void {
    const prev = document.activeElement;
    // ... 清理各 iframe 内选区 ...

    // 旧版：同时清理顶层选区
    try {
        window.getSelection()?.removeAllRanges();
    } catch {
        // ignore
    }

    if (!restore || document.activeElement === prev) return;
    // ... 恢复焦点 ...
}
```

**改动后** · `apps/frontend/src/views/ebook/utils/epub/reader/epubSelectionToolbarAttach.ts`（当前，约 L96-L130）

```typescript
/** 清除 rendition 各 iframe 内的文字选区（正文只在 iframe，勿动顶层选区） */
export function clearEpubTextSelection(rend: Rendition): void {
    const prev = document.activeElement;
    // ... 清理各 iframe 内选区（代码不变） ...

    // 关键修复：不再清理顶层选区
    // 原因：侧栏问书拖选会因 ScrollArea 自动滚动触发
    // attachEpubSelectionPopBar 的 window/document scroll 监听
    // 误清顶层选区导致拖选断裂
    // ponytail: 保留顶层选区，让侧栏助手面板的选区操作不受影响

    if (!restore || document.activeElement === prev) return;
    // ... 恢复焦点（仅操作 iframe 内的 activeElement） ...
}
```

**变更摘要**：移除了 `window.getSelection()?.removeAllRanges()` 调用。该调用原本用于清理顶层选区，但在侧栏助手面板拖选场景中会意外清除面板内的选区，导致上下文菜单（朗读/复制）失效。修复后只清理 iframe 内的正文选区，侧栏选区不受影响。

### 4.4 听书播放器 UI 优化

**对比范围**：`EpubListenPlayerBar` 组件内的图标和布局

**改动前** · `apps/frontend/src/views/ebook/components/listen/EpubListenPlayerBar.tsx`（基线）

```typescript
// 旧版图标
import { ChevronUp, ListOrdered, LocateFixed, Pause, Play, Square } from 'lucide-react';

// 旧版布局
<span className="text-textcolor/70 min-w-0 flex-1 truncate text-xs">
    {progressLabel}
</span>

// 旧版倍速按钮
className={cn(
    'text-textcolor/80 border-theme/5 bg-textcolor/8 hover:bg-textcolor/12',
    'h-6 w-15 shrink-0 gap-0.5 rounded-md border px-2.5 text-xs font-medium tabular-nums',
)}
```

**改动后** · `apps/frontend/src/views/ebook/components/listen/EpubListenPlayerBar.tsx`（当前）

```typescript
// 新版：风格更统一的方形图标
import { ChevronUp, ListOrdered, LocateFixed, SquarePause, SquarePlay, SquareStop } from 'lucide-react';

// 新版布局：增加左边距，视觉层次更清晰
<span className="text-textcolor/70 min-w-0 flex-1 truncate text-xs ml-2">
    {progressLabel}
</span>

// 新版倍速按钮：收窄宽度，增加左外边距
className={cn(
    'ml-2 text-textcolor/80 border-theme/5 bg-textcolor/8 hover:bg-textcolor/12',
    'h-6 w-11 shrink-0 gap-0.5 rounded-md border px-2.5 text-xs font-medium tabular-nums',
)}

// 图标替换
{loading ? (
    <Spinner className="size-4 text-teal-500" />
) : playing ? (
    <SquarePause className="size-4" />   // 原 Pause
) : (
    <SquarePlay className="size-4" />    // 原 Play
)}
// 停止按钮
<SquareStop className="size-4" />        // 原 Square
```

**变更摘要**：图标从圆形/填充风格（`Pause`/`Play`/`Square`）统一为方形线条风格（`SquarePause`/`SquarePlay`/`SquareStop`），与项目其它控制按钮风格保持一致。布局上微调间距和尺寸。

## 5. 兼容性与影响

- **互斥行为**：在电子书阅读页内，听书和选区朗读现在严格互斥。启动其中一个会自动停止另一个。跨页面（如其它路由）的播放不受影响。
- **切章重启**：切换章节时，如果正在听书，会先停掉助手选区朗读（避免串台），然后重启听书。
- **会话切换保护**：在 `EbookAssistant` 中，切换书籍或会话时会自动停止选区朗读，避免上下文错乱。
- **选区清理**：移除顶层选区清理后，侧栏助手面板的文本选择操作不再被中断。但这也意味着在阅读页正文选中的文本在某些极端场景下可能残留——这是预期行为，因为正文选区仅在 iframe 内，不影响顶层。
- **无 breaking change**：所有新增属性（`onBeforeSelectionSpeak`、`selectionSpeakStopRef`）都是可选的，旧版调用方无需修改。

## 6. 相关源码路径

| 说明 | 路径 |
|------|------|
| 听书页主容器 | `apps/frontend/src/views/ebook/read.tsx` |
| 电子书助手组件 | `apps/frontend/src/views/ebook/components/reader/EbookAssistant.tsx` |
| 选区朗读通用 Hook | `apps/frontend/src/components/design/SelectionSpeak/useAssistantSelectionSpeak.tsx` |
| 选区清理函数 | `apps/frontend/src/views/ebook/utils/epub/reader/epubSelectionToolbarAttach.ts` |
| 听书播放器 UI | `apps/frontend/src/views/ebook/components/listen/EpubListenPlayerBar.tsx` |

---

若与仓库最新源码不一致，以源码为准。
