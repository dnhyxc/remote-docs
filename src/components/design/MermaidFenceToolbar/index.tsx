/**
 * Mermaid 围栏顶栏：在 ScrollArea viewport 内 `sticky` 吸顶；粘顶后与代码块浮动工具条视觉对齐。
 * 设计背景、哨兵 + IntersectionObserver 约定及与 Portal 方案对比见仓库根目录文档：
 * `docs/mermaid-fence-toolbar-sticky.md`
 */

import {
	createMarkdownCodeFenceInfo,
	downloadMarkdownCodeFenceWith,
	MERMAID_MARKDOWN_SVG_SELECTOR,
} from '@dnhyxc-ai/markdown-kit';
import { Button } from '@ui/index';
import { CheckCircle, Code2, Copy, Download, Eye } from 'lucide-react';
import {
	type MouseEvent as ReactMouseEvent,
	type ReactNode,
	useCallback,
	useEffect,
	useLayoutEffect,
	useRef,
	useState,
} from 'react';
import { cn } from '@/lib/utils';
import { ChatI18nT } from '@/types/chat';
import { downloadBlob } from '@/utils';
import { copyToClipboard } from '@/utils/clipboard';
import {
	downloadMermaidPreviewSvg,
	mermaidSvgToPreviewDataUrl,
} from '@/utils/mermaidImagePreview';

const COPY_FEEDBACK_MS = 1600;

/** 吸顶后与 ChatCodeFloatingToolbar（`ChatCodeToolBar/index.tsx`）工具条视觉一致 */
const MERMAID_TOOLBAR_PINNED_CHROME =
	'rounded-md bg-theme-background/50 shadow-[0_4px_10px_-4px_color-mix(in_oklch,var(--theme-background)_40%,black)] backdrop-blur-[2px]';

/** 未吸顶时与历史实现一致（仅圆角与背景，无阴影/毛玻璃/额外内边距） */
const MERMAID_TOOLBAR_RESTING_CHROME = 'rounded-t-md bg-theme-background/50';

export type MermaidFenceToolbarProps = {
	/** 用于 Observer 在 block 切换时重建 */
	blockId: string;
	children: ReactNode;
};

/**
 * 通过哨兵节点判断是否已 sticky 粘顶，仅在粘顶时切换为与代码块浮动工具条一致的样式。
 */
export function MermaidFenceToolbar({
	blockId,
	children,
}: MermaidFenceToolbarProps) {
	const sentinelRef = useRef<HTMLDivElement>(null);
	const [isPinned, setIsPinned] = useState(false);

	useLayoutEffect(() => {
		const sentinel = sentinelRef.current;
		if (!sentinel) return;
		// 与 ChatBotView 消息列表一致：滚动容器为 Radix ScrollArea 的 Viewport
		const root = sentinel.closest<HTMLElement>(
			'[data-slot="scroll-area-viewport"]',
		);
		const io = new IntersectionObserver(
			([e]) => {
				// 哨兵先于 sticky 条离开 root 可见区 → 条已贴在滚动区域顶边
				setIsPinned(!e.isIntersecting);
			},
			// root 为 null 时按规范等价于视口，非 ScrollArea 场景下粘顶判定可能略偏差
			{ root, rootMargin: '0px', threshold: 0 },
		);
		io.observe(sentinel);
		return () => io.disconnect();
	}, [blockId]);

	return (
		<>
			<div
				ref={sentinelRef}
				className="h-px w-full shrink-0 pointer-events-none"
				aria-hidden
			/>
			<div
				className={cn(
					'px-px sticky top-0 z-10 flex h-8.5 select-none items-center justify-between gap-2',
					isPinned
						? MERMAID_TOOLBAR_PINNED_CHROME
						: MERMAID_TOOLBAR_RESTING_CHROME,
				)}
			>
				{children}
			</div>
		</>
	);
}

/**
 * 与 `StreamingMarkdownBody` / Monaco 预览共用：顶栏内维护图/代码切换、复制、预览、下载逻辑；
 * 宿主通过 `children(mode)` 渲染工具条下方的代码块或 `MermaidFenceIsland`。
 */
export type MermaidFenceToolbarActionsProps = {
	blockId: string;
	/** 围栏内 DSL，复制时包装为 ```mermaid 代码块 */
	mermaidCode: string;
	openMermaidPreview: (url: string) => void;
	/** 初始模式；`resetKey` 变化时也会重置为该值 */
	defaultViewMode?: 'diagram' | 'code';
	/** 变化时重置模式与复制反馈（如 Monaco `documentIdentity`） */
	resetKey?: string | number;
	children: (mode: 'diagram' | 'code') => ReactNode;
	/** i18n 翻译函数（可选）；不传则沿用组件内默认中文文案 */
	t?: ChatI18nT;
};

/**
 * sticky 吸顶条 + 按钮逻辑 + `data-mermaid-preview-scope` 包裹层（预览 / 下载图表时 `closest` 依赖）。
 */
export function MermaidFenceToolbarActions({
	blockId,
	mermaidCode,
	openMermaidPreview,
	defaultViewMode = 'diagram',
	resetKey,
	children,
	t,
}: MermaidFenceToolbarActionsProps) {
	const [mode, setMode] = useState<'diagram' | 'code'>(defaultViewMode);
	const [copied, setCopied] = useState(false);
	const copyTimerRef = useRef(0);

	useEffect(() => {
		setMode(defaultViewMode);
		setCopied(false);
		if (copyTimerRef.current) {
			window.clearTimeout(copyTimerRef.current);
			copyTimerRef.current = 0;
		}
	}, [resetKey, defaultViewMode]);

	const toggle = useCallback(() => {
		setMode((m) => (m === 'diagram' ? 'code' : 'diagram'));
	}, []);

	const onCopy = useCallback(() => {
		void (async () => {
			await copyToClipboard(`\`\`\`mermaid\n${mermaidCode}\n\`\`\``);
			if (copyTimerRef.current) window.clearTimeout(copyTimerRef.current);
			setCopied(true);
			copyTimerRef.current = window.setTimeout(() => {
				setCopied(false);
				copyTimerRef.current = 0;
			}, COPY_FEEDBACK_MS);
		})();
	}, [mermaidCode]);

	const onPreview = useCallback(
		(e: ReactMouseEvent<HTMLButtonElement>) => {
			const btn = e.currentTarget;
			const scope = btn.closest<HTMLElement>(
				`[data-mermaid-preview-scope="${blockId}"]`,
			);
			if (!scope) return;
			const svg = scope.querySelector(MERMAID_MARKDOWN_SVG_SELECTOR);
			if (!(svg instanceof SVGElement)) return;
			const url = mermaidSvgToPreviewDataUrl(svg);
			if (url) openMermaidPreview(url);
		},
		[blockId, openMermaidPreview],
	);

	/**
	 * 下载：与当前 `mode` 一致。
	 * - diagram：与 `onPreview` 相同路径取 SVG → `mermaidSvgToPreviewDataUrl` → `downloadMermaidPreviewSvg`（Web/Tauri 统一 `downloadBlob`）。
	 * - code：仅 DSL 文本，扩展名 `.mmd` 表示单文件 Mermaid 源码（见 `docs/mermaid-fence-toolbar-sticky.md` §13.2）。
	 */
	const onDownload = useCallback(
		async (e: ReactMouseEvent<HTMLButtonElement>) => {
			const stamp = Date.now();
			if (mode === 'diagram') {
				const btn = e.currentTarget;
				const scope = btn.closest<HTMLElement>(
					`[data-mermaid-preview-scope="${blockId}"]`,
				);
				if (!scope) return;
				const svg = scope.querySelector(MERMAID_MARKDOWN_SVG_SELECTOR);
				if (!(svg instanceof SVGElement)) return;
				const url = mermaidSvgToPreviewDataUrl(svg);
				if (!url) return;
				await downloadMermaidPreviewSvg(url, `mermaid-${stamp}.svg`);
				return;
			}
			// 代码模式：与「复制」不同，此处只存围栏内正文，便于直接粘贴进 Mermaid Live / 编辑器
			const info = createMarkdownCodeFenceInfo({
				code: mermaidCode,
				lang: 'mermaid',
				filename: `mermaid-${stamp}.mmd`,
			});
			await downloadMarkdownCodeFenceWith(info, async (task) => {
				await downloadBlob(
					{
						file_name: task.filename,
						id: `mermaid-md-${stamp}`,
						overwrite: true,
					},
					task.blob,
				);
			});
		},
		[blockId, mode, mermaidCode],
	);

	return (
		<div data-mermaid-preview-scope={blockId} className="mt-4.5">
			<MermaidFenceToolbar blockId={blockId}>
				<Button
					variant="link"
					size="sm"
					className="h-8 px-2 text-textcolor/80"
					onClick={toggle}
				>
					<Code2 size={16} />
					<span>
						{mode === 'diagram'
							? (t?.('mermaid.toolbar.code') ?? '代码')
							: (t?.('mermaid.toolbar.diagram') ?? '图表')}
					</span>
				</Button>
				<div className="flex items-center justify-end">
					<Button
						variant="link"
						className="text-textcolor/80"
						size="sm"
						onClick={onCopy}
					>
						{copied ? <CheckCircle className="text-teal-500" /> : <Copy />}
						<span className={cn(copied ? 'text-teal-500' : '', 'text-sm')}>
							{copied
								? (t?.('mermaid.toolbar.copied') ?? '已复制')
								: (t?.('mermaid.toolbar.copy') ?? '复制')}
						</span>
					</Button>
					<Button
						variant="link"
						size="sm"
						className="text-textcolor/80"
						onClick={onPreview}
						disabled={mode !== 'diagram'}
					>
						<Eye size={16} />
						<span className="text-sm">
							{t?.('mermaid.toolbar.preview') ?? '预览'}
						</span>
					</Button>
					{/* void：忽略 async onDownload 返回的 Promise */}
					<Button
						variant="link"
						size="sm"
						className="text-textcolor/80"
						type="button"
						onClick={(e) => void onDownload(e)}
					>
						<Download size={16} />
						<span className="text-sm">
							{t?.('mermaid.toolbar.download') ?? '下载'}
						</span>
					</Button>
				</div>
			</MermaidFenceToolbar>
			{children(mode)}
		</div>
	);
}
