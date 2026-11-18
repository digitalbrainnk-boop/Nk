"""Chef d'orchestre temps réel.

Fournisseurs ──ticks/bougies──▶ CandleStore ──bougie clôturée──▶ AnalysisEngine (thread)
     │                              │                                 │
     └──── statut ───┐              └─ bougie en cours (≤5/s) ─┐      └─ analyse, MTF, signaux
                     ▼                                          ▼              │
                 ClientManager (WebSocket) ◀─────────── alertes ◀── AlertManager

* chaque clôture de bougie (M1…D1) de chaque instrument déclenche son analyse,
  qu'un graphique soit ouvert ou non : les alertes couvrent toute la liste ;
* les unités de temps supérieures sont analysées en premier, pour que les signaux
  courts disposent d'un contexte MTF à jour.
"""

from __future__ import annotations

import asyncio
import contextlib
import logging
import time
from collections import defaultdict
from concurrent.futures import ThreadPoolExecutor
from typing import Any

from ..analysis.engine import AnalysisEngine, AnalysisSnapshot, select_htf_levels
from ..analysis import mtf
from ..config import Settings
from ..core.models import Candle, Tick, TrendState
from ..core.timeframes import Timeframe
from ..data.providers import DataProvider, create_provider
from ..data.store import BarUpdate, CandleStore
from .alerts import AlertManager
from .clients import ClientManager

log = logging.getLogger(__name__)


class MarketHub:
    FLUSH_INTERVAL = 0.2           # bougies en cours envoyées au plus 5 fois par seconde
    TICKER_INTERVAL = 1.0

    def __init__(self, settings: Settings) -> None:
        self.settings = settings
        self.store = CandleStore(settings.timeframes, settings.max_bars)
        self.engine = AnalysisEngine(settings.analysis, settings.mtf_weights)
        self.alerts = AlertManager(settings.alerts, settings.data_dir / "alert_rules.json")
        self.clients = ClientManager()
        self.instruments = {i.symbol: i for i in settings.instruments}
        self.providers: dict[str, DataProvider] = {}
        self.snapshots: dict[str, dict[str, AnalysisSnapshot]] = defaultdict(dict)
        self.trends: dict[str, dict[str, TrendState]] = defaultdict(dict)
        self.ready: dict[str, bool] = {}
        self.signal_feed: list[dict[str, Any]] = []
        self._dirty: dict[tuple[str, str], Candle] = {}
        self._pending: dict[str, set[Timeframe]] = defaultdict(set)
        self._running: dict[str, asyncio.Task] = {}
        self._tasks: list[asyncio.Task] = []
        self._executor = ThreadPoolExecutor(max_workers=2, thread_name_prefix="analysis")
        self._loop: asyncio.AbstractEventLoop | None = None
        self.started_at = time.time()

    # ------------------------------------------------------------------ démarrage
    async def start(self) -> None:
        self._loop = asyncio.get_running_loop()
        by_provider: dict[str, list] = defaultdict(list)
        for inst in self.settings.instruments:
            by_provider[inst.provider].append(inst)
        for name, insts in by_provider.items():
            options = self.settings.provider_options(name)
            provider = create_provider(name, options, insts)
            self.providers[name] = provider
            try:
                await provider.start(self)
            except Exception as exc:
                provider.set_status("error", str(exc))
                log.error("fournisseur %s indisponible : %s", name, exc)
                continue
            self._tasks.append(asyncio.create_task(self._bootstrap(provider, insts), name=f"boot-{name}"))
        self._tasks.append(asyncio.create_task(self._flush_loop(), name="flush"))
        self._tasks.append(asyncio.create_task(self._ticker_loop(), name="ticker"))

    async def stop(self) -> None:
        for t in self._tasks + list(self._running.values()):
            t.cancel()
        for t in self._tasks:
            with contextlib.suppress(asyncio.CancelledError, Exception):
                await t
        for p in self.providers.values():
            with contextlib.suppress(Exception):
                await p.stop()
        self._executor.shutdown(wait=False, cancel_futures=True)

    RETRY_DELAY = 15.0

    async def _bootstrap(self, provider: DataProvider, insts) -> None:
        """Historique de chaque UT (de D1 vers M1), analyse initiale, puis flux temps réel.

        Un instrument qui échoue (réseau coupé, source pas encore connectée, marché
        indisponible) est réessayé toutes les ``RETRY_DELAY`` secondes jusqu'au succès.
        """
        pending = list(insts)
        while pending:
            failed = []
            for inst in pending:
                try:
                    for tf in sorted(self.settings.timeframes, key=lambda t: -t.seconds):
                        candles = await provider.load_history(inst.symbol, tf, self.settings.history_bars)
                        self.store.load(inst.symbol, tf, candles)
                    await provider.subscribe(inst.symbol)
                except Exception as exc:
                    log.warning("chargement %s impossible (%s) : nouvel essai dans %.0f s",
                                inst.symbol, exc or type(exc).__name__, self.RETRY_DELAY)
                    failed.append(inst)
                    continue
                self._pending[inst.symbol].update(self.settings.timeframes)
                await self._analysis_worker(inst.symbol, initial=True)
                self.ready[inst.symbol] = True
                self.clients.broadcast({"type": "ready", "symbol": inst.symbol})
            pending = failed
            if pending:
                provider.set_status("error", f"{len(pending)} marché(s) en attente de données — "
                                             f"nouvel essai dans {self.RETRY_DELAY:.0f} s")
                await asyncio.sleep(self.RETRY_DELAY)
            elif provider.state == "error":
                provider.set_status("connected", "données reçues")

    # ------------------------------------------------------------ MarketSink
    def on_tick(self, symbol: str, tick: Tick) -> None:
        self._handle(symbol, self.store.apply_tick(symbol, tick))

    def on_bar(self, symbol: str, tf: Timeframe, candle: Candle) -> None:
        provider = self.providers.get(self.instruments[symbol].provider) if symbol in self.instruments else None
        if provider is not None and getattr(provider, "merge_higher", False):
            updates = self.store.merge_bar(symbol, tf, candle)
        else:
            upd = self.store.upsert_bar(symbol, tf, candle)
            updates = [upd] if upd else []
        self._handle(symbol, updates)

    def on_status(self, provider: str, state: str, message: str = "") -> None:
        if self._loop is not None:
            self.clients.broadcast({"type": "status", "providers": self.provider_status()})

    def _handle(self, symbol: str, updates: list[BarUpdate]) -> None:
        closed = []
        for upd in updates:
            self._dirty[(symbol, upd.timeframe.value)] = upd.candle
            if upd.closed is not None:
                closed.append(upd.timeframe)
        if closed and self.ready.get(symbol):
            self._pending[symbol].update(closed)
            if symbol not in self._running or self._running[symbol].done():
                self._running[symbol] = asyncio.create_task(self._analysis_worker(symbol))

    # --------------------------------------------------------------- analyse
    async def _analysis_worker(self, symbol: str, initial: bool = False) -> None:
        await asyncio.sleep(0 if initial else 0.05)   # regroupe les UT qui clôturent ensemble
        loop = asyncio.get_running_loop()
        while self._pending[symbol]:
            tfs = sorted(self._pending[symbol], key=lambda t: -t.seconds)
            self._pending[symbol].clear()
            for tf in tfs:
                try:
                    snap = await loop.run_in_executor(self._executor, self._analyze_sync, symbol, tf)
                except Exception as exc:
                    log.exception("analyse %s %s : %s", symbol, tf.value, exc)
                    continue
                self._publish(symbol, tf, snap, initial)
            self.clients.to_subscribers(symbol, None, self.mtf_message(symbol))

    def _analyze_sync(self, symbol: str, tf: Timeframe) -> AnalysisSnapshot:
        df = self.store.frame(symbol, tf, closed_only=True)
        snaps = self.snapshots[symbol]
        price = self.store.last_price.get(symbol)
        htf = select_htf_levels(snaps, tf, price)
        inst = self.instruments.get(symbol)
        snap = self.engine.analyze(symbol, tf, df, trends=dict(self.trends[symbol]), htf_levels=htf,
                                   previous=snaps.get(tf.value), digits=inst.digits if inst else 5)
        snaps[tf.value] = snap
        if snap.trend is not None:
            self.trends[symbol][tf.value] = snap.trend
        return snap

    def _publish(self, symbol: str, tf: Timeframe, snap: AnalysisSnapshot, initial: bool) -> None:
        if self.clients.wanted(symbol, tf.value):
            self.clients.to_subscribers(symbol, tf.value, {"type": "analysis", "symbol": symbol, "tf": tf.value,
                                                            "analysis": snap.to_dict()})
        if initial:
            return            # pas d'alerte sur l'historique au démarrage
        feed = [s.to_dict() for s in snap.signals if s.score >= 45]
        if feed:
            self.signal_feed = (feed + self.signal_feed)[:200]
            self.clients.broadcast({"type": "signals", "signals": feed})
        for alert in self.alerts.process(snap.signals):
            self.clients.broadcast({"type": "alert", "alert": alert})

    # ------------------------------------------------------------- diffusion
    async def _flush_loop(self) -> None:
        while True:
            await asyncio.sleep(self.FLUSH_INTERVAL)
            if not self._dirty:
                continue
            dirty, self._dirty = self._dirty, {}
            for (symbol, tf), candle in dirty.items():
                if self.clients.wanted(symbol, tf):
                    self.clients.to_subscribers(symbol, tf, {"type": "candle", "symbol": symbol, "tf": tf,
                                                             "candle": candle.to_dict()})

    async def _ticker_loop(self) -> None:
        while True:
            await asyncio.sleep(self.TICKER_INTERVAL)
            if self.clients.clients:
                self.clients.broadcast({"type": "ticker", "prices": self.tickers()})

    def tickers(self) -> dict[str, Any]:
        out = {}
        for symbol in self.instruments:
            price = self.store.last_price.get(symbol)
            if price is None:
                continue
            day = self.store.series(symbol, Timeframe.D1).last() if Timeframe.D1 in self.store.timeframes else None
            change = ((price - day.open) / day.open * 100) if day and day.open else None
            bias = mtf.market_bias(self.trends[symbol], self.settings.mtf_weights) if self.trends[symbol] else None
            out[symbol] = {"price": price, "change": round(change, 3) if change is not None else None,
                           "bias": bias["dir"] if bias else None, "ready": self.ready.get(symbol, False)}
        return out

    # ------------------------------------------------------------- requêtes
    def mtf_message(self, symbol: str) -> dict[str, Any]:
        trends = self.trends[symbol]
        return {"type": "mtf", "symbol": symbol,
                "trends": {tf.value: trends[tf.value].to_dict() for tf in self.settings.timeframes if tf.value in trends},
                "bias": mtf.market_bias(trends, self.settings.mtf_weights) if trends else None}

    def snapshot_message(self, symbol: str, tf: Timeframe, limit: int = 1000) -> dict[str, Any]:
        snap = self.snapshots[symbol].get(tf.value)
        return {"type": "snapshot", "symbol": symbol, "tf": tf.value,
                "instrument": self.instruments[symbol].to_dict(),
                "candles": [c.to_dict() for c in self.store.candles(symbol, tf, limit)],
                "analysis": snap.to_dict() if snap else None,
                "ready": self.ready.get(symbol, False)}

    def risk_check(self, symbol: str, tf: Timeframe, direction: str) -> dict[str, Any]:
        """Évaluation à la demande (bouton Achat/Vente de l'interface)."""
        from ..core.models import Direction
        snap = self.snapshots[symbol].get(tf.value)
        price = self.store.last_price.get(symbol)
        if snap is None or price is None:
            raise LookupError("analyse pas encore disponible")
        res = mtf.assess(Direction(direction), tf, price, snap.atr, self.trends[symbol], snap.levels,
                         snap.htf_levels, weights=self.settings.mtf_weights)
        return res.to_dict()

    def provider_status(self) -> list[dict[str, Any]]:
        return [p.status() for p in self.providers.values()]
