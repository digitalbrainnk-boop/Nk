// Vitrine : quelques chansons qui jouent dès l'arrivée sur le site, pour donner envie de composer.
// Ce sont des MP3 posés dans DATA_DIR/vitrine (ajoutés avec « dbmelo-cles », ou téléversés avec le
// gestionnaire de fichiers de cPanel), joués dans l'ordre alphabétique des fichiers. Titre et style
// viennent d'un fichier .json du même nom s'il existe ({ "song": id } pour une chanson composée sur le
// site, ou { "title", "subtitle" }), sinon de l'étiquette ID3, sinon du nom du fichier.
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { imageMime, readId3 } from "../audio/id3";
import { STYLES } from "../constants";
import { config } from "./env";
import { songs } from "./store";

export interface ShowcaseItem {
  id: string;
  title: string;
  /** Style ou occasion, affiché sous le titre. */
  subtitle: string;
  cover: boolean;
}

interface Entry extends ShowcaseItem {
  file: string;
}

const MAX_ITEMS = 12;
const dir = () => path.resolve(config.dataDir(), "vitrine");
const idOf = (file: string) => createHash("sha256").update(file).digest("hex").slice(0, 12);

/** « 02-maman_awa-afropop.mp3 » → « Maman awa afropop » */
function titleFromFile(file: string): string {
  const base = path.basename(file, path.extname(file)).replace(/^\d+[\s._-]*/, "").replace(/[_-]+/g, " ").trim();
  return base ? base[0].toUpperCase() + base.slice(1) : "Chanson DB.Mélo";
}

async function sidecar(file: string): Promise<{ title?: string; subtitle?: string }> {
  let data: { song?: unknown; title?: unknown; subtitle?: unknown };
  try {
    data = JSON.parse(await fs.readFile(path.join(dir(), file.replace(/\.mp3$/i, ".json")), "utf8"));
  } catch {
    return {};
  }
  const own = { title: typeof data.title === "string" ? data.title : undefined, subtitle: typeof data.subtitle === "string" ? data.subtitle : undefined };
  // Chanson composée sur le site : son titre et ses styles.
  const song = typeof data.song === "string" ? await songs.get(data.song).catch(() => null) : null;
  if (!song) return own;
  const styles = song.config.styles.map((id) => STYLES.find((s) => s.id === id)?.label).filter(Boolean);
  return { title: own.title || song.config.title, subtitle: own.subtitle || styles.join(" · ") || undefined };
}

/** Début du fichier seulement : l'étiquette ID3 (titre, pochette) est en tête. */
async function head(file: string, bytes = 1024 * 1024): Promise<Uint8Array> {
  const handle = await fs.open(path.join(dir(), file), "r");
  try {
    const buf = new Uint8Array(bytes);
    const { bytesRead } = await handle.read(buf, 0, bytes, 0);
    return buf.subarray(0, bytesRead);
  } finally {
    await handle.close();
  }
}

async function imageFor(file: string): Promise<string | null> {
  const base = file.replace(/\.mp3$/i, "");
  for (const ext of [".jpg", ".jpeg", ".png"]) {
    try {
      await fs.access(path.join(dir(), base + ext));
      return base + ext;
    } catch {}
  }
  return null;
}

let memo: { at: number; entries: Entry[] } | null = null;

async function entries(): Promise<Entry[]> {
  if (memo && Date.now() - memo.at < 60_000) return memo.entries;
  let names: string[] = [];
  try {
    names = (await fs.readdir(dir())).filter((f) => /\.mp3$/i.test(f) && !f.startsWith(".")).sort((a, b) => a.localeCompare(b, "fr"));
  } catch {
    names = [];
  }
  const list: Entry[] = [];
  for (const file of names.slice(0, MAX_ITEMS)) {
    const extra = await sidecar(file);
    const tags = readId3(await head(file).catch(() => new Uint8Array()));
    list.push({
      id: idOf(file),
      file,
      title: extra.title || tags.title || titleFromFile(file),
      subtitle: extra.subtitle || "Créée avec DB.Mélo",
      cover: !!tags.cover || !!(await imageFor(file)),
    });
  }
  memo = { at: Date.now(), entries: list };
  return list;
}

export async function listShowcase(): Promise<ShowcaseItem[]> {
  return (await entries()).map(({ file: _file, ...item }) => item);
}

async function find(id: string): Promise<Entry | null> {
  return (await entries()).find((e) => e.id === id) ?? null;
}

/** Chemin et taille du MP3, pour une lecture par morceaux (le lecteur de l'iPhone l'exige). */
export async function showcaseAudio(id: string): Promise<{ file: string; size: number } | null> {
  const entry = await find(id);
  if (!entry) return null;
  const file = path.join(dir(), entry.file);
  const { size } = await fs.stat(file);
  return { file, size };
}

export async function showcaseCover(id: string): Promise<{ data: Uint8Array; mime: string } | null> {
  const entry = await find(id);
  if (!entry) return null;
  const image = await imageFor(entry.file);
  if (image) {
    const data = new Uint8Array(await fs.readFile(path.join(dir(), image)));
    return { data, mime: imageMime(data) ?? "image/jpeg" };
  }
  return readId3(await head(entry.file)).cover ?? null;
}

/** Pour les tests : relire le dossier tout de suite. */
export function forgetShowcase() {
  memo = null;
}
