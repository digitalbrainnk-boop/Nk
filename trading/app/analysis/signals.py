"""Moteur de signaux : combine chandeliers, niveaux et figures chartistes en signaux
notés de 0 à 100, puis évalue le risque multi-temporel de chacun.

Barème indicatif :
* retournement en chandelier : 30-60 selon la fiabilité, + bonus s'il se forme sur
  un support/une résistance, si plusieurs figures concordent, si le RSI est extrême ;
* cassure de niveau : 45-90 selon la qualité de la bougie et la force du niveau ;
* rejet de niveau (longue mèche) : 35-80 ;
* figure chartiste confirmée (cassure) : 60-95 selon la confiance de la figure.
Un signal est « fort » à partir de 70.
"""

from __future__ import annotations

from dataclasses import dataclass

from ..core.models import (CandlePatternHit, ChartPattern, Direction, Level, Signal, TrendState)
from ..core.timeframes import Timeframe
from . import levels as lv_mod
from . import mtf


# (score de base, amplitude selon la confiance) par famille de figure
PATTERN_WEIGHT = {"double": (60, 35), "hs": (62, 35), "triangle": (58, 35), "wedge": (58, 35),
                  "flag": (58, 35), "channel": (50, 30), "broadening": (42, 25)}


@dataclass
class SignalContext:
    symbol: str
    tf: Timeframe
    index: int                 # index de la bougie clôturée analysée
    time: int
    o: float
    h: float
    l: float
    c: float
    atr: float
    rsi: float | None
    levels: list[Level]
    htf_levels: list[Level]
    trends: dict[str, TrendState]
    weights: dict[str, float]
    digits: int = 5

    def fmt(self, price: float) -> str:
        return f"{price:.{self.digits}f}"


def _risk(ctx: SignalContext, direction: Direction, stop: float | None = None, target: float | None = None):
    return mtf.assess(direction, ctx.tf, ctx.c, ctx.atr, ctx.trends, ctx.levels, ctx.htf_levels,
                      stop_hint=stop, target_hint=target, weights=ctx.weights)


def candle_signals(ctx: SignalContext, hits: list[CandlePatternHit]) -> list[Signal]:
    out: list[Signal] = []
    last = [h for h in hits if h.index == ctx.index and h.direction != Direction.NEUTRAL and h.kind == "reversal"]
    for direction in (Direction.BULLISH, Direction.BEARISH):
        group = [h for h in last if h.direction == direction]
        if not group:
            continue
        best = max(group, key=lambda h: (h.reliability, h.candles))
        score = 15 + 15 * best.reliability
        notes = []
        kind = "support" if direction == Direction.BULLISH else "resistance"
        level = lv_mod.at_level(ctx.levels, ctx.l, ctx.h, ctx.atr, kind)
        htf = lv_mod.at_level(ctx.htf_levels, ctx.l, ctx.h, ctx.atr, kind)
        if level is not None:
            score += 15 + level.strength / 10
            notes.append(f"sur {'support' if kind == 'support' else 'résistance'} {ctx.fmt(level.price)}")
        if htf is not None:
            score += 8
            notes.append(f"niveau {htf.timeframe} {ctx.fmt(htf.price)}")
        if len(group) > 1:
            score += min(10, 5 * (len(group) - 1))
            notes.append("confirmé par " + ", ".join(h.name for h in group if h is not best))
        if ctx.rsi is not None and ((direction == Direction.BULLISH and ctx.rsi < 35) or
                                    (direction == Direction.BEARISH and ctx.rsi > 65)):
            score += 5
            notes.append(f"RSI {ctx.rsi:.0f}")
        if ctx.h - ctx.l >= ctx.atr:
            score += 5
        stop = (ctx.l - 0.2 * ctx.atr) if direction == Direction.BULLISH else (ctx.h + 0.2 * ctx.atr)
        title = f"{best.name}"
        desc = "Retournement " + ("haussier" if direction == Direction.BULLISH else "baissier")
        if notes:
            desc += " — " + " ; ".join(notes)
        out.append(Signal(f"{ctx.symbol}:{ctx.tf.value}:reversal:{direction.value}:{ctx.time}", ctx.symbol,
                          ctx.tf.value, ctx.time, "reversal", direction, title, desc, min(score, 100.0), ctx.c,
                          _risk(ctx, direction, stop=stop), ref=best.key))
    return out


def level_signals(ctx: SignalContext, o, h, l, c) -> list[Signal]:
    out: list[Signal] = []
    seen: list[float] = []
    events = lv_mod.level_events(o, h, l, c, ctx.atr, ctx.levels, ctx.index)
    events += [e for e in lv_mod.level_events(o, h, l, c, ctx.atr, ctx.htf_levels, ctx.index)]
    events.sort(key=lambda e: -e.quality)
    for ev in events:
        if any(abs(ev.level.price - p) < 0.5 * ctx.atr for p in seen):
            continue
        seen.append(ev.level.price)
        lv = ev.level
        is_htf = lv.timeframe != ctx.tf.value
        name = "résistance" if (ev.direction == Direction.BULLISH) == (ev.type == "breakout") else "support"
        if ev.type == "breakout":
            score = 35 + 40 * ev.quality + (8 if lv.major else 0) + (7 if is_htf else 0)
            title = f"Cassure {('haussière' if ev.direction == Direction.BULLISH else 'baissière')} — {name} {ctx.fmt(lv.price)}"
            stop = (lv.low - 0.2 * ctx.atr) if ev.direction == Direction.BULLISH else (lv.high + 0.2 * ctx.atr)
        else:
            score = 30 + 35 * ev.quality + (8 if lv.major else 0) + (7 if is_htf else 0)
            title = f"Rejet du {name} {ctx.fmt(lv.price)}"
            stop = (ctx.l - 0.2 * ctx.atr) if ev.direction == Direction.BULLISH else (ctx.h + 0.2 * ctx.atr)
        desc = (f"Niveau {lv.timeframe} touché {lv.touches} fois, force {lv.strength:.0f}/100"
                + (" (niveau majeur)" if lv.major else ""))
        out.append(Signal(f"{ctx.symbol}:{ctx.tf.value}:{ev.type}:{ev.ref}:{ctx.time}", ctx.symbol, ctx.tf.value,
                          ctx.time, ev.type, ev.direction, title, desc, min(score, 100.0), ctx.c,
                          _risk(ctx, ev.direction, stop=stop), ref=ev.ref))
    return out


def pattern_signals(ctx: SignalContext, patterns: list[ChartPattern],
                    previous_ids: set[str] | None) -> list[Signal]:
    """``previous_ids`` = figures connues à l'analyse précédente (None au premier passage)."""
    out: list[Signal] = []
    for p in patterns:
        if p.status == "confirmed" and p.breakout_index == ctx.index:
            base, span = PATTERN_WEIGHT.get(p.family if p.key != "broadening" else "broadening", (60, 35))
            score = base + span * p.confidence
            title = f"{p.name} — cassure confirmée"
            desc = "Cassure validée à la clôture"
            if p.target is not None:
                desc += f" — objectif {ctx.fmt(p.target)}"
            out.append(Signal(f"{ctx.symbol}:{ctx.tf.value}:pattern:{p.id}", ctx.symbol, ctx.tf.value, ctx.time,
                              "pattern", p.direction, title, desc, min(score, 100.0), ctx.c,
                              _risk(ctx, p.direction, stop=p.invalidation, target=p.target), ref=p.id))
        elif p.status == "forming" and previous_ids is not None and p.id not in previous_ids:
            score = 25 + 20 * p.confidence
            out.append(Signal(f"{ctx.symbol}:{ctx.tf.value}:pattern-new:{p.id}", ctx.symbol, ctx.tf.value, ctx.time,
                              "pattern", p.direction, f"{p.name} en formation",
                              "Figure détectée, en attente de cassure", score, ctx.c,
                              _risk(ctx, p.direction) if p.direction != Direction.NEUTRAL else None, ref=p.id))
    return out
