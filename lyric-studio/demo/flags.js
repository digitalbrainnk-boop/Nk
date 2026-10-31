// Version de démonstration : réglages lus par l'application avant son démarrage, et bandeau « Démo »
// avec deux boutons pour entrer directement comme administrateur ou comme client.
import ICON from "../public/icon.svg";
import { api, DEMO_ACCOUNTS, DEMO_PASSWORD } from "./backend.js";
import { loadMe } from "../public/js/session.js";

window.AFRICA_LYRICS_DEMO = true;
window.AFRICA_LYRICS_ICON = `data:image/svg+xml;utf8,${encodeURIComponent(ICON)}`;

async function enter(kind) {
  await api("/api/auth/logout", { method: "POST" });
  await api("/api/auth/login", { method: "POST", json: DEMO_ACCOUNTS[kind] });
  await loadMe();
  location.hash = "#accueil";
  window.dispatchEvent(new HashChangeEvent("hashchange"));
}

const bar = document.createElement("div");
bar.id = "demo-bar";
bar.innerHTML = `
  <span class="demo-tag">DÉMO</span>
  <span class="demo-text">Rien n'est enregistré · mot de passe des comptes : <b>${DEMO_PASSWORD}</b></span>
  <span class="demo-actions">
    <button type="button" data-kind="admin">👑 Entrer en admin</button>
    <button type="button" data-kind="client">🎤 Entrer en cliente</button>
  </span>`;
bar.addEventListener("click", (e) => {
  const kind = e.target.closest("button")?.dataset.kind;
  if (kind) enter(kind).catch((err) => console.error(err));
});
document.body.prepend(bar);
// Le studio occupe toute la hauteur : on retire celle du bandeau (qui peut passer sur deux lignes).
new ResizeObserver(() => document.documentElement.style.setProperty("--demo-bar", `${bar.offsetHeight}px`)).observe(bar);
