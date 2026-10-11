# ⚡ Agent de dimensionnement électrique

Application de dimensionnement avec un assistant IA intégré. Elle couvre :
* le bilan de puissance d'un bâtiment ;
* les panneaux solaires, les batteries et les onduleurs/chargeurs ;
* le groupe électrogène ;
* les câbles et les protections ;
* une note de calcul justifiée, avec la référence de norme de chaque valeur (NF C 15-100, IEC 60364, IEC 62548, ISO 8528…).

Ce dossier est indépendant du reste du dépôt.

## Utiliser l'application

**Sans rien installer :** ouvrez [`app/index.html`](app/index.html) dans un navigateur (Chrome, Edge, Firefox ; sur PC ou téléphone). Tous les calculs se font dans la page, même sans connexion internet.

**Avec l'assistant IA :** ouvrez l'application publiée dans Claude (lien fourni dans la conversation). Vous décrivez l'installation avec vos mots, par exemple :

> « Maison de 4 chambres à Bouaké, 12 lampes, 2 climatiseurs, un congélateur et une pompe de 1 CV. Solaire avec groupe de secours. »

L'assistant remplit les circuits et les appareils, lance le calcul, puis explique le matériel retenu et les corrections à faire. Il ne calcule jamais lui-même : tous les chiffres viennent du moteur. Chaque modification qu'il fait peut être annulée d'un clic.

| Onglet | Ce qu'on y fait |
|---|---|
| Assistant IA | Décrire l'installation, poser une question sur un résultat ou une norme, comparer des variantes |
| Projet | Nom, type de système (hybride, solaire autonome, groupe seul), site (coordonnées, températures, irradiation mensuelle PVGIS) ; import/export du projet |
| Charges | Circuits et récepteurs : puissance, cos φ, rendement, plages horaires, moteurs et mode de démarrage ; bibliothèque d'appareils typiques |
| Choix techniques | Batteries (LiFePO4 ou plomb, autonomie), onduleur, groupe (déclassement, chute de tension au démarrage), module PV et régulateur, câbles, simulation |
| Résultats | Synthèse, vérifications, journée simulée, bilan mensuel, comparaison des trois systèmes, bilan de puissance, câbles et protections, gisement solaire |
| Note de calcul | Note complète avec justifications `[Rn]` ; téléchargement de la note (.html), du carnet de câbles (.csv) et du projet (.json) |

## Contenu du dossier

| Élément | Rôle |
|---|---|
| [app/index.html](app/index.html), [app/app.js](app/app.js) | Interface de l'application et assistant IA |
| [app/moteur.js](app/moteur.js) | Moteur de calcul de l'application (JavaScript, sans dépendance) |
| [demo_hybride.py](demo_hybride.py) | Démonstrateur Python de référence (même moteur, en ligne de commande) |
| [docs/01-architecture.md](docs/01-architecture.md) | Architecture cible : moteur, API, base de données, moteur documentaire et veille, agent IA |
| [docs/02-equations-modules-A-B-C.md](docs/02-equations-modules-A-B-C.md) | Recueil des équations : bilan, câbles, protections, solaire, batteries, onduleurs, groupes |
| [docs/03-feuille-de-route.md](docs/03-feuille-de-route.md) | Feuille de route MVP → V1 → V2, critères d'acceptation, risques |
| [tests/](tests/) | Tests du moteur JavaScript (dont la parité avec Python) et du démonstrateur |

## Tests

```bash
node --test dimensionnement/tests/*.test.mjs                                 # moteur de l'application (8 tests)
cd dimensionnement && python3 -m unittest discover -s tests -v               # démonstrateur Python (18 tests)
python3 demo_hybride.py --chimie plomb --autonomie 2                         # note de calcul en ligne de commande
```

## Avertissement

Les tables normatives et les données de matériel sont des **valeurs usuelles génériques**. Elles sont à vérifier contre l'édition en vigueur des normes et contre les fiches des constructeurs.

Sans irradiations mensuelles mesurées, le calcul solaire prend un ensoleillement forfaitaire prudent. Saisissez les valeurs PVGIS ou NASA POWER du site.

Toute note remise à un bureau de contrôle doit être validée et signée par un ingénieur qualifié.
