#!/usr/bin/env python3
"""Assemble le questionnaire (dossier docs/) en une seule page pour claude.ai.

Utilisation : python3 artefact/assembler.py
Produit artefact/enquete-grace-liberte.html, à publier comme Artifact
(capacité « downloads » pour le fichier Word et l'export Excel).
"""
import pathlib
import re

ICI = pathlib.Path(__file__).resolve().parent
DOCS = ICI.parent / "docs"
SORTIE = ICI / "enquete-grace-liberte.html"
SCRIPTS = ["commun.js", "questionnaire.js", "outils.js", "app.js"]
POLICE = "https://fonts.googleapis.com/css2?family=Source+Serif+4:opsz,wght@8..60,600;8..60,700&display=swap"


def lire(nom):
    texte = (DOCS / nom).read_text(encoding="utf-8")
    if nom.endswith(".js") and re.search(r"</script", texte, re.I):
        raise SystemExit(f"{nom} contient « </script » : impossible de l'intégrer tel quel.")
    return texte


style = lire("style.css")
# La page claude.ai réserve déjà les marges du haut et du bas du téléphone.
style = style.replace(
    "  padding-top: env(safe-area-inset-top, 0px);\n  padding-bottom: env(safe-area-inset-bottom, 0px);\n", ""
)

morceaux = [
    "<title>Enquête grâce et liberté</title>",
    '<meta name="claude:viewport-fit-sides" content="cover">',
    f'<link rel="stylesheet" href="{POLICE}">',
    f"<style>\n{style}</style>",
    '<div class="barre-progression" id="barre" hidden><span id="barre-remplissage"></span></div>',
    '<main id="app" class="page" aria-live="polite"></main>',
    '<div class="notification" id="notification" role="status" hidden></div>',
]
morceaux += [f"<script>\n{lire(nom)}</script>" for nom in SCRIPTS]
SORTIE.write_text("\n".join(morceaux) + "\n", encoding="utf-8")
print(f"{SORTIE.relative_to(ICI.parent)} : {SORTIE.stat().st_size // 1024} Ko")
