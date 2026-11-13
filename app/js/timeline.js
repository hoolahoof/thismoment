// 시간표(하루·주간 화면) 공통 계산: 그날 안의 시작·끝 분, 겹치는 일정 나란히 배치.
import { parseDate } from './util.js';

export const minutesOf = (d) => d.getHours() * 60 + d.getMinutes();

// 그날 안에서의 시작/끝 분 (자정을 넘는 일정은 그날 범위로 자른다)
export function spanIn(ev, iso) {
  const day0 = parseDate(iso);
  const day1 = new Date(day0.getFullYear(), day0.getMonth(), day0.getDate() + 1);
  const s = new Date(ev.starts_at);
  const e = ev.ends_at ? new Date(ev.ends_at) : new Date(s.getTime() + 30 * 60000);
  const start = s < day0 ? 0 : minutesOf(s);
  const end = e >= day1 ? 1440 : minutesOf(e);
  return { start, end: Math.max(end, start + 15) };
}

// 겹치는 일정은 나란히 놓는다 (it.col, it.cols 를 채워 돌려줌)
export function layout(items) {
  items.sort((a, b) => a.start - b.start || b.end - a.end);
  const out = [];
  let cluster = [];
  let clusterEnd = -1;
  const flush = () => {
    const cols = [];
    for (const it of cluster) {
      let c = cols.findIndex((end) => end <= it.start);
      if (c === -1) {
        c = cols.length;
        cols.push(0);
      }
      cols[c] = it.end;
      it.col = c;
    }
    cluster.forEach((it) => {
      it.cols = cols.length;
      out.push(it);
    });
    cluster = [];
  };
  for (const it of items) {
    if (cluster.length && it.start >= clusterEnd) flush();
    cluster.push(it);
    clusterEnd = Math.max(clusterEnd, it.end);
  }
  if (cluster.length) flush();
  return out;
}
