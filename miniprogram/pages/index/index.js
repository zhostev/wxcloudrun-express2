const api = require("../../utils/api.js");
const util = require("../../utils/util.js");

Page({
  data: {
    loading: true,
    loadError: "",
    summary: null,
    recent: [],
    canApprove: false,
    pendingCount: 0,
  },

  onLoad() {
    this.load();
  },

  onShow() {
    // 每次回到首页刷新权限与待审批数（登录态可能变化）
    const app = getApp();
    const p = app.globalData.permissions;
    this.setData({ canApprove: !!(p && p.approve) });
    if (app.isLoggedIn()) {
      app
        .refreshMe(true)
        .then((res) => {
          if (!res) return;
          const perms = (res.member && res.member.permissions) || res.permissions || {};
          this.setData({ canApprove: !!perms.approve });
          this.loadPending();
        })
        .catch(() => {});
    } else {
      this.setData({ canApprove: false, pendingCount: 0 });
    }
  },

  onPullDownRefresh() {
    this.load().finally(() => wx.stopPullDownRefresh());
  },

  load() {
    this.setData({ loading: true, loadError: "" });
    return Promise.all([
      api.get("/api/public/summary").catch(() => null),
      api.get("/api/public/ledger", { data: { limit: 10, offset: 0 } }).catch(() => null),
    ])
      .then(([summary, ledger]) => {
        if (!summary) {
          this.setData({ loading: false, loadError: "账本数据加载失败，下拉可重试" });
          return;
        }
        const items = (ledger && ledger.items) || [];
        this.setData({
          loading: false,
          summary: {
            received: util.fmtMoney(summary.received_cents),
            spent: util.fmtMoney(summary.spent_cents),
            balance: util.fmtMoney(summary.balance_cents),
            donationCount: summary.donation_count || 0,
            expenseCount: summary.expense_count || 0,
            pendingCount: summary.pending_count || 0,
          },
          recent: items.map((e) => ({
            id: e.id,
            date: util.fmtDate(e.occurred_on),
            title: util.entryTitle(e),
            sub: util.entrySub(e),
            amountText: (e.kind === "donation" ? "+" : "−") + "¥" + util.fmtMoney(e.amount_cents),
            donation: e.kind === "donation",
          })),
        });
        this.loadPending();
      })
      .catch(() => {
        this.setData({ loading: false, loadError: "账本数据加载失败，下拉可重试" });
      });
  },

  /** 有审批权限时拉取待审批数量 */
  loadPending() {
    const app = getApp();
    if (!app.isLoggedIn() || !this.data.canApprove) return;
    api
      .get("/api/entries", { auth: true, data: { status: "pending" } })
      .then((res) => {
        const list = Array.isArray(res) ? res : res.items || [];
        this.setData({ pendingCount: list.length });
      })
      .catch(() => {});
  },

  goLedger() {
    wx.switchTab({ url: "/pages/ledger/ledger" });
  },

  goEntry(e) {
    wx.navigateTo({ url: "/pages/entry/entry?id=" + e.currentTarget.dataset.id });
  },

  goApproval() {
    wx.navigateTo({ url: "/pages/approval/approval" });
  },

  goShare() {
    wx.navigateTo({ url: "/pages/share/share" });
  },

  onShareAppMessage() {
    return { title: "904班 · 班级公益账本", path: "/pages/index/index" };
  },
});
