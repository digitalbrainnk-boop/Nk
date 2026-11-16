import numpy as np

from app.analysis.zigzag import enforce_alternation, rdp_indices, simplify, zigzag
from app.core.models import Pivot


def test_zigzag_finds_swings_and_alternates(make_path):
    df = make_path([(0, 100), (20, 120), (40, 105), (60, 125), (80, 110), (90, 118)])
    h, l = df["high"].to_numpy(), df["low"].to_numpy()
    piv = zigzag(h, l, df["time"].to_numpy(), 3.0)
    assert [p.kind for p in piv[:5]] == ["L", "H", "L", "H", "L"]
    assert [p.index for p in piv[1:5]] == [20, 40, 60, 80]
    assert all(a.kind != b.kind for a, b in zip(piv, piv[1:]))
    assert piv[-1].confirmed is False          # dernier extrême encore provisoire


def test_zigzag_ignores_moves_below_deviation(make_path):
    df = make_path([(0, 100), (10, 101), (20, 100), (30, 101), (40, 100)])
    piv = zigzag(df["high"].to_numpy(), df["low"].to_numpy(), df["time"].to_numpy(), 5.0)
    assert piv == []


def test_rdp_keeps_major_turns_only():
    x = np.arange(9, dtype=float)
    y = np.array([0, 1, 0.5, 1.5, 10, 9.5, 10.5, 1, 0])
    kept = rdp_indices(x, y, epsilon=2.0)
    assert kept[0] == 0 and kept[-1] == 8
    assert 2 not in kept and 5 not in kept     # petites ondulations supprimées
    assert any(i in kept for i in (4, 6))


def test_simplify_restores_alternation():
    pts = [Pivot(0, 0, 100, "L"), Pivot(5, 5, 110, "H"), Pivot(8, 8, 108, "L"),
           Pivot(10, 10, 112, "H"), Pivot(20, 20, 90, "L")]
    major = simplify(pts, epsilon=5.0)
    assert all(a.kind != b.kind for a, b in zip(major, major[1:]))
    assert max(p.price for p in major if p.kind == "H") == 112


def test_enforce_alternation_keeps_most_extreme():
    pts = [Pivot(0, 0, 100, "H"), Pivot(1, 1, 105, "H"), Pivot(2, 2, 90, "L"), Pivot(3, 3, 85, "L")]
    out = enforce_alternation(pts)
    assert [(p.kind, p.price) for p in out] == [("H", 105), ("L", 85)]
