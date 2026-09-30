/**
 * 统一网络请求封装
 * - BASE_URL 取自 config.js；未配置时给出明确提示
 * - auth=true 时自动带 Authorization: Bearer <token>
 * - 401 → 清登录态并跳到"我的"页提示登录；403 → 提示服务端返回的原因
 * - 网络失败 / 域名未配都有友好提示，不抛裸错
 */
const config = require("../config.js");

let baseUrlWarned = false;
let redirectingToLogin = false;

function baseUrl() {
  return (config.BASE_URL || "").replace(/\/+$/, "");
}

function ensureBaseUrl() {
  if (baseUrl()) return true;
  if (!baseUrlWarned) {
    baseUrlWarned = true;
    wx.showModal({
      title: "后端域名未配置",
      content:
        "请打开 miniprogram/config.js，把 BASE_URL 填成云托管服务的域名后重新编译。",
      showCancel: false,
    });
  }
  return false;
}

function currentPagesRoute() {
  try {
    const pages = getCurrentPages();
    const cur = pages[pages.length - 1];
    return cur ? cur.route : "";
  } catch (e) {
    return "";
  }
}

/** 401/403 统一处理：回到"我的"页提示登录（已在"我的"页则只提示，不循环跳转） */
function handleAuthFailure(status, serverMessage) {
  const app = getApp();
  if (status === 401 && app && app.logout) app.logout();
  const msg = serverMessage || (status === 401 ? "登录已过期，请重新登录" : "没有权限进行该操作");
  wx.showToast({ title: msg, icon: "none", duration: 2200 });
  if (redirectingToLogin) return;
  if (currentPagesRoute() === "pages/me/me") return;
  redirectingToLogin = true;
  setTimeout(() => {
    wx.switchTab({ url: "/pages/me/me" });
    redirectingToLogin = false;
  }, 900);
}

function request({ url, method = "GET", data = {}, auth = false, header = {} }) {
  return new Promise((resolve, reject) => {
    if (!ensureBaseUrl()) {
      reject(new Error("后端域名未配置"));
      return;
    }
    const headers = Object.assign({}, header);
    if (auth) {
      const token = (getApp() && getApp().globalData.token) || "";
      if (token) headers["Authorization"] = "Bearer " + token;
    }
    wx.request({
      url: baseUrl() + url,
      method,
      data,
      header: headers,
      success(res) {
        const status = res.statusCode;
        if (status >= 200 && status < 300) {
          resolve(res.data);
          return;
        }
        const body = res.data || {};
        const message = body.message || body.error || ("请求失败（" + status + "）");
        if (status === 401 || status === 403) {
          handleAuthFailure(status, body.message || body.error);
          reject(new Error(message));
          return;
        }
        wx.showToast({ title: String(message).slice(0, 40), icon: "none", duration: 2200 });
        reject(new Error(message));
      },
      fail(err) {
        wx.showToast({ title: "网络请求失败，请检查网络后重试", icon: "none", duration: 2200 });
        reject(err && err.errMsg ? new Error(err.errMsg) : new Error("网络请求失败"));
      },
    });
  });
}

function get(url, opts = {}) {
  return request(Object.assign({ url, method: "GET" }, opts));
}
function post(url, data, opts = {}) {
  return request(Object.assign({ url, method: "POST", data }, opts));
}
function patch(url, data, opts = {}) {
  return request(Object.assign({ url, method: "PATCH", data }, opts));
}

/** multipart 上传文件（凭证图片） */
function uploadFile({ url, filePath, name = "file", formData = {}, auth = true }) {
  return new Promise((resolve, reject) => {
    if (!ensureBaseUrl()) {
      reject(new Error("后端域名未配置"));
      return;
    }
    const headers = {};
    if (auth) {
      const token = (getApp() && getApp().globalData.token) || "";
      if (token) headers["Authorization"] = "Bearer " + token;
    }
    wx.uploadFile({
      url: baseUrl() + url,
      filePath,
      name,
      formData,
      header: headers,
      success(res) {
        const status = res.statusCode;
        let body = {};
        try {
          body = JSON.parse(res.data || "{}");
        } catch (e) {}
        if (status >= 200 && status < 300) {
          resolve(body);
          return;
        }
        const message = body.message || body.error || ("上传失败（" + status + "）");
        if (status === 401 || status === 403) {
          handleAuthFailure(status, body.message || body.error);
        } else {
          wx.showToast({ title: String(message).slice(0, 40), icon: "none" });
        }
        reject(new Error(message));
      },
      fail(err) {
        wx.showToast({ title: "上传失败，请检查网络后重试", icon: "none" });
        reject(err && err.errMsg ? new Error(err.errMsg) : new Error("上传失败"));
      },
    });
  });
}

module.exports = { request, get, post, patch, uploadFile, baseUrl };
