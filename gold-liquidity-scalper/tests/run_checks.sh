#!/usr/bin/env bash
# Vérification du code MQL5 hors MetaTrader :
#  1. contrôles des règles MQL5 + traduction vers C++ (mql2cpp.py)
#  2. compilation C++ stricte (avertissements = erreurs) avec le shim MQL5
#  3. exécution des tests unitaires et d'intégration (courtier simulé)
# Ne remplace PAS la compilation dans MetaEditor (voir README).
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
SRC="$HERE/../MQL5/Experts/GoldLiquidityScalper"
BUILD="$HERE/build"
rm -rf "$BUILD/mql"
mkdir -p "$BUILD/mql"
python3 "$HERE/mql2cpp.py" "$SRC" "$BUILD/mql"
CXX="${CXX:-g++}"
FLAGS=(-std=c++17 -O2 -g -Wall -Wextra -Wshadow -Wconversion -Wsign-compare -Wno-unused-parameter -Werror)
echo "Compilation C++ stricte ($CXX)..."
"$CXX" "${FLAGS[@]}" -I"$HERE" -I"$BUILD" "$HERE/test_main.cpp" -o "$BUILD/gls_tests"
echo "Compilation du rejeu sur données réelles (replay_main.cpp)..."
"$CXX" "${FLAGS[@]}" -I"$HERE" -I"$BUILD" "$HERE/replay_main.cpp" -o "$BUILD/replay"
echo "Exécution des tests..."
"$BUILD/gls_tests"
echo "Application d'analyse : cohérence avec tools/analyze_trades.py..."
python3 "$HERE/check_app_stats.py"
