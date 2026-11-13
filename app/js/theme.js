// 화면 모드: 시스템(기본) / 라이트 / 다크. <html data-theme> 로 tokens.css 가 색을 바꾼다.
const KEY = 'tm.theme';
const META = { light: '#FFFFFF', dark: '#171A1F' };

export function getTheme() {
  try {
    const t = localStorage.getItem(KEY);
    return t === 'light' || t === 'dark' ? t : 'system';
  } catch { return 'system'; }
}

function paintMeta() {
  const t = getTheme();
  const dark = t === 'dark' || (t === 'system' && matchMedia('(prefers-color-scheme: dark)').matches);
  document.querySelector('meta[name=theme-color]')?.setAttribute('content', dark ? META.dark : META.light);
}

export function setTheme(t) {
  try {
    if (t === 'light' || t === 'dark') localStorage.setItem(KEY, t);
    else localStorage.removeItem(KEY);
  } catch { /* 저장 못 해도 이번 화면에는 적용 */ }
  if (t === 'light' || t === 'dark') document.documentElement.dataset.theme = t;
  else delete document.documentElement.dataset.theme;
  paintMeta();
}

export function initTheme() {
  paintMeta();
  matchMedia('(prefers-color-scheme: dark)').addEventListener?.('change', paintMeta);
}
