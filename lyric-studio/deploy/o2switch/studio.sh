#!/bin/bash
# Commandes de Africa Lyrics chez o2switch :  studio <commande>
#   studio maj         installer la dernière version
#   studio journal     voir ce que fait le studio
#   studio relancer    redémarrer le studio
#   studio retour      revenir à la version précédente
#   studio sauvegarde  copier les données (comptes, projets, vidéos) dans ~/lyric-studio-sauvegardes
CMD="${1:-aide}"
APP="$HOME/lyric-studio"
DONNEES="$HOME/lyric-studio-donnees"
SCRIPT="https://raw.githubusercontent.com/digitalbrainnk-boop/Nk/ccr-78cf5167-8sfpbb/lyric-studio/deploy/o2switch/installer.sh"

case "$CMD" in
  maj) curl -fsSL "$SCRIPT" | bash ;;
  journal) tail -n 80 "$APP/journal.log" ;;
  relancer) touch "$APP/tmp/restart.txt" && echo "Le studio redémarre (ouvre son adresse pour le réveiller)." ;;
  retour)
    ACTUELLE=$(readlink -f "$APP/actuelle")
    PRECEDENTE=$(ls -1dt "$APP"/versions/*/ | sed 's#/$##' | grep -vx "$ACTUELLE" | head -n 1)
    if [ -z "$PRECEDENTE" ]; then echo "Aucune version précédente."; exit 1; fi
    ln -sfn "$PRECEDENTE" "$APP/actuelle" && touch "$APP/tmp/restart.txt"
    echo "Retour à la version $(cat "$PRECEDENTE/VERSION")." ;;
  sauvegarde)
    mkdir -p "$HOME/lyric-studio-sauvegardes"
    FICHIER="$HOME/lyric-studio-sauvegardes/studio-$(date +%Y%m%d-%H%M).tgz"
    tar -czf "$FICHIER" -C "$DONNEES" . && echo "Sauvegarde : $FICHIER ($(du -h "$FICHIER" | cut -f1))" ;;
  *) sed -n '2,7p' "$0" | sed 's/^# \{0,1\}//' ;;
esac
