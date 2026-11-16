"""Analyse multi-temporelle : croise un signal court terme (M1/M5…) avec la tendance
de fond des unités de temps supérieures (H1/H4/D1) pour évaluer le risque."""

from __future__ import annotations

from ..core.models import Direction, Level, RiskAssessment, TrendState
from ..core.timeframes import Timeframe
from .levels import nearest

DEFAULT_WEIGHTS = {"M5": 0.5, "M15": 0.8, "M30": 0.8, "H1": 1.5, "H4": 1.2, "D1": 1.5}


def alignment(direction: Direction, tf: Timeframe, trends: dict[str, TrendState],
              weights: dict[str, float] | None = None) -> tuple[float, dict[str, float]]:
    """Alignement pondéré du sens du signal avec les UT supérieures, de -1 à +1."""
    weights = weights or DEFAULT_WEIGHTS
    total, acc, used = 0.0, 0.0, {}
    for higher in tf.higher():
        st = trends.get(higher.value)
        w = weights.get(higher.value, 1.0)
        if st is None or w <= 0 or st.label == "Données insuffisantes":
            continue
        used[higher.value] = st.score
        acc += w * st.score * direction.sign
        total += w
    return (acc / total if total else 0.0), used


def market_bias(trends: dict[str, TrendState], weights: dict[str, float] | None = None) -> dict:
    """Biais global de l'instrument (toutes UT confondues), pour la matrice de l'interface."""
    weights = weights or DEFAULT_WEIGHTS
    total = acc = 0.0
    for tf, st in trends.items():
        w = weights.get(tf, 0.4)
        acc += w * st.score
        total += w
    score = acc / total if total else 0.0
    agree = [tf for tf, st in trends.items() if st.direction != Direction.NEUTRAL]
    ups = sum(1 for tf in agree if trends[tf].direction == Direction.BULLISH)
    return {"score": round(score, 3), "dir": Direction.from_sign(score if abs(score) > 0.15 else 0).value,
            "bullish": ups, "bearish": len(agree) - ups, "total": len(trends)}


def assess(direction: Direction, tf: Timeframe, entry: float, atr: float,
           trends: dict[str, TrendState], levels: list[Level], htf_levels: list[Level] | None = None,
           stop_hint: float | None = None, target_hint: float | None = None,
           weights: dict[str, float] | None = None) -> RiskAssessment:
    """Risque d'une position dans ``direction`` à ``entry`` sur l'unité de temps ``tf``."""
    details: list[str] = []
    if direction == Direction.NEUTRAL:
        return RiskAssessment(50.0, "modere", "Signal neutre : attendre une direction", 0.0,
                              ["Pas de sens de trade défini."], entry)

    align, used = alignment(direction, tf, trends, weights)
    score = 50.0 * (1.0 - align) * 0.8          # 0 (aligné) … 80 (totalement contre-tendance)
    if used:
        aligned = [k for k, v in used.items() if v * direction.sign > 0.2]
        against = [k for k, v in used.items() if v * direction.sign < -0.2]
        if aligned:
            details.append(f"Dans le sens de la tendance {', '.join(aligned)}")
        if against:
            details.append(f"Contre la tendance {', '.join(against)}")
        if not aligned and not against:
            details.append("Unités de temps supérieures sans tendance nette")
    else:
        details.append("Pas d'unité de temps supérieure disponible")

    st = trends.get(tf.value)
    if st is not None:
        if st.atr_percentile is not None and st.atr_percentile >= 85:
            score += 12
            details.append(f"Volatilité très élevée (ATR au {st.atr_percentile:.0f}e centile)")
        elif st.atr_percentile is not None and st.atr_percentile <= 10:
            score += 5
            details.append("Volatilité très faible : faux signaux plus fréquents")
        if st.rsi is not None:
            if direction == Direction.BULLISH and st.rsi >= 75:
                score += 10
                details.append(f"RSI en surachat ({st.rsi:.0f})")
            elif direction == Direction.BEARISH and st.rsi <= 25:
                score += 10
                details.append(f"RSI en survente ({st.rsi:.0f})")

    # Marge jusqu'au prochain obstacle (niveau de l'UT courante ou supérieure).
    obstacles = list(levels) + list(htf_levels or [])
    obstacle = nearest(obstacles, entry, direction)
    room = None
    if obstacle is not None and atr > 0:
        edge = obstacle.low if direction == Direction.BULLISH else obstacle.high
        room = abs(edge - entry) / atr
        tag = f"{obstacle.timeframe} " if obstacle.timeframe and obstacle.timeframe != tf.value else ""
        if room < 1.0:
            score += 18
            details.append(f"{tag}{'Résistance' if direction == Direction.BULLISH else 'Support'} très proche ({room:.1f} ATR)")
        elif room < 2.0:
            score += 8
            details.append(f"Obstacle {tag}à {room:.1f} ATR")

    score = max(0.0, min(100.0, score))
    level = "faible" if score < 35 else ("modere" if score < 60 else "eleve")

    # Stop / objectif suggérés.
    stop = stop_hint if stop_hint is not None else entry - direction.sign * 1.5 * atr
    if (stop - entry) * direction.sign >= 0:          # stop du mauvais côté : repli ATR
        stop = entry - direction.sign * 1.5 * atr
    risk_amt = abs(entry - stop)
    target = target_hint
    if target is None and obstacle is not None:
        edge = obstacle.low if direction == Direction.BULLISH else obstacle.high
        if abs(edge - entry) >= risk_amt:
            target = edge
    if target is None or (target - entry) * direction.sign <= 0:
        target = entry + direction.sign * 2.0 * risk_amt
    rr = abs(target - entry) / risk_amt if risk_amt > 0 else None
    if rr is not None and rr < 1.2:
        score = min(100.0, score + 10)
        level = "faible" if score < 35 else ("modere" if score < 60 else "eleve")
        details.append(f"Ratio gain/risque faible ({rr:.1f})")

    verdict = {"faible": "Favorable", "modere": "Prudence", "eleve": "Risque élevé — éviter ou réduire la taille"}[level]
    return RiskAssessment(score=round(score, 1), level=level, verdict=verdict, alignment=round(align, 3),
                          details=details, entry=entry, stop=stop, target=target,
                          rr=round(rr, 2) if rr else None, htf=used)
