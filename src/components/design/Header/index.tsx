import { Languages, type LucideIcon } from 'lucide-react';
import { useCallback } from 'react';
import { Button } from '@/components/ui';
import { useDocsStandalone } from '@/hooks/useDocsStandalone';
import { useI18n } from '@/i18n';

/** 独立站文档顶栏；Host 嵌入时不渲染（主站已有壳） */
export function Header({
	title,
	icon: Icon,
	iconClassName,
}: {
	title: string;
	icon: LucideIcon;
	iconClassName?: string;
}) {
	const standalone = useDocsStandalone();
	const { t, locale, setLocale } = useI18n();

	const onToggleLanguage = useCallback(() => {
		setLocale(locale === 'en-US' ? 'zh-CN' : 'en-US');
	}, [locale, setLocale]);

	if (!standalone) return null;

	return (
		<header className="flex h-12.5 shrink-0 items-center border-b border-theme/5 pl-4 pr-2">
			<div className="flex min-w-0 flex-1 items-center gap-2">
				<Icon className={iconClassName ?? 'size-5 shrink-0'} />
				<h1 className="min-w-0 truncate text-base font-semibold">{title}</h1>
			</div>
			<Button
				type="button"
				variant="ghost"
				size="icon-sm"
				className="ml-4 shrink-0 text-textcolor/70 hover:text-textcolor"
				title={t('header.toggleLanguage')}
				aria-label={t('header.toggleLanguage')}
				onClick={onToggleLanguage}
			>
				<Languages className="size-4" strokeWidth={2} />
			</Button>
		</header>
	);
}
