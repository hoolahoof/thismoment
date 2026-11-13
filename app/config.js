// Supabase 연결 정보. Publishable(공개) 키만 넣으세요. Secret / service_role 키는 절대 넣지 마세요.
export const SUPABASE_URL = 'https://bvqdpkfdmwzszxzzuupz.supabase.co';
export const SUPABASE_KEY = 'sb_publishable_1Eq6afXYDO1xSr22IBICpg_dYKl4YAD';

// 혼자 쓰는 앱이라 계정은 하나뿐. 화면에는 비밀번호만 묻고, 이 내부용 이메일로 Supabase 계정을 쓴다.
// (메일이 실제로 가지 않도록 Supabase 에서 "Confirm email" 을 꺼야 함)
export const OWNER_EMAIL = 'me@thismoment.app';

// 푸시 알림용 공개 키 (VAPID public). 짝이 되는 비공개 키는 Supabase 시크릿 VAPID_PRIVATE_KEY 에만 둔다.
export const VAPID_PUBLIC_KEY = 'BHTB03dD4D24htFsHp5LOmAMH74orlRldGcers8xcLUmNKwX33cdM4VAswpyyNvNL53uiGOruQCn0v475LMEOCo';
