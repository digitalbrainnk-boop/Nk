"""Stockage en mémoire des bougies, pour chaque instrument et chaque unité de temps.

Deux façons d'alimenter le stockage :

* ``apply_tick`` : un prix brut (tick) met à jour simultanément toutes les unités
  de temps (agrégation locale, alignée sur l'époque UTC) ;
* ``upsert_bar`` : un fournisseur qui fournit déjà des bougies (MetaTrader 5,
  webhooks TradingView) met à jour une unité de temps précise.

Dans les deux cas, le stockage signale les bougies **clôturées**, qui déclenchent
l'analyse (on n'analyse jamais une bougie en cours de formation : pas de « repaint »).
"""

from __future__ import annotations

import threading
from dataclasses import dataclass

import numpy as np
import pandas as pd

from ..core.models import Candle, Tick
from ..core.timeframes import Timeframe


@dataclass(slots=True)
class BarUpdate:
    timeframe: Timeframe
    candle: Candle          # bougie en cours (ou nouvellement mise à jour)
    closed: Candle | None   # bougie qui vient de se clôturer, le cas échéant


class CandleSeries:
    """Série de bougies d'une unité de temps (taille bornée)."""

    def __init__(self, timeframe: Timeframe, max_bars: int) -> None:
        self.timeframe = timeframe
        self.max_bars = max_bars
        self.candles: list[Candle] = []

    # -- écriture -----------------------------------------------------------------
    def load(self, candles: list[Candle]) -> None:
        dedup: dict[int, Candle] = {}
        for c in candles:
            dedup[int(c.time)] = c
        self.candles = [dedup[t] for t in sorted(dedup)][-self.max_bars:]

    def apply_tick(self, tick: Tick) -> BarUpdate | None:
        bucket = self.timeframe.bucket(tick.time)
        last = self.candles[-1] if self.candles else None
        if last is not None and bucket < last.time:
            return None  # tick en retard : ignoré
        if last is not None and bucket == last.time:
            last.high = max(last.high, tick.price)
            last.low = min(last.low, tick.price)
            last.close = tick.price
            last.volume += tick.volume
            return BarUpdate(self.timeframe, last, None)
        new = Candle(bucket, tick.price, tick.price, tick.price, tick.price, tick.volume)
        self._append(new)
        return BarUpdate(self.timeframe, new, last)

    def upsert(self, candle: Candle) -> BarUpdate | None:
        last = self.candles[-1] if self.candles else None
        if last is not None and candle.time < last.time:
            # correction d'une bougie passée
            for i in range(len(self.candles) - 1, -1, -1):
                if self.candles[i].time == candle.time:
                    self.candles[i] = candle
                    break
            return None
        if last is not None and candle.time == last.time:
            self.candles[-1] = candle
            return BarUpdate(self.timeframe, candle, None)
        self._append(candle)
        return BarUpdate(self.timeframe, candle, last)

    def _append(self, candle: Candle) -> None:
        self.candles.append(candle)
        if len(self.candles) > self.max_bars * 1.2:
            del self.candles[: len(self.candles) - self.max_bars]

    # -- lecture -------------------------------------------------------------------
    def last(self) -> Candle | None:
        return self.candles[-1] if self.candles else None

    def snapshot(self, limit: int | None = None, closed_only: bool = False) -> list[Candle]:
        data = self.candles[:-1] if closed_only else self.candles
        if limit:
            data = data[-limit:]
        return [Candle(c.time, c.open, c.high, c.low, c.close, c.volume) for c in data]


class CandleStore:
    """Toutes les séries de tous les instruments. Thread-safe (l'analyse tourne
    dans des threads pendant que la boucle asyncio reçoit les ticks)."""

    def __init__(self, timeframes: list[Timeframe], max_bars: int = 1500) -> None:
        self.timeframes = sorted(timeframes, key=lambda tf: tf.seconds)
        self.max_bars = max_bars
        self._series: dict[tuple[str, Timeframe], CandleSeries] = {}
        self._lock = threading.RLock()
        self.last_price: dict[str, float] = {}
        self.last_tick_time: dict[str, float] = {}

    def series(self, symbol: str, tf: Timeframe) -> CandleSeries:
        key = (symbol, tf)
        s = self._series.get(key)
        if s is None:
            s = self._series[key] = CandleSeries(tf, self.max_bars)
        return s

    def load(self, symbol: str, tf: Timeframe, candles: list[Candle]) -> None:
        with self._lock:
            self.series(symbol, tf).load(candles)
            last = self.series(symbol, tf).last()
            if last is not None and symbol not in self.last_price:
                self.last_price[symbol] = last.close

    def apply_tick(self, symbol: str, tick: Tick) -> list[BarUpdate]:
        updates: list[BarUpdate] = []
        with self._lock:
            for tf in self.timeframes:
                upd = self.series(symbol, tf).apply_tick(tick)
                if upd is not None:
                    updates.append(upd)
            if updates:
                self.last_price[symbol] = tick.price
                self.last_tick_time[symbol] = tick.time
        return updates

    def upsert_bar(self, symbol: str, tf: Timeframe, candle: Candle) -> BarUpdate | None:
        with self._lock:
            upd = self.series(symbol, tf).upsert(candle)
            if upd is not None and tf == self.timeframes[0]:
                self.last_price[symbol] = candle.close
            return upd

    def merge_bar(self, symbol: str, tf: Timeframe, candle: Candle) -> list[BarUpdate]:
        """Enregistre une bougie ``tf`` et la fusionne dans les unités de temps supérieures
        (utile quand la source n'envoie qu'une unité de temps, ex. webhooks M1)."""
        updates: list[BarUpdate] = []
        with self._lock:
            base = self.series(symbol, tf)
            prev = base.last()
            is_new_base = prev is None or candle.time > prev.time
            upd = base.upsert(candle)
            if upd is not None:
                updates.append(upd)
            for higher in self.timeframes:
                if higher.seconds <= tf.seconds:
                    continue
                s = self.series(symbol, higher)
                bucket = higher.bucket(candle.time)
                last = s.last()
                if last is not None and bucket < last.time:
                    continue
                if last is not None and bucket == last.time:
                    last.high = max(last.high, candle.high)
                    last.low = min(last.low, candle.low)
                    last.close = candle.close
                    if is_new_base:
                        last.volume += candle.volume
                    updates.append(BarUpdate(higher, last, None))
                else:
                    new = Candle(bucket, candle.open, candle.high, candle.low, candle.close, candle.volume)
                    s._append(new)
                    updates.append(BarUpdate(higher, new, last))
            self.last_price[symbol] = candle.close
        return updates

    def candles(self, symbol: str, tf: Timeframe, limit: int | None = None,
                closed_only: bool = False) -> list[Candle]:
        with self._lock:
            return self.series(symbol, tf).snapshot(limit, closed_only)

    def frame(self, symbol: str, tf: Timeframe, closed_only: bool = True,
              limit: int | None = None) -> pd.DataFrame:
        """Bougies au format pandas (index = heure UTC), prêtes pour l'analyse."""
        return candles_to_frame(self.candles(symbol, tf, limit, closed_only))

    def has_data(self, symbol: str, tf: Timeframe) -> bool:
        with self._lock:
            return bool(self.series(symbol, tf).candles)


def candles_to_frame(candles: list[Candle]) -> pd.DataFrame:
    if not candles:
        return pd.DataFrame(columns=["time", "open", "high", "low", "close", "volume"])
    arr = np.array([(c.time, c.open, c.high, c.low, c.close, c.volume) for c in candles], dtype=float)
    df = pd.DataFrame(arr, columns=["time", "open", "high", "low", "close", "volume"])
    df["time"] = df["time"].astype(np.int64)
    df.index = pd.to_datetime(df["time"], unit="s", utc=True)
    return df


def aggregate_frame(df: pd.DataFrame, tf: Timeframe) -> list[Candle]:
    """Agrège des bougies fines (ex. M1) vers une unité de temps supérieure."""
    if df.empty:
        return []
    bucket = (df["time"].to_numpy() // tf.seconds) * tf.seconds
    g = df.assign(bucket=bucket).groupby("bucket", sort=True)
    agg = g.agg(open=("open", "first"), high=("high", "max"), low=("low", "min"),
                close=("close", "last"), volume=("volume", "sum"))
    return [Candle(int(t), float(r.open), float(r.high), float(r.low), float(r.close), float(r.volume))
            for t, r in zip(agg.index.to_numpy(), agg.itertuples(index=False))]
