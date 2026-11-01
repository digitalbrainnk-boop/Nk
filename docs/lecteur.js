/*
 * Page de lecture d'un document mis en lien depuis « Mes documents ».
 * La page du document définit window.DOCUMENT = { titre, fichier, taille, date }.
 * PDF, Word (.docx), e-book (.epub), images, texte, audio et vidéo s'affichent
 * directement ; les autres fichiers se téléchargent.
 */
(function () {
  "use strict";

  const { h, icone, notifier, copier, taille } = window.Commun;
  const D = window.DOCUMENT || {};
  const zone = document.getElementById("lecteur");
  const racine = new URL("./", document.currentScript.src);
  const vendor = (chemin) => new URL(`vendor/${chemin}`, racine).href;
  const urlFichier = new URL(encodeURIComponent(D.fichier || ""), location.href).href;
  const ext = String(D.fichier || "").split(".").pop().toLowerCase();

  const FAMILLES = {
    pdf: ["pdf"],
    word: ["docx"],
    epub: ["epub"],
    image: ["jpg", "jpeg", "png", "gif", "webp", "avif", "bmp"],
    texte: ["txt", "md", "csv"],
    audio: ["mp3", "m4a", "aac", "ogg", "oga", "opus", "wav"],
    video: ["mp4", "m4v", "webm", "mov"],
    office: ["doc", "rtf", "odt", "ppt", "pptx", "pps", "ppsx", "xls", "xlsx", "ods", "odp"],
  };
  const famille = Object.keys(FAMILLES).find((f) => FAMILLES[f].includes(ext)) || "autre";
  const LIBELLES = {
    pdf: "PDF",
    word: "Document Word",
    epub: "Livre numérique (EPUB)",
    image: "Image",
    texte: "Texte",
    audio: "Audio",
    video: "Vidéo",
    office: "Document Office",
    autre: "Fichier",
  };

  function charger(src) {
    return new Promise((ok, echec) => {
      const s = document.createElement("script");
      s.src = src;
      s.onload = ok;
      s.onerror = () => echec(new Error(`chargement impossible : ${src}`));
      document.head.append(s);
    });
  }

  const etat = h("p", { class: "discret lecteur-etat", role: "status", text: "Ouverture du document…" });

  async function telechargerOctets() {
    const reponse = await fetch(urlFichier);
    if (!reponse.ok) throw new Error(`HTTP ${reponse.status}`);
    const total = Number(reponse.headers.get("content-length")) || D.taille || 0;
    if (!reponse.body || !total) return reponse.arrayBuffer();
    const lecteur = reponse.body.getReader();
    const morceaux = [];
    let recu = 0;
    for (;;) {
      const { done, value } = await lecteur.read();
      if (done) break;
      morceaux.push(value);
      recu += value.length;
      etat.textContent = `Chargement… ${taille(recu)} sur ${taille(total)}`;
    }
    const tout = new Uint8Array(recu);
    let position = 0;
    for (const m of morceaux) {
      tout.set(m, position);
      position += m.length;
    }
    return tout.buffer;
  }

  const visionneuseOffice = () =>
    `https://view.officeapps.live.com/op/view.aspx?src=${encodeURIComponent(urlFichier)}`;

  // ---------------------------------------------------------------------------
  // En-tête : titre, téléchargement, partage
  // ---------------------------------------------------------------------------
  function entete() {
    const lien = location.href.split("#")[0];
    const message = `${D.titre}\n${lien}`;
    const partager =
      typeof navigator.share === "function"
        ? h(
            "button",
            {
              class: "bouton petit secondaire",
              type: "button",
              onclick: async () => {
                try {
                  await navigator.share({ title: D.titre, url: lien });
                } catch {
                  /* partage annulé */
                }
              },
            },
            icone("partager"),
            "Partager",
          )
        : h(
            "a",
            { class: "bouton petit secondaire", href: `https://wa.me/?text=${encodeURIComponent(message)}`, target: "_blank", rel: "noopener" },
            icone("message"),
            "Envoyer par WhatsApp",
          );
    return h(
      "header",
      { class: "entete lecteur-entete" },
      h("p", { class: "surtitre", text: [LIBELLES[famille], taille(D.taille)].filter(Boolean).join(" · ") }),
      h("h1", { text: D.titre || "Document" }),
      h(
        "div",
        { class: "actions" },
        h("a", { class: "bouton petit", href: urlFichier, download: D.fichier }, icone("telecharger"), "Télécharger"),
        partager,
        h("button", {
          class: "lien-bouton",
          type: "button",
          text: "Copier le lien",
          onclick: async () => notifier((await copier(lien)) ? "Lien copié." : "Copiez le lien depuis la barre d'adresse."),
        }),
      ),
    );
  }

  function erreur(e) {
    console.error(e);
    etat.replaceWith(
      h(
        "div",
        { class: "avertissement" },
        h("strong", { text: "Le document ne s'affiche pas ici." }),
        h("span", {
          text: "S'il vient d'être mis en ligne, attendez une à deux minutes puis rechargez la page. Vous pouvez aussi le télécharger avec le bouton ci-dessus.",
        }),
      ),
    );
  }

  // ---------------------------------------------------------------------------
  // PDF : pages dessinées au fur et à mesure du défilement
  // ---------------------------------------------------------------------------
  async function lirePdf(corps) {
    await charger(vendor("pdfjs/pdf.min.js"));
    const pdfjs = window.pdfjsLib;
    pdfjs.GlobalWorkerOptions.workerSrc = vendor("pdfjs/pdf.worker.min.js");
    const tache = pdfjs.getDocument({ url: urlFichier, standardFontDataUrl: vendor("pdfjs/standard_fonts/") });
    tache.onProgress = ({ loaded, total }) => {
      if (total) etat.textContent = `Chargement… ${Math.round((loaded / total) * 100)} %`;
    };
    const pdf = await tache.promise;
    const nombre = pdf.numPages;
    const premiere = (await pdf.getPage(1)).getViewport({ scale: 1 });
    let zoom = 1;

    const pages = [];
    const conteneur = h("div", { class: "pdf-pages" });
    const cadre = h("div", { class: "pdf-cadre" }, conteneur);
    for (let i = 1; i <= nombre; i++) {
      const p = h("div", { class: "pdf-page", "data-page": i, style: `aspect-ratio:${premiere.width}/${premiere.height}` });
      pages.push({ el: p, tache: null, dessinee: false });
      conteneur.append(p);
    }

    const champPage = h("input", { type: "number", min: 1, max: nombre, value: 1, id: "pdf-page", "aria-label": "Numéro de page", inputmode: "numeric" });
    const niveau = h("span", { class: "pdf-zoom", text: "100 %" });
    const barreOutils = h(
      "div",
      { class: "pdf-outils" },
      h("button", { class: "bouton petit secondaire", type: "button", "aria-label": "Réduire", text: "−", onclick: () => changerZoom(-1) }),
      niveau,
      h("button", { class: "bouton petit secondaire", type: "button", "aria-label": "Agrandir", text: "+", onclick: () => changerZoom(1) }),
      h("label", { class: "pdf-aller", for: "pdf-page" }, "Page ", champPage, ` / ${nombre}`),
    );
    champPage.addEventListener("change", () => {
      const n = Math.min(nombre, Math.max(1, parseInt(champPage.value, 10) || 1));
      pages[n - 1].el.scrollIntoView({ block: "start" });
    });

    async function dessiner(index) {
      const page = pages[index];
      if (page.dessinee || page.tache) return;
      const p = await pdf.getPage(index + 1);
      const vue = p.getViewport({ scale: 1 });
      page.el.style.aspectRatio = `${vue.width}/${vue.height}`;
      const largeur = page.el.clientWidth || conteneur.clientWidth;
      const densite = Math.min(window.devicePixelRatio || 1, 2);
      const echelle = (largeur / vue.width) * densite;
      const vueFinale = p.getViewport({ scale: echelle });
      const toile = h("canvas", { width: Math.floor(vueFinale.width), height: Math.floor(vueFinale.height) });
      page.tache = p.render({ canvasContext: toile.getContext("2d"), viewport: vueFinale });
      try {
        await page.tache.promise;
        page.el.replaceChildren(toile);
        page.dessinee = true;
      } catch {
        /* dessin annulé : la page est sortie de l'écran */
      } finally {
        page.tache = null;
      }
    }
    function liberer(index) {
      const page = pages[index];
      if (page.tache) page.tache.cancel();
      if (page.dessinee) {
        page.el.replaceChildren();
        page.dessinee = false;
      }
    }

    const observateur = new IntersectionObserver(
      (entrees) => {
        for (const e of entrees) {
          const index = Number(e.target.dataset.page) - 1;
          if (e.isIntersecting) dessiner(index);
          else liberer(index);
        }
      },
      { rootMargin: "150% 0px" },
    );
    pages.forEach((p) => observateur.observe(p.el));

    const suivi = new IntersectionObserver(
      (entrees) => {
        for (const e of entrees) if (e.isIntersecting) champPage.value = e.target.dataset.page;
      },
      { rootMargin: "-45% 0px -50% 0px" },
    );
    pages.forEach((p) => suivi.observe(p.el));

    const NIVEAUX = [1, 1.5, 2, 3];
    function changerZoom(sens) {
      const i = Math.min(NIVEAUX.length - 1, Math.max(0, NIVEAUX.indexOf(zoom) + sens));
      if (NIVEAUX[i] === zoom) return;
      const visible = Number(champPage.value) || 1;
      zoom = NIVEAUX[i];
      niveau.textContent = `${Math.round(zoom * 100)} %`;
      conteneur.style.width = `${zoom * 100}%`;
      pages.forEach((_, index) => liberer(index));
      pages.forEach((p) => {
        observateur.unobserve(p.el);
        observateur.observe(p.el);
      });
      pages[visible - 1].el.scrollIntoView({ block: "start" });
    }

    etat.remove();
    corps.append(barreOutils, cadre);
  }

  // ---------------------------------------------------------------------------
  // Word (.docx) : transformé en page lisible
  // ---------------------------------------------------------------------------
  async function lireWord(corps) {
    const [octets] = await Promise.all([telechargerOctets(), charger(vendor("mammoth/mammoth.browser.min.js"))]);
    const resultat = await window.mammoth.convertToHtml({ arrayBuffer: octets });
    const article = h("article", { class: "texte-document" });
    article.innerHTML = resultat.value || "<p>Ce document est vide.</p>";
    etat.remove();
    corps.append(
      article,
      h(
        "p",
        { class: "discret" },
        "La mise en page est simplifiée pour la lecture sur téléphone. ",
        h("a", { href: visionneuseOffice(), target: "_blank", rel: "noopener", text: "Voir avec la mise en page d'origine" }),
        ".",
      ),
    );
  }

  // ---------------------------------------------------------------------------
  // Livre numérique (.epub)
  // ---------------------------------------------------------------------------
  async function lireEpub(corps) {
    const [octets] = await Promise.all([
      telechargerOctets(),
      charger(vendor("jszip/jszip.min.js")).then(() => charger(vendor("epubjs/epub.min.js"))),
    ]);
    const livre = window.ePub(octets);
    const surface = h("div", { class: "epub-surface", id: "epub-surface" });
    const chapitres = h("select", { id: "epub-chapitres", "aria-label": "Chapitres" }, h("option", { value: "", text: "Chapitres…" }));
    const precedent = h("button", { class: "bouton petit secondaire", type: "button", text: "← Page précédente" });
    const suivant = h("button", { class: "bouton petit", type: "button", text: "Page suivante →" });
    etat.remove();
    corps.append(h("div", { class: "epub-outils" }, chapitres), surface, h("div", { class: "epub-navigation" }, precedent, suivant));

    const rendu = livre.renderTo(surface, { width: "100%", height: "100%", spread: "none", flow: "paginated" });
    rendu.themes.default({
      body: { "font-family": "Georgia, 'Times New Roman', serif", "line-height": "1.6", padding: "0 6px !important" },
      img: { "max-width": "100% !important" },
    });
    await rendu.display();
    precedent.addEventListener("click", () => rendu.prev());
    suivant.addEventListener("click", () => rendu.next());
    document.addEventListener("keydown", (e) => {
      if (e.key === "ArrowRight") rendu.next();
      if (e.key === "ArrowLeft") rendu.prev();
    });
    let debutX = null;
    rendu.on("touchstart", (e) => (debutX = e.changedTouches[0].screenX));
    rendu.on("touchend", (e) => {
      if (debutX === null) return;
      const ecart = e.changedTouches[0].screenX - debutX;
      if (Math.abs(ecart) > 50) (ecart < 0 ? rendu.next() : rendu.prev());
      debutX = null;
    });
    const navigation = await livre.loaded.navigation;
    const ajouter = (elements, niveau) =>
      elements.forEach((c) => {
        chapitres.append(h("option", { value: c.href, text: `${"  ".repeat(niveau)}${c.label.trim()}` }));
        if (c.subitems && c.subitems.length) ajouter(c.subitems, niveau + 1);
      });
    ajouter(navigation.toc || [], 0);
    if (chapitres.options.length <= 1) chapitres.hidden = true;
    chapitres.addEventListener("change", () => chapitres.value && rendu.display(chapitres.value));
  }

  // ---------------------------------------------------------------------------
  // Autres types
  // ---------------------------------------------------------------------------
  async function lireTexte(corps) {
    const reponse = await fetch(urlFichier);
    if (!reponse.ok) throw new Error(`HTTP ${reponse.status}`);
    const texte = await reponse.text();
    etat.remove();
    corps.append(h("pre", { class: "texte-brut", text: texte }));
  }

  function lireMedia(corps, balise) {
    const media = h(balise, { src: urlFichier, controls: true, preload: "metadata", class: `media-${balise}` });
    if (balise === "img") {
      media.removeAttribute("controls");
      media.alt = D.titre || "";
    }
    media.addEventListener("error", () => erreur(new Error("média illisible")));
    etat.remove();
    corps.append(media);
  }

  function sansApercu(corps) {
    etat.remove();
    corps.append(
      h(
        "div",
        { class: "bloc" },
        h("p", { text: "Ce type de fichier ne s'affiche pas directement dans le navigateur." }),
        famille === "office"
          ? h(
              "p",
              {},
              h("a", { class: "bouton", href: visionneuseOffice(), target: "_blank", rel: "noopener" }, icone("document"), "Lire en ligne (visionneuse Microsoft)"),
            )
          : null,
        h("p", { class: "discret", text: "Vous pouvez aussi le télécharger avec le bouton « Télécharger » ci-dessus." }),
      ),
    );
  }

  async function demarrer() {
    document.title = D.titre || "Document";
    if (!D.fichier) {
      zone.replaceChildren(h("div", { class: "avertissement" }, h("strong", { text: "Document introuvable." })));
      return;
    }
    const corps = h("div", { class: `lecteur-corps lecteur-${famille}` }, etat);
    zone.replaceChildren(entete(), corps);
    try {
      if (famille === "pdf") await lirePdf(corps);
      else if (famille === "word") await lireWord(corps);
      else if (famille === "epub") await lireEpub(corps);
      else if (famille === "texte") await lireTexte(corps);
      else if (famille === "image") lireMedia(corps, "img");
      else if (famille === "audio") lireMedia(corps, "audio");
      else if (famille === "video") lireMedia(corps, "video");
      else sansApercu(corps);
    } catch (e) {
      erreur(e);
    }
  }

  demarrer();
})();
