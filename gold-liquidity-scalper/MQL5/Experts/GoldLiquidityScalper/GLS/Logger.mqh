//+------------------------------------------------------------------+
//| Logger.mqh - journal (onglet Experts + fichiers CSV)             |
//| Fichiers écrits dans le dossier commun des terminaux :           |
//|   <Données communes>\Files\GLS\                                  |
//| (accessible depuis le terminal ET depuis le testeur)             |
//+------------------------------------------------------------------+
#ifndef GLS_LOGGER_MQH
#define GLS_LOGGER_MQH

#include "Utils.mqh"

//+------------------------------------------------------------------+
//| Alertes configurables (fenêtre, notification mobile, e-mail).     |
//| Une alerte est un MESSAGE : elle ne prouve jamais qu'une          |
//| opération a réussi (l'état réel est toujours relu sur le serveur).|
//| En backtest : journal uniquement.                                 |
//+------------------------------------------------------------------+
#define GLS_ALERT_ERROR      1
#define GLS_ALERT_RISK       2
#define GLS_ALERT_STOP       3
#define GLS_ALERT_CONNECTION 4

class CGlsAlerts
  {
private:
   string            m_keys[];
   datetime          m_times[];

   bool              Throttled(const string key, const datetime now)
     {
      for(int i = 0; i < ArraySize(m_keys); i++)
         if(m_keys[i] == key)
           {
            if(now - m_times[i] < InpAlertThrottleSec)
               return true;
            m_times[i] = now;
            return false;
           }
      int n = ArraySize(m_keys);
      ArrayResize(m_keys, n + 1);
      ArrayResize(m_times, n + 1);
      m_keys[n] = key;
      m_times[n] = now;
      return false;
     }

public:
   int               sent;
   int               failures;
   string            lastText;

                     CGlsAlerts(void) : sent(0), failures(0), lastText("aucune") {}

   bool              KindEnabled(const int kind) const
     {
      switch(kind)
        {
         case GLS_ALERT_ERROR:      return InpAlertErrors;
         case GLS_ALERT_RISK:       return InpAlertRisk;
         case GLS_ALERT_STOP:       return InpAlertStop;
         case GLS_ALERT_CONNECTION: return InpAlertConnection;
        }
      return false;
     }

   void              Notify(const int kind, const string key, const string text)
     {
      if(MQLInfoInteger(MQL_TESTER) != 0 || !KindEnabled(kind))
         return;
      if(Throttled(key, TimeLocal()))
         return;
      string msg = (string)GLS_NAME + " : " + text;
      if(InpAlertPopup)
         Alert(msg);
      if(InpAlertPush && !SendNotification(msg))
        {
         failures++;
         Print(GLS_NAME, " | ATTENTION notification mobile non envoyée (code ", GetLastError(), ") : vérifier l'identifiant MetaQuotes dans Outils > Options > Notifications");
        }
      if(InpAlertMail && !SendMail(GLS_NAME, msg))
        {
         failures++;
         Print(GLS_NAME, " | ATTENTION e-mail non envoyé (code ", GetLastError(), ") : vérifier Outils > Options > E-mail");
        }
      sent++;
      lastText = TimeToString(TimeLocal(), TIME_MINUTES) + " " + text;
     }
  };

CGlsAlerts g_alerts;

class CGlsLogger
  {
private:
   int               m_level;
   bool              m_files;
   string            m_base;        // préfixe des fichiers (environnement, compte, symbole)
   int               m_fileErrors;

   bool              AppendLine(const string fileName, const string header, const string line)
     {
      if(!m_files)
         return false;
      string path = "GLS\\" + fileName;
      int h = FileOpen(path, FILE_READ | FILE_WRITE | FILE_TXT | FILE_ANSI | FILE_SHARE_READ | FILE_SHARE_WRITE | FILE_COMMON, ';', CP_UTF8);
      if(h == INVALID_HANDLE)
        {
         m_fileErrors++;
         if(m_fileErrors <= 3)
            Print(GLS_NAME, " | ERREUR fichier ", path, " code ", GetLastError());
         return false;
        }
      if(FileSize(h) == 0 && StringLen(header) > 0)
         FileWriteString(h, header + "\r\n");
      FileSeek(h, 0, SEEK_END);
      FileWriteString(h, line + "\r\n");
      FileClose(h);
      return true;
     }

   void              Emit(const string level, const string category, const string message)
     {
      Print(GLS_NAME, " | ", level, " | ", category, " | ", message);
      string line = TimeToString(TimeCurrent(), TIME_DATE | TIME_SECONDS) + ";" + level + ";" + category + ";" + message;
      AppendLine(m_base + "_journal.csv", "heure_serveur;niveau;categorie;message", line);
     }

public:
                     CGlsLogger(void) : m_level(GLS_LOG_INFO), m_files(false), m_base("GLS"), m_fileErrors(0) {}

   void              Init(const int level, const bool files, const string base)
     {
      m_level = level;
      m_files = files;
      m_base = base;
      m_fileErrors = 0;
      if(m_files && !FolderCreate("GLS", FILE_COMMON))
         Print(GLS_NAME, " | ATTENTION dossier GLS (commun) non créé, code ", GetLastError());
     }

   bool              FilesEnabled(void) const { return m_files; }
   string            Base(void) const { return m_base; }

   void              Error(const string category, const string message)
     {
      Emit("ERREUR", category, message);
     }

   void              Warn(const string category, const string message)
     {
      Emit("ATTENTION", category, message);
     }

   void              Info(const string category, const string message)
     {
      if(m_level >= GLS_LOG_INFO)
         Emit("INFO", category, message);
     }

   void              Debug(const string category, const string message)
     {
      if(m_level >= GLS_LOG_DEBUG)
         Emit("DEBUG", category, message);
     }

   //--- Alerte visible (popup en réel, journal en backtest)
   void              Critical(const string category, const string message)
     {
      Emit("CRITIQUE", category, message);
      g_alerts.Notify(GLS_ALERT_ERROR, category + message, message);
     }

   //--- Fichiers de recherche
   void              WriteSignalRow(const string header, const string row)
     {
      AppendLine(m_base + "_signals.csv", header, row);
     }

   void              WriteTradeRow(const string header, const string row)
     {
      AppendLine(m_base + "_trades.csv", header, row);
     }

   void              WriteCandleRow(const string header, const string row)
     {
      AppendLine(m_base + "_bougies.csv", header, row);
     }

   void              WriteFvgRow(const string header, const string row)
     {
      AppendLine(m_base + "_fvg.csv", header, row);
     }

   void              WriteObRow(const string header, const string row)
     {
      AppendLine(m_base + "_ob.csv", header, row);
     }

   void              WriteText(const string fileName, const string text)
     {
      if(!m_files)
         return;
      string path = "GLS\\" + fileName;
      int h = FileOpen(path, FILE_WRITE | FILE_TXT | FILE_ANSI | FILE_SHARE_READ | FILE_COMMON, ';', CP_UTF8);
      if(h == INVALID_HANDLE)
        {
         Print(GLS_NAME, " | ERREUR fichier ", path, " code ", GetLastError());
         return;
        }
      FileWriteString(h, text);
      FileClose(h);
     }
  };

CGlsLogger g_log;

#endif // GLS_LOGGER_MQH
//+------------------------------------------------------------------+
