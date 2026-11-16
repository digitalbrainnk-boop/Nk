import sys
from pathlib import Path

import numpy as np
import pandas as pd
import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.core.models import Candle  # noqa: E402
from app.data.store import candles_to_frame  # noqa: E402


def path_frame(waypoints, wick=0.15, noise=0.08, step=300, seed=1) -> pd.DataFrame:
    """Bougies suivant une ligne brisée passant par ``waypoints`` = [(index, prix), ...].

    Petit bruit déterministe pour ressembler à un vrai marché sans créer de faux pivots.
    """
    rng = np.random.default_rng(seed)
    idx = np.array([w[0] for w in waypoints], dtype=float)
    px = np.array([w[1] for w in waypoints], dtype=float)
    n = int(idx[-1]) + 1
    closes = np.interp(np.arange(n), idx, px) + rng.uniform(-noise, noise, n)
    # Les points de passage sont exacts (sommets / creux nets).
    for i, p in waypoints:
        closes[int(i)] = p
    opens = np.concatenate([[closes[0]], closes[:-1]])
    highs = np.maximum(opens, closes) + wick
    lows = np.minimum(opens, closes) - wick
    t0 = 1_700_000_100 - 1_700_000_100 % step
    candles = [Candle(t0 + i * step, float(o), float(h), float(lo), float(c), 1.0)
               for i, (o, h, lo, c) in enumerate(zip(opens, highs, lows, closes))]
    return candles_to_frame(candles)


@pytest.fixture
def make_path():
    return path_frame
