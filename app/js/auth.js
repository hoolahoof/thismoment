// 비밀번호 화면. 혼자 쓰는 앱이라 이메일은 묻지 않는다.
// 처음 한 번 비밀번호를 만들고, 그 뒤로는 자동으로 열리며 Face ID(패스키)로 잠금을 푼다.
import { supabase } from './supabase.js';
import { OWNER_EMAIL } from '../config.js';
import { esc } from './util.js';

const toKorean = (msg) => {
  if (msg === 'Invalid login credentials') return '비밀번호가 맞지 않아요.';
  if (msg === 'User already registered') return '이미 비밀번호를 만들었어요. 그 비밀번호로 열어주세요.';
  if (msg === 'Email not confirmed') return 'Supabase에서 "Confirm email"을 꺼야 해요.';
  if (/at least 6 characters/i.test(msg)) return '비밀번호는 6자 이상이어야 해요.';
  if (/rate limit/i.test(msg)) return '시도가 너무 많아요. 잠시 후 다시 해주세요.';
  return msg;
};

export async function checkPassword(password) {
  const { error } = await supabase.auth.signInWithPassword({ email: OWNER_EMAIL, password });
  if (error) throw new Error(toKorean(error.message));
}

export function renderAuth(root) {
  let mode = 'login'; // login | setup

  function draw(message = '', isError = false) {
    const setup = mode === 'setup';
    root.innerHTML = `
      <div class="auth">
        <div class="auth-brand">
          <img src="icons/icon-192.png" alt="" width="64" height="64">
          <h1>ThisMoment</h1>
          <p>${setup ? '처음 한 번만 비밀번호를 정해요' : '비밀번호를 입력해 주세요'}</p>
        </div>
        <form class="card form" novalidate autocomplete="off">
          <!-- 아이폰이 "강력한 암호"를 자동으로 채우고 입력칸을 잠가버리지 않도록 new-password 를 쓰지 않는다 -->
          <label>비밀번호<input type="password" name="password" minlength="6" required
            autocomplete="current-password" autocapitalize="off" autocorrect="off" spellcheck="false" inputmode="text"></label>
          ${setup ? `<label>비밀번호 확인<input type="password" name="confirm" minlength="6" required
            autocomplete="current-password" autocapitalize="off" autocorrect="off" spellcheck="false" inputmode="text"></label>` : ''}
          <label class="check"><input type="checkbox" data-action="show"> 비밀번호 보기</label>
          <button class="btn primary" type="submit">${setup ? '비밀번호 만들기' : '열기'}</button>
          <p class="form-msg ${isError ? 'error' : ''}" role="status">${esc(message)}</p>
        </form>
        <button class="link-btn" data-action="mode">${setup ? '이미 비밀번호가 있어요' : '처음 사용해요 (비밀번호 만들기)'}</button>
        <p class="muted small center">한 번 열면 다음부터는 자동으로 열려요. 설정에서 Face ID 잠금을 켤 수 있어요.</p>
      </div>`;

    root.querySelector('[data-action=mode]').addEventListener('click', () => {
      mode = setup ? 'login' : 'setup';
      draw();
    });

    const form = root.querySelector('form');
    // 자동 포커스는 하지 않는다 (아이폰 홈 화면 앱에서 키보드가 꼬이는 원인)
    form.querySelector('[data-action=show]').addEventListener('change', (e) => {
      form.querySelectorAll('input[name=password], input[name=confirm]').forEach((i) => {
        i.type = e.target.checked ? 'text' : 'password';
      });
    });
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const fd = new FormData(form);
      const password = String(fd.get('password'));
      if (password.length < 6) return draw('비밀번호는 6자 이상이어야 해요.', true);
      if (setup && password !== String(fd.get('confirm'))) return draw('두 비밀번호가 달라요.', true);
      const btn = form.querySelector('button[type=submit]');
      btn.disabled = true;
      btn.textContent = '잠시만요…';

      try {
        if (setup) {
          const { data, error } = await supabase.auth.signUp({ email: OWNER_EMAIL, password });
          if (error) throw new Error(toKorean(error.message));
          if (!data.session) throw new Error('Supabase에서 "Confirm email"을 끈 뒤 다시 해주세요.');
        } else {
          await checkPassword(password);
        }
        // 성공하면 onAuthStateChange 가 앱 화면으로 바꿔준다.
      } catch (err) {
        draw(err.message, true);
      }
    });
  }

  draw();
}
