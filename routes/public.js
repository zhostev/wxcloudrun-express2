// 公开只读 API（无需登录）
const express = require("express");
const { Class, Attachment, Entry, q1 } = require("../db");
const { AppError } = require("../lib/util");
const { publicSummary, publicLedger, getEntryDetail, publicStock } = require("../lib/views");
const { buildShareCard, asofDate } = require("../lib/sharecard");
const { listItems } = require("../lib/views");
const { currentMember } = require("../lib/auth");
const { CAN_VIEW_INTERNAL } = require("../lib/auth");
const r2 = require("../lib/r2");

const router = express.Router();
const DEFAULT_CLASS_ID = process.env.DEFAULT_CLASS_ID;

// 多班级预留：目前只有 904 一个班
async function resolveClassId(classId) {
  const id = classId ? String(classId) : DEFAULT_CLASS_ID || (await Class.findOne())?.id;
  const cls = id ? await Class.findByPk(id) : null;
  if (!cls) throw new AppError(404, "class_not_found", "班级不存在");
  return cls.id;
}
function intParam(raw, dflt, min, max, name) {
  if (raw === undefined || raw === null || raw === "") return dflt;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < min || n > max) {
    throw new AppError(400, "invalid_param", `${name} 必须在 ${min}..${max} 之间`);
  }
  return n;
}

router.get("/classes", async (req, res, next) => {
  try {
    const classes = await Class.findAll({ order: [["created_at", "ASC"]] });
    res.json({ classes: classes.map((c) => c.get({ plain: true })) });
  } catch (e) { next(e); }
});

router.get("/app", async (req, res, next) => {  try {
    const cls = await Class.findByPk(await resolveClassId(req.query.class_id));
    res.json({ class_id: cls.id, name: cls.name, term: cls.term, app_name: process.env.PUBLIC_APP_NAME || cls.name });
  } catch (e) { next(e); }
});

router.get("/summary", async (req, res, next) => {
  try { res.json(await publicSummary(await resolveClassId(req.query.class_id))); }
  catch (e) { next(e); }
});

router.get("/ledger", async (req, res, next) => {
  try {
    const classId = await resolveClassId(req.query.class_id);
    const limit = intParam(req.query.limit, 20, 1, 100, "limit");
    const offset = intParam(req.query.offset, 0, 0, 100000, "offset");
    const items = await publicLedger(classId, limit, offset);
    res.json({ class_id: classId, count: items.length, items });
  } catch (e) { next(e); }
});

router.get("/stock", async (req, res, next) => {
  try {
    const classId = await resolveClassId(req.query.class_id);
    const limit = intParam(req.query.limit, 50, 1, 200, "limit");
    const offset = intParam(req.query.offset, 0, 0, 100000, "offset");
    res.json(await publicStock(classId, limit, offset));
  } catch (e) { next(e); }
});

router.get("/entries/:id", async (req, res, next) => {
  try {
    const got = await getEntryDetail(req.params.id, "public", "public");
    if (!got) throw new AppError(404, "entry_not_found", "账目不存在");
    if (got.entry.status !== "approved" || got.entry.published_at === null) {
      throw new AppError(404, "not_published", "该账目尚未公示");
    }
    res.json(got.view);
  } catch (e) { next(e); }
});

// 分享卡数据模型（小程序本地 canvas 渲染用）
router.get("/share-card", async (req, res, next) => {
  try {
    const classId = await resolveClassId(req.query.class_id);
    const cls = await Class.findByPk(classId);
    const summary = await publicSummary(classId);
    const items = await publicLedger(classId, 20, 0);
    const stockItemsRaw = await listItems(classId);
    const stockMoves = (await publicStock(classId, 100, 0)).moves;
    const stockItems = stockItemsRaw.filter((i) => i.balance > 0)
      .map((i) => ({ name: i.item_name, quantity: i.balance, unit: i.unit }));
    res.json(buildShareCard({ name: cls.name, term: cls.term }, summary, items, stockItems, asofDate(), stockMoves));
  } catch (e) { next(e); }
});

const INLINE_TYPES = new Set(["image/png", "image/jpeg", "image/webp", "image/gif"]);

async function receiptOwner(att) {
  if (att.entry_id) {
    const e = await Entry.findByPk(att.entry_id);
    if (!e) return null;
    return { classId: e.class_id, published: e.status === "approved" && e.published_at !== null };
  }
  const { StockMove } = require("../db");
  const m = await StockMove.findByPk(att.stock_move_id);
  if (!m) return null;
  return { classId: m.class_id, published: m.published_at !== null };
}

// 公开凭证文件：内部凭证或未公示账目的凭证 → 仅内部角色可看
router.get("/receipts/:id", async (req, res, next) => {
  try {
    const att = await Attachment.findByPk(req.params.id);
    if (!att) throw new AppError(404, "not_found", "凭证不存在");
    const owner = await receiptOwner(att);
    if (!owner) throw new AppError(404, "not_found", "凭证不存在");
    if (att.visibility === "internal" || !owner.published) {
      const member = await currentMember(req);
      if (!member || member.class_id !== owner.classId || !CAN_VIEW_INTERNAL.includes(member.role)) {
        throw new AppError(403, "forbidden", "该凭证不公开（仅家委会 / 班主任 / 审核可查看）");
      }
    }
    const obj = await r2.getObject(att.r2_key).catch(() => null);
    if (!obj) throw new AppError(404, "not_found", "凭证文件已不存在");
    const inline = INLINE_TYPES.has(att.content_type);
    res.set({
      "content-type": att.content_type,
      "content-disposition": `${inline ? "inline" : "attachment"}; filename*=UTF-8''${encodeURIComponent(att.filename)}`,
      "x-content-type-options": "nosniff",
      "cache-control": "private, max-age=300",
      "x-receipt-sha256": att.sha256,
      "x-receipt-visibility": att.visibility,
    });
    if (obj.contentLength) res.set("content-length", obj.contentLength);
    obj.body.on("error", (err) => {
      if (!res.headersSent) next(new AppError(502, "receipt_unavailable", `凭证读取失败：${err.message}`));
      else res.destroy();
    });
    obj.body.pipe(res);
  } catch (e) { next(e); }
});

module.exports = router;
