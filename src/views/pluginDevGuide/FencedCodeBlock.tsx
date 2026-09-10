import { memo, useMemo } from 'react';
import Markdown from '@/components/design/Markdown';
import type { PluginGuideCode } from '@/views/pluginDevGuide/pluginDevGuideSections';

/**
 * 与 Host `pluginDevGuide` 一致：把 { lang, code } 包成单一 fenced Markdown，
 * 交给 design/Markdown（MarkdownParser）渲染。
 */
export const FencedCodeBlock = memo(function FencedCodeBlock({
	id,
	code,
}: {
	id: string;
	code: PluginGuideCode;
}) {
	const fenced = useMemo(
		() => `\`\`\`${code.lang}\n${code.code}\n\`\`\``,
		[code.lang, code.code],
	);

	return (
		<div className="my-4">
			<Markdown
				markdown={fenced}
				documentIdentity={id}
				enableMermaid={false}
				withScrollArea={false}
			/>
		</div>
	);
});
