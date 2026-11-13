-- ThisMoment · 14차: 디데이를 만들면 그 날짜에 일정이 자동으로 생기게 연결
-- SQL Editor 에 붙여넣고 Run. 여러 번 실행해도 안전.
--
-- 1) events.dday_id : 이 일정이 어느 디데이에서 만들어졌는지 (디데이를 지우면 이 일정도 함께 지워짐)
-- 2) 지금까지 만든 디데이에도 일정을 한 번 만들어 줌 (이미 있으면 건너뜀)

alter table public.events
  add column if not exists dday_id uuid references public.ddays(id) on delete cascade;

insert into public.events (user_id, title, all_day, color, starts_at, ends_at, dday_id)
select d.user_id, d.title, true, 'purple',
       ((d.target_date::text || ' 00:00+09')::timestamptz),
       ((d.target_date::text || ' 00:00+09')::timestamptz),
       d.id
from public.ddays d
where not d.count_up
  and not exists (select 1 from public.events e where e.dday_id = d.id);
