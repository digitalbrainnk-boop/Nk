"""Réception des données via les webhooks d'alertes TradingView.

TradingView envoie une requête HTTP POST (``/api/webhook/tradingview``) à chaque
déclenchement d'alerte. Deux formats JSON sont acceptés dans le message de l'alerte :

Bougie (recommandé, alerte « une fois par clôture de barre » sur un graphique 1 min) ::

    {"secret": "MON_SECRET", "symbol": "{{ticker}}", "tf": "{{interval}}",
     "time": "{{time}}", "open": {{open}}, "high": {{high}}, "low": {{low}},
     "close": {{close}}, "volume": {{volume}}}

Prix simple ::

    {"secret": "MON_SECRET", "symbol": "{{ticker}}", "price": {{close}}, "time": "{{timenow}}"}

Une bougie M1 est automatiquement fusionnée dans M5…D1. Un champ ``bars`` (liste
de bougies) permet aussi de pré-charger un historique.
"""

from __future__ import annotations

import hmac
from datetime import datetime
from typing import Any

from ...core.models import Candle, Instrument, Tick
from ...core.timeframes import Timeframe
from .base import DataProvider, register_provider


def parse_time(value: Any) -> float:
    """Accepte epoch (s ou ms) ou ISO-8601 (format des variables {{time}} de TradingView)."""
    if value is None or value == "":
        return datetime.now().timestamp()
    if isinstance(value, (int, float)) or (isinstance(value, str) and value.replace(".", "", 1).isdigit()):
        v = float(value)
        return v / 1000.0 if v > 1e11 else v
    text = str(value).strip().replace("Z", "+00:00")
    return datetime.fromisoformat(text).timestamp()


@register_provider("tradingview")
class TradingViewProvider(DataProvider):
    streams_ticks = False
    #: une bougie reçue est fusionnée dans les unités de temps supérieures
    merge_higher = True

    def __init__(self, options: dict[str, Any], instruments: list[Instrument]) -> None:
        super().__init__(options, instruments)
        self.secret = str(options.get("secret", "") or "")
        self.received = 0

    async def start(self, sink) -> None:
        self.sink = sink
        if self.secret:
            self.set_status("connected", "en attente des webhooks TradingView")
        else:
            self.set_status("error", "secret webhook non défini (config.toml ou TV_WEBHOOK_SECRET)")

    async def load_history(self, symbol: str, tf: Timeframe, count: int) -> list[Candle]:
        return []   # pas d'historique via webhook : utiliser le champ "bars"

    async def subscribe(self, symbol: str) -> None:
        return None

    def check_secret(self, provided: str | None) -> bool:
        return bool(self.secret) and hmac.compare_digest(str(provided or ""), self.secret)

    def ingest(self, payload: dict[str, Any]) -> dict[str, Any]:
        """Traite un message webhook déjà authentifié. Renvoie un résumé."""
        raw_symbol = str(payload.get("symbol") or payload.get("ticker") or "")
        raw_symbol = raw_symbol.split(":")[-1]          # "FX:EURUSD" -> "EURUSD"
        symbol = self.symbol_from_provider(raw_symbol)
        if symbol is None:
            raise ValueError(f"symbole inconnu : {raw_symbol!r} (ajoutez-le dans config.toml)")
        tf = Timeframe.parse(str(payload.get("tf") or payload.get("interval") or "M1"))
        count = 0
        for bar in payload.get("bars") or []:
            self.sink.on_bar(symbol, tf, self._candle(bar, tf))
            count += 1
        if all(k in payload for k in ("open", "high", "low", "close")):
            self.sink.on_bar(symbol, tf, self._candle(payload, tf))
            count += 1
        elif "price" in payload:
            self.sink.on_tick(symbol, Tick(parse_time(payload.get("time")), float(payload["price"]),
                                           float(payload.get("volume", 1.0))))
            count += 1
        self.received += count
        self.set_status("connected", f"{self.received} messages reçus")
        return {"symbol": symbol, "tf": tf.value, "accepted": count}

    @staticmethod
    def _candle(bar: dict[str, Any], tf: Timeframe) -> Candle:
        t = tf.bucket(parse_time(bar.get("time")))
        return Candle(t, float(bar["open"]), float(bar["high"]), float(bar["low"]),
                      float(bar["close"]), float(bar.get("volume") or 0.0))
