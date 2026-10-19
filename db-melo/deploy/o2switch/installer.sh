#!/bin/bash
# DB.Mélo chez o2switch : installe ou met à jour l'application. À coller dans le Terminal de cPanel :
#   curl -fsSL https://raw.githubusercontent.com/digitalbrainnk-boop/Nk/claude/db-melo-saas-app-14k2yw/db-melo/deploy/o2switch/installer.sh | bash
# Le paquet est compilé par GitHub (.github/workflows/dbmelo-o2switch.yml) : rien à compiler sur le serveur.
set -euo pipefail

APP="$HOME/dbmelo-app"          # racine de l'application Node.js déclarée dans cPanel
DONNEES="$HOME/dbmelo-donnees"  # chansons, paiements, fichiers : conservés d'une version à l'autre
PAQUET="${DBMELO_PAQUET:-https://github.com/digitalbrainnk-boop/Nk/releases/download/dbmelo-o2switch/dbmelo-o2switch.tar.gz}"
SCRIPT="https://raw.githubusercontent.com/digitalbrainnk-boop/Nk/claude/db-melo-saas-app-14k2yw/db-melo/deploy/o2switch/installer.sh"

echo "=== DB.Mélo : installation sur o2switch ==="
mkdir -p "$APP/versions" "$APP/tmp" "$APP/outils" "$DONNEES"

VERSION="$APP/versions/$(date +%Y%m%d-%H%M%S)"
mkdir -p "$VERSION"
echo "Téléchargement de la dernière version (≈ 25 Mo)..."
if ! curl -fSL --retry 3 --progress-bar "$PAQUET" | tar -xz -C "$VERSION"; then
  rm -rf "$VERSION"
  echo "❌ Téléchargement impossible. Réessaie dans quelques minutes (le paquet est peut-être en cours de préparation)."
  exit 1
fi
echo "Version : $(cat "$VERSION/VERSION")"

# Fichier de démarrage (Passenger) et menu des clés.
cp "$VERSION/o2switch/app.js" "$APP/app.js"
cp "$VERSION/o2switch/cles-termux.sh" "$APP/outils/cles.sh"

# Configuration : créée une seule fois, jamais écrasée par les mises à jour.
if [ ! -f "$APP/.env" ]; then
  cp "$VERSION/o2switch/.env.example" "$APP/.env"
  chmod 600 "$APP/.env"
  echo
  echo "Ton nom de domaine, sans https:// (ex. dbmelo.com) :"
  read -r DOMAINE < /dev/tty || DOMAINE=""
  DOMAINE=$(printf '%s' "$DOMAINE" | tr -d '[:space:]' | sed -E 's#^https?://##; s#/+$##')
  sed -i \
    -e "s|^DATA_DIR=.*|DATA_DIR=$DONNEES|" \
    -e "s|^PUBLIC_BASE_URL=.*|PUBLIC_BASE_URL=${DOMAINE:+https://$DOMAINE}|" \
    -e "s|^ALLOW_DEMO_PAYMENTS=.*|ALLOW_DEMO_PAYMENTS=false|" \
    -e "s|^HOSTING_INFO=.*|HOSTING_INFO=o2switch, Chemin des Pardiaux, 63000 Clermont-Ferrand, France|" \
    "$APP/.env"
fi
chmod 600 "$APP/.env"

# Redirige http:// vers https:// dans le .htaccess du dossier du site, devant la configuration Passenger.
# Annulé aussitôt si le site en https ne répond plus normalement (boucle de redirection).
SITE=$(sed -n 's/^PUBLIC_BASE_URL=//p' "$APP/.env" | tail -n 1 | tr -d "\"' \r")
case "$SITE" in
  https://?*)
    DOMAINE=${SITE#https://}; DOMAINE=${DOMAINE%%/*}
    RACINE=$(uapi DomainInfo single_domain_data domain="$DOMAINE" 2>/dev/null | sed -n 's/^ *documentroot: *//p' | head -n 1 || true)
    HTACCESS=""
    [ -n "$RACINE" ] && [ -d "$RACINE" ] && HTACCESS="$RACINE/.htaccess"
    [ -n "$HTACCESS" ] || HTACCESS=$(grep -lsE "PassengerAppRoot.*dbmelo-app" "$HOME"/public_html/.htaccess "$HOME"/*/.htaccess 2>/dev/null | head -n 1 || true)
    code() { curl -s -o /dev/null -w '%{http_code}' --max-time 20 "$1" || true; }
    if [ -z "$HTACCESS" ]; then
      echo "ℹ️  Redirection https : dossier du site introuvable."
    elif grep -qs "# dbmelo-https" "$HTACCESS"; then
      :
    elif [ "$(code "https://$DOMAINE/")" != 200 ]; then
      echo "ℹ️  Redirection https reportée : https://$DOMAINE ne répond pas encore (certificat SSL ?)."
    else
      touch "$HTACCESS"
      cp "$HTACCESS" "$HTACCESS.avant-https"
      {
        printf '%s\n' "# dbmelo-https : toujours en https" "RewriteEngine On" "RewriteCond %{HTTPS} off" \
          "RewriteCond %{REQUEST_URI} !^/\.well-known/" "RewriteRule ^ https://%{HTTP_HOST}%{REQUEST_URI} [L,R=301]" ""
        cat "$HTACCESS.avant-https"
      } > "$HTACCESS"
      if [ "$(code "https://$DOMAINE/")" = 200 ]; then
        echo "Redirection vers https activée."
      else
        mv "$HTACCESS.avant-https" "$HTACCESS"
        echo "⚠️  Redirection https annulée : le site ne répondait plus normalement."
      fi
    fi
    ;;
  *) echo "ℹ️  Redirection https : renseigne d'abord l'adresse du site (dbmelo-cles, choix s)." ;;
esac

# Bascule sur la nouvelle version, puis redémarrage.
ln -sfn "$VERSION" "$APP/actuelle"
touch "$APP/tmp/restart.txt"

# Garde la version précédente pour un retour arrière (« dbmelo-retour »).
ls -1dt "$APP"/versions/*/ | tail -n +3 | xargs -r rm -rf

cat > "$APP/outils/retour.sh" <<'EOS'
#!/bin/bash
# Revient à la version précédente de DB.Mélo (si la dernière mise à jour pose problème).
APP="$HOME/dbmelo-app"
ACTUELLE=$(readlink -f "$APP/actuelle")
PRECEDENTE=$(ls -1dt "$APP"/versions/*/ | sed 's#/$##' | grep -vx "$ACTUELLE" | head -n 1)
if [ -z "$PRECEDENTE" ]; then echo "Aucune version précédente."; exit 1; fi
ln -sfn "$PRECEDENTE" "$APP/actuelle"
touch "$APP/tmp/restart.txt"
echo "Retour à la version $(cat "$PRECEDENTE/VERSION")."
EOS
chmod +x "$APP/outils/retour.sh"

# Commandes du Terminal (une seule fois). dbmelo-maj ajoute un numéro à l'adresse du script pour
# passer le cache de GitHub (5 min) : la mise à jour prend toujours la dernière version.
MAJ="alias dbmelo-maj='curl -fsSL \"$SCRIPT?\$(date +%s)\" | bash'"
if grep -q "^alias dbmelo-maj=" "$HOME/.bashrc" 2>/dev/null; then
  MAJ="$MAJ" awk 'index($0, "alias dbmelo-maj=") == 1 { print ENVIRON["MAJ"]; next } { print }' "$HOME/.bashrc" > "$HOME/.bashrc.dbmelo" \
    && cat "$HOME/.bashrc.dbmelo" > "$HOME/.bashrc" && rm -f "$HOME/.bashrc.dbmelo"
fi
if ! grep -q "# dbmelo-o2switch" "$HOME/.bashrc" 2>/dev/null; then
  cat >> "$HOME/.bashrc" <<EOS

# dbmelo-o2switch : commandes DB.Mélo
alias dbmelo-cles='DBMELO_ENV="$APP/.env" DBMELO_REDEMARRER="$APP/tmp/restart.txt" bash "$APP/outils/cles.sh"'
$MAJ
alias dbmelo-journal='tail -n 80 "$APP/journal.log"'
alias dbmelo-relancer='touch "$APP/tmp/restart.txt" && echo "DB.Mélo redémarre."'
alias dbmelo-retour='bash "$APP/outils/retour.sh"'
EOS
fi

echo
echo "=== DB.Mélo est installé ! ==="
echo "Commandes (ouvre un nouveau Terminal pour les avoir) :"
echo "  dbmelo-cles      : clés API, ton entreprise, test du site"
echo "  dbmelo-maj       : installer la dernière version"
echo "  dbmelo-journal   : voir ce que fait le serveur"
echo "  dbmelo-relancer  : redémarrer DB.Mélo"
echo "  dbmelo-retour    : revenir à la version précédente"
echo
echo "Étape suivante : ouvre un nouveau Terminal et tape  dbmelo-cles"
