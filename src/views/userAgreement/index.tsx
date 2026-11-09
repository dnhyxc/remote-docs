import { ScrollText } from 'lucide-react';
import { useMemo } from 'react';
import { DocToc, tocFromSections } from '@/components/design/DocToc';
import { Header } from '@/components/design/Header';
import { useI18n } from '@/i18n';
import { getUserAgreementSections } from './userAgreementSections';

export default function UserAgreementPage() {
	const { t, locale } = useI18n();
	const sections = useMemo(() => getUserAgreementSections(locale), [locale]);
	const toc = useMemo(() => tocFromSections(sections), [sections]);
	const tocLabel = locale === 'en-US' ? 'Contents' : '目录';

	return (
		<div className="relative flex h-full min-h-0 w-full flex-col overflow-hidden bg-theme-background text-textcolor">
			<Header
				title={t('route.userAgreement.title')}
				icon={ScrollText}
				iconClassName="size-5 shrink-0 text-sky-400"
			/>
			<DocToc toc={toc} label={tocLabel}>
				<main className="mx-auto w-full max-w-4xl p-4">
					{sections.map((section) => (
						<section key={section.id} className="pb-14 last:pb-4">
							<h2
								id={section.id}
								className="mb-6 scroll-mt-4 text-base font-semibold text-textcolor sm:text-lg"
							>
								{section.title}
							</h2>
							<div className="flex flex-col gap-8">
								{section.items.map((item) => (
									<article key={item.id}>
										<h3
											id={item.id}
											className="scroll-mt-4 text-[15px] font-medium leading-snug text-textcolor"
										>
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
			</DocToc>
		</div>
	);
}
