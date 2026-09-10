import { Languages, Puzzle } from 'lucide-react';
import { useCallback, useMemo } from 'react';
import Markdown from '@/components/design/Markdown';
import { Button, ScrollArea } from '@/components/ui';
import { useI18n } from '@/i18n';
import guideEn from './pluginDevGuide.en-US.md?raw';
import guideZh from './pluginDevGuide.zh-CN.md?raw';

export default function PluginDevGuidePage() {
	const { t, locale, setLocale } = useI18n();
	const markdown = useMemo(
		() => (locale === 'en-US' ? guideEn : guideZh),
		[locale],
	);

	const onToggleLanguage = useCallback(() => {
		setLocale(locale === 'en-US' ? 'zh-CN' : 'en-US');
	}, [locale, setLocale]);

	return (
		<div className="relative flex h-full min-h-0 w-full flex-col overflow-hidden bg-theme-background text-textcolor">
			<header className="flex h-12.5 shrink-0 items-center border-b border-theme/5 pl-4 pr-2">
				<div className="flex min-w-0 flex-1 items-center gap-2">
					<Puzzle className="size-5 shrink-0 text-violet-400" />
					<h1 className="min-w-0 truncate text-base font-semibold">
						{t('route.pluginDevGuide.title')}
					</h1>
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

			<ScrollArea className="min-h-0 flex-1" viewportClassName="pb-1">
				<main className="mx-auto w-full max-w-4xl px-4 py-6">
					<Markdown
						markdown={markdown}
						documentIdentity={`plugin-dev-guide-${locale}`}
						enableMermaid={false}
						withScrollArea={false}
					/>
				</main>
			</ScrollArea>
		</div>
	);
}
