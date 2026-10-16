/*
 * Catalogue des équipements électriques et types de circuits usuels.
 *
 * - APPAREILS : valeurs typiques de plaque signalétique pour le bilan de puissance (puissance, cos φ, rendement des
 *   moteurs, mode de démarrage, charge non linéaire, heures d'utilisation). Valeurs génériques : la plaque de
 *   l'appareil installé fait foi.
 * - TYPES_CIRCUITS : protection et section minimales usuelles par usage (NF C 15-100 pour la famille IEC, NEC 210 pour
 *   le NEC). Le moteur de calcul augmente ensuite calibre et section selon la charge, la longueur et la pose.
 * - Conversions de puissance (W, kW, CV, HP, kVA, A) et répartition automatique d'appareils en circuits.
 *
 * Conventions du moteur : pour un moteur, « puissance_w » est la puissance utile (plaque en kW ou CV) et le rendement
 * donne la puissance absorbée ; pour un appareil à compresseur dont la plaque donne la puissance absorbée
 * (réfrigérateur, climatiseur), le rendement vaut 1.
 */
(function (racine) {
  "use strict";

  const CATEGORIES = [
    ["eclairage", "Éclairage"],
    ["clim", "Climatisation, ventilation, chauffage"],
    ["froid", "Froid"],
    ["cuisine", "Cuisine"],
    ["menager", "Électroménager, eau chaude, loisirs"],
    ["info", "Informatique, bureau, télécom"],
    ["batiment", "Sécurité et services du bâtiment"],
    ["eau", "Pompage et traitement de l'eau"],
    ["atelier", "Atelier, outillage, soudage"],
    ["agro", "Agro-transformation et élevage"],
    ["sante", "Santé et laboratoire"],
    ["commerce", "Commerce, hôtellerie, restauration"],
    ["mobilite", "Recharge et mobilité électrique"],
    ["industrie", "Moteurs et industrie"],
  ].map(([cle, nom]) => ({ cle, nom }));

  // ---------------------------------------------------------------------------
  // Types de circuits
  // ---------------------------------------------------------------------------

  /**
   * iec : [calibre mini A, section mini mm²] (tri : variante triphasée) ; nec : calibre mini A.
   * dedie : un circuit par appareil ; sinon les appareils sont regroupés jusqu'à p_max_w (à 230 V) et points_max.
   */
  const TYPES_CIRCUITS = {
    eclairage: { nom: "Éclairage", eclairage: true, iec: [10, 1.5], nec: 15, longueur_m: 25, p_max_w: 2000, points_max: 8 },
    exterieur: { nom: "Éclairage extérieur", eclairage: true, iec: [10, 1.5], nec: 15, longueur_m: 40, p_max_w: 2000, points_max: 8 },
    prises: { nom: "Prises de courant", iec: [20, 2.5], nec: 20, longueur_m: 20, p_max_w: 2300 },
    cuisine: { nom: "Prises de la cuisine", iec: [20, 2.5], nec: 20, longueur_m: 15, p_max_w: 3000 },
    specialise: { nom: "Circuit spécialisé", iec: [20, 2.5], nec: 20, longueur_m: 15, dedie: true },
    cuisson: { nom: "Cuisson", iec: [32, 6], iec_tri: [20, 2.5], nec: 40, longueur_m: 12, dedie: true },
    chauffe_eau: { nom: "Chauffe-eau", iec: [20, 2.5], nec: 20, longueur_m: 15, dedie: true },
    clim: { nom: "Climatisation", iec: [20, 2.5], nec: 20, longueur_m: 15, dedie: true },
    froid: { nom: "Froid", iec: [20, 2.5], nec: 20, longueur_m: 15, p_max_w: 1500 },
    informatique: { nom: "Informatique et bureautique", iec: [20, 2.5], nec: 20, longueur_m: 20, p_max_w: 2300 },
    securite: { nom: "Sécurité et télécom (permanent)", iec: [10, 1.5], nec: 15, longueur_m: 25, p_max_w: 1000 },
    medical: { nom: "Équipements médicaux", iec: [20, 2.5], nec: 20, longueur_m: 20, p_max_w: 2300 },
    atelier: { nom: "Prises d'atelier", iec: [20, 2.5], nec: 20, longueur_m: 20, p_max_w: 3000 },
    moteur: { nom: "Force motrice", iec: [10, 1.5], nec: 15, longueur_m: 30, dedie: true },
    ve: { nom: "Recharge de véhicule électrique", iec: [20, 2.5], nec: 20, longueur_m: 20, dedie: true },
    autre: { nom: "Autre usage", iec: [10, 1.5], nec: 15, longueur_m: 25, p_max_w: 2300 },
  };

  /** Valeurs du circuit pour un type, selon la famille de normes (« iec » ou « nec ») et l'alimentation. */
  function presetCircuit(type, famille, triphase = false) {
    const t = TYPES_CIRCUITS[type];
    if (!t) return null;
    const res = { type, eclairage: Boolean(t.eclairage) };
    if (famille === "nec") res.calibre_min = t.nec;
    else {
      const [calibre, section] = (triphase && t.iec_tri) || t.iec;
      res.calibre_min = calibre;
      res.section_min = section;
    }
    return res;
  }

  // ---------------------------------------------------------------------------
  // Appareils
  // ---------------------------------------------------------------------------

  // Plages horaires usuelles : [début h, fin h, taux de marche 0-1] ; une plage peut passer minuit
  const SOIR = [[18, 23, 1]];
  const NUIT = [[18, 6, 1]];
  const PERMANENT = [[0, 24, 1]];
  const BUREAU = [[8, 17, 1]];
  const COMPRESSEUR = [[0, 24, 0.45]];
  const CLIM_JOUR = [[11, 18, 0.7]];
  const CLIM_CHAMBRE = [[21, 6, 0.6]];
  const ATELIER = [[8, 17, 0.6]];

  const APPAREILS = [];
  let categorie = null;
  /**
   * Options : eta (rendement), ku, dem (mode de démarrage : l'appareil est un moteur), nl (charge non linéaire),
   * tri (alimentation triphasée conseillée), circuit (type de circuit), mots (mots-clés de recherche), note.
   */
  function a(nom, puissance_w, cos_phi, plages, o = {}) {
    APPAREILS.push({
      id: identifiant(nom), categorie, nom, puissance_w, cos_phi, rendement: o.eta ?? 1, ku: o.ku ?? 1, plages,
      moteur: Boolean(o.dem), demarrage: o.dem || "direct", non_lineaire: Boolean(o.nl), triphase: Boolean(o.tri),
      circuit: o.circuit || CIRCUIT_PAR_CATEGORIE[categorie], mots: o.mots || "", note: o.note || "",
    });
  }
  const CIRCUIT_PAR_CATEGORIE = {
    eclairage: "eclairage", clim: "clim", froid: "froid", cuisine: "cuisine", menager: "prises", info: "informatique",
    batiment: "securite", eau: "moteur", atelier: "atelier", agro: "moteur", sante: "medical", commerce: "prises",
    mobilite: "ve", industrie: "moteur",
  };
  /** Moteur asynchrone : rendement et cos φ usuels (4 pôles, classe IE2), démarrage selon la puissance. */
  function moteurAsynchrone(kw, triphase) {
    const table = triphase
      ? [[0.75, 0.79, 0.75], [1.1, 0.81, 0.77], [1.5, 0.82, 0.79], [2.2, 0.84, 0.81], [3, 0.85, 0.82], [4, 0.86, 0.82], [5.5, 0.87, 0.84],
        [7.5, 0.88, 0.85], [11, 0.89, 0.85], [15, 0.9, 0.86], [18.5, 0.91, 0.86], [22, 0.91, 0.86], [30, 0.92, 0.86], [37, 0.93, 0.86],
        [45, 0.93, 0.87], [55, 0.94, 0.87], [75, 0.94, 0.87], [90, 0.95, 0.87], [110, 0.95, 0.87]]
      : [[0.37, 0.62, 0.9], [0.55, 0.65, 0.9], [0.75, 0.68, 0.9], [1.1, 0.71, 0.9], [1.5, 0.74, 0.92], [2.2, 0.76, 0.92], [3, 0.78, 0.92]];
    const [, eta, cos] = table.find(([p]) => p >= kw - 1e-9) || table[table.length - 1];
    const dem = kw <= 4 ? "direct" : kw <= 15 ? "etoile_triangle" : "progressif";
    return { eta, cos, dem };
  }
  // Équivalences commerciales usuelles kW → CV des moteurs normalisés
  const CV_USUELS = { 0.37: "0,5", 0.55: "0,75", 0.75: "1", 1.1: "1,5", 1.5: "2", 2.2: "3", 3: "4", 4: "5,5", 5.5: "7,5", 7.5: "10", 11: "15",
    15: "20", 18.5: "25", 22: "30", 30: "40", 37: "50", 45: "60", 55: "75", 75: "100", 90: "125", 110: "150" };
  const cv = (kw) => `${CV_USUELS[kw] || String(Math.round(kw / 0.7355)).replace(".", ",")} CV`;
  const kwTexte = (kw) => String(kw).replace(".", ",");

  categorie = "eclairage";
  a("Ampoule LED 7 W", 7, 0.9, SOIR, { nl: 1, mots: "lampe" });
  a("Ampoule LED 10 W", 10, 0.9, SOIR, { nl: 1, mots: "lampe" });
  a("Ampoule LED 15 W", 15, 0.9, SOIR, { nl: 1, mots: "lampe" });
  a("Spot encastré LED 6 W", 6, 0.9, SOIR, { nl: 1 });
  a("Tube LED 60 cm 9 W", 9, 0.9, SOIR, { nl: 1, mots: "neon reglette" });
  a("Tube LED 120 cm 18 W", 18, 0.9, SOIR, { nl: 1, mots: "neon reglette" });
  a("Tube LED 150 cm 24 W", 24, 0.9, SOIR, { nl: 1, mots: "neon reglette" });
  a("Réglette LED double 2 × 18 W", 36, 0.9, SOIR, { nl: 1, mots: "neon tube" });
  a("Dalle LED 60 × 60 cm 40 W (bureau)", 40, 0.95, BUREAU, { nl: 1, mots: "panneau plafonnier" });
  a("Plafonnier LED 24 W", 24, 0.9, SOIR, { nl: 1 });
  a("Hublot LED extérieur 12 W", 12, 0.9, NUIT, { nl: 1, circuit: "exterieur", mots: "applique" });
  a("Projecteur LED 30 W", 30, 0.9, NUIT, { nl: 1, circuit: "exterieur" });
  a("Projecteur LED 50 W", 50, 0.9, NUIT, { nl: 1, circuit: "exterieur" });
  a("Projecteur LED 100 W", 100, 0.95, NUIT, { nl: 1, circuit: "exterieur" });
  a("Projecteur LED 200 W", 200, 0.95, NUIT, { nl: 1, circuit: "exterieur", mots: "stade terrain" });
  a("Lampadaire LED d'éclairage public 60 W", 60, 0.95, NUIT, { nl: 1, circuit: "exterieur", mots: "rue voirie candelabre" });
  a("Lampadaire LED d'éclairage public 100 W", 100, 0.95, NUIT, { nl: 1, circuit: "exterieur", mots: "rue voirie candelabre" });
  a("Luminaire industriel LED 100 W (grande hauteur)", 100, 0.95, [[7, 18, 1]], { nl: 1, mots: "hangar entrepot highbay cloche" });
  a("Luminaire industriel LED 150 W (grande hauteur)", 150, 0.95, [[7, 18, 1]], { nl: 1, mots: "hangar entrepot highbay cloche" });
  a("Bloc autonome d'éclairage de sécurité 3 W", 3, 0.9, PERMANENT, { nl: 1, mots: "baes secours issue" });
  a("Tube fluorescent 36 W avec ballast ferromagnétique", 46, 0.5, SOIR, { mots: "neon ancien", note: "Ancien éclairage non compensé : cos φ 0,5." });
  a("Lampe à iodures métalliques 250 W (compensée)", 275, 0.9, NUIT, { circuit: "exterieur", mots: "sodium hid" });

  categorie = "clim";
  a("Climatiseur split inverter 9 000 BTU", 820, 0.95, CLIM_JOUR, { nl: 1, mots: "clim 1 cv 2,6 kw" });
  a("Climatiseur split inverter 12 000 BTU", 1100, 0.95, CLIM_JOUR, { nl: 1, mots: "clim 1,5 cv 3,5 kw" });
  a("Climatiseur split inverter 18 000 BTU", 1650, 0.95, CLIM_JOUR, { nl: 1, mots: "clim 2 cv 5,3 kw" });
  a("Climatiseur split inverter 24 000 BTU", 2250, 0.95, CLIM_JOUR, { nl: 1, mots: "clim 2,5 cv 7 kw" });
  a("Climatiseur split classique 9 000 BTU (non inverter)", 950, 0.85, CLIM_JOUR, { dem: "direct", mots: "clim on off" });
  a("Climatiseur split classique 12 000 BTU (non inverter)", 1250, 0.85, CLIM_JOUR, { dem: "direct", mots: "clim on off" });
  a("Climatiseur split classique 18 000 BTU (non inverter)", 1900, 0.85, CLIM_JOUR, { dem: "direct", mots: "clim on off" });
  a("Climatiseur split classique 24 000 BTU (non inverter)", 2500, 0.85, CLIM_JOUR, { dem: "direct", mots: "clim on off" });
  a("Climatiseur de chambre inverter 12 000 BTU (nuit)", 1100, 0.95, CLIM_CHAMBRE, { nl: 1, mots: "clim hotel" });
  a("Climatiseur cassette inverter 36 000 BTU", 3300, 0.95, CLIM_JOUR, { nl: 1, mots: "clim plafond" });
  a("Climatiseur armoire 36 000 BTU (triphasé)", 3600, 0.85, [[9, 18, 0.7]], { dem: "direct", tri: 1, mots: "clim colonne" });
  a("Climatiseur armoire 48 000 BTU (triphasé)", 4800, 0.85, [[9, 18, 0.7]], { dem: "direct", tri: 1, mots: "clim colonne" });
  a("Climatiseur armoire 60 000 BTU (triphasé)", 6000, 0.86, [[9, 18, 0.7]], { dem: "direct", tri: 1, mots: "clim colonne" });
  a("Climatiseur de fenêtre 12 000 BTU", 1300, 0.85, CLIM_JOUR, { dem: "direct", mots: "clim window" });
  a("Ventilateur de plafond 75 W", 75, 0.9, [[11, 17, 0.8], [20, 6, 0.6]], { circuit: "prises", mots: "brasseur" });
  a("Ventilateur sur pied 50 W", 50, 0.9, [[12, 17, 0.8], [21, 6, 0.6]], { circuit: "prises" });
  a("Brasseur d'air industriel 400 W", 400, 0.85, [[8, 18, 0.8]], { circuit: "prises", mots: "ventilateur atelier" });
  a("Extracteur d'air 40 W", 40, 0.9, BUREAU, { circuit: "prises", mots: "ventilation vmc" });
  a("Déshumidificateur 300 W", 300, 0.85, [[0, 24, 0.4]], { dem: "direct", circuit: "prises" });
  a("Radiateur électrique 1 000 W", 1000, 1, [[6, 8, 1], [18, 22, 0.8]], { circuit: "specialise", mots: "chauffage convecteur" });
  a("Radiateur électrique 2 000 W", 2000, 1, [[6, 8, 1], [18, 22, 0.8]], { circuit: "specialise", mots: "chauffage convecteur" });
  a("Pompe à chaleur air/eau 3 kW absorbés", 3000, 0.9, [[6, 9, 0.8], [17, 22, 0.8]], { nl: 1, circuit: "specialise", mots: "chauffage pac" });

  categorie = "froid";
  a("Réfrigérateur 150 L (classe A+)", 90, 0.8, [[0, 24, 0.4]], { dem: "direct", mots: "frigo" });
  a("Réfrigérateur combiné 300 L", 150, 0.8, COMPRESSEUR, { dem: "direct", mots: "frigo" });
  a("Réfrigérateur américain 500 L", 250, 0.8, COMPRESSEUR, { dem: "direct", mots: "frigo" });
  a("Congélateur coffre 200 L", 150, 0.8, [[0, 24, 0.5]], { dem: "direct", mots: "congelo" });
  a("Congélateur coffre 400 L", 250, 0.8, [[0, 24, 0.5]], { dem: "direct", mots: "congelo" });
  a("Vitrine réfrigérée à boissons 400 L", 400, 0.8, [[0, 24, 0.6]], { dem: "direct", mots: "frigo boutique" });
  a("Congélateur commercial 500 L", 450, 0.8, [[0, 24, 0.6]], { dem: "direct", mots: "congelo" });
  a("Chambre froide positive 10 m³ (groupe 1,5 kW)", 1500, 0.82, [[0, 24, 0.6]], { dem: "direct" });
  a("Chambre froide négative 10 m³ (groupe 3 kW, triphasé)", 3000, 0.82, [[0, 24, 0.7]], { dem: "direct", tri: 1 });
  a("Machine à glaçons 400 W", 400, 0.8, [[0, 24, 0.6]], { dem: "direct" });
  a("Fontaine à eau réfrigérée 100 W", 100, 0.8, [[8, 18, 0.4]], { dem: "direct" });
  a("Fabrique de pains de glace 3 kW (triphasé)", 3000, 0.82, [[0, 24, 0.8]], { dem: "direct", tri: 1, mots: "glace" });

  categorie = "cuisine";
  a("Four à micro-ondes (1 300 W absorbés)", 1300, 0.95, [[7, 8, 0.15], [12, 13, 0.2], [19, 20, 0.2]], { nl: 1 });
  a("Bouilloire électrique 2 000 W", 2000, 1, [[6, 8, 0.1], [16, 17, 0.1]]);
  a("Cafetière 1 000 W", 1000, 1, [[6, 8, 0.2]]);
  a("Machine à café expresso 1 500 W", 1500, 1, [[6, 9, 0.15]]);
  a("Grille-pain 900 W", 900, 1, [[6, 8, 0.1]]);
  a("Mixeur / blender 500 W", 500, 0.9, [[11, 13, 0.05]]);
  a("Cuiseur à riz 700 W", 700, 1, [[11, 13, 0.4], [18, 20, 0.4]]);
  a("Friteuse 2 000 W", 2000, 1, [[12, 13, 0.3]]);
  a("Hotte aspirante 150 W", 150, 0.9, [[12, 13, 1], [19, 20, 1]]);
  a("Plaque de cuisson électrique 2 feux 3 000 W", 3000, 1, [[11, 13, 0.5], [18, 20, 0.5]], { circuit: "cuisson" });
  a("Table de cuisson à induction 4 feux 7 200 W", 7200, 0.98, [[11, 13, 0.35], [18, 20, 0.35]], { nl: 1, circuit: "cuisson" });
  a("Cuisinière électrique 4 plaques + four 8 kW", 8000, 1, [[11, 13, 0.5], [18, 20, 0.5]], { ku: 0.6, circuit: "cuisson" });
  a("Four électrique encastrable 2 500 W", 2500, 1, [[12, 13, 0.5], [19, 20, 0.5]], { circuit: "specialise" });
  a("Lave-vaisselle 1 800 W", 1800, 0.98, [[20, 22, 0.5]], { circuit: "specialise" });

  categorie = "menager";
  a("Lave-linge 7 kg (2 000 W en chauffe)", 2000, 0.95, [[9, 11, 0.25]], { circuit: "specialise", mots: "machine a laver" });
  a("Lave-linge à l'eau froide 500 W", 500, 0.8, [[9, 11, 0.5]], { circuit: "specialise", mots: "machine a laver" });
  a("Sèche-linge 2 500 W", 2500, 1, [[10, 12, 0.6]], { circuit: "specialise" });
  a("Fer à repasser 1 200 W", 1200, 1, [[18, 19, 0.5]]);
  a("Aspirateur 800 W", 800, 0.9, [[9, 10, 0.3]]);
  a("Sèche-cheveux 1 500 W", 1500, 1, [[7, 8, 0.15]]);
  a("Chauffe-eau électrique 50 L (1 500 W)", 1500, 1, [[5, 7, 0.6], [18, 20, 0.3]], { circuit: "chauffe_eau", mots: "ballon cumulus" });
  a("Chauffe-eau électrique 100 L (2 000 W)", 2000, 1, [[5, 7, 0.7], [18, 20, 0.3]], { circuit: "chauffe_eau", mots: "ballon cumulus" });
  a("Chauffe-eau électrique 200 L (3 000 W)", 3000, 1, [[4, 7, 0.6], [18, 20, 0.3]], { circuit: "chauffe_eau", mots: "ballon cumulus" });
  a("Chauffe-eau instantané 5 500 W", 5500, 1, [[6, 7, 0.3], [19, 20, 0.3]], { circuit: "chauffe_eau", mots: "douche" });
  a("Appoint électrique de chauffe-eau solaire 2 000 W", 2000, 1, [[17, 20, 0.3]], { circuit: "chauffe_eau" });
  a("Téléviseur LED 32 pouces 50 W", 50, 0.95, SOIR, { nl: 1, mots: "tele tv" });
  a("Téléviseur LED 43 pouces 80 W", 80, 0.95, SOIR, { nl: 1, mots: "tele tv" });
  a("Téléviseur LED 55 pouces 120 W", 120, 0.95, SOIR, { nl: 1, mots: "tele tv" });
  a("Décodeur TV / récepteur satellite 20 W", 20, 0.7, SOIR, { nl: 1, mots: "canal parabole" });
  a("Chaîne hi-fi / barre de son 60 W", 60, 0.9, [[19, 22, 0.5]], { nl: 1 });
  a("Console de jeux 150 W", 150, 0.95, [[16, 20, 0.5]], { nl: 1 });
  a("Chargeur de téléphone 10 W", 10, 0.6, [[21, 24, 1]], { nl: 1, mots: "smartphone portable" });
  a("Machine à coudre domestique 100 W", 100, 0.9, [[9, 17, 0.3]]);

  categorie = "info";
  a("Ordinateur portable 65 W", 65, 0.7, [[8, 17, 0.8]], { nl: 1, mots: "pc laptop" });
  a("Ordinateur de bureau avec écran 150 W", 150, 0.95, [[8, 17, 0.8]], { nl: 1, mots: "pc poste" });
  a("Écran d'ordinateur 24 pouces 25 W", 25, 0.9, [[8, 17, 0.8]], { nl: 1 });
  a("Imprimante jet d'encre 25 W", 25, 0.7, [[8, 17, 0.1]], { nl: 1 });
  a("Imprimante laser 600 W (en impression)", 600, 0.95, [[8, 17, 0.1]], { nl: 1 });
  a("Photocopieur multifonction 1 500 W", 1500, 0.95, [[8, 17, 0.15]], { nl: 1, mots: "copieur" });
  a("Serveur informatique 400 W", 400, 0.95, PERMANENT, { nl: 1 });
  a("Baie réseau (commutateurs, routeurs) 150 W", 150, 0.95, PERMANENT, { nl: 1, mots: "switch" });
  a("Box internet / routeur Wi-Fi 15 W", 15, 0.7, PERMANENT, { nl: 1, mots: "modem" });
  a("Terminal internet par satellite 80 W", 80, 0.9, PERMANENT, { nl: 1, mots: "vsat starlink" });
  a("Relais de télécommunications (site rural) 1 500 W", 1500, 0.95, PERMANENT, { nl: 1, mots: "bts antenne" });
  a("Vidéoprojecteur 300 W", 300, 0.95, [[8, 17, 0.3]], { nl: 1 });
  a("Téléphone IP / standard téléphonique 30 W", 30, 0.9, PERMANENT, { nl: 1 });

  categorie = "batiment";
  a("Caméra de surveillance IP 8 W", 8, 0.9, PERMANENT, { nl: 1, mots: "cctv video" });
  a("Enregistreur vidéo NVR 40 W", 40, 0.9, PERMANENT, { nl: 1, mots: "cctv dvr" });
  a("Centrale d'alarme intrusion 20 W", 20, 0.9, PERMANENT, { nl: 1 });
  a("Centrale de détection incendie 30 W", 30, 0.9, PERMANENT, { nl: 1, mots: "ssi" });
  a("Contrôle d'accès / interphone 15 W", 15, 0.9, PERMANENT, { nl: 1, mots: "visiophone" });
  a("Portail motorisé 300 W", 300, 0.85, [[6, 22, 0.02]], { dem: "direct", circuit: "autre" });
  a("VMC (ventilation mécanique) 60 W", 60, 0.9, PERMANENT, { circuit: "autre" });
  a("Clôture électrique 10 W", 10, 0.9, PERMANENT, { nl: 1, circuit: "autre" });
  a("Ascenseur 6 personnes 7,5 kW (variateur, triphasé)", 7500, 0.85, [[7, 20, 0.15]], { eta: 0.88, dem: "variateur", tri: 1, circuit: "moteur" });

  categorie = "eau";
  for (const kw of [0.37, 0.75, 1.1]) {
    const m = moteurAsynchrone(kw, false);
    a(`Pompe de surface ${kwTexte(kw)} kW (${cv(kw)})`, kw * 1000, m.cos, [[7, 9, 1]], { eta: m.eta, dem: "direct", mots: "pompe puits" });
  }
  a("Surpresseur domestique 0,75 kW (1 CV)", 750, 0.9, [[6, 22, 0.15]], { eta: 0.68, dem: "direct", mots: "pompe pression hydrophore" });
  for (const kw of [0.75, 1.5, 2.2]) {
    const m = moteurAsynchrone(kw, false);
    a(`Pompe immergée ${kwTexte(kw)} kW (${cv(kw)})`, kw * 1000, m.cos, [[9, 15, 1]], { eta: m.eta, dem: kw >= 1.5 ? "progressif" : "direct", mots: "pompe forage" });
  }
  for (const kw of [3, 4, 5.5, 7.5, 11, 15, 18.5, 22]) {
    const m = moteurAsynchrone(kw, true);
    a(`Pompe immergée ${kwTexte(kw)} kW (${cv(kw)}, triphasé)`, kw * 1000, m.cos, [[9, 15, 1]], { eta: m.eta, dem: "progressif", tri: 1, mots: "pompe forage" });
  }
  a("Pompe d'irrigation 5,5 kW (7,5 CV, triphasé)", 5500, 0.84, [[6, 10, 1], [16, 18, 1]], { eta: 0.87, dem: "etoile_triangle", tri: 1, mots: "pompe arrosage" });
  a("Pompe de relevage 0,75 kW", 750, 0.9, [[0, 24, 0.05]], { eta: 0.68, dem: "direct", mots: "pompe eaux usees" });
  a("Pompe de piscine 0,75 kW", 750, 0.9, [[9, 17, 1]], { eta: 0.68, dem: "direct", mots: "pompe filtration" });
  a("Pompe doseuse de chlore 50 W", 50, 0.9, [[0, 24, 0.5]], { nl: 1, circuit: "autre" });
  a("Stérilisateur UV pour l'eau 40 W", 40, 0.9, PERMANENT, { nl: 1, circuit: "autre", mots: "potabilisation" });
  a("Unité d'osmose inverse 1,5 kW (pompe haute pression)", 1500, 0.92, [[8, 16, 1]], { eta: 0.74, dem: "progressif", mots: "potabilisation dessalement" });

  categorie = "atelier";
  a("Perceuse 750 W", 750, 0.9, [[8, 17, 0.1]]);
  a("Meuleuse d'angle 2 000 W", 2000, 0.9, [[8, 17, 0.1]], { mots: "disqueuse" });
  a("Scie circulaire 1 800 W", 1800, 0.9, [[8, 17, 0.15]]);
  a("Perceuse à colonne 0,75 kW", 750, 0.9, [[8, 17, 0.2]], { eta: 0.68, dem: "direct", circuit: "moteur" });
  a("Scie à ruban 1,5 kW", 1500, 0.92, [[8, 17, 0.3]], { eta: 0.74, dem: "direct", circuit: "moteur" });
  a("Tour à métaux 3 kW (triphasé)", 3000, 0.82, ATELIER, { eta: 0.85, ku: 0.75, dem: "direct", tri: 1, circuit: "moteur" });
  a("Dégauchisseuse-raboteuse 3 kW (triphasé)", 3000, 0.82, ATELIER, { eta: 0.85, ku: 0.75, dem: "direct", tri: 1, circuit: "moteur", mots: "menuiserie bois" });
  a("Combiné à bois 4 kW (triphasé)", 4000, 0.82, ATELIER, { eta: 0.86, ku: 0.75, dem: "direct", tri: 1, circuit: "moteur", mots: "menuiserie" });
  a("Compresseur d'air 1,5 kW (2 CV)", 1500, 0.92, [[8, 17, 0.4]], { eta: 0.74, ku: 0.75, dem: "direct", circuit: "moteur" });
  a("Compresseur d'air 2,2 kW (3 CV)", 2200, 0.92, [[8, 17, 0.4]], { eta: 0.76, ku: 0.75, dem: "direct", circuit: "moteur" });
  a("Compresseur d'air 4 kW (5,5 CV, triphasé)", 4000, 0.82, [[8, 17, 0.4]], { eta: 0.86, ku: 0.75, dem: "direct", tri: 1, circuit: "moteur" });
  a("Compresseur d'air 7,5 kW (10 CV, triphasé)", 7500, 0.85, [[8, 17, 0.4]], { eta: 0.88, ku: 0.75, dem: "etoile_triangle", tri: 1, circuit: "moteur" });
  a("Poste à souder inverter 160 A (≈ 5 kVA)", 3500, 0.7, [[8, 17, 0.2]], { nl: 1, circuit: "specialise", mots: "soudure arc" });
  a("Poste à souder à transformateur 200 A (≈ 9 kVA)", 4000, 0.45, [[8, 17, 0.15]], { circuit: "specialise", mots: "soudure arc" });
  a("Poste à souder MIG/MAG 250 A (triphasé, ≈ 9 kVA)", 6500, 0.75, [[8, 17, 0.2]], { nl: 1, tri: 1, circuit: "specialise", mots: "soudure semi automatique" });
  a("Bétonnière 0,75 kW", 750, 0.9, [[8, 17, 0.4]], { eta: 0.68, dem: "direct", circuit: "moteur", mots: "chantier" });
  a("Machine à coudre industrielle (moteur 400 W)", 400, 0.8, [[8, 17, 0.4]], { eta: 0.65, dem: "direct", circuit: "atelier", mots: "couture" });
  a("Chargeur de batteries d'atelier 1 kW", 1000, 0.9, [[8, 17, 0.3]], { nl: 1 });

  categorie = "agro";
  a("Moulin à grains monophasé 2,2 kW", 2200, 0.92, [[8, 12, 0.7], [15, 18, 0.7]], { eta: 0.76, ku: 0.8, dem: "direct", mots: "broyeur mais mil" });
  a("Moulin à grains 5,5 kW (triphasé)", 5500, 0.84, [[8, 12, 0.7], [15, 18, 0.7]], { eta: 0.87, ku: 0.8, dem: "etoile_triangle", tri: 1, mots: "broyeur mais mil" });
  a("Moulin à grains 7,5 kW (triphasé)", 7500, 0.85, [[8, 12, 0.7], [15, 18, 0.7]], { eta: 0.88, ku: 0.8, dem: "etoile_triangle", tri: 1, mots: "broyeur mais mil" });
  a("Moulin à grains 11 kW (triphasé)", 11000, 0.85, [[8, 12, 0.7], [15, 18, 0.7]], { eta: 0.89, ku: 0.8, dem: "etoile_triangle", tri: 1, mots: "broyeur mais mil" });
  a("Décortiqueuse à riz 7,5 kW (triphasé)", 7500, 0.85, [[8, 17, 0.6]], { eta: 0.88, ku: 0.8, dem: "etoile_triangle", tri: 1 });
  a("Égreneuse de maïs 2,2 kW", 2200, 0.92, [[8, 12, 0.6]], { eta: 0.76, ku: 0.8, dem: "direct" });
  a("Râpeuse à manioc 4 kW (triphasé)", 4000, 0.82, [[7, 12, 0.6]], { eta: 0.86, ku: 0.8, dem: "direct", tri: 1, mots: "attieke gari" });
  a("Presse à huile 5,5 kW (triphasé)", 5500, 0.84, [[8, 17, 0.6]], { eta: 0.87, ku: 0.8, dem: "etoile_triangle", tri: 1, mots: "karite palme arachide" });
  a("Broyeur à marteaux 7,5 kW (triphasé)", 7500, 0.85, [[8, 17, 0.5]], { eta: 0.88, ku: 0.8, dem: "etoile_triangle", tri: 1, mots: "aliment betail" });
  a("Pétrin à spirale 3 kW (triphasé)", 3000, 0.82, [[3, 7, 0.5]], { eta: 0.85, ku: 0.8, dem: "direct", tri: 1, mots: "boulangerie" });
  a("Four de boulangerie électrique 15 kW (triphasé)", 15000, 1, [[3, 9, 0.6]], { tri: 1, circuit: "cuisson", mots: "pain" });
  a("Séchoir électrique 3 kW (fruits, poisson)", 3000, 1, [[8, 18, 0.7]], { circuit: "specialise", mots: "deshydrateur" });
  a("Couveuse 500 œufs 200 W", 200, 1, [[0, 24, 0.5]], { circuit: "autre", mots: "incubateur poussin" });
  a("Lampe chauffante pour poussins 250 W", 250, 1, [[0, 24, 0.7]], { circuit: "autre", mots: "eleveuse aviculture" });
  a("Tank à lait 1 000 L (groupe 2,2 kW)", 2200, 0.82, [[6, 9, 1], [17, 20, 1]], { dem: "direct", mots: "refroidisseur laiterie" });
  a("Ensacheuse / scelleuse 500 W", 500, 0.95, [[8, 17, 0.5]], { circuit: "atelier", mots: "emballage" });

  categorie = "sante";
  a("Concentrateur d'oxygène 5 L/min (300 W)", 300, 0.9, [[0, 24, 0.5]], { dem: "direct" });
  a("Concentrateur d'oxygène 10 L/min (600 W)", 600, 0.9, [[0, 24, 0.5]], { dem: "direct" });
  a("Autoclave de paillasse 2 kW", 2000, 1, [[10, 12, 0.8]], { circuit: "specialise", mots: "sterilisation" });
  a("Autoclave vertical 4,5 kW", 4500, 1, [[9, 12, 0.7]], { circuit: "specialise", mots: "sterilisation" });
  a("Poupinel (stérilisateur à chaleur sèche) 1,5 kW", 1500, 1, [[9, 12, 0.8]], { mots: "sterilisation" });
  a("Réfrigérateur à vaccins 120 W", 120, 0.8, [[0, 24, 0.4]], { dem: "direct", circuit: "froid", mots: "chaine du froid pev" });
  a("Congélateur à accumulateurs de froid 200 W", 200, 0.8, [[0, 24, 0.5]], { dem: "direct", circuit: "froid", mots: "vaccins" });
  a("Centrifugeuse de laboratoire 300 W", 300, 0.9, [[8, 16, 0.3]]);
  a("Microscope à LED 20 W", 20, 0.9, [[8, 16, 0.6]], { nl: 1 });
  a("Analyseur de biochimie 300 W", 300, 0.95, [[8, 16, 0.5]], { nl: 1, mots: "laboratoire" });
  a("Analyseur d'hématologie 200 W", 200, 0.95, [[8, 16, 0.5]], { nl: 1, mots: "laboratoire nfs" });
  a("Échographe 400 W", 400, 0.95, [[8, 16, 0.5]], { nl: 1 });
  a("Scialytique LED 100 W", 100, 0.9, [[8, 18, 0.5]], { nl: 1, mots: "lampe operatoire bloc" });
  a("Aspirateur de mucosités 200 W", 200, 0.85, [[8, 18, 0.1]]);
  a("Couveuse néonatale 400 W", 400, 1, [[0, 24, 0.6]], { mots: "incubateur bebe" });
  a("Table de réanimation néonatale chauffante 500 W", 500, 1, [[0, 24, 0.3]]);
  a("Lampe de photothérapie 150 W", 150, 0.9, [[0, 24, 0.5]], { nl: 1, mots: "ictere" });
  a("Moniteur de signes vitaux 50 W", 50, 0.9, PERMANENT, { nl: 1, mots: "scope" });
  a("Pousse-seringue 15 W", 15, 0.9, PERMANENT, { nl: 1 });
  a("Fauteuil dentaire avec compresseur 1,5 kW", 1500, 0.85, [[8, 16, 0.3]], { dem: "direct" });
  a("Distillateur d'eau 3 kW", 3000, 1, [[9, 12, 1]], { circuit: "specialise" });
  a("Bain-marie de laboratoire 1 kW", 1000, 1, [[8, 16, 0.4]]);
  a("Incubateur de laboratoire 300 W", 300, 1, [[0, 24, 0.5]], { mots: "etuve" });

  categorie = "commerce";
  a("Caisse enregistreuse / terminal de vente 50 W", 50, 0.9, [[8, 20, 1]], { nl: 1, circuit: "informatique" });
  a("Enseigne lumineuse LED 100 W", 100, 0.95, [[18, 24, 1]], { nl: 1, circuit: "exterieur" });
  a("Balance électronique 10 W", 10, 0.9, [[8, 20, 1]], { nl: 1 });
  a("Distributeur automatique de boissons 400 W", 400, 0.85, [[0, 24, 0.5]], { dem: "direct", circuit: "froid" });
  a("Machine à café professionnelle 2 groupes 3 kW", 3000, 1, [[6, 22, 0.3]], { circuit: "specialise" });
  a("Plancha / grill professionnel 3 kW", 3000, 1, [[11, 14, 0.5], [18, 22, 0.5]], { circuit: "cuisson" });
  a("Four à pizza électrique 6 kW (triphasé)", 6000, 1, [[11, 14, 0.6], [18, 23, 0.6]], { tri: 1, circuit: "cuisson" });
  a("Friteuse professionnelle 6 kW (triphasé)", 6000, 1, [[11, 14, 0.5], [18, 22, 0.5]], { tri: 1, circuit: "cuisson" });
  a("Lave-vaisselle professionnel 6,5 kW (triphasé)", 6500, 0.98, [[13, 15, 0.6], [21, 23, 0.6]], { tri: 1, circuit: "specialise" });
  a("Lave-linge professionnel 10 kg 7 kW (triphasé)", 7000, 0.95, [[8, 16, 0.4]], { tri: 1, circuit: "specialise", mots: "blanchisserie" });
  a("Sèche-linge professionnel 10 kg 6 kW (triphasé)", 6000, 1, [[9, 17, 0.4]], { tri: 1, circuit: "specialise", mots: "blanchisserie" });
  a("Trancheuse 200 W", 200, 0.85, [[8, 20, 0.1]]);
  a("Blender professionnel 1 500 W", 1500, 0.9, [[8, 20, 0.05]]);
  a("Sèche-mains électrique 1 800 W", 1800, 1, [[8, 20, 0.05]]);
  a("Chambre d'hôtel : mini-réfrigérateur 70 W", 70, 0.8, [[0, 24, 0.4]], { dem: "direct", circuit: "froid", mots: "minibar" });

  categorie = "mobilite";
  a("Borne de recharge 3,7 kW (16 A monophasé)", 3700, 0.99, [[22, 6, 0.6]], { nl: 1, mots: "voiture ve irve wallbox" });
  a("Borne de recharge 7,4 kW (32 A monophasé)", 7400, 0.99, [[22, 6, 0.5]], { nl: 1, mots: "voiture ve irve wallbox" });
  a("Borne de recharge 11 kW (16 A triphasé)", 11000, 0.99, [[22, 6, 0.4]], { nl: 1, tri: 1, mots: "voiture ve irve wallbox" });
  a("Borne de recharge 22 kW (32 A triphasé)", 22000, 0.99, [[8, 18, 0.3]], { nl: 1, tri: 1, mots: "voiture ve irve" });
  a("Chargeur de moto ou scooter électrique 600 W", 600, 0.95, [[20, 24, 1]], { nl: 1, circuit: "prises" });
  a("Chargeur de tricycle électrique 1,2 kW", 1200, 0.95, [[20, 2, 1]], { nl: 1, circuit: "prises" });
  a("Chargeur de vélo électrique 150 W", 150, 0.9, [[20, 24, 1]], { nl: 1, circuit: "prises" });
  a("Chargeur de chariot élévateur 3 kW", 3000, 0.9, [[18, 24, 1]], { nl: 1, circuit: "specialise", mots: "clark" });

  categorie = "industrie";
  for (const kw of [0.37, 0.75, 1.5, 2.2]) {
    const m = moteurAsynchrone(kw, false);
    a(`Moteur monophasé ${kwTexte(kw)} kW (${cv(kw)})`, kw * 1000, m.cos, ATELIER, { eta: m.eta, ku: 0.75, dem: "direct" });
  }
  for (const kw of [0.75, 1.5, 2.2, 3, 4, 5.5, 7.5, 11, 15, 18.5, 22, 30, 37, 45, 55, 75]) {
    const m = moteurAsynchrone(kw, true);
    a(`Moteur triphasé ${kwTexte(kw)} kW (${cv(kw)})`, kw * 1000, m.cos, ATELIER, { eta: m.eta, ku: 0.75, dem: m.dem, tri: 1 });
  }
  a("Convoyeur à bande 2,2 kW (triphasé)", 2200, 0.81, [[7, 17, 0.8]], { eta: 0.84, ku: 0.75, dem: "direct", tri: 1 });
  a("Ventilateur industriel 5,5 kW (triphasé)", 5500, 0.84, [[8, 18, 0.9]], { eta: 0.87, ku: 0.8, dem: "etoile_triangle", tri: 1 });
  a("Pont roulant 5 t (7,5 kW, triphasé)", 7500, 0.8, [[7, 17, 0.15]], { eta: 0.85, ku: 0.6, dem: "direct", tri: 1, mots: "levage grue" });
  a("Groupe d'eau glacée 30 kW absorbés (triphasé)", 30000, 0.86, [[8, 18, 0.7]], { dem: "progressif", tri: 1, mots: "chiller climatisation centrale" });
  a("Four électrique industriel 30 kW (triphasé)", 30000, 1, [[7, 17, 0.7]], { tri: 1, circuit: "specialise" });

  // ---------------------------------------------------------------------------
  // Recherche
  // ---------------------------------------------------------------------------

  function sansAccents(t) {
    return String(t).normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/œ/g, "oe");
  }
  function identifiant(nom) {
    const base = sansAccents(nom).replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
    let id = base;
    for (let k = 2; APPAREILS.some((x) => x.id === id); k++) id = `${base}-${k}`;
    return id;
  }
  const SYNONYMES = {
    frigo: "refrigerateur", frigidaire: "refrigerateur", congelo: "congelateur", clim: "climatiseur", climatisation: "climatiseur",
    split: "climatiseur", tele: "televiseur", tv: "televiseur", television: "televiseur", pc: "ordinateur", laptop: "ordinateur",
    ampoule: "led", lampe: "led", eclairage: "led", neon: "tube", soudure: "souder", ve: "borne", voiture: "borne", irve: "borne",
    forage: "immergee", ballon: "chauffe-eau", cumulus: "chauffe-eau", moulin: "moulin", ventilo: "ventilateur", micro: "micro-ondes",
  };
  const textesRecherche = new Map();
  function texteRecherche(x) {
    if (!textesRecherche.has(x.id)) {
      const cat = CATEGORIES.find((c) => c.cle === x.categorie);
      const texte = sansAccents(`${x.nom} ${x.mots} ${cat ? cat.nom : ""}`);
      textesRecherche.set(x.id, `${texte} ${texte.replace(/(\d) (?=\d)/g, "$1")}`); // « 12 000 » et « 12000 »
    }
    return textesRecherche.get(x.id);
  }
  /** Appareils correspondant à tous les mots de la recherche (accents et majuscules ignorés), éventuellement dans une catégorie. */
  function chercher(recherche = "", categorieCherchee = null, limite = Infinity) {
    const mots = sansAccents(recherche).split(/[^a-z0-9,]+/).filter(Boolean);
    const res = [];
    for (const x of APPAREILS) {
      if (categorieCherchee && x.categorie !== categorieCherchee) continue;
      const texte = texteRecherche(x);
      if (mots.every((m) => texte.includes(m) || (SYNONYMES[m] && texte.includes(SYNONYMES[m])))) res.push(x);
      if (res.length >= limite) break;
    }
    return res;
  }

  /** Heures équivalentes de fonctionnement à pleine puissance par jour. */
  function heuresParJour(plages) {
    let h = 0;
    for (const [d, f, t] of plages || []) h += ((f - d + 24) % 24 || (d === f ? 0 : 24)) * t;
    return h;
  }

  /** Récepteur du projet tiré d'un appareil du catalogue. */
  function recepteur(x, quantite = 1) {
    return { nom: x.nom, quantite, puissance_w: x.puissance_w, cos_phi: x.cos_phi, rendement: x.rendement, ku: x.ku,
      plages: x.plages.map((p) => [...p]), moteur: x.moteur, demarrage: x.demarrage, non_lineaire: x.non_lineaire };
  }

  // ---------------------------------------------------------------------------
  // Unités de puissance
  // ---------------------------------------------------------------------------

  const UNITES_PUISSANCE = {
    W: { nom: "W", facteur: 1 },
    kW: { nom: "kW", facteur: 1000 },
    CV: { nom: "CV", facteur: 735.5, aide: "cheval-vapeur : 1 CV = 735,5 W (puissance utile d'un moteur)" },
    HP: { nom: "HP", facteur: 745.7, aide: "horsepower : 1 HP = 745,7 W (puissance utile d'un moteur)" },
    kVA: { nom: "kVA", aide: "puissance apparente de la plaque : P = S · cos φ" },
    A: { nom: "A", aide: "courant de la plaque : P = U · I · cos φ (× √3 en triphasé)" },
  };
  /** Tension d'alimentation d'un appareil : phase-neutre, entre phases (120/240 V) ou composée × √3 (triphasé). */
  function tensionAppareil(reseau, triphase) {
    if (!reseau) return 230;
    if (triphase && reseau.nph === 3) return Math.sqrt(3) * reseau.u_ll;
    if (triphase && reseau.nph === 2) return reseau.u_ll;
    return reseau.u0;
  }
  /**
   * Puissance du moteur de calcul (W) depuis une valeur de plaque : W, kW, CV, HP directement ; kVA et A par le cos φ
   * (et le rendement pour un moteur, dont la puissance saisie est la puissance utile).
   */
  function versWatts(valeur, unite, { cos_phi = 1, rendement = 1, moteur = false, triphase = false, reseau = null } = {}) {
    if (unite === "kVA" || unite === "A") {
      const s = unite === "kVA" ? valeur * 1000 : valeur * tensionAppareil(reseau, triphase);
      return s * cos_phi * (moteur ? rendement : 1);
    }
    return valeur * (UNITES_PUISSANCE[unite] || UNITES_PUISSANCE.W).facteur;
  }
  function depuisWatts(watts, unite, contexte = {}) {
    const unite1 = versWatts(1, unite, contexte);
    return unite1 > 0 ? watts / unite1 : watts;
  }

  // ---------------------------------------------------------------------------
  // Répartition d'appareils en circuits
  // ---------------------------------------------------------------------------

  const ORDRE_TYPES = Object.keys(TYPES_CIRCUITS);
  /**
   * Crée des circuits à partir d'une sélection [{ appareil, quantite }] :
   * - un circuit par appareil pour les usages dédiés (climatisation, cuisson, chauffe-eau, moteurs, bornes, circuits spécialisés) ;
   * - regroupement des autres par usage, jusqu'à la puissance usuelle d'un circuit (et 8 points d'éclairage).
   * reseau : { nph, u0, u_ll } ; famille : « iec » ou « nec » ; numero : numéro du premier circuit créé.
   */
  function repartirEnCircuits(selection, { reseau = { nph: 3, u0: 230, u_ll: 400 }, famille = "iec", numero = 1 } = {}) {
    const parType = new Map();
    for (const { appareil, quantite } of selection) {
      const q = Math.round(Number(quantite));
      if (!appareil || !(q > 0)) continue;
      const type = TYPES_CIRCUITS[appareil.circuit] ? appareil.circuit : "autre";
      if (!parType.has(type)) parType.set(type, []);
      parType.get(type).push({ appareil, quantite: q });
    }
    const echelle = reseau.u0 / 230;
    const circuits = [];
    const nouveau = (type, nom, poly, recepteurs) => {
      const t = TYPES_CIRCUITS[type];
      const triphase = Boolean(poly) && reseau.nph >= 2;
      circuits.push({ nom: `C${numero + circuits.length} ${nom}`, triphase, longueur_m: t.longueur_m, ks: 1, ...presetCircuit(type, famille, triphase), recepteurs });
    };
    // En 120/240 V, les gros appareils dédiés sont alimentés en 240 V entre phases
    const entrePhases = (x, type) => reseau.nph === 2 && TYPES_CIRCUITS[type].dedie && x.puissance_w / (x.moteur ? x.rendement : 1) >= 1500;
    for (const type of ORDRE_TYPES.filter((k) => parType.has(k))) {
      const t = TYPES_CIRCUITS[type];
      const lignes = parType.get(type);
      if (t.dedie) {
        for (const { appareil: x, quantite } of lignes) {
          const nCircuits = Math.min(quantite, 50);
          const court = x.nom.replace(/\s*\((?:triphasé|monophasé)\)\s*$/i, "");
          for (let k = 0; k < nCircuits; k++) {
            const q = k === nCircuits - 1 ? quantite - (nCircuits - 1) : 1;
            nouveau(type, nCircuits > 1 ? `${court} ${k + 1}` : court, x.triphase || entrePhases(x, type), [recepteur(x, q)]);
          }
        }
        continue;
      }
      const pMax = t.p_max_w * echelle;
      const groupes = [];
      let courant = null;
      for (const { appareil: x, quantite } of lignes) {
        const pUnite = (x.puissance_w / x.rendement) * x.ku;
        let reste = quantite;
        while (reste > 0) {
          if (!courant) { courant = { recepteurs: [], p: 0, points: 0, tri: false }; groupes.push(courant); }
          const placeP = Math.floor((pMax - courant.p) / pUnite + 1e-9);
          const placePoints = t.points_max ? t.points_max - courant.points : Infinity;
          let n = Math.min(reste, placeP, placePoints);
          if (n <= 0 && courant.recepteurs.length) { courant = null; continue; }
          n = Math.max(1, n);
          courant.recepteurs.push(recepteur(x, n));
          courant.p += n * pUnite;
          courant.points += n;
          courant.tri = courant.tri || x.triphase;
          reste -= n;
        }
      }
      groupes.forEach((g, k) => nouveau(type, groupes.length > 1 ? `${t.nom} ${k + 1}` : t.nom, g.tri, g.recepteurs));
    }
    return circuits;
  }

  racine.Catalogue = {
    CATEGORIES, APPAREILS, TYPES_CIRCUITS, UNITES_PUISSANCE,
    chercher, heuresParJour, recepteur, presetCircuit, repartirEnCircuits, versWatts, depuisWatts, tensionAppareil, sansAccents,
  };
})(typeof globalThis !== "undefined" ? globalThis : window);
