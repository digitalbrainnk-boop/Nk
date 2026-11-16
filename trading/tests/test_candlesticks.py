import numpy as np

from app.analysis import candlesticks as cs
from app.core.models import Direction


def run(bars):
    o, h, l, c = (np.array(x, dtype=float) for x in zip(*bars))
    times = np.arange(len(c)) * 60
    return [hit for hit in cs.detect((o, h, l, c, times), lookback=len(c), use_talib=False) if hit.index == len(c) - 1]


def downtrend(n=8, start=110.0, step=1.5):
    out = []
    for k in range(n):
        o = start - k * step
        c = o - 1.2
        out.append((o, o + 0.2, c - 0.2, c))
    return out


def uptrend(n=8, start=90.0, step=1.5):
    out = []
    for k in range(n):
        o = start + k * step
        c = o + 1.2
        out.append((o, c + 0.2, o - 0.2, c))
    return out


def keys(hits, direction=None):
    return {h.key for h in hits if direction is None or h.direction == direction}


def test_hammer_after_decline_is_bullish():
    bars = downtrend()
    last = bars[-1][3]
    bars.append((last, last + 0.4, last - 3.0, last + 0.3))
    hits = run(bars)
    assert "hammer" in keys(hits, Direction.BULLISH)
    assert "hanging_man" not in keys(hits)


def test_same_shape_after_rally_is_hanging_man():
    bars = uptrend()
    last = bars[-1][3]
    bars.append((last, last + 0.35, last - 3.0, last + 0.3))
    hits = run(bars)
    assert "hanging_man" in keys(hits, Direction.BEARISH)
    assert "hammer" not in keys(hits)


def test_shooting_star_after_rally():
    bars = uptrend()
    last = bars[-1][3]
    bars.append((last, last + 3.0, last - 0.1, last - 0.25))
    assert "shooting_star" in keys(run(bars), Direction.BEARISH)


def test_bullish_engulfing():
    bars = downtrend()
    c1 = bars[-1][3]
    bars.append((c1 + 1.0, c1 + 1.1, c1 - 0.1, c1))            # petite bougie baissière
    bars.append((c1 - 0.1, c1 + 2.2, c1 - 0.2, c1 + 2.0))      # grande haussière qui l'englobe
    assert "engulfing" in keys(run(bars), Direction.BULLISH)


def test_bearish_engulfing():
    bars = uptrend()
    c1 = bars[-1][3]
    bars.append((c1 - 1.0, c1 + 0.1, c1 - 1.1, c1))
    bars.append((c1 + 0.1, c1 + 0.2, c1 - 2.2, c1 - 2.0))
    assert "engulfing" in keys(run(bars), Direction.BEARISH)


def test_morning_star():
    bars = downtrend()
    c = bars[-1][3]
    bars.append((c, c + 0.2, c - 3.2, c - 3.0))                 # longue baissière
    s = c - 3.1
    bars.append((s, s + 0.2, s - 0.6, s - 0.2))                 # étoile (petit corps)
    bars.append((s - 0.3, c - 0.4, s - 0.4, c - 0.5))           # haussière qui remonte dans le 1er corps
    assert "morning_star" in keys(run(bars), Direction.BULLISH)


def test_three_white_soldiers():
    bars = downtrend(6)
    base = bars[-1][3]
    bars += [(base, base + 2.1, base - 0.1, base + 2.0),
             (base + 1.5, base + 3.6, base + 1.4, base + 3.5),
             (base + 3.0, base + 5.1, base + 2.9, base + 5.0)]
    assert "three_soldiers_crows" in keys(run(bars), Direction.BULLISH)


def test_doji_is_neutral():
    bars = uptrend(6) + downtrend(4, start=99)
    c = bars[-1][3]
    bars.append((c, c + 1.0, c - 1.0, c + 0.05))
    hits = run(bars)
    assert keys(hits, Direction.NEUTRAL) & {"doji", "long_legged_doji"}


def test_catalog_lists_native_patterns():
    names = {p["key"] for p in cs.catalog()}
    assert len(cs.PATTERNS) >= 30
    assert {"hammer", "engulfing", "morning_star", "three_methods"} <= names
