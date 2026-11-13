// 화면들. 각 화면은 mount(el) 로 한 번 그리고, update(state) 로 데이터 부분만 다시 그린다.
// 월간 캘린더는 calendar.js, 하루 타임블록은 day.js.
import * as store from './store.js';
import { logout } from './app.js';
import { lockSupported, isLockEnabled, enableLock, disableLock } from './lock.js';
import { esc, ddayIcon, fmtDate, ddayLabel, daysUntil, todayLocal, toISODate, icons } from './util.js';
import { nextRing, isOnce } from './holidays.js';
import { SUPABASE_URL, SUPABASE_KEY } from '../config.js';
import { calendar, setSelected } from './calendar.js';
import { localISO, lastDayISO, nextOccurrenceISO } from './recur.js';
import { day } from './day.js';
import { home } from './home.js';
import { getTheme, setTheme } from './theme.js';
import { pushSupported, isStandalone, pushState, enablePush, disablePush } from './push.js';

export const SHORTCUT_NAME = 'ThisMoment 알람 동기화';
const SHORTCUT_RUN_URL = 'shortcuts://run-shortcut?name=' + encodeURIComponent(SHORTCUT_NAME);

const STATUS_TEXT = {
  idle: '연결 대기',
  syncing: '동기화 중…',
  live: '실시간 동기화됨',
  offline: '오프라인 · 다시 연결하면 맞춰져요',
};
export const statusBadge = (s) => `<span class="sync sync-${s}"><span class="dot"></span>${STATUS_TEXT[s]}</span>`;

function header(title, right = '') {
  return `<header class="page-head"><h1>${title}</h1>${right}</header>`;
}

// ── 디데이 (동기화 확인용 기본 기능) ──
const dday = {
  mount(el) {
    el.innerHTML = `
      ${header('디데이')}
      <div data-slot="hero"></div>
      <h2 class="section-title">전체</h2>
      <ul class="list" data-slot="list"></ul>
      <nav class="pager" data-slot="pager" aria-label="디데이 페이지" hidden>
        <button class="btn pill" type="button" data-page="-1">이전</button>
        <span class="muted small" data-slot="page-info"></span>
        <button class="btn pill" type="button" data-page="1">다음</button>
      </nav>
      <h2 class="section-title">디데이 추가</h2>
      <form class="card form inline-form" data-slot="form">
        <label>이름<input name="title" required maxlength="40" placeholder="예: 여행 출발"></label>
        <label>날짜<input name="target_date" type="date" required value="${toISODate(todayLocal())}"></label>
        <button class="btn primary" type="submit">${icons.plus}추가</button>
        <p class="form-msg" role="status"></p>
      </form>`;

    el.querySelector('[data-slot=form]').addEventListener('submit', async (e) => {
      e.preventDefault();
      const f = e.target;
      const fe = f.elements;
      const msg = f.querySelector('.form-msg');
      const title = fe.namedItem('title').value.trim();
      const target = fe.namedItem('target_date').value;
      if (!title || !target) return;
      try {
        const made = await store.insert('ddays', { title, target_date: target, count_up: false });
        // 디데이 날짜에 하루 종일 일정도 같이 만든다 (디데이를 지우면 이 일정도 같이 지워짐)
        const at = new Date(`${target}T00:00`).toISOString();
        const ev = { title, all_day: true, color: 'purple', starts_at: at, ends_at: at };
        try {
          await store.insert('events', { ...ev, dday_id: made.id });
        } catch {
          // SQL 014 를 아직 안 돌렸으면 연결 칸이 없어서 실패한다 → 연결 없이 일정만 만든다
          try { await store.insert('events', ev); } catch { /* 일정은 못 만들어도 디데이는 저장됨 */ }
        }
        fe.namedItem('title').value = '';
        msg.classList.remove('error');
        msg.textContent = '';
      } catch (err) {
        msg.textContent = '저장하지 못했어요: ' + err.message;
        msg.classList.add('error');
      }
    });

    el.querySelector('[data-slot=pager]').addEventListener('click', (e) => {
      const b = e.target.closest('[data-page]');
      if (!b) return;
      el.dataset.page = String(Number(el.dataset.page || 0) + Number(b.dataset.page));
      dday.update(el, store.getState());
    });

    el.querySelector('[data-slot=list]').addEventListener('click', async (e) => {
      const btn = e.target.closest('button[data-action]');
      if (!btn) return;
      const id = btn.dataset.id;
      const item = store.getState().data.ddays.find((d) => d.id === id);
      if (!item) return;
      try {
        if (btn.dataset.action === 'delete') {
          if (confirm(`'${item.title}' 디데이를 지울까요? (같이 만들어진 일정도 지워져요)`)) {
            for (const ev of store.getState().data.events.filter((e) => e.dday_id === id)) await store.remove('events', ev.id);
            await store.remove('ddays', id);
          }
        } else if (btn.dataset.action === 'widget') {
          // 위젯에 고정은 하나만: 새로 고정하면 나머지는 해제, 이미 고정이면 해제
          const on = !item.show_in_widget;
          if (on) {
            for (const o of store.getState().data.ddays) {
              if (o.id !== id && o.show_in_widget) await store.update('ddays', o.id, { show_in_widget: false });
            }
          }
          await store.update('ddays', id, { show_in_widget: on });
        }
      } catch (err) {
        alert('저장하지 못했어요: ' + err.message);
      }
    });
  },
  update(el, s) {
    const all = s.data.ddays;
    const upcoming = all.filter((d) => !d.count_up && daysUntil(d.target_date) >= 0)
      .sort((x, y) => x.target_date.localeCompare(y.target_date));
    // 위젯에 고정한 디데이 (지나갔으면 자동으로 가장 가까이 남은 디데이로 바뀐다)
    const pinned = all.find((d) => d.show_in_widget && (d.count_up || daysUntil(d.target_date) >= 0));
    const hero = pinned ?? upcoming[0];
    el.querySelector('[data-slot=hero]').innerHTML = hero ? (() => {
      const n = daysUntil(hero.target_date);
      const near = !hero.count_up && n >= 0 && n <= 7;
      return `
      <section class="card dday-hero ${near ? 'is-near' : ''}">
        <div class="dday-hero-top"><span class="dday-hero-title">${esc(hero.title)}</span><span class="dday-card-ic">${ddayIcon(hero.title)}</span></div>
        <div class="dday-hero-count">${ddayLabel(hero)}</div>
        <div class="dday-hero-date">${fmtDate(hero.target_date)}</div>
      </section>`;
    })() : '';

    // 정렬: 다가오는 것(가까운 순) → 기념일 세기 → 지난 것(최근 순)
    const group = (d) => (!d.count_up && daysUntil(d.target_date) >= 0 ? 0 : d.count_up ? 1 : 2);
    const list = [...all].sort((a, b) => group(a) - group(b) || (group(a) === 2 ? b.target_date.localeCompare(a.target_date) : a.target_date.localeCompare(b.target_date)));
    const PAGE = 8;
    const pages = Math.max(1, Math.ceil(list.length / PAGE));
    const page = Math.min(Math.max(Number(el.dataset.page || 0), 0), pages - 1);
    el.dataset.page = String(page);
    const pager = el.querySelector('[data-slot=pager]');
    pager.hidden = pages <= 1;
    pager.querySelector('[data-page="-1"]').disabled = page === 0;
    pager.querySelector('[data-page="1"]').disabled = page >= pages - 1;
    el.querySelector('[data-slot=page-info]').textContent = `${page + 1} / ${pages} (전체 ${list.length}개)`;
    el.querySelector('[data-slot=list]').innerHTML = list.length
      ? list.slice(page * PAGE, page * PAGE + PAGE)
          .map(
            (d) => `
        <li class="card row dday-row ${!d.count_up && daysUntil(d.target_date) >= 0 && daysUntil(d.target_date) <= 7 ? 'is-near' : ''}">
          <div class="row-main">
            <span class="row-title">${esc(d.title)}</span>
            <span class="muted small">${fmtDate(d.target_date)}${d.count_up ? ' 부터' : ''}</span>
          </div>
          <strong class="dday-num">${ddayLabel(d)}</strong>
          <div class="widget-sw"><button class="switch" data-action="widget" data-id="${d.id}" aria-pressed="${!!d.show_in_widget}" aria-label="${d.show_in_widget ? '위젯 고정 해제' : '위젯에 고정'}" title="위젯에 고정"><span></span></button></div>
          <button class="icon-btn" data-action="delete" data-id="${d.id}" aria-label="${esc(d.title)} 삭제">${icons.trash}</button>
        </li>`
          )
          .join('')
      : '<li class="empty muted">아직 디데이가 없어요. 아래에서 추가해 보세요.</li>';
  },
};

// ── 알람 ──
const WD = ['일', '월', '화', '수', '목', '금', '토'];
const daysText = (days) => {
  const set = [...days].sort((a, b) => a - b).join(',');
  if (set === '0,1,2,3,4,5,6') return '매일';
  if (set === '1,2,3,4,5') return '평일';
  if (set === '0,6') return '주말';
  return [...days].sort((a, b) => a - b).map((d) => WD[d]).join(' ');
};
const shortDate = (iso) => {
  const d = new Date(iso + 'T00:00:00');
  return `${d.getMonth() + 1}/${d.getDate()} (${WD[d.getDay()]})`;
};
const onceWhen = (iso) => {
  const t = toISODate(todayLocal());
  const tm = new Date(todayLocal().getFullYear(), todayLocal().getMonth(), todayLocal().getDate() + 1);
  return iso === t ? '오늘' : iso === toISODate(tm) ? '내일' : shortDate(iso);
};

const alarm = {
  mount(el) {
    let formDays = [1, 2, 3, 4, 5];
    let editingId = null; // 수정 중인 알람 id (없으면 새로 만들기)
    el.innerHTML = `
      ${header('알람', `<button class="btn primary" data-action="new" aria-expanded="false">${icons.plus}추가</button>`)}
      <form class="card form" data-slot="form" hidden>
        <h2 class="form-title" data-slot="form-title">새 알람</h2>
        <div class="form-row">
          <label>시간<input type="time" name="time" value="07:00" required></label>
          <label class="grow">이름<input name="label" maxlength="30" placeholder="예: 출근"></label>
        </div>
        <fieldset class="days">
          <legend>반복 요일</legend>
          <div class="day-chips">${WD.map((w, i) => `<button type="button" class="chip" data-day="${i}" aria-pressed="${formDays.includes(i)}">${w}</button>`).join('')}</div>
        </fieldset>
        <p class="repeat-summary" data-slot="once-hint" hidden>요일을 고르지 않으면 <strong>한 번만</strong> 울려요. 울릴 시각이 지나고 10분 뒤에 자동으로 지워져요.</p>
        <div class="stack-form" data-slot="repeat-opts">
          <label class="check"><input type="checkbox" name="skip_holidays" checked> 공휴일에는 울리지 않기</label>
          <p class="muted small hint-line">법정 공휴일과 내가 ‘휴일’로 만든 날이 모두 포함돼요.</p>
        </div>
        <p class="form-msg" role="status"></p>
        <div class="sheet-actions">
          <span class="grow"></span>
          <button class="btn" type="button" data-action="cancel-new">취소</button>
          <button class="btn primary" type="submit">저장</button>
        </div>
      </form>
      <ul class="list" data-slot="list"></ul>
      <a class="btn block-link" href="${SHORTCUT_RUN_URL}">알람 바꾼 뒤 지금 시계에 반영</a>
      <p class="muted small">실제로 울리는 건 아이폰 시계 앱이에요.<br>매일 0시에 단축어가 자동으로 맞춰줘요.<br>(설정 → 아이폰 시계 알람 연동)</p>`;

    const form = el.querySelector('[data-slot=form]');
    const toggleBtn = el.querySelector('[data-action=new]');
    toggleBtn.addEventListener('click', () => {
      form.hidden = !form.hidden;
      toggleBtn.setAttribute('aria-expanded', String(!form.hidden));
      if (!form.hidden) form.elements.namedItem('time').focus();
    });
    form.querySelector('.day-chips').addEventListener('click', (e) => {
      const b = e.target.closest('[data-day]');
      if (!b) return;
      const d = Number(b.dataset.day);
      formDays = formDays.includes(d) ? formDays.filter((x) => x !== d) : [...formDays, d];
      b.setAttribute('aria-pressed', String(formDays.includes(d)));
      syncOnce();
    });
    // 요일이 하나도 없으면 한 번만 울리는 알람
    const syncOnce = () => {
      const once = formDays.length === 0;
      form.querySelector('[data-slot=once-hint]').hidden = !once;
      form.querySelector('[data-slot=repeat-opts]').hidden = once;
    };
    // 취소: 입력한 내용을 비우고 창을 닫는다
    form.querySelector('[data-action=cancel-new]').addEventListener('click', () => {
      editingId = null;
      form.querySelector('[data-slot=form-title]').textContent = '새 알람';
      formDays = [1, 2, 3, 4, 5];
      form.querySelectorAll('.chip').forEach((c) => c.setAttribute('aria-pressed', String(formDays.includes(Number(c.dataset.day)))));
      form.elements.namedItem('label').value = '';
      form.elements.namedItem('time').value = '07:00';
      form.elements.namedItem('skip_holidays').checked = true;
      const msg = form.querySelector('.form-msg');
      msg.textContent = '';
      msg.classList.remove('error');
      syncOnce();
      form.hidden = true;
      toggleBtn.setAttribute('aria-expanded', 'false');
      toggleBtn.focus();
    });
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const fe = form.elements;
      const msg = form.querySelector('.form-msg');
      const time = fe.namedItem('time').value;
      if (!time) {
        msg.textContent = '시간을 정해주세요.';
        msg.classList.add('error');
        return;
      }
      const skip = fe.namedItem('skip_holidays').checked;
      const row = {
        time,
        label: fe.namedItem('label').value.trim() || '알람',
        days: formDays,
        skip_holidays: skip, // 공휴일과 내가 만든 휴일을 함께 다룬다 (서버 호환을 위해 두 칸에 같은 값을 쓴다)
        skip_custom_holidays: skip,
      };
      if (!formDays.length) {
        // 한 번만: 오늘 그 시각이 아직 안 지났으면 오늘, 지났으면 내일
        const now = new Date();
        const [h, m] = time.split(':').map(Number);
        const at = new Date(now.getFullYear(), now.getMonth(), now.getDate(), h, m);
        row.once_on = toISODate(at > now ? todayLocal() : new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1));
      }
      try {
        if (editingId) {
          await store.update('alarms', editingId, { ...row, once_on: row.once_on ?? null });
          editingId = null;
          form.querySelector('[data-slot=form-title]').textContent = '새 알람';
        } else {
          await store.insert('alarms', row);
        }
        fe.namedItem('label').value = '';
        msg.textContent = '';
        msg.classList.remove('error');
        form.hidden = true;
        toggleBtn.setAttribute('aria-expanded', 'false');
      } catch (err) {
        msg.textContent = '저장하지 못했어요: ' + err.message;
        msg.classList.add('error');
      }
    });

    el.querySelector('[data-slot=list]').addEventListener('click', async (e) => {
      const b = e.target.closest('button[data-action]');
      if (!b) return;
      const a = store.getState().data.alarms.find((x) => x.id === b.dataset.id);
      if (!a) return;
      if (b.dataset.action === 'edit') {
        // 수정: 위쪽 입력창에 지금 값을 채워서 연다
        editingId = a.id;
        formDays = [...(a.days ?? [])];
        form.querySelectorAll('.chip').forEach((c) => c.setAttribute('aria-pressed', String(formDays.includes(Number(c.dataset.day)))));
        form.elements.namedItem('time').value = a.time.slice(0, 5);
        form.elements.namedItem('label').value = a.label;
        form.elements.namedItem('skip_holidays').checked = !!a.skip_holidays;
        form.querySelector('[data-slot=form-title]').textContent = '알람 수정';
        syncOnce();
        form.hidden = false;
        toggleBtn.setAttribute('aria-expanded', 'true');
        form.scrollIntoView({ block: 'start', behavior: 'smooth' });
        return;
      }
      try {
        if (b.dataset.action === 'toggle') await store.update('alarms', a.id, { enabled: !a.enabled });
        else if (b.dataset.action === 'holiday') await store.update('alarms', a.id, { skip_holidays: !a.skip_holidays, skip_custom_holidays: !a.skip_holidays });
        else if (b.dataset.action === 'delete' && confirm(`${a.time.slice(0, 5)} ${a.label} 알람을 지울까요?`)) await store.remove('alarms', a.id);
      } catch (err) {
        alert('저장하지 못했어요: ' + err.message);
      }
    });
  },

  update(el, s) {
    const alarms = [...s.data.alarms].sort((a, b) => a.time.localeCompare(b.time));

    el.querySelector('[data-slot=list]').innerHTML = alarms.length
      ? alarms.map((a) => {
          const next = nextRing(a, s);
          return `
          <li class="card alarm ${a.enabled ? '' : 'is-off'}">
            <div class="alarm-main">
              <div class="alarm-top">
                <span class="alarm-time">${a.time.slice(0, 5)}</span>
                <span class="alarm-label">${esc(a.label)}</span>
              </div>
              ${isOnce(a)
                ? `<span class="muted small">한 번만 · ${a.once_on ? onceWhen(a.once_on) : ''} (울린 뒤 자동 삭제)</span>`
                : `<span class="muted small">${daysText(a.days)}${next ? ` · 다음 ${shortDate(next)}` : ''}</span>
              <button class="badge ${a.skip_holidays ? 'badge-skip' : 'badge-ring'}" data-action="holiday" data-id="${a.id}"
                aria-pressed="${a.skip_holidays}" aria-label="공휴일 설정 바꾸기">
                ${a.skip_holidays ? '공휴일엔 안 울림' : '공휴일에도 울림'}
              </button>`}
            </div>
            <div class="alarm-side">
              <button class="switch" data-action="toggle" data-id="${a.id}" aria-pressed="${a.enabled}" aria-label="${esc(a.label)} 켜기"><span></span></button>
              <div class="alarm-btns">
                <button class="icon-btn" data-action="edit" data-id="${a.id}" aria-label="${esc(a.label)} 수정">${icons.edit}</button>
                <button class="icon-btn" data-action="delete" data-id="${a.id}" aria-label="${esc(a.label)} 삭제">${icons.trash}</button>
              </div>
            </div>
          </li>`;
        }).join('')
      : '<li class="empty muted">아직 알람이 없어요. 오른쪽 위 추가를 눌러보세요.</li>';
  },
};

// ── 설정 ──
const settings = {
  mount(el) {
    el.innerHTML = `
      ${header('설정')}
      <h2 class="section-title">계정</h2>
      <section class="card stack">
        <div class="kv"><span>로그인</span><span data-slot="email" class="muted"></span></div>
        <div class="kv"><span>동기화</span><span data-slot="status"></span></div>
        <div class="kv"><span>자동 로그인</span><span class="muted">켜짐 · 로그아웃 전까지 유지</span></div>
      </section>
      <h2 class="section-title">화면</h2>
      <section class="card stack">
        <div class="kv"><span>화면 모드</span>
          <div class="segmented seg-inline" role="radiogroup" aria-label="화면 모드" data-slot="theme">
            <button type="button" role="radio" data-theme-set="light">라이트</button>
            <button type="button" role="radio" data-theme-set="dark">다크</button>
          </div>
        </div>
      </section>
      <h2 class="section-title">홈 기념일 세기</h2>
      <form class="card form" data-slot="since-form" novalidate>
        <p class="muted small">정한 날 이후로 며칠이 지났는지 홈 맨 위에 보여줘요. (당일은 D+0)</p>
        <label>이름<input name="since_label" maxlength="20" placeholder="예: 우리 사귄 날" autocomplete="off"></label>
        <label>시작한 날<input type="date" name="since_date"></label>
        <p class="form-msg" role="status"></p>
        <div class="sheet-actions">
          <button class="btn" type="button" data-action="since-clear">지우기</button>
          <span class="grow"></span>
          <button class="btn primary" type="submit">저장</button>
        </div>
      </form>
      <h2 class="section-title">알림</h2>
      <section class="card stack">
        <div class="kv">
          <div class="row-main"><span>D-Day 푸시 알림</span><span class="muted small" data-slot="push-hint">D-Day 3일 전과 하루 전, 오전 9시·오후 9시</span></div>
          <button class="switch" data-action="push" aria-pressed="false" aria-label="D-Day 푸시 알림"><span></span></button>
        </div>
      </section>
      <h2 class="section-title">보안</h2>
      <section class="card stack" data-slot="lock-card">
        <div class="kv">
          <div class="row-main"><span>Face ID로 잠금</span><span class="muted small" data-slot="lock-hint">앱을 열 때 얼굴을 확인해요 (이 기기만)</span></div>
          <button class="switch" data-action="lock" aria-pressed="false" aria-label="Face ID로 잠금"><span></span></button>
        </div>
      </section>
      <h2 class="section-title">공휴일</h2>
      <section class="card stack">
        <div class="kv"><span>자동 갱신</span><span data-slot="hol-sync" class="small"></span></div>
        <div class="kv"><span>등록된 공휴일</span><span data-slot="hol-count" class="muted small"></span></div>
        <div class="kv"><span>대한민국 공휴일 표시</span><button class="switch" data-setting="show_kr_holidays" aria-label="대한민국 공휴일 표시"><span></span></button></div>
      </section>
      <h2 class="section-title">아이폰 시계 알람 연동</h2>
      <section class="card stack">
        <p class="muted small">단축어 "ThisMoment 알람 동기화"에 넣을 값이에요.<br>각각 복사해서 붙여넣으세요.<br>토큰은 다른 사람에게 보여주지 마세요.</p>
        <div class="copy-row"><span>① 주소</span><button class="btn" data-copy="url" type="button">복사</button></div>
        <div class="copy-row"><span>② apikey 값</span><button class="btn" data-copy="apikey" type="button">복사</button></div>
        <div class="copy-row"><span>③ 토큰 <code data-slot="token">…</code></span><button class="btn" data-copy="token" type="button">복사</button></div>
        <a class="btn primary block-link" href="${SHORTCUT_RUN_URL}">지금 시계에 반영 (단축어 실행)</a>
      </section>
      <button class="btn danger wide" data-action="logout" type="button">로그아웃</button>
      <p class="muted small center credits">홈의 명언은 MIT 라이선스 자료(Hugging Face m-ric/english_historical_quotes, chkim116/kadvice)에서 골라 직접 번역한 것이에요. <a href="https://github.com/hoolahoof/thismoment/blob/main/CREDITS.md" target="_blank" rel="noopener">출처 자세히</a></p>`;

    lockSupported().then((ok) => {
      if (!ok) {
        const sw = el.querySelector('[data-action=lock]');
        sw.disabled = true;
        el.querySelector('[data-slot=lock-hint]').textContent = '이 기기/브라우저에서는 쓸 수 없어요';
      }
    });

    // 푸시 알림 상태 표시
    const pushHint = el.querySelector('[data-slot=push-hint]');
    const pushSw = el.querySelector('[data-action=push]');
    const refreshPush = async () => {
      const st = await pushState();
      pushSw.setAttribute('aria-pressed', String(st === 'on'));
      pushSw.disabled = st === 'unsupported';
      if (st === 'unsupported') pushHint.textContent = isStandalone() || pushSupported() ? '이 기기에서는 쓸 수 없어요' : '아이폰은 "홈 화면에 추가"한 앱에서만 알림을 받을 수 있어요';
      else if (st === 'denied') pushHint.textContent = '알림이 막혀 있어요. 아이폰 설정 → 알림 → ThisMoment 에서 허용해 주세요';
      else pushHint.textContent = 'D-Day 3일 전과 하루 전, 오전 9시·오후 9시';
    };
    refreshPush().catch(() => {});
    pushSw.addEventListener('click', async () => {
      pushSw.disabled = true;
      try {
        if (pushSw.getAttribute('aria-pressed') === 'true') await disablePush();
        else await enablePush();
      } catch (err) {
        alert(err.message || err);
      }
      pushSw.disabled = false;
      refreshPush().catch(() => {});
    });

    // 홈 기념일 세기 저장
    const sinceForm = el.querySelector('[data-slot=since-form]');
    const sinceMsg = sinceForm.querySelector('.form-msg');
    const saveSince = async (label, date) => {
      const st = store.getState().data.settings[0];
      if (!st) return;
      try {
        await store.update('settings', st.user_id, { since_label: label || null, since_date: date || null });
        sinceMsg.classList.remove('error');
        sinceMsg.textContent = date ? '저장했어요.' : '지웠어요.';
      } catch (err) {
        sinceMsg.classList.add('error');
        sinceMsg.textContent = '저장하지 못했어요: ' + err.message + ' (SQL 012 를 실행했는지 확인해 주세요)';
      }
    };
    sinceForm.addEventListener('submit', (e) => {
      e.preventDefault();
      const f = sinceForm.elements;
      if (!f.namedItem('since_date').value) {
        sinceMsg.classList.add('error');
        sinceMsg.textContent = '시작한 날을 골라 주세요.';
        return;
      }
      saveSince(f.namedItem('since_label').value.trim(), f.namedItem('since_date').value);
    });
    sinceForm.querySelector('[data-action=since-clear]').addEventListener('click', () => {
      sinceForm.elements.namedItem('since_label').value = '';
      sinceForm.elements.namedItem('since_date').value = '';
      saveSince('', '');
    });

    const paintTheme = () => {
      const cur = getTheme();
      el.querySelectorAll('[data-theme-set]').forEach((b) => b.setAttribute('aria-checked', String(b.dataset.themeSet === cur)));
    };
    paintTheme();

    el.addEventListener('click', async (e) => {
      const th = e.target.closest('[data-theme-set]');
      if (th) {
        setTheme(th.dataset.themeSet);
        paintTheme();
        return;
      }
      const sw = e.target.closest('[data-setting]');
      if (sw) {
        const st = store.getState().data.settings[0];
        if (!st) return;
        const key = sw.dataset.setting;
        try {
          const v = !st[key];
          // 대한민국 공휴일은 하나의 스위치: 대체공휴일·선거일·임시공휴일도 같이 켜고 끈다 (서버가 세 칸을 따로 읽어서 같은 값으로 맞춤)
          const patch = key === 'show_kr_holidays' ? { show_kr_holidays: v, include_substitute: v, include_temporary: v } : { [key]: v };
          await store.update('settings', st.user_id, patch);
        } catch (err) {
          alert('저장하지 못했어요: ' + err.message);
        }
        return;
      }
      const b = e.target.closest('[data-action]');
      if (!b) return;
      if (b.dataset.action === 'logout') {
        if (confirm('로그아웃할까요? 다음에 다시 로그인해야 해요.')) await logout();
      } else if (b.dataset.action === 'lock') {
        const user = store.getState().user;
        if (!user) return;
        try {
          if (isLockEnabled(user.id)) disableLock(user.id);
          else await enableLock(user);
        } catch (err) {
          if (err?.name !== 'NotAllowedError') alert('Face ID를 설정하지 못했어요: ' + (err?.message ?? err));
        }
        b.setAttribute('aria-pressed', String(isLockEnabled(user.id)));
      }
    });

    el.addEventListener('click', async (e) => {
      const b = e.target.closest('[data-copy]');
      if (!b) return;
      const values = {
        url: `${SUPABASE_URL}/rest/v1/rpc/get_alarm_plan`,
        apikey: SUPABASE_KEY,
        token: store.getState().data.settings[0]?.widget_token ?? '',
      };
      const v = values[b.dataset.copy];
      if (!v) return;
      try {
        await navigator.clipboard.writeText(v);
        b.textContent = '복사됨';
        setTimeout(() => (b.textContent = '복사'), 1500);
      } catch {
        prompt('아래 값을 길게 눌러 복사하세요', v);
      }
    });
  },
  update(el, s) {
    el.querySelector('[data-slot=email]').textContent = s.user ? '비밀번호로 연결됨' : '';
    if (s.user) el.querySelector('[data-action=lock]').setAttribute('aria-pressed', String(isLockEnabled(s.user.id)));
    el.querySelector('[data-slot=status]').innerHTML = statusBadge(s.status);
    // 기념일 세기 입력칸: 입력 중이 아닐 때만 저장된 값으로 채운다
    const sf = el.querySelector('[data-slot=since-form]');
    if (sf && !sf.contains(document.activeElement)) {
      sf.elements.namedItem('since_label').value = s.data.settings[0]?.since_label ?? '';
      sf.elements.namedItem('since_date').value = s.data.settings[0]?.since_date ?? '';
    }
    const tok = s.data.settings[0]?.widget_token;
    el.querySelector('[data-slot=token]').textContent = tok ? tok.slice(0, 6) + '••••' : '없음';

    const sync = s.holidaySync;
    const slot = el.querySelector('[data-slot=hol-sync]');
    if (!sync?.synced_at) {
      slot.innerHTML = '<span class="muted">아직 기록 없음</span>';
    } else {
      const t = new Date(sync.synced_at);
      const when = `${t.getMonth() + 1}/${t.getDate()} ${String(t.getHours()).padStart(2, '0')}:${String(t.getMinutes()).padStart(2, '0')}`;
      const stale = Date.now() - t.getTime() > 3 * 86400000;
      slot.innerHTML = sync.ok && !stale
        ? `<span class="ok-text">정상 · ${when}</span>`
        : `<span class="error-text">${sync.ok ? '3일 넘게 갱신 안 됨' : '실패'} · ${when}</span>`;
    }
    const years = [...new Set(s.holidays.map((h) => h.date.slice(0, 4)))].join(', ');
    el.querySelector('[data-slot=hol-count]').textContent = `${s.holidays.length}일${years ? ` (${years})` : ''}`;

    const st = s.data.settings[0];
    if (st?.show_kr_holidays && (!st.include_substitute || !st.include_temporary) && !el.dataset.holFixed) {
      el.dataset.holFixed = '1';
      store.update('settings', st.user_id, { include_substitute: true, include_temporary: true }).catch(() => {});
    }
    el.querySelectorAll('[data-setting]').forEach((b) => b.setAttribute('aria-pressed', String(!!st?.[b.dataset.setting])));

  },
};

export const views = { home, calendar, day, dday, alarm, settings };
