// 일정 색 14가지 (bg: 칩·블록 배경, bar: 진한 표시색)
export const COLORS = {
  red: { name: '빨강', bg: '#FFDADA', bar: '#D93636' },
  coral: { name: '산호', bg: '#FFE1D6', bar: '#E8603C' },
  orange: { name: '주황', bg: '#FFE4CC', bar: '#E07B24' },
  amber: { name: '노랑', bg: '#FFF0BF', bar: '#C99400' },
  lime: { name: '연두', bg: '#E8F5CC', bar: '#6FA312' },
  green: { name: '초록', bg: '#D9F2E3', bar: '#2E9E5B' },
  teal: { name: '청록', bg: '#D0F2EC', bar: '#12998A' },
  cyan: { name: '하늘', bg: '#D3EFF8', bar: '#0B8DB0' },
  blue: { name: '파랑', bg: '#DCE6FF', bar: '#2F5FD0' },
  indigo: { name: '남색', bg: '#E0E2FF', bar: '#4148C2' },
  purple: { name: '보라', bg: '#ECE1FF', bar: '#7A4FD6' },
  pink: { name: '분홍', bg: '#FCDDF0', bar: '#CF3F98' },
  brown: { name: '갈색', bg: '#EFE3D7', bar: '#8A6243' },
  gray: { name: '회색', bg: '#E6E6E2', bar: '#5E5E66' },
};
export const colorOf = (c) => COLORS[c] ?? COLORS.blue;

export const REPEAT_ICON =
  '<svg class="rep-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" role="img" aria-label="반복"><path d="M17 2l4 4-4 4M3 11V9a3 3 0 0 1 3-3h15M7 22l-4-4 4-4M21 13v2a3 3 0 0 1-3 3H3"/></svg>';
