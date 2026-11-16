from app.analysis.engine import AnalysisEngine
from app.core.timeframes import Timeframe


def patterns(df):
    snap = AnalysisEngine().analyze("TEST", Timeframe.M5, df)
    return {(p.key, p.status): p for p in snap.chart_patterns}


def find(found, key):
    return [p for (k, _), p in found.items() if k == key]


def test_double_top_confirmed_on_neckline_break(make_path):
    df = make_path([(0, 100), (40, 120), (60, 108), (80, 120.2), (110, 100)])
    found = patterns(df)
    tops = find(found, "double_top")
    assert tops, found.keys()
    p = tops[0]
    assert p.status == "confirmed" and p.direction.value == "bearish"
    assert abs(p.breakout_level - 108) < 0.5
    assert p.target < p.breakout_level                     # objectif sous la ligne de cou


def test_double_bottom_forming_before_break(make_path):
    df = make_path([(0, 120), (40, 100), (60, 112), (80, 99.8), (92, 109)])
    p = find(patterns(df), "double_bottom")
    assert p and p[0].status == "forming" and p[0].direction.value == "bullish"


def test_head_and_shoulders(make_path):
    df = make_path([(0, 100), (30, 115), (45, 108), (65, 122), (85, 108.5), (105, 115.5), (135, 100)])
    hs = find(patterns(df), "head_shoulders")
    assert hs, "tête-épaules non détectée"
    p = hs[0]
    assert p.status == "confirmed" and p.direction.value == "bearish"
    head = max(p.points, key=lambda x: x.price)
    assert abs(head.price - 122.15) < 0.5                  # 122 + mèche
    assert any(ln.role == "neckline" for ln in p.lines)


def test_inverse_head_and_shoulders(make_path):
    df = make_path([(0, 130), (30, 115), (45, 122), (65, 108), (85, 121.5), (105, 114.5), (135, 130)])
    p = find(patterns(df), "inverse_head_shoulders")
    assert p and p[0].status == "confirmed" and p[0].direction.value == "bullish"


def test_ascending_triangle_forming(make_path):
    df = make_path([(0, 100), (20, 120), (35, 105), (50, 120), (62, 110), (74, 120), (84, 114), (90, 118)])
    tri = find(patterns(df), "ascending_triangle")
    assert tri and tri[0].status == "forming"
    roles = {ln.role for ln in tri[0].lines}
    assert {"upper", "lower"} <= roles


def test_ascending_triangle_breakout_confirms(make_path):
    df = make_path([(0, 100), (20, 120), (35, 105), (50, 120), (62, 110), (74, 120), (84, 114), (90, 118), (96, 124)])
    tri = find(patterns(df), "ascending_triangle")
    assert tri and tri[0].status == "confirmed" and tri[0].direction.value == "bullish"
    assert tri[0].target > 124


def test_no_pattern_on_straight_trend(make_path):
    df = make_path([(0, 100), (120, 160)])
    assert patterns(df) == {}
