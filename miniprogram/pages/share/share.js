const api = require("../../utils/api.js");
const share = require("../../utils/share.js");

Page({
  data: {
    loading: true,
    loadError: "",
    drawn: false,
    canvasW: 750,
    canvasH: 900,
  },

  onLoad() {
    this.render();
  },

  render() {
    this.setData({ loading: true, loadError: "", drawn: false });
    Promise.all([
      api.get("/api/public/summary").catch(() => null),
      api.get("/api/public/ledger", { data: { limit: 8, offset: 0 } }).catch(() => null),
    ])
      .then(([summary, ledger]) => {
        if (!summary) {
          this.setData({ loading: false, loadError: "分享卡数据加载失败，请返回重试" });
          return;
        }
        const items = (ledger && ledger.items) || [];
        const query = wx.createSelectorQuery().in(this);
        query
          .select("#shareCanvas")
          .fields({ node: true, size: true })
          .exec((res) => {
            const canvas = res && res[0] && res[0].node;
            if (!canvas) {
              this.setData({ loading: false, loadError: "画布初始化失败，请返回重试" });
              return;
            }
            share
              .drawShareCard(canvas, summary, items)
              .then((h) => {
                this.setData({ loading: false, drawn: true, canvasH: h });
                this._canvas = canvas;
              })
              .catch(() => {
                this.setData({ loading: false, loadError: "分享卡绘制失败，请返回重试" });
              });
          });
      })
      .catch(() => {
        this.setData({ loading: false, loadError: "分享卡数据加载失败，请返回重试" });
      });
  },

  /** 导出为临时图片文件 */
  exportImage() {
    return new Promise((resolve, reject) => {
      if (!this._canvas) {
        reject(new Error("画布尚未绘制完成"));
        return;
      }
      wx.canvasToTempFilePath({
        canvas: this._canvas,
        fileType: "png",
        success: (res) => resolve(res.tempFilePath),
        fail: (err) => {
          wx.showToast({ title: "图片生成失败", icon: "none" });
          reject(err);
        },
      });
    });
  },

  /** 保存到相册 */
  saveToAlbum() {
    wx.getSetting({
      success: (res) => {
        if (!res.authSetting["scope.writePhotosAlbum"]) {
          wx.authorize({
            scope: "scope.writePhotosAlbum",
            success: () => this.doSave(),
            fail: () => {
              wx.showModal({
                title: "需要相册权限",
                content: "请在设置中允许访问相册，才能保存分享卡。",
                showCancel: false,
              });
            },
          });
        } else {
          this.doSave();
        }
      },
      fail: () => this.doSave(),
    });
  },

  doSave() {
    wx.showLoading({ title: "保存中…" });
    this.exportImage()
      .then((path) =>
        new Promise((resolve, reject) => {
          wx.saveImageToPhotosAlbum({
            filePath: path,
            success: resolve,
            fail: reject,
          });
        })
      )
      .then(() => {
        wx.hideLoading();
        wx.showToast({ title: "已保存到相册", icon: "success" });
      })
      .catch(() => {
        wx.hideLoading();
        wx.showToast({ title: "保存失败，请重试", icon: "none" });
      });
  },

  /** 右上角 / 按钮分享 */
  onShareAppMessage() {
    const data = {
      title: "904班 · 班级公益账本",
      path: "/pages/index/index",
    };
    if (this._tempShareImage) data.imageUrl = this._tempShareImage;
    return data;
  },

  /** 点击"分享给好友"：先导出图片再触发分享 */
  shareToFriend() {
    wx.showLoading({ title: "准备分享…" });
    this.exportImage()
      .then((path) => {
        this._tempShareImage = path;
        wx.hideLoading();
        wx.showShareMenu({ withShareTicket: false });
        wx.showToast({ title: "请点击右上角分享", icon: "none", duration: 2000 });
      })
      .catch(() => wx.hideLoading());
  },
});
