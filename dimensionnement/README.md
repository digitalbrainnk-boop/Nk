# ⚡ Agent de dimensionnement électrique

Application de dimensionnement avec un assistant IA intégré. Elle couvre :
* le bilan de puissance d'un bâtiment ;
* les câbles et les protections ;
* les panneaux solaires, les batteries et les onduleurs/chargeurs ;
* le groupe électrogène, en continu ou en secours ;
* le raccordement au réseau public (branchement ou poste de transformation) ;
* la compensation de l'énergie réactive et les harmoniques ;
* les lignes aériennes basse tension : flèches, poteaux, chute de tension et court-circuit ;
* une note de calcul justifiée, avec la référence de norme de chaque valeur ;
* la liste du matériel et un devis estimatif ;
* une fiche de relevé terrain à imprimer.

Les appareils se choisissent dans un catalogue de 237 équipements. Les puissances se saisissent dans l'unité de la plaque signalétique.

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

## Installer l'application

**Page de téléchargement : [github.com/digitalbrainnk-boop/Nk/releases/latest](https://github.com/digitalbrainnk-boop/Nk/releases/latest)**

Cette page contient toujours la dernière version. Elle est publiée automatiquement par le workflow [`.github/workflows/publier-application.yml`](../.github/workflows/publier-application.yml), après vérification par les tests.

L'application s'installe sur téléphone et ordinateur. Elle calcule **sans connexion internet**. Le guide pas à pas, à transmettre aux collègues, est [INSTALLATION.md](INSTALLATION.md).

| Appareil | Comment |
|---|---|
| **Android** | Application à installer : [agent-dimensionnement.apk](https://github.com/digitalbrainnk-boop/Nk/releases/latest/download/agent-dimensionnement.apk) (moins de 1 Mo, Android 5.0 et plus). On peut l'envoyer par WhatsApp. |
| **iPhone, iPad** | Application web : [digitalbrainnk-boop.github.io/Nk/dimensionnement/app](https://digitalbrainnk-boop.github.io/Nk/dimensionnement/app/), puis dans Safari Partager, « Sur l'écran d'accueil ». Le lien s'active une fois GitHub Pages activé, voir INSTALLATION.md. |
| **Ordinateur** | Même lien web, puis « Installer » dans Chrome ou Edge. Sans internet : le fichier unique [`dist/agent-dimensionnement-hors-ligne.html`](dist/agent-dimensionnement-hors-ligne.html). |
| **Dans Claude** | Lien de l'application publiée, avec l'assistant IA inclus. |

Dans l'application installée, l'assistant IA fonctionne avec une clé personnelle saisie dans son panneau, qui reste sur l'appareil. Deux « cerveaux » au choix : **DeepSeek V4.1 Flash via Kie.ai** (par défaut) ou **Claude Opus 5.5 via Anthropic**. Si le modèle refuse les outils natifs, l'application passe automatiquement par un protocole texte. Les exports (note, carnet de câbles, projet) se partagent directement par WhatsApp ou e-mail.

## Utiliser l'application

L'application démarre sur un **projet vide**. Un guide indique les informations nécessaires :

| Information | Statut |
|---|---|
| Lieu (bouton « Utiliser ma position »), altitude, températures | Obligatoire |
| Appareils (catalogue ou plaque signalétique) et heures d'utilisation | Obligatoire |
| Ensoleillement mensuel | Conseillé pour le solaire |
| Choix techniques | Facultatif |

Le calcul se lance dès que l'essentiel est saisi. Il n'utilise jamais de lieu ou d'appareils d'exemple à votre insu. « Réinitialiser l'application » efface toutes les données de l'appareil.

**Catalogue d'équipements** (onglet Charges). 237 appareils en 14 familles : éclairage, climatisation, froid, cuisine, électroménager, informatique, sécurité, pompage, atelier et soudage, agro-transformation, santé, commerce, bornes de recharge, moteurs et industrie. Chaque appareil a des valeurs typiques :
* puissance et cos φ ;
* rendement et mode de démarrage pour les moteurs et compresseurs ;
* charge électronique non linéaire ;
* heures d'utilisation et taux de marche.

Après le choix des quantités, l'application crée les circuits :
* un circuit par climatiseur, chauffe-eau, plaque de cuisson, moteur ou borne de recharge ;
* au plus 8 points d'éclairage par circuit ;
* les autres usages regroupés jusqu'à la puissance usuelle d'un circuit.

Le **type de circuit** fixe la protection et la section minimales : NF C 15-100 pour les normes IEC, NEC 210 pour le NEC.

**Unités de la plaque.** La puissance d'un appareil se saisit en W, kW, CV, HP, kVA ou A. La conversion tient compte du cos φ, du rendement (puissance utile d'un moteur), de la tension et des phases.

**Matériel et devis.** La liste du matériel est tirée du calcul :
* équipements dimensionnés ;
* câbles par type et section, longueurs + 10 % ;
* disjoncteurs par calibre, courbe et pouvoir de coupure ;
* interrupteurs différentiels et coffret avec 20 % de réserve ;
* poteaux et conducteur de la ligne aérienne.

Les prix unitaires saisis sont mémorisés sur l'appareil, pour tous les projets. Le devis ajoute la main-d'œuvre et la TVA, et s'exporte en CSV.

Vous pouvez aussi tout décrire à l'assistant avec vos mots, par exemple :

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
| Charges | Catalogue de 237 équipements avec création automatique des circuits ; type de circuit ; récepteurs : puissance dans l'unité de la plaque (W, kW, CV, HP, kVA, A), cos φ, rendement, plages horaires, moteurs et mode de démarrage, charges non linéaires |
| Choix techniques | Batteries, onduleur, groupe, module PV et régulateur, mode de pose des câbles (ou options NEC), cos φ visé, simulation. Seuls les blocs utiles au système choisi sont affichés. |
| Ligne aérienne | Conducteur, hypothèses climatiques, poteaux, portées ; résultats : tensions mécaniques, profil en long, classes de supports, chute de tension et court-circuit le long de la ligne |
| Résultats | Synthèse, vérifications, journée simulée, bilan mensuel, comparaison des quatre systèmes, raccordement, bilan de puissance, câbles et protections (avec Zs en BS 7671), énergie réactive, gisement solaire |
| Matériel et devis | Liste du matériel par catégorie, prix unitaires mémorisés, main-d'œuvre, TVA, total ; export du devis (.csv) |
| Note de calcul | Note complète avec justifications `[Rn]` et liste du matériel ; téléchargement de la note (.html), du carnet de câbles (.csv), du devis (.csv) et du projet (.json) |

## Contenu du dossier

| Élément | Rôle |
|---|---|
| [app/index.html](app/index.html), [app/app.js](app/app.js) | Interface de l'application et assistant IA (dans Claude ou avec une clé API) |
| [app/moteur.js](app/moteur.js) | Moteur de calcul multi-normes (JavaScript, sans dépendance) |
| [app/catalogue.js](app/catalogue.js) | Catalogue d'équipements, types de circuits, conversions de puissance, répartition en circuits |
| [app/manifest.webmanifest](app/manifest.webmanifest), [app/sw.js](app/sw.js) | Application web installable : icônes, cache hors connexion, mises à jour |
| [app/polices/](app/polices/), [app/vendor/](app/vendor/) | Polices embarquées (licence OFL) et SDK Anthropic pour le navigateur (licence MIT) |
| [android/](android/) | Application Android : WebView native, partage des fichiers, script de construction sans SDK Android |
| [dist/](dist/) | Versions distribuables : APK Android signé et fichier unique hors ligne |
| [outils/construire.py](outils/construire.py) | Construit les versions distribuables (`--apk` pour l'Android) |
| [INSTALLATION.md](INSTALLATION.md) | Guide d'installation pour les utilisateurs et le responsable de l'application |
| [demo_hybride.py](demo_hybride.py) | Démonstrateur Python de référence (NF C 15-100, 400/230 V, en ligne de commande) |
| [docs/01-architecture.md](docs/01-architecture.md) | Architecture cible : moteur, API, base de données, moteur documentaire et veille, agent IA |
| [docs/02-equations-modules-A-B-C.md](docs/02-equations-modules-A-B-C.md) | Recueil des équations : modules A à E, comparaison des référentiels, source réseau |
| [docs/03-feuille-de-route.md](docs/03-feuille-de-route.md) | Feuille de route MVP → V1 → V2, critères d'acceptation, risques |
| [tests/](tests/) | Tests du moteur JavaScript (parité avec Python, normes, modules D et E) et du démonstrateur |

## Tests

```bash
node --test dimensionnement/tests/*.test.mjs                                 # moteur, catalogue et versions distribuables (35 tests)
cd dimensionnement && python3 -m unittest discover -s tests -v               # démonstrateur Python (18 tests)
python3 demo_hybride.py --chimie plomb --autonomie 2                         # note de calcul en ligne de commande
```

Après une modification de l'application, `python3 outils/construire.py --apk` met à jour le cache hors connexion, le fichier unique et l'APK. Les tests vérifient que ces versions sont cohérentes.

Les tests du moteur vérifient notamment :
* la parité exacte avec le démonstrateur Python en NF C 15-100 ;
* le calcul de chaque appareil du catalogue dans les quatre normes, la répartition automatique en circuits, les conversions d'unités et les démarrages décalés des moteurs ;
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
