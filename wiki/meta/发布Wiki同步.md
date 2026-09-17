# 发布流水线：GitHub Wiki 同步（Update-Info）

本文说明：在桌面发布产物完成后，如何自动将 `docs/项目更新信息.md` 的内容同步到 GitHub Wiki 页面 [Update-Info](https://github.com/dnhyxc/dnhyxc-ai/wiki/Update-Info)。

---

## 1. 背景与目标

- **目标**：每次发布后，Wiki 的 `Update-Info` 页面与仓库内 `docs/项目更新信息.md` 保持一致。
- **约束**：GitHub Wiki 是独立 Git 仓库（`<repo>.wiki.git`）。相较 REST 直接写正文，**通过 Git push 更新页面更稳定**、也更符合 Wiki 的工作方式。

---

## 2. 实现思路

核心流程：

1. 读取源文件：`docs/项目更新信息.md`。
2. 在系统临时目录（`os.tmpdir()`）创建临时工作区。
3. 浅克隆（`--depth 1`）Wiki 仓库 `https://github.com/<owner>/<repo>.wiki.git`。
4. 将源文件内容写入 Wiki 仓库中的 `Update-Info.md`（slug `Update-Info` 对应的文件名）。
5. 若内容相同则跳过提交；否则 `git add` → `git commit` → `git push`。
6. `finally` 清理临时目录，避免残留。

---

## 3. 脚本入口与发布链路

### 3.1 脚本文件

- 脚本：`packages/release-run/src/wiki/sync-wiki-update-info.ts`
- 仓库相对路径：`packages/release-run/src/lib/paths.ts`（导出 `DOC_PROJECT_UPDATE_INFO`、`SCRIPTS_ROOT` 等，供各脚本共用）
- pnpm 脚本：`packages/release-run/package.json` 的 `sync-wiki-update-info`

### 3.2 发布链路接入

仓库根目录 `package.json` 中与 Wiki 同步相关的脚本（`scripts` 字段；行号随变更略有漂移）：

```json
"update-wiki": "pnpm -C apps/frontend exec release-kit wiki-sync-update-info"
```

（若需直接调用 `packages/release-run` 内脚本，可使用：`pnpm --filter @dnhyxc-ai/release-run sync-wiki-update-info`。）

桌面完整发布链路见 `build` / `build:patch` 等；Wiki 同步可通过 **`pnpm update-wiki`** 单独执行（或在 CI 中接在 `upload-to-release` 之后）。

手动同步（便于本地或 CI）：

- `pnpm update-wiki`

---

## 4. 环境变量

| 变量 | 说明 |
|------|------|
| `GITHUB_TOKEN` | 必需。用于克隆/推送 Wiki。与 `upload-to-release` 复用（PAT：Personal Access Token，个人访问令牌）。 |
| `SKIP_WIKI_SYNC=1` / `true` | 跳过本次 Wiki 同步。 |
| `WIKI_OWNER` / `WIKI_REPO` | 目标仓库。默认回退 `dnhyxc` / `dnhyxc-ai`，也可继承 `OWNER` / `APP_REPO`。 |
| `WIKI_UPDATE_INFO_FILE` | Wiki 页面文件名，默认 `Update-Info.md`。 |
| `WIKI_GIT_AUTHOR_NAME` / `WIKI_GIT_AUTHOR_EMAIL` | 可选。写入 commit 作者信息；缺省有兜底。 |

---

## 5. 关键代码说明（带行号定位）

### 5.1 Wiki clone URL 的 token 写法

文件：`packages/release-run/src/wiki/sync-wiki-update-info.ts`（约 L38–L41）

```ts
function wikiCloneUrl(): string {
	const t = encodeURIComponent(TOKEN ?? '');
	return `https://x-access-token:${t}@github.com/${OWNER}/${REPO}.wiki.git`;
}
```

- **为何 `encodeURIComponent`**：减少 token 中特殊字符导致 URL 解析异常的概率。
- **为何 `x-access-token`**：GitHub 支持这种形式在 HTTPS URL 内携带 token。

### 5.2 `runGit`：统一封装 git 子进程（关键：禁止交互式输入）

文件：`packages/release-run/src/wiki/sync-wiki-update-info.ts`（约 L18–L36）

```ts
function runGit(
	cwd: string,
	args: string[],
	extraEnv?: Record<string, string>,
): { ok: boolean; stderr: string } {
	// 使用 spawnSync：脚本型任务，失败即中断，便于顺序控制与错误输出
	const res = spawnSync('git', args, {
		cwd,
		encoding: 'utf-8',
		// 关键：禁止 git 在认证失败时弹交互提示（CI / 非交互环境必须）
		env: { ...process.env, ...extraEnv, GIT_TERMINAL_PROMPT: '0' },
	});
	const stderr = (res.stderr ?? '').trim();
	if (res.status !== 0) {
		return {
			ok: false,
			stderr: stderr || `git ${args.join(' ')} 退出码 ${res.status}`,
		};
	}
	return { ok: true, stderr };
}
```

### 5.3 主流程：clone → 写入 → commit → push（含“无变化跳过”）

文件：`packages/release-run/src/wiki/sync-wiki-update-info.ts`（约 L43 起至文件末尾的 `main`）

```ts
function main(): number {
	// 0) 可选：本地/CI 按需跳过
	if (process.env.SKIP_WIKI_SYNC === '1' || process.env.SKIP_WIKI_SYNC === 'true') {
		console.log('⏭️  已设置 SKIP_WIKI_SYNC，跳过 Wiki 同步');
		return 0;
	}

	// 1) 必要条件：Token + 源文件存在
	if (!TOKEN) {
		console.error('❌ 未设置 GITHUB_TOKEN，无法推送 Wiki');
		return 1;
	}
	if (!fs.existsSync(SOURCE_MD)) {
		console.error(`❌ 源文件不存在: ${SOURCE_MD}`);
		return 1;
	}

	// 2) 读取源 Markdown（作为 Wiki 页面正文）
	const body = fs.readFileSync(SOURCE_MD, 'utf-8');

	// 3) 使用临时目录作为工作区：避免污染仓库、也避免并发任务互相影响
	const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'dnhyxc-wiki-sync-'));
	const wikiDir = path.join(tmpRoot, 'repo');

	try {
		// 4) 浅克隆 Wiki 仓库（只取最近一次提交）
		const clone = runGit(tmpRoot, ['clone', '--depth', '1', wikiCloneUrl(), wikiDir]);
		if (!clone.ok) return 1;

		// 5) “无变化跳过”：避免生成无意义的 Wiki commit
		const targetPath = path.join(wikiDir, WIKI_PAGE_FILE);
		const prev = fs.existsSync(targetPath) ? fs.readFileSync(targetPath, 'utf-8') : null;
		if (prev === body) {
			console.log('✅ Wiki 内容与源文件一致，无需提交');
			return 0;
		}

		// 6) 写入页面文件（Update-Info.md）
		fs.writeFileSync(targetPath, body, 'utf-8');

		// 7) 提交作者信息：用 git -c 覆盖，避免依赖机器全局 git config
		const authorName = process.env.WIKI_GIT_AUTHOR_NAME ?? 'dnhyxc-ai-release-run';
		const authorEmail = process.env.WIKI_GIT_AUTHOR_EMAIL ?? 'dnhyxc-ai-sync@users.noreply.github.com';

		// 8) add / commit / push
		if (!runGit(wikiDir, ['add', WIKI_PAGE_FILE]).ok) return 1;
		const commit = runGit(
			wikiDir,
			[
				'-c',
				`user.name=${authorName}`,
				'-c',
				`user.email=${authorEmail}`,
				'commit',
				'-m',
				'docs: 同步项目更新总览（项目更新信息.md）',
			],
		);
		if (!commit.ok) {
			// commit 阶段仍可能出现“nothing to commit”，这里做一次容错
			if (/nothing to commit|无文件要提交|没有需要提交的/i.test(commit.stderr)) {
				console.log('✅ 无变更需要提交');
				return 0;
			}
			return 1;
		}
		if (!runGit(wikiDir, ['push', 'origin', 'HEAD']).ok) return 1;

		console.log('✅ Wiki 已更新: Update-Info');
		return 0;
	} finally {
		// 9) 必做：清理临时目录
		// 注意：这里必须用 finally；并且主流程不要到处 process.exit()，否则可能跳过清理
		try {
			fs.rmSync(tmpRoot, { recursive: true, force: true });
		} catch {
			// 清理失败不影响已推送成功的结果
		}
	}
}
```

> 说明：上面代码块是对源码的“结构化摘录 + 注释解释”，便于理解意图；最终执行逻辑仍以 `packages/release-run/src/wiki/sync-wiki-update-info.ts` 与 `packages/release-run/src/lib/paths.ts` 为准。

---

## 6. 常见问题

### 6.1 为什么不用 REST API 直接更新 Wiki？

- Wiki 的页面最终还是落在 `*.wiki.git` 的 Git 历史里；用 Git 更新更直观、也更好排查（可直接看 commit / diff）。

### 6.2 本地运行但不想动 Wiki

使用：

```bash
SKIP_WIKI_SYNC=1 pnpm build
```

