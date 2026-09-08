import {
	createContext,
	useCallback,
	useContext,
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

export function NavigationProvider({
	children,
	initialPath = '/home',
}: {
	children: ReactNode;
	initialPath?: string;
}) {
	const [path, setPath] = useState(initialPath);

	const navigate = useCallback((to: string) => {
		setPath(to);
	}, []);

	return (
		<NavigationContext.Provider value={{ path, navigate }}>
			{children}
		</NavigationContext.Provider>
	);
}

export function useNavigation() {
	return useContext(NavigationContext);
}
