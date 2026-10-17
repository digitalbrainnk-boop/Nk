# Gold Liquidity Scalper — Expert Advisor MQL5 pour XAU/USD

Robot de trading **MetaTrader 5** pour l'or (XAU/USD) : analyse M1 / M5 / M15,
entrées sur balayage de liquidité, calcul du volume par le risque au stop, prises
de bénéfices partielles, protections journalières, reprise après redémarrage,
tableau de bord avec boutons, statistiques et journal détaillés, et protocole de
comparaison de six familles de stratégies.

Version **1.11** (voir [CHANGELOG.md](CHANGELOG.md)) : analyse des bougies
japonaises, tendance par votes et régimes de marché, supports / résistances
dynamiques, FVG / IFVG et Order Blocks (deux modules distincts), familles F5
(réaction sur support / résistance) et F6 (retest de FVG), mesure de la qualité
d'exécution, alertes, contrôle d'intégrité des données, absence de repaint
vérifiée, comparaisons A/B, étude FVG en 6 variantes et Monte-Carlo. État
vérifié exigence par exigence : [docs/AUDIT.md](docs/AUDIT.md).

> **Avertissements**
> - **Aucune rentabilité n'est garantie ni revendiquée.** Aucun backtest sur données
>   réelles n'a été réalisé par le développeur. Le score de signal (0–100) est une
>   note de qualité, **pas une probabilité de réussite**.
> - **Compilation MetaEditor non vérifiée ici** : l'environnement de développement
>   n'avait pas accès aux serveurs MetaQuotes. Le code a été vérifié autrement (voir
>   « Vérifications réalisées »), mais la première étape chez vous est de le compiler.
> - **Non prêt pour un compte réel** : ni testeur MT5, ni données réelles, ni démo
>   n'ont été exécutés (conditions : [docs/AUDIT.md § 6](docs/AUDIT.md)).
> - Le trading de l'or à effet de levier peut faire perdre tout le capital investi.

## Sommaire

1. [Contenu](#1-contenu)
2. [Installation et compilation](#2-installation-et-compilation)
3. [Mise en route](#3-mise-en-route)
4. [Tableau de bord](#4-tableau-de-bord)
5. [Stratégie (résumé)](#5-stratégie-résumé)
6. [Risque et volume — le cas d'un capital de 10 €](#6-risque-et-volume--le-cas-dun-capital-de-10-)
7. [Gestion des positions](#7-gestion-des-positions)
8. [Protections et conventions](#8-protections-et-conventions)
9. [Redémarrage et reconnexion](#9-redémarrage-et-reconnexion)
10. [Statistiques et fichiers produits](#10-statistiques-et-fichiers-produits)
11. [Validation et comparaison des stratégies](#11-validation-et-comparaison-des-stratégies)
12. [Vérifications réalisées](#12-vérifications-réalisées)
13. [Limites connues](#13-limites-connues)

## 1. Contenu

```
gold-liquidity-scalper/
├── MQL5/Experts/GoldLiquidityScalper/
│   ├── Gold_Liquidity_Scalper.mq5   fichier principal (paramètres + événements)
│   └── GLS/                         modules
│       ├── Defines.mqh              énumérations, constantes, textes
│       ├── Utils.mqh                calculs, heures, heure d'été UE/USA
│       ├── Logger.mqh               journal (onglet Experts + CSV)
│       ├── Persistence.mqh          état persistant (variables globales du terminal)
│       ├── SymbolSpec.mqh           détection du symbole, spécifications du contrat
│       ├── MarketData.mqh           barres clôturées, ATR, EMA, validation des données
│       ├── Structure.mqh            swings, BOS, CHOCH, régime, carte de liquidité
│       ├── Sessions.mqh             heure serveur/UTC, sessions, annonces économiques
│       ├── Context.mqh              contexte M1/M5/M15, veille, plage asiatique, intégrité
│       ├── Candles.mqh              bougies japonaises : mesures, figures, statuts
│       ├── Trend.mqh                tendance par votes, régimes de marché
│       ├── Zones.mqh                supports / résistances dynamiques
│       ├── Fvg.mqh                  FVG, IFVG, doublons entre unités, lien avec les OB
│       ├── OrderBlocks.mqh          Order Blocks (règles propres)
│       ├── Signals.mqh              6 familles de signaux, score, refus
│       ├── Risk.mqh                 calcul du volume, découpage des sorties
│       ├── Execution.mqh            envoi et vérification des ordres, qualité d'exécution
│       ├── PositionManager.mqh      TP partiels, break-even, suiveur, sorties
│       ├── Protection.mqh           limites journalières, drawdown, refroidissement
│       ├── Stats.mqh                statistiques reconstruites depuis l'historique
│       ├── Dashboard.mqh            objets graphiques du tableau de bord
│       └── Engine.mqh               orchestration, reprise, boutons
├── docs/STRATEGIE.md                définitions numériques exactes des règles
├── docs/PROTOCOLE_VALIDATION.md     protocole de comparaison des familles et des filtres
├── docs/AUDIT.md                    liste de contrôle : implémenté / compilé / testé / validé
├── CHANGELOG.md                     historique des versions
├── tester/sets/*.set                paramètres du testeur (une famille par fichier, comparaisons A/B)
├── tester/ini/*.ini                 modèle de lancement du testeur en ligne de commande
├── tools/analyze_trades.py          analyse statistique et décision (Python 3, sans dépendance)
├── tools/criteria_default.json      critères pré-enregistrés
└── tests/                           vérification hors MetaTrader (voir § 12)
```

## 2. Installation et compilation

1. Dans MetaTrader 5 : **Fichier → Ouvrir le dossier des données**.
2. Copier le dossier `MQL5/Experts/GoldLiquidityScalper` de ce dépôt dans
   `MQL5\Experts\` du dossier de données (on obtient
   `MQL5\Experts\GoldLiquidityScalper\Gold_Liquidity_Scalper.mq5` et le sous-dossier `GLS`).
3. Ouvrir `Gold_Liquidity_Scalper.mq5` dans **MetaEditor** (F4 depuis MT5) et
   compiler (**F7**). Résultat attendu : `0 errors, 0 warnings`.
4. Si le compilateur signale une erreur ou un avertissement : copier l'onglet
   « Erreurs » et me le transmettre ; il sera corrigé. Aucune dépendance externe
   n'est utilisée (pas de bibliothèque standard `Trade.mqh`).

Les fichiers source sont en UTF-8 avec BOM (accents français dans les textes).

## 3. Mise en route

1. Ouvrir un graphique du symbole or de votre compte (le nom exact dépend du type
   de compte Exness : `XAUUSD`, `XAUUSDm`, `XAUUSDc`… — l'EA le vérifie par ses
   devises XAU/USD et refuse un autre symbole). Unité de temps conseillée : M1.
2. Activer le bouton **Trading algorithmique** du terminal.
3. Glisser l'EA sur le graphique ; dans l'onglet « Commun », cocher
   « Autoriser le trading algorithmique ». Aucun identifiant ni mot de passe n'est
   demandé : l'EA utilise la session MT5 déjà connectée.
4. Cliquer **Vérifier la connexion** et lire chaque ligne (OK / ATTENTION / ÉCHEC).
   La ligne « Risque au volume min » indique si votre capital permet de respecter
   le risque par trade (voir § 6).
5. Cliquer **Démarrer le robot**. Sur un compte **réel**, une confirmation explicite
   est demandée à la première activation. Le démarrage n'ouvre aucune position :
   seul un signal valide **postérieur** au démarrage peut déclencher un ordre.
6. **Arrêter le robot** coupe les nouvelles entrées ; les positions ouvertes restent
   gérées (stops, prises partielles, sorties).

Plusieurs instances : utiliser un **Magic Number différent** par instance.

## 4. Tableau de bord

Affiché en haut à gauche du graphique :

| Ligne | Contenu |
|---|---|
| Titre | nom, version, famille active |
| Robot | EN MARCHE / ARRÊTÉ ; gestion des positions toujours active |
| Serveur | connecté / déconnecté, ping, état de reprise |
| Compte | DÉMO / RÉEL / BACKTEST, numéro, devise, autorisation du trading algo (avec la cause si refusé) |
| Symbole | symbole utilisé, M1 + contexte M5/M15 |
| Solde / Equity | |
| Jour (EA) | résultat net de l'EA du jour (réalisé + flottant), perte en %, drawdown journalier du compte |
| Trades du jour | nombre / maximum, positions ouvertes |
| Clôturés | trades gagnants / perdants, taux de réussite |
| PF / espérance | affichés à partir de `InpMinTradesForStats` (20) trades |
| Spread | actuel et maximum autorisé |
| Session | session de marché, fenêtre d'entrée, heure UTC |
| Annonces | état réel du filtre (calendrier MT5, fichier, ou **NON filtrées**) |
| Tendance | tendance M15 et M5 par votes, régime de marché, détail des votes M15 |
| Structure M5 | dernier BOS/CHOCH M5, position par rapport à l'EMA200, trou de données éventuel |
| Support / Résistance | zone la plus proche de chaque côté (bornes, réactions, M15, état) |
| FVG actives | nombre de FVG haussières / baissières actives en M5 et M1 |
| Jour | figures détectées / confirmées, signaux complets refusés / exécutés |
| Dernière figure | dernière figure de bougie interprétable et son statut |
| Dernier signal / refus / exécution | avec la raison du refus |
| Exécution | envois, exécutions, rejets, requotes, réponses incertaines, glissement, latence |
| Alertes | alertes envoyées, échecs d'envoi, dernière alerte |
| Protection | ACTIVE ou la protection déclenchée |
| Risque | risque par trade, risque ouvert, drawdown / limite |

Boutons :

- **Vérifier la connexion** : connexion serveur (ping), compte et type, trading
  autorisé sur le compte, trading par EA accepté par le serveur, bouton du
  terminal, autorisation de l'EA (quatre lignes distinctes : une connexion
  réussie n'est pas une autorisation de trader), symbole et séance, spécifications
  du contrat, volumes, niveaux de stop et de gel, mode d'exécution et de
  remplissage, données (âge du dernier tick, barres M1/M5/M15, synchronisation),
  spread, marge pour le volume minimal, risque au volume minimal, **contrôle d'un
  ordre réel sans envoi** (`OrderCheck`), annonces, heure et décalage UTC, état
  interne. Résultat affiché sous le tableau de bord et écrit dans le journal.
- **Démarrer le robot** : vérifie, puis active la recherche de signaux (confirmation
  sur compte réel, mémorisée par compte).
- **Arrêter le robot** : stoppe les nouvelles entrées, conserve la gestion.
- **Fermer toutes les positions** : confirmation obligatoire ; ne ferme que les
  positions de **cet EA** (Magic Number) sur ce symbole ; vérifie ensuite l'état réel
  sur le serveur et affiche le nombre de fermetures confirmées, d'échecs et de
  positions restantes.

## 5. Stratégie (résumé)

Famille par défaut **F1 — balayage de liquidité** :

- **M15** : structure dominante (BOS/CHOCH), régime tendance / range / transition ;
  pas de trade contre la tendance M15 (exception désactivable explicitement).
- **M5** : EMA 200 comme filtre (achat au-dessus, vente en dessous), structure.
- **M1** : un creux pertinent (plus bas fractal des 20 dernières barres, ou niveau
  M5/M15/veille/Asie) est balayé par une mèche, le prix **réintègre** rapidement
  sans s'installer sous le niveau, puis un **CHOCH M1** (clôture au-dessus du
  dernier sommet du mouvement de balayage) confirme. Entrée à la confirmation ou
  sur le **retest** de la zone. Stop sous l'extrême du balayage + marge ATR.
- Un **score** de 0 à 100 (8 composantes mesurables) doit atteindre 80 ; les refus
  obligatoires (spread, volatilité, stop trop large, prix trop avancé, espace
  insuffisant jusqu'à la liquidité opposée, coûts, sessions, annonces,
  protections…) ne sont jamais compensés par le score.

Cinq autres familles sont codées pour le protocole de comparaison : **F2**
tendance + pullback + reprise, **F3** cassure de range + confirmation + retest,
**F4** compression de volatilité + expansion confirmée, **F5** réaction confirmée
sur support / résistance, **F6** retest de FVG avec réaction confirmée. Elles
partagent exactement le même calcul de risque, les mêmes sorties et les mêmes filtres.

Modules d'analyse ajoutés en v1.10 (tous paramétrables et désactivables pour les
comparaisons A/B) :

- **bougies japonaises** : mesures de chaque bougie M1 clôturée, 15 figures
  (marteau, étoile filante, avalements, ligne pénétrante, nuage noir, étoiles du
  matin / du soir, pendu, rejet + confirmation, doji, impulsion, consolidation +
  reprise…) avec confirmation obligatoire ; une seule preuve de bougie par signal
  dans le score ; refus en cas de figure contraire confirmée, de déclenchement
  doji ou d'entrée tardive ;
- **tendance** M15 / M5 par votes (structure, sommets/creux, EMA 200, pente : l'EMA
  seule ne suffit jamais) et **régime** (tendance, range, transition, volatil,
  désordre) avec la liste des régimes autorisés par famille ;
- **supports / résistances** dynamiques (pivots confirmés, largeur adaptée à
  l'ATR, réactions indépendantes, zones M15 majeures, inversion de rôle seulement
  après confirmation) : pas d'achat dans ou juste sous une résistance ;
- **FVG / IFVG** : définitions exactes sur 3 bougies, qualité, suivi des retours
  et du comblement, doublons M1/M5 écartés ; une FVG ne déclenche jamais seule ;
- **Order Blocks** : module distinct (dernière bougie opposée avant une cassure
  impulsive) ; la confluence FVG + OB est une option de filtre, sans point de
  score, à conserver seulement si l'étude le justifie.

Paramètres ajoutés en v1.10 (onglet « Paramètres » de l'EA, valeurs par défaut et
règles exactes dans [docs/STRATEGIE.md](docs/STRATEGIE.md)) :

| Groupe | Paramètres principaux |
|---|---|
| Général | `InpRunLabel` (libellé des comparaisons A/B), `InpLogCandles`, `InpLogFvg` (aucun / principal / tout) |
| Filtres de marché | `InpMaxBarGapMin` (trou de données toléré) |
| Structure | `InpUseTrendFilter`, `InpEMAPeriodM15`, `InpTrendSlopeBars` |
| Régimes de marché | `InpUseRegimeFilter`, `InpRegimeVolatileRatio`, `InpRegimeChopAlternation`, `InpRegimesF1` … `InpRegimesF6` |
| Bougies japonaises | `InpCdlDisabled`, seuils de forme (`InpCdlDojiBodyRatio`, `InpCdlWickRatio`…), `InpCdlConfirmBars`, `InpCdlBlockOpposing`, `InpCdlBlockIndecision`, `InpCdlBlockExtended`, `InpCdlRequirePattern` |
| Supports / résistances | `InpZoneMergeATR`, `InpZonePadATR`, `InpZoneMinTouches`, `InpZoneMinSeparationBars`, `InpZoneBreakCloses`, `InpUseSRObstacles`, `InpSRMinStrength`, `InpSRReactBars` |
| FVG / imbalances | `InpFvgTF`, `InpFvgMinSizeATR`, `InpFvgMinDispATR`, `InpFvgMinQuality`, `InpFvgMaxRetests`, `InpFvgMaxAgeBars`, `InpUseIFVG`, `InpFvgRequireReaction` (recherche uniquement si false), `InpFvgObConfluence`, `InpUseFvgObstacles`, poids `InpFvgW*` |
| Order Blocks | `InpObLookback`, `InpObMinDispATR`, `InpObInvalidBufferATR`, `InpObConfluenceATR` |
| Score | `InpWCandle` (nouveau), `InpWTrigger`, `InpWStructure` ; `InpMinScore` reste à 80 |
| Alertes | `InpAlertPopup`, `InpAlertPush`, `InpAlertMail`, `InpAlertThrottleSec`, catégories `InpAlert*` |

Toutes les règles et valeurs numériques : [docs/STRATEGIE.md](docs/STRATEGIE.md).

Sessions par défaut (heures **locales**, changements d'heure calculés) :
Londres 08:00–11:30 (heure de Londres) et New York 08:00–11:30 (heure de New York).
L'heure du serveur est convertie en UTC par le décalage mesuré en direct
(`TimeTradeServer − TimeGMT`) ou par le réglage manuel (obligatoire en backtest :
`InpServerUTCOffsetHours`, `InpServerDST`).

Annonces : le calendrier économique MT5 (annonces USD de forte importance, blocage
30 min avant / après) est utilisé s'il répond ; sinon l'état **« NON filtrées »**
est affiché. Le mode « Obligatoire » bloque les entrées sans source fiable. En
backtest, seul un fichier d'annonces fourni par vous peut servir de source.

## 6. Risque et volume — le cas d'un capital de 10 €

```
budget       = min(equity × 0,5 %, limite journalière restante, risque agrégé restant)
perte / lot  = max(OrderCalcProfit(entrée → stop − glissement prévu),
                   ticks × valeur du tick « perte ») + commission aller-retour
volume       = budget / perte par lot, arrondi VERS LE BAS au pas de volume
```

- La conversion de devise (compte en EUR, profit en USD) est faite par MT5
  (`OrderCalcProfit` / valeur du tick) ; les deux méthodes sont comparées et la
  plus prudente est retenue.
- Si le **volume minimal** du courtier dépasse le budget : **refus** (« volume
  minimal > budget de risque »). Le risque n'est jamais relevé pour forcer une entrée.
- La marge requise est vérifiée (`OrderCalcMargin`, au plus `InpMaxMarginUsePct` = 30 %
  de la marge libre).
- Martingale, grille, doublement après perte et élargissement du stop sont absents
  par construction.

**Ordre de grandeur pour 10 €** (à confirmer avec le bouton « Vérifier la
connexion », qui affiche la valeur exacte pour votre compte) : sur un compte où
1 lot = 100 onces, le volume minimal de 0,01 lot correspond à 1 once ; un stop
M1 typique de 1,5 à 3 USD représente alors une perte de 1,5 à 3 USD, soit environ
**15 à 30 % d'un capital de 10 €**, contre un budget de 0,5 % (0,05 €). Sur ce type
de compte, **l'EA refusera donc pratiquement toutes les entrées**, ce qui est le
comportement voulu. Les comptes « Cent », dont les montants sont exprimés en
centimes, peuvent rendre ces tailles compatibles : vérifiez la ligne « Risque au
volume min » sur votre propre compte.

## 7. Gestion des positions

- Stop posé **dans l'ordre d'ouverture**, puis vérifié sur le serveur. S'il manque :
  pose immédiate ; si c'est impossible, **fermeture de sécurité** (paramétrable),
  alerte et journalisation.
- **TP1 +1 R** (⅓ du volume initial), **TP2 +2 R** (⅓), **TP3 +3 R** (reste, posé sur
  le serveur). R = distance entrée → stop initial. Si le volume ne peut pas être
  divisé sans créer de part inférieure au volume minimal : moitiés, ou objectif
  unique à 2 R.
- **Break-even** déclenché à +1 R (paramétrable), au prix d'entrée + commissions
  converties en prix + petite marge. Il ne garantit pas une sortie sans perte
  (glissement, gaps).
- **Verrouillage** à +1 R après TP2, **stop suiveur structurel** (derniers creux /
  sommets M1 confirmés, distance minimale en ATR) après +1,5 R d'avance.
- **Sorties anticipées codées** : 2 clôtures M1 au-delà du niveau d'invalidation
  (ex. le niveau balayé), BOS/CHOCH M5 contraire après l'entrée, absence de
  progression (45 min sans +0,5 R), durée maximale (180 min), perte > 1,3 R
  (gap/glissement), fermeture avant le week-end. Chaque sortie est journalisée avec
  son code et analysée dans les statistiques (« par méthode de sortie »).
- Le stop n'est **jamais** déplacé dans le sens qui augmente le risque (contrôlé
  avant chaque modification). Aucune position opposée n'est ouverte pour masquer
  une perte.

## 8. Protections et conventions

| Protection | Défaut | Référence |
|---|---|---|
| Transactions par jour | 15 | entrées de l'EA depuis le début de journée |
| Pertes consécutives | 3 | positions clôturées de la journée |
| Perte journalière | 2 % | −(résultat réalisé EA du jour + flottant EA) / equity de début de journée |
| Drawdown | 10 % | baisse de l'equity depuis son plus haut mémorisé |
| Risque agrégé | 1 % | perte si tous les stops ouverts sont touchés |
| Refroidissement | 300 s | après une erreur d'exécution ; suspension après 3 erreurs consécutives |
| Spread / volatilité / données | — | voir docs/STRATEGIE.md |

- **Journée** : commence à `InpDayResetHour` (0 h) en **heure du serveur**.
- **Equity de début de journée** : mémorisée à la réinitialisation ; si l'EA démarre
  en cours de journée sans valeur mémorisée : equity actuelle − résultat EA du jour.
- Le budget d'une nouvelle position est limité pour que la limite journalière ne
  puisse pas être dépassée même si **tous** les stops ouverts sont touchés.
- Une protection déclenchée **bloque les nouvelles entrées** ; les positions ouvertes
  restent gérées. Elles ne sont fermées automatiquement que si une règle le prévoit
  (`InpCloseOnDailyLimit`, fermeture du vendredi).

## 9. Redémarrage et reconnexion

À l'initialisation, puis à chaque reconnexion et dès qu'une incohérence est détectée :

1. relecture des positions et ordres du serveur ; identification par Magic Number
   et symbole ;
2. plan de chaque position relu dans les variables globales du terminal ; à défaut,
   **reconstruit** depuis le serveur (volume initial dans l'historique, risque initial
   dans le commentaire d'entrée ou le stop de l'ordre d'ouverture) ;
3. l'étape des prises partielles est déduite du **volume restant réel** : aucune
   prise partielle ne peut être rejouée ;
4. statistiques et compteurs du jour reconstruits depuis l'historique ;
5. signaux déjà exécutés mémorisés (empreinte dans les variables globales et dans
   le commentaire des positions) : jamais deux ordres pour le même signal ;
6. nouvelles entrées **suspendues** tant que l'état n'est pas cohérent, pendant une
   coupure, puis 30 s après la reconnexion. En cas de réponse incertaine du serveur
   (délai dépassé), le signal est marqué exécuté par prudence et l'état est relu.

## 10. Statistiques et fichiers produits

Tous les fichiers sont écrits dans le **dossier commun des terminaux**
(`Fichier → Ouvrir le dossier des données`, remonter jusqu'à `Terminal\Common\Files\GLS\`),
avec l'environnement dans le nom (`BACKTEST`, `DEMO`, `REEL`) :

| Fichier | Contenu |
|---|---|
| `GLS_<env>_<compte>_<symbole>_journal.csv` | tous les événements (ordres, refus, gestion, protections, erreurs) |
| `..._signals.csv` | chaque configuration complète : composantes du score, décision, raison, critères satisfaits / échoués, figure, régime, tendances, libellé |
| `..._trades.csv` | une ligne par **position** clôturée (partiels agrégés), avec régime, libellé et figure à l'entrée |
| `..._bougies.csv` | figures de bougies interprétables, à leur statut final (confirmée / invalidée / expirée) avec leurs mesures et leur contexte (`InpLogCandles` : aucun / principal / tout) |
| `..._fvg.csv` | FVG de l'unité de trading (hors doublons) : identifiant, création, 1er retour, comblement ou invalidation, avec tous leurs attributs et le lien éventuel avec un OB (`InpLogFvg`) |
| `..._ob.csv` | Order Blocks : création, 1er retour, invalidation |
| `..._rapport.txt` | synthèse : trades, réussite, PF, espérance (devise et R), drawdown, série de pertes, coûts observés et estimés, glissement, durée, et répartitions par session / famille / sortie / tranche de score |

Taux de réussite = positions gagnantes / positions clôturées × 100. Le résultat
d'une position inclut toutes ses clôtures partielles, commissions, swaps et frais.

## 11. Validation et comparaison des stratégies

Voir [docs/PROTOCOLE_VALIDATION.md](docs/PROTOCOLE_VALIDATION.md) : critères fixés
à l'avance, périodes développement / validation / test final séparées, mêmes coûts
et mêmes contraintes de risque pour les six familles, correction pour le nombre
de variantes, stress des coûts, Monte-Carlo, sensibilité des paramètres,
comparaisons A/B des filtres (référence, chaque filtre seul, tous), répartition par
régime, test final verrouillé, puis démo. L'outil `tools/analyze_trades.py`
produit le rapport et applique la règle de décision ; si aucune famille ne
satisfait les critères, **aucune n'est retenue**. Aucun paramètre n'est jamais
modifié automatiquement.

## 12. Vérifications réalisées

MetaEditor n'étant pas disponible dans l'environnement de développement (accès aux
serveurs MetaQuotes bloqué), le code a été vérifié par un banc de test hors
MetaTrader (`tests/`, lancer `tests/run_checks.sh`) :

1. **Contrôles des règles MQL5** absentes du C++ (`tests/mql2cpp.py`) : structures
   passées par valeur, initialisation de membres, références locales, constructions
   C++ non supportées…
2. **Compilation C++ stricte** du code de l'EA (g++ et clang++, avertissements
   traités comme erreurs : conversions implicites, masquage de variables,
   comparaisons signées…) avec une couche reproduisant les signatures MQL5 utilisées.
3. **49 tests** (2793 vérifications, g++ et clang++) exécutant réellement le code de l'EA contre un
   courtier simulé : heures d'été, indicateurs, BOS/CHOCH, détection des 6 familles
   (dont le cas « cassure qui continue » refusé), mesures et figures de bougies
   (haussières et miroirs baissiers, amplitude nulle, confirmation / invalidation /
   expiration, désactivation), tendance par votes et régimes, supports /
   résistances (regroupement, réactions indépendantes, inversion de rôle, cassure
   ratée), FVG / IFVG / OB (bornes, comblement, retours, invalidation), obstacles
   (prix dans une résistance), volume et refus au volume minimal, statistiques
   agrégées par position, protections, intégration complète sur données
   synthétiques (aucun stop élargi, stop présent à chaque ouverture, pas de TP
   partiel dupliqué, limite de positions et de trades, risque par trade borné),
   redémarrage après TP1 avec et sans variables globales, position sans stop,
   boutons et lignes du tableau de bord, compte réel, petit compte, coupure de
   connexion, pannes d'exécution injectées (requotes, erreurs non récupérables →
   suspension, délai dépassé), alertes, trou de données, comparaison A/B des
   filtres, volume des journaux, Order Blocks, doublons FVG M1/M5, absence de
   repaint, confluence FVG + OB, non-recomptage de la cassure, protections et
   journal de F6, variantes de l'étude FVG, cohérence des CSV. Les accès hors limites de tableau et les
   divisions par zéro font échouer les tests ; `tests/build/gls_tests "motif"`
   lance un sous-ensemble.
4. **Analyse mémoire** : les 49 tests ont aussi été exécutés sous
   AddressSanitizer et UndefinedBehaviorSanitizer : aucune erreur mémoire, aucune
   fuite, aucun comportement indéfini signalé.
5. **Outil d'analyse** : 13 tests Python (statistiques, Monte-Carlo, comparaison
   A/B, verdict des filtres, zones fraîches / revisitées, verrouillage du test
   final, rapports).

Ce banc **ne remplace pas** la compilation MetaEditor ni le testeur MT5 : le
courtier simulé est simplifié et les données sont synthétiques (sans valeur de
performance).

## 13. Limites connues

- Compilation MetaEditor à confirmer chez vous (§ 2).
- Le calendrier économique n'existe pas dans le testeur MT5 : backtests sans filtre
  d'annonces, sauf fichier fourni.
- En backtest, le décalage horaire du serveur doit être réglé manuellement.
- Les commentaires d'ordres servent de secours pour la reprise ; si votre courtier
  les modifie, la reprise s'appuie sur les variables globales et l'historique.
- Statistiques affichées sur l'historique des `InpStatsHistoryDays` (365) derniers jours.
- Avec un très petit capital, la plupart des entrées seront refusées (§ 6).
- Les filtres v1.10 réduisent fortement le nombre d'entrées sur les données
  synthétiques (obstacles S/R : aucune entrée F1) ; leur intérêt n'est pas
  démontré et doit être mesuré par les comparaisons A/B sur données réelles.
- Valeurs par défaut des nouveaux modules non calibrées ; figures de bougies sur
  M1 uniquement ; absorption « apparente » fondée sur le volume de ticks.
- Liste complète des défauts résiduels : [docs/AUDIT.md § 5](docs/AUDIT.md).
