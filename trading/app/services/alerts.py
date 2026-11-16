"""Gestion des alertes : filtrage des signaux forts, anti-répétition, historique.

Le son est joué par le navigateur (Web Audio) ; le serveur indique quel profil
sonore utiliser (``sound``) selon le type de signal.
"""

from __future__ import annotations

import json
import logging
import time
from collections import deque
from pathlib import Path
from typing import Any

from ..config import AlertRules
from ..core.models import Signal

log = logging.getLogger(__name__)

RISK_ORDER = {"faible": 0, "modere": 1, "eleve": 2}


def sound_for(signal: Signal) -> str:
    if signal.type == "breakout":
        return "breakout"
    if signal.type == "pattern":
        return "pattern"
    return "bullish" if signal.direction.value == "bullish" else "bearish"


class AlertManager:
    def __init__(self, rules: AlertRules, storage: Path | None = None, history_size: int = 300) -> None:
        self.rules = rules
        self.storage = storage
        self.history: deque[dict[str, Any]] = deque(maxlen=history_size)
        self._last_fired: dict[tuple, float] = {}
        self._seen_ids: set[str] = set()
        self._load()

    # Persistance des règles modifiées depuis l'interface ------------------------
    def _load(self) -> None:
        if self.storage and self.storage.exists():
            try:
                self.rules.update(json.loads(self.storage.read_text(encoding="utf-8")))
            except Exception as exc:  # fichier corrompu : on garde la configuration
                log.warning("règles d'alerte illisibles (%s) : %s", self.storage, exc)

    def update_rules(self, data: dict[str, Any]) -> dict[str, Any]:
        self.rules.update(data)
        if self.storage:
            self.storage.parent.mkdir(parents=True, exist_ok=True)
            self.storage.write_text(json.dumps(self.rules.to_dict(), indent=2), encoding="utf-8")
        return self.rules.to_dict()

    # Filtrage -------------------------------------------------------------------
    def eligible(self, signal: Signal, now: float | None = None) -> bool:
        r = self.rules
        if not r.enabled or signal.type not in r.types or signal.timeframe not in r.timeframes:
            return False
        if signal.score < r.min_score:
            return False
        if signal.type == "pattern" and "pattern-new" in signal.id:
            return False                      # figure en formation : information seulement
        if signal.risk is not None and RISK_ORDER.get(signal.risk.level, 2) > RISK_ORDER.get(r.max_risk, 2):
            return False
        if signal.id in self._seen_ids:
            return False
        now = time.time() if now is None else now
        key = (signal.symbol, signal.timeframe, signal.type, signal.direction.value, signal.ref)
        last = self._last_fired.get(key)
        if last is not None and now - last < r.cooldown_seconds:
            return False
        return True

    def process(self, signals: list[Signal], now: float | None = None) -> list[dict[str, Any]]:
        """Une seule alerte par (instrument, UT, bougie) : le signal le plus fort, les
        autres signaux éligibles de la même bougie sont listés en « confluence »."""
        now = time.time() if now is None else now
        groups: dict[tuple, list[Signal]] = {}
        for s in sorted(signals, key=lambda x: -x.score):
            if self.eligible(s, now):
                groups.setdefault((s.symbol, s.timeframe, s.time), []).append(s)
        fired = []
        for group in groups.values():
            best, others = group[0], group[1:]
            for s in group:
                self._last_fired[(s.symbol, s.timeframe, s.type, s.direction.value, s.ref)] = now
                self._seen_ids.add(s.id)
            alert = {**best.to_dict(), "sound": sound_for(best), "created": now,
                     "confluence": [s.title for s in others]}
            self.history.appendleft(alert)
            fired.append(alert)
        if len(self._seen_ids) > 5000:
            self._seen_ids = {a["id"] for a in self.history}
        return fired

    def recent(self, limit: int = 100) -> list[dict[str, Any]]:
        return list(self.history)[:limit]
