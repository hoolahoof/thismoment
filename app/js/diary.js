// 오늘하루: 하루에 하나씩 쓰는 일기. 위아래로 스크롤하며 어제·오늘·내일 일기를 보고 바로 쓴다.
// 입력하면 잠깐 멈춘 뒤 자동 저장된다 (저장 버튼 없음).
import * as store from './store.js';
import { esc, parseDate, toISODate, todayLocal } from './util.js';
import { addDays } from './recur.js';
import { holidayOn } from './holidays.js';

const WD = ['일', '월', '화', '수', '목', '금', '토'];
const SAVE_DELAY = 900;
const MORE = 7; // '더 보기' 한 번에 늘어나는 날 수

// 화면을 옮겨도 유지: 오늘 기준 앞뒤 몇 날을 보여주는지
let before = 3;
let after = 3;

const dateText = (iso) => {
  const d = parseDate(iso);
  return `${d.getMonth() + 1}월 ${d.getDate()}일 (${WD[d.getDay()]})`;
};
const tagOf = (iso, today) => (iso === today ? '오늘' : iso === addDays(today, -1) ? '어제' : iso === addDays(today, 1) ? '내일' : '');
const hintOf = (iso, today) =>
  iso === today ? '오늘 하루는 어땠나요?' : iso < today ? (iso === addDays(today, -1) ? '어제는 어땠나요?' : '이 날의 하루를 적어 보세요') : '이 날의 계획이나 다짐을 적어 보세요';

// ── 저장 (같은 날짜의 저장은 순서대로, 새로 만들기/수정/비우면 삭제) ──
const chain = new Map();
function saveDay(iso, text) {
  const next = (chain.get(iso) || Promise.resolve()).then(async () => {
    const row = store.getState().data.diary.find((r) => r.entry_date === iso);
    if (!row) {
      if (text.trim()) await store.insert('diary', { entry_date: iso, body: text });
    } else if (!text.trim()) {
      await store.remove('diary', row.id);
    } else if (row.body !== text) {
      await store.update('diary', row.id, { body: text });
    }
  });
  chain.set(iso, next.catch(() => {}));
  return next;
}

// 입력 중인 칸들 (저장 대기)
const pending = new Map(); // iso → { timer, ta, stateEl }
const setState = (stateEl, text, isError = false) => {
  if (!stateEl) return;
  stateEl.textContent = text;
  stateEl.classList.toggle('error', isError);
};

async function flush(iso) {
  const p = pending.get(iso);
  if (!p) return;
  clearTimeout(p.timer);
  pending.delete(iso);
  setState(p.stateEl, '저장 중…');
  try {
    await saveDay(iso, p.ta.value);
    setState(p.stateEl, p.ta.value.trim() ? '저장됨' : '');
  } catch (err) {
    const hint = /diary|schema cache|relation/i.test(err.message) ? ' (일기를 쓰려면 SQL 016 을 실행해야 해요)' : '';
    setState(p.stateEl, '저장하지 못했어요: ' + err.message + hint, true);
  }
}
const flushAll = () => [...pending.keys()].forEach(flush);
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') flushAll(); });
window.addEventListener('pagehide', flushAll);

const grow = (ta) => {
  ta.style.height = 'auto';
  ta.style.height = `${ta.scrollHeight + 2}px`;
};

function cardHTML(iso, today, s) {
  const tag = tagOf(iso, today);
  const h = holidayOn(iso, s);
  const hol = h.kr || h.custom || '';
  return `
    <section class="card diary-day ${iso === today ? 'is-today' : ''}" data-date="${iso}">
      <header class="diary-head">
        <h2>${tag ? `<span class="diary-tag ${iso === today ? 'now' : ''}">${tag}</span>` : ''}${dateText(iso)}</h2>
        ${hol ? `<span class="red small">${esc(hol)}</span>` : ''}
        <span class="grow"></span>
        <span class="diary-state muted small" data-slot="state" role="status"></span>
      </header>
      <textarea class="diary-text" rows="3" maxlength="5000" placeholder="${hintOf(iso, today)}" aria-label="${dateText(iso)} 일기"></textarea>
    </section>`;
}

function bindCard(card) {
  const iso = card.dataset.date;
  const ta = card.querySelector('textarea');
  const stateEl = card.querySelector('[data-slot=state]');
  ta.addEventListener('input', () => {
    grow(ta);
    setState(stateEl, '입력 중…');
    clearTimeout(pending.get(iso)?.timer);
    pending.set(iso, { timer: setTimeout(() => flush(iso), SAVE_DELAY), ta, stateEl });
  });
  ta.addEventListener('blur', () => flush(iso));
}

export const diary = {
  mount(el) {
    const today = toISODate(todayLocal());
    el.innerHTML = `
      <header class="page-head"><h1>오늘하루</h1></header>
      <div class="card placeholder diary-setup" data-slot="setup" hidden>
        <strong>일기 저장 공간이 아직 없어요</strong>
        <span class="muted small">Supabase 의 SQL Editor 에서 <code>supabase/016_diary.sql</code> 내용을 붙여넣고 Run 을 한 번 눌러 주세요. 그 뒤로 일기를 쓸 수 있어요.</span>
      </div>
      <div class="diary-feed" data-slot="feed">
        <button class="btn diary-more" type="button" data-more="up">이전 날 더 보기 ↑</button>
        <div class="diary-days" data-slot="days"></div>
        <button class="btn diary-more" type="button" data-more="down">다음 날 더 보기 ↓</button>
      </div>`;
    const s = store.getState();
    const days = el.querySelector('[data-slot=days]');
    const range = [];
    for (let i = -before; i <= after; i++) range.push(addDays(today, i));
    days.innerHTML = range.map((iso) => cardHTML(iso, today, s)).join('');
    days.querySelectorAll('.diary-day').forEach(bindCard);

    // 위/아래로 더 보기: 위에 붙일 때는 보던 위치가 밀리지 않게 보정한다
    el.addEventListener('click', (e) => {
      const b = e.target.closest('[data-more]');
      if (!b) return;
      const st = store.getState();
      if (b.dataset.more === 'up') {
        const h0 = document.documentElement.scrollHeight;
        const html = [];
        for (let i = before + MORE; i > before; i--) html.push(cardHTML(addDays(today, -i), today, st));
        before += MORE;
        days.insertAdjacentHTML('afterbegin', html.join(''));
        days.querySelectorAll('.diary-day').forEach((c, i) => { if (i < MORE) bindCard(c); });
        window.scrollBy(0, document.documentElement.scrollHeight - h0);
      } else {
        const html = [];
        for (let i = after + 1; i <= after + MORE; i++) html.push(cardHTML(addDays(today, i), today, st));
        after += MORE;
        days.insertAdjacentHTML('beforeend', html.join(''));
        const all = days.querySelectorAll('.diary-day');
        for (let i = all.length - MORE; i < all.length; i++) bindCard(all[i]);
      }
      diary.update(el, st);
    });

    // 처음 열면 오늘 카드가 위쪽에 오도록 (키보드가 뜨지 않게 포커스는 주지 않는다)
    if (s.diaryReady) requestAnimationFrame(() => {
      const t = el.querySelector('.is-today');
      if (t) window.scrollTo({ top: Math.max(0, t.getBoundingClientRect().top + window.scrollY - 72) });
    });
  },

  update(el, s) {
    const ready = s.diaryReady;
    el.querySelector('[data-slot=setup]').hidden = ready;
    el.querySelectorAll('.diary-day').forEach((card) => {
      const ta = card.querySelector('textarea');
      ta.disabled = !ready;
      // 쓰고 있는 칸은 건드리지 않고, 다른 기기에서 바뀐 내용만 가져온다
      const iso = card.dataset.date;
      if (document.activeElement === ta || pending.has(iso)) return;
      const row = s.data.diary.find((r) => r.entry_date === iso);
      const text = row?.body ?? '';
      if (ta.value !== text) ta.value = text;
      grow(ta);
    });
  },
};
