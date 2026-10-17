# Protocole de validation et de comparaison des familles

Objectif : décider, **sur des données réelles et avec des règles fixées à
l'avance**, si l'une des six familles (F1–F4 de la v1.00, F5 et F6 ajoutées en
v1.10) présente un avantage robuste, et si les filtres de la v1.10 (régime,
tendance, bougies, obstacles S/R) l'améliorent réellement — et sinon, ne rien
retenir.

Aucune performance n'est revendiquée dans ce projet : **aucun test sur données
réelles n'a été exécuté** par le développeur (pas d'accès à MetaTrader ni aux
données de votre courtier depuis l'environnement de développement). Ce protocole
est à exécuter par vous dans MT5.

## 1. Pré-enregistrement (avant de lancer le moindre test)

1. Copier `tools/criteria_default.json`, l'adapter **une fois**, le dater et le
   conserver (par exemple dans un commit). Ne plus le modifier pendant l'étude.
2. Fixer les périodes, sans chevauchement, par exemple :
   - développement : 2021-01-01 → 2023-12-31 ;
   - validation : 2024-01-01 → 2024-12-31 ;
   - test final hors échantillon : 2025-01-01 → dernière date disponible.
3. Fixer la liste des variantes autorisées (par défaut : 6 familles × paramètres
   par défaut = **6 variantes**, plus les variantes A/B des filtres du § 3 bis).
   Toute variante ajoutée ensuite augmente le compteur `--variants` (correction
   pour tests multiples).

## 2. Réglages du testeur de stratégie MT5 (identiques pour toutes les familles)

| Réglage | Valeur |
|---|---|
| Expert | `GoldLiquidityScalper\Gold_Liquidity_Scalper` |
| Symbole | le symbole or de votre compte Exness (ex. XAUUSDm) |
| Période | M1 |
| Modélisation | **Chaque tick basé sur les ticks réels** |
| Délais d'exécution | **Délai aléatoire** (et un second passage avec un délai fixe élevé) |
| Dépôt / devise / levier | ceux de votre compte réel envisagé |
| Paramètres | fichiers `tester/sets/F1_balayage.set` … `F6_retest_fvg.set` ; comparaisons A/B : `tester/sets/ab_*.set` |
| `InpServerUTCOffsetHours` | décalage réel du serveur par rapport à UTC (en backtest, `TimeGMT()` n'est pas fiable : le réglage manuel est utilisé) |
| `InpCommissionPerLotSide` | commission réelle de votre type de compte (0 si aucune) |

Le testeur ne dispose pas du calendrier économique : les annonces ne sont **pas**
filtrées en backtest, sauf si vous fournissez un fichier d'annonces
(`InpNewsFile`, dossier commun `Files`, une ligne `AAAA.MM.JJ HH:MM;libellé` en UTC).

Chaque passage écrit dans `<dossier commun des terminaux>\Files\GLS\` :
`GLS_BACKTEST_<compte>_<symbole>_trades.csv` (une ligne par position),
`..._signals.csv` (chaque configuration complète, exécutée ou refusée, avec ses
composantes de score, critères satisfaits / échoués, régime et tendances),
`..._bougies.csv` (figures et leur statut final), `..._fvg.csv` (FVG et leur
évolution) et `..._rapport.txt`. Les fichiers s'ajoutent d'un passage à l'autre :
renseigner `InpRunLabel` (colonne `label`) pour chaque passage, ou renommer les
fichiers après chaque passage (`F1_trades.csv`, etc.), et ne jamais relancer deux
fois la même variante dans le même fichier (trades comptés deux fois).

## 3. Phase de développement

Lancer les 4 familles sur la période de développement. Il est permis
d'**examiner** les résultats (rapport par session, par sortie, par tranche de
score), mais chaque modification de règle crée une **nouvelle version** qui :
- reçoit un nouveau nom de fichier de résultats ;
- augmente le compteur de variantes ;
- est testée à son tour sur développement puis validation.

Calibration du score : lancer un passage de recherche avec `InpMinScore = 0`
(fichier `tester/sets/recherche_calibration.set`) et vérifier dans le rapport que
l'espérance augmente avec la tranche de score. Si ce n'est pas le cas, le seuil
de 80 n'est pas justifié et le score doit être revu (nouvelle version).

## 3 bis. Comparaisons A/B des filtres v1.10

Pour chaque famille retenue en développement, sur la **même période**, les mêmes
données et les mêmes coûts :

| Variante | Fichier | Contenu |
|---|---|---|
| référence | `ab_reference.set` | filtres v1.10 désactivés |
| + régime | `ab_regime.set` | référence + filtre de régime |
| + tendance | `ab_tendance.set` | référence + filtre de tendance M15/M5 |
| + bougies | `ab_bougies.set` | référence + figure contraire, doji, entrée tardive |
| + obstacles S/R | `ab_obstacles.set` | référence + obstacles (zones et FVG contraires) |
| tous | `ab_tous.set` | valeurs par défaut |
| stricte | `ab_figure_requise.set` | tous + figure confirmée obligatoire |

```
python3 tools/analyze_trades.py GLS_BACKTEST_*_trades.csv --group-by label \
    --baseline "F1|ab_reference" --dev 2021-01-01:2023-12-31 --val 2024-01-01:2024-12-31 \
    --variants 7 --criteria tools/criteria_default.json --out ab_F1.md
```

Le rapport ajoute, par période, l'écart d'espérance R de chaque variante par
rapport à la référence avec un intervalle bootstrap **indicatif** (les variantes
partagent les mêmes données : échantillons non indépendants) et la part de trades
conservés. Règle : un filtre n'est conservé que s'il améliore le résultat en
développement **et** en validation, sans faire tomber l'échantillon sous les
minimums ni dégrader le drawdown Monte-Carlo. Un filtre qui réduit fortement le
nombre de trades sans améliorer l'espérance est **retiré** (il ne fait que réduire
l'échantillon). Les tests synthétiques du dépôt montrent par exemple que les
obstacles S/R peuvent supprimer toutes les entrées F1 sur une marche aléatoire :
ce réglage doit être jugé sur données réelles, pas présumé utile.

**Régimes** : le tableau « Régime à l'entrée » (par famille) sert à fixer les
listes `InpRegimesF1` … `InpRegimesF6` **sur la période de développement
seulement** ; la liste choisie est ensuite vérifiée en validation (nouvelle
variante comptée). Ne jamais choisir les régimes à partir de la validation ou du test.

**Sensibilité** : pour la candidate, relancer en développement avec chaque
paramètre important décalé de ±20 % (seuils ATR des bougies, `InpZoneMergeATR`,
`InpFvgMinQuality`, `InpMinRoomR`, `InpMaxSLATR`, objectifs) en gardant les autres
fixes, avec un `InpRunLabel` par essai. Un résultat qui n'existe que pour une
valeur précise (pic isolé au lieu d'un plateau) est considéré comme du
sur-ajustement : la candidate est rejetée.

**Exécution défavorable** : en plus du stress des coûts de l'outil, refaire le
passage de validation avec un délai d'exécution élevé fixe et un spread fixe
élevé dans le testeur ; l'espérance doit rester positive. Le tableau de bord et le
journal mesurent en démo les requotes, rejets, glissements et latences réels (§ 5).

## 4. Analyse et décision

```
python3 tools/analyze_trades.py F1_trades.csv F2_trades.csv F3_trades.csv F4_trades.csv \
    F5_trades.csv F6_trades.csv \
    --dev 2021-01-01:2023-12-31 --val 2024-01-01:2024-12-31 \
    --test 2025-01-01:2025-12-31 --variants 6 \
    --criteria tools/criteria_default.json --env BACKTEST --out rapport.md
```

Le rapport donne, par famille et par période : nombre de trades, taux de réussite
(gagnantes / clôturées × 100), profit factor, résultat net, espérance par trade (en
devise et en R), intervalle de confiance bootstrap à 95 % de l'espérance en R,
p-valeur corrigée de Bonferroni, drawdown maximal (devise et R), plus longue série
de pertes, part des trimestres positifs, espérance sous **stress des coûts**
(+0,20 USD de prix par trade par défaut, soit environ un spread supplémentaire), glissement moyen, coûts, les répartitions par
session, sortie, tranche de score, sens, mode d'entrée, **régime à l'entrée** et
**figure de bougie** retenue, et un tableau de **robustesse** :

- **Monte-Carlo** (`mc_paths` = 1000 tirages avec remise des résultats en R) :
  drawdown médian, p95 et p99, résultat total au 5e centile et médian, probabilité
  d'un total ≤ 0. Hypothèse : trades indépendants (la dépendance réelle n'est pas
  modélisée ; le drawdown réel peut être plus élevé). Critère pré-enregistré :
  drawdown p95 ≤ `max_mc_drawdown_r_p95` (20 R) ;
- **dépendance aux meilleurs trades** : espérance R sans les 5 % meilleurs trades
  (une espérance qui devient fortement négative signale un résultat porté par
  quelques trades).

Règle de décision appliquée par l'outil :
1. une famille est **éligible** si elle réussit **tous** les critères en
   développement **et** en validation ;
2. parmi les éligibles, la candidate est celle dont la **borne basse** de l'IC95
   de l'espérance R en validation est la plus élevée (choix prudent, pas le
   meilleur résultat brut) ;
3. si aucune n'est éligible : **aucune stratégie n'est retenue** — le robot reste
   en recherche ou en démo ;
4. le test final hors échantillon n'est évalué qu'avec `--unlock-test`, **une seule
   fois**, après avoir figé la candidate et ses paramètres. Un échec à ce stade
   renvoie en recherche (pas de réglage « pour faire passer » le test).

## 5. Phase démo

Si une candidate réussit le test final : démo d'au moins 4 à 8 semaines avec les
mêmes paramètres. Comparer (rapport avec `--env DEMO`) glissement, spreads, taux
de rejet et espérance avec le backtest. Un écart important (coûts réels > coûts
simulés) invalide la conclusion du backtest.

Surveillance en démo : ligne « Exécution » du tableau de bord (envois, exécutions,
rejets, requotes, réponses incertaines, glissement moyen et maximal, latence),
alertes configurables (`InpAlertPopup`, `InpAlertPush`, `InpAlertMail` : erreurs,
limites de risque, arrêt, connexion ; anti-répétition `InpAlertThrottleSec`). Une
alerte est un message : elle ne prouve jamais qu'une opération a réussi, et une
absence d'alerte ne prouve pas que tout fonctionne. Aucun paramètre n'est modifié
automatiquement par l'EA ou l'outil d'analyse : tout changement est une nouvelle
version, testée à son tour.

## 6. Passage en réel

Seulement si la démo confirme : risque minimal, confirmation explicite demandée
par le bouton « Démarrer » à la première activation, surveillance des fichiers
`*_journal.csv`. Les résultats réels sont suivis séparément (`--env REEL`).
