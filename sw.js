<<<<<<< HEAD
const CACHE_NAME = 'FreePOS-v1.3.1';
=======
const CACHE_NAME = 'FreePOS-v1.3.0';
>>>>>>> 000949ec3482d9ddb691198e0764f16a4de6b13f
const urlsToCache = [
  './index.html',
  './disco.html',
  './styles.css',
  './sw.js',
  './app.js',
  './admin.html',
<<<<<<< HEAD
  './setAdmin.js',
  './manifest.json',
  './support.html',
  './legal.html',
=======
  './legal.html',
  './setAdmin.js',
  './manifest.json',
  './support.html',
>>>>>>> 000949ec3482d9ddb691198e0764f16a4de6b13f
  './assets/icon-512.png',
  './assets/icon-192.png',
  './assets/madeWithLovePride.png',
  './assets/danceParty.png',
  './assets/screenshot-1.png',
  './assets/screenshot-2.png',
  './assets/screenshot-3.png',
  './assets/screenshot-4.png'
];

console.log('System Version: ' + CACHE_NAME);

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(urlsToCache))
  );
});

self.addEventListener('fetch', event => {
  event.respondWith(
    caches.match(event.request)
      .then(response => response || fetch(event.request))
  );
});
<<<<<<< HEAD

// Clean up old caches when a new service worker takes over
self.addEventListener('activate', event => {
  const cacheWhitelist = [CACHE_NAME];
  event.waitUntil(
    caches.keys().then(cacheNames => {
      return Promise.all(
        cacheNames.map(cacheName => {
          if (cacheWhitelist.indexOf(cacheName) === -1) {
            return caches.delete(cacheName);
          }
        })
      );
    })
  );
});
=======
>>>>>>> 000949ec3482d9ddb691198e0764f16a4de6b13f
