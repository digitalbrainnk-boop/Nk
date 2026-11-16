"""Orchestration de l'analyse d'un couple (instrument, unité de temps).

Entrée : les bougies **clôturées** (DataFrame pandas). Sortie : un instantané
(``AnalysisSnapshot``) contenant chandeliers, pivots, figures, niveaux, tendance
et signaux — directement sérialisable pour l'interface.
"""

from __future__ import annotations

import time
from dataclasses import dataclass, field
from typing import Any

import numpy as np
import pandas as pd

from ..config import AnalysisSettings
from ..core.models import CandlePatternHit, ChartPattern, Level, Pivot, Signal, TrendState
from ..core.timeframes import Timeframe
from . import candlesticks, chart_patterns, indicators as ind, levels as lv_mod, signals as sig_mod, trend as trend_mod
from .zigzag import simplify, zigzag


@dataclass
class AnalysisSnapshot:
    symbol: str
    timeframe: str
    bar_time: int = 0
    price: float | None = None
    times: list[int] = field(default_factory=list)
    candle_patterns: list[CandlePatternHit] = field(default_factory=list)
    chart_patterns: list[ChartPattern] = field(default_factory=list)
    levels: list[Level] = field(default_factory=list)
    htf_levels: list[Level] = field(default_factory=list)
    minor: list[Pivot] = field(default_factory=list)
    major: list[Pivot] = field(default_factory=list)
    trend: TrendState | None = None
    signals: list[Signal] = field(default_factory=list)
    ema: dict[str, list[list[float]]] = field(default_factory=dict)
    atr: float = 0.0
    computed_ms: float = 0.0

    def to_dict(self) -> dict[str, Any]:
        return {
            "symbol": self.symbol, "tf": self.timeframe, "bar_time": self.bar_time, "price": self.price,
            "atr": self.atr, "computed_ms": round(self.computed_ms, 1),
            "candle_patterns": [h.to_dict() for h in self.candle_patterns],
            "chart_patterns": [p.to_dict(self.times) for p in self.chart_patterns],
            "levels": [lv.to_dict() for lv in self.levels],
            "htf_levels": [lv.to_dict() for lv in self.htf_levels],
            "pivots": [p.to_dict() for p in self.major],
            "zigzag": [p.to_dict() for p in self.minor[-60:]],
            "trend": self.trend.to_dict() if self.trend else None,
            "signals": [s.to_dict() for s in self.signals],
            "ema": self.ema,
        }


class AnalysisEngine:
    def __init__(self, settings: AnalysisSettings | None = None, mtf_weights: dict[str, float] | None = None) -> None:
        self.settings = settings or AnalysisSettings()
        self.mtf_weights = mtf_weights or {}

    def analyze(self, symbol: str, tf: Timeframe, df: pd.DataFrame, trends: dict[str, TrendState] | None = None,
                htf_levels: list[Level] | None = None, previous: AnalysisSnapshot | None = None,
                digits: int = 5) -> AnalysisSnapshot:
        t0 = time.perf_counter()
        snap = AnalysisSnapshot(symbol, tf.value)
        n = len(df)
        if n < 30:
            return snap
        o, h, l, c = (df[k].to_numpy(dtype=float) for k in ("open", "high", "low", "close"))
        times = df["time"].to_numpy(dtype=np.int64)
        atr = ind.atr(h, l, c, 14)
        s = self.settings

        minor = zigzag(h, l, times, s.zigzag_atr * atr)
        major = simplify(minor, s.rdp_atr * float(atr[-1]))
        hits = candlesticks.detect((o, h, l, c, times), lookback=300, use_talib=s.use_talib, atr=atr)
        bars = chart_patterns.Bars(o, h, l, c, times, atr)
        patterns = chart_patterns.detect(bars, [major, minor], tol_k=s.equal_tolerance_atr,
                                        recent_bars=120, max_patterns=5)
        levels = lv_mod.find_levels(h, l, c, times, float(atr[-1]), minor, major, s.max_levels, tf.value)
        trend = trend_mod.evaluate(tf.value, h, l, c, atr, minor, updated=int(times[-1]))

        # Niveaux tels qu'ils existaient AVANT la dernière bougie (pour détecter sa cassure).
        prev_minor = [p for p in minor if p.index < n - 1]
        prev_major = [p for p in major if p.index < n - 1]
        levels_before = lv_mod.find_levels(h[:-1], l[:-1], c[:-1], times[:-1], float(atr[-2]),
                                           prev_minor, prev_major, s.max_levels, tf.value)

        all_trends = dict(trends or {})
        all_trends[tf.value] = trend
        rsi = ind.last(ind.rsi(c, 14))
        ctx = sig_mod.SignalContext(symbol, tf, n - 1, int(times[-1]), o[-1], h[-1], l[-1], c[-1], float(atr[-1]),
                                    rsi, levels_before, htf_levels or [], all_trends, self.mtf_weights, digits)
        prev_ids = {p.id for p in previous.chart_patterns} if previous is not None else None
        signals = (sig_mod.candle_signals(ctx, hits) + sig_mod.level_signals(ctx, o, h, l, c)
                   + sig_mod.pattern_signals(ctx, patterns, prev_ids))
        signals.sort(key=lambda x: -x.score)

        ema = {}
        for period in (20, 50, 200):
            vals = ind.ema(c, period)
            mask = ~np.isnan(vals)
            ema[f"ema{period}"] = [[int(t), round(float(v), digits + 2)] for t, v in zip(times[mask], vals[mask])]

        snap.bar_time = int(times[-1])
        snap.price = float(c[-1])
        snap.times = [int(t) for t in times]
        snap.candle_patterns = hits
        snap.chart_patterns = patterns
        snap.levels = levels
        snap.htf_levels = list(htf_levels or [])
        snap.minor, snap.major = minor, major
        snap.trend = trend
        snap.signals = signals
        snap.ema = ema
        snap.atr = float(atr[-1])
        snap.computed_ms = (time.perf_counter() - t0) * 1000
        return snap


def select_htf_levels(snapshots: dict[str, AnalysisSnapshot], tf: Timeframe, price: float | None) -> list[Level]:
    """Pour chaque UT supérieure (H1, H4, D1) : la résistance la plus proche au-dessus du
    prix et le support le plus proche au-dessous. Les doublons (même zone) sont fusionnés
    au profit de l'unité de temps la plus élevée."""
    out: list[Level] = []
    if price is None:
        return out
    for higher in sorted(tf.higher(), key=lambda t: -t.seconds):
        if higher not in (Timeframe.H1, Timeframe.H4, Timeframe.D1):
            continue
        snap = snapshots.get(higher.value)
        if snap is None or not snap.levels:
            continue
        above = [lv for lv in snap.levels if lv.low > price]
        below = [lv for lv in snap.levels if lv.high < price]
        for group, key in ((above, lambda lv: lv.low - price), (below, lambda lv: price - lv.high)):
            if not group:
                continue
            lv = min(group, key=key)
            if any(o.low <= lv.price <= o.high or lv.low <= o.price <= lv.high for o in out):
                continue
            out.append(lv)
    return out
