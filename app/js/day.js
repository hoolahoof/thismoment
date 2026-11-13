// 하루 타임블록: 이번 주 날짜 줄 + 시간대별 블록 + 현재 시각 선 + 그날 할 일.
import * as store from './store.js';
import { holidayOn } from './holidays.js';
import { esc, toISODate, parseDate, todayLocal, icons } from './util.js';
import { COLORS, eventsOn, eventTime, getSelected, setSelected, eventDialogHTML, setupEventDialog } from './calendar.js';

const WD = ['일', '월', '화', '수', '목', '금', '토'];
const HOUR_H = 52; // 1시간 높이(px)
const pad = (n) => String(n).padStart(2, '0');
const colorOf = (c) => COLORS[c] ?? COLORS.blue;
const minutesOf = (d) => d.getHours() * 60 + d.getMinutes();

// 그날 안에서의 시작/끝 분 (자정을 넘는 일정은 그날 범위로 자른다)
function spanIn(ev, iso) {
  const day0 = parseDate(iso);
  const day1 = new Date(day0.getFullYear(), day0.getMonth(), day0.getDate() + 1);
  const s = new Date(ev.starts_at);
  const e = ev.ends_at ? new Date(ev.ends_at) : new Date(s.getTime() + 30 * 60000);
  const start = s < day0 ? 0 : minutesOf(s);
  const end = e >= day1 ? 1440 : minutesOf(e);
  return { start, end: Math.max(end, start + 15) };
}

// 겹치는 일정은 나란히 놓는다
function layout(items) {
  items.sort((a, b) => a.start - b.start || b.end - a.end);
  const out = [];
  let cluster = [];
  let clusterEnd = -1;
  const flush = () => {
    const cols = [];
    for (const it of cluster) {
      let c = cols.findIndex((end) => end <= it.start);
      if (c === -1) { c = cols.length; cols.push(0); }
      cols[c] = it.end;
      it.col = c;
    }
    cluster.forEach((it) => { it.cols = cols.length; out.push(it); });
    cluster = [];
  };
  for (const it of items) {
    if (cluster.length && it.start >= clusterEnd) flush();
    cluster.push(it);
    clusterEnd = Math.max(clusterEnd, it.end);
  }
  if (cluster.length) flush();
  return out;
}

let nowTimer = null;

export const day = {
  mount(el) {
    el.innerHTML = `
      <header class="page-head day-head">
        <div class="day-head-text">
          <span class="muted small" data-slot="ym"></span>
          <h1 data-slot="title"></h1>
        </div>
        <span class="muted small" data-slot="todo-count"></span>
      </header>
      <div class="week-nav">
        <button class="icon-btn" data-week="-1" aria-label="지난주"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M15 6l-6 6 6 6"/></svg></button>
        <div class="week-strip" data-slot="week"></div>
        <button class="icon-btn" data-week="1" aria-label="다음 주"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M9 6l6 6-6 6"/></svg></button>
      </div>
      <div class="allday" data-slot="allday"></div>
      <section class="card timeline-card">
        <div class="timeline" data-slot="timeline" style="height:${24 * HOUR_H}px">
          ${Array.from({ length: 24 }, (_, h) => `
            <div class="hour" style="top:${h * HOUR_H}px"><span>${pad(h)}:00</span></div>`).join('')}
          <div class="blocks" data-slot="blocks"></div>
          <div class="now-line" data-slot="now" hidden><span></span></div>
        </div>
      </section>

      <h2 class="section-title">할 일</h2>
      <form class="card todo-add" data-slot="todo-form">
        <input name="title" maxlength="80" placeholder="할 일 추가" aria-label="할 일 추가" autocomplete="off">
        <button class="icon-btn" type="submit" aria-label="할 일 추가">${icons.plus}</button>
      </form>
      <ul class="list" data-slot="todos"></ul>

      <button class="fab" data-action="add" aria-label="일정 추가">${icons.plus}</button>
      ${eventDialogHTML()}`;

    const rerender = () => day.update(el, store.getState());
    const dialog = setupEventDialog(el);

    el.querySelectorAll('[data-week]').forEach((b) =>
      b.addEventListener('click', () => {
        const d = parseDate(getSelected());
        d.setDate(d.getDate() + 7 * Number(b.dataset.week));
        setSelected(toISODate(d));
        rerender();
      })
    );
    el.querySelector('[data-slot=week]').addEventListener('click', (e) => {
      const b = e.target.closest('[data-date]');
      if (!b) return;
      setSelected(b.dataset.date);
      rerender();
    });

    // 빈 시간대를 누르면 그 시각(30분 단위)으로 일정 추가
    el.querySelector('[data-slot=timeline]').addEventListener('click', (e) => {
      const blk = e.target.closest('[data-event]');
      if (blk) {
        const ev = store.getState().data.events.find((x) => x.id === blk.dataset.event);
        if (ev) dialog.open(ev);
        return;
      }
      const rect = e.currentTarget.getBoundingClientRect();
      const mins = Math.floor(((e.clientY - rect.top) / HOUR_H) * 2) * 30;
      const h = Math.min(Math.max(Math.floor(mins / 60), 0), 23);
      dialog.open(null, getSelected(), `${pad(h)}:${pad(mins % 60)}`);
    });
    el.querySelector('[data-slot=allday]').addEventListener('click', (e) => {
      const b = e.target.closest('[data-event]');
      const ev = b && store.getState().data.events.find((x) => x.id === b.dataset.event);
      if (ev) dialog.open(ev);
    });
    el.querySelector('[data-action=add]').addEventListener('click', () => dialog.open(null, getSelected()));

    // 할 일
    const todoForm = el.querySelector('[data-slot=todo-form]');
    todoForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const input = todoForm.elements.namedItem('title');
      const title = input.value.trim();
      if (!title) return;
      try {
        const sameDay = store.getState().data.todos.filter((t) => t.due_date === getSelected());
        await store.insert('todos', { title, due_date: getSelected(), sort: sameDay.length });
        input.value = '';
      } catch (err) {
        alert('저장하지 못했어요: ' + err.message);
      }
    });
    el.querySelector('[data-slot=todos]').addEventListener('click', async (e) => {
      const b = e.target.closest('[data-todo]');
      if (!b) return;
      const t = store.getState().data.todos.find((x) => x.id === b.dataset.todo);
      if (!t) return;
      try {
        if (b.dataset.action === 'toggle') await store.update('todos', t.id, { done: !t.done });
        else if (b.dataset.action === 'delete') await store.remove('todos', t.id);
      } catch (err) {
        alert('저장하지 못했어요: ' + err.message);
      }
    });

    // 현재 시각 선은 1분마다 움직인다
    clearInterval(nowTimer);
    nowTimer = setInterval(() => {
      if (!el.isConnected) return clearInterval(nowTimer);
      placeNow(el);
    }, 60000);

    // 처음 열 때 지금 시각(오늘이 아니면 오전 8시) 근처로 스크롤
    requestAnimationFrame(() => {
      const isToday = getSelected() === toISODate(todayLocal());
      const h = isToday ? Math.max(new Date().getHours() - 1, 0) : 8;
      const tl = el.querySelector('[data-slot=timeline]');
      window.scrollTo({ top: tl.getBoundingClientRect().top + window.scrollY + h * HOUR_H - 120 });
    });
  },

  update(el, s) {
    const iso = getSelected();
    const sel = parseDate(iso);
    const todayISO = toISODate(todayLocal());
    const h = holidayOn(iso, s);
    const hol = h.kr || h.custom;

    el.querySelector('[data-slot=ym]').textContent = `${sel.getFullYear()}년 ${sel.getMonth() + 1}월${hol ? ` · ${hol}` : ''}`;
    const title = el.querySelector('[data-slot=title]');
    title.textContent = `${sel.getDate()}일 ${WD[sel.getDay()]}요일${iso === todayISO ? ' · 오늘' : ''}`;
    title.classList.toggle('red', !!hol || sel.getDay() === 0);

    // 이번 주
    const sun = new Date(sel.getFullYear(), sel.getMonth(), sel.getDate() - sel.getDay());
    el.querySelector('[data-slot=week]').innerHTML = Array.from({ length: 7 }, (_, i) => {
      const d = new Date(sun.getFullYear(), sun.getMonth(), sun.getDate() + i);
      const di = toISODate(d);
      const dh = holidayOn(di, s);
      const red = dh.kr || dh.custom || i === 0;
      const hasEv = eventsOn(di, s.data.events).length > 0;
      return `
        <button class="wday ${di === iso ? 'sel' : ''} ${di === todayISO ? 'is-today' : ''} ${red ? 'red' : i === 6 ? 'blue' : ''}"
          data-date="${di}" aria-pressed="${di === iso}" aria-label="${d.getMonth() + 1}월 ${d.getDate()}일 ${WD[i]}요일">
          <span class="wday-w">${WD[i]}</span>
          <span class="wday-n">${d.getDate()}</span>
          <span class="wday-dot ${hasEv ? 'on' : ''}"></span>
        </button>`;
    }).join('');

    // 하루 종일 일정
    const evs = eventsOn(iso, s.data.events);
    const allDay = evs.filter((ev) => ev.all_day);
    el.querySelector('[data-slot=allday]').innerHTML = allDay
      .map((ev) => `<button class="allday-chip" data-event="${ev.id}" style="background:${colorOf(ev.color).bg}">하루 종일 · ${esc(ev.title)}</button>`)
      .join('');

    // 시간 블록
    const items = layout(evs.filter((ev) => !ev.all_day).map((ev) => ({ ev, ...spanIn(ev, iso) })));
    el.querySelector('[data-slot=blocks]').innerHTML = items.map((it) => {
      const top = (it.start / 60) * HOUR_H;
      const height = Math.max(((it.end - it.start) / 60) * HOUR_H - 2, 22);
      const w = 100 / it.cols;
      const c = colorOf(it.ev.color);
      return `
        <button class="block" data-event="${it.ev.id}"
          style="top:${top}px;height:${height}px;left:calc(${it.col * w}% + 2px);width:calc(${w}% - 4px);background:${c.bg};border-left-color:${c.bar}">
          <span class="block-title">${esc(it.ev.title)}</span>
          ${height >= 38 ? `<span class="block-time">${eventTime(it.ev)}</span>` : ''}
        </button>`;
    }).join('');

    placeNow(el);

    // 할 일
    const todos = s.data.todos
      .filter((t) => t.due_date === iso)
      .sort((a, b) => (a.done - b.done) || (a.sort - b.sort) || a.created_at.localeCompare(b.created_at));
    const done = todos.filter((t) => t.done).length;
    el.querySelector('[data-slot=todo-count]').textContent = todos.length ? `할 일 ${done} / ${todos.length} 완료` : '';
    el.querySelector('[data-slot=todos]').innerHTML = todos.length
      ? todos.map((t) => `
          <li class="card todo ${t.done ? 'done' : ''}">
            <button class="todo-check" data-todo="${t.id}" data-action="toggle" aria-pressed="${t.done}" aria-label="${esc(t.title)} 완료">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>
            </button>
            <span class="todo-title">${esc(t.title)}</span>
            <button class="icon-btn" data-todo="${t.id}" data-action="delete" aria-label="${esc(t.title)} 삭제">${icons.trash}</button>
          </li>`).join('')
      : '<li class="empty muted">이 날 할 일이 없어요.</li>';
  },
};

function placeNow(el) {
  const line = el.querySelector('[data-slot=now]');
  if (!line) return;
  const isToday = getSelected() === toISODate(todayLocal());
  line.hidden = !isToday;
  if (isToday) line.style.top = `${(minutesOf(new Date()) / 60) * HOUR_H}px`;
}
