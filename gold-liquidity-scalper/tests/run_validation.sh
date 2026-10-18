#!/usr/bin/env bash
# Validation PAR SIMULATION sur données M1 réelles exportées de MetaTrader 5.
#
# Usage : tests/run_validation.sh DONNEES_M1.csv [préréglages...]
#   Préréglages par défaut : les 6 familles (tester/sets/F*.set). Exemples :
#     tests/run_validation.sh donnees/XAUUSDm_M1.csv
#     tests/run_validation.sh donnees/XAUUSDm_M1.csv tester/sets/fvg_*.set
# Variables : DEV=AAAA-MM-JJ:AAAA-MM-JJ VAL=... TEST=... (sinon 60 % / 20 % / 20 % des dates),
#   UNLOCK_TEST=1 (évaluer le test final : UNE seule fois, sélection figée), BASELINE="F1|ab_reference",
#   REPLAY_OPTS="--balance 1000 --commission 0 --slippage 0.02 --utc-offset 0" (options de replay_main.cpp),
#   JOBS (rejeux en parallèle, défaut : nombre de cœurs).
# Sortie : validation/<horodatage>/ (trades, signaux, rapports de l'EA, rapport du protocole).
#
# Limites : exécution simulée (4 cotations par barre, pas de ticks réels, glissement fixe) ; la
# validation de référence reste le testeur MT5 puis la démo (docs/PROTOCOLE_VALIDATION.md).
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$HERE/.."
DATA="${1:?usage : run_validation.sh DONNEES_M1.csv [préréglages...]}"
shift || true
if [ $# -gt 0 ]; then SETS=("$@"); else SETS=("$ROOT"/tester/sets/F[1-6]_*.set); fi
OUTDIR="${OUTDIR:-$ROOT/validation/$(date -u +%Y%m%d_%H%M%S)}"
mkdir -p "$OUTDIR"
JOBS="${JOBS:-$(nproc)}"
# export zippé (fichier trop gros pour GitHub) : extraction du premier fichier .csv
if [[ "$DATA" == *.zip ]]; then
  python3 - "$DATA" "$OUTDIR/donnees_M1.csv" <<'PY'
import sys, zipfile, shutil
with zipfile.ZipFile(sys.argv[1]) as z:
    name = next(n for n in z.namelist() if n.lower().endswith((".csv", ".txt")))
    with z.open(name) as src, open(sys.argv[2], "wb") as dst:
        shutil.copyfileobj(src, dst)
PY
  DATA="$OUTDIR/donnees_M1.csv"
fi

echo "1/3 Compilation du rejeu (code de l'EA traduit en C++, avertissements = erreurs)..."
rm -rf "$HERE/build/mql"
mkdir -p "$HERE/build/mql"
python3 "$HERE/mql2cpp.py" "$ROOT/MQL5/Experts/GoldLiquidityScalper" "$HERE/build/mql"
"${CXX:-g++}" -std=c++17 -O2 -Wall -Wextra -Wshadow -Wconversion -Wsign-compare -Wno-unused-parameter -Werror \
  -I"$HERE" -I"$HERE/build" "$HERE/replay_main.cpp" -o "$HERE/build/replay"

echo "2/3 Rejeu de ${#SETS[@]} préréglage(s) sur $DATA ($JOBS en parallèle)..."
printf '%s\n' "${SETS[@]}" | xargs -P "$JOBS" -I{} sh -c \
  '"$0" --data "$1" --set "{}" --out "$2" $3 > "$2/$(basename "{}" .set).replay.log" 2>&1 || echo "ÉCHEC du rejeu : {}"' \
  "$HERE/build/replay" "$DATA" "$OUTDIR" "${REPLAY_OPTS:-}"
grep -h "Terminé\|ERREUR" "$OUTDIR"/*.replay.log || true

echo "3/3 Protocole statistique..."
if [ -z "${DEV:-}" ] || [ -z "${VAL:-}" ]; then
  read -r DEV VAL TEST_AUTO < <(python3 - "$DATA" <<'PY'
import sys, datetime as dt
first = last = None
with open(sys.argv[1], encoding="utf-8-sig", errors="replace") as fh:
    for line in fh:
        d = line.strip().split()[0] if line.strip() else ""
        if not d[:1].isdigit():
            continue
        d = d.replace(".", "-")[:10]
        first = first or d
        last = d
a = dt.date.fromisoformat(first); b = dt.date.fromisoformat(last)
span = (b - a).days
c1 = a + dt.timedelta(days=int(span * 0.6)); c2 = a + dt.timedelta(days=int(span * 0.8))
one = dt.timedelta(days=1)
print("%s:%s %s:%s %s:%s" % (a, c1, c1 + one, c2, c2 + one, b))
PY
)
  TEST="${TEST:-$TEST_AUTO}"
fi
ARGS=(--dev "$DEV" --val "$VAL" --variants "${#SETS[@]}" --criteria "$ROOT/tools/criteria_default.json" --group-by label --env BACKTEST)
[ -n "${TEST:-}" ] && ARGS+=(--test "$TEST")
[ "${UNLOCK_TEST:-0}" = "1" ] && ARGS+=(--unlock-test)
[ -n "${BASELINE:-}" ] && ARGS+=(--baseline "$BASELINE")
shopt -s nullglob
TRADES=("$OUTDIR"/*_trades.csv)
if [ ${#TRADES[@]} -eq 0 ]; then
  echo "Aucun fichier de trades produit : aucune transaction dans les rejeux (voir $OUTDIR/*.replay.log)."
  exit 1
fi
python3 "$ROOT/tools/analyze_trades.py" "${TRADES[@]}" "${ARGS[@]}" --out "$OUTDIR/rapport_validation.md"
echo "Périodes : développement $DEV, validation $VAL, test ${TEST:-non défini} (test évalué : ${UNLOCK_TEST:-0})"
echo "Rapport : $OUTDIR/rapport_validation.md"
