import { Button } from '@/components/ui';
import { useI18n } from '@/i18n';
import { useNavigation } from '@/router/NavigationContext';

const LINKS = [
	{ path: '/update-info', key: 'nav.updateInfo' as const },
	{ path: '/project-guide', key: 'nav.projectGuide' as const },
	{ path: '/plugin-dev-guide', key: 'nav.pluginDevGuide' as const },
];

export default function HomePage() {
	const { t } = useI18n();
	const { navigate } = useNavigation();

	return (
		<div className="mx-auto flex h-full w-full max-w-4xl flex-col gap-6 px-4 py-10">
			<div>
				<h1 className="text-xl font-semibold text-textcolor">
					{t('nav.home')}
				</h1>
				<p className="mt-2 text-sm leading-6 text-textcolor/68">
					{t('home.intro')}
				</p>
			</div>
			<ul className="flex flex-col gap-3">
				{LINKS.map((link) => (
					<li key={link.path}>
						<Button
							type="button"
							variant="outline"
							className="w-full justify-start"
							onClick={() => navigate(link.path)}
						>
							{t(link.key)}
						</Button>
					</li>
				))}
			</ul>
		</div>
	);
}
