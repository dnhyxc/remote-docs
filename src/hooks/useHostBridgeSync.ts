import { useEffect } from 'react';
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

/** 跟随 Host theme：给 html 加/去 .dark */
export function useHostTheme(api?: HostBridgeProps['api']) {
	useEffect(() => {
		const theme = api?.theme;
		if (!theme) return;
		const root = document.documentElement;
		root.classList.toggle('dark', theme === 'dark');
		root.dataset.theme = theme;
		root.style.colorScheme = theme;
	}, [api?.theme]);
}
