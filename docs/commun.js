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
      h("button", {
        class: "lien-bouton verrouiller",
        type: "button",
        text: "Verrouiller",
        onclick: () => {
          coffre.fermer();
          location.href = `${racine}index.html#espace`;
          if (/index\.html$|\/$/.test(location.pathname)) location.reload();
        },
      }),
    );
  }

  // Pages gardées sur le téléphone pour les connexions lentes ou coupées.
  if (!ARTEFACT && "serviceWorker" in navigator && /^https?:$/.test(location.protocol)) {
    window.addEventListener("load", () => navigator.serviceWorker.register(new URL("sw.js", ICI)).catch(() => {}));
  }

  // ---------------------------------------------------------------------------
  // Coffre du chercheur : un code secret protège l'espace chercheur, et les
  // données gardées sur l'appareil (réponses rassemblées, clé GitHub) sont
  // chiffrées avec ce code (AES-GCM, clé tirée du code par PBKDF2).
  // ---------------------------------------------------------------------------
  const PREFIXE_COFFRE = "coffre:";
  const CLE_SESSION = "coffre:session";
  const ITERATIONS = 250000;
  const LONGUEUR_CODE = 6;
  let cleCoffre = null;

  function versB64(octets) {
    let binaire = "";
    for (let i = 0; i < octets.length; i += 0x8000) binaire += String.fromCharCode.apply(null, octets.subarray(i, i + 0x8000));
    return btoa(binaire);
  }
  function depuisB64(texte) {
    const binaire = atob(texte);
    const octets = new Uint8Array(binaire.length);
    for (let i = 0; i < binaire.length; i++) octets[i] = binaire.charCodeAt(i);
    return octets;
  }
  async function deriver(code, sel) {
    const base = await crypto.subtle.importKey("raw", new TextEncoder().encode(code), "PBKDF2", false, ["deriveKey"]);
    return crypto.subtle.deriveKey(
      { name: "PBKDF2", salt: sel, iterations: ITERATIONS, hash: "SHA-256" },
      base,
      { name: "AES-GCM", length: 256 },
      true,
      ["encrypt", "decrypt"],
    );
  }
  async function chiffrer(cle, valeur) {
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const donnees = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, cle, new TextEncoder().encode(JSON.stringify(valeur)));
    return { iv: versB64(iv), d: versB64(new Uint8Array(donnees)) };
  }
  async function dechiffrer(cle, boite) {
    const clair = await crypto.subtle.decrypt({ name: "AES-GCM", iv: depuisB64(boite.iv) }, cle, depuisB64(boite.d));
    return JSON.parse(new TextDecoder().decode(clair));
  }
  async function memoriser(cle) {
    cleCoffre = cle;
    try {
      // Le temps de l'onglet seulement : refermer l'onglet reverrouille l'espace.
      sessionStorage.setItem(CLE_SESSION, versB64(new Uint8Array(await crypto.subtle.exportKey("raw", cle))));
    } catch {
      /* sans stockage de session : le code sera redemandé à chaque page */
    }
  }

  const coffre = {
    disponible: () => !!(window.crypto && crypto.subtle),
    configure: () => !!lire(`${PREFIXE_COFFRE}sel`, null),
    ouvert: () => !!cleCoffre,
    async reprendre() {
      if (cleCoffre) return true;
      try {
        const brut = sessionStorage.getItem(CLE_SESSION);
        if (!brut || !coffre.configure()) return false;
        cleCoffre = await crypto.subtle.importKey("raw", depuisB64(brut), "AES-GCM", true, ["encrypt", "decrypt"]);
        await dechiffrer(cleCoffre, lire(`${PREFIXE_COFFRE}verif`, null));
        return true;
      } catch {
        cleCoffre = null;
        return false;
      }
    },
    async creer(code) {
      const sel = crypto.getRandomValues(new Uint8Array(16));
      const cle = await deriver(code, sel);
      ecrire(`${PREFIXE_COFFRE}sel`, versB64(sel));
      ecrire(`${PREFIXE_COFFRE}verif`, await chiffrer(cle, "ok"));
      await memoriser(cle);
    },
    async ouvrir(code) {
      const sel = lire(`${PREFIXE_COFFRE}sel`, null);
      if (!sel) return false;
      try {
        const cle = await deriver(code, depuisB64(sel));
        if ((await dechiffrer(cle, lire(`${PREFIXE_COFFRE}verif`, null))) !== "ok") return false;
        await memoriser(cle);
        return true;
      } catch {
        return false;
      }
    },
    fermer() {
      cleCoffre = null;
      try {
        sessionStorage.removeItem(CLE_SESSION);
      } catch {
        /* rien à faire */
      }
    },
    async lire(nom, defaut) {
      const boite = lire(`${PREFIXE_COFFRE}d:${nom}`, null);
      if (!boite || !cleCoffre) return defaut;
      try {
        return await dechiffrer(cleCoffre, boite);
      } catch {
        return defaut;
      }
    },
    async ecrire(nom, valeur) {
      if (!cleCoffre) throw new Error("coffre fermé");
      return ecrire(`${PREFIXE_COFFRE}d:${nom}`, await chiffrer(cleCoffre, valeur));
    },
    supprimer(nom) {
      oublier(`${PREFIXE_COFFRE}d:${nom}`);
    },
    // Range dans le coffre une donnée gardée en clair par une version précédente.
    async migrer(cleClaire, nom) {
      const valeur = lire(cleClaire, null);
      if (valeur === null || !cleCoffre) return;
      await coffre.ecrire(nom, valeur);
      oublier(cleClaire);
    },
    reinitialiser() {
      coffre.fermer();
      try {
        Object.keys(localStorage)
          .filter((k) => k.startsWith(PREFIXE_COFFRE))
          .forEach((k) => localStorage.removeItem(k));
      } catch {
        /* rien à faire */
      }
    },
  };

  // Formulaire du code : création la première fois, puis saisie.
  function formulaireCode(apresOuverture, { titre } = {}) {
    const creation = !coffre.configure();
    const champ = h("input", { type: "password", id: "code-secret", autocomplete: creation ? "new-password" : "current-password", minlength: LONGUEUR_CODE, required: true });
    const confirmation = creation ? h("input", { type: "password", id: "code-confirmation", autocomplete: "new-password", required: true }) : null;
    const etat = h("p", { class: "etiquette-refus", role: "alert" });
    const bouton = h("button", { class: "bouton", type: "submit", text: creation ? "Créer mon code" : "Ouvrir" });
    let echecs = 0;
    const formulaire = h(
      "form",
      { class: "bloc coffre", autocomplete: "off" },
      h("h2", { text: titre || (creation ? "Protéger l'espace chercheur" : "Espace chercheur protégé") }),
      h("p", {
        class: "discret",
        text: creation
          ? `Choisissez un code secret d'au moins ${LONGUEUR_CODE} chiffres ou lettres. Il sera demandé pour ouvrir l'espace chercheur, et les réponses rassemblées sur ce téléphone seront chiffrées avec lui. Notez-le bien.`
          : "Entrez votre code secret.",
      }),
      h("label", { for: "code-secret", class: "discret", text: creation ? "Nouveau code" : "Code secret" }),
      champ,
      creation ? [h("label", { for: "code-confirmation", class: "discret", text: "Retapez le code" }), confirmation] : null,
      etat,
      h("div", { class: "actions" }, bouton),
      creation
        ? null
        : h("button", {
            class: "lien-bouton",
            type: "button",
            text: "Code oublié ?",
            onclick: async () => {
              const ok = await confirmer(
                "Sans le code, les réponses rassemblées et la clé GitHub gardées sur ce téléphone seront effacées. Vous pourrez rajouter les réponses en recollant les messages WhatsApp. Continuer ?",
                { oui: "Effacer et choisir un nouveau code", danger: true },
              );
              if (!ok) return;
              coffre.reinitialiser();
              formulaire.replaceWith(formulaireCode(apresOuverture, { titre }));
            },
          }),
    );
    formulaire.addEventListener("submit", async (e) => {
      e.preventDefault();
      const code = champ.value;
      etat.textContent = "";
      if (!coffre.disponible()) {
        etat.textContent = "Ce navigateur est trop ancien pour protéger les données. Utilisez Chrome, Safari ou Firefox à jour.";
        return;
      }
      if (creation) {
        if (code.length < LONGUEUR_CODE) return (etat.textContent = `Le code doit avoir au moins ${LONGUEUR_CODE} caractères.`);
        if (code !== confirmation.value) return (etat.textContent = "Les deux codes ne sont pas identiques.");
        bouton.disabled = true;
        await coffre.creer(code);
        return apresOuverture();
      }
      bouton.disabled = true;
      bouton.textContent = "Vérification…";
      const ok = await coffre.ouvrir(code);
      if (ok) return apresOuverture();
      echecs++;
      champ.value = "";
      const attente = echecs >= 5 ? 30 : 0;
      etat.textContent = attente ? `Code incorrect. Patientez ${attente} secondes.` : "Code incorrect.";
      setTimeout(() => {
        bouton.disabled = false;
        bouton.textContent = "Ouvrir";
        champ.focus();
      }, attente * 1000);
    });
    setTimeout(() => champ.focus(), 50);
    return formulaire;
  }

  // Ouvre le coffre dans une fenêtre par-dessus la page (pour une action ponctuelle).
  async function deverrouiller() {
    if (await coffre.reprendre()) return true;
    return new Promise((resoudre) => {
      const fond = h("div", { class: "fenetre-fond" });
      const fermer = (valeur) => {
        fond.remove();
        resoudre(valeur);
      };
      const boite = h("div", { class: "fenetre", role: "dialog", "aria-modal": "true" }, formulaireCode(() => fermer(true)));
      boite.append(h("div", { class: "actions" }, h("button", { class: "bouton petit secondaire", type: "button", text: "Annuler", onclick: () => fermer(false) })));
      fond.append(boite);
      document.body.append(fond);
    });
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
    coffre,
    formulaireCode,
    deverrouiller,
  };
})();
