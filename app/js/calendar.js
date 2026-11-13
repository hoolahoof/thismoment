// 월간 캘린더: 달력 + 공휴일 표시 + 일정 칩, 날짜를 누르면 아래에 그날 일정, + 로 일정 추가/수정.
import * as store from './store.js';
import { holidayOn } from './holidays.js';
import { esc, toISODate, parseDate, todayLocal, ddayLabel, daysUntil, icons } from './util.js';
import { localISO, eventsOn, parseRule, sameRule, describeRule, hm, eventTime, daysBetween, addDays } from './recur.js';
import { COLORS, colorOf, REPEAT_ICON } from './colors.js';
import { weekView, weekTitle } from './week.js';
import { setupSearch, searchDialogHTML, searchIcon } from './search.js';
import { applyEdit, createEvent, deleteEvent, askScope, scopeOptions, findOccurrence, moveEvent } from './events.js';

const WD = ['일', '월', '화', '수', '목', '금', '토'];
const pad = (n) => String(n).padStart(2, '0');
export { COLORS, REPEAT_ICON };

// ── 일정 날짜 계산 (반복 일정 포함: recur.js) ──
export { localISO, eventsOn };
export { hm, eventTime, findOccurrence };

const dayLabel = (iso) => {
  const d = parseDate(iso);
  return `${d.getMonth() + 1}월 ${d.getDate()}일 (${WD[d.getDay()]})`;
};

// ── 화면 상태 (탭을 옮겨도 유지) ──
const today = todayLocal();
let viewY = today.getFullYear();
let viewM = today.getMonth();
let selected = toISODate(today);
let mode = 'month'; // 'month' | 'week'
// 하루 화면과 선택 날짜를 같이 쓴다
export const getSelected = () => selected;
export function setSelected(iso) {
  selected = iso;
  const d = parseDate(iso);
  viewY = d.getFullYear();
  viewM = d.getMonth();
}

function shiftMonth(delta) {
  const d = new Date(viewY, viewM + delta, 1);
  viewY = d.getFullYear();
  viewM = d.getMonth();
}

export const calendar = {
  mount(el) {
    el.innerHTML = `
      <header class="page-head cal-head">
        <div class="cal-nav">
          <button class="icon-btn" data-nav="-1" aria-label="이전 달"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M15 6l-6 6 6 6"/></svg></button>
          <h1 data-slot="title"></h1>
          <button class="icon-btn" data-nav="1" aria-label="다음 달"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M9 6l6 6-6 6"/></svg></button>
        </div>
        <div class="cal-tools">
          <button class="icon-btn" data-action="search" aria-label="일정 검색">${searchIcon}</button>
          <button class="btn pill" data-nav="today">오늘</button>
        </div>
      </header>
      <div class="segmented mode-toggle" role="tablist" aria-label="보기 방식">
        <button role="tab" data-mode="month" aria-selected="true">월간</button>
        <button role="tab" data-mode="week" aria-selected="false">주간</button>
      </div>
      <div class="dday-strip" data-slot="strip"></div>
      <section class="card cal" data-slot="cal">
        <div class="cal-week">${WD.map((w, i) => `<span class="${i === 0 ? 'red' : i === 6 ? 'blue' : ''}">${w}</span>`).join('')}</div>
        <div class="cal-grid" data-slot="grid" role="grid"></div>
      </section>
      <section class="card wk-card" data-slot="week-view" hidden></section>
      <section class="day-panel" data-slot="day-panel">
        <div class="day-panel-head">
          <h2 data-slot="day-title"></h2><span data-slot="day-hol" class="red small"></span>
          <span class="grow"></span>
          <a class="btn pill" href="#/day" data-action="to-day">시간표 보기</a>
        </div>
        <ul class="list" data-slot="day-list"></ul>
      </section>
      <p class="muted small center cal-tip" data-slot="tip">날짜를 길게 누른 채 끌면 여러 날 일정을 만들고, 일정을 길게 눌러 끌면 다른 날로 옮겨요. 휴일은 일정 추가 창의 ‘휴일’ 버튼으로 만들어요.</p>
      <button class="fab" data-action="add" aria-label="일정 추가">${icons.plus}</button>
      ${eventDialogHTML()}
      ${searchDialogHTML()}`;

    const rerender = () => calendar.update(el, store.getState());
    let suppressClick = false;

    const shift = (delta) => {
      if (mode === 'week') setSelected(addDays(selected, 7 * delta));
      else shiftMonth(delta);
      rerender();
    };
    el.querySelectorAll('[data-nav]').forEach((b) =>
      b.addEventListener('click', () => {
        const v = b.dataset.nav;
        if (v === 'today') {
          viewY = today.getFullYear();
          viewM = today.getMonth();
          selected = toISODate(today);
          rerender();
        } else shift(Number(v));
      })
    );
    el.querySelectorAll('[data-mode]').forEach((b) =>
      b.addEventListener('click', () => {
        if (mode === b.dataset.mode) return;
        mode = b.dataset.mode;
        rerender();
        if (mode === 'week') requestAnimationFrame(() => weekView.scrollToMorning(el.querySelector('[data-slot=week-view]')));
      })
    );

    el.querySelector('[data-slot=grid]').addEventListener('click', (e) => {
      if (suppressClick) { suppressClick = false; return; }
      const c = e.target.closest('[data-date]');
      if (!c) return;
      const iso = c.dataset.date;
      const d = parseDate(iso);
      if (d.getMonth() !== viewM) {
        viewY = d.getFullYear();
        viewM = d.getMonth();
      }
      selected = iso;
      rerender();
    });

    const range = { active: false, start: null, end: null, timer: null, x: 0, y: 0, type: '', chip: null };

    // 좌우로 밀어서 달(주간은 주) 넘기기
    let x0 = null, y0 = null;
    for (const area of [el.querySelector('[data-slot=cal]'), el.querySelector('[data-slot=week-view]')]) {
      area.addEventListener('touchstart', (e) => { x0 = e.touches[0].clientX; y0 = e.touches[0].clientY; }, { passive: true });
      area.addEventListener('touchend', (e) => {
        if (x0 === null || range.active) { x0 = null; return; }
        const dx = e.changedTouches[0].clientX - x0;
        const dy = e.changedTouches[0].clientY - y0;
        x0 = null;
        if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy) * 1.5) shift(dx < 0 ? 1 : -1);
      });
    }

    const dialog = setupEventDialog(el);

    // 검색 / 주간 보기
    const search = setupSearch(el, {
      onPick: (iso) => {
        setSelected(iso);
        rerender();
        window.scrollTo({ top: 0 });
      },
    });
    el.querySelector('[data-action=search]').addEventListener('click', () => search.open());
    el._weekCtx = {
      getSelected: () => selected,
      setSelected,
      open: (ev, dateISO, startHM) => dialog.open(ev, dateISO, startHM),
      goDay: () => { location.hash = '#/day'; },
    };
    weekView.mount(el.querySelector('[data-slot=week-view]'), el._weekCtx);
    el.querySelector('[data-action=add]').addEventListener('click', () => dialog.open(null, selected));

    // ── 여러 날 끌어서 고르기 ──
    // 손가락: 0.35초 길게 누른 뒤 끌기 (그냥 밀면 달 넘기기/스크롤). 마우스: 누른 채 다른 날로 끌기.
    const grid = el.querySelector('[data-slot=grid]');
    const cellAt = (x, y) => document.elementFromPoint(x, y)?.closest('[data-date]');
    let ghost = null;
    const paint = () => {
      const [a, b] = [range.start, range.end].sort();
      grid.querySelectorAll('[data-date]').forEach((c) => {
        const iso = c.dataset.date;
        c.classList.toggle('in-range', range.active && !range.chip && iso >= a && iso <= b);
        c.classList.toggle('drop-target', range.active && !!range.chip && iso === range.end);
      });
    };
    const begin = () => {
      range.active = true;
      grid.classList.add('ranging');
      if (navigator.vibrate) navigator.vibrate(15);
      if (range.chip) {
        ghost = document.createElement('div');
        ghost.className = 'drag-ghost';
        ghost.textContent = range.chip.title;
        ghost.style.background = range.chip.bg;
        document.body.appendChild(ghost);
        moveGhost(range.x, range.y);
      }
      paint();
    };
    const moveGhost = (x, y) => {
      if (ghost) ghost.style.transform = `translate(${x + 12}px, ${y - 36}px)`;
    };
    const reset = () => {
      clearTimeout(range.timer);
      range.active = false;
      range.start = range.end = null;
      range.chip = null;
      ghost?.remove();
      ghost = null;
      grid.classList.remove('ranging');
      paint();
    };
    grid.addEventListener('pointerdown', (e) => {
      const c = e.target.closest('[data-date]');
      if (!c) return;
      range.start = range.end = c.dataset.date;
      range.x = e.clientX; range.y = e.clientY; range.type = e.pointerType;
      const chip = e.target.closest('.chip-ev');
      range.chip = chip
        ? { id: chip.dataset.event, occ: chip.dataset.occ, title: chip.textContent, bg: chip.style.background }
        : null;
      clearTimeout(range.timer);
      if (e.pointerType !== 'mouse') range.timer = setTimeout(begin, 350);
    });
    grid.addEventListener('pointermove', (e) => {
      if (!range.start) return;
      if (!range.active) {
        if (range.type === 'mouse') {
          const c = cellAt(e.clientX, e.clientY);
          if (e.buttons === 1 && c && c.dataset.date !== range.start) begin();
          else return;
        } else {
          if (Math.hypot(e.clientX - range.x, e.clientY - range.y) > 10) { clearTimeout(range.timer); range.start = null; }
          return;
        }
      }
      moveGhost(e.clientX, e.clientY);
      const c = cellAt(e.clientX, e.clientY);
      if (c && c.dataset.date !== range.end) { range.end = c.dataset.date; paint(); }
    });
    // 길게 누른 뒤 끄는 동안에는 화면이 스크롤되지 않게
    grid.addEventListener('touchmove', (e) => { if (range.active) e.preventDefault(); }, { passive: false });
    grid.addEventListener('pointerup', () => {
      clearTimeout(range.timer);
      if (!range.active) { range.start = null; return; }
      const [a, b] = [range.start, range.end].sort();
      const chip = range.chip;
      const grab = range.start;
      const target = range.end;
      suppressClick = true;
      setTimeout(() => (suppressClick = false), 400);
      reset();
      if (chip) {
        if (target && target !== grab) moveToDate(chip, grab, target);
      } else dialog.open(null, a, null, { allDay: true, endISO: b });
    });

    // 칩을 끌어 놓은 날로 일정 옮기기 (시간은 그대로, 여러 날 일정은 같이 밀림)
    async function moveToDate(chip, grabISO, targetISO) {
      const occ = findOccurrence(chip.id, chip.occ);
      if (!occ) return;
      const delta = daysBetween(grabISO, targetISO);
      const s = new Date(occ.starts_at);
      const e2 = new Date(occ.ends_at ?? occ.starts_at);
      const ns = new Date(s.getFullYear(), s.getMonth(), s.getDate() + delta, s.getHours(), s.getMinutes());
      const ne = new Date(ns.getTime() + (e2 - s));
      try {
        if (await moveEvent(occ, ns, ne)) {
          selected = targetISO;
          rerender();
        }
      } catch (err) {
        alert('옮기지 못했어요: ' + err.message);
      }
    }
    grid.addEventListener('pointercancel', reset);
    grid.addEventListener('contextmenu', (e) => { if (range.start) e.preventDefault(); });

    el.querySelector('[data-slot=day-list]').addEventListener('click', (e) => {
      const b = e.target.closest('[data-event]');
      if (!b) return;
      const ev = findOccurrence(b.dataset.event, b.dataset.occ);
      if (ev) dialog.open(ev);
    });
  },

  update(el, s) {
    const weekMode = mode === 'week';
    el.querySelector('[data-slot=title]').textContent = weekMode ? weekTitle(selected) : `${viewY}년 ${viewM + 1}월`;
    el.querySelectorAll('[data-mode]').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.mode === mode)));
    el.querySelector('[data-nav="-1"]').setAttribute('aria-label', weekMode ? '지난주' : '이전 달');
    el.querySelector('[data-nav="1"]').setAttribute('aria-label', weekMode ? '다음 주' : '다음 달');
    el.querySelector('[data-slot=cal]').hidden = weekMode;
    el.querySelector('[data-slot=day-panel]').hidden = weekMode;
    el.querySelector('[data-slot=tip]').hidden = weekMode;
    el.querySelector('[data-slot=week-view]').hidden = !weekMode;

    // 디데이 띠
    const top = [...s.data.ddays]
      .filter((d) => !d.count_up && daysUntil(d.target_date) >= 0)
      .sort((a, b) => a.target_date.localeCompare(b.target_date))
      .slice(0, 3);
    el.querySelector('[data-slot=strip]').innerHTML = top
      .map((d) => `<a class="mini-card" href="#/dday"><span class="muted">${esc(d.title)}</span><strong class="${daysUntil(d.target_date) <= 7 ? 'red' : ''}">${ddayLabel(d)}</strong></a>`)
      .join('');

    // 달력 칸
    const first = new Date(viewY, viewM, 1);
    const daysInMonth = new Date(viewY, viewM + 1, 0).getDate();
    const weeks = Math.ceil((first.getDay() + daysInMonth) / 7);
    const start = new Date(viewY, viewM, 1 - first.getDay());
    const todayISO = toISODate(today);
    const cells = [];
    for (let i = 0; i < weeks * 7; i++) {
      const d = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i);
      const iso = toISODate(d);
      const dow = d.getDay();
      const h = holidayOn(iso, s);
      const hol = h.kr || h.custom;
      const evs = eventsOn(iso, s.data.events).filter((e) => !e.is_holiday);
      const other = d.getMonth() !== viewM;
      const cls = [
        'cal-cell',
        other ? 'other' : '',
        iso === todayISO ? 'today' : '',
        iso === selected ? 'selected' : '',
        hol || dow === 0 ? 'red' : dow === 6 ? 'blue' : '',
      ].join(' ');
      const maxChips = hol ? 1 : 2;
      const chips = evs.slice(0, maxChips)
        .map((ev) => `<span class="chip-ev" data-event="${ev.id}" data-occ="${ev._occ}" style="background:${colorOf(ev.color).bg}">${esc(ev.title)}</span>`)
        .join('');
      const more = evs.length > maxChips ? `<span class="chip-more">+${evs.length - maxChips}</span>` : '';
      const label = `${d.getMonth() + 1}월 ${d.getDate()}일${hol ? `, ${hol}` : ''}${evs.length ? `, 일정 ${evs.length}개` : ''}`;
      cells.push(`
        <button class="${cls}" data-date="${iso}" aria-label="${esc(label)}" aria-pressed="${iso === selected}">
          <span class="cal-num">${d.getDate()}</span>
          ${hol ? `<span class="cal-hol">${esc(hol)}</span>` : ''}
          ${chips}${more}
        </button>`);
    }
    el.querySelector('[data-slot=grid]').innerHTML = cells.join('');
    if (weekMode && el._weekCtx) weekView.update(el.querySelector('[data-slot=week-view]'), s, el._weekCtx);

    // 선택한 날
    const h = holidayOn(selected, s);
    el.querySelector('[data-slot=day-title]').textContent = selected === todayISO ? `오늘 · ${dayLabel(selected)}` : dayLabel(selected);
    el.querySelector('[data-slot=day-hol]').textContent = [h.kr, h.custom].filter(Boolean).join(' · ');
    const list = eventsOn(selected, s.data.events);
    el.querySelector('[data-slot=day-list]').innerHTML = list.length
      ? list.map((ev) => `
          <li>
            <button class="card ev-row" data-event="${ev.id}" data-occ="${ev._occ}">
              <span class="ev-bar" style="background:${colorOf(ev.color).bar}"></span>
              <span class="ev-text">
                <span class="ev-time">${eventTime(ev)}</span>
                <span class="ev-title"><span>${esc(ev.title)}${ev.is_holiday ? '<span class="hol-badge">휴일</span>' : ''}${ev.recurrence ? REPEAT_ICON : ''}</span>${ev.note ? `<span class="muted small ev-note">${esc(ev.note)}</span>` : ''}</span>
              </span>
            </button>
          </li>`).join('')
      : '<li class="empty muted">일정이 없어요. 오른쪽 아래 + 로 추가하세요.</li>';
  },
};

// ── 일정 추가/수정 창 (하루·주간 화면에서도 같이 씀) ──
export function eventDialogHTML() {
  return `
  <dialog class="sheet" data-slot="ev-dialog" aria-labelledby="ev-dialog-title">
    <form method="dialog" class="form" novalidate>
      <h2 id="ev-dialog-title" data-slot="ev-dialog-title">일정 추가</h2>
      <label>제목<input name="title" maxlength="60" required placeholder="예: 팀 회의" autocomplete="off"></label>
      <div class="check-row">
        <label class="check"><input type="checkbox" name="all_day"> 하루 종일</label>
        <button type="button" class="holiday-toggle" data-action="holiday" aria-pressed="false">휴일</button>
      </div>
      <p class="muted small" data-when="holiday-hint" hidden>달력에서 빨간 날로 보이고, ‘휴일엔 안 울림’으로 정한 알람은 울리지 않아요.</p>
      <div class="form-row">
        <label class="grow">날짜<input type="date" name="date" required></label>
        <label class="grow" data-when="allday">끝나는 날<input type="date" name="end_date"></label>
      </div>
      <div class="form-row" data-when="timed">
        <label class="grow">시작<input type="time" name="start" value="09:00"></label>
        <label class="grow">끝<input type="time" name="end" value="10:00"></label>
      </div>
      <label>반복
        <select name="repeat">
          <option value="">안 함</option>
          <option value="DAILY">매일</option>
          <option value="WEEKLY">매주</option>
          <option value="MONTHLY">매달</option>
          <option value="YEARLY">매년</option>
        </select>
      </label>
      <div class="repeat-box" data-when="repeat" hidden>
        <div class="form-row">
          <label class="grow"><span data-slot="interval-label">간격</span><input type="number" name="interval" min="1" max="99" value="1" inputmode="numeric"></label>
          <label class="grow">반복 끝나는 날 (비우면 계속)<input type="date" name="until"></label>
        </div>
        <fieldset class="days" data-when="weekly" hidden>
          <legend>반복 요일</legend>
          <div class="day-chips" data-slot="rdays">${WD.map((w, i) => `<button type="button" class="chip" data-rday="${i}" aria-pressed="false">${w}</button>`).join('')}</div>
        </fieldset>
        <p class="repeat-summary" data-slot="repeat-summary"></p>
      </div>
      <fieldset class="days" data-when="color">
        <legend>색</legend>
        <div class="swatches">
          ${Object.entries(COLORS).map(([k, c]) => `
            <label class="swatch" style="--sw:${c.bar}">
              <input type="radio" name="color" value="${k}" aria-label="${c.name}"><span></span>
            </label>`).join('')}
        </div>
      </fieldset>
      <label>메모<input name="note" maxlength="200" autocomplete="off"></label>
      <p class="form-msg" role="status"></p>
      <div class="sheet-actions">
        <button class="btn danger" type="button" data-action="delete" hidden>삭제</button>
        <span class="grow"></span>
        <button class="btn" type="button" data-action="cancel">취소</button>
        <button class="btn primary" type="submit" value="save">저장</button>
      </div>
    </form>
  </dialog>`;
}

const UNIT = { DAILY: '일마다', WEEKLY: '주마다', MONTHLY: '개월마다', YEARLY: '년마다' };

export function setupEventDialog(root) {
  const dlg = root.querySelector('[data-slot=ev-dialog]');
  const form = dlg.querySelector('form');
  const f = form.elements;
  const msg = form.querySelector('.form-msg');
  const chips = () => [...form.querySelectorAll('[data-rday]')];
  let editing = null;

  const holBtn = form.querySelector('[data-action=holiday]');
  const isHoliday = () => holBtn.getAttribute('aria-pressed') === 'true';

  const syncAllDay = () => {
    const all = f.namedItem('all_day').checked;
    form.querySelectorAll('[data-when=allday]').forEach((n) => (n.hidden = !all));
    form.querySelectorAll('[data-when=timed]').forEach((n) => (n.hidden = all));
  };
  f.namedItem('all_day').addEventListener('change', syncAllDay);

  // 휴일: 하루 종일 일정 + 빨간 날. 반복은 '안 함'과 '매년'만, 색은 빨강으로 고정
  function syncHoliday() {
    const on = isHoliday();
    if (on) f.namedItem('all_day').checked = true;
    f.namedItem('all_day').disabled = on;
    form.querySelector('[data-when=holiday-hint]').hidden = !on;
    form.querySelector('[data-when=color]').hidden = on;
    for (const o of f.namedItem('repeat').options) o.disabled = on && ['DAILY', 'WEEKLY', 'MONTHLY'].includes(o.value);
    if (on && ['DAILY', 'WEEKLY', 'MONTHLY'].includes(f.namedItem('repeat').value)) f.namedItem('repeat').value = '';
    f.namedItem('title').placeholder = on ? '예: 여름휴가, 창립기념일' : '예: 팀 회의';
    syncAllDay();
  }
  holBtn.addEventListener('click', () => {
    holBtn.setAttribute('aria-pressed', String(!isHoliday()));
    syncHoliday();
    syncRepeat();
  });

  // 지금 입력된 반복 설정을 규칙으로 (안 함이면 null)
  function readRule() {
    const freq = f.namedItem('repeat').value;
    if (!freq) return null;
    const interval = Math.min(Math.max(parseInt(f.namedItem('interval').value, 10) || 1, 1), 99);
    let days = [];
    if (freq === 'WEEKLY') {
      days = chips().filter((c) => c.getAttribute('aria-pressed') === 'true').map((c) => Number(c.dataset.rday));
      if (!days.length && f.namedItem('date').value) days = [parseDate(f.namedItem('date').value).getDay()];
    }
    return { freq, interval, days, until: f.namedItem('until').value || null, ex: [] };
  }

  function syncRepeat() {
    const freq = f.namedItem('repeat').value;
    form.querySelector('[data-when=repeat]').hidden = !freq;
    form.querySelector('[data-when=weekly]').hidden = freq !== 'WEEKLY';
    if (freq) form.querySelector('[data-slot=interval-label]').textContent = `간격 (${UNIT[freq]})`;
    if (freq === 'WEEKLY' && !chips().some((c) => c.getAttribute('aria-pressed') === 'true') && f.namedItem('date').value) {
      const d = parseDate(f.namedItem('date').value).getDay();
      chips().forEach((c) => c.setAttribute('aria-pressed', String(Number(c.dataset.rday) === d)));
    }
    form.querySelector('[data-slot=repeat-summary]').textContent = freq ? `${describeRule(readRule())} 반복` : '';
  }
  f.namedItem('repeat').addEventListener('change', syncRepeat);
  f.namedItem('interval').addEventListener('input', syncRepeat);
  f.namedItem('until').addEventListener('change', syncRepeat);
  form.querySelector('[data-slot=rdays]').addEventListener('click', (e) => {
    const b = e.target.closest('[data-rday]');
    if (!b) return;
    b.setAttribute('aria-pressed', String(b.getAttribute('aria-pressed') !== 'true'));
    syncRepeat();
  });

  function open(ev, dateISO, startHM, opts = {}) {
    editing = ev;
    msg.textContent = '';
    msg.classList.remove('error');
    dlg.querySelector('[data-slot=ev-dialog-title]').textContent = ev ? '일정 수정' : '일정 추가';
    dlg.querySelector('[data-action=delete]').hidden = !ev;
    f.namedItem('title').value = ev?.title ?? '';
    f.namedItem('all_day').checked = ev?.all_day ?? !!opts.allDay;
    f.namedItem('date').value = ev ? localISO(ev.starts_at) : dateISO;
    f.namedItem('end_date').value = ev?.all_day && ev.ends_at
      ? localISO(ev.ends_at)
      : opts.endISO && opts.endISO !== dateISO ? opts.endISO : '';
    if (ev && !ev.all_day) {
      f.namedItem('start').value = hm(ev.starts_at);
      f.namedItem('end').value = ev.ends_at ? hm(ev.ends_at) : hm(ev.starts_at);
    } else if (!ev) {
      const startH = startHM ? Number(startHM.slice(0, 2)) : Math.min(new Date().getHours() + 1, 22);
      const startM = startHM ? startHM.slice(3, 5) : '00';
      f.namedItem('start').value = `${pad(startH)}:${startM}`;
      f.namedItem('end').value = `${pad(Math.min(startH + 1, 23))}:${startH >= 23 ? '59' : startM}`;
    }
    holBtn.setAttribute('aria-pressed', String(!!(ev ? ev.is_holiday : opts.holiday)));
    const rule = ev ? parseRule(ev.recurrence) : null;
    f.namedItem('repeat').value = rule?.freq ?? '';
    f.namedItem('interval').value = rule?.interval ?? 1;
    f.namedItem('until').value = rule?.until ?? '';
    chips().forEach((c) => c.setAttribute('aria-pressed', String(!!rule?.days.includes(Number(c.dataset.rday)))));
    const color = ev?.color ?? 'blue';
    form.querySelectorAll('input[name=color]').forEach((r) => (r.checked = r.value === color));
    f.namedItem('note').value = ev?.note ?? '';
    syncAllDay();
    syncHoliday();
    syncRepeat();
    dlg.showModal();
  }

  const fail = (t) => {
    msg.textContent = t;
    msg.classList.add('error');
  };

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const holiday = isHoliday();
    const title = f.namedItem('title').value.trim() || (holiday ? '휴일' : '');
    const date = f.namedItem('date').value;
    if (!title) return fail('제목을 입력해 주세요.');
    if (!date) return fail('날짜를 골라주세요.');
    const allDay = holiday || f.namedItem('all_day').checked;
    let starts, ends;
    if (allDay) {
      const endDate = f.namedItem('end_date').value || date;
      if (endDate < date) return fail('끝나는 날이 시작보다 빠를 수 없어요.');
      starts = new Date(`${date}T00:00`);
      ends = new Date(`${endDate}T00:00`);
    } else {
      const st = f.namedItem('start').value;
      const en = f.namedItem('end').value;
      if (!st || !en) return fail('시작과 끝 시간을 정해주세요.');
      if (en <= st) return fail('끝 시간이 시작보다 늦어야 해요.');
      starts = new Date(`${date}T${st}`);
      ends = new Date(`${date}T${en}`);
    }
    const rule = readRule();
    if (rule?.until && rule.until < date) return fail('반복 끝나는 날이 시작보다 빠를 수 없어요.');
    const fields = {
      title,
      all_day: allDay,
      color: holiday ? 'red' : form.querySelector('input[name=color]:checked')?.value ?? 'blue',
      note: f.namedItem('note').value.trim() || null,
      is_holiday: holiday,
    };
    try {
      if (editing) {
        const oldRule = parseRule(editing.recurrence);
        const opts = scopeOptions(editing, !sameRule(rule, oldRule));
        let scope = 'all';
        if (opts) {
          scope = await askScope('수정', opts);
          if (!scope) return;
        }
        await applyEdit({ occ: editing, fields, start: starts, end: ends, rule, scope });
      } else {
        await createEvent({ fields, start: starts, end: ends, rule });
      }
      dlg.close();
    } catch (err) {
      fail('저장하지 못했어요: ' + err.message);
    }
  });

  dlg.querySelector('[data-action=cancel]').addEventListener('click', () => dlg.close());
  dlg.querySelector('[data-action=delete]').addEventListener('click', async () => {
    if (!editing) return;
    try {
      const opts = scopeOptions(editing);
      let scope = 'all';
      if (opts) {
        scope = await askScope('삭제', opts);
        if (!scope) return;
      } else if (!confirm(`'${editing.title}' 일정을 지울까요?`)) return;
      await deleteEvent({ occ: editing, scope });
      dlg.close();
    } catch (err) {
      fail('지우지 못했어요: ' + err.message);
    }
  });
  // 바깥(어두운 부분)을 누르면 닫기
  dlg.addEventListener('click', (e) => {
    if (e.target === dlg) dlg.close();
  });

  return { open };
}

