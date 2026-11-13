// ThisMoment 백업: Supabase 의 내 데이터를 파일 하나로 PC 에 저장한다. (한 달에 한 번 작업 스케줄러가 실행)
//   - 항상 파일 하나만 둔다: 새 백업이 성공하면 기존 파일을 새 것으로 바꾼다.
//   - 새 데이터가 비정상적으로 적으면(서버 문제로 비어 온 경우 등) 기존 파일을 지키고, 새 것은 따로 저장한다.
// 필요한 것: 앱 설정의 ③ 토큰을  %USERPROFILE%\.thismoment-token  파일에 한 줄로 저장 (이 파일은 저장소에 올리지 않는다)
// 실행: node tools/backup.mjs
import { readFileSync, writeFileSync, existsSync, mkdirSync, renameSync, appendFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const URL_RPC = 'https://bvqdpkfdmwzszxzzuupz.supabase.co/rest/v1/rpc/export_all';
const APIKEY = 'sb_publishable_1Eq6afXYDO1xSr22IBICpg_dYKl4YAD'; // 공개(publishable) 키
const DIR = process.env.THISMOMENT_BACKUP_DIR || join(homedir(), 'Documents', 'ThisMoment-backup');
const FILE = join(DIR, 'thismoment-backup.json');
const LOG = join(DIR, 'backup.log');
const TOKEN_FILE = join(homedir(), '.thismoment-token');

mkdirSync(DIR, { recursive: true });
const log = (m) => {
  const line = `[${new Date().toLocaleString('ko-KR')}] ${m}`;
  console.log(line);
  appendFileSync(LOG, line + '\n');
};
const total = (d) => ['events', 'todos', 'ddays', 'alarms'].reduce((n, k) => n + (d?.[k]?.length ?? 0), 0);

try {
  const token = (process.env.THISMOMENT_TOKEN || (existsSync(TOKEN_FILE) ? readFileSync(TOKEN_FILE, 'utf8') : '')).trim();
  if (!token) throw new Error(`토큰이 없어요. ${TOKEN_FILE} 파일에 앱 설정의 ③ 토큰을 한 줄로 저장해 주세요.`);

  const res = await fetch(URL_RPC, {
    method: 'POST',
    headers: { apikey: APIKEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ p_token: token }),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`서버 응답 오류 ${res.status}: ${text.slice(0, 200)} (SQL 013 을 실행했는지 확인해 주세요)`);
  const data = JSON.parse(text);
  const n = total(data);

  // 기존 백업보다 훨씬 적으면 의심스러우니 기존 파일을 지키고 새 것은 따로 둔다
  let old = null;
  if (existsSync(FILE)) {
    try { old = JSON.parse(readFileSync(FILE, 'utf8')); } catch { /* 깨진 파일이면 새 것으로 교체 */ }
  }
  if (old && total(old) >= 20 && n < total(old) * 0.5) {
    const alt = join(DIR, `thismoment-backup.suspect.json`);
    writeFileSync(alt, JSON.stringify(data, null, 2));
    log(`경고: 새 데이터(${n}건)가 기존 백업(${total(old)}건)의 절반 미만이라 기존 파일을 그대로 두고 ${alt} 에 따로 저장했어요.`);
    process.exit(2);
  }

  const tmp = FILE + '.tmp';
  writeFileSync(tmp, JSON.stringify(data, null, 2));
  renameSync(tmp, FILE); // 기존 파일이 새 파일로 바뀜
  log(`백업 완료: 일정 ${data.events.length}, 할 일 ${data.todos.length}, 디데이 ${data.ddays.length}, 알람 ${data.alarms.length} → ${FILE}`);
} catch (e) {
  log('백업 실패: ' + (e.message || e));
  process.exit(1);
}
