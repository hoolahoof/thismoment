// 일정에 붙이는 이모티콘: 카테고리별 목록과 고르는 창.
import { esc } from './util.js';

export const EMOJI_CATS = [
  { name: '표정', list: ['😀', '😄', '😁', '😆', '😊', '🥰', '😍', '🤩', '😎', '🥳', '😋', '🤗', '🤭', '😴', '🥺', '😇', '🤔', '😭', '😤', '🤪', '🫠', '🥹', '😺', '🙈'] },
  { name: '동물', list: ['🐶', '🐱', '🐰', '🐻', '🐼', '🐨', '🐯', '🦁', '🐷', '🐸', '🐵', '🐥', '🦊', '🐹', '🐧', '🦄', '🐢', '🐙', '🐳', '🦋', '🐝', '🐞', '🦦', '🐾'] },
  { name: '음식', list: ['🍎', '🍓', '🍑', '🍒', '🍉', '🍌', '🍔', '🍕', '🍟', '🍣', '🍜', '🍙', '🍰', '🧁', '🍩', '🍪', '☕', '🧋', '🍺', '🥗', '🍦', '🍿', '🥐', '🍳'] },
  { name: '활동', list: ['⚽', '🏀', '🏃', '🏋️', '🧘', '🚴', '🏊', '🎮', '🎬', '🎤', '🎧', '🎨', '📚', '✏️', '🎸', '🎯', '🧩', '🛍️', '🎳', '⛳', '🎾', '🏸', '🧶', '🎹'] },
  { name: '여행', list: ['✈️', '🚗', '🚌', '🚆', '🚲', '🏖️', '🏔️', '🏕️', '🗺️', '🏨', '🎡', '⛱️', '🚢', '🛵', '🌋', '🗼', '🌃', '🧳', '📍', '🌅'] },
  { name: '일상', list: ['💼', '💻', '📞', '📅', '📝', '📌', '🧾', '💊', '🏥', '🧹', '🧺', '🔧', '🛒', '🎓', '🏦', '📦', '📷', '🔑', '💡', '⏰', '🛁', '🦷', '✂️', '🚿'] },
  { name: '기념', list: ['🎉', '🎁', '🎂', '🥂', '🎈', '🎀', '💐', '🌸', '🌈', '⭐', '✨', '🎄', '🧧', '🎆', '🪅', '👑', '💍', '🕯️'] },
  { name: '하트', list: ['❤️', '🧡', '💛', '💚', '💙', '💜', '🩷', '🤍', '💖', '💕', '🔔', '🌙', '☀️', '🍀', '🔥', '💯', '🌟', '💫'] },
];

// 일정 오른쪽에 붙는 이모티콘 (없으면 빈 글자)
export const emojiTag = (ev, cls = '') => (ev?.emoji ? `<span class="emo ${cls}" aria-hidden="true">${esc(ev.emoji)}</span>` : '');

let dlg = null;
let tab = 0;

function build() {
  dlg = document.createElement('dialog');
  dlg.className = 'sheet emoji-sheet';
  dlg.setAttribute('aria-label', '이모티콘 고르기');
  dlg.innerHTML = `
    <div class="form">
      <h2>이모티콘</h2>
      <div class="emo-tabs" role="tablist">${EMOJI_CATS.map((c, i) => `<button type="button" role="tab" data-tab="${i}">${c.name}</button>`).join('')}</div>
      <div class="emo-grid" data-slot="grid"></div>
      <div class="sheet-actions">
        <button class="btn" type="button" data-act="none">이모티콘 없애기</button>
        <span class="grow"></span>
        <button class="btn" type="button" data-act="cancel">닫기</button>
      </div>
    </div>`;
  document.body.appendChild(dlg);
}

function paint(current) {
  dlg.querySelectorAll('[data-tab]').forEach((b) => b.setAttribute('aria-selected', String(Number(b.dataset.tab) === tab)));
  dlg.querySelector('[data-slot=grid]').innerHTML = EMOJI_CATS[tab].list
    .map((e) => `<button type="button" class="emo-cell ${e === current ? 'on' : ''}" data-emoji="${e}" aria-label="${e}">${e}</button>`)
    .join('');
}

// 고른 이모티콘을 돌려준다. 없애기는 '' , 그냥 닫으면 undefined
export function pickEmoji(current = '') {
  if (!dlg) build();
  const d = dlg;
  // 지금 이모티콘이 들어 있는 카테고리부터 보여준다
  const at = EMOJI_CATS.findIndex((c) => c.list.includes(current));
  tab = at >= 0 ? at : 0;
  paint(current);
  return new Promise((resolve) => {
    let done = false;
    const finish = (v) => {
      if (done) return;
      done = true;
      d.removeEventListener('click', onClick);
      d.removeEventListener('close', onClose);
      if (d.open) d.close();
      resolve(v);
    };
    const onClose = () => finish(undefined);
    const onClick = (e) => {
      if (e.target === d) return finish(undefined);
      const t = e.target.closest('[data-tab]');
      if (t) { tab = Number(t.dataset.tab); return paint(current); }
      const em = e.target.closest('[data-emoji]');
      if (em) return finish(em.dataset.emoji);
      const a = e.target.closest('[data-act]');
      if (a) finish(a.dataset.act === 'none' ? '' : undefined);
    };
    d.addEventListener('click', onClick);
    d.addEventListener('close', onClose);
    d.showModal();
  });
}
