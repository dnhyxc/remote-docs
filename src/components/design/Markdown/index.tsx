import {
	bindMarkdownCodeFenceActions,
	MARKDOWN_MERMAID_TAILWIND_CURSOR_ZOOM_IN_CLASS,
	MarkdownParser,
} from '@dnhyxc-ai/markdown-kit';
import { useMermaidInMarkdownRoot } from '@dnhyxc-ai/markdown-kit/react';
// 用 markdown-base（无内嵌 github-dark）；高亮主题由 applyScopedHighlightTheme 注入
import '@dnhyxc-ai/markdown-kit/markdown-base.css';
import { Component } from 'lucide-react';
import {
	memo,
	type RefObject,
	type UIEvent,
	useCallback,
	useEffect,
	useLayoutEffect,
	useMemo,
	useRef,
} from 'react';
import { ScrollArea, Spinner } from '@/components/ui';
import { useHighlightTheme, usePreferDark, applyScopedHighlightTheme } from '@/hooks/useHighlightTheme';
import { useI18n } from '@/i18n';
import { cn } from '@/lib/utils';
import { attachExternalLinkClickInterceptor } from '@/utils/open-external';

type MarkdownPreviewT = (
	key: string,
	params?: Record<string, unknown>,
) => string;

export interface MarkdownProps {
	markdown: string;
	/** i18n；不传则用本地 `useI18n` / 中文默认文案 */
	t?: MarkdownPreviewT;
	viewportRef?: RefObject<HTMLDivElement | null>;
	/** 换篇时重置滚动 */
	documentIdentity?: string;
	onViewportScrollFollow?: () => void;
	enableMermaid?: boolean;
	withScrollArea?: boolean;
	/** 源正文已有内容但 markdown 尚未就绪时展示加载态 */
	pendingSourceMarkdown?: string;
}

function downloadCodeFence(payload: { code: string; filename: string }) {
	const url = URL.createObjectURL(
		new Blob([payload.code], { type: 'text/plain;charset=utf-8' }),
	);
	const a = document.createElement('a');
	a.href = url;
	a.download = payload.filename;
	a.click();
	URL.revokeObjectURL(url);
}

/**
 * 精简对齐 Host `@design/Markdown`（ParserMarkdownPreviewPane）：
 * MarkdownParser + 围栏工具栏 + 可选 Mermaid / ScrollArea。
 * 未移植：聊天吸顶条、Mermaid 岛分栏、选区右键、预览角标 FAB。
 */
const Markdown = memo(function Markdown({
	markdown,
	t: tProp,
	viewportRef,
	documentIdentity,
	onViewportScrollFollow,
	enableMermaid = true,
	withScrollArea = true,
	pendingSourceMarkdown,
}: MarkdownProps) {
	const { t: i18nT } = useI18n();
	const t = tProp;
	const label = useCallback(
		(key: string, fallback: string) => {
			if (t) return t(key) || fallback;
			if (key === 'common.copy') return i18nT('code.copy');
			if (key === 'common.download') return i18nT('code.download');
			if (key === 'markdown.preview.loading') return i18nT('markdown.preview.loading');
			if (key === 'markdown.preview.empty') return i18nT('markdown.preview.empty');
			return fallback;
		},
		[t, i18nT],
	);

	const markdownRef = useRef<HTMLDivElement>(null);
	const previewHtmlRootRef = useRef<HTMLDivElement>(null);
	const localViewportRef = useRef<HTMLDivElement | null>(null);
	const highlightTheme = useHighlightTheme();
	const preferDark = usePreferDark();

	useLayoutEffect(() => {
		const vp = withScrollArea
			? localViewportRef.current
			: (viewportRef?.current ?? null);
		if (vp) {
			vp.scrollTop = 0;
			vp.scrollLeft = 0;
		}
	}, [documentIdentity, withScrollArea, viewportRef]);

	useEffect(() => {
		const el = markdownRef.current;
		if (!el) return;
		const detachCodeFence = bindMarkdownCodeFenceActions(el, {
			onDownload(payload) {
				downloadCodeFence(payload);
			},
		});
		// 外链：与 kit target=_blank 互补；嵌桌面须拦（见 docs/app/外链系统浏览器打开.md）
		const detachExternalLinks = attachExternalLinkClickInterceptor(el);
		return () => {
			detachCodeFence();
			detachExternalLinks();
		};
	}, []);

	const assignViewportRef = useCallback(
		(node: HTMLDivElement | null) => {
			localViewportRef.current = node;
			if (viewportRef) viewportRef.current = node;
		},
		[viewportRef],
	);

	const parser = useMemo(
		() =>
			new MarkdownParser({
				// 不用 Parser 全局注入：嵌入 Host 时会被 styles/realm 特异性压过。
				injectHighlightTheme: false,
				enableChatCodeFenceToolbar: true,
				chatCodeFenceToolbarTexts: {
					copy: label('common.copy', '复制'),
					download: label('common.download', '下载'),
				},
				enableHeadingSourceLineAttr: true,
				enableMermaid,
			}),
		[label, enableMermaid],
	);

	const html = useMemo(
		() => parser.render(markdown, { enableMermaid }),
		[parser, markdown, enableMermaid],
	);

	useLayoutEffect(() => {
		applyScopedHighlightTheme(highlightTheme, markdownRef.current);
	}, [highlightTheme, html]);

	useMermaidInMarkdownRoot({
		rootRef: previewHtmlRootRef,
		preferDark,
		trigger: html,
		parser: { enableMermaid },
	});

	const handleViewportScroll = useCallback(
		(_e: UIEvent<HTMLDivElement>) => {
			onViewportScrollFollow?.();
		},
		[onViewportScrollFollow],
	);

	const previewHtmlRoot = (
		<div
			ref={previewHtmlRootRef}
			className={cn(
				'[&_.markdown-body]:min-w-0 [&_.markdown-body]:max-w-none [&_.markdown-body]:wrap-break-word [&_.markdown-body]:overflow-x-auto [&_.markdown-body]:bg-transparent! [&_.markdown-body]:text-textcolor/90! [&_.markdown-body_:is(h1,h2,h3,h4,h5,h6)]:scroll-mt-3 [&_.markdown-body_pre]:max-w-full [&_.markdown-body_pre]:overflow-x-auto [&_.markdown-body_table]:block [&_.markdown-body_table]:max-w-full [&_.markdown-body_table]:overflow-x-auto',
				enableMermaid && MARKDOWN_MERMAID_TAILWIND_CURSOR_ZOOM_IN_CLASS,
			)}
		>
			<div dangerouslySetInnerHTML={{ __html: html }} />
		</div>
	);

	const previewPending =
		!markdown.trim() && Boolean(pendingSourceMarkdown?.trim());

	return (
		<div
			ref={markdownRef}
			className={cn(
				'relative h-full min-h-0 min-w-0 max-w-full w-full contain-[inline-size] select-text',
				withScrollArea ? 'overflow-hidden' : 'overflow-visible',
			)}
		>
			{markdown ? (
				withScrollArea ? (
					<ScrollArea
						ref={assignViewportRef}
						scrollbars="both"
						onScroll={handleViewportScroll}
						className="h-full min-h-0 min-w-0 max-w-full w-full bg-transparent"
						viewportClassName="[&>div]:!box-border [&>div]:!block [&>div]:!w-full [&>div]:!min-w-0 [&>div]:!max-w-full overscroll-y-contain"
					>
						<div className="box-border min-w-0 max-w-full w-full p-3">
							{previewHtmlRoot}
						</div>
					</ScrollArea>
				) : (
					// 嵌入父级滚动（如插件手册代码块）：不加 p-3，避免外框与工具栏之间多出空白
					previewHtmlRoot
				)
			) : previewPending ? (
				<div className="flex h-full min-h-0 items-center justify-center gap-2 p-3 text-sm text-textcolor/70">
					<Spinner className="size-4" />
					{label('markdown.preview.loading', '内容加载中…')}
				</div>
			) : (
				<div className="flex h-full w-full min-w-0 max-w-full flex-col items-center justify-center gap-5 box-border p-3">
					<Component className="h-16 w-16 animate-bounce text-textcolor/70" />
					<div className="text-sm text-textcolor/80">
						{label('markdown.preview.empty', '预览内容为空')}
					</div>
				</div>
			)}
		</div>
	);
});

export default Markdown;
