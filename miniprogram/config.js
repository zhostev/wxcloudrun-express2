/**
 * 904 班级账本小程序 · 配置文件
 *
 * BASE_URL：后端（微信云托管 Express）的生产域名：
 *   https://904api.hoo.ink
 * 注意末尾不要带斜杠。留空时小程序启动会弹窗提示。
 *
 * 邀请码：网页端 https://904.s7ea.com 签发到 Cloudflare Worker/D1；
 * 小程序仍走本域名（备案 + 微信合法域名）。云托管在本地 MySQL 无码时会回源
 * Worker 核销（INVITE_UPSTREAM_BASE，默认 https://904.s7ea.com），再签发云托管会话。
 * 不要把 BASE_URL 改成 904.s7ea.com：Worker 未配 WX_SECRET，且 /api/me 响应形状不同。
 *
 * 微信一键登录依赖服务端能解析 openid，当前走公网域名 wx.request，
 * 云托管不会注入 x-wx-openid，因此必须在云托管环境变量配置：
 *   WECHAT_APPID=wx2861b42fc732bdf4（可不配，后端已有默认）
 *   WECHAT_SECRET=<小程序 AppSecret，来自 mp.weixin.qq.com>
 * 另需已配置 SESSION_SECRET（>=16 字符）才能签发登录 token。
 * 若 toast「连接微信服务失败：fetch failed」：云托管关闭「开放接口服务」并重新部署。
 */
module.exports = {
  BASE_URL: "https://904api.hoo.ink",
};
