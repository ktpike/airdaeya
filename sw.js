// =================================================================================
// Airdaeium Service Worker
// =================================================================================

const CACHE_NAME = 'airdaeium-v6';

// Core app shell files to cache on install
const PRECACHE_URLS = [
    '/',
    '/index.html',
    '/style.css',
    '/script.js',
    '/manifest.json',
    '/favicon.png'
];

// =================================================================================
// Install — pre-cache the app shell
// =================================================================================
self.addEventListener('install', event => {
    event.waitUntil(
        caches.open(CACHE_NAME).then(cache => {
            console.log('[SW] Pre-caching app shell');
            return cache.addAll(PRECACHE_URLS);
        }).then(() => self.skipWaiting())
    );
});

// =================================================================================
// Activate — clean up old caches
// =================================================================================
self.addEventListener('activate', event => {
    event.waitUntil(
        caches.keys().then(cacheNames => {
            return Promise.all(
                cacheNames
                    .filter(name => name !== CACHE_NAME)
                    .map(name => {
                        console.log('[SW] Deleting old cache:', name);
                        return caches.delete(name);
                    })
            );
        }).then(() => self.clients.claim())
    );
});

// =================================================================================
// Fetch — network-first for Firebase/API calls, cache-first for app shell
// =================================================================================
self.addEventListener('fetch', event => {
    const url = new URL(event.request.url);

    // Always go network-first for Firebase (Firestore, Storage, Functions)
    if (
        url.hostname.includes('firebaseapp.com') ||
        url.hostname.includes('firebasestorage.googleapis.com') ||
        url.hostname.includes('firestore.googleapis.com') ||
        url.hostname.includes('cloudfunctions.net')
    ) {
        event.respondWith(
            fetch(event.request).catch(() => {
                // If network fails, return a simple offline response for API calls
                return new Response(JSON.stringify({ offline: true }), {
                    headers: { 'Content-Type': 'application/json' }
                });
            })
        );
        return;
    }

    // Cache-first strategy for app shell assets
    event.respondWith(
        caches.match(event.request).then(cachedResponse => {
            if (cachedResponse) {
                // Serve from cache, but also refresh in background (stale-while-revalidate)
                fetch(event.request).then(networkResponse => {
                    if (networkResponse && networkResponse.ok) {
                        caches.open(CACHE_NAME).then(cache => {
                            cache.put(event.request, networkResponse.clone());
                        });
                    }
                }).catch(() => {});
                return cachedResponse;
            }

            // Not in cache — fetch from network and cache it
            return fetch(event.request).then(networkResponse => {
                if (!networkResponse || !networkResponse.ok || event.request.method !== 'GET') {
                    return networkResponse;
                }
                const responseToCache = networkResponse.clone();
                caches.open(CACHE_NAME).then(cache => {
                    cache.put(event.request, responseToCache);
                });
                return networkResponse;
            }).catch(() => {
                // If both cache and network fail and it's a navigation request,
                // serve the cached index.html as a fallback
                if (event.request.mode === 'navigate') {
                    return caches.match('/index.html');
                }
            });
        })
    );
});
