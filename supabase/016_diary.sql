-- ThisMoment · 16차: 오늘하루(일기) 표
-- SQL Editor 에 붙여넣고 Run. 여러 번 실행해도 안전.
-- 하루에 일기 한 개(날짜 + 본문). 본인 것만 읽고 쓸 수 있고, 폰 ↔ PC 실시간 동기화.

create table if not exists public.diary (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null default auth.uid() references auth.users(id) on delete cascade,
  entry_date  date not null,
  body        text not null default '',
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (user_id, entry_date)
);

drop trigger if exists diary_touch on public.diary;
create trigger diary_touch before update on public.diary
  for each row execute function public.touch_updated_at();

alter table public.diary enable row level security;
drop policy if exists diary_own on public.diary;
create policy diary_own on public.diary for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'diary'
  ) then
    alter publication supabase_realtime add table public.diary;
  end if;
end $$;

notify pgrst, 'reload schema';
