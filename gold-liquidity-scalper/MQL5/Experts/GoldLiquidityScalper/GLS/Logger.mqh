//+------------------------------------------------------------------+
//| Logger.mqh - journal (onglet Experts + fichiers CSV)             |
//| Fichiers écrits dans le dossier commun des terminaux :           |
//|   <Données communes>\Files\GLS\                                  |
//| (accessible depuis le terminal ET depuis le testeur)             |
//+------------------------------------------------------------------+
#ifndef GLS_LOGGER_MQH
#define GLS_LOGGER_MQH

#include "Utils.mqh"

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
      if(MQLInfoInteger(MQL_TESTER) == 0)
         Alert(GLS_NAME, " : ", message);
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
