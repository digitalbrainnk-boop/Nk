#!/usr/bin/env python3
"""
analyze_trades.py - protocole de comparaison des familles de stratégies.

Lit un ou plusieurs fichiers *_trades.csv exportés par l'EA (une ligne par
POSITION clôturée, clôtures partielles déjà agrégées), découpe les données en
périodes de développement / validation / test final hors échantillon, calcule
les indicateurs, applique des critères PRÉ-ENREGISTRÉS (fichier JSON) et
produit un rapport Markdown avec une décision.

Principes :
  - aucune sélection sur le seul taux de réussite ou le meilleur résultat ;
  - le nombre de variantes testées est pris en compte (correction de
    Bonferroni sur la p-valeur de l'espérance en R) ;
  - l'échantillon de test final n'est évalué qu'avec --unlock-test, une fois
    la sélection figée (pour éviter de "regarder" le test pendant la mise au
    point) ;
  - si aucune famille ne satisfait les critères : aucune n'est retenue ;
  - robustesse : Monte-Carlo (rééchantillonnage des résultats en R : drawdown
    et résultat total en distribution), retrait des 5 % meilleurs trades,
    stress des coûts ;
  - comparaison A/B : --group-by label regroupe par libellé d'essai
    (paramètre InpRunLabel de l'EA) et --baseline compare chaque variante à
    la référence (écart d'espérance R avec intervalle bootstrap indicatif).

Bibliothèque standard uniquement. Exemple :
  python3 analyze_trades.py GLS_BACKTEST_*_trades.csv \
      --dev 2021-01-01:2023-12-31 --val 2024-01-01:2024-12-31 \
      --test 2025-01-01:2025-12-31 --variants 4 \
      --criteria criteria_default.json --out rapport.md
  python3 analyze_trades.py ref_trades.csv bougies_trades.csv --group-by label \
      --baseline "F1|reference" --dev ... --val ... --variants 6
"""
import argparse
import csv
import datetime as dt
import json
import math
import os
import random
import sys

DEFAULT_CRITERIA = {
    "min_trades": {"dev": 100, "val": 50, "test": 50},
    "min_expectancy_r": 0.05,
    "min_profit_factor": 1.15,
    "max_drawdown_r": 15.0,
    "min_positive_period_ratio": 0.6,
    "period": "quarter",
    "min_trades_per_period": 5,
    "max_adjusted_p_value": 0.05,
    "stress_extra_cost_price": 0.20,
    "min_stressed_expectancy_r": 0.0,
    "mc_paths": 1000,
    "max_mc_drawdown_r_p95": 20.0,
}

NUMERIC = ["score", "duration_s", "entry", "exit", "volume", "risk_money", "risk_points", "net", "gross",
           "commission", "swap", "fee", "r_multiple", "slippage_pts", "spread_pts", "est_cost", "mfe_r", "mae_r", "point"]


# ---------------------------------------------------------------------------
# Lecture
# ---------------------------------------------------------------------------
def parse_time(text):
    text = text.strip()
    for fmt in ("%Y.%m.%d %H:%M:%S", "%Y.%m.%d %H:%M", "%Y-%m-%d %H:%M:%S", "%Y-%m-%d"):
        try:
            return dt.datetime.strptime(text, fmt)
        except ValueError:
            continue
    raise ValueError("date illisible : %r" % text)


def load_trades(paths, per_file, group_by="family"):
    trades = []
    for path in paths:
        label = os.path.splitext(os.path.basename(path))[0]
        with open(path, encoding="utf-8-sig", newline="") as fh:
            reader = csv.DictReader(fh, delimiter=";")
            for row in reader:
                if not row.get("close_time"):
                    continue
                t = dict(row)
                for k in NUMERIC:
                    if k in t and t[k] not in (None, ""):
                        t[k] = float(t[k])
                    else:
                        t[k] = 0.0
                t["open_dt"] = parse_time(row["open_time"])
                t["close_dt"] = parse_time(row["close_time"])
                t["regime"] = row.get("regime") or "?"
                t["label"] = row.get("label") or "sans_libelle"
                t["candle"] = row.get("candle") or "aucune"
                t["zone_id"] = row.get("zone_id") or ""
                zr = row.get("zone_retests") or ""
                t["zone_retests"] = int(float(zr)) if zr not in ("",) else 0
                t["group"] = row["family"] + ("|" + label if per_file else "") + ("|" + t["label"] if group_by == "label" else "")
                trades.append(t)
    trades.sort(key=lambda x: x["close_dt"])
    return trades


def parse_range(text):
    a, b = text.split(":")
    start = dt.datetime.strptime(a, "%Y-%m-%d")
    end = dt.datetime.strptime(b, "%Y-%m-%d") + dt.timedelta(days=1)
    return start, end


# ---------------------------------------------------------------------------
# Statistiques
# ---------------------------------------------------------------------------
def betacf(a, b, x):
    """Fraction continue de la fonction bêta incomplète (Numerical Recipes)."""
    qab, qap, qam = a + b, a + 1.0, a - 1.0
    c, d = 1.0, 1.0 - qab * x / qap
    d = 1.0 / (d if abs(d) > 1e-300 else 1e-300)
    h = d
    for m in range(1, 300):
        m2 = 2 * m
        aa = m * (b - m) * x / ((qam + m2) * (a + m2))
        d = 1.0 + aa * d
        d = 1.0 / (d if abs(d) > 1e-300 else 1e-300)
        c = 1.0 + aa / c
        c = c if abs(c) > 1e-300 else 1e-300
        h *= d * c
        aa = -(a + m) * (qab + m) * x / ((a + m2) * (qap + m2))
        d = 1.0 + aa * d
        d = 1.0 / (d if abs(d) > 1e-300 else 1e-300)
        c = 1.0 + aa / c
        c = c if abs(c) > 1e-300 else 1e-300
        delta = d * c
        h *= delta
        if abs(delta - 1.0) < 1e-12:
            break
    return h


def betainc(a, b, x):
    if x <= 0.0:
        return 0.0
    if x >= 1.0:
        return 1.0
    lbeta = math.lgamma(a + b) - math.lgamma(a) - math.lgamma(b) + a * math.log(x) + b * math.log(1.0 - x)
    if x < (a + 1.0) / (a + b + 2.0):
        return math.exp(lbeta) * betacf(a, b, x) / a
    return 1.0 - math.exp(lbeta) * betacf(b, a, 1.0 - x) / b


def t_sf(t, df):
    """P(T > t) pour une loi de Student à df degrés de liberté."""
    x = df / (df + t * t)
    p_two = betainc(df / 2.0, 0.5, x)
    return p_two / 2.0 if t > 0 else 1.0 - p_two / 2.0


def bootstrap_ci(values, n_boot=2000, alpha=0.05, seed=12345):
    if len(values) < 2:
        return (float("nan"), float("nan"))
    rng = random.Random(seed)
    n = len(values)
    means = []
    for _ in range(n_boot):
        s = 0.0
        for _ in range(n):
            s += values[rng.randrange(n)]
        means.append(s / n)
    means.sort()
    lo = means[int(alpha / 2 * n_boot)]
    hi = means[int((1 - alpha / 2) * n_boot) - 1]
    return (lo, hi)


def bootstrap_diff_ci(a, b, n_boot=1000, alpha=0.05, seed=777):
    """IC bootstrap de la différence des moyennes (a - b), échantillons rééchantillonnés séparément."""
    if len(a) < 2 or len(b) < 2:
        return (float("nan"), float("nan"))
    rng = random.Random(seed)
    diffs = []
    na, nb = len(a), len(b)
    for _ in range(n_boot):
        ma = sum(a[rng.randrange(na)] for _ in range(na)) / na
        mb = sum(b[rng.randrange(nb)] for _ in range(nb)) / nb
        diffs.append(ma - mb)
    diffs.sort()
    return (diffs[int(alpha / 2 * n_boot)], diffs[int((1 - alpha / 2) * n_boot) - 1])


def quantile(sorted_values, p):
    return sorted_values[min(len(sorted_values) - 1, int(p * len(sorted_values)))]


def monte_carlo(rs, n_paths=1000, seed=4242):
    """Rééchantillonnage AVEC remise des résultats en R (composition et ordre des trades) :
    distribution du drawdown maximal et du résultat total sur le même nombre de trades.
    Hypothèse : trades indépendants (la dépendance réelle entre trades n'est pas modélisée)."""
    if len(rs) < 2 or n_paths < 1:
        return None
    rng = random.Random(seed)
    n = len(rs)
    dds = []
    totals = []
    for _ in range(n_paths):
        cum = peak = dd = 0.0
        for _ in range(n):
            cum += rs[rng.randrange(n)]
            if cum > peak:
                peak = cum
            elif peak - cum > dd:
                dd = peak - cum
        dds.append(dd)
        totals.append(cum)
    dds.sort()
    totals.sort()
    return {"dd_p50": quantile(dds, 0.50), "dd_p95": quantile(dds, 0.95), "dd_p99": quantile(dds, 0.99),
            "total_p05": quantile(totals, 0.05), "total_p50": quantile(totals, 0.50),
            "p_loss": sum(1 for x in totals if x <= 0.0) / len(totals), "paths": n_paths}


def period_key(d, period):
    if period == "month":
        return "%d-%02d" % (d.year, d.month)
    return "%d-T%d" % (d.year, (d.month - 1) // 3 + 1)


def stress_in_r(t, criteria):
    """Coût supplémentaire du stress exprimé en R pour une position.
    stress_extra_cost_price : en prix (ex. 0.20 USD/once) - nécessite la colonne point ;
    stress_extra_cost_points : en points du symbole (ancien format)."""
    if t["risk_points"] <= 0:
        return 0.0
    price = criteria.get("stress_extra_cost_price")
    if price is not None and t.get("point", 0.0) > 0:
        return price / (t["risk_points"] * t["point"])
    pts = criteria.get("stress_extra_cost_points", 0.0)
    return pts / t["risk_points"]


def stress_label(criteria):
    if criteria.get("stress_extra_cost_price") is not None:
        return "+%.2f en prix par trade" % criteria["stress_extra_cost_price"]
    return "+%.0f points par trade" % criteria.get("stress_extra_cost_points", 0.0)


def metrics(trades, criteria, n_variants):
    m = {"n": len(trades)}
    if not trades:
        return m
    nets = [t["net"] for t in trades]
    with_r = [t for t in trades if t["risk_money"] > 0]
    rs = [t["r_multiple"] for t in with_r]
    wins = [x for x in nets if x > 0]
    losses = [x for x in nets if x < 0]
    m["wins"] = len(wins)
    m["losses"] = len(losses)
    m["win_rate"] = 100.0 * len(wins) / len(trades)
    m["net"] = sum(nets)
    m["expectancy"] = m["net"] / len(trades)
    m["avg_win"] = sum(wins) / len(wins) if wins else 0.0
    m["avg_loss"] = -sum(losses) / len(losses) if losses else 0.0
    gl = -sum(losses)
    m["profit_factor"] = (sum(wins) / gl) if gl > 0 else float("inf")
    # drawdown et séries (ordre chronologique de clôture)
    cum = peak = dd = 0.0
    streak = longest = 0
    for x in nets:
        cum += x
        peak = max(peak, cum)
        dd = max(dd, peak - cum)
        if x < 0:
            streak += 1
            longest = max(longest, streak)
        elif x > 0:
            streak = 0
    m["max_dd"] = dd
    m["longest_loss_streak"] = longest
    cum = peak = ddr = 0.0
    for r in rs:
        cum += r
        peak = max(peak, cum)
        ddr = max(ddr, peak - cum)
    m["max_dd_r"] = ddr
    m["n_r"] = len(rs)
    if rs:
        mean = sum(rs) / len(rs)
        m["expectancy_r"] = mean
        if len(rs) > 1:
            var = sum((r - mean) ** 2 for r in rs) / (len(rs) - 1)
            sd = math.sqrt(var)
            m["sd_r"] = sd
            tstat = mean / (sd / math.sqrt(len(rs))) if sd > 0 else 0.0
            m["t_stat"] = tstat
            m["p_value"] = t_sf(tstat, len(rs) - 1) if sd > 0 else 1.0
            m["p_adjusted"] = min(1.0, m["p_value"] * max(1, n_variants))
            m["ci_r"] = bootstrap_ci(rs)
        # stress des coûts : coût supplémentaire en points, converti en R
        stressed = [t["r_multiple"] - stress_in_r(t, criteria) for t in with_r]
        m["stressed_expectancy_r"] = sum(stressed) / len(stressed)
        # dépendance aux meilleurs trades : espérance sans les 5 % meilleurs
        k = max(1, int(0.05 * len(rs)))
        trimmed = sorted(rs)[:-k]
        m["expectancy_r_wo_top5"] = (sum(trimmed) / len(trimmed)) if trimmed else float("nan")
        m["mc"] = monte_carlo(rs, int(criteria.get("mc_paths", 1000)))
    m["avg_duration_min"] = sum(t["duration_s"] for t in trades) / len(trades) / 60.0
    m["commission"] = sum(t["commission"] for t in trades)
    m["swap"] = sum(t["swap"] for t in trades)
    m["fee"] = sum(t["fee"] for t in trades)
    m["est_cost"] = sum(t["est_cost"] for t in trades)
    slip = [t["slippage_pts"] for t in trades]
    m["avg_slippage_pts"] = sum(slip) / len(slip)
    # stabilité par période
    per = {}
    for t in trades:
        per.setdefault(period_key(t["close_dt"], criteria["period"]), []).append(t)
    counted = [v for v in per.values() if len(v) >= criteria["min_trades_per_period"]]
    pos = [v for v in counted if sum((x["r_multiple"] if x["risk_money"] > 0 else x["net"]) for x in v) > 0]
    m["periods_counted"] = len(counted)
    m["positive_period_ratio"] = (len(pos) / len(counted)) if counted else 0.0
    return m


def evaluate(m, criteria, split):
    """Liste de (critère, valeur, seuil, réussi)."""
    out = []
    n_min = criteria["min_trades"].get(split, 0)
    out.append(("trades", m.get("n", 0), ">= %d" % n_min, m.get("n", 0) >= n_min))
    if m.get("n", 0) == 0:
        return out
    er = m.get("expectancy_r", float("nan"))
    out.append(("espérance R", er, ">= %.2f" % criteria["min_expectancy_r"], er >= criteria["min_expectancy_r"]))
    pf = m.get("profit_factor", 0.0)
    out.append(("profit factor", pf, ">= %.2f" % criteria["min_profit_factor"], pf >= criteria["min_profit_factor"]))
    dd = m.get("max_dd_r", float("inf"))
    out.append(("drawdown max R", dd, "<= %.1f" % criteria["max_drawdown_r"], dd <= criteria["max_drawdown_r"]))
    pr = m.get("positive_period_ratio", 0.0)
    out.append(("périodes positives", pr, ">= %.0f %%" % (100 * criteria["min_positive_period_ratio"]),
                pr >= criteria["min_positive_period_ratio"] and m.get("periods_counted", 0) >= 2))
    pa = m.get("p_adjusted", 1.0)
    out.append(("p-valeur corrigée", pa, "<= %.3f" % criteria["max_adjusted_p_value"], pa <= criteria["max_adjusted_p_value"]))
    se = m.get("stressed_expectancy_r", float("nan"))
    out.append(("espérance R sous stress", se, "> %.2f" % criteria["min_stressed_expectancy_r"], se > criteria["min_stressed_expectancy_r"]))
    if criteria.get("max_mc_drawdown_r_p95") is not None:
        mc = m.get("mc")
        v = mc["dd_p95"] if mc else float("inf")
        out.append(("drawdown Monte-Carlo p95 R", v, "<= %.1f" % criteria["max_mc_drawdown_r_p95"], v <= criteria["max_mc_drawdown_r_p95"]))
    return out


def breakdown(trades, key):
    groups = {}
    for t in trades:
        k = key(t)
        groups.setdefault(k, []).append(t)
    rows = []
    for k in sorted(groups):
        g = groups[k]
        wr = 100.0 * sum(1 for t in g if t["net"] > 0) / len(g)
        rr = [t["r_multiple"] for t in g if t["risk_money"] > 0]
        er = sum(rr) / len(rr) if rr else float("nan")
        rows.append((k, len(g), wr, sum(t["net"] for t in g), er))
    return rows


def zone_freshness(t):
    """Zone d'origine à l'entrée : 1er retour (zone fraîche) ou zone déjà revisitée (retours comptés
    contact actuel compris) ; vide pour les familles sans zone suivie ou un plan reconstruit."""
    if not t.get("zone_id"):
        return "sans zone suivie"
    return "zone fraîche (1er retour)" if t.get("zone_retests", 0) <= 1 else "zone déjà revisitée"


def filter_verdicts(results, groups, baseline, splits, criteria, unlock_test):
    """Règle pré-enregistrée : un filtre (variante) n'est CONSERVÉ que s'il améliore l'espérance R de la
    référence en développement ET en validation (et au test final s'il est déverrouillé), avec assez de
    trades dans chaque période et une espérance sous stress des coûts positive en validation.
    Sinon : DÉSACTIVER (le filtre ne fait que réduire l'échantillon ou dégrade le résultat)."""
    order = [s for s in ("dev", "val", "test") if s in splits and (s != "test" or unlock_test)]
    out = []
    for g in groups:
        if g == baseline:
            continue
        reasons = []
        deltas = []
        for s in order:
            m = results.get((g, s), ({}, []))[0]
            r = results.get((baseline, s), ({}, []))[0]
            n = m.get("n", 0)
            if n < criteria["min_trades"].get(s, 0):
                reasons.append("%s : %d trades < %d" % (s, n, criteria["min_trades"].get(s, 0)))
            ev, er = m.get("expectancy_r"), r.get("expectancy_r")
            if ev is None or er is None:
                reasons.append("%s : espérance indisponible" % s)
                deltas.append(float("nan"))
                continue
            d = ev - er
            deltas.append(d)
            if not d > 0:
                reasons.append("%s : écart d'espérance %s R" % (s, fmt(d)))
        mv = results.get((g, "val"), ({}, []))[0]
        if "val" in splits and not mv.get("stressed_expectancy_r", float("nan")) > criteria["min_stressed_expectancy_r"]:
            reasons.append("val : espérance sous stress %s R" % fmt(mv.get("stressed_expectancy_r", float("nan"))))
        out.append((g, "CONSERVER (candidat)" if not reasons else "DÉSACTIVER", deltas, order, reasons))
    return out


def fmt(x, nd=2):
    if isinstance(x, float):
        if math.isnan(x):
            return "n/d"
        if math.isinf(x):
            return "inf"
        return ("%%.%df" % nd) % x
    return str(x)


# ---------------------------------------------------------------------------
# Rapport
# ---------------------------------------------------------------------------
def build_report(trades, splits, criteria, n_variants, unlock_test, baseline=None):
    envs = sorted(set(t["env"] for t in trades))
    lines = ["# Rapport de comparaison des familles", ""]
    lines.append("Généré le %s. Environnements : %s." % (dt.datetime.now().strftime("%Y-%m-%d %H:%M"), ", ".join(envs)))
    if len(envs) > 1:
        lines.append("")
        lines.append("> ATTENTION : plusieurs environnements mélangés (backtest / démo / réel). "
                     "Les résultats doivent être évalués séparément.")
    lines.append("")
    lines.append("Variantes testées déclarées : %d (correction de Bonferroni). "
                 "Stress des coûts : %s." % (n_variants, stress_label(criteria)))
    lines.append("")
    groups = sorted(set(t["group"] for t in trades))
    results = {}
    for split, (start, end) in splits.items():
        if split == "test" and not unlock_test:
            lines.append("## Test final hors échantillon : VERROUILLÉ")
            lines.append("")
            lines.append("L'échantillon de test n'est pas évalué tant que la sélection n'est pas figée "
                         "(option --unlock-test). Il ne doit être utilisé qu'UNE seule fois.")
            lines.append("")
            continue
        names = {"dev": "Développement", "val": "Validation", "test": "Test final hors échantillon"}
        lines.append("## %s (%s -> %s)" % (names[split], start.date(), (end - dt.timedelta(days=1)).date()))
        lines.append("")
        lines.append("| Groupe | Trades | Réussite % | PF | Net | Esp. | Esp. R | IC95 R | p corr. | DD R | Série pertes | Pér. + | Esp. R stress | Glissement |")
        lines.append("|---|---|---|---|---|---|---|---|---|---|---|---|---|---|")
        for g in groups:
            sub = [t for t in trades if t["group"] == g and start <= t["close_dt"] < end]
            m = metrics(sub, criteria, n_variants)
            ev = evaluate(m, criteria, split)
            results[(g, split)] = (m, ev)
            if m["n"] == 0:
                lines.append("| %s | 0 | | | | | | | | | | | | |" % g)
                continue
            ci = m.get("ci_r", (float("nan"), float("nan")))
            lines.append("| %s | %d | %s | %s | %s | %s | %s | [%s ; %s] | %s | %s | %d | %s | %s | %s |" % (
                g, m["n"], fmt(m["win_rate"], 1), fmt(m["profit_factor"]), fmt(m["net"]), fmt(m["expectancy"]),
                fmt(m.get("expectancy_r", float("nan"))), fmt(ci[0]), fmt(ci[1]), fmt(m.get("p_adjusted", float("nan")), 3),
                fmt(m["max_dd_r"]), m["longest_loss_streak"], fmt(100 * m["positive_period_ratio"], 0) + " %",
                fmt(m.get("stressed_expectancy_r", float("nan"))), fmt(m["avg_slippage_pts"], 1)))
        lines.append("")
        lines.append("Robustesse (Monte-Carlo : %d tirages avec remise des résultats en R, trades supposés indépendants) :" %
                     int(criteria.get("mc_paths", 1000)))
        lines.append("")
        lines.append("| Groupe | DD médian R | DD p95 R | DD p99 R | Total p05 R | Total médian R | P(total <= 0) | Esp. R sans 5 % meilleurs |")
        lines.append("|---|---|---|---|---|---|---|---|")
        for g in groups:
            m = results[(g, split)][0]
            mc = m.get("mc")
            if not mc:
                continue
            lines.append("| %s | %s | %s | %s | %s | %s | %s | %s |" % (
                g, fmt(mc["dd_p50"]), fmt(mc["dd_p95"]), fmt(mc["dd_p99"]), fmt(mc["total_p05"]), fmt(mc["total_p50"]),
                fmt(100 * mc["p_loss"], 1) + " %", fmt(m.get("expectancy_r_wo_top5", float("nan")))))
        lines.append("")
        if baseline:
            ref = [t["r_multiple"] for t in trades if t["group"] == baseline and start <= t["close_dt"] < end and t["risk_money"] > 0]
            lines.append("Comparaison avec la référence **%s** (%d trades) :" % (baseline, len(ref)))
            lines.append("")
            if not ref:
                lines.append("_Référence absente de cette période : aucune comparaison._")
            else:
                ref_mean = sum(ref) / len(ref)
                lines.append("| Variante | Trades | Esp. R | Écart d'esp. R | IC95 de l'écart | Trades vs réf. |")
                lines.append("|---|---|---|---|---|---|")
                for g in groups:
                    if g == baseline:
                        continue
                    var = [t["r_multiple"] for t in trades if t["group"] == g and start <= t["close_dt"] < end and t["risk_money"] > 0]
                    if not var:
                        lines.append("| %s | 0 | | | | |" % g)
                        continue
                    lo, hi = bootstrap_diff_ci(var, ref)
                    lines.append("| %s | %d | %s | %s | [%s ; %s] | %s %% |" % (
                        g, len(var), fmt(sum(var) / len(var)), fmt(sum(var) / len(var) - ref_mean), fmt(lo), fmt(hi),
                        fmt(100.0 * len(var) / len(ref), 0)))
                lines.append("")
                lines.append("_Les variantes sont rejouées sur les MÊMES données de marché : les échantillons ne sont pas "
                             "indépendants et l'intervalle est indicatif. Un filtre n'est conservé que s'il améliore le "
                             "résultat en développement ET en validation, sans réduire l'échantillon sous les minimums._")
            lines.append("")
        lines.append("Critères pré-enregistrés :")
        lines.append("")
        for g in groups:
            m, ev = results[(g, split)]
            ok = all(e[3] for e in ev)
            detail = ", ".join("%s %s (%s)%s" % (e[0], fmt(e[1]) if isinstance(e[1], float) else e[1], e[2], "" if e[3] else " ✗") for e in ev)
            lines.append("- **%s** : %s — %s" % (g, "RÉUSSI" if ok else "ÉCHEC", detail))
        lines.append("")
        for g in groups:
            sub = [t for t in trades if t["group"] == g and start <= t["close_dt"] < end]
            if not sub:
                continue
            lines.append("<details><summary>%s — détails (%s)</summary>" % (g, names[split]))
            lines.append("")
            m = results[(g, split)][0]
            lines.append("Gain moyen %s, perte moyenne %s, durée moyenne %s min, commissions %s, swaps %s, frais %s, coûts estimés %s." % (
                fmt(m["avg_win"]), fmt(m["avg_loss"]), fmt(m["avg_duration_min"], 1), fmt(m["commission"]), fmt(m["swap"]),
                fmt(m["fee"]), fmt(m["est_cost"])))
            lines.append("")
            for title, key in (("Session", lambda t: t["session"]), ("Sortie", lambda t: t["exit_reason"]),
                               ("Tranche de score (calibration)", lambda t: "%02d-%02d" % (int(t["score"] // 10) * 10, int(t["score"] // 10) * 10 + 9)),
                               ("Sens", lambda t: t["dir"]), ("Entrée sur retest", lambda t: t.get("retest", "?")),
                               ("Régime à l'entrée", lambda t: t.get("regime", "?")),
                               ("Figure de bougie retenue", lambda t: t.get("candle", "aucune")),
                               ("Fraîcheur de la zone (F6)", zone_freshness)):
                lines.append("| %s | Trades | Réussite %% | Net | Esp. R |" % title)
                lines.append("|---|---|---|---|---|")
                for k, n, wr, net, er in breakdown(sub, key):
                    lines.append("| %s | %d | %s | %s | %s |" % (k, n, fmt(wr, 1), fmt(net), fmt(er)))
                lines.append("")
            lines.append("</details>")
            lines.append("")

    if baseline:
        lines.append("## Verdict des filtres (référence : %s)" % baseline)
        lines.append("")
        verdicts = filter_verdicts(results, groups, baseline, splits, criteria, unlock_test)
        lines.append("| Variante | Verdict | %s | Motifs |" % " | ".join("Écart R (%s)" % s for s in (verdicts[0][3] if verdicts else [])))
        lines.append("|---|---|%s---|" % ("---|" * len(verdicts[0][3] if verdicts else [])))
        for g, verdict, deltas, order, reasons in verdicts:
            lines.append("| %s | **%s** | %s | %s |" % (g, verdict, " | ".join(fmt(d) for d in deltas), "; ".join(reasons) if reasons else "—"))
        lines.append("")
        lines.append("_Un filtre marqué DÉSACTIVER doit être désactivé dans les paramètres (son apport n'est pas démontré "
                     "hors échantillon). Un filtre CONSERVÉ reste un candidat : il doit encore passer le test final et la démo._")
        lines.append("")

    # décision
    lines.append("## Décision")
    lines.append("")
    eligible = []
    for g in groups:
        ok_dev = ("dev" in splits) and all(e[3] for e in results.get((g, "dev"), ({}, [("x", 0, "", False)]))[1])
        ok_val = ("val" in splits) and all(e[3] for e in results.get((g, "val"), ({}, [("x", 0, "", False)]))[1])
        if ok_dev and ok_val:
            ci = results[(g, "val")][0].get("ci_r", (float("-inf"), 0))
            eligible.append((ci[0], g))
    if not eligible:
        lines.append("**Aucune famille ne satisfait les critères en développement ET en validation.** "
                     "Aucune stratégie n'est retenue : conserver le robot en mode recherche ou démo. "
                     "Toute modification doit faire l'objet d'une NOUVELLE version, testée à son tour "
                     "(et comptée dans le nombre de variantes).")
    else:
        eligible.sort(reverse=True)
        best = eligible[0][1]
        lines.append("Familles éligibles (classées par borne basse de l'IC95 de l'espérance R en validation) : %s." %
                     ", ".join("%s (%s)" % (g, fmt(lo)) for lo, g in eligible))
        lines.append("")
        lines.append("**Candidate retenue : %s.**" % best)
        lines.append("")
        if "test" in splits and unlock_test:
            m, ev = results[(best, "test")]
            ok = all(e[3] for e in ev)
            lines.append("Test final hors échantillon : **%s**." % ("RÉUSSI" if ok else "ÉCHEC"))
            if not ok:
                lines.append("La candidate échoue hors échantillon : ne pas l'utiliser en réel ; retour en recherche.")
            else:
                lines.append("Étape suivante : période de démo (comportement réel du courtier : spreads, glissement, "
                             "rejets) avant toute utilisation réelle, avec risque minimal.")
        else:
            lines.append("Étape suivante : figer la candidate et ses paramètres, PUIS lancer une seule fois le test "
                         "final avec --unlock-test.")
    lines.append("")
    lines.append("_Le score de signal n'est pas une probabilité ; les résultats passés ne garantissent pas les "
                 "résultats futurs._")
    return "\n".join(lines) + "\n", results, eligible


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("files", nargs="+", help="fichiers *_trades.csv exportés par l'EA")
    ap.add_argument("--dev", required=True, help="période de développement AAAA-MM-JJ:AAAA-MM-JJ")
    ap.add_argument("--val", required=True, help="période de validation")
    ap.add_argument("--test", help="période de test final hors échantillon")
    ap.add_argument("--unlock-test", action="store_true", help="évaluer le test final (une seule fois, sélection figée)")
    ap.add_argument("--variants", type=int, default=4, help="nombre total de variantes testées (familles x jeux de paramètres)")
    ap.add_argument("--criteria", help="fichier JSON des critères pré-enregistrés")
    ap.add_argument("--per-file", action="store_true", help="un groupe par fichier (variantes de paramètres)")
    ap.add_argument("--env", help="ne garder qu'un environnement (BACKTEST, DEMO, REEL)")
    ap.add_argument("--group-by", choices=["family", "label"], default="family",
                    help="label : un groupe par famille et libellé d'essai (InpRunLabel), pour les comparaisons A/B")
    ap.add_argument("--baseline", help="groupe de référence pour la comparaison A/B, ex. \"F1|reference\"")
    ap.add_argument("--out", default="rapport_comparaison.md")
    args = ap.parse_args(argv)

    criteria = dict(DEFAULT_CRITERIA)
    if args.criteria:
        with open(args.criteria, encoding="utf-8") as fh:
            user = json.load(fh)
        criteria.update(user)
    trades = load_trades(args.files, args.per_file, args.group_by)
    if args.env:
        trades = [t for t in trades if t["env"] == args.env]
    if not trades:
        print("Aucun trade lu.")
        return 1
    splits = {"dev": parse_range(args.dev), "val": parse_range(args.val)}
    if args.test:
        splits["test"] = parse_range(args.test)
    keys = list(splits.values())
    for i in range(len(keys)):
        for j in range(i + 1, len(keys)):
            if keys[i][0] < keys[j][1] and keys[j][0] < keys[i][1]:
                print("ERREUR : les périodes se chevauchent.")
                return 2
    if args.baseline and args.baseline not in set(t["group"] for t in trades):
        print("ERREUR : groupe de référence introuvable : %s (groupes : %s)" % (args.baseline, ", ".join(sorted(set(t["group"] for t in trades)))))
        return 3
    report, _, _ = build_report(trades, splits, criteria, args.variants, args.unlock_test, args.baseline)
    with open(args.out, "w", encoding="utf-8") as fh:
        fh.write(report)
    print("Rapport écrit : %s (%d trades lus)" % (args.out, len(trades)))
    return 0


if __name__ == "__main__":
    sys.exit(main())
