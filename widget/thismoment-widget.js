// ThisMoment 홈 화면 위젯 (Scriptable 앱용)
// 사용법: Scriptable 앱에서 새 스크립트를 만들고 이 내용을 붙여넣은 뒤, 아래 TOKEN 과 APIKEY 를 채우세요.
//   TOKEN  = 앱 설정 → "아이폰 시계 알람 연동"의 ③ 토큰 복사 버튼으로 복사한 값
//   APIKEY = 같은 곳의 ② apikey 값
// 홈 화면 길게 누르기 → 위젯 추가 → Scriptable → 이 스크립트 선택. (작은/중간 크기)
// 주의: TOKEN 은 비밀이에요. 이 파일은 비워 둔 채로 저장소에 있고, 채운 건 폰의 Scriptable 에만 두세요.
// 서버 쪽은 supabase/007_widget_data.sql 을 먼저 실행해야 해요.

const TOKEN = '여기에_토큰_붙여넣기';
const APIKEY = '여기에_apikey_붙여넣기';
const BASE = 'https://bvqdpkfdmwzszxzzuupz.supabase.co/rest/v1/rpc/get_widget_data';

// ── 반복 일정 계산 (앱의 recur.js 와 같은 규칙) ──
const DAY = 86400000;
const p2 = (n) => String(n).padStart(2, '0');
const iso = (d) => `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`;
const parse = (s) => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
const addDays = (s, n) => { const d = parse(s); return iso(new Date(d.getFullYear(), d.getMonth(), d.getDate() + n)); };
const between = (a, b) => Math.round((parse(b) - parse(a)) / DAY);

function parseRule(str) {
  if (!str) return null;
  const m = {};
  for (const part of str.split(';')) {
    const i = part.indexOf('=');
    if (i > 0) m[part.slice(0, i).trim().toUpperCase()] = part.slice(i + 1).trim();
  }
  if (!['DAILY', 'WEEKLY', 'MONTHLY', 'YEARLY'].includes(m.FREQ)) return null;
  return {
    freq: m.FREQ,
    interval: Math.min(Math.max(parseInt(m.INTERVAL, 10) || 1, 1), 99),
    days: (m.BYDAY ? m.BYDAY.split(',') : []).map(Number).filter((n) => n >= 0 && n <= 6),
    until: m.UNTIL || null,
    ex: m.EX ? m.EX.split(',') : [],
  };
}

function matches(r, m, c) {
  if (c < m) return false;
  if (r.until && c > r.until) return false;
  if (r.ex.includes(c)) return false;
  const dm = parse(m);
  const dc = parse(c);
  if (r.freq === 'DAILY') return between(m, c) % r.interval === 0;
  if (r.freq === 'WEEKLY') {
    const sm = new Date(dm.getFullYear(), dm.getMonth(), dm.getDate() - dm.getDay());
    const sc = new Date(dc.getFullYear(), dc.getMonth(), dc.getDate() - dc.getDay());
    const weeks = Math.round((sc - sm) / (7 * DAY));
    const set = r.days.length ? r.days : [dm.getDay()];
    return weeks % r.interval === 0 && set.includes(dc.getDay());
  }
  if (r.freq === 'MONTHLY') {
    const months = (dc.getFullYear() - dm.getFullYear()) * 12 + dc.getMonth() - dm.getMonth();
    if (months % r.interval) return false;
    const dim = new Date(dc.getFullYear(), dc.getMonth() + 1, 0).getDate();
    return dc.getDate() === Math.min(dm.getDate(), dim);
  }
  const years = dc.getFullYear() - dm.getFullYear();
  if (years % r.interval) return false;
  const dim = new Date(dc.getFullYear(), dm.getMonth() + 1, 0).getDate();
  return dc.getMonth() === dm.getMonth() && dc.getDate() === Math.min(dm.getDate(), dim);
}

function lastDay(ev) {
  if (!ev.ends_at) return iso(new Date(ev.starts_at));
  const e = new Date(ev.ends_at);
  if (!ev.all_day && e.getHours() === 0 && e.getMinutes() === 0 && new Date(ev.starts_at) < e) e.setDate(e.getDate() - 1);
  return iso(e);
}

// day(YYYY-MM-DD)에 보이는 일정들
function eventsOn(day, events) {
  const out = [];
  for (const ev of events) {
    const s = new Date(ev.starts_at);
    const first = iso(s);
    const rule = parseRule(ev.recurrence);
    const span = Math.max(between(first, lastDay(ev)), 0);
    let hit = false;
    let occ = first;
    if (!rule) {
      hit = first <= day && day <= lastDay(ev);
    } else {
      for (let k = 0; k <= span; k++) {
        if (matches(rule, first, addDays(day, -k))) { hit = true; occ = addDays(day, -k); }
      }
    }
    if (!hit) continue;
    // 오늘 끝나는 시각 (반복 일정은 그날의 시각으로 옮겨서 계산)
    const len = ev.ends_at ? new Date(ev.ends_at) - s : 0;
    const od = parse(occ);
    const start = new Date(od.getFullYear(), od.getMonth(), od.getDate(), s.getHours(), s.getMinutes());
    out.push({
      title: ev.title,
      all_day: ev.all_day,
      is_holiday: ev.is_holiday,
      minutes: s.getHours() * 60 + s.getMinutes(),
      end: new Date(start.getTime() + len),
    });
  }
  return out.sort((a, b) => (Number(b.all_day) - Number(a.all_day)) || (a.minutes - b.minutes));
}

// ── 데이터 가져오기 ──
async function load() {
  const req = new Request(BASE);
  req.method = 'POST';
  req.headers = { apikey: APIKEY, 'Content-Type': 'application/json' };
  req.body = JSON.stringify({ p_token: TOKEN });
  return await req.loadJSON();
}

// ── 그리기 (방향 E: 얇고 정돈된 모양, 색은 상태에만) ──
const dyn = (l, d) => Color.dynamic(new Color(l), new Color(d));
const C = {
  bg: dyn('#FFFFFF', '#171A1F'),
  text: dyn('#181B20', '#E8EAEE'),
  muted: dyn('#5A6270', '#9AA3B2'),
  accent: dyn('#2A55C0', '#86A6F5'),
  danger: dyn('#B42318', '#F2998F'),
};
const WD = ['일', '월', '화', '수', '목', '금', '토'];
const ddayLabel = (d) => (d.count_up ? `D+${-d.diff + 1}` : d.diff > 0 ? `D-${d.diff}` : d.diff === 0 ? 'D-Day' : `D+${-d.diff}`);

function put(stack, t, size, color, weight) {
  const el = stack.addText(String(t));
  el.font = weight === 'bold' ? Font.boldSystemFont(size) : weight === 'medium' ? Font.mediumSystemFont(size) : Font.systemFont(size);
  el.textColor = color;
  el.lineLimit = 1;
  el.minimumScaleFactor = 0.7;
  return el;
}

// 한 줄 구분선
function rule(stack, vertical) {
  const l = stack.addStack();
  l.backgroundColor = C.line;
  l.size = vertical ? new Size(1, 0) : new Size(0, 1);
  return l;
}

// 디데이 한 칸: 왼쪽 굵은 막대 + 이름 / 큰 숫자 / 날짜
function ddayCard(parent, d, big) {
  const near = !d.count_up && d.diff >= 0 && d.diff <= 7;
  const row = parent.addStack();
  row.centerAlignContent();
  const bar = row.addStack();
  bar.backgroundColor = near ? C.danger : C.accent;
  bar.size = new Size(4, big ? 74 : 62);
  bar.cornerRadius = 1.5;
  row.addSpacer(9);
  const col = row.addStack();
  col.layoutVertically();
  put(col, d.title, big ? 14 : 13, C.muted, 'medium');
  put(col, ddayLabel(d), big ? 46 : 38, near ? C.danger : C.text, 'bold');
  const dt = parse(d.date);
  put(col, `${dt.getMonth() + 1}.${dt.getDate()} (${WD[dt.getDay()]})`, 11, C.muted);
  return row;
}

function evLine(parent, e, size) {
  const row = parent.addStack();
  row.centerAlignContent();
  const t = e.all_day ? '종일' : `${p2(Math.floor(e.minutes / 60))}:${p2(e.minutes % 60)}`;
  put(row, t, size, C.accent, 'bold');
  row.addSpacer(6);
  put(row, e.title, size, C.text, 'medium');
  row.addSpacer();
  return row;
}

function build(data) {
  const w = new ListWidget();
  w.backgroundColor = C.bg;
  w.setPadding(16, 18, 16, 18);
  const small = config.widgetFamily === 'small';
  const now = new Date();
  const today = data.today || iso(now);

  const kr = (data.holidays || []).find((h) => h.date === today);
  const evs = eventsOn(today, data.events || []);
  const myHol = evs.find((e) => e.is_holiday);
  const normal = evs.filter((e) => !e.is_holiday).filter((e) => e.all_day || e.end > now);
  const holName = kr ? kr.name : myHol ? myHol.title : null;

  // 머리글: 오늘 날짜 (휴일이면 빨간 이름을 옆에) — 작은 크기는 디데이만 보여준다
  if (!small) {
    const head = w.addStack();
    head.centerAlignContent();
    put(head, `${now.getMonth() + 1}월 ${now.getDate()}일 ${WD[now.getDay()]}`, 16, holName ? C.danger : C.text, 'bold');
    if (holName) {
      head.addSpacer(8);
      put(head, holName, 11, C.danger, 'medium');
    }
    head.addSpacer();
    w.addSpacer(12);
  }

  // 디데이: 다가오는 것 먼저, 그 다음 지난 것/기념일
  const all = data.ddays || [];
  const dd = all.filter((d) => !d.count_up && d.diff >= 0).concat(all.filter((d) => d.count_up || d.diff < 0)).slice(0, small ? 1 : 2);

  if (small) {
    // 제목 · D-숫자 · 날짜만, 위젯 가운데에 크게
    w.addSpacer();
    if (dd.length) ddayCard(w, dd[0], true);
    else put(w, '디데이 없음', 13, C.muted);
    w.addSpacer();
  } else {
    const body = w.addStack();
    body.topAlignContent();
    const left = body.addStack();
    left.layoutVertically();
    if (!dd.length) put(left, '디데이 없음', 12, C.muted);
    dd.forEach((d, i) => {
      if (i) left.addSpacer(12);
      ddayCard(left, d, false);
    });
    body.addSpacer(14);
    rule(body, true);
    body.addSpacer(14);
    const right = body.addStack();
    right.layoutVertically();
    put(right, '오늘 일정', 12, C.muted, 'bold');
    right.addSpacer(7);
    if (!normal.length) put(right, '일정 없음', 14, C.muted);
    normal.slice(0, 4).forEach((e) => {
      evLine(right, e, 14);
      right.addSpacer(7);
    });
    if (normal.length > 4) put(right, `+${normal.length - 4}개 더`, 11, C.muted);
    right.addSpacer();
    body.addSpacer();
  }

  w.refreshAfterDate = new Date(Date.now() + 15 * 60 * 1000);
  return w;
}

function errorWidget(msg) {
  const w = new ListWidget();
  w.backgroundColor = C.bg;
  put(w, 'ThisMoment', 14, C.text, 'bold');
  const t = w.addText(msg);
  t.font = Font.systemFont(11);
  t.textColor = C.danger;
  return w;
}

let widget;
try {
  widget = build(await load());
} catch (e) {
  widget = errorWidget('불러오지 못했어요: ' + (e.message || e));
}
if (config.runsInWidget) Script.setWidget(widget);
else await widget.presentMedium();
Script.complete();
