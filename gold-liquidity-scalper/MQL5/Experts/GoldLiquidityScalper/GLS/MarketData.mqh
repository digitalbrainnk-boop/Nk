//+------------------------------------------------------------------+
//| MarketData.mqh - collecte et validation des données de marché.   |
//|                                                                  |
//| Convention : les séries sont CHRONOLOGIQUES (index 0 = plus      |
//| ancienne barre) et ne contiennent QUE des barres CLÔTURÉES.      |
//| La barre en cours de formation n'est jamais utilisée pour un     |
//| signal : aucune donnée future n'entre dans une décision.         |
//+------------------------------------------------------------------+
#ifndef GLS_MARKETDATA_MQH
#define GLS_MARKETDATA_MQH

#include "Utils.mqh"

//+------------------------------------------------------------------+
//| Série de barres OHLC                                              |
//+------------------------------------------------------------------+
class CBarSeries
  {
public:
   datetime          time[];
   double            open[];
   double            high[];
   double            low[];
   double            close[];
   double            volume[];    // volume de ticks (information, jamais une preuve d'absorption)
   int               count;
   int               periodSec;

                     CBarSeries(void) : count(0), periodSec(60) {}

   void              Resize(const int n)
     {
      ArrayResize(time, n);
      ArrayResize(open, n);
      ArrayResize(high, n);
      ArrayResize(low, n);
      ArrayResize(close, n);
      ArrayResize(volume, n);
      count = n;
     }

   int               Last(void) const { return count - 1; }
   double            Range(const int i) const { return high[i] - low[i]; }
   double            Body(const int i) const { return MathAbs(close[i] - open[i]); }
   double            BodyRatio(const int i) const { return SafeDiv(Body(i), Range(i), 0.0); }
   //--- position de la clôture dans la barre : 0 = au plus bas, 1 = au plus haut
   double            CloseLocation(const int i) const { return SafeDiv(close[i] - low[i], Range(i), 0.5); }
   double            LowerWick(const int i) const { return MathMin(open[i], close[i]) - low[i]; }
   double            UpperWick(const int i) const { return high[i] - MathMax(open[i], close[i]); }
   datetime          CloseTime(const int i) const { return time[i] + periodSec; }

   int               ArgMaxHigh(const int from, const int to) const
     {
      int best = -1;
      for(int i = MathMax(from, 0); i <= to && i < count; i++)
         if(best < 0 || high[i] > high[best])
            best = i;
      return best;
     }

   int               ArgMinLow(const int from, const int to) const
     {
      int best = -1;
      for(int i = MathMax(from, 0); i <= to && i < count; i++)
         if(best < 0 || low[i] < low[best])
            best = i;
      return best;
     }

   //--- Recherche de l'index d'une barre par son heure d'ouverture (-1 si absente)
   int               IndexOfTime(const datetime t) const
     {
      int lo = 0;
      int hi = count - 1;
      while(lo <= hi)
        {
         int mid = (lo + hi) / 2;
         if(time[mid] == t)
            return mid;
         if(time[mid] < t)
            lo = mid + 1;
         else
            hi = mid - 1;
        }
      return -1;
     }

   //--- Dernier index dont la barre est clôturée au plus tard à l'instant t
   int               LastClosedAt(const datetime t) const
     {
      for(int i = count - 1; i >= 0; i--)
         if(time[i] + periodSec <= t)
            return i;
      return -1;
     }

   void              CopyFrom(const CBarSeries &src)
     {
      Resize(src.count);
      periodSec = src.periodSec;
      for(int i = 0; i < src.count; i++)
        {
         time[i] = src.time[i];
         open[i] = src.open[i];
         high[i] = src.high[i];
         low[i] = src.low[i];
         close[i] = src.close[i];
         volume[i] = src.volume[i];
        }
     }

   //--- Série "miroir" : prix négatifs, hauts et bas inversés.
   //--- Une configuration de VENTE devient une configuration d'ACHAT :
   //--- la même logique codée une seule fois sert aux deux sens.
   void              MirrorFrom(const CBarSeries &src)
     {
      Resize(src.count);
      periodSec = src.periodSec;
      for(int i = 0; i < src.count; i++)
        {
         time[i] = src.time[i];
         open[i] = -src.open[i];
         high[i] = -src.low[i];
         low[i] = -src.high[i];
         close[i] = -src.close[i];
         volume[i] = src.volume[i];
        }
     }

   //--- Contrôle de cohérence (ordre chronologique, prix positifs, OHLC cohérents)
   bool              Validate(string &err) const
     {
      for(int i = 0; i < count; i++)
        {
         if(open[i] <= 0.0 || high[i] <= 0.0 || low[i] <= 0.0 || close[i] <= 0.0)
           {
            err = "prix nul ou négatif à " + TimeToString(time[i]);
            return false;
           }
         if(high[i] < low[i] || high[i] < MathMax(open[i], close[i]) - GLS_EPS || low[i] > MathMin(open[i], close[i]) + GLS_EPS)
           {
            err = "barre OHLC incohérente à " + TimeToString(time[i]);
            return false;
           }
         if(i > 0 && time[i] <= time[i - 1])
           {
            err = "ordre chronologique rompu à " + TimeToString(time[i]);
            return false;
           }
        }
      return true;
     }
  };

//+------------------------------------------------------------------+
//| Indicateurs calculés en interne (déterministes et testables)      |
//+------------------------------------------------------------------+
//--- ATR = moyenne SIMPLE du True Range (même définition que l'iATR de MT5)
//--- out[i] = 0 tant que la période n'est pas remplie
void CalcATR(const CBarSeries &s, const int period, double &out[])
  {
   ArrayResize(out, s.count);
   if(s.count == 0)
      return;
   double tr[];
   ArrayResize(tr, s.count);
   for(int i = 0; i < s.count; i++)
     {
      double r = s.high[i] - s.low[i];
      if(i > 0)
        {
         r = MathMax(r, MathAbs(s.high[i] - s.close[i - 1]));
         r = MathMax(r, MathAbs(s.low[i] - s.close[i - 1]));
        }
      tr[i] = r;
     }
   double sum = 0.0;
   for(int i = 0; i < s.count; i++)
     {
      sum += tr[i];
      if(i >= period)
         sum -= tr[i - period];
      out[i] = (i >= period - 1) ? sum / period : 0.0;
     }
  }

//--- EMA classique (alpha = 2/(n+1)), amorcée par la moyenne simple des n premières valeurs
void CalcEMA(const double &src[], const int count, const int period, double &out[])
  {
   ArrayResize(out, count);
   if(count == 0 || period <= 0)
      return;
   double alpha = 2.0 / (period + 1.0);
   double sum = 0.0;
   for(int i = 0; i < count; i++)
     {
      if(i < period - 1)
        {
         sum += src[i];
         out[i] = 0.0;
         continue;
        }
      if(i == period - 1)
        {
         sum += src[i];
         out[i] = sum / period;
         continue;
        }
      out[i] = out[i - 1] + alpha * (src[i] - out[i - 1]);
     }
  }

//--- Efficiency ratio de Kaufman sur n barres se terminant à endIdx (0..1)
//--- proche de 1 = mouvement directionnel, proche de 0 = marché sans direction
double EfficiencyRatio(const CBarSeries &s, const int endIdx, const int n)
  {
   if(endIdx - n < 0 || endIdx >= s.count)
      return 0.0;
   double path = 0.0;
   for(int i = endIdx - n + 1; i <= endIdx; i++)
      path += MathAbs(s.close[i] - s.close[i - 1]);
   return SafeDiv(MathAbs(s.close[endIdx] - s.close[endIdx - n]), path, 0.0);
  }

//+------------------------------------------------------------------+
//| Chargement des barres clôturées                                   |
//+------------------------------------------------------------------+
bool LoadClosedBars(const string sym, const ENUM_TIMEFRAMES tf, const int wanted, const int minimum, CBarSeries &s, string &err)
  {
   MqlRates rates[];
   ArraySetAsSeries(rates, false);
   ResetLastError();
   //--- start_pos = 1 : la barre 0 (en formation) est exclue
   int got = CopyRates(sym, tf, 1, wanted, rates);
   if(got < minimum)
     {
      err = StringFormat("%s : %d barres disponibles sur %d requises (code %d)", EnumToString(tf), got, minimum, GetLastError());
      s.Resize(0);
      return false;
     }
   s.Resize(got);
   s.periodSec = PeriodSeconds(tf);
   for(int i = 0; i < got; i++)
     {
      s.time[i] = rates[i].time;
      s.open[i] = rates[i].open;
      s.high[i] = rates[i].high;
      s.low[i] = rates[i].low;
      s.close[i] = rates[i].close;
      s.volume[i] = (double)rates[i].tick_volume;
     }
   if(!s.Validate(err))
     {
      err = EnumToString(tf) + " : " + err;
      return false;
     }
   return true;
  }

#endif // GLS_MARKETDATA_MQH
//+------------------------------------------------------------------+
