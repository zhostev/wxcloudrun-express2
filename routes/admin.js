// 管理员一次性操作：历史数据导入
const express = require("express");
const { auth, checkOwnerPassword } = require("../lib/auth");
const { AppError } = require("../lib/util");

const router = express.Router();

// POST /api/admin/import
// Body：d1_export.json 的完整内容（{ schema, counts, data }）
// 鉴权（二选一）：
//   1. owner token（Authorization: Bearer ...，正常情况）
//   2. 空库时可用 x-owner-password 请求头直接传班主任密码（首次建库引导；一旦有班级数据该通道自动关闭）
// 幂等：已存在的行按主键跳过，可重复执行
router.post("/import", auth(false), async (req, res, next) => {
  try {
    const { Class } = require("../db");
    const empty = (await Class.count()) === 0;
    const byToken = !!(req.member && req.member.is_owner);
    let byPassword = false;
    const pwd = req.headers["x-owner-password"];
    if (empty && pwd) {
      checkOwnerPassword(String(pwd)); // 密码错 → 403；未配置 → 500
      byPassword = true;
    }
    if (!byToken && !byPassword) {
      throw new AppError(403, "owner_only", "仅班主任可执行此操作");
    }
    const dump = req.body;
    if (!dump || typeof dump !== "object" || !dump.data) {
      throw new AppError(400, "invalid_dump", "请求体必须是 d1_export.json 的完整内容（含 data 字段）");
    }
    const { runImport, verifyAuditChain } = require("../scripts/import_d1");
    const report = await runImport({ data: dump });
    const chain = await verifyAuditChain();
    res.json({ ok: chain.ok, imported: report.inserted,
      audit: { ok: chain.ok, length: chain.length, head: chain.head } });
  } catch (e) { next(e); }
});

module.exports = router;
