export type HostLocale = 'zh-CN' | 'en-US';

export interface HostBridgeProps {
	api: {
		theme: 'light' | 'dark';
		locale?: HostLocale;
		navigate: (to: string) => void;
		event: {
			on: (event: string, handler: (data?: unknown) => void) => void;
			off: (event: string, handler: (data?: unknown) => void) => void;
			emit: (event: string, data?: unknown) => void;
		};
		ui?: {
			showToast?: (config: {
				message: string;
				type?: 'info' | 'success' | 'warning' | 'error';
				title?: string;
			}) => void;
		};
	};
	plugin: {
		id: string;
		name?: string;
		version: string;
		description?: string;
		routePath?: string;
	};
}
