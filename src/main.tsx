import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { applyStandaloneBootFromSearch } from '@/utils/standaloneAppearance';
import App from './App';
import '@/styles.css';

// 独立打开时在 React 挂载前同步 ?theme= / ?lang=，避免首帧用错 hljs 主题与 github-markdown 浅色 token。
applyStandaloneBootFromSearch();

createRoot(document.getElementById('root')!).render(
	<StrictMode>
		<App />
	</StrictMode>,
);
