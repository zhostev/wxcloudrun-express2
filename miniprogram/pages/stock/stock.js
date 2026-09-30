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
        const items = ((res && res.items) || []).map((s) => ({
          id: s.id,
          in: s.direction === "in",
          name: s.item_name + (s.spec ? "（" + s.spec + "）" : ""),
          qty: s.quantity + (s.unit || ""),
          date: util.fmtDate(s.occurred_on),
          meta:
            s.direction === "in"
              ? "来源：" + ({ donation: "捐赠", purchase: "采购", other: "其他" }[s.source] || s.source || "—") +
                (s.donor ? " · " + s.donor : "")
              : "用途：" + (s.purpose || "—"),
          value: s.est_value_cents ? "估值 ¥" + util.fmtMoney(s.est_value_cents) : "",
          note: s.note || "",
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
