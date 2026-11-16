"""Détection géométrique des figures chartistes à partir des pivots ZigZag / RDP.

Figures reconnues :

* doubles et triples sommets / creux (ligne de cou horizontale) ;
* tête-épaules et tête-épaules inversée (ligne de cou oblique) ;
* triangles ascendant, descendant, symétrique ; biseaux montant / descendant ;
  canaux haussier / baissier, rectangle, élargissement ;
* drapeaux et fanions (haussiers / baissiers).

Chaque figure est décrite par ses pivots, ses lignes à tracer (bornes, ligne de
cou, objectif), son statut (``forming`` → ``confirmed`` à la clôture au-delà de la
ligne de cassure, ou ``failed``), un objectif de cours (projection classique de la
hauteur) et un niveau d'invalidation.
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np

from ..core.models import ChartPattern, Direction, Line, Pivot

NAMES = {
    "double_top": "Double sommet",
    "double_bottom": "Double creux",
    "triple_top": "Triple sommet",
    "triple_bottom": "Triple creux",
    "head_shoulders": "Tête-épaules",
    "inverse_head_shoulders": "Tête-épaules inversée",
    "ascending_triangle": "Triangle ascendant",
    "descending_triangle": "Triangle descendant",
    "symmetrical_triangle": "Triangle symétrique",
    "rising_wedge": "Biseau montant",
    "falling_wedge": "Biseau descendant",
    "ascending_channel": "Canal haussier",
    "descending_channel": "Canal baissier",
    "rectangle": "Rectangle (range)",
    "broadening": "Élargissement",
    "bull_flag": "Drapeau haussier",
    "bear_flag": "Drapeau baissier",
    "bull_pennant": "Fanion haussier",
    "bear_pennant": "Fanion baissier",
}

FAMILY = {
    "double_top": "double", "double_bottom": "double", "triple_top": "double", "triple_bottom": "double",
    "head_shoulders": "hs", "inverse_head_shoulders": "hs",
    "ascending_triangle": "triangle", "descending_triangle": "triangle", "symmetrical_triangle": "triangle",
    "rising_wedge": "wedge", "falling_wedge": "wedge", "broadening": "triangle",
    "ascending_channel": "channel", "descending_channel": "channel", "rectangle": "channel",
    "bull_flag": "flag", "bear_flag": "flag", "bull_pennant": "flag", "bear_pennant": "flag",
}


@dataclass
class Bars:
    o: np.ndarray
    h: np.ndarray
    l: np.ndarray
    c: np.ndarray
    times: np.ndarray
    atr: np.ndarray

    @property
    def n(self) -> int:
        return len(self.c)

    def atr_at(self, i: int) -> float:
        i = min(max(i, 0), self.n - 1)
        v = float(self.atr[i])
        return v if v > 0 else float(np.nanmean(self.atr)) or 1e-9


def _pid(key: str, pts: list[Pivot]) -> str:
    return f"{key}:{pts[0].time}:{pts[-1].time}"


def _scan_breakout(b: Bars, start: int, upper, lower, buffer: float, max_bars: int | None = None):
    """Première clôture au-dessus de ``upper(i)`` (+1) ou sous ``lower(i)`` (-1) après ``start``.

    ``upper``/``lower`` : fonctions index -> prix (ou None pour ignorer ce côté).
    Renvoie (index, sens) ou (None, 0).
    """
    end = b.n if max_bars is None else min(b.n, start + 1 + max_bars)
    if start + 1 >= end:
        return None, 0
    idx = np.arange(start + 1, end)
    closes = b.c[start + 1:end]
    up_hit = closes > np.broadcast_to(upper(idx), idx.shape) + buffer if upper is not None \
        else np.zeros(len(idx), dtype=bool)
    dn_hit = closes < np.broadcast_to(lower(idx), idx.shape) - buffer if lower is not None \
        else np.zeros(len(idx), dtype=bool)
    hit = up_hit | dn_hit
    if not hit.any():
        return None, 0
    k = int(np.argmax(hit))
    return start + 1 + k, (1 if up_hit[k] else -1)


# ---------------------------------------------------------------------------------
# Doubles / triples sommets et creux
# ---------------------------------------------------------------------------------

def _double(b: Bars, piv: list[Pivot], j: int, tol_k: float) -> ChartPattern | None:
    if j < 3:
        return None
    p0, p1, p2, p3 = piv[j - 3:j + 1]
    top = p3.kind == "H"
    a = b.atr_at(p3.index)
    tol = tol_k * a
    if abs(p1.price - p3.price) > tol or p3.index - p1.index < 4:
        return None
    extreme = max(p1.price, p3.price) if top else min(p1.price, p3.price)
    neck = p2.price
    depth = abs(extreme - neck)
    if depth < max(2.0 * a, 1.5 * tol):
        return None
    if top and p1.price - p0.price < 0.7 * depth:
        return None
    if not top and p0.price - p1.price < 0.7 * depth:
        return None
    key = "double_top" if top else "double_bottom"
    sign = -1 if top else 1
    width = p3.index - p1.index
    buf = 0.1 * a
    level = lambda i: neck  # noqa: E731
    inval = extreme + (tol if top else -tol)
    brk, _ = _scan_breakout(b, p3.index, None if top else level, level if top else None, buf, max_bars=2 * width)
    fail, _ = _scan_breakout(b, p3.index, (lambda i: inval) if top else None, None if top else (lambda i: inval), 0)
    status = "forming"
    if brk is not None and (fail is None or brk < fail):
        status = "confirmed"
    elif fail is not None:
        status = "failed"
    elif b.n - 1 - p3.index > 2 * width:
        return None          # jamais cassée : figure périmée
    target = neck + sign * depth
    conf = 0.5 + 0.25 * (1 - abs(p1.price - p3.price) / max(tol, 1e-12)) + 0.25 * min(1.0, depth / (5 * a))
    end_line = brk if brk is not None else b.n - 1
    lines = [Line(p1.index, neck, end_line, neck, "neckline", extend=status == "forming")]
    if status == "confirmed":
        lines.append(Line(brk, target, brk + max(5, width // 2), target, "target"))
    return ChartPattern(_pid(key, [p0, p1, p2, p3]), key, NAMES[key], "double", Direction.from_sign(sign), status,
                        [p0, p1, p2, p3], lines, p0.index, p3.index, conf, breakout_level=neck,
                        target=target, invalidation=inval, breakout_index=brk, height=depth)


def _triple(b: Bars, piv: list[Pivot], j: int, tol_k: float) -> ChartPattern | None:
    if j < 5:
        return None
    pts = piv[j - 5:j + 1]
    p0, p1, p2, p3, p4, p5 = pts
    top = p5.kind == "H"
    a = b.atr_at(p5.index)
    tol = tol_k * a
    peaks = np.array([p1.price, p3.price, p5.price])
    if peaks.max() - peaks.min() > 1.5 * tol:
        return None
    neck = min(p2.price, p4.price) if top else max(p2.price, p4.price)
    extreme = peaks.max() if top else peaks.min()
    depth = abs(extreme - neck)
    if depth < max(2.0 * a, 1.5 * tol) or abs(p2.price - p4.price) > 0.5 * depth:
        return None
    if (top and p0.price > neck) or (not top and p0.price < neck):
        return None
    key = "triple_top" if top else "triple_bottom"
    sign = -1 if top else 1
    width = p5.index - p1.index
    level = lambda i: neck  # noqa: E731
    inval = extreme + (tol if top else -tol)
    brk, _ = _scan_breakout(b, p5.index, None if top else level, level if top else None, 0.1 * a, max_bars=width)
    fail, _ = _scan_breakout(b, p5.index, (lambda i: inval) if top else None, None if top else (lambda i: inval), 0)
    status = "forming"
    if brk is not None and (fail is None or brk < fail):
        status = "confirmed"
    elif fail is not None:
        status = "failed"
    elif b.n - 1 - p5.index > width:
        return None
    target = neck + sign * depth
    conf = 0.65 + 0.2 * (1 - (peaks.max() - peaks.min()) / (1.5 * tol)) + 0.15 * min(1.0, depth / (5 * a))
    end_line = brk if brk is not None else b.n - 1
    lines = [Line(p1.index, neck, end_line, neck, "neckline", extend=status == "forming")]
    if status == "confirmed":
        lines.append(Line(brk, target, brk + max(5, width // 3), target, "target"))
    return ChartPattern(_pid(key, pts), key, NAMES[key], "double", Direction.from_sign(sign), status, pts, lines,
                        p0.index, p5.index, min(conf, 1.0), breakout_level=neck, target=target,
                        invalidation=inval, breakout_index=brk, height=depth)


# ---------------------------------------------------------------------------------
# Tête-épaules
# ---------------------------------------------------------------------------------

def _head_shoulders(b: Bars, piv: list[Pivot], j: int, tol_k: float) -> ChartPattern | None:
    if j < 5:
        return None
    pts = piv[j - 5:j + 1]
    p0, ls, n1, head, n2, rs = pts
    top = rs.kind == "H"
    s = 1 if top else -1                    # on raisonne sur des sommets : prix * s
    a = b.atr_at(rs.index)
    tol = tol_k * a
    H, L1, L2 = head.price * s, n1.price * s, n2.price * s
    S1, S2 = ls.price * s, rs.price * s
    neck_ref = max(L1, L2)
    height = H - min(L1, L2)
    if height < 3.0 * a:
        return None
    if H - max(S1, S2) < max(0.6 * a, 0.12 * height):        # la tête domine
        return None
    if abs(S1 - S2) > max(1.5 * tol, 0.35 * (H - min(L1, L2))):  # épaules comparables
        return None
    if min(S1, S2) - neck_ref < 0.8 * a:                       # épaules au-dessus de la ligne de cou
        return None
    if abs(L1 - L2) > 0.35 * height:                             # ligne de cou pas trop pentue
        return None
    dl, dr = head.index - ls.index, rs.index - head.index
    if dl <= 0 or dr <= 0 or not (1 / 3 <= dl / dr <= 3):
        return None
    if p0.price * s > L1:                                        # tendance préalable
        return None

    neck = Line(n1.index, n1.price, n2.index, n2.price, "neckline")
    key = "head_shoulders" if top else "inverse_head_shoulders"
    sign = -1 if top else 1
    width = rs.index - ls.index
    buf = 0.1 * a
    inval = rs.price + (tol if top else -tol)
    brk, _ = _scan_breakout(b, rs.index, None if top else neck.value_at, neck.value_at if top else None, buf,
                            max_bars=width)
    fail, _ = _scan_breakout(b, rs.index, (lambda i: head.price) if top else None,
                             None if top else (lambda i: head.price), 0)
    status = "forming"
    if brk is not None and (fail is None or brk < fail):
        status = "confirmed"
    elif fail is not None:
        status = "failed"
    elif b.n - 1 - rs.index > width:
        return None
    neck_at_head = neck.value_at(head.index)
    head_height = abs(head.price - neck_at_head)
    brk_price = neck.value_at(brk) if brk is not None else neck.value_at(b.n - 1)
    target = brk_price + sign * head_height
    sym = 1 - abs(dl - dr) / (dl + dr)
    conf = 0.55 + 0.2 * sym + 0.15 * (1 - abs(S1 - S2) / max(1.5 * tol, 0.35 * height)) + 0.1 * min(1, height / (8 * a))
    end_line = brk if brk is not None else b.n - 1
    lines = [Line(ls.index, neck.value_at(ls.index), end_line, neck.value_at(end_line), "neckline",
                  extend=status == "forming")]
    if status == "confirmed":
        lines.append(Line(brk, target, brk + max(5, width // 3), target, "target"))
    return ChartPattern(_pid(key, pts), key, NAMES[key], "hs", Direction.from_sign(sign), status, pts, lines,
                        p0.index, rs.index, min(conf, 1.0), breakout_level=brk_price, target=target,
                        invalidation=inval, breakout_index=brk, height=head_height)


# ---------------------------------------------------------------------------------
# Triangles, biseaux, canaux, rectangles
# ---------------------------------------------------------------------------------

def _fit(points: list[Pivot]) -> tuple[float, float, float]:
    """Droite des moindres carrés prix = a*index + b ; renvoie (pente, ordonnée, résidu max)."""
    x = np.array([p.index for p in points], dtype=float)
    y = np.array([p.price for p in points], dtype=float)
    if len(points) == 2:
        slope = (y[1] - y[0]) / (x[1] - x[0])
        return slope, y[0] - slope * x[0], 0.0
    slope, icpt = np.polyfit(x, y, 1)
    return float(slope), float(icpt), float(np.max(np.abs(y - (slope * x + icpt))))


def _boundaries(b: Bars, piv: list[Pivot], j: int, size: int) -> ChartPattern | None:
    if j - size + 1 < 0:
        return None
    pts = piv[j - size + 1:j + 1]
    highs = [p for p in pts if p.kind == "H"]
    lows = [p for p in pts if p.kind == "L"]
    if len(highs) < 2 or len(lows) < 2:
        return None
    start, end = pts[0].index, pts[-1].index
    if end - start < 10:
        return None
    a = b.atr_at(end)
    su, iu, ru = _fit(highs)
    sl, il, rl = _fit(lows)
    up = lambda i: su * i + iu  # noqa: E731
    lo = lambda i: sl * i + il  # noqa: E731
    h0, h1 = up(start) - lo(start), up(end) - lo(end)
    if h0 <= 0 or h1 <= 0 or max(h0, h1) < 2.5 * a:
        return None
    fit_tol = max(0.6 * a, 0.12 * max(h0, h1))
    if ru > fit_tol or rl > fit_tol:
        return None
    seg = slice(start, end + 1)
    idx = np.arange(start, end + 1)
    outside = (b.c[seg] > up(idx) + 0.3 * a) | (b.c[seg] < lo(idx) - 0.3 * a)
    if outside.mean() > 0.05:
        return None

    ref = max(h0, h1)
    ru_rel = (up(end) - up(start)) / ref
    rl_rel = (lo(end) - lo(start)) / ref
    f = 0.15
    ratio = h1 / h0
    key = None
    if ratio < 0.8:
        if abs(ru_rel) <= f and rl_rel > f:
            key = "ascending_triangle"
        elif abs(rl_rel) <= f and ru_rel < -f:
            key = "descending_triangle"
        elif ru_rel < -f and rl_rel > f:
            key = "symmetrical_triangle"
        elif ru_rel > f and rl_rel > f:
            key = "rising_wedge"
        elif ru_rel < -f and rl_rel < -f:
            key = "falling_wedge"
    elif ratio <= 1.25:
        if abs(ru_rel) <= f and abs(rl_rel) <= f:
            key = "rectangle"
        elif ru_rel > f and rl_rel > f:
            key = "ascending_channel"
        elif ru_rel < -f and rl_rel < -f:
            key = "descending_channel"
    elif ru_rel > f and rl_rel < -f:
        key = "broadening"
    if key is None:
        return None

    bias = {"ascending_triangle": 1, "descending_triangle": -1, "rising_wedge": -1, "falling_wedge": 1,
            "ascending_channel": 1, "descending_channel": -1}.get(key, 0)
    # Durée de validité : jusqu'à l'apex pour les figures convergentes.
    duration = end - start
    limit = duration
    if ratio < 0.8 and su != sl:
        apex = (il - iu) / (su - sl)
        if apex > end:
            limit = int(min(apex - end, 1.5 * duration))
    brk, d = _scan_breakout(b, end, up, lo, 0.15 * a, max_bars=max(limit, 3))
    if brk is None and b.n - 1 - end > limit:
        return None
    status = "forming"
    direction = Direction.from_sign(bias)
    target = None
    inval = None
    if brk is not None:
        direction = Direction.from_sign(d)
        status = "confirmed" if bias == 0 or d == bias or key in ("ascending_channel", "descending_channel") else "failed"
        if key in ("rising_wedge", "falling_wedge"):
            target = lo(start) if d < 0 else up(start)
        else:
            target = b.c[brk] + d * h0
        inval = lo(brk) if d > 0 else up(brk)
    touches = len(pts)
    conf = 0.45 + 0.08 * min(touches - 4, 3) + 0.2 * (1 - max(ru, rl) / fit_tol) + 0.11 * (1 - outside.mean() / 0.05)
    end_line = brk if brk is not None else b.n - 1
    lines = [Line(start, up(start), end_line, up(end_line), "upper", extend=brk is None),
             Line(start, lo(start), end_line, lo(end_line), "lower", extend=brk is None)]
    if status == "confirmed" and target is not None:
        lines.append(Line(brk, target, brk + max(5, duration // 3), target, "target"))
    family = FAMILY[key]
    return ChartPattern(_pid(key, pts), key, NAMES[key], family, direction, status, pts, lines, start, end,
                        min(conf, 1.0), breakout_level=(up(brk) if d > 0 else lo(brk)) if brk is not None else None,
                        target=target, invalidation=inval, breakout_index=brk, height=h0)


# ---------------------------------------------------------------------------------
# Drapeaux et fanions
# ---------------------------------------------------------------------------------

def _flag(b: Bars, piv: list[Pivot], j: int) -> ChartPattern | None:
    """Mât (impulsion rapide) suivi d'une consolidation courte à contre-sens."""
    if j < 3:
        return None
    for size in (5, 4):
        if j - size + 1 < 0:
            continue
        pts = piv[j - size + 1:j + 1]
        p0, p1 = pts[0], pts[1]
        bull = p1.kind == "H"
        s = 1 if bull else -1
        a = b.atr_at(p1.index)
        pole = (p1.price - p0.price) * s
        pole_bars = p1.index - p0.index
        if pole < 4.0 * a or pole_bars > 25 or pole_bars < 1:
            continue
        cons = pts[1:]
        # Retracement limité à 50 % du mât, consolidation plus longue que le mât mais pas trop.
        extreme_back = min(p.price * s for p in cons)
        if p1.price * s - extreme_back > 0.5 * pole:
            continue
        cons_bars = cons[-1].index - p1.index
        if cons_bars < 3 or cons_bars > max(4 * pole_bars, 12):
            continue
        tops = [p for p in cons if (p.kind == "H") == bull]       # côté « cassure »
        bottoms = [p for p in cons if (p.kind == "H") != bull]
        if len(tops) < 2 or len(bottoms) < 1:
            continue
        st, it, _ = _fit(tops)
        if st * s > 0.05 * a:           # la consolidation ne doit pas prolonger le mât
            continue
        if len(bottoms) >= 2:
            sb, ib, _ = _fit(bottoms)
        else:
            sb = st
            ib = bottoms[0].price - st * bottoms[0].index
        top_line = lambda i: st * i + it  # noqa: E731
        bot_line = lambda i: sb * i + ib  # noqa: E731
        pennant = (st * s < 0) and (sb * s > 0)
        key = ("bull_pennant" if pennant else "bull_flag") if bull else ("bear_pennant" if pennant else "bear_flag")
        end = cons[-1].index
        brk_up, d = _scan_breakout(b, end, top_line if bull else None, None if bull else top_line, 0.1 * a,
                                   max_bars=max(2 * cons_bars, 5))
        fail, _ = _scan_breakout(b, end, None if bull else bot_line, bot_line if bull else None, 0.3 * a)
        status = "forming"
        if brk_up is not None and (fail is None or brk_up < fail):
            status = "confirmed"
        elif fail is not None:
            status = "failed"
        elif b.n - 1 - end > 2 * cons_bars:
            continue
        brk = brk_up if status == "confirmed" else None
        target = (b.c[brk] + s * pole) if brk is not None else None
        end_line = brk if brk is not None else (fail if fail is not None else b.n - 1)
        lines = [Line(p0.index, p0.price, p1.index, p1.price, "pole"),
                 Line(p1.index, top_line(p1.index), end_line, top_line(end_line), "upper" if bull else "lower",
                      extend=status == "forming"),
                 Line(p1.index, bot_line(p1.index), end_line, bot_line(end_line), "lower" if bull else "upper",
                      extend=status == "forming")]
        if target is not None:
            lines.append(Line(brk, target, brk + max(5, cons_bars), target, "target"))
        conf = 0.55 + 0.25 * min(1.0, pole / (8 * a)) + 0.2 * (1 - (p1.price * s - extreme_back) / (0.5 * pole))
        return ChartPattern(_pid(key, pts), key, NAMES[key], "flag", Direction.from_sign(s), status, pts, lines,
                            p0.index, end, min(conf, 1.0), breakout_level=top_line(brk) if brk is not None else None,
                            target=target, invalidation=extreme_back * s, breakout_index=brk, height=pole)
    return None


# ---------------------------------------------------------------------------------
# Orchestration
# ---------------------------------------------------------------------------------

def detect(b: Bars, pivot_sets: list[list[Pivot]], tol_k: float = 0.8, scan_pivots: int = 10,
           recent_bars: int = 250, max_patterns: int = 8) -> list[ChartPattern]:
    """Cherche toutes les figures sur plusieurs jeux de pivots (mineurs / majeurs)."""
    found: dict[str, ChartPattern] = {}
    for pivots in pivot_sets:
        piv = [p for p in pivots if p.confirmed]
        last = len(piv) - 1
        for j in range(last, max(-1, last - scan_pivots), -1):
            candidates = [
                _double(b, piv, j, tol_k), _triple(b, piv, j, tol_k), _head_shoulders(b, piv, j, tol_k),
                _boundaries(b, piv, j, 6), _boundaries(b, piv, j, 5), _flag(b, piv, j),
            ]
            for pat in candidates:
                if pat is not None and pat.id not in found:
                    found[pat.id] = pat

    horizon = b.n - recent_bars
    items = [p for p in found.values() if max(p.end_index, p.breakout_index or 0) >= horizon]
    rank = {"confirmed": 2, "forming": 1, "failed": 0}
    items.sort(key=lambda p: (rank[p.status], p.confidence, p.end_index), reverse=True)

    kept: list[ChartPattern] = []
    for p in items:
        overlap = False
        for k in kept:
            inter = min(p.end_index, k.end_index) - max(p.start_index, k.start_index)
            span = min(p.end_index - p.start_index, k.end_index - k.start_index) or 1
            if inter / span > (0.3 if k.family == p.family else 0.7):
                overlap = True
                break
        if not overlap:
            kept.append(p)
        if len(kept) >= max_patterns:
            break
    kept.sort(key=lambda p: p.end_index)
    return kept


def catalog() -> list[dict]:
    return [{"key": k, "name": v, "family": FAMILY[k]} for k, v in NAMES.items()]
