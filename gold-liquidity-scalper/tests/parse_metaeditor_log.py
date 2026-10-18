#!/usr/bin/env python3
"""Lit un journal de compilation MetaEditor (UTF-16 ou UTF-8) et résume les erreurs et avertissements.

Usage : parse_metaeditor_log.py compile.log
Code retour : 0 = 0 erreur et 0 avertissement, 1 = erreurs ou avertissements, 2 = journal illisible
ou sans ligne « Result ». Bibliothèque standard uniquement.
"""
import re
import sys

RESULT = re.compile(r"Result:\s*(\d+)\s+errors?,\s*(\d+)\s+warnings?", re.I)
LINE = re.compile(r"^(?P<file>.+?)\((?P<line>\d+),(?P<col>\d+)\)\s*:\s*(?P<kind>error|warning)\s+(?P<code>\d+)\s*:\s*(?P<msg>.*)$", re.I)


def read_log(path):
    with open(path, "rb") as fh:
        data = fh.read()
    if data.startswith(b"\xff\xfe") or data.startswith(b"\xfe\xff"):
        text = data.decode("utf-16")
    elif len(data) > 1 and data[1:2] == b"\x00":
        text = data.decode("utf-16-le")
    else:
        text = data.decode("utf-8-sig", errors="replace")
    return text.replace("\r\n", "\n").replace("\r", "\n")


def parse(text):
    """Renvoie (erreurs, avertissements, résultat (nb erreurs, nb avertissements) ou None)."""
    errors, warnings, result = [], [], None
    for raw in text.split("\n"):
        line = raw.strip()
        m = LINE.match(line)
        if m:
            entry = "%s(%s,%s) : %s %s : %s" % (m["file"].replace("\\", "/").split("/")[-1], m["line"], m["col"],
                                              m["kind"].lower(), m["code"], m["msg"])
            (errors if m["kind"].lower() == "error" else warnings).append(entry)
            continue
        r = RESULT.search(line)
        if r:
            result = (int(r.group(1)), int(r.group(2)))
    return errors, warnings, result


def main(argv):
    if len(argv) != 2:
        print(__doc__)
        return 2
    try:
        text = read_log(argv[1])
    except OSError as exc:
        print("journal illisible : %s" % exc)
        return 2
    errors, warnings, result = parse(text)
    for e in errors:
        print("ERREUR        " + e)
    for w in warnings:
        print("AVERTISSEMENT " + w)
    if result is None:
        print("Ligne « Result » absente : compilation interrompue ou journal incomplet.")
        return 2
    print("Résultat MetaEditor : %d erreur(s), %d avertissement(s)" % result)
    return 0 if result == (0, 0) else 1


if __name__ == "__main__":
    sys.exit(main(sys.argv))
