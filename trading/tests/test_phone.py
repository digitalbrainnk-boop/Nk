"""Accès depuis le téléphone : code obligatoire hors de l'ordinateur, QR code, icône."""

import pytest
from fastapi.testclient import TestClient
from starlette.websockets import WebSocketDisconnect

from app.config import load_settings
from app.main import create_app
from app.phone import ALPHABET, load_or_create_code

CONFIG = """
[app]
history_bars = 200
[[instruments]]
symbol = "R_75"
name = "Volatility 75 Index"
category = "synthetic"
sim = { model = "volatility", start = 1000.0, vol = 0.75 }
"""


@pytest.fixture(scope="module")
def setup(tmp_path_factory):
    path = tmp_path_factory.mktemp("phone") / "config.toml"
    path.write_text(CONFIG, encoding="utf-8")
    settings = load_settings(path)
    settings.data_dir = path.parent
    settings.phone = True
    app = create_app(settings)
    code = load_or_create_code(settings.data_dir)
    with TestClient(app) as remote:                     # client « téléphone » (adresse non locale)
        local = TestClient(app, client=("127.0.0.1", 50001))
        yield remote, local, code


def test_code_is_stable_and_readable(tmp_path):
    first = load_or_create_code(tmp_path)
    assert len(first) == 8 and set(first) <= set(ALPHABET)
    assert load_or_create_code(tmp_path) == first


def test_phone_without_code_is_refused(setup):
    remote, _, _ = setup
    remote.cookies.clear()
    page = remote.get("/")
    assert page.status_code == 401 and "accès protégé" in page.text
    assert remote.get("/api/status").status_code == 401
    assert remote.get("/?code=MAUVAIS1").status_code == 401
    assert remote.get("/static/js/main.js").status_code == 200       # fichiers publics
    with pytest.raises(WebSocketDisconnect) as exc:
        with remote.websocket_connect("/ws") as ws:
            ws.receive_json()
    assert exc.value.code == 4401


def test_phone_with_code_gets_a_lasting_cookie(setup):
    remote, _, code = setup
    remote.cookies.clear()
    first = remote.get(f"/?code={code.lower()}")
    assert first.status_code == 200 and "NK Trader" in first.text
    assert "nk_acces" in first.headers.get("set-cookie", "")
    assert remote.get("/api/status").status_code == 200              # cookie mémorisé
    with remote.websocket_connect("/ws") as ws:
        assert ws.receive_json()["type"] == "hello"
    info = remote.get("/api/phone").json()
    assert info == {"enabled": True, "local": False}                 # le code n'est jamais renvoyé au téléphone


def test_computer_needs_no_code_and_gets_qr(setup):
    _, local, code = setup
    info = local.get("/api/phone").json()
    assert info["enabled"] and info["local"] and info["code"] == code
    assert all(u.endswith(f"?code={code}") for u in info["urls"])
    if info["urls"]:
        svg = local.get("/api/phone/qr.svg")
        assert svg.status_code == 200 and svg.text.lstrip().startswith("<svg")
        assert 'xmlns="http://www.w3.org/2000/svg"' in svg.text       # requis pour <img src=…>


def test_manifest_keeps_code_for_home_screen_icon(setup):
    _, local, code = setup
    m = local.get("/manifest.webmanifest").json()
    assert m["start_url"] == f"/?code={code}" and m["display"] == "standalone"
    assert any(i["sizes"] == "512x512" for i in m["icons"])
    assert local.get("/static/icon-192.png").status_code == 200
