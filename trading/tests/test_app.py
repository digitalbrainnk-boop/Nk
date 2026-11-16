"""Tests de bout en bout : serveur complet avec le simulateur et les webhooks TradingView."""

import time

import pytest
from fastapi.testclient import TestClient

from app.config import load_settings
from app.core.timeframes import Timeframe
from app.main import create_app

CONFIG = """
[app]
history_bars = 300
[providers.simulator]
speed = 60
[providers.tradingview]
secret = "s3cret"
[alerts]
min_score = 60
[[instruments]]
symbol = "R_75"
name = "Volatility 75 Index"
category = "synthetic"
digits = 2
sim = { model = "volatility", start = 1000.0, vol = 0.75 }
[[instruments]]
symbol = "EURUSD"
name = "Euro / Dollar"
category = "forex"
provider = "tradingview"
digits = 5
aliases = { tradingview = "EURUSD" }
"""


@pytest.fixture(scope="module")
def client(tmp_path_factory):
    path = tmp_path_factory.mktemp("cfg") / "config.toml"
    path.write_text(CONFIG, encoding="utf-8")
    settings = load_settings(path)
    settings.data_dir = path.parent
    with TestClient(create_app(settings)) as c:
        deadline = time.time() + 30
        while time.time() < deadline and not c.get("/api/status").json()["ready"].get("R_75"):
            time.sleep(0.2)
        yield c


def test_status_and_instruments(client):
    st = client.get("/api/status").json()
    names = {p["name"]: p["state"] for p in st["providers"]}
    assert names["simulator"] == "connected" and names["tradingview"] == "connected"
    inst = client.get("/api/instruments").json()
    assert {i["symbol"] for i in inst} == {"R_75", "EURUSD"}


def test_candles_and_analysis_for_every_timeframe(client):
    for tf in Timeframe:
        candles = client.get(f"/api/candles/R_75/{tf.value}?limit=50").json()
        assert len(candles) == 50, tf
        a = client.get(f"/api/analysis/R_75/{tf.value}").json()
        assert {"candle_patterns", "chart_patterns", "levels", "trend", "signals"} <= set(a)
    mtf = client.get("/api/mtf/R_75").json()
    assert set(mtf["trends"]) == {tf.value for tf in Timeframe}


def test_risk_endpoint(client):
    r = client.get("/api/risk/R_75/M5/bullish").json()
    assert r["level"] in ("faible", "modere", "eleve") and r["stop"] < r["entry"] < r["target"]
    assert client.get("/api/risk/R_75/M5/up").status_code == 400
    assert client.get("/api/risk/NOPE/M5/bullish").status_code == 404


def test_websocket_snapshot_and_live_updates(client):
    with client.websocket_connect("/ws") as ws:
        assert ws.receive_json()["type"] == "hello"
        ws.send_json({"type": "subscribe", "symbol": "R_75", "tf": "M1"})
        seen = set()
        deadline = time.time() + 10
        while time.time() < deadline and not {"snapshot", "candle"} <= seen:
            msg = ws.receive_json()
            seen.add(msg["type"])
            if msg["type"] == "snapshot":
                assert len(msg["candles"]) > 100 and msg["analysis"] is not None
        assert {"snapshot", "candle"} <= seen


def test_alert_rules_api(client):
    rules = client.put("/api/settings/alerts", json={"min_score": 82}).json()
    assert rules["min_score"] == 82
    assert client.get("/api/settings/alerts").json()["min_score"] == 82


def test_tradingview_webhook(client):
    bad = client.post("/api/webhook/tradingview", json={"secret": "nope", "symbol": "EURUSD", "price": 1.1})
    assert bad.status_code == 403
    base = 1_700_006_400
    bars = [{"time": base + 60 * i, "open": 1.1 + i * 1e-4, "high": 1.1002 + i * 1e-4, "low": 1.0999 + i * 1e-4,
             "close": 1.1001 + i * 1e-4, "volume": 10} for i in range(12)]
    ok = client.post("/api/webhook/tradingview", json={"secret": "s3cret", "symbol": "FX:EURUSD", "tf": "1", "bars": bars})
    assert ok.status_code == 200 and ok.json()["accepted"] == 12
    m1 = client.get("/api/candles/EURUSD/M1?limit=100").json()
    m5 = client.get("/api/candles/EURUSD/M5?limit=100").json()
    assert len(m1) == 12 and len(m5) == 3
    assert m5[0]["o"] == pytest.approx(1.1) and m5[0]["c"] == pytest.approx(1.1001 + 4e-4)
    unknown = client.post("/api/webhook/tradingview", json={"secret": "s3cret", "symbol": "XYZ", "price": 1})
    assert unknown.status_code == 400
