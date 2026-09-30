// 成员管理 + 邀请码
const express = require("express");
const { auth, requireManage } = require("../lib/auth");
const { AppError } = require("../lib/util");
const { listMembers, hasIndependentApprover, createMember, updateMember, bulkCreateMembers, issueCode, ttlMinutes, toAdminView } = require("../lib/members");

const router = express.Router();
router.use(auth(true));
router.use(requireManage);

router.get("/", async (req, res, next) => {
  try {
    const items = await listMembers(req.member.class_id);
    res.json({
      class_id: req.member.class_id, count: items.length, items,
      has_independent_approver: await hasIndependentApprover(req.member.class_id),
    });
  } catch (e) { next(e); }
});

router.post("/", async (req, res, next) => {
  try {
    if (!req.body || typeof req.body !== "object") throw new AppError(400, "invalid_body", "请求体必须是 JSON 对象");
    res.status(201).json({ member: await createMember(req.member, req.body) });
  } catch (e) { next(e); }
});

router.post("/bulk", async (req, res, next) => {
  try {
    if (!req.body || typeof req.body !== "object" || typeof req.body.text !== "string") {
      throw new AppError(400, "invalid_body", "请求体必须是 JSON 对象，且带 text（逐行文本）");
    }
    res.json(await bulkCreateMembers(req.member, req.body.text, req.body.default_role ?? "committee"));
  } catch (e) { next(e); }
});

router.patch("/:id", async (req, res, next) => {
  try {
    if (!req.body || typeof req.body !== "object") throw new AppError(400, "invalid_body", "请求体必须是 JSON 对象");
    res.json({ member: await updateMember(req.member, req.params.id, req.body) });
  } catch (e) { next(e); }
});

// ---- 邀请码（在 routes/invitations.js 独立挂载 POST /api/invitations，与 API.md 一致）----

module.exports = router;
