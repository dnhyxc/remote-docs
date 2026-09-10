import { Puzzle } from 'lucide-react';
import { useMemo } from 'react';
import Markdown from '@/components/design/Markdown';
import { Header } from '@/components/design/Header';
import { ScrollArea } from '@/components/ui';
import { useI18n } from '@/i18n';
import guideEn from './pluginDevGuide.en-US.md?raw';
import guideZh from './pluginDevGuide.zh-CN.md?raw';

export default function PluginDevGuidePage() {
	const { t, locale } = useI18n();
	const markdown = useMemo(
		() => (locale === 'en-US' ? guideEn : guideZh),
		[locale],
	);

	return (
		<div className="relative flex h-full min-h-0 w-full flex-col overflow-hidden text-textcolor">
			<Header
				title={t('route.pluginDevGuide.title')}
				icon={Puzzle}
				iconClassName="size-5 shrink-0 text-violet-400"
			/>

			<ScrollArea className="min-h-0 flex-1" viewportClassName="pb-1">
				<main className="mx-auto w-full max-w-4xl p-4">
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
