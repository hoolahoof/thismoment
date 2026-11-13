import { initTheme } from './theme.js';
import { initPullRefresh } from './pullrefresh.js';
import { supabase } from './supabase.js';
import * as store from './store.js';
import { renderAuth, checkPassword } from './auth.js';
import { views, statusBadge } from './views.js';
import { icons } from './util.js';
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
        ${TABS.map((t) => `<a href="#/${t.id}" data-tab="${t.id}">${icons[t.id]}<span>${t.label}</span></a>`).join('')}
      </nav>
    </div>`;
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

function showLockOrApp() {
  if (currentUser && isLockEnabled(currentUser.id)) {
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
