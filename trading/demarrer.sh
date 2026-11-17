#!/usr/bin/env bash
# Lancement de NK Trader sur macOS / Linux.
# Usage : ./demarrer.sh                 (simulateur)
#         ./demarrer.sh --provider deriv (données réelles Deriv)
# Le téléphone peut ouvrir l'application par le même Wi-Fi (bouton « Téléphone »).
set -e
cd "$(dirname "$0")"
if [ ! -d .venv ]; then
  echo "Première installation…"
  python3 -m venv .venv
  .venv/bin/pip install --upgrade pip >/dev/null
  .venv/bin/pip install -r requirements.txt
fi
exec .venv/bin/python run.py --phone --open "$@"
