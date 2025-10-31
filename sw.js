// Simple service worker for AMB Job Board
const CACHE_NAME = 'amb-job-system-v1';
const ASSETS_TO_CACHE = [
  '/',
  '/index.html',
  '/style.css',
  '/app.js',
  '/boards.js',
  '/categories.js',
  '/users.js',
  '/manifest.json',
  '/icons/icon.svg',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  '/admin/index.html',
  '/admin/system_toggle.html'
];

self.addEventListener('install', (evt) => {
  self.skipWaiting();
  evt.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS_TO_CACHE).catch(() => {}))
  );
});

self.addEventListener('activate', (evt) => {
  evt.waitUntil(
    caches.keys().then(keys => Promise.all(
      keys.map(k => { if (k !== CACHE_NAME) return caches.delete(k); })
    ))
  );
  self.clients.claim();
});

self.addEventListener('fetch', (evt) => {
  const req = evt.request;
  // For navigation requests, try network first then fallback to cache
  if (req.mode === 'navigate') {
    evt.respondWith(
      fetch(req).then(res => {
        // update cache with fresh index.html
        const copy = res.clone();
        caches.open(CACHE_NAME).then(c => c.put('/index.html', copy)).catch(()=>{});
        return res;
      }).catch(() => caches.match('/index.html'))
    );
    return;
  }

  // For other requests, respond from cache first then network
  evt.respondWith(
    caches.match(req).then(cached => cached || fetch(req).catch(() => cached))
  );
});
