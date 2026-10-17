// test_main.cpp - tests unitaires et d'intégration du code MQL5 de l'EA,
// compilé en C++ avec le shim et exécuté contre le courtier simulé.
//
// Ces tests vérifient la LOGIQUE et la ROBUSTESSE du code (pas de dépassement
// de tableau, pas de division par zéro, stops jamais élargis, prises partielles
// non dupliquées après redémarrage, statistiques agrégées par position...).
// Ils ne mesurent PAS la rentabilité : les données utilisées sont synthétiques.
#include <csignal>
#include <new>
#include <random>
#include <set>

#include "shim/mql5_shim.h"
#include "mql/Gold_Liquidity_Scalper.mq5"
#include "mql/inputs_reset.inc"

static int g_failures = 0;
static int g_checks = 0;
static std::string g_testName;

#define CHECK(cond, msg)                                                                         \
  do                                                                                             \
  {                                                                                              \
    g_checks++;                                                                                  \
    if (!(cond))                                                                                 \
    {                                                                                            \
      g_failures++;                                                                              \
      std::ostringstream _o;                                                                     \
      _o << msg;                                                                                 \
      std::cout << "  ECHEC [" << g_testName << "] " << _o.str() << " (ligne " << __LINE__ << ")\n"; \
    }                                                                                            \
  } while (0)
#define CHECK_NEAR(a, b, tol, msg) CHECK(std::fabs((double)(a) - (double)(b)) <= (tol), msg << " : " << (a) << " vs " << (b))

static void OnFpe(int)
{
  std::cout << "SIGFPE (division par zéro ou lecture d'une valeur non initialisée) pendant : " << g_testName << std::endl;
  std::_Exit(3);
}

template <class T>
void Renew(T &obj)
{
  obj.~T();
  new (&obj) T();
}

//--- remise à zéro de TOUT l'état en mémoire de l'EA (= redémarrage du programme)
static void ResetEaMemory()
{
  Renew(g_log);
  Renew(g_store);
  Renew(g_sym);
  Renew(g_clock);
  Renew(g_news);
  Renew(g_ctx);
  Renew(g_trader);
  Renew(g_stats);
  Renew(g_guard);
  Renew(g_pm);
  Renew(g_dash);
  Renew(g_engine);
  Renew(g_exec);
  Renew(g_alerts);
  g_commissionPerLotSide = 0.0;
  g_observedSlippage = 0.0;
  AnalysisConfigInit();
}

static void ResetAll()
{
  Sim() = SimState();
  ResetInputs();
  ResetEaMemory();
}

//--- Filtres de contexte v1.10 (régime, tendance, bougies, obstacles S/R) désactivés :
//--- utilisé UNIQUEMENT pour exercer les chemins d'exécution et de gestion sur une
//--- marche aléatoire. Chaque filtre est testé séparément (unitaires + comparaison A/B).
static void RelaxContextFilters()
{
  InpUseRegimeFilter = false;
  InpUseTrendFilter = false;
  InpCdlBlockOpposing = false;
  InpCdlBlockIndecision = false;
  InpCdlBlockExtended = false;
  InpUseSRObstacles = false;
}

//--- filtre optionnel (argument) : sous-chaînes séparées par '|' ; seuls les tests correspondants sont lancés
static std::vector<std::string> g_filters;

static void RunTest(const char *name, void (*fn)())
{
  if (!g_filters.empty())
  {
    bool match = false;
    for (const std::string &f : g_filters)
      match = match || std::string(name).find(f) != std::string::npos;
    if (!match)
      return;
  }
  g_testName = name;
  int before = g_failures;
  ResetAll();
  try
  {
    fn();
  }
  catch (const std::exception &e)
  {
    g_failures++;
    std::cout << "  EXCEPTION [" << name << "] " << e.what() << "\n";
  }
  std::cout << (g_failures == before ? "[OK]     " : "[ECHEC]  ") << name << "\n";
}

//==========================================================================
// Outils : barres synthétiques
//==========================================================================
struct Bar
{
  double o, h, l, c;
};

static void FillSeries(CBarSeries &s, datetime start, const std::vector<Bar> &bars)
{
  s.Resize((int)bars.size());
  s.periodSec = 60;
  for (size_t i = 0; i < bars.size(); i++)
  {
    s.time[(int)i] = start + (datetime)i * 60;
    s.open[(int)i] = bars[i].o;
    s.high[(int)i] = bars[i].h;
    s.low[(int)i] = bars[i].l;
    s.close[(int)i] = bars[i].c;
    s.volume[(int)i] = 100.0;
  }
}

static std::vector<Bar> FlatPrefix(int n, double mid, double halfRange)
{
  std::vector<Bar> v;
  for (int i = 0; i < n; i++)
  {
    double c = mid + ((i % 2) ? 0.2 : -0.2);
    v.push_back({mid, mid + halfRange, mid - halfRange, c});
  }
  return v;
}

static std::vector<Bar> MirrorBars(const std::vector<Bar> &in, double axis)
{
  std::vector<Bar> out;
  for (const Bar &b : in)
    out.push_back({axis - b.o, axis - b.l, axis - b.h, axis - b.c});
  return out;
}

//--- prépare le contexte M1 seul (sans M5/M15) pour tester la détection
static void PrepareM1Context(const std::vector<Bar> &bars)
{
  SimState &S = Sim();
  S.digits = 2;
  S.point = 0.01;
  S.tickSize = 0.01;
  g_sym.Detect("", "XAUUSDm");
  FillSeries(g_ctx.m1, 1741600800, bars); // 2025-03-10 10:00 UTC
  CalcATR(g_ctx.m1, 14, g_ctx.atr);
  CalcATR(g_ctx.m1, 100, g_ctx.atrLong);
  g_ctx.m1Mirror.MirrorFrom(g_ctx.m1);
  g_ctx.liq.Clear();
  g_ctx.ready = true;
}

//--- configuration de balayage haussier type (voir commentaire dans le test)
static std::vector<Bar> SweepBuyBars()
{
  std::vector<Bar> v = FlatPrefix(100, 2000.0, 0.5);
  std::vector<Bar> seq = {
      {2000.0, 2000.4, 1998.6, 1998.8}, // p0
      {1998.8, 1999.0, 1997.6, 1997.8}, // p1
      {1997.8, 1998.0, 1996.6, 1996.8}, // p2
      {1996.8, 1997.0, 1995.0, 1995.6}, // p3 creux fractal = niveau de liquidité 1995.0
      {1995.6, 1996.6, 1995.4, 1996.4}, // p4
      {1996.4, 1997.4, 1996.2, 1997.2}, // p5
      {1997.2, 1997.8, 1996.8, 1997.4}, // p6
      {1997.4, 1997.6, 1996.6, 1996.8}, // p7
      {1996.8, 1997.2, 1996.0, 1996.4}, // p8
      {1996.4, 1996.9, 1995.8, 1996.0}, // p9
      {1996.0, 1996.6, 1995.6, 1995.8}, // p10
      {1995.8, 1996.8, 1995.5, 1996.5}, // p11 micro-sommet (CHOCH) 1996.8
      {1996.5, 1996.6, 1995.3, 1995.4}, // p12
      {1995.4, 1995.6, 1994.6, 1995.3}, // p13 balayage à 1994.6, réintégration immédiate
      {1995.3, 1997.2, 1995.2, 1997.0}, // p14 clôture > 1996.8 : CHOCH = déclenchement
  };
  v.insert(v.end(), seq.begin(), seq.end());
  return v;
}

//==========================================================================
// Tests unitaires
//==========================================================================
static void TestUtils()
{
  CHECK(ParseHHMM("08:00") == 480, "ParseHHMM 08:00");
  CHECK(ParseHHMM("8:30") == 510, "ParseHHMM 8:30");
  CHECK(ParseHHMM("24:00") == -1, "ParseHHMM 24:00 invalide");
  CHECK(ParseHHMM("ab:cd") == -1, "ParseHHMM texte invalide");
  CHECK(ParseHHMM("0800") == -1, "ParseHHMM sans ':'");
  CHECK(InMinuteWindow(1430, 1380, 60), "fenêtre passant minuit");
  CHECK(!InMinuteWindow(120, 1380, 60), "hors fenêtre passant minuit");
  CHECK(InMinuteWindow(480, 480, 690) && !InMinuteWindow(690, 480, 690), "bornes [début, fin)");
  // heure d'été UE 2025 : 30 mars 01:00 UTC -> 26 octobre 01:00 UTC
  CHECK(!IsEuDst(ShimTimegm(2025, 3, 30, 0, 59, 0)) && IsEuDst(ShimTimegm(2025, 3, 30, 1, 0, 0)), "début heure d'été UE");
  CHECK(IsEuDst(ShimTimegm(2025, 10, 26, 0, 59, 0)) && !IsEuDst(ShimTimegm(2025, 10, 26, 1, 0, 0)), "fin heure d'été UE");
  // heure d'été USA 2025 : 9 mars 07:00 UTC -> 2 novembre 06:00 UTC
  CHECK(!IsUsDst(ShimTimegm(2025, 3, 9, 6, 59, 0)) && IsUsDst(ShimTimegm(2025, 3, 9, 7, 0, 0)), "début heure d'été USA");
  CHECK(IsUsDst(ShimTimegm(2025, 11, 2, 5, 59, 0)) && !IsUsDst(ShimTimegm(2025, 11, 2, 6, 0, 0)), "fin heure d'été USA");
  // 2025-07-01 12:00 UTC : Londres 13:00, New York 08:00
  datetime u = ShimTimegm(2025, 7, 1, 12, 0, 0);
  CHECK(MinuteOfDay(UtcToLondon(u)) == 13 * 60 && MinuteOfDay(UtcToNewYork(u)) == 8 * 60, "conversion Londres/NY été");
  datetime w = ShimTimegm(2025, 1, 15, 12, 0, 0);
  CHECK(MinuteOfDay(UtcToLondon(w)) == 12 * 60 && MinuteOfDay(UtcToNewYork(w)) == 7 * 60, "conversion Londres/NY hiver");
  CHECK(HashString("abc") == 0x1A47E90Bu, "FNV-1a de 'abc'");
  CHECK(StepDigits(0.01) == 2 && StepDigits(1.0) == 0 && StepDigits(0.001) == 3 && StepDigits(0.1) == 1, "StepDigits");
  CHECK(SafeDiv(1.0, 0.0, -7.0) == -7.0, "SafeDiv protège la division par zéro");
  CHECK(GlsDayOfWeek(ShimTimegm(2025, 3, 10, 12, 0, 0)) == 1, "lundi 10 mars 2025");
  CHECK(LastSundayOfMonth(2025, 3) == ShimTimegm(2025, 3, 30, 0, 0, 0), "dernier dimanche de mars 2025");
  CHECK(NthSundayOfMonth(2025, 11, 1) == ShimTimegm(2025, 11, 2, 0, 0, 0), "1er dimanche de novembre 2025");
}

static void TestIndicators()
{
  CBarSeries s;
  std::vector<Bar> bars;
  for (int i = 0; i < 30; i++)
    bars.push_back({100.0 + i, 101.0 + i, 99.0 + i, 100.5 + i});
  FillSeries(s, 0, bars);
  MqlArray<double> atr;
  CalcATR(s, 14, atr);
  CHECK(atr[12] == 0.0, "ATR nul avant la période");
  CHECK_NEAR(atr[29], 2.0, 1e-9, "ATR (TR = 2 constant)");
  MqlArray<double> ema;
  CalcEMA(s.close, s.count, 10, ema);
  CHECK_NEAR(ema[9], (100.5 + 109.5) / 2.0, 1e-9, "EMA amorcée par la moyenne simple");
  CHECK(ema[29] > ema[20], "EMA croissante sur tendance haussière");
  CHECK_NEAR(EfficiencyRatio(s, 29, 10), 1.0, 1e-9, "efficiency ratio d'une tendance pure");
  CBarSeries m;
  m.MirrorFrom(s);
  CHECK(m.high[5] == -s.low[5] && m.low[5] == -s.high[5] && m.close[5] == -s.close[5], "série miroir");
  string err;
  CHECK(s.Validate(err), "validation d'une série cohérente");
  s.high[3] = 50.0;
  CHECK(!s.Validate(err), "détection d'une barre OHLC incohérente");
}

static void TestStructure()
{
  // zigzag : creux 10, sommet 20, creux 12 (HL), sommet 25 (HH)... puis cassure
  std::vector<Bar> b;
  auto up = [&](double from, double to, int n) {
    for (int i = 1; i <= n; i++)
    {
      double c = from + (to - from) * i / n;
      double o = from + (to - from) * (i - 1) / n;
      b.push_back({o, std::max(o, c) + 0.1, std::min(o, c) - 0.1, c});
    }
  };
  up(15, 10, 5);
  up(10, 20, 5);
  up(20, 12, 5);
  up(12, 25, 6);
  up(25, 16, 5);
  up(16, 30, 7);
  CBarSeries s;
  FillSeries(s, 0, b);
  CStructure st;
  st.Analyze(s, 2, 10, 0.3, 6);
  CHECK(ArraySize(st.highs) >= 2 && ArraySize(st.lows) >= 2, "swings détectés");
  CHECK(st.trend == GLS_TREND_BULL, "tendance haussière après cassures");
  CHECK(st.lastEvent == GLS_EVT_BOS_UP, "dernier événement : BOS haussier");
  CHECK(st.swingBias == 1, "séquence HH/HL");
  // cassure baissière d'un creux en tendance haussière = CHOCH
  up(30, 10, 8);
  CBarSeries s2;
  FillSeries(s2, 0, b);
  st.Analyze(s2, 2, 10, 0.3, 6);
  CHECK(st.trend == GLS_TREND_BEAR && st.lastEvent == GLS_EVT_CHOCH_DOWN, "CHOCH baissier");
  CHECK(st.OppositeEventAfter(GLS_BUY, 0) && !st.OppositeEventAfter(GLS_SELL, 0), "événement contraire pour un achat");
  // pas de swing confirmé avant k barres à droite (aucune donnée future)
  CBarSeries s3;
  FillSeries(s3, 0, std::vector<Bar>(b.begin(), b.begin() + 12));
  CHECK(!IsSwingHigh(s3, 10, 2), "swing non confirmé sans barres de droite");
}

static void TestSymbolAndRisk()
{
  SimState &S = Sim();
  S.digits = 2;
  S.point = 0.01;
  S.tickSize = 0.01;
  S.bid = 2000.00;
  S.ask = 2000.20;
  S.balance = 1000.0;
  CHECK(g_sym.Detect("", "XAUUSDm"), "détection du symbole or");
  CHECK(!CGlsSymbol::IsGoldUsd("EURUSD"), "EURUSD n'est pas de l'or");
  CGlsSymbol other;
  CHECK(!other.Detect("", "EURUSD"), "refus d'un graphique non or");
  CHECK(g_sym.FloorVolume(0.0379) == 0.03, "volume arrondi vers le bas");
  CHECK(g_sym.FloorVolume(0.03) == 0.03, "volume exact conservé");
  CHECK(g_sym.FloorPrice(1999.999) == 1999.99 && g_sym.CeilPrice(1999.991) == 2000.00, "arrondis de prix");
  double loss = 0;
  string d;
  CHECK(LossPerLot(GLS_BUY, 2000.20, 1998.20, loss, d), "valorisation de la perte");
  CHECK_NEAR(loss, 200.0, 1e-6, "perte au stop pour 1 lot (2 USD x 100 oz)");
  // 0.5 % de 1000 = 5 ; perte/lot = (2.00 + 0.05 glissement) x 100 = 205 -> 0.0243 -> 0.02
  SSizing sz;
  bool ok = ComputeVolume(GLS_BUY, 2000.20, 1998.20, 1000.0, 1000.0, 1e9, 0.0, 0.0, sz);
  CHECK(ok && sz.volume == 0.02, "volume = budget / perte par lot, arrondi bas : " << sz.volume);
  CHECK(sz.riskPct <= InpRiskPercent + 1e-9, "risque effectif <= budget");
  // budget plafonné par les protections
  ok = ComputeVolume(GLS_BUY, 2000.20, 1998.20, 1000.0, 1000.0, 2.0, 0.0, 0.0, sz);
  CHECK(!ok && sz.refusal == GLS_REFUSE_MIN_VOLUME, "budget de protection trop faible -> refus");
  // compte de 10 : le volume minimal dépasse le budget -> refus (jamais de relèvement du risque)
  ok = ComputeVolume(GLS_BUY, 2000.20, 1998.20, 10.0, 10.0, 1e9, 0.0, 0.0, sz);
  CHECK(!ok && sz.refusal == GLS_REFUSE_MIN_VOLUME, "compte de 10 : refus volume minimal");
  CHECK(sz.minLotRiskPct > 10.0, "risque au volume minimal affiché : " << sz.minLotRiskPct);
  // marge insuffisante
  S.leverage = 1;
  ok = ComputeVolume(GLS_BUY, 2000.20, 1998.20, 1000.0, 1000.0, 1e9, 0.0, 0.0, sz);
  CHECK(!ok && sz.refusal == GLS_REFUSE_MARGIN, "marge insuffisante -> refus");
  S.leverage = 200;
  // commission prise en compte
  ok = ComputeVolume(GLS_BUY, 2000.20, 1998.20, 10000.0, 10000.0, 1e9, 3.5, 0.0, sz);
  CHECK(ok && sz.commissionPerLot == 7.0 && sz.volume == 0.23, "commission aller-retour incluse : " << sz.volume);
  // découpage des sorties
  int plan = 0;
  double v1 = 0, v2 = 0;
  PlanExitParts(0.03, plan, v1, v2);
  CHECK(plan == GLS_EXITPLAN_THIRDS && v1 == 0.01 && v2 == 0.01, "0.03 -> tiers");
  PlanExitParts(0.10, plan, v1, v2);
  CHECK(plan == GLS_EXITPLAN_THIRDS && v1 == 0.03 && v2 == 0.03, "0.10 -> 0.03/0.03/0.04");
  PlanExitParts(0.02, plan, v1, v2);
  CHECK(plan == GLS_EXITPLAN_HALVES && v1 == 0.01, "0.02 -> moitiés");
  PlanExitParts(0.01, plan, v1, v2);
  CHECK(plan == GLS_EXITPLAN_SINGLE && v1 == 0.0, "0.01 -> objectif unique (pas de micro-position)");
}

static void TestComments()
{
  string c = BuildEntryComment(1, GLS_BUY, true, 86.4, "7F3A9C") + " 235";
  CHECK(StringLen(c) <= 31, "commentaire d'entrée <= 31 caractères : " << c);
  int f = 0, d = 0;
  bool rt = false;
  double sc = 0;
  string h;
  CHECK(ParseEntryComment(c, f, d, rt, sc, h) && f == 1 && d == GLS_BUY && rt && sc == 86.0 && h == "7F3A9C", "aller-retour du commentaire d'entrée");
  CHECK(!ParseEntryComment("manuel", f, d, rt, sc, h), "commentaire étranger ignoré");
  CHECK(ParseExitCode(BuildExitComment("TP1", "ABC")) == "TP1", "code de sortie");
  CHECK(GlsExitFromCode("INV") == GLS_EXIT_INVALIDATION && GlsExitFromCode("zz") == GLS_EXIT_UNKNOWN, "raison de sortie depuis le code");
}

static void TestSweepDetection()
{
  InpUseExternalLevels = false;
  std::vector<Bar> bars = SweepBuyBars();
  PrepareM1Context(bars);
  CDirView vb, vs;
  vb.Build(g_ctx, GLS_BUY);
  vs.Build(g_ctx, GLS_SELL);
  SSignal sig;
  DetectFamily(GLS_FAMILY_SWEEP, g_ctx, vb, sig);
  CHECK(sig.valid, "balayage haussier détecté : " << sig.detail);
  CHECK_NEAR(sig.level, 1995.0, 1e-9, "niveau balayé");
  CHECK_NEAR(sig.extreme, 1994.6, 1e-9, "extrême du balayage");
  CHECK(sig.stop < 1994.6, "stop sous l'extrême");
  CHECK(!sig.retestEntry, "entrée à la confirmation");
  SSignal sell;
  DetectFamily(GLS_FAMILY_SWEEP, g_ctx, vs, sell);
  CHECK(!sell.valid, "pas de vente sur ce schéma");
  // filtre de régime actif sans M15 (régime inconnu) : refus, jamais d'autorisation par défaut
  InpUseEmaFilter = false;
  InpMinScore = 0;
  SSignal sigRg = sig;
  FinalizeSignal(sigRg, g_ctx, vb, 1997.00, 1997.20, 0.0, 1741600800 + 115 * 60);
  CHECK(sigRg.refusal == GLS_REFUSE_REGIME, "régime inconnu -> refus : " << GlsRefusalText(sigRg.refusal).s);
  // finalisation : prix réels, score borné (contexte M5/M15 absent de ce test unitaire)
  InpUseRegimeFilter = false;
  FinalizeSignal(sig, g_ctx, vb, 1997.00, 1997.20, 0.0, 1741600800 + 115 * 60);
  CHECK(sig.score >= 0.0 && sig.score <= 100.0, "score borné : " << sig.score);
  CHECK(sig.stop < sig.entryPrice && sig.riskDist > 0.0, "stop sous l'entrée");
  CHECK(sig.refusal == GLS_REFUSE_NONE, "aucun refus avec seuil 0 : " << GlsRefusalText(sig.refusal).s);
  std::string id1 = sig.id.s;
  // même schéma en miroir : vente symétrique
  ResetEaMemory();
  InpUseExternalLevels = false;
  PrepareM1Context(MirrorBars(bars, 4000.0));
  vb.Build(g_ctx, GLS_BUY);
  vs.Build(g_ctx, GLS_SELL);
  SSignal s2;
  DetectFamily(GLS_FAMILY_SWEEP, g_ctx, vs, s2);
  CHECK(s2.valid, "balayage baissier (miroir) détecté");
  FinalizeSignal(s2, g_ctx, vs, 2003.00, 2003.20, 0.0, 1741600800 + 115 * 60);
  CHECK_NEAR(s2.level, 2005.0, 1e-9, "niveau miroir");
  CHECK(s2.stop > 2005.4 + 0.2, "stop de vente au-dessus de l'extrême + spread");
  CHECK(s2.dir == GLS_SELL && s2.id.s != id1, "identifiant distinct");
  // continuation (acceptation sous le niveau) : pas un balayage
  ResetEaMemory();
  InpUseExternalLevels = false;
  std::vector<Bar> cont = SweepBuyBars();
  cont[cont.size() - 2] = {1995.4, 1995.6, 1994.6, 1994.7};
  cont[cont.size() - 1] = {1994.7, 1994.8, 1993.9, 1994.0};
  PrepareM1Context(cont);
  vb.Build(g_ctx, GLS_BUY);
  SSignal s3;
  DetectFamily(GLS_FAMILY_SWEEP, g_ctx, vb, s3);
  CHECK(!s3.valid, "cassure qui continue : refusée");
  // un balayage trop profond est une vraie cassure
  ResetEaMemory();
  InpUseExternalLevels = false;
  std::vector<Bar> deep = SweepBuyBars();
  deep[deep.size() - 2] = {1995.4, 1995.6, 1990.0, 1995.3};
  PrepareM1Context(deep);
  vb.Build(g_ctx, GLS_BUY);
  SSignal s4;
  DetectFamily(GLS_FAMILY_SWEEP, g_ctx, vb, s4);
  CHECK(!s4.valid, "balayage trop profond refusé");
  // mode retest : pas d'entrée à la confirmation
  ResetEaMemory();
  InpUseExternalLevels = false;
  InpEntryMode = GLS_ENTRY_RETEST;
  PrepareM1Context(SweepBuyBars());
  vb.Build(g_ctx, GLS_BUY);
  SSignal s5;
  DetectFamily(GLS_FAMILY_SWEEP, g_ctx, vb, s5);
  CHECK(!s5.valid && s5.refusal == GLS_REFUSE_INCOMPLETE, "mode retest : attente du retest");
  // ... puis retest valide de la zone
  std::vector<Bar> rt = SweepBuyBars();
  rt.push_back({1996.4, 1996.9, 1995.6, 1996.8}); // retest haussier de la zone
  ResetEaMemory();
  InpUseExternalLevels = false;
  InpEntryMode = GLS_ENTRY_RETEST;
  PrepareM1Context(rt);
  vb.Build(g_ctx, GLS_BUY);
  SSignal s6;
  DetectFamily(GLS_FAMILY_SWEEP, g_ctx, vb, s6);
  CHECK(s6.valid && s6.retestEntry, "entrée sur retest");
}

static void TestOtherFamilies()
{
  // F3 : range 1998-2001 (contacts multiples), cassure, confirmation, retest
  std::vector<Bar> r = FlatPrefix(80, 1999.5, 0.5);
  for (int i = 0; i < 30; i++)
  {
    if (i % 4 == 0)
      r.push_back({1999.5, 2001.0, 1999.2, 2000.6});
    else if (i % 4 == 2)
      r.push_back({1999.5, 1999.8, 1998.0, 1998.4});
    else
      r.push_back({1999.4, 1999.9, 1999.0, 1999.5});
  }
  r.push_back({1999.6, 2002.4, 1999.5, 2002.2}); // cassure
  r.push_back({2002.2, 2002.9, 2002.0, 2002.6}); // confirmation
  r.push_back({2002.0, 2002.5, 2001.2, 2002.4}); // retest haussier du haut du range
  PrepareM1Context(r);
  CDirView vb;
  vb.Build(g_ctx, GLS_BUY);
  SSignal s;
  DetectFamily(GLS_FAMILY_RANGE_BREAK, g_ctx, vb, s);
  CHECK(s.valid, "F3 cassure de range + retest : " << s.detail);
  CHECK_NEAR(s.level, 2001.0, 1e-9, "F3 niveau = haut du range");

  // F4 : compression puis expansion confirmée
  ResetEaMemory();
  std::vector<Bar> q = FlatPrefix(100, 2000.0, 0.5);
  for (int i = 0; i < 14; i++)
    q.push_back({2000.0, 2000.15, 1999.85, i % 2 ? 2000.1 : 1999.9});
  q.push_back({2000.1, 2002.1, 2000.0, 2002.0}); // expansion
  q.push_back({2002.0, 2002.6, 2001.5, 2002.4}); // confirmation
  PrepareM1Context(q);
  vb.Build(g_ctx, GLS_BUY);
  SSignal s4;
  DetectFamily(GLS_FAMILY_SQUEEZE, g_ctx, vb, s4);
  CHECK(s4.valid, "F4 compression + expansion : " << s4.detail);

  // F2 : impulsion 1995 -> 2000, pullback à 1997.5, reprise
  ResetEaMemory();
  std::vector<Bar> p = FlatPrefix(100, 1995.0, 0.4);
  double px = 1995.0;
  for (int i = 0; i < 10; i++)
  {
    p.push_back({px, px + 0.6, px - 0.1, px + 0.5});
    px += 0.5;
  }
  p.push_back({2000.0, 2000.3, 1999.6, 1999.8}); // sommet H = 2000.3
  p.push_back({1999.8, 1999.9, 1998.9, 1999.0});
  p.push_back({1999.0, 1999.5, 1998.4, 1999.2}); // micro-sommet 1999.5
  p.push_back({1999.2, 1999.3, 1997.8, 1998.0});
  p.push_back({1998.0, 1998.3, 1997.5, 1997.9}); // creux du pullback 1997.5
  p.push_back({1997.9, 1999.8, 1997.8, 1999.7}); // reprise : clôture > 1999.5 et < 2000.3
  PrepareM1Context(p);
  vb.Build(g_ctx, GLS_BUY);
  SSignal s2;
  DetectFamily(GLS_FAMILY_PULLBACK, g_ctx, vb, s2);
  CHECK(s2.valid, "F2 pullback + reprise : " << s2.detail);
  CHECK_NEAR(s2.extreme, 1997.5, 1e-9, "F2 creux du pullback");
}

static void TestGuard()
{
  g_store.Init(1, 1);
  g_guard.Init(ShimTimegm(2025, 3, 10, 12, 0, 0), 1000.0, false);
  g_guard.dayStartEquity = 1000.0;
  g_guard.SetDayFigures(2, 0, 2, -25.0, 2);
  g_guard.SetOpenExposure(0.0, 0.0);
  g_guard.Evaluate(975.0);
  CHECK(g_guard.dailyLossHit && g_guard.EntryBlockReason(0) == GLS_REFUSE_DAILY_LOSS, "limite de perte journalière (2 %)");
  g_guard.SetDayFigures(2, 0, 2, -15.0, 1);
  g_guard.SetOpenExposure(-1.0, -5.0);
  g_guard.Evaluate(984.0);
  CHECK(!g_guard.dailyLossHit, "sous la limite");
  CHECK_NEAR(g_guard.RiskBudgetMoney(984.0), 0.0, 1e-9, "budget = limite - perte réalisée - risque ouvert");
  g_guard.SetDayFigures(2, 0, 3, -5.0, 3);
  g_guard.SetOpenExposure(0.0, 0.0);
  g_guard.Evaluate(995.0);
  CHECK(g_guard.EntryBlockReason(0) == GLS_REFUSE_CONSEC_LOSSES, "3 pertes consécutives");
  g_guard.SetDayFigures(15, 8, 7, 5.0, 0);
  g_guard.Evaluate(1005.0);
  CHECK(g_guard.EntryBlockReason(0) == GLS_REFUSE_DAILY_TRADES, "15 trades du jour");
  CHECK(g_guard.CheckRollover(ShimTimegm(2025, 3, 11, 0, 1, 0), 1005.0), "nouvelle journée");
  g_guard.Evaluate(1005.0);
  CHECK(g_guard.EntryBlockReason(0) == GLS_REFUSE_NONE && g_guard.tradesToday == 0, "compteurs remis à zéro");
  g_guard.peakEquity = 1200.0;
  g_guard.Evaluate(1070.0);
  CHECK(g_guard.drawdownHit && g_guard.EntryBlockReason(0) == GLS_REFUSE_DRAWDOWN, "drawdown 10.8 % > 10 %");
  g_guard.OnExecError(100, "test");
  CHECK(g_guard.cooldownUntil == 100 + InpErrorCooldownSec, "refroidissement après erreur");
}

static void TestStatsAggregation()
{
  SimState &S = Sim();
  S.digits = 2;
  S.point = 0.01;
  S.tickSize = 0.01;
  S.bid = 2000.0;
  S.ask = 2000.2;
  S.now = ShimTimegm(2025, 3, 10, 10, 0, 0);
  g_sym.Detect("", "XAUUSDm");
  MqlTradeRequest r = {};
  MqlTradeResult res = {};
  r.action = TRADE_ACTION_DEAL;
  r.symbol = "XAUUSDm";
  r.volume = 0.03;
  r.type = ORDER_TYPE_BUY;
  r.price = S.ask;
  r.sl = 1998.0;
  r.deviation = 50;
  r.magic = 7;
  r.type_filling = ORDER_FILLING_FOK;
  r.comment = BuildEntryComment(1, GLS_BUY, false, 85, "ABCDEF") + " 220";
  CHECK(OrderSend(r, res) && res.retcode == TRADE_RETCODE_DONE, "ouverture simulée");
  ulong t = res.order;
  string msg;
  g_trader.Init(7, 50);
  S.now += 60;
  S.bid = 2002.4;
  S.ask = 2002.6;
  CHECK(g_trader.ClosePosition(t, 0.01, BuildExitComment("TP1", "ABCDEF"), msg), "TP1 partiel : " << msg.s);
  S.now += 60;
  S.bid = 2004.6;
  S.ask = 2004.8;
  CHECK(g_trader.ClosePosition(t, 0.01, BuildExitComment("TP2", "ABCDEF"), msg), "TP2 partiel");
  S.now += 60;
  S.bid = 2003.0;
  S.ask = 2003.2;
  CHECK(g_trader.ClosePosition(t, 0.0, BuildExitComment("INV", "ABCDEF"), msg), "clôture du reste");
  STradeRecord rec;
  CHECK(BuildRecordFromHistory((long)t, rec), "reconstitution depuis l'historique");
  CHECK(rec.complete && rec.volume == 0.03, "volume total agrégé");
  double expected = (2002.4 - 2000.2) * 0.01 * 100 + (2004.6 - 2000.2) * 0.01 * 100 + (2003.0 - 2000.2) * 0.01 * 100;
  CHECK_NEAR(rec.net, expected, 1e-6, "résultat net = somme des 3 sorties");
  CHECK(rec.family == 1 && rec.hash == "ABCDEF", "famille et empreinte relues");
  CHECK(ExitReasonFromHistory(rec, -1) == GLS_EXIT_INVALIDATION, "raison de sortie relue dans le commentaire");
  g_stats.Clear();
  rec.riskMoney = 6.0;
  rec.rMultiple = rec.net / 6.0;
  g_stats.Add(rec);
  STradeRecord loss = rec;
  loss.posId = 99;
  loss.net = -6.0;
  loss.rMultiple = -1.0;
  loss.closeTime = rec.closeTime + 100;
  g_stats.Add(loss);
  g_stats.Add(loss); // doublon ignoré
  g_stats.Compute();
  CHECK(g_stats.total == 2 && g_stats.wins == 1 && g_stats.losses == 1, "2 trades (partiels non comptés séparément)");
  CHECK_NEAR(g_stats.WinRate(), 50.0, 1e-9, "taux de réussite");
  CHECK_NEAR(g_stats.ProfitFactor(), expected / 6.0, 1e-9, "profit factor");
  CHECK_NEAR(g_stats.maxDD, 6.0, 1e-9, "drawdown des résultats clôturés");
}

//==========================================================================
// Intégration : courtier simulé + données synthétiques
//==========================================================================
static std::vector<MqlRates> GenerateBars(datetime start, int days, unsigned seed, double startPrice)
{
  std::mt19937 rng(seed);
  std::normal_distribution<double> n01(0.0, 1.0);
  std::vector<MqlRates> out;
  double px = startPrice;
  double vol = 1.0;
  for (int d = 0; d < days; d++)
  {
    datetime day = start + (datetime)d * 86400;
    int dow = GlsDayOfWeek(day);
    if (dow == 0 || dow == 6)
      continue;
    for (int m = 0; m < 1440; m++)
    {
      if (m >= 21 * 60 && m < 22 * 60)
        continue; // pause quotidienne
      double sess = (m >= 7 * 60 && m < 16 * 60) ? 1.3 : ((m >= 13 * 60 && m < 17 * 60) ? 1.6 : 0.6);
      vol = 0.97 * vol + 0.03 * (0.6 + std::fabs(n01(rng)));
      double sigma = 0.65 * sess * vol;
      MqlRates r{};
      r.time = day + m * 60;
      r.open = px;
      double hi = px, lo = px;
      for (int k = 0; k < 4; k++)
      {
        px += sigma * 0.5 * n01(rng);
        hi = std::max(hi, px);
        lo = std::min(lo, px);
      }
      r.high = std::round(hi * 100.0) / 100.0;
      r.low = std::round(lo * 100.0) / 100.0;
      r.close = std::round(px * 100.0) / 100.0;
      r.open = std::round(r.open * 100.0) / 100.0;
      r.high = std::max({r.high, r.open, r.close});
      r.low = std::min({r.low, r.open, r.close});
      r.tick_volume = 100;
      out.push_back(r);
    }
  }
  return out;
}

struct RunStats
{
  int maxConcurrent = 0;
  int disconnectedEntries = 0;
};

//--- rejoue les barres [from, to) : 4 cotations par barre (O, H/L, L/H, C)
static void ReplayBars(size_t from, size_t to, double spread, RunStats &rs, std::function<void(size_t)> perBar = nullptr)
{
  SimState &S = Sim();
  for (size_t i = from; i < to && i < S.m1.size(); i++)
  {
    const MqlRates &b = S.m1[i];
    bool bull = b.close >= b.open;
    double pts[4] = {b.open, bull ? b.low : b.high, bull ? b.high : b.low, b.close};
    datetime ts[4] = {b.time, b.time + 15, b.time + 30, b.time + 55};
    for (int k = 0; k < 4; k++)
    {
      S.now = ts[k];
      S.bid = pts[k];
      S.ask = pts[k] + spread;
      bool gap = (k == 0 && i > from && S.m1[i - 1].time + 60 != b.time);
      SimProcessStops(gap);
      size_t inBefore = 0;
      for (const SimDeal &d : S.deals)
        if (d.entry == DEAL_ENTRY_IN)
          inBefore++;
      OnTick();
      OnTimer();
      if (!S.connected)
      {
        size_t inAfter = 0;
        for (const SimDeal &d : S.deals)
          if (d.entry == DEAL_ENTRY_IN)
            inAfter++;
        rs.disconnectedEntries += (int)(inAfter - inBefore);
      }
      int conc = 0;
      for (const SimPosition &p : S.positions)
        if (p.magic == (ulong)InpMagic)
          conc++;
      rs.maxConcurrent = std::max(rs.maxConcurrent, conc);
    }
    if (perBar)
      perBar(i);
  }
}

static size_t IndexAtOrAfter(datetime t)
{
  const std::vector<MqlRates> &v = Sim().m1;
  for (size_t i = 0; i < v.size(); i++)
    if (v[i].time >= t)
      return i;
  return v.size();
}

static double g_initialBalance = 0.0;

static void SetupMarket(double balance, int days, unsigned seed)
{
  SimState &S = Sim();
  g_initialBalance = balance;
  S.digits = 2;
  S.point = 0.01;
  S.tickSize = 0.01;
  S.balance = balance;
  S.m1 = GenerateBars(ShimTimegm(2025, 3, 3, 0, 0, 0), days, seed, 2900.0);
  SimBuildAggregates();
}

//--- démarre l'EA au début du jour 'startDay' (laisse l'historique de chauffe)
static size_t StartEa(int startDay)
{
  SimState &S = Sim();
  size_t i0 = IndexAtOrAfter(ShimTimegm(2025, 3, 3, 0, 0, 0) + (datetime)startDay * 86400);
  S.now = S.m1[i0].time;
  S.bid = S.m1[i0].open;
  S.ask = S.bid + 0.20;
  int rc = OnInit();
  CHECK(rc == INIT_SUCCEEDED, "OnInit : " << rc);
  return i0;
}

static int CountMagicIn()
{
  int n = 0;
  for (const SimDeal &d : Sim().deals)
    if (d.entry == DEAL_ENTRY_IN && d.magic == (ulong)InpMagic)
      n++;
  return n;
}

static void CheckRunInvariants(const RunStats &rs, const char *label)
{
  SimState &S = Sim();
  CHECK(S.slViolations.empty(), label << " : stop élargi/supprimé (" << (S.slViolations.empty() ? std::string("") : S.slViolations[0]) << ")");
  CHECK(rs.maxConcurrent <= InpMaxOpenPositions, label << " : positions simultanées " << rs.maxConcurrent);
  // chaque ouverture porte un stop
  for (const SimHistOrder &o : S.orders)
    CHECK(o.sl > 0.0, label << " : ordre #" << o.ticket << " ouvert sans stop");
  // prises partielles uniques par position
  std::map<long, int> tp1, tp2;
  std::map<std::string, int> perDay;
  for (const SimDeal &d : S.deals)
  {
    if (d.comment.find("GLS TP1") == 0)
      tp1[d.positionId]++;
    if (d.comment.find("GLS TP2") == 0)
      tp2[d.positionId]++;
    if (d.entry == DEAL_ENTRY_IN && d.magic == (ulong)InpMagic)
      perDay[TimeToString(d.time, TIME_DATE).s]++;
  }
  for (auto &kv : tp1)
    CHECK(kv.second <= 1, label << " : TP1 dupliqué sur #" << kv.first);
  for (auto &kv : tp2)
    CHECK(kv.second <= 1, label << " : TP2 dupliqué sur #" << kv.first);
  for (auto &kv : perDay)
    CHECK(kv.second <= InpMaxTradesPerDay, label << " : " << kv.second << " trades le " << kv.first);
  // statistiques = positions fermées (une ligne par position)
  int closed = 0;
  std::set<long> ids;
  for (const SimDeal &d : S.deals)
    if (d.entry == DEAL_ENTRY_IN && d.magic == (ulong)InpMagic)
      ids.insert(d.positionId);
  for (long id : ids)
  {
    bool open = false;
    for (const SimPosition &p : S.positions)
      if (p.identifier == id)
        open = true;
    if (!open)
      closed++;
  }
  CHECK(g_stats.total == closed, label << " : statistiques " << g_stats.total << " vs positions fermées " << closed);
  for (int i = 0; i < ArraySize(g_stats.trades); i++)
  {
    const STradeRecord &t = g_stats.trades[i];
    CHECK(t.rMultiple > -1.4, label << " : perte au-delà du risque prévu (" << t.rMultiple << " R)");
    CHECK(t.riskMoney > 0.0, label << " : risque initial inconnu");
    double cap = InpRiskPercent / 100.0 * (g_initialBalance + std::max(0.0, g_stats.net)) * 1.02;
    CHECK(t.riskMoney <= cap, label << " : risque par trade " << t.riskMoney << " > plafond " << cap);
  }
}

static void FlushTimers(int n)
{
  for (int i = 0; i < n; i++)
  {
    Sim().now += 3;
    OnTimer();
  }
}

static void TestPipelineFamily(int family, bool relax)
{
  SetupMarket(10000.0, 19, 1234u + (unsigned)family);
  if (relax)
    RelaxContextFilters();
  InpFamily = (ENUM_GLS_FAMILY)family;
  InpMinScore = 0;
  InpNewsMode = GLS_NEWS_OFF;
  // paramètres assouplis UNIQUEMENT pour exercer tous les chemins de code sur une
  // marche aléatoire (les configurations F3/F4 y sont rares)
  InpUseSessions = false;
  InpRangeMaxATR = 8.0;
  InpBreakoutMaxAge = 25;
  InpSqueezeBoxATR = 4.0;
  InpSqueezeATRRatio = 1.2;
  InpExpansionTRATR = 1.0;
  size_t i0 = StartEa(7);
  RunStats rs;
  ReplayBars(i0, Sim().m1.size(), 0.20, rs);
  FlushTimers(5);
  int entries = CountMagicIn();
  std::string label = "F" + std::to_string(family) + (relax ? " (filtres v1.10 désactivés)" : " (paramètres par défaut)");
  CHECK(entries > 0, label << " : aucune entrée sur 12 jours de données synthétiques (règles inatteignables ?)");
  CheckRunInvariants(rs, label.c_str());
  // le fichier de trades contient une ligne par position fermée
  std::string base = "GLS\\" + g_log.Base().s + "_trades.csv";
  int lines = 0;
  for (char c : Sim().files[base])
    if (c == '\n')
      lines++;
  CHECK(lines == g_stats.total + (g_stats.total > 0 ? 1 : 0), label << " : lignes CSV " << lines << " pour " << g_stats.total << " trades");
  std::map<std::string, int> exits;
  for (int i = 0; i < ArraySize(g_stats.trades); i++)
    exits[GlsExitCode(g_stats.trades[i].exitReason).s]++;
  std::cout << "         " << label << " : " << entries << " entrées, " << g_stats.total << " clôturées, sorties :";
  for (auto &kv : exits)
    std::cout << " " << kv.first << "=" << kv.second;
  std::cout << " (données synthétiques, sans valeur de performance)\n";
  OnDeinit(0);
}

static void TestPipelineF1() { TestPipelineFamily(GLS_FAMILY_SWEEP, true); }
static void TestPipelineF2() { TestPipelineFamily(GLS_FAMILY_PULLBACK, true); }
static void TestPipelineF3() { TestPipelineFamily(GLS_FAMILY_RANGE_BREAK, true); }
static void TestPipelineF4() { TestPipelineFamily(GLS_FAMILY_SQUEEZE, true); }
static void TestPipelineF5() { TestPipelineFamily(GLS_FAMILY_SR_BOUNCE, false); }
static void TestPipelineF6() { TestPipelineFamily(GLS_FAMILY_FVG, false); }

//--- redémarrage après une prise partielle : aucune prise partielle rejouée
static void TestRestartAfterPartial(bool wipeGlobals)
{
  SetupMarket(10000.0, 19, 777u);
  RelaxContextFilters();
  InpMinScore = 0;
  InpNewsMode = GLS_NEWS_OFF;
  InpRiskPercent = 1.0;
  InpMaxTotalRiskPct = 2.0;
  size_t i0 = StartEa(7);
  SimState &S = Sim();
  RunStats rs;
  // avance barre par barre jusqu'à une position ouverte ayant déjà pris TP1
  size_t i = i0;
  ulong target = 0;
  double riskDistBefore = 0, ivolBefore = 0;
  for (; i < S.m1.size() && target == 0; i++)
  {
    ReplayBars(i, i + 1, 0.20, rs);
    for (const SimDeal &d : S.deals)
      if (d.comment.find("GLS TP1") == 0)
        for (const SimPosition &p : S.positions)
          if (p.identifier == d.positionId && p.magic == (ulong)InpMagic)
            target = p.ticket;
  }
  CHECK(target != 0, "aucune position avec TP1 atteint dans les données (scénario non exercé)");
  if (target == 0)
    return;
  int idx = g_pm.Find(target);
  CHECK(idx >= 0, "plan présent avant redémarrage");
  if (idx >= 0)
  {
    riskDistBefore = g_pm.plans[idx].riskDist;
    ivolBefore = g_pm.plans[idx].initialVolume;
  }
  // --- arrêt du programme
  OnDeinit(0);
  if (wipeGlobals)
    S.gvars.clear(); // variables globales perdues : reconstruction depuis le serveur
  ResetEaMemory();
  S.now += 30;
  CHECK(OnInit() == INIT_SUCCEEDED, "OnInit après redémarrage");
  idx = g_pm.Find(target);
  CHECK(idx >= 0, "position reprise après redémarrage");
  if (idx >= 0)
  {
    CHECK(g_pm.plans[idx].recovered == wipeGlobals, "plan " << (wipeGlobals ? "reconstruit" : "relu"));
    CHECK_NEAR(g_pm.plans[idx].initialVolume, ivolBefore, 1e-9, "volume initial retrouvé");
    CHECK_NEAR(g_pm.plans[idx].riskDist, riskDistBefore, 0.011, "risque initial (R) retrouvé");
  }
  if (!wipeGlobals)
    CHECK(g_engine.running, "état « démarré » mémorisé");
  ReplayBars(i, S.m1.size(), 0.20, rs);
  FlushTimers(5);
  CheckRunInvariants(rs, wipeGlobals ? "redémarrage sans variables globales" : "redémarrage");
}
static void TestRestartKeepGlobals() { TestRestartAfterPartial(false); }
static void TestRestartWipeGlobals() { TestRestartAfterPartial(true); }

//--- position sans stop sur le serveur : protection posée, ou fermeture si impossible
static void NoStopScenario(bool rejectSLTP)
{
  SetupMarket(10000.0, 10, 99u);
  SimState &S = Sim();
  size_t i0 = IndexAtOrAfter(ShimTimegm(2025, 3, 3, 0, 0, 0) + 7 * 86400 + 9 * 3600);
  S.now = S.m1[i0].time;
  S.bid = S.m1[i0].open;
  S.ask = S.bid + 0.2;
  MqlTradeRequest r = {};
  MqlTradeResult res = {};
  r.action = TRADE_ACTION_DEAL;
  r.symbol = S.symbol;
  r.volume = 0.05;
  r.type = ORDER_TYPE_BUY;
  r.price = S.ask;
  r.deviation = 100;
  r.magic = (ulong)InpMagic;
  r.type_filling = ORDER_FILLING_FOK;
  r.comment = BuildEntryComment(1, GLS_BUY, false, 85, "ABC123") + " 500";
  OrderSend(r, res);
  S.rejectSLTP = rejectSLTP;
  CHECK(OnInit() == INIT_SUCCEEDED, "OnInit");
  RunStats rs;
  ReplayBars(i0, i0 + 3, 0.20, rs);
  if (rejectSLTP)
  {
    CHECK(S.positions.empty(), "position sans stop fermée par sécurité");
    bool nosl = false;
    for (const SimDeal &d : S.deals)
      if (d.comment.find("GLS NOSL") == 0)
        nosl = true;
    CHECK(nosl, "sortie journalisée NOSL");
    CHECK(!S.alerts.empty() || S.tester, "alerte critique");
  }
  else
  {
    CHECK(S.positions.size() == 1 && S.positions[0].sl > 0.0, "stop de protection posé");
    if (!S.positions.empty())
      CHECK_NEAR(S.positions[0].priceOpen - S.positions[0].sl, 5.0, 0.011, "stop au risque initial du commentaire (500 pts)");
  }
}
static void TestNoStopProtect() { NoStopScenario(false); }
static void TestNoStopClose() { NoStopScenario(true); }

//--- bouton « Fermer toutes les positions » : uniquement le magic de l'EA, avec confirmation
static void TestCloseAllButton()
{
  SetupMarket(10000.0, 10, 5u);
  SimState &S = Sim();
  S.visual = true; // tableau de bord créé
  size_t i0 = IndexAtOrAfter(ShimTimegm(2025, 3, 3, 0, 0, 0) + 7 * 86400 + 9 * 3600);
  S.now = S.m1[i0].time;
  S.bid = S.m1[i0].open;
  S.ask = S.bid + 0.2;
  CHECK(OnInit() == INIT_SUCCEEDED, "OnInit");
  for (int k = 0; k < 2; k++)
  {
    MqlTradeRequest r = {};
    MqlTradeResult res = {};
    r.action = TRADE_ACTION_DEAL;
    r.symbol = S.symbol;
    r.volume = 0.02;
    r.type = ORDER_TYPE_BUY;
    r.price = S.ask;
    r.sl = S.bid - 5.0;
    r.deviation = 100;
    r.magic = k == 0 ? (ulong)InpMagic : 0;
    r.type_filling = ORDER_FILLING_FOK;
    r.comment = k == 0 ? BuildEntryComment(1, GLS_BUY, false, 85, "AAA111") + " 500" : string("manuel");
    OrderSend(r, res);
  }
  g_engine.Recover("test");
  S.messageBoxAnswer = IDNO;
  OnChartEvent(CHARTEVENT_OBJECT_CLICK, 0, 0.0, string(GLS_OBJ_PREFIX) + GLS_BTN_CLOSE);
  CHECK(S.positions.size() == 2, "refus de confirmation : rien n'est fermé");
  S.messageBoxAnswer = IDYES;
  OnChartEvent(CHARTEVENT_OBJECT_CLICK, 0, 0.0, string(GLS_OBJ_PREFIX) + GLS_BTN_CLOSE);
  CHECK(S.positions.size() == 1 && S.positions[0].magic == 0, "seule la position de l'EA est fermée");
  CHECK(!S.messageBoxes.empty() && S.messageBoxes.back().find("Confirmées fermées : 1") != std::string::npos, "compte rendu vérifié côté serveur");
  CHECK(S.objects.count(std::string(GLS_OBJ_PREFIX) + GLS_BTN_CLOSE) == 1, "bouton présent");
}

//--- bouton « Démarrer » sur compte réel : confirmation explicite obligatoire
static void TestStartRealAccount()
{
  SetupMarket(10000.0, 10, 6u);
  SimState &S = Sim();
  S.tester = false;
  S.tradeMode = ACCOUNT_TRADE_MODE_REAL;
  size_t i0 = IndexAtOrAfter(ShimTimegm(2025, 3, 3, 0, 0, 0) + 7 * 86400 + 9 * 3600);
  S.now = S.m1[i0].time;
  S.bid = S.m1[i0].open;
  S.ask = S.bid + 0.2;
  CHECK(OnInit() == INIT_SUCCEEDED, "OnInit");
  RunStats rs;
  ReplayBars(i0, i0 + 2, 0.2, rs);
  CHECK(!g_engine.running, "compte réel : arrêté par défaut");
  CHECK(CountMagicIn() == 0, "aucun ordre sans démarrage");
  S.messageBoxAnswer = IDNO;
  OnChartEvent(CHARTEVENT_OBJECT_CLICK, 0, 0.0, string(GLS_OBJ_PREFIX) + GLS_BTN_START);
  CHECK(!g_engine.running, "activation réelle refusée");
  bool asked = false;
  for (const std::string &m : S.messageBoxes)
    if (m.find("COMPTE RÉEL") != std::string::npos)
      asked = true;
  CHECK(asked, "confirmation compte réel demandée");
  S.messageBoxAnswer = IDYES;
  OnChartEvent(CHARTEVENT_OBJECT_CLICK, 0, 0.0, string(GLS_OBJ_PREFIX) + GLS_BTN_START);
  CHECK(g_engine.running, "activation réelle confirmée");
  CHECK(GlobalVariableGet(g_store.Key("realOK")) == 1.0, "confirmation mémorisée");
  CHECK(CountMagicIn() == 0, "le démarrage seul n'ouvre aucune position");
  OnChartEvent(CHARTEVENT_OBJECT_CLICK, 0, 0.0, string(GLS_OBJ_PREFIX) + GLS_BTN_STOP);
  CHECK(!g_engine.running, "arrêt");
}

//--- bouton « Vérifier la connexion » : connexion et autorisation distinguées
static void TestConnectionCheck()
{
  SetupMarket(10000.0, 10, 8u);
  SimState &S = Sim();
  S.visual = true;
  size_t i0 = IndexAtOrAfter(ShimTimegm(2025, 3, 3, 0, 0, 0) + 7 * 86400 + 9 * 3600);
  S.now = S.m1[i0].time;
  S.bid = S.m1[i0].open;
  S.ask = S.bid + 0.2;
  CHECK(OnInit() == INIT_SUCCEEDED, "OnInit");
  RunStats rs;
  ReplayBars(i0, i0 + 2, 0.2, rs);
  int fails = g_engine.RunConnectionCheck();
  CHECK(fails == 0, "aucune anomalie bloquante dans le simulateur : " << fails);
  S.terminalTradeAllowed = false;
  fails = g_engine.RunConnectionCheck();
  CHECK(fails >= 1, "trading algo désactivé détecté");
  bool found = false;
  for (auto &kv : S.objects)
    for (auto &st : kv.second.strs)
      if (st.second.find("DÉSACTIVÉ") != std::string::npos)
        found = true;
  CHECK(found, "ligne d'échec affichée dans le panneau");
  // panneau complet (ligne de cause « algo » incluse) : aucune ligne tronquée en fin de tableau
  ReplayBars(i0 + 2, i0 + 4, 0.2, rs);
  const char *needed[] = {"Tendance : ", "Support : ", "FVG actives", "Dernière figure", "Exécution : ", "Alertes : ", "Protection : ", "Risque : "};
  for (const char *n : needed)
  {
    bool shown = false;
    for (auto &kv : S.objects)
      for (auto &st : kv.second.strs)
        if (st.second.find(n) == 0)
          shown = true;
    CHECK(shown, "ligne du tableau de bord affichée : " << n);
  }
}

//--- petit compte : le volume minimal dépasse le budget -> aucune position
static void TestSmallAccount()
{
  SetupMarket(10.0, 12, 4242u);
  Sim().currency = "EUR";
  Sim().usdToAccount = 0.9;
  InpMinScore = 0;
  InpNewsMode = GLS_NEWS_OFF;
  InpUseSessions = false;      // le but est d'atteindre le calcul du volume
  InpMinM15Efficiency = 0.0;
  size_t i0 = StartEa(7);
  RunStats rs;
  ReplayBars(i0, Sim().m1.size(), 0.20, rs);
  CHECK(CountMagicIn() == 0, "compte de 10 : aucune position ouverte");
  std::string base = "GLS\\" + g_log.Base().s + "_signals.csv";
  CHECK(Sim().files[base].find("volume minimal > budget de risque") != std::string::npos, "refus « volume minimal » journalisé");
}

//--- coupure de connexion : aucune entrée pendant la coupure ni pendant le délai de stabilisation
static void TestDisconnect()
{
  SetupMarket(10000.0, 19, 1235u);
  SimState &S = Sim();
  S.tester = false;
  InpMinScore = 0;
  InpNewsMode = GLS_NEWS_OFF;
  size_t i0 = IndexAtOrAfter(ShimTimegm(2025, 3, 3, 0, 0, 0) + 7 * 86400);
  S.now = S.m1[i0].time;
  S.bid = S.m1[i0].open;
  S.ask = S.bid + 0.2;
  CHECK(OnInit() == INIT_SUCCEEDED, "OnInit");
  OnChartEvent(CHARTEVENT_OBJECT_CLICK, 0, 0.0, string(GLS_OBJ_PREFIX) + GLS_BTN_START);
  g_engine.running = true; // démo : démarrage sans tableau de bord
  g_engine.startedAt = S.now;
  RunStats rs;
  size_t mid = i0 + (S.m1.size() - i0) / 2;
  ReplayBars(i0, mid, 0.2, rs);
  S.connected = false;
  ReplayBars(mid, mid + 600, 0.2, rs);
  CHECK(rs.disconnectedEntries == 0, "aucune entrée pendant la déconnexion");
  CHECK(!g_engine.stateCoherent, "état marqué à resynchroniser");
  S.connected = true;
  int before = CountMagicIn();
  datetime reconnect = S.m1[mid + 600].time;
  ReplayBars(mid + 600, S.m1.size(), 0.2, rs);
  for (const SimDeal &d : S.deals)
    if (d.entry == DEAL_ENTRY_IN && d.magic == (ulong)InpMagic && d.time >= reconnect)
      CHECK(d.time >= reconnect + InpReconnectGraceSec, "entrée pendant le délai de stabilisation");
  CHECK(g_engine.stateCoherent, "état resynchronisé");
  (void)before;
  CheckRunInvariants(rs, "déconnexion");
}

static void TestDuplicateGuard()
{
  SimState &S = Sim();
  S.now = ShimTimegm(2025, 3, 10, 10, 0, 0);
  S.bid = 2000;
  S.ask = 2000.2;
  g_store.Init(InpMagic, S.login);
  g_engine.MarkSignalUsed("F1|B|1741600800|1995.00");
  CHECK(g_engine.SignalUsed("F1|B|1741600800|1995.00"), "signal marqué exécuté");
  CHECK(!g_engine.SignalUsed("F1|B|1741600860|1995.00"), "autre signal libre");
  ResetEaMemory();
  g_store.Init(InpMagic, S.login);
  g_engine.LoadUsedSignals();
  CHECK(g_engine.SignalUsed("F1|B|1741600800|1995.00"), "mémoire des signaux exécutés après redémarrage");
}

//==========================================================================
// v1.10 : bougies japonaises
//==========================================================================
//--- baisse régulière (contexte des retournements haussiers) ; c0 = dernière clôture
static std::vector<Bar> DeclinePrefix(int n, double start, double &c0)
{
  std::vector<Bar> v;
  double px = start;
  for (int i = 0; i < n; i++)
  {
    double c = px - 0.35;
    v.push_back({px, px + 0.3, c - 0.3, c});
    px = c;
  }
  c0 = px;
  return v;
}

//--- hausse régulière (contexte des continuations haussières)
static std::vector<Bar> RisePrefix(int n, double start, double &c0)
{
  std::vector<Bar> v;
  double px = start;
  for (int i = 0; i < n; i++)
  {
    double c = px + 0.35;
    v.push_back({px, c + 0.3, px - 0.3, c});
    px = c;
  }
  c0 = px;
  return v;
}

//--- figure haussière type se terminant sur la dernière barre
static std::vector<Bar> CandleCase(int id)
{
  double c0 = 0.0;
  bool rise = (id == GLS_CDL_IMPULSE || id == GLS_CDL_CONTINUATION);
  std::vector<Bar> v = rise ? RisePrefix(40, 1990.0, c0) : DeclinePrefix(40, 2014.0, c0);
  switch (id)
  {
  case GLS_CDL_HAMMER:
    v.push_back({c0, c0 + 0.32, c0 - 1.5, c0 + 0.3});
    break;
  case GLS_CDL_INVHAMMER:
    v.push_back({c0, c0 + 1.8, c0 - 0.02, c0 + 0.3});
    break;
  case GLS_CDL_ENGULF:
    v.push_back({c0, c0 + 0.1, c0 - 0.7, c0 - 0.6});
    v.push_back({c0 - 0.62, c0 + 0.25, c0 - 0.65, c0 + 0.2});
    break;
  case GLS_CDL_PIERCING:
    v.push_back({c0, c0 + 0.05, c0 - 1.05, c0 - 1.0});
    v.push_back({c0 - 1.0, c0 - 0.35, c0 - 1.1, c0 - 0.4});
    break;
  case GLS_CDL_STAR:
    v.push_back({c0, c0 + 0.05, c0 - 1.05, c0 - 1.0});
    v.push_back({c0 - 1.1, c0 - 1.0, c0 - 1.2, c0 - 1.05});
    v.push_back({c0 - 1.05, c0 - 0.25, c0 - 1.1, c0 - 0.3});
    break;
  case GLS_CDL_REJCONF:
    v.push_back({c0, c0 + 0.15, c0 - 1.2, c0 + 0.1});
    v.push_back({c0 + 0.1, c0 + 0.55, c0 + 0.05, c0 + 0.5});
    break;
  case GLS_CDL_DOJI:
    v.push_back({c0, c0 + 0.5, c0 - 0.5, c0 + 0.02});
    break;
  case GLS_CDL_IMPULSE:
    v.push_back({c0, c0 + 2.05, c0 - 0.05, c0 + 2.0});
    break;
  case GLS_CDL_CONTINUATION:
    v.push_back({c0, c0 + 1.65, c0 - 0.05, c0 + 1.6});
    v.push_back({c0 + 1.5, c0 + 1.55, c0 + 1.2, c0 + 1.3});
    v.push_back({c0 + 1.3, c0 + 1.5, c0 + 1.25, c0 + 1.45});
    v.push_back({c0 + 1.45, c0 + 1.95, c0 + 1.4, c0 + 1.9});
    break;
  case GLS_CDL_FAILBREAK:
    v.push_back({c0, c0 + 0.25, c0 - 1.0, c0 + 0.2});
    break;
  }
  return v;
}

//--- analyse d'une série (vue achat = série réelle, vue vente = miroir) ; renvoie l'indice
//--- de la figure 'id' formée à la barre 'bar' (-1 = dernière barre), ou -1
static int FindPattern(const std::vector<Bar> &bars, int viewDir, int id, CCandleAnalysis &ca, int bar = -1)
{
  CBarSeries s;
  FillSeries(s, 1741600800, bars);
  MqlArray<double> atr;
  CalcATR(s, 14, atr);
  if (bar < 0)
    bar = s.count - 1;
  if (viewDir == GLS_SELL)
  {
    CBarSeries m;
    m.MirrorFrom(s);
    ca.Analyze(m, atr, GLS_SELL, InpCdlLookback);
  }
  else
    ca.Analyze(s, atr, GLS_BUY, InpCdlLookback);
  for (int i = 0; i < ArraySize(ca.pats); i++)
    if (ca.pats[i].id == id && ca.pats[i].bar == bar)
      return i;
  return -1;
}

static void TestCandleMetrics()
{
  CBarSeries s;
  FillSeries(s, 0, {{100.0, 101.0, 99.0, 100.5}, {100.0, 100.0, 100.0, 100.0}, {100.0, 100.2, 99.8, 100.01}});
  MqlArray<double> atr;
  ArrayResize(atr, 3);
  for (int i = 0; i < 3; i++)
    atr[i] = 1.0;
  SCandle c;
  CandleMetrics(s, atr, 0, c);
  CHECK(c.valid, "bougie normale mesurable");
  CHECK_NEAR(c.body, 0.5, 1e-9, "corps");
  CHECK_NEAR(c.upper, 0.5, 1e-9, "mèche haute");
  CHECK_NEAR(c.lower, 1.0, 1e-9, "mèche basse");
  CHECK_NEAR(c.bodyRatio, 0.25, 1e-9, "corps / amplitude");
  CHECK_NEAR(c.closeLoc, 0.75, 1e-9, "position de la clôture");
  CHECK_NEAR(c.rangeAtr, 2.0, 1e-9, "amplitude en ATR");
  CHECK(c.dir == 1, "bougie haussière");
  // amplitude nulle : aucune mesure relative (pas de division par zéro, pas de figure)
  CandleMetrics(s, atr, 1, c);
  CHECK(!c.valid && c.bodyRatio == 0.0 && c.dir == 0, "amplitude nulle -> bougie non mesurable");
  SCandlePattern p;
  bool any = false;
  for (int id = 1; id < GLS_CDL_COUNT; id++)
    any = any || DetectCandleAt(id, s, atr, 1, p);
  CHECK(!any, "aucune figure sur une bougie d'amplitude nulle");
  CandleMetrics(s, atr, 2, c);
  CHECK(c.valid && c.dir == 0, "corps <= seuil doji : bougie neutre");
  CandleMetrics(s, atr, 5, c);
  CHECK(!c.valid, "index hors série refusé");
  // série entière d'amplitude nulle : l'analyse ne produit rien et ne plante pas
  std::vector<Bar> flat(60, Bar{2000.0, 2000.0, 2000.0, 2000.0});
  CCandleAnalysis ca;
  FindPattern(flat, GLS_BUY, GLS_CDL_DOJI, ca);
  CHECK(ArraySize(ca.pats) == 0, "série plate : aucune figure");
}

static void TestCandlePatterns()
{
  const int ids[] = {GLS_CDL_HAMMER, GLS_CDL_INVHAMMER, GLS_CDL_ENGULF, GLS_CDL_PIERCING, GLS_CDL_STAR,
                     GLS_CDL_REJCONF, GLS_CDL_IMPULSE, GLS_CDL_CONTINUATION, GLS_CDL_FAILBREAK};
  for (int id : ids)
  {
    std::vector<Bar> bull = CandleCase(id);
    CCandleAnalysis ca;
    int k = FindPattern(bull, GLS_BUY, id, ca);
    std::string name = CandleName(id, 1).s;
    CHECK(k >= 0, name << " détecté(e)");
    if (k >= 0)
    {
      CHECK(ca.pats[k].dir == 1 && ca.pats[k].contextOk, name << " : sens haussier et contexte cohérent");
      CHECK(ca.pats[k].strength > 0.0 && ca.pats[k].strength <= 1.0, name << " : force bornée");
      CHECK(ca.pats[k].low < ca.pats[k].high, name << " : extrêmes de la figure");
    }
    // même figure en miroir : figure baissière symétrique (vue vente)
    std::vector<Bar> bear = MirrorBars(bull, 4000.0);
    CCandleAnalysis cs;
    int ks = FindPattern(bear, GLS_SELL, id, cs);
    std::string bname = CandleName(id, -1).s;
    CHECK(ks >= 0 && cs.pats[ks].dir == -1, bname << " (miroir) détecté(e) en vue vente");
    // la vue achat ne lit pas la figure baissière comme une figure haussière exploitable
    CCandleAnalysis cb;
    int kb = FindPattern(bear, GLS_BUY, id, cb);
    CHECK(kb < 0 || !cb.pats[kb].contextOk, bname << " : pas de lecture haussière cohérente");
  }
  CHECK(CandleName(GLS_CDL_HAMMER, -1).s == "étoile filante" && CandleName(GLS_CDL_INVHAMMER, -1).s == "pendu"
            && CandleName(GLS_CDL_PIERCING, -1).s == "couverture en nuage noir" && CandleName(GLS_CDL_STAR, -1).s == "étoile du soir",
        "noms des figures baissières");
  // doji : figure neutre, analysée une seule fois (vue achat), sans confirmation possible
  CCandleAnalysis cd;
  int kd = FindPattern(CandleCase(GLS_CDL_DOJI), GLS_BUY, GLS_CDL_DOJI, cd);
  CHECK(kd >= 0 && cd.pats[kd].dir == 0 && cd.pats[kd].status == GLS_CDLST_INFO, "doji neutre (information)");
  CCandleAnalysis cds;
  CHECK(FindPattern(CandleCase(GLS_CDL_DOJI), GLS_SELL, GLS_CDL_DOJI, cds) < 0, "doji non dupliqué en vue vente");
  CHECK(cd.IsIndecisionAt(40), "bougie de déclenchement doji repérée");
}

static void TestCandleStatus()
{
  // marteau seul : formé, en attente de confirmation (aucune donnée future utilisée)
  std::vector<Bar> h = CandleCase(GLS_CDL_HAMMER);
  int bar = (int)h.size() - 1;
  double c0 = h.back().o;
  CCandleAnalysis ca;
  int k = FindPattern(h, GLS_BUY, GLS_CDL_HAMMER, ca);
  CHECK(k >= 0 && ca.pats[k].status == GLS_CDLST_DETECTED, "marteau : détecté, non confirmé");
  // confirmation : clôture au-dessus du plus haut de la figure
  std::vector<Bar> conf = h;
  conf.push_back({c0 + 0.3, c0 + 0.6, c0 + 0.25, c0 + 0.5});
  k = FindPattern(conf, GLS_BUY, GLS_CDL_HAMMER, ca, bar);
  CHECK(k >= 0 && ca.pats[k].status == GLS_CDLST_CONFIRMED && ca.pats[k].confirmBar == bar + 1, "marteau confirmé");
  string nm;
  CHECK(ca.ConfirmedReversalSince(bar - 1, nm), "retournement confirmé disponible");
  // invalidation : clôture sous le plus bas de la figure avant confirmation
  std::vector<Bar> inv = h;
  inv.push_back({c0 + 0.3, c0 + 0.35, c0 - 1.7, c0 - 1.6});
  k = FindPattern(inv, GLS_BUY, GLS_CDL_HAMMER, ca, bar);
  CHECK(k >= 0 && ca.pats[k].status == GLS_CDLST_INVALIDATED, "marteau invalidé");
  // expiration : pas de confirmation dans InpCdlConfirmBars barres
  std::vector<Bar> exp = h;
  for (int i = 0; i <= InpCdlConfirmBars; i++)
    exp.push_back({c0 + 0.3, c0 + 0.31, c0, c0 + 0.1});
  k = FindPattern(exp, GLS_BUY, GLS_CDL_HAMMER, ca, bar);
  CHECK(k >= 0 && ca.pats[k].status == GLS_CDLST_EXPIRED, "marteau expiré");
  // figure désactivable par paramètre
  CandleConfigInit("HAM");
  CHECK(FindPattern(h, GLS_BUY, GLS_CDL_HAMMER, ca) < 0, "figure désactivée : ignorée");
  CandleConfigInit(InpCdlDisabled);
  CHECK(!g_cdlEnabled[GLS_CDL_ABSORB], "absorption apparente désactivée par défaut");
  CHECK(FindPattern(h, GLS_BUY, GLS_CDL_HAMMER, ca) >= 0, "figure réactivée");
}

//==========================================================================
// v1.10 : tendance et régime
//==========================================================================
static void TestTrendRegime()
{
  CBarSeries s;
  std::vector<Bar> bars;
  double px = 2000.0;
  for (int i = 0; i < 300; i++)
  {
    bars.push_back({px, px + 0.6, px - 0.2, px + 0.4});
    px += 0.4;
  }
  FillSeries(s, 0, bars);
  MqlArray<double> ema;
  CalcEMA(s.close, s.count, 200, ema);
  CStructure st;
  st.ready = true;
  st.er = 0.05;
  // prix au-dessus d'une EMA montante, structure neutre : l'EMA seule ne suffit PAS
  CTrendModel t;
  t.Evaluate(s, st, ema, 0.8, 10, 0.3, 3);
  CHECK(t.ready && t.emaVote == 1 && t.slopeVote == 1, "votes EMA/pente haussiers");
  CHECK(t.cls != GLS_TCLASS_BULL && t.dir == 0, "EMA seule insuffisante : " << TrendClassText(t.cls).s);
  // structure + sommets/creux haussiers + EMA : tendance haussière
  st.trend = GLS_TREND_BULL;
  st.swingBias = 1;
  t.Evaluate(s, st, ema, 0.8, 10, 0.3, 3);
  CHECK(t.cls == GLS_TCLASS_BULL && t.dir == 1, "tendance haussière confirmée : " << t.reason.s);
  // élément contraire (sommets/creux baissiers) : pas de tendance
  st.swingBias = -1;
  t.Evaluate(s, st, ema, 0.8, 10, 0.3, 3);
  CHECK(t.cls == GLS_TCLASS_RANGE, "votes contradictoires, ER faible : latérale");
  st.er = 0.5;
  t.Evaluate(s, st, ema, 0.8, 10, 0.3, 3);
  CHECK(t.cls == GLS_TCLASS_TRANSITION, "votes contradictoires, ER élevé : transition");
  // CHOCH récent : transition même si les votes sont alignés
  st.swingBias = 1;
  st.lastEvent = GLS_EVT_CHOCH_UP;
  st.lastEventIndex = s.count - 2;
  t.Evaluate(s, st, ema, 0.8, 10, 0.3, 3);
  CHECK(t.cls == GLS_TCLASS_TRANSITION, "CHOCH récent : transition");
  st.lastEvent = GLS_EVT_NONE;
  // symétrie baissière
  CBarSeries m;
  FillSeries(m, 0, MirrorBars(bars, 6000.0));
  MqlArray<double> emaM;
  CalcEMA(m.close, m.count, 200, emaM);
  CStructure sb;
  sb.ready = true;
  sb.trend = GLS_TREND_BEAR;
  sb.swingBias = -1;
  sb.er = 0.5;
  CTrendModel tb;
  tb.Evaluate(m, sb, emaM, 0.8, 10, 0.3, 3);
  CHECK(tb.cls == GLS_TCLASS_BEAR && tb.dir == -1, "tendance baissière (miroir)");
  // historique insuffisant
  CStructure none;
  CTrendModel tn;
  tn.Evaluate(s, none, ema, 0.8, 10, 0.3, 3);
  CHECK(!tn.ready && tn.cls == GLS_TCLASS_UNKNOWN, "structure non prête : tendance inconnue");

  // régimes
  st.er = 0.5;
  st.trend = GLS_TREND_BULL;
  st.swingBias = 1;
  t.Evaluate(s, st, ema, 0.8, 10, 0.3, 3);
  string why;
  CHECK(ClassifyRegime(t, s, 1.0, 1.0, why) == GLS_RG_TREND, "régime tendance");
  CHECK(ClassifyRegime(t, s, 2.0, 1.0, why) == GLS_RG_VOLATILE, "volatilité excessive : " << why.s);
  CHECK(ClassifyRegime(tn, s, 1.0, 1.0, why) == GLS_RG_UNKNOWN, "tendance inconnue : régime inconnu");
  st.swingBias = -1;
  st.er = 0.05;
  CTrendModel tr;
  tr.Evaluate(s, st, ema, 0.8, 10, 0.3, 3);
  CHECK(ClassifyRegime(tr, s, 1.0, 1.0, why) == GLS_RG_RANGE, "régime range");
  CBarSeries chop;
  std::vector<Bar> cb;
  for (int i = 0; i < 40; i++)
    cb.push_back(i % 2 ? Bar{2000.0, 2000.6, 1999.4, 2000.5} : Bar{2000.5, 2000.6, 1999.4, 2000.0});
  FillSeries(chop, 0, cb);
  CHECK(ClassifyRegime(tr, chop, 1.0, 1.0, why) == GLS_RG_DISORDER, "alternance permanente : désordre (" << why.s << ")");
  CHECK_NEAR(AlternationRatio(chop, 12), 1.0, 1e-9, "taux d'alternance");
  // masques de régimes par famille
  CHECK(ParseRegimeMask(" tendance , Range,xyz") == ((1 << GLS_RG_TREND) | (1 << GLS_RG_RANGE)), "liste de régimes (casse, espaces, inconnus)");
  CHECK(RegimeAllowed(GLS_FAMILY_PULLBACK, GLS_RG_TREND) && !RegimeAllowed(GLS_FAMILY_PULLBACK, GLS_RG_RANGE), "F2 : tendance seulement");
  bool anyVol = false;
  for (int f = 1; f <= GLS_FAMILY_MAX; f++)
    anyVol = anyVol || RegimeAllowed(f, GLS_RG_VOLATILE) || RegimeAllowed(f, GLS_RG_DISORDER) || RegimeAllowed(f, GLS_RG_UNKNOWN);
  CHECK(!anyVol, "volatil / désordre / inconnu interdits par défaut");
}

//==========================================================================
// v1.10 : supports / résistances
//==========================================================================
static void AddSwing(MqlArray<SSwing> &arr, double price, datetime t, datetime conf)
{
  int n = ArraySize(arr);
  ArrayResize(arr, n + 1);
  arr[n].index = n;
  arr[n].price = price;
  arr[n].time = t;
  arr[n].confirmTime = conf;
  arr[n].brokenTime = 0;
}

static void FillM5(CBarSeries &s, datetime t0, const std::vector<Bar> &bars)
{
  FillSeries(s, t0, bars);
  s.periodSec = 300;
  for (int i = 0; i < s.count; i++)
    s.time[i] = t0 + (datetime)i * 300;
}

static int ZoneAt(const CZoneMap &zm, double price)
{
  for (int i = 0; i < ArraySize(zm.zones); i++)
    if (price >= zm.zones[i].lo && price <= zm.zones[i].hi)
      return i;
  return -1;
}

static void TestZones()
{
  const datetime T0 = 1741600800;
  CBarSeries m5;
  FillM5(m5, T0, std::vector<Bar>(120, Bar{2000.0, 2000.3, 1999.7, 2000.0}));
  CStructure st5, st15;
  // 3 creux indépendants proches (dont 2 « égaux ») -> un support
  AddSwing(st5.lows, 1995.00, T0 + 10 * 300, T0 + 13 * 300);
  AddSwing(st5.lows, 1995.05, T0 + 30 * 300, T0 + 33 * 300);
  AddSwing(st5.lows, 1994.98, T0 + 50 * 300, T0 + 53 * 300);
  // 2 creux trop rapprochés dans le temps : une seule réaction
  AddSwing(st5.lows, 1990.00, T0 + 60 * 300, T0 + 63 * 300);
  AddSwing(st5.lows, 1990.02, T0 + 62 * 300, T0 + 65 * 300);
  // sommet isolé M5 (1 réaction) et sommet M15 isolé (niveau majeur)
  AddSwing(st5.highs, 2006.0, T0 + 40 * 300, T0 + 43 * 300);
  AddSwing(st15.highs, 2010.0, T0 + 20 * 300, T0 + 26 * 300);
  // pivot non encore confirmé à l'instant de l'analyse : ignoré
  AddSwing(st5.highs, 2020.0, T0 + 118 * 300, T0 + 121 * 300);
  CZoneMap zm;
  datetime now = T0 + 120 * 300;
  zm.Build(st5, st15, m5, 1.0, now);
  int s1 = ZoneAt(zm, 1995.0);
  CHECK(s1 >= 0, "support 1995 regroupé");
  if (s1 >= 0)
  {
    const SZone &z = zm.zones[s1];
    CHECK(z.touches == 3 && z.valid && z.role == GLS_ZONE_SUPPORT && z.equal, "3 réactions indépendantes, creux égaux : " << z.reason.s);
    CHECK_NEAR(z.lo, 1994.98 - InpZonePadATR, 1e-9, "largeur adaptée à l'ATR (bas)");
    CHECK_NEAR(z.hi, 1995.05 + InpZonePadATR, 1e-9, "largeur adaptée à l'ATR (haut)");
    CHECK(z.confirmTime == T0 + 13 * 300, "zone connue à la confirmation du 1er pivot");
  }
  int s2 = ZoneAt(zm, 1990.0);
  CHECK(s2 >= 0 && zm.zones[s2].touches == 1 && !zm.zones[s2].valid, "réactions non indépendantes : zone non valide");
  int r1 = ZoneAt(zm, 2006.0);
  CHECK(r1 >= 0 && !zm.zones[r1].valid, "sommet M5 isolé : non valide");
  int r2 = ZoneAt(zm, 2010.0);
  CHECK(r2 >= 0 && zm.zones[r2].valid && zm.zones[r2].major && zm.zones[r2].role == GLS_ZONE_RESIST, "sommet M15 : résistance majeure");
  CHECK(ZoneAt(zm, 2020.0) < 0, "pivot non confirmé ignoré (pas de donnée future)");
  CHECK(zm.Nearest(GLS_ZONE_SUPPORT, 1998.0) == s1, "support le plus proche sous le prix");

  // inversion de rôle : résistance 2002 cassée (2 clôtures), retestée puis tenue
  CStructure sr, none;
  AddSwing(sr.highs, 2002.00, T0 + 10 * 300, T0 + 13 * 300);
  AddSwing(sr.highs, 2002.05, T0 + 30 * 300, T0 + 33 * 300);
  std::vector<Bar> b(41, Bar{2000.0, 2000.3, 1999.7, 2000.0});
  b.push_back({2000.0, 2003.1, 1999.9, 2003.0}); // 1re clôture au-delà
  CBarSeries m;
  FillM5(m, T0, b);
  zm.Build(sr, none, m, 1.0, T0 + 50 * 300);
  int z = ZoneAt(zm, 2002.0);
  CHECK(z >= 0 && zm.zones[z].state == GLS_ZST_ACTIVE && zm.zones[z].role == GLS_ZONE_RESIST, "une seule clôture au-delà : rôle inchangé");
  b.push_back({2003.0, 2003.4, 2002.8, 2003.2}); // 2e clôture : cassure confirmée
  FillM5(m, T0, b);
  zm.Build(sr, none, m, 1.0, T0 + 50 * 300);
  z = ZoneAt(zm, 2002.0);
  CHECK(z >= 0 && zm.zones[z].state == GLS_ZST_BROKEN && zm.zones[z].role == GLS_ZONE_PENDING, "cassure confirmée : rôle en attente");
  std::vector<Bar> flip = b;
  flip.push_back({2003.2, 2003.3, 2002.1, 2002.8}); // retour dans la zone, clôture au-dessus
  FillM5(m, T0, flip);
  zm.Build(sr, none, m, 1.0, T0 + 50 * 300);
  z = ZoneAt(zm, 2002.0);
  CHECK(z >= 0 && zm.zones[z].state == GLS_ZST_FLIPPED && zm.zones[z].role == GLS_ZONE_SUPPORT, "retest tenu : ancienne résistance devenue support");
  std::vector<Bar> fail = b;
  fail.push_back({2003.2, 2003.3, 2001.4, 2001.5}); // retour sous la zone
  FillM5(m, T0, fail);
  zm.Build(sr, none, m, 1.0, T0 + 50 * 300);
  z = ZoneAt(zm, 2002.0);
  CHECK(z >= 0 && zm.zones[z].state == GLS_ZST_FAILED_BREAK && zm.zones[z].role == GLS_ZONE_RESIST, "cassure ratée : rôle d'origine conservé");
}

//==========================================================================
// v1.10 : FVG / IFVG / OB
//==========================================================================
static std::vector<Bar> FvgBullBars()
{
  std::vector<Bar> v(30, Bar{2000.0, 2000.3, 1999.7, 2000.0});
  v.push_back({2000.1, 2000.3, 1999.7, 1999.9}); // 30 : bougie opposée (OB si cassure)
  v.push_back({2000.0, 2000.5, 1999.8, 2000.2}); // 31 = i-2 : haut 2000.5
  v.push_back({2000.2, 2002.6, 2000.1, 2002.5}); // 32 = i-1 : déplacement
  v.push_back({2002.5, 2003.0, 2001.0, 2002.8}); // 33 = i : bas 2001.0 > 2000.5
  return v;
}

static int FindFvg(const CFvgMap &m, int dir, int i3, bool inverted)
{
  for (int k = 0; k < ArraySize(m.fvgs); k++)
    if (m.fvgs[k].dir == dir && m.fvgs[k].i3 == i3 && m.fvgs[k].inverted == inverted)
      return k;
  return -1;
}

static void BuildFvg(const std::vector<Bar> &bars, CFvgMap &m, CStructure &st, CBarSeries &s)
{
  FillSeries(s, 1741600800, bars);
  MqlArray<double> atr;
  CalcATR(s, 14, atr);
  CZoneMap zm;
  m.Build(s, atr, st, zm, 1, 120, 0.01);
}

static void TestFvg()
{
  CStructure none;
  CBarSeries s;
  CFvgMap m;
  std::vector<Bar> b = FvgBullBars();
  BuildFvg(b, m, none, s);
  int k = FindFvg(m, 1, 33, false);
  CHECK(k >= 0, "FVG haussière détectée (bas[i] > haut[i-2])");
  if (k < 0)
    return;
  const SFvg &f = m.fvgs[k];
  CHECK_NEAR(f.lo, 2000.5, 1e-9, "borne basse = haut[i-2]");
  CHECK_NEAR(f.hi, 2001.0, 1e-9, "borne haute = bas[i]");
  CHECK_NEAR(f.sizePts, 50.0, 1e-6, "taille en points");
  CHECK(f.created == s.CloseTime(33), "connue à la clôture de la 3e bougie");
  CHECK(f.status == GLS_FVG_FRESH && f.fillPct == 0.0 && f.retests == 0, "fraîche");
  CHECK(f.dispAtr > 2.0 && f.dispBody > 0.9, "déplacement mesuré : " << f.dispAtr);
  CHECK(!f.bos && !f.hasOB, "sans cassure de structure : ni BOS ni OB");
  CHECK(f.quality > 0.0 && f.quality <= 1.0, "qualité bornée : " << f.quality);
  CHECK(FindFvg(m, -1, 33, false) < 0, "pas de FVG baissière sur ce schéma");
  double qNoBos = f.quality;
  // déplacement avec BOS : OB objectif = dernière bougie opposée avant le déplacement
  CStructure st;
  st.AddEvent(GLS_EVT_BOS_UP, 32, 2000.3, s.CloseTime(32));
  BuildFvg(b, m, st, s);
  k = FindFvg(m, 1, 33, false);
  CHECK(k >= 0 && m.fvgs[k].bos && !m.fvgs[k].choch && m.fvgs[k].hasOB, "BOS et OB adjacent");
  if (k >= 0)
  {
    CHECK_NEAR(m.fvgs[k].obLo, 1999.7, 1e-9, "OB bas");
    CHECK_NEAR(m.fvgs[k].obHi, 2000.3, 1e-9, "OB haut");
    CHECK(m.fvgs[k].quality > qNoBos, "BOS : qualité supérieure, sans double comptage du déplacement");
  }
  // suivi : retours, comblement, statut
  b.push_back({2002.8, 2002.9, 2000.8, 2001.5}); // 34 : 1er retour, 40 %
  BuildFvg(b, m, none, s);
  k = FindFvg(m, 1, 33, false);
  CHECK(k >= 0 && m.fvgs[k].retests == 1 && m.fvgs[k].status == GLS_FVG_PARTIAL, "1er retour : partiellement comblée");
  if (k >= 0)
    CHECK_NEAR(m.fvgs[k].fillPct, 0.4, 1e-9, "comblement 40 %");
  b.push_back({2001.5, 2002.5, 2001.4, 2002.4}); // 35 : sortie de zone
  b.push_back({2002.4, 2002.5, 2000.6, 2001.2}); // 36 : 2e retour, 80 %
  BuildFvg(b, m, none, s);
  k = FindFvg(m, 1, 33, false);
  CHECK(k >= 0 && m.fvgs[k].retests == 2, "2e retour compté");
  if (k >= 0)
    CHECK_NEAR(m.fvgs[k].fillPct, 0.8, 1e-9, "comblement 80 %");
  b.push_back({2001.2, 2001.3, 2000.4, 2000.45}); // 37 : comblée, clôture au-dessus du seuil d'invalidation
  BuildFvg(b, m, none, s);
  k = FindFvg(m, 1, 33, false);
  CHECK(k >= 0 && m.fvgs[k].status == GLS_FVG_FILLED && m.fvgs[k].fillPct == 1.0, "comblée");
  b.push_back({2000.45, 2000.5, 1999.9, 2000.0}); // 38 : clôture sous bas - tampon
  BuildFvg(b, m, none, s);
  k = FindFvg(m, 1, 33, false);
  CHECK(k >= 0 && m.fvgs[k].status == GLS_FVG_INVALIDATED && m.fvgs[k].statusTime == s.CloseTime(38), "invalidée par une clôture");
  CHECK(FindFvg(m, -1, 38, true) < 0, "IFVG désactivée par défaut");
  // IFVG : règle distincte
  InpUseIFVG = true;
  BuildFvg(b, m, none, s);
  int ki = FindFvg(m, -1, 38, true);
  CHECK(ki >= 0, "IFVG : zone invalidée retournée");
  if (ki >= 0)
  {
    CHECK_NEAR(m.fvgs[ki].lo, 2000.5, 1e-9, "IFVG mêmes bornes");
    CHECK(m.fvgs[ki].created == s.CloseTime(38) && m.fvgs[ki].status == GLS_FVG_FRESH, "IFVG connue à l'invalidation");
    CHECK(FvgKey(m.fvgs[ki]) != FvgKey(m.fvgs[k]), "identifiant distinct");
  }
  InpUseIFVG = false;
  // symétrie : FVG baissière (haut[i] < bas[i-2])
  std::vector<Bar> bear = MirrorBars(FvgBullBars(), 4000.0);
  BuildFvg(bear, m, none, s);
  k = FindFvg(m, -1, 33, false);
  CHECK(k >= 0, "FVG baissière (miroir)");
  if (k >= 0)
  {
    CHECK_NEAR(m.fvgs[k].lo, 1999.0, 1e-9, "baissière : bas = haut[i]");
    CHECK_NEAR(m.fvgs[k].hi, 1999.5, 1e-9, "baissière : haut = bas[i-2]");
  }
}

//==========================================================================
// v1.10 : familles F5 (réaction S/R) et F6 (retest de FVG)
//==========================================================================
static std::vector<Bar> ZoneReactionBars(bool confirm)
{
  std::vector<Bar> v = FlatPrefix(100, 2000.0, 0.5);
  double c0 = 0.0;
  std::vector<Bar> d = DeclinePrefix(11, 2000.0, c0); // jusqu'à 1996.15 (plus bas 1995.85)
  v.insert(v.end(), d.begin(), d.end());
  v.push_back({1996.0, 1996.35, 1995.1, 1996.3}); // marteau dans la zone 1995.0-1995.4
  if (confirm)
    v.push_back({1996.3, 1996.9, 1996.2, 1996.8}); // confirmation : clôture > haut du marteau
  return v;
}

static void PrepareCandleContext(const std::vector<Bar> &bars)
{
  PrepareM1Context(bars);
  g_ctx.cdlBuy.Analyze(g_ctx.m1, g_ctx.atr, GLS_BUY, InpCdlLookback);
  g_ctx.cdlSell.Analyze(g_ctx.m1Mirror, g_ctx.atr, GLS_SELL, InpCdlLookback);
}

static void TestSRBounce()
{
  const datetime T0 = 1741600800;
  InpUseExternalLevels = false;
  PrepareCandleContext(ZoneReactionBars(true));
  CDirView vb;
  vb.AddZone(vb.supports, 1995.0, 1995.4, 0.8, GLS_LVL_ZONE, T0, 3, false, "test");
  SSignal sig;
  DetectFamily(GLS_FAMILY_SR_BOUNCE, g_ctx, vb, sig);
  CHECK(sig.valid && sig.family == GLS_FAMILY_SR_BOUNCE, "F5 : réaction confirmée sur support : " << sig.detail.s);
  CHECK_NEAR(sig.level, 1995.4, 1e-9, "F5 niveau = haut de la zone");
  CHECK(sig.stop < 1995.0 && sig.retestEntry, "F5 stop sous la zone");
  CHECK(sig.cRetest == 1.0, "F5 : réaction tenue dans la zone");
  // finalisation : contrôles communs, puis obstacles (résistance proche, prix dans une résistance)
  InpUseRegimeFilter = false;
  InpUseEmaFilter = false;
  InpMinScore = 0;
  datetime now = T0 + 113 * 60;
  SSignal base = sig;
  FinalizeSignal(base, g_ctx, vb, 1996.80, 1997.00, 0.0, now);
  CHECK(base.refusal == GLS_REFUSE_NONE, "F5 finalisé sans refus : " << GlsRefusalText(base.refusal).s << " " << base.criteria.s);
  CHECK(base.score >= 0.0 && base.score <= 100.0 && base.candleId != GLS_CDL_NONE, "score borné, preuve de bougie retenue : " << base.candleName.s);
  vb.AddZone(vb.obstacles, 1997.3, 1997.8, 0.8, GLS_LVL_ZONE, T0, 3, false, "R");
  SSignal near = sig;
  FinalizeSignal(near, g_ctx, vb, 1996.80, 1997.00, 0.0, now);
  CHECK(near.refusal == GLS_REFUSE_RR, "résistance à moins de 1R : refus (" << near.roomR << "R)");
  ArrayResize(vb.obstacles, 0);
  vb.AddZone(vb.obstacles, 1996.9, 1997.4, 0.8, GLS_LVL_ZONE, T0, 3, false, "R");
  SSignal in = sig;
  FinalizeSignal(in, g_ctx, vb, 1996.80, 1997.00, 0.0, now);
  CHECK(in.refusal == GLS_REFUSE_RR && in.criteria.s.find("prix dans une résistance") != std::string::npos, "achat dans une résistance refusé");
  ArrayResize(vb.obstacles, 0);
  vb.AddZone(vb.obstacles, 2003.0, 2003.5, 0.8, GLS_LVL_ZONE, T0, 3, false, "R");
  SSignal far = sig;
  FinalizeSignal(far, g_ctx, vb, 1996.80, 1997.00, 0.0, now);
  CHECK(far.refusal == GLS_REFUSE_NONE && far.roomR > 2.0, "résistance lointaine : espace suffisant (" << far.roomR << "R)");
  ArrayResize(vb.obstacles, 0);
  vb.AddZone(vb.obstacles, 1997.3, 1997.8, 0.8, GLS_LVL_ZONE, now + 60, 3, false, "R");
  SSignal late = sig;
  FinalizeSignal(late, g_ctx, vb, 1996.80, 1997.00, 0.0, now);
  ArrayResize(vb.obstacles, 0);
  CHECK(late.refusal == GLS_REFUSE_NONE, "zone pas encore connue : ignorée (pas de donnée future)");

  // sans confirmation : attente (une figure seule ne déclenche rien)
  ResetEaMemory();
  InpUseExternalLevels = false;
  PrepareCandleContext(ZoneReactionBars(false));
  SSignal s2;
  DetectFamily(GLS_FAMILY_SR_BOUNCE, g_ctx, vb, s2);
  CHECK(!s2.valid && s2.refusal == GLS_REFUSE_INCOMPLETE, "F5 : marteau non confirmé -> attente");
  // zone cassée par une clôture
  ResetEaMemory();
  InpUseExternalLevels = false;
  std::vector<Bar> brk = ZoneReactionBars(false);
  brk.push_back({1996.3, 1996.4, 1994.4, 1994.5});
  PrepareCandleContext(brk);
  SSignal s3;
  DetectFamily(GLS_FAMILY_SR_BOUNCE, g_ctx, vb, s3);
  CHECK(!s3.valid, "F5 : zone cassée -> refus");
  // zone trop faible
  ResetEaMemory();
  InpUseExternalLevels = false;
  PrepareCandleContext(ZoneReactionBars(true));
  CDirView vw;
  vw.AddZone(vw.supports, 1995.0, 1995.4, 0.3, GLS_LVL_ZONE, T0, 1, false, "faible");
  SSignal s4;
  DetectFamily(GLS_FAMILY_SR_BOUNCE, g_ctx, vw, s4);
  CHECK(!s4.valid && s4.stage == 0, "F5 : zone sous la force minimale ignorée");
  // symétrie : réaction baissière sous une résistance (vue vente)
  ResetEaMemory();
  InpUseExternalLevels = false;
  InpUseRegimeFilter = false;
  InpUseEmaFilter = false;
  InpMinScore = 0;
  PrepareCandleContext(MirrorBars(ZoneReactionBars(true), 4000.0));
  CDirView vs;
  vs.dir = GLS_SELL;
  vs.AddZone(vs.supports, 2004.6, 2005.0, 0.8, GLS_LVL_ZONE, T0, 3, false, "test");
  SSignal s5;
  DetectFamily(GLS_FAMILY_SR_BOUNCE, g_ctx, vs, s5);
  CHECK(s5.valid && s5.dir == GLS_SELL, "F5 vente sous une résistance (miroir)");
  FinalizeSignal(s5, g_ctx, vs, 2003.00, 2003.20, 0.0, now);
  CHECK_NEAR(s5.level, 2004.6, 1e-9, "F5 vente : niveau = bas de la résistance");
  CHECK(s5.stop > 2005.0 + 0.2, "F5 vente : stop au-dessus de la zone + spread");
}

static void TestFvgRetest()
{
  const datetime T0 = 1741600800;
  InpUseExternalLevels = false;
  PrepareCandleContext(ZoneReactionBars(true));
  CDirView vb;
  vb.AddZone(vb.fvgZones, 1995.0, 1995.4, 0.8, GLS_LVL_FVG, T0, 1, false, "test");
  SSignal sig;
  DetectFamily(GLS_FAMILY_FVG, g_ctx, vb, sig);
  CHECK(sig.valid && sig.family == GLS_FAMILY_FVG, "F6 : retour dans la FVG + réaction confirmée : " << sig.detail.s);
  CHECK(sig.stop < 1995.0 && sig.levelKind == GLS_LVL_FVG, "F6 stop sous la FVG");
  CHECK(sig.cRetest == 1.0 && sig.cLiq == 0.8, "F6 : qualité de la FVG comptée une fois (cLiq), retest = réaction tenue");
  // la FVG seule ne déclenche jamais : sans réaction confirmée, attente
  ResetEaMemory();
  InpUseExternalLevels = false;
  PrepareCandleContext(ZoneReactionBars(false));
  SSignal s2;
  DetectFamily(GLS_FAMILY_FVG, g_ctx, vb, s2);
  CHECK(!s2.valid && s2.refusal == GLS_REFUSE_INCOMPLETE, "F6 : contact sans réaction -> attente");
  // trop de retours, qualité insuffisante, zone trop ancienne : ignorées
  ResetEaMemory();
  InpUseExternalLevels = false;
  PrepareCandleContext(ZoneReactionBars(true));
  CDirView vr;
  vr.AddZone(vr.fvgZones, 1995.0, 1995.4, 0.8, GLS_LVL_FVG, T0, InpFvgMaxRetests + 1, false, "retours");
  vr.AddZone(vr.fvgZones, 1995.0, 1995.4, InpFvgMinQuality - 0.1, GLS_LVL_FVG, T0, 1, false, "faible");
  vr.AddZone(vr.fvgZones, 1995.0, 1995.4, 0.8, GLS_LVL_FVG, T0 - InpFvgMaxAgeBars * 300 - 7200, 1, false, "ancienne");
  SSignal s3;
  DetectFamily(GLS_FAMILY_FVG, g_ctx, vr, s3);
  CHECK(!s3.valid && s3.stage == 0, "F6 : FVG non éligibles ignorées");
  // FVG invalidée par une clôture sous la zone
  ResetEaMemory();
  InpUseExternalLevels = false;
  std::vector<Bar> brk = ZoneReactionBars(false);
  brk.push_back({1996.3, 1996.4, 1994.4, 1994.5});
  PrepareCandleContext(brk);
  SSignal s4;
  DetectFamily(GLS_FAMILY_FVG, g_ctx, vb, s4);
  CHECK(!s4.valid, "F6 : FVG invalidée -> refus");
}

//==========================================================================
// v1.10 : qualité d'exécution, pannes, alertes, intégrité des données
//==========================================================================
static void TestExecStats()
{
  CExecStats e;
  e.RecordSend(TRADE_RETCODE_DONE, 10.0);
  e.RecordSend(TRADE_RETCODE_REQUOTE, 5.0);
  e.RecordSend(TRADE_RETCODE_NO_MONEY, 5.0);
  e.RecordSend(TRADE_RETCODE_TIMEOUT, 5.0);
  CHECK(e.sends == 4 && e.fills == 1 && e.requotes == 1 && e.rejects == 1 && e.uncertain == 1, "classement des codes retour");
  CHECK_NEAR(e.latencyMaxMs, 10.0, 1e-9, "latence max");
  CHECK(e.ExpectedAdverseSlippage() == 0.0, "aucun glissement sans exécution");
  e.RecordFill(0.05, 0.01, 0.20);
  e.RecordFill(-0.03, 0.01, 0.20);
  CHECK_NEAR(e.slipMaxPts, 5.0, 1e-9, "glissement max en points");
  CHECK_NEAR(e.ExpectedAdverseSlippage(), 0.025, 1e-12, "glissement défavorable moyen (favorable compté 0)");
  for (int i = 0; i < 30; i++)
    e.RecordFill(0.10, 0.01, 0.20);
  CHECK_NEAR(e.ExpectedAdverseSlippage(), 0.10, 1e-12, "fenêtre glissante de 20 exécutions");
  CHECK(e.Summary().s.find("4 envoi(s)") != std::string::npos, "résumé lisible");
  // le glissement observé élargit le coût estimé (jamais l'inverse)
  g_observedSlippage = InpSlippageAllowancePrice + 0.5;
  CHECK_NEAR(SlippageAllowance(), InpSlippageAllowancePrice + 0.5, 1e-12, "glissement observé utilisé s'il est supérieur");
  g_observedSlippage = 0.0;
  CHECK_NEAR(SlippageAllowance(), InpSlippageAllowancePrice, 1e-12, "jamais sous l'hypothèse configurée");
}

static void TestAlerts()
{
  SimState &S = Sim();
  S.tester = false;
  S.now = 1741600800;
  InpAlertPush = true;
  g_alerts.Notify(GLS_ALERT_RISK, "perte", "perte journalière atteinte");
  g_alerts.Notify(GLS_ALERT_RISK, "perte", "perte journalière atteinte");
  CHECK(g_alerts.sent == 1, "alerte répétée limitée (anti-répétition)");
  S.now += InpAlertThrottleSec;
  g_alerts.Notify(GLS_ALERT_RISK, "perte", "perte journalière atteinte");
  CHECK(g_alerts.sent == 2, "alerte renvoyée après le délai");
  g_alerts.Notify(GLS_ALERT_STOP, "arret", "robot arrêté");
  CHECK(g_alerts.sent == 3, "autre alerte indépendante");
  InpAlertRisk = false;
  g_alerts.Notify(GLS_ALERT_RISK, "dd", "drawdown");
  CHECK(g_alerts.sent == 3, "catégorie désactivée : aucune alerte");
  S.pushOk = false;
  g_alerts.Notify(GLS_ALERT_ERROR, "err", "erreur d'exécution");
  CHECK(g_alerts.failures == 1, "échec d'envoi de notification compté (jamais présenté comme réussi)");
  S.tester = true;
  int before = g_alerts.sent;
  g_alerts.Notify(GLS_ALERT_ERROR, "err2", "erreur");
  CHECK(g_alerts.sent == before, "testeur : aucune alerte externe");
}

//--- pipeline F5 (filtres v1.10 désactivés pour multiplier les envois) avec codes retour injectés
static void RunInjected(const std::vector<uint> &codes, std::function<void(size_t)> perBar)
{
  SetupMarket(10000.0, 19, 1234u + (unsigned)GLS_FAMILY_SR_BOUNCE);
  RelaxContextFilters();
  InpFamily = GLS_FAMILY_SR_BOUNCE;
  InpMinScore = 0;
  InpNewsMode = GLS_NEWS_OFF;
  InpUseSessions = false;
  Sim().injectRetcodes = codes;
  size_t i0 = StartEa(7);
  RunStats rs;
  ReplayBars(i0, Sim().m1.size(), 0.20, rs, perBar);
  FlushTimers(5);
  CheckRunInvariants(rs, "codes injectés");
}

static void TestExecRequotes()
{
  int sendsAtFirstFill = -1;
  RunInjected({TRADE_RETCODE_REQUOTE, TRADE_RETCODE_REQUOTE}, [&](size_t) {
    if (sendsAtFirstFill < 0 && g_exec.fills > 0)
      sendsAtFirstFill = g_exec.sends;
  });
  CHECK(g_exec.requotes == 2, "2 requotes comptées : " << g_exec.requotes);
  CHECK(sendsAtFirstFill == 3, "nouvelle tentative bornée puis exécution (3 envois) : " << sendsAtFirstFill);
  CHECK(CountMagicIn() > 0, "exécution après requotes");
  CHECK(g_exec.Summary().s.find("2 requote(s)") != std::string::npos, "résumé d'exécution");
}

static void TestExecErrorsSuspend()
{
  SimState &S = Sim();
  datetime suspAt = 0;
  int sendsAtSusp = -1;
  std::vector<datetime> sendTimes;
  int lastSends = 0;
  RunInjected({TRADE_RETCODE_NO_MONEY, TRADE_RETCODE_INVALID_VOLUME, TRADE_RETCODE_NO_MONEY}, [&](size_t) {
    if (g_exec.sends != lastSends)
    {
      lastSends = g_exec.sends;
      sendTimes.push_back(S.now);
    }
    if (suspAt == 0 && g_guard.execSuspended)
    {
      suspAt = S.now;
      sendsAtSusp = g_exec.sends;
    }
  });
  CHECK(suspAt != 0, "3 erreurs consécutives : entrées suspendues");
  CHECK(sendsAtSusp == 3, "erreurs non récupérables : aucune nouvelle tentative (" << sendsAtSusp << " envois)");
  CHECK(g_exec.rejects >= 3, "rejets comptés");
  for (size_t i = 1; i < sendTimes.size() && i < 3; i++)
    CHECK(sendTimes[i] - sendTimes[i - 1] >= InpErrorCooldownSec, "refroidissement respecté entre deux erreurs");
  std::string day = TimeToString(suspAt, TIME_DATE).s;
  for (const SimDeal &d : S.deals)
    if (d.entry == DEAL_ENTRY_IN && d.magic == (ulong)InpMagic && d.time >= suspAt)
      CHECK(TimeToString(d.time, TIME_DATE).s != day, "entrée le jour même malgré la suspension");
  std::string j = S.files["GLS\\" + g_log.Base().s + "_journal.csv"];
  CHECK(j.find("erreurs d'exécution consécutives") != std::string::npos, "suspension journalisée");
}

static void TestExecTimeout()
{
  RunInjected({TRADE_RETCODE_TIMEOUT}, nullptr);
  CHECK(g_exec.uncertain == 1, "délai dépassé : résultat incertain compté");
  CHECK(CountMagicIn() > 0, "reprise après resynchronisation");
}

static void TestDataGap()
{
  SetupMarket(10000.0, 19, 1234u + (unsigned)GLS_FAMILY_SR_BOUNCE);
  SimState &S = Sim();
  size_t g = IndexAtOrAfter(ShimTimegm(2025, 3, 3, 0, 0, 0) + 8 * 86400 + 10 * 3600);
  S.m1.erase(S.m1.begin() + (long)g, S.m1.begin() + (long)g + 10); // 10 minutes manquantes
  SimBuildAggregates();
  datetime gapEnd = S.m1[g].time;
  RelaxContextFilters();
  InpFamily = GLS_FAMILY_SR_BOUNCE;
  InpMinScore = 0;
  InpNewsMode = GLS_NEWS_OFF;
  InpUseSessions = false;
  size_t i0 = StartEa(7);
  RunStats rs;
  bool sawGap = false;
  ReplayBars(i0, S.m1.size(), 0.20, rs, [&](size_t i) {
    if (S.m1[i].time >= gapEnd && S.m1[i].time < gapEnd + 20 * 60 && g_ctx.dataGap)
      sawGap = true;
  });
  CHECK(sawGap, "trou de données détecté");
  for (const SimDeal &d : S.deals)
    if (d.entry == DEAL_ENTRY_IN && d.magic == (ulong)InpMagic)
      CHECK(d.time < gapEnd || d.time >= gapEnd + 29 * 60, "entrée pendant la fenêtre de données incomplètes");
  CheckRunInvariants(rs, "trou de données");
}

//==========================================================================
// v1.10 : comparaison A/B des filtres (données synthétiques : AUCUNE valeur
// de performance ; on vérifie que chaque filtre agit, ne contourne aucune
// limite de risque, et que les invariants restent vrais)
//==========================================================================
struct AbRun
{
  int entries = 0;
  int executed = 0;
  int rows = 0;
  int rrRefusals = 0;
  std::map<std::string, int> criteria;
  std::vector<std::vector<std::string>> exec;
};

static AbRun RunAb(int family, const char *label, std::function<void()> cfg)
{
  ResetAll();
  SetupMarket(10000.0, 19, 1234u + (unsigned)family);
  InpFamily = (ENUM_GLS_FAMILY)family;
  InpMinScore = 0;
  InpNewsMode = GLS_NEWS_OFF;
  InpUseSessions = false;
  InpRunLabel = label;
  cfg();
  size_t i0 = StartEa(7);
  RunStats rs;
  ReplayBars(i0, Sim().m1.size(), 0.20, rs);
  FlushTimers(5);
  CheckRunInvariants(rs, label);
  AbRun r;
  r.entries = CountMagicIn();
  std::istringstream in(Sim().files["GLS\\" + g_log.Base().s + "_signals.csv"]);
  std::string line;
  const char *keys[] = {"-régime ", "-M15 opposée", "-M5 opposée", "-figure contraire", "-bougie de déclenchement", "-mouvement de", "-prix dans une"};
  while (std::getline(in, line))
  {
    std::vector<std::string> f;
    std::string x;
    std::istringstream ls(line);
    while (std::getline(ls, x, ';'))
      f.push_back(x);
    if (f.size() < 28 || f[0] == "time")
      continue;
    r.rows++;
    if (f[18] == "EXECUTE")
    {
      r.executed++;
      r.exec.push_back(f);
    }
    if (f[19] == GlsRefusalText(GLS_REFUSE_RR).s)
      r.rrRefusals++;
    for (const char *k : keys)
      if (line.find(k) != std::string::npos)
        r.criteria[k]++;
  }
  OnDeinit(0);
  return r;
}

static void TestFilterAB()
{
  const int fam = GLS_FAMILY_SWEEP;
  AbRun ref = RunAb(fam, "reference", [] { RelaxContextFilters(); });
  AbRun rg = RunAb(fam, "regime", [] { RelaxContextFilters(); InpUseRegimeFilter = true; });
  AbRun tr = RunAb(fam, "tendance", [] { RelaxContextFilters(); InpUseTrendFilter = true; });
  AbRun cd = RunAb(fam, "bougies", [] { RelaxContextFilters(); InpCdlBlockOpposing = true; InpCdlBlockIndecision = true; InpCdlBlockExtended = true; });
  AbRun ob = RunAb(fam, "obstacles", [] { RelaxContextFilters(); InpUseSRObstacles = true; });
  AbRun all = RunAb(fam, "defaut", [] {});
  std::cout << "         F1 entrées (synthétique, sans valeur de performance) : référence " << ref.entries << ", +régime " << rg.entries
            << ", +tendance " << tr.entries << ", +bougies " << cd.entries << ", +obstacles S/R " << ob.entries << ", tous (défaut) " << all.entries << "\n";
  CHECK(ref.entries > 0, "référence : des entrées");
  CHECK(rg.criteria["-régime "] > 0, "filtre de régime actif");
  for (auto &f : rg.exec)
    CHECK(f[23] == "TENDANCE" || f[23] == "RANGE" || f[23] == "TRANSITION", "F1 exécuté en régime non autorisé : " << f[23]);
  CHECK(tr.criteria["-M15 opposée"] + tr.criteria["-M5 opposée"] > 0, "filtre de tendance actif");
  CHECK(cd.criteria["-figure contraire"] + cd.criteria["-bougie de déclenchement"] + cd.criteria["-mouvement de"] > 0, "filtres de bougies actifs");
  CHECK(ob.rrRefusals > ref.rrRefusals, "obstacles S/R : plus de refus d'espace (" << ob.rrRefusals << " vs " << ref.rrRefusals << ")");
  for (auto &f : all.exec)
    CHECK(f[19] == GlsRefusalText(GLS_REFUSE_NONE).s, "exécution malgré un refus : " << f[19]);
  CHECK(ref.criteria["-régime "] == 0 && ref.criteria["-prix dans une"] == 0, "référence : filtres v1.10 réellement désactivés");
}

//--- volume des journaux (bougies / FVG) au niveau par défaut
static void TestLogVolume()
{
  SetupMarket(10000.0, 19, 1234u);
  InpMinScore = 0;
  InpNewsMode = GLS_NEWS_OFF;
  size_t i0 = StartEa(7);
  RunStats rs;
  ReplayBars(i0, Sim().m1.size(), 0.20, rs);
  auto lines = [](const std::string &f) {
    int n = 0;
    for (char c : Sim().files[f])
      if (c == '\n')
        n++;
    return n;
  };
  int cdl = lines("GLS\\" + g_log.Base().s + "_bougies.csv");
  int fvg = lines("GLS\\" + g_log.Base().s + "_fvg.csv");
  int days = 8; // jours de cotation rejoués (12 jours calendaires)
  std::cout << "         journal : " << cdl << " lignes bougies, " << fvg << " lignes FVG sur " << days << " jours de cotation\n";
  CHECK(cdl > 0 && fvg > 0, "journaux bougies et FVG écrits");
  CHECK(cdl / days < 600 && fvg / days < 600, "volume de journal maîtrisé au niveau par défaut");
  // niveau par défaut : une ligne par figure, à son statut FINAL (confirmée / invalidée / expirée)
  std::istringstream in(Sim().files["GLS\\" + g_log.Base().s + "_bougies.csv"]);
  std::string line;
  int bad = 0;
  while (std::getline(in, line))
  {
    std::vector<std::string> f;
    std::string x;
    std::istringstream ls(line);
    while (std::getline(ls, x, ';'))
      f.push_back(x);
    if (f.size() < 7 || f[0] == "heure")
      continue;
    if (f[6] != CandleStatusText(GLS_CDLST_CONFIRMED).s && f[6] != CandleStatusText(GLS_CDLST_INVALIDATED).s && f[6] != CandleStatusText(GLS_CDLST_EXPIRED).s)
      bad++;
  }
  CHECK(bad == 0, "niveau par défaut : statuts finaux uniquement (" << bad << " ligne(s) intermédiaire(s))");
}

int main(int argc, char **argv)
{
  if (argc > 1)
  {
    std::string f;
    std::istringstream in(argv[1]);
    while (std::getline(in, f, '|'))
      if (!f.empty())
        g_filters.push_back(f);
  }
  std::signal(SIGFPE, OnFpe);
  feenableexcept(FE_DIVBYZERO | FE_INVALID);
  RunTest("utilitaires (heures, DST, hachage)", TestUtils);
  RunTest("indicateurs ATR/EMA/ER et série miroir", TestIndicators);
  RunTest("structure : swings, BOS, CHOCH", TestStructure);
  RunTest("symbole, risque et volume", TestSymbolAndRisk);
  RunTest("commentaires d'ordres", TestComments);
  RunTest("F1 détection du balayage", TestSweepDetection);
  RunTest("F2/F3/F4 détection", TestOtherFamilies);
  RunTest("protections journalières", TestGuard);
  RunTest("statistiques : partiels agrégés", TestStatsAggregation);
  RunTest("signal déjà exécuté", TestDuplicateGuard);
  RunTest("bougies : mesures et amplitude nulle", TestCandleMetrics);
  RunTest("bougies : figures haussières et miroirs baissiers", TestCandlePatterns);
  RunTest("bougies : confirmation, invalidation, expiration", TestCandleStatus);
  RunTest("tendance et régimes", TestTrendRegime);
  RunTest("supports / résistances", TestZones);
  RunTest("FVG / IFVG / OB", TestFvg);
  RunTest("F5 réaction sur support/résistance + obstacles", TestSRBounce);
  RunTest("F6 retest de FVG", TestFvgRetest);
  RunTest("qualité d'exécution (statistiques)", TestExecStats);
  RunTest("alertes", TestAlerts);
  RunTest("intégration F1", TestPipelineF1);
  RunTest("intégration F2", TestPipelineF2);
  RunTest("intégration F3", TestPipelineF3);
  RunTest("intégration F4", TestPipelineF4);
  RunTest("intégration F5 (paramètres par défaut)", TestPipelineF5);
  RunTest("intégration F6 (paramètres par défaut)", TestPipelineF6);
  RunTest("redémarrage après TP1 (variables globales)", TestRestartKeepGlobals);
  RunTest("redémarrage après TP1 (sans variables globales)", TestRestartWipeGlobals);
  RunTest("position sans stop : protection", TestNoStopProtect);
  RunTest("position sans stop : fermeture de sécurité", TestNoStopClose);
  RunTest("bouton fermer tout", TestCloseAllButton);
  RunTest("bouton démarrer (compte réel)", TestStartRealAccount);
  RunTest("bouton vérifier la connexion", TestConnectionCheck);
  RunTest("petit compte (10)", TestSmallAccount);
  RunTest("coupure de connexion", TestDisconnect);
  RunTest("pannes : requotes", TestExecRequotes);
  RunTest("pannes : erreurs consécutives -> suspension", TestExecErrorsSuspend);
  RunTest("pannes : délai dépassé", TestExecTimeout);
  RunTest("intégrité : trou de données", TestDataGap);
  RunTest("comparaison A/B des filtres (F1)", TestFilterAB);
  RunTest("volume des journaux", TestLogVolume);
  std::cout << "\n" << g_checks << " vérifications, " << g_failures << " échec(s)\n";
  return g_failures == 0 ? 0 : 1;
}
