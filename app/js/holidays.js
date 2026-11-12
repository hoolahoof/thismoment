// 공휴일 판정과 알람 울림 계산. 서버의 get_alarm_plan 과 같은 규칙.
import { parseDate, toISODate, todayLocal } from './util.js';

const DEFAULT_SETTINGS = { show_kr_holidays: true, include_substitute: true, include_temporary: true };
const mmdd = (iso) => iso.slice(5, 7) + iso.slice(8, 10);

// 그 날의 공휴일 이름 { kr, custom } (없으면 null)
export function holidayOn(iso, s) {
  const st = s.data.settings[0] ?? DEFAULT_SETTINGS;
  const h = s.holidays.find((x) => x.date === iso);
  const kr =
    h && st.show_kr_holidays &&
    (h.kind !== 'substitute' || st.include_substitute) &&
    (h.kind !== 'temporary' || st.include_temporary)
      ? h.name
      : null;
  const c = s.data.custom_holidays.find((c) =>
    c.yearly ? mmdd(iso) >= mmdd(c.start_date) && mmdd(iso) <= mmdd(c.end_date) : iso >= c.start_date && iso <= c.end_date
  );
  return { kr, custom: c ? c.name : null };
}

// 알람이 그 날 울리는지와 이유
export function alarmOn(a, iso, s) {
  const dow = parseDate(iso).getDay();
  if (!a.enabled) return { ring: false, reason: 'off' };
  if (!a.days.includes(dow)) return { ring: false, reason: 'not_today' };
  const h = holidayOn(iso, s);
  if (a.skip_holidays && h.kr) return { ring: false, reason: 'holiday', name: h.kr };
  if (a.skip_custom_holidays && h.custom) return { ring: false, reason: 'custom', name: h.custom };
  return { ring: true, holiday: h.kr || h.custom || null };
}

// 지금 이후 가장 먼저 울리는 날짜 (최대 400일 탐색)
export function nextRing(a, s) {
  if (!a.enabled || !a.days.length) return null;
  const now = new Date();
  const hhmm = a.time.slice(0, 5);
  const d = todayLocal();
  for (let i = 0; i < 400; i++) {
    const iso = toISODate(d);
    const past = i === 0 && `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}` >= hhmm;
    if (!past && alarmOn(a, iso, s).ring) return iso;
    d.setDate(d.getDate() + 1);
  }
  return null;
}

// 공휴일 때문에 건너뛰는 다음 날 (최대 400일)
export function nextSkip(a, s) {
  const d = todayLocal();
  for (let i = 0; i < 400; i++) {
    const iso = toISODate(d);
    const r = alarmOn(a, iso, s);
    if (r.reason === 'holiday' || r.reason === 'custom') return { iso, name: r.name };
    d.setDate(d.getDate() + 1);
  }
  return null;
}
