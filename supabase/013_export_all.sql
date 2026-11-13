-- ThisMoment · 13차: 전체 데이터 내려받기(백업)용 읽기 함수
-- SQL Editor 에 붙여넣고 Run. 여러 번 실행해도 안전.
--
-- PC 의 백업 스크립트(tools/backup.mjs)가 widget_token 으로 호출해서 내 데이터 전체를 JSON 으로 받는다.
-- 토큰이 맞아야만 돌려주고(앱의 설정 → 아이폰 시계 알람 연동 → ③ 토큰), 응답에서 토큰 값 자체는 뺀다.
-- 토큰이 새면 이 함수로 데이터 전체를 읽을 수 있으니 토큰은 비밀로 둘 것 (settings.widget_token 을 새 값으로 바꾸면 무효).

create or replace function public.export_all(p_token text)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  s settings;
begin
  select * into s from settings where widget_token = p_token;
  if not found then
    raise exception 'invalid token';
  end if;

  return json_build_object(
    'app', 'ThisMoment',
    'version', 1,
    'exported_at', now(),
    'events',  coalesce((select json_agg(e order by e.starts_at) from events e where e.user_id = s.user_id), '[]'::json),
    'todos',   coalesce((select json_agg(t) from todos t where t.user_id = s.user_id), '[]'::json),
    'ddays',   coalesce((select json_agg(d) from ddays d where d.user_id = s.user_id), '[]'::json),
    'alarms',  coalesce((select json_agg(a) from alarms a where a.user_id = s.user_id), '[]'::json),
    'settings', coalesce((select json_agg(to_jsonb(x) - 'widget_token') from settings x where x.user_id = s.user_id), '[]'::json)
  );
end $$;

revoke all on function public.export_all(text) from public;
grant execute on function public.export_all(text) to anon, authenticated;
