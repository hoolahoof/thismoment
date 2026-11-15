// 오늘 하루: 하루에 하나씩 쓰는 일기. 가운데 큰 페이지에 쓰고, 위(어제)·아래(내일) 작고 흐린 페이지를 눌러 넘긴다.
// 입력하면 잠깐 멈춘 뒤 자동 저장된다 (저장 버튼 없음).
import * as store from './store.js';
import { esc, parseDate, toISODate, todayLocal, icons } from './util.js';
import { addDays } from './recur.js';
import { holidayOn } from './holidays.js';

const WD = ['일', '월', '화', '수', '목', '금', '토'];
const SAVE_DELAY = 900;
const todayISO = () => toISODate(todayLocal());
const dayDiff = (a, b) => Math.round((parseDate(b) - parseDate(a)) / 86400000);
const snippet = (body, q) => {
  const i = body.toLowerCase().indexOf(q.toLowerCase());
  const from = Math.max(0, i - 14);
  const part = body.slice(from, i + q.length + 30).replace(/\s+/g, ' ');
  const at = i - from;
  return `${from > 0 ? '…' : ''}${esc(part.slice(0, at))}<mark>${esc(part.slice(at, at + q.length))}</mark>${esc(part.slice(at + q.length))}`;
};

const dateText = (iso) => {
  const d = parseDate(iso);
  return `${d.getFullYear() === todayLocal().getFullYear() ? '' : `${d.getFullYear()}년 `}${d.getMonth() + 1}월 ${d.getDate()}일 (${WD[d.getDay()]})`;
};
const tagOf = (iso) => {
  const t = todayISO();
  return iso === t ? '오늘' : iso === addDays(t, -1) ? '어제' : iso === addDays(t, 1) ? '내일' : '';
};

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
  const { ta, stateEl } = p;
  setState(stateEl, '저장 중…');
  try {
    await saveDay(iso, ta.value); // 값은 이 줄에서 바로 읽으므로 곧바로 다른 날로 바꿔도 안전
    setState(stateEl, '저장됨');
  } catch (err) {
    const hint = /Could not find the table|schema cache/i.test(err.message) ? ' (SQL 016 을 실행했는지 확인해 주세요)' : '';
    const msg = '저장하지 못했어요: ' + err.message + hint;
    setState(stateEl, msg, true);
    if (!stateEl.isConnected) alert(msg); // 이미 다른 날로 넘어간 뒤의 실패는 화면에 자리가 없으니 알림으로
  }
}
const flushAll = () => [...pending.keys()].forEach(flush);
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') flushAll(); });
window.addEventListener('pagehide', flushAll);

const grow = (ta) => {
  ta.style.height = 'auto';
  ta.style.height = `${ta.scrollHeight + 2}px`;
};

// 키보드: 쓰고 있지 않을 때 ↑ ↓ 로 넘기기 (데스크탑)
let ctx = null;
window.addEventListener('keydown', (e) => {
  if (!ctx?.el.isConnected || e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey) return;
  if (document.querySelector('dialog[open]')) return;
  const t = e.target;
  if (t && (/^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName) || t.isContentEditable)) return;
  if (e.key === 'ArrowUp') { e.preventDefault(); ctx.go(-1); }
  else if (e.key === 'ArrowDown') { e.preventDefault(); ctx.go(1); }
});

const chevron = (up) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${up ? 'M6 15l6-6 6 6' : 'M6 9l6 6 6-6'}"/></svg>`;

export const diary = {
  mount(el) {
    let cur = todayISO();
    el.innerHTML = `
      <header class="page-head">
        <h1>오늘 하루</h1>
        <button class="btn pill" type="button" data-nav="today" hidden>오늘 일기</button>
      </header>
      <div class="card placeholder diary-setup" data-slot="setup" hidden>
        <strong>일기 표를 불러오지 못했어요</strong>
        <span class="muted small">Supabase 에 <code>supabase/016_diary.sql</code> 을 실행하지 않았다면 SQL Editor 에서 한 번 Run 해 주세요. 이미 실행했다면 잠시 뒤 아래 버튼으로 다시 확인해 보세요.</span>
        <span class="small red" data-slot="setup-err"></span>
        <button class="btn pill" type="button" data-act="recheck">다시 확인</button>
      </div>
      <div class="diary-layout">
      <div class="diary-pager">
        <button class="diary-nav" type="button" data-nav="-1" aria-label="이전 날">${chevron(true)}</button>
        <button class="diary-peek" type="button" data-nav="-1" data-slot="peek-prev"></button>
        <section class="card diary-day diary-main" data-slot="main">
          <header class="diary-head">
            <h2 data-slot="title"></h2>
            <span class="red small" data-slot="hol"></span>
            <span class="grow"></span>
            <span class="diary-state muted small" data-slot="state" role="status"></span>
          </header>
          <textarea class="diary-text" maxlength="5000"></textarea>
        </section>
        <button class="diary-peek" type="button" data-nav="1" data-slot="peek-next"></button>
        <button class="diary-nav" type="button" data-nav="1" aria-label="다음 날">${chevron(false)}</button>
      </div>
      <aside class="diary-side">
        <section class="card mini-cal" aria-label="일기 달력">
          <header class="mc-head">
            <button class="icon-btn" type="button" data-mc="-1" aria-label="이전 달">${chevron(true).replace('M6 15l6-6 6 6', 'M15 6l-6 6 6 6')}</button>
            <strong data-slot="mc-title"></strong>
            <button class="icon-btn" type="button" data-mc="1" aria-label="다음 달">${chevron(true).replace('M6 15l6-6 6 6', 'M9 6l6 6-6 6')}</button>
          </header>
          <div class="mc-week">${WD.map((w, i) => `<span class="${i === 0 ? 'red' : i === 6 ? 'blue' : ''}">${w}</span>`).join('')}</div>
          <div class="mc-grid" data-slot="mc-grid"></div>
        </section>
        <section class="card diary-search">
          <input type="search" class="ds-input" data-slot="q" placeholder="키워드 검색" autocomplete="off" aria-label="키워드 검색">
          <div class="ds-results" data-slot="results" role="list"></div>
        </section>
      </aside>
      </div>`;

    const main = el.querySelector('[data-slot=main]');
    const ta = main.querySelector('textarea');
    const stateEl = main.querySelector('[data-slot=state]');

    const peekHTML = (iso, s) => {
      const row = s.data.diary.find((r) => r.entry_date === iso);
      const tag = tagOf(iso);
      return `<span class="peek-date">${tag ? `<b>${tag}</b>` : ''}${dateText(iso)}</span><span class="peek-text">${esc(row?.body ?? '')}</span>`;
    };

    // ── 오른쪽: 미니 달력 / 키워드 검색 ──
    let vy, vm; // 미니 달력이 보여주는 달
    const monthOf = (iso) => { const d = parseDate(iso); vy = d.getFullYear(); vm = d.getMonth(); };
    monthOf(cur);
    const q = el.querySelector('[data-slot=q]');
    const paintCal = (s) => {
      el.querySelector('[data-slot=mc-title]').textContent = `${vy}년 ${vm + 1}월`;
      const has = new Set(s.data.diary.filter((r) => r.body.trim()).map((r) => r.entry_date));
      const first = new Date(vy, vm, 1).getDay();
      const n = new Date(vy, vm + 1, 0).getDate();
      const t = todayISO();
      const cells = Array.from({ length: first }, () => '<span></span>');
      for (let d = 1; d <= n; d++) {
        const iso = toISODate(new Date(vy, vm, d));
        const dow = new Date(vy, vm, d).getDay();
        cells.push(`<button type="button" class="mc-cell ${iso === t ? 'today' : ''} ${iso === cur ? 'sel' : ''} ${has.has(iso) ? 'has' : ''} ${dow === 0 ? 'red' : dow === 6 ? 'blue' : ''}" data-go="${iso}" aria-label="${dateText(iso)}${has.has(iso) ? ', 일기 있음' : ''}">${d}</button>`);
      }
      el.querySelector('[data-slot=mc-grid]').innerHTML = cells.join('');
    };
    const paintSearch = (s) => {
      const k = q.value.trim();
      const box = el.querySelector('[data-slot=results]');
      if (!k) { box.innerHTML = ''; return; }
      const hits = s.data.diary.filter((r) => r.body.toLowerCase().includes(k.toLowerCase())).sort((a, b) => b.entry_date.localeCompare(a.entry_date));
      box.innerHTML = hits.length
        ? `<p class="muted small">${hits.length}개의 일기</p>` + hits.slice(0, 40).map((r) => `<button type="button" class="ds-hit ${r.entry_date === cur ? 'sel' : ''}" data-go="${r.entry_date}"><span class="ds-date">${dateText(r.entry_date)}</span><span class="ds-snip">${snippet(r.body, k)}</span></button>`).join('')
        : '<p class="muted small">찾는 일기가 없어요.</p>';
    };

    // 화면 전체를 현재 날짜 기준으로 다시 맞춘다 (쓰고 있는 칸은 건드리지 않음)
    const paint = (s, { force = false } = {}) => {
      const iso = cur;
      const t = todayISO();
      el.querySelector('[data-slot=setup]').hidden = s.diaryReady;
      el.querySelector('[data-slot=setup-err]').textContent = s.diaryError ? `서버 응답: ${s.diaryError}` : '';
      ta.disabled = !s.diaryReady;
      main.dataset.date = iso;
      main.classList.toggle('is-today', iso === t);
      const tag = tagOf(iso);
      main.querySelector('[data-slot=title]').innerHTML = `${tag ? `<span class="diary-tag ${iso === t ? 'now' : ''}">${tag}</span>` : ''}${dateText(iso)}`;
      const h = holidayOn(iso, s);
      main.querySelector('[data-slot=hol]').textContent = h.kr || h.custom || '';
      ta.placeholder = iso === t ? '오늘 하루는 어땠나요?' : ''; // 안내 문구는 오늘 칸에만
      ta.setAttribute('aria-label', `${dateText(iso)} 일기`);
      el.querySelector('[data-nav=today]').hidden = iso === t;
      el.querySelector('[data-slot=peek-prev]').innerHTML = peekHTML(addDays(iso, -1), s);
      el.querySelector('[data-slot=peek-next]').innerHTML = peekHTML(addDays(iso, 1), s);
      el.querySelector('[data-slot=peek-prev]').setAttribute('aria-label', `${dateText(addDays(iso, -1))} 일기로 이동`);
      el.querySelector('[data-slot=peek-next]').setAttribute('aria-label', `${dateText(addDays(iso, 1))} 일기로 이동`);
      paintCal(s);
      paintSearch(s);
      // 쓰는 중(칸에 커서가 있거나 저장 대기 중)에는 다른 기기·실시간 변경이 내용을 덮어쓰지 못하게 고정한다
      if (force || (document.activeElement !== ta && !pending.has(iso))) {
        const row = s.data.diary.find((r) => r.entry_date === iso);
        const text = row?.body ?? '';
        if (ta.value !== text) ta.value = text;
        grow(ta);
      }
    };

    // 다른 날로: 먼저 저장한 뒤, 본문이 부드럽게 밀려 나갔다가 새 날짜가 밀려 들어온다.
    // 멀리 갈 때는 나간 사이에 날짜(제목·달력 표시)가 빠르게 넘어가며(촤르륵) 도착한다. 이동하는 동안은 입력을 잠근다.
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    const calm = window.matchMedia('(prefers-reduced-motion: reduce)');
    const move = (kf, ms, easing) => (calm.matches ? Promise.resolve() : ta.animate(kf, { duration: ms, easing, fill: 'forwards' }).finished.catch(() => {}));
    let busy = false;
    const go = async (delta, absolute) => {
      const target = absolute ?? addDays(cur, delta);
      if (target === cur || busy) return;
      busy = true;
      const p = pending.get(cur);
      if (p) {
        p.stateEl = document.createElement('span'); // 저장 결과 표시가 새 날짜 칸을 어지럽히지 않게 떼어 둔다
        flush(cur);
      }
      setState(stateEl, '');
      ta.readOnly = true;
      const start = cur;
      const diff = dayDiff(start, target);
      const sign = diff > 0 ? 1 : -1;
      const steps = Math.min(Math.abs(diff), 9);
      // 1) 지금 본문이 위(또는 아래)로 사라진다
      await move([{ transform: 'none', opacity: 1 }, { transform: `translateY(${-sign * 22}px)`, opacity: 0 }], steps > 1 ? 180 : 140, 'cubic-bezier(0.4, 0, 1, 1)');
      // 2) 멀리 가면 사이 날짜가 빠르게 넘어간다 (본문은 숨은 상태)
      for (let k = 1; k < steps; k++) {
        cur = addDays(start, Math.round((diff * k) / steps));
        paint(store.getState(), { force: true });
        await sleep(48);
      }
      // 3) 도착한 날짜의 본문이 밀려 들어온다
      cur = target;
      monthOf(cur);
      paint(store.getState(), { force: true });
      await move([{ transform: `translateY(${sign * 26}px)`, opacity: 0 }, { transform: 'none', opacity: 1 }], 300, 'cubic-bezier(0.22, 1, 0.36, 1)');
      ta.getAnimations().forEach((an) => an.cancel());
      ta.readOnly = false;
      busy = false;
      window.scrollTo({ top: 0, behavior: calm.matches ? 'auto' : 'smooth' });
    };

    el.addEventListener('click', async (e) => {
      if (e.target.closest('[data-act=recheck]')) {
        await store.reload();
        paint(store.getState(), { force: true });
        return;
      }
      const g = e.target.closest('[data-go]');
      if (g) return go(0, g.dataset.go);
      const m = e.target.closest('[data-mc]');
      if (m) {
        const d = new Date(vy, vm + Number(m.dataset.mc), 1);
        vy = d.getFullYear();
        vm = d.getMonth();
        return paintCal(store.getState());
      }
      const b = e.target.closest('[data-nav]');
      if (!b) return;
      if (b.dataset.nav === 'today') go(0, todayISO());
      else go(Number(b.dataset.nav));
    });
    q.addEventListener('input', () => paintSearch(store.getState()));
    q.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter') return;
      const first = el.querySelector('.ds-hit');
      if (first) go(0, first.dataset.go);
    });
    ta.addEventListener('input', () => {
      grow(ta);
      setState(stateEl, '입력 중…');
      clearTimeout(pending.get(cur)?.timer);
      const iso = cur;
      pending.set(iso, { timer: setTimeout(() => flush(iso), SAVE_DELAY), ta, stateEl });
    });
    ta.addEventListener('blur', () => flush(cur));

    // 눌러서 이동하려는 순간 저장이 끝나 화면이 다시 그려지면 누른 칸이 사라져 클릭이 무시된다.
    // 그래서 마우스·손가락이 눌린 동안에는 다시 그리기를 미루고, 클릭이 끝난 뒤에 그린다.
    let pressing = false;
    let deferred = false;
    el.addEventListener('pointerdown', () => {
      pressing = true;
      const ac = new AbortController();
      const done = () => {
        ac.abort();
        setTimeout(() => {
          pressing = false;
          if (deferred) { deferred = false; paint(store.getState()); }
        }, 0);
      };
      window.addEventListener('pointerup', done, { once: true, capture: true, signal: ac.signal });
      window.addEventListener('pointercancel', done, { once: true, capture: true, signal: ac.signal });
    }, true);

    ctx = { el, go: (d) => go(d) };
    el._paint = (s) => { if (pressing) deferred = true; else paint(s); };
    paint(store.getState(), { force: true });
  },

  update(el, s) {
    el._paint?.(s);
  },
};
