import { ScrollText } from 'lucide-react';
import { useMemo } from 'react';
import { Header } from '@/components/design/Header';
import { ScrollArea } from '@/components/ui';
import { useI18n } from '@/i18n';
import {
	getUpdateInfoIntro,
	getUpdateInfoSections,
} from './updateInfoSections';

export default function UpdateInfoPage() {
	const { t, locale } = useI18n();
	const sections = useMemo(() => getUpdateInfoSections(locale), [locale]);
	const intro = useMemo(() => getUpdateInfoIntro(locale), [locale]);

	return (
		<div className="relative flex h-full min-h-0 w-full flex-col overflow-hidden bg-theme-background text-textcolor">
			<Header
				title={t('route.updateInfo.title')}
				icon={ScrollText}
				iconClassName="size-5 shrink-0 text-amber-400"
			/>

			<ScrollArea className="min-h-0 flex-1" viewportClassName="pb-1">
				<main className="mx-auto w-full max-w-4xl p-4">
					<p className="mb-10 text-[15px] leading-7 text-textcolor/72">
						{intro}
					</p>

					{sections.map((section) => (
						<section key={section.id} className="pb-14 last:pb-4">
							<h2 className="mb-6 text-base font-semibold text-textcolor sm:text-lg">
								{section.title}
							</h2>
							<div className="flex flex-col gap-8">
								{section.items.map((item) => (
									<article key={item.id} className="scroll-mt-4">
										<div className="flex flex-col gap-2 sm:flex-row sm:items-baseline sm:justify-between sm:gap-6">
											<h3 className="text-[15px] font-medium leading-snug text-textcolor">
												{item.title}
											</h3>
											<time
												dateTime={item.dateLabel}
												className="shrink-0 text-xs tabular-nums text-textcolor/45"
											>
												{t('updateInfoPage.item.dateLabel', {
													date: item.dateLabel,
												})}
											</time>
										</div>
										<p className="mt-2.5 text-[14px] leading-7 text-textcolor/68">
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
