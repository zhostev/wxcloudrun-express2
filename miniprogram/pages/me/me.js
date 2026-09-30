const api = require("../../utils/api.js");
const util = require("../../utils/util.js");

Page({
  data: {
    loggedIn: false,
    member: null,
    permissions: null,
    loginTip: "",
    // 邀请码 / 密码登录
    inviteCode: "",
    password: "",
    showCodeLogin: false,
    showPwdLogin: false,
    loggingIn: false,
  },

  onShow() {
    const app = getApp();
    const loggedIn = app.isLoggedIn();
    const withLabel = (m) => (m ? Object.assign({}, m, { roleLabel: util.roleLabel(m.role) }) : m);
    this.setData({
      loggedIn,
      member: withLabel(app.globalData.member),
      permissions: app.globalData.permissions,
      loginTip: "",
    });
    if (loggedIn && !app.globalData.meLoaded) {
      app
        .refreshMe(false)
        .then((res) => {
          if (res) this.setData({ member: withLabel(res.member), permissions: res.permissions });
        })
        .catch(() => {});
    }
  },

  /** 登录成功统一处理 */
  onLoginSuccess(res) {
    const app = getApp();
    app.globalData.token = res.token;
    app.globalData.member = res.member;
    try {
      wx.setStorageSync("ledger_token", res.token);
      wx.setStorageSync("ledger_member", res.member);
    } catch (e) {}
    app
      .refreshMe(true)
      .then((r) => {
        if (r) this.setData({ member: Object.assign({}, r.member, { roleLabel: util.roleLabel(r.member.role) }), permissions: r.permissions });
      })
      .catch(() => {});
    this.setData({
      loggedIn: true,
      member: Object.assign({}, res.member, { roleLabel: util.roleLabel(res.member.role) }),
      loggingIn: false,
      inviteCode: "",
      password: "",
      showCodeLogin: false,
      showPwdLogin: false,
    });
    wx.showToast({ title: "登录成功", icon: "success" });
  },

  /** 微信一键登录 */
  wechatLogin() {
    this.setData({ loggingIn: true, loginTip: "" });
    wx.login({
      success: (res) => {
        if (!res.code) {
          this.setData({ loggingIn: false });
          wx.showToast({ title: "获取微信登录凭证失败", icon: "none" });
          return;
        }
        api
          .post("/api/auth/wechat", { code: res.code })
          .then((r) => this.onLoginSuccess(r))
          .catch((err) => {
            this.setData({ loggingIn: false, loginTip: err.message || "微信登录失败" });
          });
      },
      fail: () => {
        this.setData({ loggingIn: false });
        wx.showToast({ title: "微信登录调用失败", icon: "none" });
      },
    });
  },

  toggleCodeLogin() {
    this.setData({ showCodeLogin: !this.data.showCodeLogin, showPwdLogin: false });
  },

  togglePwdLogin() {
    this.setData({ showPwdLogin: !this.data.showPwdLogin, showCodeLogin: false });
  },

  bindField(e) {
    this.setData({ [e.currentTarget.dataset.field]: e.detail.value });
  },

  codeLogin() {
    const code = this.data.inviteCode.trim();
    if (!code) {
      wx.showToast({ title: "请填写邀请码", icon: "none" });
      return;
    }
    this.setData({ loggingIn: true, loginTip: "" });
    // 顺手拿一个 wx.login code，让服务端有机会把 openid 绑定到该成员
    //（云托管环境下服务端优先用可信头 x-wx-openid）
    wx.login({
      success: (res) => this.doCodeLogin(code, res.code || ""),
      fail: () => this.doCodeLogin(code, ""),
    });
  },

  doCodeLogin(code, wxCode) {
    api
      .post("/api/auth/code", { code, wx_code: wxCode || undefined })
      .then((r) => this.onLoginSuccess(r))
      .catch((err) => {
        this.setData({ loggingIn: false, loginTip: err.message || "邀请码登录失败" });
      });
  },

  pwdLogin() {
    const password = this.data.password;
    if (!password) {
      wx.showToast({ title: "请填写密码", icon: "none" });
      return;
    }
    this.setData({ loggingIn: true, loginTip: "" });
    api
      .post("/api/auth/owner", { password })
      .then((r) => this.onLoginSuccess(r))
      .catch((err) => {
        this.setData({ loggingIn: false, loginTip: err.message || "密码登录失败" });
      });
  },

  goApproval() {
    wx.navigateTo({ url: "/pages/approval/approval" });
  },

  goMembers() {
    wx.navigateTo({ url: "/pages/members/members" });
  },

  logout() {
    wx.showModal({
      title: "退出登录",
      content: "确定要退出当前账号吗？",
      success: (res) => {
        if (!res.confirm) return;
        getApp().logout();
        this.setData({ loggedIn: false, member: null, permissions: null });
        wx.showToast({ title: "已退出登录", icon: "success" });
      },
    });
  },
});
