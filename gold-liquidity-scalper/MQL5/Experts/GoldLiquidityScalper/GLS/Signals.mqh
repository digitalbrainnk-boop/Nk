//+------------------------------------------------------------------+
//| Signals.mqh - détection des configurations et score de qualité   |
//|                                                                  |
//| Toute la logique est écrite pour un ACHAT, sur des barres M1     |
//| clôturées. Pour une VENTE, elle s'applique à la série "miroir"   |
//| (prix négatifs, hauts/bas inversés) : une seule implémentation,  |
//| donc aucune asymétrie involontaire entre achats et ventes.       |
//| Les prix sont reconvertis (x dir) dans FinalizeSignal().         |
//|                                                                  |
//| Le score (0-100) est une note de qualité, PAS une probabilité.   |
//| Les refus obligatoires ne sont jamais compensés par le score.    |
//+------------------------------------------------------------------+
#ifndef GLS_SIGNALS_MQH
#define GLS_SIGNALS_MQH

#include "Context.mqh"
#include "SymbolSpec.mqh"

struct SSignal
  {
   bool              valid;        // configuration complète, déclenchée sur la dernière barre clôturée
   int               stage;        // 0 rien, 1 configuration en formation, 2 déclenchée
   int               family;
   int               dir;
   string            id;
   string            hash;
   datetime          triggerTime;  // ouverture de la barre de déclenchement
   datetime          anchorTime;   // barre d'ancrage (extrême du balayage, cassure...)
   double            level;        // niveau clé
   double            extreme;      // extrême de la configuration
   double            stop;         // stop logique proposé
   double            invalidation; // niveau d'invalidation (sortie anticipée)
   double            refEntry;     // clôture de la barre de déclenchement
   int               levelKind;
   bool              retestEntry;
   double            cLiq;         // qualité de la liquidité / de la configuration
   double            cTrig;        // réintégration / force du déclencheur
   double            cStruct;      // confirmation structurelle
   double            cAlign;       // alignement M5/M15
   double            cRetest;      // qualité du retest
   double            cVol;         // conditions de volatilité
   double            cCost;        // coût d'exécution
   double            cRR;          // espace jusqu'à la liquidité / zone opposée
   double            cCandle;      // preuve apportée par les bougies (comptée une seule fois)
   double            score;
   double            roomR;
   double            riskDist;     // distance entrée -> stop au prix d'exécution estimé
   double            entryPrice;   // prix d'exécution estimé (ask achat / bid vente)
   double            costFrac;
   string            detail;
   int               refusal;
   int               regime;
   int               trend15;
   int               trend5;
   int               candleId;     // figure retenue comme preuve (0 = aucune)
   string            candleName;
   string            criteria;     // critères satisfaits (+) et échoués (-), séparés par '|'
   //--- zone à l'origine du signal (F6 : FVG ; vide sinon)
   string            zoneId;
   int               zoneTf;
   datetime          zoneTime;     // création de la zone
   int               zoneRetests;  // retours dans la zone, contact actuel compris
   double            zoneQuality;
   double            zoneFill;
   datetime          dispEventTime; // cassure produite par le déplacement de la zone (0 = aucune)
  };

//--- Zone dans l'espace de la vue (support pour un achat, résistance retournée pour une vente)
struct SViewZone
  {
   double            lo;
   double            hi;
   double            quality;
   int               kind;        // GLS_LVL_ZONE / GLS_LVL_FVG
   datetime          known;       // instant où la zone est connue
   int               retests;
   bool              inverted;    // IFVG
   string            label;
   string            id;          // identifiant (FVG : FvgKey)
   int               tfMin;
   datetime          created;
   double            fill;
   bool              obConf;      // Order Block en confluence
   bool              obSame;      // ... issu du même déplacement
   datetime          confKnown;   // instant où la confluence est connue
   datetime          bosTime;     // cassure du déplacement (0 = aucune)
  };

//+------------------------------------------------------------------+
//| Vue directionnelle (niveaux de liquidité dans l'espace du sens)   |
//+------------------------------------------------------------------+
class CDirView
  {
public:
   int               dir;
   SLevel            sweepable[];
   SLevel            opposing[];
   SViewZone         supports[];    // zones favorables (support pour un achat, résistance pour une vente)
   SViewZone         fvgZones[];    // FVG du sens du trade (unité InpFvgTF)
   SViewZone         obstacles[];   // zones opposées : résistances / supports (force >= InpSRMinStrength), FVG contraires (unité InpFvgTF)

                     CDirView(void) : dir(GLS_BUY) {}

   void              AddZone(SViewZone &arr[], const double lo, const double hi, const double quality, const int kind,
                             const datetime known, const int retests, const bool inverted, const string label)
     {
      int n = ArraySize(arr);
      ArrayResize(arr, n + 1);
      arr[n].lo = (dir == GLS_BUY) ? lo : -hi;
      arr[n].hi = (dir == GLS_BUY) ? hi : -lo;
      arr[n].quality = quality;
      arr[n].kind = kind;
      arr[n].known = known;
      arr[n].retests = retests;
      arr[n].inverted = inverted;
      arr[n].label = label;
      arr[n].id = "";
      arr[n].tfMin = 0;
      arr[n].created = known;
      arr[n].fill = 0.0;
      arr[n].obConf = false;
      arr[n].obSame = false;
      arr[n].confKnown = known;
      arr[n].bosTime = 0;
     }

   void              AddFvgZone(SViewZone &arr[], const SFvg &f)
     {
      AddZone(arr, f.lo, f.hi, f.quality, GLS_LVL_FVG, f.created, f.retests, f.inverted, f.reason);
      int n = ArraySize(arr) - 1;
      arr[n].id = FvgKey(f);
      arr[n].tfMin = f.tfMin;
      arr[n].fill = f.fillPct;
      arr[n].obConf = f.obConf;
      arr[n].obSame = f.obSameDisp;
      arr[n].confKnown = f.obConf ? f.obKnown : f.created;
      arr[n].bosTime = f.bosTime;
     }

   void              AddFvgs(const CFvgMap &m)
     {
      for(int i = 0; i < ArraySize(m.fvgs); i++)
        {
         if(m.fvgs[i].status != GLS_FVG_FRESH && m.fvgs[i].status != GLS_FVG_PARTIAL)
            continue;
         if(m.fvgs[i].duplicate || m.tfMin != (int)InpFvgTF)
            continue;   // une imbalance n'est utilisée qu'une fois, sur l'unité de trading
         if(m.fvgs[i].dir == dir)
           {
            if(!m.fvgs[i].inverted || InpUseIFVG)
               AddFvgZone(fvgZones, m.fvgs[i]);
           }
         else
            if(InpUseFvgObstacles && m.fvgs[i].quality >= InpFvgMinQuality && (!m.fvgs[i].inverted || InpUseIFVG))
               AddFvgZone(obstacles, m.fvgs[i]);
        }
     }

   void              Build(const CMarketContext &ctx, const int d)
     {
      dir = d;
      ctx.liq.DirectionalView(d, sweepable, opposing);
      ArrayResize(supports, 0);
      ArrayResize(fvgZones, 0);
      ArrayResize(obstacles, 0);
      int favRole = (d == GLS_BUY) ? GLS_ZONE_SUPPORT : GLS_ZONE_RESIST;
      int oppRole = (d == GLS_BUY) ? GLS_ZONE_RESIST : GLS_ZONE_SUPPORT;
      for(int i = 0; i < ArraySize(ctx.zones.zones); i++)
        {
         if(!ctx.zones.zones[i].valid)
            continue;
         if(ctx.zones.zones[i].role == favRole)
            AddZone(supports, ctx.zones.zones[i].lo, ctx.zones.zones[i].hi, ctx.zones.zones[i].strength, GLS_LVL_ZONE,
                    ctx.zones.zones[i].confirmTime, ctx.zones.zones[i].touches, false, ctx.zones.zones[i].reason);
         else
            if(ctx.zones.zones[i].role == oppRole && InpUseSRObstacles && ctx.zones.zones[i].strength >= InpSRMinStrength)
               AddZone(obstacles, ctx.zones.zones[i].lo, ctx.zones.zones[i].hi, ctx.zones.zones[i].strength, GLS_LVL_ZONE,
                       ctx.zones.zones[i].confirmTime, ctx.zones.zones[i].touches, false, ctx.zones.zones[i].reason);
        }
      AddFvgs(ctx.fvg5);
      AddFvgs(ctx.fvg1);
     }
  };

void SignalReset(SSignal &s)
  {
   s.valid = false;
   s.stage = 0;
   s.family = 0;
   s.dir = 0;
   s.id = "";
   s.hash = "";
   s.triggerTime = 0;
   s.anchorTime = 0;
   s.level = 0.0;
   s.extreme = 0.0;
   s.stop = 0.0;
   s.invalidation = 0.0;
   s.refEntry = 0.0;
   s.levelKind = 0;
   s.retestEntry = false;
   s.cLiq = 0.0;
   s.cTrig = 0.0;
   s.cStruct = 0.0;
   s.cAlign = 0.0;
   s.cRetest = 0.0;
   s.cVol = 0.0;
   s.cCost = 0.0;
   s.cRR = 0.0;
   s.cCandle = 0.0;
   s.score = 0.0;
   s.roomR = 0.0;
   s.riskDist = 0.0;
   s.entryPrice = 0.0;
   s.costFrac = 0.0;
   s.detail = "";
   s.refusal = GLS_REFUSE_NO_SETUP;
   s.regime = GLS_RG_UNKNOWN;
   s.trend15 = GLS_TCLASS_UNKNOWN;
   s.trend5 = GLS_TCLASS_UNKNOWN;
   s.candleId = GLS_CDL_NONE;
   s.candleName = "";
   s.criteria = "";
   s.zoneId = "";
   s.zoneTf = 0;
   s.zoneTime = 0;
   s.zoneRetests = 0;
   s.zoneQuality = 0.0;
   s.zoneFill = 0.0;
   s.dispEventTime = 0;
  }

//--- Décisions par zone (F6) de la barre courante : candidats en attente ou refusés, pour le journal
//--- (le meilleur candidat seul ne suffit pas à tracer chaque zone)
class CZoneDecisions
  {
public:
   SSignal           items[];

   void              Clear(void) { ArrayResize(items, 0); }

   void              Add(const SSignal &s)
     {
      if(StringLen(s.zoneId) == 0)
         return;
      int n = ArraySize(items);
      ArrayResize(items, n + 1);
      items[n] = s;
     }
  };

CZoneDecisions g_zoneDecisions;

//--- Identité de la zone d'origine d'un candidat (journal des zones, résultat des trades)
void SetZoneInfo(SSignal &s, const SViewZone &z)
  {
   s.zoneId = z.id;
   s.zoneTf = z.tfMin;
   s.zoneTime = z.created;
   s.zoneRetests = z.retests;
   s.zoneQuality = z.quality;
   s.zoneFill = z.fill;
   s.dispEventTime = z.bosTime;
  }

//--- Note partielle (composantes propres à la famille) pour départager des candidats
double FamilyPartialScore(const SSignal &s)
  {
   return InpWLiquidity * s.cLiq + InpWTrigger * s.cTrig + InpWStructure * s.cStruct + InpWRetest * s.cRetest;
  }

//--- Garde le meilleur candidat ; mémorise l'étape la plus avancée pour l'affichage
void KeepBest(SSignal &best, const SSignal &cand)
  {
   if(cand.valid)
     {
      if(!best.valid || FamilyPartialScore(cand) > FamilyPartialScore(best))
         best = cand;
      return;
     }
   if(!best.valid && cand.stage > best.stage)
     {
      best.stage = cand.stage;
      best.refusal = cand.refusal;
      best.detail = cand.detail;
     }
  }

//+------------------------------------------------------------------+
//| Outils de structure M1                                            |
//+------------------------------------------------------------------+
//--- Plus bas des creux fractals de [from,to] dont la confirmation (i+k) est <= limit
int LowestFractalLow(const CBarSeries &b, const int from, const int to, const int k, const int limit)
  {
   int best = -1;
   for(int i = MathMax(from, k); i <= to; i++)
     {
      if(i + k > limit)
         break;
      if(!IsSwingLow(b, i, k))
         continue;
      if(best < 0 || b.low[i] < b.low[best])
         best = i;
     }
   return best;
  }

//--- Dernier sommet fractal de [from,to] confirmé au plus tard à limit
int LastFractalHigh(const CBarSeries &b, const int from, const int to, const int k, const int limit)
  {
   for(int i = MathMin(to, limit - k); i >= MathMax(from, k); i--)
      if(IsSwingHigh(b, i, k))
         return i;
   return -1;
  }

//--- Barre de retest valide : touche la zone, clôture au-dessus du niveau tenu,
//--- bougie haussière avec clôture dans la moitié haute
bool IsRetestBar(const CBarSeries &b, const int i, const double zoneTop, const double holdLevel)
  {
   return (b.low[i] <= zoneTop && b.close[i] > holdLevel && b.close[i] > b.open[i] && b.CloseLocation(i) >= 0.5);
  }

string ViewPrice(const double viewPrice)
  {
   return DoubleToString(MathAbs(viewPrice), g_sym.digits);
  }

//+------------------------------------------------------------------+
//| F1 - Balayage de liquidité + réintégration + CHOCH M1            |
//|                                                                  |
//| 1. Niveau : plus bas creux fractal (force k) des N barres        |
//|    précédant le balayage, confirmé avant celui-ci, jamais        |
//|    franchi depuis ; ou niveau externe (swing M5/M15, veille,     |
//|    Asie) intact et non franchi sur les 60 dernières barres.      |
//| 2. Balayage : une barre s0 traite sous le niveau ; extrême e =   |
//|    plus bas depuis s0 ; profondeur dans [min, max] x ATR.        |
//| 3. Réintégration : 1re clôture > niveau + tampon, au plus R      |
//|    barres après e ; au plus A clôtures sous le niveau pendant    |
//|    l'épisode ; plus aucune clôture sous le niveau ensuite.       |
//|    (sinon : cassure acceptée = continuation, pas un balayage)    |
//| 4. CHOCH : clôture > dernier sommet fractal (micro) formé avant  |
//|    e, au plus C barres après e.                                  |
//| 5. Entrée : à la clôture du CHOCH, ou au 1er retest valide de    |
//|    la moitié basse du déplacement (selon le mode).               |
//| Stop : extrême du balayage - tampon ATR.                         |
//| Invalidation : clôtures de retour sous le niveau balayé.         |
//+------------------------------------------------------------------+
bool EvaluateSweepPattern(const CMarketContext &ctx, const CBarSeries &b, const int s0, const double level,
                          const int levelKind, const int touches, SSignal &sig)
  {
   int last = b.count - 1;
   double atr = ctx.atr[last];
   sig.stage = 1;
   sig.refusal = GLS_REFUSE_NO_SETUP;
   if(atr <= 0.0)
      return false;
   double minPen = MathMax(InpSweepMinDepthATR * atr, g_sym.tickSize);
   double maxPen = InpSweepMaxDepthATR * atr;
   double buf = InpReclaimBufferATR * atr;

   int e = b.ArgMinLow(s0, last);
   if(e < 0)
      return false;
   double depth = level - b.low[e];
   if(depth < minPen || depth > maxPen)
     {
      sig.detail = "profondeur de balayage hors limites";
      return false;
     }
   //--- réintégration
   int r = -1;
   for(int i = e; i <= last; i++)
      if(b.close[i] > level + buf)
        {
         r = i;
         break;
        }
   if(r < 0)
     {
      sig.refusal = GLS_REFUSE_INCOMPLETE;
      sig.detail = "balayage sans réintégration (attente)";
      return false;
     }
   if(r - e > InpReclaimMaxBars)
     {
      sig.detail = "réintégration trop lente (acceptation sous le niveau)";
      return false;
     }
   int accept = 0;
   for(int i = s0; i < r; i++)
      if(b.close[i] < level)
         accept++;
   if(accept > InpMaxAcceptanceCloses)
     {
      sig.detail = "trop de clôtures sous le niveau : cassure, pas balayage";
      return false;
     }
   for(int i = r + 1; i <= last; i++)
      if(b.close[i] < level)
        {
         sig.detail = "réintégration perdue";
         return false;
        }
   //--- CHOCH M1
   int jh = LastFractalHigh(b, s0 - InpChochLookback, e - 1, InpMicroSwingStrength, e);
   bool fallback = (jh < 0);
   double choch = 0.0;
   if(!fallback)
      choch = b.high[jh];
   else
     {
      choch = b.high[e];
      if(e >= 1)
         choch = MathMax(choch, b.high[e - 1]);
     }
   choch = MathMax(choch, level + buf);
   int c = -1;
   for(int i = e; i <= last; i++)
      if(b.close[i] > choch)
        {
         c = i;
         break;
        }
   if(c < 0)
     {
      sig.refusal = GLS_REFUSE_INCOMPLETE;
      sig.detail = "réintégration sans CHOCH M1 (attente)";
      return false;
     }
   if(c - e > InpConfirmMaxBars)
     {
      sig.detail = "CHOCH trop tardif";
      return false;
     }
   //--- déclenchement sur la dernière barre clôturée uniquement
   bool trig = false;
   bool retest = false;
   if(c == last && InpEntryMode != GLS_ENTRY_RETEST)
      trig = true;
   else
      if(c < last && InpEntryMode != GLS_ENTRY_CONFIRM && last - c <= InpRetestMaxBars)
        {
         double zoneTop = level + MathMax(0.5 * (b.close[c] - level), 0.2 * atr);
         bool earlier = false;
         for(int i = c + 1; i < last; i++)
            if(IsRetestBar(b, i, zoneTop, level + buf))
              {
               earlier = true;
               break;
              }
         if(!earlier && IsRetestBar(b, last, zoneTop, level + buf))
           {
            trig = true;
            retest = true;
           }
        }
   if(!trig)
     {
      sig.refusal = GLS_REFUSE_INCOMPLETE;
      sig.detail = "CHOCH confirmé, attente du retest";
      return false;
     }

   sig.valid = true;
   sig.stage = 2;
   sig.family = GLS_FAMILY_SWEEP;
   sig.level = level;
   sig.extreme = b.low[e];
   sig.stop = b.low[e] - InpSLBufferATR * atr;
   sig.invalidation = level;
   sig.refEntry = b.close[last];
   sig.anchorTime = b.time[e];
   sig.triggerTime = b.time[last];
   sig.levelKind = levelKind;
   sig.retestEntry = retest;

   //--- composantes du score
   double base = 0.6;
   if(levelKind == GLS_LVL_M1_SWING)
      base = (touches >= 2) ? 0.85 : 0.6;
   else
      if(levelKind == GLS_LVL_M5_SWING)
         base = 0.8;
      else
         base = 1.0;
   double depthAtr = depth / atr;
   double depthF = (depthAtr >= 0.1 && depthAtr <= 0.8) ? 1.0 : 0.8;
   sig.cLiq = Clamp(base * depthF, 0.0, 1.0);

   //--- la FORME des bougies (mèches, corps) n'est évaluée qu'une fois, dans la composante "bougies"
   sig.cTrig = Clamp(1.0 - 0.15 * (r - e) - 0.15 * accept, 0.0, 1.0);
   sig.cStruct = Clamp((fallback ? 0.6 : 0.7) + 0.3 * Ramp((b.close[c] - choch) / atr, 0.0, 0.3), 0.0, 1.0);
   if(retest)
      sig.cRetest = (b.low[last] <= level + 0.25 * (b.close[c] - level)) ? 1.0 : 0.8;
   else
      sig.cRetest = 0.3;

   sig.detail = StringFormat("%s %s balayé de %.2f ATR, réintégré en %d barre(s), CHOCH %s, %s",
                             LevelKindText(levelKind), ViewPrice(level), depthAtr, r - e,
                             fallback ? "sur bougie" : "sur sommet fractal", retest ? "entrée sur retest" : "entrée à la confirmation");
   return true;
  }

void DetectSweep(const CMarketContext &ctx, const CBarSeries &b, const CDirView &v, SSignal &best)
  {
   SignalReset(best);
   int last = b.count - 1;
   int lb = InpM1Lookback;
   int k = InpM1SwingStrength;
   if(last < lb + k + 5)
      return;
   double atr = ctx.atr[last];
   if(atr <= 0.0)
      return;
   double tol = InpEqualLevelTolATR * atr;
   int minS0 = MathMax(lb + k + 1, last - InpSetupMaxBars);
   for(int s0 = last; s0 >= minS0; s0--)
     {
      //--- (a) liquidité interne M1
      int iL = LowestFractalLow(b, s0 - lb, s0 - 1, k, s0 - 1);
      if(iL >= 0)
        {
         double level = b.low[iL];
         bool fresh = true;
         for(int j = iL + 1; j < s0; j++)
            if(b.low[j] < level)
              {
               fresh = false;
               break;
              }
         if(fresh && b.low[s0] < level)
           {
            int touches = 0;
            for(int j = MathMax(k, s0 - lb); j + k <= s0 - 1; j++)
               if(IsSwingLow(b, j, k) && MathAbs(b.low[j] - level) <= tol)
                  touches++;
            SSignal cand;
            SignalReset(cand);
            cand.dir = v.dir;
            EvaluateSweepPattern(ctx, b, s0, level, GLS_LVL_M1_SWING, touches, cand);
            KeepBest(best, cand);
           }
        }
      //--- (b) liquidité externe (M5/M15, veille, Asie)
      if(!InpUseExternalLevels)
         continue;
      for(int x = 0; x < ArraySize(v.sweepable); x++)
        {
         double level = v.sweepable[x].price;
         if(v.sweepable[x].confirmTime > b.time[s0])
            continue;
         if(v.sweepable[x].brokenTime != 0 && v.sweepable[x].brokenTime <= b.time[s0])
            continue;
         if(b.low[s0] >= level)
            continue;
         bool fresh = true;
         for(int j = MathMax(0, s0 - 60); j < s0; j++)
            if(b.low[j] < level)
              {
               fresh = false;
               break;
              }
         if(!fresh)
            continue;
         SSignal cand;
         SignalReset(cand);
         cand.dir = v.dir;
         EvaluateSweepPattern(ctx, b, s0, level, v.sweepable[x].kind, 1, cand);
         KeepBest(best, cand);
        }
     }
  }

//+------------------------------------------------------------------+
//| F2 - Tendance + pullback + reprise                               |
//| Impulsion : plus haut H des W dernières barres (>= 2 barres),    |
//|   départ L0 = plus bas des P barres avant H ; H-L0 >= m x ATR.   |
//| Pullback : plus bas PL depuis H ; retracement (H-PL)/(H-L0)      |
//|   dans [min, max] (0.382-0.786 par défaut).                      |
//| Reprise : 1re clôture > dernier sommet fractal du pullback (LH), |
//|   clôture encore < H. Tendance M5 (structure) dans le même sens. |
//| Stop : PL - tampon. Invalidation : retour sous LH.               |
//+------------------------------------------------------------------+
void DetectPullback(const CMarketContext &ctx, const CBarSeries &b, const CDirView &v, SSignal &best)
  {
   SignalReset(best);
   int last = b.count - 1;
   int w = InpPBWindow;
   int p = InpPBImpulseLookback;
   if(last < w + p + 5)
      return;
   double atr = ctx.atr[last];
   if(atr <= 0.0)
      return;
   int iH = b.ArgMaxHigh(last - w + 1, last - 2);
   if(iH < 0 || iH - p < 0)
      return;
   double h = b.high[iH];
   int iL0 = b.ArgMinLow(iH - p, iH - 1);
   if(iL0 < 0)
      return;
   double l0 = b.low[iL0];
   double impulse = h - l0;
   best.stage = 1;
   if(impulse < InpPBMinImpulseATR * atr)
     {
      best.detail = "impulsion insuffisante";
      return;
     }
   int iPL = b.ArgMinLow(iH + 1, last);
   if(iPL < 0)
      return;
   double pl = b.low[iPL];
   double retr = SafeDiv(h - pl, impulse, 0.0);
   if(retr < InpPBMinRetrace || retr > InpPBMaxRetrace)
     {
      best.detail = StringFormat("retracement %.2f hors plage", retr);
      return;
     }
   int jh = LastFractalHigh(b, iH + 1, iPL - 1, InpMicroSwingStrength, iPL);
   double lh = 0.0;
   if(jh >= 0)
      lh = b.high[jh];
   else
     {
      lh = b.high[iPL];
      if(iPL - 1 > iH)
         lh = MathMax(lh, b.high[iPL - 1]);
     }
   if(b.close[last] <= lh)
     {
      best.refusal = GLS_REFUSE_INCOMPLETE;
      best.detail = "pullback en cours, attente de la reprise";
      return;
     }
   for(int i = iPL + 1; i < last; i++)
      if(b.close[i] > lh)
        {
         best.detail = "reprise déjà déclenchée plus tôt";
         return;
        }
   if(b.close[last] >= h)
     {
      best.detail = "prix déjà au-delà du sommet d'impulsion";
      return;
     }

   best.valid = true;
   best.stage = 2;
   best.family = GLS_FAMILY_PULLBACK;
   best.dir = v.dir;
   best.level = lh;
   best.extreme = pl;
   best.stop = pl - InpSLBufferATR * atr;
   best.invalidation = lh;
   best.refEntry = b.close[last];
   best.anchorTime = b.time[iPL];
   best.triggerTime = b.time[last];
   best.levelKind = GLS_LVL_M1_SWING;
   best.retestEntry = false;

   double depthQ = (retr >= 0.5 && retr <= 0.65) ? 1.0 : 0.7;
   int pbBars = last - iH;
   best.cLiq = depthQ * ((pbBars >= 3 && pbBars <= 20) ? 1.0 : 0.85);
   best.cTrig = 0.5 + 0.5 * Ramp(impulse / atr, InpPBMinImpulseATR, 2.0 * InpPBMinImpulseATR);
   best.cStruct = (jh >= 0) ? 1.0 : 0.7;   // reprise au-dessus d'un sommet fractal (structure) ou du repli
   best.cRetest = 0.5;
   best.detail = StringFormat("impulsion %.1f ATR, retracement %.2f, reprise au-dessus de %s", impulse / atr, retr, ViewPrice(lh));
  }

//+------------------------------------------------------------------+
//| F3 - Cassure de range + confirmation + retest                    |
//| Range : N barres avant la cassure b ; hauteur dans [min,max]xATR |
//|   et >= 2 contacts en haut et en bas (zone de 15 % de la hauteur)|
//| Cassure : clôture[b] > haut + 0.1 ATR, corps >= 50 % de la barre.|
//| Confirmation : clôture[b+1] > haut, aucune clôture de retour     |
//|   dans le range ensuite.                                         |
//| Retest : 1re barre (après b+1) touchant haut + tol, clôturant    |
//|   au-dessus du haut, haussière, clôture dans la moitié haute.    |
//| Stop : plus bas depuis b - tampon. Invalidation : retour dans le |
//|   range.                                                         |
//+------------------------------------------------------------------+
void DetectRangeBreak(const CMarketContext &ctx, const CBarSeries &b, const CDirView &v, SSignal &best)
  {
   SignalReset(best);
   int last = b.count - 1;
   int rw = InpRangeBars;
   if(last < rw + InpBreakoutMaxAge + 5)
      return;
   double atrNow = ctx.atr[last];
   if(atrNow <= 0.0)
      return;
   for(int bi = last - 2; bi >= last - InpBreakoutMaxAge; bi--)
     {
      if(bi - rw < 1)
         break;
      double atrB = ctx.atr[bi - 1];
      if(atrB <= 0.0)
         continue;
      int iTop = b.ArgMaxHigh(bi - rw, bi - 1);
      int iBot = b.ArgMinLow(bi - rw, bi - 1);
      if(iTop < 0 || iBot < 0)
         continue;
      double top = b.high[iTop];
      double bot = b.low[iBot];
      double hgt = top - bot;
      if(hgt < InpRangeMinATR * atrB || hgt > InpRangeMaxATR * atrB)
         continue;
      int tTop = 0;
      int tBot = 0;
      for(int i = bi - rw; i <= bi - 1; i++)
        {
         if(b.high[i] >= top - 0.15 * hgt)
            tTop++;
         if(b.low[i] <= bot + 0.15 * hgt)
            tBot++;
        }
      if(tTop < 2 || tBot < 2)
         continue;
      if(b.close[bi] <= top + 0.1 * atrB || b.BodyRatio(bi) < 0.5 || b.close[bi] <= b.open[bi])
         continue;
      //--- configuration de cassure trouvée (la plus récente)
      best.stage = 1;
      if(b.close[bi + 1] <= top)
        {
         best.detail = "cassure non confirmée";
         return;
        }
      for(int i = bi + 1; i <= last; i++)
         if(b.close[i] <= top)
           {
            best.detail = "retour dans le range";
            return;
           }
      double tol = InpRetestTolATR * atrB;
      for(int i = bi + 2; i < last; i++)
         if(IsRetestBar(b, i, top + tol, top))
           {
            best.detail = "retest déjà déclenché plus tôt";
            return;
           }
      if(last < bi + 2 || !IsRetestBar(b, last, top + tol, top))
        {
         best.refusal = GLS_REFUSE_INCOMPLETE;
         best.detail = "cassure confirmée, attente du retest";
         return;
        }
      int iLow = b.ArgMinLow(bi, last);
      best.valid = true;
      best.stage = 2;
      best.family = GLS_FAMILY_RANGE_BREAK;
      best.dir = v.dir;
      best.level = top;
      best.extreme = b.low[iLow];
      best.stop = b.low[iLow] - InpSLBufferATR * atrNow;
      best.invalidation = top;
      best.refEntry = b.close[last];
      best.anchorTime = b.time[bi];
      best.triggerTime = b.time[last];
      best.levelKind = GLS_LVL_M1_SWING;
      best.retestEntry = true;
      int touches = MathMin(tTop, tBot);
      best.cLiq = ((touches >= 3) ? 1.0 : 0.75) * ((hgt >= 1.5 * atrB && hgt <= 3.0 * atrB) ? 1.0 : 0.85);
      best.cTrig = 0.5 + 0.5 * Ramp((b.close[bi] - top) / atrB, 0.1, 0.6);
      best.cStruct = 0.6 + 0.4 * Ramp((b.close[bi + 1] - top) / atrB, 0.0, 0.5);
      best.cRetest = 1.0 - 0.4 * Ramp(MathAbs(b.low[last] - top) / atrB, 0.0, MathMax(InpRetestTolATR, 0.01));
      best.detail = StringFormat("range %.1f ATR (%d/%d contacts), cassure de %s, retest validé", hgt / atrB, tTop, tBot, ViewPrice(top));
      return;
     }
  }

//+------------------------------------------------------------------+
//| F4 - Compression de volatilité + expansion confirmée             |
//| Boîte : C barres avant l'expansion e ; hauteur <= x ATR100 et    |
//|   ATR14/ATR100 <= ratio (contraction).                           |
//| Expansion e (avant-dernière barre) : clôture > haut de boîte +   |
//|   0.2 ATR100, TR >= y ATR100, corps >= 60 %, haussière.          |
//| Confirmation f (dernière barre) : clôture > haut de boîte,       |
//|   plus bas > milieu du corps de e, bougie non baissière.         |
//| Stop : milieu de la boîte - tampon. Invalidation : retour dans   |
//|   la boîte.                                                      |
//+------------------------------------------------------------------+
void DetectSqueeze(const CMarketContext &ctx, const CBarSeries &b, const CDirView &v, SSignal &best)
  {
   SignalReset(best);
   int last = b.count - 1;
   int cb = InpSqueezeBars;
   int e = last - 1;
   int f = last;
   if(e - cb < 1)
      return;
   double atrL = ctx.atrLong[e - 1];
   double atrS = ctx.atr[e - 1];
   double atrNow = ctx.atr[last];
   if(atrL <= 0.0 || atrS <= 0.0 || atrNow <= 0.0)
      return;
   int iTop = b.ArgMaxHigh(e - cb, e - 1);
   int iBot = b.ArgMinLow(e - cb, e - 1);
   if(iTop < 0 || iBot < 0)
      return;
   double boxTop = b.high[iTop];
   double boxBot = b.low[iBot];
   double hb = boxTop - boxBot;
   if(hb > InpSqueezeBoxATR * atrL || atrS / atrL > InpSqueezeATRRatio)
      return;
   double tr = MathMax(b.high[e], b.close[e - 1]) - MathMin(b.low[e], b.close[e - 1]);
   if(b.close[e] <= boxTop + 0.2 * atrL || tr < InpExpansionTRATR * atrL || b.BodyRatio(e) < 0.6 || b.close[e] <= b.open[e])
     {
      best.stage = 1;
      best.refusal = GLS_REFUSE_INCOMPLETE;
      best.detail = "compression active, pas d'expansion";
      return;
     }
   best.stage = 1;
   double midBody = b.open[e] + 0.5 * (b.close[e] - b.open[e]);
   if(b.close[f] <= boxTop || b.low[f] <= midBody || b.close[f] < b.open[f])
     {
      best.detail = "expansion sans confirmation";
      return;
     }
   best.valid = true;
   best.stage = 2;
   best.family = GLS_FAMILY_SQUEEZE;
   best.dir = v.dir;
   best.level = boxTop;
   best.extreme = boxBot;
   best.stop = 0.5 * (boxTop + boxBot) - InpSLBufferATR * atrNow;
   best.invalidation = boxTop;
   best.refEntry = b.close[last];
   best.anchorTime = b.time[e];
   best.triggerTime = b.time[last];
   best.levelKind = GLS_LVL_M1_SWING;
   best.retestEntry = false;
   double tight = 1.0 - Clamp(SafeDiv(hb, InpSqueezeBoxATR * atrL, 1.0), 0.0, 1.0);
   best.cLiq = 0.6 + 0.4 * tight;
   best.cTrig = 0.6 + 0.4 * Ramp(tr / atrL, InpExpansionTRATR, 2.0 * InpExpansionTRATR);
   best.cStruct = (b.close[f] > b.close[e]) ? 1.0 : 0.7;
   best.cRetest = 0.5;
   best.detail = StringFormat("boîte %.2f ATR100, ATR14/ATR100 %.2f, expansion %.1f ATR100 confirmée", hb / atrL, atrS / atrL, tr / atrL);
  }

//+------------------------------------------------------------------+
//| Outils communs aux familles F5 et F6                              |
//+------------------------------------------------------------------+
//--- "lo-hi" en prix réels quelle que soit la vue
string ViewRange(const double lo, const double hi)
  {
   double a = MathAbs(lo);
   double b = MathAbs(hi);
   return DoubleToString(MathMin(a, b), g_sym.digits) + "-" + DoubleToString(MathMax(a, b), g_sym.digits);
  }

//--- Figure de réaction du sens de la vue, touchant la zone, CONFIRMÉE sur la dernière barre
int ReactionPattern(const CCandleAnalysis &ca, const int fromBar, const double zoneTop, const double tol, const int last)
  {
   int best = -1;
   for(int i = 0; i < ArraySize(ca.pats); i++)
     {
      int cat = ca.pats[i].category;
      if(ca.pats[i].dir == 0 || (cat != GLS_CDLCAT_REVERSAL && cat != GLS_CDLCAT_REJECTION && cat != GLS_CDLCAT_COMPOSITE))
         continue;
      if(ca.pats[i].bar < fromBar || ca.pats[i].low > zoneTop + tol)
         continue;
      if(ca.pats[i].status != GLS_CDLST_CONFIRMED || ca.pats[i].confirmBar != last)
         continue;
      if(best < 0 || ca.pats[i].strength > ca.pats[best].strength)
         best = i;
     }
   return best;
  }

//--- CHOCH M1 sur la dernière barre : 1re clôture au-dessus du dernier sommet fractal formé depuis fromBar
bool MicroChochAtLast(const CBarSeries &b, const int fromBar)
  {
   int last = b.count - 1;
   int jh = LastFractalHigh(b, fromBar, last - 1, InpMicroSwingStrength, last);
   if(jh < 0 || b.close[last] <= b.high[jh])
      return false;
   for(int k = jh + 1; k < last; k++)
      if(b.close[k] > b.high[jh])
         return false;
   return true;
  }

//+------------------------------------------------------------------+
//| F5 - Réaction confirmée sur support (vente : résistance)         |
//| Zone : support S/R valide (force >= InpSRMinStrength) connu      |
//|   AVANT la fenêtre des InpSRReactBars dernières barres M1.       |
//| Contact : 1re barre de la fenêtre dont le plus bas <= haut de    |
//|   zone + 0,1 ATR, venant d'au-dessus de la zone.                 |
//| Zone tenue : aucune clôture sous bas - InpZoneBreakBufferATR.    |
//| Réaction : figure haussière (retournement, rejet ou composée)    |
//|   touchant la zone, CONFIRMÉE sur la dernière barre clôturée,    |
//|   clôture au-dessus de la zone. Une figure seule ne suffit pas : |
//|   contexte, zone, confirmation et contrôles communs requis.      |
//| Stop : min(plus bas de la réaction, bas de zone) - tampon ATR.   |
//| Invalidation : bas de la zone.                                   |
//+------------------------------------------------------------------+
void DetectSRBounce(const CMarketContext &ctx, const CBarSeries &b, const CDirView &v, const CCandleAnalysis &ca, SSignal &best)
  {
   SignalReset(best);
   int last = b.count - 1;
   if(last < 40)
      return;
   double atr = ctx.atr[last];
   if(atr <= 0.0)
      return;
   double tol = 0.1 * atr;
   double brk = InpZoneBreakBufferATR * atr;
   int from = MathMax(2, last - InpSRReactBars + 1);
   for(int z = 0; z < ArraySize(v.supports); z++)
     {
      double lo = v.supports[z].lo;
      double hi = v.supports[z].hi;
      if(v.supports[z].quality < InpSRMinStrength || v.supports[z].known > b.time[from])
         continue;
      int t = -1;
      for(int k = from; k <= last; k++)
         if(b.low[k] <= hi + tol)
           {
            t = k;
            break;
           }
      if(t < 0 || b.close[t - 1] < lo)
         continue;
      SSignal cand;
      SignalReset(cand);
      cand.dir = v.dir;
      cand.stage = 1;
      bool held = true;
      for(int k = t; k <= last; k++)
         if(b.close[k] < lo - brk)
           {
            held = false;
            break;
           }
      if(!held)
        {
         cand.detail = "zone " + ViewRange(lo, hi) + " cassée par une clôture";
         KeepBest(best, cand);
         continue;
        }
      if(b.close[last] <= hi)
        {
         cand.refusal = GLS_REFUSE_INCOMPLETE;
         cand.detail = "contact de la zone " + ViewRange(lo, hi) + ", réaction non confirmée";
         KeepBest(best, cand);
         continue;
        }
      int pi = ReactionPattern(ca, t - 1, hi, tol, last);
      if(pi < 0)
        {
         cand.refusal = GLS_REFUSE_INCOMPLETE;
         cand.detail = "zone " + ViewRange(lo, hi) + " : attente d'une figure de réaction confirmée";
         KeepBest(best, cand);
         continue;
        }
      double rLow = MathMin(ca.pats[pi].low, LowOf(b, t, last));
      bool choch = MicroChochAtLast(b, MathMax(0, t - 5));
      cand.valid = true;
      cand.stage = 2;
      cand.family = GLS_FAMILY_SR_BOUNCE;
      cand.level = hi;
      cand.extreme = rLow;
      cand.stop = MathMin(rLow, lo) - InpSLBufferATR * atr;
      cand.invalidation = lo;
      cand.refEntry = b.close[last];
      cand.anchorTime = b.time[t];
      cand.triggerTime = b.time[last];
      cand.levelKind = GLS_LVL_ZONE;
      cand.retestEntry = true;
      cand.cLiq = Clamp(v.supports[z].quality, 0.0, 1.0);
      cand.cTrig = Clamp(1.0 - 0.1 * (last - t), 0.3, 1.0);
      cand.cStruct = choch ? 1.0 : 0.7;
      //--- retest : réaction tenue DANS la zone (mèche au-delà du bas de zone = moins propre) ;
      //--- la force de la zone (réactions, M15) est déjà dans cLiq : pas de double comptage
      cand.cRetest = (rLow >= lo) ? 1.0 : 0.7;
      cand.detail = "zone " + ViewRange(lo, hi) + " (" + v.supports[z].label + "), réaction : "
                    + CandleName(ca.pats[pi].id, ca.pats[pi].dir) + (choch ? ", CHOCH M1" : "");
      KeepBest(best, cand);
     }
  }

//+------------------------------------------------------------------+
//| F6 - Retest de FVG avec réaction confirmée                       |
//| FVG du sens du trade (InpFvgTF, hors doublons), fraîche ou       |
//|   partiellement comblée, qualité >= InpFvgMinQuality, retours <= |
//|   InpFvgMaxRetests, âge <= InpFvgMaxAgeBars barres de son unité, |
//|   connue avant le contact.                                       |
//| Option InpFvgObConfluence = exigée : un Order Block actif du même|
//|   sens doit toucher la FVG (filtre de sélection, AUCUN point de  |
//|   score : FVG, OB et cassure d'un même déplacement = une seule   |
//|   information).                                                  |
//| Contact : 1re entrée dans la zone dans les InpFvgReactBars       |
//|   dernières barres M1, la barre précédente étant hors zone.      |
//| Zone tenue : aucune clôture sous bas - InpFvgInvalidBufferATR.   |
//| Pas d'entrée au premier contact : il faut une RÉACTION =         |
//|   figure confirmée sur la dernière barre ET/OU CHOCH M1, avec    |
//|   clôture au-dessus du milieu de la zone. (InpFvgRequireReaction |
//|   = false : variante de RECHERCHE refusée hors testeur.)         |
//| Stop : min(plus bas depuis le contact, bas de zone) - tampon.    |
//| Invalidation : bas de la zone.                                   |
//+------------------------------------------------------------------+
void DetectFvgRetest(const CMarketContext &ctx, const CBarSeries &b, const CDirView &v, const CCandleAnalysis &ca, SSignal &best)
  {
   SignalReset(best);
   int last = b.count - 1;
   if(last < 40)
      return;
   double atr = ctx.atr[last];
   if(atr <= 0.0)
      return;
   double tol = 0.05 * atr;
   double buf = InpFvgInvalidBufferATR * atr;
   int from = MathMax(2, last - InpFvgReactBars + 1);
   datetime oldest = b.time[last] - InpFvgMaxAgeBars * (int)InpFvgTF * 60;
   bool needOb = (InpFvgObConfluence == GLS_OBC_REQUIRE);
   for(int z = 0; z < ArraySize(v.fvgZones); z++)
     {
      double lo = v.fvgZones[z].lo;
      double hi = v.fvgZones[z].hi;
      if(v.fvgZones[z].quality < InpFvgMinQuality || v.fvgZones[z].retests > InpFvgMaxRetests)
         continue;
      datetime known = (needOb && v.fvgZones[z].obConf) ? v.fvgZones[z].confKnown : v.fvgZones[z].known;
      if(known > b.time[from] || v.fvgZones[z].known < oldest)
         continue;
      int t = -1;
      for(int k = from; k <= last; k++)
         if(b.low[k] <= hi)
           {
            t = k;
            break;
           }
      if(t < 0 || b.low[t - 1] <= hi)
         continue;
      SSignal cand;
      SignalReset(cand);
      cand.dir = v.dir;
      cand.stage = 1;
      cand.family = GLS_FAMILY_FVG;
      SetZoneInfo(cand, v.fvgZones[z]);
      string obText = v.fvgZones[z].obConf ? (v.fvgZones[z].obSame ? "OB : oui (même déplacement)" : "OB : oui (déplacement distinct)") : "OB : non";
      if(needOb && !v.fvgZones[z].obConf)
        {
         cand.refusal = GLS_REFUSE_NO_CONFLUENCE;
         cand.detail = "FVG " + ViewRange(lo, hi) + " : aucun Order Block en confluence";
         g_zoneDecisions.Add(cand);
         KeepBest(best, cand);
         continue;
        }
      bool held = true;
      for(int k = t; k <= last; k++)
         if(b.close[k] < lo - buf)
           {
            held = false;
            break;
           }
      if(!held)
        {
         cand.refusal = GLS_REFUSE_ZONE_BROKEN;
         cand.detail = "FVG " + ViewRange(lo, hi) + " invalidée par une clôture";
         g_zoneDecisions.Add(cand);
         KeepBest(best, cand);
         continue;
        }
      if(b.close[last] <= 0.5 * (lo + hi))
        {
         cand.refusal = GLS_REFUSE_INCOMPLETE;
         cand.detail = "retour dans la FVG " + ViewRange(lo, hi) + ", réaction non confirmée (clôture sous le milieu)";
         g_zoneDecisions.Add(cand);
         KeepBest(best, cand);
         continue;
        }
      int pi = ReactionPattern(ca, t - 1, hi, tol, last);
      bool choch = MicroChochAtLast(b, MathMax(0, t - 5));
      string confText = "figure : " + ((pi >= 0) ? CandleName(ca.pats[pi].id, ca.pats[pi].dir) : "aucune") + ", CHOCH M1 : " + (choch ? "oui" : "non")
                        + ", " + obText;
      if(pi < 0 && !choch && InpFvgRequireReaction)
        {
         cand.refusal = GLS_REFUSE_INCOMPLETE;
         cand.detail = "FVG " + ViewRange(lo, hi) + " : attente d'une réaction (" + confText + ")";
         g_zoneDecisions.Add(cand);
         KeepBest(best, cand);
         continue;
        }
      double rLow = LowOf(b, t, last);
      if(pi >= 0)
         rLow = MathMin(rLow, ca.pats[pi].low);
      cand.valid = true;
      cand.stage = 2;
      cand.level = hi;
      cand.extreme = rLow;
      cand.stop = MathMin(rLow, lo) - InpSLBufferATR * atr;
      cand.invalidation = lo;
      cand.refEntry = b.close[last];
      cand.anchorTime = b.time[t];
      cand.triggerTime = b.time[last];
      cand.levelKind = GLS_LVL_FVG;
      cand.retestEntry = true;
      //--- la qualité de la FVG (déplacement, cassure, balayage, fraîcheur, contexte) est comptée UNE fois ici
      cand.cLiq = Clamp(v.fvgZones[z].quality, 0.0, 1.0);
      cand.cTrig = Clamp(1.0 - 0.1 * (last - t), 0.3, 1.0);
      cand.cStruct = choch ? 1.0 : 0.7;
      //--- retest : réaction tenue DANS la FVG ; le nombre de retours est déjà dans la qualité
      //--- de la FVG (fraîcheur, cLiq) : il n'est pas compté une seconde fois
      cand.cRetest = (rLow >= lo) ? 1.0 : 0.7;
      cand.detail = (v.fvgZones[z].inverted ? "IFVG " : "FVG ") + ViewRange(lo, hi) + " [" + v.fvgZones[z].label + "] - " + confText;
      KeepBest(best, cand);
     }
  }

//--- Détection brute (espace de la vue) selon la famille active
void DetectFamily(const int family, const CMarketContext &ctx, const CDirView &v, SSignal &sig)
  {
   if(v.dir == GLS_BUY)
     {
      switch(family)
        {
         case GLS_FAMILY_SWEEP:       DetectSweep(ctx, ctx.m1, v, sig); break;
         case GLS_FAMILY_PULLBACK:    DetectPullback(ctx, ctx.m1, v, sig); break;
         case GLS_FAMILY_RANGE_BREAK: DetectRangeBreak(ctx, ctx.m1, v, sig); break;
         case GLS_FAMILY_SQUEEZE:     DetectSqueeze(ctx, ctx.m1, v, sig); break;
         case GLS_FAMILY_SR_BOUNCE:   DetectSRBounce(ctx, ctx.m1, v, ctx.cdlBuy, sig); break;
         case GLS_FAMILY_FVG:         DetectFvgRetest(ctx, ctx.m1, v, ctx.cdlBuy, sig); break;
         default:                     SignalReset(sig); break;
        }
     }
   else
     {
      switch(family)
        {
         case GLS_FAMILY_SWEEP:       DetectSweep(ctx, ctx.m1Mirror, v, sig); break;
         case GLS_FAMILY_PULLBACK:    DetectPullback(ctx, ctx.m1Mirror, v, sig); break;
         case GLS_FAMILY_RANGE_BREAK: DetectRangeBreak(ctx, ctx.m1Mirror, v, sig); break;
         case GLS_FAMILY_SQUEEZE:     DetectSqueeze(ctx, ctx.m1Mirror, v, sig); break;
         case GLS_FAMILY_SR_BOUNCE:   DetectSRBounce(ctx, ctx.m1Mirror, v, ctx.cdlSell, sig); break;
         case GLS_FAMILY_FVG:         DetectFvgRetest(ctx, ctx.m1Mirror, v, ctx.cdlSell, sig); break;
         default:                     SignalReset(sig); break;
        }
     }
   sig.dir = v.dir;
   sig.family = family;
  }

//+------------------------------------------------------------------+
//| Preuve apportée par les bougies (une seule fois, sans redondance) |
//|  own : figures du sens du signal ; opp : figures du sens opposé ; |
//|  neutral : figures d'indécision (analysées dans la vue achat).    |
//| Composante : 0,3 sans preuve ; 0,4 + 0,6 x qualité de la         |
//| meilleure figure CONFIRMÉE de la fenêtre de configuration         |
//| (qualité réduite hors contexte, bruit de spread, obstacle) ;      |
//| exclusions : F1 ignore l'échec de cassure (c'est son balayage),   |
//| F3/F4 ignorent la bougie d'impulsion (c'est leur déclencheur).    |
//+------------------------------------------------------------------+
void CandleEvidence(const CCandleAnalysis &own, const CCandleAnalysis &opp, const CCandleAnalysis &neutral, const int family,
                    const int fromBar, const int last, double &comp, int &bestId, string &bestName, bool &opposing,
                    string &oppName, bool &indecision)
  {
   comp = 0.3;
   bestId = GLS_CDL_NONE;
   bestName = "";
   opposing = false;
   oppName = "";
   double evidence = 0.0;
   for(int i = 0; i < ArraySize(own.pats); i++)
     {
      if(own.pats[i].dir == 0 || own.pats[i].bar < fromBar || own.pats[i].bar > last)
         continue;
      if(own.pats[i].status != GLS_CDLST_CONFIRMED)
         continue;
      if(family == GLS_FAMILY_SWEEP && own.pats[i].id == GLS_CDL_FAILBREAK)
         continue;
      if((family == GLS_FAMILY_RANGE_BREAK || family == GLS_FAMILY_SQUEEZE) && own.pats[i].id == GLS_CDL_IMPULSE)
         continue;
      double f = own.pats[i].strength * (own.pats[i].contextOk ? 1.0 : 0.5) * (own.pats[i].noisy ? 0.5 : 1.0) * (own.pats[i].obstacle ? 0.5 : 1.0);
      if(f > evidence)
        {
         evidence = f;
         bestId = own.pats[i].id;
         bestName = CandleName(own.pats[i].id, own.pats[i].dir);
        }
     }
   if(evidence > 0.0)
      comp = 0.4 + 0.6 * evidence;
   for(int i = 0; i < ArraySize(opp.pats); i++)
     {
      int cat = opp.pats[i].category;
      if(opp.pats[i].dir == 0 || (cat != GLS_CDLCAT_REVERSAL && cat != GLS_CDLCAT_REJECTION))
         continue;
      if(opp.pats[i].status != GLS_CDLST_CONFIRMED || !opp.pats[i].contextOk)
         continue;
      if(opp.pats[i].confirmBar >= last - InpCdlOpposingBars + 1)
        {
         opposing = true;
         oppName = CandleName(opp.pats[i].id, opp.pats[i].dir);
        }
     }
   indecision = neutral.IsIndecisionAt(last);
   if(indecision)
      comp = MathMin(comp, 0.1);
   if(opposing)
      comp = 0.0;
  }

//--- Enregistre un refus (le premier rencontré est retenu) et le critère échoué
void Refuse(SSignal &s, const int code, const string why)
  {
   if(s.refusal == GLS_REFUSE_NONE)
      s.refusal = code;
   s.criteria += "-" + why + "|";
  }

void Pass(SSignal &s, const string what)
  {
   s.criteria += "+" + what + "|";
  }

//+------------------------------------------------------------------+
//| Finalisation : prix réels, contrôles obligatoires, score          |
//| bid/ask : cotation actuelle ; extraCostPrice : coût estimé en     |
//| prix (commission + glissement prévu ; le spread est ajouté ici).  |
//+------------------------------------------------------------------+
void FinalizeSignal(SSignal &sig, const CMarketContext &ctx, const CDirView &v, const double bid, const double ask,
                    const double extraCostPrice, const datetime serverNow)
  {
   if(!sig.valid)
      return;
   int dir = sig.dir;
   double sgn = (double)dir;
   double spread = ask - bid;
   int last = ctx.Last();
   double atr = ctx.atr[last];

   //--- identifiant unique et stable du signal (même configuration = même identifiant)
   sig.id = GlsFamilyCode(sig.family) + "|" + (dir == GLS_BUY ? "B" : "S") + "|" + IntegerToString((long)sig.anchorTime) + "|" + ViewPrice(sig.level);
   sig.hash = HashHex(HashString(sig.id));

   //--- retour dans l'espace réel des prix (une vente utilise la série miroir)
   double stopView = sig.stop;
   sig.level = sgn * sig.level;
   sig.extreme = sgn * sig.extreme;
   sig.invalidation = sgn * sig.invalidation;
   sig.refEntry = sgn * sig.refEntry;
   sig.stop = sgn * stopView + (dir == GLS_SELL ? spread : 0.0);  // un stop de vente se déclenche sur l'ask

   sig.entryPrice = (dir == GLS_BUY) ? ask : bid;
   sig.refusal = GLS_REFUSE_NONE;
   sig.criteria = "";
   sig.regime = ctx.regime;
   sig.trend15 = ctx.t15.cls;
   sig.trend5 = ctx.t5.cls;

   //--- 1. contexte multi-unités de temps (non compensable par le score)
   if(InpUseEmaFilter && ctx.EmaSide() != dir)
      Refuse(sig, GLS_REFUSE_CONTEXT, "prix du mauvais côté de l'EMA200 M5");
   //--- règle de base (v1.00) : jamais contre la structure M15, sauf autorisation explicite
   if(!InpAllowCounterM15 && ctx.st15.trend == -dir)
      Refuse(sig, GLS_REFUSE_CONTEXT, "structure M15 opposée");
   //--- filtre de tendance (v1.10, désactivable pour les comparaisons A/B) : tendance M15 par votes
   //--- et, pour les continuations, tendance M5 opposée
   if(InpUseTrendFilter)
     {
      if(!InpAllowCounterM15 && ctx.t15.dir == -dir)
         Refuse(sig, GLS_REFUSE_TREND, "M15 opposée (" + ctx.t15.reason + ")");
      bool continuation = (sig.family == GLS_FAMILY_PULLBACK || sig.family == GLS_FAMILY_RANGE_BREAK
                           || sig.family == GLS_FAMILY_SQUEEZE || sig.family == GLS_FAMILY_FVG);
      if(continuation && ctx.t5.dir == -dir)
         Refuse(sig, GLS_REFUSE_TREND, "M5 opposée à une continuation");
     }
   if(sig.family == GLS_FAMILY_PULLBACK && ctx.st5.trend != dir)
      Refuse(sig, GLS_REFUSE_CONTEXT, "pullback sans tendance M5");
   if(InpMinM15Efficiency > 0.0 && ctx.st15.ready && ctx.st15.er < InpMinM15Efficiency)
      Refuse(sig, GLS_REFUSE_CONTEXT, StringFormat("marché sans direction (ER M15 %.2f)", ctx.st15.er));
   if(InpUseRegimeFilter && !RegimeAllowed(sig.family, ctx.regime))
      Refuse(sig, GLS_REFUSE_REGIME, "régime " + RegimeCode(ctx.regime) + " non autorisé");
   if(ctx.t15.dir == dir)
      Pass(sig, "M15 " + TrendClassText(ctx.t15.cls));
   if(ctx.t5.dir == dir)
      Pass(sig, "M5 " + TrendClassText(ctx.t5.cls));

   //--- 2. bougies : preuve unique, figure contraire, indécision, extension
   int fromBar = ctx.m1.IndexOfTime(sig.anchorTime);
   fromBar = (fromBar >= 0) ? fromBar - 2 : last - InpSetupMaxBars;
   bool opposing = false;
   bool indecision = false;
   string oppName = "";
   if(dir == GLS_BUY)
      CandleEvidence(ctx.cdlBuy, ctx.cdlSell, ctx.cdlBuy, sig.family, fromBar, last, sig.cCandle, sig.candleId, sig.candleName, opposing, oppName, indecision);
   else
      CandleEvidence(ctx.cdlSell, ctx.cdlBuy, ctx.cdlBuy, sig.family, fromBar, last, sig.cCandle, sig.candleId, sig.candleName, opposing, oppName, indecision);
   if(sig.candleId != GLS_CDL_NONE)
      Pass(sig, "bougies : " + sig.candleName);
   if(InpCdlBlockOpposing && opposing)
      Refuse(sig, GLS_REFUSE_CANDLE_OPPOSING, "figure contraire confirmée : " + oppName);
   if(InpCdlBlockIndecision && indecision)
      Refuse(sig, GLS_REFUSE_INDECISION, "bougie de déclenchement doji");
   if(InpCdlRequirePattern && sig.candleId == GLS_CDL_NONE)
      Refuse(sig, GLS_REFUSE_NO_PATTERN, "aucune figure confirmée");
   if(InpCdlBlockExtended && last >= 4)
     {
      double trigRange = ctx.m1.high[last] - ctx.m1.low[last];
      double run = sgn * (ctx.m1.close[last] - ctx.m1.open[last - 4]);
      if(trigRange > InpCdlMaxTriggerATR * atr)
         Refuse(sig, GLS_REFUSE_EXTENDED, StringFormat("bougie de déclenchement %.1f ATR", trigRange / atr));
      if(run > InpCdlMaxExtensionATR * atr)
         Refuse(sig, GLS_REFUSE_EXTENDED, StringFormat("mouvement de %.1f ATR en 5 barres", run / atr));
     }

   //--- 3. distance du stop : élargie AVANT l'entrée au minimum technique si nécessaire
   //---    (bruit ATR + niveau de stop du courtier) ; le volume est calculé ensuite.
   double minDist = MathMax(InpMinSLATR * atr, g_sym.StopsDistance() + spread + 2.0 * g_sym.tickSize);
   double dist = sgn * (sig.entryPrice - sig.stop);
   if(dist < minDist)
     {
      sig.stop = sig.entryPrice - sgn * minDist;
      dist = minDist;
     }
   sig.stop = (dir == GLS_BUY) ? g_sym.FloorPrice(sig.stop) : g_sym.CeilPrice(sig.stop);
   sig.riskDist = sgn * (sig.entryPrice - sig.stop);
   if(sig.riskDist > InpMaxSLATR * atr)
      Refuse(sig, GLS_REFUSE_STOP_WIDE, StringFormat("stop %.1f ATR", sig.riskDist / atr));

   //--- 4. poursuite du prix depuis la clôture de déclenchement (mesurée sur le bid)
   double refRisk = MathMax(sgn * (sig.refEntry - sig.stop), g_sym.tickSize);
   double moved = sgn * (bid - sig.refEntry);
   if(moved > InpMaxChaseFrac * refRisk)
      Refuse(sig, GLS_REFUSE_CHASE, "prix déjà avancé depuis le signal");

   //--- 5. espace jusqu'à l'obstacle opposé le plus proche (liquidité, résistance/support, FVG contraire)
   double room = -1.0;
   for(int i = 0; i < ArraySize(v.opposing); i++)
     {
      if(v.opposing[i].confirmTime > serverNow)
         continue;
      if(v.opposing[i].brokenTime != 0 && v.opposing[i].brokenTime <= serverNow)
         continue;
      double lvl = sgn * v.opposing[i].price;
      double d = (dir == GLS_BUY) ? lvl - ask : bid - lvl - spread;
      if(d <= 0.0)
         continue;
      if(room < 0.0 || d < room)
         room = d;
     }
   //--- zones opposées (vue : lo = bord proche) ; prix DANS une résistance (achat) / un support (vente) = espace nul ;
   //--- prix dans un FVG contraire = espace jusqu'à son bord lointain
   double viewPx = (dir == GLS_BUY) ? ask : -bid;
   bool insideZone = false;
   for(int i = 0; i < ArraySize(v.obstacles); i++)
     {
      if(v.obstacles[i].known > serverNow)
         continue;
      double edge = v.obstacles[i].lo;
      if(viewPx >= v.obstacles[i].lo && viewPx <= v.obstacles[i].hi)
        {
         if(v.obstacles[i].kind == GLS_LVL_ZONE)
           {
            insideZone = true;
            room = 0.0;
            continue;
           }
         edge = v.obstacles[i].hi;
        }
      double lvl = sgn * edge;
      double d = (dir == GLS_BUY) ? lvl - ask : bid - lvl - spread;
      if(d <= 0.0)
         continue;
      if(room < 0.0 || d < room)
         room = d;
     }
   sig.roomR = (room < 0.0) ? 5.0 : SafeDiv(room, sig.riskDist, 0.0);
   if(insideZone)
      Refuse(sig, GLS_REFUSE_RR, (dir == GLS_BUY) ? "prix dans une résistance" : "prix dans un support");
   else
      if(sig.roomR < InpMinRoomR)
         Refuse(sig, GLS_REFUSE_RR, StringFormat("espace %.2fR jusqu'à la zone opposée", sig.roomR));
      else
         Pass(sig, StringFormat("espace %.1fR", sig.roomR));

   //--- 6. coût d'exécution relatif au risque
   sig.costFrac = SafeDiv(spread + extraCostPrice, sig.riskDist, 1.0);
   if(sig.costFrac > InpMaxCostToRiskFrac)
      Refuse(sig, GLS_REFUSE_COST, StringFormat("coût %.0f %% du risque", 100.0 * sig.costFrac));
   else
      Pass(sig, StringFormat("coût %.0f %% du risque", 100.0 * sig.costFrac));

   //--- 7. composantes communes et score
   double a5 = (ctx.t5.dir == dir) ? 1.0 : ((ctx.t5.dir == 0) ? 0.5 : 0.0);
   //--- même déplacement : la cassure M5 qui fixe la tendance M5 est celle déjà comptée dans la qualité
   //--- de la zone (FVG) ; l'alignement M5 n'utilise alors que les autres votes (sommets/creux, EMA, pente)
   if(sig.dispEventTime != 0 && ctx.st5.lastEventTime == sig.dispEventTime)
     {
      int ov = (ctx.t5.swingVote + ctx.t5.emaVote + ctx.t5.slopeVote) * dir;
      a5 = (ov > 0) ? 1.0 : ((ov == 0) ? 0.5 : 0.0);
      Pass(sig, "alignement M5 sans la cassure du déplacement (déjà comptée dans la zone)");
     }
   double a15 = (ctx.t15.dir == dir) ? 1.0 : ((ctx.t15.dir == 0) ? 0.5 : 0.0);
   sig.cAlign = 0.5 * a5 + 0.5 * a15;
   double ratio = SafeDiv(atr, ctx.AtrLong(), 1.0);
   if(ratio >= 0.8 && ratio <= 1.6)
      sig.cVol = 1.0;
   else
      sig.cVol = (ratio < 0.8) ? Ramp(ratio, 0.5, 0.8) : 1.0 - Ramp(ratio, 1.6, 3.0);
   sig.cCost = 1.0 - Ramp(sig.costFrac, 0.03, InpMaxCostToRiskFrac);
   sig.cRR = Ramp(sig.roomR, 1.0, 3.0);

   double wsum = InpWLiquidity + InpWTrigger + InpWStructure + InpWCandle + InpWAlignment + InpWRetest + InpWVolatility + InpWCost + InpWRR;
   double total = InpWLiquidity * sig.cLiq + InpWTrigger * sig.cTrig + InpWStructure * sig.cStruct + InpWCandle * sig.cCandle
                  + InpWAlignment * sig.cAlign + InpWRetest * sig.cRetest + InpWVolatility * sig.cVol + InpWCost * sig.cCost + InpWRR * sig.cRR;
   sig.score = Clamp(100.0 * SafeDiv(total, wsum, 0.0), 0.0, 100.0);
   if(sig.score < InpMinScore)
      Refuse(sig, GLS_REFUSE_SCORE, StringFormat("score %.0f < %.0f", sig.score, InpMinScore));
  }

string SignalShortText(const SSignal &s)
  {
   if(s.stage == 0)
      return "aucune configuration";
   if(!s.valid)
      return GlsDirText(s.dir) + " en formation : " + s.detail;
   return StringFormat("%s %s score %.0f, stop %s, espace %.1fR", GlsFamilyCode(s.family), GlsDirText(s.dir), s.score,
                       DoubleToString(s.stop, g_sym.digits), s.roomR);
  }

#endif // GLS_SIGNALS_MQH
//+------------------------------------------------------------------+
