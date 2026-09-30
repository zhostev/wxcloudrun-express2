// 邀请码签发（挂载路径：/api/invitations）
const express = require("express");
const { auth, requireManage } = require("../lib/auth");
const { AppError } = require("../lib/util");
const { listMembers, issueCode, ttlMinutes } = require("../lib/members");

const router = express.Router();

// 公开：查邀请码状态（给未登录用户展示"这是给谁的码"，不泄露敏感信息）
router.get("/:code", async (req, res, next) => {
  try {
    const { peekCode } = require("../lib/members");
    res.json(await peekCode(req.params.code));
  } catch (e) { next(e); }
});

router.use(auth(true));
router.use(requireManage);

router.post("/", async (req, res, next) => {
  try {
    if (!req.body?.member_id) throw new AppError(400, "invalid_body", "请求体必须带 member_id");
    const ttl = ttlMinutes(req.body.ttl_minutes ?? (req.body.days_valid !== undefined ? req.body.days_valid * 24 * 60 : undefined));
    res.status(201).json(await issueCode(req.member, req.body.member_id, ttl));
  } catch (e) { next(e); }
});

router.post("/bulk", async (req, res, next) => {
  try {
    if (!req.body || typeof req.body !== "object") throw new AppError(400, "invalid_body", "请求体必须是 JSON 对象");
    const ttl = ttlMinutes(req.body.ttl_minutes ?? (req.body.days_valid !== undefined ? req.body.days_valid * 24 * 60 : undefined));
    let ids = Array.isArray(req.body.member_ids) ? req.body.member_ids.map(String) : [];
    if (ids.length === 0 && req.body.all_inactive) {
      const roster = await listMembers(req.member.class_id);
      ids = roster.filter((m) => !m.activated && !m.is_owner).map((m) => m.id);
    }
    if (ids.length === 0) throw new AppError(400, "invalid_body", "member_ids 为空（或加 all_inactive: true）");
    if (ids.length > 100) throw new AppError(400, "too_many", "一次最多 100 人");
    const items = [], failed = [];
    for (const id of ids) {
      try { items.push(await issueCode(req.member, id, ttl)); }
      catch (e) { failed.push({ member_id: id, error: e instanceof AppError ? e.message : "签发失败" }); }
    }
    res.status(201).json({ count: items.length, items, failed });
  } catch (e) { next(e); }
});

module.exports = router;
