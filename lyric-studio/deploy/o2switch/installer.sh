#!/bin/bash
# Africa Lyrics chez o2switch : installe ou met à jour. À coller dans le Terminal de cPanel :
#   curl -fsSL https://raw.githubusercontent.com/digitalbrainnk-boop/Nk/ccr-78cf5167-8sfpbb/lyric-studio/deploy/o2switch/installer.sh | bash
# Le paquet est préparé par GitHub (.github/workflows/studio-o2switch.yml) : rien à compiler sur le serveur.
set -euo pipefail

APP="$HOME/lyric-studio"                 # racine de l'application Node.js déclarée dans cPanel
DONNEES="$HOME/lyric-studio-donnees"     # comptes, projets, vidéos : conservés d'une version à l'autre
OUTILS="$HOME/lyric-studio-outils"       # commandes « studio » et ffmpeg
PAQUET="${LS_PAQUET:-https://github.com/digitalbrainnk-boop/Nk/releases/download/studio-o2switch/studio-o2switch.tar.gz}"

echo "=== Africa Lyrics : installation sur o2switch ==="
mkdir -p "$APP/versions" "$APP/tmp" "$DONNEES" "$OUTILS"

VERSION="$APP/versions/$(date +%Y%m%d-%H%M%S)"
mkdir -p "$VERSION"
echo "Téléchargement de la dernière version…"
if ! curl -fSL --retry 3 --progress-bar "$PAQUET" | tar -xz -C "$VERSION"; then
  rm -rf "$VERSION"
  echo "❌ Téléchargement impossible. Réessaie dans quelques minutes (le paquet est peut-être en cours de préparation)."
  exit 1
fi
echo "Version : $(cat "$VERSION/VERSION")"

# Fichier de démarrage (Passenger) et commandes « studio ».
cp "$VERSION/o2switch/app.js" "$VERSION/o2switch/package.json" "$APP/"
cp "$VERSION/o2switch/studio.sh" "$OUTILS/studio.sh"

# Réglage d'une ligne du .env (remplacée si elle existe, ajoutée sinon).
regle() {
  if grep -q "^$1=" "$APP/.env"; then sed -i "s|^$1=.*|$1=$2|" "$APP/.env"; else echo "$1=$2" >> "$APP/.env"; fi
}

# Configuration : créée une seule fois, jamais écrasée par les mises à jour.
NOUVEAU=0
if [ ! -f "$APP/.env" ]; then
  NOUVEAU=1
  cp "$VERSION/o2switch/env.example" "$APP/.env"
  regle DATA_DIR "$DONNEES"
  echo
  echo "Ton adresse e-mail (elle seule deviendra administrateur en s'inscrivant sur le site) :"
  { read -r EMAIL < /dev/tty; } 2>/dev/null || EMAIL=""
  EMAIL=$(printf '%s' "$EMAIL" | tr -d '[:space:]')
  [ -n "$EMAIL" ] && regle ADMIN_EMAIL "$EMAIL"
fi
chmod 600 "$APP/.env"

# ffmpeg (facultatif, une seule fois) : lit les vidéos MKV/MOV et termine les exports quand le
# navigateur du client ne sait pas encoder le son. Version « statique » qui marche sans installation.
if [ ! -x "$OUTILS/ffmpeg/ffmpeg" ]; then
  echo "Installation de ffmpeg (facultatif, ~40 Mo)…"
  TMPF=$(mktemp -d)
  if curl -fsSL --retry 2 https://johnvansickle.com/ffmpeg/releases/ffmpeg-release-amd64-static.tar.xz | tar -xJ -C "$TMPF" 2>/dev/null; then
    mkdir -p "$OUTILS/ffmpeg"
    mv "$TMPF"/ffmpeg-*-static/ffmpeg "$TMPF"/ffmpeg-*-static/ffprobe "$OUTILS/ffmpeg/" 2>/dev/null || true
  fi
  rm -rf "$TMPF"
fi
if [ -x "$OUTILS/ffmpeg/ffmpeg" ] && "$OUTILS/ffmpeg/ffmpeg" -version >/dev/null 2>&1; then
  regle FFMPEG_PATH "$OUTILS/ffmpeg/ffmpeg"
  regle FFPROBE_PATH "$OUTILS/ffmpeg/ffprobe"
  echo "🎬 ffmpeg prêt."
else
  echo "⚠️  ffmpeg n'a pas pu être installé : le studio marche quand même (les clients sous Chrome Android, Windows ou Mac exportent sans lui)."
fi

# Adresse du studio : sert à le garder réveillé (ping toutes les 10 minutes, réponses plus rapides).
if [ ! -f "$APP/adresse" ]; then
  echo
  echo "Adresse du studio, sans https:// (ex. studio.tondomaine.com) :"
  { read -r ADRESSE < /dev/tty; } 2>/dev/null || ADRESSE=""
  ADRESSE=$(printf '%s' "$ADRESSE" | tr -d '[:space:]' | sed -E 's#^https?://##; s#/+$##')
  [ -n "$ADRESSE" ] && echo "$ADRESSE" > "$APP/adresse"
fi
ADRESSE=""
if [ -f "$APP/adresse" ]; then
  ADRESSE=$(cat "$APP/adresse")
  LIGNE="*/10 * * * * curl -fsS -m 30 https://$ADRESSE/health >/dev/null 2>&1 # lyric-studio"
  ( crontab -l 2>/dev/null | grep -v "# lyric-studio\$" ; echo "$LIGNE" ) | crontab - \
    && echo "⏰ Réveil automatique toutes les 10 minutes : https://$ADRESSE/health" \
    || echo "⚠️  Ajoute toi-même une tâche cron (cPanel → Tâches Cron, toutes les 10 minutes) : curl -fsS https://$ADRESSE/health"
fi

# Bascule sur la nouvelle version, puis redémarrage.
ln -sfn "$VERSION" "$APP/actuelle"
touch "$APP/tmp/restart.txt"
# Garde la version précédente pour un retour arrière (« studio retour »).
ls -1dt "$APP"/versions/*/ | tail -n +3 | xargs -r rm -rf

# Commande « studio » dans le Terminal (une seule fois).
if ! grep -q "# lyric-studio-outils" "$HOME/.bashrc" 2>/dev/null; then
  printf '\n# lyric-studio-outils : commandes du studio\nalias studio="bash $HOME/lyric-studio-outils/studio.sh"\n' >> "$HOME/.bashrc"
fi

echo
echo "=== Africa Lyrics installé ! ==="
if [ "$NOUVEAU" = 1 ]; then
  echo
  echo "Dernière étape dans cPanel → « Setup Node.js App » → « Create Application » :"
  echo "  • Node.js version          : 22 (la plus récente proposée, 22.13 minimum)"
  echo "  • Application mode         : Production"
  echo "  • Application root         : lyric-studio"
  echo "  • Application URL          : ${ADRESSE:-ton domaine ou sous-domaine}"
  echo "  • Application startup file : app.js"
  echo "Puis « Create » (pas besoin de « Run NPM Install »), ouvre https://${ADRESSE:-ton-adresse}"
  echo "et inscris-toi avec $(grep '^ADMIN_EMAIL=' "$APP/.env" | cut -d= -f2-) : tu seras administrateur."
fi
if ! grep -q '^ADMIN_EMAIL=.\+' "$APP/.env"; then
  echo
  echo "⚠️  Aucune adresse d'administrateur : écris ADMIN_EMAIL=ton@email dans ~/lyric-studio/.env puis « studio relancer »."
  echo "    Sinon, le premier compte créé sur le site devient administrateur."
fi
echo
echo "Commandes (ouvre un nouveau Terminal pour les avoir) :"
echo "  studio maj         : installer la dernière version"
echo "  studio journal     : voir ce que fait le studio"
echo "  studio relancer    : redémarrer le studio"
echo "  studio retour      : revenir à la version précédente"
echo "  studio sauvegarde  : sauvegarder comptes, projets et vidéos"
