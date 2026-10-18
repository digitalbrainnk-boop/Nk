#!/usr/bin/env bash
# Compilation RÉELLE de l'EA avec MetaEditor (compilateur officiel MQL5), sous Wine, sans écran.
#
# Usage : tests/compile_metaeditor.sh [chemin/vers/metaeditor64.exe]
#   Sans argument : variable METAEDITOR, sinon installation MT5 déjà présente dans le préfixe Wine
#   (WINEPREFIX, défaut ~/.wine-gls), sinon téléchargement de l'installateur officiel MetaQuotes
#   (accès réseau à download.mql5.com et aux serveurs de téléchargement MetaQuotes requis ;
#   désactivable avec GLS_INSTALL_MT5=0).
# Sortie (dossier tests/build/metaeditor) : journal du compilateur (UTF-8), Gold_Liquidity_Scalper.ex5,
#   résumé des erreurs et avertissements RÉELLEMENT signalés par MetaEditor.
# Code retour : 0 = 0 erreur et 0 avertissement ; 1 = erreurs ou avertissements ; 2 = compilateur
#   indisponible ou compilation non exécutée (rien n'est alors affirmé sur la compilation).
set -uo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
SRC="$HERE/../MQL5/Experts/GoldLiquidityScalper"
OUT="${GLS_COMPILE_OUT:-$HERE/build/metaeditor}"
export WINEPREFIX="${WINEPREFIX:-$HOME/.wine-gls}"
export WINEDEBUG=-all
mkdir -p "$OUT"

for tool in wine winepath xvfb-run iconv python3; do
  command -v "$tool" >/dev/null 2>&1 || { echo "ÉCHEC : outil manquant : $tool"; exit 2; }
done

find_metaeditor() {
  find "$WINEPREFIX/drive_c" -iname 'metaeditor64.exe' 2>/dev/null | head -1
}

ME="${1:-${METAEDITOR:-}}"
[ -z "$ME" ] && [ -d "$WINEPREFIX/drive_c" ] && ME="$(find_metaeditor)"
if [ -z "$ME" ] && [ "${GLS_INSTALL_MT5:-1}" = "1" ]; then
  echo "MetaEditor introuvable : téléchargement de l'installateur officiel MetaQuotes..."
  if ! curl -fsSL -m 300 -o "$OUT/mt5setup.exe" \
       https://download.mql5.com/cdn/web/metaquotes.software.corp/mt5/mt5setup.exe; then
    echo "ÉCHEC : téléchargement impossible (accès réseau à download.mql5.com refusé ?)."
    echo "Aucune compilation MetaEditor n'a eu lieu."
    exit 2
  fi
  wineboot -i >/dev/null 2>&1 || true
  echo "Installation de MetaTrader 5 dans $WINEPREFIX (plusieurs minutes)..."
  timeout 1800 xvfb-run -a wine "$OUT/mt5setup.exe" /auto >/dev/null 2>&1 || true
  ME="$(find_metaeditor)"
fi
if [ -z "$ME" ] || [ ! -f "$ME" ]; then
  echo "ÉCHEC : metaeditor64.exe introuvable. Aucune compilation MetaEditor n'a eu lieu."
  exit 2
fi
echo "Compilateur : $ME"

# copie des sources dans une arborescence MQL5 de travail (chemins sans espaces)
WORK="$OUT/MQL5"
rm -rf "$WORK"
mkdir -p "$WORK/Experts" "$WORK/Include"
cp -r "$SRC" "$WORK/Experts/"
MQ5="$WORK/Experts/GoldLiquidityScalper/Gold_Liquidity_Scalper.mq5"
EX5="${MQ5%.mq5}.ex5"
LOG="$OUT/compile.log"
rm -f "$LOG" "$EX5"
WMQ5="$(winepath -w "$MQ5")"
WLOG="$(winepath -w "$LOG")"
WINC="$(winepath -w "$WORK")"
timeout 900 xvfb-run -a wine "$ME" /compile:"$WMQ5" /log:"$WLOG" /inc:"$WINC" >/dev/null 2>&1
if [ ! -f "$LOG" ]; then
  echo "ÉCHEC : MetaEditor n'a produit aucun journal. Compilation non vérifiée."
  exit 2
fi
python3 -c "import sys; sys.path.insert(0, '$HERE'); import parse_metaeditor_log as p; open('$OUT/compile_utf8.log','w',encoding='utf-8').write(p.read_log('$LOG'))"
python3 "$HERE/parse_metaeditor_log.py" "$LOG"
rc=$?
if [ -f "$EX5" ]; then
  cp "$EX5" "$OUT/"
  echo "Fichier compilé : $OUT/$(basename "$EX5") ($(stat -c %s "$EX5") octets)"
elif [ $rc -eq 0 ]; then
  echo "ATTENTION : journal sans erreur mais aucun .ex5 produit."
  rc=1
fi
exit $rc
