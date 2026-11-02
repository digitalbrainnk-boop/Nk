/*
 * Interface du questionnaire : accueil, parties, fin et envoi des réponses,
 * lecture d'un lien de réponses et espace chercheur.
 */
(function () {
  "use strict";

  const E = window.ENQUETE;
  const O = window.EnqueteOutils;
  const R = E.reglages || {};
  const QUESTIONS = O.preparer(E);
  const PARTIES = E.parties;
  const CLE_BROUILLON = "enquete-grace-liberte:brouillon";
  const CLE_TABLEAU = "enquete-grace-liberte:tableau";
  const app = document.getElementById("app");
  const barre = document.getElementById("barre");

  const { ARTEFACT, h, icone, lire, ecrire, oublier, notifier, enregistrerFichier, siTelechargement, confirmer, copier, navChercheur } =
    window.Commun;

  function adresseBase() {
    if (ARTEFACT) return R.lienArtefact || R.lienDuSite;
    let encadre = false;
    try {
      encadre = window.top !== window.self;
    } catch {
      encadre = true;
    }
    if (/^https?:$/.test(location.protocol) && !encadre) return location.origin + location.pathname;
    return R.lienDuSite || location.href.split("#")[0];
  }
  const lienDe = (code) => `${adresseBase()}#r=${code}`;

  const maintenant = () => Math.floor(Date.now() / 1000);
  const nomDuFichier = (id) => `Reponses-questionnaire-${id}.docx`;
  const pluriel = (n, mot) => `${n} ${mot}${n > 1 ? "s" : ""}`;

  function aller(ancre) {
    if (location.hash === ancre) route();
    else location.hash = ancre;
  }

  // ---------------------------------------------------------------------------
  // Brouillon du participant (gardé sur son téléphone jusqu'à l'envoi)
  // ---------------------------------------------------------------------------
  let etat = lire(CLE_BROUILLON, null);
  if (!etat || typeof etat.a !== "object" || !etat.id) etat = null;

  function assurerEtat() {
    if (!etat) {
      etat = { id: O.nouveauCode(), debut: maintenant(), maj: maintenant(), a: {} };
      ecrire(CLE_BROUILLON, etat);
    }
    return etat;
  }
  function sauver() {
    etat.maj = maintenant();
    if (!ecrire(CLE_BROUILLON, etat) && !sauver.prevenu) {
      sauver.prevenu = true;
      notifier("Ce navigateur ne garde pas les réponses : terminez le questionnaire sans fermer la page.");
    }
  }
  function nombreRepondues(a) {
    return QUESTIONS.filter((q) => O.estRepondue(q, a)).length;
  }
  function majProgression() {
    if (!etat) return;
    const part = nombreRepondues(etat.a) / QUESTIONS.length;
    document.getElementById("barre-remplissage").style.width = `${Math.round(part * 100)}%`;
  }
  function donneesEnvoi() {
    return { v: E.version, id: etat.id, t: etat.maj, a: etat.a };
  }

  // ---------------------------------------------------------------------------
  // Navigation
  // ---------------------------------------------------------------------------
  let questionAVoir = null;

  function route() {
    let ancre = location.hash.slice(1);
    try {
      ancre = decodeURIComponent(ancre);
    } catch {
      /* ancre déjà lisible */
    }
    barre.hidden = true;
    window.scrollTo(0, 0);
    if (ancre.startsWith("r=")) return vueReponse(ancre.slice(2));
    if (ancre === "chercheur") return espaceChercheur();
    if (ancre === "espace" || ancre === "appli") return ecranEspace();
    const m = ancre.match(/^partie-(\d+)$/);
    if (m && +m[1] >= 1 && +m[1] <= PARTIES.length) return ecranPartie(+m[1] - 1);
    if (ancre === "fin") return ecranFin();
    return accueil();
  }

  function afficher(...contenu) {
    app.replaceChildren(...contenu.flat().filter((x) => x !== null && x !== undefined && x !== false));
  }

  // ---------------------------------------------------------------------------
  // Accueil
  // ---------------------------------------------------------------------------
  function accueil() {
    document.title = "Enquête grâce et liberté";
    const repondues = etat ? nombreRepondues(etat.a) : 0;
    const fiche = [
      ["Cadre de l'étude", E.cadre],
      ["Échantillonnage", E.echantillon],
    ];
    afficher(
      h(
        "header",
        { class: "entete" },
        h("p", { class: "surtitre", text: E.surtitre }),
        h("h1", { text: E.titre }),
        h("dl", { class: "fiche" }, fiche.map(([dt, dd]) => [h("dt", { text: dt }), h("dd", { text: dd })])),
      ),
      h(
        "article",
        { class: "lettre" },
        E.introduction.map((p) => h("p", { text: p })),
        h("p", { class: "signature", text: E.signatureIntroduction }),
      ),
      h(
        "ul",
        { class: "reperes" },
        h("li", { text: `${QUESTIONS.length} questions en ${PARTIES.length} parties` }),
        h("li", { text: "Environ 15 à 20 minutes" }),
        h("li", { text: "Anonyme" }),
        h("li", { text: "Enregistrement automatique" }),
      ),
      repondues > 0
        ? h(
            "div",
            { class: "actions" },
            h("button", {
              class: "bouton",
              type: "button",
              text: `Reprendre le questionnaire (${repondues}/${QUESTIONS.length})`,
              onclick: () => {
                const vide = premiereQuestionVide();
                if (!vide) return aller("#fin");
                questionAVoir = vide.n;
                aller(`#partie-${vide.partie + 1}`);
              },
            }),
            h("button", {
              class: "lien-bouton",
              type: "button",
              text: "Recommencer à zéro",
              onclick: async () => {
                if (!(await confirmer("Effacer toutes vos réponses et recommencer ?", { oui: "Effacer", danger: true }))) return;
                etat = null;
                oublier(CLE_BROUILLON);
                avertis.clear();
                accueil();
              },
            }),
          )
        : h(
            "div",
            { class: "actions" },
            h("button", { class: "bouton", type: "button", text: "Commencer le questionnaire", onclick: () => aller("#partie-1") }),
          ),
      piedDePage(),
    );
  }

  function premiereQuestionVide() {
    return etat ? QUESTIONS.find((q) => !O.estRepondue(q, etat.a)) : QUESTIONS[0];
  }

  function piedDePage() {
    return h(
      "footer",
      { class: "pied" },
      h("p", { text: "Thèse de doctorat en théologie" }),
      h("p", {}, h("a", { href: "#espace", text: "Espace chercheur" })),
    );
  }

  // ---------------------------------------------------------------------------
  // Accueil de l'espace chercheur
  // ---------------------------------------------------------------------------
  function ecranEspace() {
    document.title = `Espace chercheur · ${E.titre}`;
    const lien = adresseBase();
    const invitation = `Bonjour, dans le cadre de ma thèse de doctorat en théologie, je mène une enquête sur « ${E.titre} ». Pouvez-vous répondre au questionnaire ? C'est anonyme et cela prend environ 15 minutes :\n${lien}`;
    const champ = h("input", { type: "text", readonly: true, value: lien, id: "lien-questionnaire", "aria-label": "Lien du questionnaire" });
    const nombre = lire(CLE_TABLEAU, []).length;
    const tuile = (titre, detail, href) => h("a", { class: "tuile", href }, h("strong", { text: titre }), h("span", { class: "discret", text: detail }));
    afficher(
      navChercheur("accueil"),
      h(
        "header",
        { class: "entete" },
        h("p", { class: "surtitre", text: "Espace chercheur" }),
        h("h1", { text: E.titre }),
      ),
      h(
        "section",
        { class: "bloc" },
        h("h2", { text: "Partager le questionnaire" }),
        h("p", { text: "Envoyez ce lien aux fidèles : ils l'ouvrent, répondent aux questions, puis vous renvoient leurs réponses." }),
        h(
          "div",
          { class: "champ-lien" },
          champ,
          h("button", {
            class: "bouton petit secondaire",
            type: "button",
            text: "Copier",
            onclick: async () => notifier((await copier(lien, champ)) ? "Lien copié." : "Sélectionnez le lien et copiez-le."),
          }),
        ),
        h(
          "div",
          { class: "partages" },
          h("a", { class: "bouton vert", href: `https://wa.me/?text=${encodeURIComponent(invitation)}`, target: "_blank", rel: "noopener" }, icone("message"), "Envoyer par WhatsApp"),
          !ARTEFACT && typeof navigator.share === "function"
            ? h(
                "button",
                {
                  class: "bouton secondaire",
                  type: "button",
                  onclick: async () => {
                    try {
                      await navigator.share({ title: E.titre, text: invitation });
                    } catch {
                      /* partage annulé */
                    }
                  },
                },
                icone("partager"),
                "Partager autrement",
              )
            : null,
        ),
        h("details", {}, h("summary", { text: "Voir le message envoyé" }), h("p", { class: "citation", text: invitation })),
      ),
      h(
        "section",
        { class: "raccourcis" },
        tuile("Réponses reçues", nombre ? `${nombre} réponse${nombre > 1 ? "s" : ""} dans votre tableau` : "Rassembler et analyser les réponses", "#chercheur"),
        ARTEFACT ? null : tuile("Mes documents", "Transformer un livre ou un PDF en lien", "documents.html"),
        tuile("Voir le questionnaire", "Tel que les participants le voient", "#accueil"),
      ),
    );
  }

  // ---------------------------------------------------------------------------
  // Une partie du questionnaire
  // ---------------------------------------------------------------------------
  const avertis = new Set();

  function ecranPartie(index) {
    assurerEtat();
    const partie = PARTIES[index];
    const questions = QUESTIONS.filter((q) => q.partie === index);
    document.title = `${partie.rang} · ${E.titre}`;
    barre.hidden = false;
    majProgression();

    const avertissement = h("div", { class: "avertissement", role: "alert", hidden: true });
    const cartes = questions.map((q) => carteQuestion(q));

    function suivant() {
      const manquantes = questions.filter((q) => !O.estRepondue(q, etat.a));
      if (manquantes.length && !avertis.has(index)) {
        avertis.add(index);
        for (const q of manquantes) marquerManque(q.n, true);
        avertissement.replaceChildren(
          h("strong", {
            text:
              manquantes.length === 1
                ? `La question ${manquantes[0].n} n'a pas de réponse.`
                : `Les questions ${manquantes.map((q) => q.n).join(", ")} n'ont pas de réponse.`,
          }),
          h("span", { text: "Vous pouvez y répondre maintenant, ou appuyer encore sur « Suivant » pour continuer." }),
        );
        avertissement.hidden = false;
        document.getElementById(`q${manquantes[0].n}`).scrollIntoView({ behavior: "smooth", block: "start" });
        return;
      }
      aller(index + 1 < PARTIES.length ? `#partie-${index + 2}` : "#fin");
    }

    afficher(
      h(
        "header",
        { class: "titre-partie" },
        h("p", { class: "surtitre", text: `${partie.rang} · ${index + 1} sur ${PARTIES.length}` }),
        h("h2", { text: partie.titre }),
        partie.description ? h("p", { class: "description", text: partie.description }) : null,
      ),
      h("ol", { class: "questions" }, cartes),
      avertissement,
      h(
        "nav",
        { class: "navigation", "aria-label": "Navigation entre les parties" },
        h("button", {
          class: "bouton secondaire",
          type: "button",
          text: index === 0 ? "← Accueil" : "← Précédent",
          onclick: () => aller(index === 0 ? "#accueil" : `#partie-${index}`),
        }),
        h("button", {
          class: "bouton",
          type: "button",
          text: index + 1 < PARTIES.length ? "Suivant →" : "Terminer →",
          onclick: suivant,
        }),
      ),
      h("p", { class: "enregistre", text: "Vos réponses sont enregistrées automatiquement sur cet appareil." }),
    );

    if (questionAVoir) {
      const cible = document.getElementById(`q${questionAVoir}`);
      questionAVoir = null;
      if (cible) setTimeout(() => cible.scrollIntoView({ block: "start" }), 50);
    }
  }

  function marquerManque(n, oui) {
    const carte = document.getElementById(`q${n}`);
    if (!carte) return;
    carte.classList.toggle("manque", oui);
    const etiquette = carte.querySelector(".etiquette-manque");
    if (etiquette) etiquette.hidden = !oui;
  }

  function carteQuestion(q) {
    const etiquette = h("p", { class: "etiquette-manque", hidden: true, text: "Sans réponse" });
    const entete = [h("span", { class: "numero", text: q.n }), h("span", { text: q.texte })];

    if (q.ouverte) {
      const zone = h("textarea", {
        id: `reponse-${q.n}`,
        name: `q${q.n}`,
        rows: 6,
        maxlength: 4000,
        placeholder: "Écrivez votre réponse ici…",
      });
      zone.value = etat.a[q.n] || "";
      zone.addEventListener("input", () => {
        if (zone.value.trim()) etat.a[q.n] = zone.value;
        else delete etat.a[q.n];
        sauver();
        majProgression();
        if (zone.value.trim()) marquerManque(q.n, false);
      });
      return h(
        "li",
        { class: "question", id: `q${q.n}` },
        h("label", { class: "intitule", for: `reponse-${q.n}` }, entete),
        etiquette,
        zone,
      );
    }

    const type = q.multiple ? "checkbox" : "radio";
    const entrees = [];
    const libelles = [];
    let precision = null;

    function synchroniser() {
      const choix = etat.a[q.n] || [];
      entrees.forEach((e, i) => {
        e.checked = choix.includes(i);
        libelles[i].classList.toggle("coche", e.checked);
      });
    }

    function choisir(i, coche) {
      let choix = new Set(etat.a[q.n] || []);
      if (!q.multiple) choix = coche ? new Set([i]) : choix;
      else if (coche) {
        choix.add(i);
        if (q.options[i].exclusif) choix = new Set([i]);
        else q.options.forEach((o, j) => o.exclusif && choix.delete(j));
      } else choix.delete(i);
      const liste = [...choix].sort((x, y) => x - y);
      if (liste.length) etat.a[q.n] = liste;
      else delete etat.a[q.n];
      synchroniser();
      sauver();
      majProgression();
      if (liste.length) marquerManque(q.n, false);
    }

    const options = q.options.map((o, i) => {
      const entree = h("input", { type, name: `q${q.n}`, value: i, id: `q${q.n}-${i}` });
      entree.addEventListener("change", () => choisir(i, entree.checked));
      entrees.push(entree);
      const libelle = h("label", { class: "option", for: `q${q.n}-${i}` }, entree, h("span", { class: "case" }), h("span", { class: "texte", text: o.autre ? `${o.texte} :` : o.texte }));
      libelles.push(libelle);
      if (!o.autre) return libelle;
      precision = h("input", {
        type: "text",
        id: `q${q.n}-precision`,
        maxlength: 300,
        placeholder: "Précisez votre réponse",
        "aria-label": `Question ${q.n} : précisez votre réponse`,
      });
      precision.value = etat.a[q.n + "t"] || "";
      precision.addEventListener("input", () => {
        if (precision.value.trim()) etat.a[q.n + "t"] = precision.value;
        else delete etat.a[q.n + "t"];
        if (precision.value.trim() && !(etat.a[q.n] || []).includes(i)) choisir(i, true);
        else sauver();
      });
      return [libelle, h("div", { class: "precision" }, precision)];
    });

    synchroniser();
    return h(
      "li",
      { class: "question", id: `q${q.n}` },
      h(
        "fieldset",
        {},
        h("legend", {}, entete),
        h("p", { class: "consigne", text: q.multiple ? "Vous pouvez cocher plusieurs réponses." : "Une seule réponse." }),
        etiquette,
        h("div", { class: "options" }, options),
      ),
    );
  }

  // ---------------------------------------------------------------------------
  // Fin : remerciements et envoi des réponses
  // ---------------------------------------------------------------------------
  function ecranFin() {
    document.title = `Merci · ${E.titre}`;
    if (!etat || nombreRepondues(etat.a) === 0) {
      afficher(
        h("div", { class: "carte" }, h("p", { text: "Vous n'avez encore répondu à aucune question." })),
        h("div", { class: "actions" }, h("button", { class: "bouton", type: "button", text: "Commencer le questionnaire", onclick: () => aller("#partie-1") })),
      );
      return;
    }
    const repondues = nombreRepondues(etat.a);
    const manquantes = QUESTIONS.filter((q) => !O.estRepondue(q, etat.a));
    const message = (lien) =>
      `Bonjour, voici mes réponses au questionnaire « ${E.titre} » (code ${etat.id}) :\n${lien}`;
    // Sur claude.ai, le lien ne peut pas transporter les réponses : le message les contient en clair.
    const messageComplet = (code) =>
      [
        `Réponses au questionnaire « ${E.titre} »`,
        `Code : ${etat.id} · ${O.formaterDate(etat.maj)}`,
        "",
        ...QUESTIONS.map((q) => `${q.n}. ${O.texteReponse(q, etat.a) || "(pas de réponse)"}`),
        "",
        "Données pour le tableau du chercheur :",
        `#r=${code}`,
      ].join("\n");

    const boutonWhatsapp = h(
      "a",
      { class: "bouton vert", href: "#", target: "_blank", rel: "noopener", "aria-disabled": "true" },
      icone("message"),
      "Envoyer par WhatsApp",
    );
    const boutonWord = siTelechargement(
      h(
        "button",
        {
          class: "bouton",
          type: "button",
          onclick: async () => {
            const ok = await enregistrerFichier(O.docxReponse(E, QUESTIONS, O.nettoyer(donneesEnvoi(), QUESTIONS)), nomDuFichier(etat.id));
            if (ok) notifier("Fichier Word enregistré. Vous pouvez l'envoyer comme document dans WhatsApp.");
          },
        },
        icone("document"),
        "Télécharger en Word",
      ),
    );
    const boutonCopier = h(
      "button",
      { class: "bouton secondaire", type: "button", disabled: true },
      icone(ARTEFACT ? "document" : "lien"),
      ARTEFACT ? "Copier mes réponses" : "Copier le lien de mes réponses",
    );
    const champLien = ARTEFACT
      ? h("textarea", { readonly: true, rows: 8, id: "texte-reponses", class: "texte-message", "aria-label": "Message de vos réponses" })
      : h("input", { type: "text", readonly: true, id: "lien-reponses", "aria-label": "Lien de vos réponses" });
    const boutonEmail = ARTEFACT ? null : h("a", { class: "lien-bouton", href: "#", "aria-disabled": "true", text: "Envoyer par e-mail" });
    const boutonPartager =
      !ARTEFACT && typeof navigator.share === "function"
        ? h("button", { class: "lien-bouton", type: "button", text: "Partager autrement" })
        : null;
    const recap = h("div", { class: "recap", hidden: true }, recapitulatif(etat.a));

    afficher(
      h(
        "section",
        { class: "merci" },
        h("p", { class: "surtitre", text: "Remerciements" }),
        h("h1", { text: "Merci pour votre participation" }),
        E.remerciements.map((p) => h("p", { text: p })),
        h("p", { class: "discret" }, E.signature.join(" · ")),
      ),
      h(
        "div",
        { class: "ticket" },
        h(
          "div",
          { class: "ticket-entete" },
          h("div", {}, h("p", { class: "surtitre", text: "Code de vos réponses" }), h("p", { class: "code", text: etat.id })),
          h("p", { class: "discret", text: `${repondues} réponses sur ${QUESTIONS.length}` }),
        ),
        manquantes.length
          ? h(
              "div",
              { class: "avertissement" },
              h("span", {
                text:
                  manquantes.length === 1
                    ? `Vous n'avez pas répondu à la question ${manquantes[0].n}.`
                    : `Vous n'avez pas répondu aux questions ${manquantes.map((q) => q.n).join(", ")}.`,
              }),
              h("button", {
                class: "lien-bouton",
                type: "button",
                text: "Compléter mes réponses",
                onclick: () => {
                  questionAVoir = manquantes[0].n;
                  aller(`#partie-${manquantes[0].partie + 1}`);
                },
              }),
            )
          : null,
        h("p", { text: "Dernière étape : envoyez vos réponses au chercheur, de la façon la plus simple pour vous." }),
        h("div", { class: "partages" }, boutonWhatsapp, boutonWord, boutonCopier),
        ARTEFACT
          ? null
          : h(
              "div",
              { class: "partages-secondaires" },
              boutonPartager,
              boutonEmail,
              h("button", {
                class: "lien-bouton",
                type: "button",
                text: "Imprimer ou enregistrer en PDF",
                onclick: () => {
                  recap.hidden = false;
                  window.print();
                },
              }),
            ),
        h(
          "details",
          {},
          h("summary", { text: ARTEFACT ? "Voir le message envoyé" : "Voir le lien de mes réponses" }),
          h("p", {
            class: "discret",
            text: ARTEFACT
              ? "Ce message contient toutes vos réponses. Vous pouvez aussi le copier et l'envoyer par SMS ou Messenger."
              : "Ce lien contient toutes vos réponses. En l'ouvrant, le chercheur les voit s'afficher.",
          }),
          ARTEFACT
            ? champLien
            : h("div", { class: "champ-lien" }, champLien, h("button", { class: "bouton petit secondaire", type: "button", text: "Copier", onclick: () => copierLien() })),
        ),
      ),
      h(
        "div",
        { class: "bloc" },
        h("h2", { text: "Vos réponses" }),
        h(
          "div",
          { class: "actions" },
          h("button", {
            class: "bouton petit secondaire",
            type: "button",
            text: "Afficher le récapitulatif",
            onclick: (e) => {
              recap.hidden = !recap.hidden;
              e.currentTarget.textContent = recap.hidden ? "Afficher le récapitulatif" : "Masquer le récapitulatif";
            },
          }),
          h("button", { class: "bouton petit secondaire", type: "button", text: "Modifier mes réponses", onclick: () => aller("#partie-1") }),
        ),
        recap,
      ),
      h(
        "div",
        { class: "bloc sans-impression" },
        h("h2", { text: "Plusieurs personnes sur ce téléphone ?" }),
        h("p", {
          class: "discret",
          text: "Si le chercheur fait remplir le questionnaire à plusieurs personnes avec le même appareil : enregistrez ces réponses dans l'espace chercheur, puis passez à la personne suivante.",
        }),
        h(
          "div",
          { class: "actions" },
          h("button", {
            class: "bouton petit secondaire",
            type: "button",
            text: "Enregistrer et passer au participant suivant",
            onclick: () => {
              ajouterAuTableau([O.nettoyer(donneesEnvoi(), QUESTIONS)]);
              etat = null;
              oublier(CLE_BROUILLON);
              avertis.clear();
              notifier("Réponses enregistrées dans l'espace chercheur. Nouveau questionnaire prêt.");
              aller("#accueil");
            },
          }),
          h("button", {
            class: "lien-bouton",
            type: "button",
            text: "Effacer mes réponses de cet appareil",
            onclick: async () => {
              if (!(await confirmer("Avez-vous bien envoyé vos réponses ? Elles seront effacées de cet appareil.", { oui: "Effacer", danger: true }))) return;
              etat = null;
              oublier(CLE_BROUILLON);
              avertis.clear();
              aller("#accueil");
            },
          }),
        ),
      ),
      piedDePage(),
    );

    let lien = "";
    async function copierLien() {
      if (!lien) return;
      const ok = await copier(lien, champLien);
      if (ARTEFACT) notifier(ok ? "Réponses copiées. Collez-les dans un message au chercheur." : "Sélectionnez le texte et copiez-le.");
      else notifier(ok ? "Lien copié. Collez-le dans un message au chercheur." : "Sélectionnez le lien et copiez-le.");
    }
    boutonCopier.addEventListener("click", copierLien);

    O.encoder(donneesEnvoi()).then((code) => {
      lien = ARTEFACT ? messageComplet(code) : lienDe(code);
      champLien.value = lien;
      const numero = String(R.whatsapp || "").replace(/\D/g, "");
      boutonWhatsapp.href = `https://wa.me/${numero}?text=${encodeURIComponent(ARTEFACT ? lien : message(lien))}`;
      boutonWhatsapp.removeAttribute("aria-disabled");
      boutonCopier.disabled = false;
      const sujet = `Réponses au questionnaire — code ${etat.id}`;
      if (boutonEmail) {
        boutonEmail.href = `mailto:${R.email || ""}?subject=${encodeURIComponent(sujet)}&body=${encodeURIComponent(message(lien))}`;
        boutonEmail.removeAttribute("aria-disabled");
      }
      if (boutonPartager) {
        boutonPartager.addEventListener("click", async () => {
          const texte = message(lien);
          const fichier = new File([O.docxReponse(E, QUESTIONS, O.nettoyer(donneesEnvoi(), QUESTIONS))], nomDuFichier(etat.id), {
            type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
          });
          try {
            if (navigator.canShare && navigator.canShare({ files: [fichier] })) {
              await navigator.share({ title: E.titre, text: texte, files: [fichier] });
            } else {
              await navigator.share({ title: E.titre, text: texte });
            }
          } catch (erreur) {
            if (erreur && erreur.name !== "AbortError") notifier("Le partage n'a pas fonctionné. Utilisez « Copier le lien ».");
          }
        });
      }
    });
  }

  // ---------------------------------------------------------------------------
  // Récapitulatif des réponses (lecture seule)
  // ---------------------------------------------------------------------------
  function recapitulatif(rep) {
    return PARTIES.map((partie, ip) =>
      h(
        "section",
        { class: "recap-partie" },
        h("h3", { text: `${partie.rang} : ${partie.titre}` }),
        QUESTIONS.filter((q) => q.partie === ip).map((q) => {
          let reponse;
          if (q.ouverte) {
            const texte = (rep[q.n] || "").trim();
            reponse = texte ? h("p", { class: "libre", text: texte }) : h("p", { class: "vide", text: "Pas de réponse" });
          } else {
            const choix = O.choixTextes(q, rep);
            reponse = choix.length ? choix.map((c) => h("p", { class: "choix", text: c })) : h("p", { class: "vide", text: "Pas de réponse" });
          }
          return h(
            "div",
            { class: "recap-question" },
            h("p", { class: "intitule" }, h("span", { class: "numero", text: q.n }), h("span", { text: q.texte })),
            h("div", { class: "recap-reponse" }, reponse),
          );
        }),
      ),
    );
  }

  // ---------------------------------------------------------------------------
  // Ouverture d'un lien de réponses (côté chercheur)
  // ---------------------------------------------------------------------------
  async function vueReponse(source) {
    document.title = `Réponses · ${E.titre}`;
    afficher(h("p", { class: "discret", text: "Ouverture des réponses…" }));
    window.scrollTo(0, 0);
    let reponse;
    try {
      reponse = typeof source === "string" ? O.nettoyer(await O.decoder(source), QUESTIONS) : source;
    } catch {
      afficher(
        h(
          "div",
          { class: "avertissement" },
          h("strong", { text: "Ce lien de réponses est incomplet ou abîmé." }),
          h("span", {
            text: "Il a peut-être été coupé en le copiant. Demandez au participant de renvoyer le lien en entier, ou son fichier Word. Si le lien est complet, ouvrez-le avec un navigateur récent (Chrome, Safari, Firefox).",
          }),
        ),
        piedDePage(),
      );
      return;
    }
    const repondues = nombreRepondues(reponse.a);
    const dejaLa = lire(CLE_TABLEAU, []).find((r) => r.id === reponse.id);
    const boutonTableau = h("button", {
      class: "bouton secondaire",
      type: "button",
      text: dejaLa ? (dejaLa.t >= reponse.t ? "Déjà dans mon tableau ✓" : "Mettre à jour dans mon tableau") : "Ajouter à mon tableau",
      disabled: dejaLa && dejaLa.t >= reponse.t,
      onclick: (e) => {
        const bilan = ajouterAuTableau([reponse]);
        e.currentTarget.textContent = "Dans mon tableau ✓";
        e.currentTarget.disabled = true;
        notifier(bilan.ajoutees ? "Réponses ajoutées à votre tableau (Espace chercheur)." : "Réponses mises à jour dans votre tableau.");
      },
    });
    afficher(
      h(
        "header",
        { class: "entete" },
        h("p", { class: "surtitre", text: "Réponses d'un participant" }),
        h("h1", { text: E.titre }),
        h(
          "dl",
          { class: "fiche" },
          h("dt", { text: "Code" }),
          h("dd", { class: "mono", text: reponse.id }),
          h("dt", { text: "Envoyées le" }),
          h("dd", { text: O.formaterDate(reponse.t) }),
          h("dt", { text: "Complété" }),
          h("dd", { text: `${repondues} questions sur ${QUESTIONS.length}` }),
        ),
      ),
      h(
        "div",
        { class: "actions" },
        siTelechargement(
          h(
            "button",
            { class: "bouton", type: "button", onclick: () => enregistrerFichier(O.docxReponse(E, QUESTIONS, reponse), nomDuFichier(reponse.id)) },
            icone("document"),
            "Télécharger en Word",
          ),
        ),
        boutonTableau,
        ARTEFACT ? null : h("button", { class: "lien-bouton", type: "button", text: "Imprimer", onclick: () => window.print() }),
      ),
      h("div", { class: "bloc recap" }, recapitulatif(reponse.a)),
      h(
        "footer",
        { class: "pied" },
        h("p", {}, h("button", { class: "lien-bouton", type: "button", text: "← Toutes les réponses reçues", onclick: () => aller("#chercheur") })),
      ),
    );
  }

  // ---------------------------------------------------------------------------
  // Espace chercheur : rassembler les réponses, résultats, export Excel
  // ---------------------------------------------------------------------------
  function ajouterAuTableau(reponses) {
    const tableau = lire(CLE_TABLEAU, []);
    let ajoutees = 0;
    let majs = 0;
    for (const r of reponses) {
      const i = tableau.findIndex((x) => x.id === r.id);
      if (i === -1) {
        tableau.push(r);
        ajoutees++;
      } else if ((r.t || 0) > (tableau[i].t || 0)) {
        tableau[i] = r;
        majs++;
      }
    }
    tableau.sort((x, y) => (x.t || 0) - (y.t || 0));
    if (!ecrire(CLE_TABLEAU, tableau)) notifier("Impossible d'enregistrer sur cet appareil (mémoire du navigateur bloquée).");
    return { ajoutees, majs };
  }

  function espaceChercheur() {
    document.title = `Espace chercheur · ${E.titre}`;
    const tableau = lire(CLE_TABLEAU, []);
    const objectif = R.objectifParConfession || 50;
    const confession = (r) => (Array.isArray(r.a[3]) ? r.a[3][0] : -1);
    const libelle = (n, r) => {
      const q = QUESTIONS.find((x) => x.n === n);
      return O.choixTextes(q, r.a).join(", ") || "—";
    };
    const nbCath = tableau.filter((r) => confession(r) === 0).length;
    const nbProt = tableau.filter((r) => confession(r) === 1).length;

    const carteCompteur = (titre, valeur, total) =>
      h(
        "div",
        { class: "compteur-carte" },
        h("p", { class: "surtitre", text: titre }),
        h("p", { class: "valeur" }, String(valeur), h("small", { text: ` / ${total}` })),
        h("div", { class: "jauge", role: "img", "aria-label": `${valeur} sur ${total}` }, h("span", { style: `width:${Math.min(100, (valeur / total) * 100)}%` })),
      );

    const zone = h("textarea", {
      id: "liens-a-ajouter",
      rows: 4,
      placeholder: ARTEFACT
        ? "Collez ici un ou plusieurs messages de réponses (ou toute une discussion WhatsApp)…"
        : "Collez ici un ou plusieurs liens de réponses (ou toute une discussion WhatsApp)…",
    });
    const fichier = h("input", { type: "file", accept: ".txt,text/plain", hidden: true, id: "fichier-discussion" });

    async function importer(texte) {
      const codes = O.extraireCodes(texte);
      if (!codes.length) {
        notifier("Aucune réponse trouvée dans ce texte.");
        return;
      }
      const reponses = [];
      let abimes = 0;
      for (const code of codes) {
        try {
          reponses.push(O.nettoyer(await O.decoder(code), QUESTIONS));
        } catch {
          abimes++;
        }
      }
      const bilan = ajouterAuTableau(reponses);
      const morceaux = [`${pluriel(bilan.ajoutees, "réponse ajoutée")}`];
      if (bilan.majs) morceaux.push(`${pluriel(bilan.majs, "mise")} à jour`);
      const deja = reponses.length - bilan.ajoutees - bilan.majs;
      if (deja) morceaux.push(`${deja} déjà présente${deja > 1 ? "s" : ""}`);
      if (abimes) morceaux.push(`${pluriel(abimes, "lien")} abîmé${abimes > 1 ? "s" : ""}`);
      espaceChercheur();
      notifier(morceaux.join(" · "));
    }
    fichier.addEventListener("change", async () => {
      const f = fichier.files && fichier.files[0];
      if (f) importer(await f.text());
    });

    const lignes = tableau.map((r) =>
      h(
        "tr",
        {},
        h("td", { class: "mono", text: r.id }),
        h("td", { class: "nombre", text: O.formaterDateCourte(r.t) }),
        h("td", { text: libelle(3, r) }),
        h("td", { text: libelle(1, r) }),
        h("td", { text: libelle(2, r) }),
        h("td", { class: "nombre", text: `${nombreRepondues(r.a)}/${QUESTIONS.length}` }),
        h(
          "td",
          {},
          h("button", { class: "lien-bouton", type: "button", text: "Voir", onclick: () => vueReponse(r) }),
          " · ",
          h("button", {
            class: "lien-bouton",
            type: "button",
            text: "Retirer",
            onclick: async () => {
              if (!(await confirmer(`Retirer les réponses ${r.id} du tableau ?`, { oui: "Retirer", danger: true }))) return;
              ecrire(
                CLE_TABLEAU,
                lire(CLE_TABLEAU, []).filter((x) => x.id !== r.id),
              );
              espaceChercheur();
            },
          }),
        ),
      ),
    );

    afficher(
      navChercheur("reponses"),
      h(
        "header",
        { class: "entete" },
        h("p", { class: "surtitre", text: "Espace chercheur" }),
        h("h1", { text: "Réponses reçues" }),
        h("p", {
          class: "discret",
          text: ARTEFACT
            ? "Les participants vous envoient leurs réponses par WhatsApp. Copiez leurs messages et collez-les ici, un ou plusieurs à la fois. Le tableau reste sur cet appareil ; les messages WhatsApp restent votre sauvegarde."
            : "Les participants vous envoient un lien. Ouvrez-le puis « Ajouter à mon tableau », ou collez ici tous les liens reçus. Le tableau reste sur cet appareil et ce navigateur.",
        }),
      ),
      h(
        "div",
        { class: "compteurs" },
        carteCompteur("Participants", tableau.length, objectif * 2),
        carteCompteur("Catholiques", nbCath, objectif),
        carteCompteur("Protestants", nbProt, objectif),
      ),
      h(
        "div",
        { class: "bloc" },
        h("h2", { text: "Ajouter des réponses" }),
        zone,
        h(
          "div",
          { class: "actions" },
          h("button", { class: "bouton petit", type: "button", text: "Ajouter", onclick: () => importer(zone.value) }),
          h("button", { class: "bouton petit secondaire", type: "button", text: "Importer un fichier .txt", onclick: () => fichier.click() }),
          fichier,
        ),
        h("p", {
          class: "discret",
          text: "Astuce : dans WhatsApp, ouvrez la discussion, puis ⋮ → Plus → Exporter la discussion → Sans médias. Importez ce fichier .txt ici : tous les liens qu'il contient sont ajoutés d'un coup.",
        }),
      ),
      h(
        "div",
        { class: "bloc" },
        h("h2", { text: "Participants" }),
        tableau.length
          ? h(
              "div",
              { class: "defilement" },
              h(
                "table",
                {},
                h(
                  "thead",
                  {},
                  h(
                    "tr",
                    {},
                    ["Code", "Date", "Confession", "Sexe", "Âge", "Rempli", ""].map((t) => h("th", { text: t, class: t === "Rempli" ? "nombre" : null })),
                  ),
                ),
                h("tbody", {}, lignes),
              ),
            )
          : h("p", { class: "discret", text: "Aucune réponse pour l'instant. Collez un message ou un lien reçu dans la case ci-dessus." }),
        tableau.length
          ? h(
              "div",
              { class: "actions" },
              h("button", {
                class: "bouton petit",
                type: "button",
                text: "Exporter vers Excel (.csv)",
                onclick: () => enregistrerFichier(new Blob([O.csv(QUESTIONS, tableau)], { type: "text/csv;charset=utf-8" }), `reponses-enquete-${dateFichier()}.csv`),
              }),
              h("button", {
                class: "bouton petit secondaire",
                type: "button",
                text: ARTEFACT ? "Sauvegarder (.txt)" : "Sauvegarder les liens (.txt)",
                onclick: async () => {
                  const lignesTexte = [`Sauvegarde — ${E.titre} — ${tableau.length} réponses — ${O.formaterDate(maintenant())}`, ""];
                  for (const r of tableau) {
                    const code = await O.encoder(r);
                    lignesTexte.push(`${r.id} : ${ARTEFACT ? `#r=${code}` : lienDe(code)}`);
                  }
                  const ok = await enregistrerFichier(
                    new Blob([lignesTexte.join("\r\n")], { type: "text/plain;charset=utf-8" }),
                    `sauvegarde-enquete-${dateFichier()}.txt`,
                  );
                  if (ok) notifier("Sauvegarde enregistrée. Pour la restaurer : « Importer un fichier .txt ».");
                },
              }),
              h("button", {
                class: "bouton petit danger",
                type: "button",
                text: "Tout effacer",
                onclick: async () => {
                  if (!(await confirmer(`Effacer les ${tableau.length} réponses de cet appareil ? Faites d'abord une sauvegarde.`, { oui: "Tout effacer", danger: true }))) return;
                  oublier(CLE_TABLEAU);
                  espaceChercheur();
                },
              }),
            )
          : null,
      ),
      tableau.length ? blocResultats(tableau) : null,
      tableau.length ? blocReponsesOuvertes(tableau) : null,
      h("footer", { class: "pied" }, h("p", {}, h("a", { href: "#accueil", text: "Retour au questionnaire" }))),
    );
    zone.addEventListener("paste", () =>
      setTimeout(() => {
        if (O.extraireCodes(zone.value).length) importer(zone.value);
      }, 0),
    );
  }

  function dateFichier() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  }

  function pourcent(compte, total) {
    return total ? Math.round((compte / total) * 100) : 0;
  }

  function blocResultats(tableau) {
    const stats = O.statistiques(QUESTIONS, tableau);
    return h(
      "div",
      { class: "bloc" },
      h("h2", { text: "Résultats par question" }),
      h("p", {
        class: "discret",
        text: "Pourcentage des participants ayant répondu à la question. Quand plusieurs réponses sont possibles, le total peut dépasser 100 %.",
      }),
      stats.map((s) =>
        h(
          "section",
          { class: "stat-question" },
          h("h3", { text: `${s.q.n}. ${s.q.texte}` }),
          h(
            "p",
            { class: "discret" },
            `${pluriel(s.ensemble.repondants, "répondant")} (catholiques : ${s.groupes[0].repondants}, protestants : ${s.groupes[1].repondants})`,
          ),
          h(
            "div",
            { class: "defilement" },
            h(
              "table",
              {},
              h(
                "thead",
                {},
                h("tr", {}, h("th", { text: "Réponse" }), h("th", { text: "Ensemble" }), h("th", { class: "nombre", text: "Cath." }), h("th", { class: "nombre", text: "Prot." })),
              ),
              h(
                "tbody",
                {},
                s.q.options.map((o, i) => {
                  const p = pourcent(s.ensemble.comptes[i], s.ensemble.repondants);
                  return h(
                    "tr",
                    {},
                    h("td", { text: o.texte }),
                    h(
                      "td",
                      { title: `${s.ensemble.comptes[i]} sur ${s.ensemble.repondants}` },
                      h(
                        "div",
                        { class: "barre-stat" },
                        h("div", { class: "piste" }, h("span", { style: `width:${p}%` })),
                        h("span", { class: "nombre", text: `${p} %` }),
                      ),
                    ),
                    h("td", { class: "nombre", text: `${pourcent(s.groupes[0].comptes[i], s.groupes[0].repondants)} %` }),
                    h("td", { class: "nombre", text: `${pourcent(s.groupes[1].comptes[i], s.groupes[1].repondants)} %` }),
                  );
                }),
              ),
            ),
          ),
        ),
      ),
    );
  }

  function blocReponsesOuvertes(tableau) {
    const confession = (r) => {
      const v = Array.isArray(r.a[3]) ? r.a[3][0] : -1;
      return v === 0 ? "catholique" : v === 1 ? "protestant" : "confession non indiquée";
    };
    const autres = tableau.filter((r) => (r.a["7t"] || "").trim());
    return h(
      "div",
      { class: "bloc" },
      h("h2", { text: "Réponses écrites" }),
      autres.length
        ? h(
            "details",
            {},
            h("summary", { text: `7. « Autre » : précisions (${autres.length})` }),
            autres.map((r) => h("p", { class: "citation" }, r.a["7t"], h("span", { class: "discret", text: `${r.id} · ${confession(r)}` }))),
          )
        : null,
      QUESTIONS.filter((q) => q.ouverte).map((q) => {
        const textes = tableau.filter((r) => (r.a[q.n] || "").trim());
        return h(
          "details",
          {},
          h("summary", { text: `${q.n}. ${q.texte} (${textes.length})` }),
          textes.length
            ? textes.map((r) => h("p", { class: "citation" }, r.a[q.n].trim(), h("span", { class: "discret", text: `${r.id} · ${confession(r)}` })))
            : h("p", { class: "discret", text: "Aucune réponse." }),
        );
      }),
    );
  }

  window.addEventListener("hashchange", route);
  route();
})();
