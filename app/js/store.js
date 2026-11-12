// 데이터 저장소: Supabase에서 전부 불러오고, 실시간 변경을 받아 화면에 알린다.
import { supabase } from './supabase.js';

const TABLES = ['events', 'todos', 'ddays', 'custom_holidays', 'settings', 'alarms'];
const keyOf = (table) => (table === 'settings' ? 'user_id' : 'id');

const state = {
  user: null,
  status: 'idle', // idle | syncing | live | offline
  data: Object.fromEntries(TABLES.map((t) => [t, []])),
  holidays: [], // 대한민국 공휴일 (공용, 읽기 전용)
};

const listeners = new Set();
export const getState = () => state;
export function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
function emit() {
  listeners.forEach((fn) => fn(state));
}
function setStatus(s) {
  if (state.status !== s) {
    state.status = s;
    emit();
  }
}

function upsertLocal(table, row) {
  const k = keyOf(table);
  const list = state.data[table];
  const i = list.findIndex((r) => r[k] === row[k]);
  if (i >= 0) list[i] = row;
  else list.push(row);
}
function removeLocal(table, key) {
  const k = keyOf(table);
  state.data[table] = state.data[table].filter((r) => r[k] !== key);
}

async function loadAll() {
  const [hol, sync, ...results] = await Promise.all([
    supabase.from('kr_holidays').select('*').order('date'),
    supabase.from('kr_holidays_sync').select('*').eq('id', 1).maybeSingle(),
    ...TABLES.map((t) => supabase.from(t).select('*')),
  ]);
  results.forEach((res, i) => {
    if (res.error) throw res.error;
    state.data[TABLES[i]] = res.data;
  });
  if (hol.error) throw hol.error;
  state.holidays = hol.data;
  state.holidaySync = sync.error ? null : sync.data;
  emit();
}

let channel = null;
let started = false;

async function resync() {
  if (!state.user) return;
  try {
    setStatus('syncing');
    await loadAll();
    setStatus(channel && channel.state === 'joined' ? 'live' : 'offline');
  } catch (e) {
    console.error(e);
    setStatus('offline');
  }
}

export async function start(user) {
  state.user = user;
  await resync();

  // 삭제 이벤트는 필터가 걸리지 않으므로 필터 없이 구독하고, 보안은 RLS가 맡는다.
  channel = supabase.channel('db-changes');
  TABLES.forEach((table) => {
    channel.on('postgres_changes', { event: '*', schema: 'public', table }, (p) => {
      if (p.eventType === 'DELETE') removeLocal(table, p.old[keyOf(table)]);
      else if (p.new && p.new.user_id === state.user.id) upsertLocal(table, p.new);
      emit();
    });
  });
  channel.subscribe((s) => {
    if (s === 'SUBSCRIBED') setStatus('live');
    else if (s === 'CHANNEL_ERROR' || s === 'TIMED_OUT' || s === 'CLOSED') setStatus('offline');
  });

  if (!started) {
    started = true;
    window.addEventListener('online', resync);
    window.addEventListener('offline', () => setStatus('offline'));
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') resync();
    });
  }
}

export async function stop() {
  if (channel) await supabase.removeChannel(channel);
  channel = null;
  state.user = null;
  TABLES.forEach((t) => (state.data[t] = []));
  state.status = 'idle';
  emit();
}

// ── 쓰기 ──
export async function insert(table, row) {
  const { data, error } = await supabase.from(table).insert(row).select().single();
  if (error) throw error;
  upsertLocal(table, data);
  emit();
  return data;
}
export async function update(table, key, patch) {
  const { data, error } = await supabase.from(table).update(patch).eq(keyOf(table), key).select().single();
  if (error) throw error;
  upsertLocal(table, data);
  emit();
  return data;
}
export async function remove(table, key) {
  const { error } = await supabase.from(table).delete().eq(keyOf(table), key);
  if (error) throw error;
  removeLocal(table, key);
  emit();
}
