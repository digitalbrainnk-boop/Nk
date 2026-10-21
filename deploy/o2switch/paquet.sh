#!/bin/bash
# Assemble le paquet prêt à installer chez o2switch (code + dépendances).
# Usage : bash deploy/o2switch/paquet.sh /chemin/agent-o2switch.tar.gz   (depuis la racine du projet)
set -euo pipefail
SORTIE="$1"
TMP=$(mktemp -d)
cp -r src public scripts package.json package-lock.json "$TMP/"
(cd "$TMP" && npm ci --omit=dev --no-audit --no-fund)
mkdir -p "$TMP/o2switch"
cp deploy/o2switch/app.js deploy/o2switch/package.json deploy/o2switch/nk.sh deploy/o2switch/env.example "$TMP/o2switch/"
echo "$(date -u +%Y-%m-%d) $(git rev-parse --short HEAD 2>/dev/null || echo local)" > "$TMP/VERSION"
tar -czf "$SORTIE" -C "$TMP" .
rm -rf "$TMP"
echo "Paquet : $SORTIE ($(du -h "$SORTIE" | cut -f1))"
