import {
	bindMarkdownCodeFenceActions,
	type HighlightJsThemeId,
	MarkdownParser,
} from '@dnhyxc-ai/markdown-kit';
import '@dnhyxc-ai/markdown-kit/styles.css';
import { memo, useEffect, useMemo, useRef, useState } from 'react';
import { useI18n } from '@/i18n';
import type { PluginGuideCode } from '@/views/pluginDevGuide/pluginDevGuideSections';

/** 与 Host `getChatMarkdownHighlightTheme` 对齐：暗色 atom-one-dark，亮色 atom-one-light */
function highlightThemeFromDom(): HighlightJsThemeId {
	return document.documentElement.classList.contains('dark')
		? 'atom-one-dark'
		: 'atom-one-light';
}

function useHighlightTheme(): HighlightJsThemeId {
	const [theme, setTheme] = useState(highlightThemeFromDom);
	useEffect(() => {
		const root = document.documentElement;
		const sync = () => setTheme(highlightThemeFromDom());
		const mo = new MutationObserver(sync);
		mo.observe(root, { attributes: true, attributeFilter: ['class'] });
		return () => mo.disconnect();
	}, []);
	return theme;
}

/**
 * 与 Host `pluginDevGuide` 一致：把 { lang, code } 包成单一 fenced Markdown，
 * 经 MarkdownParser 渲染（高亮 + 围栏工具栏）；关闭 Mermaid / 浮动吸顶条。
 */
export const FencedCodeBlock = memo(function FencedCodeBlock({
	id,
	code,
}: {
	id: string;
	code: PluginGuideCode;
}) {
	const { t } = useI18n();
	const rootRef = useRef<HTMLDivElement>(null);
	const highlightTheme = useHighlightTheme();

	const fenced = useMemo(
		() => `\`\`\`${code.lang}\n${code.code}\n\`\`\``,
		[code.lang, code.code],
	);

	const parser = useMemo(
		() =>
			new MarkdownParser({
				highlightTheme,
				enableChatCodeFenceToolbar: true,
				chatCodeFenceToolbarTexts: {
					copy: t('code.copy'),
					download: t('code.download'),
				},
				enableMermaid: false,
			}),
		[highlightTheme, t],
	);

	const html = useMemo(
		() => parser.render(fenced, { enableMermaid: false }),
		[parser, fenced],
	);

	useEffect(() => {
		const el = rootRef.current;
		if (!el) return;
		return bindMarkdownCodeFenceActions(el, {
			onDownload(payload) {
				const url = URL.createObjectURL(
					new Blob([payload.code], { type: 'text/plain;charset=utf-8' }),
				);
				const a = document.createElement('a');
				a.href = url;
				a.download = payload.filename;
				a.click();
				URL.revokeObjectURL(url);
			},
		});
	}, []);

	return (
		<div
			id={id}
			ref={rootRef}
			className="my-4 overflow-hidden rounded-lg border border-theme-white/10 [&_.markdown-body]:min-w-0 [&_.markdown-body]:max-w-none [&_.markdown-body]:bg-transparent! [&_.markdown-body]:text-textcolor/90! [&_.markdown-body_pre]:max-w-full [&_.markdown-body_pre]:overflow-x-auto"
			dangerouslySetInnerHTML={{ __html: html }}
		/>
	);
});
