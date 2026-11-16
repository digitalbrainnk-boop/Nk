"""Indicateurs techniques vectorisés (NumPy / Pandas), sans dépendance externe.

Toutes les fonctions prennent des ``np.ndarray`` et renvoient des tableaux de même
longueur (``nan`` tant que la période n'est pas remplie).
"""

from __future__ import annotations

import numpy as np
import pandas as pd


def ema(x: np.ndarray, period: int) -> np.ndarray:
    if len(x) == 0:
        return np.array([], dtype=float)
    out = pd.Series(x, dtype=float).ewm(span=period, adjust=False, min_periods=period).mean().to_numpy()
    return out


def sma(x: np.ndarray, period: int) -> np.ndarray:
    return pd.Series(x, dtype=float).rolling(period, min_periods=period).mean().to_numpy()


def wilder(x: np.ndarray, period: int) -> np.ndarray:
    """Moyenne lissée de Wilder (RMA)."""
    return pd.Series(x, dtype=float).ewm(alpha=1.0 / period, adjust=False, min_periods=period).mean().to_numpy()


def true_range(high: np.ndarray, low: np.ndarray, close: np.ndarray) -> np.ndarray:
    prev = np.concatenate([[close[0]], close[:-1]]) if len(close) else close
    return np.maximum(high - low, np.maximum(np.abs(high - prev), np.abs(low - prev)))


def atr(high: np.ndarray, low: np.ndarray, close: np.ndarray, period: int = 14) -> np.ndarray:
    tr = true_range(high, low, close)
    out = wilder(tr, period)
    # Avant la fin de la période : moyenne simple de ce qui existe (évite les nan au début).
    if len(tr):
        cum = np.cumsum(tr) / np.arange(1, len(tr) + 1)
        out = np.where(np.isnan(out), cum, out)
    return out


def rsi(close: np.ndarray, period: int = 14) -> np.ndarray:
    delta = np.diff(close, prepend=close[0]) if len(close) else close
    gain = wilder(np.clip(delta, 0, None), period)
    loss = wilder(np.clip(-delta, 0, None), period)
    with np.errstate(divide="ignore", invalid="ignore"):
        rs = gain / loss
        out = 100.0 - 100.0 / (1.0 + rs)
    out = np.where((loss == 0) & (gain > 0), 100.0, out)
    return out


def adx(high: np.ndarray, low: np.ndarray, close: np.ndarray, period: int = 14):
    """Renvoie (ADX, +DI, -DI)."""
    n = len(close)
    if n < 2:
        z = np.full(n, np.nan)
        return z, z, z
    up = np.diff(high, prepend=high[0])
    down = -np.diff(low, prepend=low[0])
    plus_dm = np.where((up > down) & (up > 0), up, 0.0)
    minus_dm = np.where((down > up) & (down > 0), down, 0.0)
    tr = wilder(true_range(high, low, close), period)
    with np.errstate(divide="ignore", invalid="ignore"):
        pdi = 100 * wilder(plus_dm, period) / tr
        mdi = 100 * wilder(minus_dm, period) / tr
        dx = 100 * np.abs(pdi - mdi) / (pdi + mdi)
    return wilder(np.nan_to_num(dx), period), pdi, mdi


def slope(x: np.ndarray, period: int) -> np.ndarray:
    """Pente de la régression linéaire glissante (unités de prix par bougie)."""
    n = len(x)
    out = np.full(n, np.nan)
    if n < period:
        return out
    t = np.arange(period, dtype=float)
    t -= t.mean()
    denom = (t ** 2).sum()
    windows = np.lib.stride_tricks.sliding_window_view(x.astype(float), period)
    out[period - 1:] = (windows - windows.mean(axis=1, keepdims=True)) @ t / denom
    return out


def percentile_rank(x: np.ndarray, window: int = 100) -> float | None:
    """Rang centile (0-100) de la dernière valeur dans la fenêtre récente."""
    vals = x[~np.isnan(x)][-window:]
    if len(vals) < 10:
        return None
    return float((vals < vals[-1]).mean() * 100.0)


def last(x: np.ndarray) -> float | None:
    if len(x) == 0 or np.isnan(x[-1]):
        return None
    return float(x[-1])
