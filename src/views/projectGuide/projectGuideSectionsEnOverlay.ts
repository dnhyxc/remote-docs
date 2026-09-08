/**
 * 产品指南独立页的英文正文（与 projectGuideSections.ts 中章节/条目 id 一一对应）。
 */
export const PROJECT_GUIDE_SECTION_TITLES_EN: Record<string, string> = {
	'pg-s1': '1. What you can do with it',
	'pg-s2': '2. Desktop vs browser',
	'pg-s3': '3. Quick start (about 5 minutes)',
	'pg-s4': '4. Chat in depth',
	'pg-s5': '5. Knowledge base in depth',
	'pg-s6': '6. Markdown authoring',
	'pg-s7': '7. Shortcuts',
	'pg-s8': '8. Recommended settings',
	'pg-s9': '9. FAQ',
	'pg-s10': '10. Glossary',
	'pg-s11': '11. Sharing, RAG mode, and UI language',
	'pg-s12': '12. More in the Knowledge editor',
	'pg-s13': '13. English learning (word packs, quotes, favorites)',
	'pg-s14': '14. Going deeper',
	'pg-s15': '15. About window and legal pages',
	'pg-s16': '16. E-books (bookshelf & reader)',
	'pg-s17': '17. Plugin center (module management)',
};

export const PROJECT_GUIDE_ITEMS_EN: Record<
	string,
	{ title: string; description: string }
> = {
	'pg-s1-1': {
		title: 'Chat',
		description:
			'Ask questions, discuss plans, polish writing, and collaborate on code and documents.',
	},
	'pg-s1-2': {
		title: 'Knowledge base',
		description:
			'Capture notes in Markdown (cloud or local), then reuse them while writing and searching.',
	},
	'pg-s1-english': {
		title: 'English learning',
		description:
			'Stream themed word packs and classic sentences; import JSON into libraries with paginated browsing, pull history, multi-session Agent chat, favorites, and one-click Word (DOCX) export. Main flows require signing in.',
	},
	'pg-s1-3': {
		title: 'Rich Markdown',
		description:
			'Math (KaTeX), code highlighting, task lists, Mermaid diagrams—suited for technical notes and specs.',
	},
	'pg-s1-4': {
		title: 'Desktop experience',
		description:
			'On desktop you get deeper OS integration: global shortcuts, folder pickers, launch at login, and more.',
	},
	'pg-s2-1': {
		title: '2.1 Desktop (recommended)',
		description:
			'Best when you need stronger local capabilities: global shortcuts, choosing a folder for files, startup options—ideal for heavy writing and long-term knowledge management.',
	},
	'pg-s2-2': {
		title: '2.2 Browser',
		description:
			'Good for quick access. Features are limited to what the web platform allows; some actions show “desktop only.” When logged out you can still browse the home page, open Knowledge (local mode by default), and read some public pages (product guide, release notes, policies, etc.). Flows that need an account (e.g. Chat) will prompt you to sign in after you enter.',
	},
	'pg-s3-1': {
		title: '3.1 First-time suggestions',
		description:
			'(1) Open Chat and ask about a real task (e.g. weekly report or comparison).\n(2) Open Knowledge and save conclusions as Markdown.\n(3) If you write technical docs, try task lists, math, and Mermaid.',
	},
	'pg-s3-2': {
		title: '3.2 Typical workflows',
		description:
			'Chat then capture: outline in chat, then persist conclusions in Knowledge.\nOrganize sources: turn links and summaries into searchable Markdown.\nSpec writing: Background → Goals → Options → Trade-offs → Conclusion, plus Mermaid flow or sequence diagrams.',
	},
	'pg-s3-3': {
		title: '3.3 Home “Quick start”: steps vs top bar',
		description:
			"The step list and the top “quick start” button differ: the top button still opens /chat. The “Create account” step opens Login with the registration form (URL carries mode=register so refresh or copy keeps you on register). “Get started” steps match the top bar and open Chat. Toggling login/register syncs the address bar; history usually uses replace to avoid stacking duplicate /login entries. Opening /login?mode=register from a bookmark also lands on register.\nDemo account: when the site has a demo test account configured, visiting the homepage with a special parameter auto-fills the username and password on the login page (password shown as masked dots ••••; inspecting elements won't leak the real password) for one-tap login. Once logged in as the test account, modifying profile, purchasing membership, resetting password, and binding/unbinding WeChat are disabled; the email on the profile page is masked (e.g. d•••e@xx.com). When env vars are not configured, this feature does not affect regular users.",
	},
	'pg-s3-4': {
		title: '3.4 How to enable plugins: off by default & cross-device sync',
		description:
			'If you don’t see a feature entry on the sidebar or home page (Learning notes, Ideas list, or another independent module), it’s probably just not enabled yet.\n1) Open the Plugin Center: every available independent module shows as a card. Each card has a toggle on the right, with the module version and a short intro next to the title.\n2) Everything is off by default: the first time you sign in with a new account, all feature modules stay off. The sidebar and home stay uncluttered, so you can enable what you want at your own pace.\n3) Toggle ON (publish): the module registers its entry points in the UI immediately—the sidebar may gain a menu item, and the home screen may show a new card or shortcut. The module code loads on-demand at runtime; if loading fails, you get a stable hint and can usually retry manually without a blank screen.\n4) Toggle OFF (unpublish): the module’s entry points disappear instantly. If you were already on that module’s page when you turn it off, the page unloads automatically and returns you to a safe empty state so you don’t keep looking at a removed module.\n5) Account-level cross-device sync: enablement preferences are saved against your signed-in account. Modules you turned on in a browser on Computer A auto-mount in the same state when you sign in on Computer B or in the desktop app using the same account. Switching accounts—signing out into another account, or being redirected to sign in again after a session expiry—also refreshes the side entries automatically to match the NEW account’s preferences; no manual refresh needed.\n6) Old local records auto-migrate once: if you previously stored enablement history only on this device in an older version, the first time you open the Plugin Center after signing in, those preferences are migrated ONCE from local storage into the account’s cloud preferences. After migration, even clearing browser cache won’t lose them.\n7) Switch/label interaction details: each card’s toggle is correctly paired with its own label text. Clicking the toggle itself or the enable/disable label text to the right of the SAME card flips THAT card’s state only; you never toggle the wrong card by mistake. Mouse and keyboard both work reliably even with dozens of switches on the same page.\n8) Readable failure reasons: if the Plugin Center or registry fails to load, the page tells you specifically whether it’s “no network connection,” “expired credentials—please sign in again,” “malformed registry—contact maintainers,” or “other internal error”, so you can try reconnecting / re-signing in before asking for help.',
	},
	'pg-s3-5': {
		title: '3.5 Home hero stage card & focus carousel',
		description:
			'The first screen you see when opening the home page is made of two parts: a Stage Card (shell) and a Focus Carousel (content). Below them are the showcase grid, step list, and quick links.\nStage Card (shell): top to bottom—top brand bar (brand name + subtitle + a pulsing status dot on the right), the focus carousel main content area, the bottom watermark (a large brand wordmark that gradients with the current accent color), and the bottom entry bar (evenly spaced quick-action buttons, usually three: left-aligned / center / right-aligned). The bottom entries differ from the “quick start” steps below—the entries jump straight to core features (e.g. Knowledge, Chat), while the steps offer more detailed onboarding guidance.\nMouse-follow 3D tilt & layered parallax: moving the mouse into the hero card tilts the whole card slightly toward the cursor (3D rotation), while the top bar, bottom bar, main content, and watermark shift by different amounts in the opposite direction, creating a layered parallax depth. The card smoothly resets when the mouse leaves. If your system is set to “reduce motion”, tilt is disabled; when the card scrolls off-screen it stops computing.\nFocus Carousel: the main content area shows multiple carousel slides, each with a number badge, a two-tone title (main color + accent color), a subtitle, and a set of clickable action buttons. Interactions: auto-play (advances every ~5 s; pauses while the mouse hovers over the carousel, resumes on leave); arrow navigation (left/right arrows in the bottom control bar); dot navigation (dots jump to a specific slide; the active dot widens and highlights); counter (shows current / total); touch swipe (swipe left/right on touch devices; vertical scrolling is not intercepted); horizontal wheel/trackpad (swipe horizontally on a trackpad to change slides; vertical scroll is not intercepted).\nControl bar left hint: on desktop wide screens, a short hint text (e.g. a services overview) appears on the left of the control bar; it hides automatically on narrow screens.',
	},
	'pg-s4-1': {
		title: '4.1 Basic prompts',
		description:
			'Structure prompts with context, goal, constraints (length, tone, audience, steps vs comparison), and desired format (e.g. table or numbered steps). Example: “PRD review—need a one-page summary, under 300 words, bullet list.”',
	},
	'pg-s4-2': {
		title: '4.2 Streaming, stop, and continue',
		description:
			'Streaming: replies appear as they generate.\nStop: end early if you already have what you need.\nContinue: extend the current answer.\nCode block horizontal scroll: while a reply is streaming, scroll sideways inside a fenced code block to read long lines; this works even after the closing fence if the model keeps writing prose below.\nBranches & regeneration: work in a message tree; shared read-only pages try to keep order and layout consistent in complex branch cases.\nServer-side generation now goes through the SiliconFlow-compatible API; you use Chat the same way—no extra setup.',
	},
	'pg-s4-3': {
		title: '4.3 Web search and citations',
		description:
			'Ask for up-to-date info or sourced answers. You can require authoritative sources, clickable citations, or “sources first, then summary.”',
	},
	'pg-s4-4': {
		title: '4.4 Attachments and OCR',
		description:
			'Upload images or screenshots and ask to extract text, summarize, or turn tables into Markdown. After upload, attachments appear above the input; tap an image card to preview. Chinese filenames are handled automatically; web and desktop can preview in chat without opening a new tab. On the production website, preview uses the same site address as chat—no separate static image gateway is usually required. If preview still fails after upgrading, redeploy frontend and backend and restart services. When you send a message with images, the server first recognizes on-screen text and scene details, then passes that to the chat model. That recognition step is independent of the chat model you choose in Settings. Self-hosted instances need a Zhipu API credential on the server for image attachments to work.',
	},
	'pg-s4-5': {
		title: '4.5 Desktop voice input (Tauri)',
		description:
			'On desktop, hover the round main button to open the input mode menu and switch between text and voice. In voice mode, tap to speak; recognized text fills the input continuously; tap again to stop. Edit before sending. Menu strings follow the UI language.',
	},
	'pg-s4-6': {
		title: '4.6 Unified send button visuals',
		description:
			'The send buttons in the main chat input and the knowledge-base assistant input now share one lightweight style (tinted gradient + soft ring) that sits better on card backgrounds in dark themes. The stop-generation button and the desktop voice input-mode menu interactions (hover to expand, leave to close after a delay, tap to send) are unchanged.',
	},
	'pg-s5-1': {
		title: '5.1 Cloud vs local',
		description:
			'Cloud suits multi-device sync; local keeps Markdown in a folder you control. When logged out, Knowledge defaults to local mode and hides irrelevant entries (e.g. recycle bin).',
	},
	'pg-s5-2': {
		title: '5.2 Create and edit',
		description:
			'Create a doc (title + body), write Markdown, then save manually or rely on auto-save. Suggested outline: title, background, goals, conclusion first, reasoning, todos, references.',
	},
	'pg-s5-3': {
		title: '5.3 Save modes',
		description:
			'Manual save for explicit checkpoints; overwrite when updating one canonical doc; debounced auto-save after you pause typing to reduce lost work. Both manual and auto-save format the document before persisting. Long drafts favor auto-save; structured edits may favor manual save.',
	},
	'pg-s5-4': {
		title: '5.4 Local folders: scan, open, delete, external editors',
		description:
			'Folders are scanned recursively for Markdown. Edit in-app or open in an external editor (e.g. Cursor). On desktop, delete behavior depends on source: local files affect disk only; cloud entries linked to local files may offer delete local only, cloud only, or both.',
	},
	'pg-s5-5': {
		title: '5.5 Recycle bin',
		description:
			'With cloud management, deleted items may go to the recycle bin for recovery.',
	},
	'pg-s5-6': {
		title: '5.6 In-document AI assistant (logged in)',
		description:
			'When logged in while editing Knowledge, use the doc assistant at the bottom for multi-turn help on the current Markdown—polish, summarize, or Q&A.\nHidden when logged out; local editing still works.\nLong threads: scroll-to-bottom / scroll-to-top near the input; during streaming, scroll back to follow the latest output; after streaming ends, if you had scrolled up to stop auto-follow, the list stays where you left it.\nSend selected text to the assistant (context menu or ⌘/Ctrl+Shift+V) for AI or RAG follow-ups; the input auto-focuses with the caret at the end of the inserted text; overlapping selections may be deduped (per release).\nMulti-turn: AI mode uses saved session history within the token budget; RAG mode mainly uses retrieved chunks each turn. Backend generation is aligned with main Chat via SiliconFlow; interaction is unchanged.\nDesktop: text/voice input like Chat, follows UI language; dictation fills the input live and stays after you stop recording.\nGenerate outline: in AI mode (not RAG), use “Generate outline”; the TOC is prepended or the top heading is normalized to “## 目录”; skipped if that heading already exists; anchor-only lists get the heading only.\nStreaming: no “thinking process” block; the generating spinner animates correctly.',
	},
	'pg-s5-7': {
		title: '5.7 Long-form editing',
		description:
			'For long articles (e.g. tens of thousands of characters) with the doc assistant open, typing in edit-only mode for title, body, and assistant questions should feel noticeably smoother. Preview and split preview still render the full document after switching; save, auto-save, and assistant send behavior are unchanged.',
	},
	'pg-s5-8': {
		title: '5.8 Local folder tree browsing',
		description:
			'When using local knowledge base mode on desktop, after selecting a folder the app automatically scans for Markdown files and displays them as an expandable folder tree.\n\n• Folder structure: hierarchy is built from the actual file paths; empty folders are automatically filtered, showing only paths with .md files\n• Expand/collapse: click a folder row or press Enter/Space to expand or collapse subfolders; the selected root folder is expanded by default\n• File operations: click a file row to edit in-app; use the right-click or action button to open in an external editor or delete the file\n• Hierarchy indentation: files are indented by their folder level for easy identification\n• Cloud mode unaffected: only local folder mode uses the tree view; the cloud knowledge base still uses the list view',
	},
	'pg-s5-9': {
		title: '5.9 Title search (list and trash)',
		description:
			'When your knowledge base or trash has many entries, use the top search box in either drawer to quickly find documents by title.\n\n• Trigger: type a title keyword (e.g. "Weekly", "API") and press Enter to submit; no request fires while typing, so the list does not refresh on every keystroke\n• Cloud mode: the backend runs a paged fuzzy title query and remains compatible with scroll-to-load-more\n• Local folder mode: filtering happens in the frontend; after matching files are found, all parent folders containing matches are auto-expanded so you do not need to open directories by hand\n• Trash support: the trash drawer also supports title filtering; when no matches are found, a specific "No matching documents" hint is shown\n• Case insensitive: matching ignores letter case so "Report" and "report" give the same results\n• Clear search: delete all text and press Enter once more (or leave only whitespace) to restore the full list',
	},
	'pg-s5-10': {
		title: '5.10 Knowledge base category management',
		description:
			'In the cloud knowledge base list drawer, you can use categories to organize many documents.\n\n• Category tab bar: below the search box there is a horizontally scrollable tab bar with "All", each category name (with a document count badge), and "Uncategorized" (shown only when uncategorized documents exist). Click a tab to filter by that category\n• Manage categories: click the "Manage categories" button to the left of the tab bar to open a dialog where you can create, rename, delete, and reorder categories with up/down arrows\n• Default categories: the first time you open category management, 5 default categories are auto-created (Chinese: Notes / Docs / Tutorials / Work / Other; English: Notes / Docs / Tutorials / Work / Other). You can create up to 50 categories\n• Assign documents: hover over a document row to see a "Move to category" button; click it to choose a target category or move to Uncategorized from a dropdown. Only your own documents can change category; others\' public documents cannot be moved\n• Delete category: deleting a category moves its documents to Uncategorized; documents are not deleted\n• Public first: public documents are always sorted to the top, with updatedAt descending within each group\n• Scope: categories are only available in cloud mode; local folder mode does not show category tabs',
	},
	'pg-s5-11': {
		title: '5.11 Knowledge "Public" tab: browse others\' shared docs',
		description:
			'When other users mark documents as public, an additional "Public" tab appears in the knowledge category tab bar. It only shows documents that are public AND owned by others (your own public docs do not appear here; they remain visible under "All" and their categories).\n\n• Visibility: the "Public" tab only appears when the count of others\' public documents is greater than 0; it is automatically hidden when there are no public docs to avoid an empty tab\n• Switch filter: click the "Public" tab to switch to others-public-only view; title search and scroll-to-load-more continue to work exactly as in other tabs\n• "All" badge includes public count: the count badge next to the "All" tab now shows your doc count plus others\' public count, matching the documents you can actually browse in the tab bar\n• Others\' public docs cannot be re-categorized: the "Move to category" action for others\' public docs is hidden in the Public tab to prevent invalid operations\n• Scope: the Public tab is only available in cloud mode; local folder mode does not show category tabs or public filtering',
	},
	'pg-s5-12': {
		title: '5.12 Ebook shelf: search by book title',
		description:
			'On the ebook shelf page, you can quickly find books by searching.\n\n• Open search: click the Search button on the right side of the shelf header bar; the search input expands with an animation\n• Enter search: type a book title keyword (e.g. "Python", "Three-Body") and press Enter to submit; search is case insensitive, and both your shelf and the public shelf results are filtered together\n• Close search: click the button again (now showing "Close search") or press Esc to collapse the search box; if there is an active search keyword, closing automatically clears it and restores the full list\n• Empty results: when no matches are found, a "No matching books" hint is shown',
	},
	'pg-s6-1': {
		title: '6.1 Task lists',
		description:
			'Use `- [ ]` / `- [x]` for plans, milestones, and acceptance checks.',
	},
	'pg-s6-2': {
		title: '6.2 Math (KaTeX)',
		description: 'Inline and block equations for algorithms and derivations.',
	},
	'pg-s6-3': {
		title: '6.3 Code blocks',
		description:
			'Paste commands and snippets with language-specific highlighting. During streaming chat replies, scroll horizontally inside a code block when lines are wider than the pane.',
	},
	'pg-s6-4': {
		title: '6.4 Mermaid',
		description:
			'Flowcharts, sequence diagrams, state charts from text. Draft with Chat, then refine in Knowledge.',
	},
	'pg-s7-1': {
		title: '7.1 Global shortcuts (desktop)',
		description:
			"Configure shortcuts for common actions. Conflicts are blocked with a clear message so one shortcut does not trigger multiple actions. The macOS menu bar provides full File, Edit, and other system menus with zh/en labels and unified SF Symbols icons; changing a shortcut in Settings updates the menu-bar accelerator immediately without restart. Global shortcuts auto-release when the window loses focus (except Show/Hide App), so they do not hijack other apps' shortcuts.",
	},
	'pg-s7-2': {
		title: '7.2 In-page shortcuts (Knowledge)',
		description:
			'Shortcuts such as save or clear draft apply only on the Knowledge page to avoid accidental triggers elsewhere.',
	},
	'pg-s7-3': {
		title: '7.3 Form filling tips',
		description:
			'On login, register, and settings forms, Tab jumps directly between input fields—skipping buttons and links—and Enter submits the form, so filling is faster. Password fields have an eye icon on the right to toggle plaintext, letting you spot and fix typos without deleting everything.',
	},
	'pg-s8-1': {
		title: '8.1 File storage',
		description:
			'On desktop, pick a default folder that fits your workflow (sync drive, project root, etc.).',
	},
	'pg-s8-2': {
		title: '8.2 Startup and quit (desktop)',
		description:
			'Balance always-available (launch at login, minimize to tray) vs freeing resources (quit fully on close).',
	},
	'pg-s8-3': {
		title: '8.3 LLM (custom config)',
		description:
			'After sign-in: Settings → LLM (/setting/llm). Fill API Key, Base URL, and model name—the Key field is empty until you have saved one on this page and the API echoes it back.\nType directly or use the button beside Base URL / model to pick Zhipu GLM, SiliconFlow, or DeepSeek presets; switching preset or model does not clear an API Key you already entered.\nSave when all fields are complete to enable custom config—the footer shows the active model in green for your account only. Without custom config, gray text shows the default model (SiliconFlow for active members, Zhipu GLM for non-members). Unsaved edits or incomplete fields show hints and keep Save disabled. Use the eye icon to show/hide the key. Use Restore default to revert.\n\nVector model (Knowledge RAG, saved separately from chat LLM): scroll to the Vector model block on the same page (hidden for non–super-admins when a super admin enables site-wide “BGE vector collection only”). Fill API Key, vector model URL and rerank model URL (full URLs), embedding and rerank model names, and collection name; presets are available. Choosing BGE or Qwen3 tiers auto-pairs the three model/collection fields without clearing the vector API Key. Super admins can toggle site-wide BGE-only mode. Save vector config to enable; each save records collections you have used and lists them under collections included in search. RAG searches those collections in parallel, always includes the system default bge collection, and for active members also merges the member default Qwen3 collection; new articles index into the currently selected collection. Restore vector default clears only vector settings, not chat LLM.',
	},
	'pg-s8-4': {
		title: '8.4 Voice settings',
		description:
			'Settings → Voice settings (/setting/cloud-tts), available to all users. Top: Local voice settings—pick browser voices by female/male groups, preview, prefs saved per account on this device.\nPlayback source at the top (mutually exclusive): all signed-in users can choose Local voice or Edge cloud (Microsoft online speech—free, no API Key); active members can also choose MiniMax cloud or iFlytek cloud. Sets the default synthesis path for English learning and EPUB listen-to-book; may fall back to local when unavailable. When any cloud source is selected, the local voice block is disabled (local preview still uses browser voice).\nWith Edge cloud selected, configure voice and Edge-specific speed/volume/pitch in the Edge block (before MiniMax), with preview and restore-default; disabled when Edge is not selected.\nWith MiniMax cloud selected, fill API Key (blank uses server default) and model in Cloud voice settings—type directly or pick speech-2.8-turbo (default, faster) or speech-2.8-hd (higher quality); only these two are accepted—then adjust voice, MiniMax-specific speed/volume/pitch, emotion, format, language boost, etc. With Language boost set to Chinese, the voice list shows Chinese system voices; English shows English voices only; Auto shows all. Use ? beside the section title for field help. The MiniMax block is disabled when MiniMax is not selected.\nWith iFlytek cloud selected, fill APP ID, API Key, and API Secret in the iFlytek block (all three required for your own app; blank uses server default), plus voice and iFlytek-specific speed, volume, and pitch (0–100, 50 default), with preview and restore-default; disabled when iFlytek is not selected. Speed/volume/pitch are stored separately per provider and sync across devices for the same account.\nLong passages (cloud): with Edge, MiniMax, or iFlytek cloud, longer text is synthesized in sentence-sized segments—the first segment starts as soon as it is ready and the next is prefetched while the current one plays; short words and phrases still use a single request. When cloud is unavailable, you are notified and playback falls back to local voice.\nAuto-stop on page switch & media-control cleanup: after tapping the speaker to read a classic quote or word in English Learning, switching to another sub-page or leaving English Learning stops playback immediately—no audio bleeding across pages. Tapping another entry to trigger a stop no longer leaves a silent progress bar in system media controls (Touch Bar / Control Center / Bluetooth headset popup). Classic-quote and word cloud TTS also switched to single-utterance synthesis for a faster first packet.',
	},
	'pg-s8-5': {
		title: '8.5 Account avatar (cloud storage)',
		description:
			'After sign-in, open /profile (personal home) or /profile/account (account settings); the sidebar avatar area also opens account settings. Profile, account settings, and membership payment are now unified under /profile/*; old /account and /pay links auto-redirect. Choose an image in the avatar area, then save. The sidebar and profile page update together. Use preview or the upload-area download control to save the avatar; you get a success or failure toast. If the image fails to load, try uploading again; on the web, use this site rather than old external links. Chat attachments use the same Tencent Cloud COS storage as avatars, shown via the site proxy; legacy local paths in old messages remain read-only compatible.',
	},
	'pg-s8-6': {
		title: '8.6 Membership billing (Stripe)',
		description:
			'After sign-in, open /profile/pay (or tap Buy membership on /profile). Old /pay links auto-redirect to the new path. Pick Monthly ¥9.9 (30 days), Quarterly ¥25.9 (90 days), or Annual ¥99.9 (365 days)—fixed prices, not editable. Click "Start payment" to open embedded checkout and pay with Stripe; on success you are redirected to profile with a gold Member badge and gold "Valid until …" line. Renewals stack after the current expiry; when membership lapses, profile shows non-member state and you can purchase again.\nLayout optimization: the payment page adapts to the profile route shell—content scrolls within the page when overflowing; the redundant header and badges are removed; copy is more concise; overall visuals are cleaner.',
	},
	'pg-s8-7': {
		title: '8.7 Accent color',
		description:
			'Open Settings → Theme (/setting/theme). The “Accent color” section lists 10 presets: Default (teal), Lime, Peach pink, Indigo, Ochre, Xiang yellow, Apricot, Dai teal, Pine flower, Evergreen. Each row shows a color dot, name, hex badge, and a short description, with a check mark on the current choice.\nPick any color to apply instantly—hover, selected, link, and button accents across the app update with it (feature-card entry arrows, settings check marks, link highlights, etc.). No extra save needed; the choice is stored per signed-in account and syncs across devices.\nThe accent color is orthogonal to the “color theme” above (white / dark / red / beige): color theme sets backgrounds and text hue, accent color sets interactive accents, and they can be combined freely.\nRefreshing the page or restarting the desktop app will not flash back to the default color (the first paint already applies your choice).\nSome decorative areas (home Quick-start gradient buttons, English-learning sidebar gradients for daily memorization / word packs, vocabulary-stream progress bars, word-pack count buttons) intentionally keep the original teal and do not follow the accent color—this is by design, not a bug.\nIndependent pages / external links follow the main site accent: when opening via a share link, external link, or independent page (download page, update info, etc.), the ?accent= URL parameter is parsed and applied automatically; an inline first-paint script reads it synchronously to avoid flashing. Share links also auto-append the parameter so recipients see the same color scheme.',
	},
	'pg-s9-1': {
		title: '9.1 Why “desktop only”?',
		description:
			'Browsers cannot access some OS APIs (global shortcuts, native folder pickers, etc.). Desktop builds include those capabilities.',
	},
	'pg-s9-2': {
		title: '9.2 Markdown looks wrong',
		description:
			'Check fenced code blocks are closed; validate Mermaid/math syntax; split content to isolate issues. Pasting large ```tsx fences containing literal ```mermaid can confuse formatting—back up or paste in smaller chunks.',
	},
	'pg-s9-3': {
		title: '9.3 Turning chat into reusable knowledge',
		description:
			'Ask the model for conclusions, key points, and todos; paste into Knowledge; add your context and final decisions.',
	},
	'pg-s9-4': {
		title:
			'9.4 Will I still see the previous account’s content after switching?',
		description:
			'No—in the same browser tab without a full reload. When you sign out, sign in with another account, or the session is cleared after 401, client-side display cache for the previous account is reset (unsaved knowledge drafts, document assistant and RAG chats, English Agent threads, in-progress vocabulary/classic streams, etc.). Updating profile or membership for the same user does not clear your work. If something looks wrong, refresh or sign in again.',
	},
	'pg-s10-1': {
		title: 'Terms',
		description:
			'Tauri: desktop shell wrapping the web UI.\nSSE: server-sent events for streaming.\nOCR: text extraction from images.\nGFM: GitHub-flavored Markdown.\nMermaid: text-based diagrams.\nDebounce: delay action until input pauses.\nRAG: retrieval-augmented generation—retrieve snippets then generate (used in Knowledge assistant modes).',
	},
	'pg-s11-1': {
		title: '11.1 Shared sessions (read-only)',
		description:
			'Share generates a link for read-only viewing in a browser—no install required. Message order matches the conversation, including branches/regeneration. User message attachments appear as cards with preview and download; layout aligns with the online reader. Saved cloud knowledge articles can use a knowledge share link; the “Updated” line matches the cloud library list—save to the library before sharing.',
	},
	'pg-s11-2': {
		title: '11.2 Knowledge assistant: AI vs RAG',
		description:
			'Besides default AI mode (multi-turn on current Markdown), switch to RAG to answer using retrieved snippets—good for “questions against your corpus.” Mode switching and streaming mirror Chat; citations help verify sources.',
	},
	'pg-s11-3': {
		title: '11.3 UI language',
		description:
			'Switch Chinese/English in Settings; Chat, Knowledge assistant, menus, and common prompts follow. Desktop voice needs microphone permission. Untranslated spots are usually new UI pending i18n keys.',
	},
	'pg-s12-1': {
		title: 'Preview TOC and anchors',
		description:
			'Long docs: use the preview outline or heading anchors (including hash navigation).',
	},
	'pg-s12-2': {
		title: 'Context menu',
		description:
			'After selecting text in the editor, use the context menu for quick edits alongside the bottom toolbar.',
	},
	'pg-s12-3': {
		title: 'Mermaid zoom and preview',
		description: 'Zoom complex diagrams for easier reading.',
	},
	'pg-s12-4': {
		title: 'Format code blocks',
		description:
			'Format supported fenced languages when available; nested fences may need backup or incremental paste.',
	},
	'pg-s12-5': {
		title: 'Preview/edit & document assistant',
		description:
			'Full-width preview; with the assistant open, toggling preview/edit keeps the panel and switches the left pane while restoring scroll in both directions when possible; leaving split for full preview also keeps scroll where feasible. Long or diagram-heavy docs keep preview and assistant scrolling responsive; during streaming you can scroll up to read history and only resume follow-bottom after scrolling back down. Very long docs with many code fences should also scroll smoothly in preview-only mode; the sticky code bar can still appear when a fence crosses the top edge, and in-block copy/download stay available.',
	},
	'pg-s13-1': {
		title: '13.1 Word packs and classic lines (streaming)',
		description:
			'Fill theme and counts, then generate with streaming UI; cancel per product controls; errors show readable messages. Main pass summarizes points; web search triggers when the model judges it needed (e.g. time-sensitive topics). Combine with Knowledge RAG so answers carry verifiable citations, consistent with the Knowledge assistant domain.',
	},
	'pg-s13-2': {
		title: '13.2 Quick intents (toolbar chips)',
		description:
			'Toolbar chips attach prefixes or intent hints; tap again to deselect. Labels follow the UI language from Settings.',
	},
	'pg-s13-3': {
		title: '13.3 Left form and returning to the page',
		description:
			'Theme, counts, and other left-panel fields are generally restored after you navigate away and back (works with streaming singleton state; exact behavior per release).',
	},
	'pg-s13-4': {
		title: '13.4 Favorites, drawer, and DOCX export',
		description:
			'Favorite words or lines; browse and manage in a paginated drawer, with multi-select and confirmed batch unfavorite. Favorites list uses the same virtual-scrolling grid as the resource library (1/2/3 columns adaptive), staying smooth at any size; it remembers where you left off — re-entering jumps back to that entry even after closing the browser or quitting the desktop app; a floating corner button (bottom-right) lets you jump to the top or bottom; deleting favorites refreshes the list in place without jumping to the first page. Export word favorites or quote favorites to Word (DOCX); the server aggregates up to about 3000 items per account by favorite time (newest first), independent of the drawer page; word export may include part-of-speech (pos) fields. Browser and desktop both use binary download and local save; desktop dedupe prompts if implemented.',
	},
	'pg-s13-5': {
		title: '13.5 Libraries and JSON import',
		description:
			'Use the left-rail library area to import. Standalone page /english-learning/import with kind=vocab or kind=classic. Drag a .json file, preview/validate, set a title, and save; large packs use an upload path suited to big files. After save you land in the library with the new pack selected; the title can be prefilled from the filename without extension.',
	},
	'pg-s13-6': {
		title: '13.6 Browse and manage libraries',
		description:
			"After picking a word or classic-quote library on the left, the right pane shows entry cards in a responsive grid — 1 column on narrow screens, 2 on medium, 3 on wide — adapting smoothly as you resize the window. Even with tens of thousands of entries, only the cards on screen are rendered (row-level virtual scrolling), so fast swipes up or down don't cause blank flashes or frame drops. The entry list remembers where you last read: after closing the browser, quitting the desktop app, or refreshing the page, the same library jumps straight back to the entry you were near. If you left off deep in the library (e.g. beyond entry #3000), the first render no longer shows just the last page alone — the full window before and after the resume anchor is presented in one shot, so scrolling either way has content immediately. Switching libraries or leaving and returning within the same session restores loaded entries, scroll position, and resume anchor from a local snapshot nearly instantly; data is only re-pulled when the snapshot cannot cover the resume position. Browse progress is sent to your account when you leave the page, switch to background, or close the window, so any device signed into the same account can restore it; non-owners of a public library keep independent progress that does not overwrite each other; switching accounts clears the previous account's local cache. Delete a word library and its entries after a two-step confirmation. Favorite stars in library and pack lists load in the same pagination window and at the same pace as the entries themselves — stars are already correct when cards first appear, with no empty-then-lit flicker. Scroll to the bottom to auto-load the next batch; once the resume window is fully rendered on first enter, you just scroll down for more.",
	},
	'pg-s13-7': {
		title: '13.7 Pull history, results page, and stop',
		description:
			'History drawer lists past pack runs; in-progress rows are marked and usually not deletable. Opening history goes to the results page without overwriting the left-rail form for a new pull. Finished history can be deleted. Header shows topic and web-search summary; live vs history paging differs. Stopping a stream keeps generated content and typically avoids a harsh error toast.',
	},
	'pg-s13-8': {
		title: '13.8 English-learning Agent (multi-session)',
		description:
			'Agent chat supports multiple sessions with a paginated history drawer; “New chat” clears the view and creates the server session on first send. Scroll-to-bottom / scroll-to-top near the input; scrolling up during streaming stops auto-follow and your position is kept after streaming ends. Quick intents affect only the current turn, not stored transcript. Saving to the knowledge base may navigate you there to continue editing. Selecting text in an Agent message and right-clicking offers Read aloud or Copy; read-aloud reuses the book-reader segmented cloud TTS, with a floating control bar above the input for play/pause, stop, speed, and dragging to any position; with no text selected, the system default menu is used. The floating bar is now also resizable with corner handles and automatically switches to a vertical layout when tall enough. Sentence highlighting in mixed Chinese-English passages is more accurate thanks to character-type weighting, and speed changes made while TTS is loading take effect immediately once the audio is ready.',
	},
	'pg-s13-9': {
		title: '13.9 List and left-rail UX details',
		description:
			'Pulled word or quote grids can collapse/expand; a new pull expands automatically. Quick intents show a few chips by default with expand for all. Word packs can show abbreviated part-of-speech labels (e.g. n, v, adj).',
	},
	'pg-s13-10': {
		title: '13.10 When the network is flaky (especially desktop)',
		description:
			'On desktop, transient list or favorite-status failures may auto-retry read-only calls and show readable toasts instead of raw transport errors. Write actions such as favorite/unfavorite are generally not retried to avoid duplicate side effects.',
	},
	'pg-s13-11': {
		title: '13.11 Dictation & spelling (vocab & classic quotes)',
		description:
			'Entries and grading as in the Chinese guide. Header shows word vs sentence mode. First wrong: field hints + circular Show answer; full reveal field layout. Show answer or → does not stop audio already playing. Footer Previous when not on the first item. Shift+Space play/stop; on wrong screens ↑ previous, ← try again, → show answer, ↓ next. Dictation triple-play on new question, retry, and main play when hint is closed. ? icon lists shortcuts. Summary and mistake book unchanged.',
	},
	'pg-s13-12': {
		title: '13.12 Mistake book (vocab & classic)',
		description:
			'Sidebar or in-page tabs; total/loaded counts; remove and footer practice. Mistakes list uses the same virtual-scrolling grid as the resource library (1/2/3 columns adaptive), staying smooth at any size; it remembers where you left off — re-entering jumps back to that entry even after closing the browser or quitting the desktop app; a floating corner button (bottom-right) lets you jump to the top or bottom; deleting mistakes refreshes the list in place without jumping to the first page. Re-saving updates last wrong input when spelling differs; snapshots unchanged.',
	},
	'pg-s13-14': {
		title: "13.14 Today's review (spaced repetition)",
		description:
			"On the English learning home sidebar, Today's review shows due counts for vocabulary and sentences. New mistakes or changed misspellings join today's queue; correct answers remove them. Tap to open the practice setup page (mode and count). The queue is due-order only. After a session, the next review time updates and counts refresh; Back returns to the home page. Continue practice draws more due items if any remain.",
	},
	'pg-s13-15': {
		title: '13.15 Daily memorize',
		description:
			'On the English learning home sidebar, Daily memorize lets you set words per round and start. Flow: intro → recognition → Test me (multiple choice) → feedback → next word. Distractors favor similar part of speech and definition length with less repetition within one round. Start memorizing footer spacing matches dictation/spelling setup; Test me and related buttons are full-width without an extra dark bordered gap.',
	},
	'pg-s13-16': {
		title: '13.16 Library edit and public libraries',
		description:
			'On vocabulary or quotes library lists, hover or select a card and use Edit (owners on private libraries; super admins on public ones). Rename up to 50 characters with a live count; only the owner can save. Press Enter in the dialog to save when there are changes. Super administrators can toggle Make public library so all signed-in users can browse and practice; new libraries stay private until published. You can delete only libraries you own. A Public badge appears on published libraries for all users.',
	},
	'pg-s13-17': {
		title: '13.17 Home sidebar layout and interaction',
		description:
			'Each left-sidebar feature (daily memorize, quick intents, libraries, topic pulls, favorites, today review, mistake books, etc.) sits in its own card with a colored icon beside the title—subtle borders and light fills aligned with the Agent panel, while button colors stay per block. JSON format examples in library cards are collapsed by default; tap the label to expand or collapse. Quick intents show a few chips first; when expanded, chips use two columns in a narrow sidebar and add columns when the panel is wider.',
	},
	'pg-s13-18': {
		title: '13.18 Learning notes',
		description:
			'Entry: open Learning notes from the English Learning sidebar, or go to /english-learning/notes. Usage: the page shows the notes module (loaded from an independent feature module). If the module is unavailable, check the network and tap Reload; other English Learning pages are unaffected. Rich-text editing: the notes editor supports text formatting (bold, italic, strikethrough, inline code, etc.), highlight markers, ordered/unordered lists, and code blocks for flexible formatting and annotation; on hover, toolbar buttons now draw a thin stroke along the Lucide icon for a more tactile feel. Split layout: left side shows the note list, right side has the editor and preview; list width is draggable, and the list can be collapsed so the editor takes full width. Save: click toolbar Save or press ⌘/Ctrl+S to write to your account; an orange dot appears on the Save icon when there are unsaved changes. New note titles are extracted from the first heading in the editor. Public/private notes: notes are private by default. Tap the “Public” button from the hover card or the preview header and confirm the dialog to publish it; other logged-in users can then read it in their own notes list. Others’ public notes show a sky-blue “Public” badge and the author’s name on the card and are read-only. List & refresh: the list uses a responsive grid of cards; a Refresh button at the top of the panel re-fetches the latest list after edits, and scrolling to the bottom auto-loads more.',
	},
	'pg-s13-19': {
		title: '13.19 Per-module resume toggle & one-tap clear',
		description:
			'The five English Learning sidebar modules — Vocabulary library, Quotes library, Favorites, Mistake book, and Daily memorize records — each remember where you left off. If you don’t want a module to keep tracking your position, or want to wipe old progress and start over, use the gear menu next to the sidebar title. Gear location: each of the five module titles has a gear icon on the right; click it to open a dropdown with a “Settings” header and two actions. Clear reading progress: a confirm dialog zeroes out both the local and server-side resume positions for that module and reloads the list from the top — handy when switching topics or starting fresh. Disable/Enable reading progress: Disable stops that module from recording resume positions on this device and on every other device signed in to the same account, and the list also reloads from the top right away. Re-enabling restores resume behavior; the next visit picks up from any existing position (or from entry 0 if it was cleared). State sync: toggle state is saved per account and synced across devices; while logged out it is only cached locally (default-on, reset on refresh); switching accounts clears the previous account’s disabled set and the new account defaults to all-on. Modules are independent: toggling one does not affect the other four. No new resume table: disabling does not auto-delete existing positions — you must tap “Clear reading progress” to zero them; re-enabling resumes from whatever position is still stored.',
	},
	'pg-s13-20': {
		title: '13.20 Favorite star no longer flickers; syncs across pages',
		description:
			'On English-learning lists (resource library, favorites, mistakes, daily memorize, review queue), the favorite star on each card used to flicker “empty then lit” when components remounted or the list scrolled back and forth. Now, once a star is lit it stays lit: entries already queried in the current session are cached locally and reused on remount or cache restore, so the server is not queried again. The backend also returns the favoriteId directly in the response of vocabulary-pack history, mistakes, daily memorize, review queue, and random-pick endpoints, so the star lights up without a second status query. Favoriting or unfavoriting an entry on any page instantly updates the star on every other loaded list card that contains it, with no manual refresh needed. Signing out or switching accounts clears the previous session cache, and the new account sees its own favorite state.',
	},
	'pg-s13-21': {
		title: '13.21 Favorite from practice & merged daily feedback panel',
		description:
			'A favorite button is added to the practice session header, so you can favorite the current item while answering without waiting for the summary or opening the favorites drawer; the daily memorize correct / wrong feedback panels are also visually and interactively unified. Favorite from practice: dictation, spelling, and see-Chinese-write practice cards now show a star button in the top-right of the card header — tap to favorite the current word or classic quote, tap again to unfavorite; state syncs in real time with the resource library and favorites drawer. Merged feedback panel: the correct (green) and wrong (red) daily memorize feedback panels now share the same layout — a header of “status icon + text + favorite button + play button”, distinguished only by color tone — matching the rest of the cards and avoiding the previous style drift. Unified play button: the play button in the daily feedback panel now uses the standard system button style, with hover and active colors aligned to teal-green, matching the resource library and favorites drawer.',
	},
	'pg-s13-22': {
		title: '13.22 Learning-note images on cloud storage with auto-cleanup',
		description:
			'Images inside learning-note bodies are now uploaded to server-side cloud object storage, with only the cloud URL kept in the body — no more base64; desktop pasted images also go through the same cloud upload as the browser. Orphaned objects are also auto-reclaimed, so unused images do not linger. Body stores only cloud URL: when you paste or drop an image, it is first uploaded to cloud object storage, then the cloud address is inserted into the body — a few screenshots no longer bloat the note or slow serialization, and Word export no longer re-encodes each image, making long-note export more stable. Desktop paste auto-upload: desktop pasted images (screenshots, file lists, local images inside rich-text HTML) now automatically upload to the cloud, matching the browser paste experience, instead of being embedded as base64 in the note body. Orphan auto-reclaim: (1) close a new note without saving — if you paste images but close the page without saving, the cloud auto-cleans those unreferenced images after one hour; (2) paste then delete during edit then save — images you delete before saving are reference-counted and reclaimed (when the same image is referenced by multiple notes, deleting one note only drops the reference without affecting the same image in other notes); (3) delete an entire note — when you delete a note, its referenced images are also cleaned up unless another note still references them.',
	},
	'pg-s13-23': {
		title: '13.23 Learning-notes popout window with multi-window sync',
		description:
			'On desktop, learning notes can now be popped out into a standalone window — click "Open in window" on the notes card in the sidebar, and notes open in an independent window alongside the main window, so you can study and take notes at the same time. Open in window: a new "Open in window" button appears on the notes card in the sidebar; clicking it opens notes in a standalone window (slightly smaller than the main window), no longer occupying the main window viewport; clicking again when the popout is already open brings it to the front instead of opening a duplicate. Real-time bidirectional sync: the popout and the main window stay in sync in real time — edit a draft in one window and the other sees the content change instantly; save or delete a note in one window and the list and preview refresh automatically in the other; all sync is done at the host layer, transparent to the plugin. Managed close save: closing the popout does not destroy the window immediately — instead the native close button is intercepted, unsaved drafts are written to the backend before the window is actually closed; network failures do not freeze the window, and it can still be closed. Appearance follow: the popout theme (light / dark), accent color, and language follow the main window in real time, so there is no mismatch.',
	},
	'pg-s13-13': {
		title: '13.13 Classic mistake row fields',
		description:
			'Classic rows show English, Chinese meaning, source, notes, and last wrong input; play reads the full sentence. See §13.12 for navigation and actions.',
	},
	'pg-s14-1': {
		title: 'Topic notes and release overview',
		description:
			'This page targets everyday use. For hosting, reverse proxies, editor edge cases, or contributing, search topic-specific maintainer material in your local clone—feature index, deployment examples, desktop voice, Monaco notes, etc. The in-app Release Notes page (/update-info) is the user-facing “what changed” overview—read it alongside this guide; keep it in sync with maintainer source material before each release.',
	},
	'pg-s15-1': {
		title: '15.1 Service policy and user agreement',
		description:
			'From About: Service Policy and User Agreement open in the system browser (desktop) or a new tab (web), not inside the small About window—same full-page scroll feel as share pages, without main chrome. Routes /service-policy and /user-agreement; available logged out.\nBesides changing UI language in Settings, those pages have a header toggle like the product guide: ?lang= switches zh/en and refreshes body copy immediately.\nLegal copy is product-level; maintainer-edited in code.',
	},
	'pg-s15-2': {
		title: '15.2 Release notes (standalone structured page)',
		description:
			'About also opens Release Notes in the browser. Route /update-info; no main chrome; header plus scroll body like share pages. Regular section layout (not a Markdown preview wall); wording stays aligned with the external release-notes write-up—update structured frontend data when that prose changes.',
	},
	'pg-s15-3': {
		title: '15.3 Product guide (standalone structured page)',
		description:
			'Home “Learn more” opens this guide in the default browser or a new tab. Route /project-guide; full-page scroll; logged-out OK. Header title plus language toggle (?lang=), same pattern as legal standalone pages. Structured sections like release notes; keep frontend guide modules (including English overlay) in sync when this prose changes.',
	},
	'pg-s16-1': {
		title: '16.1 Bookshelf and importing',
		description:
			'Entry: sidebar Bookshelf or /ebook. Managing the shelf, uploads, and progress sync requires sign-in; the page may open when logged out but shelf features will not work.\nMembership: Active members can import files in the browser (upload to cloud) and get cloud backup on desktop after selecting a local file. Non-members cannot import in the browser (a membership prompt appears); on desktop they can still add a local path and read locally without cloud backup.\nDesktop (Tauri): Select local file and pick epub or pdf. The book is added to the shelf immediately and you can tap Read right away; members get a cloud backup in the background (progress bar for large files). Selecting the same local path again shows “already on shelf—no need to upload again.” The file stays on disk; reading prefers local, with cloud fallback if the file is moved or deleted and backup succeeded. One book, one progress record.\nBrowser (members only): Import file uploads epub/pdf to your account shelf; you stay on the shelf and tap Read on the card to open.\nSize limits: about 120MB per file for browser/cloud upload; desktop local reading allows larger files (about 512MB)—you can still read locally if cloud backup fails.\nShelf list: scroll down to load more; each category tab shows its book count. Shelf cards are ordered by last read time (descending)—books you just read float to the top, while unread books still keep their added-time order; the order updates immediately as you read and progress is saved, no manual refresh needed.\nShelf cards: vertical layout with optional custom cover, format (EPUB/PDF), and four-edge progress ring; the progress label uses a whole-number percentage (e.g. “About 12% read”); hover for Read/Continue, set cover, progress, or delete (confirm). Tap the title below the card to edit; Enter saves, Esc or click outside cancels; hover the title to see category and full title (shows Uncategorized when the book has no category or its category was deleted).\nHeader and categories: main app header shows Moke BookHouse > My Bookshelf (same style as Moke BookHouse > Reading). Shelf toolbar: Manage categories | category tabs (All / Public / custom / Uncategorized, scroll horizontally; tabs with zero books are hidden) | Import (hover for hints). Manage categories to create, rename, delete, or reorder; tap the folder icon to the right of the title under a card to move a book (hidden while editing the title). Deleting a category moves its books to Uncategorized. After you move or delete the last book in a category, the view returns to All. New imports default to the selected category (last choice remembered).\nPublic books: owners of cloud-backed EPUB source books can toggle Public / Private from the shelf card or reading header (globe/lock icon, confirm). When public, all signed-in users see the book under All or Public (owner name/avatar) and can tap Read—no share link. Local-only books must be backed up to the cloud before publishing. PDF cannot be published yet. Each reader keeps their own progress, highlights, and notes; owner public reading notes are visible (see 16.6 for underline colors). Unpublishing removes the book from others’ shelves; existing reading records are kept.',
	},
	'pg-s16-2': {
		title: '16.2 Reading, TOC, and page turns',
		description:
			'Reader header: Back returns to the shelf; center shows the book title; EPUB shows previous/next only in Paginated page-flow mode (hidden in Continuous scroll—use scrolling to move between chapters). Both EPUB and PDF have a TOC button (drawer title “Book contents”; PDF uses embedded bookmarks; empty message when none). When the TOC drawer opens, the entry for your current reading position is highlighted and scrolled into view; a scroll button at the bottom-right of the list cycles Scroll to bottom → top → current chapter (icons switch accordingly). In Continuous scroll, tapping a TOC entry scrolls to the start of that chapter (or its in-book anchor) so you can begin reading from the heading.\nPDF page numbers appear between the header page-turn buttons (no footer bar).\nPDF zoom: header zoom out/in and percentage (100% = fit width); about 50%–300%, stored locally.\nPDF scroll page turns: on long pages, scroll to the top or bottom, pause, then scroll again for previous/next page (like EPUB continuous scroll). Single-screen pages turn with the wheel. Header buttons and ↑/←, ↓/→ still work.\nPDF scrollbar: long PDF pages scroll inside the reader with a thin, theme-colored scrollbar matching EPUB continuous scroll.\nProgress saves automatically while reading; reopening the same book restores position when possible. Refreshing the page, closing the tab, or switching away tries to sync immediately to your account, reducing lost position after a hard refresh. During listen-while-reading and other frequent updates, cloud sync requests are merged; local resume position still updates right away.\nEPUB text color: choose among 12 text colors in Reading settings (including follow app); the choice syncs to the header, side panels, input fields, listen menus, settings panel, and TOC so chrome stays readable with the book body.\nWindow size: after you maximize or enlarge the window, EPUB body text re-centers to the new reading width without refreshing. Dragging the MOKE/notes split still stays smooth and avoids white flashes (see 16.3 for settings and split panel).\nKeyboard: ↑ or ← previous page; ↓ or → next page. Ignored when the TOC drawer is open or focus is in an input.\nMain app header shows Moke BookHouse > Reading; the book title appears in the reader header.',
	},
	'pg-s16-3': {
		title: '16.3 EPUB reader settings (EPUB only)',
		description:
			'Entry: while reading EPUB, Reading settings (bolt icon) next to TOC in the reader header.\nAdjust font size and line spacing; 12 reading backgrounds and 12 text colors (swatch picker, including follow app/theme). Follow app uses the same background as Settings → theme colors. Reading background applies to the header, right side panel (notes / MOKE), and settings panel; text color also syncs to side-panel buttons, dividers, MOKE input, listen sentence/speed menus, and the active TOC item highlight.\nPage flow: Continuous scroll (default) or Paginated. In Continuous scroll, EPUB previous/next entries are hidden from the header and context menu; Paginated still shows them. Two side-by-side buttons switch page flow.\nClose overlays: while Reading settings, the listen sentence list, or the speed menu is open, tap the left reading area to close (same as before for settings alone).\nRestore defaults at the bottom of the panel (defaults to continuous scroll).\nPreferences are stored on this device only; changing page flow briefly reloads the book while trying to keep your position. The panel scrolls with the app ScrollArea style when there are many options.',
	},
	'pg-s16-4': {
		title: '16.4 MOKE reading assistant (EPUB & PDF)',
		description:
			'Entry: while reading EPUB or PDF, tap the Bot icon in the reader header, or Right-click → Reading assistant in the reading area. EPUB also supports body right-click (assistant when nothing is selected; copy, MK ask, and write note only after you drag-select first—right-click alone does not auto-select a word). Opening the context menu dismisses the floating selection toolbar if it was visible.\nLayout: reader left, MOKE assistant right, draggable split (~50% each by default); not a modal or drawer. While dragging the split, EPUB text reflows smoothly and user highlights do not flash white. Opening MK from the reading-notes side panel keeps the split width; closing MK restores full-width reading when no other right panel applies, or returns to notes if you were in the list/details. Closing the notes list, deleting the last note, or after a dev hot reload also restores full width immediately with no blank right column.\nRequires sign-in; ask about the book, context, or takeaways. Streaming scroll matches the knowledge assistant (scroll up to stop auto-follow; position kept after streaming ends). One independent session per book.\nInput focus: opening MK ask from a selection (or focusing the assistant input after opening from the header) focuses the right-panel input after the split settles; switching between reading notes and MK also refocuses the visible panel’s input so you can type immediately.\nAI reply actions: copy, Save to knowledge base (opens the knowledge editor), or Share the current Q&A pair.\nPDF: no ask-about-selection because PDF text cannot be selected; other assistant features match EPUB.\nKeyboard: when the assistant is open and the input is focused, page-turn shortcuts (↑/←/↓/→) are ignored.',
	},
	'pg-s16-5': {
		title: '16.5 PDF reading context menu (PDF only)',
		description:
			'Entry: right-click inside the PDF reading area.\nItems (top to bottom): Reading assistant → TOC → Zoom in/out → Previous/Next page.\nRepeated zoom clicks keep the menu open; TOC and page turns match the header controls.',
	},
	'pg-s16-6': {
		title: '16.6 EPUB reading notes (EPUB only)',
		description:
			'Entry: select text → floating toolbar or right-click → Write note; or tap the dashed underline to open the list.\nThe floating toolbar uses a frosted panel so it stays readable on dark reading backgrounds and colored themes; after copy, a brief Copied state shows before the selection clears.\nUI: list, details, and compose use the right reading column (mutually exclusive with 16.4 MK ask-about-selection; same resizable slot). Header shows title and note count; close on top-right; Cancel/Save at the panel footer when composing, Delete/Edit when viewing.\nList & details: avatar, username, publish time, and body; quote card shortcuts for copy, write note, MK ask, and Share quote (see 16.4 and 16.8).\nCompose/edit: up to 500 characters; Enter to save, Shift/Ctrl/Cmd+Enter for new lines; input fixed at the panel footer with quote/details scrolling above. Opening Write note from a selection focuses the input after the split settles so you can type immediately; switching back from MK ask refocuses it as well.\nMark: amber dashed underline after save; restored when reopening the book. On publicly shared EPUBs, owner/others’ notes use gray dashes and yours amber; where yours overlaps theirs, only your underline shows; multiple partially overlapping notes of your own also render as one underline.\nView: tap underline → list first (even one note) → item for details; closing details returns to the list when opened from it; if the list is empty, the side panel closes.\nDelete: after deleting a note in details, if no notes remain in the list, the reading-notes panel closes; otherwise you return to the updated list. Note body alignment matches the list when entering details.\nClick aggregation: nested selections (whole paragraph plus sub-phrases) default to the full excerpt with every related note listed. Adjacent phrases merge only when punctuation or line breaks between them also have notes—unannotated gaps stay separate. Group section headers support expand/collapse for long excerpts.\nList actions: a single tap on a note opens its details (no longer switches the quote excerpt); the list quote area is not tappable to jump to the in-book PopBar—use the footer action bar for highlights.\nReading position & quote stay in view: opening or closing the right panel, dragging the split, or resizing the window keeps the current reading line on screen as much as possible; when a quote excerpt is shown in the side panel, that passage also stays in view instead of scrolling away after the column resizes.\nOverlapping selections: one visible underline for nested or partially overlapping ranges; opening the list follows the aggregation rules above.\nSelection: drag-release does not open the list—tap the underline intentionally.\nSign-in & sync: sign-in required; notes on your account; deleting the book removes its notes.\nPDF not supported yet; independent from MK ask-about-selection.',
	},
	'pg-s16-7': {
		title: '16.7 EPUB user highlights (EPUB only)',
		description:
			'Entry: select text → floating toolbar → Highlight; or tap an existing colored mark to change style or remove. The reading-notes sidebar quote area also offers Highlight (creates one if missing) or Remove highlight (matches the selection toolbar: Remove highlight only when the entire displayed quote excerpt is already highlighted; otherwise Highlight adds a highlight for the full excerpt). The same toolbar also offers Share quote (see 16.8).\nStyles: background fill, straight underline, or wavy underline; five preset colors (pink, purple, blue, green, yellow), plus Custom color on the style strip to pick any hue and adjust fill opacity (saved per highlight).\nStyle strip: on a fresh selection with no user highlight yet, the top style/color strip is hidden; it appears once the selection already has a user highlight (including partial coverage) so you can change style or color.\nMerge: overlapping or adjacent highlights become one mark; the latest color and style win.\nScope: highlights match by position—duplicate sentences in the book do not affect each other.\nToolbar: Remove highlight when the whole selection is already highlighted; Highlight when mixed or not highlighted yet (single slot, no empty gap).\nSmoothness: marks appear sooner after highlight, remove, or reading notes, and scrolling stays responsive during sync; the toolbar no longer flashes when switching highlight state.\nVs notes: solid user marks vs amber dashed note underlines (16.6). Both can exist on the same passage; dashes hide when fully covered by a fill until you remove the highlight.\nSign-in & sync: sign-in required; highlights on your account; deleting the book removes its highlights.\nPDF not supported yet.',
	},
	'pg-s16-8': {
		title: '16.8 EPUB quote share (EPUB only)',
		description:
			'Entry: while reading EPUB, select text → floating toolbar → Share quote; or tap Share quote on the quote card footer in the reading-notes list or details.\nGeneration: opens a Share quote dialog with an auto-generated calendar-style card showing today’s date, the excerpt, book title, and Moke BookHouse branding; font sizes and weights are preserved when possible.\nDialog & preview: the dialog title and buttons follow your reading background and text color for readability; the generated share image and preview area keep the fixed light-gray calendar card look for sharing outward.\nActions: copy the image to the system clipboard to paste into WeChat and similar apps, or download a PNG file.\nNotes: the selection toolbar can stay visible while the share dialog is open; the MK assistant side panel is unaffected. PDF quote share is not supported yet.',
	},
	'pg-s16-9': {
		title: '16.9 EPUB quote “Listen” (EPUB only)',
		description:
			'Entry: while reading EPUB, select text → floating toolbar → Listen; or tap Listen on the quote card footer in the reading-notes list or details.\nPlayback: starts at the sentence that contains the selection and continues downward like full Listen (not only the selected span). Same TTS stack as English learning (active members default to cloud; local speech otherwise). The button label stays Listen—each tap restarts from the current selection; use the bottom bar to pause/resume.\nBar: quote Listen shares the same bottom bar as listen-while-reading (pause/resume, stop, sentence list, previous/next chapter, speed 0.5×–3×). While speech is loading, the play button shows a loading state.\nSelection bar: tapping Listen dismisses the floating toolbar and clears the text highlight.\nSentence highlight: light yellow on the current sentence; clears on handoff; independent from user highlights and reading-note underlines.\nAuto-follow: the current sentence scrolls into view while playing. Manual scroll or selecting body text pauses follow; a bottom-right button returns to playback and resumes follow.\nNotes: PDF has no Listen entry yet.',
	},
	'pg-s16-10': {
		title: '16.10 EPUB listen while reading (EPUB only)',
		description:
			'Entry: while reading EPUB, tap the headphones icon left of the Bot icon in the header to start Listen to book; tap again to stop.\nPlayback: continuous TTS from the visible chapter (or the sentence at your current reading position). With cloud voice, audio is synthesized by paragraph while the UI still highlights sentence by sentence (first sentence starts sooner); advances to the next spine section at section end; shows a message when the book is finished. In continuous scroll reading mode, playback continues into the next on-screen block after the current section finishes. Full-line decorative separators (such as a long run of asterisks) are not spoken.\nBar: a fixed bottom bar with pause/resume, stop, sentence list jump, previous/next chapter, playback speed 0.5×–3× (ruler in 0.1 steps), and chapter/sentence progress. Previous/next chapter and jumps from the sentence list do not exit playback.\nPause and resume: resume continues from where you paused; system Control Center or headset media keys stay in sync with the bar. Stop or tapping Listen again ends speech and unbinds media-key handlers.\nSentences menu: tap Sentences (list icon) on the bar to open a per-chapter list; tap any line to start from that sentence and scroll it to the center of the screen—the list scrolls to the line currently playing when opened; long chapters use virtual scrolling; a header scroll button cycles Scroll to bottom → top → current sentence (icons switch accordingly). Use this menu for sentence jumps (bar arrows now change chapters). After you change the reading background, the active sentence’s highlight colors follow the reading text color so it stays readable.\nLoading: whenever the utterance about to play is still loading and has not started (start listen, chapter change, sentence jump, between paragraph packs, etc.), the play button shows a loading state and is not clickable until speech starts, then switches to pause. Do not rely on Touch Bar / Control Center controls while loading—system media keys only stay in sync with the player bar after audio begins. Background prefetch of the next segment does not alone trigger loading.\nSpeed: tap the speed button (e.g. 1.0 X) to open a ruler panel—drag or tap round presets (1.0, 1.5, 2.0, etc.) for 0.5×–3×; with cloud voice, heard speed matches the UI. Speed is synced to your account and applies to all books by default; turn on Apply to this book only under the panel to limit it to the current book—others keep their own speed or the default 1.0×. You can open or change speed while speech is loading; an open speed panel does not close when the next sentence starts loading.\nHighlight: light yellow tint on the current sentence (same as quote Listen); clears at sentence end; independent from user highlights and reading-note underlines; stays aligned when you resize the right sidebar or toggle the reading-notes panel.\nAuto-follow: the current sentence scrolls into view while playing; manual scroll, wheel, or selecting body text pauses follow—a bottom-right button returns to the playing line and resumes follow (works even after scrolling to a distant chapter in continuous scroll).\nTOC / bar chapter jump: while listening, picking another chapter in the book TOC or tapping previous/next chapter on the bar continues from the start of that section (TOC entry) and keeps your playback speed. If several TOC entries share one chapter file (split by in-page anchors), jumps land on the matching section rather than the start of the whole file. The bar uses the sentence currently being spoken to decide the current section before choosing neighbors.\nVs quote Listen: selection/thought Listen joins the same playback session as header Listen and continues reading; starting Listen again from a new selection restarts from that selection. PDF has no listen-while-reading yet.\nVs assistant selection-speak: chapter Listen and selection-speak in the assistant panel share one audio engine on the reader page, so they are strictly mutually exclusive. Starting chapter Listen automatically stops any selection-speak in progress; using “read aloud” on a selection in the assistant panel first stops the current chapter Listen before starting the new朗读. For continuous reading, use chapter Listen; for one-off reading of a passage, stop Listen first then use selection-speak.',
	},
	'pg-s16-11': {
		title: '16.11 EPUB reader plugins: all ideas & all highlights (EPUB only)',
		description:
			'Entry: while reading an EPUB, tap All ideas (lightbulb) or All highlights (highlighter) next to the toolbar TOC button.\nAll ideas: opens a bottom drawer listing every idea in the current book with scroll pagination; the header shows the book title and loaded count; tap an item to jump to its highlight position and open the idea detail.\nAll highlights: opens a bottom drawer listing every user highlight with scroll pagination; tap an item to jump to its position.\nNotes: requires sign-in; data is shared with reading ideas and user highlights. EPUB only; PDF not supported.',
	},
	'pg-s17-1': {
		title: '17.1 Open the plugin center',
		description:
			'Entry: Plugin Center (flower icon) in the left sidebar, or visit /plugins. Toggling modules and editing the registry require signing in.',
	},
	'pg-s17-2': {
		title: '17.2 Enable / disable (shelf toggle)',
		description:
			'Card list: the page shows every available module as a card with a name, description, and switch. Enable (switch on): the state is saved to your account and takes effect immediately—the sidebar entry appears and the module is usable; if it has not been downloaded yet, it loads on first entry. Disable (switch off): the state is also saved and takes effect immediately—the sidebar entry disappears and any open page is unloaded; enabling again restores it. Load failure: if a module fails to load, the page shows a stable message with manual retry—no flicker loops—and other features are unaffected.',
	},
	'pg-s17-3': {
		title: '17.3 Registry editor (advanced)',
		description:
			'Entry: the registry editor entry inside the plugin center (sign-in required). Purpose: view and edit the raw module list as JSON; saving reloads the configuration automatically. Field help: the info icon beside the title explains each field (including the difference between version and Host API compatibility range). Set module icon: open the module list from the title bar and upload an SVG for a chosen module; on success the sidebar and (if present) surface trigger icon fields are written. Monochrome artwork follows the host selected color and the same hover stroke animation; changing an icon only needs the registry upload, not a host code change. Shortcuts: ⌘/Ctrl+S saves; an orange dot on the save control indicates unsaved changes. Validation: structural checks run on save, and each module’s Host API compatibility range is verified; invalid content is rejected with a message and not written.',
	},
	'pg-s17-4': {
		title: '17.4 Video player plugin',
		description:
			'Enable: turn on the Video Player card in the Plugin Center; a TV-icon entry appears in the sidebar. Upload: on the page, click the drop zone or drag-and-drop local video files into the area; up to 100 files can be selected at once. Playback modes: the top-left mode button switches between Auto Play, Loop One, and Stop When Finished. Custom control bar: the progress bar at the bottom is clickable to seek; hovering shows a video-frame thumbnail preview and a time tip, with automatic inward clearance when near the bar edges; dragging the thumb fine-seeks. Icons on the right are, in order: mirror flip, settings panel (playback mode / rate), Picture-in-Picture, fullscreen, and playlist. The volume button opens a vertical slider with mute toggle. The playback rate button opens a dial that supports arrow-key adjustments between 0.5X and 3.0X in 0.1 steps, plus five preset buttons (0.5X / 1.0X / 1.5X / 2.0X / 3.0X). Tick labels and preset buttons auto-adapt to light / dark themes, so they stay readable. Picture-in-Picture (PiP): click the PiP button to shrink the video into a floating window; works on Chrome / Edge / Firefox / Safari (macOS / iOS) and other mainstream browsers; when PiP is active, the main player area shows a hint overlay, and play/pause actions inside the PiP window sync back to the main player; entering PiP while playing resumes playback on exit; entering while paused stays paused on exit. Tooltips: the small hints on progress, volume, rate, and playlist controls now appear consistently in both the standalone preview and the host-mounted plugin page, no longer missing in certain entry points. Player language follows the host: switching the interface language (zh / en) automatically switches the player’s internal buffering hints to the matching language. Theater fullscreen: clicking the fullscreen button hides the host sidebar, header, and ICP footer for a true theater experience. On Tauri the app window is taken to system fullscreen; in the browser it falls back to document fullscreen. Press Esc or click the fullscreen button again to exit. On macOS desktop, exiting fullscreen via the green traffic-light button or the window menu "Enter Full Screen" option also collapses the sidebar and header before the resize animation begins, giving a perfectly consistent visual experience with pressing Esc. Multi-file playlist: when multiple files are uploaded, the list icon in the bottom-right opens a scrollable playlist for switching. When playback ends, the next file starts or stops depending on the current mode. Cleanup: leaving the player page automatically exits theater mode and destroys the player instance so other pages are not affected. Add more / reset: while playing, click the "+ Continue" button in the bottom-right to add more files; clicking "Reset" now thoroughly clears the current playlist, preview state, and held local file handles.',
	},
	'pg-s17-5': {
		title: '17.5 Plugins / Apps tabs and cards',
		description:
			'Tab split: the Plugin Center now has two tabs at the top—"Plugins" and "Apps". Business-embedded modules (e.g. the e-book reader plugin, auto-mounted inside a business page) go under "Plugins"; standalone-route modules (e.g. the video player, with its own page entry) go under "Apps". Each tab carries a count badge, and each empty state has its own hint. Three-section card: every card is divided top-to-bottom into—header: icon (prefers the registry-configured SVG icon; when missing, plugins show a puzzle icon and apps show an app-window icon), title and version, and enable switch; body: description; footer: a single line showing the route path, sidebar presence, and trust level (e.g. "Untrusted" carries a Chinese explanation). App "Enter" button: cards under the Apps tab have an "Enter" button on the right of the footer—after enabling, you can click it to jump straight to the page, without first finding the entry in the sidebar; the button is disabled when not enabled, while switching, or when there is no route. Untrusted-plugin theme follow: modules running in isolated iframes now follow the host theme and accent color in real time—after switching "Settings → Accent color" or the light/dark theme, button, link, and border colors inside the iframe change in sync; in dark mode the outlined-button border no longer disappears.',
	},
	'pg-s17-6': {
		title: '17.6 Registry access, theme and sheet light-mode UX',
		description:
			'Registry permissions: the "Edit Registry" entry in the Plugin Center header is visible only to Super Admin accounts—regular signed-in users neither see the entry nor can save via the API, which instead rejects the request with "Super admin privileges required"; you can still browse the JSON structure inside the editor page, but only admins save via ⌘/Ctrl+S. Light-theme sheet & card borders: when you toggle light/dark or accent colors in "Settings → Appearance", cards, modals, and side sheets all render a soft ink border around all four sides so they never look like pure white blocks floating on a white background; card edges and tinted backgrounds also get a faint ink outline so nothing feels floating. Body text stays readable: in light theme body descriptions, headings, and captions all use a dark ink, avoiding any white-on-white scenario. Hero gradient stays intact: the large gradient title on the home stage still renders its original white-gradient effect, independent of the ink-baseline token used elsewhere. Dark theme is unchanged.',
	},
	'pg-s17-7': {
		title: '17.7 No white flash when switching plugin pages',
		description:
			'When entering or switching to an untrusted plugin page in dark theme, the container now paints the host theme background first, then seamlessly hands off once the plugin is ready—no more brief white flash during the handshake phase.',
	},
};
