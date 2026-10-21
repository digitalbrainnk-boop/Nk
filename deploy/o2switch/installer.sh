#!/bin/bash
# Agent IA chez o2switch : installe ou met à jour un agent. À coller dans le Terminal de cPanel :
#   curl -fsSL https://raw.githubusercontent.com/digitalbrainnk-boop/Nk/claude/ai-agent-multichannel-0snabq/deploy/o2switch/installer.sh | bash
# Pour un deuxième agent (ex. pour ton cousin) :  … | bash -s cousin
# Le paquet est préparé par GitHub (.github/workflows/agent-o2switch.yml) : rien à compiler sur le serveur.
set -euo pipefail

NOM=$(printf '%s' "${1:-agent}" | tr -cd 'a-zA-Z0-9_-')
APP="$HOME/nk-$NOM"               # racine de l'application Node.js déclarée dans cPanel
DONNEES="$HOME/nk-$NOM-donnees"   # clients, conversations, connexion WhatsApp : conservés d'une version à l'autre
PAQUET="${NK_PAQUET:-https://github.com/digitalbrainnk-boop/Nk/releases/download/agent-o2switch/agent-o2switch.tar.gz}"

echo "=== Agent « $NOM » : installation sur o2switch ==="
mkdir -p "$APP/versions" "$APP/tmp" "$DONNEES" "$HOME/nk-outils"

VERSION="$APP/versions/$(date +%Y%m%d-%H%M%S)"
mkdir -p "$VERSION"
echo "Téléchargement de la dernière version…"
if ! curl -fSL --retry 3 --progress-bar "$PAQUET" | tar -xz -C "$VERSION"; then
  rm -rf "$VERSION"
  echo "❌ Téléchargement impossible. Réessaie dans quelques minutes (le paquet est peut-être en cours de préparation)."
  exit 1
fi
echo "Version : $(cat "$VERSION/VERSION")"

# Fichier de démarrage (Passenger) et commandes « nk ».
cp "$VERSION/o2switch/app.js" "$VERSION/o2switch/package.json" "$APP/"
cp "$VERSION/o2switch/nk.sh" "$HOME/nk-outils/nk.sh"

# Configuration : créée une seule fois, jamais écrasée par les mises à jour.
NOUVEAU=0
if [ ! -f "$APP/.env" ]; then
  NOUVEAU=1
  cp "$VERSION/o2switch/env.example" "$APP/.env"
  MDP=$(tr -dc '0-9' < /dev/urandom | head -c 8 || true)
  sed -i -e "s|^ADMIN_PASSWORD=.*|ADMIN_PASSWORD=$MDP|" -e "s|^DATA_DIR=.*|DATA_DIR=$DONNEES|" "$APP/.env"
fi
chmod 600 "$APP/.env"

# Adresse de l'agent (sous-domaine) : sert à le garder éveillé (ping toutes les 5 minutes).
if [ ! -f "$APP/adresse" ]; then
  echo
  echo "Adresse de cet agent, sans https:// (ex. agent.tondomaine.com) :"
  read -r ADRESSE < /dev/tty || ADRESSE=""
  ADRESSE=$(printf '%s' "$ADRESSE" | tr -d '[:space:]' | sed -E 's#^https?://##; s#/+$##')
  [ -n "$ADRESSE" ] && echo "$ADRESSE" > "$APP/adresse"
fi
if [ -f "$APP/adresse" ]; then
  ADRESSE=$(cat "$APP/adresse")
  LIGNE="*/5 * * * * curl -fsS -m 30 https://$ADRESSE/health >/dev/null 2>&1 # nk-$NOM"
  ( crontab -l 2>/dev/null | grep -v "# nk-$NOM\$" ; echo "$LIGNE" ) | crontab - \
    && echo "⏰ Réveil automatique toutes les 5 minutes : https://$ADRESSE/health" \
    || echo "⚠️  Ajoute toi-même une tâche cron (cPanel → Tâches Cron, toutes les 5 minutes) : curl -fsS https://$ADRESSE/health"
fi

# Bascule sur la nouvelle version, puis redémarrage.
ln -sfn "$VERSION" "$APP/actuelle"
touch "$APP/tmp/restart.txt"
# Garde la version précédente pour un retour arrière (« nk retour »).
ls -1dt "$APP"/versions/*/ | tail -n +3 | xargs -r rm -rf

# Commande « nk » dans le Terminal (une seule fois).
if ! grep -q "# nk-outils" "$HOME/.bashrc" 2>/dev/null; then
  printf '\n# nk-outils : commandes de l agent\nalias nk="bash $HOME/nk-outils/nk.sh"\n' >> "$HOME/.bashrc"
fi

echo
echo "=== Agent « $NOM » installé ! ==="
if [ "$NOUVEAU" = 1 ]; then
  echo
  echo "Dernière étape dans cPanel → « Setup Node.js App » → « Create Application » :"
  echo "  • Node.js version        : 22 (la plus récente proposée, 22.13 minimum)"
  echo "  • Application mode       : Production"
  echo "  • Application root       : nk-$NOM"
  echo "  • Application URL        : ${ADRESSE:-ton sous-domaine}"
  echo "  • Application startup file : app.js"
  echo "Puis « Create » (pas besoin de « Run NPM Install »), et ouvre https://${ADRESSE:-ton-sous-domaine}"
  echo
  echo "🔑 Mot de passe du tableau de bord : $(grep '^ADMIN_PASSWORD=' "$APP/.env" | cut -d= -f2-)"
fi
echo
echo "Commandes (ouvre un nouveau Terminal pour les avoir) :"
echo "  nk maj $NOM        : installer la dernière version"
echo "  nk journal $NOM    : voir ce que fait l'agent"
echo "  nk relancer $NOM   : redémarrer l'agent"
echo "  nk retour $NOM     : revenir à la version précédente"
echo "  nk motdepasse $NOM : revoir le mot de passe"
