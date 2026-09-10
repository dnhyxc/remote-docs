import { useRef, type RefObject } from 'react';
import { NavigationProvider, browserPathname } from '@/router/NavigationContext';
import { AppRouter } from '@/router/AppRouter';
import { I18nProvider } from '@/i18n';
import { DocsStandaloneProvider } from '@/hooks/useDocsStandalone';
import {
	useHostLocale,
	useHostTheme,
	useStandaloneThemeFromSearch,
} from '@/hooks/useHostBridgeSync';
import type { HostBridgeProps } from '@/types/host';
import '@/styles.css';

type AppProps = Partial<Pick<HostBridgeProps, 'api' | 'plugin'>>;

const DOC_PATHS = new Set([
	'/home',
	'/update-info',
	'/project-guide',
	'/plugin-dev-guide',
]);

function BridgeSync({
	api,
	standalone,
	pluginRootRef,
}: {
	api?: HostBridgeProps['api'];
	standalone: boolean;
	pluginRootRef: RefObject<HTMLElement | null>;
}) {
	useHostLocale(api);
	useHostTheme(api, pluginRootRef);
	useStandaloneThemeFromSearch(standalone, pluginRootRef);
	return null;
}

/** 嵌入跟 routePath；独立站跟地址栏 pathname（外链打开用） */
function resolveInitialPath(props: AppProps, standalone: boolean): string {
	if (!standalone) {
		const routePath = props.plugin?.routePath;
		if (routePath && DOC_PATHS.has(routePath)) return routePath;
		return '/update-info';
	}
	const fromUrl = browserPathname();
	return DOC_PATHS.has(fromUrl) ? fromUrl : '/home';
}

/**
 * 文档 Remote 壳：三页内存路由。
 * 嵌入 Host → routePath；独立预览 / 外链 → 地址栏 path。
 */
function App(props: AppProps = {}) {
	const hasBridge = !!(props.api && props.plugin);
	const standalone = !hasBridge;
	const initialPath = resolveInitialPath(props, standalone);
	const pluginRootRef = useRef<HTMLDivElement>(null);

	return (
		<div
			ref={pluginRootRef}
			data-plugin-root
			className="bg-theme-background text-textcolor h-full min-h-0 w-full"
		>
			<I18nProvider>
				<DocsStandaloneProvider standalone={standalone}>
					<BridgeSync
						api={props.api}
						standalone={standalone}
						pluginRootRef={pluginRootRef}
					/>
					<NavigationProvider
						initialPath={initialPath}
						syncBrowserUrl={standalone}
					>
						<AppRouter
							bridge={hasBridge ? (props as HostBridgeProps) : undefined}
						/>
					</NavigationProvider>
				</DocsStandaloneProvider>
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
