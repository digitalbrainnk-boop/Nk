//+------------------------------------------------------------------+
//| Risk.mqh - calcul du volume à partir du risque au stop           |
//|                                                                  |
//| volume = budget de risque / perte au stop pour 1 lot             |
//|   budget = min(equity x risque %, marge restante de la limite    |
//|            journalière, marge restante du risque agrégé)         |
//|   perte/lot = max(OrderCalcProfit, ticks x valeur du tick perte) |
//|              + commission aller-retour estimée                   |
//|              (stop décalé du glissement prévu)                   |
//| Arrondi TOUJOURS vers le bas au pas de volume.                   |
//| Si le volume minimal dépasse le budget : refus (jamais de        |
//| relèvement du risque pour forcer une entrée).                    |
//+------------------------------------------------------------------+
#ifndef GLS_RISK_MQH
#define GLS_RISK_MQH

#include "SymbolSpec.mqh"
#include "Logger.mqh"

//--- Commission estimée par lot et par côté (max du paramètre et de la valeur observée)
double g_commissionPerLotSide = 0.0;
//--- Glissement défavorable moyen OBSERVÉ (prix), mis à jour après chaque exécution
double g_observedSlippage = 0.0;

//--- Glissement retenu pour le risque et les coûts : max(paramètre, observé)
double SlippageAllowance(void)
  {
   return MathMax(InpSlippageAllowancePrice, g_observedSlippage);
  }

struct SSizing
  {
   double            volume;
   double            riskMoney;
   double            riskPct;
   double            lossPerLot;
   double            commissionPerLot;   // aller-retour
   double            margin;
   double            minLotRiskPct;
   double            budget;
   int               refusal;
   string            detail;
  };

void SizingReset(SSizing &s)
  {
   s.volume = 0.0;
   s.riskMoney = 0.0;
   s.riskPct = 0.0;
   s.lossPerLot = 0.0;
   s.commissionPerLot = 0.0;
   s.margin = 0.0;
   s.minLotRiskPct = 0.0;
   s.budget = 0.0;
   s.refusal = GLS_REFUSE_NONE;
   s.detail = "";
  }

//--- Perte (positive, devise du compte) pour 1 lot entre entry et stop, prix seul
bool LossPerLot(const int dir, const double entry, const double stop, double &loss, string &detail)
  {
   loss = 0.0;
   detail = "";
   double dist = MathAbs(entry - stop);
   if(dist <= 0.0)
     {
      detail = "distance de stop nulle";
      return false;
     }
   double viaCalc = 0.0;
   double profit = 0.0;
   ENUM_ORDER_TYPE type = (dir == GLS_BUY) ? ORDER_TYPE_BUY : ORDER_TYPE_SELL;
   ResetLastError();
   if(OrderCalcProfit(type, g_sym.name, 1.0, entry, stop, profit) && profit < 0.0)
      viaCalc = -profit;
   double tv = (g_sym.tickValueLoss > 0.0) ? g_sym.tickValueLoss : g_sym.tickValue;
   double viaTick = (g_sym.tickSize > 0.0 && tv > 0.0) ? (dist / g_sym.tickSize) * tv : 0.0;
   if(viaCalc > 0.0 && viaTick > 0.0)
     {
      double rel = MathAbs(viaCalc - viaTick) / MathMax(viaCalc, viaTick);
      if(rel > 0.10)
         detail = StringFormat("écart OrderCalcProfit/valeur du tick %.1f %% : valeur la plus prudente retenue", rel * 100.0);
      loss = MathMax(viaCalc, viaTick);
      return true;
     }
   if(viaCalc > 0.0 || viaTick > 0.0)
     {
      loss = MathMax(viaCalc, viaTick);
      detail = "une seule méthode de valorisation disponible";
      return true;
     }
   detail = "impossible de valoriser la perte au stop (code " + IntegerToString(GetLastError()) + ")";
   return false;
  }

//--- Calcul du volume
//--- maxRiskMoney : plafond imposé par les protections (limite journalière, risque agrégé)
bool ComputeVolume(const int dir, const double entry, const double stop, const double equity, const double freeMargin,
                   const double maxRiskMoney, const double commissionPerLotSide, const double sameDirVolume, SSizing &out)
  {
   SizingReset(out);
   if(equity <= 0.0)
     {
      out.refusal = GLS_REFUSE_MARGIN;
      out.detail = "equity nulle";
      return false;
     }
   double stopWithSlip = stop - (double)dir * SlippageAllowance();
   double perLotPrice = 0.0;
   string d = "";
   if(!LossPerLot(dir, entry, stopWithSlip, perLotPrice, d))
     {
      out.refusal = GLS_REFUSE_DATA;
      out.detail = d;
      return false;
     }
   out.lossPerLot = perLotPrice;
   out.commissionPerLot = 2.0 * MathMax(commissionPerLotSide, 0.0);
   double perLot = perLotPrice + out.commissionPerLot;

   double budget = equity * InpRiskPercent / 100.0;
   if(maxRiskMoney < budget)
      budget = maxRiskMoney;
   out.budget = budget;
   out.minLotRiskPct = 100.0 * g_sym.volMin * perLot / equity;
   if(budget <= 0.0)
     {
      out.refusal = GLS_REFUSE_TOTAL_RISK;
      out.detail = "aucun budget de risque disponible";
      return false;
     }

   double vol = g_sym.FloorVolume(budget / perLot);
   if(vol > g_sym.volMax)
      vol = g_sym.FloorVolume(g_sym.volMax);
   if(g_sym.volLimit > 0.0 && sameDirVolume + vol > g_sym.volLimit)
      vol = g_sym.FloorVolume(g_sym.volLimit - sameDirVolume);
   if(vol < g_sym.volMin - GLS_EPS)
     {
      out.refusal = GLS_REFUSE_MIN_VOLUME;
      out.detail = StringFormat("volume min %s = %.2f %% de risque > budget %.2f %%", DoubleToString(g_sym.volMin, g_sym.volDigits),
                                out.minLotRiskPct, 100.0 * budget / equity);
      return false;
     }

   //--- marge
   ENUM_ORDER_TYPE type = (dir == GLS_BUY) ? ORDER_TYPE_BUY : ORDER_TYPE_SELL;
   double margin = 0.0;
   ResetLastError();
   if(!OrderCalcMargin(type, g_sym.name, vol, entry, margin) || margin < 0.0)
     {
      out.refusal = GLS_REFUSE_MARGIN;
      out.detail = "calcul de marge impossible (code " + IntegerToString(GetLastError()) + ")";
      return false;
     }
   double allowed = freeMargin * InpMaxMarginUsePct / 100.0;
   if(margin > allowed)
     {
      double reduced = (margin > 0.0) ? g_sym.FloorVolume(vol * allowed / margin) : 0.0;
      if(reduced < g_sym.volMin - GLS_EPS)
        {
         out.refusal = GLS_REFUSE_MARGIN;
         out.detail = StringFormat("marge requise %.2f > autorisée %.2f", margin, allowed);
         return false;
        }
      vol = reduced;
      if(!OrderCalcMargin(type, g_sym.name, vol, entry, margin) || margin > allowed)
        {
         out.refusal = GLS_REFUSE_MARGIN;
         out.detail = "marge insuffisante après réduction";
         return false;
        }
     }
   out.volume = vol;
   out.margin = margin;
   out.riskMoney = vol * perLot;
   out.riskPct = 100.0 * out.riskMoney / equity;
   out.detail = d;
   return true;
  }

//--- Découpage du volume pour les prises de bénéfices partielles
//--- THIRDS : TP1 + TP2 + reste ; HALVES : TP1 + reste ; SINGLE : tout à l'objectif unique
void PlanExitParts(const double volume, int &plan, double &v1, double &v2)
  {
   v1 = g_sym.RoundVolume(volume * InpTP1Fraction);
   v2 = g_sym.RoundVolume(volume * InpTP2Fraction);
   double v3 = NormalizeDouble(volume - v1 - v2, g_sym.volDigits);
   if(v1 >= g_sym.volMin - GLS_EPS && v2 >= g_sym.volMin - GLS_EPS && v3 >= g_sym.volMin - GLS_EPS)
     {
      plan = GLS_EXITPLAN_THIRDS;
      return;
     }
   v1 = g_sym.RoundVolume(volume * 0.5);
   if(v1 >= volume - GLS_EPS)
      v1 = g_sym.FloorVolume(volume * 0.5);
   v2 = 0.0;
   v3 = NormalizeDouble(volume - v1, g_sym.volDigits);
   if(v1 >= g_sym.volMin - GLS_EPS && v3 >= g_sym.volMin - GLS_EPS)
     {
      plan = GLS_EXITPLAN_HALVES;
      return;
     }
   v1 = 0.0;
   v2 = 0.0;
   plan = GLS_EXITPLAN_SINGLE;
  }

string ExitPlanText(const int plan)
  {
   if(plan == GLS_EXITPLAN_THIRDS)
      return "tiers (TP1/TP2/TP3)";
   if(plan == GLS_EXITPLAN_HALVES)
      return "moitiés (TP1/TP3)";
   return "objectif unique";
  }

#endif // GLS_RISK_MQH
//+------------------------------------------------------------------+
