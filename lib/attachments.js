// 凭证附件：multipart 上传 → R2，元数据进 MySQL（与 Worker 版一致）
const { sequelize, Attachment, Entry, StockMove, q } = require("../db");
const { AppError, newId, sha256Hex } = require("./util");
const { requireRole, CAN_RECORD, CAN_VIEW_INTERNAL } = require("./auth");
const { appendAudit } = require("./audit");
const r2 = require("./r2");

const MAX_RECEIPT_BYTES = 8 * 1024 * 1024;
const ALLOWED_TYPES = new Set([
  "image/png", "image/jpeg", "image/webp", "image/gif", "application/pdf",
]);

function normalizeReceiptType(ct) {
  const t = String(ct || "").split(";")[0].trim().toLowerCase();
  if (!ALLOWED_TYPES.has(t)) {
    throw new AppError(400, "invalid_file_type", "凭证只支持 png / jpeg / webp / gif / pdf");
  }
  return t;
}
function visibilityFrom(v) {
  return v === "public" || v === "internal" ? v : undefined;
}
function defaultVisibility(target) {
  // 捐赠凭证默认内部（防截图里的人名/账号尾号），支出凭证默认公开
  return target.kind === "donation" ? "internal" : "public";
}

async function attachReceipt(actor, target, file, opts = {}, now = Date.now()) {
  requireRole(actor, CAN_RECORD, "上传凭证");
  const t = typeof target === "string" ? { entryId: target } : target;
  let entryId = null, stockMoveId = null, kind, auditEntity, ownerId;
  if ("entryId" in t) {
    const entry = await Entry.findByPk(t.entryId);
    if (!entry) throw new AppError(404, "entry_not_found", "账目不存在");
    if (entry.class_id !== actor.class_id) throw new AppError(403, "cross_class_forbidden", "不能给其他班级的账目上传凭证");
    entryId = entry.id; kind = entry.kind; auditEntity = "entry"; ownerId = entry.id;
  } else {
    const move = await StockMove.findByPk(t.stockMoveId);
    if (!move) throw new AppError(404, "stock_move_not_found", "物资流水不存在");
    if (move.class_id !== actor.class_id) throw new AppError(403, "cross_class_forbidden", "不能给其他班级的物资流水上传凭证");
    stockMoveId = move.id; kind = "stock_move"; auditEntity = "stock_move"; ownerId = move.id;
  }
  const visibility = opts.visibility === "public" || opts.visibility === "internal"
    ? opts.visibility : defaultVisibility({ kind });
  if (kind === "donation" && visibility === "public" && !opts.confirmPublicRisk) {
    throw new AppError(400, "public_receipt_confirmation_required", "公开捐赠凭证前请确认截图不含姓名、账号尾号或余额等隐私信息");
  }
  const contentType = normalizeReceiptType(file.mimetype);
  if (!file.size) throw new AppError(400, "empty_file", "凭证文件为空");
  if (file.size > MAX_RECEIPT_BYTES) throw new AppError(413, "file_too_large", "凭证不得超过 8MB");
  const sha = sha256Hex(file.buffer);
  const id = newId();
  const key = `receipts/${ownerId}/${id}`;
  await r2.putObject(key, file.buffer, contentType, { sha256: sha, filename: file.originalname || "receipt" });
  const row = await sequelize.transaction(async (tx) => {
    const att = await Attachment.create({
      id, entry_id: entryId, stock_move_id: stockMoveId, visibility,
      r2_key: key, filename: file.originalname || "receipt", content_type: contentType,
      size_bytes: file.size, sha256: sha, uploaded_by: actor.id, created_at: now,
    }, { transaction: tx });
    await appendAudit([{ actor: actor.id, action: "receipt.attached", entity: auditEntity, entityId: ownerId,
      payload: { attachment_id: id, filename: att.filename, content_type: contentType,
        size_bytes: file.size, sha256: sha, visibility }, at: now }], tx);
    return att;
  });
  return row;
}

async function listAttachments(actor, target) {
  requireRole(actor, CAN_VIEW_INTERNAL, "查看凭证列表");
  let items;
  if (typeof target === "string" || "entryId" in target) {
    const entryId = typeof target === "string" ? target : target.entryId;
    const entry = await Entry.findByPk(entryId);
    if (!entry || entry.class_id !== actor.class_id) throw new AppError(404, "entry_not_found", "账目不存在");
    items = await q(`SELECT * FROM attachments WHERE entry_id = ? ORDER BY created_at ASC`, [entryId]);
  } else {
    const move = await StockMove.findByPk(target.stockMoveId);
    if (!move || move.class_id !== actor.class_id) throw new AppError(404, "stock_move_not_found", "物资流水不存在");
    items = await q(`SELECT * FROM attachments WHERE stock_move_id = ? ORDER BY created_at ASC`, [target.stockMoveId]);
  }
  return items.map((a) => ({
    id: a.id, filename: a.filename, content_type: a.content_type,
    size_bytes: a.size_bytes, sha256: a.sha256, visibility: a.visibility, created_at: a.created_at,
  }));
}

module.exports = { attachReceipt, listAttachments, visibilityFrom, MAX_RECEIPT_BYTES };
