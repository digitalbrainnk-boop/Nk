"""Extraction des points de retournement : ZigZag + Ramer-Douglas-Peucker.

1. ``zigzag`` suit les plus hauts/plus bas et valide un pivot dès que le prix
   repart dans l'autre sens d'au moins ``k × ATR`` : on obtient la structure
   « mineure » (tous les swings significatifs).
2. ``rdp`` (Ramer-Douglas-Peucker) simplifie cette ligne brisée en ne gardant
   que les sommets qui s'écartent de plus d'``epsilon`` de la corde : on obtient
   la structure « majeure », débarrassée du bruit, sur laquelle les figures
   chartistes de grande taille sont recherchées.
"""

from __future__ import annotations

import numpy as np

from ..core.models import Pivot


def zigzag(high: np.ndarray, low: np.ndarray, times: np.ndarray, deviation: np.ndarray | float) -> list[Pivot]:
    """ZigZag sur les plus hauts / plus bas.

    ``deviation`` : amplitude minimale d'un retournement, en prix (scalaire ou
    tableau par bougie, typiquement ``k × ATR``). Le dernier pivot est provisoire
    (``confirmed=False``) : il peut encore être prolongé.
    """
    n = len(high)
    if n < 3:
        return []
    dev = np.broadcast_to(np.asarray(deviation, dtype=float), (n,))
    pivots: list[Pivot] = []

    # Direction initiale : premier mouvement qui dépasse la déviation.
    hi_i = lo_i = 0
    direction = 0
    for i in range(1, n):
        if high[i] > high[hi_i]:
            hi_i = i
        if low[i] < low[lo_i]:
            lo_i = i
        if high[hi_i] - low[lo_i] >= dev[i]:
            direction = 1 if hi_i > lo_i else -1
            first = lo_i if direction == 1 else hi_i
            kind = "L" if direction == 1 else "H"
            price = low[first] if kind == "L" else high[first]
            pivots.append(Pivot(int(first), int(times[first]), float(price), kind))
            ext_i = hi_i if direction == 1 else lo_i
            start = i
            break
    else:
        return []

    for i in range(start + 1, n):
        if direction == 1:          # on monte : on cherche un plus haut puis une baisse
            if high[i] > high[ext_i]:
                ext_i = i
            elif high[ext_i] - low[i] >= dev[i]:
                pivots.append(Pivot(int(ext_i), int(times[ext_i]), float(high[ext_i]), "H"))
                direction, ext_i = -1, i
        else:                       # on descend
            if low[i] < low[ext_i]:
                ext_i = i
            elif high[i] - low[ext_i] >= dev[i]:
                pivots.append(Pivot(int(ext_i), int(times[ext_i]), float(low[ext_i]), "L"))
                direction, ext_i = 1, i

    # Dernier extrême en cours (provisoire).
    kind = "H" if direction == 1 else "L"
    price = high[ext_i] if kind == "H" else low[ext_i]
    if ext_i != pivots[-1].index:
        pivots.append(Pivot(int(ext_i), int(times[ext_i]), float(price), kind, confirmed=False))
    return pivots


def rdp_indices(x: np.ndarray, y: np.ndarray, epsilon: float, vertical: bool = True) -> list[int]:
    """Ramer-Douglas-Peucker itératif. Renvoie les indices des points conservés.

    ``vertical=True`` : distance mesurée verticalement (en prix), indépendante de
    l'échelle de temps — c'est le mode adapté aux graphiques de cours.
    """
    n = len(x)
    if n <= 2:
        return list(range(n))
    keep = np.zeros(n, dtype=bool)
    keep[0] = keep[-1] = True
    stack = [(0, n - 1)]
    while stack:
        a, b = stack.pop()
        if b - a < 2:
            continue
        xs, ys = x[a + 1:b], y[a + 1:b]
        dx, dy = x[b] - x[a], y[b] - y[a]
        if vertical:
            line = y[a] + (dy / dx if dx else 0.0) * (xs - x[a])
            d = np.abs(ys - line)
        else:
            norm = np.hypot(dx, dy) or 1.0
            d = np.abs(dy * (xs - x[a]) - dx * (ys - y[a])) / norm
        k = int(np.argmax(d))
        if d[k] > epsilon:
            idx = a + 1 + k
            keep[idx] = True
            stack.append((a, idx))
            stack.append((idx, b))
    return list(np.flatnonzero(keep))


def enforce_alternation(pivots: list[Pivot]) -> list[Pivot]:
    """Garantit l'alternance sommet/creux (garde le plus extrême de deux pivots consécutifs du même type)."""
    out: list[Pivot] = []
    for p in pivots:
        if out and out[-1].kind == p.kind:
            prev = out[-1]
            better = (p.price >= prev.price) if p.kind == "H" else (p.price <= prev.price)
            if better:
                out[-1] = p
            continue
        out.append(p)
    return out


def simplify(pivots: list[Pivot], epsilon: float) -> list[Pivot]:
    """Structure majeure : RDP appliqué à la ligne brisée du ZigZag."""
    if len(pivots) <= 3:
        return list(pivots)
    x = np.array([p.index for p in pivots], dtype=float)
    y = np.array([p.price for p in pivots], dtype=float)
    kept = [pivots[i] for i in rdp_indices(x, y, epsilon)]
    return enforce_alternation(kept)
