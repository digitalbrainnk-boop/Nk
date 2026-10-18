#!/data/data/com.termux/files/usr/bin/bash
# DB.Mélo : saisie et test des clés API (commande « dbmelo-cles »), dans Termux ou chez o2switch.
# Les clés sont écrites dans .env.local (téléphone) ou dans le fichier DBMELO_ENV (serveur o2switch).
APP="$(cd "$(dirname "$0")/.." && pwd)"
ENV="${DBMELO_ENV:-$APP/.env.local}"
# Sur le serveur : fichier à toucher pour redémarrer DB.Mélo (Passenger).
SERVEUR="${DBMELO_REDEMARRER:-}"
DONNEES="$HOME/dbmelo-donnees"

# Installe le raccourci « dbmelo-cles » pour les prochaines fois.
if [ -n "$PREFIX" ] && [ -d "$PREFIX/bin" ] && [ ! -f "$PREFIX/bin/dbmelo-cles" ]; then
  printf '#!/data/data/com.termux/files/usr/bin/bash\nexec bash "%s/scripts/cles-termux.sh" "$@"\n' "$APP" > "$PREFIX/bin/dbmelo-cles"
  chmod +x "$PREFIX/bin/dbmelo-cles"
fi

if [ ! -f "$ENV" ]; then
  mkdir -p "$DONNEES"
  cp "$APP/.env.example" "$ENV"
  sed -i "s|^DATA_DIR=.*|DATA_DIR=$DONNEES|; s|^PUBLIC_BASE_URL=.*|PUBLIC_BASE_URL=|" "$ENV"
fi
chmod 600 "$ENV"

lire() { grep -E "^$1=" "$ENV" | head -n 1 | cut -d= -f2-; }

# Écrit KEY=valeur sans interpréter les caractères spéciaux de la clé.
ecrire() {
  if grep -qE "^$1=" "$ENV"; then
    K="$1" V="$2" awk 'index($0, ENVIRON["K"] "=") == 1 { print ENVIRON["K"] "=" ENVIRON["V"]; next } { print }' "$ENV" > "$ENV.tmp" && mv "$ENV.tmp" "$ENV"
  else
    printf '%s=%s\n' "$1" "$2" >> "$ENV"
  fi
  chmod 600 "$ENV"
}

masque() {
  local v="$1"
  if [ -z "$v" ]; then echo "—"; elif [ ${#v} -le 10 ]; then echo "••••"; else echo "${v:0:4}…${v: -4}"; fi
}

modele() { local m; m=$(lire KIE_SUNO_MODEL); echo "${m:-V6}"; }

etat() { [ -n "$(lire "$1")" ] && echo "✅ $(masque "$(lire "$1")")" || echo "❌ manquante"; }

# Demande une valeur ; Entrée seule = garder l'actuelle, « - » = effacer.
# Troisième argument « texte » : valeur lisible (nom, adresse…), affichée en clair et gardant ses espaces.
demander() {
  local cle="$1" texte="$2" mode="${3:-}" saisie actuelle
  actuelle="$(lire "$cle")"
  [ "$mode" = "texte" ] || actuelle="$(masque "$actuelle")"
  echo
  echo "$texte"
  echo "   Actuelle : ${actuelle:-—}   (Entrée = garder, - = effacer)"
  printf "   > "
  read -r saisie || saisie=""
  if [ "$mode" = "texte" ]; then
    # Sans les caractères que le fichier .env interprète ($, #, guillemets).
    saisie="$(printf '%s' "$saisie" | tr -d '"#$`\\' | sed 's/^[[:space:]]*//; s/[[:space:]]*$//')"
  else
    saisie="$(printf '%s' "$saisie" | tr -d '[:space:]')"
  fi
  if [ "$saisie" = "-" ]; then
    ecrire "$cle" ""
    echo "   Effacée."
  elif [ -n "$saisie" ]; then
    ecrire "$cle" "$saisie"
    echo "   Enregistrée."
  fi
}

# Extrait un champ d'une réponse JSON (node est déjà installé).
json() {
  if ! command -v node >/dev/null 2>&1; then
    python3 -c 'import json,sys
try:
    v=json.load(sys.stdin)
    for k in sys.argv[1].split("."): v=v.get(k) if isinstance(v,dict) else None
    print("" if v is None else json.dumps(v) if isinstance(v,(dict,list)) else str(v).lower() if isinstance(v,bool) else str(v))
except Exception: print("")' "$1"
    return
  fi
  node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{const v=process.argv[1].split(".").reduce((o,k)=>o?.[k],JSON.parse(s));console.log(v===undefined?"":typeof v==="object"?JSON.stringify(v):String(v))}catch{console.log("")}})' "$1"
}

HORS_LIGNE="pas de réponse : vérifie ta connexion internet, puis réessaie"

tester() {
  echo
  echo "=== Test des clés ==="
  local k r
  k=$(lire KIE_API_KEY)
  if [ -n "$k" ]; then
    r=$(curl -s -m 20 -H "Authorization: Bearer $k" https://api.kie.ai/api/v1/chat/credit)
    if [ -z "$r" ]; then echo "❌ Kie.ai : $HORS_LIGNE"
    elif [ "$(echo "$r" | json code)" = "200" ]; then echo "✅ Kie.ai : clé valide — crédit restant : $(echo "$r" | json data)"
    else echo "❌ Kie.ai : clé refusée ($(echo "$r" | json msg))"; fi
  else echo "⚪ Kie.ai : pas de clé (mode démo : musique d'essai synthétisée)"; fi

  k=$(lire ANTHROPIC_API_KEY)
  if [ -n "$k" ]; then
    r=$(curl -s -m 20 -o /dev/null -w "%{http_code}" https://api.anthropic.com/v1/models -H "x-api-key: $k" -H "anthropic-version: 2023-06-01")
    case "$r" in 200) echo "✅ Claude : clé valide" ;; 000) echo "❌ Claude : $HORS_LIGNE" ;; *) echo "❌ Claude : clé refusée (code $r)" ;; esac
  else echo "⚪ Claude : pas de clé (le parolier utilisera Kie / DeepSeek, sinon des modèles intégrés)"; fi

  k=$(lire CHARIOW_API_KEY)
  if [ -n "$k" ]; then
    r=$(curl -s -m 20 -H "Authorization: Bearer $k" -H "Accept: application/json" https://api.chariow.com/v1/store)
    if [ -z "$r" ]; then echo "❌ Chariow : $HORS_LIGNE"
    elif [ -n "$(echo "$r" | json data.name)" ]; then echo "✅ Chariow : clé valide — boutique « $(echo "$r" | json data.name) »"
    else echo "❌ Chariow : clé refusée ($(echo "$r" | json message))"; fi
    p=$(lire CHARIOW_PRODUCT_ID)
    if [ -z "$p" ]; then echo "   ❌ Produit Chariow manquant (3) : crée le produit « Chanson » de type Licence à 1 000 FCFA."
    else
      r=$(curl -s -m 20 -H "Authorization: Bearer $k" -H "Accept: application/json" "https://api.chariow.com/v1/products/$p")
      t=$(echo "$r" | json data.type)
      if [ -z "$t" ]; then echo "   ❌ Produit « $p » introuvable : vérifie son identifiant (prd_…) et qu'il est publié."
      else
        echo "   Produit : $(echo "$r" | json data.name) — $(echo "$r" | json data.pricing.current_price.formatted) — type $t"
        [ "$t" = "license" ] || echo "   ⚠️  Choisis le type « Licence » : sinon un client ne peut acheter qu'une seule chanson."
      fi
    fi
    [ -z "$(lire CHARIOW_PULSE_SECRET)" ] && echo "   ⚠️  Secret du Pulse manquant : les ventes sont confirmées au retour du client, mais ajoute-le (3)."
  else echo "⚪ Chariow : pas configuré"; fi

  k=$(lire FEDAPAY_SECRET_KEY)
  if [ -n "$k" ]; then
    case "$k" in sk_sandbox*) b="https://sandbox-api.fedapay.com/v1"; mode="mode test : paiements fictifs" ;; *) b="https://api.fedapay.com/v1"; mode="mode réel" ;; esac
    r=$(curl -s -m 20 -o /dev/null -w "%{http_code}" -H "Authorization: Bearer $k" "$b/transactions?per_page=1")
    case "$r" in 200) echo "✅ FedaPay : clé valide ($mode)" ;; 000) echo "❌ FedaPay : $HORS_LIGNE" ;; *) echo "❌ FedaPay : clé refusée (code $r)" ;; esac
    [ -z "$(lire FEDAPAY_WEBHOOK_SECRET)" ] && echo "   ⚠️  Secret du webhook FedaPay manquant : les paiements sont confirmés au retour du client, mais ajoute-le (3)."
  else echo "⚪ FedaPay : pas configuré"; fi

  k=$(lire CINETPAY_API_KEY)
  if [ -n "$k" ]; then
    r=$(curl -s -m 20 -X POST https://api-checkout.cinetpay.com/v2/payment/check -H "Content-Type: application/json" \
      -d "{\"apikey\":\"$k\",\"site_id\":\"$(lire CINETPAY_SITE_ID)\",\"transaction_id\":\"DBMTESTCLE\"}")
    if [ -z "$r" ]; then echo "❌ CinetPay : $HORS_LIGNE"
    else echo "ℹ️  CinetPay répond : $(echo "$r" | json code) $(echo "$r" | json message) — « transaction introuvable » = clés acceptées ; un message d'authentification = clé ou site_id à revoir."; fi
    [ -z "$(lire CINETPAY_SECRET_KEY)" ] && echo "   ⚠️  Clé secrète CinetPay manquante (nécessaire pour vérifier les notifications)."
  else echo "⚪ CinetPay : pas configuré"; fi

  k=$(lire FLUTTERWAVE_SECRET_KEY)
  if [ -n "$k" ]; then
    r=$(curl -s -m 20 -H "Authorization: Bearer $k" https://api.flutterwave.com/v3/balances)
    if [ -z "$r" ]; then echo "❌ Flutterwave : $HORS_LIGNE"
    elif [ "$(echo "$r" | json status)" = "success" ]; then echo "✅ Flutterwave : clé valide"
    else echo "❌ Flutterwave : clé refusée ($(echo "$r" | json message))"; fi
  else echo "⚪ Flutterwave : pas configuré"; fi

  k=$(lire STRIPE_SECRET_KEY)
  if [ -n "$k" ]; then
    r=$(curl -s -m 20 -o /dev/null -w "%{http_code}" -u "$k:" https://api.stripe.com/v1/balance)
    case "$r" in 200) echo "✅ Stripe : clé valide" ;; 000) echo "❌ Stripe : $HORS_LIGNE" ;; *) echo "❌ Stripe : clé refusée (code $r)" ;; esac
  else echo "⚪ Stripe : pas configuré"; fi

  k=$(lire PAYSTACK_SECRET_KEY)
  if [ -n "$k" ]; then
    r=$(curl -s -m 20 -H "Authorization: Bearer $k" https://api.paystack.co/balance)
    if [ -z "$r" ]; then echo "❌ Paystack : $HORS_LIGNE"
    elif [ "$(echo "$r" | json status)" = "true" ]; then echo "✅ Paystack : clé valide"
    else echo "❌ Paystack : clé refusée ($(echo "$r" | json message))"; fi
  else echo "⚪ Paystack : pas configuré"; fi

  if [ -n "$SERVEUR" ]; then
    k=$(lire PUBLIC_BASE_URL)
    if [ -z "$k" ]; then echo "❌ Site : adresse manquante (choix s)"
    else
      r=$(curl -s -m 20 -o /dev/null -w "%{http_code}" "$k/api/payments/options")
      case "$r" in 200) echo "✅ Site en ligne : $k" ;; 000) echo "❌ Site injoignable : $k (domaine, certificat SSL ou application arrêtée ?)" ;; *) echo "❌ Site : réponse $r (voir dbmelo-journal)" ;; esac
    fi
    [ "$(lire ALLOW_DEMO_PAYMENTS)" = "true" ] && echo "⛔ Paiement simulé ACTIVÉ sur le site public : désactive-le (8) !"
  elif [ "$(lire ALLOW_DEMO_PAYMENTS)" = "true" ]; then
    echo "ℹ️  Paiement simulé ACTIVÉ : parfait pour tes essais, mais dbmelo-public reste bloqué."
  fi
  echo
  printf "Entrée pour revenir au menu… "
  read -r _ || true
}

# Une ligne du menu, alignée pour tenir sur l'écran étroit d'un téléphone
# (bash compte les caractères accentués comme un seul avec ${#}, pas printf).
ligne() {
  local pad=$((20 - ${#2}))
  [ "$pad" -lt 1 ] && pad=1
  printf ' %s) %s%*s%s\n' "$1" "$2" "$pad" "" "$3"
}

menu() {
  clear 2>/dev/null || printf '\033[2J\033[H'
  echo "=== DB.Mélo : mes clés API ==="
  ligne 1 "Kie.ai (Suno)" "$(etat KIE_API_KEY)"
  ligne 2 "Claude (facultatif)" "$(etat ANTHROPIC_API_KEY)"
  ligne 3 "Chariow (paiement)" "$(etat CHARIOW_API_KEY)"
  ligne 4 "Flutterwave" "$(etat FLUTTERWAVE_SECRET_KEY)"
  ligne 5 "Stripe (cartes)" "$(etat STRIPE_SECRET_KEY)"
  ligne 6 "Paystack (facult.)" "$(etat PAYSTACK_SECRET_KEY)"
  ligne f "FedaPay (facult.)" "$(k=$(lire FEDAPAY_SECRET_KEY); case "$k" in "") echo "❌ manquante" ;; sk_sandbox*) echo "✅ mode test" ;; *) echo "✅ $(masque "$k")" ;; esac)"
  ligne c "CinetPay (facult.)" "$(etat CINETPAY_API_KEY)"
  ligne 7 "Ton entreprise" "$(n=$(lire MERCHANT_NAME); echo "${n:-DB.Mélo}")"
  ligne 8 "Paiement simulé" "$([ "$(lire ALLOW_DEMO_PAYMENTS)" = "true" ] && echo "ACTIVÉ" || echo "désactivé")"
  ligne v "Versions" "$([ "$(lire VERSIONS_MODE)" = "styles" ] && echo "rythmée+acoustique" || echo "économiques")"
  ligne m "Modèle Suno" "$(modele)"
  [ -n "$SERVEUR" ] && ligne s "Adresse du site" "$(u=$(lire PUBLIC_BASE_URL); echo "${u:-❌ à remplir}")"
  echo " 9) Tester mes clés"
  echo " 0) Enregistrer et relancer DB.Mélo"
  echo " q) Quitter sans relancer"
  printf "Ton choix : "
}

while true; do
  menu
  read -r choix || exit 0
  case "$choix" in
    1) demander KIE_API_KEY "Clé Kie.ai (kie.ai > API Keys) :" ;;
    2) demander ANTHROPIC_API_KEY "Clé Claude (console.anthropic.com > API Keys, commence par sk-ant-) :" ;;
    3)
      demander CHARIOW_API_KEY "Chariow — Clé API (Paramètres > API, commence par sk_) :"
      demander CHARIOW_PRODUCT_ID "Chariow — Identifiant du produit « Chanson » (commence par prd_) :" texte
      demander CHARIOW_PULSE_SECRET "Chariow — Secret du Pulse (Automatisations > Pulses > ton Pulse, commence par whsec_) :"
      ;;
    f | F)
      echo
      echo "Clés de test (sk_sandbox_…) pour essayer sans argent réel, puis clés réelles (sk_live_…)."
      demander FEDAPAY_SECRET_KEY "FedaPay — Clé secrète (Paramètres > Clés API, commence par sk_) :"
      demander FEDAPAY_WEBHOOK_SECRET "FedaPay — Clé secrète du webhook (Paramètres > Webhooks, commence par wh_) :"
      ;;
    c | C)
      demander CINETPAY_API_KEY "CinetPay — API KEY (espace marchand > Intégrations) :"
      demander CINETPAY_SITE_ID "CinetPay — SITE ID :"
      demander CINETPAY_SECRET_KEY "CinetPay — Clé secrète (SECRET KEY) :"
      ;;
    4)
      demander FLUTTERWAVE_SECRET_KEY "Flutterwave — Secret key (Settings > API Keys, commence par FLWSECK) :"
      demander FLUTTERWAVE_WEBHOOK_HASH "Flutterwave — Secret hash des webhooks (Settings > Webhooks) :"
      ;;
    5)
      demander STRIPE_SECRET_KEY "Stripe — Secret key (Developers > API keys, commence par sk_) :"
      demander STRIPE_WEBHOOK_SECRET "Stripe — Signing secret du webhook (commence par whsec_) :"
      ;;
    6) demander PAYSTACK_SECRET_KEY "Paystack — Secret key (Settings > API Keys, commence par sk_) :" ;;
    7)
      echo
      echo "Ces informations s'affichent sur les pages Contact, Conditions et Confidentialité."
      echo "Les passerelles de paiement les vérifient. Laissées vides, ce sont les coordonnées"
      echo "de DB.Mélo : dbmelox@gmail.com, WhatsApp +226 72 83 01 94, téléphone +226 75 54 10 16."
      demander MERCHANT_NAME "Nom de ton entreprise (ou ton nom si tu vends en ton nom propre) :" texte
      demander MERCHANT_EMAIL "E-mail de contact (aussi utilisé pour les reçus) :" texte
      demander MERCHANT_WHATSAPP "Numéro WhatsApp avec l'indicatif :" texte
      demander MERCHANT_PHONE "Numéro de téléphone avec l'indicatif :" texte
      demander MERCHANT_ADDRESS "Ville et pays, ex. Ouagadougou, Burkina Faso :" texte
      demander MERCHANT_REGISTRATION "Numéro RCCM ou IFU (Entrée si tu n'en as pas) :" texte
      ;;
    8)
      if [ "$(lire ALLOW_DEMO_PAYMENTS)" = "true" ]; then ecrire ALLOW_DEMO_PAYMENTS false; echo "Paiement simulé désactivé : seuls les vrais paiements sont proposés."
      elif [ -n "$SERVEUR" ]; then
        echo "⛔ Sur ton site public, le paiement simulé donnerait des chansons GRATUITES à tout le monde."
        printf "   Tape OUI en majuscules pour l'activer quand même (quelques minutes de test) : "
        read -r ok || ok=""
        if [ "$ok" = "OUI" ]; then ecrire ALLOW_DEMO_PAYMENTS true; echo "Activé : pense à le désactiver juste après ton test (8)."; else echo "Rien n'a changé."; fi
      else ecrire ALLOW_DEMO_PAYMENTS true; echo "Paiement simulé activé (essais seulement : ne l'ouvre pas au public)."; fi
      sleep 2
      ;;
    v | V)
      if [ "$(lire VERSIONS_MODE)" = "styles" ]; then
        ecrire VERSIONS_MODE takes
        echo "Versions économiques : 1 composition Suno, 2 versions au choix (≈ 12 crédits par chanson)."
      else
        ecrire VERSIONS_MODE styles
        echo "Versions rythmée + acoustique : 2 compositions Suno (≈ 24 crédits par chanson)."
      fi
      echo "Pense à « 0 » pour relancer DB.Mélo."
      sleep 3
      ;;
    m | M)
      echo
      echo "Modèle Suno (actuel : $(modele)) :"
      echo " 1) V6       le plus récent (conseillé)"
      echo " 2) V6_MINI  rapide"
      echo " 3) V6_WILD  plus original"
      echo " 4) V5       ancien modèle"
      echo " (si Kie refuse le modèle choisi, DB.Mélo repasse seul en V5)"
      printf "   > "
      read -r n || n=""
      case "$n" in 1) ecrire KIE_SUNO_MODEL V6 ;; 2) ecrire KIE_SUNO_MODEL V6_MINI ;; 3) ecrire KIE_SUNO_MODEL V6_WILD ;; 4) ecrire KIE_SUNO_MODEL V5 ;; esac
      echo "Écoute une chanson test et regarde le crédit Kie (9) avant et après. « 0 » pour relancer DB.Mélo."
      sleep 3
      ;;
    9) tester ;;
    s | S) [ -n "$SERVEUR" ] && demander PUBLIC_BASE_URL "Adresse de ton site, ex. https://dbmelo.com :" texte ;;
    0)
      if [ -n "$SERVEUR" ]; then
        mkdir -p "$(dirname "$SERVEUR")" && touch "$SERVEUR"
        echo "Enregistré : DB.Mélo redémarre avec la nouvelle configuration (quelques secondes)."
      elif command -v dbmelo >/dev/null 2>&1; then
        dbmelo-stop --serveur >/dev/null 2>&1
        dbmelo
      else
        echo "Clés enregistrées. Lance DB.Mélo avec l'installateur (voir le guide)."
      fi
      exit 0
      ;;
    q | Q) exit 0 ;;
  esac
done
