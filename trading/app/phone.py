"""Accès depuis un téléphone sur le même Wi-Fi.

Quand l'application écoute sur le réseau local (``python run.py --phone``) :

* un **code d'accès** aléatoire est créé une fois pour toutes (``data/code_telephone.txt``) ;
* l'ordinateur lui-même (127.0.0.1) entre sans code ;
* le téléphone entre en scannant le QR code affiché sur l'ordinateur : l'adresse
  contient ``?code=…``, le navigateur reçoit alors un cookie valable un an ;
* toute autre requête reçoit une page « accès protégé » (HTTP 401) ou, pour le
  WebSocket, une fermeture immédiate.

Le webhook TradingView reste accessible : il est protégé par son propre secret.
"""

from __future__ import annotations

import hmac
import secrets
import socket
from http.cookies import SimpleCookie
from pathlib import Path
from urllib.parse import parse_qs

COOKIE = "nk_acces"
ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"      # sans 0/O ni 1/I : facile à recopier
LOCAL_HOSTS = {"127.0.0.1", "::1", "localhost"}
PUBLIC_PATHS = ("/static/", "/api/webhook/tradingview", "/favicon.ico")

DENIED_PAGE = """<!doctype html><html lang="fr"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1"><title>NK Trader — accès protégé</title>
<style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#070b14;color:#e2e8f0;
font:16px/1.5 system-ui,sans-serif;padding:24px;box-sizing:border-box}main{max-width:420px}
h1{font-size:20px;color:#2dd4bf}form{display:flex;gap:8px;margin-top:16px}
input{flex:1;padding:10px;border-radius:8px;border:1px solid #334155;background:#0f172a;color:#e2e8f0;
font-size:18px;letter-spacing:2px;text-transform:uppercase}button{padding:10px 16px;border-radius:8px;border:0;
background:#2dd4bf;color:#04211d;font-weight:700;font-size:16px}</style></head><body><main>
<h1>NK Trader — accès protégé</h1>
<p>Sur l'ordinateur, cliquez sur le bouton <b>📱 Téléphone</b> en haut de la page, puis scannez le QR code
avec l'appareil photo de ce téléphone.</p>
<p>Ou tapez le code d'accès affiché dans la fenêtre noire de l'ordinateur :</p>
<form method="get" action="/"><input name="code" autocomplete="off" autocapitalize="characters"
placeholder="CODE" aria-label="Code d'accès"><button>Entrer</button></form>
</main></body></html>"""


def load_or_create_code(data_dir: Path) -> str:
    path = data_dir / "code_telephone.txt"
    try:
        code = path.read_text(encoding="utf-8").strip().upper()
        if len(code) >= 6 and all(ch in ALPHABET for ch in code):
            return code
    except OSError:
        pass
    code = "".join(secrets.choice(ALPHABET) for _ in range(8))
    data_dir.mkdir(parents=True, exist_ok=True)
    path.write_text(code + "\n", encoding="utf-8")
    return code


def lan_addresses() -> list[str]:
    """Adresses IPv4 de l'ordinateur sur le réseau local (la plus probable en premier)."""
    found: list[str] = []
    try:  # aucune donnée n'est envoyée : sert seulement à connaître l'interface de sortie
        with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as s:
            s.connect(("10.255.255.255", 1))
            found.append(s.getsockname()[0])
    except OSError:
        pass
    try:
        for info in socket.getaddrinfo(socket.gethostname(), None, socket.AF_INET):
            found.append(info[4][0])
    except OSError:
        pass
    out = []
    for ip in found:
        if ip.startswith("127.") or ip.startswith("169.254.") or ip in out:
            continue
        out.append(ip)
    private = [ip for ip in out if ip.startswith(("192.168.", "10.")) or
               (ip.startswith("172.") and 16 <= int(ip.split(".")[1]) <= 31)]
    return private + [ip for ip in out if ip not in private]


def phone_urls(port: int, code: str) -> list[str]:
    return [f"http://{ip}:{port}/?code={code}" for ip in lan_addresses()]


def qr_svg(text: str) -> str:
    """QR code en SVG autonome (avec l'espace de noms XML, nécessaire dans une balise <img>)."""
    import io

    import segno  # dépendance légère, pure Python
    buf = io.BytesIO()
    segno.make(text, error="m").save(buf, kind="svg", scale=6, border=2, dark="#0b1220", light="#ffffff",
                                     xmldecl=False)
    return buf.getvalue().decode("utf-8")


def is_local(scope) -> bool:
    client = scope.get("client")
    return bool(client) and client[0] in LOCAL_HOSTS


class PhoneAccessMiddleware:
    """Middleware ASGI (HTTP + WebSocket) qui exige le code d'accès hors de l'ordinateur."""

    def __init__(self, app, code: str) -> None:
        self.app = app
        self.code = code

    def _cookie_ok(self, scope) -> bool:
        for name, value in scope.get("headers", []):
            if name == b"cookie":
                jar = SimpleCookie()
                try:
                    jar.load(value.decode("latin-1"))
                except Exception:
                    return False
                morsel = jar.get(COOKIE)
                if morsel is not None and hmac.compare_digest(morsel.value.upper(), self.code):
                    return True
        return False

    def _query_code(self, scope) -> str | None:
        values = parse_qs(scope.get("query_string", b"").decode("latin-1")).get("code")
        return values[0].strip().upper() if values else None

    async def __call__(self, scope, receive, send):
        if scope["type"] not in ("http", "websocket"):
            return await self.app(scope, receive, send)
        path = scope.get("path", "")
        if is_local(scope) or path.startswith(PUBLIC_PATHS) or self._cookie_ok(scope):
            return await self.app(scope, receive, send)

        given = self._query_code(scope)
        if given and hmac.compare_digest(given, self.code):
            if scope["type"] == "websocket":
                return await self.app(scope, receive, send)
            cookie = (f"{COOKIE}={self.code}; Max-Age=31536000; Path=/; HttpOnly; SameSite=Lax").encode()

            async def send_with_cookie(message):
                if message["type"] == "http.response.start":
                    message = {**message, "headers": list(message.get("headers", [])) + [(b"set-cookie", cookie)]}
                await send(message)
            return await self.app(scope, receive, send_with_cookie)

        if scope["type"] == "websocket":
            # Accepter puis fermer avec 4401 : le navigateur reçoit ce code et affiche la page d'accès.
            await receive()                              # websocket.connect
            await send({"type": "websocket.accept"})
            await send({"type": "websocket.close", "code": 4401})
            return
        body = DENIED_PAGE.encode("utf-8")
        is_api = path.startswith("/api/")
        if is_api:
            body = b'{"error":"code d\'acces requis"}'
        await send({"type": "http.response.start", "status": 401, "headers": [
            (b"content-type", b"application/json" if is_api else b"text/html; charset=utf-8"),
            (b"content-length", str(len(body)).encode()), (b"cache-control", b"no-store")]})
        await send({"type": "http.response.body", "body": body})
