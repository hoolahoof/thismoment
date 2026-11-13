-- ThisMoment · 8차: 위젯에 고정할 디데이 하나 고르기
-- SQL Editor 에 붙여넣고 Run. 여러 번 실행해도 안전.
--
-- ddays.show_in_widget 을 "위젯에 고정" 표시로 쓴다 (앱이 하나만 켜지게 관리).
--  - 고정된 디데이가 있으면 위젯은 그것만 받는다.
--  - 고정이 없으면 모든 디데이를 받아서 위젯이 가장 가까운 것을 보여준다.
-- 기존에는 전부 켜짐(기본값 true)이었으므로, 한 번 모두 끄고 기본값도 false 로 바꾼다.

alter table public.ddays alter column show_in_widget set default false;
update public.ddays set show_in_widget = false where show_in_widget;

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

  select exists (select 1 from ddays where user_id = s.user_id and show_in_widget) into v_pin;

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
      where user_id = s.user_id and (show_in_widget or not v_pin)
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
