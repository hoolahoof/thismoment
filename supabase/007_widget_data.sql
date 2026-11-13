-- ThisMoment · 7차: 홈 화면 위젯(Scriptable)용 응답 개선
-- SQL Editor 에 붙여넣고 Run. 여러 번 실행해도 안전.
--
-- 반복 일정·휴일 일정·공휴일 정보를 위젯이 알 수 있게 한다.
-- 반복 규칙 계산(어느 날 일정인지)은 위젯 스크립트가 앱과 같은 방식으로 직접 한다.
--   events   : 반복 일정 전부 + 오늘 전후(어제~8일 뒤)에 걸친 일반 일정. 휴일 일정은 is_holiday=true
--   holidays : 오늘부터 14일 안의 법정 공휴일 (설정의 표시 여부·대체/임시 포함 여부 반영)

create or replace function public.get_widget_data(p_token text, p_tz text default 'Asia/Seoul')
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  s       settings;
  v_today date := (now() at time zone p_tz)::date;
begin
  select * into s from settings where widget_token = p_token;
  if not found then
    raise exception 'invalid token';
  end if;

  return json_build_object(
    'today', v_today,
    'ddays', coalesce((
      select json_agg(json_build_object(
               'title', title,
               'date', target_date,
               'count_up', count_up,
               'diff', target_date - v_today)
             order by abs(target_date - v_today))
      from ddays
      where user_id = s.user_id and show_in_widget
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
