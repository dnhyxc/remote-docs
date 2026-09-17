# 支付与会员（pay）

Stripe 嵌入式收银台、会员套餐定价、开通/续期/到期校正，以及个人资料页会员展示。

| 专题 | 说明 |
|------|------|
| [Stripe会员计费.md](./Stripe会员计费.md) | **主文档**：Stripe 三档会员充值、后端开通逻辑、资料页与支付页前端 |
| [会员开通幂等.md](./会员开通幂等.md) | Webhook + 完成回调并发防双次加时 |
| [会员激活钩子.md](./会员激活钩子.md) | 前端 `useMembershipActive` Hook、资料页金色会员标识 |
| [支付页布局重构.md](./支付页布局重构.md) | 支付页改为 `ScrollArea` + `ProfileLayout` 壳层适配；移除 header 与 Stripe 徽标；文案精简；新增测试账号拦截 |
| （规划） | 微信扫码（YunGouOS）见仓库内后端 SPEC `yungouos-wechat-native-membership.md`，尚未落地 |

**常见排查**

| 现象 | 优先阅读 |
|------|----------|
| 支付成功但资料页仍非会员 | [Stripe会员计费.md](./Stripe会员计费.md) §6、§9 |
| 会员到期仍显示徽章 | 同上 §7（`memberExpiresAt` 与读时校正） |
| 会员到期日多约一个套餐周期 | [会员开通幂等.md](./会员开通幂等.md) |
