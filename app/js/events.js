// 일정 저장·옮기기·삭제. 반복 일정은 "이 일정만 / 이후 모든 일정 / 모든 일정" 중 고른 범위로 처리한다.
import * as store from './store.js';
import { parseRule, serializeRule, localISO, addDays, daysBetween, alignStart, occurrenceAt } from './recur.js';
import { toISODate } from './util.js';

const masterOf = (ev) => store.getState().data.events.find((e) => e.id === ev.id);
// is_holiday 칸이 없는 데이터베이스(005 SQL 전)에서도 일반 일정은 저장되도록, 휴일이 아닐 땐 칸을 보내지 않는다
const clean = (fields, wasHoliday, wasEmoji = false) => {
  const o = { ...fields };
  if (!o.is_holiday && !wasHoliday) delete o.is_holiday;
  if (!o.emoji && !wasEmoji) delete o.emoji;
  return o;
};
const occOf = (ev) => ev._occ ?? localISO(ev.starts_at);

// 목록·블록에서 누른 일정 찾기 (반복이면 그날의 모습으로)
export function findOccurrence(id, occISO) {
  const m = masterOf({ id });
  if (!m) return null;
  return parseRule(m.recurrence) && occISO ? occurrenceAt(m, occISO) : m;
}

// ── 범위 묻기 (반복 일정을 고치거나 지울 때) ──
let scopeDialog = null;
export function askScope(verb, { allowOne = true, allowFollowing = true } = {}) {
  if (!scopeDialog) {
    scopeDialog = document.createElement('dialog');
    scopeDialog.className = 'sheet';
    scopeDialog.setAttribute('aria-labelledby', 'scope-title');
    document.body.appendChild(scopeDialog);
  }
  const dlg = scopeDialog;
  dlg.innerHTML = `
    <div class="form">
      <h2 id="scope-title">반복 일정 ${verb}</h2>
      <p class="muted small">어느 범위에 적용할까요?</p>
      ${allowOne ? '<button class="btn big" data-scope="one">이 일정만</button>' : ''}
      ${allowFollowing ? '<button class="btn big" data-scope="following">이 일정과 이후 모든 일정</button>' : ''}
      <button class="btn big" data-scope="all">모든 반복 일정</button>
      <button class="btn" data-scope="">취소</button>
    </div>`;
  return new Promise((resolve) => {
    let done = false;
    // 고르는 즉시 결과를 돌려준다 (닫힘 이벤트를 기다리지 않음). ESC·바깥 누르기는 취소로 본다.
    const finish = (value) => {
      if (done) return;
      done = true;
      dlg.removeEventListener('click', onClick);
      dlg.removeEventListener('close', onClose);
      if (dlg.open) dlg.close();
      resolve(value);
    };
    const onClick = (e) => {
      if (e.target === dlg) return finish(null);
      const b = e.target.closest('[data-scope]');
      if (b) finish(b.dataset.scope || null);
    };
    const onClose = () => finish(null);
    dlg.addEventListener('click', onClick);
    dlg.addEventListener('close', onClose);
    dlg.showModal();
  });
}

// 이 일정 하나에 대해 물어야 하는지, 어떤 선택지가 있는지
export function scopeOptions(ev, ruleChanged = false) {
  const master = masterOf(ev);
  const rule = master && parseRule(master.recurrence);
  if (!rule) return null; // 반복 아님 → 묻지 않음
  const isFirst = occOf(ev) <= localISO(master.starts_at);
  return { allowOne: !ruleChanged, allowFollowing: !isFirst };
}

// ── 저장/수정 ──
// occ: 고치는 일정(반복이면 그날의 모습, _occ 있음), fields: {title, all_day, color, note},
// start/end: 새 시작·끝(Date), rule: 새 반복 규칙(없으면 null), scope: 'one'|'following'|'all'
export async function applyEdit({ occ, fields, start, end, rule, scope }) {
  const master = masterOf(occ);
  if (!master) throw new Error('일정을 찾지 못했어요.');
  const oldRule = parseRule(master.recurrence);
  const base = (s, e, was = !!master.is_holiday) => ({ ...clean(fields, was, !!master.emoji), starts_at: s.toISOString(), ends_at: e.toISOString() });

  // 반복이 아니던 일정
  if (!oldRule) {
    const [s, e] = alignStart(rule, start, end);
    return store.update('events', master.id, { ...base(s, e), recurrence: rule ? serializeRule({ ...rule, ex: [] }) : null });
  }

  const occISO = occOf(occ);
  const masterISO = localISO(master.starts_at);

  if (scope === 'one') {
    await store.update('events', master.id, { recurrence: serializeRule({ ...oldRule, ex: [...oldRule.ex, occISO] }) });
    return store.insert('events', { ...base(start, end, false), recurrence: null });
  }

  if (scope === 'following' && occISO > masterISO) {
    await store.update('events', master.id, { recurrence: serializeRule({ ...oldRule, until: addDays(occISO, -1) }) });
    const [s, e] = alignStart(rule, start, end);
    const next = rule ? serializeRule({ ...rule, ex: oldRule.ex.filter((d) => d >= occISO) }) : null;
    return store.insert('events', { ...base(s, e, false), recurrence: next });
  }

  // 모든 일정: 첫 일정을, 이 일정이 옮겨진 만큼 같이 옮긴다
  const delta = daysBetween(occISO, toISODate(start));
  const ms = new Date(master.starts_at);
  const newStart = new Date(ms.getFullYear(), ms.getMonth(), ms.getDate() + delta, start.getHours(), start.getMinutes());
  const newEnd = new Date(newStart.getTime() + (end - start));
  const [s, e] = alignStart(rule, newStart, newEnd);
  const ex = oldRule.ex.map((d) => addDays(d, delta));
  const until = rule?.until && delta ? rule.until : rule?.until;
  return store.update('events', master.id, {
    ...base(s, e),
    recurrence: rule ? serializeRule({ ...rule, until, ex }) : null,
  });
}

// ── 새 일정 ──
export function createEvent({ fields, start, end, rule }) {
  const [s, e] = alignStart(rule, start, end);
  return store.insert('events', {
    ...clean(fields, false),
    starts_at: s.toISOString(),
    ends_at: e.toISOString(),
    recurrence: rule ? serializeRule({ ...rule, ex: [] }) : null,
  });
}

// ── 삭제 ──
export async function deleteEvent({ occ, scope }) {
  const master = masterOf(occ);
  if (!master) return;
  const oldRule = parseRule(master.recurrence);
  if (!oldRule || scope === 'all') return store.remove('events', master.id);
  const occISO = occOf(occ);
  if (scope === 'one') {
    return store.update('events', master.id, { recurrence: serializeRule({ ...oldRule, ex: [...oldRule.ex, occISO] }) });
  }
  // following
  if (occISO <= localISO(master.starts_at)) return store.remove('events', master.id);
  return store.update('events', master.id, { recurrence: serializeRule({ ...oldRule, until: addDays(occISO, -1) }) });
}

// ── 끌어서 옮기기 (시간 또는 날짜만 바뀜) ──
// 반복 일정이면 범위를 묻고, 취소하면 false
export async function moveEvent(occ, newStart, newEnd) {
  const fields = { title: occ.title, all_day: occ.all_day, color: occ.color, note: occ.note, is_holiday: !!occ.is_holiday, ...(occ.emoji ? { emoji: occ.emoji } : {}) };
  const opts = scopeOptions(occ);
  let scope = 'all';
  if (opts) {
    scope = await askScope('옮기기', opts);
    if (!scope) return false;
  }
  const master = masterOf(occ);
  await applyEdit({ occ, fields, start: newStart, end: newEnd, rule: master ? parseRule(master.recurrence) : null, scope });
  return true;
}
