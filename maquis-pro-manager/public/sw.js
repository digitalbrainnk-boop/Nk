// Service worker : l'application s'ouvre même sans internet, les dernières données consultées
// restent lisibles, et les notifications push arrivent même application fermée.
const VERSION = "mpm-v1";
const SHELL = [
  "/",
  "/index.html",
  "/style.css",
  "/manifest.webmanifest",
  "/icon.svg",
  "/icon-192.png",
  "/icon-512.png",
  "/icon-maskable-512.png",
  "/js/app.js",
  "/js/core.js",
  "/js/views-common.js",
  "/js/views-owner.js",
  "/js/views-manager.js",
  "/js/views-staff.js",
];
// Lectures gardées pour le mode hors connexion (catalogue, commandes, caisse…).
const CACHEABLE_API = /^\/api\/(bootstrap|products|orders|cash\/current|credits|my-stats|stock|dashboard|notifications|reports|documents)(\?|$|\/)/;

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION && k !== "mpm-api" && k !== "mpm-media").map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return;
  if (url.pathname === "/api/events" || /\/(pdf|xlsx|print)$/.test(url.pathname) || url.pathname.startsWith("/api/backups")) return;

  if (url.pathname.startsWith("/api/")) {
    if (!CACHEABLE_API.test(url.pathname + url.search)) return;
    // Réseau d'abord ; sans réseau, la dernière réponse connue (signalée par X-From-Cache).
    e.respondWith(
      fetch(req)
        .then((res) => {
          if (res.ok) {
            const copy = res.clone();
            caches.open("mpm-api").then((c) => c.put(req, copy));
          }
          return res;
        })
        .catch(async () => {
          const hit = await caches.match(req, { cacheName: "mpm-api" });
          if (!hit) return new Response(JSON.stringify({ error: "Pas de connexion internet et aucune donnée enregistrée sur ce téléphone." }), { status: 503, headers: { "Content-Type": "application/json" } });
          const headers = new Headers(hit.headers);
          headers.set("X-From-Cache", "1");
          return new Response(await hit.blob(), { status: hit.status, headers });
        }),
    );
    return;
  }

  if (url.pathname.startsWith("/media/")) {
    e.respondWith(
      caches.open("mpm-media").then(async (c) => {
        const hit = await c.match(req);
        if (hit) return hit;
        const res = await fetch(req);
        if (res.ok) c.put(req, res.clone());
        return res;
      }),
    );
    return;
  }

  // Fichiers de l'application : réseau d'abord (mises à jour immédiates), cache sinon.
  e.respondWith(
    fetch(req)
      .then((res) => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(VERSION).then((c) => c.put(req, copy));
        }
        return res;
      })
      .catch(() => caches.match(req).then((hit) => hit || caches.match("/index.html"))),
  );
});

self.addEventListener("push", (e) => {
  let d = {};
  try {
    d = e.data.json();
  } catch {
    d = { title: "MAQUIS PRO MANAGER", body: e.data?.text() || "" };
  }
  e.waitUntil(self.registration.showNotification(d.title || "MAQUIS PRO MANAGER", { body: d.body || "", tag: d.tag, icon: "/icon-192.png", badge: "/icon-192.png", data: { link: d.link || "#/notifications" } }));
});

self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  const link = e.notification.data?.link || "#/notifications";
  e.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((list) => {
      const c = list.find((x) => new URL(x.url).origin === location.origin);
      if (c) {
        c.postMessage({ type: "navigate", link });
        return c.focus();
      }
      return self.clients.openWindow(`/${link}`);
    }),
  );
});
