/*
 * Outils sans interface : préparation du questionnaire, lien de réponses,
 * fichier Word (.docx), export Excel (.csv) et statistiques.
 */
(function (racine) {
  "use strict";

  // ---------------------------------------------------------------------------
  // Questionnaire
  // ---------------------------------------------------------------------------
  const NEUTRE = /^(je ne sais pas|sans opinion|je ne comprends pas)/i;

  function preparer(enquete) {
    const questions = [];
    enquete.parties.forEach((partie, indexPartie) => {
      partie.questions.forEach((q) => {
        const options = (q.options || []).map((o) => {
          const option = typeof o === "string" ? { texte: o } : { ...o };
          if (option.exclusif === undefined) option.exclusif = NEUTRE.test(option.texte);
          return option;
        });
        questions.push({
          n: q.n,
          texte: q.texte,
          ouverte: !!q.ouverte,
          multiple: !q.ouverte && (q.multiple ?? partie.multiple ?? false),
          options,
          partie: indexPartie,
        });
      });
    });
    return questions;
  }

  function estRepondue(q, rep) {
    const v = rep[q.n];
    if (q.ouverte) return typeof v === "string" && v.trim() !== "";
    return Array.isArray(v) && v.length > 0;
  }

  function choixTextes(q, rep) {
    const v = rep[q.n];
    if (!Array.isArray(v)) return [];
    return v
      .filter((i) => q.options[i])
      .map((i) => {
        const o = q.options[i];
        const precision = o.autre ? (rep[q.n + "t"] || "").trim() : "";
        return precision ? `${o.texte} : ${precision}` : o.texte;
      });
  }

  function texteReponse(q, rep) {
    if (q.ouverte) return (rep[q.n] || "").trim();
    return choixTextes(q, rep).join(" | ");
  }

  // Les réponses arrivent d'un lien : on ne garde que ce qui a du sens.
  const LONGUEUR_MAX = 8000;
  function nettoyer(donnees, questions) {
    if (!donnees || typeof donnees !== "object") throw new Error("contenu vide");
    const a = donnees.a && typeof donnees.a === "object" ? donnees.a : {};
    const rep = {};
    for (const q of questions) {
      const v = a[q.n];
      if (q.ouverte) {
        if (typeof v === "string" && v.trim()) rep[q.n] = v.slice(0, LONGUEUR_MAX);
        continue;
      }
      if (!Array.isArray(v)) continue;
      const choix = [...new Set(v.filter((i) => Number.isInteger(i) && i >= 0 && i < q.options.length))].sort(
        (x, y) => x - y,
      );
      if (!choix.length) continue;
      rep[q.n] = choix;
      const precision = a[q.n + "t"];
      if (typeof precision === "string" && precision.trim()) rep[q.n + "t"] = precision.slice(0, LONGUEUR_MAX);
    }
    const id = typeof donnees.id === "string" ? donnees.id.replace(/[^A-Z0-9]/gi, "").slice(0, 12).toUpperCase() : "";
    const t = Number.isFinite(donnees.t) ? donnees.t : 0;
    return { id: id || "SANS-CODE", t, v: Number.isFinite(donnees.v) ? donnees.v : 1, a: rep };
  }

  const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  function nouveauCode(longueur = 6) {
    const octets = new Uint8Array(longueur);
    (racine.crypto || globalThis.crypto).getRandomValues(octets);
    return Array.from(octets, (o) => ALPHABET[o % ALPHABET.length]).join("");
  }

  function formaterDate(secondes) {
    if (!secondes) return "date inconnue";
    try {
      return new Date(secondes * 1000).toLocaleString("fr-FR", { dateStyle: "long", timeStyle: "short" });
    } catch {
      return new Date(secondes * 1000).toISOString().slice(0, 16).replace("T", " ");
    }
  }

  function formaterDateCourte(secondes) {
    if (!secondes) return "—";
    const d = new Date(secondes * 1000);
    const deux = (x) => String(x).padStart(2, "0");
    return `${deux(d.getDate())}/${deux(d.getMonth() + 1)}/${d.getFullYear()} ${deux(d.getHours())}:${deux(d.getMinutes())}`;
  }

  // ---------------------------------------------------------------------------
  // Lien de réponses : JSON compressé puis écrit en base64 « URL ».
  // Format : #r=<z|j><données>0   (z = compressé, j = brut ; le « 0 » final
  // protège la fin du lien, que certaines messageries coupent sur « - » ou « _ »).
  // ---------------------------------------------------------------------------
  function versBase64Url(octets) {
    let binaire = "";
    for (let i = 0; i < octets.length; i += 0x8000) {
      binaire += String.fromCharCode.apply(null, octets.subarray(i, i + 0x8000));
    }
    return btoa(binaire).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  }

  function depuisBase64Url(texte) {
    let b64 = texte.replace(/[^A-Za-z0-9_-]/g, "").replace(/-/g, "+").replace(/_/g, "/");
    while (b64.length % 4) b64 += "=";
    const binaire = atob(b64);
    const octets = new Uint8Array(binaire.length);
    for (let i = 0; i < binaire.length; i++) octets[i] = binaire.charCodeAt(i);
    return octets;
  }

  async function transformer(octets, flux) {
    const sortie = new Blob([octets]).stream().pipeThrough(flux);
    return new Uint8Array(await new Response(sortie).arrayBuffer());
  }

  async function encoder(donnees) {
    const octets = new TextEncoder().encode(JSON.stringify(donnees));
    if (typeof CompressionStream === "function") {
      try {
        return "z" + versBase64Url(await transformer(octets, new CompressionStream("deflate"))) + "0";
      } catch {
        /* navigateur ancien : on garde la version brute */
      }
    }
    return "j" + versBase64Url(octets) + "0";
  }

  async function decoder(code) {
    const propre = String(code).trim().replace(/[^A-Za-z0-9_-]/g, "");
    const sorte = propre[0];
    const corps = propre.slice(1, -1);
    if (!corps || (sorte !== "z" && sorte !== "j")) throw new Error("lien incomplet");
    let octets = depuisBase64Url(corps);
    if (sorte === "z") {
      if (typeof DecompressionStream !== "function") throw new Error("navigateur trop ancien");
      octets = await transformer(octets, new DecompressionStream("deflate"));
    }
    return JSON.parse(new TextDecoder().decode(octets));
  }

  // Trouve tous les liens de réponses dans un texte (messages, discussion exportée…).
  function extraireCodes(texte) {
    const codes = [];
    const motif = /#r=([zj][A-Za-z0-9_-]{8,})/g;
    let m;
    while ((m = motif.exec(String(texte)))) codes.push(m[1]);
    return [...new Set(codes)];
  }

  // ---------------------------------------------------------------------------
  // Fichier ZIP (méthode « stockée », sans compression) — base du .docx
  // ---------------------------------------------------------------------------
  const TABLE_CRC = (() => {
    const t = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      t[n] = c >>> 0;
    }
    return t;
  })();

  function crc32(octets) {
    let c = 0xffffffff;
    for (let i = 0; i < octets.length; i++) c = TABLE_CRC[(c ^ octets[i]) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  }

  function zip(fichiers, type) {
    const enc = new TextEncoder();
    const maintenant = new Date();
    const heure = (maintenant.getHours() << 11) | (maintenant.getMinutes() << 5) | (maintenant.getSeconds() >> 1);
    const jour =
      ((maintenant.getFullYear() - 1980) << 9) | ((maintenant.getMonth() + 1) << 5) | maintenant.getDate();
    const morceaux = [];
    const repertoire = [];
    let position = 0;
    for (const f of fichiers) {
      const nom = enc.encode(f.nom);
      const donnees = typeof f.contenu === "string" ? enc.encode(f.contenu) : f.contenu;
      const crc = crc32(donnees);
      const local = new DataView(new ArrayBuffer(30));
      local.setUint32(0, 0x04034b50, true);
      local.setUint16(4, 20, true);
      local.setUint16(6, 0x0800, true);
      local.setUint16(8, 0, true);
      local.setUint16(10, heure, true);
      local.setUint16(12, jour, true);
      local.setUint32(14, crc, true);
      local.setUint32(18, donnees.length, true);
      local.setUint32(22, donnees.length, true);
      local.setUint16(26, nom.length, true);
      local.setUint16(28, 0, true);
      morceaux.push(new Uint8Array(local.buffer), nom, donnees);

      const central = new DataView(new ArrayBuffer(46));
      central.setUint32(0, 0x02014b50, true);
      central.setUint16(4, 20, true);
      central.setUint16(6, 20, true);
      central.setUint16(8, 0x0800, true);
      central.setUint16(10, 0, true);
      central.setUint16(12, heure, true);
      central.setUint16(14, jour, true);
      central.setUint32(16, crc, true);
      central.setUint32(20, donnees.length, true);
      central.setUint32(24, donnees.length, true);
      central.setUint16(28, nom.length, true);
      central.setUint32(42, position, true);
      repertoire.push(new Uint8Array(central.buffer), nom);
      position += 30 + nom.length + donnees.length;
    }
    const tailleRepertoire = repertoire.reduce((s, m) => s + m.length, 0);
    const fin = new DataView(new ArrayBuffer(22));
    fin.setUint32(0, 0x06054b50, true);
    fin.setUint16(8, fichiers.length, true);
    fin.setUint16(10, fichiers.length, true);
    fin.setUint32(12, tailleRepertoire, true);
    fin.setUint32(16, position, true);
    return new Blob([...morceaux, ...repertoire, new Uint8Array(fin.buffer)], { type });
  }

  // ---------------------------------------------------------------------------
  // Document Word (.docx)
  // ---------------------------------------------------------------------------
  const ENCRE = "1E2A5E";
  const GRIS = "6B7280";

  function xml(texte) {
    return String(texte)
      .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]/g, "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function run(texte, style = {}) {
    const props = [];
    if (style.police) props.push(`<w:rFonts w:ascii="${style.police}" w:hAnsi="${style.police}" w:cs="${style.police}"/>`);
    if (style.gras) props.push("<w:b/>");
    if (style.italique) props.push("<w:i/>");
    if (style.couleur) props.push(`<w:color w:val="${style.couleur}"/>`);
    if (style.taille) props.push(`<w:sz w:val="${style.taille * 2}"/><w:szCs w:val="${style.taille * 2}"/>`);
    const lignes = String(texte).split(/\r?\n/);
    const contenu = lignes.map((l) => `<w:t xml:space="preserve">${xml(l)}</w:t>`).join("<w:br/>");
    return `<w:r>${props.length ? `<w:rPr>${props.join("")}</w:rPr>` : ""}${contenu}</w:r>`;
  }

  function paragraphe(runs, mise = {}) {
    const props = [];
    if (mise.gardeAvecSuivant) props.push("<w:keepNext/>");
    if (mise.avant !== undefined || mise.apres !== undefined) {
      props.push(`<w:spacing w:before="${mise.avant || 0}" w:after="${mise.apres ?? 60}"/>`);
    }
    if (mise.retrait) props.push(`<w:ind w:left="${mise.retrait}" w:hanging="${mise.suspendu || 0}"/>`);
    if (mise.centre) props.push('<w:jc w:val="center"/>');
    if (mise.filet) {
      props.push(`<w:pBdr><w:bottom w:val="single" w:sz="6" w:space="4" w:color="${ENCRE}"/></w:pBdr>`);
    }
    const contenu = Array.isArray(runs) ? runs.join("") : runs;
    return `<w:p>${props.length ? `<w:pPr>${props.join("")}</w:pPr>` : ""}${contenu}</w:p>`;
  }

  function docxReponse(enquete, questions, reponse) {
    const rep = reponse.a;
    const corps = [];
    const ajouter = (p) => corps.push(p);

    ajouter(paragraphe(run(enquete.surtitre.toUpperCase(), { gras: true, couleur: GRIS, taille: 10 }), { centre: true, apres: 40 }));
    ajouter(paragraphe(run(enquete.titre, { gras: true, couleur: ENCRE, taille: 18 }), { centre: true, apres: 160 }));
    const infos = [
      ["Cadre de l'étude", enquete.cadre],
      ["Chercheur", enquete.chercheur],
      ["Institution", enquete.institution],
      ["Directeur de thèse", enquete.directeur],
    ];
    for (const [libelle, valeur] of infos) {
      ajouter(paragraphe([run(`${libelle} : `, { gras: true }), run(valeur)], { apres: 20 }));
    }
    ajouter(
      paragraphe(
        [
          run("Code du participant : ", { gras: true }),
          run(reponse.id, { gras: true, couleur: ENCRE }),
          run(`      Réponses envoyées le ${formaterDate(reponse.t)}`, { couleur: GRIS }),
        ],
        { avant: 120, apres: 120, filet: true },
      ),
    );

    enquete.parties.forEach((partie, ip) => {
      ajouter(
        paragraphe(run(`${partie.rang.toUpperCase()} : ${partie.titre.toUpperCase()}`, { gras: true, couleur: ENCRE, taille: 12 }), {
          avant: 280,
          apres: 60,
          gardeAvecSuivant: true,
        }),
      );
      if (partie.description) {
        ajouter(paragraphe(run(partie.description, { italique: true, couleur: GRIS }), { apres: 120, gardeAvecSuivant: true }));
      }
      for (const q of questions.filter((x) => x.partie === ip)) {
        const consigne = q.ouverte ? "" : q.multiple ? "  (plusieurs réponses possibles)" : "";
        ajouter(
          paragraphe([run(`${q.n}. ${q.texte}`, { gras: true }), consigne ? run(consigne, { italique: true, couleur: GRIS, taille: 9 }) : ""], {
            avant: 160,
            apres: 60,
            gardeAvecSuivant: true,
          }),
        );
        if (q.ouverte) {
          const texte = (rep[q.n] || "").trim();
          ajouter(
            paragraphe(texte ? run(texte) : run("(pas de réponse)", { italique: true, couleur: GRIS }), {
              retrait: 360,
              apres: 80,
            }),
          );
          continue;
        }
        const choisis = Array.isArray(rep[q.n]) ? rep[q.n] : [];
        q.options.forEach((o, i) => {
          const coche = choisis.includes(i);
          const precision = o.autre ? (rep[q.n + "t"] || "").trim() : "";
          const libelle = o.autre ? `${o.texte} : ${precision || "…………………"}` : o.texte;
          ajouter(
            paragraphe(
              [
                run(coche ? "☒  " : "☐  ", { police: "Segoe UI Symbol", couleur: coche ? ENCRE : GRIS }),
                run(libelle, coche ? { gras: true, couleur: ENCRE } : { couleur: GRIS }),
              ],
              { retrait: 720, suspendu: 360, apres: 20, gardeAvecSuivant: i < q.options.length - 1 },
            ),
          );
        });
        if (!choisis.length) {
          ajouter(paragraphe(run("(pas de réponse)", { italique: true, couleur: GRIS, taille: 9 }), { retrait: 720, apres: 20 }));
        }
      }
    });

    ajouter(paragraphe(run(enquete.remerciements.join(" "), { italique: true }), { avant: 360, apres: 120 }));
    enquete.signature.forEach((ligne, i) =>
      ajouter(paragraphe(run(ligne, i === 0 ? { gras: true } : { couleur: GRIS }), { apres: 0 })),
    );

    const ns = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"';
    const entete = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';
    const document =
      `${entete}<w:document ${ns}><w:body>${corps.join("")}` +
      '<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1134" w:right="1134" w:bottom="1134" w:left="1134" w:header="567" w:footer="567" w:gutter="0"/></w:sectPr>' +
      "</w:body></w:document>";
    const styles =
      `${entete}<w:styles ${ns}><w:docDefaults><w:rPrDefault><w:rPr>` +
      '<w:rFonts w:ascii="Calibri" w:hAnsi="Calibri" w:eastAsia="Calibri" w:cs="Calibri"/><w:sz w:val="22"/><w:szCs w:val="22"/><w:lang w:val="fr-FR"/>' +
      '</w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:after="60" w:line="264" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults>' +
      '<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/></w:style></w:styles>';
    const types =
      `${entete}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
      '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
      '<Default Extension="xml" ContentType="application/xml"/>' +
      '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
      '<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>' +
      '<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>' +
      "</Types>";
    const relations =
      `${entete}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
      '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>' +
      '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>' +
      "</Relationships>";
    const relationsDocument =
      `${entete}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
      '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>' +
      "</Relationships>";
    const proprietes =
      `${entete}<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/">` +
      `<dc:title>${xml(`${enquete.titre} — réponses ${reponse.id}`)}</dc:title><dc:creator>${xml(`Participant ${reponse.id}`)}</dc:creator><dc:language>fr-FR</dc:language>` +
      "</cp:coreProperties>";

    return zip(
      [
        { nom: "[Content_Types].xml", contenu: types },
        { nom: "_rels/.rels", contenu: relations },
        { nom: "word/document.xml", contenu: document },
        { nom: "word/_rels/document.xml.rels", contenu: relationsDocument },
        { nom: "word/styles.xml", contenu: styles },
        { nom: "docProps/core.xml", contenu: proprietes },
      ],
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    );
  }

  // ---------------------------------------------------------------------------
  // Export pour Excel (.csv, séparateur « ; » comme dans Excel en français)
  // ---------------------------------------------------------------------------
  function champ(valeur) {
    const v = String(valeur ?? "");
    return /[";\r\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
  }

  function csv(questions, reponses) {
    const entetes = ["Code", "Date"];
    for (const q of questions) {
      entetes.push(`Q${q.n}. ${q.texte}`);
      if (q.options.some((o) => o.autre)) entetes.push(`Q${q.n}. Autre (précision)`);
    }
    const lignes = [entetes.map(champ).join(";")];
    for (const r of reponses) {
      const valeurs = [r.id, formaterDate(r.t)];
      for (const q of questions) {
        if (q.ouverte) valeurs.push((r.a[q.n] || "").trim());
        else valeurs.push(choixTextes({ ...q, options: q.options.map((o) => ({ texte: o.texte })) }, r.a).join(" | "));
        if (q.options.some((o) => o.autre)) valeurs.push((r.a[q.n + "t"] || "").trim());
      }
      lignes.push(valeurs.map(champ).join(";"));
    }
    return "﻿" + lignes.join("\r\n") + "\r\n";
  }

  // ---------------------------------------------------------------------------
  // Statistiques : pour chaque question à choix, combien de participants ont
  // coché chaque réponse (ensemble, catholiques, protestants).
  // ---------------------------------------------------------------------------
  function statistiques(questions, reponses, questionGroupe = 3) {
    const groupe = (r) => (Array.isArray(r.a[questionGroupe]) ? r.a[questionGroupe][0] : -1);
    const resultat = [];
    for (const q of questions) {
      if (q.ouverte) continue;
      const vide = () => ({ repondants: 0, comptes: q.options.map(() => 0) });
      const s = { q, ensemble: vide(), groupes: [vide(), vide()] };
      for (const r of reponses) {
        const v = r.a[q.n];
        if (!Array.isArray(v) || !v.length) continue;
        const cibles = [s.ensemble];
        const g = groupe(r);
        if (s.groupes[g]) cibles.push(s.groupes[g]);
        for (const c of cibles) {
          c.repondants++;
          for (const i of v) if (i < c.comptes.length) c.comptes[i]++;
        }
      }
      resultat.push(s);
    }
    return resultat;
  }

  racine.EnqueteOutils = {
    preparer,
    estRepondue,
    choixTextes,
    texteReponse,
    nettoyer,
    nouveauCode,
    formaterDate,
    formaterDateCourte,
    encoder,
    decoder,
    extraireCodes,
    docxReponse,
    csv,
    statistiques,
    crc32,
    zip,
  };
})(typeof window !== "undefined" ? window : globalThis);
