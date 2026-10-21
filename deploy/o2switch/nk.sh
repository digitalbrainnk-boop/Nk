#!/bin/bash
# Commandes de l'agent chez o2switch :  nk <commande> [nom de l'agent, « agent » par défaut]
#   nk maj         installer la dernière version
#   nk journal     voir ce que fait l'agent
#   nk relancer    redémarrer l'agent
#   nk retour      revenir à la version précédente
#   nk motdepasse  afficher le mot de passe du tableau de bord
#   nk liste       voir les agents installés
CMD="${1:-aide}"
NOM="${2:-agent}"
APP="$HOME/nk-$NOM"
SCRIPT="https://raw.githubusercontent.com/digitalbrainnk-boop/Nk/claude/ai-agent-multichannel-0snabq/deploy/o2switch/installer.sh"

if [ "$CMD" != "liste" ] && [ "$CMD" != "aide" ] && [ ! -d "$APP" ]; then
  echo "Aucun agent « $NOM » ici. Agents installés :"; ls -d "$HOME"/nk-*/ 2>/dev/null | xargs -r -n1 basename | sed 's/^nk-//' | grep -v -- '-donnees$'
  exit 1
fi
case "$CMD" in
  maj) curl -fsSL "$SCRIPT" | bash -s "$NOM" ;;
  journal) tail -n 80 "$APP/journal.log" ;;
  relancer) touch "$APP/tmp/restart.txt" && echo "L'agent « $NOM » redémarre (ouvre son adresse pour le réveiller)." ;;
  retour)
    ACTUELLE=$(readlink -f "$APP/actuelle")
    PRECEDENTE=$(ls -1dt "$APP"/versions/*/ | sed 's#/$##' | grep -vx "$ACTUELLE" | head -n 1)
    if [ -z "$PRECEDENTE" ]; then echo "Aucune version précédente."; exit 1; fi
    ln -sfn "$PRECEDENTE" "$APP/actuelle" && touch "$APP/tmp/restart.txt"
    echo "Retour à la version $(cat "$PRECEDENTE/VERSION")." ;;
  motdepasse) grep '^ADMIN_PASSWORD=' "$APP/.env" | cut -d= -f2- ;;
  liste) ls -d "$HOME"/nk-*/ 2>/dev/null | xargs -r -n1 basename | sed 's/^nk-//' | grep -v -- '-donnees$' ;;
  *) sed -n '2,9p' "$0" | sed 's/^# \{0,1\}//' ;;
esac
