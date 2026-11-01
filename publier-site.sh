#!/usr/bin/env bash
# Publie le site du questionnaire (dossier docs/) sur la branche gh-pages.
# GitHub Pages le sert ensuite à l'adresse https://digitalbrainnk-boop.github.io/Nk/
# Les documents déposés avec « Mes documents » (dossier d/ de gh-pages) sont gardés.
#
# Utilisation : ./publier-site.sh
set -euo pipefail

ICI=$(cd "$(dirname "$0")" && pwd)
ARBRE=$(mktemp -d)
nettoyer() { git -C "$ICI" worktree remove --force "$ARBRE" >/dev/null 2>&1 || rm -rf "$ARBRE"; }
trap nettoyer EXIT

if git -C "$ICI" fetch -q origin gh-pages 2>/dev/null; then
  git -C "$ICI" worktree add -q --detach "$ARBRE" FETCH_HEAD
else
  # Première publication : branche vide, sans l'historique du reste du dépôt.
  git -C "$ICI" worktree add -q --detach "$ARBRE"
  git -C "$ARBRE" checkout -q --orphan gh-pages-nouvelle
  git -C "$ARBRE" rm -rqf .
fi

# Tout remplacer par le contenu de docs/, sauf les documents (d/).
find "$ARBRE" -mindepth 1 -maxdepth 1 ! -name .git ! -name d -exec rm -rf {} +
(cd "$ICI/docs" && tar cf - --exclude=./README.md --exclude=./d .) | (cd "$ARBRE" && tar xf -)

git -C "$ARBRE" add -A
if git -C "$ARBRE" diff --cached --quiet; then
  echo "Le site en ligne est déjà à jour."
  exit 0
fi
git -C "$ARBRE" commit -q -m "${MESSAGE:-Publication du site ($(git -C "$ICI" rev-parse --short HEAD))}"
git -C "$ARBRE" push -q origin HEAD:refs/heads/gh-pages
echo "Site publié : https://digitalbrainnk-boop.github.io/Nk/ (en ligne 1 à 2 minutes plus tard)"
