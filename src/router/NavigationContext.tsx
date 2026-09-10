import {
	createContext,
	useCallback,
	useContext,
	useEffect,
	useState,
	type ReactNode,
} from 'react';

interface NavigationContextValue {
	path: string;
	navigate: (to: string) => void;
}

const NavigationContext = createContext<NavigationContextValue>({
	path: '/home',
	navigate: () => {},
});

function browserPathname(): string {
	if (typeof window === 'undefined') return '/home';
	const p = window.location.pathname.replace(/\/$/, '') || '/';
	return p === '/' ? '/home' : p;
}

function writeBrowserUrl(to: string) {
	if (typeof window === 'undefined') return;
	const url = new URL(window.location.href);
	url.pathname = to === '/home' ? '/' : to;
	window.history.pushState(null, '', url.toString());
}

export function NavigationProvider({
	children,
	initialPath = '/home',
	/** 独立预览时同步地址栏，便于外链打开 /update-info 等 */
	syncBrowserUrl = false,
}: {
	children: ReactNode;
	initialPath?: string;
	syncBrowserUrl?: boolean;
}) {
	const [path, setPath] = useState(initialPath);

	const navigate = useCallback(
		(to: string) => {
			setPath(to);
			if (syncBrowserUrl) writeBrowserUrl(to);
		},
		[syncBrowserUrl],
	);

	useEffect(() => {
		if (!syncBrowserUrl) return;
		const onPop = () => setPath(browserPathname());
		window.addEventListener('popstate', onPop);
		return () => window.removeEventListener('popstate', onPop);
	}, [syncBrowserUrl]);

	return (
		<NavigationContext.Provider value={{ path, navigate }}>
			{children}
		</NavigationContext.Provider>
	);
}

export function useNavigation() {
	return useContext(NavigationContext);
}

export { browserPathname };
