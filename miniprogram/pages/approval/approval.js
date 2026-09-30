const api = require("../../utils/api.js");
const util = require("../../utils/util.js");

Page({
  data: {
    tab: "pending",
    pending: [],
    done: [],
    loading: true,
    loadError: "",
    noPermission: false,
    acting: "",
  },

  onLoad() {
    const p = getApp().globalData.permissions;
    if (p && !p.approve) {
      this.setData({ loading: false, noPermission: true });
      return;
    }
    this.load();
  },

  onShow() {
    if (!this.data.noPermission) this.load();
  },

  switchTab(e) {
    this.setData({ tab: e.currentTarget.dataset.key });
  },

  load() {
    this.setData({ loading: true, loadError: "" });
    const pendingReq = api.get("/api/entries", { auth: true, data: { status: "pending" } });
    const doneReq = api.get("/api/entries", { auth: true, data: { status: "approved" } });
    return Promise.all([pendingReq.catch(() => null), doneReq.catch(() => null)])
      .then(([pendingRes, doneRes]) => {
        if (!pendingRes && !doneRes) {
          this.setData({ loading: false, loadError: "加载失败，下拉可重试" });
          return;
        }
        const map = (res) => {
          const list = Array.isArray(res) ? res : (res && res.items) || [];
          return list.map((e) => ({
            id: e.id,
            date: util.fmtDate(e.occurred_on),
            title: util.entryTitle(e),
            sub: util.entrySub(e),
            amountText: "¥" + util.fmtMoney(e.amount_cents),
            note: e.note || "",
            createdAt: e.created_at ? util.fmtDateTime(e.created_at) : "",
          }));
        };
        this.setData({ loading: false, pending: map(pendingRes), done: map(doneRes).slice(0, 30) });
      })
      .catch(() => {
        this.setData({ loading: false, loadError: "加载失败，下拉可重试" });
      });
  },

  onPullDownRefresh() {
    this.load().finally(() => wx.stopPullDownRefresh());
  },

  decide(e) {
    const { id, decision } = e.currentTarget.dataset;
    if (decision === "reject") {
      wx.showModal({
        title: "驳回",
        editable: true,
        placeholderText: "请填写驳回原因（可选）",
        success: (res) => {
          if (res.confirm) this.doDecide(id, "reject", res.content || "");
        },
      });
      return;
    }
    wx.showModal({
      title: "确认同意？",
      content: "同意后计入审批进度，集齐所需票数即公示。",
      success: (res) => {
        if (res.confirm) this.doDecide(id, "approve", "");
      },
    });
  },

  doDecide(id, decision, reason) {
    this.setData({ acting: id + decision });
    api
      .post("/api/entries/" + id + "/approvals", { decision, reason }, { auth: true })
      .then(() => {
        wx.showToast({ title: decision === "approve" ? "已同意" : "已驳回", icon: "success" });
        this.load();
      })
      .catch(() => {})
      .finally(() => this.setData({ acting: "" }));
  },

  goEntry(e) {
    wx.navigateTo({ url: "/pages/entry/entry?id=" + e.currentTarget.dataset.id });
  },
});
