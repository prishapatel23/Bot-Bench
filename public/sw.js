// Offline cache for BotBench.
// `vite build` fills in VERSION and SHELL (see vite.config.js), so every deploy
// gets a fresh cache and the old one is dropped on activate.
const VERSION = 'dev';
const SHELL = ['/', '/studio'];
const CACHE = `botbench-${VERSION}`;

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k.startsWith('botbench-') && k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// "/studio.html" and "/studio" are the same page; Vercel redirects one to the other
const pageKey = url => url.pathname.replace(/\.html$/, '').replace(/\/index$/, '/') || '/';

self.addEventListener('fetch', event => {
  const req = event.request;
  const url = new URL(req.url);
  // Account calls always go to the network; a cached "who am I" would be wrong
  if (req.method !== 'GET' || url.origin !== location.origin || url.pathname.startsWith('/api/')) return;

  // Hashed build files never change: cache first
  if (url.pathname.startsWith('/assets/')) {
    event.respondWith(
      caches.match(req).then(hit => hit || fetch(req).then(res => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then(cache => cache.put(req, copy));
        }
        return res;
      }))
    );
    return;
  }

  // Pages and everything else: network first, cache when offline
  const isPage = req.mode === 'navigate';
  const key = isPage ? pageKey(url) : req;
  event.respondWith(
    fetch(req).then(res => {
      if (res.ok && !res.redirected) {
        const copy = res.clone();
        caches.open(CACHE).then(cache => cache.put(key, copy));
      }
      return res;
    }).catch(() =>
      caches.match(key).then(hit => hit || (isPage ? caches.match('/') : Response.error()))
    )
  );
});
