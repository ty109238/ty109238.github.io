/* 离线缓存：首次打开后，断网也能完整浏览 */
const VERSION = 'v1';
const SHELL = 'dex-shell-' + VERSION;
const IMG = 'dex-img-' + VERSION;

const SHELL_URLS = [
  '/',
  '/index.html',
  '/404.html',
  '/manifest.webmanifest',
  '/icon.svg',
  '/shim.js',
  '/editor.html',
  '/editor.js',
  '/editor.css',
  '/assets/index-C8GPqduH.js',
  '/assets/index-C7tQ-E0c.css',
  '/data/content.json'
];

self.addEventListener('install', (e) => {
  e.waitUntil((async () => {
    const c = await caches.open(SHELL);
    await Promise.all(SHELL_URLS.map(async (u) => {
      try {
        const r = await fetch(u, { cache: 'reload' });
        if (r.ok) await c.put(u, r.clone());
      } catch (err) { /* 单个失败不阻塞安装 */ }
    }));
    self.skipWaiting();
  })());
});

self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => k !== SHELL && k !== IMG).map((k) => caches.delete(k)));
    await self.clients.claim();
  })());
});

async function networkFirst(req, cacheName) {
  const cache = await caches.open(cacheName);
  try {
    const fresh = await fetch(req);
    if (fresh && fresh.ok) cache.put(req, fresh.clone());
    return fresh;
  } catch (err) {
    const hit = await cache.match(req);
    if (hit) return hit;
    throw err;
  }
}

async function cacheFirst(req, cacheName) {
  const cache = await caches.open(cacheName);
  const hit = await cache.match(req);
  if (hit) {
    fetch(req).then((r) => { if (r.ok) cache.put(req, r.clone()); }).catch(() => {});
    return hit;
  }
  const fresh = await fetch(req);
  if (fresh && fresh.ok) cache.put(req, fresh.clone());
  return fresh;
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  if (req.mode === 'navigate') {
    event.respondWith((async () => {
      try {
        const fresh = await fetch(req);
        if (fresh && fresh.ok) {
          const c = await caches.open(SHELL);
          c.put('/index.html', fresh.clone());
        }
        return fresh;
      } catch (err) {
        const c = await caches.open(SHELL);
        return (await c.match(req, { ignoreSearch: true })) || (await c.match('/index.html')) || Response.error();
      }
    })());
    return;
  }

  if (url.pathname === '/data/content.json') {
    event.respondWith(networkFirst(req, SHELL));
    return;
  }

  if (url.pathname.startsWith('/media/') || url.pathname.startsWith('/assets/') || url.pathname === '/shim.js') {
    event.respondWith(cacheFirst(req, url.pathname.startsWith('/media/') ? IMG : SHELL));
  }
});
