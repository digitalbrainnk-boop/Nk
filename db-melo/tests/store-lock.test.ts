// Deux processus Node (o2switch / Passenger) qui modifient la même chanson ne doivent rien perdre.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { beforeAll, describe, expect, it, vi } from "vitest";

type Store = typeof import("@/lib/server/store");
let a: Store;
let b: Store;
let dir: string;

beforeAll(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "dbmelo-lock-"));
  vi.stubEnv("DATA_DIR", dir);
  a = await import("@/lib/server/store");
  vi.resetModules(); // deuxième copie du module : verrous mémoire séparés, comme un autre processus
  b = await import("@/lib/server/store");
});

describe("verrou de stockage partagé", () => {
  it("sérialise les mises à jour venant de deux processus", async () => {
    expect(a.gifts).not.toBe(b.gifts);
    await a.gifts.put({ slug: "compteur", songId: "0" });
    const bump = (s: Store) => s.gifts.update("compteur", async (g) => {
      const n = Number(g.songId);
      await new Promise((r) => setTimeout(r, 2)); // laisse l'autre processus tenter sa chance
      g.songId = String(n + 1);
    });
    await Promise.all(Array.from({ length: 20 }, (_, i) => bump(i % 2 ? a : b)));
    expect((await a.gifts.get("compteur"))!.songId).toBe("20");
    expect(fs.readdirSync(path.join(dir, "db", "gifts")).filter((f) => f.endsWith(".lock"))).toEqual([]);
  });

  it("reprend un verrou abandonné", async () => {
    await a.gifts.put({ slug: "abandon", songId: "x" });
    const lock = path.join(dir, "db", "gifts", "abandon.json.lock");
    fs.writeFileSync(lock, "");
    const old = new Date(Date.now() - 60_000);
    fs.utimesSync(lock, old, old);
    const r = await b.gifts.update("abandon", (g) => {
      g.songId = "y";
    });
    expect(r?.songId).toBe("y");
  });
});
