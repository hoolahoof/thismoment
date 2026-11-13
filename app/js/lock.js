// Face ID / Touch ID / Windows Hello 잠금 (패스키 사용).
// 이 기기에 패스키를 만들어 두고, 앱을 열 때마다 얼굴(지문) 확인을 통과해야 화면이 열린다.
// 로그인 자체는 자동 로그인 세션이 맡고, 이 잠금은 "이 기기에서 나만 열 수 있게" 하는 역할이다.

const KEY = (uid) => `tm.lock.${uid}`;
const RELOCK_AFTER_MS = 5 * 60 * 1000; // 앱을 5분 이상 벗어났다 오면 다시 잠금

const b64url = (buf) =>
  btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const fromB64url = (s) => {
  const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
};
const randomChallenge = () => crypto.getRandomValues(new Uint8Array(32));

function read(uid) {
  try {
    return localStorage.getItem(KEY(uid));
  } catch {
    return null;
  }
}

export async function lockSupported() {
  try {
    return !!window.PublicKeyCredential &&
      (await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable());
  } catch {
    return false;
  }
}

export const isLockEnabled = (uid) => !!read(uid);

export async function enableLock(user) {
  const cred = await navigator.credentials.create({
    publicKey: {
      challenge: randomChallenge(),
      rp: { name: 'ThisMoment' },
      user: {
        id: new TextEncoder().encode(user.id),
        name: user.email || user.id,
        displayName: user.user_metadata?.name || user.email || 'ThisMoment',
      },
      pubKeyCredParams: [
        { type: 'public-key', alg: -7 },
        { type: 'public-key', alg: -257 },
      ],
      authenticatorSelection: {
        authenticatorAttachment: 'platform',
        userVerification: 'required',
        residentKey: 'preferred',
      },
      timeout: 60000,
    },
  });
  localStorage.setItem(KEY(user.id), b64url(cred.rawId));
}

export function disableLock(uid) {
  try {
    localStorage.removeItem(KEY(uid));
  } catch {}
}

export async function verifyLock(uid) {
  const id = read(uid);
  if (!id) return true;
  await navigator.credentials.get({
    publicKey: {
      challenge: randomChallenge(),
      allowCredentials: [{ type: 'public-key', id: fromB64url(id) }],
      userVerification: 'required',
      timeout: 60000,
    },
  });
  return true;
}

// ── 다시 잠글 시점 계산 ──
let hiddenAt = 0;
export function watchRelock(onRelock) {
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') hiddenAt = Date.now();
    else if (hiddenAt && Date.now() - hiddenAt > RELOCK_AFTER_MS) onRelock();
  });
}

export function renderLock(root, { onUnlock, onPassword, onLogout }) {
  root.innerHTML = `
    <div class="auth lock">
      <div class="auth-brand">
        <img src="icons/icon-192.png" alt="" width="64" height="64">
        <h1>ThisMoment</h1>
        <p>Face ID 확인 중…</p>
      </div>
      <button class="btn primary big" data-action="unlock" hidden>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><path d="M4 8V6a2 2 0 0 1 2-2h2M16 4h2a2 2 0 0 1 2 2v2M20 16v2a2 2 0 0 1-2 2h-2M8 20H6a2 2 0 0 1-2-2v-2M9 9.5v1M15 9.5v1M12 9.5v3.5h-1M9.5 16c1.5 1 3.5 1 5 0"/></svg>
        Face ID로 열기
      </button>
      <p class="form-msg center" role="status"></p>
      <form class="card form" data-slot="pw" novalidate hidden>
        <label>비밀번호로 열기<input type="password" name="password" autocomplete="current-password"></label>
        <button class="btn" type="submit">비밀번호로 열기</button>
      </form>
      <button class="link-btn" data-action="logout">로그아웃</button>
    </div>`;
  const msg = root.querySelector('.form-msg');
  root.querySelector('[data-slot=pw]').addEventListener('submit', async (e) => {
    e.preventDefault();
    const pw = e.target.elements.namedItem('password').value;
    if (!pw) return;
    try {
      msg.textContent = '';
      await onPassword(pw);
    } catch (err) {
      msg.textContent = err.message;
    }
  });
  // 바로 패스키(Face ID)를 시도하고, 안 되면 비밀번호 입력칸을 보여준다
  const sub = root.querySelector('.auth-brand p');
  const showFallback = (text) => {
    sub.textContent = '비밀번호로 열어주세요';
    msg.textContent = text;
    root.querySelector('[data-slot=pw]').hidden = false;
    root.querySelector('[data-action=unlock]').hidden = false;
    root.querySelector('[data-action=unlock]').classList.remove('primary');
    root.querySelector('[name=password]').focus({ preventScroll: true });
  };
  const unlock = async () => {
    try {
      msg.textContent = '';
      sub.textContent = 'Face ID 확인 중…';
      await onUnlock();
    } catch (e) {
      showFallback(e?.name === 'NotAllowedError' ? 'Face ID를 쓰지 못했어요.' : 'Face ID를 쓸 수 없어요: ' + (e?.message ?? e));
    }
  };
  root.querySelector('[data-action=unlock]').addEventListener('click', () => unlock());
  root.querySelector('[data-action=logout]').addEventListener('click', onLogout);
  unlock();
}
