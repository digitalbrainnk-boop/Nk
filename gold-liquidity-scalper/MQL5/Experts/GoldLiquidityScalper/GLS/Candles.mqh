//+------------------------------------------------------------------+
//| Candles.mqh - analyse quantitative des bougies japonaises        |
//|                                                                  |
//| Principes :                                                      |
//|  - uniquement des bougies CLÔTURÉES ; une figure à l'index j     |
//|    n'utilise que les bougies <= j ; son statut (confirmée,       |
//|    invalidée, expirée) n'utilise que les bougies déjà clôturées  |
//|    après j ;                                                     |
//|  - toutes les figures sont codées dans le sens HAUSSIER ; la     |
//|    version baissière est la même règle appliquée à la série      |
//|    miroir (marteau <-> étoile filante, marteau inversé <-> pendu,|
//|    ligne pénétrante <-> nuage noir, étoile du matin <-> du soir) ;|
//|  - une figure n'est JAMAIS un signal à elle seule : c'est un     |
//|    élément de preuve, interprété avec son contexte.              |
//+------------------------------------------------------------------+
#ifndef GLS_CANDLES_MQH
#define GLS_CANDLES_MQH

#include "MarketData.mqh"

//--- Figures
#define GLS_CDL_NONE         0
#define GLS_CDL_HAMMER       1   // marteau / étoile filante
#define GLS_CDL_INVHAMMER    2   // marteau inversé / pendu
#define GLS_CDL_ENGULF       3   // avalement
#define GLS_CDL_PIERCING     4   // ligne pénétrante / couverture en nuage noir
#define GLS_CDL_STAR         5   // étoile du matin / du soir
#define GLS_CDL_REJCONF      6   // rejet puis confirmation opposée
#define GLS_CDL_DOJI         7   // doji
#define GLS_CDL_SPIN         8   // toupie (petit corps, deux mèches)
#define GLS_CDL_HESIT        9   // alternance d'hésitation
#define GLS_CDL_IMPULSE      10  // bougie d'impulsion
#define GLS_CDL_CONTINUATION 11  // consolidation puis reprise
#define GLS_CDL_PINBAR       12  // pin bar
#define GLS_CDL_FAILBREAK    13  // échec de cassure (cassure suivie d'un retour)
#define GLS_CDL_ABSORB       14  // absorption APPARENTE (volume de ticks)
#define GLS_CDL_SEQUENCE     15  // impulsion - ralentissement - rejet - reprise
#define GLS_CDL_COUNT        16

//--- Catégories
#define GLS_CDLCAT_REVERSAL     1
#define GLS_CDLCAT_INDECISION   2
#define GLS_CDLCAT_CONTINUATION 3
#define GLS_CDLCAT_REJECTION    4
#define GLS_CDLCAT_COMPOSITE    5

//--- Statuts
#define GLS_CDLST_DETECTED    0   // formée, en attente de confirmation
#define GLS_CDLST_CONFIRMED   1   // clôture au-delà de l'extrême de la figure dans son sens
#define GLS_CDLST_INVALIDATED 2   // clôture au-delà de l'extrême opposé avant confirmation
#define GLS_CDLST_EXPIRED     3   // pas de confirmation dans le délai
#define GLS_CDLST_INFO        4   // figure neutre (indécision) : pas de confirmation possible

bool g_cdlEnabled[GLS_CDL_COUNT];

string CandleCode(const int id)
  {
   switch(id)
     {
      case GLS_CDL_HAMMER:       return "HAM";
      case GLS_CDL_INVHAMMER:    return "IHAM";
      case GLS_CDL_ENGULF:       return "ENG";
      case GLS_CDL_PIERCING:     return "PIER";
      case GLS_CDL_STAR:         return "STAR";
      case GLS_CDL_REJCONF:      return "RCONF";
      case GLS_CDL_DOJI:         return "DOJI";
      case GLS_CDL_SPIN:         return "SPIN";
      case GLS_CDL_HESIT:        return "HESIT";
      case GLS_CDL_IMPULSE:      return "IMP";
      case GLS_CDL_CONTINUATION: return "CONT";
      case GLS_CDL_PINBAR:       return "PIN";
      case GLS_CDL_FAILBREAK:    return "FBRK";
      case GLS_CDL_ABSORB:       return "ABS";
      case GLS_CDL_SEQUENCE:     return "SEQ";
     }
   return "?";
  }

string CandleName(const int id, const int dir)
  {
   bool bull = (dir > 0);
   switch(id)
     {
      case GLS_CDL_HAMMER:       return bull ? "marteau" : "étoile filante";
      case GLS_CDL_INVHAMMER:    return bull ? "marteau inversé" : "pendu";
      case GLS_CDL_ENGULF:       return bull ? "avalement haussier" : "avalement baissier";
      case GLS_CDL_PIERCING:     return bull ? "ligne pénétrante" : "couverture en nuage noir";
      case GLS_CDL_STAR:         return bull ? "étoile du matin" : "étoile du soir";
      case GLS_CDL_REJCONF:      return bull ? "rejet baissier + confirmation haussière" : "rejet haussier + confirmation baissière";
      case GLS_CDL_DOJI:         return "doji";
      case GLS_CDL_SPIN:         return "toupie (petit corps)";
      case GLS_CDL_HESIT:        return "alternance d'hésitation";
      case GLS_CDL_IMPULSE:      return bull ? "impulsion haussière" : "impulsion baissière";
      case GLS_CDL_CONTINUATION: return bull ? "consolidation puis reprise haussière" : "consolidation puis reprise baissière";
      case GLS_CDL_PINBAR:       return bull ? "pin bar haussière" : "pin bar baissière";
      case GLS_CDL_FAILBREAK:    return bull ? "échec de cassure du bas" : "échec de cassure du haut";
      case GLS_CDL_ABSORB:       return bull ? "absorption apparente acheteuse" : "absorption apparente vendeuse";
      case GLS_CDL_SEQUENCE:     return bull ? "impulsion-ralentissement-rejet-reprise haussière" : "impulsion-ralentissement-rejet-reprise baissière";
     }
   return "inconnue";
  }

int CandleCategory(const int id)
  {
   switch(id)
     {
      case GLS_CDL_HAMMER:
      case GLS_CDL_INVHAMMER:
      case GLS_CDL_ENGULF:
      case GLS_CDL_PIERCING:
      case GLS_CDL_STAR:
      case GLS_CDL_REJCONF:
         return GLS_CDLCAT_REVERSAL;
      case GLS_CDL_DOJI:
      case GLS_CDL_SPIN:
      case GLS_CDL_HESIT:
         return GLS_CDLCAT_INDECISION;
      case GLS_CDL_IMPULSE:
      case GLS_CDL_CONTINUATION:
         return GLS_CDLCAT_CONTINUATION;
      case GLS_CDL_PINBAR:
      case GLS_CDL_FAILBREAK:
      case GLS_CDL_ABSORB:
         return GLS_CDLCAT_REJECTION;
      case GLS_CDL_SEQUENCE:
         return GLS_CDLCAT_COMPOSITE;
     }
   return 0;
  }

string CandleStatusText(const int st)
  {
   switch(st)
     {
      case GLS_CDLST_DETECTED:    return "détectée";
      case GLS_CDLST_CONFIRMED:   return "confirmée";
      case GLS_CDLST_INVALIDATED: return "invalidée";
      case GLS_CDLST_EXPIRED:     return "expirée";
      case GLS_CDLST_INFO:        return "information";
     }
   return "?";
  }

//--- Figures confirmées dès leur formation (leur dernière bougie EST la confirmation)
bool CandleSelfConfirmed(const int id)
  {
   return (id == GLS_CDL_REJCONF || id == GLS_CDL_CONTINUATION || id == GLS_CDL_SEQUENCE);
  }

//--- Configuration : liste de codes désactivés, ex. "ABS,IHAM"
void CandleConfigInit(const string disabledCodes)
  {
   string up = disabledCodes;
   StringToUpper(up);
   string parts[];
   int n = StringSplit(up, ',', parts);
   for(int id = 0; id < GLS_CDL_COUNT; id++)
     {
      g_cdlEnabled[id] = (id != GLS_CDL_NONE);
      for(int k = 0; k < n; k++)
        {
         string p = parts[k];
         StringTrimLeft(p);
         StringTrimRight(p);
         if(p == CandleCode(id))
            g_cdlEnabled[id] = false;
        }
     }
  }

//+------------------------------------------------------------------+
//| Mesures quantitatives d'une bougie                                |
//+------------------------------------------------------------------+
struct SCandle
  {
   bool              valid;          // amplitude > 0, prix cohérents, ATR disponible
   double            body;           // |close - open|
   double            upper;          // mèche supérieure
   double            lower;          // mèche inférieure
   double            range;          // high - low
   double            bodyRatio;      // corps / amplitude
   double            upperRatio;     // mèche sup. / amplitude
   double            lowerRatio;     // mèche inf. / amplitude
   double            upperToBody;    // mèche sup. / corps (corps plancher 2 % de l'amplitude)
   double            lowerToBody;
   double            closeLoc;       // 0 = clôture au plus bas, 1 = au plus haut
   int               dir;            // +1 haussière, -1 baissière, 0 neutre (corps <= seuil doji)
   double            rangeAtr;       // amplitude / ATR
   double            relSize;        // amplitude / moyenne des amplitudes précédentes
   bool              breaksPrevHigh;
   bool              breaksPrevLow;
   bool              closeAbovePrevHigh;
   bool              closeBelowPrevLow;
  };

void CandleMetrics(const CBarSeries &b, const double &atr[], const int i, SCandle &c)
  {
   c.valid = false;
   c.body = 0.0;
   c.upper = 0.0;
   c.lower = 0.0;
   c.range = 0.0;
   c.bodyRatio = 0.0;
   c.upperRatio = 0.0;
   c.lowerRatio = 0.0;
   c.upperToBody = 0.0;
   c.lowerToBody = 0.0;
   c.closeLoc = 0.5;
   c.dir = 0;
   c.rangeAtr = 0.0;
   c.relSize = 0.0;
   c.breaksPrevHigh = false;
   c.breaksPrevLow = false;
   c.closeAbovePrevHigh = false;
   c.closeBelowPrevLow = false;
   if(i < 0 || i >= b.count || i >= ArraySize(atr))
      return;
   double o = b.open[i];
   double h = b.high[i];
   double l = b.low[i];
   double cl = b.close[i];
   if(!MathIsValidNumber(o) || !MathIsValidNumber(h) || !MathIsValidNumber(l) || !MathIsValidNumber(cl))
      return;
   c.range = h - l;
   c.body = MathAbs(cl - o);
   c.upper = h - MathMax(o, cl);
   c.lower = MathMin(o, cl) - l;
   //--- amplitude nulle ou incohérente : aucune mesure relative possible
   if(c.range <= 0.0 || c.upper < -GLS_EPS || c.lower < -GLS_EPS || atr[i] <= 0.0)
      return;
   c.bodyRatio = c.body / c.range;
   c.upperRatio = MathMax(c.upper, 0.0) / c.range;
   c.lowerRatio = MathMax(c.lower, 0.0) / c.range;
   double bodyFloor = MathMax(c.body, 0.02 * c.range);
   c.upperToBody = MathMax(c.upper, 0.0) / bodyFloor;
   c.lowerToBody = MathMax(c.lower, 0.0) / bodyFloor;
   c.closeLoc = (cl - l) / c.range;
   if(c.bodyRatio <= InpCdlDojiBodyRatio)
      c.dir = 0;
   else
      c.dir = (cl > o) ? 1 : -1;
   c.rangeAtr = c.range / atr[i];
   double sum = 0.0;
   int n = 0;
   for(int k = i - 1; k >= 0 && k >= i - 10; k--)
     {
      sum += b.high[k] - b.low[k];
      n++;
     }
   c.relSize = (n > 0) ? SafeDiv(c.range, sum / n, 0.0) : 0.0;
   if(i >= 1)
     {
      c.breaksPrevHigh = (h > b.high[i - 1]);
      c.breaksPrevLow = (l < b.low[i - 1]);
      c.closeAbovePrevHigh = (cl > b.high[i - 1]);
      c.closeBelowPrevLow = (cl < b.low[i - 1]);
     }
   c.valid = true;
  }

//+------------------------------------------------------------------+
//| Figure détectée                                                   |
//+------------------------------------------------------------------+
struct SCandlePattern
  {
   int               id;
   int               dir;           // +1 / -1 / 0 (sens RÉEL)
   int               category;
   int               bar;           // index (série M1) de la dernière bougie de la figure
   int               firstBar;      // index de la première bougie de la figure
   datetime          time;          // ouverture de la dernière bougie
   double            strength;      // 0..1 qualité de forme
   bool              contextOk;     // mouvement préalable cohérent (retournements) / tendance courte (continuations)
   int               status;        // GLS_CDLST_*
   int               confirmBar;    // index de la bougie de confirmation (-1)
   double            low;           // extrêmes de la figure (espace de la vue d'analyse)
   double            high;
   bool              nearZone;      // à proximité d'une zone favorable (support / liquidité / FVG)
   bool              obstacle;      // zone opposée immédiatement devant
   bool              noisy;         // spread trop grand devant l'amplitude : mesure peu fiable
   int               trendAlign;    // +1 aligné M15/M5, 0 neutre, -1 opposé
   bool              interpretable; // forme ET contexte cohérents
   string            detail;
  };

void CandlePatternReset(SCandlePattern &p)
  {
   p.id = GLS_CDL_NONE;
   p.dir = 0;
   p.category = 0;
   p.bar = -1;
   p.firstBar = -1;
   p.time = 0;
   p.strength = 0.0;
   p.contextOk = false;
   p.status = GLS_CDLST_DETECTED;
   p.confirmBar = -1;
   p.low = 0.0;
   p.high = 0.0;
   p.nearZone = false;
   p.obstacle = false;
   p.noisy = false;
   p.trendAlign = 0;
   p.interpretable = false;
   p.detail = "";
  }

//--- Mouvement préalable baissier avant la bougie first (espace de la vue)
//--- = plus haut des clôtures des 6 bougies précédentes - plus bas de la figure >= x ATR,
//---   et clôture précédente sous la clôture 6 bougies avant (baisse nette)
bool PriorDecline(const CBarSeries &b, const double &atr[], const int first, const double patLow)
  {
   int from = first - 6;
   if(from < 0 || first - 1 < 0 || atr[first] <= 0.0)
      return false;
   double maxClose = b.close[from];
   for(int k = from; k <= first - 1; k++)
      maxClose = MathMax(maxClose, b.close[k]);
   return (maxClose - patLow >= InpCdlPriorMoveATR * atr[first] && b.close[first - 1] < b.close[from]);
  }

//--- Mouvement préalable haussier (contexte des continuations haussières)
bool PriorRise(const CBarSeries &b, const double &atr[], const int first)
  {
   int from = first - 6;
   if(from < 0 || atr[first] <= 0.0)
      return false;
   return (b.close[first - 1] - b.close[from] >= 0.5 * InpCdlPriorMoveATR * atr[first]);
  }

double LowOf(const CBarSeries &b, const int from, const int to)
  {
   int k = b.ArgMinLow(from, to);
   return (k >= 0) ? b.low[k] : 0.0;
  }

double HighOf(const CBarSeries &b, const int from, const int to)
  {
   int k = b.ArgMaxHigh(from, to);
   return (k >= 0) ? b.high[k] : 0.0;
  }

//+------------------------------------------------------------------+
//| Détection d'une figure (sens haussier dans l'espace de la vue)    |
//| Renvoie true si la figure id est formée à la bougie j.            |
//+------------------------------------------------------------------+
bool DetectCandleAt(const int id, const CBarSeries &b, const double &atr[], const int j, SCandlePattern &p)
  {
   CandlePatternReset(p);
   SCandle c;
   CandleMetrics(b, atr, j, c);
   if(!c.valid)
      return false;
   double a = atr[j];
   double tol = 0.02 * a;
   p.id = id;
   p.category = CandleCategory(id);
   p.bar = j;
   p.firstBar = j;
   p.time = b.time[j];
   p.dir = 1;
   bool meaningful = (c.rangeAtr >= InpCdlMinRangeATR);
   switch(id)
     {
      case GLS_CDL_HAMMER:
        {
         if(!meaningful || c.lowerRatio < InpCdlWickRatio || c.lowerToBody < InpCdlWickToBody || c.upperRatio > InpCdlOppWickMaxRatio)
            return false;
         p.strength = 0.4 + 0.3 * Ramp(c.lowerRatio, InpCdlWickRatio, 0.9) + 0.3 * Ramp(c.rangeAtr, InpCdlMinRangeATR, 1.5);
         p.contextOk = PriorDecline(b, atr, j, b.low[j]);
         break;
        }
      case GLS_CDL_INVHAMMER:
        {
         if(!meaningful || c.upperRatio < InpCdlWickRatio || c.upperToBody < InpCdlWickToBody || c.lowerRatio > InpCdlOppWickMaxRatio)
            return false;
         //--- figure faible par nature : confirmation indispensable
         p.strength = 0.3 + 0.2 * Ramp(c.upperRatio, InpCdlWickRatio, 0.9) + 0.2 * Ramp(c.rangeAtr, InpCdlMinRangeATR, 1.5);
         p.contextOk = PriorDecline(b, atr, j, b.low[j]);
         break;
        }
      case GLS_CDL_ENGULF:
        {
         if(j < 1)
            return false;
         SCandle pc;
         CandleMetrics(b, atr, j - 1, pc);
         if(!pc.valid || pc.dir >= 0 || c.dir <= 0)
            return false;
         if(pc.body < 0.15 * a || c.body < MathMax(InpCdlEngulfMinBodyATR * a, pc.body))
            return false;
         //--- le corps englobe strictement le corps précédent (évite les faux avalements)
         if(b.open[j] > b.close[j - 1] + tol || b.close[j] <= b.open[j - 1] + tol || c.closeLoc < 0.6)
            return false;
         p.firstBar = j - 1;
         p.strength = 0.5 + 0.3 * Ramp(c.body / pc.body, 1.0, 2.5) + ((b.close[j] > b.high[j - 1]) ? 0.2 : 0.0);
         p.contextOk = PriorDecline(b, atr, j - 1, LowOf(b, j - 1, j));
         break;
        }
      case GLS_CDL_PIERCING:
        {
         if(j < 1)
            return false;
         SCandle pc;
         CandleMetrics(b, atr, j - 1, pc);
         if(!pc.valid || pc.dir >= 0 || pc.bodyRatio < 0.5 || pc.body < 0.4 * a || c.dir <= 0)
            return false;
         double mid = b.close[j - 1] + 0.5 * pc.body;
         if(b.open[j] > b.close[j - 1] + tol || b.close[j] <= mid || b.close[j] >= b.open[j - 1])
            return false;
         p.firstBar = j - 1;
         p.strength = 0.4 + 0.4 * Ramp((b.close[j] - b.close[j - 1]) / pc.body, 0.5, 1.0);
         p.contextOk = PriorDecline(b, atr, j - 1, LowOf(b, j - 1, j));
         break;
        }
      case GLS_CDL_STAR:
        {
         if(j < 2)
            return false;
         SCandle c1;
         SCandle c2;
         CandleMetrics(b, atr, j - 2, c1);
         CandleMetrics(b, atr, j - 1, c2);
         if(!c1.valid || !c2.valid || c1.dir >= 0 || c1.bodyRatio < InpCdlStrongBodyRatio || c1.body < 0.5 * a)
            return false;
         if(c2.body > 0.3 * c1.body || MathMax(b.open[j - 1], b.close[j - 1]) > b.close[j - 2] + tol)
            return false;
         if(c.dir <= 0 || c.bodyRatio < 0.5 || b.close[j] <= b.close[j - 2] + 0.5 * c1.body)
            return false;
         p.firstBar = j - 2;
         p.strength = 0.6 + 0.4 * Ramp((b.close[j] - b.close[j - 2]) / c1.body, 0.5, 1.0);
         p.contextOk = PriorDecline(b, atr, j - 2, LowOf(b, j - 2, j));
         break;
        }
      case GLS_CDL_REJCONF:
        {
         if(j < 6)
            return false;
         SCandle rc;
         CandleMetrics(b, atr, j - 1, rc);
         if(!rc.valid || rc.lowerRatio < 0.5 || rc.rangeAtr < InpCdlMinRangeATR)
            return false;
         if(b.low[j - 1] >= LowOf(b, j - 6, j - 2))
            return false;   // le rejet doit se produire sur un nouveau plus bas local
         if(c.dir <= 0 || b.close[j] <= b.high[j - 1])
            return false;
         p.firstBar = j - 1;
         p.strength = 0.5 + 0.3 * Ramp(rc.lowerRatio, 0.5, 0.85) + 0.2 * Ramp(c.closeLoc, 0.6, 0.95);
         p.contextOk = PriorDecline(b, atr, j - 1, b.low[j - 1]);
         break;
        }
      case GLS_CDL_DOJI:
        {
         if(c.bodyRatio > InpCdlDojiBodyRatio)
            return false;
         p.dir = 0;
         p.strength = 1.0 - Ramp(c.bodyRatio, 0.0, InpCdlDojiBodyRatio);
         p.contextOk = true;
         break;
        }
      case GLS_CDL_SPIN:
        {
         if(c.bodyRatio <= InpCdlDojiBodyRatio || c.bodyRatio > InpCdlSmallBodyRatio || c.upperRatio < 0.2 || c.lowerRatio < 0.2)
            return false;
         p.dir = 0;
         p.strength = 0.5;
         p.contextOk = true;
         break;
        }
      case GLS_CDL_HESIT:
        {
         if(j < 3)
            return false;
         for(int k = j - 3; k < j; k++)
           {
            double d1 = b.close[k] - b.open[k];
            double d2 = b.close[k + 1] - b.open[k + 1];
            if(d1 * d2 >= 0.0)
               return false;
            double ov = MathMin(b.high[k], b.high[k + 1]) - MathMax(b.low[k], b.low[k + 1]);
            double smaller = MathMin(b.high[k] - b.low[k], b.high[k + 1] - b.low[k + 1]);
            if(smaller <= 0.0 || ov < 0.5 * smaller)
               return false;
           }
         if(MathAbs(b.close[j] - b.open[j - 3]) >= 0.5 * a)
            return false;
         p.dir = 0;
         p.firstBar = j - 3;
         p.strength = 0.6;
         p.contextOk = true;
         break;
        }
      case GLS_CDL_IMPULSE:
        {
         if(c.dir <= 0 || c.bodyRatio < 0.7 || c.closeLoc < 0.8 || c.rangeAtr < InpCdlImpulseATR || !c.closeAbovePrevHigh)
            return false;
         p.strength = 0.5 + 0.5 * Ramp(c.rangeAtr, InpCdlImpulseATR, 2.0 * InpCdlImpulseATR);
         p.contextOk = PriorRise(b, atr, j);   // continuation : dans le sens du mouvement récent
         break;
        }
      case GLS_CDL_CONTINUATION:
        {
         if(c.dir <= 0 || j < 3)
            return false;
         bool found = false;
         for(int ia = j - 2; ia >= MathMax(0, j - 6) && !found; ia--)
           {
            SCandle ic;
            CandleMetrics(b, atr, ia, ic);
            if(!ic.valid || ic.dir <= 0 || ic.bodyRatio < 0.6 || ic.rangeAtr < 0.8 * InpCdlImpulseATR)
               continue;
            double mid = b.low[ia] + 0.5 * ic.range;
            bool inside = true;
            for(int k = ia + 1; k < j; k++)
              {
               if(b.high[k] > b.high[ia] + tol || b.low[k] < mid || MathAbs(b.close[k] - b.open[k]) > 0.5 * ic.body)
                 {
                  inside = false;
                  break;
                 }
              }
            if(!inside || b.close[j] <= b.high[ia])
               continue;
            found = true;
            p.firstBar = ia;
            p.strength = 0.5 + 0.3 * Ramp(ic.rangeAtr, InpCdlImpulseATR, 2.0 * InpCdlImpulseATR) + 0.2 * Ramp(c.closeLoc, 0.6, 0.95);
           }
         if(!found)
            return false;
         p.contextOk = true;
         break;
        }
      case GLS_CDL_PINBAR:
        {
         if(j < 3 || !meaningful || c.lowerRatio < 0.66 || MathMin(b.open[j], b.close[j]) < b.low[j] + 0.66 * c.range)
            return false;
         if(b.low[j] >= LowOf(b, j - 3, j - 1))
            return false;   // le "nez" doit dépasser les plus bas précédents
         p.strength = 0.5 + 0.3 * Ramp(c.lowerRatio, 0.66, 0.9) + 0.2 * Ramp(c.rangeAtr, 0.5, 1.5);
         p.contextOk = PriorDecline(b, atr, j, b.low[j]);
         break;
        }
      case GLS_CDL_FAILBREAK:
        {
         int lb = 10;
         if(j - lb - 1 < 0)
            return false;
         //--- forme 1 : la bougie casse le plus bas des 10 précédentes et clôture au-dessus
         double prevLow = LowOf(b, j - lb, j - 1);
         if(b.low[j] < prevLow - tol && b.close[j] > prevLow)
           {
            p.strength = 0.5 + 0.5 * Ramp(c.closeLoc, 0.5, 0.9);
           }
         else
           {
            //--- forme 2 : clôture sous le plus bas à j-1, retour au-dessus à j
            double prevLow2 = LowOf(b, j - lb - 1, j - 2);
            if(!(b.close[j - 1] < prevLow2 && b.close[j] > prevLow2))
               return false;
            p.firstBar = j - 1;
            p.strength = 0.4 + 0.4 * Ramp(c.closeLoc, 0.5, 0.9);
           }
         p.contextOk = true;
         break;
        }
      case GLS_CDL_ABSORB:
        {
         if(j < 20 || c.rangeAtr < 1.0 || c.bodyRatio > 0.3 || c.closeLoc < 0.6)
            return false;
         double vs = 0.0;
         for(int k = j - 20; k < j; k++)
            vs += b.volume[k];
         double avg = vs / 20.0;
         if(avg <= 0.0 || b.volume[j] < InpCdlAbsorbVolMult * avg)
            return false;   // pas de volume exploitable : rien n'est conclu
         p.strength = 0.3;
         p.contextOk = true;
         break;
        }
      case GLS_CDL_SEQUENCE:
        {
         if(c.dir <= 0 || j < 5)
            return false;
         bool found = false;
         for(int ia = j - 4; ia >= MathMax(1, j - 8) && !found; ia--)
           {
            SCandle ic;
            CandleMetrics(b, atr, ia, ic);
            if(!ic.valid || ic.dir <= 0 || ic.bodyRatio < 0.6 || ic.rangeAtr < 1.2)
               continue;
            //--- ralentissement : au moins 2 bougies d'amplitude décroissante, repli sans casser l'origine
            int slow = 0;
            bool ok = true;
            for(int k = ia + 1; k < j - 1; k++)
              {
               if(b.low[k] < b.low[ia])
                 {
                  ok = false;
                  break;
                 }
               if(b.high[k] - b.low[k] <= b.high[k - 1] - b.low[k - 1] + tol)
                  slow++;
              }
            if(!ok || slow < 2)
               continue;
            //--- rejet puis reprise
            SCandle rc;
            CandleMetrics(b, atr, j - 1, rc);
            if(!rc.valid || rc.lowerRatio < 0.45 || b.close[j] <= b.high[j - 1])
               continue;
            double maxSlowClose = b.close[ia + 1];
            for(int k = ia + 1; k < j; k++)
               maxSlowClose = MathMax(maxSlowClose, b.close[k]);
            if(b.close[j] <= maxSlowClose)
               continue;
            found = true;
            p.firstBar = ia;
            p.strength = 0.6 + 0.4 * Ramp(c.closeLoc, 0.6, 0.95);
           }
         if(!found)
            return false;
         p.contextOk = true;
         break;
        }
      default:
         return false;
     }
   p.strength = Clamp(p.strength, 0.0, 1.0);
   p.low = LowOf(b, p.firstBar, j);
   p.high = HighOf(b, p.firstBar, j);
   if(p.dir == 0)
      p.status = GLS_CDLST_INFO;
   else
      if(CandleSelfConfirmed(id))
        {
         p.status = GLS_CDLST_CONFIRMED;
         p.confirmBar = j;
        }
   return true;
  }

//--- Statut d'une figure orientée à partir des bougies clôturées APRÈS sa formation
void UpdateCandleStatus(const CBarSeries &b, SCandlePattern &p)
  {
   if(p.dir == 0 || p.status == GLS_CDLST_CONFIRMED)
      return;
   int last = b.count - 1;
   for(int k = p.bar + 1; k <= last; k++)
     {
      if(k - p.bar > InpCdlConfirmBars)
        {
         p.status = GLS_CDLST_EXPIRED;
         return;
        }
      if(b.close[k] < p.low)
        {
         p.status = GLS_CDLST_INVALIDATED;
         return;
        }
      if(b.close[k] > p.high)
        {
         p.status = GLS_CDLST_CONFIRMED;
         p.confirmBar = k;
         return;
        }
     }
  }

//+------------------------------------------------------------------+
//| Analyse des dernières bougies d'une vue (achat = série réelle,    |
//| vente = série miroir)                                             |
//+------------------------------------------------------------------+
class CCandleAnalysis
  {
public:
   SCandlePattern    pats[];
   int               viewDir;     // +1 vue achat, -1 vue vente

                     CCandleAnalysis(void) : viewDir(GLS_BUY) {}

   void              Analyze(const CBarSeries &b, const double &atr[], const int dirOfView, const int lookback)
     {
      ArrayResize(pats, 0);
      viewDir = dirOfView;
      int last = b.count - 1;
      if(last < 25)
         return;
      for(int j = MathMax(25, last - lookback + 1); j <= last; j++)
        {
         for(int id = 1; id < GLS_CDL_COUNT; id++)
           {
            if(!g_cdlEnabled[id])
               continue;
            //--- les figures neutres ne sont analysées qu'une fois (vue achat)
            if(dirOfView == GLS_SELL && CandleCategory(id) == GLS_CDLCAT_INDECISION)
               continue;
            SCandlePattern p;
            if(!DetectCandleAt(id, b, atr, j, p))
               continue;
            if(p.dir != 0)
               p.dir = dirOfView;
            UpdateCandleStatus(b, p);
            int n = ArraySize(pats);
            ArrayResize(pats, n + 1);
            pats[n] = p;
           }
        }
     }

   //--- Bougie de déclenchement de type indécision (doji) ?
   bool              IsIndecisionAt(const int bar) const
     {
      for(int i = 0; i < ArraySize(pats); i++)
         if(pats[i].bar == bar && pats[i].id == GLS_CDL_DOJI)
            return true;
      return false;
     }

   //--- Figure de retournement CONFIRMÉE récente (vue courante) depuis fromBar
   bool              ConfirmedReversalSince(const int fromBar, string &name) const
     {
      for(int i = ArraySize(pats) - 1; i >= 0; i--)
        {
         if(pats[i].bar < fromBar || pats[i].status != GLS_CDLST_CONFIRMED || !pats[i].contextOk)
            continue;
         int cat = pats[i].category;
         if(cat == GLS_CDLCAT_REVERSAL || cat == GLS_CDLCAT_REJECTION)
           {
            name = CandleName(pats[i].id, pats[i].dir);
            return true;
           }
        }
      return false;
     }
  };

#endif // GLS_CANDLES_MQH
//+------------------------------------------------------------------+
