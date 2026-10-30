// Export MP4 dans le navigateur, image par image (pas en temps réel) :
//   1. WebCodecs : vidéo H.264 + son AAC -> MP4 directement (Chrome, Edge, Safari récents) ;
//   2. son AAC impossible -> le serveur ajoute le son avec ffmpeg ;
//   3. H.264 impossible -> VP9/AV1, puis le serveur convertit en H.264 ;
//   4. pas de WebCodecs -> enregistrement en temps réel (MediaRecorder), converti par le serveur.
import { Muxer, StreamTarget } from "/vendor/mp4-muxer/mp4-muxer.mjs";
import { frameSize } from "./core/style.js";
import { encodeWav } from "./core/dsp.js";

const BITRATE = { 720: 6e6, 1080: 12e6, 2160: 40e6 };

/** Reçoit les morceaux du fichier (parfois une correction de l'en-tête à la fin). */
class BlobSink {
  constructor() {
    this.parts = []; // { pos, data: Uint8Array | null, blob: Blob | null, size }
    this.size = 0;
  }

  write(data, pos) {
    if (pos === this.size) {
      // Les 16 premiers Mo restent modifiables (l'en-tête est corrigé à la fin) ; le reste part dans des Blob.
      const keep = pos < 16 * 1024 * 1024;
      this.parts.push({ pos, data: keep ? data.slice() : null, blob: keep ? null : new Blob([data]), size: data.byteLength });
      this.size += data.byteLength;
      return;
    }
    if (pos > this.size) {
      this.write(new Uint8Array(pos - this.size), this.size);
      return this.write(data, pos);
    }
    // Correction d'un passage déjà écrit.
    let off = 0;
    for (const p of this.parts) {
      const a = Math.max(pos + off, p.pos);
      const b = Math.min(pos + data.byteLength, p.pos + p.size);
      if (a >= b) continue;
      if (!p.data) throw new Error("Correction impossible dans le fichier vidéo.");
      p.data.set(data.subarray(a - pos, b - pos), a - p.pos);
      off = b - pos;
    }
    if (pos + data.byteLength > this.size) this.write(data.subarray(this.size - pos), this.size);
  }

  blob(type = "video/mp4") {
    return new Blob(
      this.parts.map((p) => p.data || p.blob),
      { type },
    );
  }
}

async function firstSupported(configs, Klass) {
  for (const cfg of configs) {
    try {
      const r = await Klass.isConfigSupported(cfg);
      if (r.supported) return cfg;
    } catch {}
  }
  return null;
}

/** Meilleur encodeur vidéo disponible. */
export async function pickVideo(width, height, fps, short) {
  if (typeof VideoEncoder === "undefined") return null;
  const bitrate = BITRATE[short] || 12e6;
  const big = width * height > 2_200_000;
  const levels = big
    ? ["640034", "640033", "4d0034", "4d0033", "420034", "420033"]
    : width * height > 1_000_000
      ? ["640028", "64002a", "4d0028", "42e028", "640033"]
      : ["64001f", "4d001f", "42001f", "640028"];
  const base = { width, height, bitrate, framerate: fps, latencyMode: "quality" };
  for (const hw of ["prefer-hardware", "no-preference", "prefer-software"]) {
    const cfg = await firstSupported(
      levels.map((l) => ({ ...base, codec: `avc1.${l}`, hardwareAcceleration: hw, avc: { format: "avc" } })),
      VideoEncoder,
    );
    if (cfg) return { config: cfg, mux: "avc", transcode: false };
  }
  const alt = await firstSupported(
    [
      { ...base, codec: "vp09.00.41.08" },
      { ...base, codec: "vp09.00.40.08" },
      { ...base, codec: "vp09.00.31.08" },
      { ...base, codec: "av01.0.12M.08" },
      { ...base, codec: "av01.0.08M.08" },
    ],
    VideoEncoder,
  );
  if (alt) return { config: alt, mux: alt.codec.startsWith("av01") ? "av1" : "vp9", transcode: true };
  return null;
}

export async function pickAudio(sampleRate, channels) {
  if (typeof AudioEncoder === "undefined") return null;
  const aac = await firstSupported([{ codec: "mp4a.40.2", sampleRate, numberOfChannels: channels, bitrate: 192000 }], AudioEncoder);
  if (aac) return { config: aac, mux: "aac" };
  return null;
}

/**
 * Méthode qui sera utilisée (pour l'expliquer avant de lancer).
 * kind : webcodecs | realtime ; server : ce que ffmpeg devra terminer ; warning : à signaler.
 */
export async function exportPlan(style, resolution, fps, caps, sampleRate) {
  const { width, height } = frameSize(style.aspect, resolution);
  const short = Math.min(width, height);
  const video = await pickVideo(width, height, fps, short);
  if (!video) {
    return {
      kind: "realtime",
      width,
      height,
      server: { audio: false, transcode: caps.ffmpeg },
      warning: caps.ffmpeg
        ? "Ton navigateur ne sait pas encoder image par image : l'export se fait en temps réel (garde l'onglet ouvert), puis le serveur convertit en MP4."
        : "Export en temps réel au format WebM (ton navigateur ne sait pas créer de MP4 et ffmpeg n'est pas installé). Chrome ou Edge font de vrais MP4.",
    };
  }
  const audio = await pickAudio(sampleRate, 2);
  const transcode = video.transcode && caps.ffmpeg;
  let warning = null;
  if (video.transcode && !caps.ffmpeg)
    warning = `Vidéo en ${video.mux.toUpperCase()} (ton navigateur ne fait pas de H.264) : elle se lit dans les navigateurs et VLC, mais peut-être pas partout.`;
  if (!audio && !caps.ffmpeg)
    warning =
      "Ton navigateur ne sait pas encoder le son en AAC et ffmpeg n'est pas installé : la vidéo sera muette. Utilise Chrome ou Edge.";
  return { kind: "webcodecs", width, height, video, audio, server: { audio: !audio && caps.ffmpeg, transcode }, warning };
}

/**
 * Rend la vidéo.
 * @param opts { project, renderer, assets, ensureFonts, channels (son final), sampleRate, resolution, fps,
 *               start, end, plan, onProgress(x, info), signal }
 * @returns { blob, needsServer: { audio: bool, transcode: bool } }
 */
export async function renderVideo(opts) {
  const { project, renderer, assets, channels, sampleRate, fps, start, end, plan, onProgress, signal } = opts;
  if (plan.kind === "realtime") return renderRealtime(opts);
  const { width, height, video, audio } = plan;
  const canvas =
    typeof OffscreenCanvas !== "undefined"
      ? new OffscreenCanvas(width, height)
      : Object.assign(document.createElement("canvas"), { width, height });
  const ctx = canvas.getContext("2d", { alpha: false });
  const total = Math.max(1, Math.round((end - start) * fps));
  const sink = new BlobSink();
  const withAudio = !!audio && channels?.length;
  const muxer = new Muxer({
    target: new StreamTarget({ onData: (data, pos) => sink.write(data, pos), chunked: true, chunkSize: 8 * 1024 * 1024 }),
    video: { codec: video.mux, width, height, frameRate: fps },
    audio: withAudio ? { codec: "aac", sampleRate, numberOfChannels: 2 } : undefined,
    fastStart: false,
    firstTimestampBehavior: "offset",
  });
  let failure = null;
  const venc = new VideoEncoder({
    output: (chunk, meta) => muxer.addVideoChunk(chunk, meta),
    error: (e) => (failure = e),
  });
  venc.configure(video.config);
  let aenc = null;
  if (withAudio) {
    aenc = new AudioEncoder({ output: (chunk, meta) => muxer.addAudioChunk(chunk, meta), error: (e) => (failure = e) });
    aenc.configure(audio.config);
  }
  // Son : envoyé par tranches d'une seconde, au rythme des images (fichier bien entrelacé).
  const s0 = Math.floor(start * sampleRate);
  const s1 = Math.min(channels?.[0]?.length || 0, Math.floor(end * sampleRate));
  let sPos = s0;
  const pushAudio = (untilSec) => {
    if (!aenc) return;
    const until = Math.min(s1, s0 + Math.floor(untilSec * sampleRate));
    while (sPos < until) {
      const n = Math.min(sampleRate, until - sPos);
      const data = new Float32Array(n * 2);
      const L = channels[0];
      const R = channels[1] || channels[0];
      data.set(L.subarray(sPos, sPos + n), 0);
      data.set(R.subarray(sPos, sPos + n), n);
      const ad = new AudioData({
        format: "f32-planar",
        sampleRate,
        numberOfFrames: n,
        numberOfChannels: 2,
        timestamp: Math.round(((sPos - s0) / sampleRate) * 1e6),
        data,
      });
      aenc.encode(ad);
      ad.close();
      sPos += n;
    }
  };
  const t0 = performance.now();
  const keyEvery = fps * 2;
  try {
    for (let i = 0; i < total; i++) {
      if (signal?.aborted) throw new DOMException("Annulé", "AbortError");
      if (failure) throw failure;
      const t = start + i / fps;
      await assets.seekExact(t);
      renderer.draw(ctx, width, height, t, project, assets.current());
      const frame = new VideoFrame(canvas, { timestamp: Math.round((i / fps) * 1e6), duration: Math.round(1e6 / fps) });
      venc.encode(frame, { keyFrame: i % keyEvery === 0 });
      frame.close();
      pushAudio((i + 1) / fps + 1);
      while (venc.encodeQueueSize > 4) await new Promise((r) => setTimeout(r, 2));
      if (i % 5 === 0) {
        const elapsed = (performance.now() - t0) / 1000;
        const left = (elapsed / (i + 1)) * (total - i - 1);
        onProgress?.((i + 1) / total, { frame: i + 1, total, left });
        await new Promise((r) => setTimeout(r, 0));
      }
    }
    pushAudio(end - start + 1);
    await venc.flush();
    if (aenc) await aenc.flush();
    if (failure) throw failure;
    muxer.finalize();
  } finally {
    if (venc.state !== "closed") venc.close();
    if (aenc && aenc.state !== "closed") aenc.close();
  }
  return {
    blob: sink.blob(),
    needsServer: { audio: !withAudio && !!channels?.length && plan.server.audio, transcode: plan.server.transcode },
  };
}

/** Dernier recours : capture en temps réel (le morceau est joué pendant l'export). */
async function renderRealtime({ project, renderer, assets, channels, sampleRate, start, end, plan, fps, onProgress, signal }) {
  const { width, height } = plan;
  const canvas = Object.assign(document.createElement("canvas"), { width, height });
  const ctx = canvas.getContext("2d", { alpha: false });
  const actx = new AudioContext({ sampleRate });
  const buf = actx.createBuffer(2, channels[0].length, sampleRate);
  buf.copyToChannel(channels[0], 0);
  buf.copyToChannel(channels[1] || channels[0], 1);
  const src = actx.createBufferSource();
  src.buffer = buf;
  const dest = actx.createMediaStreamDestination();
  src.connect(dest);
  const stream = new MediaStream([...canvas.captureStream(fps).getVideoTracks(), ...dest.stream.getAudioTracks()]);
  const type =
    ["video/mp4;codecs=avc1", "video/mp4", "video/webm;codecs=vp9,opus", "video/webm"].find((t) => MediaRecorder.isTypeSupported(t)) || "";
  const rec = new MediaRecorder(stream, { mimeType: type, videoBitsPerSecond: BITRATE[Math.min(width, height)] || 12e6 });
  const chunks = [];
  rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
  const stopped = new Promise((r) => (rec.onstop = r));
  rec.start(1000);
  const startedAt = actx.currentTime + 0.1;
  src.start(startedAt, start, end - start);
  await new Promise((resolve, reject) => {
    const frame = () => {
      if (signal?.aborted) return reject(new DOMException("Annulé", "AbortError"));
      const t = start + Math.max(0, actx.currentTime - startedAt);
      assets.sync(t, true);
      renderer.draw(ctx, width, height, t, project, assets.current());
      onProgress?.((t - start) / (end - start), { left: end - t });
      if (t >= end) return resolve();
      requestAnimationFrame(frame);
    };
    frame();
  }).finally(() => {
    rec.stop();
    src.stop();
  });
  await stopped;
  actx.close();
  const mime = type.split(";")[0] || "video/webm";
  return {
    blob: new Blob(chunks, { type: mime }),
    needsServer: { audio: false, transcode: plan.server.transcode && !type.includes("avc1") },
    realtime: true,
    mime,
  };
}

/** Son final en WAV (pour que le serveur l'ajoute à la vidéo). */
export function audioWav(channels, sampleRate, start, end) {
  const a = Math.floor(start * sampleRate);
  const b = Math.min(channels[0].length, Math.floor(end * sampleRate));
  return new Blob([encodeWav([channels[0].subarray(a, b), (channels[1] || channels[0]).subarray(a, b)], sampleRate)], {
    type: "audio/wav",
  });
}
