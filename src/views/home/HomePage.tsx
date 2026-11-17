import {
	ArrowRight,
	BookOpen,
	FileText,
	type LucideIcon,
	Puzzle,
	ScrollText,
	Shield,
	Zap,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useI18n } from '@/i18n';
import { useNavigation } from '@/router/NavigationContext';

type PageDef = {
	to: string;
	titleKey:
		| 'nav.updateInfo'
		| 'nav.projectGuide'
		| 'nav.pluginDevGuide'
		| 'nav.servicePolicy'
		| 'nav.userAgreement';
	descKey:
		| 'home.updateInfo.desc'
		| 'home.projectGuide.desc'
		| 'home.pluginDevGuide.desc'
		| 'home.servicePolicy.desc'
		| 'home.userAgreement.desc';
	categoryKey: 'home.category.product' | 'home.category.dev' | 'home.category.legal';
	icon: LucideIcon;
};

const PAGES: PageDef[] = [
	{
		to: '/update-info',
		titleKey: 'nav.updateInfo',
		descKey: 'home.updateInfo.desc',
		categoryKey: 'home.category.product',
		icon: ScrollText,
	},
	{
		to: '/project-guide',
		titleKey: 'nav.projectGuide',
		descKey: 'home.projectGuide.desc',
		categoryKey: 'home.category.product',
		icon: BookOpen,
	},
	{
		to: '/plugin-dev-guide',
		titleKey: 'nav.pluginDevGuide',
		descKey: 'home.pluginDevGuide.desc',
		categoryKey: 'home.category.dev',
		icon: Puzzle,
	},
	{
		to: '/service-policy',
		titleKey: 'nav.servicePolicy',
		descKey: 'home.servicePolicy.desc',
		categoryKey: 'home.category.legal',
		icon: Shield,
	},
	{
		to: '/user-agreement',
		titleKey: 'nav.userAgreement',
		descKey: 'home.userAgreement.desc',
		categoryKey: 'home.category.legal',
		icon: FileText,
	},
];

export default function HomePage() {
	const { t } = useI18n();
	const { navigate } = useNavigation();

	const grouped = PAGES.reduce<Record<string, PageDef[]>>((acc, p) => {
		const category = t(p.categoryKey);
		acc[category] ??= [];
		acc[category].push(p);
		return acc;
	}, {});

	return (
		<div className="mx-auto w-full max-w-5xl overflow-auto px-6 py-10">
			<section className="mb-10">
				<div className="flex items-center gap-2 text-teal-500/80">
					<Zap className="h-4 w-4" />
					<span className="text-xs font-medium uppercase tracking-[0.2em]">
						{t('home.hero.tag')}
					</span>
				</div>
				<h1 className="mt-3 text-2xl font-semibold tracking-tight text-textcolor sm:text-3xl">
					{t('nav.home')}
				</h1>
				<p className="mt-2 max-w-xl text-sm leading-relaxed text-textcolor/55">
					{t('home.intro')}
				</p>
			</section>

			<div className="space-y-8">
				{Object.entries(grouped).map(([category, items]) => (
					<section key={category}>
						<div className="mb-3 flex items-center gap-2">
							<div className="h-px flex-1 bg-linear-to-r from-transparent via-theme/15 to-transparent" />
							<span className="text-[11px] font-medium uppercase tracking-[0.15em] text-textcolor/40">
								{category}
							</span>
							<div className="h-px flex-1 bg-linear-to-r from-transparent via-theme/15 to-transparent" />
						</div>
						<div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
							{items.map((p) => (
								<button
									key={p.to}
									type="button"
									onClick={() => navigate(p.to)}
									className={cn(
										'group relative overflow-hidden rounded-xl border border-theme/10 bg-card p-4 text-left',
										'transition-all duration-200',
										'hover:border-teal-500/30 hover:shadow-lg hover:shadow-teal-500/5',
										'hover:-translate-y-0.5',
										'focus-visible:ring-2 focus-visible:ring-teal-500/50 focus-visible:outline-none',
									)}
								>
									<div
										className={cn(
											'pointer-events-none absolute inset-0 opacity-0 transition-opacity duration-300',
											'group-hover:opacity-100',
										)}
									>
										<div className="absolute -top-12 -right-12 h-32 w-32 rounded-full bg-teal-500/10 blur-2xl" />
									</div>
									<div className="relative">
										<div className="mb-3 flex items-center justify-between">
											<div
												className={cn(
													'flex h-10 w-10 items-center justify-center rounded-lg',
													'bg-teal-500/10 text-teal-500',
													'ring-1 ring-inset ring-teal-500/10',
													'transition-transform duration-200 group-hover:scale-105',
												)}
											>
												<p.icon className="h-5 w-5" />
											</div>
										</div>
										<h3 className="text-sm font-medium text-textcolor">
											{t(p.titleKey)}
										</h3>
										<p className="mt-1 text-xs leading-relaxed text-textcolor/50">
											{t(p.descKey)}
										</p>
										<div className="mt-3 flex items-center justify-between">
											<code
												className={cn(
													'rounded-md bg-theme/5 px-1.5 py-0.5 font-mono text-[10px] text-textcolor/35',
													'transition-colors group-hover:bg-teal-500/10 group-hover:text-teal-500/60',
												)}
											>
												{p.to}
											</code>
											<div
												className={cn(
													'flex h-6 w-6 items-center justify-center rounded-md',
													'bg-theme/0 text-textcolor/30',
													'transition-all duration-200',
													'group-hover:bg-teal-500/10 group-hover:text-teal-500',
												)}
											>
												<ArrowRight className="h-3.5 w-3.5" />
											</div>
										</div>
									</div>
								</button>
							))}
						</div>
					</section>
				))}
			</div>
		</div>
	);
}
