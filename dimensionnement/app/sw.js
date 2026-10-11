/*
 * Service worker de l'application : met en cache tous les fichiers pour un fonctionnement hors connexion.
 * VERSION est recalculée par outils/construire.py à chaque modification des fichiers de l'application ;
 * un nouveau service worker remplace alors l'ancien et la page propose de recharger.
 */
const VERSION = "7cbe9ec69556";
const CACHE = `agent-dimensionnement-${VERSION}`;
const FICHIERS = [
  "./",
  "index.html",
  "moteur.js",
  "app.js",
  "polices.css",
  "manifest.webmanifest",
  "vendor/anthropic-sdk.js",
  "icones/icone.svg",
  "icones/icone-192.png",
  "icones/icone-512.png",
  "icones/icone-masquable-512.png",
  "icones/apple-touch-icon.png",
  "icones/favicon-32.png",
  "polices/barlow-400-latin.woff2",
  "polices/barlow-400-latin-ext.woff2",
  "polices/barlow-500-latin.woff2",
  "polices/barlow-500-latin-ext.woff2",
  "polices/barlow-600-latin.woff2",
  "polices/barlow-600-latin-ext.woff2",
  "polices/barlow-semi-condensed-500-latin.woff2",
  "polices/barlow-semi-condensed-500-latin-ext.woff2",
  "polices/barlow-semi-condensed-600-latin.woff2",
  "polices/barlow-semi-condensed-600-latin-ext.woff2",
  "polices/barlow-semi-condensed-700-latin.woff2",
  "polices/barlow-semi-condensed-700-latin-ext.woff2",
  "polices/ibm-plex-mono-400-latin.woff2",
  "polices/ibm-plex-mono-400-latin-ext.woff2",
  "polices/ibm-plex-mono-500-latin.woff2",
  "polices/ibm-plex-mono-500-latin-ext.woff2",
];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(FICHIERS.map((f) => new Request(f, { cache: "reload" })))));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys()
    .then((cles) => Promise.all(cles.filter((c) => c.startsWith("agent-dimensionnement-") && c !== CACHE).map((c) => caches.delete(c))))
    .then(() => self.clients.claim()));
});

self.addEventListener("message", (e) => {
  if (e.data === "activer") self.skipWaiting();
});

// Fichiers de l'application : cache d'abord (hors connexion), réseau ensuite. Autres requêtes (API Claude) : réseau seul.
self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET" || new URL(req.url).origin !== self.location.origin) return;
  e.respondWith(
    caches.match(req, { ignoreSearch: true }).then((trouve) => trouve || fetch(req).catch(() =>
      req.mode === "navigate" ? caches.match("index.html") : Response.error())),
  );
});
