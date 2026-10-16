//+------------------------------------------------------------------+
//| Persistence.mqh - état persistant via les variables globales     |
//| du terminal (survivent au redémarrage de l'EA et du terminal).   |
//| Le serveur reste la source de vérité : ces valeurs ne servent    |
//| qu'à retrouver ce que le serveur ne mémorise pas (R initial,     |
//| plan de sortie, famille du signal...).                           |
//+------------------------------------------------------------------+
#ifndef GLS_PERSISTENCE_MQH
#define GLS_PERSISTENCE_MQH

#include "Utils.mqh"

class CGlsStore
  {
private:
   string            m_prefix;

public:
                     CGlsStore(void) : m_prefix("GLS_") {}

   void              Init(const long magic, const long login)
     {
      m_prefix = "GLS_" + IntegerToString(magic) + "_" + IntegerToString(login) + "_";
     }

   string            Key(const string name) const { return m_prefix + name; }

   bool              Has(const string name) const
     {
      return GlobalVariableCheck(Key(name));
     }

   double            Get(const string name, const double def) const
     {
      string k = Key(name);
      if(!GlobalVariableCheck(k))
         return def;
      return GlobalVariableGet(k);
     }

   void              Set(const string name, const double value)
     {
      GlobalVariableSet(Key(name), value);
     }

   void              Del(const string name)
     {
      GlobalVariableDel(Key(name));
     }

   //--- Champs par position (clé = ticket)
   string            PosName(const ulong ticket, const string field) const
     {
      return "P" + IntegerToString((long)ticket) + "_" + field;
     }

   bool              PosHas(const ulong ticket, const string field) const
     {
      return Has(PosName(ticket, field));
     }

   double            PosGet(const ulong ticket, const string field, const double def) const
     {
      return Get(PosName(ticket, field), def);
     }

   void              PosSet(const ulong ticket, const string field, const double value)
     {
      Set(PosName(ticket, field), value);
     }

   void              PosDeleteAll(const ulong ticket)
     {
      GlobalVariablesDeleteAll(Key("P" + IntegerToString((long)ticket) + "_"));
     }

   //--- Liste des tickets de positions mémorisés (champ "dir" présent)
   int               StoredTickets(ulong &tickets[]) const
     {
      ArrayResize(tickets, 0);
      string head = Key("P");
      int total = GlobalVariablesTotal();
      for(int i = 0; i < total; i++)
        {
         string name = GlobalVariableName(i);
         if(StringFind(name, head) != 0)
            continue;
         int tail = StringLen(name) - 4;
         if(tail <= StringLen(head) || StringSubstr(name, tail) != "_dir")
            continue;
         string num = StringSubstr(name, StringLen(head), tail - StringLen(head));
         ulong t = (ulong)StringToInteger(num);
         if(t == 0)
            continue;
         int n = ArraySize(tickets);
         ArrayResize(tickets, n + 1);
         tickets[n] = t;
        }
      return ArraySize(tickets);
     }

   void              Flush(void)
     {
      GlobalVariablesFlush();
     }
  };

CGlsStore g_store;

#endif // GLS_PERSISTENCE_MQH
//+------------------------------------------------------------------+
