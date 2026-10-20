#!/usr/bin/env python3
"""
check_app_stats.py - cohérence entre l'application d'analyse (app/analyse.html) et
tools/analyze_trades.py.

Génère un fichier de trades au format de l'EA (données de test, pas de résultats
du robot), calcule les indicateurs avec l'outil Python puis avec le code JavaScript
de la page (exécuté par Node.js), et compare les valeurs déterministes. Les
intervalles bootstrap et le Monte-Carlo utilisent des générateurs pseudo-aléatoires
différents : ils sont seulement affichés.

Usage : python3 tests/check_app_stats.py   (nécessite node ; sinon le contrôle est ignoré)
"""
import datetime as dt
import json
import os
import random
import re
import shutil
import subprocess
import sys
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
sys.path.insert(0, os.path.join(ROOT, "tools"))
import analyze_trades as A  # noqa: E402

COLS = ("env;account;symbol;position_id;family;dir;hash;score;retest;session;open_time;close_time;duration_s;entry;exit;"
        "volume;risk_money;risk_points;net;gross;commission;swap;fee;r_multiple;exit_reason;exit_plan;slippage_pts;spread_pts;"
        "est_cost;mfe_r;mae_r;point;regime;label;candle;zone_id;zone_retests;zone_quality").split(";")
KEYS = ["n", "wins", "win_rate", "net", "profit_factor", "max_dd", "longest_loss_streak", "max_dd_r", "expectancy_r", "sd_r",
        "t_stat", "p_value", "p_adjusted", "stressed_expectancy_r", "expectancy_r_wo_top5", "positive_period_ratio",
        "periods_counted", "avg_duration_min", "avg_slippage_pts"]

HARNESS = r"""
const fs = require('fs');
const app = fs.readFileSync(process.argv[2], 'utf8');
const crit = JSON.parse(fs.readFileSync(process.argv[4], 'utf8'));
function p2(n) { return (n < 10 ? '0' : '') + n; }
function sum(a) { let s = 0; for (const x of a) s += x; return s; }
function fmt(x) { return String(x); }
function pick(name) {
  const i = app.indexOf('function ' + name + '(');
  if (i < 0) throw new Error('fonction absente de la page : ' + name);
  let d = 0;
  for (let k = app.indexOf('{', i); k < app.length; k++) {
    if (app[k] === '{') d++; else if (app[k] === '}' && --d === 0) return app.slice(i, k + 1);
  }
}
const NUMERIC = JSON.parse(process.argv[5]);
eval(app.split('/*STATS-BEGIN*/')[1].split('/*STATS-END*/')[0]);
eval(['num', 'num0', 'parseDate', 'parseCsv', 'normTrade'].map(pick).join('\n'));
const p = parseCsv(fs.readFileSync(process.argv[3], 'utf8'));
const T = p.rows.map(normTrade).filter(Boolean).sort((a, b) => a.close - b.close);
const m = metrics(T, crit, 4);
m.ev = evaluate(m, crit, 'dev').map(e => e.ok);
m.mc_dd_p95 = m.mc ? m.mc.dd_p95 : null;
delete m.mc;
process.stdout.write(JSON.stringify(m));
"""


def sample(path):
    rng = random.Random(5)
    t = dt.datetime(2025, 1, 2, 8)
    with open(path, "w", encoding="utf-8") as fh:
        fh.write(";".join(COLS) + "\r\n")
        for i in range(180):
            t += dt.timedelta(hours=rng.randint(5, 40))
            r = rng.choice([1.4, -1, -1, 0.0, 2.1, -0.9, 1.1]) + rng.uniform(-0.1, 0.1)
            row = dict.fromkeys(COLS, "")
            row.update(env="DEMO", account="1", symbol="XAUUSD", position_id=str(i), family=rng.choice(["F1", "F6"]), dir="BUY",
                       score="85", retest="1", session="Londres", open_time=t.strftime("%Y.%m.%d %H:%M:%S"),
                       close_time=(t + dt.timedelta(minutes=20)).strftime("%Y.%m.%d %H:%M:%S"), duration_s="1200", volume="0.01",
                       risk_money="0.00" if i % 37 == 0 else "10.00", risk_points=str(rng.randint(200, 600)), net="%.2f" % (r * 10),
                       gross="0", commission="-0.2", swap="0", fee="0", r_multiple="%.3f" % r, exit_reason="SL", exit_plan="0",
                       slippage_pts="1.0", spread_pts="20", est_cost="0.3", point="0.01", regime="RANGE", label="x",
                       zone_retests="0", zone_quality="0")
            fh.write(";".join(row[c] for c in COLS) + "\r\n")


def main():
    if not shutil.which("node"):
        print("node absent : contrôle de l'application ignoré")
        return 0
    html = open(os.path.join(ROOT, "app", "analyse.html"), encoding="utf-8").read()
    js = re.search(r"<script>\n(.*)</script>", html, re.S).group(1)
    with tempfile.TemporaryDirectory() as tmp:
        app_js, csv_path, crit_path, harness = (os.path.join(tmp, n) for n in ("app.js", "t.csv", "c.json", "h.js"))
        open(app_js, "w", encoding="utf-8").write(js)
        open(harness, "w", encoding="utf-8").write(HARNESS)
        json.dump(A.DEFAULT_CRITERIA, open(crit_path, "w"))
        sample(csv_path)
        subprocess.run(["node", "--check", app_js], check=True)
        res = subprocess.run(["node", harness, app_js, csv_path, crit_path, json.dumps(A.NUMERIC)], check=True,
                             capture_output=True, text=True)
        jm = json.loads(res.stdout)
        pm = A.metrics(A.load_trades([csv_path], False), A.DEFAULT_CRITERIA, 4)
    bad = 0
    for k in KEYS:
        a, b = pm[k], jm.get(k)
        ok = b is not None and abs(a - b) <= 1e-9 * max(1.0, abs(a))
        bad += 0 if ok else 1
        print("%s %-24s python=%s page=%s" % ("OK  " if ok else "ÉCART", k, a, b))
    pev = [e[3] for e in A.evaluate(pm, A.DEFAULT_CRITERIA, "dev")]
    if pev != jm["ev"]:
        bad += 1
    print("%s critères (dev)          python=%s page=%s" % ("OK  " if pev == jm["ev"] else "ÉCART", pev, jm["ev"]))
    print("info IC95 R              python=[%.3f ; %.3f] page=[%.3f ; %.3f] (tirages différents)" % (tuple(pm["ci_r"]) + tuple(jm["ci_r"])))
    print("info DD Monte-Carlo p95  python=%.2f page=%.2f (tirages différents)" % (pm["mc"]["dd_p95"], jm["mc_dd_p95"]))
    print("Application : %s" % ("calculs identiques à analyze_trades.py" if not bad else "%d ÉCART(S)" % bad))
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main())
