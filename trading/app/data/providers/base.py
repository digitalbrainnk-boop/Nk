"""Interface commune des fournisseurs de données de marché.

Pour brancher une nouvelle source (un autre courtier, une API crypto…) :

1. créer un module dans ce dossier avec une classe héritant de ``DataProvider`` ;
2. la décorer avec ``@register_provider("nom")`` ;
3. l'importer dans ``providers/__init__.py`` ;
4. indiquer ``provider = "nom"`` sur les instruments concernés dans ``config.toml``.

Un fournisseur pousse les données vers un ``MarketSink`` : soit des ticks
(``on_tick``, agrégés localement en bougies), soit des bougies toutes faites
(``on_bar``).
"""

from __future__ import annotations

import abc
import logging
from typing import Any, Protocol

from ...core.models import Candle, Instrument, Tick
from ...core.timeframes import Timeframe

log = logging.getLogger(__name__)


class MarketSink(Protocol):
    def on_tick(self, symbol: str, tick: Tick) -> None: ...
    def on_bar(self, symbol: str, tf: Timeframe, candle: Candle) -> None: ...
    def on_status(self, provider: str, state: str, message: str = "") -> None: ...


class DataProvider(abc.ABC):
    """Classe de base d'un fournisseur de données."""

    name: str = "base"
    #: True si le fournisseur envoie des ticks (agrégés en bougies par le stockage).
    streams_ticks: bool = True

    def __init__(self, options: dict[str, Any], instruments: list[Instrument]) -> None:
        self.options = options
        self.instruments = {i.symbol: i for i in instruments}
        self.sink: MarketSink | None = None
        self.state = "stopped"
        self.message = ""

    # Cycle de vie ----------------------------------------------------------------
    async def start(self, sink: MarketSink) -> None:
        """Ouvre la connexion. Appelé une fois au démarrage."""
        self.sink = sink
        self.set_status("connected")

    async def stop(self) -> None:
        self.set_status("stopped")

    # Données -------------------------------------------------------------------
    @abc.abstractmethod
    async def load_history(self, symbol: str, tf: Timeframe, count: int) -> list[Candle]:
        """Renvoie les ``count`` dernières bougies (la dernière peut être en cours)."""

    @abc.abstractmethod
    async def subscribe(self, symbol: str) -> None:
        """Démarre le flux temps réel de l'instrument."""

    async def unsubscribe(self, symbol: str) -> None:  # pragma: no cover - optionnel
        return None

    # Utilitaires -----------------------------------------------------------------
    def provider_symbol(self, symbol: str) -> str:
        inst = self.instruments.get(symbol)
        return inst.provider_symbol(self.name) if inst else symbol

    def symbol_from_provider(self, provider_symbol: str) -> str | None:
        for inst in self.instruments.values():
            if inst.provider_symbol(self.name) == provider_symbol or inst.symbol == provider_symbol:
                return inst.symbol
        return None

    def set_status(self, state: str, message: str = "") -> None:
        self.state, self.message = state, message
        if state == "error":
            log.warning("[%s] %s", self.name, message)
        else:
            log.info("[%s] %s %s", self.name, state, message)
        if self.sink is not None:
            self.sink.on_status(self.name, state, message)

    def status(self) -> dict[str, Any]:
        return {"name": self.name, "state": self.state, "message": self.message,
                "symbols": sorted(self.instruments)}


PROVIDERS: dict[str, type[DataProvider]] = {}


def register_provider(name: str):
    def deco(cls: type[DataProvider]) -> type[DataProvider]:
        cls.name = name
        PROVIDERS[name] = cls
        return cls
    return deco


def create_provider(name: str, options: dict[str, Any], instruments: list[Instrument]) -> DataProvider:
    try:
        cls = PROVIDERS[name]
    except KeyError as exc:
        raise ValueError(f"Fournisseur inconnu : {name!r} (disponibles : {', '.join(sorted(PROVIDERS))})") from exc
    return cls(options, instruments)
