// 알람을 바꾸면(추가·삭제·시간/요일 수정·켜고 끄기) 아이폰 시계에 반영해야 실제로 울린다.
// 웹앱이 시계 알람을 직접 만들 수는 없어서, 바뀔 때마다 단축어를 자동으로 실행해 보고(최선),
// 안 되면 화면에 "시계에 반영" 버튼을 남겨 한 번 누르면 되게 한다.
export const SHORTCUT_NAME = 'ThisMoment 알람 동기화';
export const SHORTCUT_RUN_URL = 'shortcuts://run-shortcut?name=' + encodeURIComponent(SHORTCUT_NAME);

const PENDING = 'tm.alarmSync.pending'; // 바뀌었는데 아직 시계에 반영 안 한 시각
const LAUNCHED = 'tm.alarmSync.launched'; // 단축어를 실행하러 나간 시각
const AUTO = 'tm.alarmSync.auto'; // '0' 이면 자동 실행 끔
const DEBOUNCE_MS = 2500; // 여러 개를 연달아 바꾸는 동안은 기다렸다가 한 번만
const RETURN_WITHIN_MS = 10 * 60 * 1000;

const read = (k) => { try { return localStorage.getItem(k); } catch { return null; } };
const write = (k, v) => { try { v === null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch { /* 저장이 막혀도 동작은 유지 */ } };

// 단축어는 아이폰/아이패드에만 있다
export const isIOS = () => /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
export const isAuto = () => read(AUTO) !== '0';
export const setAuto = (on) => write(AUTO, on ? '1' : '0');
export const isPending = () => !!read(PENDING);

// 화면을 옮기는 부분만 따로 두어 시험에서 바꿔 끼울 수 있게 한다
export const nav = { go: (url) => { window.location.href = url; } };

let timer = null;
let banner = null;

function launch() {
  write(LAUNCHED, String(Date.now()));
  nav.go(SHORTCUT_RUN_URL);
}

function render() {
  if (!isIOS()) return;
  if (!isPending()) { banner?.remove(); banner = null; return; }
  if (!banner) {
    banner = document.createElement('div');
    banner.className = 'alarm-sync-banner';
    banner.setAttribute('role', 'status');
    banner.innerHTML = '<span>⏰ 알람이 바뀌었어요. 시계에 반영해야 울려요.</span><button type="button" class="btn primary">시계에 반영</button>';
    banner.querySelector('button').addEventListener('click', launch); // 직접 누른 것이라 확실히 실행됨
    document.body.appendChild(banner);
  }
}

// 알람이 바뀌었다고 알린다 (views.js 에서 저장·삭제·켜기/끄기 뒤에 부른다)
export function markChanged() {
  if (!isIOS()) return;
  write(PENDING, String(Date.now()));
  render();
  clearTimeout(timer);
  if (isAuto()) timer = setTimeout(launch, DEBOUNCE_MS);
}

// 단축어를 실행하러 나갔다가 돌아오면 반영 요청을 보낸 것으로 보고 안내를 걷는다
function onBack() {
  if (document.visibilityState !== 'visible') return;
  const at = Number(read(LAUNCHED));
  if (at && Date.now() - at < RETURN_WITHIN_MS && isPending()) {
    write(PENDING, null);
    write(LAUNCHED, null);
    render();
  }
}
document.addEventListener('visibilitychange', onBack);
window.addEventListener('pageshow', onBack);

render(); // 앱을 다시 열었을 때도 반영 안 된 변경이 있으면 안내를 보여준다
