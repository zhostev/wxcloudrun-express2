// 成员管理 + 邀请码（一次性登录码），逻辑与 Worker 版一致
const crypto = require("crypto");
const { sequelize, Member, LoginCode, q1 } = require("../db");
const { AppError, newId } = require("./util");
const { ROLES, sessionSecret } = require("./auth");
const { appendAudit } = require("./audit");

const CODE_LENGTH = 8;
const ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
const DEFAULT_TTL_MINUTES = 60 * 24 * 7; // 7 天
const MIN_TTL_MINUTES = 5;
const MAX_TTL_MINUTES = 60 * 24 * 30;
const MAX_CODE_FAILS = 5;
const PHONE_RE = /^\d{11}$/;

function normalizeName(v) {
  const s = String(v ?? "").trim().replace(/\s+/g, " ");
  if (!s) throw new AppError(400, "invalid_name", "姓名不能为空");
  if (s.length > 32) throw new AppError(400, "invalid_name", "姓名最多 32 个字");
  return s;
}
function normalizePhone(v) {
  if (v === undefined || v === null || String(v).trim() === "") return null;
  const s = String(v).replace(/[\s-]/g, "").trim();
  if (!PHONE_RE.test(s)) throw new AppError(400, "invalid_phone", "手机号必须是 11 位数字");
  return s;
}
function normalizeRole(v, dflt = "committee") {
  const r = String(v ?? dflt).trim();
  if (!ROLES.includes(r)) throw new AppError(400, "invalid_role", `role 必须是 ${ROLES.join("|")}`);
  return r;
}
function maskPhone(phone) {
  if (!phone) return null;
  return phone.length === 11 ? `${phone.slice(0, 3)}****${phone.slice(7)}` : "***";
}
function generateCode() {
  let s = "";
  for (let i = 0; i < CODE_LENGTH; i++) s += ALPHABET[crypto.randomInt(ALPHABET.length)];
  return s;
}
function normalizeCode(v) {
  return String(v ?? "").trim().toUpperCase().replace(/[^A-Z2-9]/g, "");
}
async function hashCode(code, secret) {
  // Must match Worker (class-fund-ledger/src/invites.ts): HMAC-SHA256(key=SESSION_SECRET, msg="login-code:"+code).
  // Plain sha256(`${secret}:${code}`) is incompatible with codes issued on the Worker/D1 path.
  if (!secret) throw new AppError(500, "no_session_secret", "服务端未配置 SESSION_SECRET，无法处理邀请码");
  return crypto.createHmac("sha256", secret).update(`login-code:${code}`).digest("hex");
}

/** Web (904.s7ea.com Worker/D1) issues invite codes; miniprogram redeems via CloudRun.
 *  When MySQL has no matching hash, redeem against the Worker so the same store is used.
 *  Set INVITE_UPSTREAM_BASE=0 to disable. Default: https://904.s7ea.com
 */
function inviteUpstreamBase() {
  const raw = process.env.INVITE_UPSTREAM_BASE;
  if (raw === "0" || raw === "false" || raw === "off") return null;
  const base = (raw && String(raw).trim()) || "https://904.s7ea.com";
  return base.replace(/\/+$/, "");
}

async function redeemViaUpstream(input) {
  const base = inviteUpstreamBase();
  if (!base) return null;
  const code = normalizeCode(input && input.code);
  const phone = canonPhone(input && input.phone);
  const body = { code };
  if (phone) body.phone = phone;
  let res, data;
  try {
    res = await fetch(`${base}/api/auth/code`, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify(body),
    });
    data = await res.json().catch(() => ({}));
  } catch (e) {
    throw new AppError(502, "invite_upstream_failed", `主站邀请码服务不可达：${e.message || e}`);
  }
  if (!res.ok) {
    const err = (data && data.error) || "invalid_login";
    const msg = (data && data.message) || "登录码无效或已过期";
    // Preserve upstream auth failures (401/403/429); other statuses become 502.
    if (res.status === 401 || res.status === 403 || res.status === 429 || err === "invalid_login" || err === "phone_required" || err === "too_many_attempts") {
      throw new AppError(res.status >= 400 && res.status < 500 ? res.status : 401, err, msg);
    }
    throw new AppError(502, "invite_upstream_failed", msg);
  }
  const mid = data && data.member && data.member.id;
  let member = mid ? await Member.findByPk(mid) : null;
  if (!member && phone) member = await Member.findOne({ where: { phone } });
  if (!member) {
    throw new AppError(
      500,
      "member_not_synced",
      "邀请码已在主站核销，但云托管花名册缺少该成员。请先同步成员后再发码。"
    );
  }
  await sequelize.transaction(async (t) => {
    await appendAudit([{
      actor: member.id, action: "auth.code_redeemed_upstream", entity: "member",
      entityId: member.id,
      payload: { upstream: base, phone_checked: !!phone },
      at: Date.now(),
    }], t);
  });
  await member.reload();
  return member;
}
function ttlMinutes(raw) {
  if (raw === undefined || raw === null || raw === "") return DEFAULT_TTL_MINUTES;
  const n = Number(raw);
  if (!Number.isInteger(n)) throw new AppError(400, "invalid_ttl", "ttl_minutes 必须是整数分钟");
  if (n < MIN_TTL_MINUTES || n > MAX_TTL_MINUTES) {
    throw new AppError(400, "invalid_ttl", `ttl_minutes 必须在 ${MIN_TTL_MINUTES}..${MAX_TTL_MINUTES} 之间`);
  }
  return n;
}

function toAdminView(m, activated) {
  return {
    id: m.id, name: m.name, phone: m.phone, role: m.role,
    is_owner: !!m.is_owner, activated: !!activated, openid_bound: m.openid != null,
    created_at: m.created_at,
  };
}
async function listMembers(classId) {
  const members = await Member.findAll({ where: { class_id: classId }, order: [["created_at", "ASC"]] });
  const usedCodes = await LoginCode.findAll({ where: { used_at: null } });
  // activated: 绑定过 openid 或用过邀请码
  const usedMemberIds = new Set();
  const allCodes = await LoginCode.findAll();
  for (const c of allCodes) if (c.used_at !== null) usedMemberIds.add(c.member_id);
  const ownersFirst = [...members].sort((a, b) => Number(b.is_owner) - Number(a.is_owner));
  return ownersFirst.map((m) => toAdminView(m.get({ plain: true }),
    m.openid != null || usedMemberIds.has(m.id)));
}
async function hasIndependentApprover(classId) {
  const n = await Member.count({ where: { class_id: classId, role: ["finance", "auditor"] } });
  return n > 0;
}

async function createMember(actor, input, now = Date.now()) {
  const name = normalizeName(input.name);
  const phone = normalizePhone(input.phone);
  const role = normalizeRole(input.role, "committee");
  const id = `m-${newId().slice(0, 8)}`;
  await sequelize.transaction(async (t) => {
    if (phone) {
      const dup = await Member.findOne({ where: { phone }, transaction: t });
      if (dup) throw new AppError(409, "phone_conflict", "该手机号已在花名册中");
    }
    await Member.create({ id, class_id: actor.class_id, name, role, openid: null, phone, is_owner: false, created_at: now }, { transaction: t });
    await appendAudit([{ actor: actor.id, action: "member.created", entity: "member", entityId: id,
      payload: { name, role, phone_masked: maskPhone(phone), class_id: actor.class_id }, at: now }], t);
  });
  return { id, name, phone, role, is_owner: false, activated: false, created_at: now };
}

async function updateMember(actor, id, patch, now = Date.now()) {
  const m = await Member.findByPk(id);
  if (!m || m.class_id !== actor.class_id) throw new AppError(404, "member_not_found", "成员不存在");
  if (m.is_owner && patch.role && patch.role !== m.role) {
    throw new AppError(403, "forbidden", "不能修改维护者的角色");
  }
  const updates = {};
  if (patch.name !== undefined) updates.name = normalizeName(patch.name);
  if (patch.phone !== undefined) {
    const phone = normalizePhone(patch.phone);
    if (phone) {
      const dup = await Member.findOne({ where: { phone } });
      if (dup && dup.id !== id) throw new AppError(409, "phone_conflict", "该手机号已在花名册中");
    }
    updates.phone = phone;
  }
  if (patch.role !== undefined) updates.role = normalizeRole(patch.role);
  if (Object.keys(updates).length === 0) throw new AppError(400, "empty_patch", "没有可更新的字段");
  await sequelize.transaction(async (t) => {
    await m.update(updates, { transaction: t });
    await appendAudit([{ actor: actor.id, action: "member.updated", entity: "member", entityId: id,
      payload: { ...updates, phone: updates.phone !== undefined ? maskPhone(updates.phone) : undefined }, at: now }], t);
  });
  await m.reload();
  return toAdminView(m.get({ plain: true }), m.openid != null);
}

async function bulkCreateMembers(actor, textInput, defaultRole = "committee", now = Date.now()) {
  if (!ROLES.includes(defaultRole)) throw new AppError(400, "invalid_role", "default_role 不在白名单内");
  const lines = String(textInput).split("\n").map((l) => l.trim()).filter(Boolean);
  const created = [], failed = [];
  for (const line of lines) {
    // 支持 "姓名 手机号 角色" 或 "姓名,手机号,角色"
    const parts = line.split(/[\s,，]+/).filter(Boolean);
    try {
      const m = await createMember(actor, { name: parts[0], phone: parts[1], role: parts[2] || defaultRole }, now);
      created.push(m);
    } catch (e) {
      failed.push({ line, error: e instanceof AppError ? e.message : "创建失败" });
    }
  }
  return { count: created.length, created, failed };
}

// ---- 邀请码 ----
function canonPhone(v) {
  let s = String(v ?? "").replace(/[\s-]/g, "").trim();
  if (s.startsWith("+86")) s = s.slice(3);
  else if (s.startsWith("86") && s.length === 13) s = s.slice(2);
  return s;
}
function msOrNull(v) {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "bigint" ? Number(v) : Number(v);
  if (!Number.isFinite(n) || n <= 0) return null;
  return n;
}
async function issueCode(actor, targetId, ttlMin = DEFAULT_TTL_MINUTES, now = Date.now()) {
  const secret = sessionSecret();
  if (!secret) throw new AppError(500, "no_session_secret", "服务端未配置 SESSION_SECRET，无法签发邀请码");
  const target = await Member.findByPk(targetId);
  if (!target || target.class_id !== actor.class_id) throw new AppError(404, "member_not_found", "成员不存在");
  const code = generateCode();
  const codeHash = await hashCode(code, secret);
  const expiresAt = now + ttlMin * 60000;
  const id = newId();
  await sequelize.transaction(async (t) => {
    await LoginCode.update({ used_at: now }, { where: { member_id: target.id, used_at: null }, transaction: t });
    await LoginCode.create({ id, code_hash: codeHash, member_id: target.id, created_by: actor.id,
      created_at: now, expires_at: expiresAt, used_at: null, fail_count: 0 }, { transaction: t });
    await appendAudit([{ actor: actor.id, action: "invitation.issued", entity: "member", entityId: target.id,
      payload: { invitation_id: id, expires_at: expiresAt, phone_masked: maskPhone(target.phone) }, at: now }], t);
  });
  return {
    member: { id: target.id, name: target.name, role: target.role, phone: target.phone },
    code, expires_at: expiresAt, phone_required: canonPhone(target.phone) !== "",
  };
}

async function redeemCode(input, now = Date.now()) {
  const secret = sessionSecret();
  if (!secret) throw new AppError(500, "no_session_secret", "服务端未配置 SESSION_SECRET，无法校验邀请码");
  const unauthorized = () => new AppError(401, "invalid_login", "登录码无效或已过期");
  const phone = canonPhone(input && input.phone);
  const code = normalizeCode(input && input.code);
  if (code.length !== CODE_LENGTH) throw unauthorized();
  const row = await LoginCode.findOne({ where: { code_hash: await hashCode(code, secret) } });
  if (!row) {
    const upstreamMember = await redeemViaUpstream(input);
    if (upstreamMember) return upstreamMember;
    throw unauthorized();
  }
  const burn = async () => { await row.increment("fail_count"); };
  const usedAt = msOrNull(row.used_at);
  const expiresAt = msOrNull(row.expires_at);
  const fails = Number(row.fail_count) || 0;
  // used_at / expires_at are MySQL BIGINT and may come back as strings. 0/null means unused.
  if (usedAt !== null || expiresAt === null || expiresAt <= now || fails >= MAX_CODE_FAILS) throw unauthorized();
  const member = await Member.findByPk(row.member_id);
  if (!member) { await burn(); throw unauthorized(); }
  const needPhone = canonPhone(member.phone);
  if (needPhone) {
    // Missing phone is not an invalid code. Do not burn fail_count; the client can retry.
    if (!phone) throw new AppError(400, "phone_required", "该邀请码需要填写花名册中登记的11位手机号");
    if (needPhone !== phone) { await burn(); throw unauthorized(); }
  }
  await sequelize.transaction(async (t) => {
    await row.update({ used_at: now }, { transaction: t });
    await appendAudit([{ actor: member.id, action: "auth.code_redeemed", entity: "member",
      entityId: member.id, payload: { invitation_id: row.id, phone_checked: needPhone !== "" }, at: now }], t);
  });
  await member.reload();
  return member;
}
async function peekCode(codeInput, now = Date.now()) {
  const secret = sessionSecret();
  if (!secret) throw new AppError(500, "no_session_secret", "服务端未配置 SESSION_SECRET，无法校验邀请码");
  const code = normalizeCode(codeInput);
  if (code.length !== CODE_LENGTH) throw new AppError(404, "invalid_code", "邀请码不存在");
  const row = await LoginCode.findOne({ where: { code_hash: await hashCode(code, secret) } });
  if (!row) throw new AppError(404, "invalid_code", "邀请码不存在");
  const member = await Member.findByPk(row.member_id);
  const usedAt = msOrNull(row.used_at);
  const expiresAt = msOrNull(row.expires_at);
  const fails = Number(row.fail_count) || 0;
  const usable = usedAt === null && expiresAt !== null && expiresAt > now && fails < MAX_CODE_FAILS;
  return {
    valid: usable,
    used: usedAt !== null,
    expired: expiresAt === null || expiresAt <= now,
    member: member ? { name: member.name, role: member.role } : null,
    phone_required: member ? canonPhone(member.phone) !== "" : false,
  };
}

module.exports = {
  normalizeName, normalizePhone, normalizeRole, maskPhone,
  listMembers, hasIndependentApprover, createMember, updateMember, bulkCreateMembers,
  issueCode, redeemCode, peekCode, ttlMinutes, toAdminView, inviteUpstreamBase,
};
