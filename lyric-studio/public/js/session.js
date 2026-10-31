// État partagé : configuration publique du site, compte connecté, possibilités du serveur.
import { api } from "./api.js";
import { h, modal } from "./ui.js";

export const session = { config: null, me: null, caps: null };

export async function loadConfig() {
  session.config = await api("/api/public/config");
  document.title = session.config.app_name;
  return session.config;
}

/** Compte connecté (null si personne). */
export async function loadMe() {
  session.me = (await api("/api/session")).me;
  session.caps = session.me ? await api("/api/capabilities") : null;
  return session.me;
}

export const isAdmin = () => session.me?.user.role === "admin";
export const appName = () => session.config?.app_name || "Africa Lyrics";

/** Une limite de la formule est atteinte : on explique et on propose de passer à la formule supérieure. */
export function upgradePrompt(message) {
  modal({
    title: "Passe à la formule supérieure",
    body: h(
      "div",
      {},
      h("p", {}, message),
      h(
        "p",
        { class: "hint" },
        "Les formules payantes enlèvent le filigrane, débloquent la Full HD et la 4K, plus de projets et plus de minutes d'IA.",
      ),
    ),
    actions: [
      { label: "Plus tard", onClick: (c) => c() },
      { label: "Voir les formules", primary: true, onClick: (c) => (c(), (location.hash = "#/compte")) },
    ],
  });
}

/** Lien WhatsApp du support (numéro au format international). */
export function whatsappLink(text = "") {
  const n = String(session.config?.support_whatsapp || "").replace(/[^\d]/g, "");
  return n ? `https://wa.me/${n}${text ? `?text=${encodeURIComponent(text)}` : ""}` : null;
}

export function fmtDate(t) {
  return t ? new Date(t).toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" }) : "";
}
