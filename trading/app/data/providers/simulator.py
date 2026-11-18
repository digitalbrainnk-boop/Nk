"""Simulateur de marché hors ligne.

Reproduit le comportement statistique des indices synthétiques (Volatility,
Boom/Crash, Step Index) et du Forex, pour développer, tester et faire une démo sans
connexion. L'historique de toutes les unités de temps est dérivé d'une même
trajectoire M1 : les bougies M1…D1 sont donc parfaitement cohérentes entre elles.

``speed`` accélère le temps (60 = une minute simulée par seconde réelle).
"""

from __future__ import annotations

import asyncio
import math
import time
import zlib
from dataclasses import dataclass, field
from typing import Any

import numpy as np

from ...core.models import Candle, Instrument, Tick
from ...core.timeframes import Timeframe
from .base import DataProvider, register_provider

SECONDS_PER_YEAR = 365 * 86400
MAX_HISTORY_DAYS = 260

# Volatilité relative du Forex selon l'heure UTC (sessions Asie / Londres / New York).
FOREX_SESSION = np.array([0.55, 0.5, 0.5, 0.5, 0.55, 0.6, 0.8, 1.15, 1.3, 1.25, 1.1, 1.05,
                          1.2, 1.55, 1.6, 1.45, 1.2, 1.0, 0.85, 0.7, 0.6, 0.5, 0.45, 0.5])


@dataclass
class _ModelState:
    instrument: Instrument
    model: str
    price: float
    vol: float
    tick_seconds: float
    rng: np.random.Generator
    params: dict[str, Any] = field(default_factory=dict)
    drift: float = 0.0          # dérive (log) par minute — processus d'Ornstein-Uhlenbeck
    slow_drift: float = 0.0
    next_tick: float = 0.0      # prochaine échéance (temps virtuel)


@register_provider("simulator")
class SimulatorProvider(DataProvider):
    streams_ticks = True

    def __init__(self, options: dict[str, Any], instruments: list[Instrument]) -> None:
        super().__init__(options, instruments)
        self.speed = max(0.1, min(float(options.get("speed", 1.0)), 600.0))
        self.seed = int(options.get("seed", 7))
        self._states: dict[str, _ModelState] = {}
        self._history: dict[str, dict[Timeframe, list[Candle]]] = {}
        self._subscribed: set[str] = set()
        self._task: asyncio.Task | None = None
        self._t0_real = time.time()
        self._t0_virtual = float(options.get("start_time", self._t0_real))

    # Horloge virtuelle -----------------------------------------------------------
    def now(self) -> float:
        return self._t0_virtual + (time.time() - self._t0_real) * self.speed

    async def start(self, sink) -> None:
        await super().start(sink)
        self.set_status("connected", f"simulation x{self.speed:g}")
        self._task = asyncio.create_task(self._run(), name="simulator")

    async def stop(self) -> None:
        if self._task:
            self._task.cancel()
            try:
                await self._task
            except asyncio.CancelledError:
                pass
        await super().stop()

    # Historique --------------------------------------------------------------------
    async def load_history(self, symbol: str, tf: Timeframe, count: int) -> list[Candle]:
        if symbol not in self._history:
            # La génération est purement numérique : on la sort de la boucle asyncio.
            await asyncio.to_thread(self._build_history, symbol)
        return self._history[symbol].get(tf, [])[-count:]

    def _build_history(self, symbol: str) -> None:
        inst = self.instruments[symbol]
        state = self._state(symbol)
        now = self._t0_virtual
        end = int(now // 60) * 60                       # minute en cours
        minutes = MAX_HISTORY_DAYS * 1440
        times = end - 60 * np.arange(minutes, -1, -1, dtype=np.int64)   # inclut la minute en cours
        o, h, l, c, v = generate_minutes(state, times)
        # Ajuste le niveau pour que le prix actuel = prix de départ configuré.
        target = float(inst.sim.get("start", c[-1]))
        if state.model == "step":
            shift = target - c[-1]
            o, h, l, c = o + shift, h + shift, l + shift, c + shift
        else:
            k = target / c[-1]
            o, h, l, c = o * k, h * k, l * k, c * k
        state.price = float(c[-1])

        out: dict[Timeframe, list[Candle]] = {}
        for tf in Timeframe:
            out[tf] = _aggregate(times, o, h, l, c, v, tf.seconds, inst.digits)
        self._history[symbol] = out

    # Flux temps réel ---------------------------------------------------------------
    async def subscribe(self, symbol: str) -> None:
        self._state(symbol).next_tick = self.now()
        self._subscribed.add(symbol)

    async def _run(self) -> None:
        loop_dt = 0.25
        while True:
            await asyncio.sleep(loop_dt)
            now = self.now()
            for symbol in list(self._subscribed):
                st = self._states[symbol]
                emitted = 0
                while st.next_tick <= now and emitted < 2000:
                    price = _next_tick_price(st, st.next_tick)
                    digits = st.instrument.digits
                    if self.sink:
                        self.sink.on_tick(symbol, Tick(st.next_tick, round(price, digits), 1.0))
                    gap = st.tick_seconds
                    if st.model == "forex":
                        gap = float(st.rng.exponential(st.tick_seconds))
                    st.next_tick += max(gap, 0.05)
                    emitted += 1
                if emitted >= 2000:          # rattrapage impossible : on resynchronise
                    st.next_tick = now

    # États -------------------------------------------------------------------------
    def _state(self, symbol: str) -> _ModelState:
        st = self._states.get(symbol)
        if st is not None:
            return st
        inst = self.instruments[symbol]
        sim = dict(inst.sim)
        model = sim.get("model") or ("forex" if inst.category == "forex" else "volatility")
        default_tick = {"volatility": 2.0, "boom": 1.0, "crash": 1.0, "step": 1.0, "forex": 1.0}
        tick_seconds = float(sim.get("tick_seconds", 1.0 if symbol.startswith("1HZ") else default_tick.get(model, 1.0)))
        seed = (self.seed * 1_000_003 + zlib.crc32(symbol.encode())) & 0xFFFFFFFF
        st = _ModelState(
            instrument=inst, model=model, price=float(sim.get("start", 1000.0)),
            vol=float(sim.get("vol", 0.5)), tick_seconds=tick_seconds,
            rng=np.random.default_rng(seed), params=sim,
        )
        self._states[symbol] = st
        return st


# ---------------------------------------------------------------------------------
# Génération vectorisée de l'historique M1
# ---------------------------------------------------------------------------------

def _ou(rng: np.random.Generator, n: int, theta: float, sigma: float) -> np.ndarray:
    """Processus d'Ornstein-Uhlenbeck discret (dérive qui crée des phases de tendance)."""
    noise = rng.standard_normal(n) * sigma
    out = np.empty(n)
    a = 1.0 - theta
    block = 512
    j = np.arange(block)
    pow_a, inv_a = a ** j, a ** (-j)
    prev = 0.0
    # y[s+j] = a^j * (a*y[s-1] + sum_k a^-k x[s+k]) : récurrence AR(1) vectorisée par blocs
    for s in range(0, n, block):
        x = noise[s:s + block]
        m = len(x)
        y = pow_a[:m] * (a * prev + np.cumsum(x * inv_a[:m]))
        out[s:s + m] = y
        prev = y[-1]
    return out


def generate_minutes(st: _ModelState, times: np.ndarray):
    """Renvoie (open, high, low, close, volume) M1 pour le modèle de l'instrument."""
    rng, n = st.rng, len(times)
    ticks_per_min = max(1.0, 60.0 / st.tick_seconds)
    sig_m = st.vol * math.sqrt(60.0 / SECONDS_PER_YEAR)

    if st.model == "step":
        step = float(st.params.get("step", 0.1))
        k = int(ticks_per_min)
        delta = step * (2 * rng.binomial(k, 0.5, size=n) - k)
        # léger biais de tendance pour faire apparaître des structures
        trend = _ou(rng, n, 1 / 900, step * 0.05)
        close = np.cumsum(delta + trend)
        close = close - close[-1] + float(st.params.get("start", 8000.0))
        open_ = np.concatenate([[close[0] - delta[0]], close[:-1]])
        spread = np.abs(rng.standard_normal((2, n))) * step * math.sqrt(k) * 0.55
        high = np.maximum(open_, close) + spread[0]
        low = np.minimum(open_, close) - spread[1]
        vol = np.full(n, float(k))
        return open_, high, low, close, vol

    seasonal = np.ones(n)
    if st.model == "forex":
        hours = (times // 3600) % 24
        seasonal = FOREX_SESSION[hours]
    drift_scale = 0.025 if st.model == "forex" else 0.015
    drift = _ou(rng, n, 1 / 720, sig_m * drift_scale * 0.06) + _ou(rng, n, 1 / 20000, sig_m * drift_scale * 0.001)
    r = drift + sig_m * seasonal * rng.standard_normal(n)
    spike_up = np.zeros(n)
    spike_dn = np.zeros(n)

    if st.model in ("boom", "crash"):
        every = float(st.params.get("spike_every", 1000))
        lo, hi = 0.0008, 0.0030
        counts = rng.poisson(ticks_per_min / every, size=n)
        sizes = counts * rng.uniform(lo, hi, size=n)
        comp = ticks_per_min / every * (lo + hi) / 2          # compense la dérive des pics
        if st.model == "boom":
            r = r + sizes - comp
            spike_up = sizes
        else:
            r = r - sizes + comp
            spike_dn = sizes

    logp = np.cumsum(r)
    close = np.exp(logp - logp[-1])                     # normalisé : dernier prix = 1
    open_ = np.concatenate([[close[0] * math.exp(-r[0])], close[:-1]])
    wick = np.abs(rng.standard_normal((2, n))) * sig_m * seasonal * 0.6
    high = np.maximum(open_, close) * np.exp(wick[0])
    low = np.minimum(open_, close) * np.exp(-wick[1])
    if st.model == "boom":
        high = np.maximum(high, open_ * np.exp(spike_up + wick[0]))
    elif st.model == "crash":
        low = np.minimum(low, open_ * np.exp(-spike_dn - wick[1]))
    vol = np.maximum(1.0, np.round(ticks_per_min * seasonal * rng.uniform(0.8, 1.2, n)))
    return open_, high, low, close, vol


def _aggregate(times, o, h, l, c, v, seconds: int, digits: int) -> list[Candle]:
    bucket = (times // seconds) * seconds
    starts = np.flatnonzero(np.concatenate([[True], bucket[1:] != bucket[:-1]]))
    ends = np.concatenate([starts[1:] - 1, [len(times) - 1]])
    oo = o[starts]
    hh = np.maximum.reduceat(h, starts)
    ll = np.minimum.reduceat(l, starts)
    cc = c[ends]
    vv = np.add.reduceat(v, starts)
    tt = bucket[starts]
    keep = min(len(tt), 3000)
    rd = lambda x: np.round(x[-keep:], digits)  # noqa: E731
    return [Candle(int(t), float(a), float(b), float(d), float(e), float(f))
            for t, a, b, d, e, f in zip(tt[-keep:], rd(oo), rd(hh), rd(ll), rd(cc), vv[-keep:])]


def _next_tick_price(st: _ModelState, t: float) -> float:
    """Fait avancer le modèle d'un tick et renvoie le nouveau prix."""
    rng, dt = st.rng, st.tick_seconds
    if st.model == "step":
        step = float(st.params.get("step", 0.1))
        st.price += step if rng.random() < 0.5 else -step
        return st.price

    sig = st.vol * math.sqrt(dt / SECONDS_PER_YEAR)
    if st.model == "forex":
        sig *= FOREX_SESSION[int(t // 3600) % 24]
    # dérive lente (mise à jour à chaque tick, échelle par minute)
    frac = dt / 60.0
    st.drift = st.drift * (1 - frac / 720) + rng.standard_normal() * sig * 0.002
    r = st.drift * frac + sig * rng.standard_normal()
    if st.model in ("boom", "crash"):
        every = float(st.params.get("spike_every", 1000))
        comp = 0.0019 / every
        if rng.random() < 1.0 / every:
            size = rng.uniform(0.0008, 0.0030)
            r += size if st.model == "boom" else -size
        r += -comp if st.model == "boom" else comp
    st.price *= math.exp(r)
    return st.price
