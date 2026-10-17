//+------------------------------------------------------------------+
//| Fvg.mqh - déséquilibres de prix (Fair Value Gaps), IFVG, OB      |
//|                                                                  |
//| Indices : séries CHRONOLOGIQUES de barres CLÔTURÉES ; pour une   |
//| figure de trois bougies, i-2 = 1re, i-1 = 2e (déplacement),      |
//| i = 3e (la plus récente). Aucune donnée future n'est utilisée.   |
//|                                                                  |
//| FVG haussier : low[i] > high[i-2]   zone = [high[i-2] ; low[i]]  |
//| FVG baissier : high[i] < low[i-2]   zone = [high[i] ; low[i-2]]  |
//|                                                                  |
//| Comblement (haussier) : pénétration maximale depuis la création :|
//|   fill = (haut - plus bas atteint) / (haut - bas), borné [0 ; 1].|
//|   (baissier : symétrique depuis le bas de la zone)               |
//| Retest : chaque nouvelle entrée du prix dans la zone après en    |
//|   être sorti (la 1re entrée = 1er retour).                       |
//| Invalidation (haussier) : CLÔTURE sous bas - tampon x ATR.       |
//|   (baissier : clôture au-dessus du haut + tampon)                |
//| Statuts : fraîche, partiellement comblée, comblée, invalidée.    |
//| IFVG (désactivé par défaut) : une FVG invalidée devient une zone |
//|   de sens opposé, suivie avec les mêmes règles.                  |
//| Order Block (définition objective retenue) : dernière bougie de  |
//|   couleur opposée parmi les 3 bougies précédant le déplacement,  |
//|   uniquement si le déplacement a produit un BOS/CHOCH.           |
//+------------------------------------------------------------------+
#ifndef GLS_FVG_MQH
#define GLS_FVG_MQH

#include "Zones.mqh"

#define GLS_FVG_FRESH       0
#define GLS_FVG_PARTIAL     1
#define GLS_FVG_FILLED      2
#define GLS_FVG_INVALIDATED 3

string FvgStatusText(const int st)
  {
   switch(st)
     {
      case GLS_FVG_FRESH:       return "fraîche";
      case GLS_FVG_PARTIAL:     return "partiellement comblée";
      case GLS_FVG_FILLED:      return "comblée";
      case GLS_FVG_INVALIDATED: return "invalidée";
     }
   return "?";
  }

struct SFvg
  {
   int               dir;          // +1 haussier, -1 baissier
   double            lo;
   double            hi;
   int               tfMin;        // unité de temps d'origine (minutes)
   datetime          created;      // clôture de la 3e bougie (instant où la zone est connue)
   int               i3;           // index de la 3e bougie dans la série de l'unité de temps
   double            sizePts;
   double            sizeAtr;
   double            dispAtr;      // amplitude de la bougie de déplacement / ATR
   double            dispBody;     // corps / amplitude de la bougie de déplacement
   bool              bos;
   bool              choch;
   bool              sweep;
   bool              hasOB;
   double            obLo;
   double            obHi;
   double            ctxDistAtr;   // distance à la zone S/R favorable ou à l'OB la plus proche (ATR), -1 si aucune
   int               retests;
   double            fillPct;
   int               status;
   datetime          statusTime;
   bool              inverted;     // IFVG (zone dérivée d'une FVG invalidée)
   double            quality;      // 0..1, critères INTRINSÈQUES uniquement
   string            reason;
  };

//--- Suivi d'une zone (haussière dir>0 : le prix revient par le haut) à partir de la barre start+1
void TrackFvg(const CBarSeries &s, const double &atr[], SFvg &f, const int start)
  {
   f.retests = 0;
   f.fillPct = 0.0;
   f.status = GLS_FVG_FRESH;
   f.statusTime = f.created;
   double width = f.hi - f.lo;
   if(width <= 0.0)
      return;
   bool inside = false;
   double deepest = (f.dir > 0) ? f.hi : f.lo;
   for(int k = start + 1; k < s.count; k++)
     {
      double buf = InpFvgInvalidBufferATR * ((atr[k] > 0.0) ? atr[k] : 0.0);
      bool touch = (f.dir > 0) ? (s.low[k] <= f.hi) : (s.high[k] >= f.lo);
      if(touch && !inside)
         f.retests++;
      inside = touch;
      if(f.dir > 0)
        {
         deepest = MathMin(deepest, s.low[k]);
         f.fillPct = Clamp((f.hi - deepest) / width, 0.0, 1.0);
         if(s.close[k] < f.lo - buf)
           {
            f.status = GLS_FVG_INVALIDATED;
            f.statusTime = s.CloseTime(k);
            return;
           }
        }
      else
        {
         deepest = MathMax(deepest, s.high[k]);
         f.fillPct = Clamp((deepest - f.lo) / width, 0.0, 1.0);
         if(s.close[k] > f.hi + buf)
           {
            f.status = GLS_FVG_INVALIDATED;
            f.statusTime = s.CloseTime(k);
            return;
           }
        }
      int st = (f.fillPct >= 1.0) ? GLS_FVG_FILLED : ((f.fillPct > 0.0) ? GLS_FVG_PARTIAL : GLS_FVG_FRESH);
      if(st != f.status)
        {
         f.status = st;
         f.statusTime = s.CloseTime(k);
        }
     }
  }

//--- Score de qualité intrinsèque (tendance, coûts et espace sont évalués au niveau du signal)
void ScoreFvg(SFvg &f)
  {
   double qDisp = Ramp(f.dispAtr, InpFvgMinDispATR, 2.5) * (0.5 + 0.5 * Ramp(f.dispBody, 0.5, 0.85));
   double qSize = Ramp(f.sizeAtr, InpFvgMinSizeATR, 0.4);
   double qStruct = (f.bos || f.choch) ? 1.0 : 0.3;
   double qSweep = f.sweep ? 1.0 : 0.4;
   double qFresh = 0.1;
   if(f.status == GLS_FVG_FILLED || f.status == GLS_FVG_INVALIDATED)
      qFresh = 0.0;
   else
      if(f.retests == 0)
         qFresh = 1.0;
      else
         if(f.retests == 1)
            qFresh = 0.7;
         else
            if(f.retests == 2)
               qFresh = 0.4;
   double qCtx = (f.ctxDistAtr >= 0.0 && f.ctxDistAtr <= 1.0) ? 1.0 : 0.5;
   double w = InpFvgWDisp + InpFvgWSize + InpFvgWStructure + InpFvgWSweep + InpFvgWFresh + InpFvgWContext;
   f.quality = SafeDiv(InpFvgWDisp * qDisp + InpFvgWSize * qSize + InpFvgWStructure * qStruct + InpFvgWSweep * qSweep
                       + InpFvgWFresh * qFresh + InpFvgWContext * qCtx, w, 0.0);
   f.reason = StringFormat("dépl. %.1f ATR (corps %.0f %%), taille %.2f ATR, %s, %s, %d retour(s), comblement %.0f %%, %s%s",
                           f.dispAtr, 100.0 * f.dispBody, f.sizeAtr, f.choch ? "CHOCH" : (f.bos ? "BOS" : "sans cassure de structure"),
                           f.sweep ? "après balayage" : "sans balayage", f.retests, 100.0 * f.fillPct, FvgStatusText(f.status),
                           f.hasOB ? ", OB adjacent" : "");
  }

class CFvgMap
  {
public:
   SFvg              fvgs[];
   int               tfMin;

                     CFvgMap(void) : tfMin(5) {}

   //--- Balayage de liquidité précédant le déplacement : un creux (haussier) confirmé
   //--- avant la barre i-3 a été percé puis repris entre i-5 et i-1
   static bool       SweepBefore(const CBarSeries &s, const CStructure &st, const int dir, const int i)
     {
      int from = MathMax(0, i - 5);
      if(dir > 0)
        {
         for(int n = ArraySize(st.lows) - 1; n >= 0; n--)
           {
            if(st.lows[n].confirmTime > s.time[from])
               continue;
            double lvl = st.lows[n].price;
            for(int k = from; k <= i - 1; k++)
               if(s.low[k] < lvl && s.close[k] > lvl)
                  return true;
            return false;
           }
        }
      else
        {
         for(int n = ArraySize(st.highs) - 1; n >= 0; n--)
           {
            if(st.highs[n].confirmTime > s.time[from])
               continue;
            double lvl = st.highs[n].price;
            for(int k = from; k <= i - 1; k++)
               if(s.high[k] > lvl && s.close[k] < lvl)
                  return true;
            return false;
           }
        }
      return false;
     }

   void              Build(const CBarSeries &s, const double &atr[], const CStructure &st, const CZoneMap &zm,
                           const int tf, const int lookback, const double point)
     {
      ArrayResize(fvgs, 0);
      tfMin = tf;
      int last = s.count - 1;
      for(int i = MathMax(5, last - lookback + 1); i <= last; i++)
        {
         double a = atr[i - 1];
         if(a <= 0.0)
            continue;
         for(int d = -1; d <= 1; d += 2)
           {
            double lo = 0.0;
            double hi = 0.0;
            if(d > 0)
              {
               if(s.low[i] <= s.high[i - 2])
                  continue;
               lo = s.high[i - 2];
               hi = s.low[i];
              }
            else
              {
               if(s.high[i] >= s.low[i - 2])
                  continue;
               lo = s.high[i];
               hi = s.low[i - 2];
              }
            double rng = s.high[i - 1] - s.low[i - 1];
            if(rng <= 0.0 || (double)d * (s.close[i - 1] - s.open[i - 1]) <= 0.0)
               continue;   // le déplacement doit aller dans le sens du déséquilibre
            SFvg f;
            f.dir = d;
            f.lo = lo;
            f.hi = hi;
            f.tfMin = tf;
            f.created = s.CloseTime(i);
            f.i3 = i;
            f.sizePts = (point > 0.0) ? (hi - lo) / point : 0.0;
            f.sizeAtr = (hi - lo) / a;
            if(f.sizeAtr < 0.5 * InpFvgMinSizeATR)
               continue;   // écart négligeable : bruit
            f.dispAtr = rng / a;
            f.dispBody = MathAbs(s.close[i - 1] - s.open[i - 1]) / rng;
            bool isChoch = false;
            f.bos = st.BreakBetween(d, i - 1, MathMin(i + 2, last), isChoch);
            f.choch = f.bos && isChoch;
            f.sweep = SweepBefore(s, st, d, i);
            //--- Order Block objectif
            f.hasOB = false;
            f.obLo = 0.0;
            f.obHi = 0.0;
            if(f.bos)
               for(int k = i - 2; k >= MathMax(0, i - 4); k--)
                  if((double)d * (s.close[k] - s.open[k]) < 0.0)
                    {
                     f.hasOB = true;
                     f.obLo = s.low[k];
                     f.obHi = s.high[k];
                     break;
                    }
            //--- contexte : zone S/R de rôle favorable ou OB à proximité
            f.ctxDistAtr = -1.0;
            int favRole = (d > 0) ? GLS_ZONE_SUPPORT : GLS_ZONE_RESIST;
            for(int z = 0; z < ArraySize(zm.zones); z++)
              {
               if(!zm.zones[z].valid || zm.zones[z].role != favRole || zm.zones[z].confirmTime > f.created)
                  continue;
               double dist = (lo > zm.zones[z].hi) ? lo - zm.zones[z].hi : ((zm.zones[z].lo > hi) ? zm.zones[z].lo - hi : 0.0);
               double da = dist / a;
               if(f.ctxDistAtr < 0.0 || da < f.ctxDistAtr)
                  f.ctxDistAtr = da;
              }
            if(f.hasOB)
              {
               double dob = (lo > f.obHi) ? (lo - f.obHi) / a : ((f.obLo > hi) ? (f.obLo - hi) / a : 0.0);
               if(f.ctxDistAtr < 0.0 || dob < f.ctxDistAtr)
                  f.ctxDistAtr = dob;
              }
            f.inverted = false;
            TrackFvg(s, atr, f, i);
            ScoreFvg(f);
            Append(f);
            //--- IFVG : règle distincte, désactivable
            if(InpUseIFVG && f.status == GLS_FVG_INVALIDATED)
              {
               int k0 = s.LastClosedAt(f.statusTime);
               if(k0 >= 0)
                 {
                  SFvg g = f;
                  g.dir = -f.dir;
                  g.inverted = true;
                  g.created = f.statusTime;
                  g.i3 = k0;
                  g.sweep = false;
                  g.hasOB = false;
                  TrackFvg(s, atr, g, k0);
                  ScoreFvg(g);
                  g.reason = "IFVG : " + g.reason;
                  Append(g);
                 }
              }
           }
        }
     }

   void              Append(const SFvg &f)
     {
      int n = ArraySize(fvgs);
      ArrayResize(fvgs, n + 1);
      fvgs[n] = f;
     }

   int               CountActive(const int dir) const
     {
      int c = 0;
      for(int i = 0; i < ArraySize(fvgs); i++)
         if(fvgs[i].dir == dir && (fvgs[i].status == GLS_FVG_FRESH || fvgs[i].status == GLS_FVG_PARTIAL))
            c++;
      return c;
     }
  };

string FvgKey(const SFvg &f)
  {
   return IntegerToString(f.tfMin) + "|" + IntegerToString(f.dir) + "|" + IntegerToString((long)f.created) + (f.inverted ? "|I" : "");
  }

#endif // GLS_FVG_MQH
//+------------------------------------------------------------------+
