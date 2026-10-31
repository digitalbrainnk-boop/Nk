// Version de démonstration : remplace public/js/api.js. Le « serveur » tourne dans le navigateur, en mémoire :
// comptes, formules, projets, styles, demandes d'abonnement. Rien n'est envoyé nulle part et tout s'efface
// quand la page se ferme. La synchronisation par IA et les traitements du serveur (ffmpeg, Demucs) n'y sont pas.
import { parseLyrics, serializeLyrics } from "../public/js/core/lyrics.js";
import { defaultStyle, mergeStyle, normalizeStyle, newLayer, PRESETS, DEFAULT_PLANS, RESOLUTION_ORDER } from "../public/js/core/style.js";
import { encodeWav } from "../public/js/core/dsp.js";

export class ApiError extends Error {
  constructor(message, status, data) {
    super(message);
    this.status = status;
    this.upgrade = !!data?.upgrade;
  }
}

let onUnauthorized = () => {};
export const setUnauthorizedHandler = (fn) => (onUnauthorized = fn);

const fail = (status, message, extra) => {
  throw new ApiError(message, status, extra);
};
const quota = (message) => fail(402, message, { upgrade: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const id = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
const now = () => Date.now();
const month = () => new Date().toISOString().slice(0, 7);
export const DEMO_PASSWORD = "demo1234";

// ---------- Données ----------
const AUDIO_EXT = ["mp3", "wav", "flac", "aac", "m4a", "ogg", "oga", "opus", "weba"];
const VIDEO_EXT = ["mp4", "mov", "mkv", "webm", "m4v"];
const IMAGE_EXT = ["jpg", "jpeg", "png", "webp", "gif"];
const FONT_EXT = ["ttf", "otf", "woff", "woff2"];
const extOf = (name) => (String(name || "").match(/\.([a-z0-9]+)$/i)?.[1] || "").toLowerCase();
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

const db = {
  settings: {
    app_name: "Africa Lyrics",
    tagline: "Tes chansons en vidéos lyriques et karaoké, synchronisées mot par mot",
    support_whatsapp: "+225 07 00 00 00 00",
    support_email: "contact@africalyrics.demo",
    watermark_text: "Fait avec {app}",
    signup_open: true,
    plans: structuredClone(DEFAULT_PLANS),
    payment_instructions:
      "Paie par Mobile Money (Orange Money, MTN MoMo, Wave…) au numéro indiqué par le support, puis envoie la référence de la transaction ci-dessous. Ton compte est activé dès la vérification du paiement.",
    terms: "",
    privacy: "",
    transcription_url: "https://api.groq.com/openai/v1/audio/transcriptions",
    transcription_model: "whisper-large-v3",
    transcription_api_key: "",
    elevenlabs_api_key: "",
    kie_api_key: "",
    transcription_provider: "auto",
    language: "",
    android_package: "",
    android_sha256: "",
    android_app_url: "",
  },
  users: [],
  me: null,
  usage: new Map(),
  projects: new Map(),
  files: new Map(), // "projet/fichier" -> { blob, url }
  presets: [],
  requests: [],
};
const urlToBlob = new Map();

function putFile(projectId, name, blob) {
  const key = `${projectId}/${name}`;
  const old = db.files.get(key);
  if (old) {
    urlToBlob.delete(old.url);
    URL.revokeObjectURL(old.url);
  }
  const url = URL.createObjectURL(blob);
  db.files.set(key, { blob, url });
  urlToBlob.set(url, blob);
  return url;
}
function dropFile(projectId, name) {
  const key = `${projectId}/${name}`;
  const f = db.files.get(key);
  if (!f) return;
  urlToBlob.delete(f.url);
  URL.revokeObjectURL(f.url);
  db.files.delete(key);
}
const fileName = (prefix, ext) => `${prefix}-${id()}.${ext}`;
const projectSize = (pid) => [...db.files.entries()].filter(([k]) => k.startsWith(`${pid}/`)).reduce((n, [, f]) => n + f.blob.size, 0);

// ---------- Comptes et formules ----------
const plans = () => db.settings.plans;
function effectivePlan(u) {
  let pid = u.plan;
  if (pid !== "free" && u.plan_until && u.plan_until < now() && u.role !== "admin") pid = "free";
  if (!plans()[pid]) pid = "free";
  return { id: pid, ...plans()[pid] };
}
const usageOf = (uid) => db.usage.get(`${uid}|${month()}`) || { ai_seconds: 0, exports: 0, stems: 0 };
function addUsage(uid, { ai = 0, exports = 0 }) {
  const u = { ...usageOf(uid) };
  u.ai_seconds += ai;
  u.exports += exports;
  db.usage.set(`${uid}|${month()}`, u);
}
const myProjects = (uid) => [...db.projects.values()].filter((p) => p.owner === uid);
const storageOf = (uid) => myProjects(uid).reduce((n, p) => n + projectSize(p.id), 0);
const publicUser = (u) => ({
  id: u.id,
  email: u.email,
  name: u.name,
  phone: u.phone,
  role: u.role,
  plan: u.plan,
  plan_until: u.plan_until,
});
const accountInfo = (u) => ({
  user: publicUser(u),
  plan: effectivePlan(u),
  usage: usageOf(u.id),
  storage: storageOf(u.id),
  projects: myProjects(u.id).length,
});

function need() {
  const u = db.users.find((x) => x.id === db.me);
  if (!u) {
    onUnauthorized();
    fail(401, "Connecte-toi pour continuer.");
  }
  return u;
}
function admin() {
  const u = need();
  if (u.role !== "admin") fail(403, "Réservé à l'administrateur.");
  return u;
}

const limits = {
  newProject(u, size = 0) {
    if (u.role === "admin") return;
    const p = effectivePlan(u);
    if (myProjects(u.id).length >= p.maxProjects)
      quota(`Ta formule ${p.name} permet ${p.maxProjects} projets : supprime-en un ou passe à une formule supérieure.`);
    limits.storage(u, size);
  },
  storage(u, extra = 0) {
    if (u.role === "admin") return;
    const p = effectivePlan(u);
    if (storageOf(u.id) + extra > p.storageMb * 1024 * 1024)
      quota(`Espace de stockage plein (${p.storageMb} Mo avec la formule ${p.name}).`);
  },
  duration(u, seconds) {
    if (u.role === "admin" || !seconds) return;
    const p = effectivePlan(u);
    if (seconds > p.maxMinutes * 60 + 5) quota(`Chanson trop longue : ${p.maxMinutes} minutes au plus avec la formule ${p.name}.`);
  },
  export(u, resolution) {
    if (u.role === "admin") return;
    const p = effectivePlan(u);
    if (RESOLUTION_ORDER.indexOf(resolution) > RESOLUTION_ORDER.indexOf(p.maxResolution))
      quota(`La qualité ${resolution} est réservée aux formules supérieures (${p.maxResolution} au plus avec ${p.name}).`);
    if (usageOf(u.id).exports >= p.exportsPerMonth)
      quota(`Tu as utilisé tes ${p.exportsPerMonth} exports du mois avec la formule ${p.name}.`);
  },
};

const watermark = () => String(db.settings.watermark_text || "").replace(/\{app\}/g, db.settings.app_name);
const validEmail = (e) => typeof e === "string" && /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(e);

function createUser({ email, password, name = "", phone = "", role = "user", plan = "free", plan_until = null }) {
  email = String(email || "")
    .trim()
    .toLowerCase();
  if (!validEmail(email)) fail(400, "Adresse e-mail invalide.");
  if (typeof password !== "string" || password.length < 8) fail(400, "Le mot de passe doit faire au moins 8 caractères.");
  if (db.users.some((u) => u.email === email)) fail(409, "Un compte existe déjà avec cette adresse : connecte-toi.");
  const u = {
    id: id(),
    email,
    password,
    name: String(name).trim().slice(0, 80),
    phone: String(phone).trim().slice(0, 30),
    role,
    plan,
    plan_until,
    disabled: false,
    created_at: now(),
  };
  db.users.push(u);
  return u;
}

// ---------- Projets ----------
function newProject(owner, fields) {
  const p = {
    id: id(),
    owner,
    title: "Nouvelle chanson",
    artist: "",
    lyricsText: "",
    lines: [],
    transcript: null,
    sync: { method: null, at: null, matched: 0, total: 0 },
    style: defaultStyle(),
    media: {},
    exports: [],
    ...fields,
    createdAt: now(),
    updatedAt: now(),
  };
  db.projects.set(p.id, p);
  return p;
}
function owned(pid) {
  const u = need();
  const p = db.projects.get(pid);
  if (!p || (p.owner !== u.id && u.role !== "admin")) fail(404, "Projet introuvable.");
  return p;
}
const copy = (x) => structuredClone(x);
function listProjects(uid) {
  return myProjects(uid)
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .map((p) => ({
      id: p.id,
      title: p.title,
      artist: p.artist,
      duration: p.duration || 0,
      mode: p.style?.mode || "lyric",
      aspect: p.style?.aspect || "16:9",
      lines: p.lines?.length || 0,
      synced: !!p.sync?.method,
      size: projectSize(p.id),
      thumb: db.files.get(`${p.id}/thumb.jpg`)?.url || null,
      updatedAt: p.updatedAt,
    }));
}

// ---------- Les « adresses » de l'API ----------
const routes = [];
const on = (method, pattern, fn) => routes.push({ method, re: new RegExp(`^${pattern.replace(/:(\w+)/g, "(?<$1>[^/]+)")}$`), fn });

on("GET", "/api/public/config", () => {
  const s = db.settings;
  return {
    app_name: s.app_name,
    tagline: s.tagline,
    support_whatsapp: s.support_whatsapp,
    support_email: s.support_email,
    signup_open: s.signup_open,
    plans: copy(s.plans),
    payment_instructions: s.payment_instructions,
    terms: s.terms,
    privacy: s.privacy,
    android_app_url: s.android_app_url,
    demucs: false,
  };
});
on("GET", "/api/session", () => {
  const u = db.users.find((x) => x.id === db.me);
  return { me: u ? accountInfo(u) : null };
});
on("POST", "/api/auth/signup", ({ json }) => {
  if (!db.settings.signup_open) fail(403, "Les inscriptions sont fermées pour le moment.");
  if (!json?.accept) fail(400, "Accepte les conditions d'utilisation pour créer ton compte.");
  const u = createUser(json);
  db.me = u.id;
  return accountInfo(u);
});
on("POST", "/api/auth/login", ({ json }) => {
  const u = db.users.find(
    (x) =>
      x.email ===
      String(json?.email || "")
        .trim()
        .toLowerCase(),
  );
  if (!u || u.password !== json?.password) fail(401, "Adresse e-mail ou mot de passe incorrect.");
  if (u.disabled) fail(403, "Ce compte est suspendu. Contacte le support.");
  db.me = u.id;
  return accountInfo(u);
});
on("POST", "/api/auth/logout", () => ((db.me = null), { ok: true }));
on("GET", "/api/me", () => accountInfo(need()));
on("PUT", "/api/me", ({ json }) => {
  const u = need();
  if (json?.name !== undefined) u.name = String(json.name).slice(0, 80);
  if (json?.phone !== undefined) u.phone = String(json.phone).slice(0, 30);
  return accountInfo(u);
});
on("PUT", "/api/me/password", ({ json }) => {
  const u = need();
  if (u.password !== json?.current) fail(400, "Mot de passe actuel incorrect.");
  if (typeof json?.next !== "string" || json.next.length < 8) fail(400, "Le mot de passe doit faire au moins 8 caractères.");
  u.password = json.next;
  return { ok: true };
});
on("DELETE", "/api/me", ({ json }) => {
  const u = need();
  if (u.password !== json?.password) fail(400, "Mot de passe incorrect.");
  if (u.role === "admin" && db.users.filter((x) => x.role === "admin").length <= 1)
    fail(400, "Tu es le seul administrateur : nomme d'abord un autre administrateur.");
  for (const p of myProjects(u.id)) deleteProject(p.id);
  db.users = db.users.filter((x) => x.id !== u.id);
  db.me = null;
  return { ok: true };
});
const withUser = (r) => {
  const u = db.users.find((x) => x.id === r.user_id) || {};
  return { ...r, email: u.email, name: u.name, phone: u.phone };
};
on("GET", "/api/me/requests", () => {
  const u = need();
  return db.requests.filter((r) => r.user_id === u.id).map(withUser);
});
on("POST", "/api/me/requests", ({ json }) => {
  const u = need();
  if (!plans()[json?.plan] || json.plan === "free") fail(400, "Formule inconnue.");
  const r = {
    id: id(),
    user_id: u.id,
    plan: json.plan,
    months: Math.max(1, Math.min(24, Math.round(Number(json.months) || 1))),
    reference: String(json.reference || "").slice(0, 120),
    note: String(json.note || "").slice(0, 500),
    status: "pending",
    created_at: now(),
  };
  db.requests.unshift(r);
  return { id: r.id };
});
on("GET", "/api/presets", () => {
  const u = need();
  return copy(db.presets.filter((p) => p.user_id === u.id));
});
on("POST", "/api/presets", ({ json }) => {
  const u = need();
  if (!json?.name) fail(400, "Style invalide.");
  const p = { id: id(), user_id: u.id, name: String(json.name).slice(0, 60), style: normalizeStyle(json.style), created_at: now() };
  db.presets.unshift(p);
  return { id: p.id };
});
on("DELETE", "/api/presets/:id", ({ params }) => {
  const u = need();
  db.presets = db.presets.filter((p) => !(p.id === params.id && p.user_id === u.id));
  return { ok: true };
});
on("GET", "/api/capabilities", () => {
  const u = need();
  const plan = effectivePlan(u);
  const isAdmin = u.role === "admin";
  return {
    ffmpeg: false,
    demucs: false,
    transcription: [],
    kie: false,
    watermark: plan.watermark && !isAdmin ? watermark() : null,
    maxResolution: isAdmin ? "4K" : plan.maxResolution,
    presets: PRESETS.map(({ id: pid, name }) => ({ id: pid, name })),
    demo: true,
  };
});

// Administration
on("GET", "/api/admin/stats", () => {
  admin();
  const all = [...db.projects.values()];
  let ai = 0;
  let ex = 0;
  for (const [k, v] of db.usage) if (k.endsWith(month())) (ai += v.ai_seconds), (ex += v.exports);
  return {
    users: db.users.length,
    newUsers: db.users.filter((u) => u.created_at > now() - 30 * 86400_000).length,
    paying: db.users.filter((u) => u.plan !== "free" && u.role !== "admin" && (!u.plan_until || u.plan_until > now())).length,
    projects: all.length,
    storage: all.reduce((n, p) => n + projectSize(p.id), 0),
    aiMinutes: Math.round(ai / 60),
    exports: ex,
    pending: db.requests.filter((r) => r.status === "pending").length,
  };
});
on("GET", "/api/admin/users", ({ query }) => {
  admin();
  const q = String(query.get("q") || "").toLowerCase();
  return db.users
    .filter((u) => !q || [u.email, u.name, u.phone].some((x) => x.toLowerCase().includes(q)))
    .sort((a, b) => b.created_at - a.created_at)
    .map((u) => ({
      ...publicUser(u),
      disabled: u.disabled ? 1 : 0,
      created_at: u.created_at,
      last_login: null,
      ai_seconds: usageOf(u.id).ai_seconds,
      exports: usageOf(u.id).exports,
      projects: myProjects(u.id).length,
      storage: storageOf(u.id),
    }));
});
on("PATCH", "/api/admin/users/:id", ({ params, json }) => {
  const me = admin();
  const u = db.users.find((x) => x.id === params.id) || fail(404, "Compte introuvable.");
  if (u.id === me.id && (json.role === "user" || json.disabled)) fail(400, "Tu ne peux pas te retirer tes propres droits.");
  if (json.plan !== undefined) {
    if (!plans()[json.plan]) fail(400, "Formule inconnue.");
    u.plan = json.plan;
  }
  if (json.plan_until !== undefined) u.plan_until = json.plan_until ? Number(new Date(json.plan_until)) || null : null;
  if (json.role !== undefined) u.role = json.role;
  if (json.disabled !== undefined) u.disabled = !!json.disabled;
  for (const k of ["name", "phone"]) if (json[k] !== undefined) u[k] = String(json[k]);
  return publicUser(u);
});
on("POST", "/api/admin/users/:id/password", ({ params }) => {
  admin();
  const u = db.users.find((x) => x.id === params.id) || fail(404, "Compte introuvable.");
  u.password = Math.random().toString(36).slice(2, 10);
  return { password: u.password };
});
on("DELETE", "/api/admin/users/:id", ({ params }) => {
  const me = admin();
  if (params.id === me.id) fail(400, "Supprime ton propre compte depuis « Mon compte ».");
  for (const p of myProjects(params.id)) deleteProject(p.id);
  db.users = db.users.filter((u) => u.id !== params.id);
  return { ok: true };
});
on("GET", "/api/admin/requests", ({ query }) => {
  admin();
  const status = query.get("status") || "pending";
  return db.requests.filter((r) => status === "all" || r.status === status).map(withUser);
});
on("POST", "/api/admin/requests/:id/approve", ({ params }) => {
  admin();
  const r = db.requests.find((x) => x.id === params.id && x.status === "pending") || fail(404, "Demande introuvable ou déjà traitée.");
  const u = db.users.find((x) => x.id === r.user_id);
  const base = u.plan === r.plan && u.plan_until > now() ? u.plan_until : now();
  u.plan = r.plan;
  u.plan_until = base + r.months * 30 * 86400_000;
  r.status = "approved";
  r.handled_at = now();
  return publicUser(u);
});
on("POST", "/api/admin/requests/:id/reject", ({ params }) => {
  admin();
  const r = db.requests.find((x) => x.id === params.id);
  if (r && r.status === "pending") r.status = "rejected";
  return { ok: true };
});
const SECRET = ["transcription_api_key", "elevenlabs_api_key", "kie_api_key"];
on("GET", "/api/admin/settings", () => {
  admin();
  const out = copy(db.settings);
  for (const k of SECRET) out[k] = out[k] ? `••••${out[k].slice(-4)}` : "";
  return out;
});
on("PUT", "/api/admin/settings", ({ json }) => {
  admin();
  for (const [k, v] of Object.entries(json || {})) {
    if (!(k in db.settings)) continue;
    if (SECRET.includes(k) && typeof v === "string" && v.startsWith("••••")) continue;
    if (k === "plans" && (!v || !v.free)) fail(400, "La formule gratuite (free) est obligatoire.");
    db.settings[k] = typeof v === "string" ? v.trim() : v;
  }
  return routes.find((r) => r.method === "GET" && r.re.test("/api/admin/settings")).fn({});
});

// Projets
on("GET", "/api/projects", () => listProjects(need().id));
on("POST", "/api/projects", ({ form }) => {
  const u = need();
  const file = form.get("file");
  if (!file || !file.size) fail(400, "Ajoute un fichier audio ou vidéo.");
  const ext = extOf(file.name);
  const kind = kindOf(ext);
  if (kind !== "audio" && kind !== "video") fail(400, "Format non pris en charge : MP3, WAV, FLAC, AAC, M4A, OGG, MP4, MOV, WEBM.");
  limits.newProject(u, file.size);
  const lyricsText = String(form.get("lyrics") || "").slice(0, 50_000);
  const base = file.name
    .replace(/\.[^.]+$/, "")
    .replace(/_+/g, " ")
    .trim();
  const p = newProject(u.id, {
    title: String(form.get("title") || base || "Nouvelle chanson").slice(0, 200),
    artist: String(form.get("artist") || "").slice(0, 200),
    lyricsText,
    lines: parseLyrics(lyricsText),
  });
  const name = fileName("source", ext);
  putFile(p.id, name, file);
  p.media.audio = { file: name, duration: 0, original: file.name };
  let style = p.style;
  if (form.get("mode") === "karaoke") style = mergeStyle(style, PRESETS.find((x) => x.id === "karaoke").patch);
  const aspect = form.get("aspect");
  if (["16:9", "9:16", "1:1", "4:5"].includes(aspect)) style.aspect = aspect;
  if (kind === "video") {
    p.media.source = { file: name, kind: "video" };
    style.background = { ...style.background, type: "video", media: name, dim: 0.35 };
  }
  p.style = style;
  return copy(p);
});
on("POST", "/api/projects/suno", () => fail(400, "L'import Suno (Kie.ai) n'est pas branché dans la démonstration."));
on("GET", "/api/projects/:id", ({ params }) => copy(owned(params.id)));
on("PUT", "/api/projects/:id", ({ params, json }) => {
  const p = owned(params.id);
  const keep = { id: p.id, owner: p.owner, createdAt: p.createdAt, media: p.media, suno: p.suno, exports: p.exports };
  Object.assign(p, copy(json), keep, { updatedAt: now() });
  return { ok: true, updatedAt: p.updatedAt };
});
function deleteProject(pid) {
  for (const k of [...db.files.keys()]) if (k.startsWith(`${pid}/`)) dropFile(pid, k.slice(pid.length + 1));
  db.projects.delete(pid);
}
on("DELETE", "/api/projects/:id", ({ params }) => (owned(params.id), deleteProject(params.id), { ok: true }));
on("POST", "/api/projects/:id/duplicate", ({ params }) => {
  const u = need();
  const src = owned(params.id);
  limits.newProject(u);
  const p = newProject(src.owner, {});
  for (const [k, f] of db.files)
    if (k.startsWith(`${src.id}/`) && !k.includes("/export-")) putFile(p.id, k.slice(src.id.length + 1), f.blob);
  const { id: _, owner, createdAt, updatedAt, exports, ...rest } = copy(src);
  Object.assign(p, rest, { title: `${src.title} (copie)`, exports: [] });
  return copy(p);
});
on("PUT", "/api/projects/:id/thumb", ({ params, body }) => {
  owned(params.id);
  putFile(params.id, "thumb.jpg", body);
  return { ok: true };
});
on("POST", "/api/projects/:id/assets", ({ params, form }) => {
  const u = need();
  owned(params.id);
  const file = form.get("file");
  const ext = extOf(file?.name);
  const kind = kindOf(ext);
  if (!["image", "video", "font"].includes(kind))
    fail(400, "Image (JPG, PNG, WEBP, GIF), vidéo (MP4, WEBM, MOV) ou police (TTF, OTF, WOFF) attendue.");
  limits.storage(u, file.size);
  const name = fileName(kind === "font" ? "font" : "asset", ext);
  const url = putFile(params.id, name, file);
  return { file: name, kind, url, original: file.name };
});
const notHere = (what) => () => fail(400, `${what} n'est pas disponible dans la démonstration : il le sera sur ton site en ligne.`);
on("POST", "/api/projects/:id/convert-audio", () => fail(400, "Ce navigateur ne lit pas ce format : essaie un MP3 ou un WAV."));
on("POST", "/api/projects/:id/transcribe", notHere("La synchronisation par IA"));
on("POST", "/api/projects/:id/suno-lyrics", notHere("L'import Suno"));
on("POST", "/api/projects/:id/stems", notHere("La séparation de la voix par IA"));
on("POST", "/api/projects/:id/stems/upload", ({ params, form }) => {
  const p = owned(params.id);
  const v = form.get("vocals");
  const i = form.get("instrumental");
  if (!v?.size && !i?.size) fail(400, "Ajoute la voix seule et/ou l'instrumental.");
  if (v?.size) {
    if (p.media.vocals) dropFile(p.id, p.media.vocals.file);
    const n = fileName("vocals", extOf(v.name) || "mp3");
    putFile(p.id, n, v);
    p.media.vocals = { file: n, method: "upload" };
  }
  if (i?.size) {
    if (p.media.instrumental) dropFile(p.id, p.media.instrumental.file);
    const n = fileName("instrumental", extOf(i.name) || "mp3");
    putFile(p.id, n, i);
    p.media.instrumental = { file: n, method: "upload" };
  }
  return copy(p.media);
});
on("DELETE", "/api/projects/:id/stems", ({ params }) => {
  const p = owned(params.id);
  for (const k of ["vocals", "instrumental"]) if (p.media[k]) dropFile(p.id, p.media[k].file), delete p.media[k];
  return copy(p.media);
});
on("POST", "/api/projects/:id/export-start", ({ params, json }) => {
  const u = need();
  owned(params.id);
  limits.duration(u, Number(json?.duration) || 0);
  limits.export(u, String(json?.resolution || "1080p"));
  addUsage(u.id, { exports: 1 });
  return { watermark: effectivePlan(u).watermark && u.role !== "admin" ? watermark() : null };
});
on("POST", "/api/projects/:id/exports", ({ params, form }) => {
  const p = owned(params.id);
  const video = form.get("video");
  if (!video) fail(400, "Vidéo manquante.");
  if (form.get("audio") || form.get("transcode") === "1") fail(400, "Finition par le serveur indisponible dans la démonstration.");
  const name = fileName("export", "mp4");
  const url = putFile(p.id, name, video);
  p.exports = [
    { file: name, label: String(form.get("label") || "").slice(0, 80), size: video.size, at: now() },
    ...(p.exports || []),
  ].slice(0, 30);
  return { file: name, url };
});
on("DELETE", "/api/projects/:id/exports/:file", ({ params }) => {
  const p = owned(params.id);
  p.exports = (p.exports || []).filter((x) => x.file !== decodeURIComponent(params.file));
  dropFile(p.id, decodeURIComponent(params.file));
  return copy(p.exports);
});
on("GET", "/api/jobs/:id", () => fail(404, "Tâche introuvable."));
on("DELETE", "/api/jobs/:id", () => ({ ok: true }));

// ---------- Même interface que public/js/api.js ----------
async function dispatch(path, { method = "GET", json, form, body } = {}) {
  await sleep(60);
  const url = new URL(path, "https://demo.local");
  for (const r of routes) {
    if (r.method !== method) continue;
    const m = url.pathname.match(r.re);
    if (!m) continue;
    return r.fn({ params: m.groups || {}, json, form, body, query: url.searchParams });
  }
  fail(404, "Adresse inconnue.");
}

export async function api(path, opts = {}) {
  return dispatch(path, opts);
}

export async function upload(path, form, onProgress) {
  onProgress?.(0.5);
  const r = await dispatch(path, { method: "POST", form });
  onProgress?.(1);
  return r;
}

export async function waitJob(job) {
  if (job.state === "error") throw new ApiError(job.error || "La tâche a échoué.", 500);
  return job.result;
}

export const mediaUrl = (project, file) => (file ? db.files.get(`${project.id}/${file}`)?.url || null : null);
export const downloadUrl = mediaUrl;

export async function fetchMedia(url) {
  const blob = urlToBlob.get(url);
  if (blob) return blob.arrayBuffer();
  const res = await fetch(url);
  if (!res.ok) throw new ApiError(`Fichier introuvable (${res.status}).`, res.status);
  return res.arrayBuffer();
}

// ---------- Données d'exemple ----------
/** Petite chanson d'exemple (accords, basse, batterie et une « voix » au centre), fabriquée ici même. */
function sampleSong(timings) {
  const sr = 22050;
  const dur = 24;
  const n = sr * dur;
  const L = new Float32Array(n);
  const R = new Float32Array(n);
  const hz = (m) => 440 * 2 ** ((m - 69) / 12);
  const chords = [
    [60, 64, 67],
    [55, 59, 62],
    [57, 60, 64],
    [53, 57, 60],
  ]; // Do, Sol, La mineur, Fa
  for (let i = 0; i < n; i++) {
    const t = i / sr;
    const bar = Math.floor(t / 2) % 4;
    const ch = chords[bar];
    let pad = 0;
    for (const m of ch) pad += Math.sin(2 * Math.PI * hz(m) * t) * 0.05;
    const beat = t % 0.5;
    const kick = beat < 0.12 ? Math.sin(2 * Math.PI * (60 + 90 * Math.exp(-beat * 40)) * beat) * Math.exp(-beat * 18) * 0.5 : 0;
    const bass = Math.sin(2 * Math.PI * hz(ch[0] - 24) * t) * 0.12 * (0.6 + 0.4 * Math.exp(-(t % 0.5) * 6));
    const shaker = (Math.sin(i * 12.9898) * 43758.5453) % 1;
    const hat = (t + 0.25) % 0.5 < 0.04 ? shaker * 0.04 : 0;
    // Guitare un peu à gauche, piano un peu à droite : la voix reste seule au centre.
    L[i] = pad * 1.2 + bass + kick + hat;
    R[i] = pad * 0.8 + bass + kick + hat * 0.6;
  }
  // « Voix » : une mélodie sur chaque mot chanté, au centre du stéréo.
  const melody = [67, 69, 72, 69, 67, 64, 67, 69, 72, 74, 72, 69, 67, 64, 62, 64, 67, 69, 67, 64, 62, 60];
  let k = 0;
  for (const w of timings) {
    const f = hz(melody[k++ % melody.length]);
    const a = Math.floor(w.start * sr);
    const b = Math.min(n, Math.floor(w.end * sr));
    for (let i = a; i < b; i++) {
      const t = (i - a) / sr;
      const env = Math.min(1, t / 0.03) * Math.min(1, (b - i) / sr / 0.05);
      const v = (Math.sin(2 * Math.PI * f * t + 0.6 * Math.sin(2 * Math.PI * 5.5 * t)) * 0.22 + Math.sin(4 * Math.PI * f * t) * 0.05) * env;
      L[i] += v;
      R[i] += v;
    }
  }
  return new Blob([encodeWav([L, R], sr)], { type: "audio/wav" });
}

/** Pochette d'exemple (coucher de soleil sur la savane), dessinée en SVG. */
function sampleCover() {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="800" height="800" viewBox="0 0 800 800">
  <defs>
    <linearGradient id="sky" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#2d1b4e"/><stop offset="0.45" stop-color="#ff4d8d"/><stop offset="0.75" stop-color="#ff9f1a"/>
    </linearGradient>
    <radialGradient id="sun"><stop offset="0" stop-color="#fff3b0"/><stop offset="0.6" stop-color="#ffd23f"/><stop offset="1" stop-color="#ff9f1a"/></radialGradient>
  </defs>
  <rect width="800" height="800" fill="url(#sky)"/>
  <circle cx="400" cy="470" r="170" fill="url(#sun)"/>
  <path d="M0 560 Q200 520 400 560 T800 548 V800 H0Z" fill="#1a0f1f"/>
  <path d="M560 560 L572 430 L560 430 L548 560Z M470 420 Q565 360 690 415 Q600 445 470 420Z" fill="#1a0f1f"/>
  <path d="M120 560 L128 470 L120 470 L112 560Z M60 465 Q125 425 200 462 Q130 482 60 465Z" fill="#1a0f1f"/>
  <text x="400" y="700" font-family="Arial Black, Arial, sans-serif" font-size="64" font-weight="900" fill="#ffd23f" text-anchor="middle" letter-spacing="4">SOUS LE SOLEIL</text>
</svg>`;
  return new Blob([svg], { type: "image/svg+xml" });
}

function sampleProject(owner, styleId) {
  const text =
    "[Couplet]\nSous le soleil d'Abidjan\nOn danse jusqu'au matin\n\n[Refrain]\nChante avec moi mon ami\nL'Afrique est dans nos mains";
  const lines = parseLyrics(text);
  const starts = [2.2, 6.2, 10.2, 14.2];
  const all = [];
  lines.forEach((l, li) => {
    const step = 3.2 / l.words.length;
    l.words.forEach((w, k) => {
      w.start = Math.round((starts[li] + k * step) * 1000) / 1000;
      w.end = Math.round((w.start + step * 0.88) * 1000) / 1000;
      w.conf = 1;
      all.push(w);
    });
  });
  const style = mergeStyle(defaultStyle(), PRESETS.find((p) => p.id === styleId).patch);
  style.intro = { ...style.intro, title: true, titleDuration: 2 };
  const p = newProject(owner, {
    title: "Sous le soleil (exemple)",
    artist: "Africa Lyrics",
    lyricsText: text,
    lines,
    duration: 24,
    sync: { method: "demo", at: now(), matched: all.length, total: all.length },
    style,
  });
  const name = "source-exemple.wav";
  putFile(p.id, name, sampleSong(all));
  p.media.audio = { file: name, duration: 24, original: "exemple.wav" };
  putFile(p.id, "pochette.svg", sampleCover());
  p.media.cover = { file: "pochette.svg" };
  return p;
}

export const DEMO_ACCOUNTS = {
  admin: { email: "admin@africalyrics.demo", password: DEMO_PASSWORD },
  client: { email: "awa@africalyrics.demo", password: DEMO_PASSWORD },
};

(function seed() {
  const day = 86400_000;
  const boss = createUser({
    email: DEMO_ACCOUNTS.admin.email,
    password: DEMO_PASSWORD,
    name: "Toi (administrateur)",
    role: "admin",
    plan: "studio",
  });
  const awa = createUser({ email: DEMO_ACCOUNTS.client.email, password: DEMO_PASSWORD, name: "Awa", phone: "+225 01 02 03 04 05" });
  const kofi = createUser({
    email: "kofi@africalyrics.demo",
    password: DEMO_PASSWORD,
    name: "Kofi",
    phone: "+233 24 000 0000",
    plan: "pro",
    plan_until: now() + 20 * day,
  });
  createUser({ email: "fatou@africalyrics.demo", password: DEMO_PASSWORD, name: "Fatou", phone: "+221 77 000 00 00" });
  boss.created_at -= 40 * day;
  kofi.created_at -= 12 * day;
  db.usage.set(`${awa.id}|${month()}`, { ai_seconds: 240, exports: 1, stems: 0 });
  db.usage.set(`${kofi.id}|${month()}`, { ai_seconds: 2700, exports: 14, stems: 3 });
  db.requests.push({
    id: id(),
    user_id: awa.id,
    plan: "pro",
    months: 1,
    reference: "OM-2610-48213",
    note: "Payé par Orange Money",
    status: "pending",
    created_at: now() - 3600_000,
  });
  // Exemple « mise en scène » : paroles à gauche, vinyle qui tourne à droite avec la pochette au centre.
  const show = sampleProject(boss.id, "afro");
  Object.assign(show.style.layout, { position: "custom", x: -0.19, y: 0.5, align: "left", maxWidth: 0.55 });
  show.style.layers = [
    newLayer("shape", {
      graphic: "leak",
      color: "#ffb347",
      color2: "#ff4d8d",
      x: 0.08,
      y: 0.1,
      size: 0.9,
      aspect: 1.6,
      blend: "screen",
      opacity: 0.7,
      anim: "float",
      shadow: 0,
    }),
    newLayer("shape", {
      graphic: "ring",
      color: "#ffd23f",
      color2: "#ff4d8d",
      x: 0.74,
      y: 0.5,
      size: 0.8,
      blend: "lighter",
      anim: "pulse",
      shadow: 0,
    }),
    newLayer("shape", { graphic: "vinyl", media: "pochette.svg", x: 0.74, y: 0.5, size: 0.72, anim: "spin", animSpeed: 0.8 }),
  ];
  show.title = "Sous le soleil (calques)";
  sampleProject(awa.id, "karaoke");
})();

export { serializeLyrics };
