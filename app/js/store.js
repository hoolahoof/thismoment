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
let pruneTimer = null;
const pruning = new Set();
const PRUNE_AFTER_MS = 10 * 60 * 1000; // 울릴 시각이 지나고 10분 뒤

// 요일 없이 한 번만 울리는 알람은 시간이 지나면 지운다.
// (웹앱은 아이폰에서 알람을 껐는지 알 수 없어서, 울릴 시각이 지난 뒤 10분을 기준으로 한다)
// 예전에는 공휴일/내 휴일 설정이 따로였다. 서버와 앱이 같게 보도록 skip_holidays 값 하나로 맞춘다.
async function alignHolidayFlags() {
  for (const a of [...state.data.alarms]) {
    if (a.skip_custom_holidays === a.skip_holidays) continue;
    try {
      await update('alarms', a.id, { skip_custom_holidays: a.skip_holidays });
    } catch (e) {
      console.warn('알람 설정 맞추기 실패', e);
    }
  }
}

export async function pruneExpiredAlarms() {
  const now = Date.now();
  for (const a of [...state.data.alarms]) {
    if (!a.once_on || (a.days && a.days.length)) continue;
    const at = new Date(`${a.once_on}T${a.time.slice(0, 5)}`).getTime();
    if (now <= at + PRUNE_AFTER_MS || pruning.has(a.id)) continue;
    pruning.add(a.id);
    try {
      await remove('alarms', a.id);
    } catch (e) {
      console.warn('지난 알람 삭제 실패', e);
    } finally {
      pruning.delete(a.id);
    }
  }
}

async function resync() {
  if (!state.user) return;
  try {
    setStatus('syncing');
    await loadAll();
    pruneExpiredAlarms();
    alignHolidayFlags();
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

  clearInterval(pruneTimer);
  pruneTimer = setInterval(pruneExpiredAlarms, 60000);

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
  clearInterval(pruneTimer);
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
