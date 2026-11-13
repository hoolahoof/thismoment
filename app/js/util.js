export function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

const WD = ['일', '월', '화', '수', '목', '금', '토'];

export function todayLocal() {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}
export function parseDate(s) {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d);
}
export function toISODate(d) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
export function fmtDate(s) {
  const d = parseDate(s);
  return `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, '0')}.${String(d.getDate()).padStart(2, '0')} (${WD[d.getDay()]})`;
}
export function daysUntil(s) {
  return Math.round((parseDate(s) - todayLocal()) / 86400000);
}
// 디데이 표기: 다가오는 날은 D-N, 당일은 D-Day, 지난 날은 D+N, 기념일 세기는 시작일을 1일로 센다.
export function ddayLabel(dday) {
  const diff = daysUntil(dday.target_date);
  if (dday.count_up) return `D+${-diff + 1}`;
  if (diff > 0) return `D-${diff}`;
  if (diff === 0) return 'D-Day';
  return `D+${-diff}`;
}

const svg = (d, w = 1.75) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
export const icons = {
  home: svg('<path d="M3 11l9-8 9 8v9a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z"/>'),
  calendar: svg('<rect x="3" y="4.5" width="18" height="16.5" rx="3"/><path d="M3 9.5h18M8 3v3M16 3v3"/>'),
  day: svg('<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>'),
  dday: svg('<path d="M5 21V4M5 4h11l-2 4 2 4H5"/>'),
  settings: svg('<path d="M4 7h9M17 7h3M4 17h3M11 17h9M15 5v4M9 15v4"/>'),
  alarm: svg('<path d="M6 16v-5a6 6 0 0 1 12 0v5l1.5 2h-15zM10 21h4"/>'),
  edit: svg('<path d="M4 20h4L19 9l-4-4L4 16zM13.5 6.5l4 4"/>'),
  star: svg('<path d="M12 3.5l2.6 5.4 5.9.8-4.3 4.1 1 5.9L12 16.9 6.8 19.7l1-5.9L3.5 9.7l5.9-.8z"/>'),
  plus: svg('<path d="M12 5v14M5 12h14"/>', 2.2),
  trash: svg('<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/>'),
  plane: svg('<path d="M21 4L3 11l7 2.5L12.5 21zM10 13.5L21 4"/>'),
  gift: svg('<rect x="3" y="8" width="18" height="4" rx="1"/><path d="M5 12v8h14v-8M12 8v12M12 8c-2.5 0-4-1-4-2.5S9.5 3 12 8c2.5-5 4-3.5 4-2.5S14.5 8 12 8z"/>'),
  check: svg('<path d="M5 12.5l4.5 4.5L19 7.5"/>', 2.4),
};

// 디데이 이름에서 아이콘 고르기
export function ddayIcon(title) {
  if (/여행|휴가|비행|출국|공항|trip/i.test(title)) return icons.plane;
  if (/생일|기념|결혼|선물|파티|birthday/i.test(title)) return icons.gift;
  return icons.dday;
}
