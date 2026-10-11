/*
 * Interface de l'agent de dimensionnement : projet, charges, choix techniques, résultats, note de calcul,
 * et assistant IA (Claude) qui pilote le moteur de calcul par des outils.
 * Tous les chiffres affichés viennent de window.Moteur (moteur.js) ; l'assistant ne calcule rien lui-même.
 */
(function () {
  "use strict";

  const M = window.Moteur;
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
  const CLE_PROJET = "agent-dimensionnement:projet";
  const CLE_ONGLET = "agent-dimensionnement:onglet";
  const ETROIT = window.matchMedia("(max-width: 1179px)");

  const etat = { projet: null, resultat: null, erreurs: null, comparaison: null, minuterie: null, supprime: null };

  // ---------------------------------------------------------------------------
  // Utilitaires
  // ---------------------------------------------------------------------------

  function echap(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  }
  function fr(x, d = 1) {
    if (x === null || x === undefined || !Number.isFinite(Number(x))) return "—";
    return Number(x).toLocaleString("fr-FR", { maximumFractionDigits: d, minimumFractionDigits: 0 });
  }
  const pct = (x, d = 0) => `${fr(x * 100, d)} %`;
  const cloner = (o) => JSON.parse(JSON.stringify(o));
  function nombreSaisi(texte) {
    const t = String(texte).trim().replace(/[\s  ]/g, "").replace(",", ".");
    if (t === "") return undefined;
    const x = Number(t);
    return Number.isFinite(x) ? x : NaN;
  }
  const versSaisie = (v) => (v === null || v === undefined ? "" : String(v).replace(".", ","));
  function html(chaine) {
    const t = document.createElement("template");
    t.innerHTML = chaine.trim();
    return t.content.firstElementChild;
  }
  function lire(chemin, objet = etat.projet) {
    return chemin.split(".").reduce((o, k) => (o === null || o === undefined ? undefined : o[k]), objet);
  }
  function ecrire(chemin, valeur) {
    const cles = chemin.split(".");
    let o = etat.projet;
    for (let i = 0; i < cles.length - 1; i++) {
      if (o[cles[i]] === undefined || o[cles[i]] === null) o[cles[i]] = /^\d+$/.test(cles[i + 1]) ? [] : {};
      o = o[cles[i]];
    }
    const k = cles[cles.length - 1];
    if (valeur === undefined) delete o[k];
    else o[k] = valeur;
  }
  const DEFAUT_CIRCUIT = { longueur_m: 30, ks: 1, calibre_min: 10, section_min: 1.5 };
  const DEFAUT_RECEPTEUR = { quantite: 1, rendement: 1, ku: 1, cos_phi: 0.9 };
  function valeurParDefaut(chemin) {
    let m = chemin.match(/^circuits\.\d+\.recepteurs\.\d+\.(\w+)$/);
    if (m) return DEFAUT_RECEPTEUR[m[1]];
    m = chemin.match(/^circuits\.\d+\.(\w+)$/);
    if (m) return DEFAUT_CIRCUIT[m[1]];
    const [racine, cle] = chemin.split(".");
    const table = { hypotheses: M.HYPOTHESES, site: M.SITE, module: M.MODULE_PV, mppt: M.REGULATEUR, source: M.SOURCE, ligne: M.LIGNE }[racine];
    return table && !Array.isArray(table[cle]) ? table[cle] : undefined;
  }

  const capacites = {};
  function capacite(nom) {
    if (!window.claude || typeof window.claude.use !== "function") return Promise.resolve(null);
    if (!capacites[nom]) capacites[nom] = window.claude.use(nom).catch(() => null);
    return capacites[nom];
  }

  // ---------------------------------------------------------------------------
  // Plages horaires
  // ---------------------------------------------------------------------------

  function lirePlages(texte) {
    const res = [];
    const morceaux = String(texte).split(/;|\n|,(?=\s*\d{1,2}\s*h?\s*[-–à])/);
    for (const brut of morceaux) {
      const m = brut.trim();
      if (!m) continue;
      const r = m.match(/^(\d{1,2})\s*h?\s*[-–à]\s*(\d{1,2})\s*h?(?:\s*[:x×@]?\s*(\d+(?:[.,]\d+)?)\s*(%)?)?$/i);
      if (!r) return null;
      let taux = r[3] === undefined ? 1 : Number(r[3].replace(",", "."));
      if (r[4] || taux > 1) taux /= 100;
      res.push([Number(r[1]), Number(r[2]), Math.round(taux * 1000) / 1000]);
    }
    return res;
  }
  function ecrirePlages(plages) {
    return (plages || []).map(([d, f, t]) => `${d}-${f}${t === 1 ? "" : ` ${fr(t * 100, 1)}%`}`).join("; ");
  }

  // ---------------------------------------------------------------------------
  // Bibliothèque d'appareils (valeurs typiques à ajuster selon la plaque signalétique)
  // ---------------------------------------------------------------------------

  const BIBLIOTHEQUE = [
    ["Lampe LED 10 W", 10, 0.9, { plages: [[18, 23, 1]] }],
    ["Tube LED 18 W", 18, 0.9, { plages: [[18, 23, 1]] }],
    ["Projecteur LED extérieur 50 W", 50, 0.9, { plages: [[18, 6, 1]] }],
    ["Ventilateur de plafond 75 W", 75, 0.85, { plages: [[11, 17, 0.8], [20, 6, 0.6]] }],
    ["Climatiseur split 9 000 BTU (0,8 kW)", 800, 0.95, { plages: [[11, 18, 0.7]] }],
    ["Climatiseur split 12 000 BTU (1,1 kW)", 1100, 0.95, { plages: [[11, 18, 0.7]] }],
    ["Climatiseur split 18 000 BTU (1,7 kW)", 1700, 0.95, { plages: [[11, 18, 0.7]] }],
    ["Réfrigérateur 150 W", 150, 0.8, { plages: [[0, 24, 0.5]] }],
    ["Congélateur 200 W", 200, 0.8, { plages: [[0, 24, 0.5]] }],
    ["Téléviseur LED 100 W", 100, 0.95, { plages: [[18, 23, 1]] }],
    ["Ordinateur portable 60 W", 60, 0.95, { plages: [[8, 17, 0.8]] }],
    ["Ordinateur de bureau 150 W", 150, 0.95, { plages: [[8, 17, 0.8]] }],
    ["Imprimante laser 400 W", 400, 0.95, { plages: [[8, 17, 0.1]] }],
    ["Box internet / routeur 15 W", 15, 0.9, { plages: [[0, 24, 1]] }],
    ["Caméra de surveillance 10 W", 10, 0.9, { plages: [[0, 24, 1]] }],
    ["Micro-ondes 1 000 W", 1000, 0.95, { plages: [[12, 13, 0.2], [19, 20, 0.2]] }],
    ["Bouilloire 2 000 W", 2000, 1, { plages: [[7, 8, 0.15]] }],
    ["Fer à repasser 1 000 W", 1000, 1, { plages: [[18, 19, 0.3]] }],
    ["Chauffe-eau électrique 1 500 W", 1500, 1, { plages: [[5, 7, 0.6]] }],
    ["Lave-linge 500 W", 500, 0.8, { plages: [[9, 11, 0.5]] }],
    ["Prise de courant (usages divers) 250 W", 250, 0.9, { plages: [[8, 18, 0.1]] }],
    ["Pompe de surface 0,75 kW (1 CV)", 750, 0.8, { rendement: 0.75, moteur: true, demarrage: "direct", plages: [[7, 9, 1]] }],
    ["Pompe immergée 1,5 kW (2 CV)", 1500, 0.82, { rendement: 0.78, moteur: true, demarrage: "progressif", plages: [[10, 14, 1]] }],
    ["Pompe immergée 3 kW (4 CV)", 3000, 0.83, { rendement: 0.82, moteur: true, demarrage: "progressif", plages: [[10, 14, 1]] }],
    ["Moulin à grains 7,5 kW", 7500, 0.85, { rendement: 0.88, ku: 0.8, moteur: true, demarrage: "etoile_triangle", plages: [[8, 12, 0.7], [15, 18, 0.7]] }],
    ["Compresseur d'air 2,2 kW", 2200, 0.82, { rendement: 0.84, ku: 0.75, moteur: true, demarrage: "direct", plages: [[8, 17, 0.4]] }],
    ["Moteur triphasé 5,5 kW", 5500, 0.85, { rendement: 0.87, ku: 0.75, moteur: true, demarrage: "progressif", plages: [[8, 17, 0.6]] }],
    ["Autoclave 2 000 W", 2000, 1, { plages: [[10, 12, 0.8]] }],
    ["Concentrateur d'oxygène 350 W", 350, 0.95, { plages: [[0, 24, 0.5]] }],
  ].map(([nom, puissance_w, cos_phi, extra]) => ({ nom, puissance_w, cos_phi, rendement: 1, ku: 1, moteur: false, demarrage: "direct",
    non_lineaire: /LED|Ordinateur|Imprimante|Box|Caméra|Micro-ondes|Téléviseur|inverter/i.test(nom), ...extra }));

  // ---------------------------------------------------------------------------
  // Projet : chargement, enregistrement, calcul
  // ---------------------------------------------------------------------------

  function projetVide() {
    const actuel = etat.projet || {};
    return { nom: "Nouveau projet", systeme: "hybride", referentiel: actuel.referentiel || "nfc15100", reseau: actuel.reseau || "400/230-50",
      site: { ...M.SITE }, circuits: [], module: { ...M.MODULE_PV }, mppt: { ...M.REGULATEUR }, hypotheses: {}, source: {}, ligne: { actif: false } };
  }
  function completer(p) {
    const base = projetVide();
    const hypotheses = { ...(p.hypotheses || {}) };
    if (hypotheses.disposition_circuits) { // projets enregistrés avant l'ajout des méthodes de pose
      if (!hypotheses.methode_pose) hypotheses.methode_pose = { couche_paroi: "C", faisceau: "B1" }[hypotheses.disposition_circuits] || "E";
      delete hypotheses.disposition_circuits;
    }
    const referentiel = M.REFERENTIELS[p.referentiel] ? p.referentiel : "nfc15100";
    const reseau = M.RESEAUX[p.reseau] && M.RESEAUX[p.reseau].famille === M.REFERENTIELS[referentiel].famille ? p.reseau : M.normaliser({ referentiel }).reseau;
    const ligne = { actif: false, ...(p.ligne || {}) };
    ligne.portees = Array.isArray(ligne.portees) ? ligne.portees : cloner(M.LIGNE.portees);
    return { ...base, ...p, referentiel, reseau, site: { ...base.site, ...(p.site || {}) }, module: { ...base.module, ...(p.module || {}) },
      mppt: { ...base.mppt, ...(p.mppt || {}) }, hypotheses, source: { ...(p.source || {}) }, ligne, circuits: Array.isArray(p.circuits) ? p.circuits : [] };
  }
  function chargerProjet() {
    try {
      const t = localStorage.getItem(CLE_PROJET);
      if (t) return completer(JSON.parse(t));
    } catch (e) { /* stockage indisponible : on part de l'exemple */ }
    return completer(M.projetExemple());
  }
  function enregistrer() {
    try { localStorage.setItem(CLE_PROJET, JSON.stringify(etat.projet)); } catch (e) { /* sans effet */ }
  }
  function calculer() {
    clearTimeout(etat.minuterie);
    try {
      etat.resultat = M.executer(etat.projet);
      etat.erreurs = null;
    } catch (e) {
      etat.resultat = null;
      etat.erreurs = e.erreurs || [e.message];
    }
    etat.comparaison = null;
    enregistrer();
    rendreEntete();
    majChiffresCircuits();
    rendreResultats();
    rendreLigneResultats();
    rendreNote();
  }
  function programmerCalcul() {
    clearTimeout(etat.minuterie);
    etat.minuterie = setTimeout(calculer, 250);
  }
  function remplacerProjet(p) {
    etat.projet = completer(p);
    rendreFormulaires();
    calculer();
  }
  function comparaison() {
    if (etat.comparaison) return etat.comparaison;
    etat.comparaison = Object.keys(M.SYSTEMES).map((systeme) => {
      const p = cloner(etat.projet);
      p.systeme = systeme;
      try {
        return { systeme, res: M.executer(p) };
      } catch (e) {
        return { systeme, erreur: (e.erreurs || [e.message]).join(" ") };
      }
    });
    return etat.comparaison;
  }

  const NOMS_SYSTEMES = { hybride: "Hybride", solaire: "Solaire autonome", groupe: "Groupe seul", reseau: "Réseau public" };
  const reseauActif = () => M.RESEAUX[etat.projet.reseau] || M.RESEAUX["400/230-50"];
  const referentielActif = () => M.REFERENTIELS[etat.projet.referentiel] || M.REFERENTIELS.nfc15100;
  const famille = () => referentielActif().famille;
  /** Libellé court d'un réseau : « 400/230 V », « 120/240 V », « 230 V mono ». */
  function tensionCourte(res = reseauActif()) {
    if (res.nph === 1) return `${res.u0} V mono`;
    return res.nph === 2 ? `${res.u0}/${res.u_ll} V` : `${res.u_ll}/${res.u0} V`;
  }
  function libelleAlimentation(poly, res = reseauActif()) {
    if (!poly || res.nph === 1) return res.nph === 2 ? `${res.u0} V phase-neutre` : `Monophasé ${res.u0} V`;
    return res.nph === 2 ? `${res.u_ll} V entre phases` : `Triphasé ${res.u_ll} V`;
  }

  // ---------------------------------------------------------------------------
  // Onglets
  // ---------------------------------------------------------------------------

  function ouvrirOnglet(nom, memoriser = true) {
    if (nom === "assistant" && !ETROIT.matches) nom = "resultats";
    const app = $("#app");
    app.dataset.onglet = nom;
    $$(".onglets button").forEach((b) => b.setAttribute("aria-selected", String(b.dataset.onglet === nom)));
    if (memoriser) try { localStorage.setItem(CLE_ONGLET, nom); } catch (e) { /* sans effet */ }
    if (nom === "resultats") rendreResultats();
    if (nom === "ligne") rendreLigneResultats();
  }

  // ---------------------------------------------------------------------------
  // En-tête
  // ---------------------------------------------------------------------------

  function statutHtml(niveau, texte) {
    const icone = { ok: "✓", attention: "!", nc: "✕", info: "i" }[niveau];
    return `<span class="statut statut-${niveau}"><i aria-hidden="true">${icone}</i>${echap(texte)}</span>`;
  }
  function rendreEntete() {
    $("#entete-nom").textContent = etat.projet.nom;
    $("#entete-systeme").innerHTML = `<i aria-hidden="true">≡</i>${echap(NOMS_SYSTEMES[etat.projet.systeme] || "Hybride")}`;
    $("#entete-norme").innerHTML = `<i aria-hidden="true">§</i>${echap(referentielActif().nom)} · ${echap(tensionCourte())}`;
    const compteur = $("#compteur-verifs");
    if (!etat.resultat && !etat.erreurs) { $("#entete-etat").innerHTML = ""; compteur.hidden = true; return; }
    if (etat.erreurs) {
      $("#entete-etat").innerHTML = statutHtml("nc", "Entrées à compléter");
      compteur.hidden = false; compteur.textContent = "!"; compteur.dataset.niveau = "nc";
      return;
    }
    const v = etat.resultat.synthese.verifications;
    if (v.non_conforme) {
      $("#entete-etat").innerHTML = statutHtml("nc", `${v.non_conforme} non-conformité${v.non_conforme > 1 ? "s" : ""}`);
      compteur.hidden = false; compteur.textContent = v.non_conforme; compteur.dataset.niveau = "nc";
    } else if (v.attention) {
      $("#entete-etat").innerHTML = statutHtml("attention", `${v.attention} point${v.attention > 1 ? "s" : ""} d'attention`);
      compteur.hidden = false; compteur.textContent = v.attention; compteur.dataset.niveau = "attention";
    } else {
      $("#entete-etat").innerHTML = statutHtml("ok", "Conforme");
      compteur.hidden = true;
    }
  }

  // ---------------------------------------------------------------------------
  // Formulaires génériques (data-chemin / data-type)
  // ---------------------------------------------------------------------------

  /** `famille` : « iec » ou « nec » (champ propre à une famille de normes) ; `systemes` : systèmes concernés. */
  function attributsVisibilite({ famille: fam, systemes }) {
    return `${fam ? ` data-famille="${fam}"` : ""}${systemes ? ` data-systemes="${systemes.join(" ")}"` : ""}`;
  }
  function champHtml({ chemin, libelle, unite = "", aide = "", type = "nombre", options = null, classe = "", famille: fam, systemes }) {
    const id = `f-${chemin.replace(/\./g, "-")}`;
    let controle;
    if (type === "bool") {
      return `<label class="case ${classe}"${attributsVisibilite({ famille: fam, systemes })}><input type="checkbox" id="${id}" data-chemin="${chemin}" data-type="bool"> ${echap(libelle)}</label>`;
    }
    if (type === "select") {
      controle = `<select id="${id}" data-chemin="${chemin}" data-type="texte">${options.map(([v, l]) => `<option value="${echap(v)}">${echap(l)}</option>`).join("")}</select>`;
    } else {
      const defaut = valeurParDefaut(chemin);
      const indication = defaut === null || defaut === undefined ? "auto" : type === "pct" ? fr(defaut * 100, 2) : fr(defaut, 4);
      controle = `<input id="${id}" class="${type === "texte" ? "" : "donnee"}" ${type === "texte" ? "" : 'inputmode="decimal"'} data-chemin="${chemin}" data-type="${type}" placeholder="${echap(indication)}" autocomplete="off">`;
    }
    return `<label class="champ ${classe}"${attributsVisibilite({ famille: fam, systemes })}><span>${echap(libelle)}${unite ? ` <span class="unite">${echap(unite)}</span>` : ""}</span>${controle}${aide ? `<small>${echap(aide)}</small>` : ""}</label>`;
  }
  /** Masque les champs et blocs qui ne concernent pas la famille de normes ou le système du projet. */
  function majVisibilite(racine = document) {
    const fam = famille();
    const sys = etat.projet.systeme;
    $$("[data-famille], [data-systemes]", racine).forEach((el) => {
      el.hidden = (el.dataset.famille && el.dataset.famille !== fam) || (el.dataset.systemes && !el.dataset.systemes.split(" ").includes(sys));
    });
    $("#bloc-source").hidden = sys !== "reseau";
    $$(".si-ligne", racine).forEach((el) => { el.hidden = !etat.projet.ligne.actif; });
    const transfo = (etat.projet.source || {}).type === "transfo";
    $$(".si-transfo", racine).forEach((el) => { el.hidden = !transfo; });
    $$(".si-public", racine).forEach((el) => { el.hidden = transfo; });
  }

  function remplirChamps(racine) {
    $$("[data-chemin]", racine).forEach((input) => {
      const chemin = input.dataset.chemin;
      const type = input.dataset.type;
      let v = lire(chemin);
      if (type === "bool") { input.checked = Boolean(v ?? valeurParDefaut(chemin)); return; }
      if (input.type === "radio") { input.checked = input.value === v; return; }
      if (v === undefined && input.tagName === "SELECT") v = valeurParDefaut(chemin);
      if (type === "plages") input.value = ecrirePlages(v);
      else if (type === "pct") input.value = v === null || v === undefined ? "" : versSaisie(Math.round(v * 10000) / 100);
      else if (type === "triphase") input.value = v ? "1" : "0";
      else if (input.tagName === "SELECT") input.value = v === null || v === undefined ? "" : String(v);
      else input.value = type === "texte" ? (v ?? "") : versSaisie(v);
      input.removeAttribute("aria-invalid");
    });
  }

  function surSaisie(evenement) {
    const input = evenement.target;
    if (!input.dataset || !input.dataset.chemin) return;
    const chemin = input.dataset.chemin;
    const type = input.dataset.type;
    let valeur;
    if (type === "bool") valeur = input.checked;
    else if (input.type === "radio") valeur = input.value;
    else if (type === "triphase") valeur = input.value === "1";
    else if (type === "texte") valeur = input.value;
    else if (type === "plages") {
      valeur = lirePlages(input.value);
      if (valeur === null) { input.setAttribute("aria-invalid", "true"); return; }
    } else {
      valeur = nombreSaisi(input.value);
      if (Number.isNaN(valeur)) { input.setAttribute("aria-invalid", "true"); return; }
      if (type === "pct" && valeur !== undefined) valeur = valeur / 100;
    }
    input.removeAttribute("aria-invalid");
    ecrire(chemin, valeur);
    if (chemin.endsWith(".moteur")) {
      const ligne = input.closest(".recepteur");
      if (ligne) $(".choix-demarrage", ligne).hidden = !valeur;
    }
    if (chemin === "referentiel") surChangementReferentiel();
    else if (chemin === "reseau") surChangementReseau();
    if (chemin === "systeme" || chemin === "source.type" || chemin === "ligne.actif") majVisibilite();
    if (chemin === "nom" || chemin === "systeme") rendreEntete();
    programmerCalcul();
  }

  // ---------------------------------------------------------------------------
  // Onglet Projet
  // ---------------------------------------------------------------------------

  const CHAMPS_SITE = [
    { chemin: "site.latitude", libelle: "Latitude", unite: "°" },
    { chemin: "site.longitude", libelle: "Longitude", unite: "°" },
    { chemin: "site.altitude_m", libelle: "Altitude", unite: "m" },
    { chemin: "site.t_amb_max", libelle: "Température maximale", unite: "°C", aide: "Câbles, onduleurs, modules à chaud." },
    { chemin: "site.t_amb_min", libelle: "Température minimale", unite: "°C", aide: "Tension à vide des modules au froid." },
    { chemin: "site.t_amb_jour", libelle: "Température moyenne de jour", unite: "°C" },
  ];
  const CHAMPS_SOURCE = [
    { chemin: "source.type", libelle: "Alimentation", type: "select", options: [["public", "Branchement BT"], ["transfo", "Poste privé (transformateur)"]] },
    { chemin: "source.s_transfo_kva", libelle: "Puissance du transformateur", unite: "kVA", aide: "Vide : choisie par le moteur.", classe: "si-transfo" },
    { chemin: "source.uk_pct", libelle: "Tension de court-circuit u_k", unite: "%", aide: "Vide : valeur usuelle selon la puissance.", classe: "si-transfo" },
    { chemin: "source.s_kq_mva", libelle: "Puissance de court-circuit amont", unite: "MVA", classe: "si-transfo" },
    { chemin: "source.icc_livraison_ka", libelle: "Icc maximal au point de livraison", unite: "kA", aide: "Donnée du distributeur.", classe: "si-public" },
    { chemin: "source.icc_min_ka", libelle: "Icc minimal au point de livraison", unite: "kA", aide: "Donnée du distributeur.", classe: "si-public" },
    { chemin: "source.longueur_m", libelle: "Câble source → tableau principal", unite: "m" },
    { chemin: "source.secours", libelle: "Groupe électrogène de secours", type: "bool" },
    { chemin: "source.part_secourue", libelle: "Part de l'installation secourue", unite: "%", type: "pct" },
    { chemin: "source.autonomie_h", libelle: "Autonomie de la cuve à pleine charge", unite: "h" },
  ];
  function construireNormes() {
    const refs = Object.values(M.REFERENTIELS).map((r) => [r.code, r.libelle]);
    $("#champs-normes").innerHTML = champHtml({ chemin: "referentiel", libelle: "Référentiel normatif", type: "select", options: refs })
      + `<label class="champ"><span>Réseau de distribution</span><select id="f-reseau" data-chemin="reseau" data-type="texte"></select></label>`;
    $("#champs-source").innerHTML = CHAMPS_SOURCE.map(champHtml).join("");
  }
  /** Liste des réseaux compatibles avec la famille de normes, et description du référentiel. */
  function remplirNormes() {
    const fam = famille();
    $("#f-reseau").innerHTML = Object.entries(M.RESEAUX).filter(([, r]) => r.famille === fam)
      .map(([cle, r]) => `<option value="${echap(cle)}">${echap(r.nom)}</option>`).join("");
    $("#f-reseau").value = etat.projet.reseau;
    $("#f-referentiel").value = etat.projet.referentiel;
    $("#description-norme").textContent = referentielActif().description;
  }
  function surChangementReferentiel() {
    if (reseauActif().famille !== famille()) etat.projet.reseau = M.normaliser({ referentiel: etat.projet.referentiel }).reseau;
    remplirNormes();
    surChangementReseau();
    majVisibilite();
  }
  function surChangementReseau() {
    let message = "";
    if (reseauActif().nph === 1) {
      const tri = etat.projet.circuits.filter((c) => c.triphase);
      tri.forEach((c) => { c.triphase = false; });
      if (tri.length) message = `${tri.length} circuit${tri.length > 1 ? "s" : ""} triphasé${tri.length > 1 ? "s" : ""} passé${tri.length > 1 ? "s" : ""} en monophasé : le réseau choisi est monophasé.`;
    }
    $("#message-reseau").textContent = message;
    rendreCharges();
    rendreEntete();
  }

  function construireProjet() {
    construireNormes();
    $("#champs-site").innerHTML = CHAMPS_SITE.map(champHtml).join("");
    $("#champs-ghi").innerHTML = M.MOIS.map((m, i) => `<label class="champ"><span>${m}</span><input class="donnee" inputmode="decimal" data-ghi="${i}" id="ghi-${i}" placeholder="—" autocomplete="off"></label>`).join("");
    $$("#systemes input").forEach((r) => { r.dataset.chemin = "systeme"; });
  }
  function remplirGhi() {
    const g = etat.projet.site.ghi_mensuel;
    $$("[data-ghi]").forEach((input) => {
      input.value = Array.isArray(g) && g[input.dataset.ghi] !== null && g[input.dataset.ghi] !== undefined ? versSaisie(g[input.dataset.ghi]) : "";
    });
  }
  function surSaisieGhi() {
    const valeurs = $$("[data-ghi]").map((i) => nombreSaisi(i.value));
    etat.projet.site.ghi_mensuel = valeurs.every((v) => v === undefined) ? null : valeurs.map((v) => (v === undefined ? null : v));
    programmerCalcul();
  }

  // ---------------------------------------------------------------------------
  // Onglet Charges
  // ---------------------------------------------------------------------------

  const OPTIONS_DEMARRAGE = Object.entries(M.MODES_DEMARRAGE).map(([cle, m]) => `<option value="${cle}">${m.libelle[0].toUpperCase()}${m.libelle.slice(1)}</option>`).join("");

  function recepteurHtml(i, j) {
    const b = `circuits.${i}.recepteurs.${j}`;
    return `<div class="recepteur" data-recepteur="${j}">
      <label class="champ r-nom"><span>Appareil</span><input list="bibliotheque" data-chemin="${b}.nom" data-type="texte" data-bibliotheque="${i}.${j}" autocomplete="off"></label>
      <label class="champ r-qte"><span>Qté</span><input class="donnee" inputmode="decimal" data-chemin="${b}.quantite" data-type="nombre"></label>
      <label class="champ r-p"><span>P unitaire <span class="unite">W</span></span><input class="donnee" inputmode="decimal" data-chemin="${b}.puissance_w" data-type="nombre"></label>
      <label class="champ r-cos"><span>cos φ</span><input class="donnee" inputmode="decimal" data-chemin="${b}.cos_phi" data-type="nombre"></label>
      <label class="champ r-eta"><span>Rendement</span><input class="donnee" inputmode="decimal" data-chemin="${b}.rendement" data-type="nombre" placeholder="1"></label>
      <label class="champ r-ku"><span>ku</span><input class="donnee" inputmode="decimal" data-chemin="${b}.ku" data-type="nombre" placeholder="1"></label>
      <label class="champ r-plages"><span>Plages horaires</span><input class="donnee" data-chemin="${b}.plages" data-type="plages" placeholder="8-17 60%; 18-23" autocomplete="off"></label>
      <button type="button" class="btn btn-discret btn-danger r-suppr" data-action="supprimer-recepteur" data-i="${i}" data-j="${j}" aria-label="Supprimer ce récepteur">✕</button>
      <div class="recepteur-moteur">
        <label class="case"><input type="checkbox" data-chemin="${b}.moteur" data-type="bool"> Moteur (P = puissance utile)</label>
        <label class="case choix-demarrage"><span class="discret">Démarrage</span><select data-chemin="${b}.demarrage" data-type="texte">${OPTIONS_DEMARRAGE}</select></label>
        <label class="case" title="LED, informatique, variateurs, onduleurs : courants harmoniques"><input type="checkbox" data-chemin="${b}.non_lineaire" data-type="bool"> Non linéaire (électronique)</label>
      </div>
    </div>`;
  }
  function circuitHtml(c, i) {
    const b = `circuits.${i}`;
    const res = reseauActif();
    const alimentation = `<option value="0">${echap(libelleAlimentation(false, res))}</option>${res.nph > 1 ? `<option value="1">${echap(libelleAlimentation(true, res))}</option>` : ""}`;
    return `<article class="circuit" data-circuit="${i}">
      <div class="circuit-tete">
        <input class="nom-circuit" data-chemin="${b}.nom" data-type="texte" aria-label="Nom du circuit" autocomplete="off">
        <select data-chemin="${b}.triphase" data-type="triphase" aria-label="Alimentation">${alimentation}</select>
        <span class="rangee"><button type="button" class="btn btn-discret" data-action="dupliquer-circuit" data-i="${i}">Dupliquer</button>
        <button type="button" class="btn btn-discret btn-danger" data-action="supprimer-circuit" data-i="${i}">Supprimer</button></span>
      </div>
      <div class="circuit-corps">
        <div class="circuit-params">
          ${champHtml({ chemin: `${b}.longueur_m`, libelle: "Longueur", unite: "m" })}
          ${champHtml({ chemin: `${b}.ks`, libelle: "Simultanéité ks" })}
          <label class="case"><input type="checkbox" data-chemin="${b}.eclairage" data-type="bool"> Circuit d'éclairage</label>
          <details class="avance"><summary>Options</summary><div class="circuit-params">
            ${champHtml({ chemin: `${b}.calibre_min`, libelle: "Calibre mini", unite: "A" })}
            ${champHtml({ chemin: `${b}.section_min`, libelle: "Section mini", unite: "mm²", famille: "iec" })}
            ${champHtml({ chemin: `${b}.courbe`, libelle: "Courbe", type: "select", options: [["", "Automatique"], ["B", "B"], ["C", "C"], ["D", "D"]], famille: "iec" })}
          </div></details>
        </div>
        <div class="circuit-chiffres" data-chiffres="${i}"></div>
        ${(c.recepteurs || []).map((r, j) => recepteurHtml(i, j)).join("")}
        <div><button type="button" class="btn" data-action="ajouter-recepteur" data-i="${i}">Ajouter un récepteur</button></div>
      </div>
    </article>`;
  }
  function rendreCharges() {
    const liste = $("#liste-circuits");
    const annuler = etat.supprime
      ? `<div class="bandeau bandeau-info"><span>Circuit « ${echap(etat.supprime.circuit.nom)} » supprimé.</span><button type="button" class="btn" data-action="restaurer-circuit">Annuler la suppression</button></div>`
      : "";
    liste.innerHTML = annuler + (etat.projet.circuits.length
      ? etat.projet.circuits.map(circuitHtml).join("")
      : `<div class="bloc"><p>Aucun circuit pour l'instant. Ajoutez un circuit, ou décrivez l'installation à l'assistant.</p></div>`);
    remplirChamps(liste);
    majVisibilite(liste);
    $$(".recepteur", liste).forEach((ligne) => {
      const moteur = $('[data-type="bool"][data-chemin$=".moteur"]', ligne);
      $(".choix-demarrage", ligne).hidden = !moteur.checked;
    });
    majChiffresCircuits();
  }
  function majChiffresCircuits() {
    const total = $("#resume-charges");
    const res = etat.resultat;
    if (!res) {
      total.innerHTML = `<span>${etat.projet.circuits.length} circuit(s)</span><span>Calcul en attente d'entrées valides</span>`;
      return;
    }
    const b = res.bilan;
    total.innerHTML = `<span>${b.lignes.length} circuits</span><span>Consommation <b>${fr(b.energie_wh_j / 1000)} kWh/j</b></span>`
      + `<span>Puissance de dimensionnement <b>${fr(b.s_dim_va / 1000, 2)} kVA</b></span><span>cos φ <b>${fr(b.cos_phi, 2)}</b></span>`;
    b.lignes.forEach((l, i) => {
      const zone = $(`[data-chiffres="${i}"]`);
      if (!zone) return;
      const cable = res.cables.find((c) => c.liaison === l.circuit.nom);
      zone.innerHTML = `${phaseHtml(etiquettePhase(l, res))}<span>P <b>${fr(l.p_w / 1000, 2)} kW</b></span><span>I<sub>B</sub> <b>${fr(l.i_b_a, 1)} A</b></span>`
        + `<span><b>${fr(l.energie_wh_j / 1000, 2)} kWh/j</b></span>`
        + (cable ? `<span>${echap(cable.protection)} · <b>${echap(cable.section)}</b> · ΔU <b>${fr(cable.chute_cumulee_pct, 2)} %</b></span>` : "");
    });
  }
  /** Phase d'un circuit selon le réseau du calcul : « 3~ », « L1-L2 » (entre phases en 120/240 V) ou « L1 ». */
  function etiquettePhase(l, res) {
    const nph = M.RESEAUX[res.projet.reseau].nph;
    if (l.circuit.triphase && nph === 3) return "3~";
    if (l.circuit.triphase && nph === 2) return "L1-L2";
    return `L${l.phase + 1}`;
  }
  function phaseHtml(ph) {
    const poly = ph === "3~" || ph === "L1-L2";
    return `<span class="phase ${poly ? "phase-tri" : `phase-${ph}`}" title="${ph === "3~" ? "Triphasé" : ph === "L1-L2" ? "Entre phases" : `Phase ${ph}`}">${ph}</span>`;
  }
  function surActionCharges(e) {
    const bouton = e.target.closest("[data-action]");
    if (!bouton) return;
    const i = Number(bouton.dataset.i);
    const circuits = etat.projet.circuits;
    switch (bouton.dataset.action) {
      case "ajouter-recepteur":
        circuits[i].recepteurs.push({ nom: "", quantite: 1, puissance_w: 100, cos_phi: 0.9, plages: [[18, 23, 1]] });
        break;
      case "supprimer-recepteur":
        circuits[i].recepteurs.splice(Number(bouton.dataset.j), 1);
        break;
      case "dupliquer-circuit": {
        const copie = cloner(circuits[i]);
        copie.nom = `${copie.nom} (copie)`;
        circuits.splice(i + 1, 0, copie);
        break;
      }
      case "supprimer-circuit":
        etat.supprime = { index: i, circuit: circuits.splice(i, 1)[0] };
        break;
      case "restaurer-circuit":
        circuits.splice(etat.supprime.index, 0, etat.supprime.circuit);
        etat.supprime = null;
        break;
      default:
        return;
    }
    if (bouton.dataset.action !== "supprimer-circuit") etat.supprime = null;
    rendreCharges();
    programmerCalcul();
  }
  function ajouterCircuit() {
    const n = etat.projet.circuits.length + 1;
    etat.projet.circuits.push({ nom: `C${n} Nouveau circuit`, longueur_m: 25, recepteurs: [{ nom: "", quantite: 1, puissance_w: 100, cos_phi: 0.9, plages: [[18, 23, 1]] }] });
    etat.supprime = null;
    rendreCharges();
    programmerCalcul();
    const dernier = $$(".circuit").pop();
    if (dernier) { dernier.scrollIntoView({ block: "center" }); $(".nom-circuit", dernier).select(); }
  }
  function surChoixBibliotheque(input) {
    const appareil = BIBLIOTHEQUE.find((a) => a.nom === input.value);
    if (!appareil) return;
    const [i, j] = input.dataset.bibliotheque.split(".").map(Number);
    const r = etat.projet.circuits[i].recepteurs[j];
    Object.assign(r, cloner({ ...appareil, quantite: r.quantite || 1 }));
    rendreCharges();
    programmerCalcul();
  }

  // ---------------------------------------------------------------------------
  // Onglet Choix techniques
  // ---------------------------------------------------------------------------

  const n = (chemin, libelle, unite = "", aide = "", type = "nombre", extra = {}) => ({ chemin, libelle, unite, aide, type, ...extra });
  const AVEC_STOCKAGE = ["hybride", "solaire"];
  const AVEC_GROUPE = ["hybride", "groupe", "reseau"];
  const CHOIX = [
    { titre: "Batteries", systemes: AVEC_STOCKAGE, aide: "Le parc est dimensionné sur la consommation journalière, l'autonomie, la profondeur de décharge et le vieillissement.", champs: [
      { chemin: "hypotheses.chimie", libelle: "Technologie", type: "select", options: [["lifepo4", "Lithium LiFePO4"], ["plomb", "Plomb OPzV / GEL"]] },
      n("hypotheses.jours_autonomie", "Jours d'autonomie", "j", "Hybride : 0,5 à 1,5 j. Solaire seul : 2 à 5 j."),
      n("hypotheses.t_batterie_min", "Température mini du local", "°C"),
      n("hypotheses.longueur_batterie_m", "Câble batterie → onduleur", "m"),
    ] },
    { titre: "Onduleur / chargeur", systemes: AVEC_STOCKAGE, champs: [
      n("hypotheses.k_temp_onduleur", "Puissance continue à 40 °C", "% de Sn", "Fiche constructeur (souvent 65 à 85 %).", "pct"),
      n("hypotheses.rendement_onduleur", "Rendement onduleur", "%", "", "pct"),
      n("hypotheses.rendement_chargeur", "Rendement chargeur", "%", "", "pct"),
      n("hypotheses.surcharge_onduleur", "Surcharge admise quelques secondes", "× Sn"),
      n("hypotheses.k_cc_onduleur", "Courant de court-circuit", "× In", "Fiche constructeur."),
      n("hypotheses.heures_recharge_cible", "Durée de recharge visée sur groupe", "h"),
      n("hypotheses.longueur_onduleur_tgbt_m", "Câble onduleur → TGBT", "m"),
    ] },
    { titre: "Groupe électrogène", systemes: AVEC_GROUPE, champs: [
      n("site.t_local_ge", "Température du local groupe", "°C"),
      n("hypotheses.chute_tension_max", "Chute de tension admise au démarrage", "%", "ISO 8528-5 : 20 % (G2), 15 % (G3).", "pct"),
      n("hypotheses.xd_transitoire", "Réactance transitoire x'd", "p.u."),
      n("hypotheses.xd_subtransitoire", "Réactance subtransitoire x''d", "p.u."),
      n("hypotheses.k_cc_maintenu_ge", "Court-circuit maintenu", "× In", "≈ 3 avec excitation AREP ou PMG."),
      n("hypotheses.temperature_sans_declassement", "Température sans déclassement", "°C"),
      n("hypotheses.declassement_temp_pct_degc", "Déclassement au-delà", "%/°C"),
      n("hypotheses.altitude_sans_declassement", "Altitude sans déclassement", "m"),
      n("hypotheses.declassement_altitude_pct_100m", "Déclassement au-delà", "%/100 m"),
      n("hypotheses.taux_charge_cible_ge", "Charge visée pendant la recharge", "%", "ISO 8528-1 : moyenne ≤ 70 % en PRP.", "pct"),
      n("hypotheses.conso_a", "Consommation proportionnelle", "L/kWh"),
      n("hypotheses.conso_b", "Consommation à vide", "L/h par kW"),
      n("hypotheses.longueur_ge_m", "Câble groupe", "m"),
    ] },
    { titre: "Champ solaire", systemes: AVEC_STOCKAGE, champs: [
      n("hypotheses.inclinaison_deg", "Inclinaison imposée", "°", "Vide : optimisée pour le mois le plus défavorable."),
      n("site.albedo", "Albédo du sol"),
      n("hypotheses.pertes_encrassement", "Pertes par encrassement", "%", "", "pct"),
      n("hypotheses.pertes_dispersion", "Pertes de dispersion", "%", "", "pct"),
      n("hypotheses.pertes_cables_dc", "Pertes câbles continu", "%", "", "pct"),
      n("hypotheses.rendement_mppt", "Rendement MPPT", "%", "", "pct"),
      n("hypotheses.degradation_annuelle", "Dégradation des modules", "%/an", "", "pct"),
      n("hypotheses.annees_conception", "Horizon de conception", "ans"),
      n("hypotheses.couverture_mois_critique", "Couverture du mois critique", "%", "", "pct"),
      n("hypotheses.ratio_pv_mppt_max", "Rapport Pc / P régulateur maxi"),
      n("hypotheses.longueur_chaine_m", "Câble de chaîne", "m"),
      n("hypotheses.t_cable_pv", "Température des câbles PV", "°C"),
    ], sous: [
      { titre: "Module photovoltaïque (fiche constructeur)", champs: [
        n("module.nom", "Désignation", "", "", "texte"), n("module.p_wc", "Puissance crête", "Wc"), n("module.vmp", "Vmp", "V"), n("module.imp", "Imp", "A"),
        n("module.voc", "Voc", "V"), n("module.isc", "Isc", "A"), n("module.coef_p", "Coefficient Pmax", "%/°C"), n("module.coef_voc", "Coefficient Voc", "%/°C"),
        n("module.coef_isc", "Coefficient Isc", "%/°C"), n("module.noct", "NOCT", "°C"), n("module.i_inverse_max", "Courant inverse admissible", "A"),
      ] },
      { titre: "Régulateur MPPT (fiche constructeur)", champs: [
        n("mppt.nom", "Désignation", "", "", "texte"), n("mppt.v_dc_max", "Tension PV maxi", "V"), n("mppt.v_mppt_min", "Plage MPPT mini", "V"),
        n("mppt.v_mppt_max", "Plage MPPT maxi", "V"), n("mppt.isc_max", "Isc maxi par entrée", "A"), n("mppt.i_charge_max", "Courant de charge maxi", "A"),
      ] },
    ] },
    { titre: "Distribution et câbles", champs: [
      n("hypotheses.k_extension", "Coefficient d'extension ke", "", "Réserve sur la pointe, souvent 1,1 à 1,3."),
      { chemin: "hypotheses.methode_pose", libelle: "Mode de pose des circuits", type: "select", famille: "iec",
        options: Object.entries(M.METHODES_POSE).map(([cle, m]) => [cle, m.nom]), aide: "Méthode de référence IEC 60364-5-52 ; groupement selon le nombre de circuits." },
      n("hypotheses.conducteurs_par_conduit", "Conducteurs actifs par conduit", "", "Ajustement NEC 310.15(C)(1) au-delà de 3.", "nombre", { famille: "nec" }),
      { chemin: "hypotheses.bornes_75c", libelle: "Température des bornes", type: "select", famille: "nec",
        options: [["1", "75 °C (bornes ≥ 100 A ou marquées 75 °C)"], ["0", "60 °C (110.14(C)(1)(a))"]] },
      n("hypotheses.chute_max_eclairage", "ΔU maxi éclairage", "%", "Vide : 3 % (6 % depuis un poste privé).", "nombre", { famille: "iec" }),
      n("hypotheses.chute_max_autres", "ΔU maxi autres usages", "%", "Vide : 5 % (8 % depuis un poste privé).", "nombre", { famille: "iec" }),
      n("hypotheses.chute_max_dc", "ΔU maxi batterie", "%", "", "nombre", { systemes: AVEC_STOCKAGE }),
      n("hypotheses.chute_max_pv", "ΔU maxi chaînes PV", "%", "", "nombre", { systemes: AVEC_STOCKAGE }),
    ] },
    { titre: "Compensation de l'énergie réactive", aide: "Batterie de condensateurs calculée pour atteindre le cos φ visé (module D).", champs: [
      n("hypotheses.cos_phi_cible", "cos φ visé", "", "Vide : 0,928 (tan φ 0,4) en NF C 15-100, 0,95 sinon."),
    ] },
    { titre: "Simulation", systemes: AVEC_STOCKAGE, aide: "Une année de 365 jours est simulée heure par heure avec une météo journalière variable.", champs: [
      n("hypotheses.kt_defaut", "Indice de clarté forfaitaire", "", "Utilisé seulement sans irradiations mensuelles."),
      n("hypotheses.variabilite_journaliere", "Variabilité journalière", "%", "", "pct"),
      n("hypotheses.autocorrelation_journaliere", "Persistance des jours nuageux"),
      n("hypotheses.jours_stress", "Test : jours sans soleil", "j"),
      n("hypotheses.facteur_meteo_stress", "Ensoleillement pendant le test", "%", "", "pct"),
      n("hypotheses.objectif_llp", "Délestage admis (solaire seul)", "%", "", "pct"),
    ] },
  ];
  function construireChoix() {
    const bloc = (g) => `<div class="bloc"${attributsVisibilite(g)}><div class="bloc-titre"><h2>${echap(g.titre)}</h2>${g.aide ? `<span class="discret">${echap(g.aide)}</span>` : ""}</div>
      <div class="grille-champs">${g.champs.map(champHtml).join("")}</div>
      ${(g.sous || []).map((s) => `<h3>${echap(s.titre)}</h3><div class="grille-champs">${s.champs.map(champHtml).join("")}</div>`).join("")}</div>`;
    $("#choix").innerHTML = `<div class="bloc"><div class="bloc-titre"><h2>Choix techniques</h2>
      <button type="button" class="btn" id="btn-defauts">Revenir aux valeurs par défaut</button></div>
      <p class="discret">Chaque valeur grisée est la valeur par défaut. Une case vidée reprend sa valeur par défaut.</p></div>`
      + CHOIX.map(bloc).join("");
  }

  function rendreFormulaires() {
    remplirNormes();
    remplirChamps($('[data-panneau="projet"]'));
    remplirGhi();
    remplirChamps($("#choix"));
    rendreLigneSaisie();
    rendreCharges();
    majVisibilite();
    rendreEntete();
  }

  // ---------------------------------------------------------------------------
  // Graphiques (SVG)
  // ---------------------------------------------------------------------------

  /** Largeur de dessin = largeur réelle disponible, pour garder des textes lisibles sur téléphone. */
  function largeurGraphique(zone = $("#resultats")) {
    return Math.max(300, Math.min(760, (zone ? zone.clientWidth : 640) - 38));
  }
  function pasJoli(max, cible = 4) {
    if (!(max > 0)) return 1;
    const brut = max / cible;
    const p = 10 ** Math.floor(Math.log10(brut));
    for (const m of [1, 2, 2.5, 5, 10]) if (m * p >= brut) return m * p;
    return 10 * p;
  }
  function bulle(conteneur, x, contenu) {
    let b = $(".bulle-info", conteneur);
    if (!b) { b = document.createElement("div"); b.className = "bulle-info"; conteneur.appendChild(b); }
    b.innerHTML = contenu;
    b.hidden = false;
    const largeur = conteneur.clientWidth;
    let gauche = x + 14;
    if (gauche + b.offsetWidth > largeur) gauche = Math.max(0, x - b.offsetWidth - 14);
    b.style.left = `${gauche}px`;
    b.style.top = "8px";
  }
  function cacherBulle(conteneur) { const b = $(".bulle-info", conteneur); if (b) b.hidden = true; }
  function ligneBulle(libelle, valeur) { return `<div><span>${echap(libelle)}</span><span>${valeur}</span></div>`; }

  /** Graphique horaire : aires, lignes, barres et repères sur un même axe en kW. */
  function graphiqueHoraire({ titreAxe, series, reperes = [], survol, hauteur = 230 }) {
    const L = largeurGraphique(); const H = hauteur; const g = 46; const d = 12; const h = 28; const b = 26;
    const max = Math.max(...series.flatMap((s) => s.valeurs), ...reperes.map((r) => r.valeur), 0.1);
    const pas = pasJoli(max);
    const yMax = Math.ceil(max / pas) * pas;
    const xs = (i) => g + ((i + 0.5) * (L - g - d)) / 24;
    const ys = (v) => H - b - (v / yMax) * (H - b - h);
    const largeurCol = (L - g - d) / 24;
    let svg = `<svg viewBox="0 0 ${L} ${H}" role="img" aria-label="${echap(titreAxe)}">`;
    for (let v = 0; v <= yMax + 1e-9; v += pas) {
      svg += `<line x1="${g}" x2="${L - d}" y1="${ys(v)}" y2="${ys(v)}" style="stroke:var(--grille)" stroke-width="1"/>`
        + `<text class="axe-texte" x="${g - 6}" y="${ys(v) + 4}" text-anchor="end">${fr(v, 2)}</text>`;
    }
    svg += `<line x1="${g}" x2="${L - d}" y1="${ys(0)}" y2="${ys(0)}" style="stroke:var(--axe)" stroke-width="1"/>`;
    const pasHeures = L < 420 ? 6 : 3;
    for (let i = 0; i < 24; i += pasHeures) svg += `<text class="axe-texte" x="${xs(i)}" y="${H - 8}" text-anchor="middle">${i} h</text>`;
    svg += `<text class="axe-texte" x="${g - 6}" y="12" text-anchor="end">${echap(titreAxe)}</text>`;
    for (const s of series.filter((x) => x.type === "barres")) {
      const largeur = largeurCol * (s.largeur || 0.56);
      s.valeurs.forEach((v, i) => {
        if (v <= 0) return;
        const y = ys(v); const hb = ys(0) - y;
        const r = Math.min(3, hb / 2, largeur / 2);
        const x0 = xs(i) - largeur / 2;
        svg += `<path d="M${x0},${ys(0)} V${y + r} Q${x0},${y} ${x0 + r},${y} H${x0 + largeur - r} Q${x0 + largeur},${y} ${x0 + largeur},${y + r} V${ys(0)} Z" style="fill:${s.couleur}"/>`;
      });
    }
    for (const s of series.filter((x) => x.type === "aire")) {
      const pts = s.valeurs.map((v, i) => `${xs(i)},${ys(v)}`).join(" L");
      svg += `<path d="M${xs(0)},${ys(0)} L${pts} L${xs(23)},${ys(0)} Z" style="fill:${s.couleur}" fill-opacity="0.18"/>`
        + `<path d="M${pts}" fill="none" style="stroke:${s.couleur}" stroke-width="2" stroke-linejoin="round"/>`;
    }
    for (const s of series.filter((x) => x.type === "ligne")) {
      svg += `<path d="M${s.valeurs.map((v, i) => `${xs(i)},${ys(v)}`).join(" L")}" fill="none" style="stroke:${s.couleur}" stroke-width="2" stroke-linejoin="round" ${s.pointilles ? 'stroke-dasharray="5 4"' : ""}/>`;
    }
    for (const r of reperes) {
      svg += `<line x1="${g}" x2="${L - d}" y1="${ys(r.valeur)}" y2="${ys(r.valeur)}" style="stroke:var(--ink-2)" stroke-width="1.2" stroke-dasharray="${r.tirets || "6 4"}"/>`
        + `<text class="ref-texte" x="${L - d}" y="${ys(r.valeur) - 5}" text-anchor="end">${echap(r.libelle)}</text>`;
    }
    for (let i = 0; i < 24; i++) {
      svg += `<rect data-i="${i}" x="${g + i * largeurCol}" y="${h}" width="${largeurCol}" height="${H - b - h}" fill="transparent"/>`;
    }
    svg += "</svg>";
    const conteneur = html(`<div class="graphique">${svg}</div>`);
    brancherSurvol(conteneur, survol);
    return conteneur;
  }

  function brancherSurvol(conteneur, survol) {
    if (!survol) return;
    conteneur.addEventListener("pointermove", (e) => {
      const cible = e.target.closest("rect[data-i]");
      if (!cible) return cacherBulle(conteneur);
      const boite = conteneur.getBoundingClientRect();
      bulle(conteneur, e.clientX - boite.left, survol(Number(cible.dataset.i)));
    });
    conteneur.addEventListener("pointerleave", () => cacherBulle(conteneur));
  }

  function graphiqueMensuel(mensuel, series) {
    const L = largeurGraphique(); const H = 240; const g = 52; const d = 12; const h = 28; const b = 26;
    const max = Math.max(...mensuel.flatMap((m) => series.map((s) => m[s.cle])), 1);
    const pas = pasJoli(max);
    const yMax = Math.ceil(max / pas) * pas;
    const ys = (v) => H - b - (v / yMax) * (H - b - h);
    const col = (L - g - d) / 12;
    const larg = Math.min(14, (col * 0.78 - (series.length - 1) * 2) / series.length);
    let svg = `<svg viewBox="0 0 ${L} ${H}" role="img" aria-label="Bilan mensuel en kWh">`;
    for (let v = 0; v <= yMax + 1e-9; v += pas) {
      svg += `<line x1="${g}" x2="${L - d}" y1="${ys(v)}" y2="${ys(v)}" style="stroke:var(--grille)"/>`
        + `<text class="axe-texte" x="${g - 6}" y="${ys(v) + 4}" text-anchor="end">${fr(v, 0)}</text>`;
    }
    svg += `<line x1="${g}" x2="${L - d}" y1="${ys(0)}" y2="${ys(0)}" style="stroke:var(--axe)"/>`;
    svg += `<text class="axe-texte" x="${g - 6}" y="12" text-anchor="end">kWh</text>`;
    mensuel.forEach((m, i) => {
      const x0 = g + i * col + (col - (series.length * larg + (series.length - 1) * 2)) / 2;
      series.forEach((s, k) => {
        const v = m[s.cle];
        if (v <= 0) return;
        const y = ys(v); const hb = ys(0) - y; const r = Math.min(3, hb / 2, larg / 2); const x = x0 + k * (larg + 2);
        svg += `<path d="M${x},${ys(0)} V${y + r} Q${x},${y} ${x + r},${y} H${x + larg - r} Q${x + larg},${y} ${x + larg},${y + r} V${ys(0)} Z" style="fill:${s.couleur}"/>`;
      });
      svg += `<text class="axe-texte" x="${g + i * col + col / 2}" y="${H - 8}" text-anchor="middle">${col < 34 ? m.mois[0] : m.mois}</text>`;
      svg += `<rect data-i="${i}" x="${g + i * col}" y="${h}" width="${col}" height="${H - b - h}" fill="transparent"/>`;
    });
    svg += "</svg>";
    const conteneur = html(`<div class="graphique">${svg}</div>`);
    brancherSurvol(conteneur, (i) => `<b>${mensuel[i].mois}</b>${series.map((s) => ligneBulle(s.libelle, `${fr(mensuel[i][s.cle], 0)} kWh`)).join("")}`);
    return conteneur;
  }

  function legende(series) {
    return `<div class="legende">${series.map((s) => `<span><i class="${s.type === "barres" ? "carre" : ""}" style="background:${s.couleur}"></i>${echap(s.libelle)}</span>`).join("")}</div>`;
  }

  // ---------------------------------------------------------------------------
  // Onglet Résultats
  // ---------------------------------------------------------------------------

  function tuile(etiquette, valeur, unite, detail) {
    return `<div class="tuile"><span class="etiquette">${echap(etiquette)}</span><span class="tuile-valeur">${valeur}<small>${echap(unite)}</small></span><span class="tuile-detail">${echap(detail)}</span></div>`;
  }
  function verifsHtml(liste) {
    const classe = { "NON CONFORME": "nc", ATTENTION: "attention", OK: "ok", INFO: "info" };
    const libelle = { "NON CONFORME": "Non conforme", ATTENTION: "Attention", OK: "Conforme", INFO: "Information" };
    return `<ul class="verifs">${liste.map((v) => `<li>${statutHtml(classe[v.statut], libelle[v.statut])}<span>${echap(v.message)}${v.n ? ` <span class="ref">[R${v.n}]</span>` : ""}</span></li>`).join("")}</ul>`;
  }

  function rendreResultats() {
    const zone = $("#resultats");
    if (!etat.resultat && !etat.erreurs) return;
    if ($("#app").dataset.onglet !== "resultats" && zone.childElementCount) return;
    if (etat.erreurs) {
      zone.innerHTML = `<div class="bandeau bandeau-nc"><div><strong>Le calcul attend des entrées valides.</strong><ul>${etat.erreurs.map((e) => `<li>${echap(e)}</li>`).join("")}</ul></div></div>`;
      return;
    }
    const r = etat.resultat;
    const s = r.synthese;
    zone.innerHTML = "";
    const tuiles = [tuile("Consommation", fr(s.energie_kwh_j), "kWh/j", `Pointe ${fr(s.s_dim_kva, 1)} kVA · cos φ ${fr(s.cos_phi, 2)}`)];
    if (s.pv) tuiles.push(tuile("Panneaux solaires", fr(s.pv.kwc, 2), "kWc", `${s.pv.n_modules} modules · ${s.pv.n_mppt} régulateur(s) · ${s.pv.inclinaison}°`));
    if (s.batteries) tuiles.push(tuile("Batteries", fr(s.batteries.kwh, 1), "kWh", s.batteries.designation));
    if (s.onduleur) tuiles.push(tuile("Onduleurs/chargeurs", fr(s.onduleur.kva, 0), "kVA", `${s.onduleur.designation} · ${s.onduleur.u_bus} V DC`));
    if (s.groupe) tuiles.push(tuile("Groupe électrogène", fr(s.groupe.kva, 0), "kVA", `Critère : ${s.groupe.critere}`));
    if (s.simulation && s.groupe) {
      tuiles.push(tuile("Gasoil", fr(s.simulation.carburant_l_an, 0), "L/an", `${fr(s.simulation.heures_ge, 0)} h de marche par an`));
      tuiles.push(tuile("Énergie renouvelable", fr(s.simulation.fraction_renouvelable * 100, 0), "%", "Part de la consommation servie sans le groupe"));
    }
    if (s.simulation && !s.groupe) tuiles.push(tuile("Délestage", fr(s.simulation.llp * 100, 2), "%", `${fr(s.simulation.non_servie_kwh, 0)} kWh non servis par an`));
    if (s.exploitation && s.systeme === "groupe") {
      tuiles.push(tuile("Gasoil", fr(s.exploitation.carburant_l_an, 0), "L/an", `${s.exploitation.heures_jour} h de marche par jour`));
      tuiles.push(tuile("Charge moyenne du groupe", fr(s.exploitation.taux_moyen * 100, 0), "%", "Conseillé : au moins 30 %"));
    }
    if (s.source) {
      tuiles.push(s.source.type === "transfo"
        ? tuile("Transformateur", fr(s.source.s_kva, 1), "kVA", `Icc ${fr(s.source.icc_max_ka, 1)} kA aux bornes BT`)
        : tuile("Énergie du réseau", fr(s.exploitation.energie_kwh_an, 0), "kWh/an", `Puissance à souscrire ${fr(s.s_dim_kva, 1)} kVA`));
    }
    if (s.compensation.necessaire && s.compensation.q_kvar) {
      tuiles.push(tuile("Compensation", fr(s.compensation.q_kvar, 1), "kvar", `cos φ ${fr(s.compensation.cos_initial, 2)} → ${fr(s.compensation.cos_cible, 3)}`));
    }
    if (s.ligne) tuiles.push(tuile("Ligne aérienne", fr(s.ligne.longueur_m, 0), "m", `${s.ligne.supports} supports · ΔU ${fr(s.ligne.chute_pct, 2)} %`));
    const nonOk = r.verifications.filter((v) => v.statut === "NON CONFORME" || v.statut === "ATTENTION");
    const ok = r.verifications.filter((v) => v.statut === "OK");
    const infos = r.verifications.filter((v) => v.statut === "INFO");
    zone.append(html(`<div class="bloc">
      <div class="bloc-titre"><h2>Synthèse</h2><span class="discret">${echap(s.systeme_libelle)} · ${echap(s.referentiel)} · ${echap(s.reseau)} · moteur v${echap(r.version)}</span></div>
      <div class="tuiles">${tuiles.join("")}</div></div>`));
    zone.append(html(`<div class="bloc">
      <div class="bloc-titre"><h2>Vérifications</h2><span class="rangee">${statutHtml("nc", `${s.verifications.non_conforme} non conforme`)}${statutHtml("attention", `${s.verifications.attention} attention`)}${statutHtml("ok", `${s.verifications.ok} conformes`)}</span></div>
      ${nonOk.length ? verifsHtml(nonOk) : "<p>Aucune non-conformité ni point d'attention.</p>"}
      <details class="avance"><summary>Voir les ${ok.length} vérifications conformes et ${infos.length} informations</summary>${verifsHtml([...ok, ...infos])}</details></div>`));

    if (r.simulation) zone.append(blocSimulation(r));
    if (s.systeme === "groupe") zone.append(blocGroupeSeul(r));
    if (r.source) zone.append(blocSource(r));
    zone.append(blocComparaison());
    zone.append(blocBilan(r));
    zone.append(blocCables(r));
    zone.append(blocCompensation(r));
    if (r.ligne) zone.append(blocLigneResume(r));
    if (r.gisement) zone.append(blocGisement(r));
  }

  function blocSimulation(r) {
    const couleur = (v) => `var(${v})`;
    const jour = r.simulation.annuel.jour_publie;
    const avecGe = Boolean(r.groupe);
    const series = [
      { libelle: "Production solaire disponible", type: "aire", couleur: couleur("--serie-pv"), valeurs: jour.heures.map((x) => x.pv) },
      { libelle: "Consommation", type: "ligne", couleur: couleur("--serie-conso"), valeurs: jour.heures.map((x) => x.charge) },
    ];
    if (avecGe) series.unshift({ libelle: "Groupe électrogène", type: "barres", couleur: couleur("--serie-ge"), valeurs: jour.heures.map((x) => x.ge) });
    const bloc = html(`<div class="bloc"><div class="bloc-titre"><h2>Journée simulée</h2>
      <span class="discret">Jour ${jour.jour} (${echap(jour.mois)}) : ${avecGe ? "jour où le groupe a le plus tourné" : "jour le moins ensoleillé du mois critique"}, ensoleillement × ${fr(jour.facteur_meteo, 2)}</span></div>
      ${legende(series)}</div>`);
    bloc.append(graphiqueHoraire({ titreAxe: "kW", series, survol: (i) => {
      const x = jour.heures[i];
      return `<b>${i} h – ${i + 1} h</b>${ligneBulle("Consommation", `${fr(x.charge, 2)} kW`)}${ligneBulle("Solaire disponible", `${fr(x.pv, 2)} kW`)}`
        + (avecGe ? ligneBulle("Groupe", `${fr(x.ge, 2)} kW`) : "") + ligneBulle(x.batterie >= 0 ? "Batterie (décharge)" : "Batterie (charge)", `${fr(Math.abs(x.batterie), 2)} kW`)
        + ligneBulle("État de charge", pct(x.soc));
    } }));
    bloc.append(html(`<h3>État de charge de la batterie</h3>`));
    const socMin = 1 - M.CHIMIES[r.projet.hyp.chimie].dod;
    bloc.append(graphiqueHoraire({ titreAxe: "%", hauteur: 150,
      series: [{ libelle: "État de charge", type: "ligne", couleur: couleur("--serie-neutre"), valeurs: jour.heures.map((x) => x.soc * 100) }],
      reperes: [{ valeur: socMin * 100, libelle: `Seuil bas ${pct(socMin)}` }, { valeur: 100, libelle: "", tirets: "1 0" }],
      survol: (i) => `<b>${i} h – ${i + 1} h</b>${ligneBulle("État de charge", pct(jour.heures[i].soc))}` }));

    const a = r.simulation.annuel;
    const mens = [
      { libelle: "Consommation", cle: "charge_kwh", couleur: couleur("--serie-conso"), type: "barres" },
      { libelle: "Production solaire disponible", cle: "pv_kwh", couleur: couleur("--serie-pv"), type: "barres" },
    ];
    if (avecGe) mens.push({ libelle: "Groupe électrogène", cle: "ge_kwh", couleur: couleur("--serie-ge"), type: "barres" });
    bloc.append(html(`<h3>Bilan mensuel sur une année simulée</h3>`));
    bloc.append(html(legende(mens)));
    bloc.append(graphiqueMensuel(a.mensuel, mens));
    bloc.append(html(`<details class="avance"><summary>Voir les valeurs mensuelles</summary><div class="defile"><table class="tableau">
      <thead><tr><th>Mois</th><th class="n">Consommation kWh</th><th class="n">Solaire disponible kWh</th>${avecGe ? '<th class="n">Groupe kWh</th>' : '<th class="n">Non servi kWh</th>'}</tr></thead>
      <tbody>${a.mensuel.map((m) => `<tr><td>${m.mois}</td><td class="n">${fr(m.charge_kwh, 0)}</td><td class="n">${fr(m.pv_kwh, 0)}</td><td class="n">${fr(avecGe ? m.ge_kwh : m.non_servi_kwh, 0)}</td></tr>`).join("")}</tbody></table></div></details>`));
    return bloc;
  }

  function blocGroupeSeul(r) {
    const prof = r.bilan.profil_p_w.map((p) => p / 1000);
    const pSite = r.groupe.p_site_w / 1000;
    const bloc = html(`<div class="bloc"><div class="bloc-titre"><h2>Profil de charge du groupe</h2>
      <span class="discret">Puissance appelée heure par heure et capacité du groupe sur site</span></div>
      ${legende([{ libelle: "Puissance appelée", type: "barres", couleur: "var(--serie-conso)" }])}</div>`);
    bloc.append(graphiqueHoraire({ titreAxe: "kW", series: [{ libelle: "Puissance appelée", type: "barres", largeur: 0.7, couleur: "var(--serie-conso)", valeurs: prof }],
      reperes: [{ valeur: pSite, libelle: `Groupe sur site ${fr(pSite, 1)} kW` }, { valeur: 0.3 * pSite, libelle: "30 % : charge minimale conseillée", tirets: "2 4" }],
      survol: (i) => `<b>${i} h – ${i + 1} h</b>${ligneBulle("Puissance appelée", `${fr(prof[i], 2)} kW`)}${ligneBulle("Taux de charge", pct(prof[i] / pSite))}` }));
    return bloc;
  }

  function blocComparaison() {
    const comp = comparaison();
    const lignes = comp.map(({ systeme, res, erreur }) => {
      const nom = NOMS_SYSTEMES[systeme];
      const actuel = systeme === etat.projet.systeme;
      if (erreur) return `<tr class="${actuel ? "actuel" : ""}"><td>${nom}</td><td colspan="7">${echap(erreur)}</td></tr>`;
      const s = res.synthese;
      const gasoil = gasoilAnnuel(s);
      const enr = s.simulation ? (s.groupe ? s.simulation.fraction_renouvelable : 1 - s.simulation.llp) : s.systeme === "reseau" ? null : 0;
      return `<tr class="${actuel ? "actuel" : ""}"><td>${nom}${actuel ? " (projet)" : ""}</td>
        <td class="n">${s.pv ? `${fr(s.pv.kwc, 1)} kWc` : "—"}</td><td class="n">${s.batteries ? `${fr(s.batteries.kwh, 0)} kWh` : "—"}</td>
        <td class="n">${s.onduleur ? `${fr(s.onduleur.kva, 0)} kVA` : "—"}</td><td class="n">${s.groupe ? `${fr(s.groupe.kva, 0)} kVA` : "—"}</td>
        <td class="n">${fr(gasoil, 0)} L/an</td><td class="n">${enr === null ? "réseau" : pct(enr)}</td>
        <td>${s.verifications.non_conforme ? statutHtml("nc", `${s.verifications.non_conforme} NC`) : ""}${s.verifications.attention ? statutHtml("attention", `${s.verifications.attention}`) : ""}${!s.verifications.non_conforme && !s.verifications.attention ? statutHtml("ok", "OK") : ""}</td></tr>`;
    }).join("");
    const bloc = html(`<div class="bloc"><div class="bloc-titre"><h2>Comparaison des systèmes</h2><span class="discret">Même bâtiment, mêmes hypothèses</span></div>
      <div class="defile"><table class="tableau"><thead><tr><th>Système</th><th class="n">Solaire</th><th class="n">Batteries</th><th class="n">Onduleurs</th><th class="n">Groupe</th><th class="n">Gasoil</th><th class="n">Énergie sans gasoil</th><th>Vérifications</th></tr></thead>
      <tbody>${lignes}</tbody></table></div>
      <div class="rangee">${comp.filter((x) => x.systeme !== etat.projet.systeme && !x.erreur).map((x) => `<button type="button" class="btn" data-systeme="${x.systeme}">Passer en ${NOMS_SYSTEMES[x.systeme].toLowerCase()}</button>`).join("")}</div></div>`);
    bloc.addEventListener("click", (e) => {
      const bouton = e.target.closest("[data-systeme]");
      if (!bouton) return;
      etat.projet.systeme = bouton.dataset.systeme;
      remplirChamps($('[data-panneau="projet"]'));
      majVisibilite();
      calculer();
    });
    return bloc;
  }

  /** Gasoil annuel d'un résultat : simulation (hybride), exploitation (groupe seul) ou essais du secours (réseau). */
  function gasoilAnnuel(s) {
    if (s.simulation) return s.groupe ? s.simulation.carburant_l_an : 0;
    if (s.systeme === "reseau") return s.exploitation.carburant_essais_l_an;
    return s.exploitation.carburant_l_an;
  }

  function blocSource(r) {
    const src = r.source;
    const lignes = r.note.filter((l) => l.rubrique === "S. Source réseau" || l.rubrique === "Exploitation sur réseau");
    const ge = r.groupe;
    return html(`<div class="bloc"><div class="bloc-titre"><h2>Raccordement au réseau</h2><span class="discret">${src.type === "transfo" ? "Poste de transformation privé" : "Branchement basse tension du distributeur"}${ge ? " · groupe de secours" : ""}</span></div>
      <div class="defile"><table class="tableau"><tbody>${lignes.map((l) => `<tr><td>${echap(l.libelle)}</td><td class="n">${echap(valeurNote(l))} ${echap(l.unite || "")}</td></tr>`).join("")}
      ${ge ? `<tr><td>Groupe de secours, puissance ${echap(ge.regime)}</td><td class="n">${fr(ge.s_kva)} kVA</td></tr><tr><td>Inverseur de source</td><td class="n">${fr(ge.inverseur_a)} A</td></tr><tr><td>Cuve</td><td class="n">${fr(ge.cuve_l, 0)} L</td></tr>` : ""}</tbody></table></div></div>`);
  }

  function blocCompensation(r) {
    const c = r.compensation;
    const verifs = r.verifications.filter((v) => v.rubrique.startsWith("D."));
    const lignes = r.note.filter((l) => l.rubrique.startsWith("D.")).map((l) => `<tr><td>${echap(l.libelle)}</td><td class="n">${echap(valeurNote(l))} ${echap(l.unite || "")}</td><td class="n discret">${l.n ? `[R${l.n}]` : ""}</td></tr>`).join("");
    return html(`<div class="bloc"><div class="bloc-titre"><h2>Énergie réactive et harmoniques</h2><span class="discret">cos φ ${fr(c.cos_initial, 3)} → visé ${fr(c.cos_cible, 3)} · charges non linéaires ${pct(c.gh_sur_sn)} de la source</span></div>
      <div class="defile"><table class="tableau"><tbody>${lignes}</tbody></table></div>${verifsHtml(verifs)}</div>`);
  }

  function blocLigneResume(r) {
    const l = r.ligne;
    const bloc = html(`<div class="bloc"><div class="bloc-titre"><h2>Ligne aérienne</h2><button type="button" class="btn">Ouvrir l'onglet Ligne aérienne</button></div>
      <p>${fr(l.longueur_m, 0)} m en ${echap(l.conducteur)}, ${l.supports.length} supports ; chute de tension ${fr(l.chute_pct, 2)} %, flèche maximale ${fr(l.fleche_max_m, 2)} m, Icc mini en bout ${fr(l.icc_fin_a, 0)} A (${echap(l.protection)}).</p></div>`);
    $("button", bloc).addEventListener("click", () => ouvrirOnglet("ligne"));
    return bloc;
  }

  function blocBilan(r) {
    const lignes = r.bilan.lignes.map((l) => {
      const ph = etiquettePhase(l, r);
      return `<tr><td>${echap(l.circuit.nom)}</td><td>${phaseHtml(ph)}</td><td class="n">${fr(l.p_w / 1000, 2)}</td><td class="n">${fr(l.q_var / 1000, 2)}</td>
        <td class="n">${fr(l.s_va / 1000, 2)}</td><td class="n">${fr(l.cos_phi, 2)}</td><td class="n">${fr(l.i_b_a, 1)}</td><td class="n">${fr(l.energie_wh_j / 1000, 2)}</td></tr>`;
    }).join("");
    const b = r.bilan;
    return html(`<div class="bloc"><div class="bloc-titre"><h2>Bilan de puissance</h2>
      <span class="discret">ks tableau ${fr(b.ks_tgbt, 2)} · phases : ${b.s_dim_phase_va.map((s, k) => `L${k + 1} ${fr(s / 1000, 2)} kVA`).join(" · ")}</span></div>
      <div class="defile"><table class="tableau"><thead><tr><th>Circuit</th><th>Phase</th><th class="n">P kW</th><th class="n">Q kvar</th><th class="n">S kVA</th><th class="n">cos φ</th><th class="n">I<sub>B</sub> A</th><th class="n">kWh/j</th></tr></thead>
      <tbody>${lignes}</tbody>
      <tfoot><tr><td><strong>TGBT foisonné</strong></td><td></td><td class="n">${fr(b.p_ks_w / 1000, 2)}</td><td class="n">${fr(b.q_ks_var / 1000, 2)}</td><td class="n">${fr(b.s_ks_va / 1000, 2)}</td><td class="n">${fr(b.cos_phi, 2)}</td><td class="n">${fr(b.i_b_tgbt_a, 1)}</td><td class="n">${fr(b.energie_wh_j / 1000, 2)}</td></tr></tfoot></table></div></div>`);
  }

  function blocCables(r) {
    const nec = M.REFERENTIELS[r.projet.referentiel].famille === "nec";
    const bs = r.projet.referentiel === "bs7671";
    const lignes = r.cables.map((c) => `<tr><td>${echap(c.liaison)}</td><td class="n">${fr(c.i_b_a, 1)}</td><td class="n">${fr(c.longueur_m, 0)}${nec ? ` <span class="discret">(${fr(c.longueur_m * 3.281, 0)} ft)</span>` : ""}</td>
      <td class="n">${echap(c.section)}</td><td class="n">${echap(c.pe)}</td><td class="n">${fr(c.iz_corrige_a, 0)}</td>
      <td class="n">${fr(c.chute_cumulee_pct, 2)}</td><td>${echap(c.protection)}</td><td>${echap(c.critere_dimensionnant)}</td></tr>`).join("");
    const terminaux = r.cables.filter((c) => c.seuil_magnetique_a !== undefined);
    const colonnes = [["icc_min_reseau_a", "Sur réseau A"], ["icc_min_onduleur_a", "Sur onduleur A"], ["icc_min_groupe_a", "Sur groupe A"]]
      .filter(([cle]) => terminaux.some((c) => c[cle] !== null && c[cle] !== undefined));
    const cellule = (v, seuil) => (v === null || v === undefined ? "—" : `${fr(v, 0)} ${v >= seuil ? statutHtml("ok", "instantané") : statutHtml("attention", "lent")}`);
    const declenchement = terminaux.map((c) => `<tr><td>${echap(c.liaison)}</td><td>${echap(c.protection)}</td><td class="n">${fr(c.seuil_magnetique_a, 0)}</td>
      ${colonnes.map(([cle]) => `<td class="n">${cellule(c[cle], c.seuil_magnetique_a)}</td>`).join("")}
      ${bs ? `<td class="n">${fr(c.zs_ohm, 3)}</td><td class="n">${fr(c.zs_max_ohm, 2)}</td>` : ""}</tr>`).join("");
    const isolant = nec ? "Cuivre THHN/THWN-2 (Table 310.16), sections en AWG/kcmil" : "Cuivre isolé PR (XLPE), sections en mm²";
    return html(`<div class="bloc"><div class="bloc-titre"><h2>Câbles et protections</h2><span class="discret">${isolant} ; chute de tension cumulée depuis la source</span></div>
      <div class="defile"><table class="tableau"><thead><tr><th>Liaison</th><th class="n">I<sub>B</sub> A</th><th class="n">L m</th><th class="n">Section</th><th class="n">${nec ? "EGC" : "PE"}</th><th class="n">I<sub>z</sub> A</th><th class="n">ΔU %</th><th>Protection</th><th>Critère dimensionnant</th></tr></thead>
      <tbody>${lignes}</tbody></table></div>
      <h3>Déclenchement des disjoncteurs${bs ? " et impédance de boucle Zs" : ""}</h3>
      <p class="discret">Courant de court-circuit phase-neutre minimal en bout de circuit, comparé au seuil de déclenchement instantané du disjoncteur${bs ? " ; Zs comparée à Zs max = 0,95·U0/Ia (BS 7671 Table 41.3)" : ""}. « Lent » : la coupure n'est pas instantanée ; ${nec ? "vérifier la courbe temps-courant (GFCI pour les personnes)" : "le DDR 30 mA assure la protection des personnes"}.</p>
      <div class="defile"><table class="tableau"><thead><tr><th>Circuit</th><th>Protection</th><th class="n">Seuil instantané A</th>${colonnes.map(([, t]) => `<th class="n">${t}</th>`).join("")}${bs ? '<th class="n">Zs Ω</th><th class="n">Zs max Ω</th>' : ""}</tr></thead>
      <tbody>${declenchement}</tbody></table></div></div>`);
  }

  function blocGisement(r) {
    const g = r.gisement;
    const ligne = (nom, cle, d = 2) => `<tr><td>${nom}</td>${g[cle].map((v, m) => `<td class="n${m === g.mois_critique ? " critique" : ""}">${fr(v, d)}</td>`).join("")}</tr>`;
    return html(`<div class="bloc"><div class="bloc-titre"><h2>Gisement solaire</h2>
      <span class="discret">${g.mesure ? "Irradiations saisies" : "Indice de clarté forfaitaire"} · plan incliné à ${g.beta}° · mois critique ${M.MOIS[g.mois_critique]}</span></div>
      <div class="defile"><table class="tableau"><thead><tr><th>kWh/m²/j</th>${M.MOIS.map((m) => `<th class="n">${m}</th>`).join("")}</tr></thead>
      <tbody>${ligne("H0 hors atmosphère", "h0")}${ligne("Indice de clarté", "kt")}${ligne("Horizontal", "ghi")}${ligne("Fraction diffuse", "fd")}${ligne("Plan incliné", "ht")}</tbody></table></div></div>`);
  }

  // ---------------------------------------------------------------------------
  // Onglet Ligne aérienne (module E)
  // ---------------------------------------------------------------------------

  const AUTO = ["", "Selon la norme du projet"];
  const CHAMPS_LIGNE = [
    { chemin: "ligne.conducteur", libelle: "Conducteur", type: "select", options: [AUTO, ...Object.entries(M.CONDUCTEURS_AERIENS).map(([cle, c]) => [cle, c.nom])] },
    { chemin: "ligne.climat", libelle: "Hypothèses climatiques", type: "select", options: [AUTO, ...Object.entries(M.CLIMATS).map(([cle, c]) => [cle, c.nom])] },
    { chemin: "ligne.poteau", libelle: "Supports", type: "select", options: [AUTO, ...Object.entries(M.POTEAUX).map(([cle, x]) => [cle, x.nom])] },
    n("ligne.hauteur_poteau_m", "Hauteur des poteaux", "m"),
    n("ligne.garde_min_m", "Hauteur libre minimale", "m", "Selon la réglementation locale (traversées de routes…)."),
    n("ligne.diametre_poteau_m", "Diamètre moyen des poteaux", "m"),
    n("ligne.cos_phi", "cos φ des charges"),
    n("ligne.ks", "Simultanéité des charges"),
    { chemin: "ligne.protection_type", libelle: "Protection de départ", type: "select", options: [["fusible", "Fusible gG"], ["disjoncteur", "Disjoncteur"]] },
    n("ligne.protection_a", "Calibre de la protection", "A", "Vide : choisi par le moteur."),
    n("ligne.icc_min_ka", "Icc minimal à l'origine", "kA", "Vide : déduit de la source du projet."),
    n("ligne.cs_charge", "Coefficient de sécurité du porteur", "", "Vide : selon les hypothèses climatiques."),
    n("ligne.eds_max", "Tension journalière maximale", "% rupture", "", "pct"),
    n("ligne.facteur_support", "Facteur de charge des supports", "", "Vide : 1 (IEC/NF), 2 (NESC)."),
    { chemin: "ligne.vent_support", libelle: "Compter le vent sur les poteaux", type: "bool" },
  ];
  function construireLigne() {
    $("#ligne").innerHTML = `<div class="bloc">
        <div class="bloc-titre"><h2>Ligne aérienne basse tension</h2><span class="discret">Flèches et tensions mécaniques, choix des supports, chute de tension et court-circuit le long de la ligne.</span></div>
        <label class="case"><input type="checkbox" id="f-ligne-actif" data-chemin="ligne.actif" data-type="bool"> Calculer une ligne aérienne issue du tableau principal</label>
        <p class="discret">Le climat, le type de supports et le conducteur suivent le référentiel choisi dans l'onglet Projet (NF C 11-201, IEC/EN 50341, NESC). Les charges de la ligne s'ajoutent au poteau d'arrivée de chaque portée.</p>
      </div>
      <div class="bloc si-ligne"><h2>Conducteur et supports</h2><div class="grille-champs">${CHAMPS_LIGNE.map(champHtml).join("")}</div></div>
      <div class="bloc si-ligne"><div class="bloc-titre"><h2>Portées</h2><button type="button" class="btn" data-action="ajouter-portee">Ajouter une portée</button></div>
        <div class="defile"><table class="tableau portees"><thead><tr><th>Portée</th><th>Longueur <span class="unite">m</span></th><th title="Angle de déviation de la ligne au poteau d'arrivée">Angle à l'arrivée <span class="unite">°</span></th><th title="Puissance raccordée au poteau d'arrivée">Charge à l'arrivée <span class="unite">kVA</span></th><th></th></tr></thead>
        <tbody id="portees"></tbody></table></div></div>
      <div id="ligne-resultats" class="liste-circuits"></div>`;
    $("#ligne").addEventListener("click", (e) => {
      const bouton = e.target.closest("[data-action]");
      if (!bouton) return;
      const portees = etat.projet.ligne.portees;
      if (bouton.dataset.action === "ajouter-portee") {
        const derniere = portees[portees.length - 1];
        portees.push(derniere ? { longueur_m: derniere.longueur_m, angle_deg: 0, charge_kva: derniere.charge_kva } : { longueur_m: 40, angle_deg: 0, charge_kva: 5 });
      } else if (bouton.dataset.action === "supprimer-portee") {
        portees.splice(Number(bouton.dataset.k), 1);
      } else return;
      rendreLigneSaisie();
      programmerCalcul();
    });
  }
  function rendreLigneSaisie() {
    const portees = etat.projet.ligne.portees;
    const cellule = (k, cle, indication) => `<td><input class="donnee" inputmode="decimal" data-chemin="ligne.portees.${k}.${cle}" data-type="nombre" placeholder="${indication}" autocomplete="off" aria-label="${cle} portée ${k + 1}"></td>`;
    $("#portees").innerHTML = portees.map((x, k) => `<tr><td class="n">${k + 1} → ${k + 2}</td>${cellule(k, "longueur_m", "40")}${cellule(k, "angle_deg", "0")}${cellule(k, "charge_kva", "0")}
      <td><button type="button" class="btn btn-discret btn-danger" data-action="supprimer-portee" data-k="${k}" aria-label="Supprimer la portée ${k + 1}">✕</button></td></tr>`).join("");
    remplirChamps($("#ligne"));
    majVisibilite($("#ligne"));
  }

  /** Profil en long : poteaux, conducteur à la température de flèche maximale, hauteur libre minimale. */
  function profilLigne(l, gardeMin) {
    const L = largeurGraphique($("#ligne")); const H = 230; const g = 40; const d = 16; const h = 26; const b = 26;
    const hMax = Math.ceil(l.h_attache_m + 1.5);
    const xs = (x) => g + (x / l.longueur_m) * (L - g - d);
    const ys = (y) => H - b - (y / hMax) * (H - b - h);
    let svg = `<svg viewBox="0 0 ${L} ${H}" role="img" aria-label="Profil de la ligne : poteaux et flèches à chaud">`;
    for (let y = 0; y <= hMax; y += 2) {
      svg += `<line x1="${g}" x2="${L - d}" y1="${ys(y)}" y2="${ys(y)}" style="stroke:var(--grille)"/><text class="axe-texte" x="${g - 6}" y="${ys(y) + 4}" text-anchor="end">${y}</text>`;
    }
    svg += `<text class="axe-texte" x="${g - 6}" y="12" text-anchor="end">m</text>`;
    svg += `<line x1="${g}" x2="${L - d}" y1="${ys(0)}" y2="${ys(0)}" style="stroke:var(--axe)" stroke-width="1.5"/>`;
    svg += `<line x1="${g}" x2="${L - d}" y1="${ys(gardeMin)}" y2="${ys(gardeMin)}" style="stroke:var(--nc)" stroke-width="1" stroke-dasharray="5 4"/>`
      + `<text class="ref-texte" x="${L - d}" y="${ys(gardeMin) + 14}" text-anchor="end">Hauteur libre mini ${fr(gardeMin, 1)} m</text>`;
    let x0 = 0;
    let chemin = "";
    l.portees.forEach((p) => {
      for (let i = 0; i <= 20; i++) {
        const t = i / 20;
        const y = l.h_attache_m - 4 * p.fleche_chaude_m * t * (1 - t);
        chemin += `${chemin ? " L" : "M"}${xs(x0 + t * p.longueur_m).toFixed(1)},${ys(y).toFixed(1)}`;
      }
      x0 += p.longueur_m;
    });
    svg += `<path d="${chemin}" fill="none" style="stroke:var(--accent)" stroke-width="2"/>`;
    let distance = 0;
    l.supports.forEach((sup, k) => {
      const x = xs(distance);
      svg += `<line x1="${x}" x2="${x}" y1="${ys(0)}" y2="${ys(l.h_attache_m + 0.3)}" style="stroke:var(--ink-2)" stroke-width="${sup.type === "alignement" ? 2 : 3.5}"/>`
        + `<text class="axe-texte" x="${x}" y="${ys(l.h_attache_m + 0.3) - 6}" text-anchor="middle">${sup.numero}</text>`;
      if (k < l.portees.length) distance += l.portees[k].longueur_m;
    });
    svg += `<text class="axe-texte" x="${g}" y="${H - 8}" text-anchor="start">0 m</text><text class="axe-texte" x="${L - d}" y="${H - 8}" text-anchor="end">${fr(l.longueur_m, 0)} m</text>`;
    svg += "</svg>";
    return html(`<div class="graphique">${svg}</div>`);
  }

  function rendreLigneResultats() {
    const zone = $("#ligne-resultats");
    if (!zone || $("#app").dataset.onglet !== "ligne") return;
    const r = etat.resultat;
    zone.innerHTML = "";
    if (!etat.projet.ligne.actif) return;
    if (!r) {
      zone.innerHTML = `<div class="bandeau bandeau-nc"><div><strong>Le calcul attend des entrées valides.</strong><ul>${(etat.erreurs || []).map((e) => `<li>${echap(e)}</li>`).join("")}</ul></div></div>`;
      return;
    }
    const l = r.ligne;
    if (!l) return;
    const gardeMin = r.projet.ligne.garde_min_m;
    const verifs = r.verifications.filter((v) => v.rubrique.startsWith("E."));
    const bloc = html(`<div class="bloc"><div class="bloc-titre"><h2>Résultats de la ligne</h2><span class="discret">${echap(l.conducteur)} · ${echap(l.climat)}</span></div>
      <div class="tuiles">${[
        tuile("Longueur", fr(l.longueur_m, 0), "m", `${l.supports.length} supports, portée équivalente ${fr(l.a_eq_m, 1)} m`),
        tuile("Chute de tension", fr(l.chute_pct, 2), "%", `En bout de ligne, ${fr(l.i_max_a, 0)} A au départ`),
        tuile("Flèche maximale", fr(l.fleche_max_m, 2), "m", `Hauteur libre ${fr(l.garde_m, 2)} m au point bas`),
        tuile("Icc mini en bout", fr(l.icc_fin_a, 0), "A", `Protection de départ : ${l.protection}`),
      ].join("")}</div>${verifsHtml(verifs)}</div>`);
    bloc.append(html(`<h3>Profil en long à ${fr(l.t_chaud, 1)} °C (flèche maximale)</h3>`));
    bloc.append(profilLigne(l, gardeMin));
    zone.append(bloc);
    const rupture = (t) => pct(t / l.rts_n, 1);
    zone.append(html(`<div class="bloc"><h2>Tensions mécaniques du porteur</h2><p class="discret">Équation de changement d'état sur la portée équivalente, réglage : ${echap(l.critere)}.</p>
      <div class="defile"><table class="tableau"><thead><tr><th>État</th><th class="n">Tension daN</th><th class="n">% de la rupture</th></tr></thead>
      <tbody>${l.etats.map((e) => `<tr><td>${echap(e.nom)}</td><td class="n">${fr(e.tension_n / 10, 0)}</td><td class="n">${rupture(e.tension_n)}</td></tr>`).join("")}</tbody></table></div></div>`));
    zone.append(html(`<div class="bloc"><h2>Supports</h2><p class="discret">Effort en tête dans l'état le plus défavorable, facteur de charge compris.</p>
      <div class="defile"><table class="tableau"><thead><tr><th class="n">Poteau</th><th>Fonction</th><th class="n">Effort daN</th><th>Classe retenue</th><th>Hauban</th></tr></thead>
      <tbody>${l.supports.map((x) => `<tr><td class="n">${x.numero}</td><td>${echap(x.type)}</td><td class="n">${fr(x.effort_dan, 0)}</td><td>${x.classe ? echap(x.classe) : statutHtml("attention", "hors gamme")}</td><td>${x.hauban ? "conseillé" : "—"}</td></tr>`).join("")}</tbody></table></div></div>`));
    zone.append(html(`<div class="bloc"><h2>Le long de la ligne</h2>
      <div class="defile"><table class="tableau"><thead><tr><th class="n">Poteau</th><th class="n">Distance m</th><th class="n">Courant A</th><th class="n">ΔU cumulée %</th><th class="n">Flèche à chaud m</th></tr></thead>
      <tbody>${l.noeuds.map((x, k) => `<tr><td class="n">${x.poteau}</td><td class="n">${fr(x.distance_m, 0)}</td><td class="n">${fr(x.courant_a, 1)}</td><td class="n">${fr(x.chute_pct, 2)}</td><td class="n">${fr(l.portees[k].fleche_chaude_m, 2)}</td></tr>`).join("")}</tbody></table></div></div>`));
  }

  // ---------------------------------------------------------------------------
  // Onglet Note de calcul et exports
  // ---------------------------------------------------------------------------

  function rubriques(r) {
    const groupes = new Map();
    for (const l of r.note) {
      if (!groupes.has(l.rubrique)) groupes.set(l.rubrique, []);
      groupes.get(l.rubrique).push(l);
    }
    return groupes;
  }
  function valeurNote(l) {
    return typeof l.valeur === "number" ? fr(l.valeur, 3) : String(l.valeur);
  }

  function rendreNote() {
    const zone = $("#note");
    const r = etat.resultat;
    if (!r && !etat.erreurs) return;
    const boutons = r ? `<button type="button" class="btn btn-primaire" data-export="note">Télécharger la note (.html)</button>
      <button type="button" class="btn" data-export="cables">Carnet de câbles (.csv)</button>` : "";
    const entete = `<div class="bloc"><div class="bloc-titre"><h2>Note de calcul</h2>
      <span class="rangee">${boutons}<button type="button" class="btn" data-export="projet">Projet (.json)</button></span></div>
      <p class="discret" id="export-message">Chaque valeur renvoie à sa justification [Rn]. Outil d'aide à la conception : tables et hypothèses à valider contre l'édition en vigueur des normes et les fiches constructeurs ; toute note remise à un bureau de contrôle est validée par un ingénieur qualifié.</p></div>`;
    if (!r) {
      zone.innerHTML = entete
        + `<div class="bandeau bandeau-nc"><div><strong>Pas de note tant que les entrées sont incomplètes.</strong><ul>${(etat.erreurs || []).map((e) => `<li>${echap(e)}</li>`).join("")}</ul></div></div>`;
      return;
    }
    let corps = "";
    for (const [rub, lignes] of rubriques(r)) {
      corps += `<div class="bloc note-rubrique"><h3>${echap(rub)}</h3><div class="defile"><table class="tableau"><tbody>${lignes.map((l) => {
        const v = valeurNote(l);
        return `<tr><td class="lib">${echap(l.libelle)}</td><td class="val${v.length > 26 ? " long" : ""}">${echap(v)}${l.unite ? ` ${echap(l.unite)}` : ""}</td><td class="r">${l.n ? `[R${l.n}]` : ""}</td></tr>`;
      }).join("")}</tbody></table></div></div>`;
    }
    zone.innerHTML = entete + corps
      + `<div class="bloc"><h3>Vérifications</h3>${verifsHtml(r.verifications)}</div>`
      + `<div class="bloc"><h3>Nomenclature principale</h3><ul>${r.nomenclature.map((x) => `<li>${echap(x)}</li>`).join("")}</ul></div>`
      + `<div class="bloc"><h3>Justifications</h3><ol class="references">${r.references.map((x, i) => `<li><b>[R${i + 1}]</b>${echap(x)}</li>`).join("")}</ol></div>`;
  }

  function noteHtmlAutonome(r) {
    const p = r.projet;
    const lignes = [];
    for (const [rub, ls] of rubriques(r)) {
      lignes.push(`<h2>${echap(rub)}</h2><table>${ls.map((l) => `<tr><td>${echap(l.libelle)}</td><td class="v">${echap(valeurNote(l))} ${echap(l.unite || "")}</td><td class="r">${l.n ? `[R${l.n}]` : ""}</td></tr>`).join("")}</table>`);
    }
    const res = M.RESEAUX[p.reseau];
    const circuits = p.circuits.map((c) => `<tr><td>${echap(c.nom)}</td><td>${echap(libelleAlimentation(c.triphase, res))}</td><td class="v">${fr(c.longueur_m, 0)} m</td><td>${c.recepteurs.map((x) => `${fr(x.quantite, 0)} × ${echap(x.nom)} ${fr(x.puissance_w, 0)} W (${echap(ecrirePlages(x.plages))})`).join("<br>")}</td></tr>`).join("");
    const cables = r.cables.map((c) => `<tr><td>${echap(c.liaison)}</td><td class="v">${fr(c.i_b_a, 1)}</td><td class="v">${fr(c.longueur_m, 0)}</td><td class="v">${echap(c.section)}</td><td class="v">${echap(c.pe)}</td><td class="v">${fr(c.chute_cumulee_pct, 2)}</td><td>${echap(c.protection)}</td></tr>`).join("");
    const date = new Date().toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" });
    return `<!doctype html><html lang="fr"><head><meta charset="utf-8"><title>Note de calcul — ${echap(p.nom)}</title>
<style>body{font-family:Arial,Helvetica,sans-serif;color:#16202a;max-width:900px;margin:32px auto;padding:0 20px;font-size:13px;line-height:1.45}
h1{font-size:22px;margin:0 0 4px}h2{font-size:15px;margin:22px 0 6px;border-bottom:1px solid #b9c1ca;padding-bottom:3px}
table{width:100%;border-collapse:collapse}td,th{padding:4px 6px;border-bottom:1px solid #e1e5ea;text-align:left;vertical-align:top}
td.v{text-align:right;font-family:Consolas,monospace;white-space:nowrap}td.r{width:44px;color:#6f7b87;text-align:right}
.st{font-weight:bold}.nc{color:#c0392f}.at{color:#9a6400}.ok{color:#0b7d0b}.small{color:#6f7b87;font-size:11px}
@media print{body{margin:0}h2{break-after:avoid}}</style></head><body>
<h1>Note de calcul — ${echap(p.nom)}</h1>
<p class="small">${echap(M.SYSTEMES[p.systeme])} · référentiel ${echap(r.synthese.referentiel)} · réseau ${echap(res.nom)}<br>Site ${fr(p.site.latitude, 3)}° / ${fr(p.site.longitude, 3)}°, altitude ${fr(p.site.altitude_m, 0)} m · établie le ${date} · moteur v${echap(r.version)}</p>
<h2>Données d'entrée : circuits et récepteurs</h2><table><tr><th>Circuit</th><th>Alimentation</th><th>Longueur</th><th>Récepteurs (plages horaires)</th></tr>${circuits}</table>
${lignes.join("\n")}
<h2>Câbles et protections</h2><table><tr><th>Liaison</th><th>I<sub>B</sub> A</th><th>L m</th><th>Section</th><th>Protection (PE/EGC)</th><th>ΔU %</th><th>Protection</th></tr>${cables}</table>
<h2>Vérifications</h2><table>${r.verifications.map((v) => `<tr><td class="st ${{ "NON CONFORME": "nc", ATTENTION: "at", OK: "ok", INFO: "" }[v.statut]}">${echap(v.statut)}</td><td>${echap(v.message)}</td><td class="r">${v.n ? `[R${v.n}]` : ""}</td></tr>`).join("")}</table>
<h2>Nomenclature principale</h2><ul>${r.nomenclature.map((x) => `<li>${echap(x)}</li>`).join("")}</ul>
<h2>Justifications</h2><ol>${r.references.map((x) => `<li>${echap(x)}</li>`).join("")}</ol>
<p class="small">Outil d'aide à la conception. Les tables normatives et les données de matériel sont des valeurs usuelles génériques à vérifier contre l'édition en vigueur des normes et les fiches constructeurs. Cette note doit être validée et signée par un ingénieur qualifié avant toute remise à un bureau de contrôle.</p>
</body></html>`;
  }

  function cablesCsv(r) {
    const champ = (v) => `"${String(v).replace(/"/g, '""')}"`;
    const nombre = (v) => (v === null || v === undefined ? "" : String(v).replace(".", ","));
    const lignes = [["Liaison", "I_B (A)", "Longueur (m)", "Conducteurs en parallèle", "Section", "Section (mm²)", "Conducteur de protection", "Iz corrigé (A)", "ΔU cumulée (%)",
      "Protection", "Critère dimensionnant", "Icc mini réseau (A)", "Icc mini onduleur (A)", "Icc mini groupe (A)", "Zs (Ω)", "Zs max (Ω)"].map(champ).join(";")];
    for (const c of r.cables) {
      lignes.push([champ(c.liaison), nombre(Math.round(c.i_b_a * 10) / 10), nombre(c.longueur_m), nombre(c.conducteurs_paralleles), champ(c.section), nombre(c.section_mm2), champ(c.pe),
        nombre(c.iz_corrige_a), nombre(c.chute_cumulee_pct), champ(c.protection), champ(c.critere_dimensionnant), nombre(c.icc_min_reseau_a), nombre(c.icc_min_onduleur_a),
        nombre(c.icc_min_groupe_a), nombre(c.zs_ohm), nombre(c.zs_max_ohm)].join(";"));
    }
    return `﻿${lignes.join("\r\n")}`;
  }
  function nomFichier(extension, suffixe = "") {
    const base = (etat.projet.nom || "projet").normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^A-Za-z0-9]+/g, "-").replace(/^-|-$/g, "").toLowerCase() || "projet";
    return `${base}${suffixe}.${extension}`;
  }
  async function proposerFichier(nom, contenu, type) {
    if (window.AndroidApp && typeof window.AndroidApp.enregistrer === "function") {
      try {
        return window.AndroidApp.enregistrer(nom, contenu, type);
      } catch (e) {
        return "Enregistrement impossible sur ce téléphone.";
      }
    }
    const telechargements = await capacite("downloads");
    if (telechargements) {
      try {
        await telechargements.save({ filename: nom, data: contenu });
        return `Fichier « ${nom} » enregistré.`;
      } catch (e) {
        if (e && e.code === "declined") return "Enregistrement annulé.";
        if (e && e.code === "rate_limited") return "Une demande d'enregistrement est déjà ouverte.";
        return "L'enregistrement de fichiers n'est pas disponible dans cette vue.";
      }
    }
    if (!window.claude) {
      // iPhone (application installée) : le téléchargement direct ne fonctionne pas, on passe par le partage
      const fichier = typeof File === "function" ? new File([contenu], nom, { type }) : null;
      if (fichier && estIos() && navigator.canShare && navigator.canShare({ files: [fichier] })) {
        try {
          await navigator.share({ files: [fichier], title: nom });
          return `Fichier « ${nom} » partagé.`;
        } catch (e) {
          if (e && e.name === "AbortError") return "Partage annulé.";
        }
      }
      const url = URL.createObjectURL(new Blob([contenu], { type }));
      const a = document.createElement("a");
      a.href = url; a.download = nom; document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 2000);
      return `Fichier « ${nom} » téléchargé.`;
    }
    return "L'enregistrement de fichiers n'est pas disponible dans cette vue.";
  }
  async function exporter(type, zoneMessage) {
    let message;
    if (type === "projet") message = await proposerFichier(nomFichier("json"), JSON.stringify(etat.projet, null, 2), "application/json");
    else if (type === "note" && etat.resultat) message = await proposerFichier(nomFichier("html", "-note-de-calcul"), noteHtmlAutonome(etat.resultat), "text/html");
    else if (type === "cables" && etat.resultat) message = await proposerFichier(nomFichier("csv", "-cables"), cablesCsv(etat.resultat), "text/csv");
    if (message && zoneMessage) zoneMessage.textContent = message;
  }

  // ---------------------------------------------------------------------------
  // Application installable : application web (PWA), application Android, partage
  // ---------------------------------------------------------------------------

  const LIEN_WEB = "https://digitalbrainnk-boop.github.io/Nk/dimensionnement/app/";
  const LIEN_APK = "https://github.com/digitalbrainnk-boop/Nk/raw/ccr-efb31b50-bazt84/dimensionnement/dist/agent-dimensionnement.apk";
  const installation = { invite: null, majDemandee: false };
  const dansAndroid = () => Boolean(window.AndroidApp);
  const estIos = () => /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  const enModeApplication = () => window.matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;
  const surLeWeb = () => (location.protocol === "https:" || location.hostname === "localhost") && !dansAndroid() && !window.claude;

  function enregistrerServiceWorker() {
    if (!("serviceWorker" in navigator) || !surLeWeb()) return;
    const proposer = () => { $("#bandeau-maj").hidden = false; };
    navigator.serviceWorker.register("sw.js").then((reg) => {
      const surveiller = (sw) => sw && sw.addEventListener("statechange", () => {
        if (sw.state === "installed" && navigator.serviceWorker.controller) proposer();
      });
      if (reg.waiting && navigator.serviceWorker.controller) proposer();
      surveiller(reg.installing);
      reg.addEventListener("updatefound", () => surveiller(reg.installing));
      setInterval(() => reg.update().catch(() => {}), 60 * 60 * 1000);
    }).catch(() => { /* sans service worker, l'application fonctionne en ligne */ });
    navigator.serviceWorker.addEventListener("controllerchange", () => { if (installation.majDemandee) location.reload(); });
    $("#btn-maj").addEventListener("click", () => {
      installation.majDemandee = true;
      navigator.serviceWorker.getRegistration().then((reg) => {
        if (reg && reg.waiting) reg.waiting.postMessage("activer");
        else location.reload();
      });
    });
  }

  function messagePartage() {
    return `Agent de dimensionnement électrique (NF C 15-100, IEC, BS 7671, NEC) : bâtiment, solaire, batteries, groupe, réseau, lignes aériennes. Fonctionne sans connexion.\n\n`
      + `Android : téléchargez et installez ${LIEN_APK}\n\niPhone, Android ou PC : ouvrez ${LIEN_WEB} puis « Installer » ou « Sur l'écran d'accueil ».`;
  }
  async function partagerApplication(zone) {
    const texte = messagePartage();
    try {
      if (dansAndroid() && typeof window.AndroidApp.partagerTexte === "function") {
        window.AndroidApp.partagerTexte("Agent de dimensionnement", texte);
        return;
      }
      if (navigator.share) {
        await navigator.share({ title: "Agent de dimensionnement électrique", text: texte });
        return;
      }
      await navigator.clipboard.writeText(texte);
      zone.textContent = "Message et liens copiés : collez-les dans WhatsApp ou un e-mail.";
    } catch (e) {
      if (e && e.name === "AbortError") return;
      zone.textContent = "Copiez les liens ci-dessus pour les envoyer.";
    }
  }

  function majInstallation() {
    const bouton = $("#btn-installer");
    const iosAInstaller = estIos() && surLeWeb() && !enModeApplication();
    bouton.hidden = !(installation.invite || iosAInstaller);
    $("#version-app").textContent = `Version ${M.VERSION}${dansAndroid() ? " · application Android" : enModeApplication() ? " · application installée" : ""}`;
    let etat;
    if (dansAndroid()) {
      etat = `<p>${statutHtml("ok", "Installée")} Application Android installée sur ce téléphone. Elle fonctionne sans connexion ; seul l'assistant IA a besoin d'internet.</p>
        <p class="discret">Mise à jour : téléchargez le nouveau fichier APK et installez-le par-dessus. Vos projets sont conservés.</p>`;
    } else if (enModeApplication()) {
      etat = `<p>${statutHtml("ok", "Installée")} Application installée sur cet appareil. Elle fonctionne sans connexion et se met à jour toute seule quand internet est disponible.</p>`;
    } else if (installation.invite) {
      etat = `<p>Ce navigateur peut installer l'application : une icône sera ajoutée à l'écran d'accueil, et l'application fonctionnera sans connexion.</p>
        <div class="rangee"><button type="button" class="btn btn-primaire" data-installer>Installer l'application</button></div>`;
    } else if (iosAInstaller) {
      etat = `<p>Pour installer sur cet iPhone ou iPad : touchez <strong>Partager</strong> (carré avec une flèche) dans Safari, puis <strong>Sur l'écran d'accueil</strong>.</p>`;
    } else if (window.claude) {
      etat = `<p>Cette page est ouverte dans Claude. Pour installer l'application sur un téléphone, utilisez les liens ci-dessous.</p>`;
    } else if (location.protocol === "file:") {
      etat = `<p>Application ouverte depuis un fichier de l'ordinateur : tout fonctionne, sans installation. Pour un téléphone, utilisez les liens ci-dessous.</p>`;
    } else {
      etat = `<p>Dans Chrome ou Edge, menu ⋮ puis <strong>Installer l'application</strong> (ou « Ajouter à l'écran d'accueil »).</p>`;
    }
    $("#installation-contenu").innerHTML = `${etat}
      <div class="deux-colonnes">
        <div><h3>Téléphone Android</h3><ol class="etapes-install">
          <li>Téléchargez <a href="${LIEN_APK}" target="_blank" rel="noopener">agent-dimensionnement.apk</a> (moins de 1 Mo).</li>
          <li>Ouvrez le fichier ; si Android le demande, autorisez l'installation depuis cette source.</li>
          <li>L'icône « Dimensionnement » apparaît avec vos applications.</li></ol></div>
        <div><h3>iPhone, iPad ou ordinateur</h3><ol class="etapes-install">
          <li>Ouvrez <a href="${LIEN_WEB}" target="_blank" rel="noopener">l'application web</a> (Safari sur iPhone, Chrome ou Edge ailleurs).</li>
          <li>iPhone : Partager, puis « Sur l'écran d'accueil ». Ordinateur : bouton « Installer » de la barre d'adresse.</li>
          <li>L'application s'ouvre ensuite depuis son icône, même sans connexion.</li></ol></div>
      </div>
      <h3>Envoyer l'application à un collègue</h3>
      <div class="lien-copie">${echap(LIEN_APK)}</div>
      <div class="lien-copie">${echap(LIEN_WEB)}</div>
      <div class="rangee"><button type="button" class="btn btn-primaire" data-partager>Envoyer à un collègue</button></div>
      <p class="discret" data-message-partage>Les projets restent sur chaque appareil. Pour transmettre un projet, exportez-le (.json) puis importez-le chez votre collègue.</p>`;
  }
  function brancherInstallation() {
    window.addEventListener("beforeinstallprompt", (e) => { e.preventDefault(); installation.invite = e; majInstallation(); });
    window.addEventListener("appinstalled", () => { installation.invite = null; majInstallation(); });
    const installer = async () => {
      if (installation.invite) {
        const invite = installation.invite;
        installation.invite = null;
        invite.prompt();
        await invite.userChoice.catch(() => null);
        majInstallation();
      } else {
        ouvrirOnglet("projet");
        $("#bloc-installation").scrollIntoView({ block: "start" });
      }
    };
    $("#btn-installer").addEventListener("click", installer);
    $("#bloc-installation").addEventListener("click", (e) => {
      if (e.target.closest("[data-installer]")) installer();
      if (e.target.closest("[data-partager]")) partagerApplication($("[data-message-partage]"));
    });
    majInstallation();
    enregistrerServiceWorker();
  }

  // ---------------------------------------------------------------------------
  // Assistant IA
  // ---------------------------------------------------------------------------

  const agent = { tours: [], ctl: null, enCours: false, indisponible: false };

  const CONSIGNES = `Tu es l'assistant d'une application de dimensionnement électrique basse tension : bâtiments, solaire photovoltaïque, batteries, onduleurs/chargeurs, groupes électrogènes, raccordement au réseau public, compensation de l'énergie réactive et lignes aériennes. Tu parles à un électricien, un bureau d'études ou un porteur de projet, en français simple et précis.

Normes disponibles (champ referentiel) et réseaux compatibles (champ reseau) :
- nfc15100 : NF C 15-100 (France, Afrique francophone, Maghreb) ; réseaux 400/230-50, 380/220-50, 230-50.
- iec60364 : IEC 60364 (international) ; réseaux 400/230-50, 380/220-50, 415/240-50, 230-50.
- bs7671 : BS 7671 (Royaume-Uni et pays du Commonwealth : Nigeria, Ghana, Kenya, Inde…) ; réseaux 400/230-50, 415/240-50, 230-50.
- nec : NEC / NFPA 70 (États-Unis ; Canada en première approche, la norme CSA C22.1 n'étant pas intégrée) ; réseaux 240/120-60 (logements), 208/120-60 (petit tertiaire), 480/277-60 (industrie, grands bâtiments).
Choisis la norme du pays du projet et dis-le. Pays non couvert : IEC 60364, en le signalant. Un réseau 60 Hz ne va qu'avec le NEC ; un réseau 50 Hz avec les trois autres. En NEC, les sections sont en AWG/kcmil, les charges continues comptées à 125 %, et les longueurs restent saisies en mètres.

Tes outils agissent sur le projet affiché à l'écran :
- modifier_projet : crée ou modifie le projet (norme, réseau, type de système, site, raccordement au réseau, circuits et récepteurs, hypothèses, module PV, régulateur, ligne aérienne).
- calculer : lance le moteur et renvoie le matériel retenu, les critères et les vérifications.
- details_note : renvoie les lignes détaillées d'une rubrique de la note de calcul.
- comparer_systemes : compare hybride, solaire autonome, groupe seul et réseau public pour le même bâtiment.

Règles :
1. Ne donne jamais un résultat de dimensionnement (kWc, kWh, kVA, kvar, sections, calibres, litres de gasoil, flèches, classes de poteaux) qui ne vient pas d'un outil ou du résumé de résultats fourni.
2. Quand on te décrit une installation, traduis-la en circuits et récepteurs avec des valeurs typiques (puissance unitaire en W, cos φ, rendement pour les moteurs, plages horaires réalistes [début, fin, taux de marche 0-1], la plage peut passer minuit), appelle modifier_projet en une seule fois (remplacer_circuits=true pour un nouveau projet, avec referentiel et reseau), puis calculer.
3. Regroupe par usage : éclairage (eclairage=true), prises (ks 0,2), climatisation, froid, informatique, moteurs. Un moteur : puissance utile en W, moteur=true, rendement 0,75 à 0,9, démarrage progressif ou variateur conseillé au-delà de 2 kW sur solaire. non_lineaire=true pour LED, informatique, variateurs et climatiseurs inverter. triphase=true : triphasé sur un réseau triphasé, 240 V entre phases sur un réseau 120/240 V ; impossible sur 230 V monophasé. Longueur de chaque circuit estimée (15 à 60 m dans un bâtiment).
4. Systèmes : hybride, solaire, groupe, reseau. Pour reseau : source.type public (branchement du distributeur, Icc à demander au distributeur) ou transfo (poste privé), source.secours=true pour un groupe de secours (part_secourue 0-1, autonomie_h).
5. Ligne aérienne : ligne.actif=true, portees = [{longueur_m, angle_deg au poteau d'arrivée, charge_kva au poteau d'arrivée}], 30 à 50 m par portée en BT. Le conducteur, le climat et les supports suivent la norme si tu ne les fixes pas.
6. Si le lieu est une ville, mets ses coordonnées et son altitude approximatives et dis-le. N'invente pas d'irradiations mensuelles : laisse ghi_mensuel vide et rappelle qu'on peut saisir les valeurs PVGIS ou NASA POWER dans l'onglet Projet. Ajuste t_amb_max, t_amb_min et t_amb_jour au climat du lieu.
7. Liste en quelques puces les hypothèses que tu as prises, pour que l'utilisateur les corrige.
8. Après le calcul, présente le matériel retenu, ce qui dimensionne chaque équipement, puis les non-conformités et points d'attention avec l'action corrective. N'applique une correction que si l'utilisateur l'a demandée ; sinon propose-la.
9. Pour une question de cours (normes, formules), réponds directement en citant les articles de la norme du projet (NF C 15-100, IEC 60364, BS 7671, NEC, IEC 62548, ISO 8528, NESC…) et rappelle que les valeurs normatives se vérifient dans l'édition en vigueur.
10. Réponds court : quelques phrases et des listes à puces, unités SI, virgule décimale. Pas de tableau Markdown.`;

  const SCHEMA_RECEPTEUR = { type: "object", properties: {
    nom: { type: "string" }, quantite: { type: "number" }, puissance_w: { type: "number", description: "W par appareil ; puissance utile pour un moteur" },
    cos_phi: { type: "number" }, rendement: { type: "number" }, ku: { type: "number" },
    plages: { type: "array", items: { type: "array", items: { type: "number" } }, description: "[[début h, fin h, taux 0-1], ...]" },
    moteur: { type: "boolean" }, demarrage: { type: "string", enum: Object.keys(M.MODES_DEMARRAGE) }, non_lineaire: { type: "boolean" } } };
  const SCHEMA_CIRCUIT = { type: "object", properties: {
    nom: { type: "string" }, triphase: { type: "boolean" }, longueur_m: { type: "number" }, ks: { type: "number" }, eclairage: { type: "boolean" },
    calibre_min: { type: "number" }, section_min: { type: "number" }, recepteurs: { type: "array", items: SCHEMA_RECEPTEUR } } };

  function resumeProjet() {
    const p = etat.projet;
    const res = M.RESEAUX[p.reseau] || reseauActif();
    return p.circuits.map((c, i) => `${i + 1}. ${c.nom} (${libelleAlimentation(c.triphase, res)}, ${fr(c.longueur_m, 0)} m) : `
      + c.recepteurs.map((r) => `${fr(r.quantite, 0)} × ${r.nom} ${fr(r.puissance_w, 0)} W [${ecrirePlages(r.plages)}]`).join(", ")).join("\n");
  }
  function resumeResultats() {
    if (!etat.resultat) return { erreurs: etat.erreurs };
    const r = etat.resultat;
    const s = r.synthese;
    return {
      systeme: s.systeme_libelle,
      norme: s.referentiel,
      reseau: s.reseau,
      consommation: `${fr(s.energie_kwh_j, 2)} kWh/j, pointe ${fr(s.s_dim_kva, 2)} kVA, cos φ ${fr(s.cos_phi, 2)}`,
      solaire: s.pv && `${s.pv.n_modules} modules soit ${fr(s.pv.kwc, 2)} kWc (requis ${fr(s.pv.kwc_requis, 2)} kWc), ${s.pv.n_mppt} régulateur(s) ${s.pv.config}, inclinaison ${s.pv.inclinaison}°, mois critique ${s.pv.mois_critique}`,
      batteries: s.batteries && `${s.batteries.designation} = ${fr(s.batteries.kwh, 1)} kWh`,
      onduleur: s.onduleur && `${s.onduleur.designation} (${fr(s.onduleur.kva, 0)} kVA), bus ${s.onduleur.u_bus} V`,
      groupe: s.groupe && `${fr(s.groupe.kva, 0)} kVA, critère dimensionnant : ${s.groupe.critere}`,
      simulation: s.simulation && { gasoil_l_an: Math.round(s.simulation.carburant_l_an), heures_groupe_an: s.simulation.heures_ge,
        energie_renouvelable: pct(s.simulation.fraction_renouvelable), delestage: pct(s.simulation.llp, 2) },
      exploitation_groupe: s.systeme === "groupe" ? { gasoil_l_an: Math.round(s.exploitation.carburant_l_an), charge_moyenne: pct(s.exploitation.taux_moyen) } : undefined,
      raccordement: s.source && (s.source.type === "transfo" ? `transformateur ${fr(s.source.s_kva)} kVA, Icc ${fr(s.source.icc_max_ka, 1)} kA` : `branchement BT, ${fr(s.exploitation.energie_kwh_an, 0)} kWh/an`),
      groupe_secours: s.systeme === "reseau" && r.groupe ? `${fr(r.groupe.s_kva)} kVA ESP, inverseur ${r.groupe.inverseur_a} A, cuve ${fr(r.groupe.cuve_l, 0)} L` : undefined,
      compensation: s.compensation.necessaire ? `${fr(s.compensation.q_kvar, 1)} kvar (cos φ ${fr(s.compensation.cos_initial, 3)} → ${fr(s.compensation.cos_cible, 3)}), ${r.compensation.type}` : `non nécessaire (cos φ ${fr(s.compensation.cos_initial, 3)})`,
      ligne: r.ligne && `${fr(r.ligne.longueur_m, 0)} m, ${r.ligne.conducteur}, ΔU ${fr(r.ligne.chute_pct, 2)} %, flèche max ${fr(r.ligne.fleche_max_m, 2)} m, supports ${r.ligne.supports.map((x) => x.classe || "hors gamme").join(" / ")}, protection ${r.ligne.protection}, Icc fin ${fr(r.ligne.icc_fin_a, 0)} A`,
      non_conformites: r.verifications.filter((v) => v.statut === "NON CONFORME").map((v) => v.message),
      points_attention: r.verifications.filter((v) => v.statut === "ATTENTION").map((v) => v.message),
      cables: r.cables.map((c) => `${c.liaison} : ${c.protection}, ${c.section} (PE ${c.pe}), ΔU ${fr(c.chute_cumulee_pct, 2)} %`),
    };
  }

  function appliquerModifications(entree) {
    const p = cloner(etat.projet);
    const avertissements = [];
    if (typeof entree.nom === "string" && entree.nom.trim()) p.nom = entree.nom.trim();
    if (entree.systeme && M.SYSTEMES[entree.systeme]) p.systeme = entree.systeme;
    if (entree.referentiel && M.REFERENTIELS[entree.referentiel]) p.referentiel = entree.referentiel;
    if (entree.reseau && M.RESEAUX[entree.reseau]) p.reseau = entree.reseau;
    else if (M.RESEAUX[p.reseau].famille !== M.REFERENTIELS[p.referentiel].famille) p.reseau = M.normaliser({ referentiel: p.referentiel }).reseau;
    if (entree.source && typeof entree.source === "object") p.source = { ...(p.source || {}), ...entree.source };
    if (entree.ligne && typeof entree.ligne === "object") p.ligne = { ...(p.ligne || {}), ...entree.ligne };
    if (entree.site && typeof entree.site === "object") Object.assign(p.site, entree.site);
    for (const cle of ["hypotheses", "module", "mppt"]) if (entree[cle] && typeof entree[cle] === "object") Object.assign(p[cle], entree[cle]);
    for (const m of Array.isArray(entree.modifier_circuits) ? entree.modifier_circuits : []) {
      const c = p.circuits[Number(m.numero) - 1];
      if (c && m.champs && typeof m.champs === "object") Object.assign(c, m.champs);
      else avertissements.push(`Circuit n° ${m.numero} introuvable.`);
    }
    const aSupprimer = (Array.isArray(entree.supprimer_circuits) ? entree.supprimer_circuits : []).map(Number).sort((a, b) => b - a);
    for (const numero of aSupprimer) {
      if (p.circuits[numero - 1]) p.circuits.splice(numero - 1, 1);
      else avertissements.push(`Circuit n° ${numero} introuvable.`);
    }
    if (Array.isArray(entree.circuits)) {
      const nouveaux = entree.circuits.filter((c) => c && typeof c === "object").map((c) => ({ ...c, recepteurs: Array.isArray(c.recepteurs) ? c.recepteurs : [] }));
      p.circuits = entree.remplacer_circuits ? nouveaux : p.circuits.concat(nouveaux);
    }
    const { erreurs } = M.valider(p);
    if (erreurs.length) return { applique: false, erreurs };
    etat.projet = completer(p);
    rendreFormulaires();
    calculer();
    return { applique: true, avertissements, circuits: resumeProjet() };
  }

  function outilsAgent(etape) {
    return [
      {
        name: "modifier_projet",
        description: "Modifie le projet affiché. Champs facultatifs : seuls ceux fournis changent. Numéros de circuits à partir de 1. Renvoie le projet résumé, ou les erreurs de saisie à corriger (rien n'est alors appliqué).",
        inputSchema: { type: "object", properties: {
          nom: { type: "string" }, systeme: { type: "string", enum: Object.keys(M.SYSTEMES) },
          referentiel: { type: "string", enum: Object.keys(M.REFERENTIELS), description: "norme du projet" },
          reseau: { type: "string", enum: Object.keys(M.RESEAUX), description: "60 Hz avec nec uniquement" },
          source: { type: "object", description: "système reseau : type (public|transfo), s_transfo_kva, uk_pct, icc_livraison_ka, icc_min_ka, longueur_m, secours (bool), part_secourue (0-1), autonomie_h" },
          ligne: { type: "object", description: `actif (bool), conducteur (${Object.keys(M.CONDUCTEURS_AERIENS).join("|")}), climat (${Object.keys(M.CLIMATS).join("|")}), poteau (${Object.keys(M.POTEAUX).join("|")}), hauteur_poteau_m, garde_min_m, protection_type (fusible|disjoncteur), protection_a, cos_phi, ks, portees [{longueur_m, angle_deg, charge_kva}]` },
          site: { type: "object", description: "latitude, longitude (degrés décimaux), altitude_m, t_amb_max, t_amb_min, t_amb_jour, t_local_ge (°C), ghi_mensuel (12 valeurs kWh/m²/j ou null)" },
          remplacer_circuits: { type: "boolean", description: "true : circuits remplace tous les circuits ; sinon ils sont ajoutés" },
          circuits: { type: "array", items: SCHEMA_CIRCUIT },
          modifier_circuits: { type: "array", items: { type: "object", properties: { numero: { type: "integer" }, champs: { type: "object", description: "champs du circuit à remplacer ; recepteurs = liste complète" } }, required: ["numero", "champs"] } },
          supprimer_circuits: { type: "array", items: { type: "integer" } },
          hypotheses: { type: "object", description: "ex. chimie (lifepo4|plomb), jours_autonomie, k_extension, chute_tension_max, inclinaison_deg, longueur_ge_m, methode_pose (E|C|B1), cos_phi_cible" },
          module: { type: "object", description: "p_wc, vmp, imp, voc, isc, coef_p, coef_voc, coef_isc, noct, i_inverse_max, nom" },
          mppt: { type: "object", description: "v_dc_max, v_mppt_min, v_mppt_max, isc_max, i_charge_max, nom" } } },
        execute: (entree, ctx) => {
          if (ctx && ctx.signal && ctx.signal.aborted) throw new Error("Arrêté par l'utilisateur.");
          const res = appliquerModifications(entree || {});
          if (!res.applique) {
            etape("Saisie refusée par le moteur, l'assistant corrige…");
            throw new Error(`Rien n'a été appliqué. Erreurs : ${res.erreurs.join(" ")}`);
          }
          etape(`Projet mis à jour : ${etat.projet.circuits.length} circuit(s), ${referentielActif().nom}, ${tensionCourte()}`);
          return res;
        },
      },
      {
        name: "calculer",
        description: "Lance le calcul complet du projet affiché et renvoie la synthèse : matériel, critères dimensionnants, simulation, non-conformités, points d'attention, protections des circuits.",
        execute: () => {
          calculer();
          const r = resumeResultats();
          etape(r.erreurs ? "Calcul impossible : entrées incomplètes" : "Calcul effectué");
          return r;
        },
      },
      {
        name: "details_note",
        description: "Renvoie les lignes de la note de calcul d'une rubrique (valeur, unité, justification) pour expliquer un résultat.",
        inputSchema: { type: "object", properties: { rubrique: { type: "string", description: "ex. « A. Bilan de puissance », « B3. Champ photovoltaïque », « C. Groupe électrogène », « A. Câbles et protections », « S. Source réseau », « D. Compensation », « E. Ligne aérienne », « Simulation »" } }, required: ["rubrique"] },
        execute: (entree) => {
          if (!etat.resultat) throw new Error("Aucun résultat : le projet a des entrées invalides.");
          const cherche = String(entree.rubrique || "").toLowerCase();
          const groupes = rubriques(etat.resultat);
          const nom = [...groupes.keys()].find((k) => k.toLowerCase().includes(cherche) || cherche.includes(k.toLowerCase()));
          if (!nom) throw new Error(`Rubrique inconnue. Rubriques disponibles : ${[...groupes.keys()].join(", ")}`);
          etape(`Lecture de la note : ${nom}`);
          return { rubrique: nom, lignes: groupes.get(nom).map((l) => `${l.libelle} : ${valeurNote(l)} ${l.unite}${l.ref ? ` (${l.ref})` : ""}`) };
        },
      },
      {
        name: "comparer_systemes",
        description: "Calcule le même bâtiment en hybride, solaire autonome, groupe seul et réseau public, et renvoie pour chacun le matériel, le gasoil annuel et les vérifications.",
        execute: () => {
          etape("Comparaison des quatre systèmes");
          return comparaison().map(({ systeme, res, erreur }) => {
            if (erreur) return { systeme, erreur };
            const s = res.synthese;
            return { systeme, solaire_kwc: s.pv && +s.pv.kwc.toFixed(2), batteries_kwh: s.batteries && +s.batteries.kwh.toFixed(1),
              onduleur_kva: s.onduleur && s.onduleur.kva, groupe_kva: s.groupe && s.groupe.kva,
              gasoil_l_an: Math.round(gasoilAnnuel(s)), reseau_kwh_an: s.systeme === "reseau" ? Math.round(s.exploitation.energie_kwh_an) : undefined,
              delestage: s.simulation && !s.groupe ? pct(s.simulation.llp, 2) : undefined,
              non_conformites: s.verifications.non_conforme, points_attention: s.verifications.attention };
          });
        },
      },
    ];
  }

  function markdown(texte) {
    const enLigne = (t) => echap(t).replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>").replace(/`([^`]+)`/g, "<code>$1</code>");
    const blocs = [];
    let liste = null;
    for (const brute of texte.split("\n")) {
      const ligne = brute.trimEnd();
      const puce = ligne.match(/^\s*(?:[-*•]|\d+[.)])\s+(.*)$/);
      if (puce) { if (!liste) { liste = []; blocs.push(liste); } liste.push(enLigne(puce[1])); continue; }
      liste = null;
      if (!ligne.trim()) continue;
      blocs.push(`<p>${enLigne(ligne.replace(/^#+\s*/, ""))}</p>`);
    }
    return blocs.map((b) => (Array.isArray(b) ? `<ul>${b.map((x) => `<li>${x}</li>`).join("")}</ul>` : b)).join("");
  }

  function ajouterMessage(role, contenuHtml) {
    const msg = html(`<div class="msg msg-${role}"></div>`);
    msg.innerHTML = contenuHtml;
    $("#fil").append(msg);
    msg.scrollIntoView({ block: "end" });
    $("#suggestions").hidden = true;
    return msg;
  }

  const MESSAGES_ERREUR = {
    rate_limited: "Trop de demandes pour l'instant. Réessayez dans un moment.",
    session_expired: "Votre session Claude a expiré : reconnectez-vous puis réessayez.",
    refused: "Je ne peux pas traiter cette demande. Reformulez-la autrement.",
    empty_completion: "Aucune réponse n'a été produite. Reformulez ou simplifiez la demande.",
    prompt_too_large: "La conversation est trop longue. Rechargez la page pour repartir d'une conversation vide.",
    tools_unavailable: "L'assistant ne peut pas agir sur le projet dans cette vue.",
    cle_invalide: "La clé API est refusée par Anthropic : vérifiez-la dans les réglages de l'assistant.",
    hors_ligne: "Pas de connexion internet : l'assistant en a besoin. Les calculs, eux, fonctionnent sans connexion.",
    surcharge: "Le service Claude est momentanément surchargé. Réessayez dans un instant.",
    sdk_absent: "Le module de l'assistant n'a pas pu être chargé. Rechargez l'application.",
  };
  const CODES_DEFINITIFS = ["not_granted", "sampling_disabled", "not_declared", "capability_disabled", "capability_removed"];

  function majSaisie(enCours) {
    agent.enCours = enCours;
    $("#btn-envoyer").disabled = enCours || agent.indisponible;
    $("#message").disabled = agent.indisponible;
    $("#btn-stop").hidden = !enCours;
    $("#assistant-etat").textContent = enCours ? "L'assistant travaille…" : "";
  }
  function assistantIndisponible(message) {
    agent.indisponible = true;
    const zone = $("#assistant-indispo");
    zone.hidden = false;
    zone.textContent = message;
    $("#suggestions").hidden = true;
    majSaisie(false);
  }

  // --- Assistant hors de Claude : clé API Anthropic personnelle, enregistrée sur l'appareil ---

  const CLE_API = "agent-dimensionnement:cle-api";
  const MODELE_API = "claude-opus-5-5";
  function lireCle() {
    try { return localStorage.getItem(CLE_API) || ""; } catch (e) { return ""; }
  }
  function ecrireCle(cle) {
    try {
      if (cle) localStorage.setItem(CLE_API, cle);
      else localStorage.removeItem(CLE_API);
    } catch (e) { /* stockage indisponible : la clé ne sera pas retenue */ }
  }
  function rendreCleApi(message = "") {
    const zone = $("#cle-api");
    const cle = lireCle();
    zone.hidden = false;
    agent.indisponible = !cle;
    $("#assistant-indispo").hidden = true;
    zone.innerHTML = cle
      ? `<div>${statutHtml("ok", "Assistant actif")} avec votre clé API Anthropic (…${echap(cle.slice(-4))}), modèle Claude Opus 5.5. Chaque demande est facturée sur le compte de la clé.</div>
        <div class="rangee"><button type="button" class="btn btn-discret" data-cle="changer">Changer de clé</button><button type="button" class="btn btn-discret btn-danger" data-cle="supprimer">Retirer la clé de cet appareil</button></div>`
      : `<div><strong>Assistant IA hors de Claude.</strong> Dans Claude, l'assistant est inclus. Ici, il fonctionne avec une clé API Anthropic personnelle (console.anthropic.com, rubrique API Keys). La clé reste enregistrée sur cet appareil et n'est envoyée qu'à Anthropic ; chaque demande est facturée sur son compte.</div>
        <form class="rangee" data-cle-form><input type="password" autocomplete="off" spellcheck="false" placeholder="sk-ant-…" aria-label="Clé API Anthropic" data-cle-saisie>
        <button type="submit" class="btn btn-primaire">Activer l'assistant</button></form>
        <div class="discret">Sans clé, tous les onglets de calcul restent utilisables, hors connexion.</div>`;
    if (message) zone.append(html(`<div class="discret">${echap(message)}</div>`));
    $("#suggestions").hidden = !cle || $("#fil").childElementCount > 1;
    majSaisie(false);
  }
  function brancherCleApi() {
    const zone = $("#cle-api");
    zone.addEventListener("submit", (e) => {
      e.preventDefault();
      const cle = $("[data-cle-saisie]", zone).value.trim();
      if (!/^sk-ant-[A-Za-z0-9_-]{20,}$/.test(cle)) {
        rendreCleApi("Cette clé ne ressemble pas à une clé API Anthropic (elle commence par « sk-ant- »).");
        return;
      }
      ecrireCle(cle);
      rendreCleApi("Clé enregistrée sur cet appareil.");
    });
    zone.addEventListener("click", (e) => {
      const b = e.target.closest("[data-cle]");
      if (!b) return;
      ecrireCle("");
      rendreCleApi(b.dataset.cle === "supprimer" ? "Clé retirée de cet appareil." : "");
    });
  }

  let promesseSdk = null;
  function chargerSdk() {
    if (window.AnthropicSDK) return Promise.resolve(window.AnthropicSDK);
    if (!promesseSdk) {
      promesseSdk = new Promise((ok, ko) => {
        const script = document.createElement("script");
        script.src = "vendor/anthropic-sdk.js";
        script.onload = () => (window.AnthropicSDK ? ok(window.AnthropicSDK) : ko(new Error("sdk")));
        script.onerror = () => { promesseSdk = null; ko(new Error("sdk")); };
        document.head.append(script);
      });
    }
    return promesseSdk;
  }
  const erreurCode = (code, texte = "") => Object.assign(new Error(code), { code, text: texte });

  /**
   * Même interface que la capacité « sample » de Claude : sample(entree, { tools, signal, onText }) → { text, truncated }.
   * Boucle d'outils manuelle sur l'API Messages (SDK officiel, streaming) : le moteur exécute chaque outil dans la page.
   */
  function echantillonneurApi(cle) {
    const sample = async (entree, options) => {
      let Anthropic;
      try {
        ({ Anthropic } = await chargerSdk());
      } catch (e) {
        throw erreurCode("sdk_absent");
      }
      const client = new Anthropic({ apiKey: cle, dangerouslyAllowBrowser: true, maxRetries: 2 });
      const [consignes, ...historique] = entree;
      const messages = historique.map((m) => ({ role: m.role, content: m.content }));
      const outils = options.tools || [];
      const tools = outils.map((o) => ({ name: o.name, description: o.description,
        input_schema: o.inputSchema || { type: "object", properties: {} }, eager_input_streaming: true }));
      let texte = "";
      let essaisJson = 0;
      for (let tour = 0; tour < 16; tour++) {
        const flux = client.beta.messages.stream({
          model: MODELE_API,
          max_tokens: 64000,
          betas: ["server-side-fallback-2026-07-01"],
          fallbacks: "default",
          thinking: { type: "adaptive" },
          output_config: { effort: "medium" },
          system: consignes.content,
          tools,
          messages,
        }, { signal: options.signal });
        const debut = texte;
        flux.on("text", (delta) => {
          texte += delta;
          if (options.onText) options.onText({ text: texte, delta });
        });
        let message;
        try {
          message = await flux.finalMessage();
          essaisJson = 0;
        } catch (e) {
          if (e instanceof Anthropic.APIUserAbortError) throw erreurCode("cancelled", texte);
          if (e instanceof Anthropic.AuthenticationError || e instanceof Anthropic.PermissionDeniedError) throw erreurCode("cle_invalide", texte);
          if (e instanceof Anthropic.RateLimitError) throw erreurCode("rate_limited", texte);
          if (e instanceof Anthropic.APIConnectionError) throw erreurCode(navigator.onLine === false ? "hors_ligne" : "surcharge", texte);
          if (e instanceof Anthropic.InternalServerError) throw erreurCode("surcharge", texte);
          if (e instanceof Anthropic.APIError) throw erreurCode("api", `${texte}\n\nErreur de l'API Claude : ${e.message}`);
          // Entrée d'outil illisible pendant le streaming : on relance ce tour (deux fois au plus)
          if (essaisJson++ < 2) { texte = debut; continue; }
          throw e;
        }
        if (message.stop_reason === "refusal") throw erreurCode("refused", texte);
        if (message.stop_reason === "pause_turn") {
          messages.push({ role: "assistant", content: message.content });
          continue;
        }
        const appels = message.content.filter((b) => b.type === "tool_use");
        if (!appels.length) return { text: texte, truncated: message.stop_reason === "max_tokens" };
        // Une entrée d'outil coupée par max_tokens n'est jamais exécutée
        if (message.stop_reason === "max_tokens") return { text: texte, truncated: true };
        messages.push({ role: "assistant", content: message.content });
        const resultats = [];
        for (const appel of appels) {
          const outil = outils.find((o) => o.name === appel.name);
          try {
            if (!outil) throw new Error(`Outil inconnu : ${appel.name}`);
            if (!appel.input || typeof appel.input !== "object" || Array.isArray(appel.input)) throw new Error("Entrée d'outil invalide : un objet JSON est attendu.");
            const r = await outil.execute(appel.input, { signal: options.signal });
            resultats.push({ type: "tool_result", tool_use_id: appel.id, content: JSON.stringify(r ?? null) });
          } catch (e) {
            resultats.push({ type: "tool_result", tool_use_id: appel.id, content: String((e && e.message) || e), is_error: true });
          }
        }
        messages.push({ role: "user", content: resultats });
        if (texte && !texte.endsWith("\n")) texte += "\n\n";
      }
      return { text: texte, truncated: true };
    };
    sample.limits = async () => ({ tools: { maxCount: 16 } });
    return sample;
  }

  async function envoyer(texte) {
    texte = texte.trim();
    if (!texte || agent.enCours || agent.indisponible) return;
    majSaisie(true);
    const sample = window.claude ? await capacite("sample") : lireCle() ? echantillonneurApi(lireCle()) : null;
    if (!sample) {
      majSaisie(false);
      if (window.claude) assistantIndisponible("L'assistant IA n'est pas disponible dans cette vue. Tous les onglets de calcul restent utilisables.");
      else rendreCleApi();
      return;
    }
    ajouterMessage("utilisateur", `<p>${echap(texte).replace(/\n/g, "<br>")}</p>`);
    const bulleAgent = ajouterMessage("agent en-cours", `<ul class="etapes"></ul><div class="texte">Réflexion…</div>`);
    const etapes = $(".etapes", bulleAgent);
    const zoneTexte = $(".texte", bulleAgent);
    const etape = (t) => { etapes.append(html(`<li>${echap(t)}</li>`)); bulleAgent.scrollIntoView({ block: "end" }); };
    const avant = JSON.stringify(etat.projet);
    const contexte = `[Projet actuel]\nNom : ${etat.projet.nom}\nSystème : ${etat.projet.systeme}\nNorme : ${etat.projet.referentiel} ; réseau : ${etat.projet.reseau}\n`
      + `Site : ${JSON.stringify(etat.projet.site)}\nRaccordement : ${JSON.stringify(etat.projet.source)}\nLigne aérienne : ${JSON.stringify(etat.projet.ligne)}\n`
      + `Hypothèses modifiées : ${JSON.stringify(etat.projet.hypotheses)}\nCircuits :\n${resumeProjet() || "(aucun)"}\n\n`
      + `[Derniers résultats]\n${JSON.stringify(resumeResultats())}\n\n[Demande]\n${texte}`;
    const entree = [{ role: "user", content: CONSIGNES }, ...agent.tours.slice(-12), { role: "user", content: contexte }];
    agent.ctl = new AbortController();
    const options = { signal: agent.ctl.signal, modelTier: "default", onText: ({ text }) => { bulleAgent.classList.remove("en-cours"); zoneTexte.innerHTML = markdown(text); } };
    const limites = await sample.limits().catch(() => null);
    if (limites && limites.tools) options.tools = outilsAgent(etape);
    try {
      const { text, truncated } = await sample(entree, options);
      zoneTexte.innerHTML = markdown(text) + (truncated ? `<p class="discret">Réponse coupée : posez une question plus ciblée.</p>` : "");
      agent.tours.push({ role: "user", content: texte }, { role: "assistant", content: text });
    } catch (e) {
      const code = e && e.code;
      zoneTexte.innerHTML = e && e.text ? markdown(e.text) : "";
      if (code === "cancelled") zoneTexte.append(html(`<p class="discret">Arrêté.</p>`));
      else if (CODES_DEFINITIFS.includes(code)) assistantIndisponible("L'assistant IA n'est pas autorisé dans cette vue. Tous les onglets de calcul restent utilisables.");
      else zoneTexte.append(html(`<p class="discret">${echap(MESSAGES_ERREUR[code] || "La réponse a été interrompue. Réessayez.")}</p>`));
      agent.tours.push({ role: "user", content: texte });
    } finally {
      bulleAgent.classList.remove("en-cours");
      if (JSON.stringify(etat.projet) !== avant) {
        const actions = html(`<div class="actions-msg"><button type="button" class="btn">Voir les résultats</button><button type="button" class="btn btn-discret">Annuler ces modifications</button></div>`);
        const [voir, annuler] = $$("button", actions);
        voir.addEventListener("click", () => ouvrirOnglet("resultats"));
        annuler.addEventListener("click", () => {
          remplacerProjet(JSON.parse(avant));
          annuler.replaceWith(html(`<span class="discret">Modifications annulées.</span>`));
        });
        bulleAgent.append(actions);
      }
      majSaisie(false);
    }
  }

  function accueilAssistant() {
    const r = etat.resultat;
    const s = r && r.synthese;
    const resume = s ? [
      s.pv && `${fr(s.pv.kwc, 2)} kWc de panneaux`, s.batteries && `${fr(s.batteries.kwh, 0)} kWh de batteries`,
      s.onduleur && `onduleurs ${s.onduleur.designation}`, s.groupe && `groupe de ${fr(s.groupe.kva, 0)} kVA`,
      s.source && (s.source.type === "transfo" ? `transformateur ${fr(s.source.s_kva)} kVA` : "branchement au réseau"),
    ].filter(Boolean).join(", ") : "";
    ajouterMessage("agent", `<p>Projet ouvert : <strong>${echap(etat.projet.nom)}</strong>${s ? ` (${fr(s.energie_kwh_j, 1)} kWh/j) : ${echap(resume)}.` : "."}</p>
      <p>Décrivez votre bâtiment, vos appareils et le lieu : je choisis la norme du pays (NF C 15-100, IEC 60364, BS 7671 ou NEC), je remplis le projet, je lance le calcul et je vous explique le matériel retenu. Vous pouvez aussi me poser une question sur une norme ou un résultat.</p>`);
    $("#suggestions").hidden = false;
    const suggestions = [
      "Dimensionne une maison de 4 chambres à Bouaké : 12 lampes LED, 2 climatiseurs, un congélateur et une pompe de 1 CV. Solaire avec groupe de secours.",
      "Petit commerce à Houston (Texas) raccordé au réseau en 120/240 V selon le NEC : éclairage LED, 2 climatiseurs de 3,5 kW, une chambre froide. Ajoute un groupe de secours.",
      "Ajoute une ligne aérienne de 6 portées de 40 m pour alimenter 6 maisons de 3 kVA, et vérifie la chute de tension et les poteaux.",
      "Pourquoi le groupe électrogène a-t-il cette puissance ?",
      "Compare les quatre systèmes pour ce projet.",
    ];
    $("#suggestions").innerHTML = suggestions.map((t) => `<button type="button">${echap(t)}</button>`).join("");
  }

  // ---------------------------------------------------------------------------
  // Démarrage
  // ---------------------------------------------------------------------------

  function demarrer() {
    etat.projet = chargerProjet();
    construireProjet();
    construireChoix();
    construireLigne();
    $("#bibliotheque").innerHTML = BIBLIOTHEQUE.map((a) => `<option value="${echap(a.nom)}"></option>`).join("");
    rendreFormulaires();

    let onglet = null;
    try { onglet = localStorage.getItem(CLE_ONGLET); } catch (e) { /* sans effet */ }
    const hash = location.hash.replace("#", "");
    if (["assistant", "projet", "charges", "choix", "ligne", "resultats", "note"].includes(hash)) onglet = hash;
    ouvrirOnglet(onglet || (ETROIT.matches ? "assistant" : "resultats"), false);
    calculer();
    accueilAssistant();

    $(".onglets").addEventListener("click", (e) => { const b = e.target.closest("button[data-onglet]"); if (b) ouvrirOnglet(b.dataset.onglet); });
    ETROIT.addEventListener("change", () => ouvrirOnglet($("#app").dataset.onglet, false));
    let largeurPrecedente = window.innerWidth;
    let minuterieTaille = null;
    window.addEventListener("resize", () => {
      clearTimeout(minuterieTaille);
      minuterieTaille = setTimeout(() => {
        if (Math.abs(window.innerWidth - largeurPrecedente) < 40) return;
        largeurPrecedente = window.innerWidth;
        if ($("#app").dataset.onglet === "resultats") rendreResultats();
        if ($("#app").dataset.onglet === "ligne") rendreLigneResultats();
      }, 200);
    });
    document.addEventListener("input", (e) => {
      if (e.target.dataset && e.target.dataset.ghi !== undefined) return surSaisieGhi();
      if (e.target.type !== "checkbox" && e.target.type !== "radio" && e.target.tagName !== "SELECT") surSaisie(e);
      if (e.target.dataset && e.target.dataset.bibliotheque) surChoixBibliotheque(e.target);
    });
    document.addEventListener("change", (e) => {
      if (e.target.type === "checkbox" || e.target.type === "radio" || e.target.tagName === "SELECT") surSaisie(e);
    });
    $("#liste-circuits").addEventListener("click", surActionCharges);
    $("#btn-ajout-circuit").addEventListener("click", ajouterCircuit);
    $("#ghi-effacer").addEventListener("click", () => { etat.projet.site.ghi_mensuel = null; remplirGhi(); calculer(); });
    $("#choix").addEventListener("click", (e) => {
      if (e.target.id !== "btn-defauts") return;
      etat.projet.hypotheses = {};
      etat.projet.module = { ...M.MODULE_PV };
      etat.projet.mppt = { ...M.REGULATEUR };
      etat.projet.site.t_local_ge = M.SITE.t_local_ge;
      etat.projet.site.albedo = M.SITE.albedo;
      remplirChamps($("#choix"));
      calculer();
    });
    $("#btn-exemple").addEventListener("click", () => { remplacerProjet(M.projetExemple()); $("#fichier-message").textContent = "Exemple chargé."; });
    $("#btn-vide").addEventListener("click", () => { $("#confirmation-vide").hidden = false; });
    $("#btn-vide-non").addEventListener("click", () => { $("#confirmation-vide").hidden = true; });
    $("#btn-vide-oui").addEventListener("click", () => {
      $("#confirmation-vide").hidden = true;
      remplacerProjet(projetVide());
      $("#fichier-message").textContent = "Projet vide créé : ajoutez vos circuits dans l'onglet Charges ou décrivez-les à l'assistant.";
    });
    $("#btn-exporter").addEventListener("click", () => exporter("projet", $("#fichier-message")));
    $("#fichier-import").addEventListener("change", async (e) => {
      const fichier = e.target.files && e.target.files[0];
      if (!fichier) return;
      try {
        const p = JSON.parse(await fichier.text());
        if (!p || typeof p !== "object" || !Array.isArray(p.circuits)) throw new Error("format");
        remplacerProjet(p);
        $("#fichier-message").textContent = `Projet « ${etat.projet.nom} » importé.`;
      } catch (err) {
        $("#fichier-message").textContent = "Ce fichier n'est pas un projet exporté par l'application (JSON avec une liste de circuits).";
      }
      e.target.value = "";
    });
    $("#note").addEventListener("click", (e) => {
      const b = e.target.closest("[data-export]");
      if (b) exporter(b.dataset.export, $("#export-message"));
    });
    $("#saisie").addEventListener("submit", (e) => {
      e.preventDefault();
      const t = $("#message").value;
      $("#message").value = "";
      envoyer(t);
    });
    $("#message").addEventListener("keydown", (e) => {
      if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) { e.preventDefault(); $("#saisie").requestSubmit(); }
    });
    $("#btn-stop").addEventListener("click", () => agent.ctl && agent.ctl.abort());
    $("#suggestions").addEventListener("click", (e) => {
      const b = e.target.closest("button");
      if (b) { $("#message").value = b.textContent; $("#message").focus(); }
    });
    brancherInstallation();
    if (!window.claude) {
      brancherCleApi();
      rendreCleApi();
    } else {
      capacite("sample").then((sample) => { if (!sample) assistantIndisponible("L'assistant IA n'est pas disponible dans cette vue. Tous les onglets de calcul restent utilisables."); });
    }
  }

  demarrer();
})();
