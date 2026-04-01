/*
 * Xows Service Worker
 *
 * Caches all application resources for offline use.
 * Uses a "stale-while-revalidate" strategy for most assets and
 * a version-based cache invalidation to detect updates.
 *
 * HOW CACHE REFRESH WORKS:
 * - Bump CACHE_VERSION below whenever you deploy new files.
 * - On activation the old caches are deleted automatically.
 * - The service worker file itself is byte-compared by the browser;
 *   any change (including the version string) triggers an update.
 * - Alternatively, navigation requests always go network-first so
 *   index.html is kept fresh; if the SW detects a new version it
 *   will notify the page to reload.
 */

// ---- Configuration --------------------------------------------------------

// Bump this string on every release to bust the cache.
const CACHE_VERSION = "v1";
const CACHE_NAME    = "xows-" + CACHE_VERSION;

// File extensions that belong to the app shell and should be cached.
// Anything same-origin matching these is cached on first fetch.
const CACHEABLE_EXT = /\.(html|js|css|json|svg|png|ico|ttf|woff2?|ogg|mp3|webm)(\?.*)?$/i;

// ---- Install --------------------------------------------------------------
// No precache list needed — resources are cached dynamically on first fetch.
// Just activate immediately so the fetch handler starts intercepting.

self.addEventListener("install", event => {
  self.skipWaiting();
});

// ---- Activate -------------------------------------------------------------
// Remove outdated caches from previous versions.

self.addEventListener("activate", event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys.filter(key => key.startsWith("xows-") && key !== CACHE_NAME)
            .map(key => caches.delete(key))
      )
    ).then(() => self.clients.claim())
  );
});

// ---- Fetch ----------------------------------------------------------------
// Strategy:
//   • Navigation requests (HTML pages): Network-first, fall back to cache.
//     This ensures the user gets the latest index.html when online, but can
//     still load the app when offline.
//   • All other requests (JS, CSS, fonts, images, sounds, JSON):
//     Stale-while-revalidate – serve from cache immediately for speed, then
//     fetch a fresh copy in the background to update the cache.
//   • Requests to other origins (e.g. WebSocket, XMPP HTTP upload) are
//     passed through without caching.

self.addEventListener("fetch", event => {
  const url = new URL(event.request.url);

  // Only cache same-origin requests
  if(url.origin !== location.origin) return;

  // Skip non-GET requests
  if(event.request.method !== "GET") return;

  // Navigation requests – network-first
  if(event.request.mode === "navigate") {
    event.respondWith(
      fetch(event.request)
        .then(response => {
          const clone = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
          return response;
        })
        .catch(() => caches.match(event.request))
    );
    return;
  }

  // Only cache resources whose path matches known app-shell extensions
  if(!CACHEABLE_EXT.test(url.pathname)) return;

  // All other same-origin assets – stale-while-revalidate
  event.respondWith(
    caches.open(CACHE_NAME).then(cache =>
      cache.match(event.request).then(cached => {
        const networkFetch = fetch(event.request).then(response => {
          // Only cache valid responses
          if(response && response.status === 200 && response.type === "basic") {
            cache.put(event.request, response.clone());
          }
          return response;
        });
        // Return cached response immediately, or wait for network
        return cached || networkFetch;
      })
    )
  );
});

// ---- Update notification --------------------------------------------------
// When a new service worker version takes over, notify all open clients
// so they can reload and pick up the changes.

self.addEventListener("message", event => {
  if(event.data && event.data.type === "SKIP_WAITING") {
    self.skipWaiting();
  }
});
