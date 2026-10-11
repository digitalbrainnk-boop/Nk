// Tests des référentiels normatifs (NF C 15-100, IEC 60364, BS 7671, NEC), des réseaux,
// de la source réseau, de la compensation (module D) et de la ligne aérienne (module E).
// Lancer depuis la racine du dépôt :  node --test dimensionnement/tests/*.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import "../app/moteur.js";

const { Moteur } = globalThis;
const { outils } = Moteur;

const proche = (a, b, tol, msg = "") => assert.ok(Math.abs(a - b) <= tol, `${msg} : ${a} ≠ ${b} (± ${tol})`);

/** Projet minimal alimenté par le réseau public, sans groupe de secours. */
function projetReseau(referentiel, reseau, circuits, extra = {}) {
  return {
    nom: "Test", systeme: "reseau", referentiel, reseau, site: { t_amb_max: 30 },
    source: { secours: false }, circuits, ...extra,
  };
}
const circuit = (nom, puissance_w, extra = {}, recepteur = {}) => ({
  nom, longueur_m: 5, ...extra,
  recepteurs: [{ nom: "Charge", puissance_w, cos_phi: 1, plages: [[8, 18, 1]], ...recepteur }],
});

test("NEC : charge continue de 40 A → disjoncteur 50 A et 8 AWG (125 %, Table 310.16 col. 75 °C)", () => {
  const r = Moteur.executer(projetReseau("nec", "208/120-60", [circuit("C1 Chauffe-eau", 4800)]));
  const c = r.cables.find((x) => x.liaison === "C1 Chauffe-eau");
  proche(c.i_b_a, 40, 1e-9, "I = 4800 W / 120 V");
  assert.equal(c.protection, "Disj. 50 A");
  assert.equal(c.section, "8 AWG");
  assert.equal(c.pe, "10 AWG", "EGC Table 250.122 pour 50 A");
});

test("NEC 240.4(D) : 16 A continus → 20 A et 12 AWG (14 AWG limité à 15 A)", () => {
  const r = Moteur.executer(projetReseau("nec", "208/120-60", [circuit("C1 Prises", 1920)]));
  const c = r.cables.find((x) => x.liaison === "C1 Prises");
  assert.equal(c.protection, "Disj. 20 A");
  assert.equal(c.section, "12 AWG");
});

test("NEC Art. 430 : moteur 10 HP en 480 V → FLC 14 A, conducteurs 14 AWG, disjoncteur 35 A", () => {
  const moteur = { nom: "Pompe 10 HP", puissance_w: 7457, cos_phi: 0.85, rendement: 0.9, moteur: true, demarrage: "direct", plages: [[8, 12, 1]] };
  const r = Moteur.executer(projetReseau("nec", "480/277-60", [circuit("C1 Pompe", 7457, { triphase: true, longueur_m: 10 }, moteur)]));
  const c = r.cables.find((x) => x.liaison === "C1 Pompe");
  assert.equal(c.protection, "Disj. 35 A (moteur, 430.52)");
  assert.equal(c.section, "14 AWG");
  outils.contexte("nec", "480/277-60");
  assert.equal(outils.flcNEC({ puissance_w: 7457, rendement: 0.9, cos_phi: 0.85 }, true), 14);
});

test("NEC : facteurs de température 310.15(B)(1)(1) et d'ajustement 310.15(C)(1)", () => {
  assert.equal(outils.kTemperatureNEC(40, 75), 0.88);
  assert.equal(outils.kTemperatureNEC(40, 90), 0.91);
  assert.equal(outils.kTemperatureNEC(33, 90), 0.96);
  assert.equal(outils.kTemperatureNEC(30, 90), 1);
  assert.equal(outils.ajustementNEC(3), 1);
  assert.equal(outils.ajustementNEC(6), 0.8);
  assert.equal(outils.ajustementNEC(9), 0.7);
  assert.equal(outils.ajustementNEC(12), 0.5);
});

test("BS 7671 Table 41.3 : Zs max d'un disjoncteur B32 = 1,37 Ω", () => {
  const r = Moteur.executer(projetReseau("bs7671", "400/230-50", [circuit("C1 Cuisinière", 6000)]));
  const c = r.cables.find((x) => x.liaison === "C1 Cuisinière");
  assert.equal(c.protection, "Disj. 32 A courbe B");
  proche(c.zs_max_ohm, 1.37, 0.005, "Zs max B32");
  assert.ok(c.zs_ohm > 0 && c.zs_ohm < c.zs_max_ohm);
  assert.ok(r.verifications.some((v) => v.message.includes("Zs ≤ Zs max (Table 41.3)")));
  assert.ok(r.references.some((x) => x.startsWith("BS 7671")));
});

test("NF C 15-100 : sections usuelles des circuits terminaux sur branchement public 10 kA", () => {
  const r = Moteur.executer(projetReseau("nfc15100", "400/230-50", [
    circuit("C1 Éclairage", 1000, { eclairage: true, longueur_m: 20 }),
    circuit("C2 Prises", 3000, { longueur_m: 20, calibre_min: 16, section_min: 2.5 }),
  ]));
  const c1 = r.cables.find((x) => x.liaison === "C1 Éclairage");
  const c2 = r.cables.find((x) => x.liaison === "C2 Prises");
  assert.equal(c1.section, "1,5 mm²", "la contrainte thermique ne doit pas imposer de grosse section derrière un modulaire");
  assert.equal(c2.protection, "Disj. 16 A courbe B");
  assert.equal(c2.section, "2,5 mm²");
});

test("compensation : 100 kW de cos φ 0,75 à 0,95 → Q_c ≈ 55,3 kvar, batterie automatique", () => {
  const p = projetReseau("iec60364", "400/230-50", [circuit("C1 Atelier", 100000, { triphase: true, longueur_m: 20 }, { cos_phi: 0.75 })]);
  p.hypotheses = { cos_phi_cible: 0.95 };
  const r = Moteur.executer(p);
  proche(r.compensation.qc_var / 1000, 55.32, 0.01, "Q_c");
  assert.ok(r.compensation.necessaire && r.compensation.automatique);
  assert.ok(r.compensation.q_installee_var >= r.compensation.qc_var);
  assert.ok(r.compensation.i_apres_a < r.compensation.i_avant_a);
  assert.ok(r.compensation.h_resonance > 1);
  assert.ok(r.nomenclature.some((x) => x.includes("kvar")));
});

test("compensation : cos φ cible par défaut selon le référentiel (tan φ 0,4 en France)", () => {
  const p = projetReseau("nfc15100", "400/230-50", [circuit("C1", 10000, { triphase: true }, { cos_phi: 0.8 })]);
  assert.equal(Moteur.executer(p).compensation.cos_cible, 0.928);
  p.referentiel = "bs7671";
  assert.equal(Moteur.executer(p).compensation.cos_cible, 0.95);
});

test("ligne aérienne : équation de changement d'état réversible et sens physique", () => {
  const { e_mpa: E, s_porteur: S, alpha, masse_kg_m: m } = Moteur.CONDUCTEURS_AERIENS.torsade_3x70_54;
  const w = m * 9.81;
  const T1 = 2500;
  const T2 = outils.changementEtat(T1, w, 15, w, -10, 40, E, S, alpha);
  proche(outils.changementEtat(T2, w, -10, w, 15, 40, E, S, alpha), T1, 1e-6, "retour à l'état initial");
  assert.ok(T2 > T1, "la tension augmente au froid");
  assert.ok(outils.changementEtat(T1, w, 15, w, 40, 40, E, S, alpha) < T1, "la tension baisse à chaud");
  assert.ok(outils.changementEtat(T1, w, 15, 2 * w, 15, 40, E, S, alpha) > T1, "la tension augmente sous le vent");
});

test("ligne aérienne : flèches, supports, chute de tension et protection de départ", () => {
  const p = Moteur.projetExemple();
  p.systeme = "reseau";
  p.ligne.actif = true;
  const r = Moteur.executer(p);
  const l = r.ligne;
  assert.equal(l.supports.length, p.ligne.portees.length + 1);
  assert.equal(l.supports[0].type, "arrêt");
  assert.ok(l.supports.every((s) => s.classe), "une classe de support pour chaque poteau");
  const aMax = Math.max(...p.ligne.portees.map((x) => x.longueur_m));
  proche(l.fleche_max_m, Math.max(...l.portees.map((x) => x.fleche_chaude_m)), 1e-12, "flèche max");
  assert.ok(l.portees.find((x) => x.longueur_m === aMax).fleche_chaude_m === l.fleche_max_m);
  assert.ok(l.protection_a >= l.i_max_a, "In ≥ I de la ligne");
  assert.ok(l.noeuds.every((n, k) => k === 0 || n.chute_pct > l.noeuds[k - 1].chute_pct), "chute croissante le long de la ligne");
  assert.ok(l.icc_fin_a < l.icc_origine_a);
  assert.equal(l.origine_icc, "réseau");
  // NESC et poteaux bois aux États-Unis, quadruplex par défaut
  p.referentiel = "nec";
  p.reseau = "208/120-60";
  const us = Moteur.executer(p).ligne;
  assert.match(us.climat, /NESC/);
  assert.match(us.conducteur, /Quadruplex/);
  assert.ok(us.supports.every((s) => !s.classe || s.classe.startsWith("classe")));
});

test("réseaux : courants en monophasé 230 V, en 120/240 V à point milieu et en triphasé", () => {
  const p = projetReseau("nec", "240/120-60", [circuit("C1 120 V", 2400), circuit("C2 240 V", 4800, { triphase: true })]);
  const r = Moteur.executer(p);
  proche(r.cables.find((x) => x.liaison === "C1 120 V").i_b_a, 20, 1e-9, "120 V");
  proche(r.cables.find((x) => x.liaison === "C2 240 V").i_b_a, 20, 1e-9, "240 V entre phases");
  assert.equal(r.bilan.s_dim_phase_va.length, 2);
  const mono = projetReseau("iec60364", "230-50", [circuit("C1", 4600)]);
  assert.equal(Moteur.executer(mono).bilan.s_dim_phase_va.length, 1);
  mono.circuits[0].triphase = true;
  assert.throws(() => Moteur.executer(mono), /monophasé/);
});

test("validation : référentiel et réseau incompatibles", () => {
  const p = Moteur.projetExemple();
  p.referentiel = "nec";
  p.reseau = "400/230-50";
  assert.ok(Moteur.valider(p).erreurs.some((e) => e.includes("60 Hz")));
  p.referentiel = "bs7671";
  p.reseau = "208/120-60";
  assert.ok(Moteur.valider(p).erreurs.some((e) => e.includes("50 Hz")));
  // Réseau par défaut selon le référentiel
  assert.equal(Moteur.normaliser({ referentiel: "nec" }).reseau, "208/120-60");
  assert.equal(Moteur.normaliser({}).reseau, "400/230-50");
});

test("source réseau : transformateur choisi dans la gamme, Icc = c·In/(u_k + S/S_kQ)", () => {
  const p = Moteur.projetExemple();
  p.systeme = "reseau";
  p.source = { type: "transfo", secours: false };
  p.circuits.push(circuit("C11 Atelier", 120000, { triphase: true, longueur_m: 30 }, { cos_phi: 0.85 }));
  const r = Moteur.executer(p);
  assert.ok(r.source.s_kva >= r.bilan.s_dim_va / 1000);
  assert.equal(r.source.uk_pct, r.source.s_kva <= 630 ? 4 : 6);
  const iN = (r.source.s_kva * 1000) / (Math.sqrt(3) * 400);
  proche(r.source.icc_max_a, (1.05 * iN) / (r.source.uk_pct / 100 + r.source.s_kva / 1000 / 500), 1e-6, "Icc transformateur");
  assert.equal(r.groupe, null);
  assert.equal(r.cables[0].liaison, "Transformateur → TGBT");
});

test("réseau avec groupe de secours : régime ESP, part secourue, inverseur de source et cuve", () => {
  const p = Moteur.projetExemple();
  p.systeme = "reseau";
  p.source = { secours: true, part_secourue: 0.5, autonomie_h: 12 };
  const r = Moteur.executer(p);
  assert.equal(r.groupe.regime, "ESP (secours)");
  assert.ok(r.groupe.cuve_l > 0);
  assert.ok(r.groupe.inverseur_a >= r.groupe.i_n_a);
  assert.ok(r.cables.some((c) => c.liaison === "Groupe → inverseur de source"));
  assert.ok(r.exploitation.carburant_essais_l_an > 0);
});

test("toutes les combinaisons référentiel × réseau × système se calculent, avec références numérotées", () => {
  let n = 0;
  for (const [ref, R] of Object.entries(Moteur.REFERENTIELS)) {
    for (const [res, N] of Object.entries(Moteur.RESEAUX)) {
      if (N.famille !== R.famille) continue;
      for (const systeme of Object.keys(Moteur.SYSTEMES)) {
        const p = Moteur.projetExemple();
        Object.assign(p, { referentiel: ref, reseau: res, systeme });
        p.ligne.actif = true;
        if (N.nph === 1) p.circuits.forEach((c) => { c.triphase = false; });
        const r = Moteur.executer(p);
        assert.equal(r.synthese.referentiel, R.libelle);
        assert.equal(r.synthese.reseau, N.nom);
        assert.ok(r.cables.length > 0 && r.ligne && r.compensation);
        for (const l of [...r.note, ...r.verifications]) if (l.ref) assert.equal(r.references[l.n - 1], l.ref);
        if (R.famille === "nec") assert.ok(r.cables.every((c) => /AWG|kcmil|—/.test(c.section)), `${ref} ${res} ${systeme} : sections en AWG`);
        else assert.ok(r.cables.every((c) => c.section.endsWith("mm²")), `${ref} ${res} ${systeme} : sections en mm²`);
        n++;
      }
    }
  }
  assert.equal(n, 3 * 4 * 4 + 3 * 4);
});
