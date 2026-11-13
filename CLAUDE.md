# ThisMoment — 인수인계 (새 세션은 이 파일부터 읽을 것)

혼자 쓰는 캘린더·알람·디데이 웹앱(PWA). 사용자는 **한국어**로 대화하고, Windows 11 PC와 아이폰을 쓴다.
설명은 쉽고 짧게, 결과·못 한 것·확인 안 한 것을 솔직하게 말한다. 되돌리기 어려운 일(공개 게시, 삭제 등)은 먼저 묻는다.

## 한눈에
- 앱 주소: https://hoolahoof.github.io/thismoment/  (홈 화면에 추가해서 사용)
- 저장소: https://github.com/hoolahoof/thismoment (공개). `main`에 push → GitHub Actions가 `app/`만 Pages로 배포 (1~2분)
- 백엔드: Supabase 프로젝트 `bvqdpkfdmwzszxzzuupz` (Postgres + Realtime + Edge Function). 앱 코드엔 **공개(publishable) 키만** 있다 (`app/config.js`).
- 빌드 도구 없음: 순수 JS(ES 모듈) + CSS. `app/index.html` → `app/js/app.js`
- 로그인: 화면엔 비밀번호만. 내부적으로 `OWNER_EMAIL`(me@thismoment.app) 계정 하나로 Supabase Auth 사용. 가입은 막아둘 것(권장).
- Face ID 잠금: 패스키(WebAuthn)로 이 기기에서 앱을 열 때만 확인 (`js/lock.js`).

## 파일 지도 (`app/js`)
| 파일 | 역할 |
|---|---|
| app.js | 탭·화면 전환(해시 라우터 `#/home` …), 잠금/로그인 흐름. 새로 열면 항상 홈 |
| store.js | 데이터 로드 + 실시간 동기화 + insert/update/remove, 지난 한 번만 알람 자동 삭제 |
| views.js | 디데이·알람·설정 화면 (+ views 맵) |
| home.js / quotes.js | 홈(대시보드)과 10초 명언 띠 (`app/data/quotes.json` 965개) |
| calendar.js | 월간 캘린더, 일정 추가/수정 창, 끌어서 기간 선택·일정 옮기기 |
| day.js / week.js / timeline.js | 하루 시간표(블록 끌기·늘리기), 주간 보기, 공통 계산 |
| recur.js / events.js | 반복 규칙 계산, "이 일정만/이후 모두/전체" 수정·삭제 로직 |
| holidays.js | 공휴일·내 휴일 판정, 알람 울림 계산 |
| search.js, colors.js, util.js, auth.js, lock.js, supabase.js | 검색, 색 14가지, 도우미, 비밀번호 화면, 잠금, 연결 |

`app/sw.js`(서비스 워커): 앱 파일은 **서버 우선**, 오프라인이면 캐시. 새 JS/데이터 파일을 만들면 `SHELL` 목록에 추가하고 **배포마다 `CACHE` 버전을 올릴 것**.

## 데이터 (Supabase)
SQL은 `supabase/`에 번호순. 사용자가 SQL Editor에서 직접 실행한다.
- `schema.sql` events·todos·ddays·custom_holidays(더 이상 안 씀)·settings + RLS + 실시간 + `get_widget_data`
- `002` kr_holidays·alarms·`get_alarm_plan`, `003` 공휴일 매일 갱신 예약, `004` 단축어용 응답,
  `005` events.is_holiday(휴일=일정의 한 종류), `006` alarms.once_on(한 번만 알람) + 자동 삭제 예약
- **006 실행 여부는 미확인** (실행 전엔 한 번만 알람 저장만 실패, 나머지는 정상)
- 공휴일: Edge Function `sync-holidays`(공공데이터포털 특일 정보)가 매일 03시 갱신. 키는 Supabase 시크릿 `DATA_GO_KR_KEY` (**저장소에 절대 넣지 말 것**, service_role 키도 마찬가지)

## 핵심 규칙 (구현 의미)
- **반복 일정**: `events.recurrence` 글자 하나 `FREQ=WEEKLY;INTERVAL=2;BYDAY=1,3;UNTIL=2026-12-31;EX=날짜,…` (DB 변경 없음). 계산은 `recur.js`
- **휴일**: 일정 추가 창의 "휴일" 버튼 = `is_holiday` 일정(하루 종일, 반복은 안 함/매년만). 달력엔 칩 대신 빨간 이름
- **알람**: 요일 없음 = 한 번만(`once_on`), 울릴 시각 +10분 뒤 자동 삭제(앱 1분마다 + 서버 pg_cron 10분마다). 반복 알람의 "공휴일에는 울리지 않기"는 법정 공휴일 + 내 휴일 모두 (두 칸 `skip_holidays`/`skip_custom_holidays`에 같은 값)
- 웹앱은 아이폰 시계 알람을 직접 울릴 수 없다 → 마지막 단계에서 **단축어**가 서버 `get_alarm_plan`을 읽어 시계 알람을 켜고 끈다 (알람 이름 `TM 이름 HH:MM`)

## 개발·검증 방법 (겪은 함정)
- 로컬 서버: `python -m http.server <포트> --directory app`. 미리보기 도구는 옛 폴더를 서비스할 수 있으니 **직접 띄울 것**
- 로그인 없이 화면을 확인하려면 임시 `app/_test.html`에서 `window.fetch`를 가짜로 바꿔 끼우고(supabase 모듈을 import하기 **전에**), 데이터를 `store.getState()`에 채운 뒤 `views.X.mount/update`. **커밋 전에 지울 것**. app.js가 처음 로그인 확인 때 데이터를 비우므로 1초쯤 기다린 뒤 채운다
- 순수 로직은 노드로 시험 (`recur.js`, `holidays.js` 등은 DOM 없이 import 가능)
- Windows에서 파이썬 출력은 `python -X utf8` + `PYTHONIOENCODING=utf-8` (기본 cp949라 한글 깨짐)
- CSS 클래스 이름 충돌 주의: `.block`은 하루 시간표 블록 전용 (로그아웃 버튼이 깨진 적 있음). `[hidden]`은 전역 `display:none !important`
- `<dialog>`의 `close` 이벤트를 기다리지 말고 선택 즉시 처리 (일부 환경에서 지연)
- 배포: `git push` 후 `gh run watch`로 확인. 커밋 메시지는 한국어, 끝에 Co-Authored-By 줄(환경 안내를 따를 것)

## 사용자 선호
- 단축어(시계 알람 연동)는 **맨 마지막**에 하기로 함. 홈 화면 위젯(Scriptable)도 그 단계에서
- 하루 탭은 하단에서 뺐고 캘린더의 "시간표 보기"로 들어간다
- 디데이는 홈에서 보므로 캘린더 위 디데이 띠는 뺐다. 디데이 화면의 진행 막대도 불필요해서 뺐다(대표 카드 = 제목·큰 D-숫자·날짜)
- 캘린더: 칸 사이 연한 회색 선, 토요일 하늘색(`--color-sat-soft`)·일요일/휴일 연빨강 바탕, 선택한 날은 바탕 대신 파란 테두리(주간 보기도 같은 규칙)
- 소셜 로그인은 쓰지 않기로 함 (비밀번호 + Face ID만)

## 남은 일 (우선순위)
1. 단축어 연동 + 홈 화면 위젯. 서버 `get_widget_data`는 **반복 일정·휴일 일정을 아직 모름** (이때 같이 고칠 것)
2. 한 번만 알람/반복 일정이 단축어 응답에 맞게 동작하는지 실기기 확인

## 디자인 (방향 E "사무적·정돈" 적용 완료)
- 원본 시안: `design/home-e-light.html`, `design/home-e-dark.html`
- **색·간격·모서리는 `app/tokens.css`의 변수로만** 쓴다 (라이트 `:root`, 다크는 기기 설정 + 설정 화면 "화면 모드" 시스템/라이트/다크 → `<html data-theme>`, `js/theme.js`). 컴포넌트는 `styles.css`. 색을 직접 적지 말 것
- 규칙: 1px 얇은 선, 모서리 카드 8 / 컨트롤 6 / 칩 4 / 시트 12, 그림자 없음, 색은 상태 표시에만(파랑=선택·오늘, 빨강=휴일·임박, 초록=울림)
- 일정 14색은 `--c-이름-bg/bar` 변수 (`colors.js`가 `var(...)` 반환 → 다크 자동)
- 아이콘은 `util.js`의 `icons` (굵기 1.75). 디데이 카드 아이콘은 이름 키워드로 선택(`ddayIcon`)
- 새 JS/CSS 파일은 `sw.js` SHELL에 추가하고 CACHE 버전 올릴 것
- 미확인: 실제 아이폰에서의 다크 모드·상태바 색, 375/430px 폭 전수 확인, 주간 보기·일정 추가 창의 새 스타일
