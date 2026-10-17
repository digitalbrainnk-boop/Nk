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
#include "Candles.mqh"
#include "Trend.mqh"
#include "Fvg.mqh"

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
   double            atr5Long[];   // ATR(100) M5
   double            ema15[];      // EMA(200) M15
   double            atr15[];      // ATR(14) M15
   CStructure        st1;
   CStructure        st5;
   CStructure        st15;
   CTrendModel       t5;
   CTrendModel       t15;
   int               regime;
   string            regimeWhy;
   CZoneMap          zones;
   CFvgMap           fvg5;
   CFvgMap           fvg1;
   COrderBlockMap    ob5;          // Order Blocks M5 (règles propres, OrderBlocks.mqh)
   COrderBlockMap    ob1;          // Order Blocks M1 (seulement si InpFvgTF = M1)
   CCandleAnalysis   cdlBuy;       // figures haussières (série réelle) + figures neutres
   CCandleAnalysis   cdlSell;      // figures baissières (série miroir)
   bool              dataGap;
   string            dataGapText;
   double            spreadNow;
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

                     CMarketContext(void) : regime(GLS_RG_UNKNOWN), regimeWhy(""), dataGap(false), dataGapText(""), spreadNow(0.0), pdh(0.0), pdl(0.0),
                     pdValid(false), asiaHigh(0.0), asiaLow(0.0), asiaValid(false), asiaEndServer(0), ready(false), error(""), m5Last(0), m15Last(0),
                     dataErrors(0) {}

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
                            const int emaPeriod, const int k5, const int k15, const double erTrendMin, const int transitionBars,
                            const double spread)
     {
      ready = false;
      spreadNow = spread;
      string err = "";
      bool m5Changed = false;
      bool m15Changed = false;
      if(!LoadClosedBars(sym, PERIOD_M1, 400, 150, m1, err))
        {
         error = "M1 " + err;
         dataErrors++;
         return false;
        }
      CalcATR(m1, 14, atr);
      CalcATR(m1, 100, atrLong);
      m1Mirror.MirrorFrom(m1);

      datetime bar5 = iTime(sym, PERIOD_M5, 1);
      if(bar5 == 0 || bar5 != m5Last || m5.count == 0)
        {
         if(!LoadClosedBars(sym, PERIOD_M5, 1000, emaPeriod * 2, m5, err))
           {
            error = "M5 " + err;
            dataErrors++;
            return false;
           }
         CalcEMA(m5.close, m5.count, emaPeriod, ema5);
         CalcATR(m5, 14, atr5);
         CalcATR(m5, 100, atr5Long);
         st5.Analyze(m5, k5, 20, erTrendMin, transitionBars * 3);
         m5Last = m5.time[m5.count - 1];
         m5Changed = true;
        }

      datetime bar15 = iTime(sym, PERIOD_M15, 1);
      if(bar15 == 0 || bar15 != m15Last || m15.count == 0)
        {
         if(!LoadClosedBars(sym, PERIOD_M15, 800, 100, m15, err))
           {
            error = "M15 " + err;
            dataErrors++;
            return false;
           }
         CalcEMA(m15.close, m15.count, InpEMAPeriodM15, ema15);
         CalcATR(m15, 14, atr15);
         st15.Analyze(m15, k15, 16, erTrendMin, transitionBars);
         m15Last = m15.time[m15.count - 1];
         m15Changed = true;
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

      //--- tendance M15 / M5 et régime
      if(m15Changed || !t15.ready)
         t15.Evaluate(m15, st15, ema15, atr15[m15.count - 1], InpTrendSlopeBars, erTrendMin, transitionBars);
      if(m5Changed || !t5.ready)
         t5.Evaluate(m5, st5, ema5, atr5[m5.count - 1], InpTrendSlopeBars, erTrendMin, transitionBars * 3);
      regime = ClassifyRegime(t15, m5, atr5[m5.count - 1], atr5Long[m5.count - 1], regimeWhy);

      //--- supports / résistances et FVG M5 (à chaque nouvelle barre M5 ou M15)
      double pt = SymbolInfoDouble(sym, SYMBOL_POINT);
      if(m5Changed || m15Changed)
        {
         zones.Build(st5, st15, m5, atr5[m5.count - 1], serverNow);
         fvg5.Build(m5, atr5, st5, zones, 5, 300, pt);
         ob5.Build(m5, atr5, st5, 5, 300);
         LinkFvgOrderBlocks(fvg5, ob5, atr5);
        }
      //--- structure, FVG et bougies M1 ; une FVG M1 contenue dans une FVG M5 est un doublon
      st1.Analyze(m1, InpM1SwingStrength, 20, erTrendMin, transitionBars * 15);
      fvg1.Build(m1, atr, st1, zones, 1, 120, pt);
      MarkNestedFvgDuplicates(fvg1, fvg5);
      if(InpFvgTF == GLS_FVGTF_M1)
        {
         ob1.Build(m1, atr, st1, 1, 120);
         LinkFvgOrderBlocks(fvg1, ob1, atr);
        }
      else
         ArrayResize(ob1.obs, 0);
      cdlBuy.Analyze(m1, atr, GLS_BUY, InpCdlLookback);
      cdlSell.Analyze(m1Mirror, atr, GLS_SELL, InpCdlLookback);
      EvaluateCandleContext(cdlBuy);
      EvaluateCandleContext(cdlSell);

      //--- intégrité : trous dans les barres M1 récentes
      dataGap = false;
      dataGapText = "";
      for(int i = MathMax(1, m1.count - 30); i < m1.count; i++)
         if(m1.time[i] - m1.time[i - 1] > InpMaxBarGapMin * 60)
           {
            dataGap = true;
            dataGapText = "trou de données M1 avant " + TimeToString(m1.time[i], TIME_MINUTES);
           }
      error = "";
      ready = true;
      return true;
     }

   //--- Interprétation contextuelle des figures de bougies (journal et preuves)
   void              EvaluateCandleContext(CCandleAnalysis &ca)
     {
      int last = m1.count - 1;
      double a = (last >= 0) ? atr[last] : 0.0;
      if(a <= 0.0)
         return;
      double prox = InpCdlZoneProxATR * a;
      for(int i = 0; i < ArraySize(ca.pats); i++)
        {
         int d = (ca.pats[i].dir != 0) ? ca.pats[i].dir : ca.viewDir;
         double vs = (ca.viewDir == GLS_BUY) ? 1.0 : -1.0;
         double realLow = (vs > 0.0) ? ca.pats[i].low : -ca.pats[i].high;
         double realHigh = (vs > 0.0) ? ca.pats[i].high : -ca.pats[i].low;
         double extreme = (d > 0) ? realLow : realHigh;
         //--- proximité d'une zone favorable : S/R de bon rôle, liquidité, FVG du même sens
         bool near = false;
         int favRole = (d > 0) ? GLS_ZONE_SUPPORT : GLS_ZONE_RESIST;
         for(int z = 0; z < ArraySize(zones.zones) && !near; z++)
            if(zones.zones[z].valid && zones.zones[z].role == favRole && extreme >= zones.zones[z].lo - prox && extreme <= zones.zones[z].hi + prox)
               near = true;
         for(int f = 0; f < ArraySize(fvg5.fvgs) && !near; f++)
            if(fvg5.fvgs[f].dir == d && fvg5.fvgs[f].status <= GLS_FVG_PARTIAL && extreme >= fvg5.fvgs[f].lo - prox && extreme <= fvg5.fvgs[f].hi + prox)
               near = true;
         if(d > 0)
           {
            for(int l = 0; l < ArraySize(liq.lows) && !near; l++)
               if(MathAbs(liq.lows[l].price - extreme) <= prox)
                  near = true;
           }
         else
           {
            for(int l = 0; l < ArraySize(liq.highs) && !near; l++)
               if(MathAbs(liq.highs[l].price - extreme) <= prox)
                  near = true;
           }
         //--- obstacle opposé immédiat (moins d'1 ATR)
         bool obst = false;
         int oppRole = (d > 0) ? GLS_ZONE_RESIST : GLS_ZONE_SUPPORT;
         for(int z = 0; z < ArraySize(zones.zones) && !obst; z++)
           {
            if(!zones.zones[z].valid || zones.zones[z].role != oppRole)
               continue;
            double dist = (d > 0) ? zones.zones[z].lo - realHigh : realLow - zones.zones[z].hi;
            if(dist >= 0.0 && dist <= a)
               obst = true;
           }
         int b = ca.pats[i].bar;
         double rng = (b >= 0 && b <= last) ? m1.high[b] - m1.low[b] : 0.0;
         ca.pats[i].nearZone = near;
         ca.pats[i].obstacle = obst;
         ca.pats[i].noisy = (rng <= 0.0 || spreadNow > 0.35 * rng);
         int al = 0;
         if(t15.dir != 0)
            al = (t15.dir == d) ? 1 : -1;
         else
            if(t5.dir != 0)
               al = (t5.dir == d) ? 1 : -1;
         ca.pats[i].trendAlign = al;
         if(ca.pats[i].dir == 0)
            ca.pats[i].interpretable = !ca.pats[i].noisy;
         else
           {
            bool cont = (ca.pats[i].category == GLS_CDLCAT_CONTINUATION || ca.pats[i].category == GLS_CDLCAT_COMPOSITE);
            ca.pats[i].interpretable = ca.pats[i].contextOk && !ca.pats[i].noisy && al >= 0 && !obst && (near || (cont && al > 0));
           }
        }
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
