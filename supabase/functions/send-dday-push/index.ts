// D-Day 푸시 알림: 3일 전·1일 전, 매일 오전 9시·오후 9시(한국시간)에 아이폰으로 알림을 보낸다.
// Supabase → Edge Functions → Deploy a new function → Via Editor
//   이름: send-dday-push,  "Verify JWT" 끄기
// 필요한 시크릿 (Edge Functions → Secrets):
//   VAPID_PUBLIC_KEY   (app/config.js 의 VAPID_PUBLIC_KEY 와 같은 값)
//   VAPID_PRIVATE_KEY  (비밀! 저장소에 넣지 말 것)
// 011_push.sql 의 예약 작업이 하루 두 번 호출한다.
import { createClient } from 'jsr:@supabase/supabase-js@2';
import webpush from 'npm:web-push@3.6.7';

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

const APP_URL = 'https://hoolahoof.github.io/thismoment/#/dday';
const WD = ['일', '월', '화', '수', '목', '금', '토'];

Deno.serve(async () => {
  const pub = Deno.env.get('VAPID_PUBLIC_KEY');
  const priv = Deno.env.get('VAPID_PRIVATE_KEY');
  if (!pub || !priv) return json({ ok: false, error: 'VAPID 키 시크릿이 없어요' }, 500);
  webpush.setVapidDetails('https://hoolahoof.github.io/thismoment/', pub, priv);

  const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

  // 한국시간 기준 오늘 날짜와 시각
  const kst = new Date(Date.now() + 9 * 3600 * 1000);
  const hour = kst.getUTCHours();
  const today = kst.toISOString().slice(0, 10);

  // 아무나 주소를 불러도 아침·저녁(9시·21시 전후)에만, 30분에 한 번만 보낸다
  if (![9, 21].includes(hour)) return json({ ok: true, skipped: '발송 시간이 아니에요', hour });
  const { data: log } = await db.from('push_log').select('sent_at').eq('id', 1).maybeSingle();
  if (log?.sent_at && Date.now() - new Date(log.sent_at).getTime() < 30 * 60 * 1000) {
    return json({ ok: true, skipped: '방금 보냈어요' });
  }
  await db.from('push_log').upsert({ id: 1, sent_at: new Date().toISOString() });

  const { data: subs } = await db.from('push_subscriptions').select('id,user_id,endpoint,p256dh,auth');
  if (!subs?.length) return json({ ok: true, sent: 0, note: '구독한 기기가 없어요' });

  const t0 = new Date(today + 'T00:00:00Z').getTime();
  const { data: ddays } = await db.from('ddays').select('user_id,title,target_date,count_up').eq('count_up', false);
  const due = (ddays ?? [])
    .map((d) => ({ ...d, diff: Math.round((new Date(d.target_date + 'T00:00:00Z').getTime() - t0) / 86400000) }))
    .filter((d) => d.diff === 3 || d.diff === 1);

  let sent = 0;
  const dead: string[] = [];
  for (const d of due) {
    const dt = new Date(d.target_date + 'T00:00:00Z');
    const when = `${dt.getUTCMonth() + 1}월 ${dt.getUTCDate()}일 (${WD[dt.getUTCDay()]})`;
    const payload = JSON.stringify({
      title: `D-${d.diff} · ${d.title}`,
      body: d.diff === 1 ? `내일이에요! ${when}` : `${d.diff}일 남았어요. ${when}`,
      tag: `dday-${d.title}-${d.diff}-${hour}`,
      url: APP_URL,
    });
    for (const s of subs.filter((x) => x.user_id === d.user_id)) {
      try {
        await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, payload, { TTL: 3600 });
        sent++;
      } catch (e) {
        const code = (e as { statusCode?: number }).statusCode;
        if (code === 404 || code === 410) dead.push(s.id); // 앱을 지웠거나 알림을 끈 기기
      }
    }
  }
  if (dead.length) await db.from('push_subscriptions').delete().in('id', dead);
  return json({ ok: true, today, hour, due: due.length, sent, removed: dead.length });
});
