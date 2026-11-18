"""Connecteur temps réel Deriv (indices synthétiques + Forex) via l'API WebSocket publique.

Documentation : https://api.deriv.com — aucune authentification n'est nécessaire
pour les données de marché. Le connecteur :

* charge l'historique de chaque unité de temps (``ticks_history`` style ``candles``,
  granularités 60…86400 s, bougies alignées sur l'époque UTC comme le stockage local) ;
* s'abonne aux ticks (``ticks``) — une seule souscription par instrument, les
  bougies M1…D1 sont agrégées localement ;
* garde la connexion vivante (``ping``) et se reconnecte automatiquement, puis
  recharge les dernières bougies pour combler le trou éventuel.
"""

from __future__ import annotations

import asyncio
import contextlib
import itertools
import json
import logging
from typing import Any

from ...core.models import Candle, Instrument, Tick
from ...core.timeframes import Timeframe
from .base import DataProvider, register_provider

log = logging.getLogger(__name__)

try:  # dépendance optionnelle (incluse dans requirements.txt)
    import websockets
except ImportError:  # pragma: no cover
    websockets = None


@register_provider("deriv")
class DerivProvider(DataProvider):
    streams_ticks = True
    MAX_COUNT = 5000

    def __init__(self, options: dict[str, Any], instruments: list[Instrument]) -> None:
        super().__init__(options, instruments)
        base = options.get("url", "wss://ws.derivws.com/websockets/v3")
        self.url = f"{base}?app_id={options.get('app_id', '1089')}"
        self._ws = None
        self._ids = itertools.count(1)
        self._pending: dict[int, asyncio.Future] = {}
        self._subscribed: set[str] = set()
        self._connected = asyncio.Event()
        self._tasks: list[asyncio.Task] = []
        self._stopping = False

    # Cycle de vie ----------------------------------------------------------------
    async def start(self, sink) -> None:
        if websockets is None:
            raise RuntimeError("Le paquet 'websockets' est requis pour Deriv (pip install websockets)")
        self.sink = sink
        self.set_status("connecting", self.url)
        self._tasks.append(asyncio.create_task(self._connection_loop(), name="deriv-conn"))
        try:
            await asyncio.wait_for(self._connected.wait(), timeout=20)
        except asyncio.TimeoutError:
            self.set_status("error", "connexion à Deriv impossible (réseau, pare-feu ou app_id ?)")

    async def stop(self) -> None:
        self._stopping = True
        for t in self._tasks:
            t.cancel()
        for t in self._tasks:
            with contextlib.suppress(asyncio.CancelledError, Exception):
                await t
        if self._ws is not None:
            with contextlib.suppress(Exception):
                await self._ws.close()
        await super().stop()

    async def _connection_loop(self) -> None:
        delay = 1.0
        first = True
        while not self._stopping:
            try:
                async with websockets.connect(self.url, ping_interval=25, ping_timeout=20,
                                              max_size=2**24, open_timeout=15) as ws:
                    self._ws = ws
                    self._connected.set()
                    self.set_status("connected", "flux temps réel Deriv")
                    delay = 1.0
                    keepalive = asyncio.create_task(self._keepalive())
                    if not first:
                        asyncio.create_task(self._resubscribe())
                    first = False
                    try:
                        async for raw in ws:
                            self._dispatch(json.loads(raw))
                    finally:
                        keepalive.cancel()
            except asyncio.CancelledError:
                raise
            except Exception as exc:  # réseau coupé, DNS, refus…
                self.set_status("error", f"déconnecté : {exc}")
            self._ws = None
            self._connected.clear()
            for fut in self._pending.values():
                if not fut.done():
                    fut.set_exception(ConnectionError("connexion Deriv perdue"))
            self._pending.clear()
            if self._stopping:
                break
            self.set_status("connecting", f"reconnexion dans {delay:.0f} s")
            await asyncio.sleep(delay)
            delay = min(delay * 2, 30.0)

    async def _keepalive(self) -> None:
        while True:
            await asyncio.sleep(30)
            with contextlib.suppress(Exception):
                await self._request({"ping": 1}, timeout=10)

    # Requêtes --------------------------------------------------------------------
    async def _request(self, payload: dict[str, Any], timeout: float = 20.0) -> dict[str, Any]:
        await asyncio.wait_for(self._connected.wait(), timeout=timeout)
        req_id = next(self._ids)
        fut: asyncio.Future = asyncio.get_running_loop().create_future()
        self._pending[req_id] = fut
        await self._ws.send(json.dumps({**payload, "req_id": req_id}))
        try:
            msg = await asyncio.wait_for(fut, timeout=timeout)
        finally:
            self._pending.pop(req_id, None)
        if "error" in msg:
            err = msg["error"]
            raise RuntimeError(f"Deriv {err.get('code')}: {err.get('message')}")
        return msg

    def _dispatch(self, msg: dict[str, Any]) -> None:
        req_id = msg.get("req_id")
        mtype = msg.get("msg_type")
        if mtype == "tick" and "tick" in msg:
            tick = msg["tick"]
            symbol = self.symbol_from_provider(tick.get("symbol", ""))
            if symbol and self.sink:
                self.sink.on_tick(symbol, Tick(float(tick["epoch"]), float(tick["quote"]), 1.0))
        if req_id in self._pending:
            fut = self._pending[req_id]
            if not fut.done():
                fut.set_result(msg)

    # API DataProvider ------------------------------------------------------------
    async def load_history(self, symbol: str, tf: Timeframe, count: int) -> list[Candle]:
        msg = await self._request({
            "ticks_history": self.provider_symbol(symbol),
            "style": "candles",
            "granularity": tf.seconds,
            "count": min(int(count), self.MAX_COUNT),
            "end": "latest",
            "adjust_start_time": 1,
        }, timeout=30)
        return [Candle(int(c["epoch"]), float(c["open"]), float(c["high"]), float(c["low"]),
                       float(c["close"]), 0.0) for c in msg.get("candles", [])]

    async def subscribe(self, symbol: str) -> None:
        self._subscribed.add(symbol)
        try:
            await self._request({"ticks": self.provider_symbol(symbol), "subscribe": 1})
        except Exception as exc:
            # ex. marché Forex fermé le week-end : on garde l'historique et on continue
            self.set_status("connected", f"{symbol} : pas de flux ({exc})")

    async def _resubscribe(self) -> None:
        """Après une reconnexion : comble le trou puis relance les flux."""
        for symbol in list(self._subscribed):
            for tf in Timeframe:
                with contextlib.suppress(Exception):
                    for candle in await self.load_history(symbol, tf, 5):
                        self.sink.on_bar(symbol, tf, candle)
            with contextlib.suppress(Exception):
                await self._request({"ticks": self.provider_symbol(symbol), "subscribe": 1})

    async def active_symbols(self) -> list[dict[str, Any]]:
        """Liste des instruments disponibles chez Deriv (pour en ajouter dans config.toml)."""
        msg = await self._request({"active_symbols": "brief", "product_type": "basic"})
        return [{"symbol": s.get("symbol"), "name": s.get("display_name"), "market": s.get("market"),
                 "submarket": s.get("submarket"), "open": bool(s.get("exchange_is_open"))}
                for s in msg.get("active_symbols", [])]
