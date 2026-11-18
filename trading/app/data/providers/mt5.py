"""Connecteur MetaTrader 5 (paquet Python officiel ``MetaTrader5``, Windows uniquement).

Le terminal MT5 doit être installé et connecté à un compte (démo ou réel) chez un
courtier proposant les instruments (ex. Deriv pour les indices synthétiques).

Les bougies de chaque unité de temps sont lues directement dans le terminal
(``copy_rates_from_pos``) puis relues toutes les ``poll_interval`` secondes : les
heures affichées sont donc celles du **serveur du courtier**, et les bougies H4/D1
sont identiques à celles de MT5.
"""

from __future__ import annotations

import asyncio
import contextlib
from concurrent.futures import ThreadPoolExecutor
from typing import Any

from ...core.models import Candle, Instrument
from ...core.timeframes import Timeframe
from .base import DataProvider, register_provider

try:  # dépendance optionnelle : pip install MetaTrader5 (Windows)
    import MetaTrader5 as mt5
except ImportError:  # pragma: no cover
    mt5 = None


def _tf_map() -> dict[Timeframe, int]:
    return {
        Timeframe.M1: mt5.TIMEFRAME_M1, Timeframe.M5: mt5.TIMEFRAME_M5,
        Timeframe.M15: mt5.TIMEFRAME_M15, Timeframe.M30: mt5.TIMEFRAME_M30,
        Timeframe.H1: mt5.TIMEFRAME_H1, Timeframe.H4: mt5.TIMEFRAME_H4,
        Timeframe.D1: mt5.TIMEFRAME_D1,
    }


@register_provider("mt5")
class MT5Provider(DataProvider):
    streams_ticks = False

    def __init__(self, options: dict[str, Any], instruments: list[Instrument]) -> None:
        super().__init__(options, instruments)
        # Le terminal MT5 n'est pas thread-safe : tous les appels passent par un seul thread.
        self._executor = ThreadPoolExecutor(max_workers=1, thread_name_prefix="mt5")
        self._subscribed: set[str] = set()
        self._task: asyncio.Task | None = None
        self.poll_interval = float(options.get("poll_interval", 0.5))

    async def _call(self, fn, *args):
        return await asyncio.get_running_loop().run_in_executor(self._executor, fn, *args)

    async def start(self, sink) -> None:
        self.sink = sink
        if mt5 is None:
            raise RuntimeError("Paquet MetaTrader5 absent : pip install MetaTrader5 (Windows + terminal MT5)")
        kwargs: dict[str, Any] = {}
        if self.options.get("path"):
            kwargs["path"] = self.options["path"]
        if int(self.options.get("login") or 0):
            kwargs.update(login=int(self.options["login"]), password=str(self.options.get("password", "")),
                          server=str(self.options.get("server", "")))
        ok = await self._call(lambda: mt5.initialize(**kwargs))
        if not ok:
            err = await self._call(mt5.last_error)
            raise RuntimeError(f"Initialisation MT5 impossible : {err}")
        for symbol in self.instruments:
            await self._call(mt5.symbol_select, self.provider_symbol(symbol), True)
        self.set_status("connected", "terminal MetaTrader 5")
        self._task = asyncio.create_task(self._poll(), name="mt5-poll")

    async def stop(self) -> None:
        if self._task:
            self._task.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await self._task
        if mt5 is not None:
            with contextlib.suppress(Exception):
                await self._call(mt5.shutdown)
        self._executor.shutdown(wait=False)
        await super().stop()

    def _rates(self, symbol: str, tf: Timeframe, count: int) -> list[Candle]:
        rates = mt5.copy_rates_from_pos(self.provider_symbol(symbol), _tf_map()[tf], 0, int(count))
        if rates is None:
            return []
        return [Candle(int(r["time"]), float(r["open"]), float(r["high"]), float(r["low"]),
                       float(r["close"]), float(r["tick_volume"])) for r in rates]

    async def load_history(self, symbol: str, tf: Timeframe, count: int) -> list[Candle]:
        return await self._call(self._rates, symbol, tf, count)

    async def subscribe(self, symbol: str) -> None:
        self._subscribed.add(symbol)

    async def _poll(self) -> None:
        while True:
            try:
                for symbol in list(self._subscribed):
                    for tf in Timeframe:
                        for candle in await self._call(self._rates, symbol, tf, 2):
                            self.sink.on_bar(symbol, tf, candle)
                if self.state != "connected":
                    self.set_status("connected", "terminal MetaTrader 5")
            except asyncio.CancelledError:
                raise
            except Exception as exc:
                self.set_status("error", f"lecture MT5 : {exc}")
            await asyncio.sleep(self.poll_interval)
