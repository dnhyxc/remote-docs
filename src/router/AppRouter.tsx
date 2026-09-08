import type { HostBridgeProps } from '@/types/host';
import { useNavigation } from '@/router/NavigationContext';
import HomePage from '@/views/home/HomePage';
import UpdateInfoPage from '@/views/updateInfo';
import ProjectGuidePage from '@/views/projectGuide';
import PluginDevGuidePage from '@/views/pluginDevGuide';

export function AppRouter({ bridge }: { bridge?: HostBridgeProps }) {
	const { path } = useNavigation();
	void bridge;

	switch (path) {
		case '/update-info':
			return <UpdateInfoPage />;
		case '/project-guide':
			return <ProjectGuidePage />;
		case '/plugin-dev-guide':
			return <PluginDevGuidePage />;
		case '/home':
		default:
			return <HomePage />;
	}
}
