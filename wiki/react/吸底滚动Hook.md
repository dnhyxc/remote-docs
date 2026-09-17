# useStickToBottomScroll（流式贴底滚动 Hook）实现归档

> 文档角色：implementation-doc-from-diff 归档稿
> 改动一轮：知识库预览 + 助手同开时滚动卡顿修复 — 流式贴底滚动优化
> 状态：已落地（2026-07）

## 1. 背景与目标

聊天/知识库助手在流式输出（streaming）时，视口需要随内容增长自动贴底；但存在两类体验问题：

1. **卡顿**：每个 token 到达都会触发 `contentRevision` 变化，旧实现每次都执行「同步 flush + 双层 `requestAnimationFrame`」，高频抢占主线程，导致知识库预览与助手同开时滚动明显掉帧。
2. **误打断**：流式输出中代码块需要横向滚动查看长行，旧实现滚轮任意方向（含横滚 `deltaX`）或代码块内点击都会立即解除贴底，用户横滚代码后无法继续跟底。

本轮目标：

- 将流式高频 `contentRevision` 合并为「每帧最多一次」贴底，消除卡顿。
- 代码块（`.chat-md-code-block` / `[data-streaming-code-fence]`）内横滚或向上滚才打断贴底；向下滚交给 `onScroll` 触底恢复；代码块内点击不打断。
- 新增 `userPinnedAwayRef` 记忆用户主动打断，避免 idleFlush / 流式结束布局变化把视图拉回底部。
- 新增 `idleFlushKey` 非流式贴底通道，覆盖 MdPreview/图片晚一拍撑高场景。
- 卸载时取消未完成的 `requestAnimationFrame`，防止内存泄漏与卸载后写 `scrollTop`。

## 2. 改动范围

- `apps/frontend/src/hooks/useStickToBottomScroll.ts`（唯一改动文件）

涉及的历史版本对照：

| 版本侧 | 来源 | 说明 |
| ------ | ---- | ---- |
| 改动前（早期） | commit `5b5f5762` | hook 首版，Options 无 `idleFlushKey` |
| 改动前（中期） | commit `2818e130` | 加入 `idleFlushKey`，但无 `userPinnedAwayRef`、无代码块特殊处理 |
| 改动前（HEAD） | commit `ab5fd673` | 加入 `userPinnedAwayRef` + 代码块横滚/点击保护；但流式 effect 仍每次双 rAF |
| 改动后（当前） | 工作树当前文件 | 流式 effect 合并为单帧 rAF + 卸载清理 |

> 注：本轮「改动前」按子主题分别取自上述不同基线，§4 各小节来源标注会写明具体版本；「改动后」统一为当前工作树文件。

## 3. 实现思路

1. **`streamFlushRafRef` 合并帧**：用 `useRef<number>` 持有 rAF id，`contentRevision` 变化时若已有挂起 rAF 则直接 `return`，把同帧多次 revision 合并为一次贴底；rAF 回调内清零 id 再执行「flush → 二次 flush → 解除 suppress」三段。
2. **卸载清理**：新增空依赖 `useEffect`，cleanup 里 `cancelAnimationFrame(streamFlushRafRef.current)` 并置 0，防止组件卸载后 rAF 仍写 `scrollTop`。
3. **`userPinnedAwayRef` 记忆**：用户上滑/滚轮上滚/代码块横滚/指针按下时置 `true`；`flushScrollToBottom` 默认尊重该标记（`force` 才绕过）；`onScroll` 在流式底部带内需「主动下滚或贴物理底」才清零恢复跟滚。
4. **代码块保护**：`onWheelCapture` 命中 `.chat-md-code-block, [data-streaming-code-fence]` 时，仅横滚（`absX > absY`）或向上滚（`deltaY < 0`）才打断；`onPointerDownCapture` 命中同选择器直接 `return` 不打断。
5. **`idleFlushKey` 非流式补滚**：与 `isStreaming + contentRevision` 互补；非空串且与上次不同时恢复跟底并连续 `flush`（含 `setTimeout(0)`），覆盖 MdPreview/图片异步撑高。
6. **`resetKey` 重置**：切换会话/路由时恢复跟底、清 `userPinnedAwayRef` 与 `lastViewportScrollTopRef`，避免沿用上一容器滚动观测。

## 4. 关键代码与逐行注释

### 4.1 `Options` 类型新增字段（`idleFlushKey?` / `resetKey?` 等）

**对比范围**：`export interface UseStickToBottomScrollOptions` 全接口（摘录）。

**改动前** · `apps/frontend/src/hooks/useStickToBottomScroll.ts`（commit `5b5f5762`，约 L18–L39）

```typescript
// 导出接口：贴底滚动 Hook 的可选配置项（旧版，尚无 idleFlushKey）
export interface UseStickToBottomScrollOptions {
	// 是否处于流式输出模式：影响恢复/解除策略与 wheel/pointer 是否打断跟底
	isStreaming: boolean;
	// 内容版本戳：变化时在跟底开启下将视口滚到物理底部
	contentRevision: unknown;
	// 切换会话/路由/文档时传入：变化后恢复跟底并清空内部 scrollTop 观测
	resetKey?: string | number | boolean | null;
	// 距底 ≤ 该像素视为底部带（默认 48）
	resumeWithinBottomPx?: number;
	// 非流式下距底 ≥ 该像素视为已离开底部（默认 120）
	releaseBeyondBottomPx?: number;
	// 流式时滚轮向上是否解除跟底，默认 true
	interruptOnWheelUpWhileStreaming?: boolean;
	// 流式时指针按下是否解除跟底，默认 true
	interruptOnPointerDownWhileStreaming?: boolean;
}
```

**改动后** · `apps/frontend/src/hooks/useStickToBottomScroll.ts`（当前，约 L18–L49）

```typescript
// 导出接口：贴底滚动 Hook 的可选配置项（新增 idleFlushKey 非流式贴底通道）
export interface UseStickToBottomScrollOptions {
	// 是否处于流式输出模式：影响恢复/解除策略与 wheel/pointer 是否打断跟底
	isStreaming: boolean;
	// 内容版本戳：变化时在跟底开启下将视口滚到物理底部
	contentRevision: unknown;
	// 切换会话/路由/文档时传入：变化后恢复跟底并清空内部 scrollTop 观测
	resetKey?: string | number | boolean | null;
	// 距底 ≤ 该像素视为底部带（默认 48）
	resumeWithinBottomPx?: number;
	// 非流式下距底 ≥ 该像素视为已离开底部（默认 120）
	releaseBeyondBottomPx?: number;
	// 流式时滚轮向上是否解除跟底，默认 true
	interruptOnWheelUpWhileStreaming?: boolean;
	// 流式时指针按下是否解除跟底，默认 true
	interruptOnPointerDownWhileStreaming?: boolean;
	// 非流式就绪贴底：undefined 不启用；null/空串清记忆；非空串且变化时恢复跟底并一帧内多次 flush
	idleFlushKey?: string | null;
}
```

**变更摘要**：接口尾部新增 `idleFlushKey?: string | null`，为非流式场景（历史加载完成、切换会话）提供贴底通道；`resetKey` 等字段在首版即存在，此处仅做完整契约归档。

---

### 4.2 `userPinnedAwayRef` 新增（用户主动打断记忆）

**对比范围**：ref 声明块 + `flushScrollToBottom` + `enableStickToBottom` + `disableStickToBottom`（同一组相关符号）。

**改动前** · `apps/frontend/src/hooks/useStickToBottomScroll.ts`（commit `2818e130`，约 L90–L128）

```typescript
// 视口 DOM ref，挂到 Radix ScrollArea Viewport
const viewportRef = useRef<HTMLDivElement>(null);
// 是否自动贴底的内部标记，默认开启
const stickToBottomRef = useRef(true);
// 临时抑制 onScroll 因程序写 scrollTop 触发的跟底判定
const suppressStickFromViewportScrollRef = useRef(false);
// 上一次 viewport.scrollTop，用于判断用户上滑/下滚方向
const lastViewportScrollTopRef = useRef<number | null>(null);
// idleFlushKey 已贴底记忆，避免同一 key 重复 flush
const idleFlushAppliedKeyRef = useRef<string | null>(null);

// resetKey 变化时恢复跟底并清空 scrollTop 观测（旧版无 userPinnedAwayRef）
useEffect(() => {
	// resetKey 为 undefined/null 时跳过
	if (resetKey === undefined || resetKey === null) return;
	// 空串也跳过
	if (typeof resetKey === 'string' && resetKey === '') return;
	// 恢复自动贴底
	stickToBottomRef.current = true;
	// 清空 scrollTop 观测，避免沿用上一容器状态
	lastViewportScrollTopRef.current = null;
}, [resetKey]);

// 单次滚到物理底部（旧版无 force 参数、无 userPinnedAwayRef 判定）
const flushScrollToBottom = useCallback(() => {
	// 取视口 DOM
	const vp = viewportRef.current;
	// 视口不存在则跳过
	if (!vp) return;
	// 直接将 scrollTop 设为 scrollHeight，贴到物理底部
	vp.scrollTop = vp.scrollHeight;
}, []);

// 恢复自动贴底（旧版不清 userPinnedAwayRef，因为该 ref 不存在）
const enableStickToBottom = useCallback(() => {
	// 置跟底标记为 true
	stickToBottomRef.current = true;
}, []);

// 取消自动贴底（旧版不置 userPinnedAwayRef）
const disableStickToBottom = useCallback(() => {
	// 置跟底标记为 false
	stickToBottomRef.current = false;
}, []);
```

**改动后** · `apps/frontend/src/hooks/useStickToBottomScroll.ts`（当前，约 L90–L137）

```typescript
// 视口 DOM ref，挂到 Radix ScrollArea Viewport
const viewportRef = useRef<HTMLDivElement>(null);
// 是否自动贴底的内部标记，默认开启
const stickToBottomRef = useRef(true);
// 用户主动打断记忆：流式中上滑/滚轮打断后置位，idleFlush/布局变化不再自动拉回底部
const userPinnedAwayRef = useRef(false);
// 临时抑制 onScroll 因程序写 scrollTop 触发的跟底判定
const suppressStickFromViewportScrollRef = useRef(false);
// 上一次 viewport.scrollTop，用于判断用户上滑/下滚方向
const lastViewportScrollTopRef = useRef<number | null>(null);
// idleFlushKey 已贴底记忆，避免同一 key 重复 flush
const idleFlushAppliedKeyRef = useRef<string | null>(null);
// 流式 contentRevision 高频变化时合并为每帧最多一次贴底
const streamFlushRafRef = useRef(0);

// resetKey 变化时恢复跟底、清 userPinnedAwayRef 与 scrollTop 观测
useEffect(() => {
	// resetKey 为 undefined/null 时跳过
	if (resetKey === undefined || resetKey === null) return;
	// 空串也跳过
	if (typeof resetKey === 'string' && resetKey === '') return;
	// 恢复自动贴底
	stickToBottomRef.current = true;
	// 清除用户主动打断记忆，新会话默认跟底
	userPinnedAwayRef.current = false;
	// 清空 scrollTop 观测，避免沿用上一容器状态
	lastViewportScrollTopRef.current = null;
}, [resetKey]);

// 卸载时取消未完成的流式 rAF，防止卸载后写 scrollTop
useEffect(() => {
	// 返回 cleanup 函数，组件卸载时执行
	return () => {
		// 若有挂起的 rAF id
		if (streamFlushRafRef.current) {
			// 取消该帧回调
			cancelAnimationFrame(streamFlushRafRef.current);
			// 置零避免重复取消
			streamFlushRafRef.current = 0;
		}
	};
}, []);

// 单次滚到物理底部；默认尊重 userPinnedAwayRef，force 时绕过
const flushScrollToBottom = useCallback((options?: { force?: boolean }) => {
	// 取视口 DOM
	const vp = viewportRef.current;
	// 视口不存在则跳过
	if (!vp) return;
	// 非强制且用户已主动离开或跟底已关时跳过
	if (
		!options?.force &&
		(userPinnedAwayRef.current || !stickToBottomRef.current)
	) {
		return;
	}
	// 直接将 scrollTop 设为 scrollHeight，贴到物理底部
	vp.scrollTop = vp.scrollHeight;
}, []);

// 恢复自动贴底，同时清用户打断记忆
const enableStickToBottom = useCallback(() => {
	// 置跟底标记为 true
	stickToBottomRef.current = true;
	// 清除用户主动打断记忆
	userPinnedAwayRef.current = false;
}, []);

// 取消自动贴底，同时置用户打断记忆
const disableStickToBottom = useCallback(() => {
	// 置跟底标记为 false
	stickToBottomRef.current = false;
	// 置用户主动打断记忆，阻止后续自动拉回
	userPinnedAwayRef.current = true;
}, []);
```

**变更摘要**：新增 `userPinnedAwayRef`（用户主动打断记忆）与 `streamFlushRafRef`（帧合并）；`flushScrollToBottom` 增 `force` 参数绕过打断记忆；`enable/disable` 同步维护该 ref；`resetKey` effect 增清 `userPinnedAwayRef`；新增卸载 cleanup 取消 rAF。

> 注：`streamFlushRafRef` 声明与卸载 cleanup 属 §4.3/§4.4，此处因与 `userPinnedAwayRef` 同处 ref 声明块一并摘录以保证符号完整。

---

### 4.3 `streamFlushRafRef` 新增（流式高频合并）

**对比范围**：ref 声明块尾部（纯新增单行 ref + 注释）。

**改动前** · `apps/frontend/src/hooks/useStickToBottomScroll.ts`（HEAD `ab5fd673`，约 L94–L96）

```typescript
// 临时抑制 onScroll 因程序写 scrollTop 触发的跟底判定
const suppressStickFromViewportScrollRef = useRef(false);
// 上一次 viewport.scrollTop，用于判断用户上滑/下滚方向
const lastViewportScrollTopRef = useRef<number | null>(null);
// idleFlushKey 已贴底记忆，避免同一 key 重复 flush
const idleFlushAppliedKeyRef = useRef<string | null>(null);
```

**改动后** · `apps/frontend/src/hooks/useStickToBottomScroll.ts`（当前，约 L94–L98）

```typescript
// 临时抑制 onScroll 因程序写 scrollTop 触发的跟底判定
const suppressStickFromViewportScrollRef = useRef(false);
// 上一次 viewport.scrollTop，用于判断用户上滑/下滚方向
const lastViewportScrollTopRef = useRef<number | null>(null);
// idleFlushKey 已贴底记忆，避免同一 key 重复 flush
const idleFlushAppliedKeyRef = useRef<string | null>(null);
// 流式 contentRevision 高频变化时合并为每帧最多一次贴底
const streamFlushRafRef = useRef(0);
```

**变更摘要**：纯新增 `streamFlushRafRef = useRef(0)`，持有流式贴底 rAF id，为 §4.6 帧合并提供去重句柄。

---

### 4.4 卸载时 `cancelAnimationFrame(streamFlushRafRef.current)` 清理（纯新增 useEffect cleanup）

**对比范围**：空依赖 `useEffect`（纯新增，HEAD 无此 effect）。

**改动后** · `apps/frontend/src/hooks/useStickToBottomScroll.ts`（当前，约 L108–L115）

```typescript
// 空依赖 effect：仅在卸载时执行 cleanup
useEffect(() => {
	// 返回 cleanup 函数，组件卸载时执行
	return () => {
		// 若有挂起的流式 rAF id（非 0 表示有挂起帧）
		if (streamFlushRafRef.current) {
			// 取消该帧回调，防止卸载后写 scrollTop 报错
			cancelAnimationFrame(streamFlushRafRef.current);
			// 置零避免重复取消
			streamFlushRafRef.current = 0;
		}
	};
}, []);
```

**变更摘要**：纯新增空依赖 `useEffect`，cleanup 中 `cancelAnimationFrame` 取消挂起的流式贴底帧，防止组件卸载后 rAF 回调仍访问已卸载 DOM。

---

### 4.5 `resetKey` 变化时清空（恢复跟底 + 清 `lastViewportScrollTopRef`）

**对比范围**：`resetKey` 依赖的 `useEffect` 全函数。

**改动前** · `apps/frontend/src/hooks/useStickToBottomScroll.ts`（commit `2818e130`，约 L93–L99）

```typescript
// resetKey 变化时恢复跟底并清空 scrollTop 观测（旧版无 userPinnedAwayRef）
useEffect(() => {
	// resetKey 为 undefined/null 时跳过
	if (resetKey === undefined || resetKey === null) return;
	// 空串也跳过
	if (typeof resetKey === 'string' && resetKey === '') return;
	// 恢复自动贴底
	stickToBottomRef.current = true;
	// 清空 scrollTop 观测，避免沿用上一容器状态
	lastViewportScrollTopRef.current = null;
}, [resetKey]);
```

**改动后** · `apps/frontend/src/hooks/useStickToBottomScroll.ts`（当前，约 L100–L106）

```typescript
// resetKey 变化时恢复跟底、清 userPinnedAwayRef 与 scrollTop 观测
useEffect(() => {
	// resetKey 为 undefined/null 时跳过
	if (resetKey === undefined || resetKey === null) return;
	// 空串也跳过
	if (typeof resetKey === 'string' && resetKey === '') return;
	// 恢复自动贴底
	stickToBottomRef.current = true;
	// 清除用户主动打断记忆，新会话默认跟底
	userPinnedAwayRef.current = false;
	// 清空 scrollTop 观测，避免沿用上一容器状态
	lastViewportScrollTopRef.current = null;
}, [resetKey]);
```

**变更摘要**：在原有「恢复 `stickToBottomRef` + 清 `lastViewportScrollTopRef`」基础上，新增 `userPinnedAwayRef.current = false`，确保切换会话后用户打断记忆不跨会话残留。

---

### 4.6 流式 effect 合并到单帧

**对比范围**：`isStreaming + contentRevision` 驱动的 `useLayoutEffect` 全函数。

**改动前** · `apps/frontend/src/hooks/useStickToBottomScroll.ts`（HEAD `ab5fd673`，约 L213–L224）

```typescript
// 流式贴底 effect：contentRevision 变化时贴底（旧版每次双 rAF，高频卡顿）
useLayoutEffect(() => {
	// 非流式不处理
	if (!isStreaming) return;
	// 跟底已关不处理
	if (!stickToBottomRef.current) return;
	// 立即抑制 onScroll 因程序写 scrollTop 触发的判定
	suppressStickFromViewportScrollRef.current = true;
	// 同步贴底一次（覆盖当前 scrollHeight）
	flushScrollToBottom();
	// 第一帧 rAF：浏览器布局后再贴底一次
	requestAnimationFrame(() => {
		// 仍跟底时再 flush
		if (stickToBottomRef.current) {
			flushScrollToBottom();
		}
		// 第二帧 rAF：解除 suppress
		requestAnimationFrame(() => {
			// 恢复 onScroll 跟底判定
			suppressStickFromViewportScrollRef.current = false;
		});
	});
}, [contentRevision, isStreaming, flushScrollToBottom]);
```

**改动后** · `apps/frontend/src/hooks/useStickToBottomScroll.ts`（当前，约 L224–L243）

```typescript
// 流式贴底 effect：contentRevision 变化时合并到单帧贴底（rAF 去重）
useLayoutEffect(() => {
	// 非流式不处理
	if (!isStreaming) return;
	// 跟底已关不处理
	if (!stickToBottomRef.current) return;
	// 合并同帧多次 revision，避免每 token 双 rAF 贴底抢主线程
	if (streamFlushRafRef.current) return;
	// 申请 rAF，id 存入 ref 供去重与卸载取消
	streamFlushRafRef.current = requestAnimationFrame(() => {
		// 进入回调先清零 id，允许后续 revision 申请新帧
		streamFlushRafRef.current = 0;
		// 跟底已关则跳过本次贴底
		if (!stickToBottomRef.current) return;
		// 立即抑制 onScroll 因程序写 scrollTop 触发的判定
		suppressStickFromViewportScrollRef.current = true;
		// 同步贴底一次（覆盖当前 scrollHeight）
		flushScrollToBottom();
		// 第一帧 rAF：浏览器布局后再贴底一次
		requestAnimationFrame(() => {
			// 仍跟底时再 flush
			if (stickToBottomRef.current) {
				flushScrollToBottom();
			}
			// 第二帧 rAF：解除 suppress
			requestAnimationFrame(() => {
				// 恢复 onScroll 跟底判定
				suppressStickFromViewportScrollRef.current = false;
			});
		});
	});
}, [contentRevision, isStreaming, flushScrollToBottom]);
```

**变更摘要**：将「每次 revision 同步 flush + 双 rAF」改为「`if (streamFlushRafRef.current) return` 去重 + 单 rAF 内执行 flush → 二次 flush → 解除 suppress」；同帧多次 revision 只排一次 rAF，主线程压力从 O(token 数) 降到 O(帧数)。

---

### 4.7 `idleFlushKey` 非流式贴底（纯新增 useEffect，含 `setTimeout(0)` 覆盖 MdPreview/图片晚一拍撑高）

**对比范围**：`idleFlushKeyProp` 驱动的 `useLayoutEffect` 全函数。

**改动前** · `apps/frontend/src/hooks/useStickToBottomScroll.ts`（commit `2818e130`，约 L190–L210）

```typescript
// 非流式贴底 effect：idleFlushKey 变化时补滚（旧版无 force、无 userPinnedAwayRef）
useLayoutEffect(() => {
	// undefined 表示不启用该逻辑
	if (idleFlushKeyProp === undefined) return;
	// null 或空串：清除已贴底记忆，不就绪时不滚
	if (idleFlushKeyProp === null || idleFlushKeyProp === '') {
		// 清记忆
		idleFlushAppliedKeyRef.current = null;
		return;
	}
	// 与上次相同则跳过，避免重复 flush
	if (idleFlushAppliedKeyRef.current === idleFlushKeyProp) return;
	// 记录本次 key
	idleFlushAppliedKeyRef.current = idleFlushKeyProp;
	// 恢复跟底
	stickToBottomRef.current = true;
	// 同步贴底一次
	flushScrollToBottom();
	// 第一帧 rAF 再贴底
	requestAnimationFrame(() => {
		// 再贴底一次
		flushScrollToBottom();
		// 第二帧 rAF 再贴底
		requestAnimationFrame(() => {
			// 再贴底一次
			flushScrollToBottom();
			// setTimeout(0) 兜底：覆盖 MdPreview/图片晚一拍撑高
			window.setTimeout(() => {
				// 最终贴底
				flushScrollToBottom();
			}, 0);
		});
	});
}, [idleFlushKeyProp, flushScrollToBottom]);
```

**改动后** · `apps/frontend/src/hooks/useStickToBottomScroll.ts`（当前，约 L245–L266）

```typescript
// 非流式贴底 effect：idleFlushKey 变化时补滚（新增 userPinnedAwayRef 清除 + force 绕过）
useLayoutEffect(() => {
	// undefined 表示不启用该逻辑
	if (idleFlushKeyProp === undefined) return;
	// null 或空串：清除已贴底记忆，不就绪时不滚
	if (idleFlushKeyProp === null || idleFlushKeyProp === '') {
		// 清记忆
		idleFlushAppliedKeyRef.current = null;
		return;
	}
	// 与上次相同则跳过，避免重复 flush
	if (idleFlushAppliedKeyRef.current === idleFlushKeyProp) return;
	// 记录本次 key
	idleFlushAppliedKeyRef.current = idleFlushKeyProp;
	// 恢复跟底
	stickToBottomRef.current = true;
	// 清除用户主动打断记忆，确保 idle 贴底不被旧记忆阻断
	userPinnedAwayRef.current = false;
	// 同步贴底一次，force 绕过 userPinnedAwayRef 守卫
	flushScrollToBottom({ force: true });
	// 第一帧 rAF 再贴底
	requestAnimationFrame(() => {
		// 再贴底一次，force 绕过守卫
		flushScrollToBottom({ force: true });
		// 第二帧 rAF 再贴底
		requestAnimationFrame(() => {
			// 再贴底一次，force 绕过守卫
			flushScrollToBottom({ force: true });
			// setTimeout(0) 兜底：覆盖 MdPreview/图片晚一拍撑高
			window.setTimeout(() => {
				// 最终贴底，force 绕过守卫
				flushScrollToBottom({ force: true });
			}, 0);
		});
	});
}, [idleFlushKeyProp, flushScrollToBottom]);
```

**变更摘要**：新增 `userPinnedAwayRef.current = false` 清除打断记忆；所有 `flushScrollToBottom()` 改为 `flushScrollToBottom({ force: true })`，确保非流式就绪贴底不被用户打断记忆阻断（切换会话/历史加载完成应强制贴底）。

---

### 4.8 代码块内横滚/点击不打断贴底

**对比范围**：`onWheelCapture` + `onPointerDownCapture` 两个 `useCallback`（同一组视口事件处理符号）。

**改动前** · `apps/frontend/src/hooks/useStickToBottomScroll.ts`（commit `2818e130`，约 L170–L185）

```typescript
// 滚轮捕获处理（旧版：任意向上滚即打断，无代码块特殊处理）
const onWheelCapture = useCallback<WheelEventHandler<HTMLDivElement>>(
	(e) => {
		// 未启用流式上滚打断或非流式时跳过
		if (!interruptOnWheelUpWhileStreaming || !isStreaming) return;
		// 滚轮向上（deltaY 为负）即解除跟底
		if (e.deltaY < 0) {
			// 置跟底标记为 false
			stickToBottomRef.current = false;
		}
	},
	[interruptOnWheelUpWhileStreaming, isStreaming],
);

// 指针按下捕获处理（旧版：任意位置按下即打断，无代码块特殊处理）
const onPointerDownCapture = useCallback<
	PointerEventHandler<HTMLDivElement>
>(() => {
	// 未启用流式指针打断或非流式时跳过
	if (!interruptOnPointerDownWhileStreaming || !isStreaming) return;
	// 任意位置按下即解除跟底
	stickToBottomRef.current = false;
}, [interruptOnPointerDownWhileStreaming, isStreaming]);
```

**改动后** · `apps/frontend/src/hooks/useStickToBottomScroll.ts`（当前，约 L181–L222）

```typescript
// 滚轮捕获处理（新版：代码块内横滚或向上滚才打断；向下滚交 onScroll 触底恢复）
const onWheelCapture = useCallback<WheelEventHandler<HTMLDivElement>>(
	(e) => {
		// 非流式时跳过，不干预非流式滚动
		if (!isStreaming) return;
		// 取事件目标元素
		const target = e.target;
		// 命中代码块或流式代码围栏时走特殊分支
		if (
			target instanceof Element &&
			target.closest('.chat-md-code-block, [data-streaming-code-fence]')
		) {
			// 取水平滚动绝对值
			const absX = Math.abs(e.deltaX);
			// 取垂直滚动绝对值
			const absY = Math.abs(e.deltaY);
			// 代码块内横滚或向上滚：打断贴底；向下滚交给 onScroll 在触底时恢复
			if (absX > absY || e.deltaY < 0) {
				// 置跟底标记为 false
				stickToBottomRef.current = false;
				// 置用户主动打断记忆
				userPinnedAwayRef.current = true;
			}
			// 代码块内事件处理结束
			return;
		}
		// 非代码块：未启用流式上滚打断时跳过
		if (!interruptOnWheelUpWhileStreaming) return;
		// 滚轮向上（deltaY 为负）即解除跟底
		if (e.deltaY < 0) {
			// 置跟底标记为 false
			stickToBottomRef.current = false;
			// 置用户主动打断记忆
			userPinnedAwayRef.current = true;
		}
	},
	[interruptOnWheelUpWhileStreaming, isStreaming],
);

// 指针按下捕获处理（新版：代码块内点击/拖横滚条不打断）
const onPointerDownCapture = useCallback<PointerEventHandler<HTMLDivElement>>(
	(e) => {
		// 未启用流式指针打断或非流式时跳过
		if (!interruptOnPointerDownWhileStreaming || !isStreaming) return;
		// 取事件目标元素
		const target = e.target;
		// 代码块内点击/拖 pre 横滚条：不解除贴底，便于横滚后仍可通过滚到底恢复跟滚
		if (
			target instanceof Element &&
			target.closest('.chat-md-code-block, [data-streaming-code-fence]')
		) {
			// 代码块内直接返回，不打断贴底
			return;
		}
		// 非代码块区域按下：解除跟底
		stickToBottomRef.current = false;
		// 置用户主动打断记忆
		userPinnedAwayRef.current = true;
	},
	[interruptOnPointerDownWhileStreaming, isStreaming],
);
```

**变更摘要**：`onWheelCapture` 在进入函数顶部先判 `isStreaming`（不再与 `interruptOnWheelUpWhileStreaming` 短路），命中 `.chat-md-code-block, [data-streaming-code-fence]` 时仅横滚（`absX > absY`）或向上滚（`deltaY < 0`）才打断并置 `userPinnedAwayRef`，向下滚交 `onScroll` 触底恢复；`onPointerDownCapture` 命中同选择器直接 `return` 不打断。两处打断分支均新增 `userPinnedAwayRef.current = true`。

## 5. 兼容性与影响

- **API 兼容**：`flushScrollToBottom` 签名从 `() => void` 改为 `(options?: { force?: boolean }) => void`，新增可选参数向后兼容；`UseStickToBottomScrollResult.flushScrollToBottom` 类型同步更新。
- **行为兼容**：`idleFlushKey` 默认 `undefined` 不启用，不影响未传该参数的调用方。
- **性能影响**：流式 effect 从每 token 双 rAF 降为每帧最多一次 rAF，知识库预览 + 助手同开时滚动卡顿显著缓解。
- **回归风险**：
  - 代码块内向下滚不再打断贴底，需验证「代码块内向下滚到底后能否恢复跟滚」（由 `onScroll` 的 `distanceFromBottom <= 8` 分支覆盖）。
  - `streamFlushRafRef` 去重依赖「回调内先清零」，需确认 rAF 回调不会被 `cancelAnimationFrame` 后仍执行（已通过卸载 cleanup 置零保障）。
  - `userPinnedAwayRef` 跨流式/非流式切换的清除路径：`resetKey`、`enableStickToBottom`、`idleFlushKey`、`onScroll` 底部带下滚均已覆盖。

## 6. 相关源码路径

| 说明 | 路径 |
| ---- | ---- |
| 流式贴底滚动 Hook 实现 | `apps/frontend/src/hooks/useStickToBottomScroll.ts` |
| 同域既有专题：流式代码块滚动 | `docs/chat/流式代码块滚动.md` |
| 同域既有专题：助手流式结束贴底 | `docs/knowledge/助手流式结束滚动定位.md` |
| 同域既有专题：知识库预览滚动卡顿 | `docs/knowledge/知识预览滚动卡顿.md` |

---

（若与仓库最新源码不一致，以源码为准）
