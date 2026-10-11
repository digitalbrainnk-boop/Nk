# ⚡ Agent de dimensionnement électrique

Application de dimensionnement avec un assistant IA intégré. Elle couvre :
* le bilan de puissance d'un bâtiment ;
* les câbles et les protections ;
* les panneaux solaires, les batteries et les onduleurs/chargeurs ;
* le groupe électrogène, en continu ou en secours ;
* le raccordement au réseau public (branchement ou poste de transformation) ;
* la compensation de l'énergie réactive et les harmoniques ;
* les lignes aériennes basse tension : flèches, poteaux, chute de tension et court-circuit ;
* une note de calcul justifiée, avec la référence de norme de chaque valeur.

Ce dossier est indépendant du reste du dépôt.

## Normes prises en charge

Le référentiel se choisit dans l'onglet Projet. Il fixe les tables, les règles de protection, les limites de chute de tension et les références citées dans la note.

| Référentiel | Pays | Réseaux | Particularités |
|---|---|---|---|
| **NF C 15-100** | France, Afrique francophone, Maghreb | 400/230 V, 380/220 V, 230 V mono – 50 Hz | Guide UTE C 15-712, cos φ visé 0,928 (tan φ 0,4), lignes NF C 11-201 et poteaux béton |
| **IEC 60364** | International | 400/230, 380/220, 415/240 V, 230 V mono – 50 Hz | IEC 62548, IEC 60909, IEC/EN 50341 |
| **BS 7671** | Royaume-Uni, Commonwealth | 400/230, 415/240 V, 230 V mono – 50 Hz | Contrôle de l'impédance de boucle Zs (Table 41.3), PAS 63100 |
| **NEC / NFPA 70** | États-Unis (Canada en première approche) | 120/240 V, 208Y/120 V, 480Y/277 V – 60 Hz | Sections AWG/kcmil, 125 % des charges continues, Art. 430/440/690/706, NESC et poteaux bois ANSI |

Les autres normes citées : ISO 8528 (groupes), IEEE 1013/485 (batteries), IEC 62548 et NEC 690 (photovoltaïque), IEC 60831 et IEEE 519 (compensation et harmoniques).

## Utiliser l'application

**Sans rien installer :** ouvrez [`app/index.html`](app/index.html) dans un navigateur (Chrome, Edge, Firefox ; sur PC ou téléphone). Tous les calculs se font dans la page, même sans connexion internet.

**Avec l'assistant IA :** ouvrez l'application publiée dans Claude (lien fourni dans la conversation). Vous décrivez l'installation avec vos mots, par exemple :

> « Maison de 4 chambres à Bouaké, 12 lampes, 2 climatiseurs, un congélateur et une pompe de 1 CV. Solaire avec groupe de secours. »
>
> « Petit commerce à Houston raccordé au réseau en 120/240 V selon le NEC, avec un groupe de secours. »

L'assistant :
* choisit la norme du pays ;
* remplit les circuits et les appareils ;
* lance le calcul ;
* explique le matériel retenu et les corrections à faire.

Il ne calcule jamais lui-même : tous les chiffres viennent du moteur. Chaque modification qu'il fait peut être annulée d'un clic.

| Onglet | Ce qu'on y fait |
|---|---|
| Assistant IA | Décrire l'installation, poser une question sur un résultat ou une norme, comparer des variantes |
| Projet | Nom ; type de système (hybride, solaire autonome, groupe seul, réseau public) ; norme et réseau ; raccordement au réseau ; site (coordonnées, températures, irradiation PVGIS) ; import/export du projet |
| Charges | Circuits et récepteurs : puissance, cos φ, rendement, plages horaires, moteurs et mode de démarrage, charges non linéaires ; bibliothèque d'appareils typiques |
| Choix techniques | Batteries, onduleur, groupe, module PV et régulateur, mode de pose des câbles (ou options NEC), cos φ visé, simulation. Seuls les blocs utiles au système choisi sont affichés. |
| Ligne aérienne | Conducteur, hypothèses climatiques, poteaux, portées ; résultats : tensions mécaniques, profil en long, classes de supports, chute de tension et court-circuit le long de la ligne |
| Résultats | Synthèse, vérifications, journée simulée, bilan mensuel, comparaison des quatre systèmes, raccordement, bilan de puissance, câbles et protections (avec Zs en BS 7671), énergie réactive, gisement solaire |
| Note de calcul | Note complète avec justifications `[Rn]` ; téléchargement de la note (.html), du carnet de câbles (.csv) et du projet (.json) |

## Contenu du dossier

| Élément | Rôle |
|---|---|
| [app/index.html](app/index.html), [app/app.js](app/app.js) | Interface de l'application et assistant IA |
| [app/moteur.js](app/moteur.js) | Moteur de calcul multi-normes (JavaScript, sans dépendance) |
| [demo_hybride.py](demo_hybride.py) | Démonstrateur Python de référence (NF C 15-100, 400/230 V, en ligne de commande) |
| [docs/01-architecture.md](docs/01-architecture.md) | Architecture cible : moteur, API, base de données, moteur documentaire et veille, agent IA |
| [docs/02-equations-modules-A-B-C.md](docs/02-equations-modules-A-B-C.md) | Recueil des équations : modules A à E, comparaison des référentiels, source réseau |
| [docs/03-feuille-de-route.md](docs/03-feuille-de-route.md) | Feuille de route MVP → V1 → V2, critères d'acceptation, risques |
| [tests/](tests/) | Tests du moteur JavaScript (parité avec Python, normes, modules D et E) et du démonstrateur |

## Tests

```bash
node --test dimensionnement/tests/*.test.mjs                                 # moteur de l'application (23 tests)
cd dimensionnement && python3 -m unittest discover -s tests -v               # démonstrateur Python (18 tests)
python3 demo_hybride.py --chimie plomb --autonomie 2                         # note de calcul en ligne de commande
```

Les tests du moteur vérifient notamment :
* la parité exacte avec le démonstrateur Python en NF C 15-100 ;
* des cas types NEC : 40 A continus donnent 50 A et du 8 AWG ; règle 240.4(D) ; moteur de 10 HP en 480 V ; facteurs de température ;
* le Zs maximal d'un disjoncteur B32 en BS 7671 (1,37 Ω) ;
* une compensation de 100 kW de cos φ 0,75 à 0,95, soit 55,3 kvar ;
* la réversibilité de l'équation de changement d'état ;
* le calcul de toutes les combinaisons norme × réseau × système, soit 60 cas.

## Avertissement

Les tables normatives, les hypothèses climatiques et les données de matériel sont des **valeurs usuelles génériques**. Elles sont à vérifier contre l'édition en vigueur des normes, contre les fiches des constructeurs (câbles, conducteurs aériens, poteaux, disjoncteurs) et contre les règles du distributeur local.

Sans irradiations mensuelles mesurées, le calcul solaire prend un ensoleillement forfaitaire prudent. Saisissez les valeurs PVGIS ou NASA POWER du site.

La norme canadienne CSA C22.1 n'est pas intégrée : pour le Canada, le NEC sert de première approche.

Toute note remise à un bureau de contrôle doit être validée et signée par un ingénieur qualifié.
