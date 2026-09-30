const api = require("../../utils/api.js");
const util = require("../../utils/util.js");

const ROLES = ["parent", "committee", "finance", "auditor", "teacher"];

Page({
  data: {
    members: [],
    loading: true,
    loadError: "",
    noPermission: false,
    showAdd: false,
    // 新增表单
    newName: "",
    newPhone: "",
    newRole: "parent",
    roleNames: ["家长", "家委会", "财务", "审核", "班主任"],
    roleIndex: 0,
    submitting: false,
    // 邀请码弹窗
    inviteCodes: [],
    showInvite: false,
  },

  onLoad() {
    const p = getApp().globalData.permissions;
    if (p && !p.manage) {
      this.setData({ loading: false, noPermission: true });
      return;
    }
    this.load();
  },

  load() {
    this.setData({ loading: true, loadError: "" });
    return api
      .get("/api/members", { auth: true })
      .then((res) => {
        const list = Array.isArray(res) ? res : res.items || [];
        this.setData({
          loading: false,
          members: list.map((m) => ({
            id: m.id,
            name: m.name,
            phone: m.phone || "",
            role: m.role,
            roleLabel: util.roleLabel(m.role),
            isOwner: !!m.is_owner,
            activated: m.activated !== false,
          })),
        });
      })
      .catch(() => {
        this.setData({ loading: false, loadError: "花名册加载失败，下拉可重试" });
      });
  },

  onPullDownRefresh() {
    this.load().finally(() => wx.stopPullDownRefresh());
  },

  toggleAdd() {
    this.setData({ showAdd: !this.data.showAdd });
  },

  bindField(e) {
    this.setData({ [e.currentTarget.dataset.field]: e.detail.value });
  },

  bindRole(e) {
    const idx = Number(e.detail.value);
    this.setData({ roleIndex: idx, newRole: ROLES[idx] });
  },

  addMember() {
    const name = this.data.newName.trim();
    if (!name) {
      wx.showToast({ title: "请填写姓名", icon: "none" });
      return;
    }
    this.setData({ submitting: true });
    api
      .post(
        "/api/members",
        { name, phone: this.data.newPhone.trim(), role: this.data.newRole },
        { auth: true }
      )
      .then(() => {
        wx.showToast({ title: "已添加到花名册", icon: "success" });
        this.setData({ showAdd: false, newName: "", newPhone: "", newRole: "parent", roleIndex: 0 });
        this.load();
      })
      .catch(() => {})
      .finally(() => this.setData({ submitting: false }));
  },

  /** 修改角色 */
  changeRole(e) {
    const m = this.data.members[e.currentTarget.dataset.idx];
    wx.showActionSheet({
      itemList: this.data.roleNames,
      success: (res) => {
        const role = ROLES[res.tapIndex];
        if (role === m.role) return;
        api
          .patch("/api/members/" + m.id, { role }, { auth: true })
          .then(() => {
            wx.showToast({ title: "角色已更新", icon: "success" });
            this.load();
          })
          .catch(() => {});
      },
    });
  },

  /** 给单个成员发邀请码 */
  inviteOne(e) {
    const m = this.data.members[e.currentTarget.dataset.idx];
    wx.showModal({
      title: "发放邀请码",
      content: "给「" + m.name + "」生成一个一次性登录码（默认 7 天有效）？",
      success: (res) => {
        if (!res.confirm) return;
        api
          .post("/api/invitations", { member_id: m.id }, { auth: true })
          .then((r) => {
            this.setData({ inviteCodes: [{ name: m.name, code: r.code }], showInvite: true });
          })
          .catch(() => {});
      },
    });
  },

  /** 给所有未激活成员批量发码 */
  inviteAll() {
    const targets = this.data.members.filter((m) => !m.activated && !m.isOwner);
    if (!targets.length) {
      wx.showToast({ title: "所有成员都已激活", icon: "none" });
      return;
    }
    wx.showModal({
      title: "批量发放邀请码",
      content: "给 " + targets.length + " 位未激活成员各生成一个登录码？",
      success: (res) => {
        if (!res.confirm) return;
        api
          .post("/api/invitations/bulk", { member_ids: targets.map((m) => m.id) }, { auth: true })
          .then((r) => {
            const list = Array.isArray(r) ? r : r.items || [];
            const byId = {};
            targets.forEach((m) => (byId[m.id] = m.name));
            this.setData({
              inviteCodes: list.map((x) => ({ name: byId[x.member_id] || x.member_id, code: x.code })),
              showInvite: true,
            });
          })
          .catch(() => {});
      },
    });
  },

  copyCode(e) {
    wx.setClipboardData({
      data: e.currentTarget.dataset.code,
      success: () => wx.showToast({ title: "邀请码已复制", icon: "success" }),
    });
  },

  closeInvite() {
    this.setData({ showInvite: false, inviteCodes: [] });
  },

  /** 阻止弹窗冒泡关闭（空实现） */
  noop() {},
});
