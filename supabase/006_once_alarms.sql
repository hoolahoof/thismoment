-- ThisMoment · 6차: 한 번만 울리는 알람 (요일을 고르지 않은 알람)
-- SQL Editor 에 붙여넣고 Run. 여러 번 실행해도 안전.
--
-- 1) alarms 에 once_on(울릴 날짜) 칸 추가 — 요일이 하나도 없는 알람만 값을 가짐
-- 2) get_alarm_plan 이 한 번만 알람을 처리 (공휴일과 상관없이 정한 날에만 울림)
-- 3) 울릴 시각이 지나고 10분 뒤에 한 번만 알람을 자동 삭제 (10분마다 확인)

alter table public.alarms add column if not exists once_on date;

create or replace function public.get_alarm_plan(p_token text, p_date date default null)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  s         settings;
  v_date    date := coalesce(p_date, (now() at time zone 'Asia/Seoul')::date);
  v_dow     smallint;
  v_kr      text;
  v_custom  text;
  v_alarms  json;
begin
  select * into s from settings where widget_token = p_token;
  if not found then
    raise exception 'invalid token';
  end if;
  v_dow := extract(dow from v_date)::smallint;

  select h.name into v_kr
  from kr_holidays h
  where h.date = v_date
    and s.show_kr_holidays
    and (h.kind <> 'substitute' or s.include_substitute)
    and (h.kind <> 'temporary' or s.include_temporary);

  select e.title into v_custom
  from events e
  where e.user_id = s.user_id
    and e.is_holiday
    and (
      (e.recurrence is null
        and (e.starts_at at time zone 'Asia/Seoul')::date <= v_date
        and v_date <= (coalesce(e.ends_at, e.starts_at) at time zone 'Asia/Seoul')::date)
      or
      (e.recurrence like 'FREQ=YEARLY%'
        and v_date >= (e.starts_at at time zone 'Asia/Seoul')::date
        and to_char(v_date, 'MMDD') between to_char(e.starts_at at time zone 'Asia/Seoul', 'MMDD')
                                        and to_char(coalesce(e.ends_at, e.starts_at) at time zone 'Asia/Seoul', 'MMDD')
        and (substring(e.recurrence from 'UNTIL=([0-9]{4}-[0-9]{2}-[0-9]{2})') is null
             or v_date <= substring(e.recurrence from 'UNTIL=([0-9]{4}-[0-9]{2}-[0-9]{2})')::date)
        and position(v_date::text in coalesce(substring(e.recurrence from 'EX=([0-9,-]+)'), '')) = 0)
    )
  order by e.starts_at
  limit 1;

  with plan as (
    select
      a.id,
      a.label,
      to_char(a.time, 'HH24:MI') as hhmm,
      'TM ' || a.label || ' ' || to_char(a.time, 'HH24:MI') as key,
      (coalesce(array_length(a.days, 1), 0) = 0) as is_once,
      a.once_on,
      a.enabled,
      a.days,
      a.skip_holidays,
      a.skip_custom_holidays,
      a.time
    from alarms a
    where a.user_id = s.user_id
  ),
  judged as (
    select p.*,
      case
        when not p.enabled then false
        when p.is_once then p.once_on = v_date
        else v_dow = any(p.days)
             and not (p.skip_holidays and v_kr is not null)
             and not (p.skip_custom_holidays and v_custom is not null)
      end as ring,
      case
        when not p.enabled then 'off'
        when p.is_once then case when p.once_on = v_date then 'ring' else 'not_today' end
        when not (v_dow = any(p.days)) then 'not_today'
        when p.skip_holidays and v_kr is not null then 'holiday'
        when p.skip_custom_holidays and v_custom is not null then 'custom_holiday'
        else 'ring'
      end as reason
    from plan p
  )
  select json_build_object(
    'alarms', coalesce(json_agg(json_build_object(
                'id', id, 'label', label, 'time', hhmm, 'key', key, 'ring', ring, 'reason', reason, 'once', is_once
              ) order by time), '[]'::json),
    'keys', coalesce(string_agg(key, E'\n' order by time), ''),
    'ring_keys', coalesce(string_agg(key, E'\n' order by time) filter (where ring), '')
  ) into v_alarms
  from judged;

  return json_build_object(
    'date', v_date,
    'holiday', v_kr,
    'custom_holiday', v_custom,
    'alarms', v_alarms->'alarms',
    'keys', v_alarms->>'keys',
    'ring_keys', v_alarms->>'ring_keys'
  );
end $$;

revoke all on function public.get_alarm_plan(text, date) from public;
grant execute on function public.get_alarm_plan(text, date) to anon, authenticated;

-- ─────────────────────────────────────────────
-- 지난 한 번만 알람 자동 삭제: 울릴 시각이 지나고 10분 뒤, 10분마다 확인
-- (앱이 열려 있으면 앱도 같은 기준으로 지운다)
-- ─────────────────────────────────────────────
create extension if not exists pg_cron;

do $$
begin
  if exists (select 1 from cron.job where jobname = 'prune-once-alarms') then
    perform cron.unschedule('prune-once-alarms');
  end if;
end $$;

select cron.schedule(
  'prune-once-alarms',
  '*/10 * * * *',
  $$
  delete from public.alarms
  where once_on is not null
    and coalesce(array_length(days, 1), 0) = 0
    and ((once_on + time) at time zone 'Asia/Seoul') < now() - interval '10 minutes';
  $$
);
