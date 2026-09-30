# 904 班级公益账本（微信云托管版）

原 Cloudflare Worker 版 `904.s7ea.com` 的完整迁移：公开台账公示 + 记账、审批、
成员管理、物资出入库、值日排班、凭证附件、hash 审计链，全部搬进微信小程序。

- 后端：本仓库根目录（Express + MySQL + R2），push 到 `master` 自动触发微信云托管部署
- 小程序：`miniprogram/`（原生微信小程序，AppID `wx2861b42fc732bdf4`）
- API 契约：`API.md`

## 环境变量（云托管 → 服务设置 → 环境变量）

| 变量 | 说明 |
|---|---|
| `MYSQL_ADDRESS` / `MYSQL_USERNAME` / `MYSQL_PASSWORD` / `MYSQL_DATABASE` | 云托管 MySQL（模板默认已注入） |
| `SESSION_SECRET` | 会话签名密钥（必须设置，随机字符串） |
| `OWNER_PASSWORD` | 维护者密码登录（备用通道，建议设置） |
| `TRUST_WX_HEADERS` | 设为 `1`：信任云托管注入的 `x-wx-openid`，免 AppSecret 登录 |
| `WECHAT_APPID` / `WECHAT_SECRET` | 非云托管环境时的 `jscode2session` 回退（云托管可不设） |
| `DEFAULT_CLASS_ID` | 默认班级 id（未设置时取数据库第一条） |
| `PUBLIC_APP_NAME` | 公开页应用名（默认用班级名） |
| `R2_ACCOUNT_ID` / `R2_ACCESS_KEY_ID` / `R2_SECRET_ACCESS_KEY` | Cloudflare R2 凭证（凭证附件用） |
| `R2_BUCKET` | `class-fund-receipts`（沿用原 bucket，无需迁移文件） |
| `IMPORT_JSON` | 历史数据导入时指定导出文件路径（见下） |

## 历史数据迁移（D1 → MySQL，一次性）

1. 在本机执行原仓库的 `export_d1.py`，得到 `d1_export.json`（**不要提交到 Git**）。
2. 把文件传到云托管容器可读路径（如通过云托管控制台文件/构建参数，或先传到一台中转机）。
3. 在容器内执行一次：
   ```bash
   IMPORT_JSON=/tmp/d1_export.json npm run import-dump
   ```
   脚本幂等（按主键去重，可重复执行），导入后自动校验各表行数 + 审计链。
   只有白名单正式表会被导入，`*_backup*` 和 `_cf_KV` 自动跳过。

注意：`IMPORT_ON_BOOT` 默认关闭，服务启动不会自动导入，避免重复。

## 小程序

1. 微信开发者工具导入 `miniprogram/` 目录。
2. `miniprogram/config.js` 的 `BASE_URL` 已默认为生产域名 `https://904api.hoo.ink`（末尾不带斜杠）。
   小程序必须通过该域名调后端，云托管才会注入可信的 `x-wx-openid`。
   正式上线前需完成：①云托管控制台绑定自定义域名 `904api.hoo.ink`；②在 hoo.ink 的 DNS 处加 CNAME 指向云托管给的目标；
   ③微信公众平台 → 小程序 → 服务器域名白名单加 `https://904api.hoo.ink`（request + uploadFile）。
3. tabBar：首页 / 明细 / 物资 / 记账 / 我的；审批、成员管理、分享卡在"我的"和首页入口。

登录方式：微信一键登录（已绑定成员）/ 8 位一次性邀请码（家委会发放，首次登录自动绑定微信）/
维护者密码（备用）。

## 本地调试

```bash
npm install
# 用 sqlite 内存库冒烟（无需 MySQL）：
DB_DIALECT=sqlite SESSION_SECRET=dev-secret node index.js
# 跑业务冒烟测试见 /tmp/smoke（已验证：记账/审批/物资/审计链/登录闭环）
```
