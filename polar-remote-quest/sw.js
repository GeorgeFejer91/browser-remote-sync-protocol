const STATIC_CACHE_PREFIX = "polar-remote-pages-static-";
const STATIC_CACHE = `${STATIC_CACHE_PREFIX}v6`;
const STATIC_ASSETS = [
  "./",
  "./index.html",
  "./manifest.webmanifest",
  "./icon.svg",
  "./src/styles.css",
  "./src/styles-v3.css",
  "./src/app-fixed-v2.js",
  "./src/beacon-fixed-v1.js",
  "./src/controller.js",
  "./src/profile.js",
  "./src/waveform.js",
  "../src/brsp.js",
  "../src/vdo-ninja-transport.js",
  "../vendor/vdoninja/1.5.5/vdoninja-sdk.min.js",
];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(STATIC_CACHE)
    .then((cache) => cache.addAll(STATIC_ASSETS))
    .then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => event.waitUntil(
  caches.keys()
    .then((keys) => Promise.all(keys
      .filter((key) => key.startsWith(STATIC_CACHE_PREFIX) && key !== STATIC_CACHE)
      .map((key) => caches.delete(key))))
    .then(() => self.clients.claim()),
));

self.addEventListener("fetch", (event) => {
  const requestUrl = new URL(event.request.url);
  // Cache only this fixed static allow-list. Runtime transport, state, derived
  // session material, and requests containing a query are never cached.
  if (event.request.method !== "GET" || requestUrl.origin !== self.location.origin || requestUrl.search) return;
  const allowedUrls = new Set(STATIC_ASSETS.map((asset) => new URL(asset, self.location.href).href));
  if (!allowedUrls.has(requestUrl.href)) return;
  event.respondWith(caches.open(STATIC_CACHE)
    .then((cache) => cache.match(event.request))
    .then((cached) => cached ?? fetch(event.request)));
});
