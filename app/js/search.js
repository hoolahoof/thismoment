// 일정 검색: 제목·메모로 찾고, 결과를 누르면 그 날짜로 이동 (반복 일정은 다음에 오는 날).
import * as store from './store.js';
import { esc, toISODate, parseDate, todayLocal, icons } from './util.js';
import { localISO, nextOccurrenceISO, parseRule, describeRule, eventTime } from './recur.js';
import { colorOf, REPEAT_ICON } from './colors.js';

const WD = ['일', '월', '화', '수', '목', '금', '토'];
const label = (iso) => {
  const d = parseDate(iso);
  return `${d.getFullYear()}.${d.getMonth() + 1}.${d.getDate()} (${WD[d.getDay()]})`;
};
const norm = (t) => String(t ?? '').toLowerCase().normalize('NFC');

export function searchDialogHTML() {
  return `
  <dialog class="sheet tall" data-slot="search-dialog" aria-label="일정 검색">
    <div class="form srch">
      <div class="srch-bar">
        <input type="search" name="q" placeholder="일정 검색 (제목, 메모)" aria-label="일정 검색" autocomplete="off" autocapitalize="off" enterkeyhint="search">
        <button class="btn" type="button" data-action="close">닫기</button>
      </div>
      <p class="muted small" data-slot="srch-hint"></p>
      <ul class="list" data-slot="results"></ul>
    </div>
  </dialog>`;
}

// ctx: { onPick(iso) }
export function setupSearch(root, ctx) {
  const dlg = root.querySelector('[data-slot=search-dialog]');
  const input = dlg.querySelector('input[name=q]');
  const list = dlg.querySelector('[data-slot=results]');
  const hint = dlg.querySelector('[data-slot=srch-hint]');

  function render() {
    const q = norm(input.value.trim());
    const todayISO = toISODate(todayLocal());
    const rows = store.getState().data.events
      .filter((ev) => !q || norm(ev.title).includes(q) || norm(ev.note).includes(q))
      .map((ev) => {
        const next = nextOccurrenceISO(ev, todayISO);
        return { ev, iso: next ?? localISO(ev.starts_at), upcoming: next !== null };
      })
      .sort((a, b) => (b.upcoming - a.upcoming) || (a.upcoming ? a.iso.localeCompare(b.iso) : b.iso.localeCompare(a.iso)));
    const shown = rows.slice(0, 60);
    hint.textContent = q
      ? rows.length ? `${rows.length}개${rows.length > shown.length ? ' (앞의 60개만 보여요)' : ''}` : ''
      : '다가오는 일정이에요. 검색어를 입력해 보세요.';
    list.innerHTML = shown.length
      ? shown.map(({ ev, iso, upcoming }) => {
          const rule = parseRule(ev.recurrence);
          return `
          <li>
            <button class="card srch-row ${upcoming ? '' : 'past'}" data-iso="${iso}">
              <span class="ev-bar" style="background:${colorOf(ev.color).bar}"></span>
              <span class="srch-date">${label(iso)}${upcoming ? '' : '<span class="small">지난 일정</span>'}</span>
              <span class="srch-main">
                <span class="row-title">${esc(ev.title)}${rule ? REPEAT_ICON : ''}</span>
                <span class="muted small">${ev.is_holiday ? '휴일 · ' : ''}${eventTime(ev)}${rule ? ` · ${describeRule(rule)}` : ''}${ev.note ? ` · ${esc(ev.note)}` : ''}</span>
              </span>
            </button>
          </li>`;
        }).join('')
      : `<li class="empty muted">${q ? '찾는 일정이 없어요.' : '일정이 없어요.'}</li>`;
  }

  input.addEventListener('input', render);
  list.addEventListener('click', (e) => {
    const b = e.target.closest('[data-iso]');
    if (!b) return;
    dlg.close();
    ctx.onPick(b.dataset.iso);
  });
  dlg.querySelector('[data-action=close]').addEventListener('click', () => dlg.close());
  dlg.addEventListener('click', (e) => {
    if (e.target === dlg) dlg.close();
  });

  return {
    open() {
      input.value = '';
      render();
      dlg.showModal();
      input.focus();
    },
    refresh() {
      if (dlg.open) render();
    },
  };
}

export const searchIcon = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/></svg>';
