// 值日
const express = require("express");
const { auth, requireManage } = require("../lib/auth");
const { AppError } = require("../lib/util");
const duty = require("../lib/duty");

const router = express.Router();
router.use(auth(true));

router.get("/", async (req, res, next) => {
  try { res.json(await duty.list(req.member.class_id, req.member)); }
  catch (e) { next(e); }
});

router.post("/init", requireManage, async (req, res, next) => {
  try { res.json(await duty.initGroups(req.member.class_id)); }
  catch (e) { next(e); }
});

router.post("/generate", requireManage, async (req, res, next) => {
  try {
    if (!req.body?.week_start) throw new AppError(400, "invalid_body", "请提供周一日期 week_start");
    res.json(await duty.generate(req.member.class_id, req.body.week_start));
  } catch (e) { next(e); }
});

router.patch("/shifts/:id", requireManage, async (req, res, next) => {
  try {
    if (!req.body || typeof req.body !== "object") throw new AppError(400, "invalid_body", "请求体必须是 JSON 对象");
    res.json({ shift: await duty.updateShift(req.member.class_id, req.params.id, req.body) });
  } catch (e) { next(e); }
});

module.exports = router;
