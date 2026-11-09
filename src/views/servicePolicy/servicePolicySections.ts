/**
 * 用户服务政策正文（中文为源；英文见 servicePolicySectionsEnOverlay.ts）。
 * 产品级通用条款，具体以运营主体与司法管辖为准。
 */
import type { Locale } from '@/i18n';
import {
	SERVICE_POLICY_ITEMS_EN,
	SERVICE_POLICY_SECTION_TITLES_EN,
} from './servicePolicySectionsEnOverlay';

export type ServicePolicySection = {
	id: string;
	title: string;
	items: { id: string; title: string; description: string }[];
};

const SERVICE_POLICY_SECTIONS_ZH: ServicePolicySection[] = [
	{
		id: 'sp-s1',
		title: '1. 适用范围与定义',
		items: [
			{
				id: 'sp-s1-1',
				title: '1.1 本政策约束谁',
				description:
					'本《用户服务政策》（下称「本政策」）适用于您访问或使用 dnhyxc-ai（下称「本产品」）及相关客户端、网页端时，我们就服务内容、使用规范与责任边界向您作出的说明。',
			},
			{
				id: 'sp-s1-2',
				title: '1.2 产品提供什么',
				description:
					'本产品提供以对话（Chat）、知识库（Markdown 编辑与检索）等为核心的智能辅助能力；具体功能以您当前版本界面为准，并可能随版本迭代调整。',
			},
		],
	},
	{
		id: 'sp-s2',
		title: '2. 账号与访问',
		items: [
			{
				id: 'sp-s2-1',
				title: '2.1 登录与保管',
				description:
					'部分能力需要您注册并登录账号后方可使用；您应妥善保管账号与认证信息，对账号下的操作行为负责。',
			},
			{
				id: 'sp-s2-2',
				title: '2.2 未登录时的本地能力',
				description:
					'若您未登录，本产品可能以「仅本地」等降级方式提供部分知识库能力，此时相关数据主要保留在您的设备或您指定的本地目录，不上传至我们的服务器（以实际界面与网络请求为准）。',
			},
		],
	},
	{
		id: 'sp-s3',
		title: '3. 内容与合规使用',
		items: [
			{
				id: 'sp-s3-1',
				title: '3.1 你提交的内容',
				description:
					'您输入的提示、上传的附件及在知识库中编辑的内容，应遵守法律法规及公序良俗，不得含有违法、侵权、恶意程序或侵害他人合法权益的信息。',
			},
			{
				id: 'sp-s3-2',
				title: '3.2 AI 输出不是专业意见',
				description:
					'您理解 AI 输出具有概率性与局限性，不构成专业意见（如医疗、法律、投资等）；重要决策请咨询具备资质的专业人士。',
			},
		],
	},
	{
		id: 'sp-s4',
		title: '4. 服务变更与中断',
		items: [
			{
				id: 'sp-s4-1',
				title: '4.1 我们可能调整功能',
				description:
					'我们可能因维护、升级、合规或不可抗力等原因暂停或调整部分功能，并将尽力通过产品内提示或公告等方式告知。',
			},
			{
				id: 'sp-s4-2',
				title: '4.2 不可用时的责任',
				description:
					'因网络环境、第三方服务、您本地设备或配置导致的服务不可用，我们在法律允许范围内不承担责任。',
			},
		],
	},
	{
		id: 'sp-s5',
		title: '5. 联系我们与政策更新',
		items: [
			{
				id: 'sp-s5-1',
				title: '5.1 如何联系',
				description:
					'如您对本政策有疑问，可通过产品内提供的反馈渠道或官网联系方式与我们沟通。',
			},
			{
				id: 'sp-s5-2',
				title: '5.2 政策如何更新',
				description:
					'我们可能适时修订本政策；重大变更时将以合理方式提示。您在变更后继续使用本产品，即视为知悉并同意更新后的政策。',
			},
		],
	},
];

export function getServicePolicySections(locale: Locale): ServicePolicySection[] {
	if (locale !== 'en-US') return SERVICE_POLICY_SECTIONS_ZH;
	return SERVICE_POLICY_SECTIONS_ZH.map((sec) => ({
		...sec,
		title: SERVICE_POLICY_SECTION_TITLES_EN[sec.id] ?? sec.title,
		items: sec.items.map((it) => {
			const en = SERVICE_POLICY_ITEMS_EN[it.id];
			return en ? { ...it, title: en.title, description: en.description } : it;
		}),
	}));
}
