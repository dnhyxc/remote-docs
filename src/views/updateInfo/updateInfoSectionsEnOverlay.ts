/**
 * 更新信息独立页的英文正文（与 updateInfoSections.ts 中章节/条目 id 一一对应）。
 * 维护中文主数据时，请同步补齐此处映射。
 */

export const UPDATE_INFO_INTRO_EN =
	'This page summarizes core capabilities and recent improvements so you can quickly see what is new or better. The content is product-level and focuses on user-visible behavior. We do not list internal file or directory paths here—implementation details live alongside the source in topic-specific notes you can search after cloning the repo.';

/** 章节标题（key = section.id） */
export const UPDATE_INFO_SECTION_TITLES_EN: Record<string, string> = {
	s1: '1. Releases & updates',
	s2: '2. Account & access control',
	s3: '3. Desktop app & browser',
	s4: '4. Chat (Chatbot)',
	s5: '5. Markdown toolkit & rendering',
	s6: '6. Knowledge base (editor, list, local mode)',
	s7: '7. Monaco editor improvements',
	s8: '8. Charts & code block UX',
	s9: '9. System settings & usability',
	s10: '10. UI components & experience',
	s11: '11. Desktop voice input & transcription (Tauri)',
	s12: '12. Internationalization (UI language)',
	s13: '13. Knowledge base RAG & multi-session assistant',
	s14: '14. Sharing, public reading & chat architecture',
	s15: '15. Monaco & Markdown advanced (summary)',
	s16: '16. Desktop clipboard & layout',
	s17: '17. Deployment, gateway & operations',
	s18: '18. @dnhyxc-ai/markdown-kit & fenced-block parsing',
	s19: '19. Metadata & documentation conventions',
	s20: '20. About dialog & standalone legal pages',
	s21: '21. Release notes standalone page (structured UI)',
	s22: '22. Product guide page & home entry',
	s23: '23. Home “Quick start” & sign-up entry',
	s24: '24. English learning (vocabulary packs, quotes & favorites)',
	s25: '25. E-books (bookshelf & reader)',
};

/** 条目标题与描述（key = bullet.id） */
export const UPDATE_INFO_BULLETS_EN: Record<
	string,
	{ title: string; description: string }
> = {
	's1-1': {
		title: 'Public update page refreshes after release',
		description:
			'After a production build is published, the update-info page refreshes to the latest content automatically, reducing manual upkeep and omissions. Local-only validation can skip the sync step via a flag. (Pending commit.)',
	},
	's1-2': {
		title: 'GitHub Release DMG upload script',
		description:
			'upload-dmg-to-release (pnpm upload-dmg at repo root) uploads the Tauri-built .dmg to the same GitHub Release as upload-to-release (e.g. latest tag), using GITHUB_TOKEN, OWNER, APP_REPO, and related env vars. By default it picks the newest .dmg by mtime from the DMG build output folder; override via CLI arg or DMG_PATH.',
	},
	's2-1': {
		title: 'Route-level login guard',
		description:
			'Unauthenticated visits to protected routes are redirected to the login page; public routes are unaffected.',
	},
	's2-2': {
		title: 'Auth expiry handling',
		description:
			'When the API returns 401 Unauthorized, the session is cleared consistently and re-login is triggered, avoiding “looks logged in but is actually expired” drift.',
	},
	's2-3': {
		title: 'Public route policy',
		description:
			'When logged out you can still open home, login, about, share links, the knowledge base (local-only by default—see Section 6), settings and its subpaths, the desktop download landing page, the product guide, legal policies, agreements, and this structured update page. Chat and other signed-in flows stay behind the guard; standalone public routes match Sections 21–22.',
	},
	's2-4': {
		title: 'Avatar storage on Tencent Cloud COS',
		description:
			'Profile avatars and chat attachments are uploaded through the server to Tencent Cloud COS, replacing Qiniu direct upload and local uploads storage. Full object URLs are saved after upload. On the web, objects use the same-origin /ext-cos/ proxy. Preview and downloads are adapted for COS with success/failure toasts. Deployments need COS credentials and readable objects (public-read or equivalent).',
	},
	's2-5': {
		title: 'Stripe membership billing (three plans)',
		description:
			'After sign-in, open /pay to choose Monthly (¥9.9), Quarterly (¥25.9), or Annual (¥99.9)—fixed prices, not editable—via Stripe embedded checkout. Successful payment activates or extends membership (stacked from the current expiry) and redirects to /profile for badge and validity. When membership expires, profile/login reflects non-member state with upgrade guidance.',
	},
	's2-6': {
		title: 'Clear local cache on account switch',
		description:
			'When you sign out, sign in with another account, or the session ends with 401 in the same browser tab, client-side display cache for the previous account is cleared—including unsaved knowledge drafts, document assistant and RAG chats, English learning Agent threads, in-progress vocabulary/classic streams, the ebook bookshelf list, and MOKE reader assistant state—so you do not see another user’s content. Updating profile or membership for the same user id does not trigger a reset.',
	},
	's2-7': {
		title: 'Profile membership badge styling',
		description:
			'On /profile, active members see a high-contrast gold “Member” badge and gold “Valid until …” line for easier reading on dark backgrounds. Membership detection is unified on the client and stays aligned with LLM default presets for members vs non-members.',
	},
	's2-8': {
		title: 'Membership grant idempotency fix',
		description:
			'Fixes duplicate membership duration when Stripe webhook and checkout completion ran concurrently (e.g. monthly plan showing about one extra month). New payments no longer stack twice; contact support if a past account was over-credited.',
	},
	's2-9': {
		title: 'Fix sign-in immediately logging you out',
		description:
			'After cloud TTS preferences were synced to your account, some users were sent back to the login page right after a successful sign-in while background sync ran without credentials. Login order and member-only prefetch are adjusted so the session stays active in production.',
	},
	's2-10': {
		title: 'Password fields support plaintext toggle',
		description:
			'Password fields on the login, register, and forgot-password pages now have an eye icon on the right. Click it to toggle between hidden and plaintext, so you can see and fix typos without deleting the whole thing. The toggle button itself is skipped when tabbing, so keyboard navigation stays fast.',
	},
	's2-11': {
		title: 'Faster form filling with Tab key',
		description:
			'Global Tab navigation now jumps only between input fields (text inputs, textareas, select dropdowns, etc.) and skips buttons, links, and other non-input controls. Combine with Enter to submit forms—greatly speeds up login, register, and similar flows. Buttons and links still work normally with clicks.',
	},
	's2-12': {
		title: 'WeChat Mini Program login & account linking',
		description:
			'New one-tap login via WeChat Mini Program—sign up and log in with your WeChat account, no need to type a username and password. You can also link an existing Web account: generate a 6-digit link code in the Web account settings, then enter it in the mini program. Bookshelf, reading progress, highlights, and thoughts all sync across both sides. You can unlink anytime from the Web side, and all WeChat-login sessions are immediately revoked.',
	},
	's2-13': {
		title: 'Unified logout & multi-window theme sync',
		description:
			'Logout from the sidebar menu, File menu, or 401 session-expiry all run the same cleanup routine—local cache, session state, and UI consistently return to the signed-out state, with no residual state after logging out from the menu. When you switch the theme color scheme, all open desktop child windows (e.g. the About window) update in sync, so child windows no longer mismatch the main window theme.',
	},
	's2-14': {
		title: 'Demo account pre-fill & protection',
		description:
			"A demo test account is available—visit the homepage with a special query parameter and the login page auto-fills the username and password (password shown as masked dots, inspecting elements won't leak the real password) for one-tap login. Once logged in as the test account, modifying profile, purchasing membership, resetting password, and binding/unbinding WeChat are disabled; the email on the profile page is masked (e.g. d•••e@xx.com) to prevent tampering. When the env vars are not configured, this feature does not affect regular users.",
	},
	's2-15': {
		title: 'Unified profile route',
		description:
			'Profile, account settings, and membership payment are now unified under /profile/*. You can enter profile editing or membership payment directly from the personal homepage without navigating to separate pages. Old /account and /pay links automatically redirect to the new paths.',
	},
	's2-16': {
		title: 'Payment page layout optimization',
		description:
			'The membership payment page adapts to the new profile route shell—content scrolls within the page when overflowing, no longer spills or gets clipped. The redundant header and badges are removed; copy is more concise (e.g. "Start payment" instead of "Open checkout in page"); overall visuals are cleaner.',
	},
	's3-1': {
		title: 'One frontend for desktop and browser',
		description:
			'The same frontend runs in the desktop shell (Tauri) and in a standalone browser.',
	},
	's3-2': {
		title: 'Capability degradation & hints',
		description:
			'In the browser, desktop-only features such as folder pickers, launch at login, and global shortcuts degrade to hints instead of crashing or blanking the page.',
	},
	's3-3': {
		title: 'Consistent external-link policy',
		description:
			'External links behave consistently and safely across environments (fewer unnecessary permissions and context leaks).',
	},
	's3-4': {
		title: 'macOS production: allow specific HTTP hosts',
		description:
			'App Transport Security (ATS) in Info.plist can allow selected http hosts so production builds can reach those resources.',
	},
	's3-5': {
		title: 'Tauri / browser parity',
		description:
			'Mind init order, capability degradation, and link policy so browser-only environments do not hit desktop-only APIs and white-screen.',
	},
	's3-6': {
		title: 'Desktop auto-retry on transient network failures',
		description:
			'On Tauri desktop, when a remote API call fails with a transient no-response network error (not only list loading), the app briefly retries before showing an error—fewer false “network error, please check your connection” toasts. Browser behavior is unchanged.',
	},
	's3-7': {
		title: 'Dynamic remote feature modules',
		description:
			'The host app can load independently deployed feature modules at runtime from a registry (sharing the host UI shell). On load failure the UI shows a stable message with manual retry—no flicker loops. Some demo entries may appear in the sidebar depending on registry config.',
	},
	's3-8': {
		title: 'Plugin center & enable/disable (shelf toggle)',
		description:
			'A new Plugin Center page lists every available module as a card with a switch. Toggle it on to enable (publish) a module—state is persisted to your account and takes effect immediately: the sidebar entry appears and the module is usable. Toggle it off to disable (unpublish)—the entry disappears and any open page is unloaded. A registry editor page (sign-in required) lets you view and edit the raw module list (JSON); saving it reloads the configuration automatically. Added: in the registry editor title bar you can set a module icon—upload an SVG for a chosen module, and the sidebar/trigger icon fields are written automatically; monochrome custom icons follow the host selected color and hover stroke animation, without changing host code.',
	},
	's3-9': {
		title: 'Plugin UI follows host language',
		description:
			'Remote plugin UIs (including Learning Notes and Ideas List) now switch between Chinese and English to match the host app’s interface language. Changes take effect immediately without reloading the plugin. Standalone preview mode also has a manual language toggle. Added: Plugin Center card titles/descriptions and header breadcrumbs now resolve from the plugin’s own multilingual registry, no longer depending on the host’s built-in copy; adding or renaming a plugin only requires editing the registry.',
	},
	's3-10': {
		title: 'More reliable desktop plugin updates',
		description:
			'After publishing a new module version, the desktop app picks up the latest code from changes in the module’s own entry manifest—no need to edit the platform module list just to bust cache; the module list itself is also no longer long-cached. If you still see an old version, update to the latest desktop app and try again.',
	},
	's3-11': {
		title: 'Plugin Center blank-screen fix',
		description:
			'Fixes a blank Plugin Center page in some production environments caused by a broken router context.',
	},
	's3-12': {
		title: 'Safer registry editing',
		description:
			'The registry page adds a field help entry; saving checks each module’s Host API compatibility range so mistaken edits do not break loading. Supports ⌘/Ctrl+S; an orange dot on the save control indicates unsaved changes.',
	},
	's3-13': {
		title: 'Plugin enablement persisted to account & synced across devices',
		description:
			"When you toggle a feature module on or off in the Plugin Center, the preference is saved to your account on the server, not only to the local browser. Sign in from another device, switch between the web and desktop app, or sign out and back in on the same machine—your enabled/disabled choices stay the same. Without a preference (e.g. new accounts) everything is off by default, so the sidebar or home screen is not crowded with unfamiliar entries. Switching accounts automatically re-mounts or removes sidebar entries to match the new user's preference, no manual refresh required.Any enablement history saved only to local storage in older versions is migrated once to your account on first sign-in, so you do not have to re- configure.If the Plugin Center or registry fails to load, the page now shows a more specific reason—network, expired credentials, malformed registry, or other internal error—so you can try reconnecting or re - signing in before contacting support.",
	},
	's3-14': {
		title: 'macOS window zoom: no white flash',
		description:
			'Fixes the white flash on macOS desktop when double-clicking the title bar or clicking the green zoom button—the page content could not keep up with the window resize. The page is now pre-laid-out to the target size before the window unveils it, so the transition is smooth with no "shell grew but content stayed small" white gap.',
	},
	's3-15': {
		title: 'System menu & keyboard-shortcut framework',
		description:
			"The macOS desktop menu bar now has full File, Edit, and other system menus with zh/en labels and unified SF Symbols icons. After changing a shortcut in Settings, the menu-bar accelerator updates immediately—no restart needed. Global shortcuts auto-release when the window loses focus (except Show/Hide App), so they no longer hijack other apps' shortcuts. In-page and global shortcuts are managed together; conflicts are caught at recording time.",
	},
	's3-16': {
		title: 'Video player plugin',
		description:
			'A new standalone video player module is now available. Enable it in the Plugin Center and a TV-icon entry appears in the sidebar—just drop or pick local video files to play. Supports multi-file playlist selection, a custom control bar (progress, volume, playback rate, Picture-in-Picture, fullscreen, mirror), 0.5X–3.0X speed control with keyboard arrow keys, and play modes (auto / loop / stop). The player is auto-cleaned on unmount to avoid leaving the host in theater mode. The player has also been refactored into reusable components—player body, upload, tooltips, segmented controls, and volume can now be reused by other features. The playback-rate panel and tick labels now use theme tokens, so they stay readable in both light and dark themes. Tooltips on controls now work consistently in both the standalone preview and the host-mounted plugin page.',
	},
	's3-17': {
		title: 'Plugin theater fullscreen & 404 flash prevention',
		description:
			'When a plugin such as the video player enters fullscreen, the host sidebar, header, and ICP footer all hide to create a true theater mode. On Tauri the app window is taken to system-level fullscreen; in the browser it falls back to document-level fullscreen; pressing Esc exits theater mode automatically. The previously visible 404 flash when refreshing a plugin route (e.g. /video-player, /plugins) is also fixed: the page now shows a theme-colored placeholder until the plugin is ready, then swaps directly to the plugin page without a NotFound flash.',
	},
	's3-18': {
		title: 'Video player experience enhancements',
		description:
			'Building on the component refactor, the video player gets several interaction upgrades: progress-bar thumbnail preview—hovering anywhere on the progress bar pops up a thumbnail of that frame so you can quickly locate clips, with automatic edge clearance to avoid overflow; cross-platform Picture-in-Picture—PiP now works on Safari (macOS / iOS) and other browsers, with a clear overlay shown in the main player area when PiP is active, and play/pause actions inside the PiP window sync correctly back to the main player; player language follows the host—switching the UI language now also switches the player’s internal hints (buffering, etc.) to the matching language; more thorough reset—clicking Reset now fully clears the preview, progress bar, hover state, and player instance, leaving no PiP overlay behind; long-video ruler optimization—ruler tick nodes for videos over 10 minutes are capped to avoid stuttering when hovering the progress bar. Drag-to-scrub now settles cleanly: when you release the progress bar, the player briefly holds the scrub position until the seek completes, eliminating the "right jitter" where the bar briefly jumped back to the current playback position; the mini timeline under the controls also updates in real time while dragging. Loop mode now works for a single-item playlist too—when only one video is loaded and loop is enabled, the player restarts the same video from the end instead of doing nothing. Outside theater mode the player background now follows the current theme (including user-picked accent colors) instead of staying xgplayer’s default black. The control bar’s fade in/out now uses visibility instead of opacity, so the backdrop-filter (frosted glass) no longer lags behind the video when the bar appears.',
	},
	's3-19': {
		title: 'macOS fullscreen exit zero-latency sync',
		description:
			'Fixes the visual misalignment where the sidebar and header would disappear "one step late" when exiting fullscreen on macOS via the green traffic-light button or the window menu "Enter Full Screen" option, causing the shell layer to be visible during the resize animation. Now the macOS native system notifies the frontend to collapse theater mode before the resize animation begins, ensuring the sidebar and header remain hidden throughout the entire resize process, perfectly matching the experience of pressing Esc. When entering fullscreen, the system also debounces the entrance animation to prevent false exit triggers.',
	},
	's3-20': {
		title: 'Untrusted plugins follow host theme and accent color',
		description:
			'Untrusted feature modules running in isolated iframes now follow the host theme (light/dark) and accent color in real time—switching the host "Settings → Accent color" or light/dark theme instantly updates button, link, and border colors inside the iframe, so the plugin UI no longer looks out of sync with the host. Also fixes an issue where outline-button borders disappeared in dark mode (caused by mistakenly adding .dark and triggering dark-mode border utilities). Route-switching white-screen freezes on desktop and duplicate handshakes under React Strict Mode are also resolved, and Tab-key focus is no longer hijacked by the host.',
	},
	's3-21': {
		title: 'Plugin Center split into Plugins / Apps with card refactor',
		description:
			'The Plugin Center now has two tabs at the top—"Plugins" and "Apps"—that auto-classify modules by type: business-embedded modules (e.g. ebook reader plugins that auto-mount inside a business page) go under "Plugins", while standalone-route modules (e.g. the video player with its own page entry) go under "Apps". Each tab shows a count badge and has its own empty state. Cards are refactored into a three-section layout: the header adds an icon (preferring the SVG icon from the registry, falling back to a puzzle/app-window icon by type), title, and version; the middle shows the description; the footer shows route, sidebar presence, and trust level (e.g. "untrusted" with a Chinese gloss) in a single truncated line. App-type cards also get an "Open" button in the footer—once enabled, you can jump straight to the page without hunting for the sidebar entry.',
	},
	's3-22': {
		title: 'Plugin registry writes restricted to Super Admins only',
		description:
			'The write channel for plugin registry JSON manifests is now restricted to Super Admin accounts. Regular signed-in users can no longer overwrite manifests via API, nor do they see the "Edit Registry" button in the Plugin Center header. After auth, the server still runs the original structural validations and Host API compatibility checks, so Super Admins keep the exact same save experience as before.',
	},
	's3-23': {
		title: 'Light-theme borders and body ink fixed',
		description:
			'Fixes two light-theme visual issues: soft borders on side drawers, cards, and modals were completely invisible (like pure white blocks floating on a white background), and body text in some scenarios was nearly white-on-white. Now all semi-transparent borders (e.g. around Sheet drawers and card edges) get a soft ink outline in light theme, and body text always reads clearly. Dark theme is unaffected, and the Hero gradient title on the home stage still renders its original white-gradient effect.',
	},
	's3-24': {
		title: 'No more white flash when switching plugin pages',
		description:
			'Further fixes a brief white flash seen when entering or switching to untrusted plugin pages in dark theme — during the handshake phase the iframe used to flash the browser default white background. The plugin container now paints the host theme background first, then seamlessly hands off once the plugin is ready, eliminating the white flash entirely.',
	},
	's4-1': {
		title: 'Streaming chat (SSE)',
		description:
			'Supports streaming generation, stop, and continuation for smoother conversation.',
	},
	's4-2': {
		title: 'Sessions & history',
		description:
			'Create sessions, list and query history, update, and delete sessions.',
	},
	's4-3': {
		title: 'Branches & regenerate',
		description:
			'Conversations support tree-shaped branches and regenerate flows; share read-only views keep message order and layout aligned with online reading even in complex branch cases (complements Section 14 and the message-order fix).',
	},
	's4-4': {
		title: 'Shared conversation message order fix',
		description:
			'Fixes incorrect message order on share pages for more consistent reading.',
	},
	's4-5': {
		title: 'Web search & citations',
		description:
			'Supports web retrieval with citation metadata for traceability.',
	},
	's4-6': {
		title: 'Attachments & OCR',
		description:
			'Attachment handling and OCR improve multimodal input usability.',
	},
	's4-7': {
		title: 'Async persistence & reliability',
		description:
			'Queues (e.g. BullMQ) improve message persistence reliability and scalability.',
	},
	's4-8': {
		title: 'Desktop chat input: voice & stop-recording policy',
		description:
			'On the Tauri client, the bottom input supports text/voice modes, live dictation, and stop-recording cleanup; after stop, no second full-audio transcription pass is sent—see Section 11 for details.',
	},
	's4-9': {
		title: 'Unified chat model backend',
		description:
			'Main Chat now uses the SiliconFlow OpenAI-compatible API by default (GLM-5.1 family). Streaming, stop, continue, and branching behave the same on your side.',
	},
	's4-10': {
		title: 'Chat attachment image preview fix',
		description:
			'Fixes failed image preview after upload on web and desktop (Chinese filenames, cross-port blocking, misconfigured gateways). On production web, attachments load via the same site API route instead of a separate static image path; message payloads use on-disk filenames for OCR. Deploy both frontend and backend and restart; legacy direct /images/ URLs may still need gateway fixes.',
	},
	's4-11': {
		title: 'Image attachment text recognition',
		description:
			'Before you send a message with image attachments, the server uses a Zhipu vision model to extract on-screen text and scene description, then passes that to the chat model. This step is independent of the chat model you pick in Settings. Self-hosted deployments must configure a Zhipu API credential on the server; otherwise image attachments may not be understood correctly.',
	},
	's4-12': {
		title: 'Long chats and attachment parsing stability',
		description:
			'Fixes server memory growth and crashes with multi-turn chats that include PDF/Excel attachments, and fixes broken Stop or mid-reply cutoffs when sending two messages in quick succession. Parsed attachment text is cached per path with size limits; very long sessions only send recent turns to the model.',
	},
	's4-13': {
		title: 'Horizontal scroll for code blocks during streaming',
		description:
			'Fixes fenced code blocks in assistant messages that could not be scrolled sideways reliably while the reply was still streaming—including after the closing fence when the model kept writing prose below. Copy, download, and the code toolbar behave as before.',
	},
	's4-14': {
		title: 'Text Selection Preserved During Streaming',
		description:
			'When selecting text in AI assistant messages during streaming output (chat, knowledge assistant, English learning Agent), your selection is now preserved as new tokens arrive — you can continue highlighting or copying while the model generates.',
	},
	's4-15': {
		title: 'Selection Speak Now Supports System Media Keys',
		description:
			'When using the select-and-speak feature on assistant messages, macOS Touch Bar / Control Center play-pause buttons now control selection speak playback, matching the audiobook behavior.',
	},
	's4-16': {
		title: 'New "Speak Content" Button on Assistant Message Actions',
		description:
			'A new read-aloud button appears in the message actions bar for assistant messages in the English Learning Agent and Ebook MOKE assistant — tap it to speak the entire message without first selecting text. Reuses the same TTS pipeline and floating control bar as selection speak, with play/pause, stop, and speed controls.',
	},
	's4-17': {
		title: 'Unified send button visuals for chat and assistant',
		description:
			'The send buttons in the main chat input and the knowledge-base assistant input now share one visual style — a lighter tinted gradient with a soft ring, less harsh in dark themes and better matched to card backgrounds. The stop-generation button and the desktop voice input-mode menu (hover to expand, leave to close after a delay, tap to send) keep their existing interactions. The two buttons were previously duplicated with slightly different styles; they now converge into one component so future style changes apply in sync.',
	},
	's5-1': {
		title: 'Markdown rendering',
		description:
			'Common Markdown syntax and rich output with pragmatic error tolerance.',
	},
	's5-2': {
		title: 'Math',
		description:
			'KaTeX rendering with errors isolated so the rest of the page still renders.',
	},
	's5-3': {
		title: 'Syntax highlighting & themes',
		description:
			'highlight.js with theme switching for different reading preferences.',
	},
	's5-4': {
		title: 'Task lists',
		description: 'GitHub Flavored Markdown (GFM) task list rendering.',
	},
	's5-5': {
		title: 'Mermaid diagrams',
		description: 'Mermaid rendering and runtime handling for richer documents.',
	},
	's5-6': {
		title: 'Markdown rendering hardening',
		description:
			'Raw HTML is disabled by default (e.g. <script> is escaped as text), reducing XSS risk when mounting via innerHTML/dangerouslySetInnerHTML; enable HTML explicitly with sanitization if needed.',
	},
	's6-1': {
		title: 'Cloud & local modes',
		description:
			'Manage cloud knowledge entries or use a local folder as the library source.',
	},
	's6-2': {
		title: 'Logged-out: local only',
		description:
			'When logged out, local mode is default and cloud APIs are not called; irrelevant entry points (e.g. trash) are hidden.',
	},
	's6-3': {
		title: 'Local folder management',
		description:
			'Recursive Markdown scan, read/save/delete, and open in an external editor.',
	},
	's6-4': {
		title: 'Delete branching: local / online / both',
		description:
			'When a cloud item matches a located local file on desktop, the delete dialog offers delete local, delete online, or both—preserving prior “both” behavior for existing users.',
	},
	's6-5': {
		title: 'Auto-save (debounced)',
		description:
			'Debounced auto-save reduces write churn and aligns with explicit overwrite semantics to avoid accidental overwrites.',
	},
	's6-6': {
		title: 'In-page chord shortcuts',
		description:
			'Chord shortcuts in the knowledge base for save, clear, open list, toggle action bar, etc.',
	},
	's6-7': {
		title: 'Trash open & clear: editor session state',
		description:
			'Opening from trash keeps snapshots aligned with body and correct Diff baselines; “new / clear draft” refreshes the editor session id to match list-open-then-clear, avoiding stuck split-diff views.',
	},
	's6-8': {
		title: 'Doc assistant: pin bottom/top & hidden when logged out',
		description:
			'When logged in, the bottom document assistant is available; the thread supports jump to bottom or back to top (same idea as Markdown preview badges) for long streaming replies; hidden when logged out.',
	},
	's6-9': {
		title: 'Assistant streaming across documents',
		description:
			'Fixes losing streaming state after switching documents/routes and back; improves the edge case when first save happens mid-stream to avoid wrong termination or incomplete session binding.',
	},
	's6-10': {
		title: 'Assistant input menu follows UI language',
		description:
			'Knowledge-base assistant bottom input aligns with Section 12 UI language; labels such as input mode switch with zh/en; pairs with Section 11 desktop voice.',
	},
	's6-11': {
		title: 'Local directory & editor sync',
		description:
			'Folder scan, disk writes, editor buffer, and list state stay aligned; logged-out local-only policy matches earlier Section 6 items.',
	},
	's6-12': {
		title: 'Send selection to the document assistant',
		description:
			'In the knowledge-base Markdown editor you can send the current selection to the bottom document assistant for AI or RAG prompts; overlapping or duplicate sends are deduped to reduce noisy context.',
	},
	's6-13': {
		title: 'Outline TOC prepended with a level-2 heading',
		description:
			'After “Generate outline” in Knowledge AI mode, the TOC is inserted with a “## 目录” heading; if the doc already has anchor links or a non-standard TOC title at the top, only the heading is added or normalized; if “## 目录” is already present, you are notified and nothing is duplicated.',
	},
	's6-14': {
		title: 'Knowledge assistant streaming UX',
		description:
			'AI-mode assistant streaming no longer shows a collapsible “thinking process” block; the loading spinner beside “Generating…” animates correctly, aligned with main Chat behavior.',
	},
	's6-15': {
		title: 'Format before Knowledge save',
		description:
			'Manual save and debounced auto-save run the same document formatter as in the editor (including safe fenced-code handling) before writing to cloud or local storage.',
	},
	's6-16': {
		title: 'Knowledge vector indexing reliability',
		description:
			'Fixes cloud vectorization failures on save (e.g. HTTP 404 or invalid parameters) that blocked RAG retrieval; long articles and the default non-member embedding model now use shorter chunks per tier to reduce indexing errors.',
	},
	's6-17': {
		title: 'Knowledge RAG multi-collection search',
		description:
			'With custom vector settings enabled, Knowledge RAG searches all vector collections you have saved in parallel and always includes the system default bge collection, so older articles remain findable after you switch models; new saves still go to the currently selected collection.',
	},
	's6-18': {
		title: 'Site-wide BGE-only mode & indexing stability',
		description:
			'Super admins can enable “BGE vector collection only” on the LLM settings page; when on, all users index and retrieve via the system BGE collection and models. Fixes vectorization failures on long articles (including emoji) under site-wide BGE and oversized single upserts from small BGE chunks.',
	},
	's6-19': {
		title: 'Member default vector collection in RAG',
		description:
			'Active members who saved custom vector settings also get the member default Qwen3 vector collection merged into parallel RAG search, alongside their collections and the system bge collection, reducing missed hits in older data.',
	},
	's6-20': {
		title: 'Knowledge vector chunk boundary fix',
		description:
			'Fixes mid-word truncation when vectorizing long articles and code samples (e.g. console.log split into ole.log). Code blocks are split by line first, including closing ``` on the same line. Re-save existing articles to refresh stored chunks used in retrieval.',
	},
	's6-21': {
		title: 'Auto-focus assistant input after sending selection',
		description:
			'After copying selected Markdown text to the document assistant (context menu or ⌘/Ctrl+Shift+V), the assistant input is focused with the caret at the end of the inserted text so you can continue typing follow-up questions.',
	},
	's6-22': {
		title: 'CJK input fix after assistant auto-focus',
		description:
			'Fixes duplicated pinyin/Latin characters when typing in Chinese IME after auto-focus following copy-to-assistant; EPUB MOKE ask-about-selection prefills benefit as well.',
	},
	's6-23': {
		title: 'Knowledge save / vector indexing stability',
		description:
			'Fixes vector indexing failures (e.g. Invalid array length) or server crashes on some short or list-style Markdown saves. Chunking now always advances each iteration and caps pieces per article. Re-save affected articles if indexing failed before.',
	},
	's6-24': {
		title: 'Cloud save for long knowledge articles',
		description:
			'Fixes cloud knowledge saves failing when article body exceeded about 100KB. Saves now align with the per-article limit (about 5MB); long Markdown articles persist normally.',
	},
	's6-25': {
		title: 'Assistant keeps scroll position after streaming ends',
		description:
			'Fixes Knowledge doc assistant, ebook MOKE assistant, and English-learning Agent jumping to the bottom after streaming when you had scrolled up to read history. Scroll back to the bottom or tap “Scroll to bottom” to resume following new output.',
	},
	's6-26': {
		title: 'Smoother long-form Knowledge editing',
		description:
			'Improves typing responsiveness for long Markdown in edit-only mode; with the doc assistant open, title, body, and assistant input feel more responsive. Preview and split preview still render the full document after switching.',
	},
	's6-27': {
		title: 'Smoother preview + assistant together',
		description:
			'When the left Markdown preview or split view and the right doc assistant are both open during streaming replies, typing, scrolling, and the typewriter output feel more responsive. Preview may briefly show “Loading content…” while catching up, instead of a false empty state. Also reduces dual-pane scroll jank via FAB mode dedupe, cached parse for diagram-heavy docs, coalesced stick-to-bottom, and a hard-off path for the floating code toolbar. Further: very long docs with many code fences scroll more smoothly in preview-only mode (lighter floating code-toolbar work; copy/download and when the sticky bar appears stay the same). Complements §6 long-form editing and §7 preview/assistant panel behavior.',
	},
	's6-28': {
		title: 'Bidirectional scroll restore between preview and edit',
		description:
			'Switching between Markdown preview and edit in the knowledge base keeps your reading position when possible (including with the doc assistant open). Previously edit→preview was more reliable; preview→edit, or edit→preview with the assistant open, often jumped back to the top.',
	},
	's6-29': {
		title: 'Local knowledge base folder tree browsing',
		description:
			'Local knowledge base browsing is upgraded to an expandable folder tree: after selecting a local folder, the app automatically scans for Markdown files and builds a hierarchical tree structure that can be expanded/collapsed. Empty folders are filtered out, showing only paths with .md files. Folder rows support click-to-expand/collapse and keyboard Enter/Space operations; file rows are indented by level and can be edited in-app or opened in an external editor.',
	},
	's6-30': {
		title: 'Title search for knowledge list & trash',
		description:
			'A search box is added at the top of both the knowledge base list drawer and the trash drawer: type a document name keyword and press Enter to filter. In cloud mode the backend performs a case-insensitive title LIKE query; in local folder mode filtering is done in the frontend, and all folders containing matching files are automatically expanded. The trash drawer also supports title filtering. When no matches are found, a specific "No matching documents" hint is shown instead of the generic empty state.',
	},
	's6-31': {
		title: 'Knowledge base category management',
		description:
			'Cloud knowledge list adds a category tab bar and a "Manage categories" entry; supports creating, renaming, deleting, and reordering categories; documents can be assigned to a category or moved to Uncategorized. First use auto-seeds 5 default categories (different for zh/en), max 50. Deleting a category moves its documents to Uncategorized. Only owned documents can change category; others\' public documents cannot be moved. The manage dialog is a shared component used by both knowledge base and ebook shelf.',
	},
	's6-32': {
		title: 'Public-first sorting for knowledge & ebook lists',
		description:
			"In both the knowledge base list and the ebook shelf list, public items (including others' public) are always sorted to the top, with the original relative order preserved within each group (stable sort). Toggling visibility re-sorts the list immediately without a manual refresh.",
	},
	's6-33': {
		title: 'Ebook shelf: non-owned books cannot change category',
		description:
			'The "Move to category" menu on ebook shelf cards is only shown for books you can manage on your own shelf. Others\' public books and books on the public shelf no longer show the category move entry, preventing accidental operations.',
	},
	's6-34': {
		title: 'Ebook shelf: search by book title',
		description:
			'A search button is added to the shelf header bar; click it to expand a search input. Type a book title keyword and press Enter to filter both your shelf and the public shelf (case insensitive). Closing the search automatically clears the keyword and restores the full list. When no matches are found, a "No matching books" hint is shown. The page size is also reduced from 50 to 20 to lower initial load pressure.',
	},
	's6-35': {
		title: 'Ebook shelf sort order adjustment',
		description:
			'The shelf list sort order is changed from "public first" back to "most recently read first"; public books only rank higher when read times are equal.',
	},
	's6-36': {
		title: 'Ebook shelf "All" tab unified mixed paging',
		description:
			'The "All" tab previously sent two requests (owned + public) and merged in memory. Now the backend returns a single unified paged query, mixing owned and others\' public books by most recent reading time. Pagination totals are more accurate, append-loading no longer re-sorts on the frontend, and network overhead is reduced.',
	},
	's6-37': {
		title: 'Portal & Markdown font inheritance fix',
		description:
			'Fixes Portal components (Dialog/Drawer/Popover) using the browser default font instead of the app font (font-family moved from #root to body). Also overrides the hardcoded system font stack on Markdown preview area set by third-party CSS, so preview content uses the app font correctly.',
	},
	's6-38': {
		title: 'Unified button visuals for shelf & knowledge',
		description:
			'Icon buttons on the ebook shelf and knowledge list now have a unified hover stroke-draw animation. Import button tooltips changed from bottom to top. Import buttons are disabled during initial loading to prevent accidental clicks. Knowledge category tabs switched from ghost to link variant for a cleaner look. Category manage icon size unified to size-4.',
	},
	's6-39': {
		title: 'Knowledge "Public" tab and corrected "All" badge',
		description:
			'Added a "Public" tab in the cloud knowledge category tab bar (shown only when the count of others\' public docs is > 0). Clicking it only shows public documents owned by others; title search and scroll-to-load-more still work inside this tab. The count badge on the "All" tab now correctly equals your own total plus the others-public total, matching the documents that are actually browsable in the tab bar. The list API gained a scope query parameter ("all" vs. "public") with mutual-exclusion validation against categoryId/uncategorizedOnly; re-categorizing your own documents now also respects public-ownership flags so public and category filters stay consistent.',
	},
	's6-40': {
		title: 'Unified page-size constants for shelf and knowledge',
		description:
			'The duplicated default page size and scroll-load-threshold constants used by the ebook shelf and the knowledge list store have been consolidated into a single global constants export. The shelf-specific name is replaced by a generic default page size name so future changes cannot accidentally miss one consumer. Values are unchanged, so first-page counts and scroll-to-load-more behavior remain identical.',
	},
	's7-1': {
		title: 'IME (input method editor) compatibility',
		description:
			'Mitigations and practices for CJK IME ghosting/overlap issues in Monaco.',
	},
	's7-2': {
		title: 'Split preview scroll sync',
		description:
			'Editor and preview scroll in sync, including complex cases like chunked diagram rendering.',
	},
	's7-3': {
		title: 'Desktop layout stability',
		description:
			'Better measurement and reflow in desktop WebView to reduce jitter and misalignment.',
	},
	's7-4': {
		title: 'Clipboard & shortcut policy',
		description:
			'Avoids conflicts between editor shortcuts and plain inputs so copy/cut/paste stay reliable.',
	},
	's7-5': {
		title: 'Markdown split Diff',
		description:
			'Bottom bar toggles exclusive “left edit / right read-only Diff” vs “left edit / right preview”; compares against snapshot when the editor opened; distinguishes trivial empty diffs vs “deleted everything”; fixes session switching and model disposal ordering issues.',
	},
	's7-6': {
		title: 'Diff eligibility as shared utilities',
		description:
			'Whether Diff is allowed is centralized in helpers shared by bottom-bar disabled state and click handlers, reducing drift and enabling reuse.',
	},
	's7-7': {
		title: 'Diff & sticky scroll',
		description:
			'Diff and the main editor share sticky-scroll; sticky bar backgrounds align with global styles and theme tokens to reduce glass-theme tint issues.',
	},
	's7-8': {
		title: 'Preview/edit & document assistant panel',
		description:
			'Full-width preview without an empty right pane; with the assistant open, preview stays on the left in preview mode and the editor in edit mode; toggling preview/edit keeps the panel open and restores scroll position in both directions when possible (including edit→preview while the assistant is open).',
	},
	's8-1': {
		title: 'Mermaid interaction',
		description: 'Zoom and preview affordances for complex diagrams.',
	},
	's8-2': {
		title: 'Code block toolbar',
		description:
			'Friendlier actions (copy, download, etc.) in chat code blocks with better layout inside scroll containers.',
	},
	's9-1': {
		title: 'Shortcut conflict protection',
		description:
			'When recording shortcuts in settings, conflicts block save with a clear message; matching uses actual key chords (e.g. Command vs Meta normalization).',
	},
	's9-2': {
		title: 'Unified system toasts',
		description: 'Consistent toast styling for clearer errors and info.',
	},
	's9-3': {
		title: 'LLM settings in app',
		description:
			'New Settings → LLM page: save API Key, Base URL, and model name on the server. When enabled, chat, knowledge assistant, Q&A, and English learning share one config; Restore environment variables reverts to server defaults.',
	},
	's9-4': {
		title: 'LLM settings page UX',
		description:
			'Base URL and model name accept direct typing or presets (SiliconFlow / DeepSeek) via the button beside the field; choosing one preset pairs the other field. The footer active hint shows the current model name. A local default API Key may pre-fill on first visit; after save, the server copy applies.',
	},
	's9-5': {
		title: 'Per-account LLM settings and member defaults',
		description:
			'LLM API Key, Base URL, and model name in Settings are stored per signed-in account, not shared site-wide. Without custom config, active members default to SiliconFlow models and non-members to Zhipu GLM; presets include Zhipu GLM. Switching Base URL or model clears the API Key to avoid using the wrong provider key.',
	},
	's9-6': {
		title: 'LLM settings: save to enable',
		description:
			'Settings → LLM no longer has a separate “use custom LLM” switch. Fill API Key, Base URL, and model name, then Save to enable custom config; the footer shows the active model in green or the default model in gray. Restore default turns off custom config and reverts to member-based defaults. Unsaved edits or incomplete fields show hints and keep Save disabled.',
	},
	's9-7': {
		title: 'Vector model settings',
		description:
			'The LLM settings page adds a Vector model block below chat LLM: API Key, Embedding / Rerank endpoint URLs, embedding and rerank model names, and collection name—saved and restored separately from chat LLM. Each save records collections you have used; the page lists collections included in RAG search, which always also queries the system default bge collection.',
	},
	's9-8': {
		title: 'Vector settings save & form UX',
		description:
			'Fixes non–super-admin users being blocked when saving vector settings; endpoint labels now read “Vector model URL” and “Rerank model URL”; LLM and vector form rows use more consistent label width and alignment.',
	},
	's9-9': {
		title: 'LLM & vector Key echo and presets',
		description:
			'API Keys are no longer auto-filled from local build-time env; they echo only after you saved them in Settings and the API returns them. Switching chat or vector presets or linked vector model / rerank / collection fields no longer clears keys already entered; BGE and Qwen3 preset tiers keep the three vector fields paired.',
	},
	's9-10': {
		title: 'Configurable accent color',
		description:
			'Settings → Theme adds an “Accent color” section with 10 presets (default teal, lime, peach pink, indigo, ochre, xiang yellow, apricot, dai teal, pine flower, evergreen). Pick one and hover, selected, link, and button accents across the app update instantly; the choice is saved per signed-in account and syncs across devices. Refreshing or restarting no longer flashes back to the default color. Accent color is orthogonal to the color theme (white / dark / red / beige) and they can be combined freely. Decorative areas that are teal by design—home gradient buttons, English-learning sidebar gradients, and vocabulary-stream progress bars—keep the original teal and do not follow the accent color.',
	},
	's10-1': {
		title: 'Image component improvements',
		description:
			'Better behavior for desktop config and asset refresh, fewer anomalies and duplicate loads.',
	},
	's10-2': {
		title: 'Desktop input: dropdown trigger merged with primary',
		description:
			'Shared ChatEntry on Tauri merges the input-mode dropdown trigger with the primary focusable control so Radix owns expand state; hover menu vs click send/voice behavior unchanged.',
	},
	's10-3': {
		title: 'sendDisabled maintainability',
		description:
			'sendDisabled derived via useMemo and explicit branches with ?? false for optional booleans—same behavior, clearer code.',
	},
	's10-4': {
		title: 'Fix: clicking a label on one card toggled another card’s switch',
		description:
			'Fixed an issue in pages that show many cards with switches and adjacent labels (e.g. Plugin Center): clicking the label text next to a switch could accidentally toggle the very first card’s switch instead of the one next to the label—turning on the wrong plugin or turning off one you expected to stay on. Now each card’s label text is correctly paired with its own switch, and every switch on the same screen gets a stable, unique identity, even when there are dozens of switches in a list.',
	},
	's10-5': {
		title: 'Home hero stage card & focus carousel refactor',
		description:
			'The home first screen is split from a single inline block into two reusable components: a Stage Card (shell) and a Focus Carousel (content). The shell manages the top brand bar, the near-scene main content area, the bottom watermark, and the bottom entry bar. Moving the mouse into the card tilts it slightly toward the cursor (3D rotation) while the top bar, bottom bar, near-scene, and watermark shift by different amounts in the opposite direction, creating layered parallax. Tilt is throttled via requestAnimationFrame and respects the system “reduce motion” preference and IntersectionObserver visibility checks—no wasted computation when off-screen or when reduced motion is on. The carousel adds touch swipe and horizontal trackpad/wheel navigation; existing auto-play, dot navigation, arrows, counter, and bottom entries are unchanged. The showcase grid, step list, and quick links below the first screen are untouched.',
	},
	's11-1': {
		title: 'No second full-audio transcription after stop',
		description:
			'During recording, incremental audio is transcribed in real time into the input; on stop, only recording teardown runs—no extra full upload for a second pass—faster stop and fewer requests; final text is what live dictation already wrote.',
	},
	's11-2': {
		title: 'Input mode menu',
		description:
			'Input mode switches via dropdown items; selection styling and icon color highlight the active mode, same trigger region as send/voice.',
	},
	's12-1': {
		title: 'Chinese & English UI',
		description:
			'Settings toggle UI language (中文 / English); main pages and shared components (chat input, knowledge assistant, etc.) follow; assistant input-mode menu matches global language.',
	},
	's13-1': {
		title: 'Document assistant & RAG',
		description:
			'Bottom assistant supports Q&A and RAG with retrieval citations and multi-turn context; ties to Section 6 assistant features.',
	},
	's13-2': {
		title: 'Multi-session & persistence',
		description:
			'Multiple assistant threads per document with history switching; clear boundaries for temp vs persisted sessions to avoid wrong binding or broken streams when switching docs or saving (complements Section 6 streaming-across-docs).',
	},
	's13-3': {
		title: 'Unified assistant & RAG model backend',
		description:
			'Knowledge doc assistant (AI mode) and RAG Q&A now use the same SiliconFlow-compatible backend. Multi-turn history, stop generation, citation display, and ephemeral drafts are unchanged.',
	},
	's13-4': {
		title: 'Multi-collection RAG with custom vectors',
		description:
			'When custom vector settings are enabled, RAG searches saved collections in parallel and always queries the system default bge collection; active members also get the member default Qwen3 collection merged in; ties to Section 9 vector settings and Section 6 vector indexing.',
	},
	's14-1': {
		title: 'Sharing & public reading',
		description:
			'Share pages offer read-only threads; message order, user-side code layout, knowledge preview, and toolbars align with online chat.',
	},
	's14-3': {
		title: 'Share page shows user attachments',
		description:
			'Shared conversation links now include attachment cards on user messages (preview and download), matching the live chat view. Cloud-stored files are shown via the same-site proxy.',
	},
	's14-4': {
		title: 'Knowledge article share: updated time display',
		description:
			'Fixed shared knowledge articles showing “Updated” about 8 hours off from when you saved (e.g. early morning saved as evening). Matches the cloud knowledge library list.',
	},
	's14-2': {
		title: 'Chatbot capability areas',
		description:
			'Session lifecycle, SSE streaming, web search, attachments/OCR, async persistence are split front/back; see commits and release notes for history.',
	},
	's15-1': {
		title: 'Preview & navigation',
		description:
			'Markdown preview supports TOC and heading hash jumps for long documents.',
	},
	's15-2': {
		title: 'Editor interactions',
		description:
			'Context menu and bottom bar integrate with the knowledge workflow; Diff eligibility, snapshots, and sticky scroll match Section 7.',
	},
	's15-3': {
		title: 'Fenced code blocks',
		description:
			'Format fenced blocks (incl. Prettier), TSX highlight paths; cut with no selection maps to whole-line behavior consistent with desktop shortcut policy.',
	},
	's15-4': {
		title: 'Split scroll & IME',
		description:
			'Editor/preview follow-scroll keeps evolving; CJK IME ghosting has targeted mitigations.',
	},
	's15-5': {
		title: 'Mermaid & chat code blocks',
		description:
			'Mermaid fences get a sticky toolbar (zoom, etc.); chat code blocks get floating toolbars aligned with React concurrent external-store patterns.',
	},
	's16-1': {
		title: 'Global shortcuts & selection',
		description:
			'Global shortcut handling decoupled from Monaco selection to reduce select-all/copy vs focus conflicts.',
	},
	's16-2': {
		title: 'Tauri editor layout',
		description:
			'Explicit layout for editor containers in desktop WebView to reduce measurement jitter.',
	},
	's16-3': {
		title: 'OS shortcut conflicts & toasts',
		description:
			'When keys conflict with the OS or browser, toasts explain failures so shortcut recording stays understandable.',
	},
	's17-1': {
		title: 'Service deployment',
		description:
			'Backend supports common deployment shapes and env configuration; Nginx reverse proxy and TLS are illustrated in repo ops docs.',
	},
	's17-2': {
		title: 'Same-origin plugin registry path',
		description:
			'The host fetches the plugin registry via a same-origin short path (dev server proxy locally; gateway can serve files in production), avoiding cross-port browser blocks. Each remote module’s own entry files still need correct CORS on that module’s origin.',
	},
	's18-1': {
		title: 'Shared tools package',
		description:
			'Shared Markdown parsing, build scripts, etc. for frontend and doc pipelines.',
	},
	's18-2': {
		title: 'Line-oriented fenced parsing',
		description:
			'Fenced blocks support line-oriented parsing for easier highlighting pipeline extensions.',
	},
	's19-1': {
		title: 'Post-release external sync',
		description:
			'Release pipelines can sync Wiki or the public update page—complements Section 1—with a skip switch for local-only validation.',
	},
	's19-2': {
		title: 'Feature index',
		description:
			'In-repo index mapping feature areas to docs; update it when adding or moving topics so readers do not get lost.',
	},
	's20-1': {
		title: 'About links open in the browser',
		description:
			'Service policy and user agreement links in About open at site root + fixed paths in the system browser or a new tab instead of nested child windows—better for long reads and copying URLs.',
	},
	's20-2': {
		title: 'Standalone full-screen routes',
		description:
			'Policies live at /service-policy and /user-agreement without the main app Layout—same full-page scroll feel as public share pages.',
	},
	's20-3': {
		title: 'Public access & copy',
		description:
			'Those paths are on the logged-out allowlist; body copy is zh/en and follows UI language; implementation lives under standalone legal views for easy swap to formal legal text later.',
	},
	's20-4': {
		title: 'Legal pages: header language toggle',
		description:
			'/service-policy and /user-agreement headers include the same language toggle as /project-guide: navigate with ?lang= to switch zh/en immediately, wired to standalone-page locale-from-URL behavior—no need to change global settings first.',
	},
	's20-5': {
		title: 'About window lightweighting',
		description:
			'The About window now loads an on-demand code bundle—opens faster with less overhead. The window theme is read synchronously at creation, so in dark mode it no longer briefly flashes light before switching. If the About window is already open, clicking "About" again focuses the existing window instead of opening a new one.',
	},
	's21-1': {
		title: '/update-info standalone route',
		description:
			'Full-screen public route like share pages: header plus scrollable body with sectioned layout (not a Markdown preview renderer).',
	},
	's21-2': {
		title: 'Relationship to this write-up',
		description:
			'The live page is driven by structured frontend data (updateInfoSections), not by rendering this prose directly—keep code and copy in sync when editing.',
	},
	's21-3': {
		title: 'About entry point',
		description:
			'From About, “Release notes” opens the absolute URL in the browser as above.',
	},
	's22-1': {
		title: '/project-guide full-screen route',
		description:
			'Standalone product guide without main chrome; header includes language toggle (?lang=). Content aligns with the companion product-guide prose and is driven by projectGuideSections (+ English overlay).',
	},
	's22-2': {
		title: 'Home “Learn more” opens externally',
		description:
			'The hero “Learn more” button opens the guide in the system browser (desktop) or a new tab (web), passing the current UI lang as a query parameter.',
	},
	's22-3': {
		title: 'Maintenance note',
		description:
			'When the external-facing guide copy changes, update the structured product-guide modules and route constants before shipping the frontend bundle.',
	},
	's23-1': {
		title: 'Quick-start steps vs top-bar CTA',
		description:
			'On the home “Quick start” list, specific steps (e.g. register) are fully clickable for that flow; the main top-bar quick-start still opens chat (/chat) so one button does not mix two product intents. A “get started” style step matches the top bar and opens the main chat view.',
	},
	's23-2': {
		title: 'Login URL stays in sync with register mode',
		description:
			'The login page can open directly in register mode via the mode=register query string; switching between login and register updates the address bar with replace history to avoid stacking duplicate /login entries—refresh and shared links land on the right view.',
	},
	's24-1': {
		title: 'Topic-driven packs & streaming',
		description:
			'Signed-in users generate vocabulary packs and classic quotes from a topic in the English-learning area; generation streams over SSE with cancel, multi-turn agent chat, and clear error feedback.',
	},
	's24-2': {
		title: 'Quick-intent chips',
		description:
			'Toolbar chips attach a prefix to outgoing content; click again to clear selection; copy follows Section 12 UI language.',
	},
	's24-3': {
		title: 'Left rail form persists across routes',
		description:
			'Leaving the English-learning route and returning restores topic/count inputs and intent mirror text so you do not retype; works with the singleton pack/stream store.',
	},
	's24-4': {
		title: 'Favorites & drawers',
		description:
			'Vocabulary and quotes can be favorited, browsed paged inside drawers; list and sidebar UX includes refinements such as collapse memory where implemented.',
	},
	's24-5': {
		title: 'Export favorites to Word (DOCX)',
		description:
			'One-click DOCX export for vocabulary or quote favorites; the server aggregates up to about 3000 rows per user (newest favorites first, decoupled from UI pagination) with binary download on both browser and Tauri.',
	},
	's24-6': {
		title: 'Master retrieval: on-demand web search & RAG',
		description:
			'The master agent summarizes pack content; web search fires only when the model decides it is needed, with unified parsing of dates/recency in topics to cut routine noise; can combine with knowledge-base RAG tools so citations feel like the main chat product.',
	},
	's24-7': {
		title: 'JSON import & persisted libraries',
		description:
			'Standalone /english-learning/import (kind=vocab|classic): drag JSON, preview/validate, title, save; libraries use main+item tables with pagination; large packs via multipart upload; left rail groups import/library entry; after save navigate to the library with the new pack selected.',
	},
	's24-8': {
		title: 'Library paging, delete & session cache',
		description:
			'Right-pane entry lists paginate; delete a word library with confirm and cascade; switching libraries and returning restores loaded pages and scroll in-session (cleared on full refresh).',
	},
	's24-9': {
		title: 'Pull history delete & results UX',
		description:
			'History drawer deletes finished runs with cascade cleanup; opening history only navigates to results without refilling the left form; in-progress rows marked and usually not deletable; topic/web summary moved to page header; Agent save may jump to Knowledge.',
	},
	's24-10': {
		title: 'English-learning Agent multi-session',
		description:
			'Per-session messages and SSE; paginated history drawer and URL alignment; new chat without pre-creating empty sessions; intentPrefix not stored; placeholder IDs replaced via SSE with real DB ids.',
	},
	's24-11': {
		title: 'Batch unfavorite & collapsed quick intents',
		description:
			'Favorites drawer: multi-select, batch/single unfavorite with confirm; left rail shows two quick-intent chips by default, expandable to all.',
	},
	's24-12': {
		title: 'Vocabulary part-of-speech (pos)',
		description:
			'Streaming pull, lists, favorites, and DOCX export carry abbreviated English pos; legacy rows without pos treated as empty.',
	},
	's24-13': {
		title: 'List retries & friendlier errors',
		description:
			'Tauri GET retries by default; library/favorites/pack lists batch favorite-status with retries; list failure toasts use i18n copy; debounced status queries and progressive star highlights.',
	},
	's24-14': {
		title: 'Stream stop & silent cancel',
		description:
			'Stopping pack SSE aborts locally and may notify the server; cancel calls are silent so user-initiated stop does not show an error toast.',
	},
	's24-15': {
		title: 'Collapsible word/quote grids',
		description:
			'Pulled entry grids collapse/expand; new pulls auto-expand; a11y labels follow UI language.',
	},
	's24-16': {
		title: 'Dictation & spelling practice (summary)',
		description:
			'Start practice from favorites, library, or pack results; the report shows accuracy and stats, lists both wrong and correct words this round (green/red left border), with retry-mistakes, continue, and re-setup; back is an icon in the report header.',
	},
	's24-17': {
		title: 'Practice entry & return navigation',
		description:
			'Headphones icon on library list cards and vocab history drawer (tooltip: dictation/spelling); setup shows pool word count; back from home history returns to English learning home; practicing another history row from stream page keeps the current selection.',
	},
	's24-18': {
		title: 'Vocabulary mistake book',
		description:
			'Save wrong words from the practice report; open the mistake book from the English learning sidebar or /english-learning/mistakes to review, remove, and start dictation/spelling again; a shortcut on the report opens the mistake book.',
	},
	's24-19': {
		title: 'Unified practice entry',
		description:
			'Consistent dictation/spelling entry across favorites, library (including the word list header), pack results, and history drawer; the library word list header now practices the current library.',
	},
	's24-20': {
		title: 'In-session practice hints',
		description:
			'While answering dictation or spelling items, use Hint in the card header for clues (dictation: Chinese meaning and IPA; spelling: IPA under the prompt). The English word is not shown; the button is disabled when no clues exist; hints close when you move to the next item.',
	},
	's24-21': {
		title: 'Classic quote dictation & spelling',
		description:
			'Start practice from classic favorites, the quotes library, pack results, or the classic history drawer. Shares setup and summary with vocabulary practice. Hints may show Chinese meaning, source, or notes—never the English sentence before reveal.',
	},
	's24-22': {
		title: 'Classic quote mistake book',
		description:
			'Save wrong sentences to the shared mistake book page with tabs and footer actions. Re-saving updates last wrong spelling when it differs.',
	},
	's24-23': {
		title: 'Practice setup pool units',
		description:
			'On the dictation/spelling setup screen, the pool size shows “N words” or “N sentences” depending on vocabulary vs classic quote practice.',
	},
	's24-24': {
		title: 'Relaxed classic quote grading',
		description:
			'Classic dictation/spelling ignores case and punctuation; vocabulary practice also ignores trailing punctuation, reducing false negatives.',
	},
	's24-25': {
		title: 'Mistake book spelling refresh',
		description:
			'When saving to the mistake book again, if the wrong spelling differs from what was stored, only “last wrong input” is updated; word/sentence snapshots are unchanged.',
	},
	's24-26': {
		title: 'Two-tier wrong answer & playback',
		description:
			'First wrong: hints + playback, no English answer; full reveal after Show answer or 2nd wrong. Try again/Next; arrow keys ←→↑↓; dictation triple-play; retry restarts triple-play immediately; stable soft-reveal layout.',
	},
	's24-27': {
		title: 'Wrong-answer panel & shortcut help',
		description:
			'After first wrong or reveal: field-style hints; footer play, guidance, circular Show answer matching play button. Header shows word vs sentence mode. ? icon lists shortcuts by phase. Dictation triple-play only on initial main play when hint is closed; other play and ← are single; ← works while answering and after reveal.',
	},
	's24-28': {
		title: 'Playback continues after Show answer',
		description:
			'If audio is playing on the first-wrong screen, tapping Show answer or → to open the full reveal does not stop it—the same utterance keeps playing; both screens share play state until you stop or it finishes.',
	},
	's24-29': {
		title: 'Wrong-screen shortcuts & Previous question',
		description:
			'Play/stop is Shift + Space. On wrong screens: ↑ previous question, ← try again, → show answer, ↓ next. Footer Previous button when not on the first item. See ? menu for the full list.',
	},
	's24-30': {
		title: "Today's review (spaced repetition)",
		description:
			"The English learning home sidebar shows Today's review with due counts for vocabulary and sentences. New mistakes or changed misspellings enter the schedule; correct answers remove items from today's queue. Opens the practice setup page to choose mode and count; the due count refreshes after you finish.",
	},
	's24-31': {
		title: 'Random practice fills short pages',
		description:
			'When random order hits a page with fewer items than your chosen count, the app fetches more pages until the session is full or the pool is exhausted.',
	},
	's24-32': {
		title: 'Cloud playback prefers MiniMax streaming TTS',
		description:
			'When MiniMax is enabled on the server, cloud playback for sentences and longer text starts faster with more natural English. If MiniMax is unavailable, billing fails, or upstream errors occur, playback falls back to the previous cloud TTS; repeated plays of the same line still use cache.',
	},
	's24-33': {
		title: 'Settings: Cloud playback',
		description:
			'Separate from LLM settings. Toggle custom playback parameters (model, English voices, speed/volume/pitch, emotion, audio format, language boost, and advanced sample-rate options). Changes save to your account (sync across devices); preview and restore-default supported; when off, server defaults apply.',
	},
	's24-34': {
		title: 'Cloud playback prefs sync by account',
		description:
			'Custom cloud playback parameters moved from browser-only storage to your account in the cloud. The same account sees the same settings on different computers or browsers. Local Web Speech voice on the Voice settings page stays on each device only.',
	},
	's24-35': {
		title: 'Unified voice settings page',
		description:
			'Settings tab Voice settings is visible to everyone. The top section is local voice settings; active members also get cloud voice settings below. The local voice block was removed from System settings.',
	},
	's24-36': {
		title: 'Local playback voice per account',
		description:
			'Local English Web Speech voice on the Voice settings page is stored separately per signed-in account in the same browser. After switching accounts, the dropdown and playback use that account’s preference without overwriting others (device-only, not synced across devices).',
	},
	's24-37': {
		title: 'English playback routed by membership',
		description:
			'Speaker playback across English learning—words, sentences, dictation/spelling practice, daily review, etc.: active members default to cloud synthesis (falls back to local Web Speech when cloud is unavailable); non-members default to browser local voice. Aligns with local/cloud settings under Voice settings.',
	},
	's24-38': {
		title: 'Members can choose local or cloud playback',
		description:
			'Active members can use mutually exclusive switches “Use local voice for playback” and “Use cloud voice for playback” under Voice settings to choose the default medium for English learning speaker buttons; preference is saved per account and syncs across devices. Non-members remain local-only.',
	},
	's24-39': {
		title: 'Daily memorize quiz distractors and footer buttons',
		description:
			'After recognition in Daily memorize, multiple-choice distractors favor similar part of speech and definition length, with less repetition of the same wrong option within one round. The Start memorizing footer spacing aligns with dictation/spelling setup; Test me and related primary buttons no longer sit inside an extra dark bordered gap.',
	},
	's24-40': {
		title: 'Library edit and public libraries',
		description:
			'Hover a library card to edit (owners on private libraries; super admins on public ones). Owners can rename a library (character count shown, up to 50); press Enter in the dialog to save when there are changes. Super administrators can mark a library as public so all signed-in users can browse and practice; others cannot delete a public library they do not own. A Public badge appears on published libraries for all users. New imports stay private until manually published.',
	},
	's24-41': {
		title: 'English learning home sidebar visual unify',
		description:
			'Left sidebar blocks (daily memorize, quick intents, vocab/quotes libraries, topic pulls, favorites, today review, mistake books, etc.) now share one card and button spec aligned with the Agent and knowledge sidebars—subtle borders and light fills—while keeping each block’s icon and button colors. JSON import examples in library cards are collapsed by default; tap the label to expand or collapse. Quick-intent chips stay two columns in a narrow sidebar and add columns when the panel is wider.',
	},
	's24-42': {
		title: 'Cloud Chinese voices',
		description:
			'Active members: in Settings → Voice settings → Cloud voice, set Language boost to Chinese to pick from 64 Chinese system voices (Mandarin and Cantonese); English boost shows English voices only. When you change language boost, an incompatible voice resets to that language’s default.',
	},
	's24-43': {
		title: 'Faster cloud TTS for long passages',
		description:
			'With cloud voice enabled, longer text (e.g. e-book quote excerpts, long classic sentences) is synthesized in sentence-sized segments—the first segment starts playing as soon as it is ready, and the next segment is prefetched while the current one plays. Short words and phrases still use a single request. Same behavior for Listen on EPUB quotes and English learning play buttons.',
	},
	's24-44': {
		title: 'iFlytek cloud narration',
		description:
			'Active members can choose iFlytek cloud as the playback source in Voice settings (mutually exclusive with local and MiniMax cloud)—suited for Chinese listen-to-book. Configure voice, speed, volume, and pitch with preview; if the server is not configured or synthesis fails, you are notified and playback falls back to local voice.',
	},
	's24-45': {
		title: 'Cloud TTS credentials and failure alerts',
		description:
			'In Voice settings → Cloud voice settings, the MiniMax section accepts API Key and model name; the iFlytek section accepts APP ID, API Key, and API Secret (leave blank to use server defaults). MiniMax and iFlytek voice choices are stored separately when switching sources. Cloud synthesis failures show a clear alert and attempt local voice when available.',
	},
	's24-46': {
		title: 'MiniMax model picker and default',
		description:
			'In Voice settings → Cloud voice settings, the MiniMax model field is now a creatable combobox (speech-2.8-hd / speech-2.8-turbo, same pattern as LLM settings). New users and restore-default use turbo; only these two 2.8 models are accepted—accounts still storing legacy 2.6 / 02 / 01 names must switch to hd or turbo before saving.',
	},
	's24-47': {
		title: 'Edge cloud narration',
		description:
			'Voice settings adds Edge cloud (Microsoft online speech—free, no API Key). All signed-in users can pick Local or Edge at the top; active members can also choose MiniMax or iFlytek. Edge settings (voice, speed/volume/pitch, preview) appear before the MiniMax block and share the same playback routing as English learning and EPUB listen-to-book.',
	},
	's24-48': {
		title: 'Per-provider prosody fields',
		description:
			'Speed, volume, and pitch are saved separately for MiniMax, iFlytek, and Edge—tuning one provider no longer overwrites the others. Legacy accounts with shared fields get a one-time copy into all three sets on sync.',
	},
	's24-49': {
		title: 'Desktop cloud narration playback fix',
		description:
			'Fixes Tauri desktop cases where Edge / MiniMax / iFlytek cloud narration showed “playing” but stayed silent until pause/play or a second tap. Applies to English learning speaker, EPUB listen-to-book / listen selection, and voice-settings preview. Browser still uses stream endpoints; startup is slightly more reliable.',
	},
	's24-50': {
		title: 'Learning notes (remote module)',
		description:
			'English Learning adds a Learning notes entry (/english-learning/notes). The notes UI loads from an independent module; if it is not ready, the page shows a message with manual retry without breaking other English Learning features.',
	},
	's24-51': {
		title: 'Rich-text editing for learning notes',
		description:
			'Learning notes upgraded to a rich-text editor with formatting, highlight markers, lists, and other editing capabilities, making it easier to format and annotate learning notes.',
	},
	's24-52': {
		title: 'Learning notes cloud sync & CRUD',
		description:
			'Learning notes move from a local-only experience to cloud persistence. You can create, edit, and delete notes (with confirmation); the list auto-loads and sorts by time. Click a note in the left list to preview it; hover for quick edit or delete; the divider between the list and the editor is draggable.',
	},
	's24-53': {
		title: 'Rich-text editor UX improvements',
		description:
			'Cursor placement is more precise (empty docs auto-focus at the end of the body; GapCursor correction refined). The selection bubble menu only appears when real text is selected, avoiding false triggers on empty paragraphs. Toolbar overflow uses precise pixel measurement so buttons clip more accurately on narrow screens. The link editing panel now uses a unified UI component for consistent look and interaction. Select All (⌘/Ctrl+A) only covers the body content, skipping the title area, with theme-colored selection highlight. Learning notes support ⌘/Ctrl+S shortcut to save.',
	},
	's24-54': {
		title: 'Learning notes pagination & scroll-to-load',
		description:
			'Notes list now loads in pages (10 per page by default), with automatic next-page loading when you scroll to the bottom. Status hints at the bottom show "Loading…" and "No more notes". Previewing a note now shows a loading state for smoother interaction.',
	},
	's24-55': {
		title: 'Desktop rich-text copy/paste fix',
		description:
			'Fixed an issue where Cmd/Ctrl+C/V/X occasionally did not work in the learning notes rich-text editor on Tauri desktop. Both the title input and the body editor are now supported; Select All remains handled by the editor itself.',
	},
	's24-57': {
		title: 'Learning notes Word export & long-form perf',
		description:
			'Learning notes can now be exported as Word (.docx) files, preserving body formatting and images; downloads work on both desktop and browser. Also improved editing and preview performance for very long notes—lazy editor mount, windowed preview rendering for large notes, and streamlined title node selection fix paths to reduce jank.',
	},
	's24-58': {
		title: 'Learning notes unsaved indicator',
		description:
			'When note content differs from the last save, an orange dot appears on the toolbar Save icon; it clears after a successful save.',
	},
	's24-60': {
		title: 'Learning notes public/private & list redesign',
		description:
			'Learning notes now support a public/private visibility flag—private by default. Click the “Public” button (with a confirmation dialog) from the hover card or the preview header to publish a note; any logged-in user can then read it in their own notes list. The list is now a responsive grid of cards showing the title, the author, a public badge (teal for your own notes, sky for others’), and the last update time. Only the note owner sees the hover actions (publish/unpublish, edit, delete); others’ public notes are view-only. A new “Refresh” button at the top of the panel re-fetches the latest list after edits.',
	},
	's24-61': {
		title: 'Rich-text toolbar button hover animation',
		description:
			'Toolbar buttons (including the selection bubble) in the learning-notes rich-text editor now draw a thin stroke along each Lucide icon on hover, layered with the existing background color for a more tactile feel. It also respects the system “reduce motion” setting and falls back to the previous behavior when motion is disabled.',
	},
	's24-56': {
		title: 'Plugin error page polish',
		description:
			'The error page shown when a plugin is unavailable now has a centered layout and uses unified button styling for a more consistent look.',
	},
	's24-59': {
		title: 'English TTS auto-stop on page switch & stale media-control fix',
		description:
			'When reading aloud a classic quote or word in English Learning, switching to another sub-page or leaving English Learning now stops playback immediately—no more audio bleeding across pages. Tapping another entry to trigger a stop no longer leaves a silent progress bar lingering in system media controls (Touch Bar / Control Center / Bluetooth headset popup). Classic-quote and word cloud TTS also switched to single-utterance synthesis for a faster first packet.',
	},
	's24-62': {
		title: 'Smoother English Learning Agent Streaming',
		description:
			'During streaming responses in the English learning Agent, message token updates no longer trigger full-page re-renders of the input area, share bar, and session toolbar — typing, intent selection, and session switching remain responsive even during long conversations.',
	},
	's24-63': {
		title: 'Library list resume reading (cross-session)',
		description:
			"After picking a word or classic-quote library in the English Learning library, the right-hand entry list now remembers which page you last reached — even after closing the browser, quitting the desktop app, or refreshing the page, re-entering the same library jumps straight back to the page you left off at instead of starting from the top. Progress is only cached locally while browsing and reported to the server once when you leave the library, switch to the background, or close the tab, avoiding a request per page turn. Public libraries keep each non-owner reader's progress independently; switching accounts clears the previous account's local progress. The experience mirrors cross-session e-book reading-position restoration.",
	},
	's24-64': {
		title:
			'Library browsing upgraded: instant open, smooth scroll, stable stars',
		description:
			'Four upgrades to the English Learning library browsing experience. 1) Massive libraries stay smooth: right-hand entries now use a row-level virtual grid. Even libraries with tens of thousands of words or sentences only mount the cards visible on screen, so DOM size stays small and scrolling frames stay stable. Columns adapt automatically: 1 on narrow screens, 2 on medium, 3 on wide. 2) Deep resume lands with content immediately: if you left off at entry #3000, re-entering no longer shows just 100 entries around that point and forces you to scroll up to fill the gap — thousands of entries before and after the resume anchor are rendered in one shot, so scrolling either way has content right away. 3) Switching libraries is nearly instant: flipping back to a library you just viewed restores its scroll position, resume anchor, and loaded entries from a local snapshot instead of re-requesting everything over the network. 4) Favorite stars are correct the moment cards appear: star states for whole batches are queried in the same pagination window and at the same pace as the entries themselves — no more empty-then-lit flicker. The old bidirectional paging (pulling older entries by scrolling up) has been unified into a simpler one-way flow: the first render shows the full resume window, then you scroll down for more. Internal page logic is cleaner, and entering a deep-resume large library is 3–10× faster than before, scaling with depth and entry count.',
	},
	's24-65': {
		title:
			'Favorites, mistakes & daily records: unified virtual scroll + resume',
		description:
			'Five English-learning list pages — word favorites, classic-quote favorites, word mistakes, classic-quote mistakes, and daily memorize records — are all upgraded to the same virtual-scrolling grid engine as the resource library entries. Columns adapt automatically (1 on narrow, 2 on medium, 3 on wide), so lists stay smooth no matter the size. Each list now remembers where you left off: re-entering jumps straight back to that entry, even after closing the browser or quitting the desktop app. Progress is reported once when you leave, not on every page turn. Deleting entries refreshes the list in place instead of jumping back to the top. A floating corner button (bottom-right) lets you jump to the bottom or top of long lists instantly without dragging the scrollbar.',
	},
	's24-66': {
		title: 'Per-module resume toggle & one-tap clear',
		description:
			'A gear button is added next to the title of each of the five sidebar modules — Vocabulary library, Quotes library, Favorites, Mistake book, and Daily memorize records. The dropdown offers “Clear reading progress” and “Disable/Enable reading progress”. Clear zeroes out both the local and server-side resume positions for the current module (after a confirm dialog) and reloads the list from the top. Disable stops recording resume positions for that module on this device and on every other device signed in to the same account, and the list also reloads from the top right away. Re-enabling restores resume behavior; the next visit picks up from any existing position (or from entry 0 if it was cleared). Toggle state is saved per account and synced across devices; while logged out it is only cached locally (default-on, reset on refresh); switching accounts clears the previous account’s disabled set and the new account defaults to all-on.',
	},
	's24-67': {
		title: 'Favorite star no longer flickers; syncs across pages',
		description:
			'On English-learning lists (resource library, favorites, mistakes, daily memorize, review queue), the favorite star on each card used to flicker “empty then lit” when components remounted or the list scrolled back and forth. Now, once a star is lit it stays lit: entries already queried in the current session are cached locally and reused on remount or cache restore, so the server is not queried again. The backend also returns the favoriteId directly in the response of vocabulary-pack history, mistakes, daily memorize, review queue, and random-pick endpoints, so the star lights up without a second status query. Favoriting or unfavoriting an entry on any page instantly updates the star on every other loaded list card that contains it, with no manual refresh needed.',
	},
	's24-68': {
		title: 'Merged daily feedback panel & favorite-from-practice',
		description:
			'The correct / wrong feedback panels in daily memorize are visually and interactively unified — the two panels now share the same layout (distinguished only by green / red tones), with a header of “status icon + text + favorite button + play button” matching the rest of the cards. The play button now uses the standard system button style, with hover and active colors aligned to teal-green. A favorite button is also added to the practice session header, so you can favorite the current item while answering without waiting for the summary or opening the favorites drawer.',
	},
	's24-69': {
		title: 'Learning-notes images now on cloud storage with auto-cleanup',
		description:
			'Images inside learning-note bodies are now uploaded to server-side cloud object storage, with only the cloud URL kept in the body — no more base64. A few screenshots no longer bloat the note or slow serialization, and Word export no longer re-encodes each image, making long-note export more stable. Desktop pasted images (screenshots, file lists, local images inside rich-text HTML) now also auto-upload to the cloud, matching the browser paste experience. Orphaned objects are also auto-reclaimed: (1) if you paste images into a new note but close without saving, the cloud auto-cleans the unreferenced images after one hour; (2) if you paste then delete an image while editing and save, the deleted image is reference-counted and reclaimed; (3) when you delete an entire note, its referenced images are also cleaned up unless another note still references them. When the same image is referenced by multiple notes, deleting one note only drops the reference without affecting the same image in other notes.',
	},
	's24-70': {
		title: 'Learning-notes popout window with multi-window sync',
		description:
			'Desktop users can now pop out learning notes into a standalone window — click "Open in window" on the notes card in the sidebar, and notes open in an independent window alongside the main window, so you can study and take notes at the same time. Real-time bidirectional sync is built between the popout and the main window: edit a draft in one window and the other sees it instantly; save or delete a note in one window and the list and preview refresh automatically in the other; note mutations are auto-broadcast at the host layer, transparent to the plugin. Closing the popout does a managed save — the native close button is intercepted, unsaved drafts are written to the backend before the window is actually destroyed, and network failures do not freeze the window. The popout follows the main window theme (light / dark), accent color, and language in real time, so there is no mismatch. Clicking "Open in window" again when the popout is already open brings it to the front instead of opening a duplicate.',
	},
	's25-1': {
		title: 'E-book bookshelf',
		description:
			'New Bookshelf entry in the sidebar (/ebook). Signed-in users can manage EPUB/PDF: cards show title, format, and progress; open to read or remove with confirmation.',
	},
	's25-2': {
		title: 'Desktop vs browser import',
		description:
			'Desktop (Tauri): Select local file to pick epub/pdf; the app registers the path and reads from disk (file is not copied to the server). Browser: Import file uploads to your account shelf. About 120MB per file.',
	},
	's25-3': {
		title: 'EPUB/PDF reading and progress',
		description:
			'Reader supports page turns and percent progress; EPUB has a table of contents; reading position (EPUB locator / PDF page) syncs when signed in and restores on reopen.',
	},
	's25-4': {
		title: 'Reader UX',
		description:
			'Reader header: back, title, page turns and (EPUB) TOC. Keyboard ↑/← previous page, ↓/→ next page (ignored when TOC is open or an input is focused). Main header breadcrumb shows Bookshelf > Reading instead of the default app title.',
	},
	's25-5': {
		title: 'Bookshelf and reader polish',
		description:
			'Vertical shelf cards with a four-edge progress ring and EPUB/PDF color accents; open/import adds to the shelf without auto-opening the reader—tap Read or Continue on the card. PDF reader header matches EPUB: page turns, page numbers, and TOC from embedded bookmarks (empty state when none). Fixed render errors when jumping via TOC quickly. EPUB text color follows the app theme (light on black theme, dark on others); smoother page turns and progress saving.',
	},
	's25-6': {
		title: 'EPUB reader settings and continuous scroll',
		description:
			'EPUB reader header adds Reading settings next to TOC: font size, line spacing, text color, reading background, and paginated vs continuous scroll; preferences are stored locally. In continuous scroll, reaching the bottom or top of a chapter automatically moves to the next or previous chapter without repeated page-turn clicks.',
	},
	's25-7': {
		title: 'Desktop cloud backup and local-first reading',
		description:
			'On desktop, opening a local file adds the book to the shelf immediately so you can read right away, while a cloud backup runs in the background (progress bar for large files). Reading prefers the local file; browser import or unavailable local files fall back to cloud. Progress stays tied to one book. Local open up to about 512MB; cloud upload about 120MB per file.',
	},
	's25-8': {
		title: 'Shelf scroll loading and reader settings polish',
		description:
			'Bookshelf loads more as you scroll; the header shows total book count. EPUB reading settings offer 12 background and 12 text colors (swatch picker); continuous scroll is the default page flow with a segmented toggle; the settings panel uses the app ScrollArea scrollbar style.',
	},
	's25-9': {
		title: 'PDF reader scrollbar styling',
		description:
			'When scrolling long PDF pages in the reader, the scrollbar uses a thin, theme-colored style consistent with EPUB continuous scroll.',
	},
	's25-10': {
		title: 'PDF fit width and scroll page turns',
		description:
			'PDFs default to fit the reader width. Header zoom out/in and percentage (100% = fit width); preference is stored locally. On long pages, scroll to the top or bottom, pause, then scroll again to go to the previous or next page—fast flick scrolling will not skip multiple pages. Header and keyboard page turns still work.',
	},
	's25-11': {
		title: 'Shelf cover and title editing',
		description:
			'Shelf cards support custom covers (JPG/PNG/WebP via the bottom-left control on hover) and inline title editing (tap the title below the card, Enter to save) with success toasts. With a cover, the card shows the image; without, EPUB/PDF color placeholders remain. Hover the card for Read/Continue, progress, or Remove. Desktop import button label is now Select local file.',
	},
	's25-12': {
		title: 'EPUB context menu and MOKE reading assistant',
		description:
			'While reading EPUB, right-click in the body: Reading assistant, page turns, TOC, and settings when nothing is selected; Copy, MOKE ask-about-selection, and Select all when text is selected. Open the right split pane via the header Bot icon or the menu (same layout as the knowledge-base assistant, draggable width, ~50% default). Multi-turn chat and streaming replies. Sign-in required.',
	},
	's25-13': {
		title: 'MOKE assistant on PDF',
		description:
			'PDF reading adds the header Bot control and Right-click → Reading assistant for the same right split pane. No ask-about-selection yet because PDF text cannot be selected. One independent conversation session per book, separate from the knowledge-base document assistant.',
	},
	's25-14': {
		title: 'PDF reading context menu',
		description:
			'Right-click in the PDF reader for Reading assistant, TOC, zoom in/out (menu stays open for repeated zoom), and previous/next page.',
	},
	's25-15': {
		title: 'MOKE assistant: save and share',
		description:
			'From ebook assistant AI replies: Save to knowledge base (opens the knowledge editor) or share the current Q&A pair as a read-only link.',
	},
	's25-16': {
		title: 'Long book titles in reader header',
		description:
			'Very long titles truncate with an ellipsis in the reader header so they do not cover page-turn or TOC controls.',
	},
	's25-17': {
		title: 'Cloud backup requires membership',
		description:
			'Browser import of epub/pdf requires an active membership. On desktop, non-members can still add a local path and read locally without cloud backup. Member uploads are stored in cloud object storage only.',
	},
	's25-18': {
		title: 'Same local path not re-uploaded',
		description:
			'On desktop, if a member selects a local file whose path is already on the shelf, an info message says the book is already there and no duplicate cloud upload starts.',
	},
	's25-19': {
		title: 'Bookshelf refreshes after account switch',
		description:
			'After sign-out, switching accounts, or session expiry, the previous account’s bookshelf cache is cleared and the current account’s list is loaded again.',
	},
	's25-20': {
		title: 'TOC highlights current chapter',
		description:
			'When you open the table of contents while reading EPUB or PDF, the entry for your current position is highlighted and scrolled into view (PDF uses bookmark entries).',
	},
	's25-21': {
		title: 'Bookshelf categories',
		description:
			'The app header shows Moke BookHouse > My Bookshelf (same breadcrumb style as Moke BookHouse > Reading). The shelf toolbar has Manage categories, category tabs (All / custom / Uncategorized, horizontally scrollable), and Import (hover for hints). Create, rename, delete, and reorder categories; move books via the folder icon to the right of the title under each card; deleting a category moves its books to Uncategorized. Imports default to the selected category (last choice remembered). Categories refresh when you switch accounts.',
	},
	's25-22': {
		title: 'Large-file cloud backup stability',
		description:
			'For members uploading or downloading ~100MB epub/pdf files, the server uses streaming I/O instead of loading whole files into memory, reducing upload failures and process crashes. Reading and download behavior is unchanged.',
	},
	's25-23': {
		title: 'EPUB reading notes',
		description:
			'While reading EPUB, select text and choose Write note from the context menu. Saved passages show a subtle amber dashed underline; tap to view, edit, or delete. Multiple notes per passage (newest first, with username). Tapping the underline opens the list first (even for a single note). Nested overlapping selections show one visible underline; drag-select release does not open the list. Sign-in required; notes are stored on your account and removed when you delete the book. EPUB only; PDF is not supported yet.',
	},
	's25-24': {
		title: 'EPUB reading notes UI refresh',
		description:
			'Note list, details, and compose move to the right reading column (mutually exclusive with MK ask-about-selection; same resizable slot). Header shows title and note count; quote cards offer copy, write note, and MK ask shortcuts; a floating toolbar complements the context menu. Enter saves, Shift/Ctrl/Cmd+Enter inserts new lines with the input fixed at the panel footer. Fixes wrong list after writing on a different passage and occasional crashes after save.',
	},
	's25-25': {
		title: 'EPUB selection floating toolbar visuals',
		description:
			'The floating toolbar above selected text uses a frosted panel and theme-aware downward shadow so edges stay clear on dark reading backgrounds and colored themes; the caret matches the panel with consistent rounded corners. After copy, a brief “Copied” state shows before the selection clears.',
	},
	's25-26': {
		title: 'EPUB user highlights',
		description:
			'While reading EPUB, select text and use Highlight on the floating toolbar—background fill, straight underline, or wavy underline in five colors. Tap an existing mark to change style or remove it. Adjacent or overlapping highlights merge into one; the latest style wins. Sign-in required; highlights sync to your account and are removed when you delete the book. Can coexist with reading-note underlines. EPUB only; PDF not supported yet.',
	},
	's25-27': {
		title: 'EPUB highlight matching improvements',
		description:
			'Highlights are matched by position in the text—duplicate sentences in the same chapter no longer delete or merge each other by mistake. The toolbar shows Remove highlight when the whole selection is already highlighted, and Highlight when the selection is mixed or not highlighted yet.',
	},
	's25-28': {
		title: 'EPUB selection toolbar UX improvements',
		description:
			'Highlights, removals, and reading notes apply to the page more smoothly. The toolbar no longer flashes when switching between Highlight and Remove highlight, and the action row no longer shows empty placeholder gaps.',
	},
	's25-29': {
		title: 'EPUB reading-note partial overlap fix',
		description:
			'When you add a second reading note on text that partially overlaps an earlier note, the overlapping stretch no longer shows two stacked dashed underlines. Each selection can still be tapped to open its own note list.',
	},
	's25-30': {
		title: 'EPUB highlight and note sync performance',
		description:
			'After adding a user highlight or saving a reading note, marks appear on the page much sooner and scrolling stays responsive during sync—even when the book already has many marks.',
	},
	's25-31': {
		title: 'EPUB reading-note click aggregation',
		description:
			'Tapping a dashed reading-note underline opens a sidebar that intelligently aggregates related notes: nested selections (whole paragraph plus sub-phrases) default to the full excerpt with every note listed; adjacent phrases merge only when punctuation or line breaks between them also have notes—unannotated gaps stay separate. Multiple selection groups show section headers.',
	},
	's25-32': {
		title: 'EPUB reading-notes sidebar highlight coverage',
		description:
			'The Highlight / Remove highlight buttons in the reading-notes sidebar quote area match the selection toolbar: Remove highlight appears only when the entire displayed quote excerpt is already highlighted; if any part is not highlighted (e.g. only the second half), Highlight is shown and adds a highlight for the full excerpt.',
	},
	's25-33': {
		title: 'EPUB split-panel drag reading-area polish',
		description:
			'While dragging the MOKE assistant or reading-notes split width, the EPUB text reflows smoothly without white-screen flashes; user color highlights stay visible during the drag.',
	},
	's25-34': {
		title: 'EPUB reading-notes list interaction polish',
		description:
			'A single tap on a note in the list opens its details directly (no longer switches the quote excerpt). Group section headers support expand/collapse for long excerpts, aligned with the top quote card; the list quote area no longer jumps to the in-book PopBar on tap.',
	},
	's25-35': {
		title: 'EPUB reading background synced across the page',
		description:
			'After you change Reading background in settings, the header, reading-notes / MOKE assistant side panel, settings panel, and EPUB body share the same background. Follow app still matches Settings → theme colors.',
	},
	's25-36': {
		title: 'EPUB settings: tap the reader to close',
		description:
			'While the reading settings panel is open, tapping the left reading area (book body) closes the panel—you no longer need to tap the header settings button again.',
	},
	's25-37': {
		title: 'EPUB reading notes: no underline on blank lines',
		description:
			'When writing reading notes across multiple paragraphs, blank lines between paragraphs no longer show an amber dashed underline—only lines with actual text are marked.',
	},
	's25-38': {
		title: 'EPUB notes list: close panel after deleting last note',
		description:
			'When you open a note from the list and delete the last remaining note, the reading-notes side panel closes instead of staying open empty. If other notes remain, you return to the updated list. Note body alignment matches the list when entering details.',
	},
	's25-39': {
		title: 'EPUB quote share image',
		description:
			'While reading EPUB, tap Share quote on the selection toolbar or in the reading-notes quote area to generate a calendar-style quote card image. Copy the image to paste into WeChat and similar apps, or download a PNG; font sizes and weights are preserved when possible.',
	},
	's25-40': {
		title: 'EPUB MK ask & right side panel UX',
		description:
			'Header Bot, MK ask, and reading-notes side panel now share one right-column flow—opening MK from the notes list no longer flickers; closing MK fully collapses the panel when empty or returns to notes when applicable; closing the notes list restores full-width reading with no blank right column; user highlights no longer dismiss MK while it is open.',
	},
	's25-41': {
		title: 'EPUB context menu & selection toolbar',
		description:
			'Opening the context menu closes the selection toolbar immediately without flicker; right-click without a prior manual selection no longer auto-highlights a word—the menu shows the no-selection items; copy, MK ask, and write note still work after you drag-select first.',
	},
	's25-42': {
		title: 'EPUB reading-notes quote stays in view',
		description:
			'When you open or close the reading-notes side panel, the quoted passage in the left EPUB view stays on screen instead of scrolling away after the column resizes—easier to edit alongside the sidebar.',
	},
	's25-43': {
		title: 'EPUB split panel close layout fix',
		description:
			'After closing the reading-notes list or MK ask side panel, the left reading column returns to full width immediately—no sporadic blank right column and no multi-frame delay.',
	},
	's25-44': {
		title: 'EPUB quote “Listen”',
		description:
			'While reading EPUB, tap Listen on the selection toolbar or on the quote footer in the reading-notes list or details to hear the selected or quoted text; the button shows Stop while playing—tap again to stop. Chinese excerpts are more reliable with the browser’s built-in speech on desktop.',
	},
	's25-45': {
		title: 'EPUB split close & delete last note blank fix',
		description:
			'After closing the reading-notes list or MK ask side panel, deleting the last note from the list, or a dev hot reload, the left reading column returns to full width with no blank right column.',
	},
	's25-46': {
		title: 'EPUB thought dashes vs user underlines overlap fix',
		description:
			'Amber thought underlines show when you annotate a single sentence inside a paragraph. User straight underlines cover thought dashes only where they overlap; non-overlapping dashes remain. Background highlights and wavy underlines still coexist correctly with thought dashes.',
	},
	's25-47': {
		title: 'EPUB Listen sentence highlight while playing',
		description:
			'While Listen is reading aloud, the sentence being spoken shows a soft yellow background; it clears when that sentence finishes and moves to the next; stopping or finishing clears all playback highlights without affecting your highlights or thought underlines.',
	},
	's25-48': {
		title: 'EPUB Listen vs user highlight conflict fix',
		description:
			'After highlighting then Listen, or re-highlighting a wider selection, highlights no longer duplicate and cancel still works; when playback ends, highlights and thought underlines return to a consistent state.',
	},
	's25-49': {
		title: 'EPUB Listen cross-paragraph highlight fix',
		description:
			'When Listen spans line breaks or two paragraphs, the previous sentence yellow tint clears as soon as the next sentence starts—no more multiple sentences staying highlighted until playback finishes.',
	},
	's25-50': {
		title: 'EPUB Listen auto-scroll follow',
		description:
			'While Listen plays a long selection, the current sentence scrolls into view automatically. Manual scroll or wheel pauses follow; a bottom-right button returns to the playing passage and resumes auto-follow.',
	},
	's25-51': {
		title: 'EPUB listen while reading',
		description:
			'While reading EPUB, tap Listen to book in the header to hear continuous sentence-by-sentence TTS from your current position. A bottom bar offers pause/resume, prev/next sentence, and speed. Current sentence gets a light yellow tint and auto-scrolls into view; manual scroll pauses follow and a bottom-right button returns to the playing line. Mutually exclusive with quote Listen; TOC jumps resume from the new location. EPUB only.',
	},
	's25-52': {
		title: 'EPUB listen bar: sentences & speed',
		description:
			'The listen-while-reading bottom bar adds a Sentences button to open a per-chapter list and jump to any line (the list scrolls to the line currently playing). Speed is chosen from a popup grid from 0.75× to 3×; with cloud voice, changing speed takes effect on the current sentence immediately. Jumping from the list scrolls that sentence to the center of the screen for easier reading along.',
	},
	's25-53': {
		title: 'EPUB listen highlight follows panel resize',
		description:
			'While Listen or listen-while-reading is playing, opening or closing the reading-thoughts sidebar, dragging the MOKE/thoughts split, or narrowing the window keeps the light-yellow sentence highlight aligned with the reflowed text instead of drifting or disappearing. Independent of user highlights and thought underlines.',
	},
	's25-54': {
		title: 'EPUB quote Listen shares bottom bar',
		description:
			'While quote Listen is playing, the same bottom bar as listen-while-reading appears with pause/resume, stop, previous/next sentence, sentence list jump, and speed 0.75×–3×. PopBar and reading-notes quote entries are unchanged; mutually exclusive with listen-while-reading.',
	},
	's25-55': {
		title: 'EPUB listen sentence split for leading Chinese punctuation',
		description:
			'While listen-while-reading or quote Listen is playing, leading ellipsis, em dashes, and opening quotes are kept with the sentence they belong to—the sentence list and per-sentence highlight stay aligned with speech instead of splitting empty sentences or drifting off the read text.',
	},
	's25-56': {
		title: 'Smoother cloud listen between sentences',
		description:
			'When using cloud voice for listen-while-reading or quote Listen in continuous playback, the gap between sentences is shorter so the next line starts sooner after the previous one finishes. Local browser speech is unchanged.',
	},
	's25-57': {
		title: 'Local speech first sentence fix',
		description:
			'When using local browser speech for listen-while-reading, quote Listen, or English learning playback, the first sentence no longer occasionally stays silent. MiniMax or iFlytek cloud voice is unchanged.',
	},
	's25-58': {
		title: 'Continuous-scroll listen-while-reading resume',
		description:
			'When reading EPUB in continuous scroll mode, chapter listen now continues into the next on-screen section after the current block finishes. Previous/next sentence and sentence-list jumps no longer exit playback by mistake. Paginated page-turn mode is unchanged.',
	},
	's25-59': {
		title: 'EPUB reader chrome text and contrast',
		description:
			'After you change text color and reading background in Reading settings, the header, thought/MOKE side panels, input fields, listen sentence/speed menus, settings panel, and table of contents keep readable text, dividers, and buttons—no more gray-on-pink buttons or black portal menus.',
	},
	's25-60': {
		title: 'EPUB paginated nav and dismiss overlays',
		description:
			'In continuous scroll mode, EPUB previous/next page entries are hidden from the header and context menu; paginated mode still shows them. While the sentence list or speed menu is open, tapping the reading area closes it (same as Reading settings). The TOC drawer title is now “Book contents”.',
	},
	's25-61': {
		title: 'EPUB selection PopBar reader chrome',
		description:
			'The floating selection toolbar background, text, and shadow follow your reading background and text color. The top highlight style/color strip appears only when the selection already has a user highlight (including partial coverage), not on a fresh selection.',
	},
	's25-62': {
		title: 'EPUB quote share dialog reader chrome',
		description:
			'The Share quote dialog title, buttons, and borders follow reader chrome for readability. The generated share image and preview area keep the fixed light-gray calendar card colors for pasting into WeChat and similar apps.',
	},
	's25-63': {
		title: 'EPUB relayout after window maximize',
		description:
			'When reading EPUB, after you maximize or enlarge the window, loaded chapters automatically re-center to the new reading width without refreshing. Uses the same soft resize path as user highlights and listen playback backgrounds.',
	},
	's25-64': {
		title: 'EPUB custom highlight colors',
		description:
			'While reading EPUB, on the style strip for an existing highlight you can use Custom color to open a color picker—choose any hue and adjust fill opacity. Each highlight stores its own color and opacity and syncs to your account. EPUB only; PDF not supported yet.',
	},
	's25-65': {
		title: 'EPUB listen bar: ruler speed and sentence list',
		description:
			'Listen while reading and Listen selection now use a ruler-style speed panel (0.5×–3× in 0.1 steps, with round preset buttons). The sentence list uses virtual scrolling for smoother long chapters; after you scroll the list manually, a Scroll to current sentence button returns to the playing line.',
	},
	's25-66': {
		title: 'Bookshelf category tabs and title tooltip',
		description:
			'Empty custom categories and the Uncategorized tab when there are no uncategorized books are hidden. Moving or deleting the last book in a category returns you to All. Hovering a card title shows both its category and full title.',
	},
	's25-67': {
		title: 'Reading progress sync improvements',
		description:
			'EPUB/PDF reading progress still saves automatically. Refreshing the page, closing the tab, or switching away tries to sync immediately to your account, reducing lost position after a hard refresh. During listen-while-reading and other frequent page updates, cloud sync requests are merged; local resume position still updates right away.',
	},
	's25-68': {
		title: 'Public-book reading-note underline stacking',
		description:
			'When reading a publicly shared EPUB, you can see the owner’s and others’ reading notes (gray dashed underlines) alongside your own (amber). Where your note overlaps theirs, only your underline shows; multiple partially overlapping notes of your own also render as a single underline. EPUB only.',
	},
	's25-69': {
		title: 'Public EPUB books on the shelf',
		description:
			'Owners can mark cloud-backed EPUBs as public. All signed-in users can discover and read them from their own shelf (All or Public tab)—no share link required. Reading progress, highlights, and your own notes stay per account; you can see the owner’s public reading notes. Cloud backup is required before publishing; PDF is not supported yet.',
	},
	's25-70': {
		title: 'EPUB continuous-scroll highlight performance',
		description:
			'Smoother scrolling when many highlights or reading notes are on the page in continuous-scroll mode; marks stay aligned after you stop scrolling. Helps especially when reading public books with multiple people’s notes.',
	},
	's25-71': {
		title: 'EPUB continuous-scroll TOC jump',
		description:
			'When reading in continuous scroll, tapping a chapter in the book TOC reliably scrolls to the start of that section (including in-page anchors that share one chapter file), instead of stopping at the chapter end or showing the previous section’s tail. Paginated mode also lands on TOC anchors. Related to the multi-section TOC / listen alignment update.',
	},
	's25-72': {
		title: 'Shelf sorted by last read time',
		description:
			'Shelf cards are now ordered by last read time (descending) instead of by when the book was added — books you just read float to the top, while unread books still keep their added-time order. The order updates immediately as you read and progress is saved; pagination, public-book merges, and newly added books all follow the same rule.',
	},
	's25-73': {
		title: 'Shelf card uncategorized fallback label',
		description:
			'When hovering a shelf card title, if the book is uncategorized or its category was deleted, the category name no longer shows blank — it falls back to “Uncategorized” (matching the Uncategorized tab).',
	},
	's25-74': {
		title: 'EPUB listen: paragraph TTS',
		description:
			'Chapter listen and quote listen now synthesize cloud audio by paragraph while still highlighting sentence by sentence; the first sentence starts sooner and fewer requests are needed within a paragraph. Pause, sentence jump, and speed controls still work. EPUB only.',
	},
	's25-75': {
		title: 'TOC jump restarts chapter listen',
		description:
			'While chapter listen is playing, picking another chapter in the book TOC continues listening from the start of that chapter and keeps your playback speed — no need to tap Listen again.',
	},
	's25-76': {
		title: 'Listen speed and play-state fixes',
		description:
			'Cloud chapter listen now matches the chosen playback speed in the UI; when a clip ends or you stop, the bottom bar no longer stays stuck on “playing”.',
	},
	's25-77': {
		title: 'Return-to-play across distant chapters',
		description:
			'In continuous-scroll listen mode, if you scroll far away, the “return to playback” control correctly jumps back to the sentence being read and resumes follow.',
	},
	's25-78': {
		title: 'Listen prefetch after first sound',
		description:
			'When starting chapter listen, jumping sentences, or using quote listen, the current sentence plays first; later content is prefetched in the background to reduce first-sound wait.',
	},
	's25-79': {
		title: 'Listen bar: previous / next chapter',
		description:
			'On the chapter-listen bottom bar, the side arrows now jump to the previous or next chapter (resume from the start of that chapter and keep your speed). Use the sentence list to jump to a specific sentence. Chapter arrows are disabled during quote listen.',
	},
	's25-80': {
		title: 'Listen pause resume and system media sync',
		description:
			'After pausing chapter listen or quote listen, resume continues from the pause position instead of restarting the whole segment. System Control Center or headset media keys stay in sync with the bottom bar. Stopping listen ends speech and unbinds media-key handlers.',
	},
	's25-81': {
		title: 'Listen play button loading',
		description:
			'While chapter listen or quote listen is fetching the current sentence or paragraph and has not started playing yet, the bottom-bar play button shows loading—including between sentences, multi-pack synthesis, and jumps from the sentence list. Background prefetch does not trigger that loading state.',
	},
	's25-82': {
		title: 'Sentence list and TOC selection follow reader theme',
		description:
			'After you change the reading background in reader settings, the active item in the listen sentence list and book contents drawer uses the reading text color for background and type, so it stays readable on light themes.',
	},
	's25-83': {
		title: 'Shelf progress percentage display',
		description:
			'The “about X% read” label on shelf cards now shows a whole-number percentage instead of a long decimal.',
	},
	's25-84': {
		title: 'Multi-section TOC in one chapter file',
		description:
			'Some books split one chapter file into several TOC entries. Picking a section in the book contents drawer or tapping previous/next chapter on the listen bar lands on that section’s start and resumes listening from there. The TOC highlight also follows your reading or listening position instead of always marking the first or last section in the file.',
	},
	's25-85': {
		title: 'Listen bar neighbor chapter fix',
		description:
			'While listening, previous/next chapter on the bottom bar uses the sentence currently being spoken to decide which section you are in, so a lagging reading position no longer jumps to the wrong neighbor section.',
	},
	's25-86': {
		title: 'Listen from here continues the book',
		description:
			'After Listen from the selection or a thought quote, playback starts at the sentence that contains the selection and continues downward like full Listen. The bottom bar (including chapter skip) stays available. The button label stays Listen from here; use the bar to pause.',
	},
	's25-87': {
		title: 'Listen from here dismisses the selection bar',
		description:
			'Tapping Listen from here hides the floating selection bar and clears the text highlight so it does not block reading.',
	},
	's25-88': {
		title: 'Selecting text pauses listen follow',
		description:
			'While Listen is playing, selecting body text pauses auto-scroll to the current sentence (same as manual scrolling). Use Back to playback to resume follow.',
	},
	's25-89': {
		title: 'Scrolling clears leftover selection',
		description:
			'After you scroll and the selection bar is already hidden, any leftover native selection highlight on the page is cleared as well.',
	},
	's25-90': {
		title: 'Listen skips decorative separators',
		description:
			'Full-line decorative separators such as *** or --- in a chapter are no longer spoken aloud.',
	},
	's25-91': {
		title: 'TOC / sentence list three-way scroll',
		description:
			'The book contents drawer (bottom-right) and the listen sentence menu header share one control that cycles Scroll to bottom → top → current chapter/sentence, with icons switching (↓ / ↑ / locate) for long lists.',
	},
	's25-92': {
		title: 'Listen speed synced to account + “this book only”',
		description:
			'Playback speed for Listen to book / Listen to selection is saved to your account. By default it applies to all books; turn on Apply to this book only in the speed panel to limit it to the current book—others keep their own speed or the default 1.0×.',
	},
	's25-93': {
		title: 'Listen bar stays usable while audio is loading',
		description:
			'While speech is loading, the bottom bar’s sentence list, previous/next chapter, and speed controls stay available; an open speed panel no longer closes when the next sentence starts loading.',
	},
	's25-94': {
		title: 'EPUB side-panel Write note / MK ask input focus',
		description:
			'Opening Write note or MK ask-about-selection from the selection bar focuses the right-panel input after the split settles, so you can type immediately; switching between notes and ask also refocuses the visible panel’s input—no more brief focus that disappears.',
	},
	's25-95': {
		title: 'EPUB keeps reading position when the side panel opens or closes',
		description:
			'When you open or close the right panel, drag the split handle, or resize the window, the current reading line on the left stays in view as much as possible instead of jumping away as the reader width changes.',
	},
	's25-96': {
		title: 'EPUB reader plugins: all ideas & all highlights',
		description:
			'While reading an EPUB, the toolbar now has All ideas (lightbulb) and All highlights (highlighter) buttons. Tap to browse every idea or highlight in the current book in a bottom drawer with scroll pagination; tap an item to jump to its position and open the detail. Requires sign-in. EPUB only; PDF not supported.',
	},
	's25-97': {
		title: 'Unified cross-platform file selection',
		description:
			'File selection for Markdown import, JSON import, and registry icon upload now uses a single cross-platform entry point—Web and desktop behave identically. Wrong file types show a unified "type mismatch" prompt; cancelling no longer triggers error popups.',
	},
	's25-98': {
		title: 'macOS drag-and-drop crash fix',
		description:
			'Fixed a crash where dragging a file from the system file dialog into the app window caused the app to quit. Also fixed an underlying crash when dragging certain file types from outside the app.',
	},
	's25-99': {
		title: 'Dropped files no longer replace the page',
		description:
			'Fixed an issue where dragging a file directly into the desktop app window replaced the current page with the file contents. Dropping a file now only triggers the upload zone—your page stays put.',
	},
	's25-100': {
		title: 'Faster first screen',
		description:
			'All pages now load on demand—only the home page, login page, and app shell are downloaded on first open. Large modules like the code editor, EPUB reader, PDF reader, and chart rendering are loaded only when you enter the corresponding page. The code editor is further refined so its core loads only when the editor opens, and the code formatter downloads only on first format. The home page opens noticeably faster, and secondary features load on demand as you use them.',
	},
	's25-101': {
		title: 'English Agent selection right-click read aloud & copy',
		description:
			'In the English-learning Agent chat, selecting a passage of a message and right-clicking opens a custom menu to read the selected text aloud or copy it; with no text selected, the system default menu is used. Read-aloud reuses the same segmented cloud TTS as the book reader—first sentence plays fast with per-sentence preview—while a floating control bar above the input lets you play/pause, stop, change speed, and drag it anywhere. Markdown preview and the EPUB selection menu share the same menu component.',
	},
	's25-102': {
		title: 'Cloud TTS sentence highlighting feels more in sync',
		description:
			'Per-sentence highlighting for cloud whole-paragraph TTS now switches about 0.35s ahead of media time, easing the lag where the next sentence is being read but the highlight is still on the previous one. When the first sentence of book listening nears its end, the next sentence highlight also switches early, shortening the preview gap between the end of the first sentence and the start of the next segment. Playback progress is polled at a higher frequency for smoother in-sentence progress feedback.',
	},
	's25-103': {
		title: 'Plugin load failure: return home or open dev guide',
		description:
			'When a plugin page fails to load, the error message now offers Return home and Plugin development guide buttons alongside the existing Reload—three buttons centered with icons. If a plugin stays unavailable, you can jump back to the home page or open the onboarding docs in a new window without editing the address bar.',
	},
	's25-104': {
		title: 'UI tint softened & button/scroll button tweaks',
		description:
			'Home color blocks and global accent buttons are uniformly desaturated (with alpha) so they look softer in both light and dark themes—no more visual oversaturation. The scroll-to-top/bottom button changes from an oversized circle to a more compact rounded rectangle, and the floating read-aloud bar above the English Agent input is narrowed to match. Dropdown menu content padding is slightly increased for easier clicking.',
	},
	's25-105': {
		title: 'EPUB settings slider macOS blur color fix',
		description:
			'Fixed an issue on macOS where the font-size and line-height sliders in the EPUB reader settings panel turned gray after the window lost focus and did not recover. The slider color now automatically restores to the theme accent color when the window regains focus or the settings panel is reopened.',
	},
	's25-106': {
		title:
			'Selection-speak universalization: English Agent & e-book share one component',
		description:
			'The selection-speak capability has been extracted from the English Agent into a standalone reusable component. Both the English Agent and the e-book MOKE assistant now share the same floating control bar and right-click menu: select any text and right-click to read aloud or copy. During playback a draggable, resizable floating bar appears (play/pause, stop, 0.5×–3× speed); it automatically switches to a vertical layout when taller for easier one-hand use.',
	},
	's25-107': {
		title: 'More accurate highlighting for mixed Chinese-English TTS playback',
		description:
			'Selection-speak and chapter-listen progress now combine real audio clock time with character-type weighting (CJK ≈ 1 syllable, Latin ≈ 1/3 syllable, digits 0.5, whitespace 0.15), so sentence highlighting no longer jumps over Chinese paragraphs or lags behind English paragraphs in mixed-text passages. Speed changes made while TTS is loading now take effect immediately once the audio is ready—no need to replay.',
	},
	's25-108': {
		title: 'Listen & selection-speak are now mutually exclusive',
		description:
			'Within the e-book reader page, chapter listen and selection-speak in the assistant panel are now strictly mutually exclusive. Starting chapter listen automatically stops any ongoing selection-speak; choosing "read aloud" on selected text in the assistant panel first stops the current chapter listen before starting the new朗读. Switching books or chat sessions also automatically stops any active read-aloud so two audio streams never play at once.',
	},
	's25-109': {
		title: 'E-book player bar icons and spacing polished',
		description:
			'The play / pause / stop icons on the bottom e-book player bar have been unified to a square line style to match the rest of the product control buttons. The speed button is slightly narrower and the progress label gains a left margin, giving the bar a more compact look.',
	},
	's25-110': {
		title:
			'EPUB Reading Selection No Longer Accidentally Cleared by Sidebar Scroll',
		description:
			'When text is selected in the EPUB reader and the MOKE assistant sidebar is open, scrolling inside the sidebar no longer clears the reading selection — only scrolling within the EPUB reader itself dismisses the selection toolbar.',
	},
	's25-111': {
		title: 'Smoother Ebook Assistant Streaming',
		description:
			'The MOKE ebook assistant now batches streaming message updates per frame with in-place property changes, instead of triggering full observer re-renders per token — keeping input and scrolling smooth during long conversations.',
	},
	's25-112': {
		title:
			'System Media Keys Align with Player Bar During Listen/Speak Loading',
		description:
			'While waiting for speech synthesis to start, the macOS Touch Bar no longer shows operable playback controls; pause/resume become available only after audio begins. Fixes desynced listen bar or selection-speak bar state caused by repeatedly tapping system media keys during the loading wait.',
	},
};
