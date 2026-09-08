import { Tooltip, TooltipContent, TooltipTrigger } from '@ui/index';

interface IProps {
	children: React.ReactNode;
	content: React.ReactNode | string;
	side?: 'left' | 'top' | 'bottom' | 'right';
	/** 相对触发器的对齐；默认 center */
	align?: 'start' | 'center' | 'end';
	sideOffset?: number;
	delayDuration?: number;
	disabled?: boolean;
	className?: string;
	/** 传给 Radix Root：指针移入浮层不保持展开（列表行内小按钮建议开启） */
	disableHoverableContent?: boolean;
	/** 是否显示主题色外阴影；默认关闭 */
	shadow?: boolean;
	/** 受控展开（可选） */
	open?: boolean;
	onOpenChange?: (open: boolean) => void;
}

const TooltipSide: React.FC<IProps> = ({
	children,
	content,
	side = 'top',
	align = 'center',
	sideOffset = 4,
	delayDuration,
	disabled = false,
	className,
	disableHoverableContent,
	shadow = false,
	open,
	onOpenChange,
}) => {
	// 当 content 为空、disabled 为 true 或 children 无效时，直接返回 children
	if (!content || disabled || !children) {
		return <>{children}</>;
	}

	return (
		<Tooltip
			delayDuration={delayDuration}
			disableHoverableContent={disableHoverableContent}
			open={open}
			onOpenChange={onOpenChange}
		>
			<TooltipTrigger asChild>{children}</TooltipTrigger>
			<TooltipContent
				side={side}
				align={align}
				sideOffset={sideOffset}
				shadow={shadow}
				className={className}
			>
				{content}
			</TooltipContent>
		</Tooltip>
	);
};

export default TooltipSide;
