import { useEffect, type RefObject } from 'react';
import { useI18n, type Locale } from '@/i18n';
import type { HostBridgeProps } from '@/types/host';

function isLocale(v: unknown): v is Locale {
	return v === 'zh-CN' || v === 'en-US';
}

/** 跟随 Host bridge locale（嵌入时） */
export function useHostLocale(api?: HostBridgeProps['api']) {
	const { setLocale } = useI18n();

	useEffect(() => {
		if (isLocale(api?.locale)) setLocale(api.locale);
	}, [api?.locale, setLocale]);

	useEffect(() => {
		const event = api?.event;
		if (!event) return;
		const onLocale = (data?: unknown) => {
			if (isLocale(data)) setLocale(data);
		};
		event.on('locale', onLocale);
		return () => event.off('locale', onLocale);
	}, [api?.event, setLocale]);
}

/**
 * Host 暗色探测（兜底）：主站常用 body.theme-black。
 * 有 body.theme-* 时只信 Host chrome，避免读到本插件写上的 html.dark。
 */
export function isHostChromeDark(): boolean {
	if (typeof document === 'undefined') return false;
	const body = document.body;
	let hasThemeClass = false;
	for (const c of body.classList) {
		if (c.startsWith('theme-')) {
			hasThemeClass = true;
			if (c === 'theme-black') return true;
		}
	}
	if (hasThemeClass) return false;
	return (
		body.classList.contains('dark') ||
		document.documentElement.classList.contains('dark')
	);
}

/**
 * 独立预览吃 html.dark；嵌入后 Host 把 html.dark 译成
 * `[data-mf-style-realm][data-plugin-root].dark`，须钉在插件根上。
 */
export function applyDocsDark(
	dark: boolean,
	pluginRoot?: HTMLElement | null,
): void {
	const root = document.documentElement;
	root.classList.toggle('dark', dark);
	root.dataset.theme = dark ? 'dark' : 'light';
	root.style.colorScheme = dark ? 'dark' : 'light';

	const hostWrap = pluginRoot?.closest(
		'[data-mf-style-realm][data-plugin-root]',
	);
	hostWrap?.classList.toggle('dark', dark);
	pluginRoot?.classList.toggle('dark', dark);
}

function themePayloadToDark(data: unknown): boolean | null {
	if (data === 'dark' || data === 'black') return true;
	if (data === 'light' || data === 'white') return false;
	if (data && typeof data === 'object' && 'theme' in data) {
		const t = (data as { theme?: unknown }).theme;
		if (t === 'dark' || t === 'black') return true;
		if (t === 'light' || t === 'white') return false;
	}
	return null;
}

/**
 * 跟随 Host theme（嵌入时）。
 * 主路径：live `api.theme`（kit withLiveTheme）+ `event.on('theme')`。
 * 兜底：body.theme-* MutationObserver（旧 Host / 无热推时仍可用）。
 */
export function useHostTheme(
	api?: HostBridgeProps['api'],
	pluginRootRef?: RefObject<HTMLElement | null>,
) {
	const root = () => pluginRootRef?.current ?? null;

	// 主路径：与 locale 相同，依赖 Host 覆写后的 api.theme
	useEffect(() => {
		if (!api?.theme) return;
		applyDocsDark(api.theme === 'dark', root());
	}, [api?.theme, pluginRootRef]);

	useEffect(() => {
		const event = api?.event;
		if (!event) return;
		const onTheme = (data?: unknown) => {
			const dark = themePayloadToDark(data);
			if (dark === null) return;
			applyDocsDark(dark, root());
		};
		event.on('theme', onTheme);
		return () => event.off('theme', onTheme);
	}, [api?.event, pluginRootRef]);

	// 兜底：仅嵌入时；无 theme 热推的旧 Host 仍跟 body.theme-*
	useEffect(() => {
		if (!api || typeof document === 'undefined') return;
		const sync = () => applyDocsDark(isHostChromeDark(), root());
		sync();
		const mo = new MutationObserver(sync);
		mo.observe(document.body, { attributes: true, attributeFilter: ['class'] });
		mo.observe(document.documentElement, {
			attributes: true,
			attributeFilter: ['class'],
		});
		return () => mo.disconnect();
	}, [api, pluginRootRef]);
}

/**
 * 独立打开：读 `?theme=`（与 Host appendShareThemeQuery 一致；black → dark）。
 * 首屏已在 main.tsx 同步过；此处再跟一次，防止 HMR / 后续 query 变化。
 */
export function useStandaloneThemeFromSearch(
	enabled: boolean,
	pluginRootRef?: RefObject<HTMLElement | null>,
) {
	useEffect(() => {
		if (!enabled || typeof window === 'undefined') return;
		const theme = new URLSearchParams(window.location.search).get('theme');
		if (!theme) return;
		applyDocsDark(
			theme === 'black' || theme === 'dark',
			pluginRootRef?.current ?? null,
		);
	}, [enabled, pluginRootRef]);
}
