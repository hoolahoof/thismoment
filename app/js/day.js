// 하루 타임블록: 이번 주 날짜 줄 + 시간대별 블록 + 현재 시각 선 + 그날 할 일.
// 블록을 길게 눌러(마우스는 그냥) 끌면 시간이 옮겨지고, 아래쪽 손잡이를 끌면 길이가 바뀐다 (15분 단위).
import * as store from './store.js';
import { holidayOn } from './holidays.js';
import { esc, toISODate, parseDate, todayLocal, icons } from './util.js';
import { eventsOn, eventTime, localISO } from './recur.js';
import { colorOf, REPEAT_ICON } from './colors.js';
import { getSelected, setSelected, eventDialogHTML, setupEventDialog } from './calendar.js';
import { findOccurrence, moveEvent } from './events.js';
import { spanIn, layout, minutesOf } from './timeline.js';

const WD = ['일', '월', '화', '수', '목', '금', '토'];
const HOUR_H = 52; // 1시간 높이(px)
const SNAP = 15; // 분
const HOLD_MS = 350;
const pad = (n) => String(n).padStart(2, '0');
const hhmm = (m) => `${pad(Math.floor(m / 60) % 24)}:${pad(m % 60)}`;

let nowTimer = null;

export const day = {
  mount(el) {
    el.innerHTML = `
      <a class="back-link" href="#/calendar">‹ 캘린더</a>
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
      <p class="muted small center cal-tip">일정을 길게 눌러 끌면 시간을 옮기고, 아래 손잡이를 끌면 길이를 바꿔요.</p>

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
    const timeline = el.querySelector('[data-slot=timeline]');

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

    // ── 블록 끌기 ──
    let drag = null;
    let suppressClick = false;
    const clamp = (v, lo, hi) => Math.min(Math.max(v, lo), hi);
    const offsetY = (clientY) => clientY - timeline.getBoundingClientRect().top;

    function applyDrag(clientY) {
      const dMin = Math.round(((offsetY(clientY) - drag.startOff) / HOUR_H) * 60 / SNAP) * SNAP;
      let s = drag.orig.start;
      let e = drag.orig.end;
      if (drag.mode === 'move') {
        const dur = e - s;
        s = clamp(s + dMin, 0, 1440 - dur);
        e = s + dur;
      } else {
        e = clamp(e + dMin, s + SNAP, 1440);
      }
      drag.cur = { start: s, end: e };
      const b = drag.block;
      b.style.top = `${(s / 60) * HOUR_H}px`;
      b.style.height = `${Math.max(((e - s) / 60) * HOUR_H - 2, 22)}px`;
      b.dataset.time = `${hhmm(s)} – ${e === 1440 ? '24:00' : hhmm(e)}`;
    }

    function stopDrag() {
      clearTimeout(drag?.timer);
      clearInterval(drag?.tick);
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onCancel);
      drag?.block.classList.remove('dragging');
      timeline.classList.remove('dragging-any');
      drag = null;
    }

    function activate() {
      if (!drag || drag.active) return;
      drag.active = true;
      drag.block.classList.add('dragging');
      timeline.classList.add('dragging-any');
      if (navigator.vibrate) navigator.vibrate(15);
      applyDrag(drag.lastY);
      // 화면 가장자리에서 끌면 자동으로 스크롤
      drag.tick = setInterval(() => {
        if (!drag) return;
        if (drag.lastY < 90) window.scrollBy(0, -12);
        else if (drag.lastY > window.innerHeight - 120) window.scrollBy(0, 12);
        applyDrag(drag.lastY);
      }, 30);
    }

    function onMove(e) {
      if (!drag) return;
      drag.lastY = e.clientY;
      if (!drag.active) {
        const moved = Math.hypot(e.clientX - drag.x0, e.clientY - drag.y0);
        if (drag.type === 'mouse') {
          if (moved > 4) activate();
        } else if (moved > 10) {
          // 길게 누르기 전에 움직이면 스크롤로 본다
          stopDrag();
        }
        return;
      }
      applyDrag(e.clientY);
    }

    async function onUp() {
      if (!drag) return;
      const d = drag;
      if (!d.active) return stopDrag();
      suppressClick = true;
      setTimeout(() => (suppressClick = false), 400);
      const changed = d.cur && (d.cur.start !== d.orig.start || d.cur.end !== d.orig.end);
      const { cur, occ } = d;
      stopDrag();
      if (!changed) return rerender();
      const dayStart = parseDate(getSelected());
      const at = (m) => new Date(dayStart.getFullYear(), dayStart.getMonth(), dayStart.getDate(), 0, m);
      try {
        const ok = await moveEvent(occ, at(cur.start), at(cur.end));
        if (!ok) rerender();
      } catch (err) {
        alert('저장하지 못했어요: ' + err.message);
        rerender();
      }
    }
    const onCancel = () => {
      if (drag?.active) rerender();
      stopDrag();
    };

    timeline.addEventListener('pointerdown', (e) => {
      const block = e.target.closest('.block');
      if (!block || drag) return;
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      const occ = findOccurrence(block.dataset.event, block.dataset.occ);
      if (!occ || !block.dataset.single) return; // 자정을 넘는 일정은 끌지 않고 눌러서 수정
      const isGrip = !!e.target.closest('.block-grip');
      const s = spanIn(occ, getSelected());
      drag = {
        block, occ, mode: isGrip ? 'resize' : 'move', type: e.pointerType, active: false,
        orig: { start: s.start, end: s.end }, cur: null,
        startOff: offsetY(e.clientY), x0: e.clientX, y0: e.clientY, lastY: e.clientY,
        timer: null, tick: null,
      };
      if (e.pointerType !== 'mouse') drag.timer = setTimeout(activate, HOLD_MS);
      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp);
      window.addEventListener('pointercancel', onCancel);
    });
    // 끄는 동안에는 화면이 스크롤되지 않게
    timeline.addEventListener('touchmove', (e) => { if (drag?.active) e.preventDefault(); }, { passive: false });
    timeline.addEventListener('contextmenu', (e) => { if (drag) e.preventDefault(); });

    // 빈 시간대를 누르면 그 시각(30분 단위)으로 일정 추가, 블록을 누르면 수정
    timeline.addEventListener('click', (e) => {
      if (suppressClick) { suppressClick = false; return; }
      const blk = e.target.closest('[data-event]');
      if (blk) {
        const ev = findOccurrence(blk.dataset.event, blk.dataset.occ);
        if (ev) dialog.open(ev);
        return;
      }
      const rect = timeline.getBoundingClientRect();
      const mins = Math.floor(((e.clientY - rect.top) / HOUR_H) * 2) * 30;
      const h = clamp(Math.floor(mins / 60), 0, 23);
      dialog.open(null, getSelected(), `${pad(h)}:${pad(mins % 60)}`);
    });
    el.querySelector('[data-slot=allday]').addEventListener('click', (e) => {
      const b = e.target.closest('[data-event]');
      const ev = b && findOccurrence(b.dataset.event, b.dataset.occ);
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
      window.scrollTo({ top: timeline.getBoundingClientRect().top + window.scrollY + h * HOUR_H - 120 });
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
      const hasEv = eventsOn(di, s.data.events).some((e) => !e.is_holiday);
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
    el.querySelector('[data-slot=allday]').innerHTML = evs
      .filter((ev) => ev.all_day)
      .map((ev) => `<button class="allday-chip" data-event="${ev.id}" data-occ="${ev._occ}" style="background:${colorOf(ev.color).bg}">${ev.is_holiday ? '휴일' : '하루 종일'} · ${esc(ev.title)}${ev.recurrence ? REPEAT_ICON : ''}</button>`)
      .join('');

    // 시간 블록
    const dayEnd = new Date(sel.getFullYear(), sel.getMonth(), sel.getDate() + 1);
    const items = layout(evs.filter((ev) => !ev.all_day).map((ev) => ({ ev, ...spanIn(ev, iso) })));
    el.querySelector('[data-slot=blocks]').innerHTML = items.map((it) => {
      const top = (it.start / 60) * HOUR_H;
      const height = Math.max(((it.end - it.start) / 60) * HOUR_H - 2, 22);
      const w = 100 / it.cols;
      const c = colorOf(it.ev.color);
      // 오늘 하루 안에서 시작하고 끝나는 일정만 끌 수 있다
      const single = localISO(it.ev.starts_at) === iso && (!it.ev.ends_at || new Date(it.ev.ends_at) <= dayEnd);
      return `
        <button class="block" data-event="${it.ev.id}" data-occ="${it.ev._occ}" ${single ? 'data-single="1"' : ''}
          style="top:${top}px;height:${height}px;left:calc(${it.col * w}% + 2px);width:calc(${w}% - 4px);background:${c.bg};border-left-color:${c.bar}">
          <span class="block-title">${esc(it.ev.title)}${it.ev.recurrence ? REPEAT_ICON : ''}</span>
          ${height >= 38 ? `<span class="block-time">${eventTime(it.ev)}</span>` : ''}
          ${single ? `<span class="block-grip${height < 40 ? ' small' : ''}" aria-hidden="true"></span>` : ''}
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
