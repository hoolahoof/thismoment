// ThisMoment 위젯 로더 (Scriptable 앱용) — 폰에는 이 파일만 넣어 두면 돼요.
// 실행할 때마다 GitHub 에서 최신 위젯 코드를 받아서 돌리므로, 디자인이 바뀌어도 다시 붙여넣을 필요가 없어요.
// 인터넷이 안 되면 마지막으로 받아 둔 코드를 대신 써요.
//
// 아래 두 줄만 채우세요. (앱 설정 → "아이폰 시계 알람 연동"의 복사 버튼)
//   token  = ③ 토큰
//   apikey = ② apikey 값
globalThis.TM_CONFIG = {
  token: '여기에_토큰_붙여넣기',
  apikey: '여기에_apikey_붙여넣기',
};

const URL_RAW = 'https://raw.githubusercontent.com/hoolahoof/thismoment/main/widget/thismoment-widget.js';
const fm = FileManager.local();
const cache = fm.joinPath(fm.documentsDirectory(), 'thismoment-widget.cache.js');

let code;
try {
  const req = new Request(URL_RAW + '?t=' + Date.now());
  req.timeoutInterval = 10;
  code = await req.loadString();
  if (!code || code.length < 500) throw new Error('받은 코드가 이상해요');
  fm.writeString(cache, code);
} catch (e) {
  if (fm.fileExists(cache)) code = fm.readString(cache);
  else throw e;
}

const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
await new AsyncFunction(code)();
