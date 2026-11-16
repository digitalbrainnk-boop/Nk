"""Évaluation de la tendance d'une unité de temps (score de -1 à +1)."""

from __future__ import annotations

import numpy as np

from ..core.models import Pivot, TrendState
from . import indicators as ind


def market_structure(pivots: list[Pivot]) -> tuple[str, float]:
    """Structure de marché : plus hauts/plus bas croissants (HH/HL) ou décroissants (LH/LL)."""
    highs = [p.price for p in pivots if p.kind == "H"][-2:]
    lows = [p.price for p in pivots if p.kind == "L"][-2:]
    if len(highs) < 2 or len(lows) < 2:
        return "indéterminée", 0.0
    hh, hl = highs[1] > highs[0], lows[1] > lows[0]
    if hh and hl:
        return "HH/HL", 1.0
    if not hh and not hl:
        return "LH/LL", -1.0
    return "mixte", 0.0


def label(score: float) -> str:
    if score >= 0.6:
        return "Haussier fort"
    if score >= 0.2:
        return "Haussier"
    if score <= -0.6:
        return "Baissier fort"
    if score <= -0.2:
        return "Baissier"
    return "Neutre"


def evaluate(timeframe: str, h: np.ndarray, l: np.ndarray, c: np.ndarray, atr: np.ndarray,
             pivots: list[Pivot], updated: int = 0) -> TrendState:
    n = len(c)
    if n < 30:
        return TrendState(timeframe, 0.0, "Données insuffisantes", "indéterminée", None, None, None,
                          None, None, ind.last(atr), None, float(c[-1]) if n else None, updated)
    e20, e50 = ind.ema(c, 20), ind.ema(c, 50)
    e200 = ind.ema(c, 200) if n >= 200 else np.full(n, np.nan)
    rsi = ind.rsi(c, 14)
    adx, pdi, mdi = ind.adx(h, l, c, 14)
    a = float(atr[-1]) or 1e-12
    price = float(c[-1])

    comps: list[tuple[float, float]] = []          # (valeur dans [-1, 1], poids)
    if not np.isnan(e50[-1]):
        comps.append((float(np.clip((price - e50[-1]) / (2 * a), -1, 1)), 1.0))
        comps.append((1.0 if e20[-1] > e50[-1] else -1.0, 1.0))
        sl = ind.slope(e50, 10)[-1]
        if not np.isnan(sl):
            comps.append((float(np.clip(sl * 10 / a, -1, 1)), 1.2))
    if not np.isnan(e200[-1]):
        comps.append((1.0 if price > e200[-1] else -1.0, 0.8))
    structure, st_score = market_structure(pivots)
    comps.append((st_score, 1.2))
    if not np.isnan(pdi[-1]) and not np.isnan(mdi[-1]):
        comps.append((float(np.clip((pdi[-1] - mdi[-1]) / 25, -1, 1)), 0.6))

    score = sum(v * w for v, w in comps) / sum(w for _, w in comps)
    # Un ADX faible (marché sans tendance) atténue le score.
    adx_last = ind.last(adx)
    if adx_last is not None and adx_last < 18:
        score *= 0.75
    score = float(np.clip(score, -1, 1))
    return TrendState(
        timeframe=timeframe, score=round(score, 3), label=label(score), structure=structure,
        ema_fast=ind.last(e20), ema_slow=ind.last(e50), ema_long=ind.last(e200), rsi=ind.last(rsi),
        adx=adx_last, atr=a, atr_percentile=ind.percentile_rank(atr), close=price, updated=updated,
    )
