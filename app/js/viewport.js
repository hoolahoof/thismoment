// 폰에서 화면이 확대되지 않게 막고, 혹시 확대되더라도(입력칸 포커스·손가락 벌리기 등) 원래 크기로 돌려놓는다.
const meta = document.querySelector('meta[name=viewport]');
const BASE = 'width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover';
let timer = null;

// 뷰포트 설정을 잠깐 바꿨다가 되돌리면 브라우저(특히 아이폰)가 배율을 1로 다시 맞춘다
function snapBack() {
  if (!meta) return;
  meta.setAttribute('content', 'width=device-width, initial-scale=1, minimum-scale=1, maximum-scale=1, user-scalable=no');
  setTimeout(() => meta.setAttribute('content', BASE), 60);
}
function check() {
  clearTimeout(timer);
  timer = setTimeout(() => {
    if ((window.visualViewport?.scale ?? 1) > 1.01) snapBack();
  }, 250);
}

// 손가락 두 개로 벌리기(핀치)와 아이폰 제스처 확대는 시작도 못 하게
document.addEventListener('gesturestart', (e) => e.preventDefault());
document.addEventListener('gesturechange', (e) => e.preventDefault());
document.addEventListener('touchmove', (e) => { if (e.touches.length > 1) e.preventDefault(); }, { passive: false });

// 그래도 확대되면 → 배율이 바뀌거나, 키보드가 닫힐 때 원래대로
window.visualViewport?.addEventListener('resize', check);
document.addEventListener('focusout', check);
window.addEventListener('orientationchange', () => setTimeout(snapBack, 300));
