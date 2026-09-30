/** 通用格式化工具 */

/** 分 → "1,450.00" */
function fmtMoney(cents) {
  const n = Number(cents) || 0;
  return (n / 100).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

/** 元（字符串/数字）→ 分（整数） */
function yuanToCents(yuan) {
  const n = parseFloat(String(yuan).trim());
  if (!isFinite(n) || n <= 0) return 0;
  return Math.round(n * 100);
}

/** "YYYY-MM-DD" → "MM/DD" */
function fmtDate(occurredOn) {
  if (!occurredOn || occurredOn.length < 10) return occurredOn || "";
  return occurredOn.slice(5).replace("-", "/");
}

/** 毫秒时间戳 → "YYYY-MM-DD HH:mm" */
function fmtDateTime(ts) {
  const t = Number(ts);
  if (!isFinite(t) || t <= 0) return "";
  const d = new Date(t);
  const p = (x) => String(x).padStart(2, "0");
  return (
    d.getFullYear() + "-" + p(d.getMonth() + 1) + "-" + p(d.getDate()) + " " + p(d.getHours()) + ":" + p(d.getMinutes())
  );
}

/** 今天 "YYYY-MM-DD" */
function today() {
  const d = new Date();
  const p = (x) => String(x).padStart(2, "0");
  return d.getFullYear() + "-" + p(d.getMonth() + 1) + "-" + p(d.getDate());
}

const ROLE_LABELS = {
  parent: "家长",
  committee: "家委会",
  finance: "财务",
  auditor: "审核",
  teacher: "班主任",
};
function roleLabel(role) {
  return ROLE_LABELS[role] || role || "成员";
}

const STATUS_LABELS = {
  draft: "草稿",
  pending: "待审批",
  approved: "已公示",
  rejected: "已驳回",
};
function statusLabel(status) {
  return STATUS_LABELS[status] || status || "";
}

/** 条目主标题：分类 · 备注 */
function entryTitle(e) {
  const main = e.category || (e.kind === "donation" ? "捐赠" : "支出");
  return e.note ? main + " · " + e.note : main;
}

/** 条目副标题：捐赠人 / 收款人 / 经手人 */
function entrySub(e) {
  if (e.kind === "donation") return "捐赠人：" + (e.donor || "匿名");
  const parts = [];
  if (e.payee) parts.push("收款：" + e.payee);
  if (e.handler) parts.push("经手：" + e.handler);
  return parts.join(" ｜ ");
}

/** 凭证图片 url 可能是相对路径，补全域名 */
function fullUrl(url) {
  if (!url) return "";
  if (/^https?:\/\//i.test(url)) return url;
  const api = require("./api.js");
  return api.baseUrl() + (url.startsWith("/") ? url : "/" + url);
}

module.exports = {
  fmtMoney,
  yuanToCents,
  fmtDate,
  fmtDateTime,
  today,
  roleLabel,
  statusLabel,
  entryTitle,
  entrySub,
  fullUrl,
};
