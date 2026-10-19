//+------------------------------------------------------------------+
//| Engine.mqh - orchestration : initialisation, reprise après       |
//| redémarrage, contrôles avant entrée, exécution, actions des      |
//| boutons, rafraîchissement du tableau de bord.                    |
//+------------------------------------------------------------------+
#ifndef GLS_ENGINE_MQH
#define GLS_ENGINE_MQH

#include "Signals.mqh"
#include "PositionManager.mqh"
#include "Dashboard.mqh"

#define GLS_USED_RING 20

//--- Figures de bougies désactivées et régimes autorisés par famille (paramètres)
void AnalysisConfigInit(void)
  {
   CandleConfigInit(InpCdlDisabled);
   for(int f = 0; f < ArraySize(g_regimeMask); f++)
      g_regimeMask[f] = 0;
   g_regimeMask[GLS_FAMILY_SWEEP] = ParseRegimeMask(InpRegimesF1);
   g_regimeMask[GLS_FAMILY_PULLBACK] = ParseRegimeMask(InpRegimesF2);
   g_regimeMask[GLS_FAMILY_RANGE_BREAK] = ParseRegimeMask(InpRegimesF3);
   g_regimeMask[GLS_FAMILY_SQUEEZE] = ParseRegimeMask(InpRegimesF4);
   g_regimeMask[GLS_FAMILY_SR_BOUNCE] = ParseRegimeMask(InpRegimesF5);
   g_regimeMask[GLS_FAMILY_FVG] = ParseRegimeMask(InpRegimesF6);
  }

class CGlsEngine
  {
private:
   double            m_spreads[];
   int               m_spreadPos;
   int               m_spreadCount;
   double            m_used[];          // empreintes des signaux déjà exécutés
   datetime          m_lastBarTime;
   datetime          m_lastReconcile;
   datetime          m_lastFinalize;
   int               m_reconnectAtTick; // GetTickCount() à la reconnexion
   bool              m_wasConnected;
   string            m_checkLines[];
   int               m_checkStatus[];
   string            m_cdlKeys[];       // figures déjà journalisées (clé) et dernier statut
   int               m_cdlState[];
   string            m_fvgKeys[];       // FVG déjà journalisées (clé) et dernier état
   int               m_fvgState[];
   string            m_fvgCntKeys[];    // FVG de l'unité de trading déjà comptées (clé) et indicateurs du jour
   int               m_fvgCntFlags[];
   string            m_obKeys[];        // Order Blocks déjà journalisés
   int               m_obState[];
   string            m_zdKeys[];        // décisions par zone déjà journalisées (zone + sens + motif)
   int               m_zdState[];

public:
   bool              symbolOk;
   string            symbolError;
   bool              running;
   bool              stateCoherent;
   bool              needResync;
   datetime          startedAt;
   string            env;
   long              account;
   bool              isReal;
   bool              tester;
   bool              optimization;
   bool              visual;
   string            lastSignalText;
   string            lastRefusalText;
   string            lastExecText;
   int               pendingOrders;
   double            lastSpread;
   int               lastSession;
   int               cdlDetected;       // figures détectées aujourd'hui
   int               cdlConfirmed;      // figures confirmées aujourd'hui
   int               sigRejected;       // signaux complets refusés aujourd'hui
   int               sigExecuted;       // transactions exécutées aujourd'hui
   int               fvgDetected;       // FVG (unité de trading, hors doublons) créées aujourd'hui
   int               fvgQualified;      // ... ayant atteint la qualité minimale
   int               fvgRetested;       // ... revisitées au moins une fois
   int               fvgInvalidated;    // ... invalidées
   string            lastCandleText;

                     CGlsEngine(void) : m_spreadPos(0), m_spreadCount(0), m_lastBarTime(0), m_lastReconcile(0), m_lastFinalize(0),
                     m_reconnectAtTick(0), m_wasConnected(true), symbolOk(false), symbolError(""), running(false), stateCoherent(false),
                     needResync(true), startedAt(0), env("?"), account(0), isReal(false), tester(false), optimization(false), visual(false),
                     lastSignalText("aucun"), lastRefusalText("aucun"), lastExecText("aucune"), pendingOrders(0), lastSpread(0.0),
                     lastSession(GLS_SESSION_OFF), cdlDetected(0), cdlConfirmed(0), sigRejected(0), sigExecuted(0), fvgDetected(0), fvgQualified(0),
                     fvgRetested(0), fvgInvalidated(0), lastCandleText("aucune") {}

   //+---------------------------------------------------------------+
   //| Utilitaires                                                    |
   //+---------------------------------------------------------------+
   bool              Connected(void) const
     {
      if(tester)
         return true;
      return (TerminalInfoInteger(TERMINAL_CONNECTED) != 0);
     }

   bool              AlgoAllowed(string &why) const
     {
      why = "";
      if(TerminalInfoInteger(TERMINAL_TRADE_ALLOWED) == 0)
         why = "bouton Trading algorithmique du terminal désactivé";
      else
         if(MQLInfoInteger(MQL_TRADE_ALLOWED) == 0)
            why = "trading algo non autorisé dans les propriétés de l'EA";
         else
            if(AccountInfoInteger(ACCOUNT_TRADE_ALLOWED) == 0)
               why = "trading non autorisé pour ce compte (investisseur ?)";
            else
               if(AccountInfoInteger(ACCOUNT_TRADE_EXPERT) == 0)
                  why = "trading par EA refusé par le serveur pour ce compte";
      return (StringLen(why) == 0);
     }

   double            MaxSpreadPrice(void) const
     {
      double cap = InpMaxSpreadPrice;
      double atr = g_ctx.ready ? g_ctx.Atr() : 0.0;
      if(atr > 0.0 && InpMaxSpreadATRFrac > 0.0)
         cap = MathMin(cap, InpMaxSpreadATRFrac * atr);
      return cap;
     }

   void              RecordSpread(const double spread)
     {
      if(ArraySize(m_spreads) != 300)
        {
         ArrayResize(m_spreads, 300);
         ArrayInitialize(m_spreads, 0.0);
        }
      m_spreads[m_spreadPos] = spread;
      m_spreadPos = (m_spreadPos + 1) % 300;
      if(m_spreadCount < 300)
         m_spreadCount++;
      lastSpread = spread;
     }

   double            MedianSpread(void) const
     {
      if(m_spreadCount < 30)
         return 0.0;
      double tmp[];
      ArrayResize(tmp, m_spreadCount);
      for(int i = 0; i < m_spreadCount; i++)
         tmp[i] = m_spreads[i];
      ArraySort(tmp);
      return tmp[m_spreadCount / 2];
     }

   void              LoadUsedSignals(void)
     {
      ArrayResize(m_used, 0);
      for(int i = 0; i < GLS_USED_RING; i++)
        {
         double v = g_store.Get("sg" + IntegerToString(i), 0.0);
         if(v > 0.0)
           {
            int n = ArraySize(m_used);
            ArrayResize(m_used, n + 1);
            m_used[n] = v;
           }
        }
     }

   void              MarkSignalUsed(const string id)
     {
      double h = (double)HashString(id);
      int n = ArraySize(m_used);
      ArrayResize(m_used, n + 1);
      m_used[n] = h;
      int slot = (int)g_store.Get("sgpos", 0.0);
      g_store.Set("sg" + IntegerToString(slot % GLS_USED_RING), h);
      g_store.Set("sgpos", (double)((slot + 1) % GLS_USED_RING));
      g_store.Flush();
     }

   bool              SignalUsed(const string id) const
     {
      double h = (double)HashString(id);
      for(int i = 0; i < ArraySize(m_used); i++)
         if(m_used[i] == h)
            return true;
      //--- sécurité supplémentaire : empreinte présente dans le commentaire d'une position ouverte
      string hx = HashHex(HashString(id));
      for(int i = PositionsTotal() - 1; i >= 0; i--)
        {
         ulong t = PositionGetTicket(i);
         if(t == 0)
            continue;
         if((ulong)PositionGetInteger(POSITION_MAGIC) != g_trader.Magic())
            continue;
         if(StringFind(PositionGetString(POSITION_COMMENT), hx) >= 0)
            return true;
        }
      return false;
     }

   void              SetRefusal(const int reason, const string detail, const datetime now)
     {
      lastRefusalText = TimeToString(now, TIME_MINUTES) + " " + GlsRefusalText(reason);
      if(StringLen(detail) > 0)
         lastRefusalText += " (" + detail + ")";
     }

   //+---------------------------------------------------------------+
   //| Initialisation                                                 |
   //+---------------------------------------------------------------+
   int               Init(void)
     {
      tester = (MQLInfoInteger(MQL_TESTER) != 0);
      optimization = (MQLInfoInteger(MQL_OPTIMIZATION) != 0);
      visual = (MQLInfoInteger(MQL_VISUAL_MODE) != 0);
      account = AccountInfoInteger(ACCOUNT_LOGIN);
      long mode = AccountInfoInteger(ACCOUNT_TRADE_MODE);
      isReal = (mode == ACCOUNT_TRADE_MODE_REAL) && !tester;
      if(tester)
         env = "BACKTEST";
      else
         env = (mode == ACCOUNT_TRADE_MODE_REAL) ? "REEL" : ((mode == ACCOUNT_TRADE_MODE_CONTEST) ? "CONCOURS" : "DEMO");

      //--- configuration des modules d'analyse (avant la validation)
      AnalysisConfigInit();

      string err = "";
      if(!ValidateInputs(err))
        {
         Print(GLS_NAME, " | paramètres invalides : ", err);
         return INIT_PARAMETERS_INCORRECT;
        }

      symbolOk = g_sym.Detect(InpSymbolOverride, _Symbol);
      symbolError = g_sym.error;
      string base = "GLS_" + env + "_" + IntegerToString(account) + "_" + (symbolOk ? g_sym.name : _Symbol);
      g_log.Init(InpLogLevel, InpWriteFiles && !optimization, base);
      g_store.Init(InpMagic, account);
      g_trader.Init((ulong)InpMagic, 0);
      g_clock.Init(InpUseSessions, InpLondonStart, InpLondonEnd, InpNewYorkStart, InpNewYorkEnd, InpAsiaStartUTC, InpAsiaEndUTC,
                   InpServerUTCOffsetHours, InpServerDST, InpServerOffsetMode == GLS_OFFSET_AUTO);
      if(!g_clock.configValid)
        {
         Print(GLS_NAME, " | ", g_clock.configError);
         return INIT_PARAMETERS_INCORRECT;
        }
      g_clock.Update(TimeCurrent());
      g_stats.sourceLabel = env + " compte " + IntegerToString(account);

      if(!symbolOk)
        {
         g_log.Error("INIT", symbolError);
         if(tester)
            return INIT_FAILED;
        }
      else
        {
         g_trader.Init((ulong)InpMagic, (int)MathRound(InpMaxDeviationPrice / g_sym.point));
         g_log.Info("INIT", g_sym.SpecSummary());
        }

      g_log.Info("INIT", StringFormat("%s v%s | %s | compte %I64d (%s) | famille %s | risque %.2f %%", GLS_NAME, GLS_VERSION, env, account,
                                      AccountInfoString(ACCOUNT_CURRENCY), GlsFamilyCode(InpFamily), InpRiskPercent));
      LoadUsedSignals();
      m_wasConnected = Connected();
      g_guard.Init(TimeCurrent(), AccountInfoDouble(ACCOUNT_EQUITY), InpResetDrawdownPeak);
      g_news.Refresh(TimeCurrent(), InpNewsMode, InpNewsCurrency, InpNewsFile, InpNewsMinutesBefore, InpNewsMinutesAfter, g_clock, true);
      g_log.Info("ANNONCES", g_news.statusText);

      if(symbolOk)
         Recover("initialisation");

      //--- état de marche : backtest = démarrage automatique ; réel/démo = état mémorisé
      if(tester)
         running = InpAutoStartInTester;
      else
         running = symbolOk && (g_store.Get("run", 0.0) > 0.5);
      startedAt = TimeCurrent();
      if(running && !tester)
         g_log.Info("INIT", "reprise de l'état « démarré » mémorisé (les nouvelles entrées attendent un état cohérent)");

      if(InpShowDashboard && (!tester || visual))
        {
         g_dash.Create(InpDashX, InpDashY, InpDashFontSize);
         UpdateDashboard();
        }
      EventSetTimer(1);
      return INIT_SUCCEEDED;
     }

   bool              ValidateInputs(string &err) const
     {
      err = "";
      if(InpRiskPercent <= 0.0 || InpRiskPercent > 2.0)
         err = "risque par trade hors limites (0 < risque <= 2 %)";
      else
         if(InpMaxTotalRiskPct < InpRiskPercent || InpMaxTotalRiskPct > 5.0)
            err = "risque agrégé incohérent (>= risque par trade, <= 5 %)";
         else
            if(InpTP1R <= 0.0 || InpTP2R <= InpTP1R || InpTP3R <= InpTP2R)
               err = "objectifs R incohérents (0 < TP1 < TP2 < TP3)";
            else
               if(InpTP1Fraction <= 0.0 || InpTP2Fraction <= 0.0 || InpTP1Fraction + InpTP2Fraction >= 1.0)
                  err = "fractions de sortie incohérentes";
               else
                  if(InpMinScore < 0.0 || InpMinScore > 100.0)
                     err = "score minimal hors 0-100";
                  else
                     if(InpWLiquidity + InpWTrigger + InpWStructure + InpWAlignment + InpWRetest + InpWVolatility + InpWCost + InpWRR <= 0.0)
                        err = "somme des poids du score nulle";
                     else
                        if(InpM1Lookback < 5 || InpM1SwingStrength < 1 || InpMicroSwingStrength < 1)
                           err = "paramètres de structure M1 invalides";
                        else
                           if(InpMaxOpenPositions < 1 || InpMaxOpenPositions > 5)
                              err = "positions simultanées : 1 à 5";
                           else
                              if(InpMinSLATR <= 0.0 || InpMaxSLATR <= InpMinSLATR)
                                 err = "bornes de stop (ATR) incohérentes";
                              else
                                 if(InpDayResetHour < 0 || InpDayResetHour > 23)
                                    err = "heure de réinitialisation journalière 0-23";
                                 else
                                    if(InpMagic <= 0)
                                       err = "magic number invalide";
                                    else
                                       if(InpMaxSpreadPrice <= 0.0)
                                          err = "spread maximal invalide";
                                       else
                                          if(InpSingleTargetR <= 0.0)
                                             err = "objectif unique invalide";
      if(StringLen(err) == 0 && InpWCandle < 0.0)
         err = "poids des bougies négatif";
      if(StringLen(err) == 0 && (InpFamily < 1 || InpFamily > GLS_FAMILY_MAX))
         err = "famille inconnue";
      if(StringLen(err) == 0 && InpUseRegimeFilter && g_regimeMask[InpFamily] == 0)
         err = "aucun régime valide autorisé pour la famille active (InpRegimesF*)";
      if(StringLen(err) == 0 && InpFvgWDisp + InpFvgWSize + InpFvgWStructure + InpFvgWSweep + InpFvgWFresh + InpFvgWContext <= 0.0)
         err = "poids de qualité FVG nuls";
      if(StringLen(err) == 0 && (InpCdlConfirmBars < 1 || InpCdlLookback < 3 || InpCdlDojiBodyRatio >= InpCdlSmallBodyRatio))
         err = "paramètres de bougies incohérents";
      if(StringLen(err) == 0 && (InpZoneMergeATR <= 0.0 || InpZoneBreakCloses < 1 || InpMaxBarGapMin < 1))
         err = "paramètres de zones / données incohérents";
      if(StringLen(err) == 0 && (InpObLookback < 1 || InpObMinDispATR <= 0.0 || InpObConfluenceATR < 0.0 || InpObInvalidBufferATR < 0.0))
         err = "paramètres d'Order Block incohérents";
      //--- une FVG ne déclenche jamais seule : la variante sans réaction n'existe que pour la recherche
      if(StringLen(err) == 0 && !InpFvgRequireReaction && !tester)
         err = "InpFvgRequireReaction = false est un réglage de RECHERCHE réservé au testeur de stratégie";
      return (StringLen(err) == 0);
     }

   //+---------------------------------------------------------------+
   //| Reprise après redémarrage / reconnexion                        |
   //+---------------------------------------------------------------+
   bool              ReconstructPlan(const ulong ticket, SPlan &p)
     {
      PlanReset(p);
      if(!PositionSelectByTicket(ticket))
         return false;
      p.ticket = ticket;
      p.posId = PositionGetInteger(POSITION_IDENTIFIER);
      p.dir = (PositionGetInteger(POSITION_TYPE) == POSITION_TYPE_BUY) ? GLS_BUY : GLS_SELL;
      p.entry = PositionGetDouble(POSITION_PRICE_OPEN);
      p.openTime = (datetime)PositionGetInteger(POSITION_TIME);
      double curSL = PositionGetDouble(POSITION_SL);
      double curVol = PositionGetDouble(POSITION_VOLUME);
      string comment = PositionGetString(POSITION_COMMENT);
      int fam = 0;
      int d = 0;
      bool rt = false;
      double sc = 0.0;
      string hs = "";
      double riskPts = 0.0;
      if(ParseEntryComment(comment, fam, d, rt, sc, hs))
        {
         string parts[];
         if(StringSplit(comment, ' ', parts) >= 4)
            riskPts = StringToDouble(parts[3]);
        }
      p.family = (fam > 0) ? fam : InpFamily;
      p.score = sc;
      p.retest = rt;
      p.hashNum = 0.0;
      //--- volume initial depuis l'historique (deals d'entrée)
      STradeRecord rec;
      p.initialVolume = curVol;
      if(BuildRecordFromHistory(p.posId, rec) && rec.volume > 0.0)
         p.initialVolume = rec.volume;
      //--- risque initial : commentaire, puis stop de l'ordre d'ouverture, puis stop actuel
      p.riskDist = riskPts * g_sym.point;
      if(p.riskDist <= 0.0 && HistoryOrderSelect((ulong)p.posId))
        {
         double osl = HistoryOrderGetDouble((ulong)p.posId, ORDER_SL);
         if(osl > 0.0 && (double)p.dir * (p.entry - osl) > 0.0)
            p.riskDist = (double)p.dir * (p.entry - osl);
        }
      if(p.riskDist <= 0.0 && curSL > 0.0 && (double)p.dir * (p.entry - curSL) > 0.0)
         p.riskDist = (double)p.dir * (p.entry - curSL);
      p.initialSL = (p.riskDist > 0.0) ? p.entry - (double)p.dir * p.riskDist : curSL;
      double perLot = 0.0;
      string det = "";
      if(p.riskDist > 0.0 && LossPerLot(p.dir, p.entry, p.initialSL, perLot, det))
         p.riskMoney = perLot * p.initialVolume + 2.0 * g_commissionPerLotSide * p.initialVolume;
      PlanExitParts(p.initialVolume, p.exitPlan, p.v1, p.v2);
      p.tp1R = InpTP1R;
      p.tp2R = InpTP2R;
      p.finalR = (p.exitPlan == GLS_EXITPLAN_SINGLE) ? InpSingleTargetR : InpTP3R;
      p.invalidation = 0.0;   // inconnu : règle d'invalidation désactivée pour cette position
      if(curSL > 0.0 && (double)p.dir * (curSL - p.entry) >= 0.0)
         p.slStage = ((double)p.dir * (curSL - p.entry) > 0.25 * p.riskDist) ? 2 : 1;
      p.session = g_clock.SessionAt(p.openTime);
      p.recovered = true;
      return true;
     }

   void              Recover(const string why)
     {
      stateCoherent = false;
      if(!Connected())
        {
         needResync = true;
         return;
        }
      int adopted = 0;
      int reconstructed = 0;
      //--- 1. positions réelles de l'EA sur le serveur
      for(int i = PositionsTotal() - 1; i >= 0; i--)
        {
         ulong t = PositionGetTicket(i);
         if(t == 0)
            continue;
         if((ulong)PositionGetInteger(POSITION_MAGIC) != (ulong)InpMagic || PositionGetString(POSITION_SYMBOL) != g_sym.name)
            continue;
         if(g_pm.Find(t) >= 0)
            continue;
         SPlan p;
         if(PlanLoad(t, p))
           {
            long ptype = PositionGetInteger(POSITION_TYPE);
            int sdir = (ptype == POSITION_TYPE_BUY) ? GLS_BUY : GLS_SELL;
            if(sdir != p.dir)
              {
               g_log.Warn("REPRISE", StringFormat("#%I64u : plan mémorisé incohérent (sens), reconstruction", t));
               ReconstructPlan(t, p);
               reconstructed++;
              }
            else
               adopted++;
           }
         else
           {
            ReconstructPlan(t, p);
            reconstructed++;
            g_log.Warn("REPRISE", StringFormat("#%I64u : plan absent, reconstruit depuis le serveur (R %s)", t,
                                               p.riskDist > 0.0 ? DoubleToString(p.riskDist, g_sym.digits) : "inconnu"));
           }
         p.alive = true;
         g_pm.Add(p);
        }
      //--- 2. plans dont la position n'existe plus (fermée pendant l'arrêt)
      for(int i = 0; i < g_pm.Count(); i++)
         if(!PositionSelectByTicket(g_pm.plans[i].ticket))
            g_pm.plans[i].alive = false;
      ulong stored[];
      int ns = g_store.StoredTickets(stored);
      for(int i = 0; i < ns; i++)
        {
         if(g_pm.Find(stored[i]) >= 0 || PositionSelectByTicket(stored[i]))
            continue;
         SPlan p;
         if(PlanLoad(stored[i], p))
           {
            p.alive = false;
            int n = ArraySize(g_pm.plans);
            ArrayResize(g_pm.plans, n + 1);
            g_pm.plans[n] = p;
           }
         else
            g_store.PosDeleteAll(stored[i]);
        }
      //--- 3. ordres en attente portant le magic (l'EA n'en place pas : signalés)
      pendingOrders = 0;
      for(int i = OrdersTotal() - 1; i >= 0; i--)
        {
         ulong o = OrderGetTicket(i);
         if(o > 0 && (ulong)OrderGetInteger(ORDER_MAGIC) == (ulong)InpMagic && OrderGetString(ORDER_SYMBOL) == g_sym.name)
            pendingOrders++;
        }
      if(pendingOrders > 0)
         g_log.Warn("REPRISE", StringFormat("%d ordre(s) en attente portant le magic de l'EA : non gérés, à vérifier manuellement", pendingOrders));
      //--- 4. statistiques et compteurs du jour depuis l'historique
      RebuildStats();
      g_pm.FinalizeClosed(env, account);
      RefreshProtection(TimeCurrent());
      g_guard.EnsureDayEquity(AccountInfoDouble(ACCOUNT_EQUITY));
      g_store.Flush();
      needResync = false;
      stateCoherent = true;
      g_log.Info("REPRISE", StringFormat("%s : %d position(s) reprise(s), %d reconstruite(s), %d trade(s) en statistiques", why, adopted, reconstructed, g_stats.total));
     }

   void              RebuildStats(void)
     {
      datetime from = (InpStatsHistoryDays > 0) ? TimeCurrent() - InpStatsHistoryDays * 86400 : 0;
      long ids[];
      int entriesToday = 0;
      CollectEaPositionIds(from, (ulong)InpMagic, ids, entriesToday, g_guard.dayStart);
      //--- les valeurs exactes déjà connues en mémoire (risque du plan, MFE/MAE, raison de sortie...)
      //--- sont conservées ; l'historique seul ne les contient pas toutes
      STradeRecord known[];
      int nk = ArraySize(g_stats.trades);
      ArrayResize(known, nk);
      for(int k = 0; k < nk; k++)
         known[k] = g_stats.trades[k];
      g_stats.Clear();
      g_stats.sourceLabel = env + " compte " + IntegerToString(account);
      double commSum = 0.0;
      double lotSides = 0.0;
      for(int i = 0; i < ArraySize(ids); i++)
        {
         if(PositionSelectByTicket((ulong)ids[i]))
            continue;   // encore ouverte
         STradeRecord rec;
         if(!BuildRecordFromHistory(ids[i], rec) || !rec.complete)
            continue;
         commSum += MathAbs(rec.commission);
         lotSides += 2.0 * rec.volume;
         int kidx = -1;
         for(int k = 0; k < nk; k++)
            if(known[k].posId == ids[i])
              {
               kidx = k;
               break;
              }
         if(kidx >= 0)
           {
            //--- résultat relu sur le serveur, informations de gestion conservées
            known[kidx].net = rec.net;
            known[kidx].gross = rec.gross;
            known[kidx].commission = rec.commission;
            known[kidx].swap = rec.swap;
            known[kidx].fee = rec.fee;
            known[kidx].closeTime = rec.closeTime;
            known[kidx].rMultiple = (known[kidx].riskMoney > 0.0) ? rec.net / known[kidx].riskMoney : 0.0;
            g_stats.Add(known[kidx]);
            continue;
           }
         SPlan p;
         bool hasPlan = PlanLoad((ulong)ids[i], p);
         if(hasPlan)
           {
            rec.riskMoney = p.riskMoney;
            rec.riskDist = p.riskDist;
            rec.exitPlan = p.exitPlan;
            rec.mfeR = p.mfeR;
            rec.maeR = p.maeR;
           }
         //--- sinon : risque estimé depuis le commentaire d'entrée (BuildRecordFromHistory)
         rec.rMultiple = (rec.riskMoney > 0.0) ? rec.net / rec.riskMoney : 0.0;
         rec.session = g_clock.SessionAt(rec.openTime);
         rec.exitReason = (hasPlan && p.exitReason > 0) ? p.exitReason : ExitReasonFromHistory(rec, hasPlan ? p.slStage : -1);
         g_stats.Add(rec);
        }
      g_stats.Compute();
      g_stats.learnedCommissionPerLotSide = (lotSides > 0.0) ? commSum / lotSides : 0.0;
      g_commissionPerLotSide = MathMax(InpCommissionPerLotSide, g_stats.learnedCommissionPerLotSide);
      int w = 0;
      int l = 0;
      double net = 0.0;
      int consec = 0;
      g_stats.DayFigures(g_guard.dayStart, w, l, net, consec);
      if(!InpConsecLossesDaily)
         consec = g_stats.CurrentLossStreak();
      g_guard.SetDayFigures(entriesToday, w, l, net, consec);
     }

   //--- Exposition et protections
   void              RefreshProtection(const datetime now)
     {
      double floating = 0.0;
      double worst = 0.0;
      double bv = 0.0;
      double sv = 0.0;
      g_pm.Exposure(floating, worst, bv, sv);
      g_guard.SetOpenExposure(floating, worst);
      int w = 0;
      int l = 0;
      double net = 0.0;
      int consec = 0;
      g_stats.DayFigures(g_guard.dayStart, w, l, net, consec);
      if(!InpConsecLossesDaily)
         consec = g_stats.CurrentLossStreak();
      g_guard.SetDayFigures(g_guard.tradesToday, w, l, net, consec);
      g_guard.Evaluate(AccountInfoDouble(ACCOUNT_EQUITY));
      if(g_guard.dailyLossHit && InpCloseOnDailyLimit && g_pm.AliveCount() > 0)
        {
         int closed = 0;
         int failed = g_pm.CloseAll(GLS_EXIT_DAILY_LIMIT, now, closed);
         g_log.Warn("PROTECTION", StringFormat("limite journalière : %d position(s) fermée(s), %d échec(s)", closed, failed));
        }
     }

   //+---------------------------------------------------------------+
   //| Contrôles avant toute nouvelle entrée                          |
   //+---------------------------------------------------------------+
   int               PreEntryChecks(const MqlTick &tick, const datetime now, string &detail)
     {
      detail = "";
      if(!symbolOk)
         return GLS_REFUSE_SYMBOL;
      if(!stateCoherent || needResync)
         return GLS_REFUSE_STATE;
      if(!Connected())
         return GLS_REFUSE_CONNECTION;
      if(!tester && m_reconnectAtTick != 0 && (int)(GetTickCount() - (uint)m_reconnectAtTick) < InpReconnectGraceSec * 1000)
        {
         detail = "délai de stabilisation après reconnexion";
         return GLS_REFUSE_CONNECTION;
        }
      string why = "";
      if(!AlgoAllowed(why))
        {
         detail = why;
         return GLS_REFUSE_TRADE_DISABLED;
        }
      if(g_sym.tradeMode != SYMBOL_TRADE_MODE_FULL && g_sym.tradeMode != SYMBOL_TRADE_MODE_LONGONLY && g_sym.tradeMode != SYMBOL_TRADE_MODE_SHORTONLY)
        {
         detail = "mode du symbole : " + g_sym.TradeModeText();
         return GLS_REFUSE_TRADE_DISABLED;
        }
      if(!g_ctx.ready)
        {
         detail = g_ctx.error;
         return GLS_REFUSE_DATA;
        }
      if(!g_ctx.IsFresh(now, 150) || now - tick.time > InpMaxTickAgeSec || tick.bid <= 0.0 || tick.ask <= tick.bid)
        {
         detail = "cotation ou barres obsolètes / incohérentes";
         return GLS_REFUSE_DATA;
        }
      if(g_ctx.dataGap)
        {
         detail = g_ctx.dataGapText;
         return GLS_REFUSE_DATA;
        }
      int minsToClose = 0;
      if(!BrokerSessionOpen(g_sym.name, now, minsToClose))
        {
         detail = "séance du courtier fermée";
         return GLS_REFUSE_SESSION;
        }
      if(minsToClose < InpMinMinutesBeforeClose)
        {
         detail = StringFormat("fin de séance dans %d min", minsToClose);
         return GLS_REFUSE_SESSION;
        }
      if(!g_clock.EntryWindowOpen(now))
         return GLS_REFUSE_SESSION;
      datetime utc = g_clock.ServerToUtc(now);
      if(InpFridayNoEntryHourUTC >= 0 && GlsDayOfWeek(utc) == 5 && MinuteOfDay(utc) >= InpFridayNoEntryHourUTC * 60)
        {
         detail = "vendredi après l'heure limite";
         return GLS_REFUSE_SESSION;
        }
      if(InpNewsMode == GLS_NEWS_REQUIRED && !g_news.Reliable())
        {
         detail = "aucune source d'annonces fiable";
         return GLS_REFUSE_NEWS;
        }
      string label = "";
      if(InpNewsMode != GLS_NEWS_OFF && g_news.InBlackout(now, label))
        {
         detail = label;
         return GLS_REFUSE_NEWS;
        }
      int g = g_guard.EntryBlockReason(now);
      if(g != GLS_REFUSE_NONE)
        {
         if(g == GLS_REFUSE_COOLDOWN)
            detail = g_guard.cooldownReason;
         return g;
        }
      if(g_pm.AliveCount() >= InpMaxOpenPositions)
         return GLS_REFUSE_MAX_POSITIONS;
      //--- exposition d'autres sources sur l'or / mode netting
      bool netting = (AccountInfoInteger(ACCOUNT_MARGIN_MODE) != ACCOUNT_MARGIN_MODE_RETAIL_HEDGING);
      for(int i = PositionsTotal() - 1; i >= 0; i--)
        {
         ulong t = PositionGetTicket(i);
         if(t == 0)
            continue;
         string ps = PositionGetString(POSITION_SYMBOL);
         bool ours = ((ulong)PositionGetInteger(POSITION_MAGIC) == (ulong)InpMagic && ps == g_sym.name);
         if(ours)
            continue;
         if(netting && ps == g_sym.name)
           {
            detail = "compte netting avec une position non gérée sur le symbole";
            return GLS_REFUSE_EXPOSURE;
           }
         if(InpBlockOtherGoldExposure && StringFind(SymbolInfoString(ps, SYMBOL_CURRENCY_BASE), "XAU") == 0)
           {
            detail = "position or d'une autre source (" + ps + ")";
            return GLS_REFUSE_EXPOSURE;
           }
        }
      //--- spread : absolu, relatif à l'ATR, anomalie par rapport à la médiane
      double spread = tick.ask - tick.bid;
      double maxSpread = MaxSpreadPrice();
      if(spread > maxSpread)
        {
         detail = StringFormat("%s > %s", DoubleToString(spread, g_sym.digits), DoubleToString(maxSpread, g_sym.digits));
         return GLS_REFUSE_SPREAD;
        }
      double med = MedianSpread();
      if(med > 0.0 && InpSpreadSpikeMult > 0.0 && spread > InpSpreadSpikeMult * med)
        {
         detail = StringFormat("pic de spread x%.1f la médiane", spread / med);
         return GLS_REFUSE_SPREAD;
        }
      //--- volatilité
      double atr = g_ctx.Atr();
      double atrL = g_ctx.AtrLong();
      double ratio = SafeDiv(atr, atrL, 0.0);
      if(atr <= 0.0 || atrL <= 0.0 || ratio < InpMinATRRatio || ratio > InpMaxATRRatio)
        {
         detail = StringFormat("ATR14/ATR100 = %.2f", ratio);
         return GLS_REFUSE_VOLATILITY;
        }
      if(atr < InpMinATRToSpread * spread)
        {
         detail = "ATR trop faible par rapport au spread";
         return GLS_REFUSE_VOLATILITY;
        }
      return GLS_REFUSE_NONE;
     }

   //+---------------------------------------------------------------+
   //| Recherche et exécution d'une entrée (à chaque nouvelle barre)  |
   //+---------------------------------------------------------------+
   void              LogSignal(const SSignal &s, const string decision, const bool counted = true)
     {
      if(s.stage < 2)
         return;
      if(counted)
        {
         if(decision == "EXECUTE")
            sigExecuted++;
         else
            sigRejected++;
        }
      if(!g_log.FilesEnabled())
         return;
      string h = "time;family;dir;id;score;c_liq;c_trig;c_struct;c_align;c_retest;c_vol;c_cost;c_rr;room_r;risk_price;cost_frac;stop;level;decision;reason;detail;";
      h += "c_candle;candle;regime;trend_m15;trend_m5;label;criteria;zone_id;zone_tf;zone_retests;zone_quality;zone_fill";
      //--- le séparateur du CSV ne doit jamais apparaître dans un texte libre
      string detail = s.detail;
      string criteria = s.criteria;
      StringReplace(detail, ";", ",");
      StringReplace(criteria, ";", ",");
      string row = TimeToString(s.triggerTime, TIME_DATE | TIME_MINUTES) + ";" + GlsFamilyCode(s.family) + ";" + (s.dir == GLS_BUY ? "BUY" : "SELL") + ";"
                   + s.hash + ";" + DoubleToString(s.score, 1) + ";" + DoubleToString(s.cLiq, 2) + ";" + DoubleToString(s.cTrig, 2) + ";"
                   + DoubleToString(s.cStruct, 2) + ";" + DoubleToString(s.cAlign, 2) + ";" + DoubleToString(s.cRetest, 2) + ";"
                   + DoubleToString(s.cVol, 2) + ";" + DoubleToString(s.cCost, 2) + ";" + DoubleToString(s.cRR, 2) + ";"
                   + DoubleToString(s.roomR, 2) + ";" + DoubleToString(s.riskDist, g_sym.digits) + ";" + DoubleToString(s.costFrac, 3) + ";"
                   + DoubleToString(s.stop, g_sym.digits) + ";" + DoubleToString(s.level, g_sym.digits) + ";" + decision + ";"
                   + GlsRefusalText(s.refusal) + ";" + detail + ";" + DoubleToString(s.cCandle, 2) + ";" + s.candleName + ";"
                   + RegimeCode(s.regime) + ";" + TrendClassText(s.trend15) + ";" + TrendClassText(s.trend5) + ";" + InpRunLabel + ";" + criteria
                   + ";" + s.zoneId + ";" + ((s.zoneTf > 0) ? "M" + IntegerToString(s.zoneTf) : "") + ";" + IntegerToString(s.zoneRetests) + ";"
                   + DoubleToString(s.zoneQuality, 2) + ";" + DoubleToString(100.0 * s.zoneFill, 0);
      g_log.WriteSignalRow(h, row);
     }

   //--- Zones (F6) en attente de réaction ou refusées : une ligne par changement d'état de chaque zone
   //--- (décision ATTENTE ou REFUS, motif précis, confirmations présentes / absentes dans le détail)
   void              LogZoneDecisions(void)
     {
      for(int i = 0; i < ArraySize(g_zoneDecisions.items); i++)
        {
         SSignal z = g_zoneDecisions.items[i];
         string key = z.zoneId + "|" + IntegerToString(z.dir);
         int k = FindKey(m_zdKeys, key);
         int state = z.refusal * 1000 + MathMin(z.zoneRetests, 999);
         if(k >= 0 && m_zdState[k] == state)
            continue;
         if(k < 0)
            k = AddKey(m_zdKeys, m_zdState, key);
         m_zdState[k] = state;
         z.triggerTime = (g_ctx.m1.count > 0) ? g_ctx.m1.time[g_ctx.m1.count - 1] : 0;
         z.stage = 2;   // ligne de journal complète (le signal reste NON déclenché)
         z.regime = g_ctx.regime;
         z.trend15 = g_ctx.t15.cls;
         z.trend5 = g_ctx.t5.cls;
         LogSignal(z, (z.refusal == GLS_REFUSE_INCOMPLETE) ? "ATTENTE" : "REFUS", false);
        }
     }

   void              EvaluateEntry(const MqlTick &tick, const datetime now)
     {
      string detail = "";
      int block = PreEntryChecks(tick, now, detail);
      if(!g_ctx.ready)
        {
         SetRefusal(block, detail, now);
         return;
        }
      CDirView vb;
      CDirView vs;
      vb.Build(g_ctx, GLS_BUY);
      vs.Build(g_ctx, GLS_SELL);
      SSignal sb;
      SSignal ss;
      g_zoneDecisions.Clear();
      DetectFamily(InpFamily, g_ctx, vb, sb);
      DetectFamily(InpFamily, g_ctx, vs, ss);
      LogZoneDecisions();
      double valuePerPrice = (g_sym.tickSize > 0.0) ? g_sym.tickValue / g_sym.tickSize : 0.0;
      double commPrice = (valuePerPrice > 0.0) ? 2.0 * g_commissionPerLotSide / valuePerPrice : 0.0;
      double extra = commPrice + SlippageAllowance();
      FinalizeSignal(sb, g_ctx, vb, tick.bid, tick.ask, extra, now);
      FinalizeSignal(ss, g_ctx, vs, tick.bid, tick.ask, extra, now);

      //--- signaux contradictoires simultanés : aucun n'est pris
      if(sb.valid && ss.valid)
        {
         sb.refusal = GLS_REFUSE_CONTEXT;
         ss.refusal = GLS_REFUSE_CONTEXT;
         lastSignalText = "achat ET vente simultanés : ignorés";
         SetRefusal(GLS_REFUSE_CONTEXT, "signaux contradictoires", now);
         LogSignal(sb, "REFUS");
         LogSignal(ss, "REFUS");
         return;
        }
      SSignal sig;
      if(sb.valid)
         sig = sb;
      else
         if(ss.valid)
            sig = ss;
         else
            if(sb.stage >= ss.stage)
               sig = sb;
            else
               sig = ss;

      if(!sig.valid)
        {
         if(sig.stage > 0)
            lastSignalText = TimeToString(now, TIME_MINUTES) + " " + SignalShortText(sig);
         SetRefusal(block != GLS_REFUSE_NONE ? block : (sig.stage > 0 ? sig.refusal : GLS_REFUSE_NO_SETUP), block != GLS_REFUSE_NONE ? detail : "", now);
         return;
        }
      lastSignalText = TimeToString(now, TIME_MINUTES) + " " + SignalShortText(sig);

      //--- priorité aux protections et conditions de marché
      if(block != GLS_REFUSE_NONE)
        {
         sig.refusal = block;
         sig.detail = detail + " | " + sig.detail;
        }
      if(sig.refusal == GLS_REFUSE_NONE && sig.triggerTime + 60 <= startedAt)
         sig.refusal = GLS_REFUSE_STALE_SIGNAL;
      if(sig.refusal == GLS_REFUSE_NONE && SignalUsed(sig.id))
         sig.refusal = GLS_REFUSE_DUPLICATE;
      if(sig.refusal == GLS_REFUSE_NONE && !g_sym.TradeModeAllows(sig.dir))
         sig.refusal = GLS_REFUSE_TRADE_DISABLED;
      if(sig.refusal == GLS_REFUSE_NONE)
        {
         for(int i = 0; i < g_pm.Count(); i++)
            if(g_pm.plans[i].alive && g_pm.plans[i].dir == -sig.dir)
              {
               sig.refusal = GLS_REFUSE_EXPOSURE;   // jamais de position opposée pour masquer une perte
               break;
              }
        }
      if(sig.refusal != GLS_REFUSE_NONE)
        {
         SetRefusal(sig.refusal, (block != GLS_REFUSE_NONE) ? detail : "", now);
         LogSignal(sig, "REFUS");
         g_log.Debug("SIGNAL", "refusé : " + GlsRefusalText(sig.refusal) + " | " + SignalShortText(sig));
         return;
        }
      Execute(sig, tick, now);
     }

   void              Execute(SSignal &sig, const MqlTick &tick, const datetime now)
     {
      double equity = AccountInfoDouble(ACCOUNT_EQUITY);
      double freeMargin = AccountInfoDouble(ACCOUNT_MARGIN_FREE);
      RefreshProtection(now);
      double budget = g_guard.RiskBudgetMoney(equity);
      double floating = 0.0;
      double worst = 0.0;
      double bv = 0.0;
      double sv = 0.0;
      g_pm.Exposure(floating, worst, bv, sv);
      SSizing sz;
      if(!ComputeVolume(sig.dir, sig.entryPrice, sig.stop, equity, freeMargin, budget, g_commissionPerLotSide, sig.dir == GLS_BUY ? bv : sv, sz))
        {
         sig.refusal = sz.refusal;
         SetRefusal(sz.refusal, sz.detail, now);
         LogSignal(sig, "REFUS");
         g_log.Info("RISQUE", "entrée refusée : " + GlsRefusalText(sz.refusal) + " - " + sz.detail);
         return;
        }
      int plan = GLS_EXITPLAN_SINGLE;
      double v1 = 0.0;
      double v2 = 0.0;
      PlanExitParts(sz.volume, plan, v1, v2);
      double finalR = (plan == GLS_EXITPLAN_SINGLE) ? InpSingleTargetR : InpTP3R;
      double tp = g_sym.NormalizePrice(sig.entryPrice + (double)sig.dir * finalR * sig.riskDist);
      int riskPts = g_sym.PriceToPoints(sig.riskDist);
      string comment = BuildEntryComment(sig.family, sig.dir, sig.retestEntry, sig.score, sig.hash) + " " + IntegerToString(riskPts);
      double spread = tick.ask - tick.bid;
      SOpenResult res;
      g_log.Info("ORDRE", StringFormat("%s %s %s lot, stop %s, objectif %s (%.1fR), risque %.2f (%.2f %%), score %.0f",
                                       GlsFamilyCode(sig.family), GlsDirText(sig.dir), DoubleToString(sz.volume, g_sym.volDigits),
                                       DoubleToString(sig.stop, g_sym.digits), DoubleToString(tp, g_sym.digits), finalR, sz.riskMoney, sz.riskPct, sig.score));
      bool ok = g_trader.OpenMarket(sig.dir, sz.volume, sig.stop, tp, comment, MaxSpreadPrice(), res);
      if(!ok)
        {
         if(res.uncertain)
           {
            MarkSignalUsed(sig.id);   // par prudence : jamais de second envoi pour ce signal
            needResync = true;
            stateCoherent = false;
           }
         if(res.retcode != 0 || res.uncertain)
            g_guard.OnExecError(now, res.message);
         sig.refusal = GLS_REFUSE_EXEC_ERROR;
         lastExecText = TimeToString(now, TIME_MINUTES) + " ÉCHEC : " + res.message;
         SetRefusal(GLS_REFUSE_EXEC_ERROR, res.message, now);
         LogSignal(sig, "ECHEC");
         g_log.Error("ORDRE", res.message);
         return;
        }
      g_guard.OnExecSuccess();
      MarkSignalUsed(sig.id);
      g_guard.tradesToday++;
      //--- qualité d'exécution : glissement mesuré, réinjecté dans l'estimation des coûts
      g_exec.RecordFill((double)sig.dir * (res.fillPrice - res.requestedPrice), g_sym.point, spread);
      g_observedSlippage = g_exec.ExpectedAdverseSlippage();

      //--- plan de position à partir de l'exécution RÉELLE
      SPlan p;
      PlanReset(p);
      p.ticket = res.ticket;
      p.posId = res.positionId;
      p.dir = sig.dir;
      p.family = sig.family;
      p.entry = res.fillPrice;
      p.initialSL = (res.slOnServer > 0.0) ? res.slOnServer : sig.stop;
      p.initialVolume = res.fillVolume;
      p.riskDist = (double)p.dir * (p.entry - p.initialSL);
      p.hashNum = (double)HashString(sig.id);
      p.score = sig.score;
      p.retest = sig.retestEntry;
      p.openTime = PositionSelectByTicket(res.ticket) ? (datetime)PositionGetInteger(POSITION_TIME) : now;
      p.session = g_clock.SessionAt(now);
      p.requestedPrice = res.requestedPrice;
      p.spreadAtEntry = spread;
      p.invalidation = sig.invalidation;
      PlanExitParts(p.initialVolume, p.exitPlan, p.v1, p.v2);
      p.tp1R = InpTP1R;
      p.tp2R = InpTP2R;
      p.finalR = (p.exitPlan == GLS_EXITPLAN_SINGLE) ? InpSingleTargetR : InpTP3R;
      double perLot = 0.0;
      string det = "";
      if(p.riskDist > 0.0 && LossPerLot(p.dir, p.entry, p.initialSL, perLot, det))
         p.riskMoney = perLot * p.initialVolume + 2.0 * g_commissionPerLotSide * p.initialVolume;
      double valuePerPrice = (g_sym.tickSize > 0.0) ? g_sym.tickValue / g_sym.tickSize : 0.0;
      p.estCost = spread * valuePerPrice * p.initialVolume + 2.0 * g_commissionPerLotSide * p.initialVolume;
      p.regime = sig.regime;
      p.candleId = sig.candleId;
      p.zoneTf = (StringLen(sig.zoneId) > 0) ? sig.zoneTf : 0;
      p.zoneTime = sig.zoneTime;
      p.zoneInv = (StringFind(sig.zoneId, "|I") >= 0);
      p.zoneRetests = sig.zoneRetests;
      p.zoneQuality = sig.zoneQuality;
      g_pm.Add(p);
      int idx = g_pm.Find(p.ticket);

      lastExecText = StringFormat("%s %s %s %s lot @ %s (glissement %.0f pts)", TimeToString(now, TIME_MINUTES), GlsFamilyCode(p.family),
                                  GlsDirText(p.dir), DoubleToString(p.initialVolume, g_sym.volDigits), DoubleToString(p.entry, g_sym.digits),
                                  (g_sym.point > 0.0) ? (double)p.dir * (p.entry - p.requestedPrice) / g_sym.point : 0.0);
      g_log.Info("ORDRE", "exécuté : " + lastExecText + " | plan " + ExitPlanText(p.exitPlan) + " | " + sig.detail);
      LogSignal(sig, "EXECUTE");

      //--- contrôles immédiats : stop réellement accepté, risque réel cohérent
      if(idx >= 0)
        {
         if(res.slOnServer <= 0.0)
           {
            g_log.Warn("PROTECTION", StringFormat("#%I64u : stop absent après exécution, pose immédiate", p.ticket));
            g_pm.EnsureProtection(g_pm.plans[idx], tick.bid, tick.ask, now);
           }
         else
            if(p.riskDist <= 0.0)
              {
               g_log.Critical("PROTECTION", StringFormat("#%I64u : exécution au-delà du stop, fermeture", p.ticket));
               g_pm.CloseFor(g_pm.plans[idx], GLS_EXIT_RISK_EXCESS, now);
              }
            else
              {
               //--- objectif final recalé sur le prix réellement obtenu (même nombre de R)
               double tpReal = g_sym.NormalizePrice(p.entry + (double)p.dir * p.finalR * p.riskDist);
               if(MathAbs(tpReal - res.tpOnServer) > g_sym.tickSize)
                 {
                  string msg = "";
                  if(!g_trader.ModifyStops(p.ticket, res.slOnServer, tpReal, msg))
                     g_log.Warn("ORDRE", "recalage de l'objectif final impossible : " + msg);
                 }
              }
        }
      g_store.Flush();
     }

   //+---------------------------------------------------------------+
   //| Événements                                                     |
   //+---------------------------------------------------------------+
   void              MonitorConnection(void)
     {
      if(tester)
         return;
      bool c = Connected();
      if(!c && m_wasConnected)
        {
         g_log.Warn("CONNEXION", "connexion au serveur perdue : nouvelles entrées suspendues");
         g_alerts.Notify(GLS_ALERT_CONNECTION, "conn_lost", "connexion au serveur perdue (entrées suspendues)");
         needResync = true;
         stateCoherent = false;
        }
      if(c && !m_wasConnected)
        {
         g_log.Info("CONNEXION", "connexion rétablie : contrôle de l'état réel avant reprise");
         g_alerts.Notify(GLS_ALERT_CONNECTION, "conn_back", "connexion rétablie (état relu avant reprise)");
         m_reconnectAtTick = (int)GetTickCount();
         needResync = true;
        }
      m_wasConnected = c;
     }

   void              OnTick(void)
     {
      if(!symbolOk)
         return;
      MqlTick tick = {};
      if(!SymbolInfoTick(g_sym.name, tick) || tick.bid <= 0.0 || tick.ask < tick.bid)
         return;
      datetime now = TimeCurrent();
      RecordSpread(tick.ask - tick.bid);
      MonitorConnection();
      if(needResync && Connected())
         Recover("resynchronisation");
      g_pm.OnTick(tick.bid, tick.ask, now);

      datetime bar0 = iTime(g_sym.name, PERIOD_M1, 0);
      if(bar0 != 0 && bar0 != m_lastBarTime)
        {
         m_lastBarTime = bar0;
         OnNewBar(tick, now);
        }
     }

   void              OnNewBar(const MqlTick &tick, const datetime now)
     {
      g_clock.Update(now);
      if(g_guard.CheckRollover(now, AccountInfoDouble(ACCOUNT_EQUITY)))
        {
         g_log.Info("JOUR", "nouvelle journée de trading : compteurs journaliers réinitialisés");
         cdlDetected = 0;
         cdlConfirmed = 0;
         sigRejected = 0;
         sigExecuted = 0;
         fvgDetected = 0;
         fvgQualified = 0;
         fvgRetested = 0;
         fvgInvalidated = 0;
         RebuildStats();
        }
      bool ok = g_ctx.Update(g_sym.name, now, g_clock, InpEMAPeriodM5, InpM5SwingStrength, InpM15SwingStrength, InpTrendERMin, InpTransitionBars,
                             tick.ask - tick.bid);
      if(!ok)
         g_log.Debug("DONNEES", g_ctx.error);
      else
         LogAnalysis();
      lastSession = g_clock.SessionAt(now);
      g_pm.OnBar(g_ctx, tick.bid, tick.ask, now);
      g_pm.FinalizeClosed(env, account);
      RefreshProtection(now);
      //--- fermeture avant le week-end (règle de protection explicite)
      datetime utc = g_clock.ServerToUtc(now);
      if(InpFridayCloseHourUTC >= 0 && GlsDayOfWeek(utc) == 5 && MinuteOfDay(utc) >= InpFridayCloseHourUTC * 60 && g_pm.AliveCount() > 0)
        {
         int closed = 0;
         int failed = g_pm.CloseAll(GLS_EXIT_WEEKEND, now, closed);
         g_log.Info("PROTECTION", StringFormat("clôture avant week-end : %d fermée(s), %d échec(s)", closed, failed));
        }
      if(running)
         EvaluateEntry(tick, now);
      else
         SetRefusal(GLS_REFUSE_STOPPED, "", now);
     }

   void              OnTimer(void)
     {
      datetime now = TimeCurrent();
      MonitorConnection();
      if(symbolOk && needResync && Connected())
         Recover("resynchronisation");
      if(symbolOk && now - m_lastFinalize >= 2)
        {
         m_lastFinalize = now;
         g_pm.FinalizeClosed(env, account);
        }
      if(symbolOk && now - m_lastReconcile >= 15)
        {
         m_lastReconcile = now;
         Reconcile();
         g_news.Refresh(now, InpNewsMode, InpNewsCurrency, InpNewsFile, InpNewsMinutesBefore, InpNewsMinutesAfter, g_clock, false);
         if(g_guard.CheckRollover(now, AccountInfoDouble(ACCOUNT_EQUITY)))
            RebuildStats();
         RefreshProtection(now);
        }
      if(g_dash.Created())
         UpdateDashboard();
     }

   //+---------------------------------------------------------------+
   //| Journal des analyses : figures de bougies et FVG              |
   //| (une ligne à la détection, puis à chaque changement d'état)   |
   //+---------------------------------------------------------------+
   int               FindKey(const string &keys[], const string key) const
     {
      for(int i = ArraySize(keys) - 1; i >= 0; i--)
         if(keys[i] == key)
            return i;
      return -1;
     }

   int               AddKey(string &keys[], int &states[], const string key)
     {
      int n = ArraySize(keys);
      if(n >= 600)
        {
         //--- mémoire bornée : on oublie les 100 plus anciennes (déjà journalisées)
         for(int i = 100; i < n; i++)
           {
            keys[i - 100] = keys[i];
            states[i - 100] = states[i];
           }
         n -= 100;
        }
      ArrayResize(keys, n + 1);
      ArrayResize(states, n + 1);
      keys[n] = key;
      states[n] = -1;
      return n;
     }

   void              LogCandles(const CCandleAnalysis &ca)
     {
      for(int i = 0; i < ArraySize(ca.pats); i++)
        {
         //--- par défaut : seules les figures ORIENTÉES et interprétables dans leur contexte sont suivies
         bool main = (ca.pats[i].dir != 0 && ca.pats[i].interpretable);
         if(!main && InpLogCandles != GLS_LOGD_ALL)
            continue;
         string key = CandleCode(ca.pats[i].id) + "|" + IntegerToString(ca.pats[i].dir) + "|" + IntegerToString((long)ca.pats[i].time);
         int st = ca.pats[i].status;
         int k = FindKey(m_cdlKeys, key);
         if(k >= 0 && m_cdlState[k] == st)
            continue;
         if(k < 0)
           {
            k = AddKey(m_cdlKeys, m_cdlState, key);
            if(main)
               cdlDetected++;
           }
         if(st == GLS_CDLST_CONFIRMED && main)
            cdlConfirmed++;
         m_cdlState[k] = st;
         string name = CandleName(ca.pats[i].id, ca.pats[i].dir);
         if(main)
            lastCandleText = TimeToString(ca.pats[i].time, TIME_MINUTES) + " " + name + " (" + CandleStatusText(st) + ")";
         bool finalState = (st == GLS_CDLST_CONFIRMED || st == GLS_CDLST_INVALIDATED || st == GLS_CDLST_EXPIRED);
         if(!g_log.FilesEnabled() || InpLogCandles == GLS_LOGD_NONE || (InpLogCandles == GLS_LOGD_MAIN && !finalState))
            continue;
         SCandle c;
         CandleMetrics(g_ctx.m1, g_ctx.atr, ca.pats[i].bar, c);
         double lo = (ca.viewDir == GLS_BUY) ? ca.pats[i].low : -ca.pats[i].high;
         double hi = (ca.viewDir == GLS_BUY) ? ca.pats[i].high : -ca.pats[i].low;
         string h = "heure;ut;figure;code;sens;categorie;statut;force;contexte_ok;pres_zone;obstacle;bruit_spread;tendance;interpretable;";
         h += "corps_ratio;meche_sup_ratio;meche_inf_ratio;meche_sup_corps;meche_inf_corps;position_cloture;amplitude_atr;taille_relative;";
         h += "casse_haut_prec;casse_bas_prec;bas;haut;spread;label";
         string row = TimeToString(ca.pats[i].time, TIME_DATE | TIME_MINUTES) + ";M1;" + name + ";" + CandleCode(ca.pats[i].id) + ";"
                      + IntegerToString(ca.pats[i].dir) + ";" + IntegerToString(ca.pats[i].category) + ";" + CandleStatusText(st) + ";"
                      + DoubleToString(ca.pats[i].strength, 2) + ";" + (ca.pats[i].contextOk ? "1" : "0") + ";" + (ca.pats[i].nearZone ? "1" : "0") + ";"
                      + (ca.pats[i].obstacle ? "1" : "0") + ";" + (ca.pats[i].noisy ? "1" : "0") + ";" + IntegerToString(ca.pats[i].trendAlign) + ";"
                      + (ca.pats[i].interpretable ? "1" : "0") + ";" + DoubleToString(c.bodyRatio, 2) + ";" + DoubleToString(c.upperRatio, 2) + ";"
                      + DoubleToString(c.lowerRatio, 2) + ";" + DoubleToString(c.upperToBody, 2) + ";" + DoubleToString(c.lowerToBody, 2) + ";"
                      + DoubleToString(c.closeLoc, 2) + ";" + DoubleToString(c.rangeAtr, 2) + ";" + DoubleToString(c.relSize, 2) + ";"
                      + (c.breaksPrevHigh ? "1" : "0") + ";" + (c.breaksPrevLow ? "1" : "0") + ";" + DoubleToString(lo, g_sym.digits) + ";"
                      + DoubleToString(hi, g_sym.digits) + ";" + DoubleToString(g_ctx.spreadNow, g_sym.digits) + ";" + InpRunLabel;
         g_log.WriteCandleRow(h, row);
        }
     }

   //--- Compteurs du jour des FVG de l'unité de trading (hors doublons) : détectées, qualifiées, revisitées, invalidées
   void              CountFvgs(const CFvgMap &m)
     {
      if(m.tfMin != (int)InpFvgTF)
         return;
      for(int i = 0; i < ArraySize(m.fvgs); i++)
        {
         if(m.fvgs[i].duplicate || m.fvgs[i].created < g_guard.dayStart)
            continue;
         string key = FvgKey(m.fvgs[i]);
         int k = FindKey(m_fvgCntKeys, key);
         if(k < 0)
           {
            k = AddKey(m_fvgCntKeys, m_fvgCntFlags, key);
            m_fvgCntFlags[k] = 0;
            fvgDetected++;
           }
         int f = m_fvgCntFlags[k];
         if((f & 1) == 0 && m.fvgs[i].quality >= InpFvgMinQuality)
           {
            f |= 1;
            fvgQualified++;
           }
         if((f & 2) == 0 && m.fvgs[i].retests >= 1)
           {
            f |= 2;
            fvgRetested++;
           }
         if((f & 4) == 0 && m.fvgs[i].status == GLS_FVG_INVALIDATED)
           {
            f |= 4;
            fvgInvalidated++;
           }
         m_fvgCntFlags[k] = f;
        }
     }

   void              LogFvgs(const CFvgMap &m)
     {
      if(InpLogFvg == GLS_LOGD_NONE || !g_log.FilesEnabled() || (InpLogFvg == GLS_LOGD_MAIN && m.tfMin != (int)InpFvgTF))
         return;
      for(int i = 0; i < ArraySize(m.fvgs); i++)
        {
         if(InpLogFvg == GLS_LOGD_MAIN && m.fvgs[i].duplicate)
            continue;   // même imbalance déjà suivie sur l'unité supérieure
         string key = FvgKey(m.fvgs[i]);
         //--- essentiel : création, 1er retour, comblement complet, invalidation ; tout : chaque retour / comblement partiel
         int state = 0;
         if(InpLogFvg == GLS_LOGD_ALL)
            state = m.fvgs[i].status * 1000 + MathMin(m.fvgs[i].retests, 999) + (m.fvgs[i].obConf ? 100000 : 0);
         else
            if(m.fvgs[i].status == GLS_FVG_FILLED || m.fvgs[i].status == GLS_FVG_INVALIDATED)
               state = 10 + m.fvgs[i].status;
            else
               state = (m.fvgs[i].retests >= 1) ? 1 : 0;
         int k = FindKey(m_fvgKeys, key);
         if(k >= 0 && m_fvgState[k] == state)
            continue;
         if(k < 0)
            k = AddKey(m_fvgKeys, m_fvgState, key);
         m_fvgState[k] = state;
         string h = "id;creation;ut;sens;bas;haut;taille_pts;taille_atr;deplacement_atr;corps_deplacement;deplacement;bos;choch;heure_cassure;balayage;";
         h += "dist_sr_atr;retours;comblement;statut;maj_statut;qualite;qualifiee;ifvg;doublon_de;ob_confluence;ob_meme_deplacement;ob_id;raison;label";
         string row = key + ";" + TimeToString(m.fvgs[i].created, TIME_DATE | TIME_MINUTES) + ";M" + IntegerToString(m.fvgs[i].tfMin) + ";"
                      + (m.fvgs[i].dir > 0 ? "HAUSSIER" : "BAISSIER") + ";" + DoubleToString(m.fvgs[i].lo, g_sym.digits) + ";"
                      + DoubleToString(m.fvgs[i].hi, g_sym.digits) + ";" + DoubleToString(m.fvgs[i].sizePts, 0) + ";" + DoubleToString(m.fvgs[i].sizeAtr, 2) + ";"
                      + DoubleToString(m.fvgs[i].dispAtr, 2) + ";" + DoubleToString(m.fvgs[i].dispBody, 2) + ";"
                      + TimeToString(m.fvgs[i].dispTime, TIME_DATE | TIME_MINUTES) + ";" + (m.fvgs[i].bos ? "1" : "0") + ";"
                      + (m.fvgs[i].choch ? "1" : "0") + ";" + (m.fvgs[i].bos ? TimeToString(m.fvgs[i].bosTime, TIME_DATE | TIME_MINUTES) : "") + ";"
                      + (m.fvgs[i].sweep ? "1" : "0") + ";" + DoubleToString(m.fvgs[i].ctxDistAtr, 2) + ";" + IntegerToString(m.fvgs[i].retests) + ";"
                      + DoubleToString(100.0 * m.fvgs[i].fillPct, 0) + ";" + FvgStatusText(m.fvgs[i].status) + ";"
                      + TimeToString(m.fvgs[i].statusTime, TIME_DATE | TIME_MINUTES) + ";" + DoubleToString(m.fvgs[i].quality, 2) + ";"
                      + (m.fvgs[i].quality >= InpFvgMinQuality ? "1" : "0") + ";" + (m.fvgs[i].inverted ? "1" : "0") + ";" + m.fvgs[i].parentKey + ";"
                      + (m.fvgs[i].obConf ? "1" : "0") + ";" + (m.fvgs[i].obSameDisp ? "1" : "0") + ";" + m.fvgs[i].obKey + ";"
                      + m.fvgs[i].reason + ";" + InpRunLabel;
         g_log.WriteFvgRow(h, row);
        }
     }

   //--- Order Blocks : création puis 1er retour / invalidation
   void              LogObs(const COrderBlockMap &m)
     {
      if(InpLogFvg == GLS_LOGD_NONE || !g_log.FilesEnabled())
         return;
      for(int i = 0; i < ArraySize(m.obs); i++)
        {
         string key = ObKey(m.obs[i]);
         int state = m.obs[i].status;
         int k = FindKey(m_obKeys, key);
         if(k >= 0 && m_obState[k] == state)
            continue;
         if(k < 0)
            k = AddKey(m_obKeys, m_obState, key);
         m_obState[k] = state;
         string h = "id;creation;ut;sens;bas;haut;bougie_ob;deplacement_debut;deplacement_fin;cassure;deplacement_atr;retours;statut;maj_statut;raison;label";
         string row = key + ";" + TimeToString(m.obs[i].created, TIME_DATE | TIME_MINUTES) + ";M" + IntegerToString(m.obs[i].tfMin) + ";"
                      + (m.obs[i].dir > 0 ? "HAUSSIER" : "BAISSIER") + ";" + DoubleToString(m.obs[i].lo, g_sym.digits) + ";"
                      + DoubleToString(m.obs[i].hi, g_sym.digits) + ";" + TimeToString(m.obs[i].obTime, TIME_DATE | TIME_MINUTES) + ";"
                      + TimeToString(m.obs[i].dispFrom, TIME_DATE | TIME_MINUTES) + ";" + TimeToString(m.obs[i].dispTo, TIME_DATE | TIME_MINUTES) + ";"
                      + (m.obs[i].choch ? "CHOCH" : "BOS") + ";" + DoubleToString(m.obs[i].dispAtr, 2) + ";" + IntegerToString(m.obs[i].retests) + ";"
                      + ObStatusText(m.obs[i].status) + ";" + TimeToString(m.obs[i].statusTime, TIME_DATE | TIME_MINUTES) + ";" + m.obs[i].reason + ";"
                      + InpRunLabel;
         g_log.WriteObRow(h, row);
        }
     }

   void              LogAnalysis(void)
     {
      LogCandles(g_ctx.cdlBuy);
      LogCandles(g_ctx.cdlSell);
      LogFvgs(g_ctx.fvg5);
      LogFvgs(g_ctx.fvg1);
      //--- (MQL5 : pas d'opérateur ternaire entre deux objets de classe)
      if(InpFvgTF == GLS_FVGTF_M1)
         LogObs(g_ctx.ob1);
      else
         LogObs(g_ctx.ob5);
      CountFvgs(g_ctx.fvg5);
      CountFvgs(g_ctx.fvg1);
     }

   //--- Transaction serveur : une position a pu se fermer (stop, objectif...)
   void              OnTradeTransaction(const MqlTradeTransaction &trans)
     {
      if(!symbolOk || trans.type != TRADE_TRANSACTION_DEAL_ADD || trans.symbol != g_sym.name)
         return;
      for(int i = 0; i < g_pm.Count(); i++)
         if(g_pm.plans[i].alive && !PositionSelectByTicket(g_pm.plans[i].ticket))
            g_pm.plans[i].alive = false;
      g_pm.FinalizeClosed(env, account);
     }

   //--- Contrôle de cohérence périodique : positions serveur <-> plans
   void              Reconcile(void)
     {
      if(!Connected())
         return;
      for(int i = PositionsTotal() - 1; i >= 0; i--)
        {
         ulong t = PositionGetTicket(i);
         if(t == 0)
            continue;
         if((ulong)PositionGetInteger(POSITION_MAGIC) == (ulong)InpMagic && PositionGetString(POSITION_SYMBOL) == g_sym.name && g_pm.Find(t) < 0)
           {
            g_log.Warn("REPRISE", StringFormat("position #%I64u de l'EA non suivie : reprise", t));
            needResync = true;
            return;
           }
        }
      for(int i = 0; i < g_pm.Count(); i++)
         if(g_pm.plans[i].alive && !PositionSelectByTicket(g_pm.plans[i].ticket))
            g_pm.plans[i].alive = false;
     }

   //+---------------------------------------------------------------+
   //| Boutons                                                        |
   //+---------------------------------------------------------------+
   void              AddCheck(const string text, const int status)
     {
      int n = ArraySize(m_checkLines);
      ArrayResize(m_checkLines, n + 1);
      ArrayResize(m_checkStatus, n + 1);
      m_checkLines[n] = text;
      m_checkStatus[n] = status;
      string tag = (status == GLS_STATUS_OK) ? "[OK]" : ((status == GLS_STATUS_WARN) ? "[ATTENTION]" : ((status == GLS_STATUS_FAIL) ? "[ÉCHEC]" : "[INFO]"));
      g_log.Info("VERIFICATION", tag + " " + text);
     }

   //--- Vérification complète ; renvoie le nombre d'échecs bloquants
   int               RunConnectionCheck(void)
     {
      ArrayResize(m_checkLines, 0);
      ArrayResize(m_checkStatus, 0);
      int fails = 0;
      //--- 1. serveur
      bool conn = Connected();
      long pingUs = TerminalInfoInteger(TERMINAL_PING_LAST);
      AddCheck(StringFormat("Serveur : %s (%s, ping %.0f ms)", conn ? "connecté" : "DÉCONNECTÉ", AccountInfoString(ACCOUNT_SERVER), (double)pingUs / 1000.0),
               conn ? GLS_STATUS_OK : GLS_STATUS_FAIL);
      if(!conn)
         fails++;
      //--- 2. compte
      AddCheck(StringFormat("Compte %I64d : %s, devise %s, levier 1:%I64d", account, isReal ? "RÉEL" : env,
                            AccountInfoString(ACCOUNT_CURRENCY), AccountInfoInteger(ACCOUNT_LEVERAGE)), isReal ? GLS_STATUS_WARN : GLS_STATUS_INFO);
      //--- 3-6. autorisations (distinctes de la connexion)
      bool accTrade = (AccountInfoInteger(ACCOUNT_TRADE_ALLOWED) != 0);
      bool accExpert = (AccountInfoInteger(ACCOUNT_TRADE_EXPERT) != 0);
      bool termAlgo = (TerminalInfoInteger(TERMINAL_TRADE_ALLOWED) != 0);
      bool eaAlgo = (MQLInfoInteger(MQL_TRADE_ALLOWED) != 0);
      AddCheck("Trading autorisé sur le compte : " + BoolText(accTrade), accTrade ? GLS_STATUS_OK : GLS_STATUS_FAIL);
      AddCheck("Trading par EA accepté par le serveur : " + BoolText(accExpert), accExpert ? GLS_STATUS_OK : GLS_STATUS_FAIL);
      AddCheck((string)"Bouton « Trading algo » du terminal : " + (termAlgo ? "activé" : "DÉSACTIVÉ"), termAlgo ? GLS_STATUS_OK : GLS_STATUS_FAIL);
      AddCheck("Trading algo autorisé pour cet EA : " + BoolText(eaAlgo), eaAlgo ? GLS_STATUS_OK : GLS_STATUS_FAIL);
      if(!accTrade || !accExpert || !termAlgo || !eaAlgo)
         fails++;
      //--- 7. symbole
      if(!symbolOk)
        {
         AddCheck("Symbole : " + symbolError, GLS_STATUS_FAIL);
         ShowChecks();
         return fails + 1;
        }
      bool specOk = g_sym.Refresh();
      int mins = 0;
      bool sessOpen = BrokerSessionOpen(g_sym.name, TimeCurrent(), mins);
      AddCheck(StringFormat("Symbole %s : mode %s, séance %s", g_sym.name, g_sym.TradeModeText(), sessOpen ? "ouverte" : "FERMÉE"),
               (g_sym.tradeMode == SYMBOL_TRADE_MODE_FULL && sessOpen) ? GLS_STATUS_OK : GLS_STATUS_WARN);
      //--- 8. spécifications
      AddCheck(StringFormat("Contrat : %d déc., tick %s = %s %s, taille %s", g_sym.digits, DoubleToString(g_sym.tickSize, g_sym.digits),
                            DoubleToString(g_sym.tickValue, 4), AccountInfoString(ACCOUNT_CURRENCY), DoubleToString(g_sym.contractSize, 0)),
               specOk ? GLS_STATUS_OK : GLS_STATUS_FAIL);
      AddCheck(StringFormat("Volumes : min %s, max %s, pas %s | stops %d pts, gel %d pts", DoubleToString(g_sym.volMin, g_sym.volDigits),
                            DoubleToString(g_sym.volMax, g_sym.volDigits), DoubleToString(g_sym.volStep, g_sym.volDigits), g_sym.stopsLevel, g_sym.freezeLevel),
               specOk ? GLS_STATUS_OK : GLS_STATUS_FAIL);
      AddCheck("Exécution " + g_sym.ExecModeText() + ", remplissage " + g_sym.FillingText() + ", marge en " + g_sym.marginCcy, GLS_STATUS_INFO);
      if(!specOk)
         fails++;
      //--- 9. données de marché
      MqlTick tick = {};
      bool tickOk = SymbolInfoTick(g_sym.name, tick) && tick.bid > 0.0 && tick.ask > tick.bid;
      long age = tickOk ? (long)(TimeCurrent() - tick.time) : -1;
      bool sync = (SeriesInfoInteger(g_sym.name, PERIOD_M1, SERIES_SYNCHRONIZED) != 0);
      int bars1 = Bars(g_sym.name, PERIOD_M1);
      int bars5 = Bars(g_sym.name, PERIOD_M5);
      int bars15 = Bars(g_sym.name, PERIOD_M15);
      bool dataOk = tickOk && sync && bars1 >= 400 && bars5 >= 400 && bars15 >= 100;
      AddCheck(StringFormat("Données : tick %s (âge %I64d s), barres M1/M5/M15 %d/%d/%d, synchro %s", tickOk ? "ok" : "ABSENT", age, bars1, bars5, bars15, BoolText(sync)),
               dataOk ? (age > InpMaxTickAgeSec ? GLS_STATUS_WARN : GLS_STATUS_OK) : GLS_STATUS_FAIL);
      if(!dataOk)
         fails++;
      //--- 10. spread
      if(tickOk)
        {
         double spread = tick.ask - tick.bid;
         double maxS = MaxSpreadPrice();
         AddCheck(StringFormat("Spread : %s (%d pts), maximum %s", DoubleToString(spread, g_sym.digits), g_sym.PriceToPoints(spread), DoubleToString(maxS, g_sym.digits)),
                  spread <= maxS ? GLS_STATUS_OK : GLS_STATUS_WARN);
        }
      //--- 11. marge et risque au volume minimal
      double equity = AccountInfoDouble(ACCOUNT_EQUITY);
      double freeMargin = AccountInfoDouble(ACCOUNT_MARGIN_FREE);
      if(tickOk)
        {
         double margin = 0.0;
         bool mOk = OrderCalcMargin(ORDER_TYPE_BUY, g_sym.name, g_sym.volMin, tick.ask, margin);
         AddCheck(StringFormat("Marge pour %s lot : %.2f / marge libre %.2f", DoubleToString(g_sym.volMin, g_sym.volDigits), margin, freeMargin),
                  (mOk && margin <= freeMargin * InpMaxMarginUsePct / 100.0) ? GLS_STATUS_OK : GLS_STATUS_FAIL);
         if(!mOk || margin > freeMargin)
            fails++;
         double atr = g_ctx.ready ? g_ctx.Atr() : 0.0;
         double typicalStop = (atr > 0.0) ? 1.5 * atr : 200.0 * g_sym.point;
         double loss = 0.0;
         string det = "";
         if(LossPerLot(GLS_BUY, tick.ask, tick.ask - typicalStop, loss, det) && equity > 0.0)
           {
            double pct = 100.0 * (loss * g_sym.volMin + 2.0 * g_commissionPerLotSide * g_sym.volMin) / equity;
            AddCheck(StringFormat("Risque au volume min (stop %s) : %.2f %% de l'equity (budget %.2f %%)", DoubleToString(typicalStop, g_sym.digits), pct, InpRiskPercent),
                     pct <= InpRiskPercent ? GLS_STATUS_OK : GLS_STATUS_WARN);
            if(pct > InpRiskPercent)
               AddCheck("=> la plupart des entrées seront REFUSÉES (volume minimal trop risqué)", GLS_STATUS_WARN);
           }
         //--- 12. contrôle d'exécution sans envoi (OrderCheck)
         MqlTradeRequest req = {};
         MqlTradeCheckResult chk = {};
         req.action = TRADE_ACTION_DEAL;
         req.symbol = g_sym.name;
         req.volume = g_sym.volMin;
         req.type = ORDER_TYPE_BUY;
         req.price = tick.ask;
         req.sl = g_sym.FloorPrice(tick.bid - MathMax(typicalStop, g_sym.StopsDistance() + 10.0 * g_sym.tickSize));
         req.deviation = 10;
         req.magic = (ulong)InpMagic;
         req.type_filling = g_sym.filling;
         req.type_time = ORDER_TIME_GTC;
         bool chkOk = OrderCheck(req, chk);
         AddCheck("Contrôle d'ordre (sans envoi) : " + (chkOk ? "accepté" : "REFUSÉ - " + RetcodeText(chk.retcode) + " " + chk.comment),
                  chkOk ? GLS_STATUS_OK : GLS_STATUS_FAIL);
         if(!chkOk)
            fails++;
        }
      //--- 13. annonces, heure, état
      AddCheck("Annonces : " + g_news.statusText, g_news.Reliable() ? GLS_STATUS_OK : GLS_STATUS_WARN);
      g_clock.Update(TimeCurrent());
      AddCheck("Heure : " + g_clock.Describe(TimeCurrent()), g_clock.offsetSource == "auto" ? GLS_STATUS_OK : GLS_STATUS_INFO);
      AddCheck((string)"État interne : " + (stateCoherent ? "cohérent" : "reprise en cours") + StringFormat(", %d position(s) EA, %d ordre(s) en attente", g_pm.AliveCount(), pendingOrders),
               stateCoherent ? GLS_STATUS_OK : GLS_STATUS_WARN);
      AddCheck(fails == 0 ? "BILAN : aucune anomalie bloquante" : StringFormat("BILAN : %d anomalie(s) bloquante(s)", fails), fails == 0 ? GLS_STATUS_OK : GLS_STATUS_FAIL);
      ShowChecks();
      return fails;
     }

   void              ShowChecks(void)
     {
      if(g_dash.Created())
         g_dash.ShowChecks(m_checkLines, m_checkStatus, ArraySize(m_checkLines));
     }

   void              OnStartButton(void)
     {
      if(running)
        {
         g_log.Info("BOUTON", "robot déjà démarré");
         return;
        }
      int fails = RunConnectionCheck();
      string why = "";
      if(!symbolOk || !Connected() || !AlgoAllowed(why))
        {
         g_log.Error("BOUTON", "démarrage impossible : " + (!symbolOk ? symbolError : (!Connected() ? "pas de connexion" : why)));
         MessageBox("Démarrage impossible :\n" + (!symbolOk ? symbolError : (!Connected() ? "pas de connexion au serveur" : why)), GLS_NAME, MB_OK | MB_ICONERROR);
         return;
        }
      if(fails > 0)
        {
         int r0 = MessageBox(StringFormat("La vérification signale %d anomalie(s) (voir le panneau).\nLe robot refusera les entrées tant qu'elles persistent.\n\nDémarrer quand même la surveillance ?", fails),
                             GLS_NAME, MB_YESNO | MB_ICONWARNING | MB_DEFBUTTON2);
         if(r0 != IDYES)
            return;
        }
      if(isReal && g_store.Get("realOK", 0.0) < 0.5)
        {
         string msg = "ATTENTION : COMPTE RÉEL " + IntegerToString(account) + " (" + AccountInfoString(ACCOUNT_SERVER) + ")\n\n"
                      + "Le robot pourra ouvrir des positions avec de l'argent réel sur " + g_sym.name + ".\n"
                      + StringFormat("Risque par trade : %.2f %% | limite journalière : %.2f %% | max %d trades/jour.\n", InpRiskPercent, InpMaxDailyLossPct, InpMaxTradesPerDay)
                      + "Aucun résultat n'est garanti ; des pertes sont possibles.\n\nConfirmez-vous la PREMIÈRE activation réelle ?";
         int r = MessageBox(msg, (string)GLS_NAME + " - compte réel", MB_YESNO | MB_ICONWARNING | MB_DEFBUTTON2);
         if(r != IDYES)
           {
            g_log.Info("BOUTON", "activation réelle annulée par l'utilisateur");
            return;
           }
         g_store.Set("realOK", 1.0);
         g_log.Warn("BOUTON", "première activation sur compte RÉEL confirmée par l'utilisateur");
        }
      g_guard.ManualReset();
      running = true;
      startedAt = TimeCurrent();
      g_store.Set("run", 1.0);
      g_store.Flush();
      lastRefusalText = "aucun";
      g_log.Info("BOUTON", "robot DÉMARRÉ : recherche de signaux active (aucun ordre sans signal valide)");
     }

   void              OnStopButton(void)
     {
      running = false;
      g_store.Set("run", 0.0);
      g_store.Flush();
      g_log.Info("BOUTON", StringFormat("robot ARRÊTÉ : plus de nouvelles entrées ; %d position(s) restent gérées avec leurs stops", g_pm.AliveCount()));
      g_alerts.Notify(GLS_ALERT_STOP, "stop", "robot arrêté par le bouton (positions toujours gérées)");
     }

   int               CountEaPositions(void) const
     {
      int c = 0;
      for(int i = PositionsTotal() - 1; i >= 0; i--)
        {
         ulong t = PositionGetTicket(i);
         if(t == 0)
            continue;
         if((ulong)PositionGetInteger(POSITION_MAGIC) == (ulong)InpMagic && PositionGetString(POSITION_SYMBOL) == g_sym.name)
            c++;
        }
      return c;
     }

   void              OnCloseAllButton(void)
     {
      if(!symbolOk)
         return;
      int count = CountEaPositions();
      if(count == 0)
        {
         MessageBox("Aucune position de cet EA (magic " + IntegerToString(InpMagic) + ") sur " + g_sym.name + ".", GLS_NAME, MB_OK | MB_ICONINFORMATION);
         return;
        }
      string msg = StringFormat("Fermer les %d position(s) ouvertes par CET EA (magic %I64d) sur %s ?\n\n", count, InpMagic, g_sym.name)
                   + "Les positions manuelles et celles des autres robots ne seront PAS fermées.";
      if(MessageBox(msg, (string)GLS_NAME + " - confirmation", MB_YESNO | MB_ICONQUESTION | MB_DEFBUTTON2) != IDYES)
        {
         g_log.Info("BOUTON", "fermeture annulée par l'utilisateur");
         return;
        }
      datetime now = TimeCurrent();
      if(needResync)
         Recover("avant fermeture");
      int closed = 0;
      int failed = g_pm.CloseAll(GLS_EXIT_CLOSE_ALL, now, closed);
      //--- positions EA éventuellement non suivies
      for(int i = PositionsTotal() - 1; i >= 0; i--)
        {
         ulong t = PositionGetTicket(i);
         if(t == 0)
            continue;
         if((ulong)PositionGetInteger(POSITION_MAGIC) != (ulong)InpMagic || PositionGetString(POSITION_SYMBOL) != g_sym.name || g_pm.Find(t) >= 0)
            continue;
         string m = "";
         if(g_trader.ClosePosition(t, 0.0, BuildExitComment(GlsExitCode(GLS_EXIT_CLOSE_ALL), "-"), m))
            closed++;
         else
            failed++;
        }
      //--- vérification de l'état réel côté serveur
      int remaining = CountEaPositions();
      string report = StringFormat("Fermeture demandée : %d position(s).\nConfirmées fermées : %d\nÉchecs : %d\nPositions EA encore ouvertes (serveur) : %d",
                                   count, count - remaining, failed, remaining);
      if(remaining > 0)
         report += "\nDernier code : " + RetcodeText(g_trader.lastRetcode);
      g_log.Info("BOUTON", report);
      MessageBox(report, GLS_NAME, MB_OK | (remaining > 0 ? MB_ICONWARNING : MB_ICONINFORMATION));
     }

   void              OnChartEvent(const int id, const string sparam)
     {
      if(id != CHARTEVENT_OBJECT_CLICK)
         return;
      string b = g_dash.ButtonId(sparam);
      if(StringLen(b) == 0)
         return;
      if(b == GLS_BTN_CHECK)
        {
         int f = RunConnectionCheck();
         g_dash.ReleaseButton(b, f == 0 ? "aucune anomalie bloquante" : IntegerToString(f) + " anomalie(s)");
        }
      else
         if(b == GLS_BTN_START)
           {
            OnStartButton();
            g_dash.ReleaseButton(b, running ? "robot démarré" : "non démarré");
           }
         else
            if(b == GLS_BTN_STOP)
              {
               OnStopButton();
               g_dash.ReleaseButton(b, "robot arrêté (positions gérées)");
              }
            else
               if(b == GLS_BTN_CLOSE)
                 {
                  OnCloseAllButton();
                  g_dash.ReleaseButton(b, "");
                 }
               else
                  if(b == GLS_BTN_HIDE)
                     g_dash.HideChecks();
      UpdateDashboard();
     }

   //+---------------------------------------------------------------+
   //| Tableau de bord                                                |
   //+---------------------------------------------------------------+
   void              UpdateDashboard(void)
     {
      if(!g_dash.Created())
         return;
      datetime now = TimeCurrent();
      string ccy = AccountInfoString(ACCOUNT_CURRENCY);
      double bal = AccountInfoDouble(ACCOUNT_BALANCE);
      double eq = AccountInfoDouble(ACCOUNT_EQUITY);
      string why = "";
      bool algo = AlgoAllowed(why);
      bool conn = Connected();
      int row = 0;
      g_dash.SetTitleRow(row++, StringFormat("%s v%s - %s %s", GLS_NAME, GLS_VERSION, GlsFamilyCode(InpFamily), GlsFamilyName(InpFamily)));
      g_dash.SetRow(row++, (string)"Robot : " + (running ? "EN MARCHE (entrées actives)" : "ARRÊTÉ (aucune entrée)") + " | gestion : active",
                    running ? GLS_STATUS_OK : GLS_STATUS_WARN);
      g_dash.SetRow(row++, StringFormat("Serveur : %s | ping %.0f ms | %s", conn ? "connecté" : "DÉCONNECTÉ", TerminalInfoInteger(TERMINAL_PING_LAST) / 1000.0,
                                        stateCoherent ? "état cohérent" : "reprise..."), conn ? GLS_STATUS_OK : GLS_STATUS_FAIL);
      g_dash.SetRow(row++, StringFormat("Compte : %s %I64d (%s) | algo : %s", isReal ? "RÉEL" : env, account, ccy, algo ? "autorisé" : "NON"),
                    algo ? (isReal ? GLS_STATUS_WARN : GLS_STATUS_OK) : GLS_STATUS_FAIL);
      if(!algo)
         g_dash.SetRow(row++, "  " + why, GLS_STATUS_FAIL);
      g_dash.SetRow(row++, symbolOk ? "Symbole : " + g_sym.name + " | exécution M1, contexte M5/M15" : "Symbole : " + symbolError,
                    symbolOk ? GLS_STATUS_INFO : GLS_STATUS_FAIL);
      g_dash.SetRow(row++, "Solde : " + FormatMoney(bal, ccy) + " | Equity : " + FormatMoney(eq, ccy), GLS_STATUS_INFO);
      double eaDay = g_guard.realizedToday + g_guard.floatingEA;
      g_dash.SetRow(row++, StringFormat("Jour (EA) : %+.2f %s | perte %.2f %% | DD jour %.2f %%", eaDay, ccy, g_guard.dailyLossPct, g_guard.dailyDDPct),
                    eaDay >= 0.0 ? GLS_STATUS_OK : GLS_STATUS_WARN);
      g_dash.SetRow(row++, StringFormat("Trades du jour : %d / %d | positions ouvertes : %d", g_guard.tradesToday, InpMaxTradesPerDay, g_pm.AliveCount()), GLS_STATUS_INFO);
      g_dash.SetRow(row++, StringFormat("Clôturés : %d (gagnants %d / perdants %d) | réussite %.1f %%", g_stats.total, g_stats.wins, g_stats.losses, g_stats.WinRate()),
                    GLS_STATUS_INFO);
      if(g_stats.total >= InpMinTradesForStats)
         g_dash.SetRow(row++, StringFormat("PF %.2f | espérance %.2f %s (%.2f R) | DD max %.2f", g_stats.ProfitFactor(), g_stats.Expectancy(), ccy,
                                           g_stats.ExpectancyR(), g_stats.maxDD), GLS_STATUS_INFO);
      else
         g_dash.SetRow(row++, StringFormat("PF / espérance : données insuffisantes (%d < %d)", g_stats.total, InpMinTradesForStats), GLS_STATUS_INFO);
      double maxS = MaxSpreadPrice();
      g_dash.SetRow(row++, StringFormat("Spread : %s (%d pts) | max %s", DoubleToString(lastSpread, g_sym.digits), g_sym.PriceToPoints(lastSpread),
                                        DoubleToString(maxS, g_sym.digits)), lastSpread <= maxS ? GLS_STATUS_OK : GLS_STATUS_WARN);
      bool window = g_clock.EntryWindowOpen(now);
      g_dash.SetRow(row++, "Session : " + GlsSessionText(g_clock.SessionAt(now)) + " | fenêtre d'entrée " + (window ? "ouverte" : "fermée") + " | UTC "
                    + TimeToString(g_clock.ServerToUtc(now), TIME_MINUTES), window ? GLS_STATUS_OK : GLS_STATUS_INFO);
      g_dash.SetRow(row++, "Annonces : " + g_news.statusText, g_news.Reliable() ? GLS_STATUS_OK : GLS_STATUS_WARN);
      if(g_ctx.ready)
        {
         bool allowed = !InpUseRegimeFilter || RegimeAllowed(InpFamily, g_ctx.regime);
         g_dash.SetRow(row++, "Tendance : M15 " + TrendClassText(g_ctx.t15.cls) + ", M5 " + TrendClassText(g_ctx.t5.cls) + " | régime "
                       + RegimeCode(g_ctx.regime) + (allowed ? "" : " (non autorisé)"), allowed ? GLS_STATUS_INFO : GLS_STATUS_WARN);
         g_dash.SetRow(row++, "  M15 : " + g_ctx.t15.reason, GLS_STATUS_INFO);
         g_dash.SetRow(row++, "Structure M5 : " + g_ctx.st5.EventText() + (g_ctx.EmaSide() > 0 ? ", prix > EMA200" : (g_ctx.EmaSide() < 0 ? ", prix < EMA200" : ""))
                       + (g_ctx.dataGap ? " | " + g_ctx.dataGapText : ""), g_ctx.dataGap ? GLS_STATUS_WARN : GLS_STATUS_INFO);
         double mid = 0.5 * (SymbolInfoDouble(g_sym.name, SYMBOL_BID) + SymbolInfoDouble(g_sym.name, SYMBOL_ASK));
         int zs = g_ctx.zones.Nearest(GLS_ZONE_SUPPORT, mid);
         int zr = g_ctx.zones.Nearest(GLS_ZONE_RESIST, mid);
         g_dash.SetRow(row++, "Support : " + g_ctx.zones.Describe(zs, g_sym.digits), GLS_STATUS_INFO);
         g_dash.SetRow(row++, "Résistance : " + g_ctx.zones.Describe(zr, g_sym.digits), GLS_STATUS_INFO);
         g_dash.SetRow(row++, StringFormat("FVG actives M5 : %d / %d | M1 (hors doublons) : %d / %d | OB M5 : %d / %d", g_ctx.fvg5.CountActive(1),
                                           g_ctx.fvg5.CountActive(-1), g_ctx.fvg1.CountActive(1), g_ctx.fvg1.CountActive(-1),
                                           g_ctx.ob5.CountActive(1), g_ctx.ob5.CountActive(-1)), GLS_STATUS_INFO);
         g_dash.SetRow(row++, StringFormat("FVG M%d jour : %d détectées | %d qualifiées | %d retestées | %d invalidées", (int)InpFvgTF,
                                           fvgDetected, fvgQualified, fvgRetested, fvgInvalidated), GLS_STATUS_INFO);
        }
      else
         g_dash.SetRow(row++, "Contexte : données indisponibles (" + g_ctx.error + ")", GLS_STATUS_WARN);
      g_dash.SetRow(row++, StringFormat("Jour : figures %d détectées / %d confirmées | signaux %d rejetés / %d exécutés",
                                        cdlDetected, cdlConfirmed, sigRejected, sigExecuted), GLS_STATUS_INFO);
      g_dash.SetRow(row++, "Dernière figure : " + lastCandleText, GLS_STATUS_INFO);
      g_dash.SetRow(row++, "Dernier signal : " + lastSignalText, GLS_STATUS_INFO);
      g_dash.SetRow(row++, "Dernier refus : " + lastRefusalText, GLS_STATUS_INFO);
      g_dash.SetRow(row++, "Dernière exécution : " + lastExecText, GLS_STATUS_INFO);
      g_dash.SetRow(row++, "Exécution : " + g_exec.Summary(), (g_exec.rejects + g_exec.uncertain > 0) ? GLS_STATUS_WARN : GLS_STATUS_INFO);
      g_dash.SetRow(row++, StringFormat("Alertes : %d envoyée(s), %d échec(s) | ", g_alerts.sent, g_alerts.failures) + g_alerts.lastText,
                    g_alerts.failures > 0 ? GLS_STATUS_WARN : GLS_STATUS_INFO);
      g_dash.SetRow(row++, "Protection : " + g_guard.StatusText(now), g_guard.EntryBlockReason(now) == GLS_REFUSE_NONE ? GLS_STATUS_OK : GLS_STATUS_FAIL);
      g_dash.SetRow(row++, StringFormat("Risque : %.2f %%/trade | ouvert %.2f %s | DD %.2f %%/%.1f %%", InpRiskPercent, g_guard.openRiskMoney, ccy,
                                        g_guard.drawdownPct, InpMaxDrawdownPct), GLS_STATUS_INFO);
      while(row < GLS_DASH_ROWS)
         g_dash.SetRow(row++, " ", GLS_STATUS_INFO);
      g_dash.Redraw();
     }

   //+---------------------------------------------------------------+
   //| Fin / testeur                                                  |
   //+---------------------------------------------------------------+
   void              Deinit(const int reason)
     {
      EventKillTimer();
      g_pm.SaveDirty();
      g_store.Flush();
      if(symbolOk && !optimization)
        {
         g_stats.Compute();
         g_log.WriteText(g_log.Base() + "_rapport.txt", g_stats.Report(AccountInfoString(ACCOUNT_CURRENCY), InpMinTradesForStats));
        }
      g_dash.Destroy();
      g_log.Info("FIN", "EA retiré (raison " + IntegerToString(reason) + ") ; les positions ouvertes conservent leurs stops sur le serveur");
      g_alerts.Notify(GLS_ALERT_STOP, "deinit", "EA retiré du graphique (raison " + IntegerToString(reason) + ") : positions non gérées par l'EA tant qu'il est arrêté");
     }

   //--- Critère personnalisé du testeur : espérance en R / écart-type x racine(N) (SQN borné)
   double            TesterCriterion(void)
     {
      g_pm.FinalizeClosed(env, account);
      g_stats.Compute();
      if(!optimization)
         g_log.WriteText(g_log.Base() + "_rapport.txt", g_stats.Report(AccountInfoString(ACCOUNT_CURRENCY), InpMinTradesForStats));
      int n = 0;
      double sum = 0.0;
      double sq = 0.0;
      for(int i = 0; i < ArraySize(g_stats.trades); i++)
        {
         if(!g_stats.trades[i].complete || g_stats.trades[i].riskMoney <= 0.0)
            continue;
         double r = g_stats.trades[i].rMultiple;
         sum += r;
         sq += r * r;
         n++;
        }
      if(n < InpMinTradesForStats || n < 2)
         return 0.0;
      double mean = sum / n;
      double var = (sq - n * mean * mean) / (n - 1);
      if(var <= 0.0)
         return 0.0;
      return mean / MathSqrt(var) * MathSqrt((double)MathMin(n, 100));
     }
  };

CGlsEngine g_engine;

#endif // GLS_ENGINE_MQH
//+------------------------------------------------------------------+
