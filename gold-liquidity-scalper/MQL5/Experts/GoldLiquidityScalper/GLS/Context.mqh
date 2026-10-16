//+------------------------------------------------------------------+
//| Context.mqh - contexte de marché multi-unités de temps           |
//|   M1  : déclenchement (barres clôturées, ATR14 / ATR100)         |
//|   M5  : EMA200, structure opérationnelle (BOS/CHOCH)             |
//|   M15 : structure dominante, régime (tendance/range/transition)  |
//|   + carte de liquidité : swings M5/M15 non cassés, plus haut /   |
//|     plus bas de la veille, plage asiatique.                      |
//+------------------------------------------------------------------+
#ifndef GLS_CONTEXT_MQH
#define GLS_CONTEXT_MQH

#include "Structure.mqh"
#include "Sessions.mqh"

//--- Heure de clôture de la première barre clôturant au-delà d'un niveau après fromTime (0 = aucune)
datetime FirstCloseBeyond(const CBarSeries &s, const datetime fromTime, const double level, const bool above)
  {
   for(int i = 0; i < s.count; i++)
     {
      if(s.time[i] < fromTime)
         continue;
      if(above && s.close[i] > level)
         return s.CloseTime(i);
      if(!above && s.close[i] < level)
         return s.CloseTime(i);
     }
   return 0;
  }

class CMarketContext
  {
public:
   CBarSeries        m1;
   CBarSeries        m1Mirror;
   CBarSeries        m5;
   CBarSeries        m15;
   double            atr[];        // ATR(14) M1
   double            atrLong[];    // ATR(100) M1
   double            atr5[];       // ATR(14) M5
   double            ema5[];       // EMA(200) M5
   CStructure        st5;
   CStructure        st15;
   CLiquidityMap     liq;
   double            pdh;
   double            pdl;
   bool              pdValid;
   double            asiaHigh;
   double            asiaLow;
   bool              asiaValid;
   datetime          asiaEndServer;
   bool              ready;
   string            error;
   datetime          m5Last;
   datetime          m15Last;
   int               dataErrors;

                     CMarketContext(void) : pdh(0.0), pdl(0.0), pdValid(false), asiaHigh(0.0), asiaLow(0.0), asiaValid(false),
                     asiaEndServer(0), ready(false), error(""), m5Last(0), m15Last(0), dataErrors(0) {}

   int               Last(void) const { return m1.count - 1; }
   double            Atr(void) const { return (m1.count > 0) ? atr[m1.count - 1] : 0.0; }
   double            AtrLong(void) const { return (m1.count > 0) ? atrLong[m1.count - 1] : 0.0; }
   double            Ema5(void) const { return (m5.count > 0) ? ema5[m5.count - 1] : 0.0; }
   double            M5Close(void) const { return (m5.count > 0) ? m5.close[m5.count - 1] : 0.0; }

   //--- Côté de l'EMA200 M5 : +1 au-dessus, -1 en dessous, 0 indéterminé
   int               EmaSide(void) const
     {
      double e = Ema5();
      if(e <= 0.0)
         return 0;
      double c = M5Close();
      if(c > e)
         return 1;
      if(c < e)
         return -1;
      return 0;
     }

   //--- Mise à jour à chaque nouvelle barre M1
   bool              Update(const string sym, const datetime serverNow, const CGlsClock &clock,
                            const int emaPeriod, const int k5, const int k15, const double erTrendMin, const int transitionBars)
     {
      ready = false;
      string err = "";
      if(!LoadClosedBars(sym, PERIOD_M1, 400, 150, m1, err))
        {
         error = "M1 " + err;
         dataErrors++;
         return false;
        }
      CalcATR(m1, 14, atr);
      CalcATR(m1, 100, atrLong);
      m1Mirror.MirrorFrom(m1);

      datetime t5 = iTime(sym, PERIOD_M5, 1);
      if(t5 == 0 || t5 != m5Last || m5.count == 0)
        {
         if(!LoadClosedBars(sym, PERIOD_M5, 1000, emaPeriod * 2, m5, err))
           {
            error = "M5 " + err;
            dataErrors++;
            return false;
           }
         CalcEMA(m5.close, m5.count, emaPeriod, ema5);
         CalcATR(m5, 14, atr5);
         st5.Analyze(m5, k5, 20, erTrendMin, transitionBars * 3);
         m5Last = m5.time[m5.count - 1];
        }

      datetime t15 = iTime(sym, PERIOD_M15, 1);
      if(t15 == 0 || t15 != m15Last || m15.count == 0)
        {
         if(!LoadClosedBars(sym, PERIOD_M15, 400, 100, m15, err))
           {
            error = "M15 " + err;
            dataErrors++;
            return false;
           }
         st15.Analyze(m15, k15, 16, erTrendMin, transitionBars);
         m15Last = m15.time[m15.count - 1];
        }

      //--- cohérence temporelle entre unités de temps (aucune barre "du futur")
      datetime lastClose = m1.CloseTime(m1.count - 1);
      if(m5.CloseTime(m5.count - 1) > lastClose + 60 || m15.CloseTime(m15.count - 1) > lastClose + 60)
        {
         error = "unités de temps désynchronisées";
         dataErrors++;
         return false;
        }

      BuildLevels(sym, serverNow, clock);
      error = "";
      ready = true;
      return true;
     }

   //--- Niveaux de liquidité externes
   void              BuildLevels(const string sym, const datetime serverNow, const CGlsClock &clock)
     {
      liq.Clear();
      liq.AddSwings(st5, GLS_LVL_M5_SWING, 12);
      liq.AddSwings(st15, GLS_LVL_M15_SWING, 12);

      //--- veille (jour serveur)
      pdValid = false;
      MqlRates d1[];
      ArraySetAsSeries(d1, false);
      datetime today = iTime(sym, PERIOD_D1, 0);
      if(today > 0 && CopyRates(sym, PERIOD_D1, 1, 1, d1) == 1)
        {
         pdh = d1[0].high;
         pdl = d1[0].low;
         pdValid = (pdh > 0.0 && pdl > 0.0 && pdh > pdl);
         if(pdValid)
           {
            liq.Add(true, pdh, GLS_LVL_PREV_DAY, today, FirstCloseBeyond(m5, today, pdh, true));
            liq.Add(false, pdl, GLS_LVL_PREV_DAY, today, FirstCloseBeyond(m5, today, pdl, false));
           }
        }

      //--- plage asiatique du jour UTC courant (valide après sa clôture)
      asiaValid = false;
      datetime utcNow = clock.ServerToUtc(serverNow);
      datetime utcDay = DayStart(utcNow);
      int startMin = clock.asiaStartUtc;
      int endMin = clock.asiaEndUtc;
      if(startMin >= 0 && endMin > startMin && MinuteOfDay(utcNow) >= endMin)
        {
         double hi = 0.0;
         double lo = 0.0;
         int bars = 0;
         for(int i = 0; i < m15.count; i++)
           {
            datetime u = clock.ServerToUtc(m15.time[i]);
            if(DayStart(u) != utcDay)
               continue;
            int mod = MinuteOfDay(u);
            if(mod < startMin || mod + 15 > endMin)
               continue;
            if(bars == 0 || m15.high[i] > hi)
               hi = m15.high[i];
            if(bars == 0 || m15.low[i] < lo)
               lo = m15.low[i];
            bars++;
           }
         int expected = (endMin - startMin) / 15;
         if(bars >= MathMax(1, expected / 2) && hi > lo)
           {
            asiaHigh = hi;
            asiaLow = lo;
            asiaValid = true;
            asiaEndServer = clock.UtcToServer(utcDay + endMin * 60);
            liq.Add(true, hi, GLS_LVL_ASIA, asiaEndServer, FirstCloseBeyond(m5, asiaEndServer, hi, true));
            liq.Add(false, lo, GLS_LVL_ASIA, asiaEndServer, FirstCloseBeyond(m5, asiaEndServer, lo, false));
           }
        }
     }

   //--- Fraîcheur : la dernière barre M1 clôturée doit être récente
   bool              IsFresh(const datetime serverNow, const int maxAgeSec) const
     {
      if(m1.count == 0)
         return false;
      return (serverNow - m1.CloseTime(m1.count - 1) <= maxAgeSec);
     }
  };

CMarketContext g_ctx;

#endif // GLS_CONTEXT_MQH
//+------------------------------------------------------------------+
