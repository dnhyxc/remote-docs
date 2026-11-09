import type { HostBridgeProps } from '@/types/host';
import { useNavigation } from '@/router/NavigationContext';
import HomePage from '@/views/home/HomePage';
import UpdateInfoPage from '@/views/updateInfo';
import ProjectGuidePage from '@/views/projectGuide';
import PluginDevGuidePage from '@/views/pluginDevGuide';
import ServicePolicyPage from '@/views/servicePolicy';
import UserAgreementPage from '@/views/userAgreement';

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
		case '/service-policy':
			return <ServicePolicyPage />;
		case '/user-agreement':
			return <UserAgreementPage />;
		case '/home':
		default:
			return <HomePage />;
	}
}
