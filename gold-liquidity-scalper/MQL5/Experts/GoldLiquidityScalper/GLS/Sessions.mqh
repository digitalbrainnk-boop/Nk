//+------------------------------------------------------------------+
//| Sessions.mqh - heure du serveur, UTC, sessions et annonces       |
//|                                                                  |
//| Les sessions sont définies en heure LOCALE de Londres et de      |
//| New York ; les changements d'heure (UE / USA) sont calculés.     |
//| Conversion : heure serveur -> UTC -> heure locale de la place.   |
//| L'heure du PC de l'utilisateur n'est utilisée qu'en mode AUTO    |
//| pour mesurer le décalage serveur (TimeTradeServer - TimeGMT).    |
//| En backtest, TimeGMT() n'est pas fiable : décalage manuel.       |
//+------------------------------------------------------------------+
#ifndef GLS_SESSIONS_MQH
#define GLS_SESSIONS_MQH

#include "Utils.mqh"

class CGlsClock
  {
public:
   int               offsetSec;       // heure serveur - UTC (secondes)
   string            offsetSource;
   bool              configValid;
   string            configError;
   int               londonStart;
   int               londonEnd;
   int               nyStart;
   int               nyEnd;
   int               asiaStartUtc;    // minutes UTC (plage asiatique pour la liquidité)
   int               asiaEndUtc;
   bool              useSessions;
   int               baseOffsetHours;
   int               dstRule;
   bool              autoMode;
   bool              tester;

                     CGlsClock(void) : offsetSec(0), offsetSource("manuel"), configValid(false), configError(""),
                     londonStart(-1), londonEnd(-1), nyStart(-1), nyEnd(-1), asiaStartUtc(0), asiaEndUtc(420),
                     useSessions(true), baseOffsetHours(0), dstRule(GLS_DST_NONE), autoMode(true), tester(false) {}

   bool              Init(const bool sessionsOn, const string lonStart, const string lonEnd, const string nyS, const string nyE,
                          const string asiaS, const string asiaE, const int manualOffsetHours, const int serverDst, const bool autoOffset)
     {
      useSessions = sessionsOn;
      londonStart = ParseHHMM(lonStart);
      londonEnd = ParseHHMM(lonEnd);
      nyStart = ParseHHMM(nyS);
      nyEnd = ParseHHMM(nyE);
      asiaStartUtc = ParseHHMM(asiaS);
      asiaEndUtc = ParseHHMM(asiaE);
      baseOffsetHours = manualOffsetHours;
      dstRule = serverDst;
      autoMode = autoOffset;
      tester = (MQLInfoInteger(MQL_TESTER) != 0);
      configValid = true;
      configError = "";
      if(londonStart < 0 || londonEnd < 0 || nyStart < 0 || nyEnd < 0)
        {
         configValid = false;
         configError = "horaires de session invalides (format HH:MM attendu)";
        }
      if(asiaStartUtc < 0 || asiaEndUtc < 0)
        {
         configValid = false;
         configError = "plage asiatique invalide (format HH:MM attendu)";
        }
      if(manualOffsetHours < -12 || manualOffsetHours > 14)
        {
         configValid = false;
         configError = "décalage serveur manuel hors limites (-12..+14)";
        }
      return configValid;
     }

   //--- Décalage manuel (avec règle d'heure d'été) pour un instant UTC donné
   int               ManualOffsetForUtc(const datetime utc) const
     {
      int off = baseOffsetHours * 3600;
      if(dstRule == GLS_DST_EU && IsEuDst(utc))
         off += 3600;
      if(dstRule == GLS_DST_US && IsUsDst(utc))
         off += 3600;
      return off;
     }

   //--- Mise à jour du décalage courant
   void              Update(const datetime serverNow)
     {
      if(autoMode && !tester)
        {
         long raw = (long)(TimeTradeServer() - TimeGMT());
         long rounded = (long)MathRound((double)raw / 900.0) * 900;
         if(MathAbs((double)rounded) <= 14.0 * 3600.0)
           {
            offsetSec = (int)rounded;
            offsetSource = "auto";
            return;
           }
        }
      offsetSec = ManualOffsetForUtc(serverNow - baseOffsetHours * 3600);
      offsetSource = tester ? "manuel (backtest)" : "manuel";
     }

   datetime          ServerToUtc(const datetime server) const { return server - offsetSec; }
   datetime          UtcToServer(const datetime utc) const { return utc + offsetSec; }

   //--- Conversion pour une date quelconque (fichiers d'annonces)
   datetime          UtcToServerAt(const datetime utc) const
     {
      if(autoMode && !tester)
         return utc + offsetSec;
      return utc + ManualOffsetForUtc(utc);
     }

   bool              InLondon(const datetime server) const
     {
      return InMinuteWindow(MinuteOfDay(UtcToLondon(ServerToUtc(server))), londonStart, londonEnd);
     }

   bool              InNewYork(const datetime server) const
     {
      return InMinuteWindow(MinuteOfDay(UtcToNewYork(ServerToUtc(server))), nyStart, nyEnd);
     }

   bool              InAsia(const datetime server) const
     {
      return InMinuteWindow(MinuteOfDay(ServerToUtc(server)), asiaStartUtc, asiaEndUtc);
     }

   //--- Session (pour les statistiques)
   int               SessionAt(const datetime server) const
     {
      bool lon = InLondon(server);
      bool ny = InNewYork(server);
      if(lon && ny)
         return GLS_SESSION_OVERLAP;
      if(lon)
         return GLS_SESSION_LONDON;
      if(ny)
         return GLS_SESSION_NEWYORK;
      if(InAsia(server))
         return GLS_SESSION_ASIA;
      return GLS_SESSION_OFF;
     }

   //--- Fenêtre d'entrée autorisée
   bool              EntryWindowOpen(const datetime server) const
     {
      if(!useSessions)
         return true;
      return (InLondon(server) || InNewYork(server));
     }

   string            Describe(const datetime server) const
     {
      datetime utc = ServerToUtc(server);
      return StringFormat("UTC%+.2f (%s) | UTC %s | Londres %s | NY %s",
                          offsetSec / 3600.0, offsetSource,
                          TimeToString(utc, TIME_MINUTES),
                          TimeToString(UtcToLondon(utc), TIME_MINUTES),
                          TimeToString(UtcToNewYork(utc), TIME_MINUTES));
     }
  };

CGlsClock g_clock;

//+------------------------------------------------------------------+
//| Séances de cotation du courtier (SymbolInfoSessionTrade)          |
//| Retourne true si le symbole est en séance ; minutesToClose =      |
//| minutes restantes avant la fin de séance (9999 si inconnu).      |
//+------------------------------------------------------------------+
bool BrokerSessionOpen(const string sym, const datetime serverNow, int &minutesToClose)
  {
   minutesToClose = 9999;
   MqlDateTime dt;
   TimeToStruct(serverNow, dt);
   int sec = dt.hour * 3600 + dt.min * 60 + dt.sec;
   ENUM_DAY_OF_WEEK dow = (ENUM_DAY_OF_WEEK)dt.day_of_week;
   datetime from = 0;
   datetime to = 0;
   bool anySession = false;
   for(uint idx = 0; idx < 10; idx++)
     {
      if(!SymbolInfoSessionTrade(sym, dow, idx, from, to))
         break;
      anySession = true;
      int f = (int)(from % 86400);
      int t = (int)to;
      if(t > 86400)
         t = 86400;
      if(sec >= f && sec < t)
        {
         int remaining = t - sec;
         if(t >= 86400)
           {
            //--- la séance continue peut-être le lendemain dès 00:00
            ENUM_DAY_OF_WEEK next = (ENUM_DAY_OF_WEEK)((dt.day_of_week + 1) % 7);
            datetime f2 = 0;
            datetime t2 = 0;
            if(SymbolInfoSessionTrade(sym, next, 0, f2, t2) && (int)(f2 % 86400) == 0)
               remaining += (int)t2;
           }
         minutesToClose = remaining / 60;
         return true;
        }
     }
   //--- aucune séance déclarée : on ne peut pas conclure, on ne bloque pas ici
   //--- (la fraîcheur des cotations est contrôlée séparément)
   return !anySession;
  }

//+------------------------------------------------------------------+
//| Filtre d'annonces économiques                                     |
//+------------------------------------------------------------------+
#define GLS_NEWS_STATUS_OFF         0
#define GLS_NEWS_STATUS_CALENDAR    1
#define GLS_NEWS_STATUS_FILE        2
#define GLS_NEWS_STATUS_UNAVAILABLE 3

class CGlsNews
  {
public:
   int               status;
   string            statusText;
   int               eventsLoaded;
   int               mode;

private:
   datetime          m_start[];
   datetime          m_end[];
   string            m_label[];
   datetime          m_lastRefresh;
   datetime          m_lastAttempt;

   void              AddWindow(const datetime t, const int before, const int after, const string label)
     {
      int n = ArraySize(m_start);
      ArrayResize(m_start, n + 1);
      ArrayResize(m_end, n + 1);
      ArrayResize(m_label, n + 1);
      m_start[n] = t - before * 60;
      m_end[n] = t + after * 60;
      m_label[n] = label;
     }

   bool              LoadCalendar(const datetime serverNow, const string currency, const int before, const int after)
     {
      MqlCalendarValue values[];
      ResetLastError();
      int n = CalendarValueHistory(values, serverNow - 86400, serverNow + 2 * 86400, NULL, currency);
      int err = GetLastError();
      if(n <= 0 && err != 0)
        {
         statusText = "calendrier MT5 indisponible (code " + IntegerToString(err) + ")";
         return false;
        }
      int high = 0;
      for(int i = 0; i < n; i++)
        {
         MqlCalendarEvent ev;
         if(!CalendarEventById(values[i].event_id, ev))
            continue;
         if(ev.importance != CALENDAR_IMPORTANCE_HIGH)
            continue;
         AddWindow(values[i].time, before, after, ev.name);
         high++;
        }
      eventsLoaded = high;
      return true;
     }

   bool              LoadFile(const string fileName, const int before, const int after, const CGlsClock &clock)
     {
      int h = FileOpen(fileName, FILE_READ | FILE_TXT | FILE_ANSI | FILE_SHARE_READ | FILE_COMMON, ';', CP_UTF8);
      if(h == INVALID_HANDLE)
        {
         statusText = "fichier d'annonces introuvable : " + fileName + " (dossier commun Files)";
         return false;
        }
      int count = 0;
      while(!FileIsEnding(h))
        {
         string line = FileReadString(h);
         StringTrimLeft(line);
         StringTrimRight(line);
         if(StringLen(line) < 16 || StringGetCharacter(line, 0) == '#')
            continue;
         //--- format : AAAA.MM.JJ HH:MM[;libellé]  (heure UTC)
         string parts[];
         int np = StringSplit(line, ';', parts);
         if(np < 1)
            continue;
         datetime utc = StringToTime(parts[0]);
         if(utc <= 0)
            continue;
         AddWindow(clock.UtcToServerAt(utc), before, after, np > 1 ? parts[1] : "annonce (fichier)");
         count++;
        }
      FileClose(h);
      eventsLoaded = count;
      return true;
     }

public:
                     CGlsNews(void) : status(GLS_NEWS_STATUS_OFF), statusText("désactivé"), eventsLoaded(0), mode(GLS_NEWS_OFF), m_lastRefresh(0), m_lastAttempt(0) {}

   //--- Rafraîchissement (calendrier toutes les 30 min, réessai toutes les 5 min)
   void              Refresh(const datetime serverNow, const int newsMode, const string currency, const string fileName,
                             const int before, const int after, const CGlsClock &clock, const bool force)
     {
      mode = newsMode;
      if(newsMode == GLS_NEWS_OFF)
        {
         status = GLS_NEWS_STATUS_OFF;
         statusText = "désactivé : annonces NON filtrées";
         return;
        }
      if(!force)
        {
         if(status == GLS_NEWS_STATUS_FILE)
            return;
         if(status == GLS_NEWS_STATUS_CALENDAR && serverNow - m_lastRefresh < 1800)
            return;
         if(status == GLS_NEWS_STATUS_UNAVAILABLE && serverNow - m_lastAttempt < 300)
            return;
        }
      m_lastAttempt = serverNow;
      ArrayResize(m_start, 0);
      ArrayResize(m_end, 0);
      ArrayResize(m_label, 0);
      eventsLoaded = 0;
      bool tester = (MQLInfoInteger(MQL_TESTER) != 0);
      //--- 1) fichier fourni par l'utilisateur (seule source possible en backtest)
      if(StringLen(fileName) > 0)
        {
         if(LoadFile(fileName, before, after, clock))
           {
            status = GLS_NEWS_STATUS_FILE;
            statusText = StringFormat("fichier : %d annonces chargées", eventsLoaded);
            m_lastRefresh = serverNow;
            return;
           }
        }
      //--- 2) calendrier économique MT5 (non disponible dans le testeur)
      if(tester)
        {
         status = GLS_NEWS_STATUS_UNAVAILABLE;
         statusText = "calendrier indisponible en backtest : annonces NON filtrées";
         return;
        }
      if(LoadCalendar(serverNow, currency, before, after))
        {
         status = GLS_NEWS_STATUS_CALENDAR;
         statusText = StringFormat("calendrier MT5 : %d annonces %s fortes (MAJ %s)", eventsLoaded, currency, TimeToString(serverNow, TIME_MINUTES));
         m_lastRefresh = serverNow;
         return;
        }
      status = GLS_NEWS_STATUS_UNAVAILABLE;
      statusText = statusText + " : annonces NON filtrées";
     }

   bool              Reliable(void) const
     {
      return (status == GLS_NEWS_STATUS_CALENDAR || status == GLS_NEWS_STATUS_FILE);
     }

   //--- Dans une fenêtre d'annonce ?
   bool              InBlackout(const datetime serverNow, string &label) const
     {
      for(int i = 0; i < ArraySize(m_start); i++)
         if(serverNow >= m_start[i] && serverNow <= m_end[i])
           {
            label = m_label[i];
            return true;
           }
      return false;
     }

   //--- Prochaine annonce (pour l'affichage)
   string            NextEventText(const datetime serverNow) const
     {
      int best = -1;
      for(int i = 0; i < ArraySize(m_start); i++)
         if(m_end[i] >= serverNow && (best < 0 || m_start[i] < m_start[best]))
            best = i;
      if(best < 0)
         return "aucune";
      return TimeToString(m_start[best], TIME_DATE | TIME_MINUTES) + " " + m_label[best];
     }
  };

CGlsNews g_news;

#endif // GLS_SESSIONS_MQH
//+------------------------------------------------------------------+
