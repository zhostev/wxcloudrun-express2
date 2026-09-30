// 公开视图构造 + 报表查询（字段形状与 Worker 版完全一致）
const { q, q1 } = require("../db");
const { yuan } = require("./util");

const HANDLER_ROLE_LABEL = {
  teacher: "班主任", committee: "家委会", finance: "家委会财务",
  auditor: "审核", parent: "家长",
};

function withParentSuffix(name) {
  return /(家长|老师|先生|女士|同学|妈妈|爸爸)$/.test(name) ? name : `${name}家长`;
}
function donorLabel(name, display) {
  return display === "named" && name ? withParentSuffix(name) : "爱心家长";
}
function internalDonorLabel(name, display) {
  if (!name) return donorLabel(name, display);
  return display === "named" ? withParentSuffix(name) : `${withParentSuffix(name)}（对外匿名）`;
}

// 账目公开视图
function toPublicView(entry, donorName, approvals, receipts, receiptFiles = [], handler = null, scope = "public") {
  const handlerRef = handler === null ? null : typeof handler === "string" ? { name: handler, role: null } : handler;
  const base = {
    id: entry.id,
    kind: entry.kind,
    amount_cents: entry.amount_cents,
    amount: yuan(entry.amount_cents),
    category: entry.category,
    note: entry.note,
    occurred_on: entry.occurred_on,
    status: entry.status,
    approvals: { ...approvals, required: entry.required_approvals },
    receipts,
    ...(receiptFiles.length > 0 ? { receipt_files: receiptFiles } : {}),
    published_at: entry.published_at,
    created_at: entry.created_at,
  };
  if (handlerRef) {
    const anonymousDonation = entry.kind === "donation" && entry.donor_display === "anonymous";
    const masked = anonymousDonation && scope === "public";
    const label = masked
      ? HANDLER_ROLE_LABEL[handlerRef.role ?? ""] ?? "家委会"
      : handlerRef.name ? withParentSuffix(handlerRef.name) : null;
    if (label) base.handler = label;
  }
  if (entry.kind === "donation") {
    base.received_at = entry.received_at;
    base.donor = scope === "internal" ? internalDonorLabel(donorName, entry.donor_display) : donorLabel(donorName, entry.donor_display);
    base.donor_display = entry.donor_display ?? "anonymous";
  } else {
    base.payee = entry.payee ?? "家委会";
    if (entry.activity) base.activity = entry.activity;
  }
  return base;
}

function toPublicReceipt(a) {
  return {
    id: a.id, filename: a.filename, content_type: a.content_type,
    size_bytes: a.size_bytes, sha256: a.sha256,
    visibility: a.visibility || "public",
    url: `/api/public/receipts/${a.id}`,
  };
}

// 物资公开视图
function handlerLabelMove(r, scope) {
  const anonymousDonation = r.source === "donation" && r.donor_display === "anonymous";
  if (anonymousDonation && scope === "public") {
    return HANDLER_ROLE_LABEL[r.handler_role ?? ""] ?? "家委会";
  }
  return r.handler_name ? withParentSuffix(r.handler_name) : null;
}
function toPublicMove(r, photos = [], scope = "public") {
  return {
    direction: r.direction,
    item_name: r.item_name,
    spec: r.spec,
    quantity: r.quantity,
    unit: r.unit,
    source: r.source,
    donor: r.direction === "in" && r.source === "donation"
      ? (scope === "internal" ? internalDonorLabel(r.donor_name, r.donor_display) : donorLabel(r.donor_name, r.donor_display))
      : null,
    handler: handlerLabelMove(r, scope),
    purpose: r.purpose,
    occurred_on: r.occurred_on,
    note: r.note,
    received: r.received_at !== null,
    photos,
  };
}

async function approvalCounts(entryId) {
  const row = await q1(
    `SELECT COALESCE(SUM(decision='approve'),0) AS approve, COALESCE(SUM(decision='reject'),0) AS reject
     FROM approvals WHERE entry_id = ?`, [entryId]);
  return { approve: Number(row.approve), reject: Number(row.reject) };
}
async function receiptCount(entryId) {
  const row = await q1(`SELECT COUNT(*) AS n FROM attachments WHERE entry_id = ?`, [entryId]);
  return Number(row.n);
}

// ---- 公开报表 ----
async function publicSummary(classId) {
  const row = await q1(
    `SELECT COALESCE(SUM(CASE WHEN kind='donation' THEN amount_cents END),0) AS received,
            COALESCE(SUM(CASE WHEN kind='expense'  THEN amount_cents END),0) AS spent,
            COALESCE(SUM(CASE WHEN kind='donation' THEN 1 END),0) AS donation_count,
            COALESCE(SUM(CASE WHEN kind='expense'  THEN 1 END),0) AS expense_count
     FROM entries WHERE class_id = ? AND status='approved' AND published_at IS NOT NULL`, [classId]);
  const pending = await q1(`SELECT COUNT(*) AS n FROM entries WHERE class_id = ? AND status='pending'`, [classId]);
  const received = Number(row.received), spent = Number(row.spent);
  const stockPart = await stockSummary(classId);
  return {
    ...stockPart,
    class_id: classId,
    received_cents: received, spent_cents: spent, balance_cents: received - spent,
    received: yuan(received), spent: yuan(spent), balance: yuan(received - spent),
    donation_count: Number(row.donation_count), expense_count: Number(row.expense_count),
    pending_count: Number(pending.n),
  };
}

const LEDGER_JOINS = `
  FROM entries e
  LEFT JOIN members m ON m.id = e.donor_member_id AND m.class_id = e.class_id
  LEFT JOIN members h ON h.id = e.handled_by AND h.class_id = e.class_id`;

async function publicLedger(classId, limit = 20, offset = 0) {
  limit = Math.min(Math.max(limit | 0, 1), 100); offset = Math.max(offset | 0, 0);
  const rows = await q(
    `SELECT e.*, m.name AS donor_member_name, h.name AS handler_name, h.role AS handler_role,
            (SELECT COUNT(*) FROM attachments a WHERE a.entry_id = e.id) AS receipts,
            (SELECT COUNT(*) FROM approvals ap WHERE ap.entry_id = e.id AND ap.decision='approve') AS approves,
            (SELECT COUNT(*) FROM approvals ap WHERE ap.entry_id = e.id AND ap.decision='reject') AS rejects
     ${LEDGER_JOINS}
     WHERE e.class_id = ? AND e.status = 'approved' AND e.published_at IS NOT NULL
     ORDER BY e.occurred_on DESC, e.created_at DESC LIMIT ? OFFSET ?`,
    [classId, limit, offset]);
  return rows.map((r) => toPublicView(r, r.donor_name ?? r.donor_member_name ?? null,
    { approve: Number(r.approves), reject: Number(r.rejects) }, Number(r.receipts), [],
    { name: r.handler_name, role: r.handler_role }));
}

// 内部列表（含未公示）
async function listEntries(classId, status) {
  const rows = await q(
    `SELECT e.*, m.name AS donor_member_name, h.name AS handler_name, h.role AS handler_role,
            (SELECT COUNT(*) FROM attachments a WHERE a.entry_id = e.id) AS receipts,
            (SELECT COUNT(*) FROM approvals ap WHERE ap.entry_id = e.id AND ap.decision='approve') AS approves,
            (SELECT COUNT(*) FROM approvals ap WHERE ap.entry_id = e.id AND ap.decision='reject') AS rejects
     ${LEDGER_JOINS}
     WHERE e.class_id = ? ${status ? "AND e.status = ?" : ""}
     ORDER BY e.created_at DESC LIMIT 200`,
    status ? [classId, status] : [classId]);
  return rows.map((r) => {
    const v = toPublicView(r, r.donor_name ?? r.donor_member_name ?? null,
      { approve: Number(r.approves), reject: Number(r.rejects) }, Number(r.receipts), [],
      { name: r.handler_name, role: r.handler_role }, "internal");
    v.created_by = r.created_by;
    return v;
  });
}

async function getEntryDetail(entryId, receiptVisibility = "public", scope = "public") {
  const entry = await q1(`SELECT * FROM entries WHERE id = ?`, [entryId]);
  if (!entry) return null;
  const donor = entry.donor_member_id ? await q1(`SELECT * FROM members WHERE id = ?`, [entry.donor_member_id]) : null;
  const sameClassDonor = donor && donor.class_id === entry.class_id ? donor : null;
  const handler = entry.handled_by ? await q1(`SELECT * FROM members WHERE id = ?`, [entry.handled_by]) : null;
  const sameClassHandler = handler && handler.class_id === entry.class_id ? handler : null;
  const approvals = await approvalCounts(entryId);
  const receipts = await receiptCount(entryId);
  let receiptFiles = [];
  const atts = await q(`SELECT * FROM attachments WHERE entry_id = ? ORDER BY created_at ASC`, [entryId]);
  const visible = receiptVisibility === "public" ? atts.filter((a) => a.visibility === "public") : atts;
  receiptFiles = visible.map(toPublicReceipt);
  const view = toPublicView(entry, entry.donor_name ?? sameClassDonor?.name ?? null,
    approvals, receipts, receiptFiles,
    sameClassHandler ? { name: sameClassHandler.name, role: sameClassHandler.role } : null, scope);
  return { entry, view };
}

// ---- 物资 ----
async function queryMoves(classId, limit, offset) {
  return q(
    `SELECT sm.*, m.name AS donor_name, h.name AS handler_name, h.role AS handler_role
     FROM stock_moves sm
     LEFT JOIN members m ON m.id = sm.member_id AND m.class_id = sm.class_id
     LEFT JOIN members h ON h.id = sm.handled_by AND h.class_id = sm.class_id
     WHERE sm.class_id = ?
     ORDER BY sm.occurred_on DESC, sm.created_at DESC LIMIT ? OFFSET ?`,
    [classId, limit, offset]);
}
async function listItems(classId) {
  const rows = await q(
    `SELECT item_name, unit,
            COALESCE(SUM(CASE WHEN direction='in' THEN quantity END),0) AS total_in,
            COALESCE(SUM(CASE WHEN direction='out' THEN quantity END),0) AS total_out
     FROM stock_moves WHERE class_id = ? GROUP BY item_name, unit ORDER BY item_name`,
    [classId]);
  return rows.map((r) => ({
    item_name: r.item_name, unit: r.unit,
    total_in: Number(r.total_in), total_out: Number(r.total_out),
    balance: Number(r.total_in) - Number(r.total_out),
  }));
}
async function photosFor(moveIds, visibility) {
  const map = new Map();
  if (!moveIds.length) return map;
  const placeholders = moveIds.map(() => "?").join(",");
  const rows = await q(
    `SELECT * FROM attachments WHERE stock_move_id IN (${placeholders}) ORDER BY created_at ASC`, moveIds);
  for (const a of rows) {
    if (visibility === "public" && a.visibility !== "public") continue;
    if (!map.has(a.stock_move_id)) map.set(a.stock_move_id, []);
    map.get(a.stock_move_id).push(toPublicReceipt(a));
  }
  return map;
}
function summarizeStock(classId, items) {
  const withBalance = items.filter((i) => i.balance > 0);
  return {
    class_id: classId, kinds: withBalance.length,
    units_total: withBalance.reduce((n, i) => n + i.balance, 0),
  };
}
async function stockSummary(classId) {
  const items = await listItems(classId);
  const withBalance = items.filter((i) => i.balance > 0);
  return {
    stock_kinds: withBalance.length,
    stock_units: withBalance.reduce((n, i) => n + i.balance, 0),
  };
}
async function publicStock(classId, limit = 50, offset = 0) {
  limit = Math.min(Math.max(limit | 0, 1), 200); offset = Math.max(offset | 0, 0);
  const [items, moves] = await Promise.all([listItems(classId), queryMoves(classId, limit, offset)]);
  const photos = await photosFor(moves.map((m) => m.id), "public");
  return { ...summarizeStock(classId, items), items, moves: moves.map((m) => toPublicMove(m, photos.get(m.id) ?? [])) };
}
async function internalStock(classId, limit = 100, offset = 0) {
  const [items, moves] = await Promise.all([listItems(classId), queryMoves(classId, limit, offset)]);
  const photos = await photosFor(moves.map((m) => m.id), "internal");
  return {
    ...summarizeStock(classId, items), items,
    moves: moves.map((r) => ({
      ...toPublicMove(r, photos.get(r.id) ?? [], "internal"),
      id: r.id, handled_by: r.handled_by, handler_name: r.handler_name ?? null,
      received_at: r.received_at, donor_name: r.donor_name, donor_display: r.donor_display,
      member_id: r.member_id, entry_id: r.entry_id, est_value_cents: r.est_value_cents,
      created_at: r.created_at,
    })),
  };
}

module.exports = {
  toPublicView, toPublicReceipt, toPublicMove, donorLabel, internalDonorLabel, withParentSuffix,
  approvalCounts, receiptCount, publicSummary, publicLedger, listEntries, getEntryDetail,
  publicStock, internalStock, stockSummary, listItems,
};
