# 904 班级账本 · API 契约（后端 Express / 小程序）

BASE_URL：微信云托管服务域名（小程序 `miniprogram/config.js` 里配置，末尾不带斜杠）。
登录后请求在 Header 带 `Authorization: Bearer <token>`。
错误统一：`{ error: "<code>", message: "<中文>" }`。

角色：`parent` 家长 / `committee` 家委会 / `finance` 财务 / `auditor` 审核 / `teacher` 班主任。

权限（`GET /api/me` 返回的 `member.permissions`）：
- manage：is_owner 或 role ∈ committee/finance（成员管理、邀请码、值日管理）
- view_internal：role ∈ committee/finance/auditor/teacher（内部凭证、未公示账目）
- approve：role ∈ committee/finance/auditor（审批）
- record：role ∈ committee/finance/teacher（记账、物资出入库）

金额：`amount_cents` 为整数"分"；`amount` 为格式化字符串如 `"1,450.00"`。
时间：`created_at/published_at/received_at/expires_at` 为毫秒时间戳；`occurred_on` 为 `YYYY-MM-DD`。

## 公开（无需登录）

### GET /api/public/classes → `{ classes: [{ id, name, term, created_at }] }`
### GET /api/public/app?class_id= → `{ class_id, name, term, app_name }`
未传 class_id 时用 `DEFAULT_CLASS_ID` 环境变量，否则取数据库第一条班级。

### GET /api/public/summary?class_id=
`{ class_id, received_cents, spent_cents, balance_cents, received, spent, balance, donation_count, expense_count, pending_count, stock_kinds, stock_units }`
`received/spent/balance` 为格式化金额字符串（如 `"1,450.00"`）。

### GET /api/public/ledger?class_id=&limit=20&offset=0
`{ class_id, count, items: [entryView] }`（只含已公示）。
```
entryView = { id, kind: "donation"|"expense", amount_cents, amount, category, note,
  occurred_on, status: "approved", published_at, created_at,
  approvals: { approve, reject, required }, receipts: <凭证数>,
  receipt_files?: [{ id, filename, content_type, size_bytes, sha256, url }],
  handler?: "某某（家委会）",
  // donation: donor: "张三家长"|"爱心家长", donor_display: "named"|"anonymous", received_at?
  // expense: payee, activity? }
```
`receipts > 0` 但无 `receipt_files` 表示有凭证但无权查看。

### GET /api/public/stock?class_id=&limit=50&offset=0
`{ class_id, kinds, units_total, items: [库存汇总], moves: [物资流水] }`。
- items：`{ item_name, unit, total_in, total_out, balance }`
- moves：stockView（`{ id, direction: "in"|"out", item_name, spec, quantity, unit, source: "donation"|"purchase"|"other", donor?, purpose?, est_value_cents?, note, occurred_on, created_at, receipts, receipt_files? }`）

### GET /api/public/entries/:id
单条已公示账目详情（entryView + receipt_files）。未公示 → 404 `{error:"not_published"}`。

### GET /api/public/receipts/:id
公开凭证文件二进制（仅 visibility=public 的）。无权/不存在 → JSON 错误。

### GET /api/public/share-card?class_id=
分享卡数据（小程序 Canvas 绘制用）：`{ width, filename, title, sub, stats, pendingNote, ledger_preview }`。

### GET /health → `{ ok: true, service, ts }`

## 登录

### POST /api/auth/wechat `{ code }`
小程序 `wx.login()` 拿 code 换会话。openid 来源优先级：
1. 云托管可信头 `x-wx-openid`（需服务端设置 `TRUST_WX_HEADERS=1`）
2. `jscode2session`（需 `WECHAT_APPID` / `WECHAT_SECRET`）

成功 `{ token, expires_at, member }`；该微信未绑定成员 → 403 `{error:"not_bound"}`（不返回 openid）。

### POST /api/auth/code `{ code, phone?, wx_code? }`
家委会发放的一次性邀请码登录（一次性，核销后失效）。首次登录时如带 `wx_code`
（或云托管可信头），自动把微信 openid 绑定到该成员 → 下次可微信一键登录。
成功 `{ token, expires_at, member }`；无效/过期/已用 → 401。

### POST /api/auth/owner `{ password }`
维护者密码登录（`OWNER_PASSWORD` 环境变量，备用通道）。成功同上。

### GET /api/auth/me 与 GET /api/me（需登录）
`{ member }`，member 含 `permissions`。未登录 → `{ member: null }`。

### POST /api/auth/logout → `{ ok: true }`（清 cookie）
### POST /api/auth/bind-wechat `{ code }`（需登录）
已登录成员绑定自己的微信 openid。

## 记账（需登录，record 权限）

### POST /api/entries
捐赠：`{ kind:"donation", amount_cents>0, category, occurred_on, donor_member_id?, donor_display:"named"|"anonymous", donor_unknown?, handled_by?, note? }`
支出：`{ kind:"expense", amount_cents>0, category, occurred_on, payee, activity?, needs_approval, handled_by?, note? }`

规则（与原 Worker 一致）：
- 捐赠直接 approved + 公示；经手人是自己时自动视为已收到。
- 支出 `needs_approval=false` 直接公示；`true` 进入 pending。
- 审批票数按金额自动定：支出 ≥ ¥500 需 3 票，否则 2 票（客户端传 `needs_approval` 即可，不能直接定票数）。
- 审批通过条件：票数达标 **且** 至少一票来自独立审批人（finance/auditor）——防"全是自己人"通过。
- 提交人不能审批自己提交的；每人限签一次。

→ 201 返回账目对象本身（含 `status`：approved 即已公示，pending 待审批；`required_approvals` 为所需票数）。

### GET /api/entries?status=pending|approved|rejected（需登录，view_internal）
内部列表（含未公示），按 created_at 倒序。
### GET /api/entries/pending（需登录，approve 权限）
待我审批的（排除自己提交的）。
### GET /api/entries/mine（需登录，view_internal）
我提交的。
### GET /api/entries/:id（需登录，view_internal）
单条内部详情。
### PATCH /api/entries/:id（创建人或 manage）
更新未终态条目：`{ category?, note?, amount_cents?, occurred_on?, payee?, activity? }`。
### POST /api/entries/:id/approvals（approve 权限）
`{ decision: "approve"|"reject", reason? }`。票数达标且有独立审批人 → 公示；
1 个 reject 即 rejected。→ `{ id, status, published, approvals }`。
（兼容别名：`POST /:id/approve`、`POST /:id/reject`。）
### POST /api/entries/:id/receipt（需登录）
捐赠经手人本人确认收到。→ `{ id, received_at, confirmed_by }`
### POST /api/entries/:id/attachments（需登录，multipart，字段 file）
上传凭证：≤8MB，png/jpeg/webp/gif/pdf。→ 201 `{ id, filename, size_bytes, sha256, visibility }`
### GET /api/entries/:id/attachments（需登录，view_internal）
凭证元数据列表。
### GET /api/receipts/:id（需登录，view_internal）
内部凭证文件二进制。

## 物资（需登录 record；公开页只读）

### GET /api/stock（需登录，view_internal）
内部物资流水列表。
### POST /api/stock/in
`{ item_name, spec?, quantity>0, unit, source:"donation"|"purchase"|"other", donor_display?, member_id?, donor_unknown?, entry_id?, est_value_cents?, handled_by?, note?, occurred_on }`
- source=donation：实物捐赠，需声明 donor_display；实名公示只能由捐赠人本人操作。
- source=purchase：必须关联一笔支出 `entry_id`。
### POST /api/stock/out `{ item_name, quantity>0, unit, purpose, handled_by?, note?, occurred_on }`
出库不允许超发（数量 > 结余时 400 `insufficient_stock`）。
### PATCH /api/stock/:id（manage）`{ note?, spec? }`
### POST /api/stock/:id/receipt（需登录）
入库经手人本人确认收到。→ `{ id, received_at, confirmed_by }`
### POST /api/stock/:id/attachments / GET /api/stock/:id/attachments
同账目凭证（字段 file，≤8MB）。

## 成员管理（需登录 + manage）

### GET /api/members → `{ class_id, count, items: [member], has_independent_approver }`
member = `{ id, name, phone, role, is_owner, activated, openid_bound, created_at }`
### POST /api/members `{ name, phone?, role }` → 201 `{ member }`
### POST /api/members/bulk `{ members: [{name, phone?, role}] }` 或 `{ text }`（每行"姓名 电话"）
### PATCH /api/members/:id `{ name?, phone?, role? }`
roles：parent / committee / finance / auditor / teacher。

## 邀请码

### GET /api/invitations/:code（公开）
查码状态：`{ valid, used, expired, member: { name, role }, phone_required }`（不泄露敏感信息）。
### POST /api/invitations（需登录 + manage）
`{ member_id, days_valid? }` → `{ member, code, expires_at, phone_required }`（8 位一次性码）。
同一成员再次签发会**作废其先前未使用的码**并生成新码；已激活成员也可重发（换设备 / 丢码后重新登录）。
### POST /api/invitations/bulk（需登录 + manage）
`{ member_ids | all_inactive: true, days_valid? }` → `{ count, items, failed }`。

## 值日（需登录；小程序 v1 暂无页面）

- GET /api/duty → `{ groups, shifts, mine }`
- POST /api/duty/init（manage）：新班级初始化占位分组
- POST /api/duty/generate `{ week_start }`（manage）：生成一周排班（周一到周五早/晚班）
- PATCH /api/duty/shifts/:id `{ group_no?, note? }`（manage）

## 审计

### GET /api/audit/verify（需登录，view_internal）
`{ ok, length, head, coverage }`。审计链为 hash 链（sha256(prev+"\n"+canonical)，与原 Worker 算法一致）；
coverage 含 entries/entry_events、approvals/approval_events、receipts/receipt_events 对账。

## 管理（仅 owner）

### POST /api/admin/import
一次性历史数据导入。Body 为 `d1_export.json` 的完整内容（`{ schema, counts, data }`，约 77KB）。
鉴权二选一：owner token；或**空库时**用 `x-owner-password` 请求头传班主任密码（首次建库引导，库中有班级后该通道自动关闭）。
幂等（按主键跳过已存在行），导入后自动校验审计链。
返回 `{ ok, imported: {表名: 行数}, audit: { ok, length, head } }`。
