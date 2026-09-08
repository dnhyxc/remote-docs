import * as ScrollAreaPrimitive from '@radix-ui/react-scroll-area';
import * as React from 'react';

import { cn } from '@/lib/utils';

type ScrollAreaScrollbars = 'vertical' | 'horizontal' | 'both';

export type ScrollAreaProps = React.PropsWithChildren<
	Omit<React.ComponentProps<typeof ScrollAreaPrimitive.Root>, 'children'> & {
		viewportClassName?: string;
		scrollbarClassName?: string;
		onScroll?: React.UIEventHandler<HTMLDivElement>;
		scrollbars?: ScrollAreaScrollbars;
	}
>;

const ScrollArea = React.forwardRef<HTMLDivElement, ScrollAreaProps>(
	(
		{
			className,
			children,
			viewportClassName,
			scrollbarClassName,
			onScroll,
			scrollbars = 'vertical',
			...props
		},
		ref,
	) => {
		const showVertical = scrollbars === 'vertical' || scrollbars === 'both';
		const showHorizontal =
			scrollbars === 'horizontal' || scrollbars === 'both';

		return (
			<ScrollAreaPrimitive.Root
				data-slot="scroll-area"
				className={cn(
					'relative min-w-0 overflow-hidden border-0 border-transparent bg-transparent',
					className,
				)}
				{...props}
			>
				<ScrollAreaPrimitive.Viewport
					ref={ref}
					data-slot="scroll-area-viewport"
					className={cn(
						'focus-visible:ring-ring/50 size-full max-w-full min-w-0 rounded-[inherit] transition-[color,box-shadow] outline-none focus-visible:ring-[3px] focus-visible:outline-1',
						'[&>div]:flex! [&>div]:min-h-full! [&>div]:min-w-full! [&>div]:flex-col!',
						viewportClassName,
					)}
					onScroll={onScroll}
				>
					{children}
				</ScrollAreaPrimitive.Viewport>
				{showVertical ? <ScrollBar className={scrollbarClassName} /> : null}
				{showHorizontal ? (
					<ScrollBar
						orientation="horizontal"
						className={scrollbarClassName}
					/>
				) : null}
				<ScrollAreaPrimitive.Corner />
			</ScrollAreaPrimitive.Root>
		);
	},
) as React.ForwardRefExoticComponent<
	ScrollAreaProps & React.RefAttributes<HTMLDivElement>
>;

ScrollArea.displayName = 'ScrollArea';

function ScrollBar({
	className,
	orientation = 'vertical',
	...props
}: {
	className?: string;
	orientation?: 'vertical' | 'horizontal';
} & React.ComponentProps<typeof ScrollAreaPrimitive.ScrollAreaScrollbar>) {
	return (
		<ScrollAreaPrimitive.ScrollAreaScrollbar
			data-slot="scroll-area-scrollbar"
			orientation={orientation}
			className={cn(
				'flex touch-none transition-colors select-none',
				orientation === 'vertical' &&
					'pr-px h-full w-2 border-l border-l-transparent',
				orientation === 'horizontal' &&
					'h-1.5 flex-col border-t border-t-transparent',
				className,
			)}
			{...props}
		>
			<ScrollAreaPrimitive.ScrollAreaThumb
				data-slot="scroll-area-thumb"
				className="bg-theme-border relative flex-1 rounded-full"
			/>
		</ScrollAreaPrimitive.ScrollAreaScrollbar>
	);
}

export { ScrollArea, ScrollBar };
