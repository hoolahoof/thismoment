// 푸시 알림 켜기/끄기 (아이폰은 "홈 화면에 추가"한 앱에서만 알림을 받을 수 있다).
import { supabase } from './supabase.js';
import { VAPID_PUBLIC_KEY } from '../config.js';

export const pushSupported = () => 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
export const isStandalone = () => navigator.standalone === true || matchMedia('(display-mode: standalone)').matches;

const keyBytes = (b64) => {
  const s = (b64 + '='.repeat((4 - (b64.length % 4)) % 4)).replace(/-/g, '+').replace(/_/g, '/');
  return Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
};

async function registration() {
  return await navigator.serviceWorker.ready;
}

export async function pushState() {
  if (!pushSupported()) return 'unsupported';
  if (Notification.permission === 'denied') return 'denied';
  const sub = await (await registration()).pushManager.getSubscription();
  return sub && Notification.permission === 'granted' ? 'on' : 'off';
}

export async function enablePush() {
  const perm = await Notification.requestPermission();
  if (perm !== 'granted') throw new Error('알림이 허용되지 않았어요. 아이폰 설정 → 알림 → ThisMoment 에서 허용해 주세요.');
  const reg = await registration();
  let sub = await reg.pushManager.getSubscription();
  if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(VAPID_PUBLIC_KEY) });
  const j = sub.toJSON();
  const { error } = await supabase
    .from('push_subscriptions')
    .upsert({ endpoint: j.endpoint, p256dh: j.keys.p256dh, auth: j.keys.auth }, { onConflict: 'endpoint' });
  if (error) throw new Error(error.message + ' (SQL 011 을 실행했는지 확인해 주세요)');
  await reg.showNotification('알림이 켜졌어요', { body: 'D-Day 3일 전과 하루 전, 오전 9시·오후 9시에 알려드릴게요.', icon: 'icons/icon-192.png' });
}

export async function disablePush() {
  const sub = await (await registration()).pushManager.getSubscription();
  if (!sub) return;
  await supabase.from('push_subscriptions').delete().eq('endpoint', sub.endpoint);
  await sub.unsubscribe();
}
