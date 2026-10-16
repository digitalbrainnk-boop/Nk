//+------------------------------------------------------------------+
//| Defines.mqh - Gold Liquidity Scalper                             |
//| Constantes, énumérations et petites structures partagées.        |
//| Ce fichier ne contient aucune logique de trading.                |
//+------------------------------------------------------------------+
#ifndef GLS_DEFINES_MQH
#define GLS_DEFINES_MQH

#define GLS_NAME            "Gold Liquidity Scalper"
#define GLS_VERSION         "1.00"
#define GLS_OBJ_PREFIX      "GLS_"
#define GLS_COMMENT_TAG     "GLS"
#define GLS_EPS             1e-9

//--- Familles de stratégies (une seule active par instance / par test)
enum ENUM_GLS_FAMILY
  {
   GLS_FAMILY_SWEEP       = 1, // F1 Balayage de liquidité + réintégration + structure
   GLS_FAMILY_PULLBACK    = 2, // F2 Tendance + pullback + reprise
   GLS_FAMILY_RANGE_BREAK = 3, // F3 Cassure de range + confirmation + retest
   GLS_FAMILY_SQUEEZE     = 4  // F4 Compression + expansion confirmée
  };

//--- Mode d'entrée (famille F1)
enum ENUM_GLS_ENTRY_MODE
  {
   GLS_ENTRY_CONFIRM = 0, // Clôture de confirmation (CHOCH M1)
   GLS_ENTRY_RETEST  = 1, // Retest validé après confirmation
   GLS_ENTRY_BOTH    = 2  // Le premier des deux (un seul trade par signal)
  };

//--- Calcul du décalage horaire du serveur
enum ENUM_GLS_OFFSET_MODE
  {
   GLS_OFFSET_AUTO   = 0, // Auto en réel (TimeTradeServer - TimeGMT), manuel en backtest
   GLS_OFFSET_MANUAL = 1  // Toujours la valeur manuelle
  };

//--- Règle d'heure d'été appliquée à l'heure du serveur
enum ENUM_GLS_SERVER_DST
  {
   GLS_DST_NONE = 0, // Aucune (ex. serveur en UTC fixe)
   GLS_DST_EU   = 1, // Heure d'été européenne
   GLS_DST_US   = 2  // Heure d'été américaine
  };

//--- Filtre d'annonces économiques
enum ENUM_GLS_NEWS_MODE
  {
   GLS_NEWS_OFF          = 0, // Désactivé (affiché comme NON FILTRÉ)
   GLS_NEWS_IF_AVAILABLE = 1, // Calendrier MT5 si disponible, sinon signalé NON FILTRÉ
   GLS_NEWS_REQUIRED     = 2  // Obligatoire : pas d'entrée si aucune source fiable
  };

//--- Action si un stop de protection ne peut pas être posé
enum ENUM_GLS_NOSL_ACTION
  {
   GLS_NOSL_CLOSE = 0, // Fermer la position immédiatement
   GLS_NOSL_ALERT = 1  // Alerter et suspendre les entrées (déconseillé)
  };

//--- Niveau de journalisation
enum ENUM_GLS_LOG_LEVEL
  {
   GLS_LOG_ERROR = 0, // Erreurs seulement
   GLS_LOG_INFO  = 1, // Informations
   GLS_LOG_DEBUG = 2  // Débogage détaillé
  };

//--- Directions
#define GLS_BUY   1
#define GLS_SELL -1

//--- Tendance / régime
#define GLS_TREND_NONE  0
#define GLS_TREND_BULL  1
#define GLS_TREND_BEAR -1

#define GLS_REGIME_UNKNOWN    0
#define GLS_REGIME_TREND      1
#define GLS_REGIME_RANGE      2
#define GLS_REGIME_TRANSITION 3

//--- Événements de structure
#define GLS_EVT_NONE        0
#define GLS_EVT_BOS_UP      1
#define GLS_EVT_BOS_DOWN    2
#define GLS_EVT_CHOCH_UP    3
#define GLS_EVT_CHOCH_DOWN  4

//--- Types de niveaux de liquidité
#define GLS_LVL_M1_SWING    1
#define GLS_LVL_M5_SWING    2
#define GLS_LVL_M15_SWING   3
#define GLS_LVL_PREV_DAY    4
#define GLS_LVL_ASIA        5

//--- Plans de sortie
#define GLS_EXITPLAN_THIRDS 3
#define GLS_EXITPLAN_HALVES 2
#define GLS_EXITPLAN_SINGLE 1

//--- Sessions (statistiques)
#define GLS_SESSION_OFF     0
#define GLS_SESSION_ASIA    1
#define GLS_SESSION_LONDON  2
#define GLS_SESSION_NEWYORK 3
#define GLS_SESSION_OVERLAP 4

//--- Raisons de sortie
#define GLS_EXIT_UNKNOWN      0
#define GLS_EXIT_SL_INITIAL   1
#define GLS_EXIT_SL_BE        2
#define GLS_EXIT_SL_TRAIL     3
#define GLS_EXIT_TP_FINAL     4
#define GLS_EXIT_INVALIDATION 5
#define GLS_EXIT_OPPOSITE     6
#define GLS_EXIT_TIME_MAX     7
#define GLS_EXIT_NO_PROGRESS  8
#define GLS_EXIT_RISK_EXCESS  9
#define GLS_EXIT_CLOSE_ALL    10
#define GLS_EXIT_DAILY_LIMIT  11
#define GLS_EXIT_NO_SL        12
#define GLS_EXIT_WEEKEND      13
#define GLS_EXIT_EXTERNAL     14
#define GLS_EXIT_COUNT        15

//--- Raisons de refus d'une entrée (ordre = priorité d'affichage)
#define GLS_REFUSE_NONE             0
#define GLS_REFUSE_STOPPED          1
#define GLS_REFUSE_STATE            2
#define GLS_REFUSE_CONNECTION       3
#define GLS_REFUSE_TRADE_DISABLED   4
#define GLS_REFUSE_DATA             5
#define GLS_REFUSE_SESSION          6
#define GLS_REFUSE_NEWS             7
#define GLS_REFUSE_DAILY_TRADES     8
#define GLS_REFUSE_CONSEC_LOSSES    9
#define GLS_REFUSE_DAILY_LOSS       10
#define GLS_REFUSE_DRAWDOWN         11
#define GLS_REFUSE_COOLDOWN         12
#define GLS_REFUSE_MAX_POSITIONS    13
#define GLS_REFUSE_EXPOSURE         14
#define GLS_REFUSE_SPREAD           15
#define GLS_REFUSE_VOLATILITY       16
#define GLS_REFUSE_NO_SETUP         17
#define GLS_REFUSE_INCOMPLETE       18
#define GLS_REFUSE_CONTEXT          19
#define GLS_REFUSE_STOP_WIDE        20
#define GLS_REFUSE_STOP_TIGHT       21
#define GLS_REFUSE_RR               22
#define GLS_REFUSE_CHASE            23
#define GLS_REFUSE_SCORE            24
#define GLS_REFUSE_MIN_VOLUME       25
#define GLS_REFUSE_MARGIN           26
#define GLS_REFUSE_TOTAL_RISK       27
#define GLS_REFUSE_DUPLICATE        28
#define GLS_REFUSE_EXEC_ERROR       29
#define GLS_REFUSE_COST             30
#define GLS_REFUSE_STALE_SIGNAL     31
#define GLS_REFUSE_SYMBOL           32

//+------------------------------------------------------------------+
//| Textes                                                            |
//+------------------------------------------------------------------+
string GlsFamilyCode(const int family)
  {
   switch(family)
     {
      case GLS_FAMILY_SWEEP:       return "F1";
      case GLS_FAMILY_PULLBACK:    return "F2";
      case GLS_FAMILY_RANGE_BREAK: return "F3";
      case GLS_FAMILY_SQUEEZE:     return "F4";
     }
   return "F?";
  }

string GlsFamilyName(const int family)
  {
   switch(family)
     {
      case GLS_FAMILY_SWEEP:       return "Balayage liquidité";
      case GLS_FAMILY_PULLBACK:    return "Tendance + pullback";
      case GLS_FAMILY_RANGE_BREAK: return "Cassure de range";
      case GLS_FAMILY_SQUEEZE:     return "Compression/expansion";
     }
   return "Inconnue";
  }

string GlsDirText(const int dir)
  {
   if(dir == GLS_BUY)
      return "ACHAT";
   if(dir == GLS_SELL)
      return "VENTE";
   return "-";
  }

string GlsTrendText(const int trend)
  {
   if(trend == GLS_TREND_BULL)
      return "haussière";
   if(trend == GLS_TREND_BEAR)
      return "baissière";
   return "neutre";
  }

string GlsRegimeText(const int regime)
  {
   switch(regime)
     {
      case GLS_REGIME_TREND:      return "tendance";
      case GLS_REGIME_RANGE:      return "range";
      case GLS_REGIME_TRANSITION: return "transition";
     }
   return "inconnu";
  }

string GlsSessionText(const int session)
  {
   switch(session)
     {
      case GLS_SESSION_ASIA:    return "Asie";
      case GLS_SESSION_LONDON:  return "Londres";
      case GLS_SESSION_NEWYORK: return "New York";
      case GLS_SESSION_OVERLAP: return "Londres+NY";
     }
   return "Hors session";
  }

string GlsExitCode(const int reason)
  {
   switch(reason)
     {
      case GLS_EXIT_SL_INITIAL:   return "SL";
      case GLS_EXIT_SL_BE:        return "BE";
      case GLS_EXIT_SL_TRAIL:     return "TRAIL";
      case GLS_EXIT_TP_FINAL:     return "TP";
      case GLS_EXIT_INVALIDATION: return "INV";
      case GLS_EXIT_OPPOSITE:     return "OPP";
      case GLS_EXIT_TIME_MAX:     return "TIME";
      case GLS_EXIT_NO_PROGRESS:  return "NOPROG";
      case GLS_EXIT_RISK_EXCESS:  return "RISK";
      case GLS_EXIT_CLOSE_ALL:    return "CLOSEALL";
      case GLS_EXIT_DAILY_LIMIT:  return "DAYLIM";
      case GLS_EXIT_NO_SL:        return "NOSL";
      case GLS_EXIT_WEEKEND:      return "WEEKEND";
      case GLS_EXIT_EXTERNAL:     return "EXTERNE";
     }
   return "INCONNU";
  }

//--- Retrouve une raison de sortie à partir du code écrit dans le commentaire
int GlsExitFromCode(const string code)
  {
   for(int r = 1; r < GLS_EXIT_COUNT; r++)
      if(GlsExitCode(r) == code)
         return r;
   return GLS_EXIT_UNKNOWN;
  }

string GlsRefusalText(const int reason)
  {
   switch(reason)
     {
      case GLS_REFUSE_NONE:           return "aucune";
      case GLS_REFUSE_STOPPED:        return "robot arrêté";
      case GLS_REFUSE_STATE:          return "état en cours de vérification (reprise)";
      case GLS_REFUSE_CONNECTION:     return "connexion serveur absente ou instable";
      case GLS_REFUSE_TRADE_DISABLED: return "trading non autorisé (terminal/compte/EA/symbole)";
      case GLS_REFUSE_DATA:           return "données de marché incohérentes ou obsolètes";
      case GLS_REFUSE_SESSION:        return "hors session autorisée";
      case GLS_REFUSE_NEWS:           return "fenêtre d'annonce économique";
      case GLS_REFUSE_DAILY_TRADES:   return "nombre maximal de trades du jour atteint";
      case GLS_REFUSE_CONSEC_LOSSES:  return "pertes consécutives maximales atteintes";
      case GLS_REFUSE_DAILY_LOSS:     return "limite de perte journalière atteinte";
      case GLS_REFUSE_DRAWDOWN:       return "limite de drawdown atteinte";
      case GLS_REFUSE_COOLDOWN:       return "refroidissement après erreur";
      case GLS_REFUSE_MAX_POSITIONS:  return "nombre maximal de positions ouvertes";
      case GLS_REFUSE_EXPOSURE:       return "exposition existante (or / sens opposé / autre source)";
      case GLS_REFUSE_SPREAD:         return "spread excessif ou anormal";
      case GLS_REFUSE_VOLATILITY:     return "volatilité anormale (trop faible ou trop forte)";
      case GLS_REFUSE_NO_SETUP:       return "aucune configuration";
      case GLS_REFUSE_INCOMPLETE:     return "confirmation incomplète";
      case GLS_REFUSE_CONTEXT:        return "contexte M5/M15 contradictoire";
      case GLS_REFUSE_STOP_WIDE:      return "stop logique trop large";
      case GLS_REFUSE_STOP_TIGHT:     return "stop impossible (niveaux du courtier)";
      case GLS_REFUSE_RR:             return "rendement/risque insuffisant";
      case GLS_REFUSE_CHASE:          return "le prix a déjà trop avancé";
      case GLS_REFUSE_SCORE:          return "score insuffisant";
      case GLS_REFUSE_MIN_VOLUME:     return "volume minimal > budget de risque";
      case GLS_REFUSE_MARGIN:         return "marge disponible insuffisante";
      case GLS_REFUSE_TOTAL_RISK:     return "risque agrégé maximal atteint";
      case GLS_REFUSE_DUPLICATE:      return "signal déjà exécuté";
      case GLS_REFUSE_EXEC_ERROR:     return "erreur d'exécution";
      case GLS_REFUSE_COST:           return "coût d'exécution trop élevé";
      case GLS_REFUSE_STALE_SIGNAL:   return "signal antérieur au démarrage";
      case GLS_REFUSE_SYMBOL:         return "symbole non conforme (XAU/USD requis)";
     }
   return "inconnue";
  }

#endif // GLS_DEFINES_MQH
//+------------------------------------------------------------------+
