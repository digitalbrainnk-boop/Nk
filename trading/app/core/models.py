"""Structures de données partagées entre les modules (marché, analyse, alertes).

Toutes les structures se sérialisent en dictionnaires JSON compacts via ``to_dict``
pour être envoyées telles quelles au navigateur.
"""

from __future__ import annotations

from dataclasses import asdict, dataclass, field
from enum import Enum
from typing import Any


class Direction(str, Enum):
    BULLISH = "bullish"
    BEARISH = "bearish"
    NEUTRAL = "neutral"

    @property
    def sign(self) -> int:
        return {"bullish": 1, "bearish": -1, "neutral": 0}[self.value]

    @classmethod
    def from_sign(cls, value: float) -> "Direction":
        if value > 0:
            return cls.BULLISH
        if value < 0:
            return cls.BEARISH
        return cls.NEUTRAL


@dataclass(slots=True)
class Candle:
    """Bougie OHLC. ``time`` = ouverture de la bougie en secondes epoch UTC."""

    time: int
    open: float
    high: float
    low: float
    close: float
    volume: float = 0.0

    def to_dict(self) -> dict[str, Any]:
        return {"t": self.time, "o": self.open, "h": self.high, "l": self.low,
                "c": self.close, "v": self.volume}


@dataclass(slots=True)
class Tick:
    time: float
    price: float
    volume: float = 1.0


@dataclass(slots=True)
class Instrument:
    """Instrument tradable. ``aliases`` donne le nom du symbole chez chaque fournisseur."""

    symbol: str
    name: str
    category: str                    # "synthetic" | "forex" | ...
    provider: str = "simulator"
    digits: int = 2
    aliases: dict[str, str] = field(default_factory=dict)
    sim: dict[str, Any] = field(default_factory=dict)

    def provider_symbol(self, provider: str | None = None) -> str:
        return self.aliases.get(provider or self.provider, self.symbol)

    def to_dict(self) -> dict[str, Any]:
        return {"symbol": self.symbol, "name": self.name, "category": self.category,
                "provider": self.provider, "digits": self.digits}


@dataclass(slots=True)
class Pivot:
    """Point de retournement (sommet ``H`` ou creux ``L``) détecté par le ZigZag."""

    index: int
    time: int
    price: float
    kind: str            # "H" ou "L"
    confirmed: bool = True

    def to_dict(self) -> dict[str, Any]:
        return {"i": self.index, "t": self.time, "p": self.price, "k": self.kind,
                "confirmed": self.confirmed}


@dataclass(slots=True)
class CandlePatternHit:
    """Figure de chandelier japonais détectée sur une bougie."""

    time: int
    index: int
    key: str
    name: str
    direction: Direction
    kind: str            # "reversal" | "continuation" | "indecision"
    reliability: int     # 1 (faible) à 3 (forte)
    candles: int

    def to_dict(self) -> dict[str, Any]:
        return {"t": self.time, "i": self.index, "key": self.key, "name": self.name,
                "dir": self.direction.value, "kind": self.kind,
                "reliability": self.reliability, "candles": self.candles}


@dataclass(slots=True)
class Line:
    """Segment à tracer : de (t1, p1) à (t2, p2). ``i1``/``i2`` = index de bougie
    (permet de prolonger la ligne au-delà de la dernière bougie)."""

    i1: int
    p1: float
    i2: int
    p2: float
    role: str            # "upper" | "lower" | "neckline" | "target" | "pole" | "level"
    extend: bool = False

    def value_at(self, index: float) -> float:
        if self.i2 == self.i1:
            return self.p2
        return self.p1 + (self.p2 - self.p1) * (index - self.i1) / (self.i2 - self.i1)

    def to_dict(self, times: list[int] | None = None) -> dict[str, Any]:
        d = {"i1": self.i1, "p1": self.p1, "i2": self.i2, "p2": self.p2,
             "role": self.role, "extend": self.extend}
        if times is not None:
            d["t1"] = _time_at(times, self.i1)
            d["t2"] = _time_at(times, self.i2)
        return d


def _time_at(times: list[int], index: int) -> int:
    """Heure de la bougie ``index`` ; extrapole au-delà de la dernière bougie."""
    if not times:
        return 0
    if 0 <= index < len(times):
        return int(times[index])
    step = times[-1] - times[-2] if len(times) > 1 else 60
    if index >= len(times):
        return int(times[-1] + (index - len(times) + 1) * step)
    return int(times[0] + index * step)


@dataclass(slots=True)
class ChartPattern:
    """Figure chartiste (triangle, tête-épaules, double sommet…)."""

    id: str
    key: str
    name: str
    family: str          # "double" | "hs" | "triangle" | "wedge" | "channel" | "flag"
    direction: Direction
    status: str          # "forming" | "confirmed" | "failed"
    points: list[Pivot]
    lines: list[Line]
    start_index: int
    end_index: int
    confidence: float
    breakout_level: float | None = None
    target: float | None = None
    invalidation: float | None = None
    breakout_index: int | None = None
    height: float = 0.0

    def to_dict(self, times: list[int]) -> dict[str, Any]:
        return {
            "id": self.id, "key": self.key, "name": self.name, "family": self.family,
            "dir": self.direction.value, "status": self.status,
            "points": [p.to_dict() for p in self.points],
            "lines": [ln.to_dict(times) for ln in self.lines],
            "start": _time_at(times, self.start_index), "end": _time_at(times, self.end_index),
            "start_index": self.start_index, "end_index": self.end_index,
            "confidence": round(self.confidence, 3),
            "breakout_level": self.breakout_level, "target": self.target,
            "invalidation": self.invalidation,
            "breakout_time": _time_at(times, self.breakout_index) if self.breakout_index is not None else None,
        }


@dataclass(slots=True)
class Level:
    """Support ou résistance (zone de prix)."""

    price: float
    low: float
    high: float
    kind: str            # "support" | "resistance"
    touches: int
    strength: float      # 0-100
    first_time: int
    last_time: int
    timeframe: str = ""
    major: bool = False

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


@dataclass(slots=True)
class TrendState:
    """Tendance d'une unité de temps : score de -1 (baissier fort) à +1 (haussier fort)."""

    timeframe: str
    score: float
    label: str
    structure: str       # "HH/HL", "LH/LL", "mixte"
    ema_fast: float | None
    ema_slow: float | None
    ema_long: float | None
    rsi: float | None
    adx: float | None
    atr: float | None
    atr_percentile: float | None
    close: float | None
    updated: int = 0

    @property
    def direction(self) -> Direction:
        if self.score > 0.2:
            return Direction.BULLISH
        if self.score < -0.2:
            return Direction.BEARISH
        return Direction.NEUTRAL

    def to_dict(self) -> dict[str, Any]:
        d = asdict(self)
        d["dir"] = self.direction.value
        return d


@dataclass(slots=True)
class RiskAssessment:
    """Évaluation du risque d'une prise de position par croisement multi-temporel."""

    score: float                 # 0 (risque faible) à 100 (risque élevé)
    level: str                   # "faible" | "modere" | "eleve"
    verdict: str                 # texte court
    alignment: float             # -1 (contre-tendance) à +1 (dans le sens des UT supérieures)
    details: list[str]
    entry: float | None = None
    stop: float | None = None
    target: float | None = None
    rr: float | None = None
    htf: dict[str, float] = field(default_factory=dict)

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


@dataclass(slots=True)
class Signal:
    """Signal de trading issu de l'analyse d'une bougie clôturée."""

    id: str
    symbol: str
    timeframe: str
    time: int
    type: str            # "reversal" | "breakout" | "rejection" | "pattern"
    direction: Direction
    title: str
    description: str
    score: float         # 0-100
    price: float
    risk: RiskAssessment | None = None
    ref: str | None = None   # id de la figure/niveau à l'origine du signal

    @property
    def strength(self) -> str:
        if self.score >= 70:
            return "fort"
        if self.score >= 45:
            return "moyen"
        return "faible"

    def to_dict(self) -> dict[str, Any]:
        return {
            "id": self.id, "symbol": self.symbol, "tf": self.timeframe, "t": self.time,
            "type": self.type, "dir": self.direction.value, "title": self.title,
            "description": self.description, "score": round(self.score, 1),
            "strength": self.strength, "price": self.price,
            "risk": self.risk.to_dict() if self.risk else None, "ref": self.ref,
        }
