#!/bin/bash
# Assemble le paquet o2switch (dbmelo-o2switch.tar.gz) après « NEXT_OUTPUT=standalone npx next build ».
# Utilisé par GitHub (.github/workflows/dbmelo-o2switch.yml) ; s'exécute aussi à la main pour tester.
set -euo pipefail
cd "$(dirname "$0")/../.."
SORTIE="${1:-$PWD/dbmelo-o2switch.tar.gz}"
P=.next/standalone
[ -f "$P/server.js" ] || { echo "Compile d'abord : NEXT_OUTPUT=standalone npx next build"; exit 1; }

rm -rf "$P/public" "$P/.next/static" "$P/o2switch" "$P/android" "$P"/.env*  # jamais de clés dans le paquet
cp -r public "$P/public"
cp -r .next/static "$P/.next/static"
# Application Android non signée (compilée par GitHub) : le serveur la signe avec sa propre clé.
if [ -f android-apk/dbmelo-non-signee.apk ]; then
  mkdir -p "$P/android"
  cp android-apk/dbmelo-non-signee.apk "$P/android/"
fi
mkdir -p "$P/o2switch"
cp deploy/o2switch/app.js scripts/cles-termux.sh .env.example "$P/o2switch/"
echo "$(git rev-parse --short HEAD 2>/dev/null || echo locale) du $(date -u +%d/%m/%Y)" > "$P/VERSION"
tar -czf "$SORTIE" -C "$P" .
echo "Paquet : $SORTIE ($(du -h "$SORTIE" | cut -f1))"
