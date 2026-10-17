#!/data/data/com.termux/files/usr/bin/bash
# Installe (ou met à jour) et lance DB.Mélo sur Android, dans l'application Termux.
# Dans Termux, colle :
#   curl -fsSL https://raw.githubusercontent.com/digitalbrainnk-boop/Nk/claude/db-melo-saas-app-14k2yw/db-melo/installer-termux.sh | bash
set -e
BRANCHE="claude/db-melo-saas-app-14k2yw"
DEPOT="$HOME/DBMelo"
APP="$DEPOT/db-melo"
DONNEES="$HOME/dbmelo-donnees"
PORT=3001 # l'agent IA utilise déjà le port 3000

echo "=== DB.Mélo : installation (10 à 20 minutes la première fois) ==="

case "$(uname -m)" in
  aarch64 | arm64) ;;
  *)
    echo "❌ Ce téléphone n'est pas en 64 bits (ARM64) : DB.Mélo ne peut pas y être installé."
    exit 1
    ;;
esac

paquets() { pkg install -y nodejs-lts git procps || pkg install -y nodejs git procps; }
pkg update -y -o Dpkg::Options::="--force-confnew" || true
if ! paquets; then
  # Miroir Termux pas à jour (erreur 404) : on passe au serveur principal de Termux.
  echo "⚠️  Le serveur Termux choisi est défaillant : passage au serveur principal de Termux..."
  echo "deb https://packages.termux.dev/apt/termux-main stable main" > "$PREFIX/etc/apt/sources.list"
  apt-get update
  apt-get -y -o Dpkg::Options::="--force-confnew" full-upgrade
  apt-get install -y nodejs-lts git procps || apt-get install -y nodejs git procps
fi

if ! node -e 'const [a,b]=process.versions.node.split(".").map(Number); process.exit(a>20||(a===20&&b>=9)?0:1)'; then
  echo "❌ Node.js $(node -v) est trop ancien (20.9 minimum). Lance : pkg upgrade nodejs-lts"
  exit 1
fi

if [ -d "$DEPOT/.git" ]; then
  echo "Mise à jour du projet..."
  git -C "$DEPOT" pull --ff-only
else
  git clone --depth 1 -b "$BRANCHE" https://github.com/digitalbrainnk-boop/Nk.git "$DEPOT"
fi
cd "$APP"

export NEXT_TELEMETRY_DISABLED=1
npm install --no-audit --no-fund
# Next.js n'a pas de compilateur natif pour Android : on installe sa version WebAssembly.
npm install --no-save --no-audit --no-fund "@next/swc-wasm-nodejs@$(node -p 'require("next/package.json").version')"

mkdir -p "$DONNEES"
if [ ! -f .env.local ]; then
  cp .env.example .env.local
  sed -i "s|^DATA_DIR=.*|DATA_DIR=$DONNEES|" .env.local
  sed -i "s|^PUBLIC_BASE_URL=.*|PUBLIC_BASE_URL=|" .env.local

  # Reprend la clé Claude de l'agent IA s'il est installé sur ce téléphone.
  if [ -f "$HOME/Nk/.env" ]; then
    CLE_CLAUDE=$(grep -E '^ANTHROPIC_API_KEY=.+' "$HOME/Nk/.env" | cut -d= -f2- || true)
    if [ -n "$CLE_CLAUDE" ]; then
      sed -i "s|^ANTHROPIC_API_KEY=.*|ANTHROPIC_API_KEY=$CLE_CLAUDE|" .env.local
      echo "Clé Claude de l'agent reprise pour le parolier IA."
    fi
  fi

  echo
  echo "Colle ta clé Kie.ai (kie.ai → API Keys) pour composer de vraies chansons avec Suno,"
  echo "ou appuie simplement sur Entrée pour le mode démo :"
  read -r CLE_KIE < /dev/tty
  if [ -n "$CLE_KIE" ]; then sed -i "s|^KIE_API_KEY=.*|KIE_API_KEY=$CLE_KIE|" .env.local; fi

  echo
  echo "Activer le paiement simulé pour tes essais sur ce téléphone ? (o/n)"
  echo "(Les vrais paiements CinetPay / Flutterwave / Stripe se règlent plus tard dans $APP/.env.local)"
  read -r REPONSE < /dev/tty
  case "$REPONSE" in
    o | O | oui | Oui | y) sed -i "s|^ALLOW_DEMO_PAYMENTS=.*|ALLOW_DEMO_PAYMENTS=true|" .env.local ;;
  esac
fi

# Arrête l'ancienne version avant de recompiler (mise à jour).
if [ -f "$DONNEES/serveur.pid" ]; then
  kill "$(cat "$DONNEES/serveur.pid")" 2>/dev/null || true
  rm -f "$DONNEES/serveur.pid"
fi

echo
echo "Compilation de l'application (5 à 15 minutes sur un téléphone, ne ferme pas Termux)..."
# --webpack : Turbopack n'existe pas en version WebAssembly.
npx next build --webpack

# ───── Commandes : dbmelo, dbmelo-stop, dbmelo-journal, dbmelo-public, dbmelo-maj, dbmelo-cles ─────
# Le serveur et le tunnel sont suivis par leur numéro de processus (fichiers .pid) :
# une fois lancé, Next.js se renomme « next-server », on ne peut pas le retrouver par son nom.

cat > "$PREFIX/bin/dbmelo" <<EOS
#!/data/data/com.termux/files/usr/bin/bash
# Démarre DB.Mélo en arrière-plan et ouvre Chrome (option --silencieux : sans ouvrir Chrome).
cd "$APP" || exit 1
SERVEUR="$DONNEES/serveur.pid"
TUNNEL="$DONNEES/tunnel.pid"
actif() { [ -f "\$1" ] && kill -0 "\$(cat "\$1")" 2>/dev/null; }
termux-wake-lock 2>/dev/null || true
# Sans accès public ouvert, l'adresse publique enregistrée n'est plus valable.
actif "\$TUNNEL" || sed -i "s|^PUBLIC_BASE_URL=.*|PUBLIC_BASE_URL=|" .env.local
if actif "\$SERVEUR"; then
  [ "\$1" = "--silencieux" ] || echo "DB.Mélo tourne déjà."
else
  NEXT_TELEMETRY_DISABLED=1 nohup node_modules/.bin/next start -p $PORT > "$DONNEES/serveur.log" 2>&1 &
  echo \$! > "\$SERVEUR"
  [ "\$1" = "--silencieux" ] || { echo "Démarrage de DB.Mélo..."; sleep 6; }
fi
if [ "\$1" != "--silencieux" ]; then
  echo "DB.Mélo : http://localhost:$PORT  (laisse Termux ouvert)"
  termux-open-url http://localhost:$PORT 2>/dev/null || true
fi
EOS

cat > "$PREFIX/bin/dbmelo-stop" <<EOS
#!/data/data/com.termux/files/usr/bin/bash
# Arrête DB.Mélo (option --serveur : arrête seulement le serveur, garde l'accès public).
arreter() {
  [ -f "\$1" ] || return 1
  P=\$(cat "\$1"); rm -f "\$1"
  kill "\$P" 2>/dev/null || return 1
  for i in \$(seq 1 20); do kill -0 "\$P" 2>/dev/null || return 0; sleep 0.5; done
  kill -9 "\$P" 2>/dev/null; return 0
}
if arreter "$DONNEES/serveur.pid"; then echo "DB.Mélo arrêté."; else echo "DB.Mélo n'était pas lancé."; fi
if [ "\$1" != "--serveur" ]; then
  arreter "$DONNEES/tunnel.pid" && echo "Accès public fermé."
  sed -i "s|^PUBLIC_BASE_URL=.*|PUBLIC_BASE_URL=|" "$APP/.env.local"
  termux-wake-unlock 2>/dev/null || true
fi
exit 0
EOS

cat > "$PREFIX/bin/dbmelo-journal" <<EOS
#!/data/data/com.termux/files/usr/bin/bash
# Affiche ce que fait le serveur (Ctrl+C pour quitter).
tail -n 60 -f "$DONNEES/serveur.log"
EOS

cat > "$PREFIX/bin/dbmelo-public" <<EOS
#!/data/data/com.termux/files/usr/bin/bash
# Ouvre un accès public temporaire (https://….trycloudflare.com) pour montrer DB.Mélo à des clients.
# L'adresse change à chaque lancement : pour vendre durablement, utilise un hébergeur (o2switch).
ENV="$APP/.env.local"
JOURNAL="$DONNEES/tunnel.log"
if grep -q '^ALLOW_DEMO_PAYMENTS=true' "\$ENV"; then
  echo "⛔ Le paiement simulé est activé : n'importe qui obtiendrait des chansons gratuitement."
  echo "   Mets ALLOW_DEMO_PAYMENTS=false dans \$ENV (nano \$ENV), puis relance dbmelo-public."
  exit 1
fi
command -v cloudflared >/dev/null 2>&1 || pkg install -y cloudflared
if [ -f "$DONNEES/tunnel.pid" ]; then kill "\$(cat "$DONNEES/tunnel.pid")" 2>/dev/null || true; fi
nohup cloudflared tunnel --url http://localhost:$PORT > "\$JOURNAL" 2>&1 &
echo \$! > "$DONNEES/tunnel.pid"
echo "Ouverture de l'accès public..."
URL=""
for i in \$(seq 1 40); do
  URL=\$(grep -oE 'https://[a-z0-9-]+\.trycloudflare\.com' "\$JOURNAL" | head -n 1)
  [ -n "\$URL" ] && break
  sleep 1
done
if [ -z "\$URL" ]; then
  echo "❌ Accès public indisponible. Détails : \$JOURNAL"
  exit 1
fi
sed -i "s|^PUBLIC_BASE_URL=.*|PUBLIC_BASE_URL=\$URL|" "\$ENV"
# Redémarre le serveur pour qu'il prenne l'adresse publique.
dbmelo-stop --serveur >/dev/null
dbmelo --silencieux
echo
echo "✅ DB.Mélo est accessible partout : \$URL"
echo "   (tant que Termux reste ouvert ; dbmelo-stop pour fermer)"
EOS

cat > "$PREFIX/bin/dbmelo-maj" <<'EOS'
#!/data/data/com.termux/files/usr/bin/bash
# Met DB.Mélo à jour avec la dernière version, recompile et relance.
dbmelo-stop >/dev/null 2>&1 || true
curl -fsSL https://raw.githubusercontent.com/digitalbrainnk-boop/Nk/claude/db-melo-saas-app-14k2yw/db-melo/installer-termux.sh | bash
EOS

cat > "$PREFIX/bin/dbmelo-cles" <<EOS
#!/data/data/com.termux/files/usr/bin/bash
# Menu pour saisir et tester les clés API (Kie, Claude, paiements).
exec bash "$APP/scripts/cles-termux.sh" "\$@"
EOS

chmod +x "$PREFIX/bin/dbmelo" "$PREFIX/bin/dbmelo-stop" "$PREFIX/bin/dbmelo-journal" "$PREFIX/bin/dbmelo-public" "$PREFIX/bin/dbmelo-maj" "$PREFIX/bin/dbmelo-cles"

# Lancement automatique (en arrière-plan) à chaque ouverture de Termux. Placé en tête du fichier
# pour passer avant le lancement de l'agent IA, qui occupe la session.
if ! grep -q "# dbmelo-auto" "$HOME/.bashrc" 2>/dev/null; then
  touch "$HOME/.bashrc"
  {
    echo "# dbmelo-auto : démarre DB.Mélo en arrière-plan à l’ouverture de Termux"
    echo "command -v dbmelo >/dev/null 2>&1 && dbmelo --silencieux"
    cat "$HOME/.bashrc"
  } > "$HOME/.bashrc.dbmelo" && mv "$HOME/.bashrc.dbmelo" "$HOME/.bashrc"
fi

echo
echo "=== DB.Mélo est installé ! ==="
echo "  dbmelo          → lancer et ouvrir http://localhost:$PORT"
echo "  dbmelo-stop     → arrêter"
echo "  dbmelo-journal  → voir ce que fait le serveur"
echo "  dbmelo-public   → accès public temporaire (montrer à des clients)"
echo "  dbmelo-maj      → mettre à jour"
echo "  dbmelo-cles     → saisir et tester tes clés API (Kie, Claude, paiements)"
sleep 2
exec dbmelo
