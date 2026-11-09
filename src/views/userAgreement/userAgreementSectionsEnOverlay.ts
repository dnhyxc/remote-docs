/** 用户服务协议英文正文（与 userAgreementSections.ts 中章节/条目 id 一一对应）。 */
export const USER_AGREEMENT_SECTION_TITLES_EN: Record<string, string> = {
	'ua-s1': '1. Acceptance and changes',
	'ua-s2': '2. Description of services',
	'ua-s3': '3. User conduct',
	'ua-s4': '4. Intellectual property',
	'ua-s5': '5. Disclaimer and limitation of liability',
	'ua-s6': '6. Termination',
	'ua-s7': '7. Governing law and disputes',
};

export const USER_AGREEMENT_ITEMS_EN: Record<
	string,
	{ title: string; description: string }
> = {
	'ua-s1-1': {
		title: '1.1 Use means acceptance',
		description:
			'By registering, signing in, installing, or using dnhyxc-ai (“Product”), you agree to this User Service Agreement (“Agreement”).',
	},
	'ua-s1-2': {
		title: '1.2 Continued use after changes',
		description:
			'We may update this Agreement; continued use after notice constitutes acceptance. Stop using the Product if you disagree.',
	},
	'ua-s2-1': {
		title: '2.1 What we provide',
		description:
			'The Product provides AI-assisted chat, Markdown knowledge features, sharing, settings, and related capabilities as actually offered.',
	},
	'ua-s2-2': {
		title: '2.2 Third-party dependencies',
		description:
			'Some features rely on third-party models or infrastructure; availability and quality may vary.',
	},
	'ua-s3-1': {
		title: '3.1 Prohibited use',
		description:
			'You must not use the Product unlawfully, compromise security, or access others’ data without authorization.',
	},
	'ua-s3-2': {
		title: '3.2 You are responsible for content',
		description:
			'You represent you have rights or permission for content you submit and bear responsibility for disputes arising from it.',
	},
	'ua-s4-1': {
		title: '4.1 Rights in the product',
		description:
			'Software, UI, documentation, and marks belong to us or licensors and may not be copied or exploited without permission.',
	},
	'ua-s4-2': {
		title: '4.2 Use of generated output',
		description:
			'You are responsible for lawful use of model outputs and for not infringing third-party rights.',
	},
	'ua-s5-1': {
		title: '5.1 Provided as is',
		description:
			'The Product is provided “as is” without warranties as to accuracy or fitness of AI outputs.',
	},
	'ua-s5-2': {
		title: '5.2 Cap on liability',
		description:
			'To the maximum extent permitted by law, we are not liable for indirect or consequential damages; direct liability may be capped by fees paid for the disputed service where applicable.',
	},
	'ua-s6-1': {
		title: '6.1 Stopping and suspension',
		description:
			'You may stop using the Product and close your account if available. We may suspend or terminate access for material breach or legal requirements.',
	},
	'ua-s7-1': {
		title: '7.1 Governing law',
		description:
			'This Agreement is governed by the laws of the jurisdiction where the operating entity is located (placeholder; see published notices).',
	},
	'ua-s7-2': {
		title: '7.2 Disputes',
		description:
			'Disputes should first be resolved amicably; otherwise they may be submitted to competent courts as disclosed in product notices.',
	},
};
