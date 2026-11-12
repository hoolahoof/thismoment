# ThisMoment

혼자 쓰는 캘린더 · 타임블록 · 디데이 · 알람 웹앱 (홈 화면에 추가해서 사용).

- `app/` — 웹앱. `main` 에 올리면 GitHub Pages 로 자동 배포된다.
- `supabase/` — 서버(DB) 설정 SQL 과 공휴일 자동 동기화 함수.

## 로컬 실행

```bash
python -m http.server 5391 --directory app
```

http://localhost:5391 을 연다.

## 보안 메모

- `app/config.js` 에는 Supabase **공개(publishable) 키**만 둔다. Secret / service_role 키, 공공데이터포털 키는 Supabase 시크릿에만 넣는다.
- 데이터는 Supabase 행 단위 보안(RLS)으로 본인 계정만 읽고 쓸 수 있다.
