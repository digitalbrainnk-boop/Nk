//+------------------------------------------------------------------+
//| SymbolSpec.mqh - détection du symbole XAU/USD et lecture des     |
//| spécifications réelles du contrat chez le courtier.              |
//| Aucune spécification n'est supposée : tout est lu sur le serveur.|
//+------------------------------------------------------------------+
#ifndef GLS_SYMBOLSPEC_MQH
#define GLS_SYMBOLSPEC_MQH

#include "Utils.mqh"

class CGlsSymbol
  {
public:
   string            name;
   bool              valid;
   string            error;
   int               digits;
   double            point;
   double            tickSize;
   double            tickValue;
   double            tickValueLoss;
   double            tickValueProfit;
   double            contractSize;
   double            volMin;
   double            volMax;
   double            volStep;
   double            volLimit;
   int               volDigits;
   int               stopsLevel;     // en points
   int               freezeLevel;    // en points
   string            baseCcy;
   string            profitCcy;
   string            marginCcy;
   long              tradeMode;
   long              exeMode;
   long              fillingFlags;
   ENUM_ORDER_TYPE_FILLING filling;

                     CGlsSymbol(void) { Clear(); }

   void              Clear(void)
     {
      name = "";
      valid = false;
      error = "";
      digits = 0;
      point = 0.0;
      tickSize = 0.0;
      tickValue = 0.0;
      tickValueLoss = 0.0;
      tickValueProfit = 0.0;
      contractSize = 0.0;
      volMin = 0.0;
      volMax = 0.0;
      volStep = 0.0;
      volLimit = 0.0;
      volDigits = 2;
      stopsLevel = 0;
      freezeLevel = 0;
      baseCcy = "";
      profitCcy = "";
      marginCcy = "";
      tradeMode = 0;
      exeMode = 0;
      fillingFlags = 0;
      filling = ORDER_FILLING_RETURN;
     }

   //--- Le symbole est-il de l'or coté en dollars ?
   static bool       IsGoldUsd(const string sym)
     {
      string up = sym;
      StringToUpper(up);
      string base = SymbolInfoString(sym, SYMBOL_CURRENCY_BASE);
      string prof = SymbolInfoString(sym, SYMBOL_CURRENCY_PROFIT);
      StringToUpper(base);
      StringToUpper(prof);
      if(base == "XAU" && prof == "USD")
         return true;
      return (StringFind(up, "XAUUSD") == 0);
     }

   //--- Liste des symboles or/USD proposés par le courtier
   static string     ListGoldCandidates(void)
     {
      string out = "";
      int total = SymbolsTotal(false);
      int found = 0;
      for(int i = 0; i < total && found < 8; i++)
        {
         string s = SymbolName(i, false);
         if(IsGoldUsd(s))
           {
            out += (found > 0 ? ", " : "") + s;
            found++;
           }
        }
      return out;
     }

   //--- Détermine le symbole à trader. L'EA ne trade que le symbole du graphique
   //--- (les événements de tick et de barre en dépendent).
   bool              Detect(const string overrideName, const string chartSymbol)
     {
      Clear();
      string candidate = chartSymbol;
      StringTrimLeft(candidate);
      StringTrimRight(candidate);
      string ovr = overrideName;
      StringTrimLeft(ovr);
      StringTrimRight(ovr);
      if(StringLen(ovr) > 0 && ovr != candidate)
        {
         error = "Le symbole forcé (" + ovr + ") diffère du graphique (" + candidate + "). Attachez l'EA au graphique " + ovr + ".";
         return false;
        }
      if(!IsGoldUsd(candidate))
        {
         string list = ListGoldCandidates();
         error = "Le graphique " + candidate + " n'est pas XAU/USD. Symboles or disponibles : " + (StringLen(list) > 0 ? list : "aucun trouvé");
         return false;
        }
      name = candidate;
      if(!SymbolSelect(name, true))
        {
         error = "Impossible de sélectionner " + name + " dans le Market Watch (code " + IntegerToString(GetLastError()) + ")";
         return false;
        }
      return Refresh();
     }

   //--- Relit toutes les propriétés (appelé à l'init et à chaque vérification)
   bool              Refresh(void)
     {
      valid = false;
      if(StringLen(name) == 0)
        {
         error = "symbole non défini";
         return false;
        }
      digits = (int)SymbolInfoInteger(name, SYMBOL_DIGITS);
      point = SymbolInfoDouble(name, SYMBOL_POINT);
      tickSize = SymbolInfoDouble(name, SYMBOL_TRADE_TICK_SIZE);
      tickValue = SymbolInfoDouble(name, SYMBOL_TRADE_TICK_VALUE);
      tickValueLoss = SymbolInfoDouble(name, SYMBOL_TRADE_TICK_VALUE_LOSS);
      tickValueProfit = SymbolInfoDouble(name, SYMBOL_TRADE_TICK_VALUE_PROFIT);
      contractSize = SymbolInfoDouble(name, SYMBOL_TRADE_CONTRACT_SIZE);
      volMin = SymbolInfoDouble(name, SYMBOL_VOLUME_MIN);
      volMax = SymbolInfoDouble(name, SYMBOL_VOLUME_MAX);
      volStep = SymbolInfoDouble(name, SYMBOL_VOLUME_STEP);
      volLimit = SymbolInfoDouble(name, SYMBOL_VOLUME_LIMIT);
      stopsLevel = (int)SymbolInfoInteger(name, SYMBOL_TRADE_STOPS_LEVEL);
      freezeLevel = (int)SymbolInfoInteger(name, SYMBOL_TRADE_FREEZE_LEVEL);
      baseCcy = SymbolInfoString(name, SYMBOL_CURRENCY_BASE);
      profitCcy = SymbolInfoString(name, SYMBOL_CURRENCY_PROFIT);
      marginCcy = SymbolInfoString(name, SYMBOL_CURRENCY_MARGIN);
      tradeMode = SymbolInfoInteger(name, SYMBOL_TRADE_MODE);
      exeMode = SymbolInfoInteger(name, SYMBOL_TRADE_EXEMODE);
      fillingFlags = SymbolInfoInteger(name, SYMBOL_FILLING_MODE);

      if((fillingFlags & SYMBOL_FILLING_FOK) == SYMBOL_FILLING_FOK)
         filling = ORDER_FILLING_FOK;
      else
         if((fillingFlags & SYMBOL_FILLING_IOC) == SYMBOL_FILLING_IOC)
            filling = ORDER_FILLING_IOC;
         else
            filling = ORDER_FILLING_RETURN;

      if(tickSize <= 0.0)
         tickSize = point;
      volDigits = StepDigits(volStep);

      if(point <= 0.0 || tickSize <= 0.0)
        {
         error = "point/taille du tick invalides";
         return false;
        }
      if(volMin <= 0.0 || volStep <= 0.0 || volMax < volMin)
        {
         error = "contraintes de volume invalides";
         return false;
        }
      if(tickValue <= 0.0 && tickValueLoss <= 0.0)
        {
         error = "valeur du tick indisponible (cotations de conversion manquantes ?)";
         return false;
        }
      valid = true;
      error = "";
      return true;
     }

   //--- Prix arrondi au tick le plus proche
   double            NormalizePrice(const double price) const
     {
      if(tickSize <= 0.0)
         return NormalizeDouble(price, digits);
      return NormalizeDouble(MathRound(price / tickSize) * tickSize, digits);
     }

   //--- Prix arrondi vers le bas / le haut (stops arrondis "vers l'extérieur")
   double            FloorPrice(const double price) const
     {
      if(tickSize <= 0.0)
         return NormalizeDouble(price, digits);
      return NormalizeDouble(MathFloor(price / tickSize + GLS_EPS) * tickSize, digits);
     }

   double            CeilPrice(const double price) const
     {
      if(tickSize <= 0.0)
         return NormalizeDouble(price, digits);
      return NormalizeDouble(MathCeil(price / tickSize - GLS_EPS) * tickSize, digits);
     }

   //--- Volume arrondi au pas, vers le bas (jamais plus de risque que prévu)
   double            FloorVolume(const double volume) const
     {
      if(volStep <= 0.0)
         return 0.0;
      double steps = MathFloor(volume / volStep + 1e-7);
      return NormalizeDouble(steps * volStep, volDigits);
     }

   //--- Volume arrondi au pas le plus proche (parts de sortie : n'augmente pas le risque)
   double            RoundVolume(const double volume) const
     {
      if(volStep <= 0.0)
         return 0.0;
      return NormalizeDouble(MathRound(volume / volStep) * volStep, volDigits);
     }

   double            StopsDistance(void) const { return stopsLevel * point; }
   double            FreezeDistance(void) const { return freezeLevel * point; }

   int               PriceToPoints(const double distance) const
     {
      if(point <= 0.0)
         return 0;
      return (int)MathRound(distance / point);
     }

   bool              TradeModeAllows(const int dir) const
     {
      if(tradeMode == SYMBOL_TRADE_MODE_FULL)
         return true;
      if(tradeMode == SYMBOL_TRADE_MODE_LONGONLY)
         return (dir == GLS_BUY);
      if(tradeMode == SYMBOL_TRADE_MODE_SHORTONLY)
         return (dir == GLS_SELL);
      return false;
     }

   string            TradeModeText(void) const
     {
      switch((int)tradeMode)
        {
         case SYMBOL_TRADE_MODE_DISABLED:  return "désactivé";
         case SYMBOL_TRADE_MODE_LONGONLY:  return "achats seulement";
         case SYMBOL_TRADE_MODE_SHORTONLY: return "ventes seulement";
         case SYMBOL_TRADE_MODE_CLOSEONLY: return "clôture seulement";
         case SYMBOL_TRADE_MODE_FULL:      return "complet";
        }
      return "inconnu";
     }

   string            ExecModeText(void) const
     {
      switch((int)exeMode)
        {
         case SYMBOL_TRADE_EXECUTION_REQUEST:  return "sur demande";
         case SYMBOL_TRADE_EXECUTION_INSTANT:  return "instantanée";
         case SYMBOL_TRADE_EXECUTION_MARKET:   return "au marché";
         case SYMBOL_TRADE_EXECUTION_EXCHANGE: return "bourse";
        }
      return "inconnue";
     }

   string            FillingText(void) const
     {
      if(filling == ORDER_FILLING_FOK)
         return "FOK";
      if(filling == ORDER_FILLING_IOC)
         return "IOC";
      return "RETURN";
     }

   string            SpecSummary(void) const
     {
      return StringFormat("%s : %d déc., tick %s (valeur %s), contrat %s, vol. %s-%s pas %s, stops %d pts, gel %d pts, %s/%s marge %s, exécution %s, remplissage %s",
                          name, digits, DoubleToString(tickSize, digits), DoubleToString(tickValue, 4),
                          DoubleToString(contractSize, 2), DoubleToString(volMin, volDigits), DoubleToString(volMax, volDigits),
                          DoubleToString(volStep, volDigits), stopsLevel, freezeLevel, baseCcy, profitCcy, marginCcy,
                          ExecModeText(), FillingText());
     }
  };

CGlsSymbol g_sym;

#endif // GLS_SYMBOLSPEC_MQH
//+------------------------------------------------------------------+
