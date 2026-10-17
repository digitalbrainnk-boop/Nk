#!/usr/bin/env python3
"""Tests de analyze_trades.py (données synthétiques, bibliothèque standard)."""
import datetime as dt
import os
import random
import sys
import tempfile
import unittest

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import analyze_trades as at  # noqa: E402

HEADER = ("env;account;symbol;position_id;family;dir;hash;score;retest;session;open_time;close_time;duration_s;entry;exit;volume;"
          "risk_money;risk_points;net;gross;commission;swap;fee;r_multiple;exit_reason;exit_plan;slippage_pts;spread_pts;est_cost;mfe_r;mae_r;point")


def make_csv(path, family, mean_r, n, seed, start=dt.datetime(2021, 1, 4), env="BACKTEST", label=None):
    rng = random.Random(seed)
    lines = [HEADER + (";regime;label;candle" if label else "")]
    t = start
    for i in range(n):
        r = rng.gauss(mean_r, 1.0)
        r = max(-1.05, min(3.0, r))
        risk = 5.0
        net = r * risk
        o = t
        c = t + dt.timedelta(minutes=20)
        cols = [
            env, "1", "XAUUSDm", str(1000 + i), family, "BUY", "ABC", str(70 + i % 30), "0", "Londres",
            o.strftime("%Y.%m.%d %H:%M:%S"), c.strftime("%Y.%m.%d %H:%M:%S"), "1200", "2000.00", "2001.00", "0.03",
            "%.2f" % risk, "200.0", "%.2f" % net, "%.2f" % net, "0.00", "0.00", "0.00", "%.3f" % r,
            "SL" if r < 0 else "TP", "3", "1.0", "20.0", "0.60", "1.00", "0.50", "0.01"]
        if label:
            cols += ["TENDANCE" if i % 2 else "RANGE", label, "marteau" if i % 3 == 0 else ""]
        lines.append(";".join(cols))
        t += dt.timedelta(hours=9)
    with open(path, "w", encoding="utf-8") as fh:
        fh.write("\n".join(lines) + "\n")


class TestStats(unittest.TestCase):
    def test_student_tail(self):
        self.assertAlmostEqual(at.t_sf(2.0, 10), 0.036694, places=5)
        self.assertAlmostEqual(at.t_sf(1.959964, 100000), 0.025, places=3)
        self.assertAlmostEqual(at.t_sf(0.0, 5), 0.5, places=9)
        self.assertGreater(at.t_sf(-2.0, 10), 0.95)

    def test_metrics_basic(self):
        crit = dict(at.DEFAULT_CRITERIA)
        base = dt.datetime(2022, 1, 1)
        trades = []
        for i, (net, r) in enumerate([(10, 2.0), (-5, -1.0), (-5, -1.0), (5, 1.0)]):
            trades.append({"net": float(net), "r_multiple": r, "risk_money": 5.0, "risk_points": 200.0,
                           "duration_s": 600.0, "commission": 0.0, "swap": 0.0, "fee": 0.0, "est_cost": 0.0,
                           "slippage_pts": 0.0, "close_dt": base + dt.timedelta(days=i)})
        crit["stress_extra_cost_price"] = 0.0
        m = at.metrics(trades, crit, 1)
        self.assertEqual(m["n"], 4)
        self.assertEqual(m["wins"], 2)
        self.assertAlmostEqual(m["win_rate"], 50.0)
        self.assertAlmostEqual(m["profit_factor"], 15.0 / 10.0)
        self.assertAlmostEqual(m["expectancy_r"], 0.25)
        self.assertAlmostEqual(m["max_dd"], 10.0)
        self.assertEqual(m["longest_loss_streak"], 2)
        # stress : +0.20 en prix sur un risque de 200 points x 0.01 = 2.00 -> -0.1 R par trade
        for t in trades:
            t["point"] = 0.01
        crit["stress_extra_cost_price"] = 0.20
        m2 = at.metrics(trades, crit, 1)
        self.assertAlmostEqual(m2["stressed_expectancy_r"], 0.15)
        # ancien format en points (sans colonne point)
        crit2 = dict(at.DEFAULT_CRITERIA)
        crit2.pop("stress_extra_cost_price")
        crit2["stress_extra_cost_points"] = 20.0
        for t in trades:
            t["point"] = 0.0
        m3 = at.metrics(trades, crit2, 1)
        self.assertAlmostEqual(m3["stressed_expectancy_r"], 0.15)


class TestRobustness(unittest.TestCase):
    def test_monte_carlo_bounds(self):
        mc = at.monte_carlo([1.0] * 50, 200)
        self.assertEqual(mc["dd_p95"], 0.0)
        self.assertEqual(mc["p_loss"], 0.0)
        self.assertAlmostEqual(mc["total_p50"], 50.0)
        mc2 = at.monte_carlo([1.0, -1.0] * 50, 500)
        self.assertGreater(mc2["dd_p95"], mc2["dd_p50"] - 1e-12)
        self.assertGreater(mc2["dd_p95"], 2.0)
        self.assertGreater(mc2["p_loss"], 0.3)
        self.assertEqual(at.monte_carlo([1.0, -1.0] * 50, 500), mc2)  # reproductible (graine fixe)
        self.assertIsNone(at.monte_carlo([1.0], 100))

    def test_bootstrap_diff(self):
        rng = random.Random(5)
        a = [rng.gauss(0.5, 1.0) for _ in range(400)]
        b = [rng.gauss(0.0, 1.0) for _ in range(400)]
        lo, hi = at.bootstrap_diff_ci(a, b)
        self.assertLess(lo, hi)
        self.assertGreater(lo, 0.2)
        self.assertLess(hi, 0.8)

    def test_top_trade_dependency(self):
        crit = dict(at.DEFAULT_CRITERIA)
        crit["mc_paths"] = 50
        base = dt.datetime(2022, 1, 1)
        trades = []
        rs = [-1.0] * 19 + [30.0]
        for i, r in enumerate(rs):
            trades.append({"net": r * 5, "r_multiple": r, "risk_money": 5.0, "risk_points": 200.0, "point": 0.01,
                           "duration_s": 600.0, "commission": 0.0, "swap": 0.0, "fee": 0.0, "est_cost": 0.0,
                           "slippage_pts": 0.0, "close_dt": base + dt.timedelta(days=i)})
        m = at.metrics(trades, crit, 1)
        self.assertGreater(m["expectancy_r"], 0.0)
        self.assertAlmostEqual(m["expectancy_r_wo_top5"], -1.0)


class TestProtocol(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp()
        self.good = os.path.join(self.tmp, "good_trades.csv")
        self.flat = os.path.join(self.tmp, "flat_trades.csv")
        make_csv(self.good, "F1", 0.35, 1400, 1)
        make_csv(self.flat, "F2", 0.0, 1400, 2)
        self.out = os.path.join(self.tmp, "rapport.md")

    def run_tool(self, extra):
        args = [self.good, self.flat, "--dev", "2021-01-01:2021-12-31", "--val", "2022-01-01:2022-06-30",
                "--test", "2022-07-01:2022-12-31", "--variants", "4", "--out", self.out] + extra
        rc = at.main(args)
        with open(self.out, encoding="utf-8") as fh:
            return rc, fh.read()

    def test_selection_and_lock(self):
        rc, rep = self.run_tool([])
        self.assertEqual(rc, 0)
        self.assertIn("VERROUILLÉ", rep)
        self.assertIn("Candidate retenue : F1", rep)
        self.assertNotIn("Candidate retenue : F2", rep)
        self.assertIn("**F2** : ÉCHEC", rep)

    def test_unlocked(self):
        rc, rep = self.run_tool(["--unlock-test"])
        self.assertEqual(rc, 0)
        self.assertIn("Test final hors échantillon", rep)
        self.assertNotIn("VERROUILLÉ", rep)

    def test_no_candidate(self):
        args = [self.flat, "--dev", "2021-01-01:2021-12-31", "--val", "2022-01-01:2022-06-30", "--out", self.out]
        self.assertEqual(at.main(args), 0)
        with open(self.out, encoding="utf-8") as fh:
            rep = fh.read()
        self.assertIn("Aucune stratégie n'est retenue", rep)

    def test_overlap_rejected(self):
        args = [self.good, "--dev", "2021-01-01:2021-12-31", "--val", "2021-06-01:2022-06-30", "--out", self.out]
        self.assertEqual(at.main(args), 2)

    def test_monte_carlo_in_report(self):
        rc, rep = self.run_tool([])
        self.assertEqual(rc, 0)
        self.assertIn("Monte-Carlo", rep)
        self.assertIn("drawdown Monte-Carlo p95 R", rep)

    def test_ab_comparison(self):
        ref = os.path.join(self.tmp, "ref_trades.csv")
        var = os.path.join(self.tmp, "var_trades.csv")
        make_csv(ref, "F1", 0.0, 1400, 7, label="reference")
        make_csv(var, "F1", 0.4, 1400, 8, label="bougies")
        args = [ref, var, "--group-by", "label", "--baseline", "F1|reference", "--dev", "2021-01-01:2021-12-31",
                "--val", "2022-01-01:2022-06-30", "--variants", "2", "--out", self.out]
        self.assertEqual(at.main(args), 0)
        with open(self.out, encoding="utf-8") as fh:
            rep = fh.read()
        self.assertIn("Comparaison avec la référence **F1|reference**", rep)
        self.assertIn("| F1|bougies |", rep)
        self.assertIn("Régime à l'entrée", rep)
        self.assertIn("| TENDANCE |", rep)
        self.assertIn("Figure de bougie retenue", rep)
        bad = [ref, "--group-by", "label", "--baseline", "F1|absente", "--dev", "2021-01-01:2021-12-31",
               "--val", "2022-01-01:2022-06-30", "--out", self.out]
        self.assertEqual(at.main(bad), 3)

    def test_mixed_env_warning(self):
        demo = os.path.join(self.tmp, "demo_trades.csv")
        make_csv(demo, "F1", 0.2, 50, 3, env="DEMO")
        args = [self.good, demo, "--dev", "2021-01-01:2021-12-31", "--val", "2022-01-01:2022-06-30", "--out", self.out]
        at.main(args)
        with open(self.out, encoding="utf-8") as fh:
            self.assertIn("plusieurs environnements", fh.read())


if __name__ == "__main__":
    unittest.main()
