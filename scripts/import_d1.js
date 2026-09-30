// D1 → MySQL 全量导入（一次性迁移脚本，幂等）
// 用法：IMPORT_JSON=/tmp/d1_export.json npm run import-dump
// 规则：
// - 只导入白名单正式表，跳过 *_backup* 和 D1 内部表（_cf_KV）
// - 按主键幂等：已存在的行跳过（bulkCreate ignoreDuplicates），可重复执行
// - 导入后校验：各表行数 + 审计链 verifyChain()
// - 实际 d1_export.json 不要提交到 Git（默认读 /tmp 路径）
const fs = require("fs");

const WHITE_LIST = [
  "classes", "members", "entries", "approvals", "attachments", "stock_moves",
  "duty_groups", "duty_shifts", "login_codes", "auth_throttle", "audit_log",
];

const MODEL_BY_TABLE = {
  classes: "Class", members: "Member", entries: "Entry", approvals: "Approval",
  attachments: "Attachment", stock_moves: "StockMove", duty_groups: "DutyGroup",
  duty_shifts: "DutyShift", login_codes: "LoginCode", auth_throttle: "AuthThrottle",
  audit_log: "AuditLog",
};

function bool(v) {
  if (v === null || v === undefined) return null;
  return v ? 1 : 0;
}

function normalizeRow(table, row) {
  const r = { ...row };
  if (table === "members") r.is_owner = bool(r.is_owner);
  return r;
}

async function runImport({ jsonPath } = {}) {
  const file = jsonPath || process.env.IMPORT_JSON || "/tmp/d1_export.json";
  if (!fs.existsSync(file)) {
    throw new Error(`导出文件不存在：${file}（先在本机执行 D1 导出脚本，再把 d1_export.json 传到容器）`);
  }
  const dump = JSON.parse(fs.readFileSync(file, "utf8"));
  const data = dump.data || {};
  const db = require("../db");
  const report = { inserted: {}, skipped: {} };
  for (const table of WHITE_LIST) {
    const Model = db[MODEL_BY_TABLE[table]];
    const rows = (data[table] || []).map((r) => normalizeRow(table, r));
    let inserted = 0;
    if (rows.length) {
      await Model.bulkCreate(rows, { ignoreDuplicates: true, validate: false });
      inserted = await Model.count();
    }
    report.inserted[table] = inserted;
    report.skipped[table] = 0;
    console.log(`  ${table}: 共 ${rows.length} 行，当前表内 ${inserted} 行`);
  }
  // 校验：行数（幂等：实际 >= 导出数）
  for (const table of WHITE_LIST) {
    const want = (data[table] || []).length;
    const got = await db[MODEL_BY_TABLE[table]].count();
    if (got < want) throw new Error(`校验失败：${table} 期望 ${want} 行，实际 ${got} 行`);
  }
  console.log("✅ 行数校验通过");
  return report;
}

async function verifyAuditChain() {
  const { verifyChain } = require("../lib/audit");
  const r = await verifyChain();
  console.log(r.ok
    ? `✅ 审计链校验通过：${r.length} 条，head=${String(r.head).slice(0, 12)}…`
    : `❌ 审计链校验失败：${r.reason}`);
  return r;
}

if (require.main === module) {
  const args = process.argv.slice(2);
  const jsonIdx = args.indexOf("--json");
  const jsonPath = jsonIdx >= 0 ? args[jsonIdx + 1] : undefined;
  (async () => {
    const { initDB } = require("../db");
    await initDB();
    console.log("开始导入 D1 导出数据…");
    await runImport({ jsonPath });
    const r = await verifyAuditChain();
    process.exit(r.ok ? 0 : 2);
  })().catch((e) => { console.error("❌ 导入失败：", e.message); process.exit(1); });
}

module.exports = { runImport, verifyAuditChain };
