// 审计查询（内部角色可读）
const express = require("express");
const { auth, requireRole, CAN_VIEW_INTERNAL } = require("../lib/auth");
const { verifyChain } = require("../lib/audit");

const router = express.Router();
router.use(auth(true));

router.get("/verify", async (req, res, next) => {
  try {
    requireRole(req.member, CAN_VIEW_INTERNAL, "查看审计校验");
    res.json(await verifyChain());
  } catch (e) { next(e); }
});

module.exports = router;
