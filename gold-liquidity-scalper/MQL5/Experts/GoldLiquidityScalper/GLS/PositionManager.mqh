//+------------------------------------------------------------------+
//| PositionManager.mqh - gestion des positions ouvertes             |
//|                                                                  |
//| Chaque position a un plan : sens, entrée, stop initial (=> R),   |
//| volume initial, découpage des sorties, niveau d'invalidation.    |
//| L'étape des prises partielles est DÉDUITE DU VOLUME RÉEL restant |
//| sur le serveur : après un redémarrage, aucune clôture partielle  |
//| ne peut être rejouée en double.                                  |
//| Le stop n'est JAMAIS déplacé dans le sens qui augmente le risque.|
//+------------------------------------------------------------------+
#ifndef GLS_POSITIONMANAGER_MQH
#define GLS_POSITIONMANAGER_MQH

#include "Context.mqh"
#include "Execution.mqh"
#include "Risk.mqh"
#include "Stats.mqh"
#include "Protection.mqh"

struct SPlan
  {
   ulong             ticket;
   long              posId;
   int               dir;
   int               family;
   double            entry;
   double            initialSL;
   double            initialVolume;
   double            riskDist;
   double            riskMoney;
   int               exitPlan;
   double            v1;
   double            v2;
   double            tp1R;
   double            tp2R;
   double            finalR;
   double            invalidation;   // 0 = inconnu (règle désactivée pour cette position)
   double            hashNum;
   double            score;
   bool              retest;
   datetime          openTime;
   int               session;
   double            requestedPrice;
   double            spreadAtEntry;
   double            estCost;
   double            mfeR;
   double            maeR;
   int               slStage;        // 0 stop initial, 1 break-even, 2 suiveur/verrouillé
   int               exitReason;     // raison de clôture décidée par l'EA (0 sinon)
   datetime          lastActionTime;
   bool              alive;
   int               finalizeAttempts;
   bool              recovered;
   int               stopFailures;
   int               regime;         // régime de marché à l'entrée (statistiques)
   int               candleId;       // figure de bougie retenue comme preuve à l'entrée
   int               zoneTf;         // zone d'origine (F6 : FVG) : unité (0 = aucune)
   datetime          zoneTime;       // ... création
   bool              zoneInv;        // ... IFVG
   int               zoneRetests;    // ... retours à l'entrée (contact compris)
   double            zoneQuality;    // ... qualité à l'entrée
  };

void PlanReset(SPlan &p)
  {
   p.ticket = 0;
   p.posId = 0;
   p.dir = 0;
   p.family = 0;
   p.entry = 0.0;
   p.initialSL = 0.0;
   p.initialVolume = 0.0;
   p.riskDist = 0.0;
   p.riskMoney = 0.0;
   p.exitPlan = GLS_EXITPLAN_SINGLE;
   p.v1 = 0.0;
   p.v2 = 0.0;
   p.tp1R = 0.0;
   p.tp2R = 0.0;
   p.finalR = 0.0;
   p.invalidation = 0.0;
   p.hashNum = 0.0;
   p.score = 0.0;
   p.retest = false;
   p.openTime = 0;
   p.session = GLS_SESSION_OFF;
   p.requestedPrice = 0.0;
   p.spreadAtEntry = 0.0;
   p.estCost = 0.0;
   p.mfeR = 0.0;
   p.maeR = 0.0;
   p.slStage = 0;
   p.exitReason = 0;
   p.lastActionTime = 0;
   p.alive = true;
   p.finalizeAttempts = 0;
   p.recovered = false;
   p.stopFailures = 0;
   p.regime = 0;
   p.candleId = 0;
   p.zoneTf = 0;
   p.zoneTime = 0;
   p.zoneInv = false;
   p.zoneRetests = 0;
   p.zoneQuality = 0.0;
  }

string PlanHash(const SPlan &p)
  {
   return HashHex((uint)p.hashNum);
  }

void PlanSave(const SPlan &p)
  {
   ulong t = p.ticket;
   g_store.PosSet(t, "pid", (double)p.posId);
   g_store.PosSet(t, "fam", p.family);
   g_store.PosSet(t, "ent", p.entry);
   g_store.PosSet(t, "isl", p.initialSL);
   g_store.PosSet(t, "ivol", p.initialVolume);
   g_store.PosSet(t, "rd", p.riskDist);
   g_store.PosSet(t, "rm", p.riskMoney);
   g_store.PosSet(t, "xp", p.exitPlan);
   g_store.PosSet(t, "v1", p.v1);
   g_store.PosSet(t, "v2", p.v2);
   g_store.PosSet(t, "t1", p.tp1R);
   g_store.PosSet(t, "t2", p.tp2R);
   g_store.PosSet(t, "tf", p.finalR);
   g_store.PosSet(t, "inv", p.invalidation);
   g_store.PosSet(t, "hs", p.hashNum);
   g_store.PosSet(t, "sc", p.score);
   g_store.PosSet(t, "rt", p.retest ? 1.0 : 0.0);
   g_store.PosSet(t, "ot", (double)p.openTime);
   g_store.PosSet(t, "ses", p.session);
   g_store.PosSet(t, "req", p.requestedPrice);
   g_store.PosSet(t, "spr", p.spreadAtEntry);
   g_store.PosSet(t, "ec", p.estCost);
   g_store.PosSet(t, "mfe", p.mfeR);
   g_store.PosSet(t, "mae", p.maeR);
   g_store.PosSet(t, "sls", p.slStage);
   g_store.PosSet(t, "exr", p.exitReason);
   g_store.PosSet(t, "rec", p.recovered ? 1.0 : 0.0);
   g_store.PosSet(t, "rg", p.regime);
   g_store.PosSet(t, "cdl", p.candleId);
   g_store.PosSet(t, "ztf", p.zoneTf);
   g_store.PosSet(t, "ztm", (double)p.zoneTime);
   g_store.PosSet(t, "zin", p.zoneInv ? 1.0 : 0.0);
   g_store.PosSet(t, "zrt", p.zoneRetests);
   g_store.PosSet(t, "zq", p.zoneQuality);
   g_store.PosSet(t, "dir", p.dir);   // écrit en dernier : marque un plan complet
  }

bool PlanLoad(const ulong ticket, SPlan &p)
  {
   PlanReset(p);
   if(!g_store.PosHas(ticket, "dir") || !g_store.PosHas(ticket, "rd"))
      return false;
   p.ticket = ticket;
   p.posId = (long)g_store.PosGet(ticket, "pid", 0.0);
   p.dir = (int)g_store.PosGet(ticket, "dir", 0.0);
   p.family = (int)g_store.PosGet(ticket, "fam", 0.0);
   p.entry = g_store.PosGet(ticket, "ent", 0.0);
   p.initialSL = g_store.PosGet(ticket, "isl", 0.0);
   p.initialVolume = g_store.PosGet(ticket, "ivol", 0.0);
   p.riskDist = g_store.PosGet(ticket, "rd", 0.0);
   p.riskMoney = g_store.PosGet(ticket, "rm", 0.0);
   p.exitPlan = (int)g_store.PosGet(ticket, "xp", GLS_EXITPLAN_SINGLE);
   p.v1 = g_store.PosGet(ticket, "v1", 0.0);
   p.v2 = g_store.PosGet(ticket, "v2", 0.0);
   p.tp1R = g_store.PosGet(ticket, "t1", InpTP1R);
   p.tp2R = g_store.PosGet(ticket, "t2", InpTP2R);
   p.finalR = g_store.PosGet(ticket, "tf", InpTP3R);
   p.invalidation = g_store.PosGet(ticket, "inv", 0.0);
   p.hashNum = g_store.PosGet(ticket, "hs", 0.0);
   p.score = g_store.PosGet(ticket, "sc", 0.0);
   p.retest = (g_store.PosGet(ticket, "rt", 0.0) > 0.5);
   p.openTime = (datetime)g_store.PosGet(ticket, "ot", 0.0);
   p.session = (int)g_store.PosGet(ticket, "ses", 0.0);
   p.requestedPrice = g_store.PosGet(ticket, "req", 0.0);
   p.spreadAtEntry = g_store.PosGet(ticket, "spr", 0.0);
   p.estCost = g_store.PosGet(ticket, "ec", 0.0);
   p.mfeR = g_store.PosGet(ticket, "mfe", 0.0);
   p.maeR = g_store.PosGet(ticket, "mae", 0.0);
   p.slStage = (int)g_store.PosGet(ticket, "sls", 0.0);
   p.exitReason = (int)g_store.PosGet(ticket, "exr", 0.0);
   p.recovered = (g_store.PosGet(ticket, "rec", 0.0) > 0.5);
   p.regime = (int)g_store.PosGet(ticket, "rg", 0.0);
   p.candleId = (int)g_store.PosGet(ticket, "cdl", 0.0);
   p.zoneTf = (int)g_store.PosGet(ticket, "ztf", 0.0);
   p.zoneTime = (datetime)g_store.PosGet(ticket, "ztm", 0.0);
   p.zoneInv = (g_store.PosGet(ticket, "zin", 0.0) > 0.5);
   p.zoneRetests = (int)g_store.PosGet(ticket, "zrt", 0.0);
   p.zoneQuality = g_store.PosGet(ticket, "zq", 0.0);
   return (p.dir == GLS_BUY || p.dir == GLS_SELL);
  }

//--- Le nouveau stop réduit-il le risque (ou protège-t-il davantage) ?
bool StopImproves(const int dir, const double currentSL, const double newSL)
  {
   if(newSL <= 0.0)
      return false;
   if(currentSL <= 0.0)
      return true;
   return ((double)dir * (newSL - currentSL) > g_sym.tickSize * 0.5);
  }

class CPositionManager
  {
private:
   bool              m_dirty;

   //--- Distance minimale imposée par le courtier entre le prix et un stop
   bool              StopDistanceOk(const int dir, const double sl, const double bid, const double ask) const
     {
      double minDist = g_sym.StopsDistance() + g_sym.tickSize;
      if(dir == GLS_BUY)
         return (bid - sl >= minDist);
      return (sl - ask >= minDist);
     }

   //--- Le stop actuel est-il dans la zone de gel (modification interdite) ?
   bool              Frozen(const int dir, const double currentSL, const double bid, const double ask) const
     {
      double fz = g_sym.FreezeDistance();
      if(fz <= 0.0 || currentSL <= 0.0)
         return false;
      double px = (dir == GLS_BUY) ? bid : ask;
      return (MathAbs(px - currentSL) <= fz);
     }

   //--- Décalage du break-even : commission aller-retour convertie en prix + marge
   double            BreakEvenOffset(const SPlan &p) const
     {
      double valuePerPrice = (g_sym.tickSize > 0.0) ? g_sym.tickValue / g_sym.tickSize : 0.0;
      double comm = 2.0 * g_commissionPerLotSide;
      double commPrice = (valuePerPrice > 0.0) ? comm / valuePerPrice : 0.0;
      return commPrice + InpBEExtraPrice;
     }

public:
   SPlan             plans[];

                     CPositionManager(void) : m_dirty(false) {}

   int               Count(void) const { return ArraySize(plans); }

   int               Find(const ulong ticket) const
     {
      for(int i = 0; i < ArraySize(plans); i++)
         if(plans[i].ticket == ticket)
            return i;
      return -1;
     }

   void              Add(const SPlan &p)
     {
      int idx = Find(p.ticket);
      if(idx < 0)
        {
         idx = ArraySize(plans);
         ArrayResize(plans, idx + 1);
        }
      plans[idx] = p;
      PlanSave(p);
     }

   void              RemoveAt(const int idx)
     {
      int n = ArraySize(plans);
      if(idx < 0 || idx >= n)
         return;
      for(int i = idx; i < n - 1; i++)
         plans[i] = plans[i + 1];
      ArrayResize(plans, n - 1);
     }

   int               AliveCount(void) const
     {
      int c = 0;
      for(int i = 0; i < ArraySize(plans); i++)
         if(plans[i].alive)
            c++;
      return c;
     }

   //--- Déplacement de stop (resserrement uniquement), vérifié côté serveur
   bool              MoveStop(SPlan &p, const double rawSL, const string why, const datetime now, const double bid, const double ask)
     {
      if(!PositionSelectByTicket(p.ticket))
         return false;
      double curSL = PositionGetDouble(POSITION_SL);
      double curTP = PositionGetDouble(POSITION_TP);
      double newSL = (p.dir == GLS_BUY) ? g_sym.FloorPrice(rawSL) : g_sym.CeilPrice(rawSL);
      if(!StopImproves(p.dir, curSL, newSL))
         return false;   // jamais d'élargissement
      if(!StopDistanceOk(p.dir, newSL, bid, ask) || Frozen(p.dir, curSL, bid, ask))
         return false;   // réessayé plus tard
      string msg = "";
      p.lastActionTime = now;
      if(!g_trader.ModifyStops(p.ticket, newSL, curTP, msg))
        {
         p.stopFailures++;
         g_log.Error("GESTION", StringFormat("#%I64u déplacement du stop (%s) vers %s refusé : %s", p.ticket, why, DoubleToString(newSL, g_sym.digits), msg));
         if(p.stopFailures == 5)
            g_log.Critical("GESTION", StringFormat("#%I64u : 5 échecs de modification du stop", p.ticket));
         return false;
        }
      p.stopFailures = 0;
      g_log.Info("GESTION", StringFormat("#%I64u stop %s -> %s (%s)", p.ticket, DoubleToString(curSL, g_sym.digits), DoubleToString(newSL, g_sym.digits), why));
      return true;
     }

   //--- Clôture totale par l'EA avec raison journalisée
   bool              CloseFor(SPlan &p, const int reason, const datetime now)
     {
      p.exitReason = reason;
      g_store.PosSet(p.ticket, "exr", reason);
      p.lastActionTime = now;
      string msg = "";
      if(!g_trader.ClosePosition(p.ticket, 0.0, BuildExitComment(GlsExitCode(reason), PlanHash(p)), msg))
        {
         p.exitReason = 0;
         g_store.PosSet(p.ticket, "exr", 0);
         g_log.Error("GESTION", StringFormat("#%I64u clôture (%s) échouée : %s", p.ticket, GlsExitCode(reason), msg));
         return false;
        }
      g_log.Info("GESTION", StringFormat("#%I64u clôturée par l'EA : %s", p.ticket, GlsExitCode(reason)));
      return true;
     }

   bool              ClosePartial(SPlan &p, const double volume, const string code, const datetime now)
     {
      p.lastActionTime = now;
      string msg = "";
      if(!g_trader.ClosePosition(p.ticket, volume, BuildExitComment(code, PlanHash(p)), msg))
        {
         g_log.Error("GESTION", StringFormat("#%I64u prise partielle %s (%s lot) échouée : %s", p.ticket, code, DoubleToString(volume, g_sym.volDigits), msg));
         return false;
        }
      g_log.Info("GESTION", StringFormat("#%I64u prise partielle %s : %s lot", p.ticket, code, DoubleToString(volume, g_sym.volDigits)));
      return true;
     }

   //--- Position sans stop sur le serveur : procédure de sécurité explicite
   void              EnsureProtection(SPlan &p, const double bid, const double ask, const datetime now)
     {
      double closePx = (p.dir == GLS_BUY) ? bid : ask;
      double target = p.initialSL;
      bool beyond = (target <= 0.0) || ((double)p.dir * (closePx - target) <= 0.0);
      if(!beyond)
        {
         if(!StopDistanceOk(p.dir, target, bid, ask))
            target = (p.dir == GLS_BUY) ? bid - g_sym.StopsDistance() - 2.0 * g_sym.tickSize : ask + g_sym.StopsDistance() + 2.0 * g_sym.tickSize;
         double curTP = PositionSelectByTicket(p.ticket) ? PositionGetDouble(POSITION_TP) : 0.0;
         string msg = "";
         double sl = (p.dir == GLS_BUY) ? g_sym.FloorPrice(target) : g_sym.CeilPrice(target);
         p.lastActionTime = now;
         if(g_trader.ModifyStops(p.ticket, sl, curTP, msg))
           {
            g_log.Warn("PROTECTION", StringFormat("#%I64u : stop absent, stop de protection posé à %s", p.ticket, DoubleToString(sl, g_sym.digits)));
            return;
           }
         g_log.Error("PROTECTION", StringFormat("#%I64u : impossible de poser le stop : %s", p.ticket, msg));
        }
      if(InpNoSLAction == GLS_NOSL_CLOSE)
        {
         g_log.Critical("PROTECTION", StringFormat("#%I64u sans stop : fermeture de sécurité", p.ticket));
         CloseFor(p, GLS_EXIT_NO_SL, now);
        }
      else
        {
         g_guard.execSuspended = true;
         g_log.Critical("PROTECTION", StringFormat("#%I64u SANS STOP : nouvelles entrées suspendues, intervention requise", p.ticket));
        }
     }

   //--- Gestion à chaque tick : protection, prises partielles, break-even
   void              ManageTick(SPlan &p, const double bid, const double ask, const datetime now)
     {
      if(!p.alive)
         return;
      if(!PositionSelectByTicket(p.ticket))
        {
         p.alive = false;
         return;
        }
      double vol = PositionGetDouble(POSITION_VOLUME);
      double sl = PositionGetDouble(POSITION_SL);
      double tp = PositionGetDouble(POSITION_TP);
      double closePx = (p.dir == GLS_BUY) ? bid : ask;
      double rNow = (p.riskDist > 0.0) ? (double)p.dir * (closePx - p.entry) / p.riskDist : 0.0;
      //--- excursions favorable / défavorable maximales (en R)
      if(rNow > p.mfeR)
        {
         if(rNow > p.mfeR + 0.05)
            m_dirty = true;
         p.mfeR = rNow;
        }
      if(-rNow > p.maeR)
        {
         if(-rNow > p.maeR + 0.05)
            m_dirty = true;
         p.maeR = -rNow;
        }
      if(now - p.lastActionTime < 2)
         return;
      if(sl <= 0.0)
        {
         EnsureProtection(p, bid, ask, now);
         return;
        }
      if(p.riskDist <= 0.0)
         return;   // R inconnu : seuls les stops serveur protègent la position

      //--- perte au-delà du risque prévu (gap, glissement) : sortie immédiate
      if(InpRiskExcessR > 0.0 && rNow <= -InpRiskExcessR)
        {
         CloseFor(p, GLS_EXIT_RISK_EXCESS, now);
         return;
        }

      //--- étape déduite du volume restant réel
      bool partial = (p.exitPlan != GLS_EXITPLAN_SINGLE);
      bool tp1Done = partial && (vol <= p.initialVolume - p.v1 + GLS_EPS);
      bool tp2Done = (p.exitPlan == GLS_EXITPLAN_THIRDS) && (vol <= p.initialVolume - p.v1 - p.v2 + GLS_EPS);
      if(partial && !tp1Done && rNow >= p.tp1R && p.v1 > 0.0)
        {
         ClosePartial(p, p.v1, "TP1", now);
         return;
        }
      if(p.exitPlan == GLS_EXITPLAN_THIRDS && tp1Done && !tp2Done && rNow >= p.tp2R && p.v2 > 0.0)
        {
         ClosePartial(p, p.v2, "TP2", now);
         return;
        }
      //--- objectif final dépassé sans exécution de l'objectif serveur
      if(rNow >= p.finalR + 0.05 && (tp <= 0.0 || (double)p.dir * (closePx - tp) > g_sym.tickSize))
        {
         CloseFor(p, GLS_EXIT_TP_FINAL, now);
         return;
        }

      //--- break-even (déclencheur configurable, coûts inclus)
      if(InpBETriggerR > 0.0 && p.slStage < 1 && rNow >= InpBETriggerR)
        {
         double be = p.entry + (double)p.dir * BreakEvenOffset(p);
         if(!StopImproves(p.dir, sl, be))
           {
            p.slStage = 1;
            m_dirty = true;
           }
         else
            if(MoveStop(p, be, "break-even", now, bid, ask))
              {
               p.slStage = 1;
               m_dirty = true;
              }
         return;
        }

      //--- verrouillage d'un gain après TP2
      if(p.exitPlan == GLS_EXITPLAN_THIRDS && tp2Done && InpLockAfterTP2R > 0.0)
        {
         double lock = p.entry + (double)p.dir * InpLockAfterTP2R * p.riskDist;
         if(StopImproves(p.dir, sl, lock) && MoveStop(p, lock, "verrouillage après TP2", now, bid, ask))
           {
            p.slStage = 2;
            m_dirty = true;
           }
        }
     }

   //--- Gestion à chaque nouvelle barre M1 : sorties structurelles, temps, suiveur
   void              ManageBar(SPlan &p, const CMarketContext &ctx, const double bid, const double ask, const datetime now)
     {
      if(!p.alive || !ctx.ready)
         return;
      if(!PositionSelectByTicket(p.ticket))
        {
         p.alive = false;
         return;
        }
      double sl = PositionGetDouble(POSITION_SL);
      int last = ctx.Last();
      double atr = ctx.atr[last];
      if(atr <= 0.0)
         return;

      //--- A. gestion temporelle
      if(InpMaxHoldMinutes > 0 && now - p.openTime >= InpMaxHoldMinutes * 60)
        {
         CloseFor(p, GLS_EXIT_TIME_MAX, now);
         return;
        }
      if(InpNoProgressMinutes > 0 && now - p.openTime >= InpNoProgressMinutes * 60 && p.mfeR < InpNoProgressMinMFER && p.riskDist > 0.0)
        {
         CloseFor(p, GLS_EXIT_NO_PROGRESS, now);
         return;
        }

      //--- B. invalidation : N clôtures M1 consécutives au-delà du niveau d'invalidation
      if(InpUseInvalidationExit && InpInvalidationCloses > 0 && p.invalidation > 0.0)
        {
         double buf = InpInvalidationBufferATR * atr;
         int count = 0;
         for(int j = last; j >= 0 && count < InpInvalidationCloses; j--)
           {
            if(ctx.m1.CloseTime(j) <= p.openTime)
               break;
            if((double)p.dir * (ctx.m1.close[j] - p.invalidation) < -buf)
               count++;
            else
               break;
           }
         if(count >= InpInvalidationCloses)
           {
            g_log.Info("GESTION", StringFormat("#%I64u invalidation : %d clôture(s) M1 au-delà de %s", p.ticket, count, DoubleToString(p.invalidation, g_sym.digits)));
            CloseFor(p, GLS_EXIT_INVALIDATION, now);
            return;
           }
        }

      //--- C. signal opposé structurellement confirmé (BOS/CHOCH M5 contraire après l'entrée)
      if(InpUseOppositeStructureExit && ctx.st5.OppositeEventAfter(p.dir, p.openTime))
        {
         g_log.Info("GESTION", StringFormat("#%I64u %s M5 contraire après l'entrée", p.ticket, ctx.st5.EventText()));
         CloseFor(p, GLS_EXIT_OPPOSITE, now);
         return;
        }

      //--- D. stop suiveur structurel (derniers creux / sommets M1 confirmés)
      if(InpTrailStartR > 0.0 && p.mfeR >= InpTrailStartR && p.riskDist > 0.0)
        {
         int k = InpTrailSwingStrength;
         double spread = ask - bid;
         double cand = 0.0;
         for(int i = last - k; i >= k && i >= last - 60; i--)
           {
            if(p.dir == GLS_BUY && IsSwingLow(ctx.m1, i, k))
              {
               cand = ctx.m1.low[i] - InpSLBufferATR * atr;
               break;
              }
            if(p.dir == GLS_SELL && IsSwingHigh(ctx.m1, i, k))
              {
               cand = ctx.m1.high[i] + InpSLBufferATR * atr + spread;
               break;
              }
           }
         if(cand > 0.0)
           {
            double minDist = InpTrailATRMult * atr;
            if(p.dir == GLS_BUY)
               cand = MathMin(cand, bid - minDist);
            else
               cand = MathMax(cand, ask + minDist);
            double step = InpTrailMinStepATR * atr;
            if(sl <= 0.0 || (double)p.dir * (cand - sl) >= step)
               if(MoveStop(p, cand, "suiveur structurel", now, bid, ask))
                 {
                  p.slStage = 2;
                  m_dirty = true;
                 }
           }
        }
     }

   void              OnTick(const double bid, const double ask, const datetime now)
     {
      for(int i = 0; i < ArraySize(plans); i++)
         ManageTick(plans[i], bid, ask, now);
      SaveDirty();
     }

   void              OnBar(const CMarketContext &ctx, const double bid, const double ask, const datetime now)
     {
      for(int i = 0; i < ArraySize(plans); i++)
         ManageBar(plans[i], ctx, bid, ask, now);
      SaveDirty();
     }

   void              SaveDirty(void)
     {
      if(!m_dirty)
         return;
      for(int i = 0; i < ArraySize(plans); i++)
         if(plans[i].alive)
            PlanSave(plans[i]);
      m_dirty = false;
     }

   //--- Fermeture de toutes les positions de l'EA ; renvoie le nombre d'échecs
   int               CloseAll(const int reason, const datetime now, int &closed)
     {
      closed = 0;
      int failed = 0;
      for(int i = 0; i < ArraySize(plans); i++)
        {
         if(!plans[i].alive || !PositionSelectByTicket(plans[i].ticket))
            continue;
         if(CloseFor(plans[i], reason, now))
            closed++;
         else
            failed++;
        }
      return failed;
     }

   //--- Exposition : P/L flottant et P/L si tous les stops sont touchés
   void              Exposure(double &floating, double &worstCase, double &buyVol, double &sellVol) const
     {
      floating = 0.0;
      worstCase = 0.0;
      buyVol = 0.0;
      sellVol = 0.0;
      for(int i = 0; i < ArraySize(plans); i++)
        {
         if(!plans[i].alive || !PositionSelectByTicket(plans[i].ticket))
            continue;
         double vol = PositionGetDouble(POSITION_VOLUME);
         double open = PositionGetDouble(POSITION_PRICE_OPEN);
         double sl = PositionGetDouble(POSITION_SL);
         floating += PositionGetDouble(POSITION_PROFIT) + PositionGetDouble(POSITION_SWAP);
         if(plans[i].dir == GLS_BUY)
            buyVol += vol;
         else
            sellVol += vol;
         if(sl <= 0.0)
            sl = plans[i].initialSL;
         double comm = 2.0 * g_commissionPerLotSide * vol;
         double pnl = 0.0;
         ENUM_ORDER_TYPE type = (plans[i].dir == GLS_BUY) ? ORDER_TYPE_BUY : ORDER_TYPE_SELL;
         if(sl > 0.0 && OrderCalcProfit(type, g_sym.name, vol, open, sl, pnl))
            worstCase += pnl - comm;
         else
            worstCase -= plans[i].riskMoney;
        }
     }

   //--- Finalisation des positions fermées : statistiques, journal, nettoyage
   void              FinalizeClosed(const string env, const long account)
     {
      for(int i = ArraySize(plans) - 1; i >= 0; i--)
        {
         if(plans[i].alive)
            continue;
         if(PositionSelectByTicket(plans[i].ticket))
           {
            plans[i].alive = true;   // toujours ouverte (sélection temporairement impossible)
            continue;
           }
         STradeRecord rec;
         bool ok = BuildRecordFromHistory(plans[i].posId > 0 ? plans[i].posId : (long)plans[i].ticket, rec);
         if((!ok || !rec.complete) && plans[i].finalizeAttempts < 30)
           {
            plans[i].finalizeAttempts++;
            continue;   // historique pas encore à jour : nouvel essai plus tard
           }
         if(!ok)
           {
            g_log.Warn("STATS", StringFormat("#%I64u : historique introuvable, statistiques incomplètes", plans[i].ticket));
            g_store.PosDeleteAll(plans[i].ticket);
            RemoveAt(i);
            continue;
           }
         rec.family = plans[i].family;
         rec.dir = plans[i].dir;
         rec.hash = PlanHash(plans[i]);
         rec.score = plans[i].score;
         rec.retest = plans[i].retest;
         rec.riskMoney = plans[i].riskMoney;
         rec.riskDist = plans[i].riskDist;
         rec.rMultiple = (plans[i].riskMoney > 0.0) ? rec.net / plans[i].riskMoney : 0.0;
         rec.exitPlan = plans[i].exitPlan;
         rec.session = plans[i].session;
         rec.regime = plans[i].regime;
         rec.candleId = plans[i].candleId;
         rec.zoneId = (plans[i].zoneTf > 0) ? IntegerToString(plans[i].zoneTf) + "|" + IntegerToString(plans[i].dir) + "|"
                      + IntegerToString((long)plans[i].zoneTime) + (plans[i].zoneInv ? "|I" : "") : "";
         rec.zoneRetests = plans[i].zoneRetests;
         rec.zoneQuality = plans[i].zoneQuality;
         rec.mfeR = plans[i].mfeR;
         rec.maeR = plans[i].maeR;
         rec.spreadPts = (g_sym.point > 0.0) ? plans[i].spreadAtEntry / g_sym.point : 0.0;
         rec.estCost = plans[i].estCost;
         if(plans[i].requestedPrice > 0.0 && g_sym.point > 0.0)
            rec.slippagePts = (double)plans[i].dir * (plans[i].entry - plans[i].requestedPrice) / g_sym.point;
         if(MathAbs(rec.slippagePts) < 1e-9)
            rec.slippagePts = 0.0;
         rec.exitReason = (plans[i].exitReason > 0) ? plans[i].exitReason : ExitReasonFromHistory(rec, plans[i].slStage);
         g_stats.Add(rec);
         g_stats.Compute();
         g_log.WriteTradeRow(CGlsStats::CsvHeader(), g_stats.CsvRow(rec, env, account));
         g_log.Info("STATS", StringFormat("Position #%I64d clôturée : %s %s net %.2f (%.2f R), sortie %s%s", rec.posId, GlsFamilyCode(rec.family),
                                          GlsDirText(rec.dir), rec.net, rec.rMultiple, GlsExitCode(rec.exitReason), rec.complete ? "" : " (historique incomplet)"));
         g_store.PosDeleteAll(plans[i].ticket);
         RemoveAt(i);
        }
     }
  };

CPositionManager g_pm;

#endif // GLS_POSITIONMANAGER_MQH
//+------------------------------------------------------------------+
