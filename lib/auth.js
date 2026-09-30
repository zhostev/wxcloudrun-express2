// 鉴权：会话签发/校验、中间件、角色权限（与 Worker 版一致）
const { Member, q1 } = require("../db");
const { AppError, signSession, verifySession, sha256Hex } = require("./util");

const SESSION_TTL_MS = 30 * 24 * 3600 * 1000; // 30 天
const ROLES = ["parent", "committee", "finance", "auditor", "teacher"];
const CAN_MANAGE_MEMBERS = ["committee", "finance"];
const CAN_RECORD = ["committee", "finance", "teacher"];
const CAN_APPROVE = ["committee", "finance", "auditor"];
const CAN_VIEW_INTERNAL = ["committee", "finance", "auditor", "teacher"];
const APPROVAL_TIERS = [
  { min_cents: 50000, approvals: 3 }, // ≥500 元 3 人
  { min_cents: 0, approvals: 2 },
];
const MIN_OWNER_PASSWORD_LENGTH = 8;

function sessionSecret() {
  const s = process.env.SESSION_SECRET;
  if (s && s.length >= 16) return s;
  if (process.env.ALLOW_DEV_ROUTES === "1") return "dev-only-insecure-session-secret";
  return null;
}
function requiredApprovalsFor(amountCents) {
  for (const tier of APPROVAL_TIERS) {
    if (amountCents >= tier.min_cents) return tier.approvals;
  }
  return APPROVAL_TIERS[APPROVAL_TIERS.length - 1].approvals;
}
function canManageMembers(m) {
  return m.is_owner === true || CAN_MANAGE_MEMBERS.includes(m.role);
}
function permissions(m) {
  return {
    manage: canManageMembers(m),
    view_internal: CAN_VIEW_INTERNAL.includes(m.role),
    approve: CAN_APPROVE.includes(m.role),
    record: CAN_RECORD.includes(m.role),
  };
}
function publicMember(m) {
  return { id: m.id, class_id: m.class_id, name: m.name, role: m.role, is_owner: !!m.is_owner };
}
function requireRole(member, allowed, what) {
  if (!allowed.includes(member.role)) {
    throw new AppError(403, "forbidden_role", `角色 ${member.role} 无权${what}`);
  }
}

function issueToken(member) {
  const secret = sessionSecret();
  if (!secret) throw new AppError(500, "no_session_secret", "服务端未配置 SESSION_SECRET，无法签发会话");
  const now = Date.now();
  const token = signSession({ memberId: member.id, classId: member.class_id, issuedAt: now, exp: now + SESSION_TTL_MS }, secret);
  return { token, expires_at: now + SESSION_TTL_MS };
}

function readCookie(header, name) {
  if (!header) return null;
  for (const part of String(header).split(";")) {
    const idx = part.indexOf("=");
    if (idx < 0) continue;
    if (part.slice(0, idx).trim() === name) return decodeURIComponent(part.slice(idx + 1).trim());
  }
  return null;
}

// 从 Authorization: Bearer 或 cookie 解析当前成员；未登录返回 null
async function currentMember(req) {
  const secret = sessionSecret();
  if (!secret) return null;
  const authz = req.headers["authorization"] || "";
  const bearer = /^bearer\s+/i.test(authz) ? authz.replace(/^bearer\s+/i, "").trim() : null;
  const token = bearer || readCookie(req.headers["cookie"], "ledger_session");
  if (!token) return null;
  const payload = verifySession(token, secret);
  if (!payload) return null;
  const m = await Member.findByPk(payload.memberId);
  if (!m || m.class_id !== payload.classId) return null;
  return m;
}

function auth(required = true) {
  return async (req, res, next) => {
    try {
      const m = await currentMember(req);
      if (!m && required) throw new AppError(401, "unauthorized", "请先登录");
      req.member = m;
      next();
    } catch (e) { next(e); }
  };
}
function requireManage(req, res, next) {
  try {
    if (!canManageMembers(req.member)) throw new AppError(403, "forbidden_role", "仅家委会/财务可管理成员");
    next();
  } catch (e) { next(e); }
}

// 微信 code 换 openid
async function exchangeWechatCode(code) {
  const appid = process.env.WECHAT_APPID || "wx2861b42fc732bdf4";
  const secret = process.env.WECHAT_SECRET;
  if (!code || code.length < 8) throw new AppError(400, "invalid_code", "缺少有效的小程序登录 code");
  if (!secret) {
    throw new AppError(
      500,
      "no_wx_config",
      "服务端未配置 WECHAT_SECRET。请在微信云托管 → 服务设置 → 环境变量中设置 WECHAT_SECRET（小程序后台 AppSecret），或改用 callContainer + TRUST_WX_HEADERS=1"
    );
  }
  const url = `https://api.weixin.qq.com/sns/jscode2session?appid=${encodeURIComponent(appid)}&secret=${encodeURIComponent(secret)}&js_code=${encodeURIComponent(code)}&grant_type=authorization_code`;
  let res;
  try { res = await fetch(url); }
  catch (e) { throw new AppError(502, "wechat_login_failed", `连接微信服务失败：${e.message}`); }
  if (!res.ok) throw new AppError(502, "wechat_login_failed", `微信服务返回 HTTP ${res.status}`);
  const body = await res.json();
  if (body.errcode) {
    const friendly = { 40029: "登录 code 无效或已过期，请重试", 45011: "登录过于频繁，请稍后再试", 40013: "AppID 无效" }[body.errcode];
    throw new AppError(401, "wechat_login_failed", friendly || `微信登录失败（errcode ${body.errcode}）`);
  }
  if (!body.openid) throw new AppError(502, "wechat_login_failed", "微信未返回 openid");
  return { openid: body.openid, sessionKey: body.session_key, unionid: body.unionid };
}

function ownerPassword() {
  const p = process.env.OWNER_PASSWORD;
  if (!p || p.length < MIN_OWNER_PASSWORD_LENGTH) return null;
  return p;
}
function checkOwnerPassword(candidate) {
  const configured = ownerPassword();
  if (!configured) throw new AppError(500, "no_owner_password", "服务端未配置班主任密码");
  const a = sha256Hex(String(candidate ?? ""));
  const b = sha256Hex(configured);
  if (a !== b) throw new AppError(403, "wrong_password", "密码不正确");
}

module.exports = {
  ROLES, CAN_MANAGE_MEMBERS, CAN_RECORD, CAN_APPROVE, CAN_VIEW_INTERNAL,
  SESSION_TTL_MS, sessionSecret, requiredApprovalsFor, canManageMembers, permissions,
  publicMember, requireRole, issueToken, currentMember, auth, requireManage,
  exchangeWechatCode, ownerPassword, checkOwnerPassword,
};
