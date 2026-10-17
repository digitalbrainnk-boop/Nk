//+------------------------------------------------------------------+
//| Stats.mqh - statistiques exactes reconstruites depuis            |
//| l'historique du serveur.                                         |
//|                                                                  |
//| Une TRANSACTION = une POSITION (identifiant de position MT5).    |
//| Les clôtures partielles (TP1, TP2...) sont agrégées : elles ne   |
//| comptent jamais comme des trades distincts.                      |
//| Résultat net = profit + commissions + swaps + frais de toutes    |
//| les transactions (deals) de la position.                         |
//| Taux de réussite = gagnantes / clôturées x 100.                  |
//+------------------------------------------------------------------+
#ifndef GLS_STATS_MQH
#define GLS_STATS_MQH

#include "Sessions.mqh"
#include "SymbolSpec.mqh"
#include "Logger.mqh"
#include "Risk.mqh"
#include "Trend.mqh"
#include "Candles.mqh"

struct STradeRecord
  {
   long              posId;
   int               dir;
   int               family;
   string            hash;
   double            score;
   bool              retest;
   datetime          openTime;
   datetime          closeTime;
   double            entryPrice;
   double            exitPrice;
   double            volume;
   double            gross;
   double            commission;
   double            swap;
   double            fee;
   double            net;
   double            riskMoney;     // 0 = inconnu
   double            riskDist;      // distance entrée-stop initiale (prix), 0 = inconnue
   double            rMultiple;
   int               exitReason;
   int               exitPlan;
   int               session;
   double            slippagePts;   // > 0 = défavorable
   double            spreadPts;
   double            estCost;       // coût estimé à l'entrée (spread + commission)
   double            mfeR;
   double            maeR;
   bool              complete;
   int               lastDealReason;
   string            lastOutComment;
   int               regime;
   int               candleId;
   string            zoneId;        // zone d'origine (F6 : FVG), vide sinon ou si le plan a été reconstruit
   int               zoneRetests;
   double            zoneQuality;
  };

void TradeRecordReset(STradeRecord &r)
  {
   r.posId = 0;
   r.dir = 0;
   r.family = 0;
   r.hash = "";
   r.score = 0.0;
   r.retest = false;
   r.openTime = 0;
   r.closeTime = 0;
   r.entryPrice = 0.0;
   r.exitPrice = 0.0;
   r.volume = 0.0;
   r.gross = 0.0;
   r.commission = 0.0;
   r.swap = 0.0;
   r.fee = 0.0;
   r.net = 0.0;
   r.riskMoney = 0.0;
   r.riskDist = 0.0;
   r.rMultiple = 0.0;
   r.exitReason = GLS_EXIT_UNKNOWN;
   r.exitPlan = 0;
   r.session = GLS_SESSION_OFF;
   r.slippagePts = 0.0;
   r.spreadPts = 0.0;
   r.estCost = 0.0;
   r.mfeR = 0.0;
   r.maeR = 0.0;
   r.complete = false;
   r.lastDealReason = -1;
   r.lastOutComment = "";
   r.regime = 0;
   r.candleId = 0;
   r.zoneId = "";
   r.zoneRetests = 0;
   r.zoneQuality = 0.0;
  }

//--- Commentaire d'entrée : "GLS<famille><B|S>[R] <score> <hash>", ex. "GLS1B 86 7F3A9C"
string BuildEntryComment(const int family, const int dir, const bool retest, const double score, const string hash)
  {
   return GLS_COMMENT_TAG + IntegerToString(family) + (dir == GLS_BUY ? "B" : "S") + (retest ? "R" : "") + " "
          + IntegerToString((long)MathRound(score)) + " " + hash;
  }

//--- Risque initial en points écrit en 4e champ du commentaire d'entrée (0 si absent)
double ParseEntryRiskPoints(const string c)
  {
   string parts[];
   if(StringSplit(c, ' ', parts) < 4)
      return 0.0;
   return StringToDouble(parts[3]);
  }

bool ParseEntryComment(const string c, int &family, int &dir, bool &retest, double &score, string &hash)
  {
   family = 0;
   dir = 0;
   retest = false;
   score = 0.0;
   hash = "";
   if(StringLen(c) < 5 || StringSubstr(c, 0, 3) != GLS_COMMENT_TAG)
      return false;
   int f = (int)StringGetCharacter(c, 3) - '0';
   if(f < 1 || f > GLS_FAMILY_MAX)
      return false;
   ushort d = StringGetCharacter(c, 4);
   if(d != 'B' && d != 'S')
      return false;
   family = f;
   dir = (d == 'B') ? GLS_BUY : GLS_SELL;
   retest = (StringLen(c) > 5 && StringGetCharacter(c, 5) == 'R');
   string parts[];
   int n = StringSplit(c, ' ', parts);
   if(n >= 2)
      score = StringToDouble(parts[1]);
   if(n >= 3)
      hash = parts[2];
   return true;
  }

//--- Commentaire de sortie : "GLS <CODE> <hash>"
string BuildExitComment(const string code, const string hash)
  {
   string tag = GLS_COMMENT_TAG;
   return tag + " " + code + " " + hash;
  }

string ParseExitCode(const string c)
  {
   if(StringLen(c) < 5 || StringSubstr(c, 0, 3) != GLS_COMMENT_TAG || StringGetCharacter(c, 3) != ' ')
      return "";
   string parts[];
   if(StringSplit(c, ' ', parts) < 2)
      return "";
   return parts[1];
  }

//--- Reconstitution complète d'une position depuis l'historique des deals
//--- (modifie la sélection d'historique courante)
bool BuildRecordFromHistory(const long posId, STradeRecord &rec)
  {
   TradeRecordReset(rec);
   rec.posId = posId;
   if(!HistorySelectByPosition(posId))
      return false;
   int n = HistoryDealsTotal();
   double inVol = 0.0;
   double inValue = 0.0;
   double outVol = 0.0;
   double outValue = 0.0;
   bool parsed = false;
   for(int i = 0; i < n; i++)
     {
      ulong deal = HistoryDealGetTicket(i);
      if(deal == 0)
         continue;
      long entry = HistoryDealGetInteger(deal, DEAL_ENTRY);
      long dtype = HistoryDealGetInteger(deal, DEAL_TYPE);
      if(dtype != DEAL_TYPE_BUY && dtype != DEAL_TYPE_SELL)
         continue;
      double vol = HistoryDealGetDouble(deal, DEAL_VOLUME);
      double price = HistoryDealGetDouble(deal, DEAL_PRICE);
      datetime t = (datetime)HistoryDealGetInteger(deal, DEAL_TIME);
      string comment = HistoryDealGetString(deal, DEAL_COMMENT);
      rec.gross += HistoryDealGetDouble(deal, DEAL_PROFIT);
      rec.commission += HistoryDealGetDouble(deal, DEAL_COMMISSION);
      rec.swap += HistoryDealGetDouble(deal, DEAL_SWAP);
      rec.fee += HistoryDealGetDouble(deal, DEAL_FEE);
      if(entry == DEAL_ENTRY_IN)
        {
         if(rec.openTime == 0 || t < rec.openTime)
            rec.openTime = t;
         inVol += vol;
         inValue += vol * price;
         if(rec.dir == 0)
            rec.dir = (dtype == DEAL_TYPE_BUY) ? GLS_BUY : GLS_SELL;
         if(!parsed)
           {
            int fam = 0;
            int d = 0;
            bool rt = false;
            double sc = 0.0;
            string hs = "";
            if(ParseEntryComment(comment, fam, d, rt, sc, hs))
              {
               rec.family = fam;
               rec.retest = rt;
               rec.score = sc;
               rec.hash = hs;
               rec.riskDist = ParseEntryRiskPoints(comment) * g_sym.point;
               parsed = true;
              }
           }
        }
      else
         if(entry == DEAL_ENTRY_OUT || entry == DEAL_ENTRY_OUT_BY)
           {
            outVol += vol;
            outValue += vol * price;
            if(t >= rec.closeTime)
              {
               rec.closeTime = t;
               rec.lastDealReason = (int)HistoryDealGetInteger(deal, DEAL_REASON);
               rec.lastOutComment = comment;
              }
           }
     }
   if(inVol <= 0.0)
      return false;
   rec.volume = inVol;
   rec.entryPrice = inValue / inVol;
   rec.exitPrice = (outVol > 0.0) ? outValue / outVol : 0.0;
   rec.net = rec.gross + rec.commission + rec.swap + rec.fee;
   rec.complete = (outVol >= inVol - GLS_EPS);
   //--- risque initial ESTIMÉ depuis le commentaire (valeur exacte du plan si disponible : voir appelants)
   double perLot = 0.0;
   string det = "";
   if(rec.riskDist > 0.0 && rec.dir != 0 && LossPerLot(rec.dir, rec.entryPrice, rec.entryPrice - (double)rec.dir * rec.riskDist, perLot, det))
     {
      rec.riskMoney = perLot * inVol + 2.0 * g_commissionPerLotSide * inVol;
      rec.rMultiple = (rec.riskMoney > 0.0) ? rec.net / rec.riskMoney : 0.0;
     }
   return true;
  }

//--- Raison de sortie déduite de l'historique (si l'EA n'a pas lui-même clôturé)
int ExitReasonFromHistory(const STradeRecord &rec, const int slStage)
  {
   string code = ParseExitCode(rec.lastOutComment);
   if(StringLen(code) > 0)
     {
      int r = GlsExitFromCode(code);
      if(r != GLS_EXIT_UNKNOWN)
         return r;
     }
   switch(rec.lastDealReason)
     {
      case DEAL_REASON_SL:
         if(slStage >= 2)
            return GLS_EXIT_SL_TRAIL;
         if(slStage == 1)
            return GLS_EXIT_SL_BE;
         if(slStage == 0)
            return GLS_EXIT_SL_INITIAL;
         //--- étape inconnue : déduction par le résultat
         if(rec.riskMoney > 0.0 && rec.net > 0.2 * rec.riskMoney)
            return GLS_EXIT_SL_TRAIL;
         if(rec.riskMoney > 0.0 && rec.net > -0.2 * rec.riskMoney)
            return GLS_EXIT_SL_BE;
         return GLS_EXIT_SL_INITIAL;
      case DEAL_REASON_TP:
         return GLS_EXIT_TP_FINAL;
      case DEAL_REASON_SO:
         return GLS_EXIT_EXTERNAL;
      case DEAL_REASON_CLIENT:
      case DEAL_REASON_MOBILE:
      case DEAL_REASON_WEB:
         return GLS_EXIT_EXTERNAL;
     }
   return GLS_EXIT_UNKNOWN;
  }

//+------------------------------------------------------------------+
//| Agrégats                                                          |
//+------------------------------------------------------------------+
class CGlsStats
  {
public:
   STradeRecord      trades[];
   int               total;
   int               wins;
   int               losses;
   double            grossWin;
   double            grossLoss;      // positif
   double            net;
   double            maxDD;          // en devise, sur la courbe des résultats clôturés
   double            maxDDR;
   int               maxLossStreak;
   double            totalCommission;
   double            totalSwap;
   double            totalFee;
   double            totalEstCost;
   double            avgSlippagePts;
   int               slippageSamples;
   double            avgDurationMin;
   double            sumR;
   int               rSamples;
   double            learnedCommissionPerLotSide;
   string            sourceLabel;

                     CGlsStats(void) { Clear(); }

   void              Clear(void)
     {
      ArrayResize(trades, 0);
      total = 0;
      wins = 0;
      losses = 0;
      grossWin = 0.0;
      grossLoss = 0.0;
      net = 0.0;
      maxDD = 0.0;
      maxDDR = 0.0;
      maxLossStreak = 0;
      totalCommission = 0.0;
      totalSwap = 0.0;
      totalFee = 0.0;
      totalEstCost = 0.0;
      avgSlippagePts = 0.0;
      slippageSamples = 0;
      avgDurationMin = 0.0;
      sumR = 0.0;
      rSamples = 0;
      learnedCommissionPerLotSide = 0.0;
     }

   bool              HasPosition(const long posId) const
     {
      for(int i = ArraySize(trades) - 1; i >= 0; i--)
         if(trades[i].posId == posId)
            return true;
      return false;
     }

   //--- Copie d'un enregistrement connu (false si absent)
   bool              Find(const long posId, STradeRecord &out) const
     {
      for(int i = ArraySize(trades) - 1; i >= 0; i--)
         if(trades[i].posId == posId)
           {
            out = trades[i];
            return true;
           }
      return false;
     }

   //--- Ajout trié par heure de clôture
   void              Add(const STradeRecord &rec)
     {
      if(HasPosition(rec.posId))
         return;
      int n = ArraySize(trades);
      ArrayResize(trades, n + 1);
      int pos = n;
      while(pos > 0 && trades[pos - 1].closeTime > rec.closeTime)
        {
         trades[pos] = trades[pos - 1];
         pos--;
        }
      trades[pos] = rec;
     }

   void              Compute(void)
     {
      total = 0;
      wins = 0;
      losses = 0;
      grossWin = 0.0;
      grossLoss = 0.0;
      net = 0.0;
      maxDD = 0.0;
      maxDDR = 0.0;
      maxLossStreak = 0;
      totalCommission = 0.0;
      totalSwap = 0.0;
      totalFee = 0.0;
      totalEstCost = 0.0;
      avgSlippagePts = 0.0;
      slippageSamples = 0;
      avgDurationMin = 0.0;
      sumR = 0.0;
      rSamples = 0;
      double cum = 0.0;
      double peak = 0.0;
      double cumR = 0.0;
      double peakR = 0.0;
      int streak = 0;
      double durSum = 0.0;
      for(int i = 0; i < ArraySize(trades); i++)
        {
         if(!trades[i].complete)
            continue;
         total++;
         double p = trades[i].net;
         net += p;
         if(p > 0.0)
           {
            wins++;
            grossWin += p;
            streak = 0;
           }
         else
            if(p < 0.0)
              {
               losses++;
               grossLoss += -p;
               streak++;
               if(streak > maxLossStreak)
                  maxLossStreak = streak;
              }
         cum += p;
         if(cum > peak)
            peak = cum;
         if(peak - cum > maxDD)
            maxDD = peak - cum;
         if(trades[i].riskMoney > 0.0)
           {
            cumR += trades[i].rMultiple;
            sumR += trades[i].rMultiple;
            rSamples++;
            if(cumR > peakR)
               peakR = cumR;
            if(peakR - cumR > maxDDR)
               maxDDR = peakR - cumR;
           }
         totalCommission += trades[i].commission;
         totalSwap += trades[i].swap;
         totalFee += trades[i].fee;
         totalEstCost += trades[i].estCost;
         if(trades[i].slippagePts != 0.0 || trades[i].spreadPts > 0.0)
           {
            avgSlippagePts += trades[i].slippagePts;
            slippageSamples++;
           }
         durSum += (double)(trades[i].closeTime - trades[i].openTime) / 60.0;
        }
      if(slippageSamples > 0)
         avgSlippagePts /= slippageSamples;
      if(total > 0)
         avgDurationMin = durSum / total;
     }

   double            WinRate(void) const { return (total > 0) ? 100.0 * wins / total : 0.0; }
   double            ProfitFactor(void) const { return (grossLoss > 0.0) ? grossWin / grossLoss : 0.0; }
   double            Expectancy(void) const { return (total > 0) ? net / total : 0.0; }
   double            ExpectancyR(void) const { return (rSamples > 0) ? sumR / rSamples : 0.0; }
   double            AvgWin(void) const { return (wins > 0) ? grossWin / wins : 0.0; }
   double            AvgLoss(void) const { return (losses > 0) ? grossLoss / losses : 0.0; }

   //--- Résultats du jour (positions clôturées depuis dayStart)
   void              DayFigures(const datetime dayStart, int &dayWins, int &dayLosses, double &dayNet, int &consecLosses) const
     {
      dayWins = 0;
      dayLosses = 0;
      dayNet = 0.0;
      consecLosses = 0;
      for(int i = 0; i < ArraySize(trades); i++)
        {
         if(!trades[i].complete || trades[i].closeTime < dayStart)
            continue;
         dayNet += trades[i].net;
         if(trades[i].net > 0.0)
           {
            dayWins++;
            consecLosses = 0;
           }
         else
            if(trades[i].net < 0.0)
              {
               dayLosses++;
               consecLosses++;
              }
        }
     }

   //--- Pertes consécutives sur tout l'historique (la plus récente série)
   int               CurrentLossStreak(void) const
     {
      int s = 0;
      for(int i = ArraySize(trades) - 1; i >= 0; i--)
        {
         if(!trades[i].complete)
            continue;
         if(trades[i].net < 0.0)
            s++;
         else
            if(trades[i].net > 0.0)
               break;
        }
      return s;
     }

   //--- Ligne de groupe pour le rapport
   string            GroupLine(const string label, const int count, const int w, const double netSum, const double rSum, const int rCount) const
     {
      if(count == 0)
         return "";
      return StringFormat("  %-22s trades %4d | réussite %5.1f %% | net %10.2f | esp. %8.2f | esp. R %6.2f\r\n",
                          label, count, 100.0 * w / count, netSum, netSum / count, (rCount > 0) ? rSum / rCount : 0.0);
     }

   string            Breakdown(const int mode) const
     {
      //--- mode 0 = session, 1 = famille, 2 = raison de sortie, 3 = tranche de score, 4 = régime,
      //--- 5 = fraîcheur de la zone (0 sans zone, 1 premier retour, 2 zone déjà revisitée)
      string out = "";
      int maxKey = (mode == 0) ? 5 : (mode == 1 ? GLS_FAMILY_MAX + 1 : (mode == 2 ? GLS_EXIT_COUNT : (mode == 3 ? 11 : (mode == 4 ? GLS_RG_DISORDER + 1 : 3))));
      for(int key = 0; key < maxKey; key++)
        {
         int c = 0;
         int w = 0;
         double s = 0.0;
         double r = 0.0;
         int rc = 0;
         for(int i = 0; i < ArraySize(trades); i++)
           {
            if(!trades[i].complete)
               continue;
            int k = 0;
            if(mode == 0)
               k = trades[i].session;
            else
               if(mode == 1)
                  k = trades[i].family;
               else
                  if(mode == 2)
                     k = trades[i].exitReason;
                  else
                     if(mode == 3)
                        k = (int)MathFloor(trades[i].score / 10.0);
                     else
                        if(mode == 4)
                           k = trades[i].regime;
                        else
                           k = (StringLen(trades[i].zoneId) == 0) ? 0 : ((trades[i].zoneRetests <= 1) ? 1 : 2);
            if(k != key)
               continue;
            c++;
            if(trades[i].net > 0.0)
               w++;
            s += trades[i].net;
            if(trades[i].riskMoney > 0.0)
              {
               r += trades[i].rMultiple;
               rc++;
              }
           }
         string label = "";
         if(mode == 0)
            label = GlsSessionText(key);
         else
            if(mode == 1)
               label = GlsFamilyCode(key) + " " + GlsFamilyName(key);
            else
               if(mode == 2)
                  label = GlsExitCode(key);
               else
                  if(mode == 3)
                     label = StringFormat("score %d-%d", key * 10, key * 10 + 9);
                  else
                     if(mode == 4)
                        label = RegimeCode(key);
                     else
                        label = (key == 0) ? "sans zone suivie" : ((key == 1) ? "zone fraîche (1er retour)" : "zone déjà revisitée");
         out += GroupLine(label, c, w, s, r, rc);
        }
      return out;
     }

   string            Report(const string currency, const int minTrades) const
     {
      string t = "";
      t += (string)GLS_NAME + " v" + GLS_VERSION + " - statistiques (" + sourceLabel + ")\r\n";
      t += "Une transaction = une position (clôtures partielles agrégées).\r\n\r\n";
      t += StringFormat("Trades clôturés : %d | gagnants %d | perdants %d | réussite %.1f %%\r\n", total, wins, losses, WinRate());
      t += StringFormat("Résultat net : %.2f %s | gain moyen %.2f | perte moyenne %.2f\r\n", net, currency, AvgWin(), AvgLoss());
      if(total >= minTrades)
         t += StringFormat("Profit factor : %.2f | espérance %.2f %s/trade | espérance %.2f R\r\n", ProfitFactor(), Expectancy(), currency, ExpectancyR());
      else
         t += StringFormat("Profit factor / espérance : échantillon insuffisant (%d < %d trades)\r\n", total, minTrades);
      t += StringFormat("Drawdown max (résultats clôturés) : %.2f %s / %.2f R | plus longue série de pertes : %d\r\n", maxDD, currency, maxDDR, maxLossStreak);
      t += StringFormat("Coûts observés : commissions %.2f, swaps %.2f, frais %.2f | coûts estimés à l'entrée %.2f\r\n", totalCommission, totalSwap, totalFee, totalEstCost);
      t += StringFormat("Glissement moyen : %.1f points (%d mesures) | durée moyenne : %.1f min\r\n", avgSlippagePts, slippageSamples, avgDurationMin);
      t += "\r\nPar session :\r\n" + Breakdown(0);
      t += "\r\nPar configuration (famille) :\r\n" + Breakdown(1);
      t += "\r\nPar méthode de sortie :\r\n" + Breakdown(2);
      t += "\r\nPar tranche de score (contrôle de calibration) :\r\n" + Breakdown(3);
      t += "\r\nPar régime de marché à l'entrée :\r\n" + Breakdown(4);
      t += "\r\nPar fraîcheur de la zone (F6) :\r\n" + Breakdown(5);
      return t;
     }

   static string     CsvHeader(void)
     {
      string h = "env;account;symbol;position_id;family;dir;hash;score;retest;session;open_time;close_time;duration_s;entry;exit;volume;";
      h += "risk_money;risk_points;net;gross;commission;swap;fee;r_multiple;exit_reason;exit_plan;slippage_pts;spread_pts;est_cost;mfe_r;mae_r;point;";
      h += "regime;label;candle;zone_id;zone_retests;zone_quality";
      return h;
     }

   string            CsvRow(const STradeRecord &r, const string env, const long account) const
     {
      string row = env + ";" + IntegerToString(account) + ";" + g_sym.name + ";" + IntegerToString(r.posId) + ";"
                   + GlsFamilyCode(r.family) + ";" + (r.dir == GLS_BUY ? "BUY" : "SELL") + ";" + r.hash + ";"
                   + DoubleToString(r.score, 0) + ";" + (r.retest ? "1" : "0") + ";" + GlsSessionText(r.session) + ";"
                   + TimeToString(r.openTime, TIME_DATE | TIME_SECONDS) + ";" + TimeToString(r.closeTime, TIME_DATE | TIME_SECONDS) + ";"
                   + IntegerToString((long)(r.closeTime - r.openTime)) + ";"
                   + DoubleToString(r.entryPrice, g_sym.digits) + ";" + DoubleToString(r.exitPrice, g_sym.digits) + ";"
                   + DoubleToString(r.volume, g_sym.volDigits) + ";" + DoubleToString(r.riskMoney, 2) + ";"
                   + DoubleToString((g_sym.point > 0.0) ? r.riskDist / g_sym.point : 0.0, 1) + ";"
                   + DoubleToString(r.net, 2) + ";" + DoubleToString(r.gross, 2) + ";" + DoubleToString(r.commission, 2) + ";"
                   + DoubleToString(r.swap, 2) + ";" + DoubleToString(r.fee, 2) + ";" + DoubleToString(r.rMultiple, 3) + ";"
                   + GlsExitCode(r.exitReason) + ";" + IntegerToString(r.exitPlan) + ";" + DoubleToString(r.slippagePts, 1) + ";"
                   + DoubleToString(r.spreadPts, 1) + ";" + DoubleToString(r.estCost, 2) + ";"
                   + DoubleToString(r.mfeR, 2) + ";" + DoubleToString(r.maeR, 2) + ";" + DoubleToString(g_sym.point, g_sym.digits) + ";"
                   + RegimeCode(r.regime) + ";" + InpRunLabel + ";" + ((r.candleId > 0) ? CandleCode(r.candleId) : "") + ";"
                   + r.zoneId + ";" + IntegerToString(r.zoneRetests) + ";" + DoubleToString(r.zoneQuality, 2);
      return row;
     }
  };

CGlsStats g_stats;

//--- Liste des identifiants de positions de l'EA ouvertes depuis 'from' (deals d'entrée)
int CollectEaPositionIds(const datetime from, const ulong magic, long &ids[], int &entriesSince, const datetime countFrom)
  {
   ArrayResize(ids, 0);
   entriesSince = 0;
   if(!HistorySelect(from, TimeCurrent() + 86400))
      return 0;
   int n = HistoryDealsTotal();
   for(int i = 0; i < n; i++)
     {
      ulong deal = HistoryDealGetTicket(i);
      if(deal == 0)
         continue;
      if(HistoryDealGetInteger(deal, DEAL_ENTRY) != DEAL_ENTRY_IN)
         continue;
      if((ulong)HistoryDealGetInteger(deal, DEAL_MAGIC) != magic)
         continue;
      if(HistoryDealGetString(deal, DEAL_SYMBOL) != g_sym.name)
         continue;
      if((datetime)HistoryDealGetInteger(deal, DEAL_TIME) >= countFrom)
         entriesSince++;
      long pid = HistoryDealGetInteger(deal, DEAL_POSITION_ID);
      bool known = false;
      for(int j = 0; j < ArraySize(ids); j++)
         if(ids[j] == pid)
           {
            known = true;
            break;
           }
      if(!known)
        {
         int m = ArraySize(ids);
         ArrayResize(ids, m + 1);
         ids[m] = pid;
        }
     }
   return ArraySize(ids);
  }

#endif // GLS_STATS_MQH
//+------------------------------------------------------------------+
