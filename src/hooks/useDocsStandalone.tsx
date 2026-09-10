import { createContext, useContext, type ReactNode } from 'react';

const DocsStandaloneContext = createContext(true);

/** 独立预览 / 外链为 true；Host 嵌入为 false */
export function DocsStandaloneProvider({
	standalone,
	children,
}: {
	standalone: boolean;
	children: ReactNode;
}) {
	return (
		<DocsStandaloneContext.Provider value={standalone}>
			{children}
		</DocsStandaloneContext.Provider>
	);
}

export function useDocsStandalone() {
	return useContext(DocsStandaloneContext);
}
