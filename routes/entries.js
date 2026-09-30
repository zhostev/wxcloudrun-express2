// 账目：内部列表 / 记账 / 修改 / 确认收到 / 审批 / 凭证上传
const express = require("express");
const multer = require("multer");
const { auth } = require("../lib/auth");
const { AppError } = require("../lib/util");
const { listEntries, getEntryDetail, approvalCounts, receiptCount, toPublicReceipt } = require("../lib/views");
const { createEntry, patchEntry, confirmReceipt, decideEntry } = require("../lib/ledger");
const { attachReceipt, listAttachments, visibilityFrom } = require("../lib/attachments");
const { requireRole, CAN_APPROVE, CAN_VIEW_INTERNAL } = require("../lib/auth");
const { Attachment } = require("../db");
const r2 = require("../lib/r2");

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 8 * 1024 * 1024 } });

router.use(auth(true));

// 内部列表（含待审批/未公示）
router.get("/", async (req, res, next) => {
  try {
    requireRole(req.member, CAN_VIEW_INTERNAL, "查看内部账目");
    const status = req.query.status;
    if (status !== undefined && !["pending", "approved", "rejected"].includes(status)) {
      throw new AppError(400, "invalid_status", "status 必须是 pending|approved|rejected");
    }
    const items = await listEntries(req.member.class_id, status);
    res.json({ class_id: req.member.class_id, count: items.length, items });
  } catch (e) { next(e); }
});

// 待我审批
router.get("/pending", async (req, res, next) => {
  try {
    requireRole(req.member, CAN_APPROVE, "审批");
    const items = (await listEntries(req.member.class_id, "pending"))
      .filter((e) => e.created_by !== req.member.id);
    res.json({ class_id: req.member.class_id, count: items.length, items });
  } catch (e) { next(e); }
});

// 我提交的
router.get("/mine", async (req, res, next) => {
  try {
    requireRole(req.member, CAN_VIEW_INTERNAL, "查看内部账目");
    const items = (await listEntries(req.member.class_id))
      .filter((e) => e.created_by === req.member.id);
    res.json({ class_id: req.member.class_id, count: items.length, items });
  } catch (e) { next(e); }
});

// 记账
router.post("/", async (req, res, next) => {
  try {
    if (!req.body || typeof req.body !== "object") {
      throw new AppError(400, "invalid_body", "请求体必须是 JSON 对象");
    }
    const entry = await createEntry(req.member, req.body);
    res.status(201).json(entry);
  } catch (e) { next(e); }
});

router.get("/:id", async (req, res, next) => {
  try {
    requireRole(req.member, CAN_VIEW_INTERNAL, "查看内部账目");
    const got = await getEntryDetail(req.params.id, "internal", "internal");
    if (!got) throw new AppError(404, "entry_not_found", "账目不存在");
    if (got.entry.class_id !== req.member.class_id) throw new AppError(404, "entry_not_found", "账目不存在");
    res.json({ ...got.view, created_by: got.entry.created_by });
  } catch (e) { next(e); }
});

router.patch("/:id", async (req, res, next) => {
  try {
    if (!req.body || typeof req.body !== "object") throw new AppError(400, "invalid_body", "请求体必须是 JSON 对象");
    const entry = await patchEntry(req.member, req.params.id, req.body);
    res.json(entry);
  } catch (e) { next(e); }
});

// 确认收到捐赠
router.post("/:id/receipt", async (req, res, next) => {
  try {
    res.json(await confirmReceipt(req.member, req.params.id));
  } catch (e) { next(e); }
});

// 审批
router.post("/:id/approve", async (req, res, next) => {
  try {
    const r = await decideEntry(req.member, req.params.id, "approve", req.body?.reason ?? null);
    res.json({ id: req.params.id, status: r.entry.status, published: r.published, approvals: r.approvals });
  } catch (e) { next(e); }
});
router.post("/:id/reject", async (req, res, next) => {
  try {
    const r = await decideEntry(req.member, req.params.id, "reject", req.body?.reason ?? null);
    res.json({ id: req.params.id, status: r.entry.status, published: false, approvals: r.approvals });
  } catch (e) { next(e); }
});
// 小程序兼容：POST /:id/approvals { decision: "approve"|"reject", reason? }
router.post("/:id/approvals", async (req, res, next) => {
  try {
    const decision = req.body?.decision;
    if (decision !== "approve" && decision !== "reject") {
      throw new AppError(400, "invalid_decision", "decision 必须是 approve | reject");
    }
    const r = await decideEntry(req.member, req.params.id, decision, req.body?.reason ?? null);
    res.json({ id: req.params.id, status: r.entry.status, published: r.published, approvals: r.approvals });
  } catch (e) { next(e); }
});

// 凭证上传
router.post("/:id/attachments", upload.single("file"), async (req, res, next) => {
  try {
    if (!req.file) throw new AppError(400, "missing_file", "multipart 字段 file 缺失");
    const att = await attachReceipt(req.member, { entryId: req.params.id }, {
      mimetype: req.file.mimetype, size: req.file.size,
      originalname: req.file.originalname, buffer: req.file.buffer,
    }, {
      visibility: visibilityFrom(req.body?.visibility),
      confirmPublicRisk: String(req.body?.confirm_public_risk ?? "") === "1",
    });
    res.status(201).json({
      id: att.id, filename: att.filename, size_bytes: att.size_bytes,
      sha256: att.sha256, visibility: att.visibility,
    });
  } catch (e) { next(e); }
});

// 凭证列表（内部）
router.get("/:id/attachments", async (req, res, next) => {
  try {
    const items = await listAttachments(req.member, { entryId: req.params.id });
    res.json({ count: items.length, items });
  } catch (e) { next(e); }
});

module.exports = router;
