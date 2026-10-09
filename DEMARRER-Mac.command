#!/bin/bash
# Double-clique sur ce fichier (Mac) pour installer et lancer l'agent.
cd "$(dirname "$0")"
if ! command -v node >/dev/null 2>&1; then
  echo "Node.js n'est pas installé. Installe la version LTS puis relance ce fichier."
  open https://nodejs.org/fr/download
  read -p "Appuie sur Entrée pour fermer."
  exit 1
fi
[ -d node_modules ] || { echo "Première installation, patiente 1 à 2 minutes..."; npm install || { read -p "Erreur. Appuie sur Entrée."; exit 1; }; }
[ -f .env ] || cp .env.example .env
if ! grep -qE '^ANTHROPIC_API_KEY=.+' .env; then
  echo "Colle ta clé Claude (sk-ant-...), créée sur https://console.anthropic.com, puis Entrée :"
  read -r KEY
  sed -i '' "s|^ANTHROPIC_API_KEY=.*|ANTHROPIC_API_KEY=$KEY|" .env
fi
echo "Démarrage... ne ferme pas cette fenêtre. Le mot de passe s'affiche ci-dessous."
(sleep 5; open http://localhost:3000) &
npm start
