// 화면 모드: 시스템(기본) / 라이트 / 다크. <html data-theme> 로 tokens.css 가 색을 바꾼다.
const KEY = 'tm.theme';
const META = { light: '#FFFFFF', dark: '#171A1F' };

// 저장한 선택이 없으면 처음엔 기기 설정을 따르고, 화면에는 지금 적용된 쪽(라이트/다크)을 보여준다
export function getTheme() {
  try {
    const t = localStorage.getItem(KEY);
    if (t === 'light' || t === 'dark') return t;
  } catch { /* 무시 */ }
  return matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
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
