import { ScrollText } from 'lucide-react';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { DocToc, tocFromSections } from '@/components/design/DocToc';
import { Header } from '@/components/design/Header';
import { Button } from '@/components/ui';
import { useI18n } from '@/i18n';
import {
	getUpdateInfoIntro,
	getUpdateInfoLatestIntro,
	getUpdateInfoSections,
	pickLatestUpdate,
	readUpdateScope,
	scopeFromLocation,
	setUpdateScope,
	type UpdateScope,
} from './updateInfoSections';

function readScope(locale: Parameters<typeof getUpdateInfoSections>[0]): UpdateScope {
	if (typeof window === 'undefined') return 'latest';
	const all = getUpdateInfoSections(locale);
	return scopeFromLocation(
		window.location.search,
		window.location.hash,
		all,
		pickLatestUpdate(all).sections,
	);
}

export default function UpdateInfoPage() {
	const { t, locale } = useI18n();
	const all = useMemo(() => getUpdateInfoSections(locale), [locale]);
	const latest = useMemo(() => pickLatestUpdate(all), [all]);
	const [scope, setScope] = useState<UpdateScope>(() => readScope(locale));
	const scrollTop = useRef(false);
	const showingLatest = scope === 'latest' && latest.dateLabel !== '';
	const visible = showingLatest ? latest.sections : all;
	const intro = showingLatest
		? getUpdateInfoLatestIntro(locale, latest.dateLabel)
		: getUpdateInfoIntro(locale);
	const toc = useMemo(() => tocFromSections(visible), [visible]);
	const tocLabel = locale === 'en-US' ? 'Contents' : '目录';

	useEffect(() => {
		if (scope === 'all' && readUpdateScope(window.location.search) !== 'all') {
			setUpdateScope('all', 'replace');
		}
	}, [scope]);

	useEffect(() => {
		const onPop = () => {
			const next = readUpdateScope(window.location.search);
			const id = window.location.hash.replace(/^#/, '');
			scrollTop.current = next === 'latest' || !id;
			setScope(next);
		};
		window.addEventListener('popstate', onPop);
		return () => window.removeEventListener('popstate', onPop);
	}, []);

	useLayoutEffect(() => {
		const viewport = document
			.querySelector('main')
			?.closest<HTMLElement>('[data-slot="scroll-area-viewport"]');
		if (scrollTop.current) {
			scrollTop.current = false;
			viewport?.scrollTo({ top: 0 });
			return;
		}
		const id = window.location.hash.replace(/^#/, '');
		if (!id) return;
		document.getElementById(id)?.scrollIntoView({ block: 'start' });
	}, [scope, visible]);

	const onToggle = useCallback(() => {
		const next: UpdateScope = showingLatest ? 'all' : 'latest';
		scrollTop.current = true;
		setUpdateScope(next, 'push');
		setScope(next);
	}, [showingLatest]);

	return (
		<div className="relative flex h-full min-h-0 w-full flex-col overflow-hidden bg-theme-background text-textcolor">
			<Header
				title={t('route.updateInfo.title')}
				icon={ScrollText}
				iconClassName="size-5 shrink-0 text-amber-400"
			/>
			<DocToc toc={toc} label={tocLabel}>
				<main className="mx-auto w-full max-w-4xl p-4">
					<p className="text-[15px] leading-7 text-textcolor/72">{intro}</p>
					{latest.dateLabel ? (
						<Button
							type="button"
							variant="link"
							className="mt-3 mb-10 h-auto px-0"
							onClick={onToggle}
						>
							{showingLatest
								? t('updateInfoPage.latest.more')
								: t('updateInfoPage.latest.only')}
						</Button>
					) : (
						<div className="mb-10" />
					)}

					{visible.map((section) => (
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
										<div className="flex flex-col gap-2 sm:flex-row sm:items-baseline sm:justify-between sm:gap-6">
											<h3
												id={item.id}
												className="scroll-mt-4 text-[15px] font-medium leading-snug text-textcolor"
											>
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
			</DocToc>
		</div>
	);
}
