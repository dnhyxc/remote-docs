/**
 * 一次性：把 pluginDevGuideSections 导出为 zh/en .md
 * 用法：cd remote-docs && npx --yes tsx src/views/pluginDevGuide/dumpGuideMd.mts
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildPluginGuideMarkdown } from './pluginDevGuideSections.ts';

const dir = path.dirname(fileURLToPath(import.meta.url));

for (const [locale, file] of [
	['zh-CN', 'pluginDevGuide.zh-CN.md'],
	['en-US', 'pluginDevGuide.en-US.md'],
] as const) {
	const out = path.join(dir, file);
	fs.writeFileSync(out, buildPluginGuideMarkdown(locale), 'utf8');
	console.log('wrote', out);
}
