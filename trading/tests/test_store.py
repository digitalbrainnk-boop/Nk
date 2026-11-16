from app.core.models import Candle, Tick
from app.core.timeframes import Timeframe
from app.data.store import CandleStore

T0 = 1_700_006_400  # multiple de 86400 : minuit UTC


def test_ticks_build_every_timeframe_and_report_closed_bars():
    store = CandleStore(list(Timeframe))
    store.apply_tick("X", Tick(T0 + 5, 100.0))
    store.apply_tick("X", Tick(T0 + 20, 103.0))
    store.apply_tick("X", Tick(T0 + 40, 99.0))
    updates = store.apply_tick("X", Tick(T0 + 61, 101.0))     # nouvelle minute

    closed = {u.timeframe for u in updates if u.closed is not None}
    assert closed == {Timeframe.M1}
    m1 = store.candles("X", Timeframe.M1)
    assert [(c.open, c.high, c.low, c.close) for c in m1] == [(100, 103, 99, 99), (101, 101, 101, 101)]
    d1 = store.candles("X", Timeframe.D1)[-1]
    assert (d1.time, d1.open, d1.high, d1.low, d1.close, d1.volume) == (T0, 100, 103, 99, 101, 4)


def test_hour_boundary_closes_all_lower_timeframes_together():
    store = CandleStore(list(Timeframe))
    store.apply_tick("X", Tick(T0 + 3599, 1.0))
    updates = store.apply_tick("X", Tick(T0 + 3600, 2.0))
    closed = {u.timeframe for u in updates if u.closed is not None}
    assert closed == {Timeframe.M1, Timeframe.M5, Timeframe.M15, Timeframe.M30, Timeframe.H1}


def test_late_ticks_are_ignored():
    store = CandleStore([Timeframe.M1])
    store.apply_tick("X", Tick(T0 + 120, 5.0))
    assert store.apply_tick("X", Tick(T0 + 10, 9.0)) == []
    assert store.candles("X", Timeframe.M1)[-1].high == 5.0


def test_merge_bar_propagates_to_higher_timeframes():
    store = CandleStore(list(Timeframe))
    store.merge_bar("X", Timeframe.M1, Candle(T0, 10, 12, 9, 11, 5))
    store.merge_bar("X", Timeframe.M1, Candle(T0 + 60, 11, 15, 10, 14, 3))
    store.merge_bar("X", Timeframe.M1, Candle(T0 + 60, 11, 16, 10, 15, 4))   # mise à jour de la même bougie
    m5 = store.candles("X", Timeframe.M5)[-1]
    assert (m5.open, m5.high, m5.low, m5.close, m5.volume) == (10, 16, 9, 15, 8)
    assert len(store.candles("X", Timeframe.M1)) == 2


def test_series_are_bounded():
    store = CandleStore([Timeframe.M1], max_bars=50)
    for i in range(200):
        store.apply_tick("X", Tick(T0 + 60 * i, float(i)))
    assert len(store.candles("X", Timeframe.M1)) <= 60
    assert store.candles("X", Timeframe.M1)[-1].close == 199.0


def test_closed_only_frame_excludes_forming_bar():
    store = CandleStore([Timeframe.M1])
    for i in range(5):
        store.apply_tick("X", Tick(T0 + 60 * i, float(i)))
    df = store.frame("X", Timeframe.M1, closed_only=True)
    assert len(df) == 4 and df["close"].iloc[-1] == 3.0
