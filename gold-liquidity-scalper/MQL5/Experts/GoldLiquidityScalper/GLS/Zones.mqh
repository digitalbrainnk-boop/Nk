//+------------------------------------------------------------------+
//| Zones.mqh - supports et résistances dynamiques                   |
//|                                                                  |
//| RÈGLES (paramètres entre crochets) :                             |
//|  Pivots : sommets/creux structurels M5 et M15 (force k), pris    |
//|    seulement s'ils sont CONFIRMÉS à l'instant de l'analyse.      |
//|  Regroupement : pivots dont l'écart <= [InpZoneMergeATR] x ATR M5|
//|    forment une zone ; bornes = pivots extrêmes +/- [InpZonePad.] |
//|  Réactions : pivots de la zone séparés d'au moins                |
//|    [InpZoneMinSeparationBars] barres M5 (réactions indépendantes)|
//|  Validité : >= [InpZoneMinTouches] réactions, ou pivot M15       |
//|    (niveau majeur).                                              |
//|  Cassure confirmée : [InpZoneBreakCloses] clôtures M5            |
//|    consécutives au-delà de la zone + [InpZoneBreakBufferATR].    |
//|  Inversion de rôle (ancienne résistance -> support) : seulement  |
//|    après la cassure confirmée PUIS un retour dans la zone suivi  |
//|    d'une clôture qui tient au-delà.                              |
//|  Cassure ratée : après une cassure confirmée, clôture de retour  |
//|    de l'autre côté de la zone (le rôle d'origine est conservé).  |
//|  Sommets/creux égaux : >= 2 pivots du même type à moins de       |
//|    0,1 ATR : concentration probable d'ordres stop au-delà.       |
//+------------------------------------------------------------------+
#ifndef GLS_ZONES_MQH
#define GLS_ZONES_MQH

#include "Structure.mqh"

#define GLS_ZONE_SUPPORT 1
#define GLS_ZONE_RESIST  2
#define GLS_ZONE_PENDING 3   // cassée, rôle non encore confirmé

#define GLS_ZST_ACTIVE       0
#define GLS_ZST_BROKEN       1
#define GLS_ZST_FLIPPED      2
#define GLS_ZST_FAILED_BREAK 3

struct SPivot
  {
   double            price;
   bool              isHigh;
   int               tf;
   datetime          time;
   datetime          confirmTime;
  };

struct SZone
  {
   double            lo;
   double            hi;
   int               origRole;
   int               role;
   int               state;
   int               touches;
   bool              major;
   bool              equal;
   datetime          confirmTime;   // instant où la zone est connue (1er pivot confirmé)
   datetime          lastPivotTime;
   datetime          breakTime;
   double            strength;      // 0..1
   bool              valid;
   string            reason;
  };

string ZoneRoleText(const int role)
  {
   if(role == GLS_ZONE_SUPPORT)
      return "support";
   if(role == GLS_ZONE_RESIST)
      return "résistance";
   return "en attente";
  }

string ZoneStateText(const int st)
  {
   switch(st)
     {
      case GLS_ZST_ACTIVE:       return "active";
      case GLS_ZST_BROKEN:       return "cassée (rôle à confirmer)";
      case GLS_ZST_FLIPPED:      return "rôle inversé confirmé";
      case GLS_ZST_FAILED_BREAK: return "cassure ratée";
     }
   return "?";
  }

class CZoneMap
  {
private:
   SPivot            m_piv[];

   void              AddPivots(const CStructure &st, const int tf, const int maxEach, const datetime now)
     {
      int nh = ArraySize(st.highs);
      for(int i = MathMax(0, nh - maxEach); i < nh; i++)
        {
         if(st.highs[i].confirmTime > now)
            continue;
         int n = ArraySize(m_piv);
         ArrayResize(m_piv, n + 1);
         m_piv[n].price = st.highs[i].price;
         m_piv[n].isHigh = true;
         m_piv[n].tf = tf;
         m_piv[n].time = st.highs[i].time;
         m_piv[n].confirmTime = st.highs[i].confirmTime;
        }
      int nl = ArraySize(st.lows);
      for(int i = MathMax(0, nl - maxEach); i < nl; i++)
        {
         if(st.lows[i].confirmTime > now)
            continue;
         int n = ArraySize(m_piv);
         ArrayResize(m_piv, n + 1);
         m_piv[n].price = st.lows[i].price;
         m_piv[n].isHigh = false;
         m_piv[n].tf = tf;
         m_piv[n].time = st.lows[i].time;
         m_piv[n].confirmTime = st.lows[i].confirmTime;
        }
     }

   void              SortPivotsByPrice(void)
     {
      int n = ArraySize(m_piv);
      for(int i = 1; i < n; i++)
        {
         SPivot key = m_piv[i];
         int j = i - 1;
         while(j >= 0 && m_piv[j].price > key.price)
           {
            m_piv[j + 1] = m_piv[j];
            j--;
           }
         m_piv[j + 1] = key;
        }
     }

   //--- État de la zone d'après les clôtures M5 postérieures au dernier pivot
   void              ResolveState(SZone &z, const CBarSeries &m5, const double atr5)
     {
      z.role = z.origRole;
      z.state = GLS_ZST_ACTIVE;
      double buf = InpZoneBreakBufferATR * atr5;
      int start = m5.LastClosedAt(z.lastPivotTime);
      if(start < 0)
         start = 0;
      int up = 0;
      int dn = 0;
      for(int i = start + 1; i < m5.count; i++)
        {
         double c = m5.close[i];
         if(z.state == GLS_ZST_ACTIVE || z.state == GLS_ZST_FAILED_BREAK)
           {
            up = (c > z.hi + buf) ? up + 1 : 0;
            dn = (c < z.lo - buf) ? dn + 1 : 0;
            if(up >= InpZoneBreakCloses && z.origRole == GLS_ZONE_RESIST)
              {
               z.state = GLS_ZST_BROKEN;
               z.role = GLS_ZONE_PENDING;
               z.breakTime = m5.CloseTime(i);
               up = 0;
               continue;
              }
            if(dn >= InpZoneBreakCloses && z.origRole == GLS_ZONE_SUPPORT)
              {
               z.state = GLS_ZST_BROKEN;
               z.role = GLS_ZONE_PENDING;
               z.breakTime = m5.CloseTime(i);
               dn = 0;
               continue;
              }
           }
         else
            if(z.state == GLS_ZST_BROKEN)
              {
               if(z.origRole == GLS_ZONE_RESIST)
                 {
                  if(c < z.lo)
                    {
                     z.state = GLS_ZST_FAILED_BREAK;   // cassure suivie d'un retour sous la zone
                     z.role = GLS_ZONE_RESIST;
                    }
                  else
                     if(m5.low[i] <= z.hi && c > z.hi)
                       {
                        z.state = GLS_ZST_FLIPPED;    // retest tenu : ancienne résistance devenue support
                        z.role = GLS_ZONE_SUPPORT;
                       }
                 }
               else
                 {
                  if(c > z.hi)
                    {
                     z.state = GLS_ZST_FAILED_BREAK;
                     z.role = GLS_ZONE_SUPPORT;
                    }
                  else
                     if(m5.high[i] >= z.lo && c < z.lo)
                       {
                        z.state = GLS_ZST_FLIPPED;
                        z.role = GLS_ZONE_RESIST;
                       }
                 }
              }
            else
               if(z.state == GLS_ZST_FLIPPED)
                 {
                  //--- une clôture franche de l'autre côté annule l'inversion
                  if(z.role == GLS_ZONE_SUPPORT && c < z.lo - buf)
                    {
                     z.state = GLS_ZST_BROKEN;
                     z.role = GLS_ZONE_PENDING;
                    }
                  if(z.role == GLS_ZONE_RESIST && c > z.hi + buf)
                    {
                     z.state = GLS_ZST_BROKEN;
                     z.role = GLS_ZONE_PENDING;
                    }
                 }
        }
     }

public:
   SZone             zones[];
   double            atrRef;

                     CZoneMap(void) : atrRef(0.0) {}

   void              Build(const CStructure &st5, const CStructure &st15, const CBarSeries &m5, const double atr5, const datetime now)
     {
      ArrayResize(zones, 0);
      ArrayResize(m_piv, 0);
      atrRef = atr5;
      if(atr5 <= 0.0 || m5.count == 0)
         return;
      AddPivots(st15, 15, 30, now);
      AddPivots(st5, 5, 40, now);
      SortPivotsByPrice();
      int n = ArraySize(m_piv);
      double merge = InpZoneMergeATR * atr5;
      double pad = InpZonePadATR * atr5;
      double eqTol = 0.1 * atr5;
      int i = 0;
      while(i < n)
        {
         int j = i;
         while(j + 1 < n && m_piv[j + 1].price - m_piv[i].price <= merge)
            j++;
         SZone z;
         z.lo = m_piv[i].price - pad;
         z.hi = m_piv[j].price + pad;
         z.major = false;
         z.equal = false;
         z.breakTime = 0;
         int highs = 0;
         int lows = 0;
         datetime firstConf = m_piv[i].confirmTime;
         datetime lastPiv = m_piv[i].confirmTime;
         //--- réactions indépendantes : pivots séparés d'au moins N barres M5
         datetime times[];
         ArrayResize(times, 0);
         for(int k = i; k <= j; k++)
           {
            if(m_piv[k].isHigh)
               highs++;
            else
               lows++;
            if(m_piv[k].tf == 15)
               z.major = true;
            if(m_piv[k].confirmTime < firstConf)
               firstConf = m_piv[k].confirmTime;
            if(m_piv[k].confirmTime > lastPiv)
               lastPiv = m_piv[k].confirmTime;
            bool independent = true;
            for(int t = 0; t < ArraySize(times); t++)
               if(MathAbs((double)(m_piv[k].time - times[t])) < InpZoneMinSeparationBars * 300.0)
                 {
                  independent = false;
                  break;
                 }
            if(independent)
              {
               int nt = ArraySize(times);
               ArrayResize(times, nt + 1);
               times[nt] = m_piv[k].time;
              }
            for(int q = k + 1; q <= j; q++)
               if(m_piv[q].isHigh == m_piv[k].isHigh && MathAbs(m_piv[q].price - m_piv[k].price) <= eqTol
                  && MathAbs((double)(m_piv[q].time - m_piv[k].time)) >= InpZoneMinSeparationBars * 300.0)
                  z.equal = true;
           }
         z.touches = ArraySize(times);
         z.origRole = (highs > lows) ? GLS_ZONE_RESIST : ((lows > highs) ? GLS_ZONE_SUPPORT : (m_piv[j].isHigh ? GLS_ZONE_RESIST : GLS_ZONE_SUPPORT));
         z.confirmTime = firstConf;
         z.lastPivotTime = lastPiv;
         ResolveState(z, m5, atr5);
         z.valid = (z.touches >= InpZoneMinTouches || z.major);
         z.strength = Clamp(0.3 + 0.15 * MathMin(z.touches - 1, 3) + (z.major ? 0.2 : 0.0) + (z.equal ? 0.1 : 0.0)
                            + (z.state == GLS_ZST_FLIPPED ? 0.1 : 0.0), 0.0, 1.0);
         z.reason = StringFormat("%d réaction(s)%s%s, %s", z.touches, z.major ? ", M15" : "", z.equal ? ", sommets/creux égaux" : "", ZoneStateText(z.state));
         int nz = ArraySize(zones);
         ArrayResize(zones, nz + 1);
         zones[nz] = z;
         i = j + 1;
        }
     }

   //--- Zone de support (dir > 0) ou de résistance (dir < 0) la plus proche du prix, du bon côté
   int               Nearest(const int role, const double price) const
     {
      int best = -1;
      double bestD = 0.0;
      for(int i = 0; i < ArraySize(zones); i++)
        {
         if(!zones[i].valid || zones[i].role != role)
            continue;
         double d = (role == GLS_ZONE_SUPPORT) ? price - zones[i].hi : zones[i].lo - price;
         if(d < -(zones[i].hi - zones[i].lo))
            continue;   // zone franchie de plus d'une largeur : elle n'est pas du bon côté
         double ad = MathAbs(d);
         if(best < 0 || ad < bestD)
           {
            best = i;
            bestD = ad;
           }
        }
      return best;
     }

   string            Describe(const int idx, const int digits) const
     {
      if(idx < 0 || idx >= ArraySize(zones))
         return "aucune";
      return DoubleToString(zones[idx].lo, digits) + "-" + DoubleToString(zones[idx].hi, digits) + " (" + zones[idx].reason + ")";
     }
  };

#endif // GLS_ZONES_MQH
//+------------------------------------------------------------------+
