// 주간 보기: 일~토 7칸 시간표. 날짜 머리글을 누르면 그날의 하루 화면, 빈 곳을 누르면 일정 추가, 일정을 누르면 수정.
import { holidayOn } from './holidays.js';
import { esc, toISODate, parseDate, todayLocal } from './util.js';
import { eventsOn } from './recur.js';
import { colorOf, REPEAT_ICON } from './colors.js';
import { findOccurrence } from './events.js';
import { spanIn, layout, minutesOf } from './timeline.js';

const WD = ['일', '월', '화', '수', '목', '금', '토'];
const HW = 40; // 1시간 높이(px)
const pad = (n) => String(n).padStart(2, '0');

export const weekStart = (iso) => {
  const d = parseDate(iso);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() - d.getDay());
};

// 맨 위 제목에 쓸 "11월 9일 – 15일"
export function weekTitle(iso) {
  const a = weekStart(iso);
  const b = new Date(a.getFullYear(), a.getMonth(), a.getDate() + 6);
  return `${a.getMonth() + 1}월 ${a.getDate()}일 – ${b.getMonth() !== a.getMonth() ? `${b.getMonth() + 1}월 ` : ''}${b.getDate()}일`;
}

export const weekView = {
  // ctx: { getSelected, setSelected, open(ev|null, dateISO, startHM), goDay(), rerender() }
  mount(el, ctx) {
    el.innerHTML = `
      <div class="wk">
        <div class="wk-head" data-slot="wk-head"></div>
        <div class="wk-allday" data-slot="wk-allday"></div>
        <div class="wk-body" data-slot="wk-body" style="height:${24 * HW}px">
          ${Array.from({ length: 24 }, (_, h) => `<div class="wk-hour" style="top:${h * HW}px"><span>${h}시</span></div>`).join('')}
          <div class="wk-cols" data-slot="wk-cols"></div>
        </div>
      </div>`;

    el.querySelector('[data-slot=wk-head]').addEventListener('click', (e) => {
      const b = e.target.closest('[data-date]');
      if (!b) return;
      ctx.setSelected(b.dataset.date);
      ctx.goDay();
    });
    el.querySelector('[data-slot=wk-allday]').addEventListener('click', (e) => {
      const b = e.target.closest('[data-event]');
      const ev = b && findOccurrence(b.dataset.event, b.dataset.occ);
      if (ev) ctx.open(ev);
    });
    el.querySelector('[data-slot=wk-cols]').addEventListener('click', (e) => {
      const blk = e.target.closest('[data-event]');
      if (blk) {
        const ev = findOccurrence(blk.dataset.event, blk.dataset.occ);
        if (ev) ctx.open(ev);
        return;
      }
      const col = e.target.closest('[data-col]');
      if (!col) return;
      const rect = col.getBoundingClientRect();
      const mins = Math.floor(((e.clientY - rect.top) / HW) * 2) * 30;
      const h = Math.min(Math.max(Math.floor(mins / 60), 0), 23);
      ctx.open(null, col.dataset.col, `${pad(h)}:${pad(mins % 60)}`);
    });
  },

  update(el, s, ctx) {
    const sel = ctx.getSelected();
    const sun = weekStart(sel);
    const todayISO = toISODate(todayLocal());
    const days = Array.from({ length: 7 }, (_, i) => {
      const d = new Date(sun.getFullYear(), sun.getMonth(), sun.getDate() + i);
      const iso = toISODate(d);
      const h = holidayOn(iso, s);
      return { d, iso, i, hol: h.kr || h.custom, evs: eventsOn(iso, s.data.events) };
    });

    el.querySelector('[data-slot=wk-head]').innerHTML =
      '<span></span>' +
      days.map(({ d, iso, i, hol }) => `
        <button class="wk-day ${iso === sel ? 'sel' : ''} ${hol || i === 0 ? 'red' : i === 6 ? 'blue' : ''}" data-date="${iso}"
          aria-label="${d.getMonth() + 1}월 ${d.getDate()}일 ${WD[i]}요일${hol ? ', ' + esc(hol) : ''}, 하루 화면으로">
          <span class="wk-w">${WD[i]}</span>
          <span class="wk-n ${iso === todayISO ? 'today' : ''}">${d.getDate()}</span>
          <span class="wk-hol">${hol ? esc(hol) : ''}</span>
        </button>`).join('');

    // 하루 종일 일정 (칸마다 최대 3개)
    const maxAll = days.reduce((m, x) => Math.max(m, x.evs.filter((e) => e.all_day).length), 0);
    const allday = el.querySelector('[data-slot=wk-allday]');
    allday.hidden = maxAll === 0;
    allday.innerHTML = maxAll
      ? '<span></span>' + days.map(({ evs }) => {
          const list = evs.filter((e) => e.all_day);
          return `<div class="wk-allcol">${list.slice(0, 3).map((ev) =>
            `<button class="wk-chip" data-event="${ev.id}" data-occ="${ev._occ}" style="background:${colorOf(ev.color).bg}">${esc(ev.title)}</button>`).join('')}${list.length > 3 ? `<span class="chip-more">+${list.length - 3}</span>` : ''}</div>`;
        }).join('')
      : '';

    // 시간 블록
    const now = new Date();
    el.querySelector('[data-slot=wk-cols]').innerHTML = days.map(({ iso, i, hol, evs }) => {
      const items = layout(evs.filter((e) => !e.all_day).map((ev) => ({ ev, ...spanIn(ev, iso) })));
      const blocks = items.map((it) => {
        const top = (it.start / 60) * HW;
        const height = Math.max(((it.end - it.start) / 60) * HW - 1, 14);
        const w = 100 / it.cols;
        const c = colorOf(it.ev.color);
        return `<button class="wk-block" data-event="${it.ev.id}" data-occ="${it.ev._occ}"
          style="top:${top}px;height:${height}px;left:calc(${it.col * w}% + 1px);width:calc(${w}% - 2px);background:${c.bg};border-left-color:${c.bar}"
          aria-label="${esc(it.ev.title)}"><span>${esc(it.ev.title)}${it.ev.recurrence ? REPEAT_ICON : ''}</span></button>`;
      }).join('');
      const nowLine = iso === todayISO ? `<div class="wk-now" style="top:${(minutesOf(now) / 60) * HW}px"></div>` : '';
      return `<div class="wk-col ${hol ? 'is-holiday' : ''} ${iso === sel ? 'is-sel' : ''}" data-col="${iso}" style="left:${(i * 100) / 7}%;width:${100 / 7}%">${blocks}${nowLine}</div>`;
    }).join('');
  },

  // 처음 보일 때 오전 7시쯤으로 스크롤
  scrollToMorning(el) {
    const body = el.querySelector('[data-slot=wk-body]');
    if (body) window.scrollTo({ top: body.getBoundingClientRect().top + window.scrollY + 7 * HW - 140 });
  },
};
