// 대한민국 공휴일 자동 동기화 (한국천문연구원 특일 정보 API → kr_holidays 표)
// Supabase → Edge Functions → Deploy a new function → Via Editor
//   이름: sync-holidays,  "Verify JWT" 끄기
// 필요한 시크릿: DATA_GO_KR_KEY (공공데이터포털 일반 인증키, Decoding)
// 매일 03:00(KST)에 003_holiday_sync_schedule.sql 의 예약 작업이 호출한다.
import { createClient } from 'jsr:@supabase/supabase-js@2';

const API = 'https://apis.data.go.kr/B090041/openapi/service/SpcdeInfoService/getRestDeInfo';
const MIN_INTERVAL_MIN = 30; // 너무 자주 불리면 건너뜀 (API 호출 한도 보호)

type Row = { date: string; name: string; kind: 'public' | 'substitute' | 'temporary' };

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

function kindOf(name: string): Row['kind'] {
  if (name.includes('대체')) return 'substitute';
  if (name.includes('선거') || name.includes('임시')) return 'temporary';
  return 'public';
}

async function fetchMonth(key: string, year: number, month: number): Promise<any[]> {
  const url = `${API}?` + new URLSearchParams({
    serviceKey: key,
    solYear: String(year),
    solMonth: String(month).padStart(2, '0'),
    numOfRows: '50',
    _type: 'json',
  });
  const res = await fetch(url);
  const text = await res.text();
  let body: any;
  try {
    body = JSON.parse(text);
  } catch {
    // 키 오류 등은 XML 로 돌아온다
    throw new Error(`API 응답 오류: ${text.slice(0, 200)}`);
  }
  const header = body?.response?.header;
  if (header?.resultCode !== '00') throw new Error(`API 오류: ${header?.resultMsg ?? text.slice(0, 300)}`);
  const items = body?.response?.body?.items?.item ?? [];
  return Array.isArray(items) ? items : items ? [items] : [];
}

async function fetchYear(key: string, year: number): Promise<Row[]> {
  const months = await Promise.all(Array.from({ length: 12 }, (_, i) => fetchMonth(key, year, i + 1)));
  // 같은 날 여러 이름이 오면 합친다 (예: 선거일과 겹침). 하나라도 법정 공휴일이면 public.
  const byDate = new Map<string, Row>();
  for (const it of months.flat()) {
    if (it.isHoliday !== 'Y') continue;
    const d = String(it.locdate);
    const date = `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}`;
    const name = String(it.dateName).trim();
    const kind = kindOf(name);
    const prev = byDate.get(date);
    if (!prev) byDate.set(date, { date, name, kind });
    else {
      if (!prev.name.includes(name)) prev.name = `${prev.name} · ${name}`;
      if (kind === 'public') prev.kind = 'public';
    }
  }
  return [...byDate.values()];
}

Deno.serve(async (req) => {
  const rawKey = (Deno.env.get('DATA_GO_KR_KEY') ?? '').trim();
  if (!rawKey) return json({ error: 'DATA_GO_KR_KEY 시크릿이 없어요.' }, 500);
  // Encoding 키(%2B 등 포함)를 넣었어도 동작하도록 한 번 풀어준다
  const key = rawKey.includes('%') ? decodeURIComponent(rawKey) : rawKey;

  // 서버 전용 키: 예전 이름(SERVICE_ROLE) 또는 새 이름(SECRET_KEYS) 중 있는 것
  let serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  if (!serviceKey) {
    try {
      const keys = JSON.parse(Deno.env.get('SUPABASE_SECRET_KEYS') ?? '{}');
      serviceKey = keys.default ?? Object.values(keys)[0] ?? '';
    } catch { /* 아래에서 처리 */ }
  }
  if (!serviceKey) return json({ error: '서버 키를 찾지 못했어요.' }, 500);

  const db = createClient(Deno.env.get('SUPABASE_URL')!, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const force = new URL(req.url).searchParams.get('force') === '1';
  const { data: meta } = await db.from('kr_holidays_sync').select('*').eq('id', 1).maybeSingle();
  if (!force && meta?.synced_at && Date.now() - new Date(meta.synced_at).getTime() < MIN_INTERVAL_MIN * 60_000) {
    return json({ skipped: true, last: meta });
  }

  const thisYear = Number(new Date().toLocaleString('en-CA', { timeZone: 'Asia/Seoul' }).slice(0, 4));
  const report: Record<string, unknown> = {};

  for (const year of [thisYear, thisYear + 1]) {
    try {
      const rows = await fetchYear(key, year);
      // 내년 자료가 아직 발표되지 않았으면(몇 건 안 되면) 기존 데이터를 지우지 않는다
      if (rows.length < 10) {
        report[year] = { kept_existing: true, fetched: rows.length };
        if (rows.length) await db.from('kr_holidays').upsert(rows, { onConflict: 'date' });
        continue;
      }
      const { error: upErr } = await db.from('kr_holidays').upsert(rows, { onConflict: 'date' });
      if (upErr) throw upErr;
      // API 에 없는 날(취소·변경된 공휴일)은 지운다
      const keep = rows.map((r) => r.date);
      const { error: delErr } = await db
        .from('kr_holidays')
        .delete()
        .gte('date', `${year}-01-01`)
        .lte('date', `${year}-12-31`)
        .not('date', 'in', `(${keep.join(',')})`);
      if (delErr) throw delErr;
      report[year] = { synced: rows.length };
    } catch (e) {
      report[year] = { error: String((e as Error).message ?? e) };
    }
  }

  const ok = Object.values(report).some((r: any) => r.synced || r.kept_existing);
  await db.from('kr_holidays_sync').upsert({ id: 1, synced_at: new Date().toISOString(), report, ok });
  return json({ ok, report }, ok ? 200 : 502);
});
