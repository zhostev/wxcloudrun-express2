// 904 班级账本 · 微信云托管后端（Express + MySQL + R2）
const express = require("express");
const cors = require("cors");
const morgan = require("morgan");
const { initDB, counterRouter } = require("./db");
const { AppError } = require("./lib/util");

const app = express();
app.use(cors());
app.use(morgan("combined"));
app.use(express.json({ limit: "1mb" }));

app.get("/health", (req, res) => res.json({ ok: true, service: "class-fund-ledger", ts: Date.now() }));

app.use("/", counterRouter()); // 模板保留：/ /api/count /api/wx_openid

app.use("/api/public", require("./routes/public"));
app.use("/api/auth", require("./routes/auth"));
app.use("/api/entries", require("./routes/entries"));
app.use("/api/stock", require("./routes/stock"));
app.use("/api/members", require("./routes/members"));
app.use("/api/invitations", require("./routes/invitations"));
app.use("/api/duty", require("./routes/duty"));
app.use("/api/audit", require("./routes/audit"));

// 小程序兼容别名：GET /api/me（= /api/auth/me）
const authRouter = require("./routes/auth");
app.get("/api/me", require("./lib/auth").auth(false), (req, res) => {
  if (!req.member) return res.json({ member: null });
  res.json({ member: authRouter.memberPayload(req.member) });
});

// 内部凭证文件：/api/receipts/:id（需登录 + 内部角色）
const { Attachment } = require("./db");
const { auth, requireRole, CAN_VIEW_INTERNAL } = require("./lib/auth");
const r2 = require("./lib/r2");
app.get("/api/receipts/:id", auth(true), async (req, res, next) => {
  try {
    requireRole(req.member, CAN_VIEW_INTERNAL, "查看内部凭证");
    const att = await Attachment.findByPk(req.params.id);
    if (!att) throw new AppError(404, "not_found", "凭证不存在");
    const { Entry, StockMove } = require("./db");
    const ownerClass = att.entry_id
      ? (await Entry.findByPk(att.entry_id))?.class_id
      : (await StockMove.findByPk(att.stock_move_id))?.class_id;
    if (!ownerClass || ownerClass !== req.member.class_id) throw new AppError(404, "not_found", "凭证不存在");
    const obj = await r2.getObject(att.r2_key).catch(() => null);
    if (!obj) throw new AppError(404, "not_found", "凭证文件已不存在");
    res.set({
      "content-type": att.content_type,
      "content-disposition": `inline; filename*=UTF-8''${encodeURIComponent(att.filename)}`,
      "x-content-type-options": "nosniff",
      "cache-control": "private, max-age=300",
      "x-receipt-sha256": att.sha256,
    });
    obj.body.on("error", (err) => {
      if (!res.headersSent) next(new AppError(502, "receipt_unavailable", `凭证读取失败：${err.message}`));
      else res.destroy();
    });
    obj.body.pipe(res);
  } catch (e) { next(e); }
});

// 404
app.use("/api", (req, res) => res.status(404).json({ error: "not_found", message: "接口不存在" }));

// 统一错误
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  if (err instanceof AppError) {
    return res.status(err.status).json({ error: err.code, message: err.message });
  }
  if (err && err.code === "LIMIT_FILE_SIZE") {
    return res.status(413).json({ error: "file_too_large", message: "文件不得超过 8MB" });
  }
  console.error("[api-error]", err);
  res.status(500).json({ error: "internal_error", message: "服务器开小差了，请稍后重试" });
});

const port = process.env.PORT || 80;

async function bootstrap() {
  await initDB();
  if (process.env.IMPORT_ON_BOOT === "1") {
    const { runImport } = require("./scripts/import_d1");
    await runImport({ jsonPath: process.env.IMPORT_JSON || "/tmp/d1_export.json" });
  }
  app.listen(port, () => {
    console.log(`✅ 服务启动成功，端口 ${port}`);
  });
}

bootstrap().catch((err) => {
  console.error("❌ 服务启动失败：", err);
  process.exit(1);
});

module.exports = app;
