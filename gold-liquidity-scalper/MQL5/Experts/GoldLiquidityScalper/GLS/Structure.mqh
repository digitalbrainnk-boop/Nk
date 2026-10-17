//+------------------------------------------------------------------+
//| Structure.mqh - structure de marché programmable                 |
//|                                                                  |
//| DÉFINITIONS (k = force du swing, en barres de chaque côté) :     |
//|  Sommet structurel (swing high) en i :                           |
//|    high[i] >  high[j] pour j = i-k .. i-1                        |
//|    high[i] >= high[j] pour j = i+1 .. i+k                        |
//|    -> CONFIRMÉ seulement à la clôture de la barre i+k            |
//|  Creux structurel : symétrique sur les plus bas.                 |
//|  BOS haussier  : clôture > dernier sommet confirmé non cassé,    |
//|                  alors que la tendance n'était pas baissière.    |
//|  CHOCH haussier: même cassure alors que la tendance était        |
//|                  baissière (changement de caractère).            |
//|  (symétrique pour BOS/CHOCH baissiers)                           |
//|  Un niveau est "cassé" à la première CLÔTURE au-delà ; une       |
//|  simple mèche ne casse pas un niveau (c'est un balayage).        |
//+------------------------------------------------------------------+
#ifndef GLS_STRUCTURE_MQH
#define GLS_STRUCTURE_MQH

#include "MarketData.mqh"

struct SSwing
  {
   int               index;
   double            price;
   datetime          time;          // ouverture de la barre du swing
   datetime          confirmTime;   // clôture de la barre i+k (connu à partir de cet instant)
   datetime          brokenTime;    // clôture qui a cassé le niveau (0 = intact)
  };

//--- Événement de structure daté (historique conservé pour l'analyse des FVG)
struct SStructEvent
  {
   int               type;      // GLS_EVT_*
   int               index;     // barre de la clôture de cassure
   double            level;
   datetime          time;      // clôture de la barre
  };

bool IsSwingHigh(const CBarSeries &s, const int i, const int k)
  {
   if(k < 1 || i - k < 0 || i + k > s.count - 1)
      return false;
   for(int j = i - k; j < i; j++)
      if(s.high[j] >= s.high[i])
         return false;
   for(int j = i + 1; j <= i + k; j++)
      if(s.high[j] > s.high[i])
         return false;
   return true;
  }

bool IsSwingLow(const CBarSeries &s, const int i, const int k)
  {
   if(k < 1 || i - k < 0 || i + k > s.count - 1)
      return false;
   for(int j = i - k; j < i; j++)
      if(s.low[j] <= s.low[i])
         return false;
   for(int j = i + 1; j <= i + k; j++)
      if(s.low[j] < s.low[i])
         return false;
   return true;
  }

//+------------------------------------------------------------------+
//| Analyse de structure d'une unité de temps                         |
//+------------------------------------------------------------------+
class CStructure
  {
public:
   SSwing            highs[];
   SSwing            lows[];
   SStructEvent      events[];
   int               trend;           // GLS_TREND_*
   int               lastEvent;       // GLS_EVT_*
   int               lastEventIndex;
   double            lastEventLevel;
   datetime          lastEventTime;   // clôture de la barre de l'événement
   int               regime;          // GLS_REGIME_*
   double            er;              // efficiency ratio
   int               swingBias;       // +1 HH/HL, -1 LH/LL, 0 mixte
   bool              ready;

                     CStructure(void) { Reset(); }

   void              Reset(void)
     {
      ArrayResize(highs, 0);
      ArrayResize(lows, 0);
      ArrayResize(events, 0);
      trend = GLS_TREND_NONE;
      lastEvent = GLS_EVT_NONE;
      lastEventIndex = -1;
      lastEventLevel = 0.0;
      lastEventTime = 0;
      regime = GLS_REGIME_UNKNOWN;
      er = 0.0;
      swingBias = 0;
      ready = false;
     }

   void              Analyze(const CBarSeries &s, const int k, const int erPeriod, const double erTrendMin, const int transitionBars)
     {
      Reset();
      if(s.count < 2 * k + 3)
         return;
      int lastHigh = -1;
      int lastLow = -1;
      for(int j = 0; j < s.count; j++)
        {
         //--- 1) confirmation des swings dont la barre de droite est j
         int i = j - k;
         if(i >= k)
           {
            if(IsSwingHigh(s, i, k))
              {
               int n = ArraySize(highs);
               ArrayResize(highs, n + 1);
               highs[n].index = i;
               highs[n].price = s.high[i];
               highs[n].time = s.time[i];
               highs[n].confirmTime = s.CloseTime(j);
               highs[n].brokenTime = 0;
               lastHigh = n;
              }
            if(IsSwingLow(s, i, k))
              {
               int n = ArraySize(lows);
               ArrayResize(lows, n + 1);
               lows[n].index = i;
               lows[n].price = s.low[i];
               lows[n].time = s.time[i];
               lows[n].confirmTime = s.CloseTime(j);
               lows[n].brokenTime = 0;
               lastLow = n;
              }
           }
         //--- 2) cassures par clôture (BOS / CHOCH) du dernier swing
         if(lastHigh >= 0 && highs[lastHigh].brokenTime == 0 && s.close[j] > highs[lastHigh].price)
           {
            lastEvent = (trend == GLS_TREND_BEAR) ? GLS_EVT_CHOCH_UP : GLS_EVT_BOS_UP;
            trend = GLS_TREND_BULL;
            lastEventIndex = j;
            lastEventLevel = highs[lastHigh].price;
            lastEventTime = s.CloseTime(j);
            AddEvent(lastEvent, j, lastEventLevel, lastEventTime);
           }
         if(lastLow >= 0 && lows[lastLow].brokenTime == 0 && s.close[j] < lows[lastLow].price)
           {
            lastEvent = (trend == GLS_TREND_BULL) ? GLS_EVT_CHOCH_DOWN : GLS_EVT_BOS_DOWN;
            trend = GLS_TREND_BEAR;
            lastEventIndex = j;
            lastEventLevel = lows[lastLow].price;
            lastEventTime = s.CloseTime(j);
            AddEvent(lastEvent, j, lastEventLevel, lastEventTime);
           }
         //--- 3) statut "cassé" de tous les niveaux (liquidité encore présente ou non)
         datetime ct = s.CloseTime(j);
         for(int h = ArraySize(highs) - 1; h >= 0; h--)
            if(highs[h].brokenTime == 0 && highs[h].confirmTime <= ct && s.close[j] > highs[h].price)
               highs[h].brokenTime = ct;
         for(int l = ArraySize(lows) - 1; l >= 0; l--)
            if(lows[l].brokenTime == 0 && lows[l].confirmTime <= ct && s.close[j] < lows[l].price)
               lows[l].brokenTime = ct;
        }

      //--- séquence des deux derniers sommets/creux
      int nh = ArraySize(highs);
      int nl = ArraySize(lows);
      if(nh >= 2 && nl >= 2)
        {
         bool hh = highs[nh - 1].price > highs[nh - 2].price;
         bool hl = lows[nl - 1].price > lows[nl - 2].price;
         bool lh = highs[nh - 1].price < highs[nh - 2].price;
         bool ll = lows[nl - 1].price < lows[nl - 2].price;
         if(hh && hl)
            swingBias = 1;
         else
            if(lh && ll)
               swingBias = -1;
        }

      //--- régime : tendance / range / transition
      er = EfficiencyRatio(s, s.count - 1, erPeriod);
      regime = (er >= erTrendMin) ? GLS_REGIME_TREND : GLS_REGIME_RANGE;
      if((lastEvent == GLS_EVT_CHOCH_UP || lastEvent == GLS_EVT_CHOCH_DOWN) && (s.count - 1 - lastEventIndex) <= transitionBars)
         regime = GLS_REGIME_TRANSITION;
      ready = true;
     }

   void              AddEvent(const int type, const int index, const double level, const datetime t)
     {
      int n = ArraySize(events);
      ArrayResize(events, n + 1);
      events[n].type = type;
      events[n].index = index;
      events[n].level = level;
      events[n].time = t;
     }

   //--- Cassure haussière (dir > 0) ou baissière entre les barres from et to (incluses) ?
   //--- isChoch = true si la cassure trouvée est un CHOCH ; evTime = heure de l'événement (clôture de sa barre)
   bool              BreakBetween(const int dir, const int from, const int to, bool &isChoch, datetime &evTime) const
     {
      isChoch = false;
      evTime = 0;
      for(int i = ArraySize(events) - 1; i >= 0; i--)
        {
         if(events[i].index < from)
            break;
         if(events[i].index > to)
            continue;
         bool up = (events[i].type == GLS_EVT_BOS_UP || events[i].type == GLS_EVT_CHOCH_UP);
         if((dir > 0) == up)
           {
            isChoch = (events[i].type == GLS_EVT_CHOCH_UP || events[i].type == GLS_EVT_CHOCH_DOWN);
            evTime = events[i].time;
            return true;
           }
        }
      return false;
     }

   string            EventText(void) const
     {
      switch(lastEvent)
        {
         case GLS_EVT_BOS_UP:     return "BOS haussier";
         case GLS_EVT_BOS_DOWN:   return "BOS baissier";
         case GLS_EVT_CHOCH_UP:   return "CHOCH haussier";
         case GLS_EVT_CHOCH_DOWN: return "CHOCH baissier";
        }
      return "aucun";
     }

   //--- Événement de structure CONTRAIRE au sens dir, survenu après t ?
   bool              OppositeEventAfter(const int dir, const datetime t) const
     {
      if(lastEventTime <= t)
         return false;
      if(dir == GLS_BUY)
         return (lastEvent == GLS_EVT_BOS_DOWN || lastEvent == GLS_EVT_CHOCH_DOWN);
      return (lastEvent == GLS_EVT_BOS_UP || lastEvent == GLS_EVT_CHOCH_UP);
     }
  };

//+------------------------------------------------------------------+
//| Carte de liquidité multi-unités de temps                          |
//+------------------------------------------------------------------+
struct SLevel
  {
   double            price;
   int               kind;          // GLS_LVL_*
   datetime          confirmTime;   // connu à partir de cet instant
   datetime          brokenTime;    // cassé par une clôture (0 = intact)
  };

class CLiquidityMap
  {
public:
   SLevel            lows[];        // liquidité sous le prix (stops des acheteurs)
   SLevel            highs[];       // liquidité au-dessus du prix (stops des vendeurs)

   void              Clear(void)
     {
      ArrayResize(lows, 0);
      ArrayResize(highs, 0);
     }

   void              Add(const bool isHigh, const double price, const int kind, const datetime confirmTime, const datetime brokenTime)
     {
      if(price == 0.0)
         return;
      if(isHigh)
        {
         int n = ArraySize(highs);
         ArrayResize(highs, n + 1);
         highs[n].price = price;
         highs[n].kind = kind;
         highs[n].confirmTime = confirmTime;
         highs[n].brokenTime = brokenTime;
        }
      else
        {
         int n = ArraySize(lows);
         ArrayResize(lows, n + 1);
         lows[n].price = price;
         lows[n].kind = kind;
         lows[n].confirmTime = confirmTime;
         lows[n].brokenTime = brokenTime;
        }
     }

   void              AddSwings(const CStructure &st, const int kind, const int maxEach)
     {
      int nh = ArraySize(st.highs);
      for(int i = MathMax(0, nh - maxEach); i < nh; i++)
         Add(true, st.highs[i].price, kind, st.highs[i].confirmTime, st.highs[i].brokenTime);
      int nl = ArraySize(st.lows);
      for(int i = MathMax(0, nl - maxEach); i < nl; i++)
         Add(false, st.lows[i].price, kind, st.lows[i].confirmTime, st.lows[i].brokenTime);
     }

   //--- Vue directionnelle : pour un ACHAT, les niveaux balayables sont les bas
   //--- et les niveaux opposés (objectifs/obstacles) les hauts. Pour une VENTE,
   //--- tout est retourné dans l'espace "miroir" (prix négatifs).
   void              DirectionalView(const int dir, SLevel &sweepable[], SLevel &opposing[]) const
     {
      if(dir == GLS_BUY)
        {
         CopyLevels(lows, sweepable, 1.0);
         CopyLevels(highs, opposing, 1.0);
        }
      else
        {
         CopyLevels(highs, sweepable, -1.0);
         CopyLevels(lows, opposing, -1.0);
        }
     }

   static void       CopyLevels(const SLevel &src[], SLevel &dst[], const double sign)
     {
      int n = ArraySize(src);
      ArrayResize(dst, n);
      for(int i = 0; i < n; i++)
        {
         dst[i].price = src[i].price * sign;
         dst[i].kind = src[i].kind;
         dst[i].confirmTime = src[i].confirmTime;
         dst[i].brokenTime = src[i].brokenTime;
        }
     }
  };

string LevelKindText(const int kind)
  {
   switch(kind)
     {
      case GLS_LVL_M1_SWING:  return "swing M1";
      case GLS_LVL_M5_SWING:  return "swing M5";
      case GLS_LVL_M15_SWING: return "swing M15";
      case GLS_LVL_PREV_DAY:  return "veille";
      case GLS_LVL_ASIA:      return "Asie";
      case GLS_LVL_ZONE:      return "zone S/R";
      case GLS_LVL_FVG:       return "FVG";
     }
   return "?";
  }

#endif // GLS_STRUCTURE_MQH
//+------------------------------------------------------------------+
