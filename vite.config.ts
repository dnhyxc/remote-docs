import fs from 'node:fs';
import path from 'node:path';
import { federation } from '@module-federation/vite';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig, loadEnv, type Plugin } from 'vite';

/** MF mf_owner id 递增后 .vite/deps 会失效，serve 时清缓存 */
function clearMfViteDepCache(): Plugin {
	return {
		name: 'clear-mf-vite-dep-cache',
		enforce: 'pre',
		config(config, { command }) {
			if (command !== 'serve') return;
			const root = config.root ? path.resolve(config.root) : process.cwd();
			fs.rmSync(path.join(root, 'node_modules/.vite'), {
				recursive: true,
				force: true,
			});
		},
	};
}

const host = '127.0.0.1';
const port = 9013;
const devOrigin = `http://${host}:${port}`;

export default defineConfig(({ mode }) => {
	const env = loadEnv(mode, process.cwd(), '');
	const origin = env.VITE_REMOTE_PUBLIC_ORIGIN || devOrigin;
	const reactRefreshHost =
		env.VITE_REACT_REFRESH_HOST || 'http://127.0.0.1:9002';

	return {
		base: `${origin}/`,
		cacheDir: path.resolve(__dirname, '.vite-cache'),
		plugins: [
			clearMfViteDepCache(),
			react({
				reactRefreshHost,
			}),
			tailwindcss(),
			federation({
				name: 'remoteDocs',
				filename: 'remoteEntry.js',
				manifest: true,
				exposes: {
					'./App': './src/index.ts',
				},
				shared: {
					react: { singleton: true, requiredVersion: '^19.1.0' },
					'react-dom': { singleton: true, requiredVersion: '^19.1.0' },
				},
				hostInitInjectLocation: 'entry',
				dts: false,
				dev: {
					remoteHmr: true,
				},
			}),
		],
		resolve: {
			alias: {
				'@': path.resolve(__dirname, 'src'),
			},
		},
		optimizeDeps: {
			exclude: [
				'react',
				'react/jsx-runtime',
				'react/jsx-dev-runtime',
				'react-dom',
				'react-dom/client',
			],
		},
		server: {
			host,
			port,
			strictPort: true,
			origin: devOrigin,
			cors: true,
			headers: {
				'Access-Control-Allow-Origin': '*',
			},
		},
		preview: {
			host,
			port,
			strictPort: true,
			cors: true,
		},
		build: {
			target: 'esnext',
			modulePreload: false,
			minify: false,
		},
	};
});
