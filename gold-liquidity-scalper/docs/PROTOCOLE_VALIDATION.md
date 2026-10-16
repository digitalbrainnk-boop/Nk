# Protocole de validation et de comparaison des familles

Objectif : décider, **sur des données réelles et avec des règles fixées à
l'avance**, si l'une des quatre familles présente un avantage robuste — et sinon,
ne pas en retenir.

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
3. Fixer la liste des variantes autorisées (par défaut : 4 familles × paramètres
   par défaut = **4 variantes**). Toute variante ajoutée ensuite augmente le
   compteur `--variants` (correction pour tests multiples).

## 2. Réglages du testeur de stratégie MT5 (identiques pour toutes les familles)

| Réglage | Valeur |
|---|---|
| Expert | `GoldLiquidityScalper\Gold_Liquidity_Scalper` |
| Symbole | le symbole or de votre compte Exness (ex. XAUUSDm) |
| Période | M1 |
| Modélisation | **Chaque tick basé sur les ticks réels** |
| Délais d'exécution | **Délai aléatoire** (et un second passage avec un délai fixe élevé) |
| Dépôt / devise / levier | ceux de votre compte réel envisagé |
| Paramètres | fichiers `tester/sets/F1_balayage.set` … `F4_compression.set` |
| `InpServerUTCOffsetHours` | décalage réel du serveur par rapport à UTC (en backtest, `TimeGMT()` n'est pas fiable : le réglage manuel est utilisé) |
| `InpCommissionPerLotSide` | commission réelle de votre type de compte (0 si aucune) |

Le testeur ne dispose pas du calendrier économique : les annonces ne sont **pas**
filtrées en backtest, sauf si vous fournissez un fichier d'annonces
(`InpNewsFile`, dossier commun `Files`, une ligne `AAAA.MM.JJ HH:MM;libellé` en UTC).

Chaque passage écrit dans `<dossier commun des terminaux>\Files\GLS\` :
`GLS_BACKTEST_<compte>_<symbole>_trades.csv` (une ligne par position),
`..._signals.csv` (chaque configuration complète, exécutée ou refusée, avec ses
composantes de score) et `..._rapport.txt`. Renommer les fichiers après chaque
famille (`F1_trades.csv`, etc.) car le nom ne contient pas la famille.

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

## 4. Analyse et décision

```
python3 tools/analyze_trades.py F1_trades.csv F2_trades.csv F3_trades.csv F4_trades.csv \
    --dev 2021-01-01:2023-12-31 --val 2024-01-01:2024-12-31 \
    --test 2025-01-01:2025-12-31 --variants 4 \
    --criteria tools/criteria_default.json --env BACKTEST --out rapport.md
```

Le rapport donne, par famille et par période : nombre de trades, taux de réussite
(gagnantes / clôturées × 100), profit factor, résultat net, espérance par trade (en
devise et en R), intervalle de confiance bootstrap à 95 % de l'espérance en R,
p-valeur corrigée de Bonferroni, drawdown maximal (devise et R), plus longue série
de pertes, part des trimestres positifs, espérance sous **stress des coûts**
(+0,20 USD de prix par trade par défaut, soit environ un spread supplémentaire), glissement moyen, coûts, et les répartitions par
session, sortie, tranche de score, sens et mode d'entrée.

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

## 6. Passage en réel

Seulement si la démo confirme : risque minimal, confirmation explicite demandée
par le bouton « Démarrer » à la première activation, surveillance des fichiers
`*_journal.csv`. Les résultats réels sont suivis séparément (`--env REEL`).
