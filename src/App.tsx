import { NavigationProvider } from '@/router/NavigationContext';
import { AppRouter } from '@/router/AppRouter';
import { I18nProvider } from '@/i18n';
import {
	useHostLocale,
	useHostTheme,
} from '@/hooks/useHostBridgeSync';
import type { HostBridgeProps } from '@/types/host';
import '@/styles.css';

type AppProps = Partial<Pick<HostBridgeProps, 'api' | 'plugin'>>;

function BridgeSync({ api }: { api?: HostBridgeProps['api'] }) {
	useHostLocale(api);
	useHostTheme(api);
	return null;
}

/**
 * 文档 Remote 壳：三页内存路由。
 * 嵌入 Host → 默认 /update-info；独立预览 → /home。
 */
function App(props: AppProps = {}) {
	const hasBridge = !!(props.api && props.plugin);
	const initialPath = hasBridge ? '/update-info' : '/home';

	return (
		<div
			data-plugin-root
			className="bg-theme-background text-textcolor h-full min-h-0 w-full"
		>
			<I18nProvider>
				<BridgeSync api={props.api} />
				<NavigationProvider initialPath={initialPath}>
					<AppRouter
						bridge={hasBridge ? (props as HostBridgeProps) : undefined}
					/>
				</NavigationProvider>
			</I18nProvider>
		</div>
	);
}

type HostApi = HostBridgeProps['api'];

App.activate = async (api: HostApi) => {
	console.log('[remoteDocs] activate', {
		locale: api.locale,
		theme: api.theme,
	});
};

App.deactivate = () => {
	console.log('[remoteDocs] deactivate');
};

export default App;
