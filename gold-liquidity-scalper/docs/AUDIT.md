# Audit de robustesse — version 1.10

Ce document indique, **exigence par exigence**, ce qui est réellement fait et
vérifié. Il ne déclare **pas** le robot prêt pour un compte réel.

## Légende des colonnes

| Colonne | Signification |
|---|---|
| Implémentée | le code existe dans `MQL5/Experts/GoldLiquidityScalper` |
| Compilée | **C++** : compilé sans avertissement (g++ et clang++, `-Wall -Wextra -Wshadow -Wconversion -Werror`) via le banc `tests/` ; **MetaEditor : NON vérifiée** (serveurs MetaQuotes inaccessibles depuis l'environnement de développement) |
| Testée | exécutée par un test automatique du banc (courtier simulé, données synthétiques) ; « exercée » = traversée par un test d'intégration sans assertion dédiée |
| Validée en démo | testée sur un compte démo réel : **NON pour toutes les lignes** |
| Validée statistiquement | protocole sur données réelles : **NON pour toutes les lignes** |

Preuves : `tests/test_main.cpp` (41 tests, 1923 vérifications, 0 échec avec g++
et clang++), `tools/test_analyze_trades.py` (12 tests), exécution de la suite sous
AddressSanitizer / UndefinedBehaviorSanitizer (voir § 4). Les données de test sont
**synthétiques** : aucun chiffre de ce dépôt n'a de valeur de performance.

## 1. Module bougies japonaises

| # | Exigence | Implémentée | Testée | Preuve / remarque |
|---|---|---|---|---|
| 1 | Mesures quantitatives par bougie, amplitude nulle | oui | oui | `bougies : mesures et amplitude nulle` (aucune division, aucune figure, série plate) |
| 2 | Retournements haussiers : marteau, marteau inversé, avalement, ligne pénétrante, étoile du matin, rejet + confirmation | oui | oui | `bougies : figures haussières et miroirs baissiers` |
| 3 | Retournements baissiers : étoile filante, pendu, avalement baissier, nuage noir, étoile du soir | oui | oui | même test, série miroir, noms vérifiés |
| 4 | Indécision : doji, petits corps, alternances | oui | partielle | doji testé (neutre, non dupliqué, déclenchement repéré) ; toupie et alternance **non testées unitairement** |
| 5 | Continuation : impulsion, consolidation + reprise | oui | oui | IMP et CONT dans le test des figures |
| 6 | Rejet, échec de cassure, absorption apparente | oui | partielle | FBRK testé ; pin bar exercée ; ABS (volume de ticks) **non testée**, désactivée par défaut, aucune absorption institutionnelle affirmée |
| 7 | Séquences composées | oui | non | SEQ implémentée, **sans test dédié** |
| 8 | Figures désactivables | oui | oui | `bougies : confirmation…` (désactivation / réactivation) |
| 9 | Interprétation contextuelle (zone, tendance, bruit, obstacle, espace) | oui | exercée | calculée à chaque barre en intégration ; pas d'assertion unitaire sur chaque drapeau |
| 10 | Rôles M15 / M5 / M1 | oui (documenté) | exercée | figures sur M1 ; M5/M15 = contexte. **Limite** : pas de figures M5/M15 |
| 11 | Bougies clôturées uniquement, pas de donnée future | oui | oui | statuts calculés sur les barres postérieures ; zones/FVG non connues ignorées (tests zones, F5) |
| 12 | Confirmation, faux signaux, entrées tardives, entrées répétées | oui | oui | confirmation / invalidation / expiration ; filtre d'extension actif (A/B) ; `signal déjà exécuté` |
| 13 | Score explicable, critères satisfaits / échoués | oui | oui | colonne `criteria` de `_signals.csv`, lue par le test A/B |
| 14 | Seuil initial 80 inchangé | oui | — | `InpMinScore = 80` |
| 15 | Aucune limite de risque contournée | oui | oui | invariants vérifiés dans chaque test d'intégration (risque par trade, positions, trades/jour, stop jamais élargi) |
| 16 | Tests A/B (référence, chaque filtre, combinaisons, par régime) | oui (outil + préréglages) | sur données synthétiques | `comparaison A/B des filtres (F1)` : chaque filtre agit et ne contourne aucune limite ; **A/B sur données réelles : non fait** |
| 17 | Journal par signal (figure, UT, mesures, contexte, confirmations, score, décision, raison, résultat) | oui | oui | `_bougies.csv`, `_signals.csv`, `_trades.csv` (colonnes `regime`, `label`, `candle`) ; `volume des journaux` |
| 18 | Tableau de bord : figures détectées / confirmées, signaux refusés, trades exécutés | oui | oui | ligne « Jour » ; présence des lignes vérifiée (`bouton vérifier la connexion`) |

## 2. Module tendance, supports et résistances

| # | Exigence | Implémentée | Testée | Preuve / remarque |
|---|---|---|---|---|
| 19 | Tendance M15 = HH/HL + structure + EMA 200 ; EMA seule insuffisante | oui | oui | `tendance et régimes` |
| 20 | M5 opérationnelle, M1 déclenchement | oui | exercée | intégration |
| 21 | Haussière / baissière / latérale / transition | oui | oui | `tendance et régimes` (dont CHOCH récent, symétrie baissière) |
| 22 | Pas de contradiction entre unités de temps | oui | oui | filtre de tendance actif (A/B) |
| 23 | Pivots confirmés uniquement | oui | oui | `supports / résistances` (pivot non confirmé ignoré) |
| 24 | Largeur adaptée à la volatilité, réactions indépendantes, M15 majeures / M5 opérationnelles | oui | oui | `supports / résistances` |
| 25 | Changement de rôle après confirmation ; cassure puis retour | oui | oui | cassure confirmée, inversion, cassure ratée |
| 26 | Sommets / creux égaux, zones de liquidité | oui | oui | creux égaux testés ; carte de liquidité (v1.00) |
| 27 | Achat sur réaction confirmée sur support ou balayage + réintégration | oui | oui | `F5 réaction…`, `F1 détection du balayage` |
| 28 | Pas d'achat juste sous / dans une résistance | oui | oui | obstacles : résistance < 1 R, prix dans la résistance, zone pas encore connue |
| 29 | Validation des cassures, cassure puis retour | oui | oui | zones ; F3 (v1.00) |
| 30 | Confluence sans double comptage | oui | partielle | une seule preuve de bougie ; exclusions par famille ; fraîcheur FVG comptée une fois (test F6) ; pas de test exhaustif de toutes les combinaisons |
| 31 | Comparaison avec / sans filtres | oui | synthétique | préréglages `ab_*.set`, outil `--group-by label --baseline` |

## 3. Module FVG / imbalances

| # | Exigence | Implémentée | Testée | Preuve / remarque |
|---|---|---|---|---|
| 32 | Code existant inspecté, pas de détecteur dupliqué | oui | — | aucun détecteur FVG en v1.00 ; un seul module `Fvg.mqh` |
| 33 | 3 bougies clôturées, formules haussière / baissière | oui | oui | `FVG / IFVG / OB` (bornes exactes, symétrie) |
| 34 | Attributs : sens, bornes, UT, heure, taille pts/ATR, déplacement, BOS/CHOCH, balayage, proximité S/R/OB, retours, comblement, statut, raison | oui | partielle | bornes, heure, taille, déplacement, BOS, OB, statuts testés ; balayage et proximité S/R exercés |
| 35 | Score de qualité configurable, explicable, sans double comptage | oui | partielle | poids `InpFvgW*`, raison textuelle ; BOS > sans BOS vérifié |
| 36 | Retours, comblement, invalidation (définitions explicites) | oui | oui | 1er / 2e retour, 40 % / 80 % / 100 %, invalidation par clôture |
| 37 | Historique conservé | oui | oui | `_fvg.csv` (création puis comblement / invalidation) |
| 38 | IFVG règle séparée, désactivable | oui | oui | désactivée par défaut ; activée : zone inversée, identifiant distinct |
| 39 | Une FVG ne déclenche jamais seule ; attente d'une réaction | oui | oui | `F6 retest de FVG` (contact sans réaction → attente) |
| 40 | Refus si UT contradictoires, zone invalidée, R:R insuffisant | oui | oui | invalidation testée ; espace / obstacles testés (F5) ; tendance M5 opposée refusée pour F6 (continuation) |

## 4. Audit de robustesse

| # | Exigence | Implémentée | Testée | Preuve / remarque |
|---|---|---|---|---|
| 41 | Classification des régimes, stratégies autorisées par régime | oui | oui | `tendance et régimes` ; A/B (aucune exécution en régime interdit) ; listes par défaut **non validées** |
| 42 | Calendrier : sessions, heure d'été, vendredi, annonces | oui (v1.00) | partielle | heures d'été testées ; calendrier économique **indisponible dans le testeur MT5** |
| 43 | Plafonds de risque globaux | oui (v1.00) | oui | protections journalières, risque agrégé, invariants |
| 44 | Qualité d'exécution : spread, glissement, rejets, coûts, prix demandé / obtenu | oui | oui | `qualité d'exécution (statistiques)` ; glissement observé réinjecté dans les coûts. **Limite** : le courtier simulé n'a pas de glissement |
| 45 | Intégrité des données (trous, fraîcheur, cohérence) | oui | oui | `intégrité : trou de données` (aucune entrée pendant la fenêtre) |
| 46 | Robustesse statistique : sensibilité, Monte-Carlo, exécution défavorable | oui (outil + protocole) | oui (outil) | Monte-Carlo, retrait des 5 % meilleurs trades, stress des coûts testés ; sensibilité = procédure manuelle du protocole ; **non exécutée sur données réelles** |
| 47 | Tests de panne | oui | oui | requotes (nouvelles tentatives bornées), erreurs non récupérables (pas de nouvelle tentative, refroidissement, suspension après 3), délai dépassé (résultat incertain, resynchronisation), coupure, redémarrage, position sans stop |
| 48 | Surveillance et alertes configurables, jamais présentées comme preuve de succès | oui | oui | `alertes` (anti-répétition, catégories, échec d'envoi compté, testeur) |
| 49 | Gestion des versions, aucun déploiement automatique sur le réel | oui | oui (v1.00) | `CHANGELOG.md` ; aucun paramètre modifié par le programme ; confirmation explicite sur compte réel |
| 50 | Petit capital | oui | oui | `petit compte (10)` : aucune position, refus « volume minimal » journalisé |
| 51 | Analyse sous AddressSanitizer / UBSan | — | voir ci-dessous | résultat consigné dans la section « Vérifications » du README |

## 5. Défauts et risques résiduels connus

1. **Compilation MetaEditor non vérifiée.** Le banc C++ détecte une grande partie
   des erreurs, pas toutes (différences de sémantique MQL5 possibles).
2. **Aucun test sur données réelles, aucun passage dans le testeur MT5, aucune
   démo.** Aucun résultat de performance n'existe.
3. **Filtres potentiellement trop restrictifs** : sur la marche aléatoire des
   tests, les obstacles S/R suppriment toutes les entrées F1 (référence 15 entrées,
   avec obstacles 0). Sur données réelles, ce réglage peut rendre le robot quasi
   inactif ; il doit être jugé par la comparaison A/B.
4. Listes de régimes par famille, seuils de figures, de zones et de FVG : valeurs
   de départ non calibrées.
5. Figures de bougies lues sur M1 uniquement ; absorption fondée sur le volume de
   **ticks** (pas un volume réel).
6. Toupie, alternance, séquence composée, pin bar et absorption sans test unitaire dédié.
7. Courtier simulé simplifié : pas de glissement, pas d'exécution partielle réelle,
   pas de ticks réels ; temps de calcul dans MT5 non mesuré (analyse complète à
   chaque nouvelle barre M1).
8. Notifications mobiles et e-mails : nécessitent la configuration du terminal
   (identifiant MetaQuotes, serveur SMTP) ; un échec est compté et affiché.

## 6. Conditions avant tout usage réel

Le robot **n'est pas déclaré prêt pour le réel**. Il ne pourra l'être qu'après :

1. compilation MetaEditor sans erreur ni avertissement ;
2. tests fonctionnels dans le testeur MT5 (ticks réels, délais aléatoires) ;
3. protocole statistique complet (`docs/PROTOCOLE_VALIDATION.md`), A/B des filtres
   compris, avec une famille réussissant développement, validation puis test final ;
4. période de démo conforme au backtest (coûts, glissement, rejets) ;
5. examen explicite des risques résiduels ci-dessus, et démarrage au risque minimal.
