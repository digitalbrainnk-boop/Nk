// Application web : pages du studio, API des projets, médias, IA et exports.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import express from "express";
import multer from "multer";
import {
  HttpError,
  TMP_DIR,
  adoptFile,
  createProject,
  deleteProject,
  duplicateProject,
  getProject,
  listProjects,
  projectDir,
  projectFile,
  removeFile,
  saveProject,
  updateProject,
} from "./store.js";
import { getSettings, publicSettings, setSettings, sessionSecret, SECRET_KEYS } from "./settings.js";
import { hasFfmpeg, probe, extractAudio, muxVideo } from "./ffmpeg.js";
import { startJob, getJob, cancelJob, runningJob } from "./jobs.js";
import { transcribe, availableProviders } from "./transcribe.js";
import { fetchSunoTrack, fetchTimestampedLyrics, separateWithSuno, download } from "./suno.js";
import { hasDemucs, separateWithDemucs } from "./stems.js";
import { parseLyrics } from "../public/js/core/lyrics.js";
import { mergeStyle, PRESETS } from "../public/js/core/style.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC = path.join(here, "..", "public");
const MUXER = path.join(here, "..", "node_modules", "mp4-muxer", "build");

const AUDIO_EXT = ["mp3", "wav", "flac", "aac", "m4a", "ogg", "oga", "opus", "weba", "aif", "aiff", "wma"];
const VIDEO_EXT = ["mp4", "mov", "mkv", "webm", "m4v", "avi"];
const IMAGE_EXT = ["jpg", "jpeg", "png", "webp", "gif"];
const FONT_EXT = ["ttf", "otf", "woff", "woff2"];
const extOf = (name) =>
  path
    .extname(String(name || ""))
    .slice(1)
    .toLowerCase();
const kindOf = (ext) =>
  AUDIO_EXT.includes(ext)
    ? "audio"
    : VIDEO_EXT.includes(ext)
      ? "video"
      : IMAGE_EXT.includes(ext)
        ? "image"
        : FONT_EXT.includes(ext)
          ? "font"
          : null;

const MAX_UPLOAD = Number(process.env.MAX_UPLOAD_MB || 4096) * 1024 * 1024;
const upload = multer({ dest: TMP_DIR, limits: { fileSize: MAX_UPLOAD, fieldSize: 2 * 1024 * 1024, files: 3 } });
const cleanup = (req) => {
  for (const f of [req.file, ...Object.values(req.files || {}).flat()].filter(Boolean)) fs.rm(f.path, { force: true }, () => {});
};

export function createApp({ password = process.env.STUDIO_PASSWORD || "" } = {}) {
  const app = express();
  app.disable("x-powered-by");
  app.set("trust proxy", 1);

  app.use((req, res, next) => {
    res.setHeader(
      "Content-Security-Policy",
      "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; " +
        "font-src 'self' data: blob: https://fonts.gstatic.com; img-src 'self' data: blob:; media-src 'self' blob:; " +
        "connect-src 'self' blob: data:; worker-src 'self' blob:; object-src 'none'; base-uri 'self'; frame-ancestors 'none'",
    );
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("X-Frame-Options", "DENY");
    res.setHeader("Referrer-Policy", "no-referrer");
    next();
  });

  app.get("/health", (req, res) => res.json({ ok: true }));

  // ---------- Mot de passe (facultatif en local, obligatoire si le studio est ouvert au réseau) ----------
  const secret = sessionSecret();
  const sign = (exp) => crypto.createHmac("sha256", secret).update(String(exp)).digest("base64url");
  const validSession = (req) => {
    if (!password) return true;
    const m = String(req.headers.cookie || "").match(/(?:^|;\s*)ls_session=(\d+)\.([\w-]+)/);
    if (!m || Number(m[1]) < Date.now()) return false;
    const a = Buffer.from(sign(m[1]));
    const b = Buffer.from(m[2]);
    return a.length === b.length && crypto.timingSafeEqual(a, b);
  };
  const failures = new Map();
  app.post("/api/login", express.json(), (req, res) => {
    const ip = req.ip || "?";
    const f = failures.get(ip) || { n: 0, until: 0 };
    if (f.until > Date.now()) return res.status(429).json({ error: "Trop d'essais : attends une minute." });
    const given = Buffer.from(String(req.body?.password || ""));
    const ok = given.length === Buffer.byteLength(password) && crypto.timingSafeEqual(given, Buffer.from(password));
    if (!password || !ok) {
      f.n++;
      if (f.n >= 5) Object.assign(f, { n: 0, until: Date.now() + 60_000 });
      failures.set(ip, f);
      return res.status(401).json({ error: "Mot de passe incorrect." });
    }
    failures.delete(ip);
    const exp = Date.now() + 30 * 86400_000;
    res.setHeader(
      "Set-Cookie",
      `ls_session=${exp}.${sign(exp)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${30 * 86400}${req.secure ? "; Secure" : ""}`,
    );
    res.json({ ok: true });
  });
  app.get("/api/session", (req, res) => res.json({ required: !!password, ok: validSession(req) }));

  app.use("/vendor/mp4-muxer", express.static(MUXER, { maxAge: "7d" }));
  const pages = express.static(PUBLIC, { index: "index.html" });
  app.use((req, res, next) => (/^\/(api|media)\//.test(req.path) ? next() : pages(req, res, next)));

  app.use(["/api", "/media"], (req, res, next) => (validSession(req) ? next() : res.status(401).json({ error: "Connexion demandée." })));

  // ---------- Réglages et possibilités du serveur ----------
  app.get("/api/capabilities", async (req, res) => {
    const s = getSettings();
    res.json({
      ffmpeg: hasFfmpeg(),
      demucs: await hasDemucs(),
      transcription: availableProviders(s),
      kie: !!s.kie_api_key,
      presets: PRESETS.map(({ id, name }) => ({ id, name })),
    });
  });
  app.get("/api/settings", (req, res) => res.json(publicSettings()));
  app.put("/api/settings", express.json(), (req, res) => {
    const patch = {};
    for (const [k, v] of Object.entries(req.body || {})) {
      if (typeof v !== "string") continue;
      // Une clé masquée renvoyée telle quelle n'est pas modifiée.
      if (SECRET_KEYS.includes(k) && v.startsWith("••••")) continue;
      patch[k] = v;
    }
    setSettings(patch);
    res.json(publicSettings());
  });

  // ---------- Projets ----------
  app.get("/api/projects", (req, res) => res.json(listProjects()));

  app.post("/api/projects", upload.single("file"), async (req, res) => {
    try {
      if (!req.file) throw new HttpError(400, "Ajoute un fichier audio ou vidéo.");
      const ext = extOf(req.file.originalname);
      const kind = kindOf(ext);
      if (kind !== "audio" && kind !== "video")
        throw new HttpError(400, "Format non pris en charge : MP3, WAV, FLAC, AAC, M4A, OGG, MP4, MOV, MKV, WEBM.");
      const b = req.body || {};
      const lyricsText = String(b.lyrics || "").slice(0, 50_000);
      const baseTitle = path.basename(req.file.originalname, path.extname(req.file.originalname)).replace(/[_]+/g, " ").trim();
      let style = undefined;
      const p = createProject({
        title: String(b.title || baseTitle || "Nouvelle chanson").slice(0, 200),
        artist: String(b.artist || "").slice(0, 200),
        lyricsText,
        lines: parseLyrics(lyricsText),
      });
      try {
        const name = adoptFile(p.id, req.file.path, "source", ext);
        const info = probe(projectFile(p.id, name));
        const isVideo = kind === "video" && (info ? !!info.video : true);
        let audioName = name;
        if (isVideo && hasFfmpeg() && info?.audio) {
          audioName = name.replace(/^source/, "audio").replace(/\.\w+$/, ".m4a");
          await extractAudio(projectFile(p.id, name), projectFile(p.id, audioName), { duration: info.duration }).catch(
            () => (audioName = name),
          );
        }
        const out = updateProject(p.id, (proj) => {
          proj.media.audio = { file: audioName, duration: info?.duration || 0, original: req.file.originalname.slice(0, 200) };
          if (isVideo) proj.media.source = { file: name, kind: "video", width: info?.video?.width || 0, height: info?.video?.height || 0 };
          style = proj.style;
          if (b.mode === "karaoke") style = mergeStyle(style, PRESETS.find((x) => x.id === "karaoke").patch);
          if (b.aspect && ["16:9", "9:16", "1:1", "4:5"].includes(b.aspect)) style.aspect = b.aspect;
          // Une vidéo importée devient le fond (son coupé : le son vient de la piste audio).
          if (isVideo) style.background = { ...style.background, type: "video", media: name, dim: 0.35 };
          proj.style = style;
        });
        res.json(out);
      } catch (e) {
        deleteProject(p.id);
        throw e;
      }
    } catch (e) {
      cleanup(req);
      throw e;
    }
  });

  // Chanson Suno (Kie.ai) : son, pochette, paroles et paroles horodatées.
  app.post("/api/projects/suno", express.json(), async (req, res) => {
    const taskId = String(req.body?.taskId || "").trim();
    const audioId = String(req.body?.audioId || "").trim() || undefined;
    if (!/^[\w-]{6,80}$/.test(taskId)) throw new HttpError(400, "Numéro de tâche Suno invalide.");
    const track = await fetchSunoTrack(taskId, audioId);
    const lyricsText = track.lyrics.slice(0, 50_000);
    const p = createProject({
      title: track.title || "Chanson Suno",
      artist: String(req.body?.artist || "").slice(0, 200),
      lyricsText,
      lines: parseLyrics(lyricsText),
    });
    try {
      const audioName = `audio-${Date.now().toString(36)}.mp3`;
      await download(track.audioUrl, projectFile(p.id, audioName));
      let cover = null;
      if (track.imageUrl) {
        cover = `cover-${Date.now().toString(36)}.jpg`;
        await download(track.imageUrl, projectFile(p.id, cover)).catch(() => (cover = null));
      }
      const transcript = await fetchTimestampedLyrics(taskId, track.audioId).catch((e) => ({ error: e.message }));
      const out = updateProject(p.id, (proj) => {
        proj.media.audio = {
          file: audioName,
          duration: track.duration || probe(projectFile(p.id, audioName))?.duration || 0,
          original: "Suno",
        };
        if (cover) proj.media.cover = { file: cover, kind: "image" };
        proj.suno = { taskId, audioId: track.audioId, versions: track.versions };
        if (!transcript.error) proj.transcript = transcript;
        else proj.sunoWarning = transcript.error;
        if (cover) {
          proj.style = mergeStyle(proj.style, PRESETS.find((x) => x.id === "cover").patch);
          proj.style.background = { ...proj.style.background, type: "image", media: cover };
          proj.style.top = { ...proj.style.top, enabled: true, media: cover, kind: "image" };
        }
      });
      res.json(out);
    } catch (e) {
      deleteProject(p.id);
      throw e;
    }
  });

  app.get("/api/projects/:id", (req, res) => res.json(getProject(req.params.id)));
  app.put("/api/projects/:id", express.json({ limit: "20mb" }), (req, res) => {
    const p = saveProject(req.params.id, req.body);
    res.json({ ok: true, updatedAt: p.updatedAt });
  });
  app.delete("/api/projects/:id", (req, res) => {
    getProject(req.params.id);
    deleteProject(req.params.id);
    res.json({ ok: true });
  });
  app.post("/api/projects/:id/duplicate", (req, res) => res.json(duplicateProject(req.params.id)));

  app.put("/api/projects/:id/thumb", express.raw({ type: "image/jpeg", limit: "3mb" }), (req, res) => {
    getProject(req.params.id);
    if (!Buffer.isBuffer(req.body) || req.body[0] !== 0xff || req.body[1] !== 0xd8) throw new HttpError(400, "Image JPEG attendue.");
    fs.writeFileSync(projectFile(req.params.id, "thumb.jpg"), req.body);
    res.json({ ok: true });
  });

  // Fond, image du haut, police personnalisée.
  app.post("/api/projects/:id/assets", upload.single("file"), (req, res) => {
    try {
      getProject(req.params.id);
      if (!req.file) throw new HttpError(400, "Aucun fichier reçu.");
      const ext = extOf(req.file.originalname);
      const kind = kindOf(ext);
      if (!["image", "video", "font"].includes(kind))
        throw new HttpError(400, "Image (JPG, PNG, WEBP, GIF), vidéo (MP4, WEBM, MOV) ou police (TTF, OTF, WOFF) attendue.");
      const name = adoptFile(req.params.id, req.file.path, kind === "font" ? "font" : "asset", ext);
      res.json({ file: name, kind, url: `/media/${req.params.id}/${name}`, original: req.file.originalname.slice(0, 120) });
    } catch (e) {
      cleanup(req);
      throw e;
    }
  });

  // Le navigateur n'arrive pas à lire le son (MKV, WMA…) : ffmpeg le convertit.
  app.post("/api/projects/:id/convert-audio", async (req, res) => {
    const p = getProject(req.params.id);
    if (!hasFfmpeg())
      throw new HttpError(400, "Ton navigateur ne lit pas ce format et ffmpeg n'est pas installé : convertis le fichier en MP3 ou WAV.");
    const src = p.media.source?.file || p.media.audio?.file;
    if (!src) throw new HttpError(400, "Pas de son dans ce projet.");
    const name = `audio-${Date.now().toString(36)}.m4a`;
    await extractAudio(projectFile(p.id, src), projectFile(p.id, name));
    const out = updateProject(p.id, (proj) => {
      if (proj.media.audio?.file !== proj.media.source?.file) removeFile(p.id, proj.media.audio?.file);
      proj.media.audio = { ...proj.media.audio, file: name };
    });
    res.json(out.media);
  });

  // ---------- Transcription minutée (le navigateur envoie un WAV mono 16 kHz) ----------
  app.post("/api/projects/:id/transcribe", upload.single("audio"), async (req, res) => {
    try {
      getProject(req.params.id);
      if (!req.file) throw new HttpError(400, "Son manquant.");
      const result = await transcribe(req.file.path, {
        provider: req.body?.provider,
        language: req.body?.language,
        prompt: req.body?.prompt,
      });
      res.json(result);
    } finally {
      cleanup(req);
    }
  });

  // Paroles horodatées de Suno (gratuites, synchro parfaite) pour un projet Suno.
  app.post("/api/projects/:id/suno-lyrics", async (req, res) => {
    const p = getProject(req.params.id);
    if (!p.suno?.taskId) throw new HttpError(400, "Ce projet ne vient pas de Suno.");
    res.json(await fetchTimestampedLyrics(p.suno.taskId, p.suno.audioId));
  });

  // ---------- Voix séparée ----------
  app.post("/api/projects/:id/stems", express.json(), async (req, res) => {
    const p = getProject(req.params.id);
    const method = req.body?.method;
    if (!p.media.audio?.file) throw new HttpError(400, "Pas de son dans ce projet.");
    const already = runningJob(p.id, "stems");
    if (already) return res.json({ job: already });
    if (method === "demucs") {
      if (!(await hasDemucs())) throw new HttpError(400, "Demucs n'est pas installé sur cet ordinateur (pip install demucs).");
      const job = startJob("stems", p.id, async ({ update, signal }) => {
        update({ message: "Séparation de la voix avec Demucs…" });
        const outDir = path.join(TMP_DIR, `demucs-${p.id}-${Date.now()}`);
        try {
          const r = await separateWithDemucs(projectFile(p.id, p.media.audio.file), outDir, {
            signal,
            onProgress: (x) => update({ progress: x * 0.98 }),
          });
          return saveStems(p.id, { vocals: r.vocals, instrumental: r.instrumental, ext: "wav", method: "demucs" });
        } finally {
          fs.rm(outDir, { recursive: true, force: true }, () => {});
        }
      });
      return res.json({ job });
    }
    if (method === "suno") {
      if (!p.suno?.taskId) throw new HttpError(400, "La séparation par Suno ne marche que pour les chansons créées avec Suno.");
      const job = startJob("stems", p.id, async ({ update, signal }) => {
        update({ message: "Séparation de la voix par Suno (1 à 3 minutes)…" });
        const urls = await separateWithSuno(p.suno.taskId, p.suno.audioId, {
          signal,
          onStatus: (s) => update({ message: `Suno : ${s || "en cours"}…` }),
        });
        const tmpV = path.join(TMP_DIR, `v-${p.id}-${Date.now()}.mp3`);
        const tmpI = path.join(TMP_DIR, `i-${p.id}-${Date.now()}.mp3`);
        await download(urls.instrumental, tmpI);
        if (urls.vocals) await download(urls.vocals, tmpV);
        return saveStems(p.id, { vocals: urls.vocals ? tmpV : null, instrumental: tmpI, ext: "mp3", method: "suno" });
      });
      return res.json({ job });
    }
    throw new HttpError(400, "Méthode inconnue.");
  });

  function saveStems(id, { vocals, instrumental, ext, method }) {
    const v = vocals ? adoptFile(id, vocals, "vocals", ext) : null;
    const i = instrumental ? adoptFile(id, instrumental, "instrumental", ext) : null;
    const p = updateProject(id, (proj) => {
      if (v) removeFile(id, proj.media.vocals?.file);
      if (i) removeFile(id, proj.media.instrumental?.file);
      if (v) proj.media.vocals = { file: v, method };
      if (i) proj.media.instrumental = { file: i, method };
    });
    return p.media;
  }

  // Voix et/ou instrumental préparés ailleurs (UVR, Lalal.ai, Youka…).
  app.post(
    "/api/projects/:id/stems/upload",
    upload.fields([
      { name: "vocals", maxCount: 1 },
      { name: "instrumental", maxCount: 1 },
    ]),
    (req, res) => {
      try {
        getProject(req.params.id);
        const v = req.files?.vocals?.[0];
        const i = req.files?.instrumental?.[0];
        if (!v && !i) throw new HttpError(400, "Ajoute la voix seule et/ou l'instrumental.");
        for (const f of [v, i].filter(Boolean))
          if (kindOf(extOf(f.originalname)) !== "audio") throw new HttpError(400, "Fichier audio attendu (MP3, WAV, FLAC…).");
        const vn = v ? adoptFile(req.params.id, v.path, "vocals", extOf(v.originalname)) : null;
        const inn = i ? adoptFile(req.params.id, i.path, "instrumental", extOf(i.originalname)) : null;
        const p = updateProject(req.params.id, (proj) => {
          if (vn) removeFile(proj.id, proj.media.vocals?.file), (proj.media.vocals = { file: vn, method: "upload" });
          if (inn) removeFile(proj.id, proj.media.instrumental?.file), (proj.media.instrumental = { file: inn, method: "upload" });
        });
        res.json(p.media);
      } catch (e) {
        cleanup(req);
        throw e;
      }
    },
  );

  app.delete("/api/projects/:id/stems", (req, res) => {
    const p = updateProject(req.params.id, (proj) => {
      removeFile(proj.id, proj.media.vocals?.file);
      removeFile(proj.id, proj.media.instrumental?.file);
      delete proj.media.vocals;
      delete proj.media.instrumental;
    });
    res.json(p.media);
  });

  // ---------- Exports ----------
  // Le navigateur rend la vidéo. S'il n'a pas pu ajouter le son (ou pas en H.264), ffmpeg termine.
  app.post(
    "/api/projects/:id/exports",
    upload.fields([
      { name: "video", maxCount: 1 },
      { name: "audio", maxCount: 1 },
    ]),
    (req, res) => {
      const video = req.files?.video?.[0];
      const audio = req.files?.audio?.[0];
      try {
        const p = getProject(req.params.id);
        if (!video) throw new HttpError(400, "Vidéo manquante.");
        const transcode = req.body?.transcode === "1";
        const label = String(req.body?.label || "").slice(0, 80);
        const duration = Number(req.body?.duration) || 0;
        const finish = (file, size) =>
          updateProject(p.id, (proj) => {
            proj.exports = [{ file, label, size, at: Date.now() }, ...(proj.exports || [])].slice(0, 30);
          });
        if (!audio && !transcode) {
          const name = adoptFile(p.id, video.path, "export", "mp4");
          finish(name, fs.statSync(projectFile(p.id, name)).size);
          return res.json({ file: name, url: `/media/${p.id}/${name}` });
        }
        if (!hasFfmpeg()) throw new HttpError(400, "ffmpeg n'est pas installé : impossible de terminer l'export sur le serveur.");
        const job = startJob("export", p.id, async ({ update, signal }) => {
          update({ message: transcode ? "Conversion en H.264…" : "Ajout du son…" });
          const name = `export-${Date.now().toString(36)}${crypto.randomBytes(3).toString("hex")}.mp4`;
          try {
            await muxVideo({
              video: video.path,
              audio: audio?.path,
              out: projectFile(p.id, name),
              transcode,
              duration,
              signal,
              onProgress: (x) => update({ progress: x }),
            });
          } catch (e) {
            removeFile(p.id, name);
            throw e;
          } finally {
            fs.rm(video.path, { force: true }, () => {});
            if (audio) fs.rm(audio.path, { force: true }, () => {});
          }
          finish(name, fs.statSync(projectFile(p.id, name)).size);
          return { file: name, url: `/media/${p.id}/${name}` };
        });
        res.json({ job });
      } catch (e) {
        cleanup(req);
        throw e;
      }
    },
  );

  app.delete("/api/projects/:id/exports/:file", (req, res) => {
    const p = updateProject(req.params.id, (proj) => {
      proj.exports = (proj.exports || []).filter((x) => x.file !== req.params.file);
    });
    if (/^export-/.test(req.params.file)) removeFile(p.id, req.params.file);
    res.json(p.exports);
  });

  app.get("/api/jobs/:id", (req, res) => {
    const job = getJob(req.params.id);
    if (!job) throw new HttpError(404, "Tâche introuvable (le serveur a peut-être redémarré).");
    res.json(job);
  });
  app.delete("/api/jobs/:id", (req, res) => {
    cancelJob(req.params.id);
    res.json({ ok: true });
  });

  // ---------- Médias (lecture avec avance rapide : en-têtes Range gérés) ----------
  app.get("/media/:id/:file", (req, res) => {
    const file = projectFile(req.params.id, req.params.file);
    if (!fs.existsSync(file)) throw new HttpError(404, "Fichier introuvable.");
    if (req.query.dl) {
      const p = getProject(req.params.id);
      const safe =
        (p.title || "video")
          .replace(/[^\p{L}\p{N} _-]/gu, "")
          .trim()
          .slice(0, 60) || "video";
      res.attachment(`${safe}.${extOf(file)}`);
    }
    res.sendFile(file, { dotfiles: "deny", maxAge: req.params.file.startsWith("thumb") ? 0 : "1h" });
  });

  app.use("/api", (req, res) => res.status(404).json({ error: "Adresse inconnue." }));

  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    const status = err.status || (err.code === "LIMIT_FILE_SIZE" ? 413 : err.type === "entity.too.large" ? 413 : 500);
    if (status >= 500 && status !== 502) console.error(err);
    const msg = err.code === "LIMIT_FILE_SIZE" ? "Fichier trop gros." : err.message || "Erreur.";
    if (req.path.startsWith("/media") && status === 404) return res.status(404).end();
    res.status(status).json({ error: msg });
  });

  return app;
}
