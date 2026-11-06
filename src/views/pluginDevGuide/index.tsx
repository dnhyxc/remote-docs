import { Puzzle } from 'lucide-react';
import { useMemo } from 'react';
import {
	DocToc,
	parseMarkdownToc,
	stripMarkdownToc,
} from '@/components/design/DocToc';
import { Header } from '@/components/design/Header';
import Markdown from '@/components/design/Markdown';
import { useI18n } from '@/i18n';
import guideEn from './pluginDevGuide.en-US.md?raw';
import guideZh from './pluginDevGuide.zh-CN.md?raw';

export default function PluginDevGuidePage() {
	const { t, locale } = useI18n();
	const source = locale === 'en-US' ? guideEn : guideZh;
	const markdown = useMemo(() => stripMarkdownToc(source), [source]);
	const toc = useMemo(() => parseMarkdownToc(source), [source]);
	const tocLabel = locale === 'en-US' ? 'Contents' : '目录';

	return (
		<div className="relative flex h-full min-h-0 w-full flex-col overflow-hidden text-textcolor">
			<Header
				title={t('route.pluginDevGuide.title')}
				icon={Puzzle}
				iconClassName="size-5 shrink-0 text-violet-400"
			/>
			<DocToc toc={toc} label={tocLabel}>
				<main className="mx-auto w-full max-w-4xl p-4">
					<Markdown
						markdown={markdown}
						documentIdentity={`plugin-dev-guide-${locale}`}
						enableMermaid={false}
						withScrollArea={false}
					/>
				</main>
			</DocToc>
		</div>
	);
}
