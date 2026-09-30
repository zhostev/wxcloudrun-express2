// 904 班级公益账本 · 数据模型（MySQL / Sequelize）
// 表结构与原 Cloudflare D1 版 class-fund-ledger 1:1 对应，便于数据迁移。
const { Sequelize, DataTypes, QueryTypes } = require("sequelize");

// 从环境变量中读取数据库配置
const { MYSQL_USERNAME, MYSQL_PASSWORD, MYSQL_ADDRESS = "" } = process.env;
const [host, port] = MYSQL_ADDRESS.split(":");
const MYSQL_DATABASE = process.env.MYSQL_DATABASE || "nodejs_demo";

// DB_DIALECT=sqlite 时走内存库（仅本地冒烟测试用，生产永远是 mysql）
const DB_DIALECT = process.env.DB_DIALECT || "mysql";
const sequelize = DB_DIALECT === "sqlite"
  ? new Sequelize({ dialect: "sqlite", storage: process.env.SQLITE_FILE || ":memory:",
      logging: false, define: { timestamps: false, freezeTableName: true } })
  : new Sequelize(MYSQL_DATABASE, MYSQL_USERNAME, MYSQL_PASSWORD, {
      host, port: port ? Number(port) : 3306, dialect: "mysql", logging: false,
      define: { timestamps: false, freezeTableName: true },
    });

// 注意：每个字段必须用独立的属性对象（工厂函数），不能复用同一引用——
// Sequelize 在 define 时会原地修改属性对象，复用会导致同模型内的列被吞掉。
const TEXT_ID = () => ({ type: DataTypes.STRING(64), primaryKey: true });
const MS = () => ({ type: DataTypes.BIGINT, allowNull: true }); // 毫秒时间戳
const MS_REQ = () => ({ type: DataTypes.BIGINT, allowNull: false });

// 班级（通常只有一条：904班）
const Class = sequelize.define("classes", {
  id: TEXT_ID(),
  name: { type: DataTypes.STRING(64), allowNull: false },
  term: { type: DataTypes.STRING(64), allowNull: false },
  created_at: MS_REQ(),
});

// 成员（花名册）
const Member = sequelize.define("members", {
  id: TEXT_ID(),
  class_id: { type: DataTypes.STRING(64), allowNull: false },
  name: { type: DataTypes.STRING(64), allowNull: false },
  role: { type: DataTypes.STRING(16), allowNull: false }, // parent|committee|finance|auditor|teacher
  openid: { type: DataTypes.STRING(64), allowNull: true, unique: true },
  phone: { type: DataTypes.STRING(32), allowNull: true },
  is_owner: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
  created_at: MS_REQ(),
});

// 账目（捐赠 / 支出）
const Entry = sequelize.define("entries", {
  id: TEXT_ID(),
  class_id: { type: DataTypes.STRING(64), allowNull: false },
  kind: { type: DataTypes.STRING(16), allowNull: false }, // donation|expense
  amount_cents: { type: DataTypes.INTEGER, allowNull: false },
  category: { type: DataTypes.STRING(64), allowNull: false },
  note: { type: DataTypes.TEXT, allowNull: true },
  occurred_on: { type: DataTypes.STRING(16), allowNull: false }, // YYYY-MM-DD
  donor_name: { type: DataTypes.STRING(64), allowNull: true },
  donor_member_id: { type: DataTypes.STRING(64), allowNull: true },
  donor_display: { type: DataTypes.STRING(16), allowNull: true }, // named|anonymous
  payee: { type: DataTypes.STRING(64), allowNull: true },
  activity: { type: DataTypes.STRING(128), allowNull: true },
  handled_by: { type: DataTypes.STRING(64), allowNull: true },
  received_at: MS(),
  status: { type: DataTypes.STRING(16), allowNull: false }, // draft|pending|approved|rejected
  required_approvals: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
  created_by: { type: DataTypes.STRING(64), allowNull: false },
  created_at: MS_REQ(),
  published_at: MS(),
});

// 审批签名
const Approval = sequelize.define("approvals", {
  id: TEXT_ID(),
  entry_id: { type: DataTypes.STRING(64), allowNull: false },
  member_id: { type: DataTypes.STRING(64), allowNull: false },
  decision: { type: DataTypes.STRING(16), allowNull: false }, // approve|reject
  reason: { type: DataTypes.TEXT, allowNull: true },
  created_at: MS_REQ(),
});

// 凭证附件（文件本体在 R2，经后端代理读写）
const Attachment = sequelize.define("attachments", {
  id: TEXT_ID(),
  entry_id: { type: DataTypes.STRING(64), allowNull: true },
  stock_move_id: { type: DataTypes.STRING(64), allowNull: true },
  visibility: { type: DataTypes.STRING(16), allowNull: false, defaultValue: "public" }, // public|internal
  r2_key: { type: DataTypes.STRING(256), allowNull: false },
  filename: { type: DataTypes.STRING(256), allowNull: false },
  content_type: { type: DataTypes.STRING(64), allowNull: false },
  size_bytes: { type: DataTypes.INTEGER, allowNull: false },
  sha256: { type: DataTypes.STRING(64), allowNull: false },
  uploaded_by: { type: DataTypes.STRING(64), allowNull: false },
  created_at: MS_REQ(),
});

// 物资流水
const StockMove = sequelize.define("stock_moves", {
  id: TEXT_ID(),
  class_id: { type: DataTypes.STRING(64), allowNull: false },
  direction: { type: DataTypes.STRING(8), allowNull: false }, // in|out
  item_name: { type: DataTypes.STRING(64), allowNull: false },
  spec: { type: DataTypes.STRING(64), allowNull: true },
  quantity: { type: DataTypes.INTEGER, allowNull: false },
  unit: { type: DataTypes.STRING(16), allowNull: false },
  source: { type: DataTypes.STRING(16), allowNull: false }, // donation|purchase|other
  member_id: { type: DataTypes.STRING(64), allowNull: true },
  donor_display: { type: DataTypes.STRING(16), allowNull: true },
  entry_id: { type: DataTypes.STRING(64), allowNull: true },
  purpose: { type: DataTypes.STRING(128), allowNull: true },
  est_value_cents: { type: DataTypes.INTEGER, allowNull: true },
  note: { type: DataTypes.TEXT, allowNull: true },
  occurred_on: { type: DataTypes.STRING(16), allowNull: false },
  handled_by: { type: DataTypes.STRING(64), allowNull: true },
  received_at: MS(),
  created_by: { type: DataTypes.STRING(64), allowNull: false },
  created_at: MS_REQ(),
  published_at: MS_REQ(),
});

// 值日分组 / 值日排班
const DutyGroup = sequelize.define("duty_groups", {
  id: TEXT_ID(),
  class_id: { type: DataTypes.STRING(64), allowNull: false },
  group_no: { type: DataTypes.INTEGER, allowNull: false },
  leader_name: { type: DataTypes.STRING(64), allowNull: false },
  member_names: { type: DataTypes.TEXT, allowNull: false }, // JSON 数组
});
const DutyShift = sequelize.define("duty_shifts", {
  id: TEXT_ID(),
  class_id: { type: DataTypes.STRING(64), allowNull: false },
  duty_date: { type: DataTypes.STRING(16), allowNull: false },
  weekday: { type: DataTypes.STRING(8), allowNull: false },
  session: { type: DataTypes.STRING(8), allowNull: false }, // 早班|晚班
  time_range: { type: DataTypes.STRING(32), allowNull: false },
  group_no: { type: DataTypes.INTEGER, allowNull: false },
  note: { type: DataTypes.TEXT, allowNull: true },
  checked_at: MS(),
  checked_note: { type: DataTypes.TEXT, allowNull: true },
  created_at: MS_REQ(),
});

// 一次性登录码（邀请码）
const LoginCode = sequelize.define("login_codes", {
  id: TEXT_ID(),
  code_hash: { type: DataTypes.STRING(64), allowNull: false, unique: true },
  member_id: { type: DataTypes.STRING(64), allowNull: false },
  created_by: { type: DataTypes.STRING(64), allowNull: true },
  created_at: MS_REQ(),
  expires_at: MS_REQ(),
  used_at: MS(),
  fail_count: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
});

// 登录限流
const AuthThrottle = sequelize.define("auth_throttle", {
  throttle_key: { type: DataTypes.STRING(128), primaryKey: true },
  fail_count: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
  first_fail_at: MS_REQ(),
  locked_until: MS(),
});

// 审计 hash 链
const AuditLog = sequelize.define("audit_log", {
  seq: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  at: MS_REQ(),
  actor: { type: DataTypes.STRING(64), allowNull: true },
  action: { type: DataTypes.STRING(64), allowNull: false },
  entity: { type: DataTypes.STRING(32), allowNull: false },
  entity_id: { type: DataTypes.STRING(64), allowNull: false },
  payload: { type: DataTypes.TEXT, allowNull: false },
  prev_hash: { type: DataTypes.STRING(64), allowNull: false },
  hash: { type: DataTypes.STRING(64), allowNull: false },
});

// 兼容模板 demo 的计数器（保留）
const Counter = sequelize.define("Counter", {
  count: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 1 },
});

async function init() {
  await sequelize.authenticate();
  // 注意：带外键的表先建被引用的表；sequelize.sync 不保证顺序，按依赖手动排序
  for (const m of [Class, Member, Counter, Entry, Approval, Attachment,
    StockMove, DutyGroup, DutyShift, LoginCode, AuthThrottle, AuditLog]) {
    await m.sync();
  }
}
const initDB = init;

// 模板保留的计数器路由（/ /api/count /api/wx_openid）
function counterRouter() {
  const router = require("express").Router();
  const path = require("path");
  router.get("/", (req, res) => {
    const f = path.join(__dirname, "index.html");
    require("fs").existsSync(f) ? res.sendFile(f) : res.json({ ok: true, service: "class-fund-ledger" });
  });
  router.post("/api/count", async (req, res, next) => {
    try {
      const { action } = req.body || {};
      if (action === "inc") await Counter.create();
      else if (action === "clear") await Counter.destroy({ truncate: true });
      res.json({ count: await Counter.count() });
    } catch (e) { next(e); }
  });
  router.get("/api/wx_openid", (req, res) => {
    res.json({ openid: req.headers["x-wx-openid"] || null, note: "云托管可信请求头" });
  });
  return router;
}

// 裸 SQL 查询（报表类复杂查询直接复用 Worker 版 SQL，? 占位）
async function q(sql, replacements = []) {
  return sequelize.query(sql, { replacements, type: QueryTypes.SELECT });
}
async function q1(sql, replacements = []) {
  const rows = await q(sql, replacements);
  return rows[0] ?? null;
}

module.exports = {
  init, initDB, sequelize, q, q1, counterRouter,
  Class, Member, Entry, Approval, Attachment, StockMove,
  DutyGroup, DutyShift, LoginCode, AuthThrottle, AuditLog, Counter,
};
