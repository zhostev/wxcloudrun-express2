// 账本核心业务：记账、审批、确认收款、物资出入库（逻辑与 Worker 版一致）
const { sequelize, Entry, Member, Approval, StockMove, q1 } = require("../db");
const { AppError, newId, text, optionalText, occurredOn, quantity, estValue } = require("./util");
const { requireRole, requiredApprovalsFor, CAN_RECORD, CAN_APPROVE, CAN_VIEW_INTERNAL } = require("./auth");
const { appendAudit } = require("./audit");
const { approvalCounts, toPublicView } = require("./views");

const MAX_DONOR_NAME = 32;

async function getMember(id) {
  return Member.findByPk(id);
}

async function resolveHandler(actor, raw) {
  const id = String(raw ?? "").trim();
  if (!id || id === actor.id) return actor.id;
  const m = await getMember(id);
  if (!m) throw new AppError(400, "unknown_handler", "经手人不存在");
  if (m.class_id !== actor.class_id) throw new AppError(400, "handler_class_mismatch", "经手人必须是本班成员");
  if (!CAN_RECORD.includes(m.role)) {
    throw new AppError(400, "invalid_handler", "经手人必须是班主任或家委会成员（钱交到谁手上，谁就要能对这笔账负责）");
  }
  return m.id;
}

async function resolveDonor(actor, input) {
  if (input.donor_unknown === true && input.donor_display === "named") {
    throw new AppError(400, "donor_required", "不知道是谁捐的就谈不上实名公示；请改用匿名，或指明捐赠人");
  }
  const rawName = String(input.donor_name ?? "").replace(/\s+/g, " ").trim();
  if (rawName.length > MAX_DONOR_NAME) {
    throw new AppError(400, "invalid_donor_name", `捐赠人姓名最多 ${MAX_DONOR_NAME} 个字`);
  }
  const rawId = String(input.donor_member_id ?? (input.donor_display === "named" && !rawName ? actor.id : "")).trim();
  if (!rawName && !rawId) {
    if (input.donor_display === "anonymous" && input.donor_unknown === true) return { name: null, memberId: null };
    throw new AppError(400, "donor_required",
      "请记下这笔是哪位家长捐的（匿名只影响公开面的显示，内部仍要有底）；确实不知道是谁时请显式声明 donor_unknown: true");
  }
  if (!rawId) return { name: rawName, memberId: null };
  const donor = await getMember(rawId);
  if (!donor) throw new AppError(400, "unknown_donor", "捐赠人不存在");
  if (donor.class_id !== actor.class_id) throw new AppError(400, "donor_class_mismatch", "捐赠人必须是本班成员");
  return { name: rawName || null, memberId: donor.id };
}

function entryAuditPayload(entry) {
  return {
    kind: entry.kind, amount_cents: entry.amount_cents, category: entry.category,
    occurred_on: entry.occurred_on, status: entry.status,
    donor_display: entry.donor_display ?? null, payee: entry.payee ?? null,
  };
}

// ---- 记账 ----
async function createEntry(actor, input, now = Date.now()) {
  requireRole(actor, CAN_RECORD, "记账");
  if (input.kind !== "donation" && input.kind !== "expense") {
    throw new AppError(400, "invalid_kind", "kind 必须是 donation 或 expense（区分大小写）");
  }
  if (!Number.isInteger(input.amount_cents) || input.amount_cents <= 0) {
    throw new AppError(400, "invalid_amount", "金额必须为正整数（单位：分）");
  }
  occurredOn(input.occurred_on);
  if (!String(input.category ?? "").trim()) throw new AppError(400, "invalid_category", "类别不能为空");

  const id = newId();
  let entry;
  let stockRow = null;

  if (input.kind === "donation") {
    if (input.donor_display !== "named" && input.donor_display !== "anonymous") {
      throw new AppError(400, "invalid_donor_display", "捐赠必须声明 donor_display: named | anonymous");
    }
    const donor = await resolveDonor(actor, input);
    if (input.donor_display === "named" && donor.memberId !== null && donor.memberId !== actor.id) {
      throw new AppError(403, "consent_required", "实名公示需由捐赠人本人操作；代他人录入请改填姓名，或选择匿名");
    }
    const handledBy = await resolveHandler(actor, input.handled_by);
    entry = {
      id, class_id: actor.class_id, kind: "donation",
      amount_cents: input.amount_cents, category: String(input.category).trim(),
      note: input.note ?? null, occurred_on: input.occurred_on,
      donor_name: donor.name, donor_member_id: donor.memberId, donor_display: input.donor_display,
      payee: null, activity: null, handled_by: handledBy,
      received_at: handledBy === actor.id ? now : null,
      status: "approved", required_approvals: 0,
      created_by: actor.id, created_at: now, published_at: now,
    };
  } else {
    if (!String(input.payee ?? "").trim()) throw new AppError(400, "invalid_payee", "支出必须写明 payee（采购人/商家）");
    const handledBy = await resolveHandler(actor, input.handled_by);
    const needsApproval = input.needs_approval === true;
    entry = {
      id, class_id: actor.class_id, kind: "expense",
      amount_cents: input.amount_cents, category: String(input.category).trim(),
      note: input.note ?? null, occurred_on: input.occurred_on,
      donor_name: null, donor_member_id: null, donor_display: null,
      payee: String(input.payee).trim(), activity: input.activity ?? null,
      handled_by: handledBy, received_at: null,
      status: needsApproval ? "pending" : "approved",
      required_approvals: needsApproval ? requiredApprovalsFor(input.amount_cents) : 0,
      created_by: actor.id, created_at: now,
      published_at: needsApproval ? null : now,
    };
    if (input.stock !== undefined && input.stock !== null) {
      stockRow = await buildInboundRow(actor, {
        item_name: input.stock.item_name, spec: input.stock.spec ?? null,
        quantity: input.stock.quantity, unit: input.stock.unit,
        source: "purchase", entry_id: entry.id, occurred_on: entry.occurred_on,
      }, now, { pendingEntry: entry });
    }
  }

  await sequelize.transaction(async (t) => {
    await Entry.create(entry, { transaction: t });
    if (stockRow) await StockMove.create(stockRow, { transaction: t });
    await appendAudit([
      { actor: actor.id, action: entry.kind === "donation" ? "donation.recorded" : entry.status === "pending" ? "expense.submitted" : "expense.recorded",
        entity: "entry", entityId: id, payload: entryAuditPayload(entry), at: now },
      ...(stockRow ? [{ actor: actor.id, action: "stock.in.purchase", entity: "stock_move", entityId: stockRow.id,
        payload: { item_name: stockRow.item_name, quantity: stockRow.quantity, unit: stockRow.unit }, at: now }] : []),
    ], t);
  });
  return entry;
}

async function patchEntry(actor, id, patch, now = Date.now()) {
  const entry = await Entry.findByPk(id);
  if (!entry) throw new AppError(404, "entry_not_found", "账目不存在");
  if (entry.class_id !== actor.class_id) throw new AppError(403, "cross_class_forbidden", "不能修改其他班级的记录");
  const canEdit = entry.created_by === actor.id ||
    (["committee", "finance"].includes(actor.role) || actor.is_owner);
  if (!canEdit) throw new AppError(403, "forbidden", "只有创建人或家委会/财务可以修改");
  if (entry.status === "approved" && entry.published_at !== null) {
    throw new AppError(409, "already_published", "已公示的账目不能直接修改，请联系财务订正");
  }
  const updates = {};
  if (patch.category !== undefined) updates.category = text(patch.category, "类别", 64, "invalid_category");
  if (patch.note !== undefined) updates.note = optionalText(patch.note, "备注", 500, "invalid_note");
  if (patch.amount_cents !== undefined) {
    if (!Number.isInteger(patch.amount_cents) || patch.amount_cents <= 0) throw new AppError(400, "invalid_amount", "金额必须为正整数（单位：分）");
    updates.amount_cents = patch.amount_cents;
  }
  if (patch.occurred_on !== undefined) updates.occurred_on = occurredOn(patch.occurred_on);
  if (patch.payee !== undefined) {
    if (entry.kind !== "expense") throw new AppError(400, "invalid_patch", "捐赠没有 payee");
    updates.payee = text(patch.payee, "payee", 64, "invalid_payee");
  }
  if (patch.activity !== undefined) updates.activity = optionalText(patch.activity, "活动", 128, "invalid_activity");
  if (Object.keys(updates).length === 0) throw new AppError(400, "empty_patch", "没有可更新的字段");
  await sequelize.transaction(async (t) => {
    await entry.update(updates, { transaction: t });
    await appendAudit([{ actor: actor.id, action: "entry.patched", entity: "entry",
      entityId: id, payload: updates, at: now }], t);
  });
  await entry.reload();
  return entry;
}

// 确认收款（捐赠经手人签收）
async function confirmReceipt(actor, entryId, now = Date.now()) {
  const entry = await Entry.findByPk(entryId);
  if (!entry) throw new AppError(404, "entry_not_found", "账目不存在");
  if (entry.class_id !== actor.class_id) throw new AppError(403, "cross_class_forbidden", "不能确认其他班级的记录");
  if (entry.kind !== "donation") throw new AppError(400, "not_a_donation", "只有捐赠需要确认收到（支出是钱出去，没有收方要签收）");
  if (entry.handled_by !== actor.id) throw new AppError(403, "not_the_handler", "只有这笔捐赠的经手人本人可以确认收到");
  if (entry.received_at !== null) throw new AppError(409, "already_confirmed", "这笔捐赠已经确认过了");
  await sequelize.transaction(async (t) => {
    const [n] = await Entry.update({ received_at: now },
      { where: { id: entryId, received_at: null }, transaction: t });
    if (n !== 1) throw new AppError(409, "already_confirmed", "这笔捐赠刚被确认过，请刷新");
    await appendAudit([{ actor: actor.id, action: "donation.receipt_confirmed", entity: "entry",
      entityId: entryId, payload: { received_at: now, handled_by: actor.id }, at: now }], t);
  });
  return { id: entryId, received_at: now, confirmed_by: actor.id };
}


const INDEPENDENT_APPROVERS = ["finance", "auditor"];

// 审批
async function decideEntry(actor, entryId, decision, reason = null, now = Date.now()) {
  requireRole(actor, CAN_APPROVE, "审批");
  if (decision !== "approve" && decision !== "reject") {
    throw new AppError(400, "invalid_decision", "decision 必须是 approve | reject");
  }
  const entry = await Entry.findByPk(entryId);
  if (!entry) throw new AppError(404, "entry_not_found", "账目不存在");
  if (entry.status !== "pending") throw new AppError(409, "not_pending", `账目状态为 ${entry.status}，不可再审批`);
  if (entry.class_id !== actor.class_id) throw new AppError(403, "cross_class_forbidden", "不能审批其他班级的账目");
  if (entry.created_by === actor.id) throw new AppError(403, "conflict_of_interest", "提交人不能审批自己提交的账目");
  const already = await Approval.findOne({ where: { entry_id: entryId, member_id: actor.id } });
  if (already) throw new AppError(409, "already_signed", "你已经签过这一条了");

  return sequelize.transaction(async (t) => {
    // 并发保护：事务内重读，状态已变则拒绝
    const locked = await Entry.findByPk(entryId, { transaction: t, lock: t.LOCK.UPDATE });
    if (!locked || locked.status !== "pending") {
      throw new AppError(409, "not_pending", "这笔账目刚被处理过，请刷新");
    }
    const counts = await approvalCounts(entryId); // 先计数（不含本次），再 +1
    const after = {
      approve: counts.approve + (decision === "approve" ? 1 : 0),
      reject: counts.reject + (decision === "reject" ? 1 : 0),
    };
    await Approval.create({ id: newId(), entry_id: entryId, member_id: actor.id,
      decision, reason: reason ?? null, created_at: now }, { transaction: t });
    let published = false;
    if (decision === "reject") {
      await locked.update({ status: "rejected" }, { transaction: t });
    } else if (after.approve >= locked.required_approvals) {
      // 防角色陷阱：票数够还不够，必须有一票来自独立审批人（finance/auditor）
      const roleRows = await sequelize.query(
        `SELECT DISTINCT m.role AS role FROM approvals ap JOIN members m ON m.id = ap.member_id
         WHERE ap.entry_id = ? AND ap.decision = 'approve'`,
        { replacements: [entryId], type: sequelize.QueryTypes.SELECT, transaction: t });
      const roles = roleRows.map((r) => r.role);
      if ([...roles, actor.role].some((r) => INDEPENDENT_APPROVERS.includes(r))) {
        await locked.update({ status: "approved", published_at: now }, { transaction: t });
        published = true;
      }
    }
    await appendAudit([{ actor: actor.id,
      action: decision === "reject" ? "expense.rejected" : "expense.approval_recorded",
      entity: "entry", entityId: entryId,
      payload: { decision, reason: reason ?? null, approvals_after: after,
        required: locked.required_approvals, approver_role: actor.role,
        resulting_status: published ? "approved" : locked.status, published_at: published ? now : null },
      at: now }], t);
    await locked.reload({ transaction: t });
    const view = toPublicView(locked.get({ plain: true }), locked.donor_name, after, 0, [], null, "internal");
    return { entry: locked.get({ plain: true }), published, approvals: after, view };
  });
}

// ---- 物资 ----
const STOCK_SOURCES = ["donation", "purchase", "other"];

async function buildInboundRow(actor, input, now, opts = {}) {
  if (!STOCK_SOURCES.includes(input.source)) {
    throw new AppError(400, "invalid_source", "source 必须是 donation | purchase | other（区分大小写）");
  }
  const handledBy = await resolveHandler(actor, input.handled_by);
  const row = {
    id: newId(), class_id: actor.class_id, direction: "in",
    item_name: text(input.item_name, "物品名称", 40, "invalid_item_name"),
    spec: optionalText(input.spec, "规格", 60, "invalid_spec"),
    quantity: quantity(input.quantity),
    unit: text(input.unit, "单位", 8, "invalid_unit"),
    source: input.source, member_id: null, donor_display: null, entry_id: null, purpose: null,
    est_value_cents: estValue(input.est_value_cents),
    note: optionalText(input.note, "备注", 200, "invalid_note"),
    occurred_on: occurredOn(input.occurred_on),
    handled_by: handledBy,
    received_at: handledBy === actor.id ? now : null,
    created_by: actor.id, created_at: now, published_at: now,
  };
  if (input.source === "donation") {
    if (input.donor_display !== "named" && input.donor_display !== "anonymous") {
      throw new AppError(400, "invalid_donor_display", "实物捐赠必须声明 donor_display: named | anonymous");
    }
    row.donor_display = input.donor_display;
    const donorId = String(input.member_id ?? "").trim();
    if (!donorId) {
      if (!(input.donor_display === "anonymous" && input.donor_unknown === true)) {
        throw new AppError(400, "donor_required",
          "请记下这批东西是哪位家长捐的（匿名只影响公开台账的显示，内部仍要有底）；确实不知道是谁时请显式声明 donor_unknown: true");
      }
    } else {
      const donor = await getMember(donorId);
      if (!donor) throw new AppError(400, "unknown_donor", "捐赠人不存在");
      if (donor.class_id !== actor.class_id) throw new AppError(400, "donor_class_mismatch", "捐赠人必须是本班成员");
      if (input.donor_display === "named" && donorId !== actor.id) {
        throw new AppError(403, "consent_required", "实名公示需由捐赠人本人操作；代他人录入只能选择匿名");
      }
      row.member_id = donorId;
    }
  } else if (input.source === "purchase") {
    if (input.donor_display || input.member_id) {
      throw new AppError(400, "invalid_stock_move", "采购入库不能带捐赠人 / 公示方式");
    }
    const entryId = String(input.entry_id ?? "").trim();
    if (!entryId) throw new AppError(400, "missing_entry_id", "采购入库必须关联一笔支出（entry_id）");
    const entry = opts.pendingEntry && opts.pendingEntry.id === entryId
      ? opts.pendingEntry : await Entry.findByPk(entryId);
    if (!entry) throw new AppError(404, "entry_not_found", "关联的支出不存在");
    if (entry.class_id !== actor.class_id) throw new AppError(403, "cross_class_forbidden", "不能关联其他班级的支出");
    if (entry.kind !== "expense") throw new AppError(400, "invalid_entry_kind", "只能关联支出（expense），不能关联捐赠");
    row.entry_id = entryId;
  } else {
    if (input.donor_display || input.member_id || input.entry_id) {
      throw new AppError(400, "invalid_stock_move", "其他入库不能带捐赠人 / 公示方式 / 关联支出");
    }
  }
  return row;
}

async function stockIn(actor, input, now = Date.now()) {
  requireRole(actor, CAN_RECORD, "登记物资");
  const row = await buildInboundRow(actor, input, now);
  await sequelize.transaction(async (t) => {
    await StockMove.create(row, { transaction: t });
    await appendAudit([{ actor: actor.id, action: `stock.in.${row.source}`, entity: "stock_move",
      entityId: row.id, payload: { item_name: row.item_name, quantity: row.quantity, unit: row.unit }, at: now }], t);
  });
  return row;
}

async function itemBalance(classId, itemName, unit) {
  const { q1: one } = require("../db");
  const row = await one(
    `SELECT COALESCE(SUM(CASE WHEN direction='in' THEN quantity END),0) - COALESCE(SUM(CASE WHEN direction='out' THEN quantity END),0) AS bal
     FROM stock_moves WHERE class_id = ? AND item_name = ? AND unit = ?`, [classId, itemName, unit]);
  return Number(row.bal);
}

async function stockOut(actor, input, now = Date.now()) {
  requireRole(actor, CAN_RECORD, "登记物资");
  const itemName = text(input.item_name, "物品名称", 40, "invalid_item_name");
  const unit = text(input.unit, "单位", 8, "invalid_unit");
  const qty = quantity(input.quantity);
  const bal = await itemBalance(actor.class_id, itemName, unit);
  if (qty > bal) {
    throw new AppError(400, "insufficient_stock",
      `「${itemName}」当前结余 ${bal} ${unit}，不够出库 ${qty} ${unit}。若是系统里没登记过的存量，请先用「其他入库」补登。`);
  }
  const row = {
    id: newId(), class_id: actor.class_id, direction: "out",
    item_name: itemName, spec: null, quantity: qty, unit, source: "other",
    member_id: null, donor_display: null, entry_id: null,
    purpose: text(input.purpose, "用途", 80, "invalid_purpose"),
    est_value_cents: null, note: optionalText(input.note, "备注", 200, "invalid_note"),
    occurred_on: occurredOn(input.occurred_on),
    handled_by: await resolveHandler(actor, input.handled_by),
    received_at: now, created_by: actor.id, created_at: now, published_at: now,
  };
  await sequelize.transaction(async (t) => {
    await StockMove.create(row, { transaction: t });
    await appendAudit([{ actor: actor.id, action: "stock.out", entity: "stock_move",
      entityId: row.id, payload: { item_name: row.item_name, quantity: row.quantity, unit: row.unit, purpose: row.purpose }, at: now }], t);
  });
  return row;
}

async function confirmStockReceipt(actor, id, now = Date.now()) {
  const row = await StockMove.findByPk(id);
  if (!row) throw new AppError(404, "stock_move_not_found", "物资流水不存在");
  if (row.class_id !== actor.class_id) throw new AppError(403, "cross_class_forbidden", "不能确认其他班级的物资流水");
  if (row.direction !== "in") throw new AppError(400, "not_inbound", "只有入库需要确认收到");
  if (row.handled_by !== actor.id) throw new AppError(403, "not_the_handler", "只有这批物资的经手人本人可以确认收到");
  if (row.received_at !== null) throw new AppError(409, "already_confirmed", "这批物资已经确认过了");
  await sequelize.transaction(async (t) => {
    const [n] = await StockMove.update({ received_at: now }, { where: { id, received_at: null }, transaction: t });
    if (n !== 1) throw new AppError(409, "already_confirmed", "这批物资刚被确认过，请刷新");
    await appendAudit([{ actor: actor.id, action: "stock.receipt_confirmed", entity: "stock_move",
      entityId: id, payload: { received_at: now }, at: now }], t);
  });
  return { id, received_at: now, confirmed_by: actor.id };
}

async function patchStockMove(actor, id, patch, now = Date.now()) {
  requireRole(actor, CAN_VIEW_INTERNAL, "修改物资记录");
  const row = await StockMove.findByPk(id);
  if (!row) throw new AppError(404, "stock_move_not_found", "物资流水不存在");
  if (row.class_id !== actor.class_id) throw new AppError(403, "cross_class_forbidden", "不能修改其他班级的记录");
  const updates = {};
  if (patch.note !== undefined) updates.note = optionalText(patch.note, "备注", 200, "invalid_note");
  if (patch.spec !== undefined) updates.spec = optionalText(patch.spec, "规格", 60, "invalid_spec");
  if (patch.est_value_cents !== undefined) updates.est_value_cents = estValue(patch.est_value_cents);
  if (Object.keys(updates).length === 0) throw new AppError(400, "empty_patch", "没有可更新的字段");
  await sequelize.transaction(async (t) => {
    await row.update(updates, { transaction: t });
    await appendAudit([{ actor: actor.id, action: "stock.patched", entity: "stock_move",
      entityId: id, payload: updates, at: now }], t);
  });
  await row.reload();
  return row;
}

module.exports = {
  createEntry, patchEntry, confirmReceipt, decideEntry,
  stockIn, stockOut, confirmStockReceipt, patchStockMove, itemBalance,
  resolveHandler, resolveDonor,
};
