import { initTheme } from './theme.js';
import { initPullRefresh } from './pullrefresh.js';
import { supabase } from './supabase.js';
import * as store from './store.js';
import { renderAuth, checkPassword } from './auth.js';
import { views, statusBadge } from './views.js';
import { icons, esc, daysUntil, ddayLabel } from './util.js';
import { requestNewEvent } from './calendar.js';
import { isLockEnabled, verifyLock, renderLock, watchRelock, disableLock } from './lock.js';

initTheme();
initPullRefresh();
const root = document.getElementById('app');
const TABS = [
  { id: 'home', label: '홈' },
  { id: 'calendar', label: '캘린더' },
  { id: 'dday', label: '디데이' },
  { id: 'alarm', label: '알람' },
  { id: 'settings', label: '설정' },
];

// 앱을 새로 열면 항상 홈부터 (예전 홈 화면 아이콘이 #/calendar 로 열리는 경우 포함)
if (!location.hash || location.hash === '#/calendar') history.replaceState(null, '', '#/home');

let signedInAs = null;
let currentUser = null;
let currentId = null;
let storeStarted = false;

const routeId = () => {
  const id = location.hash.replace(/^#\/?/, '');
  return views[id] ? id : 'home';
};

function renderShell() {
  root.innerHTML = `
    <div class="shell">
      <div class="sync-float" data-slot="sync"></div>
      <main id="view" class="view"></main>
      <nav class="tabbar" aria-label="화면">
        <div class="side-brand" aria-hidden="true">
          <svg viewBox="0 0 232 64" height="38" role="img">
            <rect x="11" y="12" width="10" height="40" rx="3" class="sb-a"/>
            <rect x="27" y="12" width="10" height="40" rx="3" class="sb-b"/>
            <rect x="43" y="12" width="10" height="40" rx="3" class="sb-a"/>
            <text x="64" y="43"><tspan font-weight="400">This</tspan><tspan font-weight="700">Moment</tspan></text>
          </svg>
        </div>
        <button type="button" class="side-new" data-action="new-event" aria-label="새 일정 (N)">${icons.plus}<span>새 일정</span><kbd>N</kbd></button>
        ${TABS.map((t) => `<a href="#/${t.id}" data-tab="${t.id}">${icons[t.id]}<span>${t.label}</span></a>`).join('')}
        <div class="side-foot" data-slot="side-foot"></div>
      </nav>
    </div>`;
  root.querySelector('[data-action=new-event]').addEventListener('click', requestNewEvent);
  currentId = null;
  showRoute();
}

function showRoute() {
  const id = routeId();
  const el = document.getElementById('view');
  if (!el) return;
  if (id !== currentId) {
    currentId = id;
    // 화면을 바꿀 때마다 새 요소로 갈아끼워 이전 화면의 이벤트 처리기가 쌓이지 않게 한다
    const fresh = el.cloneNode(false);
    el.replaceWith(fresh);
    views[id].mount(fresh);
    root.querySelectorAll('[data-tab]').forEach((a) => {
      // 하루 화면은 탭이 없으니 캘린더 탭이 켜진 것으로 보여준다
      if (a.dataset.tab === (id === 'day' ? 'calendar' : id)) a.setAttribute('aria-current', 'page');
      else a.removeAttribute('aria-current');
    });
    window.scrollTo(0, 0);
  }
  update(store.getState());
}

function update(s) {
  const el = document.getElementById('view');
  if (!el || !currentId) return;
  views[currentId].update(el, s);
  const sync = root.querySelector('[data-slot=sync]');
  if (sync) sync.innerHTML = s.status === 'live' ? '' : statusBadge(s.status);

  // 사이드바 아래(데스크탑): 가장 가까운 디데이 + 동기화 상태
  const foot = root.querySelector('[data-slot=side-foot]');
  if (foot) {
    const up = [...s.data.ddays]
      .filter((x) => !x.count_up && daysUntil(x.target_date) >= 0)
      .sort((a, b) => a.target_date.localeCompare(b.target_date))[0];
    foot.innerHTML =
      (up ? `<div class="sf-dday"><span class="sf-title">${esc(up.title)}</span><strong>${ddayLabel(up)}</strong></div>` : '') +
      `<div class="sf-sync">${s.status === 'live' ? '실시간 동기화됨' : statusBadge(s.status)}</div>`;
  }
}

export async function logout() {
  if (currentUser) disableLock(currentUser.id);
  await supabase.auth.signOut();
}

async function openApp() {
  renderShell();
  if (!storeStarted) {
    storeStarted = true;
    await store.start(currentUser);
  }
}

// 당겨서 새로고침 직후(30초 이내)에는 패스키 확인을 건너뛴다
function justRefreshed() {
  try {
    const t = Number(sessionStorage.getItem('tm.skipLock'));
    sessionStorage.removeItem('tm.skipLock');
    return t > 0 && Date.now() - t < 30000;
  } catch {
    return false;
  }
}

function showLockOrApp() {
  if (currentUser && isLockEnabled(currentUser.id) && !justRefreshed()) {
    renderLock(root, {
      onUnlock: async () => {
        await verifyLock(currentUser.id);
        await openApp();
      },
      onPassword: async (pw) => {
        await checkPassword(pw);
        await openApp();
      },
      onLogout: logout,
    });
  } else {
    openApp();
  }
}

store.subscribe(update);
window.addEventListener('hashchange', showRoute);
watchRelock(() => {
  if (currentUser && isLockEnabled(currentUser.id)) showLockOrApp();
});

supabase.auth.onAuthStateChange((_event, session) => {
  const user = session?.user ?? null;
  if (user?.id === signedInAs) {
    currentUser = user ?? currentUser;
    return; // 토큰 갱신 등은 다시 그리지 않는다
  }
  signedInAs = user?.id ?? null;
  currentUser = user;
  setTimeout(async () => {
    if (user) {
      showLockOrApp();
    } else {
      storeStarted = false;
      await store.stop();
      renderAuth(root);
    }
  }, 0);
});

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => navigator.serviceWorker.register('sw.js', { updateViaCache: 'none' }).catch(console.error));
}
