// 명언 띠: data/quotes.json 의 명언을 섞어서 10초마다 하나씩 바꿔 보여준다. 누르면 바로 다음 명언.
const DATA_URL = new URL('../data/quotes.json', import.meta.url);
const FADE_MS = 350;

let cache = null;
async function load() {
  if (cache) return cache;
  const res = await fetch(DATA_URL);
  if (!res.ok) throw new Error('명언을 불러오지 못했어요 (' + res.status + ')');
  const list = await res.json();
  if (!Array.isArray(list) || !list.length) throw new Error('명언 목록이 비었어요');
  cache = list;
  return cache;
}

function shuffled(n) {
  const a = Array.from({ length: n }, (_, i) => i);
  for (let i = n - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// el: 명언 띠 요소 (안에 [data-slot=q-text], [data-slot=q-author] 가 있어야 함)
export function startQuotes(el, { interval = 10000 } = {}) {
  const textEl = el.querySelector('[data-slot=q-text]');
  const authorEl = el.querySelector('[data-slot=q-author]');
  const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
  let list = null;
  let deck = [];
  let pos = 0;
  let last = -1;
  let timer = null;
  let fade = null;

  function draw() {
    if (pos >= deck.length) {
      deck = shuffled(list.length);
      pos = 0;
      // 덱을 새로 섞었을 때 직전 명언이 또 나오지 않게
      if (list.length > 1 && deck[0] === last) [deck[0], deck[1]] = [deck[1], deck[0]];
    }
    last = deck[pos++];
    return list[last];
  }

  function next(animate) {
    if (!list) return;
    const [t, a] = draw();
    const apply = () => {
      textEl.textContent = t;
      authorEl.textContent = a;
      el.classList.remove('fading');
    };
    clearTimeout(fade);
    if (reduceMotion || !animate) return apply();
    el.classList.add('fading');
    fade = setTimeout(apply, FADE_MS);
  }

  function stop() {
    clearInterval(timer);
    clearTimeout(fade);
  }

  function schedule() {
    clearInterval(timer);
    timer = setInterval(() => {
      if (!el.isConnected) return stop(); // 화면을 떠났으면 멈춘다
      if (document.visibilityState === 'visible') next(true);
    }, interval);
  }

  el.addEventListener('click', () => {
    next(true);
    schedule(); // 눌러서 넘기면 10초를 다시 센다
  });

  load()
    .then((l) => {
      list = l;
      el.hidden = false;
      next(false);
      schedule();
    })
    .catch(() => {
      el.hidden = true; // 못 불러오면 띠만 숨기고 나머지는 그대로
    });

  return { stop, next };
}
