// Parcours « paiement d'abord » : rien n'est composé avant le paiement, la composition démarre à la confirmation.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { beforeAll, describe, expect, it, vi } from "vitest";
import type { PaymentRecord, SongConfig } from "@/lib/types";

const config: SongConfig = {
  mode: "studio",
  title: "Maman Awa",
  lyrics: "[Couplet 1]\nTu m'as porté dans tes bras pleins d'amour\nTu m'as appris à rêver chaque jour",
  language: "fr",
  voice: "female",
  emotion: "nostalgic",
  styles: ["afropop"],
  instruments: [],
};

let lib: typeof import("@/lib/server/songs");
let store: typeof import("@/lib/server/store");

beforeAll(async () => {
  vi.stubEnv("DATA_DIR", fs.mkdtempSync(path.join(os.tmpdir(), "dbmelo-test-")));
  vi.stubEnv("KIE_API_KEY", ""); // chanson de démonstration
  vi.stubEnv("FLOW_MODE", "");
  lib = await import("@/lib/server/songs");
  store = await import("@/lib/server/store");
});

function payment(songId: string, amount = 1000): PaymentRecord {
  return { reference: `DBMTEST${Math.random().toString(36).slice(2, 10).toUpperCase()}`, songId, provider: "demo", method: "mobile_money", plan: "essentiel", amount, currency: "XOF", status: "pending", createdAt: 0, updatedAt: 0 };
}

describe("paiement avant composition", () => {
  it("refuse de composer une chanson non payée", async () => {
    const song = await lib.createSong(config);
    await expect(lib.startGeneration(song.id, "http://localhost")).rejects.toThrow(/paiement/);
    expect((await store.songs.get(song.id))!.generation.status).toBe("idle");
  });

  it("lance la composition dès la confirmation du paiement", async () => {
    const song = await lib.createSong(config);
    const p = await store.payments.put(payment(song.id));
    await lib.applyPaymentResult(p, { status: "paid", amount: 1000, currency: "XOF" }, "http://localhost");
    const after = (await store.songs.get(song.id))!;
    expect(after.payment.status).toBe("paid");
    expect(after.generation.status).toBe("generating");
    expect(after.generation.attempts).toBe(1);
  });

  it("ne débloque rien si le montant payé est trop faible", async () => {
    const song = await lib.createSong(config);
    const p = await store.payments.put(payment(song.id));
    const r = await lib.applyPaymentResult(p, { status: "paid", amount: 100, currency: "XOF" }, "http://localhost");
    expect(r.status).toBe("failed");
    expect((await store.songs.get(song.id))!.generation.status).toBe("idle");
  });

  it("limite le nombre de relances d'une chanson payée", async () => {
    const song = await lib.createSong(config);
    await store.songs.update(song.id, (s) => {
      s.payment = { status: "paid", plan: "essentiel" };
      s.generation = { status: "failed", attempts: 3 };
    });
    await expect(lib.startGeneration(song.id, "http://localhost")).rejects.toThrow(/maximal/);
    expect(lib.toPublicSong((await store.songs.get(song.id))!).generation.attemptsLeft).toBe(0);
  });
});
