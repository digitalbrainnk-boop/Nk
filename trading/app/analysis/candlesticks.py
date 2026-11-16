"""Reconnaissance des figures de chandeliers japonais.

* ~40 figures natives vectorisées (NumPy), avec prise en compte du contexte de
  tendance (un marteau n'existe qu'après une baisse, un pendu après une hausse…) ;
* si TA-Lib est installé, ses 61 fonctions ``CDL*`` complètent la détection.

Ajouter une figure : écrire une fonction décorée par ``@pattern(...)`` qui renvoie un
tableau ``int8`` : ``+1`` haussier, ``-1`` baissier, ``2`` neutre, ``0`` absent.

Les marchés étudiés (indices synthétiques, Forex) sont continus : les « gaps » des
définitions classiques sont remplacés par des écarts entre **corps** de bougies.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass
from typing import Callable

import numpy as np
import pandas as pd

from ..core.models import CandlePatternHit, Direction
from .indicators import atr as atr_fn

log = logging.getLogger(__name__)

NEUTRAL = 2


class CandleContext:
    """Grandeurs pré-calculées communes à toutes les figures."""

    def __init__(self, o: np.ndarray, h: np.ndarray, l: np.ndarray, c: np.ndarray,
                 atr: np.ndarray | None = None) -> None:
        self.o, self.h, self.l, self.c = (np.asarray(a, dtype=float) for a in (o, h, l, c))
        self.n = len(self.c)
        self.body = np.abs(self.c - self.o)
        self.rng = np.maximum(self.h - self.l, 1e-12)
        self.top = np.maximum(self.o, self.c)
        self.bottom = np.minimum(self.o, self.c)
        self.upper = self.h - self.top
        self.lower = self.bottom - self.l
        self.mid = (self.o + self.c) / 2
        self.bull = self.c > self.o
        self.bear = self.c < self.o
        self.atr = atr if atr is not None else atr_fn(self.h, self.l, self.c, 14)
        # Moyennes des 10 bougies précédentes (la bougie courante est exclue).
        prev_body = pd.Series(self.body).shift(1).rolling(10, min_periods=3).mean().to_numpy()
        prev_rng = pd.Series(self.rng).shift(1).rolling(10, min_periods=3).mean().to_numpy()
        self.avg_body = np.where(np.isnan(prev_body), self.atr * 0.5, prev_body)
        self.avg_range = np.where(np.isnan(prev_rng), self.atr, prev_rng)
        # Tendance précédente : variation des 5 dernières clôtures en ATR.
        c5 = self.sh(self.c, 5)
        self.trend = np.where(np.isnan(c5), 0.0, (self.c - c5) / np.maximum(self.atr, 1e-12))
        # Qualificatifs usuels
        self.long_body = (self.body >= 1.2 * self.avg_body) & (self.body >= 0.5 * self.rng)
        self.short_body = self.body <= 0.6 * self.avg_body
        self.doji = (self.body <= 0.1 * self.rng) & (self.rng >= 0.4 * self.avg_range)

    @staticmethod
    def sh(a: np.ndarray, k: int) -> np.ndarray:
        """Décale vers la droite : ``out[i] = a[i-k]`` (``nan`` / ``False`` au début)."""
        if k == 0:
            return a
        out = np.empty_like(a, dtype=float if a.dtype != bool else bool)
        if a.dtype == bool:
            out[:k] = False
        else:
            out[:k] = np.nan
        out[k:] = a[:-k] if k < len(a) else []
        return out

    def down_before(self, k: int) -> np.ndarray:
        """Baisse avant la figure (mesurée sur la bougie ``i-k``)."""
        return self.sh(self.trend, k) < -0.5

    def up_before(self, k: int) -> np.ndarray:
        return self.sh(self.trend, k) > 0.5

    def near(self, a: np.ndarray, b: np.ndarray, factor: float = 0.1) -> np.ndarray:
        return np.abs(a - b) <= factor * self.avg_range


@dataclass(frozen=True)
class PatternDef:
    key: str
    name: str
    candles: int
    kind: str                 # "reversal" | "continuation" | "indecision"
    reliability: int          # 1 à 3
    func: Callable[[CandleContext], np.ndarray]
    bull_name: str | None = None
    bear_name: str | None = None

    def label(self, sign: int) -> str:
        if sign == 1:
            return self.bull_name or f"{self.name} haussier"
        if sign == -1:
            return self.bear_name or f"{self.name} baissier"
        return self.name


PATTERNS: dict[str, PatternDef] = {}


def pattern(key: str, name: str, candles: int, kind: str, reliability: int,
            bull: str | None = None, bear: str | None = None):
    def deco(fn: Callable[[CandleContext], np.ndarray]):
        PATTERNS[key] = PatternDef(key, name, candles, kind, reliability, fn, bull, bear)
        return fn
    return deco


def _sig(bull: np.ndarray | None = None, bear: np.ndarray | None = None,
         neutral: np.ndarray | None = None) -> np.ndarray:
    n = len(next(a for a in (bull, bear, neutral) if a is not None))
    out = np.zeros(n, dtype=np.int8)
    if neutral is not None:
        out[np.asarray(neutral, dtype=bool)] = NEUTRAL
    if bear is not None:
        out[np.asarray(bear, dtype=bool)] = -1
    if bull is not None:
        out[np.asarray(bull, dtype=bool)] = 1
    return out


# =============================================================================
# Figures à une bougie
# =============================================================================

@pattern("doji", "Doji", 1, "indecision", 1)
def _doji(x: CandleContext):
    special = ((x.upper <= 0.1 * x.rng) & (x.lower >= 0.6 * x.rng)) | \
              ((x.lower <= 0.1 * x.rng) & (x.upper >= 0.6 * x.rng)) | \
              ((x.upper >= 0.35 * x.rng) & (x.lower >= 0.35 * x.rng) & (x.rng >= x.avg_range))
    return _sig(neutral=x.doji & ~special)


@pattern("long_legged_doji", "Doji à longues jambes", 1, "indecision", 1)
def _long_legged_doji(x: CandleContext):
    return _sig(neutral=x.doji & (x.upper >= 0.35 * x.rng) & (x.lower >= 0.35 * x.rng) & (x.rng >= x.avg_range))


@pattern("dragonfly_doji", "Doji libellule", 1, "reversal", 2,
         bull="Doji libellule", bear="Doji libellule (sommet)")
def _dragonfly(x: CandleContext):
    shape = x.doji & (x.upper <= 0.1 * x.rng) & (x.lower >= 0.6 * x.rng)
    return _sig(bull=shape & x.down_before(1), bear=shape & x.up_before(1),
                neutral=shape)


@pattern("gravestone_doji", "Doji pierre tombale", 1, "reversal", 2,
         bull="Doji pierre tombale (creux)", bear="Doji pierre tombale")
def _gravestone(x: CandleContext):
    shape = x.doji & (x.lower <= 0.1 * x.rng) & (x.upper >= 0.6 * x.rng)
    return _sig(bear=shape & x.up_before(1), bull=shape & x.down_before(1), neutral=shape)


def _hammer_shape(x: CandleContext):
    return ((x.lower >= 2.0 * x.body) & (x.upper <= 0.15 * x.rng) & (x.body >= 0.05 * x.rng)
            & (x.rng >= 0.8 * x.avg_range))


def _inverted_shape(x: CandleContext):
    return ((x.upper >= 2.0 * x.body) & (x.lower <= 0.15 * x.rng) & (x.body >= 0.05 * x.rng)
            & (x.rng >= 0.8 * x.avg_range))


@pattern("hammer", "Marteau", 1, "reversal", 2, bull="Marteau")
def _hammer(x: CandleContext):
    return _sig(bull=_hammer_shape(x) & x.down_before(1))


@pattern("hanging_man", "Pendu", 1, "reversal", 1, bear="Pendu")
def _hanging_man(x: CandleContext):
    return _sig(bear=_hammer_shape(x) & x.up_before(1))


@pattern("inverted_hammer", "Marteau inversé", 1, "reversal", 1, bull="Marteau inversé")
def _inverted_hammer(x: CandleContext):
    return _sig(bull=_inverted_shape(x) & x.down_before(1))


@pattern("shooting_star", "Étoile filante", 1, "reversal", 2, bear="Étoile filante")
def _shooting_star(x: CandleContext):
    return _sig(bear=_inverted_shape(x) & x.up_before(1))


@pattern("marubozu", "Marubozu", 1, "continuation", 2)
def _marubozu(x: CandleContext):
    shape = (x.body >= 0.92 * x.rng) & (x.body >= 1.3 * x.avg_body)
    return _sig(bull=shape & x.bull, bear=shape & x.bear)


@pattern("spinning_top", "Toupie", 1, "indecision", 1)
def _spinning_top(x: CandleContext):
    return _sig(neutral=(x.body <= 0.3 * x.rng) & (x.body > 0.1 * x.rng) & (x.upper > x.body)
                & (x.lower > x.body) & (x.rng >= 0.6 * x.avg_range))


@pattern("belt_hold", "Ceinture (Belt Hold)", 1, "reversal", 1,
         bull="Ceinture haussière", bear="Ceinture baissière")
def _belt_hold(x: CandleContext):
    return _sig(bull=x.bull & x.long_body & (x.lower <= 0.03 * x.rng) & (x.upper > 0.03 * x.rng) & x.down_before(1),
                bear=x.bear & x.long_body & (x.upper <= 0.03 * x.rng) & (x.lower > 0.03 * x.rng) & x.up_before(1))


# =============================================================================
# Figures à deux bougies (bougie précédente = suffixe 1)
# =============================================================================

def _prev(x: CandleContext):
    s = x.sh
    return s(x.o, 1), s(x.h, 1), s(x.l, 1), s(x.c, 1), s(x.body, 1), s(x.bull, 1), s(x.bear, 1)


@pattern("engulfing", "Avalement", 2, "reversal", 2)
def _engulfing(x: CandleContext):
    o1, h1, l1, c1, b1, bull1, bear1 = _prev(x)
    significant = (b1 >= 0.1 * x.sh(x.rng, 1)) & (x.body >= 0.8 * x.avg_body)
    bull = bear1 & x.bull & (x.c >= o1) & (x.o <= c1) & (x.body > b1) & significant & x.down_before(1)
    bear = bull1 & x.bear & (x.c <= o1) & (x.o >= c1) & (x.body > b1) & significant & x.up_before(1)
    return _sig(bull=bull, bear=bear)


@pattern("harami", "Harami", 2, "reversal", 1)
def _harami(x: CandleContext):
    o1, h1, l1, c1, b1, bull1, bear1 = _prev(x)
    long1 = x.sh(x.long_body, 1)
    inside_bear = (x.top <= o1) & (x.bottom >= c1)
    inside_bull = (x.top <= c1) & (x.bottom >= o1)
    small = (x.body <= 0.6 * b1) & ~x.doji
    return _sig(bull=bear1 & long1 & inside_bear & small & x.down_before(1),
                bear=bull1 & long1 & inside_bull & small & x.up_before(1))


@pattern("harami_cross", "Harami cross", 2, "reversal", 2)
def _harami_cross(x: CandleContext):
    o1, h1, l1, c1, b1, bull1, bear1 = _prev(x)
    long1 = x.sh(x.long_body, 1)
    return _sig(bull=bear1 & long1 & x.doji & (x.top <= o1) & (x.bottom >= c1) & x.down_before(1),
                bear=bull1 & long1 & x.doji & (x.top <= c1) & (x.bottom >= o1) & x.up_before(1))


@pattern("piercing", "Ligne pénétrante", 2, "reversal", 2, bull="Ligne pénétrante")
def _piercing(x: CandleContext):
    o1, h1, l1, c1, b1, bull1, bear1 = _prev(x)
    long1 = x.sh(x.long_body, 1)
    return _sig(bull=bear1 & long1 & x.bull & (x.o <= c1 + 0.05 * x.avg_range)
                & (x.c > c1 + 0.5 * b1) & (x.c < o1) & x.down_before(1))


@pattern("dark_cloud_cover", "Couverture en nuage noir", 2, "reversal", 2, bear="Couverture en nuage noir")
def _dark_cloud(x: CandleContext):
    o1, h1, l1, c1, b1, bull1, bear1 = _prev(x)
    long1 = x.sh(x.long_body, 1)
    return _sig(bear=bull1 & long1 & x.bear & (x.o >= c1 - 0.05 * x.avg_range)
                & (x.c < c1 - 0.5 * b1) & (x.c > o1) & x.up_before(1))


@pattern("tweezer", "Pinces (Tweezer)", 2, "reversal", 1, bull="Creux en pinces", bear="Sommet en pinces")
def _tweezer(x: CandleContext):
    o1, h1, l1, c1, b1, bull1, bear1 = _prev(x)
    sized = (b1 >= 0.3 * x.avg_body) & (x.body >= 0.3 * x.avg_body)
    return _sig(bull=bear1 & x.bull & x.near(x.l, l1, 0.05) & sized & x.down_before(1),
                bear=bull1 & x.bear & x.near(x.h, h1, 0.05) & sized & x.up_before(1))


@pattern("kicker", "Kicker", 2, "reversal", 3)
def _kicker(x: CandleContext):
    o1, h1, l1, c1, b1, bull1, bear1 = _prev(x)
    long1 = x.sh(x.long_body, 1)
    return _sig(bull=bear1 & long1 & x.bull & x.long_body & (x.o > o1),
                bear=bull1 & long1 & x.bear & x.long_body & (x.o < o1))


@pattern("counterattack", "Contre-attaque", 2, "reversal", 1)
def _counterattack(x: CandleContext):
    o1, h1, l1, c1, b1, bull1, bear1 = _prev(x)
    long1 = x.sh(x.long_body, 1)
    eq = x.near(x.c, c1, 0.05)
    return _sig(bull=bear1 & long1 & x.bull & x.long_body & eq & x.down_before(1),
                bear=bull1 & long1 & x.bear & x.long_body & eq & x.up_before(1))


@pattern("homing_pigeon", "Pigeon voyageur", 2, "reversal", 1, bull="Pigeon voyageur")
def _homing_pigeon(x: CandleContext):
    o1, h1, l1, c1, b1, bull1, bear1 = _prev(x)
    long1 = x.sh(x.long_body, 1)
    return _sig(bull=bear1 & long1 & x.bear & (x.o < o1) & (x.c > c1) & (x.body <= 0.7 * b1) & x.down_before(1))


@pattern("matching_low", "Creux identiques", 2, "reversal", 1, bull="Creux identiques (Matching Low)")
def _matching_low(x: CandleContext):
    o1, h1, l1, c1, b1, bull1, bear1 = _prev(x)
    return _sig(bull=bear1 & x.bear & x.near(x.c, c1, 0.03) & (b1 >= x.avg_body) & x.down_before(1))


# =============================================================================
# Figures à trois bougies et plus (i-2 = première bougie)
# =============================================================================

@pattern("morning_star", "Étoile du matin", 3, "reversal", 3, bull="Étoile du matin", bear="Étoile du soir")
def _star(x: CandleContext):
    s = x.sh
    o2, c2, b2 = s(x.o, 2), s(x.c, 2), s(x.body, 2)
    long2 = s(x.long_body, 2)
    top1, bot1 = s(x.top, 1), s(x.bottom, 1)
    short1 = s(x.short_body, 1) & ~s(x.doji, 1)
    bull = (s(x.bear, 2) & long2 & short1 & (top1 <= c2 + 0.1 * x.avg_body) & x.bull
            & (x.c > c2 + 0.5 * b2) & x.down_before(2))
    bear = (s(x.bull, 2) & long2 & short1 & (bot1 >= c2 - 0.1 * x.avg_body) & x.bear
            & (x.c < c2 - 0.5 * b2) & x.up_before(2))
    return _sig(bull=bull, bear=bear)


@pattern("doji_star", "Étoile doji", 3, "reversal", 3, bull="Étoile doji du matin", bear="Étoile doji du soir")
def _doji_star(x: CandleContext):
    s = x.sh
    c2, b2 = s(x.c, 2), s(x.body, 2)
    long2 = s(x.long_body, 2)
    doji1 = s(x.doji, 1)
    top1, bot1 = s(x.top, 1), s(x.bottom, 1)
    bull = s(x.bear, 2) & long2 & doji1 & (top1 <= c2 + 0.05 * x.avg_body) & x.bull & (x.c > c2 + 0.5 * b2) & x.down_before(2)
    bear = s(x.bull, 2) & long2 & doji1 & (bot1 >= c2 - 0.05 * x.avg_body) & x.bear & (x.c < c2 - 0.5 * b2) & x.up_before(2)
    return _sig(bull=bull, bear=bear)


@pattern("abandoned_baby", "Bébé abandonné", 3, "reversal", 3)
def _abandoned_baby(x: CandleContext):
    s = x.sh
    doji1 = s(x.doji, 1)
    h1, l1 = s(x.h, 1), s(x.l, 1)
    bull = s(x.bear, 2) & s(x.long_body, 2) & doji1 & (h1 < s(x.l, 2)) & x.bull & (x.l > h1) & x.down_before(2)
    bear = s(x.bull, 2) & s(x.long_body, 2) & doji1 & (l1 > s(x.h, 2)) & x.bear & (x.h < l1) & x.up_before(2)
    return _sig(bull=bull, bear=bear)


@pattern("three_soldiers_crows", "Trois soldats / corbeaux", 3, "reversal", 2,
         bull="Trois soldats blancs", bear="Trois corbeaux noirs")
def _three_soldiers(x: CandleContext):
    s = x.sh
    sized = [s(x.body, k) >= 0.7 * x.avg_body for k in (2, 1, 0)]
    bulls = s(x.bull, 2) & s(x.bull, 1) & x.bull
    bears = s(x.bear, 2) & s(x.bear, 1) & x.bear
    rising = (s(x.c, 1) > s(x.c, 2)) & (x.c > s(x.c, 1))
    falling = (s(x.c, 1) < s(x.c, 2)) & (x.c < s(x.c, 1))
    opens_in_bull = (s(x.o, 1) >= s(x.o, 2)) & (s(x.o, 1) <= s(x.c, 2)) & (x.o >= s(x.o, 1)) & (x.o <= s(x.c, 1))
    opens_in_bear = (s(x.o, 1) <= s(x.o, 2)) & (s(x.o, 1) >= s(x.c, 2)) & (x.o <= s(x.o, 1)) & (x.o >= s(x.c, 1))
    small_upper = (s(x.upper, 1) <= 0.35 * s(x.body, 1)) & (x.upper <= 0.35 * x.body)
    small_lower = (s(x.lower, 1) <= 0.35 * s(x.body, 1)) & (x.lower <= 0.35 * x.body)
    all_sized = sized[0] & sized[1] & sized[2]
    return _sig(bull=bulls & rising & opens_in_bull & small_upper & all_sized,
                bear=bears & falling & opens_in_bear & small_lower & all_sized)


@pattern("three_inside", "Trois à l'intérieur", 3, "reversal", 2,
         bull="Trois à l'intérieur haussier", bear="Trois à l'intérieur baissier")
def _three_inside(x: CandleContext):
    s = x.sh
    o2, c2 = s(x.o, 2), s(x.c, 2)
    long2 = s(x.long_body, 2)
    top1, bot1, b1 = s(x.top, 1), s(x.bottom, 1), s(x.body, 1)
    bull = (s(x.bear, 2) & long2 & (top1 <= o2) & (bot1 >= c2) & (b1 <= 0.6 * s(x.body, 2))
            & x.bull & (x.c > o2 - 0.25 * s(x.body, 2)) & (x.c > s(x.c, 1)) & x.down_before(2))
    bear = (s(x.bull, 2) & long2 & (top1 <= c2) & (bot1 >= o2) & (b1 <= 0.6 * s(x.body, 2))
            & x.bear & (x.c < o2 + 0.25 * s(x.body, 2)) & (x.c < s(x.c, 1)) & x.up_before(2))
    return _sig(bull=bull, bear=bear)


@pattern("three_outside", "Trois à l'extérieur", 3, "reversal", 2,
         bull="Trois à l'extérieur haussier", bear="Trois à l'extérieur baissier")
def _three_outside(x: CandleContext):
    s = x.sh
    o2, c2, b2 = s(x.o, 2), s(x.c, 2), s(x.body, 2)
    o1, c1, b1 = s(x.o, 1), s(x.c, 1), s(x.body, 1)
    bull = (s(x.bear, 2) & s(x.bull, 1) & (c1 >= o2) & (o1 <= c2) & (b1 > b2) & x.bull & (x.c > c1) & x.down_before(2))
    bear = (s(x.bull, 2) & s(x.bear, 1) & (c1 <= o2) & (o1 >= c2) & (b1 > b2) & x.bear & (x.c < c1) & x.up_before(2))
    return _sig(bull=bull, bear=bear)


@pattern("tri_star", "Tri-étoile", 3, "reversal", 2)
def _tri_star(x: CandleContext):
    s = x.sh
    dojis = s(x.doji, 2) & s(x.doji, 1) & x.doji
    mid_low = (s(x.top, 1) < s(x.bottom, 2)) & (s(x.top, 1) < x.bottom)
    mid_high = (s(x.bottom, 1) > s(x.top, 2)) & (s(x.bottom, 1) > x.top)
    return _sig(bull=dojis & mid_low & x.down_before(2), bear=dojis & mid_high & x.up_before(2))


@pattern("stick_sandwich", "Sandwich", 3, "reversal", 1, bull="Sandwich haussier", bear="Sandwich baissier")
def _stick_sandwich(x: CandleContext):
    s = x.sh
    bull = s(x.bear, 2) & s(x.bull, 1) & x.bear & (s(x.bottom, 1) > s(x.c, 2)) & x.near(x.c, s(x.c, 2), 0.03) & x.down_before(2)
    bear = s(x.bull, 2) & s(x.bear, 1) & x.bull & (s(x.top, 1) < s(x.c, 2)) & x.near(x.c, s(x.c, 2), 0.03) & x.up_before(2)
    return _sig(bull=bull, bear=bear)


@pattern("advance_block", "Blocage de progression", 3, "reversal", 1, bear="Blocage de progression")
def _advance_block(x: CandleContext):
    s = x.sh
    bulls = s(x.bull, 2) & s(x.bull, 1) & x.bull
    higher = (s(x.c, 1) > s(x.c, 2)) & (x.c > s(x.c, 1))
    shrinking = (s(x.body, 1) < s(x.body, 2)) & (x.body < s(x.body, 1))
    wicks = (x.upper > 0.5 * x.body) & (s(x.upper, 1) > 0.3 * s(x.body, 1))
    return _sig(bear=bulls & higher & shrinking & wicks & s(x.long_body, 2) & x.up_before(2))


@pattern("three_line_strike", "Three Line Strike", 4, "reversal", 2,
         bull="Three Line Strike haussier", bear="Three Line Strike baissier")
def _three_line_strike(x: CandleContext):
    s = x.sh
    bears3 = s(x.bear, 3) & s(x.bear, 2) & s(x.bear, 1) & (s(x.c, 2) < s(x.c, 3)) & (s(x.c, 1) < s(x.c, 2))
    bulls3 = s(x.bull, 3) & s(x.bull, 2) & s(x.bull, 1) & (s(x.c, 2) > s(x.c, 3)) & (s(x.c, 1) > s(x.c, 2))
    bull = bears3 & x.bull & (x.o <= s(x.c, 1) + 0.05 * x.avg_range) & (x.c > s(x.o, 3))
    bear = bulls3 & x.bear & (x.o >= s(x.c, 1) - 0.05 * x.avg_range) & (x.c < s(x.o, 3))
    return _sig(bull=bull, bear=bear)


@pattern("three_methods", "Méthode des trois", 5, "continuation", 2,
         bull="Méthode des trois hausses", bear="Méthode des trois baisses")
def _three_methods(x: CandleContext):
    s = x.sh
    h4, l4, o4, c4 = s(x.h, 4), s(x.l, 4), s(x.o, 4), s(x.c, 4)
    inside = np.ones(x.n, dtype=bool)
    small = np.ones(x.n, dtype=bool)
    for k in (3, 2, 1):
        inside &= (s(x.h, k) <= h4) & (s(x.l, k) >= l4)
        small &= s(x.body, k) <= 0.6 * s(x.body, 4)
    bull = s(x.bull, 4) & s(x.long_body, 4) & inside & small & x.bull & x.long_body & (x.c > c4)
    bear = s(x.bear, 4) & s(x.long_body, 4) & inside & small & x.bear & x.long_body & (x.c < c4)
    return _sig(bull=bull, bear=bear)


# =============================================================================
# Passerelle TA-Lib (optionnelle)
# =============================================================================

try:  # pragma: no cover - dépend de l'installation
    import talib  # type: ignore
    _TALIB_FUNCS = [f for f in talib.get_function_groups().get("Pattern Recognition", [])]
except Exception:  # ImportError ou bibliothèque C absente
    talib = None
    _TALIB_FUNCS = []

# Fonctions TA-Lib déjà couvertes par une figure native (évite les doublons).
_TALIB_COVERED = {
    "CDLDOJI", "CDLLONGLEGGEDDOJI", "CDLDRAGONFLYDOJI", "CDLGRAVESTONEDOJI", "CDLHAMMER",
    "CDLHANGINGMAN", "CDLINVERTEDHAMMER", "CDLSHOOTINGSTAR", "CDLMARUBOZU", "CDLSPINNINGTOP",
    "CDLBELTHOLD", "CDLENGULFING", "CDLHARAMI", "CDLHARAMICROSS", "CDLPIERCING",
    "CDLDARKCLOUDCOVER", "CDLKICKING", "CDLCOUNTERATTACK", "CDLHOMINGPIGEON", "CDLMATCHINGLOW",
    "CDLMORNINGSTAR", "CDLEVENINGSTAR", "CDLMORNINGDOJISTAR", "CDLEVENINGDOJISTAR",
    "CDLABANDONEDBABY", "CDL3WHITESOLDIERS", "CDL3BLACKCROWS", "CDL3INSIDE", "CDL3OUTSIDE",
    "CDLTRISTAR", "CDLSTICKSANDWICH", "CDLADVANCEBLOCK", "CDL3LINESTRIKE", "CDLRISEFALL3METHODS",
}


def talib_available() -> bool:
    return talib is not None


def _talib_hits(ctx: CandleContext) -> dict[str, np.ndarray]:
    out: dict[str, np.ndarray] = {}
    if talib is None:
        return out
    for fname in _TALIB_FUNCS:
        if fname in _TALIB_COVERED:
            continue
        try:
            res = getattr(talib, fname)(ctx.o, ctx.h, ctx.l, ctx.c)
        except Exception:  # pragma: no cover
            continue
        out[fname] = np.sign(res).astype(np.int8)
    return out


def _talib_label(fname: str) -> str:
    return fname.replace("CDL", "").replace("3", "Three ").title().strip()


# =============================================================================
# API
# =============================================================================

def detect(df_or_arrays, lookback: int = 300, use_talib: bool = True,
           atr: np.ndarray | None = None) -> list[CandlePatternHit]:
    """Détecte toutes les figures sur les ``lookback`` dernières bougies.

    ``df_or_arrays`` : DataFrame (open/high/low/close/time) ou tuple (o, h, l, c, times).
    """
    if isinstance(df_or_arrays, pd.DataFrame):
        df = df_or_arrays
        o, h, l, c = (df[k].to_numpy(dtype=float) for k in ("open", "high", "low", "close"))
        times = df["time"].to_numpy(dtype=np.int64)
    else:
        o, h, l, c, times = df_or_arrays
    n = len(c)
    if n < 6:
        return []
    ctx = CandleContext(o, h, l, c, atr)
    start = max(0, n - lookback)
    hits: list[CandlePatternHit] = []
    for pdef in PATTERNS.values():
        try:
            res = pdef.func(ctx)
        except Exception as exc:  # une figure défaillante ne doit pas bloquer l'analyse
            log.exception("figure %s : %s", pdef.key, exc)
            continue
        idx = np.flatnonzero(res[start:]) + start
        for i in idx:
            sign = int(res[i])
            direction = Direction.NEUTRAL if sign == NEUTRAL else Direction.from_sign(sign)
            hits.append(CandlePatternHit(int(times[i]), int(i), pdef.key, pdef.label(sign if sign != NEUTRAL else 0),
                                         direction, pdef.kind if sign != NEUTRAL else "indecision",
                                         pdef.reliability if sign != NEUTRAL else 1, pdef.candles))
    if use_talib:
        for fname, res in _talib_hits(ctx).items():
            idx = np.flatnonzero(res[start:]) + start
            for i in idx:
                sign = int(res[i])
                hits.append(CandlePatternHit(int(times[i]), int(i), f"talib_{fname.lower()}",
                                             f"{_talib_label(fname)} ({'haussier' if sign > 0 else 'baissier'})",
                                             Direction.from_sign(sign), "reversal", 1, 1))
    hits.sort(key=lambda hh: (hh.index, -hh.reliability, -hh.candles))
    return hits


def catalog() -> list[dict]:
    """Liste des figures reconnues (pour l'aide de l'interface)."""
    items = [{"key": p.key, "name": p.name, "candles": p.candles, "kind": p.kind,
              "reliability": p.reliability, "source": "natif"} for p in PATTERNS.values()]
    items += [{"key": f"talib_{f.lower()}", "name": _talib_label(f), "candles": None, "kind": "reversal",
               "reliability": 1, "source": "TA-Lib"} for f in _TALIB_FUNCS if f not in _TALIB_COVERED]
    return items
