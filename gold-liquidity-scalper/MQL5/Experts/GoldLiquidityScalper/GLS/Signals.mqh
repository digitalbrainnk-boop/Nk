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
   double            cRR;          // espace jusqu'à la liquidité opposée
   double            score;
   double            roomR;
   double            riskDist;     // distance entrée -> stop au prix d'exécution estimé
   double            entryPrice;   // prix d'exécution estimé (ask achat / bid vente)
   double            costFrac;
   string            detail;
   int               refusal;
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

                     CDirView(void) : dir(GLS_BUY) {}

   void              Build(const CMarketContext &ctx, const int d)
     {
      dir = d;
      ctx.liq.DirectionalView(d, sweepable, opposing);
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
   s.score = 0.0;
   s.roomR = 0.0;
   s.riskDist = 0.0;
   s.entryPrice = 0.0;
   s.costFrac = 0.0;
   s.detail = "";
   s.refusal = GLS_REFUSE_NO_SETUP;
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

   double trigQ = 1.0 - 0.15 * (r - e) - 0.15 * accept;
   if(SafeDiv(b.LowerWick(e), b.Range(e), 0.0) >= 0.5)
      trigQ += 0.1;
   sig.cTrig = Clamp(trigQ, 0.0, 1.0);

   double disp = (b.BodyRatio(c) >= 0.6 && b.CloseLocation(c) >= 0.7) ? 1.0 : Ramp(b.BodyRatio(c), 0.3, 0.6);
   sig.cStruct = Clamp((fallback ? 0.6 : 0.7) + 0.3 * disp, 0.0, 1.0);

   if(retest)
      sig.cRetest = (SafeDiv(b.LowerWick(last), b.Range(last), 0.0) >= 0.4) ? 1.0 : 0.8;
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
   best.cStruct = (b.BodyRatio(last) >= 0.6 && b.CloseLocation(last) >= 0.7) ? 1.0 : 0.6 + 0.4 * Ramp(b.BodyRatio(last), 0.3, 0.6);
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
      best.cTrig = 0.5 + 0.5 * Ramp(b.BodyRatio(bi), 0.5, 0.8);
      best.cStruct = 0.6 + 0.4 * Ramp((b.close[bi + 1] - top) / atrB, 0.0, 0.5);
      best.cRetest = (SafeDiv(b.LowerWick(last), b.Range(last), 0.0) >= 0.4) ? 1.0 : 0.8;
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
         default:                     SignalReset(sig); break;
        }
     }
   sig.dir = v.dir;
   sig.family = family;
  }

//+------------------------------------------------------------------+
//| Finalisation : prix réels, contrôles obligatoires, score          |
//| bid/ask : cotation actuelle ; costPrice : coût estimé en prix     |
//| (spread + commission + glissement prévu).                        |
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

   //--- identifiant unique et stable du signal (même balayage = même identifiant)
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

   //--- contrôles de contexte (non compensables)
   if(InpUseEmaFilter && ctx.EmaSide() != dir)
      sig.refusal = GLS_REFUSE_CONTEXT;
   if(!InpAllowCounterM15 && ctx.st15.trend == -dir)
      sig.refusal = GLS_REFUSE_CONTEXT;
   if(sig.family == GLS_FAMILY_PULLBACK && ctx.st5.trend != dir)
      sig.refusal = GLS_REFUSE_CONTEXT;
   //--- marché sans direction exploitable : efficience M15 trop faible (va-et-vient)
   if(InpMinM15Efficiency > 0.0 && ctx.st15.ready && ctx.st15.er < InpMinM15Efficiency)
      sig.refusal = GLS_REFUSE_CONTEXT;

   //--- distance du stop : élargie AVANT l'entrée au minimum technique si nécessaire
   //--- (bruit ATR + niveau de stop du courtier) ; le volume est calculé ensuite.
   double minDist = MathMax(InpMinSLATR * atr, g_sym.StopsDistance() + spread + 2.0 * g_sym.tickSize);
   double dist = sgn * (sig.entryPrice - sig.stop);
   if(dist < minDist)
     {
      sig.stop = sig.entryPrice - sgn * minDist;
      dist = minDist;
     }
   sig.stop = (dir == GLS_BUY) ? g_sym.FloorPrice(sig.stop) : g_sym.CeilPrice(sig.stop);
   sig.riskDist = sgn * (sig.entryPrice - sig.stop);
   if(sig.riskDist > InpMaxSLATR * atr && sig.refusal == GLS_REFUSE_NONE)
      sig.refusal = GLS_REFUSE_STOP_WIDE;

   //--- poursuite du prix depuis la clôture de déclenchement (mesurée sur le bid)
   double refRisk = MathMax(sgn * (sig.refEntry - sig.stop), g_sym.tickSize);
   double moved = sgn * (bid - sig.refEntry);
   if(moved > InpMaxChaseFrac * refRisk && sig.refusal == GLS_REFUSE_NONE)
      sig.refusal = GLS_REFUSE_CHASE;

   //--- espace jusqu'à la liquidité opposée intacte la plus proche
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
   sig.roomR = (room < 0.0) ? 5.0 : SafeDiv(room, sig.riskDist, 0.0);
   if(sig.roomR < InpMinRoomR && sig.refusal == GLS_REFUSE_NONE)
      sig.refusal = GLS_REFUSE_RR;

   //--- coût d'exécution relatif au risque
   sig.costFrac = SafeDiv(spread + extraCostPrice, sig.riskDist, 1.0);
   if(sig.costFrac > InpMaxCostToRiskFrac && sig.refusal == GLS_REFUSE_NONE)
      sig.refusal = GLS_REFUSE_COST;

   //--- composantes communes
   double a5 = (ctx.st5.trend == dir) ? 1.0 : ((ctx.st5.trend == GLS_TREND_NONE) ? 0.5 : 0.0);
   double a15 = (ctx.st15.trend == dir) ? 1.0 : ((ctx.st15.trend == GLS_TREND_NONE) ? 0.5 : 0.0);
   sig.cAlign = 0.5 * a5 + 0.5 * a15;
   double ratio = SafeDiv(atr, ctx.AtrLong(), 1.0);
   if(ratio >= 0.8 && ratio <= 1.6)
      sig.cVol = 1.0;
   else
      sig.cVol = (ratio < 0.8) ? Ramp(ratio, 0.5, 0.8) : 1.0 - Ramp(ratio, 1.6, 3.0);
   sig.cCost = 1.0 - Ramp(sig.costFrac, 0.03, InpMaxCostToRiskFrac);
   sig.cRR = Ramp(sig.roomR, 1.0, 3.0);

   double wsum = InpWLiquidity + InpWTrigger + InpWStructure + InpWAlignment + InpWRetest + InpWVolatility + InpWCost + InpWRR;
   double total = InpWLiquidity * sig.cLiq + InpWTrigger * sig.cTrig + InpWStructure * sig.cStruct + InpWAlignment * sig.cAlign
                  + InpWRetest * sig.cRetest + InpWVolatility * sig.cVol + InpWCost * sig.cCost + InpWRR * sig.cRR;
   sig.score = Clamp(100.0 * SafeDiv(total, wsum, 0.0), 0.0, 100.0);
   if(sig.score < InpMinScore && sig.refusal == GLS_REFUSE_NONE)
      sig.refusal = GLS_REFUSE_SCORE;
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
