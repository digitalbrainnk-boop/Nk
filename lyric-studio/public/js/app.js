// Démarrage et navigation (adresses simples, sans barre oblique) :
//   visiteur : #accueil (présentation), #fonctions, #tarifs, #connexion, #inscription, #cgu, #confidentialite
//   client   : #accueil (mes vidéos), #p-<id> (studio), #compte ; administrateur : #admin
// Les anciennes adresses (#/compte, #/p/<id>) marchent toujours.
import { h, toast, safeStorage } from "./ui.js";
import { api, setUnauthorizedHandler } from "./api.js";
import { session, loadConfig, loadMe, isAdmin, iconUrl } from "./session.js";
import { renderHome } from "./home.js";
import { Studio } from "./studio.js";
import { renderLanding, renderPricing, renderLogin, renderSignup, renderLegal } from "./landing.js";
import { renderAccount } from "./account.js";
import { renderAdmin } from "./admin.js";
import { installButton, registerServiceWorker } from "./install.js";

const root = document.getElementById("app");
let studio = null;

/** Page demandée : "" (accueil), "compte", "p-<id>"… */
export function currentPage() {
  const p = location.hash
    .replace(/^#\/?/, "")
    .split("?")[0]
    .replace(/^p\/([\w-]+).*/, "p-$1")
    .replace(/\/$/, "");
  return p === "accueil" ? "" : p;
}

/** Barre du haut des pages du client. */
export function appNav() {
  const me = session.me;
  const here = currentPage();
  const link = (page, label) => h("a", { href: `#${page || "accueil"}`, class: here === page ? "on" : "" }, label);
  return h(
    "header",
    { class: "app-nav" },
    h("a", { class: "brand", href: "#accueil" }, h("img", { src: iconUrl(), alt: "", width: 28, height: 28 }), session.config.app_name),
    h(
      "nav",
      {},
      link("", "Mes vidéos"),
      link("compte", "Mon compte"),
      isAdmin() && link("admin", "Administration"),
      h("span", { class: `badge plan-${me.plan.id}` }, me.plan.name),
      installButton("small"),
      h(
        "button",
        {
          class: "btn ghost small",
          onclick: async () => {
            await api("/api/auth/logout", { method: "POST" }).catch(() => {});
            session.me = null;
            location.hash = "#accueil";
            route();
          },
        },
        "Déconnexion",
      ),
    ),
  );
}

async function route() {
  if (studio) {
    studio.unmount();
    studio = null;
  }
  window.scrollTo(0, 0);
  const page = currentPage();
  if (page === "cgu" || page === "confidentialite") return renderLegal(root, page === "cgu" ? "cgu" : "privacy");
  if (page === "tarifs") return renderPricing(root);
  const afterAuth = () => (location.hash = safeStorage.get("after-login") || "#accueil");
  if (!session.me) {
    if (page === "connexion") return renderLogin(root, afterAuth);
    if (page === "inscription") return renderSignup(root, afterAuth);
    if (page === "fonctions") {
      renderLanding(root);
      return document.getElementById("fonctions")?.scrollIntoView();
    }
    if (page) {
      safeStorage.set("after-login", `#${page}`);
      location.hash = "#connexion";
      return;
    }
    return renderLanding(root);
  }
  safeStorage.remove("after-login");
  if (page === "connexion" || page === "inscription") return void (location.hash = "#accueil");
  if (page === "compte") return renderAccount(root, appNav);
  if (page === "admin") return isAdmin() ? renderAdmin(root, appNav) : void (location.hash = "#accueil");
  const m = page.match(/^p-([\w-]+)$/);
  if (!m) return renderHome(root, appNav);
  root.replaceChildren(h("div", { class: "loading full" }, h("div", { class: "spinner" }), h("p", {}, "Ouverture du projet…")));
  try {
    const project = await api(`/api/projects/${m[1]}`);
    studio = new Studio(root, project, session);
    await studio.mount();
  } catch (e) {
    console.error(e);
    toast(e.message, "error", 7000);
    if (studio) studio.unmount();
    studio = null;
    location.hash = "#accueil";
  }
}

async function start() {
  registerServiceWorker();
  try {
    await loadConfig();
    await loadMe();
  } catch (e) {
    root.replaceChildren(
      h(
        "div",
        { class: "auth-wrap" },
        h(
          "div",
          { class: "card auth" },
          h("h1", {}, "Connexion impossible"),
          h("p", {}, e.message),
          h("button", { class: "btn primary", onclick: () => location.reload() }, "Réessayer"),
        ),
      ),
    );
    return;
  }
  setUnauthorizedHandler(() => {
    if (!session.me) return;
    session.me = null;
    toast("Ta session a expiré : reconnecte-toi.", "info");
    location.hash = "#connexion";
  });
  window.addEventListener("hashchange", route);
  route();
}

start();
