// Génère les échantillons vocaux de 5 secondes (public/samples/voice-*.mp3) avec Suno via Kie.ai.
// Utilisation : KIE_API_KEY=... npm run samples   (ffmpeg recommandé pour couper l'extrait)
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const KEY = process.env.KIE_API_KEY;
const BASE = (process.env.KIE_API_BASE || "https://api.kie.ai/api/v1").replace(/\/+$/, "");
const OUT = path.resolve("public/samples");
if (!KEY) {
  console.error("KIE_API_KEY manquante.");
  process.exit(1);
}

const VOICES = {
  male: { style: "warm male lead vocals, afropop ballad, acoustic guitar", gender: "m" },
  female: { style: "soulful female lead vocals, afropop ballad, acoustic guitar", gender: "f" },
  duo: { style: "male and female duet, alternating male and female vocals, afropop ballad" },
  child: { style: "child vocals, young child singer, sweet innocent kid voice, simple lullaby melody" },
};
const LYRICS = "[Verse]\nLa la la, cette chanson est pour toi\nUn cadeau du cœur, une mélodie de joie\n[Chorus]\nPour toi, pour toujours, la la la";

async function kie(p, body) {
  const res = await fetch(`${BASE}${p}`, {
    method: body ? "POST" : "GET",
    headers: { Authorization: `Bearer ${KEY}`, "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json();
  if (data.code !== 200) throw new Error(`${p} : ${data.msg ?? res.status}`);
  return data.data;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const hasFfmpeg = spawnSync("ffmpeg", ["-version"]).status === 0;
fs.mkdirSync(OUT, { recursive: true });

for (const [id, v] of Object.entries(VOICES)) {
  console.log(`🎙️  ${id}…`);
  const { taskId } = await kie("/generate", {
    customMode: true,
    instrumental: false,
    model: process.env.KIE_SUNO_MODEL || "V5",
    title: `DB.Mélo ${id}`,
    style: v.style,
    prompt: LYRICS,
    vocalGender: v.gender,
    callBackUrl: "https://example.invalid/kie-callback",
  });
  let track;
  for (let i = 0; i < 120 && !track; i++) {
    await sleep(5000);
    const info = await kie(`/generate/record-info?taskId=${taskId}`);
    if (/FAIL|ERROR/.test(info.status)) throw new Error(`${id} : ${info.status}`);
    if (info.status === "SUCCESS") track = info.response?.sunoData?.find((t) => t.audioUrl);
  }
  if (!track) throw new Error(`${id} : délai dépassé`);
  // Début du chant d'après l'horodatage des paroles, pour un extrait où la voix s'entend tout de suite.
  let start = 8;
  try {
    const ts = await kie("/generate/get-timestamped-lyrics", { taskId, audioId: track.id });
    start = Math.max(0, (ts.alignedWords?.[0]?.startS ?? 8) - 0.3);
  } catch {}
  const full = path.join(OUT, `voice-${id}-full.mp3`);
  fs.writeFileSync(full, Buffer.from(await (await fetch(track.audioUrl)).arrayBuffer()));
  const target = path.join(OUT, `voice-${id}.mp3`);
  if (hasFfmpeg) {
    execFileSync("ffmpeg", ["-loglevel", "error", "-y", "-ss", String(start), "-t", "5", "-i", full, "-af", "afade=t=in:d=0.2,afade=t=out:st=4.5:d=0.5", "-b:a", "128k", target]);
    fs.unlinkSync(full);
  } else {
    fs.renameSync(full, target); // le lecteur s'arrête de lui-même au bout de 5 s
  }
  console.log(`   ✅ ${path.relative(process.cwd(), target)}`);
}
