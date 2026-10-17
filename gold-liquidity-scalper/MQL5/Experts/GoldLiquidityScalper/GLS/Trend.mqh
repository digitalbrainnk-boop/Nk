//+------------------------------------------------------------------+
//| Trend.mqh - tendance par unité de temps et régime de marché      |
//|                                                                  |
//| Tendance (M15 et M5) = vote de 4 éléments mesurables :           |
//|   structure BOS/CHOCH, séquence des sommets/creux (HH/HL ou      |
//|   LH/LL), côté de l'EMA 200, pente de l'EMA 200.                 |
//| HAUSSIÈRE seulement si la STRUCTURE est haussière, qu'aucun      |
//| élément n'est contraire et qu'au moins 2 votes sont positifs :   |
//| l'EMA 200 seule ne suffit JAMAIS à définir une tendance.         |
//| Régime (M15 + volatilité M5) : tendance, range, transition,      |
//| volatilité excessive, conditions désordonnées.                   |
//+------------------------------------------------------------------+
#ifndef GLS_TREND_MQH
#define GLS_TREND_MQH

#include "Structure.mqh"

#define GLS_TCLASS_UNKNOWN    0
#define GLS_TCLASS_BULL       1
#define GLS_TCLASS_BEAR       2
#define GLS_TCLASS_RANGE      3
#define GLS_TCLASS_TRANSITION 4

#define GLS_RG_UNKNOWN    0
#define GLS_RG_TREND      1
#define GLS_RG_RANGE      2
#define GLS_RG_TRANSITION 3
#define GLS_RG_VOLATILE   4
#define GLS_RG_DISORDER   5

string TrendClassText(const int cls)
  {
   switch(cls)
     {
      case GLS_TCLASS_BULL:       return "haussière";
      case GLS_TCLASS_BEAR:       return "baissière";
      case GLS_TCLASS_RANGE:      return "latérale";
      case GLS_TCLASS_TRANSITION: return "transition";
     }
   return "inconnue";
  }

string RegimeCode(const int rg)
  {
   switch(rg)
     {
      case GLS_RG_TREND:      return "TENDANCE";
      case GLS_RG_RANGE:      return "RANGE";
      case GLS_RG_TRANSITION: return "TRANSITION";
      case GLS_RG_VOLATILE:   return "VOLATIL";
      case GLS_RG_DISORDER:   return "DESORDRE";
     }
   return "INCONNU";
  }

class CTrendModel
  {
public:
   int               cls;
   int               dir;          // +1 / -1 si tendance, sinon 0
   int               structVote;
   int               swingVote;
   int               emaVote;
   int               slopeVote;
   double            er;
   double            ema;
   bool              ready;
   string            reason;

                     CTrendModel(void) { Reset(); }

   void              Reset(void)
     {
      cls = GLS_TCLASS_UNKNOWN;
      dir = 0;
      structVote = 0;
      swingVote = 0;
      emaVote = 0;
      slopeVote = 0;
      er = 0.0;
      ema = 0.0;
      ready = false;
      reason = "";
     }

   static string     VoteText(const int v)
     {
      return (v > 0) ? "+" : ((v < 0) ? "-" : "0");
     }

   void              Evaluate(const CBarSeries &s, const CStructure &st, const double &emaArr[], const double atrNow,
                              const int slopeBars, const double erTrendMin, const int transitionBars)
     {
      Reset();
      int last = s.count - 1;
      if(!st.ready || last < slopeBars + 1 || ArraySize(emaArr) != s.count)
        {
         reason = "historique insuffisant";
         return;
        }
      ema = emaArr[last];
      double emaPrev = emaArr[last - slopeBars];
      structVote = st.trend;
      swingVote = st.swingBias;
      if(ema > 0.0 && emaPrev > 0.0)
        {
         emaVote = (s.close[last] > ema) ? 1 : ((s.close[last] < ema) ? -1 : 0);
         double slope = ema - emaPrev;
         double thr = 0.1 * atrNow;
         slopeVote = (slope > thr) ? 1 : ((slope < -thr) ? -1 : 0);
        }
      er = st.er;
      int votes = structVote + swingVote + emaVote + slopeVote;
      bool recentChoch = ((st.lastEvent == GLS_EVT_CHOCH_UP || st.lastEvent == GLS_EVT_CHOCH_DOWN) && last - st.lastEventIndex <= transitionBars);
      if(structVote > 0 && swingVote >= 0 && emaVote >= 0 && slopeVote >= 0 && votes >= 2 && !recentChoch)
        {
         cls = GLS_TCLASS_BULL;
         dir = 1;
        }
      else
         if(structVote < 0 && swingVote <= 0 && emaVote <= 0 && slopeVote <= 0 && votes <= -2 && !recentChoch)
           {
            cls = GLS_TCLASS_BEAR;
            dir = -1;
           }
         else
            if(recentChoch || er >= erTrendMin)
               cls = GLS_TCLASS_TRANSITION;
            else
               cls = GLS_TCLASS_RANGE;
      reason = "structure " + VoteText(structVote) + ", sommets/creux " + VoteText(swingVote) + ", EMA " + VoteText(emaVote)
               + ", pente " + VoteText(slopeVote) + StringFormat(", ER %.2f", er) + (recentChoch ? ", CHOCH récent" : "");
      ready = true;
     }
  };

//--- Fréquence d'alternance de couleur sur les n dernières bougies (0..1)
double AlternationRatio(const CBarSeries &s, const int n)
  {
   int last = s.count - 1;
   if(last - n < 1)
      return 0.0;
   int flips = 0;
   int pairs = 0;
   for(int i = last - n + 1; i <= last; i++)
     {
      double d1 = s.close[i - 1] - s.open[i - 1];
      double d2 = s.close[i] - s.open[i];
      if(d1 == 0.0 || d2 == 0.0)
         continue;
      pairs++;
      if(d1 * d2 < 0.0)
         flips++;
     }
   return (pairs > 0) ? (double)flips / pairs : 0.0;
  }

//--- Régime de marché à partir de la tendance M15 et de la volatilité M5
int ClassifyRegime(const CTrendModel &t15, const CBarSeries &m5, const double atr5, const double atr5Long, string &why)
  {
   if(!t15.ready || atr5 <= 0.0 || atr5Long <= 0.0)
     {
      why = "données insuffisantes";
      return GLS_RG_UNKNOWN;
     }
   double volRatio = atr5 / atr5Long;
   double alt = AlternationRatio(m5, 12);
   if(volRatio >= InpRegimeVolatileRatio)
     {
      why = StringFormat("ATR M5 %.2f x la normale", volRatio);
      return GLS_RG_VOLATILE;
     }
   if(alt >= InpRegimeChopAlternation && t15.er < 0.15)
     {
      why = StringFormat("alternance %.0f %%, ER M15 %.2f", 100.0 * alt, t15.er);
      return GLS_RG_DISORDER;
     }
   why = "M15 " + TrendClassText(t15.cls) + StringFormat(", vol. x%.2f", volRatio);
   if(t15.cls == GLS_TCLASS_BULL || t15.cls == GLS_TCLASS_BEAR)
      return GLS_RG_TREND;
   if(t15.cls == GLS_TCLASS_TRANSITION)
      return GLS_RG_TRANSITION;
   return GLS_RG_RANGE;
  }

//--- Régimes autorisés par famille (masques binaires)
int g_regimeMask[8];

int ParseRegimeMask(const string list)
  {
   string up = list;
   StringToUpper(up);
   string parts[];
   int n = StringSplit(up, ',', parts);
   int mask = 0;
   for(int k = 0; k < n; k++)
     {
      string p = parts[k];
      StringTrimLeft(p);
      StringTrimRight(p);
      for(int rg = GLS_RG_TREND; rg <= GLS_RG_DISORDER; rg++)
         if(p == RegimeCode(rg))
            mask |= (1 << rg);
     }
   return mask;
  }

bool RegimeAllowed(const int family, const int regime)
  {
   if(family < 1 || family > 7 || regime == GLS_RG_UNKNOWN)
      return false;
   return ((g_regimeMask[family] & (1 << regime)) != 0);
  }

#endif // GLS_TREND_MQH
//+------------------------------------------------------------------+
