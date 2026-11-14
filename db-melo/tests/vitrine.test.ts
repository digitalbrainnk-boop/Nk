// Vitrine : chansons du dossier vitrine (titre, style, pochette) et MP3 servi par morceaux.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { readId3, tagMp3 } from "@/lib/audio/id3";
import type { SongRecord } from "@/lib/types";

const JPEG = Uint8Array.of(0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4, 0xff, 0xd9);
const mp3 = (n: number) => Uint8Array.from({ length: n }, (_, i) => i % 251);

let dir: string;
let showcase: typeof import("@/lib/server/showcase");
let audioRoute: typeof import("@/app/api/vitrine/[id]/audio/route");

beforeAll(async () => {
  const data = fs.mkdtempSync(path.join(os.tmpdir(), "dbmelo-vitrine-"));
  vi.stubEnv("DATA_DIR", data);
  dir = path.join(data, "vitrine");
  fs.mkdirSync(dir);
  // 1. Chanson composée sur le site : titre et styles viennent de son dossier.
  const store = await import("@/lib/server/store");
  await store.songs.put({ id: "abc", config: { title: "Maman Awa", styles: ["afropop", "zouk"] } } as unknown as SongRecord);
  fs.writeFileSync(path.join(dir, "01-abc.mp3"), mp3(5000));
  fs.writeFileSync(path.join(dir, "01-abc.json"), JSON.stringify({ song: "abc" }));
  // 2. MP3 téléchargé depuis DB.Mélo : titre et pochette dans l'étiquette.
  fs.writeFileSync(path.join(dir, "02-koffi.mp3"), tagMp3(mp3(3000), { title: "Joyeux anniversaire Koffi", artist: "DB.Mélo", cover: { data: JPEG, mime: "image/jpeg" } }));
  // 3. MP3 sans étiquette : titre tiré du nom du fichier.
  fs.writeFileSync(path.join(dir, "03-pour_toi-zouk.mp3"), mp3(1000));
  fs.writeFileSync(path.join(dir, "notes.txt"), "ignoré");
  showcase = await import("@/lib/server/showcase");
  audioRoute = await import("@/app/api/vitrine/[id]/audio/route");
});

describe("étiquette ID3", () => {
  it("relit le titre accentué et la pochette écrits par DB.Mélo", () => {
    const tags = readId3(tagMp3(mp3(100), { title: "Chérie, ma lumière", artist: "DB.Mélo", cover: { data: JPEG, mime: "image/jpeg" } }));
    expect(tags.title).toBe("Chérie, ma lumière");
    expect(tags.cover?.mime).toBe("image/jpeg");
    expect(Array.from(tags.cover?.data ?? [])).toEqual(Array.from(JPEG));
    expect(readId3(mp3(100))).toEqual({});
  });
});

describe("vitrine", () => {
  it("liste les MP3 dans l'ordre des fichiers, avec titre et style", async () => {
    const list = await showcase.listShowcase();
    expect(list.map((s) => [s.title, s.subtitle, s.cover])).toEqual([
      ["Maman Awa", "Afro-pop · Zouk", false],
      ["Joyeux anniversaire Koffi", "Créée avec DB.Mélo", true],
      ["Pour toi zouk", "Créée avec DB.Mélo", false],
    ]);
    expect(list.every((s) => /^[0-9a-f]{12}$/.test(s.id))).toBe(true);
  });

  it("pochette tirée de l'étiquette, ou absente", async () => {
    const [a, b] = await showcase.listShowcase();
    expect(await showcase.showcaseCover(a.id)).toBeNull();
    expect((await showcase.showcaseCover(b.id))?.mime).toBe("image/jpeg");
    expect(await showcase.showcaseCover("000000000000")).toBeNull();
  });

  it("MP3 servi en entier ou par morceaux (lecteur de l'iPhone)", async () => {
    const [a] = await showcase.listShowcase();
    const ctx = { params: Promise.resolve({ id: a.id }) };
    const full = await audioRoute.GET(new Request("http://x/"), ctx);
    expect(full.status).toBe(200);
    expect(full.headers.get("accept-ranges")).toBe("bytes");
    expect((await full.arrayBuffer()).byteLength).toBe(5000);

    const part = await audioRoute.GET(new Request("http://x/", { headers: { range: "bytes=100-199" } }), ctx);
    expect(part.status).toBe(206);
    expect(part.headers.get("content-range")).toBe("bytes 100-199/5000");
    expect(Array.from(new Uint8Array(await part.arrayBuffer()))).toEqual(Array.from(mp3(5000).subarray(100, 200)));

    const tail = await audioRoute.GET(new Request("http://x/", { headers: { range: "bytes=4990-" } }), ctx);
    expect(tail.headers.get("content-range")).toBe("bytes 4990-4999/5000");

    const bad = await audioRoute.GET(new Request("http://x/", { headers: { range: "bytes=9000-" } }), ctx);
    expect(bad.status).toBe(416);
    const missing = await audioRoute.GET(new Request("http://x/"), { params: Promise.resolve({ id: "000000000000" }) });
    expect(missing.status).toBe(404);
  });

  it("dossier absent : vitrine vide", async () => {
    fs.renameSync(dir, `${dir}-cache`);
    showcase.forgetShowcase();
    expect(await showcase.listShowcase()).toEqual([]);
    fs.renameSync(`${dir}-cache`, dir);
    showcase.forgetShowcase();
  });
});
