// Installation de l'application sur le téléphone (Android : vraie application ; iPhone : écran d'accueil).
import { h, modal } from "./ui.js";
import { appName } from "./session.js";

let deferred = null;
const buttons = new Set();
const standalone = () => matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;

window.addEventListener("beforeinstallprompt", (e) => {
  e.preventDefault();
  deferred = e;
  for (const b of buttons) b.hidden = false;
});
window.addEventListener("appinstalled", () => {
  deferred = null;
  for (const b of buttons) b.hidden = true;
});

// Version de démonstration (page intégrée) : pas d'installation possible.
const demo = () => !!window.AFRICA_LYRICS_DEMO;

export function registerServiceWorker() {
  if (!demo() && "serviceWorker" in navigator) navigator.serviceWorker.register("/sw.js").catch(() => {});
}

function explain() {
  const ios = /iphone|ipad|ipod/i.test(navigator.userAgent);
  modal({
    title: `Installer ${appName()}`,
    body: h(
      "div",
      {},
      ios
        ? h(
            "ol",
            {},
            h("li", {}, "Ouvre ce site dans Safari."),
            h("li", {}, "Touche le bouton Partager (carré avec une flèche)."),
            h("li", {}, "Choisis « Sur l'écran d'accueil »."),
          )
        : h(
            "ol",
            {},
            h("li", {}, "Ouvre ce site dans Chrome."),
            h("li", {}, "Touche le menu ⋮ en haut à droite."),
            h("li", {}, "Choisis « Installer l'application » (ou « Ajouter à l'écran d'accueil »)."),
          ),
      h("p", { class: "hint" }, "L'application s'ouvre ensuite en plein écran, comme une application du Play Store."),
    ),
    actions: [{ label: "OK", primary: true, onClick: (c) => c() }],
  });
}

/** Bouton « Installer l'application » (caché si l'application est déjà installée). */
export function installButton(size = "") {
  const b = h(
    "button",
    {
      class: `btn install-btn ${size}`,
      onclick: async () => {
        if (!deferred) return explain();
        deferred.prompt();
        await deferred.userChoice.catch(() => null);
        deferred = null;
      },
    },
    "📲 Installer l'application",
  );
  // Sur ordinateur sans invitation du navigateur, le bouton n'apparaît pas ; sur téléphone on explique.
  const mobile = /android|iphone|ipad|ipod/i.test(navigator.userAgent);
  b.hidden = demo() || standalone() || (!deferred && !mobile);
  buttons.add(b);
  return b;
}
