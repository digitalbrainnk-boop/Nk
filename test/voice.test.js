import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "nk-voice-"));
const db = await import("../src/db.js");
const { cloneVoice } = await import("../src/elevenlabs.js");
const { textToSpeech } = await import("../src/tts.js");
const { transcribe } = await import("../src/media.js");

const calls = [];
globalThis.fetch = async (url, init = {}) => {
  const u = String(url);
  calls.push({ u, init });
  if (u.endsWith("/v1/voices/add")) return Response.json({ voice_id: "v-moi" });
  if (u.includes("/v1/text-to-speech/v-moi")) return new Response(new Uint8Array([7, 7, 7]), { headers: { "content-type": "audio/mpeg" } });
  if (u.endsWith("/v1/speech-to-text")) return Response.json({ text: "Bonjour, c'est pour l'anniversaire de ma sœur" });
  throw new Error(`appel inattendu ${u}`);
};

db.setSettings({ elevenlabs_api_key: "el-key", kie_api_key: "", transcription_api_key: "" });
const sample = path.join(process.env.DATA_DIR, "moi.webm");
fs.writeFileSync(sample, "audio");

test("ta voix est clonée à partir de ton enregistrement", async () => {
  const id = await cloneVoice([{ path: sample, mime: "audio/webm" }], "Voix de Nk");
  assert.equal(id, "v-moi");
  const c = calls.at(-1);
  assert.equal(c.init.headers["xi-api-key"], "el-key");
  assert.ok(c.init.body.getAll("files").length === 1);
});

test("les vocaux de l'agent utilisent ta voix", async () => {
  db.setSettings({ voice_provider: "elevenlabs", elevenlabs_voice_id: "v-moi" });
  const a = await textToSpeech("Salut, ta chanson arrive !");
  assert.ok(fs.existsSync(a.path));
  const body = JSON.parse(calls.at(-1).init.body);
  assert.equal(body.model_id, "eleven_multilingual_v2");
  assert.equal(body.text, "Salut, ta chanson arrive !");
});

test("les vocaux des clients sont transcrits avec ElevenLabs", async () => {
  const text = await transcribe(sample, "audio/ogg");
  assert.match(text, /anniversaire de ma sœur/);
  assert.equal(calls.at(-1).init.body.get("model_id"), "scribe_v1");
});
