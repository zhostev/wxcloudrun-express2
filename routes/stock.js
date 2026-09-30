// 物资台账（内部）+ 出入库 + 凭证上传
const express = require("express");
const multer = require("multer");
const { auth, requireRole, CAN_VIEW_INTERNAL } = require("../lib/auth");
const { AppError } = require("../lib/util");
const { internalStock } = require("../lib/views");
const { stockIn, stockOut, confirmStockReceipt, patchStockMove } = require("../lib/ledger");
const { attachReceipt, listAttachments, visibilityFrom } = require("../lib/attachments");

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 8 * 1024 * 1024 } });

router.use(auth(true));

router.get("/", async (req, res, next) => {
  try {
    requireRole(req.member, CAN_VIEW_INTERNAL, "查看内部物资台账");
    res.json(await internalStock(req.member.class_id));
  } catch (e) { next(e); }
});

router.post("/in", async (req, res, next) => {
  try {
    if (!req.body || typeof req.body !== "object") throw new AppError(400, "invalid_body", "请求体必须是 JSON 对象");
    const row = await stockIn(req.member, req.body);
    res.status(201).json(row);
  } catch (e) { next(e); }
});

router.post("/out", async (req, res, next) => {
  try {
    if (!req.body || typeof req.body !== "object") throw new AppError(400, "invalid_body", "请求体必须是 JSON 对象");
    const row = await stockOut(req.member, req.body);
    res.status(201).json(row);
  } catch (e) { next(e); }
});

router.post("/:id/receipt", async (req, res, next) => {
  try {
    res.json(await confirmStockReceipt(req.member, req.params.id));
  } catch (e) { next(e); }
});

router.patch("/:id", async (req, res, next) => {
  try {
    if (!req.body || typeof req.body !== "object") throw new AppError(400, "invalid_body", "请求体必须是 JSON 对象");
    const row = await patchStockMove(req.member, req.params.id, req.body);
    res.json(row);
  } catch (e) { next(e); }
});

router.post("/:id/attachments", upload.single("file"), async (req, res, next) => {
  try {
    if (!req.file) throw new AppError(400, "missing_file", "multipart 字段 file 缺失");
    const att = await attachReceipt(req.member, { stockMoveId: req.params.id }, {
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

router.get("/:id/attachments", async (req, res, next) => {
  try {
    const items = await listAttachments(req.member, { stockMoveId: req.params.id });
    res.json({ count: items.length, items });
  } catch (e) { next(e); }
});

module.exports = router;
