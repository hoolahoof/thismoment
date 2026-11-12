-- ThisMoment · 3차: 공휴일 자동 동기화 예약
-- sync-holidays 함수를 배포하기 "전에" SQL Editor 에서 먼저 Run. 여러 번 실행해도 안전.

-- 1. 마지막 동기화 기록 (앱 설정 화면에서 "공휴일 갱신: 오늘 03:00" 처럼 보여줌)
create table if not exists public.kr_holidays_sync (
  id         int primary key default 1 check (id = 1),
  synced_at  timestamptz,
  ok         boolean,
  report     jsonb
);
alter table public.kr_holidays_sync enable row level security;
drop policy if exists kr_holidays_sync_read on public.kr_holidays_sync;
create policy kr_holidays_sync_read on public.kr_holidays_sync for select to anon, authenticated using (true);

-- 2. 예약 실행 도구
create extension if not exists pg_cron;
create extension if not exists pg_net with schema extensions;

-- 3. 매일 03:00 (한국시간) = 18:00 UTC 에 공휴일 갱신
do $$
begin
  if exists (select 1 from cron.job where jobname = 'sync-kr-holidays') then
    perform cron.unschedule('sync-kr-holidays');
  end if;
end $$;

select cron.schedule(
  'sync-kr-holidays',
  '0 18 * * *',
  $$
  select net.http_post(
    url := 'https://bvqdpkfdmwzszxzzuupz.supabase.co/functions/v1/sync-holidays',
    headers := '{"Content-Type": "application/json"}'::jsonb,
    body := '{}'::jsonb
  );
  $$
);
