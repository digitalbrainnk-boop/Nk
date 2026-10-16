#!/usr/bin/env python3
"""
Prépare les versions distribuables de l'application à partir de dimensionnement/app :

  1. app/sw.js : numéro de version du cache hors connexion (empreinte des fichiers), pour que les
     applications installées se mettent à jour ;
  2. dist/agent-dimensionnement-hors-ligne.html : un seul fichier (scripts, polices et icône intégrés)
     à ouvrir sur un ordinateur, même sans connexion ;
  3. dist/agent-dimensionnement.apk : application Android (option --apk, voir android/construire.py) ;
  4. page pour Claude (option --claude DOSSIER) : polices Google Fonts, sans manifeste ni service worker.

Usage : python3 outils/construire.py [--apk] [--claude DOSSIER]
"""
import argparse
import base64
import hashlib
import re
import shutil
import subprocess
import sys
from pathlib import Path

RACINE = Path(__file__).resolve().parent.parent
APP = RACINE / "app"
DIST = RACINE / "dist"
POLICES_GOOGLE = ('<link rel="preconnect" href="https://fonts.googleapis.com">\n'
                  '<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>\n'
                  '<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Barlow+Semi+Condensed:wght@500;600;700'
                  '&family=Barlow:wght@400;500;600&family=IBM+Plex+Mono:wght@400;500&display=swap">')


def fichiers_du_cache():
    texte = (APP / "sw.js").read_text(encoding="utf-8")
    return re.findall(r'^\s*"([^"]+)",$', texte.split("const FICHIERS = [")[1].split("];")[0], re.M)


def versionner_service_worker():
    empreinte = hashlib.sha256()
    for nom in fichiers_du_cache():
        if nom == "./":
            continue
        chemin = APP / nom
        if not chemin.is_file():
            raise SystemExit(f"sw.js cite un fichier absent : {nom}")
        empreinte.update(nom.encode() + b"\0" + chemin.read_bytes())
    version = empreinte.hexdigest()[:12]
    sw = APP / "sw.js"
    texte = sw.read_text(encoding="utf-8")
    nouveau = re.sub(r'const VERSION = "[^"]*";', f'const VERSION = "{version}";', texte, count=1)
    if nouveau != texte:
        sw.write_text(nouveau, encoding="utf-8")
    # Tous les fichiers de l'application doivent être dans le cache hors connexion
    attendus = {"index.html", "moteur.js", "catalogue.js", "app.js", "polices.css", "manifest.webmanifest"}
    attendus |= {f"{d}/{p.name}" for d in ("polices", "icones", "vendor") for p in (APP / d).iterdir()
                 if p.suffix in (".woff2", ".png", ".svg", ".js")}
    manquants = attendus - set(fichiers_du_cache())
    if manquants:
        raise SystemExit(f"Fichiers absents du cache hors connexion (sw.js) : {', '.join(sorted(manquants))}")
    print(f"Service worker : version {version}")


def page_sans_entete():
    """Contenu de <head> et de <body> d'index.html, séparés."""
    source = (APP / "index.html").read_text(encoding="utf-8")
    tete = re.search(r"<head>(.*)</head>", source, re.S).group(1)
    corps = re.search(r"<body>(.*)</body>", source, re.S).group(1)
    return source, tete, corps


def polices_integrees():
    css = (APP / "polices.css").read_text(encoding="utf-8")
    def remplacer(m):
        donnees = base64.b64encode((APP / m.group(1)).read_bytes()).decode()
        return f"url(data:font/woff2;base64,{donnees})"
    return re.sub(r"url\((polices/[^)]+\.woff2)\)", remplacer, css)


def script_integre(nom):
    texte = (APP / nom).read_text(encoding="utf-8")
    return "<script>\n" + texte.replace("</script", "<\\/script") + "\n</script>"


def construire_hors_ligne():
    source, _, _ = page_sans_entete()
    icone = base64.b64encode((APP / "icones" / "favicon-32.png").read_bytes()).decode()
    page = source
    page = re.sub(r'<link rel="manifest"[^>]*>\n', "", page)
    page = re.sub(r'<link rel="icon"[^>]*>\n', "", page)
    page = re.sub(r'<link rel="apple-touch-icon"[^>]*>\n', "", page)
    page = page.replace('<meta name="theme-color"', f'<link rel="icon" type="image/png" href="data:image/png;base64,{icone}">\n<meta name="theme-color"', 1)
    page = re.sub(r"<!-- POLICES -->.*?<!-- /POLICES -->", lambda m: "<style>\n" + polices_integrees() + "</style>", page, flags=re.S)
    # Le SDK de l'assistant est intégré : la page n'a besoin d'aucun autre fichier
    page = page.replace('<script src="moteur.js"></script>\n<script src="catalogue.js"></script>\n<script src="app.js"></script>',
                        "\n".join(script_integre(nom) for nom in ("vendor/anthropic-sdk.js", "moteur.js", "catalogue.js", "app.js")))
    if '<script src="' in page:
        raise SystemExit("Version hors ligne : un script externe subsiste")
    DIST.mkdir(exist_ok=True)
    sortie = DIST / "agent-dimensionnement-hors-ligne.html"
    sortie.write_text(page, encoding="utf-8")
    print(f"Version hors ligne : {sortie.relative_to(RACINE)} ({sortie.stat().st_size // 1024} Ko)")


def construire_claude(dossier):
    """Page publiée dans Claude : le document est fourni par Claude (pas de doctype, ni html, head, body)."""
    _, tete, corps = page_sans_entete()
    tete = re.sub(r'<meta charset="utf-8">\s*', "", tete)
    tete = re.sub(r'<meta name="viewport"[^>]*>\s*', "", tete)
    tete = re.sub(r'<meta name="(mobile-web-app-capable|apple-mobile-web-app-[a-z-]+)"[^>]*>\s*', "", tete)
    tete = re.sub(r'<link rel="(manifest|icon|apple-touch-icon)"[^>]*>\s*', "", tete)
    tete = re.sub(r"<!-- POLICES -->.*?<!-- /POLICES -->", POLICES_GOOGLE, tete, flags=re.S)
    dossier = Path(dossier)
    dossier.mkdir(parents=True, exist_ok=True)
    (dossier / "agent-dimensionnement.html").write_text(tete.strip() + "\n" + corps.strip() + "\n", encoding="utf-8")
    for nom in ("moteur.js", "catalogue.js", "app.js"):
        shutil.copy2(APP / nom, dossier / nom)
    print(f"Page pour Claude : {dossier}")


if __name__ == "__main__":
    analyseur = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    analyseur.add_argument("--apk", action="store_true", help="construire aussi l'application Android")
    analyseur.add_argument("--claude", metavar="DOSSIER", help="préparer la page publiée dans Claude")
    options = analyseur.parse_args()
    versionner_service_worker()
    construire_hors_ligne()
    if options.claude:
        construire_claude(options.claude)
    if options.apk:
        subprocess.run([sys.executable, str(RACINE / "android" / "construire.py")], check=True)
