//+------------------------------------------------------------------+
//| Execution.mqh - envoi et vérification des ordres                 |
//|                                                                  |
//| Règles :                                                         |
//|  - prix et spread relus juste avant chaque envoi ;               |
//|  - OrderCheck avant OrderSend ;                                  |
//|  - chaque code retour est contrôlé, jamais "supposé exécuté" ;   |
//|  - nouvelles tentatives limitées (requote / prix changé) ;       |
//|  - après exécution, l'état réel de la position est relu.         |
//+------------------------------------------------------------------+
#ifndef GLS_EXECUTION_MQH
#define GLS_EXECUTION_MQH

#include "SymbolSpec.mqh"
#include "Logger.mqh"

string RetcodeText(const uint code)
  {
   switch(code)
     {
      case TRADE_RETCODE_REQUOTE:              return "requote";
      case TRADE_RETCODE_REJECT:               return "requête rejetée";
      case TRADE_RETCODE_CANCEL:               return "annulée par le trader";
      case TRADE_RETCODE_PLACED:               return "ordre placé";
      case TRADE_RETCODE_DONE:                 return "exécutée";
      case TRADE_RETCODE_DONE_PARTIAL:         return "exécutée partiellement";
      case TRADE_RETCODE_ERROR:                return "erreur de traitement";
      case TRADE_RETCODE_TIMEOUT:              return "délai dépassé (état incertain)";
      case TRADE_RETCODE_INVALID:              return "requête invalide";
      case TRADE_RETCODE_INVALID_VOLUME:       return "volume invalide";
      case TRADE_RETCODE_INVALID_PRICE:        return "prix invalide";
      case TRADE_RETCODE_INVALID_STOPS:        return "stops invalides";
      case TRADE_RETCODE_TRADE_DISABLED:       return "trading désactivé";
      case TRADE_RETCODE_MARKET_CLOSED:        return "marché fermé";
      case TRADE_RETCODE_NO_MONEY:             return "fonds insuffisants";
      case TRADE_RETCODE_PRICE_CHANGED:        return "prix changé";
      case TRADE_RETCODE_PRICE_OFF:            return "pas de cotation";
      case TRADE_RETCODE_TOO_MANY_REQUESTS:    return "trop de requêtes";
      case TRADE_RETCODE_NO_CHANGES:           return "aucune modification";
      case TRADE_RETCODE_SERVER_DISABLES_AT:   return "trading auto désactivé par le serveur";
      case TRADE_RETCODE_CLIENT_DISABLES_AT:   return "trading auto désactivé dans le terminal";
      case TRADE_RETCODE_LOCKED:               return "requête verrouillée";
      case TRADE_RETCODE_FROZEN:               return "ordre/position gelé(e)";
      case TRADE_RETCODE_INVALID_FILL:         return "mode de remplissage refusé";
      case TRADE_RETCODE_CONNECTION:           return "pas de connexion";
      case TRADE_RETCODE_LIMIT_POSITIONS:      return "limite de positions du compte";
      case TRADE_RETCODE_INVALID_CLOSE_VOLUME: return "volume de clôture invalide";
      case TRADE_RETCODE_POSITION_CLOSED:      return "position déjà fermée";
      case TRADE_RETCODE_LONG_ONLY:            return "achats seulement";
      case TRADE_RETCODE_SHORT_ONLY:           return "ventes seulement";
      case TRADE_RETCODE_CLOSE_ONLY:           return "clôture seulement";
      case TRADE_RETCODE_FIFO_CLOSE:           return "règle FIFO";
     }
   return "code " + IntegerToString((long)code);
  }

bool IsRetryableRetcode(const uint code)
  {
   return (code == TRADE_RETCODE_REQUOTE || code == TRADE_RETCODE_PRICE_CHANGED || code == TRADE_RETCODE_PRICE_OFF);
  }

struct SOpenResult
  {
   bool              ok;
   bool              uncertain;    // état inconnu (délai dépassé...) : resynchronisation requise
   ulong             ticket;       // ticket de position
   long              positionId;
   double            fillPrice;
   double            fillVolume;
   double            requestedPrice;
   double            slOnServer;
   double            tpOnServer;
   uint              retcode;
   string            message;
  };

void OpenResultReset(SOpenResult &r)
  {
   r.ok = false;
   r.uncertain = false;
   r.ticket = 0;
   r.positionId = 0;
   r.fillPrice = 0.0;
   r.fillVolume = 0.0;
   r.requestedPrice = 0.0;
   r.slOnServer = 0.0;
   r.tpOnServer = 0.0;
   r.retcode = 0;
   r.message = "";
  }

class CGlsTrader
  {
private:
   ulong             m_magic;
   int               m_deviation;
   bool              m_tester;

   //--- Rotation du mode de remplissage si le serveur refuse le mode courant
   ENUM_ORDER_TYPE_FILLING NextFilling(const ENUM_ORDER_TYPE_FILLING f) const
     {
      if(f == ORDER_FILLING_FOK)
         return ORDER_FILLING_IOC;
      if(f == ORDER_FILLING_IOC)
         return ORDER_FILLING_RETURN;
      return ORDER_FILLING_FOK;
     }

   void              Pause(const int ms) const
     {
      if(!m_tester)
         Sleep(ms);
     }

public:
   uint              lastRetcode;
   string            lastMessage;

                     CGlsTrader(void) : m_magic(0), m_deviation(30), m_tester(false), lastRetcode(0), lastMessage("") {}

   void              Init(const ulong magic, const int deviationPoints)
     {
      m_magic = magic;
      m_deviation = MathMax(deviationPoints, 0);
      m_tester = (MQLInfoInteger(MQL_TESTER) != 0);
     }

   ulong             Magic(void) const { return m_magic; }

   //--- Recherche de la position créée par un ordre exécuté
   bool              FindPosition(const ulong order, const ulong deal, const string comment, ulong &ticket, long &posId) const
     {
      ticket = 0;
      posId = 0;
      for(int attempt = 0; attempt < 10; attempt++)
        {
         if(order > 0 && PositionSelectByTicket(order))
           {
            ticket = order;
            posId = PositionGetInteger(POSITION_IDENTIFIER);
            return true;
           }
         if(deal > 0 && HistoryDealSelect(deal))
           {
            long pid = HistoryDealGetInteger(deal, DEAL_POSITION_ID);
            if(pid > 0 && PositionSelectByTicket((ulong)pid))
              {
               ticket = (ulong)pid;
               posId = pid;
               return true;
              }
           }
         for(int i = PositionsTotal() - 1; i >= 0; i--)
           {
            ulong t = PositionGetTicket(i);
            if(t == 0)
               continue;
            if((ulong)PositionGetInteger(POSITION_MAGIC) != m_magic || PositionGetString(POSITION_SYMBOL) != g_sym.name)
               continue;
            if(StringLen(comment) > 0 && PositionGetString(POSITION_COMMENT) != comment)
               continue;
            ticket = t;
            posId = PositionGetInteger(POSITION_IDENTIFIER);
            return true;
           }
         Pause(100);
        }
      return false;
     }

   //--- Ouverture au marché avec stop (et objectif final) dans la requête
   bool              OpenMarket(const int dir, const double volume, const double sl, const double tp, const string comment,
                                const double maxSpreadPrice, SOpenResult &res)
     {
      OpenResultReset(res);
      ENUM_ORDER_TYPE_FILLING filling = g_sym.filling;
      for(int attempt = 0; attempt <= InpMaxSendRetries; attempt++)
        {
         MqlTick tick = {};
         if(!SymbolInfoTick(g_sym.name, tick) || tick.bid <= 0.0 || tick.ask <= tick.bid)
           {
            res.message = "cotation indisponible ou incohérente";
            return false;
           }
         double spread = tick.ask - tick.bid;
         if(spread > maxSpreadPrice)
           {
            res.message = StringFormat("spread %s > maximum %s au moment de l'envoi", DoubleToString(spread, g_sym.digits), DoubleToString(maxSpreadPrice, g_sym.digits));
            return false;
           }
         double price = (dir == GLS_BUY) ? tick.ask : tick.bid;
         //--- le stop doit rester du bon côté avec la distance minimale du courtier
         double closePx = (dir == GLS_BUY) ? tick.bid : tick.ask;
         if((double)dir * (closePx - sl) < g_sym.StopsDistance() + g_sym.tickSize)
           {
            res.message = "stop trop proche du prix actuel (niveau de stop du courtier)";
            return false;
           }
         MqlTradeRequest req = {};
         MqlTradeResult result = {};
         MqlTradeCheckResult check = {};
         req.action = TRADE_ACTION_DEAL;
         req.symbol = g_sym.name;
         req.volume = volume;
         req.type = (dir == GLS_BUY) ? ORDER_TYPE_BUY : ORDER_TYPE_SELL;
         req.price = price;
         req.sl = sl;
         req.tp = tp;
         req.deviation = (ulong)m_deviation;
         req.magic = m_magic;
         req.comment = comment;
         req.type_filling = filling;
         req.type_time = ORDER_TIME_GTC;
         res.requestedPrice = price;

         ResetLastError();
         if(!OrderCheck(req, check))
           {
            res.retcode = check.retcode;
            res.message = "OrderCheck refusé : " + RetcodeText(check.retcode) + " " + check.comment;
            if(check.retcode == TRADE_RETCODE_INVALID_FILL)
              {
               filling = NextFilling(filling);
               continue;
              }
            if(IsRetryableRetcode(check.retcode))
              {
               Pause(200);
               continue;
              }
            return false;
           }

         ResetLastError();
         bool sent = OrderSend(req, result);
         res.retcode = result.retcode;
         lastRetcode = result.retcode;
         if(result.retcode == TRADE_RETCODE_DONE || result.retcode == TRADE_RETCODE_DONE_PARTIAL)
           {
            ulong ticket = 0;
            long posId = 0;
            if(!FindPosition(result.order, result.deal, comment, ticket, posId))
              {
               res.uncertain = true;
               res.message = "ordre exécuté mais position introuvable : resynchronisation";
               return false;
              }
            if(!PositionSelectByTicket(ticket))
              {
               res.uncertain = true;
               res.message = "position non sélectionnable après exécution";
               return false;
              }
            res.ok = true;
            res.ticket = ticket;
            res.positionId = posId;
            res.fillPrice = PositionGetDouble(POSITION_PRICE_OPEN);
            res.fillVolume = PositionGetDouble(POSITION_VOLUME);
            res.slOnServer = PositionGetDouble(POSITION_SL);
            res.tpOnServer = PositionGetDouble(POSITION_TP);
            res.message = RetcodeText(result.retcode);
            return true;
           }
         res.message = "OrderSend : " + RetcodeText(result.retcode) + " " + result.comment + " (erreur " + IntegerToString(GetLastError()) + ")";
         if(result.retcode == TRADE_RETCODE_TIMEOUT || (!sent && result.retcode == 0))
           {
            res.uncertain = true;
            return false;
           }
         if(result.retcode == TRADE_RETCODE_INVALID_FILL)
           {
            filling = NextFilling(filling);
            continue;
           }
         if(IsRetryableRetcode(result.retcode))
           {
            Pause(200);
            continue;
           }
         return false;
        }
      if(StringLen(res.message) == 0)
         res.message = "nombre maximal de tentatives atteint";
      return false;
     }

   //--- Modification du stop / de l'objectif d'une position, puis vérification
   bool              ModifyStops(const ulong ticket, const double sl, const double tp, string &msg)
     {
      msg = "";
      if(!PositionSelectByTicket(ticket))
        {
         msg = "position introuvable";
         return false;
        }
      MqlTradeRequest req = {};
      MqlTradeResult result = {};
      req.action = TRADE_ACTION_SLTP;
      req.position = ticket;
      req.symbol = g_sym.name;
      req.sl = sl;
      req.tp = tp;
      req.magic = m_magic;
      ResetLastError();
      bool sent = OrderSend(req, result);
      lastRetcode = result.retcode;
      if(!sent && result.retcode != TRADE_RETCODE_NO_CHANGES)
        {
         msg = RetcodeText(result.retcode) + " " + result.comment + " (erreur " + IntegerToString(GetLastError()) + ")";
         return false;
        }
      if(result.retcode != TRADE_RETCODE_DONE && result.retcode != TRADE_RETCODE_NO_CHANGES)
        {
         msg = RetcodeText(result.retcode) + " " + result.comment;
         return false;
        }
      //--- vérification côté serveur
      if(!PositionSelectByTicket(ticket))
        {
         msg = "position disparue pendant la modification";
         return false;
        }
      double half = g_sym.tickSize * 0.5;
      if(MathAbs(PositionGetDouble(POSITION_SL) - sl) > half || MathAbs(PositionGetDouble(POSITION_TP) - tp) > half)
        {
         msg = "stop non confirmé par le serveur";
         return false;
        }
      return true;
     }

   //--- Fermeture totale (volume <= 0) ou partielle d'une position
   bool              ClosePosition(const ulong ticket, const double volume, const string comment, string &msg)
     {
      msg = "";
      ENUM_ORDER_TYPE_FILLING filling = g_sym.filling;
      for(int attempt = 0; attempt <= InpMaxSendRetries; attempt++)
        {
         if(!PositionSelectByTicket(ticket))
           {
            msg = "position déjà fermée";
            return true;
           }
         double posVol = PositionGetDouble(POSITION_VOLUME);
         long ptype = PositionGetInteger(POSITION_TYPE);
         double vol = (volume <= 0.0 || volume >= posVol - GLS_EPS) ? posVol : g_sym.FloorVolume(volume);
         if(vol < g_sym.volMin - GLS_EPS)
           {
            msg = "volume partiel inférieur au minimum";
            return false;
           }
         MqlTick tick = {};
         if(!SymbolInfoTick(g_sym.name, tick) || tick.bid <= 0.0 || tick.ask < tick.bid)
           {
            msg = "cotation indisponible";
            return false;
           }
         MqlTradeRequest req = {};
         MqlTradeResult result = {};
         req.action = TRADE_ACTION_DEAL;
         req.position = ticket;
         req.symbol = g_sym.name;
         req.volume = vol;
         req.type = (ptype == POSITION_TYPE_BUY) ? ORDER_TYPE_SELL : ORDER_TYPE_BUY;
         req.price = (ptype == POSITION_TYPE_BUY) ? tick.bid : tick.ask;
         req.deviation = (ulong)m_deviation;
         req.magic = m_magic;
         req.comment = comment;
         req.type_filling = filling;
         req.type_time = ORDER_TIME_GTC;
         ResetLastError();
         bool sent = OrderSend(req, result);
         lastRetcode = result.retcode;
         if(result.retcode == TRADE_RETCODE_DONE || result.retcode == TRADE_RETCODE_DONE_PARTIAL)
           {
            //--- vérification de l'état réel
            for(int v = 0; v < 10; v++)
              {
               if(!PositionSelectByTicket(ticket))
                  return true;
               if(PositionGetDouble(POSITION_VOLUME) <= posVol - vol + GLS_EPS)
                  return true;
               Pause(100);
              }
            msg = "exécution annoncée mais volume inchangé";
            return false;
           }
         msg = RetcodeText(result.retcode) + " " + result.comment + " (erreur " + IntegerToString(GetLastError()) + ")";
         if(result.retcode == TRADE_RETCODE_POSITION_CLOSED)
            return true;
         if(result.retcode == TRADE_RETCODE_INVALID_FILL)
           {
            filling = NextFilling(filling);
            continue;
           }
         if(IsRetryableRetcode(result.retcode) || (!sent && result.retcode == 0))
           {
            Pause(200);
            continue;
           }
         return false;
        }
      return false;
     }
  };

CGlsTrader g_trader;

#endif // GLS_EXECUTION_MQH
//+------------------------------------------------------------------+
