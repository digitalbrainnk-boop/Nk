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
  const CLE_DONNEES = "agent-dimensionnement:donnees"; // version du format des données enregistrées
  const ETROIT = window.matchMedia("(max-width: 1179px)");

  const etat = { projet: null, resultat: null, erreurs: null, manquants: [], comparaison: null, minuterie: null, supprime: null, annonce: "",
    prix: null, materiel: null };

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
  const DEFAUT_RECEPTEUR = { quantite: 1, rendement: 1, ku: 1, cos_phi: 0.9, unite: "W" };
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
  // Catalogue d'équipements (catalogue.js) : valeurs typiques à ajuster selon la plaque signalétique
  // ---------------------------------------------------------------------------

  const K = window.Catalogue;

  // ---------------------------------------------------------------------------
  // Projet : chargement, enregistrement, calcul
  // ---------------------------------------------------------------------------

  function projetVide() {
    const actuel = etat.projet || {};
    return { nom: "Nouveau projet", systeme: "hybride", referentiel: actuel.referentiel || "nfc15100", reseau: actuel.reseau || "400/230-50",
      site: {}, circuits: [], module: { ...M.MODULE_PV }, mppt: { ...M.REGULATEUR }, hypotheses: {}, source: {}, ligne: { actif: false } };
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
  /**
   * Projet enregistré sur l'appareil, sinon projet vide. Une seule fois, à la première ouverture de la version 1.3
   * (données au format 3), tous les projets enregistrés pendant les essais sont effacés pour repartir de zéro ;
   * la clé et le cerveau de l'assistant sont conservés.
   */
  function chargerProjet() {
    try {
      if (localStorage.getItem(CLE_DONNEES) !== "3") {
        localStorage.removeItem(CLE_PROJET);
        localStorage.removeItem(CLE_ONGLET);
        localStorage.setItem(CLE_DONNEES, "3");
      }
      const t = localStorage.getItem(CLE_PROJET);
      if (t) return completer(JSON.parse(t));
    } catch (e) { /* stockage indisponible : projet vide */ }
    return completer(projetVide());
  }
  function reinitialiserApplication() {
    try {
      for (const cle of [CLE_PROJET, CLE_ONGLET, CLE_API, CLE_KIE, CLE_CERVEAU, CLE_KIE_URL, CLE_KIE_MODELE, CLE_PRIX]) localStorage.removeItem(cle);
    } catch (e) { /* sans effet */ }
    etat.prix = lirePrix();
    etat.projet = null;
    etat.supprime = null;
    remplacerProjet(projetVide());
    if (!window.claude) rendreCleApi();
    allerA("projet");
  }

  // ---------------------------------------------------------------------------
  // Informations nécessaires au dimensionnement
  // ---------------------------------------------------------------------------

  const defini = (v) => v !== null && v !== undefined && v !== "" && Number.isFinite(Number(v));
  /** Étapes du dimensionnement et ce qu'il manque : tant qu'une information requise manque, rien n'est calculé. */
  function etapesDimensionnement(p = etat.projet) {
    const site = p.site || {};
    const solaire = p.systeme === "hybride" || p.systeme === "solaire";
    const manqueSite = [];
    if (solaire && !(defini(site.latitude) && defini(site.longitude))) manqueSite.push("le lieu (latitude et longitude)");
    if (!defini(site.altitude_m)) manqueSite.push("l'altitude");
    if (!defini(site.t_amb_max) || !defini(site.t_amb_min)) manqueSite.push("les températures maximale et minimale");
    const appareils = p.circuits.some((c) => (c.recepteurs || []).some((r) => Number(r.puissance_w) > 0 && Number(r.quantite ?? 1) > 0));
    const ghi = Array.isArray(site.ghi_mensuel) && site.ghi_mensuel.filter(defini).length === 12;
    const nomDonne = p.nom && p.nom.trim() && p.nom !== "Nouveau projet";
    const etapes = [
      { cle: "projet", titre: "Projet", detail: `${NOMS_SYSTEMES[p.systeme]} · ${referentielActif().nom} · ${tensionCourte()}`,
        etat: nomDonne ? "ok" : "conseille", manque: nomDonne ? "" : "Donnez un nom au projet ; vérifiez le type de système, la norme et le réseau." },
      { cle: "site", titre: "Site", detail: solaire ? "Lieu, altitude, températures" : "Altitude, températures",
        etat: manqueSite.length ? "requis" : "ok", manque: manqueSite.length ? `À saisir : ${manqueSite.join(", ")}.` : "" },
      { cle: "charges", titre: "Charges", detail: "Appareils du catalogue ou de la plaque : puissance, nombre, heures d'utilisation",
        etat: appareils ? "ok" : "requis", manque: appareils ? "" : "Choisissez vos appareils dans le catalogue : les circuits sont créés automatiquement." },
    ];
    if (solaire) {
      etapes.push({ cle: "ghi", titre: "Ensoleillement", detail: "12 valeurs mensuelles du site (PVGIS ou NASA POWER)",
        etat: ghi ? "ok" : "conseille", manque: ghi ? "" : "Conseillé : sans ces valeurs, le calcul prend un ensoleillement forfaitaire prudent." });
    }
    etapes.push({ cle: "choix", titre: "Choix techniques", detail: "Batteries, matériel, câbles, hypothèses",
      etat: "facultatif", manque: "Facultatif : valeurs par défaut prudentes et matériel générique, à remplacer par vos fiches constructeur." });
    return etapes;
  }
  function informationsManquantes(p = etat.projet) {
    return etapesDimensionnement(p).filter((e) => e.etat === "requis").map((e) => `${e.titre} : ${e.manque}`);
  }
  function guideHtml(titre = "Votre dimensionnement") {
    const libelles = { ok: ["ok", "Fait"], requis: ["nc", "À compléter"], conseille: ["attention", "Conseillé"], facultatif: ["info", "Facultatif"] };
    const etapes = etapesDimensionnement();
    return `<div class="bloc guide"><div class="bloc-titre"><h2>${echap(titre)}</h2><span class="discret">Renseignez ces informations : le calcul se lance tout seul dès que l'essentiel est saisi.</span></div>
      <ol class="guide-etapes">${etapes.map((e, i) => `<li>${statutHtml(...libelles[e.etat])}<div><strong>${i + 1}. ${echap(e.titre)}</strong> <span class="discret">${echap(e.detail)}</span>${e.manque ? `<small>${echap(e.manque)}</small>` : ""}</div>
        <button type="button" class="btn${e.etat === "requis" ? " btn-primaire" : ""}" data-aller="${e.cle}">${e.etat === "ok" ? "Voir" : "Compléter"}</button></li>`).join("")}</ol>
      <p class="discret">Vous pouvez aussi décrire votre installation à l'assistant IA : il remplit ces informations pour vous.</p></div>`;
  }
  function allerA(cible) {
    const onglet = { projet: "projet", site: "projet", ghi: "projet", charges: "charges", choix: "choix" }[cible] || "projet";
    ouvrirOnglet(onglet);
    if (cible === "projet") { window.scrollTo(0, 0); return; }
    const zone = { site: "#btn-gps", ghi: "#champs-ghi", charges: "#btn-catalogue", choix: "#choix" }[cible];
    const el = zone && $(zone);
    if (el) el.scrollIntoView({ block: "center" });
    if (cible === "charges" && !etat.projet.circuits.length) $("#btn-catalogue").focus();
  }
  function rendreGuideProjet() {
    const zone = $("#guide-projet");
    const reste = etapesDimensionnement().some((e) => e.etat === "requis" || e.etat === "conseille");
    zone.hidden = !reste;
    if (reste) zone.innerHTML = guideHtml("Pour un dimensionnement complet");
  }
  function enregistrer() {
    try { localStorage.setItem(CLE_PROJET, JSON.stringify(etat.projet)); } catch (e) { /* sans effet */ }
  }
  function calculer() {
    clearTimeout(etat.minuterie);
    synchroniserPuissances();
    etat.manquants = informationsManquantes();
    if (etat.manquants.length) {
      etat.resultat = null;
      etat.erreurs = null;
    } else {
      try {
        etat.resultat = M.executer(etat.projet);
        etat.erreurs = null;
      } catch (e) {
        etat.resultat = null;
        etat.erreurs = e.erreurs || [e.message];
      }
    }
    etat.comparaison = null;
    enregistrer();
    rendreEntete();
    rendreGuideProjet();
    majChiffresCircuits();
    rendreResultats();
    rendreLigneResultats();
    rendreMateriel();
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
    if (nom === "materiel") rendreMateriel(true);
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
    if (etat.manquants.length) {
      $("#entete-etat").innerHTML = statutHtml("attention", `${etat.manquants.length} information${etat.manquants.length > 1 ? "s" : ""} à compléter`);
      compteur.hidden = false; compteur.textContent = etat.manquants.length; compteur.dataset.niveau = "attention";
      return;
    }
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
  function champHtml({ chemin, libelle, unite = "", aide = "", type = "nombre", options = null, classe = "", famille: fam, systemes, indication: indicationImposee }) {
    const id = `f-${chemin.replace(/\./g, "-")}`;
    let controle;
    if (type === "bool") {
      return `<label class="case ${classe}"${attributsVisibilite({ famille: fam, systemes })}><input type="checkbox" id="${id}" data-chemin="${chemin}" data-type="bool"> ${echap(libelle)}</label>`;
    }
    if (type === "select") {
      controle = `<select id="${id}" data-chemin="${chemin}" data-type="texte">${options.map(([v, l]) => `<option value="${echap(v)}">${echap(l)}</option>`).join("")}</select>`;
    } else {
      const defaut = valeurParDefaut(chemin);
      const indication = indicationImposee || (defaut === null || defaut === undefined ? "auto" : type === "pct" ? fr(defaut * 100, 2) : fr(defaut, 4));
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
      else if (type === "puissance") { const x = recepteurDuChemin(chemin); input.value = versSaisie(x ? puissanceAffichee(x.r) : v); }
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
    else if (type === "type-circuit") valeur = input.value || undefined;
    else if (type === "unite-p") { changerUnite(chemin, input.value); programmerCalcul(); return; }
    else if (type === "plages") {
      valeur = lirePlages(input.value);
      if (valeur === null) { input.setAttribute("aria-invalid", "true"); return; }
    } else {
      valeur = nombreSaisi(input.value);
      if (Number.isNaN(valeur)) { input.setAttribute("aria-invalid", "true"); return; }
      if (type === "pct" && valeur !== undefined) valeur = valeur / 100;
    }
    input.removeAttribute("aria-invalid");
    if (type === "puissance") {
      saisirPuissance(chemin, valeur);
      majAidesRecepteurs();
      programmerCalcul();
      return;
    }
    ecrire(chemin, valeur);
    if (type === "type-circuit" || type === "triphase") {
      const c = etat.projet.circuits[Number(chemin.split(".")[1])];
      if (c && c.type) { appliquerTypeCircuit(c); remplirChamps(input.closest(".circuit")); }
    }
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

  /** Position GPS du téléphone ou de l'ordinateur : latitude, longitude et, si l'appareil la donne, altitude. */
  function utiliserPosition() {
    const message = $("#gps-message");
    if (!navigator.geolocation) { message.textContent = "Cet appareil ne donne pas sa position : saisissez les coordonnées."; return; }
    message.textContent = "Recherche de la position…";
    navigator.geolocation.getCurrentPosition((pos) => {
      const c = pos.coords;
      etat.projet.site.latitude = Math.round(c.latitude * 1e4) / 1e4;
      etat.projet.site.longitude = Math.round(c.longitude * 1e4) / 1e4;
      const altitude = Number.isFinite(c.altitude) && c.altitude !== null;
      if (altitude) etat.projet.site.altitude_m = Math.max(0, Math.round(c.altitude));
      remplirChamps($("#champs-site"));
      message.textContent = `Position enregistrée (précision ${fr(c.accuracy, 0)} m)${altitude ? "" : " ; saisissez l'altitude"}.`;
      calculer();
    }, (err) => {
      message.textContent = err && err.code === 1
        ? "Accès à la position refusé : autorisez-le dans les réglages, ou saisissez les coordonnées."
        : "Position introuvable pour l'instant : réessayez dehors, ou saisissez les coordonnées.";
    }, { enableHighAccuracy: true, timeout: 20000, maximumAge: 600000 });
  }

  // ---------------------------------------------------------------------------
  // Onglet Projet
  // ---------------------------------------------------------------------------

  const CHAMPS_SITE = [
    { chemin: "site.latitude", libelle: "Latitude", unite: "°", indication: "à saisir", aide: "Ex. Abidjan 5,35 ; Bouaké 7,69." },
    { chemin: "site.longitude", libelle: "Longitude", unite: "°", indication: "à saisir", aide: "Ex. Abidjan −4,01 ; Bouaké −5,03." },
    { chemin: "site.altitude_m", libelle: "Altitude", unite: "m", indication: "à saisir" },
    { chemin: "site.t_amb_max", libelle: "Température maximale", unite: "°C", indication: "à saisir", aide: "Jour le plus chaud (câbles, onduleurs, modules)." },
    { chemin: "site.t_amb_min", libelle: "Température minimale", unite: "°C", indication: "à saisir", aide: "Nuit la plus froide (tension des modules)." },
    { chemin: "site.t_amb_jour", libelle: "Température moyenne de jour", unite: "°C", aide: "Vide : 31 °C." },
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
    etat.projet.circuits.forEach(appliquerTypeCircuit); // protections minimales de la nouvelle famille de normes
    remplirNormes();
    surChangementReseau();
    majVisibilite();
  }
  function surChangementReseau() {
    let message = "";
    if (reseauActif().nph === 1) {
      const tri = etat.projet.circuits.filter((c) => c.triphase);
      tri.forEach((c) => { c.triphase = false; appliquerTypeCircuit(c); });
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
  const OPTIONS_UNITES = Object.keys(K.UNITES_PUISSANCE).map((u) => `<option value="${u}">${u}</option>`).join("");
  const OPTIONS_TYPES = `<option value="">Type de circuit…</option>${Object.entries(K.TYPES_CIRCUITS).map(([cle, t]) => `<option value="${cle}">${echap(t.nom)}</option>`).join("")}`;

  // --- Puissance saisie dans l'unité de la plaque (W, kW, CV, HP, kVA, A) ---

  /** Contexte de conversion d'une puissance de plaque : cos φ, rendement, moteur, alimentation et réseau du circuit. */
  function contexteConversion(c, r, reseau = reseauActif()) {
    return { cos_phi: Number(r.cos_phi ?? 0.9) || 0.9, rendement: Number(r.rendement ?? 1) || 1, moteur: Boolean(r.moteur), triphase: Boolean(c.triphase), reseau };
  }
  const uniteDe = (r) => (r.unite && K.UNITES_PUISSANCE[r.unite] ? r.unite : "W");
  /** Recalcule la puissance en W des récepteurs saisis dans une autre unité (le cos φ, le rendement ou l'alimentation ont pu changer). */
  function synchroniserPuissances(p = etat.projet) {
    const reseau = M.RESEAUX[p.reseau] || reseauActif();
    for (const c of p.circuits) {
      for (const r of c.recepteurs || []) {
        if (uniteDe(r) === "W" || !Number.isFinite(Number(r.valeur_saisie))) continue;
        r.puissance_w = Math.round(K.versWatts(Number(r.valeur_saisie), r.unite, contexteConversion(c, r, reseau)) * 10) / 10;
      }
    }
  }
  function recepteurDuChemin(chemin) {
    const m = chemin.match(/^circuits\.(\d+)\.recepteurs\.(\d+)\./);
    if (!m) return null;
    const c = etat.projet.circuits[Number(m[1])];
    return c && c.recepteurs[Number(m[2])] ? { c, r: c.recepteurs[Number(m[2])], i: Number(m[1]), j: Number(m[2]) } : null;
  }
  function puissanceAffichee(r) {
    return uniteDe(r) !== "W" && Number.isFinite(Number(r.valeur_saisie)) ? Math.round(Number(r.valeur_saisie) * 1000) / 1000 : r.puissance_w;
  }
  function equivalentPuissance(r) {
    if (uniteDe(r) === "W" || !(Number(r.puissance_w) > 0)) return "";
    return `= ${fr(r.puissance_w, 0)} W${r.moteur ? " utiles" : ""}`;
  }
  function saisirPuissance(chemin, valeur) {
    const x = recepteurDuChemin(chemin);
    if (!x) return;
    const { c, r } = x;
    if (uniteDe(r) === "W") {
      delete r.valeur_saisie;
      if (valeur === undefined) delete r.puissance_w; else r.puissance_w = valeur;
    } else if (valeur === undefined) {
      delete r.valeur_saisie;
      delete r.puissance_w;
    } else {
      r.valeur_saisie = valeur;
      r.puissance_w = Math.round(K.versWatts(valeur, r.unite, contexteConversion(c, r)) * 10) / 10;
    }
  }
  /** Changement d'unité : la puissance est conservée et réaffichée dans la nouvelle unité. */
  function changerUnite(chemin, unite) {
    const x = recepteurDuChemin(chemin);
    if (!x) return;
    const { c, r } = x;
    r.unite = K.UNITES_PUISSANCE[unite] ? unite : "W";
    if (r.unite === "W") delete r.valeur_saisie;
    else if (Number(r.puissance_w) > 0) r.valeur_saisie = Math.round(K.depuisWatts(Number(r.puissance_w), r.unite, contexteConversion(c, r)) * 1000) / 1000;
    const ligne = $(`.circuit[data-circuit="${x.i}"] .recepteur[data-recepteur="${x.j}"]`);
    if (ligne) {
      $('[data-type="puissance"]', ligne).value = versSaisie(puissanceAffichee(r));
      $("[data-equivalent]", ligne).textContent = equivalentPuissance(r);
      $('[data-type="puissance"]', ligne).title = K.UNITES_PUISSANCE[r.unite].aide || "";
    }
  }

  // --- Types de circuits ---

  /** Protection et section minimales usuelles du type de circuit, selon la famille de normes et l'alimentation. */
  function appliquerTypeCircuit(c) {
    const preset = c.type && K.presetCircuit(c.type, famille(), c.triphase);
    if (preset) Object.assign(c, preset);
  }

  function recepteurHtml(i, j) {
    const b = `circuits.${i}.recepteurs.${j}`;
    return `<div class="recepteur" data-recepteur="${j}">
      <label class="champ r-nom"><span>Appareil</span><input list="bibliotheque" data-chemin="${b}.nom" data-type="texte" data-bibliotheque="${i}.${j}" autocomplete="off" placeholder="Nom ou choix dans la liste"></label>
      <label class="champ r-qte"><span>Qté</span><input class="donnee" inputmode="decimal" data-chemin="${b}.quantite" data-type="nombre"></label>
      <div class="champ r-p"><span>P unitaire (plaque)</span><span class="saisie-unite"><input class="donnee" inputmode="decimal" data-chemin="${b}.puissance_w" data-type="puissance" aria-label="Puissance unitaire"><select data-chemin="${b}.unite" data-type="unite-p" aria-label="Unité de la puissance">${OPTIONS_UNITES}</select></span><small data-equivalent></small></div>
      <label class="champ r-cos"><span>cos φ</span><input class="donnee" inputmode="decimal" data-chemin="${b}.cos_phi" data-type="nombre"></label>
      <label class="champ r-eta"><span>Rendement</span><input class="donnee" inputmode="decimal" data-chemin="${b}.rendement" data-type="nombre" placeholder="1"></label>
      <label class="champ r-ku"><span>ku</span><input class="donnee" inputmode="decimal" data-chemin="${b}.ku" data-type="nombre" placeholder="1"></label>
      <label class="champ r-plages"><span>Plages horaires</span><input class="donnee" data-chemin="${b}.plages" data-type="plages" placeholder="8-17 60%; 18-23" autocomplete="off"></label>
      <button type="button" class="btn btn-discret btn-danger r-suppr" data-action="supprimer-recepteur" data-i="${i}" data-j="${j}" aria-label="Supprimer ce récepteur">✕</button>
      <div class="recepteur-moteur">
        <label class="case"><input type="checkbox" data-chemin="${b}.moteur" data-type="bool"> Moteur ou compresseur</label>
        <label class="case choix-demarrage"><span class="discret">Démarrage</span><select data-chemin="${b}.demarrage" data-type="texte">${OPTIONS_DEMARRAGE}</select></label>
        <label class="case" title="LED, informatique, variateurs, onduleurs : courants harmoniques"><input type="checkbox" data-chemin="${b}.non_lineaire" data-type="bool"> Non linéaire (électronique)</label>
        <span class="discret r-heures" data-heures></span>
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
        <select data-chemin="${b}.type" data-type="type-circuit" aria-label="Type de circuit">${OPTIONS_TYPES}</select>
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
        <div class="rangee"><button type="button" class="btn" data-action="catalogue" data-i="${i}">Ajouter depuis le catalogue</button>
          <button type="button" class="btn btn-discret" data-action="ajouter-recepteur" data-i="${i}">Ajouter un récepteur vide</button></div>
      </div>
    </article>`;
  }
  function rendreCharges() {
    const liste = $("#liste-circuits");
    const bandeaux = (etat.supprime
      ? `<div class="bandeau bandeau-info"><span>Circuit « ${echap(etat.supprime.circuit.nom)} » supprimé.</span><button type="button" class="btn" data-action="restaurer-circuit">Annuler la suppression</button></div>`
      : "") + (etat.annonce ? `<div class="bandeau bandeau-info" role="status"><span>${echap(etat.annonce)}</span></div>` : "");
    liste.innerHTML = bandeaux + (etat.projet.circuits.length
      ? etat.projet.circuits.map(circuitHtml).join("")
      : `<div class="bloc vide-charges"><p>Aucun circuit pour l'instant. Choisissez vos appareils dans le catalogue : l'application crée les circuits (éclairage, prises, climatisation, moteurs…) avec leurs protections minimales. Vous pouvez aussi ajouter un circuit vide, ou décrire l'installation à l'assistant.</p>
        <div class="rangee"><button type="button" class="btn btn-primaire" data-action="catalogue">Choisir dans le catalogue d'équipements</button></div></div>`);
    remplirChamps(liste);
    majVisibilite(liste);
    $$(".recepteur", liste).forEach((ligne) => {
      const moteur = $('[data-type="bool"][data-chemin$=".moteur"]', ligne);
      $(".choix-demarrage", ligne).hidden = !moteur.checked;
    });
    majChiffresCircuits();
  }
  /** Texte d'aide sous un récepteur : puissance convertie et heures équivalentes par jour. */
  function majAidesRecepteurs() {
    etat.projet.circuits.forEach((c, i) => (c.recepteurs || []).forEach((r, j) => {
      const ligne = $(`.circuit[data-circuit="${i}"] .recepteur[data-recepteur="${j}"]`);
      if (!ligne) return;
      $("[data-equivalent]", ligne).textContent = equivalentPuissance(r);
      const h = K.heuresParJour(r.plages);
      const pAbs = (Number(r.quantite ?? 1) * Number(r.puissance_w || 0)) / (Number(r.rendement) || 1) * (Number(r.ku) || 1);
      $("[data-heures]", ligne).textContent = h > 0 && pAbs > 0 ? `≈ ${fr(h, 1)} h/j à pleine puissance · ${fr((pAbs * h) / 1000, 2)} kWh/j` : "";
    }));
  }
  function majChiffresCircuits() {
    majAidesRecepteurs();
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
      case "catalogue":
        ouvrirCatalogue(bouton.dataset.i === undefined ? "auto" : String(i));
        return;
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
    etat.annonce = "";
    rendreCharges();
    programmerCalcul();
  }
  function ajouterCircuit() {
    const n = etat.projet.circuits.length + 1;
    etat.projet.circuits.push({ nom: `C${n} Nouveau circuit`, longueur_m: 25, recepteurs: [{ nom: "", quantite: 1, puissance_w: 100, cos_phi: 0.9, plages: [[18, 23, 1]] }] });
    etat.supprime = null;
    etat.annonce = "";
    rendreCharges();
    programmerCalcul();
    const dernier = $$(".circuit").pop();
    if (dernier) { dernier.scrollIntoView({ block: "center" }); $(".nom-circuit", dernier).select(); }
  }
  /** Appareil choisi dans la liste du champ « Appareil » : valeurs typiques du catalogue, et type du circuit s'il n'en a pas. */
  function surChoixBibliotheque(input) {
    const appareil = K.APPAREILS.find((a) => a.nom === input.value);
    if (!appareil) return;
    const [i, j] = input.dataset.bibliotheque.split(".").map(Number);
    const c = etat.projet.circuits[i];
    const r = c.recepteurs[j];
    delete r.unite;
    delete r.valeur_saisie;
    Object.assign(r, K.recepteur(appareil, r.quantite || 1));
    if (c.recepteurs.length === 1) {
      if (appareil.triphase && reseauActif().nph === 3) c.triphase = true;
      if (!c.type) { c.type = appareil.circuit; appliquerTypeCircuit(c); }
    }
    rendreCharges();
    programmerCalcul();
  }

  // --- Fenêtre du catalogue d'équipements ---

  const catalogue = { selection: new Map(), categorie: "", recherche: "", destination: "auto", retour: null };

  function ouvrirCatalogue(destination = "auto") {
    catalogue.selection.clear();
    catalogue.destination = destination;
    catalogue.retour = document.activeElement;
    const fenetre = $("#fenetre-catalogue");
    fenetre.hidden = false;
    document.body.classList.add("fenetre-ouverte");
    $("#catalogue-recherche").value = catalogue.recherche;
    rendreCategoriesCatalogue();
    rendreListeCatalogue();
    rendreDestinationsCatalogue();
    majPiedCatalogue();
    if (!ETROIT.matches) $("#catalogue-recherche").focus();
  }
  function fermerCatalogue() {
    $("#fenetre-catalogue").hidden = true;
    document.body.classList.remove("fenetre-ouverte");
    if (catalogue.retour && document.contains(catalogue.retour)) catalogue.retour.focus();
  }
  function rendreCategoriesCatalogue() {
    const puce = (cle, nom, n) => `<button type="button" class="puce" data-categorie="${cle}" aria-pressed="${catalogue.categorie === cle}">${echap(nom)} <span class="discret">${n}</span></button>`;
    $("#catalogue-categories").innerHTML = puce("", "Tout", K.APPAREILS.length)
      + K.CATEGORIES.map((c) => puce(c.cle, c.nom, K.APPAREILS.filter((a) => a.categorie === c.cle).length)).join("");
  }
  function descriptionAppareil(a) {
    const p = a.puissance_w >= 1000 ? `${fr(a.puissance_w / 1000, 2)} kW` : `${fr(a.puissance_w, 0)} W`;
    const morceaux = [a.moteur && a.rendement < 1 ? `${p} utiles (${fr(a.puissance_w / a.rendement / 1000, 2)} kW absorbés)` : p, `cos φ ${fr(a.cos_phi, 2)}`];
    if (a.moteur) morceaux.push(`démarrage ${M.MODES_DEMARRAGE[a.demarrage].libelle.replace(/^démarrage /, "")}`);
    if (a.non_lineaire) morceaux.push("électronique");
    if (a.triphase) morceaux.push("triphasé");
    morceaux.push(`≈ ${fr(K.heuresParJour(a.plages), 1)} h/j`);
    return morceaux.join(" · ");
  }
  function rendreListeCatalogue() {
    const trouves = K.chercher(catalogue.recherche, catalogue.categorie || null);
    const zone = $("#catalogue-liste");
    if (!trouves.length) {
      zone.innerHTML = `<p class="discret">Aucun appareil ne correspond. Essayez un autre mot, ou ajoutez un récepteur vide et saisissez la plaque signalétique.</p>`;
      return;
    }
    let categoriePrecedente = null;
    zone.innerHTML = trouves.map((a) => {
      const titre = a.categorie !== categoriePrecedente && !catalogue.categorie
        ? `<h3 class="catalogue-categorie">${echap(K.CATEGORIES.find((c) => c.cle === a.categorie).nom)}</h3>` : "";
      categoriePrecedente = a.categorie;
      const q = catalogue.selection.get(a.id) || 0;
      return `${titre}<div class="article${q ? " choisi" : ""}" data-id="${a.id}">
        <div class="article-texte"><strong>${echap(a.nom)}</strong><span class="discret">${echap(descriptionAppareil(a))}</span>${a.note ? `<span class="discret">${echap(a.note)}</span>` : ""}</div>
        <div class="quantite"><button type="button" class="btn" data-moins aria-label="Un de moins">−</button><input class="donnee" inputmode="numeric" value="${q}" data-qte aria-label="Quantité : ${echap(a.nom)}"><button type="button" class="btn" data-plus aria-label="Un de plus">+</button></div>
      </div>`;
    }).join("");
  }
  function rendreDestinationsCatalogue() {
    const options = [["auto", "Nouveaux circuits, créés automatiquement"], ...etat.projet.circuits.map((c, i) => [String(i), `Circuit ${c.nom}`])];
    const select = $("#catalogue-destination");
    select.innerHTML = options.map(([v, l]) => `<option value="${v}">${echap(l)}</option>`).join("");
    select.value = options.some(([v]) => v === catalogue.destination) ? catalogue.destination : "auto";
  }
  function majPiedCatalogue() {
    const n = [...catalogue.selection.values()].reduce((s, q) => s + q, 0);
    const lignes = catalogue.selection.size;
    $("#catalogue-compte").textContent = n ? `${n} appareil${n > 1 ? "s" : ""} choisi${n > 1 ? "s" : ""} (${lignes} type${lignes > 1 ? "s" : ""})` : "Aucun appareil choisi";
    $("#catalogue-ajouter").disabled = !n;
  }
  function changerQuantiteCatalogue(id, q) {
    const quantite = Math.max(0, Math.min(999, Math.round(Number(q) || 0)));
    if (quantite) catalogue.selection.set(id, quantite); else catalogue.selection.delete(id);
    const article = $(`#catalogue-liste .article[data-id="${id}"]`);
    if (article) {
      article.classList.toggle("choisi", quantite > 0);
      const champ = $("[data-qte]", article);
      if (document.activeElement !== champ) champ.value = quantite;
    }
    majPiedCatalogue();
  }
  function ajouterDepuisCatalogue() {
    const selection = [...catalogue.selection].map(([id, quantite]) => ({ appareil: K.APPAREILS.find((a) => a.id === id), quantite })).filter((x) => x.appareil);
    if (!selection.length) return;
    const circuits = etat.projet.circuits;
    const destination = $("#catalogue-destination").value;
    let premier;
    if (destination === "auto") {
      const nouveaux = K.repartirEnCircuits(selection, { reseau: reseauActif(), famille: famille(), numero: circuits.length + 1 });
      premier = circuits.length;
      circuits.push(...nouveaux);
      etat.annonce = `${nouveaux.length} circuit${nouveaux.length > 1 ? "s" : ""} créé${nouveaux.length > 1 ? "s" : ""} avec leurs protections minimales. `
        + "Vérifiez la longueur de chaque circuit (estimée) et les heures d'utilisation de vos appareils.";
    } else {
      premier = Number(destination);
      const c = circuits[premier];
      c.recepteurs.push(...selection.map(({ appareil, quantite }) => K.recepteur(appareil, quantite)));
      if (!c.type && selection.length === 1) { c.type = selection[0].appareil.circuit; appliquerTypeCircuit(c); }
      etat.annonce = `${selection.length} appareil${selection.length > 1 ? "s" : ""} ajouté${selection.length > 1 ? "s" : ""} au circuit « ${c.nom} ».`;
    }
    etat.supprime = null;
    fermerCatalogue();
    if ($("#app").dataset.onglet !== "charges") ouvrirOnglet("charges");
    rendreCharges();
    calculer();
    const cible = $(`.circuit[data-circuit="${premier}"]`);
    if (cible) cible.scrollIntoView({ block: "start" });
  }
  function brancherCatalogue() {
    const fenetre = $("#fenetre-catalogue");
    let minuterie = null;
    $("#catalogue-recherche").addEventListener("input", (e) => {
      clearTimeout(minuterie);
      minuterie = setTimeout(() => { catalogue.recherche = e.target.value; rendreListeCatalogue(); }, 120);
    });
    $("#catalogue-categories").addEventListener("click", (e) => {
      const b = e.target.closest("[data-categorie]");
      if (!b) return;
      catalogue.categorie = b.dataset.categorie;
      $$("[data-categorie]", fenetre).forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
      rendreListeCatalogue();
      $("#catalogue-liste").scrollTop = 0;
    });
    $("#catalogue-liste").addEventListener("click", (e) => {
      const article = e.target.closest(".article");
      if (!article) return;
      const q = catalogue.selection.get(article.dataset.id) || 0;
      if (e.target.closest("[data-plus]")) changerQuantiteCatalogue(article.dataset.id, q + 1);
      else if (e.target.closest("[data-moins]")) changerQuantiteCatalogue(article.dataset.id, q - 1);
      else if (!e.target.closest("[data-qte]") && !q) changerQuantiteCatalogue(article.dataset.id, 1);
    });
    $("#catalogue-liste").addEventListener("input", (e) => {
      const article = e.target.closest(".article");
      if (article && e.target.dataset.qte !== undefined) changerQuantiteCatalogue(article.dataset.id, nombreSaisi(e.target.value) || 0);
    });
    $("#catalogue-destination").addEventListener("change", (e) => { catalogue.destination = e.target.value; });
    $("#catalogue-ajouter").addEventListener("click", ajouterDepuisCatalogue);
    fenetre.addEventListener("click", (e) => { if (e.target === fenetre || e.target.closest("[data-fermer]")) fermerCatalogue(); });
    fenetre.addEventListener("keydown", (e) => { if (e.key === "Escape") fermerCatalogue(); });
    $("#btn-catalogue").addEventListener("click", () => ouvrirCatalogue("auto"));
    // Touche Retour d'Android : ferme le catalogue au lieu de quitter l'application
    window.retourAndroid = () => {
      if ($("#fenetre-catalogue").hidden) return false;
      fermerCatalogue();
      return true;
    };
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
    if (etat.manquants.length) {
      zone.innerHTML = guideHtml();
      return;
    }
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

  // ---------------------------------------------------------------------------
  // Onglet Matériel et devis
  // ---------------------------------------------------------------------------

  const CLE_PRIX = "agent-dimensionnement:prix"; // prix unitaires saisis, mémorisés sur l'appareil pour tous les projets
  const MARGE_CABLES = 0.1;
  const DEVISES = { FCFA: 0, "€": 2, $: 2, "£": 2, MAD: 2, DZD: 2, TND: 3, GNF: 0, CDF: 0, NGN: 2, GHS: 2, KES: 2 };
  const POUVOIRS_COUPURE = { iec: [3, 4.5, 6, 10, 15, 25, 36, 50, 70, 100], nec: [10, 14, 18, 22, 25, 35, 42, 65, 100] };
  const ORDRE_MATERIEL = ["Production solaire", "Stockage", "Conversion", "Groupe électrogène", "Raccordement au réseau", "Compensation",
    "Câbles", "Protections", "Tableau", "Ligne aérienne"];

  function lirePrix() {
    let stocke = {};
    try { stocke = JSON.parse(localStorage.getItem(CLE_PRIX) || "{}") || {}; } catch (e) { /* stockage indisponible */ }
    return { devise: DEVISES[stocke.devise] === undefined ? "FCFA" : stocke.devise, main_oeuvre: Number(stocke.main_oeuvre) || 0,
      tva: Number(stocke.tva) || 0, prix: stocke.prix && typeof stocke.prix === "object" ? stocke.prix : {} };
  }
  function enregistrerPrix() {
    try { localStorage.setItem(CLE_PRIX, JSON.stringify(etat.prix)); } catch (e) { /* le prix reste en mémoire pour la session */ }
  }
  const clePrix = (l) => `${l.designation}|${l.unite}`;

  /**
   * Liste du matériel tirée du résultat du moteur : équipements dimensionnés, câbles par type et section (longueurs + 10 %),
   * disjoncteurs par calibre, protections différentielles, tableau et ligne aérienne.
   */
  function listeMateriel(r) {
    const p = r.projet;
    const res = M.RESEAUX[p.reseau];
    const nec = M.REFERENTIELS[p.referentiel].famille === "nec";
    const nf = p.referentiel === "nfc15100";
    const lignes = [];
    const notes = [];
    const ajouter = (categorie, designation, quantite, unite = "u", usage = "") => {
      if (!(quantite > 0)) return;
      let l = lignes.find((x) => x.designation === designation && x.unite === unite);
      if (!l) { l = { categorie, designation, quantite: 0, unite, usages: [] }; lignes.push(l); }
      l.quantite += quantite;
      if (usage && !l.usages.includes(usage)) l.usages.push(usage);
    };
    const nbOnduleurs = r.onduleur ? (res.nph === 3 ? 3 : 1) * r.onduleur.n_par_phase : 0;

    if (r.pv) {
      const pv = r.pv;
      const nChaines = pv.n_mppt * pv.np;
      ajouter("Production solaire", p.module.nom, pv.n_modules, "u", `${pv.n_mppt} régulateur(s) × ${pv.ns} en série × ${pv.np} en parallèle`);
      ajouter("Production solaire", p.mppt.nom, pv.n_mppt);
      ajouter("Production solaire", `Structure de fixation, inclinaison ${r.gisement.beta}°, orientée ${p.site.latitude >= 0 ? "plein Sud" : "plein Nord"}`, pv.n_modules, "module");
      ajouter("Production solaire", "Connecteurs MC4 (paire mâle et femelle)", 2 * nChaines, "paire", `${nChaines} chaîne(s)`);
      ajouter("Production solaire", "Interrupteur-sectionneur DC du champ photovoltaïque", pv.n_mppt, "u", "un par régulateur");
      notes.push(`Parafoudres AC et DC, boîtes de jonction et liaison équipotentielle du champ : selon l'analyse du risque de foudre et l'implantation (${nec ? "NEC 690 et 242" : "IEC 62548, guide UTE C 15-712"}).`);
    }
    if (r.batteries) {
      const b = r.batteries;
      if (p.hyp.chimie === "plomb") ajouter("Stockage", `Élément de batterie 2 V OPzV ${b.ah_unite} Ah (C10)`, b.n_par * b.n_cellules, "u", `${b.n_par} branche(s) de ${b.n_cellules} éléments`);
      else ajouter("Stockage", `Module de batterie LiFePO4 ${fr(b.u_nom)} V ${b.ah_unite} Ah avec BMS`, b.n_par, "u", `${fr(b.c_installee_kwh, 1)} kWh installés`);
    }
    if (r.onduleur) {
      const o = r.onduleur;
      const kva = (res.nph === 2 ? 2 * o.unite_va : o.unite_va) / 1000;
      ajouter("Conversion", `Onduleur/chargeur ${fr(kva)} kVA, ${o.u_bus} V DC${res.nph === 2 ? `, split-phase ${res.u0}/${res.u_ll} V` : ""}`, nbOnduleurs, "u", o.designation);
    }
    if (r.groupe) {
      const g = r.groupe;
      ajouter("Groupe électrogène", `Groupe électrogène ${fr(g.s_kva)} kVA ${g.regime}, ${tensionCourte(res)}`, 1, "u", `critère : ${g.critere}`);
      if (p.systeme === "reseau") ajouter("Groupe électrogène", `Inverseur de source ${g.inverseur_a} A${nec ? " (UL 1008)" : ", 4 pôles"}`, 1);
      if (g.cuve_l) ajouter("Groupe électrogène", `Cuve de gasoil ${fr(Math.ceil(g.cuve_l / 50) * 50, 0)} L`, 1);
    }
    if (r.source && r.source.type === "transfo") ajouter("Raccordement au réseau", `Transformateur ${fr(r.source.s_kva)} kVA`, 1);
    const comp = r.compensation;
    if (comp.necessaire && comp.q_installee_var && p.systeme === "reseau") {
      ajouter("Compensation", `Batterie de condensateurs ${comp.automatique ? "automatique" : "fixe"} ${fr(comp.q_installee_var / 1000)} kvar (${comp.type})`, 1);
    }

    // Câbles et protections
    const iccNote = r.note.find((l) => l.libelle.startsWith("Icc maximal au tableau principal"));
    const iccKa = iccNote ? Number(iccNote.valeur) / 1000 : 0;
    const gamme = POUVOIRS_COUPURE[nec ? "nec" : "iec"];
    const pdc = gamme.find((x) => x >= iccKa) || gamme[gamme.length - 1];
    const textePdc = nec ? `AIC ≥ ${pdc} kA` : `pouvoir de coupure ≥ ${fr(pdc)} kA`;
    const isolant = nf ? "U1000 R2V" : "cuivre XLPE 0,6/1 kV";
    const marge = (longueur) => longueur * (1 + MARGE_CABLES);
    let modules = 0;
    const terminaux = [];
    for (const c of r.cables) {
      const n = c.conducteurs_paralleles || 1;
      const sec = c.section_label;
      if (/^Chaîne PV/.test(c.liaison)) {
        ajouter("Câbles", nec ? `Câble PV Wire ${sec}` : `Câble solaire H1Z2Z2-K 1 × ${sec}`, marge(2 * c.longueur_m * r.pv.n_mppt * r.pv.np), "m", "chaînes PV");
        continue;
      }
      if (/\(DC\)/.test(c.liaison)) {
        const fois = /onduleur/.test(c.liaison) ? nbOnduleurs : r.pv ? r.pv.n_mppt : 1;
        ajouter("Câbles", nec ? `Câble cuivre souple ${sec} (liaisons batterie)` : `Câble cuivre souple 1 × ${sec} (H07RN-F)`, marge(2 * c.longueur_m * n * fois), "m", c.liaison);
        const fusible = c.protection.match(/Fusible DC (\d+) A/);
        if (fusible) ajouter("Protections", `Fusible DC ${fusible[1]} A avec porte-fusible`, fois, "u", c.liaison);
        continue;
      }
      const ligne = r.bilan.lignes.find((l) => l.circuit.nom === c.liaison);
      const poly = ligne ? ligne.circuit.triphase && res.nph >= 2 : res.nph >= 2;
      const moteurSeul = ligne && ligne.circuit.recepteurs.length > 0 && ligne.circuit.recepteurs.every((x) => x.moteur);
      const neutre = ligne ? !(poly && (moteurSeul || res.nph === 2)) : true;
      const actifs = (poly ? (res.nph === 3 ? 3 : 2) : 1) + (neutre ? 1 : 0);
      if (nec) {
        ajouter("Câbles", `Conducteur THHN/THWN-2 cuivre ${sec}`, marge(c.longueur_m * actifs * n), "m", c.liaison);
        ajouter("Câbles", `Conducteur de terre (EGC) cuivre ${c.pe}`, marge(c.longueur_m * n), "m", c.liaison);
      } else if (n === 1 && c.section_mm2 <= 16) {
        ajouter("Câbles", `Câble ${isolant} ${actifs + 1}G${sec}`, marge(c.longueur_m), "m", c.liaison);
      } else {
        ajouter("Câbles", `Câble ${isolant} 1 × ${sec}`, marge(c.longueur_m * actifs * n), "m", c.liaison);
        ajouter("Câbles", `Conducteur de protection vert/jaune 1 × ${String(c.pe).replace(/^\d+ × /, "")}`, marge(c.longueur_m * n), "m", c.liaison);
      }
      const disj = c.protection.match(/^Disj\.\s*(?:(\d)P\s+)?(\d+) A(?: courbe ([BCD]))?/);
      if (!disj) continue;
      const calibre = Number(disj[2]);
      const poles = disj[1] ? `${disj[1]}P` : nec ? (poly ? `${res.nph === 3 ? 3 : 2}P` : "1P") : poly ? (neutre ? "4P" : "3P") : "1P+N";
      ajouter("Protections", `Disjoncteur ${poles} ${calibre} A${disj[3] ? ` courbe ${disj[3]}` : ""}, ${textePdc}`, 1, "u", c.liaison);
      if (calibre <= 125) modules += Number(poles[0]); // les disjoncteurs de plus de 125 A ne sont pas modulaires
      if (ligne) terminaux.push({ poly, i: c.i_b_a });
    }
    if (!nec && terminaux.length) {
      for (const [poly, pole] of [[false, "2P"], [true, "4P"]]) {
        const groupe = terminaux.filter((t) => t.poly === poly);
        for (let k = 0; k < groupe.length; k += 8) {
          const courant = groupe.slice(k, k + 8).reduce((s, t) => s + t.i, 0);
          const calibre = [25, 40, 63, 80, 100].find((x) => x >= courant) || 125;
          ajouter("Protections", `Interrupteur différentiel ${pole} ${calibre} A 30 mA type A`, 1);
          modules += poly ? 4 : 2;
        }
      }
      notes.push(`Protection différentielle : un interrupteur différentiel 30 mA pour 8 circuits au plus${nf ? " (NF C 15-100)" : ""}, calibre selon le courant des circuits protégés ; type A pour lave-linge, plaques de cuisson et bornes de recharge (borne : type B ou détection 6 mA DC selon le constructeur).`);
    }
    if (nec) notes.push("GFCI (210.8) et AFCI (210.12) à prévoir selon les pièces et les circuits concernés.");
    if (modules) {
      const avecReserve = Math.ceil(modules * 1.2);
      if (nec) {
        const emplacements = [12, 16, 20, 24, 30, 32, 40, 42, 54, 60, 84].find((x) => x >= avecReserve) || avecReserve;
        ajouter("Tableau", `Tableau de distribution (panelboard) ${emplacements} emplacements`, 1, "u", `${modules} pôles et 20 % de réserve`);
      } else {
        const rangees = Math.ceil(avecReserve / 13);
        ajouter("Tableau", `Coffret de répartition ${rangees} rangée${rangees > 1 ? "s" : ""} de 13 modules`, 1, "u", `${modules} modules utilisés et 20 % de réserve`);
      }
    }
    if (r.ligne) {
      const l = r.ligne;
      const matiere = { beton: "en béton armé", bois_ansi: "en bois" }[p.ligne.poteau || M.REFERENTIELS[p.referentiel].poteau] || "";
      ajouter("Ligne aérienne", `Conducteur ${l.conducteur}`, l.longueur_m * 1.03, "m", "longueur de la ligne + 3 % (flèches, raccordements)");
      for (const s of l.supports) ajouter("Ligne aérienne", `Poteau ${matiere} ${fr(p.ligne.hauteur_poteau_m)} m, ${s.classe || "hors gamme (étude spécifique)"}`, 1, "u", `n° ${s.numero}`);
      ajouter("Ligne aérienne", "Hauban complet (câble, ancrage, isolateur)", l.supports.filter((s) => s.hauban).length);
      ajouter("Ligne aérienne", `Protection de départ de ligne : ${l.protection}`, 1);
    }
    notes.unshift(`Longueurs de câbles : longueurs saisies + ${fr(MARGE_CABLES * 100, 0)} % pour les raccordements et les chutes ; ${nec ? "conducteurs individuels sous conduit" : "câbles multiconducteurs jusqu'à 16 mm², unipolaires au-delà"}.`);
    notes.push("Non comptés : chemins de câbles et conduits, boîtes de dérivation, interrupteurs et prises, prise de terre, petites fournitures.");
    for (const l of lignes) l.quantite = l.unite === "m" ? Math.ceil(l.quantite) : Math.round(l.quantite);
    lignes.sort((a, b) => ORDRE_MATERIEL.indexOf(a.categorie) - ORDRE_MATERIEL.indexOf(b.categorie));
    return { lignes, notes };
  }

  /** Montants du devis avec les prix enregistrés : matériel, main-d'œuvre, HT, TVA, TTC. */
  function montantsDevis(liste, reglages = etat.prix) {
    let materiel = 0;
    let sansPrix = 0;
    for (const l of liste.lignes) {
      const prix = reglages.prix[clePrix(l)];
      if (Number.isFinite(prix)) materiel += prix * l.quantite; else sansPrix += 1;
    }
    const mainOeuvre = materiel * reglages.main_oeuvre;
    const ht = materiel + mainOeuvre;
    const tva = ht * reglages.tva;
    return { materiel, mainOeuvre, ht, tva, ttc: ht + tva, sansPrix };
  }
  const montant = (x, devise = etat.prix.devise) => `${fr(x, DEVISES[devise] ?? 2)} ${devise}`;

  function rendreMateriel(force = false) {
    const zone = $("#materiel");
    if (!force && $("#app").dataset.onglet !== "materiel" && zone.childElementCount) return;
    const r = etat.resultat;
    if (!r) {
      etat.materiel = null;
      zone.innerHTML = etat.manquants.length ? guideHtml("La liste du matériel sera prête quand ces informations seront saisies")
        : `<div class="bandeau bandeau-nc"><div><strong>Pas de liste du matériel tant que les entrées sont incomplètes.</strong><ul>${(etat.erreurs || []).map((e) => `<li>${echap(e)}</li>`).join("")}</ul></div></div>`;
      return;
    }
    const liste = listeMateriel(r);
    etat.materiel = liste;
    const reg = etat.prix;
    const usages = (l) => (l.usages.length > 6 ? `${l.usages.slice(0, 6).join(", ")}…` : l.usages.join(", "));
    const parCategorie = ORDRE_MATERIEL.map((cat) => [cat, liste.lignes.map((l, k) => [l, k]).filter(([l]) => l.categorie === cat)]).filter(([, ls]) => ls.length);
    zone.innerHTML = `<div class="bloc">
        <div class="bloc-titre"><h2>Matériel et devis</h2><span class="rangee"><button type="button" class="btn btn-primaire" data-export="devis">Devis (.csv)</button></span></div>
        <p class="discret">Quantités tirées du dimensionnement (${echap(r.synthese.systeme_libelle)}, ${echap(r.synthese.referentiel)}). Saisissez vos prix unitaires : ils restent sur cet appareil et sont repris dans vos autres projets. Le montant total ne compte que les lignes qui ont un prix.</p>
        <div class="grille-champs">
          <label class="champ"><span>Devise</span><select data-reglage="devise">${Object.keys(DEVISES).map((d) => `<option${d === reg.devise ? " selected" : ""}>${echap(d)}</option>`).join("")}</select></label>
          <label class="champ"><span>Main-d'œuvre et pose <span class="unite">% du matériel</span></span><input class="donnee" inputmode="decimal" data-reglage="main_oeuvre" value="${reg.main_oeuvre ? versSaisie(Math.round(reg.main_oeuvre * 10000) / 100) : ""}" placeholder="0"></label>
          <label class="champ"><span>TVA <span class="unite">%</span></span><input class="donnee" inputmode="decimal" data-reglage="tva" value="${reg.tva ? versSaisie(Math.round(reg.tva * 10000) / 100) : ""}" placeholder="0"></label>
        </div>
        <p class="discret" id="materiel-message" role="status"></p>
      </div>
      ${parCategorie.map(([cat, ls]) => `<div class="bloc materiel"><h3>${echap(cat)}</h3><div class="defile"><table class="tableau">
        <colgroup><col><col class="c-qte"><col class="c-unite"><col class="c-prix"><col class="c-montant"></colgroup>
        <thead><tr><th>Désignation</th><th class="n">Qté</th><th>Unité</th><th class="n">Prix unitaire</th><th class="n">Montant</th></tr></thead>
        <tbody>${ls.map(([l, k]) => {
          const prix = reg.prix[clePrix(l)];
          return `<tr><td>${echap(l.designation)}${l.usages.length ? `<div class="detail">${echap(usages(l))}</div>` : ""}</td><td class="n">${fr(l.quantite, 0)}</td><td>${echap(l.unite)}</td>
          <td class="prix"><input class="donnee" inputmode="decimal" data-prix="${k}" value="${Number.isFinite(prix) ? versSaisie(prix) : ""}" placeholder="prix" aria-label="Prix unitaire : ${echap(l.designation)}"></td>
          <td class="n" data-montant="${k}">${Number.isFinite(prix) ? montant(prix * l.quantite) : "—"}</td></tr>`;
        }).join("")}</tbody></table></div></div>`).join("")}
      <div class="bloc"><h3>Récapitulatif</h3><div class="totaux" id="totaux-devis"></div></div>
      <div class="bloc"><h3>À savoir</h3><ul class="notes-materiel">${liste.notes.map((x) => `<li>${echap(x)}</li>`).join("")}</ul>
        <p class="discret">Désignations génériques : choisissez les références chez votre fournisseur en respectant les caractéristiques indiquées (calibre, pouvoir de coupure, section, tension).</p></div>`;
    majTotauxDevis();
  }
  function majTotauxDevis() {
    const zone = $("#totaux-devis");
    if (!zone || !etat.materiel) return;
    const m = montantsDevis(etat.materiel);
    const reg = etat.prix;
    zone.innerHTML = `<span>Matériel${m.sansPrix ? ` <span class="discret">(${m.sansPrix} ligne${m.sansPrix > 1 ? "s" : ""} sans prix)</span>` : ""}</span><span class="n">${montant(m.materiel)}</span>
      ${reg.main_oeuvre ? `<span>Main-d'œuvre et pose (${fr(reg.main_oeuvre * 100, 1)} %)</span><span class="n">${montant(m.mainOeuvre)}</span>` : ""}
      <span>Total hors taxes</span><span class="n">${montant(m.ht)}</span>
      ${reg.tva ? `<span>TVA (${fr(reg.tva * 100, 1)} %)</span><span class="n">${montant(m.tva)}</span><span class="fort">Total TTC</span><span class="n fort">${montant(m.ttc)}</span>` : ""}`;
  }
  function brancherMateriel() {
    const zone = $("#materiel");
    zone.addEventListener("input", (e) => {
      const t = e.target;
      if (t.dataset.prix !== undefined && etat.materiel) {
        const l = etat.materiel.lignes[Number(t.dataset.prix)];
        const prix = nombreSaisi(t.value);
        if (Number.isNaN(prix) || prix < 0) { t.setAttribute("aria-invalid", "true"); return; }
        t.removeAttribute("aria-invalid");
        if (prix === undefined) delete etat.prix.prix[clePrix(l)]; else etat.prix.prix[clePrix(l)] = prix;
        $(`[data-montant="${t.dataset.prix}"]`, zone).textContent = prix === undefined ? "—" : montant(prix * l.quantite);
      } else if (t.dataset.reglage === "main_oeuvre" || t.dataset.reglage === "tva") {
        const v = nombreSaisi(t.value);
        if (Number.isNaN(v) || v < 0 || v > 100) { t.setAttribute("aria-invalid", "true"); return; }
        t.removeAttribute("aria-invalid");
        etat.prix[t.dataset.reglage] = (v || 0) / 100;
      } else return;
      enregistrerPrix();
      majTotauxDevis();
    });
    zone.addEventListener("change", (e) => {
      if (e.target.dataset.reglage !== "devise") return;
      etat.prix.devise = e.target.value;
      enregistrerPrix();
      rendreMateriel(true);
    });
    zone.addEventListener("click", (e) => {
      const b = e.target.closest("[data-export]");
      if (b) exporter(b.dataset.export, $("#materiel-message"));
    });
  }
  function devisCsv(liste) {
    const champ = (v) => `"${String(v).replace(/"/g, '""')}"`;
    const nombre = (v) => (v === null || v === undefined || !Number.isFinite(v) ? "" : String(Math.round(v * 1000) / 1000).replace(".", ","));
    const reg = etat.prix;
    const lignes = [["Catégorie", "Désignation", "Quantité", "Unité", `Prix unitaire (${reg.devise})`, `Montant (${reg.devise})`, "Utilisation"].map(champ).join(";")];
    for (const l of liste.lignes) {
      const prix = reg.prix[clePrix(l)];
      lignes.push([champ(l.categorie), champ(l.designation), nombre(l.quantite), champ(l.unite), nombre(prix), nombre(Number.isFinite(prix) ? prix * l.quantite : null), champ(l.usages.join(", "))].join(";"));
    }
    const m = montantsDevis(liste);
    lignes.push("");
    lignes.push([champ("Total matériel"), "", "", "", "", nombre(m.materiel)].join(";"));
    if (reg.main_oeuvre) lignes.push([champ(`Main-d'œuvre et pose (${fr(reg.main_oeuvre * 100, 1)} %)`), "", "", "", "", nombre(m.mainOeuvre)].join(";"));
    lignes.push([champ("Total hors taxes"), "", "", "", "", nombre(m.ht)].join(";"));
    if (reg.tva) {
      lignes.push([champ(`TVA (${fr(reg.tva * 100, 1)} %)`), "", "", "", "", nombre(m.tva)].join(";"));
      lignes.push([champ("Total TTC"), "", "", "", "", nombre(m.ttc)].join(";"));
    }
    return `﻿${lignes.join("\r\n")}`;
  }
  /** Section « Liste du matériel » de la note autonome, avec les prix s'ils sont saisis. */
  function materielHtml(liste) {
    const reg = etat.prix;
    const m = montantsDevis(liste);
    const avecPrix = m.sansPrix < liste.lignes.length;
    return `<h2>Liste du matériel</h2><table><tr><th>Désignation</th><th>Qté</th><th>Unité</th>${avecPrix ? `<th>Prix unitaire</th><th>Montant</th>` : ""}</tr>
${liste.lignes.map((l) => {
  const prix = reg.prix[clePrix(l)];
  return `<tr><td>${echap(l.designation)}</td><td class="v">${fr(l.quantite, 0)}</td><td>${echap(l.unite)}</td>${avecPrix ? `<td class="v">${Number.isFinite(prix) ? echap(montant(prix)) : ""}</td><td class="v">${Number.isFinite(prix) ? echap(montant(prix * l.quantite)) : ""}</td>` : ""}</tr>`;
}).join("")}</table>
${avecPrix ? `<p>Total matériel : <b>${echap(montant(m.materiel))}</b>${reg.main_oeuvre ? ` · main-d'œuvre ${echap(montant(m.mainOeuvre))}` : ""} · total HT <b>${echap(montant(m.ht))}</b>${reg.tva ? ` · TVA ${echap(montant(m.tva))} · total TTC <b>${echap(montant(m.ttc))}</b>` : ""}${m.sansPrix ? ` (${m.sansPrix} ligne(s) sans prix)` : ""}</p>` : ""}
<ul class="small">${liste.notes.map((x) => `<li>${echap(x)}</li>`).join("")}</ul>`;
  }

  function rendreNote() {
    const zone = $("#note");
    const r = etat.resultat;
    if (!r && !etat.erreurs && !etat.manquants.length) return;
    const boutons = r ? `<button type="button" class="btn btn-primaire" data-export="note">Télécharger la note (.html)</button>
      <button type="button" class="btn" data-export="cables">Carnet de câbles (.csv)</button>
      <button type="button" class="btn" data-export="devis">Matériel et devis (.csv)</button>` : "";
    const entete = `<div class="bloc"><div class="bloc-titre"><h2>Note de calcul</h2>
      <span class="rangee">${boutons}<button type="button" class="btn" data-export="projet">Projet (.json)</button></span></div>
      <p class="discret" id="export-message">Chaque valeur renvoie à sa justification [Rn]. Outil d'aide à la conception : tables et hypothèses à valider contre l'édition en vigueur des normes et les fiches constructeurs ; toute note remise à un bureau de contrôle est validée par un ingénieur qualifié.</p></div>`;
    if (!r && etat.manquants.length) {
      zone.innerHTML = entete + guideHtml("La note sera prête quand ces informations seront saisies");
      return;
    }
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
${materielHtml(listeMateriel(r))}
<h2>Justifications</h2><ol>${r.references.map((x) => `<li>${echap(x)}</li>`).join("")}</ol>
<p class="small">Outil d'aide à la conception. Les tables normatives et les données de matériel sont des valeurs usuelles génériques à vérifier contre l'édition en vigueur des normes et les fiches constructeurs. Cette note doit être validée et signée par un ingénieur qualifié avant toute remise à un bureau de contrôle.</p>
</body></html>`;
  }

  /**
   * Fiche de relevé terrain à imprimer : toutes les informations utiles au dimensionnement, pré-remplies avec le projet
   * en cours (site, système, appareils) et complétées de lignes vides à remplir sur place.
   */
  function ficheReleveHtml(p) {
    const res = M.RESEAUX[p.reseau] || reseauActif();
    const ref = M.REFERENTIELS[p.referentiel] || referentielActif();
    const site = p.site || {};
    const v = (x, d = 1) => (x === null || x === undefined || x === "" || !Number.isFinite(Number(x)) ? "" : fr(x, d));
    const vide = (n, colonnes) => Array.from({ length: n }, () => `<tr>${"<td></td>".repeat(colonnes)}</tr>`).join("");
    const coche = (oui) => (oui ? "☒" : "☐");
    const lignesAppareils = [];
    for (const c of p.circuits || []) {
      for (const r of c.recepteurs || []) {
        const unite = uniteDe(r);
        const puissance = unite === "W" ? `${v(r.puissance_w, 0)} W` : `${v(r.valeur_saisie, 2)} ${unite}`;
        lignesAppareils.push(`<tr><td>${echap(c.nom)}</td><td>${echap(r.nom || "")}</td><td class="c">${v(r.quantite ?? 1, 0)}</td><td class="c">${echap(puissance)}</td>
          <td class="c">${v(r.cos_phi ?? 0.9, 2)}</td><td>${echap(ecrirePlages(r.plages))}</td><td class="c">${r.moteur ? echap(M.MODES_DEMARRAGE[r.demarrage || "direct"].libelle) : ""}</td>
          <td class="c">${v(c.longueur_m, 0)}</td><td></td></tr>`);
      }
    }
    const nVides = Math.max(12, 24 - lignesAppareils.length);
    const date = new Date().toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" });
    return `<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Fiche de relevé — ${echap(p.nom || "projet")}</title>
<style>body{font-family:Arial,Helvetica,sans-serif;color:#111;max-width:1000px;margin:24px auto;padding:0 16px;font-size:12px;line-height:1.35}
h1{font-size:19px;margin:0 0 2px}h2{font-size:14px;margin:18px 0 6px;padding:3px 6px;background:#eee;border-left:4px solid #a94b1c}
table{width:100%;border-collapse:collapse;margin:4px 0}td,th{border:1px solid #888;padding:4px 5px;text-align:left;vertical-align:top;height:18px}
th{background:#f3f3f3;font-size:11px}td.c{text-align:center}.l{width:34%;background:#fafafa}.grille{display:grid;grid-template-columns:1fr 1fr;gap:0 16px}
.astuce{border:1px dashed #a94b1c;padding:6px 8px;margin:8px 0;background:#fdf6f1}.petit{color:#555;font-size:11px}
@media print{body{margin:0;max-width:none}h2{break-after:avoid}table{break-inside:auto}tr{break-inside:avoid}}
@media (max-width:700px){.grille{grid-template-columns:1fr}}</style></head><body>
<h1>Fiche de relevé terrain — dimensionnement électrique</h1>
<p class="petit">Projet : <b>${echap(p.nom || "")}</b> · imprimée le ${date} · Relevé par : ________________________ · Date de la visite : ____ / ____ / ________</p>
<div class="astuce"><b>Sur place :</b> photographiez la plaque signalétique de chaque appareil (puissance en W, kW, CV ou HP, tension, courant en A, cos φ),
notez les heures réelles d'utilisation avec l'occupant, mesurez la longueur de câble entre le tableau et chaque usage, et relevez la position GPS.</div>

<h2>1. Projet et client</h2>
<div class="grille"><table>
<tr><td class="l">Client / maître d'ouvrage</td><td></td></tr><tr><td class="l">Téléphone</td><td></td></tr>
<tr><td class="l">Type de bâtiment</td><td></td></tr><tr><td class="l">Nombre d'occupants / de pièces</td><td></td></tr>
</table><table>
<tr><td class="l">Type de système</td><td>${coche(p.systeme === "hybride")} Hybride ${coche(p.systeme === "solaire")} Solaire autonome<br>${coche(p.systeme === "groupe")} Groupe seul ${coche(p.systeme === "reseau")} Réseau public</td></tr>
<tr><td class="l">Pays, norme</td><td>${echap(ref.nom)}</td></tr><tr><td class="l">Réseau (tension, fréquence)</td><td>${echap(res.nom)}</td></tr>
<tr><td class="l">Extensions prévues</td><td></td></tr>
</table></div>

<h2>2. Site</h2>
<div class="grille"><table>
<tr><td class="l">Ville, quartier</td><td></td></tr><tr><td class="l">Latitude (°)</td><td>${v(site.latitude, 4)}</td></tr>
<tr><td class="l">Longitude (°)</td><td>${v(site.longitude, 4)}</td></tr><tr><td class="l">Altitude (m)</td><td>${v(site.altitude_m, 0)}</td></tr>
<tr><td class="l">Température maximale (°C)</td><td>${v(site.t_amb_max, 0)}</td></tr><tr><td class="l">Température minimale (°C)</td><td>${v(site.t_amb_min, 0)}</td></tr>
</table><table>
<tr><td class="l">Surface disponible pour les panneaux (m²)</td><td></td></tr><tr><td class="l">Toiture : type, orientation, pente</td><td></td></tr>
<tr><td class="l">Ombrages (arbres, bâtiments)</td><td></td></tr><tr><td class="l">Local technique (batteries, onduleurs) : surface, ventilation</td><td></td></tr>
<tr><td class="l">Distance local technique → tableau (m)</td><td></td></tr><tr><td class="l">Emplacement du groupe, distance (m)</td><td></td></tr>
</table></div>

<h2>3. Appareils à alimenter</h2>
<p class="petit">Une ligne par type d'appareil. Puissance avec son unité (W, kW, CV, HP, kVA ou A). Heures : « 18-23 », « 8-17 60 % » (taux de marche pour les compresseurs et thermostats), plusieurs plages possibles.
Moteur (pompe, compresseur, moulin) : mode de démarrage (direct, étoile-triangle, progressif, variateur).</p>
<table><tr><th>Circuit / pièce</th><th>Appareil</th><th>Qté</th><th>Puissance unitaire</th><th>cos φ</th><th>Heures d'utilisation</th><th>Démarrage (moteur)</th><th>Longueur câble (m)</th><th>Remarques</th></tr>
${lignesAppareils.join("")}${vide(nVides, 9)}</table>

<h2>4. Raccordement au réseau public (si réseau)</h2>
<div class="grille"><table>
<tr><td class="l">Distributeur, n° de compteur</td><td></td></tr><tr><td class="l">Branchement BT ou poste privé</td><td></td></tr>
<tr><td class="l">Puissance souscrite (kVA)</td><td></td></tr><tr><td class="l">Coupures : fréquence, durée</td><td></td></tr>
</table><table>
<tr><td class="l">Icc maximal / minimal (kA, distributeur)</td><td></td></tr><tr><td class="l">Transformateur : kVA, u<sub>k</sub> %</td><td></td></tr>
<tr><td class="l">Groupe de secours : part secourue, autonomie (h)</td><td></td></tr><tr><td class="l">Câble source → tableau (m)</td><td></td></tr>
</table></div>

<h2>5. Ligne aérienne (si nécessaire)</h2>
<table><tr><th>Portée n°</th><th>Longueur (m)</th><th>Angle au poteau d'arrivée (°)</th><th>Charge au poteau d'arrivée (kVA)</th><th>Obstacle, traversée de route</th></tr>${vide(8, 5)}</table>
<p class="petit">Type de poteaux disponible : ${coche(false)} béton ${coche(false)} bois ${coche(false)} métal · hauteur : ______ m · conducteur existant : ____________________</p>

<h2>6. Installation existante et observations</h2>
<div class="grille"><table>
<tr><td class="l">Tableau existant (état, calibres)</td><td></td></tr><tr><td class="l">Prise de terre : valeur mesurée (Ω)</td><td></td></tr>
<tr><td class="l">Schéma de liaison à la terre (TT, TN, IT)</td><td></td></tr>
</table><table>
<tr><td class="l">Groupe ou onduleur existant (kVA)</td><td></td></tr><tr><td class="l">Photos prises (plaques, tableau, toiture)</td><td></td></tr>
<tr><td class="l">Contraintes d'accès, de sécurité</td><td></td></tr>
</table></div>
<table><tr><td style="height:90px">Remarques :</td></tr></table>
<p class="petit">Fiche générée par l'Agent de dimensionnement électrique (v${echap(M.VERSION)}). Saisissez ensuite ces informations dans l'application, ou décrivez-les à l'assistant.</p>
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
    else if (type === "devis" && etat.resultat) message = await proposerFichier(nomFichier("csv", "-materiel-devis"), devisCsv(listeMateriel(etat.resultat)), "text/csv");
    else if (type === "fiche") message = await proposerFichier(nomFichier("html", "-fiche-de-releve"), ficheReleveHtml(etat.projet), "text/html");
    if (message && zoneMessage) zoneMessage.textContent = message;
  }

  // ---------------------------------------------------------------------------
  // Application installable : application web (PWA), application Android, partage
  // ---------------------------------------------------------------------------

  const LIEN_WEB = "https://digitalbrainnk-boop.github.io/Nk/dimensionnement/app/";
  const LIEN_APK = "https://github.com/digitalbrainnk-boop/Nk/releases/latest/download/agent-dimensionnement.apk";
  const LIEN_PUBLICATION = "https://github.com/digitalbrainnk-boop/Nk/releases/latest";
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
      + `Android : téléchargez et installez ${LIEN_APK}\n(page de téléchargement : ${LIEN_PUBLICATION})\n\niPhone ou ordinateur : ouvrez ${LIEN_WEB} puis « Installer » ou « Sur l'écran d'accueil ».`;
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
- chercher_appareils : valeurs typiques du catalogue de l'application (plus de 200 équipements : éclairage, climatisation, froid, cuisine, pompes, moteurs, atelier, agro-transformation, santé, commerce, bornes de recharge) : puissance, cos φ, rendement, démarrage, heures d'utilisation, type de circuit.
- liste_materiel : liste du matériel tirée du calcul (équipements, câbles par section et longueur, disjoncteurs, différentiels, tableau) et montant du devis si l'utilisateur a saisi ses prix.

Règles :
1. Ne donne jamais un résultat de dimensionnement (kWc, kWh, kVA, kvar, sections, calibres, litres de gasoil, flèches, classes de poteaux) qui ne vient pas d'un outil ou du résumé de résultats fourni.
2. Quand on te décrit une installation, cherche d'abord les appareils dans le catalogue (chercher_appareils, une recherche par type d'appareil) et reprends ses valeurs, ajustées à ce que dit l'utilisateur (puissance de plaque, heures). Sinon, prends des valeurs typiques : puissance unitaire en W, cos φ, rendement pour les moteurs, plages horaires réalistes [début, fin, taux de marche 0-1], la plage peut passer minuit. Appelle ensuite modifier_projet en une seule fois (remplacer_circuits=true pour un nouveau projet, avec referentiel et reseau), puis calculer.
3. Regroupe par usage et donne à chaque circuit son type (champ type : eclairage, exterieur, prises, cuisine, specialise, cuisson, chauffe_eau, clim, froid, informatique, securite, medical, atelier, moteur, ve, autre) : l'application en déduit la protection et la section minimales usuelles. Un circuit par climatiseur, chauffe-eau, plaque de cuisson, moteur ou borne de recharge ; 8 points d'éclairage au plus par circuit. Un moteur : puissance utile en W, moteur=true, rendement 0,65 à 0,95, démarrage progressif ou variateur conseillé au-delà de 2 kW sur solaire. Réfrigérateurs, congélateurs et climatiseurs non inverter : moteur=true (compresseur), rendement 1 (puissance absorbée de la plaque). non_lineaire=true pour LED, informatique, variateurs et climatiseurs inverter. Plaque en CV : 1 CV = 735,5 W ; en HP : 745,7 W ; en kVA ou en A : P = S·cos φ = U·I·cos φ (× √3 en triphasé). triphase=true : triphasé sur un réseau triphasé, 240 V entre phases sur un réseau 120/240 V ; impossible sur 230 V monophasé. Longueur de chaque circuit estimée (15 à 60 m dans un bâtiment).
4. Systèmes : hybride, solaire, groupe, reseau. Pour reseau : source.type public (branchement du distributeur, Icc à demander au distributeur) ou transfo (poste privé), source.secours=true pour un groupe de secours (part_secourue 0-1, autonomie_h).
5. Ligne aérienne : ligne.actif=true, portees = [{longueur_m, angle_deg au poteau d'arrivée, charge_kva au poteau d'arrivée}], 30 à 50 m par portée en BT. Le conducteur, le climat et les supports suivent la norme si tu ne les fixes pas.
6. Si le lieu est une ville, mets ses coordonnées et son altitude approximatives et dis-le. N'invente pas d'irradiations mensuelles : laisse ghi_mensuel vide et rappelle qu'on peut saisir les valeurs PVGIS ou NASA POWER dans l'onglet Projet. Ajuste t_amb_max, t_amb_min et t_amb_jour au climat du lieu.
7. Liste en quelques puces les hypothèses que tu as prises, pour que l'utilisateur les corrige.
8. Après le calcul, présente le matériel retenu, ce qui dimensionne chaque équipement, puis les non-conformités et points d'attention avec l'action corrective. N'applique une correction que si l'utilisateur l'a demandée ; sinon propose-la.
9. Pour une question de cours (normes, formules), réponds directement en citant les articles de la norme du projet (NF C 15-100, IEC 60364, BS 7671, NEC, IEC 62548, ISO 8528, NESC…) et rappelle que les valeurs normatives se vérifient dans l'édition en vigueur.
10. Réponds court : quelques phrases et des listes à puces, unités SI, virgule décimale. Pas de tableau Markdown.
11. Le calcul attend que l'essentiel soit saisi : lieu (pour le solaire), altitude, températures maximale et minimale, au moins un appareil. Si le résumé indique des informations_manquantes, remplis-les avec modifier_projet à partir de ce que l'utilisateur a dit (une ville donne coordonnées, altitude et températures typiques de son climat, en le signalant), sinon pose-lui des questions courtes et précises.`;

  const SCHEMA_RECEPTEUR = { type: "object", properties: {
    nom: { type: "string" }, quantite: { type: "number" }, puissance_w: { type: "number", description: "W par appareil ; puissance utile pour un moteur" },
    cos_phi: { type: "number" }, rendement: { type: "number" }, ku: { type: "number" },
    plages: { type: "array", items: { type: "array", items: { type: "number" } }, description: "[[début h, fin h, taux 0-1], ...]" },
    moteur: { type: "boolean" }, demarrage: { type: "string", enum: Object.keys(M.MODES_DEMARRAGE) }, non_lineaire: { type: "boolean" } } };
  const SCHEMA_CIRCUIT = { type: "object", properties: {
    nom: { type: "string" }, type: { type: "string", enum: Object.keys(K.TYPES_CIRCUITS), description: "usage du circuit : fixe la protection et la section minimales" },
    triphase: { type: "boolean" }, longueur_m: { type: "number" }, ks: { type: "number" }, eclairage: { type: "boolean" },
    calibre_min: { type: "number" }, section_min: { type: "number" }, recepteurs: { type: "array", items: SCHEMA_RECEPTEUR } } };

  function resumeProjet() {
    const p = etat.projet;
    const res = M.RESEAUX[p.reseau] || reseauActif();
    return p.circuits.map((c, i) => `${i + 1}. ${c.nom} (${c.type ? `type ${c.type}, ` : ""}${libelleAlimentation(c.triphase, res)}, ${fr(c.longueur_m, 0)} m) : `
      + c.recepteurs.map((r) => `${fr(r.quantite, 0)} × ${r.nom} ${fr(r.puissance_w, 0)} W [${ecrirePlages(r.plages)}]`).join(", ")).join("\n");
  }
  function resumeResultats() {
    if (etat.manquants.length) return { calcul: "en attente", informations_manquantes: etat.manquants };
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
    const familleProjet = M.REFERENTIELS[p.referentiel].famille;
    /** Type de circuit donné par l'assistant : protections minimales du type, sauf valeurs qu'il a fixées lui-même. */
    const avecType = (c, donnees) => {
      if (!c.type || !K.TYPES_CIRCUITS[c.type]) { if (c.type) avertissements.push(`Type de circuit inconnu : ${c.type}.`); delete c.type; return c; }
      const preset = K.presetCircuit(c.type, familleProjet, c.triphase);
      for (const [cle, valeur] of Object.entries(preset)) if (donnees[cle] === undefined) c[cle] = valeur;
      return c;
    };
    for (const m of Array.isArray(entree.modifier_circuits) ? entree.modifier_circuits : []) {
      const c = p.circuits[Number(m.numero) - 1];
      if (c && m.champs && typeof m.champs === "object") {
        Object.assign(c, m.champs);
        if (m.champs.type !== undefined || m.champs.triphase !== undefined) avecType(c, m.champs);
      } else avertissements.push(`Circuit n° ${m.numero} introuvable.`);
    }
    const aSupprimer = (Array.isArray(entree.supprimer_circuits) ? entree.supprimer_circuits : []).map(Number).sort((a, b) => b - a);
    for (const numero of aSupprimer) {
      if (p.circuits[numero - 1]) p.circuits.splice(numero - 1, 1);
      else avertissements.push(`Circuit n° ${numero} introuvable.`);
    }
    if (Array.isArray(entree.circuits)) {
      const nouveaux = entree.circuits.filter((c) => c && typeof c === "object").map((c) => avecType({ ...c, recepteurs: Array.isArray(c.recepteurs) ? c.recepteurs : [] }, c));
      p.circuits = entree.remplacer_circuits ? nouveaux : p.circuits.concat(nouveaux);
    }
    // Un projet en cours de saisie peut ne pas encore avoir de circuit : seule une saisie invalide est refusée
    const erreurs = M.valider(p).erreurs.filter((e) => p.circuits.length || !/au moins un circuit/.test(e));
    if (erreurs.length) return { applique: false, erreurs };
    etat.projet = completer(p);
    rendreFormulaires();
    calculer();
    return { applique: true, avertissements, circuits: resumeProjet() || "(aucun circuit)", informations_manquantes: etat.manquants };
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
          etape(r.informations_manquantes ? "Calcul en attente : informations à compléter" : r.erreurs ? "Calcul impossible : entrées incomplètes" : "Calcul effectué");
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
        name: "chercher_appareils",
        description: "Cherche dans le catalogue de l'application les valeurs typiques d'un appareil (mots-clés : « climatiseur 12000 », « pompe immergée », « moulin », « réfrigérateur », « borne ») : puissance_w, cos_phi, rendement, ku, moteur, demarrage, non_lineaire, plages, type de circuit conseillé, triphasé conseillé.",
        inputSchema: { type: "object", properties: { recherche: { type: "string", description: "mots-clés, sans accents si besoin" },
          categorie: { type: "string", enum: K.CATEGORIES.map((c) => c.cle) } }, required: ["recherche"] },
        execute: (entree) => {
          const trouves = K.chercher(String((entree && entree.recherche) || ""), (entree && entree.categorie) || null, 12);
          etape(`Catalogue : ${trouves.length} appareil(s) pour « ${(entree && entree.recherche) || ""} »`);
          if (!trouves.length) return { trouves: 0, conseil: "Aucun appareil : essaie un mot plus simple (ex. « pompe », « clim », « frigo »), ou prends des valeurs typiques." };
          return trouves.map((a) => ({ nom: a.nom, puissance_w: a.puissance_w, cos_phi: a.cos_phi, rendement: a.rendement, ku: a.ku, moteur: a.moteur,
            demarrage: a.moteur ? a.demarrage : undefined, non_lineaire: a.non_lineaire, plages: a.plages, type_circuit: a.circuit,
            triphase_conseille: a.triphase || undefined, heures_par_jour: Math.round(K.heuresParJour(a.plages) * 10) / 10 }));
        },
      },
      {
        name: "liste_materiel",
        description: "Renvoie la liste du matériel du projet calculé (désignation, quantité, unité, catégorie) et le montant du devis si des prix ont été saisis dans l'onglet Matériel et devis.",
        execute: () => {
          if (!etat.resultat) throw new Error("Aucun résultat : le calcul attend des informations ou des corrections.");
          const liste = listeMateriel(etat.resultat);
          const m = montantsDevis(liste);
          etape("Liste du matériel");
          return { lignes: liste.lignes.map((l) => `${l.categorie} : ${fr(l.quantite, 0)} ${l.unite} — ${l.designation}`), notes: liste.notes,
            devis: m.sansPrix === liste.lignes.length ? "aucun prix saisi" : { materiel: montant(m.materiel), total_ht: montant(m.ht), total_ttc: etat.prix.tva ? montant(m.ttc) : undefined, lignes_sans_prix: m.sansPrix } };
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
    cle_invalide_kie: "La clé API Kie.ai est refusée : vérifiez-la dans les réglages de l'assistant.",
    credit_kie: "Crédits Kie.ai épuisés : rechargez votre compte sur kie.ai.",
    reseau_kie: "Kie.ai ne répond pas : vérifiez la connexion internet, puis réessayez.",
    api_kie: "Kie.ai a renvoyé une erreur.",
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
  // Cerveau de l'assistant hors de Claude : DeepSeek via Kie.ai (par défaut) ou Claude via l'API Anthropic
  const CLE_CERVEAU = "agent-dimensionnement:cerveau";
  const CLE_KIE = "agent-dimensionnement:cle-kie";
  const CLE_KIE_URL = "agent-dimensionnement:kie-url";
  const CLE_KIE_MODELE = "agent-dimensionnement:kie-modele";
  const KIE_URL = "https://api.kie.ai/openai/v1/responses";
  const KIE_MODELE = "deepseek-v4-1-flash";
  const CERVEAUX = {
    kie: { nom: "DeepSeek V4.1 Flash (Kie.ai)", aide: "Clé API de votre compte Kie.ai (kie.ai, rubrique API Key). Chaque demande consomme des crédits Kie.", indication: "clé API Kie.ai" },
    anthropic: { nom: "Claude Opus 5.5 (Anthropic)", aide: "Clé API Anthropic (console.anthropic.com, rubrique API Keys). Chaque demande est facturée sur son compte.", indication: "sk-ant-…" },
  };
  function lireStockage(cle) {
    try { return localStorage.getItem(cle) || ""; } catch (e) { return ""; }
  }
  function ecrireStockage(cle, valeur) {
    try {
      if (valeur) localStorage.setItem(cle, valeur);
      else localStorage.removeItem(cle);
    } catch (e) { /* stockage indisponible : réglage non retenu */ }
  }
  const cerveau = () => (lireStockage(CLE_CERVEAU) === "anthropic" ? "anthropic" : "kie");
  const cleCerveau = (c = cerveau()) => (c === "kie" ? lireStockage(CLE_KIE) : lireCle());
  const kieUrl = () => lireStockage(CLE_KIE_URL) || KIE_URL;
  const kieModele = () => lireStockage(CLE_KIE_MODELE) || KIE_MODELE;

  function rendreCleApi(message = "", formulaire = false) {
    const zone = $("#cle-api");
    const c = cerveau();
    const cle = cleCerveau(c);
    zone.hidden = false;
    agent.indisponible = !cle;
    $("#assistant-indispo").hidden = true;
    const choix = Object.entries(CERVEAUX).map(([id, x]) => `<label class="case"><input type="radio" name="cerveau" value="${id}" data-cerveau${id === c ? " checked" : ""}> ${echap(x.nom)}</label>`).join("");
    zone.innerHTML = cle && !formulaire
      ? `<div>${statutHtml("ok", "Assistant actif")} Cerveau : <strong>${echap(CERVEAUX[c].nom)}</strong>, clé …${echap(cle.slice(-4))}. ${echap(CERVEAUX[c].aide.split(". ").slice(1).join(". "))}</div>
        <div class="rangee"><button type="button" class="btn" data-cle="tester">Tester la connexion</button><button type="button" class="btn btn-discret" data-cle="changer">Changer de cerveau ou de clé</button><button type="button" class="btn btn-discret btn-danger" data-cle="supprimer">Retirer la clé</button></div>
        <div class="discret" data-cle-message></div>`
      : `<div><strong>Assistant IA hors de Claude.</strong> Choisissez son cerveau et saisissez votre clé API : elle reste enregistrée sur cet appareil et n'est envoyée qu'au service choisi.</div>
        <form class="cle-formulaire" data-cle-form>
          <div class="choix-cerveau">${choix}</div>
          <small data-cle-aide>${echap(CERVEAUX[c].aide)}</small>
          <div class="rangee"><input type="text" autocomplete="off" autocapitalize="off" autocorrect="off" spellcheck="false" placeholder="${echap(CERVEAUX[c].indication)}" aria-label="Clé API" data-cle-saisie>
          <button type="button" class="btn" data-cle="coller">Coller</button></div>
          <small data-cle-retour role="status">Copiez la clé sur kie.ai, puis touchez « Coller ». Vous pouvez aussi la taper.</small>
          <div class="rangee"><button type="submit" class="btn btn-primaire">Activer l'assistant</button></div>
          <details class="avance" data-kie-avance${c === "kie" ? "" : " hidden"}><summary>Réglages avancés Kie.ai</summary>
            <label class="champ"><span>Adresse de l'API</span><input type="text" data-kie-url placeholder="${echap(KIE_URL)}" value="${echap(lireStockage(CLE_KIE_URL))}" autocomplete="off" spellcheck="false"></label>
            <label class="champ"><span>Modèle</span><input type="text" data-kie-modele placeholder="${echap(KIE_MODELE)}" value="${echap(lireStockage(CLE_KIE_MODELE))}" autocomplete="off" spellcheck="false"></label>
          </details>
        </form>
        <div class="discret">Sans clé, tous les onglets de calcul restent utilisables, hors connexion.</div>`;
    if (message) zone.append(html(`<div class="discret">${echap(message)}</div>`));
    $("#suggestions").hidden = !cle || $("#fil").childElementCount > 1;
    majSaisie(false);
  }
  async function testerConnexion() {
    const zone = $("[data-cle-message]");
    zone.textContent = "Test en cours…";
    const sample = echantillonneur();
    try {
      const { text } = await sample([{ role: "user", content: "Tu es un assistant de test." }, { role: "user", content: "Réponds seulement : OK" }], { tools: [] });
      zone.textContent = `Connexion réussie. Réponse : « ${String(text).trim().slice(0, 80)} »`;
    } catch (e) {
      zone.textContent = `Échec : ${MESSAGES_ERREUR[e && e.code] || ""} ${e && e.detail ? `(${e.detail})` : ""}`.trim();
    }
  }
  /** Clé copiée telle quelle : on retire espaces, retours à la ligne, guillemets et un éventuel « Bearer ». */
  function nettoyerCle(texte) {
    return String(texte || "").trim().replace(/^Bearer\s+/i, "").replace(/[\s"'`«»]/g, "");
  }
  /** Bouton « Coller » : presse-papiers lu par Android dans l'application, sinon par le navigateur. */
  async function collerCle() {
    const champ = $("[data-cle-saisie]");
    const retour = $("[data-cle-retour]");
    let texte = "";
    try {
      if (window.AndroidApp && typeof window.AndroidApp.lirePressePapiers === "function") texte = window.AndroidApp.lirePressePapiers();
      else if (navigator.clipboard && navigator.clipboard.readText) texte = await navigator.clipboard.readText();
    } catch (e) { texte = ""; }
    const cle = nettoyerCle(texte);
    if (cle) {
      champ.value = cle;
      retour.textContent = `Clé collée (${cle.length} caractères, se termine par …${cle.slice(-4)}). Touchez « Activer l'assistant ».`;
    } else {
      retour.textContent = "Le presse-papiers est vide ou inaccessible : copiez d'abord la clé sur kie.ai, ou appuyez longuement dans le champ puis « Coller », ou tapez la clé.";
      champ.focus();
    }
  }
  function brancherCleApi() {
    const zone = $("#cle-api");
    zone.addEventListener("change", (e) => {
      if (!e.target.matches("[data-cerveau]")) return;
      const c = e.target.value;
      $("[data-cle-aide]", zone).textContent = CERVEAUX[c].aide;
      $("[data-cle-saisie]", zone).placeholder = CERVEAUX[c].indication;
      $("[data-kie-avance]", zone).hidden = c !== "kie";
    });
    zone.addEventListener("submit", (e) => {
      e.preventDefault();
      const cle = nettoyerCle($("[data-cle-saisie]", zone).value);
      // Une clé Anthropic se reconnaît à son préfixe : le bon cerveau est choisi d'office
      const c = cle.startsWith("sk-ant-") ? "anthropic" : $("[data-cerveau]:checked", zone).value;
      if (!cle && cleCerveau(c)) { // changement de cerveau avec une clé déjà enregistrée
        ecrireStockage(CLE_CERVEAU, c);
        rendreCleApi(`Cerveau : ${CERVEAUX[c].nom}.`);
        return;
      }
      if (c === "anthropic" && !/^sk-ant-[A-Za-z0-9_-]{20,}$/.test(cle)) {
        rendreCleApi("Cette clé ne ressemble pas à une clé API Anthropic (elle commence par « sk-ant- »).");
        return;
      }
      if (c === "kie" && cle.length < 16) {
        rendreCleApi(cle ? "Cette clé est trop courte : copiez la clé complète depuis kie.ai (rubrique API Key)." : "Collez ou tapez d'abord la clé API Kie.ai.");
        return;
      }
      if (c === "kie") {
        const url = $("[data-kie-url]", zone).value.trim();
        if (url && !/^https:\/\/[^\s]+$/.test(url)) {
          rendreCleApi("L'adresse de l'API doit commencer par https://");
          return;
        }
        ecrireStockage(CLE_KIE_URL, url === KIE_URL ? "" : url);
        const modele = $("[data-kie-modele]", zone).value.trim();
        ecrireStockage(CLE_KIE_MODELE, modele === KIE_MODELE ? "" : modele);
        ecrireStockage(CLE_KIE, cle);
      } else {
        ecrireCle(cle);
      }
      ecrireStockage(CLE_CERVEAU, c);
      rendreCleApi("Clé enregistrée sur cet appareil. Touchez « Tester la connexion » pour vérifier.");
    });
    zone.addEventListener("click", (e) => {
      const b = e.target.closest("[data-cle]");
      if (!b) return;
      if (b.dataset.cle === "tester") { testerConnexion(); return; }
      if (b.dataset.cle === "coller") { collerCle(); return; }
      if (b.dataset.cle === "supprimer") {
        if (cerveau() === "kie") ecrireStockage(CLE_KIE, ""); else ecrireCle("");
        rendreCleApi("Clé retirée de cet appareil.");
        return;
      }
      // Changer : les clés enregistrées restent valables tant qu'une autre n'est pas saisie
      rendreCleApi("", true);
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

  /** Requête POST JSON : par le pont natif dans l'application Android (pas de restriction CORS), sinon fetch. */
  let requetesAndroid = 0;
  const attentesAndroid = new Map();
  window.__reponseAndroid = (id, statut, texte) => {
    const attente = attentesAndroid.get(id);
    if (attente) { attentesAndroid.delete(id); attente({ statut, texte }); }
  };
  function posterJson(url, cle, corps, signal) {
    if (window.AndroidApp && typeof window.AndroidApp.requete === "function") {
      return new Promise((ok, ko) => {
        const id = `r${++requetesAndroid}`;
        attentesAndroid.set(id, ok);
        if (signal) signal.addEventListener("abort", () => { attentesAndroid.delete(id); ko(erreurCode("cancelled")); }, { once: true });
        window.AndroidApp.requete(id, url, cle, JSON.stringify(corps));
      });
    }
    return fetch(url, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${cle}` }, body: JSON.stringify(corps), signal })
      .then(async (r) => ({ statut: r.status, texte: await r.text() }))
      .catch((e) => {
        if (e && e.name === "AbortError") throw erreurCode("cancelled");
        return { statut: 0, texte: String((e && e.message) || e) };
      });
  }
  async function appelKie(corps, cle, signal) {
    const { statut, texte } = await posterJson(kieUrl(), cle, corps, signal);
    if (statut === 0) throw Object.assign(erreurCode(navigator.onLine === false ? "hors_ligne" : "reseau_kie"), { detail: texte.slice(0, 160) });
    let json = null;
    try { json = JSON.parse(texte); } catch (e) { /* réponse non JSON */ }
    // Kie.ai enveloppe certaines réponses : { code, msg, data }
    const enveloppe = json && typeof json.code === "number" && "msg" in json;
    const code = enveloppe ? json.code : statut;
    if (statut >= 400 || (enveloppe && code !== 200)) {
      const message = String((json && (json.msg || (json.error && (json.error.message || json.error)) || json.message)) || texte || `HTTP ${statut}`).slice(0, 240);
      if (code === 401 || code === 403) throw Object.assign(erreurCode("cle_invalide_kie"), { detail: message });
      if (code === 402 || /credit|insufficient|balance|solde/i.test(message)) throw Object.assign(erreurCode("credit_kie"), { detail: message });
      if (code === 429) throw Object.assign(erreurCode("rate_limited"), { detail: message });
      throw Object.assign(erreurCode("api_kie"), { statut: code, detail: message });
    }
    if (!json) throw Object.assign(erreurCode("api_kie"), { detail: texte.slice(0, 160) });
    return enveloppe ? json.data : json;
  }
  /** Texte et appels d'outils d'une réponse « Responses » (ou « chat/completions », par compatibilité). */
  function lireReponseKie(r) {
    const textes = [];
    const appels = [];
    if (r && Array.isArray(r.output)) {
      for (const item of r.output) {
        if (item.type === "message") {
          for (const c of item.content || []) if ((c.type === "output_text" || c.type === "text") && c.text) textes.push(c.text);
        } else if (item.type === "function_call") {
          appels.push({ id: item.call_id || item.id, nom: item.name, arguments: item.arguments });
        }
      }
    } else if (r && Array.isArray(r.choices) && r.choices[0]) {
      const m = r.choices[0].message || {};
      if (m.content) textes.push(m.content);
      for (const t of m.tool_calls || []) appels.push({ id: t.id, nom: t.function && t.function.name, arguments: t.function && t.function.arguments });
    }
    if (!textes.length && r && typeof r.output_text === "string" && r.output_text) textes.push(r.output_text);
    return { texte: textes.join("\n").trim(), appels };
  }
  function lireArguments(brut) {
    if (brut && typeof brut === "object") return brut;
    const objet = JSON.parse(brut || "{}");
    if (!objet || typeof objet !== "object" || Array.isArray(objet)) throw new Error("Entrée d'outil invalide : un objet JSON est attendu.");
    return objet;
  }
  async function executerOutil(outils, nom, args, signal) {
    const outil = outils.find((o) => o.name === nom);
    try {
      if (!outil) throw new Error(`Outil inconnu : ${nom}`);
      return JSON.stringify((await outil.execute(lireArguments(args), { signal })) ?? null);
    } catch (e) {
      return JSON.stringify({ erreur: String((e && e.message) || e) });
    }
  }
  /** Protocole de secours si le modèle n'accepte pas les outils natifs : blocs <outil nom="…">{JSON}</outil> dans le texte. */
  function consignesModeTexte(outils) {
    return `\n\nOUTILS. Tu n'as pas d'appel de fonction natif ici. Pour utiliser un outil, écris uniquement un bloc de cette forme, sans autre texte :\n<outil nom="NOM">{entrée JSON}</outil>\n`
      + `Tu recevras le résultat dans le message suivant, puis tu continues. Quand tu as fini, réponds normalement à l'utilisateur, sans bloc.\nOutils disponibles :\n`
      + outils.map((o) => `- ${o.name} : ${o.description} Entrée : ${JSON.stringify(o.inputSchema || { type: "object", properties: {} })}`).join("\n");
  }
  const BLOC_OUTIL = /<outil\s+nom="([\w-]+)"\s*>([\s\S]*?)<\/outil>/g;

  function echantillonneurKie(cle) {
    let modeTexte = false;
    const sample = async (entree, options) => {
      const [consignes, ...historique] = entree;
      const outils = options.tools || [];
      const tools = outils.map((o) => ({ type: "function", name: o.name, description: o.description, parameters: o.inputSchema || { type: "object", properties: {} } }));
      const input = historique.map((m) => ({ role: m.role, content: m.content }));
      let texte = "";
      const montrer = (t) => {
        if (!t) return;
        texte += (texte ? "\n\n" : "") + t;
        if (options.onText) options.onText({ text: texte, delta: t });
      };
      for (let tour = 0; tour < 12; tour++) {
        const corps = { model: kieModele(), instructions: consignes.content + (modeTexte && outils.length ? consignesModeTexte(outils) : ""), input, stream: false };
        if (tools.length && !modeTexte) { corps.tools = tools; corps.tool_choice = "auto"; }
        let r;
        try {
          r = lireReponseKie(await appelKie(corps, cle, options.signal));
        } catch (e) {
          // Outils natifs refusés par le modèle : on bascule sur le protocole texte et on recommence ce tour
          if (e.code === "api_kie" && tools.length && !modeTexte && (e.statut === 400 || e.statut === 422 || /tool|function/i.test(e.detail || ""))) {
            modeTexte = true;
            continue;
          }
          e.text = texte;
          throw e;
        }
        if (!modeTexte) {
          montrer(r.texte);
          if (!r.appels.length) return { text: texte || "(réponse vide)", truncated: false };
          if (r.texte) input.push({ role: "assistant", content: r.texte });
          for (const appel of r.appels) {
            const args = typeof appel.arguments === "string" ? appel.arguments : JSON.stringify(appel.arguments || {});
            input.push({ type: "function_call", call_id: appel.id, name: appel.nom, arguments: args });
            input.push({ type: "function_call_output", call_id: appel.id, output: await executerOutil(outils, appel.nom, appel.arguments, options.signal) });
          }
          continue;
        }
        const blocs = [...r.texte.matchAll(BLOC_OUTIL)];
        montrer(r.texte.replace(BLOC_OUTIL, "").trim());
        if (!blocs.length) return { text: texte || "(réponse vide)", truncated: false };
        input.push({ role: "assistant", content: r.texte });
        const resultats = [];
        for (const [, nom, json] of blocs) resultats.push(`Résultat de ${nom} : ${await executerOutil(outils, nom, json.trim(), options.signal)}`);
        input.push({ role: "user", content: resultats.join("\n\n") });
      }
      return { text: texte, truncated: true };
    };
    sample.limits = async () => ({ tools: { maxCount: 16 } });
    return sample;
  }
  /** Échantillonneur de l'assistant hors de Claude, selon le cerveau choisi (null sans clé). */
  function echantillonneur() {
    const c = cerveau();
    const cle = cleCerveau(c);
    if (!cle) return null;
    return c === "kie" ? echantillonneurKie(cle) : echantillonneurApi(cle);
  }

  async function envoyer(texte) {
    texte = texte.trim();
    if (!texte || agent.enCours || agent.indisponible) return;
    majSaisie(true);
    const sample = window.claude ? await capacite("sample") : echantillonneur();
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
      else zoneTexte.append(html(`<p class="discret">${echap(MESSAGES_ERREUR[code] || "La réponse a été interrompue. Réessayez.")}${e && e.detail ? ` (${echap(e.detail)})` : ""}</p>`));
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
    const intro = etat.projet.circuits.length
      ? `<p>Projet ouvert : <strong>${echap(etat.projet.nom)}</strong>${s ? ` (${fr(s.energie_kwh_j, 1)} kWh/j) : ${echap(resume)}.` : "."}</p>`
      : `<p>Nouveau projet, vide. Dites-moi le lieu (ville), le type d'installation et les appareils à alimenter avec leurs heures d'utilisation.</p>`;
    ajouterMessage("agent", `${intro}
      <p>Décrivez votre bâtiment, vos appareils et le lieu : je choisis la norme du pays (NF C 15-100, IEC 60364, BS 7671 ou NEC), je remplis le projet, je lance le calcul et je vous explique le matériel retenu. Vous pouvez aussi me poser une question sur une norme ou un résultat.</p>`);
    $("#suggestions").hidden = false;
    const suggestions = etat.projet.circuits.length
      ? ["Explique-moi le matériel retenu et ce qui le dimensionne.", "Quelles corrections faut-il faire ?", "Donne-moi la liste du matériel à acheter.", "Compare les quatre systèmes pour ce projet."]
      : ["Quelles informations faut-il pour dimensionner mon installation ?", "Je veux une installation solaire avec batteries pour ma maison.",
        "Je veux dimensionner un groupe électrogène pour mon bâtiment.", "Quelle norme dois-je utiliser dans mon pays ?"];
    $("#suggestions").innerHTML = suggestions.map((t) => `<button type="button">${echap(t)}</button>`).join("");
  }

  // ---------------------------------------------------------------------------
  // Démarrage
  // ---------------------------------------------------------------------------

  function demarrer() {
    etat.prix = lirePrix();
    etat.projet = chargerProjet();
    construireProjet();
    construireChoix();
    construireLigne();
    $("#bibliotheque").innerHTML = K.APPAREILS.map((a) => `<option value="${echap(a.nom)}"></option>`).join("");
    rendreFormulaires();

    let onglet = null;
    try { onglet = localStorage.getItem(CLE_ONGLET); } catch (e) { /* sans effet */ }
    const hash = location.hash.replace("#", "");
    if (["assistant", "projet", "charges", "choix", "ligne", "resultats", "materiel", "note"].includes(hash)) onglet = hash;
    ouvrirOnglet(onglet || (informationsManquantes().length ? "projet" : ETROIT.matches ? "assistant" : "resultats"), false);
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
    brancherCatalogue();
    brancherMateriel();
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
    $("#btn-vide").addEventListener("click", () => { $("#confirmation-vide").hidden = false; });
    $("#btn-vide-non").addEventListener("click", () => { $("#confirmation-vide").hidden = true; });
    $("#btn-vide-oui").addEventListener("click", () => {
      $("#confirmation-vide").hidden = true;
      remplacerProjet(projetVide());
      $("#fichier-message").textContent = "Projet vide créé : suivez les étapes ci-dessus ou décrivez votre installation à l'assistant.";
      allerA("projet");
    });
    $("#btn-reinit").addEventListener("click", () => { $("#confirmation-reinit").hidden = false; });
    $("#btn-reinit-non").addEventListener("click", () => { $("#confirmation-reinit").hidden = true; });
    $("#btn-reinit-oui").addEventListener("click", () => {
      $("#confirmation-reinit").hidden = true;
      reinitialiserApplication();
      $("#fichier-message").textContent = "Application réinitialisée : toutes les données de cet appareil ont été effacées.";
    });
    $("#btn-gps").addEventListener("click", utiliserPosition);
    document.addEventListener("click", (e) => {
      const b = e.target.closest("[data-aller]");
      if (b) allerA(b.dataset.aller);
    });
    $("#btn-exporter").addEventListener("click", () => exporter("projet", $("#fichier-message")));
    $("#btn-fiche").addEventListener("click", () => exporter("fiche", $("#fichier-message")));
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
