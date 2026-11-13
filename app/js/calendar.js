// 월간 캘린더: 달력 + 공휴일 표시 + 일정 칩, 날짜를 누르면 아래에 그날 일정, + 로 일정 추가/수정.
import * as store from './store.js';
import { holidayOn } from './holidays.js';
import { esc, toISODate, parseDate, todayLocal, ddayLabel, daysUntil, icons } from './util.js';

const WD = ['일', '월', '화', '수', '목', '금', '토'];
export const COLORS = {
  blue: { name: '파랑', bg: '#DCE6FF', bar: '#2F5FD0' },
  green: { name: '초록', bg: '#D9F2E3', bar: '#2E9E5B' },
  orange: { name: '주황', bg: '#FFE4CC', bar: '#D9772B' },
  red: { name: '빨강', bg: '#FFDADA', bar: '#C62828' },
  purple: { name: '보라', bg: '#ECE1FF', bar: '#7A4FD6' },
};
const colorOf = (c) => COLORS[c] ?? COLORS.blue;
const pad = (n) => String(n).padStart(2, '0');

// ── 일정 날짜 계산 ──
export const localISO = (ts) => toISODate(new Date(ts));
export const hm = (ts) => {
  const d = new Date(ts);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
};
function endISO(ev) {
  if (!ev.ends_at) return localISO(ev.starts_at);
  // 시간 일정이 자정에 끝나면 전날까지로 본다
  const e = new Date(ev.ends_at);
  if (!ev.all_day && e.getHours() === 0 && e.getMinutes() === 0 && new Date(ev.starts_at) < e) e.setDate(e.getDate() - 1);
  return toISODate(e);
}
export function eventsOn(iso, events) {
  return events
    .filter((ev) => localISO(ev.starts_at) <= iso && iso <= endISO(ev))
    .sort((a, b) => (b.all_day - a.all_day) || a.starts_at.localeCompare(b.starts_at));
}
export const eventTime = (ev) => (ev.all_day ? '하루 종일' : `${hm(ev.starts_at)}–${ev.ends_at ? hm(ev.ends_at) : ''}`);

const dayLabel = (iso) => {
  const d = parseDate(iso);
  return `${d.getMonth() + 1}월 ${d.getDate()}일 (${WD[d.getDay()]})`;
};

// ── 화면 상태 (탭을 옮겨도 유지) ──
const today = todayLocal();
let viewY = today.getFullYear();
let viewM = today.getMonth();
let selected = toISODate(today);

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
        <button class="btn pill" data-nav="today">오늘</button>
      </header>
      <div class="dday-strip" data-slot="strip"></div>
      <section class="card cal" data-slot="cal">
        <div class="cal-week">${WD.map((w, i) => `<span class="${i === 0 ? 'red' : i === 6 ? 'blue' : ''}">${w}</span>`).join('')}</div>
        <div class="cal-grid" data-slot="grid" role="grid"></div>
      </section>
      <section class="day-panel">
        <div class="day-panel-head"><h2 data-slot="day-title"></h2><span data-slot="day-hol" class="red small"></span></div>
        <ul class="list" data-slot="day-list"></ul>
      </section>
      <button class="fab" data-action="add" aria-label="일정 추가">${icons.plus}</button>
      ${eventDialogHTML()}`;

    const rerender = () => calendar.update(el, store.getState());

    el.querySelectorAll('[data-nav]').forEach((b) =>
      b.addEventListener('click', () => {
        const v = b.dataset.nav;
        if (v === 'today') {
          viewY = today.getFullYear();
          viewM = today.getMonth();
          selected = toISODate(today);
        } else shiftMonth(Number(v));
        rerender();
      })
    );

    el.querySelector('[data-slot=grid]').addEventListener('click', (e) => {
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

    // 좌우로 밀어서 달 넘기기
    const cal = el.querySelector('[data-slot=cal]');
    let x0 = null, y0 = null;
    cal.addEventListener('touchstart', (e) => { x0 = e.touches[0].clientX; y0 = e.touches[0].clientY; }, { passive: true });
    cal.addEventListener('touchend', (e) => {
      if (x0 === null) return;
      const dx = e.changedTouches[0].clientX - x0;
      const dy = e.changedTouches[0].clientY - y0;
      x0 = null;
      if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy) * 1.5) {
        shiftMonth(dx < 0 ? 1 : -1);
        rerender();
      }
    });

    const dialog = setupEventDialog(el);
    el.querySelector('[data-action=add]').addEventListener('click', () => dialog.open(null, selected));
    el.querySelector('[data-slot=day-list]').addEventListener('click', (e) => {
      const b = e.target.closest('[data-event]');
      if (!b) return;
      const ev = store.getState().data.events.find((x) => x.id === b.dataset.event);
      if (ev) dialog.open(ev);
    });
  },

  update(el, s) {
    el.querySelector('[data-slot=title]').textContent = `${viewY}년 ${viewM + 1}월`;

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
      const evs = eventsOn(iso, s.data.events);
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
        .map((ev) => `<span class="chip-ev" style="background:${colorOf(ev.color).bg}">${esc(ev.title)}</span>`)
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

    // 선택한 날
    const h = holidayOn(selected, s);
    el.querySelector('[data-slot=day-title]').textContent = selected === todayISO ? `오늘 · ${dayLabel(selected)}` : dayLabel(selected);
    el.querySelector('[data-slot=day-hol]').textContent = [h.kr, h.custom].filter(Boolean).join(' · ');
    const list = eventsOn(selected, s.data.events);
    el.querySelector('[data-slot=day-list]').innerHTML = list.length
      ? list.map((ev) => `
          <li>
            <button class="card ev-row" data-event="${ev.id}">
              <span class="ev-bar" style="background:${colorOf(ev.color).bar}"></span>
              <span class="ev-time">${eventTime(ev)}</span>
              <span class="ev-title">${esc(ev.title)}${ev.note ? `<span class="muted small ev-note">${esc(ev.note)}</span>` : ''}</span>
            </button>
          </li>`).join('')
      : '<li class="empty muted">일정이 없어요. 오른쪽 아래 + 로 추가하세요.</li>';
  },
};

// ── 일정 추가/수정 창 (하루 화면에서도 같이 씀) ──
export function eventDialogHTML() {
  return `
  <dialog class="sheet" data-slot="ev-dialog" aria-labelledby="ev-dialog-title">
    <form method="dialog" class="form" novalidate>
      <h2 id="ev-dialog-title" data-slot="ev-dialog-title">일정 추가</h2>
      <label>제목<input name="title" maxlength="60" required placeholder="예: 팀 회의" autocomplete="off"></label>
      <label class="check"><input type="checkbox" name="all_day"> 하루 종일</label>
      <div class="form-row">
        <label class="grow">날짜<input type="date" name="date" required></label>
        <label class="grow" data-when="allday">끝나는 날<input type="date" name="end_date"></label>
      </div>
      <div class="form-row" data-when="timed">
        <label class="grow">시작<input type="time" name="start" value="09:00"></label>
        <label class="grow">끝<input type="time" name="end" value="10:00"></label>
      </div>
      <fieldset class="days">
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

export function setupEventDialog(root) {
  const dlg = root.querySelector('[data-slot=ev-dialog]');
  const form = dlg.querySelector('form');
  const f = form.elements;
  const msg = form.querySelector('.form-msg');
  let editing = null;

  const syncAllDay = () => {
    const all = f.namedItem('all_day').checked;
    form.querySelectorAll('[data-when=allday]').forEach((n) => (n.hidden = !all));
    form.querySelectorAll('[data-when=timed]').forEach((n) => (n.hidden = all));
  };
  f.namedItem('all_day').addEventListener('change', syncAllDay);

  function open(ev, dateISO) {
    editing = ev;
    msg.textContent = '';
    msg.classList.remove('error');
    dlg.querySelector('[data-slot=ev-dialog-title]').textContent = ev ? '일정 수정' : '일정 추가';
    dlg.querySelector('[data-action=delete]').hidden = !ev;
    f.namedItem('title').value = ev?.title ?? '';
    f.namedItem('all_day').checked = ev?.all_day ?? false;
    f.namedItem('date').value = ev ? localISO(ev.starts_at) : dateISO;
    f.namedItem('end_date').value = ev?.all_day && ev.ends_at ? localISO(ev.ends_at) : '';
    if (ev && !ev.all_day) {
      f.namedItem('start').value = hm(ev.starts_at);
      f.namedItem('end').value = ev.ends_at ? hm(ev.ends_at) : hm(ev.starts_at);
    } else if (!ev) {
      const now = new Date();
      const startH = Math.min(now.getHours() + 1, 22);
      f.namedItem('start').value = `${pad(startH)}:00`;
      f.namedItem('end').value = `${pad(startH + 1)}:00`;
    }
    const color = ev?.color ?? 'blue';
    form.querySelectorAll('input[name=color]').forEach((r) => (r.checked = r.value === color));
    f.namedItem('note').value = ev?.note ?? '';
    syncAllDay();
    dlg.showModal();
  }

  const fail = (t) => {
    msg.textContent = t;
    msg.classList.add('error');
  };

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const title = f.namedItem('title').value.trim();
    const date = f.namedItem('date').value;
    if (!title) return fail('제목을 입력해 주세요.');
    if (!date) return fail('날짜를 골라주세요.');
    const allDay = f.namedItem('all_day').checked;
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
    const row = {
      title,
      all_day: allDay,
      starts_at: starts.toISOString(),
      ends_at: ends.toISOString(),
      color: form.querySelector('input[name=color]:checked')?.value ?? 'blue',
      note: f.namedItem('note').value.trim() || null,
    };
    try {
      if (editing) await store.update('events', editing.id, row);
      else await store.insert('events', row);
      dlg.close();
    } catch (err) {
      fail('저장하지 못했어요: ' + err.message);
    }
  });

  dlg.querySelector('[data-action=cancel]').addEventListener('click', () => dlg.close());
  dlg.querySelector('[data-action=delete]').addEventListener('click', async () => {
    if (!editing || !confirm(`'${editing.title}' 일정을 지울까요?`)) return;
    try {
      await store.remove('events', editing.id);
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
