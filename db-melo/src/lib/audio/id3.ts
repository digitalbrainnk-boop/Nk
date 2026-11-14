// Écriture d'étiquettes ID3v2.3 (titre, artiste, album, paroles, pochette) dans un MP3.
// Sans dépendance : lisible par iOS (Fichiers), Android, iTunes, VLC, WhatsApp…

export interface Id3Tags {
  title: string;
  artist: string;
  album?: string;
  albumArtist?: string;
  year?: string;
  genre?: string;
  comment?: string;
  lyrics?: string;
  cover?: { data: Uint8Array; mime: "image/jpeg" | "image/png" };
}

const ascii = (s: string) => Uint8Array.from(s, (c) => c.charCodeAt(0) & 0xff);

function utf16(s: string, terminate = false): Uint8Array {
  // Encodage 1 (UTF-16 avec BOM little-endian) : gère les accents et l'emoji.
  const out = new Uint8Array(2 + s.length * 2 + (terminate ? 2 : 0));
  out[0] = 0xff;
  out[1] = 0xfe;
  for (let i = 0; i < s.length; i++) {
    const code = s.charCodeAt(i);
    out[2 + i * 2] = code & 0xff;
    out[3 + i * 2] = code >> 8;
  }
  return out;
}

function concat(parts: Uint8Array[]): Uint8Array {
  const len = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(len);
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

function frame(id: string, body: Uint8Array): Uint8Array {
  const header = new Uint8Array(10);
  header.set(ascii(id), 0);
  const n = body.length;
  header[4] = (n >>> 24) & 0xff; // v2.3 : taille non « synchsafe »
  header[5] = (n >>> 16) & 0xff;
  header[6] = (n >>> 8) & 0xff;
  header[7] = n & 0xff;
  return concat([header, body]);
}

const textFrame = (id: string, value: string) => frame(id, concat([Uint8Array.of(1), utf16(value)]));

function synchsafe(n: number): Uint8Array {
  return Uint8Array.of((n >>> 21) & 0x7f, (n >>> 14) & 0x7f, (n >>> 7) & 0x7f, n & 0x7f);
}

export function readSynchsafe(b: Uint8Array, offset: number): number {
  return ((b[offset] & 0x7f) << 21) | ((b[offset + 1] & 0x7f) << 14) | ((b[offset + 2] & 0x7f) << 7) | (b[offset + 3] & 0x7f);
}

/** Retire une éventuelle étiquette ID3v2 existante en tête de fichier. */
export function stripId3v2(mp3: Uint8Array): Uint8Array {
  if (mp3.length < 10 || mp3[0] !== 0x49 || mp3[1] !== 0x44 || mp3[2] !== 0x33) return mp3;
  const footer = (mp3[5] & 0x10) !== 0 ? 10 : 0;
  const end = 10 + readSynchsafe(mp3, 6) + footer;
  return end < mp3.length ? mp3.subarray(end) : mp3;
}

export function buildId3v2(tags: Id3Tags): Uint8Array {
  const frames: Uint8Array[] = [textFrame("TIT2", tags.title), textFrame("TPE1", tags.artist)];
  if (tags.album) frames.push(textFrame("TALB", tags.album));
  if (tags.albumArtist) frames.push(textFrame("TPE2", tags.albumArtist));
  if (tags.year) frames.push(textFrame("TYER", tags.year));
  if (tags.genre) frames.push(textFrame("TCON", tags.genre));
  if (tags.comment) {
    frames.push(frame("COMM", concat([Uint8Array.of(1), ascii("fra"), utf16("", true), utf16(tags.comment)])));
  }
  if (tags.lyrics) {
    frames.push(frame("USLT", concat([Uint8Array.of(1), ascii("fra"), utf16("", true), utf16(tags.lyrics)])));
  }
  if (tags.cover) {
    // APIC : encodage 0, type MIME, type d'image 3 (couverture), description vide, données.
    frames.push(frame("APIC", concat([Uint8Array.of(0), ascii(tags.cover.mime), Uint8Array.of(0, 3, 0), tags.cover.data])));
  }
  const body = concat(frames);
  const padding = new Uint8Array(256); // facilite les retouches ultérieures par d'autres logiciels
  const header = concat([ascii("ID3"), Uint8Array.of(3, 0, 0), synchsafe(body.length + padding.length)]);
  return concat([header, body, padding]);
}

/** Remplace l'étiquette du MP3 par la nôtre. */
export function tagMp3(mp3: Uint8Array, tags: Id3Tags): Uint8Array {
  return concat([buildId3v2(tags), stripId3v2(mp3)]);
}

/** Détecte le type d'une image d'après ses premiers octets (APIC n'accepte que JPEG / PNG). */
export function imageMime(data: Uint8Array): "image/jpeg" | "image/png" | null {
  if (data[0] === 0xff && data[1] === 0xd8) return "image/jpeg";
  if (data[0] === 0x89 && data[1] === 0x50 && data[2] === 0x4e && data[3] === 0x47) return "image/png";
  return null;
}

/* ───────────── Lecture (titre et pochette) ───────────── */

function decodeText(enc: number, b: Uint8Array): string {
  if (enc === 1 || enc === 2) {
    let le = enc === 1;
    let start = 0;
    if (enc === 1 && b.length >= 2) {
      if (b[0] === 0xfe && b[1] === 0xff) le = false;
      if ((b[0] === 0xff && b[1] === 0xfe) || (b[0] === 0xfe && b[1] === 0xff)) start = 2;
    }
    let s = "";
    for (let i = start; i + 1 < b.length; i += 2) {
      const code = le ? b[i] | (b[i + 1] << 8) : (b[i] << 8) | b[i + 1];
      if (code === 0) break;
      s += String.fromCharCode(code);
    }
    return s;
  }
  const end = b.indexOf(0);
  const bytes = end >= 0 ? b.subarray(0, end) : b;
  return enc === 3 ? new TextDecoder().decode(bytes) : String.fromCharCode(...bytes);
}

/** Fin d'une chaîne terminée par zéro (un ou deux octets selon l'encodage). */
function skipTerminated(b: Uint8Array, from: number, wide: boolean): number {
  if (!wide) {
    const i = b.indexOf(0, from);
    return i < 0 ? b.length : i + 1;
  }
  for (let i = from; i + 1 < b.length; i += 2) if (b[i] === 0 && b[i + 1] === 0) return i + 2;
  return b.length;
}

/** Titre (TIT2) et pochette (APIC) d'un MP3 étiqueté ID3v2.3 ou v2.4, s'ils existent. */
export function readId3(mp3: Uint8Array): { title?: string; cover?: { data: Uint8Array; mime: string } } {
  if (mp3.length < 10 || mp3[0] !== 0x49 || mp3[1] !== 0x44 || mp3[2] !== 0x33) return {};
  const version = mp3[3];
  const end = Math.min(mp3.length, 10 + readSynchsafe(mp3, 6));
  const out: { title?: string; cover?: { data: Uint8Array; mime: string } } = {};
  let p = 10;
  while (p + 10 <= end) {
    const id = String.fromCharCode(mp3[p], mp3[p + 1], mp3[p + 2], mp3[p + 3]);
    if (!/^[A-Z0-9]{4}$/.test(id)) break;
    const size = version >= 4 ? readSynchsafe(mp3, p + 4) : ((mp3[p + 4] << 24) | (mp3[p + 5] << 16) | (mp3[p + 6] << 8) | mp3[p + 7]) >>> 0;
    const body = mp3.subarray(p + 10, Math.min(end, p + 10 + size));
    if (id === "TIT2" && body.length > 1) out.title = decodeText(body[0], body.subarray(1)).trim();
    if (id === "APIC" && body.length > 4) {
      const enc = body[0];
      const mimeEnd = body.indexOf(0, 1);
      const mime = String.fromCharCode(...body.subarray(1, mimeEnd));
      const data = body.subarray(skipTerminated(body, mimeEnd + 2, enc === 1 || enc === 2));
      const kind = imageMime(data);
      if (kind) out.cover = { data, mime: kind || mime };
    }
    p += 10 + size;
  }
  return out;
}
