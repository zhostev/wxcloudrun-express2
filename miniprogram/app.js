const config = require("./config.js");
const api = require("./utils/api.js");

App({
  globalData: {
    token: "",
    member: null,
    permissions: null,
    meLoaded: false,
  },

  onLaunch() {
    // 读缓存中的登录态
    try {
      const token = wx.getStorageSync("ledger_token") || "";
      const member = wx.getStorageSync("ledger_member") || null;
      if (token) {
        this.globalData.token = token;
        this.globalData.member = member;
      }
    } catch (e) {}

    // 后端域名未配置时给出明确提示
    if (!config.BASE_URL) {
      wx.showModal({
        title: "请先配置后端域名",
        content:
          "打开 miniprogram/config.js，把 BASE_URL 填成后端生产域名（https://904api.hoo.ink），保存后在开发者工具中重新编译。",
        showCancel: false,
        confirmText: "知道了",
      });
      return;
    }
    // 有 token 时顺带校验一次会话有效性
    if (this.globalData.token) {
      this.refreshMe(true);
    }
  },

  /** 刷新当前登录人信息与权限（silent=true 时失败不打扰） */
  refreshMe(silent) {
    return api
      .get("/api/me", { auth: true })
      .then((res) => {
        this.globalData.member = res.member;
        this.globalData.permissions = (res.member && res.member.permissions) || res.permissions || null;
        this.globalData.meLoaded = true;
        try {
          wx.setStorageSync("ledger_member", res.member);
        } catch (e) {}
        return res;
      })
      .catch((err) => {
        if (!silent) throw err;
        return null;
      });
  },

  /** 是否已登录 */
  isLoggedIn() {
    return !!this.globalData.token;
  },

  /** 退出登录并清理本地状态 */
  logout() {
    this.globalData.token = "";
    this.globalData.member = null;
    this.globalData.permissions = null;
    this.globalData.meLoaded = false;
    try {
      wx.removeStorageSync("ledger_token");
      wx.removeStorageSync("ledger_member");
    } catch (e) {}
  },
});
