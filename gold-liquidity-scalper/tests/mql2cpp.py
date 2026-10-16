#!/usr/bin/env python3
"""
mql2cpp.py - transforme le code MQL5 de l'EA en C++ compilable avec le shim
(tests/shim/mql5_shim.h) et applique des contrôles propres aux règles MQL5
que le compilateur C++ ne détecterait pas.

IMPORTANT : ce n'est PAS le compilateur MetaEditor. Une compilation C++
réussie ne garantit pas une compilation MetaEditor réussie ; elle détecte
une large classe d'erreurs (identifiants, types, signatures, conversions,
masquage de variables, accès hors limites en test...).

Usage : python3 mql2cpp.py <dossier_source_EA> <dossier_sortie>
Code retour 0 si aucun contrôle MQL5 n'échoue, 1 sinon.
"""
import os
import re
import sys

# Structures MQL5 natives (ne peuvent pas être passées par valeur)
BUILTIN_STRUCTS = {
    "MqlRates", "MqlTick", "MqlDateTime", "MqlTradeRequest", "MqlTradeResult",
    "MqlTradeCheckResult", "MqlTradeTransaction", "MqlCalendarValue",
    "MqlCalendarEvent", "MqlCalendarCountry", "MqlBookInfo", "MqlParam",
}

# Constructions C++ absentes de MQL5
FORBIDDEN = [
    (re.compile(r"->"), "opérateur '->' (MQL5 utilise '.' même sur un pointeur)"),
    (re.compile(r"\bnullptr\b"), "nullptr"),
    (re.compile(r"\bauto\b"), "auto"),
    (re.compile(r"\bstd::"), "std::"),
    (re.compile(r"\bunsigned\b"), "unsigned (utiliser uint/ulong/uchar/ushort)"),
    (re.compile(r"\blong\s+long\b"), "long long"),
    (re.compile(r"\b(static|dynamic|reinterpret|const)_cast\b"), "cast C++"),
    (re.compile(r"\bnamespace\b"), "namespace"),
    (re.compile(r"\benum\s+class\b"), "enum class"),
    (re.compile(r"\bconstexpr\b"), "constexpr"),
    (re.compile(r"\busing\b"), "using"),
    (re.compile(r"\btypedef\b"), "typedef"),
    (re.compile(r"\bthrow\b|\btry\b|\bcatch\b"), "exceptions"),
    (re.compile(r"\[\s*[&=]\s*\]"), "lambda"),
    (re.compile(r"\binline\b"), "inline"),
    (re.compile(r"#\s*include\s*<"), "#include <...> (dépendance externe)"),
    (re.compile(r"\bC'\d"), "littéral couleur C'..' (non C++, utiliser RgbColor)"),
]

ARRAY_DECL = re.compile(r"\b([A-Za-z_]\w*)(\s*&\s*|\s+)([A-Za-z_]\w*)\s*\[\s*\]")
NOT_TYPES = {"return", "else", "case", "new", "delete", "sizeof", "goto"}


def strip_comments_and_strings(line, in_block):
    """Retire commentaires et contenu des chaînes (pour les contrôles)."""
    out = []
    i = 0
    n = len(line)
    while i < n:
        if in_block:
            j = line.find("*/", i)
            if j < 0:
                return "".join(out), True
            i = j + 2
            in_block = False
            continue
        c = line[i]
        if line.startswith("//", i):
            break
        if line.startswith("/*", i):
            in_block = True
            i += 2
            continue
        if c == '"':
            out.append('"')
            i += 1
            while i < n and line[i] != '"':
                if line[i] == "\\":
                    i += 1
                i += 1
            out.append('"')
            i += 1
            continue
        if c == "'":
            out.append("'")
            i += 1
            while i < n and line[i] != "'":
                if line[i] == "\\":
                    i += 1
                i += 1
            out.append("'")
            i += 1
            continue
        out.append(c)
        i += 1
    return "".join(out), in_block


def transform_line(line):
    s = line
    if re.match(r"^\s*#\s*property\b", s):
        return "// " + s
    if re.match(r"^\s*input\s+group\b", s):
        return "// " + s
    s = re.sub(r"^(\s*)(input|sinput)\s+", r"\1", s)
    m = re.match(r'^(\s*#\s*include\s*")([^"]+)(".*)$', s)
    if m:
        s = m.group(1) + m.group(2).replace("\\", "/") + m.group(3)
        return s

    def repl(mm):
        typ, sep, name = mm.group(1), mm.group(2), mm.group(3)
        if typ in NOT_TYPES:
            return mm.group(0)
        ref = "&" if "&" in sep else ""
        return "MqlArray<%s> %s%s" % (typ, ref, name)

    # n'applique la conversion des tableaux dynamiques que hors chaînes
    parts = re.split(r'("(?:[^"\\]|\\.)*")', s)
    for k in range(0, len(parts), 2):
        parts[k] = ARRAY_DECL.sub(repl, parts[k])
    return "".join(parts)


def lint_file(path, text, struct_names, errors):
    in_block = False
    stack = []  # 'class' | 'block'
    pending_class = False
    lines = text.split("\n")
    code_lines = []
    for raw in lines:
        code, in_block = strip_comments_and_strings(raw, in_block)
        code_lines.append(code)

    for idx, code in enumerate(code_lines):
        lineno = idx + 1
        for rx, what in FORBIDDEN:
            if rx.search(code):
                errors.append("%s:%d: construction non MQL5 : %s" % (path, lineno, what))
        if re.search(r'"\s*\+\s*"', code):
            errors.append("%s:%d: concaténation de deux littéraux (préférer un seul littéral)" % (path, lineno))
        # référence locale (interdit en MQL5 hors paramètres)
        if stack and stack[-1] == "block":
            if re.match(r"^\s*(const\s+)?[A-Za-z_]\w*\s*&\s*[A-Za-z_]\w*\s*=", code):
                errors.append("%s:%d: variable locale de type référence (interdit en MQL5)" % (path, lineno))
        # initialisation de membre dans le corps d'une classe/structure
        if stack and stack[-1] == "class":
            m = re.match(r"^\s*(static\s+)?(const\s+)?[A-Za-z_]\w*\s+[A-Za-z_]\w*\s*(\[[^\]]*\])?\s*=", code)
            if m and "(" not in code.split("=")[0]:
                errors.append("%s:%d: initialisation de membre dans la déclaration (interdit en MQL5)" % (path, lineno))
        # fonction renvoyant une référence
        if re.match(r"^\s*(const\s+)?[A-Za-z_]\w*\s*&\s*[A-Za-z_][\w:]*\s*\(", code):
            errors.append("%s:%d: fonction renvoyant une référence (interdit en MQL5)" % (path, lineno))
        # suivi des accolades
        if re.search(r"\b(class|struct)\s+[A-Za-z_]\w*\s*(:[^{;]*)?$", code.strip()) or re.search(r"\b(class|struct)\s+[A-Za-z_]\w*\s*(:[^{;]*)?\{", code):
            pending_class = True
        for ch in code:
            if ch == "{":
                stack.append("class" if pending_class else "block")
                pending_class = False
            elif ch == "}":
                if stack:
                    stack.pop()
            elif ch == ";" and pending_class and "{" not in code:
                pending_class = False

    # structures/classes passées par valeur
    joined = "\n".join(code_lines)
    sig_rx = re.compile(r"(?m)^[ \t]*(?:static\s+|virtual\s+)?(?:const\s+)?[A-Za-z_]\w*\s+[A-Za-z_][\w:]*\s*\(([^()]*)\)\s*(?:const)?\s*(?:\{|;|:|$)")
    for m in sig_rx.finditer(joined):
        params = m.group(1).strip()
        if not params or params == "void":
            continue
        for p in params.split(","):
            p = p.strip()
            p = p.split("=")[0].strip()
            if "&" in p:
                continue
            toks = p.replace("const ", "").split()
            if len(toks) >= 2 and toks[0] in struct_names:
                lineno = joined[: m.start()].count("\n") + 1
                errors.append("%s:%d: '%s' passé par valeur (MQL5 : structures et objets par référence uniquement)" % (path, lineno, p))


def main():
    if len(sys.argv) != 3:
        print(__doc__)
        return 2
    src, dst = sys.argv[1], sys.argv[2]
    files = []
    for root, _, names in os.walk(src):
        for n in names:
            if n.endswith((".mq5", ".mqh")):
                files.append(os.path.join(root, n))
    files.sort()
    struct_names = set(BUILTIN_STRUCTS)
    texts = {}
    for f in files:
        with open(f, "rb") as fh:
            data = fh.read()
        if data.startswith(b"\xef\xbb\xbf"):
            data = data[3:]
        text = data.decode("utf-8").replace("\r\n", "\n")
        texts[f] = text
        for m in re.finditer(r"\b(?:class|struct)\s+([A-Za-z_]\w*)", text):
            struct_names.add(m.group(1))
    errors = []
    for f in files:
        rel = os.path.relpath(f, src)
        lint_file(rel, texts[f], struct_names, errors)
        out_path = os.path.join(dst, rel)
        os.makedirs(os.path.dirname(out_path), exist_ok=True)
        out = "\n".join(transform_line(l) for l in texts[f].split("\n"))
        with open(out_path, "w", encoding="utf-8") as fh:
            fh.write(out)
    # fonction de remise aux valeurs par défaut des paramètres (isolation des tests)
    resets = []
    for f in files:
        for line in texts[f].split("\n"):
            m = re.match(r"^\s*(?:input|sinput)\s+(?!group\b)([A-Za-z_]\w*)\s+([A-Za-z_]\w*)\s*=\s*([^;]+);", line)
            if m:
                resets.append("  %s = %s;" % (m.group(2), m.group(3).strip()))
    with open(os.path.join(dst, "inputs_reset.inc"), "w", encoding="utf-8") as fh:
        fh.write("inline void ResetInputs()\n{\n" + "\n".join(resets) + "\n}\n")
    for e in errors:
        print("MQL5-LINT " + e)
    print("mql2cpp : %d fichier(s) transformé(s), %d problème(s) MQL5" % (len(files), len(errors)))
    return 1 if errors else 0


if __name__ == "__main__":
    sys.exit(main())
