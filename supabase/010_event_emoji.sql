-- ThisMoment · 10차: 일정에 이모티콘 붙이기
-- SQL Editor 에 붙여넣고 Run. 여러 번 실행해도 안전.
-- (이모티콘을 처음 저장하기 전에 실행하세요. 안 하면 이모티콘 저장만 실패하고 나머지는 정상입니다.)
alter table public.events add column if not exists emoji text;
