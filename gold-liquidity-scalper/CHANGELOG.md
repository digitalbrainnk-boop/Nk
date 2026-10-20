# Historique des versions

Chaque version modifiant une règle de décision est une **nouvelle variante** pour
le protocole de validation (`docs/PROTOCOLE_VALIDATION.md`) : ses résultats ne
peuvent pas être mélangés avec ceux d'une version précédente, et elle doit être
retestée (développement, validation, test final, démo). Aucune version n'est
déployée automatiquement sur un compte réel.

## Application d'analyse (outillage, sans changement de règles de l'EA)

- `app/analyse.html` : analyse des journaux réels du robot dans un navigateur
  (ordinateur et téléphone) : vue d'ensemble, répartitions des trades, signaux et
  motifs de refus, figures de bougies, FVG / Order Blocks, protocole de validation
  (mêmes critères et même règle de décision que `tools/analyze_trades.py`),
  journal des erreurs. Exemple synthétique clairement signalé tant qu'aucun fichier
  n'est chargé. Enregistrement facultatif des fichiers dans l'espace privé de
  l'application pour les retrouver sur un autre appareil.
- `tests/check_app_stats.py` (appelé par `tests/run_checks.sh`) : les indicateurs
  calculés par la page sont identiques à ceux de l'outil Python sur un même fichier.

L'EA reste en version 1.11.1 ; aucune règle de décision n'est modifiée.

## 1.11.1 — corrections de compatibilité MQL5 (revue sans MetaEditor)

MetaEditor étant inaccessible depuis l'environnement de développement, une revue
ciblée des constructions acceptées par C++ mais pas par MQL5 a été faite :

- `Engine.mqh` : opérateur ternaire entre deux objets de classe
  (`cond ? g_ctx.ob1 : g_ctx.ob5`), refusé par MQL5 → remplacé par `if / else`.
- `Signals.mqh` (F3) : variable locale `iLow` masquant la fonction intégrée
  `iLow()` (« declaration hides function ») → renommée `kLow`.
- `Fvg.mqh` : `MathMax` entre deux `datetime` (type de retour dépendant de la
  version du compilateur) → comparaison explicite.
- Contrôle automatique (`tests/mql2cpp.py`) enrichi de ces deux règles (variable
  masquant une fonction intégrée MQL5, ternaire entre objets) ; elles détectent les
  deux erreurs dans la version précédente.
- Vérifications complémentaires sans anomalie : aucun `input` modifié ni passé par
  référence, aucune variable locale non initialisée, aucune fonction renvoyant une
  structure ou une référence, aucune copie d'objet de classe, retours d'`OrderSend`,
  `OrderCheck`, `HistorySelect` et `PositionSelect` toujours vérifiés, aucune
  conversion de signe ou flottante implicite (`-Wsign-conversion`, `-Wfloat-conversion`).

**Compilation MetaEditor toujours non vérifiée** : d'autres erreurs propres au
compilateur MQL5 restent possibles.

## 1.11 — FVG et Order Blocks distincts, absence de repaint, étude FVG

Statut : compilée en C++ strict (banc de test), tests du banc réussis ;
**compilation MetaEditor (hôtes MetaQuotes bloqués), testeur MT5, données réelles
et démo : non vérifiés.** Le seuil de score reste à 80.

Changements de règles (nouvelle variante pour le protocole) :

- **Order Blocks** : module distinct (`OrderBlocks.mqh`) avec ses propres règles
  (dernière bougie opposée avant une cassure BOS/CHOCH impulsive), suivi des retours
  et de l'invalidation, journal `_ob.csv`. L'OB ne fait plus partie de la qualité
  d'une FVG.
- **Confluence FVG + OB** : option `InpFvgObConfluence` (ignorée par défaut),
  filtre de sélection sans point de score ; le lien indique si l'OB provient du
  même déplacement que la FVG.
- **Pas de double comptage** : la cassure produite par le déplacement d'une FVG
  n'est plus recomptée dans l'alignement M5 quand c'est elle qui fixe la tendance M5.
- **Doublons entre unités** : FVG M1 contenues dans une FVG M5 marquées et ignorées ;
  zones S/R avec leur origine (`M5`, `M15`, `M5+M15`).
- **Absence de repaint** : sélection des pivots des zones parmi les seuls pivots
  confirmés à l'instant de l'analyse (une sélection pouvait dépendre du nombre de
  pivots ultérieurs) ; test dédié.
- **F6** : réaction exigée par défaut ; `InpFvgRequireReaction = false` réservé à
  la recherche (refus de démarrer hors testeur) ; obstacles FVG séparés des
  obstacles S/R (`InpUseFvgObstacles`).

Journal et suivi :

- décisions par zone (`ATTENTE` / `REFUS`) une fois par changement d'état, motif
  précis, confirmations présentes / absentes ; colonnes de zone dans `_signals.csv`
  et `_trades.csv` (résultat relié à la zone) ; identifiant et attributs complets
  dans `_fvg.csv` ; textes libres nettoyés du séparateur `;` (un détail de F6 en
  contenait et décalait les colonnes) ;
- tableau de bord : FVG du jour détectées / qualifiées / retestées / invalidées,
  OB actifs ; rapport EA par fraîcheur de la zone.

Outillage (sans changement de règles) : `tests/compile_metaeditor.sh` (compilation
réelle par MetaEditor sous Wine, analyse du journal) ; `tests/replay_main.cpp` et
`tests/run_validation.sh` (rejeu de l'EA sur un export M1 de MT5 avec le spread de
chaque barre, préréglages `.set` appliqués, protocole statistique en sortie).

Outil d'analyse : répartition zones fraîches / revisitées, « Verdict des filtres »
(CONSERVER seulement si gain en développement ET validation, sinon DÉSACTIVER).
Préréglages des 6 variantes de l'étude FVG (`tester/sets/fvg_*.set`). Banc de
test : 49 tests, dont Order Blocks, doublons, absence de repaint, confluence,
non-recomptage, protections F6, journal, variantes, cohérence des CSV.

## 1.10 — modules d'analyse, familles F5 / F6, audit de robustesse

Statut : compilée en C++ strict (banc de test), tests du banc réussis ;
**compilation MetaEditor, testeur MT5, données réelles et démo : non vérifiés.**

Ajouts :

- **Bougies japonaises** (`Candles.mqh`) : mesures par bougie, 15 figures
  (retournement, indécision, continuation, rejet, composées), statuts détectée /
  confirmée / invalidée / expirée, interprétation contextuelle, figures
  désactivables, preuve unique dans le score, filtres « figure contraire »,
  « déclenchement doji », « entrée tardive », figure obligatoire (option).
- **Tendance par votes et régimes** (`Trend.mqh`) : structure + sommets/creux +
  EMA 200 + pente (EMA seule insuffisante), régimes tendance / range / transition /
  volatil / désordre, régimes autorisés par famille.
- **Supports / résistances dynamiques** (`Zones.mqh`) : pivots confirmés M5/M15,
  zones adaptées à l'ATR, réactions indépendantes, zones majeures, sommets/creux
  égaux, cassure confirmée, inversion de rôle, cassure ratée, obstacles dans le
  calcul de l'espace (prix dans une résistance → refus).
- **FVG / IFVG / OB** (`Fvg.mqh`) : détection sur 3 bougies clôturées, attributs
  complets, qualité intrinsèque pondérée, retours, comblement, invalidation, IFVG
  séparée (désactivée), Order Block objectif.
- **Familles F5** (réaction confirmée sur support / résistance) et **F6** (retest
  de FVG avec réaction confirmée).
- **Score** : composante « bougies » (poids 10) ; déclencheur 15 → 10 et structure
  20 → 15 ; alignement calculé avec la tendance par votes ; critères satisfaits /
  échoués enregistrés pour chaque signal. Seuil 80 inchangé.
- **Qualité d'exécution** : envois, exécutions, rejets, requotes, réponses
  incertaines, latence, glissement mesuré (réinjecté dans l'estimation des coûts).
- **Alertes** configurables (fenêtre, notification mobile, e-mail) avec
  anti-répétition ; échecs d'envoi comptés.
- **Intégrité des données** : refus en cas de trou dans les barres M1 récentes.
- **Journaux** : `_bougies.csv`, `_fvg.csv`, colonnes `regime`, `label`, `candle`,
  niveaux de détail `InpLogCandles` / `InpLogFvg`, étiquette de passage `InpRunLabel`.
- **Tableau de bord** : tendance et régime, zones, FVG actives, compteurs du jour
  (figures détectées / confirmées, signaux refusés / exécutés), dernière figure,
  qualité d'exécution, alertes.
- **Outil d'analyse** : Monte-Carlo, espérance sans les 5 % meilleurs trades,
  critère de drawdown Monte-Carlo, regroupement par libellé et comparaison A/B avec
  une référence, répartitions par régime et par figure.
- **Banc de test** : 41 tests (bougies, tendance, régimes, zones, FVG, F5, F6,
  obstacles, pannes d'exécution, alertes, trou de données, comparaison A/B,
  volume des journaux), filtre de tests en argument.
- Préréglages du testeur F5, F6 et comparaisons A/B (`tester/sets/ab_*.set`).
- Documentation : `docs/STRATEGIE.md` (règles v1.10), `docs/PROTOCOLE_VALIDATION.md`
  (A/B, régimes, sensibilité, robustesse), `docs/AUDIT.md` (liste de contrôle).

Corrections :

- Tableau de bord : les dernières lignes (« Protection », « Risque ») pouvaient
  être masquées faute de place (nombre de lignes porté à 30, test ajouté).
- F6 : le nombre de retours d'une FVG n'est plus compté deux fois dans le score.

## 1.00 — version initiale (commit e4ef47d)

EA XAU/USD M1 / M5 / M15 : familles F1 à F4, score de qualité, volume par le
risque, prises partielles, protections, reprise après redémarrage, tableau de
bord à 4 boutons, statistiques et journal, protocole de comparaison et outil
d'analyse, banc de vérification hors MetaTrader.
