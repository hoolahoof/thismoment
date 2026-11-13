-- ThisMoment · 5차: "휴일"을 일정의 한 종류로 (일정 추가 창의 휴일 버튼)
-- SQL Editor 에 붙여넣고 Run. 여러 번 실행해도 안전.
--
-- 1) events 에 is_holiday 칸 추가
-- 2) 예전에 따로 만든 내 휴일(custom_holidays)을 일정으로 옮기고 비움
-- 3) get_alarm_plan 이 "휴일로 표시한 일정"을 보고 알람을 쉬게 함

alter table public.events add column if not exists is_holiday boolean not null default false;

-- 예전 내 휴일 → 휴일 일정 (이미 옮긴 것은 건너뜀)
insert into public.events (user_id, title, starts_at, ends_at, all_day, color, is_holiday, recurrence)
select c.user_id,
       c.name,
       (c.start_date::timestamp at time zone 'Asia/Seoul'),
       (c.end_date::timestamp at time zone 'Asia/Seoul'),
       true,
       'red',
       true,
       case when c.yearly then 'FREQ=YEARLY;INTERVAL=1' end
from public.custom_holidays c
where not exists (
  select 1 from public.events e
  where e.user_id = c.user_id and e.is_holiday and e.title = c.name
    and e.starts_at = (c.start_date::timestamp at time zone 'Asia/Seoul')
);
delete from public.custom_holidays;

-- ─────────────────────────────────────────────
-- 알람 계획: 공휴일 + 휴일로 표시한 일정(한 번짜리 기간 / 매년 반복)을 모두 반영
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
      -- 한 번짜리: 시작~끝 날짜 사이
      (e.recurrence is null
        and (e.starts_at at time zone 'Asia/Seoul')::date <= v_date
        and v_date <= (coalesce(e.ends_at, e.starts_at) at time zone 'Asia/Seoul')::date)
      or
      -- 매년 반복: 월·일이 기간 안에 들고, 끝나는 날·뺀 날이 아닐 것
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
      (a.enabled and v_dow = any(a.days)
        and not (a.skip_holidays and v_kr is not null)
        and not (a.skip_custom_holidays and v_custom is not null)) as ring,
      case
        when not a.enabled then 'off'
        when not (v_dow = any(a.days)) then 'not_today'
        when a.skip_holidays and v_kr is not null then 'holiday'
        when a.skip_custom_holidays and v_custom is not null then 'custom_holiday'
        else 'ring'
      end as reason,
      a.time
    from alarms a
    where a.user_id = s.user_id
  )
  select json_build_object(
    'alarms', coalesce(json_agg(json_build_object(
                'id', id, 'label', label, 'time', hhmm, 'key', key, 'ring', ring, 'reason', reason
              ) order by time), '[]'::json),
    'keys', coalesce(string_agg(key, E'\n' order by time), ''),
    'ring_keys', coalesce(string_agg(key, E'\n' order by time) filter (where ring), '')
  ) into v_alarms
  from plan;

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
