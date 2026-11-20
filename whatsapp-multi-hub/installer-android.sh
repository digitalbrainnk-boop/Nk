#!/data/data/com.termux/files/usr/bin/bash
# Installe et lance Multi-Lignes sur Android (application Termux, depuis F-Droid).
# Dans Termux, colle cette ligne puis Entrée :
#   curl -fsSL https://raw.githubusercontent.com/digitalbrainnk-boop/Nk/ccr-2ad928f4-gleusx/whatsapp-multi-hub/installer-android.sh | bash
set -e
BRANCHE="${BRANCHE:-ccr-2ad928f4-gleusx}"
DEPOT="$HOME/multi-lignes"
APP="$DEPOT/whatsapp-multi-hub"

echo "=== Installation de Multi-Lignes (3 à 10 minutes) ==="
# Serveur officiel de Termux en secours (les miroirs choisis au hasard sont parfois saturés).
OFFICIEL="deb https://packages.termux.dev/apt/termux-main stable main"
install_paquets() {
  apt-get update -y && apt-get install -y -o Dpkg::Options::="--force-confnew" "$@"
}
if ! install_paquets nodejs-lts git; then
  echo "Passage au serveur officiel Termux…"
  rm -f "$PREFIX/etc/termux/chosen_mirrors"
  echo "$OFFICIEL" > "$PREFIX/etc/apt/sources.list"
  install_paquets nodejs-lts git || install_paquets nodejs git
fi

if [ -d "$DEPOT/.git" ]; then
  echo "Mise à jour de l'application…"
  # Les lignes reliées (data/) et le réglage .env ne sont pas touchés.
  git -C "$DEPOT" fetch --depth 1 origin "$BRANCHE"
  git -C "$DEPOT" reset --hard FETCH_HEAD
else
  git clone --depth 1 -b "$BRANCHE" https://github.com/digitalbrainnk-boop/Nk.git "$DEPOT"
fi

cd "$APP"
npm install --no-audit --no-fund --omit=dev
[ -f .env ] || cp .env.example .env

# Raccourci : il suffira ensuite de taper « lignes » dans Termux.
cat > "$PREFIX/bin/lignes" <<'EOS'
#!/data/data/com.termux/files/usr/bin/bash
cd "$HOME/multi-lignes/whatsapp-multi-hub" || exit 1
termux-wake-lock 2>/dev/null || true
echo "Multi-Lignes démarre : Chrome va s'ouvrir. Laisse Termux ouvert (Ctrl + C pour arrêter)."
OPEN_BROWSER=1 exec node server.js
EOS
chmod +x "$PREFIX/bin/lignes"

echo
echo "=== Installé ! ==="
echo "Les prochaines fois : ouvre Termux et tape  lignes"
echo "Dans Chrome : menu ⋮ → « Installer l'application » (ou « Ajouter à l'écran d'accueil »)."
sleep 2
exec lignes
