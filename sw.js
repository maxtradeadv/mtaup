const CACHE='stock-flow-v35';
const ASSETS=[
  './',
  './index.html',
  './index.html?v=20260923c',
  './styles.css?v=20260923c',
  './analysis.js?v=20260923c',
  './data-provider.js?v=20260923c',
  './calibration.js?v=20260923c',
  './app.js?v=20260923c',
  './manifest.webmanifest?v=9',
  './icon.svg?v=9',
  './icon-180.png?v=9'
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE)
      .then(cache => cache.addAll(ASSETS))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys.filter(key => key !== CACHE).map(key => caches.delete(key))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;

  event.respondWith(
    fetch(event.request, { cache: 'no-store' })
      .then(response => {
        if (response.ok) {
          const copy = response.clone();
          caches.open(CACHE).then(cache => cache.put(event.request, copy)).catch(() => {});
        }
        return response;
      })
      .catch(() =>
        caches.match(event.request).then(response =>
          response || caches.match('./index.html') || caches.match('./')
        )
      )
  );
});