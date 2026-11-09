import {
	useCallback,
	useEffect,
	useMemo,
	useRef,
	useState,
	type ReactNode,
	type UIEvent,
} from 'react';
import { ScrollArea } from '@/components/ui';
import { cn } from '@/lib/utils';

export type TocItem = { level: 2 | 3; text: string; id: string };

const TOC_BLOCK =
	/^## (?:目录|Contents)\s*\n+(?:(?:[ \t]*- .*)\n+|\n+)*/m;

export function stripMarkdownToc(md: string): string {
	return md.replace(TOC_BLOCK, '');
}

function slugify(text: string): string {
	const base = text
		.toLowerCase()
		.replace(/[^\p{L}\p{N}\s\-_]/gu, '')
		.trim()
		.replace(/\s+/g, '-')
		.replace(/^-+/, '');
	return base || 'heading';
}

export function parseMarkdownToc(md: string): TocItem[] {
	const counts: Record<string, number> = {};
	const items: TocItem[] = [];
	for (const line of stripMarkdownToc(md).split('\n')) {
		const m = line.match(/^(#{2,3}) (.+)$/);
		if (!m) continue;
		const level = m[1].length as 2 | 3;
		const text = m[2];
		const base = slugify(text);
		counts[base] = (counts[base] ?? 0) + 1;
		const n = counts[base];
		items.push({ level, text, id: n === 1 ? base : `${base}-${n - 1}` });
	}
	return items;
}

export function tocFromSections(
	sections: {
		id: string;
		title: string;
		items: { id: string; title: string }[];
	}[],
): TocItem[] {
	return sections.flatMap((s) => [
		{ id: s.id, text: s.title, level: 2 as const },
		...s.items.map((i) => ({ id: i.id, text: i.title, level: 3 as const })),
	]);
}

function scrollToHeading(id: string) {
	document.getElementById(id)?.scrollIntoView({ block: 'start' });
}

function headingAt(root: HTMLElement, ids: string[]) {
	const top = root.getBoundingClientRect().top + 32;
	let id = ids[0] ?? '';
	for (const next of ids) {
		const el = document.getElementById(next);
		if (el && el.getBoundingClientRect().top <= top) id = next;
	}
	if (root.scrollTop + root.clientHeight >= root.scrollHeight - 2) {
		id = ids[ids.length - 1] ?? id;
	}
	return id;
}

export function DocToc({
	toc,
	label,
	children,
}: {
	toc: TocItem[];
	label: string;
	children: ReactNode;
}) {
	const ids = useMemo(() => toc.map((item) => item.id), [toc]);
	const [activeId, setActiveId] = useState(ids[0] ?? '');
	const navRef = useRef<HTMLElement>(null);

	useEffect(() => {
		setActiveId(ids[0] ?? '');
	}, [ids]);

	useEffect(() => {
		navRef.current
			?.querySelector('[aria-current="location"]')
			?.scrollIntoView({ block: 'center' });
	}, [activeId]);

	const onBodyScroll = useCallback(
		(e: UIEvent<HTMLDivElement>) => {
			const id = headingAt(e.currentTarget, ids);
			setActiveId((prev) => (prev === id ? prev : id));
		},
		[ids],
	);

	return (
		<div className="flex min-h-0 flex-1 overflow-hidden">
			<aside className="h-full min-h-0 w-75 shrink-0 border-r border-theme/5 sm:w-85">
				<ScrollArea
					className="h-full min-h-0 w-full"
					scrollbarClassName="pr-0 border-l-0"
				>
					<nav
						ref={navRef}
						aria-label={label}
						className="flex w-full flex-col items-stretch p-4 text-left"
					>
						{toc.map((item) => {
							const active = item.id === activeId;
							return (
								<a
									key={item.id}
									href={`#${item.id}`}
									aria-current={active ? 'location' : undefined}
									className={cn(
										'w-full rounded-md px-2 py-0.5 hover:text-theme',
										item.level === 2
											? 'mt-2.5 text-base font-medium leading-6 first:mt-0'
											: 'mt-0.5 ml-3 text-sm leading-6',
										active
											? 'bg-theme/10 text-theme'
											: item.level === 2
												? 'text-textcolor'
												: 'text-textcolor/85',
									)}
									onClick={(e) => {
										e.preventDefault();
										setActiveId(item.id);
										scrollToHeading(item.id);
									}}
								>
									{item.text}
								</a>
							);
						})}
					</nav>
				</ScrollArea>
			</aside>

			<ScrollArea
				className="min-h-0 min-w-0 flex-1"
				viewportClassName="pb-1"
				onScroll={onBodyScroll}
			>
				{children}
			</ScrollArea>
		</div>
	);
}
