-- ThisMoment · 4차: 단축어(시계 알람 동기화)용 응답 추가
-- SQL Editor 에 붙여넣고 Run. 여러 번 실행해도 안전.
--
-- 단축어는 시계 앱 알람을 이름으로 구분한다. 이 앱이 관리하는 알람 이름 = "TM 출근 07:00" 처럼
-- 'TM ' + 이름 + ' ' + 시간. 응답에 아래 값을 함께 준다.
--   keys      : 이 앱의 모든 알람 이름 (줄바꿈으로 구분) → 시계에 없으면 새로 만든다
--   ring_keys : 오늘 울려야 하는 알람 이름 (줄바꿈으로 구분) → 시계에서 켠다, 나머지 TM 알람은 끈다

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

  select c.name into v_custom
  from custom_holidays c
  where c.user_id = s.user_id
    and (
      (not c.yearly and v_date between c.start_date and c.end_date)
      or (c.yearly and to_char(v_date, 'MMDD') between to_char(c.start_date, 'MMDD') and to_char(c.end_date, 'MMDD'))
    )
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
