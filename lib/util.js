// 通用工具：错误、金额格式化、ID、校验（逻辑与 Worker 版保持一致）
const crypto = require("crypto");

class AppError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// 分 → "1,450.00"
function yuan(cents) {
  const n = Number(cents) || 0;
  const sign = n < 0 ? "-" : "";
  const abs = Math.abs(Math.trunc(n));
  const str = String(abs).padStart(3, "0");
  const int = str.slice(0, -2).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `${sign}${int}.${str.slice(-2)}`;
}

function newId(prefix = "") {
  const uuid = crypto.randomUUID();
  return prefix ? `${prefix}-${uuid}` : uuid;
}

function text(v, label, max, code) {
  const s = String(v ?? "").trim();
  if (!s) throw new AppError(400, code, `${label}不能为空`);
  if (s.length > max) throw new AppError(400, code, `${label}最多 ${max} 个字`);
  return s;
}
function optionalText(v, label, max, code) {
  if (v === undefined || v === null || String(v).trim() === "") return null;
  return text(v, label, max, code);
}
function occurredOn(v) {
  const s = String(v ?? "").trim();
  if (!DATE_RE.test(s)) throw new AppError(400, "invalid_date", "occurred_on 必须是 YYYY-MM-DD");
  return s;
}
function quantity(v) {
  const n = Number(v);
  if (!Number.isInteger(n) || n <= 0) throw new AppError(400, "invalid_quantity", "数量必须是正整数");
  return n;
}
function estValue(v) {
  if (v === undefined || v === null || v === "") return null;
  const n = Number(v);
  if (!Number.isInteger(n) || n < 0) throw new AppError(400, "invalid_est_value", "估值（分）必须是非负整数");
  return n;
}

// ---- 会话 token（HMAC-SHA256 签名，与 Worker 版格式兼容） ----
function b64urlEncode(buf) {
  return Buffer.from(buf).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function b64urlDecode(s) {
  s = String(s).replace(/-/g, "+").replace(/_/g, "/");
  while (s.length % 4) s += "=";
  return Buffer.from(s, "base64");
}
function signSession(payload, secret) {
  const body = b64urlEncode(JSON.stringify(payload));
  const sig = crypto.createHmac("sha256", secret).update(body).digest();
  return `${body}.${b64urlEncode(sig)}`;
}
function verifySession(token, secret, now = Date.now()) {
  try {
    const dot = String(token).lastIndexOf(".");
    if (dot <= 0) return null;
    const body = String(token).slice(0, dot);
    const sig = b64urlDecode(String(token).slice(dot + 1));
    const expect = crypto.createHmac("sha256", secret).update(body).digest();
    if (sig.length !== expect.length || !crypto.timingSafeEqual(sig, expect)) return null;
    const p = JSON.parse(b64urlDecode(body).toString("utf8"));
    if (typeof p.memberId !== "string" || typeof p.classId !== "string" || typeof p.exp !== "number") return null;
    if (p.exp <= now) return null;
    return { memberId: p.memberId, classId: p.classId, issuedAt: p.issuedAt ?? 0, exp: p.exp };
  } catch {
    return null;
  }
}
const GENERIC_AUTH_MESSAGE = "登录失败，请检查后重试";

function randomToken(bytes = 32) {
  return crypto.randomBytes(bytes).toString("base64url");
}

function sha256Hex(s) {
  return crypto.createHash("sha256").update(s).digest("hex");
}

module.exports = {
  AppError, yuan, newId, text, optionalText, occurredOn, quantity, estValue,
  signSession, verifySession, sha256Hex, DATE_RE,
  GENERIC_AUTH_MESSAGE, randomToken,
};
