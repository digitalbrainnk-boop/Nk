"""Supports / résistances majeurs et événements de cassure ou de rejet.

Les niveaux sont obtenus en regroupant (clustering 1D) les prix des pivots ZigZag :
plus un niveau a été touché souvent, récemment et par des pivots majeurs, plus il
est fort. Chaque niveau est une **zone** (et non une ligne) de largeur liée à l'ATR.
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np

from ..core.models import Direction, Level, Pivot


def find_levels(highs: np.ndarray, lows: np.ndarray, closes: np.ndarray, times: np.ndarray, atr: float,
                minor: list[Pivot], major: list[Pivot], max_levels: int = 8, timeframe: str = "") -> list[Level]:
    n = len(closes)
    if n < 20 or atr <= 0 or not minor:
        return []
    price = float(closes[-1])
    major_idx = {p.index for p in major}
    tol = 0.6 * atr

    # Poids d'un pivot : récence (demi-vie = moitié de l'historique) x importance.
    pts = []
    for p in minor:
        w = 0.5 ** ((n - 1 - p.index) / max(n / 2, 1))
        if p.index in major_idx:
            w *= 2.0
        if not p.confirmed:
            w *= 0.5
        pts.append((p.price, w, p.index, p))
    pts.sort(key=lambda t: t[0])

    clusters: list[list[tuple]] = []
    for item in pts:
        if clusters:
            cl = clusters[-1]
            center = sum(x[0] * x[1] for x in cl) / sum(x[1] for x in cl)
            if item[0] - center <= tol:
                cl.append(item)
                continue
        clusters.append([item])

    levels: list[Level] = []
    for cl in clusters:
        weights = np.array([x[1] for x in cl])
        prices = np.array([x[0] for x in cl])
        center = float((prices * weights).sum() / weights.sum())
        lo = float(min(prices.min(), center - 0.25 * atr))
        hi = float(max(prices.max(), center + 0.25 * atr))
        # Touches supplémentaires : bougies dont la mèche entre dans la zone sans clôturer au-delà.
        wick_touch = int(np.sum((highs >= lo) & (lows <= hi)))
        touches = len(cl)
        if touches < 2 and not any(x[2] in major_idx for x in cl):
            continue
        raw = weights.sum() * (1 + 0.15 * min(touches, 6)) + 0.002 * wick_touch
        idxs = [x[2] for x in cl]
        kind = "resistance" if center > price else "support"
        levels.append(Level(price=center, low=lo, high=hi, kind=kind, touches=touches, strength=float(raw),
                            first_time=int(times[min(idxs)]), last_time=int(times[max(idxs)]),
                            timeframe=timeframe))
    if not levels:
        return []
    top = max(lv.strength for lv in levels)
    for lv in levels:
        lv.strength = round(100.0 * lv.strength / top, 1)

    # Sélection : force pondérée par la proximité du prix (utile en scalping), niveaux
    # suffisamment espacés, équilibrés de part et d'autre du prix.
    def rank(lv: Level) -> float:
        dist = abs(lv.price - price) / atr
        return lv.strength / (1.0 + (dist / 10.0) ** 2)

    min_sep = 1.2 * atr
    half = max(1, max_levels // 2)
    chosen: list[Level] = []
    for side in (lambda lv: lv.price > price, lambda lv: lv.price <= price):
        picked: list[Level] = []
        for lv in sorted(filter(side, levels), key=rank, reverse=True):
            if all(abs(lv.price - k.price) >= min_sep for k in picked):
                picked.append(lv)
            if len(picked) >= half:
                break
        chosen += picked
    for lv in sorted(chosen, key=lambda x: -x.strength)[:3]:
        lv.major = True
    return sorted(chosen, key=lambda lv: lv.price)


@dataclass
class LevelEvent:
    type: str            # "breakout" | "rejection"
    direction: Direction
    level: Level
    index: int
    quality: float       # 0-1 (taille du corps, mèche, force du niveau)

    @property
    def ref(self) -> str:
        return f"{self.level.timeframe}:{self.level.kind}:{self.level.price:.6g}"


def level_events(o: np.ndarray, h: np.ndarray, l: np.ndarray, c: np.ndarray, atr: float,
                 levels: list[Level], index: int | None = None) -> list[LevelEvent]:
    """Cassures (clôture franche de l'autre côté de la zone) et rejets (mèche dans la
    zone, clôture repoussée) sur la bougie ``index`` (par défaut la dernière)."""
    i = len(c) - 1 if index is None else index
    if i < 1 or atr <= 0:
        return []
    events: list[LevelEvent] = []
    body = abs(c[i] - o[i])
    rng = max(h[i] - l[i], 1e-12)
    buf = 0.1 * atr
    for lv in levels:
        # Rôle du niveau vu depuis la clôture PRÉCÉDENTE (vaut aussi pour les niveaux d'UT supérieures).
        resistance = lv.price > c[i - 1]
        q_body = 0.45 * min(1.0, body / atr) + 0.25 * (body / rng) + 0.3 * lv.strength / 100
        # Cassure haussière : clôture précédente sous le centre de la zone, clôture actuelle au-dessus.
        if resistance and c[i] > lv.high + buf and c[i] > o[i]:
            events.append(LevelEvent("breakout", Direction.BULLISH, lv, i, q_body))
        elif not resistance and c[i] < lv.low - buf and c[i] < o[i]:
            events.append(LevelEvent("breakout", Direction.BEARISH, lv, i, q_body))
        # Rejet d'une résistance : la mèche haute pénètre la zone, la clôture reste dessous.
        elif resistance and h[i] >= lv.low and c[i] < lv.low and c[i - 1] < lv.low:
            wick = h[i] - max(o[i], c[i])
            if wick >= 0.5 * rng:
                q = 0.5 * (wick / rng) + 0.2 * min(1.0, wick / atr) + 0.3 * lv.strength / 100
                events.append(LevelEvent("rejection", Direction.BEARISH, lv, i, q))
        elif not resistance and l[i] <= lv.high and c[i] > lv.high and c[i - 1] > lv.high:
            wick = min(o[i], c[i]) - l[i]
            if wick >= 0.5 * rng:
                q = 0.5 * (wick / rng) + 0.2 * min(1.0, wick / atr) + 0.3 * lv.strength / 100
                events.append(LevelEvent("rejection", Direction.BULLISH, lv, i, q))
    return events


def nearest(levels: list[Level], price: float, direction: Direction) -> Level | None:
    """Niveau le plus proche dans le sens du trade (résistance au-dessus pour un achat)."""
    if direction == Direction.BULLISH:
        cands = [lv for lv in levels if lv.low > price]
        return min(cands, key=lambda lv: lv.low - price) if cands else None
    if direction == Direction.BEARISH:
        cands = [lv for lv in levels if lv.high < price]
        return min(cands, key=lambda lv: price - lv.high) if cands else None
    return None


def at_level(levels: list[Level], low: float, high: float, atr: float, kind: str) -> Level | None:
    """Niveau du type ``kind`` touché par la bougie [low, high] (à 0.3 ATR près)."""
    best = None
    for lv in levels:
        if lv.kind != kind:
            continue
        if high >= lv.low - 0.3 * atr and low <= lv.high + 0.3 * atr:
            if best is None or lv.strength > best.strength:
                best = lv
    return best
