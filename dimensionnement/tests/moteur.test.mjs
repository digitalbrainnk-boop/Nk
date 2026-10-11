// Tests du moteur JavaScript de l'application.
// Lancer depuis la racine du dépôt :  node --test dimensionnement/tests/
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import "../app/moteur.js";

const ici = path.dirname(fileURLToPath(import.meta.url));
const { Moteur } = globalThis;

function resultatsPython() {
  const dossier = mkdtempSync(path.join(tmpdir(), "dim-"));
  const fichier = path.join(dossier, "r.json");
  try {
    execFileSync("python3", [path.join(ici, "..", "demo_hybride.py"), "--json", fichier], { stdio: "ignore" });
  } catch (e) {
    if (e.code === "ENOENT") return null; // Python absent : la parité n'est pas testée
    throw e;
  }
  return JSON.parse(readFileSync(fichier, "utf8"));
}

const proche = (a, b, tol = 1e-6, msg = "") =>
  assert.ok(Math.abs(a - b) <= tol * Math.max(1, Math.abs(b)), `${msg} : ${a} ≠ ${b}`);

test("parité avec le démonstrateur Python sur le cas de référence", (t) => {
  const py = resultatsPython();
  if (!py) return t.skip("python3 introuvable");
  const js = Moteur.executer(Moteur.projetExemple());

  proche(js.bilan.energie_wh_j, py.bilan.energie_wh_j, 1e-9, "énergie journalière");
  proche(js.bilan.s_dim_va, py.bilan.s_dim_va, 1e-9, "S de dimensionnement");
  js.bilan.s_dim_phase_va.forEach((s, k) => proche(s, py.bilan.s_dim_phase_va[k], 1e-9, `phase ${k + 1}`));
  assert.equal(js.gisement.beta, py.gisement.beta);
  assert.equal(js.gisement.mois_critique, py.gisement.mois_critique);
  js.gisement.ht.forEach((h, m) => proche(h, py.gisement.ht[m], 1e-9, `H_T mois ${m + 1}`));
  proche(js.pv.p_requise_w, py.pv.p_requise_w, 1e-9, "Pc requise");
  for (const k of ["n_modules", "n_mppt", "ns", "np"]) assert.equal(js.pv[k], py.pv[k], k);
  proche(js.batteries.c_installee_kwh, py.batteries.c_installee_kwh, 1e-9, "batteries");
  assert.equal(js.onduleur.s_total_va, py.onduleur.s_total_va);
  assert.equal(js.groupe.s_kva, py.groupe.s_kva);
  for (const [k, v] of Object.entries(py.groupe.criteres_va)) proche(js.groupe.criteres_va[k], v, 1e-9, k);

  const a = js.simulation.annuel;
  const p = py.simulation_annuelle;
  for (const k of ["charge", "pv_dispo", "ge", "carburant", "heures_ge", "demarrages", "pv_ecrete", "non_servie", "decharge_batt"]) {
    proche(a[k], p[k], 1e-6, `simulation ${k}`);
  }
  proche(js.simulation.stress.carburant, py.test_jours_sans_soleil.carburant, 1e-6, "test jours sans soleil");

  assert.equal(js.cables.length, py.cables.length);
  js.cables.forEach((c, i) => {
    assert.equal(c.liaison, py.cables[i].liaison);
    assert.equal(c.section_mm2, py.cables[i].section_mm2, c.liaison);
    assert.equal(c.protection, py.cables[i].protection, c.liaison);
    proche(c.chute_cumulee_pct, py.cables[i].chute_cumulee_pct, 1e-9, c.liaison);
  });
  assert.deepEqual(js.verifications.map((v) => v.statut), py.verifications.map((v) => v.statut));
});

test("conservation de l'énergie dans la simulation annuelle", () => {
  const a = Moteur.executer(Moteur.projetExemple()).simulation.annuel;
  proche(a.pv_utilise + a.ge, a.servie + a.pertes + a.delta_stock, 1e-9, "bilan");
  proche(a.servie + a.non_servie, a.charge, 1e-12, "charge");
});

test("système solaire autonome : pas de groupe, délestage mesuré", () => {
  const p = Moteur.projetExemple();
  p.systeme = "solaire";
  p.hypotheses = { jours_autonomie: 2 };
  const r = Moteur.executer(p);
  assert.equal(r.groupe, null);
  assert.ok(r.pv && r.batteries);
  assert.equal(r.simulation.annuel.heures_ge, 0);
  assert.ok(r.simulation.annuel.llp >= 0 && r.simulation.annuel.llp < 0.05);
  assert.ok(!r.cables.some((c) => c.liaison.startsWith("Groupe")));
  const a = r.simulation.annuel;
  proche(a.pv_utilise, a.servie + a.pertes + a.delta_stock, 1e-9, "bilan solaire");
});

test("groupe seul : critères pointe et démarrage, exploitation et câble groupe → TGBT", () => {
  const p = Moteur.projetExemple();
  p.systeme = "groupe";
  const r = Moteur.executer(p);
  assert.equal(r.pv, null);
  assert.equal(r.simulation, null);
  assert.ok(r.groupe.s_kva >= 3 * Math.max(...r.bilan.s_dim_phase_va) / 1000 / r.groupe.k_declassement);
  assert.ok(!("Recharge batterie à 70 % PRP" in r.groupe.criteres_va));
  assert.ok(r.exploitation.carburant_l_an > 0);
  assert.equal(r.cables[0].liaison, "Groupe → TGBT");
  // Groupe surdimensionné pour la nuit : l'alerte d'encrassement doit apparaître
  assert.ok(r.verifications.some((v) => v.statut === "ATTENTION" && v.message.includes("encrassement")));
});

test("démarrage direct de la pompe : le groupe devient dimensionné par le démarrage", () => {
  const p = Moteur.projetExemple();
  p.circuits[7].recepteurs[0].demarrage = "direct";
  const r = Moteur.executer(p);
  assert.equal(r.groupe.critere, "Démarrage moteur");
  assert.ok(r.verifications.some((v) => v.statut === "NON CONFORME" && v.message.includes("Surcharge de démarrage")));
});

test("gros consommateur : câbles en parallèle au-delà de 300 mm²", () => {
  const p = Moteur.projetExemple();
  p.systeme = "groupe";
  p.circuits = [{ nom: "C1 Atelier", triphase: true, longueur_m: 40,
    recepteurs: [{ nom: "Machines", quantite: 1, puissance_w: 600000, cos_phi: 0.85, plages: [[7, 19, 0.8]] }] }];
  const r = Moteur.executer(p);
  const ge = r.cables.find((c) => c.liaison === "Groupe → TGBT");
  assert.ok(ge.conducteurs_paralleles >= 2, "plusieurs conducteurs par phase");
});

test("validation : messages clairs pour des entrées impossibles", () => {
  const p = Moteur.projetExemple();
  p.site.latitude = 80;
  p.circuits[0].recepteurs[0].cos_phi = 1.5;
  p.circuits[1].recepteurs[0].plages = [[18, 30, 1]];
  const { erreurs } = Moteur.valider(p);
  assert.ok(erreurs.some((e) => e.includes("latitude")));
  assert.ok(erreurs.some((e) => e.includes("cos φ")));
  assert.ok(erreurs.some((e) => e.includes("0 à 24")));
  assert.throws(() => Moteur.executer(p), /latitude/);
});

test("chaque valeur justifiée porte un numéro de référence existant", () => {
  const r = Moteur.executer(Moteur.projetExemple());
  for (const l of [...r.note, ...r.verifications]) {
    if (l.ref) assert.equal(r.references[l.n - 1], l.ref);
  }
});
