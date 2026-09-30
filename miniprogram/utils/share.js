/**
 * 分享卡绘制（Canvas 2D）
 * 风格参考 904.s7ea.com：顶部蓝渐变 hero 卡片 + 三个数字 + 收支明细列表
 */
const util = require("./util.js");

const W = 750; // 逻辑宽度
const SCALE = 2; // 2x 清晰度

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

/**
 * @param {Canvas} canvas  type="2d" 的 canvas 节点
 * @param {Object} summary /api/public/summary 返回体
 * @param {Array} items    /api/public/ledger 的 items（取前若干条）
 * @returns {Promise<number>} 卡片逻辑高度（供调用方参考）
 */
function drawShareCard(canvas, summary, items) {
  return new Promise((resolve) => {
    const ctx = canvas.getContext("2d");
    const rows = (items || []).slice(0, 8);
    const H = 560 + rows.length * 64 + 90;
    canvas.width = W * SCALE;
    canvas.height = H * SCALE;
    ctx.scale(SCALE, SCALE);

    // 背景
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, W, H);

    // 顶部蓝渐变 hero
    const g = ctx.createLinearGradient(0, 0, W, 320);
    g.addColorStop(0, "#3b82f6");
    g.addColorStop(1, "#1d4ed8");
    rr(ctx, 24, 24, W - 48, 300, 28);
    ctx.fillStyle = g;
    ctx.fill();

    ctx.fillStyle = "#ffffff";
    ctx.textBaseline = "middle";
    ctx.font = "600 44px sans-serif";
    ctx.fillText("904班 · 班级公益账本", 56, 100);
    ctx.globalAlpha = 0.85;
    ctx.font = "28px sans-serif";
    ctx.fillText("截至 " + (summary.asof || util.today()) + " · 班级公益透明账本", 56, 152);
    ctx.globalAlpha = 1;

    // 三个数字
    const stats = [
      ["收到捐赠", summary.received_cents, "#ffffff"],
      ["累计支出", summary.spent_cents, "#ffffff"],
      ["当前余额", summary.balance_cents, "#fde68a"],
    ];
    stats.forEach(([label, cents, color], i) => {
      const x = 56 + i * 224;
      ctx.fillStyle = "rgba(255,255,255,.75)";
      ctx.font = "26px sans-serif";
      ctx.fillText(label, x, 218);
      ctx.fillStyle = color;
      ctx.font = "600 40px sans-serif";
      ctx.fillText(money(cents), x, 262);
    });

    // 明细标题
    let y = 380;
    ctx.fillStyle = "#111827";
    ctx.font = "600 34px sans-serif";
    ctx.fillText("收支明细", 40, y);
    ctx.fillStyle = "#9ca3af";
    ctx.font = "26px sans-serif";
    const total = (Number(summary.donation_count) || 0) + (Number(summary.expense_count) || 0);
    ctx.fillText("已公示 " + total + " 笔", W - 40 - ctx.measureText("已公示 " + total + " 笔").width, y);

    y += 44;
    if (!rows.length) {
      ctx.fillStyle = "#9ca3af";
      ctx.font = "28px sans-serif";
      ctx.fillText("本学期还没有已公示的收支记录", 40, y + 20);
      y += 64;
    }
    rows.forEach((e) => {
      const donation = e.kind === "donation";
      // 日期
      ctx.fillStyle = "#9ca3af";
      ctx.font = "26px sans-serif";
      ctx.fillText(util.fmtDate(e.occurred_on), 40, y);
      // 标题
      ctx.fillStyle = "#1f2937";
      ctx.font = "30px sans-serif";
      const title = ellipsis(ctx, util.entryTitle(e), 380);
      ctx.fillText(title, 150, y);
      // 金额
      const amt = (donation ? "+" : "−") + money(e.amount_cents);
      ctx.fillStyle = donation ? "#059669" : "#dc2626";
      ctx.font = "600 30px sans-serif";
      ctx.fillText(amt, W - 40 - ctx.measureText(amt).width, y);
      // 分隔线
      ctx.strokeStyle = "#f3f4f6";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(40, y + 32);
      ctx.lineTo(W - 40, y + 32);
      ctx.stroke();
      y += 64;
    });

    // 页脚
    ctx.fillStyle = "#9ca3af";
    ctx.font = "24px sans-serif";
    const foot = "账目定期公示 · 接受全班监督";
    ctx.fillText(foot, (W - ctx.measureText(foot).width) / 2, y + 40);

    resolve(H);
  });
}

module.exports = { drawShareCard, CARD_W: W, CARD_SCALE: SCALE };
