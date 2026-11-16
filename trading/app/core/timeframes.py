"""Unités de temps supportées et relations entre elles.

Toutes les bougies sont alignées sur l'époque Unix (UTC) : une bougie H4 commence
à 00:00, 04:00, 08:00… UTC et une bougie D1 à minuit UTC, comme sur Deriv.
Ajouter une unité de temps = ajouter une entrée à ``Timeframe``.
"""

from __future__ import annotations

from enum import Enum


class Timeframe(str, Enum):
    M1 = "M1"
    M5 = "M5"
    M15 = "M15"
    M30 = "M30"
    H1 = "H1"
    H4 = "H4"
    D1 = "D1"

    @property
    def seconds(self) -> int:
        return _SECONDS[self]

    @property
    def label(self) -> str:
        return _LABELS[self]

    def bucket(self, epoch: float) -> int:
        """Heure d'ouverture (epoch, secondes) de la bougie qui contient ``epoch``."""
        sec = self.seconds
        return int(epoch // sec) * sec

    def higher(self) -> list["Timeframe"]:
        """Unités de temps strictement supérieures, de la plus proche à la plus lointaine."""
        return [tf for tf in ALL_TIMEFRAMES if tf.seconds > self.seconds]

    @classmethod
    def parse(cls, value: str) -> "Timeframe":
        value = value.strip().upper()
        aliases = {"D": "D1", "1D": "D1", "1M": "M1", "1H": "H1", "4H": "H4",
                   "1": "M1", "5": "M5", "15": "M15", "30": "M30", "60": "H1", "240": "H4"}
        return cls(aliases.get(value, value))


_SECONDS = {
    Timeframe.M1: 60,
    Timeframe.M5: 300,
    Timeframe.M15: 900,
    Timeframe.M30: 1800,
    Timeframe.H1: 3600,
    Timeframe.H4: 14400,
    Timeframe.D1: 86400,
}

_LABELS = {
    Timeframe.M1: "1 minute",
    Timeframe.M5: "5 minutes",
    Timeframe.M15: "15 minutes",
    Timeframe.M30: "30 minutes",
    Timeframe.H1: "1 heure",
    Timeframe.H4: "4 heures",
    Timeframe.D1: "Journalier",
}

ALL_TIMEFRAMES: list[Timeframe] = sorted(Timeframe, key=lambda tf: tf.seconds)
