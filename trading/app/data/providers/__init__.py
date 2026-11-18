"""Fournisseurs de données. Importer un module suffit à l'enregistrer."""

from . import deriv, mt5, simulator, tradingview  # noqa: F401
from .base import PROVIDERS, DataProvider, MarketSink, create_provider, register_provider  # noqa: F401
