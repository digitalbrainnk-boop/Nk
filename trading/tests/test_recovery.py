"""Une source indisponible au démarrage est réessayée jusqu'à ce que les données arrivent."""

import asyncio

from app.config import Settings
from app.core.models import Candle, Instrument
from app.core.timeframes import Timeframe
from app.data.providers.base import DataProvider, register_provider
from app.services.market import MarketHub


@register_provider("flaky_test")
class FlakyProvider(DataProvider):
    failures = 2

    async def load_history(self, symbol, tf, count):
        if FlakyProvider.failures > 0:
            FlakyProvider.failures -= 1
            raise ConnectionError("source injoignable")
        base = 1_700_006_400 - 1_700_006_400 % tf.seconds
        return [Candle(base + i * tf.seconds, 100 + i % 7, 101 + i % 7, 99 + i % 7, 100.5 + i % 7, 1)
                for i in range(60)]

    async def subscribe(self, symbol):
        return None


def test_bootstrap_retries_until_data_arrives(tmp_path):
    async def scenario():
        settings = Settings(data_dir=tmp_path, instruments=[Instrument("X", "X", "synthetic", provider="flaky_test")])
        hub = MarketHub(settings)
        hub.RETRY_DELAY = 0.05
        await hub.start()
        for _ in range(100):
            if hub.ready.get("X"):
                break
            await asyncio.sleep(0.05)
        state = hub.providers["flaky_test"].state
        await hub.stop()
        return hub, state

    hub, state = asyncio.run(scenario())
    assert hub.ready.get("X") is True
    assert state == "connected"
    assert len(hub.store.candles("X", Timeframe.M5)) == 60
