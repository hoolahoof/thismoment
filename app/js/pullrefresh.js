// 당겨서 새로고침: 맨 위에서 아래로 끌면 앱을 다시 불러온다 (홈 화면 앱엔 기본 기능이 없어서 직접 만듦).
// 끌기 동작이 있는 곳(달력 칸, 시간표, 열린 창)에서 시작한 건 무시한다.
const TRIGGER = 80;
const SKIP = '.cal-grid, .timeline, .wk-body, dialog, input, textarea, select';

export function initPullRefresh() {
  let startY = 0, startX = 0, pulling = false, dist = 0;
  const bar = document.createElement('div');
  bar.className = 'ptr';
  bar.hidden = true;
  bar.textContent = '↓ 당겨서 새로고침';
  document.body.appendChild(bar);

  const reset = () => {
    pulling = false;
    dist = 0;
    bar.hidden = true;
    bar.style.transform = '';
  };

  document.addEventListener('touchstart', (e) => {
    if (e.touches.length !== 1 || window.scrollY > 0 || e.target.closest(SKIP) || document.querySelector('dialog[open]')) return;
    startY = e.touches[0].clientY;
    startX = e.touches[0].clientX;
    pulling = true;
  }, { passive: true });

  document.addEventListener('touchmove', (e) => {
    if (!pulling) return;
    const dy = e.touches[0].clientY - startY;
    const dx = Math.abs(e.touches[0].clientX - startX);
    if (dy <= 0 || dx > dy) return reset(); // 위로 밀거나 옆으로 밀면 취소
    if (window.scrollY > 0) return reset();
    dist = dy;
    bar.hidden = false;
    bar.style.transform = `translate(-50%, ${Math.min(dy * 0.5, 60)}px)`;
    bar.textContent = dy >= TRIGGER ? '놓으면 새로고침' : '↓ 당겨서 새로고침';
  }, { passive: true });

  document.addEventListener('touchend', () => {
    if (pulling && dist >= TRIGGER) {
      bar.textContent = '새로고침 중…';
      location.reload();
      return;
    }
    reset();
  });
  document.addEventListener('touchcancel', reset);
}
