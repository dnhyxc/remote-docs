import {
	createContext,
	useCallback,
	useContext,
	useMemo,
	useState,
	type ReactNode,
} from 'react';
import type { HostLocale } from '@/types/host';

export type Locale = HostLocale;

const messages = {
	'zh-CN': {
		'route.updateInfo.title': '更新信息',
		'route.projectGuide.title': '产品指南',
		'route.pluginDevGuide.title': '插件开发手册',
		'header.toggleLanguage': '切换语言',
		'updateInfoPage.item.dateLabel': '更新：{date}',
		'nav.home': '文档首页',
		'nav.updateInfo': '更新信息',
		'nav.projectGuide': '产品指南',
		'nav.pluginDevGuide': '插件开发手册',
		'home.intro': '独立预览入口。Host 嵌入后默认进入「更新信息」。',
		'code.copy': '复制',
		'code.download': '下载',
		'markdown.preview.loading': '内容加载中…',
		'markdown.preview.empty': '预览内容为空',
	},
	'en-US': {
		'route.updateInfo.title': 'Release notes',
		'route.projectGuide.title': 'Product guide',
		'route.pluginDevGuide.title': 'Plugin development guide',
		'header.toggleLanguage': 'Toggle language',
		'updateInfoPage.item.dateLabel': 'Updated: {date}',
		'nav.home': 'Docs home',
		'nav.updateInfo': 'Release notes',
		'nav.projectGuide': 'Product guide',
		'nav.pluginDevGuide': 'Plugin guide',
		'home.intro':
			'Standalone preview. When embedded in Host, opens Release notes by default.',
		'code.copy': 'Copy',
		'code.download': 'Download',
		'markdown.preview.loading': 'Loading…',
		'markdown.preview.empty': 'Preview is empty',
	},
} as const;

type MessageKey = keyof (typeof messages)['zh-CN'];

type I18nContextValue = {
	locale: Locale;
	setLocale: (next: Locale) => void;
	t: (key: MessageKey, params?: Record<string, string>) => string;
};

const I18nContext = createContext<I18nContextValue | null>(null);

function readInitialLocale(): Locale {
	if (typeof window === 'undefined') return 'zh-CN';
	const q = new URLSearchParams(window.location.search).get('lang');
	return q === 'en-US' || q === 'zh-CN' ? q : 'zh-CN';
}

export function I18nProvider({ children }: { children: ReactNode }) {
	const [locale, setLocaleState] = useState<Locale>(readInitialLocale);

	const setLocale = useCallback((next: Locale) => {
		setLocaleState(next);
		if (typeof window === 'undefined') return;
		const url = new URL(window.location.href);
		url.searchParams.set('lang', next);
		window.history.replaceState(null, '', url.toString());
	}, []);

	const t = useCallback(
		(key: MessageKey, params?: Record<string, string>) => {
			let text: string = messages[locale][key] ?? messages['zh-CN'][key] ?? key;
			if (params) {
				for (const [k, v] of Object.entries(params)) {
					text = text.replace(`{${k}}`, v);
				}
			}
			return text;
		},
		[locale],
	);

	const value = useMemo(
		() => ({ locale, setLocale, t }),
		[locale, setLocale, t],
	);

	return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n() {
	const ctx = useContext(I18nContext);
	if (!ctx) throw new Error('useI18n must be used within I18nProvider');
	return ctx;
}
