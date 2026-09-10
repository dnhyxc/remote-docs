/**
 * 独立打开时在 React 挂载前同步 ?theme= / ?lang=，
 * 避免首帧用错 hljs 主题与 github-markdown 浅色 token。
 */
export function applyStandaloneBootFromSearch(): void {
	if (typeof window === 'undefined') return;
	const params = new URLSearchParams(window.location.search);
	const theme = params.get('theme');
	const dark = theme === 'black' || theme === 'dark';
	const root = document.documentElement;
	root.classList.toggle('dark', dark);
	root.dataset.theme = dark ? 'dark' : 'light';
	root.style.colorScheme = dark ? 'dark' : 'light';
	const lang = params.get('lang');
	if (lang === 'zh-CN' || lang === 'en-US') {
		root.lang = lang === 'en-US' ? 'en' : 'zh-CN';
	}
}
