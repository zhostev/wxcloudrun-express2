const api = require("../../utils/api.js");
const util = require("../../utils/util.js");

const PAGE_SIZE = 50;

Page({
  data: {
    items: [],
    loading: true,
    loadError: "",
    loggedIn: false,
  },

  onLoad() {
    this.load();
  },

  onShow() {
    this.setData({ loggedIn: getApp().isLoggedIn() });
    if (this.data.items.length) this.load();
  },

  onPullDownRefresh() {
    this.load().finally(() => wx.stopPullDownRefresh());
  },

  load() {
    this.setData({ loading: true, loadError: "" });
    return api
      .get("/api/public/stock", { data: { limit: PAGE_SIZE, offset: 0 } })
      .then((res) => {
        // /api/public/stock 返回按物品聚合的结余：{ item_name, unit, total_in, total_out, balance }
        const items = ((res && res.items) || []).map((s) => ({
          id: s.item_name + "|" + (s.unit || ""),
          name: s.item_name,
          unit: s.unit || "",
          balance: s.balance,
          totalIn: s.total_in,
          totalOut: s.total_out,
        }));
        this.setData({ items, loading: false });
      })
      .catch(() => {
        this.setData({ loading: false, loadError: "物资台账加载失败，下拉可重试" });
      });
  },

  goAddIn() {
    wx.switchTab({ url: "/pages/add/add" });
    // 通过 storage 告诉记账页默认切到"物资入库"
    try { wx.setStorageSync("add_default_tab", "stockin"); } catch (e) {}
  },

  goAddOut() {
    wx.switchTab({ url: "/pages/add/add" });
    try { wx.setStorageSync("add_default_tab", "stockout"); } catch (e) {}
  },
});
