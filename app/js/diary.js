// 오늘 하루: 하루에 하나씩 쓰는 일기. 가운데 큰 페이지에 쓰고, 위(어제)·아래(내일) 작고 흐린 페이지를 눌러 넘긴다.
// 입력하면 잠깐 멈춘 뒤 자동 저장된다 (저장 버튼 없음).
import { fixBeforeCaret } from './spell.js';
import * as store from './store.js';
import { esc, parseDate, toISODate, todayLocal, icons } from './util.js';
import { addDays } from './recur.js';
import { holidayOn } from './holidays.js';
import { eventsOn, eventTime } from './recur.js';
import { colorOf } from './colors.js';
import { emojiTag } from './emoji.js';

const WD = ['일', '월', '화', '수', '목', '금', '토'];
const SAVE_DELAY = 900;
const todayISO = () => toISODate(todayLocal());
// 캘린더와 같은 규칙: 공휴일·일요일은 빨강, 토요일은 파랑
const toneOf = (iso, s) => {
  const h = holidayOn(iso, s);
  const dow = parseDate(iso).getDay();
  return h.kr || h.custom || dow === 0 ? 'red' : dow === 6 ? 'blue' : '';
};
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

// 키보드: 쓰고 있지 않을 때 ← → 로 넘기기 (데스크탑)
let ctx = null;
window.addEventListener('keydown', (e) => {
  if (!ctx?.el.isConnected || e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey) return;
  if (document.querySelector('dialog[open]')) return;
  const t = e.target;
  if (t && (/^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName) || t.isContentEditable)) return;
  if (e.key === 'ArrowLeft') { e.preventDefault(); ctx.go(-1); }
  else if (e.key === 'ArrowRight') { e.preventDefault(); ctx.go(1); }
});

// 좌우 화살표 (옆 페이지 위에 얹는다)
const arrow = (dir) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${dir < 0 ? 'M15 6l-6 6 6 6' : 'M9 6l6 6-6 6'}"/></svg>`;
const chevron = (up) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${up ? 'M6 15l6-6 6 6' : 'M6 9l6 6 6-6'}"/></svg>`;

export const diary = {
  mount(el) {
    let cur = todayISO();
    el.innerHTML = `
      <header class="diary-top">
        <div class="dt-title"><span class="dt-eyebrow">오늘 하루</span><h1 data-slot="title"></h1></div>
        <button class="dt-btn dt-prev" type="button" data-nav="-1" aria-label="이전 날">${arrow(-1)}</button>
        <button class="dt-btn dt-today" type="button" data-nav="today" hidden>오늘로</button>
        <button class="dt-btn dt-next" type="button" data-nav="1" aria-label="다음 날">${arrow(1)}</button>
      </header>
      <div class="card placeholder diary-setup" data-slot="setup" hidden>
        <strong>일기 표를 불러오지 못했어요</strong>
        <span class="muted small">Supabase 에 <code>supabase/016_diary.sql</code> 을 실행하지 않았다면 SQL Editor 에서 한 번 Run 해 주세요. 이미 실행했다면 잠시 뒤 아래 버튼으로 다시 확인해 보세요.</span>
        <span class="small red" data-slot="setup-err"></span>
        <button class="btn pill" type="button" data-act="recheck">다시 확인</button>
      </div>
      <nav class="diary-week" data-slot="week" aria-label="이번 주"></nav>
      <div class="diary-layout">
      <div class="diary-col">
        <section class="card diary-day diary-main" data-slot="main">
          <div class="diary-head" data-slot="head">
            <span class="red small" data-slot="hol"></span>
            <div class="diary-stickers" data-slot="stickers"></div>
          </div>
          <textarea class="diary-text" maxlength="5000" lang="ko" spellcheck="true" autocorrect="on" autocapitalize="off"></textarea>
          <footer class="diary-foot">
            <span class="muted small" data-slot="count"></span>
            <span class="diary-state muted small" data-slot="state" role="status"></span>
          </footer>
        </section>
        <button class="card diary-prev" type="button" data-nav="-1" data-slot="peek-prev"></button>
        <div class="diary-mtools">
          <button class="btn" type="button" data-open="cal">${icons.calendar}달력</button>
          <button class="btn" type="button" data-open="search"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/></svg>지난 기록 검색</button>
        </div>
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
          <p class="mc-legend"><i aria-hidden="true"></i>기록이 있는 날</p>
        </section>
        <section class="card diary-search">
          <label class="ds-field"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/></svg><input type="search" class="ds-input" data-slot="q" placeholder="키워드로 지난 기록 찾기" autocomplete="off" aria-label="키워드 검색"></label>
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
      const body = row?.body.trim() ? `<span class="dp-text">${esc(row.body.trim().split('\n')[0])}</span>` : '<span class="dp-text muted">쓴 기록이 없어요</span>';
      return `<span class="dp-date">${tag ? `${tag} · ` : ''}<span class="${toneOf(iso, s)}">${dateText(iso)}</span></span>${body}<span class="dp-arrow">${arrow(1)}</span>`;
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
      if (!k) {
        const recent = s.data.diary.filter((r) => r.body.trim()).sort((a, b) => b.entry_date.localeCompare(a.entry_date)).slice(0, 3);
        box.innerHTML = recent.length
          ? '<p class="ds-label">지난 기록</p>' + recent.map((r) => `<button type="button" class="ds-hit ${r.entry_date === cur ? 'sel' : ''}" data-go="${r.entry_date}"><span class="ds-date">${dateText(r.entry_date)}</span><span class="ds-snip">${esc(r.body.trim().split('\n')[0])}</span></button>`).join('')
          : '';
        return;
      }
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
            const tag = tagOf(iso);
      el.querySelector('[data-slot=title]').innerHTML = `${tag ? `<span class="diary-tag ${iso === t ? 'now' : ''}">${tag}</span>` : ''}<span class="diary-date ${toneOf(iso, s)}">${dateText(iso)}</span>`;
      // 그날의 일정 제목을 스티커처럼 붙인다 (휴일 표시는 위의 빨간 이름으로 이미 나옴)
      main.querySelector('[data-slot=stickers]').innerHTML = eventsOn(iso, s.data.events)
        .filter((ev) => !ev.is_holiday)
        .map((ev) => `<span class="diary-sticker" style="--bg:${colorOf(ev.color).bg};--bar:${colorOf(ev.color).bar}" title="${esc(`${eventTime(ev)} ${ev.title}`.trim())}"><span class="st-t">${esc(ev.title)}</span>${emojiTag(ev)}</span>`)
        .join('');
      const h = holidayOn(iso, s);
      main.querySelector('[data-slot=hol]').textContent = h.kr || h.custom || '';
      main.querySelector('[data-slot=head]').hidden = !(h.kr || h.custom) && !main.querySelector('.diary-sticker');
      ta.placeholder = iso === t ? '오늘 하루는 어땠나요?' : ''; // 안내 문구는 오늘 칸에만
      ta.setAttribute('aria-label', `${dateText(iso)} 일기`);
      el.querySelector('[data-nav=today]').hidden = iso === t;
      el.querySelector('[data-slot=peek-prev]').innerHTML = peekHTML(addDays(iso, -1), s);
      el.querySelector('[data-slot=peek-prev]').setAttribute('aria-label', `${dateText(addDays(iso, -1))} 일기로 이동`);
      // 모바일: 보고 있는 날이 든 한 주(일~토)
      const sun = addDays(iso, -parseDate(iso).getDay());
      const has = new Set(s.data.diary.filter((r) => r.body.trim()).map((r) => r.entry_date));
      el.querySelector('[data-slot=week]').innerHTML = WD.map((w, i) => {
        const d = addDays(sun, i);
        return `<button type="button" class="dw-day ${d === iso ? 'sel' : ''} ${d === t ? 'today' : ''} ${has.has(d) ? 'has' : ''} ${toneOf(d, s)}" data-go="${d}" aria-label="${dateText(d)}${has.has(d) ? ', 일기 있음' : ''}"><span class="dw-w">${w}</span><span class="dw-n">${parseDate(d).getDate()}</span></button>`;
      }).join('');
      paintCal(s);
      paintSearch(s);
      // 쓰는 중(칸에 커서가 있거나 저장 대기 중)에는 다른 기기·실시간 변경이 내용을 덮어쓰지 못하게 고정한다
      if (force || (document.activeElement !== ta && !pending.has(iso))) {
        const row = s.data.diary.find((r) => r.entry_date === iso);
        const text = row?.body ?? '';
        if (ta.value !== text) ta.value = text;
        grow(ta);
      }
      main.querySelector('[data-slot=count]').textContent = `${ta.value.length.toLocaleString('ko-KR')}자`;
    };

    // 다른 날로: 먼저 저장한 뒤, 본문이 부드럽게 밀려 나갔다가 새 날짜가 밀려 들어온다.
    // 멀리 갈 때는 나간 사이에 날짜(제목·달력 표시)가 빠르게 넘어가며(촤르륵) 도착한다. 이동하는 동안은 입력을 잠근다.
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    const calm = window.matchMedia('(prefers-reduced-motion: reduce)');
    const move = (kf, ms, easing) => (calm.matches ? Promise.resolve() : main.animate(kf, { duration: ms, easing, fill: 'forwards' }).finished.catch(() => {}));
    let busy = false;
    const go = async (delta, absolute, fromX = 0) => {
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
      // 1) 지금 카드 전체(제목·스티커·본문)가 위(또는 아래)로 밀려 나간다. 멀리 갈 때는 날짜가 넘어가는 게 보이도록 완전히 지우지 않는다
      const low = steps > 1 ? 0.3 : 0;
      await move([{ transform: `translateX(${fromX}px)`, opacity: fromX ? 0.85 : 1 }, { transform: `translateX(${-sign * (fromX ? 90 : 26)}px)`, opacity: low }], steps > 1 ? 180 : 150, 'cubic-bezier(0.4, 0, 1, 1)');
      // 2) 멀리 가면 사이 날짜가 빠르게 넘어간다 (본문은 숨은 상태)
      for (let k = 1; k < steps; k++) {
        cur = addDays(start, Math.round((diff * k) / steps));
        paint(store.getState(), { force: true });
        await sleep(48);
      }
      // 3) 도착한 날짜의 카드 전체가 반대쪽에서 밀려 들어온다
      cur = target;
      monthOf(cur);
      paint(store.getState(), { force: true });
      await move([{ transform: `translateX(${sign * 30}px)`, opacity: low }, { transform: 'none', opacity: 1 }], 320, 'cubic-bezier(0.22, 1, 0.36, 1)');
      main.getAnimations().forEach((an) => an.cancel());
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
      const op = e.target.closest('[data-open]');
      if (op) {
        el.dataset.open = el.dataset.open === op.dataset.open ? '' : op.dataset.open;
        el.querySelectorAll('[data-open]').forEach((x) => x.setAttribute('aria-expanded', String(el.dataset.open === x.dataset.open)));
        if (el.dataset.open) el.querySelector(el.dataset.open === 'cal' ? '.mini-cal' : '.diary-search').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        if (el.dataset.open === 'search') q.focus({ preventScroll: true });
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
    ta.addEventListener('input', (e) => {
      // 맞춤법: 낱말을 끝낸 순간 틀리기 쉬운 말을 고친다 (한글 입력 중에는 건드리지 않음)
      let fixedMsg = '';
      if (!e.isComposing && ta.selectionStart === ta.selectionEnd) {
        const fx = fixBeforeCaret(ta.value, ta.selectionStart);
        if (fx) {
          const caret = ta.selectionStart + (fx.text.length - (fx.to - fx.from));
          ta.setRangeText(fx.text, fx.from, fx.to, 'preserve');
          ta.setSelectionRange(caret, caret);
          fixedMsg = `맞춤법 고침: ${fx.before} → ${fx.text}`;
        }
      }
      grow(ta);
      main.querySelector('[data-slot=count]').textContent = `${ta.value.length.toLocaleString('ko-KR')}자`;
      setState(stateEl, fixedMsg || '입력 중…');
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

    // 폰: 카드를 좌우로 밀어서 넘기기. 손가락을 따라 움직이다가 충분히 밀고 놓으면 이동하고, 모자라면 제자리로 돌아간다.
    // 세로로 밀면 그냥 스크롤이고, 글을 쓰는 칸의 터치는 가로로 크게 움직일 때만 가로챈다.
    let sw = null;
    const settle = () => { main.style.transform = ''; main.style.opacity = ''; main.style.userSelect = ''; };
    main.addEventListener('pointerdown', (e) => {
      if (e.pointerType !== 'touch' || busy || !e.isPrimary) return;
      sw = { x: e.clientX, y: e.clientY, dx: 0, on: false, id: e.pointerId };
    });
    main.addEventListener('pointermove', (e) => {
      if (!sw || e.pointerId !== sw.id) return;
      const dx = e.clientX - sw.x;
      const dy = e.clientY - sw.y;
      if (!sw.on) {
        if (Math.abs(dy) > 10 && Math.abs(dy) > Math.abs(dx)) { sw = null; return; }
        if (Math.abs(dx) < 14) return;
        sw.on = true;
        try { main.setPointerCapture(e.pointerId); } catch { /* 이미 끝난 터치 */ }
        main.style.userSelect = 'none';
      }
      sw.dx = dx;
      main.style.transform = `translateX(${dx * 0.9}px)`;
      main.style.opacity = String(1 - Math.min(Math.abs(dx) / 500, 0.25));
    });
    const endSwipe = (e, cancelled) => {
      if (!sw || e.pointerId !== sw.id) return;
      const { dx, on } = sw;
      sw = null;
      if (!on) return;
      // 밀고 난 뒤에 따라오는 '클릭'이 글 쓰는 칸을 눌러 키보드가 뜨지 않게 막는다
      main.addEventListener('click', (ev) => ev.stopPropagation(), { capture: true, once: true });
      setTimeout(() => main.removeEventListener('click', () => {}, true), 400);
      const far = Math.abs(dx) > Math.min(90, main.clientWidth * 0.22);
      if (!cancelled && far) {
        settle();
        go(dx < 0 ? 1 : -1, undefined, dx * 0.9);
      } else {
        const back = calm.matches ? Promise.resolve() : main.animate([{ transform: main.style.transform || 'none', opacity: main.style.opacity || 1 }, { transform: 'none', opacity: 1 }], { duration: 200, easing: 'cubic-bezier(0.22, 1, 0.36, 1)' }).finished.catch(() => {});
        back.then(settle);
      }
    };
    main.addEventListener('pointerup', (e) => endSwipe(e, false));
    main.addEventListener('pointercancel', (e) => endSwipe(e, true));

    ctx = { el, go: (d) => go(d) };
    el._paint = (s) => { if (pressing) deferred = true; else paint(s); };
    paint(store.getState(), { force: true });
  },

  update(el, s) {
    el._paint?.(s);
  },
};
