//+------------------------------------------------------------------+
//| Protection.mqh - protections journalières et arrêts de sécurité  |
//|                                                                  |
//| CONVENTIONS (documentées) :                                      |
//|  - Journée : commence à InpDayResetHour (heure du SERVEUR).      |
//|  - Equity de référence : equity du compte au début de journée    |
//|    (mémorisée ; si l'EA démarre en cours de journée sans valeur  |
//|    mémorisée : equity actuelle - résultat EA du jour).           |
//|  - Perte journalière EA = -(résultat réalisé EA du jour          |
//|    + résultat flottant des positions EA), en % de la référence.  |
//|  - Budget de nouvelle position = min(limite journalière restante |
//|    en supposant que tous les stops ouverts sont touchés,         |
//|    risque agrégé restant).                                       |
//|  - Drawdown = baisse de l'equity depuis son plus haut mémorisé.  |
//| Une protection déclenchée bloque les NOUVELLES entrées ; les     |
//| positions ouvertes restent gérées (stops conservés).             |
//+------------------------------------------------------------------+
#ifndef GLS_PROTECTION_MQH
#define GLS_PROTECTION_MQH

#include "Persistence.mqh"
#include "Logger.mqh"

class CGlsGuard
  {
public:
   datetime          dayStart;
   double            dayStartEquity;
   double            dayMinEquity;
   double            peakEquity;
   int               tradesToday;
   int               dayWins;
   int               dayLosses;
   double            realizedToday;
   int               consecLosses;
   double            floatingEA;
   double            worstCaseOpen;     // somme des P/L au stop des positions EA (<= 0 si risque)
   double            openRiskMoney;     // risque total restant (positif)
   double            dailyLossPct;
   double            dailyDDPct;
   double            drawdownPct;
   bool              dailyLossHit;
   bool              drawdownHit;
   bool              consecHit;
   bool              tradesHit;
   datetime          cooldownUntil;
   string            cooldownReason;
   int               consecExecErrors;
   bool              execSuspended;

                     CGlsGuard(void) : dayStart(0), dayStartEquity(0.0), dayMinEquity(0.0), peakEquity(0.0), tradesToday(0), dayWins(0),
                     dayLosses(0), realizedToday(0.0), consecLosses(0), floatingEA(0.0), worstCaseOpen(0.0), openRiskMoney(0.0),
                     dailyLossPct(0.0), dailyDDPct(0.0), drawdownPct(0.0), dailyLossHit(false), drawdownHit(false), consecHit(false),
                     tradesHit(false), cooldownUntil(0), cooldownReason(""), consecExecErrors(0), execSuspended(false) {}

   static datetime   ComputeDayStart(const datetime serverNow, const int resetHour)
     {
      datetime d = DayStart(serverNow) + resetHour * 3600;
      if(serverNow < d)
         d -= 86400;
      return d;
     }

   //--- Initialisation : reprise des valeurs mémorisées
   void              Init(const datetime serverNow, const double equity, const bool resetPeak)
     {
      dayStart = ComputeDayStart(serverNow, InpDayResetHour);
      double storedDay = g_store.Get("day", 0.0);
      if((datetime)storedDay == dayStart && g_store.Has("dayEq"))
        {
         dayStartEquity = g_store.Get("dayEq", equity);
         dayMinEquity = g_store.Get("dayMin", equity);
        }
      else
        {
         dayStartEquity = 0.0;   // fixé par l'EA après reconstruction du résultat du jour
         dayMinEquity = equity;
        }
      peakEquity = g_store.Get("peak", equity);
      if(resetPeak || peakEquity <= 0.0)
         peakEquity = equity;
      g_store.Set("peak", peakEquity);
      execSuspended = (g_store.Get("execSusp", 0.0) > 0.5 && (datetime)g_store.Get("execSuspDay", 0.0) == dayStart);
     }

   //--- Référence de début de journée quand elle n'a pas été mémorisée
   void              EnsureDayEquity(const double equity)
     {
      if(dayStartEquity > 0.0)
         return;
      dayStartEquity = equity - realizedToday - floatingEA;
      if(dayStartEquity <= 0.0)
         dayStartEquity = equity;
      if(dayMinEquity <= 0.0 || dayMinEquity > equity)
         dayMinEquity = equity;
      Persist();
     }

   void              Persist(void)
     {
      g_store.Set("day", (double)dayStart);
      g_store.Set("dayEq", dayStartEquity);
      g_store.Set("dayMin", dayMinEquity);
      g_store.Set("peak", peakEquity);
     }

   //--- Changement de journée ? (true = nouvelle journée commencée)
   bool              CheckRollover(const datetime serverNow, const double equity)
     {
      datetime ds = ComputeDayStart(serverNow, InpDayResetHour);
      if(ds == dayStart)
         return false;
      dayStart = ds;
      dayStartEquity = equity;
      dayMinEquity = equity;
      tradesToday = 0;
      dayWins = 0;
      dayLosses = 0;
      realizedToday = 0.0;
      if(InpConsecLossesDaily)
         consecLosses = 0;
      dailyLossHit = false;
      consecHit = false;
      tradesHit = false;
      execSuspended = false;
      consecExecErrors = 0;
      g_store.Set("execSusp", 0.0);
      Persist();
      return true;
     }

   void              SetDayFigures(const int trades, const int wins, const int lossesCount, const double realized, const int consec)
     {
      tradesToday = trades;
      dayWins = wins;
      dayLosses = lossesCount;
      realizedToday = realized;
      consecLosses = consec;
     }

   void              SetOpenExposure(const double floating, const double worstCase)
     {
      floatingEA = floating;
      worstCaseOpen = worstCase;
      openRiskMoney = MathMax(0.0, -worstCase);
     }

   //--- Recalcul des indicateurs et des déclenchements
   void              Evaluate(const double equity)
     {
      if(equity > peakEquity)
        {
         peakEquity = equity;
         g_store.Set("peak", peakEquity);
        }
      if(dayMinEquity <= 0.0 || equity < dayMinEquity)
        {
         dayMinEquity = equity;
         g_store.Set("dayMin", dayMinEquity);
        }
      double ref = (dayStartEquity > 0.0) ? dayStartEquity : equity;
      double eaDay = realizedToday + floatingEA;
      dailyLossPct = (eaDay < 0.0) ? 100.0 * SafeDiv(-eaDay, ref, 1.0) : 0.0;
      dailyDDPct = MathMax(0.0, 100.0 * SafeDiv(ref - dayMinEquity, ref, 0.0));
      drawdownPct = (peakEquity > 0.0) ? MathMax(0.0, 100.0 * (peakEquity - equity) / peakEquity) : 0.0;

      bool wasDaily = dailyLossHit;
      bool wasDD = drawdownHit;
      dailyLossHit = (InpMaxDailyLossPct > 0.0 && dailyLossPct >= InpMaxDailyLossPct);
      drawdownHit = (InpMaxDrawdownPct > 0.0 && drawdownPct >= InpMaxDrawdownPct);
      consecHit = (InpMaxConsecutiveLosses > 0 && consecLosses >= InpMaxConsecutiveLosses);
      tradesHit = (InpMaxTradesPerDay > 0 && tradesToday >= InpMaxTradesPerDay);
      if(dailyLossHit && !wasDaily)
         g_log.Warn("PROTECTION", StringFormat("limite de perte journalière atteinte : %.2f %% >= %.2f %%", dailyLossPct, InpMaxDailyLossPct));
      if(drawdownHit && !wasDD)
         g_log.Warn("PROTECTION", StringFormat("limite de drawdown atteinte : %.2f %% >= %.2f %%", drawdownPct, InpMaxDrawdownPct));
     }

   //--- Raison de blocage des nouvelles entrées (GLS_REFUSE_NONE si autorisé)
   int               EntryBlockReason(const datetime serverNow) const
     {
      if(drawdownHit)
         return GLS_REFUSE_DRAWDOWN;
      if(dailyLossHit)
         return GLS_REFUSE_DAILY_LOSS;
      if(consecHit)
         return GLS_REFUSE_CONSEC_LOSSES;
      if(tradesHit)
         return GLS_REFUSE_DAILY_TRADES;
      if(execSuspended)
         return GLS_REFUSE_EXEC_ERROR;
      if(serverNow < cooldownUntil)
         return GLS_REFUSE_COOLDOWN;
      return GLS_REFUSE_NONE;
     }

   //--- Budget de risque disponible pour une nouvelle position (devise du compte)
   double            RiskBudgetMoney(const double equity) const
     {
      double ref = (dayStartEquity > 0.0) ? dayStartEquity : equity;
      double maxDayLoss = ref * InpMaxDailyLossPct / 100.0;
      double worstDay = realizedToday + MathMin(0.0, worstCaseOpen);
      double dailyRemaining = (InpMaxDailyLossPct > 0.0) ? maxDayLoss - MathMax(0.0, -worstDay) : 1e18;
      double aggRemaining = equity * InpMaxTotalRiskPct / 100.0 - openRiskMoney;
      return MathMax(0.0, MathMin(dailyRemaining, aggRemaining));
     }

   void              StartCooldown(const datetime serverNow, const int seconds, const string reason)
     {
      cooldownUntil = serverNow + seconds;
      cooldownReason = reason;
     }

   void              OnExecError(const datetime serverNow, const string reason)
     {
      consecExecErrors++;
      StartCooldown(serverNow, InpErrorCooldownSec, reason);
      if(InpMaxConsecExecErrors > 0 && consecExecErrors >= InpMaxConsecExecErrors && !execSuspended)
        {
         execSuspended = true;
         g_store.Set("execSusp", 1.0);
         g_store.Set("execSuspDay", (double)dayStart);
         g_log.Critical("PROTECTION", StringFormat("%d erreurs d'exécution consécutives : nouvelles entrées suspendues jusqu'à demain ou redémarrage manuel", consecExecErrors));
        }
     }

   void              OnExecSuccess(void)
     {
      consecExecErrors = 0;
     }

   //--- Réactivation manuelle (bouton Démarrer) : efface la suspension d'exécution
   void              ManualReset(void)
     {
      execSuspended = false;
      consecExecErrors = 0;
      cooldownUntil = 0;
      g_store.Set("execSusp", 0.0);
     }

   bool              AnyHit(void) const
     {
      return (dailyLossHit || drawdownHit || consecHit || tradesHit || execSuspended);
     }

   string            StatusText(const datetime serverNow) const
     {
      int r = EntryBlockReason(serverNow);
      if(r == GLS_REFUSE_NONE)
         return "ACTIVE - aucune limite atteinte";
      if(r == GLS_REFUSE_COOLDOWN)
         return "REFROIDISSEMENT jusqu'à " + TimeToString(cooldownUntil, TIME_MINUTES) + " (" + cooldownReason + ")";
      return "DÉCLENCHÉE : " + GlsRefusalText(r);
     }
  };

CGlsGuard g_guard;

#endif // GLS_PROTECTION_MQH
//+------------------------------------------------------------------+
