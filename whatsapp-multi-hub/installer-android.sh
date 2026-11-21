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
# ffmpeg : pour envoyer les vocaux enregistrés dans l'app comme de vraies notes vocales
install_paquets ffmpeg || echo "ffmpeg non installé : les vocaux partiront comme fichiers audio."

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

# Commande « lignes » : démarre l'application, ou l'ouvre si elle tourne déjà.
#   lignes        démarrer / ouvrir
#   lignes stop   arrêter
#   lignes log    voir le journal du démarrage automatique
cat > "$PREFIX/bin/lignes" <<'EOS'
#!/data/data/com.termux/files/usr/bin/bash
APP="$HOME/multi-lignes/whatsapp-multi-hub"
cd "$APP" || { echo "Multi-Lignes n'est pas installé."; exit 1; }
PORT=$(grep -E '^PORT=[0-9]+' .env 2>/dev/null | cut -d= -f2); PORT=${PORT:-3100}
lien() {
  TOKEN=$(grep -E '^API_TOKEN=.+' .env 2>/dev/null | cut -d= -f2-)
  [ -n "$TOKEN" ] || TOKEN=$(cat data/api-token.txt 2>/dev/null)
  echo "http://localhost:$PORT/#token=$TOKEN"
}
case "$1" in
  stop) pkill -f "$APP/server.js" && echo "Multi-Lignes arrêté (les lignes restent reliées)." || echo "Multi-Lignes n'était pas lancé."; exit 0 ;;
  log) tail -n 60 -f data/server.log; exit 0 ;;
esac
if curl -fsS "http://127.0.0.1:$PORT/api/health" >/dev/null 2>&1; then
  echo "Multi-Lignes tourne déjà : ouverture de l'application."
  termux-open-url "$(lien)" 2>/dev/null || echo "Ouvre : $(lien)"
  exit 0
fi
termux-wake-lock 2>/dev/null || true
echo "Multi-Lignes démarre : Chrome va s'ouvrir. Laisse Termux ouvert (Ctrl + C pour arrêter)."
OPEN_BROWSER=1 exec node "$APP/server.js"
EOS
chmod +x "$PREFIX/bin/lignes"

# Démarrage automatique quand le téléphone redémarre (application Termux:Boot).
mkdir -p "$HOME/.termux/boot" "$APP/data"
cat > "$HOME/.termux/boot/multi-lignes" <<'EOS'
#!/data/data/com.termux/files/usr/bin/sh
termux-wake-lock
APP="$HOME/multi-lignes/whatsapp-multi-hub"
cd "$APP" || exit 0
# Journal limité à ~5 Mo
[ -f data/server.log ] && [ "$(wc -c < data/server.log)" -gt 5000000 ] && mv data/server.log data/server.log.old
nohup node "$APP/server.js" >> data/server.log 2>&1 &
EOS
chmod +x "$HOME/.termux/boot/multi-lignes"

echo
echo "=== Installé ! ==="
echo "• Les prochaines fois : ouvre Termux et tape  lignes   (lignes stop = arrêter)"
echo "• Dans Chrome : menu ⋮ → « Installer l'application »."
echo "• Démarrage automatique au rallumage du téléphone : installe « Termux:Boot »"
echo "  depuis F-Droid et ouvre-le une fois. C'est tout."
echo "• Pense à retirer Termux de l'optimisation de batterie (Paramètres Android → Applis → Termux → Batterie → Sans restriction)."
sleep 3
exec lignes
