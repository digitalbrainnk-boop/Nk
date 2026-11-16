#!/usr/bin/env python3
"""Lancement de NK Trader.

Exemples :
    python run.py                         # simulateur hors ligne (aucune connexion requise)
    python run.py --speed 60              # simulateur accéléré : 1 minute simulée par seconde
    python run.py --provider deriv        # données réelles Deriv (synthétiques + Forex)
    python run.py --provider mt5          # MetaTrader 5 (Windows, terminal ouvert)
"""

from __future__ import annotations

import argparse
import logging
import os
import sys
import webbrowser
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import uvicorn  # noqa: E402

from app.config import load_settings  # noqa: E402
from app.main import create_app  # noqa: E402


def main() -> None:
    parser = argparse.ArgumentParser(description="NK Trader — scalping et analyse multi-temporelle")
    parser.add_argument("--config", help="fichier de configuration (défaut : config.toml)")
    parser.add_argument("--provider", choices=["simulator", "deriv", "mt5", "tradingview"],
                        help="force le fournisseur de données pour tous les instruments")
    parser.add_argument("--speed", type=float, help="accélération du simulateur (ex. 60)")
    parser.add_argument("--host", help="adresse d'écoute (défaut 127.0.0.1)")
    parser.add_argument("--port", type=int, help="port (défaut 8000)")
    parser.add_argument("--open", action="store_true", help="ouvre le navigateur au démarrage")
    parser.add_argument("--debug", action="store_true")
    args = parser.parse_args()

    logging.basicConfig(level=logging.DEBUG if args.debug else logging.INFO,
                        format="%(asctime)s %(levelname)-7s %(name)s — %(message)s", datefmt="%H:%M:%S")
    settings = load_settings(args.config, provider_override=args.provider)
    if args.speed:
        settings.providers.setdefault("simulator", {})["speed"] = args.speed
    host = args.host or settings.host
    port = args.port or settings.port
    if args.open:
        webbrowser.open(f"http://{'localhost' if host in ('0.0.0.0', '127.0.0.1') else host}:{port}")
    uvicorn.run(create_app(settings), host=host, port=port, log_level="warning",
                ws_ping_interval=20, ws_ping_timeout=20)


if __name__ == "__main__":
    os.chdir(Path(__file__).resolve().parent)
    main()
