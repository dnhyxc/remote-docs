import { Home } from 'lucide-react';
import { Button } from '@/components/ui';
import { useI18n } from '@/i18n';
import { useNavigation } from '@/router/NavigationContext';

/** 文档顶栏左侧：回首页（内存路由） */
export function DocHomeButton() {
	const { t } = useI18n();
	const { navigate, path } = useNavigation();
	if (path === '/home') return null;
	return (
		<Button
			type="button"
			variant="ghost"
			size="icon-sm"
			className="shrink-0 text-textcolor/70 hover:text-textcolor"
			title={t('nav.home')}
			aria-label={t('nav.home')}
			onClick={() => navigate('/home')}
		>
			<Home className="size-4" strokeWidth={2} />
		</Button>
	);
}
