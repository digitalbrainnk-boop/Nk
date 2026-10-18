// replay_main.cpp - rejoue l'EA (code MQL5 compilé en C++ avec le shim) sur des barres M1 RÉELLES
// exportées de MetaTrader 5 (Affichage > Symboles > Barres > Exporter), avec le spread de chaque barre.
//
// C'est une validation PAR SIMULATION : exécution simplifiée (4 cotations par barre O/extrêmes/C,
// remplissage au prix demandé + glissement fixe optionnel, pas de ticks réels). Elle ne remplace ni le
// testeur de stratégie MT5 ni une période de démo ; elle permet de rejouer exactement les mêmes règles
// et préréglages (.set) sur des données réelles et d'appliquer le protocole statistique.
//
// Usage :
//   replay --data XAUUSDm_M1.csv --set tester/sets/F1_balayage.set --out sortie/ [options]
// Options : --from AAAA-MM-JJ --to AAAA-MM-JJ (fenêtre rejouée), --warmup-days N (3), --label L,
//   --balance 1000 --usd-to-account 1.0 --currency USD --contract 100 --commission 0 (par lot et par côté)
//   --slippage 0 (prix, défavorable) --spread 0.20 (si la colonne SPREAD est absente ou nulle)
//   --utc-offset 0 --dst 0 (heure du serveur des données) --symbol XAUUSDm --leverage 200
#include <chrono>
#include <csignal>
#include <fstream>
#include <new>

#include "shim/mql5_shim.h"
#include "mql/Gold_Liquidity_Scalper.mq5"
#include "mql/inputs_reset.inc"
#include "mql/inputs_set.inc"

template <class T>
void Renew(T &obj)
{
  obj.~T();
  new (&obj) T();
}

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
}

struct Options
{
  std::string data, set, out = ".", label, currency = "USD", symbol = "XAUUSDm", from, to;
  double balance = 1000.0, usdToAccount = 1.0, contract = 100.0, commission = 0.0, slippage = 0.0, spread = 0.20;
  int warmupDays = 3, utcOffset = 0, dst = 0;
  long leverage = 200;
};

static std::string Trim(std::string s)
{
  while (!s.empty() && (s.back() == '\r' || s.back() == '\n' || s.back() == ' ' || s.back() == '\t'))
    s.pop_back();
  size_t i = 0;
  while (i < s.size() && (s[i] == ' ' || s[i] == '\t' || s[i] == '\xEF' || s[i] == '\xBB' || s[i] == '\xBF'))
    i++;
  return s.substr(i);
}

static datetime ParseDate(const std::string &d, const std::string &t)
{
  // AAAA.MM.JJ ou AAAA-MM-JJ, HH:MM[:SS]
  int Y = 0, M = 0, D = 0, h = 0, m = 0, s = 0;
  if (std::sscanf(d.c_str(), "%d%*c%d%*c%d", &Y, &M, &D) != 3)
    return 0;
  std::sscanf(t.c_str(), "%d:%d:%d", &h, &m, &s);
  return ShimTimegm(Y, M, D, h, m, s);
}

static int Decimals(const std::string &v)
{
  size_t p = v.find('.');
  return (p == std::string::npos) ? 0 : (int)(v.size() - p - 1);
}

//--- export MT5 : <DATE> <TIME> <OPEN> <HIGH> <LOW> <CLOSE> <TICKVOL> <VOL> <SPREAD> (tabulation, virgule ou ';')
static bool LoadMt5Csv(const std::string &path, std::vector<MqlRates> &out, int &digits, std::string &err)
{
  std::ifstream in(path, std::ios::binary);
  if (!in)
  {
    err = "fichier illisible : " + path;
    return false;
  }
  std::string line;
  digits = 0;
  size_t lineNo = 0, bad = 0;
  while (std::getline(in, line))
  {
    lineNo++;
    line = Trim(line);
    if (line.empty())
      continue;
    char sep = (line.find('\t') != std::string::npos) ? '\t' : (line.find(';') != std::string::npos ? ';' : ',');
    std::vector<std::string> f;
    std::string x;
    std::istringstream ls(line);
    while (std::getline(ls, x, sep))
      f.push_back(Trim(x));
    if (f.empty() || !std::isdigit((unsigned char)f[0][0]))
      continue; // en-tête
    size_t k = 0;
    std::string date = f[k++], time = "00:00:00";
    if (date.find(' ') != std::string::npos)
    {
      time = date.substr(date.find(' ') + 1);
      date = date.substr(0, date.find(' '));
    }
    else if (f.size() > k && f[k].find(':') != std::string::npos)
      time = f[k++];
    if (f.size() < k + 4)
    {
      bad++;
      continue;
    }
    MqlRates r{};
    r.time = ParseDate(date, time);
    try
    {
      r.open = std::stod(f[k]);
      r.high = std::stod(f[k + 1]);
      r.low = std::stod(f[k + 2]);
      r.close = std::stod(f[k + 3]);
      r.tick_volume = (f.size() > k + 4) ? std::stoll(f[k + 4]) : 0;
      r.spread = (f.size() > k + 6) ? (int)std::stoll(f[k + 6]) : 0;
    }
    catch (...)
    {
      bad++;
      continue;
    }
    if (r.time == 0 || r.high < r.low || r.open <= 0.0 || r.close <= 0.0)
    {
      bad++;
      continue;
    }
    for (int j = 0; j < 4; j++)
      digits = std::max(digits, Decimals(f[k + (size_t)j]));
    out.push_back(r);
  }
  std::sort(out.begin(), out.end(), [](const MqlRates &a, const MqlRates &b) { return a.time < b.time; });
  out.erase(std::unique(out.begin(), out.end(), [](const MqlRates &a, const MqlRates &b) { return a.time == b.time; }), out.end());
  if (out.size() < 5000)
  {
    err = "trop peu de barres M1 valides (" + std::to_string(out.size()) + ")";
    return false;
  }
  if (bad > 0)
    std::cout << "  " << bad << " ligne(s) ignorée(s) (format ou prix incohérents) sur " << lineNo << "\n";
  return true;
}

//--- préréglage .set du testeur MT5 : « Nom=valeur » ou « Nom=valeur||début||pas||fin||N »
static bool ApplySet(const std::string &path, std::string &label, std::string &err)
{
  std::ifstream in(path, std::ios::binary);
  if (!in)
  {
    err = "préréglage illisible : " + path;
    return false;
  }
  std::string line;
  while (std::getline(in, line))
  {
    line = Trim(line);
    if (line.empty() || line[0] == ';' || line[0] == '#')
      continue;
    size_t eq = line.find('=');
    if (eq == std::string::npos)
      continue;
    std::string name = Trim(line.substr(0, eq));
    std::string value = Trim(line.substr(eq + 1));
    size_t bars = value.find("||");
    if (bars != std::string::npos)
      value = value.substr(0, bars);
    try
    {
      if (!SetInputByName(name, value))
        std::cout << "  ATTENTION paramètre inconnu ignoré : " << name << "\n";
    }
    catch (...)
    {
      err = "valeur invalide : " + line;
      return false;
    }
    if (name == "InpRunLabel")
      label = value;
  }
  return true;
}

static std::string Base(const std::string &p)
{
  size_t s = p.find_last_of("/\\");
  std::string b = (s == std::string::npos) ? p : p.substr(s + 1);
  size_t d = b.rfind('.');
  return (d == std::string::npos) ? b : b.substr(0, d);
}

int main(int argc, char **argv)
{
  Options o;
  for (int i = 1; i + 1 < argc; i += 2)
  {
    std::string k = argv[i], v = argv[i + 1];
    if (k == "--data") o.data = v;
    else if (k == "--set") o.set = v;
    else if (k == "--out") o.out = v;
    else if (k == "--label") o.label = v;
    else if (k == "--from") o.from = v;
    else if (k == "--to") o.to = v;
    else if (k == "--balance") o.balance = std::stod(v);
    else if (k == "--usd-to-account") o.usdToAccount = std::stod(v);
    else if (k == "--currency") o.currency = v;
    else if (k == "--contract") o.contract = std::stod(v);
    else if (k == "--commission") o.commission = std::stod(v);
    else if (k == "--slippage") o.slippage = std::stod(v);
    else if (k == "--spread") o.spread = std::stod(v);
    else if (k == "--warmup-days") o.warmupDays = std::stoi(v);
    else if (k == "--utc-offset") o.utcOffset = std::stoi(v);
    else if (k == "--dst") o.dst = std::stoi(v);
    else if (k == "--symbol") o.symbol = v;
    else if (k == "--leverage") o.leverage = std::stol(v);
    else
    {
      std::cerr << "option inconnue : " << k << "\n";
      return 2;
    }
  }
  if (o.data.empty() || o.set.empty())
  {
    std::cerr << "usage : replay --data fichier_M1.csv --set preset.set --out dossier [options]\n";
    return 2;
  }
  SimState &S = Sim();
  std::vector<MqlRates> rates;
  int digits = 2;
  std::string err;
  std::cout << "Lecture de " << o.data << "...\n";
  if (!LoadMt5Csv(o.data, rates, digits, err))
  {
    std::cerr << "ERREUR : " << err << "\n";
    return 2;
  }
  datetime from = o.from.empty() ? rates.front().time : ParseDate(o.from, "00:00");
  datetime to = o.to.empty() ? rates.back().time + 60 : ParseDate(o.to, "00:00") + 86400;
  // données : historique de chauffe avant la fenêtre + fenêtre rejouée
  datetime loadFrom = from - (datetime)(o.warmupDays + 3) * 86400;
  std::vector<MqlRates> win;
  for (const MqlRates &r : rates)
    if (r.time >= loadFrom && r.time < to)
      win.push_back(r);
  rates.clear();
  ResetInputs();
  std::string label = Base(o.set);
  if (!ApplySet(o.set, label, err))
  {
    std::cerr << "ERREUR : " << err << "\n";
    return 2;
  }
  if (!o.label.empty())
    label = o.label;
  InpRunLabel = string(label);
  InpServerOffsetMode = GLS_OFFSET_MANUAL;
  InpServerUTCOffsetHours = o.utcOffset;
  InpServerDST = (ENUM_GLS_SERVER_DST)o.dst;
  InpCommissionPerLotSide = o.commission;
  InpAutoStartInTester = true;
  InpWriteFiles = true;
  ResetEaMemory();
  AnalysisConfigInit();

  S.tester = true;
  S.symbol = o.symbol;
  S.digits = digits;
  S.point = std::pow(10.0, -digits);
  S.tickSize = S.point;
  S.contractSize = o.contract;
  S.balance = o.balance;
  S.currency = o.currency;
  S.usdToAccount = o.usdToAccount;
  S.commissionPerLotSide = o.commission;
  S.slippage = o.slippage;
  S.leverage = o.leverage;
  S.m1 = win;
  SimBuildAggregates();
  size_t i0 = 0;
  datetime start = std::max(from, win.front().time + (datetime)o.warmupDays * 86400);
  while (i0 < S.m1.size() && S.m1[i0].time < start)
    i0++;
  if (i0 >= S.m1.size())
  {
    std::cerr << "ERREUR : fenêtre vide après la chauffe\n";
    return 2;
  }
  auto spreadOf = [&](const MqlRates &b) { return (b.spread > 0) ? b.spread * S.point : o.spread; };
  S.now = S.m1[i0].time;
  S.bid = S.m1[i0].open;
  S.ask = S.bid + spreadOf(S.m1[i0]);
  if (OnInit() != INIT_SUCCEEDED)
  {
    std::cerr << "ERREUR : OnInit a échoué (paramètres refusés ?)\n";
    return 2;
  }
  std::cout << "Rejeu " << label << " : " << TimeToString(S.m1[i0].time, TIME_DATE).s << " -> "
            << TimeToString(S.m1.back().time, TIME_DATE).s << " (" << (S.m1.size() - i0) << " barres M1, " << digits << " décimales)\n";
  auto t0 = std::chrono::steady_clock::now();
  int lastMonth = -1;
  for (size_t i = i0; i < S.m1.size(); i++)
  {
    const MqlRates &b = S.m1[i];
    double sp = spreadOf(b);
    bool bull = b.close >= b.open;
    double pts[4] = {b.open, bull ? b.low : b.high, bull ? b.high : b.low, b.close};
    datetime ts[4] = {b.time, b.time + 15, b.time + 30, b.time + 55};
    for (int k = 0; k < 4; k++)
    {
      S.now = ts[k];
      S.bid = pts[k];
      S.ask = pts[k] + sp;
      bool gap = (k == 0 && i > i0 && S.m1[i - 1].time + 60 != b.time);
      SimProcessStops(gap);
      OnTick();
      OnTimer();
    }
    MqlDateTime dt;
    TimeToStruct(b.time, dt);
    if (dt.mon != lastMonth)
    {
      lastMonth = dt.mon;
      std::cout << "  " << TimeToString(b.time, TIME_DATE).s << " : " << g_stats.total << " trade(s) clôturé(s)\n" << std::flush;
    }
  }
  for (int i = 0; i < 5; i++)
  {
    S.now += 3;
    OnTimer();
  }
  OnDeinit(0);
  double secs = std::chrono::duration<double>(std::chrono::steady_clock::now() - t0).count();
  std::string base = "GLS\\" + g_log.Base().s;
  int written = 0;
  for (const char *suffix : {"_trades.csv", "_signals.csv", "_rapport.txt", "_fvg.csv", "_ob.csv", "_bougies.csv", "_journal.csv"})
  {
    auto it = S.files.find(base + suffix);
    if (it == S.files.end())
      continue;
    std::ofstream(o.out + "/" + label + suffix, std::ios::binary) << it->second;
    written++;
  }
  std::cout << "Terminé en " << (int)secs << " s : " << g_stats.total << " trade(s) clôturé(s), " << written << " fichier(s) dans " << o.out << "\n";
  return 0;
}
