import type { HighlightJsThemeId } from '@dnhyxc-ai/markdown-kit';
import atomOneDarkCss from '@dnhyxc-ai/markdown-kit/styles/hljs/atom-one-dark.min.css?raw';
import atomOneLightCss from '@dnhyxc-ai/markdown-kit/styles/hljs/atom-one-light.min.css?raw';
import { useEffect, useState } from 'react';
import { isHostChromeDark } from '@/hooks/useHostBridgeSync';

/**
 * 与 Host `getChatMarkdownHighlightTheme` 对齐。
 *
 * 嵌入 Host 时：Host 自带 markdown `styles.css`（github-dark）是全局 `.hljs`；
 * 若主题注入选择器对不上 realm，就会浅底浅字。
 * 注意：realm 选择器须与 federation-kit `scopeSelector` 一致——引号转义，勿用 CSS.escape
 *（`entry:http://…` 被 escape 后永远匹配不到 DOM）。
 */
const HIGHLIGHT_THEME_CSS = {
	'atom-one-dark': atomOneDarkCss,
	'atom-one-light': atomOneLightCss,
} as const;

const STYLE_ID = 'remote-docs-hljs-theme';
/** 与 federation-kit MF_ISO_MARK 对齐，避免 Host HMR 再 wrap */
const MF_ISO_MARK = '/*mf-iso:3*/';

function highlightThemeFromDom(): keyof typeof HIGHLIGHT_THEME_CSS {
	// Host 常用 body.theme-black，不能只看 html.dark
	return isHostChromeDark() ? 'atom-one-dark' : 'atom-one-light';
}

/** 对齐 Host `scopeSelector`：只转义引号/反斜杠，不用 CSS.escape */
function scopeSelector(realm: string): string {
	const v = realm.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
	return `[data-mf-style-realm="${v}"]`;
}

/** 给扁平 hljs 主题规则加前缀，压过 Host 全局 github-dark */
function prefixFlatCss(css: string, sel: string): string {
	return css
		.split('}')
		.map((chunk) => {
			const i = chunk.indexOf('{');
			if (i < 0) return chunk;
			const selectors = chunk.slice(0, i).trim();
			const body = chunk.slice(i);
			if (!selectors || selectors.startsWith('@')) {
				return chunk.endsWith('}') || !body ? chunk : `${chunk}}`;
			}
			const prefixed = selectors
				.split(',')
				.map((s) => {
					const t = s.trim();
					return t ? `${sel} ${t}` : t;
				})
				.join(',');
			return `${prefixed}${body}}`;
		})
		.join('');
}

export function useHighlightTheme(): HighlightJsThemeId {
	const [theme, setTheme] = useState(highlightThemeFromDom);
	useEffect(() => {
		const sync = () => setTheme(highlightThemeFromDom());
		sync();
		const mo = new MutationObserver(sync);
		// body.theme-* 与 html.dark 都要盯：Host 切主题主要改 body
		mo.observe(document.body, { attributes: true, attributeFilter: ['class'] });
		mo.observe(document.documentElement, {
			attributes: true,
			attributeFilter: ['class'],
		});
		return () => mo.disconnect();
	}, []);
	return theme;
}

/**
 * 把 hljs 主题钉到插件 realm（或独立预览的 data-plugin-root）。
 */
export function applyScopedHighlightTheme(
	theme: HighlightJsThemeId,
	anchor: HTMLElement | null,
): void {
	if (typeof document === 'undefined') return;
	const css =
		theme === 'atom-one-light'
			? HIGHLIGHT_THEME_CSS['atom-one-light']
			: HIGHLIGHT_THEME_CSS['atom-one-dark'];

	const realm = anchor
		?.closest('[data-mf-style-realm]')
		?.getAttribute('data-mf-style-realm');
	const scopeSel = realm ? scopeSelector(realm) : '[data-plugin-root]';

	let el = document.getElementById(STYLE_ID) as HTMLStyleElement | null;
	if (!el) {
		el = document.createElement('style');
		el.id = STYLE_ID;
		document.head.appendChild(el);
	}
	if (realm) {
		el.dataset.mfScoped = '1';
		el.dataset.mfStyleOwner = realm;
	}
	el.textContent = `${MF_ISO_MARK}\n${prefixFlatCss(css, scopeSel)}`;
}

export function usePreferDark(): boolean {
	const [dark, setDark] = useState(isHostChromeDark);
	useEffect(() => {
		const sync = () => setDark(isHostChromeDark());
		sync();
		const mo = new MutationObserver(sync);
		mo.observe(document.body, { attributes: true, attributeFilter: ['class'] });
		mo.observe(document.documentElement, {
			attributes: true,
			attributeFilter: ['class'],
		});
		return () => mo.disconnect();
	}, []);
	return dark;
}
