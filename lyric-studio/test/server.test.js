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
process.env.TRANSCRIPTION_API_KEY = "";
process.env.ELEVENLABS_API_KEY = "";
process.env.KIE_API_KEY = "";
const { createApp } = await import("../src/app.js");
const { encodeWav } = await import("../public/js/core/dsp.js");
const { normalizeAlignedWords, findStemUrls } = await import("../src/suno.js");

const realFetch = globalThis.fetch;
const outside = []; // appels vers les services extérieurs
let mock = async () => new Response("{}", { status: 500 });
globalThis.fetch = (url, opts) => {
  if (String(url).startsWith("http://127.0.0.1")) return realFetch(url, opts);
  outside.push({ url: String(url), opts });
  return mock(String(url), opts);
};

function listen(app) {
  return new Promise((resolve) => {
    const server = app.listen(0, "127.0.0.1", () => resolve({ server, base: `http://127.0.0.1:${server.address().port}` }));
  });
}
const { server, base: BASE } = await listen(createApp({ password: "" }));
after(() => {
  server.close();
  fs.rmSync(DATA, { recursive: true, force: true });
});

const json = (r) => r.json();
const sine = (sec = 1, sr = 8000) => {
  const x = new Float32Array(sec * sr);
  for (let i = 0; i < x.length; i++) x[i] = 0.3 * Math.sin((2 * Math.PI * 440 * i) / sr);
  return new Uint8Array(encodeWav([x, x], sr));
};

async function newProject(fields = {}) {
  const form = new FormData();
  form.append("file", new Blob([sine()], { type: "audio/wav" }), "Ma Chanson.wav");
  for (const [k, v] of Object.entries(fields)) form.append(k, v);
  const r = await fetch(`${BASE}/api/projects`, { method: "POST", body: form });
  assert.equal(r.status, 200, await r.clone().text());
  return r.json();
}

test("créer un projet à partir d'un son + paroles, le relire, l'enregistrer", async () => {
  const p = await newProject({ lyrics: "[Refrain]\nA: Bonjour toi\nB: Salut", mode: "karaoke" });
  assert.equal(p.title, "Ma Chanson");
  assert.equal(p.lines.length, 2);
  assert.equal(p.lines[1].singer, 1);
  assert.equal(p.style.mode, "karaoke");
  assert.match(p.media.audio.file, /^source-.*\.wav$/);
  const got = await json(await fetch(`${BASE}/api/projects/${p.id}`));
  assert.equal(got.id, p.id);
  // Le navigateur ne peut pas changer les champs du serveur.
  const r = await fetch(`${BASE}/api/projects/${p.id}`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ ...got, title: "Nouveau titre", media: { audio: { file: "../../etc/passwd" } } }),
  });
  assert.equal(r.status, 200);
  const saved = await json(await fetch(`${BASE}/api/projects/${p.id}`));
  assert.equal(saved.title, "Nouveau titre");
  assert.equal(saved.media.audio.file, p.media.audio.file);
  const list = await json(await fetch(`${BASE}/api/projects`));
  assert.ok(list.some((x) => x.id === p.id && x.title === "Nouveau titre"));
});

test("formats refusés, projet inconnu, chemins piégés", async () => {
  const form = new FormData();
  form.append("file", new Blob(["<html>"], { type: "text/html" }), "page.html");
  assert.equal((await fetch(`${BASE}/api/projects`, { method: "POST", body: form })).status, 400);
  assert.equal((await fetch(`${BASE}/api/projects/inexistant1`)).status, 404);
  assert.equal((await fetch(`${BASE}/api/projects/..%2F..`)).status, 404);
  const p = await newProject();
  assert.equal((await fetch(`${BASE}/media/${p.id}/..%2Fsettings.json`)).status, 404);
  assert.equal((await fetch(`${BASE}/media/${p.id}/project.json.bak`)).status, 404);
});

test("lecture des médias par morceaux (avance rapide dans le son)", async () => {
  const p = await newProject();
  const r = await fetch(`${BASE}/media/${p.id}/${p.media.audio.file}`, { headers: { Range: "bytes=0-99" } });
  assert.equal(r.status, 206);
  assert.equal((await r.arrayBuffer()).byteLength, 100);
  assert.equal(r.headers.get("x-content-type-options"), "nosniff");
  const dl = await fetch(`${BASE}/media/${p.id}/${p.media.audio.file}?dl=1`);
  assert.match(dl.headers.get("content-disposition"), /attachment; filename="Ma Chanson.wav"/);
});

test("fonds, image du haut et polices : seuls les bons formats", async () => {
  const p = await newProject();
  const ok = new FormData();
  ok.append("file", new Blob([new Uint8Array([0xff, 0xd8, 0xff])], { type: "image/jpeg" }), "fond.jpg");
  const a = await json(await fetch(`${BASE}/api/projects/${p.id}/assets`, { method: "POST", body: ok }));
  assert.equal(a.kind, "image");
  assert.equal((await fetch(a.url.replace(/^/, BASE))).status, 200);
  const bad = new FormData();
  bad.append("file", new Blob(["x"]), "script.svg");
  assert.equal((await fetch(`${BASE}/api/projects/${p.id}/assets`, { method: "POST", body: bad })).status, 400);
});

test("réglages : les clés ne sont jamais renvoyées en clair", async () => {
  const put = (body) =>
    fetch(`${BASE}/api/settings`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const s = await json(await put({ transcription_api_key: "gsk_secret_1234", language: "fr" }));
  assert.equal(s.transcription_api_key, "••••1234");
  assert.equal(s.language, "fr");
  await put({ transcription_api_key: "••••1234" });
  const caps = await json(await fetch(`${BASE}/api/capabilities`));
  assert.deepEqual(caps.transcription, ["whisper"]);
  assert.equal(typeof caps.ffmpeg, "boolean");
  assert.equal(JSON.stringify(await json(await fetch(`${BASE}/api/settings`))).includes("secret"), false);
  await put({ transcription_api_key: "" });
});

test("transcription mot par mot : Whisper (Groq/OpenAI) puis ElevenLabs", async () => {
  const p = await newProject();
  const send = (fields) => {
    const form = new FormData();
    form.append("audio", new Blob([sine()], { type: "audio/wav" }), "voix.wav");
    for (const [k, v] of Object.entries(fields)) form.append(k, v);
    return fetch(`${BASE}/api/projects/${p.id}/transcribe`, { method: "POST", body: form });
  };
  const none = await send({});
  assert.equal(none.status, 400);
  assert.match((await none.json()).error, /Aucun service de transcription/);

  await fetch(`${BASE}/api/settings`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ transcription_api_key: "gsk_1" }),
  });
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
  const w = await json(await send({ prompt: "Bonjour toi", language: "fr" }));
  assert.deepEqual(w.words, [
    { text: "Bonjour", start: 1.2, end: 1.6 },
    { text: "toi", start: 1.7, end: 2 },
  ]);
  const body = outside[0].opts.body;
  assert.equal(outside[0].url, "https://api.groq.com/openai/v1/audio/transcriptions");
  assert.equal(outside[0].opts.headers.Authorization, "Bearer gsk_1");
  assert.deepEqual(body.getAll("timestamp_granularities[]"), ["word", "segment"]);
  assert.equal(body.get("response_format"), "verbose_json");
  assert.equal(body.get("prompt"), "Bonjour toi");

  await fetch(`${BASE}/api/settings`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ elevenlabs_api_key: "el_1" }),
  });
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
  const e = await json(await send({ provider: "elevenlabs" }));
  assert.equal(e.provider, "elevenlabs");
  assert.deepEqual(e.words, [{ text: "Salut", start: 0.5, end: 0.9 }]);
  assert.equal(outside[0].opts.headers["xi-api-key"], "el_1");
  assert.equal(outside[0].opts.body.get("timestamps_granularity"), "word");

  mock = async () => Response.json({ error: { message: "Invalid API Key" } }, { status: 401 });
  const bad = await send({ provider: "whisper" });
  assert.match((await bad.json()).error, /clé refusée/);
  await fetch(`${BASE}/api/settings`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ transcription_api_key: "", elevenlabs_api_key: "" }),
  });
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

test("import d'une chanson Suno (Kie.ai) : son, pochette, paroles et synchro", async () => {
  await fetch(`${BASE}/api/settings`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ kie_api_key: "kie_1" }),
  });
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
  const r = await fetch(`${BASE}/api/projects/suno`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ taskId: "task-123456" }),
  });
  const p = await r.json();
  assert.equal(r.status, 200, JSON.stringify(p));
  assert.equal(p.title, "Pour Awa");
  assert.deepEqual(p.suno.audioId, "aud1");
  assert.equal(p.lines.length, 1);
  assert.equal(p.transcript.provider, "suno");
  assert.equal(p.transcript.words.length, 3);
  assert.equal(p.style.top.enabled, true);
  assert.equal(p.style.background.type, "image");
  assert.ok(fs.existsSync(path.join(DATA, "projects", p.id, p.media.cover.file)));
  const lyr = outside.find((o) => o.url.includes("get-timestamped-lyrics"));
  assert.deepEqual(JSON.parse(lyr.opts.body), { taskId: "task-123456", audioId: "aud1" });

  mock = async () => Response.json({ code: 401, msg: "bad key" });
  const bad = await fetch(`${BASE}/api/projects/suno`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ taskId: "task-999999" }),
  });
  assert.match((await bad.json()).error, /Clé Kie.ai refusée/);
  await fetch(`${BASE}/api/settings`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ kie_api_key: "" }),
  });
});

test("voix et instrumental envoyés à la main, puis retirés", async () => {
  const p = await newProject();
  const form = new FormData();
  form.append("instrumental", new Blob([sine()]), "instru.wav");
  const media = await json(await fetch(`${BASE}/api/projects/${p.id}/stems/upload`, { method: "POST", body: form }));
  assert.equal(media.instrumental.method, "upload");
  assert.equal(media.vocals, undefined);
  const cleared = await json(await fetch(`${BASE}/api/projects/${p.id}/stems`, { method: "DELETE" }));
  assert.equal(cleared.instrumental, undefined);
  assert.equal((await fetch(`${BASE}/media/${p.id}/${media.instrumental.file}`)).status, 404);
});

const hasFfmpeg = spawnSync("ffmpeg", ["-version"]).status === 0;

test("export : vidéo déjà complète gardée telle quelle, sinon ffmpeg ajoute le son", { skip: !hasFfmpeg && "ffmpeg absent" }, async () => {
  const p = await newProject();
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "ls-vid-"));
  const vid = path.join(tmp, "v.mp4");
  spawnSync("ffmpeg", ["-y", "-f", "lavfi", "-i", "color=c=blue:s=320x240:d=1", "-c:v", "libx264", "-pix_fmt", "yuv420p", vid]);
  const direct = new FormData();
  direct.append("video", new Blob([fs.readFileSync(vid)], { type: "video/mp4" }), "v.mp4");
  direct.append("label", "1080p");
  const d = await json(await fetch(`${BASE}/api/projects/${p.id}/exports`, { method: "POST", body: direct }));
  assert.match(d.file, /^export-.*\.mp4$/);

  const withAudio = new FormData();
  withAudio.append("video", new Blob([fs.readFileSync(vid)], { type: "video/mp4" }), "v.mp4");
  withAudio.append("audio", new Blob([sine()], { type: "audio/wav" }), "a.wav");
  withAudio.append("duration", "1");
  const { job } = await json(await fetch(`${BASE}/api/projects/${p.id}/exports`, { method: "POST", body: withAudio }));
  let state = job;
  for (let i = 0; i < 100 && state.state === "running"; i++) {
    await new Promise((r) => setTimeout(r, 100));
    state = await json(await fetch(`${BASE}/api/jobs/${job.id}`));
  }
  assert.equal(state.state, "done", state.error);
  const out = path.join(DATA, "projects", p.id, state.result.file);
  const info = JSON.parse(
    spawnSync("ffprobe", ["-v", "error", "-print_format", "json", "-show_streams", out], { encoding: "utf8" }).stdout,
  );
  assert.deepEqual(info.streams.map((s) => s.codec_type).sort(), ["audio", "video"]);
  const proj = await json(await fetch(`${BASE}/api/projects/${p.id}`));
  assert.equal(proj.exports.length, 2);
  fs.rmSync(tmp, { recursive: true, force: true });
});

test("mot de passe : tout est fermé sans connexion", async () => {
  const { server: s2, base } = await listen(createApp({ password: "Secret-42" }));
  try {
    assert.equal((await fetch(`${base}/api/projects`)).status, 401);
    assert.equal((await fetch(`${base}/media/abcdefgh/x.mp3`)).status, 401);
    assert.equal((await fetch(`${base}/`)).status, 200, "la page s'affiche (formulaire de connexion)");
    const bad = await fetch(`${base}/api/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ password: "non" }),
    });
    assert.equal(bad.status, 401);
    const ok = await fetch(`${base}/api/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ password: "Secret-42" }),
    });
    const cookie = ok.headers.get("set-cookie").split(";")[0];
    assert.equal((await fetch(`${base}/api/projects`, { headers: { cookie } })).status, 200);
    assert.equal((await fetch(`${base}/api/projects`, { headers: { cookie: cookie.replace(/.$/, "x") } })).status, 401);
  } finally {
    s2.close();
  }
});
