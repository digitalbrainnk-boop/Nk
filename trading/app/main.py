"""Application FastAPI : API REST, WebSocket temps réel et interface web."""

from __future__ import annotations

import asyncio
import contextlib
import json
import logging
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Any

from fastapi import FastAPI, HTTPException, Request, WebSocket, WebSocketDisconnect
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles

from .analysis import candlesticks, chart_patterns
from .config import ROOT, Settings, load_settings
from .core.timeframes import Timeframe
from .data.providers.tradingview import TradingViewProvider
from .services.market import MarketHub

log = logging.getLogger(__name__)
STATIC = ROOT / "static"


def create_app(settings: Settings | None = None) -> FastAPI:
    settings = settings or load_settings()

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        hub = MarketHub(settings)
        app.state.hub = hub
        await hub.start()
        try:
            yield
        finally:
            await hub.stop()

    app = FastAPI(title="NK Trader", version="1.0.0", lifespan=lifespan)

    def hub_of(request_or_ws) -> MarketHub:
        return request_or_ws.app.state.hub

    def parse_tf(value: str) -> Timeframe:
        try:
            return Timeframe.parse(value)
        except ValueError as exc:
            raise HTTPException(400, f"unité de temps inconnue : {value}") from exc

    def check_symbol(hub: MarketHub, symbol: str) -> None:
        if symbol not in hub.instruments:
            raise HTTPException(404, f"instrument inconnu : {symbol}")

    # ----------------------------------------------------------------- REST
    @app.get("/api/instruments")
    async def instruments(request: Request):
        hub = hub_of(request)
        tick = hub.tickers()
        return [{**i.to_dict(), **tick.get(i.symbol, {})} for i in hub.instruments.values()]

    @app.get("/api/timeframes")
    async def timeframes(request: Request):
        return [{"value": tf.value, "label": tf.label, "seconds": tf.seconds}
                for tf in hub_of(request).settings.timeframes]

    @app.get("/api/candles/{symbol}/{tf}")
    async def candles(request: Request, symbol: str, tf: str, limit: int = 500):
        hub = hub_of(request)
        check_symbol(hub, symbol)
        return [c.to_dict() for c in hub.store.candles(symbol, parse_tf(tf), max(1, min(limit, 5000)))]

    @app.get("/api/analysis/{symbol}/{tf}")
    async def analysis(request: Request, symbol: str, tf: str):
        hub = hub_of(request)
        check_symbol(hub, symbol)
        snap = hub.snapshots[symbol].get(parse_tf(tf).value)
        if snap is None:
            raise HTTPException(404, "analyse pas encore disponible")
        return snap.to_dict()

    @app.get("/api/mtf/{symbol}")
    async def mtf(request: Request, symbol: str):
        hub = hub_of(request)
        check_symbol(hub, symbol)
        return hub.mtf_message(symbol)

    @app.get("/api/risk/{symbol}/{tf}/{direction}")
    async def risk(request: Request, symbol: str, tf: str, direction: str):
        hub = hub_of(request)
        check_symbol(hub, symbol)
        if direction not in ("bullish", "bearish"):
            raise HTTPException(400, "direction : bullish ou bearish")
        try:
            return hub.risk_check(symbol, parse_tf(tf), direction)
        except LookupError as exc:
            raise HTTPException(404, str(exc)) from exc

    @app.get("/api/signals")
    async def signals(request: Request, limit: int = 100):
        return hub_of(request).signal_feed[:limit]

    @app.get("/api/alerts")
    async def alerts(request: Request, limit: int = 100):
        return hub_of(request).alerts.recent(limit)

    @app.get("/api/settings/alerts")
    async def get_alert_rules(request: Request):
        return hub_of(request).alerts.rules.to_dict()

    @app.put("/api/settings/alerts")
    async def put_alert_rules(request: Request):
        data = await request.json()
        if not isinstance(data, dict):
            raise HTTPException(400, "objet JSON attendu")
        rules = hub_of(request).alerts.update_rules(data)
        hub_of(request).clients.broadcast({"type": "alert_rules", "rules": rules})
        return rules

    @app.get("/api/status")
    async def status(request: Request):
        hub = hub_of(request)
        return {"providers": hub.provider_status(), "ready": hub.ready,
                "talib": candlesticks.talib_available(), "clients": len(hub.clients.clients)}

    @app.get("/api/catalog")
    async def catalog():
        return {"candlesticks": candlesticks.catalog(), "chart_patterns": chart_patterns.catalog()}

    @app.post("/api/webhook/tradingview")
    async def tradingview_webhook(request: Request):
        hub = hub_of(request)
        provider = hub.providers.get("tradingview")
        if not isinstance(provider, TradingViewProvider):
            raise HTTPException(404, "aucun instrument n'utilise le fournisseur tradingview")
        try:
            payload = json.loads(await request.body())
        except ValueError as exc:
            raise HTTPException(400, "JSON invalide") from exc
        if not isinstance(payload, dict):
            raise HTTPException(400, "objet JSON attendu")
        secret = payload.pop("secret", None) or request.headers.get("x-webhook-secret")
        if not provider.check_secret(secret):
            raise HTTPException(403, "secret invalide")
        try:
            return provider.ingest(payload)
        except (ValueError, KeyError, TypeError) as exc:
            raise HTTPException(400, str(exc)) from exc

    # ------------------------------------------------------------- WebSocket
    @app.websocket("/ws")
    async def websocket(ws: WebSocket):
        await ws.accept()
        hub: MarketHub = ws.app.state.hub
        client = await hub.clients.register(ws)
        hub.clients.send(client, {"type": "hello", "instruments": [i.to_dict() for i in hub.instruments.values()],
                                  "timeframes": [tf.value for tf in hub.settings.timeframes],
                                  "providers": hub.provider_status(), "rules": hub.alerts.rules.to_dict(),
                                  "alerts": hub.alerts.recent(30), "signals": hub.signal_feed[:50],
                                  "prices": hub.tickers()})
        try:
            while True:
                msg = json.loads(await ws.receive_text())
                await handle_client_message(hub, client, msg)
        except WebSocketDisconnect:
            pass
        except Exception as exc:  # message malformé ou connexion cassée
            log.debug("websocket fermé : %s", exc)
        finally:
            hub.clients.unregister(client)

    async def handle_client_message(hub: MarketHub, client, msg: dict[str, Any]) -> None:
        kind = msg.get("type")
        if kind == "subscribe":
            symbol = msg.get("symbol")
            if symbol not in hub.instruments:
                hub.clients.send(client, {"type": "error", "message": f"instrument inconnu : {symbol}"})
                return
            try:
                tf = Timeframe.parse(str(msg.get("tf", "M5")))
            except ValueError:
                hub.clients.send(client, {"type": "error", "message": "unité de temps inconnue"})
                return
            if msg.get("exclusive", True):
                client.subscriptions.clear()
            client.subscriptions.add((symbol, tf.value))
            hub.clients.send(client, hub.snapshot_message(symbol, tf))
            hub.clients.send(client, hub.mtf_message(symbol))
        elif kind == "unsubscribe":
            client.subscriptions.discard((msg.get("symbol"), msg.get("tf")))
        elif kind == "ping":
            hub.clients.send(client, {"type": "pong", "t": msg.get("t")})

    # ------------------------------------------------------------ interface
    app.mount("/static", StaticFiles(directory=STATIC), name="static")

    @app.get("/")
    async def index():
        return FileResponse(STATIC / "index.html", headers={"Cache-Control": "no-cache"})

    @app.exception_handler(HTTPException)
    async def http_error(_request: Request, exc: HTTPException):
        return JSONResponse({"error": exc.detail}, status_code=exc.status_code)

    return app
