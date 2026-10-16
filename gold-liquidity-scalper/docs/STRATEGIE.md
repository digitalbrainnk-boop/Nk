# Définitions exactes de la stratégie (v1.00)

Ce document décrit **les règles réellement codées** dans l'EA. Les noms entre
crochets sont les paramètres (`Inp...`) du fichier `Gold_Liquidity_Scalper.mq5` ;
les valeurs indiquées sont les valeurs par défaut.

Conventions communes :

- Les séries sont **chronologiques** et ne contiennent que des **barres clôturées**.
  La barre en formation n'est jamais utilisée pour un signal. Une décision est
  prise au premier tick d'une nouvelle barre M1, à partir de la barre qui vient de
  se clôturer (« dernière barre »).
- ATR = moyenne **simple** du True Range (même définition que l'indicateur ATR de
  MT5). ATR M1 sur 14 barres sauf mention contraire ; ATR100 = ATR M1 sur 100 barres.
- Toute la logique de détection est écrite pour un **achat**. Pour une **vente**,
  la même logique est appliquée à une série « miroir » (prix multipliés par −1,
  plus hauts et plus bas inversés), puis les prix sont reconvertis. Il n'existe
  donc qu'une seule implémentation, sans asymétrie involontaire.
- Les prix des barres sont des prix **bid**. Un stop de vente se déclenchant sur
  l'ask, le spread courant est ajouté au stop des ventes.

## 1. Structure de marché

**Sommet structurel (swing high) de force k** à l'index *i* :
`high[i] > high[j]` pour j = i−k … i−1 **et** `high[i] >= high[j]` pour j = i+1 … i+k.
Il n'est **connu qu'à la clôture de la barre i+k** (aucune donnée future).
Creux structurel : définition symétrique sur les plus bas.

| Unité | Force k | Paramètre |
|---|---|---|
| M1 (liquidité) | 2 | `InpM1SwingStrength` |
| M1 (micro-structure, CHOCH) | 1 | `InpMicroSwingStrength` |
| M5 | 2 | `InpM5SwingStrength` |
| M15 | 2 | `InpM15SwingStrength` |

**Cassure** : un niveau est cassé à la première **clôture** au-delà. Une mèche
seule ne casse pas un niveau (c'est un balayage).

**BOS / CHOCH** (M5 et M15) : en parcourant les barres dans l'ordre, à chaque
barre on compare la clôture au **dernier** sommet (ou creux) confirmé non encore cassé :

- clôture > dernier sommet : **CHOCH haussier** si la tendance était baissière,
  sinon **BOS haussier** ; la tendance devient haussière ;
- clôture < dernier creux : **CHOCH baissier** si la tendance était haussière,
  sinon **BOS baissier** ; la tendance devient baissière.

**Régime** (M5 et M15) : efficiency ratio de Kaufman
`ER = |close[n] − close[n−N]| / Σ|close[i] − close[i−1]|` (N = 16 en M15, 20 en M5).
Tendance si `ER >= InpTrendERMin` (0,30), sinon range ; **transition** si le
dernier événement est un CHOCH datant d'au plus `InpTransitionBars` barres (6 en M15).

## 2. Contexte multi-unités de temps

| Unité | Rôle | Règle |
|---|---|---|
| M15 | structure dominante | tendance BOS/CHOCH, régime ; **refus** si la tendance M15 est opposée au signal (`InpAllowCounterM15 = false`) ; **refus** si `ER M15 < InpMinM15Efficiency` (0,10 : marché sans direction exploitable) |
| M5 | filtre opérationnel | **EMA 200** (`InpEMAPeriodM5`) : achat seulement si la dernière clôture M5 > EMA, vente si < EMA (`InpUseEmaFilter`) ; structure M5 utilisée dans le score (et obligatoire pour F2) |
| M1 | déclenchement | règles des familles ci-dessous |

**Carte de liquidité** (niveaux « externes ») : 12 derniers sommets et creux M5 et
M15 confirmés, plus haut / plus bas de la **veille** (jour serveur), plus haut /
plus bas de la **plage asiatique** du jour UTC (`InpAsiaStartUTC`–`InpAsiaEndUTC`,
00:00–07:00, valide seulement après sa clôture). Chaque niveau mémorise l'instant
où il devient connu et celui où une clôture M5 l'a cassé.

## 3. Famille F1 — balayage de liquidité + réintégration + CHOCH M1

Recherche d'une configuration dont la première barre de balayage `s0` est dans les
`InpSetupMaxBars` (20) dernières barres.

1. **Niveau de liquidité**
   - *interne* : plus bas des creux fractals M1 (force 2) des `InpM1Lookback` (20)
     barres précédant `s0`, confirmé avant `s0`, et **jamais franchi** entre sa
     formation et `s0` ;
   - *externe* (`InpUseExternalLevels`) : niveau de la carte de liquidité, connu et
     intact au moment de `s0`, non franchi sur les 60 barres M1 précédentes.
2. **Balayage** : `low[s0] < niveau`. Extrême `e` = plus bas depuis `s0`.
   Profondeur `niveau − low[e]` comprise entre `InpSweepMinDepthATR` (0,05) et
   `InpSweepMaxDepthATR` (1,5) × ATR. Au-delà : vraie cassure, refus.
3. **Réintégration** : première clôture `> niveau + InpReclaimBufferATR (0,05) × ATR`
   à partir de `e`, au plus `InpReclaimMaxBars` (3) barres après `e` ; au plus
   `InpMaxAcceptanceCloses` (2) clôtures sous le niveau entre `s0` et la
   réintégration ; **aucune** clôture sous le niveau ensuite.
   → Une cassure qui « s'installe » sous le niveau n'est pas un balayage.
4. **CHOCH M1** : niveau de CHOCH = dernier sommet fractal M1 (force 1) formé entre
   `s0 − InpChochLookback` (10) et `e − 1` ; à défaut, max(high[e], high[e−1]).
   Confirmation : première clôture au-dessus, au plus `InpConfirmMaxBars` (6) barres
   après `e`.
5. **Entrée** (`InpEntryMode`, défaut « les deux », un seul trade par signal) :
   - *confirmation* : la barre de CHOCH est la dernière barre clôturée ;
   - *retest* : première barre après le CHOCH (au plus `InpRetestMaxBars` = 10) dont
     le plus bas touche la zone `[niveau ; niveau + max(50 % du déplacement, 0,2 ATR)]`,
     qui clôture au-dessus du niveau + tampon, haussière, clôture dans la moitié haute.
6. **Stop** : `low[e] − InpSLBufferATR (0,2) × ATR`. **Invalidation** : le niveau balayé.

## 4. Famille F2 — tendance + pullback + reprise

- Impulsion : plus haut H des `InpPBWindow` (30) dernières barres (au moins 2 barres
  avant la dernière) ; origine L0 = plus bas des `InpPBImpulseLookback` (20) barres
  avant H ; `H − L0 >= InpPBMinImpulseATR (2,0) × ATR`.
- Pullback : plus bas PL depuis H ; retracement `(H − PL)/(H − L0)` entre
  `InpPBMinRetrace` (0,382) et `InpPBMaxRetrace` (0,786).
- Reprise : première clôture au-dessus du dernier sommet fractal (force 1) du
  pullback (LH), clôture encore < H.
- Obligatoire : tendance structurelle M5 dans le sens du trade.
- Stop : `PL − 0,2 ATR`. Invalidation : retour sous LH.

## 5. Famille F3 — cassure de range + confirmation + retest

- Range : les `InpRangeBars` (30) barres avant la cassure `b` ; hauteur entre
  `InpRangeMinATR` (1,0) et `InpRangeMaxATR` (4,0) × ATR ; au moins 2 contacts dans
  les 15 % hauts et 2 dans les 15 % bas.
- Cassure : `close[b] > haut + 0,1 ATR`, corps ≥ 50 % de la barre, haussière ;
  `b` au plus `InpBreakoutMaxAge` (15) barres en arrière.
- Confirmation : `close[b+1] > haut` et aucune clôture de retour dans le range ensuite.
- Retest : première barre après `b+1` touchant `haut + InpRetestTolATR (0,3) × ATR`,
  clôturant au-dessus du haut, haussière, clôture dans la moitié haute.
- Stop : plus bas depuis `b` − 0,2 ATR. Invalidation : le haut du range.

## 6. Famille F4 — compression de volatilité + expansion confirmée

- Boîte : les `InpSqueezeBars` (12) barres avant l'expansion `e` (avant-dernière
  barre) ; hauteur ≤ `InpSqueezeBoxATR` (1,5) × ATR100 et ATR14/ATR100 ≤
  `InpSqueezeATRRatio` (0,75).
- Expansion : `close[e] > haut de boîte + 0,2 ATR100`, True Range ≥
  `InpExpansionTRATR` (1,5) × ATR100, corps ≥ 60 %, haussière.
- Confirmation (dernière barre) : clôture > haut de boîte, plus bas > milieu du corps
  de `e`, bougie non baissière.
- Stop : milieu de la boîte − 0,2 ATR. Invalidation : le haut de la boîte.

## 7. Contrôles communs et score

**Distance de stop** : si la distance logique est inférieure à
`max(InpMinSLATR (0,6) × ATR, niveau de stop du courtier + spread)`, le stop est
**éloigné avant l'entrée** jusqu'à ce minimum (le volume est calculé ensuite sur
cette distance). Après l'entrée, le stop n'est **jamais** élargi.

**Refus non compensables** (dans l'ordre de contrôle) : symbole non or ; état de
reprise en cours ; connexion absente ou délai après reconnexion ; trading non
autorisé ; données incohérentes ou obsolètes ; séance du courtier fermée ou fin de
séance proche ; hors fenêtre de session ; vendredi après l'heure limite ; annonce
économique ; protections (drawdown, perte journalière, pertes consécutives, nombre
de trades, suspension après erreurs, refroidissement) ; positions maximales ;
exposition existante ; spread (absolu, relatif à l'ATR, pic par rapport à la
médiane) ; volatilité (ATR14/ATR100 hors [0,5 ; 3], ATR < 2,5 × spread) ; contexte
M5/M15 ; stop trop large (> `InpMaxSLATR` 3 × ATR) ; prix ayant trop avancé
(> `InpMaxChaseFrac` 30 % du risque depuis la clôture de signal) ; espace jusqu'à la
liquidité opposée < `InpMinRoomR` (1 R) ; coût > `InpMaxCostToRiskFrac` (15 %) du
risque ; score < `InpMinScore` ; signal antérieur au démarrage ; signal déjà exécuté ;
position opposée ouverte ; volume minimal > budget de risque ; marge insuffisante ;
risque agrégé atteint ; signaux achat ET vente simultanés.

**Score (0–100)** = `100 × Σ(poids × composante) / Σ poids`, chaque composante dans [0 ; 1] :

| Composante | Poids | Calcul (F1 ; autres familles entre parenthèses) |
|---|---|---|
| Liquidité / configuration | 20 | base 0,6 (swing M1), 0,85 (niveaux égaux M1), 0,8 (M5), 1,0 (M15, veille, Asie) × 0,8 si profondeur hors [0,1 ; 0,8] ATR (F2 : profondeur du pullback ; F3 : contacts et hauteur du range ; F4 : étroitesse de la boîte) |
| Réintégration / déclencheur | 15 | 1 − 0,15 × barres de réintégration − 0,15 × clôtures sous le niveau (+0,1 si mèche de rejet ≥ 50 %) (F2 : force de l'impulsion ; F3 : corps de la cassure ; F4 : amplitude de l'expansion) |
| Confirmation structurelle | 20 | 0,7 (0,6 sans sommet fractal) + 0,3 × qualité du déplacement de la barre de CHOCH |
| Alignement M5/M15 | 15 | 0,5 × (M5 aligné 1 / neutre 0,5 / opposé 0) + 0,5 × (idem M15) |
| Retest | 10 | 1,0 retest avec mèche ≥ 40 %, 0,8 retest, 0,3 entrée à la confirmation (0,5 pour F2/F4) |
| Volatilité | 5 | 1 si ATR14/ATR100 ∈ [0,8 ; 1,6], décroissant au-delà |
| Coût d'exécution | 5 | 1 − rampe(coût/risque ; 3 % → 15 %) |
| Espace (R:R) | 10 | rampe(espace en R ; 1 → 3) |

Le seuil initial de 80 est un **point de départ de recherche**. Le score **n'est pas
une probabilité de réussite** ; sa relation avec les résultats doit être vérifiée
(tableau « par tranche de score » du rapport, en abaissant `InpMinScore` en
recherche pour observer aussi les scores bas).

## 8. Volume

Voir le README (section « Risque »). Résumé : volume = budget / perte au stop pour
1 lot (valorisée par `OrderCalcProfit` ET par la valeur du tick, la plus prudente
retenue, stop décalé de `InpSlippageAllowancePrice`, commission aller-retour
incluse), arrondi **vers le bas** ; refus si le volume minimal dépasse le budget.

## 9. Sorties

| Règle | Défaut | Détail |
|---|---|---|
| Stop initial | — | posé dans l'ordre d'ouverture, vérifié sur le serveur ; à défaut : pose immédiate, sinon fermeture de sécurité (`InpNoSLAction`) |
| TP1 / TP2 / TP3 | 1 R / 2 R / 3 R | ⅓, ⅓ et le reste du volume **initial** ; TP3 posé sur le serveur |
| Volume indivisible | — | moitiés (TP1 puis TP3) si chaque part ≥ volume min, sinon objectif unique `InpSingleTargetR` (2 R) |
| Break-even | à +1 R | stop à entrée + commission aller-retour convertie en prix + `InpBEExtraPrice` |
| Verrouillage | après TP2 | stop à +`InpLockAfterTP2R` (1 R) |
| Suiveur structurel | après +1,5 R de MFE | dernier creux (achat) / sommet (vente) M1 confirmé − 0,2 ATR, au moins `InpTrailATRMult` × ATR du prix, pas minimal 0,1 ATR |
| Invalidation | 2 clôtures M1 | clôtures consécutives au-delà du niveau d'invalidation − 0,1 ATR |
| Structure opposée | — | BOS ou CHOCH M5 contraire survenu après l'entrée |
| Temps max | 180 min | `InpMaxHoldMinutes` |
| Absence de progression | 45 min | sortie si l'excursion favorable max < 0,5 R |
| Risque excessif | −1,3 R | sortie immédiate (gap, glissement) |
| Week-end | vendredi 20:00 UTC | fermeture préventive |

L'étape des prises partielles est **déduite du volume restant sur le serveur** :
après un redémarrage, une prise partielle déjà faite ne peut pas être rejouée.
