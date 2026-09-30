/**
 * 分享卡绘制（Canvas 2D）
 * 风格：顶部蓝渐变 hero + 三个数字 + 收支明细（含捐赠人/收款人副行）
 *
 * 计数规则：
 * - 「已公示 N 笔」的 N = summary.donation_count + summary.expense_count（仅已公示资金账）
 * - 本图最多列出 MAX_ROWS 笔；若 N > 列出数，尾注补「本图列出最近 K 笔」
 *   （避免只画 8 行却写 14 笔、看不出还有未列出的记录）
 */
const util = require("./util.js");

const W = 750; // 逻辑宽度
const SCALE = 2; // 2x 清晰度
const MAX_ROWS = 20; // 足够覆盖当前学期全量公示；再多则截断并注明
const HERO_H = 268;
const ROW_H = 70; // 主行 + 副行
const PAD_X = 40;

function rr(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function ellipsis(ctx, text, maxWidth) {
  text = String(text || "");
  if (ctx.measureText(text).width <= maxWidth) return text;
  let out = "";
  for (const ch of text) {
    if (ctx.measureText(out + ch + "…").width > maxWidth) break;
    out += ch;
  }
  return out + "…";
}

function money(v) {
  return "¥" + util.fmtMoney(v);
}

function publishedTotal(summary) {
  return (Number(summary && summary.donation_count) || 0) + (Number(summary && summary.expense_count) || 0);
}

/** 与 drawShareCard 高度算法一致，供页面预估 canvas 样式高度 */
function estimateCardHeight(itemCount, opts) {
  const rows = Math.max(0, Math.min(Number(itemCount) || 0, MAX_ROWS));
  const hasStock = !!(opts && opts.hasStock);
  const stockBlock = hasStock ? 56 : 0;
  // hero 外沿 + 标题区 + 列表 + 页脚
  return 24 + HERO_H + 24 + 52 + stockBlock + (rows ? rows * ROW_H : 64) + 88;
}

function ledgerTail(total, shown) {
  const t = Math.max(Math.trunc(Number(total) || 0), 0);
  const k = Math.max(Math.trunc(Number(shown) || 0), 0);
  if (t <= 0 && k <= 0) return "暂无已公示记录";
  // 优先展示真实公示总数；截断时明确本图条数，避免「写 14 只画 8」的错觉
  return "已公示 " + t + " 笔" + (t > k ? " · 本图 " + k + " 笔" : "");
}

function rowSub(e) {
  if (!e) return "";
  if (e.kind === "donation") {
    const donor = e.donor || "爱心家长";
    return donor + (e.receipts > 0 ? " · 凭证 " + e.receipts + " 张" : "");
  }
  const parts = [];
  if (e.payee) parts.push("付给 " + e.payee);
  if (e.handler) parts.push("经手 " + e.handler);
  const n = Math.max(Math.trunc(Number(e.receipts) || 0), 0);
  if (n > 0) parts.push("凭证 " + n + " 张");
  return parts.join(" · ");
}

/**
 * @param {Canvas} canvas  type="2d" 的 canvas 节点
 * @param {Object} summary /api/public/summary 返回体
 * @param {Array} items    /api/public/ledger 的 items（已公示）
 * @returns {Promise<number>} 卡片逻辑高度
 */
function drawShareCard(canvas, summary, items) {
  return new Promise((resolve) => {
    const ctx = canvas.getContext("2d");
    const total = publishedTotal(summary);
    const all = Array.isArray(items) ? items : [];
    const rows = all.slice(0, MAX_ROWS);
    const hasStock = (Number(summary && summary.stock_kinds) || 0) > 0;
    const H = estimateCardHeight(rows.length, { hasStock });

    canvas.width = W * SCALE;
    canvas.height = H * SCALE;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.scale(SCALE, SCALE);

    // 背景
    ctx.fillStyle = "#f8fafc";
    ctx.fillRect(0, 0, W, H);

    // 白底卡片区（轻微内边距感）
    ctx.fillStyle = "#ffffff";
    rr(ctx, 16, 16, W - 32, H - 32, 20);
    ctx.fill();

    // 顶部蓝渐变 hero
    const g = ctx.createLinearGradient(0, 24, W, 24 + HERO_H);
    g.addColorStop(0, "#3b82f6");
    g.addColorStop(1, "#1d4ed8");
    rr(ctx, 28, 28, W - 56, HERO_H, 22);
    ctx.fillStyle = g;
    ctx.fill();

    ctx.textBaseline = "middle";
    ctx.fillStyle = "#ffffff";
    ctx.font = "600 40px sans-serif";
    ctx.fillText("904班 · 班级公益账本", 52, 78);

    ctx.globalAlpha = 0.88;
    ctx.font = "26px sans-serif";
    const asof = (summary && summary.asof) || util.today();
    ctx.fillText("截至 " + asof + " · 班级公益透明账本", 52, 122);
    ctx.globalAlpha = 1;

    // 三个数字
    const stats = [
      ["收到捐赠", summary && summary.received_cents, "#ffffff"],
      ["累计支出", summary && summary.spent_cents, "#ffffff"],
      ["当前余额", summary && summary.balance_cents, "#fde68a"],
    ];
    const colW = (W - 56 - 48) / 3;
    stats.forEach(([label, cents, color], i) => {
      const x = 52 + i * colW;
      ctx.fillStyle = "rgba(255,255,255,0.78)";
      ctx.font = "24px sans-serif";
      ctx.fillText(label, x, 178);
      ctx.fillStyle = color;
      ctx.font = "600 36px sans-serif";
      ctx.fillText(money(cents), x, 222);
    });

    // 实物摘要（一行，避免与资金账混淆）
    let y = 28 + HERO_H + 36;
    if (hasStock) {
      const kinds = Number(summary.stock_kinds) || 0;
      const units = Number(summary.stock_units) || 0;
      ctx.fillStyle = "#64748b";
      ctx.font = "24px sans-serif";
      ctx.fillText("实物捐赠 " + kinds + " 种 · 合计 " + units + " 件（不计入上方金额）", PAD_X, y);
      y += 44;
    }

    // 明细标题 + 计数（与真实公示数 / 本图条数对齐）
    ctx.fillStyle = "#0f172a";
    ctx.font = "600 32px sans-serif";
    ctx.fillText("收支明细", PAD_X, y);

    const titleW = ctx.measureText("收支明细").width;
    const tail = ledgerTail(total, rows.length);
    ctx.fillStyle = "#64748b";
    ctx.font = "24px sans-serif";
    const tailW = ctx.measureText(tail).width;
    // 标题区较挤时允许尾注换行，避免与标题重叠
    if (PAD_X + titleW + 24 + tailW > W - PAD_X) {
      ctx.fillText(tail, PAD_X, y + 30);
      y += 30;
    } else {
      ctx.fillText(tail, W - PAD_X - tailW, y);
    }

    y += 40;
    if (!rows.length) {
      ctx.fillStyle = "#94a3b8";
      ctx.font = "28px sans-serif";
      ctx.fillText("本学期还没有已公示的收支记录", PAD_X, y + 12);
      y += 56;
    }

    rows.forEach((e, idx) => {
      const donation = e.kind === "donation";
      const rowTop = y;

      // 交替浅底提升可读性
      if (idx % 2 === 0) {
        ctx.fillStyle = "#f8fafc";
        ctx.fillRect(PAD_X - 8, rowTop - 18, W - (PAD_X - 8) * 2, ROW_H - 4);
      }

      // 日期
      ctx.fillStyle = "#94a3b8";
      ctx.font = "24px sans-serif";
      ctx.fillText(util.fmtDate(e.occurred_on), PAD_X, rowTop);

      // 主标题（分类 · 备注）
      ctx.fillStyle = "#1e293b";
      ctx.font = "600 28px sans-serif";
      const titleMax = 360;
      const title = ellipsis(ctx, util.entryTitle(e), titleMax);
      ctx.fillText(title, 138, rowTop);

      // 金额
      const amt = (donation ? "+" : "−") + money(e.amount_cents);
      ctx.fillStyle = donation ? "#059669" : "#dc2626";
      ctx.font = "600 28px sans-serif";
      ctx.fillText(amt, W - PAD_X - ctx.measureText(amt).width, rowTop);

      // 副行：捐赠人 / 收款人（否则多笔「自愿捐赠」难以区分，易被看成更少笔数）
      const sub = ellipsis(ctx, rowSub(e), W - PAD_X - 138);
      ctx.fillStyle = "#64748b";
      ctx.font = "22px sans-serif";
      ctx.fillText(sub, 138, rowTop + 28);

      // 底部分隔线
      ctx.strokeStyle = "#e2e8f0";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(PAD_X, rowTop + ROW_H - 22);
      ctx.lineTo(W - PAD_X, rowTop + ROW_H - 22);
      ctx.stroke();

      y += ROW_H;
    });

    // 页脚
    ctx.fillStyle = "#94a3b8";
    ctx.font = "22px sans-serif";
    const foot = "账目定期公示 · 接受全班监督";
    ctx.fillText(foot, (W - ctx.measureText(foot).width) / 2, y + 28);

    resolve(H);
  });
}

module.exports = {
  drawShareCard,
  estimateCardHeight,
  publishedTotal,
  ledgerTail,
  MAX_ROWS,
  CARD_W: W,
  CARD_SCALE: SCALE,
};
