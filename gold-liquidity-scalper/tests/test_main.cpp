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
  g_commissionPerLotSide = 0.0;
}

static void ResetAll()
{
  Sim() = SimState();
  ResetInputs();
  ResetEaMemory();
}

static void RunTest(const char *name, void (*fn)())
{
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
  // finalisation : prix réels, score borné
  InpUseEmaFilter = false;
  InpMinScore = 0;
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

static void TestPipelineFamily(int family)
{
  SetupMarket(10000.0, 19, 1234u + (unsigned)family);
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
  std::string label = "F" + std::to_string(family);
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

static void TestPipelineF1() { TestPipelineFamily(GLS_FAMILY_SWEEP); }
static void TestPipelineF2() { TestPipelineFamily(GLS_FAMILY_PULLBACK); }
static void TestPipelineF3() { TestPipelineFamily(GLS_FAMILY_RANGE_BREAK); }
static void TestPipelineF4() { TestPipelineFamily(GLS_FAMILY_SQUEEZE); }

//--- redémarrage après une prise partielle : aucune prise partielle rejouée
static void TestRestartAfterPartial(bool wipeGlobals)
{
  SetupMarket(10000.0, 19, 777u);
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

int main()
{
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
  RunTest("intégration F1", TestPipelineF1);
  RunTest("intégration F2", TestPipelineF2);
  RunTest("intégration F3", TestPipelineF3);
  RunTest("intégration F4", TestPipelineF4);
  RunTest("redémarrage après TP1 (variables globales)", TestRestartKeepGlobals);
  RunTest("redémarrage après TP1 (sans variables globales)", TestRestartWipeGlobals);
  RunTest("position sans stop : protection", TestNoStopProtect);
  RunTest("position sans stop : fermeture de sécurité", TestNoStopClose);
  RunTest("bouton fermer tout", TestCloseAllButton);
  RunTest("bouton démarrer (compte réel)", TestStartRealAccount);
  RunTest("bouton vérifier la connexion", TestConnectionCheck);
  RunTest("petit compte (10)", TestSmallAccount);
  RunTest("coupure de connexion", TestDisconnect);
  std::cout << "\n" << g_checks << " vérifications, " << g_failures << " échec(s)\n";
  return g_failures == 0 ? 0 : 1;
}
