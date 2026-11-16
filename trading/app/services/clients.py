"""Connexions WebSocket des navigateurs : abonnements et diffusion non bloquante.

Chaque client a sa propre file d'envoi : un navigateur lent ne ralentit jamais le
flux de marché (les messages les plus anciens sont abandonnés si la file déborde).
"""

from __future__ import annotations

import asyncio
import contextlib
import json
import logging
from typing import Any

log = logging.getLogger(__name__)


class Client:
    def __init__(self, websocket, queue_size: int = 500) -> None:
        self.ws = websocket
        self.queue: asyncio.Queue[str] = asyncio.Queue(maxsize=queue_size)
        self.subscriptions: set[tuple[str, str]] = set()
        self.task: asyncio.Task | None = None

    def symbols(self) -> set[str]:
        return {s for s, _ in self.subscriptions}

    def push(self, text: str) -> None:
        if self.queue.full():
            with contextlib.suppress(asyncio.QueueEmpty):
                self.queue.get_nowait()
        self.queue.put_nowait(text)

    async def sender(self) -> None:
        while True:
            text = await self.queue.get()
            await self.ws.send_text(text)


class ClientManager:
    def __init__(self) -> None:
        self.clients: set[Client] = set()

    async def register(self, websocket) -> Client:
        client = Client(websocket)
        client.task = asyncio.create_task(self._run_sender(client))
        self.clients.add(client)
        return client

    async def _run_sender(self, client: Client) -> None:
        try:
            await client.sender()
        except Exception:  # connexion fermée
            self.clients.discard(client)

    def unregister(self, client: Client) -> None:
        self.clients.discard(client)
        if client.task:
            client.task.cancel()

    @staticmethod
    def encode(message: dict[str, Any]) -> str:
        return json.dumps(message, separators=(",", ":"), default=str)

    def send(self, client: Client, message: dict[str, Any]) -> None:
        client.push(self.encode(message))

    def broadcast(self, message: dict[str, Any]) -> None:
        if not self.clients:
            return
        text = self.encode(message)
        for c in list(self.clients):
            c.push(text)

    def to_subscribers(self, symbol: str, tf: str | None, message: dict[str, Any]) -> None:
        text = None
        for c in list(self.clients):
            if (tf is not None and (symbol, tf) in c.subscriptions) or (tf is None and symbol in c.symbols()):
                text = text or self.encode(message)
                c.push(text)

    def wanted(self, symbol: str, tf: str) -> bool:
        return any((symbol, tf) in c.subscriptions for c in self.clients)
