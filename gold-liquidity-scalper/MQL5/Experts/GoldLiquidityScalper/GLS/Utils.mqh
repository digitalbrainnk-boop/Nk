//+------------------------------------------------------------------+
//| Utils.mqh - fonctions utilitaires sans effet de bord             |
//| (calculs, temps, fuseaux horaires, chaînes, hachage)             |
//+------------------------------------------------------------------+
#ifndef GLS_UTILS_MQH
#define GLS_UTILS_MQH

#include "Defines.mqh"

//--- Division protégée : MQL5 arrête l'EA sur une division par zéro
double SafeDiv(const double num, const double den, const double fallback = 0.0)
  {
   if(MathAbs(den) < 1e-12)
      return fallback;
   return num / den;
  }

double Clamp(const double v, const double lo, const double hi)
  {
   if(v < lo)
      return lo;
   if(v > hi)
      return hi;
   return v;
  }

int ClampInt(const int v, const int lo, const int hi)
  {
   if(v < lo)
      return lo;
   if(v > hi)
      return hi;
   return v;
  }

//--- Interpolation linéaire bornée : 0 à x0, 1 à x1 (x0 < x1 ou x0 > x1)
double Ramp(const double x, const double x0, const double x1)
  {
   if(MathAbs(x1 - x0) < 1e-12)
      return (x >= x1) ? 1.0 : 0.0;
   return Clamp((x - x0) / (x1 - x0), 0.0, 1.0);
  }

//--- Nombre de décimales d'un pas (ex. 0.01 -> 2)
int StepDigits(const double step)
  {
   int digits = 0;
   double s = step;
   while(digits < 8 && MathAbs(s - MathRound(s)) > 1e-8)
     {
      s *= 10.0;
      digits++;
     }
   return digits;
  }

//--- Hachage FNV-1a 32 bits (identifiant stable de signal)
uint HashString(const string text)
  {
   uint h = (uint)0x811C9DC5;
   int len = StringLen(text);
   for(int i = 0; i < len; i++)
     {
      h ^= (uint)StringGetCharacter(text, i);
      h *= 16777619;
     }
   return h;
  }

string HashHex(const uint h)
  {
   return StringFormat("%06X", h & 0xFFFFFF);
  }

string BoolText(const bool v)
  {
   return v ? "oui" : "non";
  }

string FormatMoney(const double v, const string currency)
  {
   return DoubleToString(v, 2) + " " + currency;
  }

string FormatPct(const double v, const int digits = 2)
  {
   return DoubleToString(v, digits) + " %";
  }

//+------------------------------------------------------------------+
//| Temps                                                             |
//+------------------------------------------------------------------+
datetime DayStart(const datetime t)
  {
   return (datetime)(t - (t % 86400));
  }

int MinuteOfDay(const datetime t)
  {
   return (int)((t % 86400) / 60);
  }

int GlsDayOfWeek(const datetime t)
  {
   MqlDateTime s;
   TimeToStruct(t, s);
   return s.day_of_week; // 0 = dimanche
  }

datetime MakeTime(const int year, const int month, const int day, const int hour, const int minute)
  {
   MqlDateTime s;
   s.year = year;
   s.mon = month;
   s.day = day;
   s.hour = hour;
   s.min = minute;
   s.sec = 0;
   s.day_of_week = 0;
   s.day_of_year = 0;
   return StructToTime(s);
  }

//--- Dernier dimanche d'un mois (00:00)
datetime LastSundayOfMonth(const int year, const int month)
  {
   int ny = (month == 12) ? year + 1 : year;
   int nm = (month == 12) ? 1 : month + 1;
   datetime t = MakeTime(ny, nm, 1, 0, 0) - 86400;
   while(GlsDayOfWeek(t) != 0)
      t -= 86400;
   return t;
  }

//--- n-ième dimanche d'un mois (00:00), n >= 1
datetime NthSundayOfMonth(const int year, const int month, const int n)
  {
   datetime t = MakeTime(year, month, 1, 0, 0);
   while(GlsDayOfWeek(t) != 0)
      t += 86400;
   return t + 7 * 86400 * (n - 1);
  }

int YearOf(const datetime t)
  {
   MqlDateTime s;
   TimeToStruct(t, s);
   return s.year;
  }

//--- Heure d'été européenne : du dernier dimanche de mars 01:00 UTC
//--- au dernier dimanche d'octobre 01:00 UTC
bool IsEuDst(const datetime utc)
  {
   int y = YearOf(utc);
   datetime start = LastSundayOfMonth(y, 3) + 3600;
   datetime end = LastSundayOfMonth(y, 10) + 3600;
   return (utc >= start && utc < end);
  }

//--- Heure d'été américaine : du 2e dimanche de mars 02:00 locale (07:00 UTC)
//--- au 1er dimanche de novembre 02:00 locale (06:00 UTC)
bool IsUsDst(const datetime utc)
  {
   int y = YearOf(utc);
   datetime start = NthSundayOfMonth(y, 3, 2) + 7 * 3600;
   datetime end = NthSundayOfMonth(y, 11, 1) + 6 * 3600;
   return (utc >= start && utc < end);
  }

datetime UtcToLondon(const datetime utc)
  {
   return utc + (IsEuDst(utc) ? 3600 : 0);
  }

datetime UtcToNewYork(const datetime utc)
  {
   return utc - 5 * 3600 + (IsUsDst(utc) ? 3600 : 0);
  }

//--- "HH:MM" -> minutes depuis minuit, -1 si invalide
int ParseHHMM(const string text)
  {
   string parts[];
   if(StringSplit(text, ':', parts) != 2)
      return -1;
   string hs = parts[0];
   string ms = parts[1];
   StringTrimLeft(hs);
   StringTrimRight(hs);
   StringTrimLeft(ms);
   StringTrimRight(ms);
   if(StringLen(hs) < 1 || StringLen(hs) > 2 || StringLen(ms) != 2)
      return -1;
   for(int i = 0; i < StringLen(hs); i++)
     {
      ushort c = StringGetCharacter(hs, i);
      if(c < '0' || c > '9')
         return -1;
     }
   for(int i = 0; i < 2; i++)
     {
      ushort c = StringGetCharacter(ms, i);
      if(c < '0' || c > '9')
         return -1;
     }
   int h = (int)StringToInteger(hs);
   int m = (int)StringToInteger(ms);
   if(h > 23 || m > 59)
      return -1;
   return h * 60 + m;
  }

//--- Appartenance à une fenêtre [start, end) en minutes, gère le passage de minuit
bool InMinuteWindow(const int minute, const int start, const int end)
  {
   if(start < 0 || end < 0 || start == end)
      return false;
   if(start < end)
      return (minute >= start && minute < end);
   return (minute >= start || minute < end);
  }

string MinutesToHHMM(const int minutes)
  {
   int m = ((minutes % 1440) + 1440) % 1440;
   return StringFormat("%02d:%02d", m / 60, m % 60);
  }

#endif // GLS_UTILS_MQH
//+------------------------------------------------------------------+
