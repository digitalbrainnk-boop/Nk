from app.config import AlertRules
from app.core.models import Direction, RiskAssessment, Signal
from app.services.alerts import AlertManager


def sig(score=80, type_="breakout", tf="M5", t=1000, risk="modere", ref="lvl", direction=Direction.BULLISH, sid=None):
    risk_obj = RiskAssessment(50, risk, "", 0.0, [])
    return Signal(sid or f"X:{tf}:{type_}:{ref}:{t}", "X", tf, t, type_, direction, "titre", "desc", score, 1.0,
                  risk_obj, ref=ref)


def test_score_threshold_and_type_filters():
    m = AlertManager(AlertRules(min_score=70, types=["breakout"]))
    assert m.process([sig(score=65)]) == []
    assert m.process([sig(score=90, type_="reversal", ref="r")]) == []
    fired = m.process([sig(score=75)])
    assert len(fired) == 1 and fired[0]["sound"] == "breakout"


def test_cooldown_blocks_repeats():
    m = AlertManager(AlertRules(cooldown_seconds=300))
    assert m.process([sig(t=1)], now=1000)
    assert m.process([sig(t=2)], now=1100) == []          # même niveau, même sens, < 5 min
    assert m.process([sig(t=3)], now=1400)                # délai écoulé


def test_one_alert_per_bar_with_confluence():
    m = AlertManager(AlertRules())
    fired = m.process([sig(score=72, ref="a"), sig(score=91, type_="pattern", ref="p"), sig(score=80, type_="reversal", ref="r")])
    assert len(fired) == 1
    assert fired[0]["score"] == 91 and len(fired[0]["confluence"]) == 2


def test_risk_filter():
    m = AlertManager(AlertRules(max_risk="modere"))
    assert m.process([sig(risk="eleve")]) == []
    assert m.process([sig(risk="faible", ref="b")])


def test_forming_pattern_never_rings():
    m = AlertManager(AlertRules(min_score=10))
    assert m.process([sig(score=99, type_="pattern", sid="X:M5:pattern-new:abc")]) == []


def test_rules_update_is_validated(tmp_path):
    m = AlertManager(AlertRules(), storage=tmp_path / "rules.json")
    rules = m.update_rules({"min_score": 250, "types": ["breakout", "hack"], "timeframes": ["M1", "W1"], "max_risk": "x"})
    assert rules["min_score"] == 100 and rules["types"] == ["breakout"] and rules["timeframes"] == ["M1"]
    assert rules["max_risk"] == "eleve"
    assert AlertManager(AlertRules(), storage=tmp_path / "rules.json").rules.min_score == 100
