// Mode « takes » : une seule composition Suno par chanson, ses deux prises font les versions 1 et 2.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { KieRecordInfo, SongConfig } from "@/lib/types";

vi.mock("@/lib/server/kie", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/server/kie")>()),
  startSunoTask: vi.fn(),
  getSunoTask: vi.fn(),
  getTimestampedLyrics: vi.fn(async () => ({ words: [], waveform: [] })),
}));

const config: SongConfig = {
  mode: "studio",
  title: "Maman Awa",
  lyrics: "[Couplet 1]\nTu m'as porté dans tes bras pleins d'amour",
  language: "fr",
  voice: "female",
  emotion: "nostalgic",
  styles: ["afropop"],
  instruments: [],
};

let lib: typeof import("@/lib/server/songs");
let store: typeof import("@/lib/server/store");
let kie: typeof import("@/lib/server/kie");

const track = (id: string) => ({ id, audioUrl: `https://cdn.test/${id}.mp3`, imageUrl: `https://cdn.test/${id}.jpg`, duration: 180 });
const done = (...ids: string[]) => ({ taskId: "t", status: "SUCCESS", response: { sunoData: ids.map(track) } }) as unknown as KieRecordInfo;

async function paidSong() {
  const song = await lib.createSong(config);
  await store.songs.update(song.id, (s) => {
    s.payment = { status: "paid", plan: "essentiel" };
  });
  return song.id;
}

beforeAll(async () => {
  vi.stubEnv("DATA_DIR", fs.mkdtempSync(path.join(os.tmpdir(), "dbmelo-test-")));
  vi.stubEnv("KIE_API_KEY", "cle-de-test");
  lib = await import("@/lib/server/songs");
  store = await import("@/lib/server/store");
  kie = await import("@/lib/server/kie");
});

beforeEach(() => {
  vi.mocked(kie.startSunoTask).mockReset();
  vi.mocked(kie.getSunoTask).mockReset();
  vi.stubEnv("VERSIONS_MODE", "");
});

describe("versions d'une chanson", () => {
  it("par défaut, une seule composition Suno sert les deux versions", async () => {
    vi.mocked(kie.startSunoTask).mockResolvedValue("tache-1");
    vi.mocked(kie.getSunoTask).mockResolvedValue(done("prise-0", "prise-1"));
    const id = await paidSong();

    const started = await lib.startGeneration(id, "http://localhost");
    expect(kie.startSunoTask).toHaveBeenCalledTimes(1);
    expect(started.variants.A).toMatchObject({ taskId: "tache-1", mood: "take", take: 0 });
    expect(started.variants.B).toMatchObject({ taskId: "tache-1", mood: "take", take: 1 });

    const song = (await lib.refreshSong(id, { force: true }))!;
    expect(kie.getSunoTask).toHaveBeenCalledTimes(1);
    expect(song.variants.A.tracks.map((t) => t.audioId)).toEqual(["prise-0"]);
    expect(song.variants.B.tracks.map((t) => t.audioId)).toEqual(["prise-1"]);
    expect(song.generation.status).toBe("ready");
    expect(lib.toPublicSong(song).variants.B).toMatchObject({ mood: "take", takes: 1 });
  });

  it("garde la chanson si Suno ne livre qu'une prise", async () => {
    vi.mocked(kie.startSunoTask).mockResolvedValue("tache-2");
    vi.mocked(kie.getSunoTask).mockResolvedValue(done("seule"));
    const id = await paidSong();
    await lib.startGeneration(id, "http://localhost");

    const song = (await lib.refreshSong(id, { force: true }))!;
    expect(song.variants.A.status).toBe("SUCCESS");
    expect(song.variants.B.status).toBe("GENERATE_AUDIO_FAILED");
    expect(song.generation.status).toBe("ready");
  });

  it("VERSIONS_MODE=styles compose une version rythmée et une acoustique", async () => {
    vi.stubEnv("VERSIONS_MODE", "styles");
    vi.mocked(kie.startSunoTask).mockResolvedValueOnce("tache-A").mockResolvedValueOnce("tache-B");
    const id = await paidSong();

    const started = await lib.startGeneration(id, "http://localhost");
    expect(kie.startSunoTask).toHaveBeenCalledTimes(2);
    const styles = vi.mocked(kie.startSunoTask).mock.calls.map(([r]) => r.style);
    expect(styles[0]).toContain("upbeat");
    expect(styles[1]).toContain("acoustic");
    expect(started.variants.A).toMatchObject({ taskId: "tache-A", mood: "rhythmic" });
    expect(started.variants.B).toMatchObject({ taskId: "tache-B", mood: "acoustic" });
  });
});

describe("modèle Suno", () => {
  it("compose en V6 et repasse en V5 si Kie refuse le modèle", async () => {
    vi.mocked(kie.startSunoTask).mockRejectedValueOnce(new kie.KieError("model not supported", 422)).mockResolvedValueOnce("tache-v5");
    const id = await paidSong();
    const started = await lib.startGeneration(id, "http://localhost");
    expect(vi.mocked(kie.startSunoTask).mock.calls.map(([r]) => r.model)).toEqual(["V6", "V5"]);
    expect(started.variants.A.taskId).toBe("tache-v5");
  });

  it("ne change pas de modèle pour un crédit insuffisant", async () => {
    vi.mocked(kie.startSunoTask).mockRejectedValue(new kie.KieError("Crédit Kie.ai insuffisant", 402));
    const id = await paidSong();
    const started = await lib.startGeneration(id, "http://localhost");
    expect(kie.startSunoTask).toHaveBeenCalledTimes(1);
    expect(started.generation.status).toBe("failed");
  });

  it("relance une chanson échouée avec le modèle de secours", async () => {
    vi.mocked(kie.startSunoTask).mockResolvedValue("tache-relance");
    const id = await paidSong();
    await store.songs.update(id, (s) => {
      s.generation = { status: "failed", attempts: 1 };
    });
    await lib.startGeneration(id, "http://localhost");
    expect(vi.mocked(kie.startSunoTask).mock.calls[0][0].model).toBe("V5");
  });
});
