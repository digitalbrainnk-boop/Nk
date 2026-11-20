#!/bin/bash
# Double-clique sur ce fichier (Mac) pour installer et lancer Multi-Lignes.
cd "$(dirname "$0")" || exit 1
if ! command -v node >/dev/null 2>&1; then
  echo "Node.js n'est pas installé. Installe la version LTS, puis double-clique de nouveau sur ce fichier."
  open https://nodejs.org/fr/download
  read -r -p "Appuie sur Entrée pour fermer."
  exit 1
fi
if [ ! -d node_modules/baileys ]; then
  echo "Première installation, patiente 1 à 3 minutes…"
  npm install --no-audit --no-fund || { read -r -p "L'installation a échoué. Appuie sur Entrée."; exit 1; }
fi
[ -f .env ] || cp .env.example .env
echo "Démarrage… ton navigateur va s'ouvrir. Ne ferme pas cette fenêtre (Ctrl + C pour arrêter)."
OPEN_BROWSER=1 node server.js
read -r -p "Appuie sur Entrée pour fermer."
