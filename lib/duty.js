// 值日分组与排班（逻辑与 Worker 版一致；分组名单随数据迁移，init 只用于全新班级）
const { sequelize, DutyGroup, DutyShift, Class, q } = require("../db");
const { AppError, newId } = require("./util");
const { appendAudit } = require("./audit");

// 空占位：已有班级的数据由迁移脚本导入；新班级再手动配置分组
async function initGroups(classId, now = Date.now()) {
  const count = await DutyGroup.count({ where: { class_id: classId } });
  if (count === 0) {
    await DutyGroup.create({
      id: `duty-g0-${classId}`, class_id: classId, group_no: 0,
      leader_name: "待定", member_names: JSON.stringify([]),
    });
  }
  return list(classId);
}

function dateAdd(start, days) {
  const d = new Date(`${start}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

async function list(classId, member = null) {
  const groups = await DutyGroup.findAll({ where: { class_id: classId }, order: [["group_no", "ASC"]] });
  const shifts = await DutyShift.findAll({ where: { class_id: classId }, order: [["duty_date", "ASC"]] });
  const shiftRows = shifts.map((s) => {
    const g = groups.find((x) => x.group_no === s.group_no);
    return { ...s.get({ plain: true }), leader_name: g?.leader_name ?? "",
      member_names: g ? JSON.parse(g.member_names) : [] };
  });
  const mine = member ? shiftRows.filter((s) => {
    const g = groups.find((x) => x.group_no === s.group_no);
    return g && JSON.parse(g.member_names).includes(member.name);
  }) : [];
  return { groups: groups.map((g) => ({ ...g.get({ plain: true }), member_names: JSON.parse(g.member_names) })),
    shifts: shiftRows, mine };
}

async function generate(classId, weekStart, now = Date.now()) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(weekStart)) throw new AppError(400, "invalid_week_start", "week_start 必须是 YYYY-MM-DD");
  await initGroups(classId, now);
  const rows = [
    [0, "早班", "07:30 - 08:10", 1], [0, "晚班", "17:15 - 17:55", 2],
    [1, "早班", "07:30 - 08:10", 3], [1, "晚班", "17:15 - 17:55", 4],
    [2, "早班", "07:30 - 08:10", 5], [2, "晚班", "17:15 - 17:55", 6],
    [3, "早班", "07:30 - 08:10", 7], [3, "晚班", "17:15 - 17:55", 8],
    [4, "早班", "07:30 - 08:10", 1], [4, "晚班", "17:15 - 17:55", 2],
  ];
  const weekdays = ["周一", "周二", "周三", "周四", "周五"];
  await sequelize.transaction(async (t) => {
    for (const [offset, session, timeRange, groupNo] of rows) {
      const date = dateAdd(weekStart, offset);
      const existing = await DutyShift.findOne({
        where: { class_id: classId, duty_date: date, session }, transaction: t });
      const note = offset === 4 ? `第${groupNo}组（第一周多值一次）` : `第${groupNo}组按顺序轮值`;
      if (existing) {
        await existing.update({ time_range: timeRange, group_no: groupNo, note }, { transaction: t });
      } else {
        await DutyShift.create({
          id: `duty-${newId()}`, class_id: classId, duty_date: date, weekday: weekdays[offset],
          session, time_range: timeRange, group_no: groupNo, note,
          checked_at: null, checked_note: null, created_at: now,
        }, { transaction: t });
      }
    }
    await appendAudit([{ actor: null, action: "duty.generated", entity: "class", entityId: classId,
      payload: { week_start: weekStart }, at: now }], t);
  });
  return list(classId);
}

async function updateShift(classId, shiftId, body, now = Date.now()) {
  const s = await DutyShift.findByPk(shiftId);
  if (!s || s.class_id !== classId) throw new AppError(404, "shift_not_found", "班次不存在");
  const updates = {};
  if (body.group_no !== undefined) {
    const g = Number(body.group_no);
    if (!Number.isInteger(g) || g < 1 || g > 99) throw new AppError(400, "invalid_group_no", "group_no 无效");
    updates.group_no = g;
  }
  if (body.note !== undefined) updates.note = body.note === null ? null : String(body.note).slice(0, 200);
  if (Object.keys(updates).length === 0) throw new AppError(400, "empty_patch", "没有可更新的字段");
  await s.update(updates);
  return s.get({ plain: true });
}

module.exports = { list, generate, updateShift, initGroups };
