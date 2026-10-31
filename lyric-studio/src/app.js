// Application web : pages, comptes clients, API des projets, médias, IA, exports et administration.
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
  deleteUserProjects,
  duplicateProject,
  getProject,
  listProjects,
  projectFile,
  refreshSize,
  removeFile,
  saveProject,
  updateProject,
  reindex,
} from "./store.js";
import { getSettings, adminSettings, setSettings, publicConfig, watermarkText, SECRET_KEYS } from "./settings.js";
import {
  accountInfo,
  addPreset,
  addUsage,
  approveRequest,
  changePassword,
  countUsers,
  createRequest,
  createSession,
  createUser,
  deletePreset,
  deleteUser,
  destroySession,
  effectivePlan,
  getUser,
  limits,
  listPresets,
  listRequests,
  listUsers,
  login,
  purgeSessions,
  rejectRequest,
  sessionUser,
  setPassword,
  stats,
  updateUser,
  verifyPassword,
} from "./accounts.js";
import { hasFfmpeg, probe, extractAudio, muxVideo } from "./ffmpeg.js";
import { startJob, getJob, cancelJob, runningJob, queue } from "./jobs.js";
import { transcribe, availableProviders } from "./transcribe.js";
import { fetchSunoTrack, fetchTimestampedLyrics, separateWithSuno, download } from "./suno.js";
import { hasDemucs, separateWithDemucs } from "./stems.js";
import { parseLyrics } from "../public/js/core/lyrics.js";
import { mergeStyle, PRESETS, normalizeStyle } from "../public/js/core/style.js";

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
// Une séparation Demucs à la fois (gourmande en calcul) : les suivantes attendent leur tour.
const demucsQueue = queue(Number(process.env.DEMUCS_CONCURRENCY || 1));
const COOKIE = "ls_sid";

/** Limite simple par adresse IP (connexion, inscription). */
function rateLimiter(max, windowMs) {
  const hits = new Map();
  return (key) => {
    const t = Date.now();
    const h = (hits.get(key) || []).filter((x) => t - x < windowMs);
    if (h.length >= max) throw new HttpError(429, "Trop d'essais : attends quelques minutes.");
    h.push(t);
    hits.set(key, h);
    if (hits.size > 10_000) hits.clear();
  };
}

export function createApp() {
  const app = express();
  app.disable("x-powered-by");
  app.set("trust proxy", 1);
  reindex();
  purgeSessions();

  app.use((req, res, next) => {
    res.setHeader(
      "Content-Security-Policy",
      "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; " +
        "font-src 'self' data: blob: https://fonts.gstatic.com; img-src 'self' data: blob:; media-src 'self' blob:; " +
        "connect-src 'self' blob: data:; worker-src 'self' blob:; manifest-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'",
    );
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("X-Frame-Options", "DENY");
    res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
    if (req.secure) res.setHeader("Strict-Transport-Security", "max-age=31536000");
    next();
  });

  app.get("/health", (req, res) => res.json({ ok: true }));

  // ---------- Application installable (Android, ordinateur) ----------
  app.get("/manifest.webmanifest", (req, res) => {
    const s = getSettings();
    res.type("application/manifest+json").json({
      id: "/",
      name: s.app_name,
      short_name: s.app_name.slice(0, 12),
      description: s.tagline,
      lang: "fr",
      start_url: "/?source=app",
      scope: "/",
      display: "standalone",
      orientation: "any",
      background_color: "#0e0e14",
      theme_color: "#0e0e14",
      categories: ["music", "video", "entertainment"],
      icons: [
        { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
        { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
        { src: "/icons/maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
      ],
    });
  });
  // Lien entre le site et l'application Android du Play Store (Trusted Web Activity).
  app.get("/.well-known/assetlinks.json", (req, res) => {
    const s = getSettings();
    const pkg = s.android_package;
    const prints = String(s.android_sha256 || "")
      .split(",")
      .map((x) => x.trim())
      .filter(Boolean);
    res.json(
      pkg && prints.length
        ? [
            {
              relation: ["delegate_permission/common.handle_all_urls"],
              target: { namespace: "android_app", package_name: pkg, sha256_cert_fingerprints: prints },
            },
          ]
        : [],
    );
  });
  app.get("/sw.js", (req, res) => {
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Service-Worker-Allowed", "/");
    res.sendFile(path.join(PUBLIC, "sw.js"));
  });

  app.use("/vendor/mp4-muxer", express.static(MUXER, { maxAge: "7d" }));
  const pages = express.static(PUBLIC, { index: "index.html" });
  app.use((req, res, next) => (/^\/(api|media)\//.test(req.path) ? next() : pages(req, res, next)));

  // ---------- Comptes ----------
  const readCookie = (req) => String(req.headers.cookie || "").match(new RegExp(`(?:^|;\\s*)${COOKIE}=([\\w-]+)`))?.[1];
  app.use(["/api", "/media"], (req, res, next) => {
    req.user = sessionUser(readCookie(req));
    next();
  });
  const need = (req) => {
    if (!req.user) throw new HttpError(401, "Connecte-toi pour continuer.");
    return req.user;
  };
  const admin = (req) => {
    const u = need(req);
    if (u.role !== "admin") throw new HttpError(403, "Réservé à l'administrateur.");
    return u;
  };
  const setCookie = (req, res, token, maxAge) =>
    res.setHeader("Set-Cookie", `${COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${req.secure ? "; Secure" : ""}`);
  // Beaucoup de clients partagent la même adresse IP (réseaux mobiles) : limites par adresse + e-mail.
  const loginLimit = rateLimiter(8, 10 * 60_000);
  const signupLimit = rateLimiter(30, 60 * 60_000);

  // demucs : la séparation de voix par IA n'est promise sur la page des tarifs que si le serveur sait la faire.
  app.get("/api/public/config", async (req, res) => res.json({ ...publicConfig(), demucs: await hasDemucs() }));

  app.post("/api/auth/signup", express.json(), (req, res) => {
    const b = req.body || {};
    if (!getSettings().signup_open && countUsers() > 0) throw new HttpError(403, "Les inscriptions sont fermées pour le moment.");
    if (!b.accept) throw new HttpError(400, "Accepte les conditions d'utilisation pour créer ton compte.");
    signupLimit(req.ip || "?");
    const user = createUser({ email: b.email, password: b.password, name: b.name, phone: b.phone });
    const { token, maxAge } = createSession(user.id);
    setCookie(req, res, token, maxAge);
    res.json(accountInfo(user));
  });

  app.post("/api/auth/login", express.json(), (req, res) => {
    loginLimit(`${req.ip || "?"}|${String(req.body?.email || "").toLowerCase()}`);
    const user = login(req.body?.email, req.body?.password);
    const { token, maxAge } = createSession(user.id);
    setCookie(req, res, token, maxAge);
    res.json(accountInfo(user));
  });

  app.post("/api/auth/logout", (req, res) => {
    destroySession(readCookie(req));
    setCookie(req, res, "", 0);
    res.json({ ok: true });
  });

  app.get("/api/me", (req, res) => res.json(accountInfo(need(req))));
  // Au démarrage de l'application : connecté ou pas (sans erreur 401 dans la console).
  app.get("/api/session", (req, res) => res.json({ me: req.user ? accountInfo(req.user) : null }));
  app.put("/api/me", express.json(), (req, res) => {
    const u = need(req);
    res.json(
      accountInfo(
        updateUser(u.id, { name: String(req.body?.name ?? u.name).slice(0, 80), phone: String(req.body?.phone ?? u.phone).slice(0, 30) }),
      ),
    );
  });
  app.put("/api/me/password", express.json(), (req, res) => {
    const u = need(req);
    changePassword(u.id, req.body?.current, req.body?.next);
    const { token, maxAge } = createSession(u.id);
    setCookie(req, res, token, maxAge);
    res.json({ ok: true });
  });
  app.delete("/api/me", express.json(), (req, res) => {
    const u = need(req);
    if (!verifyPassword(u.id, req.body?.password)) throw new HttpError(400, "Mot de passe incorrect.");
    if (u.role === "admin" && listUsers().filter((x) => x.role === "admin").length <= 1)
      throw new HttpError(400, "Tu es le seul administrateur : nomme d'abord un autre administrateur.");
    deleteUserProjects(u.id);
    deleteUser(u.id);
    setCookie(req, res, "", 0);
    res.json({ ok: true });
  });
  app.get("/api/me/requests", (req, res) => res.json(listRequests({ status: "all", userId: need(req).id })));
  app.post("/api/me/requests", express.json(), (req, res) => res.json(createRequest(need(req).id, req.body || {})));

  // Styles enregistrés par le client.
  app.get("/api/presets", (req, res) => res.json(listPresets(need(req).id)));
  app.post("/api/presets", express.json({ limit: "200kb" }), (req, res) => {
    const style = normalizeStyle(req.body?.style);
    res.json(addPreset(need(req).id, String(req.body?.name || "").trim(), style));
  });
  app.delete("/api/presets/:id", (req, res) => {
    deletePreset(need(req).id, req.params.id);
    res.json({ ok: true });
  });

  // Ce que le serveur sait faire (et ce que la formule du client permet).
  app.get("/api/capabilities", async (req, res) => {
    const u = need(req);
    const s = getSettings();
    const plan = effectivePlan(u);
    const isAdmin = u.role === "admin";
    res.json({
      ffmpeg: hasFfmpeg(),
      demucs: (await hasDemucs()) && (isAdmin || !!plan.stems),
      transcription: availableProviders(s),
      kie: !!s.kie_api_key && (isAdmin || !!plan.suno),
      watermark: plan.watermark && !isAdmin ? watermarkText() : null,
      maxResolution: isAdmin ? "4K" : plan.maxResolution,
      presets: PRESETS.map(({ id, name }) => ({ id, name })),
    });
  });

  // ---------- Administration ----------
  app.get("/api/admin/stats", (req, res) => (admin(req), res.json(stats())));
  app.get("/api/admin/users", (req, res) => (admin(req), res.json(listUsers({ q: String(req.query.q || "") }))));
  app.patch("/api/admin/users/:id", express.json(), (req, res) => {
    const me = admin(req);
    const target = getUser(req.params.id);
    if (!target) throw new HttpError(404, "Compte introuvable.");
    const b = req.body || {};
    const patch = {};
    for (const k of ["name", "phone", "plan", "role", "disabled"]) if (b[k] !== undefined) patch[k] = b[k];
    if (b.plan_until !== undefined) patch.plan_until = b.plan_until ? Number(new Date(b.plan_until)) || null : null;
    if (target.id === me.id && (patch.role === "user" || patch.disabled))
      throw new HttpError(400, "Tu ne peux pas te retirer tes propres droits.");
    res.json(updateUser(target.id, patch));
  });
  app.post("/api/admin/users/:id/password", (req, res) => {
    admin(req);
    if (!getUser(req.params.id)) throw new HttpError(404, "Compte introuvable.");
    const temp = crypto.randomBytes(6).toString("base64url");
    setPassword(req.params.id, temp);
    res.json({ password: temp });
  });
  app.delete("/api/admin/users/:id", (req, res) => {
    const me = admin(req);
    if (req.params.id === me.id) throw new HttpError(400, "Supprime ton propre compte depuis « Mon compte ».");
    deleteUserProjects(req.params.id);
    deleteUser(req.params.id);
    res.json({ ok: true });
  });
  app.get("/api/admin/requests", (req, res) => (admin(req), res.json(listRequests({ status: String(req.query.status || "pending") }))));
  app.post("/api/admin/requests/:id/approve", (req, res) => (admin(req), res.json(approveRequest(req.params.id))));
  app.post("/api/admin/requests/:id/reject", (req, res) => {
    admin(req);
    rejectRequest(req.params.id);
    res.json({ ok: true });
  });
  app.get("/api/admin/settings", (req, res) => (admin(req), res.json(adminSettings())));
  app.put("/api/admin/settings", express.json({ limit: "1mb" }), (req, res) => {
    admin(req);
    const patch = {};
    for (const [k, v] of Object.entries(req.body || {})) {
      // Une clé masquée renvoyée telle quelle n'est pas modifiée.
      if (SECRET_KEYS.includes(k) && typeof v === "string" && v.startsWith("••••")) continue;
      if (k === "plans") {
        if (!v || typeof v !== "object" || !v.free) throw new HttpError(400, "La formule gratuite (free) est obligatoire.");
        patch.plans = v;
      } else if (k === "signup_open") patch[k] = !!v;
      else if (typeof v === "string") patch[k] = v;
    }
    setSettings(patch);
    res.json(adminSettings());
  });

  // ---------- Projets ----------
  const owned = (req, id = req.params.id) => getProject(id, need(req));

  app.get("/api/projects", (req, res) => res.json(listProjects(need(req).id)));

  app.post("/api/projects", upload.single("file"), async (req, res) => {
    try {
      const user = need(req);
      if (!req.file) throw new HttpError(400, "Ajoute un fichier audio ou vidéo.");
      const ext = extOf(req.file.originalname);
      const kind = kindOf(ext);
      if (kind !== "audio" && kind !== "video")
        throw new HttpError(400, "Format non pris en charge : MP3, WAV, FLAC, AAC, M4A, OGG, MP4, MOV, MKV, WEBM.");
      limits.newProject(user, req.file.size);
      const b = req.body || {};
      const lyricsText = String(b.lyrics || "").slice(0, 50_000);
      const baseTitle = path.basename(req.file.originalname, path.extname(req.file.originalname)).replace(/[_]+/g, " ").trim();
      const p = createProject(user.id, {
        title: String(b.title || baseTitle || "Nouvelle chanson").slice(0, 200),
        artist: String(b.artist || "").slice(0, 200),
        lyricsText,
        lines: parseLyrics(lyricsText),
      });
      try {
        const name = adoptFile(p.id, req.file.path, "source", ext);
        const info = probe(projectFile(p.id, name));
        limits.duration(user, info?.duration);
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
          let style = proj.style;
          if (b.mode === "karaoke") style = mergeStyle(style, PRESETS.find((x) => x.id === "karaoke").patch);
          if (b.aspect && ["16:9", "9:16", "1:1", "4:5"].includes(b.aspect)) style.aspect = b.aspect;
          // Une vidéo importée devient le fond (son coupé : le son vient de la piste audio).
          if (isVideo) style.background = { ...style.background, type: "video", media: name, dim: 0.35 };
          proj.style = style;
          proj.duration = info?.duration || 0;
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
    const user = need(req);
    limits.suno(user);
    limits.newProject(user);
    const taskId = String(req.body?.taskId || "").trim();
    const audioId = String(req.body?.audioId || "").trim() || undefined;
    if (!/^[\w-]{6,80}$/.test(taskId)) throw new HttpError(400, "Numéro de tâche Suno invalide.");
    const track = await fetchSunoTrack(taskId, audioId);
    const lyricsText = track.lyrics.slice(0, 50_000);
    const p = createProject(user.id, {
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
        proj.duration = proj.media.audio.duration;
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

  app.get("/api/projects/:id", (req, res) => res.json(owned(req)));
  app.put("/api/projects/:id", express.json({ limit: "20mb" }), (req, res) => {
    const p = saveProject(req.params.id, need(req), req.body);
    res.json({ ok: true, updatedAt: p.updatedAt });
  });
  app.delete("/api/projects/:id", (req, res) => {
    owned(req);
    deleteProject(req.params.id);
    res.json({ ok: true });
  });
  app.post("/api/projects/:id/duplicate", (req, res) => {
    const user = need(req);
    const p = owned(req);
    limits.newProject(user, 0);
    res.json(duplicateProject(p.id, user));
  });

  app.put("/api/projects/:id/thumb", express.raw({ type: "image/jpeg", limit: "3mb" }), (req, res) => {
    owned(req);
    if (!Buffer.isBuffer(req.body) || req.body[0] !== 0xff || req.body[1] !== 0xd8) throw new HttpError(400, "Image JPEG attendue.");
    fs.writeFileSync(projectFile(req.params.id, "thumb.jpg"), req.body);
    res.json({ ok: true });
  });

  // Fond, image du haut, logo, police personnalisée.
  app.post("/api/projects/:id/assets", upload.single("file"), (req, res) => {
    try {
      const user = need(req);
      owned(req);
      if (!req.file) throw new HttpError(400, "Aucun fichier reçu.");
      const ext = extOf(req.file.originalname);
      const kind = kindOf(ext);
      if (!["image", "video", "font"].includes(kind))
        throw new HttpError(400, "Image (JPG, PNG, WEBP, GIF), vidéo (MP4, WEBM, MOV) ou police (TTF, OTF, WOFF) attendue.");
      limits.storage(user, req.file.size);
      const name = adoptFile(req.params.id, req.file.path, kind === "font" ? "font" : "asset", ext);
      refreshSize(req.params.id);
      res.json({ file: name, kind, url: `/media/${req.params.id}/${name}`, original: req.file.originalname.slice(0, 120) });
    } catch (e) {
      cleanup(req);
      throw e;
    }
  });

  // Le navigateur n'arrive pas à lire le son (MKV, WMA…) : ffmpeg le convertit.
  app.post("/api/projects/:id/convert-audio", async (req, res) => {
    const p = owned(req);
    if (!hasFfmpeg()) throw new HttpError(400, "Ton navigateur ne lit pas ce format : convertis le fichier en MP3 ou WAV.");
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
      const user = need(req);
      owned(req);
      if (!req.file) throw new HttpError(400, "Son manquant.");
      // WAV 16 bits mono 16 kHz : 32 000 octets par seconde.
      const seconds = Math.max(1, (req.file.size - 44) / 32000);
      limits.duration(user, seconds);
      limits.ai(user, seconds);
      const result = await transcribe(req.file.path, {
        provider: req.body?.provider,
        language: req.body?.language,
        prompt: req.body?.prompt,
      });
      addUsage(user.id, { ai: seconds });
      res.json(result);
    } finally {
      cleanup(req);
    }
  });

  // Paroles horodatées de Suno (gratuites, synchro parfaite) pour un projet Suno.
  app.post("/api/projects/:id/suno-lyrics", async (req, res) => {
    const p = owned(req);
    if (!p.suno?.taskId) throw new HttpError(400, "Ce projet ne vient pas de Suno.");
    res.json(await fetchTimestampedLyrics(p.suno.taskId, p.suno.audioId));
  });

  // ---------- Voix séparée ----------
  app.post("/api/projects/:id/stems", express.json(), async (req, res) => {
    const user = need(req);
    const p = owned(req);
    const method = req.body?.method;
    if (!p.media.audio?.file) throw new HttpError(400, "Pas de son dans ce projet.");
    limits.stems(user);
    limits.storage(user);
    const already = runningJob(p.id, "stems");
    if (already) return res.json({ job: already });
    if (method === "demucs") {
      if (!(await hasDemucs())) throw new HttpError(400, "La séparation de la voix n'est pas installée sur ce serveur.");
      const job = startJob("stems", p.id, async ({ update, signal }) => {
        update({ message: "En file d'attente…" });
        return demucsQueue(async () => {
          update({ message: "Séparation de la voix par IA…" });
          const outDir = path.join(TMP_DIR, `demucs-${p.id}-${Date.now()}`);
          try {
            const r = await separateWithDemucs(projectFile(p.id, p.media.audio.file), outDir, {
              signal,
              onProgress: (x) => update({ progress: x * 0.98 }),
            });
            addUsage(user.id, { stems: 1 });
            return saveStems(p.id, { vocals: r.vocals, instrumental: r.instrumental, ext: "wav", method: "demucs" });
          } finally {
            fs.rm(outDir, { recursive: true, force: true }, () => {});
          }
        }, signal);
      });
      return res.json({ job });
    }
    if (method === "suno") {
      limits.suno(user);
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
        addUsage(user.id, { stems: 1 });
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
        const user = need(req);
        owned(req);
        const v = req.files?.vocals?.[0];
        const i = req.files?.instrumental?.[0];
        if (!v && !i) throw new HttpError(400, "Ajoute la voix seule et/ou l'instrumental.");
        for (const f of [v, i].filter(Boolean))
          if (kindOf(extOf(f.originalname)) !== "audio") throw new HttpError(400, "Fichier audio attendu (MP3, WAV, FLAC…).");
        limits.storage(user, (v?.size || 0) + (i?.size || 0));
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
    owned(req);
    const p = updateProject(req.params.id, (proj) => {
      removeFile(proj.id, proj.media.vocals?.file);
      removeFile(proj.id, proj.media.instrumental?.file);
      delete proj.media.vocals;
      delete proj.media.instrumental;
    });
    res.json(p.media);
  });

  // ---------- Exports ----------
  // Avant chaque export : vérifie la formule (qualité, nombre d'exports du mois) et compte l'export.
  app.post("/api/projects/:id/export-start", express.json(), (req, res) => {
    const user = need(req);
    owned(req);
    const resolution = String(req.body?.resolution || "1080p");
    limits.duration(user, Number(req.body?.duration) || 0);
    limits.export(user, resolution);
    addUsage(user.id, { exports: 1 });
    const plan = effectivePlan(user);
    res.json({ watermark: plan.watermark && user.role !== "admin" ? watermarkText() : null });
  });

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
        const user = need(req);
        const p = owned(req);
        if (!video) throw new HttpError(400, "Vidéo manquante.");
        limits.storage(user, video.size);
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
        if (!hasFfmpeg()) throw new HttpError(400, "ffmpeg n'est pas installé sur le serveur : impossible de terminer l'export.");
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
    owned(req);
    const p = updateProject(req.params.id, (proj) => {
      proj.exports = (proj.exports || []).filter((x) => x.file !== req.params.file);
    });
    if (/^export-/.test(req.params.file)) removeFile(p.id, req.params.file);
    refreshSize(p.id);
    res.json(p.exports);
  });

  app.get("/api/jobs/:id", (req, res) => {
    const job = getJob(req.params.id);
    if (!job) throw new HttpError(404, "Tâche introuvable (le serveur a peut-être redémarré).");
    owned(req, job.projectId);
    res.json(job);
  });
  app.delete("/api/jobs/:id", (req, res) => {
    const job = getJob(req.params.id);
    if (job) owned(req, job.projectId);
    cancelJob(req.params.id);
    res.json({ ok: true });
  });

  // ---------- Médias (lecture avec avance rapide : en-têtes Range gérés) ----------
  app.get("/media/:id/:file", (req, res) => {
    const p = owned(req);
    const file = projectFile(p.id, req.params.file);
    if (!fs.existsSync(file) || req.params.file === "project.json") throw new HttpError(404, "Fichier introuvable.");
    if (req.query.dl) {
      const safe =
        (p.title || "video")
          .replace(/[^\p{L}\p{N} _-]/gu, "")
          .trim()
          .slice(0, 60) || "video";
      res.attachment(`${safe}.${extOf(file)}`);
    }
    res.setHeader("Cache-Control", "private, max-age=3600");
    res.sendFile(file, { dotfiles: "deny", cacheControl: false });
  });

  app.use("/api", (req, res) => res.status(404).json({ error: "Adresse inconnue." }));

  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    const status = err.status || (err.code === "LIMIT_FILE_SIZE" ? 413 : err.type === "entity.too.large" ? 413 : 500);
    if (status >= 500 && status !== 502) console.error(err);
    const msg = err.code === "LIMIT_FILE_SIZE" ? "Fichier trop gros." : err.message || "Erreur.";
    if (req.path.startsWith("/media") && (status === 404 || status === 401)) return res.status(status).end();
    res.status(status).json({ error: msg, upgrade: err.upgrade || undefined });
  });

  return app;
}
