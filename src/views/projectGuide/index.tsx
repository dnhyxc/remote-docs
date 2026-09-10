import { BookOpen, Languages } from 'lucide-react';
import { useCallback, useMemo } from 'react';
import { Button, ScrollArea } from '@/components/ui';
import { useI18n } from '@/i18n';
import { getProjectGuideSections } from './projectGuideSections';

export default function ProjectGuidePage() {
	const { t, locale, setLocale } = useI18n();
	const sections = useMemo(() => getProjectGuideSections(locale), [locale]);

	const onToggleLanguage = useCallback(() => {
		setLocale(locale === 'en-US' ? 'zh-CN' : 'en-US');
	}, [locale, setLocale]);

	return (
		<div className="relative flex h-full min-h-0 w-full flex-col overflow-hidden bg-theme-background text-textcolor">
			<header className="flex h-12.5 shrink-0 items-center border-b border-theme/5 pl-4 pr-2">
				<div className="flex min-w-0 flex-1 items-center gap-2">
					<BookOpen className="size-5 shrink-0 text-sky-400" />
					<h1 className="min-w-0 truncate text-base font-semibold">
						{t('route.projectGuide.title')}
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
					{sections.map((section) => (
						<section key={section.id} className="pb-14 last:pb-4">
							<h2 className="mb-6 text-base font-semibold text-textcolor sm:text-lg">
								{section.title}
							</h2>
							<div className="flex flex-col gap-8">
								{section.items.map((item) => (
									<article key={item.id} className="scroll-mt-4">
										<h3 className="text-[15px] font-medium leading-snug text-textcolor">
											{item.title}
										</h3>
										<p className="mt-2.5 whitespace-pre-line text-[14px] leading-7 text-textcolor/68">
											{item.description}
										</p>
									</article>
								))}
							</div>
						</section>
					))}
				</main>
			</ScrollArea>
		</div>
	);
}
