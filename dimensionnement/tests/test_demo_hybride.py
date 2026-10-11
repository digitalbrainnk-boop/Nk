"""Tests du démonstrateur : valeurs de référence publiées et invariants physiques.

Lancer depuis le dossier dimensionnement/ :  python3 -m unittest discover -s tests -v
"""

import math
import os
import sys
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import demo_hybride as d  # noqa: E402


class GeometrieSolaire(unittest.TestCase):
    def test_exemple_duffie_beckman_1_10_1(self):
        # φ = 43° N, 15 avril (n = 105) : δ = 9,4°, ωs = 98,9°, H0 = 33,8 MJ/m²
        self.assertAlmostEqual(d.declinaison_deg(105), 9.41, places=2)
        self.assertAlmostEqual(d.angle_coucher_deg(43, d.declinaison_deg(105)), 98.9, places=1)
        self.assertAlmostEqual(d.irradiation_extraterrestre(43, 105) * 3.6, 33.8, delta=0.1)

    def test_plan_horizontal_rb_egal_1(self):
        for lat in (-30, 0, 5.35, 45):
            for n in d.JOURS_TYPES:
                self.assertAlmostEqual(d.rapport_rb(lat, 0, n), 1.0, places=9)

    def test_plan_horizontal_conserve_l_irradiation(self):
        self.assertAlmostEqual(d.irradiation_inclinee(5.0, 0.5, 5.35, 0, 172, 0.2), 5.0, places=9)

    def test_repartition_horaire_normalisee_et_symetrique(self):
        r = d.repartition_horaire(95.0)
        self.assertAlmostEqual(sum(r), 1.0, places=12)
        for h in range(12):
            self.assertAlmostEqual(r[h], r[23 - h], places=12)
        self.assertEqual(r[0], 0.0)


class CablesEtProtections(unittest.TestCase):
    def test_chute_tension_triphasee(self):
        # b = 1, ρ1 = 0,023, λ = 0,08 mΩ/m : 50 A, 100 m, 16 mm², cos φ 0,85 → 6,32 V soit 2,75 % de 230 V
        self.assertAlmostEqual(d.chute_tension_ac(50, 100, 16, 0.85, True), 2.748, places=3)

    def test_monophase_double_la_chute(self):
        tri = d.chute_tension_ac(10, 30, 2.5, 0.9, True)
        mono = d.chute_tension_ac(10, 30, 2.5, 0.9, False)
        self.assertAlmostEqual(mono, 2 * tri, places=12)

    def test_facteur_temperature(self):
        self.assertAlmostEqual(d.k_temperature(40, 70), 0.866, places=3)  # PVC
        self.assertAlmostEqual(d.k_temperature(40), 0.913, places=3)  # PR / XLPE
        self.assertAlmostEqual(d.k_temperature(30), 1.0, places=12)

    def test_section_minimale_satisfait_tous_les_criteres(self):
        res = d.dimensionner_cable(
            i_requis=32, k_correction=0.9, table_iz=d.IZ_CU_PR_E[3], chute_max_pct=3.0,
            chute=lambda s: d.chute_tension_ac(30, 60, s, 0.85, True))
        s = res["section_mm2"]
        i = d.SECTIONS_MM2.index(s)
        self.assertGreaterEqual(d.IZ_CU_PR_E[3][i] * 0.9, 32)
        self.assertLessEqual(d.chute_tension_ac(30, 60, s, 0.85, True), 3.0)
        precedente = d.SECTIONS_MM2[i - 1]
        self.assertTrue(d.IZ_CU_PR_E[3][i - 1] * 0.9 < 32
                        or d.chute_tension_ac(30, 60, precedente, 0.85, True) > 3.0)

    def test_contrainte_thermique(self):
        # 10 kA pendant 0,1 s sur cuivre PR (k = 143) → S ≥ 22,1 mm² → 25 mm²
        res = d.dimensionner_cable(i_requis=1, k_correction=1, table_iz=d.IZ_CU_PR_E[3], chute_max_pct=100,
                                   chute=lambda s: 0.0, contrainte_a_rac_s=10000 * math.sqrt(0.1))
        self.assertEqual(res["section_mm2"], 25)
        self.assertEqual(res["critere_dimensionnant"], "contrainte thermique")


class GroupeElectrogene(unittest.TestCase):
    def test_chute_de_tension_inverse(self):
        # S_GE = x'd·Sd·(1 − d)/d donne exactement la chute d
        x, s_d, chute = 0.2, 30.0, 0.15
        s_ge = x * s_d * (1 - chute) / chute
        self.assertAlmostEqual(x * s_d / (s_ge + x * s_d), chute, places=12)


class Simulation(unittest.TestCase):
    def setUp(self):
        self.params = dict(
            c_kwh=50.0, soc_min=0.2, soc_demarrage=0.25, soc_arret=0.7, eta_rt=0.95, eta_ond=0.94, eta_chg=0.93,
            p_charge_batt_kw=20.0, p_decharge_batt_kw=20.0, p_ond_kw=12.0, p_chargeur_kw=8.0, p_ge_kw=15.0,
            p_ge_assignee_kw=16.0, taux_cible=0.7, taux_min=0.3, conso_a=0.246, conso_b=0.08145)
        charge = [1.0] * 7 + [4.0] * 10 + [2.0] * 7
        pv = [0.0] * 6 + [2.0, 5.0, 8.0, 10.0, 11.0, 11.0, 10.0, 8.0, 5.0, 2.0] + [0.0] * 8
        self.jours = [(charge, [p * f for p in pv]) for f in (1.0, 0.2, 0.1, 0.1, 1.2, 0.3)]

    def test_conservation_de_l_energie(self):
        t = d.simuler(self.jours, soc_initial=0.6, **self.params)
        entrees = t["pv_utilise"] + t["ge"]
        sorties = t["servie"] + t["pertes"] + t["delta_stock"]
        self.assertAlmostEqual(entrees, sorties, places=6)
        self.assertAlmostEqual(t["servie"] + t["non_servie"], t["charge"], places=9)
        self.assertGreater(t["heures_ge"], 0)

    def test_etat_de_charge_reste_dans_les_bornes(self):
        t = d.simuler(self.jours, soc_initial=0.6, **self.params)
        self.assertGreaterEqual(t["soc_mini"], self.params["soc_min"] - 1e-9)
        self.assertTrue(all(h["soc"] <= 1.0 + 1e-9 for h in t["trace"]))

    def test_meteo_synthetique_conserve_les_moyennes_et_le_ciel_clair(self):
        hyp = d.Hypotheses()
        kt = [0.5] * 12
        seq = d.facteurs_meteo(kt, hyp)
        self.assertEqual(len(seq), 365)
        for m in range(12):
            f = [x for mm, x in seq if mm == m]
            self.assertLessEqual(max(f), hyp.kt_ciel_clair / kt[m] + 1e-9)
            self.assertAlmostEqual(sum(f) / len(f), 1.0, delta=0.05)


class CasDeDemonstration(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        args = d.argparse.Namespace(lat=5.35, lon=-4.0, alt=300.0, ghi=None, chimie="lifepo4", autonomie=1.0,
                                    demarrage="progressif")
        site, circuits, hyp = d.cas_demo(args)
        cls.note, cls.res = d.executer(site, circuits, hyp)

    def test_aucune_non_conformite(self):
        self.assertFalse([v.message for v in self.note.verifications if v.statut == "NON CONFORME"])

    def test_consommation_entierement_servie(self):
        self.assertLess(self.res["simulation_annuelle"]["non_servie"], 1e-6)
        self.assertLess(self.res["test_jours_sans_soleil"]["non_servie"], 1e-6)

    def test_champ_pv_dans_les_limites_du_regulateur(self):
        pv, mppt = self.res["pv"], d.RegulateurMPPT()
        cfg = pv["configuration"]
        self.assertLessEqual(pv["ns"] * cfg["voc_froid"], mppt.v_dc_max)
        self.assertGreaterEqual(pv["ns"] * cfg["vmp_chaud"], cfg["v_mppt_min"])
        self.assertLessEqual(pv["np"] * cfg["isc_chaud"], mppt.isc_max)
        self.assertGreaterEqual(pv["p_installee_w"], pv["p_requise_w"])

    def test_groupe_couvre_la_pointe(self):
        ge, bilan = self.res["groupe"], self.res["bilan"]
        self.assertGreaterEqual(ge["s_kva"] * 1000 * ge["k_declassement"], 3 * max(bilan["s_dim_phase_va"]))

    def test_toutes_les_references_sont_numerotees(self):
        refs = {ln.ref for ln in self.note.lignes if ln.ref} | {v.ref for v in self.note.verifications if v.ref}
        self.assertEqual(refs, set(self.note.references))


if __name__ == "__main__":
    unittest.main()
