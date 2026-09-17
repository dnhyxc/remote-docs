# EPUB 听当前：播放自动跟随与回位 FAB

## 延伸阅读

- [EPUB 听书：跨章 trim 后 FAB CFI 重挂载](EPUB听书跟随CFI重挂载.md) — 连续滚动远章 trim 后「回到播放位置」修复（display + 句 Range 重建）
- [EPUB 听书：划选暂停自动跟随](EPUB听书选择暂停跟随.md) — 划选正文与手动滚动共用 `pauseListenAutoFollow`
- [EPUB 听读 — 句间云端 TTS 预取](EPUB听书云端预取影响.md) — 句间预取；[首包出声后再预取](EPUB听书启动后预取.md) — 错开首包 HTTP
- [EPUB 听当前：滚动容器浮层与跨段句间清除](EPUB听书宿主覆盖层.md) — 播放背景绘制与句间清除
- [EPUB 边听边读开发者手册](developer/EPUB听书开发.md) — 听当前 + 听书完整实现（§5.3 自动跟随、§8.7 scroll guard）
- [EPUB 边听边读「听书」](EPUB章节听书.md) — 顶栏听书、播放条与听书视口跟随（共用本 FAB）
- [EPUB「听当前」逐句播放背景](EPUB听书句背景.md) — plain 偏移与 TTS 数据流
- [EPUB 连续滚动章节衔接](EPUB阅读器设置滚动.md) — `.epub-container` 滚动模式

## 1. 背景与目标

**用户视角**：**听当前** 播放较长选区时，希望 **当前句自动滚入视口**；若用户 **手动滚动或滚轮** 阅读其它段落，应 **停止自动跟随**，避免与用户意图对抗；需要时可 **一键回到正在播放的句子并恢复跟随**。

**目标**：

1. Session 内默认 `autoFollow: true`，换句时 `scrollEpubRangeIntoView`。
2. 监听 epub 滚动容器、iframe 文档、`wheel`：**用户滚动意图** 时将 `autoFollow` 置 `false`。
3. **程序触发的滚动**（自动滚入视口）不计为用户打断（`programmaticScroll` 计数）。
4. 阅读区右下角 **FAB**：仅在「播放中且 autoFollow 关闭」时显示，点击 `resumeEpubListenAutoFollow`。

## 2. 改动范围

| 路径 | 说明 |
| ---- | ---- |
| `apps/frontend/src/views/ebook/utils/epubListenSegmentOverlay.ts` | `autoFollow`、`attachListenScrollGuard`、`subscribeEpubListenAutoFollow`、`resumeEpubListenAutoFollow` |
| `apps/frontend/src/views/ebook/components/EpubListenFollowFab.tsx` | **新增** FAB 组件 |
| `apps/frontend/src/views/ebook/read.tsx` | 阅读 host `relative` + 挂载 FAB |
| `apps/frontend/src/i18n/locales/zh-CN.ts`、`en-US.ts` | `ebook.read.listen.followResume*` 文案 |

## 3. 实现思路

1. **状态广播**：模块内 `Set` 订阅者；`emitAutoFollowState` 推送 `{ active, autoFollow }`。
2. **Scroll guard**：`beginEpubListenOverlaySession` 注册；`clearEpubListenSegmentOverlay` 卸载。
3. **恢复跟随**：`resumeEpubListenAutoFollow` 设 `autoFollow=true`，再滚到 `session.plainStart/End` 并重绘。
4. **FAB**：`subscribeEpubListenAutoFollow` → `visible = active && !autoFollow`；点击调用 `resumeEpubListenAutoFollow`。
5. **布局**：阅读列容器加 `relative`，FAB `absolute bottom-4 right-4 z-20`。

## 4. 关键代码对比与注释

### 4.1 `EpubListenFollowFab`（`apps/frontend/src/views/ebook/components/EpubListenFollowFab.tsx`）

**对比范围**：完整组件（**纯新增**，无改动前）。

**改动后** · 当前，约 L1–L35

```typescript
// 定位图标（Lucide LocateFixed）
import { LocateFixed } from 'lucide-react';
// React 副作用与本地 visible 状态
import { useEffect, useState } from 'react';
// 界面语言与 t() 翻译
import { useI18n } from '@/hooks';
// 恢复自动跟随与订阅播放 session 状态
import {
	resumeEpubListenAutoFollow,
	subscribeEpubListenAutoFollow,
} from '../utils/epubListenSegmentOverlay';

/** 听当前：用户手动滚动后，右下角恢复「播放内容自动滚入视口」 */
export function EpubListenFollowFab() {
	// 取当前 locale 的 t 函数
	const { t } = useI18n();
	// FAB 是否显示：播放中且 autoFollow 为 false
	const [visible, setVisible] = useState(false);

	// 订阅 overlay 模块的 active/autoFollow 变化
	useEffect(
		() =>
			subscribeEpubListenAutoFollow(({ active, autoFollow }) => {
				// 仅在朗读 session 活跃且用户已打断自动跟随时显示
				setVisible(active && !autoFollow);
			}),
		[],
	);

	// 不可见时不占 DOM
	if (!visible) return null;

	// 右下角圆形按钮
	return (
		<button
			type="button"
			className="absolute bottom-4 right-4 z-20 flex h-9 w-9 cursor-pointer items-center justify-center rounded-full border border-theme/5 bg-theme/5 text-textcolor/70 shadow-sm backdrop-blur-[2px] hover:bg-theme/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-theme/40"
			aria-label={t('ebook.read.listen.followResumeAria')}
			title={t('ebook.read.listen.followResume')}
			onClick={() => resumeEpubListenAutoFollow()}
		>
			<LocateFixed className="h-4 w-4" aria-hidden />
		</button>
	);
}
```

### 4.2 `attachListenScrollGuard`（`apps/frontend/src/views/ebook/utils/epubListenSegmentOverlay.ts`）

**对比范围**：完整函数（**纯新增**）。

**改动后** · 当前，约 L115–L151

```typescript
// 注册用户滚动/wheel 监听，打断 autoFollow；返回卸载函数
function attachListenScrollGuard(rend: Rendition): () => void {
	// 收集各 target 的 removeEventListener 回调
	const cleanups: (() => void)[] = [];

	// 用户产生滚动意图时的 handler
	const onUserScrollIntent = () => {
		// 程序触发的 scrollIntoView 滚动期间忽略
		if (programmaticScroll > 0) return;
		// 将 session.autoFollow 置 false 并通知 FAB
		pauseListenAutoFollow();
	};

	// 给 scroll 目标绑定 passive scroll 监听
	const bindScrollTarget = (target: EventTarget | null | undefined) => {
		// 目标不存在则跳过
		if (!target) return;
		// passive 滚动监听
		target.addEventListener('scroll', onUserScrollIntent, { passive: true });
		// 记录卸载函数
		cleanups.push(() =>
			target.removeEventListener('scroll', onUserScrollIntent),
		);
	};

	// epub 连续滚动主容器
	const container = getEpubScrollContainer(rend);
	// 绑定容器 scroll
	if (container) {
		bindScrollTarget(container);
		// 滚轮同样视为用户打断
		container.addEventListener('wheel', onUserScrollIntent, { passive: true });
		cleanups.push(() =>
			container.removeEventListener('wheel', onUserScrollIntent),
		);
	}

	// 每个 iframe content 的 scrollingElement
	const bindContents = (contents: EpubContents) => {
		const doc = contents.document;
		bindScrollTarget(doc.scrollingElement ?? doc.documentElement);
	};

	// 新章节 iframe 注入时自动绑定
	rend.hooks.content.register(bindContents);
	// 已存在的 contents 立即绑定
	for (const item of getContents(rend)) bindContents(item);

	// 返回 teardown：移除全部 listener
	return () => {
		for (const fn of cleanups) fn();
	};
}
```

### 4.3 `resumeEpubListenAutoFollow`（`apps/frontend/src/views/ebook/utils/epubListenSegmentOverlay.ts`）

**对比范围**：完整导出函数（**纯新增**）。

**改动后** · 当前，约 L548–L574

```typescript
/** 恢复播放内容自动滚入视口，并立即滚到当前句 */
export function resumeEpubListenAutoFollow(): void {
	// 无 session 则无操作
	if (!session) return;
	// 重新开启换句自动 scrollIntoView
	session.autoFollow = true;
	// 通知 FAB 隐藏
	emitAutoFollowState();

	// 读取当前句 plain 偏移
	const { plainStart, plainEnd } = session;
	// 尚未绘制过有效句界则无法定位
	if (plainStart < 0 || plainEnd <= plainStart) return;

	// 解析选区 outer Range
	const outer = resolveSessionOuter(session);
	if (!outer) return;
	// plain → compact 映射
	const map = buildPlainCompactMap(outer, session.plain);
	if (!map) return;
	// 当前句 DOM Range
	const range = plainSliceToRange(map, plainStart, plainEnd);
	if (!range) return;

	// 捕获 rend/cfi/epoch 供异步闭包校验
	const { rend, cfi, epoch } = session;
	// 程序滚动计数 + 滚入视口 + 重绘
	void withProgrammaticScroll(async () => {
		await scrollEpubRangeIntoView(rend, range, cfi);
		if (!session || session.epoch !== epoch) return;
		if (session.plainStart !== plainStart || session.plainEnd !== plainEnd)
			return;
		paintPlainSpan(plainStart, plainEnd);
	});
}
```

### 4.4 `read.tsx` 挂载 FAB（摘录）

**对比范围**：阅读 host 容器 class 与 FAB 挂载（改动前无 FAB）。

**改动前** · 基线，约 L2141–L2170

```typescript
						<div
							className="flex h-full min-h-0 flex-1 flex-col"
							onContextMenu={onHostContextMenu}
							onPointerDown={() => {
								if (epubSettingsOpen) closeEpubSettings();
							}}
						>
							<EpubPane
								// ... EpubPane props（未改动）
							/>
						</div>
```

**改动后** · 当前，约 L2141–L2173

```typescript
						<div
							className="relative flex h-full min-h-0 flex-1 flex-col"
							onContextMenu={onHostContextMenu}
							onPointerDown={() => {
								if (epubSettingsOpen) closeEpubSettings();
							}}
						>
							<EpubPane
								// ... EpubPane props（未改动）
							/>
							<EpubListenFollowFab />
						</div>
```

**变更摘要**：host 加 **`relative`** 供 FAB 绝对定位；**`EpubListenFollowFab`** 与 `EpubPane` 并列。

## 5. 兼容性与影响

- **分页模式**：若用户通过键盘翻页而非 scroll/wheel，当前 **不** 自动打断 autoFollow（可作后续增强）。
- **与 MK 问书 / 想法侧栏**：FAB 仅在阅读列右下角，不挡侧栏操作。
- **回归建议**：听长选区自动滚句；手动滚轮后 FAB 出现；点 FAB 回位并恢复跟随；停止播放 FAB 消失。

## 6. 相关源码路径

| 说明 | 路径 |
| ---- | ---- |
| FAB 组件 | `apps/frontend/src/views/ebook/components/EpubListenFollowFab.tsx` |
| 跟随状态与 guard | `apps/frontend/src/views/ebook/utils/epubListenSegmentOverlay.ts` |
| 阅读页挂载 | `apps/frontend/src/views/ebook/read.tsx` |

---

（若与仓库最新源码不一致，以源码为准）
