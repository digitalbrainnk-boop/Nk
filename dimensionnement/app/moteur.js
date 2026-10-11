/*
 * Moteur de dimensionnement électrique — bâtiment BT, solaire, batteries, groupe électrogène.
 *
 * Portage JavaScript du démonstrateur Python (../demo_hybride.py), mêmes formules et mêmes tables ;
 * les tests vérifient que les deux donnent les mêmes résultats sur le cas de référence.
 * Script classique sans dépendance : dans le navigateur il définit window.Moteur ; dans Node,
 * `import "./moteur.js"` définit globalThis.Moteur.
 *
 * Outil d'aide à la conception : tables et hypothèses à valider contre l'édition en vigueur des normes
 * et les fiches constructeurs ; toute note remise à un bureau de contrôle est validée par un ingénieur.
 */
(function (racine) {
  "use strict";

  // ===========================================================================
  // 0. Références (justifications publiées dans la note)
  // ===========================================================================

  const R = {
    BOUCHEROT: "Théorème de Boucherot : P et Q s'additionnent séparément, S = √(P² + Q²)",
    KU_KS: "Guide UTE C 15-105 / pratique Schneider : P = ks · Σ(ku · Pabs)",
    KS_TABLEAU: "IEC 61439-2 Tab. 101 : facteur de diversité assigné (2-3 circ. 0,9 ; 4-5 : 0,8 ; 6-9 : 0,7 ; ≥10 : 0,6)",
    IB: "I_B = S/(√3·U) en triphasé ; I_B = S/U0 en monophasé",
    PROT: "IEC 60364-4-43 §433.1 : I_B ≤ In ≤ Iz et I2 ≤ 1,45·Iz",
    IZ: "IEC 60364-5-52 Ann. B, méthode E, cuivre PR (XLPE) 90 °C, 30 °C ambiant",
    KT: "IEC 60364-5-52 Ann. B : k_θ = √((θp − θa)/(θp − θref))",
    KG: "IEC 60364-5-52 Tab. B.52.17 : facteurs de groupement",
    DU: "NF C 15-100 §525 / IEC 60364-5-52 Ann. G : ΔU = b(ρ1·L/S·cosφ + λ·L·sinφ)·I_B ; 3 % éclairage, 5 % autres",
    DU_DC: "Guide UTE C 15-712-1 / IEC 62548 : ΔU = 2ρL·I/S, viser ≤ 1 % (3 % max) côté continu",
    ADIAB: "IEC 60364-4-43 §434.5.2 : S ≥ I·√t / k (k = 143 Cu-PR, 115 Cu-PVC)",
    COURBES: "IEC 60898-1 : déclenchement magnétique B 3-5·In, C 5-10·In, D 10-20·In",
    TCOUP: "IEC 60364-4-41 Tab. 41.1 : coupure ≤ 0,4 s (TN, 230 V, circuits terminaux ≤ 32 A)",
    ICC: "IEC 60909-0 : facteur de tension c_min = 0,95 ; ρ ≈ 1,5·ρ0 pour Icc mini (UTE C 15-105)",
    SOL_GEO: "Duffie & Beckman : déclinaison de Cooper, H0 extraterrestre (Gsc = 1367 W/m²)",
    SOL_DIFF: "Erbs et al. (corrélation mensuelle de la fraction diffuse)",
    SOL_TRANSPO: "Liu & Jordan (modèle isotrope), Rb mensuel de Klein",
    SOL_HORAIRE: "Collares-Pereira & Rabl : répartition horaire de l'irradiation journalière",
    PV_TEMP: "T_cell = T_amb + (NOCT − 20)/800·G ; P = Pstc·(1 + γ·(T_cell − 25))",
    PV_CHAINES: "IEC 62548 / UTE C 15-712-1 : Voc(Tmin) ≤ Vmax, Vmp(Tmax) ≥ Vmppt,min, Isc(Tmax)·Np ≤ Imax",
    PV_FUS: "IEC 62548 : protection de chaîne si (Np − 1)·1,25·Isc > I_RM ; 1,5·Isc ≤ In ≤ 2,4·Isc",
    PV_CABLE: "EN 50618 (H1Z2Z2-K) : câble seul à l'air libre, 60 °C ambiant, âme 120 °C ; I_B = 1,25·Isc",
    PV_PC: "Pc = E_PV / (PSH · PR) ; PSH = H_T / 1 kW/m²",
    BATT: "IEEE 1013 / IEEE 1562 : C = E·N_aut·k_vieill·k_T / (η_ond·DoD)",
    BATT_VIEIL: "IEEE 485 : facteur de vieillissement 1,25 (plomb, fin de vie à 80 %)",
    ONDULEUR: "S_ond·k_θ ≥ S_pointe·k_e par phase ; surcharge ≥ S_démarrage + S_reste",
    GE_ISO: "ISO 8528-1 : PRP, puissance moyenne ≤ 70 % (valeurs < 30 % comptées 30 %, arrêts exclus)",
    GE_DIP: "Chute transitoire ΔU = x'd·Sd/(S_GE + x'd·Sd) ; classes ISO 8528-5 (G2 : 20 %, G3 : 15 %)",
    GE_DERATE: "ISO 3046-1 / ISO 8528-1 : conditions de référence 25 °C, 100 kPa, 30 % HR ; déclassement selon courbe constructeur",
    GE_CONSO: "Droite de Willans : F = a·P_sortie + b·P_assignée (a ≈ 0,246 L/kWh, b ≈ 0,0815 L/h/kW)",
    GE_ICC: "Alternateur : I''k3 = In/x''d ; courant maintenu ≈ 3·In avec excitation AREP/PMG",
    ATS: "IEC 60947-6-1 : inverseur de source, catégorie AC-33A, 4 pôles en TN-S",
    HYP: "Hypothèse de conception (paramétrable)",
    SIM: "Simulation horaire 8760 h, stratégie cycle charging",
  };

  // ===========================================================================
  // 1. Référentiel embarqué (valeurs usuelles — à vérifier)
  // ===========================================================================

  const U_NOMINALE = 400; // V entre phases
  const U0 = 230; // V phase-neutre
  const SQRT3 = Math.sqrt(3);

  const SECTIONS_MM2 = [1.5, 2.5, 4, 6, 10, 16, 25, 35, 50, 70, 95, 120, 150, 185, 240, 300];
  const IZ_CU_PR_E = {
    3: [23, 31, 42, 54, 75, 100, 127, 158, 192, 246, 298, 346, 399, 456, 538, 621],
    2: [26, 36, 49, 63, 86, 115, 149, 185, 225, 289, 352, 410, 473, 542, 641, 741],
  };
  const SECTIONS_PV = [1.5, 2.5, 4, 6, 10, 16, 25, 35];
  const IZ_PV = [30, 41, 55, 70, 98, 132, 176, 218];

  const FACTEURS_GROUPEMENT = {
    faisceau: [[1, 1.0], [2, 0.8], [3, 0.7], [4, 0.65], [5, 0.6], [6, 0.57], [7, 0.54], [8, 0.52], [9, 0.5],
      [12, 0.45], [16, 0.41], [20, 0.38]],
    couche_paroi: [[1, 1.0], [2, 0.85], [3, 0.79], [4, 0.75], [5, 0.73], [6, 0.72], [7, 0.72], [8, 0.71], [9, 0.7]],
    couche_chemin_perfore: [[1, 1.0], [2, 0.88], [3, 0.82], [4, 0.77], [5, 0.75], [6, 0.73], [7, 0.73], [8, 0.72],
      [9, 0.72]],
  };

  const RHO_CU = 0.023;
  const RHO_CU_CC_MIN = 0.028;
  const LAMBDA_X = 0.08e-3;
  const K_ADIABATIQUE_CU_PR = 143;

  const CALIBRES_DISJ = [6, 10, 16, 20, 25, 32, 40, 50, 63, 80, 100, 125, 160, 200, 250, 320, 400, 500, 630,
    800, 1000, 1250, 1600, 2000, 2500, 3200, 4000];
  const CALIBRES_FUSIBLES_DC = [63, 80, 100, 125, 160, 200, 250, 315, 355, 400, 500, 630, 800, 1000, 1250];
  const CALIBRES_GPV = [10, 12, 15, 16, 20, 25, 30, 32];
  const CALIBRES_INVERSEURS = [40, 63, 80, 100, 125, 160, 250, 400, 630, 800, 1000, 1250, 1600, 2000, 2500, 3200, 4000];
  const MAGNETIQUE_MAX = { B: 5, C: 10, D: 20 };
  const MAGNETIQUE_MIN = { B: 3, C: 5, D: 10 };

  const GAMME_GE_KVA = [9, 13, 16, 20, 22, 27, 33, 40, 45, 50, 60, 66, 80, 100, 110, 135, 150, 165, 200, 220,
    250, 275, 330, 400, 450, 500, 550, 630, 700, 800, 900, 1000, 1100, 1250, 1400, 1650, 2000, 2250, 2500];
  const GAMME_ONDULEURS_VA = [3000, 5000, 8000, 10000, 15000];

  const MODES_DEMARRAGE = {
    direct: { id_in: 7.0, cos_phi_d: 0.35, libelle: "démarrage direct" },
    etoile_triangle: { id_in: 2.5, cos_phi_d: 0.40, libelle: "étoile-triangle" },
    progressif: { id_in: 3.5, cos_phi_d: 0.45, libelle: "démarreur progressif" },
    variateur: { id_in: 1.2, cos_phi_d: 0.85, libelle: "variateur de vitesse" },
  };

  const CHIMIES = {
    lifepo4: {
      nom: "LiFePO4 (lithium fer phosphate)",
      dod: 0.8, rendement_aller_retour: 0.95, facteur_vieillissement: 1.1,
      coef_temp: 0.0, c_charge_max: 0.5, c_decharge_max: 0.5, soc_arret_ge: 0.7,
      u_cellule: 3.2, u_charge_cellule: 3.55, u_min_cellule: 3.0,
      ah_unite: 100, r_interne_unite_16s: 0.025,
      ref: "IEC 62619 (sécurité des accumulateurs Li industriels) ; fiche constructeur",
    },
    plomb: {
      nom: "Plomb OPzV (GEL tubulaire, éléments 2 V)",
      dod: 0.5, rendement_aller_retour: 0.85, facteur_vieillissement: 1.25,
      coef_temp: 0.01, c_charge_max: 0.15, c_decharge_max: 0.2, soc_arret_ge: 0.85,
      u_cellule: 2.0, u_charge_cellule: 2.4, u_min_cellule: 1.85,
      gamme_ah: [200, 250, 300, 350, 420, 490, 600, 800, 1000, 1200, 1500, 2000, 2500, 3000],
      r_interne_1000ah: 0.00025,
      ref: R.BATT_VIEIL,
    },
  };

  const SYSTEMES = {
    hybride: "Hybride : solaire + batteries + groupe d'appoint",
    solaire: "Solaire autonome : solaire + batteries",
    groupe: "Groupe électrogène seul",
  };

  const JOURS_TYPES = [17, 47, 75, 105, 135, 162, 198, 228, 258, 288, 318, 344];
  const JOURS_PAR_MOIS = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  const MOIS = ["Jan", "Fév", "Mar", "Avr", "Mai", "Juin", "Juil", "Août", "Sep", "Oct", "Nov", "Déc"];
  const GSC = 1367;

  // ===========================================================================
  // 2. Valeurs par défaut des entrées
  // ===========================================================================

  const SITE = {
    latitude: 5.35, longitude: -4.0, altitude_m: 300,
    t_amb_max: 40, t_amb_min: 18, t_amb_jour: 31, t_local_ge: 45,
    ghi_mensuel: null, albedo: 0.2,
  };

  const MODULE_PV = {
    nom: "Module monocristallin 550 Wc (générique)",
    p_wc: 550, vmp: 41.9, imp: 13.13, voc: 49.9, isc: 13.98,
    coef_p: -0.35, coef_voc: -0.27, coef_isc: 0.048, noct: 45, i_inverse_max: 25,
  };

  const REGULATEUR = {
    nom: "Régulateur MPPT 450 V / 100 A (générique)",
    v_dc_max: 450, v_mppt_min: 80, v_mppt_max: 420, isc_max: 40, i_charge_max: 100,
  };

  const HYPOTHESES = {
    k_extension: 1.2,
    kt_defaut: 0.5, inclinaison_deg: null, inclinaison_min_deg: 10,
    pertes_encrassement: 0.03, pertes_dispersion: 0.02, pertes_cables_dc: 0.02, rendement_mppt: 0.98,
    degradation_annuelle: 0.005, annees_conception: 10, couverture_mois_critique: 1.0,
    ratio_pv_mppt_max: 1.2, longueur_chaine_m: 30, t_cable_pv: 70,
    chimie: "lifepo4", jours_autonomie: 1.0, t_batterie_min: 20, longueur_batterie_m: 3,
    rendement_onduleur: 0.94, rendement_chargeur: 0.93, k_temp_onduleur: 0.8, surcharge_onduleur: 2.0,
    k_cc_onduleur: 2.0, heures_recharge_cible: 5, longueur_onduleur_tgbt_m: 5,
    xd_transitoire: 0.2, xd_subtransitoire: 0.12, chute_tension_max: 0.15, k_cc_maintenu_ge: 3.0,
    altitude_sans_declassement: 1000, declassement_altitude_pct_100m: 1.0,
    temperature_sans_declassement: 40, declassement_temp_pct_degc: 1.0, declassement_humidite: 0,
    taux_charge_cible_ge: 0.7, taux_charge_min_ge: 0.3, conso_a: 0.246, conso_b: 0.08145, longueur_ge_m: 25,
    disposition_circuits: "couche_chemin_perfore",
    chute_max_eclairage: 3, chute_max_autres: 5, chute_max_dc: 1, chute_max_pv: 1.5,
    variabilite_journaliere: 0.3, autocorrelation_journaliere: 0.4, kt_ciel_clair: 0.75, graine_meteo: 2026,
    jours_stress: 4, facteur_meteo_stress: 0.25, objectif_llp: 0.01,
  };

  const CIRCUIT = {
    nom: "Circuit", triphase: false, longueur_m: 30, ks: 1, eclairage: false, courbe: null,
    calibre_min: 10, section_min: 1.5,
  };
  const RECEPTEUR = {
    nom: "Récepteur", quantite: 1, puissance_w: 100, cos_phi: 0.9, rendement: 1, ku: 1,
    plages: [], moteur: false, demarrage: "direct",
  };

  // ===========================================================================
  // 3. Note de calcul
  // ===========================================================================

  class Note {
    constructor() {
      this.lignes = [];
      this.verifications = [];
      this.references = [];
    }
    _ref(ref) {
      if (!ref) return 0;
      let i = this.references.indexOf(ref);
      if (i < 0) { this.references.push(ref); i = this.references.length - 1; }
      return i + 1;
    }
    ajouter(rubrique, libelle, valeur, unite = "", ref = "") {
      this.lignes.push({ rubrique, libelle, valeur, unite, ref, n: this._ref(ref) });
      return valeur;
    }
    verifier(rubrique, condition, msgOk, msgKo, ref = "", statutKo = "NON CONFORME") {
      this.verifications.push({
        statut: condition ? "OK" : statutKo, rubrique, message: condition ? msgOk : msgKo, ref, n: this._ref(ref),
      });
      return condition;
    }
    info(rubrique, message, ref = "") {
      this.verifications.push({ statut: "INFO", rubrique, message, ref, n: this._ref(ref) });
    }
  }

  // ===========================================================================
  // 4. Outils
  // ===========================================================================

  const rad = (d) => (d * Math.PI) / 180;
  const deg = (r) => (r * 180) / Math.PI;
  const somme = (t) => t.reduce((a, b) => a + b, 0);
  const borne = (x) => Math.max(-1, Math.min(1, x));
  const arrondi = (x, n = 0) => Math.round(x * 10 ** n) / 10 ** n;
  /** Indice du premier maximum (comme max(range(n), key=f) en Python). */
  function argmax(n, f) {
    let meilleur = 0;
    let v = f(0);
    for (let i = 1; i < n; i++) { const w = f(i); if (w > v) { v = w; meilleur = i; } }
    return meilleur;
  }
  function argmin(n, f) { return argmax(n, (i) => -f(i)); }
  function calibreSuperieur(i, gamme) {
    for (const c of gamme) if (c >= i - 1e-9) return c;
    return null;
  }
  function fr(x, decimales = 1) {
    return Number(x).toLocaleString("fr-FR", { maximumFractionDigits: decimales, minimumFractionDigits: 0 });
  }
  function pct(x, decimales = 0) { return `${fr(x * 100, decimales)} %`; }

  function kTemperature(tAmb, tAmeMax = 90, tRef = 30) {
    if (tAmb >= tAmeMax) return 0;
    return Math.sqrt((tAmeMax - tAmb) / (tAmeMax - tRef));
  }
  function facteurGroupement(n, disposition) {
    const table = FACTEURS_GROUPEMENT[disposition] || FACTEURS_GROUPEMENT.couche_chemin_perfore;
    for (const [cle, f] of table) if (n <= cle) return f;
    return table[table.length - 1][1];
  }
  function chuteTensionAC(iB, longueur, section, cosPhi, triphase, rho = RHO_CU) {
    const b = triphase ? 1 : 2;
    const sinPhi = Math.sqrt(Math.max(0, 1 - cosPhi ** 2));
    const duV = b * (rho * longueur / section * cosPhi + LAMBDA_X * longueur * sinPhi) * iB;
    return (100 * duV) / U0;
  }
  function chuteTensionDC(i, longueur, section, u, rho = RHO_CU) {
    return (100 * 2 * rho * longueur * i) / section / u;
  }

  /**
   * Plus petite section satisfaisant courant admissible, chute de tension et contrainte thermique.
   * `chute(s, n)` donne la chute cumulée (%) avec n conducteurs en parallèle de section s.
   * Si un seul conducteur ne suffit pas, essaie 2 à 8 conducteurs en parallèle par phase.
   */
  function dimensionnerCable({ iRequis, chute, chuteMax, kCorrection, tableIz, sections = SECTIONS_MM2,
    contrainteARacS = 0, kThermique = K_ADIABATIQUE_CU_PR, sMin = 1.5, nMax = 8 }) {
    const sThMin = contrainteARacS / kThermique;
    for (let n = 1; n <= nMax; n++) {
      const trouves = [];
      const a = (c) => trouves.some((t) => t[0] === c);
      for (let k = 0; k < sections.length; k++) {
        const s = sections[k];
        if (s < sMin) continue;
        if (!a("courant admissible") && tableIz[k] * kCorrection * n >= iRequis) trouves.push(["courant admissible", s]);
        if (!a("chute de tension") && chute(s, n) <= chuteMax) trouves.push(["chute de tension", s]);
        if (!a("contrainte thermique") && s * n >= sThMin) trouves.push(["contrainte thermique", s]);
      }
      if (trouves.length < 3) continue;
      let choix = trouves[0];
      for (const t of trouves.slice(1)) {
        if (t[1] > choix[1] || (t[1] === choix[1] && t[0] === "courant admissible" && choix[0] !== "courant admissible")) {
          choix = t;
        }
      }
      const s = choix[1];
      return {
        section_mm2: s,
        conducteurs_paralleles: n,
        iz_corrige_a: arrondi(tableIz[sections.indexOf(s)] * kCorrection * n, 1),
        chute_cumulee_pct: arrondi(chute(s, n), 2),
        section_thermique_min_mm2: arrondi(sThMin, 2),
        critere_dimensionnant: choix[0],
      };
    }
    return null;
  }

  function iccMinFinLigne(iccSource, troncons) {
    let z = U0 / iccSource;
    for (const [longueur, section, n = 1] of troncons) z += (RHO_CU_CC_MIN * 2 * longueur) / (section * n);
    return (0.95 * U0) / z;
  }

  /** Générateur pseudo-aléatoire 32 bits (identique bit à bit à la version Python). */
  function mulberry32(graine) {
    let a = graine >>> 0;
    const uniforme = () => {
      a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    return {
      uniforme,
      gauss() {
        const u1 = uniforme();
        const u2 = uniforme();
        return Math.sqrt(-2 * Math.log(1 - u1)) * Math.cos(2 * Math.PI * u2);
      },
    };
  }

  // ===========================================================================
  // 5. Préparation et validation du projet
  // ===========================================================================

  function nombre(v, defaut) {
    const x = typeof v === "string" ? Number(v.replace(",", ".")) : Number(v);
    return v === null || v === undefined || v === "" || !Number.isFinite(x) ? defaut : x;
  }

  function normaliser(brut) {
    const p = brut || {};
    const hyp = { ...HYPOTHESES };
    for (const [k, v] of Object.entries(p.hypotheses || {})) {
      if (!(k in HYPOTHESES)) continue;
      if (k === "chimie" || k === "disposition_circuits") hyp[k] = String(v);
      else if (k === "inclinaison_deg") hyp[k] = v === null || v === "" ? null : nombre(v, null);
      else hyp[k] = nombre(v, HYPOTHESES[k]);
    }
    const site = { ...SITE };
    for (const [k, v] of Object.entries(p.site || {})) {
      if (k === "ghi_mensuel") site.ghi_mensuel = Array.isArray(v) && v.length === 12 ? v.map((x) => nombre(x, NaN)) : null;
      else if (k in SITE) site[k] = nombre(v, SITE[k]);
    }
    const module = { ...MODULE_PV };
    for (const [k, v] of Object.entries(p.module || {})) if (k in MODULE_PV) module[k] = k === "nom" ? String(v) : nombre(v, MODULE_PV[k]);
    const mppt = { ...REGULATEUR };
    for (const [k, v] of Object.entries(p.mppt || {})) if (k in REGULATEUR) mppt[k] = k === "nom" ? String(v) : nombre(v, REGULATEUR[k]);
    const circuits = (p.circuits || []).map((c, i) => ({
      ...CIRCUIT,
      nom: String(c.nom || `C${i + 1}`),
      triphase: Boolean(c.triphase),
      longueur_m: nombre(c.longueur_m, CIRCUIT.longueur_m),
      ks: nombre(c.ks, CIRCUIT.ks),
      eclairage: Boolean(c.eclairage),
      courbe: ["B", "C", "D"].includes(c.courbe) ? c.courbe : null,
      calibre_min: nombre(c.calibre_min, CIRCUIT.calibre_min),
      section_min: nombre(c.section_min, CIRCUIT.section_min),
      recepteurs: (c.recepteurs || []).map((r) => ({
        ...RECEPTEUR,
        nom: String(r.nom || "Récepteur"),
        quantite: nombre(r.quantite, 1),
        puissance_w: nombre(r.puissance_w, 0),
        cos_phi: nombre(r.cos_phi, RECEPTEUR.cos_phi),
        rendement: nombre(r.rendement, 1),
        ku: nombre(r.ku, 1),
        plages: (r.plages || []).map((pl) => [nombre(pl[0], 0), nombre(pl[1], 0), nombre(pl[2], 1)]),
        moteur: Boolean(r.moteur),
        demarrage: MODES_DEMARRAGE[r.demarrage] ? r.demarrage : "direct",
      })),
    }));
    return {
      nom: String(p.nom || "Projet sans nom"),
      systeme: SYSTEMES[p.systeme] ? p.systeme : "hybride",
      site, circuits, module, mppt, hyp,
    };
  }

  function valider(brut) {
    const p = normaliser(brut);
    const e = [];
    const s = p.site;
    if (!(s.latitude >= -66 && s.latitude <= 66)) e.push("La latitude doit être comprise entre −66° et 66°.");
    if (!(s.longitude >= -180 && s.longitude <= 180)) e.push("La longitude doit être comprise entre −180° et 180°.");
    if (!(s.altitude_m >= 0 && s.altitude_m <= 5000)) e.push("L'altitude doit être comprise entre 0 et 5000 m.");
    if (!(s.t_amb_min < s.t_amb_max)) e.push("La température minimale doit être inférieure à la température maximale.");
    if (s.ghi_mensuel && !s.ghi_mensuel.every((g) => g > 0 && g < 12)) {
      e.push("Les 12 irradiations mensuelles doivent être comprises entre 0 et 12 kWh/m²/j.");
    }
    if (!CHIMIES[p.hyp.chimie]) e.push("Technologie de batterie inconnue (lifepo4 ou plomb).");
    if (!(p.hyp.jours_autonomie > 0 && p.hyp.jours_autonomie <= 10)) e.push("Les jours d'autonomie doivent être entre 0,1 et 10.");
    if (!p.circuits.length) e.push("Ajoutez au moins un circuit avec ses récepteurs.");
    p.circuits.forEach((c) => {
      if (!c.recepteurs.length) e.push(`${c.nom} : ajoutez au moins un récepteur.`);
      if (!(c.longueur_m > 0 && c.longueur_m <= 2000)) e.push(`${c.nom} : longueur entre 1 et 2000 m.`);
      if (!(c.ks > 0 && c.ks <= 1)) e.push(`${c.nom} : le coefficient ks doit être entre 0 et 1.`);
      c.recepteurs.forEach((r) => {
        const nom = `${c.nom} / ${r.nom}`;
        if (!(r.quantite >= 0)) e.push(`${nom} : quantité invalide.`);
        if (!(r.puissance_w > 0)) e.push(`${nom} : la puissance doit être positive.`);
        if (!(r.cos_phi > 0 && r.cos_phi <= 1)) e.push(`${nom} : cos φ entre 0,1 et 1.`);
        if (!(r.rendement > 0 && r.rendement <= 1)) e.push(`${nom} : rendement entre 0,1 et 1.`);
        if (!(r.ku > 0 && r.ku <= 1)) e.push(`${nom} : ku entre 0,1 et 1.`);
        r.plages.forEach(([d, f, t]) => {
          if (!(d >= 0 && d <= 24 && f >= 0 && f <= 24 && Number.isInteger(d) && Number.isInteger(f))) {
            e.push(`${nom} : les heures des plages vont de 0 à 24 (heures entières).`);
          }
          if (!(t >= 0 && t <= 1)) e.push(`${nom} : le taux de marche d'une plage est entre 0 et 1.`);
        });
      });
    });
    return { projet: p, erreurs: [...new Set(e)] };
  }

  // ===========================================================================
  // 6. Module A — bilan de puissance, phases, profil horaire
  // ===========================================================================

  function ksTableau(n) {
    if (n <= 1) return 1;
    if (n <= 3) return 0.9;
    if (n <= 5) return 0.8;
    if (n <= 9) return 0.7;
    return 0.6;
  }
  function heureActive(h, debut, fin) {
    if (debut === fin) return false;
    if (debut < fin) return debut <= h && h < fin;
    return h >= debut || h < fin;
  }
  function puissancesRecepteur(r) {
    const pAbs = (r.quantite * r.puissance_w) / r.rendement;
    const p = pAbs * r.ku;
    return [pAbs, p, p * Math.tan(Math.acos(r.cos_phi))];
  }
  function profilRecepteur(r) {
    const [, p, q] = puissancesRecepteur(r);
    const taux = new Array(24).fill(0);
    for (const [d, f, t] of r.plages) for (let h = 0; h < 24; h++) if (heureActive(h, d, f)) taux[h] += t;
    return [taux.map((t) => p * t), taux.map((t) => q * t)];
  }
  function courantNominalMoteur(r, triphase) {
    const sVa = r.puissance_w / (r.rendement * r.cos_phi);
    return triphase ? sVa / (SQRT3 * U_NOMINALE) : sVa / U0;
  }
  function plusGrosDemarrage(circuits) {
    let meilleur = null;
    for (const c of circuits) {
      for (const r of c.recepteurs) {
        if (!r.moteur) continue;
        const sD = ((r.quantite * r.puissance_w) / (r.rendement * r.cos_phi)) * MODES_DEMARRAGE[r.demarrage].id_in;
        if (!meilleur || sD > meilleur.s_d) meilleur = { recepteur: r, circuit: c, s_d: sD };
      }
    }
    return meilleur;
  }

  function bilanPuissance(note, circuits, hyp) {
    const rub = "A. Bilan de puissance";
    const lignes = circuits.map((c) => {
      const pInst = somme(c.recepteurs.map((r) => puissancesRecepteur(r)[0]));
      const p = c.ks * somme(c.recepteurs.map((r) => puissancesRecepteur(r)[1]));
      const q = c.ks * somme(c.recepteurs.map((r) => puissancesRecepteur(r)[2]));
      const s = Math.hypot(p, q);
      const iB = c.triphase ? s / (SQRT3 * U_NOMINALE) : s / U0;
      let profP = new Array(24).fill(0);
      let profQ = new Array(24).fill(0);
      for (const r of c.recepteurs) {
        const [pp, pq] = profilRecepteur(r);
        profP = profP.map((a, h) => a + pp[h]);
        profQ = profQ.map((a, h) => a + pq[h]);
      }
      return { circuit: c, p_inst_w: pInst, p_w: p, q_var: q, s_va: s, i_b_a: iB, cos_phi: s ? p / s : 1,
        energie_wh_j: somme(profP), profil_p: profP, profil_q: profQ, phase: null };
    });

    const chargePhase = [0, 0, 0];
    lignes.filter((l) => !l.circuit.triphase).sort((a, b) => b.s_va - a.s_va).forEach((l) => {
      const ph = argmin(3, (k) => chargePhase[k]);
      l.phase = ph;
      chargePhase[ph] += l.s_va;
    });

    const n = circuits.length;
    const ksT = ksTableau(n);
    note.ajouter(rub, "Nombre de circuits au TGBT", n, "", "");
    note.ajouter(rub, "Coefficient de simultanéité du TGBT ks", ksT, "", R.KS_TABLEAU);

    const pTot = ksT * somme(lignes.map((l) => l.p_w));
    const qTot = ksT * somme(lignes.map((l) => l.q_var));
    const sTot = Math.hypot(pTot, qTot);

    const pPh = [0, 0, 0];
    const qPh = [0, 0, 0];
    const profPPh = [0, 1, 2].map(() => new Array(24).fill(0));
    const profQPh = [0, 1, 2].map(() => new Array(24).fill(0));
    for (const l of lignes) {
      const phases = l.circuit.triphase ? [0, 1, 2] : [l.phase];
      const part = 1 / phases.length;
      for (const ph of phases) {
        pPh[ph] += ksT * l.p_w * part;
        qPh[ph] += ksT * l.q_var * part;
        for (let h = 0; h < 24; h++) {
          profPPh[ph][h] += l.profil_p[h] * part;
          profQPh[ph][h] += l.profil_q[h] * part;
        }
      }
    }
    const sPhKs = [0, 1, 2].map((k) => Math.hypot(pPh[k], qPh[k]));
    const sPhProfil = [0, 1, 2].map((k) => Math.max(...profPPh[k].map((p, h) => Math.hypot(p, profQPh[k][h]))));
    const profP = new Array(24).fill(0).map((_, h) => profPPh[0][h] + profPPh[1][h] + profPPh[2][h]);
    const profQ = new Array(24).fill(0).map((_, h) => profQPh[0][h] + profQPh[1][h] + profQPh[2][h]);
    const hPointe = argmax(24, (h) => Math.hypot(profP[h], profQ[h]));
    const sProfil = Math.hypot(profP[hPointe], profQ[hPointe]);
    const eJour = somme(profP);

    const ke = hyp.k_extension;
    const sDim = Math.max(sTot, sProfil) * ke;
    const pDim = Math.max(pTot, profP[hPointe]) * ke;
    const sDimPh = [0, 1, 2].map((k) => Math.max(sPhKs[k], sPhProfil[k]) * ke);
    const iBTgbt = Math.max(...sDimPh) / U0;

    note.ajouter(rub, "Puissance active foisonnée (méthode ku·ks)", arrondi(pTot / 1000, 2), "kW", R.KU_KS);
    note.ajouter(rub, "Puissance réactive foisonnée", arrondi(qTot / 1000, 2), "kvar", R.BOUCHEROT);
    note.ajouter(rub, "Puissance apparente foisonnée", arrondi(sTot / 1000, 2), "kVA", R.BOUCHEROT);
    note.ajouter(rub, "cos φ global de l'installation", sTot ? arrondi(pTot / sTot, 3) : 1, "", R.BOUCHEROT);
    note.ajouter(rub, `Pointe du profil horaire (à ${hPointe} h)`, arrondi(sProfil / 1000, 2), "kVA", "");
    note.ajouter(rub, "Coefficient d'extension ke", ke, "", R.HYP);
    note.ajouter(rub, "Puissance apparente de dimensionnement", arrondi(sDim / 1000, 2), "kVA", "S_dim = max(S_ks, S_profil) · ke");
    note.ajouter(rub, "Puissance active de dimensionnement", arrondi(pDim / 1000, 2), "kW", "");
    sDimPh.forEach((s, k) => note.ajouter(rub, `Phase L${k + 1} : S de dimensionnement`, arrondi(s / 1000, 2), "kVA", ""));
    note.ajouter(rub, "Courant d'emploi TGBT (phase la plus chargée)", arrondi(iBTgbt, 1), "A", R.IB);
    note.ajouter(rub, "Consommation journalière (profil horaire)", arrondi(eJour / 1000, 2), "kWh/j", "");
    const moyenne = somme(sDimPh) / 3;
    const deseq = moyenne ? (Math.max(...sDimPh) - Math.min(...sDimPh)) / moyenne : 0;
    note.verifier(rub, deseq <= 0.25, `Déséquilibre entre phases ${pct(deseq)} (≤ 25 %)`,
      `Déséquilibre entre phases ${pct(deseq)} > 25 % : revoir la répartition des circuits`, "", "ATTENTION");

    return { lignes, ks_tgbt: ksT, p_ks_w: pTot, q_ks_var: qTot, s_ks_va: sTot, s_profil_va: sProfil, h_pointe: hPointe,
      s_dim_va: sDim, p_dim_w: pDim, s_dim_phase_va: sDimPh, i_b_tgbt_a: iBTgbt, profil_p_w: profP,
      profil_q_var: profQ, energie_wh_j: eJour, cos_phi: sTot ? pTot / sTot : 1 };
  }

  // ===========================================================================
  // 7. Module B — gisement solaire
  // ===========================================================================

  const declinaison = (n) => 23.45 * Math.sin(rad((360 * (284 + n)) / 365));
  const angleCoucher = (lat, decl) => deg(Math.acos(borne(-Math.tan(rad(lat)) * Math.tan(rad(decl)))));

  function irradiationExtraterrestre(lat, n) {
    const phi = rad(lat);
    const d = rad(declinaison(n));
    const ws = rad(angleCoucher(lat, declinaison(n)));
    const dr = 1 + 0.033 * Math.cos((2 * Math.PI * n) / 365);
    const h0 = ((24 * 3600 * GSC) / Math.PI) * dr * (Math.cos(phi) * Math.cos(d) * Math.sin(ws) + ws * Math.sin(phi) * Math.sin(d));
    return h0 / 3.6e6;
  }
  function fractionDiffuse(kt, wsDeg) {
    const k = Math.min(0.8, Math.max(0.3, kt));
    if (wsDeg <= 81.4) return 1.391 - 3.56 * k + 4.189 * k ** 2 - 2.137 * k ** 3;
    return 1.311 - 3.022 * k + 3.427 * k ** 2 - 1.821 * k ** 3;
  }
  function rapportRb(lat, beta, n) {
    const phi = rad(lat);
    const d = rad(declinaison(n));
    const b = rad(beta);
    const phiE = lat >= 0 ? phi - b : phi + b;
    const ws = Math.acos(borne(-Math.tan(phi) * Math.tan(d)));
    const wsP = Math.min(ws, Math.acos(borne(-Math.tan(phiE) * Math.tan(d))));
    const num = Math.cos(phiE) * Math.cos(d) * Math.sin(wsP) + wsP * Math.sin(phiE) * Math.sin(d);
    const den = Math.cos(phi) * Math.cos(d) * Math.sin(ws) + ws * Math.sin(phi) * Math.sin(d);
    return num / den;
  }
  function irradiationInclinee(h, kt, lat, beta, n, albedo) {
    const fd = fractionDiffuse(kt, angleCoucher(lat, declinaison(n)));
    const cb = Math.cos(rad(beta));
    return h * ((1 - fd) * rapportRb(lat, beta, n) + (fd * (1 + cb)) / 2 + (albedo * (1 - cb)) / 2);
  }
  function repartitionHoraire(wsDeg) {
    const ws = rad(wsDeg);
    const a = 0.409 + 0.5016 * Math.sin(ws - rad(60));
    const b = 0.6609 - 0.4767 * Math.sin(ws - rad(60));
    const r = [];
    for (let h = 0; h < 24; h++) {
      const w = rad(15 * (h + 0.5 - 12));
      if (Math.abs(w) >= ws) { r.push(0); continue; }
      const rt = (Math.PI / 24) * (a + b * Math.cos(w)) * (Math.cos(w) - Math.cos(ws)) / (Math.sin(ws) - ws * Math.cos(ws));
      r.push(Math.max(0, rt));
    }
    const total = somme(r);
    return r.map((x) => x / total);
  }

  function gisementSolaire(note, site, hyp) {
    const rub = "B1. Gisement solaire";
    const lat = site.latitude;
    const h0 = JOURS_TYPES.map((n) => irradiationExtraterrestre(lat, n));
    const ws = JOURS_TYPES.map((n) => angleCoucher(lat, declinaison(n)));
    let ghi;
    let kt;
    if (site.ghi_mensuel) {
      ghi = [...site.ghi_mensuel];
      kt = ghi.map((g, m) => g / h0[m]);
      note.info(rub, "Irradiation horizontale mensuelle fournie par l'utilisateur", "Base PVGIS / NASA POWER / Meteonorm");
    } else {
      kt = new Array(12).fill(hyp.kt_defaut);
      ghi = kt.map((k, m) => k * h0[m]);
      note.info(rub, `Indice de clarté forfaitaire K_T = ${fr(hyp.kt_defaut, 2)} : saisir les 12 irradiations mensuelles `
        + "du site (PVGIS ou NASA POWER) pour un calcul fiable", R.HYP);
    }
    const ht = (beta) => JOURS_TYPES.map((n, m) => irradiationInclinee(ghi[m], kt[m], lat, beta, n, site.albedo));
    let beta;
    let refBeta;
    if (hyp.inclinaison_deg === null || hyp.inclinaison_deg === undefined) {
      let meilleur = null;
      for (let b = Math.trunc(hyp.inclinaison_min_deg); b <= 60; b++) {
        const v = ht(b);
        const cle = [arrondi(Math.min(...v), 4), somme(v)];
        if (!meilleur || cle[0] > meilleur[0][0] || (cle[0] === meilleur[0][0] && cle[1] > meilleur[0][1])) meilleur = [cle, b];
      }
      beta = meilleur[1];
      refBeta = "Inclinaison maximisant l'irradiation du mois le plus défavorable (≥ 10° : auto-nettoyage)";
    } else {
      beta = hyp.inclinaison_deg;
      refBeta = R.HYP;
    }
    const hT = ht(beta);
    const mCrit = argmin(12, (m) => hT[m]);
    const fd = kt.map((k, m) => fractionDiffuse(k, ws[m]));
    note.ajouter(rub, "Latitude / longitude", `${fr(site.latitude, 2)}° / ${fr(site.longitude, 2)}°`, "", "");
    note.ajouter(rub, "Irradiation extraterrestre H0 (min – max)", `${fr(Math.min(...h0), 2)} – ${fr(Math.max(...h0), 2)}`, "kWh/m²/j", R.SOL_GEO);
    note.ajouter(rub, "Fraction diffuse Hd/H (min – max)", `${fr(Math.min(...fd), 2)} – ${fr(Math.max(...fd), 2)}`, "", R.SOL_DIFF);
    note.ajouter(rub, `Inclinaison retenue (${lat >= 0 ? "plein Sud" : "plein Nord"})`, beta, "°", refBeta);
    note.ajouter(rub, "Irradiation annuelle sur plan incliné", arrondi(somme(hT.map((h, m) => h * JOURS_PAR_MOIS[m]))), "kWh/m²/an", R.SOL_TRANSPO);
    note.ajouter(rub, `Mois critique : ${MOIS[mCrit]} — PSH`, arrondi(hT[mCrit], 2), "h/j", R.SOL_TRANSPO);
    return { h0, ghi, kt, ws, ht: hT, beta, mois_critique: mCrit, fd,
      rb: JOURS_TYPES.map((n) => rapportRb(lat, beta, n)), mesure: Boolean(site.ghi_mensuel) };
  }

  // ===========================================================================
  // 8. Module B — onduleur/chargeur, champ PV, batteries
  // ===========================================================================

  const cellulesSerie = (uBus, chimie) => (chimie === CHIMIES.lifepo4 ? { 12: 4, 24: 8, 48: 16 }[uBus] : Math.round(uBus / 2));
  const uChargeBus = (uBus, chimie) => cellulesSerie(uBus, chimie) * chimie.u_charge_cellule;

  function dimensionnerOnduleur(note, bilan, circuits, hyp) {
    const rub = "B2. Onduleur / chargeur";
    const sPh = Math.max(...bilan.s_dim_phase_va);
    const besoin25 = sPh / hyp.k_temp_onduleur;
    let unite = calibreSuperieur(besoin25, GAMME_ONDULEURS_VA);
    let nPar = 1;
    if (unite === null) {
      unite = GAMME_ONDULEURS_VA[GAMME_ONDULEURS_VA.length - 1];
      nPar = Math.ceil(besoin25 / unite);
    }
    const sTotal = 3 * nPar * unite;
    note.ajouter(rub, "Besoin par phase à 40 °C", arrondi(sPh / 1000, 2), "kVA", R.ONDULEUR);
    note.ajouter(rub, "Facteur de déclassement thermique (40 °C)", hyp.k_temp_onduleur, "", R.HYP);
    note.ajouter(rub, "Onduleur/chargeur retenu", `3 × ${nPar} × ${fr(unite / 1000)} kVA (couplage triphasé)`, "", R.ONDULEUR);
    note.ajouter(rub, "Puissance assignée totale", arrondi(sTotal / 1000, 1), "kVA", "");
    const pCont = 0.8 * sTotal;
    const uBus = pCont <= 1500 ? 12 : pCont <= 4000 ? 24 : 48;
    note.ajouter(rub, "Tension nominale du bus continu", uBus, "V", "Règle usuelle : 12 V ≤ 1,5 kW < 24 V ≤ 4 kW < 48 V");
    if (pCont > 50000) note.info(rub, "Au-delà de ~50 kW, préférer une batterie haute tension (≥ 200 V) et des PCS dédiés", "");

    const dem = plusGrosDemarrage(circuits);
    const res = { unite_va: unite, n_par_phase: nPar, s_total_va: sTotal, u_bus: uBus,
      s_demarrage_va: dem ? dem.s_d : 0, moteur: dem ? dem.recepteur.nom : null };
    if (dem) {
      const r = dem.recepteur;
      const sMarche = ((r.quantite * r.puissance_w) / (r.rendement * r.cos_phi)) * r.ku;
      const part = dem.circuit.triphase ? 3 : 1;
      const besoin = sPh - sMarche / part + dem.s_d / part;
      const capacite = hyp.surcharge_onduleur * unite * nPar;
      note.ajouter(rub, `Appel au démarrage moteur (${MODES_DEMARRAGE[r.demarrage].libelle})`, arrondi(dem.s_d / 1000, 1), "kVA",
        "S_d = (Id/In) · Pu/(η·cos φ)");
      note.verifier(rub, besoin <= capacite,
        `Surcharge de démarrage par phase ${fr(besoin / 1000)} kVA ≤ ${fr(capacite / 1000)} kVA`,
        `Surcharge de démarrage par phase ${fr(besoin / 1000)} kVA > ${fr(capacite / 1000)} kVA : `
        + "démarreur progressif/variateur ou démarrage uniquement sur groupe", R.ONDULEUR);
    }
    return res;
  }

  function configurerChamp(module, mppt, pRequise, site, uCharge, pMppt, ratioMax) {
    const tCellMax = site.t_amb_max + ((module.noct - 20) / 800) * 1000;
    const vocFroid = module.voc * (1 + (module.coef_voc / 100) * (site.t_amb_min - 25));
    const vmpFroid = module.vmp * (1 + (module.coef_p / 100) * (site.t_amb_min - 25));
    const vmpChaud = module.vmp * (1 + (module.coef_p / 100) * (tCellMax - 25));
    const iscChaud = module.isc * (1 + (module.coef_isc / 100) * (tCellMax - 25));
    const vMpptMin = Math.max(mppt.v_mppt_min, uCharge + 5);
    const nsMax = Math.min(Math.floor(mppt.v_dc_max / vocFroid), Math.floor(mppt.v_mppt_max / vmpFroid));
    const nsMin = Math.ceil(vMpptMin / vmpChaud);
    const npMax = Math.floor(mppt.isc_max / iscChaud);
    const nRequis = Math.ceil(pRequise / module.p_wc);
    const pMaxParMppt = ratioMax * pMppt;
    let meilleur = null;
    if (nsMin <= nsMax && npMax >= 1) {
      for (let nMppt = 1; nMppt < 500 && !meilleur; nMppt++) {
        for (let ns = nsMax; ns >= nsMin; ns--) {
          for (let np = 1; np <= npMax; np++) {
            const parMppt = ns * np;
            if (parMppt * module.p_wc > pMaxParMppt || nMppt * parMppt < nRequis) continue;
            const cle = [nMppt * parMppt, -ns];
            if (!meilleur || cle[0] < meilleur.cle[0] || (cle[0] === meilleur.cle[0] && cle[1] < meilleur.cle[1])) {
              meilleur = { cle, n_mppt: nMppt, ns, np };
            }
          }
        }
      }
    }
    return { t_cell_max: tCellMax, voc_froid: vocFroid, vmp_froid: vmpFroid, vmp_chaud: vmpChaud, isc_chaud: iscChaud,
      v_mppt_min: vMpptMin, ns_min: nsMin, ns_max: nsMax, np_max: npMax, n_requis: nRequis,
      solution: meilleur ? { n_mppt: meilleur.n_mppt, ns: meilleur.ns, np: meilleur.np } : null };
  }

  function dimensionnerPV(note, site, hyp, bilan, gis, onduleur, chimie, module, mppt) {
    const rub = "B3. Champ photovoltaïque";
    const m = gis.mois_critique;
    const psh = gis.ht[m];
    const ws = gis.ws[m];
    const lever = 12 - ws / 15;
    const coucher = 12 + ws / 15;
    const prof = bilan.profil_p_w;
    const eJour = bilan.energie_wh_j;
    let eDirect = 0;
    for (let h = 0; h < 24; h++) if (lever + 1 <= h + 0.5 && h + 0.5 <= coucher - 1) eDirect += prof[h];
    const fDirect = eDirect / eJour;
    const etaOnd = hyp.rendement_onduleur;
    const etaRt = chimie.rendement_aller_retour;
    const ePv = hyp.couverture_mois_critique * ((fDirect * eJour) / etaOnd + ((1 - fDirect) * eJour) / (etaOnd * etaRt));
    const tCellJour = site.t_amb_jour + ((module.noct - 20) / 800) * 800;
    const kTemp = 1 + (module.coef_p / 100) * (tCellJour - 25);
    const kAge = (1 - hyp.degradation_annuelle) ** hyp.annees_conception;
    const pr = kTemp * (1 - hyp.pertes_encrassement) * (1 - hyp.pertes_dispersion) * (1 - hyp.pertes_cables_dc)
      * hyp.rendement_mppt * kAge;
    const pRequise = ePv / (psh * pr);

    note.ajouter(rub, "Part de la consommation servie en direct (journée)", pct(fDirect), "", "Énergie consommée entre lever + 1 h et coucher − 1 h");
    note.ajouter(rub, "Énergie PV requise (mois critique)", arrondi(ePv / 1000, 2), "kWh/j", "E_PV = E_dir/η_ond + E_batt/(η_ond·η_batt)");
    note.ajouter(rub, "Température de cellule diurne", arrondi(tCellJour, 1), "°C", R.PV_TEMP);
    note.ajouter(rub, "Facteur de température k_θ", arrondi(kTemp, 3), "", R.PV_TEMP);
    note.ajouter(rub, `Facteur de vieillissement (${hyp.annees_conception} ans)`, arrondi(kAge, 3), "", R.HYP);
    note.ajouter(rub, "Ratio de performance côté continu PR", arrondi(pr, 3), "", R.HYP);
    note.ajouter(rub, "Puissance crête requise", arrondi(pRequise / 1000, 2), "kWc", R.PV_PC);

    const uCharge = uChargeBus(onduleur.u_bus, chimie);
    const pMppt = mppt.i_charge_max * cellulesSerie(onduleur.u_bus, chimie) * chimie.u_cellule;
    const cfg = configurerChamp(module, mppt, pRequise, site, uCharge, pMppt, hyp.ratio_pv_mppt_max);
    const sol = cfg.solution;
    if (!sol) {
      throw new Error("Aucune configuration série/parallèle des modules n'est compatible avec le régulateur MPPT : "
        + "vérifiez les tensions et courants du module et du régulateur (onglet Choix techniques).");
    }
    const nModules = sol.n_mppt * sol.ns * sol.np;
    const pInstallee = nModules * module.p_wc;
    note.ajouter(rub, "Module", module.nom, "", "Fiche constructeur (valeurs typiques)");
    note.ajouter(rub, "Régulateur", `${sol.n_mppt} × ${mppt.nom}`, "", "");
    note.ajouter(rub, "Configuration par régulateur", `${sol.ns} en série × ${sol.np} en parallèle`, "", R.PV_CHAINES);
    note.ajouter(rub, "Nombre de modules", nModules, "", "");
    note.ajouter(rub, "Puissance crête installée", arrondi(pInstallee / 1000, 2), "kWc", "");
    const vocChaine = sol.ns * cfg.voc_froid;
    const vmpChaud = sol.ns * cfg.vmp_chaud;
    const iscMppt = sol.np * cfg.isc_chaud;
    note.ajouter(rub, `Voc chaîne à ${fr(site.t_amb_min)} °C`, arrondi(vocChaine, 1), "V", R.PV_CHAINES);
    note.ajouter(rub, `Vmp chaîne à ${fr(cfg.t_cell_max, 0)} °C (cellule)`, arrondi(vmpChaud, 1), "V", R.PV_CHAINES);
    note.verifier(rub, vocChaine <= mppt.v_dc_max, `Voc max ${fr(vocChaine, 0)} V ≤ ${fr(mppt.v_dc_max, 0)} V admissibles`, "Voc max hors limite", R.PV_CHAINES);
    note.verifier(rub, vmpChaud >= cfg.v_mppt_min, `Vmp à chaud ${fr(vmpChaud, 0)} V ≥ seuil MPPT ${fr(cfg.v_mppt_min, 0)} V`, "Vmp à chaud sous le seuil MPPT", R.PV_CHAINES);
    note.verifier(rub, iscMppt <= mppt.isc_max, `Isc par entrée ${fr(iscMppt)} A ≤ ${fr(mppt.isc_max, 0)} A`, "Isc par entrée trop élevé", R.PV_CHAINES);
    const ratio = (sol.ns * sol.np * module.p_wc) / pMppt;
    note.verifier(rub, ratio <= hyp.ratio_pv_mppt_max, `Rapport Pc/P_MPPT = ${fr(ratio, 2)} (≤ ${fr(hyp.ratio_pv_mppt_max, 2)})`,
      "Champ trop puissant pour le MPPT", R.HYP, "ATTENTION");
    if ((sol.np - 1) * 1.25 * module.isc > module.i_inverse_max) {
      const inFus = calibreSuperieur(1.5 * module.isc, CALIBRES_GPV);
      note.verifier(rub, inFus !== null && inFus <= Math.min(2.4 * module.isc, module.i_inverse_max),
        `Fusibles gPV ${inFus} A requis sur chaque chaîne`, "Aucun calibre gPV compatible : réduire le nombre de chaînes en parallèle", R.PV_FUS);
    } else {
      note.verifier(rub, true, `Pas de fusible de chaîne requis (${sol.np} chaîne(s) par entrée)`, "", R.PV_FUS);
    }
    return { psh, pr, k_temp: kTemp, p_requise_w: pRequise, p_installee_w: pInstallee, n_modules: nModules, f_direct: fDirect,
      e_pv_wh: ePv, u_charge_bus: uCharge, p_mppt_w: pMppt, configuration: cfg, ...sol };
  }

  function dimensionnerBatteries(note, hyp, bilan, onduleur, pv, chimie, mppt) {
    const rub = "B4. Parc batteries";
    const nCell = cellulesSerie(onduleur.u_bus, chimie);
    const uNom = nCell * chimie.u_cellule;
    const uMin = nCell * chimie.u_min_cellule;
    const kT = 1 + chimie.coef_temp * Math.max(0, 25 - hyp.t_batterie_min);
    const cWh = (bilan.energie_wh_j * hyp.jours_autonomie * chimie.facteur_vieillissement * kT) / (hyp.rendement_onduleur * chimie.dod);
    const cAh = cWh / uNom;
    note.ajouter(rub, "Technologie", chimie.nom, "", chimie.ref);
    note.ajouter(rub, "Jours d'autonomie", hyp.jours_autonomie, "j", R.HYP);
    note.ajouter(rub, "Profondeur de décharge DoD", chimie.dod, "", chimie.ref);
    note.ajouter(rub, "Facteur de vieillissement", chimie.facteur_vieillissement, "", chimie.ref);
    note.ajouter(rub, "Facteur de température", arrondi(kT, 3), "", R.BATT);
    note.ajouter(rub, "Capacité nominale requise", arrondi(cWh / 1000, 1), "kWh", R.BATT);
    note.ajouter(rub, "Capacité requise sous la tension nominale", arrondi(cAh), "Ah", R.BATT);

    let nPar;
    let ahUnite;
    let rUnite;
    if (chimie === CHIMIES.lifepo4) {
      nPar = Math.ceil(cAh / chimie.ah_unite);
      ahUnite = chimie.ah_unite;
      rUnite = (chimie.r_interne_unite_16s * nCell) / 16;
    } else {
      nPar = Math.max(1, Math.ceil(cAh / chimie.gamme_ah[chimie.gamme_ah.length - 1]));
      ahUnite = calibreSuperieur(cAh / nPar, chimie.gamme_ah);
      rUnite = (nCell * chimie.r_interne_1000ah * 1000) / ahUnite;
    }
    const pOnd = 0.8 * onduleur.s_total_va;
    const iDecharge = pOnd / (uMin * hyp.rendement_onduleur);
    const nParMin = Math.ceil(iDecharge / (chimie.c_decharge_max * ahUnite));
    if (nParMin > nPar) {
      note.info(rub, `Nombre de branches porté de ${nPar} à ${nParMin} pour le courant de décharge`, R.BATT);
      nPar = nParMin;
    }
    const designation = chimie === CHIMIES.lifepo4
      ? `${nPar} modules LFP ${fr(uNom)} V – ${ahUnite} Ah en parallèle`
      : `${nPar} branche(s) de ${nCell} éléments 2 V – ${ahUnite} Ah C10`;
    const cInstAh = nPar * ahUnite;
    const cInstKwh = (cInstAh * uNom) / 1000;
    note.ajouter(rub, "Parc retenu", designation, "", "");
    note.ajouter(rub, "Capacité installée", `${fr(cInstAh, 0)} Ah / ${fr(cInstKwh)} kWh`, "", "");
    note.verifier(rub, iDecharge <= chimie.c_decharge_max * cInstAh,
      `Décharge à pleine puissance ${fr(iDecharge, 0)} A ≤ ${fr(chimie.c_decharge_max, 2)}C (${fr(chimie.c_decharge_max * cInstAh, 0)} A)`,
      "Courant de décharge excessif", chimie.ref);
    const iChargePv = Math.min(pv.n_mppt * mppt.i_charge_max, (pv.p_installee_w * pv.k_temp) / pv.u_charge_bus);
    note.verifier(rub, iChargePv <= chimie.c_charge_max * cInstAh,
      `Courant de charge PV ${fr(iChargePv, 0)} A ≤ ${fr(chimie.c_charge_max, 2)}C (${fr(chimie.c_charge_max * cInstAh, 0)} A)`,
      `Courant de charge PV ${fr(iChargePv, 0)} A > ${fr(chimie.c_charge_max, 2)}C : limiter le courant de charge des régulateurs`,
      chimie.ref, "ATTENTION");
    if (chimie === CHIMIES.plomb) {
      note.verifier(rub, iChargePv >= 0.05 * cInstAh,
        `Courant de charge PV ≥ 0,05·C10 (${fr(0.05 * cInstAh, 0)} A) : recharge complète possible`,
        "Courant de charge PV < 0,05·C10 : recharges incomplètes (sulfatation)", chimie.ref, "ATTENTION");
      note.info(rub, "Plomb en climat chaud : la durée de vie est divisée par ~2 tous les +10 °C au-delà de 25 °C ; "
        + "local ventilé (EN IEC 62485-2) et climatisé recommandé", chimie.ref);
    }
    const iccBatt = uNom / (rUnite / nPar);
    note.ajouter(rub, "Courant de court-circuit du parc (≈ U/Ri)", arrondi(iccBatt / 1000, 1), "kA",
      "Pouvoir de coupure continu des protections batterie ≥ Icc");
    return { u_nom: uNom, u_min: uMin, n_cellules: nCell, c_requise_wh: cWh, c_installee_ah: cInstAh,
      c_installee_kwh: cInstKwh, n_par: nPar, ah_unite: ahUnite, designation, i_decharge_a: iDecharge,
      i_charge_pv_a: iChargePv, icc_a: iccBatt };
  }

  // ===========================================================================
  // 9. Module C — groupe électrogène
  // ===========================================================================

  function dimensionnerGroupe(note, site, hyp, bilan, circuits, systeme, ctx) {
    const rub = "C. Groupe électrogène";
    const s1 = 3 * Math.max(...bilan.s_dim_phase_va);
    const p1 = bilan.p_dim_w;
    const dem = plusGrosDemarrage(circuits);
    const sD = dem ? dem.s_d : 0;
    const d = hyp.chute_tension_max;
    const s3 = sD ? (hyp.xd_transitoire * sD * (1 - d)) / d : 0;
    const criteres = { "Pointe de l'installation": Math.max(s1, p1 / 0.8) };
    let pChargeAc = 0;
    if (systeme === "hybride") {
      const { gis, onduleur, batt, chimie } = ctx;
      const cWh = batt.c_installee_kwh * 1000;
      const eARecharger = cWh * (chimie.soc_arret_ge - (1 - chimie.dod + 0.05));
      let pChargeDc = Math.min(eARecharger / hyp.heures_recharge_cible,
        chimie.c_charge_max * batt.c_installee_ah * uChargeBus(onduleur.u_bus, chimie));
      pChargeDc = Math.min(pChargeDc, 3 * onduleur.n_par_phase * 0.8 * onduleur.unite_va);
      pChargeAc = pChargeDc / hyp.rendement_chargeur;
      const ws = gis.ws[gis.mois_critique];
      const nuit = [];
      for (let h = 0; h < 24; h++) if (!(12 - ws / 15 <= h + 0.5 && h + 0.5 <= 12 + ws / 15)) nuit.push(h);
      const pNuit = somme(nuit.map((h) => bilan.profil_p_w[h])) / nuit.length;
      criteres["Recharge batterie à 70 % PRP"] = (pNuit + pChargeAc) / hyp.taux_charge_cible_ge / 0.8;
    }
    criteres["Démarrage moteur"] = s3;
    const noms = Object.keys(criteres);
    const critere = noms[argmax(noms.length, (i) => criteres[noms[i]])];
    const sReq = criteres[critere];

    const kAlt = 1 - (hyp.declassement_altitude_pct_100m / 100) * Math.max(0, site.altitude_m - hyp.altitude_sans_declassement) / 100;
    const kTemp = 1 - (hyp.declassement_temp_pct_degc / 100) * Math.max(0, site.t_local_ge - hyp.temperature_sans_declassement);
    const kHum = 1 - hyp.declassement_humidite;
    const kTot = kAlt * kTemp * kHum;
    if (!(kTot > 0)) throw new Error("Le déclassement du groupe annule sa puissance : vérifiez altitude et température du local.");
    const sNomReq = sReq / kTot;
    const sGe = calibreSuperieur(sNomReq / 1000, GAMME_GE_KVA);
    if (sGe === null) {
      throw new Error(`Besoin de ${fr(sNomReq / 1000, 0)} kVA au-delà de la gamme (2500 kVA) : prévoir des groupes en parallèle.`);
    }
    const sGeVa = sGe * 1000;
    const pSite = 0.8 * sGeVa * kTot;
    const iN = sGeVa / (SQRT3 * U_NOMINALE);

    note.ajouter(rub, "Critère 1 — reprise de la pointe", arrondi(criteres["Pointe de l'installation"] / 1000, 1), "kVA",
      "S ≥ 3·S_phase,max et P ≥ P_dim (cos φ GE = 0,8)");
    if (systeme === "hybride") {
      note.ajouter(rub, "Puissance de recharge (côté AC)", arrondi(pChargeAc / 1000, 1), "kW",
        `Recharge en ${fr(hyp.heures_recharge_cible)} h, limitée par chargeur et C-rate`);
      note.ajouter(rub, "Critère 2 — charge de nuit + recharge à 70 %", arrondi(criteres["Recharge batterie à 70 % PRP"] / 1000, 1), "kVA", R.GE_ISO);
    }
    note.ajouter(rub, `Critère ${systeme === "hybride" ? 3 : 2} — démarrage moteur`, arrondi(s3 / 1000, 1), "kVA", R.GE_DIP);
    note.ajouter(rub, "Critère dimensionnant", critere, "", "");
    note.ajouter(rub, "Déclassement altitude × température × humidité",
      `${kAlt.toFixed(3)} × ${kTemp.toFixed(3)} × ${kHum.toFixed(3)} = ${kTot.toFixed(3)}`, "", R.GE_DERATE);
    note.ajouter(rub, "Puissance assignée requise", arrondi(sNomReq / 1000, 1), "kVA", R.GE_DERATE);
    note.ajouter(rub, "Groupe retenu (puissance PRP)", `${fr(sGe)} kVA / ${fr(0.8 * sGe)} kW`, "", R.GE_ISO);
    note.ajouter(rub, "Puissance disponible sur site", arrondi(pSite / 1000, 1), "kW", R.GE_DERATE);
    note.ajouter(rub, "Courant assigné", arrondi(iN, 1), "A", R.IB);

    if (dem) {
      const dip = (hyp.xd_transitoire * sD) / (sGeVa * kTot + hyp.xd_transitoire * sD);
      note.verifier(rub, dip <= hyp.chute_tension_max, `Chute de tension au démarrage ${pct(dip, 1)} ≤ ${pct(hyp.chute_tension_max)}`,
        `Chute de tension au démarrage ${pct(dip, 1)} > ${pct(hyp.chute_tension_max)}`, R.GE_DIP);
      const r = dem.recepteur;
      const pD = sD * MODES_DEMARRAGE[r.demarrage].cos_phi_d;
      const pAvant = bilan.p_dim_w - ((r.quantite * r.puissance_w) / r.rendement) * r.ku;
      note.verifier(rub, pAvant + pD <= pSite, `Échelon de charge au démarrage ${fr((pAvant + pD) / 1000)} kW ≤ ${fr(pSite / 1000)} kW`,
        `Échelon ${fr((pAvant + pD) / 1000)} kW > puissance du moteur thermique : séquencer les démarrages`,
        "ISO 8528-5 : acceptation d'échelon selon la pression moyenne effective", "ATTENTION");
    }
    const iKSub = iN / hyp.xd_subtransitoire;
    const iKMaint = hyp.k_cc_maintenu_ge * iN;
    note.ajouter(rub, "Icc triphasé subtransitoire I''k3", arrondi(iKSub), "A", R.GE_ICC);
    note.ajouter(rub, "Icc maintenu (excitation AREP/PMG)", arrondi(iKMaint), "A", R.GE_ICC);
    note.ajouter(rub, "Consommation à 75 % de charge", arrondi(hyp.conso_a * 0.75 * 0.8 * sGe + hyp.conso_b * 0.8 * sGe, 2), "L/h", R.GE_CONSO);
    const inInv = calibreSuperieur(Math.max(iN, bilan.i_b_tgbt_a), CALIBRES_INVERSEURS);
    note.ajouter(rub, "Inverseur de source (si réseau public)", `${inInv} A, 4 pôles, AC-33A`, "", R.ATS);
    if (systeme === "hybride") {
      note.info(rub, "Site isolé : le transfert groupe ↔ onduleur est assuré par le relais de transfert de "
        + `l'onduleur/chargeur, à choisir ≥ ${fr(iN, 0)} A par phase`, R.ATS);
    }
    return { s_kva: sGe, p_site_w: pSite, p_assignee_w: 0.8 * sGeVa, i_n_a: iN, k_declassement: kTot, critere,
      criteres_va: criteres, p_charge_ac_max_w: pChargeAc, i_k_sub_a: iKSub, i_k_maintenu_a: iKMaint };
  }

  /** Groupe seul : marche aux heures où l'installation consomme, consommation et taux de charge. */
  function exploitationGroupeSeul(note, hyp, bilan, ge) {
    const rub = "Exploitation du groupe";
    const pN = ge.p_site_w / 1000;
    const prof = bilan.profil_p_w.map((p) => p / 1000);
    const heures = prof.filter((p) => p > 0);
    const carburantJour = somme(heures.map((p) => hyp.conso_a * p + hyp.conso_b * (ge.p_assignee_w / 1000)));
    const tauxMoyen = heures.length ? somme(heures) / heures.length / pN : 0;
    const ppa = heures.length ? somme(heures.map((p) => Math.max(p, hyp.taux_charge_min_ge * pN))) / heures.length / pN : 0;
    const faibles = heures.filter((p) => p < hyp.taux_charge_min_ge * pN).length;
    note.ajouter(rub, "Heures de marche", heures.length, "h/j", "Marche aux heures où l'installation consomme");
    note.ajouter(rub, "Énergie produite", arrondi(somme(heures), 1), "kWh/j", "");
    note.ajouter(rub, "Carburant consommé", arrondi(carburantJour, 1), "L/j", R.GE_CONSO);
    note.ajouter(rub, "Carburant consommé", arrondi(carburantJour * 365), "L/an", R.GE_CONSO);
    note.ajouter(rub, "Taux de charge moyen en marche", pct(tauxMoyen), "", R.GE_ISO);
    note.verifier(rub, ppa <= 0.7 + 1e-9, `Puissance moyenne du groupe ${pct(ppa)} de la PRP (≤ 70 %)`,
      `Puissance moyenne du groupe ${pct(ppa)} de la PRP > 70 % : groupe trop juste en régime continu`, R.GE_ISO);
    const partFaible = heures.length ? faibles / heures.length : 0;
    note.verifier(rub, partFaible <= 0.1,
      `Marche sous ${pct(hyp.taux_charge_min_ge)} de charge : ${pct(partFaible)} des heures (≤ 10 %)`,
      `Marche sous ${pct(hyp.taux_charge_min_ge)} de charge : ${pct(partFaible)} des heures : risque d'encrassement `
      + "(wet stacking) ; ajouter des batteries (hybride), un banc de charge ou un second groupe plus petit",
      "Recommandation constructeurs : ≥ 30 % de charge", "ATTENTION");
    return { heures_jour: heures.length, energie_kwh_j: somme(heures), carburant_l_j: carburantJour,
      carburant_l_an: carburantJour * 365, taux_moyen: tauxMoyen, ppa, part_faible: partFaible };
  }

  // ===========================================================================
  // 10. Simulation horaire (cycle charging)
  // ===========================================================================

  function simuler(jours, prm) {
    const { c_kwh: c, soc_initial: socInitial, soc_min: socMin, soc_demarrage: socDem, soc_arret: socArret,
      eta_rt: etaRt, eta_ond: etaOnd, eta_chg: etaChg, p_charge_batt_kw: pChargeBatt, p_decharge_batt_kw: pDechargeBatt,
      p_ond_kw: pOnd, p_chargeur_kw: pChargeur, p_ge_kw: pGe, p_ge_assignee_kw: pGeAssignee, taux_cible: tauxCible,
      taux_min: tauxMin, conso_a: a, conso_b: b } = prm;
    const avecGroupe = pGe > 0;
    const etaC = Math.sqrt(etaRt);
    const etaD = etaC;
    let e = socInitial * c;
    const eInitial = e;
    const eMin = socMin * c;
    const eDem = socDem * c;
    const eArret = socArret * c;
    const t = { charge: 0, servie: 0, non_servie: 0, pv_dispo: 0, pv_utilise: 0, pv_ecrete: 0, ge: 0, carburant: 0,
      heures_ge: 0, demarrages: 0, heures_ge_faible: 0, ppa_somme: 0, decharge_batt: 0, pertes: 0, heures_delestage: 0 };
    let socMini = 1;
    let geOn = false;
    const trace = [];
    const geParJour = [];
    for (const [charge, pv] of jours) {
      let geJour = 0;
      for (let h = 0; h < 24; h++) {
        const L = charge[h];
        const pvDc = pv[h];
        t.charge += L;
        t.pv_dispo += pvDc;
        const pvLoad = Math.min(pvDc, L / etaOnd, pOnd / etaOnd);
        const lRest = L - pvLoad * etaOnd;
        const pvRest = pvDc - pvLoad;
        if (avecGroupe && !geOn && lRest > 0) {
          const besoin = lRest / etaOnd;
          if (besoin > (e - eDem) * etaD || besoin > pDechargeBatt || L > pOnd) {
            geOn = true;
            t.demarrages += 1;
          }
        }
        let accept = Math.min(pChargeBatt, Math.max(0, (c - e) / etaC));
        const pvBatt = Math.min(pvRest, accept);
        accept -= pvBatt;
        let battOut = 0;
        let geLoad = 0;
        let geCh = 0;
        let chDc = 0;
        let nonServi = 0;
        if (geOn) {
          geLoad = Math.min(lRest, pGe);
          const deficit = lRest - geLoad;
          if (deficit > 0) {
            battOut = Math.min(deficit / etaOnd, Math.max(0, (e - eMin) * etaD), pDechargeBatt);
            nonServi = deficit - battOut * etaOnd;
          }
          const marge = Math.max(0, Math.min(tauxCible * pGe - geLoad, pGe - geLoad));
          chDc = Math.min(accept, pChargeur, marge * etaChg);
          geCh = chDc / etaChg;
          const geOut = geLoad + geCh;
          t.ge += geOut;
          t.heures_ge += 1;
          t.carburant += a * geOut + b * pGeAssignee;
          t.ppa_somme += Math.max(geOut, tauxMin * pGe);
          if (geOut < tauxMin * pGe) t.heures_ge_faible += 1;
        } else if (avecGroupe) {
          battOut = lRest / etaOnd;
        } else {
          battOut = Math.min(lRest / etaOnd, Math.max(0, (e - eMin) * etaD), pDechargeBatt, pOnd / etaOnd);
          nonServi = lRest - battOut * etaOnd;
        }
        e += (pvBatt + chDc) * etaC - battOut / etaD;
        socMini = Math.min(socMini, e / c);
        if (nonServi > 1e-9) t.heures_delestage += 1;
        t.servie += L - nonServi;
        t.non_servie += nonServi;
        t.pv_utilise += pvLoad + pvBatt;
        t.pv_ecrete += pvRest - pvBatt;
        t.decharge_batt += battOut;
        t.pertes += (pvLoad + battOut) * (1 - etaOnd) + (pvBatt + chDc) * (1 - etaC) + battOut * (1 / etaD - 1) + geCh * (1 - etaChg);
        const geHeure = geOn ? geLoad + geCh : 0;
        geJour += geHeure;
        trace.push({ h, charge: L, pv: pvDc, batterie: battOut - (pvBatt + chDc), ge: geHeure, soc: e / c, non_servi: nonServi });
        if (geOn && e >= eArret) geOn = false;
      }
      geParJour.push(geJour);
    }
    t.delta_stock = e - eInitial;
    t.soc_mini = socMini;
    t.ppa = t.heures_ge ? t.ppa_somme / t.heures_ge / pGe : 0;
    t.fraction_renouvelable = t.servie ? 1 - t.ge / t.servie : 0;
    t.cycles_equivalents = t.decharge_batt / (c * (1 - socMin));
    t.llp = t.charge ? t.non_servie / t.charge : 0;
    t.trace = trace;
    t.ge_par_jour = geParJour;
    return t;
  }

  function facteursMeteo(ktMensuel, hyp) {
    const rng = mulberry32(hyp.graine_meteo);
    const phi = hyp.autocorrelation_journaliere;
    const sigma = hyp.variabilite_journaliere;
    let z = 0;
    const sequence = [];
    for (let m = 0; m < 12; m++) {
      const fMax = hyp.kt_ciel_clair / ktMensuel[m];
      const bruts = [];
      for (let j = 0; j < JOURS_PAR_MOIS[m]; j++) {
        z = phi * z + Math.sqrt(1 - phi ** 2) * rng.gauss();
        bruts.push(Math.min(fMax, Math.max(0.1, 1 + sigma * z)));
      }
      const moyenne = somme(bruts) / bruts.length;
      for (const f of bruts) sequence.push([m, Math.min(fMax, f / moyenne)]);
    }
    return sequence;
  }

  function preparerSimulation(hyp, bilan, gis, pv, onduleur, batt, chimie, ge) {
    const chargeKw = bilan.profil_p_w.map((p) => p / 1000);
    const pvMois = gis.ht.map((h, m) => repartitionHoraire(gis.ws[m]).map((r) => (pv.p_installee_w / 1000) * h * pv.pr * r));
    const socMin = 1 - chimie.dod;
    const prm = {
      c_kwh: batt.c_installee_kwh, soc_min: socMin, soc_demarrage: socMin + 0.05, soc_arret: chimie.soc_arret_ge,
      eta_rt: chimie.rendement_aller_retour, eta_ond: hyp.rendement_onduleur, eta_chg: hyp.rendement_chargeur,
      p_charge_batt_kw: (chimie.c_charge_max * batt.c_installee_ah * uChargeBus(onduleur.u_bus, chimie)) / 1000,
      p_decharge_batt_kw: (chimie.c_decharge_max * batt.c_installee_ah * batt.u_min) / 1000,
      p_ond_kw: (0.8 * onduleur.s_total_va * hyp.k_temp_onduleur) / 1000,
      p_chargeur_kw: ge ? (ge.p_charge_ac_max_w * hyp.rendement_chargeur) / 1000 : 0,
      p_ge_kw: ge ? ge.p_site_w / 1000 : 0, p_ge_assignee_kw: ge ? ge.p_assignee_w / 1000 : 0,
      taux_cible: hyp.taux_charge_cible_ge, taux_min: hyp.taux_charge_min_ge, conso_a: hyp.conso_a, conso_b: hyp.conso_b,
    };
    const socInitial = ge ? chimie.soc_arret_ge : 1;
    const meteo = facteursMeteo(gis.kt, hyp);
    const jours = meteo.map(([m, f]) => [chargeKw, pvMois[m].map((p) => p * f)]);
    const annuel = simuler(jours, { ...prm, soc_initial: socInitial });
    const mCrit = gis.mois_critique;
    let j;
    if (Math.max(...annuel.ge_par_jour) > 0) {
      j = argmax(meteo.length, (k) => annuel.ge_par_jour[k]);
    } else {
      const candidats = meteo.map((x, k) => k).filter((k) => meteo[k][0] === mCrit);
      j = candidats.reduce((best, k) => (meteo[k][1] < meteo[best][1] ? k : best), candidats[0]);
    }
    annuel.jour_publie = { jour: j + 1, mois: MOIS[meteo[j][0]], facteur_meteo: meteo[j][1], heures: annuel.trace.slice(24 * j, 24 * j + 24) };
    annuel.mensuel = MOIS.map((nom, m) => {
      const jm = meteo.map((x, k) => k).filter((k) => meteo[k][0] === m);
      const heures = jm.flatMap((k) => annuel.trace.slice(24 * k, 24 * k + 24));
      return { mois: nom, charge_kwh: somme(heures.map((x) => x.charge)), pv_kwh: somme(jm.map((k) => somme(jours[k][1]))),
        ge_kwh: somme(heures.map((x) => x.ge)), non_servi_kwh: somme(heures.map((x) => x.non_servi)) };
    });
    const pvStress = pvMois[mCrit].map((p) => p * hyp.facteur_meteo_stress);
    const stress = simuler(new Array(hyp.jours_stress).fill([chargeKw, pvStress]), { ...prm, soc_initial: socInitial });
    return { annuel, stress, prm };
  }

  function verifierSimulation(note, hyp, annuel, stress, avecGroupe) {
    const rub = "Simulation";
    note.ajouter(rub, "Profil de production horaire", "365 jours × 24 h", "", R.SOL_HORAIRE);
    note.ajouter(rub, "Variabilité journalière de l'ensoleillement",
      `σ = ${pct(hyp.variabilite_journaliere)}, persistance ${fr(hyp.autocorrelation_journaliere, 2)}`, "",
      "Séquence AR(1) à graine fixe, moyenne mensuelle conservée (remplacer par une année type TMY)");
    note.ajouter(rub, "Consommation annuelle", arrondi(annuel.charge / 1000, 2), "MWh/an", R.SIM);
    note.ajouter(rub, "Production PV disponible", arrondi(annuel.pv_dispo / 1000, 2), "MWh/an", R.SIM);
    note.ajouter(rub, "Énergie PV écrêtée (batterie pleine)", arrondi(annuel.pv_ecrete / 1000, 2), "MWh/an", R.SIM);
    if (avecGroupe) {
      note.ajouter(rub, "Production du groupe", arrondi(annuel.ge / 1000, 2), "MWh/an", R.SIM);
      note.ajouter(rub, "Fraction renouvelable", pct(annuel.fraction_renouvelable), "", "f_EnR = 1 − E_groupe / E_servie");
      note.ajouter(rub, "Heures de marche du groupe", arrondi(annuel.heures_ge), "h/an", R.SIM);
      note.ajouter(rub, "Démarrages du groupe", arrondi(annuel.demarrages), "/an", R.SIM);
      note.ajouter(rub, "Carburant consommé", arrondi(annuel.carburant), "L/an", R.GE_CONSO);
    } else {
      note.ajouter(rub, "Énergie non servie (délestage)", arrondi(annuel.non_servie, 1), "kWh/an", R.SIM);
      note.ajouter(rub, "Taux de délestage LLP", pct(annuel.llp, 2), "", "LLP = E_non servie / E_demandée");
      note.ajouter(rub, "Heures avec délestage", arrondi(annuel.heures_delestage), "h/an", R.SIM);
    }
    note.ajouter(rub, "Cycles équivalents batterie", arrondi(annuel.cycles_equivalents), "/an", R.SIM);
    note.ajouter(rub, "État de charge minimal atteint", pct(annuel.soc_mini), "", R.SIM);
    if (avecGroupe) {
      note.verifier(rub, annuel.non_servie < 1e-6, "Toute la consommation annuelle est servie",
        `Énergie non servie : ${fr(annuel.non_servie)} kWh/an`, R.SIM);
      if (annuel.heures_ge) {
        note.verifier(rub, annuel.ppa <= 0.7 + 1e-9, `Puissance moyenne du groupe ${pct(annuel.ppa)} de la PRP (≤ 70 %)`,
          `Puissance moyenne du groupe ${pct(annuel.ppa)} de la PRP > 70 %`, R.GE_ISO);
        const faible = annuel.heures_ge_faible / annuel.heures_ge;
        note.verifier(rub, faible <= 0.1, `Marche sous ${pct(hyp.taux_charge_min_ge)} de charge : ${pct(faible)} des heures (≤ 10 %)`,
          `Marche sous ${pct(hyp.taux_charge_min_ge)} de charge : ${pct(faible)} des heures : risque d'encrassement `
          + "(wet stacking), prévoir banc de charge ou groupe plus petit", "Recommandation constructeurs : ≥ 30 % de charge", "ATTENTION");
      }
      note.ajouter(rub, `Test ${hyp.jours_stress} j à ${pct(hyp.facteur_meteo_stress)} d'ensoleillement : groupe`,
        `${fr(stress.heures_ge / hyp.jours_stress)} h/j, ${fr(stress.carburant / hyp.jours_stress, 0)} L/j`, "", R.SIM);
      note.verifier(rub, stress.non_servie < 1e-6, "Test « jours sans soleil » : aucune coupure",
        `Test « jours sans soleil » : ${fr(stress.non_servie)} kWh non servis`, R.SIM);
    } else {
      note.verifier(rub, annuel.llp <= hyp.objectif_llp,
        `Taux de délestage ${pct(annuel.llp, 2)} ≤ objectif ${pct(hyp.objectif_llp, 1)}`,
        `Taux de délestage ${pct(annuel.llp, 2)} > objectif ${pct(hyp.objectif_llp, 1)} : augmenter l'autonomie, `
        + "le champ PV, ou ajouter un groupe d'appoint (système hybride)", R.SIM, "ATTENTION");
      note.ajouter(rub, `Test ${hyp.jours_stress} j à ${pct(hyp.facteur_meteo_stress)} d'ensoleillement`,
        `${fr(stress.non_servie, 1)} kWh non servis`, "", R.SIM);
      if (stress.non_servie > 1e-6) {
        note.info(rub, `Sur ${hyp.jours_stress} jours très couverts, ${fr(stress.non_servie)} kWh ne seraient pas servis : `
          + "prévoir un délestage des usages non prioritaires ou un groupe d'appoint", R.SIM);
      }
    }
  }

  // ===========================================================================
  // 11. Module A — câbles et protections
  // ===========================================================================

  function choisirCourbe(c, inC) {
    if (c.courbe) return c.courbe;
    let iAppel = 0;
    for (const r of c.recepteurs) {
      if (r.moteur) iAppel = Math.max(iAppel, courantNominalMoteur(r, c.triphase) * r.quantite * MODES_DEMARRAGE[r.demarrage].id_in);
    }
    for (const k of ["B", "C", "D"]) if (MAGNETIQUE_MIN[k] * inC > 1.2 * iAppel) return k;
    return "D";
  }

  function cablesEtProtections(note, site, hyp, bilan, systeme, ctx) {
    const rub = "A. Câbles et protections";
    const { onduleur, pv, batt, ge, module, mppt } = ctx;
    const kTAc = kTemperature(site.t_amb_max);
    const kTDc = kTemperature(hyp.t_batterie_min + 10);
    const iOnd = onduleur ? (onduleur.n_par_phase * onduleur.unite_va) / U0 : 0;
    const iccOnd = onduleur ? hyp.k_cc_onduleur * iOnd : 0;
    const iccMaxTgbt = (ge ? ge.i_k_sub_a : 0) + iccOnd;
    const iRacT = Math.max(iccMaxTgbt * Math.sqrt(0.1), Math.max(iccOnd, ge ? ge.i_k_maintenu_a : 0) * Math.sqrt(5));
    const res = [];
    const ajouterLiaison = (liaison, iB, protection, longueur, dim) => {
      if (!dim) {
        note.verifier(rub, false, "", `${liaison} : aucune section ≤ 300 mm² (8 conducteurs en parallèle) ne convient`, R.DU);
        return null;
      }
      res.push({ liaison, i_b_a: iB, protection, longueur_m: longueur, ...dim });
      return dim;
    };

    let cGe = null;
    let amont = null; // tronçon en amont du TGBT pour le calcul des Icc
    let duAmont = 0;
    if (ge) {
      const inGe = calibreSuperieur(ge.i_n_a, CALIBRES_DISJ);
      const vers = systeme === "groupe" ? "Groupe → TGBT" : "Groupe → onduleur (AC-in)";
      cGe = ajouterLiaison(vers, ge.i_n_a, `Disj. 4P ${inGe} A`, hyp.longueur_ge_m, dimensionnerCable({
        iRequis: inGe, kCorrection: kTAc, tableIz: IZ_CU_PR_E[3], chuteMax: 1.5, contrainteARacS: iRacT,
        chute: (s, n) => chuteTensionAC(ge.i_n_a / n, hyp.longueur_ge_m, s, 0.8, true) }));
      if (systeme === "groupe" && cGe) duAmont = cGe.chute_cumulee_pct;
    }
    let cOnd = null;
    if (onduleur) {
      const iBOnd = Math.max(iOnd, ge ? ge.i_n_a : 0);
      const inOnd = calibreSuperieur(iBOnd, CALIBRES_DISJ);
      cOnd = ajouterLiaison("Onduleurs (AC-out) → TGBT", iBOnd, `Disj. 4P ${inOnd} A`, hyp.longueur_onduleur_tgbt_m, dimensionnerCable({
        iRequis: inOnd, kCorrection: kTAc, tableIz: IZ_CU_PR_E[3], chuteMax: 1.0, contrainteARacS: iRacT,
        chute: (s, n) => chuteTensionAC(iBOnd / n, hyp.longueur_onduleur_tgbt_m, s, 0.9, true) }));
      if (cOnd) duAmont = cOnd.chute_cumulee_pct;

      const iDc = (0.8 * onduleur.unite_va) / (batt.u_min * hyp.rendement_onduleur);
      const inDc = calibreSuperieur(1.25 * iDc, CALIBRES_FUSIBLES_DC);
      ajouterLiaison("Batterie → chaque onduleur (DC)", iDc, `Fusible DC ${inDc} A`, hyp.longueur_batterie_m, dimensionnerCable({
        iRequis: inDc * 1.1, kCorrection: kTDc, tableIz: IZ_CU_PR_E[2], chuteMax: hyp.chute_max_dc,
        chute: (s, n) => chuteTensionDC(iDc / n, hyp.longueur_batterie_m, s, batt.u_nom) }));

      const nChaines = pv.n_mppt * pv.np;
      const iChaine = 1.25 * module.isc;
      const kPv = kTemperature(hyp.t_cable_pv, 120, 60) * facteurGroupement(nChaines, "couche_paroi");
      const vChaine = pv.ns * module.vmp;
      ajouterLiaison("Chaîne PV → régulateur (H1Z2Z2-K)", iChaine, "Sectionneur DC", hyp.longueur_chaine_m, dimensionnerCable({
        iRequis: iChaine, kCorrection: kPv, tableIz: IZ_PV, sections: SECTIONS_PV, chuteMax: hyp.chute_max_pv, sMin: 4, nMax: 1,
        chute: (s) => chuteTensionDC(module.imp, hyp.longueur_chaine_m, s, vChaine) }));

      const inMppt = calibreSuperieur(1.25 * mppt.i_charge_max, CALIBRES_FUSIBLES_DC);
      ajouterLiaison("Régulateur → batterie (DC)", mppt.i_charge_max, `Fusible DC ${inMppt} A`, hyp.longueur_batterie_m, dimensionnerCable({
        iRequis: inMppt * 1.1, kCorrection: kTDc, tableIz: IZ_CU_PR_E[2], chuteMax: hyp.chute_max_dc,
        chute: (s, n) => chuteTensionDC(mppt.i_charge_max / n, hyp.longueur_batterie_m, s, batt.u_nom) }));
      note.info(rub, `Protections côté batterie : pouvoir de coupure continu ≥ ${fr(batt.icc_a / 1000)} kA ; `
        + "contrainte thermique à vérifier avec l'I²t limité du fusible (fiche constructeur)", R.ADIAB);
    }
    if (systeme === "groupe" && cGe) amont = [hyp.longueur_ge_m, cGe.section_mm2, cGe.conducteurs_paralleles];
    else if (cOnd) amont = [hyp.longueur_onduleur_tgbt_m, cOnd.section_mm2, cOnd.conducteurs_paralleles];

    const nCirc = bilan.lignes.length;
    const kCirc = kTAc * facteurGroupement(nCirc, hyp.disposition_circuits);
    note.ajouter(rub, "Courants admissibles", "méthode E, cuivre PR, 30 °C", "", R.IZ);
    if (onduleur) note.ajouter(rub, "Câbles de chaînes PV", "H1Z2Z2-K, I_B = 1,25·Isc", "", R.PV_CABLE);
    note.ajouter(rub, "Chute de tension maximale côté AC", `${fr(hyp.chute_max_eclairage)} % éclairage / ${fr(hyp.chute_max_autres)} % autres`, "", R.DU);
    if (onduleur) note.ajouter(rub, "Chute de tension maximale côté DC", `${fr(hyp.chute_max_dc)} % batterie / ${fr(hyp.chute_max_pv)} % chaînes PV`, "", R.DU_DC);
    note.ajouter(rub, "Courbe des disjoncteurs terminaux", "B, sauf appel moteur (C ou D)", "", R.COURBES);
    note.ajouter(rub, `Facteur de température câbles PR à ${fr(site.t_amb_max)} °C`, arrondi(kTAc, 3), "", R.KT);
    note.ajouter(rub, `Facteur de groupement (${nCirc} circuits)`, facteurGroupement(nCirc, hyp.disposition_circuits), "", R.KG);

    const sources = [];
    if (onduleur && systeme !== "groupe") sources.push(["onduleur", iccOnd, []]);
    if (ge && cGe) sources.push(["groupe", ge.i_k_maintenu_a, systeme === "groupe" ? [] : [[hyp.longueur_ge_m, cGe.section_mm2, cGe.conducteurs_paralleles]]]);
    const nonInstantane = Object.fromEntries(sources.map(([nom]) => [nom, []]));
    for (const l of bilan.lignes) {
      const c = l.circuit;
      const iMoteurs = somme(c.recepteurs.filter((r) => r.moteur).map((r) => courantNominalMoteur(r, c.triphase) * r.quantite));
      const inC = calibreSuperieur(Math.max(l.i_b_a, iMoteurs, c.calibre_min), CALIBRES_DISJ);
      const courbe = choisirCourbe(c, inC);
      const chuteMax = c.eclairage ? hyp.chute_max_eclairage : hyp.chute_max_autres;
      const dim = dimensionnerCable({
        iRequis: inC, kCorrection: kCirc, tableIz: IZ_CU_PR_E[c.triphase ? 3 : 2], chuteMax, contrainteARacS: iRacT, sMin: c.section_min,
        chute: (s, n) => duAmont + chuteTensionAC(l.i_b_a / n, c.longueur_m, s, l.cos_phi, c.triphase) });
      if (!dim) {
        note.verifier(rub, false, "", `${c.nom} : aucune section ne satisfait les critères (circuit trop long ou trop chargé)`, R.DU);
        continue;
      }
      const troncons = [...(amont ? [amont] : []), [c.longueur_m, dim.section_mm2, dim.conducteurs_paralleles]];
      const seuil = MAGNETIQUE_MAX[courbe] * inC;
      const icc = {};
      for (const [nom, iccSource, avant] of sources) {
        icc[nom] = iccMinFinLigne(iccSource, [...avant, ...troncons]);
        if (icc[nom] < seuil) nonInstantane[nom].push(`${c.nom.split(" ")[0]} (${fr(icc[nom], 0)} A < ${fr(seuil, 0)} A)`);
      }
      res.push({ liaison: c.nom, i_b_a: l.i_b_a, protection: `Disj. ${inC} A courbe ${courbe}`, longueur_m: c.longueur_m,
        icc_min_onduleur_a: icc.onduleur === undefined ? null : arrondi(icc.onduleur),
        icc_min_groupe_a: icc.groupe === undefined ? null : arrondi(icc.groupe), seuil_magnetique_a: seuil, ...dim });
    }
    if ("groupe" in nonInstantane) {
      note.verifier(rub, !nonInstantane.groupe.length, "Sur groupe : déclenchement magnétique assuré sur tous les circuits terminaux",
        `Sur groupe, Icc mini < seuil magnétique : ${nonInstantane.groupe.join(", ")} — vérifier la coupure sur la courbe `
        + "temps-courant ou réduire calibre/longueur", R.TCOUP, "ATTENTION");
    }
    if ("onduleur" in nonInstantane) {
      note.verifier(rub, !nonInstantane.onduleur.length, "Sur onduleur : déclenchement magnétique assuré sur tous les circuits terminaux",
        `Sur onduleur, Icc mini < seuil magnétique : ${nonInstantane.onduleur.join(", ")} — l'onduleur limite puis coupe avant `
        + "le disjoncteur (perte de sélectivité) ; choisir un onduleur à fort courant de court-circuit si la continuité de "
        + "service l'exige", R.TCOUP, "ATTENTION");
    }
    note.ajouter(rub, `Icc maximal au TGBT${ge && onduleur ? " (groupe + onduleurs)" : ""}`, arrondi(iccMaxTgbt), "A", R.ICC);
    const icu = iccMaxTgbt / 1000;
    note.info(rub, `Pouvoir de coupure Icu ≥ ${fr(icu)} kA${icu <= 6 ? " : disjoncteurs modulaires 6 kA suffisants" : ""}`, R.PROT);
    note.info(rub, "Protection des personnes : DDR 30 mA sur tous les circuits terminaux"
      + (onduleur ? " ; en îlotage, l'onduleur doit relier neutre et terre (relais de terre) pour conserver le schéma TN-S" : ""), R.TCOUP);
    return res;
  }

  // ===========================================================================
  // 12. Orchestration
  // ===========================================================================

  function executer(projetBrut) {
    const { projet, erreurs } = valider(projetBrut);
    if (erreurs.length) {
      const err = new Error(erreurs.join("\n"));
      err.erreurs = erreurs;
      throw err;
    }
    const { site, circuits, module, mppt, hyp, systeme } = projet;
    const chimie = CHIMIES[hyp.chimie];
    const note = new Note();
    const bilan = bilanPuissance(note, circuits, hyp);
    if (!(bilan.energie_wh_j > 0) && systeme !== "groupe") {
      throw new Error("La consommation journalière est nulle : indiquez les plages horaires de fonctionnement des récepteurs.");
    }
    if (!(bilan.s_dim_va > 0)) throw new Error("La puissance de l'installation est nulle : vérifiez les récepteurs.");
    let gis = null;
    let onduleur = null;
    let pv = null;
    let batt = null;
    let ge = null;
    let sim = null;
    let exploitation = null;
    if (systeme !== "groupe") {
      gis = gisementSolaire(note, site, hyp);
      onduleur = dimensionnerOnduleur(note, bilan, circuits, hyp);
      pv = dimensionnerPV(note, site, hyp, bilan, gis, onduleur, chimie, module, mppt);
      batt = dimensionnerBatteries(note, hyp, bilan, onduleur, pv, chimie, mppt);
    }
    if (systeme !== "solaire") ge = dimensionnerGroupe(note, site, hyp, bilan, circuits, systeme, { gis, onduleur, batt, chimie });
    if (systeme !== "groupe") {
      sim = preparerSimulation(hyp, bilan, gis, pv, onduleur, batt, chimie, ge);
      verifierSimulation(note, hyp, sim.annuel, sim.stress, Boolean(ge));
    } else {
      exploitation = exploitationGroupeSeul(note, hyp, bilan, ge);
    }
    const cables = cablesEtProtections(note, site, hyp, bilan, systeme, { onduleur, pv, batt, ge, module, mppt });

    const nomenclature = [];
    if (pv) {
      nomenclature.push(`${pv.n_modules} × ${module.nom} → ${fr(pv.p_installee_w / 1000, 2)} kWc, inclinaison ${gis.beta}° ${site.latitude >= 0 ? "plein Sud" : "plein Nord"}`);
      nomenclature.push(`${pv.n_mppt} × ${mppt.nom} (${pv.ns} série × ${pv.np} parallèle par régulateur)`);
      nomenclature.push(`Batteries : ${batt.designation} → ${fr(batt.c_installee_kwh)} kWh`);
      nomenclature.push(`Onduleurs/chargeurs : 3 × ${onduleur.n_par_phase} × ${fr(onduleur.unite_va / 1000)} kVA, bus ${onduleur.u_bus} V DC`);
    }
    if (ge) nomenclature.push(`Groupe électrogène : ${fr(ge.s_kva)} kVA PRP (critère : ${ge.critere})`);

    const compte = (s) => note.verifications.filter((v) => v.statut === s).length;
    const synthese = {
      systeme, systeme_libelle: SYSTEMES[systeme],
      energie_kwh_j: bilan.energie_wh_j / 1000, s_dim_kva: bilan.s_dim_va / 1000, p_dim_kw: bilan.p_dim_w / 1000,
      cos_phi: bilan.cos_phi, i_b_tgbt_a: bilan.i_b_tgbt_a,
      pv: pv && { kwc: pv.p_installee_w / 1000, kwc_requis: pv.p_requise_w / 1000, n_modules: pv.n_modules, n_mppt: pv.n_mppt,
        config: `${pv.ns} série × ${pv.np} parallèle`, inclinaison: gis.beta, mois_critique: MOIS[gis.mois_critique], psh: gis.ht[gis.mois_critique] },
      batteries: batt && { kwh: batt.c_installee_kwh, ah: batt.c_installee_ah, u_nom: batt.u_nom, designation: batt.designation },
      onduleur: onduleur && { kva: onduleur.s_total_va / 1000, designation: `3 × ${onduleur.n_par_phase} × ${fr(onduleur.unite_va / 1000)} kVA`, u_bus: onduleur.u_bus },
      groupe: ge && { kva: ge.s_kva, kw: ge.p_assignee_w / 1000, critere: ge.critere },
      simulation: sim && { fraction_renouvelable: sim.annuel.fraction_renouvelable, heures_ge: sim.annuel.heures_ge,
        carburant_l_an: sim.annuel.carburant, non_servie_kwh: sim.annuel.non_servie, llp: sim.annuel.llp,
        pv_ecrete_kwh: sim.annuel.pv_ecrete },
      exploitation,
      verifications: { non_conforme: compte("NON CONFORME"), attention: compte("ATTENTION"), ok: compte("OK") },
    };
    return {
      version: VERSION, projet, synthese, bilan, gisement: gis, onduleur, pv, batteries: batt, groupe: ge,
      simulation: sim && { annuel: sim.annuel, stress: sim.stress }, exploitation, cables, nomenclature,
      note: note.lignes, verifications: note.verifications, references: note.references,
    };
  }

  // ===========================================================================
  // 13. Projet d'exemple (même cas que le démonstrateur Python)
  // ===========================================================================

  function projetExemple() {
    const r = (nom, quantite, puissance_w, cos_phi, plages, extra = {}) => ({ nom, quantite, puissance_w, cos_phi, plages, ...extra });
    return {
      nom: "Centre de santé rural (exemple)",
      systeme: "hybride",
      site: { ...SITE },
      circuits: [
        { nom: "C1 Éclairage intérieur", longueur_m: 40, eclairage: true,
          recepteurs: [r("Luminaire LED 18 W", 50, 18, 0.9, [[6, 8, 0.5], [8, 18, 0.3], [18, 23, 1], [23, 6, 0.15]])] },
        { nom: "C2 Éclairage extérieur", longueur_m: 60, eclairage: true,
          recepteurs: [r("Projecteur LED 50 W", 6, 50, 0.9, [[18, 6, 1]])] },
        { nom: "C3 Climatisation salles de soins", longueur_m: 25,
          recepteurs: [r("Split inverter 1,2 kW", 2, 1200, 0.95, [[9, 17, 0.7]])] },
        { nom: "C4 Chaîne du froid (vaccins)", longueur_m: 20,
          recepteurs: [r("Réfrigérateur médical", 2, 150, 0.8, [[0, 24, 0.5]])] },
        { nom: "C5 Bureautique / informatique", longueur_m: 30,
          recepteurs: [r("Poste informatique", 6, 120, 0.95, [[8, 17, 0.8]])] },
        { nom: "C6 Prises de courant", longueur_m: 35, ks: 0.2, calibre_min: 20, section_min: 2.5,
          recepteurs: [r("Prise 16 A (usages divers)", 20, 250, 0.9, [[8, 17, 0.08]])] },
        { nom: "C7 Stérilisation", longueur_m: 20,
          recepteurs: [r("Autoclave", 1, 2000, 1, [[10, 12, 0.8]])] },
        { nom: "C8 Pompe de forage", longueur_m: 80, triphase: true,
          recepteurs: [r("Moteur asynchrone 3 kW", 1, 3000, 0.82, [[10, 13, 1]], { rendement: 0.85, ku: 0.9, moteur: true, demarrage: "progressif" })] },
        { nom: "C9 Équipements médicaux", longueur_m: 25,
          recepteurs: [r("Concentrateur d'oxygène", 1, 350, 0.95, [[0, 24, 0.5]]), r("Aspirateur de mucosités", 1, 200, 0.9, [[8, 18, 0.1]])] },
        { nom: "C10 Laboratoire", longueur_m: 30,
          recepteurs: [r("Centrifugeuse, incubateur, microscopes", 1, 1000, 0.9, [[8, 16, 0.5]])] },
      ],
      module: { ...MODULE_PV },
      mppt: { ...REGULATEUR },
      hypotheses: {},
    };
  }

  const VERSION = "0.2.0";

  racine.Moteur = Object.freeze({
    VERSION, executer, valider, normaliser, projetExemple,
    HYPOTHESES, SITE, MODULE_PV, REGULATEUR, CHIMIES, MODES_DEMARRAGE, SYSTEMES, MOIS, JOURS_PAR_MOIS,
    outils: { irradiationExtraterrestre, repartitionHoraire, chuteTensionAC, kTemperature, dimensionnerCable, simuler, mulberry32, facteursMeteo },
  });
})(typeof globalThis !== "undefined" ? globalThis : this);
