-- ThisMoment · 9차: 고정한 디데이가 지나가면 자동으로 가장 가까이 남은 디데이로
-- SQL Editor 에 붙여넣고 Run. 여러 번 실행해도 안전. (008 을 먼저 실행한 뒤)
--
-- 위젯 응답에서 고정한 디데이가 이미 지났으면(기념일 세기는 제외) 고정이 없는 것으로 보고,
-- 모든 디데이를 보내서 위젯이 가장 가까이 남은 것을 보여주게 한다.

create or replace function public.get_widget_data(p_token text, p_tz text default 'Asia/Seoul')
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  s       settings;
  v_today date := (now() at time zone p_tz)::date;
  v_pin   boolean;
begin
  select * into s from settings where widget_token = p_token;
  if not found then
    raise exception 'invalid token';
  end if;

  select exists (
    select 1 from ddays
    where user_id = s.user_id and show_in_widget and (count_up or target_date >= v_today)
  ) into v_pin;

  return json_build_object(
    'today', v_today,
    'ddays', coalesce((
      select json_agg(json_build_object(
               'title', title,
               'date', target_date,
               'count_up', count_up,
               'pinned', show_in_widget,
               'diff', target_date - v_today)
             order by abs(target_date - v_today))
      from ddays
      where user_id = s.user_id
        and ((show_in_widget and (count_up or target_date >= v_today)) or not v_pin)
    ), '[]'::json),
    'events', coalesce((
      select json_agg(json_build_object(
               'title', e.title,
               'starts_at', e.starts_at,
               'ends_at', e.ends_at,
               'all_day', e.all_day,
               'color', e.color,
               'recurrence', e.recurrence,
               'is_holiday', e.is_holiday)
             order by e.starts_at)
      from events e
      where e.user_id = s.user_id
        and (
          e.recurrence is not null
          or ((coalesce(e.ends_at, e.starts_at) at time zone p_tz)::date >= v_today - 1
              and (e.starts_at at time zone p_tz)::date <= v_today + 8)
        )
    ), '[]'::json),
    'holidays', coalesce((
      select json_agg(json_build_object('date', h.date, 'name', h.name) order by h.date)
      from kr_holidays h
      where s.show_kr_holidays
        and h.date between v_today and v_today + 14
        and (h.kind <> 'substitute' or s.include_substitute)
        and (h.kind <> 'temporary' or s.include_temporary)
    ), '[]'::json)
  );
end $$;

revoke all on function public.get_widget_data(text, text) from public;
grant execute on function public.get_widget_data(text, text) to anon, authenticated;
