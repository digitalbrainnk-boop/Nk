#!/usr/bin/env python3
"""
Construit l'application Android (APK signé) à partir de l'application web de ../app.

Aucun SDK Android n'est nécessaire : les outils sont téléchargés depuis Maven Central (sommes SHA-1 vérifiées)
et gardés en cache.
  - aapt2 et les ressources du framework Android : paquet apktool-lib (org.apktool) ;
  - compilateur dex : dalvik-dx (com.jakewharton.android.repackaged) ;
  - vérification des signatures : apksig (com.android.tools.build), la bibliothèque de vérification d'Android ;
  - classes Android pour la compilation : android-all (org.robolectric), API 34.
Signatures : schéma v1 (JAR) par jarsigner du JDK, schéma v2 écrit ici (format public « APK Signature Scheme v2 »).
Prérequis : Python 3 avec le paquet cryptography, JDK 11 ou plus (javac, jarsigner, keytool), Linux x86-64.

Signature : la clé est lue dans ANDROID_CLE (fichier PKCS#12) avec le mot de passe ANDROID_CLE_MDP.
Sans clé, une clé est créée dans ~/.config/agent-dimensionnement/ : conservez-la, car les mises à jour
de l'application doivent être signées avec la même clé pour s'installer par-dessus l'ancienne version.

Usage : python3 android/construire.py [--sortie dist/agent-dimensionnement.apk]
"""
import argparse
import hashlib
import os
import re
import secrets
import shutil
import struct
import subprocess
import sys
import tempfile
import urllib.request
import zipfile
from pathlib import Path

ICI = Path(__file__).resolve().parent
APP = ICI.parent / "app"
CACHE = Path(os.environ.get("ANDROID_OUTILS_CACHE", Path.home() / ".cache" / "agent-dimensionnement-android"))
MIROIRS = [
    "https://repo1.maven.org/maven2",
    "https://maven-central.storage-download.googleapis.com/maven2",
]
OUTILS = {
    "apktool-lib.jar": "org/apktool/apktool-lib/3.0.3/apktool-lib-3.0.3.jar",
    "dalvik-dx.jar": "com/jakewharton/android/repackaged/dalvik-dx/16.0.1/dalvik-dx-16.0.1.jar",
    "apksig.jar": "com/android/tools/build/apksig/2.3.0/apksig-2.3.0.jar",
    "android-all.jar": "org/robolectric/android-all/14-robolectric-10818077/android-all-14-robolectric-10818077.jar",
}
MIN_SDK = 21
CIBLE_SDK = 34
ALIAS = "dimensionnement"
# Fichiers de l'application web embarqués dans l'APK (le service worker est inutile dans l'application Android)
FICHIERS_WEB = ["index.html", "moteur.js", "app.js", "polices.css", "manifest.webmanifest"]
DOSSIERS_WEB = ["polices", "icones", "vendor"]


def telecharger(nom, chemin_maven):
    cible = CACHE / nom
    if cible.exists():
        return cible
    CACHE.mkdir(parents=True, exist_ok=True)
    derniere_erreur = None
    for miroir in MIROIRS:
        try:
            with urllib.request.urlopen(f"{miroir}/{chemin_maven}.sha1", timeout=60) as r:
                attendu = r.read().decode().split()[0].strip()
            print(f"  téléchargement de {nom} ({miroir})…")
            temporaire = cible.with_suffix(".part")
            sha1 = hashlib.sha1()
            with urllib.request.urlopen(f"{miroir}/{chemin_maven}", timeout=600) as r, open(temporaire, "wb") as f:
                while bloc := r.read(1 << 20):
                    sha1.update(bloc)
                    f.write(bloc)
            if sha1.hexdigest() != attendu:
                temporaire.unlink()
                raise RuntimeError(f"somme SHA-1 incorrecte pour {nom}")
            temporaire.rename(cible)
            return cible
        except Exception as e:  # miroir indisponible : on essaie le suivant
            derniere_erreur = e
    raise SystemExit(f"Impossible de télécharger {nom} : {derniere_erreur}")


def preparer_outils():
    jars = {nom: telecharger(nom, chemin) for nom, chemin in OUTILS.items()}
    aapt2 = CACHE / "aapt2"
    cadre = CACHE / "android-framework.jar"
    if not aapt2.exists() or not cadre.exists():
        with zipfile.ZipFile(jars["apktool-lib.jar"]) as z:
            aapt2.write_bytes(z.read("prebuilt/linux/aapt2"))
            cadre.write_bytes(z.read("prebuilt/android-framework.jar"))
        aapt2.chmod(0o755)
    return jars, aapt2, cadre


def lancer(*commande, **options):
    resultat = subprocess.run([str(c) for c in commande], capture_output=True, text=True, **options)
    if resultat.returncode != 0:
        sys.stderr.write(resultat.stdout + resultat.stderr)
        raise SystemExit(f"Échec : {' '.join(str(c) for c in commande[:3])}…")
    return resultat.stdout


def version_application():
    texte = (APP / "moteur.js").read_text(encoding="utf-8")
    nom = re.search(r'const VERSION = "(\d+)\.(\d+)\.(\d+)"', texte)
    if not nom:
        raise SystemExit("VERSION introuvable dans app/moteur.js")
    majeure, mineure, correctif = (int(x) for x in nom.groups())
    return f"{majeure}.{mineure}.{correctif}", majeure * 10000 + mineure * 100 + correctif


def cle_de_signature():
    chemin = os.environ.get("ANDROID_CLE")
    if chemin:
        mdp = os.environ.get("ANDROID_CLE_MDP")
        if not mdp:
            raise SystemExit("ANDROID_CLE est défini : indiquez aussi son mot de passe dans ANDROID_CLE_MDP.")
        return Path(chemin), mdp
    dossier = Path.home() / ".config" / "agent-dimensionnement"
    cle = dossier / "signature-android.p12"
    fichier_mdp = dossier / "signature-android.mdp"
    if not cle.exists():
        dossier.mkdir(parents=True, exist_ok=True)
        mdp = secrets.token_urlsafe(24)
        lancer("keytool", "-genkeypair", "-keystore", cle, "-storetype", "PKCS12", "-alias", ALIAS,
               "-keyalg", "RSA", "-keysize", "3072", "-validity", "10950",
               "-dname", "CN=Agent de dimensionnement electrique, O=digitalbrainnk",
               "-storepass", mdp, "-keypass", mdp)
        fichier_mdp.write_text(mdp + "\n")
        os.chmod(cle, 0o600)
        os.chmod(fichier_mdp, 0o600)
        print(f"  nouvelle clé de signature : {cle} (à conserver avec {fichier_mdp.name})")
    return cle, fichier_mdp.read_text().strip()


def copier_application(destination):
    www = destination / "www"
    www.mkdir(parents=True)
    for nom in FICHIERS_WEB:
        shutil.copy2(APP / nom, www / nom)
    for dossier in DOSSIERS_WEB:
        shutil.copytree(APP / dossier, www / dossier)


def aligner(entree, sortie, alignement=4):
    """Équivalent de zipalign : les entrées non compressées commencent sur une frontière de 4 octets."""
    with zipfile.ZipFile(entree) as src, zipfile.ZipFile(sortie, "w") as dst:
        for info in src.infolist():
            donnees = src.read(info)
            nouvelle = zipfile.ZipInfo(info.filename, date_time=(2020, 1, 1, 0, 0, 0))
            nouvelle.compress_type = info.compress_type
            nouvelle.external_attr = info.external_attr
            if info.compress_type == zipfile.ZIP_STORED:
                debut = dst.fp.tell() + 30 + len(info.filename.encode("utf-8"))
                bourrage = (-(debut + 6)) % alignement
                # champ supplémentaire 0xD935 (alignement Android) : identifiant, taille, alignement, bourrage
                nouvelle.extra = struct.pack("<HHH", 0xD935, 2 + bourrage, alignement) + b"\0" * bourrage
            dst.writestr(nouvelle, donnees)


def verifier_alignement(apk):
    with zipfile.ZipFile(apk) as z, open(apk, "rb") as f:
        for info in z.infolist():
            if info.compress_type != zipfile.ZIP_STORED:
                continue
            f.seek(info.header_offset)
            entete = f.read(30)
            longueur_nom, longueur_extra = struct.unpack("<HH", entete[26:30])
            debut = info.header_offset + 30 + longueur_nom + longueur_extra
            if debut % 4:
                raise SystemExit(f"Entrée non alignée : {info.filename}")


def _lp(donnees):
    """Préfixe de longueur 32 bits, petit-boutiste (format des blocs de signature APK)."""
    return struct.pack("<I", len(donnees)) + donnees


def _condense_v2(sections):
    """Condensé SHA-256 par morceaux de 1 Mio des sections de l'APK (APK Signature Scheme v2)."""
    morceaux = []
    for section in sections:
        for i in range(0, len(section), 1 << 20):
            morceau = section[i:i + (1 << 20)]
            morceaux.append(hashlib.sha256(b"\xa5" + struct.pack("<I", len(morceau)) + morceau).digest())
    return hashlib.sha256(b"\x5a" + struct.pack("<I", len(morceaux)) + b"".join(morceaux)).digest()


def signer_v2(entree, sortie, cle_p12, mdp):
    """Insère un bloc de signature APK v2 (RSASSA-PKCS1-v1_5 / SHA-256, identifiant 0x0103) avant le répertoire central."""
    from cryptography.hazmat.primitives import hashes, serialization
    from cryptography.hazmat.primitives.asymmetric import padding
    from cryptography.hazmat.primitives.serialization import pkcs12

    cle, certificat, _ = pkcs12.load_key_and_certificates(Path(cle_p12).read_bytes(), mdp.encode())
    apk = Path(entree).read_bytes()
    fin = apk.rfind(b"PK\x05\x06")
    if fin < 0 or len(apk) - fin != 22:
        raise SystemExit("Fin de répertoire central introuvable (commentaire ZIP inattendu)")
    debut_rc = struct.unpack("<I", apk[fin + 16:fin + 20])[0]
    entrees, repertoire, eocd = apk[:debut_rc], apk[debut_rc:fin], apk[fin:]
    algo = 0x0103
    condense = _condense_v2([entrees, repertoire, eocd])
    donnees_signees = (_lp(_lp(struct.pack("<I", algo) + _lp(condense)))
                       + _lp(_lp(certificat.public_bytes(serialization.Encoding.DER)))
                       + _lp(b""))
    signature = cle.sign(donnees_signees, padding.PKCS1v15(), hashes.SHA256())
    cle_publique = cle.public_key().public_bytes(serialization.Encoding.DER, serialization.PublicFormat.SubjectPublicKeyInfo)
    signataire = _lp(donnees_signees) + _lp(_lp(struct.pack("<I", algo) + _lp(signature))) + _lp(cle_publique)
    valeur = _lp(_lp(signataire))
    paire = struct.pack("<Q", 4 + len(valeur)) + struct.pack("<I", 0x7109871A) + valeur
    taille = len(paire) + 8 + 16
    bloc = struct.pack("<Q", taille) + paire + struct.pack("<Q", taille) + b"APK Sig Block 42"
    nouvel_eocd = eocd[:16] + struct.pack("<I", debut_rc + len(bloc)) + eocd[20:]
    Path(sortie).write_bytes(entrees + bloc + repertoire + nouvel_eocd)


def construire(sortie):
    print("Outils :")
    jars, aapt2, cadre = preparer_outils()
    nom_version, code_version = version_application()
    cle, mdp = cle_de_signature()
    with tempfile.TemporaryDirectory() as tmp:
        tmp = Path(tmp)
        print(f"Construction de la version {nom_version} (code {code_version})…")
        copier_application(tmp / "assets")
        lancer(aapt2, "compile", "--dir", ICI / "res", "-o", tmp / "res.zip")
        (tmp / "gen").mkdir()
        lancer(aapt2, "link", "-o", tmp / "base.apk", "-I", cadre, "--manifest", ICI / "AndroidManifest.xml",
               "--min-sdk-version", MIN_SDK, "--target-sdk-version", CIBLE_SDK,
               "--version-code", code_version, "--version-name", nom_version,
               "-A", tmp / "assets", "--java", tmp / "gen", "--auto-add-overlay", tmp / "res.zip")
        sources = sorted(str(p) for p in list((ICI / "src").rglob("*.java")) + list((tmp / "gen").rglob("*.java")))
        (tmp / "classes").mkdir()
        # API Java 8 du JDK (--release 8) et classes Android d'android-all, qui ne contient pas java.*
        lancer("javac", "--release", "8", "-Xlint:-options", "-encoding", "UTF-8",
               "-classpath", jars["android-all.jar"], "-d", tmp / "classes", *sources)
        lancer("java", "-cp", jars["dalvik-dx.jar"], "com.android.dx.command.Main", "--dex",
               f"--min-sdk-version={MIN_SDK}", f"--output={tmp / 'classes.dex'}", tmp / "classes")
        with zipfile.ZipFile(tmp / "base.apk", "a", compression=zipfile.ZIP_DEFLATED) as z:
            z.write(tmp / "classes.dex", "classes.dex")
        # Signature v1 (JAR, Android 5 et 6) par jarsigner, alignement, puis signature v2 (Android 7 et plus)
        lancer("jarsigner", "-keystore", cle, "-storetype", "PKCS12", "-storepass", mdp,
               "-sigalg", "SHA256withRSA", "-digestalg", "SHA-256", "-signedjar", tmp / "v1.apk", tmp / "base.apk", ALIAS)
        aligner(tmp / "v1.apk", tmp / "aligne.apk")
        sortie.parent.mkdir(parents=True, exist_ok=True)
        signer_v2(tmp / "aligne.apk", sortie, cle, mdp)
        # Vérification indépendante par apksig (qui charge des classes internes du JDK : on les ouvre explicitement)
        acces = [f"--add-exports=java.base/sun.security.{p}=ALL-UNNAMED" for p in ("x509", "pkcs", "util")]
        print(lancer("java", *acces, "-cp", jars["apksig.jar"], ICI / "outils" / "Verifier.java", sortie).strip())
        verifier_alignement(sortie)
        print(lancer(aapt2, "dump", "badging", sortie).splitlines()[0])
    print(f"APK : {sortie} ({sortie.stat().st_size // 1024} Ko)")


if __name__ == "__main__":
    analyseur = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    analyseur.add_argument("--sortie", default=str(ICI.parent / "dist" / "agent-dimensionnement.apk"))
    construire(Path(analyseur.parse_args().sortie).resolve())
