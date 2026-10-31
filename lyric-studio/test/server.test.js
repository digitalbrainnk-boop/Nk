// API du studio, testée sur un vrai serveur (services d'IA simulés).
import { test, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

const DATA = fs.mkdtempSync(path.join(os.tmpdir(), "lyric-studio-"));
process.env.DATA_DIR = DATA;
process.env.KIE_POLL_MS = "5";
for (const k of ["TRANSCRIPTION_API_KEY", "ELEVENLABS_API_KEY", "KIE_API_KEY", "ADMIN_EMAIL"]) process.env[k] = "";
process.env.ANDROID_PACKAGE = "com.exemple.lyricstudio";
process.env.ANDROID_SHA256 = "AA:BB";
process.env.ANDROID_APP_URL = "";
const { createApp } = await import("../src/app.js");
const { encodeWav } = await import("../public/js/core/dsp.js");
const { normalizeAlignedWords, findStemUrls } = await import("../src/suno.js");
const { hashPassword, checkPassword } = await import("../src/accounts.js");

const realFetch = globalThis.fetch;
const outside = []; // appels vers les services extérieurs
let mock = async () => new Response("{}", { status: 500 });
globalThis.fetch = (url, opts) => {
  if (String(url).startsWith("http://127.0.0.1")) return realFetch(url, opts);
  outside.push({ url: String(url), opts });
  return mock(String(url), opts);
};

const server = await new Promise((resolve) => {
  const s = createApp().listen(0, "127.0.0.1", () => resolve(s));
});
const BASE = `http://127.0.0.1:${server.address().port}`;
after(() => {
  server.close();
  fs.rmSync(DATA, { recursive: true, force: true });
});

/** Un navigateur : garde son cookie de session. */
function client() {
  let cookie = "";
  const call = async (p, { method = "GET", json, form, headers = {} } = {}) => {
    const h = { ...headers };
    if (cookie) h.cookie = cookie;
    let body;
    if (json !== undefined) {
      h["content-type"] = "application/json";
      body = JSON.stringify(json);
    } else if (form) body = form;
    const r = await realFetch(`${BASE}${p}`, { method, headers: h, body });
    const set = r.headers.get("set-cookie");
    if (set) cookie = set.split(";")[0].endsWith("=") ? "" : set.split(";")[0];
    return r;
  };
  call.cookie = () => cookie;
  call.json = async (p, opts) => {
    const r = await call(p, opts);
    const data = await r.json().catch(() => null);
    return { status: r.status, data };
  };
  return call;
}

const sine = (sec = 1, sr = 8000) => {
  const x = new Float32Array(sec * sr);
  for (let i = 0; i < x.length; i++) x[i] = 0.3 * Math.sin((2 * Math.PI * 440 * i) / sr);
  return new Uint8Array(encodeWav([x, x], sr));
};

async function newProject(c, fields = {}) {
  const form = new FormData();
  form.append("file", new Blob([sine()], { type: "audio/wav" }), "Ma Chanson.wav");
  for (const [k, v] of Object.entries(fields)) form.append(k, v);
  const r = await c.json("/api/projects", { method: "POST", form });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  return r.data;
}

const boss = client();
const alice = client();
const bob = client();

test("mots de passe : empreinte scrypt vérifiée", () => {
  const h = hashPassword("Bonjour-123");
  assert.match(h, /^scrypt\$/);
  assert.ok(checkPassword("Bonjour-123", h));
  assert.ok(!checkPassword("bonjour-123", h));
});

test("inscription : le premier compte est administrateur, les suivants clients gratuits", async () => {
  assert.equal((await boss.json("/api/me")).status, 401);
  const refused = await boss.json("/api/auth/signup", { method: "POST", json: { email: "boss@test.fr", password: "Admin-Pass-1" } });
  assert.match(refused.data.error, /conditions/);
  const a = await boss.json("/api/auth/signup", {
    method: "POST",
    json: { email: "Boss@Test.fr", password: "Admin-Pass-1", name: "Patron", accept: true },
  });
  assert.equal(a.status, 200);
  assert.equal(a.data.user.role, "admin");
  assert.equal(a.data.user.email, "boss@test.fr");
  const b = await alice.json("/api/auth/signup", {
    method: "POST",
    json: { email: "alice@test.fr", password: "Alice-Pass-1", accept: true },
  });
  assert.equal(b.data.user.role, "user");
  assert.equal(b.data.plan.id, "free");
  assert.equal(b.data.plan.watermark, true);
  const dup = await bob.json("/api/auth/signup", {
    method: "POST",
    json: { email: "alice@test.fr", password: "Autre-Pass-1", accept: true },
  });
  assert.equal(dup.status, 409);
  const weak = await bob.json("/api/auth/signup", { method: "POST", json: { email: "bob@test.fr", password: "court", accept: true } });
  assert.equal(weak.status, 400);
  assert.equal(
    (await bob.json("/api/auth/signup", { method: "POST", json: { email: "bob@test.fr", password: "Bob-Pass-12", accept: true } })).status,
    200,
  );
});

test("connexion, déconnexion, mauvais mot de passe", async () => {
  const c = client();
  assert.equal(
    (await c.json("/api/auth/login", { method: "POST", json: { email: "alice@test.fr", password: "faux-mot-de-passe" } })).status,
    401,
  );
  const ok = await c.json("/api/auth/login", { method: "POST", json: { email: "ALICE@test.fr", password: "Alice-Pass-1" } });
  assert.equal(ok.status, 200);
  assert.equal((await c.json("/api/me")).data.user.email, "alice@test.fr");
  await c("/api/auth/logout", { method: "POST" });
  assert.equal((await c.json("/api/me")).status, 401);
});

test("projets : création, lecture, enregistrement protégé, liste", async () => {
  const p = await newProject(alice, { lyrics: "[Refrain]\nA: Bonjour toi\nB: Salut", mode: "karaoke" });
  assert.equal(p.title, "Ma Chanson");
  assert.equal(p.lines.length, 2);
  assert.equal(p.lines[1].singer, 1);
  assert.equal(p.style.mode, "karaoke");
  const got = (await alice.json(`/api/projects/${p.id}`)).data;
  const r = await alice.json(`/api/projects/${p.id}`, {
    method: "PUT",
    json: { ...got, title: "Nouveau titre", owner: "pirate", media: { audio: { file: "../../etc/passwd" } } },
  });
  assert.equal(r.status, 200);
  const saved = (await alice.json(`/api/projects/${p.id}`)).data;
  assert.equal(saved.title, "Nouveau titre");
  assert.equal(saved.media.audio.file, p.media.audio.file);
  assert.equal(saved.owner, p.owner);
  const list = (await alice.json("/api/projects")).data;
  assert.equal(list.length, 1);
  assert.equal(list[0].title, "Nouveau titre");
  assert.ok(list[0].size > 0, "taille comptée");
});

test("chaque client ne voit que ses projets et ses fichiers", async () => {
  const p = (await alice.json("/api/projects")).data[0];
  const full = (await alice.json(`/api/projects/${p.id}`)).data;
  assert.equal((await bob.json("/api/projects")).data.length, 0);
  assert.equal((await bob.json(`/api/projects/${p.id}`)).status, 404);
  assert.equal((await bob(`/media/${p.id}/${full.media.audio.file}`)).status, 404);
  assert.equal((await bob.json(`/api/projects/${p.id}`, { method: "PUT", json: { title: "x" } })).status, 404);
  assert.equal((await bob.json(`/api/projects/${p.id}`, { method: "DELETE" })).status, 404);
  assert.equal((await client()(`/media/${p.id}/${full.media.audio.file}`)).status, 401);
  // L'administrateur peut aider un client.
  assert.equal((await boss.json(`/api/projects/${p.id}`)).status, 200);
});

test("formats refusés, chemins piégés, lecture par morceaux", async () => {
  const form = new FormData();
  form.append("file", new Blob(["<html>"], { type: "text/html" }), "page.html");
  assert.equal((await alice.json("/api/projects", { method: "POST", form })).status, 400);
  assert.equal((await alice.json("/api/projects/..%2F..")).status, 404);
  const p = (await alice.json("/api/projects")).data[0];
  const full = (await alice.json(`/api/projects/${p.id}`)).data;
  assert.equal((await alice(`/media/${p.id}/..%2Fsettings.json`)).status, 404);
  assert.equal((await alice(`/media/${p.id}/project.json`)).status, 404);
  const r = await alice(`/media/${p.id}/${full.media.audio.file}`, { headers: { Range: "bytes=0-99" } });
  assert.equal(r.status, 206);
  assert.equal((await r.arrayBuffer()).byteLength, 100);
  const dl = await alice(`/media/${p.id}/${full.media.audio.file}?dl=1`);
  assert.match(dl.headers.get("content-disposition"), /attachment; filename="Nouveau titre.wav"/);
});

test("formule gratuite : limites de projets, d'IA, de qualité ; filigrane", async () => {
  const settings = (await boss.json("/api/admin/settings")).data;
  const plans = structuredClone(settings.plans);
  plans.free.maxProjects = 1;
  plans.free.aiMinutes = 0;
  await boss.json("/api/admin/settings", { method: "PUT", json: { plans } });
  const form = new FormData();
  form.append("file", new Blob([sine()]), "deux.wav");
  const r = await alice.json("/api/projects", { method: "POST", form });
  assert.equal(r.status, 402);
  assert.equal(r.data.upgrade, true);
  const p = (await alice.json("/api/projects")).data[0];
  const t = new FormData();
  t.append("audio", new Blob([sine()]), "voix.wav");
  const ai = await alice.json(`/api/projects/${p.id}/transcribe`, { method: "POST", form: t });
  assert.equal(ai.status, 402);
  assert.match(ai.data.error, /Minutes d'IA/);
  assert.equal((await alice.json(`/api/projects/${p.id}/export-start`, { method: "POST", json: { resolution: "1080p" } })).status, 402);
  const ok = await alice.json(`/api/projects/${p.id}/export-start`, { method: "POST", json: { resolution: "720p", duration: 30 } });
  assert.equal(ok.status, 200);
  assert.equal(ok.data.watermark, "Fait avec Lyric Studio");
  assert.equal((await alice.json("/api/me")).data.usage.exports, 1);
  const caps = (await alice.json("/api/capabilities")).data;
  assert.equal(caps.maxResolution, "720p");
  assert.equal(caps.watermark, "Fait avec Lyric Studio");
  assert.equal(caps.demucs, false);
  assert.equal((await alice.json(`/api/projects/${p.id}/stems`, { method: "POST", json: { method: "demucs" } })).status, 402);
  plans.free.maxProjects = 3;
  plans.free.aiMinutes = 10;
  await boss.json("/api/admin/settings", { method: "PUT", json: { plans } });
});

test("abonnement : demande du client, validation par l'administrateur, formule Pro active", async () => {
  assert.equal((await alice.json("/api/me/requests", { method: "POST", json: { plan: "inconnue" } })).status, 400);
  const r = await alice.json("/api/me/requests", {
    method: "POST",
    json: { plan: "pro", months: 2, reference: "OM-123456", note: "Payé par Orange Money" },
  });
  assert.equal(r.status, 200);
  assert.equal((await alice.json("/api/admin/requests")).status, 403, "réservé à l'administrateur");
  const pending = (await boss.json("/api/admin/requests")).data;
  assert.equal(pending.length, 1);
  assert.equal(pending[0].email, "alice@test.fr");
  assert.equal(pending[0].reference, "OM-123456");
  const u = (await boss.json(`/api/admin/requests/${pending[0].id}/approve`, { method: "POST" })).data;
  assert.equal(u.plan, "pro");
  assert.ok(u.plan_until > Date.now() + 59 * 86400_000);
  const me = (await alice.json("/api/me")).data;
  assert.equal(me.plan.id, "pro");
  const p = (await alice.json("/api/projects")).data[0];
  const ok = await alice.json(`/api/projects/${p.id}/export-start`, { method: "POST", json: { resolution: "1080p" } });
  assert.equal(ok.status, 200);
  assert.equal(ok.data.watermark, null, "plus de filigrane");
  assert.equal((await alice.json("/api/me/requests")).data[0].status, "approved");
  // Abonnement expiré -> retour à la formule gratuite.
  const id = me.user.id;
  await boss.json(`/api/admin/users/${id}`, { method: "PATCH", json: { plan_until: "2020-01-01" } });
  assert.equal((await alice.json("/api/me")).data.plan.id, "free");
  await boss.json(`/api/admin/users/${id}`, { method: "PATCH", json: { plan: "pro", plan_until: "" } });
  assert.equal((await alice.json("/api/me")).data.plan.id, "pro");
});

test("administration : statistiques, comptes, mot de passe provisoire, suspension, réglages", async () => {
  assert.equal((await bob.json("/api/admin/users")).status, 403);
  const stats = (await boss.json("/api/admin/stats")).data;
  assert.equal(stats.users, 3);
  assert.ok(stats.projects >= 1);
  const users = (await boss.json("/api/admin/users?q=bob")).data;
  assert.equal(users.length, 1);
  const bobId = users[0].id;
  const { password } = (await boss.json(`/api/admin/users/${bobId}/password`, { method: "POST" })).data;
  assert.equal((await bob.json("/api/me")).status, 401, "anciennes sessions fermées");
  assert.equal((await bob.json("/api/auth/login", { method: "POST", json: { email: "bob@test.fr", password } })).status, 200);
  await boss.json(`/api/admin/users/${bobId}`, { method: "PATCH", json: { disabled: true } });
  assert.equal((await bob.json("/api/me")).status, 401);
  const refused = await bob.json("/api/auth/login", { method: "POST", json: { email: "bob@test.fr", password } });
  assert.equal(refused.status, 403);
  await boss.json(`/api/admin/users/${bobId}`, { method: "PATCH", json: { disabled: false } });
  assert.equal((await bob.json("/api/auth/login", { method: "POST", json: { email: "bob@test.fr", password } })).status, 200);
  const self = (await boss.json("/api/me")).data.user.id;
  assert.equal((await boss.json(`/api/admin/users/${self}`, { method: "PATCH", json: { role: "user" } })).status, 400);
  const s = (
    await boss.json("/api/admin/settings", {
      method: "PUT",
      json: { transcription_api_key: "gsk_secret_1234", app_name: "Karaoké Pro", support_whatsapp: "+225000000" },
    })
  ).data;
  assert.equal(s.transcription_api_key, "••••1234");
  await boss.json("/api/admin/settings", { method: "PUT", json: { transcription_api_key: "••••1234" } });
  assert.equal((await boss.json("/api/admin/settings")).data.transcription_api_key, "••••1234", "clé masquée non écrasée");
  const pub = (await client().json("/api/public/config")).data;
  assert.equal(pub.app_name, "Karaoké Pro");
  assert.equal(pub.support_whatsapp, "+225000000");
  assert.equal(JSON.stringify(pub).includes("gsk_"), false, "aucune clé dans la config publique");
  assert.ok(pub.plans.free && pub.plans.pro);
  await boss.json("/api/admin/settings", { method: "PUT", json: { transcription_api_key: "", app_name: "Lyric Studio" } });
});

test("mes styles : enregistrer, lister, supprimer (propres à chaque client)", async () => {
  const r = await alice.json("/api/presets", { method: "POST", json: { name: "Doré", style: { colors: { sung: "#ffcc00" } } } });
  assert.equal(r.status, 200);
  const list = (await alice.json("/api/presets")).data;
  assert.equal(list[0].name, "Doré");
  assert.equal(list[0].style.colors.sung, "#ffcc00");
  assert.equal(list[0].style.font.family, "Montserrat", "style complété");
  assert.equal((await bob.json("/api/presets")).data.length, 0);
  await bob.json(`/api/presets/${list[0].id}`, { method: "DELETE" });
  assert.equal((await alice.json("/api/presets")).data.length, 1, "un autre client ne peut pas supprimer");
  await alice.json(`/api/presets/${list[0].id}`, { method: "DELETE" });
  assert.equal((await alice.json("/api/presets")).data.length, 0);
});

test("transcription mot par mot : Whisper (Groq/OpenAI) puis ElevenLabs, minutes comptées", async () => {
  const p = (await alice.json("/api/projects")).data[0];
  const send = (fields) => {
    const form = new FormData();
    form.append("audio", new Blob([sine(2, 16000).slice(0, 44 + 64000)], { type: "audio/wav" }), "voix.wav");
    for (const [k, v] of Object.entries(fields)) form.append(k, v);
    return alice.json(`/api/projects/${p.id}/transcribe`, { method: "POST", form });
  };
  const none = await send({});
  assert.equal(none.status, 400);
  assert.match(none.data.error, /Aucun service de transcription/);
  await boss.json("/api/admin/settings", { method: "PUT", json: { transcription_api_key: "gsk_1" } });
  outside.length = 0;
  mock = async () =>
    Response.json({
      text: "Bonjour toi",
      language: "french",
      words: [
        { word: " Bonjour", start: 1.2, end: 1.6 },
        { word: "toi", start: 1.7, end: 2 },
      ],
    });
  const before = (await alice.json("/api/me")).data.usage.ai_seconds;
  const w = (await send({ prompt: "Bonjour toi", language: "fr" })).data;
  assert.deepEqual(w.words, [
    { text: "Bonjour", start: 1.2, end: 1.6 },
    { text: "toi", start: 1.7, end: 2 },
  ]);
  assert.ok(Math.abs((await alice.json("/api/me")).data.usage.ai_seconds - before - 2) < 0.01, "2 s d'IA comptées");
  const body = outside[0].opts.body;
  assert.equal(outside[0].url, "https://api.groq.com/openai/v1/audio/transcriptions");
  assert.equal(outside[0].opts.headers.Authorization, "Bearer gsk_1");
  assert.deepEqual(body.getAll("timestamp_granularities[]"), ["word", "segment"]);
  assert.equal(body.get("response_format"), "verbose_json");
  assert.equal(body.get("prompt"), "Bonjour toi");

  await boss.json("/api/admin/settings", { method: "PUT", json: { elevenlabs_api_key: "el_1" } });
  outside.length = 0;
  mock = async () =>
    Response.json({
      language_code: "fra",
      text: "Salut",
      words: [
        { text: "Salut", start: 0.5, end: 0.9, type: "word" },
        { text: " ", start: 0.9, end: 1, type: "spacing" },
      ],
    });
  const e = (await send({ provider: "elevenlabs" })).data;
  assert.equal(e.provider, "elevenlabs");
  assert.deepEqual(e.words, [{ text: "Salut", start: 0.5, end: 0.9 }]);
  assert.equal(outside[0].opts.headers["xi-api-key"], "el_1");
  mock = async () => Response.json({ error: { message: "Invalid API Key" } }, { status: 401 });
  assert.match((await send({ provider: "whisper" })).data.error, /clé refusée/);
  await boss.json("/api/admin/settings", { method: "PUT", json: { transcription_api_key: "", elevenlabs_api_key: "" } });
});

test("paroles horodatées de Suno : lignes, couplets, repères retirés", () => {
  const words = normalizeAlignedWords([
    { word: "[Verse]\nDans ", startS: 1, endS: 1.3, success: true },
    { word: "la ", startS: 1.3, endS: 1.5 },
    { word: "nuit\n", startS: 1.5, endS: 2 },
    { word: "je ", startS: 2.2, endS: 2.4 },
    { word: "rêve\n\n[Chorus]\n", startS: 2.4, endS: 3 },
    { word: "Oh oh", startS: 4, endS: 5 },
  ]);
  assert.deepEqual(
    words.map((w) => [w.text, w.br || 0]),
    [
      ["Dans", 0],
      ["la", 0],
      ["nuit", 0],
      ["je", 1],
      ["rêve", 0],
      ["Oh", 2],
      ["oh", 0],
    ],
  );
  assert.deepEqual([words[5].start, words[5].end, words[6].start], [4, 4.5, 4.5]);
  assert.deepEqual(
    findStemUrls({ response: { vocal_url: "https://a/v.mp3", instrumental_url: "https://a/i.mp3", originUrl: "https://a/o.mp3" } }),
    {
      vocals: "https://a/v.mp3",
      instrumental: "https://a/i.mp3",
    },
  );
});

test("import Suno : réservé aux formules qui l'incluent ; son, pochette, paroles, synchro", async () => {
  assert.equal((await alice.json("/api/projects/suno", { method: "POST", json: { taskId: "task-123456" } })).status, 402);
  await boss.json("/api/admin/settings", { method: "PUT", json: { kie_api_key: "kie_1" } });
  const wav = sine();
  mock = async (url) => {
    if (url.includes("/generate/record-info"))
      return Response.json({
        code: 200,
        data: {
          status: "SUCCESS",
          response: {
            sunoData: [
              {
                id: "aud1",
                title: "Pour Awa",
                audioUrl: "https://cdn.test/a.mp3",
                imageUrl: "https://cdn.test/c.jpg",
                prompt: "[Verse]\nDans la nuit",
                duration: 1,
              },
              { id: "aud2", title: "Pour Awa v2", audioUrl: "https://cdn.test/b.mp3", duration: 1 },
            ],
          },
        },
      });
    if (url.includes("get-timestamped-lyrics"))
      return Response.json({
        code: 200,
        data: {
          alignedWords: [
            { word: "Dans ", startS: 0.1, endS: 0.3 },
            { word: "la ", startS: 0.3, endS: 0.5 },
            { word: "nuit", startS: 0.5, endS: 0.9 },
          ],
        },
      });
    if (url.endsWith(".mp3")) return new Response(wav, { headers: { "content-type": "audio/mpeg" } });
    if (url.endsWith(".jpg")) return new Response(new Uint8Array([0xff, 0xd8, 0xff]), { headers: { "content-type": "image/jpeg" } });
    return Response.json({ code: 404, msg: "?" });
  };
  const r = await boss.json("/api/projects/suno", { method: "POST", json: { taskId: "task-123456" } });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  const p = r.data;
  assert.equal(p.title, "Pour Awa");
  assert.equal(p.suno.audioId, "aud1");
  assert.equal(p.transcript.provider, "suno");
  assert.equal(p.style.top.enabled, true);
  assert.ok(fs.existsSync(path.join(DATA, "projects", p.id, p.media.cover.file)));
  mock = async () => Response.json({ code: 401, msg: "bad key" });
  assert.match(
    (await boss.json("/api/projects/suno", { method: "POST", json: { taskId: "task-999999" } })).data.error,
    /Clé Kie.ai refusée/,
  );
  await boss.json("/api/admin/settings", { method: "PUT", json: { kie_api_key: "" } });
});

test("voix et instrumental envoyés à la main, puis retirés", async () => {
  const p = (await alice.json("/api/projects")).data[0];
  const form = new FormData();
  form.append("instrumental", new Blob([sine()]), "instru.wav");
  const media = (await alice.json(`/api/projects/${p.id}/stems/upload`, { method: "POST", form })).data;
  assert.equal(media.instrumental.method, "upload");
  const cleared = (await alice.json(`/api/projects/${p.id}/stems`, { method: "DELETE" })).data;
  assert.equal(cleared.instrumental, undefined);
  assert.equal((await alice(`/media/${p.id}/${media.instrumental.file}`)).status, 404);
});

test("fonds, logo et polices : seuls les bons formats", async () => {
  const p = (await alice.json("/api/projects")).data[0];
  const ok = new FormData();
  ok.append("file", new Blob([new Uint8Array([0xff, 0xd8, 0xff])], { type: "image/jpeg" }), "fond.jpg");
  const a = (await alice.json(`/api/projects/${p.id}/assets`, { method: "POST", form: ok })).data;
  assert.equal(a.kind, "image");
  assert.equal((await alice(a.url)).status, 200);
  const bad = new FormData();
  bad.append("file", new Blob(["x"]), "script.svg");
  assert.equal((await alice.json(`/api/projects/${p.id}/assets`, { method: "POST", form: bad })).status, 400);
});

const hasFfmpeg = spawnSync("ffmpeg", ["-version"]).status === 0;

test("export : vidéo déjà complète gardée telle quelle, sinon ffmpeg ajoute le son", { skip: !hasFfmpeg && "ffmpeg absent" }, async () => {
  const p = (await alice.json("/api/projects")).data[0];
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "ls-vid-"));
  const vid = path.join(tmp, "v.mp4");
  spawnSync("ffmpeg", ["-y", "-f", "lavfi", "-i", "color=c=blue:s=320x240:d=1", "-c:v", "libx264", "-pix_fmt", "yuv420p", vid]);
  const direct = new FormData();
  direct.append("video", new Blob([fs.readFileSync(vid)], { type: "video/mp4" }), "v.mp4");
  direct.append("label", "1080p");
  assert.match((await alice.json(`/api/projects/${p.id}/exports`, { method: "POST", form: direct })).data.file, /^export-.*\.mp4$/);
  const withAudio = new FormData();
  withAudio.append("video", new Blob([fs.readFileSync(vid)], { type: "video/mp4" }), "v.mp4");
  withAudio.append("audio", new Blob([sine()], { type: "audio/wav" }), "a.wav");
  withAudio.append("duration", "1");
  const { job } = (await alice.json(`/api/projects/${p.id}/exports`, { method: "POST", form: withAudio })).data;
  assert.equal((await bob.json(`/api/jobs/${job.id}`)).status, 404, "tâche d'un autre client invisible");
  let state = job;
  for (let i = 0; i < 100 && state.state === "running"; i++) {
    await new Promise((r) => setTimeout(r, 100));
    state = (await alice.json(`/api/jobs/${job.id}`)).data;
  }
  assert.equal(state.state, "done", state.error);
  const out = path.join(DATA, "projects", p.id, state.result.file);
  const info = JSON.parse(
    spawnSync("ffprobe", ["-v", "error", "-print_format", "json", "-show_streams", out], { encoding: "utf8" }).stdout,
  );
  assert.deepEqual(info.streams.map((s) => s.codec_type).sort(), ["audio", "video"]);
  assert.equal((await alice.json(`/api/projects/${p.id}`)).data.exports.length, 2);
  fs.rmSync(tmp, { recursive: true, force: true });
});

test("application installable : manifeste, lien Android, service worker", async () => {
  const m = await (await realFetch(`${BASE}/manifest.webmanifest`)).json();
  assert.equal(m.display, "standalone");
  assert.equal(m.name, "Lyric Studio");
  assert.ok(m.icons.some((i) => i.purpose === "maskable"));
  const links = await (await realFetch(`${BASE}/.well-known/assetlinks.json`)).json();
  assert.equal(links[0].target.package_name, "com.exemple.lyricstudio");
  assert.deepEqual(links[0].target.sha256_cert_fingerprints, ["AA:BB"]);
  const sw = await realFetch(`${BASE}/sw.js`);
  assert.equal(sw.status, 200);
  assert.equal(sw.headers.get("service-worker-allowed"), "/");
  for (const icon of m.icons) assert.equal((await realFetch(`${BASE}${icon.src}`)).status, 200, icon.src);
});

test("suppression du compte : projets et fichiers effacés", async () => {
  const c = client();
  await c.json("/api/auth/signup", { method: "POST", json: { email: "temp@test.fr", password: "Temp-Pass-1", accept: true } });
  const p = await newProject(c);
  assert.equal((await c.json("/api/me", { method: "DELETE", json: { password: "mauvais" } })).status, 400);
  assert.equal((await c.json("/api/me", { method: "DELETE", json: { password: "Temp-Pass-1" } })).status, 200);
  assert.equal(fs.existsSync(path.join(DATA, "projects", p.id)), false);
  assert.equal((await c.json("/api/me")).status, 401);
});

// Chez un hébergeur (Passenger, o2switch), plusieurs copies du serveur partagent les mêmes données.
import { spawn } from "node:child_process";

async function startCopy(env) {
  const port = 20000 + Math.floor(Math.random() * 20000);
  const child = spawn(process.execPath, ["--disable-warning=ExperimentalWarning", "src/server.js"], {
    env: { ...process.env, PORT: String(port), HOST: "127.0.0.1", ...env },
    stdio: "ignore",
  });
  const base = `http://127.0.0.1:${port}`;
  for (let i = 0; i < 100; i++) {
    try {
      if ((await realFetch(`${base}/health`)).ok) break;
    } catch {}
    await new Promise((r) => setTimeout(r, 100));
  }
  return { child, base };
}

test("deux copies du serveur : une tâche lancée sur l'une se suit sur l'autre", { skip: !hasFfmpeg && "ffmpeg absent" }, async () => {
  const copy = await startCopy({ DATA_DIR: DATA });
  try {
    const p = (await alice.json("/api/projects")).data[0];
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "ls-vid-"));
    const vid = path.join(tmp, "v.mp4");
    spawnSync("ffmpeg", ["-y", "-f", "lavfi", "-i", "color=c=red:s=320x240:d=2", "-c:v", "libx264", "-pix_fmt", "yuv420p", vid]);
    const form = new FormData();
    form.append("video", new Blob([fs.readFileSync(vid)], { type: "video/mp4" }), "v.mp4");
    form.append("audio", new Blob([sine(2)], { type: "audio/wav" }), "a.wav");
    form.append("duration", "2");
    const { job } = (await alice.json(`/api/projects/${p.id}/exports`, { method: "POST", form })).data;
    // Le navigateur interroge l'autre copie, avec le même cookie.
    let state;
    for (let i = 0; i < 100; i++) {
      const r = await realFetch(`${copy.base}/api/jobs/${job.id}`, { headers: { cookie: alice.cookie() } });
      assert.equal(r.status, 200, "la copie connaît la session et la tâche");
      state = await r.json();
      if (state.state !== "running") break;
      await new Promise((res) => setTimeout(res, 100));
    }
    assert.equal(state.state, "done", state.error);
    assert.match(state.result.file, /^export-/);
    fs.rmSync(tmp, { recursive: true, force: true });
  } finally {
    copy.child.kill();
  }
});

test("site en ligne avec ADMIN_EMAIL : un inconnu inscrit en premier ne devient pas administrateur", async () => {
  const data = fs.mkdtempSync(path.join(os.tmpdir(), "ls-admin-"));
  const copy = await startCopy({ DATA_DIR: data, ADMIN_EMAIL: "Chef@Studio.fr" });
  try {
    const signup = (email) =>
      realFetch(`${copy.base}/api/auth/signup`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email, password: "Mot-De-Passe-1", accept: true }),
      }).then((r) => r.json());
    assert.equal((await signup("intrus@test.fr")).user.role, "user");
    assert.equal((await signup("chef@studio.fr")).user.role, "admin");
  } finally {
    copy.child.kill();
    fs.rmSync(data, { recursive: true, force: true });
  }
});
