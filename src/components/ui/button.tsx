import { Slot } from '@radix-ui/react-slot';
import { cva, type VariantProps } from 'class-variance-authority';
import * as React from 'react';
import { cn } from '@/lib/utils';
import { Spinner } from './spinner';

const buttonVariants = cva(
	"cursor-pointer text-textcolor inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium transition-all disabled:cursor-not-allowed disabled:opacity-50 [&_svg]:pointer-events-none [&_svg:not([class*='size-'])]:size-4 shrink-0 [&_svg]:shrink-0 outline-none focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px] aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 aria-invalid:border-destructive",
	{
		variants: {
			variant: {
				default: 'text-white bg-teal-500/80 hover:bg-teal-500',
				destructive:
					'bg-destructive text-white hover:bg-destructive/90 focus-visible:ring-destructive/20 dark:focus-visible:ring-destructive/40 dark:bg-destructive/60',
				outline:
					'border border-teal-500/80 bg-teal-500/10 text-textcolor shadow-xs hover:bg-teal-500/20 dark:bg-input/30 dark:border-input dark:hover:bg-input/50',
				secondary: 'bg-teal-500/20 text-textcolor hover:bg-teal-500/30',
				ghost: 'hover:bg-teal-500/10 hover:text-textcolor',
				link: 'text-textcolor underline-offset-4 hover:text-teal-500',
				loading: 'bg-teal-500/30 hover:bg-teal-500/30',
			},
			size: {
				default: 'h-9 px-4 py-2 has-[>svg]:px-3 pb-2.5',
				sm: 'h-8 rounded-md gap-1.5 px-3 has-[>svg]:px-2.5',
				lg: 'h-10 rounded-md px-6 has-[>svg]:px-4',
				icon: 'size-9',
				'icon-sm': 'size-8',
				'icon-lg': 'size-10',
			},
		},
		defaultVariants: {
			variant: 'default',
			size: 'default',
		},
	},
);

function Button({
	className,
	variant = 'default',
	size = 'default',
	asChild = false,
	children,
	...props
}: React.ComponentProps<'button'> &
	VariantProps<typeof buttonVariants> & {
		asChild?: boolean;
	}) {
	const Comp = asChild ? Slot : 'button';

	const content =
		variant === 'loading' ? (
			<>
				<Spinner className="text-textcolor size-4" />
				{children}
			</>
		) : (
			children
		);

	return (
		<Comp
			data-slot="button"
			data-variant={variant}
			data-size={size}
			className={cn(buttonVariants({ variant, size, className }))}
			{...props}
		>
			{content}
		</Comp>
	);
}

export { Button, buttonVariants };
