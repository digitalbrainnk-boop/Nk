// Alerte e-mail au propriétaire quand le crédit Kie baisse, ou qu'une chanson payée est refusée faute de crédit.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { KieRecordInfo, SongConfig } from "@/lib/types";

vi.mock("@/lib/server/kie", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/server/kie")>()),
  getCredit: vi.fn(),
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

let alerts: typeof import("@/lib/server/alerts");
let lib: typeof import("@/lib/server/songs");
let store: typeof import("@/lib/server/store");
let kie: typeof import("@/lib/server/kie");

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "dbmelo-alertes-"));
const mailLog = path.join(dir, "mails.txt");
const mails = () => (fs.existsSync(mailLog) ? fs.readFileSync(mailLog, "utf8").split("\n=====\n").filter(Boolean) : []);
const subject = (mail: string) => {
  const b64 = mail.match(/^Subject: =\?UTF-8\?B\?(.+)\?=$/m)?.[1] ?? "";
  return Buffer.from(b64, "base64").toString("utf8");
};

// Horloge simulée, toujours croissante d'un test à l'autre (la lecture du crédit est espacée d'une minute).
let clock = Date.UTC(2026, 9, 19, 12);
const later = (ms: number) => (clock += ms);

beforeAll(async () => {
  const sendmail = path.join(dir, "sendmail");
  fs.writeFileSync(sendmail, `#!/bin/sh\necho "ARGS $*" >> "${mailLog}"\ncat >> "${mailLog}"\nprintf '\\n=====\\n' >> "${mailLog}"\n`, { mode: 0o755 });
  vi.stubEnv("DATA_DIR", path.join(dir, "data"));
  vi.stubEnv("KIE_API_KEY", "cle-de-test");
  vi.stubEnv("SENDMAIL_PATH", sendmail);
  vi.stubEnv("PUBLIC_BASE_URL", "https://www.dbmelo.com");
  alerts = await import("@/lib/server/alerts");
  lib = await import("@/lib/server/songs");
  store = await import("@/lib/server/store");
  kie = await import("@/lib/server/kie");
});

beforeEach(() => {
  later(24 * 3600_000);
  vi.spyOn(Date, "now").mockImplementation(() => clock);
  vi.mocked(kie.getCredit).mockReset();
  vi.mocked(kie.startSunoTask).mockReset();
  vi.mocked(kie.getSunoTask).mockReset();
  vi.stubEnv("KIE_CREDIT_ALERT", "");
  fs.rmSync(mailLog, { force: true });
  fs.rmSync(path.join(dir, "data", "db", "alerts"), { recursive: true, force: true });
});

afterEach(() => {
  vi.mocked(Date.now).mockRestore();
});

async function paidSong() {
  const song = await lib.createSong(config);
  await store.songs.update(song.id, (s) => {
    s.payment = { status: "paid", plan: "essentiel" };
  });
  return song.id;
}

describe("alerte crédit Kie", () => {
  it("prévient une fois sous 50 crédits, rappelle chaque jour, et se réarme après une recharge", async () => {
    vi.mocked(kie.getCredit).mockResolvedValue(120);
    await alerts.checkKieCredit({ force: true });
    expect(mails()).toHaveLength(0);

    vi.mocked(kie.getCredit).mockResolvedValue(48.5);
    await alerts.checkKieCredit({ force: true });
    expect(mails()).toHaveLength(1);
    expect(subject(mails()[0])).toBe("⚠️ DB.Mélo : plus que 48,5 crédits Kie");
    expect(mails()[0]).toContain("To: dbmelox@gmail.com");
    expect(mails()[0]).toContain("ARGS -t -i -f alertes@dbmelo.com");
    expect(mails()[0]).toContain("encore 4 chansons environ");

    // Toujours bas quelques heures plus tard : pas de nouvel e-mail.
    later(5 * 3600_000);
    vi.mocked(kie.getCredit).mockResolvedValue(36);
    await alerts.checkKieCredit({ force: true });
    expect(mails()).toHaveLength(1);

    // Un jour après la première alerte : rappel.
    later(20 * 3600_000);
    await alerts.checkKieCredit({ force: true });
    expect(mails()).toHaveLength(2);

    // Rechargé, puis de nouveau sous le seuil : nouvelle alerte tout de suite.
    later(3600_000);
    vi.mocked(kie.getCredit).mockResolvedValue(500);
    await alerts.checkKieCredit({ force: true });
    later(3600_000);
    vi.mocked(kie.getCredit).mockResolvedValue(49);
    await alerts.checkKieCredit({ force: true });
    expect(mails()).toHaveLength(3);
  });

  it("suit le seuil réglé, et se tait à 0", async () => {
    vi.stubEnv("KIE_CREDIT_ALERT", "100");
    vi.mocked(kie.getCredit).mockResolvedValue(80);
    await alerts.checkKieCredit({ force: true });
    expect(mails()).toHaveLength(1);
    expect(mails()[0]).toContain("alerte réglée sous 100");

    vi.stubEnv("KIE_CREDIT_ALERT", "0");
    vi.mocked(kie.getCredit).mockClear();
    await alerts.checkKieCredit({ force: true });
    expect(kie.getCredit).not.toHaveBeenCalled();
  });

  it("relit le crédit au plus une fois par minute", async () => {
    vi.mocked(kie.getCredit).mockResolvedValue(300);
    later(2 * 60_000);
    await alerts.checkKieCredit();
    await alerts.checkKieCredit();
    expect(kie.getCredit).toHaveBeenCalledTimes(1);
    later(61_000);
    await alerts.checkKieCredit();
    expect(kie.getCredit).toHaveBeenCalledTimes(2);
  });

  it("relit le crédit après chaque lancement et chaque chanson livrée", async () => {
    vi.mocked(kie.getCredit).mockResolvedValue(30);
    vi.mocked(kie.startSunoTask).mockResolvedValue("tache-1");
    const id = await paidSong();

    later(2 * 60_000);
    await lib.startGeneration(id, "http://localhost");
    await vi.waitFor(() => expect(mails()).toHaveLength(1));

    later(2 * 60_000);
    vi.mocked(kie.getSunoTask).mockResolvedValue({
      taskId: "tache-1",
      status: "SUCCESS",
      response: { sunoData: ["a", "b"].map((x) => ({ id: x, audioUrl: `https://cdn.test/${x}.mp3`, duration: 180 })) },
    } as unknown as KieRecordInfo);
    const song = (await lib.refreshSong(id, { force: true }))!;
    expect(song.generation.status).toBe("ready");
    await vi.waitFor(() => expect(kie.getCredit).toHaveBeenCalledTimes(2));
    // Lecture terminée (rien ne doit déborder sur le test suivant) ; déjà prévenu : pas de second e-mail.
    await vi.waitFor(async () => expect((await store.alerts.get("kie-credit"))?.checkedAt).toBe(clock));
    expect(mails()).toHaveLength(1);
  });

  it("alerte tout de suite quand une chanson payée est refusée faute de crédit, sans le dire au client", async () => {
    vi.mocked(kie.startSunoTask).mockRejectedValue(new kie.KieError("Crédit Kie.ai insuffisant : recharge ton compte Kie.", 402));
    const id = await paidSong();

    const song = await lib.startGeneration(id, "http://localhost");
    expect(song.generation.status).toBe("failed");
    expect(song.generation.error).toContain("votre paiement est conservé");
    expect(song.generation.error).not.toContain("Kie");

    await vi.waitFor(() => expect(mails()).toHaveLength(1));
    expect(subject(mails()[0])).toBe("⛔ DB.Mélo : crédit Kie épuisé, une chanson payée attend");
    expect(mails()[0]).toContain(`https://www.dbmelo.com/chanson/${id}`);
    expect(mails()[0]).toContain("« Maman Awa »");
  });

  it("sans sendmail, l'alerte est notée dans le journal sans rien casser", async () => {
    vi.stubEnv("SENDMAIL_PATH", path.join(dir, "absent"));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.mocked(kie.getCredit).mockResolvedValue(10);
    await alerts.checkKieCredit({ force: true });
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("pas de sendmail"));
    warn.mockRestore();
    vi.stubEnv("SENDMAIL_PATH", path.join(dir, "sendmail"));
  });
});
