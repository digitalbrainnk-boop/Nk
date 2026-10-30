// Démarrage : connexion (si demandée), puis accueil (#/) ou studio d'un projet (#/p/<id>).
import { h, toast } from "./ui.js";
import { api, setUnauthorizedHandler } from "./api.js";
import { renderHome } from "./home.js";
import { Studio } from "./studio.js";

const root = document.getElementById("app");
let caps = null;
let studio = null;

async function login() {
  const pass = h("input", { type: "password", placeholder: "Mot de passe", autocomplete: "current-password" });
  const err = h("p", { class: "hint warn" });
  const form = h(
    "form",
    {
      class: "card login",
      onsubmit: async (e) => {
        e.preventDefault();
        try {
          await api("/api/login", { method: "POST", json: { password: pass.value } });
          start();
        } catch (x) {
          err.textContent = x.message;
        }
      },
    },
    h("h1", {}, "🎤 Lyric Studio"),
    pass,
    err,
    h("button", { class: "btn primary big", type: "submit" }, "Entrer"),
  );
  root.replaceChildren(h("div", { class: "login-wrap" }, form));
  pass.focus();
}

async function route() {
  if (studio) {
    studio.unmount();
    studio = null;
  }
  const m = location.hash.match(/^#\/p\/([\w-]+)/);
  if (!m) return renderHome(root, caps);
  root.replaceChildren(h("div", { class: "loading full" }, h("div", { class: "spinner" }), h("p", {}, "Ouverture du projet…")));
  try {
    const project = await api(`/api/projects/${m[1]}`);
    studio = new Studio(root, project, caps);
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
  try {
    const session = await api("/api/session");
    if (session.required && !session.ok) return login();
    caps = await api("/api/capabilities");
  } catch (e) {
    root.replaceChildren(
      h("div", { class: "login-wrap" }, h("div", { class: "card" }, h("h1", {}, "🎤 Lyric Studio"), h("p", {}, e.message))),
    );
    return;
  }
  setUnauthorizedHandler(() => login());
  window.addEventListener("hashchange", route);
  route();
}

start();
