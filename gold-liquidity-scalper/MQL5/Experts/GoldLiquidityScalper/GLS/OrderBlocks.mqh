//+------------------------------------------------------------------+
//| OrderBlocks.mqh - Order Blocks (règles PROPRES, distinctes des   |
//| FVG : un OB peut exister sans FVG et une FVG sans OB)            |
//|                                                                  |
//| Définition retenue (haussier ; baissier symétrique) :            |
//|  1. un événement de structure haussier (BOS ou CHOCH) sur la     |
//|     barre j de l'unité, connu à la CLÔTURE de j ;                |
//|  2. l'OB est la DERNIÈRE bougie baissière (clôture < ouverture)  |
//|     parmi les [InpObLookback] barres précédant j (barre k) ;     |
//|  3. le déplacement k+1..j est impulsif : clôture[j] - bas[k]     |
//|     >= [InpObMinDispATR] x ATR(k) et au moins une bougie du sens |
//|     de corps >= 60 % et d'amplitude >= 1 ATR ;                   |
//|  4. zone = [bas[k] ; haut[k]] ; connue à la clôture de j (jamais |
//|     avant : aucune apparition rétroactive) ;                     |
//|  5. retour = nouvelle entrée du prix dans la zone après la       |
//|     création ; invalidation = clôture sous bas[k] -              |
//|     [InpObInvalidBufferATR] x ATR.                               |
//| Le lien avec une FVG (même déplacement ou non) est seulement     |
//| enregistré : la confluence n'ajoute AUCUN point de score (elle   |
//| peut seulement servir de filtre optionnel, à valider par tests). |
//+------------------------------------------------------------------+
#ifndef GLS_ORDERBLOCKS_MQH
#define GLS_ORDERBLOCKS_MQH

#include "Structure.mqh"

#define GLS_OB_FRESH       0
#define GLS_OB_TESTED      1
#define GLS_OB_INVALIDATED 2

string ObStatusText(const int st)
  {
   switch(st)
     {
      case GLS_OB_FRESH:       return "frais";
      case GLS_OB_TESTED:      return "retesté";
      case GLS_OB_INVALIDATED: return "invalidé";
     }
   return "?";
  }

struct SOrderBlock
  {
   int               dir;          // +1 haussier (zone de demande), -1 baissier (zone d'offre)
   double            lo;
   double            hi;
   int               tfMin;        // unité de temps d'origine (minutes)
   datetime          obTime;       // ouverture de la bougie OB
   datetime          dispFrom;     // ouverture de la 1re bougie du déplacement (identifiant du déplacement)
   datetime          dispTo;       // ouverture de la bougie de cassure
   datetime          created;      // clôture de la bougie de cassure : instant où l'OB est connu
   bool              choch;        // la cassure est un CHOCH (sinon BOS)
   double            dispAtr;      // amplitude du déplacement / ATR
   int               retests;
   int               status;
   datetime          statusTime;
   string            reason;
  };

string ObKey(const SOrderBlock &o)
  {
   return "OB|" + IntegerToString(o.tfMin) + "|" + IntegerToString(o.dir) + "|" + IntegerToString((long)o.obTime);
  }

//--- Suivi après la création (barre de cassure j)
void TrackOrderBlock(const CBarSeries &s, const double &atr[], SOrderBlock &o, const int j)
  {
   o.retests = 0;
   o.status = GLS_OB_FRESH;
   o.statusTime = o.created;
   bool inside = false;
   for(int k = j + 1; k < s.count; k++)
     {
      double buf = InpObInvalidBufferATR * ((atr[k] > 0.0) ? atr[k] : 0.0);
      bool touch = (o.dir > 0) ? (s.low[k] <= o.hi) : (s.high[k] >= o.lo);
      if(touch && !inside)
        {
         o.retests++;
         if(o.status == GLS_OB_FRESH)
           {
            o.status = GLS_OB_TESTED;
            o.statusTime = s.CloseTime(k);
           }
        }
      inside = touch;
      bool broken = (o.dir > 0) ? (s.close[k] < o.lo - buf) : (s.close[k] > o.hi + buf);
      if(broken)
        {
         o.status = GLS_OB_INVALIDATED;
         o.statusTime = s.CloseTime(k);
         return;
        }
     }
  }

class COrderBlockMap
  {
public:
   SOrderBlock       obs[];
   int               tfMin;

                     COrderBlockMap(void) : tfMin(5) {}

   //--- s : série de l'unité (chronologique, barres clôturées) ; st : sa structure (événements datés)
   void              Build(const CBarSeries &s, const double &atr[], const CStructure &st, const int tf, const int lookback)
     {
      ArrayResize(obs, 0);
      tfMin = tf;
      int last = s.count - 1;
      for(int e = 0; e < ArraySize(st.events); e++)
        {
         int j = st.events[e].index;
         if(j < 2 || j > last || j < last - lookback + 1)
            continue;
         int type = st.events[e].type;
         int d = (type == GLS_EVT_BOS_UP || type == GLS_EVT_CHOCH_UP) ? 1 : -1;
         //--- dernière bougie de couleur opposée avant la cassure
         int k = -1;
         for(int q = j - 1; q >= MathMax(0, j - InpObLookback); q--)
            if((double)d * (s.close[q] - s.open[q]) < 0.0)
              {
               k = q;
               break;
              }
         if(k < 0 || atr[k] <= 0.0)
            continue;
         double a = atr[k];
         double move = (d > 0) ? s.close[j] - s.low[k] : s.high[k] - s.close[j];
         if(move < InpObMinDispATR * a)
            continue;
         bool impulsive = false;
         for(int q = k + 1; q <= j && !impulsive; q++)
           {
            double rng = s.high[q] - s.low[q];
            if(rng >= a && rng > 0.0 && (double)d * (s.close[q] - s.open[q]) >= 0.6 * rng)
               impulsive = true;
           }
         if(!impulsive)
            continue;
         //--- un seul OB par bougie (deux cassures successives depuis la même bougie)
         bool seen = false;
         for(int n = 0; n < ArraySize(obs) && !seen; n++)
            if(obs[n].dir == d && obs[n].obTime == s.time[k])
               seen = true;
         if(seen)
            continue;
         SOrderBlock o;
         o.dir = d;
         o.lo = s.low[k];
         o.hi = s.high[k];
         o.tfMin = tf;
         o.obTime = s.time[k];
         o.dispFrom = s.time[k + 1];
         o.dispTo = s.time[j];
         o.created = s.CloseTime(j);
         o.choch = (type == GLS_EVT_CHOCH_UP || type == GLS_EVT_CHOCH_DOWN);
         o.dispAtr = move / a;
         o.retests = 0;
         o.status = GLS_OB_FRESH;
         o.statusTime = o.created;
         TrackOrderBlock(s, atr, o, j);
         o.reason = StringFormat("%s, déplacement %.1f ATR, %d retour(s), %s", o.choch ? "CHOCH" : "BOS", o.dispAtr, o.retests,
                                 ObStatusText(o.status));
         int n = ArraySize(obs);
         ArrayResize(obs, n + 1);
         obs[n] = o;
        }
     }

   int               CountActive(const int dir) const
     {
      int c = 0;
      for(int i = 0; i < ArraySize(obs); i++)
         if(obs[i].dir == dir && obs[i].status != GLS_OB_INVALIDATED)
            c++;
      return c;
     }
  };

#endif // GLS_ORDERBLOCKS_MQH
//+------------------------------------------------------------------+
