import numpy as np

from app.analysis import indicators as ind
from app.analysis import mtf
from app.analysis.levels import find_levels, level_events
from app.analysis.zigzag import zigzag
from app.core.models import Direction, Level, TrendState
from app.core.timeframes import Timeframe


def range_levels(make_path):
    pts = [(0, 100)]
    for k in range(1, 9):
        pts.append((k * 15, 110 if k % 2 else 100))
    pts.append((130, 105))
    df = make_path(pts)
    h, l, c, t = (df[k].to_numpy() for k in ("high", "low", "close", "time"))
    atr = ind.atr(h, l, c)
    piv = zigzag(h, l, t, 1.6 * atr)
    return df, find_levels(h, l, c, t, float(atr[-1]), piv, piv, max_levels=6, timeframe="M5")


def test_range_produces_support_and_resistance(make_path):
    _, levels = range_levels(make_path)
    sup = [lv for lv in levels if lv.kind == "support"]
    res = [lv for lv in levels if lv.kind == "resistance"]
    assert any(abs(lv.price - 99.85) < 0.6 and lv.touches >= 3 for lv in sup)
    assert any(abs(lv.price - 110.15) < 0.6 and lv.touches >= 3 for lv in res)
    assert all(0 < lv.strength <= 100 for lv in levels)


def test_breakout_and_rejection_events():
    lv = Level(price=110, low=109.8, high=110.2, kind="resistance", touches=4, strength=90,
               first_time=0, last_time=0, timeframe="M5", major=True)
    o = np.array([108.0, 109.0, 109.2])
    h = np.array([108.5, 109.5, 111.5])
    l = np.array([107.5, 108.8, 109.1])
    c = np.array([108.2, 109.3, 111.3])            # clôture franche au-dessus de la zone
    ev = level_events(o, h, l, c, atr=1.0, levels=[lv])
    assert [(e.type, e.direction) for e in ev] == [("breakout", Direction.BULLISH)]

    c2 = np.array([108.2, 109.3, 109.4])
    h2 = np.array([108.5, 109.5, 110.4])           # mèche dans la zone, clôture repoussée
    o2 = np.array([108.0, 109.0, 109.5])
    ev = level_events(o2, h2, l, c2, atr=1.0, levels=[lv])
    assert [(e.type, e.direction) for e in ev] == [("rejection", Direction.BEARISH)]


def trend(tf, score, rsi=50.0):
    return TrendState(tf, score, "", "", None, None, None, rsi, 25, 1.0, 50.0, 100.0)


def test_risk_low_when_aligned_with_higher_timeframes():
    trends = {"H1": trend("H1", 0.8), "H4": trend("H4", 0.7), "D1": trend("D1", 0.9), "M5": trend("M5", 0.3)}
    r = mtf.assess(Direction.BULLISH, Timeframe.M5, 100.0, 1.0, trends, [])
    assert r.level == "faible" and r.alignment > 0.6
    assert r.stop < 100 < r.target and r.rr >= 1.5


def test_risk_high_against_trend_and_near_obstacle():
    trends = {"H1": trend("H1", -0.8), "H4": trend("H4", -0.7), "D1": trend("D1", -0.9), "M1": trend("M1", 0.2, rsi=80)}
    res = Level(100.5, 100.4, 100.6, "resistance", 5, 90, 0, 0, "M1", True)
    r = mtf.assess(Direction.BULLISH, Timeframe.M1, 100.0, 1.0, trends, [res])
    assert r.level == "eleve" and r.alignment < 0
    assert any("Contre la tendance" in d for d in r.details)


def test_market_bias():
    bias = mtf.market_bias({"H1": trend("H1", 0.8), "D1": trend("D1", 0.6), "M5": trend("M5", -0.2)})
    assert bias["dir"] == "bullish" and bias["bullish"] == 2
