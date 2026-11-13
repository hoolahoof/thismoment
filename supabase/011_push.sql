-- ThisMoment · 11차: D-Day 푸시 알림 (아이폰 홈 화면 앱으로 알림)
-- send-dday-push 함수를 배포하기 "전에" SQL Editor 에서 먼저 Run. 여러 번 실행해도 안전.
--
-- 1) push_subscriptions : 알림을 받을 기기 (앱 설정에서 알림을 켜면 저장됨)
-- 2) push_log           : 마지막 발송 시각 (같은 시각에 중복 발송 방지)
-- 3) 매일 오전 9시·오후 9시(한국시간)에 send-dday-push 호출 예약
--    (한국 9시 = 00:00 UTC, 21시 = 12:00 UTC)

create table if not exists public.push_subscriptions (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null default auth.uid() references auth.users(id) on delete cascade,
  endpoint   text not null unique,
  p256dh     text not null,
  auth       text not null,
  created_at timestamptz not null default now()
);
alter table public.push_subscriptions enable row level security;
drop policy if exists push_subs_own on public.push_subscriptions;
create policy push_subs_own on public.push_subscriptions
  for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

create table if not exists public.push_log (
  id      int primary key default 1 check (id = 1),
  sent_at timestamptz
);
alter table public.push_log enable row level security; -- 정책 없음: 서버 함수(service role)만 읽고 씀

create extension if not exists pg_cron;
create extension if not exists pg_net with schema extensions;

do $$
begin
  if exists (select 1 from cron.job where jobname = 'dday-push-morning') then
    perform cron.unschedule('dday-push-morning');
  end if;
  if exists (select 1 from cron.job where jobname = 'dday-push-evening') then
    perform cron.unschedule('dday-push-evening');
  end if;
end $$;

select cron.schedule('dday-push-morning', '0 0 * * *', $$
  select net.http_post(
    url := 'https://bvqdpkfdmwzszxzzuupz.supabase.co/functions/v1/send-dday-push',
    headers := '{"Content-Type": "application/json"}'::jsonb,
    body := '{}'::jsonb
  );
$$);

select cron.schedule('dday-push-evening', '0 12 * * *', $$
  select net.http_post(
    url := 'https://bvqdpkfdmwzszxzzuupz.supabase.co/functions/v1/send-dday-push',
    headers := '{"Content-Type": "application/json"}'::jsonb,
    body := '{}'::jsonb
  );
$$);
