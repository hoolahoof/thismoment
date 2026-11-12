-- ThisMoment 앱 · Supabase 스키마
-- Supabase 대시보드 → SQL Editor → New query 에 전체를 붙여넣고 Run.
-- 여러 번 실행해도 안전하도록 작성됨.

create extension if not exists pgcrypto;

-- ─────────────────────────────────────────────
-- 1. 테이블
-- ─────────────────────────────────────────────

-- 일정 / 타임블록
create table if not exists public.events (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null default auth.uid() references auth.users(id) on delete cascade,
  title       text not null,
  starts_at   timestamptz not null,
  ends_at     timestamptz,
  all_day     boolean not null default false,
  color       text not null default 'blue',
  note        text,
  recurrence  text,                      -- 반복 규칙 (예: 'FREQ=WEEKLY;BYDAY=MO')
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint events_time_order check (ends_at is null or ends_at >= starts_at)
);
create index if not exists events_user_start_idx on public.events (user_id, starts_at);

-- 할 일
create table if not exists public.todos (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null default auth.uid() references auth.users(id) on delete cascade,
  title       text not null,
  due_date    date,
  done        boolean not null default false,
  sort        integer not null default 0,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists todos_user_due_idx on public.todos (user_id, due_date);

-- 디데이
create table if not exists public.ddays (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null default auth.uid() references auth.users(id) on delete cascade,
  title           text not null,
  target_date     date not null,
  count_up        boolean not null default false,   -- true 면 D+N (기념일 세기)
  show_in_widget  boolean not null default true,
  color           text not null default 'blue',
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

-- 내가 지정한 휴일
create table if not exists public.custom_holidays (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name        text not null,
  start_date  date not null,
  end_date    date not null,
  yearly      boolean not null default false,       -- 매년 반복
  color       text not null default 'orange',
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint custom_holidays_order check (end_date >= start_date)
);

-- 사용자 설정 (1인 1행)
create table if not exists public.settings (
  user_id              uuid primary key default auth.uid() references auth.users(id) on delete cascade,
  show_kr_holidays     boolean not null default true,
  include_substitute   boolean not null default true,
  include_temporary    boolean not null default true,
  widget_token         text not null unique default encode(gen_random_bytes(24), 'hex'),
  updated_at           timestamptz not null default now()
);

-- ─────────────────────────────────────────────
-- 2. updated_at 자동 갱신
-- ─────────────────────────────────────────────
create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

do $$
declare t text;
begin
  foreach t in array array['events','todos','ddays','custom_holidays','settings'] loop
    execute format('drop trigger if exists %I_touch on public.%I', t, t);
    execute format('create trigger %I_touch before update on public.%I
                    for each row execute function public.touch_updated_at()', t, t);
  end loop;
end $$;

-- ─────────────────────────────────────────────
-- 3. 행 단위 보안 (RLS): 본인 데이터만 읽기/쓰기
-- ─────────────────────────────────────────────
do $$
declare t text;
begin
  foreach t in array array['events','todos','ddays','custom_holidays','settings'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists %I_own on public.%I', t, t);
    execute format('create policy %I_own on public.%I for all to authenticated
                    using (user_id = auth.uid()) with check (user_id = auth.uid())', t, t);
  end loop;
end $$;

-- ─────────────────────────────────────────────
-- 4. 실시간 동기화 (폰 ↔ PC 즉시 반영)
-- ─────────────────────────────────────────────
do $$
declare t text;
begin
  foreach t in array array['events','todos','ddays','custom_holidays','settings'] loop
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t
    ) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $$;

-- ─────────────────────────────────────────────
-- 5. Scriptable 위젯용 읽기 전용 함수
--    위젯은 로그인 없이 widget_token 하나로 디데이·오늘 일정만 읽음.
--    (토큰이 새면 settings.widget_token 을 새 값으로 바꾸면 끝)
-- ─────────────────────────────────────────────
create or replace function public.get_widget_data(p_token text, p_tz text default 'Asia/Seoul')
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user  uuid;
  v_today date := (now() at time zone p_tz)::date;
begin
  select user_id into v_user from settings where widget_token = p_token;
  if v_user is null then
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
      where user_id = v_user and show_in_widget
    ), '[]'::json),
    'events', coalesce((
      select json_agg(json_build_object(
               'title', title,
               'starts_at', starts_at,
               'ends_at', ends_at,
               'all_day', all_day,
               'color', color)
             order by starts_at)
      from events
      where user_id = v_user
        and (starts_at at time zone p_tz)::date = v_today
    ), '[]'::json),
    'custom_holidays', coalesce((
      select json_agg(json_build_object('name', name, 'start', start_date, 'end', end_date, 'yearly', yearly))
      from custom_holidays
      where user_id = v_user
    ), '[]'::json)
  );
end $$;

revoke all on function public.get_widget_data(text, text) from public;
grant execute on function public.get_widget_data(text, text) to anon, authenticated;

-- ─────────────────────────────────────────────
-- 6. 가입하면 settings 행 자동 생성
-- ─────────────────────────────────────────────
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.settings (user_id) values (new.id)
  on conflict (user_id) do nothing;
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();
