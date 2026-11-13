// 반복 일정 규칙. events 표의 recurrence 칸에 글자로 저장한다 (DB 변경 없음).
//   FREQ=WEEKLY;INTERVAL=2;BYDAY=1,3;UNTIL=2026-12-31;EX=2026-11-20,2026-11-27
//   FREQ: DAILY | WEEKLY | MONTHLY | YEARLY,  BYDAY: 0(일)~6(토),  EX: 빼는 날(이 일정만 바꾸거나 지운 날)
// 일정 한 줄(master)이 시작일 하나를 갖고, 날짜마다 "그날의 일정(occurrence)"을 계산해서 보여준다.
import { toISODate, parseDate } from './util.js';

const WD = ['일', '월', '화', '수', '목', '금', '토'];
const FREQS = ['DAILY', 'WEEKLY', 'MONTHLY', 'YEARLY'];
const DAY = 86400000;
const ISO = /^\d{4}-\d{2}-\d{2}$/;

export const localISO = (ts) => toISODate(new Date(ts));
const p2 = (n) => String(n).padStart(2, '0');
export const hm = (ts) => {
  const d = new Date(ts);
  return `${p2(d.getHours())}:${p2(d.getMinutes())}`;
};
export const eventTime = (ev) => (ev.all_day ? '하루 종일' : `${hm(ev.starts_at)}–${ev.ends_at ? hm(ev.ends_at) : ''}`);
export const addDays = (iso, n) => {
  const d = parseDate(iso);
  return toISODate(new Date(d.getFullYear(), d.getMonth(), d.getDate() + n));
};
export const daysBetween = (a, b) => Math.round((parseDate(b) - parseDate(a)) / DAY);

// ── 규칙 읽기/쓰기 ──
export function parseRule(str) {
  if (!str || typeof str !== 'string') return null;
  const m = {};
  for (const part of str.split(';')) {
    const i = part.indexOf('=');
    if (i > 0) m[part.slice(0, i).trim().toUpperCase()] = part.slice(i + 1).trim();
  }
  if (!FREQS.includes(m.FREQ)) return null;
  const interval = Math.min(Math.max(parseInt(m.INTERVAL, 10) || 1, 1), 99);
  const days = (m.BYDAY ? m.BYDAY.split(',') : [])
    .map(Number)
    .filter((n) => Number.isInteger(n) && n >= 0 && n <= 6);
  return {
    freq: m.FREQ,
    interval,
    days: [...new Set(days)].sort((a, b) => a - b),
    until: m.UNTIL && ISO.test(m.UNTIL) ? m.UNTIL : null,
    ex: (m.EX ? m.EX.split(',') : []).filter((d) => ISO.test(d)).sort(),
  };
}

export function serializeRule(r) {
  if (!r) return null;
  const parts = [`FREQ=${r.freq}`, `INTERVAL=${r.interval || 1}`];
  if (r.freq === 'WEEKLY' && r.days?.length) parts.push(`BYDAY=${[...r.days].sort((a, b) => a - b).join(',')}`);
  if (r.until) parts.push(`UNTIL=${r.until}`);
  if (r.ex?.length) parts.push(`EX=${[...new Set(r.ex)].sort().join(',')}`);
  return parts.join(';');
}

// 규칙이 같은지 (빼는 날은 비교하지 않음)
export const sameRule = (a, b) => serializeRule(a && { ...a, ex: [] }) === serializeRule(b && { ...b, ex: [] });

export function describeRule(r) {
  if (!r) return '';
  const n = r.interval;
  let t;
  if (r.freq === 'DAILY') t = n === 1 ? '매일' : `${n}일마다`;
  else if (r.freq === 'WEEKLY') {
    const d = r.days.length ? r.days.map((x) => WD[x]).join('·') : '';
    const every = n === 1 ? '매주' : `${n}주마다`;
    t = r.days.length === 7 ? (n === 1 ? '매일' : `${n}주마다 매일`) : `${every}${d ? ' ' + d : ''}`;
  } else if (r.freq === 'MONTHLY') t = n === 1 ? '매달' : `${n}개월마다`;
  else t = n === 1 ? '매년' : `${n}년마다`;
  if (r.until) t += ` · ${Number(r.until.slice(5, 7))}/${Number(r.until.slice(8, 10))}까지`;
  return t;
}

// 그 날이 규칙에 맞는 날인지 (m: 첫 일정 날짜, c: 확인할 날짜)
function matches(rule, m, c) {
  if (c < m) return false;
  if (rule.until && c > rule.until) return false;
  if (rule.ex.includes(c)) return false;
  const dm = parseDate(m);
  const dc = parseDate(c);
  switch (rule.freq) {
    case 'DAILY':
      return daysBetween(m, c) % rule.interval === 0;
    case 'WEEKLY': {
      const sunM = new Date(dm.getFullYear(), dm.getMonth(), dm.getDate() - dm.getDay());
      const sunC = new Date(dc.getFullYear(), dc.getMonth(), dc.getDate() - dc.getDay());
      const weeks = Math.round((sunC - sunM) / (7 * DAY));
      const set = rule.days.length ? rule.days : [dm.getDay()];
      return weeks % rule.interval === 0 && set.includes(dc.getDay());
    }
    case 'MONTHLY': {
      const months = (dc.getFullYear() - dm.getFullYear()) * 12 + dc.getMonth() - dm.getMonth();
      if (months % rule.interval) return false;
      const dim = new Date(dc.getFullYear(), dc.getMonth() + 1, 0).getDate();
      return dc.getDate() === Math.min(dm.getDate(), dim); // 31일 → 짧은 달은 말일
    }
    case 'YEARLY': {
      const years = dc.getFullYear() - dm.getFullYear();
      if (years % rule.interval) return false;
      const dim = new Date(dc.getFullYear(), dm.getMonth() + 1, 0).getDate();
      return dc.getMonth() === dm.getMonth() && dc.getDate() === Math.min(dm.getDate(), dim);
    }
  }
  return false;
}

// 일정이 걸쳐 있는 마지막 날 (시간 일정이 자정에 끝나면 전날까지)
export function lastDayISO(ev) {
  if (!ev.ends_at) return localISO(ev.starts_at);
  const e = new Date(ev.ends_at);
  if (!ev.all_day && e.getHours() === 0 && e.getMinutes() === 0 && new Date(ev.starts_at) < e) e.setDate(e.getDate() - 1);
  return toISODate(e);
}

// 그날의 일정으로 만들기: 시작 시각은 첫 일정의 시각, 길이는 같게
export function occurrenceAt(ev, occISO) {
  const s = new Date(ev.starts_at);
  const e = ev.ends_at ? new Date(ev.ends_at) : s;
  const d = parseDate(occISO);
  const start = new Date(d.getFullYear(), d.getMonth(), d.getDate(), s.getHours(), s.getMinutes());
  const end = new Date(start.getTime() + (e - s));
  return { ...ev, starts_at: start.toISOString(), ends_at: end.toISOString(), _occ: occISO };
}

// 그 날에 보이는 일정들 (반복 일정은 그날의 모습으로 바꿔서)
export function eventsOn(iso, events) {
  const out = [];
  for (const ev of events) {
    const rule = parseRule(ev.recurrence);
    if (!rule) {
      if (localISO(ev.starts_at) <= iso && iso <= lastDayISO(ev)) out.push({ ...ev, _occ: localISO(ev.starts_at) });
      continue;
    }
    const first = localISO(ev.starts_at);
    const span = Math.max(daysBetween(first, lastDayISO(ev)), 0);
    for (let k = 0; k <= span; k++) {
      const cand = addDays(iso, -k);
      if (matches(rule, first, cand)) out.push(occurrenceAt(ev, cand));
    }
  }
  return out.sort((a, b) => (b.all_day - a.all_day) || a.starts_at.localeCompare(b.starts_at));
}

// 오늘 이후 가장 먼저 오는 일정 날짜 (검색 결과에서 이동할 때 사용). 없으면 null
export function nextOccurrenceISO(ev, fromISO, maxDays = 800) {
  const rule = parseRule(ev.recurrence);
  const first = localISO(ev.starts_at);
  if (!rule) return lastDayISO(ev) >= fromISO ? first : null;
  for (let i = 0; i < maxDays; i++) {
    const c = addDays(fromISO, i);
    if (matches(rule, first, c)) return c;
  }
  return null;
}

// 새로 만들거나 규칙을 바꿀 때, 시작일이 요일 선택에 맞도록 첫 해당 요일로 옮긴다
export function alignStart(rule, start, end) {
  if (!rule || rule.freq !== 'WEEKLY' || !rule.days.length || rule.days.includes(start.getDay())) return [start, end];
  let add = 1;
  while (!rule.days.includes((start.getDay() + add) % 7)) add++;
  const shift = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + add, d.getHours(), d.getMinutes());
  return [shift(start), shift(end)];
}
