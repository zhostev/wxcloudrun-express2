// 分享卡数据模型（与 Worker 版 buildShareCard 一致）。小程序用 canvas 在本地渲染。
const { yuan } = require("./util");

const MAX_ROWS = 12;
const MAX_STOCK = 6;

function asofDate(now = Date.now()) {
  return new Date(now + 8 * 36e5).toISOString().slice(0, 10);
}
function pendingNote(pendingCount) {
  const n = Math.max(Math.trunc(Number(pendingCount) || 0), 0);
  return n > 0 ? `另有 ${n} 笔待审批，审批通过后才会公示` : null;
}
function statsLegend(receivedCents, spentCents, balanceCents) {
  const received = Math.max(Math.trunc(Number(receivedCents) || 0), 0);
  const spent = Math.max(Math.trunc(Number(spentCents) || 0), 0);
  if (received === 0) return "尚无收到捐赠";
  if (spent === 0) return `尚未发生支出 · 收到的 ${yuan(received)} 全额在账上`;
  return `已支出 ${yuan(spent)}（${Math.round(spent / received * 100)}%） · 结余 ${yuan(balanceCents)}`;
}
function stockSection(s, moves = []) {
  const kinds = Math.max(Math.trunc(Number(s.stock_kinds) || 0), 0);
  const units = Math.max(Math.trunc(Number(s.stock_units) || 0), 0);
  const items = s.stock_items ?? [];
  if (kinds <= 0) {
    return {
      empty: true, headline: "暂无实物", lines: [], more: null,
      note: "收到实物后会在这里逐样列出 · 实物不计入上方金额",
    };
  }
  return {
    empty: false,
    headline: `${kinds} 种 · 合计 ${units} 件`,
    lines: items.slice(0, MAX_STOCK).map((i) => {
      const donation = moves.find(
        (m) => m.direction === "in" && m.source === "donation" && m.item_name === i.name && m.unit === i.unit);
      return `${i.name} · ${i.quantity} ${i.unit}${donation ? ` · ${donation.donor ?? "爱心家长"}` : ""}`;
    }),
    more: items.length > MAX_STOCK ? `另有 ${items.length - MAX_STOCK} 种未列出` : null,
    note: "不计入上方金额 · 实物与资金是两本账",
  };
}
function rowSub(e) {
  const parts = [];
  parts.push(e.kind === "donation" ? e.donor || "爱心家长" : `付给 ${e.payee || "—"}`);
  if (e.handler) parts.push(`经手 ${e.handler}`);
  const n = Math.max(Math.trunc(Number(e.receipts) || 0), 0);
  if (n > 0) parts.push(`凭证 ${n} 张`);
  return parts.join(" · ");
}
function ledgerTail(total, shown) {
  const t = Math.max(Math.trunc(Number(total) || 0), 0);
  const k = Math.max(Math.trunc(Number(shown) || 0), 0);
  return `已公示 ${t} 笔` + (t > k ? `，本图列出最近 ${k} 笔` : "");
}
function isPublished(e) {
  return e.status === "approved" && e.published_at != null;
}
function toShareRow(e) {
  const donation = e.kind === "donation";
  const main = e.category || (donation ? "捐赠" : "支出");
  return {
    date: (e.occurred_on || "").slice(5).replace(/-/g, "/"),
    main: e.note ? `${main} · ${e.note}` : main,
    amount: (donation ? "+" : "−") + yuan(e.amount_cents),
    sub: rowSub(e),
    donation,
  };
}

// stockSummary 需要 stock_items：由 listItems 拼装
function buildShareCard(cls, summary, items, stockItems = [], asof = asofDate(), stockMoves = []) {
  const rows = (items ?? []).filter(isPublished).slice(0, MAX_ROWS).map(toShareRow);
  const total = (Number(summary.donation_count) || 0) + (Number(summary.expense_count) || 0);
  const received = Math.max(Math.trunc(Number(summary.received_cents) || 0), 0);
  const spent = Math.max(Math.trunc(Number(summary.spent_cents) || 0), 0);
  return {
    width: 1080,
    filename: `class-ledger-${asof.replace(/-/g, "")}.png`,
    title: `${cls.name} · 班级公益账本`,
    sub: `${cls.term} · 截至 ${asof}`,
    pendingNote: pendingNote(summary.pending_count),
    stats: {
      receivedLabel: "收到捐赠",
      received: yuan(summary.received_cents),
      spentLabel: "累计支出",
      spent: yuan(summary.spent_cents),
      balanceLabel: "当前余额",
      balance: yuan(summary.balance_cents),
      balanceHint: "＝ 收到捐赠 − 累计支出",
      ratio: received > 0 ? Math.min(spent / received, 1) : 0,
      hasReceived: received > 0,
      legend: statsLegend(summary.received_cents, summary.spent_cents, summary.balance_cents),
    },
    stock: { label: "实物捐赠", ...stockSection({ ...summary, stock_items: stockItems }, stockMoves) },
    ledger: {
      label: "收支明细",
      tail: ledgerTail(total, rows.length),
      rows,
      emptyText: rows.length ? null : "本学期还没有已公示的收支记录",
    },
  };
}

module.exports = { buildShareCard, asofDate };
