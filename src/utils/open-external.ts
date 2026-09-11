/**
 * 在系统浏览器或新标签页打开链接。
 * 嵌入桌面 Host 时与 Host 同 WebView，优先 Tauri opener；否则 window.open。
 *
 * 与 markdown-kit `patchExternalLinksOpenBlank`（渲染层补 target=_blank）互补：
 * MF 嵌桌面时 `_blank` 进不了系统浏览器，须配合下方点击拦截。
 * 场景表：主仓 `docs/tools/外链新标签打开.md` §5；本仓 `docs/app/外链系统浏览器打开.md`。
 */
export async function openExternalUrl(url: string): Promise<void> {
	if (!url) return;
	const internals = (
		window as Window & {
			__TAURI_INTERNALS__?: {
				invoke?: (cmd: string, args?: Record<string, unknown>) => Promise<unknown>;
			};
		}
	).__TAURI_INTERNALS__;
	if (typeof internals?.invoke === 'function') {
		try {
			await internals.invoke('plugin:opener|open_url', { url });
			return;
		} catch {
			// opener 不可用时回退
		}
	}
	window.open(url, '_blank', 'noopener,noreferrer');
}

/**
 * 拦截 Markdown 正文外链点击：preventDefault 后走 openExternalUrl。
 * - 页内 `#` 锚点不拦截，交给浏览器 / 宿主滚动。
 * - MF 嵌桌面 Host 时勿删：仅靠 kit 的 target=_blank 不够。
 */
export function attachExternalLinkClickInterceptor(
	container: HTMLElement,
): () => void {
	const onClickCapture = (e: MouseEvent) => {
		const target = e.target as HTMLElement | null;
		if (!target) return;
		const a = target.closest<HTMLAnchorElement>('.markdown-body a');
		if (!a || !container.contains(a)) return;

		const href = a.getAttribute('href')?.trim() ?? '';
		if (!href || href.startsWith('#')) return;

		e.preventDefault();
		e.stopPropagation();
		void openExternalUrl(href);
	};

	container.addEventListener('click', onClickCapture, true);
	return () => container.removeEventListener('click', onClickCapture, true);
}
