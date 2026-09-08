import { Fan } from 'lucide-react';

import { cn } from '@/lib/utils';

function Spinner({ className, ...props }: React.ComponentProps<'svg'>) {
	return (
		<Fan
			role="status"
			aria-label="Loading"
			className={cn('size-5 animate-spin text-default', className)}
			{...props}
		/>
	);
}

export { Spinner };
