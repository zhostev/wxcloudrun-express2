// 登录 API：微信 / 邀请码 / 班主任密码
const express = require("express");
const { Member, sequelize } = require("../db");
const { AppError, sha256Hex, randomToken, GENERIC_AUTH_MESSAGE } = require("../lib/util");
const { issueToken, exchangeWechatCode, checkOwnerPassword, auth, publicMember, permissions, sessionSecret } = require("../lib/auth");
const { redeemCode } = require("../lib/members");
const { appendAudit } = require("../lib/audit");

const router = express.Router();

const COOKIE_OPTS = {
  httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production",
  maxAge: 30 * 24 * 3600 * 1000, path: "/",
};

function setSessionCookie(res, token) {
  res.cookie("ledger_session", token, COOKIE_OPTS);
}
function clearSessionCookie(res) {
  res.clearCookie("ledger_session", { ...COOKIE_OPTS, maxAge: 0 });
}

function memberPayload(member) {
  return { ...publicMember(member.get({ plain: true })), permissions: permissions(member) };
}

// 限流（与 Worker 版 auth_throttle 同义）：微信登录按 openid+ip，邀请码按 ip
const attempts = new Map();
function throttle(key, limit, windowMs) {
  if (attempts.size > 10000) attempts.clear();
  const now = Date.now();
  const arr = (attempts.get(key) || []).filter((t) => now - t < windowMs);
  arr.push(now);
  attempts.set(key, arr);
  return arr.length <= limit;
}
function clientIp(req) {
  return String(req.headers["x-forwarded-for"] || "").split(",")[0].trim() || req.ip || "unknown";
}

// 可信微信 openid：微信云托管会在请求头注入 x-wx-openid（平台可信）。
// 只有显式设置 TRUST_WX_HEADERS=1（云托管环境）时才信任该头，防止直连伪造。
function trustedWxOpenid(req) {
  if (process.env.TRUST_WX_HEADERS !== "1") return null;
  const v = String(req.headers["x-wx-openid"] || "").trim();
  return v || null;
}

// POST /api/auth/wechat { code } → token
// openid 来源优先级：可信云托管头 x-wx-openid > jscode2session(code)
router.post("/wechat", async (req, res, next) => {
  try {
    if (!throttle(`wechat:${clientIp(req)}`, 10, 60000)) {
      throw new AppError(429, "too_many_attempts", "登录尝试过于频繁，请稍后再试");
    }
    const code = String(req.body?.code ?? "").trim();
    const openid = trustedWxOpenid(req) || (await exchangeWechatCode(code)).openid;
    const member = await Member.findOne({ where: { openid } });
    if (!member) {
      // 未绑定：不向客户端暴露 openid；用邀请码首次登录后绑定（见 POST /api/auth/code）
      return res.status(403).json({ error: "not_bound", message: "该微信尚未绑定班费账本成员，请用邀请码登录后绑定" });
    }
    await sequelize.transaction(async (t) => {
      await appendAudit([{ actor: member.id, action: "auth.wechat_login", entity: "member",
        entityId: member.id, payload: {}, at: Date.now() }], t);
    });
    const { token, expires_at } = issueToken(member);
    setSessionCookie(res, token);
    res.json({ token, expires_at, member: memberPayload(member) });
  } catch (e) { next(e); }
});

// POST /api/auth/code { code, phone? } → token（首次登录可带 openid 绑定微信）
router.post("/code", async (req, res, next) => {
  try {
    if (!throttle(`code:${clientIp(req)}`, 10, 60000)) {
      throw new AppError(429, "too_many_attempts", "登录尝试过于频繁，请稍后再试");
    }
    const member = await redeemCode({ code: req.body?.code, phone: req.body?.phone });
    // 绑定微信 openid：小程序客户端通过 openid 换取的 wxOpenId 由服务端可信头提供时优先；
    // 这里接受前端传的 openid 但需它能通过一次 wechat code 校验（防止伪造）
    const openid = await resolveBindableOpenid(req, member);
    if (openid) await member.update({ openid });
    await member.reload();
    const { token, expires_at } = issueToken(member);
    setSessionCookie(res, token);
    res.json({ token, expires_at, member: memberPayload(member) });
  } catch (e) { next(e); }
});

// 绑定微信 openid 的可信来源：
// 1) 云托管可信头 x-wx-openid（TRUST_WX_HEADERS=1 时）
// 2) 前端附带的 wx.login code，经 jscode2session 校验
// 前端直接传的 openid 字符串永远不可信。
async function resolveBindableOpenid(req, member) {
  if (member.openid) return null; // 已绑定
  const trusted = trustedWxOpenid(req);
  if (trusted) {
    const taken = await Member.findOne({ where: { openid: trusted } });
    if (taken && taken.id !== member.id) return null;
    return trusted;
  }
  const code = String(req.body?.wx_code ?? "").trim();
  if (!code) return null;
  try {
    const { openid } = await exchangeWechatCode(code);
    const taken = await Member.findOne({ where: { openid } });
    if (taken && taken.id !== member.id) return null;
    return openid;
  } catch {
    return null;
  }
}

// POST /api/auth/owner { password } → token（班主任/维护者，首次激活维护者身份）
router.post("/owner", async (req, res, next) => {
  try {
    if (!throttle(`owner:${clientIp(req)}`, 5, 60000)) {
      throw new AppError(429, "too_many_attempts", "密码尝试过于频繁，请稍后再试");
    }
    checkOwnerPassword(req.body?.password);
    // 找本班维护者成员；没有则创建一个（需提供 name，可选 wx_code 绑定）
    const { Class } = require("../db");
    const cls = await Class.findOne();
    if (!cls) throw new AppError(500, "no_class", "班级尚未初始化");
    let owner = await Member.findOne({ where: { class_id: cls.id, is_owner: true } });
    const now = Date.now();
    const openid = req.body?.wx_code ? await bindOpenidFor(req) : null;
    if (!owner) {
      owner = await Member.create({
        id: `m-${require("../lib/util").newId().slice(0, 8)}`,
        class_id: cls.id, name: String(req.body?.name ?? "班主任").trim() || "班主任",
        role: "teacher", openid, phone: null, is_owner: true, created_at: now,
      });
      await sequelize.transaction(async (t) => {
        await appendAudit([{ actor: owner.id, action: "member.owner_claimed", entity: "member",
          entityId: owner.id, payload: { class_id: cls.id }, at: now }], t);
      });
    } else if (openid && !owner.openid) {
      await owner.update({ openid });
      await owner.reload();
    }
    const { token, expires_at } = issueToken(owner);
    setSessionCookie(res, token);
    res.json({ token, expires_at, member: memberPayload(owner) });
  } catch (e) { next(e); }
});

async function bindOpenidFor(req) {
  const code = String(req.body?.wx_code ?? "").trim();
  if (!code) return null;
  try {
    const { openid } = await exchangeWechatCode(code);
    const taken = await Member.findOne({ where: { openid } });
    if (taken) return null;
    return openid;
  } catch { return null; }
}

router.post("/logout", (req, res) => {
  clearSessionCookie(res);
  res.json({ ok: true });
});

router.get("/me", auth(false), (req, res) => {
  if (!req.member) return res.json({ member: null });
  res.json({ member: memberPayload(req.member) });
});

// 已登录成员：用微信 code 绑定自己的 openid
router.post("/bind-wechat", auth(true), async (req, res, next) => {
  try {
    const code = String(req.body?.code ?? "").trim();
    const { openid } = await exchangeWechatCode(code);
    const taken = await Member.findOne({ where: { openid } });
    if (taken && taken.id !== req.member.id) {
      throw new AppError(409, "openid_taken", "该微信已绑定其他成员");
    }
    if (req.member.openid && req.member.openid !== openid) {
      throw new AppError(409, "already_bound", "你已绑定过微信");
    }
    await req.member.update({ openid });
    await req.member.reload();
    res.json({ member: memberPayload(req.member) });
  } catch (e) { next(e); }
});

module.exports = router;
module.exports.memberPayload = memberPayload;
