// 일기 맞춤법 자동 고침: 틀리는 게 거의 확실한 낱말만, 낱말을 끝내는 순간(띄어쓰기·줄바꿈·문장부호) 고친다.
// 서버로 글을 보내지 않고 이 파일 안의 목록만 쓴다. 헷갈릴 수 있는 낱말(예: 바램)은 일부러 넣지 않았다.
const RULES = [
  [/^몇일/, '며칠'],
  [/^어떻해/, '어떡해'],
  [/^왠일/, '웬일'],
  [/^금새/, '금세'],
  [/^어의없/, '어이없'],
  [/^희안/, '희한'],
  [/^오랫만/, '오랜만'],
  [/^설레임/, '설렘'],
  [/^일부로/, '일부러'],
  [/^뵈요/, '봬요'],
  [/^(있|없|같|좋|싫)슴/, (m, a) => a + '음'],
  [/([할갈올줄볼])께(?=요?$)/, (m, a) => a + '게'],
  [/^안되(?=요|$)/, '안돼'],
  [/되요$/, '돼요'],
  [/됬/, '됐'],
];

export function fixWord(word) {
  for (const [re, to] of RULES) {
    if (!re.test(word)) continue;
    return word.replace(re, to);
  }
  return word;
}

// 방금 낱말 끝 글자(띄어쓰기 등)를 친 직후 호출: 바로 앞 낱말을 고쳐서 돌려준다. 바뀐 게 없으면 null
export function fixBeforeCaret(text, caret) {
  const typed = text[caret - 1];
  if (typed === undefined || !/[\s.,!?~…)\]"'」]/.test(typed)) return null;
  const head = text.slice(0, caret - 1);
  const m = head.match(/[가-힣]+$/);
  if (!m) return null;
  const fixed = fixWord(m[0]);
  if (fixed === m[0]) return null;
  const from = caret - 1 - m[0].length;
  return { from, to: caret - 1, text: fixed, before: m[0] };
}
