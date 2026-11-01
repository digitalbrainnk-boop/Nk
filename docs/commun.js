/*
 * Petits outils d'interface partagés par le questionnaire, la page
 * « Mes documents » et la page de lecture d'un document.
 */
(function () {
  "use strict";

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
      ["questionnaire", "Questionnaire", `${racine}index.html#accueil`],
      ["reponses", "Réponses reçues", `${racine}index.html#chercheur`],
      ["documents", "Mes documents", `${racine}documents.html`],
    ];
    return h(
      "nav",
      { class: "onglets", "aria-label": "Espace chercheur" },
      liens.map(([cle, texte, href]) => h("a", { href, text: texte, "aria-current": cle === actif ? "page" : null })),
    );
  }

  window.Commun = { h, icone, lire, ecrire, oublier, notifier, telecharger, copier, taille, navChercheur };
})();
