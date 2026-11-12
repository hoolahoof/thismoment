// 앱 화면 파일을 저장해 두고(오프라인에서도 열림), 새 버전이 있으면 뒤에서 갱신한다.
// Supabase 데이터 요청은 저장하지 않는다.
const CACHE = 'thismoment-v4';
const SHELL = [
  './',
  'index.html',
  'styles.css',
  'config.js',
  'manifest.webmanifest',
  'js/app.js',
  'js/auth.js',
  'js/store.js',
  'js/supabase.js',
  'js/util.js',
  'js/views.js',
  'js/lock.js',
  'js/holidays.js',
  'icons/icon-192.png',
  'icons/apple-touch-icon.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  const sameOrigin = url.origin === self.location.origin;
  const cdn = url.hostname === 'cdn.jsdelivr.net' || url.hostname.endsWith('fonts.googleapis.com') || url.hostname.endsWith('fonts.gstatic.com');
  if (!sameOrigin && !cdn) return; // Supabase 등은 그대로 네트워크로

  e.respondWith(
    caches.open(CACHE).then(async (cache) => {
      const cached = await cache.match(req, { ignoreSearch: sameOrigin });
      const network = fetch(req)
        .then((res) => {
          if (res.ok || res.type === 'opaque') cache.put(req, res.clone());
          return res;
        })
        .catch(() => cached);
      return cached || network;
    })
  );
});
