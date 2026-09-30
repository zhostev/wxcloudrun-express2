const api = require("../../utils/api.js");
const util = require("../../utils/util.js");

Page({
  data: {
    id: "",
    loading: true,
    loadError: "",
    entry: null,
    receiptUrls: [],
    hasHiddenReceipts: false,
    canUpload: false,
    uploading: false,
  },

  onLoad(options) {
    this.setData({ id: options.id || "" });
    this.load();
  },

  load() {
    const id = this.data.id;
    if (!id) {
      this.setData({ loading: false, loadError: "缺少账目 ID" });
      return;
    }
    this.setData({ loading: true, loadError: "" });
    const loggedIn = getApp().isLoggedIn();
    // 登录用户用内部接口（可看到内部凭证），未登录用公开接口
    const req = loggedIn
      ? api.get("/api/entries/" + id, { auth: true })
      : api.get("/api/public/entries/" + id);
    req
      .then((res) => {
        const e = res.entry || res;
        const files = e.receipt_files || [];
        const urls = files.map((f) => util.fullUrl(f.url || ("/api/public/receipts/" + f.id)));
        this.setData({
          loading: false,
          entry: {
            kindLabel: e.kind === "donation" ? "捐赠" : "支出",
            donation: e.kind === "donation",
            amountText: (e.kind === "donation" ? "+" : "−") + "¥" + util.fmtMoney(e.amount_cents),
            category: e.category || "—",
            note: e.note || "—",
            occurredOn: e.occurred_on || "—",
            donor: e.kind === "donation" ? e.donor || "匿名" : "",
            payee: e.kind === "expense" ? e.payee || "—" : "",
            activity: e.activity || "",
            handler: e.handler || "",
            status: util.statusLabel(e.status),
            publishedAt: e.published_at ? util.fmtDateTime(e.published_at) : "",
            approvals:
              e.approvals && typeof e.approvals === "object"
                ? "同意 " + (e.approvals.approve || 0) + " / 驳回 " + (e.approvals.reject || 0) + " / 需要 " + (e.approvals.required || 0)
                : "",
          },
          receiptUrls: urls,
          hasHiddenReceipts: (e.receipts || 0) > 0 && urls.length === 0,
          canUpload: loggedIn,
        });
      })
      .catch(() => {
        this.setData({ loading: false, loadError: "账目详情加载失败，可能是该条目尚未公示" });
      });
  },

  previewReceipt(e) {
    const idx = e.currentTarget.dataset.idx;
    wx.previewImage({ urls: this.data.receiptUrls, current: this.data.receiptUrls[idx] });
  },

  /** 上传凭证（登录用户） */
  uploadReceipt() {
    wx.chooseImage({
      count: 3,
      sizeType: ["compressed"],
      sourceType: ["album", "camera"],
      success: (res) => {
        this.setData({ uploading: true });
        const tasks = res.tempFilePaths.map((p) =>
          api.uploadFile({ url: "/api/entries/" + this.data.id + "/attachments", filePath: p })
        );
        Promise.all(tasks)
          .then(() => {
            wx.showToast({ title: "凭证上传成功", icon: "success" });
            this.load();
          })
          .catch(() => {})
          .finally(() => this.setData({ uploading: false }));
      },
    });
  },
});
