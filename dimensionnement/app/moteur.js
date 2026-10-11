/*
 * Moteur de dimensionnement électrique — bâtiment BT, solaire, batteries, groupe électrogène,
 * raccordement réseau, compensation de l'énergie réactive et lignes aériennes BT.
 *
 * Référentiels normatifs : NF C 15-100 (France), IEC 60364 (international), BS 7671 (Royaume-Uni),
 * NEC / NFPA 70 (États-Unis). Le référentiel choisi fixe les tables (sections en mm² ou AWG), les règles de
 * protection, les limites de chute de tension, les conducteurs de protection et les références citées.
 *
 * Pour le référentiel NF C 15-100 en 400/230 V, les résultats sont identiques à ceux du démonstrateur
 * Python (../demo_hybride.py) ; un test le vérifie.
 * Script classique sans dépendance : window.Moteur dans le navigateur, globalThis.Moteur dans Node.
 *
 * Outil d'aide à la conception : tables et hypothèses à valider contre l'édition en vigueur des normes
 * et les fiches constructeurs ; toute note remise à un bureau de contrôle est validée par un ingénieur.
 */
(function (racine) {
  "use strict";

  const VERSION = "1.2.1";

  // ===========================================================================
  // 0. Référentiels normatifs et réseaux
  // ===========================================================================

  const REFS_COMMUNES = {
    BOUCHEROT: "Théorème de Boucherot : P et Q s'additionnent séparément, S = √(P² + Q²)",
    KU_KS: "Méthode des facteurs d'utilisation et de simultanéité : P = ks · Σ(ku · Pabs)",
    KS_TABLEAU: "IEC 61439-2 Tab. 101 : facteur de diversité assigné (2-3 circ. 0,9 ; 4-5 : 0,8 ; 6-9 : 0,7 ; ≥10 : 0,6)",
    IB: "I_B = S/(√3·U) en triphasé ; I_B = S/U en monophasé ou entre deux phases",
    SOL_GEO: "Duffie & Beckman : déclinaison de Cooper, H0 extraterrestre (Gsc = 1367 W/m²)",
    SOL_DIFF: "Erbs et al. (corrélation mensuelle de la fraction diffuse)",
    SOL_TRANSPO: "Liu & Jordan (modèle isotrope), Rb mensuel de Klein",
    SOL_HORAIRE: "Collares-Pereira & Rabl : répartition horaire de l'irradiation journalière",
    PV_TEMP: "T_cell = T_amb + (NOCT − 20)/800·G ; P = Pstc·(1 + γ·(T_cell − 25))",
    PV_PC: "Pc = E_PV / (PSH · PR) ; PSH = H_T / 1 kW/m²",
    BATT_VIEIL: "IEEE 485 : facteur de vieillissement 1,25 (plomb, fin de vie à 80 %)",
    ONDULEUR: "S_ond·k_θ ≥ S_pointe·k_e par phase ; surcharge ≥ S_démarrage + S_reste",
    GE_ISO: "ISO 8528-1 : PRP, puissance moyenne ≤ 70 % (valeurs < 30 % comptées 30 %, arrêts exclus)",
    GE_ESP: "ISO 8528-1 : ESP (secours), ≤ 200 h/an environ, puissance moyenne ≤ 70 %",
    GE_DIP: "Chute transitoire ΔU = x'd·Sd/(S_GE + x'd·Sd) ; classes ISO 8528-5 (G2 : 20 %, G3 : 15 %)",
    GE_DERATE: "ISO 3046-1 / ISO 8528-1 : conditions de référence 25 °C, 100 kPa, 30 % HR ; déclassement selon courbe constructeur",
    GE_CONSO: "Droite de Willans : F = a·P_sortie + b·P_assignée (a ≈ 0,246 L/kWh, b ≈ 0,0815 L/h/kW)",
    GE_ICC: "Alternateur : I''k3 = In/x''d ; courant maintenu ≈ 3·In avec excitation AREP/PMG",
    HYP: "Hypothèse de conception (paramétrable)",
    SIM: "Simulation horaire 8760 h, stratégie cycle charging",
    TRANSFO_ICC: "Icc = In·100/u_k (impédance du transformateur) avec réseau amont S''kQ",
    COMP_Q: "Q_c = P·(tan φ1 − tan φ2)",
    COMP_TYPE: "Pratique constructeurs : batterie fixe si Q_c ≤ 15 % de S_n, sinon automatique à gradins",
    COMP_HARM: "Choix selon Gh/Sn : < 15 % standard ; 15-25 % renforcé ; 25-50 % selfs anti-harmoniques (p = 7 %) ; > 50 % filtrage",
    COMP_RES: "Résonance parallèle : h_r = √(S_cc / Q_c)",
    LIGNE_ETAT: "Équation de changement d'état (Blondel) : T2²·[T2 − T1 + E·S·a²·w1²/(24·T1²) + E·S·α·(θ2 − θ1)] = E·S·a²·w2²/24",
    LIGNE_FLECHE: "Flèche parabolique f = w·a²/(8·T) ; portée équivalente a_eq = √(Σa³/Σa)",
    LIGNE_EFFORT: "Effort en tête : vent sur conducteurs ½(a1 + a2)·P·d, angle 2·T·sin(θ/2), arrêt T",
  };

  const REFS_IEC = {
    PROT: "IEC 60364-4-43 §433.1 : I_B ≤ In ≤ Iz et I2 ≤ 1,45·Iz",
    IZ: "IEC 60364-5-52 Ann. B : courants admissibles, cuivre PR (XLPE) 90 °C, 30 °C ambiant",
    KT: "IEC 60364-5-52 Ann. B : k_θ = √((θp − θa)/(θp − θref))",
    KG: "IEC 60364-5-52 Tab. B.52.17 : facteurs de groupement",
    DU: "IEC 60364-5-52 Ann. G : ΔU = b(ρ1·L/S·cosφ + λ·L·sinφ)·I_B ; 3 % éclairage, 5 % autres (6 / 8 % depuis un poste privé)",
    DU_DC: "IEC 62548 : ΔU = 2ρL·I/S côté continu, viser ≤ 1 % (3 % max)",
    ADIAB: "IEC 60364-4-43 §434.5.2 : S ≥ I·√t / k (k = 143 Cu-PR)",
    COURBES: "IEC 60898-1 : déclenchement magnétique B 3-5·In, C 5-10·In, D 10-20·In",
    TCOUP: "IEC 60364-4-41 Tab. 41.1 : coupure ≤ 0,4 s (TN, 230 V) ; DDR 30 mA (411.3.3)",
    ICC: "IEC 60909-0 : facteur de tension c (0,95 mini, 1,05 maxi) ; ρ ≈ 1,5·ρ0 pour Icc mini",
    PE: "IEC 60364-5-54 Tab. 54.2 : S_PE = S_ph (≤ 16 mm²), 16 mm² (≤ 35), S_ph/2 au-delà",
    PV_GEN: "IEC 60364-7-712 : installations photovoltaïques",
    PV_CHAINES: "IEC 62548 : Voc(Tmin) ≤ Vmax, Vmp(Tmax) ≥ Vmppt,min, Isc(Tmax)·Np ≤ Imax",
    PV_FUS: "IEC 62548 : protection de chaîne si (Np − 1)·1,25·Isc > I_RM ; 1,5·Isc ≤ In ≤ 2,4·Isc",
    PV_CABLE: "EN 50618 (H1Z2Z2-K) : câble seul à l'air libre, 60 °C ambiant, âme 120 °C ; I_B = 1,25·Isc",
    BATT: "IEEE 1013 / IEEE 1562 : C = E·N_aut·k_vieill·k_T / (η_ond·DoD) ; IEC 62619, IEC 62485-2",
    ONDULEUR_NORME: "IEC 62109-1/-2 : sécurité des onduleurs",
    MOTEUR: "IEC 60947-4-1 (démarreurs) ; courant assigné I = P/(√3·U·η·cos φ)",
    GE_CABLE: "IEC 60364-5-55 §551 : groupes générateurs basse tension",
    ATS: "IEC 60947-6-1 : inverseur de source, catégorie AC-33A, 4 pôles en TN-S",
    SECOURS: "IEC 60364-5-56 : services de sécurité",
    TRANSFO: "IEC 60076-1 : transformateurs ; u_k usuel 4 % (≤ 630 kVA), 6 % au-delà",
    COMP: "IEC 60831-1 (condensateurs BT) et IEC 61921 (batteries de compensation) : courant permanent ≤ 1,3·In",
    HARM: "IEC 61000-2-2 / EN 50160 : THDu ≤ 8 %",
    LIGNE_CLIMAT: "IEC/EN 50341 : charges climatiques (vent, givre) des lignes aériennes",
    LIGNE_SUPPORT: "Classes des supports selon la norme produit (efforts nominaux)",
    LIGNE_DU: "IEC 60038 / EN 50160 : tension 230/400 V ± 10 % au point de livraison",
  };

  const REFERENTIELS = {
    nfc15100: {
      code: "nfc15100", nom: "NF C 15-100", libelle: "NF C 15-100 (France)", famille: "iec",
      description: "Norme française des installations basse tension, également appliquée dans de nombreux pays d'Afrique et du Maghreb.",
      rho: 0.023, k_adiab: 143, cos_cible: 0.928, du_ligne: 10, climat: "nf_vent_normal", poteau: "beton", conducteur: "torsade_3x70_54",
      refs: { ...REFS_IEC,
        PROT: "NF C 15-100 §433.1 : I_B ≤ In ≤ Iz et I2 ≤ 1,45·Iz",
        IZ: "NF C 15-100 §523 : courants admissibles (valeurs IEC 60364-5-52), cuivre PR, 30 °C ambiant",
        KT: "NF C 15-100 §523 : correction de température k = √((θp − θa)/(θp − 30))",
        KG: "NF C 15-100 §523 : facteurs de groupement",
        DU: "NF C 15-100 §525 : ΔU = b(ρ1·L/S·cosφ + λ·L·sinφ)·I_B ; 3 % éclairage, 5 % autres (6 / 8 % depuis un poste privé)",
        DU_DC: "Guide UTE C 15-712-1 : ΔU côté continu ≤ 3 %, viser 1 %",
        ADIAB: "NF C 15-100 §434.5.2 : S ≥ I·√t / k (k = 143 Cu-PR)",
        TCOUP: "NF C 15-100 §411.3.2 (coupure ≤ 0,4 s en TN 230 V) et §411.3.3 (DDR 30 mA)",
        ICC: "Guide UTE C 15-105 / IEC 60909-0 : c = 0,95 mini, ρ = 1,5·ρ0 pour Icc mini",
        PE: "NF C 15-100 §543.1 : S_PE = S_ph (≤ 16 mm²), 16 mm² (≤ 35), S_ph/2 au-delà",
        PV_GEN: "NF C 15-100 partie 7-712 et guide UTE C 15-712-1",
        PV_CHAINES: "Guide UTE C 15-712-1 / IEC 62548 : Voc(Tmin) ≤ Vmax, Vmp(Tmax) ≥ Vmppt,min, Isc(Tmax)·Np ≤ Imax",
        GE_CABLE: "NF C 15-100 §551 : groupes générateurs",
        ATS: "NF C 15-100 §551.6 / NF EN 60947-6-1 : inverseur de source 4 pôles en TN-S",
        SECOURS: "NF C 15-100 partie 5-56 (services de sécurité) ; NF S 61-940 (alimentations de sécurité)",
        COMP: "NF EN 60831-1 ; énergie réactive facturée au-delà de tan φ = 0,4 (cos φ 0,928)",
        LIGNE_CLIMAT: "NF C 11-201 et arrêté technique du 17 mai 2001 : hypothèses climatiques des réseaux aériens",
        LIGNE_SUPPORT: "NF C 67-200 (supports béton) : efforts nominaux en tête",
        LIGNE_DU: "NF EN 50160 : 230/400 V ± 10 % au point de livraison",
      },
    },
    iec60364: {
      code: "iec60364", nom: "IEC 60364", libelle: "IEC 60364 (international)", famille: "iec",
      description: "Norme internationale des installations basse tension, base des normes nationales de la plupart des pays à 50 Hz.",
      rho: 0.023, k_adiab: 143, cos_cible: 0.95, du_ligne: 10, climat: "iec_standard", poteau: "beton", conducteur: "torsade_3x70_54",
      refs: { ...REFS_IEC },
    },
    bs7671: {
      code: "bs7671", nom: "BS 7671", libelle: "BS 7671 (Royaume-Uni)", famille: "iec",
      description: "IET Wiring Regulations (18e édition et amendements), appliquées au Royaume-Uni et dans plusieurs pays du Commonwealth.",
      rho: 0.023, k_adiab: 143, cos_cible: 0.95, du_ligne: 6, climat: "iec_standard", poteau: "beton", conducteur: "torsade_3x70_54",
      refs: { ...REFS_IEC,
        PROT: "BS 7671 Reg. 433.1.1 : Ib ≤ In ≤ Iz et I2 ≤ 1,45·Iz",
        IZ: "BS 7671 Appendix 4 : méthodes de référence harmonisées (HD 60364-5-52), valeurs IEC, cuivre 90 °C",
        KT: "BS 7671 Appendix 4 Table 4B1 : correction de température",
        KG: "BS 7671 Appendix 4 Table 4C1 : facteurs de groupement",
        DU: "BS 7671 Appendix 4 §6.4 : 3 % éclairage, 5 % autres (6 / 8 % depuis un poste privé)",
        ADIAB: "BS 7671 Reg. 434.5.2 : S ≥ √(I²t)/k",
        COURBES: "BS EN 60898-1 : disjoncteurs types B (3-5·In), C (5-10·In), D (10-20·In)",
        TCOUP: "BS 7671 Table 41.1 (0,4 s, TN 230 V) ; Table 41.3 : Zs ≤ 0,95·U0/Ia ; RCD 30 mA Reg. 411.3.3",
        PE: "BS 7671 Table 54.7 : S_PE = S_ph (≤ 16 mm²), 16 mm² (≤ 35), S_ph/2 au-delà",
        PV_GEN: "BS 7671 Section 712 ; MCS (installateurs)",
        BATT: "IEEE 1013 / IEEE 1562 (dimensionnement) ; BS EN IEC 62485-2 ; PAS 63100 (batteries dans les logements)",
        GE_CABLE: "BS 7671 Section 551 : groupes générateurs basse tension",
        ATS: "BS EN IEC 60947-6-1 ; BS 7671 Reg. 551.6 (commutation des sources)",
        SECOURS: "BS 7671 Chapter 56 ; BS 5266 (éclairage de sécurité)",
        COMP: "BS EN 60831-1 ; IEC 61921",
        LIGNE_CLIMAT: "BS EN 50341 / spécifications ENA : charges climatiques à saisir",
        LIGNE_DU: "ESQCR 2002 : 230 V +10 % / −6 % au point de livraison",
      },
    },
    nec: {
      code: "nec", nom: "NEC (NFPA 70)", libelle: "NEC / NFPA 70 (États-Unis)", famille: "nec",
      description: "National Electrical Code américain : sections en AWG/kcmil, 125 % des charges continues, réseaux 60 Hz.",
      rho: 0.0210, k_adiab: 115, cos_cible: 0.95, du_ligne: 5, climat: "nesc_moyen", poteau: "bois_ansi", conducteur: "quadruplex_1_0",
      refs: { ...REFS_IEC,
        IB: "I = S/(√3·U) en triphasé ; I = S/U en monophasé ou entre deux phases",
        PROT: "NEC 240.4 : conducteurs protégés selon leur ampacité ; 240.4(B) calibre immédiatement supérieur ≤ 800 A ; 240.4(D) petits conducteurs",
        CONTINU: "NEC 210.19(A)(1), 210.20(A), 215.2, 215.3 : 125 % des charges continues",
        IZ: "NEC Table 310.16 : ampacités cuivre 60/75/90 °C ; bornes 110.14(C)",
        KT: "NEC Table 310.15(B)(1)(1) : correction de température ambiante (base 30 °C)",
        KG: "NEC Table 310.15(C)(1) : ajustement au-delà de 3 conducteurs actifs",
        DU: "NEC 210.19(A) Informational Note No. 4 et 215.2(A)(1) Note 2 : 3 % pour le circuit, 5 % au total",
        DU_DC: "Bonne pratique (pas d'exigence NEC) : ΔU côté continu ≤ 2 à 3 %",
        ADIAB: "ICEA P-32-382 / IEEE 242 : tenue au court-circuit S ≥ I·√t / k (k = 115, isolant thermoplastique)",
        COURBES: "UL 489 : disjoncteurs à temps inverse, déclenchement instantané ≈ 10·In (fiche constructeur)",
        TCOUP: "NEC 250.4(A)(5) : chemin de défaut de faible impédance ; GFCI 210.8 ; AFCI 210.12",
        ICC: "IEEE 551 / ANSI C37 : calcul des courants de court-circuit",
        PE: "NEC Table 250.122 : conducteur de protection (EGC) selon le calibre de la protection",
        PV_GEN: "NEC Art. 690 ; 690.12 (arrêt rapide sur bâtiment) ; UL 61730 (modules)",
        PV_CHAINES: "NEC 690.7 (tension maximale corrigée en température) ; 690.8(A)(1) : Imax = 1,25·Isc",
        PV_FUS: "NEC 690.9 : protection de chaîne ≥ 1,56·Isc et ≤ fusible série maximal du module",
        PV_CABLE: "NEC 690.8(B) et Table 310.17 : PV Wire / USE-2 90 °C à l'air libre",
        BATT: "IEEE 1013 / IEEE 1562 (dimensionnement) ; NEC Art. 706 et 480 ; UL 9540 ; NFPA 855",
        ONDULEUR_NORME: "UL 1741 ; NEC Art. 710 (systèmes autonomes)",
        MOTEUR: "NEC 430.6 et Tables 430.248 / 430.250 (FLC) ; 430.22 (125 %) ; Table 430.52 (disjoncteur ≤ 250 %)",
        GE_CABLE: "NEC 445.13 : conducteurs du groupe ≥ 115 % du courant assigné ; UL 2200",
        ATS: "UL 1008 ; NEC 702.5 (secours facultatif) et 700.5 (secours de sécurité)",
        SECOURS: "NEC Art. 700 / 701 / 702 ; NFPA 110 (Level 1/2, Type 10)",
        TRANSFO: "IEEE C57.12.00 ; NEC 450.3(B) : protection secondaire ≤ 125 % ; %Z usuel 4,5 à 5,75 %",
        COMP: "NEC 460.8(A) : conducteurs ≥ 135 % du courant du condensateur ; IEEE 18",
        HARM: "IEEE 519-2014 : THDv ≤ 8 % au point de raccordement ≤ 1 kV",
        LIGNE_CLIMAT: "NESC (ANSI C2) Rule 250 : zones de charge ; Rule 261 : limites de tension des conducteurs",
        LIGNE_SUPPORT: "ANSI O5.1 : classes des poteaux bois ; NESC Rules 253 et 261 : facteurs de charge et de résistance",
        LIGNE_DU: "ANSI C84.1 Range A : ± 5 % au point de livraison",
      },
    },
  };

  const RESEAUX = {
    "400/230-50": { nom: "400/230 V – 50 Hz, triphasé + neutre", u_ll: 400, u0: 230, f: 50, nph: 3, famille: "iec" },
    "380/220-50": { nom: "380/220 V – 50 Hz, triphasé + neutre", u_ll: 380, u0: 220, f: 50, nph: 3, famille: "iec" },
    "415/240-50": { nom: "415/240 V – 50 Hz, triphasé + neutre", u_ll: 415, u0: 240, f: 50, nph: 3, famille: "iec" },
    "230-50": { nom: "230 V – 50 Hz, monophasé", u_ll: 230, u0: 230, f: 50, nph: 1, famille: "iec" },
    "240/120-60": { nom: "120/240 V – 60 Hz, monophasé à point milieu", u_ll: 240, u0: 120, f: 60, nph: 2, famille: "nec" },
    "208/120-60": { nom: "208Y/120 V – 60 Hz, triphasé + neutre", u_ll: 208, u0: 120, f: 60, nph: 3, famille: "nec" },
    "480/277-60": { nom: "480Y/277 V – 60 Hz, triphasé + neutre", u_ll: 480, u0: 277, f: 60, nph: 3, famille: "nec" },
  };

  const SYSTEMES = {
    hybride: "Hybride : solaire + batteries + groupe d'appoint",
    solaire: "Solaire autonome : solaire + batteries",
    groupe: "Groupe électrogène seul",
    reseau: "Réseau public, groupe de secours facultatif",
  };

  // Référentiel et réseau actifs, fixés au début de chaque calcul (moteur synchrone).
  let REF = REFERENTIELS.nfc15100;
  let RES = RESEAUX["400/230-50"];
  let R = { ...REFS_COMMUNES, ...REF.refs };

  // ===========================================================================
  // 1. Tables embarquées (valeurs usuelles — à vérifier contre les éditions en vigueur)
  // ===========================================================================

  const SQRT3 = Math.sqrt(3);
  const SECTIONS_MM2 = [1.5, 2.5, 4, 6, 10, 16, 25, 35, 50, 70, 95, 120, 150, 185, 240, 300];
  // IEC 60364-5-52, cuivre PR (XLPE) 90 °C, 30 °C : méthodes E (chemin perforé), C (paroi), B1 (conduit)
  const IZ_IEC = {
    E: { 3: [23, 31, 42, 54, 75, 100, 127, 158, 192, 246, 298, 346, 399, 456, 538, 621],
      2: [26, 36, 49, 63, 86, 115, 149, 185, 225, 289, 352, 410, 473, 542, 641, 741] },
    C: { 3: [22, 30, 40, 52, 71, 96, 119, 147, 179, 229, 278, 322, 371, 424, 500, 576],
      2: [24, 33, 45, 58, 80, 107, 138, 171, 209, 269, 328, 382, 441, 506, 599, 693] },
    B1: { 3: [20, 28, 37, 48, 66, 88, 117, 144, 175, 222, 269, 312],
      2: [23, 31, 42, 54, 75, 100, 133, 164, 198, 253, 306, 354] },
  };
  const METHODES_POSE = {
    E: { nom: "E : chemin de câbles perforé", groupement: "couche_chemin_perfore" },
    C: { nom: "C : fixé sur paroi", groupement: "couche_paroi" },
    B1: { nom: "B1 : sous conduit ou goulotte", groupement: "faisceau" },
  };
  const SECTIONS_PV = [1.5, 2.5, 4, 6, 10, 16, 25, 35];
  const IZ_PV = [30, 41, 55, 70, 98, 132, 176, 218];
  const FACTEURS_GROUPEMENT = {
    faisceau: [[1, 1.0], [2, 0.8], [3, 0.7], [4, 0.65], [5, 0.6], [6, 0.57], [7, 0.54], [8, 0.52], [9, 0.5],
      [12, 0.45], [16, 0.41], [20, 0.38]],
    couche_paroi: [[1, 1.0], [2, 0.85], [3, 0.79], [4, 0.75], [5, 0.73], [6, 0.72], [7, 0.72], [8, 0.71], [9, 0.7]],
    couche_chemin_perfore: [[1, 1.0], [2, 0.88], [3, 0.82], [4, 0.77], [5, 0.75], [6, 0.73], [7, 0.73], [8, 0.72], [9, 0.72]],
  };

  // NEC : calibres AWG/kcmil, sections (mm²), Table 310.16 (cuivre) et 310.17 (air libre, 90 °C)
  const AWG = ["14", "12", "10", "8", "6", "4", "3", "2", "1", "1/0", "2/0", "3/0", "4/0", "250", "300", "350", "400", "500",
    "600", "700", "750", "800", "900", "1000"];
  const AWG_MM2 = [2.08, 3.31, 5.26, 8.37, 13.3, 21.2, 26.7, 33.6, 42.4, 53.5, 67.4, 85.0, 107, 127, 152, 177, 203, 253,
    304, 355, 380, 405, 456, 507];
  const NEC_310_16 = {
    60: [15, 20, 30, 40, 55, 70, 85, 95, 110, 125, 145, 165, 195, 215, 240, 260, 280, 320, 350, 385, 400, 410, 435, 455],
    75: [20, 25, 35, 50, 65, 85, 100, 115, 130, 150, 175, 200, 230, 255, 285, 310, 335, 380, 420, 460, 475, 490, 520, 545],
    90: [25, 30, 40, 55, 75, 95, 115, 130, 145, 170, 195, 225, 260, 290, 320, 350, 380, 430, 475, 520, 535, 555, 585, 615],
  };
  const NEC_310_17_90 = [35, 40, 55, 80, 105, 140, 165, 190, 220, 260, 300, 350, 405];
  const NEC_250_122 = [[15, "14"], [20, "12"], [60, "10"], [100, "8"], [200, "6"], [300, "4"], [400, "3"], [500, "2"], [600, "1"],
    [800, "1/0"], [1000, "2/0"], [1200, "3/0"], [1600, "4/0"], [2000, "250"], [2500, "350"], [3000, "400"], [4000, "500"],
    [5000, "700"], [6000, "800"]];
  const NEC_FLC_TRI = {
    hp: [0.5, 0.75, 1, 1.5, 2, 3, 5, 7.5, 10, 15, 20, 25, 30, 40, 50, 60, 75, 100, 125, 150, 200],
    208: [2.4, 3.5, 4.6, 6.6, 7.5, 10.6, 16.7, 24.2, 30.8, 46.2, 59.4, 74.8, 88, 114, 143, 169, 211, 273, 343, 396, 528],
    230: [2.2, 3.2, 4.2, 6.0, 6.8, 9.6, 15.2, 22, 28, 42, 54, 68, 80, 104, 130, 154, 192, 248, 312, 360, 480],
    460: [1.1, 1.6, 2.1, 3.0, 3.4, 4.8, 7.6, 11, 14, 21, 27, 34, 40, 52, 65, 77, 96, 124, 156, 180, 240],
  };
  const NEC_FLC_MONO = {
    hp: [1 / 6, 0.25, 1 / 3, 0.5, 0.75, 1, 1.5, 2, 3, 5, 7.5, 10],
    115: [4.4, 5.8, 7.2, 9.8, 13.8, 16, 20, 24, 34, 56, 80, 100],
    230: [2.2, 2.9, 3.6, 4.9, 6.9, 8, 10, 12, 17, 28, 40, 50],
  };

  const RHO_CU_CC_MIN = 0.028;
  const LAMBDA_X = 0.08e-3;

  const CALIBRES_IEC = [6, 10, 16, 20, 25, 32, 40, 50, 63, 80, 100, 125, 160, 200, 250, 320, 400, 500, 630, 800, 1000, 1250,
    1600, 2000, 2500, 3200, 4000];
  const CALIBRES_NEC = [15, 20, 25, 30, 35, 40, 45, 50, 60, 70, 80, 90, 100, 110, 125, 150, 175, 200, 225, 250, 300, 350, 400,
    450, 500, 600, 700, 800, 1000, 1200, 1600, 2000, 2500, 3000, 4000, 5000, 6000];
  const CALIBRES_FUSIBLES_DC = [63, 80, 100, 125, 160, 200, 250, 315, 355, 400, 500, 630, 800, 1000, 1250];
  const CALIBRES_GPV = [10, 12, 15, 16, 20, 25, 30, 32];
  const CALIBRES_INVERSEURS = [40, 63, 80, 100, 125, 160, 250, 400, 630, 800, 1000, 1250, 1600, 2000, 2500, 3200, 4000];
  const MAGNETIQUE_MAX = { B: 5, C: 10, D: 20 };
  const MAGNETIQUE_MIN = { B: 3, C: 5, D: 10 };
  const SEUIL_INSTANTANE_NEC = 10;

  const GAMME_GE_KVA = [9, 13, 16, 20, 22, 27, 33, 40, 45, 50, 60, 66, 80, 100, 110, 135, 150, 165, 200, 220,
    250, 275, 330, 400, 450, 500, 550, 630, 700, 800, 900, 1000, 1100, 1250, 1400, 1650, 2000, 2250, 2500];
  const TRANSFOS = {
    iec: [100, 160, 250, 400, 630, 800, 1000, 1250, 1600, 2000, 2500],
    nec: [75, 112.5, 150, 225, 300, 500, 750, 1000, 1500, 2000, 2500, 3000],
    mono: [25, 37.5, 50, 75, 100, 167, 250],
  };
  const GRADINS_KVAR = [2.5, 5, 7.5, 10, 12.5, 15, 20, 25, 30, 40, 50, 60, 75, 100];

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
      ref: REFS_COMMUNES.BATT_VIEIL,
    },
  };

  // Conducteurs aériens : torsadés NF C 33-209 et quadruplex nord-américains (valeurs indicatives de catalogue, à remplacer par la fiche du câble)
  const CONDUCTEURS_AERIENS = {
    torsade_3x35_54: { nom: "Torsadé alu 3×35 + 54,6 mm² (NF C 33-209)", s_phase: 35, s_porteur: 54.6, rts_n: 16600, masse_kg_m: 0.6, diametre_mm: 26, e_mpa: 62000, alpha: 23e-6, r20_phase: 0.868, r20_neutre: 0.6, x_km: 0.1, iz_a: 125 },
    torsade_3x50_54: { nom: "Torsadé alu 3×50 + 54,6 mm² (NF C 33-209)", s_phase: 50, s_porteur: 54.6, rts_n: 16600, masse_kg_m: 0.73, diametre_mm: 28, e_mpa: 62000, alpha: 23e-6, r20_phase: 0.641, r20_neutre: 0.6, x_km: 0.1, iz_a: 150 },
    torsade_3x70_54: { nom: "Torsadé alu 3×70 + 54,6 mm² (NF C 33-209)", s_phase: 70, s_porteur: 54.6, rts_n: 16600, masse_kg_m: 0.93, diametre_mm: 32, e_mpa: 62000, alpha: 23e-6, r20_phase: 0.443, r20_neutre: 0.6, x_km: 0.1, iz_a: 190 },
    torsade_3x95_54: { nom: "Torsadé alu 3×95 + 54,6 mm² (NF C 33-209)", s_phase: 95, s_porteur: 54.6, rts_n: 16600, masse_kg_m: 1.17, diametre_mm: 36, e_mpa: 62000, alpha: 23e-6, r20_phase: 0.32, r20_neutre: 0.6, x_km: 0.1, iz_a: 230 },
    torsade_3x150_70: { nom: "Torsadé alu 3×150 + 70 mm² (NF C 33-209)", s_phase: 150, s_porteur: 70, rts_n: 20500, masse_kg_m: 1.73, diametre_mm: 43, e_mpa: 62000, alpha: 23e-6, r20_phase: 0.206, r20_neutre: 0.47, x_km: 0.1, iz_a: 305 },
    quadruplex_1_0: { nom: "Quadruplex alu 3 × 1/0 AWG + neutre porteur 1/0 ACSR", s_phase: 53.5, s_porteur: 62.4, rts_n: 19500, masse_kg_m: 0.74, diametre_mm: 25, e_mpa: 79000, alpha: 19.1e-6, r20_phase: 0.535, r20_neutre: 0.535, x_km: 0.1, iz_a: 205 },
    quadruplex_4_0: { nom: "Quadruplex alu 3 × 4/0 AWG + neutre porteur 4/0 ACSR", s_phase: 107, s_porteur: 125, rts_n: 37100, masse_kg_m: 1.34, diametre_mm: 35, e_mpa: 79000, alpha: 19.1e-6, r20_phase: 0.268, r20_neutre: 0.268, x_km: 0.1, iz_a: 315 },
  };
  const CLIMATS = {
    nf_vent_normal: { nom: "France, zone de vent normal (valeurs usuelles à vérifier)", cs_charge: 3, eds_max: 0.15, facteur_support: 1,
      etats: [{ id: "A", nom: "Hypothèse A : +15 °C, vent 480 Pa", t: 15, vent: 480, givre: 0, k: 0 },
        { id: "B", nom: "Hypothèse B : −10 °C, vent 180 Pa", t: -10, vent: 180, givre: 0, k: 0 }], t_eds: 15, t_chaud: 40 },
    iec_standard: { nom: "Paramètres usuels IEC (à adapter au site)", cs_charge: 3, eds_max: 0.15, facteur_support: 1,
      etats: [{ id: "V", nom: "Vent maximal : +15 °C, vent 500 Pa", t: 15, vent: 500, givre: 0, k: 0 },
        { id: "F", nom: "Froid : −5 °C, vent 200 Pa", t: -5, vent: 200, givre: 0, k: 0 }], t_eds: 15, t_chaud: 40 },
    nesc_lourd: { nom: "NESC, zone de charge lourde (Heavy)", cs_charge: 1 / 0.6, eds_max: 0.25, facteur_support: 2,
      etats: [{ id: "NESC", nom: "NESC Heavy : −17,8 °C, givre 12,7 mm, vent 190 Pa, K = 4,38 N/m", t: -17.8, vent: 191.5, givre: 12.7, k: 4.38 }], t_eds: 15.6, t_chaud: 50 },
    nesc_moyen: { nom: "NESC, zone de charge moyenne (Medium)", cs_charge: 1 / 0.6, eds_max: 0.25, facteur_support: 2,
      etats: [{ id: "NESC", nom: "NESC Medium : −9,4 °C, givre 6,35 mm, vent 190 Pa, K = 2,92 N/m", t: -9.4, vent: 191.5, givre: 6.35, k: 2.92 }], t_eds: 15.6, t_chaud: 50 },
    nesc_leger: { nom: "NESC, zone de charge légère (Light)", cs_charge: 1 / 0.6, eds_max: 0.25, facteur_support: 2,
      etats: [{ id: "NESC", nom: "NESC Light : −1,1 °C, vent 430 Pa, K = 0,73 N/m", t: -1.1, vent: 430.9, givre: 0, k: 0.73 }], t_eds: 15.6, t_chaud: 50 },
  };
  const POTEAUX = {
    beton: { nom: "Béton armé (efforts nominaux NF C 67-200, indicatifs)", classes: [150, 250, 400, 650, 800, 1000, 1250, 1600].map((e) => [`${e} daN`, e]) },
    bois_ansi: { nom: "Bois, classes ANSI O5.1 (charge de rupture à 0,6 m du sommet)",
      classes: [["classe 7", 534], ["classe 6", 667], ["classe 5", 845], ["classe 4", 1068], ["classe 3", 1334], ["classe 2", 1646], ["classe 1", 2002]] },
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
    methode_pose: "E", conducteurs_par_conduit: 3, bornes_75c: 1,
    chute_max_eclairage: null, chute_max_autres: null, chute_max_dc: 1, chute_max_pv: 1.5,
    variabilite_journaliere: 0.3, autocorrelation_journaliere: 0.4, kt_ciel_clair: 0.75, graine_meteo: 2026,
    jours_stress: 4, facteur_meteo_stress: 0.25, objectif_llp: 0.01,
    cos_phi_cible: null,
  };
  const SOURCE = {
    type: "public", s_transfo_kva: null, uk_pct: null, s_kq_mva: 500, icc_livraison_ka: 10, icc_min_ka: 1.5,
    longueur_m: 15, secours: true, part_secourue: 1, autonomie_h: 8,
  };
  const LIGNE = {
    actif: false, conducteur: null, personnalise: null, climat: null, cs_charge: null, eds_max: null,
    poteau: null, hauteur_poteau_m: 9, vent_support: true, diametre_poteau_m: 0.25, facteur_support: null,
    garde_min_m: 6, cos_phi: 0.9, ks: 0.8, protection_a: null, protection_type: "fusible", icc_min_ka: null,
    portees: [
      { longueur_m: 40, angle_deg: 0, charge_kva: 6 }, { longueur_m: 42, angle_deg: 0, charge_kva: 6 },
      { longueur_m: 38, angle_deg: 25, charge_kva: 9 }, { longueur_m: 40, angle_deg: 0, charge_kva: 6 },
      { longueur_m: 45, angle_deg: 0, charge_kva: 6 }, { longueur_m: 35, angle_deg: 0, charge_kva: 9 },
    ],
  };
  const CIRCUIT = { nom: "Circuit", triphase: false, longueur_m: 30, ks: 1, eclairage: false, courbe: null, calibre_min: 10, section_min: 1.5 };
  const RECEPTEUR = { nom: "Récepteur", quantite: 1, puissance_w: 100, cos_phi: 0.9, rendement: 1, ku: 1, plages: [], moteur: false,
    demarrage: "direct", non_lineaire: false };

  // ===========================================================================
  // 3. Note de calcul
  // ===========================================================================

  class Note {
    constructor() { this.lignes = []; this.verifications = []; this.references = []; }
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
      this.verifications.push({ statut: condition ? "OK" : statutKo, rubrique, message: condition ? msgOk : msgKo, ref, n: this._ref(ref) });
      return condition;
    }
    info(rubrique, message, ref = "") { this.verifications.push({ statut: "INFO", rubrique, message, ref, n: this._ref(ref) }); }
  }

  // ===========================================================================
  // 4. Outils
  // ===========================================================================

  const rad = (d) => (d * Math.PI) / 180;
  const deg = (r) => (r * 180) / Math.PI;
  const somme = (t) => t.reduce((a, b) => a + b, 0);
  const borne = (x) => Math.max(-1, Math.min(1, x));
  const arrondi = (x, n = 0) => Math.round(x * 10 ** n) / 10 ** n;
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
  function fr(x, d = 1) { return Number(x).toLocaleString("fr-FR", { maximumFractionDigits: d, minimumFractionDigits: 0 }); }
  function pct(x, d = 0) { return `${fr(x * 100, d)} %`; }
  const calibres = () => (REF.famille === "nec" ? CALIBRES_NEC : CALIBRES_IEC);
  const nec = () => REF.famille === "nec";

  function kTemperature(tAmb, tAmeMax = 90, tRef = 30) {
    if (tAmb >= tAmeMax) return 0;
    return Math.sqrt((tAmeMax - tAmb) / (tAmeMax - tRef));
  }
  /** NEC Table 310.15(B)(1)(1) : facteur de la tranche de 5 °C contenant la température (base 30 °C). */
  function kTemperatureNEC(tAmb, tAme = 90) {
    const haut = tAmb <= 10 ? 10 : 5 * Math.ceil(tAmb / 5);
    if (haut >= tAme) return 0;
    return arrondi(Math.sqrt((tAme - haut) / (tAme - 30)), 2);
  }
  /** NEC Table 310.15(C)(1) : ajustement selon le nombre de conducteurs actifs. */
  function ajustementNEC(n) {
    if (n <= 3) return 1;
    if (n <= 6) return 0.8;
    if (n <= 9) return 0.7;
    if (n <= 20) return 0.5;
    if (n <= 30) return 0.45;
    if (n <= 40) return 0.4;
    return 0.35;
  }
  function facteurGroupement(n, disposition) {
    const table = FACTEURS_GROUPEMENT[disposition] || FACTEURS_GROUPEMENT.couche_chemin_perfore;
    for (const [cle, f] of table) if (n <= cle) return f;
    return table[table.length - 1][1];
  }
  /** Chute de tension (%) : triphasé b = 1 rapporté à U0 ; monophasé b = 2 rapporté à U0 ; deux phases b = 2 rapporté à U. */
  function chuteTensionAC(iB, longueur, section, cosPhi, poly, rho = REF.rho) {
    const entrePhases = poly && RES.nph === 2;
    const b = poly && RES.nph === 3 ? 1 : 2;
    const uRef = entrePhases ? RES.u_ll : RES.u0;
    const sinPhi = Math.sqrt(Math.max(0, 1 - cosPhi ** 2));
    const lambda = (LAMBDA_X * RES.f) / 50;
    const duV = b * (rho * longueur / section * cosPhi + lambda * longueur * sinPhi) * iB;
    return (100 * duV) / uRef;
  }
  function chuteTensionDC(i, longueur, section, u, rho = REF.rho) { return (100 * 2 * rho * longueur * i) / section / u; }
  /** Courant d'une puissance apparente selon le réseau : poly = triphasé (ou entre deux phases en 120/240 V). */
  function courantCircuit(sVa, poly) {
    if (!poly || RES.nph === 1) return sVa / RES.u0;
    return RES.nph === 3 ? sVa / (SQRT3 * RES.u_ll) : sVa / RES.u_ll;
  }
  const courantSource = (sVa) => courantCircuit(sVa, RES.nph >= 2);
  function iccMinFinLigne(iccSource, troncons) {
    let z = RES.u0 / iccSource;
    for (const [longueur, section, n = 1] of troncons) z += (RHO_CU_CC_MIN * 2 * longueur) / (section * n);
    return (0.95 * RES.u0) / z;
  }
  function libelleSection(dim) {
    if (!dim) return "—";
    const n = dim.conducteurs_paralleles > 1 ? `${dim.conducteurs_paralleles} × ` : "";
    return `${n}${dim.section_label}`;
  }

  /**
   * Section de câble selon le référentiel actif.
   * IEC/NF/BS : plus petite section satisfaisant Iz·k ≥ I requis, ΔU et contrainte thermique.
   * NEC : ampacité min(90 °C × corrections ; colonne des bornes) ≥ courant continu ×1,25 et protégée par la protection
   * (240.4, calibre supérieur admis ≤ 800 A, petits conducteurs 240.4(D)).
   * `chute(s, n)` : chute cumulée (%) avec n conducteurs en parallèle de section s (mm²).
   */
  function dimensionnerCable(o) {
    return o.famille === "nec" || (o.famille === undefined && nec()) ? dimensionnerNEC(o) : dimensionnerIEC(o);
  }
  function dimensionnerIEC({ iRequis, chute, chuteMax, chuteBranche, chuteBrancheMax, kCorrection, tableIz, sections = SECTIONS_MM2,
    contrainteARacS = 0, kThermique = REF.k_adiab, sMin = 1.5, nMax = 8 }) {
    const sThMin = contrainteARacS / kThermique;
    for (let n = 1; n <= nMax; n++) {
      const trouves = [];
      const a = (c) => trouves.some((t) => t[0] === c);
      for (let k = 0; k < Math.min(sections.length, tableIz.length); k++) {
        const s = sections[k];
        if (s < sMin) continue;
        if (!a("courant admissible") && tableIz[k] * kCorrection * n >= iRequis) trouves.push(["courant admissible", s]);
        if (!a("chute de tension") && chute(s, n) <= chuteMax && (!chuteBranche || chuteBranche(s, n) <= chuteBrancheMax)) trouves.push(["chute de tension", s]);
        if (!a("contrainte thermique") && s * n >= sThMin) trouves.push(["contrainte thermique", s]);
      }
      if (trouves.length < 3) continue;
      let choix = trouves[0];
      for (const t of trouves.slice(1)) {
        if (t[1] > choix[1] || (t[1] === choix[1] && t[0] === "courant admissible" && choix[0] !== "courant admissible")) choix = t;
      }
      const s = choix[1];
      const idx = sections.indexOf(s);
      return {
        section_mm2: s, section_label: `${String(s).replace(".", ",")} mm²`, conducteurs_paralleles: n,
        iz_corrige_a: arrondi(tableIz[idx] * kCorrection * n, 1),
        chute_cumulee_pct: arrondi(chute(s, n), 2), section_thermique_min_mm2: arrondi(sThMin, 2),
        critere_dimensionnant: choix[0],
      };
    }
    return null;
  }
  function dimensionnerNEC({ iRequis, inProt = 0, chute, chuteMax, chuteBranche, chuteBrancheMax, kCorrection = 1, table = "310.16",
    iSansCorrection = 0, regle2404D = false, moteur = false, contrainteARacS = 0, kThermique = REF.k_adiab, nMax = 8, indexMin = 0 }) {
    const sThMin = contrainteARacS / kThermique;
    const t90 = table === "310.17" ? NEC_310_17_90 : NEC_310_16[90];
    const tBornes = table === "310.17" ? null : NEC_310_16[REF_HYP.bornes_75c ? 75 : 60];
    const limite2404D = { 0: 15, 1: 20, 2: 30 };
    for (let n = 1; n <= nMax; n++) {
      let critere = null;
      for (let k = indexMin; k < t90.length; k++) {
        const s = AWG_MM2[k];
        const ampacite = Math.min(t90[k] * kCorrection, tBornes ? tBornes[k] : Infinity) * n;
        const okCourant = ampacite >= iRequis && t90[k] * n >= iSansCorrection;
        const protege = moteur || !inProt || ampacite >= inProt || (inProt <= 800 && calibreSuperieur(ampacite, CALIBRES_NEC) >= inProt);
        const ok2404D = !regle2404D || n > 1 || !(k in limite2404D) || inProt <= limite2404D[k];
        const okChute = chute(s, n) <= chuteMax && (!chuteBranche || chuteBranche(s, n) <= chuteBrancheMax);
        const okTh = s * n >= sThMin;
        if (okCourant && protege && ok2404D && okChute && okTh) {
          if (!critere) critere = "courant admissible";
          return {
            section_mm2: s, section_label: `${AWG[k]}${k >= 13 ? " kcmil" : " AWG"}`, conducteurs_paralleles: n,
            iz_corrige_a: arrondi(ampacite, 1), chute_cumulee_pct: arrondi(chute(s, n), 2), section_thermique_min_mm2: arrondi(sThMin, 2),
            critere_dimensionnant: critere,
          };
        }
        critere = !okChute ? "chute de tension" : !ok2404D ? "petits conducteurs 240.4(D)" : !okTh ? "contrainte thermique"
          : !protege ? "protection 240.4" : "courant admissible";
      }
    }
    return null;
  }
  function conducteurProtection(dim, inProt) {
    if (!dim) return "—";
    if (nec()) {
      const egc = NEC_250_122.find(([a]) => inProt <= a);
      return egc ? `${egc[1]}${["250", "350", "400", "500", "700", "800"].includes(egc[1]) ? " kcmil" : " AWG"}` : "étude";
    }
    const s = dim.section_mm2;
    const pe = s <= 16 ? s : s <= 35 ? 16 : SECTIONS_MM2.find((x) => x >= s / 2) || s / 2;
    return `${dim.conducteurs_paralleles > 1 ? `${dim.conducteurs_paralleles} × ` : ""}${String(pe).replace(".", ",")} mm²`;
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
    return { uniforme, gauss() { const u1 = uniforme(); const u2 = uniforme(); return Math.sqrt(-2 * Math.log(1 - u1)) * Math.cos(2 * Math.PI * u2); } };
  }

  // ===========================================================================
  // 5. Préparation et validation du projet
  // ===========================================================================

  let REF_HYP = HYPOTHESES; // hypothèses actives (lues par dimensionnerNEC)

  function nombre(v, defaut) {
    const x = typeof v === "string" ? Number(v.replace(",", ".")) : Number(v);
    return v === null || v === undefined || v === "" || !Number.isFinite(x) ? defaut : x;
  }
  function fusionNombres(base, valeurs, textes = []) {
    const res = { ...base };
    for (const [k, v] of Object.entries(valeurs || {})) {
      if (!(k in base)) continue;
      if (textes.includes(k)) res[k] = v === null || v === undefined ? base[k] : String(v);
      else if (base[k] === null) res[k] = v === null || v === "" || v === undefined ? null : nombre(v, null);
      else if (typeof base[k] === "boolean") res[k] = Boolean(v);
      else res[k] = nombre(v, base[k]);
    }
    return res;
  }

  function normaliser(brut) {
    const p = brut || {};
    const referentiel = REFERENTIELS[p.referentiel] ? p.referentiel : "nfc15100";
    const ref = REFERENTIELS[referentiel];
    let reseau = RESEAUX[p.reseau] ? p.reseau : ref.famille === "nec" ? "208/120-60" : "400/230-50";
    const hypBrutes = { ...(p.hypotheses || {}) };
    if (hypBrutes.disposition_circuits && !hypBrutes.methode_pose) {
      hypBrutes.methode_pose = { couche_paroi: "C", faisceau: "B1" }[hypBrutes.disposition_circuits] || "E";
    }
    const hyp = fusionNombres(HYPOTHESES, hypBrutes, ["chimie", "methode_pose"]);
    if (!METHODES_POSE[hyp.methode_pose]) hyp.methode_pose = "E";
    const site = { ...SITE };
    for (const [k, v] of Object.entries(p.site || {})) {
      if (k === "ghi_mensuel") site.ghi_mensuel = Array.isArray(v) && v.length === 12 ? v.map((x) => nombre(x, NaN)) : null;
      else if (k in SITE) site[k] = nombre(v, SITE[k]);
    }
    const module = fusionNombres(MODULE_PV, p.module, ["nom"]);
    const mppt = fusionNombres(REGULATEUR, p.mppt, ["nom"]);
    const source = fusionNombres(SOURCE, p.source, ["type"]);
    if (!["public", "transfo"].includes(source.type)) source.type = "public";
    const lb = p.ligne || {};
    const ligne = fusionNombres(LIGNE, lb, ["conducteur", "climat", "poteau", "protection_type"]);
    ligne.actif = Boolean(lb.actif);
    ligne.vent_support = lb.vent_support === undefined ? LIGNE.vent_support : Boolean(lb.vent_support);
    ligne.portees = (Array.isArray(lb.portees) ? lb.portees : LIGNE.portees).map((x) => ({
      longueur_m: nombre(x.longueur_m, 40), angle_deg: nombre(x.angle_deg, 0), charge_kva: nombre(x.charge_kva, 0) }));
    ligne.personnalise = lb.personnalise && typeof lb.personnalise === "object" ? { ...CONDUCTEURS_AERIENS.torsade_3x70_54, nom: "Conducteur personnalisé", ...lb.personnalise } : null;
    if (ligne.conducteur !== null && !CONDUCTEURS_AERIENS[ligne.conducteur] && ligne.conducteur !== "personnalise") ligne.conducteur = null;
    if (ligne.climat !== null && !CLIMATS[ligne.climat]) ligne.climat = null;
    if (ligne.poteau !== null && !POTEAUX[ligne.poteau]) ligne.poteau = null;
    if (!["fusible", "disjoncteur"].includes(ligne.protection_type)) ligne.protection_type = "fusible";
    const circuits = (p.circuits || []).map((c, i) => ({
      ...CIRCUIT, nom: String(c.nom || `C${i + 1}`), triphase: Boolean(c.triphase), longueur_m: nombre(c.longueur_m, CIRCUIT.longueur_m),
      ks: nombre(c.ks, CIRCUIT.ks), eclairage: Boolean(c.eclairage), courbe: ["B", "C", "D"].includes(c.courbe) ? c.courbe : null,
      calibre_min: nombre(c.calibre_min, CIRCUIT.calibre_min), section_min: nombre(c.section_min, CIRCUIT.section_min),
      recepteurs: (c.recepteurs || []).map((r) => ({
        ...RECEPTEUR, nom: String(r.nom || "Récepteur"), quantite: nombre(r.quantite, 1), puissance_w: nombre(r.puissance_w, 0),
        cos_phi: nombre(r.cos_phi, RECEPTEUR.cos_phi), rendement: nombre(r.rendement, 1), ku: nombre(r.ku, 1),
        plages: (r.plages || []).map((pl) => [nombre(pl[0], 0), nombre(pl[1], 0), nombre(pl[2], 1)]),
        moteur: Boolean(r.moteur), demarrage: MODES_DEMARRAGE[r.demarrage] ? r.demarrage : "direct", non_lineaire: Boolean(r.non_lineaire),
      })),
    }));
    return { nom: String(p.nom || "Projet sans nom"), systeme: SYSTEMES[p.systeme] ? p.systeme : "hybride", referentiel, reseau,
      site, circuits, module, mppt, hyp, source, ligne };
  }

  function valider(brut) {
    const p = normaliser(brut);
    const e = [];
    const s = p.site;
    const ref = REFERENTIELS[p.referentiel];
    const res = RESEAUX[p.reseau];
    if (res.famille !== ref.famille) {
      e.push(ref.famille === "nec" ? "Le NEC s'applique aux réseaux 60 Hz nord-américains : choisissez 120/240 V, 208Y/120 V ou 480Y/277 V."
        : `${ref.nom} s'applique aux réseaux 50 Hz : choisissez 400/230 V, 380/220 V, 415/240 V ou 230 V monophasé.`);
    }
    if (!(s.latitude >= -66 && s.latitude <= 66)) e.push("La latitude doit être comprise entre −66° et 66°.");
    if (!(s.longitude >= -180 && s.longitude <= 180)) e.push("La longitude doit être comprise entre −180° et 180°.");
    if (!(s.altitude_m >= 0 && s.altitude_m <= 5000)) e.push("L'altitude doit être comprise entre 0 et 5000 m.");
    if (!(s.t_amb_min < s.t_amb_max)) e.push("La température minimale doit être inférieure à la température maximale.");
    if (s.ghi_mensuel && !s.ghi_mensuel.every((g) => g > 0 && g < 12)) e.push("Les 12 irradiations mensuelles doivent être comprises entre 0 et 12 kWh/m²/j.");
    if (!CHIMIES[p.hyp.chimie]) e.push("Technologie de batterie inconnue (lifepo4 ou plomb).");
    if (!(p.hyp.jours_autonomie > 0 && p.hyp.jours_autonomie <= 10)) e.push("Les jours d'autonomie doivent être entre 0,1 et 10.");
    if (p.hyp.cos_phi_cible !== null && !(p.hyp.cos_phi_cible > 0.7 && p.hyp.cos_phi_cible <= 1)) e.push("Le cos φ visé doit être entre 0,7 et 1.");
    if (!p.circuits.length) e.push("Ajoutez au moins un circuit avec ses récepteurs.");
    p.circuits.forEach((c) => {
      if (!c.recepteurs.length) e.push(`${c.nom} : ajoutez au moins un récepteur.`);
      if (c.triphase && res.nph === 1) e.push(`${c.nom} : le réseau est monophasé, ce circuit ne peut pas être triphasé.`);
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
          if (!(d >= 0 && d <= 24 && f >= 0 && f <= 24 && Number.isInteger(d) && Number.isInteger(f))) e.push(`${nom} : les heures des plages vont de 0 à 24 (heures entières).`);
          if (!(t >= 0 && t <= 1)) e.push(`${nom} : le taux de marche d'une plage est entre 0 et 1.`);
        });
      });
    });
    if (p.systeme === "reseau") {
      if (!(p.source.icc_livraison_ka > 0 && p.source.icc_min_ka > 0)) e.push("Source réseau : indiquez des courants de court-circuit positifs.");
      if (!(p.source.part_secourue > 0 && p.source.part_secourue <= 1)) e.push("Source réseau : la part secourue est entre 1 et 100 %.");
    }
    if (p.ligne.actif) {
      if (!p.ligne.portees.length) e.push("Ligne aérienne : ajoutez au moins une portée.");
      p.ligne.portees.forEach((x, i) => {
        if (!(x.longueur_m >= 5 && x.longueur_m <= 150)) e.push(`Ligne aérienne, portée ${i + 1} : longueur entre 5 et 150 m.`);
        if (!(x.angle_deg >= 0 && x.angle_deg <= 90)) e.push(`Ligne aérienne, portée ${i + 1} : angle entre 0 et 90°.`);
        if (!(x.charge_kva >= 0)) e.push(`Ligne aérienne, portée ${i + 1} : charge positive ou nulle.`);
      });
      if (!(p.ligne.hauteur_poteau_m >= 6 && p.ligne.hauteur_poteau_m <= 20)) e.push("Ligne aérienne : hauteur de poteau entre 6 et 20 m.");
    }
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
  function courantNominalMoteur(r, poly) { return courantCircuit(r.puissance_w / (r.rendement * r.cos_phi), poly); }
  /** NEC 430.6(A)(1) : courant de pleine charge (FLC) des Tables 430.248 / 430.250, sinon calcul. */
  function flcNEC(r, poly) {
    const hp = r.puissance_w / 745.7;
    const table = poly && RES.nph === 3 ? NEC_FLC_TRI : NEC_FLC_MONO;
    const tension = poly && RES.nph === 3 ? (RES.u_ll >= 440 ? 460 : RES.u_ll >= 220 ? 230 : 208) : (poly ? 230 : RES.u0 <= 130 ? 115 : null);
    const idx = table.hp.findIndex((h) => h >= hp * 0.98);
    if (tension === null || idx < 0 || !table[tension]) return courantNominalMoteur(r, poly);
    return table[tension][idx];
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
    const nph = RES.nph;
    const lignes = circuits.map((c) => {
      const pInst = somme(c.recepteurs.map((r) => puissancesRecepteur(r)[0]));
      const p = c.ks * somme(c.recepteurs.map((r) => puissancesRecepteur(r)[1]));
      const q = c.ks * somme(c.recepteurs.map((r) => puissancesRecepteur(r)[2]));
      const s = Math.hypot(p, q);
      const iB = courantCircuit(s, c.triphase);
      let profP = new Array(24).fill(0);
      let profQ = new Array(24).fill(0);
      for (const r of c.recepteurs) {
        const [pp, pq] = profilRecepteur(r);
        profP = profP.map((a, h) => a + pp[h]);
        profQ = profQ.map((a, h) => a + pq[h]);
      }
      const sNonLin = c.ks * somme(c.recepteurs.filter((r) => r.non_lineaire).map((r) => puissancesRecepteur(r)[1] / r.cos_phi));
      return { circuit: c, p_inst_w: pInst, p_w: p, q_var: q, s_va: s, i_b_a: iB, cos_phi: s ? p / s : 1,
        energie_wh_j: somme(profP), profil_p: profP, profil_q: profQ, phase: null, s_non_lineaire_va: sNonLin };
    });
    const chargePhase = new Array(nph).fill(0);
    lignes.filter((l) => !l.circuit.triphase).sort((a, b) => b.s_va - a.s_va).forEach((l) => {
      const ph = argmin(nph, (k) => chargePhase[k]);
      l.phase = ph;
      chargePhase[ph] += l.s_va;
    });
    const n = circuits.length;
    const ksT = ksTableau(n);
    note.ajouter(rub, "Référentiel et réseau", `${REF.nom} — ${RES.nom}`, "", "");
    note.ajouter(rub, "Nombre de circuits au tableau principal", n, "", "");
    note.ajouter(rub, "Coefficient de simultanéité du tableau ks", ksT, "", R.KS_TABLEAU);
    const pTot = ksT * somme(lignes.map((l) => l.p_w));
    const qTot = ksT * somme(lignes.map((l) => l.q_var));
    const sTot = Math.hypot(pTot, qTot);
    const phases = [...Array(nph).keys()];
    const pPh = new Array(nph).fill(0);
    const qPh = new Array(nph).fill(0);
    const profPPh = phases.map(() => new Array(24).fill(0));
    const profQPh = phases.map(() => new Array(24).fill(0));
    for (const l of lignes) {
      const lesPhases = l.circuit.triphase ? phases : [l.phase];
      const part = 1 / lesPhases.length;
      for (const ph of lesPhases) {
        pPh[ph] += ksT * l.p_w * part;
        qPh[ph] += ksT * l.q_var * part;
        for (let h = 0; h < 24; h++) { profPPh[ph][h] += l.profil_p[h] * part; profQPh[ph][h] += l.profil_q[h] * part; }
      }
    }
    const sPhKs = phases.map((k) => Math.hypot(pPh[k], qPh[k]));
    const sPhProfil = phases.map((k) => Math.max(...profPPh[k].map((p, h) => Math.hypot(p, profQPh[k][h]))));
    const profP = new Array(24).fill(0).map((_, h) => somme(phases.map((k) => profPPh[k][h])));
    const profQ = new Array(24).fill(0).map((_, h) => somme(phases.map((k) => profQPh[k][h])));
    const hPointe = argmax(24, (h) => Math.hypot(profP[h], profQ[h]));
    const sProfil = Math.hypot(profP[hPointe], profQ[hPointe]);
    const eJour = somme(profP);
    const ke = hyp.k_extension;
    const sDim = Math.max(sTot, sProfil) * ke;
    const pDim = Math.max(pTot, profP[hPointe]) * ke;
    const sDimPh = phases.map((k) => Math.max(sPhKs[k], sPhProfil[k]) * ke);
    const iBTgbt = Math.max(...sDimPh) / RES.u0;
    note.ajouter(rub, "Puissance active foisonnée (méthode ku·ks)", arrondi(pTot / 1000, 2), "kW", R.KU_KS);
    note.ajouter(rub, "Puissance réactive foisonnée", arrondi(qTot / 1000, 2), "kvar", R.BOUCHEROT);
    note.ajouter(rub, "Puissance apparente foisonnée", arrondi(sTot / 1000, 2), "kVA", R.BOUCHEROT);
    note.ajouter(rub, "cos φ global de l'installation", sTot ? arrondi(pTot / sTot, 3) : 1, "", R.BOUCHEROT);
    note.ajouter(rub, `Pointe du profil horaire (à ${hPointe} h)`, arrondi(sProfil / 1000, 2), "kVA", "");
    note.ajouter(rub, "Coefficient d'extension ke", ke, "", R.HYP);
    note.ajouter(rub, "Puissance apparente de dimensionnement", arrondi(sDim / 1000, 2), "kVA", "S_dim = max(S_ks, S_profil) · ke");
    note.ajouter(rub, "Puissance active de dimensionnement", arrondi(pDim / 1000, 2), "kW", "");
    sDimPh.forEach((s, k) => note.ajouter(rub, `Phase L${k + 1} : S de dimensionnement`, arrondi(s / 1000, 2), "kVA", ""));
    note.ajouter(rub, "Courant d'emploi du tableau (phase la plus chargée)", arrondi(iBTgbt, 1), "A", R.IB);
    note.ajouter(rub, "Consommation journalière (profil horaire)", arrondi(eJour / 1000, 2), "kWh/j", "");
    const moyenne = somme(sDimPh) / nph;
    const deseq = nph > 1 && moyenne ? (Math.max(...sDimPh) - Math.min(...sDimPh)) / moyenne : 0;
    if (nph > 1) {
      note.verifier(rub, deseq <= 0.25, `Déséquilibre entre phases ${pct(deseq)} (≤ 25 %)`,
        `Déséquilibre entre phases ${pct(deseq)} > 25 % : revoir la répartition des circuits`, "", "ATTENTION");
    }
    return { lignes, ks_tgbt: ksT, p_ks_w: pTot, q_ks_var: qTot, s_ks_va: sTot, s_profil_va: sProfil, h_pointe: hPointe,
      s_dim_va: sDim, p_dim_w: pDim, s_dim_phase_va: sDimPh, i_b_tgbt_a: iBTgbt, profil_p_w: profP, profil_q_var: profQ,
      energie_wh_j: eJour, cos_phi: sTot ? pTot / sTot : 1, s_non_lineaire_va: ksT * somme(lignes.map((l) => l.s_non_lineaire_va)) };
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
    return (((24 * 3600 * GSC) / Math.PI) * dr * (Math.cos(phi) * Math.cos(d) * Math.sin(ws) + ws * Math.sin(phi) * Math.sin(d))) / 3.6e6;
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
    return (Math.cos(phiE) * Math.cos(d) * Math.sin(wsP) + wsP * Math.sin(phiE) * Math.sin(d))
      / (Math.cos(phi) * Math.cos(d) * Math.sin(ws) + ws * Math.sin(phi) * Math.sin(d));
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
      r.push(Math.max(0, (Math.PI / 24) * (a + b * Math.cos(w)) * (Math.cos(w) - Math.cos(ws)) / (Math.sin(ws) - ws * Math.cos(ws))));
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
      note.info(rub, `Indice de clarté forfaitaire K_T = ${fr(hyp.kt_defaut, 2)} : saisir les 12 irradiations mensuelles du site (PVGIS ou NASA POWER) pour un calcul fiable`, R.HYP);
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
    return { h0, ghi, kt, ws, ht: hT, beta, mois_critique: mCrit, fd, rb: JOURS_TYPES.map((n) => rapportRb(lat, beta, n)), mesure: Boolean(site.ghi_mensuel) };
  }

  // ===========================================================================
  // 8. Module B — onduleur/chargeur, champ PV, batteries
  // ===========================================================================

  const cellulesSerie = (uBus, chimie) => (chimie === CHIMIES.lifepo4 ? { 12: 4, 24: 8, 48: 16 }[uBus] : Math.round(uBus / 2));
  const uChargeBus = (uBus, chimie) => cellulesSerie(uBus, chimie) * chimie.u_charge_cellule;
  const gammeOnduleurs = () => (RES.u0 >= 200 ? [3000, 5000, 8000, 10000, 15000] : [2000, 3000, 4000, 6000, 7500]);
  function designationOnduleur(nPar, unite) {
    if (RES.nph === 3) return `3 × ${nPar} × ${fr(unite / 1000)} kVA (couplage triphasé)`;
    if (RES.nph === 2) return `${nPar} × ${fr((2 * unite) / 1000)} kVA split-phase ${RES.u0}/${RES.u_ll} V`;
    return `${nPar} × ${fr(unite / 1000)} kVA monophasé`;
  }

  function dimensionnerOnduleur(note, bilan, circuits, hyp) {
    const rub = "B2. Onduleur / chargeur";
    const gamme = gammeOnduleurs();
    const sPh = Math.max(...bilan.s_dim_phase_va);
    const besoin25 = sPh / hyp.k_temp_onduleur;
    let unite = calibreSuperieur(besoin25, gamme);
    let nPar = 1;
    if (unite === null) { unite = gamme[gamme.length - 1]; nPar = Math.ceil(besoin25 / unite); }
    const sTotal = RES.nph * nPar * unite;
    note.ajouter(rub, `Besoin par ${RES.nph === 2 ? "demi-phase" : "phase"} à 40 °C`, arrondi(sPh / 1000, 2), "kVA", R.ONDULEUR);
    note.ajouter(rub, "Facteur de déclassement thermique (40 °C)", hyp.k_temp_onduleur, "", R.HYP);
    note.ajouter(rub, "Onduleur/chargeur retenu", designationOnduleur(nPar, unite), "", R.ONDULEUR_NORME);
    note.ajouter(rub, "Puissance assignée totale", arrondi(sTotal / 1000, 1), "kVA", "");
    const pCont = 0.8 * sTotal;
    const uBus = pCont <= 1500 ? 12 : pCont <= 4000 ? 24 : 48;
    note.ajouter(rub, "Tension nominale du bus continu", uBus, "V", "Règle usuelle : 12 V ≤ 1,5 kW < 24 V ≤ 4 kW < 48 V");
    if (pCont > 50000) note.info(rub, "Au-delà de ~50 kW, préférer une batterie haute tension (≥ 200 V) et des PCS dédiés", "");
    const dem = plusGrosDemarrage(circuits);
    const res = { unite_va: unite, n_par_phase: nPar, s_total_va: sTotal, u_bus: uBus, s_demarrage_va: dem ? dem.s_d : 0,
      moteur: dem ? dem.recepteur.nom : null, designation: designationOnduleur(nPar, unite) };
    if (dem) {
      const r = dem.recepteur;
      const sMarche = ((r.quantite * r.puissance_w) / (r.rendement * r.cos_phi)) * r.ku;
      const part = dem.circuit.triphase ? RES.nph : 1;
      const besoin = sPh - sMarche / part + dem.s_d / part;
      const capacite = hyp.surcharge_onduleur * unite * nPar;
      note.ajouter(rub, `Appel au démarrage moteur (${MODES_DEMARRAGE[r.demarrage].libelle})`, arrondi(dem.s_d / 1000, 1), "kVA", "S_d = (Id/In) · Pu/(η·cos φ)");
      note.verifier(rub, besoin <= capacite, `Surcharge de démarrage par phase ${fr(besoin / 1000)} kVA ≤ ${fr(capacite / 1000)} kVA`,
        `Surcharge de démarrage par phase ${fr(besoin / 1000)} kVA > ${fr(capacite / 1000)} kVA : démarreur progressif/variateur ou démarrage uniquement sur groupe`, R.ONDULEUR);
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
            if (!meilleur || cle[0] < meilleur.cle[0] || (cle[0] === meilleur.cle[0] && cle[1] < meilleur.cle[1])) meilleur = { cle, n_mppt: nMppt, ns, np };
          }
        }
      }
    }
    return { t_cell_max: tCellMax, voc_froid: vocFroid, vmp_froid: vmpFroid, vmp_chaud: vmpChaud, isc_chaud: iscChaud, v_mppt_min: vMpptMin,
      ns_min: nsMin, ns_max: nsMax, np_max: npMax, n_requis: nRequis, solution: meilleur ? { n_mppt: meilleur.n_mppt, ns: meilleur.ns, np: meilleur.np } : null };
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
    const pr = kTemp * (1 - hyp.pertes_encrassement) * (1 - hyp.pertes_dispersion) * (1 - hyp.pertes_cables_dc) * hyp.rendement_mppt * kAge;
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
      throw new Error("Aucune configuration série/parallèle des modules n'est compatible avec le régulateur MPPT : vérifiez les tensions et courants du module et du régulateur (onglet Choix techniques).");
    }
    const nModules = sol.n_mppt * sol.ns * sol.np;
    const pInstallee = nModules * module.p_wc;
    note.ajouter(rub, "Module", module.nom, "", "Fiche constructeur (valeurs typiques)");
    note.ajouter(rub, "Régulateur", `${sol.n_mppt} × ${mppt.nom}`, "", "");
    note.ajouter(rub, "Configuration par régulateur", `${sol.ns} en série × ${sol.np} en parallèle`, "", R.PV_CHAINES);
    note.ajouter(rub, "Nombre de modules", nModules, "", "");
    note.ajouter(rub, "Puissance crête installée", arrondi(pInstallee / 1000, 2), "kWc", R.PV_GEN);
    const vocChaine = sol.ns * cfg.voc_froid;
    const vmpChaud = sol.ns * cfg.vmp_chaud;
    const iscMppt = sol.np * cfg.isc_chaud;
    note.ajouter(rub, `Voc chaîne à ${fr(site.t_amb_min)} °C`, arrondi(vocChaine, 1), "V", R.PV_CHAINES);
    note.ajouter(rub, `Vmp chaîne à ${fr(cfg.t_cell_max, 0)} °C (cellule)`, arrondi(vmpChaud, 1), "V", R.PV_CHAINES);
    note.verifier(rub, vocChaine <= mppt.v_dc_max, `Voc max ${fr(vocChaine, 0)} V ≤ ${fr(mppt.v_dc_max, 0)} V admissibles`, "Voc max hors limite", R.PV_CHAINES);
    note.verifier(rub, vmpChaud >= cfg.v_mppt_min, `Vmp à chaud ${fr(vmpChaud, 0)} V ≥ seuil MPPT ${fr(cfg.v_mppt_min, 0)} V`, "Vmp à chaud sous le seuil MPPT", R.PV_CHAINES);
    note.verifier(rub, iscMppt <= mppt.isc_max, `Isc par entrée ${fr(iscMppt)} A ≤ ${fr(mppt.isc_max, 0)} A`, "Isc par entrée trop élevé", R.PV_CHAINES);
    const ratio = (sol.ns * sol.np * module.p_wc) / pMppt;
    note.verifier(rub, ratio <= hyp.ratio_pv_mppt_max, `Rapport Pc/P_MPPT = ${fr(ratio, 2)} (≤ ${fr(hyp.ratio_pv_mppt_max, 2)})`, "Champ trop puissant pour le MPPT", R.HYP, "ATTENTION");
    if ((sol.np - 1) * 1.25 * module.isc > module.i_inverse_max) {
      const inMin = nec() ? 1.5625 * module.isc : 1.5 * module.isc;
      const inFus = calibreSuperieur(inMin, CALIBRES_GPV);
      const inMax = nec() ? module.i_inverse_max : Math.min(2.4 * module.isc, module.i_inverse_max);
      note.verifier(rub, inFus !== null && inFus <= inMax, `Fusibles de chaîne ${inFus} A requis`, "Aucun calibre de fusible compatible : réduire le nombre de chaînes en parallèle", R.PV_FUS);
    } else {
      note.verifier(rub, true, `Pas de fusible de chaîne requis (${sol.np} chaîne(s) par entrée)`, "", R.PV_FUS);
    }
    if (nec()) note.info(rub, "PV sur bâtiment : arrêt rapide (rapid shutdown) requis par NEC 690.12", R.PV_GEN);
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
    const iDecharge = (0.8 * onduleur.s_total_va) / (uMin * hyp.rendement_onduleur);
    const nParMin = Math.ceil(iDecharge / (chimie.c_decharge_max * ahUnite));
    if (nParMin > nPar) {
      note.info(rub, `Nombre de branches porté de ${nPar} à ${nParMin} pour le courant de décharge`, R.BATT);
      nPar = nParMin;
    }
    const designation = chimie === CHIMIES.lifepo4 ? `${nPar} modules LFP ${fr(uNom)} V – ${ahUnite} Ah en parallèle` : `${nPar} branche(s) de ${nCell} éléments 2 V – ${ahUnite} Ah C10`;
    const cInstAh = nPar * ahUnite;
    const cInstKwh = (cInstAh * uNom) / 1000;
    note.ajouter(rub, "Parc retenu", designation, "", "");
    note.ajouter(rub, "Capacité installée", `${fr(cInstAh, 0)} Ah / ${fr(cInstKwh)} kWh`, "", "");
    note.verifier(rub, iDecharge <= chimie.c_decharge_max * cInstAh,
      `Décharge à pleine puissance ${fr(iDecharge, 0)} A ≤ ${fr(chimie.c_decharge_max, 2)}C (${fr(chimie.c_decharge_max * cInstAh, 0)} A)`, "Courant de décharge excessif", chimie.ref);
    const iChargePv = Math.min(pv.n_mppt * mppt.i_charge_max, (pv.p_installee_w * pv.k_temp) / pv.u_charge_bus);
    note.verifier(rub, iChargePv <= chimie.c_charge_max * cInstAh,
      `Courant de charge PV ${fr(iChargePv, 0)} A ≤ ${fr(chimie.c_charge_max, 2)}C (${fr(chimie.c_charge_max * cInstAh, 0)} A)`,
      `Courant de charge PV ${fr(iChargePv, 0)} A > ${fr(chimie.c_charge_max, 2)}C : limiter le courant de charge des régulateurs`, chimie.ref, "ATTENTION");
    if (chimie === CHIMIES.plomb) {
      note.verifier(rub, iChargePv >= 0.05 * cInstAh, `Courant de charge PV ≥ 0,05·C10 (${fr(0.05 * cInstAh, 0)} A) : recharge complète possible`,
        "Courant de charge PV < 0,05·C10 : recharges incomplètes (sulfatation)", chimie.ref, "ATTENTION");
      note.info(rub, "Plomb en climat chaud : la durée de vie est divisée par ~2 tous les +10 °C au-delà de 25 °C ; local ventilé (EN IEC 62485-2) et climatisé recommandé", chimie.ref);
    }
    note.info(rub, nec() ? "Installation : NEC Art. 706 et 480 (sectionnement, espaces de travail), système listé UL 9540, distances et locaux NFPA 855"
      : REF.code === "bs7671" ? "Installation : BS EN IEC 62485-2 (ventilation, sectionnement) ; PAS 63100 dans les logements (pas dans les chambres ni les issues)"
        : `Installation : local ventilé (IEC 62485-2), sectionneur-fusible en tête du parc, accès réservé${REF.code === "nfc15100" ? " ; guide UTE C 15-712-2 (systèmes PV autonomes avec stockage)" : ""}`, R.BATT);
    const iccBatt = uNom / (rUnite / nPar);
    note.ajouter(rub, "Courant de court-circuit du parc (≈ U/Ri)", arrondi(iccBatt / 1000, 1), "kA", "Pouvoir de coupure continu des protections batterie ≥ Icc");
    return { u_nom: uNom, u_min: uMin, n_cellules: nCell, c_requise_wh: cWh, c_installee_ah: cInstAh, c_installee_kwh: cInstKwh,
      n_par: nPar, ah_unite: ahUnite, designation, i_decharge_a: iDecharge, i_charge_pv_a: iChargePv, icc_a: iccBatt };
  }

  // ===========================================================================
  // 9. Source réseau (transformateur ou branchement BT public)
  // ===========================================================================

  function sourceReseau(note, bilan, src) {
    const rub = "S. Source réseau";
    const cMax = 1.05;
    if (src.type === "transfo") {
      const gamme = RES.nph === 3 ? TRANSFOS[REF.famille] : TRANSFOS.mono;
      const sT = src.s_transfo_kva || calibreSuperieur(bilan.s_dim_va / 1000, gamme);
      if (!sT) throw new Error(`Puissance de ${fr(bilan.s_dim_va / 1000, 0)} kVA au-delà de la gamme de transformateurs : prévoir plusieurs postes.`);
      const uk = src.uk_pct || (nec() ? (sT <= 500 ? 4.5 : 5.75) : sT <= 630 ? 4 : 6);
      const iN = courantSource(sT * 1000);
      const zT = uk / 100;
      const zQ = (sT / 1000) / src.s_kq_mva;
      const iccMax = (cMax * iN) / (zT + zQ);
      note.ajouter(rub, "Transformateur", `${fr(sT)} kVA, u_k ${fr(uk, 2)} %`, "", R.TRANSFO);
      note.ajouter(rub, "Taux de charge à la pointe", pct(bilan.s_dim_va / 1000 / sT), "", "");
      note.ajouter(rub, "Courant assigné secondaire", arrondi(iN, 1), "A", R.IB);
      note.ajouter(rub, "Icc maximal aux bornes BT", arrondi(iccMax / 1000, 2), "kA", R.TRANSFO_ICC);
      note.verifier(rub, bilan.s_dim_va / 1000 <= sT, `Pointe ${fr(bilan.s_dim_va / 1000)} kVA ≤ ${fr(sT)} kVA`, `Pointe ${fr(bilan.s_dim_va / 1000)} kVA > transformateur ${fr(sT)} kVA`, R.TRANSFO);
      return { type: "transfo", s_kva: sT, uk_pct: uk, i_n_a: iN, icc_max_a: iccMax, icc_min_a: 0.9 * iccMax, prive: true };
    }
    note.ajouter(rub, "Raccordement", "branchement basse tension du distributeur", "", "");
    note.ajouter(rub, "Icc maximal au point de livraison", src.icc_livraison_ka, "kA", "Donnée du distributeur");
    note.ajouter(rub, "Icc minimal au point de livraison", src.icc_min_ka, "kA", "Donnée du distributeur");
    return { type: "public", s_kva: null, i_n_a: bilan.i_b_tgbt_a, icc_max_a: src.icc_livraison_ka * 1000, icc_min_a: src.icc_min_ka * 1000, prive: false };
  }

  // ===========================================================================
  // 10. Module C — groupe électrogène
  // ===========================================================================

  function dimensionnerGroupe(note, site, hyp, bilan, circuits, systeme, ctx) {
    const rub = "C. Groupe électrogène";
    const secours = systeme === "reseau";
    const part = secours ? ctx.source.part_secourue : 1;
    const s1 = RES.nph * Math.max(...bilan.s_dim_phase_va) * part;
    const p1 = bilan.p_dim_w * part;
    const dem = plusGrosDemarrage(circuits);
    const sD = dem ? dem.s_d : 0;
    const d = hyp.chute_tension_max;
    const s3 = sD ? (hyp.xd_transitoire * sD * (1 - d)) / d : 0;
    const criteres = { [secours ? "Pointe des charges secourues" : "Pointe de l'installation"]: Math.max(s1, p1 / 0.8) };
    let pChargeAc = 0;
    if (systeme === "hybride") {
      const { gis, onduleur, batt, chimie } = ctx;
      const cWh = batt.c_installee_kwh * 1000;
      const eARecharger = cWh * (chimie.soc_arret_ge - (1 - chimie.dod + 0.05));
      let pChargeDc = Math.min(eARecharger / hyp.heures_recharge_cible, chimie.c_charge_max * batt.c_installee_ah * uChargeBus(onduleur.u_bus, chimie));
      pChargeDc = Math.min(pChargeDc, RES.nph * onduleur.n_par_phase * 0.8 * onduleur.unite_va);
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
    if (sGe === null) throw new Error(`Besoin de ${fr(sNomReq / 1000, 0)} kVA au-delà de la gamme (2500 kVA) : prévoir des groupes en parallèle.`);
    const sGeVa = sGe * 1000;
    const pSite = 0.8 * sGeVa * kTot;
    const iN = courantSource(sGeVa);
    const regime = secours ? "ESP (secours)" : "PRP";
    note.ajouter(rub, `Critère 1 — ${noms[0].toLowerCase()}`, arrondi(criteres[noms[0]] / 1000, 1), "kVA", `S ≥ ${RES.nph}·S_phase,max et P ≥ P_dim (cos φ GE = 0,8)`);
    if (systeme === "hybride") {
      note.ajouter(rub, "Puissance de recharge (côté AC)", arrondi(pChargeAc / 1000, 1), "kW", `Recharge en ${fr(hyp.heures_recharge_cible)} h, limitée par chargeur et C-rate`);
      note.ajouter(rub, "Critère 2 — charge de nuit + recharge à 70 %", arrondi(criteres["Recharge batterie à 70 % PRP"] / 1000, 1), "kVA", R.GE_ISO);
    }
    if (secours) note.ajouter(rub, "Part de l'installation secourue", pct(part), "", R.HYP);
    note.ajouter(rub, `Critère ${systeme === "hybride" ? 3 : 2} — démarrage moteur`, arrondi(s3 / 1000, 1), "kVA", R.GE_DIP);
    note.ajouter(rub, "Critère dimensionnant", critere, "", "");
    note.ajouter(rub, "Déclassement altitude × température × humidité", `${kAlt.toFixed(3)} × ${kTemp.toFixed(3)} × ${kHum.toFixed(3)} = ${kTot.toFixed(3)}`, "", R.GE_DERATE);
    note.ajouter(rub, "Puissance assignée requise", arrondi(sNomReq / 1000, 1), "kVA", R.GE_DERATE);
    note.ajouter(rub, `Groupe retenu (puissance ${regime})`, `${fr(sGe)} kVA / ${fr(0.8 * sGe)} kW`, "", secours ? R.GE_ESP : R.GE_ISO);
    note.ajouter(rub, "Puissance disponible sur site", arrondi(pSite / 1000, 1), "kW", R.GE_DERATE);
    note.ajouter(rub, "Courant assigné", arrondi(iN, 1), "A", R.IB);
    if (dem) {
      const dip = (hyp.xd_transitoire * sD) / (sGeVa * kTot + hyp.xd_transitoire * sD);
      note.verifier(rub, dip <= hyp.chute_tension_max, `Chute de tension au démarrage ${pct(dip, 1)} ≤ ${pct(hyp.chute_tension_max)}`,
        `Chute de tension au démarrage ${pct(dip, 1)} > ${pct(hyp.chute_tension_max)}`, R.GE_DIP);
      const r = dem.recepteur;
      const pD = sD * MODES_DEMARRAGE[r.demarrage].cos_phi_d;
      const pAvant = bilan.p_dim_w * part - ((r.quantite * r.puissance_w) / r.rendement) * r.ku;
      note.verifier(rub, pAvant + pD <= pSite, `Échelon de charge au démarrage ${fr((pAvant + pD) / 1000)} kW ≤ ${fr(pSite / 1000)} kW`,
        `Échelon ${fr((pAvant + pD) / 1000)} kW > puissance du moteur thermique : séquencer les démarrages`, "ISO 8528-5 : acceptation d'échelon selon la pression moyenne effective", "ATTENTION");
    }
    const iKSub = iN / hyp.xd_subtransitoire;
    const iKMaint = hyp.k_cc_maintenu_ge * iN;
    note.ajouter(rub, "Icc triphasé subtransitoire I''k3", arrondi(iKSub), "A", R.GE_ICC);
    note.ajouter(rub, "Icc maintenu (excitation AREP/PMG)", arrondi(iKMaint), "A", R.GE_ICC);
    const conso100 = hyp.conso_a * 0.8 * sGe + hyp.conso_b * 0.8 * sGe;
    note.ajouter(rub, "Consommation à 75 % de charge", arrondi(hyp.conso_a * 0.75 * 0.8 * sGe + hyp.conso_b * 0.8 * sGe, 2), "L/h", R.GE_CONSO);
    let cuve = null;
    if (secours) {
      cuve = conso100 * ctx.source.autonomie_h * 1.1;
      note.ajouter(rub, `Cuve pour ${fr(ctx.source.autonomie_h)} h à pleine charge (+10 %)`, arrondi(cuve), "L", R.GE_CONSO);
      note.info(rub, "Essais périodiques du groupe de secours en charge", R.SECOURS);
    }
    const iAts = Math.max(iN, bilan.i_b_tgbt_a * (nec() ? 1.25 : 1));
    const inInv = calibreSuperieur(iAts, CALIBRES_INVERSEURS);
    note.ajouter(rub, secours ? "Inverseur de source réseau / groupe" : "Inverseur de source (si réseau public)", `${inInv} A, ${nec() ? "UL 1008" : "4 pôles, AC-33A"}`, "", R.ATS);
    if (systeme === "hybride") note.info(rub, `Site isolé : le transfert groupe ↔ onduleur est assuré par le relais de transfert de l'onduleur/chargeur, à choisir ≥ ${fr(iN, 0)} A par phase`, R.ATS);
    return { s_kva: sGe, p_site_w: pSite, p_assignee_w: 0.8 * sGeVa, i_n_a: iN, k_declassement: kTot, critere, criteres_va: criteres,
      p_charge_ac_max_w: pChargeAc, i_k_sub_a: iKSub, i_k_maintenu_a: iKMaint, regime, cuve_l: cuve, conso_pleine_charge_l_h: conso100, inverseur_a: inInv };
  }

  function exploitationGroupeSeul(note, hyp, bilan, ge) {
    const rub = "Exploitation du groupe";
    const pN = ge.p_site_w / 1000;
    const heures = bilan.profil_p_w.map((p) => p / 1000).filter((p) => p > 0);
    const carburantJour = somme(heures.map((p) => hyp.conso_a * p + hyp.conso_b * (ge.p_assignee_w / 1000)));
    const tauxMoyen = heures.length ? somme(heures) / heures.length / pN : 0;
    const ppa = heures.length ? somme(heures.map((p) => Math.max(p, hyp.taux_charge_min_ge * pN))) / heures.length / pN : 0;
    const faibles = heures.filter((p) => p < hyp.taux_charge_min_ge * pN).length;
    note.ajouter(rub, "Heures de marche", heures.length, "h/j", "Marche aux heures où l'installation consomme");
    note.ajouter(rub, "Énergie produite", arrondi(somme(heures), 1), "kWh/j", "");
    note.ajouter(rub, "Carburant consommé", arrondi(carburantJour, 1), "L/j", R.GE_CONSO);
    note.ajouter(rub, "Carburant consommé", arrondi(carburantJour * 365), "L/an", R.GE_CONSO);
    note.ajouter(rub, "Taux de charge moyen en marche", pct(tauxMoyen), "", R.GE_ISO);
    note.verifier(rub, ppa <= 0.7 + 1e-9, `Puissance moyenne du groupe ${pct(ppa)} de la PRP (≤ 70 %)`, `Puissance moyenne du groupe ${pct(ppa)} de la PRP > 70 % : groupe trop juste en régime continu`, R.GE_ISO);
    const partFaible = heures.length ? faibles / heures.length : 0;
    note.verifier(rub, partFaible <= 0.1, `Marche sous ${pct(hyp.taux_charge_min_ge)} de charge : ${pct(partFaible)} des heures (≤ 10 %)`,
      `Marche sous ${pct(hyp.taux_charge_min_ge)} de charge : ${pct(partFaible)} des heures : risque d'encrassement (wet stacking) ; ajouter des batteries (hybride), un banc de charge ou un second groupe plus petit`,
      "Recommandation constructeurs : ≥ 30 % de charge", "ATTENTION");
    return { heures_jour: heures.length, energie_kwh_j: somme(heures), carburant_l_j: carburantJour, carburant_l_an: carburantJour * 365,
      taux_moyen: tauxMoyen, ppa, part_faible: partFaible };
  }

  function exploitationReseau(note, hyp, bilan, source, ge) {
    const rub = "Exploitation sur réseau";
    const eAn = (bilan.energie_wh_j * 365) / 1000;
    note.ajouter(rub, "Énergie annuelle soutirée au réseau", arrondi(eAn), "kWh/an", "");
    note.ajouter(rub, "Puissance à souscrire (pointe de dimensionnement)", arrondi(bilan.s_dim_va / 1000, 1), "kVA", "");
    const essais = ge ? 12 * (hyp.conso_a * 0.3 * ge.p_assignee_w / 1000 + hyp.conso_b * ge.p_assignee_w / 1000) : 0;
    if (ge) note.ajouter(rub, "Gasoil des essais mensuels (1 h à 30 % de charge)", arrondi(essais), "L/an", R.GE_CONSO);
    return { energie_kwh_an: eAn, carburant_essais_l_an: essais, source: source.type };
  }

  // ===========================================================================
  // 11. Simulation horaire (cycle charging)
  // ===========================================================================

  function simuler(jours, prm) {
    const { c_kwh: c, soc_initial: socInitial, soc_min: socMin, soc_demarrage: socDem, soc_arret: socArret, eta_rt: etaRt, eta_ond: etaOnd,
      eta_chg: etaChg, p_charge_batt_kw: pChargeBatt, p_decharge_batt_kw: pDechargeBatt, p_ond_kw: pOnd, p_chargeur_kw: pChargeur,
      p_ge_kw: pGe, p_ge_assignee_kw: pGeAssignee, taux_cible: tauxCible, taux_min: tauxMin, conso_a: a, conso_b: b } = prm;
    const avecGroupe = pGe > 0;
    const etaC = Math.sqrt(etaRt);
    const etaD = etaC;
    let e = socInitial * c;
    const eInitial = e;
    const eMin = socMin * c;
    const eDem = socDem * c;
    const eArret = socArret * c;
    const t = { charge: 0, servie: 0, non_servie: 0, pv_dispo: 0, pv_utilise: 0, pv_ecrete: 0, ge: 0, carburant: 0, heures_ge: 0, demarrages: 0,
      heures_ge_faible: 0, ppa_somme: 0, decharge_batt: 0, pertes: 0, heures_delestage: 0 };
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
          if (besoin > (e - eDem) * etaD || besoin > pDechargeBatt || L > pOnd) { geOn = true; t.demarrages += 1; }
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
    note.ajouter(rub, "Variabilité journalière de l'ensoleillement", `σ = ${pct(hyp.variabilite_journaliere)}, persistance ${fr(hyp.autocorrelation_journaliere, 2)}`, "",
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
      note.verifier(rub, annuel.non_servie < 1e-6, "Toute la consommation annuelle est servie", `Énergie non servie : ${fr(annuel.non_servie)} kWh/an`, R.SIM);
      if (annuel.heures_ge) {
        note.verifier(rub, annuel.ppa <= 0.7 + 1e-9, `Puissance moyenne du groupe ${pct(annuel.ppa)} de la PRP (≤ 70 %)`, `Puissance moyenne du groupe ${pct(annuel.ppa)} de la PRP > 70 %`, R.GE_ISO);
        const faible = annuel.heures_ge_faible / annuel.heures_ge;
        note.verifier(rub, faible <= 0.1, `Marche sous ${pct(hyp.taux_charge_min_ge)} de charge : ${pct(faible)} des heures (≤ 10 %)`,
          `Marche sous ${pct(hyp.taux_charge_min_ge)} de charge : ${pct(faible)} des heures : risque d'encrassement (wet stacking), prévoir banc de charge ou groupe plus petit`,
          "Recommandation constructeurs : ≥ 30 % de charge", "ATTENTION");
      }
      note.ajouter(rub, `Test ${hyp.jours_stress} j à ${pct(hyp.facteur_meteo_stress)} d'ensoleillement : groupe`, `${fr(stress.heures_ge / hyp.jours_stress)} h/j, ${fr(stress.carburant / hyp.jours_stress, 0)} L/j`, "", R.SIM);
      note.verifier(rub, stress.non_servie < 1e-6, "Test « jours sans soleil » : aucune coupure", `Test « jours sans soleil » : ${fr(stress.non_servie)} kWh non servis`, R.SIM);
    } else {
      note.verifier(rub, annuel.llp <= hyp.objectif_llp, `Taux de délestage ${pct(annuel.llp, 2)} ≤ objectif ${pct(hyp.objectif_llp, 1)}`,
        `Taux de délestage ${pct(annuel.llp, 2)} > objectif ${pct(hyp.objectif_llp, 1)} : augmenter l'autonomie, le champ PV, ou ajouter un groupe d'appoint (système hybride)`, R.SIM, "ATTENTION");
      note.ajouter(rub, `Test ${hyp.jours_stress} j à ${pct(hyp.facteur_meteo_stress)} d'ensoleillement`, `${fr(stress.non_servie, 1)} kWh non servis`, "", R.SIM);
      if (stress.non_servie > 1e-6) {
        note.info(rub, `Sur ${hyp.jours_stress} jours très couverts, ${fr(stress.non_servie)} kWh ne seraient pas servis : prévoir un délestage des usages non prioritaires ou un groupe d'appoint`, R.SIM);
      }
    }
  }

  // ===========================================================================
  // 12. Module A — câbles et protections
  // ===========================================================================

  function choisirCourbe(c, inC) {
    if (c.courbe) return c.courbe;
    let iAppel = 0;
    for (const r of c.recepteurs) if (r.moteur) iAppel = Math.max(iAppel, courantNominalMoteur(r, c.triphase) * r.quantite * MODES_DEMARRAGE[r.demarrage].id_in);
    for (const k of ["B", "C", "D"]) if (MAGNETIQUE_MIN[k] * inC > 1.2 * iAppel) return k;
    return "D";
  }
  function limitesChute(hyp, prive) {
    if (nec()) return { eclairage: 5, autres: 5, branche: 3, alimentation: 2 };
    return { eclairage: hyp.chute_max_eclairage ?? (prive ? 6 : 3), autres: hyp.chute_max_autres ?? (prive ? 8 : 5), branche: null, alimentation: prive ? 2 : 1.5 };
  }

  function cablesEtProtections(note, site, hyp, bilan, systeme, ctx) {
    const rub = "A. Câbles et protections";
    const { onduleur, pv, batt, ge, module, mppt, source } = ctx;
    const famNec = nec();
    const methode = METHODES_POSE[hyp.methode_pose];
    const kTAc = famNec ? kTemperatureNEC(site.t_amb_max, 90) : kTemperature(site.t_amb_max);
    const kTDc = famNec ? kTemperatureNEC(hyp.t_batterie_min + 10, 90) : kTemperature(hyp.t_batterie_min + 10);
    const limites = limitesChute(hyp, Boolean(source && source.prive));
    const iOnd = onduleur ? (onduleur.n_par_phase * onduleur.unite_va) / RES.u0 : 0;
    const iccOnd = onduleur ? hyp.k_cc_onduleur * iOnd : 0;
    const iccMaxTgbt = source ? source.icc_max_a : (ge ? ge.i_k_sub_a : 0) + iccOnd;
    // Contrainte thermique (A·√s) :
    // - Icc maintenu des sources à faible Icc (onduleur, groupe) : un défaut sous le seuil instantané peut durer 5 s ;
    // - Icc maximal : coupé par le déclencheur instantané en 20 ms, ou énergie limitée des disjoncteurs modulaires ≤ 63 A
    //   (classe 3 : I²t ≤ 40 000 A²s jusqu'à 32 A, 80 000 A²s jusqu'à 63 A — valeurs prudentes, à confirmer par la fiche constructeur).
    const iSoutenu = Math.max(iccOnd, ge ? ge.i_k_maintenu_a : 0);
    const racThermique = (inProt, seuil = 10 * inProt) => {
      const limite = inProt && inProt <= 63 ? Math.sqrt(inProt <= 32 ? 4e4 : 8e4) : Infinity;
      return Math.max(Math.min(iSoutenu, seuil) * Math.sqrt(5), Math.min(iccMaxTgbt * Math.sqrt(0.02), limite));
    };
    const polySource = RES.nph >= 2;
    const tableIec = (poly) => IZ_IEC.E[poly && RES.nph === 3 ? 3 : 2];
    const res = [];
    const ajouter = (liaison, iB, protection, longueur, dim, inProt) => {
      if (!dim) {
        note.verifier(rub, false, "", `${liaison} : aucune section ne convient (même avec 8 conducteurs en parallèle)`, R.DU);
        return null;
      }
      res.push({ liaison, i_b_a: iB, protection, longueur_m: longueur, section: libelleSection(dim), pe: conducteurProtection(dim, inProt), ...dim });
      return dim;
    };
    /** Liaison alternative de source (groupe, onduleur, réseau) : IEC sur In ; NEC sur le courant continu ×1,25 (ou ×1,15 pour un groupe). */
    const liaisonSource = (nom, iB, facteurNec, longueur, chuteMax, cosPhi) => {
      const iCont = famNec ? facteurNec * iB : iB;
      const inProt = calibreSuperieur(iCont, calibres());
      const dim = dimensionnerCable({ iRequis: famNec ? iCont : inProt, inProt, kCorrection: kTAc, tableIz: tableIec(polySource), chuteMax,
        contrainteARacS: racThermique(inProt), chute: (s, n) => chuteTensionAC(iB / n, longueur, s, cosPhi, polySource) });
      return ajouter(nom, iB, `Disj. ${RES.nph === 3 ? (famNec ? "3P" : "4P") : RES.nph === 2 ? "2P" : "2P"} ${inProt} A`, longueur, dim, inProt);
    };

    let cGe = null;
    let cAmont = null;
    let lAmont = 0;
    let duAmont = 0;
    if (systeme === "reseau") {
      const iB = source.type === "transfo" ? source.i_n_a : bilan.i_b_tgbt_a;
      cAmont = liaisonSource(source.type === "transfo" ? "Transformateur → TGBT" : "Branchement → TGBT", iB, 1.25, ctx.longueurSource, limites.alimentation, bilan.cos_phi || 0.9);
      lAmont = ctx.longueurSource;
      if (cAmont) duAmont = cAmont.chute_cumulee_pct;
    }
    if (ge) {
      const vers = systeme === "groupe" ? "Groupe → TGBT" : systeme === "reseau" ? "Groupe → inverseur de source" : "Groupe → onduleur (AC-in)";
      cGe = liaisonSource(vers, ge.i_n_a, 1.15, hyp.longueur_ge_m, 1.5, 0.8);
      if (systeme === "groupe" && cGe) { duAmont = cGe.chute_cumulee_pct; cAmont = cGe; lAmont = hyp.longueur_ge_m; }
    }
    if (onduleur) {
      const iBOnd = Math.max(iOnd, ge ? ge.i_n_a : 0);
      const cOnd = liaisonSource("Onduleurs (AC-out) → TGBT", iBOnd, 1.25, hyp.longueur_onduleur_tgbt_m, 1.0, 0.9);
      if (cOnd) { duAmont = cOnd.chute_cumulee_pct; cAmont = cOnd; lAmont = hyp.longueur_onduleur_tgbt_m; }

      const iDc = (0.8 * onduleur.unite_va) / (batt.u_min * hyp.rendement_onduleur);
      const inDc = calibreSuperieur(1.25 * iDc, CALIBRES_FUSIBLES_DC);
      ajouter("Batterie → chaque onduleur (DC)", iDc, `Fusible DC ${inDc} A`, hyp.longueur_batterie_m, dimensionnerCable({
        iRequis: famNec ? 1.25 * iDc : inDc * 1.1, inProt: inDc, kCorrection: kTDc, tableIz: IZ_IEC.E[2], chuteMax: hyp.chute_max_dc,
        chute: (s, n) => chuteTensionDC(iDc / n, hyp.longueur_batterie_m, s, batt.u_nom) }), inDc);

      const nChaines = pv.n_mppt * pv.np;
      const iChaine = 1.25 * module.isc;
      const vChaine = pv.ns * module.vmp;
      const dimPv = famNec
        ? dimensionnerNEC({ iRequis: iChaine, iSansCorrection: 1.25 * iChaine, table: "310.17", kCorrection: kTemperatureNEC(hyp.t_cable_pv, 90),
          chuteMax: hyp.chute_max_pv, nMax: 1, chute: (s) => chuteTensionDC(module.imp, hyp.longueur_chaine_m, s, vChaine) })
        : dimensionnerIEC({ iRequis: iChaine, kCorrection: kTemperature(hyp.t_cable_pv, 120, 60) * facteurGroupement(nChaines, "couche_paroi"),
          tableIz: IZ_PV, sections: SECTIONS_PV, chuteMax: hyp.chute_max_pv, sMin: 4, nMax: 1, chute: (s) => chuteTensionDC(module.imp, hyp.longueur_chaine_m, s, vChaine) });
      ajouter(`Chaîne PV → régulateur (${famNec ? "PV Wire" : "H1Z2Z2-K"})`, iChaine, "Sectionneur DC", hyp.longueur_chaine_m, dimPv, 0);

      const inMppt = calibreSuperieur(1.25 * mppt.i_charge_max, CALIBRES_FUSIBLES_DC);
      ajouter("Régulateur → batterie (DC)", mppt.i_charge_max, `Fusible DC ${inMppt} A`, hyp.longueur_batterie_m, dimensionnerCable({
        iRequis: famNec ? 1.25 * mppt.i_charge_max : inMppt * 1.1, inProt: inMppt, kCorrection: kTDc, tableIz: IZ_IEC.E[2], chuteMax: hyp.chute_max_dc,
        chute: (s, n) => chuteTensionDC(mppt.i_charge_max / n, hyp.longueur_batterie_m, s, batt.u_nom) }), inMppt);
      note.info(rub, `Protections côté batterie : pouvoir de coupure continu ≥ ${fr(batt.icc_a / 1000)} kA ; contrainte thermique à vérifier avec l'I²t limité du fusible (fiche constructeur)`, R.ADIAB);
    }
    const amont = cAmont ? [lAmont, cAmont.section_mm2, cAmont.conducteurs_paralleles] : null;

    const nCirc = bilan.lignes.length;
    const kGroup = famNec ? ajustementNEC(hyp.conducteurs_par_conduit) : facteurGroupement(nCirc, methode.groupement);
    const kCirc = kTAc * kGroup;
    note.ajouter(rub, "Référentiel", REF.libelle, "", "");
    note.ajouter(rub, "Courants admissibles", famNec ? `Table 310.16, cuivre THHN/THWN-2 90 °C, bornes ${hyp.bornes_75c ? 75 : 60} °C` : `méthode ${methode.nom}, cuivre PR, 30 °C`, "", R.IZ);
    if (famNec) note.ajouter(rub, "Charges continues", "conducteurs et protections à 125 %", "", R.CONTINU);
    if (onduleur) note.ajouter(rub, "Câbles de chaînes PV", famNec ? "PV Wire 90 °C, max(1,56·Isc sans correction ; 1,25·Isc corrigé)" : "H1Z2Z2-K, I_B = 1,25·Isc", "", R.PV_CABLE);
    note.ajouter(rub, "Chute de tension maximale côté AC", famNec ? "3 % circuit, 5 % au total" : `${fr(limites.eclairage)} % éclairage / ${fr(limites.autres)} % autres`, "", R.DU);
    if (onduleur) note.ajouter(rub, "Chute de tension maximale côté DC", `${fr(hyp.chute_max_dc)} % batterie / ${fr(hyp.chute_max_pv)} % chaînes PV`, "", R.DU_DC);
    note.ajouter(rub, "Disjoncteurs terminaux", famNec ? "à temps inverse (UL 489)" : "courbe B, sauf appel moteur (C ou D)", "", R.COURBES);
    note.ajouter(rub, "Contrainte thermique", "défaut sous le seuil instantané pendant 5 s (onduleur, groupe) ; Icc maximal coupé en 20 ms ou énergie limitée des disjoncteurs modulaires", "", R.ADIAB);
    note.ajouter(rub, `Facteur de température à ${fr(site.t_amb_max)} °C`, arrondi(kTAc, 3), "", R.KT);
    note.ajouter(rub, famNec ? `Ajustement (${hyp.conducteurs_par_conduit} conducteurs actifs par conduit)` : `Facteur de groupement (${nCirc} circuits)`, kGroup, "", R.KG);
    note.ajouter(rub, "Conducteur de protection", famNec ? "selon la protection (Table 250.122)" : "selon la section de phase", "", R.PE);

    const sources = [];
    if (systeme === "reseau") sources.push(["réseau", source.icc_min_a, []]);
    if (onduleur) sources.push(["onduleur", iccOnd, []]);
    if (ge && cGe) {
      const avant = systeme === "groupe" ? [] : [[hyp.longueur_ge_m, cGe.section_mm2, cGe.conducteurs_paralleles]];
      sources.push(["groupe", ge.i_k_maintenu_a, avant]);
    }
    const nonInstantane = Object.fromEntries(sources.map(([nom]) => [nom, []]));
    for (const l of bilan.lignes) {
      const c = l.circuit;
      const poly = c.triphase;
      const moteurs = c.recepteurs.filter((r) => r.moteur);
      const chuteMax = c.eclairage ? limites.eclairage : limites.autres;
      const chute = (s, n) => duAmont + chuteTensionAC(l.i_b_a / n, c.longueur_m, s, l.cos_phi, poly);
      let inC;
      let dim;
      let courbe = null;
      let seuil;
      if (famNec) {
        let iCont;
        let inMin;
        if (moteurs.length) {
          const flcs = moteurs.flatMap((r) => new Array(Math.max(1, Math.min(50, Math.round(r.quantite)))).fill(flcNEC(r, poly)));
          const flcMax = Math.max(...flcs);
          const autres = somme(flcs) - flcMax;
          const sTot = somme(c.recepteurs.map((r) => puissancesRecepteur(r)[1] / r.cos_phi));
          const sNonMoteur = somme(c.recepteurs.filter((r) => !r.moteur).map((r) => puissancesRecepteur(r)[1] / r.cos_phi));
          const iNonMoteur = sTot ? (l.i_b_a * sNonMoteur) / sTot : 0;
          iCont = 1.25 * flcMax + autres + 1.25 * iNonMoteur;
          inMin = 2.5 * flcMax + autres + iNonMoteur;
        } else {
          iCont = 1.25 * l.i_b_a;
          inMin = Math.max(iCont, c.calibre_min, 15);
        }
        inC = calibreSuperieur(inMin, CALIBRES_NEC);
        dim = dimensionnerNEC({ iRequis: iCont, inProt: inC, kCorrection: kCirc, regle2404D: !moteurs.length, moteur: moteurs.length > 0,
          chuteMax, chute, chuteBranche: (s, n) => chuteTensionAC(l.i_b_a / n, c.longueur_m, s, l.cos_phi, poly), chuteBrancheMax: limites.branche,
          // 430.52 : la protection du circuit moteur assure la protection des conducteurs contre les courts-circuits
          contrainteARacS: moteurs.length ? Math.min(iSoutenu, SEUIL_INSTANTANE_NEC * inC) * Math.sqrt(5) : racThermique(inC, SEUIL_INSTANTANE_NEC * inC) });
        seuil = SEUIL_INSTANTANE_NEC * inC;
      } else {
        const iMoteurs = somme(moteurs.map((r) => courantNominalMoteur(r, poly) * r.quantite));
        inC = calibreSuperieur(Math.max(l.i_b_a, iMoteurs, c.calibre_min), CALIBRES_IEC);
        courbe = choisirCourbe(c, inC);
        dim = dimensionnerIEC({ iRequis: inC, kCorrection: kCirc, tableIz: IZ_IEC[hyp.methode_pose][poly && RES.nph === 3 ? 3 : 2], chuteMax,
          contrainteARacS: racThermique(inC, MAGNETIQUE_MAX[courbe] * inC), sMin: c.section_min, chute });
        seuil = MAGNETIQUE_MAX[courbe] * inC;
      }
      if (!dim) {
        note.verifier(rub, false, "", `${c.nom} : aucune section ne satisfait les critères (circuit trop long ou trop chargé)`, R.DU);
        continue;
      }
      const troncons = [...(amont ? [amont] : []), [c.longueur_m, dim.section_mm2, dim.conducteurs_paralleles]];
      const icc = {};
      for (const [nom, iccSource, avant] of sources) {
        icc[nom] = iccMinFinLigne(iccSource, [...avant, ...troncons]);
        if (icc[nom] < seuil) nonInstantane[nom].push(`${c.nom.split(" ")[0]} (${fr(icc[nom], 0)} A < ${fr(seuil, 0)} A)`);
      }
      const zs = icc.réseau || icc.groupe || icc.onduleur ? (0.95 * RES.u0) / Math.min(...Object.values(icc)) : null;
      const protection = famNec ? `Disj. ${inC} A${moteurs.length ? " (moteur, 430.52)" : ""}` : `Disj. ${inC} A courbe ${courbe}`;
      res.push({ liaison: c.nom, i_b_a: l.i_b_a, protection, longueur_m: c.longueur_m, section: libelleSection(dim), pe: conducteurProtection(dim, inC),
        icc_min_reseau_a: icc["réseau"] === undefined ? null : arrondi(icc["réseau"]),
        icc_min_onduleur_a: icc.onduleur === undefined ? null : arrondi(icc.onduleur),
        icc_min_groupe_a: icc.groupe === undefined ? null : arrondi(icc.groupe), seuil_magnetique_a: seuil,
        zs_ohm: zs === null ? null : arrondi(zs, 3), zs_max_ohm: arrondi((0.95 * RES.u0) / seuil, 3), ...dim });
    }
    const messages = {
      réseau: "vérifier la coupure sur la courbe temps-courant ou réduire calibre/longueur",
      groupe: "vérifier la coupure sur la courbe temps-courant ou réduire calibre/longueur",
      onduleur: "l'onduleur limite puis coupe avant le disjoncteur (perte de sélectivité) ; choisir un onduleur à fort courant de court-circuit si la continuité de service l'exige",
    };
    const bs = REF.code === "bs7671";
    for (const nom of Object.keys(nonInstantane)) {
      const statut = nom === "réseau" && source.prive && !famNec ? "NON CONFORME" : "ATTENTION";
      note.verifier(rub, !nonInstantane[nom].length,
        bs ? `Sur ${nom} : Zs ≤ Zs max (Table 41.3) sur tous les circuits terminaux` : `Sur ${nom} : déclenchement magnétique assuré sur tous les circuits terminaux`,
        `Sur ${nom}, ${bs ? "Zs > Zs max (Icc mini < Ia)" : "Icc mini < seuil magnétique"} : ${nonInstantane[nom].join(", ")} — ${messages[nom]}`, R.TCOUP, statut);
    }
    if (systeme === "reseau" && !source.prive && !famNec) {
      note.info(rub, "Branchement public en schéma TT : la protection des personnes est assurée par les DDR ; Icc mini à confirmer par le distributeur", R.TCOUP);
    }
    note.ajouter(rub, `Icc maximal au tableau principal${ge && onduleur ? " (groupe + onduleurs)" : ""}`, arrondi(iccMaxTgbt), "A", R.ICC);
    const icu = iccMaxTgbt / 1000;
    note.info(rub, `Pouvoir de coupure Icu (ou AIC) ≥ ${fr(icu)} kA${icu <= 6 ? (famNec ? " : disjoncteurs 10 kA AIC suffisants" : " : disjoncteurs modulaires 6 kA suffisants") : ""}`, R.PROT);
    if (famNec) {
      note.info(rub, "GFCI (210.8) sur prises des pièces d'eau, cuisines, extérieur, garages ; AFCI (210.12) sur les circuits 15/20 A 120 V des logements", R.TCOUP);
      note.info(rub, "Conducteurs de phase surdimensionnés pour la chute de tension : augmenter l'EGC dans la même proportion (250.122(B))", R.PE);
      if (bilan.lignes.some((l) => l.circuit.recepteurs.some((r) => r.moteur))) {
        note.info(rub, "Moteurs : courants des Tables 430.248/430.250 (et non la plaque) ; climatiseurs et groupes froids à motocompresseur hermétique : Art. 440, conducteurs selon le MCA et protection selon le MOCP de la plaque signalétique", R.MOTEUR);
      }
    } else {
      note.info(rub, `Protection des personnes : DDR 30 mA sur tous les circuits terminaux${onduleur ? " ; en îlotage, l'onduleur doit relier neutre et terre (relais de terre) pour conserver le schéma TN-S" : ""}`, R.TCOUP);
    }
    return res;
  }

  // ===========================================================================
  // 13. Module D — compensation de l'énergie réactive
  // ===========================================================================

  function compensation(note, hyp, bilan, systeme, ctx) {
    const rub = "D. Compensation de l'énergie réactive";
    const P = bilan.p_ks_w;
    const Q = bilan.q_ks_var;
    const cos1 = bilan.cos_phi;
    const cible = hyp.cos_phi_cible ?? REF.cos_cible;
    const tan1 = P ? Q / P : 0;
    const tan2 = Math.tan(Math.acos(cible));
    const qc = Math.max(0, P * (tan1 - tan2));
    const sn = ctx.source && ctx.source.s_kva ? ctx.source.s_kva * 1000 : ctx.ge ? ctx.ge.s_kva * 1000 : bilan.s_dim_va;
    const gh = bilan.s_non_lineaire_va;
    const rapportGh = sn ? gh / sn : 0;
    note.ajouter(rub, "cos φ actuel / visé", `${fr(cos1, 3)} / ${fr(cible, 3)}`, "", REF.code === "nfc15100" ? R.COMP : R.HYP);
    note.ajouter(rub, "Puissance réactive à compenser", arrondi(qc / 1000, 1), "kvar", R.COMP_Q);
    const res = { cos_initial: cos1, cos_cible: cible, qc_var: qc, necessaire: qc >= 2500, gh_sur_sn: rapportGh };
    if (!res.necessaire) {
      note.verifier(rub, true, `cos φ ${fr(cos1, 3)} : aucune compensation nécessaire (Q_c < 2,5 kvar)`, "", R.COMP_Q);
      return res;
    }
    const pasCible = qc / 1000 / 6;
    const pas = calibreSuperieur(pasCible, GRADINS_KVAR) || GRADINS_KVAR[GRADINS_KVAR.length - 1];
    const nGradins = Math.ceil(qc / 1000 / pas);
    const qInst = nGradins * pas * 1000;
    const automatique = qc / sn > 0.15;
    let type = "standard";
    if (rapportGh > 0.5) type = "étude de filtrage (filtre actif)";
    else if (rapportGh > 0.25) type = `selfs anti-harmoniques p = 7 % (accord ${fr(RES.f / Math.sqrt(0.07), 0)} Hz)`;
    else if (rapportGh > 0.15) type = "renforcée (surdimensionnée en tension)";
    const iC = courantSource(qInst);
    const facteurCable = nec() ? 1.35 : 1.43;
    const inProt = calibreSuperieur(facteurCable * iC, calibres());
    const sccA = ctx.source ? ctx.source.icc_max_a : ctx.ge ? ctx.ge.i_k_sub_a : null;
    const scc = sccA ? (RES.nph === 3 ? SQRT3 * RES.u_ll : RES.nph === 2 ? RES.u_ll : RES.u0) * sccA : null;
    const hr = scc ? Math.sqrt(scc / qInst) : null;
    const iAvant = courantSource(bilan.s_ks_va);
    const iApres = courantSource(P / cible);
    note.ajouter(rub, "Batterie retenue", `${automatique ? "automatique" : "fixe"}, ${nGradins} × ${fr(pas)} kvar = ${fr(qInst / 1000)} kvar`, "", R.COMP_TYPE);
    note.ajouter(rub, "Charges non linéaires Gh / Sn", pct(rapportGh), "", R.COMP_HARM);
    note.ajouter(rub, "Type de condensateurs", type, "", R.COMP_HARM);
    note.ajouter(rub, "Courant assigné de la batterie", arrondi(iC, 1), "A", R.IB);
    note.ajouter(rub, `Protection et câble (≥ ${fr(facteurCable, 2)} × I_c)`, `${inProt} A`, "", R.COMP);
    note.ajouter(rub, "Courant de ligne avant / après", `${fr(iAvant, 1)} A / ${fr(iApres, 1)} A`, "", "");
    note.ajouter(rub, "Réduction des pertes Joule en amont", pct(1 - (cos1 / cible) ** 2), "", "Pertes ∝ I² ∝ 1/cos² φ");
    if (hr !== null) {
      note.ajouter(rub, "Rang de résonance parallèle h_r", arrondi(hr, 2), "", R.COMP_RES);
      const proche = [5, 7, 11, 13].find((h) => Math.abs(hr - h) <= 0.1 * h);
      note.verifier(rub, !proche || rapportGh > 0.25, `Rang de résonance ${fr(hr, 1)} éloigné des harmoniques 5, 7, 11, 13`,
        `Rang de résonance ${fr(hr, 1)} proche de l'harmonique ${proche} : utiliser des selfs anti-harmoniques`, R.HARM, "ATTENTION");
    }
    if (systeme === "hybride" || systeme === "solaire") {
      note.info(rub, "Alimentation par onduleur : l'onduleur fournit l'énergie réactive dans la limite de sa puissance apparente ; une batterie de condensateurs n'est pas nécessaire", R.HYP);
    } else if (systeme === "groupe") {
      note.verifier(rub, cos1 >= 0.8, `cos φ ${fr(cos1, 2)} ≥ 0,8 : le groupe délivre sa puissance active assignée`,
        `cos φ ${fr(cos1, 2)} < 0,8 : le groupe est limité par sa puissance apparente`, R.GE_ISO, "ATTENTION");
      note.info(rub, "Sur groupe électrogène : jamais de condensateurs fixes (risque d'auto-excitation à faible charge) ; batterie automatique déconnectée sous 30 % de charge", R.COMP);
    } else {
      note.verifier(rub, cos1 >= cible, `cos φ ${fr(cos1, 3)} ≥ ${fr(cible, 3)}`, `cos φ ${fr(cos1, 3)} < ${fr(cible, 3)} : installer la batterie de ${fr(qInst / 1000)} kvar`, R.COMP, "ATTENTION");
      if (ctx.ge) note.info(rub, "En marche sur groupe de secours, déconnecter la batterie de condensateurs (contact de l'inverseur de source)", R.COMP);
    }
    return { ...res, q_installee_var: qInst, n_gradins: nGradins, pas_kvar: pas, automatique, type, i_c_a: iC, protection_a: inProt, h_resonance: hr,
      i_avant_a: iAvant, i_apres_a: iApres };
  }

  // ===========================================================================
  // 14. Module E — ligne aérienne basse tension
  // ===========================================================================

  /** Équation de changement d'état : tension T2 (N) dans l'état 2 connaissant l'état 1. */
  function changementEtat(T1, w1, th1, w2, th2, a, E, S, alpha) {
    const ES = E * S;
    const A = (ES * a * a * w1 * w1) / (24 * T1 * T1) - T1 + ES * alpha * (th2 - th1);
    const B = (ES * a * a * w2 * w2) / 24;
    let bas = Math.max(1e-6, -A);
    let haut = Math.max(bas * 2, 1);
    while (haut * haut * (haut + A) < B) haut *= 2;
    for (let i = 0; i < 200; i++) {
      const m = (bas + haut) / 2;
      if (m * m * (m + A) < B) bas = m;
      else haut = m;
    }
    return (bas + haut) / 2;
  }
  function chargesConducteur(cond, etat) {
    const d = cond.diametre_mm / 1000;
    const t = (etat.givre || 0) / 1000;
    const wV = cond.masse_kg_m * 9.81;
    const wG = (913 * 9.81 * Math.PI * ((d + 2 * t) ** 2 - d ** 2)) / 4;
    const wH = (etat.vent || 0) * (d + 2 * t);
    return { vertical: wV + wG, horizontal: wH, resultante: Math.hypot(wV + wG, wH) + (etat.k || 0), diametre: d + 2 * t };
  }

  /**
   * Ligne aérienne BT issue du tableau principal.
   * `sourceLigne` : { nom, icc_a } — source qui fixe l'Icc minimal à l'origine de la ligne (réseau, groupe ou onduleur).
   */
  function calculerLigne(note, ligne, site, sourceLigne) {
    const rub = "E. Ligne aérienne";
    const cond = ligne.conducteur === "personnalise" && ligne.personnalise ? ligne.personnalise : CONDUCTEURS_AERIENS[ligne.conducteur || REF.conducteur];
    const climat = CLIMATS[ligne.climat || REF.climat];
    const cs = ligne.cs_charge ?? climat.cs_charge;
    const edsMax = ligne.eds_max ?? climat.eds_max;
    const facteurSupport = ligne.facteur_support ?? climat.facteur_support;
    const typePoteau = POTEAUX[ligne.poteau || REF.poteau];
    const portees = ligne.portees.map((x) => x.longueur_m);
    const aEq = Math.sqrt(somme(portees.map((a) => a ** 3)) / somme(portees));
    const S = cond.s_porteur;
    const E = cond.e_mpa;
    const tLimiteCharge = cond.rts_n / cs;
    const etatEds = { t: climat.t_eds, vent: 0, givre: 0, k: 0 };
    const wEds = chargesConducteur(cond, etatEds).resultante;
    const tensionDepuisEds = (tEds, etat) => changementEtat(tEds, wEds, climat.t_eds, chargesConducteur(cond, etat).resultante, etat.t, aEq, E, S, cond.alpha);
    const maxCharge = (tEds) => Math.max(...climat.etats.map((etat) => tensionDepuisEds(tEds, etat)));
    let tEds = edsMax * cond.rts_n;
    let critere = "tension journalière (EDS)";
    if (maxCharge(tEds) > tLimiteCharge) {
      let bas = 1;
      let haut = tEds;
      for (let i = 0; i < 100; i++) { const m = (bas + haut) / 2; if (maxCharge(m) > tLimiteCharge) haut = m; else bas = m; }
      tEds = bas;
      critere = "tension maximale en charge";
    }
    const etatChaud = { t: climat.t_chaud, vent: 0, givre: 0, k: 0 };
    const tChaud = tensionDepuisEds(tEds, etatChaud);
    const etats = [...climat.etats.map((etat) => ({ ...etat, tension_n: tensionDepuisEds(tEds, etat) })),
      { id: "EDS", nom: `Tension journalière : ${fr(climat.t_eds)} °C sans vent`, ...etatEds, tension_n: tEds },
      { id: "CHAUD", nom: `Flèche maximale : ${fr(climat.t_chaud)} °C sans vent`, ...etatChaud, tension_n: tChaud }];
    const wV = chargesConducteur(cond, etatChaud).vertical;
    const fleche = (a) => (wV * a * a) / (8 * tChaud);
    const flecheMax = Math.max(...portees.map(fleche));
    const enfouissement = 0.1 * ligne.hauteur_poteau_m + 0.6;
    const hAttache = ligne.hauteur_poteau_m - enfouissement - 0.3;
    const garde = hAttache - flecheMax;
    note.ajouter(rub, "Conducteur", cond.nom, "", "Fiche constructeur (valeurs indicatives)");
    note.ajouter(rub, "Hypothèses climatiques", climat.nom, "", R.LIGNE_CLIMAT);
    note.ajouter(rub, "Portée équivalente", arrondi(aEq, 1), "m", R.LIGNE_FLECHE);
    note.ajouter(rub, "Charge de rupture du porteur / coefficient de sécurité", `${fr(cond.rts_n / 10, 0)} daN / ${fr(cs, 2)}`, "", R.LIGNE_CLIMAT);
    note.ajouter(rub, "Tension de réglage (EDS)", `${fr(tEds / 10, 0)} daN (${pct(tEds / cond.rts_n, 1)} de la rupture)`, "", R.LIGNE_ETAT);
    note.ajouter(rub, "Critère de réglage", critere, "", R.LIGNE_ETAT);
    etats.forEach((x) => note.ajouter(rub, x.nom, `${fr(x.tension_n / 10, 0)} daN`, "", R.LIGNE_ETAT));
    note.ajouter(rub, `Flèche maximale (${fr(climat.t_chaud)} °C, plus grande portée)`, arrondi(flecheMax, 2), "m", R.LIGNE_FLECHE);
    note.ajouter(rub, "Hauteur d'attache (poteau − enfouissement 0,1·H + 0,6 m − 0,3 m)", arrondi(hAttache, 2), "m", R.HYP);
    note.verifier(rub, Math.max(...etats.map((x) => x.tension_n)) <= tLimiteCharge + 1, `Tension maximale ${fr(Math.max(...etats.map((x) => x.tension_n)) / 10, 0)} daN ≤ ${fr(tLimiteCharge / 10, 0)} daN`,
      `Tension maximale > ${fr(tLimiteCharge / 10, 0)} daN`, R.LIGNE_CLIMAT);
    note.verifier(rub, garde >= ligne.garde_min_m, `Hauteur libre au point bas ${fr(garde, 2)} m ≥ ${fr(ligne.garde_min_m)} m`,
      `Hauteur libre au point bas ${fr(garde, 2)} m < ${fr(ligne.garde_min_m)} m : poteaux plus hauts ou portées plus courtes`, R.LIGNE_CLIMAT);

    // Supports
    const n = portees.length;
    const supports = [];
    const etatsCharges = etats.filter((x) => climat.etats.some((c) => c.id === x.id));
    for (let i = 0; i <= n; i++) {
      const aG = i > 0 ? portees[i - 1] : 0;
      const aD = i < n ? portees[i] : 0;
      const arret = i === 0 || i === n;
      const angle = !arret && i > 0 ? ligne.portees[i - 1].angle_deg : 0;
      let effort = 0;
      for (const etat of etatsCharges) {
        const ch = chargesConducteur(cond, etat);
        const ventCond = (ch.horizontal * (aG + aD)) / 2;
        const hHorsSol = ligne.hauteur_poteau_m - enfouissement;
        const ventSupport = ligne.vent_support ? ((etat.vent || 0) * ligne.diametre_poteau_m * hHorsSol * hHorsSol) / 2 / hAttache : 0;
        const f = arret ? Math.hypot(etat.tension_n, ventCond + ventSupport) : ventCond + ventSupport + 2 * etat.tension_n * Math.sin(rad(angle) / 2);
        effort = Math.max(effort, f * facteurSupport);
      }
      const classe = typePoteau.classes.find(([, e]) => e * 10 >= effort);
      supports.push({ numero: i + 1, type: arret ? "arrêt" : angle > 0 ? `angle ${fr(angle)}°` : "alignement", effort_dan: effort / 10,
        classe: classe ? classe[0] : null, hauban: arret || angle > 30 });
    }
    note.ajouter(rub, "Type de supports", typePoteau.nom, "", R.LIGNE_SUPPORT);
    note.ajouter(rub, "Facteur de charge sur supports", facteurSupport, "", R.LIGNE_SUPPORT);
    const sansClasse = supports.filter((s) => !s.classe);
    note.verifier(rub, !sansClasse.length, `Classe de support trouvée pour les ${supports.length} poteaux`,
      `Poteaux ${sansClasse.map((s) => s.numero).join(", ")} : effort au-delà de la plus forte classe — haubaner ou renforcer`, R.LIGNE_EFFORT, "ATTENTION");
    const haubans = supports.filter((s) => s.hauban && s.classe);
    if (haubans.length) note.info(rub, `Haubans conseillés sur les poteaux ${haubans.map((s) => s.numero).join(", ")} (arrêts et angles > 30°)`, R.LIGNE_EFFORT);

    // Électrique : chute de tension et court-circuit le long de la ligne
    const charges = ligne.portees.map((x) => (x.charge_kva * 1000 * ligne.ks));
    const rPh = (cond.r20_phase * 1.25) / 1000;
    const xL = cond.x_km / 1000;
    const sinPhi = Math.sqrt(1 - ligne.cos_phi ** 2);
    let duCumul = 0;
    let lCumul = 0;
    const noeuds = [];
    let iMax = 0;
    for (let k = 0; k < n; k++) {
      const sAval = somme(charges.slice(k));
      const i = courantSource(sAval);
      iMax = Math.max(iMax, i);
      const b = RES.nph === 3 ? 1 : 2;
      const uRef = RES.nph === 2 ? RES.u_ll : RES.u0;
      duCumul += (100 * b * (rPh * portees[k] * ligne.cos_phi + xL * portees[k] * sinPhi) * i) / uRef;
      lCumul += portees[k];
      noeuds.push({ poteau: k + 2, distance_m: lCumul, courant_a: i, chute_pct: duCumul });
    }
    const imposee = ligne.icc_min_ka !== null && ligne.icc_min_ka > 0;
    const origine = imposee ? { nom: "valeur saisie", icc_a: ligne.icc_min_ka * 1000 } : sourceLigne || { nom: "valeur par défaut", icc_a: 3000 };
    const zBoucle = (1.5 * (cond.r20_phase + cond.r20_neutre) * lCumul) / 1000;
    const iccFin = (0.95 * RES.u0) / (RES.u0 / origine.icc_a + zBoucle);
    const fusible = ligne.protection_type === "fusible";
    const inProt = ligne.protection_a || calibreSuperieur(iMax, calibres()) || calibres()[calibres().length - 1];
    const libelleProt = `${fusible ? "fusible" : "disjoncteur"} ${inProt} A`;
    const seuil = (fusible ? 5 : 10) * inProt;
    const kT = kTemperature(site.t_amb_max, 90, 30);
    const izCorrige = cond.iz_a * kT;
    note.ajouter(rub, "Longueur totale", arrondi(lCumul), "m", "");
    note.ajouter(rub, "Courant maximal (premier tronçon)", arrondi(iMax, 1), "A", R.IB);
    note.ajouter(rub, `Protection de départ${ligne.protection_a ? "" : " (calibre choisi par le moteur)"}`, libelleProt, "", R.PROT);
    note.ajouter(rub, "Chute de tension en bout de ligne", arrondi(duCumul, 2), "%", R.DU);
    note.ajouter(rub, `Icc à l'origine (${origine.nom})`, arrondi(origine.icc_a), "A", R.ICC);
    note.ajouter(rub, "Icc phase-neutre minimal en bout de ligne", arrondi(iccFin), "A", R.ICC);
    note.verifier(rub, iMax <= izCorrige, `Courant ${fr(iMax, 0)} A ≤ ${fr(izCorrige, 0)} A admissibles à ${fr(site.t_amb_max)} °C`,
      `Courant ${fr(iMax, 0)} A > ${fr(izCorrige, 0)} A admissibles : section supérieure ou départ supplémentaire`, R.IZ);
    const okSurcharge = iMax <= inProt && inProt * (fusible && !nec() ? 1.1 : 1) <= izCorrige;
    note.verifier(rub, okSurcharge, `Protection contre les surcharges : I = ${fr(iMax, 0)} A ≤ In = ${inProt} A ≤ Iz`,
      iMax > inProt ? `Protection de départ ${inProt} A < courant de la ligne ${fr(iMax, 0)} A` : `Protection de départ ${inProt} A trop forte pour Iz = ${fr(izCorrige, 0)} A : section supérieure`, R.PROT);
    note.verifier(rub, duCumul <= REF.du_ligne * 0.8, `Chute de tension ${fr(duCumul, 2)} % ≤ ${fr(REF.du_ligne * 0.8, 1)} % (80 % de la tolérance de tension)`,
      `Chute de tension ${fr(duCumul, 2)} % > ${fr(REF.du_ligne * 0.8, 1)} % : section supérieure, ligne plus courte ou poste plus proche`, R.LIGNE_DU, "ATTENTION");
    const faibleIcc = !imposee && sourceLigne && sourceLigne.nom !== "réseau";
    note.verifier(rub, iccFin >= seuil, `Icc mini en bout ${fr(iccFin, 0)} A ≥ ${fr(seuil, 0)} A : la protection de départ (${libelleProt}) élimine le défaut`,
      faibleIcc
        ? `Icc mini en bout ${fr(iccFin, 0)} A < ${fr(seuil, 0)} A : sur ${origine.nom}, le défaut n'est pas éliminé par la protection de départ ; prévoir un DDR en tête de ligne et la coupure de la source sur surintensité`
        : `Icc mini en bout ${fr(iccFin, 0)} A < ${fr(seuil, 0)} A : protection de départ ${libelleProt} trop forte pour cette longueur (section supérieure ou ligne plus courte)`,
      fusible ? "Fusible gG : fusion en 5 s pour ≈ 5·In (courbe constructeur)" : R.COURBES, faibleIcc ? "ATTENTION" : "NON CONFORME");
    note.info(rub, "Les charges de la ligne ne sont pas comprises dans le bilan du bâtiment : si la ligne est alimentée par cette installation, ajoutez un circuit « Départ ligne aérienne » dans l'onglet Charges", R.HYP);
    return { conducteur: cond.nom, climat: climat.nom, rts_n: cond.rts_n, t_chaud: climat.t_chaud, a_eq_m: aEq, etats, t_eds_n: tEds, fleche_max_m: flecheMax, garde_m: garde,
      h_attache_m: hAttache, supports, noeuds, chute_pct: duCumul, icc_fin_a: iccFin, icc_origine_a: origine.icc_a, origine_icc: origine.nom,
      protection: libelleProt, protection_a: inProt, iz_a: izCorrige, i_max_a: iMax, longueur_m: lCumul, critere,
      portees: ligne.portees.map((x) => ({ ...x, fleche_chaude_m: fleche(x.longueur_m) })) };
  }

  // ===========================================================================
  // 15. Orchestration
  // ===========================================================================

  function executer(projetBrut) {
    const { projet, erreurs } = valider(projetBrut);
    if (erreurs.length) {
      const err = new Error(erreurs.join("\n"));
      err.erreurs = erreurs;
      throw err;
    }
    REF = REFERENTIELS[projet.referentiel];
    RES = RESEAUX[projet.reseau];
    R = { ...REFS_COMMUNES, ...REF.refs };
    REF_HYP = projet.hyp;
    const { site, circuits, module, mppt, hyp, systeme } = projet;
    const chimie = CHIMIES[hyp.chimie];
    const note = new Note();
    const bilan = bilanPuissance(note, circuits, hyp);
    if (!(bilan.energie_wh_j > 0) && (systeme === "hybride" || systeme === "solaire")) {
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
    let source = null;
    if (systeme === "hybride" || systeme === "solaire") {
      gis = gisementSolaire(note, site, hyp);
      onduleur = dimensionnerOnduleur(note, bilan, circuits, hyp);
      pv = dimensionnerPV(note, site, hyp, bilan, gis, onduleur, chimie, module, mppt);
      batt = dimensionnerBatteries(note, hyp, bilan, onduleur, pv, chimie, mppt);
    }
    if (systeme === "reseau") source = sourceReseau(note, bilan, projet.source);
    if (systeme === "hybride" || systeme === "groupe" || (systeme === "reseau" && projet.source.secours)) {
      ge = dimensionnerGroupe(note, site, hyp, bilan, circuits, systeme, { gis, onduleur, batt, chimie, source: projet.source });
    }
    if (systeme === "hybride" || systeme === "solaire") {
      sim = preparerSimulation(hyp, bilan, gis, pv, onduleur, batt, chimie, ge);
      verifierSimulation(note, hyp, sim.annuel, sim.stress, Boolean(ge));
    } else if (systeme === "groupe") {
      exploitation = exploitationGroupeSeul(note, hyp, bilan, ge);
    } else {
      exploitation = exploitationReseau(note, hyp, bilan, source, ge);
    }
    const cables = cablesEtProtections(note, site, hyp, bilan, systeme, { onduleur, pv, batt, ge, module, mppt, source, longueurSource: projet.source.longueur_m });
    const comp = compensation(note, hyp, bilan, systeme, { source, ge });
    const sourceLigne = source ? { nom: "réseau", icc_a: source.icc_min_a }
      : ge ? { nom: "groupe", icc_a: ge.i_k_maintenu_a }
        : onduleur ? { nom: "onduleur", icc_a: (hyp.k_cc_onduleur * onduleur.n_par_phase * onduleur.unite_va) / RES.u0 } : null;
    const ligne = projet.ligne.actif ? calculerLigne(note, projet.ligne, site, sourceLigne) : null;

    const nomenclature = [];
    if (source && source.type === "transfo") nomenclature.push(`Transformateur ${fr(source.s_kva)} kVA, u_k ${fr(source.uk_pct, 2)} %`);
    if (pv) {
      nomenclature.push(`${pv.n_modules} × ${module.nom} → ${fr(pv.p_installee_w / 1000, 2)} kWc, inclinaison ${gis.beta}° ${site.latitude >= 0 ? "plein Sud" : "plein Nord"}`);
      nomenclature.push(`${pv.n_mppt} × ${mppt.nom} (${pv.ns} série × ${pv.np} parallèle par régulateur)`);
      nomenclature.push(`Batteries : ${batt.designation} → ${fr(batt.c_installee_kwh)} kWh`);
      nomenclature.push(`Onduleurs/chargeurs : ${onduleur.designation}, bus ${onduleur.u_bus} V DC`);
    }
    if (ge) nomenclature.push(`Groupe électrogène : ${fr(ge.s_kva)} kVA ${ge.regime} (critère : ${ge.critere})${ge.cuve_l ? `, cuve ${fr(ge.cuve_l, 0)} L` : ""}`);
    if (ge && systeme === "reseau") nomenclature.push(`Inverseur de source ${ge.inverseur_a} A`);
    if (comp.necessaire && systeme === "reseau") nomenclature.push(`Batterie de condensateurs ${comp.automatique ? "automatique" : "fixe"} ${fr(comp.q_installee_var / 1000)} kvar (${comp.type})`);
    if (ligne) nomenclature.push(`Ligne aérienne ${fr(ligne.longueur_m, 0)} m en ${ligne.conducteur}, ${ligne.supports.length} supports`);

    const compte = (s) => note.verifications.filter((v) => v.statut === s).length;
    const synthese = {
      systeme, systeme_libelle: SYSTEMES[systeme], referentiel: REF.libelle, reseau: RES.nom,
      energie_kwh_j: bilan.energie_wh_j / 1000, s_dim_kva: bilan.s_dim_va / 1000, p_dim_kw: bilan.p_dim_w / 1000,
      cos_phi: bilan.cos_phi, i_b_tgbt_a: bilan.i_b_tgbt_a,
      pv: pv && { kwc: pv.p_installee_w / 1000, kwc_requis: pv.p_requise_w / 1000, n_modules: pv.n_modules, n_mppt: pv.n_mppt,
        config: `${pv.ns} série × ${pv.np} parallèle`, inclinaison: gis.beta, mois_critique: MOIS[gis.mois_critique], psh: gis.ht[gis.mois_critique] },
      batteries: batt && { kwh: batt.c_installee_kwh, ah: batt.c_installee_ah, u_nom: batt.u_nom, designation: batt.designation },
      onduleur: onduleur && { kva: onduleur.s_total_va / 1000, designation: onduleur.designation, u_bus: onduleur.u_bus },
      groupe: ge && { kva: ge.s_kva, kw: ge.p_assignee_w / 1000, critere: ge.critere, regime: ge.regime },
      source: source && { type: source.type, s_kva: source.s_kva, icc_max_ka: source.icc_max_a / 1000 },
      simulation: sim && { fraction_renouvelable: sim.annuel.fraction_renouvelable, heures_ge: sim.annuel.heures_ge, carburant_l_an: sim.annuel.carburant,
        non_servie_kwh: sim.annuel.non_servie, llp: sim.annuel.llp, pv_ecrete_kwh: sim.annuel.pv_ecrete },
      exploitation,
      compensation: { necessaire: comp.necessaire, q_kvar: comp.q_installee_var ? comp.q_installee_var / 1000 : 0, cos_initial: comp.cos_initial, cos_cible: comp.cos_cible },
      ligne: ligne && { longueur_m: ligne.longueur_m, chute_pct: ligne.chute_pct, fleche_max_m: ligne.fleche_max_m, supports: ligne.supports.length },
      verifications: { non_conforme: compte("NON CONFORME"), attention: compte("ATTENTION"), ok: compte("OK") },
    };
    return { version: VERSION, projet, synthese, bilan, gisement: gis, onduleur, pv, batteries: batt, groupe: ge, source,
      simulation: sim && { annuel: sim.annuel, stress: sim.stress }, exploitation, cables, compensation: comp, ligne, nomenclature,
      note: note.lignes, verifications: note.verifications, references: note.references };
  }

  // ===========================================================================
  // 16. Projet d'exemple (même cas que le démonstrateur Python)
  // ===========================================================================

  function projetExemple() {
    const r = (nom, quantite, puissance_w, cos_phi, plages, extra = {}) => ({ nom, quantite, puissance_w, cos_phi, plages, ...extra });
    return {
      nom: "Centre de santé rural (exemple)", systeme: "hybride", referentiel: "nfc15100", reseau: "400/230-50",
      site: { ...SITE },
      circuits: [
        { nom: "C1 Éclairage intérieur", longueur_m: 40, eclairage: true, recepteurs: [r("Luminaire LED 18 W", 50, 18, 0.9, [[6, 8, 0.5], [8, 18, 0.3], [18, 23, 1], [23, 6, 0.15]], { non_lineaire: true })] },
        { nom: "C2 Éclairage extérieur", longueur_m: 60, eclairage: true, recepteurs: [r("Projecteur LED 50 W", 6, 50, 0.9, [[18, 6, 1]], { non_lineaire: true })] },
        { nom: "C3 Climatisation salles de soins", longueur_m: 25, recepteurs: [r("Split inverter 1,2 kW", 2, 1200, 0.95, [[9, 17, 0.7]], { non_lineaire: true })] },
        { nom: "C4 Chaîne du froid (vaccins)", longueur_m: 20, recepteurs: [r("Réfrigérateur médical", 2, 150, 0.8, [[0, 24, 0.5]])] },
        { nom: "C5 Bureautique / informatique", longueur_m: 30, recepteurs: [r("Poste informatique", 6, 120, 0.95, [[8, 17, 0.8]], { non_lineaire: true })] },
        { nom: "C6 Prises de courant", longueur_m: 35, ks: 0.2, calibre_min: 20, section_min: 2.5, recepteurs: [r("Prise 16 A (usages divers)", 20, 250, 0.9, [[8, 17, 0.08]])] },
        { nom: "C7 Stérilisation", longueur_m: 20, recepteurs: [r("Autoclave", 1, 2000, 1, [[10, 12, 0.8]])] },
        { nom: "C8 Pompe de forage", longueur_m: 80, triphase: true, recepteurs: [r("Moteur asynchrone 3 kW", 1, 3000, 0.82, [[10, 13, 1]], { rendement: 0.85, ku: 0.9, moteur: true, demarrage: "progressif" })] },
        { nom: "C9 Équipements médicaux", longueur_m: 25, recepteurs: [r("Concentrateur d'oxygène", 1, 350, 0.95, [[0, 24, 0.5]]), r("Aspirateur de mucosités", 1, 200, 0.9, [[8, 18, 0.1]])] },
        { nom: "C10 Laboratoire", longueur_m: 30, recepteurs: [r("Centrifugeuse, incubateur, microscopes", 1, 1000, 0.9, [[8, 16, 0.5]])] },
      ],
      module: { ...MODULE_PV }, mppt: { ...REGULATEUR }, hypotheses: {}, source: { ...SOURCE },
      ligne: { ...LIGNE, portees: LIGNE.portees.map((x) => ({ ...x })) },
    };
  }

  racine.Moteur = Object.freeze({
    VERSION, executer, valider, normaliser, projetExemple,
    HYPOTHESES, SITE, MODULE_PV, REGULATEUR, SOURCE, LIGNE, CHIMIES, MODES_DEMARRAGE, SYSTEMES, REFERENTIELS, RESEAUX,
    METHODES_POSE, CONDUCTEURS_AERIENS, CLIMATS, POTEAUX, MOIS, JOURS_PAR_MOIS,
    outils: { irradiationExtraterrestre, repartitionHoraire, chuteTensionAC, kTemperature, kTemperatureNEC, ajustementNEC, dimensionnerCable,
      simuler, mulberry32, facteursMeteo, changementEtat, flcNEC,
      /** Active un référentiel et un réseau pour appeler les outils hors d'un calcul complet (tests). */
      contexte(referentiel, reseau, hypotheses = {}) {
        REF = REFERENTIELS[referentiel]; RES = RESEAUX[reseau]; R = { ...REFS_COMMUNES, ...REF.refs }; REF_HYP = { ...HYPOTHESES, ...hypotheses };
      } },
  });
})(typeof globalThis !== "undefined" ? globalThis : this);
