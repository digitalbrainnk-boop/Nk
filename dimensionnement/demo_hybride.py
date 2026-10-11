#!/usr/bin/env python3
"""
demo_hybride.py — Démonstrateur de dimensionnement d'un système hybride
========================================================================

Chaîne de calcul complète, en un seul fichier, sans dépendance externe
(bibliothèque standard Python ≥ 3.9 uniquement) :

  Module A  Bilan de puissance du bâtiment (ku, ks, théorème de Boucherot),
            répartition des circuits sur les phases, profil horaire,
            sections de câbles (Iz, ΔU, contrainte thermique), protections,
            vérification du déclenchement en îlotage (onduleur / groupe).
  Module B  Gisement solaire (géométrie solaire + transposition sur plan
            incliné), champ PV (Wc, chaînes série/parallèle vs MPPT),
            parc batteries (LiFePO4 ou plomb OPzV), onduleur/chargeur.
  Module C  Groupe électrogène d'appoint : critères de puissance, démarrage
            moteur (chute de tension transitoire), déclassement, taux de
            charge ISO 8528-1, consommation, courant de court-circuit,
            inverseur de source.
  Simulation horaire annuelle (stratégie « cycle charging ») et test de
            résistance « jours sans soleil ».

Chaque valeur publiée porte un renvoi [Rn] vers sa justification (norme,
formule ou hypothèse) : c'est le principe de la note de calcul opposable.

AVERTISSEMENT
  Outil de démonstration. Les tables embarquées sont des valeurs usuelles à
  vérifier contre l'édition en vigueur des normes (NF C 15-100,
  IEC 60364-5-52, IEC 62548, ISO 8528...) et contre les fiches des
  constructeurs. Une note destinée à un bureau de contrôle doit être validée
  par un ingénieur qualifié.

Usage
  python3 demo_hybride.py
  python3 demo_hybride.py --chimie plomb --autonomie 2
  python3 demo_hybride.py --demarrage direct
  python3 demo_hybride.py --lat 12.37 --lon -1.52 --ghi H1 H2 ... H12   (kWh/m²/j, PVGIS / NASA POWER)
  python3 demo_hybride.py --json resultats.json
"""

from __future__ import annotations

import argparse
import json
import math
import random
from dataclasses import dataclass, field
from typing import Any

# =============================================================================
# 0. TRAÇABILITÉ — NOTE DE CALCUL
# =============================================================================


@dataclass
class Ligne:
    rubrique: str
    libelle: str
    valeur: Any
    unite: str = ""
    ref: str = ""


@dataclass
class Verification:
    statut: str  # "OK", "INFO", "ATTENTION", "NON CONFORME"
    rubrique: str
    message: str
    ref: str = ""


class NoteDeCalcul:
    """Collecte chaque valeur calculée et chaque vérification avec sa justification."""

    def __init__(self) -> None:
        self.lignes: list[Ligne] = []
        self.verifications: list[Verification] = []
        self.references: dict[str, int] = {}

    def _ref(self, ref: str) -> str:
        if not ref:
            return ""
        if ref not in self.references:
            self.references[ref] = len(self.references) + 1
        return f"R{self.references[ref]}"

    def ajouter(self, rubrique: str, libelle: str, valeur: Any, unite: str = "", ref: str = "") -> Any:
        self._ref(ref)
        self.lignes.append(Ligne(rubrique, libelle, valeur, unite, ref))
        return valeur

    def verifier(self, rubrique: str, condition: bool, msg_ok: str, msg_ko: str,
                 ref: str = "", statut_ko: str = "NON CONFORME") -> bool:
        self._ref(ref)
        self.verifications.append(
            Verification("OK" if condition else statut_ko, rubrique, msg_ok if condition else msg_ko, ref))
        return condition

    def info(self, rubrique: str, message: str, ref: str = "") -> None:
        self._ref(ref)
        self.verifications.append(Verification("INFO", rubrique, message, ref))


# =============================================================================
# 1. RÉFÉRENTIEL EMBARQUÉ (valeurs usuelles — à vérifier contre les éditions
#    en vigueur et les fiches constructeurs)
# =============================================================================

R_BOUCHEROT = "Théorème de Boucherot : P et Q s'additionnent séparément, S = √(P² + Q²)"
R_KU_KS = "Guide UTE C 15-105 / pratique Schneider : P = ks · Σ(ku · Pabs)"
R_KS_TABLEAU = "IEC 61439-2 Tab. 101 : facteur de diversité assigné (2-3 circ. 0,9 ; 4-5 : 0,8 ; 6-9 : 0,7 ; ≥10 : 0,6)"
R_IB = "I_B = S/(√3·U) en triphasé ; I_B = S/U0 en monophasé"
R_PROT = "IEC 60364-4-43 §433.1 : I_B ≤ In ≤ Iz et I2 ≤ 1,45·Iz"
R_IZ = "IEC 60364-5-52 Ann. B, méthode E, cuivre PR (XLPE) 90 °C, 30 °C ambiant"
R_KT = "IEC 60364-5-52 Ann. B : k_θ = √((θp − θa)/(θp − θref))"
R_KG = "IEC 60364-5-52 Tab. B.52.17 : facteurs de groupement"
R_DU = "NF C 15-100 §525 / IEC 60364-5-52 Ann. G : ΔU = b(ρ1·L/S·cosφ + λ·L·sinφ)·I_B ; 3 % éclairage, 5 % autres"
R_DU_DC = "Guide UTE C 15-712-1 / IEC 62548 : ΔU = 2ρL·I/S, viser ≤ 1 % (3 % max) côté continu"
R_ADIAB = "IEC 60364-4-43 §434.5.2 : S ≥ I·√t / k (k = 143 Cu-PR, 115 Cu-PVC)"
R_COURBES = "IEC 60898-1 : déclenchement magnétique B 3-5·In, C 5-10·In, D 10-20·In"
R_TCOUP = "IEC 60364-4-41 Tab. 41.1 : coupure ≤ 0,4 s (TN, 230 V, circuits terminaux ≤ 32 A)"
R_ICC = "IEC 60909-0 : facteur de tension c_min = 0,95 ; ρ ≈ 1,5·ρ0 pour Icc mini (UTE C 15-105)"
R_SOL_GEO = "Duffie & Beckman : déclinaison de Cooper, H0 extraterrestre (Gsc = 1367 W/m²)"
R_SOL_DIFF = "Erbs et al. (corrélation mensuelle de la fraction diffuse)"
R_SOL_TRANSPO = "Liu & Jordan (modèle isotrope), Rb mensuel de Klein"
R_SOL_HORAIRE = "Collares-Pereira & Rabl : répartition horaire de l'irradiation journalière"
R_PV_TEMP = "T_cell = T_amb + (NOCT − 20)/800·G ; P = Pstc·(1 + γ·(T_cell − 25))"
R_PV_CHAINES = "IEC 62548 / UTE C 15-712-1 : Voc(Tmin) ≤ Vmax, Vmp(Tmax) ≥ Vmppt,min, Isc(Tmax)·Np ≤ Imax"
R_PV_FUS = "IEC 62548 : protection de chaîne si (Np − 1)·1,25·Isc > I_RM ; 1,5·Isc ≤ In ≤ 2,4·Isc"
R_PV_CABLE = "EN 50618 (H1Z2Z2-K) : câble seul à l'air libre, 60 °C ambiant, âme 120 °C ; I_B = 1,25·Isc"
R_PV_PC = "Pc = E_PV / (PSH · PR) ; PSH = H_T / 1 kW/m²"
R_BATT = "IEEE 1013 / IEEE 1562 : C = E·N_aut·k_vieill·k_T / (η_ond·DoD)"
R_BATT_VIEIL = "IEEE 485 : facteur de vieillissement 1,25 (plomb, fin de vie à 80 %)"
R_ONDULEUR = "S_ond·k_θ ≥ S_pointe·k_e par phase ; surcharge ≥ S_démarrage + S_reste"
R_GE_ISO = "ISO 8528-1 : PRP, puissance moyenne ≤ 70 % (valeurs < 30 % comptées 30 %, arrêts exclus)"
R_GE_DIP = "Chute transitoire ΔU = x'd·Sd/(S_GE + x'd·Sd) ; classes ISO 8528-5 (G2 : 20 %, G3 : 15 %)"
R_GE_DERATE = "ISO 3046-1 / ISO 8528-1 : conditions de référence 25 °C, 100 kPa, 30 % HR ; déclassement selon courbe constructeur"
R_GE_CONSO = "Droite de Willans : F = a·P_sortie + b·P_assignée (a ≈ 0,246 L/kWh, b ≈ 0,0815 L/h/kW)"
R_GE_ICC = "Alternateur : I''k3 = In/x''d ; courant maintenu ≈ 3·In avec excitation AREP/PMG"
R_ATS = "IEC 60947-6-1 : inverseur de source, catégorie AC-33A, 4 pôles en TN-S"
R_HYP = "Hypothèse de conception (paramétrable)"
R_SIM = "Simulation horaire 8760 h, stratégie cycle charging"

U_NOMINALE = 400.0  # V entre phases
U0 = 230.0  # V phase-neutre

SECTIONS_MM2 = [1.5, 2.5, 4, 6, 10, 16, 25, 35, 50, 70, 95, 120, 150, 185, 240, 300]
# IEC 60364-5-52, méthode E (multiconducteur sur chemin de câbles perforé), Cu, PR, 30 °C
IZ_CU_PR_E = {
    3: [23, 31, 42, 54, 75, 100, 127, 158, 192, 246, 298, 346, 399, 456, 538, 621],
    2: [26, 36, 49, 63, 86, 115, 149, 185, 225, 289, 352, 410, 473, 542, 641, 741],
}
# EN 50618 : câble solaire H1Z2Z2-K seul à l'air libre, 60 °C ambiant
SECTIONS_PV = [1.5, 2.5, 4, 6, 10, 16, 25, 35]
IZ_PV = [30, 41, 55, 70, 98, 132, 176, 218]

FACTEURS_GROUPEMENT = {
    "faisceau": {1: 1.00, 2: 0.80, 3: 0.70, 4: 0.65, 5: 0.60, 6: 0.57, 7: 0.54, 8: 0.52, 9: 0.50,
                 12: 0.45, 16: 0.41, 20: 0.38},
    "couche_paroi": {1: 1.00, 2: 0.85, 3: 0.79, 4: 0.75, 5: 0.73, 6: 0.72, 7: 0.72, 8: 0.71, 9: 0.70},
    "couche_chemin_perfore": {1: 1.00, 2: 0.88, 3: 0.82, 4: 0.77, 5: 0.75, 6: 0.73, 7: 0.73, 8: 0.72,
                              9: 0.72},
}

RHO_CU = 0.023  # Ω·mm²/m, ρ1 = 1,25·ρ0 (service normal)
RHO_CU_CC_MIN = 0.028  # Ω·mm²/m, ≈ 1,5·ρ0 (courts-circuits minimaux)
LAMBDA_X = 0.08e-3  # Ω/m, réactance linéique d'un câble BT
K_ADIABATIQUE_CU_PR = 143

CALIBRES_DISJ = [6, 10, 16, 20, 25, 32, 40, 50, 63, 80, 100, 125, 160, 200, 250, 320, 400, 500, 630,
                 800, 1000, 1250, 1600]
CALIBRES_FUSIBLES_DC = [63, 80, 100, 125, 160, 200, 250, 315, 355, 400, 500, 630]
CALIBRES_GPV = [10, 12, 15, 16, 20, 25, 30, 32]
CALIBRES_INVERSEURS = [40, 63, 80, 100, 125, 160, 250, 400, 630, 800, 1000, 1250, 1600, 2000, 2500]
MAGNETIQUE_MAX = {"B": 5, "C": 10, "D": 20}
MAGNETIQUE_MIN = {"B": 3, "C": 5, "D": 10}

# Gamme commerciale indicative de groupes électrogènes (kVA PRP, cos φ 0,8)
GAMME_GE_KVA = [9, 13, 16, 20, 22, 27, 33, 40, 45, 50, 60, 66, 80, 100, 110, 135, 150, 165, 200, 220,
                250, 275, 330, 400, 450, 500, 550, 630, 700, 800, 900, 1000, 1100, 1250, 1400, 1650,
                2000, 2250, 2500]
# Onduleurs/chargeurs monophasés couplables en triphasé (VA assignés à 25 °C)
GAMME_ONDULEURS_VA = [3000, 5000, 8000, 10000, 15000]

# Modes de démarrage des moteurs asynchrones (valeurs typiques)
MODES_DEMARRAGE = {
    "direct": {"id_in": 7.0, "cos_phi_d": 0.35, "libelle": "démarrage direct"},
    "etoile_triangle": {"id_in": 2.5, "cos_phi_d": 0.40, "libelle": "étoile-triangle"},
    "progressif": {"id_in": 3.5, "cos_phi_d": 0.45, "libelle": "démarreur progressif"},
    "variateur": {"id_in": 1.2, "cos_phi_d": 0.85, "libelle": "variateur de vitesse"},
}

CHIMIES = {
    "lifepo4": {
        "nom": "LiFePO4 (lithium fer phosphate)",
        "dod": 0.80, "rendement_aller_retour": 0.95, "facteur_vieillissement": 1.10,
        "coef_temp": 0.0, "c_charge_max": 0.5, "c_decharge_max": 0.5,
        "soc_arret_ge": 0.70,
        "u_cellule": 3.2, "u_charge_cellule": 3.55, "u_min_cellule": 3.0,
        "ah_unite": 100, "r_interne_unite_16s": 0.025,
        "ref": "IEC 62619 (sécurité des accumulateurs Li industriels) ; fiche constructeur",
    },
    "plomb": {
        "nom": "Plomb OPzV (GEL tubulaire, éléments 2 V)",
        "dod": 0.50, "rendement_aller_retour": 0.85, "facteur_vieillissement": 1.25,
        "coef_temp": 0.01, "c_charge_max": 0.15, "c_decharge_max": 0.20,
        "soc_arret_ge": 0.85,
        "u_cellule": 2.0, "u_charge_cellule": 2.40, "u_min_cellule": 1.85,
        "gamme_ah": [200, 250, 300, 350, 420, 490, 600, 800, 1000, 1200, 1500, 2000, 2500, 3000],
        "r_interne_1000ah": 0.00025,
        "ref": R_BATT_VIEIL,
    },
}

JOURS_TYPES = [17, 47, 75, 105, 135, 162, 198, 228, 258, 288, 318, 344]  # jours moyens de Klein
JOURS_PAR_MOIS = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]
MOIS = ["Jan", "Fév", "Mar", "Avr", "Mai", "Juin", "Juil", "Août", "Sep", "Oct", "Nov", "Déc"]
GSC = 1367.0  # W/m², constante solaire


# =============================================================================
# 2. DONNÉES D'ENTRÉE
# =============================================================================


@dataclass
class Site:
    nom: str
    latitude: float
    longitude: float
    altitude_m: float
    t_amb_max: float  # °C, ambiante maximale de conception
    t_amb_min: float  # °C, minimale (Voc max des modules)
    t_amb_jour: float  # °C, moyenne diurne (production PV)
    t_local_ge: float  # °C, température du local groupe
    ghi_mensuel: list[float] | None = None  # kWh/m²/j sur plan horizontal
    albedo: float = 0.20


@dataclass
class Recepteur:
    nom: str
    quantite: int
    puissance_w: float  # moteur : puissance utile ; autres : puissance absorbée
    cos_phi: float
    rendement: float = 1.0
    ku: float = 1.0
    plages: list[tuple[int, int, float]] = field(default_factory=list)  # (début h, fin h, taux de marche)
    moteur: bool = False
    demarrage: str = "direct"


@dataclass
class Circuit:
    nom: str
    recepteurs: list[Recepteur]
    ks: float = 1.0
    triphase: bool = False
    longueur_m: float = 30.0
    eclairage: bool = False
    courbe: str | None = None  # None : choix automatique (B si l'appel de courant le permet)
    calibre_min: float = 10.0  # A, calibre minimal imposé (ex. prises 16 A → 20 A)
    section_min: float = 1.5  # mm², section minimale imposée


@dataclass
class ModulePV:
    nom: str = "Module monocristallin 550 Wc (générique)"
    p_wc: float = 550.0
    vmp: float = 41.9
    imp: float = 13.13
    voc: float = 49.9
    isc: float = 13.98
    coef_p: float = -0.35  # %/°C (approximation aussi utilisée pour Vmp)
    coef_voc: float = -0.27  # %/°C
    coef_isc: float = 0.048  # %/°C
    noct: float = 45.0  # °C
    i_inverse_max: float = 25.0  # A (courant inverse admissible / fusible série max)


@dataclass
class RegulateurMPPT:
    nom: str = "Régulateur MPPT 450 V / 100 A (générique)"
    v_dc_max: float = 450.0
    v_mppt_min: float = 80.0
    v_mppt_max: float = 420.0
    isc_max: float = 40.0  # A par entrée
    i_charge_max: float = 100.0  # A côté batterie


@dataclass
class Hypotheses:
    k_extension: float = 1.2  # réserve d'extension sur la pointe
    # Gisement / PV
    kt_defaut: float = 0.50  # indice de clarté forfaitaire si aucune donnée mesurée
    inclinaison_deg: float | None = None  # None : optimisation sur le mois critique
    inclinaison_min_deg: float = 10.0  # auto-nettoyage par la pluie
    pertes_encrassement: float = 0.03
    pertes_dispersion: float = 0.02
    pertes_cables_dc: float = 0.02
    rendement_mppt: float = 0.98
    degradation_annuelle: float = 0.005
    annees_conception: int = 10
    couverture_mois_critique: float = 1.0
    ratio_pv_mppt_max: float = 1.2
    longueur_chaine_m: float = 30.0
    t_cable_pv: float = 70.0  # °C sous les modules
    # Batteries
    chimie: str = "lifepo4"
    jours_autonomie: float = 1.0
    t_batterie_min: float = 20.0
    longueur_batterie_m: float = 3.0
    # Onduleur / chargeur
    rendement_onduleur: float = 0.94
    rendement_chargeur: float = 0.93
    k_temp_onduleur: float = 0.80  # puissance continue à 40 °C / assignée à 25 °C
    surcharge_onduleur: float = 2.0  # quelques secondes
    k_cc_onduleur: float = 2.0  # courant de court-circuit ≈ k·In
    heures_recharge_cible: float = 5.0
    longueur_onduleur_tgbt_m: float = 5.0
    # Groupe électrogène
    xd_transitoire: float = 0.20
    xd_subtransitoire: float = 0.12
    chute_tension_max: float = 0.15
    k_cc_maintenu_ge: float = 3.0
    altitude_sans_declassement: float = 1000.0
    declassement_altitude_pct_100m: float = 1.0
    temperature_sans_declassement: float = 40.0
    declassement_temp_pct_degc: float = 1.0
    declassement_humidite: float = 0.0
    taux_charge_cible_ge: float = 0.70
    taux_charge_min_ge: float = 0.30
    conso_a: float = 0.246  # L/kWh produit
    conso_b: float = 0.08145  # L/h par kW assigné
    longueur_ge_m: float = 25.0
    # Distribution
    disposition_circuits: str = "couche_chemin_perfore"
    chute_max_eclairage: float = 3.0
    chute_max_autres: float = 5.0
    chute_max_dc: float = 1.0  # batterie et régulateurs
    chute_max_pv: float = 1.5  # chaînes PV (≤ 3 % selon UTE C 15-712-1)
    variabilite_journaliere: float = 0.30  # écart-type relatif de l'irradiation journalière
    autocorrelation_journaliere: float = 0.40  # persistance des séquences nuageuses
    kt_ciel_clair: float = 0.75
    graine_meteo: int = 2026
    jours_stress: int = 4
    facteur_meteo_stress: float = 0.25


# =============================================================================
# 3. OUTILS GÉNÉRIQUES (câbles, protections, courts-circuits)
# =============================================================================


def calibre_superieur(i: float, gamme: list[float]) -> float | None:
    return next((c for c in gamme if c >= i - 1e-9), None)


def k_temperature(t_amb: float, t_ame_max: float = 90.0, t_ref: float = 30.0) -> float:
    """Facteur de correction de température d'un câble (IEC 60364-5-52 Ann. B)."""
    if t_amb >= t_ame_max:
        return 0.0
    return math.sqrt((t_ame_max - t_amb) / (t_ame_max - t_ref))


def facteur_groupement(n: int, disposition: str) -> float:
    table = FACTEURS_GROUPEMENT[disposition]
    cles = sorted(table)
    for c in cles:
        if n <= c:
            return table[c]
    return table[cles[-1]]


def chute_tension_ac(i_b: float, longueur_m: float, section: float, cos_phi: float,
                     triphase: bool, rho: float = RHO_CU) -> float:
    """Chute de tension en % de U0 (NF C 15-100 §525)."""
    b = 1.0 if triphase else 2.0
    sin_phi = math.sqrt(max(0.0, 1.0 - cos_phi ** 2))
    du_v = b * (rho * longueur_m / section * cos_phi + LAMBDA_X * longueur_m * sin_phi) * i_b
    return 100.0 * du_v / U0


def chute_tension_dc(i: float, longueur_m: float, section: float, u: float, rho: float = RHO_CU) -> float:
    return 100.0 * 2.0 * rho * longueur_m * i / section / u


def dimensionner_cable(*, i_requis: float, chute: Any, chute_max_pct: float, k_correction: float,
                       table_iz: list[float], sections: list[float] = SECTIONS_MM2,
                       contrainte_a_rac_s: float = 0.0, k_thermique: float = K_ADIABATIQUE_CU_PR,
                       s_min: float = 1.5) -> dict | None:
    """Plus petite section satisfaisant les trois critères ; renvoie aussi le critère dimensionnant.

    `chute` : fonction section → chute de tension cumulée (%).
    `contrainte_a_rac_s` : max des I·√t des défauts à supporter (A·√s), pour S ≥ I·√t / k.
    """
    s_th_min = contrainte_a_rac_s / k_thermique
    trouves: dict[str, float] = {}
    for s, iz in zip(sections, table_iz):
        if s < s_min:
            continue
        if "courant admissible" not in trouves and iz * k_correction >= i_requis:
            trouves["courant admissible"] = s
        if "chute de tension" not in trouves and chute(s) <= chute_max_pct:
            trouves["chute de tension"] = s
        if "contrainte thermique" not in trouves and s >= s_th_min:
            trouves["contrainte thermique"] = s
    if len(trouves) < 3:
        return None
    critere = max(trouves, key=lambda c: (trouves[c], c == "courant admissible"))
    s = trouves[critere]
    return {
        "section_mm2": s,
        "iz_corrige_a": round(table_iz[sections.index(s)] * k_correction, 1),
        "chute_cumulee_pct": round(chute(s), 2),
        "section_thermique_min_mm2": round(s_th_min, 2),
        "critere_dimensionnant": critere,
    }


def icc_min_fin_ligne(icc_source_a: float, troncons: list[tuple[float, float]]) -> float:
    """Icc phase-neutre minimal en bout de ligne : source + boucle (aller-retour) des tronçons."""
    z = U0 / icc_source_a + sum(RHO_CU_CC_MIN * 2.0 * longueur / section for longueur, section in troncons)
    return 0.95 * U0 / z


# =============================================================================
# 4. MODULE A — BILAN DE PUISSANCE, PHASES, PROFIL HORAIRE
# =============================================================================


def ks_tableau(n_circuits: int) -> float:
    if n_circuits <= 1:
        return 1.0
    if n_circuits <= 3:
        return 0.9
    if n_circuits <= 5:
        return 0.8
    if n_circuits <= 9:
        return 0.7
    return 0.6


def heure_active(h: int, debut: int, fin: int) -> bool:
    if debut == fin:
        return False
    if debut < fin:
        return debut <= h < fin
    return h >= debut or h < fin  # plage à cheval sur minuit


def puissances_recepteur(r: Recepteur) -> tuple[float, float, float]:
    """(P absorbée à pleine charge, P d'utilisation = ku·Pabs, Q d'utilisation) en W / var."""
    p_abs = r.quantite * r.puissance_w / r.rendement
    p = p_abs * r.ku
    return p_abs, p, p * math.tan(math.acos(r.cos_phi))


def profil_recepteur(r: Recepteur) -> tuple[list[float], list[float]]:
    """Profils horaires P et Q (W) d'un récepteur, à partir de ses plages de marche."""
    _, p, q = puissances_recepteur(r)
    taux = [0.0] * 24
    for debut, fin, t in r.plages:
        for h in range(24):
            if heure_active(h, debut, fin):
                taux[h] += t
    return [p * t for t in taux], [q * t for t in taux]


def courant_nominal_moteur(r: Recepteur, triphase: bool) -> float:
    s_va = r.puissance_w / (r.rendement * r.cos_phi)
    return s_va / (math.sqrt(3) * U_NOMINALE) if triphase else s_va / U0


def bilan_puissance(note: NoteDeCalcul, circuits: list[Circuit], hyp: Hypotheses) -> dict:
    rub = "A. Bilan de puissance"
    lignes = []
    for c in circuits:
        p_inst = sum(puissances_recepteur(r)[0] for r in c.recepteurs)
        p = c.ks * sum(puissances_recepteur(r)[1] for r in c.recepteurs)
        q = c.ks * sum(puissances_recepteur(r)[2] for r in c.recepteurs)
        s = math.hypot(p, q)
        i_b = s / (math.sqrt(3) * U_NOMINALE) if c.triphase else s / U0
        prof_p = [0.0] * 24
        prof_q = [0.0] * 24
        for r in c.recepteurs:
            pp, pq = profil_recepteur(r)
            prof_p = [a + b for a, b in zip(prof_p, pp)]
            prof_q = [a + b for a, b in zip(prof_q, pq)]
        lignes.append({"circuit": c, "p_inst_w": p_inst, "p_w": p, "q_var": q, "s_va": s, "i_b_a": i_b,
                       "cos_phi": p / s if s else 1.0, "energie_wh_j": sum(prof_p),
                       "profil_p": prof_p, "profil_q": prof_q, "phase": None})

    # Répartition des circuits monophasés sur les phases (plus gros d'abord vers la phase la moins chargée)
    charge_phase = [0.0, 0.0, 0.0]
    for l in sorted((l for l in lignes if not l["circuit"].triphase), key=lambda l: -l["s_va"]):
        ph = min(range(3), key=lambda k: charge_phase[k])
        l["phase"] = ph
        charge_phase[ph] += l["s_va"]

    n = len(circuits)
    ks_t = ks_tableau(n)
    note.ajouter(rub, "Nombre de circuits au TGBT", n, "", "")
    note.ajouter(rub, "Coefficient de simultanéité du TGBT ks", ks_t, "", R_KS_TABLEAU)

    p_tot = ks_t * sum(l["p_w"] for l in lignes)
    q_tot = ks_t * sum(l["q_var"] for l in lignes)
    s_tot = math.hypot(p_tot, q_tot)

    p_ph = [0.0] * 3
    q_ph = [0.0] * 3
    prof_p_ph = [[0.0] * 24 for _ in range(3)]
    prof_q_ph = [[0.0] * 24 for _ in range(3)]
    for l in lignes:
        phases = [0, 1, 2] if l["circuit"].triphase else [l["phase"]]
        part = 1.0 / len(phases)
        for ph in phases:
            p_ph[ph] += ks_t * l["p_w"] * part
            q_ph[ph] += ks_t * l["q_var"] * part
            for h in range(24):
                prof_p_ph[ph][h] += l["profil_p"][h] * part
                prof_q_ph[ph][h] += l["profil_q"][h] * part
    s_ph_ks = [math.hypot(p_ph[k], q_ph[k]) for k in range(3)]
    s_ph_profil = [max(math.hypot(prof_p_ph[k][h], prof_q_ph[k][h]) for h in range(24)) for k in range(3)]

    prof_p = [sum(prof_p_ph[k][h] for k in range(3)) for h in range(24)]
    prof_q = [sum(prof_q_ph[k][h] for k in range(3)) for h in range(24)]
    h_pointe = max(range(24), key=lambda h: math.hypot(prof_p[h], prof_q[h]))
    s_profil = math.hypot(prof_p[h_pointe], prof_q[h_pointe])
    e_jour = sum(prof_p)

    ke = hyp.k_extension
    s_dim = max(s_tot, s_profil) * ke
    p_dim = max(p_tot, prof_p[h_pointe]) * ke
    s_dim_ph = [max(s_ph_ks[k], s_ph_profil[k]) * ke for k in range(3)]
    i_b_tgbt = max(s_dim_ph) / U0

    note.ajouter(rub, "Puissance active foisonnée (méthode ku·ks)", round(p_tot / 1000, 2), "kW", R_KU_KS)
    note.ajouter(rub, "Puissance réactive foisonnée", round(q_tot / 1000, 2), "kvar", R_BOUCHEROT)
    note.ajouter(rub, "Puissance apparente foisonnée", round(s_tot / 1000, 2), "kVA", R_BOUCHEROT)
    note.ajouter(rub, "cos φ global de l'installation", round(p_tot / s_tot, 3), "", R_BOUCHEROT)
    note.ajouter(rub, f"Pointe du profil horaire (à {h_pointe} h)", round(s_profil / 1000, 2), "kVA", "")
    note.ajouter(rub, "Coefficient d'extension ke", ke, "", R_HYP)
    note.ajouter(rub, "Puissance apparente de dimensionnement", round(s_dim / 1000, 2), "kVA",
                 "S_dim = max(S_ks, S_profil) · ke")
    note.ajouter(rub, "Puissance active de dimensionnement", round(p_dim / 1000, 2), "kW", "")
    for k in range(3):
        note.ajouter(rub, f"Phase L{k + 1} : S de dimensionnement", round(s_dim_ph[k] / 1000, 2), "kVA", "")
    note.ajouter(rub, "Courant d'emploi TGBT (phase la plus chargée)", round(i_b_tgbt, 1), "A", R_IB)
    note.ajouter(rub, "Consommation journalière (profil horaire)", round(e_jour / 1000, 2), "kWh/j", "")
    desequilibre = (max(s_dim_ph) - min(s_dim_ph)) / (sum(s_dim_ph) / 3)
    note.verifier(rub, desequilibre <= 0.25,
                  f"Déséquilibre entre phases {desequilibre:.0%} (≤ 25 %)",
                  f"Déséquilibre entre phases {desequilibre:.0%} > 25 % : revoir la répartition",
                  "", "ATTENTION")

    return {
        "lignes": lignes, "ks_tgbt": ks_t,
        "p_ks_w": p_tot, "q_ks_var": q_tot, "s_ks_va": s_tot,
        "s_profil_va": s_profil, "h_pointe": h_pointe,
        "s_dim_va": s_dim, "p_dim_w": p_dim, "s_dim_phase_va": s_dim_ph, "i_b_tgbt_a": i_b_tgbt,
        "profil_p_w": prof_p, "profil_q_var": prof_q, "energie_wh_j": e_jour,
    }


# =============================================================================
# 5. MODULE B — GISEMENT SOLAIRE
# =============================================================================


def declinaison_deg(n: int) -> float:
    return 23.45 * math.sin(math.radians(360.0 * (284 + n) / 365.0))


def _borne(x: float) -> float:
    return max(-1.0, min(1.0, x))


def angle_coucher_deg(lat: float, decl: float) -> float:
    return math.degrees(math.acos(_borne(-math.tan(math.radians(lat)) * math.tan(math.radians(decl)))))


def irradiation_extraterrestre(lat: float, n: int) -> float:
    """H0 journalier sur plan horizontal (kWh/m²/j)."""
    phi = math.radians(lat)
    d = math.radians(declinaison_deg(n))
    ws = math.radians(angle_coucher_deg(lat, declinaison_deg(n)))
    dr = 1 + 0.033 * math.cos(2 * math.pi * n / 365)
    h0 = 24 * 3600 * GSC / math.pi * dr * (math.cos(phi) * math.cos(d) * math.sin(ws)
                                           + ws * math.sin(phi) * math.sin(d))
    return h0 / 3.6e6


def fraction_diffuse_mensuelle(kt: float, ws_deg: float) -> float:
    k = min(0.8, max(0.3, kt))  # domaine de validité de la corrélation
    if ws_deg <= 81.4:
        return 1.391 - 3.560 * k + 4.189 * k ** 2 - 2.137 * k ** 3
    return 1.311 - 3.022 * k + 3.427 * k ** 2 - 1.821 * k ** 3


def rapport_rb(lat: float, beta: float, n: int) -> float:
    """Rb mensuel moyen d'un plan incliné orienté vers l'équateur."""
    phi = math.radians(lat)
    d = math.radians(declinaison_deg(n))
    b = math.radians(beta)
    phi_e = phi - b if lat >= 0 else phi + b
    ws = math.acos(_borne(-math.tan(phi) * math.tan(d)))
    ws_p = min(ws, math.acos(_borne(-math.tan(phi_e) * math.tan(d))))
    num = math.cos(phi_e) * math.cos(d) * math.sin(ws_p) + ws_p * math.sin(phi_e) * math.sin(d)
    den = math.cos(phi) * math.cos(d) * math.sin(ws) + ws * math.sin(phi) * math.sin(d)
    return num / den


def irradiation_inclinee(h: float, kt: float, lat: float, beta: float, n: int, albedo: float) -> float:
    fd = fraction_diffuse_mensuelle(kt, angle_coucher_deg(lat, declinaison_deg(n)))
    cb = math.cos(math.radians(beta))
    return h * ((1 - fd) * rapport_rb(lat, beta, n) + fd * (1 + cb) / 2 + albedo * (1 - cb) / 2)


def repartition_horaire(ws_deg: float) -> list[float]:
    """Part de l'irradiation journalière reçue à chaque heure solaire (somme = 1)."""
    ws = math.radians(ws_deg)
    a = 0.409 + 0.5016 * math.sin(ws - math.radians(60))
    b = 0.6609 - 0.4767 * math.sin(ws - math.radians(60))
    r = []
    for h in range(24):
        w = math.radians(15.0 * (h + 0.5 - 12))
        if abs(w) >= ws:
            r.append(0.0)
            continue
        rt = math.pi / 24 * (a + b * math.cos(w)) * (math.cos(w) - math.cos(ws)) / (math.sin(ws) - ws * math.cos(ws))
        r.append(max(0.0, rt))
    total = sum(r)
    return [x / total for x in r]


def gisement_solaire(note: NoteDeCalcul, site: Site, hyp: Hypotheses) -> dict:
    rub = "B1. Gisement solaire"
    lat = site.latitude
    h0 = [irradiation_extraterrestre(lat, n) for n in JOURS_TYPES]
    ws = [angle_coucher_deg(lat, declinaison_deg(n)) for n in JOURS_TYPES]
    if site.ghi_mensuel:
        ghi = list(site.ghi_mensuel)
        kt = [g / h for g, h in zip(ghi, h0)]
        note.info(rub, "Irradiation horizontale mensuelle fournie par l'utilisateur", "Base PVGIS / NASA POWER / Meteonorm")
    else:
        kt = [hyp.kt_defaut] * 12
        ghi = [k * h for k, h in zip(kt, h0)]
        note.info(rub, f"Indice de clarté forfaitaire K_T = {hyp.kt_defaut} : remplacer par les données "
                       "mesurées du site (option --ghi, PVGIS ou NASA POWER)", R_HYP)

    def ht(beta: float) -> list[float]:
        return [irradiation_inclinee(ghi[m], kt[m], lat, beta, JOURS_TYPES[m], site.albedo) for m in range(12)]

    if hyp.inclinaison_deg is None:
        candidats = range(int(hyp.inclinaison_min_deg), 61)
        beta = max(candidats, key=lambda b: (round(min(ht(b)), 4), sum(ht(b))))
        ref_beta = "Inclinaison maximisant l'irradiation du mois le plus défavorable (≥ 10° : auto-nettoyage)"
    else:
        beta = hyp.inclinaison_deg
        ref_beta = R_HYP
    h_t = ht(beta)
    m_crit = min(range(12), key=lambda m: h_t[m])
    orientation = "plein Sud" if lat >= 0 else "plein Nord"

    note.ajouter(rub, "Latitude / longitude", f"{site.latitude:.2f}° / {site.longitude:.2f}°", "", "")
    note.ajouter(rub, "Irradiation extraterrestre H0 (min – max)", f"{min(h0):.2f} – {max(h0):.2f}", "kWh/m²/j",
                 R_SOL_GEO)
    note.ajouter(rub, "Fraction diffuse Hd/H (min – max)",
                 f"{min(fraction_diffuse_mensuelle(kt[m], ws[m]) for m in range(12)):.2f} – "
                 f"{max(fraction_diffuse_mensuelle(kt[m], ws[m]) for m in range(12)):.2f}", "", R_SOL_DIFF)
    note.ajouter(rub, f"Inclinaison retenue ({orientation})", beta, "°", ref_beta)
    note.ajouter(rub, "Irradiation annuelle sur plan incliné",
                 round(sum(h_t[m] * JOURS_PAR_MOIS[m] for m in range(12)), 0), "kWh/m²/an", R_SOL_TRANSPO)
    note.ajouter(rub, f"Mois critique : {MOIS[m_crit]} — PSH", round(h_t[m_crit], 2), "h/j", R_SOL_TRANSPO)

    return {"h0": h0, "ghi": ghi, "kt": kt, "ws": ws, "ht": h_t, "beta": beta, "mois_critique": m_crit,
            "fd": [fraction_diffuse_mensuelle(kt[m], ws[m]) for m in range(12)],
            "rb": [rapport_rb(lat, beta, JOURS_TYPES[m]) for m in range(12)]}


# =============================================================================
# 6. MODULE B — ONDULEUR/CHARGEUR, CHAMP PV, BATTERIES
# =============================================================================


def cellules_serie(u_bus: int, chimie: dict) -> int:
    """Nombre d'éléments en série pour un bus nominal 12/24/48 V (LFP : 4/8/16 ; plomb : 6/12/24)."""
    return {12: 4, 24: 8, 48: 16}[u_bus] if chimie is CHIMIES["lifepo4"] else round(u_bus / 2)


def u_charge_bus(u_bus: int, chimie: dict) -> float:
    return cellules_serie(u_bus, chimie) * chimie["u_charge_cellule"]


def plus_gros_demarrage(circuits: list[Circuit]) -> tuple[Recepteur, Circuit, float] | None:
    """Moteur dont l'appel de puissance au démarrage S_d = (Id/In)·Pu/(η·cos φ) est le plus élevé."""
    moteurs = [(r, c, r.quantite * r.puissance_w / (r.rendement * r.cos_phi) * MODES_DEMARRAGE[r.demarrage]["id_in"])
               for c in circuits for r in c.recepteurs if r.moteur]
    return max(moteurs, key=lambda m: m[2]) if moteurs else None


def dimensionner_onduleur(note: NoteDeCalcul, bilan: dict, circuits: list[Circuit], hyp: Hypotheses) -> dict:
    rub = "B2. Onduleur / chargeur"
    s_ph = max(bilan["s_dim_phase_va"])
    besoin_25c = s_ph / hyp.k_temp_onduleur
    unite = calibre_superieur(besoin_25c, GAMME_ONDULEURS_VA)
    n_par = 1
    if unite is None:
        unite = GAMME_ONDULEURS_VA[-1]
        n_par = math.ceil(besoin_25c / unite)
    s_total = 3 * n_par * unite
    note.ajouter(rub, "Besoin par phase à 40 °C", round(s_ph / 1000, 2), "kVA", R_ONDULEUR)
    note.ajouter(rub, "Facteur de déclassement thermique (40 °C)", hyp.k_temp_onduleur, "", R_HYP)
    note.ajouter(rub, "Onduleur/chargeur retenu",
                 f"3 × {n_par} × {unite / 1000:g} kVA (couplage triphasé)", "", R_ONDULEUR)
    note.ajouter(rub, "Puissance assignée totale", round(s_total / 1000, 1), "kVA", "")

    # Tension du bus continu selon la puissance (règle usuelle : limiter le courant continu)
    p_cont_w = 0.8 * s_total
    u_bus = 12 if p_cont_w <= 1500 else 24 if p_cont_w <= 4000 else 48
    note.ajouter(rub, "Tension nominale du bus continu", u_bus, "V",
                 "Règle usuelle : 12 V ≤ 1,5 kW < 24 V ≤ 4 kW < 48 V")
    if p_cont_w > 50000:
        note.info(rub, "Au-delà de ~50 kW, préférer une batterie haute tension (≥ 200 V) et des PCS dédiés", "")

    # Démarrage du plus gros moteur : surcharge admissible de l'onduleur
    demarrage = plus_gros_demarrage(circuits)
    resultat = {"unite_va": unite, "n_par_phase": n_par, "s_total_va": s_total, "u_bus": u_bus,
                "s_demarrage_va": demarrage[2] if demarrage else 0.0, "moteur": demarrage[0] if demarrage else None}
    if demarrage:
        r, c, s_d = demarrage
        s_marche = r.quantite * r.puissance_w / (r.rendement * r.cos_phi) * r.ku
        part = 3 if c.triphase else 1
        besoin_surcharge = s_ph - s_marche / part + s_d / part
        capacite = hyp.surcharge_onduleur * unite * n_par
        note.ajouter(rub, f"Appel au démarrage moteur ({MODES_DEMARRAGE[r.demarrage]['libelle']})",
                     round(s_d / 1000, 1), "kVA", "S_d = (Id/In) · Pu/(η·cos φ)")
        note.verifier(rub, besoin_surcharge <= capacite,
                      f"Surcharge de démarrage par phase {besoin_surcharge / 1000:.1f} kVA ≤ {capacite / 1000:.1f} kVA",
                      f"Surcharge de démarrage par phase {besoin_surcharge / 1000:.1f} kVA > {capacite / 1000:.1f} kVA : "
                      "démarreur progressif/variateur ou démarrage uniquement sur groupe", R_ONDULEUR)
    return resultat


def configurer_champ(module: ModulePV, mppt: RegulateurMPPT, p_requise_w: float, site: Site,
                     u_charge_bus: float, p_mppt_w: float, ratio_max: float) -> dict:
    t_cell_max = site.t_amb_max + (module.noct - 20) / 800 * 1000
    voc_froid = module.voc * (1 + module.coef_voc / 100 * (site.t_amb_min - 25))
    vmp_froid = module.vmp * (1 + module.coef_p / 100 * (site.t_amb_min - 25))
    vmp_chaud = module.vmp * (1 + module.coef_p / 100 * (t_cell_max - 25))
    isc_chaud = module.isc * (1 + module.coef_isc / 100 * (t_cell_max - 25))
    v_mppt_min = max(mppt.v_mppt_min, u_charge_bus + 5)
    ns_max = min(math.floor(mppt.v_dc_max / voc_froid), math.floor(mppt.v_mppt_max / vmp_froid))
    ns_min = math.ceil(v_mppt_min / vmp_chaud)
    np_max = math.floor(mppt.isc_max / isc_chaud)
    n_requis = math.ceil(p_requise_w / module.p_wc)
    p_max_par_mppt = ratio_max * p_mppt_w

    meilleur = None
    if ns_min <= ns_max and np_max >= 1:
        for n_mppt in range(1, 500):
            for ns in range(ns_max, ns_min - 1, -1):
                for np_ in range(1, np_max + 1):
                    par_mppt = ns * np_
                    if par_mppt * module.p_wc > p_max_par_mppt or n_mppt * par_mppt < n_requis:
                        continue
                    cle = (n_mppt * par_mppt, -ns)
                    if meilleur is None or cle < meilleur[0]:
                        meilleur = (cle, n_mppt, ns, np_)
            if meilleur:
                break
    return {"t_cell_max": t_cell_max, "voc_froid": voc_froid, "vmp_froid": vmp_froid, "vmp_chaud": vmp_chaud,
            "isc_chaud": isc_chaud, "v_mppt_min": v_mppt_min, "ns_min": ns_min, "ns_max": ns_max,
            "np_max": np_max, "n_requis": n_requis,
            "solution": None if meilleur is None else {"n_mppt": meilleur[1], "ns": meilleur[2], "np": meilleur[3]}}


def dimensionner_pv(note: NoteDeCalcul, site: Site, hyp: Hypotheses, bilan: dict, gis: dict, onduleur: dict,
                    chimie: dict, module: ModulePV, mppt: RegulateurMPPT) -> dict:
    rub = "B3. Champ photovoltaïque"
    m = gis["mois_critique"]
    psh = gis["ht"][m]
    ws = gis["ws"][m]
    lever, coucher = 12 - ws / 15, 12 + ws / 15
    prof = bilan["profil_p_w"]
    e_jour = bilan["energie_wh_j"]
    e_direct = sum(prof[h] for h in range(24) if lever + 1 <= h + 0.5 <= coucher - 1)
    f_direct = e_direct / e_jour

    eta_ond = hyp.rendement_onduleur
    eta_rt = chimie["rendement_aller_retour"]
    e_pv = hyp.couverture_mois_critique * (f_direct * e_jour / eta_ond + (1 - f_direct) * e_jour / (eta_ond * eta_rt))

    t_cell_jour = site.t_amb_jour + (module.noct - 20) / 800 * 800
    k_temp = 1 + module.coef_p / 100 * (t_cell_jour - 25)
    k_age = (1 - hyp.degradation_annuelle) ** hyp.annees_conception
    pr = (k_temp * (1 - hyp.pertes_encrassement) * (1 - hyp.pertes_dispersion) * (1 - hyp.pertes_cables_dc)
          * hyp.rendement_mppt * k_age)
    p_requise = e_pv / (psh * pr)

    note.ajouter(rub, "Part de la consommation servie en direct (journée)", f"{f_direct:.0%}", "",
                 "Énergie consommée entre lever + 1 h et coucher − 1 h")
    note.ajouter(rub, "Énergie PV requise (mois critique)", round(e_pv / 1000, 2), "kWh/j",
                 "E_PV = E_dir/η_ond + E_batt/(η_ond·η_batt)")
    note.ajouter(rub, "Température de cellule diurne", round(t_cell_jour, 1), "°C", R_PV_TEMP)
    note.ajouter(rub, "Facteur de température k_θ", round(k_temp, 3), "", R_PV_TEMP)
    note.ajouter(rub, f"Facteur de vieillissement ({hyp.annees_conception} ans)", round(k_age, 3), "", R_HYP)
    note.ajouter(rub, "Ratio de performance côté continu PR", round(pr, 3), "", R_HYP)
    note.ajouter(rub, "Puissance crête requise", round(p_requise / 1000, 2), "kWc", R_PV_PC)

    u_charge = u_charge_bus(onduleur["u_bus"], chimie)
    p_mppt_w = mppt.i_charge_max * cellules_serie(onduleur["u_bus"], chimie) * chimie["u_cellule"]
    cfg = configurer_champ(module, mppt, p_requise, site, u_charge, p_mppt_w, hyp.ratio_pv_mppt_max)
    sol = cfg["solution"]
    if sol is None:
        note.verifier(rub, False, "", "Aucune configuration série/parallèle compatible avec le régulateur", R_PV_CHAINES)
        raise SystemExit("Configuration PV impossible : changer de module ou de régulateur.")

    n_modules = sol["n_mppt"] * sol["ns"] * sol["np"]
    p_installee = n_modules * module.p_wc
    note.ajouter(rub, "Module", module.nom, "", "Fiche constructeur (valeurs typiques)")
    note.ajouter(rub, "Régulateur", f"{sol['n_mppt']} × {mppt.nom}", "", "")
    note.ajouter(rub, "Configuration par régulateur", f"{sol['ns']} en série × {sol['np']} en parallèle", "",
                 R_PV_CHAINES)
    note.ajouter(rub, "Nombre de modules", n_modules, "", "")
    note.ajouter(rub, "Puissance crête installée", round(p_installee / 1000, 2), "kWc", "")

    voc_chaine = sol["ns"] * cfg["voc_froid"]
    vmp_chaine_chaud = sol["ns"] * cfg["vmp_chaud"]
    isc_mppt = sol["np"] * cfg["isc_chaud"]
    note.ajouter(rub, f"Voc chaîne à {site.t_amb_min:g} °C", round(voc_chaine, 1), "V", R_PV_CHAINES)
    note.ajouter(rub, f"Vmp chaîne à {cfg['t_cell_max']:.0f} °C (cellule)", round(vmp_chaine_chaud, 1), "V", R_PV_CHAINES)
    note.verifier(rub, voc_chaine <= mppt.v_dc_max,
                  f"Voc max {voc_chaine:.0f} V ≤ {mppt.v_dc_max:.0f} V admissibles", "Voc max hors limite", R_PV_CHAINES)
    note.verifier(rub, vmp_chaine_chaud >= cfg["v_mppt_min"],
                  f"Vmp à chaud {vmp_chaine_chaud:.0f} V ≥ seuil MPPT {cfg['v_mppt_min']:.0f} V",
                  "Vmp à chaud sous le seuil MPPT", R_PV_CHAINES)
    note.verifier(rub, isc_mppt <= mppt.isc_max,
                  f"Isc par entrée {isc_mppt:.1f} A ≤ {mppt.isc_max:.0f} A", "Isc par entrée trop élevé", R_PV_CHAINES)
    ratio = sol["ns"] * sol["np"] * module.p_wc / p_mppt_w
    note.verifier(rub, ratio <= hyp.ratio_pv_mppt_max,
                  f"Rapport Pc/P_MPPT = {ratio:.2f} (≤ {hyp.ratio_pv_mppt_max})", "Champ trop puissant pour le MPPT",
                  R_HYP, "ATTENTION")
    fusibles = (sol["np"] - 1) * 1.25 * module.isc > module.i_inverse_max
    if fusibles:
        in_fus = calibre_superieur(1.5 * module.isc, CALIBRES_GPV)
        note.verifier(rub, in_fus is not None and in_fus <= min(2.4 * module.isc, module.i_inverse_max),
                      f"Fusibles gPV {in_fus} A requis sur chaque chaîne",
                      "Aucun calibre gPV compatible : réduire le nombre de chaînes en parallèle", R_PV_FUS)
    else:
        note.verifier(rub, True, f"Pas de fusible de chaîne requis ({sol['np']} chaîne(s) par entrée)", "", R_PV_FUS)

    return {"psh": psh, "pr": pr, "k_temp": k_temp, "p_requise_w": p_requise, "p_installee_w": p_installee,
            "n_modules": n_modules, "f_direct": f_direct, "e_pv_wh": e_pv, "u_charge_bus": u_charge,
            "p_mppt_w": p_mppt_w, "configuration": cfg, **sol}


def dimensionner_batteries(note: NoteDeCalcul, hyp: Hypotheses, bilan: dict, onduleur: dict, pv: dict,
                           chimie: dict, mppt: RegulateurMPPT) -> dict:
    rub = "B4. Parc batteries"
    n_cellules = cellules_serie(onduleur["u_bus"], chimie)
    u_nom = n_cellules * chimie["u_cellule"]
    u_min = n_cellules * chimie["u_min_cellule"]

    e_jour = bilan["energie_wh_j"]
    k_t = 1 + chimie["coef_temp"] * max(0.0, 25 - hyp.t_batterie_min)
    c_wh = (e_jour * hyp.jours_autonomie * chimie["facteur_vieillissement"] * k_t
            / (hyp.rendement_onduleur * chimie["dod"]))
    c_ah = c_wh / u_nom

    note.ajouter(rub, "Technologie", chimie["nom"], "", chimie["ref"])
    note.ajouter(rub, "Jours d'autonomie (appoint par groupe)", hyp.jours_autonomie, "j", R_HYP)
    note.ajouter(rub, "Profondeur de décharge DoD", chimie["dod"], "", chimie["ref"])
    note.ajouter(rub, "Facteur de vieillissement", chimie["facteur_vieillissement"], "", chimie["ref"])
    note.ajouter(rub, "Facteur de température", round(k_t, 3), "", R_BATT)
    note.ajouter(rub, "Capacité nominale requise", round(c_wh / 1000, 1), "kWh", R_BATT)
    note.ajouter(rub, "Capacité requise sous la tension nominale", round(c_ah, 0), "Ah", R_BATT)

    if chimie is CHIMIES["lifepo4"]:
        n_par = math.ceil(c_ah / chimie["ah_unite"])
        ah_unite = chimie["ah_unite"]
        r_unite = chimie["r_interne_unite_16s"] * n_cellules / 16
    else:
        n_par = max(1, math.ceil(c_ah / chimie["gamme_ah"][-1]))
        ah_unite = calibre_superieur(c_ah / n_par, chimie["gamme_ah"])
        r_unite = n_cellules * chimie["r_interne_1000ah"] * 1000 / ah_unite

    # Courant de décharge à pleine puissance onduleur (tension mini)
    p_ond_w = 0.8 * onduleur["s_total_va"]
    i_decharge = p_ond_w / (u_min * hyp.rendement_onduleur)
    n_par_min = math.ceil(i_decharge / (chimie["c_decharge_max"] * ah_unite))
    if n_par_min > n_par:
        note.info(rub, f"Nombre de branches porté de {n_par} à {n_par_min} pour le courant de décharge", R_BATT)
        n_par = n_par_min
    if chimie is CHIMIES["lifepo4"]:
        designation = f"{n_par} modules LFP {u_nom:.1f} V – {ah_unite} Ah en parallèle"
    else:
        designation = f"{n_par} branche(s) de {n_cellules} éléments 2 V – {ah_unite} Ah C10"
    c_inst_ah = n_par * ah_unite
    c_inst_kwh = c_inst_ah * u_nom / 1000
    note.ajouter(rub, "Parc retenu", designation, "", "")
    note.ajouter(rub, "Capacité installée", f"{c_inst_ah:.0f} Ah / {c_inst_kwh:.1f} kWh", "", "")
    note.verifier(rub, i_decharge <= chimie["c_decharge_max"] * c_inst_ah,
                  f"Décharge à pleine puissance {i_decharge:.0f} A ≤ {chimie['c_decharge_max']}C ({chimie['c_decharge_max'] * c_inst_ah:.0f} A)",
                  "Courant de décharge excessif", chimie["ref"])

    i_charge_pv = min(pv["n_mppt"] * mppt.i_charge_max, pv["p_installee_w"] * pv["k_temp"] / pv["u_charge_bus"])
    note.verifier(rub, i_charge_pv <= chimie["c_charge_max"] * c_inst_ah,
                  f"Courant de charge PV {i_charge_pv:.0f} A ≤ {chimie['c_charge_max']}C ({chimie['c_charge_max'] * c_inst_ah:.0f} A)",
                  f"Courant de charge PV {i_charge_pv:.0f} A > {chimie['c_charge_max']}C : limiter le courant de charge "
                  "des régulateurs", chimie["ref"], "ATTENTION")
    if chimie is CHIMIES["plomb"]:
        note.verifier(rub, i_charge_pv >= 0.05 * c_inst_ah,
                      f"Courant de charge PV ≥ 0,05·C10 ({0.05 * c_inst_ah:.0f} A) : recharge complète possible",
                      "Courant de charge PV < 0,05·C10 : recharges incomplètes (sulfatation)", chimie["ref"], "ATTENTION")
        note.info(rub, "Plomb en climat chaud : la durée de vie est divisée par ~2 tous les +10 °C au-delà de 25 °C ; "
                       "local ventilé (EN IEC 62485-2) et climatisé recommandé", chimie["ref"])

    icc_batt = u_nom / (r_unite / n_par)
    note.ajouter(rub, "Courant de court-circuit du parc (≈ U/Ri)", round(icc_batt / 1000, 1), "kA",
                 "Pouvoir de coupure continu des protections batterie ≥ Icc")
    return {"u_nom": u_nom, "u_min": u_min, "n_cellules": n_cellules, "c_requise_wh": c_wh,
            "c_installee_ah": c_inst_ah, "c_installee_kwh": c_inst_kwh, "n_par": n_par, "ah_unite": ah_unite,
            "designation": designation, "i_decharge_a": i_decharge, "i_charge_pv_a": i_charge_pv,
            "icc_a": icc_batt}


# =============================================================================
# 7. MODULE C — GROUPE ÉLECTROGÈNE D'APPOINT
# =============================================================================


def dimensionner_groupe(note: NoteDeCalcul, site: Site, hyp: Hypotheses, bilan: dict, gis: dict,
                        onduleur: dict, batt: dict, chimie: dict) -> dict:
    rub = "C. Groupe électrogène"
    # Critère 1 : reprise de toute l'installation (batterie vide ou onduleur en by-pass)
    s1 = 3 * max(bilan["s_dim_phase_va"])
    p1 = bilan["p_dim_w"]
    # Critère 2 : recharge de la batterie pendant la marche, sous 70 % de la PRP
    c_wh = batt["c_installee_kwh"] * 1000
    e_a_recharger = c_wh * (chimie["soc_arret_ge"] - (1 - chimie["dod"] + 0.05))
    p_charge_dc = min(e_a_recharger / hyp.heures_recharge_cible,
                      chimie["c_charge_max"] * batt["c_installee_ah"] * u_charge_bus(onduleur["u_bus"], chimie))
    chargeur_dc = 3 * onduleur["n_par_phase"] * 0.8 * onduleur["unite_va"]
    p_charge_dc = min(p_charge_dc, chargeur_dc)
    p_charge_ac = p_charge_dc / hyp.rendement_chargeur
    ws = gis["ws"][gis["mois_critique"]]
    prof = bilan["profil_p_w"]
    nuit = [h for h in range(24) if not (12 - ws / 15 <= h + 0.5 <= 12 + ws / 15)]
    p_nuit = sum(prof[h] for h in nuit) / len(nuit)
    p2 = (p_nuit + p_charge_ac) / hyp.taux_charge_cible_ge
    # Critère 3 : démarrage du plus gros moteur (chute de tension transitoire)
    s_d = onduleur["s_demarrage_va"]
    d = hyp.chute_tension_max
    s3 = hyp.xd_transitoire * s_d * (1 - d) / d if s_d else 0.0

    criteres = {"Pointe de l'installation": max(s1, p1 / 0.8), "Recharge batterie à 70 % PRP": p2 / 0.8,
                "Démarrage moteur": s3}
    critere = max(criteres, key=criteres.get)
    s_req = criteres[critere]

    k_alt = 1 - hyp.declassement_altitude_pct_100m / 100 * max(0.0, site.altitude_m - hyp.altitude_sans_declassement) / 100
    k_temp = 1 - hyp.declassement_temp_pct_degc / 100 * max(0.0, site.t_local_ge - hyp.temperature_sans_declassement)
    k_hum = 1 - hyp.declassement_humidite
    k_tot = k_alt * k_temp * k_hum
    s_nom_req = s_req / k_tot
    s_ge = calibre_superieur(s_nom_req / 1000, GAMME_GE_KVA)
    if s_ge is None:
        raise SystemExit("Besoin au-delà de la gamme : prévoir des groupes en parallèle.")
    s_ge_va = s_ge * 1000
    p_ge_site_w = 0.8 * s_ge_va * k_tot
    i_n = s_ge_va / (math.sqrt(3) * U_NOMINALE)

    note.ajouter(rub, "Critère 1 — reprise de la pointe", round(criteres["Pointe de l'installation"] / 1000, 1), "kVA",
                 "S ≥ 3·S_phase,max et P ≥ P_dim (cos φ GE = 0,8)")
    note.ajouter(rub, "Puissance de recharge (côté AC)", round(p_charge_ac / 1000, 1), "kW",
                 f"Recharge en {hyp.heures_recharge_cible:g} h, limitée par chargeur et C-rate")
    note.ajouter(rub, "Critère 2 — charge de nuit + recharge à 70 %",
                 round(criteres["Recharge batterie à 70 % PRP"] / 1000, 1), "kVA", R_GE_ISO)
    note.ajouter(rub, "Critère 3 — démarrage moteur", round(s3 / 1000, 1), "kVA", R_GE_DIP)
    note.ajouter(rub, "Critère dimensionnant", critere, "", "")
    note.ajouter(rub, "Déclassement altitude × température × humidité",
                 f"{k_alt:.3f} × {k_temp:.3f} × {k_hum:.3f} = {k_tot:.3f}", "", R_GE_DERATE)
    note.ajouter(rub, "Puissance assignée requise", round(s_nom_req / 1000, 1), "kVA", R_GE_DERATE)
    note.ajouter(rub, "Groupe retenu (puissance PRP)", f"{s_ge:g} kVA / {0.8 * s_ge:g} kW", "", R_GE_ISO)
    note.ajouter(rub, "Puissance disponible sur site", round(p_ge_site_w / 1000, 1), "kW", R_GE_DERATE)
    note.ajouter(rub, "Courant assigné", round(i_n, 1), "A", R_IB)

    if s_d:
        dip = hyp.xd_transitoire * s_d / (s_ge_va * k_tot + hyp.xd_transitoire * s_d)
        note.verifier(rub, dip <= hyp.chute_tension_max,
                      f"Chute de tension au démarrage {dip:.1%} ≤ {hyp.chute_tension_max:.0%}",
                      f"Chute de tension au démarrage {dip:.1%} > {hyp.chute_tension_max:.0%}", R_GE_DIP)
        moteur = onduleur["moteur"]
        p_d = s_d * MODES_DEMARRAGE[moteur.demarrage]["cos_phi_d"]
        p_avant = bilan["p_dim_w"] - moteur.quantite * moteur.puissance_w / moteur.rendement * moteur.ku
        note.verifier(rub, p_avant + p_d <= p_ge_site_w,
                      f"Échelon de charge au démarrage {(p_avant + p_d) / 1000:.1f} kW ≤ {p_ge_site_w / 1000:.1f} kW",
                      f"Échelon {(p_avant + p_d) / 1000:.1f} kW > puissance du moteur thermique : séquencer les démarrages",
                      "ISO 8528-5 : acceptation d'échelon selon la pression moyenne effective", "ATTENTION")

    i_k_sub = i_n / hyp.xd_subtransitoire
    i_k_maint = hyp.k_cc_maintenu_ge * i_n
    note.ajouter(rub, "Icc triphasé subtransitoire I''k3", round(i_k_sub, 0), "A", R_GE_ICC)
    note.ajouter(rub, "Icc maintenu (excitation AREP/PMG)", round(i_k_maint, 0), "A", R_GE_ICC)
    note.ajouter(rub, "Consommation à 75 % de charge",
                 round(hyp.conso_a * 0.75 * 0.8 * s_ge + hyp.conso_b * 0.8 * s_ge, 2), "L/h", R_GE_CONSO)
    in_inv = calibre_superieur(max(i_n, bilan["i_b_tgbt_a"]), CALIBRES_INVERSEURS)
    note.ajouter(rub, "Inverseur de source (si réseau public)", f"{in_inv} A, 4 pôles, AC-33A", "", R_ATS)
    note.info(rub, "Site isolé : le transfert groupe ↔ onduleur est assuré par le relais de transfert de "
                   f"l'onduleur/chargeur, à choisir ≥ {i_n:.0f} A par phase", R_ATS)

    return {"s_kva": s_ge, "p_site_w": p_ge_site_w, "p_assignee_w": 0.8 * s_ge_va, "i_n_a": i_n,
            "k_declassement": k_tot, "critere": critere, "criteres_va": criteres,
            "p_charge_ac_max_w": p_charge_ac, "i_k_sub_a": i_k_sub, "i_k_maintenu_a": i_k_maint}


# =============================================================================
# 8. SIMULATION HORAIRE (stratégie « cycle charging »)
# =============================================================================


def simuler(jours: list[tuple[list[float], list[float]]], *, c_kwh: float, soc_initial: float, soc_min: float,
            soc_demarrage: float, soc_arret: float, eta_rt: float, eta_ond: float, eta_chg: float,
            p_charge_batt_kw: float, p_decharge_batt_kw: float, p_ond_kw: float, p_chargeur_kw: float,
            p_ge_kw: float, p_ge_assignee_kw: float, taux_cible: float, taux_min: float,
            conso_a: float, conso_b: float) -> dict:
    """Bilan énergétique heure par heure. `jours` : liste de (charge kW[24], PV DC disponible kW[24])."""
    eta_c = eta_d = math.sqrt(eta_rt)
    e = soc_initial * c_kwh
    e_initial = e
    e_min, e_dem, e_arret = soc_min * c_kwh, soc_demarrage * c_kwh, soc_arret * c_kwh
    t = {k: 0.0 for k in ("charge", "servie", "non_servie", "pv_dispo", "pv_utilise", "pv_ecrete", "ge", "carburant",
                          "heures_ge", "demarrages", "heures_ge_faible", "ppa_somme", "decharge_batt", "pertes")}
    soc_mini = 1.0
    ge_on = False
    trace = []
    ge_par_jour = []
    for charge, pv in jours:
        ge_jour = 0.0
        for h in range(24):
            L, pv_dc = charge[h], pv[h]
            t["charge"] += L
            t["pv_dispo"] += pv_dc
            pv_load = min(pv_dc, L / eta_ond, p_ond_kw / eta_ond)
            l_rest = L - pv_load * eta_ond
            pv_rest = pv_dc - pv_load

            if not ge_on and l_rest > 0:
                besoin = l_rest / eta_ond
                if (besoin > (e - e_dem) * eta_d or besoin > p_decharge_batt_kw
                        or L > p_ond_kw):
                    ge_on = True
                    t["demarrages"] += 1

            accept = min(p_charge_batt_kw, max(0.0, (c_kwh - e) / eta_c))
            pv_batt = min(pv_rest, accept)
            accept -= pv_batt
            batt_out = ge_load = ge_ch = ch_dc = non_servi = 0.0
            if ge_on:
                ge_load = min(l_rest, p_ge_kw)
                deficit = l_rest - ge_load
                if deficit > 0:  # assistance batterie si le groupe est insuffisant
                    batt_out = min(deficit / eta_ond, max(0.0, (e - e_min) * eta_d), p_decharge_batt_kw)
                    non_servi = deficit - batt_out * eta_ond
                marge = max(0.0, min(taux_cible * p_ge_kw - ge_load, p_ge_kw - ge_load))
                ch_dc = min(accept, p_chargeur_kw, marge * eta_chg)
                ge_ch = ch_dc / eta_chg
                ge_out = ge_load + ge_ch
                t["ge"] += ge_out
                t["heures_ge"] += 1
                t["carburant"] += conso_a * ge_out + conso_b * p_ge_assignee_kw
                t["ppa_somme"] += max(ge_out, taux_min * p_ge_kw)
                if ge_out < taux_min * p_ge_kw:
                    t["heures_ge_faible"] += 1
            else:
                batt_out = l_rest / eta_ond

            e += (pv_batt + ch_dc) * eta_c - batt_out / eta_d
            soc_mini = min(soc_mini, e / c_kwh)
            servi = L - non_servi
            t["servie"] += servi
            t["non_servie"] += non_servi
            t["pv_utilise"] += pv_load + pv_batt
            t["pv_ecrete"] += pv_rest - pv_batt
            t["decharge_batt"] += batt_out
            t["pertes"] += ((pv_load + batt_out) * (1 - eta_ond) + (pv_batt + ch_dc) * (1 - eta_c)
                            + batt_out * (1 / eta_d - 1) + ge_ch * (1 - eta_chg))
            ge_heure = ge_load + ge_ch if ge_on else 0.0
            ge_jour += ge_heure
            trace.append({"h": h, "charge": L, "pv": pv_dc, "batterie": batt_out - (pv_batt + ch_dc),
                          "ge": ge_heure, "soc": e / c_kwh})
            if ge_on and e >= e_arret:
                ge_on = False
        ge_par_jour.append(ge_jour)

    t["delta_stock"] = e - e_initial
    t["soc_mini"] = soc_mini
    t["ppa"] = t["ppa_somme"] / t["heures_ge"] / p_ge_kw if t["heures_ge"] else 0.0
    t["fraction_renouvelable"] = 1 - t["ge"] / t["servie"] if t["servie"] else 0.0
    t["cycles_equivalents"] = t["decharge_batt"] / (c_kwh * (1 - soc_min))
    t["trace"] = trace
    t["ge_par_jour"] = ge_par_jour
    return t


def preparer_simulation(hyp: Hypotheses, bilan: dict, gis: dict, pv: dict, onduleur: dict, batt: dict,
                        chimie: dict, ge: dict) -> tuple[dict, dict, dict]:
    charge_kw = [p / 1000 for p in bilan["profil_p_w"]]
    pv_mois = []
    for m in range(12):
        rep = repartition_horaire(gis["ws"][m])
        pv_mois.append([pv["p_installee_w"] / 1000 * gis["ht"][m] * pv["pr"] * r for r in rep])
    c_kwh = batt["c_installee_kwh"]
    u_charge = u_charge_bus(onduleur["u_bus"], chimie)
    soc_min = 1 - chimie["dod"]
    params = dict(
        c_kwh=c_kwh, soc_min=soc_min, soc_demarrage=soc_min + 0.05, soc_arret=chimie["soc_arret_ge"],
        eta_rt=chimie["rendement_aller_retour"], eta_ond=hyp.rendement_onduleur, eta_chg=hyp.rendement_chargeur,
        p_charge_batt_kw=chimie["c_charge_max"] * batt["c_installee_ah"] * u_charge / 1000,
        p_decharge_batt_kw=chimie["c_decharge_max"] * batt["c_installee_ah"] * batt["u_min"] / 1000,
        p_ond_kw=0.8 * onduleur["s_total_va"] * hyp.k_temp_onduleur / 1000,
        p_chargeur_kw=ge["p_charge_ac_max_w"] * hyp.rendement_chargeur / 1000,
        p_ge_kw=ge["p_site_w"] / 1000, p_ge_assignee_kw=ge["p_assignee_w"] / 1000,
        taux_cible=hyp.taux_charge_cible_ge, taux_min=hyp.taux_charge_min_ge,
        conso_a=hyp.conso_a, conso_b=hyp.conso_b,
    )
    m_crit = gis["mois_critique"]
    meteo = facteurs_meteo(gis["kt"], hyp)
    jours_annee = [(charge_kw, [p * f for p in pv_mois[m]]) for m, f in meteo]
    annuel = simuler(jours_annee, soc_initial=chimie["soc_arret_ge"], **params)
    # Journée publiée : la plus sollicitante pour le groupe, sinon la plus sombre du mois critique
    if max(annuel["ge_par_jour"]) > 0:
        j = max(range(len(meteo)), key=lambda k: annuel["ge_par_jour"][k])
    else:
        j = min((k for k, (m, _) in enumerate(meteo) if m == m_crit), key=lambda k: meteo[k][1])
    annuel["jour_publie"] = {"jour": j + 1, "mois": MOIS[meteo[j][0]], "facteur_meteo": meteo[j][1],
                             "heures": annuel["trace"][24 * j:24 * j + 24]}
    pv_stress = [p * hyp.facteur_meteo_stress for p in pv_mois[m_crit]]
    stress = simuler([(charge_kw, pv_stress)] * hyp.jours_stress, soc_initial=chimie["soc_arret_ge"], **params)
    return annuel, stress, params


def facteurs_meteo(kt_mensuel: list[float], hyp: Hypotheses) -> list[tuple[int, float]]:
    """Séquence journalière synthétique (mois, facteur) : processus AR(1) à graine fixe.

    Chaque facteur multiplie l'irradiation moyenne du mois ; la moyenne mensuelle est conservée et le
    facteur est borné par le ciel clair (K_T ≈ 0,75). En V1, remplacer par une année type (TMY) mesurée.
    """
    rng = random.Random(hyp.graine_meteo)
    phi, sigma = hyp.autocorrelation_journaliere, hyp.variabilite_journaliere
    z = 0.0
    sequence = []
    for m in range(12):
        f_max = hyp.kt_ciel_clair / kt_mensuel[m]
        bruts = []
        for _ in range(JOURS_PAR_MOIS[m]):
            z = phi * z + math.sqrt(1 - phi ** 2) * rng.gauss(0.0, 1.0)
            bruts.append(min(f_max, max(0.1, 1 + sigma * z)))
        moyenne = sum(bruts) / len(bruts)
        sequence += [(m, min(f_max, f / moyenne)) for f in bruts]
    return sequence


def verifier_simulation(note: NoteDeCalcul, hyp: Hypotheses, annuel: dict, stress: dict) -> None:
    rub = "Simulation"
    note.ajouter(rub, "Profil de production horaire", "365 jours × 24 h", "", R_SOL_HORAIRE)
    note.ajouter(rub, "Variabilité journalière de l'ensoleillement",
                 f"σ = {hyp.variabilite_journaliere:.0%}, persistance {hyp.autocorrelation_journaliere}", "",
                 "Séquence AR(1) à graine fixe, moyenne mensuelle conservée (remplacer par une année type TMY)")
    note.ajouter(rub, "Consommation annuelle", round(annuel["charge"] / 1000, 2), "MWh/an", R_SIM)
    note.ajouter(rub, "Production PV disponible", round(annuel["pv_dispo"] / 1000, 2), "MWh/an", R_SIM)
    note.ajouter(rub, "Énergie PV écrêtée (batterie pleine)", round(annuel["pv_ecrete"] / 1000, 2), "MWh/an", R_SIM)
    note.ajouter(rub, "Production du groupe", round(annuel["ge"] / 1000, 2), "MWh/an", R_SIM)
    note.ajouter(rub, "Fraction renouvelable", f"{annuel['fraction_renouvelable']:.0%}", "",
                 "f_EnR = 1 − E_groupe / E_servie")
    note.ajouter(rub, "Heures de marche du groupe", round(annuel["heures_ge"]), "h/an", R_SIM)
    note.ajouter(rub, "Démarrages du groupe", round(annuel["demarrages"]), "/an", R_SIM)
    note.ajouter(rub, "Carburant consommé", round(annuel["carburant"]), "L/an", R_GE_CONSO)
    note.ajouter(rub, "Cycles équivalents batterie", round(annuel["cycles_equivalents"]), "/an", R_SIM)
    note.ajouter(rub, "État de charge minimal atteint", f"{annuel['soc_mini']:.0%}", "", R_SIM)
    note.verifier(rub, annuel["non_servie"] < 1e-6, "Toute la consommation annuelle est servie",
                  f"Énergie non servie : {annuel['non_servie']:.1f} kWh/an", R_SIM)
    if annuel["heures_ge"]:
        note.verifier(rub, annuel["ppa"] <= 0.70 + 1e-9,
                      f"Puissance moyenne du groupe {annuel['ppa']:.0%} de la PRP (≤ 70 %)",
                      f"Puissance moyenne du groupe {annuel['ppa']:.0%} de la PRP > 70 %", R_GE_ISO)
        faible = annuel["heures_ge_faible"] / annuel["heures_ge"]
        note.verifier(rub, faible <= 0.10,
                      f"Marche sous {hyp.taux_charge_min_ge:.0%} de charge : {faible:.0%} des heures (≤ 10 %)",
                      f"Marche sous {hyp.taux_charge_min_ge:.0%} de charge : {faible:.0%} des heures : risque "
                      "d'encrassement (wet stacking), prévoir banc de charge ou groupe plus petit",
                      "Recommandation constructeurs : ≥ 30 % de charge", "ATTENTION")
    note.ajouter(rub, f"Test {hyp.jours_stress} j à {hyp.facteur_meteo_stress:.0%} d'ensoleillement : groupe",
                 f"{stress['heures_ge'] / hyp.jours_stress:.1f} h/j, {stress['carburant'] / hyp.jours_stress:.0f} L/j",
                 "", R_SIM)
    note.verifier(rub, stress["non_servie"] < 1e-6, "Test « jours sans soleil » : aucune coupure",
                  f"Test « jours sans soleil » : {stress['non_servie']:.1f} kWh non servis", R_SIM)


# =============================================================================
# 9. MODULE A — CÂBLES ET PROTECTIONS (circuits terminaux et liaisons sources)
# =============================================================================


def choisir_courbe(c: Circuit, in_c: float) -> str:
    """Courbe la plus basse compatible avec l'appel de courant (Im,min > 1,2·Id), B par défaut."""
    if c.courbe:
        return c.courbe
    i_appel = max((courant_nominal_moteur(r, c.triphase) * r.quantite * MODES_DEMARRAGE[r.demarrage]["id_in"]
                   for r in c.recepteurs if r.moteur), default=0.0)
    return next((k for k in ("B", "C", "D") if MAGNETIQUE_MIN[k] * in_c > 1.2 * i_appel), "D")


def cables_et_protections(note: NoteDeCalcul, site: Site, hyp: Hypotheses, bilan: dict, onduleur: dict,
                          pv: dict, batt: dict, ge: dict, module: ModulePV, mppt: RegulateurMPPT) -> list[dict]:
    rub = "A. Câbles et protections"
    k_t_ac = k_temperature(site.t_amb_max)
    k_t_dc = k_temperature(hyp.t_batterie_min + 10)
    i_ond = onduleur["n_par_phase"] * onduleur["unite_va"] / U0
    icc_ond = hyp.k_cc_onduleur * i_ond
    icc_max_tgbt = ge["i_k_sub_a"] + icc_ond
    i_rac_t_ac = max(icc_max_tgbt * math.sqrt(0.1), max(icc_ond, ge["i_k_maintenu_a"]) * math.sqrt(5.0))
    res = []

    # Groupe → entrée AC de l'onduleur/chargeur
    in_ge = calibre_superieur(ge["i_n_a"], CALIBRES_DISJ)
    c_ge = dimensionner_cable(
        i_requis=in_ge, k_correction=k_t_ac, table_iz=IZ_CU_PR_E[3], chute_max_pct=1.5,
        chute=lambda s: chute_tension_ac(ge["i_n_a"], hyp.longueur_ge_m, s, 0.8, True), contrainte_a_rac_s=i_rac_t_ac)
    res.append({"liaison": "Groupe → onduleur (AC-in)", "i_b_a": ge["i_n_a"], "protection": f"Disj. 4P {in_ge} A",
                "longueur_m": hyp.longueur_ge_m, **c_ge})

    # Sortie AC des onduleurs → TGBT : peut transiter le courant du groupe (relais de transfert)
    i_b_ond = max(i_ond, ge["i_n_a"])
    in_ond = calibre_superieur(i_b_ond, CALIBRES_DISJ)
    c_ond = dimensionner_cable(
        i_requis=in_ond, k_correction=k_t_ac, table_iz=IZ_CU_PR_E[3], chute_max_pct=1.0,
        chute=lambda s: chute_tension_ac(i_b_ond, hyp.longueur_onduleur_tgbt_m, s, 0.9, True),
        contrainte_a_rac_s=i_rac_t_ac)
    res.append({"liaison": "Onduleurs (AC-out) → TGBT", "i_b_a": i_b_ond, "protection": f"Disj. 4P {in_ond} A",
                "longueur_m": hyp.longueur_onduleur_tgbt_m, **c_ond})
    du_amont = c_ond["chute_cumulee_pct"]

    # Batterie → chaque onduleur (fusible gG : Iz ≥ 1,10·In au-delà de 25 A)
    i_dc = 0.8 * onduleur["unite_va"] / (batt["u_min"] * hyp.rendement_onduleur)
    in_dc = calibre_superieur(1.25 * i_dc, CALIBRES_FUSIBLES_DC)
    c_dc = dimensionner_cable(
        i_requis=in_dc * 1.10, k_correction=k_t_dc, table_iz=IZ_CU_PR_E[2], chute_max_pct=hyp.chute_max_dc,
        chute=lambda s: chute_tension_dc(i_dc, hyp.longueur_batterie_m, s, batt["u_nom"]))
    res.append({"liaison": "Batterie → chaque onduleur (DC)", "i_b_a": i_dc, "protection": f"Fusible DC {in_dc} A",
                "longueur_m": hyp.longueur_batterie_m, **c_dc})

    # Chaînes PV → régulateur
    n_chaines = pv["n_mppt"] * pv["np"]
    i_chaine = 1.25 * module.isc
    k_pv = k_temperature(hyp.t_cable_pv, 120.0, 60.0) * facteur_groupement(n_chaines, "couche_paroi")
    v_chaine = pv["ns"] * module.vmp
    c_pv = dimensionner_cable(
        i_requis=i_chaine, k_correction=k_pv, table_iz=IZ_PV, sections=SECTIONS_PV, chute_max_pct=hyp.chute_max_pv,
        chute=lambda s: chute_tension_dc(module.imp, hyp.longueur_chaine_m, s, v_chaine), s_min=4)
    res.append({"liaison": "Chaîne PV → régulateur (H1Z2Z2-K)", "i_b_a": i_chaine, "protection": "Sectionneur DC",
                "longueur_m": hyp.longueur_chaine_m, **c_pv})

    # Régulateur → batterie
    in_mppt = calibre_superieur(1.25 * mppt.i_charge_max, CALIBRES_FUSIBLES_DC)
    c_mppt = dimensionner_cable(
        i_requis=in_mppt * 1.10, k_correction=k_t_dc, table_iz=IZ_CU_PR_E[2], chute_max_pct=hyp.chute_max_dc,
        chute=lambda s: chute_tension_dc(mppt.i_charge_max, hyp.longueur_batterie_m, s, batt["u_nom"]))
    res.append({"liaison": "Régulateur → batterie (DC)", "i_b_a": mppt.i_charge_max,
                "protection": f"Fusible DC {in_mppt} A", "longueur_m": hyp.longueur_batterie_m, **c_mppt})
    note.info(rub, f"Protections côté batterie : pouvoir de coupure continu ≥ {batt['icc_a'] / 1000:.1f} kA ; "
                   "contrainte thermique à vérifier avec l'I²t limité du fusible (fiche constructeur)", R_ADIAB)

    # Circuits terminaux
    n_circ = len(bilan["lignes"])
    k_circ = k_t_ac * facteur_groupement(n_circ, hyp.disposition_circuits)
    note.ajouter(rub, "Courants admissibles", "méthode E, cuivre PR, 30 °C", "", R_IZ)
    note.ajouter(rub, "Câbles de chaînes PV", "H1Z2Z2-K, I_B = 1,25·Isc", "", R_PV_CABLE)
    note.ajouter(rub, "Chute de tension maximale côté AC", f"{hyp.chute_max_eclairage:g} % éclairage / "
                 f"{hyp.chute_max_autres:g} % autres", "", R_DU)
    note.ajouter(rub, "Chute de tension maximale côté DC", f"{hyp.chute_max_dc:g} % batterie / "
                 f"{hyp.chute_max_pv:g} % chaînes PV", "", R_DU_DC)
    note.ajouter(rub, "Courbe des disjoncteurs terminaux", "B, sauf appel moteur (C ou D)", "", R_COURBES)
    note.ajouter(rub, f"Facteur de température câbles PR à {site.t_amb_max:g} °C", round(k_t_ac, 3), "", R_KT)
    note.ajouter(rub, f"Facteur de groupement ({n_circ} circuits)",
                 facteur_groupement(n_circ, hyp.disposition_circuits), "", R_KG)
    non_instantane = {"onduleur": [], "groupe": []}
    for l in bilan["lignes"]:
        c: Circuit = l["circuit"]
        i_moteurs = sum(courant_nominal_moteur(r, c.triphase) * r.quantite for r in c.recepteurs if r.moteur)
        in_c = calibre_superieur(max(l["i_b_a"], i_moteurs, c.calibre_min), CALIBRES_DISJ)
        courbe = choisir_courbe(c, in_c)
        chute_max = hyp.chute_max_eclairage if c.eclairage else hyp.chute_max_autres
        dim = dimensionner_cable(
            i_requis=in_c, k_correction=k_circ, table_iz=IZ_CU_PR_E[3 if c.triphase else 2], chute_max_pct=chute_max,
            chute=lambda s, c=c, l=l: du_amont + chute_tension_ac(l["i_b_a"], c.longueur_m, s, l["cos_phi"],
                                                                  c.triphase),
            contrainte_a_rac_s=i_rac_t_ac, s_min=c.section_min)
        if dim is None:
            note.verifier(rub, False, "", f"{c.nom} : aucune section ne satisfait les critères", R_DU)
            continue
        troncons = [(hyp.longueur_onduleur_tgbt_m, c_ond["section_mm2"]), (c.longueur_m, dim["section_mm2"])]
        icc = {"onduleur": icc_min_fin_ligne(icc_ond, troncons),
               "groupe": icc_min_fin_ligne(ge["i_k_maintenu_a"], [(hyp.longueur_ge_m, c_ge["section_mm2"])] + troncons)}
        seuil = MAGNETIQUE_MAX[courbe] * in_c
        for source, valeur in icc.items():
            if valeur < seuil:
                non_instantane[source].append(f"{c.nom.split()[0]} ({valeur:.0f} A < {seuil:.0f} A)")
        res.append({"liaison": c.nom, "i_b_a": l["i_b_a"], "protection": f"Disj. {in_c:g} A courbe {courbe}",
                    "longueur_m": c.longueur_m, "icc_min_onduleur_a": round(icc["onduleur"]),
                    "icc_min_groupe_a": round(icc["groupe"]), "seuil_magnetique_a": seuil, **dim})

    note.verifier(rub, not non_instantane["groupe"],
                  "Sur groupe : déclenchement magnétique assuré sur tous les circuits terminaux",
                  "Sur groupe, Icc mini < seuil magnétique : " + ", ".join(non_instantane["groupe"])
                  + " — vérifier la coupure sur la courbe temps-courant ou réduire calibre/longueur", R_TCOUP, "ATTENTION")
    note.verifier(rub, not non_instantane["onduleur"],
                  "Sur onduleur : déclenchement magnétique assuré sur tous les circuits terminaux",
                  "Sur onduleur, Icc mini < seuil magnétique : " + ", ".join(non_instantane["onduleur"])
                  + " — l'onduleur limite puis coupe avant le disjoncteur (perte de sélectivité) ; "
                  "choisir un onduleur à fort courant de court-circuit si la continuité de service l'exige", R_TCOUP,
                  "ATTENTION")
    note.ajouter(rub, "Icc maximal au TGBT (groupe + onduleurs)", round(icc_max_tgbt), "A", R_ICC)
    note.info(rub, f"Pouvoir de coupure Icu ≥ {icc_max_tgbt / 1000:.1f} kA : disjoncteurs modulaires 6 kA suffisants",
              R_PROT)
    note.info(rub, "Protection des personnes : DDR 30 mA sur tous les circuits terminaux ; en îlotage, l'onduleur "
                   "doit relier neutre et terre (relais de terre) pour conserver le schéma TN-S", R_TCOUP)
    return res


# =============================================================================
# 10. RAPPORT
# =============================================================================


def _fmt(v: Any) -> str:
    if isinstance(v, float):
        return f"{v:,.2f}".replace(",", " ").rstrip("0").rstrip(".") if abs(v) < 1e6 else f"{v:.3g}"
    return str(v)


def rapport_texte(note: NoteDeCalcul, site: Site, bilan: dict, gis: dict, cables: list[dict], annuel: dict,
                  equipements: list[str]) -> str:
    L = []
    barre = "═" * 100
    L += [barre, " NOTE DE CALCUL — SYSTÈME HYBRIDE PHOTOVOLTAÏQUE + BATTERIES + GROUPE ÉLECTROGÈNE",
          f" {site.nom}", f" Latitude {site.latitude:.2f}°, longitude {site.longitude:.2f}°, altitude {site.altitude_m:g} m",
          barre, ""]

    L.append("■ BILAN DE PUISSANCE PAR CIRCUIT")
    L.append(f"  {'Circuit':<36}{'Ph':>4}{'P kW':>8}{'Q kvar':>8}{'S kVA':>8}{'cos φ':>7}{'I_B A':>8}{'kWh/j':>8}")
    for l in bilan["lignes"]:
        ph = "3~" if l["circuit"].triphase else f"L{l['phase'] + 1}"
        L.append(f"  {l['circuit'].nom:<36}{ph:>4}{l['p_w'] / 1000:>8.2f}{l['q_var'] / 1000:>8.2f}"
                 f"{l['s_va'] / 1000:>8.2f}{l['cos_phi']:>7.2f}{l['i_b_a']:>8.1f}{l['energie_wh_j'] / 1000:>8.2f}")
    L.append("")

    L.append("■ GISEMENT SOLAIRE MENSUEL (kWh/m²/j)")
    L.append("  " + f"{'':<10}" + "".join(f"{m:>7}" for m in MOIS))
    for nom, cle in (("H0", "h0"), ("K_T", "kt"), ("GHI", "ghi"), ("Hd/H", "fd"), ("Rb", "rb"), ("H_T", "ht")):
        L.append("  " + f"{nom:<10}" + "".join(f"{v:>7.2f}" for v in gis[cle]))
    L.append(f"  Plan incliné à {gis['beta']:g}°, mois critique : {MOIS[gis['mois_critique']]}")
    L.append("")

    rubriques: dict[str, list[Ligne]] = {}
    for ln in note.lignes:
        rubriques.setdefault(ln.rubrique, []).append(ln)
    for rub, lignes in rubriques.items():
        L.append(f"■ {rub.upper()}")
        for ln in lignes:
            ref = f"[{note._ref(ln.ref)}]" if ln.ref else ""
            L.append(f"  {ln.libelle:.<58} {_fmt(ln.valeur)} {ln.unite} {ref}".rstrip())
        L.append("")

    L.append("■ CÂBLES ET PROTECTIONS (cuivre ; ΔU cumulée depuis la source)")
    L.append(f"  {'Liaison':<36}{'I_B A':>7}{'L m':>6}{'S mm²':>7}{'Iz A':>7}{'ΔU %':>7}  {'Protection':<20}Critère")
    for c in cables:
        L.append(f"  {c['liaison'][:35]:<36}{c['i_b_a']:>7.1f}{c['longueur_m']:>6.0f}{c['section_mm2']:>7g}"
                 f"{c['iz_corrige_a']:>7.0f}{c['chute_cumulee_pct']:>7.2f}  {c['protection']:<20}{c['critere_dimensionnant']}")
    L.append("")

    terminaux = [c for c in cables if "seuil_magnetique_a" in c]
    if terminaux:
        L.append("■ DÉCLENCHEMENT EN ÎLOTAGE (Icc phase-neutre minimal en bout de circuit)")
        L.append(f"  {'Circuit':<36}{'Protection':<20}{'Im max A':>9}{'Onduleur A':>12}{'Groupe A':>10}")
        for c in terminaux:
            L.append(f"  {c['liaison'][:35]:<36}{c['protection']:<20}{c['seuil_magnetique_a']:>9.0f}"
                     f"{c['icc_min_onduleur_a']:>12}{c['icc_min_groupe_a']:>10}")
        L.append("")

    jour = annuel.get("jour_publie")
    if jour:
        L.append(f"■ JOURNÉE SIMULÉE — jour {jour['jour']} ({jour['mois']}, ensoleillement × {jour['facteur_meteo']:.2f}) "
                 "— kW, batterie + = décharge")
        L.append(f"  {'h':>3}{'Charge':>9}{'PV':>8}{'Batt.':>8}{'Groupe':>8}{'SOC':>7}")
        for p in jour["heures"]:
            L.append(f"  {p['h']:>3}{p['charge']:>9.2f}{p['pv']:>8.2f}{p['batterie']:>8.2f}{p['ge']:>8.2f}{p['soc']:>7.0%}")
        L.append("")

    L.append("■ VÉRIFICATIONS")
    ordre = {"NON CONFORME": 0, "ATTENTION": 1, "OK": 2, "INFO": 3}
    for v in sorted(note.verifications, key=lambda v: ordre[v.statut]):
        ref = f" [{note._ref(v.ref)}]" if v.ref else ""
        L.append(f"  [{v.statut:^12}] {v.message}{ref}")
    L.append("")

    L.append("■ NOMENCLATURE PRINCIPALE")
    L += [f"  • {e}" for e in equipements]
    L.append("")

    L.append("■ JUSTIFICATIONS (références normatives et formules)")
    for ref, i in sorted(note.references.items(), key=lambda kv: kv[1]):
        L.append(f"  [R{i}] {ref}")
    L.append("")
    L.append("  Outil de démonstration : tables et hypothèses à valider contre les éditions en vigueur des normes")
    L.append("  et les fiches constructeurs avant toute remise à un bureau de contrôle.")
    return "\n".join(L)


# =============================================================================
# 11. CAS DE DÉMONSTRATION ET ORCHESTRATION
# =============================================================================


def cas_demo(args: argparse.Namespace) -> tuple[Site, list[Circuit], Hypotheses]:
    site = Site(
        nom="Centre de santé rural (cas de démonstration)",
        latitude=args.lat, longitude=args.lon, altitude_m=args.alt,
        t_amb_max=40.0, t_amb_min=18.0, t_amb_jour=31.0, t_local_ge=45.0,
        ghi_mensuel=args.ghi,
    )
    circuits = [
        Circuit("C1 Éclairage intérieur", [Recepteur("Luminaire LED 18 W", 50, 18, 0.90,
                plages=[(6, 8, 0.5), (8, 18, 0.3), (18, 23, 1.0), (23, 6, 0.15)])], longueur_m=40, eclairage=True),
        Circuit("C2 Éclairage extérieur", [Recepteur("Projecteur LED 50 W", 6, 50, 0.90, plages=[(18, 6, 1.0)])],
                longueur_m=60, eclairage=True),
        Circuit("C3 Climatisation salles de soins", [Recepteur("Split inverter 1,2 kW", 2, 1200, 0.95,
                plages=[(9, 17, 0.7)])], longueur_m=25),
        Circuit("C4 Chaîne du froid (vaccins)", [Recepteur("Réfrigérateur médical", 2, 150, 0.80,
                plages=[(0, 24, 0.5)])], longueur_m=20),
        Circuit("C5 Bureautique / informatique", [Recepteur("Poste informatique", 6, 120, 0.95,
                plages=[(8, 17, 0.8)])], longueur_m=30),
        Circuit("C6 Prises de courant", [Recepteur("Prise 16 A (usages divers)", 20, 250, 0.90,
                plages=[(8, 17, 0.08)])], ks=0.2, longueur_m=35, calibre_min=20, section_min=2.5),
        Circuit("C7 Stérilisation", [Recepteur("Autoclave", 1, 2000, 1.0, plages=[(10, 12, 0.8)])], longueur_m=20),
        Circuit("C8 Pompe de forage", [Recepteur("Moteur asynchrone 3 kW", 1, 3000, 0.82, rendement=0.85, ku=0.9,
                plages=[(10, 13, 1.0)], moteur=True, demarrage=args.demarrage)], triphase=True, longueur_m=80),
        Circuit("C9 Équipements médicaux", [
                Recepteur("Concentrateur d'oxygène", 1, 350, 0.95, plages=[(0, 24, 0.5)]),
                Recepteur("Aspirateur de mucosités", 1, 200, 0.90, plages=[(8, 18, 0.1)])], longueur_m=25),
        Circuit("C10 Laboratoire", [Recepteur("Centrifugeuse, incubateur, microscopes", 1, 1000, 0.90,
                plages=[(8, 16, 0.5)])], longueur_m=30),
    ]
    hyp = Hypotheses(chimie=args.chimie, jours_autonomie=args.autonomie)
    return site, circuits, hyp


def executer(site: Site, circuits: list[Circuit], hyp: Hypotheses, module: ModulePV | None = None,
             mppt: RegulateurMPPT | None = None) -> tuple[NoteDeCalcul, dict]:
    module = module or ModulePV()
    mppt = mppt or RegulateurMPPT()
    chimie = CHIMIES[hyp.chimie]
    note = NoteDeCalcul()

    bilan = bilan_puissance(note, circuits, hyp)
    gis = gisement_solaire(note, site, hyp)
    onduleur = dimensionner_onduleur(note, bilan, circuits, hyp)
    pv = dimensionner_pv(note, site, hyp, bilan, gis, onduleur, chimie, module, mppt)
    batt = dimensionner_batteries(note, hyp, bilan, onduleur, pv, chimie, mppt)
    ge = dimensionner_groupe(note, site, hyp, bilan, gis, onduleur, batt, chimie)
    annuel, stress, _ = preparer_simulation(hyp, bilan, gis, pv, onduleur, batt, chimie, ge)
    verifier_simulation(note, hyp, annuel, stress)
    cables = cables_et_protections(note, site, hyp, bilan, onduleur, pv, batt, ge, module, mppt)

    equipements = [
        f"{pv['n_modules']} × {module.nom} → {pv['p_installee_w'] / 1000:.2f} kWc, inclinaison {gis['beta']:g}°",
        f"{pv['n_mppt']} × {mppt.nom} ({pv['ns']} série × {pv['np']} parallèle par régulateur)",
        f"Batteries : {batt['designation']} → {batt['c_installee_kwh']:.1f} kWh",
        f"Onduleurs/chargeurs : 3 × {onduleur['n_par_phase']} × {onduleur['unite_va'] / 1000:g} kVA, bus {onduleur['u_bus']} V DC",
        f"Groupe électrogène : {ge['s_kva']:g} kVA PRP (critère : {ge['critere']})",
    ]
    resultats = {
        "site": site.__dict__,
        "bilan": {k: v for k, v in bilan.items() if k != "lignes"} | {
            "circuits": [{"nom": l["circuit"].nom, "phase": "3~" if l["circuit"].triphase else f"L{l['phase'] + 1}",
                          "p_w": l["p_w"], "q_var": l["q_var"], "s_va": l["s_va"], "i_b_a": l["i_b_a"],
                          "energie_wh_j": l["energie_wh_j"]} for l in bilan["lignes"]]},
        "gisement": gis, "onduleur": onduleur, "pv": pv, "batteries": batt, "groupe": ge,
        "simulation_annuelle": {k: v for k, v in annuel.items() if k not in ("trace", "jour_publie")},
        "journee_publiee": annuel["jour_publie"],
        "test_jours_sans_soleil": {k: v for k, v in stress.items() if k != "trace"},
        "cables": cables, "nomenclature": equipements,
        "note": [ln.__dict__ for ln in note.lignes],
        "verifications": [v.__dict__ for v in note.verifications],
    }
    resultats["texte"] = rapport_texte(note, site, bilan, gis, cables, annuel, equipements)
    return note, resultats


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(description="Démonstrateur de dimensionnement hybride PV + batteries + groupe")
    p.add_argument("--lat", type=float, default=5.35, help="latitude en degrés (Nord positif)")
    p.add_argument("--lon", type=float, default=-4.00, help="longitude en degrés (Est positif)")
    p.add_argument("--alt", type=float, default=300.0, help="altitude en mètres")
    p.add_argument("--ghi", type=float, nargs=12, metavar="H",
                   help="12 irradiations horizontales mensuelles en kWh/m²/j (PVGIS, NASA POWER…)")
    p.add_argument("--chimie", choices=sorted(CHIMIES), default="lifepo4")
    p.add_argument("--autonomie", type=float, default=1.0, help="jours d'autonomie batterie")
    p.add_argument("--demarrage", choices=sorted(MODES_DEMARRAGE), default="progressif",
                   help="mode de démarrage de la pompe")
    p.add_argument("--json", metavar="FICHIER", help="exporter tous les résultats en JSON")
    args = p.parse_args(argv)

    site, circuits, hyp = cas_demo(args)
    note, resultats = executer(site, circuits, hyp)
    print(resultats["texte"])
    if args.json:
        with open(args.json, "w", encoding="utf-8") as f:
            json.dump({k: v for k, v in resultats.items() if k != "texte"}, f, ensure_ascii=False, indent=2,
                      default=str)
        print(f"\nRésultats exportés dans {args.json}")
    return 1 if any(v.statut == "NON CONFORME" for v in note.verifications) else 0


if __name__ == "__main__":
    raise SystemExit(main())
