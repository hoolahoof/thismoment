// 월간 캘린더: 달력 + 공휴일 표시 + 일정 칩, 날짜를 누르면 아래에 그날 일정, + 로 일정 추가/수정.
import * as store from './store.js';
import { holidayOn } from './holidays.js';
import { esc, toISODate, parseDate, todayLocal, ddayLabel, daysUntil, icons } from './util.js';
import { localISO, eventsOn, parseRule, sameRule, describeRule, hm, eventTime, daysBetween, addDays } from './recur.js';
import { COLORS, colorOf, isCustomColor, REPEAT_ICON } from './colors.js';
import { pickEmoji, emojiTag } from './emoji.js';
import { setupSearch, searchDialogHTML, searchIcon } from './search.js';
import { applyEdit, createEvent, linkDday, deleteEvent, askScope, scopeOptions, findOccurrence, moveEvent } from './events.js';

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

// ── 사이드바 '새 일정'·키보드 단축키 (데스크탑) ──
const WIDE = window.matchMedia('(min-width: 900px)');
let ctx = null; // 지금 떠 있는 캘린더 화면의 동작
let pendingNew = false;
function flushNew() {
  if (pendingNew && ctx?.el.isConnected) {
    pendingNew = false;
    ctx.openNew();
  }
}
// 어느 화면에서든: 캘린더로 가서 일정 추가 창을 연다
export function requestNewEvent() {
  pendingNew = true;
  if (location.hash.replace(/^#\/?/, '') !== 'calendar') location.hash = '#/calendar';
  else flushNew();
}
WIDE.addEventListener('change', () => { if (ctx?.el.isConnected) ctx.rerender(); });
window.addEventListener('keydown', (e) => {
  if (e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey || !WIDE.matches) return;
  if (!document.querySelector('.tabbar') || document.querySelector('dialog[open]')) return;
  const t = e.target;
  if (t && (/^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName) || t.isContentEditable)) return;
  const k = e.key.toLowerCase();
  if (k === 'n') { e.preventDefault(); requestNewEvent(); return; }
  if (!ctx?.el.isConnected) return;
  if (e.key === 'ArrowLeft') { e.preventDefault(); ctx.shift(-1); }
  else if (e.key === 'ArrowRight') { e.preventDefault(); ctx.shift(1); }
  else if (k === 't') { e.preventDefault(); ctx.goToday(); }
  else if (e.key === '/') { e.preventDefault(); ctx.openSearch(); }
});

// 한 달 치 칸 HTML (y년 m월; m 은 0부터)
function monthHTML(y, m, s) {
  const first = new Date(y, m, 1);
  const daysInMonth = new Date(y, m + 1, 0).getDate();
  const weeks = Math.ceil((first.getDay() + daysInMonth) / 7);
  const start = new Date(y, m, 1 - first.getDay());
  const todayISO = toISODate(today);
  const cells = [];
  for (let i = 0; i < weeks * 7; i++) {
    const d = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i);
    const iso = toISODate(d);
    const dow = d.getDay();
    const h = holidayOn(iso, s);
    const hol = h.kr || h.custom;
    const evs = eventsOn(iso, s.data.events).filter((e) => !e.is_holiday);
    const cls = [
      'cal-cell',
      d.getMonth() !== m ? 'other' : '',
      iso === todayISO ? 'today' : '',
      iso === selected ? 'selected' : '',
      hol || dow === 0 ? 'red' : dow === 6 ? 'blue' : '',
    ].join(' ');
    const maxChips = WIDE.matches ? (hol ? 2 : 3) : (hol ? 1 : 2);
    const chips = evs.slice(0, maxChips)
      .map((ev) => `<span class="chip-ev" data-event="${ev.id}" data-occ="${ev._occ}" style="background:${colorOf(ev.color).bg}"><span class="chip-t">${esc(ev.title)}</span>${emojiTag(ev)}</span>`)
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
  return cells.join('');
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
      <section class="card cal" data-slot="cal">
        <div class="cal-week">${WD.map((w, i) => `<span class="${i === 0 ? 'red' : i === 6 ? 'blue' : ''}">${w}</span>`).join('')}</div>
        <div class="cal-viewport" data-slot="cal-vp">
          <div class="cal-track" data-slot="track">
            <div class="cal-grid cal-ghost" data-slot="grid-prev" aria-hidden="true" inert></div>
            <div class="cal-grid" data-slot="grid" role="grid"></div>
            <div class="cal-grid cal-ghost" data-slot="grid-next" aria-hidden="true" inert></div>
          </div>
        </div>
      </section>
      <section class="day-panel" data-slot="day-panel">
        <div class="day-panel-head">
          <h2 data-slot="day-title"></h2><span data-slot="day-hol" class="red small"></span>
          <span class="grow"></span>
          <a class="btn pill" href="#/day" data-action="to-day">시간표 보기</a>
        </div>
        <ul class="list" data-slot="day-list"></ul>
        <div class="side-dday" data-slot="side-dday"></div>
      </section>
      <p class="muted small kbd-hint">← → 달 이동 · T 오늘 · N 새 일정 · / 검색 · 날짜 더블클릭 = 일정 추가</p>
      <p class="muted small center cal-tip" data-slot="tip">날짜를 길게 누른 채 끌면 여러 날 일정을 만들고,<br>일정을 길게 눌러 끌면 다른 날로 옮겨요.<br>휴일은 일정 추가 창의 ‘휴일’ 버튼으로 만들어요.</p>
      <button class="fab" data-action="add" aria-label="일정 추가">${icons.plus}</button>
      ${eventDialogHTML()}
      ${searchDialogHTML()}`;

    const rerender = () => calendar.update(el, store.getState());
    let suppressClick = false;

    // ── 달 넘기기: 손가락을 따라 달력이 움직이고, 놓으면 부드럽게 다음(이전) 달로 자리 잡는다 ──
    const cal = el.querySelector('[data-slot=cal]');
    const track = el.querySelector('[data-slot=track]');
    const calm = window.matchMedia('(prefers-reduced-motion: reduce)');
    const at = (px) => `translateX(calc(-33.3333% + ${px}px))`; // 가운데 칸이 보이는 자리 + 손가락 이동량
    let sliding = false;
    // dir: 1 다음 달, -1 이전 달, 0 제자리로 돌아오기
    const settle = (dir) => {
      const w = cal.clientWidth;
      if (calm.matches) {
        track.style.transition = 'none';
        if (dir) { shiftMonth(dir); rerender(); }
        track.style.transform = at(0);
        sliding = false;
        return;
      }
      sliding = true;
      let finished = false;
      const done = () => {
        if (finished) return;
        finished = true;
        track.style.transition = 'none';
        if (dir) { shiftMonth(dir); rerender(); } // 새 달을 가운데에 다시 그리고 같은 프레임에 제자리로
        track.style.transform = at(0);
        sliding = false;
      };
      track.style.transition = 'transform 0.3s cubic-bezier(0.22, 1, 0.36, 1)';
      track.style.transform = at(-dir * w);
      track.addEventListener('transitionend', done, { once: true });
      setTimeout(done, 420); // 움직임이 없을 때(제자리 0px)도 마무리되도록
    };
    const shift = (delta) => { if (!sliding) settle(delta); };
    const goToday = () => {
      viewY = today.getFullYear();
      viewM = today.getMonth();
      selected = toISODate(today);
      rerender();
    };
    el.querySelectorAll('[data-nav]').forEach((b) =>
      b.addEventListener('click', () => {
        const v = b.dataset.nav;
        if (v === 'today') goToday();
        else shift(Number(v));
      })
    );
    // 디데이 줄(오른쪽 패널)을 누르면 그 날짜로
    el.addEventListener('click', (e) => {
      const dd = e.target.closest('[data-dday-date]');
      if (!dd) return;
      setSelected(dd.dataset.ddayDate);
      rerender();
    });

    // 같은 날짜 칸을 0.4초 안에 두 번 누르면 그 날짜로 일정 추가 창을 연다.
    // (한 번 누를 때마다 달력을 다시 그려서 브라우저의 dblclick 이벤트는 믿을 수 없다)
    let lastTap = { iso: null, t: 0 };
    el.querySelector('[data-slot=grid]').addEventListener('click', (e) => {
      if (suppressClick) { suppressClick = false; return; }
      const c = e.target.closest('[data-date]');
      if (!c) return;
      const iso = c.dataset.date;
      if (!e.target.closest('[data-event]')) {
        const t = Date.now();
        if (lastTap.iso === iso && t - lastTap.t < 400) {
          lastTap = { iso: null, t: 0 };
          selected = iso;
          rerender();
          dialog.open(null, iso);
          return;
        }
        lastTap = { iso, t };
      }
      const d = parseDate(iso);
      if (d.getMonth() !== viewM) {
        viewY = d.getFullYear();
        viewM = d.getMonth();
      }
      selected = iso;
      rerender();
    });

    const range = { active: false, start: null, end: null, timer: null, x: 0, y: 0, type: '', chip: null };

    // 좌우로 밀기: 가로로 움직이는 것이 분명할 때만 달력이 손가락을 따라가고(세로 스크롤은 그대로), 놓는 순간 거리·속도로 넘길지 정한다
    let sx = null, sy = null, dx = 0, mode = null, lastX = 0, lastT = 0, vx = 0;
    cal.addEventListener('touchstart', (e) => {
      if (sliding || e.touches.length > 1) { sx = null; return; }
      sx = lastX = e.touches[0].clientX;
      sy = e.touches[0].clientY;
      lastT = performance.now();
      dx = 0; vx = 0; mode = null;
      track.style.transition = 'none';
    }, { passive: true });
    cal.addEventListener('touchmove', (e) => {
      if (sx === null || range.active) return;
      const x = e.touches[0].clientX;
      dx = x - sx;
      const dy = e.touches[0].clientY - sy;
      if (!mode) {
        if (Math.abs(dx) < 8 && Math.abs(dy) < 8) return;
        mode = Math.abs(dx) > Math.abs(dy) * 1.2 ? 'h' : 'v';
      }
      if (mode !== 'h') return;
      const now = performance.now();
      vx = (x - lastX) / Math.max(1, now - lastT);
      lastX = x; lastT = now;
      track.style.transform = at(dx);
    }, { passive: true });
    const release = () => {
      if (sx === null) return;
      sx = null;
      if (mode !== 'h' || range.active) { if (mode === 'h') settle(0); return; }
      const far = Math.abs(dx) > cal.clientWidth * 0.25;
      const flick = Math.abs(vx) > 0.5 && Math.abs(dx) > 24; // 짧아도 빠르게 튕기면 넘김
      settle(far || flick ? (dx < 0 ? 1 : -1) : 0);
    };
    cal.addEventListener('touchend', release);
    cal.addEventListener('touchcancel', release);
    // 트랙패드 가로 스크롤도 달 넘기기로
    let wheelAcc = 0, wheelT = 0;
    cal.addEventListener('wheel', (e) => {
      if (Math.abs(e.deltaX) <= Math.abs(e.deltaY)) return;
      e.preventDefault();
      const now = performance.now();
      if (now - wheelT > 300) wheelAcc = 0;
      wheelT = now;
      wheelAcc += e.deltaX;
      if (Math.abs(wheelAcc) > 60 && !sliding) { const dir = wheelAcc > 0 ? 1 : -1; wheelAcc = 0; wheelT = now + 500; settle(dir); }
    }, { passive: false });

    const dialog = setupEventDialog(el);

    // 검색
    const search = setupSearch(el, {
      onPick: (iso) => {
        setSelected(iso);
        rerender();
        window.scrollTo({ top: 0 });
      },
    });
    el.querySelector('[data-action=search]').addEventListener('click', () => search.open());
    el.querySelector('[data-action=add]').addEventListener('click', () => dialog.open(null, selected));
    // 사이드바의 '새 일정'·단축키가 쓰는 손잡이
    ctx = { el, rerender, shift, goToday, openNew: () => dialog.open(null, selected), openSearch: () => search.open() };
    requestAnimationFrame(flushNew);

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
        ? { id: chip.dataset.event, occ: chip.dataset.occ, title: chip.querySelector('.chip-t')?.textContent ?? chip.textContent, bg: chip.style.background }
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

    el.querySelector('[data-slot=day-list]').addEventListener('click', async (e) => {
      // 오른쪽 이모티콘을 누르면 바로 바꾼다 (반복 일정이면 모든 날에 적용)
      const em = e.target.closest('[data-emoji-edit]');
      if (em) {
        e.stopPropagation();
        const m = store.getState().data.events.find((x) => x.id === em.dataset.emojiEdit);
        if (!m) return;
        const r = await pickEmoji(m.emoji ?? '');
        if (r === undefined || r === (m.emoji ?? '')) return;
        try {
          await store.update('events', m.id, { emoji: r || null });
        } catch (err) {
          alert('저장하지 못했어요: ' + err.message + ' (이모티콘을 처음 쓸 때는 SQL 010 실행이 필요해요)');
        }
        return;
      }
      const b = e.target.closest('[data-event]');
      if (!b) return;
      const ev = findOccurrence(b.dataset.event, b.dataset.occ);
      if (ev) dialog.open(ev);
    });
  },

  update(el, s) {
    el.querySelector('[data-slot=title]').textContent = `${viewY}년 ${viewM + 1}월`;

    // 달력 칸: 가운데(이번 달) + 양옆 미리보기(이전·다음 달). 손가락으로 밀 때 옆 달이 같이 딸려 들어온다.
    const todayISO = toISODate(today);
    const pm = new Date(viewY, viewM - 1, 1);
    const nm = new Date(viewY, viewM + 1, 1);
    const gridEl = el.querySelector('[data-slot=grid]');
    gridEl.innerHTML = monthHTML(viewY, viewM, s);
    el.querySelector('[data-slot=grid-prev]').innerHTML = monthHTML(pm.getFullYear(), pm.getMonth(), s);
    el.querySelector('[data-slot=grid-next]').innerHTML = monthHTML(nm.getFullYear(), nm.getMonth(), s);
    el.querySelector('[data-slot=cal-vp]').style.height = `${gridEl.offsetHeight}px`; // 보이는 높이는 이번 달 기준

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
              <span class="emo-btn ${ev.emoji ? '' : 'empty'}" role="button" tabindex="0" data-emoji-edit="${ev.id}" aria-label="이모티콘 ${ev.emoji ? '바꾸기' : '붙이기'}">${ev.emoji ? esc(ev.emoji) : '＋'}</span>
            </button>
          </li>`).join('')
      : '<li class="empty muted">일정이 없어요.<br><span class="only-m">오른쪽 아래 + 로 추가하세요.</span><span class="only-d">왼쪽 위 ‘새 일정’으로 추가하세요.</span></li>';

    // 오른쪽 패널(데스크탑): 다가오는 디데이
    const up = [...s.data.ddays]
      .filter((x) => !x.count_up && daysUntil(x.target_date) >= 0)
      .sort((a, b) => a.target_date.localeCompare(b.target_date))
      .slice(0, 3);
    el.querySelector('[data-slot=side-dday]').innerHTML = up.length
      ? '<h3 class="side-title"><a href="#/dday">다가오는 D-Day ›</a></h3>' + up.map((x) => `<button type="button" class="side-dday-row" data-dday-date="${x.target_date}"><span class="sd-title">${esc(x.title)}</span><span class="sd-count">${ddayLabel(x)}</span></button>`).join('')
      : '';
  },
};

// ── 일정 추가/수정 창 (하루·주간 화면에서도 같이 씀) ──
export function eventDialogHTML() {
  return `
  <dialog class="sheet" data-slot="ev-dialog" aria-labelledby="ev-dialog-title">
    <form method="dialog" class="form" novalidate>
      <h2 id="ev-dialog-title" data-slot="ev-dialog-title">일정 추가</h2>
      <div class="title-row">
        <label class="grow">제목<input name="title" maxlength="60" required placeholder="예: 팀 회의" autocomplete="off"></label>
        <button type="button" class="emoji-btn" data-action="emoji" aria-label="이모티콘 고르기"><span data-slot="emo-view">☺</span></button>
        <input type="hidden" name="emoji">
      </div>
      <div class="check-row">
        <input type="checkbox" name="all_day" hidden>
        <button type="button" class="holiday-toggle" data-action="holiday" aria-pressed="false">휴일</button>
      </div>
      <p class="muted small" data-when="holiday-hint" hidden>달력에서 빨간 날로 보이고, ‘휴일엔 안 울림’으로 정한 알람은 울리지 않아요.</p>
      <div class="form-row">
        <label class="grow">날짜<input type="date" name="date" required></label>
        <label class="grow" data-when="allday">끝나는 날<input type="date" name="end_date"></label>
      </div>
      <label class="check" data-when="newdday"><input type="checkbox" name="also_dday"> D-Day로도 등록</label>
      <p class="muted small" data-when="ddaylink" hidden>D-Day와 연결된 일정이에요. 이름·날짜를 바꾸면 D-Day도 바뀌고, 지우면 D-Day도 같이 지워져요.</p>
      <!-- 시간 입력은 없앴다. 예전에 시간을 넣어 만든 일정을 고칠 때 시간이 그대로 유지되도록 값만 숨겨 둔다 -->
      <input type="hidden" name="start" value="09:00">
      <input type="hidden" name="end" value="10:00">
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
      <details class="color-fold" data-slot="color-fold">
      <summary><span>색</span><span class="cf-dot" data-slot="cf-dot"></span><span class="muted small" data-slot="cf-name"></span></summary>
      <fieldset class="days" data-when="color">
        <legend>색</legend>
        <div class="swatches">
          ${Object.entries(COLORS).map(([k, c]) => `
            <label class="swatch" style="--sw:${c.bar}">
              <input type="radio" name="color" value="${k}" aria-label="${c.name}"><span></span>
            </label>`).join('')}
        </div>
      </fieldset>
      <fieldset class="days" data-when="mycolor">
        <legend>내 색 <span class="muted small">(직접 만들거나 전에 쓴 색)</span></legend>
        <div class="swatches" data-slot="custom-swatches"></div>
      </fieldset>
      </details>
      <label>메모<input name="note" maxlength="200" autocomplete="off"></label>
      <p class="form-msg" role="status"></p>
      <div class="sheet-actions">
        <button class="btn danger" type="button" data-action="delete" hidden>삭제</button>
        <span class="grow"></span>
        <button class="btn" type="button" data-action="cancel">취소</button>
        <button class="btn primary" type="submit" value="save">저장</button>
      </div>
    </form>
  </dialog>
  <dialog class="sheet" data-slot="color-dialog" aria-label="색 만들기">
    <div class="form">
      <h2>내 색 만들기</h2>
      <div class="cp-top">
        <div class="cp-preview" data-slot="cp-preview"></div>
        <label class="grow">색 코드<input data-slot="cp-hex" maxlength="7" autocomplete="off" spellcheck="false" placeholder="#RRGGBB"></label>
        <input type="color" class="cp-native" data-slot="cp-native" aria-label="색 고르기">
      </div>
      <div class="cp-sliders">
        <label>R<input type="range" min="0" max="255" data-ch="0"><output></output></label>
        <label>G<input type="range" min="0" max="255" data-ch="1"><output></output></label>
        <label>B<input type="range" min="0" max="255" data-ch="2"><output></output></label>
      </div>
      <fieldset class="days">
        <legend>전에 쓴 색</legend>
        <div class="swatches" data-slot="cp-used"></div>
        <p class="muted small" data-slot="cp-empty">아직 직접 만든 색이 없어요.</p>
      </fieldset>
      <div class="sheet-actions">
        <span class="grow"></span>
        <button class="btn" type="button" data-act="cancel">취소</button>
        <button class="btn primary" type="button" data-act="apply">이 색 쓰기</button>
      </div>
    </div>
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

  // ── 이모티콘 ──
  const emoView = form.querySelector('[data-slot=emo-view]');
  const paintEmo = () => {
    const v = f.namedItem('emoji').value;
    emoView.textContent = v || '☺';
    emoView.parentElement.classList.toggle('has', !!v);
  };
  form.querySelector('[data-action=emoji]').addEventListener('click', async () => {
    const r = await pickEmoji(f.namedItem('emoji').value);
    if (r !== undefined) {
      f.namedItem('emoji').value = r;
      paintEmo();
    }
  });

  // ── 내 색 (직접 만든 색 + 전에 쓴 색) ──
  const cdlg = root.querySelector('[data-slot=color-dialog]');
  const customBox = form.querySelector('[data-slot=custom-swatches]');
  const usedColors = () => {
    const n = new Map();
    for (const e of store.getState().data.events) {
      if (isCustomColor(e.color)) n.set(e.color.toLowerCase(), (n.get(e.color.toLowerCase()) || 0) + 1);
    }
    return [...n.entries()].sort((a, b) => b[1] - a[1]).map(([k]) => k);
  };
  const swatchHTML = (hex, checked) =>
    `<label class="swatch" style="--sw:${hex}"><input type="radio" name="color" value="${hex}" aria-label="${hex}" ${checked ? 'checked' : ''}><span></span></label>`;
  function renderCustom(selected) {
    const list = usedColors().slice(0, 13);
    const sel = isCustomColor(selected) ? selected.toLowerCase() : null;
    if (sel && !list.includes(sel)) list.unshift(sel);
    customBox.innerHTML =
      list.map((h) => swatchHTML(h, h === sel)).join('') +
      '<button type="button" class="swatch-add" data-action="add-color" aria-label="내 색 만들기">＋</button>';
  }

  // RGB 고르는 창: 글자 색 코드, 슬라이더, 기기 색 선택기, 전에 쓴 색
  function pickColor(initial) {
    return new Promise((resolve) => {
      const hexIn = cdlg.querySelector('[data-slot=cp-hex]');
      const nat = cdlg.querySelector('[data-slot=cp-native]');
      const prev = cdlg.querySelector('[data-slot=cp-preview]');
      const sl = [...cdlg.querySelectorAll('[data-ch]')];
      const usedBox = cdlg.querySelector('[data-slot=cp-used]');
      const ok = (h) => (/^#[0-9a-f]{6}$/i.test(h) ? h.toLowerCase() : null);
      let cur = ok(initial) ?? '#ff7aa8';
      const set = (h, from) => {
        h = ok(h);
        if (!h) return;
        cur = h;
        prev.style.background = h;
        if (from !== 'hex') hexIn.value = h;
        nat.value = h;
        const v = [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
        sl.forEach((r, i) => {
          if (from !== 'slider') r.value = v[i];
          r.nextElementSibling.textContent = v[i];
        });
      };
      const used = usedColors();
      usedBox.innerHTML = used.map((h) => `<button type="button" class="swatch-pick" style="--sw:${h}" data-hex="${h}" aria-label="${h}"></button>`).join('');
      cdlg.querySelector('[data-slot=cp-empty]').hidden = used.length > 0;
      set(cur);

      const ac = new AbortController();
      const o = { signal: ac.signal };
      const finish = (v) => {
        ac.abort();
        if (cdlg.open) cdlg.close();
        resolve(v);
      };
      hexIn.addEventListener('input', () => set(hexIn.value.startsWith('#') ? hexIn.value : '#' + hexIn.value, 'hex'), o);
      nat.addEventListener('input', () => set(nat.value), o);
      sl.forEach((r) => r.addEventListener('input', () => set('#' + sl.map((x) => Number(x.value).toString(16).padStart(2, '0')).join(''), 'slider'), o));
      cdlg.addEventListener('click', (e) => {
        if (e.target === cdlg) return finish(null);
        const p = e.target.closest('[data-hex]');
        if (p) return set(p.dataset.hex);
        const a = e.target.closest('[data-act]');
        if (a) finish(a.dataset.act === 'apply' ? cur : null);
      }, o);
      cdlg.addEventListener('close', () => finish(null), o);
      cdlg.showModal();
    });
  }
  // 색 칸은 접어 두고, 접힌 줄에는 지금 고른 색만 보여준다
  function paintColorFold() {
    const r = form.querySelector('input[name=color]:checked');
    const dot = form.querySelector('[data-slot=cf-dot]');
    dot.style.background = r?.closest('.swatch')?.style.getPropertyValue('--sw') || 'var(--color-line-strong)';
    form.querySelector('[data-slot=cf-name]').textContent = r?.getAttribute('aria-label') ?? '';
  }
  form.addEventListener('change', (e) => { if (e.target.name === 'color') paintColorFold(); });
  form.addEventListener('click', async (e) => {
    if (!e.target.closest('[data-action=add-color]')) return;
    const now = form.querySelector('input[name=color]:checked')?.value;
    const h = await pickColor(isCustomColor(now) ? now : '#ff7aa8');
    if (h) { renderCustom(h); paintColorFold(); }
  });

  const holBtn = form.querySelector('[data-action=holiday]');
  const isHoliday = () => holBtn.getAttribute('aria-pressed') === 'true';

  const syncAllDay = () => {
    const all = f.namedItem('all_day').checked;
    // 반복 일정에는 '끝나는 날'(여러 날 일정)을 쓰지 않으므로 반복을 고르면 숨긴다
    const repeating = !!f.namedItem('repeat').value;
    form.querySelectorAll('[data-when=allday]').forEach((n) => (n.hidden = !all || repeating));
  };
  f.namedItem('all_day').addEventListener('change', syncAllDay);

  // 휴일: 하루 종일 일정 + 빨간 날. 반복은 '안 함'과 '매년'만, 색은 빨강으로 고정
  function syncHoliday() {
    const on = isHoliday();
    if (on) f.namedItem('all_day').checked = true;
    f.namedItem('all_day').disabled = on;
    form.querySelector('[data-when=holiday-hint]').hidden = !on;
    form.querySelector('[data-slot=color-fold]').hidden = on;
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
    if (freq) f.namedItem('end_date').value = '';
    syncAllDay();
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
    f.namedItem('all_day').checked = ev ? !!ev.all_day : true; // 새 일정은 항상 날짜만 (시간 없음)
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
    renderCustom(color);
    form.querySelectorAll('input[name=color]').forEach((r) => (r.checked = r.value.toLowerCase() === color.toLowerCase()));
    form.querySelector('[data-slot=color-fold]').open = false;
    paintColorFold();
    f.namedItem('emoji').value = ev?.emoji ?? '';
    paintEmo();
    f.namedItem('also_dday').checked = false;
    form.querySelector('[data-when=newdday]').hidden = !!ev && (!!ev.dday_id || !!parseRule(ev.recurrence));
    form.querySelector('[data-when=ddaylink]').hidden = !ev?.dday_id;
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
      emoji: f.namedItem('emoji').value || null,
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
        if (f.namedItem('also_dday').checked && !rule && !oldRule) await linkDday(editing, title, starts);
      } else {
        await createEvent({ fields, start: starts, end: ends, rule, alsoDday: f.namedItem('also_dday').checked });
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
      } else if (!confirm(`'${editing.title}' 일정을 지울까요?${editing.dday_id ? ' (연결된 D-Day도 같이 지워져요)' : ''}`)) return;
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

