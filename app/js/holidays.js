// 공휴일 판정과 알람 울림 계산. 서버의 get_alarm_plan 과 같은 규칙.
// "내 휴일"은 일정 추가 창에서 휴일 버튼을 켠 일정(is_holiday)이다. 하루 종일·여러 날·매년 반복이 모두 된다.
import { parseDate, toISODate, todayLocal } from './util.js';
import { eventsOn } from './recur.js';

const DEFAULT_SETTINGS = { show_kr_holidays: true, include_substitute: true, include_temporary: true };

// 그 날 휴일로 표시한 일정들 (반복 포함)
export function holidayEventsOn(iso, s) {
  const list = s.data.events.filter((e) => e.is_holiday);
  return list.length ? eventsOn(iso, list) : [];
}

// 그 날의 공휴일 이름 { kr, custom } (없으면 null). custom = 내가 휴일로 표시한 일정의 이름
export function holidayOn(iso, s) {
  const st = s.data.settings[0] ?? DEFAULT_SETTINGS;
  const h = s.holidays.find((x) => x.date === iso);
  const kr =
    h && st.show_kr_holidays &&
    (h.kind !== 'substitute' || st.include_substitute) &&
    (h.kind !== 'temporary' || st.include_temporary)
      ? h.name
      : null;
  const mine = holidayEventsOn(iso, s)[0];
  return { kr, custom: mine ? mine.title : null };
}

// 요일을 하나도 고르지 않은 알람 = 한 번만 울리고 자동으로 지워지는 알람 (울릴 날짜는 once_on)
export const isOnce = (a) => !a.days || a.days.length === 0;

// 알람이 그 날 울리는지와 이유 (한 번만 알람은 공휴일과 상관없이 정한 날에 울린다)
export function alarmOn(a, iso, s) {
  const dow = parseDate(iso).getDay();
  if (!a.enabled) return { ring: false, reason: 'off' };
  if (isOnce(a)) return a.once_on === iso ? { ring: true } : { ring: false, reason: 'not_today' };
  if (!a.days.includes(dow)) return { ring: false, reason: 'not_today' };
  const h = holidayOn(iso, s);
  if (a.skip_holidays && h.kr) return { ring: false, reason: 'holiday', name: h.kr };
  if (a.skip_custom_holidays && h.custom) return { ring: false, reason: 'custom', name: h.custom };
  return { ring: true, holiday: h.kr || h.custom || null };
}

// 지금 이후 가장 먼저 울리는 날짜 (최대 400일 탐색)
export function nextRing(a, s) {
  if (!a.enabled) return null;
  const now = new Date();
  if (isOnce(a)) return a.once_on && new Date(`${a.once_on}T${a.time.slice(0, 5)}`) > now ? a.once_on : null;
  if (!a.days.length) return null;
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
