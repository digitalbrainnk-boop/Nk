// mql5_shim.h - environnement MQL5 minimal pour compiler et exécuter le code
// de l'EA avec un compilateur C++ (g++/clang++), à des fins de VÉRIFICATION :
//   - types, énumérations et signatures des fonctions MQL5 utilisées ;
//   - tableaux dynamiques avec contrôle d'accès hors limites (erreur critique
//     en MQL5) et valeurs "poison" pour détecter les lectures non initialisées ;
//   - StringFormat avec contrôle des types d'arguments ;
//   - courtier simulé (positions, deals, historique, stops serveur, variables
//     globales, barres agrégées M1 -> M5/M15/D1) pour les tests d'intégration.
// Ce n'est PAS MetaTrader : les comportements sont simplifiés et documentés.
#pragma once
#pragma GCC system_header

#include <algorithm>
#include <cfenv>
#include <cmath>
#include <cstdint>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <ctime>
#include <functional>
#include <iostream>
#include <limits>
#include <map>
#include <sstream>
#include <stdexcept>
#include <string>
#include <type_traits>
#include <vector>

#undef SEEK_SET
#undef SEEK_CUR
#undef SEEK_END

typedef unsigned char uchar;
typedef unsigned short ushort;
typedef unsigned int uint;
typedef unsigned long ulong;
typedef long long datetime;
typedef unsigned int color;

//==========================================================================
// string MQL5 : pas de conversion implicite depuis un nombre
//==========================================================================
class string
{
public:
  std::string s;
  string() {}
  string(const char *c) : s(c ? c : "") {}
  string(const std::string &x) : s(x) {}
  string &operator+=(const string &o)
  {
    s += o.s;
    return *this;
  }
  const char *c_str() const { return s.c_str(); }
};
inline string operator+(const string &a, const string &b) { return string(a.s + b.s); }
inline bool operator==(const string &a, const string &b) { return a.s == b.s; }
inline bool operator!=(const string &a, const string &b) { return a.s != b.s; }
inline bool operator<(const string &a, const string &b) { return a.s < b.s; }
inline std::ostream &operator<<(std::ostream &o, const string &x) { return o << x.s; }

//==========================================================================
// Tableaux dynamiques MQL5
//==========================================================================
template <typename T, bool A = std::is_arithmetic<T>::value>
struct MqlPoison
{
  static void apply(T &) {}
};
template <typename T>
struct MqlPoison<T, true>
{
  static void apply(T &x)
  {
    if (std::is_floating_point<T>::value)
      x = std::numeric_limits<T>::quiet_NaN();
    else
      x = static_cast<T>(0x5A);
  }
};

template <typename T>
class MqlArray
{
public:
  std::vector<T> v;
  bool series = false;
  MqlArray() {}
  MqlArray(const MqlArray &) = delete;            // MQL5 : pas de copie de tableau
  MqlArray &operator=(const MqlArray &) = delete;  // (ArrayCopy obligatoire)
  int size() const { return (int)v.size(); }
  void check(int i) const
  {
    if (i < 0 || i >= (int)v.size())
      throw std::out_of_range("array out of range: index " + std::to_string(i) + " / taille " + std::to_string(v.size()));
  }
  T &operator[](int i)
  {
    check(i);
    return v[series ? v.size() - 1 - (size_t)i : (size_t)i];
  }
  const T &operator[](int i) const
  {
    check(i);
    return v[series ? v.size() - 1 - (size_t)i : (size_t)i];
  }
};

template <typename T>
int ArrayResize(MqlArray<T> &a, int n, int reserve = 0)
{
  (void)reserve;
  if (n < 0)
    return -1;
  size_t old = a.v.size();
  a.v.resize((size_t)n);
  for (size_t i = old; i < a.v.size(); i++)
    MqlPoison<T>::apply(a.v[i]);
  return n;
}
template <typename T>
int ArraySize(const MqlArray<T> &a) { return (int)a.v.size(); }
template <typename T, size_t N>
int ArraySize(const T (&)[N]) { return (int)N; }
template <typename T>
bool ArraySetAsSeries(MqlArray<T> &a, bool flag)
{
  a.series = flag;
  return true;
}
inline int ArrayInitialize(MqlArray<double> &a, double value)
{
  for (auto &x : a.v)
    x = value;
  return (int)a.v.size();
}
template <typename T>
bool ArraySort(MqlArray<T> &a)
{
  std::sort(a.v.begin(), a.v.end());
  return true;
}

//==========================================================================
// Énumérations et constantes (valeurs MQL5)
//==========================================================================
enum ENUM_TIMEFRAMES
{
  PERIOD_CURRENT = 0, PERIOD_M1 = 1, PERIOD_M5 = 5, PERIOD_M15 = 15, PERIOD_M30 = 30,
  PERIOD_H1 = 16385, PERIOD_H4 = 16388, PERIOD_D1 = 16408, PERIOD_W1 = 32769, PERIOD_MN1 = 49153
};
enum ENUM_DAY_OF_WEEK { SUNDAY = 0, MONDAY, TUESDAY, WEDNESDAY, THURSDAY, FRIDAY, SATURDAY };
enum ENUM_ORDER_TYPE
{
  ORDER_TYPE_BUY = 0, ORDER_TYPE_SELL, ORDER_TYPE_BUY_LIMIT, ORDER_TYPE_SELL_LIMIT, ORDER_TYPE_BUY_STOP,
  ORDER_TYPE_SELL_STOP, ORDER_TYPE_BUY_STOP_LIMIT, ORDER_TYPE_SELL_STOP_LIMIT, ORDER_TYPE_CLOSE_BY
};
enum ENUM_ORDER_TYPE_FILLING { ORDER_FILLING_FOK = 0, ORDER_FILLING_IOC = 1, ORDER_FILLING_RETURN = 2, ORDER_FILLING_BOC = 3 };
enum ENUM_ORDER_TYPE_TIME { ORDER_TIME_GTC = 0, ORDER_TIME_DAY, ORDER_TIME_SPECIFIED, ORDER_TIME_SPECIFIED_DAY };
enum ENUM_ORDER_STATE { ORDER_STATE_STARTED = 0, ORDER_STATE_PLACED, ORDER_STATE_CANCELED, ORDER_STATE_PARTIAL, ORDER_STATE_FILLED };
enum ENUM_TRADE_REQUEST_ACTIONS
{
  TRADE_ACTION_DEAL = 1, TRADE_ACTION_PENDING = 5, TRADE_ACTION_SLTP = 6, TRADE_ACTION_MODIFY = 7,
  TRADE_ACTION_REMOVE = 8, TRADE_ACTION_CLOSE_BY = 10
};
enum ENUM_TRADE_TRANSACTION_TYPE
{
  TRADE_TRANSACTION_ORDER_ADD = 0, TRADE_TRANSACTION_ORDER_UPDATE, TRADE_TRANSACTION_ORDER_DELETE,
  TRADE_TRANSACTION_DEAL_ADD = 6, TRADE_TRANSACTION_DEAL_UPDATE, TRADE_TRANSACTION_DEAL_DELETE,
  TRADE_TRANSACTION_HISTORY_ADD = 3, TRADE_TRANSACTION_HISTORY_UPDATE, TRADE_TRANSACTION_HISTORY_DELETE,
  TRADE_TRANSACTION_POSITION = 9, TRADE_TRANSACTION_REQUEST
};
enum ENUM_DEAL_TYPE { DEAL_TYPE_BUY = 0, DEAL_TYPE_SELL, DEAL_TYPE_BALANCE, DEAL_TYPE_CREDIT, DEAL_TYPE_CHARGE, DEAL_TYPE_CORRECTION };
enum ENUM_DEAL_ENTRY { DEAL_ENTRY_IN = 0, DEAL_ENTRY_OUT, DEAL_ENTRY_INOUT, DEAL_ENTRY_OUT_BY };
enum ENUM_DEAL_REASON
{
  DEAL_REASON_CLIENT = 0, DEAL_REASON_MOBILE, DEAL_REASON_WEB, DEAL_REASON_EXPERT, DEAL_REASON_SL, DEAL_REASON_TP,
  DEAL_REASON_SO, DEAL_REASON_ROLLOVER, DEAL_REASON_VMARGIN, DEAL_REASON_SPLIT
};
enum ENUM_POSITION_TYPE { POSITION_TYPE_BUY = 0, POSITION_TYPE_SELL };

enum ENUM_SYMBOL_INFO_INTEGER
{
  SYMBOL_DIGITS = 1, SYMBOL_SPREAD, SYMBOL_TRADE_STOPS_LEVEL, SYMBOL_TRADE_FREEZE_LEVEL, SYMBOL_TRADE_MODE,
  SYMBOL_TRADE_EXEMODE, SYMBOL_FILLING_MODE, SYMBOL_SELECT, SYMBOL_EXIST
};
enum ENUM_SYMBOL_INFO_DOUBLE
{
  SYMBOL_BID = 100, SYMBOL_ASK, SYMBOL_POINT, SYMBOL_TRADE_TICK_SIZE, SYMBOL_TRADE_TICK_VALUE,
  SYMBOL_TRADE_TICK_VALUE_LOSS, SYMBOL_TRADE_TICK_VALUE_PROFIT, SYMBOL_TRADE_CONTRACT_SIZE,
  SYMBOL_VOLUME_MIN, SYMBOL_VOLUME_MAX, SYMBOL_VOLUME_STEP, SYMBOL_VOLUME_LIMIT
};
enum ENUM_SYMBOL_INFO_STRING { SYMBOL_CURRENCY_BASE = 200, SYMBOL_CURRENCY_PROFIT, SYMBOL_CURRENCY_MARGIN, SYMBOL_DESCRIPTION };
enum ENUM_SYMBOL_TRADE_MODE
{
  SYMBOL_TRADE_MODE_DISABLED = 0, SYMBOL_TRADE_MODE_LONGONLY, SYMBOL_TRADE_MODE_SHORTONLY,
  SYMBOL_TRADE_MODE_CLOSEONLY, SYMBOL_TRADE_MODE_FULL
};
enum ENUM_SYMBOL_TRADE_EXECUTION
{
  SYMBOL_TRADE_EXECUTION_REQUEST = 0, SYMBOL_TRADE_EXECUTION_INSTANT, SYMBOL_TRADE_EXECUTION_MARKET,
  SYMBOL_TRADE_EXECUTION_EXCHANGE
};
const int SYMBOL_FILLING_FOK = 1;
const int SYMBOL_FILLING_IOC = 2;

enum ENUM_POSITION_PROPERTY_INTEGER
{
  POSITION_TICKET = 300, POSITION_TIME, POSITION_TIME_MSC, POSITION_TYPE, POSITION_MAGIC, POSITION_IDENTIFIER, POSITION_REASON
};
enum ENUM_POSITION_PROPERTY_DOUBLE
{
  POSITION_VOLUME = 320, POSITION_PRICE_OPEN, POSITION_SL, POSITION_TP, POSITION_PRICE_CURRENT, POSITION_SWAP, POSITION_PROFIT
};
enum ENUM_POSITION_PROPERTY_STRING { POSITION_SYMBOL = 340, POSITION_COMMENT };
enum ENUM_ORDER_PROPERTY_INTEGER { ORDER_TICKET = 400, ORDER_TYPE, ORDER_MAGIC, ORDER_TIME_SETUP };
enum ENUM_ORDER_PROPERTY_DOUBLE { ORDER_VOLUME_INITIAL = 420, ORDER_PRICE_OPEN, ORDER_SL, ORDER_TP };
enum ENUM_ORDER_PROPERTY_STRING { ORDER_SYMBOL = 440, ORDER_COMMENT };
enum ENUM_DEAL_PROPERTY_INTEGER
{
  DEAL_TICKET = 500, DEAL_ORDER, DEAL_TIME, DEAL_TIME_MSC, DEAL_TYPE, DEAL_ENTRY, DEAL_MAGIC, DEAL_REASON, DEAL_POSITION_ID
};
enum ENUM_DEAL_PROPERTY_DOUBLE { DEAL_VOLUME = 520, DEAL_PRICE, DEAL_COMMISSION, DEAL_SWAP, DEAL_PROFIT, DEAL_FEE };
enum ENUM_DEAL_PROPERTY_STRING { DEAL_SYMBOL = 540, DEAL_COMMENT };

enum ENUM_ACCOUNT_INFO_INTEGER
{
  ACCOUNT_LOGIN = 600, ACCOUNT_TRADE_MODE, ACCOUNT_LEVERAGE, ACCOUNT_TRADE_ALLOWED, ACCOUNT_TRADE_EXPERT, ACCOUNT_MARGIN_MODE
};
enum ENUM_ACCOUNT_INFO_DOUBLE { ACCOUNT_BALANCE = 620, ACCOUNT_EQUITY, ACCOUNT_MARGIN, ACCOUNT_MARGIN_FREE, ACCOUNT_PROFIT };
enum ENUM_ACCOUNT_INFO_STRING { ACCOUNT_CURRENCY = 640, ACCOUNT_SERVER, ACCOUNT_COMPANY, ACCOUNT_NAME };
enum ENUM_ACCOUNT_TRADE_MODE { ACCOUNT_TRADE_MODE_DEMO = 0, ACCOUNT_TRADE_MODE_CONTEST, ACCOUNT_TRADE_MODE_REAL };
enum ENUM_ACCOUNT_MARGIN_MODE { ACCOUNT_MARGIN_MODE_RETAIL_NETTING = 0, ACCOUNT_MARGIN_MODE_EXCHANGE, ACCOUNT_MARGIN_MODE_RETAIL_HEDGING };
enum ENUM_TERMINAL_INFO_INTEGER { TERMINAL_CONNECTED = 700, TERMINAL_TRADE_ALLOWED, TERMINAL_PING_LAST };
enum ENUM_MQL_INFO_INTEGER { MQL_TESTER = 800, MQL_OPTIMIZATION, MQL_VISUAL_MODE, MQL_TRADE_ALLOWED };
enum ENUM_SERIES_INFO_INTEGER { SERIES_BARS_COUNT = 900, SERIES_SYNCHRONIZED };
enum ENUM_CALENDAR_EVENT_IMPORTANCE { CALENDAR_IMPORTANCE_NONE = 0, CALENDAR_IMPORTANCE_LOW, CALENDAR_IMPORTANCE_MODERATE, CALENDAR_IMPORTANCE_HIGH };
enum ENUM_CALENDAR_EVENT_IMPACT { CALENDAR_IMPACT_NA = 0, CALENDAR_IMPACT_POSITIVE, CALENDAR_IMPACT_NEGATIVE };

enum ENUM_OBJECT { OBJ_LABEL = 23, OBJ_BUTTON = 25, OBJ_RECTANGLE_LABEL = 110, OBJ_EDIT = 103 };
enum ENUM_OBJECT_PROPERTY_INTEGER
{
  OBJPROP_COLOR = 1000, OBJPROP_BACK, OBJPROP_SELECTABLE, OBJPROP_HIDDEN, OBJPROP_ZORDER, OBJPROP_CORNER,
  OBJPROP_XDISTANCE, OBJPROP_YDISTANCE, OBJPROP_XSIZE, OBJPROP_YSIZE, OBJPROP_BGCOLOR, OBJPROP_BORDER_TYPE,
  OBJPROP_BORDER_COLOR, OBJPROP_ANCHOR, OBJPROP_FONTSIZE, OBJPROP_STATE, OBJPROP_WIDTH
};
enum ENUM_OBJECT_PROPERTY_STRING { OBJPROP_TEXT = 1100, OBJPROP_FONT, OBJPROP_TOOLTIP };
enum ENUM_BASE_CORNER { CORNER_LEFT_UPPER = 0, CORNER_LEFT_LOWER, CORNER_RIGHT_LOWER, CORNER_RIGHT_UPPER };
enum ENUM_ANCHOR_POINT { ANCHOR_LEFT_UPPER = 0, ANCHOR_LEFT, ANCHOR_LEFT_LOWER };
enum ENUM_BORDER_TYPE { BORDER_FLAT = 0, BORDER_RAISED, BORDER_SUNKEN };
enum ENUM_CHART_EVENT { CHARTEVENT_KEYDOWN = 0, CHARTEVENT_MOUSE_MOVE = 10, CHARTEVENT_OBJECT_CREATE = 7, CHARTEVENT_OBJECT_CHANGE = 8,
                        CHARTEVENT_OBJECT_DELETE = 6, CHARTEVENT_CLICK = 4, CHARTEVENT_OBJECT_CLICK = 1 };
enum ENUM_FILE_POSITION { SEEK_SET = 0, SEEK_CUR, SEEK_END };

const uint TRADE_RETCODE_REQUOTE = 10004, TRADE_RETCODE_REJECT = 10006, TRADE_RETCODE_CANCEL = 10007,
           TRADE_RETCODE_PLACED = 10008, TRADE_RETCODE_DONE = 10009, TRADE_RETCODE_DONE_PARTIAL = 10010,
           TRADE_RETCODE_ERROR = 10011, TRADE_RETCODE_TIMEOUT = 10012, TRADE_RETCODE_INVALID = 10013,
           TRADE_RETCODE_INVALID_VOLUME = 10014, TRADE_RETCODE_INVALID_PRICE = 10015, TRADE_RETCODE_INVALID_STOPS = 10016,
           TRADE_RETCODE_TRADE_DISABLED = 10017, TRADE_RETCODE_MARKET_CLOSED = 10018, TRADE_RETCODE_NO_MONEY = 10019,
           TRADE_RETCODE_PRICE_CHANGED = 10020, TRADE_RETCODE_PRICE_OFF = 10021, TRADE_RETCODE_INVALID_EXPIRATION = 10022,
           TRADE_RETCODE_ORDER_CHANGED = 10023, TRADE_RETCODE_TOO_MANY_REQUESTS = 10024, TRADE_RETCODE_NO_CHANGES = 10025,
           TRADE_RETCODE_SERVER_DISABLES_AT = 10026, TRADE_RETCODE_CLIENT_DISABLES_AT = 10027, TRADE_RETCODE_LOCKED = 10028,
           TRADE_RETCODE_FROZEN = 10029, TRADE_RETCODE_INVALID_FILL = 10030, TRADE_RETCODE_CONNECTION = 10031,
           TRADE_RETCODE_ONLY_REAL = 10032, TRADE_RETCODE_LIMIT_ORDERS = 10033, TRADE_RETCODE_LIMIT_VOLUME = 10034,
           TRADE_RETCODE_INVALID_ORDER = 10035, TRADE_RETCODE_POSITION_CLOSED = 10036, TRADE_RETCODE_INVALID_CLOSE_VOLUME = 10038,
           TRADE_RETCODE_CLOSE_ORDER_EXIST = 10039, TRADE_RETCODE_LIMIT_POSITIONS = 10040, TRADE_RETCODE_REJECT_CANCEL = 10041,
           TRADE_RETCODE_LONG_ONLY = 10042, TRADE_RETCODE_SHORT_ONLY = 10043, TRADE_RETCODE_CLOSE_ONLY = 10044,
           TRADE_RETCODE_FIFO_CLOSE = 10045;

const int INIT_SUCCEEDED = 0, INIT_FAILED = 1, INIT_PARAMETERS_INCORRECT = 32767;
const int TIME_DATE = 1, TIME_MINUTES = 2, TIME_SECONDS = 4;
const int FILE_READ = 1, FILE_WRITE = 2, FILE_BIN = 4, FILE_CSV = 8, FILE_TXT = 16, FILE_ANSI = 32, FILE_UNICODE = 64,
          FILE_SHARE_READ = 128, FILE_SHARE_WRITE = 256, FILE_REWRITE = 512, FILE_COMMON = 4096;
const int INVALID_HANDLE = -1;
const uint CP_ACP = 0, CP_UTF8 = 65001;
const int MB_OK = 0, MB_YESNO = 4, MB_ICONERROR = 0x10, MB_ICONQUESTION = 0x20, MB_ICONWARNING = 0x30,
          MB_ICONINFORMATION = 0x40, MB_DEFBUTTON2 = 0x100;
const int IDOK = 1, IDCANCEL = 2, IDYES = 6, IDNO = 7;
const color clrWhite = 0xFFFFFF, clrBlack = 0, clrRed = 0x0000FF, clrGreen = 0x008000, clrGold = 0x00D7FF;

//==========================================================================
// Structures MQL5 (champs et types conformes à la documentation)
//==========================================================================
struct MqlRates
{
  datetime time;
  double open;
  double high;
  double low;
  double close;
  long tick_volume;
  int spread;
  long real_volume;
};
struct MqlTick
{
  datetime time;
  double bid;
  double ask;
  double last;
  ulong volume;
  long time_msc;
  uint flags;
  double volume_real;
};
struct MqlDateTime
{
  int year;
  int mon;
  int day;
  int hour;
  int min;
  int sec;
  int day_of_week;
  int day_of_year;
};
struct MqlTradeRequest
{
  ENUM_TRADE_REQUEST_ACTIONS action;
  ulong magic;
  ulong order;
  string symbol;
  double volume;
  double price;
  double stoplimit;
  double sl;
  double tp;
  ulong deviation;
  ENUM_ORDER_TYPE type;
  ENUM_ORDER_TYPE_FILLING type_filling;
  ENUM_ORDER_TYPE_TIME type_time;
  datetime expiration;
  string comment;
  ulong position;
  ulong position_by;
};
struct MqlTradeResult
{
  uint retcode;
  ulong deal;
  ulong order;
  double volume;
  double price;
  double bid;
  double ask;
  string comment;
  uint request_id;
  int retcode_external;
};
struct MqlTradeCheckResult
{
  uint retcode;
  double balance;
  double equity;
  double profit;
  double margin;
  double margin_free;
  double margin_level;
  string comment;
};
struct MqlTradeTransaction
{
  ulong deal;
  ulong order;
  string symbol;
  ENUM_TRADE_TRANSACTION_TYPE type;
  ENUM_ORDER_TYPE order_type;
  ENUM_ORDER_STATE order_state;
  ENUM_DEAL_TYPE deal_type;
  ENUM_ORDER_TYPE_TIME time_type;
  datetime time_expiration;
  double price;
  double price_trigger;
  double price_sl;
  double price_tp;
  double volume;
  ulong position;
  ulong position_by;
};
struct MqlCalendarValue
{
  ulong id;
  ulong event_id;
  datetime time;
  datetime period;
  int revision;
  long actual_value;
  long prev_value;
  long revised_prev_value;
  long forecast_value;
  ENUM_CALENDAR_EVENT_IMPACT impact_type;
};
struct MqlCalendarEvent
{
  ulong id;
  int type;
  int sector;
  int frequency;
  int time_mode;
  ulong country_id;
  int unit;
  ENUM_CALENDAR_EVENT_IMPORTANCE importance;
  int multiplier;
  uint digits;
  string source_url;
  string event_code;
  string name;
};

//==========================================================================
// Mathématiques et conversions
//==========================================================================
template <typename A, typename B>
typename std::common_type<A, B>::type MathMax(A a, B b)
{
  typedef typename std::common_type<A, B>::type C;
  return (C)a > (C)b ? (C)a : (C)b;
}
template <typename A, typename B>
typename std::common_type<A, B>::type MathMin(A a, B b)
{
  typedef typename std::common_type<A, B>::type C;
  return (C)a < (C)b ? (C)a : (C)b;
}
inline double MathAbs(double x) { return std::fabs(x); }
inline double MathRound(double x) { return std::round(x); }
inline double MathFloor(double x) { return std::floor(x); }
inline double MathCeil(double x) { return std::ceil(x); }
inline double MathSqrt(double x) { return std::sqrt(x); }
inline double MathPow(double b, double e) { return std::pow(b, e); }
inline double MathLog(double x) { return std::log(x); }
inline bool MathIsValidNumber(double x) { return std::isfinite(x); }
inline double NormalizeDouble(double v, int digits)
{
  double p = std::pow(10.0, digits);
  return std::round(v * p) / p;
}

//==========================================================================
// Chaînes
//==========================================================================
inline int StringLen(const string &s) { return (int)s.s.size(); }
inline string StringSubstr(const string &s, int start, int length = -1)
{
  if (start < 0 || start >= (int)s.s.size())
    return string("");
  if (length < 0)
    return string(s.s.substr((size_t)start));
  return string(s.s.substr((size_t)start, (size_t)length));
}
inline int StringFind(const string &s, const string &match, int start = 0)
{
  size_t p = s.s.find(match.s, (size_t)std::max(0, start));
  return p == std::string::npos ? -1 : (int)p;
}
inline ushort StringGetCharacter(const string &s, int pos)
{
  if (pos < 0 || pos >= (int)s.s.size())
    return 0;
  return (ushort)(uchar)s.s[(size_t)pos];
}
inline int StringSplit(const string &s, ushort sep, MqlArray<string> &result)
{
  ArrayResize(result, 0);
  std::string cur;
  std::vector<std::string> parts;
  for (char c : s.s)
  {
    if ((ushort)(uchar)c == sep)
    {
      parts.push_back(cur);
      cur.clear();
    }
    else
      cur += c;
  }
  parts.push_back(cur);
  ArrayResize(result, (int)parts.size());
  for (size_t i = 0; i < parts.size(); i++)
    result[(int)i] = string(parts[i]);
  return (int)parts.size();
}
inline int StringTrimLeft(string &s)
{
  size_t i = 0;
  while (i < s.s.size() && std::isspace((unsigned char)s.s[i]))
    i++;
  s.s.erase(0, i);
  return (int)i;
}
inline int StringTrimRight(string &s)
{
  size_t n = s.s.size();
  while (!s.s.empty() && std::isspace((unsigned char)s.s.back()))
    s.s.pop_back();
  return (int)(n - s.s.size());
}
inline bool StringToUpper(string &s)
{
  for (auto &c : s.s)
    c = (char)std::toupper((unsigned char)c);
  return true;
}
inline long StringToInteger(const string &s) { return std::strtol(s.s.c_str(), nullptr, 10); }
inline double StringToDouble(const string &s) { return std::strtod(s.s.c_str(), nullptr); }
inline string IntegerToString(long number, int str_len = 0, ushort fill_symbol = ' ')
{
  std::string r = std::to_string(number);
  while ((int)r.size() < str_len)
    r = std::string(1, (char)fill_symbol) + r;
  return string(r);
}
inline string DoubleToString(double value, int digits = 8)
{
  char buf[64];
  std::snprintf(buf, sizeof(buf), "%.*f", digits, value);
  return string(buf);
}
inline datetime ShimTimegm(int y, int mo, int d, int h, int mi, int s)
{
  // jours depuis 1970 (algorithme de Howard Hinnant)
  y -= mo <= 2;
  const long era = (y >= 0 ? y : y - 399) / 400;
  const unsigned yoe = (unsigned)(y - era * 400);
  const unsigned doy = (unsigned)((153 * (mo + (mo > 2 ? -3 : 9)) + 2) / 5 + d - 1);
  const unsigned doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
  long days = era * 146097 + (long)doe - 719468;
  return (datetime)days * 86400 + h * 3600 + mi * 60 + s;
}
inline bool TimeToStruct(datetime t, MqlDateTime &dt)
{
  long days = (long)(t >= 0 ? t / 86400 : (t - 86399) / 86400);
  long secs = (long)(t - (datetime)days * 86400);
  long z = days + 719468;
  const long era = (z >= 0 ? z : z - 146096) / 146097;
  const unsigned doe = (unsigned)(z - era * 146097);
  const unsigned yoe = (doe - doe / 1460 + doe / 36524 - doe / 146096) / 365;
  long y = (long)yoe + era * 400;
  const unsigned doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
  const unsigned mp = (5 * doy + 2) / 153;
  const unsigned d = doy - (153 * mp + 2) / 5 + 1;
  const unsigned m = mp < 10 ? mp + 3 : mp - 9;
  y += (m <= 2);
  dt.year = (int)y;
  dt.mon = (int)m;
  dt.day = (int)d;
  dt.hour = (int)(secs / 3600);
  dt.min = (int)((secs % 3600) / 60);
  dt.sec = (int)(secs % 60);
  dt.day_of_week = (int)(((days % 7) + 11) % 7); // 1970-01-01 = jeudi (4)
  dt.day_of_year = (int)((t - ShimTimegm(dt.year, 1, 1, 0, 0, 0)) / 86400);
  return true;
}
inline datetime StructToTime(MqlDateTime &dt) { return ShimTimegm(dt.year, dt.mon, dt.day, dt.hour, dt.min, dt.sec); }
inline string TimeToString(datetime value, int mode = TIME_DATE | TIME_MINUTES)
{
  MqlDateTime d;
  TimeToStruct(value, d);
  char buf[64];
  std::string r;
  if (mode & TIME_DATE)
  {
    std::snprintf(buf, sizeof(buf), "%04d.%02d.%02d", d.year, d.mon, d.day);
    r += buf;
  }
  if (mode & (TIME_MINUTES | TIME_SECONDS))
  {
    if (!r.empty())
      r += " ";
    if (mode & TIME_SECONDS)
      std::snprintf(buf, sizeof(buf), "%02d:%02d:%02d", d.hour, d.min, d.sec);
    else
      std::snprintf(buf, sizeof(buf), "%02d:%02d", d.hour, d.min);
    r += buf;
  }
  return string(r);
}
inline datetime StringToTime(const string &s)
{
  int y = 0, mo = 0, d = 0, h = 0, mi = 0, se = 0;
  int n = std::sscanf(s.s.c_str(), "%d.%d.%d %d:%d:%d", &y, &mo, &d, &h, &mi, &se);
  if (n < 3)
    return 0;
  return ShimTimegm(y, mo, d, h, mi, se);
}
template <typename E>
string EnumToString(E e) { return string("ENUM_" + std::to_string((long)e)); }

//--- StringFormat avec contrôle des types (comme MQL5 l'exige en pratique)
struct ShimArg
{
  char kind; // 'i' entier <=32 bits, 'L' entier 64 bits, 'd' réel, 's' chaîne
  long long iv;
  double dv;
  std::string sv;
};
template <typename T>
ShimArg ShimMakeArg(const T &x)
{
  ShimArg a{};
  if (std::is_floating_point<T>::value)
  {
    a.kind = 'd';
    a.dv = (double)x;
  }
  else if (std::is_integral<T>::value || std::is_enum<T>::value)
  {
    if (std::is_same<T, bool>::value)
      throw std::logic_error("StringFormat : argument bool");
    a.kind = sizeof(T) > 4 ? 'L' : 'i';
    a.iv = (long long)x;
  }
  else
    throw std::logic_error("StringFormat : type d'argument non pris en charge");
  return a;
}
inline ShimArg ShimMakeArg(const string &x)
{
  ShimArg a{};
  a.kind = 's';
  a.sv = x.s;
  return a;
}
inline ShimArg ShimMakeArg(const char *x)
{
  ShimArg a{};
  a.kind = 's';
  a.sv = x;
  return a;
}
inline string ShimFormat(const std::string &fmt, const std::vector<ShimArg> &args)
{
  std::string out;
  size_t ai = 0;
  for (size_t i = 0; i < fmt.size(); i++)
  {
    if (fmt[i] != '%')
    {
      out += fmt[i];
      continue;
    }
    if (i + 1 < fmt.size() && fmt[i + 1] == '%')
    {
      out += '%';
      i++;
      continue;
    }
    size_t j = i + 1;
    std::string spec = "%";
    while (j < fmt.size() && std::strchr("-+ #0123456789.", fmt[j]))
      spec += fmt[j++];
    bool i64 = false;
    if (fmt.compare(j, 3, "I64") == 0)
    {
      i64 = true;
      j += 3;
    }
    if (j >= fmt.size())
      throw std::logic_error("StringFormat : spécificateur incomplet dans \"" + fmt + "\"");
    char conv = fmt[j];
    if (ai >= args.size())
      throw std::logic_error("StringFormat : arguments manquants pour \"" + fmt + "\"");
    const ShimArg &a = args[ai++];
    char buf[512];
    if (std::strchr("diuxX", conv))
    {
      if (a.kind == 'L' && !i64)
        throw std::logic_error("StringFormat : entier 64 bits sans I64 dans \"" + fmt + "\"");
      if (a.kind != 'i' && a.kind != 'L')
        throw std::logic_error("StringFormat : %" + std::string(1, conv) + " attend un entier dans \"" + fmt + "\"");
      std::string sp = spec + "ll" + conv;
      std::snprintf(buf, sizeof(buf), sp.c_str(), a.iv);
    }
    else if (std::strchr("feEgG", conv))
    {
      if (a.kind != 'd')
        throw std::logic_error("StringFormat : %" + std::string(1, conv) + " attend un réel dans \"" + fmt + "\"");
      std::string sp = spec + conv;
      std::snprintf(buf, sizeof(buf), sp.c_str(), a.dv);
    }
    else if (conv == 's')
    {
      if (a.kind != 's')
        throw std::logic_error("StringFormat : %s attend une chaîne dans \"" + fmt + "\"");
      std::string sp = spec + "s";
      std::snprintf(buf, sizeof(buf), sp.c_str(), a.sv.c_str());
    }
    else
      throw std::logic_error("StringFormat : conversion inconnue dans \"" + fmt + "\"");
    out += buf;
    i = j;
  }
  if (ai != args.size())
    throw std::logic_error("StringFormat : trop d'arguments pour \"" + fmt + "\"");
  return string(out);
}
template <typename... Args>
string StringFormat(const string &fmt, const Args &...args)
{
  std::vector<ShimArg> v{ShimMakeArg(args)...};
  return ShimFormat(fmt.s, v);
}
inline string StringFormat(const string &fmt) { return ShimFormat(fmt.s, {}); }

//==========================================================================
// Courtier / terminal simulé
//==========================================================================
struct SimPosition
{
  ulong ticket;
  long identifier;
  std::string symbol;
  int type; // 0 achat, 1 vente
  double volume;
  double priceOpen;
  double sl;
  double tp;
  datetime time;
  ulong magic;
  std::string comment;
};
struct SimDeal
{
  ulong ticket;
  ulong order;
  long positionId;
  std::string symbol;
  int type;
  int entry;
  double volume;
  double price;
  double profit;
  double commission;
  double swap;
  double fee;
  datetime time;
  ulong magic;
  std::string comment;
  int reason;
};
struct SimHistOrder
{
  ulong ticket;
  double sl;
  double tp;
  double price;
};
struct SimObject
{
  std::map<int, long> ints;
  std::map<int, std::string> strs;
};

struct SimState
{
  // terminal / compte
  bool tester = true, optimization = false, visual = false;
  bool connected = true, terminalTradeAllowed = true, mqlTradeAllowed = true;
  bool accountTradeAllowed = true, accountTradeExpert = true;
  long login = 12345678;
  int tradeMode = ACCOUNT_TRADE_MODE_DEMO;
  int marginMode = ACCOUNT_MARGIN_MODE_RETAIL_HEDGING;
  long leverage = 200;
  double balance = 1000.0;
  std::string currency = "USD";
  double usdToAccount = 1.0;
  // symbole
  std::string symbol = "XAUUSDm";
  int digits = 3;
  double point = 0.001, tickSize = 0.001, contractSize = 100.0;
  double volMin = 0.01, volMax = 200.0, volStep = 0.01, volLimit = 0.0;
  int stopsLevel = 0, freezeLevel = 0;
  int symTradeMode = SYMBOL_TRADE_MODE_FULL;
  int exeMode = SYMBOL_TRADE_EXECUTION_MARKET;
  int fillingFlags = SYMBOL_FILLING_FOK | SYMBOL_FILLING_IOC;
  double commissionPerLotSide = 0.0;
  double slippage = 0.0; // en prix, toujours défavorable
  // marché
  datetime now = 0;
  double bid = 0.0, ask = 0.0;
  std::vector<MqlRates> m1;
  std::map<int, std::vector<MqlRates>> agg; // tf -> barres agrégées
  // ordres / positions / historique
  std::vector<SimPosition> positions;
  int selectedPos = -1;
  std::vector<SimDeal> deals;
  std::vector<SimHistOrder> orders;
  std::vector<int> histSel;
  ulong nextTicket = 1000;
  ulong nextDeal = 500000;
  std::vector<uint> injectRetcodes; // prochains OrderSend forcés à ces codes
  bool rejectSLTP = false;
  int orderSendCount = 0;
  // divers
  std::map<std::string, double> gvars;
  std::map<std::string, SimObject> objects;
  std::map<std::string, std::string> files;
  struct Handle
  {
    std::string name;
    size_t readPos;
    bool open;
  };
  std::vector<Handle> handles;
  int messageBoxAnswer = IDYES;
  std::vector<std::string> messageBoxes;
  std::vector<std::string> alerts;
  std::vector<std::string> printed;
  bool echo = false;
  int lastError = 0;
  bool weekendClosed = true;
  bool pushOk = true;
  std::vector<std::string> slViolations; // stop élargi ou supprimé
  int sltpCount = 0;
};
inline SimState &Sim()
{
  static SimState s;
  return s;
}

inline int ShimTfSeconds(int tf)
{
  switch (tf)
  {
  case PERIOD_M1: return 60;
  case PERIOD_M5: return 300;
  case PERIOD_M15: return 900;
  case PERIOD_M30: return 1800;
  case PERIOD_H1: return 3600;
  case PERIOD_H4: return 14400;
  case PERIOD_D1: return 86400;
  default: return 60;
  }
}
inline int PeriodSeconds(ENUM_TIMEFRAMES period = PERIOD_CURRENT) { return ShimTfSeconds(period == PERIOD_CURRENT ? PERIOD_M1 : period); }

//--- agrégation des barres M1 (une seule fois par jeu de données)
inline void SimBuildAggregates()
{
  SimState &S = Sim();
  S.agg.clear();
  int tfs[] = {PERIOD_M1, PERIOD_M5, PERIOD_M15, PERIOD_H1, PERIOD_D1};
  for (int tf : tfs)
  {
    int sec = ShimTfSeconds(tf);
    std::vector<MqlRates> out;
    for (const MqlRates &r : S.m1)
    {
      datetime g = r.time - (r.time % sec);
      if (out.empty() || out.back().time != g)
      {
        MqlRates n = r;
        n.time = g;
        out.push_back(n);
      }
      else
      {
        MqlRates &b = out.back();
        b.high = std::max(b.high, r.high);
        b.low = std::min(b.low, r.low);
        b.close = r.close;
        b.tick_volume += r.tick_volume;
      }
    }
    S.agg[tf] = out;
  }
}
//--- index de la barre en formation (contenant now) ; les barres d'index inférieur sont clôturées
inline int SimFormingIndex(int tf)
{
  SimState &S = Sim();
  const std::vector<MqlRates> &v = S.agg[tf];
  int sec = ShimTfSeconds(tf);
  datetime cur = S.now - (S.now % sec);
  auto it = std::lower_bound(v.begin(), v.end(), cur, [](const MqlRates &r, datetime t) { return r.time < t; });
  return (int)(it - v.begin());
}

inline int CopyRates(const string &symbol, ENUM_TIMEFRAMES tf, int start_pos, int count, MqlArray<MqlRates> &rates)
{
  SimState &S = Sim();
  if (symbol.s != S.symbol)
  {
    S.lastError = 4301;
    return -1;
  }
  int t = tf == PERIOD_CURRENT ? PERIOD_M1 : (int)tf;
  const std::vector<MqlRates> &v = S.agg[t];
  int forming = SimFormingIndex(t);
  // index "série" start_pos : 0 = barre en formation
  int newest = forming - start_pos; // index chronologique de la plus récente barre copiée
  if (newest >= (int)v.size())
    newest = (int)v.size() - 1;
  if (newest < 0)
  {
    ArrayResize(rates, 0);
    S.lastError = 4401;
    return -1;
  }
  int oldest = std::max(0, newest - count + 1);
  int n = newest - oldest + 1;
  ArrayResize(rates, n);
  for (int i = 0; i < n; i++)
    rates[i] = v[(size_t)(oldest + i)];
  return n;
}
inline datetime iTime(const string &symbol, ENUM_TIMEFRAMES tf, int shift)
{
  SimState &S = Sim();
  if (symbol.s != S.symbol)
    return 0;
  int t = tf == PERIOD_CURRENT ? PERIOD_M1 : (int)tf;
  int sec = ShimTfSeconds(t);
  if (shift == 0)
    return S.now - (S.now % sec);
  const std::vector<MqlRates> &v = S.agg[t];
  int idx = SimFormingIndex(t) - shift;
  if (idx < 0 || idx >= (int)v.size())
    return 0;
  return v[(size_t)idx].time;
}
inline int Bars(const string &symbol, ENUM_TIMEFRAMES tf)
{
  if (symbol.s != Sim().symbol)
    return 0;
  return SimFormingIndex(tf == PERIOD_CURRENT ? PERIOD_M1 : (int)tf) + 1;
}
inline long SeriesInfoInteger(const string &, ENUM_TIMEFRAMES, ENUM_SERIES_INFO_INTEGER) { return 1; }

//--- temps
inline datetime TimeCurrent() { return Sim().now; }
inline datetime TimeTradeServer() { return Sim().now; }
inline datetime TimeGMT() { return Sim().now; }
inline datetime TimeLocal() { return Sim().now; }
inline uint GetTickCount() { return (uint)((ulong)Sim().now * 1000UL); }
inline ulong GetMicrosecondCount()
{
  static ulong us = 0;
  us += 1500; // chaque appel avance de 1,5 ms (latence simulée)
  return us;
}
inline void Sleep(int) {}

//--- journal
inline void ShimPrintOne(std::ostringstream &) {}
template <typename T, typename... R>
void ShimPrintOne(std::ostringstream &o, const T &x, const R &...rest)
{
  o << x;
  ShimPrintOne(o, rest...);
}
template <typename... Args>
void Print(const Args &...args)
{
  std::ostringstream o;
  ShimPrintOne(o, args...);
  Sim().printed.push_back(o.str());
  if (Sim().echo)
    std::cout << o.str() << "\n";
}
template <typename... Args>
void Alert(const Args &...args)
{
  std::ostringstream o;
  ShimPrintOne(o, args...);
  Sim().alerts.push_back(o.str());
}
inline int MessageBox(const string &text, const string &caption = string(""), int flags = 0)
{
  (void)caption;
  (void)flags;
  Sim().messageBoxes.push_back(text.s);
  return Sim().messageBoxAnswer;
}
inline bool SendNotification(const string &text)
{
  Sim().alerts.push_back("PUSH " + text.s);
  return Sim().pushOk;
}
inline bool SendMail(const string &subject, const string &text)
{
  Sim().alerts.push_back("MAIL " + subject.s + " " + text.s);
  return Sim().pushOk;
}
inline int GetLastError() { return Sim().lastError; }
inline void ResetLastError() { Sim().lastError = 0; }

//--- informations terminal / programme / compte
inline int MQLInfoInteger(ENUM_MQL_INFO_INTEGER p)
{
  SimState &S = Sim();
  switch (p)
  {
  case MQL_TESTER: return S.tester ? 1 : 0;
  case MQL_OPTIMIZATION: return S.optimization ? 1 : 0;
  case MQL_VISUAL_MODE: return S.visual ? 1 : 0;
  case MQL_TRADE_ALLOWED: return S.mqlTradeAllowed ? 1 : 0;
  }
  return 0;
}
inline int TerminalInfoInteger(ENUM_TERMINAL_INFO_INTEGER p)
{
  SimState &S = Sim();
  switch (p)
  {
  case TERMINAL_CONNECTED: return S.connected ? 1 : 0;
  case TERMINAL_TRADE_ALLOWED: return S.terminalTradeAllowed ? 1 : 0;
  case TERMINAL_PING_LAST: return 42000;
  }
  return 0;
}
inline double SimPositionProfit(const SimPosition &p)
{
  SimState &S = Sim();
  double px = p.type == 0 ? S.bid : S.ask;
  double diff = p.type == 0 ? px - p.priceOpen : p.priceOpen - px;
  return diff * p.volume * S.contractSize * S.usdToAccount;
}
inline double SimEquity()
{
  double e = Sim().balance;
  for (const SimPosition &p : Sim().positions)
    e += SimPositionProfit(p);
  return e;
}
inline double SimMarginUsed()
{
  SimState &S = Sim();
  double m = 0;
  for (const SimPosition &p : S.positions)
    m += p.volume * S.contractSize * p.priceOpen / (double)S.leverage * S.usdToAccount;
  return m;
}
inline long AccountInfoInteger(ENUM_ACCOUNT_INFO_INTEGER p)
{
  SimState &S = Sim();
  switch (p)
  {
  case ACCOUNT_LOGIN: return S.login;
  case ACCOUNT_TRADE_MODE: return S.tradeMode;
  case ACCOUNT_LEVERAGE: return S.leverage;
  case ACCOUNT_TRADE_ALLOWED: return S.accountTradeAllowed ? 1 : 0;
  case ACCOUNT_TRADE_EXPERT: return S.accountTradeExpert ? 1 : 0;
  case ACCOUNT_MARGIN_MODE: return S.marginMode;
  }
  return 0;
}
inline double AccountInfoDouble(ENUM_ACCOUNT_INFO_DOUBLE p)
{
  switch (p)
  {
  case ACCOUNT_BALANCE: return Sim().balance;
  case ACCOUNT_EQUITY: return SimEquity();
  case ACCOUNT_MARGIN: return SimMarginUsed();
  case ACCOUNT_MARGIN_FREE: return SimEquity() - SimMarginUsed();
  case ACCOUNT_PROFIT: return SimEquity() - Sim().balance;
  }
  return 0;
}
inline string AccountInfoString(ENUM_ACCOUNT_INFO_STRING p)
{
  switch (p)
  {
  case ACCOUNT_CURRENCY: return string(Sim().currency);
  case ACCOUNT_SERVER: return string("Sim-Server");
  case ACCOUNT_COMPANY: return string("Sim");
  case ACCOUNT_NAME: return string("Test");
  }
  return string("");
}

//--- symboles
inline bool SymbolSelect(const string &, bool) { return true; }
inline int SymbolsTotal(bool) { return 2; }
inline string SymbolName(int pos, bool) { return pos == 0 ? string(Sim().symbol) : string("EURUSD"); }
inline long SymbolInfoInteger(const string &name, ENUM_SYMBOL_INFO_INTEGER p)
{
  SimState &S = Sim();
  if (name.s != S.symbol)
    return p == SYMBOL_DIGITS ? 5 : 0;
  switch (p)
  {
  case SYMBOL_DIGITS: return S.digits;
  case SYMBOL_SPREAD: return (long)std::lround((S.ask - S.bid) / S.point);
  case SYMBOL_TRADE_STOPS_LEVEL: return S.stopsLevel;
  case SYMBOL_TRADE_FREEZE_LEVEL: return S.freezeLevel;
  case SYMBOL_TRADE_MODE: return S.symTradeMode;
  case SYMBOL_TRADE_EXEMODE: return S.exeMode;
  case SYMBOL_FILLING_MODE: return S.fillingFlags;
  case SYMBOL_SELECT: return 1;
  case SYMBOL_EXIST: return 1;
  }
  return 0;
}
inline double SymbolInfoDouble(const string &name, ENUM_SYMBOL_INFO_DOUBLE p)
{
  SimState &S = Sim();
  if (name.s != S.symbol)
    return 0.0;
  switch (p)
  {
  case SYMBOL_BID: return S.bid;
  case SYMBOL_ASK: return S.ask;
  case SYMBOL_POINT: return S.point;
  case SYMBOL_TRADE_TICK_SIZE: return S.tickSize;
  case SYMBOL_TRADE_TICK_VALUE:
  case SYMBOL_TRADE_TICK_VALUE_LOSS:
  case SYMBOL_TRADE_TICK_VALUE_PROFIT: return S.tickSize * S.contractSize * S.usdToAccount;
  case SYMBOL_TRADE_CONTRACT_SIZE: return S.contractSize;
  case SYMBOL_VOLUME_MIN: return S.volMin;
  case SYMBOL_VOLUME_MAX: return S.volMax;
  case SYMBOL_VOLUME_STEP: return S.volStep;
  case SYMBOL_VOLUME_LIMIT: return S.volLimit;
  }
  return 0.0;
}
inline string SymbolInfoString(const string &name, ENUM_SYMBOL_INFO_STRING p)
{
  if (name.s == Sim().symbol)
  {
    switch (p)
    {
    case SYMBOL_CURRENCY_BASE: return string("XAU");
    case SYMBOL_CURRENCY_PROFIT: return string("USD");
    case SYMBOL_CURRENCY_MARGIN: return string("XAU");
    case SYMBOL_DESCRIPTION: return string("Gold vs US Dollar");
    }
  }
  if (p == SYMBOL_CURRENCY_BASE)
    return string("EUR");
  return string("USD");
}
inline bool SymbolInfoTick(const string &name, MqlTick &t)
{
  SimState &S = Sim();
  if (name.s != S.symbol)
    return false;
  t = MqlTick{};
  t.time = S.now;
  t.bid = S.bid;
  t.ask = S.ask;
  t.time_msc = (long)S.now * 1000;
  return S.bid > 0.0;
}
inline bool SymbolInfoSessionTrade(const string &name, ENUM_DAY_OF_WEEK dow, uint idx, datetime &from, datetime &to)
{
  if (name.s != Sim().symbol || idx > 0)
    return false;
  if (Sim().weekendClosed && (dow == SATURDAY || dow == SUNDAY))
    return false;
  from = 0;
  to = 86400;
  return true;
}

//--- calculs de profit / marge
inline bool OrderCalcProfit(ENUM_ORDER_TYPE action, const string &symbol, double volume, double price_open, double price_close, double &profit)
{
  SimState &S = Sim();
  if (symbol.s != S.symbol || (action != ORDER_TYPE_BUY && action != ORDER_TYPE_SELL))
    return false;
  double diff = action == ORDER_TYPE_BUY ? price_close - price_open : price_open - price_close;
  profit = diff * volume * S.contractSize * S.usdToAccount;
  return true;
}
inline bool OrderCalcMargin(ENUM_ORDER_TYPE action, const string &symbol, double volume, double price, double &margin)
{
  SimState &S = Sim();
  if (symbol.s != S.symbol || (action != ORDER_TYPE_BUY && action != ORDER_TYPE_SELL))
    return false;
  margin = volume * S.contractSize * price / (double)S.leverage * S.usdToAccount;
  return true;
}

//--- positions
inline int PositionsTotal() { return (int)Sim().positions.size(); }
inline ulong PositionGetTicket(int index)
{
  SimState &S = Sim();
  if (index < 0 || index >= (int)S.positions.size())
    return 0;
  S.selectedPos = index;
  return S.positions[(size_t)index].ticket;
}
inline bool PositionSelectByTicket(ulong ticket)
{
  SimState &S = Sim();
  for (size_t i = 0; i < S.positions.size(); i++)
    if (S.positions[i].ticket == ticket)
    {
      S.selectedPos = (int)i;
      return true;
    }
  S.selectedPos = -1;
  return false;
}
inline const SimPosition *SimSelected()
{
  SimState &S = Sim();
  if (S.selectedPos < 0 || S.selectedPos >= (int)S.positions.size())
    return nullptr;
  return &S.positions[(size_t)S.selectedPos];
}
inline long PositionGetInteger(ENUM_POSITION_PROPERTY_INTEGER p)
{
  const SimPosition *x = SimSelected();
  if (!x)
    return 0;
  switch (p)
  {
  case POSITION_TICKET: return (long)x->ticket;
  case POSITION_TIME: return (long)x->time;
  case POSITION_TIME_MSC: return (long)x->time * 1000;
  case POSITION_TYPE: return x->type;
  case POSITION_MAGIC: return (long)x->magic;
  case POSITION_IDENTIFIER: return x->identifier;
  case POSITION_REASON: return 3;
  }
  return 0;
}
inline double PositionGetDouble(ENUM_POSITION_PROPERTY_DOUBLE p)
{
  const SimPosition *x = SimSelected();
  if (!x)
    return 0.0;
  switch (p)
  {
  case POSITION_VOLUME: return x->volume;
  case POSITION_PRICE_OPEN: return x->priceOpen;
  case POSITION_SL: return x->sl;
  case POSITION_TP: return x->tp;
  case POSITION_PRICE_CURRENT: return x->type == 0 ? Sim().bid : Sim().ask;
  case POSITION_SWAP: return 0.0;
  case POSITION_PROFIT: return SimPositionProfit(*x);
  }
  return 0.0;
}
inline string PositionGetString(ENUM_POSITION_PROPERTY_STRING p)
{
  const SimPosition *x = SimSelected();
  if (!x)
    return string("");
  return p == POSITION_SYMBOL ? string(x->symbol) : string(x->comment);
}
inline int OrdersTotal() { return 0; }
inline ulong OrderGetTicket(int) { return 0; }
inline long OrderGetInteger(ENUM_ORDER_PROPERTY_INTEGER) { return 0; }
inline string OrderGetString(ENUM_ORDER_PROPERTY_STRING) { return string(""); }

//--- historique
inline bool HistorySelect(datetime from, datetime to)
{
  SimState &S = Sim();
  S.histSel.clear();
  for (size_t i = 0; i < S.deals.size(); i++)
    if (S.deals[i].time >= from && S.deals[i].time <= to)
      S.histSel.push_back((int)i);
  return true;
}
inline bool HistorySelectByPosition(long position_id)
{
  SimState &S = Sim();
  S.histSel.clear();
  for (size_t i = 0; i < S.deals.size(); i++)
    if (S.deals[i].positionId == position_id)
      S.histSel.push_back((int)i);
  return true;
}
inline int HistoryDealsTotal() { return (int)Sim().histSel.size(); }
inline ulong HistoryDealGetTicket(int index)
{
  SimState &S = Sim();
  if (index < 0 || index >= (int)S.histSel.size())
    return 0;
  return S.deals[(size_t)S.histSel[(size_t)index]].ticket;
}
inline const SimDeal *SimFindDeal(ulong ticket)
{
  for (const SimDeal &d : Sim().deals)
    if (d.ticket == ticket)
      return &d;
  return nullptr;
}
inline bool HistoryDealSelect(ulong ticket) { return SimFindDeal(ticket) != nullptr; }
inline long HistoryDealGetInteger(ulong ticket, ENUM_DEAL_PROPERTY_INTEGER p)
{
  const SimDeal *d = SimFindDeal(ticket);
  if (!d)
    return 0;
  switch (p)
  {
  case DEAL_TICKET: return (long)d->ticket;
  case DEAL_ORDER: return (long)d->order;
  case DEAL_TIME: return (long)d->time;
  case DEAL_TIME_MSC: return (long)d->time * 1000;
  case DEAL_TYPE: return d->type;
  case DEAL_ENTRY: return d->entry;
  case DEAL_MAGIC: return (long)d->magic;
  case DEAL_REASON: return d->reason;
  case DEAL_POSITION_ID: return d->positionId;
  }
  return 0;
}
inline double HistoryDealGetDouble(ulong ticket, ENUM_DEAL_PROPERTY_DOUBLE p)
{
  const SimDeal *d = SimFindDeal(ticket);
  if (!d)
    return 0.0;
  switch (p)
  {
  case DEAL_VOLUME: return d->volume;
  case DEAL_PRICE: return d->price;
  case DEAL_COMMISSION: return d->commission;
  case DEAL_SWAP: return d->swap;
  case DEAL_PROFIT: return d->profit;
  case DEAL_FEE: return d->fee;
  }
  return 0.0;
}
inline string HistoryDealGetString(ulong ticket, ENUM_DEAL_PROPERTY_STRING p)
{
  const SimDeal *d = SimFindDeal(ticket);
  if (!d)
    return string("");
  return p == DEAL_SYMBOL ? string(d->symbol) : string(d->comment);
}
inline bool HistoryOrderSelect(ulong ticket)
{
  for (const SimHistOrder &o : Sim().orders)
    if (o.ticket == ticket)
      return true;
  return false;
}
inline double HistoryOrderGetDouble(ulong ticket, ENUM_ORDER_PROPERTY_DOUBLE p)
{
  for (const SimHistOrder &o : Sim().orders)
    if (o.ticket == ticket)
      return p == ORDER_SL ? o.sl : (p == ORDER_TP ? o.tp : o.price);
  return 0.0;
}

//--- exécution simulée
inline bool SimVolumeValid(double v)
{
  SimState &S = Sim();
  if (v < S.volMin - 1e-9 || v > S.volMax + 1e-9)
    return false;
  double steps = v / S.volStep;
  return std::fabs(steps - std::round(steps)) < 1e-6;
}
inline bool SimFillingValid(ENUM_ORDER_TYPE_FILLING f)
{
  SimState &S = Sim();
  if (f == ORDER_FILLING_FOK)
    return (S.fillingFlags & SYMBOL_FILLING_FOK) != 0;
  if (f == ORDER_FILLING_IOC)
    return (S.fillingFlags & SYMBOL_FILLING_IOC) != 0;
  return S.exeMode != SYMBOL_TRADE_EXECUTION_MARKET;
}
inline uint SimStopsValid(int type, double sl, double tp)
{
  SimState &S = Sim();
  double minD = S.stopsLevel * S.point;
  double ref = type == 0 ? S.bid : S.ask;
  if (type == 0)
  {
    if (sl > 0 && sl > ref - minD - 1e-9)
      return TRADE_RETCODE_INVALID_STOPS;
    if (tp > 0 && tp < ref + minD + 1e-9)
      return TRADE_RETCODE_INVALID_STOPS;
  }
  else
  {
    if (sl > 0 && sl < ref + minD + 1e-9)
      return TRADE_RETCODE_INVALID_STOPS;
    if (tp > 0 && tp > ref - minD - 1e-9)
      return TRADE_RETCODE_INVALID_STOPS;
  }
  return 0;
}
inline uint SimValidate(const MqlTradeRequest &r)
{
  SimState &S = Sim();
  if (!S.connected)
    return TRADE_RETCODE_CONNECTION;
  if (!S.terminalTradeAllowed || !S.mqlTradeAllowed)
    return TRADE_RETCODE_CLIENT_DISABLES_AT;
  if (r.symbol.s != S.symbol)
    return TRADE_RETCODE_INVALID;
  if (r.action == TRADE_ACTION_DEAL)
  {
    if (r.type != ORDER_TYPE_BUY && r.type != ORDER_TYPE_SELL)
      return TRADE_RETCODE_INVALID;
    if (!SimVolumeValid(r.volume))
      return TRADE_RETCODE_INVALID_VOLUME;
    if (!SimFillingValid(r.type_filling))
      return TRADE_RETCODE_INVALID_FILL;
    double mkt = r.type == ORDER_TYPE_BUY ? S.ask : S.bid;
    if (std::fabs(r.price - mkt) > (double)r.deviation * S.point + 1e-9)
      return TRADE_RETCODE_REQUOTE;
    if (r.position == 0)
    {
      uint st = SimStopsValid(r.type == ORDER_TYPE_BUY ? 0 : 1, r.sl, r.tp);
      if (st)
        return st;
      double m = r.volume * S.contractSize * mkt / (double)S.leverage * S.usdToAccount;
      if (m > SimEquity() - SimMarginUsed())
        return TRADE_RETCODE_NO_MONEY;
    }
  }
  return 0;
}
inline bool OrderCheck(MqlTradeRequest &request, MqlTradeCheckResult &result)
{
  result = MqlTradeCheckResult{};
  uint rc = SimValidate(request);
  result.retcode = rc;
  result.balance = Sim().balance;
  result.equity = SimEquity();
  result.margin_free = SimEquity() - SimMarginUsed();
  return rc == 0;
}
inline void SimAddDeal(SimPosition &p, int type, int entry, double vol, double price, double profit, int reason, const std::string &comment, ulong magic)
{
  SimState &S = Sim();
  SimDeal d{};
  d.ticket = S.nextDeal++;
  d.order = d.ticket;
  d.positionId = p.identifier;
  d.symbol = p.symbol;
  d.type = type;
  d.entry = entry;
  d.volume = vol;
  d.price = price;
  d.profit = profit;
  d.commission = -S.commissionPerLotSide * vol;
  d.time = S.now;
  d.magic = magic;
  d.comment = comment;
  d.reason = reason;
  S.balance += profit + d.commission;
  S.deals.push_back(d);
}
inline void SimClosePosition(size_t idx, double vol, double price, int reason, const std::string &comment, ulong magic)
{
  SimState &S = Sim();
  SimPosition &p = S.positions[idx];
  double diff = p.type == 0 ? price - p.priceOpen : p.priceOpen - price;
  double profit = diff * vol * S.contractSize * S.usdToAccount;
  SimAddDeal(p, p.type == 0 ? DEAL_TYPE_SELL : DEAL_TYPE_BUY, DEAL_ENTRY_OUT, vol, price, profit, reason, comment, magic);
  p.volume = std::round((p.volume - vol) / S.volStep) * S.volStep;
  if (p.volume < S.volStep * 0.5)
    S.positions.erase(S.positions.begin() + (long)idx);
}
inline bool OrderSend(MqlTradeRequest &r, MqlTradeResult &res)
{
  SimState &S = Sim();
  res = MqlTradeResult{};
  S.orderSendCount++;
  if (!S.injectRetcodes.empty())
  {
    res.retcode = S.injectRetcodes.front();
    S.injectRetcodes.erase(S.injectRetcodes.begin());
    return false;
  }
  if (r.action == TRADE_ACTION_SLTP)
  {
    for (size_t i = 0; i < S.positions.size(); i++)
    {
      SimPosition &p = S.positions[i];
      if (p.ticket != r.position)
        continue;
      if (S.rejectSLTP)
      {
        res.retcode = TRADE_RETCODE_INVALID_STOPS;
        return false;
      }
      if (std::fabs(p.sl - r.sl) < 1e-9 && std::fabs(p.tp - r.tp) < 1e-9)
      {
        res.retcode = TRADE_RETCODE_NO_CHANGES;
        return false;
      }
      uint st = SimStopsValid(p.type, r.sl, r.tp);
      if (st)
      {
        res.retcode = st;
        return false;
      }
      if (p.sl > 0)
      {
        bool worse = (p.type == 0) ? (r.sl < p.sl - 1e-9) : (r.sl > p.sl + 1e-9);
        if (r.sl <= 0 || worse)
          S.slViolations.push_back("#" + std::to_string(p.ticket) + " stop " + std::to_string(p.sl) + " -> " + std::to_string(r.sl));
      }
      S.sltpCount++;
      p.sl = r.sl;
      p.tp = r.tp;
      res.retcode = TRADE_RETCODE_DONE;
      return true;
    }
    res.retcode = TRADE_RETCODE_POSITION_CLOSED;
    return false;
  }
  if (r.action != TRADE_ACTION_DEAL)
  {
    res.retcode = TRADE_RETCODE_INVALID;
    return false;
  }
  uint rc = SimValidate(r);
  if (rc)
  {
    res.retcode = rc;
    return false;
  }
  double mkt = r.type == ORDER_TYPE_BUY ? S.ask : S.bid;
  double fill = r.type == ORDER_TYPE_BUY ? mkt + S.slippage : mkt - S.slippage;
  if (r.position != 0)
  {
    for (size_t i = 0; i < S.positions.size(); i++)
    {
      if (S.positions[i].ticket != r.position)
        continue;
      if ((S.positions[i].type == 0) != (r.type == ORDER_TYPE_SELL))
      {
        res.retcode = TRADE_RETCODE_INVALID;
        return false;
      }
      if (r.volume > S.positions[i].volume + 1e-9)
      {
        res.retcode = TRADE_RETCODE_INVALID_CLOSE_VOLUME;
        return false;
      }
      ulong dealT = S.nextDeal;
      SimClosePosition(i, r.volume, fill, DEAL_REASON_EXPERT, r.comment.s, r.magic);
      res.retcode = TRADE_RETCODE_DONE;
      res.deal = dealT;
      res.order = dealT;
      res.price = fill;
      res.volume = r.volume;
      return true;
    }
    res.retcode = TRADE_RETCODE_POSITION_CLOSED;
    return false;
  }
  SimPosition p{};
  p.ticket = S.nextTicket++;
  p.identifier = (long)p.ticket;
  p.symbol = S.symbol;
  p.type = r.type == ORDER_TYPE_BUY ? 0 : 1;
  p.volume = r.volume;
  p.priceOpen = fill;
  p.sl = r.sl;
  p.tp = r.tp;
  p.time = S.now;
  p.magic = r.magic;
  p.comment = r.comment.s;
  S.positions.push_back(p);
  ulong dealT = S.nextDeal;
  SimAddDeal(S.positions.back(), p.type == 0 ? DEAL_TYPE_BUY : DEAL_TYPE_SELL, DEAL_ENTRY_IN, r.volume, fill, 0.0, DEAL_REASON_EXPERT, r.comment.s, r.magic);
  S.orders.push_back(SimHistOrder{p.ticket, r.sl, r.tp, fill});
  res.retcode = TRADE_RETCODE_DONE;
  res.order = p.ticket;
  res.deal = dealT;
  res.price = fill;
  res.volume = r.volume;
  return true;
}

//--- déclenchement des stops et objectifs côté "serveur" au prix courant
//--- (exécution au niveau demandé, sauf écart d'ouverture : au prix courant)
inline void SimProcessStops(bool gapTick)
{
  SimState &S = Sim();
  for (size_t i = 0; i < S.positions.size();)
  {
    SimPosition &p = S.positions[i];
    double px = p.type == 0 ? S.bid : S.ask;
    bool slHit = p.sl > 0 && (p.type == 0 ? px <= p.sl : px >= p.sl);
    bool tpHit = p.tp > 0 && (p.type == 0 ? px >= p.tp : px <= p.tp);
    if (slHit || tpHit)
    {
      double fill = gapTick ? px : (slHit ? p.sl : p.tp);
      std::string c = slHit ? "[sl " + std::to_string(p.sl) + "]" : "[tp " + std::to_string(p.tp) + "]";
      SimClosePosition(i, p.volume, fill, slHit ? DEAL_REASON_SL : DEAL_REASON_TP, c, p.magic);
      continue;
    }
    i++;
  }
}

//--- variables globales du terminal
inline bool GlobalVariableCheck(const string &name) { return Sim().gvars.count(name.s) > 0; }
inline double GlobalVariableGet(const string &name)
{
  auto it = Sim().gvars.find(name.s);
  return it == Sim().gvars.end() ? 0.0 : it->second;
}
inline datetime GlobalVariableSet(const string &name, double value)
{
  if (name.s.size() > 63)
    throw std::logic_error("nom de variable globale > 63 caractères : " + name.s);
  Sim().gvars[name.s] = value;
  return Sim().now;
}
inline bool GlobalVariableDel(const string &name) { return Sim().gvars.erase(name.s) > 0; }
inline int GlobalVariablesDeleteAll(const string &prefix_name = string(""), datetime limit_data = 0)
{
  (void)limit_data;
  int n = 0;
  auto &g = Sim().gvars;
  for (auto it = g.begin(); it != g.end();)
  {
    if (it->first.compare(0, prefix_name.s.size(), prefix_name.s) == 0)
    {
      it = g.erase(it);
      n++;
    }
    else
      ++it;
  }
  return n;
}
inline int GlobalVariablesTotal() { return (int)Sim().gvars.size(); }
inline string GlobalVariableName(int index)
{
  auto it = Sim().gvars.begin();
  std::advance(it, index);
  return string(it->first);
}
inline void GlobalVariablesFlush() {}

//--- fichiers (en mémoire)
inline int FileOpen(const string &name, int flags, short delimiter = '\t', uint codepage = CP_ACP)
{
  (void)delimiter;
  (void)codepage;
  SimState &S = Sim();
  bool exists = S.files.count(name.s) > 0;
  if ((flags & FILE_READ) && !(flags & FILE_WRITE) && !exists)
  {
    S.lastError = 5004;
    return INVALID_HANDLE;
  }
  if ((flags & FILE_WRITE) && !(flags & FILE_READ))
    S.files[name.s] = "";
  else if (!exists)
    S.files[name.s] = "";
  S.handles.push_back(SimState::Handle{name.s, 0, true});
  return (int)S.handles.size() - 1;
}
inline void FileClose(int h)
{
  if (h >= 0 && h < (int)Sim().handles.size())
    Sim().handles[(size_t)h].open = false;
}
inline ulong FileSize(int h) { return (ulong)Sim().files[Sim().handles.at((size_t)h).name].size(); }
inline bool FileSeek(int, long, ENUM_FILE_POSITION) { return true; }
inline uint FileWriteString(int h, const string &text, int length = -1)
{
  (void)length;
  Sim().files[Sim().handles.at((size_t)h).name] += text.s;
  return (uint)text.s.size();
}
inline bool FileIsEnding(int h)
{
  SimState::Handle &hd = Sim().handles.at((size_t)h);
  return hd.readPos >= Sim().files[hd.name].size();
}
inline string FileReadString(int h, int length = -1)
{
  (void)length;
  SimState::Handle &hd = Sim().handles.at((size_t)h);
  const std::string &c = Sim().files[hd.name];
  size_t e = c.find('\n', hd.readPos);
  std::string line = c.substr(hd.readPos, e == std::string::npos ? std::string::npos : e - hd.readPos);
  hd.readPos = e == std::string::npos ? c.size() : e + 1;
  if (!line.empty() && line.back() == '\r')
    line.pop_back();
  return string(line);
}
inline bool FolderCreate(const string &, int common_flag = 0)
{
  (void)common_flag;
  return true;
}

//--- calendrier (indisponible dans le simulateur, comme dans le testeur MT5)
inline int CalendarValueHistory(MqlArray<MqlCalendarValue> &values, datetime from, datetime to = 0,
                                const string &country_code = string(""), const string &currency = string(""))
{
  (void)from;
  (void)to;
  (void)country_code;
  (void)currency;
  ArrayResize(values, 0);
  Sim().lastError = 5400;
  return 0;
}
inline bool CalendarEventById(ulong, MqlCalendarEvent &) { return false; }

//--- objets graphiques
inline bool ObjectCreate(long chart_id, const string &name, ENUM_OBJECT type, int sub_window, datetime time1, double price1)
{
  (void)chart_id;
  (void)type;
  (void)sub_window;
  (void)time1;
  (void)price1;
  if (name.s.size() > 63)
    throw std::logic_error("nom d'objet > 63 caractères");
  Sim().objects[name.s] = SimObject{};
  return true;
}
inline int ObjectFind(long, const string &name) { return Sim().objects.count(name.s) ? 0 : -1; }
inline bool ObjectSetInteger(long, const string &name, ENUM_OBJECT_PROPERTY_INTEGER prop, long value)
{
  auto it = Sim().objects.find(name.s);
  if (it == Sim().objects.end())
    return false;
  it->second.ints[prop] = value;
  return true;
}
inline bool ObjectSetString(long, const string &name, ENUM_OBJECT_PROPERTY_STRING prop, const string &value)
{
  auto it = Sim().objects.find(name.s);
  if (it == Sim().objects.end())
    return false;
  if (prop == OBJPROP_TEXT && value.s.size() > 63 * 2)
    throw std::logic_error("texte d'objet trop long");
  it->second.strs[prop] = value.s;
  return true;
}
inline bool ObjectDelete(long, const string &name) { return Sim().objects.erase(name.s) > 0; }
inline int ObjectsDeleteAll(long, const string &prefix, int sub_window = -1, int object_type = -1)
{
  (void)sub_window;
  (void)object_type;
  int n = 0;
  for (auto it = Sim().objects.begin(); it != Sim().objects.end();)
  {
    if (it->first.compare(0, prefix.s.size(), prefix.s) == 0)
    {
      it = Sim().objects.erase(it);
      n++;
    }
    else
      ++it;
  }
  return n;
}
inline void ChartRedraw(long chart_id = 0) { (void)chart_id; }
inline bool EventSetTimer(int) { return true; }
inline void EventKillTimer() {}

//--- symbole du graphique
#define _Symbol (string(Sim().symbol))
