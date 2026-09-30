const api = require("../../utils/api.js");
const share = require("../../utils/share.js");

Page({
  data: {
    loading: true,
    loadError: "",
    showCanvas: false,
    drawn: false,
    canvasW: 750,
    canvasH: 900,
  },

  onLoad() {
    this.render();
  },

  render() {
    this.setData({ loading: true, loadError: "", showCanvas: false, drawn: false });
    this._canvas = null;
    this._tempShareImage = "";
    this._canvasRetry = false;

    // 先取 summary 得到真实公示总数，再按总数拉齐 ledger（上限 MAX_ROWS）
    api
      .get("/api/public/summary")
      .then((summary) => {
        if (!summary) throw new Error("no summary");
        // 按 MAX_ROWS 拉齐，计数用 summary 的真实公示总数（不再写死 8）
        return api
          .get("/api/public/ledger", { data: { limit: share.MAX_ROWS, offset: 0 } })
          .catch(() => ({ items: [] }))
          .then((ledger) => ({ summary, items: (ledger && ledger.items) || [] }));
      })
      .then(({ summary, items }) => {
        const canvasH = share.estimateCardHeight(items.length, {
          hasStock: (Number(summary.stock_kinds) || 0) > 0,
        });

        // 先挂载 canvas，再在 setData 回调里取 node 绘制（避免 wx:if=drawn 时节点不存在）
        this.setData({ showCanvas: true, canvasH, loading: false }, () => {
          this.drawOnCanvas(summary, items, canvasH);
        });
      })
      .catch(() => {
        this.setData({ loading: false, loadError: "分享卡数据加载失败，请返回重试" });
      });
  },

  drawOnCanvas(summary, items, expectedH) {
    const query = wx.createSelectorQuery().in(this);
    query
      .select("#shareCanvas")
      .fields({ node: true, size: true })
      .exec((res) => {
        const canvas = res && res[0] && res[0].node;
        if (!canvas) {
          // 个别机型首帧尚未就绪，下一帧再试一次
          if (!this._canvasRetry) {
            this._canvasRetry = true;
            setTimeout(() => this.drawOnCanvas(summary, items, expectedH), 50);
            return;
          }
          this.setData({ loadError: "画布初始化失败，请返回重试", showCanvas: false });
          return;
        }
        this._canvasRetry = false;
        share
          .drawShareCard(canvas, summary, items)
          .then((h) => {
            this._canvas = canvas;
            // 高度与预估一致时不再改 style，避免部分基础库改尺寸后清空像素
            const patch = { drawn: true };
            if (h && h !== expectedH) patch.canvasH = h;
            this.setData(patch, () => {
              this.prepareShareImage();
            });
          })
          .catch(() => {
            this.setData({ loadError: "分享卡绘制失败，请返回重试", showCanvas: false, drawn: false });
          });
      });
  },

  /** 预生成分享缩略图，供 open-type=share / 右上角菜单使用 */
  prepareShareImage() {
    this.exportImage()
      .then((path) => {
        this._tempShareImage = path;
      })
      .catch(() => {});
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
        fail: (err) => reject(err),
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
                confirmText: "去设置",
                success: (r) => {
                  if (r.confirm) wx.openSetting({});
                },
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
      .then(
        (path) =>
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
      .catch((err) => {
        wx.hideLoading();
        const msg = (err && (err.errMsg || err.message)) || "";
        if (/auth deny|authorize|permission/i.test(msg)) {
          wx.showModal({
            title: "需要相册权限",
            content: "请在设置中允许访问相册，才能保存分享卡。",
            confirmText: "去设置",
            success: (r) => {
              if (r.confirm) wx.openSetting({});
            },
          });
          return;
        }
        wx.showToast({ title: "保存失败，请重试", icon: "none" });
      });
  },

  /** 右上角菜单 / 「分享给好友」按钮 */
  onShareAppMessage() {
    const data = {
      title: "904班 · 班级公益账本",
      path: "/pages/index/index",
    };
    if (this._tempShareImage) data.imageUrl = this._tempShareImage;
    return data;
  },
});
