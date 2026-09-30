const api = require("../../utils/api.js");
const util = require("../../utils/util.js");

const TABS = [
  { key: "donation", label: "捐赠" },
  { key: "expense", label: "支出" },
  { key: "stockin", label: "物资入库" },
  { key: "stockout", label: "物资出库" },
];

Page({
  data: {
    tabs: TABS,
    tab: "donation",
    loggedIn: false,
    submitting: false,
    // 通用
    amount: "",
    category: "",
    occurredOn: util.today(),
    note: "",
    // 捐赠
    donorName: "",
    donorDisplay: "named",
    // 支出
    payee: "",
    activity: "",
    needApproval: false,
    // 物资
    itemName: "",
    spec: "",
    quantity: "",
    unit: "",
    source: "donation",
    purpose: "",
    estValue: "",
  },

  onShow() {
    const loggedIn = getApp().isLoggedIn();
    this.setData({ loggedIn });
    // 物资页可指定默认 tab
    try {
      const t = wx.getStorageSync("add_default_tab");
      if (t && TABS.some((x) => x.key === t)) {
        this.setData({ tab: t });
        wx.removeStorageSync("add_default_tab");
      }
    } catch (e) {}
    if (loggedIn && !getApp().globalData.meLoaded) {
      getApp().refreshMe(true).catch(() => {});
    }
  },

  switchTab(e) {
    this.setData({ tab: e.currentTarget.dataset.key });
  },

  bindField(e) {
    const f = e.currentTarget.dataset.field;
    this.setData({ [f]: e.detail.value });
  },

  bindDate(e) {
    this.setData({ occurredOn: e.detail.value });
  },

  setRadio(e) {
    const f = e.currentTarget.dataset.field;
    this.setData({ [f]: e.currentTarget.dataset.value });
  },

  goLogin() {
    wx.switchTab({ url: "/pages/me/me" });
  },

  validateAmount() {
    const cents = util.yuanToCents(this.data.amount);
    if (!cents) {
      wx.showToast({ title: "请填写正确的金额", icon: "none" });
      return 0;
    }
    return cents;
  },

  submit() {
    if (this.data.submitting) return;
    const tab = this.data.tab;
    if (tab === "donation") return this.submitDonation();
    if (tab === "expense") return this.submitExpense();
    if (tab === "stockin") return this.submitStockIn();
    return this.submitStockOut();
  },

  submitDonation() {
    const amountCents = this.validateAmount();
    if (!amountCents) return;
    if (!this.data.donorName.trim() && this.data.donorDisplay === "named") {
      wx.showToast({ title: "请填写捐赠人姓名（或选匿名）", icon: "none" });
      return;
    }
    this.setData({ submitting: true });
    api
      .post(
        "/api/entries",
        {
          kind: "donation",
          amount_cents: amountCents,
          category: this.data.category.trim() || "捐赠",
          occurred_on: this.data.occurredOn,
          donor_name: this.data.donorName.trim(),
          donor_display: this.data.donorDisplay,
          note: this.data.note.trim(),
        },
        { auth: true }
      )
      .then(() => {
        wx.showToast({ title: "捐赠已记录并公示", icon: "success" });
        this.resetForm();
      })
      .catch(() => {})
      .finally(() => this.setData({ submitting: false }));
  },

  submitExpense() {
    const amountCents = this.validateAmount();
    if (!amountCents) return;
    if (!this.data.payee.trim()) {
      wx.showToast({ title: "请填写收款方", icon: "none" });
      return;
    }
    this.setData({ submitting: true });
    api
      .post(
        "/api/entries",
        {
          kind: "expense",
          amount_cents: amountCents,
          category: this.data.category.trim() || "支出",
          occurred_on: this.data.occurredOn,
          payee: this.data.payee.trim(),
          activity: this.data.activity.trim(),
          needs_approval: !!this.data.needApproval,
          note: this.data.note.trim(),
        },
        { auth: true }
      )
      .then(() => {
        wx.showToast({
          title: this.data.needApproval ? "已提交，待审批公示" : "支出已记录并公示",
          icon: "success",
        });
        this.resetForm();
      })
      .catch(() => {})
      .finally(() => this.setData({ submitting: false }));
  },

  submitStockIn() {
    const qty = parseFloat(this.data.quantity);
    if (!this.data.itemName.trim()) {
      wx.showToast({ title: "请填写物品名称", icon: "none" });
      return;
    }
    if (!isFinite(qty) || qty <= 0) {
      wx.showToast({ title: "请填写正确的数量", icon: "none" });
      return;
    }
    if (!this.data.unit.trim()) {
      wx.showToast({ title: "请填写单位（如：个/箱）", icon: "none" });
      return;
    }
    this.setData({ submitting: true });
    api
      .post(
        "/api/stock/in",
        {
          item_name: this.data.itemName.trim(),
          spec: this.data.spec.trim(),
          quantity: qty,
          unit: this.data.unit.trim(),
          source: this.data.source,
          donor_display: this.data.donorDisplay,
          est_value_cents: util.yuanToCents(this.data.estValue),
          note: this.data.note.trim(),
          occurred_on: this.data.occurredOn,
        },
        { auth: true }
      )
      .then(() => {
        wx.showToast({ title: "入库已记录", icon: "success" });
        this.resetForm();
      })
      .catch(() => {})
      .finally(() => this.setData({ submitting: false }));
  },

  submitStockOut() {
    const qty = parseFloat(this.data.quantity);
    if (!this.data.itemName.trim()) {
      wx.showToast({ title: "请填写物品名称", icon: "none" });
      return;
    }
    if (!isFinite(qty) || qty <= 0) {
      wx.showToast({ title: "请填写正确的数量", icon: "none" });
      return;
    }
    if (!this.data.purpose.trim()) {
      wx.showToast({ title: "请填写用途", icon: "none" });
      return;
    }
    this.setData({ submitting: true });
    api
      .post(
        "/api/stock/out",
        {
          item_name: this.data.itemName.trim(),
          spec: this.data.spec.trim(),
          quantity: qty,
          unit: this.data.unit.trim(),
          purpose: this.data.purpose.trim(),
          note: this.data.note.trim(),
          occurred_on: this.data.occurredOn,
        },
        { auth: true }
      )
      .then(() => {
        wx.showToast({ title: "出库已记录", icon: "success" });
        this.resetForm();
      })
      .catch(() => {})
      .finally(() => this.setData({ submitting: false }));
  },

  resetForm() {
    this.setData({
      amount: "",
      category: "",
      note: "",
      donorName: "",
      payee: "",
      activity: "",
      needApproval: false,
      itemName: "",
      spec: "",
      quantity: "",
      unit: "",
      purpose: "",
      estValue: "",
      occurredOn: util.today(),
    });
  },
});
