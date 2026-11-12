-- ThisMoment · 2차: 공휴일 데이터 + 알람
-- Supabase → SQL Editor → New query 에 전체 붙여넣고 Run. 여러 번 실행해도 안전.

-- ─────────────────────────────────────────────
-- 1. 대한민국 공휴일 (2026–2027)
--    kind: public(법정) | substitute(대체공휴일) | temporary(선거일·임시공휴일)
-- ─────────────────────────────────────────────
create table if not exists public.kr_holidays (
  date  date primary key,
  name  text not null,
  kind  text not null default 'public' check (kind in ('public', 'substitute', 'temporary'))
);
alter table public.kr_holidays enable row level security;
drop policy if exists kr_holidays_read on public.kr_holidays;
create policy kr_holidays_read on public.kr_holidays for select to anon, authenticated using (true);

insert into public.kr_holidays (date, name, kind) values
  ('2026-01-01', '신정', 'public'),
  ('2026-02-16', '설날 연휴', 'public'),
  ('2026-02-17', '설날', 'public'),
  ('2026-02-18', '설날 연휴', 'public'),
  ('2026-03-01', '삼일절', 'public'),
  ('2026-03-02', '대체공휴일 (삼일절)', 'substitute'),
  ('2026-05-05', '어린이날', 'public'),
  ('2026-05-24', '부처님오신날', 'public'),
  ('2026-05-25', '대체공휴일 (부처님오신날)', 'substitute'),
  ('2026-06-03', '전국동시지방선거', 'temporary'),
  ('2026-06-06', '현충일', 'public'),
  ('2026-08-15', '광복절', 'public'),
  ('2026-08-17', '대체공휴일 (광복절)', 'substitute'),
  ('2026-09-24', '추석 연휴', 'public'),
  ('2026-09-25', '추석', 'public'),
  ('2026-09-26', '추석 연휴', 'public'),
  ('2026-10-03', '개천절', 'public'),
  ('2026-10-05', '대체공휴일 (개천절)', 'substitute'),
  ('2026-10-09', '한글날', 'public'),
  ('2026-12-25', '성탄절', 'public'),
  ('2027-01-01', '신정', 'public'),
  ('2027-02-05', '설날 연휴', 'public'),
  ('2027-02-06', '설날', 'public'),
  ('2027-02-07', '설날 연휴', 'public'),
  ('2027-02-08', '대체공휴일 (설날)', 'substitute'),
  ('2027-03-01', '삼일절', 'public'),
  ('2027-05-05', '어린이날', 'public'),
  ('2027-05-13', '부처님오신날', 'public'),
  ('2027-06-06', '현충일', 'public'),
  ('2027-08-15', '광복절', 'public'),
  ('2027-08-16', '대체공휴일 (광복절)', 'substitute'),
  ('2027-09-14', '추석 연휴', 'public'),
  ('2027-09-15', '추석', 'public'),
  ('2027-09-16', '추석 연휴', 'public'),
  ('2027-10-03', '개천절', 'public'),
  ('2027-10-04', '대체공휴일 (개천절)', 'substitute'),
  ('2027-10-09', '한글날', 'public'),
  ('2027-10-11', '대체공휴일 (한글날)', 'substitute'),
  ('2027-12-25', '성탄절', 'public'),
  ('2027-12-27', '대체공휴일 (성탄절)', 'substitute')
on conflict (date) do update set name = excluded.name, kind = excluded.kind;

-- ─────────────────────────────────────────────
-- 2. 알람
--    days: 울리는 요일 (0=일 … 6=토)
-- ─────────────────────────────────────────────
create table if not exists public.alarms (
  id                    uuid primary key default gen_random_uuid(),
  user_id               uuid not null default auth.uid() references auth.users(id) on delete cascade,
  label                 text not null default '알람',
  time                  time not null,
  days                  smallint[] not null default '{1,2,3,4,5}',
  skip_holidays         boolean not null default true,   -- 공휴일엔 안 울림
  skip_custom_holidays  boolean not null default true,   -- 내가 지정한 휴일엔 안 울림
  enabled               boolean not null default true,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  constraint alarms_days_valid check (days <@ array[0,1,2,3,4,5,6]::smallint[])
);

alter table public.alarms enable row level security;
drop policy if exists alarms_own on public.alarms;
create policy alarms_own on public.alarms for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

drop trigger if exists alarms_touch on public.alarms;
create trigger alarms_touch before update on public.alarms
  for each row execute function public.touch_updated_at();

do $$
begin
  if not exists (select 1 from pg_publication_tables
                 where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'alarms') then
    alter publication supabase_realtime add table public.alarms;
  end if;
end $$;

-- ─────────────────────────────────────────────
-- 3. 특정 날짜에 어떤 알람이 울리는지 계산 (단축어·알림 서버용)
--    get_alarm_plan('위젯토큰', '2026-12-25') → 그날 공휴일 이름과 알람별 울림 여부
-- ─────────────────────────────────────────────
create or replace function public.get_alarm_plan(p_token text, p_date date default null)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  s         settings;
  v_date    date := coalesce(p_date, (now() at time zone 'Asia/Seoul')::date);
  v_dow     smallint := extract(dow from coalesce(p_date, (now() at time zone 'Asia/Seoul')::date))::smallint;
  v_kr      text;
  v_custom  text;
begin
  select * into s from settings where widget_token = p_token;
  if not found then
    raise exception 'invalid token';
  end if;

  select h.name into v_kr
  from kr_holidays h
  where h.date = v_date
    and s.show_kr_holidays
    and (h.kind <> 'substitute' or s.include_substitute)
    and (h.kind <> 'temporary' or s.include_temporary);

  select c.name into v_custom
  from custom_holidays c
  where c.user_id = s.user_id
    and (
      (not c.yearly and v_date between c.start_date and c.end_date)
      or (c.yearly and to_char(v_date, 'MMDD') between to_char(c.start_date, 'MMDD') and to_char(c.end_date, 'MMDD'))
    )
  limit 1;

  return json_build_object(
    'date', v_date,
    'holiday', v_kr,
    'custom_holiday', v_custom,
    'alarms', coalesce((
      select json_agg(json_build_object(
        'id', a.id,
        'label', a.label,
        'time', to_char(a.time, 'HH24:MI'),
        'ring', a.enabled and v_dow = any(a.days)
                and not (a.skip_holidays and v_kr is not null)
                and not (a.skip_custom_holidays and v_custom is not null),
        'reason', case
          when not a.enabled then 'off'
          when not (v_dow = any(a.days)) then 'not_today'
          when a.skip_holidays and v_kr is not null then 'holiday'
          when a.skip_custom_holidays and v_custom is not null then 'custom_holiday'
          else 'ring' end
      ) order by a.time)
      from alarms a where a.user_id = s.user_id
    ), '[]'::json)
  );
end $$;

revoke all on function public.get_alarm_plan(text, date) from public;
grant execute on function public.get_alarm_plan(text, date) to anon, authenticated;
