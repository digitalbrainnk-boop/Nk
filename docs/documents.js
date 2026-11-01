/*
 * « Mes documents » : transformer un fichier (livre, PDF, Word…) en lien.
 *
 * Le fichier est rangé dans le dépôt GitHub (dossier docs/d/<nom>/), avec une
 * petite page de lecture. GitHub Pages le publie : le lien ouvre cette page et
 * la personne lit le document en entier sur son téléphone.
 */
(function () {
  "use strict";

  const { h, icone, lire, ecrire, oublier, notifier, copier, taille, navChercheur } = window.Commun;
  const R = window.ENQUETE.reglages;
  const D = R.depot;
  const API = "https://api.github.com";
  const DEPOT = `/repos/${D.proprietaire}/${D.nom}`;
  const CLE_JETON = "documents:jeton";
  const TAILLE_MAX = 50 * 1024 * 1024;
  const INTERDITS = ["html", "htm", "xhtml", "shtml", "js", "mjs", "svg", "xml", "php"];
  const app = document.getElementById("app");

  const montrer = (...elements) => app.replaceChildren(...elements.filter((x) => x !== null && x !== undefined && x !== false));

  let jeton = lire(CLE_JETON, "");
  let documents = [];
  let aEnvoyer = [];
  let resultats = [];

  // ---------------------------------------------------------------------------
  // Adresses
  // ---------------------------------------------------------------------------
  function adresseSite() {
    let encadre = false;
    try {
      encadre = window.top !== window.self;
    } catch {
      encadre = true;
    }
    if (/^https?:$/.test(location.protocol) && !encadre) return new URL("./", location.href).href;
    return R.lienDuSite;
  }
  const lienDocument = (doc) => `${adresseSite()}d/${doc.id}/`;
  const lienWhatsapp = (doc) =>
    `https://wa.me/?text=${encodeURIComponent(`${doc.titre}\nCliquez sur le lien pour lire le document :\n${lienDocument(doc)}`)}`;

  // ---------------------------------------------------------------------------
  // GitHub
  // ---------------------------------------------------------------------------
  class ErreurGithub extends Error {
    constructor(statut, message) {
      super(message);
      this.statut = statut;
    }
  }

  async function api(chemin, { methode = "GET", corps } = {}) {
    const entetes = { Accept: "application/vnd.github+json", Authorization: `Bearer ${jeton}` };
    if (corps) entetes["Content-Type"] = "application/json";
    const reponse = await fetch(API + chemin, {
      method: methode,
      headers: entetes,
      body: corps ? JSON.stringify(corps) : undefined,
      cache: "no-store",
    });
    if (!reponse.ok) {
      const details = await reponse.json().catch(() => ({}));
      throw new ErreurGithub(reponse.status, details.message || reponse.statusText);
    }
    return reponse.status === 204 ? null : reponse.json();
  }

  // Envoi d'un fichier avec suivi de la progression (XMLHttpRequest le permet, fetch non).
  function envoyerFichier(base64, progression) {
    return new Promise((ok, echec) => {
      const xhr = new XMLHttpRequest();
      xhr.open("POST", `${API}${DEPOT}/git/blobs`);
      xhr.setRequestHeader("Accept", "application/vnd.github+json");
      xhr.setRequestHeader("Authorization", `Bearer ${jeton}`);
      xhr.setRequestHeader("Content-Type", "application/json");
      xhr.upload.onprogress = (e) => e.lengthComputable && progression(e.loaded / e.total);
      xhr.onload = () => {
        let donnees = {};
        try {
          donnees = JSON.parse(xhr.responseText);
        } catch {
          /* réponse vide */
        }
        if (xhr.status >= 200 && xhr.status < 300) ok(donnees.sha);
        else echec(new ErreurGithub(xhr.status, donnees.message || "envoi refusé"));
      };
      xhr.onerror = () => echec(new ErreurGithub(0, "connexion internet interrompue"));
      xhr.send(JSON.stringify({ content: base64, encoding: "base64" }));
    });
  }

  function lireEnBase64(fichier) {
    return new Promise((ok, echec) => {
      const lecteur = new FileReader();
      lecteur.onload = () => ok(String(lecteur.result).split(",")[1] || "");
      lecteur.onerror = () => echec(lecteur.error);
      lecteur.readAsDataURL(fichier);
    });
  }

  function base64VersTexte(b64) {
    const binaire = atob(b64.replace(/\s/g, ""));
    const octets = Uint8Array.from(binaire, (c) => c.charCodeAt(0));
    return new TextDecoder().decode(octets);
  }

  const cheminListe = `${D.dossier}/d/liste.json`;

  async function lireListe(ref) {
    try {
      const f = await api(`${DEPOT}/contents/${cheminListe}?ref=${encodeURIComponent(ref)}`);
      const liste = JSON.parse(base64VersTexte(f.content));
      return Array.isArray(liste) ? liste : [];
    } catch (e) {
      if (e.statut === 404) return [];
      throw e;
    }
  }

  // Un seul enregistrement (commit) pour tous les changements.
  async function enregistrer(message, changer) {
    for (let essai = 0; ; essai++) {
      const ref = await api(`${DEPOT}/git/ref/heads/${D.branche}`);
      const base = ref.object.sha;
      const commit = await api(`${DEPOT}/git/commits/${base}`);
      const liste = await lireListe(base);
      const { entrees, nouvelleListe } = changer(liste);
      entrees.push({ path: cheminListe, mode: "100644", type: "blob", content: `${JSON.stringify(nouvelleListe, null, 1)}\n` });
      const arbre = await api(`${DEPOT}/git/trees`, { methode: "POST", corps: { base_tree: commit.tree.sha, tree: entrees } });
      const nouveau = await api(`${DEPOT}/git/commits`, { methode: "POST", corps: { message, tree: arbre.sha, parents: [base] } });
      try {
        await api(`${DEPOT}/git/refs/heads/${D.branche}`, { methode: "PATCH", corps: { sha: nouveau.sha } });
        return nouvelleListe;
      } catch (e) {
        if (e.statut !== 422 || essai >= 2) throw e;
      }
    }
  }

  function expliquer(e) {
    if (e.statut === 401) return "GitHub refuse la clé : elle est fausse ou a expiré. Reconnectez-vous avec une nouvelle clé.";
    if (e.statut === 403) return "La clé n'a pas le droit d'écrire. Dans GitHub, donnez-lui la permission « Contents : Read and write ».";
    if (e.statut === 404) return `La clé n'a pas accès au dépôt ${D.nom} ou à la branche ${D.branche}.`;
    if (e.statut === 413 || e.statut === 422) return `GitHub a refusé le fichier (${e.message}). Essayez avec un fichier plus léger.`;
    if (e.statut === 0) return "La connexion internet a été interrompue. Réessayez.";
    return `Erreur GitHub : ${e.message}`;
  }

  // ---------------------------------------------------------------------------
  // Fabrication d'un document
  // ---------------------------------------------------------------------------
  function simplifier(texte, longueur = 50) {
    const s = String(texte)
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, longueur)
      .replace(/-+$/g, "");
    return s || "document";
  }
  function suffixe() {
    const lettres = "abcdefghjkmnpqrstuvwxyz23456789";
    const octets = crypto.getRandomValues(new Uint8Array(4));
    return Array.from(octets, (o) => lettres[o % lettres.length]).join("");
  }
  const extension = (nom) => (nom.includes(".") ? nom.split(".").pop().toLowerCase() : "");
  const sansExtension = (nom) => nom.replace(/\.[^.]+$/, "");

  function echapper(texte) {
    return String(texte).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  }

  const ICONE_SITE =
    "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 64 64'%3E%3Crect width='64' height='64' rx='14' fill='%231e2a5e'/%3E%3Cpath d='M16 18h13a4 4 0 0 1 4 4v26a3 3 0 0 0-3-3H16zM48 18H35a4 4 0 0 0-4 4v26a3 3 0 0 1 3-3h14z' fill='none' stroke='%23e9b44c' stroke-width='4' stroke-linejoin='round'/%3E%3C/svg%3E";

  function pageDeLecture(doc) {
    const titre = echapper(doc.titre);
    const description = echapper(`Document à lire en ligne · ${taille(doc.taille)}`);
    const donnees = JSON.stringify(doc).replace(/</g, "\\u003c");
    return `<!doctype html>
<html lang="fr">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
    <title>${titre}</title>
    <meta name="description" content="${description}" />
    <meta property="og:title" content="${titre}" />
    <meta property="og:description" content="${description}" />
    <meta property="og:type" content="article" />
    <meta name="theme-color" content="#1e2a5e" />
    <link rel="icon" href="${ICONE_SITE}" />
    <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Source+Serif+4:opsz,wght@8..60,600;8..60,700&display=swap" />
    <link rel="stylesheet" href="../../style.css" />
  </head>
  <body>
    <main id="lecteur" class="page lecteur">
      <noscript><p class="carte"><a href="${echapper(encodeURIComponent(doc.fichier))}">Télécharger le document</a></p></noscript>
    </main>
    <script>window.DOCUMENT = ${donnees};</script>
    <script src="../../commun.js"></script>
    <script src="../../lecteur.js"></script>
  </body>
</html>
`;
  }

  async function creerLiens(bouton, zoneEtat) {
    const valides = aEnvoyer.filter((a) => !a.probleme);
    if (!valides.length) return;
    bouton.disabled = true;
    const total = valides.reduce((s, a) => s + a.fichier.size, 0);
    let deja = 0;
    try {
      const nouveaux = [];
      for (const a of valides) {
        zoneEtat.textContent = `Préparation de « ${a.titre} »…`;
        const base64 = await lireEnBase64(a.fichier);
        const sha = await envoyerFichier(base64, (part) => {
          const pourcent = Math.round(((deja + part * a.fichier.size) / total) * 100);
          zoneEtat.textContent = `Envoi de « ${a.titre} »… ${pourcent} %`;
        });
        deja += a.fichier.size;
        const ext = extension(a.fichier.name);
        const id = `${simplifier(a.titre, 40)}-${suffixe()}`;
        const doc = {
          id,
          titre: a.titre.trim() || sansExtension(a.fichier.name),
          fichier: `${simplifier(sansExtension(a.fichier.name), 60)}${ext ? `.${ext}` : ""}`,
          taille: a.fichier.size,
          date: Math.floor(Date.now() / 1000),
        };
        nouveaux.push({ doc, sha });
      }
      zoneEtat.textContent = "Création des liens…";
      const message =
        nouveaux.length === 1 ? `Document mis en lien : ${nouveaux[0].doc.titre}` : `${nouveaux.length} documents mis en lien`;
      documents = await enregistrer(message, (liste) => {
        const entrees = [];
        for (const { doc, sha } of nouveaux) {
          entrees.push({ path: `${D.dossier}/d/${doc.id}/${doc.fichier}`, mode: "100644", type: "blob", sha });
          entrees.push({ path: `${D.dossier}/d/${doc.id}/index.html`, mode: "100644", type: "blob", content: pageDeLecture(doc) });
        }
        return { entrees, nouvelleListe: [...nouveaux.map((n) => n.doc), ...liste] };
      });
      resultats = nouveaux.map((n) => ({ doc: n.doc, enLigne: false }));
      aEnvoyer = [];
      afficher();
      resultats.forEach(surveillerPublication);
    } catch (e) {
      console.error(e);
      bouton.disabled = false;
      zoneEtat.textContent = "";
      notifier(e instanceof ErreurGithub ? expliquer(e) : `Problème : ${e.message}`, 9000);
      if (e.statut === 401) deconnecter();
    }
  }

  // GitHub Pages met une à deux minutes à publier : on vérifie régulièrement.
  async function surveillerPublication(resultat) {
    const debut = Date.now();
    while (Date.now() - debut < 5 * 60 * 1000) {
      await new Promise((ok) => setTimeout(ok, 8000));
      try {
        const r = await fetch(lienDocument(resultat.doc), { method: "HEAD", cache: "no-store" });
        if (r.ok) {
          resultat.enLigne = true;
          afficher();
          return;
        }
      } catch {
        /* pas encore en ligne */
      }
    }
    resultat.enLigne = "lent";
    afficher();
  }

  async function supprimer(doc) {
    if (!confirm(`Supprimer « ${doc.titre} » ? Le lien ne fonctionnera plus.`)) return;
    try {
      notifier("Suppression…");
      documents = await enregistrer(`Document retiré : ${doc.titre}`, (liste) => ({
        entrees: [
          { path: `${D.dossier}/d/${doc.id}/${doc.fichier}`, mode: "100644", type: "blob", sha: null },
          { path: `${D.dossier}/d/${doc.id}/index.html`, mode: "100644", type: "blob", sha: null },
        ],
        nouvelleListe: liste.filter((x) => x.id !== doc.id),
      }));
      resultats = resultats.filter((r) => r.doc.id !== doc.id);
      afficher();
      notifier("Document supprimé.");
    } catch (e) {
      notifier(e instanceof ErreurGithub ? expliquer(e) : `Problème : ${e.message}`, 9000);
    }
  }

  // ---------------------------------------------------------------------------
  // Écrans
  // ---------------------------------------------------------------------------
  function entete() {
    return h(
      "header",
      { class: "entete" },
      h("p", { class: "surtitre", text: "Mes documents" }),
      h("h1", { text: "Transformer un document en lien" }),
      h("p", {
        class: "discret",
        text: "Déposez un livre, un PDF, un fichier Word… L'application le met en ligne et vous donne un lien. La personne qui reçoit le lien l'ouvre et lit le document en entier sur son téléphone, sans rien installer.",
      }),
    );
  }

  function ecranConnexion(message) {
    const champ = h("input", {
      type: "password",
      id: "jeton",
      autocomplete: "off",
      placeholder: "github_pat_…",
      "aria-label": "Clé d'accès GitHub",
    });
    const etat = h("p", { class: "discret", role: "status", text: message || "" });
    async function connecter(e) {
      e.preventDefault();
      jeton = champ.value.trim();
      if (!jeton) return;
      etat.textContent = "Vérification…";
      try {
        await api(`${DEPOT}/git/ref/heads/${D.branche}`);
        ecrire(CLE_JETON, jeton);
        await chargerListe();
      } catch (err) {
        jeton = "";
        etat.textContent = err instanceof ErreurGithub ? expliquer(err) : "Impossible de joindre GitHub. Vérifiez la connexion internet.";
      }
    }
    montrer(
      navChercheur("documents"),
      entete(),
      h(
        "form",
        { class: "bloc", onsubmit: connecter },
        h("h2", { text: "Connexion à GitHub (une seule fois)" }),
        h("p", {
          text: `Vos documents sont rangés dans votre dépôt GitHub « ${D.nom} ». Pour que l'application puisse les y déposer, elle a besoin d'une clé d'accès GitHub. La clé reste sur cet appareil.`,
        }),
        h(
          "ol",
          { class: "etapes" },
          h(
            "li",
            {},
            "Ouvrez ",
            h("a", { href: "https://github.com/settings/personal-access-tokens/new", target: "_blank", rel: "noopener", text: "cette page de GitHub" }),
            " (connectez-vous si besoin).",
          ),
          h("li", { text: "Token name : « Mes documents ». Expiration : choisissez une longue durée (par exemple 1 an)." }),
          h("li", { text: `Repository access : « Only select repositories », puis choisissez ${D.nom}.` }),
          h("li", { text: "Permissions → Repository permissions → Contents : « Read and write »." }),
          h("li", { text: "Cliquez « Generate token », copiez la clé (elle commence par github_pat_) et collez-la ici." }),
        ),
        h("div", { class: "champ-lien" }, champ, h("button", { class: "bouton petit", type: "submit", text: "Connecter" })),
        etat,
      ),
      pied(),
    );
  }

  function pied() {
    return h(
      "footer",
      { class: "pied" },
      jeton
        ? h("p", {}, "Connecté à GitHub · ", h("button", { class: "lien-bouton", type: "button", text: "Se déconnecter", onclick: deconnecter }))
        : null,
    );
  }

  function deconnecter() {
    jeton = "";
    oublier(CLE_JETON);
    ecranConnexion("Déconnecté.");
  }

  function choisirFichiers(liste) {
    for (const fichier of liste) {
      const ext = extension(fichier.name);
      let probleme = "";
      if (INTERDITS.includes(ext)) probleme = "Les pages web et les scripts ne peuvent pas être mis en lien.";
      else if (fichier.size > TAILLE_MAX) probleme = `Trop lourd (${taille(fichier.size)}) : 50 Mo au maximum.`;
      else if (!fichier.size) probleme = "Ce fichier est vide.";
      aEnvoyer.push({ fichier, titre: sansExtension(fichier.name).replace(/[_]+/g, " ").trim(), probleme });
    }
    afficher();
  }

  function actionsDocument(doc) {
    const lien = lienDocument(doc);
    return h(
      "div",
      { class: "actions" },
      h(
        "button",
        {
          class: "bouton petit",
          type: "button",
          onclick: async () => notifier((await copier(lien)) ? "Lien copié. Collez-le dans un message." : "Copiez le lien affiché."),
        },
        icone("lien"),
        "Copier le lien",
      ),
      h("a", { class: "bouton petit vert", href: lienWhatsapp(doc), target: "_blank", rel: "noopener" }, icone("message"), "WhatsApp"),
      h("a", { class: "lien-bouton", href: lien, target: "_blank", rel: "noopener", text: "Ouvrir" }),
    );
  }

  function afficher() {
    if (!jeton) return ecranConnexion();
    const entree = h("input", { type: "file", multiple: true, id: "fichiers", class: "invisible" });
    entree.addEventListener("change", () => {
      choisirFichiers(entree.files);
      entree.value = "";
    });
    const depot = h(
      "label",
      { class: "depot", for: "fichiers" },
      icone("ajouter"),
      h("strong", { text: "Choisir un ou plusieurs fichiers" }),
      h("span", { class: "discret", text: "PDF, Word, livre EPUB, images, audio, vidéo… jusqu'à 50 Mo par fichier" }),
    );
    depot.addEventListener("dragover", (e) => {
      e.preventDefault();
      depot.classList.add("survol");
    });
    depot.addEventListener("dragleave", () => depot.classList.remove("survol"));
    depot.addEventListener("drop", (e) => {
      e.preventDefault();
      depot.classList.remove("survol");
      choisirFichiers(e.dataTransfer.files);
    });

    const zoneEtat = h("p", { class: "discret", role: "status" });
    const boutonCreer = h("button", {
      class: "bouton",
      type: "button",
      text: aEnvoyer.filter((a) => !a.probleme).length > 1 ? "Créer les liens" : "Créer le lien",
      disabled: !aEnvoyer.some((a) => !a.probleme),
      onclick: () => creerLiens(boutonCreer, zoneEtat),
    });

    const choisis = aEnvoyer.map((a, i) => {
      const titre = h("input", { type: "text", value: a.titre, id: `titre-${i}`, maxlength: 120, "aria-label": `Titre de ${a.fichier.name}` });
      titre.addEventListener("input", () => (a.titre = titre.value));
      return h(
        "li",
        { class: `fichier-choisi${a.probleme ? " refuse" : ""}` },
        h(
          "div",
          { class: "fichier-ligne" },
          h("span", { class: "fichier-nom", text: `${a.fichier.name} · ${taille(a.fichier.size)}` }),
          h("button", {
            class: "lien-bouton",
            type: "button",
            text: "Retirer",
            onclick: () => {
              aEnvoyer.splice(i, 1);
              afficher();
            },
          }),
        ),
        a.probleme ? h("p", { class: "etiquette-refus", text: a.probleme }) : h("label", { class: "discret", for: `titre-${i}`, text: "Titre affiché" }),
        a.probleme ? null : titre,
      );
    });

    montrer(
      navChercheur("documents"),
      entete(),
      h(
        "section",
        { class: "bloc" },
        h("h2", { text: "Nouveau document" }),
        depot,
        entree,
        choisis.length ? h("ul", { class: "fichiers-choisis" }, choisis) : null,
        choisis.length ? h("div", { class: "actions" }, boutonCreer, zoneEtat) : null,
      ),
      resultats.length
        ? h(
            "section",
            { class: "bloc resultat" },
            h("h2", { text: resultats.length > 1 ? "Vos liens sont prêts" : "Votre lien est prêt" }),
            resultats.map(({ doc, enLigne }) =>
              h(
                "div",
                { class: "document-cree" },
                h("p", { class: "document-titre", text: doc.titre }),
                h("div", { class: "champ-lien" }, h("input", { type: "text", readonly: true, value: lienDocument(doc), "aria-label": `Lien de ${doc.titre}` })),
                h(
                  "p",
                  { class: `publication ${enLigne === true ? "ok" : ""}` },
                  enLigne === true
                    ? "En ligne : le lien fonctionne."
                    : enLigne === "lent"
                      ? "La publication prend plus de temps que prévu. Si le lien ne marche toujours pas dans quelques minutes, vérifiez que GitHub Pages est activé (voir le mode d'emploi)."
                      : "Mise en ligne en cours (1 à 2 minutes). Vous pouvez déjà copier et envoyer le lien.",
                ),
                actionsDocument(doc),
              ),
            ),
          )
        : null,
      h(
        "section",
        { class: "bloc" },
        h("h2", { text: `Documents en ligne (${documents.length})` }),
        documents.length
          ? h(
              "ul",
              { class: "liste-documents" },
              documents.map((doc) =>
                h(
                  "li",
                  {},
                  h("p", { class: "document-titre", text: doc.titre }),
                  h(
                    "p",
                    { class: "discret" },
                    [extension(doc.fichier).toUpperCase(), taille(doc.taille), new Date(doc.date * 1000).toLocaleDateString("fr-FR")].join(" · "),
                  ),
                  h(
                    "div",
                    { class: "document-actions" },
                    actionsDocument(doc),
                    h("button", { class: "lien-bouton danger-texte", type: "button", text: "Supprimer", onclick: () => supprimer(doc) }),
                  ),
                ),
              ),
            )
          : h("p", { class: "discret", text: "Aucun document pour l'instant. Choisissez un fichier ci-dessus pour créer votre premier lien." }),
        h("p", {
          class: "discret",
          text: "Attention : toute personne qui a le lien peut lire le document, et les fichiers sont visibles dans votre dépôt GitHub public. Ne mettez pas en ligne de documents confidentiels.",
        }),
      ),
      pied(),
    );
  }

  async function chargerListe() {
    montrer(navChercheur("documents"), entete(), h("p", { class: "discret", text: "Chargement de vos documents…" }));
    try {
      const ref = await api(`${DEPOT}/git/ref/heads/${D.branche}`);
      documents = await lireListe(ref.object.sha);
      afficher();
    } catch (e) {
      if (e.statut === 401 || e.statut === 404) {
        jeton = "";
        oublier(CLE_JETON);
        ecranConnexion(expliquer(e));
      } else {
        montrer(
          navChercheur("documents"),
          entete(),
          h("div", { class: "avertissement" }, h("strong", { text: "GitHub ne répond pas." }), h("span", { text: e instanceof ErreurGithub ? expliquer(e) : "Vérifiez la connexion internet, puis rechargez la page." })),
          pied(),
        );
      }
    }
  }

  if (jeton) chargerListe();
  else ecranConnexion();
})();
