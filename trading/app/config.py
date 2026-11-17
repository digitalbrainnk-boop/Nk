"""Chargement de la configuration (fichier TOML + variables d'environnement)."""

from __future__ import annotations

import os
import tomllib
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from .core.models import Instrument
from .core.timeframes import Timeframe

ROOT = Path(__file__).resolve().parent.parent
DEFAULT_CONFIG = ROOT / "config.toml"


@dataclass
class AlertRules:
    enabled: bool = True
    min_score: float = 70.0
    cooldown_seconds: int = 300
    types: list[str] = field(default_factory=lambda: ["reversal", "breakout", "rejection", "pattern"])
    timeframes: list[str] = field(default_factory=lambda: [tf.value for tf in Timeframe])
    max_risk: str = "eleve"

    def to_dict(self) -> dict[str, Any]:
        return {"enabled": self.enabled, "min_score": self.min_score,
                "cooldown_seconds": self.cooldown_seconds, "types": list(self.types),
                "timeframes": list(self.timeframes), "max_risk": self.max_risk}

    def update(self, data: dict[str, Any]) -> None:
        """Mise à jour partielle et validée (depuis l'interface)."""
        if "enabled" in data:
            self.enabled = bool(data["enabled"])
        if "min_score" in data:
            self.min_score = max(0.0, min(100.0, float(data["min_score"])))
        if "cooldown_seconds" in data:
            self.cooldown_seconds = max(0, int(data["cooldown_seconds"]))
        if "types" in data:
            allowed = {"reversal", "breakout", "rejection", "pattern"}
            self.types = [t for t in data["types"] if t in allowed]
        if "timeframes" in data:
            valid = {tf.value for tf in Timeframe}
            self.timeframes = [t for t in data["timeframes"] if t in valid]
        if "max_risk" in data and data["max_risk"] in ("faible", "modere", "eleve"):
            self.max_risk = data["max_risk"]


@dataclass
class AnalysisSettings:
    zigzag_atr: float = 1.6
    rdp_atr: float = 3.0
    equal_tolerance_atr: float = 0.8
    max_levels: int = 8
    use_talib: bool = True


@dataclass
class Settings:
    host: str = "127.0.0.1"
    port: int = 8000
    #: accès depuis un téléphone sur le même Wi-Fi (écoute réseau + code d'accès)
    phone: bool = False
    default_provider: str = "simulator"
    history_bars: int = 600
    max_bars: int = 1500
    timeframes: list[Timeframe] = field(default_factory=lambda: list(Timeframe))
    providers: dict[str, dict[str, Any]] = field(default_factory=dict)
    analysis: AnalysisSettings = field(default_factory=AnalysisSettings)
    mtf_weights: dict[str, float] = field(default_factory=dict)
    alerts: AlertRules = field(default_factory=AlertRules)
    instruments: list[Instrument] = field(default_factory=list)
    data_dir: Path = ROOT / "data"

    def provider_options(self, name: str) -> dict[str, Any]:
        return dict(self.providers.get(name, {}))

    def instrument(self, symbol: str) -> Instrument | None:
        return next((i for i in self.instruments if i.symbol == symbol), None)


def load_settings(path: str | Path | None = None, provider_override: str | None = None) -> Settings:
    """Lit ``config.toml``. ``provider_override`` force un fournisseur pour tous les instruments."""
    path = Path(path or os.environ.get("NK_TRADER_CONFIG") or DEFAULT_CONFIG)
    raw: dict[str, Any] = {}
    if path.exists():
        with path.open("rb") as fh:
            raw = tomllib.load(fh)

    app = raw.get("app", {})
    settings = Settings(
        host=os.environ.get("NK_TRADER_HOST", app.get("host", "127.0.0.1")),
        port=int(os.environ.get("NK_TRADER_PORT", app.get("port", 8000))),
        default_provider=provider_override or os.environ.get("NK_TRADER_PROVIDER")
        or app.get("default_provider", "simulator"),
        history_bars=int(app.get("history_bars", 600)),
        max_bars=int(app.get("max_bars", 1500)),
        timeframes=[Timeframe.parse(t) for t in app.get("timeframes", [tf.value for tf in Timeframe])],
        providers=raw.get("providers", {}),
    )

    a = raw.get("analysis", {})
    settings.analysis = AnalysisSettings(
        zigzag_atr=float(a.get("zigzag_atr", 1.6)),
        rdp_atr=float(a.get("rdp_atr", 3.0)),
        equal_tolerance_atr=float(a.get("equal_tolerance_atr", 0.8)),
        max_levels=int(a.get("max_levels", 8)),
        use_talib=bool(a.get("use_talib", True)),
    )
    settings.mtf_weights = {str(k): float(v) for k, v in raw.get("mtf", {}).get("weights", {}).items()}

    rules = AlertRules()
    rules.update(raw.get("alerts", {}))
    settings.alerts = rules

    forced = provider_override or os.environ.get("NK_TRADER_PROVIDER")
    for item in raw.get("instruments", []):
        settings.instruments.append(Instrument(
            symbol=item["symbol"],
            name=item.get("name", item["symbol"]),
            category=item.get("category", "synthetic"),
            provider=forced or item.get("provider") or settings.default_provider,
            digits=int(item.get("digits", 2)),
            aliases=dict(item.get("aliases", {})),
            sim=dict(item.get("sim", {})),
        ))

    secret = os.environ.get("TV_WEBHOOK_SECRET")
    if secret:
        settings.providers.setdefault("tradingview", {})["secret"] = secret
    if os.environ.get("NK_TRADER_DATA"):
        settings.data_dir = Path(os.environ["NK_TRADER_DATA"])
    return settings
