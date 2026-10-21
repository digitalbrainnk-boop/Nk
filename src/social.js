// Publications automatiques sur ta page Facebook (et Instagram en option),
// tous les N jours, sans validation : l'IA écrit le texte dans ton style,
// crée une image avec ta clé Kie.ai, publie puis te prévient sur WhatsApp.
//   Facebook  : POST /{page}/photos {url, caption}  ou  POST /{page}/feed {message}
//   Instagram : POST /{ig}/media {image_url, caption} puis POST /{ig}/media_publish {creation_id}
//   Image Kie : POST /api/v1/jobs/createTask {model, input} puis GET /api/v1/jobs/recordInfo
import { addSocialPost, getSettings, lastPublishedPost, listSocialPosts, setSettings } from "./db.js";
import { writeSocialPost } from "./agent.js";
import { cfg, getPageId, graph } from "./channels/meta.js";
import { kieKey } from "./openai-compat.js";
import { messageOwner } from "./router.js";

const KIE = "https://api.kie.ai/api/v1";
const IMAGE_MODEL = process.env.KIE_IMAGE_MODEL || "google/nano-banana";
const POLL_MS = Number(process.env.KIE_POLL_MS || 3000);
const DAY = 24 * 3600_000;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function kie(path, body) {
  const res = await fetch(`${KIE}${path}`, {
    method: body ? "POST" : "GET",
    headers: { Authorization: `Bearer ${kieKey()}`, "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || (typeof data.code === "number" && data.code !== 200)) throw new Error(`Image (Kie.ai) : ${data.msg || `erreur ${res.status}`}`);
  return data.data;
}

/** Crée une image carrée avec Kie.ai ; renvoie son adresse publique. */
export async function createImage(prompt) {
  if (!kieKey()) throw new Error("Clé Kie.ai manquante pour créer l'image.");
  const task = await kie("/jobs/createTask", { model: IMAGE_MODEL, input: { prompt, output_format: "png", image_size: "1:1" } });
  if (!task?.taskId) throw new Error("Image : pas de numéro de tâche.");
  const until = Date.now() + 4 * 60_000;
  while (Date.now() < until) {
    const d = await kie(`/jobs/recordInfo?taskId=${encodeURIComponent(task.taskId)}`);
    const state = String(d?.state || "").toLowerCase();
    if (state === "success") {
      const urls = JSON.parse(d.resultJson || "{}").resultUrls || [];
      if (!urls[0]) throw new Error("Image : aucun fichier renvoyé.");
      return urls[0];
    }
    if (state === "fail" || state === "failed") throw new Error(`Image : ${d?.failMsg || "échec"}`);
    await sleep(POLL_MS);
  }
  throw new Error("Image : trop long.");
}

/** Texte (et image) d'une nouvelle publication, sans la publier. */
export async function draftPost() {
  const s = getSettings();
  const recent = listSocialPosts(6).filter((p) => p.status === "published").map((p) => p.text);
  const post = await writeSocialPost({ recent, guidelines: s.social_guidelines });
  let image_url = null;
  if (s.social_images || s.social_instagram) {
    image_url = await createImage(post.image_prompt).catch((e) => (console.error(e.message), null));
  }
  return { text: post.text.trim(), image_url };
}

async function publishFacebook({ text, image_url }) {
  const { pageToken } = cfg();
  if (!pageToken) throw new Error("Page Facebook non connectée (onglet Canaux → jeton d'accès de la Page).");
  const page = await getPageId();
  const r = image_url
    ? await graph(`${page}/photos`, { method: "POST", token: pageToken, body: { url: image_url, caption: text, published: true } })
    : await graph(`${page}/feed`, { method: "POST", token: pageToken, body: { message: text } });
  return r.post_id || r.id;
}

async function publishInstagram({ text, image_url }) {
  if (!image_url) throw new Error("Instagram demande une image (elle n'a pas pu être créée).");
  const { pageToken } = cfg();
  const page = await getPageId();
  const ig = (await graph(`${page}?fields=instagram_business_account`, { token: pageToken })).instagram_business_account?.id;
  if (!ig) throw new Error("Aucun compte Instagram professionnel relié à ta page Facebook.");
  const media = await graph(`${ig}/media`, { method: "POST", token: pageToken, body: { image_url, caption: text } });
  const r = await graph(`${ig}/media_publish`, { method: "POST", token: pageToken, body: { creation_id: media.id } });
  return r.id;
}

/** Écrit et publie une publication maintenant. */
export async function publishNow() {
  const s = getSettings();
  let post = { text: "", image_url: null };
  try {
    post = await draftPost();
    const fb_id = await publishFacebook(post);
    let ig_id = null;
    let igError = "";
    if (s.social_instagram) ig_id = await publishInstagram(post).catch((e) => ((igError = e.message), null));
    const saved = addSocialPost({ ...post, fb_id, ig_id, status: "published", error: igError ? `Instagram : ${igError}` : null });
    await messageOwner(
      `📣 Publié sur ta page Facebook${ig_id ? " et Instagram" : ""} :\n\n${post.text}${igError ? `\n\n⚠️ Instagram : ${igError}` : ""}`,
    ).catch(() => {});
    return saved;
  } catch (e) {
    addSocialPost({ ...post, text: post.text || "(publication non écrite)", status: "failed", error: e.message });
    await messageOwner(`⚠️ Publication Facebook impossible : ${e.message}`).catch(() => {});
    throw e;
  }
}

/** Appelé chaque minute : publie quand c'est le moment (tous les N jours, à partir de l'heure choisie). */
export async function runSocial(at = Date.now()) {
  const s = getSettings();
  if (!s.social_enabled) return null;
  if (new Date(at).getHours() < (Number(s.social_hour) || 0)) return null;
  const every = Math.max(1, Number(s.social_every_days) || 3);
  const last = lastPublishedPost();
  // On compte en jours du calendrier : tous les N jours, à partir de l'heure choisie.
  const day = (t) => new Date(new Date(t).setHours(0, 0, 0, 0)).getTime();
  if (last && Math.round((day(at) - day(last.created_at)) / DAY) < every) return null;
  // Après un échec, on réessaie 3 heures plus tard (pas toutes les minutes).
  if (s.social_last_attempt && at - s.social_last_attempt < 3 * 3600_000) return null;
  setSettings({ social_last_attempt: at });
  return publishNow().catch((e) => (console.error("Publication :", e.message), null));
}
