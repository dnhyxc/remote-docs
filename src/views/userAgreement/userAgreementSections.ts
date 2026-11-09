/**
 * 用户服务协议正文（中文为源；英文见 userAgreementSectionsEnOverlay.ts）。
 * 产品级通用条款，具体以运营主体与司法管辖为准。
 */
import type { Locale } from '@/i18n';
import {
	USER_AGREEMENT_ITEMS_EN,
	USER_AGREEMENT_SECTION_TITLES_EN,
} from './userAgreementSectionsEnOverlay';

export type UserAgreementSection = {
	id: string;
	title: string;
	items: { id: string; title: string; description: string }[];
};

const USER_AGREEMENT_SECTIONS_ZH: UserAgreementSection[] = [
	{
		id: 'ua-s1',
		title: '1. 协议的接受与修订',
		items: [
			{
				id: 'ua-s1-1',
				title: '1.1 使用即表示同意',
				description:
					'欢迎使用 dnhyxc-ai。当您注册、登录、下载、安装或以其他方式使用本产品时，即表示您已阅读并同意受本《用户服务协议》（下称「本协议」）约束。',
			},
			{
				id: 'ua-s1-2',
				title: '1.2 修订后继续使用',
				description:
					'我们有权根据业务与法律要求修订本协议；更新后将在产品中或以其他合理方式公示。若您不同意修订内容，请停止使用；继续使用视为接受修订后的协议。',
			},
		],
	},
	{
		id: 'ua-s2',
		title: '2. 服务说明',
		items: [
			{
				id: 'ua-s2-1',
				title: '2.1 提供的能力',
				description:
					'本产品向您提供人工智能辅助的对话、知识库编辑与检索、分享与设置等相关功能；具体以实际提供为准。',
			},
			{
				id: 'ua-s2-2',
				title: '2.2 第三方依赖',
				description:
					'部分能力依赖第三方模型、检索或存储服务，其可用性与响应质量可能受网络、配额及第三方政策影响。',
			},
		],
	},
	{
		id: 'ua-s3',
		title: '3. 用户行为规范',
		items: [
			{
				id: 'ua-s3-1',
				title: '3.1 禁止的行为',
				description:
					'您不得利用本产品从事违法违规活动，不得干扰或破坏服务与系统安全，不得未经授权访问他人数据。',
			},
			{
				id: 'ua-s3-2',
				title: '3.2 你对内容负责',
				description:
					'您对提交的内容拥有合法权利或已获授权；因您提供的内容引起的纠纷与责任，由您自行承担。',
			},
		],
	},
	{
		id: 'ua-s4',
		title: '4. 知识产权',
		items: [
			{
				id: 'ua-s4-1',
				title: '4.1 产品本身的权利',
				description:
					'本产品中的软件、界面、文档及商标等知识产权归我们或权利人所有，未经许可不得复制、修改或商业使用。',
			},
			{
				id: 'ua-s4-2',
				title: '4.2 生成内容的使用',
				description:
					'在适用法律允许的范围内，您对基于本产品生成的输出之使用由您自行判断与负责；请勿侵犯第三方权利。',
			},
		],
	},
	{
		id: 'ua-s5',
		title: '5. 免责声明与责任限制',
		items: [
			{
				id: 'ua-s5-1',
				title: '5.1 按现状提供',
				description:
					'本产品按「现状」提供，我们不对 AI 生成内容的准确性、完整性或适用性作担保。',
			},
			{
				id: 'ua-s5-2',
				title: '5.2 责任上限',
				description:
					'在法律允许的最大范围内，我们对因使用或无法使用本产品而产生的间接、附带或惩罚性损害不承担责任；我们对您的赔偿责任以您就争议服务已支付的费用为上限（若适用且无相反强制性规定）。',
			},
		],
	},
	{
		id: 'ua-s6',
		title: '6. 协议终止',
		items: [
			{
				id: 'ua-s6-1',
				title: '6.1 停止使用与中止服务',
				description:
					'您可随时停止使用并注销账号（若产品提供该能力）。我们可在您严重违约或法律法规要求时中止或终止向您提供服务。',
			},
		],
	},
	{
		id: 'ua-s7',
		title: '7. 适用法律与争议解决',
		items: [
			{
				id: 'ua-s7-1',
				title: '7.1 适用法律',
				description:
					'本协议的订立、效力与解释均适用中华人民共和国大陆地区法律（仅为示例，实际以运营主体所在地及公示为准）。',
			},
			{
				id: 'ua-s7-2',
				title: '7.2 争议解决',
				description:
					'因本协议引起的争议，双方应友好协商；协商不成的，提交有管辖权的人民法院诉讼解决（具体管辖以届时公示或专属协议为准）。',
			},
		],
	},
];

export function getUserAgreementSections(locale: Locale): UserAgreementSection[] {
	if (locale !== 'en-US') return USER_AGREEMENT_SECTIONS_ZH;
	return USER_AGREEMENT_SECTIONS_ZH.map((sec) => ({
		...sec,
		title: USER_AGREEMENT_SECTION_TITLES_EN[sec.id] ?? sec.title,
		items: sec.items.map((it) => {
			const en = USER_AGREEMENT_ITEMS_EN[it.id];
			return en ? { ...it, title: en.title, description: en.description } : it;
		}),
	}));
}
