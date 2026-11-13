// 홈(대시보드): 오늘 날짜·휴일 여부, 가까운 디데이, 오늘 알람(울림/쉼), 오늘 일정, 오늘 할 일을 한 화면에.
import * as store from './store.js';
import { holidayOn, alarmOn, nextRing } from './holidays.js';
import { esc, ddayIcon, fmtDate, icons, toISODate, parseDate, todayLocal, ddayLabel, daysUntil } from './util.js';
import { eventsOn, eventTime, addDays } from './recur.js';
import { colorOf, REPEAT_ICON } from './colors.js';
import { setSelected } from './calendar.js';
import { startQuotes } from './quotes.js';

const WD = ['일', '월', '화', '수', '목', '금', '토'];
const pad = (n) => String(n).padStart(2, '0');
const MAX_TODOS = 8;
// 기념일 세기: 이 날 이후로 며칠이 지났는지 (당일 = D+0)
const SINCE = { label: '임찬규님 탄신일', date: '1997-04-25' };

const dayWord = (iso, todayISO) => {
  if (iso === todayISO) return '오늘';
  if (iso === addDays(todayISO, 1)) return '내일';
  const d = parseDate(iso);
  return `${d.getMonth() + 1}월 ${d.getDate()}일 (${WD[d.getDay()]})`;
};

// 켜져 있는 알람 중 가장 먼저 울리는 것 (휴일에 쉬는 알람은 건너뛴 다음 날로 계산됨)
function nextAlarm(alarms, s) {
  let best = null;
  for (const a of alarms) {
    const iso = nextRing(a, s);
    if (!iso) continue;
    const key = `${iso} ${a.time.slice(0, 5)}`;
    if (!best || key < best.key) best = { a, iso, key };
  }
  return best;
}

let timer = null;

export const home = {
  mount(el) {
    el.innerHTML = `
      <div class="since" data-slot="since"></div>
      <button class="quote" type="button" data-slot="quote" hidden aria-label="오늘의 명언, 누르면 다음 명언">
        <span class="quote-mark quote-mark-open" aria-hidden="true">“</span>
        <span class="quote-body">
          <span class="quote-text" data-slot="q-text"></span>
          <span class="quote-author" data-slot="q-author"></span>
        </span>
        <span class="quote-mark quote-mark-close" aria-hidden="true">”</span>
        <span class="quote-timer" aria-hidden="true"></span>
      </button>

      <header class="page-head home-head">
        <div class="home-head-text">
          <span class="eyebrow">오늘</span>
          <h1 data-slot="date"></h1>
        </div>
        <span data-slot="chip"></span>
      </header>
      <div class="dday-grid" data-slot="strip"></div>

      <h2 class="section-title">오늘 일정</h2>
      <ul class="list" data-slot="events"></ul>

      <div class="section-row">
        <h2 class="section-title">오늘 할 일</h2>
        <span class="muted small" data-slot="todo-count"></span>
      </div>
      <ul class="list" data-slot="todos"></ul>

      <h2 class="section-title">알람</h2>
      <section class="card" data-slot="alarms"></section>`;

    el.addEventListener('click', async (e) => {
      // 디데이 카드: 캘린더에서 그 날짜를 열기
      const dd = e.target.closest('[data-dday-date]');
      if (dd) {
        setSelected(dd.dataset.ddayDate);
        location.hash = '#/calendar';
        return;
      }
      const go = e.target.closest('[data-go]');
      if (go) {
        setSelected(toISODate(todayLocal()));
        location.hash = '#/' + go.dataset.go;
        return;
      }
      const b = e.target.closest('[data-todo]');
      if (!b) return;
      const t = store.getState().data.todos.find((x) => x.id === b.dataset.todo);
      if (!t) return;
      try {
        await store.update('todos', t.id, { done: !t.done });
      } catch (err) {
        alert('저장하지 못했어요: ' + err.message);
      }
    });

    startQuotes(el.querySelector('[data-slot=quote]'));

    // 시간이 지나면 알람·일정의 "지남" 표시가 바뀌도록 1분마다 다시 그린다
    clearInterval(timer);
    timer = setInterval(() => {
      if (!el.isConnected) return clearInterval(timer);
      home.update(el, store.getState());
    }, 60000);
  },

  update(el, s) {
    const now = new Date();
    const todayISO = toISODate(todayLocal());
    const nowHM = `${pad(now.getHours())}:${pad(now.getMinutes())}`;
    const d = todayLocal();
    const h = holidayOn(todayISO, s);

    // 기념일 세기 (명언 위)
    const passed = Math.round((todayLocal() - parseDate(SINCE.date)) / 86400000);
    el.querySelector('[data-slot=since]').innerHTML = `<span class="since-label"><i aria-hidden="true">✦</i>${esc(SINCE.label)}<i aria-hidden="true">✦</i></span><strong>D+${passed.toLocaleString('ko-KR')}</strong>`;

    // 머리글
    el.querySelector('[data-slot=date]').textContent = `${d.getMonth() + 1}월 ${d.getDate()}일 ${WD[d.getDay()]}요일`;
    el.querySelector('[data-slot=chip]').innerHTML = h.kr
      ? `<span class="hol-chip">공휴일 · ${esc(h.kr)}</span>`
      : h.custom ? `<span class="hol-chip">휴일 · ${esc(h.custom)}</span>` : '';

    // 디데이
    const top = [...s.data.ddays]
      .filter((x) => !x.count_up && daysUntil(x.target_date) >= 0)
      .sort((a, b) => a.target_date.localeCompare(b.target_date))
      .slice(0, 3);
    el.querySelector('[data-slot=strip]').innerHTML = top
      .map((x) => {
        const n = daysUntil(x.target_date);
        return `<button class="dday-card ${n <= 7 ? 'is-near' : ''}" type="button" data-dday-date="${x.target_date}" aria-label="${esc(x.title)} ${ddayLabel(x)}, 캘린더에서 날짜 보기">
          <span class="dday-card-title">${esc(x.title)}</span>
          <span class="dday-card-ic">${ddayIcon(x.title)}</span>
          <span class="dday-card-count">${ddayLabel(x)}</span>
          <span class="dday-card-date">${fmtDate(x.target_date)}</span>
        </button>`;
      })
      .join('');

    // 알람
    const alarms = s.data.alarms.filter((a) => a.enabled).sort((a, b) => a.time.localeCompare(b.time));
    const todayRows = alarms
      .map((a) => ({ a, r: alarmOn(a, todayISO, s) }))
      .filter(({ r }) => r.reason !== 'not_today');
    const next = nextAlarm(alarms, s);
    let html;
    if (!s.data.alarms.length) {
      html = `<div class="home-empty muted">아직 알람이 없어요. <a href="#/alarm">알람 만들기</a></div>`;
    } else if (!alarms.length) {
      html = `<div class="home-empty muted">켜져 있는 알람이 없어요. <a href="#/alarm">알람 보기</a></div>`;
    } else {
      html = `
        <div class="next-alarm">
          <span class="muted small">다음 알람</span>
          ${next
            ? `<strong>${next.a.time.slice(0, 5)}</strong><span class="sub">${dayWord(next.iso, todayISO)} · ${esc(next.a.label)}</span>`
            : '<span class="sub">울릴 알람이 없어요</span>'}
        </div>
        <ul class="home-alarm-list">
          ${todayRows.length ? todayRows.map(({ a, r }) => {
            const time = a.time.slice(0, 5);
            let cls, text;
            if (!r.ring) {
              cls = 'skip';
              text = `${r.reason === 'holiday' ? '공휴일이라 쉼' : '휴일이라 쉼'}${r.name ? ` · ${esc(r.name)}` : ''}`;
            } else if (time < nowHM) {
              cls = 'past';
              text = '울림 완료';
            } else {
              cls = 'ring';
              text = '울림';
            }
            return `<li class="${cls === 'past' ? 'past' : ''}"><span class="ha-time">${time}</span><span class="ha-label">${esc(a.label)}</span><span class="ha-state ${cls}">${text}</span></li>`;
          }).join('') : '<li class="muted">오늘은 울릴 알람이 없어요.</li>'}
        </ul>`;
    }
    el.querySelector('[data-slot=alarms]').innerHTML = html;

    // 오늘 일정 (휴일 일정은 위 머리글에 표시되므로 제외)
    const evs = eventsOn(todayISO, s.data.events).filter((e) => !e.is_holiday);
    el.querySelector('[data-slot=events]').innerHTML = evs.length
      ? evs.map((ev) => {
          const ended = !ev.all_day && ev.ends_at && new Date(ev.ends_at) <= now;
          const ongoing = !ev.all_day && new Date(ev.starts_at) <= now && (!ev.ends_at || now < new Date(ev.ends_at));
          return `
          <li>
            <button class="card ev-row ${ended ? 'past' : ''} ${ongoing ? 'now' : ''}" data-go="day">
              <span class="ev-bar" style="background:${colorOf(ev.color).bar}"></span>
              <span class="ev-text">
                <span class="ev-time">${eventTime(ev)}</span>
                <span class="ev-title"><span>${esc(ev.title)}${ev.recurrence ? REPEAT_ICON : ''}</span>${ev.note ? `<span class="muted small ev-note">${esc(ev.note)}</span>` : ''}</span>
              </span>
            </button>
          </li>`;
        }).join('')
      : '<li class="empty muted">오늘 일정이 없어요.</li>';

    // 오늘 할 일
    const todos = s.data.todos
      .filter((t) => t.due_date === todayISO)
      .sort((a, b) => (a.done - b.done) || (a.sort - b.sort) || a.created_at.localeCompare(b.created_at));
    const done = todos.filter((t) => t.done).length;
    el.querySelector('[data-slot=todo-count]').textContent = todos.length ? `${done} / ${todos.length} 완료` : '';
    const shown = todos.slice(0, MAX_TODOS);
    el.querySelector('[data-slot=todos]').innerHTML = (shown.length
      ? shown.map((t) => `
          <li class="card todo ${t.done ? 'done' : ''}">
            <button class="todo-check" data-todo="${t.id}" aria-pressed="${t.done}" aria-label="${esc(t.title)} 완료">
              ${icons.check}
            </button>
            <span class="todo-title">${esc(t.title)}</span>
          </li>`).join('')
      : '<li class="empty muted">오늘 할 일이 없어요.</li>')
      + (todos.length > MAX_TODOS ? `<li><button class="btn block-link" data-go="day">할 일 ${todos.length - MAX_TODOS}개 더 보기</button></li>` : '');
  },
};
