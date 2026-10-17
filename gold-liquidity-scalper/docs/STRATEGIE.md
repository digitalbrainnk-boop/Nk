# Définitions exactes de la stratégie (v1.11)

Ce document décrit **les règles réellement codées** dans l'EA. Les noms entre
crochets sont les paramètres (`Inp...`) du fichier `Gold_Liquidity_Scalper.mq5` ;
les valeurs indiquées sont les valeurs par défaut. Les valeurs par défaut des
modules ajoutés en v1.10 sont des **points de départ de recherche**, pas des
réglages validés : elles doivent passer le protocole (`docs/PROTOCOLE_VALIDATION.md`).

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
  donc qu'une seule implémentation, sans asymétrie involontaire (y compris pour les
  figures de bougies, les zones et les FVG).
- Les prix des barres sont des prix **bid**. Un stop de vente se déclenchant sur
  l'ask, le spread courant est ajouté au stop des ventes.
- Un niveau, une zone, une FVG ou une figure n'est utilisé qu'à partir de l'instant
  où il est **connu** (confirmation du pivot, clôture de la 3e bougie…).

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

**BOS / CHOCH** (M1, M5 et M15) : en parcourant les barres dans l'ordre, à chaque
barre on compare la clôture au **dernier** sommet (ou creux) confirmé non encore cassé :

- clôture > dernier sommet : **CHOCH haussier** si la tendance était baissière,
  sinon **BOS haussier** ; la tendance devient haussière ;
- clôture < dernier creux : **CHOCH baissier** si la tendance était haussière,
  sinon **BOS baissier** ; la tendance devient baissière.

Les événements sont datés et conservés (utilisés par les FVG : « le déplacement
a-t-il produit un BOS/CHOCH ? »).

**Efficience** (M5 et M15) : efficiency ratio de Kaufman
`ER = |close[n] − close[n−N]| / Σ|close[i] − close[i−1]|` (N = 16 en M15, 20 en M5).

## 2. Contexte multi-unités de temps

| Unité | Rôle | Règle |
|---|---|---|
| M15 | structure dominante | **refus** si la structure BOS/CHOCH M15 est opposée au signal (`InpAllowCounterM15 = false`) ; **refus** si `ER M15 < InpMinM15Efficiency` (0,10 : marché sans direction exploitable) ; tendance par votes (§ 2.1), régime (§ 2.2), zones majeures (§ 2.3) |
| M5 | filtre opérationnel | **EMA 200** (`InpEMAPeriodM5`) : achat seulement si la dernière clôture M5 > EMA, vente si < EMA (`InpUseEmaFilter`) ; tendance par votes, zones opérationnelles, FVG (§ 2.4) ; structure M5 obligatoire pour F2 |
| M1 | déclenchement | règles des familles ; figures de bougies (§ 2.5) sur barres M1 clôturées |

**Carte de liquidité** (niveaux « externes ») : 12 derniers sommets et creux M5 et
M15 confirmés, plus haut / plus bas de la **veille** (jour serveur), plus haut /
plus bas de la **plage asiatique** du jour UTC (`InpAsiaStartUTC`–`InpAsiaEndUTC`,
00:00–07:00, valide seulement après sa clôture). Chaque niveau mémorise l'instant
où il devient connu et celui où une clôture M5 l'a cassé.

**Intégrité des données** : en plus des contrôles de fraîcheur et de cohérence des
cotations, un **trou** de plus de `InpMaxBarGapMin` (3) minutes entre deux barres
M1 parmi les 30 dernières bloque les entrées (« données de marché incohérentes ou
obsolètes », affiché dans le tableau de bord).

### 2.1 Tendance par votes (M15 et M5) — `Trend.mqh`

Quatre votes mesurables, chacun +1 / 0 / −1 :

| Vote | Règle |
|---|---|
| structure | tendance BOS/CHOCH de l'unité (§ 1) |
| sommets / creux | +1 si le dernier sommet ET le dernier creux confirmés sont plus hauts que les précédents (HH + HL), −1 s'ils sont plus bas (LH + LL), sinon 0 |
| côté de l'EMA 200 | dernière clôture au-dessus / en dessous de l'EMA 200 de l'unité (`InpEMAPeriodM15`, `InpEMAPeriodM5`) |
| pente de l'EMA 200 | EMA − EMA `InpTrendSlopeBars` (10) barres plus tôt, au-delà de ±0,1 ATR de l'unité |

- **Haussière** seulement si : structure = +1, aucun vote négatif, somme ≥ 2, et
  aucun CHOCH depuis `InpTransitionBars` barres (M15 ; × 3 en M5). Baissière :
  symétrique. **L'EMA 200 seule ne suffit jamais** (structure obligatoire).
- **Transition** : CHOCH récent, ou votes contradictoires avec `ER >= InpTrendERMin` (0,30).
- **Latérale** : sinon.

Filtre de tendance (`InpUseTrendFilter`, désactivable pour les comparaisons) :
refus si la tendance M15 par votes est opposée (sauf `InpAllowCounterM15`), et
pour les **continuations** (F2, F3, F4, F6) si la tendance M5 est opposée.
La composante d'alignement du score utilise ces tendances (§ 9).

### 2.2 Régimes de marché

Calculé à chaque barre M1 à partir de la tendance M15 et de la volatilité M5 :

| Régime | Condition (évaluée dans cet ordre) |
|---|---|
| VOLATIL | ATR14 M5 / ATR100 M5 ≥ `InpRegimeVolatileRatio` (1,8) |
| DESORDRE | alternance de couleur des 12 dernières bougies M5 ≥ `InpRegimeChopAlternation` (70 %) **et** ER M15 < 0,15 |
| TENDANCE | tendance M15 haussière ou baissière |
| TRANSITION | tendance M15 en transition |
| RANGE | sinon |
| INCONNU | données insuffisantes : **jamais autorisé** |

Régimes autorisés par famille (`InpUseRegimeFilter`, listes `InpRegimesF1` …
`InpRegimesF6`) — valeurs initiales à **vérifier** avec le rapport « par régime »
de l'outil d'analyse : F1 TENDANCE, RANGE, TRANSITION ; F2 TENDANCE ; F3 et F4
RANGE, TRANSITION ; F5 TENDANCE, RANGE ; F6 TENDANCE, TRANSITION. VOLATIL et
DESORDRE ne sont autorisés pour aucune famille par défaut. Le régime à l'entrée
est enregistré pour chaque signal et chaque position.

### 2.3 Supports / résistances dynamiques — `Zones.mqh`

- **Pivots** : sommets/creux structurels M5 (40 derniers de chaque type) et M15
  (30 derniers) **parmi ceux confirmés** à l'instant de l'analyse (un pivot
  postérieur ne modifie ni la sélection ni les zones).
- **Origine** : chaque zone indique l'unité de ses pivots (`M5`, `M15` ou
  `M5+M15`) ; des pivots M5 et M15 proches forment **une seule** zone (pas de doublon).
- **Regroupement** : pivots dont l'écart ≤ `InpZoneMergeATR` (0,5) × ATR M5 ;
  bornes = pivots extrêmes ± `InpZonePadATR` (0,15) × ATR M5 (largeur adaptée à la
  volatilité).
- **Réactions indépendantes** : pivots séparés d'au moins `InpZoneMinSeparationBars`
  (5) barres M5. **Validité** : ≥ `InpZoneMinTouches` (2) réactions, ou pivot M15
  (zone **majeure**). Rôle d'origine : majorité de sommets → résistance, de creux → support.
- **Sommets / creux égaux** : 2 pivots du même type à ≤ 0,1 ATR et ≥ 5 barres
  d'écart (concentration probable d'ordres stop au-delà).
- **Force** (0–1) = 0,3 + 0,15 × min(réactions − 1, 3) + 0,2 (M15) + 0,1 (égaux)
  + 0,1 (rôle inversé confirmé).
- **Cassure confirmée** : `InpZoneBreakCloses` (2) clôtures M5 consécutives au-delà
  de la zone + `InpZoneBreakBufferATR` (0,1) ATR → rôle « en attente ».
- **Inversion de rôle** (résistance → support) seulement après la cassure confirmée
  PUIS un retour dans la zone suivi d'une clôture au-delà. **Cassure ratée** :
  après la cassure, clôture de retour de l'autre côté → rôle d'origine conservé.

**Obstacles** : pour un achat, les résistances de force ≥ `InpSRMinStrength`
(0,5) (`InpUseSRObstacles`) et les FVG baissières actives de l'unité `InpFvgTF`,
hors doublons, de qualité ≥ `InpFvgMinQuality` (0,55) (`InpUseFvgObstacles`)
réduisent l'**espace** disponible (§ 9) :
espace jusqu'au bord le plus proche ; **prix à l'intérieur d'une résistance →
refus** (« prix dans une résistance ») ; prix à l'intérieur d'une FVG contraire →
espace jusqu'à son bord lointain. Vente : symétrique. Ces obstacles s'ajoutent à
la liquidité opposée de la v1.00, sans double comptage (seul l'obstacle le plus
proche compte).

### 2.4 FVG, IFVG et Order Blocks — `Fvg.mqh`

Indices chronologiques de barres clôturées, figure de 3 bougies i−2, i−1, i
(i = la plus récente) :

- **FVG haussière** : `low[i] > high[i−2]`, zone `[high[i−2] ; low[i]]` ;
  **baissière** : `high[i] < low[i−2]`, zone `[high[i] ; low[i−2]]`.
- La bougie i−1 (déplacement) doit aller dans le sens du déséquilibre ; un écart
  < 0,5 × `InpFvgMinSizeATR` × ATR est ignoré (bruit). Unité de trading : M5 par
  défaut (`InpFvgTF`, M1 possible) ; les FVG M1 sont aussi suivies (contexte, journal).
- **Identifiant** : `unité|sens|heure de création` (+ `|I` pour une IFVG) ;
  **identifiant du déplacement** = heure d'ouverture de la bougie i−1.
- **Doublons entre unités** : une FVG M1 recouverte à ≥ 50 % par une FVG M5 du
  même sens et formée pendant les 3 bougies de celle-ci est la même imbalance :
  marquée « doublon de » la FVG M5, elle n'est ni comptée, ni tradée, ni utilisée
  comme obstacle. Seule l'unité `InpFvgTF` sert à F6 et aux obstacles.
- Enregistré : sens, bornes, unité, heure de création (clôture de i), taille en
  points et en ATR, amplitude et corps du déplacement, BOS/CHOCH produit par le
  déplacement (barres i−1 à i+2, avec son heure), balayage préalable (creux
  confirmé percé puis repris entre i−5 et i−1), distance à une zone S/R favorable,
  retours, comblement, statut, heure du statut, qualité, lien éventuel avec un
  Order Block (§ 2.4 bis), raison. La cassure peut être attribuée jusqu'à 2 barres
  après la création (barres déjà clôturées) : la zone n'apparaît jamais
  rétroactivement, seul cet attribut est complété, et une cassure attribuée ne
  disparaît jamais.
- **Comblement** (haussière) = (haut − plus bas atteint depuis la création) /
  largeur, borné [0 ; 1] ; baissière : symétrique. **Retour** = chaque nouvelle
  entrée du prix dans la zone après en être sorti.
- **Statuts** : fraîche (0 %), partiellement comblée, comblée (100 %), **invalidée**
  (clôture sous le bas − `InpFvgInvalidBufferATR` (0,1) × ATR ; baissière : clôture
  au-dessus du haut + tampon). L'historique complet est conservé dans `_fvg.csv`.
- **IFVG** (`InpUseIFVG`, désactivé par défaut) : règle distincte ; une FVG
  invalidée devient une zone de sens opposé, connue à l'instant de l'invalidation,
  suivie avec les mêmes règles.
- **Qualité** (0–1, critères **intrinsèques** seulement ; la tendance, les coûts et
  l'espace sont évalués une seule fois, au niveau du signal ; l'Order Block n'en
  fait **pas** partie) :

| Critère | Poids | Mesure |
|---|---|---|
| déplacement `InpFvgWDisp` | 25 | rampe(amplitude/ATR ; `InpFvgMinDispATR` 1,0 → 2,5) × (0,5 + 0,5 × rampe(corps ; 50 % → 85 %)) |
| taille `InpFvgWSize` | 10 | rampe(taille/ATR ; 0,10 → 0,40) |
| structure `InpFvgWStructure` | 20 | 1 si BOS/CHOCH, sinon 0,3 |
| balayage `InpFvgWSweep` | 15 | 1 si balayage préalable, sinon 0,4 |
| fraîcheur `InpFvgWFresh` | 20 | 0 retour 1 ; 1 → 0,7 ; 2 → 0,4 ; plus 0,1 ; comblée/invalidée 0 |
| contexte `InpFvgWContext` | 10 | 1 si zone S/R favorable à ≤ 1 ATR, sinon 0,5 |

Une FVG **ne déclenche jamais seule** une entrée (famille F6, § 8). La détection
d'une zone n'est **pas** une preuve d'opportunité rentable.

### 2.4 bis Order Blocks — `OrderBlocks.mqh` (concept distinct des FVG)

Règles propres (haussier ; baissier symétrique), sur l'unité `InpFvgTF` :

1. un événement de structure haussier (BOS ou CHOCH) sur la barre j, connu à la
   **clôture** de j ;
2. l'Order Block est la **dernière bougie baissière** parmi les `InpObLookback`
   (5) barres précédant j (barre k) ;
3. le déplacement k+1 … j est impulsif : `clôture[j] − bas[k] ≥ InpObMinDispATR`
   (1,5) × ATR(k), et au moins une bougie du sens de corps ≥ 60 % et d'amplitude ≥ 1 ATR ;
4. zone = `[bas[k] ; haut[k]]`, connue à la clôture de j (jamais avant) ;
   identifiant `OB|unité|sens|heure de la bougie k`, déplacement = k+1 … j ;
5. **retour** = nouvelle entrée du prix dans la zone ; statut frais → retesté ;
   **invalidation** = clôture sous `bas − InpObInvalidBufferATR` (0,1) × ATR.

Un OB peut exister **sans** FVG (cassure sans écart entre les bougies) et une FVG
sans OB (écart sans cassure de structure). Journal : `_ob.csv`.

**Confluence FVG + OB** (`InpFvgObConfluence`, **ignorée par défaut**) : un OB
actif du même sens, de la même unité, en contact avec la FVG ou à ≤
`InpObConfluenceATR` (0,5) × ATR. Le lien indique si l'OB provient du **même
déplacement** que la FVG (une seule information : FVG, OB et cassure décrivent le
même mouvement) ou d'un déplacement distinct. La confluence n'ajoute **aucun point
de score** ; en mode « exigée », elle sert de **filtre de sélection** pour F6, à
conserver seulement si le protocole montre un gain hors échantillon. La confluence
n'est connue qu'à l'instant où les deux zones le sont.

### 2.5 Bougies japonaises — `Candles.mqh`

**Mesures** (par bougie clôturée) : corps, mèches, amplitude, corps/amplitude,
mèches/amplitude, mèches/corps (corps plancher 2 % de l'amplitude), position de la
clôture dans l'amplitude, amplitude en ATR, taille relative aux 10 précédentes,
dépassement / clôture au-delà du plus haut ou plus bas précédent.
**Amplitude nulle, mèche négative ou ATR nul : bougie non mesurable** (aucune
figure, aucune division). Doji : corps ≤ `InpCdlDojiBodyRatio` (10 %) de l'amplitude.

Figures (écrites pour le sens haussier ; la version baissière est la même règle
appliquée à la série miroir) :

| Code | Haussière / baissière | Condition principale |
|---|---|---|
| HAM | marteau / étoile filante | mèche basse ≥ 60 % (`InpCdlWickRatio`) et ≥ 2 × corps (`InpCdlWickToBody`), mèche opposée ≤ 15 % (`InpCdlOppWickMaxRatio`), amplitude ≥ 0,3 ATR (`InpCdlMinRangeATR`) |
| IHAM | marteau inversé / pendu | même règle sur la mèche haute ; figure faible, confirmation indispensable |
| ENG | avalement haussier / baissier | corps englobant strictement le corps opposé précédent, corps ≥ max(0,3 ATR, corps précédent), clôture dans les 40 % hauts |
| PIER | ligne pénétrante / couverture en nuage noir | bougie opposée de corps ≥ 50 % et ≥ 0,4 ATR, puis clôture au-delà de son milieu sans l'englober |
| STAR | étoile du matin / du soir | bougie forte (corps ≥ 60 % et ≥ 0,5 ATR), petit corps (≤ 30 % du premier) sans retour, bougie inverse clôturant au-delà du milieu de la première |
| RCONF | rejet + confirmation | mèche de rejet ≥ 50 % sur un nouvel extrême local, puis clôture au-delà de l'extrême opposé de la bougie de rejet |
| PIN | pin bar | mèche ≥ 66 %, corps dans le tiers opposé, extrême au-delà des 3 bougies précédentes |
| FBRK | échec de cassure | extrême des 10 précédentes dépassé puis clôture de retour (même bougie ou suivante) |
| DOJI, SPIN, HESIT | indécision (neutres) | doji ; petit corps (≤ 30 %) à deux mèches ; 4 bougies alternées qui se chevauchent sans progression |
| IMP | impulsion | corps ≥ 70 %, clôture dans les 20 % hauts, amplitude ≥ 1,5 ATR (`InpCdlImpulseATR`), clôture au-delà du plus haut précédent |
| CONT | consolidation puis reprise | impulsion, bougies internes réduites dans sa moitié haute, clôture au-delà de l'impulsion |
| SEQ | séquence composée | impulsion → ralentissement (≥ 2 bougies d'amplitude décroissante) → rejet → reprise |
| ABS | absorption **apparente** | volume de **ticks** ≥ `InpCdlAbsorbVolMult` (2) × moyenne avec petit corps ; désactivée par défaut (`InpCdlDisabled = "ABS"`) ; aucune absorption institutionnelle n'est affirmée |

Toute figure peut être désactivée par son code (`InpCdlDisabled`, ex. `ABS,IHAM`).
Les retournements exigent un **mouvement préalable** cohérent (≥
`InpCdlPriorMoveATR` (1,0) ATR sur les 6 bougies précédentes) ; les continuations,
une hausse préalable.

**Statuts** : détectée → **confirmée** (clôture au-delà de l'extrême de la figure
dans son sens dans les `InpCdlConfirmBars` (3) bougies suivantes), **invalidée**
(clôture au-delà de l'extrême opposé avant), **expirée** (aucune des deux). RCONF,
CONT et SEQ sont confirmées par leur propre dernière bougie ; les figures neutres
sont informatives.

**Interprétation contextuelle** : proximité d'une zone favorable (support, FVG du
même sens active, niveau de liquidité à ≤ `InpCdlZoneProxATR` (0,5) ATR de
l'extrême de la figure), zone opposée à moins d'1 ATR, bruit (spread > 35 % de
l'amplitude), alignement avec la tendance M15 (à défaut M5). Une figure orientée
est « interprétable » si sa forme, son mouvement préalable, l'absence de bruit et
d'obstacle immédiat et l'alignement sont cohérents, et qu'elle est près d'une
zone (ou est une continuation alignée). Ces informations sont journalisées.

**Rôles des unités** : les figures sont lues sur M1 (déclenchement) ; M15 et M5
fournissent le contexte (tendance, régime, zones, FVG) et ne produisent pas de
figures dans cette version.

### 2.6 Unités de temps et absence de repainting

| Unité | Rôle | Objets |
|---|---|---|
| M15 | contexte supérieur, zones majeures | structure, tendance par votes, régime, pivots des zones majeures |
| M5 | structure opérationnelle, zones pertinentes | structure, tendance, zones S/R, FVG et Order Blocks de trading (`InpFvgTF` = M5) |
| M1 | déclenchement, entrée | liquidité, figures de bougies, CHOCH M1, FVG M1 de contexte (doublons des FVG M5 marqués) |

Règles communes : séries de **barres clôturées** uniquement ; chaque objet porte
l'instant où il devient connu (pivot : clôture de la barre i+k ; FVG : clôture de
la 3e bougie ; OB : clôture de la cassure ; zone S/R : confirmation de son 1er
pivot ; confluence : la plus tardive des deux zones) et n'est utilisé qu'après.
Le banc de test vérifie qu'un calcul fait avec les données jusqu'à T et un calcul
fait avec des données ultérieures donnent les **mêmes** pivots, cassures, FVG, OB
et zones connus à T (test « absence de repaint »).

**Utilisation dans la décision** (sans redondance) :

- **une seule preuve de bougie** par signal, dans la composante « bougies » du
  score (§ 9) : la meilleure figure **confirmée** du sens du trade entre la barre
  d'ancrage du signal − 2 et la dernière barre ; force × (1 ou 0,5 si mouvement
  préalable absent) × (0,5 si bruit) × (0,5 si obstacle). Exclusions pour ne pas
  compter deux fois la même chose : F1 ignore FBRK (le balayage EST un échec de
  cassure), F3/F4 ignorent IMP (l'expansion est déjà notée). Sans preuve : 0,3 ;
  avec : 0,4 + 0,6 × preuve. La forme des mèches n'est plus notée ailleurs ;
- **figure contraire confirmée** (retournement ou rejet, contexte cohérent) dans
  les `InpCdlOpposingBars` (3) dernières barres : composante 0 et **refus** si
  `InpCdlBlockOpposing` ;
- **bougie de déclenchement doji** : composante ≤ 0,1 et **refus** si
  `InpCdlBlockIndecision` ;
- **entrée tardive** : bougie de déclenchement > `InpCdlMaxTriggerATR` (2,5) ATR ou
  mouvement > `InpCdlMaxExtensionATR` (3,0) ATR sur 5 barres → **refus** si
  `InpCdlBlockExtended` ;
- `InpCdlRequirePattern` (désactivé) : exiger une figure confirmée pour toute famille.

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

## 7. Famille F5 — réaction confirmée sur support / résistance (v1.10)

Achat sur support confirmé (vente : résistance, par la série miroir) :

1. **Zone** : support valide (§ 2.3) de force ≥ `InpSRMinStrength` (0,5), connu
   **avant** la fenêtre des `InpSRReactBars` (8) dernières barres M1.
2. **Contact** : première barre de la fenêtre dont le plus bas ≤ haut de zone +
   0,1 ATR, la barre précédente ayant clôturé au-dessus du bas de zone (arrivée par le haut).
3. **Zone tenue** : aucune clôture sous `bas − InpZoneBreakBufferATR × ATR` depuis
   le contact ; sinon refus (zone cassée).
4. **Réaction** : figure haussière de retournement, de rejet ou composée (§ 2.5)
   touchant la zone, **confirmée sur la dernière barre clôturée**, et clôture
   au-dessus de la zone. **Une figure seule ne suffit pas** : zone, confirmation,
   contexte et tous les contrôles communs restent obligatoires ; sans confirmation,
   le signal reste « en attente ».
5. Achat **interdit sous une résistance** proche ou dans une résistance (obstacles, § 2.3).
6. **Stop** : min(plus bas de la réaction, bas de zone) − `InpSLBufferATR` × ATR.
   **Invalidation** : bas de la zone. Entrée de type retest.

## 8. Famille F6 — retest de FVG avec réaction confirmée (v1.10)

1. **FVG** du sens du trade (§ 2.4), unité `InpFvgTF` (M5), hors doublons, fraîche
   ou partiellement comblée, qualité ≥ `InpFvgMinQuality` (0,55), retours ≤
   `InpFvgMaxRetests` (1), âge ≤ `InpFvgMaxAgeBars` (48) barres de son unité,
   connue avant le contact. IFVG utilisées seulement si `InpUseIFVG`. Si
   `InpFvgObConfluence` = exigée : Order Block en confluence connu avant le contact,
   sinon refus « pas de confluence FVG + Order Block ».
2. **Contact** : première entrée dans la zone parmi les `InpFvgReactBars` (8)
   dernières barres M1, la barre précédente étant hors zone.
3. **Zone tenue** : aucune clôture sous `bas − InpFvgInvalidBufferATR × ATR`.
4. **Pas d'entrée au premier contact** : il faut une **réaction** = figure
   confirmée sur la dernière barre et/ou CHOCH M1, avec clôture au-dessus du milieu
   de la zone. `InpFvgRequireReaction = false` n'existe que pour la variante de
   recherche « détection seule » du protocole : l'EA **refuse de démarrer** avec ce
   réglage hors du testeur de stratégie.
   Les confirmations présentes ou absentes (figure, CHOCH M1, OB) sont écrites dans
   le détail du signal ; chaque zone en attente ou refusée est journalisée une fois
   par changement d'état (décision `ATTENTE` ou `REFUS`, motif précis).
5. Refus si les unités de temps se contredisent (filtres de tendance et de régime),
   si la zone est invalidée, ou si l'espace / le rendement-risque est insuffisant.
6. **Stop** : min(plus bas depuis le contact, bas de zone) − `InpSLBufferATR` × ATR.
   **Invalidation** : bas de la zone.

## 9. Contrôles communs et score

**Distance de stop** : si la distance logique est inférieure à
`max(InpMinSLATR (0,6) × ATR, niveau de stop du courtier + spread)`, le stop est
**éloigné avant l'entrée** jusqu'à ce minimum (le volume est calculé ensuite sur
cette distance). Après l'entrée, le stop n'est **jamais** élargi.

**Refus non compensables** (dans l'ordre de contrôle) : symbole non or ; état de
reprise en cours ; connexion absente ou délai après reconnexion ; trading non
autorisé ; données incohérentes, obsolètes ou **trouées** ; séance du courtier
fermée ou fin de séance proche ; hors fenêtre de session ; vendredi après l'heure
limite ; annonce économique ; protections (drawdown, perte journalière, pertes
consécutives, nombre de trades, suspension après erreurs, refroidissement) ;
positions maximales ; exposition existante ; spread (absolu, relatif à l'ATR, pic
par rapport à la médiane) ; volatilité (ATR14/ATR100 hors [0,5 ; 3], ATR < 2,5 ×
spread) ; contexte M5/M15 (EMA, structure M15, efficience M15, pullback sans
tendance M5) ; **tendance contradictoire** (§ 2.1) ; **régime non autorisé**
(§ 2.2) ; **figure contraire confirmée**, **déclenchement doji**, **entrée
tardive**, figure requise absente (§ 2.5) ; stop trop large (> `InpMaxSLATR` 3 ×
ATR) ; prix ayant trop avancé (> `InpMaxChaseFrac` 30 % du risque depuis la clôture
de signal) ; espace jusqu'à la liquidité opposée ou à l'obstacle le plus proche <
`InpMinRoomR` (1 R), ou prix dans une zone opposée ; coût > `InpMaxCostToRiskFrac`
(15 %) du risque ; score < `InpMinScore` ; signal antérieur au démarrage ; signal
déjà exécuté ; position opposée ouverte ; volume minimal > budget de risque ; marge
insuffisante ; risque agrégé atteint ; signaux achat ET vente simultanés.

Chaque signal complet enregistre la liste des critères **satisfaits (+)** et
**échoués (−)** (colonne `criteria` de `_signals.csv`) ; la raison du refus est le
premier critère échoué.

**Score (0–100)** = `100 × Σ(poids × composante) / Σ poids`, chaque composante dans
[0 ; 1]. Chaque élément de preuve est compté **une seule fois** :

| Composante | Poids | Calcul |
|---|---|---|
| Liquidité / zone | `InpWLiquidity` 20 | F1 : base 0,6 (swing M1), 0,85 (niveaux égaux M1), 0,8 (M5), 1,0 (M15, veille, Asie) × 0,8 si profondeur hors [0,1 ; 0,8] ATR ; F2 : profondeur du pullback ; F3 : contacts et hauteur du range ; F4 : étroitesse de la boîte ; F5 : force de la zone ; F6 : qualité de la FVG |
| Déclencheur | `InpWTrigger` 10 | F1 : 1 − 0,15 × barres de réintégration − 0,15 × clôtures sous le niveau ; F2 : force de l'impulsion ; F3 : clôture de cassure ; F4 : amplitude de l'expansion ; F5/F6 : 1 − 0,1 × barres depuis le contact (≥ 0,3) |
| Confirmation structurelle | `InpWStructure` 15 | F1 : 0,7 (0,6 sans sommet fractal) + 0,3 × qualité du déplacement de la barre de CHOCH ; F5/F6 : 1 avec CHOCH M1, sinon 0,7 |
| Bougies | `InpWCandle` 10 | § 2.5 (preuve unique ; 0 si figure contraire) |
| Alignement M5/M15 | `InpWAlignment` 15 | 0,5 × (tendance M5 par votes alignée 1 / neutre 0,5 / opposée 0) + 0,5 × (idem M15). F6 : si la dernière cassure M5 (celle qui fixe la tendance M5) **est** la cassure du déplacement de la FVG, déjà comptée dans sa qualité, la moitié M5 n'utilise que les votes sommets/creux, EMA et pente |
| Retest | `InpWRetest` 10 | F1 : 1,0 retest profond, 0,8 retest, 0,3 entrée à la confirmation ; F2/F4 : 0,5 ; F3 : proximité du retest ; F5/F6 : 1 si la réaction tient dans la zone, 0,7 si mèche au-delà (le nombre de retours d'une FVG est déjà dans sa qualité) |
| Volatilité | `InpWVolatility` 5 | 1 si ATR14/ATR100 ∈ [0,8 ; 1,6], décroissant au-delà |
| Coût d'exécution | `InpWCost` 5 | 1 − rampe(coût/risque ; 3 % → 15 %) |
| Espace (R:R) | `InpWRR` 10 | rampe(espace en R ; 1 → 3) |

Le seuil initial de 80 (`InpMinScore`) est inchangé : il n'a pas été abaissé pour
augmenter le nombre de transactions. C'est un **point de départ de recherche** ;
le score **n'est pas une probabilité de réussite** ; sa relation avec les
résultats doit être vérifiée (tableau « par tranche de score » du rapport, en
abaissant `InpMinScore` en recherche pour observer aussi les scores bas).

**Coûts** : coût estimé = spread + commission aller-retour + glissement prévu ;
le glissement prévu est le plus grand de `InpSlippageAllowancePrice` et du
glissement **défavorable moyen observé** sur les 20 dernières exécutions.

## 10. Volume

Voir le README (section « Risque »). Résumé : volume = budget / perte au stop pour
1 lot (valorisée par `OrderCalcProfit` ET par la valeur du tick, la plus prudente
retenue, stop décalé du glissement prévu, commission aller-retour incluse), arrondi
**vers le bas** ; refus si le volume minimal dépasse le budget. Aucun module
d'analyse ne peut augmenter le risque par trade ni contourner une limite.

## 11. Sorties

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
