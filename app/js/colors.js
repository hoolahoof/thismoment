// 일정 색 14가지 (실제 색 값은 tokens.css 의 --c-이름-bg/bar, 다크 모드 자동 대응)
export const COLORS = {
  red: { name: '빨강', bg: 'var(--c-red-bg)', bar: 'var(--c-red-bar)' },
  coral: { name: '산호', bg: 'var(--c-coral-bg)', bar: 'var(--c-coral-bar)' },
  orange: { name: '주황', bg: 'var(--c-orange-bg)', bar: 'var(--c-orange-bar)' },
  amber: { name: '노랑', bg: 'var(--c-amber-bg)', bar: 'var(--c-amber-bar)' },
  lime: { name: '연두', bg: 'var(--c-lime-bg)', bar: 'var(--c-lime-bar)' },
  green: { name: '초록', bg: 'var(--c-green-bg)', bar: 'var(--c-green-bar)' },
  teal: { name: '청록', bg: 'var(--c-teal-bg)', bar: 'var(--c-teal-bar)' },
  cyan: { name: '하늘', bg: 'var(--c-cyan-bg)', bar: 'var(--c-cyan-bar)' },
  blue: { name: '파랑', bg: 'var(--c-blue-bg)', bar: 'var(--c-blue-bar)' },
  indigo: { name: '남색', bg: 'var(--c-indigo-bg)', bar: 'var(--c-indigo-bar)' },
  purple: { name: '보라', bg: 'var(--c-purple-bg)', bar: 'var(--c-purple-bar)' },
  pink: { name: '분홍', bg: 'var(--c-pink-bg)', bar: 'var(--c-pink-bar)' },
  brown: { name: '갈색', bg: 'var(--c-brown-bg)', bar: 'var(--c-brown-bar)' },
  gray: { name: '회색', bg: 'var(--c-gray-bg)', bar: 'var(--c-gray-bar)' },
};
// 직접 고른 색은 '#RRGGBB' 글자로 저장한다. 배경은 그 색을 표면색에 섞어 만들어서 다크 모드에서도 자연스럽다.
const HEX = /^#[0-9a-f]{6}$/i;
export const isCustomColor = (c) => HEX.test(c ?? '');
export const colorOf = (c) =>
  COLORS[c] ??
  (isCustomColor(c)
    ? { name: c.toUpperCase(), bg: `color-mix(in srgb, ${c} var(--tint-mix, 22%), var(--color-surface))`, bar: c }
    : COLORS.blue);

export const REPEAT_ICON =
  '<svg class="rep-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" role="img" aria-label="반복"><path d="M17 2l4 4-4 4M3 11V9a3 3 0 0 1 3-3h15M7 22l-4-4 4-4M21 13v2a3 3 0 0 1-3 3H3"/></svg>';
