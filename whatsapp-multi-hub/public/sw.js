// Service worker : met en cache l'interface pour un démarrage instantané (et hors ligne).
// Les données (API, Socket.io) ne sont JAMAIS mises en cache : elles restent privées
// et toujours à jour. Change VERSION à chaque mise à jour de l'interface.
const VERSION = "1.4.0";
const CACHE = `multi-lignes-${VERSION}`;
const SHELL = [
  "./",
  "./index.html",
  "./manifest.json",
  "./css/app.css",
  "./js/app.js",
  "./js/api.js",
  "./js/realtime.js",
  "./js/settings.js",
  "./js/lock.js",
  "./js/notifications.js",
  "./js/ui.js",
  "./js/views/lines.js",
  "./js/views/messages.js",
  "./vendor/socket.io.min.js",
  "./icons/icon.svg",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./icons/icon-maskable-512.png",
  "./icons/apple-touch-icon.png",
  "./icons/badge-96.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.addAll(SHELL))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith("multi-lignes-") && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (/\/(api|socket\.io|media)\//.test(url.pathname)) return; // réseau uniquement (données privées)

  // Pages : réseau d'abord (version à jour), sinon la copie en cache.
  if (request.mode === "navigate") {
    event.respondWith(fetch(request).catch(() => caches.match("./index.html")));
    return;
  }

  // Fichiers de l'interface : cache immédiat, mise à jour en arrière-plan.
  event.respondWith(
    caches.open(CACHE).then(async (cache) => {
      const cached = await cache.match(request);
      const network = fetch(request)
        .then((response) => {
          if (response.ok) cache.put(request, response.clone());
          return response;
        })
        .catch(() => cached);
      return cached || network;
    }),
  );
});

// --- Notifications (Web Push) ------------------------------------------------------

self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { body: event.data?.text() };
  }
  event.waitUntil(
    (async () => {
      // L'application est ouverte devant toi : elle affiche déjà le message.
      const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      if (data.tag !== "test" && windows.some((c) => c.visibilityState === "visible" && c.focused)) return;
      await self.registration.showNotification(data.title || "Multi-Lignes", {
        body: data.body || "Nouveau message",
        tag: data.tag || "multi-lignes",
        renotify: true,
        icon: "icons/icon-192.png",
        badge: "icons/badge-96.png",
        vibrate: [80, 40, 80],
        timestamp: Date.now(),
        data: { sessionId: data.sessionId, chatId: data.chatId },
      });
    })(),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const { sessionId, chatId } = event.notification.data || {};
  const target = new URL(sessionId ? `./#open=${encodeURIComponent(sessionId)}|${encodeURIComponent(chatId || "")}` : "./", self.registration.scope).href;
  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      const win = windows.find((c) => new URL(c.url).origin === self.location.origin);
      if (win) {
        await win.focus();
        if (sessionId) win.postMessage({ type: "open-chat", sessionId, chatId });
        return;
      }
      await self.clients.openWindow(target);
    })(),
  );
});
