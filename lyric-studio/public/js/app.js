// Démarrage et navigation :
//   visiteur : #/ (présentation), #/tarifs, #/connexion, #/inscription, #/cgu, #/confidentialite
//   client   : #/ (mes vidéos), #/p/<id> (studio), #/compte ; administrateur : #/admin
import { h, toast } from "./ui.js";
import { api, setUnauthorizedHandler } from "./api.js";
import { session, loadConfig, loadMe, isAdmin } from "./session.js";
import { renderHome } from "./home.js";
import { Studio } from "./studio.js";
import { renderLanding, renderPricing, renderLogin, renderSignup, renderLegal } from "./landing.js";
import { renderAccount } from "./account.js";
import { renderAdmin } from "./admin.js";
import { installButton, registerServiceWorker } from "./install.js";

const root = document.getElementById("app");
let studio = null;

/** Barre du haut des pages du client. */
export function appNav() {
  const me = session.me;
  const here = location.hash.split("?")[0] || "#/";
  const link = (href, label) => h("a", { href, class: here === href ? "on" : "" }, label);
  return h(
    "header",
    { class: "app-nav" },
    h("a", { class: "brand", href: "#/" }, h("img", { src: "/icon.svg", alt: "", width: 28, height: 28 }), session.config.app_name),
    h(
      "nav",
      {},
      link("#/", "Mes vidéos"),
      link("#/compte", "Mon compte"),
      isAdmin() && link("#/admin", "Administration"),
      h("span", { class: `badge plan-${me.plan.id}` }, me.plan.name),
      installButton("small"),
      h(
        "button",
        {
          class: "btn ghost small",
          onclick: async () => {
            await api("/api/auth/logout", { method: "POST" }).catch(() => {});
            session.me = null;
            location.hash = "#/";
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
  const hash = location.hash || "#/";
  const path = hash.replace(/^#/, "").split("?")[0].replace(/#.*$/, "") || "/";
  if (path === "/cgu" || path === "/confidentialite") return renderLegal(root, path === "/cgu" ? "cgu" : "privacy");
  if (path === "/tarifs") return renderPricing(root);
  const afterAuth = () => (location.hash = sessionStorage.getItem("after-login") || "#/");
  if (!session.me) {
    if (path === "/connexion") return renderLogin(root, afterAuth);
    if (path === "/inscription") return renderSignup(root, afterAuth);
    if (path !== "/") {
      try {
        sessionStorage.setItem("after-login", hash);
      } catch {}
      location.hash = "#/connexion";
      return;
    }
    return renderLanding(root);
  }
  try {
    sessionStorage.removeItem("after-login");
  } catch {}
  if (path === "/connexion" || path === "/inscription") return void (location.hash = "#/");
  if (path === "/compte") return renderAccount(root, appNav);
  if (path === "/admin") return isAdmin() ? renderAdmin(root, appNav) : void (location.hash = "#/");
  const m = path.match(/^\/p\/([\w-]+)/);
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
    location.hash = "#/";
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
    location.hash = "#/connexion";
  });
  window.addEventListener("hashchange", route);
  route();
}

start();
