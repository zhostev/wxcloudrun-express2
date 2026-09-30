const api = require("../../utils/api.js");
const util = require("../../utils/util.js");

const PAGE_SIZE = 20;

Page({
  data: {
    items: [],
    offset: 0,
    total: 0,
    loading: true,
    loadingMore: false,
    loadError: "",
    noMore: false,
  },

  onLoad() {
    this.load(true);
  },

  onShow() {
    // 从详情页返回时刷新（状态可能变化）
    if (this.data.items.length) this.load(true);
  },

  onPullDownRefresh() {
    this.load(true).finally(() => wx.stopPullDownRefresh());
  },

  onReachBottom() {
    if (!this.data.noMore && !this.data.loadingMore) this.load(false);
  },

  load(reset) {
    if (reset) {
      this.setData({ loading: true, loadError: "", offset: 0, noMore: false });
    } else {
      this.setData({ loadingMore: true });
    }
    const offset = reset ? 0 : this.data.offset;
    return api
      .get("/api/public/ledger", { data: { limit: PAGE_SIZE, offset } })
      .then((res) => {
        const raw = (res && res.items) || [];
        const mapped = raw.map((e) => ({
          id: e.id,
          date: util.fmtDate(e.occurred_on),
          title: util.entryTitle(e),
          sub: util.entrySub(e),
          amountText: (e.kind === "donation" ? "+" : "−") + "¥" + util.fmtMoney(e.amount_cents),
          donation: e.kind === "donation",
          hasReceipt: (e.receipts || 0) > 0,
        }));
        const items = reset ? mapped : this.data.items.concat(mapped);
        const total = (res && res.count) || 0;
        this.setData({
          items,
          total,
          offset: offset + mapped.length,
          loading: false,
          loadingMore: false,
          noMore: mapped.length < PAGE_SIZE || items.length >= total,
        });
      })
      .catch(() => {
        this.setData({
          loading: false,
          loadingMore: false,
          loadError: reset && this.data.items.length === 0 ? "明细加载失败，下拉可重试" : "",
        });
      });
  },

  goEntry(e) {
    wx.navigateTo({ url: "/pages/entry/entry?id=" + e.currentTarget.dataset.id });
  },
});
