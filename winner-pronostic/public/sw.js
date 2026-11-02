/*
 * Service worker de Winner Pronostic.
 *  - Fichiers statiques de Next.js (_next/static) : cache d'abord (ils sont versionnés).
 *  - Icônes et images : affichage immédiat depuis le cache, mise à jour en arrière-plan.
 *  - Pages publiques : réseau d'abord, copie en cache pour une consultation hors ligne.
 *  - Pages personnelles (compte, admin, connexion…) et API : jamais mises en cache.
 * Les notifications push seront ajoutées en phase 7.
 */
const VERSION = "v1";
const STATIC_CACHE = `wp-static-${VERSION}`;
const PAGES_CACHE = `wp-pages-${VERSION}`;
const OFFLINE_URL = "/hors-ligne";
const PRECACHE = [OFFLINE_URL, "/icons/icon-192.png", "/manifest.webmanifest"];
const PRIVATE_PREFIXES = ["/compte", "/admin", "/auth", "/api", "/connexion", "/inscription", "/verification", "/mot-de-passe-oublie", "/nouveau-mot-de-passe"];
const MAX_CACHED_PAGES = 30;

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(STATIC_CACHE)
      .then((cache) => cache.addAll(PRECACHE))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => ![STATIC_CACHE, PAGES_CACHE].includes(k)).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

function isPrivate(pathname) {
  return PRIVATE_PREFIXES.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

async function trimCache(name, max) {
  const cache = await caches.open(name);
  const keys = await cache.keys();
  for (let i = 0; i < keys.length - max; i++) await cache.delete(keys[i]);
}

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  // Requêtes internes du routeur Next.js (RSC) : laissées au réseau.
  if (request.headers.has("RSC") || request.headers.has("Next-Router-State-Tree")) return;

  if (url.pathname.startsWith("/_next/static/")) {
    event.respondWith(
      caches.match(request).then(
        (cached) =>
          cached ||
          fetch(request).then((response) => {
            if (response.ok) {
              const copy = response.clone();
              caches.open(STATIC_CACHE).then((cache) => cache.put(request, copy));
            }
            return response;
          }),
      ),
    );
    return;
  }

  if (url.pathname.startsWith("/icons/") || /\.(png|svg|webp|jpg|jpeg|ico)$/.test(url.pathname)) {
    event.respondWith(
      caches.match(request).then((cached) => {
        const network = fetch(request)
          .then((response) => {
            if (response.ok) {
              const copy = response.clone();
              caches.open(STATIC_CACHE).then((cache) => cache.put(request, copy));
            }
            return response;
          })
          .catch(() => cached);
        return cached || network;
      }),
    );
    return;
  }

  if (request.mode === "navigate") {
    if (isPrivate(url.pathname)) {
      event.respondWith(fetch(request).catch(() => caches.match(OFFLINE_URL)));
      return;
    }
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (response.ok && response.type === "basic") {
            const copy = response.clone();
            caches
              .open(PAGES_CACHE)
              .then((cache) => cache.put(request, copy))
              .then(() => trimCache(PAGES_CACHE, MAX_CACHED_PAGES));
          }
          return response;
        })
        .catch(async () => (await caches.match(request)) || (await caches.match(OFFLINE_URL))),
    );
  }
});
