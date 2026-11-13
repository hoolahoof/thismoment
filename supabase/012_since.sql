-- ThisMoment · 12차: 홈 "기념일 세기"의 이름·날짜를 설정에 저장
-- SQL Editor 에 붙여넣고 Run. 여러 번 실행해도 안전.
-- (이름과 날짜는 앱 설정 화면에서 입력합니다. 코드에는 개인 정보를 두지 않아요.)
alter table public.settings add column if not exists since_label text;
alter table public.settings add column if not exists since_date  date;
