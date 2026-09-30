// 审计 hash 链（与 Worker 版算法一致：canonical JSON + sha256(prev + "\n" + body)）
const { AuditLog } = require("../db");
const { sha256Hex, AppError } = require("./util");

const GENESIS_HASH = "0".repeat(64);

function canonical(value) { return canon(value, "$"); }
function canon(value, path) {
  if (value === null) return "null";
  switch (typeof value) {
    case "string": return JSON.stringify(value);
    case "number":
      if (!Number.isFinite(value)) throw new Error(`audit payload 不允许非有限数字：${path}=${value}`);
      return JSON.stringify(value);
    case "boolean": return value ? "true" : "false";
    case "undefined": throw new Error(`audit payload 不允许 undefined：${path}（请显式写 null）`);
    case "bigint": throw new Error(`audit payload 不允许 BigInt：${path}`);
    case "function": case "symbol": throw new Error(`audit payload 不允许 ${typeof value}：${path}`);
  }
  if (Array.isArray(value)) return "[" + value.map((v, i) => canon(v, `${path}[${i}]`)).join(",") + "]";
  const keys = Object.keys(value).sort();
  return "{" + keys.map((k) => JSON.stringify(k) + ":" + canon(value[k], `${path}.${k}`)).join(",") + "}";
}
function computeHash(prevHash, row) {
  return sha256Hex(prevHash + "\n" + canonical(row));
}

// 追加审计记录（事务内调用）。inputs: [{actor, action, entity, entityId, payload, at}]
async function appendAudit(inputs, t) {
  const last = await AuditLog.findOne({ order: [["seq", "DESC"]], transaction: t });
  let prevHash = last ? last.hash : GENESIS_HASH;
  let seq = last ? last.seq + 1 : 1;
  const rows = [];
  for (const input of inputs) {
    const body = {
      seq, at: input.at, actor: input.actor, action: input.action,
      entity: input.entity, entity_id: input.entityId,
      payload: canonical(input.payload), prev_hash: prevHash,
    };
    const hash = computeHash(prevHash, body);
    rows.push({ ...body, hash });
    prevHash = hash;
    seq += 1;
  }
  await AuditLog.bulkCreate(rows, { transaction: t });
  return rows;
}

// 校验整条链
async function verifyChain() {
  const rows = await AuditLog.findAll({ order: [["seq", "ASC"]] });
  let prevHash = GENESIS_HASH;
  let expectedSeq = 1;
  for (const r of rows) {
    if (r.seq !== expectedSeq) {
      return { ok: false, length: rows.length, broken_at_seq: r.seq, head: prevHash,
        reason: `审计链断号：期望 seq=${expectedSeq}，实际 ${r.seq}（有记录被删除）` };
    }
    expectedSeq++;
    if (r.prev_hash !== prevHash) {
      return { ok: false, length: rows.length, broken_at_seq: r.seq, head: prevHash,
        reason: "prev_hash 与前一条的 hash 不匹配（链被替换）" };
    }
    const recomputed = computeHash(prevHash, {
      seq: r.seq, at: r.at, actor: r.actor, action: r.action,
      entity: r.entity, entity_id: r.entity_id, payload: r.payload, prev_hash: prevHash,
    });
    if (recomputed !== r.hash) {
      return { ok: false, length: rows.length, broken_at_seq: r.seq, head: prevHash,
        reason: "记录内容与其 hash 不匹配（被篡改）" };
    }
    prevHash = r.hash;
  }
  const { sequelize } = require("../db");
  const cov = await sequelize.query(
    `SELECT
       (SELECT COUNT(*) FROM entries) AS entries,
       (SELECT COUNT(DISTINCT entity_id) FROM audit_log WHERE entity = 'entry') AS entry_events,
       (SELECT COUNT(*) FROM approvals) AS approvals,
       (SELECT COUNT(*) FROM audit_log WHERE action IN ('expense.approval_recorded','expense.rejected')) AS approval_events,
       (SELECT COUNT(*) FROM attachments) AS receipts,
       (SELECT COUNT(*) FROM audit_log WHERE action = 'receipt.attached') AS receipt_events`,
    { type: sequelize.QueryTypes.SELECT });
  const coverage = cov[0];
  if (coverage.entries !== coverage.entry_events) {
    return { ok: false, length: rows.length, head: prevHash, coverage,
      reason: "账目数与账目审计事件数不一致" };
  }
  return { ok: true, length: rows.length, head: prevHash, coverage };
}

module.exports = { appendAudit, verifyChain, GENESIS_HASH, canonical };
