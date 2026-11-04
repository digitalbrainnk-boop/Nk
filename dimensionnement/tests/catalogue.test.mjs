// Catalogue d'équipements, types de circuits, conversions de puissance et démarrages décalés des moteurs.
// Lancer depuis la racine du dépôt :  node --test dimensionnement/tests/*.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import "../app/moteur.js";
import "../app/catalogue.js";

const M = globalThis.Moteur;
const K = globalThis.Catalogue;
const SITE = { latitude: 7.69, longitude: -5.03, altitude_m: 370, t_amb_max: 38, t_amb_min: 17 };
const proche = (a, b, tol = 1e-6) => assert.ok(Math.abs(a - b) <= tol * Math.max(1, Math.abs(b)), `${a} ≠ ${b}`);

test("catalogue : identifiants uniques, catégories et types de circuits connus, valeurs plausibles", () => {
  assert.ok(K.APPAREILS.length >= 200, `${K.APPAREILS.length} appareils`);
  assert.equal(new Set(K.APPAREILS.map((a) => a.id)).size, K.APPAREILS.length);
  for (const c of K.CATEGORIES) assert.ok(K.APPAREILS.some((a) => a.categorie === c.cle), c.nom);
  for (const a of K.APPAREILS) {
    assert.ok(K.TYPES_CIRCUITS[a.circuit], `${a.nom} : type ${a.circuit}`);
    assert.ok(a.puissance_w > 0 && a.cos_phi > 0 && a.cos_phi <= 1 && a.rendement > 0 && a.rendement <= 1 && a.ku > 0 && a.ku <= 1, a.nom);
    assert.ok(M.MODES_DEMARRAGE[a.demarrage], a.nom);
    assert.ok(K.heuresParJour(a.plages) > 0 && K.heuresParJour(a.plages) <= 24, a.nom);
  }
});

test("catalogue : chaque appareil, seul sur son circuit, passe la validation et le calcul dans les quatre normes", () => {
  for (const referentiel of Object.keys(M.REFERENTIELS)) {
    const reseau = M.normaliser({ referentiel }).reseau;
    const nph = M.RESEAUX[reseau].nph;
    const circuits = K.APPAREILS.map((a, i) => ({ nom: `C${i + 1}`, triphase: a.triphase && nph >= 2, longueur_m: 20, recepteurs: [K.recepteur(a, 1)] }));
    const projet = { referentiel, reseau, systeme: "reseau", site: SITE, circuits, source: { type: "transfo" } };
    assert.deepEqual(M.valider(projet).erreurs, [], referentiel);
    const r = M.executer(projet);
    assert.equal(r.cables.filter((c) => /^C\d+$/.test(c.liaison)).length, K.APPAREILS.length, `${referentiel} : un câble par circuit`);
  }
});

test("répartition automatique : 8 points d'éclairage par circuit, un circuit par climatiseur, moteurs triphasés selon le réseau", () => {
  const trouve = (nom) => K.APPAREILS.find((a) => a.nom === nom);
  const selection = [
    { appareil: trouve("Tube LED 120 cm 18 W"), quantite: 12 },
    { appareil: trouve("Climatiseur split inverter 12 000 BTU"), quantite: 3 },
    { appareil: trouve("Moteur triphasé 5,5 kW (7,5 CV)"), quantite: 1 },
    { appareil: trouve("Chauffe-eau électrique 100 L (2 000 W)"), quantite: 1 },
    { appareil: trouve("Réfrigérateur combiné 300 L"), quantite: 2 },
  ];
  const tri = K.repartirEnCircuits(selection, { reseau: M.RESEAUX["400/230-50"], famille: "iec", numero: 1 });
  const eclairage = tri.filter((c) => c.type === "eclairage");
  assert.deepEqual(eclairage.map((c) => c.recepteurs[0].quantite), [8, 4]);
  assert.ok(eclairage.every((c) => c.eclairage && c.calibre_min === 10 && c.section_min === 1.5));
  assert.equal(tri.filter((c) => c.type === "clim").length, 3);
  assert.equal(tri.find((c) => c.type === "moteur").triphase, true);
  assert.deepEqual(tri.map((c) => c.nom.split(" ")[0]), tri.map((_, i) => `C${i + 1}`));
  const mono = K.repartirEnCircuits(selection, { reseau: M.RESEAUX["230-50"], famille: "iec" });
  assert.ok(mono.every((c) => !c.triphase));
  // 120/240 V : gros appareils dédiés en 240 V entre phases, protections NEC
  const nec = K.repartirEnCircuits(selection, { reseau: M.RESEAUX["240/120-60"], famille: "nec" });
  assert.equal(nec.find((c) => c.type === "chauffe_eau").triphase, true);
  assert.equal(nec.find((c) => c.type === "eclairage").calibre_min, 15);
  assert.equal(nec.find((c) => c.type === "eclairage").section_min, undefined);
  for (const [reseau, referentiel] of [["400/230-50", "nfc15100"], ["240/120-60", "nec"]]) {
    const circuits = reseau === "400/230-50" ? tri : nec;
    assert.deepEqual(M.valider({ referentiel, reseau, site: SITE, circuits }).erreurs, []);
  }
});

test("types de circuits : protections minimales selon la famille de normes et l'alimentation", () => {
  assert.deepEqual(K.presetCircuit("prises", "iec"), { type: "prises", eclairage: false, calibre_min: 20, section_min: 2.5 });
  assert.deepEqual(K.presetCircuit("cuisson", "iec"), { type: "cuisson", eclairage: false, calibre_min: 32, section_min: 6 });
  assert.deepEqual(K.presetCircuit("cuisson", "iec", true), { type: "cuisson", eclairage: false, calibre_min: 20, section_min: 2.5 });
  assert.deepEqual(K.presetCircuit("eclairage", "nec"), { type: "eclairage", eclairage: true, calibre_min: 15 });
  assert.equal(K.presetCircuit("inconnu", "iec"), null);
});

test("conversions de puissance : plaque en A, kVA, CV ou HP vers la puissance du moteur de calcul", () => {
  const tri = M.RESEAUX["400/230-50"];
  proche(K.versWatts(10, "A", { cos_phi: 0.8, reseau: tri }), 1840);
  proche(K.versWatts(10, "A", { cos_phi: 0.8, triphase: true, reseau: tri }), Math.sqrt(3) * 400 * 10 * 0.8);
  proche(K.versWatts(10, "A", { cos_phi: 1, triphase: true, reseau: M.RESEAUX["240/120-60"] }), 2400);
  proche(K.versWatts(2, "CV"), 1471);
  proche(K.versWatts(3, "HP"), 2237.1);
  proche(K.versWatts(1.5, "kW"), 1500);
  // Moteur : la puissance saisie est la puissance utile (absorbée × rendement)
  proche(K.versWatts(5, "kVA", { cos_phi: 0.8, rendement: 0.85, moteur: true }), 3400);
  const contexte = { cos_phi: 0.92, rendement: 0.74, moteur: true, reseau: tri };
  proche(K.depuisWatts(K.versWatts(7.3, "A", contexte), "A", contexte), 7.3);
});

test("recherche : mots-clés, synonymes et nombres écrits avec ou sans espace", () => {
  assert.ok(K.chercher("clim 12000").length >= 3);
  assert.ok(K.chercher("clim 12000").every((a) => a.nom.includes("12 000 BTU")));
  assert.ok(K.chercher("frigo").some((a) => a.nom.startsWith("Réfrigérateur")));
  assert.ok(K.chercher("pompe", "eau").every((a) => a.categorie === "eau"));
  assert.equal(K.chercher("xyzzy").length, 0);
});

test("démarrages décalés : plusieurs moteurs identiques ne démarrent pas ensemble", () => {
  const pompe = K.recepteur(K.APPAREILS.find((a) => a.nom === "Pompe immergée 1,5 kW (2 CV)"), 1);
  const projet = (quantite) => ({ referentiel: "nfc15100", reseau: "400/230-50", systeme: "hybride", site: SITE,
    circuits: [{ nom: "C1 Pompes", longueur_m: 30, recepteurs: [{ ...pompe, quantite }] },
      { nom: "C2 Éclairage", eclairage: true, longueur_m: 20, recepteurs: [{ nom: "LED", quantite: 10, puissance_w: 10, cos_phi: 0.9, plages: [[18, 23, 1]] }] }] });
  const un = M.executer(projet(1));
  const trois = M.executer(projet(3));
  assert.equal(trois.onduleur.s_demarrage_va, un.onduleur.s_demarrage_va, "appel de démarrage d'une seule pompe");
  assert.ok(trois.verifications.some((v) => v.statut === "INFO" && v.message.includes("démarrages décalés")));
  // L'appel du circuit compte une pompe qui démarre et deux qui tournent : la courbe reste compatible
  const disj = trois.cables.find((c) => c.liaison === "C1 Pompes").protection;
  assert.match(disj, /courbe [BCD]/);
});
