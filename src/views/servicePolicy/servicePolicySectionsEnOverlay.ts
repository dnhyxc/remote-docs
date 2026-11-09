/** 用户服务政策英文正文（与 servicePolicySections.ts 中章节/条目 id 一一对应）。 */
export const SERVICE_POLICY_SECTION_TITLES_EN: Record<string, string> = {
	'sp-s1': '1. Scope and definitions',
	'sp-s2': '2. Accounts and access',
	'sp-s3': '3. Content and acceptable use',
	'sp-s4': '4. Changes and interruptions',
	'sp-s5': '5. Contact and updates',
};

export const SERVICE_POLICY_ITEMS_EN: Record<
	string,
	{ title: string; description: string }
> = {
	'sp-s1-1': {
		title: '1.1 Who this policy covers',
		description:
			'This User Service Policy (“Policy”) applies when you access or use dnhyxc-ai (“Product”), including desktop and web clients.',
	},
	'sp-s1-2': {
		title: '1.2 What the product offers',
		description:
			'The Product offers AI-assisted features such as chat and Markdown-based knowledge management. Available features depend on your version and may change over time.',
	},
	'sp-s2-1': {
		title: '2.1 Sign-in and credentials',
		description:
			'Some features require registration and sign-in. You are responsible for safeguarding credentials and for activity under your account.',
	},
	'sp-s2-2': {
		title: '2.2 Local-only when signed out',
		description:
			'When you are not signed in, the Product may offer limited or local-only knowledge features; data may remain on your device per the UI and actual network behavior.',
	},
	'sp-s3-1': {
		title: '3.1 Content you submit',
		description:
			'Your prompts, uploads, and knowledge content must comply with applicable laws and must not infringe others’ rights or contain unlawful or harmful material.',
	},
	'sp-s3-2': {
		title: '3.2 AI output is not professional advice',
		description:
			'AI outputs are probabilistic and not professional advice (e.g. medical, legal, or financial). Seek qualified professionals for important decisions.',
	},
	'sp-s4-1': {
		title: '4.1 We may change features',
		description:
			'We may suspend or adjust features for maintenance, upgrades, compliance, or force majeure, and will try to notify you in-product or via notices.',
	},
	'sp-s4-2': {
		title: '4.2 Unavailability',
		description:
			'We are not liable, to the extent permitted by law, for unavailability due to networks, third parties, or your devices and configuration.',
	},
	'sp-s5-1': {
		title: '5.1 How to contact us',
		description:
			'For questions about this Policy, use in-product feedback or official contact channels.',
	},
	'sp-s5-2': {
		title: '5.2 How this policy changes',
		description:
			'We may revise this Policy from time to time; material changes will be highlighted reasonably. Continued use after updates constitutes acceptance.',
	},
};
