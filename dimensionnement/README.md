# ⚡ Dimensionnement électrique — logiciel expert (conception + démonstrateur)

Ce dossier porte un logiciel de calcul, d'audit et de dimensionnement électrotechnique : bâtiments BT, solaire photovoltaïque avec batteries, groupes électrogènes, compensation, lignes aériennes BT. Les calculs suivent les normes NF C 15-100, IEC 60364, IEC 60909, IEC 62548 et ISO 8528. C'est un projet distinct de l'agent de messagerie à la racine du dépôt.

| Document | Contenu |
|---|---|
| [docs/01-architecture.md](docs/01-architecture.md) | Architecture : moteur de calcul, API, base de données, interface, moteur documentaire et veille, agent IA |
| [docs/02-equations-modules-A-B-C.md](docs/02-equations-modules-A-B-C.md) | Recueil des équations : bilan de puissance, câbles et protections, PV, batteries, onduleurs, groupes électrogènes |
| [docs/03-feuille-de-route.md](docs/03-feuille-de-route.md) | Feuille de route MVP → V1 → V2, critères d'acceptation, risques |
| [demo_hybride.py](demo_hybride.py) | Démonstrateur : calcul hybride complet bâtiment + PV + batteries + groupe d'appoint |

## Lancer le démonstrateur

Il faut uniquement Python 3.9 ou plus récent, sans aucune installation.

```bash
cd dimensionnement
python3 demo_hybride.py                          # cas de démonstration : centre de santé rural, LiFePO4
python3 demo_hybride.py --chimie plomb --autonomie 2
python3 demo_hybride.py --demarrage direct       # pompe en démarrage direct : le groupe devient dimensionnant
python3 demo_hybride.py --lat 12.37 --lon -1.52 --ghi H1 H2 ... H12   # 12 irradiations mensuelles mesurées (kWh/m²/j)
python3 demo_hybride.py --json resultats.json    # tous les résultats en JSON
python3 -m unittest discover -s tests -v         # 18 tests
```

Le programme se termine avec le code 1 si une vérification est « NON CONFORME ».

## Ce que fait le démonstrateur

1. **Bilan de puissance (Module A)**
   * Inventaire des récepteurs, ku et ks.
   * Somme des P et des Q selon Boucherot.
   * Répartition des circuits monophasés sur les phases.
   * Profil horaire comparé à la méthode normative.
2. **Gisement solaire (Module B)**
   * Géométrie solaire, fraction diffuse, transposition sur plan incliné.
   * Inclinaison optimisée pour le mois le plus défavorable.
3. **Onduleur/chargeur**
   * Dimensionnement par phase avec déclassement à 40 °C.
   * Choix de la tension du bus.
   * Surcharge au démarrage moteur.
4. **Champ PV**
   * Puissance crête et ratio de performance détaillé.
   * Recherche de l'agencement série/parallèle compatible avec le régulateur MPPT (Voc à froid, Vmp à chaud, Isc).
   * Protections de chaîne.
5. **Batteries**
   * Capacité selon l'autonomie, la DoD, le vieillissement et la température.
   * Vérification des courants de charge et de décharge.
   * Courant de court-circuit du parc.
6. **Groupe électrogène (Module C)**
   * Trois critères : pointe, recharge sous 70 % PRP, chute de tension au démarrage.
   * Déclassement altitude et température.
   * Icc, consommation, inverseur de source.
7. **Simulation horaire sur 365 jours**
   * Météo journalière synthétique, avec la moyenne de chaque mois conservée.
   * Stratégie *cycle charging*.
   * Heures de marche, carburant, fraction renouvelable, cycles.
   * Test de 4 jours sans soleil.
8. **Câbles et protections**
   * Liaisons groupe, onduleur, batterie, chaînes PV et circuits terminaux.
   * Section selon Iz, ΔU cumulée et contrainte thermique, avec le critère qui fixe la section.
   * **Vérification du déclenchement en îlotage**, sur onduleur et sur groupe.
9. **Note de calcul**
   * Chaque valeur renvoie à sa justification `[Rn]`.
   * La note se termine par les vérifications, la nomenclature et la liste des références.

## Avertissement

Ce démonstrateur est un outil d'aide à la conception. Les tables normatives et les données de matériel sont des **valeurs usuelles génériques** à vérifier contre l'édition en vigueur des normes et contre les fiches des constructeurs. Le gisement par défaut repose sur un indice de clarté forfaitaire (K_T = 0,5) : fournir les données du site avec `--ghi`. Toute note remise à un bureau de contrôle doit être validée et signée par un ingénieur qualifié.
