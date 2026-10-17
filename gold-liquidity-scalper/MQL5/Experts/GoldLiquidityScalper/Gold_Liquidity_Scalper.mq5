//+------------------------------------------------------------------+
//|                                       Gold_Liquidity_Scalper.mq5 |
//|  Expert Advisor XAU/USD : balayage de liquidité M1, contexte     |
//|  M5/M15, gestion du risque et des sorties, tableau de bord.      |
//|                                                                  |
//|  AVERTISSEMENT : aucune rentabilité n'est garantie. Le score est |
//|  une note de qualité, pas une probabilité. Validez en backtest   |
//|  (ticks réels) puis en démo avant tout usage réel.               |
//+------------------------------------------------------------------+
#property copyright "Gold Liquidity Scalper"
#property version   "1.11"
#property description "Scalping XAU/USD : liquidité M1 + contexte M5/M15, risque au stop, TP partiels, protections journalières."

#include "GLS\Defines.mqh"

//+------------------------------------------------------------------+
//| Paramètres                                                        |
//+------------------------------------------------------------------+
input group "=== Général ==="
input ENUM_GLS_FAMILY     InpFamily               = GLS_FAMILY_SWEEP;   // Famille de stratégie (une par test)
input long                InpMagic                = 26101501;           // Magic Number dédié
input string              InpSymbolOverride       = "";                 // Symbole forcé (vide = symbole du graphique)
input bool                InpAutoStartInTester    = true;               // Démarrage automatique en backtest
input ENUM_GLS_LOG_LEVEL  InpLogLevel             = GLS_LOG_INFO;       // Niveau de journalisation
input bool                InpWriteFiles           = true;               // Écrire journal/trades/signaux (dossier commun\Files\GLS)
input string              InpRunLabel             = "";                 // Étiquette du passage (comparaisons A/B, colonne label)
input ENUM_GLS_LOG_DETAIL InpLogCandles           = GLS_LOGD_MAIN;      // Journal des figures de bougies
input ENUM_GLS_LOG_DETAIL InpLogFvg               = GLS_LOGD_MAIN;      // Journal des FVG

input group "=== Risque et volume ==="
input double              InpRiskPercent          = 0.5;    // Risque par trade (% de l'equity, max 2)
input double              InpMaxTotalRiskPct      = 1.0;    // Risque agrégé max des positions ouvertes (% equity)
input int                 InpMaxOpenPositions     = 1;      // Positions simultanées maximum
input double              InpMaxMarginUsePct      = 30.0;   // Part max de la marge libre utilisée (%)
input double              InpCommissionPerLotSide = 0.0;    // Commission par lot et par côté (devise du compte, 0 = auto)
input double              InpSlippageAllowancePrice = 0.05; // Glissement prévu ajouté au stop pour le calcul (prix)
input bool                InpBlockOtherGoldExposure = true; // Bloquer si une autre position sur l'or existe

input group "=== Protections journalières ==="
input int                 InpMaxTradesPerDay      = 15;     // Transactions max par jour
input int                 InpMaxConsecutiveLosses = 3;      // Arrêt après N pertes consécutives (0 = off)
input bool                InpConsecLossesDaily    = true;   // Série de pertes remise à zéro chaque jour
input double              InpMaxDailyLossPct      = 2.0;    // Perte journalière max de l'EA (% equity début de jour)
input double              InpMaxDrawdownPct       = 10.0;   // Drawdown max depuis le plus haut de l'equity (%)
input bool                InpCloseOnDailyLimit    = false;  // Fermer les positions si la limite journalière est atteinte
input int                 InpDayResetHour         = 0;      // Heure SERVEUR de début de journée (0-23)
input int                 InpErrorCooldownSec     = 300;    // Refroidissement après erreur d'exécution (s)
input int                 InpMaxConsecExecErrors  = 3;      // Erreurs consécutives avant suspension des entrées
input int                 InpReconnectGraceSec    = 30;     // Attente après reconnexion avant toute entrée (s)
input bool                InpResetDrawdownPeak    = false;  // Réinitialiser le plus haut d'equity (drawdown)

input group "=== Sessions et heure ==="
input bool                InpUseSessions          = true;     // Limiter les entrées aux sessions ci-dessous
input string              InpLondonStart          = "08:00";  // Londres : début (heure locale de Londres)
input string              InpLondonEnd            = "11:30";  // Londres : fin
input string              InpNewYorkStart         = "08:00";  // New York : début (heure locale de New York)
input string              InpNewYorkEnd           = "11:30";  // New York : fin
input string              InpAsiaStartUTC         = "00:00";  // Plage asiatique (liquidité) : début UTC
input string              InpAsiaEndUTC           = "07:00";  // Plage asiatique : fin UTC
input ENUM_GLS_OFFSET_MODE InpServerOffsetMode    = GLS_OFFSET_AUTO; // Décalage serveur/UTC
input int                 InpServerUTCOffsetHours = 0;        // Décalage manuel serveur - UTC (heures, hors été)
input ENUM_GLS_SERVER_DST InpServerDST            = GLS_DST_NONE; // Heure d'été appliquée par le serveur (mode manuel)
input int                 InpMinMinutesBeforeClose = 30;      // Pas d'entrée si la séance du courtier ferme avant (min)
input int                 InpFridayNoEntryHourUTC = 18;       // Vendredi : plus d'entrée après (heure UTC, -1 = off)
input int                 InpFridayCloseHourUTC   = 20;       // Vendredi : fermeture des positions (heure UTC, -1 = off)

input group "=== Annonces économiques ==="
input ENUM_GLS_NEWS_MODE  InpNewsMode             = GLS_NEWS_IF_AVAILABLE; // Filtre d'annonces
input int                 InpNewsMinutesBefore    = 30;     // Blocage avant une annonce forte (min)
input int                 InpNewsMinutesAfter     = 30;     // Blocage après une annonce forte (min)
input string              InpNewsCurrency         = "USD";  // Devise des annonces surveillées
input string              InpNewsFile             = "";     // Fichier d'annonces (dossier commun\Files, heures UTC)

input group "=== Filtres de marché ==="
input double              InpMaxSpreadPrice       = 0.60;   // Spread maximal absolu (en prix, ex. 0.60 USD)
input double              InpMaxSpreadATRFrac     = 0.35;   // Spread maximal en fraction de l'ATR M1
input double              InpMaxCostToRiskFrac    = 0.15;   // Coût (spread+commission+glissement) / risque max
input double              InpSpreadSpikeMult      = 3.0;    // Spread anormal : x fois la médiane récente
input double              InpMinATRRatio          = 0.5;    // ATR14/ATR100 M1 minimum (marché mort)
input double              InpMaxATRRatio          = 3.0;    // ATR14/ATR100 M1 maximum (volatilité anormale)
input double              InpMinATRToSpread       = 2.5;    // ATR M1 minimum en multiple du spread
input int                 InpMaxTickAgeSec        = 60;     // Âge max de la dernière cotation (s)
input int                 InpMaxBarGapMin         = 3;      // Trou max entre deux barres M1 récentes (min) sinon données dégradées

input group "=== Structure (M1 / M5 / M15) ==="
input int                 InpM1Lookback           = 20;     // Barres M1 analysées pour la liquidité
input int                 InpM1SwingStrength      = 2;      // Force des swings M1 (barres de chaque côté)
input int                 InpMicroSwingStrength   = 1;      // Force des micro-swings (CHOCH M1)
input int                 InpM5SwingStrength      = 2;      // Force des swings M5
input int                 InpM15SwingStrength     = 2;      // Force des swings M15
input int                 InpEMAPeriodM5          = 200;    // Période de l'EMA de tendance M5
input bool                InpUseEmaFilter         = true;   // Achat au-dessus / vente en dessous de l'EMA M5
input bool                InpAllowCounterM15      = false;  // Exception : autoriser contre la tendance M15
input double              InpTrendERMin           = 0.30;   // Efficiency ratio mini pour un régime "tendance"
input double              InpMinM15Efficiency     = 0.10;   // Efficiency ratio M15 minimal pour entrer (0 = off)
input int                 InpTransitionBars       = 6;      // Barres M15 de "transition" après un CHOCH
input bool                InpUseExternalLevels    = true;   // Balayages de niveaux M5/M15/veille/Asie
input bool                InpUseTrendFilter       = true;   // Filtre de tendance M15/M5 (structure + sommets/creux + EMA, jamais l'EMA seule)
input int                 InpEMAPeriodM15         = 200;    // Période de l'EMA de tendance M15
input int                 InpTrendSlopeBars       = 10;     // Barres pour mesurer la pente de l'EMA

input group "=== Régimes de marché ==="
input bool                InpUseRegimeFilter      = true;   // N'autoriser chaque famille que dans ses régimes
input double              InpRegimeVolatileRatio  = 1.8;    // Volatilité excessive : ATR14/ATR100 M5 >=
input double              InpRegimeChopAlternation = 0.7;   // Désordre : alternance des couleurs M5 >= (avec ER M15 < 0,15)
input string              InpRegimesF1            = "TENDANCE,RANGE,TRANSITION"; // Régimes autorisés F1 (TENDANCE,RANGE,TRANSITION,VOLATIL,DESORDRE)
input string              InpRegimesF2            = "TENDANCE";                  // Régimes autorisés F2
input string              InpRegimesF3            = "RANGE,TRANSITION";          // Régimes autorisés F3
input string              InpRegimesF4            = "RANGE,TRANSITION";          // Régimes autorisés F4
input string              InpRegimesF5            = "TENDANCE,RANGE";            // Régimes autorisés F5
input string              InpRegimesF6            = "TENDANCE,TRANSITION";       // Régimes autorisés F6

input group "=== Bougies japonaises ==="
input int                 InpCdlLookback          = 12;     // Bougies M1 analysées
input string              InpCdlDisabled          = "ABS";  // Figures désactivées (codes : HAM,IHAM,ENG,PIER,STAR,RCONF,DOJI,SPIN,HESIT,IMP,CONT,PIN,FBRK,ABS,SEQ)
input double              InpCdlDojiBodyRatio     = 0.10;   // Doji : corps / amplitude <=
input double              InpCdlSmallBodyRatio    = 0.30;   // Petit corps (toupie) : corps / amplitude <=
input double              InpCdlMinRangeATR       = 0.30;   // Amplitude minimale d'une bougie significative (x ATR)
input double              InpCdlWickRatio         = 0.60;   // Longue mèche : mèche / amplitude >=
input double              InpCdlWickToBody        = 2.0;    // Longue mèche : mèche / corps >=
input double              InpCdlOppWickMaxRatio   = 0.15;   // Marteau : mèche opposée / amplitude <=
input double              InpCdlEngulfMinBodyATR  = 0.30;   // Avalement : corps minimal (x ATR)
input double              InpCdlStrongBodyRatio   = 0.60;   // Bougie franche : corps / amplitude >=
input double              InpCdlImpulseATR        = 1.5;    // Impulsion : amplitude >= x ATR
input double              InpCdlPriorMoveATR      = 1.0;    // Retournement : mouvement préalable >= x ATR
input int                 InpCdlConfirmBars       = 3;      // Délai de confirmation d'une figure (bougies)
input double              InpCdlAbsorbVolMult     = 2.0;    // Absorption apparente : volume de ticks >= x moyenne
input double              InpCdlZoneProxATR       = 0.5;    // Proximité d'une zone pour interpréter une figure (x ATR)
input bool                InpCdlBlockOpposing     = true;   // Refuser si une figure contraire est confirmée récemment
input int                 InpCdlOpposingBars      = 3;      // Fenêtre de la figure contraire (bougies)
input bool                InpCdlBlockIndecision   = true;   // Refuser si la bougie de déclenchement est un doji
input bool                InpCdlBlockExtended     = true;   // Refuser les entrées après une impulsion déjà étendue
input double              InpCdlMaxTriggerATR     = 2.5;    // Bougie de déclenchement maximale (x ATR)
input double              InpCdlMaxExtensionATR   = 3.0;    // Mouvement maximal sur 5 bougies avant l'entrée (x ATR)
input bool                InpCdlRequirePattern    = false;  // Exiger une figure confirmée (F1-F4 ; toujours exigée par F5)

input group "=== Supports / résistances ==="
input double              InpZoneMergeATR         = 0.5;    // Regroupement des pivots en zone (x ATR M5)
input double              InpZonePadATR           = 0.15;   // Marge de part et d'autre de la zone (x ATR M5)
input int                 InpZoneMinTouches       = 2;      // Réactions indépendantes minimales (sauf niveau M15)
input int                 InpZoneMinSeparationBars = 5;     // Écart minimal entre deux réactions (barres M5)
input int                 InpZoneBreakCloses      = 2;      // Clôtures M5 au-delà pour confirmer une cassure
input double              InpZoneBreakBufferATR   = 0.10;   // Tampon de cassure (x ATR)
input bool                InpUseSRObstacles       = true;   // Compter les supports / résistances opposés dans l'espace disponible
input int                 InpSRReactBars          = 8;      // F5 : fenêtre de réaction après contact (barres M1)
input double              InpSRMinStrength        = 0.5;    // F5 : force minimale de la zone (0-1)

input group "=== FVG / imbalances ==="
input ENUM_GLS_FVG_TF     InpFvgTF                = GLS_FVGTF_M5; // Unité des FVG utilisées par F6
input double              InpFvgMinSizeATR        = 0.10;   // Taille minimale (x ATR de l'unité)
input double              InpFvgMinDispATR        = 1.0;    // Déplacement minimal de la 2e bougie (x ATR)
input double              InpFvgInvalidBufferATR  = 0.10;   // Invalidation : clôture au-delà de la zone + x ATR
input double              InpFvgMinQuality        = 0.55;   // F6 : qualité minimale de la FVG (0-1)
input int                 InpFvgMaxRetests        = 1;      // F6 : nombre maximal de retours dans la zone
input int                 InpFvgMaxAgeBars        = 48;     // F6 : âge maximal (barres de l'unité de la FVG)
input int                 InpFvgReactBars         = 8;      // F6 : fenêtre de réaction après contact (barres M1)
input bool                InpUseIFVG              = false;  // Règle distincte : FVG invalidée utilisée en sens inverse (IFVG)
input bool                InpFvgRequireReaction   = true;   // F6 : exiger une réaction (figure / CHOCH M1). false = RECHERCHE, refusé hors testeur
input ENUM_GLS_OB_CONFLUENCE InpFvgObConfluence  = GLS_OBC_OFF; // F6 : confluence avec un Order Block (filtre, à valider par tests)
input bool                InpUseFvgObstacles      = true;   // Compter les FVG contraires dans l'espace disponible
input double              InpFvgWDisp             = 25.0;   // Qualité FVG : poids du déplacement
input double              InpFvgWSize             = 10.0;   // Qualité FVG : poids de la taille
input double              InpFvgWStructure        = 20.0;   // Qualité FVG : poids du BOS/CHOCH
input double              InpFvgWSweep            = 15.0;   // Qualité FVG : poids du balayage préalable
input double              InpFvgWFresh            = 20.0;   // Qualité FVG : poids de la fraîcheur
input double              InpFvgWContext          = 10.0;   // Qualité FVG : poids de la proximité d'une zone S/R favorable

input group "=== Order Blocks (règles propres) ==="
input int                 InpObLookback           = 5;      // Recherche de la bougie opposée avant la cassure (barres)
input double              InpObMinDispATR         = 1.5;    // Déplacement minimal depuis l'OB jusqu'à la clôture de cassure (x ATR)
input double              InpObInvalidBufferATR   = 0.10;   // Invalidation : clôture au-delà de l'OB + x ATR
input double              InpObConfluenceATR      = 0.50;   // Confluence FVG/OB : écart maximal entre les zones (x ATR)

input group "=== F1 Balayage de liquidité ==="
input int                 InpSetupMaxBars         = 20;     // Âge max d'une configuration (barres M1)
input double              InpSweepMinDepthATR     = 0.05;   // Profondeur min du balayage (x ATR)
input double              InpSweepMaxDepthATR     = 1.5;    // Profondeur max (au-delà : vraie cassure)
input int                 InpReclaimMaxBars       = 3;      // Barres max pour la réintégration
input int                 InpMaxAcceptanceCloses  = 2;      // Clôtures max au-delà du niveau pendant le balayage
input double              InpReclaimBufferATR     = 0.05;   // Tampon de réintégration (x ATR)
input int                 InpChochLookback        = 10;     // Recherche du sommet de CHOCH avant le balayage (barres)
input int                 InpConfirmMaxBars       = 6;      // Barres max entre l'extrême et le CHOCH
input ENUM_GLS_ENTRY_MODE InpEntryMode            = GLS_ENTRY_BOTH; // Mode d'entrée
input int                 InpRetestMaxBars        = 10;     // Barres max pour le retest après le CHOCH
input double              InpEqualLevelTolATR     = 0.10;   // Tolérance des niveaux égaux (x ATR)

input group "=== F2 Tendance + pullback ==="
input int                 InpPBWindow             = 30;     // Fenêtre de recherche du sommet d'impulsion
input int                 InpPBImpulseLookback    = 20;     // Barres avant le sommet pour l'origine de l'impulsion
input double              InpPBMinImpulseATR      = 2.0;    // Impulsion minimale (x ATR)
input double              InpPBMinRetrace         = 0.382;  // Retracement minimal
input double              InpPBMaxRetrace         = 0.786;  // Retracement maximal

input group "=== F3 Cassure de range ==="
input int                 InpRangeBars            = 30;     // Barres du range
input double              InpRangeMinATR          = 1.0;    // Hauteur min du range (x ATR)
input double              InpRangeMaxATR          = 4.0;    // Hauteur max du range (x ATR)
input int                 InpBreakoutMaxAge       = 15;     // Âge max de la cassure (barres)
input double              InpRetestTolATR         = 0.3;    // Tolérance du retest (x ATR)

input group "=== F4 Compression / expansion ==="
input int                 InpSqueezeBars          = 12;     // Barres de la boîte de compression
input double              InpSqueezeBoxATR        = 1.5;    // Hauteur max de la boîte (x ATR100)
input double              InpSqueezeATRRatio      = 0.75;   // ATR14/ATR100 max pendant la compression
input double              InpExpansionTRATR       = 1.5;    // Range minimal de la barre d'expansion (x ATR100)

input group "=== Stop, score et filtres de signal ==="
input double              InpSLBufferATR          = 0.20;   // Tampon du stop au-delà de l'extrême (x ATR)
input double              InpMinSLATR             = 0.6;    // Distance de stop minimale (x ATR, élargie avant l'entrée)
input double              InpMaxSLATR             = 3.0;    // Distance de stop maximale (x ATR) sinon refus
input double              InpMaxChaseFrac         = 0.30;   // Avance max du prix depuis le signal (fraction du risque)
input double              InpMinRoomR             = 1.0;    // Espace min jusqu'à la liquidité ou zone opposée (en R)
input double              InpMinScore             = 80.0;   // Score minimal (0-100) — à calibrer
input double              InpWLiquidity           = 20.0;   // Poids : qualité de la configuration (liquidité, zone, FVG)
input double              InpWTrigger             = 10.0;   // Poids : réintégration / déclencheur
input double              InpWStructure           = 15.0;   // Poids : confirmation structurelle
input double              InpWCandle              = 10.0;   // Poids : preuve apportée par les bougies
input double              InpWAlignment           = 15.0;   // Poids : alignement M5/M15
input double              InpWRetest              = 10.0;   // Poids : qualité du retest
input double              InpWVolatility          = 5.0;    // Poids : volatilité
input double              InpWCost                = 5.0;    // Poids : coût d'exécution
input double              InpWRR                  = 10.0;   // Poids : espace / rendement-risque

input group "=== Sorties ==="
input double              InpTP1R                 = 1.0;    // TP1 (en R)
input double              InpTP2R                 = 2.0;    // TP2 (en R)
input double              InpTP3R                 = 3.0;    // TP3 / objectif final (en R)
input double              InpTP1Fraction          = 0.3333; // Fraction du volume initial clôturée à TP1
input double              InpTP2Fraction          = 0.3333; // Fraction du volume initial clôturée à TP2
input double              InpSingleTargetR        = 2.0;    // Objectif unique si le volume ne peut être divisé (R)
input double              InpBETriggerR           = 1.0;    // Break-even déclenché à (R), 0 = off
input double              InpBEExtraPrice         = 0.02;   // Marge ajoutée au break-even (prix) en plus des commissions
input double              InpLockAfterTP2R        = 1.0;    // Stop verrouillé à +x R après TP2 (0 = off)
input double              InpTrailStartR          = 1.5;    // Stop suiveur actif après une avance de (R), 0 = off
input double              InpTrailATRMult         = 1.0;    // Distance minimale du suiveur (x ATR)
input int                 InpTrailSwingStrength   = 2;      // Force des swings M1 du suiveur
input double              InpTrailMinStepATR      = 0.10;   // Pas minimal de déplacement du suiveur (x ATR)
input bool                InpUseInvalidationExit  = true;   // Sortie si le niveau d'invalidation est repris
input int                 InpInvalidationCloses   = 2;      // Clôtures M1 consécutives requises
input double              InpInvalidationBufferATR = 0.10;  // Tampon d'invalidation (x ATR)
input bool                InpUseOppositeStructureExit = true; // Sortie sur BOS/CHOCH M5 contraire
input int                 InpMaxHoldMinutes       = 180;    // Durée maximale de maintien (min, 0 = off)
input int                 InpNoProgressMinutes    = 45;     // Sortie si pas de progression après (min, 0 = off)
input double              InpNoProgressMinMFER    = 0.5;    // Progression minimale attendue (R)
input double              InpRiskExcessR          = 1.3;    // Sortie immédiate si perte > x R (gap/glissement)
input ENUM_GLS_NOSL_ACTION InpNoSLAction          = GLS_NOSL_CLOSE; // Si le stop ne peut pas être posé

input group "=== Exécution ==="
input double              InpMaxDeviationPrice    = 0.30;   // Écart de prix max accepté à l'exécution (prix)
input int                 InpMaxSendRetries       = 2;      // Nouvelles tentatives (requote / prix changé)

input group "=== Tableau de bord et statistiques ==="
input bool                InpShowDashboard        = true;   // Afficher le tableau de bord
input int                 InpDashX                = 10;     // Position X
input int                 InpDashY                = 25;     // Position Y
input int                 InpDashFontSize         = 8;      // Taille de police
input int                 InpStatsHistoryDays     = 365;    // Historique relu pour les statistiques (jours, 0 = tout)
input int                 InpMinTradesForStats    = 20;     // Trades min pour afficher PF / espérance

input group "=== Alertes ==="
input bool                InpAlertPopup           = true;   // Fenêtre d'alerte du terminal
input bool                InpAlertPush            = false;  // Notification mobile (identifiant MetaQuotes requis)
input bool                InpAlertMail            = false;  // E-mail (configuré dans le terminal)
input int                 InpAlertThrottleSec     = 300;    // Délai minimal entre deux alertes identiques (s)
input bool                InpAlertErrors          = true;   // Alerter : erreurs critiques
input bool                InpAlertRisk            = true;   // Alerter : limites de risque atteintes
input bool                InpAlertStop            = true;   // Alerter : arrêt du robot
input bool                InpAlertConnection      = true;   // Alerter : perte / retour de connexion

//+------------------------------------------------------------------+
//| Modules                                                           |
//+------------------------------------------------------------------+
#include "GLS\Engine.mqh"

//+------------------------------------------------------------------+
//| Événements                                                        |
//+------------------------------------------------------------------+
int OnInit()
  {
   return g_engine.Init();
  }

void OnDeinit(const int reason)
  {
   g_engine.Deinit(reason);
  }

void OnTick()
  {
   g_engine.OnTick();
  }

void OnTimer()
  {
   g_engine.OnTimer();
  }

void OnChartEvent(const int id, const long &lparam, const double &dparam, const string &sparam)
  {
   g_engine.OnChartEvent(id, sparam);
  }

void OnTradeTransaction(const MqlTradeTransaction &trans, const MqlTradeRequest &request, const MqlTradeResult &result)
  {
   g_engine.OnTradeTransaction(trans);
  }

double OnTester()
  {
   return g_engine.TesterCriterion();
  }
//+------------------------------------------------------------------+
