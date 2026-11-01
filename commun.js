/*
 * Petits outils d'interface partagés par le questionnaire, la page
 * « Mes documents » et la page de lecture d'un document.
 */
(function () {
  "use strict";

  const ICI = document.currentScript ? document.currentScript.src : location.href;
  // Publiée sur claude.ai, la page tourne dans un cadre qui fournit window.claude.
  const ARTEFACT = !!(window.claude && typeof window.claude.use === "function");

  function h(balise, attributs, ...enfants) {
    const el = document.createElement(balise);
    for (const [cle, valeur] of Object.entries(attributs || {})) {
      if (valeur === null || valeur === undefined || valeur === false) continue;
      if (cle === "class") el.className = valeur;
      else if (cle === "text") el.textContent = valeur;
      else if (cle.startsWith("on")) el.addEventListener(cle.slice(2), valeur);
      else if (valeur === true) el.setAttribute(cle, "");
      else el.setAttribute(cle, valeur);
    }
    for (const enfant of enfants.flat(Infinity)) {
      if (enfant === null || enfant === undefined || enfant === false) continue;
      el.append(enfant instanceof Node ? enfant : document.createTextNode(String(enfant)));
    }
    return el;
  }

  const TRACES = {
    message:
      '<path d="M4 5h16v11H8l-4 4z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/><path d="M8 9.5h8M8 12.5h5" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>',
    document:
      '<path d="M6 3h8l4 4v14H6z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/><path d="M14 3v4h4M9 12h6M9 16h6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>',
    lien: '<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>',
    telecharger:
      '<path d="M12 4v11M7 10l5 5 5-5M5 20h14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>',
    partager:
      '<circle cx="18" cy="5" r="2.5" fill="none" stroke="currentColor" stroke-width="2"/><circle cx="6" cy="12" r="2.5" fill="none" stroke="currentColor" stroke-width="2"/><circle cx="18" cy="19" r="2.5" fill="none" stroke="currentColor" stroke-width="2"/><path d="M8.2 10.8l7.6-4.4M8.2 13.2l7.6 4.4" stroke="currentColor" stroke-width="2"/>',
    ajouter:
      '<path d="M12 16V4M7 9l5-5 5 5M5 20h14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>',
  };

  function icone(nom) {
    const span = document.createElement("span");
    span.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true">${TRACES[nom] || ""}</svg>`;
    return span.firstChild;
  }

  function lire(cle, defaut) {
    try {
      const v = localStorage.getItem(cle);
      return v ? JSON.parse(v) : defaut;
    } catch {
      return defaut;
    }
  }
  function ecrire(cle, valeur) {
    try {
      localStorage.setItem(cle, JSON.stringify(valeur));
      return true;
    } catch {
      return false;
    }
  }
  function oublier(cle) {
    try {
      localStorage.removeItem(cle);
    } catch {
      /* rien à faire */
    }
  }

  let minuteur;
  function notifier(message, duree = 4500) {
    let boite = document.getElementById("notification");
    if (!boite) {
      boite = h("div", { class: "notification", id: "notification", role: "status", hidden: true });
      document.body.append(boite);
    }
    boite.textContent = message;
    boite.hidden = false;
    clearTimeout(minuteur);
    minuteur = setTimeout(() => (boite.hidden = true), duree);
  }

  function telecharger(blob, nom) {
    const url = URL.createObjectURL(blob);
    const a = h("a", { href: url, download: nom });
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  }

  // Enregistrer un fichier : lien de téléchargement sur un site normal,
  // capacité « downloads » sur claude.ai (absente : le bouton reste caché).
  const capaciteTelechargement = ARTEFACT
    ? window.claude.use("downloads").catch(() => null)
    : Promise.resolve("navigateur");

  async function telechargementPossible() {
    return !!(await capaciteTelechargement);
  }

  function siTelechargement(el) {
    el.hidden = true;
    telechargementPossible().then((ok) => (el.hidden = !ok));
    return el;
  }

  async function enregistrerFichier(blob, nom) {
    const capacite = await capaciteTelechargement;
    if (capacite === "navigateur") {
      telecharger(blob, nom);
      return true;
    }
    if (!capacite) {
      notifier("Le téléchargement n'est pas possible ici.");
      return false;
    }
    try {
      await capacite.save({ filename: nom, data: blob });
      return true;
    } catch (e) {
      if (!e || e.code !== "declined") notifier("Le fichier n'a pas pu être enregistré.");
      return false;
    }
  }

  // Fenêtre de confirmation (remplace confirm(), qui ne s'affiche pas partout).
  function confirmer(message, { oui = "Confirmer", non = "Annuler", danger = false } = {}) {
    return new Promise((resoudre) => {
      const precedent = document.activeElement;
      const fond = h("div", { class: "fenetre-fond" });
      const fermer = (valeur) => {
        document.removeEventListener("keydown", touche);
        fond.remove();
        if (precedent && precedent.focus) precedent.focus();
        resoudre(valeur);
      };
      const touche = (e) => e.key === "Escape" && fermer(false);
      const boutonOui = h("button", { class: `bouton petit${danger ? " danger" : ""}`, type: "button", text: oui, onclick: () => fermer(true) });
      fond.append(
        h(
          "div",
          { class: "fenetre", role: "alertdialog", "aria-modal": "true", "aria-labelledby": "fenetre-message" },
          h("p", { id: "fenetre-message", text: message }),
          h("div", { class: "actions" }, h("button", { class: "bouton petit secondaire", type: "button", text: non, onclick: () => fermer(false) }), boutonOui),
        ),
      );
      fond.addEventListener("click", (e) => e.target === fond && fermer(false));
      document.addEventListener("keydown", touche);
      document.body.append(fond);
      boutonOui.focus();
    });
  }

  async function copier(texte, champ) {
    try {
      await navigator.clipboard.writeText(texte);
      return true;
    } catch {
      const zone = champ || h("textarea", { style: "position:fixed;opacity:0" }, texte);
      if (!champ) document.body.append(zone);
      zone.select();
      let ok = false;
      try {
        ok = document.execCommand("copy");
      } catch {
        ok = false;
      }
      if (!champ) zone.remove();
      return ok;
    }
  }

  function taille(octets) {
    if (!Number.isFinite(octets)) return "";
    if (octets < 1024) return `${octets} o`;
    if (octets < 1024 * 1024) return `${Math.round(octets / 1024)} Ko`;
    return `${(octets / 1024 / 1024).toLocaleString("fr-FR", { maximumFractionDigits: 1 })} Mo`;
  }

  // Barre de navigation des pages du chercheur.
  function navChercheur(actif, racine = "") {
    const liens = [
      ["accueil", "Accueil", `${racine}index.html#espace`],
      ["reponses", "Réponses reçues", `${racine}index.html#chercheur`],
      ["documents", "Mes documents", `${racine}documents.html`],
    ].filter(([cle]) => !(ARTEFACT && cle === "documents"));
    return h(
      "nav",
      { class: "onglets", "aria-label": "Espace chercheur" },
      liens.map(([cle, texte, href]) => h("a", { href, text: texte, "aria-current": cle === actif ? "page" : null })),
    );
  }

  // Pages gardées sur le téléphone pour les connexions lentes ou coupées.
  if (!ARTEFACT && "serviceWorker" in navigator && /^https?:$/.test(location.protocol)) {
    window.addEventListener("load", () => navigator.serviceWorker.register(new URL("sw.js", ICI)).catch(() => {}));
  }

  window.Commun = {
    ARTEFACT,
    h,
    icone,
    lire,
    ecrire,
    oublier,
    notifier,
    telecharger,
    enregistrerFichier,
    siTelechargement,
    confirmer,
    copier,
    taille,
    navChercheur,
  };
})();
