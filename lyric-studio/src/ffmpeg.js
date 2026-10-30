// ffmpeg (facultatif) : extraire le son d'une vidéo, ajouter le son à un export, convertir en H.264.
// Sans ffmpeg, le navigateur fait tout lui-même ; ffmpeg sert de roue de secours.
import { spawn, spawnSync } from "node:child_process";

const FFMPEG = process.env.FFMPEG_PATH || "ffmpeg";
const FFPROBE = process.env.FFPROBE_PATH || "ffprobe";

let available = null;
export function hasFfmpeg() {
  if (available === null) {
    try {
      available = spawnSync(FFMPEG, ["-version"], { timeout: 10_000 }).status === 0;
    } catch {
      available = false;
    }
  }
  return available;
}

/** Durée et contenu d'un fichier (null si ffprobe est absent ou échoue). */
export function probe(file) {
  try {
    const r = spawnSync(FFPROBE, ["-v", "error", "-print_format", "json", "-show_format", "-show_streams", file], {
      timeout: 30_000,
      encoding: "utf8",
    });
    if (r.status !== 0) return null;
    const data = JSON.parse(r.stdout);
    const streams = data.streams || [];
    const v = streams.find((s) => s.codec_type === "video" && s.disposition?.attached_pic !== 1);
    const a = streams.find((s) => s.codec_type === "audio");
    return {
      duration: Number(data.format?.duration) || 0,
      video: v ? { codec: v.codec_name, width: v.width, height: v.height } : null,
      audio: a ? { codec: a.codec_name, channels: a.channels, sampleRate: Number(a.sample_rate) } : null,
    };
  } catch {
    return null;
  }
}

/** Lance ffmpeg ; onProgress(0..1) d'après « time= » si la durée est connue. */
export function run(args, { duration = 0, onProgress, signal } = {}) {
  return new Promise((resolve, reject) => {
    const p = spawn(FFMPEG, ["-hide_banner", "-y", ...args], { stdio: ["ignore", "ignore", "pipe"] });
    let tail = "";
    p.stderr.on("data", (d) => {
      const s = d.toString();
      tail = (tail + s).slice(-4000);
      const m = s.match(/time=(\d+):(\d+):(\d+(?:\.\d+)?)/);
      if (m && duration > 0) onProgress?.(Math.min(1, (+m[1] * 3600 + +m[2] * 60 + +m[3]) / duration));
    });
    const abort = () => p.kill("SIGKILL");
    signal?.addEventListener("abort", abort);
    p.on("error", reject);
    p.on("close", (code) => {
      signal?.removeEventListener("abort", abort);
      if (code === 0) resolve();
      else reject(new Error(`ffmpeg a échoué : ${tail.split("\n").filter(Boolean).slice(-3).join(" ")}`));
    });
  });
}

/** Son d'une vidéo (ou d'un format que le navigateur ne lit pas) -> AAC 192 kb/s. */
export function extractAudio(src, dest, opts) {
  return run(["-i", src, "-vn", "-map", "0:a:0", "-c:a", "aac", "-b:a", "192k", "-ac", "2", dest], opts);
}

/**
 * Assemble la vidéo rendue par le navigateur et le son.
 * transcode = true : la vidéo n'est pas en H.264 (VP9, WebM…) -> conversion pour une lecture partout.
 */
export function muxVideo({ video, audio, out, transcode = false, duration, onProgress, signal }) {
  const args = ["-i", video];
  if (audio) args.push("-i", audio);
  args.push("-map", "0:v:0");
  if (audio) args.push("-map", "1:a:0");
  if (transcode) args.push("-c:v", "libx264", "-preset", "medium", "-crf", "18", "-pix_fmt", "yuv420p");
  else args.push("-c:v", "copy");
  if (audio) args.push("-c:a", "aac", "-b:a", "192k", "-shortest");
  args.push("-movflags", "+faststart", out);
  return run(args, { duration, onProgress, signal });
}
