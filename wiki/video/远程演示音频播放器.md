# remote-demo 插件新增多音频连续播放

## 1. 背景与目标

为 remote-demo 插件添加多音频连续播放功能，演示如何在 Module Federation 远程插件中集成多媒体组件，实现三段音频的自动连续播放、进度跟踪和手动跳转。

## 2. 改动范围

- `apps/remote-demo/src/App.tsx`：新增音频播放器集成逻辑
- `apps/remote-demo/package.json`：新增 `less` 依赖
- `apps/remote-demo/tsconfig.json`：新增类型声明和排除规则

## 3. 实现思路

1. 使用 `useRef` 引用 AudioPlayer 组件实例，实现外部控制（跳转）
2. 使用 `useState` 追踪当前播放的音频段落索引
3. 使用 `useMemo` 缓存音频轨道数据，避免重复创建
4. 通过 `useCallback` 稳定回调函数引用，传递给子组件
5. AudioPlayer 组件内部处理音频播放状态、进度累计和自动切轨

## 4. 关键代码对比与注释

### 4.1 `App` 组件（`apps/remote-demo/src/App.tsx`）

**对比范围**：整个 `App` 组件，从函数签名到返回 JSX。

**改动前** · `apps/remote-demo/src/App.tsx`（基线）

```typescript
// HostBridgeProps 类型定义：插件与 Host 通信的 API 接口
type HostBridgeProps = {
	// 翻译函数，用于国际化
	api: {
		t: (key: string, params?: Record<string, unknown>) => string;
		// 当前主题模式：亮色或暗色
		theme: 'light' | 'dark';
		// 导航函数，跳转指定路由
		navigate: (to: string) => void;
		// 事件系统：订阅、取消订阅、触发事件
		event: {
			on: (event: string, handler: (data?: unknown) => void) => void;
			off: (event: string, handler: (data?: unknown) => void) => void;
			emit: (event: string, data?: unknown) => void;
		};
		// UI 工具函数：显示 Toast 提示
		ui?: { showToast: (options: { message: string }) => void };
	};
	// 插件元信息：ID、版本、路由路径
	plugin: { id: string; version: string; routePath: string };
};

// App 组件：remote-demo 插件的主入口
export default function App({ api, plugin }: HostBridgeProps) {
	// 返回插件根容器，显示基本信息和一个测试按钮
	return (
		<div
			// 插件 ID 作为类名，便于样式隔离和调试
			className={`plugin-${plugin.id}`}
			style={{
				padding: 24,
				minHeight: '100%',
				fontFamily: 'ui-sans-serif, system-ui, sans-serif',
			}}
		>
			<h1 style={{ fontSize: 28, marginBottom: 8 }}>Remote Demo</h1>
			<p style={{ opacity: 0.75, marginBottom: 16 }}>
				// 显示插件 ID、版本和当前主题
				MF 插件页 · {plugin.id}@{plugin.version} · theme={api.theme}
			</p>
			<button
				type="button"
				// 点击时通过 HostBridge 调用主站的 Toast 功能
				onClick={() =>
					api.ui?.showToast({ message: `hello from ${plugin.id}` })
				}
				style={{
					padding: '8px 14px',
					borderRadius: 8,
					border: '1px solid #ccc',
					cursor: 'pointer',
				}}
			>
				通过 HostBridge 弹 Toast
			</button>
		</div>
	);
}

// 激活钩子：插件加载时调用，此处无额外逻辑
export async function activate() {
	// ponytail: demo 无需额外激活逻辑
}

// 停用钩子：插件卸载时调用，此处无清理逻辑
export async function deactivate() {
	// ponytail: demo 无需清理
}
```

**改动后** · `apps/remote-demo/src/App.tsx`（当前，约 L1–L105）

```typescript
// 引入 React hooks：useCallback 用于稳定回调引用，useMemo 用于缓存计算结果
// useRef 用于引用 DOM 或组件实例，useState 用于管理状态
import { useCallback, useMemo, useRef, useState } from 'react';
// 引入三个音频文件资源
import AUDIO1 from './assets/audios/audio1.m4a';
import AUDIO2 from './assets/audios/audio2.m4a';
import AUDIO3 from './assets/audios/audio3.m4a';
// 引入 AudioPlayer 组件及其类型定义
import AudioPlayer, {
	// 播放器实例的类型定义，用于外部控制
	type MultiAudioPlayerHandle,
	// 单条音频轨道的数据结构类型
	type TrackItem,
} from './components/AudioPlayer';

// HostBridgeProps 类型定义保持不变
type HostBridgeProps = {
	api: {
		t: (key: string, params?: Record<string, unknown>) => string;
		theme: 'light' | 'dark';
		navigate: (to: string) => void;
		event: {
			on: (event: string, handler: (data?: unknown) => void) => void;
			off: (event: string, handler: (data?: unknown) => void) => void;
			emit: (event: string, data?: unknown) => void;
		};
		ui?: { showToast: (options: { message: string }) => void };
	};
	plugin: { id: string; version: string; routePath: string };
};

// App 组件：新增音频播放器功能
export default function App({ api, plugin }: HostBridgeProps) {
	// playerRef：引用 AudioPlayer 组件实例，用于外部调用 jumpTrack 方法
	const playerRef = useRef<MultiAudioPlayerHandle>(null);
	// active：当前播放的音频段落索引，从 0 开始
	const [active, setActive] = useState(0);
	// updateActived：更新当前段落索引的回调函数，通过 useCallback 稳定引用
	const updateActived = useCallback((i: number) => setActive(i), []);

	// tracksData：音频轨道数据，通过 useMemo 缓存避免每次渲染重复创建
	const tracksData = useMemo<TrackItem[]>(
		// 返回三条音频轨道的数据数组
		() => [
			{ audioFileUrl: AUDIO1 },
			{ audioFileUrl: AUDIO2 },
			{ audioFileUrl: AUDIO3 },
		],
		// 依赖数组为空，表示只在组件首次渲染时创建一次
		[],
	);

	return (
		<div
			className={`plugin-${plugin.id}`}
			style={{
				padding: 24,
				minHeight: '100%',
				fontFamily: 'ui-sans-serif, system-ui, sans-serif',
			}}
		>
			<h1 style={{ fontSize: 28, marginBottom: 8 }}>Remote Demo</h1>
			<p style={{ opacity: 0.75, marginBottom: 16 }}>
				MF 插件页 · {plugin.id}@{plugin.version} · theme={api.theme}
			</p>
			{/* 新增：音频播放器区域 */}
			<section style={{ marginBottom: 24 }}>
				<p style={{ opacity: 0.75, marginBottom: 12, fontSize: 14 }}>
					{/* 显示当前播放段落信息 */}
					三段音频连续播放 · 进度按累计时长 · 当前第 {active + 1} 段
				</p>
				{/* AudioPlayer 组件：传入播放器引用、轨道数据和段落更新回调 */}
				<AudioPlayer
					ref={playerRef}
					tracksData={tracksData}
					updateActived={updateActived}
				/>
				{/* 手动跳转按钮组 */}
				<div style={{ marginTop: 12, display: 'flex', gap: 8 }}>
					{/* 遍历三条轨道，生成对应的跳转按钮 */}
					{[0, 1, 2].map((i) => (
						<button
							key={i}
							type="button"
							// 点击时调用播放器实例的 jumpTrack 方法跳转到指定段落
							onClick={() => playerRef.current?.jumpTrack(i)}
							style={{
								padding: '4px 10px',
								borderRadius: 6,
								border: '1px solid #ccc',
								cursor: 'pointer',
								// 当前激活段落使用红色背景，其他使用白色背景
								background: active === i ? '#c8152d' : '#fff',
								color: active === i ? '#fff' : '#333',
							}}
						>
							跳到第 {i + 1} 段
						</button>
					))}
				</div>
			</section>
			{/* 原有按钮保持不变 */}
			<button
				type="button"
				onClick={() =>
					api.ui?.showToast({ message: `hello from ${plugin.id}` })
				}
				style={{
					padding: '8px 14px',
					borderRadius: 8,
					border: '1px solid #ccc',
					cursor: 'pointer',
				}}
			>
				通过 HostBridge 弹 Toast
			</button>
		</div>
	);
}

export async function activate() {
	// ponytail: demo 无需额外激活逻辑
}

export async function deactivate() {
	// ponytail: demo 无需清理
}
```

**变更摘要**：
- 新增 `useRef`、`useState`、`useMemo`、`useCallback` hooks 实现音频播放器的状态管理和外部控制
- 新增 `AudioPlayer` 组件集成，支持多音频连续播放、进度累计和手动跳转
- 新增三条音频轨道数据，通过 `useMemo` 缓存
- 新增段落指示和跳转按钮组，提升用户交互体验

### 4.2 `package.json`（`apps/remote-demo/package.json`）

**对比范围**：devDependencies 部分。

**改动前** · `apps/remote-demo/package.json`（基线）

```json
"devDependencies": {
    "@types/react": "^19.1.8",
    "@types/react-dom": "^19.1.6",
    "@vitejs/plugin-react": "^4.6.0",
    "typescript": "~5.8.3",
    "vite": "^7.0.4"
}
```

**改动后** · `apps/remote-demo/package.json`（当前）

```json
"devDependencies": {
    "@types/react": "^19.1.8",
    "@types/react-dom": "^19.1.6",
    "@vitejs/plugin-react": "^4.6.0",
    "less": "^4.7.0",
    "typescript": "~5.8.3",
    "vite": "^7.0.4"
}
```

**变更摘要**：新增 `less` 依赖，用于支持 AudioPlayer 组件的样式处理。

### 4.3 `tsconfig.json`（`apps/remote-demo/tsconfig.json`）

**对比范围**：compilerOptions 和 include/exclude 部分。

**改动前** · `apps/remote-demo/tsconfig.json`（基线）

```json
{
    "compilerOptions": {
        "target": "ES2020",
        "useDefineForClassFields": true,
        "lib": ["ES2020", "DOM", "DOM.Iterable"],
        "module": "ESNext",
        "skipLibCheck": true,
        "moduleResolution": "bundler",
        "allowImportingTsExtensions": true,
        "resolveJsonModule": true,
        "isolatedModules": true,
        "noEmit": true,
        "jsx": "react-jsx",
        "strict": true
    },
    "include": ["src"]
}
```

**改动后** · `apps/remote-demo/tsconfig.json`（当前）

```json
{
    "compilerOptions": {
        "target": "ES2020",
        "useDefineForClassFields": true,
        "lib": ["ES2020", "DOM", "DOM.Iterable"],
        "module": "ESNext",
        "skipLibCheck": true,
        "moduleResolution": "bundler",
        "allowImportingTsExtensions": true,
        "resolveJsonModule": true,
        "isolatedModules": true,
        "noEmit": true,
        "jsx": "react-jsx",
        "strict": true,
        "types": ["vite/client"]
    },
    "include": ["src"],
    "exclude": ["src/components/old.tsx"]
}
```

**变更摘要**：
- 新增 `types: ["vite/client"]`，支持 Vite 的环境变量类型提示
- 新增 `exclude: ["src/components/old.tsx"]`，排除旧组件文件不参与编译

## 5. 兼容性与影响

- **向后兼容**：原有 Toast 按钮功能保持不变
- **样式隔离**：音频播放器样式由 Host 侧 `@scope` 自动隔离，不影响主站
- **资源加载**：音频文件通过 Vite 静态资源导入，构建时自动处理

## 6. 相关源码路径

| 说明 | 路径 |
| ---- | ---- |
| 主组件 | `apps/remote-demo/src/App.tsx` |
| 音频播放器组件 | `apps/remote-demo/src/components/AudioPlayer` |
| 音频资源 | `apps/remote-demo/src/assets/audios/` |
| 包配置 | `apps/remote-demo/package.json` |
| TypeScript 配置 | `apps/remote-demo/tsconfig.json` |

---

（若与仓库最新源码不一致，以源码为准）