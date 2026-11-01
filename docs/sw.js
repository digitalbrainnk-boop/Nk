/*
 * Pages gardées sur le téléphone : le site s'ouvre même quand la connexion coupe.
 * Toujours la dernière version quand il y a internet ; sinon (ou si le réseau
 * met trop de temps à répondre), la copie gardée sur le téléphone.
 * Changer VERSION à chaque modification de la liste COQUILLE.
 */
const VERSION = "2026-11-01-site";
const CACHE = `enquete-${VERSION}`;
const COQUILLE = [
  "./",
  "index.html",
  "documents.html",
  "style.css",
  "commun.js",
  "questionnaire.js",
  "outils.js",
  "app.js",
  "documents.js",
  "lecteur.js",
  "icones/icone-192.png",
  "icones/icone-512.png",
];
const DELAI_RESEAU = 5000;
const HORS_LIGNE = `<!doctype html><html lang="fr"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Pas de connexion</title><body style="font-family:system-ui,sans-serif;padding:2rem;max-width:30rem;margin:auto;color:#1b2033">
<h1 style="color:#1e2a5e">Pas de connexion internet</h1><p>Cette page n'a pas encore été ouverte sur ce téléphone. Reconnectez-vous puis réessayez.</p></body></html>`;

self.addEventListener("install", (e) => {
  e.waitUntil(
    caches
      .open(CACHE)
      .then((c) => c.addAll(COQUILLE))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches
      .keys()
      .then((cles) => Promise.all(cles.filter((c) => c.startsWith("enquete-") && c !== CACHE).map((c) => caches.delete(c))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET" || req.headers.has("range")) return;
  if (new URL(req.url).origin !== self.location.origin) return;

  const reseau = fetch(req).then((rep) => {
    if (rep.status === 200 && rep.type === "basic") {
      const copie = rep.clone();
      e.waitUntil(caches.open(CACHE).then((c) => c.put(req, copie)));
    }
    return rep;
  });
  const secours = () =>
    caches
      .match(req, { ignoreSearch: true })
      .then(
        (r) =>
          r ||
          (req.mode === "navigate"
            ? new Response(HORS_LIGNE, { headers: { "Content-Type": "text/html; charset=utf-8" } })
            : Response.error()),
      );

  e.respondWith(
    new Promise((resoudre) => {
      let fini = false;
      const minuteur = setTimeout(async () => {
        const copie = await caches.match(req, { ignoreSearch: true });
        if (copie && !fini) {
          fini = true;
          resoudre(copie);
        }
      }, DELAI_RESEAU);
      reseau
        .then((rep) => {
          clearTimeout(minuteur);
          if (!fini) {
            fini = true;
            resoudre(rep);
          }
        })
        .catch(async () => {
          clearTimeout(minuteur);
          if (!fini) {
            fini = true;
            resoudre(await secours());
          }
        });
    }),
  );
});
