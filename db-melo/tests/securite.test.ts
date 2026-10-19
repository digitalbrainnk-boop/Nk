// Protections contre les abus : adresse du visiteur non falsifiable, plafonds globaux,
// taille des requêtes bornée, erreurs internes non divulguées.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

let rl: typeof import("@/lib/server/rate-limit");
let http: typeof import("@/lib/server/http");

beforeAll(async () => {
  vi.stubEnv("DATA_DIR", fs.mkdtempSync(path.join(os.tmpdir(), "dbmelo-securite-")));
  rl = await import("@/lib/server/rate-limit");
  http = await import("@/lib/server/http");
});

afterEach(() => {
  vi.stubEnv("TRUSTED_PROXY_HOPS", "");
  vi.stubEnv("KIE_API_KEY", "");
  vi.unstubAllGlobals();
});

const req = (headers: Record<string, string>, body?: BodyInit) => new Request("http://localhost/api/x", { method: "POST", headers, body });

describe("adresse du visiteur", () => {
  it("lit l'adresse ajoutée par le proxy, pas celle inventée par le navigateur", () => {
    expect(rl.clientIp(req({ "x-forwarded-for": "6.6.6.6, 41.203.10.5" }))).toBe("41.203.10.5");
    expect(rl.clientIp(req({ "x-forwarded-for": "41.203.10.5" }))).toBe("41.203.10.5");
  });

  it("saute les proxys de confiance déclarés", () => {
    vi.stubEnv("TRUSTED_PROXY_HOPS", "2");
    expect(rl.clientIp(req({ "x-forwarded-for": "6.6.6.6, 41.203.10.5, 52.1.1.1" }))).toBe("41.203.10.5");
  });

  it("écarte les adresses internes (le serveur lui-même, Next.js derrière Apache)", () => {
    expect(rl.clientIp(req({ "x-forwarded-for": "127.0.0.1" }))).toBe("local");
    expect(rl.clientIp(req({ "x-forwarded-for": "::ffff:127.0.0.1" }))).toBe("local");
    expect(rl.clientIp(req({ "x-forwarded-for": "6.6.6.6, 41.203.10.5, 10.0.0.2" }))).toBe("41.203.10.5");
    expect(rl.clientIp(req({ "x-forwarded-for": "::ffff:41.203.10.5" }))).toBe("41.203.10.5");
  });

  it("se replie sur x-real-ip, puis sur une valeur fixe", () => {
    expect(rl.clientIp(req({ "x-real-ip": "41.1.1.1" }))).toBe("41.1.1.1");
    expect(rl.clientIp(req({}))).toBe("local");
  });

  it("ne limite pas par visiteur quand l'hébergeur ne transmet pas l'adresse (tous comptés comme un seul)", () => {
    for (let i = 0; i < 5; i++) expect(rl.visitorLimit(req({}), "inconnu", 2).ok).toBe(true);
    const connu = req({ "x-forwarded-for": "41.9.9.9" });
    expect(rl.visitorLimit(connu, "connu", 2).ok).toBe(true);
    expect(rl.visitorLimit(connu, "connu", 2).ok).toBe(true);
    expect(rl.visitorLimit(connu, "connu", 2).ok).toBe(false);
  });

  it("le plafond global s'applique quelle que soit l'adresse", () => {
    for (let i = 0; i < 3; i++) expect(rl.globalBudget("essai", 3)).toBe(true);
    expect(rl.globalBudget("essai", 3)).toBe(false);
  });
});

describe("taille des requêtes", () => {
  it("refuse un corps JSON géant sans le charger en mémoire", async () => {
    const big = JSON.stringify({ x: "a".repeat(300 * 1024) });
    await expect(http.readJson(req({ "content-type": "application/json" }, big))).rejects.toMatchObject({ status: 413 });
    await expect(http.readJson(req({ "content-length": String(10 * 1024 * 1024) }, "{}"))).rejects.toMatchObject({ status: 413 });
  });

  it("lit normalement un petit corps JSON, et refuse un JSON invalide", async () => {
    expect(await http.readJson(req({}, JSON.stringify({ ok: 1 })))).toEqual({ ok: 1 });
    await expect(http.readJson(req({}, "{pas du json"))).rejects.toMatchObject({ status: 400 });
  });

  it("refuse un envoi de fichier sans taille ou trop lourd, avant toute lecture", async () => {
    const { POST } = await import("@/app/api/uploads/route");
    const sansTaille = await POST(new Request("http://localhost/api/uploads", { method: "POST", headers: { "x-forwarded-for": "41.0.0.1" } }));
    expect(sansTaille.status).toBe(411);
    const enorme = await POST(new Request("http://localhost/api/uploads", { method: "POST", headers: { "x-forwarded-for": "41.0.0.2", "content-length": String(500 * 1024 * 1024) } }));
    expect(enorme.status).toBe(413);
  });
});

describe("erreurs", () => {
  it("ne montre pas au visiteur le détail d'une erreur interne", async () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const res = http.apiError(new Error("ENOENT: /home/noya2336/dbmelo-donnees/db/songs/x.json"));
    const body = (await res.json()) as { error: string };
    expect(res.status).toBe(500);
    expect(body.error).not.toMatch(/home|ENOENT|dbmelo-donnees/);
    expect(err).toHaveBeenCalled();
    err.mockRestore();
  });

  it("garde les messages prévus pour le visiteur", async () => {
    const res = http.apiError(new http.HttpError(402, "La chanson s'écoute après le paiement."));
    expect(res.status).toBe(402);
    expect(((await res.json()) as { error: string }).error).toBe("La chanson s'écoute après le paiement.");
  });
});

describe("parolier IA au-delà du plafond horaire", () => {
  it("propose un modèle de paroles sans appel payant", async () => {
    vi.stubEnv("KIE_API_KEY", "cle-de-test");
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const { generateLyrics } = await import("@/lib/server/lyrics");
    const r = await generateLyrics(
      { brief: { recipientName: "Awa", nicknames: "", senderName: "Moussa", occasion: "mothers_day", anecdotes: "Elle chante en cuisinant." }, voice: "female", styles: [], language: "fr" } as never,
      { ai: false },
    );
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(r.lyrics.length).toBeGreaterThan(40);
    expect(r.warning).toMatch(/très demandé/);
  });
});
