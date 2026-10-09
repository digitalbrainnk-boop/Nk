#!/data/data/com.termux/files/usr/bin/bash
# Installe et lance l'agent sur Android (application Termux).
# Dans Termux, colle :
#   curl -fsSL https://raw.githubusercontent.com/digitalbrainnk-boop/Nk/claude/ai-agent-multichannel-0snabq/installer-android.sh | bash
set -e
BRANCHE="claude/ai-agent-multichannel-0snabq"
DOSSIER="$HOME/Nk"

echo "=== Installation de l'agent IA (3 à 10 minutes) ==="
pkg update -y -o Dpkg::Options::="--force-confnew"
pkg install -y nodejs-lts git procps || pkg install -y nodejs git procps

if [ -d "$DOSSIER/.git" ]; then
  echo "Mise à jour du projet..."
  git -C "$DOSSIER" pull --ff-only
else
  git clone -b "$BRANCHE" https://github.com/digitalbrainnk-boop/Nk.git "$DOSSIER"
fi
cd "$DOSSIER"
npm install --no-audit --no-fund

[ -f .env ] || cp .env.example .env
if ! grep -qE '^ANTHROPIC_API_KEY=.+' .env; then
  echo
  echo "Colle ta clé Claude (sk-ant-..., créée sur console.anthropic.com) puis Entrée :"
  read -r KEY < /dev/tty
  sed -i "s|^ANTHROPIC_API_KEY=.*|ANTHROPIC_API_KEY=$KEY|" .env
fi
if ! grep -qE '^ADMIN_PASSWORD=.+' .env; then
  echo
  echo "Choisis un mot de passe pour ton tableau de bord (lettres et chiffres) puis Entrée :"
  read -r MDP < /dev/tty
  sed -i "s|^ADMIN_PASSWORD=.*|ADMIN_PASSWORD=$MDP|" .env
fi

# Raccourci : il suffira ensuite de taper "agent" dans Termux.
cat > "$PREFIX/bin/agent" <<'EOS'
#!/data/data/com.termux/files/usr/bin/bash
cd "$HOME/Nk"
termux-wake-lock 2>/dev/null || true
echo "Mot de passe : $(grep -E '^ADMIN_PASSWORD=' .env | cut -d= -f2-)"
echo "Ouvre Chrome sur http://localhost:3000  (laisse Termux ouvert)"
(sleep 6; termux-open-url http://localhost:3000 2>/dev/null) &
npm start
EOS
chmod +x "$PREFIX/bin/agent"

# Lancement automatique à chaque ouverture de Termux (une seule fois à la fois).
if ! grep -q "# agent-auto" "$HOME/.bashrc" 2>/dev/null; then
  cat >> "$HOME/.bashrc" <<'EOS'
# agent-auto : démarre l'agent IA à l'ouverture de Termux
if ! pgrep -f "src/server.js" >/dev/null 2>&1; then agent; fi
EOS
fi

echo
echo "=== Installé ! L'agent démarre maintenant. ==="
echo "Les prochaines fois, il suffit d'ouvrir Termux : il se lance tout seul."
sleep 2
exec agent
