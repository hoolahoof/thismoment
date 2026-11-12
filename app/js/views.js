// 화면들. 각 화면은 mount(el) 로 한 번 그리고, update(state) 로 데이터 부분만 다시 그린다.
// 캘린더와 하루 화면은 3단계, 디데이·공휴일 다듬기는 4단계에서 채운다.
import * as store from './store.js';
import { logout } from './app.js';
import { lockSupported, isLockEnabled, enableLock, disableLock } from './lock.js';
import { esc, fmtDate, ddayLabel, daysUntil, todayLocal, toISODate, icons } from './util.js';
import { holidayOn, alarmOn, nextRing, nextSkip } from './holidays.js';
import { SUPABASE_URL, SUPABASE_KEY } from '../config.js';

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

// ── 캘린더 (자리만) ──
const calendar = {
  mount(el) {
    const t = todayLocal();
    el.innerHTML = `
      ${header(`${t.getFullYear()}년 ${t.getMonth() + 1}월`)}
      <div class="dday-strip" data-slot="strip"></div>
      <section class="card placeholder">
        <p><strong>월간 캘린더</strong>는 3단계에서 만들어요.</p>
        <p class="muted">지금은 로그인과 동기화가 잘 되는지 확인하는 단계예요. 디데이 탭에서 항목을 추가해 보세요.</p>
      </section>`;
  },
  update(el, s) {
    const top = [...s.data.ddays]
      .filter((d) => !d.count_up && daysUntil(d.target_date) >= 0)
      .sort((a, b) => a.target_date.localeCompare(b.target_date))
      .slice(0, 3);
    el.querySelector('[data-slot=strip]').innerHTML = top.length
      ? top.map((d) => `<div class="mini-card"><span class="muted">${esc(d.title)}</span><strong>${ddayLabel(d)}</strong></div>`).join('')
      : '';
  },
};

// ── 하루 (자리만) ──
const day = {
  mount(el) {
    el.innerHTML = `${header('오늘')}
      <section class="card placeholder"><p><strong>하루 타임블록</strong>은 3단계에서 만들어요.</p></section>`;
  },
  update() {},
};

// ── 디데이 (동기화 확인용 기본 기능) ──
const dday = {
  mount(el) {
    el.innerHTML = `
      ${header('디데이')}
      <form class="card form inline-form" data-slot="form">
        <label>이름<input name="title" required maxlength="40" placeholder="예: 여행 출발"></label>
        <label>날짜<input name="target_date" type="date" required value="${toISODate(todayLocal())}"></label>
        <label class="check"><input type="checkbox" name="count_up"> 지난 날부터 세기 (D+)</label>
        <button class="btn primary" type="submit">${icons.plus}추가</button>
        <p class="form-msg" role="status"></p>
      </form>
      <h2 class="section-title">전체</h2>
      <ul class="list" data-slot="list"></ul>`;

    el.querySelector('[data-slot=form]').addEventListener('submit', async (e) => {
      e.preventDefault();
      const f = e.target;
      const fe = f.elements;
      const msg = f.querySelector('.form-msg');
      const title = fe.namedItem('title').value.trim();
      const target = fe.namedItem('target_date').value;
      if (!title || !target) return;
      try {
        await store.insert('ddays', { title, target_date: target, count_up: fe.namedItem('count_up').checked });
        fe.namedItem('title').value = '';
        msg.classList.remove('error');
        msg.textContent = '';
      } catch (err) {
        msg.textContent = '저장하지 못했어요: ' + err.message;
        msg.classList.add('error');
      }
    });

    el.querySelector('[data-slot=list]').addEventListener('click', async (e) => {
      const btn = e.target.closest('button[data-action]');
      if (!btn) return;
      const id = btn.dataset.id;
      const item = store.getState().data.ddays.find((d) => d.id === id);
      if (!item) return;
      try {
        if (btn.dataset.action === 'delete') {
          if (confirm(`'${item.title}' 디데이를 지울까요?`)) await store.remove('ddays', id);
        } else if (btn.dataset.action === 'widget') {
          await store.update('ddays', id, { show_in_widget: !item.show_in_widget });
        }
      } catch (err) {
        alert('저장하지 못했어요: ' + err.message);
      }
    });
  },
  update(el, s) {
    const list = [...s.data.ddays].sort((a, b) => Math.abs(daysUntil(a.target_date)) - Math.abs(daysUntil(b.target_date)));
    el.querySelector('[data-slot=list]').innerHTML = list.length
      ? list
          .map(
            (d) => `
        <li class="card row">
          <div class="row-main">
            <span class="row-title">${esc(d.title)}</span>
            <span class="muted small">${fmtDate(d.target_date)}${d.count_up ? ' 부터' : ''}</span>
          </div>
          <strong class="dday-num">${ddayLabel(d)}</strong>
          <button class="switch" data-action="widget" data-id="${d.id}" aria-pressed="${d.show_in_widget}" aria-label="홈 위젯에 표시"><span></span></button>
          <button class="icon-btn" data-action="delete" data-id="${d.id}" aria-label="${esc(d.title)} 삭제">${icons.trash}</button>
        </li>`
          )
          .join('')
      : '<li class="empty muted">아직 디데이가 없어요. 위에서 추가해 보세요.</li>';
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
const PLAN_DAYS = 120; // 앞으로 4개월 안의 공휴일을 보여준다

const alarm = {
  mount(el) {
    let formDays = [1, 2, 3, 4, 5];
    el.innerHTML = `
      ${header('알람', `<button class="btn primary" data-action="new" aria-expanded="false">${icons.plus}추가</button>`)}
      <form class="card form" data-slot="form" hidden>
        <div class="form-row">
          <label>시간<input type="time" name="time" value="07:00" required></label>
          <label class="grow">이름<input name="label" maxlength="30" placeholder="예: 출근"></label>
        </div>
        <fieldset class="days">
          <legend>반복 요일</legend>
          <div class="day-chips">${WD.map((w, i) => `<button type="button" class="chip" data-day="${i}" aria-pressed="${formDays.includes(i)}">${w}</button>`).join('')}</div>
        </fieldset>
        <label class="check"><input type="checkbox" name="skip_holidays" checked> 공휴일에는 울리지 않기</label>
        <label class="check"><input type="checkbox" name="skip_custom" checked> 내가 지정한 휴일에도 울리지 않기</label>
        <button class="btn primary" type="submit">저장</button>
        <p class="form-msg" role="status"></p>
      </form>
      <ul class="list" data-slot="list"></ul>
      <h2 class="section-title">다가오는 공휴일 · 알람 울림 확인</h2>
      <div class="card plan" data-slot="plan"></div>
      <a class="btn block-link" href="${SHORTCUT_RUN_URL}">알람 바꾼 뒤 지금 시계에 반영</a>
      <p class="muted small">실제로 울리는 건 아이폰 시계 앱이에요. 매일 0시에 단축어가 자동으로 맞춰줘요. (설정 → 아이폰 시계 알람 연동)</p>`;

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
    });
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const fe = form.elements;
      const msg = form.querySelector('.form-msg');
      if (!formDays.length) {
        msg.textContent = '요일을 하나 이상 골라주세요.';
        msg.classList.add('error');
        return;
      }
      try {
        await store.insert('alarms', {
          time: fe.namedItem('time').value,
          label: fe.namedItem('label').value.trim() || '알람',
          days: formDays,
          skip_holidays: fe.namedItem('skip_holidays').checked,
          skip_custom_holidays: fe.namedItem('skip_custom').checked,
        });
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
      try {
        if (b.dataset.action === 'toggle') await store.update('alarms', a.id, { enabled: !a.enabled });
        else if (b.dataset.action === 'holiday') await store.update('alarms', a.id, { skip_holidays: !a.skip_holidays });
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
          const skip = a.skip_holidays || a.skip_custom_holidays ? nextSkip(a, s) : null;
          return `
          <li class="card alarm ${a.enabled ? '' : 'is-off'}">
            <div class="alarm-main">
              <div class="alarm-top">
                <span class="alarm-time">${a.time.slice(0, 5)}</span>
                <span class="alarm-label">${esc(a.label)}</span>
              </div>
              <span class="muted small">${daysText(a.days)}${next ? ` · 다음 ${shortDate(next)}` : ''}</span>
              <button class="badge ${a.skip_holidays ? 'badge-skip' : 'badge-ring'}" data-action="holiday" data-id="${a.id}"
                aria-pressed="${a.skip_holidays}" aria-label="공휴일 설정 바꾸기">
                ${a.skip_holidays ? '공휴일엔 안 울림' : '공휴일에도 울림'}
              </button>
              ${skip ? `<span class="muted small">다음 공휴일 쉼: ${shortDate(skip.iso)} ${esc(skip.name)}</span>` : ''}
            </div>
            <div class="alarm-side">
              <button class="switch" data-action="toggle" data-id="${a.id}" aria-pressed="${a.enabled}" aria-label="${esc(a.label)} 켜기"><span></span></button>
              <button class="icon-btn" data-action="delete" data-id="${a.id}" aria-label="${esc(a.label)} 삭제">${icons.trash}</button>
            </div>
          </li>`;
        }).join('')
      : '<li class="empty muted">아직 알람이 없어요. 오른쪽 위 추가를 눌러보세요.</li>';

    // 다가오는 공휴일마다: 어떤 알람이 울리고, 어떤 알람이 쉬는지
    const rows = [];
    const d = todayLocal();
    for (let i = 0; i < PLAN_DAYS; i++) {
      const iso = toISODate(d);
      const h = holidayOn(iso, s);
      const items = alarms
        .map((a) => ({ a, r: alarmOn(a, iso, s) }))
        .filter(({ r }) => r.reason !== 'not_today' && r.reason !== 'off');
      if (h.kr || h.custom) {
        const dow = d.getDay();
        const hol = h.kr || h.custom;
        rows.push(`
          <div class="plan-day ${hol ? 'is-holiday' : ''}">
            <div class="plan-date ${hol || dow === 0 ? 'red' : dow === 6 ? 'blue' : ''}">
              <strong>${shortDate(iso)}</strong>${hol ? `<span>${esc(hol)}</span>` : ''}
            </div>
            <ul class="plan-items">
              ${items.length ? items.map(({ a, r }) => `
                <li class="${r.ring ? 'ring' : 'skip'}">
                  <span class="plan-mark" aria-hidden="true">${r.ring ? '●' : '✕'}</span>
                  <span>${a.time.slice(0, 5)} ${esc(a.label)}</span>
                  <span class="plan-why">${r.ring ? (r.holiday ? '울림 (공휴일이지만 울리게 설정)' : '울림') : r.reason === 'holiday' ? '공휴일이라 안 울림' : '내 휴일이라 안 울림'}</span>
                </li>`).join('') : '<li class="muted">이 날 울릴 알람 없음</li>'}
            </ul>
          </div>`);
      }
      d.setDate(d.getDate() + 1);
    }
    el.querySelector('[data-slot=plan]').innerHTML = rows.length
      ? rows.join('')
      : '<p class="empty muted">앞으로 4개월 안에 공휴일이 없어요.</p>';
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
      </section>
      <h2 class="section-title">아이폰 시계 알람 연동</h2>
      <section class="card stack">
        <p class="muted small">단축어 "ThisMoment 알람 동기화"에 넣을 값이에요. 각각 복사해서 붙여넣으세요. 토큰은 다른 사람에게 보여주지 마세요.</p>
        <div class="copy-row"><span>① 주소</span><button class="btn" data-copy="url" type="button">복사</button></div>
        <div class="copy-row"><span>② apikey 값</span><button class="btn" data-copy="apikey" type="button">복사</button></div>
        <div class="copy-row"><span>③ 토큰 <code data-slot="token">…</code></span><button class="btn" data-copy="token" type="button">복사</button></div>
        <a class="btn primary block-link" href="${SHORTCUT_RUN_URL}">지금 시계에 반영 (단축어 실행)</a>
      </section>
      <button class="btn danger block" data-action="logout" type="button">로그아웃</button>`;

    lockSupported().then((ok) => {
      if (!ok) {
        const sw = el.querySelector('[data-action=lock]');
        sw.disabled = true;
        el.querySelector('[data-slot=lock-hint]').textContent = '이 기기/브라우저에서는 쓸 수 없어요';
      }
    });

    el.addEventListener('click', async (e) => {
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
  },
};

export const views = { calendar, day, dday, alarm, settings };
