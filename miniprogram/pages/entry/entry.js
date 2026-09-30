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

  /** 内部凭证走公开 URL + access_token：image/previewImage 无法带 Authorization */
  buildReceiptUrls(files, loggedIn) {
    const token = (getApp().globalData && getApp().globalData.token) || "";
    return (files || [])
      .map((f) => {
        if (!f) return "";
        let path = f.url || (f.id ? "/api/public/receipts/" + f.id : "");
        if (!path) return "";
        if (loggedIn && token) {
          path += (path.indexOf("?") >= 0 ? "&" : "?") + "access_token=" + encodeURIComponent(token);
        }
        return util.fullUrl(path);
      })
      .filter((u) => !!u);
  },

  canRecord() {
    const gd = getApp().globalData || {};
    const perms = gd.permissions || (gd.member && gd.member.permissions) || {};
    if (perms.record) return true;
    const role = (gd.member && gd.member.role) || "";
    return ["committee", "finance", "teacher"].indexOf(role) >= 0;
  },

  load() {
    const id = this.data.id;
    if (!id) {
      this.setData({ loading: false, loadError: "缺少账目 ID" });
      return;
    }
    this.setData({ loading: true, loadError: "" });
    const loggedIn = getApp().isLoggedIn();
    // 登录用户用内部接口（可看到内部凭证），未登录用公开接口；家长等无内部权限时回退公开接口
    const apply = (res) => {
      const e = res.entry || res;
      const files = e.receipt_files || [];
      const urls = this.buildReceiptUrls(files, loggedIn);
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
        canUpload: !!(loggedIn && this.canRecord()),
      });
    };
    const fail = () => {
      this.setData({ loading: false, loadError: "账目详情加载失败，可能是该条目尚未公示" });
    };
    if (loggedIn) {
      api
        .get("/api/entries/" + id, { auth: true })
        .then(apply)
        .catch((err) => {
          if (err && (err.status === 403 || err.status === 401)) {
            return api.get("/api/public/entries/" + id).then(apply).catch(fail);
          }
          fail();
        });
    } else {
      api.get("/api/public/entries/" + id).then(apply).catch(fail);
    }
  },

  previewReceipt(e) {
    const urls = (this.data.receiptUrls || []).filter(Boolean);
    if (!urls.length) {
      wx.showToast({ title: "暂无凭证可预览", icon: "none" });
      return;
    }
    const idx = Number(e.currentTarget.dataset.idx) || 0;
    const current = urls[idx] || urls[0];
    wx.previewImage({
      urls,
      current,
      fail: (err) => {
        wx.showToast({
          title: (err && err.errMsg) ? String(err.errMsg).slice(0, 40) : "预览失败",
          icon: "none",
        });
      },
    });
  },

  /** 上传凭证（需 record 权限） */
  uploadReceipt() {
    if (this.data.uploading) return;
    if (!this.canRecord()) {
      wx.showToast({ title: "当前角色无权上传凭证", icon: "none" });
      return;
    }
    const onPicked = (paths) => {
      if (!paths || !paths.length) return;
      this.setData({ uploading: true });
      const tasks = paths.map((p) =>
        api.uploadFile({ url: "/api/entries/" + this.data.id + "/attachments", filePath: p })
      );
      Promise.all(tasks)
        .then(() => {
          wx.showToast({ title: "凭证上传成功", icon: "success" });
          this.load();
        })
        .catch(() => {})
        .finally(() => this.setData({ uploading: false }));
    };
    const onFail = (err) => {
      const msg = (err && err.errMsg) || "";
      if (/privacy|authorize|auth deny|permission/i.test(msg)) {
        wx.showToast({ title: "请在设置中允许相册/相机权限后重试", icon: "none", duration: 2500 });
      } else if (/cancel/i.test(msg)) {
        // 用户取消，静默
      } else {
        wx.showToast({ title: msg ? String(msg).slice(0, 40) : "选择图片失败", icon: "none" });
      }
    };
    if (typeof wx.chooseMedia === "function") {
      wx.chooseMedia({
        count: 3,
        mediaType: ["image"],
        sourceType: ["album", "camera"],
        sizeType: ["compressed"],
        success: (res) => {
          const paths = ((res && res.tempFiles) || []).map((f) => f.tempFilePath).filter(Boolean);
          onPicked(paths);
        },
        fail: onFail,
      });
    } else {
      wx.chooseImage({
        count: 3,
        sizeType: ["compressed"],
        sourceType: ["album", "camera"],
        success: (res) => onPicked((res && res.tempFilePaths) || []),
        fail: onFail,
      });
    }
  },
});
